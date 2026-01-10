# Observer Integrations

This directory contains telemetry clients for integrating applications with the Medical Mirror Observer.

## Available Integrations

### 1. Plaud AI Uploader (`plaud-ai-telemetry.js`)

Telemetry client for the Albany Vascular AI Uploader application.

**Installation Options:**

#### Option A: Add to Application Source
```html
<!-- Add before </body> in index.html -->
<script src="plaud-ai-telemetry.js"></script>
```

#### Option B: Inject via Browser Console
Copy and paste the contents of `plaud-ai-telemetry.js` into the browser console while viewing the Plaud AI app.

#### Option C: Bookmarklet
Create a bookmark with this URL (minified version):
```javascript
javascript:(function(){var s=document.createElement('script');s.src='http://localhost:3000/integrations/plaud-ai-telemetry.js';document.body.appendChild(s);})();
```

**Events Captured:**
- `upload/TRANSCRIPT_SUBMITTED` - When transcripts are uploaded
- `query/PATIENTS_LOADED` - When patient list is fetched
- `query/RECORDS_RETRIEVED` - When medical records are loaded
- `navigation/TAB_SELECTED` - Tab navigation events
- `form/FORM_SUBMITTED` - Form submissions
- `ai-query/RESPONSE_RECEIVED` - AI query responses
- `data-quality/UPLOAD_COMPLETENESS` - Data quality assessments

**Manual Event Emission:**
```javascript
// Emit custom event
PlaudTelemetry.emit('custom-stage', 'CUSTOM_ACTION', { key: 'value' });

// Assess upload completeness
PlaudTelemetry.assessUploadCompleteness({
  firstName: 'John',
  lastName: 'Doe',
  mrn: '12345',
  transcript: 'Patient presented with...'
});
```

---

## Creating New Integrations

To add telemetry to a new application:

1. **Copy the template:**
   ```bash
   cp plaud-ai-telemetry.js my-app-telemetry.js
   ```

2. **Update the config:**
   ```javascript
   const MY_APP_TELEMETRY = {
     source: 'my-app-name',  // Unique identifier
     version: '1.0.0',
     serverUrl: 'http://localhost:3000'
   };
   ```

3. **Customize instrumentation:**
   - Add endpoint-specific tracking in the fetch interceptor
   - Add UI event handlers for your app's interactions

4. **Test:**
   - Inject the script into your app
   - Check Observer dashboard for incoming events
   - Run analysis: `curl -X POST http://localhost:3000/api/analyze -H "Content-Type: application/json" -d '{"filters":{"source":"my-app-name"}}'`

---

## Observer API Reference

**Send Events:**
```javascript
// Via Chrome Extension (preferred)
window.dispatchEvent(new CustomEvent('OBSERVER_TELEMETRY', {
  detail: {
    source: 'app-name',
    stage: 'stage-name',
    action: 'ACTION_NAME',
    success: true,
    timestamp: new Date().toISOString(),
    data: { /* custom data */ }
  }
}));

// Direct to Server
fetch('http://localhost:3000/api/events', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(event)
});
```

**Query Events:**
```bash
# Get stats
curl http://localhost:3000/api/events/stats

# Get events for source
curl "http://localhost:3000/api/events?source=plaud-ai-uploader"

# Run analysis
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"provider":"claude","analysisType":"recommendations","filters":{"source":"plaud-ai-uploader"}}'

# Get recommendations
curl http://localhost:3000/api/references/plaud-ai-uploader
```
