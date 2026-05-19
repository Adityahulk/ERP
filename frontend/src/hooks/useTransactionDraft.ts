import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Options<T> = {
  enabled?: boolean;
  shouldSave?: (value: T) => boolean;
};

export function useTransactionDraft<T>(
  key: string,
  value: T,
  restore: (value: T) => void,
  options: Options<T> = {},
) {
  const { enabled = true, shouldSave = () => true } = options;
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
      setHasDraft(Boolean(localStorage.getItem(key)));
    } catch {
      setHasDraft(false);
    }
  }, [enabled, key]);

  const saveDraft = useCallback(() => {
    if (!enabled) return false;
    try {
      const parsed = JSON.parse(valueJson) as T;
      if (!shouldSaveRef.current(parsed)) {
        localStorage.removeItem(key);
        setHasDraft(false);
        return false;
      }
      localStorage.setItem(key, valueJson);
      setHasDraft(true);
      return true;
    } catch {
      return false;
    }
  }, [enabled, key, valueJson]);

  const loadDraft = useCallback(() => {
    if (!enabled) return false;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      restore(JSON.parse(raw) as T);
      return true;
    } catch {
      return false;
    }
  }, [enabled, key, restore]);

  return {
    hasDraft,
    saveDraft,
    loadDraft,
    clearDraft: () => {
      try {
        localStorage.removeItem(key);
        setHasDraft(false);
      } catch {
        /* ignore */
      }
    },
  };
}
