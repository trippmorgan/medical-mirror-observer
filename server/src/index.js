/**
 * =============================================================================
 * INDEX.JS - Medical Mirror Observer Backend Server
 * =============================================================================
 *
 * Main entry point for the backend server. This server:
 *
 * 1. RECEIVES telemetry events from the Chrome extension via HTTP POST
 * 2. STORES events in local JSON files (organized by date)
 * 3. ANALYZES events using AI providers (Claude, Gemini, OpenAI)
 * 4. EXPORTS data as JSON or CSV for external analysis
 *
 * Architecture:
 *   Chrome Extension → POST /api/events → File Storage → AI Analysis
 *                                              ↓
 *                                        JSON/CSV Export
 *
 * To start: npm start (or npm run dev for auto-reload)
 *
 * =============================================================================
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config, validateConfig } from './config.js';
import { initStorage, rotateOldFiles } from './storage/file-store.js';
import { Logger, logRequest } from './utils/logger.js';
import eventsRouter from './routes/events.js';
import analysisRouter from './routes/analysis.js';
import exportRouter from './routes/export.js';
import referencesRouter from './routes/references.js';

// Create logger instance for this module
const log = Logger('Server');

// Initialize Express application
const app = express();

// =============================================================================
// MIDDLEWARE SETUP
// =============================================================================

/**
 * Helmet: Security middleware that sets various HTTP headers
 * - Prevents clickjacking, XSS, and other common attacks
 * - Safe to use for API servers
 */
app.use(helmet());

/**
 * CORS: Cross-Origin Resource Sharing configuration
 * - Allows the Chrome extension to make requests to this server
 * - Configured in config.js to accept chrome-extension:// origins
 */
app.use(cors(config.cors));

/**
 * JSON body parser
 * - Parses incoming JSON request bodies
 * - Limit set to 10mb for large event batches
 */
app.use(express.json({ limit: '10mb' }));

/**
 * Request logging middleware
 * - Logs every HTTP request with method, path, status, and duration
 * - Uses color-coded output for easy reading
 */
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logRequest(req, res, duration);
  });
  next();
});

// =============================================================================
// ROUTES
// =============================================================================

/**
 * Health check endpoint
 * - Used by the Chrome extension to verify server availability
 * - Returns server status, version, and uptime
 */
app.get('/health', (req, res) => {
  log.debug('Health check requested');
  res.json({
    status: 'ok',
    version: '0.1.0',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

/**
 * Events API - /api/events
 * - POST: Receive and store telemetry events from extension
 * - GET: Query stored events with filters (source, stage, date range)
 * - GET /stats: Get aggregated statistics
 * - DELETE: Clear all stored events
 */
app.use('/api/events', eventsRouter);

/**
 * Analysis API - /api/analyze
 * - GET: List available AI providers and analysis types
 * - POST: Run AI analysis on stored events
 * - GET /history: View past analyses
 * - GET /providers: Check which AI providers are configured
 */
app.use('/api/analyze', analysisRouter);

/**
 * Export API - /api/export
 * - GET: Download events as JSON or CSV file
 * - Supports filtering by date range, source, stage
 */
app.use('/api/export', exportRouter);

/**
 * References API - /api/references
 * - GET: Get shared recommendations for all sources or specific source
 * - PUT: Update recommendations for a source
 * - POST /generate: Generate references from analysis results
 * These are shared files that other apps (like athena-scraper) can read
 */
app.use('/api/references', referencesRouter);

// =============================================================================
// ERROR HANDLING
// =============================================================================

/**
 * Global error handler
 * - Catches any unhandled errors from route handlers
 * - Logs the error and returns a consistent error response
 */
app.use((err, req, res, next) => {
  log.error('Unhandled error', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(config.nodeEnv === 'development' && { stack: err.stack })
  });
});

/**
 * 404 handler
 * - Returns a consistent response for unknown routes
 */
app.use((req, res) => {
  log.warn(`Route not found: ${req.method} ${req.path}`);
  res.status(404).json({ error: 'Not found' });
});

// =============================================================================
// SERVER STARTUP
// =============================================================================

/**
 * Main startup function
 * - Validates configuration
 * - Initializes storage directories
 * - Starts the HTTP server
 * - Sets up periodic file rotation
 */
async function start() {
  // Print startup banner
  console.log('\n' + '='.repeat(50));
  console.log('  Medical Mirror Observer Server v0.1.0');
  console.log('='.repeat(50) + '\n');

  // Step 1: Validate configuration and warn about missing API keys
  log.info('Validating configuration...');
  const warnings = validateConfig();
  if (warnings.length > 0) {
    warnings.forEach(w => log.warn(w));
  } else {
    log.info('All AI providers configured');
  }

  // Step 2: Initialize storage directories (creates data/events, data/analysis, etc.)
  log.info('Initializing storage...');
  await initStorage();

  // Step 3: Clean up old event files (older than RETENTION_DAYS)
  log.info('Checking for old files to rotate...');
  const rotation = await rotateOldFiles();
  if (rotation.deleted > 0) {
    log.info(`Rotated ${rotation.deleted} old file(s)`);
  }

  // Step 4: Start HTTP server
  app.listen(config.port, config.host, () => {
    log.info(`Server listening on http://${config.host}:${config.port}`);
    log.info('Ready to receive telemetry events');

    // Log available endpoints for reference
    console.log('\n' + '-'.repeat(50));
    console.log('Available Endpoints:');
    console.log('  POST /api/events       - Receive telemetry');
    console.log('  GET  /api/events       - Query events');
    console.log('  GET  /api/events/stats - Get statistics');
    console.log('  POST /api/analyze      - Run AI analysis');
    console.log('  GET  /api/references   - Shared recommendations');
    console.log('  GET  /api/export       - Download events');
    console.log('  GET  /health           - Health check');
    console.log('-'.repeat(50) + '\n');
  });

  // Step 5: Schedule daily file rotation (cleanup old files)
  // Runs every 24 hours to remove files older than RETENTION_DAYS
  const ROTATION_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  setInterval(async () => {
    log.debug('Running scheduled file rotation...');
    const result = await rotateOldFiles();
    if (result.deleted > 0) {
      log.info(`Daily rotation: deleted ${result.deleted} old file(s)`);
    }
  }, ROTATION_INTERVAL_MS);
}

// =============================================================================
// PROCESS HANDLERS
// =============================================================================

/**
 * Handle uncaught exceptions
 * - Logs the error before the process exits
 */
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception', err);
  process.exit(1);
});

/**
 * Handle unhandled promise rejections
 * - Logs the error (doesn't exit by default in Node 15+)
 */
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection', reason);
});

/**
 * Handle graceful shutdown (SIGTERM, SIGINT)
 * - Allows cleanup before exit
 */
process.on('SIGTERM', () => {
  log.info('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  log.info('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

// Start the server
start().catch(err => {
  log.error('Failed to start server', err);
  process.exit(1);
});
