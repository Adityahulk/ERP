import axios from 'axios';

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
    const originalRequest = error.config;

    // If 401 and not already retried, try refresh
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem('bizflow_refresh_token');
        if (!refreshToken) {
          throw new Error('No refresh token');
        }

        const { data } = await axios.post(`${apiBaseURL}/auth/refresh`, {
          refreshToken,
        });

        const tokens = data?.data ?? data;
        localStorage.setItem('bizflow_access_token', tokens.accessToken);
        localStorage.setItem('bizflow_refresh_token', tokens.refreshToken);

        originalRequest.headers.Authorization = `Bearer ${tokens.accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh failed — logout
        localStorage.removeItem('bizflow_access_token');
        localStorage.removeItem('bizflow_refresh_token');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
