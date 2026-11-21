# Development Guidelines & Standards

**Version**: 1.0
**Last Updated**: 2026-01-27

This document defines coding standards, conventions, and best practices for the nosk project.

---

## Table of Contents

1. [General Principles](#general-principles)
2. [Python/Backend Standards](#pythonbackend-standards)
3. [JavaScript/Frontend Standards](#javascriptfrontend-standards)
4. [Database Standards](#database-standards)
5. [Git Workflow](#git-workflow)
6. [Code Review Guidelines](#code-review-guidelines)
7. [Testing Standards](#testing-standards)
8. [Documentation Standards](#documentation-standards)

---

## General Principles

### Core Values

1. **Simplicity**: Write simple, readable code over clever solutions
2. **Consistency**: Follow established patterns throughout the codebase
3. **Explicit > Implicit**: Make intentions clear
4. **DRY**: Don't Repeat Yourself (but don't over-abstract)
5. **YAGNI**: You Aren't Gonna Need It (avoid premature optimization)

### Code Philosophy

```python
# Good: Simple and clear
def get_user_by_email(email):
    return db.query(User).filter(User.email == email).first()

# Bad: Over-engineered
def get_entity_by_attribute(entity_class, attribute_name, attribute_value):
    return db.query(entity_class).filter(
        getattr(entity_class, attribute_name) == attribute_value
    ).first()
```

---

## Python/Backend Standards

### Code Style

**Follow PEP 8** with these additions:

- **Line length**: 100 characters (not 79)
- **Quotes**: Use double quotes `"` for strings
- **Imports**: Group stdlib, third-party, local (separated by blank line)

### Formatting Tool

Use **Black** for automatic formatting:

```bash
pip install black
black backend/app --line-length 100
```

**Configuration** (`.black.toml`):
```toml
[tool.black]
line-length = 100
target-version = ['py310']
include = '\.pyi?$'
```

### Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Variables | `snake_case` | `user_email`, `page_count` |
| Functions | `snake_case` | `get_user()`, `create_page()` |
| Classes | `PascalCase` | `User`, `PageManager` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_PAGE_SIZE`, `DEFAULT_TIMEOUT` |
| Private | `_leading_underscore` | `_internal_function()` |
| Modules | `snake_case` | `auth_service.py`, `user_model.py` |

### Type Hints

**Always use type hints** for function parameters and return values:

```python
# Good
def create_user(email: str, password: str) -> User:
    user = User(email=email, password_hash=hash_password(password))
    return user

# Bad
def create_user(email, password):
    user = User(email=email, password_hash=hash_password(password))
    return user
```

### Docstrings

Use **Google-style docstrings**:

```python
def authenticate_user(db: Session, email: str, password: str) -> Optional[User]:
    """
    Authenticate a user by email and password.

    Args:
        db: Database session
        email: User's email address
        password: Plain text password

    Returns:
        User object if authentication succeeds, None otherwise

    Example:
        user = authenticate_user(db, "user@example.com", "password123")
    """
    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(password, user.password_hash):
        return None
    return user
```

### Error Handling

```python
# Good: Specific exceptions
try:
    user = get_user_by_id(user_id)
except UserNotFoundError:
    raise HTTPException(status_code=404, detail="User not found")
except DatabaseError as e:
    logger.error(f"Database error: {e}")
    raise HTTPException(status_code=500, detail="Internal server error")

# Bad: Catch-all
try:
    user = get_user_by_id(user_id)
except Exception:
    pass  # Silent failure
```

### FastAPI Best Practices

```python
# Good: Clear endpoint with proper status codes
@router.post("/users", response_model=UserResponse, status_code=201)
async def create_user(
    user_data: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new user account."""
    if await user_exists(db, user_data.email):
        raise HTTPException(status_code=400, detail="Email already registered")

    user = await create_user_in_db(db, user_data)
    return user

# Bad: Unclear, no validation
@router.post("/users")
def create_user(data: dict):
    user = User(**data)
    db.add(user)
    db.commit()
    return user
```

### Database Queries

```python
# Good: Efficient query with proper filtering
def get_user_pages(db: Session, user_id: str, limit: int = 100) -> List[Page]:
    return (
        db.query(Page)
        .filter(Page.user_id == user_id, Page.deleted == False)
        .order_by(Page.updated_at.desc())
        .limit(limit)
        .all()
    )

# Bad: Load everything, filter in Python
def get_user_pages(db: Session, user_id: str) -> List[Page]:
    all_pages = db.query(Page).all()
    return [p for p in all_pages if p.user_id == user_id and not p.deleted]
```

### File Organization

```
backend/app/
├── models/          # Database models only
│   ├── user.py
│   └── page.py
├── schemas/         # Pydantic schemas only
│   ├── user.py
│   └── page.py
├── api/            # Route handlers only
│   ├── auth.py
│   └── pages.py
├── services/       # Business logic
│   ├── auth_service.py
│   └── page_service.py
├── utils/          # Utilities and helpers
│   ├── security.py
│   └── validators.py
├── config.py       # Configuration
├── database.py     # Database setup
└── main.py         # FastAPI app entry
```

---

## JavaScript/Frontend Standards

### Code Style

**Use ES6+ features**:

```javascript
// Good: Modern JavaScript
const getUserPages = async (userId) => {
    const response = await fetch(`/api/pages?user_id=${userId}`);
    if (!response.ok) {
        throw new Error('Failed to fetch pages');
    }
    return response.json();
};

// Bad: Old-style JavaScript
function getUserPages(userId, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/pages?user_id=' + userId);
    xhr.onload = function() {
        if (xhr.status === 200) {
            callback(null, JSON.parse(xhr.responseText));
        } else {
            callback(new Error('Failed'));
        }
    };
    xhr.send();
}
```

### Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Variables | `camelCase` | `userName`, `pageCount` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_LENGTH`, `API_BASE_URL` |
| Functions | `camelCase` | `getUser()`, `createPage()` |
| Classes | `PascalCase` | `ComponentRegistry`, `PageManager` |
| Private | `_leadingUnderscore` | `_internalMethod()` |
| Files | `kebab-case` | `page-manager.js`, `text-block.js` |

### Module Imports

Always include `.js` extension:

```javascript
// Good
import { generateUUID } from './utils.js';
import PageManager from './page-manager.js';

// Bad
import { generateUUID } from './utils';  // Missing .js
```

### Component Structure

**Consistent component pattern**:

```javascript
import BaseComponent from './base-component.js';
import { debounce } from '../utils.js';

export default class MyComponent extends BaseComponent {
    constructor(data, options) {
        super(data, options);
        this.type = 'my-component';
    }

    getDefaultContent() {
        return { /* default values */ };
    }

    render() {
        const wrapper = this.createWrapper();
        // Create UI elements
        // Add event listeners via this.addEventListener()
        wrapper.appendChild(/* content */);
        this.element = wrapper;
        return wrapper;
    }

    destroy() {
        // Cleanup happens in BaseComponent
        super.destroy();
    }
}
```

### Event Handling

**Always clean up event listeners**:

```javascript
// Good: Use BaseComponent.addEventListener
this.addEventListener(button, 'click', () => {
    this.handleClick();
});

// Bad: Direct addEventListener (won't be cleaned up)
button.addEventListener('click', () => {
    this.handleClick();
});
```

### Async/Await

**Prefer async/await over Promises**:

```javascript
// Good
async function loadPage(pageId) {
    try {
        const page = await apiClient.getPage(pageId);
        const components = await apiClient.getPageComponents(pageId);
        return { page, components };
    } catch (error) {
        console.error('Failed to load page:', error);
        throw error;
    }
}

// Bad
function loadPage(pageId) {
    return apiClient.getPage(pageId)
        .then(page => {
            return apiClient.getPageComponents(pageId)
                .then(components => {
                    return { page, components };
                });
        })
        .catch(error => {
            console.error('Failed to load page:', error);
            throw error;
        });
}
```

### Comments

```javascript
// Good: Explain WHY, not WHAT
// Debounce to prevent excessive API calls during rapid typing
const debouncedUpdate = debounce(() => {
    this.update({ text: element.innerHTML });
}, 500);

// Bad: Obvious comment
// Create a debounced function
const debouncedUpdate = debounce(() => {
    this.update({ text: element.innerHTML });
}, 500);
```

### CSS Class Naming

**Use BEM (Block Element Modifier)**:

```css
/* Block */
.component { }

/* Element */
.component__header { }
.component__content { }

/* Modifier */
.component--highlighted { }
.component__header--large { }
```

Example:
```html
<div class="checklist-container">
    <div class="checklist-item checklist-item--completed">
        <input class="checklist-item__checkbox" type="checkbox">
        <span class="checklist-item__text">Task text</span>
    </div>
</div>
```

---

## Database Standards

### Schema Design

**Follow these principles**:

1. **Use UUIDs for primary keys** (not auto-increment integers)
2. **Always include timestamps** (`created_at`, `updated_at`)
3. **Use soft deletes** (`deleted` boolean flag)
4. **Index foreign keys** and frequently queried columns
5. **Store timestamps as BIGINT** (Unix milliseconds)

### Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Tables | `lowercase_plural` | `users`, `pages`, `components` |
| Columns | `snake_case` | `user_id`, `created_at` |
| Indexes | `idx_table_column` | `idx_pages_user_id` |
| Foreign Keys | `fk_table_column` | `fk_pages_user_id` |

### Migration Files

**Clear, descriptive migration names**:

```python
# Good
"""Add icon and color to pages table

Revision ID: 002
Revises: 001
Create Date: 2026-01-27
"""

# Bad
"""Update pages

Revision ID: 002
"""
```

### SQL in Code

```python
# Good: Use ORM
pages = db.query(Page).filter(
    Page.user_id == user_id,
    Page.deleted == False
).all()

# Acceptable: Raw SQL for complex queries (with parameters)
result = db.execute(
    text("SELECT * FROM pages WHERE user_id = :user_id AND deleted = FALSE"),
    {"user_id": user_id}
)

# Bad: Raw SQL with string concatenation (SQL injection risk!)
result = db.execute(f"SELECT * FROM pages WHERE user_id = '{user_id}'")
```

---

## Git Workflow

### Branch Naming

| Type | Prefix | Example |
|------|--------|---------|
| Feature | `feature/` | `feature/add-markdown-component` |
| Bug Fix | `fix/` | `fix/checklist-indent-bug` |
| Hotfix | `hotfix/` | `hotfix/security-patch` |
| Refactor | `refactor/` | `refactor/api-client` |
| Docs | `docs/` | `docs/update-setup-guide` |

### Commit Messages

**Use conventional commits**:

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting, no code change
- `refactor`: Code restructuring
- `test`: Adding tests
- `chore`: Maintenance

Examples:
```bash
feat(components): add markdown component with live preview

- Implement MarkdownComponent class
- Add toggle between edit and preview modes
- Integrate marked.js for parsing

Closes #42

---

fix(auth): prevent duplicate user registration

Check for existing email before creating user.

Fixes #56
```

### Pull Request Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests added/updated
- [ ] Manual testing completed
- [ ] All tests passing

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated
- [ ] No console.log or debug code left
```

---

## Code Review Guidelines

### For Authors

**Before submitting PR**:
- [ ] Run all tests
- [ ] Format code (Black for Python, Prettier for JS)
- [ ] Remove debug code and console.logs
- [ ] Update documentation
- [ ] Self-review the diff

### For Reviewers

**Focus areas**:
1. **Correctness**: Does it work as intended?
2. **Security**: Any vulnerabilities?
3. **Performance**: Any obvious inefficiencies?
4. **Maintainability**: Is it readable and maintainable?
5. **Tests**: Are there adequate tests?

**Provide constructive feedback**:

```markdown
# Good feedback
Consider using a try-catch here to handle potential network errors gracefully.

# Better feedback with example
Consider using a try-catch here to handle potential network errors:

\`\`\`javascript
try {
    const response = await fetch(url);
    return response.json();
} catch (error) {
    console.error('Network error:', error);
    throw new Error('Failed to fetch data');
}
\`\`\`
```

---

## Testing Standards

### Backend Tests (pytest)

**Structure**:
```
backend/tests/
├── conftest.py         # Fixtures
├── test_auth.py        # Auth tests
├── test_pages.py       # Page tests
└── test_components.py  # Component tests
```

**Example test**:
```python
import pytest
from app.services.auth_service import AuthService

def test_register_user_success(db_session):
    """Test successful user registration."""
    user = AuthService.register_user(
        db_session,
        email="test@example.com",
        password="password123"
    )

    assert user.id is not None
    assert user.email == "test@example.com"
    assert user.password_hash != "password123"  # Should be hashed

def test_register_user_duplicate_email(db_session):
    """Test registration with duplicate email raises error."""
    AuthService.register_user(db_session, "test@example.com", "pass123")

    with pytest.raises(ValueError, match="Email already registered"):
        AuthService.register_user(db_session, "test@example.com", "pass456")
```

### Frontend Tests (Jest - Optional)

**Structure**:
```
frontend/tests/
├── components/
│   ├── text-block.test.js
│   └── checklist.test.js
└── utils.test.js
```

**Example test**:
```javascript
import TextBlockComponent from '../js/components/text-block.js';

describe('TextBlockComponent', () => {
    test('renders with default content', () => {
        const component = new TextBlockComponent();
        const element = component.render();

        expect(element).toBeTruthy();
        expect(element.querySelector('.text-block-content')).toBeTruthy();
    });

    test('updates content on change', () => {
        const onChange = jest.fn();
        const component = new TextBlockComponent({}, { onChange });

        component.update({ text: 'New text' });

        expect(onChange).toHaveBeenCalled();
        expect(component.content.text).toBe('New text');
    });
});
```

### Test Coverage

**Aim for**:
- Backend: 80%+ coverage
- Critical paths: 100% coverage (auth, data operations)
- Frontend: 60%+ coverage (unit tests for components)

---

## Documentation Standards

### Code Documentation

**Document**:
- All public APIs
- Complex algorithms
- Non-obvious behavior
- Security-sensitive code

**Don't document**:
- Obvious code
- Trivial getters/setters

### Inline Comments

```python
# Good: Explains WHY
# Use bcrypt with 12 rounds to balance security and performance
password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(12))

# Bad: Explains WHAT (obvious)
# Hash the password
password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(12))
```

### README Updates

**Keep README.md current** with:
- Project description
- Quick start guide
- Link to detailed docs
- Contribution guidelines

### API Documentation

**Use FastAPI's automatic docs** + custom descriptions:

```python
@router.post(
    "/pages",
    response_model=PageResponse,
    status_code=201,
    summary="Create a new page",
    description="Creates a new page for the authenticated user with the provided title and optional icon/color."
)
async def create_page(page_data: PageCreate, db: Session = Depends(get_db)):
    """
    Create a new page.

    - **title**: Page title (required, max 200 chars)
    - **icon**: Optional emoji icon
    - **color**: Optional hex color
    """
    pass
```

---

## Performance Guidelines

### Backend

1. **Use connection pooling** for database
2. **Index frequently queried columns**
3. **Paginate large result sets**
4. **Use async endpoints** where appropriate
5. **Cache expensive computations**

### Frontend

1. **Debounce user input** (500ms for typing)
2. **Lazy load components** when possible
3. **Minimize DOM manipulations**
4. **Use event delegation** for dynamic content
5. **Cache API responses** in IndexedDB

---

## Security Checklist

- [ ] **Never store passwords in plain text**
- [ ] **Always use parameterized queries**
- [ ] **Validate all user input**
- [ ] **Sanitize HTML output**
- [ ] **Use HTTPS in production**
- [ ] **Implement rate limiting**
- [ ] **Use secure JWT tokens**
- [ ] **Enable CORS properly**
- [ ] **Keep dependencies updated**
- [ ] **Log security events**

---

## Accessibility Guidelines

1. **Use semantic HTML** (`<nav>`, `<main>`, `<article>`)
2. **Add ARIA labels** where needed
3. **Support keyboard navigation** (Tab, Enter, Escape)
4. **Ensure color contrast** (WCAG AA minimum)
5. **Provide text alternatives** for icons/images

---

**Last Updated**: 2026-01-27
**Version**: 1.0
