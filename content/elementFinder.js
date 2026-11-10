/**
 * elementFinder.js — Phase 6: High-accuracy DOM element finder (target: 95%+)
 *
 * Multi-signal scoring pipeline:
 *   1. Exact text match                 → 100
 *   2. Exact aria-label / title / alt   → 95
 *   3. Text starts with query           → 80
 *   4. aria-label starts with query     → 78
 *   5. Text contains query              → 65
 *   6. aria-label contains query        → 62
 *   7. Placeholder / name contains      → 55
 *   8. ID / class contains              → 48
 *   9. Data-attr contains               → 45
 *  10. All words in query match          → up to 42
 *  11. Associated label matches          → 38
 *  12. Nearest heading / parent match   → 30
 *  13. Fuzzy char overlap               → up to 20
 *
 * Visibility: element AND all ancestors must be non-hidden.
 */

// Interactive controls — these are the PRIMARY targets for voice commands.
// They receive a scoring bonus to outcompete non-interactive containers.
const INTERACTIVE_SELECTORS =
  'a[href], button, input, select, textarea, summary,' +
  '[role="button"], [role="link"], [role="menuitem"], [role="option"],' +
  '[role="tab"], [role="checkbox"], [role="radio"], [role="switch"],' +
  '[role="combobox"]';

// Contextual elements — included for discovery but scored lower.
// They only win if no interactive element matches well enough.
const CONTEXTUAL_SELECTORS =
  'details, [role="listitem"], [role="treeitem"],' +
  '[tabindex]:not([tabindex="-1"]), label, [onclick]';

const CANDIDATE_SELECTORS = INTERACTIVE_SELECTORS + ', ' + CONTEXTUAL_SELECTORS;

// Set of tags / roles that get the interactive bonus during scoring.
const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary']);
const INTERACTIVE_ROLES = new Set(['button', 'link', 'menuitem', 'option', 'tab', 'checkbox', 'radio', 'switch', 'combobox']);

// Bonus added to the raw score when the element is a known interactive control.
// Large enough to beat an equal-text-match on a non-interactive element.
const INTERACTIVE_BONUS = 25;

// ── Visibility ────────────────────────────────────────────────────────────────

function isVisible(el) {
  if (!el || !el.getBoundingClientRect) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  // Walk ancestor chain — any hidden ancestor disqualifies
  let node = el;
  while (node && node !== document.body) {
    const s = window.getComputedStyle(node);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
    node = node.parentElement;
  }
  return true;
}

// ── Text extraction ───────────────────────────────────────────────────────────

function norm(s) { return (s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

function getAssociatedLabel(el) {
  // htmlFor label
  if (el.id) {
    const lbl = document.querySelector(`label[for="${el.id}"]`);
    if (lbl) return norm(lbl.textContent);
  }
  // Wrapping label
  const parent = el.closest('label');
  if (parent) return norm(parent.textContent);
  // aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/).map((id) => {
      const ref = document.getElementById(id);
      return ref ? norm(ref.textContent) : '';
    });
    return parts.join(' ').trim();
  }
  return '';
}

function getNearestHeading(el) {
  let node = el.parentElement;
  for (let i = 0; i < 4 && node; i++) {
    const h = node.querySelector('h1,h2,h3,h4,h5,h6');
    if (h) return norm(h.textContent);
    node = node.parentElement;
  }
  return '';
}

function getSiblingText(el) {
  const parent = el.parentElement;
  if (!parent) return '';
  return norm(Array.from(parent.children)
    .filter((c) => c !== el)
    .map((c) => c.textContent)
    .join(' '));
}

