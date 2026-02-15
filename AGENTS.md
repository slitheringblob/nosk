# Repository Guidelines

## Project Structure & Module Organization
nosk currently keeps planning docs at the repo root; place backend code under `backend/` (FastAPI) and frontend experiments under `frontend/` (vanilla JS). Domain logic belongs inside `backend/app/{api,models,schemas,services,utils}` with migrations/config in `backend/alembic`. Pytest suites must mirror modules under `backend/tests`, while UI components sit in `frontend/js/components`, helpers in `frontend/js/utils`, and static assets in `frontend/assets`. Keep shared environment examples in `backend/.env.example` and never commit live secrets.

## Build, Test, and Development Commands
- `cd backend && source venv/bin/activate && uvicorn app.main:app --reload`: boot the API with hot reload.
- `cd backend && source venv/bin/activate && pytest`: execute backend unit and integration tests.
- `cd backend && source venv/bin/activate && alembic upgrade head`: apply the latest database migrations.
- `cd frontend && python -m http.server 3000`: preview the static prototype without a bundler.
- `sqlite3 nosk.db` or `psql -U noskuser -d nosk`: inspect local data while debugging.

## Coding Style & Naming Conventions
Follow PEP 8 with a 100-character limit, double quotes, 4-space indents, and exhaustive type hints; run `black backend/app --line-length 100` before committing. JavaScript stays ES6+, uses camelCase for variables/functions, PascalCase for classes, kebab-case filenames, and explicit `.js` extensions; format with `npx prettier --write frontend/**/*.js`. Name components after their block type, collocate services and Pydantic models with their feature, and avoid single-letter identifiers outside tight loops.

## Testing Guidelines
Backend tests live in `backend/tests/<module>/test_<feature>.py` and rely on fixtures in `tests/conftest.py`. Frontend behavior resides in `frontend/tests/components/*.test.js`, using Jest-style `describe`/`test` blocks with descriptive names. Target ≥80% backend coverage, ≥60% frontend, and 100% on auth/sync paths; run `pytest` plus any necessary browser checks before every push and capture coverage deltas for risky work.

## Commit & Pull Request Guidelines
Create topic branches such as `feature/<slug>`, `fix/<issue>`, or `docs/<scope>`. Use Conventional Commits (e.g., `feat(components): add markdown toggle`) with concise, imperative subjects and optional bullet bodies. PRs must explain motivation, list verification commands, link issues, and include screenshots or API samples whenever UI or response payloads change. Confirm formatting, tests, and documentation updates before requesting review.

## Security & Configuration Tips
Store secrets exclusively in environment variables and keep `.env` files out of Git. Sanitize user-supplied HTML/Markdown, validate payload schemas, and rely on SQLAlchemy parameterization to prevent injection. Enable HTTPS, tuned CORS, and JWT expirations in `config.py` ahead of deployments, and throttle websocket sync events to guard against replay floods.
