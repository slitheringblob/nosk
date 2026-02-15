# nosk - Comprehensive Project Plan

## Vision
A lightweight, cross-device synchronized note and task management system with a rich component-based architecture inspired by Notion, Obsidian, and Wisk.

---

## Component System Design

### Research Summary

Based on analysis of leading note-taking applications:

**Notion's approach**: 50+ block types organized in 6 categories (Basic, Database, Media, Embeds, Advanced, Inline). Everything is a block including text, images, databases.

**Obsidian's approach**: Markdown-centric with plugins for extensibility. Recently added Databases (Bases) feature. Focus on plain-text, future-proof format.

**Wisk's approach**: Plugin-based architecture with component properties (category, textual content, metadata). API-driven extensibility.

### Core Design Principles

1. **Pure & Lightweight**: Each component is self-contained HTML/CSS/JS
2. **Zero Dependencies**: Core components use no external libraries (except markdown parser)
3. **Progressive Enhancement**: Basic functionality works, enhanced features are optional
4. **Export-Friendly**: Components export to clean JSON data structures
5. **Library-Agnostic**: Can be wrapped in React, Vue, Svelte, or used standalone

### Component Interface Standard

Every component follows this interface:

```javascript
class Component {
  constructor(data, options) {
    this.id = data.id || generateUUID();
    this.type = ''; // component type identifier
    this.content = data.content || {};
    this.metadata = {
      created_at: data.created_at || Date.now(),
      updated_at: Date.now(),
      order: data.order || 0,
      schema_version: 1
    };
  }

  render() {
    // Returns DOM element
  }

  serialize() {
    // Returns JSON-serializable object
  }

  update(content) {
    // Updates component content
  }

  destroy() {
    // Cleanup
  }
}
```

---

## Component Types

### Phase 1: Core Components (MVP)

#### 1. Text Block (Enhanced)
- **Type**: `text-block`
- **Purpose**: Rich text with inline formatting
- **Features**: Bold, italic, strikethrough, code, links, @ mentions (future), keyboard shortcuts
- **Library**: ContentEditable API (native)

#### 2. Heading Block
- **Type**: `heading`
- **Levels**: H1, H2, H3
- **Features**: Auto-generate anchor links, TOC support

#### 3. Markdown Block
- **Type**: `markdown`
- **Features**: Full markdown syntax, live preview toggle, syntax highlighting
- **Library**: marked.js

#### 4. Checklist/Todo Block
- **Type**: `checklist`
- **Features**: Nested checkboxes, strike-through on completion, progress indicator, sub-tasks

#### 5. Bulleted List
- **Type**: `bullet-list`
- **Features**: Multi-level nesting, drag to reorder, convert to checklist

#### 6. Numbered List
- **Type**: `numbered-list`
- **Features**: Auto-numbering, multi-level (1, 1.1, 1.1.1), convert to bullets

#### 7. Toggle/Accordion Block
- **Type**: `toggle`
- **Features**: Collapsible section, contains other components, nested toggles, remember state

#### 8. Callout/Alert Block
- **Type**: `callout`
- **Variants**: Info, Warning, Success, Error, Note
- **Features**: Color-coded backgrounds, icons, collapsible (optional)

#### 9. Divider/Separator
- **Type**: `divider`
- **Styles**: Line, dashed, dotted, thick

### Phase 2: Enhanced Components

- **Quote Block** (`quote`)
- **Code Block** (`code`) with syntax highlighting
- **Table Block** (`table`) with basic editing

### Phase 3: Media & Embeds

- **Image Block** (`image`)
- **Link Preview/Bookmark** (`bookmark`)
- **Embed Block** (`embed`) - YouTube, Twitter, etc.
- **File Attachment** (`file`)

### Phase 4: Advanced Components

- **Key-Value Pairs / Properties** (`properties`)
- **Date/Timestamp** (`date`)
- **Tag Cloud** (`tags`)
- **Horizontal Sections/Columns** (`columns`)
- **Template Block** (`template`)
- **Math/Equation Block** (`math`) - LaTeX

### Phase 5: Collaborative & Advanced

