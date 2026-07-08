/**
 * useLocalStorage.js
 * ------------------
 * Generic React hook that keeps a state value in sync with localStorage.
 *
 * Behaviour:
 *   - On first render, reads the stored JSON value (or falls back to initialValue).
 *   - On every update, serialises the new value back to localStorage.
 *   - Errors (quota exceeded, SSR, private-browsing restrictions) are caught
 *     and logged without crashing the app — the state still works in memory.
 *
 * @template T
 * @param {string} key           — localStorage key
 * @param {T}      initialValue  — value used when no stored entry exists
 * @returns {[T, React.Dispatch<React.SetStateAction<T>>]}
 *
 * MongoDB migration note:
 *   Replace the useEffect body with an async fetch/mutation call.
 *   The hook's public interface (return tuple) stays identical.
 */

import { useState, useEffect } from 'react';

const STORAGE_PREFIX = 'ecovoice:'; // namespace prefix to avoid key collisions

export function useLocalStorage(key, initialValue) {
  const prefixedKey = STORAGE_PREFIX + key;

  // Initialise state lazily: read localStorage once, fall back to initialValue.
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(prefixedKey);
      return raw !== null ? JSON.parse(raw) : initialValue;
    } catch (err) {
      console.warn('[EcoVoice] useLocalStorage: read failed for key', prefixedKey, err);
      return initialValue;
    }
  });

  // Whenever the value changes, persist it.
  useEffect(() => {
    try {
      window.localStorage.setItem(prefixedKey, JSON.stringify(storedValue));
    } catch (err) {
      console.warn('[EcoVoice] useLocalStorage: write failed for key', prefixedKey, err);
    }
  }, [prefixedKey, storedValue]);

  return [storedValue, setStoredValue];
}
