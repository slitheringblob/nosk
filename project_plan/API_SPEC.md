# nosk API Specification

**Version**: 1.0
**Base URL**: `http://localhost:8000` (development)
**API Prefix**: `/api`
**Authentication**: JWT Bearer Token

---

## Table of Contents

1. [Authentication](#authentication)
2. [Pages](#pages)
3. [Components](#components)
4. [Sync](#sync)
5. [Error Responses](#error-responses)
6. [Status Codes](#status-codes)

---

## Authentication

### Register User

Create a new user account.

**Endpoint**: `POST /api/auth/register`

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Validation**:
- `email`: Valid email format, unique, max 255 characters
- `password`: Minimum 8 characters, max 100 characters

**Response** (201 Created):
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "def50200b1...",
  "token_type": "bearer",
  "expires_in": 900,
  "refresh_expires_in": 1209600,
  "device_id": "device-abc123",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "created_at": 1706284800000,
    "is_verified": false
  }
}
```

**Error Responses**:
- `400 Bad Request`: Email already registered
- `422 Unprocessable Entity`: Validation errors

---

### Login

Authenticate existing user and establish a device session.

**Endpoint**: `POST /api/auth/login`

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "device_name": "MacBook Pro"
}
```

**Notes**:
- Returns short-lived access tokens (15 minutes) plus rotating refresh tokens (14 days).
- `device_id` identifies the session for future revocation or logout.

**Response** (200 OK):
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "def50200b1...",
  "token_type": "bearer",
  "expires_in": 900,
  "refresh_expires_in": 1209600,
  "device_id": "device-xyz789",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "created_at": 1706284800000,
    "is_verified": true
  }
}
```

**Error Responses**:
- `401 Unauthorized`: Invalid credentials

---

### Logout

Logout user and revoke the active refresh token/device session.

**Endpoint**: `POST /api/auth/logout`

**Headers**:
```
Authorization: Bearer <token>
```

**Response** (200 OK):
```json
{
  "message": "Logged out successfully",
  "device_id": "device-xyz789"
}
```

---

### Verify Token

Verify if token is valid.

**Endpoint**: `GET /api/auth/verify`

**Headers**:
```
Authorization: Bearer <token>
```

**Response** (200 OK):
```json
{
  "valid": true,
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com"
}
```

**Error Responses**:
- `401 Unauthorized`: Invalid or expired token

---

### Refresh Token

Rotate refresh token and obtain a new access token without re-authenticating.

**Endpoint**: `POST /api/auth/refresh`

**Request Body**:
```json
{
  "refresh_token": "def50200b1...",
  "device_id": "device-xyz789"
}
```

**Response** (200 OK):
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "def50200c2...",
  "token_type": "bearer",
  "expires_in": 900,
  "refresh_expires_in": 1209600
}
```

**Error Responses**:
- `401 Unauthorized`: Invalid/expired refresh token or revoked device session

---

### Request Verification Email

Resend verification link if a user has not confirmed their email.

**Endpoint**: `POST /api/auth/request-verification`

**Request Body**:
```json
{
  "email": "user@example.com"
}
```

**Response** (200 OK):
```json
{
  "message": "Verification email sent"
}
```

---

### Verify Email

Confirm ownership of an email address.

**Endpoint**: `POST /api/auth/verify-email`

**Request Body**:
```json
{
  "token": "verify-token"
}
```

**Response** (200 OK):
```json
{
  "message": "Email verified",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "is_verified": true
  }
}
```

**Error Responses**:
- `400 Bad Request`: Token expired or already used

---

### Request Password Reset

Initiate password reset flow by sending a reset link/code.

**Endpoint**: `POST /api/auth/request-password-reset`

**Request Body**:
```json
{
  "email": "user@example.com"
}
```

**Response** (200 OK):
```json
{
  "message": "Password reset email sent"
}
```

---

### Reset Password

Complete password reset using a token delivered out-of-band.

**Endpoint**: `POST /api/auth/reset-password`

**Request Body**:
```json
{
  "token": "reset-token",
  "new_password": "StrongPassword!23"
}
```

**Response** (200 OK):
```json
{
  "message": "Password updated",
  "sessions_revoked": true
}
```

**Error Responses**:
- `400 Bad Request`: Token invalid/expired
- `422 Unprocessable Entity`: Password policy violation

---

### List Active Sessions

Return all device sessions / refresh tokens for the authenticated user.

**Endpoint**: `GET /api/auth/sessions`

**Headers**:
```
Authorization: Bearer <token>
```

**Response** (200 OK):
```json
{
  "sessions": [
    {
      "session_id": "sess-123",
      "device_id": "device-xyz789",
      "device_name": "MacBook Pro",
      "issued_at": 1706284800000,
      "expires_at": 1707494400000,
      "last_used_at": 1706371200000,
      "ip_address": "203.0.113.10"
    }
  ]
}
```

---

### Revoke Session

Invalidate a specific device session (refresh token).

**Endpoint**: `DELETE /api/auth/sessions/{session_id}`

**Headers**:
```
Authorization: Bearer <token>
```

**Response** (200 OK):
```json
{
  "message": "Session revoked",
  "session_id": "sess-123"
}
```

**Error Responses**:
- `404 Not Found`: Session ID not found for user

---

## Pages

All page endpoints require authentication.

### List All Pages

Get all pages for authenticated user.

**Endpoint**: `GET /api/pages`

**Headers**:
```
Authorization: Bearer <token>
```

**Query Parameters**:
- `deleted` (optional): `true` | `false` - Include deleted pages (default: `false`)
- `limit` (optional): Number of pages to return (default: 100, max: 500)
- `offset` (optional): Pagination offset (default: 0)
- `sort` (optional): `created_at` | `updated_at` | `title` (default: `updated_at`)
- `order` (optional): `asc` | `desc` (default: `desc`)

**Response** (200 OK):
```json
{
  "pages": [
    {
      "id": "page-550e8400-e29b-41d4-a716-446655440000",
      "user_id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Project Planning",
      "component_ids": ["comp-1", "comp-2"],
      "created_at": 1706284800000,
      "updated_at": 1706284950000,
      "version": 5,
      "deleted": false,
      "icon": "📋",
      "color": null
    }
  ],
  "total": 1,
  "limit": 100,
  "offset": 0
}
```

---

### Get Page by ID

Get specific page with metadata.

**Endpoint**: `GET /api/pages/{page_id}`

**Headers**:
```
Authorization: Bearer <token>
```

**Response** (200 OK):
```json
{
  "id": "page-550e8400-e29b-41d4-a716-446655440000",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Project Planning",
  "component_ids": ["comp-1", "comp-2", "comp-3"],
  "created_at": 1706284800000,
  "updated_at": 1706284950000,
  "version": 5,
  "deleted": false,
  "icon": "📋",
  "color": "#FF5733"
}
```

**Error Responses**:
- `404 Not Found`: Page does not exist
- `403 Forbidden`: User does not own this page

---

### Create Page

Create a new page.

**Endpoint**: `POST /api/pages`

**Headers**:
```
Authorization: Bearer <token>
```

**Request Body**:
```json
{
  "title": "My New Page",
  "icon": "📝",
  "color": "#3498db"
}
```

**Validation**:
- `title`: Required, max 200 characters
- `icon`: Optional, max 10 characters (emoji)
- `color`: Optional, valid hex color or null

**Response** (201 Created):
```json
{
  "id": "page-660e8400-e29b-41d4-a716-446655440001",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "My New Page",
  "component_ids": [],
  "created_at": 1706285000000,
  "updated_at": 1706285000000,
  "version": 0,
  "deleted": false,
  "icon": "📝",
  "color": "#3498db"
}
```

---

### Update Page

Update page metadata.

**Endpoint**: `PUT /api/pages/{page_id}`

**Headers**:
```
Authorization: Bearer <token>
```

**Request Body**:
```json
{
  "title": "Updated Title",
  "icon": "🚀",
  "color": "#e74c3c"
}
```

**Notes**:
- All fields are optional
- Only provided fields will be updated
- `component_ids` cannot be updated via this endpoint (use component operations)

**Response** (200 OK):
```json
{
  "id": "page-550e8400-e29b-41d4-a716-446655440000",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Updated Title",
  "component_ids": ["comp-1", "comp-2"],
  "created_at": 1706284800000,
  "updated_at": 1706285100000,
  "version": 6,
  "deleted": false,
  "icon": "🚀",
  "color": "#e74c3c"
}
```

**Error Responses**:
- `404 Not Found`: Page does not exist
- `403 Forbidden`: User does not own this page
- `422 Unprocessable Entity`: Validation errors

---

### Delete Page

Soft delete a page.

**Endpoint**: `DELETE /api/pages/{page_id}`

**Headers**:
```
Authorization: Bearer <token>
```

**Query Parameters**:
- `permanent` (optional): `true` - Permanently delete (cannot be undone)

**Response** (200 OK):
```json
{
  "message": "Page deleted successfully",
  "page_id": "page-550e8400-e29b-41d4-a716-446655440000"
}
```

**Error Responses**:
- `404 Not Found`: Page does not exist
- `403 Forbidden`: User does not own this page

---

### Restore Deleted Page

Restore a soft-deleted page.

**Endpoint**: `POST /api/pages/{page_id}/restore`

**Headers**:
```
Authorization: Bearer <token>
```

**Response** (200 OK):
```json
{
  "message": "Page restored successfully",
  "page": {
    "id": "page-550e8400-e29b-41d4-a716-446655440000",
    "title": "Restored Page",
    "deleted": false
  }
}
```

---

## Components

### Get Page Components

Get all components for a specific page.

**Endpoint**: `GET /api/pages/{page_id}/components`

**Headers**:
```
Authorization: Bearer <token>
```

**Response** (200 OK):
```json
{
  "components": [
    {
      "id": "comp-1",
      "page_id": "page-550e8400-e29b-41d4-a716-446655440000",
      "type": "text-block",
      "content": {
        "text": "This is a <strong>text block</strong>",
        "format": "html"
      },
      "created_at": 1706284800000,
      "updated_at": 1706284850000,
      "order": 0,
      "schema_version": 1
    },
    {
      "id": "comp-2",
      "page_id": "page-550e8400-e29b-41d4-a716-446655440000",
      "type": "heading",
      "content": {
        "text": "Section Title",
        "level": 2
      },
      "created_at": 1706284800000,
      "updated_at": 1706284800000,
      "order": 1,
      "schema_version": 1
    }
  ],
  "total": 2,
  "page_id": "page-550e8400-e29b-41d4-a716-446655440000"
}
```

**Error Responses**:
- `404 Not Found`: Page does not exist
- `403 Forbidden`: User does not own this page

---

### Create Component

Add a new component to a page.

**Endpoint**: `POST /api/pages/{page_id}/components`

**Headers**:
```
Authorization: Bearer <token>
```

**Request Body**:
```json
{
  "type": "checklist",
  "content": {
    "items": [
      {
        "id": "item-1",
        "text": "Complete task",
        "checked": false,
        "indent_level": 0
      }
    ]
  },
  "order": 2
}
```

**Validation**:
- `type`: Required, must be valid component type
- `content`: Required, must match component schema
- `order`: Optional, defaults to last position

**Response** (201 Created):
```json
{
  "id": "comp-3",
  "page_id": "page-550e8400-e29b-41d4-a716-446655440000",
  "type": "checklist",
  "content": {
    "items": [
      {
        "id": "item-1",
        "text": "Complete task",
        "checked": false,
        "indent_level": 0
      }
    ]
  },
  "created_at": 1706285200000,
  "updated_at": 1706285200000,
  "order": 2,
  "schema_version": 1,
  "page_version": 7
}
```

---

### Update Component

Update component content.

**Endpoint**: `PUT /api/components/{component_id}`

**Headers**:
```
Authorization: Bearer <token>
```

**Request Body**:
```json
{
  "content": {
    "items": [
      {
        "id": "item-1",
        "text": "Complete task",
        "checked": true,
        "indent_level": 0
      }
    ]
  }
}
```

**Notes**:
- Only `content` can be updated
- `type` cannot be changed (use conversion endpoint)
- Updates `updated_at` timestamp and page version

**Response** (200 OK):
```json
{
  "id": "comp-3",
  "page_id": "page-550e8400-e29b-41d4-a716-446655440000",
  "type": "checklist",
  "content": {
    "items": [
      {
        "id": "item-1",
        "text": "Complete task",
        "checked": true,
        "indent_level": 0
      }
    ]
  },
  "created_at": 1706285200000,
  "updated_at": 1706285300000,
  "order": 2,
  "schema_version": 1,
  "page_version": 8
}
```

**Error Responses**:
- `404 Not Found`: Component does not exist
- `403 Forbidden`: User does not own this component
- `422 Unprocessable Entity`: Invalid content for component type

---

### Delete Component

Remove a component from a page.

**Endpoint**: `DELETE /api/components/{component_id}`

**Headers**:
```
Authorization: Bearer <token>
```

**Response** (200 OK):
```json
{
  "message": "Component deleted successfully",
  "component_id": "comp-3"
}
```

**Error Responses**:
- `404 Not Found`: Component does not exist
- `403 Forbidden`: User does not own this component

---

### Reorder Components

Update the order of components on a page.

**Endpoint**: `PUT /api/pages/{page_id}/reorder`

**Headers**:
```
Authorization: Bearer <token>
```

**Request Body**:
```json
{
  "component_ids": ["comp-2", "comp-1", "comp-3"]
}
```

**Notes**:
- Array must contain all component IDs from the page
- Order in array determines new order (0-indexed)

**Response** (200 OK):
```json
{
  "message": "Components reordered successfully",
  "page_id": "page-550e8400-e29b-41d4-a716-446655440000",
  "component_ids": ["comp-2", "comp-1", "comp-3"]
}
```

**Error Responses**:
- `400 Bad Request`: Missing or extra component IDs
- `404 Not Found`: Page does not exist
- `403 Forbidden`: User does not own this page

---

### Convert Component

Convert a component from one type to another.

**Endpoint**: `POST /api/components/{component_id}/convert`

**Headers**:
```
Authorization: Bearer <token>
```

**Request Body**:
```json
{
  "to_type": "bullet-list"
}
```

**Notes**:
- Conversion must be supported (see conversion matrix)
- Content is automatically transformed

**Response** (200 OK):
```json
{
  "id": "comp-3",
  "page_id": "page-550e8400-e29b-41d4-a716-446655440000",
  "type": "bullet-list",
  "content": {
    "items": [
      {
        "id": "item-1",
        "text": "Complete task",
        "indent_level": 0
      }
    ]
  },
  "created_at": 1706285200000,
  "updated_at": 1706285400000,
  "order": 2,
  "schema_version": 1,
  "page_version": 9
}
```

**Error Responses**:
- `400 Bad Request`: Conversion not supported
- `404 Not Found`: Component does not exist
- `403 Forbidden`: User does not own this component

---

## Media (Phase 3)

### Request Upload URL

Obtain a pre-signed URL for uploading media assets (e.g., images) directly to object storage.

**Endpoint**: `POST /api/media/upload-url`

**Headers**:
```
Authorization: Bearer <token>
```

**Request Body**:
```json
{
  "mime_type": "image/png",
  "file_size": 345678,
  "checksum": "sha256:..."
}
```

**Response** (200 OK):
```json
{
  "upload_url": "https://storage.example.com/...",
  "asset_id": "asset-123",
  "expires_at": 1706285600000,
  "headers": {
    "Content-Type": "image/png"
  }
}
```

**Notes**:
- Upload URLs expire after 5 minutes and are single-use.
- After upload, call `POST /api/pages/{page_id}/components` with component `content` that references
  `asset_id` plus width/height metadata.

---

## Sync

### Pull Changes

Get all changes since a given timestamp.

**Endpoint**: `GET /api/sync/pull`

**Headers**:
```
Authorization: Bearer <token>
```

**Query Parameters**:
- `since`: Unix timestamp in milliseconds (required)

**Response** (200 OK):
```json
{
  "changes": [
    {
      "operation_id": "op-001",
      "type": "page_updated",
      "page_id": "page-550e8400-e29b-41d4-a716-446655440000",
      "page_version": 6,
      "timestamp": 1706285100000,
      "device_id": "device-abc123",
      "data": {
        "title": "Updated Title"
      }
    },
    {
      "operation_id": "op-002",
      "type": "component_created",
      "component_id": "comp-3",
      "page_id": "page-550e8400-e29b-41d4-a716-446655440000",
      "page_version": 7,
      "timestamp": 1706285200000,
      "device_id": "device-abc123",
      "data": {
        "type": "checklist",
        "content": { "items": [] },
        "order": 2
      }
    },
    {
      "operation_id": "op-003",
      "type": "component_updated",
      "component_id": "comp-1",
      "page_id": "page-550e8400-e29b-41d4-a716-446655440000",
      "page_version": 8,
      "timestamp": 1706285300000,
      "device_id": "device-xyz789",
      "data": {
        "content": { "text": "Updated text" }
      }
    }
  ],
  "last_sync": 1706285300000,
  "has_more": false
}
```

**Change Types**:
- `page_created`
- `page_updated`
- `page_deleted`
- `component_created`
- `component_updated`
- `component_deleted`
- `components_reordered`

Each change record includes `operation_id`, `page_version`, `timestamp`, and `device_id` to support
idempotency and activity history.

---

### Push Changes

Send local changes to server.

**Endpoint**: `POST /api/sync/push`

**Headers**:
```
Authorization: Bearer <token>
```

**Request Body**:
```json
{
  "operations": [
    {
      "operation_id": "op-010",
      "type": "update_component",
      "component_id": "comp-1",
      "page_id": "page-550e8400-e29b-41d4-a716-446655440000",
      "page_version": 8,
      "device_id": "device-xyz789",
      "timestamp": 1706285350000,
      "data": {
        "content": {
          "text": "Local update"
        }
      }
    }
  ],
  "client_timestamp": 1706285350000
}
```

**Notes**:
- `page_version` must reflect the client's last known version for that page; mismatches trigger
  conflicts.
- `operation_id` guarantees idempotency—duplicate submissions are ignored safely.

**Response** (200 OK):
```json
{
  "message": "Changes synced successfully",
  "synced": 1,
  "conflicts": [],
  "page_versions": {
    "page-550e8400-e29b-41d4-a716-446655440000": 9
  },
  "server_timestamp": 1706285350000
}
```

**With Conflicts** (200 OK):
```json
{
  "message": "Changes synced with conflicts",
  "synced": 0,
  "conflicts": [
    {
      "operation_index": 0,
      "page_id": "page-550e8400-e29b-41d4-a716-446655440000",
      "reason": "version_mismatch",
      "local_version": 8,
      "server_version": 9,
      "resolution": "manual"
    }
  ],
  "server_timestamp": 1706285350000
}
```

---

### Get Sync Status

Get sync status for current user.

**Endpoint**: `GET /api/sync/status`

**Headers**:
```
Authorization: Bearer <token>
```

**Response** (200 OK):
```json
{
  "last_sync": 1706285300000,
  "pending_changes": 0,
  "sync_enabled": true,
  "device_id": "device-abc123"
}
```

---

## Error Responses

### Standard Error Format

All error responses follow this format:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": [
      {
        "field": "email",
        "message": "Email is already registered"
      }
    ]
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `VALIDATION_ERROR` | Request data validation failed |
| `AUTHENTICATION_ERROR` | Invalid or missing authentication |
| `AUTHORIZATION_ERROR` | User not authorized for this resource |
| `NOT_FOUND` | Resource not found |
| `CONFLICT` | Resource conflict (e.g., duplicate email) |
| `RATE_LIMIT_EXCEEDED` | Too many requests |
| `SERVER_ERROR` | Internal server error |
| `SYNC_CONFLICT` | Sync version conflict |

---

## Status Codes

| Status | Description | Usage |
|--------|-------------|-------|
| 200 | OK | Successful GET, PUT, DELETE |
| 201 | Created | Successful POST (resource created) |
| 400 | Bad Request | Invalid request format or parameters |
| 401 | Unauthorized | Missing or invalid authentication |
| 403 | Forbidden | User doesn't have permission |
| 404 | Not Found | Resource doesn't exist |
| 422 | Unprocessable Entity | Validation errors |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error |

---

## Rate Limiting

API requests are rate-limited per user:

- **Anonymous**: 100 requests per hour
- **Authenticated**: 1000 requests per hour

Rate limit headers:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1706288400
```

---

## Pagination

List endpoints support pagination:

**Query Parameters**:
- `limit`: Items per page (default: 100, max: 500)
- `offset`: Skip N items (default: 0)

**Response includes**:
```json
{
  "items": [...],
  "total": 150,
  "limit": 100,
  "offset": 0
}
```

---

## Versioning

API version is included in the URL:
- Current: `/api/v1/...` (implied, not required)
- Future: `/api/v2/...`

For backward compatibility, no version prefix defaults to v1.

---

## WebSocket (Future)

Real-time sync via WebSocket:

**Endpoint**: `ws://localhost:8000/api/sync/live`

**Authentication**: Send JWT token in first message
```json
{
  "type": "auth",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Server sends updates**:
```json
{
  "type": "component_updated",
  "component_id": "comp-1",
  "page_id": "page-123",
  "data": { "content": { "text": "New text" } }
}
```

---

## API Client Examples

### JavaScript (Fetch API)

```javascript
// Login
const response = await fetch('http://localhost:8000/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'user@example.com', password: 'pass123' })
});
const { access_token } = await response.json();

