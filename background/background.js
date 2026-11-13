/**
 * background.js — EcoVoice Extension Service Worker
 *
 * Handles tab management commands forwarded from ActionEngine,
 * LLM fallback parsing via Groq, plus extension lifecycle events.
 */

// ── LLM Service Configuration (Phase 3) ───────────────────────────────────────

const GROQ_MODEL = 'openai/gpt-oss-20b'; // alternative: 'openai/gpt-oss-120b'
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const SYSTEM_PROMPT = "You convert ONE spoken browser command into ONE JSON object. The text comes from speech recognition: it may contain mishearings and Hindi/Hinglish. Output ONLY the JSON object, no prose, no markdown. If the text is not clearly a browser action, output {\"intent\":\"unknown\"}. Never invent a target the user did not imply. If the text is clearly a browser action but a required piece is missing or vague (e.g. click/open with only 'it', 'this', 'that', 'the button', 'the link', no name), output {\"intent\":\"clarify\",\"message\":\"<one short question, max 12 words, ALWAYS in simple English>\"}. Clarify ONLY for incomplete browser actions. Chit-chat or unrelated questions -> {\"intent\":\"unknown\"}, never clarify. If a previous question and the user's answer are present, combine them into ONE complete command. If the answer is itself a new complete command, ignore the earlier request and output the new command. If the answer is still unusable, output unknown (do not ask a second question about the same thing). Allowed outputs: {intent:scroll,direction}, {intent:click|open|double-click|right-click|hover|scroll-into-view,target}, {intent:type,target,value}, {intent:navigate,action:back|forward|reload|home}, {intent:tab,action:new|close|next|previous}, {intent:zoom-in|zoom-out|zoom-reset|copy|paste|cut|undo|redo|select-all|read|help}, {intent:search,query}, {intent:clarify,message}, {intent:unknown}. Examples: 'take me to the cart' -> {\"intent\":\"click\",\"target\":\"cart\"}; 'neeche jao' -> {\"intent\":\"scroll\",\"direction\":\"down\"}; 'peeche jao' -> {\"intent\":\"navigate\",\"action\":\"back\"}; 'sabse niche jao' / 'page ke end tak jao' -> {\"intent\":\"scroll\",\"direction\":\"bottom\"}; 'sabse upar jao' / 'sabse oopar jao' -> {\"intent\":\"scroll\",\"direction\":\"top\"}; 'wapas jao' -> {\"intent\":\"navigate\",\"action\":\"back\"}; 'naya tab kholo' -> {\"intent\":\"tab\",\"action\":\"new\"}; 'zoom badhao' -> {\"intent\":\"zoom-in\"}; 'zoom kam karo' -> {\"intent\":\"zoom-out\"}; 'page padho' / 'page padh ke sunao' -> {\"intent\":\"read\"}; 'madad karo' -> {\"intent\":\"help\"}; 'click it' -> {\"intent\":\"clarify\",\"message\":\"Which button or link should I click?\"}; 'what is the weather' -> {\"intent\":\"unknown\"}.";

/**
 * Strict validator for LLM command outputs.
 * Whitelists allowed intents/properties and prevents prototype or injection payloads.
 *
 * @param {any} obj - Parsed JSON candidate
 * @returns {Object} Validated command or { intent: 'unknown', type: 'UNKNOWN' }
 */
