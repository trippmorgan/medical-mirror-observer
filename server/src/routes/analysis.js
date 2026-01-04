/**
 * =============================================================================
 * ANALYSIS.JS - AI Analysis API Routes
 * =============================================================================
 *
 * Handles AI-powered analysis of telemetry events:
 *   - GET  /api/analyze           - Get available providers and analysis types
 *   - POST /api/analyze           - Run AI analysis on events
 *   - GET  /api/analyze/history   - Get past analysis results
 *   - GET  /api/analyze/providers - Check configured AI providers
 *
 * Supports multiple AI providers:
 *   - Claude (Anthropic)
 *   - Gemini (Google)
 *   - OpenAI (GPT)
 *
 * Analysis types:
 *   - anomaly: Find errors, failures, and concerning patterns
 *   - summary: High-level overview of events
 *   - pattern: Identify behavioral patterns and sequences
 *   - recommendations: Optimization suggestions
 *
 * =============================================================================
 */

import { Router } from 'express';
import { Logger } from '../utils/logger.js';
import { analyzeEvents, getAvailableProviders, ANALYSIS_TYPES } from '../ai/analyzer.js';
import { getAnalysisHistory } from '../storage/file-store.js';

// Create logger for this module
const log = Logger('Analysis');

// Create Express router
const router = Router();

// =============================================================================
// ROUTES
// =============================================================================

/**
 * GET /api/analyze - Get API documentation and available options
 *
 * Returns information about how to use the analysis API,
 * including available providers and analysis types.
 */
router.get('/', (req, res) => {
  const providers = getAvailableProviders();

  log.debug('Analysis API info requested');

  res.json({
    availableProviders: providers,
    analysisTypes: ANALYSIS_TYPES,
    usage: {
      method: 'POST',
      description: 'Run AI analysis on stored events',
      body: {
        provider: 'claude|gemini|openai (default: claude)',
        analysisType: 'anomaly|summary|pattern|recommendations (default: anomaly)',
        timeRange: {
          start: 'ISO date string (optional)',
          end: 'ISO date string (optional)'
        },
        filters: {
          source: 'Filter by source application (optional)',
          stage: 'Filter by pipeline stage (optional)',
          success: 'Filter by success status (optional)'
        },
        maxEvents: 'Max events to analyze (default: 100)',
        saveToFile: 'Save results to file (default: true)'
      }
    }
  });
});

/**
 * POST /api/analyze - Run AI analysis on stored events
 *
 * Request body:
 * {
 *   "provider": "claude",           // AI provider (claude, gemini, openai)
 *   "analysisType": "anomaly",      // Type of analysis
 *   "timeRange": {                  // Optional date filter
 *     "start": "2024-01-01T00:00:00Z",
 *     "end": "2024-01-31T23:59:59Z"
 *   },
 *   "filters": {                    // Optional content filters
 *     "source": "athena-scraper",
 *     "stage": "interceptor",
 *     "success": false
 *   },
 *   "maxEvents": 100,               // Max events to include
 *   "saveToFile": true              // Save results to analysis directory
 * }
 *
 * Response:
 * {
 *   "analysisId": "ana_xxx",
 *   "provider": "claude",
 *   "analysisType": "anomaly",
 *   "eventsAnalyzed": 50,
 *   "result": { ... },
 *   "tokensUsed": { input: N, output: N, total: N },
 *   "durationMs": 1234,
 *   "savedTo": "/path/to/analysis/file.json"
 * }
 */
router.post('/', async (req, res, next) => {
  try {
    const {
      provider = 'claude',
      analysisType = 'anomaly',
      timeRange,
      filters,
      maxEvents = 100,
      saveToFile = true
    } = req.body;

    log.info(`Analysis requested: ${analysisType} via ${provider}`);
    log.debug('Analysis options', { timeRange, filters, maxEvents, saveToFile });

    // Validate analysis type
    if (!ANALYSIS_TYPES.includes(analysisType)) {
      log.warn(`Invalid analysis type: ${analysisType}`);
      return res.status(400).json({
        error: `Invalid analysisType. Must be one of: ${ANALYSIS_TYPES.join(', ')}`
      });
    }

    // Check if provider is available (has API key configured)
    const available = getAvailableProviders();
    if (!available.includes(provider)) {
      log.warn(`Provider not available: ${provider}`);
      return res.status(400).json({
        error: `Provider '${provider}' not available. Configure API key or use: ${available.join(', ')}`,
        available
      });
    }

    // Run the analysis
    log.info(`Starting ${analysisType} analysis with ${provider}...`);
    const startTime = Date.now();

    const result = await analyzeEvents({
      provider,
      analysisType,
      timeRange,
      filters,
      maxEvents,
      saveToFile
    });

    const duration = Date.now() - startTime;
    log.info(`Analysis complete in ${duration}ms, analyzed ${result.eventsAnalyzed} events`);

    res.json(result);
  } catch (err) {
    log.error('Analysis failed', err);
    next(err);
  }
});

/**
 * GET /api/analyze/history - Get past analysis results
 *
 * Query parameters:
 *   - limit: Max number of results (default: 20, max: 100)
 *
 * Response: { analyses: [...] }
 */
router.get('/history', async (req, res, next) => {
  try {
    // Parse and cap limit
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    log.debug(`Fetching last ${limit} analyses`);

    const history = await getAnalysisHistory(limit);

    log.debug(`Returning ${history.length} analyses`);

    res.json({ analyses: history });
  } catch (err) {
    log.error('Failed to get analysis history', err);
    next(err);
  }
});

/**
 * GET /api/analyze/providers - List available AI providers
 *
 * Returns which AI providers are configured and ready to use.
 * A provider is available if its API key is set in the .env file.
 *
 * Response:
 * {
 *   "available": ["claude", "gemini"],  // Providers with API keys
 *   "all": ["claude", "gemini", "openai"],  // All supported providers
 *   "configured": 2,  // Number configured
 *   "message": "2 provider(s) ready for analysis."
 * }
 */
router.get('/providers', (req, res) => {
  const available = getAvailableProviders();

  log.debug(`Providers check: ${available.length} available`);

  res.json({
    available,
    all: ['claude', 'gemini', 'openai'],
    configured: available.length,
    message: available.length === 0
      ? 'No AI providers configured. Add API keys to .env file.'
      : `${available.length} provider(s) ready for analysis.`
  });
});

export default router;
