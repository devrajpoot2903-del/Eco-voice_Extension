/**
 * commandHistory.js — EcoVoice Command History (Phase B1)
 * --------------------------------------------------------
 * Persistent command log — survives page refreshes via localStorage.
 *
 * Each entry shape (as shown in Activity History panel):
 *   {
 *     id:         string,   — unique ID (timestamp + counter)
 *     transcript: string,   — original user speech ("pin dsa")
 *     action:     string,   — detected intent type  ("PIN_TASK")
 *     result:     string,   — 'SUCCESS' | 'DUPLICATE' | 'EMPTY' | 'ERROR'
 *                             | 'FALLBACK' | 'MISSING_TARGET' | 'UNKNOWN'
 *     timestamp:  number,   — Date.now()
 *   }
 *
 * Capacity: last 100 entries. Oldest auto-purged on insert.
 */

const STORAGE_KEY  = 'ecovoice:cmd_history';
const MAX_ENTRIES  = 100;

// ─── Normalise legacy result labels ───────────────────────────────────────────

const RESULT_LABELS = {
  ok:             'SUCCESS',
  duplicate:      'DUPLICATE',
  empty:          'EMPTY',
  error:          'ERROR',
  fallback:       'FALLBACK',
  missing_target: 'MISSING_TARGET',
  unknown:        'UNKNOWN',
};

function normaliseResult(raw) {
  if (!raw) return 'SUCCESS';
  const key = raw.toLowerCase();
  return RESULT_LABELS[key] ?? raw.toUpperCase();
}

// ─── Persistence helpers ───────────────────────────────────────────────────────

function loadFromStorage() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveToStorage(entries) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (err) {
    console.warn('[EcoVoice/History] localStorage write failed:', err.message);
  }
}

// ─── In-memory cache (lazy-loaded from localStorage) ──────────────────────────

let _cache = null;
let _counter = 0;

function getCache() {
  if (_cache === null) {
    _cache = loadFromStorage();
    _counter = _cache.length;
  }
  return _cache;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Record a processed command.
 *
 * @param {object} entry
 * @param {string} entry.transcript  — original speech
 * @param {string} entry.intent      — intent type (e.g. 'CREATE_TASK')
 * @param {string} [entry.task]      — extracted task/query (optional)
 * @param {string} [entry.result]    — 'ok' | 'duplicate' | 'empty' | 'error' etc.
 * @param {string} [entry.source]    — 'ai' | 'parser' | 'none'
 */
export function recordCommand({ transcript, intent, task = '', result = 'ok', source = 'ai' }) {
  const history = getCache();

  history.push({
    id:         `${Date.now()}-${++_counter}`,
    transcript: transcript ?? '',
    action:     intent     ?? 'UNKNOWN',
    task:       task       ?? '',
    result:     normaliseResult(result),
    source:     source     ?? 'ai',
    timestamp:  Date.now(),
  });

  // Trim to MAX_ENTRIES — remove oldest
  if (history.length > MAX_ENTRIES) {
    history.splice(0, history.length - MAX_ENTRIES);
  }

  saveToStorage(history);
}

/**
 * Return all history entries (oldest first).
 * @returns {Array}
 */
export function getCommandHistory() {
  return [...getCache()];
}

/**
 * Return the most recent N entries (newest last).
 * @param {number} [n=20]
 * @returns {Array}
 */
export function getRecentHistory(n = 20) {
  const h = getCache();
  return h.slice(-n);
}

/**
 * Clear all history from memory and localStorage.
 */
export function clearCommandHistory() {
  _cache = [];
  _counter = 0;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}
