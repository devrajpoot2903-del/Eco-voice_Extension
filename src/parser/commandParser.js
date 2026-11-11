/**
 * commandParser.js — EcoVoice Command Engine
 * -------------------------------------------------------
 * Rule-based natural language parser for browser navigation and UI actions.
 * No external AI APIs are required for standard commands.
 *
 * Pipeline:
 *   1. Normalise raw transcript text.
 *   2. Run intent-detection rules in priority order (first match wins).
 *   3. Extract targets, values, or directions.
 *   4. Return a structured result object with a defined `intent` property.
 *
 * Supported browser intents:
 *   navigate, tab, scroll, click, open, double-click, right-click,
 *   type, hover, zoom-in, zoom-out, zoom-reset, copy, paste, cut,
 *   undo, redo, keyboard, select-all, scroll-into-view, window-focus,
 *   read, help, chat-mode, self-intro, unknown
 */

// ---------------------------------------------------------------------------
// 1. TEXT NORMALISATION
// ---------------------------------------------------------------------------

/**
 * Normalise raw speech text before any matching:
 *  - Lowercase
 *  - Trim & collapse internal whitespace
 *  - Strip trailing punctuation
 *  - Expand common contractions that affect matching
 *  - Normalize homophones only in safe contexts
 *
 * @param {string} text
 * @returns {string}
 */
