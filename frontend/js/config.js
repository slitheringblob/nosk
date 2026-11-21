// Runtime configuration. Override by defining window.NOSK_CONFIG before the app scripts load.
const overrides = (typeof window !== 'undefined' && window.NOSK_CONFIG) || {};

function defaultApiBase() {
    if (typeof window === 'undefined') return 'http://localhost:8000';
    const { protocol, hostname } = window.location;
    return `${protocol === 'https:' ? 'https:' : 'http:'}//${hostname || 'localhost'}:8000`;
}

export const API_BASE_URL = overrides.apiBaseUrl || defaultApiBase();
export const WS_BASE_URL = overrides.wsBaseUrl || API_BASE_URL.replace(/^http/, 'ws');

export const SYNC_PUSH_DELAY_MS = 800;
export const SYNC_POLL_INTERVAL_MS = 30_000;
export const SAVE_DEBOUNCE_MS = 400;
export const MAX_PUSH_BATCH = 100;
