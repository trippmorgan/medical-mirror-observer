/**
 * =============================================================================
 * BROWSER-BRIDGE-CLIENT.JS - WebSocket Client for MCP Browser Bridge
 * =============================================================================
 *
 * Connects Chrome extension to MCP Browser Bridge server.
 * Enables Claude Code to control the browser via MCP tools.
 *
 * Features:
 * - WebSocket connection to MCP server
 * - Browser automation commands (navigate, click, type, screenshot)
 * - DOM data extraction
 * - Athena EMR clinical data capture
 * - Auto-reconnect on disconnect
 *
 * =============================================================================
 */

const BRIDGE_CONFIG = {
  URL: 'ws://localhost:8080',
  RECONNECT_INTERVAL: 5000,
  MAX_RECONNECT_ATTEMPTS: 10
};

// State
let bridgeSocket = null;
let bridgeConnected = false;
let reconnectAttempts = 0;
let reconnectTimer = null;

// Logging
const BridgeLogger = {
  log: (msg, data) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    data ? console.log(`[Browser Bridge ${time}] ${msg}`, data)
         : console.log(`[Browser Bridge ${time}] ${msg}`);
  },
  error: (msg, data) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    data ? console.error(`[Browser Bridge ${time}] ❌ ${msg}`, data)
         : console.error(`[Browser Bridge ${time}] ❌ ${msg}`);
  }
};

// =============================================================================
// WEBSOCKET CONNECTION
// =============================================================================

function connectToBridge() {
  if (bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
    return;
  }

  BridgeLogger.log(`Connecting to MCP Bridge at ${BRIDGE_CONFIG.URL}...`);

  try {
    bridgeSocket = new WebSocket(BRIDGE_CONFIG.URL);

    bridgeSocket.onopen = () => {
      bridgeConnected = true;
      reconnectAttempts = 0;
      BridgeLogger.log('✅ Connected to MCP Browser Bridge');

      // Send initial registration
      sendToBridge({
        type: 'register',
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version
      });
    };

    bridgeSocket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        await handleBridgeCommand(message);
      } catch (err) {
        BridgeLogger.error('Failed to parse bridge message', err);
      }
    };

    bridgeSocket.onclose = () => {
      bridgeConnected = false;
      BridgeLogger.log('Disconnected from MCP Bridge');
      scheduleReconnect();
    };

    bridgeSocket.onerror = (err) => {
      BridgeLogger.error('Bridge connection error', err);
      bridgeConnected = false;
    };

  } catch (err) {
    BridgeLogger.error('Failed to connect to bridge', err);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  if (reconnectAttempts >= BRIDGE_CONFIG.MAX_RECONNECT_ATTEMPTS) {
    BridgeLogger.log('Max reconnect attempts reached, stopping');
    return;
  }

  reconnectAttempts++;
  const delay = BRIDGE_CONFIG.RECONNECT_INTERVAL * Math.min(reconnectAttempts, 5);

  BridgeLogger.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToBridge();
  }, delay);
}

function sendToBridge(message) {
  if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) {
    return false;
  }

  bridgeSocket.send(JSON.stringify(message));
  return true;
}

// =============================================================================
// COMMAND HANDLERS
// =============================================================================

async function handleBridgeCommand(message) {
  const { requestId, command, params } = message;

  BridgeLogger.log(`Command: ${command}`, params);

  try {
    let result;

    switch (command) {
      case 'navigate':
        result = await handleNavigate(params);
        break;

      case 'click':
        result = await handleClick(params);
        break;

      case 'type':
        result = await handleType(params);
        break;

      case 'screenshot':
        result = await handleScreenshot(params);
        break;

      case 'getPageData':
        result = await handleGetPageData(params);
        break;

      case 'athenaCapture':
        result = await handleAthenaCapture(params);
        break;

      case 'wait':
        result = await handleWait(params);
        break;

      case 'execute':
        result = await handleExecute(params);
        break;

      case 'getTabs':
        result = await handleGetTabs();
        break;

      default:
        throw new Error(`Unknown command: ${command}`);
    }

    // Send success response
    sendToBridge({
      requestId,
      type: 'response',
      data: result
    });

  } catch (err) {
    BridgeLogger.error(`Command failed: ${command}`, err);

    // Send error response
    sendToBridge({
      requestId,
      type: 'response',
      error: err.message
    });
  }
}

