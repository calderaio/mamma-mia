import { createEmptyQTable, type QTable } from './rl';

const STORAGE_KEY = 'mammamia-rl-qtable-v1';

export function loadQTable(): QTable {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyQTable();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.playOrder || !parsed.drawSource) {
      return createEmptyQTable();
    }
    return parsed as QTable;
  } catch {
    return createEmptyQTable();
  }
}

export function saveQTable(table: QTable): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(table));
  } catch {
    // Storage full or unavailable (e.g. private browsing) — learning just
    // won't persist across sessions, which isn't worth surfacing as an error.
  }
}