// Get pages
const pagesResponse = await fetch('http://localhost:8000/api/pages', {
  headers: { 'Authorization': `Bearer ${access_token}` }
});
const { pages } = await pagesResponse.json();
```

### Python (requests)

```python
import requests

# Login
response = requests.post('http://localhost:8000/api/auth/login', json={
    'email': 'user@example.com',
    'password': 'pass123'
})
token = response.json()['access_token']

# Get pages
headers = {'Authorization': f'Bearer {token}'}
pages = requests.get('http://localhost:8000/api/pages', headers=headers).json()
```

---

## Testing

Use the interactive API documentation:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

---

**Last Updated**: 2026-01-27
**Version**: 1.0

---

## v2 — Implemented API (supersedes conflicting details above)

Interactive docs: `http://localhost:8000/docs`. Every error uses the envelope in
[Error Responses](#error-responses). Pages you can't access return **404** (not 403).

### Auth additions

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/auth/me` | Current user |
| `POST` | `/api/auth/change-password` | `{current_password, new_password}`; signs out other devices |
| `POST` | `/api/auth/register`, `/login` | Accept optional `device_id` (reuse this browser's session) and `device_name` |

Access tokens carry `sid` (session) and `did` (device). Logging out or revoking a session
invalidates its access token immediately.

### Pages

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/pages` | Extra filters: `scope=all|owned|shared`, `tag`, `is_template` |
| `POST` | `/api/pages` | Optional client `id` (UUID), `tags`, `is_template` |
| `POST` | `/api/pages/{id}/duplicate` | `{title?, as_template?}` |
| `GET` | `/api/templates` | Built-in + your templates |
| `POST` | `/api/pages/from-template` | `{template_id, title?}` |
| `POST` | `/api/pages/import` | `{format: markdown|json, content, title?}` |
| `GET` | `/api/pages/{id}/export?format=markdown|json` | Markdown download or nosk JSON |
| `GET` | `/api/tags` | `[{tag, count}]` across accessible pages |
| `GET/POST` | `/api/pages/{id}/shares` | `POST {email, role: viewer|editor}` (owner only) |
| `DELETE` | `/api/pages/{id}/shares/{user_id}` | Owner removes anyone; a collaborator can remove themselves |
| `GET/POST` | `/api/pages/{id}/versions` | List / save a named snapshot |
| `GET` | `/api/pages/{id}/versions/{vid}` | Snapshot contents |
| `POST` | `/api/pages/{id}/versions/{vid}/restore` | Replaces page content (current state is snapshotted first) |
| `GET` | `/api/pages/{id}/activity?limit&before` | Change history with actor emails |
| `GET` | `/api/pages/{id}/backlinks` | Pages with `page-link` blocks pointing here |
| `GET/POST` | `/api/pages/{id}/comments` | `POST {body, component_id?}` — viewers may comment |
| `PUT/DELETE` | `/api/comments/{id}` | Author edits; editors resolve; author/owner delete |

Page objects also include `tags`, `is_template`, `role` (`owner|editor|viewer`) and
`owner_email` (for shared pages).

### Components

Components have `parent_id` (container block or `null`) and `slot` (column index; 0 for toggles).
`POST /api/pages/{id}/components` accepts `id?`, `parent_id`, `slot`, `after_id` (or `order`).

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/components/{id}` | |
| `POST` | `/api/components/{id}/move` | `{parent_id, slot, after_id}`; moves the whole subtree |
| `DELETE` | `/api/components/{id}` | Deletes nested children too; response lists `deleted_ids` |

**26 component types**: `text-block, heading, markdown, checklist, bullet-list, numbered-list,
toggle, callout, divider, quote, code, table, image, bookmark, embed, file, properties, date,
tags, columns, template, math, comment, page-link, canvas, database`. Content schemas live in
`backend/app/schemas/component_content.py` (unknown fields are rejected; rich text is sanitized).

**Conversions** work between any of: `text-block, heading, quote, callout, toggle, code,
markdown, checklist, bullet-list, numbered-list`.

### Sync

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/sync/bootstrap` | All accessible pages + components + `cursor` for a fresh device |
| `GET` | `/api/sync/pull?cursor=N&limit=500` | Changes after `cursor` (`since=<ms>` still accepted) → `{changes, cursor, last_sync, has_more}` |
| `POST` | `/api/sync/push` | Idempotent ops (see below) |
| `GET` | `/api/sync/status?cursor=N` | `pending_changes` from other devices |
| `WS` | `/api/sync/live` | Push notifications + presence |

**Push operation types**: `create_page, update_page, delete_page {permanent?}, restore_page,
create_component, update_component, move_component, delete_component, reorder_components,
convert_component {to_type, content?}`. Each op: `{operation_id, type, page_id, component_id?,
page_version, data, force?}`.

`page_version` is the last server version the client saw **for that entity**. An op conflicts
only if another device changed the same entity since then (`reason: version_mismatch`), or the
entity was deleted (`entity_deleted`); both have `resolution: manual` and include
`server_data`. Re-send with `force: true` to keep yours. Invalid or unauthorised ops are
`resolution: rejected` (`invalid` / `forbidden`) and don't block the rest of the batch.

**Change types** in pulls: `page_created, page_updated, page_deleted {permanent},
page_restored, page_replaced {page, components}, page_shared, page_unshared,
component_created, component_updated, component_moved, component_deleted,
components_reordered, comment_created, comment_updated, comment_deleted`. Each carries the full
entity state after the change (`data.component`, page fields, `component_ids`), plus `seq`,
`device_id` and `user_id`.

**WebSocket protocol**: first message `{"type":"auth","token":"<access token>"}` (closes with
4401 if invalid). Server sends `{"type":"ready"}`, `{"type":"changes"}` (pull now) and
`{"type":"presence","page_id","viewers":[{user_id,email,device_id}]}`. Client sends
`{"type":"presence","page_id"}` and `{"type":"ping"}`. Client messages over 20/s are dropped.

### Media & link previews

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api/media/upload-url` | `{mime_type, file_size, checksum?: "sha256:<hex>", filename?}` → `{upload_url, asset_id, expires_at}` |
| `PUT` | `upload_url` | Raw bytes; single-use, 5-minute token, size/checksum verified |
| `GET` | `/api/media/{asset_id}` | Owner, or anyone who can see a page using the asset. Non-image types download as attachments. |
| `POST` | `/api/unfurl` | `{url}` → Open Graph `{title, description, image_url, site_name}`; private/reserved IPs are refused |

### Search

`GET /api/search?q=&limit=` → `{results: [{page_id, title, icon, component_id, snippet, match}]}`
across titles and block text of all accessible pages.

### Rate limiting

Per-minute windows: 600 requests/min per user, 60/min per IP for anonymous requests
(`RATE_LIMIT_*` settings). Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
`X-RateLimit-Reset`, and `Retry-After` on 429.

### Daily journal & settings (v2.1)

- Pages accept and return `journal_date` (`YYYY-MM-DD`, user's local calendar; set at creation,
  never changed). At most one journal page per user per day. Creating a second page for a day that
  already has one keeps the new page as a normal page (its `journal_date` is `null`) instead of
  rejecting it, so nothing written offline is lost.
- Clients derive a day's page id from the user, a per-user secret salt and the date, and the
  template blocks' ids from the page id. When two devices create the same day, the second
  `create_page` / `create_component` is treated as already applied. Concurrent creates that race
  on a unique constraint are retried once server-side.
- `GET /api/auth/settings` → `{journal_template_id, journal_salt}` (the salt is generated on first
  read and only ever returned to its owner). `PUT /api/auth/settings {journal_template_id}` accepts
  a built-in template id, one of your own templates, or `null` for blank days.
- `GET /api/templates/{id}` → `{id, title, icon, builtin, blocks}`: a template's blocks, so
  clients can build journal pages offline.
- `POST /api/sync/push` also returns `op_versions: {operation_id: page_version}`, the version
  each applied op produced. Clients use it to ignore older snapshots of entities they changed.
- Pages also carry `template_id`: the template they were made from (a built-in id such as
  `builtin-daily-journal`, or a template page's id). Set by `POST /api/pages/from-template`,
  journal creation (`create_page` accepts it) and kept by duplicates; `null` for pages started
  from scratch. Pages made from one of your templates take the template's title. Clients group
  pages under their template in the navigation.
- `GET /api/sync/bootstrap` and `GET /api/sync/pull` return `data_epoch`. It changes when a
  migration rewrites existing rows (which produces no sync ops); a device whose stored epoch
  differs re-downloads all pages and blocks, keeping anything it hasn't pushed yet.
