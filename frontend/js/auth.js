// Token and identity persistence. The device id outlives logouts so logging back in on the same
// browser reuses its device session instead of piling up new ones.

const KEYS = {
    access: 'nosk.accessToken',
    refresh: 'nosk.refreshToken',
    device: 'nosk.deviceId',
    user: 'nosk.user',
};

function read(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function write(key, value) {
    try {
        if (value === null || value === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {
        // Storage can be unavailable (private mode quotas); the session then lasts one page load.
    }
}

export const auth = {
    get accessToken() {
        return read(KEYS.access);
    },
    get refreshToken() {
        return read(KEYS.refresh);
    },
    get deviceId() {
        return read(KEYS.device);
    },
    get user() {
        try {
            return JSON.parse(read(KEYS.user) || 'null');
        } catch {
            return null;
        }
    },
    isLoggedIn() {
        return Boolean(read(KEYS.access) && read(KEYS.refresh));
    },
    saveSession(response) {
        write(KEYS.access, response.access_token);
        write(KEYS.refresh, response.refresh_token);
        if (response.device_id) write(KEYS.device, response.device_id);
        if (response.user) write(KEYS.user, JSON.stringify(response.user));
    },
    updateUser(user) {
        write(KEYS.user, JSON.stringify(user));
    },
    clear() {
        write(KEYS.access, null);
        write(KEYS.refresh, null);
        write(KEYS.user, null);
    },
};

export function defaultDeviceName() {
    const ua = globalThis.navigator?.userAgent || '';
    const browser = /Edg\//.test(ua)
        ? 'Edge'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Firefox\//.test(ua)
            ? 'Firefox'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'Browser';
    const os = /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Android/.test(ua)
            ? 'Android'
            : /iPhone|iPad/.test(ua)
              ? 'iOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : 'Unknown OS';
    return `${browser} on ${os}`;
}
