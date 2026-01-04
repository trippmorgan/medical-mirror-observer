/**
 * =============================================================================
 * REFERENCES.JS - Shared Recommendations API
 * =============================================================================
 *
 * Manages shared reference files that contain AI-generated recommendations.
 * These files can be read by other applications (like athena-scraper) to
 * understand what improvements have been suggested.
 *
 * The Observer acts as an architect - it analyzes telemetry, generates
 * recommendations, and stores them here for the user and connected apps.
 *
 * Endpoints:
 *   GET  /api/references           - Get all recommendations (all sources)
 *   GET  /api/references/:source   - Get recommendations for a specific app
 *   PUT  /api/references/:source   - Update recommendations for an app
 *   POST /api/references/generate  - Generate new recommendations from analysis
 *
 * File Storage:
 *   server/data/references/
 *   ├── athena-scraper.json
 *   ├── clinical-app.json
 *   └── _summary.json          # Aggregate metrics
 *
 * =============================================================================
 */

import { Router } from 'express';
import { Logger } from '../utils/logger.js';
import {
  getReferences,
  getReferencesBySource,
  saveReferences,
  generateReferencesFromAnalysis,
  getReferenceSummary
} from '../storage/references-store.js';

// Create logger for this module
const log = Logger('References');

// Create Express router
const router = Router();

// =============================================================================
// ROUTES
// =============================================================================

/**
 * GET /api/references - Get all recommendations across all sources
 *
 * Returns a summary of recommendations from all monitored applications.
 * Useful for the dashboard to show an overview.
 *
 * Response:
 * {
 *   "summary": {
 *     "totalRecommendations": 15,
 *     "criticalCount": 2,
 *     "sources": ["athena-scraper", "clinical-app"]
 *   },
 *   "bySource": {
 *     "athena-scraper": { ... },
 *     "clinical-app": { ... }
 *   }
 * }
 */
router.get('/', async (req, res, next) => {
  try {
    log.info('Fetching all references');

    const references = await getReferences();
    const summary = await getReferenceSummary();

    log.debug(`Found ${summary.totalRecommendations} recommendations across ${summary.sources.length} sources`);

    res.json({
      summary,
      bySource: references
    });
  } catch (err) {
    log.error('Failed to get references', err);
    next(err);
  }
});

/**
 * GET /api/references/summary - Get aggregated metrics only
 *
 * Quick overview without full recommendation details.
 */
router.get('/summary', async (req, res, next) => {
  try {
    log.debug('Fetching reference summary');

    const summary = await getReferenceSummary();

    res.json(summary);
  } catch (err) {
    log.error('Failed to get summary', err);
    next(err);
  }
});

/**
 * GET /api/references/:source - Get recommendations for a specific application
 *
 * This endpoint is designed for applications like athena-scraper to fetch
 * their own recommendations and optionally display them to users.
 *
 * Response:
 * {
 *   "source": "athena-scraper",
 *   "lastUpdated": "2024-01-15T10:30:00Z",
 *   "healthScore": 72,
 *   "metrics": { ... },
 *   "recommendations": [
 *     {
 *       "id": "rec_abc123",
 *       "priority": "high",
 *       "category": "error_handling",
 *       "title": "Add retry logic to API calls",
 *       "description": "...",
 *       "suggestedFix": "...",
 *       "affectedFiles": ["src/api/patient.js"]
 *     }
 *   ]
 * }
 */
router.get('/:source', async (req, res, next) => {
  try {
    const { source } = req.params;

    log.info(`Fetching references for source: ${source}`);

    const references = await getReferencesBySource(source);

    if (!references) {
      log.debug(`No references found for ${source}`);
      return res.status(404).json({
        error: `No recommendations found for source: ${source}`,
        hint: 'Run an analysis first to generate recommendations'
      });
    }

    log.debug(`Found ${references.recommendations?.length || 0} recommendations for ${source}`);

    res.json(references);
  } catch (err) {
    log.error(`Failed to get references for ${req.params.source}`, err);
    next(err);
  }
});

/**
 * PUT /api/references/:source - Update recommendations for an application
 *
 * Typically called after running an AI analysis to store the new recommendations.
 * Can also be called manually to add custom recommendations.
 *
 * Request body:
 * {
 *   "healthScore": 72,
 *   "metrics": {
 *     "errorRate": "15%",
 *     "avgLatency": "234ms"
 *   },
 *   "recommendations": [
 *     {
 *       "priority": "high",
 *       "category": "error_handling",
 *       "title": "...",
 *       "description": "...",
 *       "suggestedFix": "..."
 *     }
 *   ]
 * }
 */
router.put('/:source', async (req, res, next) => {
  try {
    const { source } = req.params;
    const data = req.body;

    log.info(`Updating references for source: ${source}`);
    log.debug(`Received ${data.recommendations?.length || 0} recommendations`);

    const result = await saveReferences(source, data);

    log.info(`References saved for ${source}`);

    res.json({
      success: true,
      source,
      savedAt: result.savedAt,
      recommendationCount: data.recommendations?.length || 0
    });
  } catch (err) {
    log.error(`Failed to save references for ${req.params.source}`, err);
    next(err);
  }
});

/**
 * POST /api/references/generate - Generate recommendations from latest analysis
 *
 * Triggers the Observer to look at the most recent AI analysis for a source
 * and extract actionable recommendations into the shared reference file.
 *
 * Request body:
 * {
 *   "source": "athena-scraper",
 *   "analysisId": "ana_abc123"  // Optional - uses latest if not specified
 * }
 */
router.post('/generate', async (req, res, next) => {
  try {
    const { source, analysisId } = req.body;

    if (!source) {
      return res.status(400).json({
        error: 'Missing required field: source'
      });
    }

    log.info(`Generating references for ${source} from analysis`);

    const result = await generateReferencesFromAnalysis(source, analysisId);

    log.info(`Generated ${result.recommendationCount} recommendations for ${source}`);

    res.json(result);
  } catch (err) {
    log.error('Failed to generate references', err);
    next(err);
  }
});

export default router;
