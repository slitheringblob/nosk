# nosk
tasks and notes that sync across devices seamlessly

## Backend quickstart

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload
```

## Project documentation

All planning and reference docs (API spec, component guide, database schema, setup guides, etc.) now
live under the `project_plan/` directory to keep the repo root tidy.