function extractSignals(el) {
  return {
    text:        norm(el.textContent),
    ariaLabel:   norm(el.getAttribute('aria-label')),
    title:       norm(el.getAttribute('title')),
    alt:         norm(el.getAttribute('alt')),
    placeholder: norm(el.getAttribute('placeholder')),
    name:        norm(el.getAttribute('name')),
    id:          norm(el.getAttribute('id')),
    className:   norm(el.className),
    dataLabel:   norm(el.getAttribute('data-label')),
    dataName:    norm(el.getAttribute('data-name')),
    dataText:    norm(el.getAttribute('data-text')),
    value:       el.tagName === 'INPUT' ? norm(el.value) : '',
    label:       getAssociatedLabel(el),
    heading:     getNearestHeading(el),
    sibling:     getSiblingText(el),
  };
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function wordOverlap(haystack, needle) {
  if (!haystack || !needle) return 0;
  const nw = needle.split(/\s+/).filter(Boolean);
  if (nw.length === 0) return 0;
  const hw = new Set(haystack.split(/\s+/).filter(Boolean));
  const matched = nw.filter((w) => hw.has(w)).length;
  return matched / nw.length;
}

function fuzzyScore(haystack, needle) {
  if (!haystack || !needle) return 0;
  let ci = 0;
  for (const c of needle) {
    const pos = haystack.indexOf(c, ci);
    if (pos === -1) return 0;
    ci = pos + 1;
  }
  return needle.length / haystack.length;
}

function isInteractive(el) {
  if (INTERACTIVE_TAGS.has(el.tagName.toLowerCase())) return true;
  const role = (el.getAttribute('role') || '').toLowerCase();
  return INTERACTIVE_ROLES.has(role);
}

function scoreElement(signals, query, el) {
  const q = query.toLowerCase().trim();
  let best = 0;

  function check(sig, exactScore, startsScore, includesScore) {
    if (!sig) return;
    if (sig === q)               best = Math.max(best, exactScore);
    else if (sig.startsWith(q)) best = Math.max(best, startsScore);
    else if (sig.includes(q))   best = Math.max(best, includesScore);
  }

  // Tier 1: exact / starts / includes for primary signals
  check(signals.text,        100, 80, 65);
  check(signals.ariaLabel,    95, 78, 62);
  check(signals.title,        93, 76, 60);
  check(signals.alt,          90, 74, 58);
  check(signals.label,        88, 72, 56);
  check(signals.placeholder,  55, 50, 45);
  check(signals.name,         50, 45, 40);
  check(signals.value,        50, 45, 40);
  check(signals.id,           48, 42, 38);
  check(signals.dataLabel,    45, 40, 35);
  check(signals.dataName,     45, 40, 35);
  check(signals.dataText,     45, 40, 35);
  check(signals.className,    30, 25, 20);

  // Tier 2: word overlap across composite signals
  if (best < 42) {
    const overlap = wordOverlap(signals.text + ' ' + signals.ariaLabel + ' ' + signals.label, q);
    if (overlap > 0) best = Math.max(best, Math.round(overlap * 42));
  }

  // Tier 3: nearby semantic context
  if (best < 30) {
    check(signals.heading, 30, 25, 20);
    check(signals.sibling, 20, 18, 15);
  }

  // Tier 4: fuzzy sequence matching on primary text
  if (best < 20) {
    const fz = fuzzyScore(signals.text, q);
    if (fz > 0) best = Math.max(best, Math.round(fz * 20));
  }

  // Interactive element bonus — applied AFTER all text scoring.
  // Ensures buttons/links/inputs beat non-interactive containers
  // (e.g. <li>, [role="listitem"]) that accidentally contain the same text.
  if (best > 0 && isInteractive(el)) {
    best = Math.min(best + INTERACTIVE_BONUS, 100);
  }

  return best;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Find the single best-matching visible element for a query string.
 * Returns null if no candidate exceeds the minimum threshold.
 */
export function findElement(query) {
  if (!query) return null;
  const candidates = Array.from(document.querySelectorAll(CANDIDATE_SELECTORS));
  
  let bestInteractive = null;
  let bestInteractiveScore = 0;
  
  let bestFallback = null;
  let bestFallbackScore = 0;

  for (const el of candidates) {
    if (!isVisible(el)) continue;
    const signals = extractSignals(el);
    const score   = scoreElement(signals, query, el);  // pass el for interactive bonus
    
    if (isInteractive(el)) {
      if (score > bestInteractiveScore) {
        bestInteractiveScore = score;
        bestInteractive = el;
      }
    } else {
      if (score > bestFallbackScore) {
        bestFallbackScore = score;
        bestFallback = el;
      }
    }
  }

  // Minimum threshold: 22 to allow partial word matches while avoiding false positives
  const THRESHOLD = 22;

  // STRICT TWO-PASS LOGIC:
  // 1. FIRST check exclusively for interactive elements. If one matches, return it.
  if (bestInteractiveScore >= THRESHOLD) {
    return bestInteractive;
  }

  // 2. ONLY fallback to non-interactive elements (li, details, etc) if no interactive element matched.
  if (bestFallbackScore >= THRESHOLD) {
    return bestFallback;
  }

  return null;
}

/**
 * Return all visible candidates ranked by score for a query, with scores.
 */
export function findAllRanked(query, limit = 5) {
  if (!query) return [];
  const candidates = Array.from(document.querySelectorAll(CANDIDATE_SELECTORS));
  const results = [];

  for (const el of candidates) {
    if (!isVisible(el)) continue;
    const signals = extractSignals(el);
    const score   = scoreElement(signals, query, el);  // pass el for interactive bonus
    if (score >= 15) results.push({ el, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit).map((r) => r.el);
}

/**
 * Return all visible elements matching a CSS selector.
 */
export function findAllVisible(selector) {
  return Array.from(document.querySelectorAll(selector)).filter(isVisible);
}