- **Comment/Annotation Block** (`comment`)
- **Reference/Link to Page** (`page-link`)
- **Canvas/Drawing Block** (`canvas`)
- **Simple Database/Collection** (`database`)

---

## Detailed Data Schemas

### Universal Component Structure

```typescript
interface BaseComponent {
  id: string;                    // UUID v4
  type: string;                  // Component type identifier
  content: ComponentContent;     // Type-specific content
  metadata: {
    created_at: number;          // Unix timestamp (ms)
    updated_at: number;          // Unix timestamp (ms)
    order: number;               // Position in page (0-based)
    schema_version: number;      // Schema version for migrations
  };
}
```

### 1. Text Block Schema

```json
{
  "id": "uuid",
  "type": "text-block",
  "content": {
    "text": "HTML string with <strong>bold</strong> and <em>italic</em>",
    "format": "html"
  },
  "metadata": {
    "created_at": 1706284800000,
    "updated_at": 1706284900000,
    "order": 0,
    "schema_version": 1
  }
}
```

**Validation**:
- `text` max length: 10,000 characters
- Supported tags: `<strong>`, `<em>`, `<del>`, `<code>`, `<a>`, `<mark>`

### 2. Heading Schema

```json
{
  "type": "heading",
  "content": {
    "text": "Introduction to Nosk",
    "level": 1
  }
}
```

**Validation**:
- `text` max length: 200 characters
- `level` must be 1, 2, or 3
- No HTML formatting allowed

### 3. Markdown Schema

```json
{
  "type": "markdown",
  "content": {
    "source": "# Title\n\n- Bullet 1\n- Bullet 2",
    "preview_mode": false
  }
}
```

**Validation**:
- `source` max length: 50,000 characters
- `preview_mode` defaults to `false`

### 4. Checklist Schema

```json
{
  "type": "checklist",
  "content": {
    "items": [
      {
        "id": "item-1",
        "text": "Complete project proposal",
        "checked": true,
        "indent_level": 0
      },
      {
        "id": "item-2",
        "text": "Review with team",
        "checked": false,
        "indent_level": 1
      }
    ]
  }
}
```

**Validation**:
- Max 500 items per checklist
- `text` max length: 1,000 characters per item
- `indent_level` must be 0-3

### 5. Bulleted List Schema

```json
{
  "type": "bullet-list",
  "content": {
    "items": [
      {
        "id": "item-1",
        "text": "First main point",
        "indent_level": 0
      }
    ]
  }
}
```

### 6. Numbered List Schema

```json
{
  "type": "numbered-list",
  "content": {
    "items": [
      {
        "id": "item-1",
        "text": "First step",
        "indent_level": 0
      }
    ],
    "start_number": 1
  }
}
```

### 7. Toggle Schema

```json
{
  "type": "toggle",
  "content": {
    "title": "Click to expand details",
    "children": ["component-id-1", "component-id-2"],
    "is_open": false
  }
}
```

**Note**: Children are stored separately; toggle only stores IDs

### 8. Callout Schema

```json
{
  "type": "callout",
  "content": {
    "text": "Important note here",
    "variant": "info",
    "icon": "info-circle"
  }
}
```

**Variants**: `info`, `warning`, `success`, `error`, `note`

### 9. Divider Schema

```json
{
  "type": "divider",
  "content": {
    "style": "solid"
  }
}
```

**Styles**: `solid`, `dashed`, `dotted`, `thick`

### Page Schema

```json
{
  "id": "page-uuid",
  "user_id": "user-uuid",
  "title": "Project Planning",
  "component_ids": ["comp-1", "comp-2", "comp-3"],
  "metadata": {
    "created_at": 1706284800000,
    "updated_at": 1706284950000,
    "version": 5,
    "deleted": false,
    "icon": "📋",
    "color": null
  }
}
```

---

## Component Picker UI Design

### Slash Command System

**Trigger**: Type `/` at the start of empty component or after Enter

### Command List

