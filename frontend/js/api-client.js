import { API_BASE_URL } from './config.js';
import { auth, defaultDeviceName } from './auth.js';
import { Emitter } from './utils.js';

export class ApiError extends Error {
    constructor(status, code, message, details = []) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export class NetworkError extends Error {
    constructor(cause) {
        super('Network unavailable');
        this.name = 'NetworkError';
        this.cause = cause;
    }
}

class ApiClient extends Emitter {
    constructor(baseUrl) {
        super();
        this.baseUrl = baseUrl;
        this.refreshing = null;
    }

    url(path, query) {
        const url = new URL(path.startsWith('http') ? path : `${this.baseUrl}${path}`);
        for (const [key, value] of Object.entries(query || {})) {
            if (value !== undefined && value !== null) url.searchParams.set(key, value);
        }
        return url.toString();
    }

    async request(method, path, { body, query, raw = false, auth: useAuth = true, retry = true, headers = {} } = {}) {
        const init = { method, headers: { ...headers } };
        if (body !== undefined) {
            if (body instanceof Blob || body instanceof ArrayBuffer) {
                init.body = body;
            } else {
                init.headers['Content-Type'] = 'application/json';
                init.body = JSON.stringify(body);
            }
        }
        if (useAuth && auth.accessToken) init.headers.Authorization = `Bearer ${auth.accessToken}`;

        let response;
        try {
            response = await fetch(this.url(path, query), init);
        } catch (error) {
            throw new NetworkError(error);
        }

        if (response.status === 401 && useAuth && retry && auth.refreshToken) {
            if (await this.refresh()) {
                return this.request(method, path, { body, query, raw, auth: useAuth, retry: false, headers });
            }
        }
        if (!response.ok) {
            let payload = {};
            try {
                payload = await response.json();
            } catch {
                // Non-JSON error body (e.g. proxy error page).
            }
            const error = payload.error || {};
            if (response.status === 401 && useAuth) this.emit('unauthorized');
            throw new ApiError(
                response.status,
                error.code || 'SERVER_ERROR',
                error.message || response.statusText,
                error.details || [],
            );
        }
        if (raw) return response;
        if (response.status === 204) return null;
        const type = response.headers.get('content-type') || '';
        return type.includes('application/json') ? response.json() : response.text();
    }

    /** Rotate tokens once even if many requests hit 401 at the same time. */
    refresh() {
        if (!this.refreshing) {
            this.refreshing = (async () => {
                try {
                    const tokens = await this.request('POST', '/api/auth/refresh', {
                        body: { refresh_token: auth.refreshToken, device_id: auth.deviceId },
                        auth: false,
                    });
                    auth.saveSession(tokens);
                    this.emit('tokens', tokens);
                    return true;
                } catch (error) {
                    if (error instanceof ApiError) {
                        auth.clear();
                        this.emit('unauthorized');
                    }
                    return false;
                } finally {
                    this.refreshing = null;
                }
            })();
        }
        return this.refreshing;
    }

    get(path, query) {
        return this.request('GET', path, { query });
    }

    post(path, body, query) {
        return this.request('POST', path, { body: body ?? {}, query });
    }

    put(path, body) {
        return this.request('PUT', path, { body });
    }

    delete(path, query) {
        return this.request('DELETE', path, { query });
    }

    // --- Auth ---------------------------------------------------------------------------

    async login(email, password) {
        const result = await this.request('POST', '/api/auth/login', {
            body: { email, password, device_id: auth.deviceId || undefined, device_name: defaultDeviceName() },
            auth: false,
        });
        auth.saveSession(result);
        return result;
    }

    async register(email, password) {
        const result = await this.request('POST', '/api/auth/register', {
            body: { email, password, device_id: auth.deviceId || undefined, device_name: defaultDeviceName() },
            auth: false,
        });
        auth.saveSession(result);
        return result;
    }

    async logout() {
        try {
            await this.post('/api/auth/logout');
        } finally {
            auth.clear();
        }
    }

    requestPasswordReset(email) {
        return this.request('POST', '/api/auth/request-password-reset', { body: { email }, auth: false });
    }

    resetPassword(token, newPassword) {
        return this.request('POST', '/api/auth/reset-password', {
            body: { token, new_password: newPassword },
            auth: false,
        });
    }

    verifyEmail(token) {
        return this.request('POST', '/api/auth/verify-email', { body: { token }, auth: false });
    }

    // --- Media --------------------------------------------------------------------------

    async uploadFile(file, checksum) {
        const ticket = await this.post('/api/media/upload-url', {
            mime_type: file.type || 'application/octet-stream',
            file_size: file.size,
            filename: file.name,
            checksum: checksum ? `sha256:${checksum}` : undefined,
        });
        await this.request('PUT', ticket.upload_url, {
            body: file,
            auth: false,
            headers: ticket.headers,
        });
        return ticket.asset_id;
    }

    async fetchMedia(assetId) {
        const response = await this.request('GET', `/api/media/${assetId}`, { raw: true });
        return response.blob();
    }
}

export const api = new ApiClient(API_BASE_URL);
