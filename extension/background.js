/**
 * =============================================================================
 * BACKGROUND.JS - Observer Service Worker
 * =============================================================================
 *
 * Receives telemetry events from observer-injector.js and:
 * 1. Forwards them to the backend server (primary)
 * 2. Falls back to IndexedDB when server unavailable
 * 3. Updates badge with pipeline health status
 * 4. Exposes data to dashboard
 * =============================================================================
 */

const OBSERVER_VERSION = '0.1.0';
const DB_NAME = 'MirrorObserverDB';
const DB_VERSION = 1;
const MAX_EVENTS = 10000;  // Keep last N events

// Server configuration (inline to avoid import issues in service worker)
const SERVER_CONFIG = {
  URL: 'http://localhost:3000',
  ENDPOINTS: {
    EVENTS: '/api/events',
    STATS: '/api/events/stats'
  },
  TIMEOUT_MS: 5000,
  RETRY_ATTEMPTS: 2,
  RETRY_DELAY_MS: 1000,
  USE_INDEXEDDB_FALLBACK: true
};

// State
let db = null;
let eventCount = 0;
let errorCount = 0;
let lastEventTime = null;
let sourcesObserved = new Set();
let serverAvailable = null;  // null = unknown, true/false = checked
let serverEventCount = 0;    // Events successfully sent to server

// Logging
const Logger = {
  _log: (level, emoji, msg, data) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    const prefix = `[Mirror Observer BG ${time}]`;
    data ? console.log(`${prefix} ${emoji} ${msg}`, data)
         : console.log(`${prefix} ${emoji} ${msg}`);
  },
  info: (msg, data) => Logger._log('info', 'ℹ️', msg, data),
  success: (msg, data) => Logger._log('success', '✅', msg, data),
  warn: (msg, data) => Logger._log('warn', '⚠️', msg, data),
  error: (msg, data) => Logger._log('error', '❌', msg, data),
  event: (msg, data) => Logger._log('event', '📡', msg, data),
  server: (msg, data) => Logger._log('server', '🌐', msg, data)
};

// Initialize IndexedDB
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      Logger.error('IndexedDB failed to open');
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      Logger.success('IndexedDB connected');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Events store
      if (!database.objectStoreNames.contains('events')) {
        const eventStore = database.createObjectStore('events', {
          keyPath: 'id',
          autoIncrement: true
        });
        eventStore.createIndex('timestamp', 'timestamp', { unique: false });
        eventStore.createIndex('source', 'source', { unique: false });
        eventStore.createIndex('stage', 'event.stage', { unique: false });
        eventStore.createIndex('success', 'event.success', { unique: false });
      }

      // Summaries store (for quick stats)
      if (!database.objectStoreNames.contains('summaries')) {
        database.createObjectStore('summaries', { keyPath: 'id' });
      }

      Logger.info('IndexedDB schema created');
    };
  });
}

// Check if server is available
async function checkServerHealth() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SERVER_CONFIG.TIMEOUT_MS);

    const response = await fetch(`${SERVER_CONFIG.URL}/health`, {
      method: 'GET',
      signal: controller.signal
    });

    clearTimeout(timeout);
    serverAvailable = response.ok;
    if (response.ok) {
      Logger.server('Server connected');
    }
    return response.ok;
  } catch (e) {
    serverAvailable = false;
    return false;
  }
}

