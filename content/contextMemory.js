/**
 * contextMemory.js — Local rule-based conversational context.
 *
 * Enables natural follow-up commands like "more", "again", "stop", "go back"
 * without any cloud API. Everything is evaluated locally via pattern rules.
 */

const SCROLL_AMOUNTS = {
  'a bit': 150, 'slightly': 150, 'a little': 150,
  'more': 500,  'again': 500,
  'a lot': 900, 'completely': 99999, 'all the way': 99999,
};

const state = {
  lastIntent: null,
  lastTarget: null,
  lastDirection: null,
  lastUrl: null,
};

/**
 * Try to resolve a follow-up command using the current context state.
 * Returns a parsed command object or null if not a follow-up.
 *
 * @param {string} text — normalised input
 * @returns {object|null}
 */
export function resolveFollowUp(text) {
  const t = text.toLowerCase().trim();

  // ── Scroll continuations ──────────────────────────────────────────────────
  if (state.lastIntent === 'scroll') {
    // "more", "again", "keep going", "continue"
    if (/^(more|again|keep going|continue|go on|once more|repeat)$/.test(t)) {
      return { intent: 'scroll', direction: state.lastDirection || 'down' };
    }
    // "a bit", "slightly", "a little", "a lot", "completely"
    for (const [phrase, amount] of Object.entries(SCROLL_AMOUNTS)) {
      if (t === phrase || t === `scroll ${phrase}`) {
        return { intent: 'scroll', direction: state.lastDirection || 'down', amount };
      }
    }
    // "stop", "cancel", "ok done"
    if (/^(stop|cancel|ok|done|enough|that's enough)$/.test(t)) {
      return { intent: 'stop' };
    }
    // "faster" — increase amount
    if (/^faster$/.test(t)) {
      return { intent: 'scroll', direction: state.lastDirection || 'down', amount: 900 };
    }
    // "slower" — small amount
    if (/^slower$/.test(t)) {
      return { intent: 'scroll', direction: state.lastDirection || 'down', amount: 150 };
    }
    // "go to end" / "go to beginning"
    if (/^(go to (the )?end|scroll to (the )?bottom|bottom)$/.test(t)) {
      return { intent: 'scroll', direction: 'bottom' };
    }
    if (/^(go to (the )?beginning|scroll to (the )?top|top)$/.test(t)) {
      return { intent: 'scroll', direction: 'top' };
    }
  }

  // ── Click continuations ───────────────────────────────────────────────────
  if (state.lastIntent === 'click' || state.lastIntent === 'open') {
    if (/^(open it|this one|yes|do that|confirm|ok)$/.test(t)) {
      if (state.lastTarget) return { intent: 'click', target: state.lastTarget };
    }
    if (/^(cancel|no|nevermind|never mind)$/.test(t)) {
      return { intent: 'stop' };
    }
  }

  // ── Navigation shorthands ─────────────────────────────────────────────────
  if (/^(go back|back|previous page)$/.test(t)) {
    return { intent: 'navigate', action: 'back' };
  }
  if (/^(go forward|forward|next page)$/.test(t)) {
    return { intent: 'navigate', action: 'forward' };
  }
  if (/^(reload|refresh|reload page)$/.test(t)) {
    return { intent: 'navigate', action: 'reload' };
  }
  if (/^(go home|home page|home)$/.test(t)) {
    return { intent: 'navigate', action: 'home' };
  }

  // ── Generic repeats ───────────────────────────────────────────────────────
  if (/^(repeat|do that again|once more)$/.test(t)) {
    if (state.lastIntent) {
      return {
        intent: state.lastIntent,
        direction: state.lastDirection,
        target: state.lastTarget,
        action: state.lastIntent === 'navigate' ? 'back' : undefined,
      };
    }
  }

  return null; // not a follow-up
}

/**
 * Update context state after a command is executed.
 * @param {object} command — parsed command object
 */
export function updateContext(command) {
  if (!command) return;
  state.lastIntent    = command.intent || null;
  state.lastTarget    = command.target || null;
  state.lastDirection = command.direction || null;
  state.lastUrl       = command.url || null;
}

export function resetContext() {
  state.lastIntent = null;
  state.lastTarget = null;
  state.lastDirection = null;
  state.lastUrl = null;
}
