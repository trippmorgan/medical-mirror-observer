/**
 * =============================================================================
 * CLAUDE-TEAM-CLIENT.JS - WebSocket Client for Claude Team Hub
 * =============================================================================
 *
 * Connects Medical Mirror Observer to the Claude Team coordination hub.
 * Enables real-time telemetry sharing and task delegation between projects.
 *
 * Hub: ws://localhost:4847 (claude-team)
 * This client: medical-mirror-observer
 *
 * =============================================================================
 */

import { Logger } from '../utils/logger.js';
import WebSocket from 'ws';

const log = Logger('ClaudeTeam');

// Configuration
const HUB_URL = process.env.CLAUDE_TEAM_HUB_URL || 'ws://localhost:4847';
const RECONNECT_INTERVAL = 5000;
const WINDOW_NAME = 'medical-mirror-observer';

let ws = null;
let isConnected = false;
let reconnectTimer = null;

// =============================================================================
// CONNECTION MANAGEMENT
// =============================================================================

/**
 * Connect to the Claude Team hub
 */
export function connectToHub() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    log.debug('Already connected or connecting to hub');
    return;
  }

  log.info(`Connecting to Claude Team hub at ${HUB_URL}...`);

  try {
    ws = new WebSocket(HUB_URL);

    ws.on('open', () => {
      isConnected = true;
      log.info('Connected to Claude Team hub');

      // Register with the hub
      sendMessage({
        type: 'register',
        windowName: WINDOW_NAME,
        projectPath: process.cwd(),
        capabilities: ['telemetry', 'analysis', 'recommendations']
      });
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleMessage(message);
      } catch (err) {
        log.error('Failed to parse hub message:', err.message);
      }
    });

    ws.on('close', () => {
      isConnected = false;
      log.warn('Disconnected from Claude Team hub');
      scheduleReconnect();
    });

    ws.on('error', (err) => {
      log.error('Hub connection error:', err.message);
      isConnected = false;
    });

  } catch (err) {
    log.error('Failed to connect to hub:', err.message);
    scheduleReconnect();
  }
}

/**
 * Schedule a reconnection attempt
 */
function scheduleReconnect() {
  if (reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToHub();
  }, RECONNECT_INTERVAL);
}

/**
 * Disconnect from the hub
 */
export function disconnectFromHub() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws) {
    ws.close();
    ws = null;
  }

  isConnected = false;
  log.info('Disconnected from Claude Team hub');
}

// =============================================================================
// MESSAGE HANDLING
// =============================================================================

/**
 * Handle incoming messages from the hub
 */
function handleMessage(message) {
  log.debug('Received from hub:', message.type);

  switch (message.type) {
    case 'query':
      handleQuery(message);
      break;

    case 'task':
      handleTask(message);
      break;

    case 'broadcast':
      log.info(`[Broadcast from ${message.fromWindow}] ${message.content}`);
      break;

    case 'status_request':
      sendStatus();
      break;

    default:
      log.debug('Unknown message type:', message.type);
  }
}

/**
 * Handle query requests from other Claude instances
 */
async function handleQuery(message) {
  const { queryId, query, fromWindow } = message;

  log.info(`Query from ${fromWindow}: ${query}`);

  // Process common queries
  let response = { queryId, fromWindow: WINDOW_NAME };

  if (query.includes('health') || query.includes('status')) {
    response.result = await getHealthStatus();
  } else if (query.includes('events') || query.includes('telemetry')) {
    response.result = await getRecentEvents();
  } else if (query.includes('recommendations') || query.includes('references')) {
    response.result = await getRecommendations();
  } else {
    response.result = {
      message: 'Query received. Available queries: health, events, recommendations',
      apis: [
        'GET /api/events - Query events',
        'GET /api/events/stats - Statistics',
        'POST /api/analyze - Run AI analysis',
        'GET /api/references - Get recommendations'
      ]
    };
  }

  sendMessage({ type: 'response', ...response });
}

/**
 * Handle task delegation from claude-team
 */
async function handleTask(message) {
  const { taskId, taskType, params, fromWindow } = message;

  log.info(`Task from ${fromWindow}: ${taskType}`);

  let result = { taskId, fromWindow: WINDOW_NAME, status: 'completed' };

  try {
    switch (taskType) {
      case 'analyze':
        // Import analyzer dynamically to avoid circular deps
        const { analyzeEvents } = await import('../ai/analyzer.js');
        result.data = await analyzeEvents(params || {});
        break;

      case 'getEvents':
        result.data = await getRecentEvents(params?.limit || 50);
        break;

      case 'getRecommendations':
        result.data = await getRecommendations(params?.source);
        break;

      default:
        result.status = 'error';
        result.error = `Unknown task type: ${taskType}`;
    }
  } catch (err) {
    result.status = 'error';
    result.error = err.message;
  }

  sendMessage({ type: 'task_result', ...result });
}

// =============================================================================
// DATA HELPERS
// =============================================================================

async function getHealthStatus() {
  try {
    const response = await fetch('http://localhost:3000/health');
    return await response.json();
  } catch {
    return { status: 'unknown', error: 'Could not fetch health' };
  }
}

async function getRecentEvents(limit = 20) {
  try {
    const response = await fetch(`http://localhost:3000/api/events?limit=${limit}`);
    return await response.json();
  } catch {
    return { events: [], error: 'Could not fetch events' };
  }
}

async function getRecommendations(source = null) {
  try {
    const url = source
      ? `http://localhost:3000/api/references/${source}`
      : 'http://localhost:3000/api/references';
    const response = await fetch(url);
    return await response.json();
  } catch {
    return { recommendations: [], error: 'Could not fetch recommendations' };
  }
}

// =============================================================================
// OUTBOUND MESSAGES
// =============================================================================

/**
 * Send a message to the hub
 */
export function sendMessage(message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    log.warn('Cannot send message - not connected to hub');
    return false;
  }

  try {
    ws.send(JSON.stringify({
      ...message,
      fromWindow: WINDOW_NAME,
      timestamp: Date.now()
    }));
    return true;
  } catch (err) {
    log.error('Failed to send message:', err.message);
    return false;
  }
}

/**
 * Broadcast a message to all connected windows
 */
export function broadcast(content, category = 'update') {
  return sendMessage({
    type: 'broadcast',
    content,
    category
  });
}

/**
 * Send current status to the hub
 */
function sendStatus() {
  sendMessage({
    type: 'status',
    status: {
      project: WINDOW_NAME,
      connected: isConnected,
      serverPort: 3000,
      dashboardPort: 5173,
      capabilities: ['telemetry', 'analysis', 'recommendations']
    }
  });
}

/**
 * Share telemetry event with the hub
 */
export function shareTelemetryEvent(event) {
  return sendMessage({
    type: 'telemetry',
    event
  });
}

/**
 * Request analysis task delegation
 */
export function requestAnalysis(params) {
  return sendMessage({
    type: 'task_request',
    taskType: 'analyze',
    params
  });
}

// =============================================================================
// STATUS
// =============================================================================

export function isHubConnected() {
  return isConnected;
}

export function getConnectionStatus() {
  return {
    connected: isConnected,
    hubUrl: HUB_URL,
    windowName: WINDOW_NAME
  };
}

// Export for use in server
export default {
  connectToHub,
  disconnectFromHub,
  sendMessage,
  broadcast,
  shareTelemetryEvent,
  requestAnalysis,
  isHubConnected,
  getConnectionStatus
};
