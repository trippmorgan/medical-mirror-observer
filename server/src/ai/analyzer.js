/**
 * =============================================================================
 * ANALYZER.JS - AI Analysis Orchestrator
 * =============================================================================
 *
 * Main entry point for AI-powered analysis of telemetry events.
 * Coordinates between event retrieval, prompt building, and AI providers.
 *
 * Supported Providers:
 *   - Claude (Anthropic) - Excellent for structured analysis
 *   - Gemini (Google)    - Fast and cost-effective
 *   - OpenAI (GPT)       - Good general-purpose analysis
 *
 * Analysis Types:
 *   - anomaly:         Find errors, failures, and patterns
 *   - summary:         High-level overview of events
 *   - pattern:         Identify behavioral sequences
 *   - recommendations: Optimization suggestions
 *
 * Usage:
 *   const result = await analyzeEvents({
 *     provider: 'claude',
 *     analysisType: 'anomaly',
 *     maxEvents: 100
 *   });
 *
 * =============================================================================
 */

import { Logger } from '../utils/logger.js';
import { analyzeWithClaude, isClaudeAvailable } from './claude.js';
import { analyzeWithGemini, isGeminiAvailable } from './gemini.js';
import { analyzeWithOpenAI, isOpenAIAvailable } from './openai.js';
import { buildPrompt, ANALYSIS_TYPES } from './prompts.js';
import { getEvents, saveAnalysis } from '../storage/file-store.js';

// Create logger for this module
const log = Logger('Analyzer');

// =============================================================================
// PROVIDER REGISTRY
// =============================================================================

/**
 * Registry of available AI providers
 * Each provider has:
 *   - analyze: Function to run analysis
 *   - isAvailable: Function to check if API key is configured
 */
const providers = {
  claude: {
    analyze: analyzeWithClaude,
    isAvailable: isClaudeAvailable
  },
  gemini: {
    analyze: analyzeWithGemini,
    isAvailable: isGeminiAvailable
  },
  openai: {
    analyze: analyzeWithOpenAI,
    isAvailable: isOpenAIAvailable
  }
};

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Get list of AI providers that have API keys configured
 *
 * @returns {string[]} Array of available provider names
 *
 * @example
 * const available = getAvailableProviders();
 * // Returns: ['claude', 'gemini'] if those have API keys set
 */
export function getAvailableProviders() {
  const available = Object.entries(providers)
    .filter(([_, p]) => p.isAvailable())
    .map(([name]) => name);

  log.debug(`Available providers: ${available.join(', ') || 'none'}`);
  return available;
}

/**
 * Run AI analysis on stored telemetry events
 *
 * This is the main function for analyzing pipeline data.
 * It fetches events, builds a prompt, sends to the AI provider,
 * and optionally saves the results to a file.
 *
 * @param {Object} options - Analysis options
 * @param {string} options.provider - AI provider to use ('claude', 'gemini', 'openai')
 * @param {string} options.analysisType - Type of analysis ('anomaly', 'summary', 'pattern', 'recommendations')
 * @param {Object} options.timeRange - Date range filter { start, end }
 * @param {Object} options.filters - Event filters { source, stage, success }
 * @param {boolean} options.saveToFile - Whether to save results to file (default: true)
 * @param {number} options.maxEvents - Maximum events to analyze (default: 100)
 *
 * @returns {Object} Analysis result including:
 *   - analysisId: Unique ID if saved to file
 *   - provider: AI provider used
 *   - model: Specific model used
 *   - analysisType: Type of analysis performed
 *   - eventsAnalyzed: Number of events included
 *   - result: { content, parsed } - Raw and parsed AI response
 *   - tokensUsed: { input, output, total } - Token usage
 *   - durationMs: Time taken for analysis
 *   - savedTo: File path if saved
 *
 * @throws {Error} If provider is not available or analysis type is invalid
 */
