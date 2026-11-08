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

The page is a single `fleet-asset-register.html` published as a claude.ai Artifact.
It has no backend of its own — it uses the Artifact runtime capabilities:

- **`db`** — shared realtime document store (collections: `assets`, `flights`,
  `reports`, `permits`, `missions`, `loans`, `pilots`, `sops`, `sopacks`).
- **`assets`** — file store for certificates, SOP documents, NOTAMs, site surveys
  and report evidence (`upload: "interact"` so Contributors can upload).
- **`sample`** (`images: true`) — asks Claude to read certificate photos and
  return the certificate number, type and dates as JSON.
- **`user`** — access-level detection only (read-only viewers get a read-only
  board; GO/NO-GO is gated to Editors). No viewer names are displayed.

Because of this, the app only works when opened as the claude.ai Artifact —
hosting this file on a static host (GitHub Pages, Render, etc.) renders the UI
but without the shared database, uploads or certificate reading.

## Access levels

Shared from the page's Share menu:

- **Viewer** — read-only board.
- **Contributor** — pilots: log flights, file reports, sign SOPs, check gear in/out, upload files.
- **Editor** — managers: everything above plus GO/NO-GO decisions and page publishing.

Records marked "(sample)" are seeded demo data — edit or remove them from the UI.
