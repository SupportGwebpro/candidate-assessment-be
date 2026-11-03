# Assessment Backend

HR Admin assessment-management API.

**Stack:** Node.js + Express.js · MySQL · Prisma (multi-file schema, one file per table).

---

## Project layout

```
prisma/
  schema/
    schema.prisma             # datasource + generator only
    hr_admin.prisma           # HrAdmin table
    assessment.prisma         # Assessment table + Level/Status enums
    assessment_version.prisma # AssessmentVersion table (version history)
    candidate.prisma          # Candidate table (drives candidate counts)
  seed.js
src/
  config/env.js               # env loading + validation
  lib/prisma.js               # PrismaClient singleton
  middleware/                 # auth, validate (zod), error
  utils/                      # http errors, password (bcrypt), jwt
  validators/                 # zod request schemas
  services/                   # business logic (auth, assessment)
  controllers/                # thin request/response handlers
  routes/                     # route definitions
  app.js                      # express app assembly
  server.js                   # entrypoint
```

## Setup

```bash
npm install
cp .env.example .env          # then edit DATABASE_URL + JWT_SECRET (+ DEEPSEEK_API_KEY for AI)

npm run prisma:generate
npm run prisma:migrate        # creates/updates tables (prompts for a migration name)
npm run db:seed               # creates the first HR Admin + sample data
npm run dev                   # starts on http://localhost:4000
```

> **AI (DeepSeek):** set `DEEPSEEK_API_KEY` to enable skills/sections/blueprint
> generation. Without a key, those endpoints auto-return deterministic sample
> data in non-production (or set `AI_MOCK=true` explicitly) so the full wizard is
> testable offline. Default model is `deepseek-v4-flash` (the successor to the
> now-deprecated `deepseek-chat`).

> **Prisma version:** pinned to 6.x (6.19.3). Multi-file schema folders are GA
> since 6.7, so no preview flag is needed, and the classic `prisma-client-js`
> generator + `@prisma/client` import used here work out of the box with no
> driver adapter — a good fit for this CommonJS project.
>
> Prisma 7 made the `prisma-client` generator the default: it requires a custom
> `output` path, is ESM-first, and needs a driver adapter. If you later upgrade,
> switch the generator in `prisma/schema/schema.prisma`, set an `output`, import
> `PrismaClient` from that path in `src/lib/prisma.js`, add a MySQL driver
> adapter, and move the project to ESM (or keep it on 6.x).

## Authentication

Email/password, returning a JWT bearer token. **There is no public sign-up** —
accounts are provisioned by the backend: the seed script creates the first admin,
and authenticated admins can create more via `POST /api/auth/admins`.

Send the token on every protected request:

```
Authorization: Bearer <token>
```

All HR Admins have equivalent access to every assessment action.

## Endpoints

Base path: `/api`

| Method | Path                         | Auth | Purpose                                        |
|--------|------------------------------|------|------------------------------------------------|
| GET    | `/health`                    | —    | Health check                                   |
| POST   | `/auth/login`                | —    | Log in, get JWT (rate-limited)                 |
| POST   | `/auth/admins`               | ✓    | Provision a new HR Admin                       |
| GET    | `/auth/me`                   | ✓    | Current admin                                  |
| GET    | `/assessments`               | ✓    | List with search / filters / sort / paging     |
| POST   | `/assessments`               | ✓    | Create (starts as Draft)                       |
| GET    | `/assessments/:id`           | ✓    | Detail + full version history                  |
| PATCH  | `/assessments/:id`           | ✓    | Edit                                           |
| POST   | `/assessments/:id/publish`   | ✓    | Draft → Published                              |
| POST   | `/assessments/:id/archive`   | ✓    | → Archived                                     |
| POST   | `/assessments/:id/restore`   | ✓    | Archived → previous status                     |
| GET    | `/assessments/:id/versions`  | ✓    | Version history                                |
| GET    | `/assessments/:id/candidates`| ✓    | Candidates for an assessment                   |
| POST   | `/assessments/:id/candidates`| ✓    | Add a candidate (keeps counts current)         |

There is intentionally **no DELETE route** — removal is via archive, which is
always reversible via restore.

### List query parameters

`GET /api/assessments?search=&level=&status=&page=&pageSize=&sortBy=&sortOrder=`

- `search` — matches assessment **name or role**
- `level` — `JUNIOR` | `MID` | `SENIOR`
- `status` — `DRAFT` | `PUBLISHED` | `ARCHIVED` (omit to include all, so archived rows stay discoverable)
- `page` (default 1), `pageSize` (default 20, max 100)
- `sortBy` — `createdAt` | `updatedAt` | `name` | `role` | `level` | `status` | `durationMinutes` (default `updatedAt`)
- `sortOrder` — `asc` | `desc` (default `desc`)

Each row returns name, role, level, status, `durationMinutes`, live `candidateCount`,
`createdAt`/`updatedAt`, creator, and a `latestVersion` summary.

### Response shape

```jsonc
// success
{ "data": { /* ... */ }, "meta": { /* list paging only */ } }
// error
{ "error": { "message": "...", "code": "UNAUTHORIZED", "details": [ /* optional */ ] } }
```

## Scope & acceptance mapping

