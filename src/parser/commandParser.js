/**
 * commandParser.js — EcoVoice Command Engine  (Phase 3)
 * -------------------------------------------------------
 * Rule-based natural language parser. No external AI APIs are used.
 *
 * Architecture is intentionally modular so a future Gemini/AI integration can
 * replace `detectIntent` + `runExtractors` with API calls while keeping the
 * same public `parseCommand` interface.
 *
 * Pipeline:
 *   1. Normalise raw transcript text.
 *   2. Run intent-detection rules in priority order (first match wins).
 *   3. For a matched intent, run extraction rules to pull the payload.
 *   4. Optionally detect priority signal (high / normal) embedded in the text.
 *   5. Return a structured result object.
 *
 * Supported intents (in rule evaluation order):
 *   SET_PRIORITY    — user wants to change the priority of a task
 *   PIN_TASK        — user wants to pin / float a task to the top
 *   UNPIN_TASK      — user wants to unpin a task
 *   COMPLETE_TASK   — user wants to mark a task done
 *   UNCOMPLETE_TASK — user wants to revert a task to pending
 *   DELETE_TASK     — user wants to remove a task
 *   CREATE_TASK     — user wants to add a task
 *   UNKNOWN         — no intent matched
 *
 * Return shapes:
 *   { type: 'SET_PRIORITY',    query: string, priority: 'high'|'normal' }
 *   { type: 'PIN_TASK',        query: string }
 *   { type: 'UNPIN_TASK',      query: string }
 *   { type: 'COMPLETE_TASK',   query: string }
 *   { type: 'UNCOMPLETE_TASK', query: string }
 *   { type: 'DELETE_TASK',     query: string }
 *   { type: 'CREATE_TASK',     task: string, priority: 'high'|'normal' }
 *   { type: 'UNKNOWN' }
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
    .replace(/[.!?]+$/, '');
}

// ---------------------------------------------------------------------------
// 2. PRIORITY SIGNAL DETECTION
// ---------------------------------------------------------------------------

/**
 * Scan normalised text for explicit priority signals.
 * Returns 'high' or 'normal'.
 * Used both by SET_PRIORITY extraction and by CREATE_TASK to embed priority.
 *
 * @param {string} text — normalised
 * @returns {'high'|'normal'}
 */
function detectPriority(text) {
  const HIGH_SIGNALS = [
    /\b(high\s*priority|urgent|important|critical|asap|top\s*priority|must\s*do|starred|pinned)\b/i,
  ];
  return HIGH_SIGNALS.some((p) => p.test(text)) ? 'high' : 'normal';
}

// ---------------------------------------------------------------------------
// 3. INTENT DETECTION RULES
// ---------------------------------------------------------------------------

/**
 * Each rule:
 *   intent   — string returned when this rule fires
 *   patterns — array of RegExp; ANY match fires the intent
 *
 * Ordering is critical — more specific intents must come before broad ones.
 *
 * Future AI integration point: replace this array with an async call to
 * a Gemini intent classifier. The parseCommand function already awaits no
 * async, so switching is a one-file change.
 */
