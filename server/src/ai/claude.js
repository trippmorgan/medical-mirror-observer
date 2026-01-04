/**
 * =============================================================================
 * CLAUDE.JS - Anthropic Claude AI Provider
 * =============================================================================
 *
 * Integration with Anthropic's Claude API for telemetry analysis.
 * Claude excels at structured analysis and following complex instructions.
 *
 * Requirements:
 *   - ANTHROPIC_API_KEY must be set in .env
 *   - Get your key at: https://console.anthropic.com/
 *
 * Features:
 *   - Lazy client initialization (only creates when first needed)
 *   - Automatic JSON extraction from responses
 *   - Token usage tracking
 *
 * =============================================================================
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { Logger } from '../utils/logger.js';
import { SYSTEM_PROMPT } from './prompts.js';

// Create logger for this module
const log = Logger('Claude');

// Singleton client instance (lazy initialization)
let client = null;

// =============================================================================
// CLIENT MANAGEMENT
// =============================================================================

/**
 * Get or create the Anthropic client instance
 * Uses lazy initialization - only creates client when first needed
 *
 * @returns {Anthropic|null} Anthropic client or null if not configured
 */
function getClient() {
  if (!client && config.ai.anthropic.apiKey) {
    log.debug('Initializing Anthropic client');
    client = new Anthropic({
      apiKey: config.ai.anthropic.apiKey
    });
  }
  return client;
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Run analysis using Claude
 *
 * Sends the prompt to Claude and processes the response.
 * Attempts to extract JSON from the response if present.
 *
 * @param {string} prompt - The analysis prompt to send
 * @returns {Object} Analysis result:
 *   - provider: 'claude'
 *   - model: Model used (from config)
 *   - content: Raw text response
 *   - parsed: Parsed JSON if found in response
 *   - tokensUsed: { input, output, total }
 *   - durationMs: Request duration
 *
 * @throws {Error} If API key not configured or API call fails
 */
export async function analyzeWithClaude(prompt) {
  const anthropic = getClient();

  // Check if client is available
  if (!anthropic) {
    log.error('Claude API key not configured');
    throw new Error('Claude API key not configured. Set ANTHROPIC_API_KEY in .env');
  }

  log.info(`Sending request to Claude (${config.ai.anthropic.model})`);
  log.debug(`Prompt length: ${prompt.length} characters`);

  const startTime = Date.now();

  // ---------------------------------------------------------------------------
  // Make API request
  // ---------------------------------------------------------------------------
  const response = await anthropic.messages.create({
    model: config.ai.anthropic.model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  const duration = Date.now() - startTime;

  log.info(`Claude response received in ${duration}ms`);
  log.debug(`Stop reason: ${response.stop_reason}`);

  // ---------------------------------------------------------------------------
  // Extract text content from response
  // ---------------------------------------------------------------------------
  // Claude returns an array of content blocks (text, tool_use, etc.)
  // We filter to just text blocks and join them
  const content = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  log.debug(`Response length: ${content.length} characters`);

  // ---------------------------------------------------------------------------
  // Try to parse JSON from response
  // ---------------------------------------------------------------------------
  // AI responses often contain JSON wrapped in markdown code blocks
  // We try to extract and parse it for easier programmatic use
  let parsed = null;
  try {
    // Look for JSON in markdown code block first: ```json ... ```
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                      // Fallback: any JSON object in the response
                      content.match(/(\{[\s\S]*\})/);

    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[1]);
      log.debug('Successfully parsed JSON from response');
    }
  } catch (e) {
    // Not valid JSON - keep parsed as null
    log.debug('Response does not contain valid JSON');
  }

  // ---------------------------------------------------------------------------
  // Return structured result
  // ---------------------------------------------------------------------------
  return {
    provider: 'claude',
    model: config.ai.anthropic.model,
    content,
    parsed,
    tokensUsed: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      total: response.usage.input_tokens + response.usage.output_tokens
    },
    durationMs: duration
  };
}

/**
 * Check if Claude is available (API key configured)
 *
 * @returns {boolean} True if ANTHROPIC_API_KEY is set
 */
export function isClaudeAvailable() {
  const available = !!config.ai.anthropic.apiKey;
  log.debug(`Claude available: ${available}`);
  return available;
}