// =============================================================================
// BROWSER AUTOMATION HANDLERS
// =============================================================================

async function handleNavigate(params) {
  const { url, tabId, waitForLoad } = params;

  let targetTabId = tabId;

  if (!targetTabId) {
    // Get active tab or create new one
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      targetTabId = activeTab.id;
    } else {
      const newTab = await chrome.tabs.create({ url });
      return { tabId: newTab.id, url: newTab.url };
    }
  }

  await chrome.tabs.update(targetTabId, { url });

  if (waitForLoad) {
    // Wait for page to load
    await waitForTabLoad(targetTabId);
  }

  const tab = await chrome.tabs.get(targetTabId);
  return { tabId: tab.id, url: tab.url, title: tab.title };
}

async function handleClick(params) {
  const { selector, tabId, waitAfter } = params;

  const targetTabId = tabId || (await getActiveTabId());

  const result = await chrome.scripting.executeScript({
    target: { tabId: targetTabId },
    func: (sel, wait) => {
      const element = document.querySelector(sel);
      if (!element) {
        throw new Error(`Element not found: ${sel}`);
      }
      element.click();
      return { clicked: true, selector: sel };
    },
    args: [selector, waitAfter]
  });

  if (waitAfter) {
    await sleep(waitAfter);
  }

  return result[0]?.result;
}

async function handleType(params) {
  const { selector, text, tabId, clearFirst, pressEnter } = params;

  const targetTabId = tabId || (await getActiveTabId());

  const result = await chrome.scripting.executeScript({
    target: { tabId: targetTabId },
    func: (sel, txt, clear, enter) => {
      const element = document.querySelector(sel);
      if (!element) {
        throw new Error(`Element not found: ${sel}`);
      }

      element.focus();

      if (clear) {
        element.value = '';
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Type character by character for realistic simulation
      for (const char of txt) {
        element.value += char;
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }

      if (enter) {
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13 }));
        element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13 }));

        // Try to submit form if exists
        const form = element.closest('form');
        if (form) {
          form.dispatchEvent(new Event('submit', { bubbles: true }));
        }
      }

      return { typed: true, selector: sel, length: txt.length };
    },
    args: [selector, text, clearFirst, pressEnter]
  });

  return result[0]?.result;
}

async function handleScreenshot(params) {
  const { tabId, selector, fullPage } = params;

  const targetTabId = tabId || (await getActiveTabId());

  // Capture visible area
  const dataUrl = await chrome.tabs.captureVisibleTab(null, {
    format: 'png',
    quality: 100
  });

  return {
    screenshot: dataUrl,
    format: 'png',
    timestamp: new Date().toISOString()
  };
}

async function handleGetPageData(params) {
  const { tabId, dataTypes, selector } = params;

  const targetTabId = tabId || (await getActiveTabId());

  const result = await chrome.scripting.executeScript({
    target: { tabId: targetTabId },
    func: (types, sel) => {
      const data = {};

      if (types.includes('dom') || types.includes('all')) {
        if (sel) {
          const element = document.querySelector(sel);
          data.dom = element ? element.outerHTML : null;
        } else {
          data.dom = document.documentElement.outerHTML;
        }
      }

      if (types.includes('meta') || types.includes('all')) {
        data.meta = {
          url: window.location.href,
          title: document.title,
          description: document.querySelector('meta[name="description"]')?.content,
          canonical: document.querySelector('link[rel="canonical"]')?.href
        };
      }

      if (types.includes('console') || types.includes('all')) {
        data.console = window.__observerConsoleLogs || [];
      }

      if (types.includes('cookies') || types.includes('all')) {
        data.cookies = document.cookie;
      }

      if (types.includes('storage') || types.includes('all')) {
        try {
          data.localStorage = { ...localStorage };
          data.sessionStorage = { ...sessionStorage };
        } catch (e) {
          data.storageError = e.message;
        }
      }

      return data;
    },
    args: [dataTypes, selector]
  });

  return result[0]?.result;
}

