/**
 * =============================================================================
 * FILE-STORE.JS - JSON File Storage Layer
 * =============================================================================
 *
 * Handles persistent storage of telemetry events and analysis results.
 * Events are stored in daily JSON files for easy management and rotation.
 *
 * File Structure:
 *   server/data/
 *   ├── events/          # Telemetry events (one file per day)
 *   │   ├── 2024-01-15.json
 *   │   └── 2024-01-16.json
 *   ├── analysis/        # AI analysis results
 *   │   └── 2024-01-15-ana_abc123.json
 *   └── exports/         # Generated export files
 *
 * Event File Format:
 *   {
 *     "date": "2024-01-15",
 *     "eventCount": 1234,
 *     "events": [
 *       { "id": "evt_abc123", "source": "...", "event": {...} }
 *     ]
 *   }
 *
 * =============================================================================
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { Logger } from '../utils/logger.js';

// Create logger for this module
const log = Logger('Storage');

// =============================================================================
// FILE LOCKING - Prevents race conditions on concurrent writes
// =============================================================================

/**
 * Simple mutex locks for file access
 * Key: file path, Value: Promise chain for sequential access
 */
const fileLocks = new Map();

/**
 * Acquire a lock for a file and execute a function
 * Ensures only one write operation happens at a time per file
 *
 * @param {string} filePath - Path to lock
 * @param {Function} fn - Async function to execute with lock held
 * @returns {Promise} Result of fn
 */
async function withFileLock(filePath, fn) {
  // Get the current lock chain for this file (or resolved promise if none)
  const currentLock = fileLocks.get(filePath) || Promise.resolve();

  // Create new lock that waits for current, then executes fn
  const newLock = currentLock.then(async () => {
    try {
      return await fn();
    } catch (err) {
      log.error(`File operation failed: ${filePath}`, err);
      throw err;
    }
  });

  // Store the new lock chain (without the result, just the completion)
  fileLocks.set(filePath, newLock.catch(() => {}));

  // Return the actual result
  return newLock;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Ensure a directory exists, creating it if necessary
 * Uses recursive mkdir to create parent directories as needed
 *
 * @param {string} dir - Directory path to ensure exists
 */
async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    // Ignore "already exists" errors
    if (err.code !== 'EEXIST') throw err;
  }
}

/**
 * Get date string in YYYY-MM-DD format for file naming
 * This format ensures files sort chronologically
 *
 * @param {Date} date - Date to format (default: now)
 * @returns {string} Date string like "2024-01-15"
 */
function getDateString(date = new Date()) {
  return date.toISOString().split('T')[0];
}

/**
 * Get the file path for a day's events file
 *
 * @param {Date} date - Date for the events file
 * @returns {string} Full path to the events file
 */
function getEventsFilePath(date = new Date()) {
  const dateStr = getDateString(date);
  return join(config.storage.dataDir, config.storage.eventsDir, `${dateStr}.json`);
}

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Initialize storage directories
 * Creates the data directory structure if it doesn't exist
 * Called once on server startup
 */
export async function initStorage() {
  const dirs = [
    join(config.storage.dataDir, config.storage.eventsDir),   // events/
    join(config.storage.dataDir, config.storage.analysisDir), // analysis/
    join(config.storage.dataDir, config.storage.exportsDir),  // exports/
    join(config.storage.dataDir, 'references')                // references/ - shared recommendations
  ];

  log.debug('Creating storage directories...');

  for (const dir of dirs) {
    await ensureDir(dir);
    log.debug(`Directory ready: ${dir}`);
  }

  log.info(`Storage initialized at ${config.storage.dataDir}`);
}

// =============================================================================
// EVENT FILE OPERATIONS
// =============================================================================

/**
 * Read events file for a specific date
 * Returns empty structure if file doesn't exist (new day)
 *
 * @param {Date} date - Date to read events for
 * @returns {Object} Events data structure
 */
async function readEventsFile(date = new Date()) {
  const filePath = getEventsFilePath(date);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File doesn't exist - return empty structure for new day
      log.debug(`No events file for ${getDateString(date)}, creating new`);
      return {
        date: getDateString(date),
        eventCount: 0,
        events: []
      };
    }
    throw err;
  }
}

/**
 * Write events data to file
 * Creates directory if needed, formats JSON with indentation
 *
 * @param {Object} data - Events data to write
 * @param {Date} date - Date for the file
 */
