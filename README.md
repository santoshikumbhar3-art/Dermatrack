# DermaTrack & Adapt

**Your skin evolves. Your routine should too.**

DermaTrack & Adapt connects real YouCam Skin AI analysis, a skincare routine log and daily check-ins into one feedback loop — **Analyze → Understand → Track → Review → Adapt** — so people can tell genuine change from normal variation and make better decisions about what to use (and what *not* to buy).

Built for the YouCam API Skin AI & eCommerce VTO Hackathon (2026).

> DermaTrack is informational. It does not diagnose, treat or prevent any condition. AI skin scores describe how features appear in a photo.

---

## Quick start

Requirements: Python 3.11+, Node 18+.

```bash
# 1. Backend
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                     # add YOUCAM_API_KEY here
uvicorn app.main:app --reload --port 8000

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev                                              # http://localhost:5173
```

Vite proxies `/api` to the backend, so the browser never sees the backend origin or any key.

**Single-process option:** run `npm run build` in `frontend/`, then start uvicorn — the backend serves `frontend/dist` at http://localhost:8000.

**No API key yet?** With `DEV_FIXTURE_ENABLED=true` (the default), scans return YouCam's *published documentation sample* and are labelled "Development fixture" everywhere. To explore a fuller story, open **Settings → Demonstration data → Load**. It adds clearly labelled sample scans, a routine and check-ins, and can be removed in one click.

### Tests

```bash
cd backend && python -m pytest -q        # 34 tests
cd frontend && npx tsc -b && npm run build
```

The YouCam client is tested end to end against a mocked transport that follows the documented request and response shapes. It covers success, task errors, authentication, quota, rate limits, malformed responses, timeouts and network failure.

---

## YouCam integration (`backend/app/services/youcam_client.py`)

Implements the documented S2S **v2.0** flow from the official docs (*AI Skin Analysis → Inputs & Outputs*):

| Step | Call |
|---|---|
| 1. Register file | `POST /s2s/v2.0/file` → `file_id` + pre-signed upload request |
| 2. Upload | `PUT` bytes to the pre-signed URL (no auth header sent to storage) |
| 3. Create task | `POST /s2s/v2.0/task/skin-analysis` with `src_file_id`, 12 SD `dst_actions`, `format: "json"` |
| 4. Poll | `GET /s2s/v2.0/task/skin-analysis/{task_id}` until `task_status` is `success` or `error` |

- Auth is `Authorization: Bearer <YOUCAM_API_KEY>`, server-side only.
- SD and HD concerns are never mixed in one request, as the docs require. `YOUCAM_MODE` picks one.
- Documented task errors (`error_src_face_too_small`, `error_lighting_dark`, …) map to plain-language fixes. Auth, quota, rate-limit, timeout, network and malformed-response errors each get their own message.
- **No silent fallback.** If a live analysis fails, nothing is saved and the user sees why.

**Adapter layer** (`analysis_normalizer.py`) maps both documented shapes (`results.output[]` and `score_info.json`, including HD regional sub-scores) into one model. It emits only fields that are actually present, reports unrecognised fields, and stores a copy of the provider response with every URL redacted.

### Why progress uses `raw_score`

YouCam documents that both scores run 1–100 with **higher = more favourable**, and that `ui_score` is *adjusted upwards* to be encouraging. So:

```
change (points)   = current raw_score − baseline raw_score
relative change % = change ÷ baseline raw_score × 100        (baseline > 0)
```

The brief's `(baseline − current) / baseline` formula is for metrics where higher means *more* concern, so it doesn't apply to these fields. Changes smaller than ±3 points are shown as "no clear change". That band is a disclosed, conservative heuristic, not a validated threshold. Scans are only compared within the same mode, API version and data type (real, fixture or demonstration). Every number is labelled as a change in an AI measurement.

---

## The engines

