/**
 * Extension Configuration
 * Configure the backend server connection settings here.
 */

export const CONFIG = {
  // Backend server URL
  SERVER_URL: 'http://localhost:3000',

  // API endpoints
  ENDPOINTS: {
    EVENTS: '/api/events',
    STATUS: '/api/events/stats'
  },

  // HTTP settings
  HTTP: {
    TIMEOUT_MS: 5000,
    RETRY_ATTEMPTS: 2,
    RETRY_DELAY_MS: 1000
  },

  // Fallback behavior
  USE_INDEXEDDB_FALLBACK: true,

  // Server connection tracking
  serverAvailable: null,  // null = unknown, true/false = status
  lastServerCheck: null
};

// Check if server is available
export async function checkServerHealth() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.HTTP.TIMEOUT_MS);

    const response = await fetch(`${CONFIG.SERVER_URL}/health`, {
      method: 'GET',
      signal: controller.signal
    });

    clearTimeout(timeout);
    CONFIG.serverAvailable = response.ok;
    CONFIG.lastServerCheck = Date.now();
    return response.ok;
  } catch (e) {
    CONFIG.serverAvailable = false;
    CONFIG.lastServerCheck = Date.now();
    return false;
  }
}
