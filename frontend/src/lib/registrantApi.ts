import axios from 'axios';
import { getApiBaseURL } from './api';
import { LEGACY_STORAGE_KEYS, readStorageWithLegacy, removeStorageWithLegacy, STORAGE_KEYS } from './storageKeys';

const REGISTRANT_TOKEN_KEY = STORAGE_KEYS.registrantToken;
const LEGACY_REGISTRANT_TOKEN_KEY = LEGACY_STORAGE_KEYS.registrantToken;

const registrantApi = axios.create({
  baseURL: getApiBaseURL(),
  headers: { 'Content-Type': 'application/json' },
});

registrantApi.interceptors.request.use((config) => {
  const token = readStorageWithLegacy(REGISTRANT_TOKEN_KEY, LEGACY_REGISTRANT_TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

registrantApi.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      removeStorageWithLegacy(REGISTRANT_TOKEN_KEY, LEGACY_REGISTRANT_TOKEN_KEY);
      if (window.location.pathname !== '/register/login') {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/register/login?next=${next}`;
      }
    }
    return Promise.reject(err);
  }
);

export default registrantApi;