function validateLlmCommand(obj) {
  const UNKNOWN = { intent: 'unknown', type: 'UNKNOWN' };
  if (!obj || typeof obj !== 'object' || typeof obj.intent !== 'string') {
    return UNKNOWN;
  }

  const intent = obj.intent.trim().toLowerCase();

  // 1. Scroll
  if (intent === 'scroll') {
    const validDirs = ['up', 'down', 'left', 'right', 'top', 'bottom', 'page-up', 'page-down'];
    if (typeof obj.direction === 'string') {
      const dir = obj.direction.trim().toLowerCase();
      if (validDirs.includes(dir)) {
        return { intent: 'scroll', direction: dir };
      }
    }
    return UNKNOWN;
  }

  // 2. Click / Open / Double-Click / Right-Click / Hover / Scroll-into-view
  const clickTypeIntents = ['click', 'open', 'double-click', 'right-click', 'hover', 'scroll-into-view'];
  if (clickTypeIntents.includes(intent)) {
    if (typeof obj.target === 'string') {
      const target = obj.target.trim().toLowerCase().slice(0, 80);
      if (target.length > 0) {
        return { intent, target };
      }
    }
    return UNKNOWN;
  }

  // 3. Type
  if (intent === 'type') {
    let target = null;
    if (typeof obj.target === 'string') {
      target = obj.target.trim().toLowerCase().slice(0, 80);
    } else if (obj.target !== null && obj.target !== undefined) {
      return UNKNOWN;
    }
    if (typeof obj.value === 'string') {
      const value = obj.value.slice(0, 200);
      if (value.trim().length > 0) {
        return { intent: 'type', target, value };
      }
    }
    return UNKNOWN;
  }

  // 4. Navigate
  if (intent === 'navigate') {
    const validNavActions = ['back', 'forward', 'reload', 'home'];
    if (typeof obj.action === 'string') {
      const act = obj.action.trim().toLowerCase();
      if (validNavActions.includes(act)) {
        return { intent: 'navigate', action: act };
      }
    }
    return UNKNOWN;
  }

  // 5. Tab
  if (intent === 'tab') {
    const validTabActions = ['new', 'close', 'next', 'previous'];
    if (typeof obj.action === 'string') {
      const act = obj.action.trim().toLowerCase();
      if (validTabActions.includes(act)) {
        return { intent: 'tab', action: act };
      }
    }
    return UNKNOWN;
  }

  // 6. Parameterless browser actions
  const simpleIntents = [
    'zoom-in', 'zoom-out', 'zoom-reset',
    'copy', 'paste', 'cut',
    'undo', 'redo',
    'select-all', 'read'
  ];
  if (simpleIntents.includes(intent)) {
    return { intent };
  }

  // 7. Help
  if (intent === 'help') {
    return { intent: 'help', type: 'SHOW_HELP' };
  }

  // 8. Search -> normalized to Google navigation
  if (intent === 'search') {
    if (typeof obj.query === 'string' && obj.query.trim().length > 0) {
      return {
        intent: 'navigate',
        action: 'url',
        url: 'https://www.google.com/search?q=' + encodeURIComponent(obj.query.trim())
      };
    }
    return UNKNOWN;
  }

  // 9. Clarify
  if (intent === 'clarify') {
    if (typeof obj.message === 'string') {
      const msg = obj.message.replace(/\s+/g, ' ').trim().slice(0, 120);
      if (msg.length > 0) {
        return { intent: 'clarify', type: 'CLARIFY', message: msg };
      }
    }
    return UNKNOWN;
  }

  return UNKNOWN;
}

// ── Tab Management (Phase 5A) ──────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'TAB_ACTION') return;

  const action = message.action;

  chrome.tabs.query({ currentWindow: true }, (allTabs) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
      const current = activeTabs[0];
      if (!current) return;

      const sorted = allTabs.sort((a, b) => a.index - b.index);
      const idx = sorted.findIndex((t) => t.id === current.id);

      switch (action) {
        case 'new':
          chrome.tabs.create({ active: true });
          break;
        case 'close':
          chrome.tabs.remove(current.id);
          break;
        case 'next': {
          const next = sorted[(idx + 1) % sorted.length];
          chrome.tabs.update(next.id, { active: true });
          break;
        }
        case 'previous': {
          const prev = sorted[(idx - 1 + sorted.length) % sorted.length];
          chrome.tabs.update(prev.id, { active: true });
          break;
        }
        case 'reload':
          chrome.tabs.reload(current.id);
          break;
        default:
          console.warn('[EcoVoice BG] Unknown tab action:', action);
      }

      sendResponse({ ok: true });
    });
  });

  return true; // async response
});

