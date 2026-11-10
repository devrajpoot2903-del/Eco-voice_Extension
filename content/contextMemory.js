/**
 * contextMemory.js — Local rule-based conversational context memory.
 *
 * Tracks the last N commands and resolves follow-up intents without any
 * cloud API. Supports: repeat, continue, modify intensity, target reuse,
 * action inversion, and natural continuation across all intent types.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const SCROLL_AMOUNTS = {
  'tiny': 80, 'very small': 80, 'little': 150, 'a little': 150,
  'slightly': 150, 'a bit': 150, 'small': 200,
  'normal': 500, 'more': 500, 'again': 500, 'same': 500,
  'big': 700, 'large': 700, 'a lot': 900, 'much': 900, 'far': 900,
  'all the way': 99999, 'completely': 99999, 'to the end': 99999,
  'page': -1, // sentinel: use innerHeight
};

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  history: [],    // up to 10 recent commands
  continuous: false,
  continuousTimer: null,
};

function lastCmd() { return state.history[state.history.length - 1] || null; }
function prevCmd() { return state.history[state.history.length - 2] || null; }

function stopContinuous() {
  if (state.continuousTimer) {
    clearInterval(state.continuousTimer);
    state.continuousTimer = null;
  }
  state.continuous = false;
}

// ── Synonym tables ────────────────────────────────────────────────────────────

const CONTINUE_WORDS = /^(more|again|keep going|continue|go on|once more|repeat|keep|another|same|do it again|do that again)$/i;
const STOP_WORDS     = /^(stop listening|cancel listening|halt listening|stop ecovoice|disable listening|turn off listening)$/i;
const REPEAT_WORDS   = /^(repeat|once more|do that again|do it again|again|redo)$/i;

const DIR_SYNONYMS = {
  down:    /^(down|downward|downwards|below|lower|further|forward)$/i,
  up:      /^(up|upward|upwards|above|higher|back up|backward)$/i,
  left:    /^(left|leftward|leftwards)$/i,
  right:   /^(right|rightward|rightwards)$/i,
  top:     /^(top|beginning|start|first|head|very top|back to top)$/i,
  bottom:  /^(bottom|end|last|foot|very bottom|all the way down)$/i,
};

function resolveDirection(text) {
  for (const [dir, re] of Object.entries(DIR_SYNONYMS)) {
    if (re.test(text)) return dir;
  }
  return null;
}

function resolveAmount(text) {
  const t = text.toLowerCase().trim();
  for (const [phrase, amt] of Object.entries(SCROLL_AMOUNTS)) {
    if (t === phrase || t.startsWith(phrase)) {
      return amt === -1 ? window.innerHeight * 0.9 : amt;
    }
  }
  // "scroll X pixels" / "X pixels"
  const m = t.match(/(\d+)\s*(?:px|pixels?)?/);
  if (m) return parseInt(m[1], 10);
  return null;
}

// ── Follow-up resolution ──────────────────────────────────────────────────────

export function resolveFollowUp(rawText) {
  const t = rawText.toLowerCase().trim();
  const last = lastCmd();

  // ── Stop any continuous action ─────────────────────────────────────────────
  if (STOP_WORDS.test(t)) {
    stopContinuous();
    return { intent: 'stop' };
  }

  // ── Scroll follow-ups ──────────────────────────────────────────────────────
  if (last && last.intent === 'scroll') {
    const dir = last.direction || 'down';

    // "keep going" → continuous repeat
    if (/^(keep going|keep scrolling|continuous|non-?stop)$/.test(t)) {
      stopContinuous();
      state.continuousTimer = setInterval(() => {
        window.dispatchEvent(new CustomEvent('ecovoice:continuous', {
          detail: { intent: 'scroll', direction: dir, amount: last.amount || 500 }
        }));
      }, 700);
      state.continuous = true;
      return { intent: 'scroll', direction: dir, amount: last.amount || 500 };
    }

    if (CONTINUE_WORDS.test(t)) {
      return { intent: 'scroll', direction: dir, amount: last.amount || 500 };
    }

    // Speed modifier without direction
    if (/^faster$/.test(t))  return { intent: 'scroll', direction: dir, amount: Math.min((last.amount || 500) * 1.8, 2000) };
    if (/^slower$/.test(t))  return { intent: 'scroll', direction: dir, amount: Math.max((last.amount || 500) * 0.4, 80) };

    // Amount-only phrase  e.g. "a little", "a lot"
    const amt = resolveAmount(t);
    if (amt !== null) return { intent: 'scroll', direction: dir, amount: amt };

    // Direction change: "scroll left/right/up"
    const newDir = resolveDirection(t);
    if (newDir) return { intent: 'scroll', direction: newDir, amount: last.amount || 500 };

    // "scroll a little more to the right"
    const complexMatch = t.match(/(?:scroll\s+)?(.+?)\s+(?:more\s+)?(?:to\s+the\s+)?(.+)/);
    if (complexMatch) {
      const modAmt = resolveAmount(complexMatch[1]);
      const modDir = resolveDirection(complexMatch[2]);
      if (modDir) return { intent: 'scroll', direction: modDir, amount: modAmt || last.amount || 500 };
    }
  }

  // ── Click / Open follow-ups ───────────────────────────────────────────────
  if (last && (last.intent === 'click' || last.intent === 'open')) {
    if (/^(open it|this one|click it|select it|yes|do that|confirm|ok|that one|this|it)$/.test(t)) {
      if (last.target) return { intent: 'click', target: last.target };
    }
    if (REPEAT_WORDS.test(t)) {
      if (last.target) return { intent: 'click', target: last.target };
    }
    // "next" — click the next sibling / next nav item
    if (/^next$/.test(t)) return { intent: 'click', target: 'next' };
    if (/^previous$/.test(t) || /^prev$/.test(t)) return { intent: 'click', target: 'previous' };
  }

  // ── Hover follow-ups ──────────────────────────────────────────────────────
  if (last && last.intent === 'hover') {
    if (/^(click it|click|open it|open|select|tap)$/.test(t)) {
      if (last.target) return { intent: 'click', target: last.target };
    }
    if (REPEAT_WORDS.test(t) && last.target) {
      return { intent: 'hover', target: last.target };
    }
  }

  // ── Navigate follow-ups ───────────────────────────────────────────────────
  if (/^(go back|back|previous page|backwards?)$/.test(t)) {
    return { intent: 'navigate', action: 'back' };
  }
  if (/^(go forward|forward|next page|forwards?)$/.test(t)) {
    return { intent: 'navigate', action: 'forward' };
  }
  if (/^(reload|refresh|refresh page|reload page)$/.test(t)) {
    return { intent: 'navigate', action: 'reload' };
  }
  if (/^(go home|home page|home)$/.test(t)) {
    return { intent: 'navigate', action: 'home' };
  }

  // ── Universal repeat ──────────────────────────────────────────────────────
  if (REPEAT_WORDS.test(t) && last) {
    return {
      intent:    last.intent,
      direction: last.direction,
      target:    last.target,
      action:    last.action,
      amount:    last.amount,
    };
  }

  // ── Combined direction + intensity e.g. "a little down", "way down" ───────
  const dirMatch  = [...Object.keys(DIR_SYNONYMS)].find((d) => new RegExp(`\\b${d}\\b`, 'i').test(t));
  const amtFromT  = resolveAmount(t);
  if (dirMatch) {
    return { intent: 'scroll', direction: dirMatch, amount: amtFromT || 500 };
  }

  // ── Intensity-only if last was scroll ─────────────────────────────────────
  if (last && last.intent === 'scroll' && amtFromT !== null) {
    return { intent: 'scroll', direction: last.direction || 'down', amount: amtFromT };
  }

  return null; // not a follow-up
}

// ── Context update ────────────────────────────────────────────────────────────

export function updateContext(command) {
  if (!command || command.intent === 'stop') {
    stopContinuous();
    return;
  }
  // Don't push duplicates of stop
  state.history.push({ ...command });
  if (state.history.length > 10) state.history.shift();
}

export function resetContext() {
  state.history = [];
  stopContinuous();
}
