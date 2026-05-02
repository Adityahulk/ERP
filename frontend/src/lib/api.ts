import axios from 'axios';
import { useAuthStore } from '@/store/authStore';

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
    return `http://127.0.0.1:${port}/api`;
  }
  return '/api';
}

const apiBaseURL = getApiBaseURL();

/** One in-flight refresh so parallel 401s do not stampede /auth/refresh. */
let refreshInFlight: Promise<{ accessToken: string; refreshToken: string }> | null = null;

async function refreshTokens(): Promise<{ accessToken: string; refreshToken: string }> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = localStorage.getItem('bizflow_refresh_token');
    if (!refreshToken) {
      throw new Error('No refresh token');
    }
    const { data } = await axios.post(`${apiBaseURL}/auth/refresh`, { refreshToken });
    const tokens = data?.data ?? data;
    localStorage.setItem('bizflow_access_token', tokens.accessToken);
    localStorage.setItem('bizflow_refresh_token', tokens.refreshToken);
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

const api = axios.create({
  baseURL: apiBaseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ── Request interceptor — attach access token ──────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('bizflow_access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor — handle token refresh ────────────
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // When responseType is 'blob' the server's JSON error body arrives as a Blob.
    // Parse it back to a plain object so callers can read error.response.data.error.
    if (error.response?.data instanceof Blob && error.response.data.type === 'application/json') {
      try {
        const text = await error.response.data.text();
        error.response.data = JSON.parse(text);
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
