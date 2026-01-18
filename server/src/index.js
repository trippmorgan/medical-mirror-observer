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
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config, validateConfig } from './config.js';
import { initStorage, rotateOldFiles } from './storage/file-store.js';
import { Logger, logRequest } from './utils/logger.js';
import eventsRouter from './routes/events.js';
import analysisRouter from './routes/analysis.js';
import exportRouter from './routes/export.js';
import referencesRouter from './routes/references.js';
import orchestratorRouter from './routes/orchestrator.js';
import ultrasoundRouter from './routes/ultrasound.js';
import claudeTeamClient from './integrations/claude-team-client.js';
import { addPartnerClient, removePartnerClient, getPartnerCount } from './integrations/partner-broadcast.js';

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

/**
 * Orchestrator - /api/orchestrator
 * - Multi-agent workflow orchestration
 * - Coordinates Observer, Claude Team, Browser Bridge, and SCC
 */
app.use('/api/orchestrator', orchestratorRouter);

/**
 * Ultrasound Analysis Routes (UltraLinq Integration)
 * - POST /api/ultrasound/analyze - Analyze ultrasound findings
 * - GET /api/ultrasound/cpt-codes - Get CPT code reference
 */
app.use('/api/ultrasound', ultrasoundRouter);

/**
 * Integrations - /integrations
 * - Static files for telemetry client scripts
 * - Apps can load these to integrate with the Observer
 * - CORS enabled for all origins to allow script injection
 * - Helmet disabled for this route to allow cross-origin loading
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const integrationsPath = join(__dirname, '../../integrations');
app.use('/integrations',
  helmet({
    contentSecurityPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }),
  (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    next();
  },
  express.static(integrationsPath)
);

// =============================================================================
// CLAUDE TEAM STATUS
// =============================================================================

/**
 * Claude Team hub connection status
 */
app.get('/api/claude-team/status', (req, res) => {
  res.json(claudeTeamClient.getConnectionStatus());
});

/**
 * Broadcast message to Claude Team hub
 */
app.post('/api/claude-team/broadcast', express.json(), (req, res) => {
  const { message, category } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }
  const sent = claudeTeamClient.broadcast(message, category || 'update');
  res.json({ sent, message: sent ? 'Broadcast sent' : 'Not connected to hub' });
});

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

  // Step 4: Create HTTP server and WebSocket server
  const server = createServer(app);

  // WebSocket server for /partner endpoint (SCC UI connection)
  const wss = new WebSocketServer({ noServer: true });

  // Handle WebSocket upgrade requests
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

    if (pathname === '/partner') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  // Handle partner WebSocket connections
  wss.on('connection', (ws) => {
    log.info('[Partner WS] SCC UI connected');
    addPartnerClient(ws);

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Connected to Medical Mirror Observer',
      timestamp: new Date().toISOString(),
      partnerCount: getPartnerCount()
    }));

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        log.debug('[Partner WS] Received:', message.type || 'unknown');
        // Handle incoming messages from SCC UI if needed
      } catch (err) {
        log.error('[Partner WS] Parse error:', err.message);
      }
    });

    ws.on('close', () => {
      log.info('[Partner WS] SCC UI disconnected');
      removePartnerClient(ws);
    });

    ws.on('error', (err) => {
      log.error('[Partner WS] Error:', err.message);
      removePartnerClient(ws);
    });
  });

  // Start the server
  server.listen(config.port, config.host, () => {
    log.info(`Server listening on http://${config.host}:${config.port}`);
    log.info('Ready to receive telemetry events');
    log.info(`WebSocket partner endpoint: ws://${config.host}:${config.port}/partner`);

    // Log available endpoints for reference
    console.log('\n' + '-'.repeat(50));
    console.log('Available Endpoints:');
    console.log('  POST /api/events       - Receive telemetry');
    console.log('  GET  /api/events       - Query events');
    console.log('  GET  /api/events/stats - Get statistics');
    console.log('  POST /api/analyze      - Run AI analysis');
    console.log('  GET  /api/references   - Shared recommendations');
    console.log('  GET  /api/export       - Download events');
    console.log('  GET  /integrations     - Telemetry client scripts');
    console.log('  GET  /health           - Health check');
    console.log('  WS   /partner          - SCC UI WebSocket');
    console.log('-'.repeat(50) + '\n');

    // Step 4b: Connect to Claude Team hub (optional)
    if (process.env.CLAUDE_TEAM_ENABLED !== 'false') {
      try {
        claudeTeamClient.connectToHub();
        log.info('Claude Team hub connection initiated');
      } catch (err) {
        log.warn('Claude Team hub connection failed (non-fatal):', err.message);
      }
    }
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