| Engine | File | What it does |
|---|---|---|
| Ingredient Intelligence | `services/ingredient_rules.py` | Normalises names and synonyms into active families. 12 structured rules, each with an id, conditions, severity (`documented_concern` / `precaution` / `info` / `incomplete`), explanation, reference, next step and limitations. Frequency-aware: two non-daily actives are downgraded to *info*. Concentration checks run only on user-entered values. Unknown products are reported as "not evaluated". |
| Adaptive Guidance | `services/adaptive_guidance.py` | Deterministic cards linking check-ins, reactions, routine dates and scan comparisons. **Safety rules run first and are locked.** Emergency signs point to 112; severe reactions say stop and seek care, and that a scan can't show it's safe to continue. Temporal associations are described as possible, not proven. |
| Progress | `services/progress_service.py` | Series, comparisons, timeline (scans, check-ins and routine events), summary of what changed and what's uncertain, including differences in capture conditions. |
| Product matching | `services/recommendation_service.py` | Transparent scoring (gaps, focus attributes, conflict and duplicate penalties) with reasons, checks and missing information for every match. **Simplify-first:** with open cautions, compatibility findings or 3+ actives, it recommends nothing except essential gaps. |
| AI Skin Companion | `services/assistant_service.py` | Rule-based intents over stored records, with citations, separating "measured" from "reported". It refuses to diagnose, and safety notes are always attached. If `ANTHROPIC_API_KEY` is set, a model only *rephrases* the grounded answer and the UI shows which mode answered. |

---

## API

| Method | Path | |
|---|---|---|
| GET | `/api/health` | Status, analysis source, assistant mode |
| GET | `/api/overview` | Dashboard aggregate |
| GET | `/api/analysis/config` | Mode, minimum size, fixture notice |
| POST | `/api/analyze` | Multipart image + consent + capture conditions |
| GET | `/api/analysis/history` · `/api/analysis/{id}` · `/api/analysis/compare?a=&b=` | |
| DELETE | `/api/analysis/{id}` · `/api/analysis` | |
| GET | `/api/progress?days=` | Series, comparison, timeline, summary, method |
| GET/POST/DELETE | `/api/checkins` | |
| GET | `/api/guidance` | |
| GET/POST/PUT/DELETE | `/api/routines[/{id}]` | Every change is logged to `routine_event` |
| POST/DELETE | `/api/routines/{id}/reactions[/{rid}]` | |
| GET | `/api/routines/compatibility` · POST `/api/routines/compatibility/preview` | |
| GET | `/api/routines/changes` · `/api/routines/events` · `/api/rules` · `/api/ingredients/resolve` | |
| GET/POST/DELETE | `/api/products` · GET `/api/products/recommendations` | |
| GET | `/api/assistant/status` · POST `/api/assistant/message` | |
| GET/PUT | `/api/profile` · PUT `/api/consent` | |
| GET | `/api/export` · DELETE `/api/data` | |
| POST/DELETE | `/api/demo/load` · `/api/demo` | |

Interactive docs: http://localhost:8000/docs. All inputs are validated with Pydantic, errors return `{detail: {code, message, fields?}}`, and CORS is limited to `FRONTEND_ORIGINS`.

---

## Privacy and security

- Photos are validated by decoding them, not by trusting the declared type. They are renamed, sent to YouCam, and **never stored or logged**.
- Mask URLs from YouCam are pre-signed and expire. They're shown once and never persisted.
- Consent is required before analysis and is timestamped and versioned. It can be withdrawn in Settings.
- Data export (JSON) and full deletion are available in Settings.
- API keys exist only in `backend/.env`.

## Honest limitations

- Single local profile with no authentication. Add auth before any multi-user deployment.
- The curated library lists only actives named on each product. Full ingredient lists and prices are **not** included because they weren't verified. Users can add products with prices they've checked.
- Label-photo OCR isn't implemented, and the UI says so.
- The ±3 point variation band is a heuristic. Measuring real retake noise per user would be a strong next step.
- The live YouCam flow was built to the official docs and tested against a documented-shape mock. Run one real scan with your key to confirm before demoing.

## Structure

```
backend/app/
  main.py  config.py  database.py  models.py  schemas.py
  api/       analysis, routines, progress, products, assistant, account
  services/  youcam_client, analysis_normalizer, ingredient_rules, adaptive_guidance,
             progress_service, recommendation_service, assistant_service, seed, demo_data
backend/tests/
frontend/src/
  pages/       Landing, Overview, Analysis, Progress, Routine, Library, Companion, Settings
  components/  layout/AppShell, ui/, charts/Contour, ScanResults, CheckInForm,
               ProductForm, FindingCard, GuidanceCard
  services/api.ts  lib/hooks.tsx  lib/format.ts
```