const INTENT_RULES = [
  // ── PHASE 5A: NAVIGATION ──
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
  // ── PHASE 5B: BROWSER CAPABILITIES ──
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
  // ── PHASE 2/3/4 EXTENSION INTENTS ──
  {
    intent: 'SCROLL',
    patterns: [
      /^(?:scroll|go)\s+(?:to\s+)?(up|down|bottom|top)$/i,
      /^page\s+(up|down)$/i,
      /^scroll\s+(?:a\s+bit|slightly|a\s+little|more|a\s+lot|completely)$/i,
    ]
  },
  {
    intent: 'CLICK',
    patterns: [
      /^(?:click|tap|select)(?:\s+button)?\s+(.+)$/i
    ]
  },
  {
    intent: 'HOVER',
    patterns: [
      /^(?:hover|focus)(?:\s+over)?\s+(.+)$/i
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

  // ── D1 UNDO ── must be FIRST to avoid collision with UNCOMPLETE_TASK
  {
    intent: 'UNDO',
    patterns: [
      /^undo$/i,
      /^undo\s+(last|that|it)$/i,
      /^revert\s+(last|that)?\s*(action)?$/i,
      /^take\s+that\s+back$/i,
    ],
  },

  // ── Bug 2: CLEAR_SEARCH — must come BEFORE SEARCH_TASKS ——————————————
  {
    intent: 'CLEAR_SEARCH',
    patterns: [
      /^show\s+all(\s+tasks?)?$/i,
      /^clear\s+search$/i,
      /^reset\s+search$/i,
      /^show\s+everything$/i,
    ],
  },

  // ── D3 SEARCH_TASKS ───────────────────────────────────────────────────────
  {
    intent: 'SEARCH_TASKS',
    patterns: [
      /^(find|search|look\s+for)\b/i,
      /^search\s+for\b/i,
    ],
  },

  // ── E1 ENTER_CHAT_MODE ────────────────────────────────────────────────────
  {
    intent: 'ENTER_CHAT_MODE',
    patterns: [
      /^(enter|start|activate|switch\s+to)\s+chat\s+mode$/i,
      /^chat\s+mode$/i,
    ],
  },

  // ── E2 EXIT_CHAT_MODE ─────────────────────────────────────────────────────
  {
    intent: 'EXIT_CHAT_MODE',
    patterns: [
      /^(exit|leave|stop|deactivate)\s+chat\s+mode$/i,
      /^(task\s+mode|back\s+to\s+task(s|\s+mode)?)$/i,
    ],
  },

  // ── E3 SELF_INTRO ─────────────────────────────────────────────────────────
  {
    intent: 'SELF_INTRO',
    patterns: [
      /^(who\s+are\s+you|what\s+are\s+you|introduce\s+yourself)$/i,
      /^tell\s+me\s+about\s+yourself$/i,
    ],
  },

  // ── SET_PRIORITY ──────────────────────────────────────────────────────────
  // Must appear before PIN_TASK and CREATE_TASK so explicit priority phrases
  // are routed here and don't create duplicate tasks or accidental pins.
  {

    intent: 'SET_PRIORITY',
    patterns: [
      // "mark study DSA high priority" / "mark groceries as urgent"
      /\bmark\b.{0,25}\b(high\s*priority|urgent|critical|top\s*priority)\b/i,

      // "set call mom as high priority"
      /\bset\b.{0,25}\bas\s+(high\s*priority|urgent|critical)\b/i,

      // "make DSA high priority" — but NOT "make DSA important" (that's PIN_TASK)
      /\bmake\b.{0,25}\b(high\s*priority|urgent|critical)\b/i,

      // "lower priority of groceries" / "set groceries to normal"
      /\b(lower|reduce|decrease)\b.{0,15}\bpriority\b/i,
      /\bset\b.{0,25}\bto\s+(normal|low)\s*priority\b/i,
    ],
  },

  // ── PIN_ALL_TASKS ──────────────────────────────────────────────────────────
  // MUST appear before PIN_TASK — more specific.
  {
    intent: 'PIN_ALL_TASKS',
    patterns: [
      /^pin\s+all(\s+tasks?)?$/i,
      /^star\s+all(\s+tasks?)?$/i,
      /^mark\s+all(\s+tasks?)?\s+(as\s+)?(important|pinned|starred)$/i,
    ],
  },

  // ── UNPIN_ALL_TASKS ────────────────────────────────────────────────────────
  // MUST appear before UNPIN_TASK — more specific.
  {
    intent: 'UNPIN_ALL_TASKS',
    patterns: [
      /^unpin\s+all(\s+tasks?)?$/i,
      /^unstar\s+all(\s+tasks?)?$/i,
      /^mark\s+all(\s+tasks?)?\s+(as\s+)?(normal|unpinned|unstarred)$/i,
    ],
  },

  // ── PIN_TASK ───────────────────────────────────────────────────────────────
  {
    intent: 'PIN_TASK',
    patterns: [
      /^pin\b/i,
      /\bmark\b.{0,20}\b(important|pinned|starred)\b/i,
      /\bmake\b.{0,20}\b(important|pinned|starred)\b/i,
      /\bset\b.{0,20}\bas\s+(important|pinned|starred)\b/i,
      /^prioriti[sz]e\b/i,
      /^star\b/i,
    ],
  },

  // ── UNPIN_TASK ─────────────────────────────────────────────────────────────
  {
    intent: 'UNPIN_TASK',
    patterns: [
      /^unpin\b/i,
      /\bmark\b.{0,20}\b(normal|unpinned|unstarred|deprioritized)\b/i,
      /\bremove\b.{0,10}\b(priority|importance|pin|star)\b.{0,10}\bfrom\b/i,
      /^unstar\b/i,
      /^deprioritiz[e]?\b/i,
    ],
  },

  // ── COMPLETE_TASK ──────────────────────────────────────────────────────────
  {
    intent: 'COMPLETE_TASK',
    patterns: [
      /^(complete|finish)\b/i,
      /\bmark\b.{0,20}\b(complete|completed|done|finished)\b/i,
      /\bset\b.{0,20}\bas\s+(done|complete|completed|finished)\b/i,
    ],
  },

  // ── UNCOMPLETE_TASK ────────────────────────────────────────────────────────
  // NOTE: "undo" alone is handled by the UNDO intent above.
  // Only "uncomplete", "unfinish" and explicit mark-as-pending phrases here.
  {
    intent: 'UNCOMPLETE_TASK',
    patterns: [
      /^(uncomplete|unfinish)\b/i,
      /\bmark\b.{0,20}\b(pending|incomplete|undone|not\s+done)\b/i,
      /\bset\b.{0,20}\bas\s+(pending|incomplete|undone|not\s+done)\b/i,
    ],
  },

  // ── DELETE_ALL_TASKS ───────────────────────────────────────────────────────
  // MUST appear before DELETE_TASK — more specific, catches bulk commands first.
  {
    intent: 'DELETE_ALL_TASKS',
    patterns: [
      /^(permanently\s+)?delete\s+all(\s+tasks?)?$/i,
      /^remove\s+all(\s+tasks?)?$/i,
      /^clear\s+all(\s+tasks?)?$/i,
      /^wipe(\s+(all\s+)?tasks?)?$/i,
      /^erase\s+all(\s+tasks?)?$/i,
    ],
  },

  // ── COMPLETE_ALL_TASKS ─────────────────────────────────────────────────────
  // MUST appear before COMPLETE_TASK — more specific.
  {
    intent: 'COMPLETE_ALL_TASKS',
    patterns: [
      /^complete\s+all(\s+tasks?)?$/i,
      /^finish\s+all(\s+tasks?)?$/i,
      /^done\s+all(\s+tasks?)?$/i,
      /^mark\s+all(\s+tasks?)?\s+(as\s+)?(completed?|done|finished)$/i,
    ],
  },

  // ── ARCHIVE_ALL_TASKS ──────────────────────────────────────────────────────
  // MUST appear before other tasks.
  {
    intent: 'ARCHIVE_ALL_TASKS',
    patterns: [
      /^archive\s+all(\s+tasks?)?$/i,
      /^remove\s+all\s+tasks?\s+from\s+list\s+to\s+archive$/i,
      /^move\s+all\s+tasks?\s+to\s+archive$/i,
    ],
  },

  // ── DELETE_TASK ────────────────────────────────────────────────────────────
  {
    intent: 'DELETE_TASK',
    patterns: [
      /^(delete|remove|erase)\b/i,
      /\b(delete|remove|erase)\b.{0,10}\b(task|todo|reminder|item)\b/i,
    ],
  },

  // ── CREATE_TASK ────────────────────────────────────────────────────────────
  // This is the broadest intent — it catches everything that sounds like
  // "I need to do X" in natural speech, including indirect phrasings.
  {
    intent: 'CREATE_TASK',
    patterns: [
      // ── Explicit task-creation verbs ──────────────────────────────────────
      /\b(add|create|make|new)\b.{0,10}\b(task|todo|reminder|note|item)\b/i,

      // ── Scheduling ────────────────────────────────────────────────────────
      /^schedule\b/i,

      // ── Reminder phrases ──────────────────────────────────────────────────
      /\b(remind\s+me\s+(to|about|of)|reminder\s+(to|about|for|of))\b/i,
      /\bdon'?t\s+let\s+me\s+forget\b/i,
      /\bdon'?t\s+forget\s+(to|about)\b/i,

      // ── First-person necessity / intent ───────────────────────────────────
      /^i\s+need\s+(to\b)?/i,
      /^i\s+want\s+to\b/i,
      /^i\s+(should|must|have\s+to|got\s+to|will)\b/i,
      /^i\s+have\s+to\b/i,

      // ── "Tomorrow / tonight / today I need to …" ─────────────────────────
      /^(tomorrow|tonight|today|this\s+week|next\s+week)\b.{0,10}\bi\b/i,

      // ── Passive / third-person constructions ─────────────────────────────
      // "DSA needs to be completed" / "groceries need to be bought"
      /\bneeds?\s+to\s+be\b/i,
      // "this has to be done" / "it has to be finished"
      /\bhas\s+to\s+be\b/i,

      // ── Planning phrases ──────────────────────────────────────────────────
      /\bplan(ning)?\s+to\b/i,
      /\bgoing\s+to\b/i,
      /\bintend(ing)?\s+to\b/i,

      // ── Memory phrases ────────────────────────────────────────────────────
      /\b(need\s+to\s+)?remember\s+to\b/i,
      /\bkeep\s+in\s+mind\b/i,

      // ── "Make sure to / Make sure I" ─────────────────────────────────────
      /\bmake\s+sure\s+(to|i|that)\b/i,

      // ── Shopping / acquisition openers ───────────────────────────────────
      /^(buy|get|pick\s+up|order|purchase|grab)\b/i,

      // ── Action-verb openers (excluding complete/finish → COMPLETE_TASK) ──
      /^(do|start|begin|submit|send|call|email|message|pay|fix|clean|wash|check|read|watch|write|prepare|review|update|install|book|cancel|return|visit|meet|study|practice|learn|research|work\s+on|follow\s+up|contact|draft|upload|download|test|deploy|run|build)\b/i,

      // ── Generic task mentions ─────────────────────────────────────────────
      /\b(task\s+to|todo\s*:|need\s+to\b)/i,

      // ── "X is important" — implicit high-priority task creation ──────────
      /\bis\s+(important|urgent|critical)\b/i,

      // ── Bare noun phrases that sound like tasks (last resort) ─────────────
      // "DSA tomorrow" — single/multi-word followed by a time expression
      /\b(tomorrow|tonight|today|this\s+week|next\s+week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening)\b/i,
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
// 4. PAYLOAD EXTRACTION
// ---------------------------------------------------------------------------

// ── Shared helpers ────────────────────────────────────────────────────────

/**
 * Prefixes / filler words to strip from extracted task labels.
 * Applied at the end of extraction to clean up the final label.
 */
const LEADING_FILLER = [
  /^(a|an|the)\s+/i,           // articles
  /^(also|just|quickly)\s+/i,  // hedge words
];

const TRAILING_FILLER =
  /\b(please|now|asap|immediately|right\s+now|for\s+sure)\b\s*$/i;

/**
 * Temporal context words we strip from the BEGINNING of a label when they
 * are not the main topic. E.g. "tomorrow buy groceries" → "buy groceries".
 * They are kept when they are meaningful context: "call mom tomorrow".
 */
const LEADING_TEMPORAL =
  /^(tomorrow|tonight|today|this\s+week|next\s+week|on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday))\s+/i;

/**
 * Strip leading articles, temporals (when at start), and trailing fillers.
 *
 * @param {string} label
 * @returns {string}
 */
function cleanLabel(label) {
  let s = label.trim();
  // Strip leading temporal if it appears before an action verb — suggests the
  // temporal is a prefix, not the topic.
  s = s.replace(LEADING_TEMPORAL, '');
  LEADING_FILLER.forEach((r) => { s = s.replace(r, ''); });
  s = s.replace(TRAILING_FILLER, '').trim();
  return s;
}

/**
 * Run a list of extractors against normalised text.
 * Returns the first non-empty cleaned label, or null.
 *
 * When an extractor has TWO capture groups (action-verb patterns), the
 * groups are rejoined with a space: "buy" + "groceries" → "buy groceries".
 *
 * @param {RegExp[]} extractors
 * @param {string}   text — normalised
 * @returns {string|null}
 */
function runExtractors(extractors, text) {
  for (const extractor of extractors) {
    const match = text.match(extractor);
    if (!match) continue;

    const groups = match.slice(1).filter(Boolean);
    if (groups.length === 0) continue;

    const label = groups.length >= 2 ? groups.join(' ') : groups[0];
    const cleaned = cleanLabel(label);
    if (cleaned.length > 0) return cleaned;
  }
  return null;
}

// ── CREATE_TASK extractors ────────────────────────────────────────────────

/**
 * Ordered extractor list for CREATE_TASK.
 * Tries progressively less-specific patterns.
 * The LAST extractor is a time-aware bare-noun fallback.
 */
const TASK_CREATE_EXTRACTORS = [
  // Explicit task-noun prefix
  /\b(?:add|create|make|new)\b.{0,15}\b(?:task|todo|reminder|note|item)\b\s+(?:to\s+|for\s+|about\s+|:?\s*)(.+)/i,

  // Reminder phrases
  /\bremind\s+me\s+(?:to|about|of)\s+(.+)/i,
  /\breminder\s+(?:to|about|for|of)\s+(.+)/i,
  /\bdon'?t\s+let\s+me\s+forget\s+(?:to\s+|about\s+)?(.+)/i,
  /\bdon'?t\s+forget\s+(?:to|about)\s+(.+)/i,

  // Schedule
  /^schedule\s+(?:a\s+|an\s+)?(.+)/i,

  // First-person necessity
  /^i\s+need\s+to\s+(.+)/i,
  /^i\s+need\s+(.+)/i,
  /^i\s+want\s+to\s+(.+)/i,
  /^i\s+should\s+(.+)/i,
  /^i\s+must\s+(.+)/i,
  /^i\s+have\s+to\s+(.+)/i,
  /^i\s+got\s+to\s+(.+)/i,
  /^i\s+will\s+(.+)/i,

  // "Tomorrow/tonight I need to …" — temporal prefix + subject
  /^(?:tomorrow|tonight|today|this\s+week|next\s+week)\s+(?:i\s+)?(?:need\s+to\s+|have\s+to\s+|must\s+|should\s+|will\s+)?(.+)/i,

  // Passive: "DSA needs to be completed" → "DSA"
  /^(.+?)\s+needs?\s+to\s+be\b/i,
  /^(.+?)\s+has\s+to\s+be\b/i,

  // Planning
  /\bplan(?:ning)?\s+to\s+(.+)/i,
  /\bgoing\s+to\s+(.+)/i,
  /\bintend(?:ing)?\s+to\s+(.+)/i,

  // Memory
  /\b(?:need\s+to\s+)?remember\s+to\s+(.+)/i,
  /\bkeep\s+in\s+mind\s+(?:to\s+|that\s+)?(.+)/i,

  // "Make sure to/I/that …"
  /\bmake\s+sure\s+(?:to\s+|i\s+|that\s+)?(.+)/i,

  // "X is important" → extract X
  /^(.+?)\s+is\s+(?:important|urgent|critical)\b/i,

  // Action-verb openers (two-group: verb + rest → rejoin)
  /^(buy|get|pick\s+up|order|purchase|grab|do|start|begin|submit|send|call|email|message|pay|fix|clean|wash|check|read|watch|write|prepare|review|update|install|book|cancel|return|visit|meet|study|practice|learn|research|work\s+on|follow\s+up|contact|draft|upload|download|test|deploy|run|build)\s+(.+)/i,
];

// ── COMPLETE_TASK extractors ──────────────────────────────────────────────

const TASK_COMPLETE_EXTRACTORS = [
  /\bmark\s+(.+?)\s+(?:as\s+)?(?:complete|completed|done|finished)\b/i,
  /\bset\s+(.+?)\s+as\s+(?:done|complete|completed|finished)\b/i,
  /^(?:complete|finish)\s+(.+)/i,
];

// ── UNCOMPLETE_TASK extractors ────────────────────────────────────────────

const TASK_UNCOMPLETE_EXTRACTORS = [
  /\bmark\s+(.+?)\s+(?:as\s+)?(?:pending|incomplete|undone|not\s+done)\b/i,
  /\bset\s+(.+?)\s+as\s+(?:pending|incomplete|undone|not\s+done)\b/i,
  /^(?:uncomplete|unfinish|undo)\s+(.+)/i,
];

// ── PIN_TASK extractors ───────────────────────────────────────────────────

const TASK_PIN_EXTRACTORS = [
  /\bmark\s+(.+?)\s+(?:as\s+)?(?:important|pinned|starred)\b/i,
  /\bmake\s+(.+?)\s+(?:important|pinned|starred)\b/i,
  /\bset\s+(.+?)\s+as\s+(?:important|pinned|starred)\b/i,
  /^(?:pin|star|prioriti[sz]e)\s+(.+)/i,
];

// ── UNPIN_TASK extractors ─────────────────────────────────────────────────

const TASK_UNPIN_EXTRACTORS = [
  /\bmark\s+(.+?)\s+(?:as\s+)?(?:normal|unpinned|unstarred|deprioritized)\b/i,
  /\bremove\b.{0,10}\b(?:priority|importance|pin|star)\b.{0,10}\bfrom\s+(.+)/i,
  /^(?:unpin|unstar|deprioritiz[e]?)\s+(.+)/i,
];

// ── DELETE_TASK extractors ────────────────────────────────────────────────

const TASK_DELETE_EXTRACTORS = [
  /\b(?:delete|remove|erase)\b.{0,15}\b(?:task|todo|reminder|item)\b\s+(?:called\s+|named\s+|:?\s*)(.+)/i,
  /^(?:delete|remove|erase)\s+(.+)/i,
];

// ── SET_PRIORITY extractors ───────────────────────────────────────────────

const TASK_SET_PRIORITY_EXTRACTORS = [
  // "mark study DSA high priority" → "study DSA"
  /\bmark\s+(.+?)\s+(?:as\s+)?(?:high\s*priority|urgent|critical|top\s*priority)\b/i,
  // "set DSA as high priority" → "DSA"
  /\bset\s+(.+?)\s+as\s+(?:high\s*priority|urgent|critical)\b/i,
  // "make DSA high priority" → "DSA"
  /\bmake\s+(.+?)\s+(?:high\s*priority|urgent|critical)\b/i,
  // "lower priority of groceries" → "groceries"
  /\b(?:lower|reduce|decrease)\s+priority\s+(?:of\s+)?(.+)/i,
  // "set groceries to normal priority" → "groceries"
  /\bset\s+(.+?)\s+to\s+(?:normal|low)\s*priority\b/i,
];

// ── Payload extractors ────────────────────────────────────────────────────

function extractCreatePayload(text) {
  return runExtractors(TASK_CREATE_EXTRACTORS, text) ?? cleanLabel(text);
}

function extractDeletePayload(text) {
  return runExtractors(TASK_DELETE_EXTRACTORS, text)
    ?? cleanLabel(text.replace(/^\S+\s*/, ''));
}

function extractCompletePayload(text) {
  return runExtractors(TASK_COMPLETE_EXTRACTORS, text)
    ?? cleanLabel(text.replace(/^\S+\s*/, ''));
}

function extractUncompletePayload(text) {
  return runExtractors(TASK_UNCOMPLETE_EXTRACTORS, text)
    ?? cleanLabel(text.replace(/^\S+\s*/, ''));
}

function extractPinPayload(text) {
  return runExtractors(TASK_PIN_EXTRACTORS, text)
    ?? cleanLabel(text.replace(/^\S+\s*/, ''));
}

function extractUnpinPayload(text) {
  return runExtractors(TASK_UNPIN_EXTRACTORS, text)
    ?? cleanLabel(text.replace(/^\S+\s*/, ''));
}

function extractSetPriorityPayload(text) {
  return runExtractors(TASK_SET_PRIORITY_EXTRACTORS, text)
    ?? cleanLabel(text.replace(/^\S+\s*/, ''));
}

// ---------------------------------------------------------------------------
// 5. PUBLIC API
// ---------------------------------------------------------------------------

/**
 * Parse a raw speech transcript into a structured command object.
 *
 * This is the single entry point consumed by App.jsx.
 * Future AI integration: replace the body of this function with an async
 * call to Gemini/Claude while preserving the return shape contract.
 *
 * @param {string} rawText — the recognised speech string from the browser
 * @returns {CommandResult}
 *
 * @example
 *   parseCommand("I need to study DSA")
 *   // → { type: 'CREATE_TASK', task: 'study DSA', priority: 'normal' }
 *
 *   parseCommand("mark study DSA high priority")
 *   // → { type: 'SET_PRIORITY', query: 'study DSA', priority: 'high' }
 *
 *   parseCommand("DSA needs to be completed")
 *   // → { type: 'CREATE_TASK', task: 'DSA', priority: 'normal' }
 *
 *   parseCommand("pin buy groceries")
 *   // → { type: 'PIN_TASK', query: 'buy groceries' }
 */
export function parseCommand(rawText) {
  if (!rawText || typeof rawText !== 'string' || rawText.trim() === '') {
    return { type: 'UNKNOWN' };
  }

  const text = normalise(rawText);

  // A6 — HELP intent: checked before all other rules
  const HELP_PATTERNS = [
    /^help$/i,
    /^(show|list)\s+commands?/i,
    /^what\s+can\s+you\s+do/i,
    /^guide\s+me/i,
    /^how\s+does\s+this\s+work/i,
    /^show\s+help/i,
  ];
  if (HELP_PATTERNS.some((p) => p.test(text))) {
    return { type: 'SHOW_HELP' };
  }

  // Detect intent — first matching rule wins.
  const intent = detectIntent(text);

  // ── Phase 5A: Navigation ────────────────────────────────────────────────────
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

  // ── Phase 5B: Browser capabilities ─────────────────────────────────────────
  if (intent === 'DOUBLE_CLICK') {
    const m = text.match(/^(?:double.?click|double.?tap)\s+(.+)$/i);
    return { intent: 'double-click', target: m ? m[1].toLowerCase() : '' };
  }
  if (intent === 'RIGHT_CLICK') {
    const m = text.match(/^(?:right.?click|context\s+menu)(?:\s+on)?\s+(.+)$/i);
    return { intent: 'right-click', target: m ? m[1].toLowerCase() : '' };
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

  // ── Phase 2/3/4 Extension Intents ──────────────────────────────────────────────
  if (intent === 'SCROLL') {
    const match = text.match(/(up|down|bottom|top)/i);
    return { intent: 'scroll', direction: match ? match[1].toLowerCase() : 'down' };
  }
  if (intent === 'CLICK') {
    const match = text.match(/^(?:click|tap|select)(?:\s+button)?\s+(.+)$/i);
    return { intent: 'click', target: match ? match[1].toLowerCase() : '' };
  }
  if (intent === 'HOVER') {
    const match = text.match(/^(?:hover|focus)(?:\s+over)?\s+(.+)$/i);
    return { intent: 'hover', target: match ? match[1].toLowerCase() : '' };
  }
  if (intent === 'OPEN') {
    const match = text.match(/^open\s+(.+)$/i);
    return { intent: 'open', target: match ? match[1].toLowerCase() : '' };
  }
  if (intent === 'READ') {
    return { intent: 'read' };
  }

  // ── Simple intents: no payload extraction needed ───────────────────────────
  if (intent === 'UNDO') return { type: 'UNDO' };
  if (intent === 'ENTER_CHAT_MODE') return { type: 'ENTER_CHAT_MODE' };
  if (intent === 'EXIT_CHAT_MODE')  return { type: 'EXIT_CHAT_MODE' };
  if (intent === 'SELF_INTRO')      return { type: 'SELF_INTRO' };
  if (intent === 'DELETE_ALL_TASKS')  return { type: 'DELETE_ALL_TASKS' };
  if (intent === 'COMPLETE_ALL_TASKS') return { type: 'COMPLETE_ALL_TASKS' };
  if (intent === 'ARCHIVE_ALL_TASKS') return { type: 'ARCHIVE_ALL_TASKS' };
  if (intent === 'PIN_ALL_TASKS') return { type: 'PIN_ALL_TASKS' };
  if (intent === 'UNPIN_ALL_TASKS') return { type: 'UNPIN_ALL_TASKS' };
  if (intent === 'CLEAR_SEARCH')    return { type: 'CLEAR_SEARCH' };  // Bug 2

  // ── D3 SEARCH_TASKS: extract query after keyword ───────────────────────────
  if (intent === 'SEARCH_TASKS') {
    const q = text
      .replace(/^(find|search\s+for|search|look\s+for|show)\s*/i, '')
      .replace(/\s+tasks?$/i, '')
      .trim();
    return { type: 'SEARCH_TASKS', query: q };
  }

  // ── Helper: return MISSING_TASK_TARGET if extracted query is empty ──────────
  const MISSING_PROMPTS = {
    SET_PRIORITY: 'Which task should I update the priority for?',
    PIN_TASK: 'Which task would you like to pin?',
    UNPIN_TASK: 'Which task should I unpin?',
    COMPLETE_TASK: 'Which task should I mark as complete?',
    UNCOMPLETE_TASK: 'Which task would you like to move back to pending?',
    DELETE_TASK: 'Which task would you like me to delete?',
  };

  function guardQuery(type, query) {
    const q = (query ?? '').trim();
    if (!q) {
      return {
        type: 'MISSING_TASK_TARGET',
        intent: type,
        prompt: MISSING_PROMPTS[type] ?? 'Which task did you mean?',
      };
    }
    return null; // valid
  }

  if (intent === 'SET_PRIORITY') {
    const priority = detectPriority(text);
    const query = extractSetPriorityPayload(text);
    return guardQuery('SET_PRIORITY', query)
      ?? { type: 'SET_PRIORITY', query, priority };
  }

  if (intent === 'PIN_TASK') {
    const query = extractPinPayload(text);
    return guardQuery('PIN_TASK', query)
      ?? { type: 'PIN_TASK', query };
  }

  if (intent === 'UNPIN_TASK') {
    const query = extractUnpinPayload(text);
    return guardQuery('UNPIN_TASK', query)
      ?? { type: 'UNPIN_TASK', query };
  }

  if (intent === 'COMPLETE_TASK') {
    const query = extractCompletePayload(text);
    return guardQuery('COMPLETE_TASK', query)
      ?? { type: 'COMPLETE_TASK', query };
  }

  if (intent === 'UNCOMPLETE_TASK') {
    const query = extractUncompletePayload(text);
    return guardQuery('UNCOMPLETE_TASK', query)
      ?? { type: 'UNCOMPLETE_TASK', query };
  }

  if (intent === 'DELETE_TASK') {
    const query = extractDeletePayload(text);
    return guardQuery('DELETE_TASK', query)
      ?? { type: 'DELETE_TASK', query };
  }

  if (intent === 'CREATE_TASK') {
    const priority = detectPriority(text);
    return { type: 'CREATE_TASK', task: extractCreatePayload(text), priority };
  }

  return { type: 'UNKNOWN' };
}
