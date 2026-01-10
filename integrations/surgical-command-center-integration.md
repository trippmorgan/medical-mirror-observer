# Surgical Command Center - Observer Integration Specification

**Version:** 1.0.0
**Date:** 2026-01-06
**Status:** Ready for Implementation

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview](#2-system-overview)
3. [Network Architecture & Port Mapping](#3-network-architecture--port-mapping)
4. [Database Integration](#4-database-integration)
5. [Telemetry Event Schema](#5-telemetry-event-schema)
6. [Data Flow Pipelines](#6-data-flow-pipelines)
7. [WebUI Integration](#7-webui-integration)
8. [Bidirectional API Integration](#8-bidirectional-api-integration)
9. [Implementation Guide](#9-implementation-guide)
10. [Master Architecture Map](#10-master-architecture-map)

---

## 1. Executive Summary

### What is Surgical Command Center?

A real-time surgical procedure documentation system for vascular surgery that enables:
- Hands-free voice dictation during procedures
- Automatic structured data extraction from natural language (Dragon AI + Gemini)
- Integration with UltraLinq PACS for medical imaging
- Real-time WebSocket synchronization across devices

### Integration Goals

1. **Observe** - Capture telemetry from all 9 pipeline stages
2. **Analyze** - Use AI to identify surgical workflow bottlenecks
3. **Advise** - Provide recommendations for Dragon AI, UltraLinq, and procedure optimization
4. **Unify** - Connect surgical data with athena-scraper and Plaud AI ecosystems

---

## 2. System Overview

### Architecture Type

| Property | Value |
|----------|-------|
| Type | Monolith with service connectors |
| Language | Node.js (JavaScript) |
| Framework | Express.js 4.18 |
| ORM | Sequelize 6.37 |
| Real-time | ws (WebSocket) library |
| Frontend | Vanilla JavaScript (static HTML) |

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    SURGICAL COMMAND CENTER ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                         FRONTEND LAYER (Static HTML/JS)                  │    │
│  │                                                                          │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   │    │
│  │  │  index.html  │  │patient-lookup│  │ patient-input│                   │    │
│  │  │  (Main UI)   │  │    .html     │  │    .html     │                   │    │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                   │    │
│  │         │                 │                 │                            │    │
│  │         └────────────────┬┴─────────────────┘                            │    │
│  │                          │                                               │    │
│  │  ┌───────────────────────▼───────────────────────┐                      │    │
│  │  │           connection-config.js                 │                      │    │
│  │  │  • BACKEND_URL: localhost:3001                 │                      │    │
│  │  │  • WS_URL: ws://localhost:3001                 │                      │    │
│  │  └───────────────────────┬───────────────────────┘                      │    │
│  │                          │                                               │    │
│  │  ┌───────────────────────▼───────────────────────┐                      │    │
│  │  │           websocket-client.js                  │  ◄── INJECT         │    │
│  │  │  • Real-time transcription display             │      TELEMETRY      │    │
│  │  │  • Voice command handling                      │      HERE           │    │
│  │  │  • Field synchronization                       │                      │    │
│  │  └───────────────────────────────────────────────┘                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                    │                                             │
│                      HTTP REST + WebSocket                                       │
│                                    │                                             │
│  ┌─────────────────────────────────▼───────────────────────────────────────┐    │
│  │                   BACKEND LAYER (Express.js :3001)                       │    │
│  │                                                                          │    │
│  │  ┌─────────────────────────────────────────────────────────────────┐    │    │
│  │  │                      MIDDLEWARE PIPELINE                         │    │    │
│  │  │  Helmet → CORS → JSON → Morgan → [Telemetry] → Route Handler     │    │    │
│  │  └─────────────────────────────────────────────────────────────────┘    │    │
│  │                                                                          │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐        │    │
│  │  │ /api/       │ │ /api/       │ │ /api/       │ │ /api/       │        │    │
│  │  │ patients    │ │ procedures  │ │ dragon      │ │ ultralinq   │        │    │
│  │  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘        │    │
│  │         │               │               │               │                │    │
│  │  ┌──────▼───────────────▼───────────────▼───────────────▼──────┐        │    │
│  │  │                    WebSocket Server (ws://:3001)             │        │    │
│  │  │  • Dragon ↔ UI synchronization                               │        │    │
│  │  │  • Real-time transcription broadcast                         │        │    │
│  │  └─────────────────────────────────────────────────────────────┘        │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                    │                                             │
│              ┌─────────────────────┼─────────────────────┐                      │
│              │                     │                     │                      │
│              ▼                     ▼                     ▼                      │
│  ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐              │
│  │    PostgreSQL     │ │    Dragon AI      │ │    UltraLinq      │              │
│  │  100.101.184.20   │ │  100.101.184.20   │ │ app.ultralinq.net │              │
│  │      :5432        │ │      :5005        │ │      :443         │              │
│  └───────────────────┘ └───────────────────┘ └───────────────────┘              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Network Architecture & Port Mapping

### Complete Ecosystem Port Allocation

| System | Service | Port | Protocol | Host | Tailscale IP |
|--------|---------|------|----------|------|--------------|
| **Observer** | Backend API | 3000 | HTTP | 0.0.0.0 | 100.113.243.36 |
| **Surgical Command Center** | Backend + WS | 3001 | HTTP/WS | localhost | 100.113.243.36 |
| **athena-scraper** | Backend | 8000 | HTTP | localhost | 100.113.243.36 |
| **Plaud/Vascular AI** | Backend | 8001 | HTTP | 0.0.0.0 | 100.75.237.36 |
| **Dragon AI** | Speech Service | 5005 | HTTP/WS | 0.0.0.0 | 100.101.184.20 |
| **PostgreSQL (Surgical)** | Database | 5432 | TCP | 0.0.0.0 | 100.101.184.20 |
| **PostgreSQL (Plaud)** | Database | 5432 | TCP | 0.0.0.0 | 100.75.237.36 |
| **UltraLinq** | PACS | 443 | HTTPS | External | app.ultralinq.net |

### Port Conflict Analysis

```
✅ NO PORT CONFLICTS DETECTED

Machine: Tripp's MacBook Pro (100.113.243.36)
├── 3000  → Observer
├── 3001  → Surgical Command Center
└── 8000  → athena-scraper

Machine: ThinkServer (100.75.237.36)
├── 5432  → PostgreSQL (Plaud DB)
└── 8001  → Plaud/Vascular AI

Machine: Voldemort (100.101.184.20)
├── 5432  → PostgreSQL (Surgical DB)
└── 5005  → Dragon AI
```

### Network Topology

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         TAILSCALE MESH NETWORK                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌──────────────────────────────────────────────────────────────────┐          │
│   │  TRIPP'S MACBOOK PRO (100.113.243.36)                            │          │
│   │                                                                   │          │
│   │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │          │
│   │   │  Observer   │  │  Surgical   │  │   athena-   │              │          │
│   │   │    :3000    │  │ Cmd Center  │  │   scraper   │              │          │
│   │   │             │  │    :3001    │  │    :8000    │              │          │
│   │   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │          │
│   │          │                │                │                      │          │
│   └──────────┼────────────────┼────────────────┼──────────────────────┘          │
│              │                │                │                                  │
│              │    Tailscale   │                │                                  │
│              │    100.x.x.x   │                │                                  │
│              │                │                │                                  │
│   ┌──────────┼────────────────┼────────────────┼──────────────────────┐          │
│   │          │                │                │                      │          │
│   │   ┌──────▼──────┐  ┌──────▼──────┐                               │          │
│   │   │  Plaud AI   │  │  PostgreSQL │   THINKSERVER                 │          │
│   │   │    :8001    │  │    :5432    │   (100.75.237.36)             │          │
│   │   └─────────────┘  └─────────────┘                               │          │
│   │                                                                   │          │
│   └───────────────────────────────────────────────────────────────────┘          │
│                                                                                  │
│   ┌───────────────────────────────────────────────────────────────────┐          │
│   │                                                                   │          │
│   │   ┌─────────────┐  ┌─────────────┐   VOLDEMORT                   │          │
│   │   │  Dragon AI  │  │  PostgreSQL │   (100.101.184.20)            │          │
│   │   │    :5005    │  │    :5432    │                               │          │
│   │   └─────────────┘  └─────────────┘                               │          │
│   │                                                                   │          │
│   └───────────────────────────────────────────────────────────────────┘          │
│                                                                                  │
│   ┌───────────────────────────────────────────────────────────────────┐          │
│   │                                                                   │          │
│   │   ┌─────────────┐                    EXTERNAL                    │          │
│   │   │  UltraLinq  │  app.ultralinq.net:443                         │          │
│   │   │    PACS     │                                                │          │
│   │   └─────────────┘                                                │          │
│   │                                                                   │          │
│   └───────────────────────────────────────────────────────────────────┘          │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Database Integration

### Database Inventory

| Database | Host | Port | Name | Purpose |
|----------|------|------|------|---------|
| Surgical DB | 100.101.184.20 | 5432 | surgical_command_center | Procedures, patients |
| Plaud DB | 100.75.237.36 | 5432 | plaud_vascular | Clinical events, transcripts |

### Surgical Command Center Schema

#### Table: `patients`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| mrn | VARCHAR (UNIQUE) | Medical Record Number |
| first_name | VARCHAR | Patient first name |
| last_name | VARCHAR | Patient last name |
| date_of_birth | DATE | DOB |
| gender | VARCHAR | Gender |
| allergies | TEXT | Allergies list |
| medical_history | TEXT | Medical history |
| active | BOOLEAN | Active status |
| createdAt | TIMESTAMP | Creation timestamp |
| updatedAt | TIMESTAMP | Last update |

#### Table: `procedures`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| mrn | VARCHAR (FK) | Links to patient |
| patient_name | VARCHAR | Cached patient name |
| procedure_type | VARCHAR | Type of procedure |
| procedure_date | TIMESTAMP | Procedure date |
| surgeon | VARCHAR | Surgeon name |
| procedure_side | VARCHAR | Left/Right/Bilateral |
| status | ENUM | draft/in_progress/completed/finalized |
| narrative | TEXT | Generated narrative |
| ultralinq_data | JSONB | Cached imaging data |
| athena_data | JSONB | Cached EMR data |
| vessel_* | JSONB | Vessel-specific data columns |
| voice_commands_used | INTEGER | Voice command count |
| procedure_duration | INTEGER | Duration in minutes |
| complications | TEXT | Complications notes |
| createdAt | TIMESTAMP | Creation timestamp |
| updatedAt | TIMESTAMP | Last update |

### Credentials

```bash
# Surgical Command Center Database
SURGICAL_DB_HOST=100.101.184.20
SURGICAL_DB_PORT=5432
SURGICAL_DB_NAME=surgical_command_center
SURGICAL_DB_USER=surgical_user
SURGICAL_DB_PASSWORD=JH2568jh8

# UltraLinq PACS (Puppeteer login)
ULTRALINQ_USERNAME=jhmorgan
ULTRALINQ_PASSWORD=JH2568jh8
```

### Query for Observer: Recent Surgical Events

```sql
SELECT
  p.id AS procedure_id,
  p.mrn,
  p.patient_name,
  p.procedure_type,
  p.procedure_date,
  p.surgeon,
  p.status,
  p.voice_commands_used,
  p.procedure_duration,
  p.complications,
  p."createdAt" AS created_at,
  p."updatedAt" AS updated_at
FROM procedures p
WHERE p."updatedAt" > NOW() - INTERVAL '24 hours'
ORDER BY p."updatedAt" DESC
LIMIT 100;
```

---

## 5. Telemetry Event Schema

### Source Identifier

```
source: "surgical-command-center"
```

### Pipeline Stages

| Stage | Description | Key Metrics |
|-------|-------------|-------------|
| `patient_lookup` | Patient search and selection | Search latency, hit rate |
| `procedure_create` | New procedure creation | Creation success rate |
| `voice_capture` | Audio recording | Recording duration, quality |
| `transcription` | Whisper speech-to-text | Latency (<500ms target), confidence |
| `nlp_extraction` | Gemini data extraction | Extraction accuracy, field mapping |
| `field_update` | Form field changes | Sync latency, validation errors |
| `procedure_save` | Database persistence | Save success rate |
| `imaging_fetch` | UltraLinq PACS retrieval | Fetch latency, login success |
| `websocket` | Real-time communication | Connection stability |

### Complete Event Catalog

#### Stage: `patient_lookup`

```json
{
  "type": "OBSERVER_TELEMETRY",
  "source": "surgical-command-center",
  "event": {
    "stage": "patient_lookup",
    "action": "SEARCH_COMPLETED",
    "success": true,
    "timestamp": "2026-01-07T10:00:00.000Z",
    "duration_ms": 45,
    "data": {
      "searchTerm": "12345",
      "resultCount": 1,
      "mrn": "MRN-12345"
    },
    "correlationId": "scc_proc_abc123"
  }
}
```

**Actions:**
- `SEARCH_INITIATED` - User submitted search
- `SEARCH_COMPLETED` - Results returned
- `SEARCH_FAILED` - Database/network error
- `PATIENT_SELECTED` - User clicked patient
- `PATIENT_NOT_FOUND` - No matching patient

#### Stage: `procedure_create`

```json
{
  "type": "OBSERVER_TELEMETRY",
  "source": "surgical-command-center",
  "event": {
    "stage": "procedure_create",
    "action": "CREATE_COMPLETED",
    "success": true,
    "timestamp": "2026-01-07T10:01:00.000Z",
    "duration_ms": 120,
    "data": {
      "procedureId": "uuid-here",
      "mrn": "MRN-12345",
      "procedureType": "Lower Extremity Angiogram",
      "surgeon": "Dr. Morgan"
    },
    "correlationId": "scc_proc_abc123"
  }
}
```

**Actions:**
- `CREATE_INITIATED` - Form opened
- `CREATE_COMPLETED` - Saved to database
- `CREATE_FAILED` - Validation/database error
- `PATIENT_LINKED` - MRN associated

#### Stage: `voice_capture`

```json
{
  "type": "OBSERVER_TELEMETRY",
  "source": "surgical-command-center",
  "event": {
    "stage": "voice_capture",
    "action": "RECORDING_STARTED",
    "success": true,
    "timestamp": "2026-01-07T10:05:00.000Z",
    "data": {
      "clientId": "dragon-client-1",
      "procedureId": "uuid-here"
    },
    "correlationId": "scc_proc_abc123"
  }
}
```

**Actions:**
- `WS_CONNECTED` - Dragon client connected
- `WS_DISCONNECTED` - Dragon client disconnected
- `RECORDING_STARTED` - Microphone capture began
- `RECORDING_STOPPED` - Audio capture ended
- `AUDIO_UPLOADED` - Audio sent to Dragon AI

#### Stage: `transcription`

```json
{
  "type": "OBSERVER_TELEMETRY",
  "source": "surgical-command-center",
  "event": {
    "stage": "transcription",
    "action": "TRANSCRIBE_COMPLETED",
    "success": true,
    "timestamp": "2026-01-07T10:05:02.000Z",
    "duration_ms": 450,
    "data": {
      "audioLength": 5.2,
      "textLength": 156,
      "confidence": 0.95,
      "model": "whisper-large-v3"
    },
    "correlationId": "scc_proc_abc123"
  }
}
```

**Actions:**
- `TRANSCRIBE_SENT` - Audio submitted to Whisper
- `TRANSCRIBE_COMPLETED` - Text returned
- `TRANSCRIBE_FAILED` - Whisper error
- `BROADCAST_SENT` - Text sent to UI clients

#### Stage: `nlp_extraction`

```json
{
  "type": "OBSERVER_TELEMETRY",
  "source": "surgical-command-center",
  "event": {
    "stage": "nlp_extraction",
    "action": "EXTRACT_COMPLETED",
    "success": true,
    "timestamp": "2026-01-07T10:05:03.500Z",
    "duration_ms": 1200,
    "data": {
      "fieldsExtracted": 8,
      "vesselsMentioned": ["SFA", "popliteal"],
      "treatmentsMentioned": ["PTA", "stent"],
      "model": "gemini-1.5-flash"
    },
    "correlationId": "scc_proc_abc123"
  }
}
```

**Actions:**
- `EXTRACT_SENT` - Text submitted to Gemini
- `EXTRACT_COMPLETED` - Structured data returned
- `EXTRACT_FAILED` - Gemini error
- `FIELD_MAPPED` - Data mapped to procedure field

#### Stage: `field_update`

```json
{
  "type": "OBSERVER_TELEMETRY",
  "source": "surgical-command-center",
  "event": {
    "stage": "field_update",
    "action": "FIELD_CHANGED",
    "success": true,
    "timestamp": "2026-01-07T10:05:04.000Z",
    "data": {
      "fieldName": "sfa_stenosis",
      "source": "voice",
      "procedureId": "uuid-here"
    },
    "correlationId": "scc_proc_abc123"
  }
}
```

**Actions:**
- `FIELD_CHANGED` - User or AI updated field
- `SYNC_BROADCAST` - Change sent to other clients
- `SYNC_RECEIVED` - Change received from other client
- `VALIDATION_ERROR` - Invalid field value

#### Stage: `procedure_save`

```json
{
  "type": "OBSERVER_TELEMETRY",
  "source": "surgical-command-center",
  "event": {
    "stage": "procedure_save",
    "action": "SAVE_COMPLETED",
    "success": true,
    "timestamp": "2026-01-07T10:30:00.000Z",
    "duration_ms": 85,
    "data": {
      "procedureId": "uuid-here",
      "status": "completed",
      "voiceCommandsUsed": 24,
      "procedureDuration": 45
    },
    "correlationId": "scc_proc_abc123"
  }
}
```

**Actions:**
- `SAVE_INITIATED` - Save button clicked
- `SAVE_COMPLETED` - Database write successful
- `SAVE_FAILED` - Database error
- `STATUS_CHANGED` - Status updated

#### Stage: `imaging_fetch`

```json
{
  "type": "OBSERVER_TELEMETRY",
  "source": "surgical-command-center",
  "event": {
    "stage": "imaging_fetch",
    "action": "STUDIES_RETRIEVED",
    "success": true,
    "timestamp": "2026-01-07T10:02:00.000Z",
    "duration_ms": 35000,
    "data": {
      "mrn": "MRN-12345",
      "studyCount": 3,
      "imageCount": 12,
      "source": "ultralinq"
    },
    "correlationId": "scc_proc_abc123"
  }
}
```

**Actions:**
- `ULTRALINQ_LOGIN_STARTED` - Puppeteer login initiated
- `ULTRALINQ_LOGIN_COMPLETED` - Successfully logged in
- `ULTRALINQ_LOGIN_FAILED` - Authentication error
- `STUDIES_SEARCH_STARTED` - Patient search initiated
- `STUDIES_RETRIEVED` - Imaging studies extracted
- `STUDIES_EXTRACTION_FAILED` - Scraping error

#### Stage: `websocket`

```json
{
  "type": "OBSERVER_TELEMETRY",
  "source": "surgical-command-center",
  "event": {
    "stage": "websocket",
    "action": "CLIENT_CONNECTED",
    "success": true,
    "timestamp": "2026-01-07T10:00:00.000Z",
    "data": {
      "clientId": "ws-client-1",
      "clientType": "ui",
      "procedureId": "uuid-here"
    },
    "correlationId": "scc_proc_abc123"
  }
}
```

**Actions:**
- `CLIENT_CONNECTED` - New WebSocket client
- `CLIENT_REGISTERED` - Client type set (dragon/ui)
- `CLIENT_DISCONNECTED` - Client left
- `MESSAGE_RECEIVED` - Inbound message
- `MESSAGE_BROADCAST` - Outbound broadcast
- `ERROR` - WebSocket error

---

## 6. Data Flow Pipelines

### Complete Surgical Procedure Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    SURGICAL PROCEDURE DATA PIPELINE                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 1: PATIENT_LOOKUP                                                  │   │
│  │ ├── User scans/enters MRN                                                │   │
│  │ ├── System queries patient database                                      │   │
│  │ └── Fetches UltraLinq imaging history                                    │   │
│  │                                                                          │   │
│  │ Telemetry: SEARCH_INITIATED → SEARCH_COMPLETED/NOT_FOUND                 │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                    ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 2: PROCEDURE_CREATE                                                │   │
│  │ ├── New procedure record created                                         │   │
│  │ ├── Patient data linked via MRN                                          │   │
│  │ └── Status: "draft"                                                      │   │
│  │                                                                          │   │
│  │ Telemetry: CREATE_INITIATED → CREATE_COMPLETED → PATIENT_LINKED          │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                    ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 3: VOICE_CAPTURE (Real-time loop)                                  │   │
│  │ ├── Dragon client connects via WebSocket                                 │   │
│  │ ├── Audio captured from microphone                                       │   │
│  │ └── Sent to Dragon AI for transcription                                  │   │
│  │                                                                          │   │
│  │ Telemetry: WS_CONNECTED → RECORDING_STARTED → AUDIO_UPLOADED             │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                    ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 4: TRANSCRIPTION                                                   │   │
│  │ ├── Whisper converts audio to text                                       │   │
│  │ ├── Raw text broadcast to UI clients                                     │   │
│  │ └── Displayed in real-time (<500ms target)                               │   │
│  │                                                                          │   │
│  │ Telemetry: TRANSCRIBE_SENT → TRANSCRIBE_COMPLETED → BROADCAST_SENT       │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                    ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 5: NLP_EXTRACTION                                                  │   │
│  │ ├── Gemini AI extracts structured data                                   │   │
│  │ ├── Vessel findings, measurements, treatments                            │   │
│  │ └── Mapped to procedure fields                                           │   │
│  │                                                                          │   │
│  │ Telemetry: EXTRACT_SENT → EXTRACT_COMPLETED → FIELD_MAPPED               │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                    ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 6: FIELD_UPDATE (Real-time sync)                                   │   │
│  │ ├── Structured data populates form fields                                │   │
│  │ ├── User can edit/confirm                                                │   │
│  │ └── Synced across all connected clients                                  │   │
│  │                                                                          │   │
│  │ Telemetry: FIELD_CHANGED → SYNC_BROADCAST → SYNC_RECEIVED                │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                    ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 7: PROCEDURE_SAVE                                                  │   │
│  │ ├── Procedure saved to PostgreSQL                                        │   │
│  │ ├── JSONB vessel data stored                                             │   │
│  │ └── Status updated (in_progress → completed)                             │   │
│  │                                                                          │   │
│  │ Telemetry: SAVE_INITIATED → SAVE_COMPLETED → STATUS_CHANGED              │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                    ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 8: IMAGING_FETCH (Optional, async)                                 │   │
│  │ ├── UltraLinq studies retrieved via Puppeteer                            │   │
│  │ ├── Measurements, images, conclusions extracted                          │   │
│  │ └── Cached in procedure.ultralinq_data                                   │   │
│  │                                                                          │   │
│  │ Telemetry: ULTRALINQ_LOGIN → STUDIES_RETRIEVED                           │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                    ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 9: FINALIZE                                                        │   │
│  │ ├── Procedure marked "finalized"                                         │   │
│  │ ├── Narrative generated from structured data                             │   │
│  │ └── Audit trail completed                                                │   │
│  │                                                                          │   │
│  │ Telemetry: STATUS_CHANGED (status=finalized)                             │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. WebUI Integration

### Frontend Files

| File | Purpose | Telemetry Events |
|------|---------|------------------|
| `index.html` | Main surgical UI | Page view, procedure actions |
| `patient-lookup.html` | Patient search | Search, select events |
| `patient-input.html` | New patient form | Form submission |
| `connection-config.js` | Backend URLs | N/A |
| `websocket-client.js` | Real-time sync | WS events |

### Telemetry Script Injection

Create file: `frontend_legacy/js/observer-telemetry.js`

```javascript
/**
 * =============================================================================
 * SURGICAL COMMAND CENTER - OBSERVER TELEMETRY CLIENT
 * =============================================================================
 */

(function() {
  'use strict';

  const SCC_TELEMETRY = {
    source: 'surgical-command-center',
    version: '1.0.0',
    serverUrl: 'http://100.113.243.36:3000',
    debug: true
  };

  // Generate correlation ID for procedure session
  function genCorrelationId() {
    return 'scc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  }

  // Current session correlation ID
  let sessionCorrelationId = genCorrelationId();

  /**
   * Emit telemetry event to Observer
   */
  function emit(stage, action, data = {}, success = true) {
    const event = {
      type: 'OBSERVER_TELEMETRY',
      source: SCC_TELEMETRY.source,
      event: {
        stage: stage,
        action: action,
        success: success,
        timestamp: new Date().toISOString(),
        duration_ms: data.duration_ms,
        correlationId: data.correlationId || sessionCorrelationId,
        data: sanitizeData(data)
      }
    };

    if (SCC_TELEMETRY.debug) {
      console.log('[SCC-Telemetry]', stage, action, event);
    }

    // Send to Observer
    fetch(SCC_TELEMETRY.serverUrl + '/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    }).catch(err => {
      if (SCC_TELEMETRY.debug) {
        console.warn('[SCC-Telemetry] Send failed:', err.message);
      }
    });
  }

  /**
   * Sanitize data to remove PHI
   */
  function sanitizeData(data) {
    const sanitized = { ...data };
    // Remove or mask sensitive fields
    delete sanitized.patientName;
    delete sanitized.firstName;
    delete sanitized.lastName;
    delete sanitized.dateOfBirth;
    delete sanitized.ssn;
    return sanitized;
  }

  /**
   * Start new procedure session
   */
  function startSession(procedureId) {
    sessionCorrelationId = genCorrelationId();
    emit('procedure_create', 'CREATE_INITIATED', { procedureId });
  }

  // Expose API
  window.SCCTelemetry = {
    emit: emit,
    startSession: startSession,
    config: SCC_TELEMETRY
  };

  // Emit page load
  emit('system', 'PAGE_VIEW', {
    page: window.location.pathname,
    userAgent: navigator.userAgent
  });

  console.log('%c[SCC Telemetry] Active - sending to Observer', 'color:green;font-weight:bold');

})();
```

### HTML Integration

Add to each HTML file before `</body>`:

```html
<script src="js/observer-telemetry.js"></script>
```

---

## 8. Bidirectional API Integration

### Observer → Surgical Command Center

#### Fetch Procedures

```
GET http://localhost:3001/api/procedures
```

Query Parameters:
- `status` - Filter by status
- `startDate` / `endDate` - Date range
- `mrn` - Specific patient

Response:
```json
{
  "success": true,
  "count": 25,
  "procedures": [
    {
      "id": "uuid",
      "mrn": "MRN-123456",
      "patient_name": "Smith, John",
      "procedure_type": "Lower Extremity Angiogram",
      "status": "completed",
      "voice_commands_used": 15,
      "procedure_duration": 45
    }
  ]
}
```

#### Fetch Statistics

```
GET http://localhost:3001/api/procedures/stats/summary
```

Response:
```json
{
  "success": true,
  "stats": {
    "total_procedures": 150,
    "by_status": {"draft": 5, "in_progress": 2, "completed": 100, "finalized": 43},
    "avg_duration_minutes": 42,
    "avg_voice_commands": 18,
    "complication_rate": 0.03
  }
}
```

### Surgical Command Center → Observer

#### Push Recommendations (Webhook)

Create endpoint: `POST /api/observer/recommendations`

```json
{
  "source": "medical-mirror-observer",
  "timestamp": "2026-01-07T12:00:00Z",
  "recommendations": [
    {
      "id": "rec-uuid",
      "priority": "high",
      "category": "performance",
      "title": "Dragon AI latency spike detected",
      "description": "Average transcription time increased to 2.5s",
      "affectedComponent": "transcription"
    }
  ]
}
```

---

## 9. Implementation Guide

### Files to Create

#### Frontend: `frontend_legacy/js/observer-telemetry.js`

See Section 7 for full implementation.

#### Backend: `backend/services/observerClient.js`

```javascript
/**
 * Observer Telemetry Client for Backend
 */

const OBSERVER_URL = process.env.OBSERVER_URL || 'http://100.113.243.36:3000';

class ObserverClient {
  constructor() {
    this.enabled = process.env.OBSERVER_ENABLED !== 'false';
  }

  async emit(stage, action, data = {}, success = true) {
    if (!this.enabled) return;

    const event = {
      type: 'OBSERVER_TELEMETRY',
      source: 'surgical-command-center',
      event: {
        stage,
        action,
        success,
        timestamp: new Date().toISOString(),
        duration_ms: data.duration_ms,
        correlationId: data.correlationId,
        data: this.sanitize(data)
      }
    };

    try {
      await fetch(`${OBSERVER_URL}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event)
      });
    } catch (err) {
      console.warn('[Observer] Send failed:', err.message);
    }
  }

  sanitize(data) {
    const { patientName, firstName, lastName, dateOfBirth, ssn, ...safe } = data;
    return safe;
  }
}

module.exports = new ObserverClient();
```

#### Backend: `backend/middleware/telemetryMiddleware.js`

```javascript
/**
 * Express middleware for automatic request telemetry
 */

const observer = require('../services/observerClient');

module.exports = function telemetryMiddleware(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const stage = req.path.startsWith('/api/dragon') ? 'transcription'
                : req.path.startsWith('/api/ultralinq') ? 'imaging_fetch'
                : req.path.startsWith('/api/procedures') ? 'procedure_save'
                : 'api';

    observer.emit(stage, `${req.method}_${req.path}`, {
      duration_ms: duration,
      statusCode: res.statusCode,
      method: req.method,
      path: req.path
    }, res.statusCode < 400);
  });

  next();
};
```

### Environment Variables

Add to `.env`:

```bash
# Observer Integration
OBSERVER_URL=http://100.113.243.36:3000
OBSERVER_ENABLED=true
```

### Testing Checklist

- [ ] Observer server reachable from SCC machine
- [ ] Frontend telemetry script loaded
- [ ] Backend middleware integrated
- [ ] Patient lookup events captured
- [ ] Procedure create events captured
- [ ] Voice capture events captured
- [ ] Transcription events captured
- [ ] NLP extraction events captured
- [ ] Field update events captured
- [ ] Procedure save events captured
- [ ] WebSocket events captured
- [ ] UltraLinq events captured
- [ ] Observer stats show surgical-command-center source

---

## 10. Master Architecture Map

### Complete Medical Mirror Observer Ecosystem

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              MEDICAL MIRROR OBSERVER - COMPLETE ECOSYSTEM                            │
├─────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                      │
│   ┌───────────────────────────────────────────────────────────────────────────────────────────┐     │
│   │                              OBSERVER (100.113.243.36:3000)                                │     │
│   │                                                                                            │     │
│   │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │     │
│   │   │   Events    │  │  Analysis   │  │ References  │  │   Export    │  │   Health    │    │     │
│   │   │    API      │  │     API     │  │     API     │  │     API     │  │    Check    │    │     │
│   │   │  /api/events│  │ /api/analyze│  │/api/references│ │ /api/export│  │   /health   │    │     │
│   │   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────────────┘  └─────────────┘    │     │
│   │          │                │                │                                              │     │
│   │   ┌──────▼────────────────▼────────────────▼──────┐                                      │     │
│   │   │              AI ANALYSIS ENGINE               │                                      │     │
│   │   │  Claude │ Gemini │ OpenAI                     │                                      │     │
│   │   └───────────────────────────────────────────────┘                                      │     │
│   │                                                                                            │     │
│   │   ┌───────────────────────────────────────────────┐                                      │     │
│   │   │           JSON FILE STORAGE                   │                                      │     │
│   │   │  data/events/ │ data/analysis/ │ data/refs/  │                                      │     │
│   │   └───────────────────────────────────────────────┘                                      │     │
│   │                                                                                            │     │
│   └───────────────────────────────────────────────────────────────────────────────────────────┘     │
│                                            ▲                                                         │
│                    ┌───────────────────────┼───────────────────────┐                                │
│                    │                       │                       │                                │
│   ┌────────────────┼───────────────────────┼───────────────────────┼────────────────┐               │
│   │                │                       │                       │                │               │
│   │                ▼                       ▼                       ▼                │               │
│   │  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐     │               │
│   │  │   ATHENA-SCRAPER    │  │ SURGICAL CMD CENTER │  │  PLAUD/VASCULAR AI  │     │               │
│   │  │  100.113.243.36:8000│  │ 100.113.243.36:3001 │  │  100.75.237.36:8001 │     │               │
│   │  │                     │  │                     │  │                     │     │               │
│   │  │ Stages:             │  │ Stages:             │  │ Stages:             │     │               │
│   │  │ • interceptor       │  │ • patient_lookup    │  │ • upload            │     │               │
│   │  │ • injector          │  │ • procedure_create  │  │ • query             │     │               │
│   │  │ • backend           │  │ • voice_capture     │  │ • ai-query          │     │               │
│   │  │ • fhir-converter    │  │ • transcription     │  │ • ingest            │     │               │
│   │  │ • websocket         │  │ • nlp_extraction    │  │                     │     │               │
│   │  │ • frontend          │  │ • field_update      │  │                     │     │               │
│   │  │ • plaud-fetch       │  │ • procedure_save    │  │                     │     │               │
│   │  │ • plaud-export      │  │ • imaging_fetch     │  │                     │     │               │
│   │  │                     │  │ • websocket         │  │                     │     │               │
│   │  └──────────┬──────────┘  └──────────┬──────────┘  └──────────┬──────────┘     │               │
│   │             │                        │                        │                │               │
│   │             │                        │                        │                │               │
│   │  ┌──────────▼──────────┐  ┌──────────▼──────────┐  ┌──────────▼──────────┐     │               │
│   │  │   ATHENA EHR        │  │    DRAGON AI        │  │    PostgreSQL       │     │               │
│   │  │  (External SaaS)    │  │ 100.101.184.20:5005 │  │ 100.75.237.36:5432  │     │               │
│   │  │                     │  │                     │  │                     │     │               │
│   │  │  • Patient data     │  │  • Whisper STT      │  │  • patients         │     │               │
│   │  │  • Medications      │  │  • Gemini NLP       │  │  • clinical_events  │     │               │
│   │  │  • Problems         │  │  • CUDA GPU         │  │  • audit_log        │     │               │
│   │  │  • Vitals           │  │                     │  │                     │     │               │
│   │  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘     │               │
│   │                                      │                                          │               │
│   │                           ┌──────────▼──────────┐                              │               │
│   │                           │    PostgreSQL       │                              │               │
│   │                           │ 100.101.184.20:5432 │                              │               │
│   │                           │                     │                              │               │
│   │                           │  • patients (SCC)   │                              │               │
│   │                           │  • procedures       │                              │               │
│   │                           └─────────────────────┘                              │               │
│   │                                      │                                          │               │
│   │                           ┌──────────▼──────────┐                              │               │
│   │                           │    ULTRALINQ PACS   │                              │               │
│   │                           │ app.ultralinq.net   │                              │               │
│   │                           │                     │                              │               │
│   │                           │  • Imaging studies  │                              │               │
│   │                           │  • Duplex exams     │                              │               │
│   │                           └─────────────────────┘                              │               │
│   │                                                                                 │               │
│   │   TRIPP'S MACBOOK PRO                                                          │               │
│   └─────────────────────────────────────────────────────────────────────────────────┘               │
│                                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Data Type Mapping

| System | Patient ID Field | Event ID Format | Timestamp Format |
|--------|------------------|-----------------|------------------|
| Observer | N/A (collects all) | `evt_uuid-xxx` | ISO 8601 |
| athena-scraper | `patientId` | N/A | ISO 8601 |
| Surgical Cmd Center | `mrn` (MRN-XXXXX) | `procedure.id` (UUID) | ISO 8601 |
| Plaud/Vascular AI | `athena_mrn` | `clinical_event.id` (UUID) | ISO 8601 |

### Cross-System Integration Points

| From | To | Method | Data Flow |
|------|-----|--------|-----------|
| athena-scraper | Plaud | `POST /ingest/athena` | EHR data → Clinical events |
| athena-scraper | Plaud | `GET /ingest/clinical/{mrn}` | Stored data ← Clinical events |
| Surgical Cmd Center | Observer | `POST /api/events` | Telemetry events |
| Observer | Surgical Cmd Center | `POST /api/observer/recommendations` | AI recommendations |
| All Systems | Observer | `POST /api/events` | Telemetry |
| Observer | All Systems | `GET /api/references/{source}` | Recommendations |

---

## Quick Start

### 1. Test Observer Connectivity

```bash
curl http://100.113.243.36:3000/health
```

### 2. Send Test Event

```bash
curl -X POST http://100.113.243.36:3000/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "type": "OBSERVER_TELEMETRY",
    "source": "surgical-command-center",
    "event": {
      "stage": "test",
      "action": "INTEGRATION_TEST",
      "success": true,
      "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'",
      "correlationId": "scc-test-001",
      "data": {"message": "Integration test from Surgical Command Center"}
    }
  }'
```

### 3. Verify Receipt

```bash
curl http://100.113.243.36:3000/api/events/stats
```

Expected: `surgical-command-center` appears in sources list.

---

**Document Version:** 1.0.0
**Last Updated:** 2026-01-06
**Author:** Medical Mirror Observer Integration Team