async function handleAthenaCapture(params) {
  const { tabId, dataTypes, patientId } = params;

  const targetTabId = tabId || (await getActiveTabId());

  // Athena-specific capture script
  const result = await chrome.scripting.executeScript({
    target: { tabId: targetTabId },
    func: (types, expectedPatientId) => {
      const capturedData = {
        capturedAt: new Date().toISOString(),
        url: window.location.href,
        data: {}
      };

      // Check if we're on Athena
      const isAthena = window.location.hostname.includes('athena') ||
                       document.querySelector('[data-athena]') !== null ||
                       document.title.toLowerCase().includes('athena');

      capturedData.isAthena = isAthena;

      // Patient demographics
      if (types.includes('patient') || types.includes('all')) {
        capturedData.data.patient = {
          name: document.querySelector('[data-patient-name], .patient-name, #patientName')?.textContent?.trim(),
          mrn: document.querySelector('[data-mrn], .mrn, #mrn')?.textContent?.trim(),
          dob: document.querySelector('[data-dob], .dob, #dob')?.textContent?.trim(),
          gender: document.querySelector('[data-gender], .gender')?.textContent?.trim(),
          age: document.querySelector('[data-age], .age')?.textContent?.trim()
        };

        // Verify patient if ID provided
        if (expectedPatientId && capturedData.data.patient.mrn !== expectedPatientId) {
          capturedData.patientMismatch = true;
          capturedData.expectedPatientId = expectedPatientId;
        }
      }

      // Current encounter
      if (types.includes('encounter') || types.includes('all')) {
        capturedData.data.encounter = {
          type: document.querySelector('[data-encounter-type], .encounter-type')?.textContent?.trim(),
          date: document.querySelector('[data-encounter-date], .encounter-date')?.textContent?.trim(),
          provider: document.querySelector('[data-provider], .provider-name')?.textContent?.trim(),
          status: document.querySelector('[data-encounter-status], .encounter-status')?.textContent?.trim()
        };
      }

      // Medications
      if (types.includes('medications') || types.includes('all')) {
        const meds = [];
        document.querySelectorAll('[data-medication], .medication-row, .med-item').forEach(el => {
          meds.push({
            name: el.querySelector('.med-name, [data-med-name]')?.textContent?.trim(),
            dose: el.querySelector('.med-dose, [data-med-dose]')?.textContent?.trim(),
            frequency: el.querySelector('.med-frequency, [data-med-frequency]')?.textContent?.trim(),
            status: el.querySelector('.med-status, [data-med-status]')?.textContent?.trim()
          });
        });
        capturedData.data.medications = meds;
      }

      // Vitals
      if (types.includes('vitals') || types.includes('all')) {
        capturedData.data.vitals = {
          bp: document.querySelector('[data-bp], .vital-bp')?.textContent?.trim(),
          hr: document.querySelector('[data-hr], .vital-hr')?.textContent?.trim(),
          temp: document.querySelector('[data-temp], .vital-temp')?.textContent?.trim(),
          weight: document.querySelector('[data-weight], .vital-weight')?.textContent?.trim(),
          height: document.querySelector('[data-height], .vital-height')?.textContent?.trim(),
          bmi: document.querySelector('[data-bmi], .vital-bmi')?.textContent?.trim(),
          spo2: document.querySelector('[data-spo2], .vital-spo2')?.textContent?.trim()
        };
      }

      // Diagnoses/Problems
      if (types.includes('diagnoses') || types.includes('all')) {
        const diagnoses = [];
        document.querySelectorAll('[data-diagnosis], .diagnosis-row, .problem-item').forEach(el => {
          diagnoses.push({
            code: el.querySelector('.dx-code, [data-dx-code]')?.textContent?.trim(),
            description: el.querySelector('.dx-description, [data-dx-description]')?.textContent?.trim(),
            status: el.querySelector('.dx-status, [data-dx-status]')?.textContent?.trim()
          });
        });
        capturedData.data.diagnoses = diagnoses;
      }

      // Procedures
      if (types.includes('procedures') || types.includes('all')) {
        const procedures = [];
        document.querySelectorAll('[data-procedure], .procedure-row, .proc-item').forEach(el => {
          procedures.push({
            code: el.querySelector('.proc-code, [data-proc-code]')?.textContent?.trim(),
            description: el.querySelector('.proc-description, [data-proc-description]')?.textContent?.trim(),
            date: el.querySelector('.proc-date, [data-proc-date]')?.textContent?.trim()
          });
        });
        capturedData.data.procedures = procedures;
      }

      // Clinical notes
      if (types.includes('notes') || types.includes('all')) {
        const notes = [];
        document.querySelectorAll('[data-note], .clinical-note, .note-entry').forEach(el => {
          notes.push({
            type: el.querySelector('.note-type, [data-note-type]')?.textContent?.trim(),
            content: el.querySelector('.note-content, [data-note-content]')?.textContent?.trim(),
            author: el.querySelector('.note-author, [data-note-author]')?.textContent?.trim(),
            date: el.querySelector('.note-date, [data-note-date]')?.textContent?.trim()
          });
        });
        capturedData.data.notes = notes;
      }

      // Orders
      if (types.includes('orders') || types.includes('all')) {
        const orders = [];
        document.querySelectorAll('[data-order], .order-row, .order-item').forEach(el => {
          orders.push({
            type: el.querySelector('.order-type, [data-order-type]')?.textContent?.trim(),
            description: el.querySelector('.order-description, [data-order-description]')?.textContent?.trim(),
            status: el.querySelector('.order-status, [data-order-status]')?.textContent?.trim()
          });
        });
        capturedData.data.orders = orders;
      }

      return capturedData;
    },
    args: [dataTypes, patientId]
  });

  return result[0]?.result;
}