async function writeEventsFile(data, date = new Date()) {
  const filePath = getEventsFilePath(date);
  await ensureDir(join(config.storage.dataDir, config.storage.eventsDir));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// =============================================================================
// EVENT STORAGE
// =============================================================================

/**
 * Store a single telemetry event
 * Adds unique ID and timestamp, appends to today's events file
 *
 * @param {Object} telemetry - The telemetry event from the extension
 * @returns {Object} { eventId, storedAt } - Confirmation of storage
 *
 * @example
 * const result = await storeEvent({
 *   type: 'OBSERVER_TELEMETRY',
 *   source: 'athena-scraper',
 *   event: { stage: 'interceptor', action: 'capture', success: true }
 * });
 * // result: { eventId: 'evt_abc123def456', storedAt: '2024-01-15T10:30:00.000Z' }
 */
export async function storeEvent(telemetry) {
  const now = new Date();
  const filePath = getEventsFilePath(now);

  // Generate unique event ID (evt_ prefix + 12 char UUID)
  const eventId = `evt_${uuidv4().slice(0, 12)}`;

  // Build the event object with metadata
  const event = {
    id: eventId,
    receivedAt: now.toISOString(),
    ...telemetry
  };

  // Use file lock to prevent race conditions on concurrent writes
  await withFileLock(filePath, async () => {
    // Read current day's events, append new event, write back
    const data = await readEventsFile(now);
    data.events.push(event);
    data.eventCount = data.events.length;
    await writeEventsFile(data, now);
  });

  log.debug(`Stored event ${eventId} from ${telemetry.source || 'unknown'}`);

  return { eventId, storedAt: now.toISOString() };
}

// =============================================================================
// EVENT QUERIES
// =============================================================================

/**
 * Get events with optional filtering and pagination
 *
 * @param {Object} options - Query options
 * @param {string} options.source - Filter by source application
 * @param {string} options.stage - Filter by pipeline stage
 * @param {boolean} options.success - Filter by success status
 * @param {string} options.startDate - Start of date range (ISO string)
 * @param {string} options.endDate - End of date range (ISO string)
 * @param {number} options.limit - Max events to return (default: 100)
 * @param {number} options.offset - Pagination offset (default: 0)
 *
 * @returns {Object} { events, total, limit, offset }
 */
export async function getEvents(options = {}) {
  const {
    source,
    stage,
    success,
    startDate,
    endDate,
    limit = 100,
    offset = 0
  } = options;

  log.debug('Querying events', { source, stage, success, startDate, endDate, limit, offset });

  // Get list of event files in the events directory
  const eventsDir = join(config.storage.dataDir, config.storage.eventsDir);
  let files;

  try {
    files = await fs.readdir(eventsDir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      log.debug('Events directory not found, returning empty');
      return { events: [], total: 0, limit, offset };
    }
    throw err;
  }

  // Filter to only JSON files, sort most recent first
  files = files
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();

  // Apply date range filters to file list
  if (startDate) {
    const start = getDateString(new Date(startDate));
    files = files.filter(f => f.replace('.json', '') >= start);
  }
  if (endDate) {
    const end = getDateString(new Date(endDate));
    files = files.filter(f => f.replace('.json', '') <= end);
  }

  // Collect events from all matching files
  let allEvents = [];

  for (const file of files) {
    const filePath = join(eventsDir, file);
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    let events = data.events || [];

    // Apply content filters
    if (source) {
      events = events.filter(e => e.source === source);
    }
    if (stage) {
      events = events.filter(e => e.event?.stage === stage);
    }
    if (success !== undefined) {
      events = events.filter(e => e.event?.success === success);
    }

    allEvents = allEvents.concat(events);
  }

  // Sort all events by timestamp (most recent first)
  allEvents.sort((a, b) => {
    const timeA = new Date(a.event?.timestamp || a.receivedAt);
    const timeB = new Date(b.event?.timestamp || b.receivedAt);
    return timeB - timeA;
  });

  const total = allEvents.length;
  const paginatedEvents = allEvents.slice(offset, offset + limit);

  log.debug(`Found ${total} events, returning ${paginatedEvents.length}`);

  return {
    events: paginatedEvents,
    total,
    limit,
    offset
  };
}

/**
 * Get aggregated statistics across all events
 * Calculates totals, error counts, source list, and stage breakdown
 *
 * @returns {Object} Statistics object
 */
export async function getStats() {
  const eventsDir = join(config.storage.dataDir, config.storage.eventsDir);

  log.debug('Calculating statistics...');

  let files;
  try {
    files = await fs.readdir(eventsDir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {
        totalEvents: 0,
        errorCount: 0,
        sources: [],
        stageBreakdown: {},
        lastEventTime: null
      };
    }
    throw err;
  }

  files = files.filter(f => f.endsWith('.json')).sort().reverse();

  // Initialize counters
  let totalEvents = 0;
  let errorCount = 0;
  const sources = new Set();
  const stageBreakdown = {};
  let lastEventTime = null;

  // Process each file
  for (const file of files) {
    const filePath = join(eventsDir, file);
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    for (const event of data.events || []) {
      totalEvents++;

      // Track unique sources
      if (event.source) sources.add(event.source);

      // Count events by stage
      const stage = event.event?.stage || 'unknown';
      stageBreakdown[stage] = (stageBreakdown[stage] || 0) + 1;

      // Count errors (success === false)
      if (event.event?.success === false) {
        errorCount++;
      }

      // Track most recent event time
      const eventTime = event.event?.timestamp || event.receivedAt;
      if (!lastEventTime || eventTime > lastEventTime) {
        lastEventTime = eventTime;
      }
    }
  }

  log.debug(`Stats: ${totalEvents} events, ${errorCount} errors, ${sources.size} sources`);

  return {
    totalEvents,
    errorCount,
    sources: Array.from(sources),
    stageBreakdown,
    lastEventTime
  };
}

// =============================================================================
// EVENT MANAGEMENT
// =============================================================================

/**
 * Clear all stored events
 * Deletes all JSON files from the events directory
 *
 * @returns {Object} { cleared: true }
 */
export async function clearEvents() {
  const eventsDir = join(config.storage.dataDir, config.storage.eventsDir);

  log.info('Clearing all events...');

  try {
    const files = await fs.readdir(eventsDir);
    let deleted = 0;

    for (const file of files) {
      if (file.endsWith('.json')) {
        await fs.unlink(join(eventsDir, file));
        deleted++;
      }
    }

    log.info(`Cleared ${deleted} event file(s)`);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  return { cleared: true };
}

/**
 * Rotate (delete) old event files
 * Removes files older than the configured retention period
 * Called on startup and daily via scheduled task
 *
 * @returns {Object} { deleted: number } - Count of deleted files
 */
export async function rotateOldFiles() {
  const eventsDir = join(config.storage.dataDir, config.storage.eventsDir);

  // Calculate cutoff date
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - config.storage.retentionDays);
  const cutoff = getDateString(cutoffDate);

  log.debug(`Rotating files older than ${cutoff}`);

  let deleted = 0;

  try {
    const files = await fs.readdir(eventsDir);

    for (const file of files) {
      if (file.endsWith('.json')) {
        const fileDate = file.replace('.json', '');
        if (fileDate < cutoff) {
          await fs.unlink(join(eventsDir, file));
          deleted++;
          log.debug(`Deleted old file: ${file}`);
        }
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  if (deleted > 0) {
    log.info(`Rotated ${deleted} old event file(s)`);
  }

  return { deleted };
}

// =============================================================================
// ANALYSIS STORAGE
// =============================================================================

/**
 * Save an AI analysis result to file
 * Creates a new file in the analysis directory with unique ID
 *
 * @param {Object} analysis - The analysis result to save
 * @returns {Object} { id, savedTo } - Analysis ID and file path
 */
export async function saveAnalysis(analysis) {
  const analysisDir = join(config.storage.dataDir, config.storage.analysisDir);
  await ensureDir(analysisDir);

  // Generate unique analysis ID
  const id = `ana_${uuidv4().slice(0, 12)}`;
  const filename = `${getDateString()}-${id}.json`;
  const filePath = join(analysisDir, filename);

  const data = {
    id,
    createdAt: new Date().toISOString(),
    ...analysis
  };

  await fs.writeFile(filePath, JSON.stringify(data, null, 2));

  log.info(`Saved analysis ${id} to ${filename}`);

  return { id, savedTo: filePath };
}

/**
 * Get history of past AI analyses
 * Returns most recent analyses first
 *
 * @param {number} limit - Maximum number of analyses to return
 * @returns {Array} List of analysis objects
 */
export async function getAnalysisHistory(limit = 20) {
  const analysisDir = join(config.storage.dataDir, config.storage.analysisDir);

  log.debug(`Getting last ${limit} analyses`);

  let files;
  try {
    files = await fs.readdir(analysisDir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  // Sort by filename (date-based) descending, limit results
  files = files
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit);

  // Read and parse each analysis file
  const analyses = [];
  for (const file of files) {
    const content = await fs.readFile(join(analysisDir, file), 'utf-8');
    analyses.push(JSON.parse(content));
  }

  log.debug(`Returning ${analyses.length} analyses`);

  return analyses;
}
