# LedgerMind Assistant

Fiscal onboarding assistant for **French freelancers and creators**.  
It helps users clarify their administrative status, collect the right facts, and get either:

- **Branch A (intake)** — if they already have a SIREN/SIRET: registry verification + profile Q&A + tax/compliance signals  
- **Branch B (guidance)** — if they do not: conversational diagnostic + **deterministic** régularisation roadmap

This README is the map for teammates: how the system works end-to-end, where code lives, and how to add features safely.

---

## Table of contents

1. [Product overview](#1-product-overview)
2. [High-level architecture](#2-high-level-architecture)
3. [Repository layout](#3-repository-layout)
4. [Prerequisites & local setup](#4-prerequisites--local-setup)
5. [User journeys (UI)](#5-user-journeys-ui)
6. [Backend: orchestrator & agents](#6-backend-orchestrator--agents)
7. [API reference](#7-api-reference)
8. [Sessions & data model](#8-sessions--data-model)
9. [LLM vs deterministic logic](#9-llm-vs-deterministic-logic)
10. [Frontend structure](#10-frontend-structure)
11. [How to add a feature](#11-how-to-add-a-feature)
12. [Tests](#12-tests)
13. [Integrations & external services](#13-integrations--external-services)
14. [Conventions & pitfalls](#14-conventions--pitfalls)

---

## 1. Product overview

**LedgerMind** is not a full tax-filing product. The current core is an **onboarding / diagnostic pipeline**:

| Question at entry | Path | Outcome |
|-------------------|------|---------|
| “I already have a SIREN / SIRET” | Branch **A · intake** | Verify identity in public registries, collect activity/revenue facts, classify tax category signals |
| “I don’t / I’m not sure” | Branch **B · guidance** | Ask a short diagnostic, then show a **feuille de route** (steps + recommended regime) |

Auth is **MongoDB-backed** (email/password + JWT). No Supabase.  
Each user document also stores **`agent_context.intake`** and **`agent_context.guidance`** snapshots so later features can resume either agent.

---

## 2. High-level architecture

```text
┌─────────────────────┐         HTTP JSON          ┌──────────────────────────────┐
│  Frontend           │  ←──────────────────────→  │  Backend (FastAPI)            │
│  TanStack Start     │   localhost:3000 ↔ :8000   │                              │
│  React + Tailwind   │                            │  orchestrator (state machine)│
│                     │                            │    ├─ intake  (branch A)     │
│  Auth (static)      │                            │    └─ guidance (branch B)    │
│  Onboarding UI      │                            │  api/  schemas/ services/    │
│  Chatbot            │                            │  llm/gemini.py               │
└─────────────────────┘                            │  core/session_store (Mongo)  │
                                                   └──────────────────────────────┘
                                                              │
                                                              ▼
                                                         MongoDB
                                                      (sessions)
```

**Design rule:** the **orchestrator** owns phases and persistence. Agents contain domain logic. The LLM is used for **natural language** (phrasing / understanding / short accompaniment), **not** for inventing legal thresholds or roadmap structure.

---

## 3. Repository layout

```text
ledgermind-assistant/
├── README.md                 ← only product docs (this file)
├── requirements.txt          ← Python deps (install from repo root)
├── pytest.ini                ← pythonpath=backend
├── backend/
│   ├── .env.example
│   ├── app/
│   │   ├── main.py           ← FastAPI app + CORS
│   │   ├── config.py         ← settings (pydantic-settings)
│   │   ├── api/              ← HTTP routers
│   │   │   ├── auth.py
│   │   │   ├── orchestrator.py
│   │   │   └── verification.py
│   │   ├── agents/
│   │   │   ├── orchestrator.py
│   │   │   ├── intake/       ← Branch A
│   │   │   └── guidance/     ← Branch B (+ roadmap/)
│   │   ├── llm/gemini.py     ← shared Gemini client
│   │   ├── schemas/          ← Pydantic models (API + session state)
│   │   ├── services/         ← recherche-entreprises, OCR, etc.
│   │   └── core/             ← Mongo (users + sessions)
│   └── tests/
├── frontend/
│   ├── package.json
│   └── src/
│       ├── routes/           ← file-based TanStack Router routes
│       ├── components/       ← AuthPage, Chatbot, AppShell, …
│       └── lib/              ← api.ts, auth.ts
└── .gitignore
```

---

## 4. Prerequisites & local setup

### Required

- **Python 3.11+** (3.12 used in development)
- **Node.js** 20+ (for Vite / TanStack Start)
- **MongoDB** running locally (or a reachable URI)
- **Gemini API key** — [Google AI Studio](https://aistudio.google.com/apikey)

### Backend

```bash
# from repo root
python -m venv .venv

# Windows
.\.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt

copy backend\.env.example backend\.env   # Windows
# cp backend/.env.example backend/.env  # macOS / Linux

# edit backend/.env — at least GEMINI_API_KEY and MONGO_URI
cd backend
uvicorn app.main:app --reload --port 8000
```

Health check: [http://localhost:8000/health](http://localhost:8000/health)  
Interactive API docs: [http://localhost:8000/docs](http://localhost:8000/docs)

### Frontend

```bash
cd frontend
npm install
npm run dev
```

App: [http://localhost:3000](http://localhost:3000)

### Environment variables

Defined in `backend/.env` (see `backend/.env.example`):

| Variable | Purpose | Typical value |
|----------|---------|----------------|
| `GEMINI_API_KEY` | Gemini calls for NL | your key |
| `GEMINI_MODEL` | Model id | `gemini-2.5-flash` |
| `AUTH_SECRET` | JWT signing key (≥ 32 chars) | see `.env.example` |
| `AUTH_TOKEN_DAYS` | Token lifetime | `14` |
| `MONGO_URI` | Session + **users** store | `mongodb://localhost:27017` |
| `MONGO_DB_NAME` | Database name | `ledgermind` |
| `FRONTEND_ORIGIN` | CORS allowlist | `http://localhost:3000` |

Optional frontend override:

| Variable | Purpose | Default |
|----------|---------|---------|
| `VITE_API_BASE` | Backend base URL | `http://localhost:8000` |

---

## 5. User journeys (UI)

### Auth (MongoDB + JWT)

- Routes: `/` and `/auth` → `AuthPage`
- **Inscription** → `POST /api/auth/register` (stores user in Mongo `users`)
- **Connexion** → `POST /api/auth/login`
- JWT kept in `localStorage` (`ledgermind_access_token`); sent as `Authorization: Bearer …`
- `/onboarding/` is guarded: unauthenticated users are sent to `/auth`
- Google OAuth button is disabled (not implemented; no Supabase)
- Profile + dual-agent context: `GET /api/auth/me`, `GET /api/auth/context`

### Branch choice

Route: `/onboarding/`

- **A** → `/onboarding/verification` (SIREN/SIRET)
- **B** → `/onboarding/diagnostic` (no SIREN)

### Branch A — verification → profile

1. Enter SIREN (9) or SIRET (14), or OCR a document  
2. `POST /api/orchestrator/start` with SIRET  
3. Possible uploads:
   - Registry document (Kbis / RNE extract) if required (often EI)
   - Avis de situation SIRENE (archival proof)
4. Continue turns → profile questions (`Chatbot` on `/onboarding/profil`)  
5. Finish → dashboard (shell pages exist; many are still placeholders)

### Branch B — diagnostic conversationnel → feuille de route

Branch B is **conversational**, not a questionnaire: the user describes their activity in their
own words and the profile builds itself from the conversation. Endpoints live under
`/api/guidance` (see §7); the orchestrator state machine is untouched and still serves Branch A.

1. `/onboarding/diagnostic` renders `GuidanceChat` — no server call needed to start
2. Each message → `POST /api/guidance/chat` (session created on the first message)
3. The backend decides what is still missing; **the roadmap is never produced while a legally
   required fact is missing**. When the profile is complete, the response carries `roadmap`
4. CTA **Voir ma feuille de route** → `/onboarding/diagnostic/resultat`, plus a PDF export
5. Then **J'ai déjà mon SIREN → vérification** hands over to `/onboarding/verification` —
   the same screen Branch A users reach after answering "yes, I have a SIREN"

Three UI pieces the user drives (`frontend/src/components/lm/`):

| Component | Role |
|---|---|
| `GuidanceChat.tsx` | chat, opening **suggestions**, backend-driven clickable options |
| `StatusCard.tsx` | **fiche de statut adaptative** — cards appear as facts are detected (pop-up confirmation), each editable/removable via a pop-up |
| `ConversationHistory.tsx` | **historique** — reopen, rename, delete past conversations |

Nothing fiscal is hard-coded in the frontend: questions, quick replies, options and the roadmap
all come from the deterministic backend.

> **Routing note:** `resultat` is a **child route** of `diagnostic`. The parent must render `<Outlet />` for `/resultat`, or the page stays blank.

Other routes (mostly product shell): `/dashboard`, `/documents`, `/education`, `/historique`, `/parametres`, `/simulateur`.

---

## 6. Backend: orchestrator & agents

### Orchestrator (`backend/app/agents/orchestrator.py`)

Thin **deterministic state machine**. Every turn:

1. Load session from Mongo by `session_id`
2. Branch on `state.phase`
3. Call the right agent helper
4. Save session
5. Return `OrchestratorTurnResponse` (`ui_action`, `message`, `quick_replies`, `profile`, optional `roadmap` / `diagnostic_profile`)

#### Branch A phases

```text
verification
  → verification_registry_document   (if document required)
  → verification_document            (SIRENE avis upload)
  → profile_questions
  → done
```

Tax classification / compliance tools run as part of intake finalization (schema still lists `tax_classification` / `compliance_check` as phases for compatibility).

#### Branch B phases

```text
diagnostic_questions
  → diagnostic_roadmap   (roadmap built; UI shows CTA)
  → done                 (after user acknowledges / opens result)
```

### Intake agent — Branch A (`backend/app/agents/intake/`)

| File / folder | Role |
|---------------|------|
| `agent.py` | Verification apply, ask next question, handle answers, finalize |
| `questions.py` | Field order + LLM phrasing (with fallbacks) |
| `understand.py` | Map free-text answers → `UserProfile` fields |
| `tools/verification.py` | SIRENE / RNE lookup (no LLM) |
| `tools/registry_analysis.py` | Registry document interpretation helpers |
| `tools/extract_answer.py` | Deterministic field extraction helpers |
| `tools/classify_tax.py` | BIC / BNC / mixed heuristics |
| `tools/check_compliance.py` | Alerts / mismatches |

### Guidance agent — Branch B (`backend/app/agents/guidance/`)

| File / folder | Role |
|---------------|------|
| `agent.py` | Ask next Q, handle answer, `finalize_diagnostic` → `build_roadmap` |
| `questions.py` | **Static** question bank + `next_missing_field` + `to_roadmap_profil` |
| `understand.py` | Extract into `DiagnosticProfile` (scoped per `target_field`; quick replies; regex; Gemini fallback) |
| `accompaniment.py` | Short Gemini blurb for the roadmap (rejected if too short / bare label) |
| `roadmap/` | **Deterministic** legal/UX engine |
| `data/seuils.yaml` | Thresholds / sources (do not hardcode plafond values in prompts) |

Roadmap pipeline (conceptual):

```text
DiagnosticProfile
  → to_roadmap_profil()
  → analyse_juridique / comparateur / presentation
  → roadmap_builder.build_roadmap()
  → dict (bandeau, etapes, phases, …)
```

Etape objects use fields like `titre`, `detail`, `lien`, `phase` (see `guidance/roadmap/models.py`).

---

## 7. API reference

Base URL: `http://localhost:8000`

### Orchestrator

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/orchestrator/start` | Create session; start intake or guidance (**auth required**) |
| `POST` | `/api/orchestrator/turn` | Next step / answer turn (must own session) |
| `GET` | `/api/orchestrator/my-sessions` | List current user's sessions |
| `GET` | `/api/orchestrator/session/{id}` | Current `UserProfile` |
| `GET` | `/api/orchestrator/session/{id}/detail` | Profile + diagnostic + roadmap (result page) |
| `GET` | `/api/orchestrator/session/{id}/roadmap` | Roadmap only |

### Guidance (Branch B — conversational, no SIREN yet)

Auth optional: without a token the space runs on the `demo` identity.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/guidance/chat` | One conversation turn — `{session_id?, message, mode?, action?}` |
| `GET` | `/api/guidance/suggestions` | Opening suggestions, then contextual quick replies |
| `GET` | `/api/guidance/conversations` | Conversation history (filtered by space) |
| `GET` | `/api/guidance/chat/{id}` | Full conversation + profile + roadmap + checked steps |
| `PATCH` | `/api/guidance/chat/{id}/rename` | Rename a conversation |
| `DELETE` | `/api/guidance/chat/{id}` | Delete a conversation |
| `GET` | `/api/guidance/profil` | Shared profile + deterministic verdict + what's still missing |
| `PATCH` | `/api/guidance/profil` | Manual correction from the status card |
| `DELETE` | `/api/guidance/profil/{field}` | Remove one fact from the status card |
| `GET`/`PUT` | `/api/guidance/roadmap/state/{id}` | Checkbox state, persisted server-side |
| `POST` | `/api/guidance/roadmap/pdf` | Roadmap as a downloadable PDF (`fpdf2`, WeasyPrint if available) |

`POST /chat` returns `{session_id, reponse, profil, roadmap, options, suggestions, profil_complet}`.
`options` is a generic clickable structure decided by the backend (e.g. micro vs société in the
switching zone) — the frontend renders it without knowing the case.

### Auth

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Create user in Mongo + JWT |
| `POST` | `/api/auth/login` | Login + JWT |
| `GET` | `/api/auth/me` | Current user + `agent_context` |
| `GET` | `/api/auth/context` | Intake + guidance snapshots for next features |

**Start body (examples):**

```json
{ "siret": "12345678900012" }
```

```json
{ "skip_verification": true, "branch": "guidance" }
```

**Turn body:**

```json
{ "session_id": "<uuid>", "user_answer": "Prestation freelance" }
```

**Important `ui_action` values:**

| `ui_action` | Meaning (frontend) |
|-------------|---------------------|
| `ask_question` | Show question + quick replies |
| `upload_registry_document` | Ask for Kbis / RNE extract |
| `upload_sirene_document` | Ask for avis SIRENE |
| `show_roadmap` | Diagnostic done — show CTA, cache roadmap |
| `show_tax_result` / `show_compliance` / `done` | Intake finished / wrap-up |
| `requires_expert` | Human / SIE path |

### Verification

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/verification/siret` | Standalone SIREN/SIRET verify |
| `POST` | `/api/verification/ocr-siret` | OCR SIRET from uploaded file |
| `POST` | `/api/verification/registry-document` | Multipart upload tied to `session_id` |
| `POST` | `/api/verification/sirene-avis` | Multipart SIRENE avis upload |

---

## 8. Sessions & data model

### Storage

- MongoDB collection `sessions`
- Document shape: `{ id, state_json, created_at, updated_at }`
- Code: `backend/app/core/session_store.py`
- Client never “owns” computed fiscal fields — server loads/saves `OrchestratorState` every turn

**Guidance conversational memory** (`backend/app/core/conversation_store.py`) — ported from the
SQLite store of the standalone agent onto the project's MongoDB, same public API:

| Collection | Content |
|---|---|
| `guidance_conversations` | `{ id, uid, type, title, created_at, updated_at }` — `type` = `guidance` \| `pedagogue` |
| `guidance_messages` | `{ conversation_id, role, content, sources, created_at }` |
| `guidance_profiles` | one document per `uid` — the profile is **shared across spaces**, not per conversation |
| `guidance_roadmaps` | `{ conversation_id, roadmap, checked }` — checkbox state persisted server-side |

`uid` is the authenticated user id (falls back to `demo` without auth). Conversations inactive for
30 days are purged. Profile normalisation stays **in code** (total CA = services + sales; in-kind
gifts count as service revenue, never as sales) — never delegated to the LLM.

### Core models (`backend/app/schemas/orchestrator.py`)

- **`UserProfile`** — Branch A identity + docs + activity/revenue + tax/compliance outputs  
- **`DiagnosticProfile`** — Branch B facts for the roadmap engine  
- **`OrchestratorState`** — `session_id`, `phase`, `branch`, profiles, `roadmap`, last question metadata  
- **`OrchestratorTurnResponse`** — what the frontend Chatbot consumes  

Frontend mirrors types in `frontend/src/lib/api.ts` and stores:

- `ledgermind_session_id` (local + session storage)
- `ledgermind_diagnostic_result` (sessionStorage cache for resultat page)
- `ledgermind_auth` (sessionStorage — mock auth)

---

## 9. LLM vs deterministic logic

### Uses Gemini (`backend/app/llm/gemini.py`)

- Intake question phrasing  
- Intake / guidance answer understanding (JSON extraction)  
- Guidance accompaniment text after roadmap build  
- Ambiguous OCR document type classification (Kbis vs RNE) when heuristics are unsure  

Always design **fallbacks** (static questions, regex, quick-reply maps). Gemini free-tier quotas will break demos if every turn depends on the LLM.

### Must stay deterministic

- Orchestrator phase transitions  
- Registry lookups and mismatch rules  
- Tax classify / compliance tools  
- Guidance **question order** and “is profile complete?”  
- **`build_roadmap()`** and all plafond / parcours decisions (`seuils.yaml`)  

**Do not** let the LLM invent thresholds, step lists, or legal conclusions that contradict the roadmap engine.

---

## 10. Frontend structure

| Path | Role |
|------|------|
| `src/routes/index.tsx`, `auth.tsx` | Auth entry |
| `src/routes/onboarding.index.tsx` | SIREN oui / non gate |
| `src/routes/onboarding.verification.tsx` | Branch A verification + uploads |
| `src/routes/onboarding.profil.tsx` | Branch A profile chatbot |
| `src/routes/onboarding.diagnostic.tsx` | Branch B chat (+ `<Outlet />` for resultat) |
| `src/routes/onboarding.diagnostic.resultat.tsx` | Feuille de route UI |
| `src/components/lm/Chatbot.tsx` | Shared orchestrator chat UI |
| `src/components/AuthPage.tsx` | Static auth |
| `src/lib/api.ts` | HTTP client + session helpers |

Stack: **TanStack Start / Router**, React 19, Tailwind 4, Vite.

---

## 11. How to add a feature

### A. New diagnostic question (Branch B)

1. Add field to `DiagnosticProfile` in `schemas/orchestrator.py`  
2. Mirror type in `frontend/src/lib/api.ts` if the UI needs it  
3. Extend `guidance/questions.py` (`FIELD_PRIORITY` / fallbacks / completeness)  
4. Teach `guidance/understand.py` how to extract it (quick reply + regex + scoped LLM)  
5. If it affects the roadmap, map it in `to_roadmap_profil()` and update `roadmap/` / `seuils.yaml` as needed  
6. Add/adjust tests in `backend/tests/test_guidance_*.py`

### B. New intake profile field (Branch A)

1. Add field on `UserProfile`  
2. Register in intake `FIELD_PRIORITY` / questions fallbacks  
3. Extraction in `intake/understand.py` or `tools/extract_answer.py`  
4. If it affects tax/compliance, update `classify_tax.py` / `check_compliance.py`  
5. Update frontend Chatbot consumers only if you display the field

### C. New API endpoint

1. Add Pydantic request/response in `schemas/`  
2. Implement in `api/` router  
3. Keep business logic in `agents/` or `services/` (not in the router)  
4. Document in this README’s API table

### D. New UI screen

1. Add `frontend/src/routes/<name>.tsx` (file-based routing)  
2. Call `src/lib/api.ts` — avoid duplicating fiscal logic in the browser  
3. If nested under an existing route (like `diagnostic/resultat`), ensure the parent renders `<Outlet />`

### E. Changing legal thresholds

Edit `backend/app/agents/guidance/data/seuils.yaml` (and tests). Prefer YAML over hardcoding in Python or prompts.

---

## 12. Tests

From **repo root** with venv active:

```bash
pytest backend/tests -q
```

| File | What it covers |
|------|----------------|
| `backend/tests/test_guidance_branch_b.py` | Guidance agent + orchestrator branch B |
| `backend/tests/test_guidance_roadmap.py` | Deterministic roadmap paths |
| `backend/tests/test_tax_compliance.py` | Tax / OCR classify helpers |

When changing understand/roadmap behavior, add a focused unit test — Gemini may be unavailable or rate-limited in CI/local.

---

## 13. Integrations & external services

| Service | Used for | Code |
|---------|----------|------|
| [recherche-entreprises](https://recherche-entreprises.api.gouv.fr/) (api.gouv.fr) | Company identity / SIRENE aggregate | `services/recherche.py`, `insee_sirene.py`, `inpi_rne.py` |
| Gemini | NL understanding / phrasing | `llm/gemini.py` |
| MongoDB | Session persistence | `core/session_store.py` |
| PyMuPDF + RapidOCR (+ Tesseract fallback) | PDF/image OCR | `services/ocr_*.py` |

Official sites referenced in UX copy (not always API-called): avis de situation SIRENE (INSEE), greffe / RCS, Guichet unique INPI.

---

## 14. Conventions & pitfalls

1. **Orchestrator is the source of truth** for phase transitions — don’t invent parallel session machines in the frontend.  
2. **One field per answer on guidance** — `understand.py` scopes updates to `target_field` so the LLM cannot fill the whole profile from one sentence.  
3. **Roadmap is deterministic** — accompaniment text can fail (quota); the feuille de route must still build.  
4. **Child routes need `<Outlet />`** — especially `onboarding.diagnostic` → `…/resultat`.  
5. **CORS** — `FRONTEND_ORIGIN` must match the browser origin (`http://localhost:3000` vs `http://127.0.0.1:3000` are different).  
6. **Don’t commit secrets** — `.env` stays local; only `.env.example` is shared.  
7. **Prefer small PRs** — agent logic, API, and UI in focused commits help teammates review.  
8. **Auth is Mongo + JWT** — register/login required for orchestrator start; agent context lives on the user document (`agent_context.intake` / `agent_context.guidance`).

---

## Quick start (cheat sheet)

```bash
# Terminal 1 — Mongo must be running
cd backend
# (venv activated, .env configured)
uvicorn app.main:app --reload --port 8000

# Terminal 2
cd frontend
npm run dev
# → http://localhost:3000
```

```bash
# Tests
pytest backend/tests -q
```

---

## Team contacts / ownership (fill in)

| Area | Owner |
|------|--------|
| Branch A intake / verification | _TBD_ |
| Branch B guidance / roadmap | _TBD_ |
| Frontend onboarding UX | _TBD_ |
| Infra (Mongo, deploy) | _TBD_ |

---

*Last aligned with the intake + guidance orchestrator architecture (agents under `backend/app/agents/{intake,guidance}`, HTTP under `backend/app/api/`).*
