/**
 * elementFinder.js — Phase 5C: Robust DOM element finder with scoring.
 *
 * Locates elements by: visible text, aria-label, title, placeholder, alt,
 * role, id, class, data attributes, partial matching, and fuzzy scoring.
 * Returns the highest-scoring visible candidate.
 */

const CANDIDATE_SELECTORS =
  'a, button, input, select, textarea, [role="button"], [role="link"],' +
  '[role="menuitem"], [role="option"], [role="tab"], [tabindex], label, summary';

function isVisible(el) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
}

function extractText(el) {
  const parts = [];
  parts.push(el.textContent || '');
  parts.push(el.getAttribute('aria-label') || '');
  parts.push(el.getAttribute('title') || '');
  parts.push(el.getAttribute('placeholder') || '');
  parts.push(el.getAttribute('alt') || '');
  parts.push(el.getAttribute('name') || '');
  parts.push(el.getAttribute('id') || '');
  parts.push(el.getAttribute('data-label') || '');
  parts.push(el.getAttribute('data-name') || '');
  return parts.map((s) => s.toLowerCase().trim()).join(' ');
}

function scoreMatch(haystack, needle) {
  if (!needle || !haystack) return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (h === n)               return 100;
  if (h.startsWith(n))      return 80;
  if (h.includes(n))        return 60;

  // Word-level partial: every word in needle present in haystack
  const needleWords = n.split(/\s+/).filter(Boolean);
  const haystackWords = new Set(h.split(/\s+/).filter(Boolean));
  const matched = needleWords.filter((w) => haystackWords.has(w)).length;
  if (matched > 0) return Math.round((matched / needleWords.length) * 40);

  // Fuzzy: count common chars
  let common = 0;
  const used = new Set();
  for (const c of n) {
    const i = h.indexOf(c);
    if (i !== -1 && !used.has(i)) { common++; used.add(i); }
  }
  return Math.round((common / n.length) * 20);
}

export function findElement(query) {
  if (!query) return null;
  const candidates = Array.from(document.querySelectorAll(CANDIDATE_SELECTORS));
  let best = null;
  let bestScore = 0;
  for (const el of candidates) {
    if (!isVisible(el)) continue;
    const label = extractText(el);
    const score = scoreMatch(label, query);
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return bestScore >= 20 ? best : null;
}

export function findAllVisible(selector) {
  return Array.from(document.querySelectorAll(selector)).filter(isVisible);
}
