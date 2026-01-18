/**
 * =============================================================================
 * EVENTS.JS - Telemetry Events API Routes
 * =============================================================================
 *
 * Handles all event-related API endpoints:
 *   - POST /api/events      - Receive and store telemetry events
 *   - GET  /api/events      - Query events with filters
 *   - GET  /api/events/stats - Get aggregated statistics
 *   - DELETE /api/events    - Clear all stored events
 *
 * Events are validated against the telemetry schema (protocols/telemetry-schema.json)
 * and stored in daily JSON files via the file-store module.
 *
 * =============================================================================
 */

import { Router } from 'express';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Logger } from '../utils/logger.js';
import {
  storeEvent,
  getEvents,
  getStats,
  clearEvents
} from '../storage/file-store.js';
import { broadcastToPartners } from '../integrations/partner-broadcast.js';

// Create logger for this module
const log = Logger('Events');

// Create Express router
const router = Router();

// =============================================================================
// SCHEMA VALIDATION SETUP
// =============================================================================

// Get path to the telemetry schema file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const schemaPath = join(__dirname, '..', '..', '..', 'protocols', 'telemetry-schema.json');

// Validator function (loaded asynchronously)
let validateTelemetry = null;

/**
 * Load and compile the telemetry JSON schema for validation
 * Uses AJV (Another JSON Validator) for fast validation
 * If schema fails to load, validation is skipped (basic checks still apply)
 */
async function loadSchema() {
  try {
    log.debug(`Loading schema from ${schemaPath}`);
    const schemaContent = await fs.readFile(schemaPath, 'utf-8');
    const schema = JSON.parse(schemaContent);

    // Create AJV instance with all errors mode (reports all validation errors)
    const ajv = new Ajv({ allErrors: true });
    addFormats(ajv); // Add format validators (date-time, uri, etc.)

    validateTelemetry = ajv.compile(schema);
    log.info('Telemetry schema loaded for validation');
  } catch (err) {
    log.warn(`Schema not loaded: ${err.message}`);
    log.warn('Events will use basic validation only');
  }
}

// Load schema on module initialization
loadSchema();

// =============================================================================
// ROUTES
// =============================================================================

/**
 * POST /api/events - Receive and store a telemetry event
 *
 * Request body should match the telemetry schema:
 * {
 *   "type": "OBSERVER_TELEMETRY",
 *   "source": "application-name",
 *   "event": {
 *     "stage": "pipeline-stage",
 *     "action": "what-happened",
 *     "success": true/false,
 *     "timestamp": "ISO-8601 date",
 *     "data": { ... }
 *   }
 * }
 *
 * Response: { success: true, eventId: "evt_xxx", storedAt: "ISO date" }
 */
router.post('/', async (req, res, next) => {
  try {
    const telemetry = req.body;

    log.debug('Received telemetry event', {
      source: telemetry.source,
      stage: telemetry.event?.stage,
      action: telemetry.event?.action
    });

    // Validate against JSON schema if loaded
    if (validateTelemetry && !validateTelemetry(telemetry)) {
      log.warn('Schema validation failed', validateTelemetry.errors);
      return res.status(400).json({
        error: 'Invalid telemetry format',
        details: validateTelemetry.errors
      });
    }

    // Basic validation (fallback if schema not loaded)
    if (!telemetry.type || !telemetry.source || !telemetry.event) {
      log.warn('Basic validation failed - missing required fields');
      return res.status(400).json({
        error: 'Missing required fields: type, source, event'
      });
    }

    // Store the event
    const result = await storeEvent(telemetry);

    log.info(`Stored event ${result.eventId} from ${telemetry.source}`);

    // Broadcast to connected SCC UI partners
    broadcastToPartners({
      ...telemetry,
      id: result.eventId,
      receivedAt: result.storedAt
    });

    res.status(201).json({
      success: true,
      eventId: result.eventId,
      storedAt: result.storedAt
    });
  } catch (err) {
    log.error('Failed to store event', err);
    next(err);
  }
});

/**
 * GET /api/events - Query stored events with filters
 *
 * Query parameters:
 *   - source: Filter by source application (e.g., "athena-scraper")
 *   - stage: Filter by pipeline stage (e.g., "interceptor")
 *   - success: Filter by success status ("true" or "false")
 *   - startDate: Start of date range (ISO string)
 *   - endDate: End of date range (ISO string)
 *   - limit: Max events to return (default 100, max 1000)
 *   - offset: Pagination offset (default 0)
 *
 * Response: { events: [...], total: N, limit: N, offset: N }
 */
router.get('/', async (req, res, next) => {
  try {
    const {
      source,
      stage,
      success,
      startDate,
      endDate,
      limit = '100',
      offset = '0'
    } = req.query;

    log.debug('Query events', { source, stage, success, startDate, endDate });

    // Build query options
    const options = {
      source,
      stage,
      startDate,
      endDate,
      limit: Math.min(parseInt(limit) || 100, 1000), // Cap at 1000
      offset: parseInt(offset) || 0
    };

    // Parse success boolean from query string
    if (success !== undefined) {
      options.success = success === 'true';
    }

    const result = await getEvents(options);

    log.debug(`Returning ${result.events.length} of ${result.total} events`);

    res.json(result);
  } catch (err) {
    log.error('Failed to query events', err);
    next(err);
  }
});

/**
 * GET /api/events/stats - Get aggregated statistics
 *
 * Returns summary statistics across all stored events:
 *   - totalEvents: Total event count
 *   - errorCount: Events with success=false
 *   - sources: List of unique source applications
 *   - stageBreakdown: Event counts by pipeline stage
 *   - lastEventTime: Timestamp of most recent event
 */
router.get('/stats', async (req, res, next) => {
  try {
    log.debug('Fetching statistics');

    const stats = await getStats();

    log.debug(`Stats: ${stats.totalEvents} events, ${stats.errorCount} errors`);

    res.json(stats);
  } catch (err) {
    log.error('Failed to get stats', err);
    next(err);
  }
});

/**
 * DELETE /api/events - Clear all stored events
 *
 * WARNING: This permanently deletes all event data!
 * Use with caution - typically only for development/testing.
 *
 * Response: { cleared: true }
 */
router.delete('/', async (req, res, next) => {
  try {
    log.warn('Clearing all events (DELETE /api/events called)');

    const result = await clearEvents();

    log.info('All events cleared');

    res.json(result);
  } catch (err) {
    log.error('Failed to clear events', err);
    next(err);
  }
});

export default router;
