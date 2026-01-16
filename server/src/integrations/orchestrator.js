/**
 * =============================================================================
 * ORCHESTRATOR.JS - Multi-Agent Task Orchestration
 * =============================================================================
 *
 * Coordinates tasks between:
 * - Medical Mirror Observer (telemetry, AI analysis)
 * - Claude Team Hub (multi-window coordination)
 * - Browser Bridge (Chrome extension control)
 * - SCC Project (clinical workflows)
 *
 * Enables complex workflows like:
 * - Capture patient data from Athena → Analyze → Store → Notify team
 * - Monitor telemetry → Detect anomaly → Trigger browser action → Alert
 *
 * =============================================================================
 */

import { Logger } from '../utils/logger.js';
import claudeTeamClient from './claude-team-client.js';

const log = Logger('Orchestrator');

// =============================================================================
// CONFIGURATION
// =============================================================================

const SERVICES = {
  observer: {
    url: process.env.OBSERVER_URL || 'http://localhost:3000',
    endpoints: {
      events: '/api/events',
      analyze: '/api/analyze',
      references: '/api/references'
    }
  },
  claudeTeam: {
    hubUrl: process.env.CLAUDE_TEAM_HUB || 'ws://localhost:4847',
    httpUrl: process.env.CLAUDE_TEAM_HTTP || 'http://localhost:4847'
  },
  browserBridge: {
    url: process.env.BROWSER_BRIDGE_URL || 'ws://localhost:8080'
  },
  scc: {
    sentinelUrl: process.env.SCC_SENTINEL_URL || 'http://localhost:3002',
    appUrl: process.env.SCC_APP_URL || 'http://localhost:3001'
  }
};

// =============================================================================
// SERVICE STATUS
// =============================================================================

/**
 * Check health of all connected services
 */
export async function getServicesHealth() {
  const health = {};

  // Observer
  try {
    const res = await fetch(`${SERVICES.observer.url}/health`);
    health.observer = res.ok ? 'connected' : 'error';
  } catch {
    health.observer = 'offline';
  }

  // Claude Team Hub
  try {
    const res = await fetch(`${SERVICES.claudeTeam.httpUrl}/health`);
    health.claudeTeam = res.ok ? 'connected' : 'error';
  } catch {
    health.claudeTeam = 'offline';
  }

  // SCC Sentinel
  try {
    const res = await fetch(`${SERVICES.scc.sentinelUrl}/health`);
    health.sccSentinel = res.ok ? 'connected' : 'error';
  } catch {
    health.sccSentinel = 'offline';
  }

  // Claude Team client (WebSocket)
  health.claudeTeamWs = claudeTeamClient.isHubConnected() ? 'connected' : 'disconnected';

  return health;
}

// =============================================================================
// WORKFLOW ORCHESTRATION
// =============================================================================

/**
 * Execute a multi-step workflow
 *
 * @param {Object} workflow - Workflow definition
 * @param {string} workflow.name - Workflow name
 * @param {Array} workflow.steps - Array of step definitions
 * @param {Object} workflow.context - Initial context data
 */
export async function executeWorkflow(workflow) {
  const { name, steps, context = {} } = workflow;

  log.info(`Starting workflow: ${name}`);
  claudeTeamClient.broadcast(`[Workflow] Starting: ${name}`, 'update');

  const results = [];
  let currentContext = { ...context };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    log.info(`Step ${i + 1}/${steps.length}: ${step.name}`);

    try {
      const result = await executeStep(step, currentContext);
      results.push({ step: step.name, success: true, result });

      // Merge result into context for next step
      if (result && typeof result === 'object') {
        currentContext = { ...currentContext, ...result };
      }

      // Notify team of progress
      claudeTeamClient.broadcast(
        `[Workflow] ${name} - Step ${i + 1}/${steps.length} complete: ${step.name}`,
        'update'
      );

    } catch (error) {
      log.error(`Step failed: ${step.name}`, error);
      results.push({ step: step.name, success: false, error: error.message });

      // Notify team of failure
      claudeTeamClient.broadcast(
        `[Workflow] ${name} - Step failed: ${step.name} - ${error.message}`,
        'blocker'
      );

      // Stop workflow on failure unless step is optional
      if (!step.optional) {
        return {
          success: false,
          completedSteps: i,
          results,
          error: `Workflow stopped at step: ${step.name}`
        };
      }
    }
  }

  log.info(`Workflow complete: ${name}`);
  claudeTeamClient.broadcast(`[Workflow] Complete: ${name}`, 'update');

  return {
    success: true,
    completedSteps: steps.length,
    results,
    context: currentContext
  };
}

/**
 * Execute a single workflow step
 */
async function executeStep(step, context) {
  const { type, action, params = {} } = step;

  // Interpolate context variables in params
  const resolvedParams = interpolateParams(params, context);

  switch (type) {
    case 'observer':
      return await executeObserverAction(action, resolvedParams);

    case 'browser':
      return await executeBrowserAction(action, resolvedParams);

    case 'claudeTeam':
      return await executeClaudeTeamAction(action, resolvedParams);

    case 'scc':
      return await executeSccAction(action, resolvedParams);

    case 'delay':
      await sleep(resolvedParams.ms || 1000);
      return { delayed: resolvedParams.ms };

    case 'condition':
      return evaluateCondition(resolvedParams, context);

    default:
      throw new Error(`Unknown step type: ${type}`);
  }
}

// =============================================================================
// SERVICE ACTIONS
// =============================================================================