// Forward event to server
async function forwardToServer(telemetry) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SERVER_CONFIG.TIMEOUT_MS);

    const response = await fetch(`${SERVER_CONFIG.URL}${SERVER_CONFIG.ENDPOINTS.EVENTS}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(telemetry),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const result = await response.json();
    serverAvailable = true;
    serverEventCount++;
    return { success: true, data: result };
  } catch (error) {
    serverAvailable = false;
    Logger.warn('Server forwarding failed', error.message);
    return { success: false, error: error.message };
  }
}

// Store event in IndexedDB (fallback)
async function storeInIndexedDB(telemetry) {
  if (!db) {
    Logger.warn('DB not ready, event dropped');
    return { success: false, error: 'DB not ready' };
  }

  const event = {
    ...telemetry,
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    storedAt: new Date().toISOString(),
    storedLocally: true  // Mark as stored locally (not sent to server)
  };

  return new Promise((resolve) => {
    const tx = db.transaction(['events'], 'readwrite');
    const store = tx.objectStore('events');
    store.add(event);
    tx.oncomplete = () => {
      resolve({ success: true, method: 'indexeddb' });
    };
    tx.onerror = () => {
      resolve({ success: false, error: tx.error?.message });
    };
  });
}

// Main event storage function - tries server first, falls back to IndexedDB
async function storeEvent(telemetry) {
  // Try server first
  const serverResult = await forwardToServer(telemetry);

  if (serverResult.success) {
    // Update local stats even when server stores
    eventCount++;
    lastEventTime = new Date();
    if (telemetry.source) sourcesObserved.add(telemetry.source);
    return { stored: true, method: 'server', ...serverResult.data };
  }

  // Fallback to IndexedDB if enabled
  if (SERVER_CONFIG.USE_INDEXEDDB_FALLBACK) {
    const localResult = await storeInIndexedDB(telemetry);
    if (localResult.success) {
      eventCount++;
      lastEventTime = new Date();
      if (telemetry.source) sourcesObserved.add(telemetry.source);
      return { stored: true, method: 'indexeddb' };
    }
    return { stored: false, error: localResult.error };
  }

  return { stored: false, error: 'Server unavailable, fallback disabled' };
}

// Get recent events from IndexedDB
async function getRecentEvents(limit = 100) {
  if (!db) return [];

  return new Promise((resolve) => {
    const tx = db.transaction(['events'], 'readonly');
    const store = tx.objectStore('events');
    const index = store.index('timestamp');
    const request = index.openCursor(null, 'prev');
    const events = [];

    request.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor && events.length < limit) {
        events.push(cursor.value);
        cursor.continue();
      } else {
        resolve(events);
      }
    };
  });
}

// Update badge
function updateBadge() {
  const count = eventCount;
  const text = count > 999 ? '999+' : count.toString();
  const color = errorCount > 0 ? '#ef4444' : (serverAvailable ? '#10b981' : '#f59e0b');

  chrome.action.setBadgeText({ text: text || '0' });
  chrome.action.setBadgeBackgroundColor({ color });
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Telemetry event from content script
  if (message.type === 'TELEMETRY_EVENT') {
    Logger.event('EVENT', {
      source: message.payload?.source,
      stage: message.payload?.event?.stage,
      action: message.payload?.event?.action
    });

    // Check for errors
    if (message.payload?.event?.success === false) {
      errorCount++;
    }

    // Store event (server first, then IndexedDB fallback)
    storeEvent(message.payload)
      .then((result) => {
        updateBadge();
        sendResponse({ ...result, total: eventCount });
      })
      .catch((e) => {
        Logger.error('Store failed', e);
        sendResponse({ stored: false, error: e.message });
      });

    return true; // Keep channel open for async response
  }

  // Status request (from popup/dashboard)
  if (message.type === 'GET_OBSERVER_STATUS') {
    sendResponse({
      version: OBSERVER_VERSION,
      eventCount,
      errorCount,
      lastEventTime: lastEventTime?.toISOString(),
      sources: Array.from(sourcesObserved),
      serverAvailable,
      serverEventCount
    });
  }

  // Get recent events (from popup/dashboard)
  if (message.type === 'GET_RECENT_EVENTS') {
    getRecentEvents(message.limit || 100)
      .then(events => sendResponse({ events }))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  // Clear events
  if (message.type === 'CLEAR_EVENTS') {
    if (db) {
      const tx = db.transaction(['events'], 'readwrite');
      tx.objectStore('events').clear();
      tx.oncomplete = () => {
        eventCount = 0;
        errorCount = 0;
        serverEventCount = 0;
        updateBadge();
        sendResponse({ cleared: true });
      };
    }
    return true;
  }

  return true;
});

// Initialize
Logger.info('═'.repeat(40));
Logger.info(`Medical Mirror Observer v${OBSERVER_VERSION}`);
Logger.info('Service worker starting...');

// Check server connectivity
checkServerHealth().then(available => {
  if (available) {
    Logger.server(`Connected to ${SERVER_CONFIG.URL}`);
  } else {
    Logger.warn(`Server not available at ${SERVER_CONFIG.URL}`);
    Logger.info('Events will be stored locally in IndexedDB');
  }
});

initDB()
  .then(() => {
    Logger.success('Observer ready');
    updateBadge();
  })
  .catch((e) => {
    Logger.error('Initialization failed', e);
  });

Logger.info('═'.repeat(40));
