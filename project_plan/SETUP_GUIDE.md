# nosk Development Setup Guide

**Version**: 1.0
**Last Updated**: 2026-01-27

This guide provides step-by-step instructions for setting up the nosk development environment.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Backend Setup](#backend-setup)
3. [Frontend Setup](#frontend-setup)
4. [Database Setup](#database-setup)
5. [Running the Application](#running-the-application)
6. [Development Workflow](#development-workflow)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software

1. **Python 3.10+**
   ```bash
   python --version
   # Should output: Python 3.10.x or higher
   ```

2. **Node.js 18+** (optional, for development tools)
   ```bash
   node --version
   # Should output: v18.x.x or higher
   ```

3. **Git**
   ```bash
   git --version
   # Should output: git version 2.x.x
   ```

4. **PostgreSQL 14+** (production) or **SQLite 3.35+** (development)
   ```bash
   # PostgreSQL
   psql --version

   # SQLite
   sqlite3 --version
   ```

### Optional Tools

- **VS Code** or preferred IDE
- **Postman** or **Insomnia** for API testing
- **Git GUI** (GitKraken, SourceTree, etc.)

---

## Backend Setup

### Step 1: Clone Repository

```bash
git clone https://github.com/yourusername/nosk.git
cd nosk
```

### Step 2: Create Backend Directory Structure

```bash
mkdir -p backend/app/{models,schemas,api,services,utils}
mkdir -p backend/alembic
touch backend/app/__init__.py
touch backend/app/models/__init__.py
touch backend/app/schemas/__init__.py
touch backend/app/api/__init__.py
touch backend/app/services/__init__.py
touch backend/app/utils/__init__.py
```

### Step 3: Create Python Virtual Environment

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Linux/Mac:
source venv/bin/activate

# On Windows:
venv\Scripts\activate

# Verify activation (should show (venv) prefix in terminal)
```

### Step 4: Install Dependencies

Create `requirements.txt`:

```bash
cat > requirements.txt << 'EOF'
fastapi==0.109.0
uvicorn[standard]==0.27.0
sqlalchemy==2.0.25
alembic==1.13.1
pydantic==2.5.3
pydantic-settings==2.1.0
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
python-multipart==0.0.6
psycopg2-binary==2.9.9
python-dotenv==1.0.0
EOF
```

Install packages:

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

### Step 5: Configure Environment

Create `.env` file:

```bash
cat > .env << 'EOF'
# Application
APP_NAME=nosk
DEBUG=True

# Database (SQLite for development)
DATABASE_URL=sqlite:///./nosk.db

# For PostgreSQL in production:
# DATABASE_URL=postgresql://user:password@localhost:5432/nosk

# JWT Configuration
SECRET_KEY=your-secret-key-change-this-in-production
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=10080

# CORS (Frontend URL)
CORS_ORIGINS=["http://localhost:3000", "http://127.0.0.1:3000"]
EOF
```

**Important**: Change `SECRET_KEY` to a random string:

```bash
# Generate a secure secret key
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### Step 6: Verify Backend Setup

Test that FastAPI is working:

```bash
# Create a simple test file
cat > test_server.py << 'EOF'
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "Backend is working!"}
EOF

# Run test server
uvicorn test_server:app --reload

# Visit: http://localhost:8000
# Should see: {"message": "Backend is working!"}

# Stop server: Ctrl+C
# Remove test file
rm test_server.py
```

---

## Frontend Setup

### Step 1: Create Frontend Directory Structure

```bash
cd ..  # Go back to project root
mkdir -p frontend/{css,js/components,lib}
```

### Step 2: Download Required Libraries

```bash
cd frontend/lib

# Download marked.js (Markdown parser)
curl -o marked.min.js https://cdn.jsdelivr.net/npm/marked/marked.min.js

# Download idb.js (IndexedDB wrapper)
curl -o idb.js https://cdn.jsdelivr.net/npm/idb@7/build/umd.js

cd ../..  # Back to project root
```

### Step 3: Create Basic HTML Files

Create `frontend/index.html`:

```bash
cat > frontend/index.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>nosk</title>
    <link rel="stylesheet" href="css/main.css">
</head>
<body>
    <div id="app">
        <h1>nosk is running!</h1>
        <p>Frontend setup complete.</p>
    </div>
    <script type="module" src="js/app.js"></script>
</body>
</html>
EOF
```

Create `frontend/css/main.css`:

```bash
cat > frontend/css/main.css << 'EOF'
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    line-height: 1.6;
    color: #333;
}

#app {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
}
EOF
```

Create `frontend/js/app.js`:

```bash
cat > frontend/js/app.js << 'EOF'
console.log('nosk frontend initialized');

// Test that modules work
import { generateUUID } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded');
    console.log('Test UUID:', generateUUID());
});
EOF
```

Create `frontend/js/utils.js`:

```bash
cat > frontend/js/utils.js << 'EOF'
export function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export function now() {
    return Date.now();
}

export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

export function stripHTML(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || div.innerText || '';
}
EOF
```

### Step 4: Start a Local Server

Choose one option:

**Option 1: Python HTTP Server**
```bash
cd frontend
python -m http.server 3000
# Visit: http://localhost:3000
```

**Option 2: Node.js HTTP Server** (if Node.js installed)
```bash
cd frontend
npx serve -p 3000
# Visit: http://localhost:3000
```

**Option 3: PHP Server** (if PHP installed)
```bash
cd frontend
php -S localhost:3000
# Visit: http://localhost:3000
```

You should see "nosk is running!" in the browser.

---

## Database Setup

### Option 1: SQLite (Development - Recommended for Quick Start)

SQLite requires no additional setup. The database file will be created automatically when you run the backend.

```bash
cd backend
# Database will be created as 'nosk.db' when app starts
```

### Option 2: PostgreSQL (Production)

#### Install PostgreSQL

**On Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
```

**On macOS:**
```bash
brew install postgresql
brew services start postgresql
```

**On Windows:**
Download installer from https://www.postgresql.org/download/windows/

#### Create Database

```bash
# Switch to postgres user
sudo -u postgres psql

# In PostgreSQL shell:
CREATE DATABASE nosk;
CREATE USER noskuser WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE nosk TO noskuser;
\q
```

#### Update Backend Configuration

Edit `backend/.env`:

```bash
DATABASE_URL=postgresql://noskuser:your_password@localhost:5432/nosk
```

---

## Running the Application

### Start Backend Server

```bash
cd backend
source venv/bin/activate  # Activate virtual environment
uvicorn app.main:app --reload --port 8000
```

You should see:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Application startup complete.
```

Visit:
- API: http://localhost:8000
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

### Start Frontend Server

In a new terminal:

```bash
cd frontend
python -m http.server 3000
```

Visit: http://localhost:3000

### Verify Full Stack

1. Backend responds: http://localhost:8000
2. API docs load: http://localhost:8000/docs
3. Frontend loads: http://localhost:3000
4. Browser console shows no errors

---

## Development Workflow

### Daily Development

1. **Start Backend**:
   ```bash
   cd backend
   source venv/bin/activate
   uvicorn app.main:app --reload --port 8000
   ```

2. **Start Frontend** (new terminal):
   ```bash
   cd frontend
   python -m http.server 3000
   ```

3. **Make Changes**:
   - Edit backend files → Auto-reload (thanks to `--reload`)
   - Edit frontend files → Refresh browser

### Database Migrations

When you change database models:

```bash
cd backend
source venv/bin/activate

# Create migration
alembic revision --autogenerate -m "Description of changes"

# Review migration file in alembic/versions/

# Apply migration
alembic upgrade head

# Rollback if needed
alembic downgrade -1
```

### Running Tests

```bash
# Backend tests
cd backend
pytest

# Frontend tests (if using Jest)
cd frontend
npm test
```

### Git Workflow

```bash
# Create feature branch
git checkout -b feature/your-feature-name

# Make changes and commit
git add .
git commit -m "Add feature description"

# Push to remote
git push origin feature/your-feature-name

# Create pull request on GitHub
```

---

## Troubleshooting

### Backend Issues

#### Issue: `ModuleNotFoundError: No module named 'fastapi'`

**Solution**: Activate virtual environment
```bash
cd backend
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
```

#### Issue: `Address already in use`

**Solution**: Port 8000 is occupied
```bash
# Find process using port 8000
lsof -i :8000  # On Mac/Linux
netstat -ano | findstr :8000  # On Windows

# Kill process or use different port
uvicorn app.main:app --reload --port 8001
```

#### Issue: Database connection errors

**Solution**: Check DATABASE_URL in `.env`
```bash
# For SQLite
DATABASE_URL=sqlite:///./nosk.db

# For PostgreSQL, verify credentials
DATABASE_URL=postgresql://user:password@localhost:5432/nosk
```

#### Issue: `ImportError: No module named 'psycopg2'`

**Solution**: Install PostgreSQL adapter
```bash
pip install psycopg2-binary
```

### Frontend Issues

#### Issue: "CORS policy" error in browser console

**Solution**: Update backend CORS configuration

In `backend/app/main.py`:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

#### Issue: ES6 modules not working

**Solution**: Ensure:
1. Scripts use `type="module"`: `<script type="module" src="..."></script>`
2. Imports have `.js` extension: `import { func } from './utils.js'`
3. Serving via HTTP server (not `file://`)

#### Issue: Libraries (marked.js, idb.js) not loading

**Solution**: Re-download libraries
```bash
cd frontend/lib
curl -o marked.min.js https://cdn.jsdelivr.net/npm/marked/marked.min.js
curl -o idb.js https://cdn.jsdelivr.net/npm/idb@7/build/umd.js
```

Or use CDN in HTML:
```html
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
```

### Database Issues

#### Issue: SQLite database locked

**Solution**: Close other connections or restart server
```bash
# Check for processes using database
lsof nosk.db

# Delete database and recreate (DEV ONLY!)
rm nosk.db
# Restart backend to recreate
```

#### Issue: PostgreSQL authentication failed

**Solution**: Check credentials and pg_hba.conf
```bash
# Edit pg_hba.conf (location varies by OS)
# Change authentication method to 'md5' or 'trust' for localhost

# Restart PostgreSQL
sudo systemctl restart postgresql  # Linux
brew services restart postgresql   # macOS
```

### General Issues

#### Issue: Port conflicts

**Solution**: Use different ports
```bash
# Backend
uvicorn app.main:app --reload --port 8001

# Frontend
python -m http.server 3001
```

#### Issue: Permission denied

**Solution**: Check file permissions
```bash
# On Linux/Mac
chmod +x script.sh
sudo chown -R $USER:$USER .
```

---

## IDE Setup

### VS Code

Recommended extensions:
- Python
- Pylance
- SQLite Viewer
- REST Client
- ESLint
- Live Server

**Settings** (`.vscode/settings.json`):
```json
{
    "python.defaultInterpreterPath": "${workspaceFolder}/backend/venv/bin/python",
    "python.linting.enabled": true,
    "python.formatting.provider": "black",
    "editor.formatOnSave": true,
    "[python]": {
        "editor.defaultFormatter": "ms-python.black-formatter"
    }
}
```

### PyCharm

1. Open project
2. Configure Python interpreter: Settings → Project → Python Interpreter
3. Select: `backend/venv/bin/python`
4. Enable FastAPI support
5. Configure run configuration for `uvicorn app.main:app`

---

## Environment Variables Reference

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `APP_NAME` | Application name | nosk | No |
| `DEBUG` | Debug mode | False | No |
| `DATABASE_URL` | Database connection string | sqlite:///./nosk.db | Yes |
| `SECRET_KEY` | JWT secret key | - | Yes |
| `ALGORITHM` | JWT algorithm | HS256 | No |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Token expiry | 10080 (7 days) | No |
| `CORS_ORIGINS` | Allowed CORS origins | ["*"] | No |

---

## Next Steps

After setup is complete:

1. ✅ Read [PROJECT_PLAN.md](./PROJECT_PLAN.md) for architecture overview
2. ✅ Review [API_SPEC.md](./API_SPEC.md) for API documentation
3. ✅ Check [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) for database design
4. ✅ Study [COMPONENT_GUIDE.md](./COMPONENT_GUIDE.md) for component development
5. ✅ Start implementing features following the plan

---

## Useful Commands Reference

```bash
# Backend
cd backend && source venv/bin/activate
uvicorn app.main:app --reload
alembic upgrade head
pytest

# Frontend
cd frontend
python -m http.server 3000

# Database
sqlite3 nosk.db
psql -U noskuser -d nosk

# Git
git status
git add .
git commit -m "message"
git push origin branch-name
```

---

**Need Help?**

- Check documentation in this repository
- Review code examples in component guides
- Test API endpoints in Swagger UI (http://localhost:8000/docs)
- Open an issue on GitHub

---

**Last Updated**: 2026-01-27
**Version**: 1.0