async function executeObserverAction(action, params) {
  const { url, endpoints } = SERVICES.observer;

  switch (action) {
    case 'analyze':
      const analyzeRes = await fetch(`${url}${endpoints.analyze}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      return await analyzeRes.json();

    case 'getEvents':
      const eventsRes = await fetch(`${url}${endpoints.events}?${new URLSearchParams(params)}`);
      return await eventsRes.json();

    case 'getReferences':
      const source = params.source || '';
      const refsRes = await fetch(`${url}${endpoints.references}/${source}`);
      return await refsRes.json();

    case 'storeEvent':
      const storeRes = await fetch(`${url}${endpoints.events}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      return await storeRes.json();

    default:
      throw new Error(`Unknown observer action: ${action}`);
  }
}

async function executeBrowserAction(action, params) {
  // Send action to browser bridge via Claude Team hub
  // The browser bridge MCP server handles these
  const response = await fetch(`${SERVICES.claudeTeam.httpUrl}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'orchestrator',
      event: {
        type: 'BROWSER_COMMAND',
        action,
        params
      }
    })
  });
  return await response.json();
}

async function executeClaudeTeamAction(action, params) {
  switch (action) {
    case 'broadcast':
      claudeTeamClient.broadcast(params.message, params.category || 'update');
      return { broadcast: true };

    case 'askTeam':
      // This would need to be async with callback
      claudeTeamClient.sendMessage({
        type: 'query',
        query: params.question,
        targetWindow: params.target
      });
      return { asked: true };

    case 'getStatus':
      const statusRes = await fetch(`${SERVICES.claudeTeam.httpUrl}/status`);
      return await statusRes.json();

    default:
      throw new Error(`Unknown claudeTeam action: ${action}`);
  }
}

async function executeSccAction(action, params) {
  const { sentinelUrl, appUrl } = SERVICES.scc;

  switch (action) {
    case 'sendFeedback':
      const feedbackRes = await fetch(`${appUrl}/api/debug/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      return await feedbackRes.json();

    case 'getHealth':
      const healthRes = await fetch(`${sentinelUrl}/health`);
      return await healthRes.json();

    default:
      throw new Error(`Unknown scc action: ${action}`);
  }
}

// =============================================================================
// PREDEFINED WORKFLOWS
// =============================================================================

/**
 * Workflow: Capture Athena data and analyze
 */
export const WORKFLOW_ATHENA_CAPTURE_ANALYZE = {
  name: 'Athena Capture & Analyze',
  steps: [
    {
      name: 'Navigate to Athena',
      type: 'browser',
      action: 'navigate',
      params: { url: '{{athenaUrl}}' }
    },
    {
      name: 'Wait for page load',
      type: 'delay',
      params: { ms: 2000 }
    },
    {
      name: 'Capture patient data',
      type: 'browser',
      action: 'athenaCapture',
      params: { dataTypes: ['all'], patientId: '{{patientId}}' }
    },
    {
      name: 'Store in Observer',
      type: 'observer',
      action: 'storeEvent',
      params: {
        type: 'OBSERVER_TELEMETRY',
        source: 'athena-capture',
        event: {
          stage: 'athena_capture',
          action: 'PATIENT_DATA_CAPTURED',
          success: true,
          data: '{{capturedData}}'
        }
      }
    },
    {
      name: 'Run AI analysis',
      type: 'observer',
      action: 'analyze',
      params: {
        provider: 'claude',
        analysisType: 'summary',
        maxEvents: 10
      }
    },
    {
      name: 'Notify team',
      type: 'claudeTeam',
      action: 'broadcast',
      params: {
        message: 'Athena capture complete for patient {{patientId}}',
        category: 'update'
      }
    }
  ]
};

/**
 * Workflow: Monitor and alert on anomalies
 */
export const WORKFLOW_ANOMALY_MONITOR = {
  name: 'Anomaly Monitor',
  steps: [
    {
      name: 'Get recent events',
      type: 'observer',
      action: 'getEvents',
      params: { limit: 100, success: 'false' }
    },
    {
      name: 'Analyze anomalies',
      type: 'observer',
      action: 'analyze',
      params: {
        provider: 'claude',
        analysisType: 'anomaly',
        maxEvents: 50
      }
    },
    {
      name: 'Send to SCC',
      type: 'scc',
      action: 'sendFeedback',
      params: {
        type: 'AI_REMEDIATION',
        system: 'observer',
        diagnosis: '{{analysisResult}}',
        priority: 'high'
      }
    },
    {
      name: 'Alert team',
      type: 'claudeTeam',
      action: 'broadcast',
      params: {
        message: 'Anomaly detected: {{anomalySummary}}',
        category: 'heads_up'
      }
    }
  ]
};

// =============================================================================
// HELPERS
// =============================================================================

function interpolateParams(params, context) {
  const result = {};

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      // Replace {{variable}} with context values
      result[key] = value.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
        return context[varName] !== undefined ? context[varName] : match;
      });
    } else if (typeof value === 'object' && value !== null) {
      result[key] = interpolateParams(value, context);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function evaluateCondition(params, context) {
  const { field, operator, value } = params;
  const fieldValue = context[field];

  switch (operator) {
    case 'equals':
      return { pass: fieldValue === value };
    case 'notEquals':
      return { pass: fieldValue !== value };
    case 'greaterThan':
      return { pass: fieldValue > value };
    case 'lessThan':
      return { pass: fieldValue < value };
    case 'contains':
      return { pass: String(fieldValue).includes(value) };
    case 'exists':
      return { pass: fieldValue !== undefined && fieldValue !== null };
    default:
      throw new Error(`Unknown operator: ${operator}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  getServicesHealth,
  executeWorkflow,
  WORKFLOW_ATHENA_CAPTURE_ANALYZE,
  WORKFLOW_ANOMALY_MONITOR
};
