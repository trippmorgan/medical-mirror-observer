/**
 * =============================================================================
 * EXPORT.JS - Data Export API Routes
 * =============================================================================
 *
 * Handles exporting telemetry events for external analysis:
 *   - GET /api/export - Download events as JSON or CSV
 *
 * Export formats:
 *   - JSON: Full event data with metadata
 *   - CSV: Flattened tabular format for spreadsheets
 *
 * Supports filtering by:
 *   - source: Application name
 *   - stage: Pipeline stage
 *   - success: Success status
 *   - startDate/endDate: Date range
 *
 * =============================================================================
 */

import { Router } from 'express';
import { Logger } from '../utils/logger.js';
import { getEvents } from '../storage/file-store.js';

// Create logger for this module
const log = Logger('Export');

// Create Express router
const router = Router();

// =============================================================================
// ROUTES
// =============================================================================

/**
 * GET /api/export - Export events as JSON or CSV
 *
 * Query parameters:
 *   - format: Output format ('json' or 'csv', default: 'json')
 *   - source: Filter by source application
 *   - stage: Filter by pipeline stage
 *   - success: Filter by success status ('true' or 'false')
 *   - startDate: Start of date range (ISO string)
 *   - endDate: End of date range (ISO string)
 *
 * Response: File download with appropriate Content-Type header
 *
 * Examples:
 *   GET /api/export?format=json
 *   GET /api/export?format=csv&source=athena-scraper
 *   GET /api/export?format=json&startDate=2024-01-01&endDate=2024-01-31
 */
router.get('/', async (req, res, next) => {
  try {
    const {
      format = 'json',
      source,
      stage,
      success,
      startDate,
      endDate
    } = req.query;

    log.info(`Export requested: format=${format}`, { source, stage, success, startDate, endDate });

    // Build query options (high limit for full export)
    const options = {
      source,
      stage,
      startDate,
      endDate,
      limit: 100000, // High limit to get all matching events
      offset: 0
    };

    // Parse success boolean
    if (success !== undefined) {
      options.success = success === 'true';
    }

    // Fetch all matching events
    const result = await getEvents(options);
    const events = result.events;

    log.info(`Exporting ${events.length} events as ${format.toUpperCase()}`);

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `medical-mirror-export-${timestamp}`;

    if (format === 'csv') {
      // CSV Export
      const csv = eventsToCSV(events);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send(csv);
      log.debug('CSV export sent');
    } else {
      // JSON Export (default)
      const exportData = {
        exportedAt: new Date().toISOString(),
        totalEvents: events.length,
        filters: { source, stage, success, startDate, endDate },
        events
      };

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      res.json(exportData);
      log.debug('JSON export sent');
    }
  } catch (err) {
    log.error('Export failed', err);
    next(err);
  }
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Convert events array to CSV format
 *
 * Flattens the nested event structure into a tabular format.
 * Handles special characters and proper CSV escaping.
 *
 * @param {Array} events - Array of event objects
 * @returns {string} CSV formatted string
 *
 * CSV Columns:
 *   - id: Event ID
 *   - receivedAt: When server received event
 *   - type: Event type (OBSERVER_TELEMETRY)
 *   - source: Source application
 *   - stage: Pipeline stage
 *   - action: Event action
 *   - success: Success status
 *   - timestamp: Event timestamp from source
 *   - duration_ms: Processing duration
 *   - correlationId: Cross-event correlation ID
 *   - data: Event data as JSON string
 */
function eventsToCSV(events) {
  // Handle empty export
  if (events.length === 0) {
    log.debug('No events to export');
    return 'No events to export';
  }

  // Define CSV column headers
  const headers = [
    'id',
    'receivedAt',
    'type',
    'source',
    'stage',
    'action',
    'success',
    'timestamp',
    'duration_ms',
    'correlationId',
    'data'
  ];

  // Map events to row arrays (flatten nested structure)
  const rows = events.map(e => {
    const event = e.event || {};
    return [
      e.id || '',
      e.receivedAt || '',
      e.type || '',
      e.source || '',
      event.stage || '',
      event.action || '',
      event.success !== undefined ? String(event.success) : '',
      event.timestamp || '',
      event.duration_ms || '',
      event.correlationId || '',
      // Stringify data object, escape quotes for CSV
      event.data ? JSON.stringify(event.data).replace(/"/g, '""') : ''
    ];
  });

  /**
   * Escape a value for CSV format
   * Wraps in quotes if contains comma, quote, or newline
   * Doubles up any quotes within the value
   */
  const escapeCSV = (val) => {
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // Build CSV lines (header + data rows)
  const csvLines = [
    headers.join(','),
    ...rows.map(row => row.map(escapeCSV).join(','))
  ];

  log.debug(`Generated CSV with ${csvLines.length - 1} data rows`);

  return csvLines.join('\n');
}

export default router;
