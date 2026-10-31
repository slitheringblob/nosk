# nosk
tasks and notes that sync across devices seamlessly

Offline-first block editor (26 block types) with real-time multi-device sync, per-block conflict
resolution, sharing, comments, version history, search, templates and Markdown import/export.

- **Backend**: FastAPI + SQLAlchemy (async) + Alembic — SQLite in development, PostgreSQL in production
- **Frontend**: plain HTML/CSS/ES modules, no build step; IndexedDB for local data; installable PWA

## Run it

Backend (port 8000):

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env      # set SECRET_KEY
alembic upgrade head
uvicorn app.main:app --reload
```

Frontend (port 3000, in another terminal):

```bash
cd frontend
python -m http.server 3000
```

Open http://localhost:3000 and create an account. In development, verification and password
reset emails are printed to the backend log (`EMAIL_BACKEND=console`).

The frontend calls the API on the same host at port 8000. To point it elsewhere, define
`window.NOSK_CONFIG = { apiBaseUrl: 'https://api.example.com' }` before the scripts in
`index.html` / `login.html`, and add the frontend's origin to `FRONTEND_ORIGIN` in the backend `.env`.

## Tests

```bash
cd backend && source venv/bin/activate && pytest     # 129 tests: API, sync, auth, migrations
cd frontend && npm install && npm test                # 58 tests: components, sync client, editor
```

## Project documentation

Planning and reference docs live in `project_plan/`. Start with the "Status & Revisions" section of
`PROJECT_PLAN.md`, which lists how the implementation departs from the original plan and why; the
"v2" sections of `API_SPEC.md` and `DATABASE_SCHEMA.md` describe the final contracts.
