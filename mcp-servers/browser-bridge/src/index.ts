#!/usr/bin/env node
/**
 * =============================================================================
 * MCP BROWSER BRIDGE SERVER
 * =============================================================================
 *
 * Bridges Claude Code to Chrome extension for browser automation.
 * Enables AI-driven browser control, DOM capture, and clinical data extraction.
 *
 * Architecture:
 *   Claude Code → MCP Protocol → This Server → WebSocket → Chrome Extension
 *
 * Tools provided:
 *   - browser_navigate: Navigate to URL
 *   - browser_click: Click element by selector
 *   - browser_type: Type text into element
 *   - browser_screenshot: Capture page screenshot
 *   - get_page_data: Extract DOM, console logs, network data
 *   - athena_capture: Capture clinical data from Athena EMR
 *   - send_to_observer: Forward data to Medical Mirror Observer
 *
 * =============================================================================
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WebSocket, WebSocketServer } from "ws";

// =============================================================================
// CONFIGURATION
// =============================================================================

const CHROME_EXTENSION_PORT = parseInt(process.env.CHROME_EXTENSION_PORT || "8080");
const OBSERVER_URL = process.env.OBSERVER_URL || "http://localhost:3000";
const CLAUDE_TEAM_HUB = process.env.CLAUDE_TEAM_HUB || "ws://localhost:4847";

// =============================================================================
// WEBSOCKET SERVER FOR CHROME EXTENSION
// =============================================================================

interface BrowserClient {
  ws: WebSocket;
  extensionId: string;
  tabs: Map<number, TabInfo>;
}

interface TabInfo {
  id: number;
  url: string;
  title: string;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timeout: NodeJS.Timeout;
}

const browserClients = new Map<string, BrowserClient>();
const pendingRequests = new Map<string, PendingRequest>();
let wss: WebSocketServer | null = null;

function startWebSocketServer() {
  wss = new WebSocketServer({ port: CHROME_EXTENSION_PORT });

  console.error(`[Browser Bridge] WebSocket server listening on port ${CHROME_EXTENSION_PORT}`);

  wss.on("connection", (ws, req) => {
    const clientId = `chrome-${Date.now()}`;
    console.error(`[Browser Bridge] Chrome extension connected: ${clientId}`);

    const client: BrowserClient = {
      ws,
      extensionId: clientId,
      tabs: new Map()
    };

    browserClients.set(clientId, client);

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleBrowserMessage(clientId, message);
      } catch (err) {
        console.error("[Browser Bridge] Failed to parse message:", err);
      }
    });

    ws.on("close", () => {
      console.error(`[Browser Bridge] Chrome extension disconnected: ${clientId}`);
      browserClients.delete(clientId);
    });

    ws.on("error", (err) => {
      console.error(`[Browser Bridge] WebSocket error:`, err);
    });
  });
}

function handleBrowserMessage(clientId: string, message: any) {
  const { requestId, type, data, error } = message;

  // Handle response to pending request
  if (requestId && pendingRequests.has(requestId)) {
    const pending = pendingRequests.get(requestId)!;
    clearTimeout(pending.timeout);
    pendingRequests.delete(requestId);

    if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(data);
    }
    return;
  }

  // Handle unsolicited messages (events from extension)
  switch (type) {
    case "tab_updated":
      const client = browserClients.get(clientId);
      if (client) {
        client.tabs.set(data.tabId, {
          id: data.tabId,
          url: data.url,
          title: data.title
        });
      }
      break;

    case "telemetry":
      // Forward telemetry to Observer
      forwardToObserver(data);
      break;

    default:
      console.error(`[Browser Bridge] Unknown message type: ${type}`);
  }
}

async function sendToBrowser(command: string, params: any, timeout = 30000): Promise<any> {
  // Get first available browser client
  const client = browserClients.values().next().value as BrowserClient | undefined;

  if (!client || client.ws.readyState !== WebSocket.OPEN) {
    throw new Error("No browser extension connected. Please ensure the Chrome extension is running.");
  }

  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Browser command timed out: ${command}`));
    }, timeout);

    pendingRequests.set(requestId, {
      resolve,
      reject,
      timeout: timeoutHandle
    });

    client.ws.send(JSON.stringify({
      requestId,
      command,
      params
    }));
  });
}

// =============================================================================
// OBSERVER INTEGRATION
// =============================================================================

async function forwardToObserver(data: any) {
  try {
    const response = await fetch(`${OBSERVER_URL}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "OBSERVER_TELEMETRY",
        source: "browser-bridge",
        event: {
          stage: "browser",
          action: data.action || "BROWSER_EVENT",
          success: true,
          timestamp: new Date().toISOString(),
          data
        }
      })
    });

    if (!response.ok) {
      console.error("[Browser Bridge] Failed to forward to Observer:", response.status);
    }
  } catch (err) {
    console.error("[Browser Bridge] Observer connection error:", err);
  }
}

// =============================================================================
// MCP SERVER SETUP
// =============================================================================

const server = new Server(
  {
    name: "browser-bridge",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

const TOOLS = [
  {
    name: "browser_navigate",
    description: "Navigate browser to a URL. Opens a new tab or navigates existing tab.",
    inputSchema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "URL to navigate to"
        },
        tabId: {
          type: "number",
          description: "Optional tab ID. If not provided, uses active tab or creates new."
        },
        waitForLoad: {
          type: "boolean",
          description: "Wait for page to fully load before returning",
          default: true
        }
      },
      required: ["url"]
    }
  },
  {
    name: "browser_click",
    description: "Click an element on the page by CSS selector or XPath",
    inputSchema: {
      type: "object" as const,
      properties: {
        selector: {
          type: "string",
          description: "CSS selector or XPath to element"
        },
        tabId: {
          type: "number",
          description: "Tab ID to execute in"
        },
        waitAfter: {
          type: "number",
          description: "Milliseconds to wait after click",
          default: 500
        }
      },
      required: ["selector"]
    }
  },
  {
    name: "browser_type",
    description: "Type text into an input element",
    inputSchema: {
      type: "object" as const,
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for input element"
        },
        text: {
          type: "string",
          description: "Text to type"
        },
        tabId: {
          type: "number",
          description: "Tab ID to execute in"
        },
        clearFirst: {
          type: "boolean",
          description: "Clear existing text before typing",
          default: true
        },
        pressEnter: {
          type: "boolean",
          description: "Press Enter after typing",
          default: false
        }
      },
      required: ["selector", "text"]
    }
  },
  {
    name: "browser_screenshot",
    description: "Capture a screenshot of the current page or element",
    inputSchema: {
      type: "object" as const,
      properties: {
        tabId: {
          type: "number",
          description: "Tab ID to capture"
        },
        selector: {
          type: "string",
          description: "Optional selector to capture specific element"
        },
        fullPage: {
          type: "boolean",
          description: "Capture full scrollable page",
          default: false
        }
      }
    }
  },
  {
    name: "get_page_data",
    description: "Extract data from current page: DOM, console logs, network requests, cookies",
    inputSchema: {
      type: "object" as const,
      properties: {
        tabId: {
          type: "number",
          description: "Tab ID to extract from"
        },
        dataTypes: {
          type: "array",
          items: {
            type: "string",
            enum: ["dom", "console", "network", "cookies", "storage", "meta"]
          },
          description: "Types of data to extract",
          default: ["dom", "meta"]
        },
        selector: {
          type: "string",
          description: "Optional CSS selector to limit DOM extraction"
        }
      }
    }
  },
  {
    name: "athena_capture",
    description: "Capture clinical data from Athena EMR page. Extracts patient info, encounters, medications, etc.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tabId: {
          type: "number",
          description: "Tab ID with Athena page"
        },
        dataTypes: {
          type: "array",
          items: {
            type: "string",
            enum: ["patient", "encounter", "medications", "vitals", "diagnoses", "procedures", "notes", "orders", "all"]
          },
          description: "Types of clinical data to capture",
          default: ["all"]
        },
        patientId: {
          type: "string",
          description: "Optional patient ID/MRN to verify"
        }
      }
    }
  },
  {
    name: "send_to_observer",
    description: "Send captured data to Medical Mirror Observer for analysis and storage",
    inputSchema: {
      type: "object" as const,
      properties: {
        data: {
          type: "object",
          description: "Data to send to Observer"
        },
        stage: {
          type: "string",
          description: "Pipeline stage (e.g., 'patient_lookup', 'athena_capture')"
        },
        action: {
          type: "string",
          description: "Action type (e.g., 'CAPTURE_COMPLETE', 'SYNC_SUCCESS')"
        }
      },
      required: ["data"]
    }
  },
  {
    name: "browser_wait",
    description: "Wait for an element to appear or condition to be met",
    inputSchema: {
      type: "object" as const,
      properties: {
        selector: {
          type: "string",
          description: "CSS selector to wait for"
        },
        tabId: {
          type: "number",
          description: "Tab ID"
        },
        timeout: {
          type: "number",
          description: "Max wait time in milliseconds",
          default: 10000
        },
        condition: {
          type: "string",
          enum: ["visible", "hidden", "exists", "removed"],
          description: "Condition to wait for",
          default: "visible"
        }
      },
      required: ["selector"]
    }
  },
  {
    name: "browser_execute",
    description: "Execute JavaScript code in the browser context",
    inputSchema: {
      type: "object" as const,
      properties: {
        script: {
          type: "string",
          description: "JavaScript code to execute"
        },
        tabId: {
          type: "number",
          description: "Tab ID"
        }
      },
      required: ["script"]
    }
  },
  {
    name: "get_tabs",
    description: "Get list of all open browser tabs",
    inputSchema: {
      type: "object" as const,
      properties: {}
    }
  }
];

// =============================================================================
// TOOL HANDLERS
// =============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: any;

    switch (name) {
      case "browser_navigate":
        result = await sendToBrowser("navigate", {
          url: args?.url,
          tabId: args?.tabId,
          waitForLoad: args?.waitForLoad ?? true
        });
        break;

      case "browser_click":
        result = await sendToBrowser("click", {
          selector: args?.selector,
          tabId: args?.tabId,
          waitAfter: args?.waitAfter ?? 500
        });
        break;

      case "browser_type":
        result = await sendToBrowser("type", {
          selector: args?.selector,
          text: args?.text,
          tabId: args?.tabId,
          clearFirst: args?.clearFirst ?? true,
          pressEnter: args?.pressEnter ?? false
        });
        break;

      case "browser_screenshot":
        result = await sendToBrowser("screenshot", {
          tabId: args?.tabId,
          selector: args?.selector,
          fullPage: args?.fullPage ?? false
        });
        break;

      case "get_page_data":
        result = await sendToBrowser("getPageData", {
          tabId: args?.tabId,
          dataTypes: args?.dataTypes ?? ["dom", "meta"],
          selector: args?.selector
        });
        break;

      case "athena_capture":
        result = await sendToBrowser("athenaCapture", {
          tabId: args?.tabId,
          dataTypes: args?.dataTypes ?? ["all"],
          patientId: args?.patientId
        });
        // Forward to Observer
        await forwardToObserver({
          action: "ATHENA_CAPTURE",
          patientId: args?.patientId,
          dataTypes: args?.dataTypes,
          capturedAt: new Date().toISOString()
        });
        break;

      case "send_to_observer":
        await forwardToObserver({
          action: args?.action || "BROWSER_DATA",
          stage: args?.stage || "browser",
          data: args?.data
        });
        result = { success: true, message: "Data sent to Observer" };
        break;

      case "browser_wait":
        const waitTimeout = (args?.timeout as number) ?? 10000;
        result = await sendToBrowser("wait", {
          selector: args?.selector,
          tabId: args?.tabId,
          timeout: waitTimeout,
          condition: args?.condition ?? "visible"
        }, waitTimeout);
        break;

      case "browser_execute":
        result = await sendToBrowser("execute", {
          script: args?.script,
          tabId: args?.tabId
        });
        break;

      case "get_tabs":
        result = await sendToBrowser("getTabs", {});
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: "text",
          text: typeof result === "string" ? result : JSON.stringify(result, null, 2)
        }
      ]
    };

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${message}`
        }
      ],
      isError: true
    };
  }
});

// =============================================================================
// RESOURCES (for exposing browser state)
// =============================================================================

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "browser://tabs",
      name: "Open Browser Tabs",
      description: "List of currently open browser tabs",
      mimeType: "application/json"
    },
    {
      uri: "browser://status",
      name: "Browser Connection Status",
      description: "Status of browser extension connection",
      mimeType: "application/json"
    }
  ]
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  switch (uri) {
    case "browser://tabs":
      const tabs: TabInfo[] = [];
      for (const client of browserClients.values()) {
        for (const tab of client.tabs.values()) {
          tabs.push(tab);
        }
      }
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(tabs, null, 2)
          }
        ]
      };

    case "browser://status":
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify({
              connected: browserClients.size > 0,
              clientCount: browserClients.size,
              clients: Array.from(browserClients.keys())
            }, null, 2)
          }
        ]
      };

    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
});

// =============================================================================
// STARTUP
// =============================================================================

async function main() {
  // Start WebSocket server for Chrome extension
  startWebSocketServer();

  // Connect to MCP transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[Browser Bridge] MCP server started");
}

main().catch((error) => {
  console.error("[Browser Bridge] Fatal error:", error);
  process.exit(1);
});