| Command | Component | Description |
|---------|-----------|-------------|
| `/text` | text-block | Text with formatting |
| `/h1` | heading level 1 | Large heading |
| `/h2` | heading level 2 | Medium heading |
| `/h3` | heading level 3 | Small heading |
| `/md` | markdown | Markdown editor |
| `/check` | checklist | Task list with checkboxes |
| `/bullet` | bullet-list | Bulleted list |
| `/number` | numbered-list | Numbered list |
| `/toggle` | toggle | Collapsible section |
| `/callout` | callout | Highlighted callout box |
| `/divider` | divider | Horizontal divider |

### Picker UI

```
┌─────────────────────────────────────────────────┐
│ /                                               │
├─────────────────────────────────────────────────┤
│ 📝 Text                              /text      │ ← Selected
│ # Heading 1                          /h1        │
│ ✓ Checklist                          /check     │
│ • Bulleted List                      /bullet    │
│ 1. Numbered List                     /number    │
└─────────────────────────────────────────────────┘
```

**Navigation**: ↑↓ arrows, Enter to select, Escape to close

### Plus Button Picker

Visual menu with component cards organized by category:

```
┌───────────────────────────────────────────────┐
│  Basic                                        │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐         │
│  │ 📝   │ │  #   │ │  ✓   │ │  •   │         │
│  │ Text │ │Head. │ │Check │ │List  │         │
│  └──────┘ └──────┘ └──────┘ └──────┘         │
└───────────────────────────────────────────────┘
```

---

## Keyboard Shortcuts System

### Global Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + S` | Save page |
| `Cmd/Ctrl + F` | Search |
| `Cmd/Ctrl + K` | Quick actions |
| `Cmd/Ctrl + Z` | Undo |
| `/` | Insert component |