// ── LLM Fallback Parser (Phase 3) ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'LLM_PARSE') return;

  (async () => {
    const startTime = Date.now();
    let controller = null;
    let timeoutId = null;

    try {
      const storage = await chrome.storage.local.get('groq_api_key');
      const apiKey = storage?.groq_api_key;
      if (!apiKey) {
        sendResponse({ ok: false, error: 'NO_KEY' });
        return;
      }

      controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 8000);

      let historyMessages = [];
      if (message.history && typeof message.history === 'object') {
        const orig = typeof message.history.originalText === 'string'
          ? message.history.originalText.trim().slice(0, 200)
          : '';
        const q = typeof message.history.question === 'string'
          ? message.history.question.trim().slice(0, 200)
          : '';
        if (orig.length > 0 && q.length > 0) {
          historyMessages = [
            { role: 'user', content: orig },
            { role: 'assistant', content: JSON.stringify({ intent: 'clarify', message: q }) }
          ];
        }
      }

      const response = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...historyMessages,
            { role: 'user', content: String(message.text || '') }
          ],
          temperature: 0.1,
          max_tokens: 1024,
          reasoning_effort: 'low'
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const latency = Date.now() - startTime;

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[EcoVoice LLM] HTTP error: status=${response.status}, model=${GROQ_MODEL}, latency=${latency}ms, body=${errText.slice(0, 300)}`);
        sendResponse({ ok: false, error: `HTTP_${response.status}` });
        return;
      }

      const resJson = await response.json();
      let rawContent = resJson.choices?.[0]?.message?.content || '';

      // Strip ``` fences
      rawContent = rawContent.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

      // Extract JSON substring from first '{' to last '}'
      const firstBrace = rawContent.indexOf('{');
      const lastBrace = rawContent.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
        console.warn(`[EcoVoice LLM] No JSON object found in response: model=${GROQ_MODEL}, latency=${latency}ms`);
        sendResponse({ ok: false, error: 'INVALID_JSON' });
        return;
      }

      let parsedObj;
      try {
        parsedObj = JSON.parse(rawContent.slice(firstBrace, lastBrace + 1));
      } catch (jsonErr) {
        console.warn(`[EcoVoice LLM] JSON parse failure: model=${GROQ_MODEL}, latency=${latency}ms`, jsonErr);
        sendResponse({ ok: false, error: 'JSON_PARSE_ERROR' });
        return;
      }

      const validatedCommand = validateLlmCommand(parsedObj);
      console.log(`[EcoVoice LLM] model=${GROQ_MODEL}, status=${response.status}, latency=${latency}ms, command=`, validatedCommand);
      sendResponse({ ok: true, command: validatedCommand });

    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      const latency = Date.now() - startTime;
      const isTimeout = err.name === 'AbortError';
      const errorMsg = isTimeout ? 'TIMEOUT' : (err.message || 'UNKNOWN_ERROR');
      console.error(`[EcoVoice LLM] Request failed: model=${GROQ_MODEL}, latency=${latency}ms, error=${errorMsg}`);
      sendResponse({ ok: false, error: errorMsg });
    }
  })();

  return true; // async response
});

// ── Extension Lifecycle & Security Rules Initialization ───────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[EcoVoice] Extension installed / updated — initializing security rules...');

  try {
    // Resolve the absolute URL of rules.json inside the extension bundle.
    const rulesUrl = chrome.runtime.getURL('rules.json');

    // Fetch the rules file asynchronously.
    const response = await fetch(rulesUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch rules.json — HTTP ${response.status} ${response.statusText}`);
    }

    // Parse the JSON payload.
    const rules = await response.json();

    // Cache into local storage under a well-known key so any content script
    // or background handler can read it without re-fetching.
    await chrome.storage.local.set({ security_rules: rules });

    console.info(
      `[EcoVoice] Security rules v${rules.version} cached successfully.`,
      `Global keywords: ${rules.global_rules?.restricted_keywords?.length ?? 0},`,
      `Domain rules: ${Object.keys(rules.domain_rules ?? {}).join(', ') || 'none'}`
    );
  } catch (err) {
    console.error('[EcoVoice] Failed to initialize security rules:', err);
  }
});
