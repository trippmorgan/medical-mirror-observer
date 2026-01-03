/**
 * =============================================================================
 * BACKGROUND.JS - Observer Service Worker
 * =============================================================================
 *
 * Receives telemetry events from observer-injector.js and:
 * 1. Stores them in IndexedDB for persistence
 * 2. Analyzes patterns for anomalies
 * 3. Updates badge with pipeline health status
 * 4. Exposes data to dashboard
 * =============================================================================
 */

const OBSERVER_VERSION = '0.1.0';
const DB_NAME = 'MirrorObserverDB';
const DB_VERSION = 1;
const MAX_EVENTS = 10000;  // Keep last N events

// State
let db = null;
let eventCount = 0;
let errorCount = 0;
let lastEventTime = null;
let sourcesObserved = new Set();

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
  event: (msg, data) => Logger._log('event', '📡', msg, data)
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

// Store event
async function storeEvent(telemetry) {
  if (!db) {
    Logger.warn('DB not ready, event dropped');
    return;
  }

  const event = {
    ...telemetry,
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    storedAt: new Date().toISOString()
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['events'], 'readwrite');
    const store = tx.objectStore('events');
    store.add(event);
    tx.oncomplete = () => {
      eventCount++;
      lastEventTime = new Date();
      if (telemetry.source) sourcesObserved.add(telemetry.source);
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

// Get recent events
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
  const text = eventCount > 999 ? '999+' : eventCount.toString();
  const color = errorCount > 0 ? '#ef4444' : '#10b981';

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

    // Store event
    storeEvent(message.payload)
      .then(() => {
        updateBadge();
        sendResponse({ stored: true, total: eventCount });
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
      sources: Array.from(sourcesObserved)
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

initDB()
  .then(() => {
    Logger.success('Observer ready');
    updateBadge();
  })
  .catch((e) => {
    Logger.error('Initialization failed', e);
  });

Logger.info('═'.repeat(40));