### Text Formatting

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + B` | Bold |
| `Cmd/Ctrl + I` | Italic |
| `Cmd/Ctrl + E` | Inline code |
| `Cmd/Ctrl + K` | Add link |

### Component Navigation

| Shortcut | Action |
|----------|--------|
| `↑/↓` | Move up/down |
| `Cmd/Ctrl + ↑` | Move component up |
| `Cmd/Ctrl + ↓` | Move component down |
| `Cmd/Ctrl + Enter` | New text block |
| `Cmd/Ctrl + D` | Duplicate |

### List Shortcuts

| Shortcut | Action |
|----------|--------|
| `Tab` | Indent |
| `Shift + Tab` | Outdent |
| `Enter` | New item |
| `Cmd/Ctrl + Enter` | Exit list |

---

## Drag-and-Drop Reordering

### Visual Design

Each component has a drag handle (⋮⋮) shown on hover:

```
┌──┬────────────────────────────────────────┐
│⋮⋮│ This is a text block                   │
└──┴────────────────────────────────────────┘
```

### Drop Indicator

Blue line shows where component will be dropped:

```
┌──────────────────────────────────────────┐
│ Component 1                              │
└──────────────────────────────────────────┘
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ← Drop zone
┌──────────────────────────────────────────┐
│ Component 3                              │
└──────────────────────────────────────────┘
```

### Keyboard Alternative

- `Cmd/Ctrl + ↑` to move component up
- `Cmd/Ctrl + ↓` to move component down

---

## Component Conversion System

### Conversion Matrix

| From → To | Text | Checklist | Bullet | Numbered |
|-----------|------|-----------|--------|----------|
| **Text** | - | ✓ | ✓ | ✓ |
| **Checklist** | ✓ | - | ✓ | ✓ |
| **Bullet** | ✓ | ✓ | - | ✓ |
| **Numbered** | ✓ | ✓ | ✓ | - |

### Conversion UI

Right-click context menu:
```
┌────────────────────────────┐
│ Convert to...              │
├────────────────────────────┤
│ ✓ Checklist                │
│ • Bulleted List            │
│ 1. Numbered List           │
│ 📝 Text Block              │
└────────────────────────────┘
```

---

## Technical Architecture

### Project Structure

```
nosk/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI entry
│   │   ├── config.py            # Configuration
│   │   ├── database.py          # Database connection
│   │   ├── models/
│   │   │   ├── user.py          # User model
│   │   │   ├── page.py          # Page model
│   │   │   └── component.py     # Component model
│   │   ├── schemas/
│   │   │   ├── user.py          # Pydantic schemas
│   │   │   ├── page.py
│   │   │   └── component.py
│   │   ├── api/
│   │   │   ├── auth.py          # Auth endpoints
│   │   │   ├── pages.py         # Page endpoints
│   │   │   └── components.py    # Component endpoints
│   │   ├── services/
│   │   │   ├── auth_service.py
│   │   │   └── sync_service.py
│   │   └── utils/
│   │       ├── security.py      # JWT, password hashing
│   │       └── validators.py
│   ├── requirements.txt
│   └── .env.example
│
├── frontend/
│   ├── index.html               # Main app
│   ├── login.html               # Login/register
│   ├── css/
│   │   ├── main.css             # Global styles
│   │   ├── components.css       # Component styles
│   │   ├── picker.css           # Picker styles
│   │   └── dragdrop.css         # Drag-drop styles
│   ├── js/
│   │   ├── app.js               # App init
│   │   ├── config.js            # Config
│   │   ├── auth.js              # Authentication
│   │   ├── api-client.js        # API wrapper
│   │   ├── storage.js           # IndexedDB wrapper
│   │   ├── page-manager.js      # Page management
│   │   ├── sync-client.js       # Sync logic
│   │   ├── keyboard-manager.js  # Shortcuts
│   │   ├── dragdrop-manager.js  # Drag-drop
│   │   ├── component-picker.js  # Slash commands
│   │   ├── component-converter.js
│   │   ├── utils.js
│   │   └── components/
│   │       ├── base-component.js
│   │       ├── registry.js
│   │       ├── text-block.js
│   │       ├── heading.js
│   │       ├── markdown.js
│   │       ├── checklist.js
│   │       ├── bullet-list.js
│   │       ├── numbered-list.js
│   │       ├── toggle.js
│   │       ├── callout.js
│   │       └── divider.js
│   └── lib/
│       ├── marked.min.js        # Markdown parser
│       └── idb.js               # IndexedDB wrapper
```

---

## Phase 1 Implementation Plan: MVP

### Goal
Build a working prototype with:
- User authentication (register, login, logout)
- Page CRUD operations
- All 9 MVP components working
- Local storage with IndexedDB
- Basic periodic sync (no real-time yet)
- Component picker (slash commands)
- Drag-and-drop reordering

### Tech Stack
- **Backend**: Python 3.10+, FastAPI, SQLAlchemy, SQLite (dev) / PostgreSQL (prod)
- **Frontend**: Pure HTML/CSS/JS (ES6 modules)
- **Libraries**: marked.js (markdown), idb (IndexedDB wrapper)

### Backend Dependencies

```txt
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
```

### API Endpoints

#### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login (returns JWT)
- `POST /api/auth/logout` - Logout

#### Pages
- `GET /api/pages` - List all pages for user
- `GET /api/pages/{page_id}` - Get specific page
- `POST /api/pages` - Create new page
- `PUT /api/pages/{page_id}` - Update page
- `DELETE /api/pages/{page_id}` - Delete page (soft)
- `GET /api/pages/{page_id}/components` - Get page components

#### Components (Phase 1)
- Components are created/updated through page manager
- Component operations handled client-side with local storage
- Backend stores serialized component data

---

## MVP Component Set (9 Components)

Start with these for initial release:

1. **Text Block** - Basic writing
2. **Heading** (H1-H3) - Structure
3. **Markdown** - Power users
4. **Checklist** - Tasks
5. **Bulleted List** - Notes
6. **Numbered List** - Ordered items
7. **Toggle** - Organization
8. **Callout** - Highlights
9. **Divider** - Visual separation

---

## Implementation Timeline

### Week 1-2: Backend Foundation
- ✓ Set up FastAPI project structure
- ✓ Implement database models (User, Page, Component)
- ✓ Create authentication system (JWT)
- ✓ Build CRUD API for pages
- ✓ Add component storage endpoints

### Week 2-3: Frontend Core
- ✓ Create HTML structure (index.html, login.html)
- ✓ Build authentication UI and flow
- ✓ Implement IndexedDB storage layer
- ✓ Create base component class
- ✓ Build component registry system
- ✓ Implement page manager

### Week 3-4: Components Implementation
- ✓ Implement all 9 MVP components
- ✓ Add component rendering system
- ✓ Build component picker (slash commands)
- ✓ Implement keyboard shortcuts
- ✓ Add drag-and-drop reordering
- ✓ Component conversion system

### Week 4-5: Sync & Polish
- ✓ Implement basic sync (periodic polling)
- ✓ Add offline support with sync queue
- ✓ Create sync status indicators
- ✓ Error handling and edge cases
- ✓ Performance optimization
- ✓ CSS styling and responsive design

### Week 5-6: Testing & Deployment
- Write tests for critical paths
- Multi-browser testing
- Deploy backend (Railway, Render, DigitalOcean)
- Deploy frontend (Netlify, Vercel, Cloudflare Pages)
- Documentation and setup guides

---

## Running the Application

### Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your configuration
uvicorn app.main:app --reload --port 8000
```

