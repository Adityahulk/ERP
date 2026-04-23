/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** e.g. `http://127.0.0.1:5001` — omit `/api`; when set, overrides dev default loopback URL */
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_BACKEND_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
