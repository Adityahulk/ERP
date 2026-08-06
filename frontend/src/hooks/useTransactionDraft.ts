import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Options<T> = {
  enabled?: boolean;
  shouldSave?: (value: T) => boolean;
  legacyKey?: string;
};

export function useTransactionDraft<T>(
  key: string,
  value: T,
  restore: (value: T) => void,
  options: Options<T> = {},
) {
  const { enabled = true, shouldSave = () => true, legacyKey } = options;
  const shouldSaveRef = useRef(shouldSave);
  const valueJson = useMemo(() => JSON.stringify(value), [value]);
  const [hasDraft, setHasDraft] = useState(false);

  useEffect(() => {
    shouldSaveRef.current = shouldSave;
  }, [shouldSave]);

  useEffect(() => {
    if (!enabled) {
      setHasDraft(false);
      return;
    }
    try {
      const current = localStorage.getItem(key);
      const legacy = current == null && legacyKey ? localStorage.getItem(legacyKey) : null;
      if (legacy != null) localStorage.setItem(key, legacy);
      setHasDraft(Boolean(current || legacy));
    } catch {
      setHasDraft(false);
    }
  }, [enabled, key, legacyKey]);

  const saveDraft = useCallback(() => {
    if (!enabled) return false;
    try {
      const parsed = JSON.parse(valueJson) as T;
      if (!shouldSaveRef.current(parsed)) {
        localStorage.removeItem(key);
        if (legacyKey) localStorage.removeItem(legacyKey);
        setHasDraft(false);
        return false;
      }
      localStorage.setItem(key, valueJson);
      if (legacyKey) localStorage.removeItem(legacyKey);
      setHasDraft(true);
      return true;
    } catch {
      return false;
    }
  }, [enabled, key, legacyKey, valueJson]);

  const loadDraft = useCallback(() => {
    if (!enabled) return false;
    try {
      const raw = localStorage.getItem(key) || (legacyKey ? localStorage.getItem(legacyKey) : null);
      if (!raw) return false;
      if (legacyKey && !localStorage.getItem(key)) localStorage.setItem(key, raw);
      restore(JSON.parse(raw) as T);
      return true;
    } catch {
      return false;
    }
  }, [enabled, key, legacyKey, restore]);

  return {
    hasDraft,
    saveDraft,
    loadDraft,
    clearDraft: () => {
      try {
        localStorage.removeItem(key);
        if (legacyKey) localStorage.removeItem(legacyKey);
        setHasDraft(false);
      } catch {
        /* ignore */
      }
    },
  };
}
