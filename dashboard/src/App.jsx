/**
 * =============================================================================
 * Medical Mirror Observer Dashboard - Main Application
 * =============================================================================
 *
 * This dashboard displays:
 * - Overview: Health score, stats, and quick summary
 * - Recommendations: AI-generated action items with priority ranking
 * - Events: Real-time telemetry stream from connected applications
 * - Analysis: Run new AI analyses and view history
 *
 * The Observer acts as an architect/engineer for your applications.
 * It observes, plans, and presents recommendations - you decide what to apply.
 */
import { useState, useEffect, useCallback } from 'react';

// API base URL - proxied to backend during development
const API_BASE = '/api';

/**
 * Main Application Component
 *
 * Manages tab navigation and data fetching for the dashboard.
 */
export default function App() {
  // Current active tab
  const [activeTab, setActiveTab] = useState('overview');

  // Server connection status
  const [serverOnline, setServerOnline] = useState(false);

  // Data states
  const [stats, setStats] = useState(null);
  const [references, setReferences] = useState({});
  const [events, setEvents] = useState([]);
  const [providers, setProviders] = useState([]);

  // Loading states
  const [loading, setLoading] = useState(true);

  // ---------------------------------------------------------------------------
  // Data Fetching
  // ---------------------------------------------------------------------------

  /**
   * Check if server is online via health endpoint
   */
  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/../health`);
      setServerOnline(res.ok);
    } catch {
      setServerOnline(false);
    }
  }, []);

  /**
   * Fetch event statistics
   */
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/events/stats`);
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, []);

  /**
   * Fetch shared recommendations from all sources
   */
  const fetchReferences = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/references`);
      if (res.ok) {
        const data = await res.json();
        setReferences(data);
      }
    } catch (err) {
      console.error('Failed to fetch references:', err);
    }
  }, []);

  /**
   * Fetch recent events
   */
  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/events?limit=50`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      }
    } catch (err) {
      console.error('Failed to fetch events:', err);
    }
  }, []);

  /**
   * Fetch available AI providers
   */
  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/analyze/providers`);
      if (res.ok) {
        const data = await res.json();
        setProviders(data.available || []);
      }
    } catch (err) {
      console.error('Failed to fetch providers:', err);
    }
  }, []);

  /**
   * Load all data on mount and set up refresh interval
   */
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await checkHealth();
      await Promise.all([
        fetchStats(),
        fetchReferences(),
        fetchEvents(),
        fetchProviders()
      ]);
      setLoading(false);
    };

    loadData();

    // Refresh data every 30 seconds
    const interval = setInterval(() => {
      checkHealth();
      fetchStats();
      fetchReferences();
      fetchEvents();
    }, 30000);

    return () => clearInterval(interval);
  }, [checkHealth, fetchStats, fetchReferences, fetchEvents, fetchProviders]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="app">
      {/* Header with status indicator */}
      <header className="header">
        <h1>Medical Mirror Observer</h1>
        <div className="header-status">
          <span className={`status-dot ${serverOnline ? '' : 'offline'}`}></span>
          <span>{serverOnline ? 'Server Connected' : 'Server Offline'}</span>
        </div>
      </header>

      <main className="main">
        {/* Navigation Tabs */}
        <nav className="tabs">
          {['overview', 'recommendations', 'events', 'analysis'].map(tab => (
            <button
              key={tab}
              className={`tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>

        {/* Tab Content */}
        {loading ? (
          <div className="loading">
            <div className="loading-spinner"></div>
            <p>Loading dashboard...</p>
          </div>
        ) : (
          <>
            {activeTab === 'overview' && (
              <OverviewTab stats={stats} references={references} />
            )}
            {activeTab === 'recommendations' && (
              <RecommendationsTab references={references} />
            )}
            {activeTab === 'events' && (
              <EventsTab events={events} onRefresh={fetchEvents} />
            )}
            {activeTab === 'analysis' && (
              <AnalysisTab
                providers={providers}
                onAnalysisComplete={() => {
                  fetchReferences();
                  fetchStats();
                }}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

// =============================================================================
// TAB COMPONENTS
// =============================================================================

/**
 * Overview Tab - Health score and summary statistics
 */
function OverviewTab({ stats, references }) {
  // Calculate overall health score from references
  const allRecs = Object.values(references).flatMap(r => r.recommendations || []);
  const criticalCount = allRecs.filter(r => r.priority === 'critical').length;
  const highCount = allRecs.filter(r => r.priority === 'high').length;

  // Calculate health score (100 - penalties for issues)
  let healthScore = 100;
  healthScore -= criticalCount * 15;
  healthScore -= highCount * 5;
  healthScore = Math.max(0, Math.min(100, healthScore));

  // Determine health status
  let healthClass = 'good';
  if (healthScore < 50) healthClass = 'critical';
  else if (healthScore < 75) healthClass = 'warning';

  return (
    <>
      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats?.totalEvents || 0}</div>
          <div className="stat-label">Total Events</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: stats?.errorCount > 0 ? '#ef4444' : '#22c55e' }}>
            {stats?.errorCount || 0}
          </div>
          <div className="stat-label">Errors</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats?.sources?.length || 0}</div>
          <div className="stat-label">Active Sources</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{allRecs.length}</div>
          <div className="stat-label">Recommendations</div>
        </div>
      </div>

      {/* Health Score Card */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">System Health</h2>
          <span className="card-subtitle">Based on AI analysis</span>
        </div>
        <div className="health-score">
          <div className={`health-circle ${healthClass}`}>
            {healthScore}
            <small>/ 100</small>
          </div>
          <div className="health-details">
            <div className="health-stat">
              <span className="health-stat-label">Critical Issues</span>
              <span className="health-stat-value" style={{ color: criticalCount > 0 ? '#ef4444' : '#22c55e' }}>
                {criticalCount}
              </span>
            </div>
            <div className="health-stat">
              <span className="health-stat-label">High Priority</span>
              <span className="health-stat-value" style={{ color: highCount > 0 ? '#f59e0b' : '#22c55e' }}>
                {highCount}
              </span>
            </div>
            <div className="health-stat">
              <span className="health-stat-label">Connected Apps</span>
              <span className="health-stat-value">{Object.keys(references).length}</span>
            </div>
            <div className="health-stat">
              <span className="health-stat-label">Last Event</span>
              <span className="health-stat-value">
                {stats?.lastEventTime ? formatTime(stats.lastEventTime) : 'N/A'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Top Issues Preview */}
      {criticalCount + highCount > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Top Issues</h2>
          </div>
          <div className="recommendations-list">
            {allRecs
              .filter(r => r.priority === 'critical' || r.priority === 'high')
              .slice(0, 3)
              .map((rec, i) => (
                <RecommendationItem key={rec.id || i} rec={rec} />
              ))}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Recommendations Tab - All AI-generated recommendations
 */
function RecommendationsTab({ references }) {
  const sources = Object.keys(references);

  if (sources.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">?</div>
        <p>No recommendations yet.</p>
        <p>Run an analysis to generate recommendations.</p>
      </div>
    );
  }

  return (
    <>
      {sources.map(source => {
        const ref = references[source];
        const recs = ref.recommendations || [];

        return (
          <div key={source} className="card">
            <div className="card-header">
              <h2 className="card-title">{source}</h2>
              <span className="card-subtitle">
                {recs.length} recommendation{recs.length !== 1 ? 's' : ''} |
                Health Score: {ref.healthScore ?? 'N/A'}
              </span>
            </div>
            {recs.length > 0 ? (
              <div className="recommendations-list">
                {recs.map((rec, i) => (
                  <RecommendationItem key={rec.id || i} rec={rec} />
                ))}
              </div>
            ) : (
              <p style={{ color: '#22c55e' }}>No issues found for this source.</p>
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * Single Recommendation Item Component
 */
function RecommendationItem({ rec }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="recommendation" onClick={() => setExpanded(!expanded)}>
      <div className="recommendation-header">
        <span className={`priority-badge ${rec.priority || 'medium'}`}>
          {rec.priority || 'medium'}
        </span>
        <span className="category-badge">{rec.category || 'general'}</span>
      </div>
      <div className="recommendation-title">{rec.title}</div>
      <div className="recommendation-description">{rec.description}</div>

      {expanded && rec.suggestedFix && (
        <div className="recommendation-fix">{rec.suggestedFix}</div>
      )}

      {rec.affectedFiles?.length > 0 && (
        <div className="recommendation-meta">
          <span>Files: {rec.affectedFiles.join(', ')}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Events Tab - Real-time event stream
 */
function EventsTab({ events, onRefresh }) {
  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Recent Events</h2>
        <button className="btn btn-secondary" onClick={onRefresh}>
          Refresh
        </button>
      </div>
      {events.length > 0 ? (
        <div className="events-list">
          {events.map((evt, i) => (
            <div key={evt.id || i} className="event-item">
              <span
                className={`event-status ${
                  evt.event?.success === false ? 'error' :
                  evt.event?.success === true ? 'success' : 'pending'
                }`}
              ></span>
              <div className="event-details">
                <span className="event-source">{evt.source || 'unknown'}</span>
                <span className="event-stage">
                  {evt.event?.stage || 'N/A'} / {evt.event?.action || 'N/A'}
                </span>
              </div>
              <span className="event-time">
                {formatTime(evt.event?.timestamp || evt.receivedAt)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p>No events captured yet.</p>
          <p>Connect an application to start receiving telemetry.</p>
        </div>
      )}
    </div>
  );
}

/**
 * Analysis Tab - Run AI analysis and view history
 */
function AnalysisTab({ providers, onAnalysisComplete }) {
  const [provider, setProvider] = useState(providers[0] || 'claude');
  const [analysisType, setAnalysisType] = useState('anomaly');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Update provider when providers list changes
  useEffect(() => {
    if (providers.length > 0 && !providers.includes(provider)) {
      setProvider(providers[0]);
    }
  }, [providers, provider]);

  /**
   * Run AI analysis
   */
  const runAnalysis = async () => {
    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          analysisType,
          maxEvents: 100,
          saveToFile: true
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Analysis failed');
      }

      const data = await res.json();
      setResult(data);
      onAnalysisComplete?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">AI Analysis</h2>
      </div>

      <div className="analysis-controls">
        <div className="form-group">
          <label>AI Provider</label>
          <select value={provider} onChange={e => setProvider(e.target.value)}>
            {providers.length > 0 ? (
              providers.map(p => (
                <option key={p} value={p}>{p}</option>
              ))
            ) : (
              <option value="">No providers configured</option>
            )}
          </select>
        </div>

        <div className="form-group">
          <label>Analysis Type</label>
          <select value={analysisType} onChange={e => setAnalysisType(e.target.value)}>
            <option value="anomaly">Anomaly Detection</option>
            <option value="summary">Summary</option>
            <option value="pattern">Pattern Analysis</option>
            <option value="recommendations">Recommendations</option>
          </select>
        </div>

        <div className="form-group" style={{ justifyContent: 'flex-end' }}>
          <button
            className="btn btn-primary"
            onClick={runAnalysis}
            disabled={running || providers.length === 0}
          >
            {running ? 'Running...' : 'Run Analysis'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ color: '#ef4444', marginBottom: '1rem' }}>
          Error: {error}
        </div>
      )}

      {result && (
        <>
          <div style={{ marginBottom: '1rem', color: '#22c55e' }}>
            Analysis complete! Analyzed {result.eventsAnalyzed} events in {result.durationMs}ms
          </div>
          <div className="analysis-result">
            {result.result?.content || JSON.stringify(result.result?.parsed, null, 2)}
          </div>
        </>
      )}

      {!result && !error && providers.length === 0 && (
        <div className="empty-state">
          <p>No AI providers configured.</p>
          <p>Add API keys to your .env file to enable analysis.</p>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Format timestamp for display
 */
function formatTime(timestamp) {
  if (!timestamp) return 'N/A';
  const date = new Date(timestamp);
  return date.toLocaleString();
}
