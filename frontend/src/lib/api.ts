import axios from 'axios';
import { useAuthStore } from '@/store/authStore';
import { LEGACY_STORAGE_KEYS, readStorageWithLegacy, STORAGE_KEYS, writeStorageWithLegacyCleanup } from '@/lib/storageKeys';

/**
 * In `vite dev`, call the API on loopback instead of same-origin `/api`.
 * That avoids the dev server handling `/api/*` (host / fs / middleware quirks, 403 before proxy).
 * Production keeps relative `/api` (nginx / same host).
 *
 * Override: `VITE_API_BASE_URL=http://127.0.0.1:5001` (no trailing `/api`).
 */
export function getApiBaseURL(): string {
  const fromEnv = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (fromEnv != null && String(fromEnv).trim() !== '') {
    return `${String(fromEnv).trim().replace(/\/$/, '')}/api`;
  }
  if (import.meta.env.DEV) {
    const port = (import.meta.env.VITE_BACKEND_PORT as string | undefined) ?? '5001';
    const host = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : '127.0.0.1';
    const apiHost = host === 'localhost' ? '127.0.0.1' : host;
    return `http://${apiHost}:${port}/api`;
  }
  return '/api';
}

const apiBaseURL = getApiBaseURL();

/** Clone FormData so a retried request can read file parts again after the first XHR consumed them. */
function cloneFormData(fd: FormData): FormData {
  const next = new FormData();
  fd.forEach((value, key) => {
    next.append(key, value);
  });
  return next;
}

/** One in-flight refresh so parallel 401s do not stampede /auth/refresh. */
let refreshInFlight: Promise<{ accessToken: string; refreshToken: string }> | null = null;

async function refreshTokens(): Promise<{ accessToken: string; refreshToken: string }> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = readStorageWithLegacy(STORAGE_KEYS.refreshToken, LEGACY_STORAGE_KEYS.refreshToken);
    if (!refreshToken) {
      throw new Error('No refresh token');
    }
    const { data } = await axios.post(`${apiBaseURL}/auth/refresh`, { refreshToken });
    const tokens = data?.data ?? data;
    writeStorageWithLegacyCleanup(STORAGE_KEYS.accessToken, tokens.accessToken, LEGACY_STORAGE_KEYS.accessToken);
    writeStorageWithLegacyCleanup(STORAGE_KEYS.refreshToken, tokens.refreshToken, LEGACY_STORAGE_KEYS.refreshToken);
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

const api = axios.create({
  baseURL: apiBaseURL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ── Request interceptor — attach access token ──────────────
api.interceptors.request.use((config) => {
  const token = readStorageWithLegacy(STORAGE_KEYS.accessToken, LEGACY_STORAGE_KEYS.accessToken);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const requestUrl = String(config.url || '');
  if (
    requestUrl.includes('/pdf') ||
    requestUrl.includes('/print/') ||
    requestUrl.includes('/labels/bulk')
  ) {
    config.timeout = Math.max(Number(config.timeout) || 0, 120_000);
  }
  // FormData: never send Content-Type manually (missing boundary breaks multer / proxies).
  // Also clear the instance default `application/json` so the runtime sets multipart with boundary.
  if (config.data instanceof FormData) {
    const h = config.headers;
    if (h && typeof (h as { delete?: (k: string) => void }).delete === 'function') {
      (h as { delete: (k: string) => void }).delete('Content-Type');
      (h as { delete: (k: string) => void }).delete('content-type');
    } else if (h && typeof h === 'object') {
      delete (h as Record<string, unknown>)['Content-Type'];
      delete (h as Record<string, unknown>)['content-type'];
    }
  }
  return config;
});

// ── Response interceptor — handle token refresh ────────────
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // When responseType is 'blob' the server's JSON error body arrives as a Blob.
    // Parse it back to a plain object so callers can read error.response.data.error.
    if (error.response?.data instanceof Blob) {
      try {
        const text = await error.response.data.text();
        if (error.response.data.type === 'application/json' || text.trim().startsWith('{')) {
          error.response.data = JSON.parse(text);
        } else if (/502 Bad Gateway|504 Gateway Time-out/i.test(text)) {
          error.response.data = {
            error: 'The PDF service is temporarily unavailable. Please retry after the server PDF renderer restarts.',
          };
        } else if (/<html[\s>]/i.test(text)) {
          error.response.data = { error: 'The server returned an HTML error instead of a PDF.' };
        }
      } catch {
        // leave as-is if parsing fails
      }
    }

    const originalRequest = error.config;
    const reqUrl = String(originalRequest?.url ?? '');
    const isPublicAuth =
      reqUrl.includes('/auth/login') ||
      reqUrl.includes('/auth/register') ||
      reqUrl.includes('/auth/refresh');

    // If 401 with SESSION_REPLACED, kick user to login immediately — no refresh attempt
    if (error.response?.status === 401 && error.response?.data?.code === 'SESSION_REPLACED') {
      useAuthStore.getState().logout();
      // Show a friendly message via sessionStorage so LoginPage can display it
      sessionStorage.setItem('session_replaced_msg', error.response.data.error || 'You have been signed in on another device.');
      window.location.replace('/login');
      return Promise.reject(error);
    }

    // If 401 and not already retried, try refresh
    // error.response?.status works regardless of responseType — it reads the HTTP status line.
    if (error.response?.status === 401 && !originalRequest._retry && !isPublicAuth) {
      originalRequest._retry = true;

      try {
        const tokens = await refreshTokens();
        useAuthStore.getState().setTokens(tokens.accessToken, tokens.refreshToken);

        originalRequest.headers.Authorization = `Bearer ${tokens.accessToken}`;
        if (originalRequest.data instanceof FormData) {
          originalRequest.data = cloneFormData(originalRequest.data);
        }
        return api(originalRequest);
      } catch (refreshError) {
        // Clear persisted auth too — otherwise /login redirects to /dashboard in a tight loop.
        useAuthStore.getState().logout();
        window.location.replace('/login');
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
