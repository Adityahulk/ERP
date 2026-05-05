import axios from 'axios';
import { getApiBaseURL } from './api';

const REGISTRANT_TOKEN_KEY = 'bizflow_registrant_token';

const registrantApi = axios.create({
  baseURL: getApiBaseURL(),
  headers: { 'Content-Type': 'application/json' },
});

registrantApi.interceptors.request.use((config) => {
  const token = localStorage.getItem(REGISTRANT_TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

registrantApi.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem(REGISTRANT_TOKEN_KEY);
      if (window.location.pathname !== '/register/login') {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/register/login?next=${next}`;
      }
    }
    return Promise.reject(err);
  }
);

export default registrantApi;