async function handleWait(params) {
  const { selector, tabId, timeout, condition } = params;

  const targetTabId = tabId || (await getActiveTabId());
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: (sel, cond) => {
        const element = document.querySelector(sel);

        switch (cond) {
          case 'exists':
            return element !== null;
          case 'visible':
            if (!element) return false;
            const style = window.getComputedStyle(element);
            return style.display !== 'none' &&
                   style.visibility !== 'hidden' &&
                   style.opacity !== '0';
          case 'hidden':
            if (!element) return true;
            const s = window.getComputedStyle(element);
            return s.display === 'none' ||
                   s.visibility === 'hidden' ||
                   s.opacity === '0';
          case 'removed':
            return element === null;
          default:
            return element !== null;
        }
      },
      args: [selector, condition]
    });

    if (result[0]?.result) {
      return { found: true, elapsed: Date.now() - startTime };
    }

    await sleep(100);
  }

  throw new Error(`Timeout waiting for ${selector} to be ${condition}`);
}

async function handleExecute(params) {
  const { script, tabId } = params;

  const targetTabId = tabId || (await getActiveTabId());

  const result = await chrome.scripting.executeScript({
    target: { tabId: targetTabId },
    func: new Function(script)
  });

  return result[0]?.result;
}

async function handleGetTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.map(tab => ({
    id: tab.id,
    url: tab.url,
    title: tab.title,
    active: tab.active,
    windowId: tab.windowId
  }));
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error('No active tab found');
  }
  return tab.id;
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// EXPORTS FOR BACKGROUND.JS
// =============================================================================

// Start connection on load
if (typeof window !== 'undefined' || typeof self !== 'undefined') {
  // Running in service worker context
  connectToBridge();
}

// Export functions for use in background.js
const BrowserBridge = {
  connect: connectToBridge,
  isConnected: () => bridgeConnected,
  send: sendToBridge,
  getStatus: () => ({
    connected: bridgeConnected,
    url: BRIDGE_CONFIG.URL,
    reconnectAttempts
  })
};

// Make available globally
if (typeof self !== 'undefined') {
  self.BrowserBridge = BrowserBridge;
}
