/**
 * =============================================================================
 * REFERENCES-STORE.JS - Shared Recommendations Storage
 * =============================================================================
 *
 * Manages storage of AI-generated recommendations that can be shared with
 * other applications in the ecosystem.
 *
 * The Observer writes recommendations here after analyzing telemetry.
 * Other applications (like athena-scraper) can read these to understand
 * what improvements have been suggested.
 *
 * File Structure:
 *   server/data/references/
 *   ├── athena-scraper.json    # Recommendations for athena-scraper
 *   ├── clinical-app.json      # Recommendations for clinical-app
 *   └── _summary.json          # Aggregate metrics across all sources
 *
 * Reference File Format:
 * {
 *   "source": "athena-scraper",
 *   "lastUpdated": "2024-01-15T10:30:00Z",
 *   "generatedFrom": "ana_abc123",
 *   "healthScore": 72,
 *   "metrics": {
 *     "totalEvents": 5432,
 *     "errorRate": "15%",
 *     "avgLatency": "234ms"
 *   },
 *   "recommendations": [
 *     {
 *       "id": "rec_abc123",
 *       "priority": "critical|high|medium|low",
 *       "category": "error_handling|performance|reliability|security",
 *       "title": "Short action title",
 *       "description": "Detailed explanation",
 *       "suggestedFix": "Specific code or config change",
 *       "affectedFiles": ["src/api/patient.js"],
 *       "createdAt": "2024-01-15T10:30:00Z"
 *     }
 *   ]
 * }
 *
 * =============================================================================
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { Logger, logRecommendationSummary } from '../utils/logger.js';
import { getAnalysisHistory } from './file-store.js';

// Create logger for this module
const log = Logger('RefStore');

// References directory path
const REFS_DIR = 'references';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the path to the references directory
 */
function getRefsDir() {
  return join(config.storage.dataDir, REFS_DIR);
}

/**
 * Get the path to a specific source's reference file
 */
function getRefFilePath(source) {
  return join(getRefsDir(), `${source}.json`);
}

/**
 * Ensure references directory exists
 */
