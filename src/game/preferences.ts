import { useCallback, useState } from 'react';

const STORAGE_KEY = 'mammamia-preferences-v1';

export interface Preferences {
  /** Whether the oven's discard pile shows a few face-down tabs peeking out from behind the top card, purely for visual flavor. */
  messyPile: boolean;
}

const DEFAULT_PREFERENCES: Preferences = { messyPile: true };

export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(prefs: Preferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable — preference just won't persist across sessions.
  }
}

export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences());

  const updatePreferences = useCallback((patch: Partial<Preferences>) => {
    setPreferences((prev) => {
      const next = { ...prev, ...patch };
      savePreferences(next);
      return next;
    });
  }, []);

  return { preferences, updatePreferences };
}