- **Email/password auth, backend-provisioned accounts** — `auth.service` + seed + `POST /auth/admins`; no public sign-up.
- **Equal access for all admins** — single authenticated role; no per-record ownership checks on actions.
- **List fields** — name/role, level, status, duration, candidate count, created/updated dates, version details.
- **Search & filters** — `search` (name/role) + `level`/`status` filters, backed by DB indexes.
- **No HR Dashboard** — not implemented, by scope.
- **Auth blocks unauthorized/unauthenticated in backend** — `requireAuth` on every assessment route (401 unauthenticated, 403 deactivated).
- **Counts/results reflect current records** — list runs live `COUNT` and filtered queries each request.
- **Archived discoverable & restorable; no permanent deletion** — archived rows appear in the list, `restore` reverses it, and no delete endpoint exists.

---

## Assessment creation wizard (4 steps, DeepSeek-powered)

The assessment module is built as a 4-step wizard over a single draft record. You
create the draft once, then PATCH/PUT it as the user moves through the steps. AI
endpoints (`/ai/...`) only *suggest* — nothing is persisted until the user saves
the selection.

| Step | What | Endpoint(s) |
|------|------|-------------|
| **1 · Role Details** | Create draft with role title (+ optional typed JD) | `POST /assessments` |
| | Upload JD as PDF/DOC/DOCX → text extracted & stored | `POST /assessments/:id/job-description/upload` (multipart, field `file`) |
| **2 · Skills & Scope** | AI-suggest skills from role + JD | `POST /assessments/:id/ai/skills` → `{count?}` |
| | Save selected skills | `PUT /assessments/:id/skills` → `{skills:[...]}` |
| | Pick experience level | `PATCH /assessments/:id` → `{level}` |
| | AI-suggest sections (Quantitative, Communication, Logical, …) | `POST /assessments/:id/ai/sections` |
| | Save editable sections (type, counts, AI guidance) | `PUT /assessments/:id/sections` → `{sections:[...]}` |
| | Candidate instructions | `PATCH /assessments/:id` → `{candidateInstructions}` |
| **3 · Access** | Open/close window, timezone, threshold, save & resume | `PATCH /assessments/:id` |
| **4 · Review & Generate** | Review everything | `GET /assessments/:id` |
| | Generate AI blueprint (section-wise questions) | `POST /assessments/:id/ai/blueprint` |
| | Fetch generated blueprint | `GET /assessments/:id/blueprint` |

### Section configuration

Each section has a `questionType` and counts that drive generation:

- `MCQ_ONLY` → `mcqCount` MCQs
- `WRITTEN_ONLY` → `writtenCount` written questions
- `BOTH` → `mcqCount` MCQs **and** `writtenCount` written questions

Saving sections invalidates any previously generated blueprint (questions are
regenerated on the next `ai/blueprint` call).

### Example payloads

```jsonc
// PUT /assessments/:id/sections
{
  "sections": [
    { "name": "Quantitative",  "questionType": "MCQ_ONLY",     "mcqCount": 8, "aiGuidance": "Numerical reasoning" },
    { "name": "Communication", "questionType": "WRITTEN_ONLY", "writtenCount": 2 },
    { "name": "Logical",       "questionType": "BOTH",         "mcqCount": 6, "writtenCount": 1 }
  ]
}

// PATCH /assessments/:id  (steps 2 & 3)
{
  "level": "SENIOR",
  "candidateInstructions": "You have 60 minutes. No external resources.",
  "opensAt": "2026-11-01T09:00:00Z",
  "closesAt": "2026-11-07T17:00:00Z",
  "timezone": "Asia/Kolkata",
  "eligibilityThreshold": 70,
  "saveAndResume": true
}
```

### Blueprint response shape

```jsonc
// GET /assessments/:id/blueprint
{
  "data": {
    "blueprintGeneratedAt": "2026-10-26T...",
    "sections": [
      {
        "id": 1, "name": "Quantitative", "questionType": "MCQ_ONLY",
        "questions": [
          { "id": 10, "type": "MCQ", "prompt": "...", "options": ["A","B","C","D"], "correctOption": 2 }
        ]
      },
      {
        "id": 2, "name": "Communication", "questionType": "WRITTEN_ONLY",
        "questions": [ { "id": 15, "type": "WRITTEN", "prompt": "...", "modelAnswer": "..." } ]
      }
    ]
  }
}
```

### New tables (one Prisma file each)

- `assessment_skills` — selected skills
- `assessment_sections` — editable sections (+ `SectionQuestionType` enum)
- `assessment_questions` — generated blueprint questions (+ `QuestionType` enum)

`Assessment` gained wizard columns (job description + file name, candidate
instructions, opens/closes, timezone, eligibility threshold, save & resume,
blueprint timestamp); `level` and `durationMinutes` are now nullable so a draft
can be built up progressively. Run `npm run prisma:migrate` to apply.

### AI integration notes

- DeepSeek is called via its OpenAI-compatible `POST /chat/completions` with JSON
  mode (`response_format: json_object`). Config lives in `src/lib/deepseek.js`;
  prompts + response normalization in `src/services/ai.service.js`.
- AI output is clamped/validated before use (section types coerced, counts
  bounded, MCQ options checked) so a malformed model response can't corrupt data.
- All wizard routes require auth, same as the rest of the module.
