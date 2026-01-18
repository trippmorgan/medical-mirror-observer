/**
 * =============================================================================
 * PARTNER-BROADCAST.JS - WebSocket broadcast to SCC UI partners
 * =============================================================================
 *
 * Manages WebSocket connections from SCC UI and broadcasts events to them.
 * This module is separate to avoid circular dependencies.
 *
 * =============================================================================
 */

import { Logger } from '../utils/logger.js';

const log = Logger('PartnerWS');

// Connected partner clients (SCC UI instances)
const partnerClients = new Set();

/**
 * Add a partner client connection
 */
export function addPartnerClient(ws) {
  partnerClients.add(ws);
  log.info(`Partner connected (${partnerClients.size} total)`);
}

/**
 * Remove a partner client connection
 */
export function removePartnerClient(ws) {
  partnerClients.delete(ws);
  log.info(`Partner disconnected (${partnerClients.size} total)`);
}

/**
 * Get count of connected partners
 */
export function getPartnerCount() {
  return partnerClients.size;
}

/**
 * Broadcast event to all connected partner clients (SCC UI)
 */
export function broadcastToPartners(event) {
  if (partnerClients.size === 0) return;

  const message = JSON.stringify({
    type: 'event',
    payload: event,
    timestamp: new Date().toISOString()
  });

  let sent = 0;
  partnerClients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(message);
        sent++;
      } catch (err) {
        log.error('Send error:', err.message);
      }
    }
  });

  if (sent > 0) {
    log.debug(`Broadcast to ${sent} partner(s): ${event.type || 'event'}`);
  }
}

export default {
  addPartnerClient,
  removePartnerClient,
  getPartnerCount,
  broadcastToPartners
};