async function ensureRefsDir() {
  const dir = getRefsDir();
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Get all references across all sources
 *
 * @returns {Object} Map of source -> reference data
 */
export async function getReferences() {
  const refsDir = getRefsDir();

  log.debug('Loading all references');

  let files;
  try {
    files = await fs.readdir(refsDir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      log.debug('References directory does not exist yet');
      return {};
    }
    throw err;
  }

  const references = {};

  for (const file of files) {
    // Skip summary file and non-JSON files
    if (file.startsWith('_') || !file.endsWith('.json')) continue;

    try {
      const content = await fs.readFile(join(refsDir, file), 'utf-8');
      const source = file.replace('.json', '');
      references[source] = JSON.parse(content);
    } catch (err) {
      log.warn(`Failed to read reference file: ${file}`, err.message);
    }
  }

  log.debug(`Loaded references for ${Object.keys(references).length} sources`);

  return references;
}

/**
 * Get references for a specific source
 *
 * @param {string} source - Source application name
 * @returns {Object|null} Reference data or null if not found
 */
export async function getReferencesBySource(source) {
  const filePath = getRefFilePath(source);

  log.debug(`Loading references for source: ${source}`);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * Save references for a source
 *
 * @param {string} source - Source application name
 * @param {Object} data - Reference data to save
 * @returns {Object} { savedAt, filePath }
 */
export async function saveReferences(source, data) {
  await ensureRefsDir();

  const filePath = getRefFilePath(source);
  const now = new Date().toISOString();

  // Add/update IDs for recommendations if missing
  const recommendations = (data.recommendations || []).map(rec => ({
    id: rec.id || `rec_${uuidv4().slice(0, 12)}`,
    createdAt: rec.createdAt || now,
    ...rec
  }));

  const referenceData = {
    source,
    lastUpdated: now,
    healthScore: data.healthScore || null,
    metrics: data.metrics || {},
    recommendations,
    generatedFrom: data.generatedFrom || null
  };

  await fs.writeFile(filePath, JSON.stringify(referenceData, null, 2));

  log.info(`Saved ${recommendations.length} recommendations for ${source}`);

  // Log recommendation summary for visibility
  if (recommendations.length > 0) {
    logRecommendationSummary(source, recommendations);
  }

  // Update summary
  await updateSummary();

  return { savedAt: now, filePath };
}

/**
 * Get summary of all recommendations
 *
 * @returns {Object} Summary statistics
 */
export async function getReferenceSummary() {
  const references = await getReferences();

  let totalRecommendations = 0;
  let criticalCount = 0;
  let highCount = 0;
  const sources = Object.keys(references);
  let lowestHealthScore = 100;

  for (const source of sources) {
    const ref = references[source];
    const recs = ref.recommendations || [];

    totalRecommendations += recs.length;
    criticalCount += recs.filter(r => r.priority === 'critical').length;
    highCount += recs.filter(r => r.priority === 'high').length;

    if (ref.healthScore !== null && ref.healthScore < lowestHealthScore) {
      lowestHealthScore = ref.healthScore;
    }
  }

  return {
    totalRecommendations,
    criticalCount,
    highCount,
    sources,
    sourceCount: sources.length,
    lowestHealthScore: sources.length > 0 ? lowestHealthScore : null,
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Update the summary file
 */
async function updateSummary() {
  await ensureRefsDir();

  const summary = await getReferenceSummary();
  const summaryPath = join(getRefsDir(), '_summary.json');

  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));

  log.debug('Updated reference summary');
}

/**
 * Generate references from an analysis result
 *
 * Takes an AI analysis and extracts actionable recommendations
 * into the shared reference format.
 *
 * @param {string} source - Source application name
 * @param {string} analysisId - Optional specific analysis ID (uses latest if not provided)
 * @returns {Object} Generation result
 */
export async function generateReferencesFromAnalysis(source, analysisId = null) {
  log.info(`Generating references for ${source} from analysis`);

  // Get analysis history
  const analyses = await getAnalysisHistory(10);

  // Find the right analysis
  let analysis;
  if (analysisId) {
    analysis = analyses.find(a => a.id === analysisId);
    if (!analysis) {
      throw new Error(`Analysis not found: ${analysisId}`);
    }
  } else {
    // Find most recent analysis for this source
    analysis = analyses.find(a =>
      a.filters?.source === source ||
      a.result?.parsed?.source === source
    );

    if (!analysis) {
      // Just use the most recent analysis
      analysis = analyses[0];
    }
  }

  if (!analysis) {
    throw new Error('No analyses found. Run an analysis first.');
  }

  log.debug(`Using analysis: ${analysis.id}`);

  // Extract recommendations from the analysis
  const parsed = analysis.result?.parsed || {};
  const recommendations = [];

  // Handle different analysis types
  if (parsed.recommendations) {
    // Direct recommendations from recommendations analysis type
    for (const rec of parsed.recommendations) {
      recommendations.push({
        priority: rec.priority || 'medium',
        category: rec.category || 'general',
        title: rec.title || rec.name || 'Recommendation',
        description: rec.description || '',
        suggestedFix: rec.suggestedFix || rec.action || '',
        affectedFiles: rec.affectedFiles || []
      });
    }
  }

  if (parsed.anomalies) {
    // Anomalies from anomaly analysis type
    for (const anomaly of parsed.anomalies) {
      recommendations.push({
        priority: anomaly.severity === 'critical' ? 'critical' :
                  anomaly.severity === 'warning' ? 'high' : 'medium',
        category: anomaly.type || 'anomaly',
        title: anomaly.description?.substring(0, 80) || 'Anomaly detected',
        description: anomaly.description || '',
        suggestedFix: anomaly.recommendation || '',
        affectedFiles: anomaly.affectedStages?.map(s => `stage: ${s}`) || []
      });
    }
  }

  if (parsed.criticalIssues) {
    for (const issue of parsed.criticalIssues) {
      recommendations.push({
        priority: 'critical',
        category: 'critical',
        title: typeof issue === 'string' ? issue : issue.title || 'Critical Issue',
        description: typeof issue === 'string' ? issue : issue.description || '',
        suggestedFix: '',
        affectedFiles: []
      });
    }
  }

  // Calculate health score
  const healthScore = parsed.healthScore ||
                      parsed.metrics?.healthScore ||
                      (100 - (recommendations.filter(r => r.priority === 'critical').length * 15) -
                             (recommendations.filter(r => r.priority === 'high').length * 5));

  // Save the references
  const result = await saveReferences(source, {
    healthScore: Math.max(0, Math.min(100, healthScore)),
    metrics: parsed.metrics || {
      eventsAnalyzed: analysis.eventsAnalyzed,
      analysisType: analysis.analysisType
    },
    recommendations,
    generatedFrom: analysis.id
  });

  return {
    source,
    analysisId: analysis.id,
    recommendationCount: recommendations.length,
    healthScore,
    savedAt: result.savedAt
  };
}
