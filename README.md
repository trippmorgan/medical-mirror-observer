# Medical Mirror Observer

**The Architect for Your Medical Data Pipeline**

A meta-layer system that observes, analyzes, and advises on your medical application ecosystem.
Think of it as an AI-powered engineer that watches your programs run, identifies problems,
and recommends improvements - so you can focus on what matters.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         OBSERVER ARCHITECTURE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Your Applications                    The Observer                         │
│   ─────────────────                    ────────────                         │
│                                                                             │
│   ┌─────────────────┐                  ┌─────────────────────────────────┐  │
│   │ athena-scraper  │ ──telemetry───▶  │         OBSERVE                 │  │
│   └─────────────────┘                  │   Capture events from all apps  │  │
│                                        └───────────────┬─────────────────┘  │
│   ┌─────────────────┐                                  │                    │
│   │ clinical-app    │ ──telemetry───▶                  ▼                    │
│   └─────────────────┘                  ┌─────────────────────────────────┐  │
│                                        │         ANALYZE                 │  │
│   ┌─────────────────┐                  │   AI identifies patterns,       │  │
│   │ future-apps...  │ ──telemetry───▶  │   errors, and opportunities     │  │
│   └─────────────────┘                  └───────────────┬─────────────────┘  │
│                                                        │                    │
│                                                        ▼                    │
│                                        ┌─────────────────────────────────┐  │
│   ┌─────────────────┐                  │         ADVISE                  │  │
│   │   Dashboard     │ ◀──────────────  │   Recommendations & action      │  │
│   │   (You)         │                  │   items for improvement         │  │
│   └─────────────────┘                  └───────────────┬─────────────────┘  │
│          │                                             │                    │
│          │ You decide what to implement                ▼                    │
│          │                             ┌─────────────────────────────────┐  │
│          └────────────────────────────▶│   SHARED REFERENCES             │  │
│                                        │   Recommendations available     │  │
│                                        │   to all connected apps         │  │
│                                        └─────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## What It Does

### 1. OBSERVE
Captures telemetry events from all your medical applications in real-time.
Events include pipeline stages, successes, failures, timing, and custom data.

### 2. ANALYZE
AI (Claude, Gemini, OpenAI) examines the event patterns and identifies:
- **Errors** - What's breaking and why
- **Performance** - What's slow and bottlenecks
- **Patterns** - Normal vs abnormal behavior
- **Opportunities** - How to improve

### 3. ADVISE
Presents findings in a dashboard with:
- Actionable recommendations
- Priority rankings (critical → low)
- Specific code/config changes to make
- Historical trend analysis

### 4. SHARE
Stores recommendations in a shared location that:
- Your applications can read
- Enables automated responses
- Creates a feedback loop

---

## Quick Start

### Prerequisites

- **Node.js 20+** - [Download](https://nodejs.org/)
- **Chrome browser**
- **API key** for at least one AI provider

### 1. Start the Backend Server

```bash
cd server
npm install
cp ../.env.example .env
# Edit .env - add at least one API key
npm start
```

### 2. Install Chrome Extension

1. Go to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `extension/` folder

### 3. Open the Dashboard

```bash
# In a new terminal
cd dashboard
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

### 4. Connect Your App (e.g., athena-scraper)

In your application, emit telemetry:

```javascript
window.postMessage({
  type: 'OBSERVER_TELEMETRY',
  source: 'athena-scraper',  // Your app name
  event: {
    stage: 'interceptor',
    action: 'capture',
    success: true,
    timestamp: new Date().toISOString(),
    data: { patientId: '12345', recordType: 'vitals' }
  }
}, '*');
```

---

## Integration with athena-scraper

The Observer and athena-scraper work together:

```
┌─────────────────────┐                    ┌─────────────────────┐
│   athena-scraper    │                    │      Observer       │
├─────────────────────┤                    ├─────────────────────┤
│                     │                    │                     │
│  1. Emits events ───┼──── telemetry ────▶│  2. Stores events   │
│                     │                    │                     │
│                     │                    │  3. AI analyzes     │
│                     │                    │                     │
│  5. Reads recs  ◀───┼── shared refs ◀────│  4. Writes recs     │
│     (optional)      │                    │                     │
│                     │                    │                     │
│  6. Applies fixes   │                    │  Dashboard shows    │
│     as you decide   │                    │  findings to user   │
│                     │                    │                     │
└─────────────────────┘                    └─────────────────────┘
```

### Shared References

The Observer writes recommendations to `server/data/references/`:

```json
{
  "lastUpdated": "2024-01-15T10:30:00Z",
  "source": "athena-scraper",
  "recommendations": [
    {
      "id": "rec_abc123",
      "priority": "high",
      "category": "error_handling",
      "title": "Add retry logic to API calls",
      "description": "Seeing 15% failure rate on /api/patient calls...",
      "suggestedFix": "Implement exponential backoff...",
      "affectedFiles": ["src/api/patient.js"]
    }
  ],
  "metrics": {
    "errorRate": "15%",
    "avgLatency": "234ms",
    "healthScore": 72
  }
}
```

athena-scraper can optionally read this file to display warnings or auto-apply safe fixes.

---

## API Reference

### Events API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/events` | POST | Receive telemetry |
| `/api/events` | GET | Query events |
| `/api/events/stats` | GET | Statistics |

### Analysis API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/analyze` | POST | Run AI analysis |
| `/api/analyze/history` | GET | Past analyses |
| `/api/analyze/providers` | GET | Available AI |

### References API (NEW)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/references` | GET | Get all recommendations |
| `/api/references/:source` | GET | Get recs for specific app |
| `/api/references/:source` | PUT | Update recs (after analysis) |

### Export API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/export` | GET | Download as JSON/CSV |

---

## Dashboard

The dashboard provides a visual interface for understanding your pipeline health:

### Overview Tab
- Health score (0-100)
- Event count & error rate
- Active sources

### Recommendations Tab
- AI-generated action items
- Priority ranking
- Affected components
- One-click to view details

### Events Tab
- Real-time event stream
- Filter by source, stage, success
- Click to expand details

### Analysis Tab
- Run new analyses
- View historical analyses
- Compare trends over time

---

## Directory Structure

```
medical-mirror-observer/
├── extension/              # Chrome Extension (captures events)
│   ├── manifest.json
│   ├── background.js       # Forwards to server
│   └── observer-injector.js
│
├── server/                 # Backend (stores, analyzes, advises)
│   ├── src/
│   │   ├── routes/
│   │   │   ├── events.js
│   │   │   ├── analysis.js
│   │   │   ├── references.js   # NEW: Shared recommendations
│   │   │   └── export.js
│   │   ├── ai/             # AI analysis providers
│   │   └── storage/
│   └── data/
│       ├── events/         # Telemetry events (by date)
│       ├── analysis/       # AI analysis results
│       └── references/     # Shared recommendations (NEW)
│
├── dashboard/              # React UI (view recommendations)
│   ├── src/
│   │   ├── components/
│   │   └── pages/
│   └── package.json
│
└── protocols/
    └── telemetry-schema.json
```

---

## Configuration

### Server (.env)

```bash
PORT=3000
RETENTION_DAYS=30

# AI Keys (at least one)
ANTHROPIC_API_KEY=
GOOGLE_AI_API_KEY=
OPENAI_API_KEY=
```

---

## The Philosophy

**You are the decision maker.**

The Observer doesn't automatically change your code or config.
It watches, analyzes, and recommends - then you decide what to implement.

This keeps you in control while giving you AI-powered insights
that would take hours to discover manually.

---

## License

Private - Medical use only
