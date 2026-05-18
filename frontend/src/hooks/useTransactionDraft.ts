import { useEffect, useMemo, useRef } from 'react';

type Options<T> = {
  enabled?: boolean;
  shouldSave?: (value: T) => boolean;
  delayMs?: number;
};

export function useTransactionDraft<T>(
  key: string,
  value: T,
  restore: (value: T) => void,
  options: Options<T> = {},
) {
  const { enabled = true, shouldSave = () => true, delayMs = 300 } = options;
  const hydratedRef = useRef(false);
  const shouldSaveRef = useRef(shouldSave);
  const valueJson = useMemo(() => JSON.stringify(value), [value]);
  const valueJsonRef = useRef(valueJson);

  useEffect(() => {
    shouldSaveRef.current = shouldSave;
  }, [shouldSave]);

  useEffect(() => {
    valueJsonRef.current = valueJson;
  }, [valueJson]);

  const persist = (json: string) => {
    try {
      const parsed = JSON.parse(json) as T;
      if (shouldSaveRef.current(parsed)) localStorage.setItem(key, json);
      else localStorage.removeItem(key);
    } catch {
      /* Ignore quota/private-mode failures. */
    }
  };

  useEffect(() => {
    if (!enabled || hydratedRef.current) return;
    hydratedRef.current = true;
    try {
      const raw = localStorage.getItem(key);
      if (raw) restore(JSON.parse(raw) as T);
    } catch {
      /* Ignore corrupt or unavailable local storage. */
    }
  }, [enabled, key, restore]);

  useEffect(() => {
    if (!enabled || !hydratedRef.current) return;
    const timer = window.setTimeout(() => {
      persist(valueJson);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, enabled, key, valueJson]);

  useEffect(() => {
    if (!enabled) return undefined;
    const flush = () => {
      if (hydratedRef.current) persist(valueJsonRef.current);
    };
    window.addEventListener('pagehide', flush);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
    };
  }, [enabled, key]);

  return {
    clearDraft: () => {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}
