# Drone Ops Board — Fleet Asset Register

A single-page UAV operations management board covering the daily workflows of a drone
operations manager: fleet readiness, mission planning with go/no-go approval, flight
logging with compliance checks, equipment checkout, pilot certificate currency,
SOP acknowledgment, incident reporting, and day-by-day operating permissions.

**Live app:** https://claude.ai/artifact/L44HQ8xdMYVAMUCX2yorcC

## Tabs

| Tab | What it does |
| --- | --- |
| **Assets** | Register aircraft, batteries, payloads, controllers, docks and spares. Each asset carries a physical-style condition tag: **white** = airworthy, **green** = maintenance/inspection, **red** = not airworthy. |
| **Missions** | Go/no-go planning package: weather inputs, NOTAM summary + file upload, crew list with currency, aircraft/battery/payload from the register, site-survey PDFs, a 9-item pre-flight checklist, and a manager-only **GO / NO-GO** decision with approver name and date. |
| **Flight log** | Post-flight reports with start/end times (duration computed), pilot, and the aircraft, battery, payload and RC picked from the asset register. CSV import for DJI FlightHub 2 / AirData exports with column mapping. Every flight is checked against its linked permission. |
| **Checkout** | Equipment check-out / check-in with due dates, overdue flags, and condition notes on return. Asset cards show who holds what. |
| **People** | Pilot roster with CAAT certificate number, type, issue/expiry dates and attached documents. Certificate details can be **auto-read from a photo** (including Thai Buddhist-era date conversion). Tracks current / expiring ≤ 30 days / expired. |
| **SOPs** | SOPs, emergency procedures and checklists with attached documents, revision control (old revisions archived, never deleted, behind a toggle), and per-pilot signed acknowledgments (name + tick box + date). Unsigned procedures are flagged against the roster. |
| **Reports** | Incident / near-miss / defect / observation reports with severity, related asset, corrective action, open/closed status, and photo/video evidence. |
| **Permissions** | Day-by-day operating permissions per project: validity dates, altitude/distance limits, daylight-only condition, CAAT/NBTC reference. Flights and missions link to one and are flagged when outside it. |

A per-tab **flag summary** sits under the tab row, and tab titles carry live count
badges (flagged flights, open reports, items out, certs expiring, procedures
awaiting signatures, missions awaiting decision).

## How it runs

The whole UI is one file, `fleet-asset-register.html`. It runs in two ways:

1. **As a claude.ai Artifact** (the original) — the claude.ai runtime provides the
   shared database, file store and certificate photo-reading.
2. **Standalone** (this repo) — `server.js` (Node/Express, no other runtime deps)
   provides the same primitives behind a REST API, and `public/shim.js` implements
   the `window.claude.use()` interface on top of it, so the page runs unmodified:
   - JSON document store in `DATA_DIR/db.json` (collections: `assets`, `flights`,
     `reports`, `permits`, `missions`, `loans`, `pilots`, `sops`, `sopacks`),
     polled every 8 s in place of realtime snapshots.
   - File store in `DATA_DIR/uploads/`, served at `/_blob/<id>` (sign-in required).
   - Certificate photo reading works without any key: free in-browser OCR
     (Tesseract) tuned to the CAAT card's printed layout, including Buddhist-era
     date conversion. Setting `ANTHROPIC_API_KEY` upgrades it to Claude vision
     via `POST /api/ocr` (more accurate, handles poor photos and other layouts);
     if the server call fails the page falls back to browser OCR automatically.

## Running locally

```
npm install
CREW_CODE=yourcrewcode ADMIN_CODE=yourmanagercode node server.js
# open http://localhost:8080 and sign in with one of the codes
```

## Access codes

Two shared codes set by environment variables:

- **`CREW_CODE`** — pilots: sign in to view and edit everything (log flights, sign
  SOPs, file reports, check gear in/out, upload files).
- **`ADMIN_CODE`** — managers: everything above plus the mission GO/NO-GO buttons.

Without signing in, nothing is readable (the stored documents include pilot
certificates, so the whole API requires a code).

## Deploying on Render

The repo includes `render.yaml`. In Render: **New → Blueprint**, pick this repo,
then set `CREW_CODE`, `ADMIN_CODE` and (optionally) `ANTHROPIC_API_KEY` in the
dashboard. Note the persistent disk in the blueprint needs a paid instance; on the
free tier the database and uploads reset on every deploy or restart.

Records marked "(sample)" are seeded demo data — edit or remove them from the UI.