function normalise(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/\bdon't\b/g, "don't")   // preserve apostrophe contractions
    .replace(/\bi've\b/g, 'i have')
    .replace(/\bi'll\b/g, 'i will')
    .replace(/\bwon't\b/g, 'will not')
    .replace(/\bcan't\b/g, 'cannot')
    .replace(/\bwanna\b/g, 'want to')
    .replace(/\bgotta\b/g, 'got to')
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/, '')
    // ── Context-sensitive homophone normalization ─────────────────────────
    // Replace "by" / "bye" -> "buy" ONLY directly following click-type verbs
    // e.g. "click by" -> "click buy", "tap on by" -> "tap on buy"
    // Leaves phrases like "sort by price", "created by" completely untouched.
    .replace(/\b(click|tap|press|select|choose)(\s+(?:on\s+)?)(?:by|bye)\b/gi, '$1$2buy')
    .replace(/\bcell\b/g, 'sell')        // "cell" → "sell" (e-commerce contexts)
    .replace(/\bfor free\b/g, 'free')    // "for free" → "free" (button label cleanup)
    .replace(/\b(add|go|view)\s+(?:two|too)\s+cart\b/gi, '$1 to cart')
    .replace(/\badd two cart\b/g, 'add to cart')
    .replace(/\badd too cart\b/g, 'add to cart')
    .replace(/\bchecked out\b/g, 'checkout')
    .replace(/\bcheck out\b/g, 'checkout')
    // Numeric homophones only in pure numeric / scroll / wait / page contexts
    .replace(/\b(scroll|swipe|wait|page)\s+(?:to\s+)?(two|too)\b/gi, '$1 2')
    .replace(/\b(scroll|swipe|wait|page)\s+(?:to\s+)?(for|fore)\b/gi, '$1 4');
}

// ---------------------------------------------------------------------------
// 2. INTENT DETECTION RULES
// ---------------------------------------------------------------------------

const INTENT_RULES = [
  // ── NAVIGATION & TABS ──
  {
    intent: 'NAVIGATE',
    patterns: [
      /^(?:go\s+back|navigate\s+back|back|previous\s+page)$/i,
      /^(?:go\s+forward|navigate\s+forward|forward|next\s+page)$/i,
      /^(?:reload|refresh|reload\s+page|refresh\s+page)$/i,
      /^(?:go\s+home|home\s+page|go\s+to\s+home)$/i,
      /^(?:open\s+(?:new\s+)?tab|new\s+tab)$/i,
      /^(?:close\s+tab|close\s+this\s+tab)$/i,
      /^(?:next\s+tab|switch\s+to\s+next\s+tab)$/i,
      /^(?:previous\s+tab|prev\s+tab|switch\s+to\s+previous\s+tab)$/i,
      /^(?:go\s+to\s+(?:url\s+)?|navigate\s+to\s+)https?:\/\/.+$/i,
      /^(?:search\s+for|google\s+)(.+)$/i,
    ]
  },
  // ── BROWSER CAPABILITIES ──
  {
    intent: 'DOUBLE_CLICK',
    patterns: [ /^(?:double.?click|double.?tap)\s+(.+)$/i ]
  },
  {
    intent: 'RIGHT_CLICK',
    patterns: [ /^(?:right.?click|context\s+menu)(?:\s+on)?\s+(.+)$/i ]
  },
  {
    intent: 'TYPE',
    patterns: [
      /^(?:type|write|enter|input)\s+(?:in(?:to)?\s+(?:.+?)\s+)?["']?(.+)["']?$/i,
    ]
  },
  {
    intent: 'ZOOM_IN',
    patterns: [ /^zoom\s+in$/i, /^(?:make\s+(?:it\s+)?)?bigger$/i ]
  },
  {
    intent: 'ZOOM_OUT',
    patterns: [ /^zoom\s+out$/i, /^(?:make\s+(?:it\s+)?)?smaller$/i ]
  },
  {
    intent: 'ZOOM_RESET',
    patterns: [ /^(?:reset\s+zoom|zoom\s+reset|normal\s+zoom)$/i ]
  },
  {
    intent: 'COPY',
    patterns: [ /^copy(?:\s+that)?$/i, /^(?:copy\s+selection|copy\s+text)$/i ]
  },
  {
    intent: 'PASTE',
    patterns: [ /^paste(?:\s+that)?$/i, /^(?:paste\s+here|paste\s+it)$/i ]
  },
  {
    intent: 'CUT',
    patterns: [ /^cut(?:\s+that)?$/i, /^(?:cut\s+selection|cut\s+text)$/i ]
  },
  {
    intent: 'REDO',
    patterns: [ /^redo$/i, /^redo\s+(last|that|it)$/i ]
  },
  {
    intent: 'KEYBOARD',
    patterns: [
      /^(?:press|hit|type key)\s+(enter|escape|esc|tab|space|backspace|delete|arrow\s*up|arrow\s*down|arrow\s*left|arrow\s*right)$/i,
    ]
  },
  {
    intent: 'SELECT_ALL',
    patterns: [
      /^(?:select\s+all|ctrl\s*\+?\s*a|highlight\s+all)$/i,
    ]
  },
  {
    intent: 'SCROLL_INTO_VIEW',
    patterns: [
      /^(?:scroll\s+to|bring\s+into\s+view|show|find\s+and\s+show)\s+(.+)$/i,
    ]
  },
  {
    intent: 'WINDOW_FOCUS',
    patterns: [
      /^(?:focus\s+window|focus\s+tab|activate\s+window)$/i,
    ]
  },
  // ── SCROLL INTENTS ──
  {
    intent: 'SCROLL',
    patterns: [
      /^(?:scroll|move|slide|travel)\s+(?:to\s+)?(up|down|bottom|top|left|right)$/i,
      /^(?:go\s*down|godown)$/i,
      /^(?:go\s*up|goup)$/i,
      /^(?:go\s*left|goleft)$/i,
      /^(?:go\s*right|goright)$/i,
      /^(?:go\s*top|gotop)$/i,
      /^(?:go\s*bottom|gobottom)$/i,
      /^page\s+(up|down|left|right)$/i,
      /^(?:scroll|go|move|slide)\s+(?:a\s+bit|slightly|a\s+little|more|again|same|a\s+lot|completely|far|page)$/i,
      /^(?:move|slide|go)\s+(?:to\s+)?(up|down|left|right)$/i,
      /^(?:scroll|go)\s+to\s+(?:the\s+)?(?:top|bottom|beginning|end|start|finish)$/i,
      /^(?:scroll\s+)?(?:top|bottom)$/i,
      /^(?:scroll|move|slide)\s+(?:(up|down|left|right)\s+)?(\d+)(?:\s*(?:px|pixels?))?(?:\s+(up|down|left|right))?$/i,
    ]
  },
  // ── DOM ACTION INTENTS ──
  {
    intent: 'CLICK',
    patterns: [
      /^(?:click|tap|select|press|choose)(?:\s+(?:button|link))?\s+(.+)$/i,
      /^(?:add\s+to\s+cart|checkout)$/i,
    ]
  },
  {
    intent: 'HOVER',
    patterns: [
      /^(?:hover|focus)(?:\s+over|\s+on)?\s+(.+)$/i
    ]
  },
  {
    intent: 'OPEN',
    patterns: [
      /^open\s+(.+)$/i
    ]
  },
  {
    intent: 'READ',
    patterns: [
      /^(?:read\s+page|extract\s+content|show\s+page\s+content|list\s+(?:products|buttons|links|inputs))$/i
    ]
  },
  // ── SYSTEM / CONVERSATIONAL INTENTS ──
  {
    intent: 'UNDO',
    patterns: [
      /^undo$/i,
      /^undo\s+(last|that|it)$/i,
      /^revert\s+(last|that)?\s*(action)?$/i,
      /^take\s+that\s+back$/i,
    ],
  },
  {
    intent: 'ENTER_CHAT_MODE',
    patterns: [
      /^(enter|start|activate|switch\s+to)\s+chat\s+mode$/i,
      /^chat\s+mode$/i,
    ],
  },
  {
    intent: 'EXIT_CHAT_MODE',
    patterns: [
      /^(exit|leave|stop|deactivate)\s+chat\s+mode$/i,
      /^(task\s+mode|back\s+to\s+task(s|\s+mode)?)$/i,
    ],
  },
  {
    intent: 'SELF_INTRO',
    patterns: [
      /^(who\s+are\s+you|what\s+are\s+you|introduce\s+yourself)$/i,
      /^tell\s+me\s+about\s+yourself$/i,
    ],
  },
];

/**
 * Detect the intent of a normalised text string.
 *
 * @param {string} text — already normalised
 * @returns {string} intent name
 */
function detectIntent(text) {
  for (const rule of INTENT_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        return rule.intent;
      }
    }
  }
  return 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// 3. PUBLIC API
// ---------------------------------------------------------------------------

/**
 * Parse a raw speech transcript into a structured command object.
 *
 * @param {string} rawText — the recognised speech string from the browser
 * @returns {Object} command object, always containing `intent`
 *
 * @example
 *   parseCommand("click buy now")
 *   // → { intent: 'click', target: 'buy now' }
 *
 *   parseCommand("scroll down")
 *   // → { intent: 'scroll', direction: 'down' }
 */
export function parseCommand(rawText) {
  if (!rawText || typeof rawText !== 'string' || rawText.trim() === '') {
    return { intent: 'unknown', type: 'UNKNOWN' };
  }

  const text = normalise(rawText);

  // HELP intent: checked before other rules
  const HELP_PATTERNS = [
    /^help$/i,
    /^(show|list)\s+commands?/i,
    /^what\s+can\s+you\s+do/i,
    /^guide\s+me/i,
    /^how\s+does\s+this\s+work/i,
    /^show\s+help/i,
  ];
  if (HELP_PATTERNS.some((p) => p.test(text))) {
    return { intent: 'help', type: 'SHOW_HELP' };
  }

  // Detect intent — first matching rule wins.
  const intent = detectIntent(text);

  // ── Navigation ─────────────────────────────────────────────────────────────
  if (intent === 'NAVIGATE') {
    if (/^(?:go\s+back|navigate\s+back|back|previous\s+page)$/i.test(text))
      return { intent: 'navigate', action: 'back' };
    if (/^(?:go\s+forward|navigate\s+forward|forward|next\s+page)$/i.test(text))
      return { intent: 'navigate', action: 'forward' };
    if (/^(?:reload|refresh|reload\s+page|refresh\s+page)$/i.test(text))
      return { intent: 'navigate', action: 'reload' };
    if (/^(?:go\s+home|home\s+page|go\s+to\s+home)$/i.test(text))
      return { intent: 'navigate', action: 'home' };
    if (/^(?:open\s+(?:new\s+)?tab|new\s+tab)$/i.test(text))
      return { intent: 'tab', action: 'new' };
    if (/^(?:close\s+tab|close\s+this\s+tab)$/i.test(text))
      return { intent: 'tab', action: 'close' };
    if (/^(?:next\s+tab|switch\s+to\s+next\s+tab)$/i.test(text))
      return { intent: 'tab', action: 'next' };
    if (/^(?:previous\s+tab|prev\s+tab|switch\s+to\s+previous\s+tab)$/i.test(text))
      return { intent: 'tab', action: 'previous' };
    const urlMatch = text.match(/(?:go\s+to\s+(?:url\s+)?|navigate\s+to\s+)(https?:\/\/.+)$/i);
    if (urlMatch) return { intent: 'navigate', action: 'url', url: urlMatch[1].trim() };
    const searchMatch = text.match(/^(?:search\s+for|google\s+)(.+)$/i);
    if (searchMatch)
      return { intent: 'navigate', action: 'url', url: `https://www.google.com/search?q=${encodeURIComponent(searchMatch[1])}` };
    return { intent: 'navigate', action: 'back' };
  }

  // ── Browser capabilities ───────────────────────────────────────────────────
  if (intent === 'DOUBLE_CLICK') {
    const m = text.match(/^(?:double.?click|double.?tap)\s+(.+)$/i);
    let target = m ? m[1].trim() : '';
    target = target.replace(/^on\s+/i, '').trim();
    return { intent: 'double-click', target: target.toLowerCase() };
  }
  if (intent === 'RIGHT_CLICK') {
    const m = text.match(/^(?:right.?click|context\s+menu)(?:\s+on)?\s+(.+)$/i);
    let target = m ? m[1].trim() : '';
    target = target.replace(/^on\s+/i, '').trim();
    return { intent: 'right-click', target: target.toLowerCase() };
  }
  if (intent === 'TYPE') {
    const m = text.match(/^(?:type|write|enter|input)\s+(?:in(?:to)?\s+(.+?)\s+)?["']?(.+)["']?$/i);
    return { intent: 'type', target: m && m[1] ? m[1] : null, value: m ? (m[2] || m[1] || '') : text };
  }
  if (intent === 'ZOOM_IN')    return { intent: 'zoom-in' };
  if (intent === 'ZOOM_OUT')   return { intent: 'zoom-out' };
  if (intent === 'ZOOM_RESET') return { intent: 'zoom-reset' };
  if (intent === 'COPY')  return { intent: 'copy' };
  if (intent === 'PASTE') return { intent: 'paste' };
  if (intent === 'CUT')   return { intent: 'cut' };
  if (intent === 'REDO')  return { intent: 'redo' };

  if (intent === 'KEYBOARD') {
    const m = text.match(/^(?:press|hit|type key)\s+(.+)$/i);
    const key = m ? m[1].toLowerCase().replace(/\s+/g, '') : '';
    const keyMap = { esc: 'escape', arrowup: 'arrowup', arrowdown: 'arrowdown', arrowleft: 'arrowleft', arrowright: 'arrowright' };
    return { intent: 'keyboard', key: keyMap[key] || key };
  }
  if (intent === 'SELECT_ALL') return { intent: 'select-all' };
  if (intent === 'SCROLL_INTO_VIEW') {
    const m = text.match(/^(?:scroll\s+to|bring\s+into\s+view|show|find\s+and\s+show)\s+(.+)$/i);
    return { intent: 'scroll-into-view', target: m ? m[1].toLowerCase() : '' };
  }
  if (intent === 'WINDOW_FOCUS') return { intent: 'window-focus' };

  // ── Scroll ─────────────────────────────────────────────────────────────────
  if (intent === 'SCROLL') {
    if (/^(?:go\s*down|godown)$/i.test(text)) return { intent: 'scroll', direction: 'down' };
    if (/^(?:go\s*up|goup)$/i.test(text)) return { intent: 'scroll', direction: 'up' };
    if (/^(?:go\s*left|goleft)$/i.test(text)) return { intent: 'scroll', direction: 'left' };
    if (/^(?:go\s*right|goright)$/i.test(text)) return { intent: 'scroll', direction: 'right' };
    if (/^(?:go\s*top|gotop)$/i.test(text)) return { intent: 'scroll', direction: 'top' };
    if (/^(?:go\s*bottom|gobottom)$/i.test(text)) return { intent: 'scroll', direction: 'bottom' };

    const pageM = text.match(/^page\s+(up|down|left|right)$/i);
    if (pageM) return { intent: 'scroll', direction: `page-${pageM[1].toLowerCase()}` };

    // Scroll with explicit amount: e.g. "scroll 2", "scroll down 500", "scroll 300 px up"
    const amtMatch = text.match(/^(?:scroll|move|slide)\s+(?:(up|down|left|right)\s+)?(\d+)(?:\s*(?:px|pixels?))?(?:\s+(up|down|left|right))?$/i);
    if (amtMatch) {
      const dir = (amtMatch[1] || amtMatch[3] || 'down').toLowerCase();
      const amt = parseInt(amtMatch[2], 10);
      return { intent: 'scroll', direction: dir, amount: amt };
    }

    const raw = text.replace(/^(?:scroll|move|slide|go|travel)\s+(?:to\s+)?(?:the\s+)?/i, '').trim();
    const dirMap = {
      up: 'up', upward: 'up', upwards: 'up',
      down: 'down', downward: 'down', downwards: 'down',
      left: 'left', leftward: 'left',
      right: 'right', rightward: 'right',
      top: 'top', beginning: 'top', start: 'top', head: 'top',
      bottom: 'bottom', end: 'bottom', last: 'bottom', finish: 'bottom',
      'page-up': 'page-up', 'page-down': 'page-down',
      'page-left': 'page-left', 'page-right': 'page-right',
    };

    const dir = dirMap[raw] || (text.match(/\b(up|down|left|right|bottom|top)\b/i) || [])[1]?.toLowerCase() || 'down';
    return { intent: 'scroll', direction: dir };
  }

  // ── DOM Actions (Click, Hover, Open, Read) ─────────────────────────────────
  if (intent === 'CLICK') {
    if (/^(?:add\s+to\s+cart)$/i.test(text)) return { intent: 'click', target: 'add to cart' };
    if (/^(?:checkout)$/i.test(text)) return { intent: 'click', target: 'checkout' };
    const match = text.match(/^(?:click|tap|select|press|choose)(?:\s+(?:button|link))?\s+(.+)$/i);
    let target = match ? match[1].trim() : '';
    target = target.replace(/^on\s+/i, '').replace(/^(?:the\s+button\s+|the\s+link\s+)/i, '').trim();
    return { intent: 'click', target: target.toLowerCase() };
  }
  if (intent === 'HOVER') {
    const match = text.match(/^(?:hover|focus)(?:\s+over|\s+on)?\s+(.+)$/i);
    let target = match ? match[1].trim() : '';
    target = target.replace(/^on\s+/i, '').trim();
    return { intent: 'hover', target: target.toLowerCase() };
  }
  if (intent === 'OPEN') {
    const match = text.match(/^open\s+(.+)$/i);
    let target = match ? match[1].trim() : '';
    target = target.replace(/^on\s+/i, '').trim();
    return { intent: 'open', target: target.toLowerCase() };
  }
  if (intent === 'READ') {
    return { intent: 'read' };
  }

  // ── Kept System Intents ────────────────────────────────────────────────────
  if (intent === 'UNDO') return { intent: 'undo', type: 'UNDO' };
  if (intent === 'ENTER_CHAT_MODE') return { intent: 'chat-mode', type: 'ENTER_CHAT_MODE', action: 'enter' };
  if (intent === 'EXIT_CHAT_MODE')  return { intent: 'chat-mode', type: 'EXIT_CHAT_MODE', action: 'exit' };
  if (intent === 'SELF_INTRO')      return { intent: 'self-intro', type: 'SELF_INTRO' };

  return { intent: 'unknown', type: 'UNKNOWN' };
}