### Frontend Setup

```bash
cd frontend
# Use any static file server
python -m http.server 3000
# Or: npx serve -p 3000
# Or: php -S localhost:3000
```

Visit: http://localhost:3000

---

## Post-MVP Phases

### Phase 2: Real-time Sync
- WebSocket connection
- Live updates across devices
- Conflict resolution UI

### Phase 3: Enhanced Components
- Code block with syntax highlighting
- Table component
- Quote component
- Image upload

### Phase 4: Advanced Features
- Search functionality
- Page templates
- Tags and filters
- Export to PDF/Markdown
- Properties/metadata
- Date components

### Phase 5: Collaborative Features
- Page sharing
- Comments and annotations
- Real-time collaboration
- Activity history
- Page versioning

---

## Success Metrics

- Pages load in < 1 second
- Sync latency < 3 seconds
- Support for 1000+ pages per user
- Offline mode works reliably
- Zero data loss (conflicts shown to user)
- Works on Chrome, Firefox, Safari, Edge

---

## Security Considerations

1. **Authentication**: bcrypt password hashing, JWT tokens
2. **Authorization**: Verify user owns resource before operations
3. **HTTPS**: Required for production
4. **CORS**: Properly configured for frontend origin
5. **Rate Limiting**: Prevent API abuse
6. **Input Validation**: Sanitize all user input
7. **XSS Prevention**: Sanitize markdown output
8. **SQL Injection**: Use parameterized queries (SQLAlchemy ORM)

---

## Technology Decisions Rationale

### Why FastAPI?
- Modern async support
- Automatic OpenAPI/Swagger docs
- Fast performance
- Type hints with Pydantic
- Active community

### Why Pure HTML/CSS/JS?
- No build step required
- Faster development for MVP
- Easier to understand and maintain
- Can migrate to framework later if needed
- Better performance (no virtual DOM overhead)

### Why IndexedDB?
- Large storage capacity (> localStorage)
- Structured data support
- Async operations
- Perfect for offline-first architecture

### Why SQLite for Development?
- No server setup needed
- File-based, easy backups
- Fast for single-user development
- Easy migration to PostgreSQL later

---

## Risk Mitigation

1. **Sync Conflicts**: Implement clear UI, allow manual resolution
2. **Data Loss**: Soft deletes, regular backups, version tracking
3. **Performance**: Pagination, lazy loading, debouncing
4. **Browser Compatibility**: Progressive enhancement, feature detection
5. **Scaling**: Stateless API design, horizontal scaling ready

---

## Future Considerations

- Mobile app (PWA first, then native)
- End-to-end encryption for sensitive notes
- Page sharing and collaboration
- Plugin/extension system
- API for third-party integrations
- Import from Notion, Evernote, etc.
- Advanced search with full-text indexing
- AI-powered features (summaries, suggestions)

---

## License

TBD - Consider MIT or Apache 2.0 for open source

---

## Contributing

Guidelines will be added after MVP launch.

---

**Last Updated**: 2026-01-27
**Version**: 1.0 (Comprehensive Design Document)
