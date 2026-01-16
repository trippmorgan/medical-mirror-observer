# Medical Mirror Observer - Claude Context

## Project Overview
AI-powered telemetry system that monitors medical applications. It observes, analyzes, and advises on your medical data pipeline.

## Architecture
- **Server** (Node.js/Express) - Port 3000 - Stores events, runs AI analysis
- **Dashboard** (React/Vite) - Port 5173 - Visual interface for recommendations
- **Chrome Extension** - Captures events from web apps via postMessage

## Key Commands
```bash
# Start server
cd server && npm start

# Start dashboard
cd dashboard && npm run dev

# Test the server
curl http://localhost:3000/health
```

## API Endpoints
- `POST /api/events` - Receive telemetry
- `GET /api/events` - Query events
- `POST /api/analyze` - Run AI analysis
- `GET /api/references` - Get recommendations

## Related Projects
- **scc-project-enhanced** - Surgical Command Center (sends telemetry here)
- **athena-scraper** - Medical data scraper (sends telemetry here)

## Claude Team Integration
This project is part of a multi-window Claude Team setup:
- Use `share_with_team` to broadcast updates
- Use `ask_team_claude` to query other Claude instances
- Use `get_team_status` to see connected windows

## Current Status
- Server: Running on port 3000
- Dashboard: Running on port 5173
- Events captured: 5,658+
- Sources: athena-scraper, surgical-command-center, plaud-ai-uploader
