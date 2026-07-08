/**
 * systemHealth.js — EcoVoice System Health Utilities
 * ----------------------------------------------------
 * Generic self-diagnostic utilities.
 * Safe to call at any time — read-only, no side effects.
 *
 * Functions:
 *   checkLocalStorage()  — verifies localStorage is readable/writable
 *   runHealthCheck()     — returns a health report object
 */

// ─── localStorage health check ─────────────────────────────────────────────────

/**
 * Verify localStorage is available and accessible.
 *
 * @returns {{ ok: boolean, issue: string|null }}
 */
export function checkLocalStorage() {
  try {
    const testKey = '__ecovoice_health_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
  } catch {
    return { ok: false, issue: 'localStorage is not available (private browsing or quota exceeded)' };
  }
  return { ok: true, issue: null };
}

// ─── Full health report ────────────────────────────────────────────────────────

/**
 * Run all generic health checks and return a summary report.
 *
 * @returns {{
 *   storage:  { ok: boolean, issue: string|null },
 *   issues:   string[],
 *   healthy:  boolean,
 * }}
 */
export function runHealthCheck() {
  const storage = checkLocalStorage();
  const issues = [];

  if (!storage.ok) issues.push(storage.issue);

  const healthy = issues.length === 0;

  if (!healthy) {
    console.warn('[EcoVoice/Health] Issues found:', issues);
  } else {
    console.info('[EcoVoice/Health] All checks passed ✓');
  }

  return { storage, issues, healthy };
}
