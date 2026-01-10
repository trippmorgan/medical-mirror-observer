/**
 * =============================================================================
 * PLAUD AI TELEMETRY CLIENT
 * =============================================================================
 *
 * Telemetry integration for Albany Vascular AI Uploader (Plaud AI)
 * Add this script to the Plaud AI application to send events to the Observer.
 *
 * Usage:
 *   1. Include this script in index.html: <script src="plaud-ai-telemetry.js"></script>
 *   2. Events will automatically be captured by the Observer Chrome extension
 *   3. OR events will be sent directly to the Observer server
 *
 * =============================================================================
 */

(function() {
  'use strict';

  const PLAUD_TELEMETRY = {
    source: 'plaud-ai-uploader',
    version: '1.0.0',
    serverUrl: 'http://localhost:3000',  // Observer server (default port)
    useExtension: true,  // Try Chrome extension first
    debug: true
  };

  // ============================================================================
  // CORE TELEMETRY FUNCTIONS
  // ============================================================================

  /**
   * Emit a telemetry event
   * Format matches Observer schema: { type, source, event: { stage, action, ... } }
   */
  function emit(stage, action, data = {}, success = true) {
    const correlationId = data.correlationId || generateCorrelationId();
    const telemetry = {
      type: 'OBSERVER_TELEMETRY',
      source: PLAUD_TELEMETRY.source,
      event: {
        stage: stage,
        action: action,
        success: success,
        timestamp: new Date().toISOString(),
        correlationId: correlationId,
        data: sanitizeData(data)
      }
    };

    if (PLAUD_TELEMETRY.debug) {
      console.log('[PlaudTelemetry]', stage, action, telemetry);
    }

    // Try Chrome extension first (Observer extension listens for this)
    if (PLAUD_TELEMETRY.useExtension) {
      window.dispatchEvent(new CustomEvent('OBSERVER_TELEMETRY', {
        detail: telemetry
      }));
    }

    // Also send directly to Observer server as fallback
    sendToServer(telemetry);
  }

  /**
   * Send event directly to Observer server
   */
  async function sendToServer(event) {
    try {
      const response = await fetch(`${PLAUD_TELEMETRY.serverUrl}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event)
      });

      if (!response.ok && PLAUD_TELEMETRY.debug) {
        console.warn('[PlaudTelemetry] Server send failed:', response.status);
      }
    } catch (err) {
      if (PLAUD_TELEMETRY.debug) {
        console.warn('[PlaudTelemetry] Server unreachable:', err.message);
      }
    }
  }

  /**
   * Generate correlation ID for tracking related events
   */
  function generateCorrelationId() {
    return `plaud_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Sanitize data to remove sensitive information
   */
  function sanitizeData(data) {
    const sanitized = { ...data };

    // Remove or mask sensitive fields
    const sensitiveFields = ['ssn', 'password', 'token', 'apiKey'];
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });

    // Mask patient identifiers for telemetry (keep structure, hide values)
    if (sanitized.mrn) {
      sanitized.mrnPresent = true;
      sanitized.mrn = sanitized.mrn.substring(0, 3) + '***';
    }
    if (sanitized.dateOfBirth) {
      sanitized.dobPresent = true;
      delete sanitized.dateOfBirth;
    }
    if (sanitized.firstName || sanitized.lastName) {
      sanitized.namePresent = true;
      delete sanitized.firstName;
      delete sanitized.lastName;
    }

    return sanitized;
  }

  // ============================================================================
  // AUTOMATIC INSTRUMENTATION
  // ============================================================================

  /**
   * Intercept fetch requests to instrument API calls
   */
  const originalFetch = window.fetch;
  window.fetch = async function(url, options = {}) {
    const startTime = Date.now();
    const method = options.method || 'GET';
    const correlationId = generateCorrelationId();

    // Parse URL for endpoint info
    const urlObj = new URL(url, window.location.origin);
    const endpoint = urlObj.pathname;

    // Emit request start event
    emit('api', `${method}_REQUEST`, {
      endpoint: endpoint,
      correlationId: correlationId
    });

    try {
      const response = await originalFetch.call(this, url, options);
      const duration = Date.now() - startTime;

      // Determine stage based on endpoint
      let stage = 'api';
      let action = `${method}_${endpoint.replace(/\//g, '_').toUpperCase()}`;
      let eventData = {
        endpoint: endpoint,
        statusCode: response.status,
        durationMs: duration,
        correlationId: correlationId
      };

      // Specific endpoint handling
      if (endpoint === '/upload') {
        stage = 'upload';
        action = 'TRANSCRIPT_SUBMITTED';

        // Try to get response data for success metrics
        const clonedResponse = response.clone();
        try {
          const responseData = await clonedResponse.json();
          eventData.patientId = responseData.patientId;
          eventData.recordId = responseData.recordId;
          eventData.category = responseData.category;
          eventData.confidence = responseData.confidence;
          eventData.tagsCount = responseData.tags;
        } catch (e) {
          // Response not JSON
        }
      } else if (endpoint === '/patients') {
        stage = 'query';
        action = 'PATIENTS_LOADED';

        const clonedResponse = response.clone();
        try {
          const patients = await clonedResponse.json();
          eventData.patientCount = Array.isArray(patients) ? patients.length : 0;
        } catch (e) {}
      } else if (endpoint.startsWith('/records/')) {
        stage = 'query';
        action = 'RECORDS_RETRIEVED';
        eventData.mrnQueried = endpoint.split('/')[2];
      }

      emit(stage, action, eventData, response.ok);

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;

      emit('api', 'REQUEST_FAILED', {
        endpoint: endpoint,
        error: error.message,
        durationMs: duration,
        correlationId: correlationId
      }, false);

      throw error;
    }
  };

  // ============================================================================
  // UI EVENT TRACKING
  // ============================================================================

  /**
   * Track tab navigation
   */
  function trackTabNavigation() {
    document.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab], .tab, [role="tab"]');
      if (tab) {
        emit('navigation', 'TAB_SELECTED', {
          tabName: tab.textContent?.trim() || tab.dataset.tab || 'unknown',
          tabId: tab.id || null
        });
      }
    });
  }

  /**
   * Track form submissions
   */
  function trackFormSubmissions() {
    document.addEventListener('submit', (e) => {
      const form = e.target;
      const formId = form.id || form.name || 'unknown';

      // Get form field names (not values) for structure tracking
      const fields = Array.from(form.elements)
        .filter(el => el.name)
        .map(el => el.name);

      emit('form', 'FORM_SUBMITTED', {
        formId: formId,
        fieldCount: fields.length,
        fields: fields
      });
    });
  }

  /**
   * Track clinical queries
   */
  function trackClinicalQueries() {
    // Look for query input and button
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            // Check for AI response elements
            const aiResponse = node.querySelector?.('.ai-response, .query-result, [data-ai-response]');
            if (aiResponse) {
              emit('ai-query', 'RESPONSE_RECEIVED', {
                responseLength: aiResponse.textContent?.length || 0,
                hasStructuredData: aiResponse.querySelector('table, ul, ol') !== null
              });
            }
          }
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================================
  // DATA QUALITY TRACKING
  // ============================================================================

  /**
   * Assess data completeness for uploaded transcripts
   */
  function assessUploadCompleteness(formData) {
    const requiredFields = ['firstName', 'lastName', 'dateOfBirth', 'mrn', 'transcript'];
    const optionalFields = ['birthSex', 'race', 'recordType', 'subtype', 'title'];

    const missingRequired = requiredFields.filter(f => !formData[f]);
    const missingOptional = optionalFields.filter(f => !formData[f]);

    const completeness = {
      score: Math.round(((requiredFields.length - missingRequired.length) / requiredFields.length) * 100),
      missingRequired: missingRequired,
      missingOptional: missingOptional,
      transcriptLength: formData.transcript?.length || 0
    };

    emit('data-quality', 'UPLOAD_COMPLETENESS', completeness, missingRequired.length === 0);

    return completeness;
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  function init() {
    console.log(`[PlaudTelemetry] Initializing v${PLAUD_TELEMETRY.version}`);

    // Start tracking
    trackTabNavigation();
    trackFormSubmissions();
    trackClinicalQueries();

    // Emit startup event
    emit('system', 'TELEMETRY_INITIALIZED', {
      version: PLAUD_TELEMETRY.version,
      userAgent: navigator.userAgent,
      url: window.location.href
    });

    console.log('[PlaudTelemetry] Ready - events will be sent to Observer');
  }

  // Wait for DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose API for manual event emission
  window.PlaudTelemetry = {
    emit: emit,
    assessUploadCompleteness: assessUploadCompleteness,
    config: PLAUD_TELEMETRY
  };

})();
