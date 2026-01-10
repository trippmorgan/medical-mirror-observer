// Prompt templates for AI analysis of medical pipeline telemetry

export const SYSTEM_PROMPT = `You are an expert medical data pipeline analyst. You analyze telemetry events from healthcare applications to identify issues, patterns, and optimization opportunities.

Key context:
- Events come from multiple medical applications, each with different pipeline stages:

  **athena-scraper** (EHR Data Extraction):
  Stages: interceptor → injector → backend → fhir-converter → websocket → frontend
  Bidirectional sync: plaud-fetch (get stored data) → plaud-export (save new data)

  **plaud-ai-uploader** (Clinical Documentation):
  Stages: upload (transcript processing) → query (patient search) → ai-query (Claude analysis) → ingest (EMR integration)
  Key metrics: confidence scores, data completeness, patient linking success

  **surgical-command-center** (Surgical Documentation):
  Stages: patient_lookup → procedure_create → voice_capture → transcription → nlp_extraction → field_update → procedure_save → imaging_fetch → websocket
  External services: Dragon AI (Whisper + Gemini), UltraLinq PACS
  Key metrics: transcription latency (<500ms target), NLP extraction accuracy, voice command count

  **Bidirectional Integration** (athena-scraper ↔ plaud-ai-uploader):
  - plaud-fetch: athena-scraper fetches stored clinical data from Plaud when patient opens
  - plaud-export: athena-scraper exports new Athena data to Plaud for persistence
  Key metrics: fetch latency (<100ms target), export success rate (>99%), data freshness

- Each event has: source, stage, action, success status, timestamp, correlationId, and data payload
- Events are from medical/EHR systems and may contain patient IDs (treat as sensitive)
- Your analysis helps developers debug and optimize these data pipelines

For plaud-ai-uploader specifically, pay attention to:
- Upload confidence scores (target >90%)
- Data quality/completeness assessments
- AI query response quality
- Athena event ingestion and duplicate rates
- Patient auto-linking success rates

For surgical-command-center specifically, pay attention to:
- Transcription latency (target <500ms for real-time feel)
- NLP extraction success rate and field mapping accuracy
- Dragon AI (Whisper) availability and error rates
- UltraLinq PACS login success and study retrieval times
- WebSocket connection stability for real-time voice sync
- Procedure completion rates and average duration
- Voice command utilization patterns

For bidirectional sync (plaud-fetch/plaud-export), pay attention to:
- Fetch latency (target <100ms for instant hydration)
- Export success rate (target >99%)
- eventCount trends (data accumulating correctly)
- fetch-not-found vs fetch-patient rates (new vs returning patients)
- export-duplicate rates (idempotency working)

Provide structured, actionable insights. Be concise but thorough.
When possible, format output as JSON for easy parsing.`;

export const ANALYSIS_PROMPTS = {
  anomaly: `Analyze the following medical pipeline telemetry events for anomalies and issues.

EVENTS DATA:
{events}

Analyze for:
1. **Error Patterns** - Recurring failures, cascading errors, error spikes
2. **Performance Issues** - Unusual latency, slow stages, bottlenecks
3. **Data Flow Gaps** - Missing expected stages, incomplete pipelines
4. **Correlation Gaps** - Events with same correlationId that don't complete their journey

Provide your analysis in this JSON format:
{
  "summary": "Brief overview of findings",
  "anomalies": [
    {
      "severity": "critical|warning|info",
      "type": "error|performance|data_flow|correlation",
      "description": "What was found",
      "affectedStages": ["stage1", "stage2"],
      "occurrences": 5,
      "recommendation": "How to fix or investigate"
    }
  ],
  "healthScore": 0-100,
  "metrics": {
    "totalEvents": 0,
    "errorRate": "0%",
    "avgLatency": "0ms"
  }
}`,

  summary: `Summarize the following medical pipeline telemetry events.

EVENTS DATA:
{events}

Provide a comprehensive summary including:
1. Total events processed and time range
2. Success/failure rates by stage
3. Most active pipeline stages
4. Active data sources
5. Notable patterns or trends

Format as JSON:
{
  "overview": "Brief summary paragraph",
  "timeRange": { "start": "ISO", "end": "ISO" },
  "totalEvents": 0,
  "successRate": "0%",
  "stageBreakdown": {
    "stage": { "count": 0, "successRate": "0%" }
  },
  "topSources": ["source1", "source2"],
  "keyFindings": ["finding1", "finding2"]
}`,

  pattern: `Analyze behavioral patterns in these medical pipeline events.

EVENTS DATA:
{events}

Look for:
1. **Common Sequences** - Typical stage progressions
2. **Timing Patterns** - Processing times, peak activity periods
3. **Source Behavior** - How different sources use the pipeline
4. **Deviation Patterns** - Events that don't follow expected flow

Format as JSON:
{
  "patterns": [
    {
      "name": "Pattern name",
      "description": "What this pattern is",
      "frequency": "How often it occurs",
      "stages": ["stage1", "stage2"],
      "isExpected": true
    }
  ],
  "typicalFlow": ["stage1", "stage2", "stage3"],
  "averageJourneyTime": "0ms",
  "peakActivityHours": [9, 10, 14, 15],
  "sourceProfiles": {
    "source": {
      "eventCount": 0,
      "typicalStages": ["stage1"],
      "avgDuration": "0ms"
    }
  }
}`,

  recommendations: `Based on these pipeline telemetry events, provide optimization recommendations.

EVENTS DATA:
{events}

Recommend improvements for:
1. **Error Reduction** - How to decrease failure rates
2. **Performance** - Speed up slow stages
3. **Reliability** - Make the pipeline more robust
4. **Monitoring** - What to watch and alert on
5. **Code Improvements** - Specific code changes if issues are apparent

Format as JSON:
{
  "recommendations": [
    {
      "priority": "high|medium|low",
      "category": "error_handling|performance|reliability|monitoring|code",
      "title": "Short title",
      "description": "Detailed recommendation",
      "effort": "low|medium|high",
      "impact": "Description of expected improvement"
    }
  ],
  "quickWins": ["Easy improvement 1", "Easy improvement 2"],
  "criticalIssues": ["Must fix issue 1"],
  "monitoringAlerts": [
    {
      "metric": "What to monitor",
      "threshold": "When to alert",
      "severity": "critical|warning"
    }
  ]
}`
};

// Helper to build prompt with event data
export function buildPrompt(analysisType, events, options = {}) {
  const template = ANALYSIS_PROMPTS[analysisType];
  if (!template) {
    throw new Error(`Unknown analysis type: ${analysisType}`);
  }

  // Limit events to avoid token limits
  const maxEvents = options.maxEvents || 100;
  const limitedEvents = events.slice(0, maxEvents);

  // Format events for prompt
  const eventsJson = JSON.stringify(limitedEvents, null, 2);

  return template.replace('{events}', eventsJson);
}

export const ANALYSIS_TYPES = Object.keys(ANALYSIS_PROMPTS);
