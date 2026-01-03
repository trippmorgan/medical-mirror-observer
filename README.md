# Medical Mirror Observer

A reusable Chrome extension and backend service for monitoring data flow in medical applications.

## Purpose

- **Observe** data flow through any medical application's pipeline
- **Record** events for debugging and analysis
- **Alert** on anomalies, errors, or data flow issues
- **Report** pipeline health and performance metrics

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Medical Mirror Observer                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐                    │
│  │ Chrome Extension │───▶│  Observer Core  │                    │
│  │ (Telemetry Rx)   │    │  (Analysis)     │                    │
│  └─────────────────┘    └─────────────────┘                    │
│           │                      │                              │
│           ▼                      ▼                              │
│  ┌─────────────────┐    ┌─────────────────┐                    │
│  │   Event Store   │    │   Dashboard     │                    │
│  │   (IndexedDB)   │    │   (React)       │                    │
│  └─────────────────┘    └─────────────────┘                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Integration

Any medical application can emit telemetry to the observer:

```javascript
// In your application's code
window.postMessage({
  type: 'OBSERVER_TELEMETRY',
  source: 'your-app-name',
  event: {
    stage: 'interceptor',      // Pipeline stage
    action: 'capture',         // What happened
    success: true,
    data: { /* event-specific data */ },
    timestamp: new Date().toISOString()
  }
}, '*');
```

## Directory Structure

```
medical-mirror-observer/
├── extension/           # Chrome Extension
│   ├── manifest.json
│   ├── observer-injector.js
│   └── background.js
├── core/               # AI Analysis Agents
│   └── observer_agents.py
├── dashboard/          # React UI
│   └── ObserverDashboard.tsx
├── protocols/          # Integration specs
│   └── telemetry-schema.json
└── storage/            # Event persistence
    └── (IndexedDB)
```

## Supported Projects

- Athena Scraper (Shadow EHR)
- (Future medical applications)

## License

Private - Medical use only
