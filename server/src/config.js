/**
 * =============================================================================
 * CONFIG.JS - Server Configuration
 * =============================================================================
 *
 * Central configuration for the Medical Mirror Observer backend server.
 * All settings are loaded from environment variables with sensible defaults.
 *
 * Environment Variables:
 *   SERVER:
 *     - PORT: HTTP port (default: 3000)
 *     - HOST: Host to bind to (default: localhost)
 *     - NODE_ENV: Environment mode (development/production)
 *
 *   STORAGE:
 *     - DATA_DIR: Base directory for data files (default: ./data)
 *     - RETENTION_DAYS: Days to keep event files (default: 30)
 *     - MAX_FILE_SIZE_MB: Max size per event file (default: 50)
 *     - MAX_EVENTS: Max events to store total (default: 10000)
 *
 *   AI PROVIDERS (at least one required for analysis):
 *     - ANTHROPIC_API_KEY: Claude API key (https://console.anthropic.com/)
 *     - GOOGLE_AI_API_KEY: Gemini API key (https://aistudio.google.com/apikey)
 *     - OPENAI_API_KEY: OpenAI API key (https://platform.openai.com/api-keys)
 *
 * Usage:
 *   1. Copy .env.example to .env in the server directory
 *   2. Fill in your API keys and adjust settings as needed
 *   3. The server will load these automatically on startup
 *
 * =============================================================================
 */

// Load environment variables from .env file
import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get the directory path for this module (needed for ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Main configuration object
 * All values are loaded from environment variables with fallback defaults
 */
export const config = {
  // ---------------------------------------------------------------------------
  // SERVER CONFIGURATION
  // ---------------------------------------------------------------------------
  // Port number for the HTTP server
  port: parseInt(process.env.PORT || '3000'),

  // Host to bind the server to (0.0.0.0 allows external/Tailscale access)
  host: process.env.HOST || '0.0.0.0',

  // Environment mode: 'development' or 'production'
  // Development mode shows more detailed error messages
  nodeEnv: process.env.NODE_ENV || 'development',

  // ---------------------------------------------------------------------------
  // STORAGE CONFIGURATION
  // ---------------------------------------------------------------------------
  storage: {
    // Base directory for all data files
    // Default: ./data (relative to server directory)
    dataDir: process.env.DATA_DIR || join(__dirname, '..', 'data'),

    // Subdirectory names (these are fixed, not configurable)
    eventsDir: 'events',       // Stores daily event JSON files
    analysisDir: 'analysis',   // Stores AI analysis results
    exportsDir: 'exports',     // Stores generated export files

    // How many days to keep event files before auto-deletion
    // Set to 0 to disable automatic cleanup
    retentionDays: parseInt(process.env.RETENTION_DAYS || '30'),

    // Maximum size (MB) for a single day's event file
    // When exceeded, creates a new file with suffix (e.g., 2024-01-15-1.json)
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB || '50'),

    // Maximum total events to store across all files
    // Oldest events are removed when this limit is reached
    maxEvents: parseInt(process.env.MAX_EVENTS || '10000')
  },

  // ---------------------------------------------------------------------------
  // AI PROVIDER CONFIGURATION
  // ---------------------------------------------------------------------------
  ai: {
    // Anthropic (Claude) - https://console.anthropic.com/
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      // Model to use for analysis (can be overridden per-request)
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514'
    },

    // Google (Gemini) - https://aistudio.google.com/apikey
    google: {
      apiKey: process.env.GOOGLE_AI_API_KEY,
      model: process.env.GOOGLE_AI_MODEL || 'gemini-1.5-flash'
    },

    // OpenAI (GPT) - https://platform.openai.com/api-keys
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
    }
  },

  // ---------------------------------------------------------------------------
  // CORS CONFIGURATION
  // ---------------------------------------------------------------------------
  // Cross-Origin Resource Sharing settings for the Chrome extension and network access
  cors: {
    // Allowed origins (regex patterns)
    origin: [
      /^chrome-extension:\/\//,        // Allow any Chrome extension
      /^http:\/\/localhost(:\d+)?$/,   // Allow localhost on any port
      /^http:\/\/127\.0\.0\.1(:\d+)?$/,// Allow 127.0.0.1 on any port
      /^http:\/\/100\.\d+\.\d+\.\d+(:\d+)?$/,  // Allow Tailscale IPs (100.x.x.x)
      /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/,  // Allow local network (192.168.x.x)
      /^http:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/    // Allow local network (10.x.x.x)
    ],
    // Allow cookies/auth headers to be sent
    credentials: true
  }
};

/**
 * Validate configuration and return warnings for missing settings
 *
 * Called on server startup to warn about unconfigured AI providers.
 * The server will still start without AI keys, but analysis won't work.
 *
 * @returns {string[]} Array of warning messages (empty if all configured)
 */
export function validateConfig() {
  const warnings = [];

  // Check each AI provider and warn if API key is missing
  if (!config.ai.anthropic.apiKey) {
    warnings.push('ANTHROPIC_API_KEY not set - Claude analysis unavailable');
  }
  if (!config.ai.google.apiKey) {
    warnings.push('GOOGLE_AI_API_KEY not set - Gemini analysis unavailable');
  }
  if (!config.ai.openai.apiKey) {
    warnings.push('OPENAI_API_KEY not set - OpenAI analysis unavailable');
  }

  return warnings;
}
