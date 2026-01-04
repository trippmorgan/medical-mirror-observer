/**
 * =============================================================================
 * LOGGER.JS - Centralized Logging Utility
 * =============================================================================
 *
 * Provides consistent, color-coded logging across all server modules.
 *
 * Log Levels:
 *   - DEBUG: Detailed information for debugging (only in development)
 *   - INFO:  General operational information
 *   - WARN:  Warning conditions that should be noted
 *   - ERROR: Error conditions that need attention
 *
 * Usage:
 *   import { Logger } from './utils/logger.js';
 *   const log = Logger('ModuleName');
 *   log.info('Server started');
 *   log.error('Connection failed', { host: 'localhost', port: 3000 });
 *
 * =============================================================================
 */

import { config } from '../config.js';

// ANSI color codes for terminal output
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m'
};

// Log level configuration
const LOG_LEVELS = {
  debug: { priority: 0, color: COLORS.gray, label: 'DEBUG' },
  info: { priority: 1, color: COLORS.cyan, label: 'INFO ' },
  warn: { priority: 2, color: COLORS.yellow, label: 'WARN ' },
  error: { priority: 3, color: COLORS.red, label: 'ERROR' },
  insight: { priority: 2, color: COLORS.green, label: 'INSIGHT' },
  action: { priority: 2, color: COLORS.magenta, label: 'ACTION' }
};

// Current log level from environment (default: info in production, debug in development)
const currentLevel = process.env.LOG_LEVEL || (config.nodeEnv === 'production' ? 'info' : 'debug');
const currentPriority = LOG_LEVELS[currentLevel]?.priority ?? 1;

/**
 * Format timestamp for log output
 * @returns {string} Formatted timestamp [HH:MM:SS.mmm]
 */
function getTimestamp() {
  const now = new Date();
  return now.toISOString().substr(11, 12); // HH:MM:SS.mmm
}

/**
 * Format data object for logging
 * @param {any} data - Data to format
 * @returns {string} Formatted string representation
 */
function formatData(data) {
  if (data === undefined) return '';
  if (data instanceof Error) {
    return `\n${COLORS.red}${data.stack || data.message}${COLORS.reset}`;
  }
  if (typeof data === 'object') {
    try {
      return `\n${COLORS.gray}${JSON.stringify(data, null, 2)}${COLORS.reset}`;
    } catch {
      return `\n${COLORS.gray}[Object]${COLORS.reset}`;
    }
  }
  return ` ${COLORS.gray}${data}${COLORS.reset}`;
}

/**
 * Create a logger instance for a specific module
 *
 * @param {string} moduleName - Name of the module (shown in log prefix)
 * @returns {Object} Logger instance with debug, info, warn, error methods
 *
 * @example
 * const log = Logger('Events');
 * log.info('Processing event', { eventId: '123' });
 * // Output: [12:34:56.789] [INFO ] [Events] Processing event
 * //         { "eventId": "123" }
 */
export function Logger(moduleName) {
  /**
   * Internal log function
   * @param {string} level - Log level (debug, info, warn, error)
   * @param {string} message - Log message
   * @param {any} data - Optional data to log
   */
  const log = (level, message, data) => {
    const levelConfig = LOG_LEVELS[level];

    // Skip if below current log level
    if (levelConfig.priority < currentPriority) return;

    const timestamp = getTimestamp();
    const prefix = `${COLORS.gray}[${timestamp}]${COLORS.reset} ` +
                   `${levelConfig.color}[${levelConfig.label}]${COLORS.reset} ` +
                   `${COLORS.bright}[${moduleName}]${COLORS.reset}`;

    const formattedData = formatData(data);
    console.log(`${prefix} ${message}${formattedData}`);
  };

  return {
    /**
     * Debug level - detailed information for troubleshooting
     * Only shown when LOG_LEVEL=debug or in development mode
     */
    debug: (message, data) => log('debug', message, data),

    /**
     * Info level - general operational messages
     * Default level for production
     */
    info: (message, data) => log('info', message, data),

    /**
     * Warn level - warning conditions that should be noted
     * Something unexpected but not necessarily an error
     */
    warn: (message, data) => log('warn', message, data),

    /**
     * Error level - error conditions requiring attention
     * Something went wrong that needs to be fixed
     */
    error: (message, data) => log('error', message, data),

    /**
     * Insight level - AI-generated insights and findings
     * Highlights important discoveries from analysis
     */
    insight: (message, data) => log('insight', message, data),

    /**
     * Action level - recommended actions for the user
     * Clearly indicates what the user should do
     */
    action: (message, data) => log('action', message, data)
  };
}

/**
 * Log a summary of recommendations (for visibility)
 *
 * @param {string} source - Application source name
 * @param {Array} recommendations - List of recommendations
 */
export function logRecommendationSummary(source, recommendations) {
  const timestamp = getTimestamp();
  const critical = recommendations.filter(r => r.priority === 'critical').length;
  const high = recommendations.filter(r => r.priority === 'high').length;
  const total = recommendations.length;

  console.log('\n' + '='.repeat(60));
  console.log(`${COLORS.bright}${COLORS.green} OBSERVER RECOMMENDATIONS: ${source}${COLORS.reset}`);
  console.log('='.repeat(60));

  if (critical > 0) {
    console.log(`${COLORS.red}  CRITICAL: ${critical} issue(s) require immediate attention${COLORS.reset}`);
  }
  if (high > 0) {
    console.log(`${COLORS.yellow}  HIGH:     ${high} issue(s) should be addressed soon${COLORS.reset}`);
  }
  console.log(`${COLORS.cyan}  TOTAL:    ${total} recommendation(s) generated${COLORS.reset}`);

  // Show top 3 issues with brief descriptions
  const topIssues = recommendations
    .sort((a, b) => {
      const priority = { critical: 0, high: 1, medium: 2, low: 3 };
      return (priority[a.priority] || 2) - (priority[b.priority] || 2);
    })
    .slice(0, 3);

  if (topIssues.length > 0) {
    console.log('\n  Top Issues:');
    topIssues.forEach((rec, i) => {
      const color = rec.priority === 'critical' ? COLORS.red :
                    rec.priority === 'high' ? COLORS.yellow : COLORS.cyan;
      console.log(`  ${color}${i + 1}. [${rec.priority?.toUpperCase()}] ${rec.title}${COLORS.reset}`);
    });
  }

  console.log('\n  View details: GET /api/references/' + source);
  console.log('='.repeat(60) + '\n');
}

/**
 * Log an HTTP request/response (used by middleware)
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {number} duration - Request duration in milliseconds
 */
export function logRequest(req, res, duration) {
  const statusColor = res.statusCode >= 400 ? COLORS.red :
                      res.statusCode >= 300 ? COLORS.yellow :
                      COLORS.green;

  const timestamp = getTimestamp();
  const method = req.method.padEnd(6);
  const path = req.path;
  const status = res.statusCode;
  const durationStr = `${duration}ms`.padStart(6);

  console.log(
    `${COLORS.gray}[${timestamp}]${COLORS.reset} ` +
    `${COLORS.magenta}[HTTP ]${COLORS.reset} ` +
    `${method} ${path} ` +
    `${statusColor}${status}${COLORS.reset} ` +
    `${COLORS.gray}${durationStr}${COLORS.reset}`
  );
}

export default Logger;