export async function analyzeEvents(options) {
  const {
    provider = 'claude',
    analysisType = 'anomaly',
    timeRange,
    filters = {},
    saveToFile = true,
    maxEvents = 100
  } = options;

  log.info(`Starting analysis: type=${analysisType}, provider=${provider}, maxEvents=${maxEvents}`);

  // ---------------------------------------------------------------------------
  // Step 1: Validate provider
  // ---------------------------------------------------------------------------
  const providerConfig = providers[provider];
  if (!providerConfig) {
    log.error(`Unknown provider: ${provider}`);
    throw new Error(`Unknown provider: ${provider}. Available: ${Object.keys(providers).join(', ')}`);
  }

  if (!providerConfig.isAvailable()) {
    log.error(`Provider ${provider} not configured`);
    throw new Error(`Provider ${provider} is not configured. Check API key in .env`);
  }

  // ---------------------------------------------------------------------------
  // Step 2: Validate analysis type
  // ---------------------------------------------------------------------------
  if (!ANALYSIS_TYPES.includes(analysisType)) {
    log.error(`Invalid analysis type: ${analysisType}`);
    throw new Error(`Unknown analysis type: ${analysisType}. Available: ${ANALYSIS_TYPES.join(', ')}`);
  }

  // ---------------------------------------------------------------------------
  // Step 3: Fetch events from storage
  // ---------------------------------------------------------------------------
  log.debug('Fetching events for analysis', { filters, timeRange });

  const eventQuery = {
    ...filters,
    startDate: timeRange?.start,
    endDate: timeRange?.end,
    limit: maxEvents * 2 // Fetch extra in case filtering reduces count
  };

  const eventResult = await getEvents(eventQuery);
  const events = eventResult.events.slice(0, maxEvents);

  log.debug(`Fetched ${events.length} events for analysis`);

  // Handle empty result
  if (events.length === 0) {
    log.warn('No events found matching criteria');
    return {
      provider,
      analysisType,
      eventsAnalyzed: 0,
      result: {
        summary: 'No events found matching the specified criteria',
        parsed: null
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Step 4: Build prompt for AI
  // ---------------------------------------------------------------------------
  log.debug(`Building ${analysisType} prompt for ${events.length} events`);
  const prompt = buildPrompt(analysisType, events, { maxEvents });

  // ---------------------------------------------------------------------------
  // Step 5: Run AI analysis
  // ---------------------------------------------------------------------------
  log.info(`Sending to ${provider} for ${analysisType} analysis...`);
  const startTime = Date.now();

  const result = await providerConfig.analyze(prompt);

  const analysisDuration = Date.now() - startTime;
  log.info(`Analysis complete in ${analysisDuration}ms`);
  log.debug(`Tokens used: ${result.tokensUsed.total} (${result.tokensUsed.input} in, ${result.tokensUsed.output} out)`);

  // ---------------------------------------------------------------------------
  // Step 6: Prepare response
  // ---------------------------------------------------------------------------
  const analysisResult = {
    provider,
    model: result.model,
    analysisType,
    eventsAnalyzed: events.length,
    timeRange: {
      // Get time range from actual events analyzed
      start: events[events.length - 1]?.event?.timestamp || events[events.length - 1]?.receivedAt,
      end: events[0]?.event?.timestamp || events[0]?.receivedAt
    },
    filters,
    result: {
      content: result.content,  // Raw text response
      parsed: result.parsed     // Parsed JSON if available
    },
    tokensUsed: result.tokensUsed,
    durationMs: result.durationMs
  };

  // ---------------------------------------------------------------------------
  // Step 7: Save to file if requested
  // ---------------------------------------------------------------------------
  if (saveToFile) {
    log.debug('Saving analysis to file...');
    const saved = await saveAnalysis(analysisResult);
    analysisResult.savedTo = saved.savedTo;
    analysisResult.analysisId = saved.id;
    log.info(`Analysis saved: ${saved.id}`);
  }

  return analysisResult;
}

// Export analysis types for use by routes
export { ANALYSIS_TYPES };
