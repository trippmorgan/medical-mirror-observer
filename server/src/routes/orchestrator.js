/**
 * =============================================================================
 * ORCHESTRATOR ROUTES - Multi-Agent Workflow API
 * =============================================================================
 *
 * Endpoints for orchestrating multi-agent workflows across:
 * - Observer (telemetry, AI)
 * - Claude Team (coordination)
 * - Browser Bridge (Chrome control)
 * - SCC (clinical workflows)
 *
 * =============================================================================
 */

import express from 'express';
import { Logger } from '../utils/logger.js';
import orchestrator, {
  getServicesHealth,
  executeWorkflow,
  WORKFLOW_ATHENA_CAPTURE_ANALYZE,
  WORKFLOW_ANOMALY_MONITOR
} from '../integrations/orchestrator.js';

const router = express.Router();
const log = Logger('Orchestrator');

// =============================================================================
// ROUTES
// =============================================================================

/**
 * GET /api/orchestrator
 * Get orchestrator info and available workflows
 */
router.get('/', (req, res) => {
  res.json({
    name: 'Medical Mirror Orchestrator',
    version: '1.0.0',
    description: 'Multi-agent workflow orchestration',
    availableWorkflows: [
      {
        id: 'athena-capture-analyze',
        name: 'Athena Capture & Analyze',
        description: 'Navigate to Athena, capture patient data, analyze with AI',
        requiredContext: ['athenaUrl', 'patientId']
      },
      {
        id: 'anomaly-monitor',
        name: 'Anomaly Monitor',
        description: 'Check for anomalies in telemetry and alert team',
        requiredContext: []
      }
    ],
    endpoints: {
      health: 'GET /api/orchestrator/health',
      execute: 'POST /api/orchestrator/execute',
      workflows: 'GET /api/orchestrator/workflows'
    }
  });
});

/**
 * GET /api/orchestrator/health
 * Check health of all connected services
 */
router.get('/health', async (req, res) => {
  try {
    const health = await getServicesHealth();
    const allHealthy = Object.values(health).every(
      status => status === 'connected'
    );

    res.json({
      status: allHealthy ? 'healthy' : 'degraded',
      services: health,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    log.error('Health check failed', error);
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

/**
 * GET /api/orchestrator/workflows
 * List all available predefined workflows
 */
router.get('/workflows', (req, res) => {
  res.json({
    workflows: [
      {
        id: 'athena-capture-analyze',
        name: WORKFLOW_ATHENA_CAPTURE_ANALYZE.name,
        steps: WORKFLOW_ATHENA_CAPTURE_ANALYZE.steps.map(s => s.name)
      },
      {
        id: 'anomaly-monitor',
        name: WORKFLOW_ANOMALY_MONITOR.name,
        steps: WORKFLOW_ANOMALY_MONITOR.steps.map(s => s.name)
      }
    ]
  });
});

/**
 * POST /api/orchestrator/execute
 * Execute a workflow
 *
 * Body:
 * {
 *   "workflowId": "athena-capture-analyze",  // OR
 *   "workflow": { ... custom workflow ... },
 *   "context": { "athenaUrl": "...", "patientId": "..." }
 * }
 */
router.post('/execute', async (req, res) => {
  try {
    const { workflowId, workflow, context = {} } = req.body;

    let workflowToExecute;

    if (workflowId) {
      // Use predefined workflow
      switch (workflowId) {
        case 'athena-capture-analyze':
          workflowToExecute = {
            ...WORKFLOW_ATHENA_CAPTURE_ANALYZE,
            context
          };
          break;

        case 'anomaly-monitor':
          workflowToExecute = {
            ...WORKFLOW_ANOMALY_MONITOR,
            context
          };
          break;

        default:
          return res.status(400).json({
            error: `Unknown workflow: ${workflowId}`,
            availableWorkflows: ['athena-capture-analyze', 'anomaly-monitor']
          });
      }
    } else if (workflow) {
      // Use custom workflow
      workflowToExecute = { ...workflow, context };
    } else {
      return res.status(400).json({
        error: 'Either workflowId or workflow object required'
      });
    }

    log.info(`Executing workflow: ${workflowToExecute.name}`);

    const result = await executeWorkflow(workflowToExecute);

    res.json({
      success: result.success,
      workflow: workflowToExecute.name,
      completedSteps: result.completedSteps,
      results: result.results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    log.error('Workflow execution failed', error);
    res.status(500).json({
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * POST /api/orchestrator/step
 * Execute a single step (for testing/debugging)
 *
 * Body:
 * {
 *   "type": "observer",
 *   "action": "analyze",
 *   "params": { "provider": "claude", "analysisType": "anomaly" }
 * }
 */
router.post('/step', async (req, res) => {
  try {
    const { type, name, action, params = {}, context = {} } = req.body;

    if (!type || !action) {
      return res.status(400).json({
        error: 'type and action are required'
      });
    }

    const step = { type, name: name || `${type}:${action}`, action, params };

    // Create a minimal workflow with single step
    const result = await executeWorkflow({
      name: `Single Step: ${step.name}`,
      steps: [step],
      context
    });

    res.json({
      success: result.success,
      result: result.results[0],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    log.error('Step execution failed', error);
    res.status(500).json({
      error: error.message
    });
  }
});

export default router;
