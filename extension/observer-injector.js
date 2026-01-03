/**
 * =============================================================================
 * OBSERVER-INJECTOR.JS - Telemetry Receiver
 * =============================================================================
 *
 * Listens for OBSERVER_TELEMETRY events from any medical application
 * and forwards them to the background service worker for storage/analysis.
 *
 * This is a passive listener - it never modifies the host application.
 * =============================================================================
 */

(function() {
  'use strict';

  const OBSERVER_VERSION = '0.1.0';

  // Logging utility
  const Logger = {
    _log: (level, emoji, msg, data) => {
      const time = new Date().toLocaleTimeString('en-US', { hour12: false });
      const prefix = `[Mirror Observer ${time}]`;
      const styles = {
        info: "color: #8b5cf6; font-weight: bold;",
        success: "color: #10b981; font-weight: bold;",
        warn: "color: #f59e0b; font-weight: bold;",
        event: "color: #06b6d4; font-weight: bold;"
      };
      const style = styles[level] || styles.info;
      data ? console.log(`%c${prefix} ${emoji} ${msg}`, style, data)
           : console.log(`%c${prefix} ${emoji} ${msg}`, style);
    },
    info: (msg, data) => Logger._log('info', 'ℹ️', msg, data),
    success: (msg, data) => Logger._log('success', '✅', msg, data),
    warn: (msg, data) => Logger._log('warn', '⚠️', msg, data),
    event: (msg, data) => Logger._log('event', '📡', msg, data)
  };

  // Statistics
  const stats = {
    eventsReceived: 0,
    eventsForwarded: 0,
    errors: 0,
    sources: new Set()
  };

  // Check if extension context is valid
  function isContextValid() {
    try {
      return chrome.runtime?.id != null;
    } catch (e) {
      return false;
    }
  }

  // Forward event to background
  function forwardToBackground(event) {
    if (!isContextValid()) {
      Logger.warn('Extension context invalidated');
      return;
    }

    try {
      chrome.runtime.sendMessage({
        type: 'TELEMETRY_EVENT',
        payload: event,
        receivedAt: new Date().toISOString(),
        pageUrl: window.location.href
      }, (response) => {
        if (chrome.runtime.lastError) {
          stats.errors++;
          Logger.warn('Forward failed:', chrome.runtime.lastError.message);
        } else {
          stats.eventsForwarded++;
        }
      });
    } catch (e) {
      stats.errors++;
    }
  }

  Logger.info('═'.repeat(40));
  Logger.info(`Observer v${OBSERVER_VERSION} initializing...`);
  Logger.info('Listening for: OBSERVER_TELEMETRY');
  Logger.info('═'.repeat(40));

  // Main event listener
  window.addEventListener('message', function(event) {
    // Only accept messages from same window
    if (event.source !== window) return;

    // Listen for telemetry events
    if (event.data?.type === 'OBSERVER_TELEMETRY') {
      stats.eventsReceived++;

      const source = event.data.source || 'unknown';
      stats.sources.add(source);

      Logger.event('TELEMETRY', {
        source: source,
        stage: event.data.event?.stage,
        action: event.data.event?.action,
        success: event.data.event?.success
      });

      // Forward to background for storage
      forwardToBackground(event.data);
    }
  });

  // Expose stats for debugging
  window.__mirrorObserverStats = () => {
    console.table({
      eventsReceived: stats.eventsReceived,
      eventsForwarded: stats.eventsForwarded,
      errors: stats.errors,
      sources: Array.from(stats.sources).join(', ')
    });
    return stats;
  };

  Logger.success('Observer listening');

  // Periodic stats (every 2 minutes)
  setInterval(() => {
    if (stats.eventsReceived > 0) {
      Logger.info('STATS', {
        received: stats.eventsReceived,
        forwarded: stats.eventsForwarded,
        sources: Array.from(stats.sources)
      });
    }
  }, 120000);

})();
