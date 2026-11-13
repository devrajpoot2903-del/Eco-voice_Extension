/**
 * content.js — EcoVoice Extension Content Script
 *
 * Phase 4–5: HUD, Dispatcher → ActionEngine, DOM Runtime,
 * session persistence, Navigation Manager integration,
 * follow-up context memory, Phase 5A–5E features.
 */

console.log('[EcoVoice] content.js loaded');

// ─── Module references (populated by initRuntime) ────────────────────────────
let _ActionEngine   = null;
let _DOMReader      = null;
let _resolveFollowUp = null;
let _updateContext   = null;
let _parseCommand    = null;
let _speakText       = null;
let _llmBusy         = false;
let _clarifyState    = null; // {originalText, question, round, url, timerId}

function clearClarifyState() {
  if (_clarifyState) {
    if (_clarifyState.timerId) {
      clearTimeout(_clarifyState.timerId);
      _clarifyState.timerId = null;
    }
    _clarifyState = null;
  }
}

// ─── Decision Engine — Phase 1: Pending action state machine ─────────────────
// Module-level state: NEVER placed on window or in the DOM.
let _pendingAction   = null;

function clearPendingAction() {
  if (_pendingAction) {
    if (_pendingAction.timerId) {
      clearTimeout(_pendingAction.timerId);
      _pendingAction.timerId = null;
    }
    _pendingAction = null;
  }
}

function startPendingTimer() {
  if (!_pendingAction) return;
  if (_pendingAction.timerId) {
    clearTimeout(_pendingAction.timerId);
    _pendingAction.timerId = null;
  }

  _pendingAction.timerId = setTimeout(async () => {
    if (!_pendingAction) return;
    console.log('[EcoVoice Decision] timeout fired in stage:', _pendingAction.stage);

    if (_pendingAction.stage === 'AWAITING') {
      _pendingAction.stage = 'REPROMPTED';
      _pendingAction.timerId = null;
      if (_speakText) {
        await _speakText("I didn't catch that. Do you want to proceed?");
      }
      if (_pendingAction && _pendingAction.stage === 'REPROMPTED') {
        startPendingTimer();
      }
    } else if (_pendingAction.stage === 'REPROMPTED') {
      console.log('[EcoVoice Decision] cancelled: timeout');
      clearPendingAction();
      updateHUDResult('⏱️ Cancelled (timeout)');
      if (_speakText) {
        await _speakText("Action cancelled due to timeout.");
      }
    }
  }, 10000);
}

function classifyConfirmationReply(rawText) {
  let trimmed = (rawText || '').trim().toLowerCase();
  // Homophone: treat reply "know" as "no" ONLY if entire reply is exactly "know"
  if (trimmed === 'know') {
    trimmed = 'no';
  }

  const cleaned = trimmed.replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
  const cleanedNoApos = cleaned.replace(/'/g, '');

  const CONFIRM_TERMS = [
    'yes', 'go ahead', 'confirm', 'confirmed', 'proceed', 'do it', 'yep', 'yeah'
  ];
  const DENY_TERMS = [
    'no', 'stop', 'cancel', 'abort', 'wait', 'nevermind', 'never mind', 'not', "don't", 'dont', 'do not'
  ];

  function matchesTerm(str, term) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const re = new RegExp(`(^|\\s)${escaped}($|\\s)`, 'i');
    return re.test(str);
  }

  // If text contains any DENY match -> DENY wins (even if CONFIRM also matches)
  const hasDeny = DENY_TERMS.some((term) => matchesTerm(cleaned, term) || matchesTerm(cleanedNoApos, term));
  if (hasDeny) {
    return 'DENY';
  }

  const hasConfirm = CONFIRM_TERMS.some((term) => matchesTerm(cleaned, term) || matchesTerm(cleanedNoApos, term));
  if (hasConfirm) {
    return 'CONFIRM';
  }

  return 'UNCLEAR';
}

async function handleConfirmationReply(text) {
  if (!_pendingAction) return;

  if (_pendingAction.timerId) {
    clearTimeout(_pendingAction.timerId);
    _pendingAction.timerId = null;
  }

  const decision = classifyConfirmationReply(text);
  console.log('[EcoVoice Decision] reply classified:', decision, 'from text:', text);

  if (decision === 'DENY') {
    console.log('[EcoVoice Decision] cancelled: user denied');
    clearPendingAction();
    updateHUDResult('❌ Cancelled');
    if (_speakText) {
      await _speakText("Cancelled.");
    }
    return;
  }

  if (decision === 'CONFIRM') {
    const saved = _pendingAction;
    clearPendingAction();

    // Verify location.href equals stored url before execution
    if (window.location.href !== saved.url) {
      console.log('[EcoVoice Decision] cancelled: URL changed before execution');
      updateHUDResult('❌ Cancelled');
      if (_speakText) {
        await _speakText("Action cancelled because page changed.");
      }
      return;
    }

    console.log('[EcoVoice Decision] executed confirmed command:', saved.command);
    updateHUDResult('✅ Confirmed');
    if (_speakText) {
      await _speakText("Proceeding.");
    }

    // Execute stored command ONCE directly through _ActionEngine, BYPASSING guard
    let execResult = '';
    const cmd = saved.command;
    switch (cmd.intent) {
      case 'click':
      case 'open':
        execResult = _ActionEngine.click(cmd.target);
        break;
      case 'double-click':
      case 'double_click':
        execResult = _ActionEngine.doubleClick(cmd.target);
        break;
      case 'right-click':
      case 'right_click':
        execResult = _ActionEngine.rightClick(cmd.target);
        break;
      case 'submit':
        execResult = _ActionEngine.submit(cmd.target);
        break;
      case 'keyboard':
        execResult = _ActionEngine.keyboard(cmd.key || cmd.shortcut);
        break;
      default:
        if (_ActionEngine && typeof _ActionEngine[cmd.intent] === 'function') {
          execResult = _ActionEngine[cmd.intent](cmd.target);
        }
    }
    if (_updateContext) _updateContext(cmd);
    updateHUDResult(execResult || 'Done');
    console.log(`[EcoVoice] Dispatched (confirmed): ${cmd.intent} → ${execResult}`);
    return;
  }

  // UNCLEAR
  _pendingAction.unclearCount = (_pendingAction.unclearCount || 0) + 1;
  if (_pendingAction.unclearCount >= 2) {
    console.log('[EcoVoice Decision] cancelled: unclear reply count reached 2');
    clearPendingAction();
    updateHUDResult('❌ Cancelled');
    if (_speakText) {
      await _speakText("Action cancelled.");
    }
    return;
  }

  updateHUDResult('🗣️ Unclear reply, reprompting...');
  if (_speakText) {
    await _speakText("I didn't understand. Please say confirm or cancel.");
  }
  if (_pendingAction) {
    startPendingTimer();
  }
}

// Lifecycle listeners to silently clear pending actions
window.addEventListener('pagehide', () => {
  clearPendingAction();
});
window.addEventListener('popstate', () => {
  if (_pendingAction && _pendingAction.url !== window.location.href) {
    clearPendingAction();
  }
});
window.addEventListener('hashchange', () => {
  if (_pendingAction && _pendingAction.url !== window.location.href) {
    clearPendingAction();
  }
});

// ─── HUD helpers (defined before injectHUD so logAction can use them) ─────────

function updateHUDStatus(s) {
  const statusEl = document.getElementById('ev-status');
  if (statusEl) statusEl.textContent = s;
  // Note: button states are fixed (separate Start/Stop buttons) — no toggle needed.
}
function updateHUDCommand(t) {
  const el = document.getElementById('ev-command');
  if (el) el.textContent = t || '-';
}
function updateHUDJson(obj) {
  const el = document.getElementById('ev-json');
  if (el) el.textContent = JSON.stringify(obj, null, 2);
}
function updateHUDResult(r) {
  const el = document.getElementById('ev-result');
  if (el) el.textContent = r || '-';
}

// ─── Security Rules Engine — Phase 2: Middleware Guard ───────────────────────

let _elementFinderModule = null;

async function resolveTargetElement(target) {
  if (!target) return null;
  try {
    if (!_elementFinderModule) {
      _elementFinderModule = await import(chrome.runtime.getURL('content/elementFinder.js'));
    }
    if (_elementFinderModule && typeof _elementFinderModule.findElement === 'function') {
      return _elementFinderModule.findElement(target);
    }
  } catch (err) {
    console.warn('[EcoVoice Decision] Failed to load elementFinder:', err);
  }
  return null;
}

function extractInteractiveElementText(el) {
  if (!el || typeof el !== 'object' || !el.tagName) return '';
  const tag = el.tagName.toLowerCase();
  const role = (el.getAttribute?.('role') || '').toLowerCase();
  const inputType = (el.type || '').toLowerCase();

  const isInteractive = (
    tag === 'a' ||
    tag === 'button' ||
    (tag === 'input' && (inputType === 'button' || inputType === 'submit')) ||
    role === 'button' ||
    role === 'link' ||
    (typeof el.matches === 'function' && el.matches('a, button, input[type="button"], input[type="submit"], [role="button"], [role="link"]'))
  );
  if (!isInteractive) return '';

  const raw = (el.innerText || el.textContent || '').trim();
  const aria = (el.getAttribute?.('aria-label') || '').trim();
  const title = (el.getAttribute?.('title') || '').trim();
  const val = (typeof el.value === 'string' ? el.value : '').trim();

  const combined = [raw, aria, title, val].filter(Boolean).join(' ').trim();
  if (combined.length > 60) return '';
  return combined;
}

function matchesRestrictedKeyword(text, keyword) {
  if (!text || !keyword) return false;
  const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  return regex.test(text);
}

/**
 * Evaluates a resolved DOM element against the cached security rules
 * (stored by background.js under the key "security_rules").
 *
 * Task 1: Evaluates BOTH global and domain rules.
 * Priority: BLOCK always wins. Else if any gives REQUIRE_VOICE_CONFIRMATION, return that. Else NONE.
 *
 * Returns: { isSafe: boolean, action: string, reason: string }
 *   action is one of: "NONE" | "REQUIRE_VOICE_CONFIRMATION" | "BLOCK"
 */
async function evaluateSecurityRules(targetElement, command = null) {
  // ── 1. Fetch cached rules ──────────────────────────────────────────────────
  let data;
  try {
    data = await chrome.storage.local.get('security_rules');
  } catch (err) {
    console.warn('[EcoVoice Security] Could not read storage:', err);
    return { isSafe: true, action: 'NONE', reason: '' }; // fail open — don't block on storage errors
  }

  const rules = data?.security_rules;
  if (!rules) {
    // Rules not yet cached (first install race) — allow the action.
    return { isSafe: true, action: 'NONE', reason: '' };
  }

  let globalAction = 'NONE';
  let domainAction = 'NONE';
  let matchReason  = '';

  const spokenTarget = (targetElement?.spokenTarget ?? command?.target ?? '').trim();
  const elementText  = (targetElement?.elementText ?? extractInteractiveElementText(targetElement) ?? '').trim();
  const loggedText   = elementText || spokenTarget;

  // ── 2. Global keyword check ────────────────────────────────────────────────
  const globalRules = rules.global_rules;
  if (globalRules?.restricted_keywords?.length) {
    let matchedKeyword = null;

    for (const kw of globalRules.restricted_keywords) {
      if (matchesRestrictedKeyword(spokenTarget, kw) || matchesRestrictedKeyword(elementText, kw)) {
        matchedKeyword = kw;
        break;
      }
    }

    if (matchedKeyword) {
      globalAction = globalRules.action_on_match || 'REQUIRE_VOICE_CONFIRMATION';
      matchReason  = `Global keyword match: "${matchedKeyword}"`;
      console.log(`[EcoVoice Decision] element check: text="${loggedText}" matched keyword "${matchedKeyword}"`);
    } else {
      console.log(`[EcoVoice Decision] element check: text="${loggedText}" no match`);
    }
  }

  // ── 3. Domain-specific rules check ────────────────────────────────────────
  const domainRules = rules.domain_rules;
  if (domainRules) {
    const currentHostname = window.location.hostname; // e.g. "www.apple.com"
    const currentUrl      = window.location.href;

    // Find a rule whose key is contained in the current hostname
    // (handles both "apple.com" matching "www.apple.com").
    const matchedDomainKey = Object.keys(domainRules).find((key) =>
      currentHostname === key || currentHostname.endsWith('.' + key)
    );

    if (matchedDomainKey) {
      const domainRule = domainRules[matchedDomainKey];

      // 3a. URL pattern check (wildcard → regex conversion) — uses ONLY current page URL
      if (domainRule.restricted_urls?.length) {
        const urlMatched = domainRule.restricted_urls.some((pattern) => {
          // Convert wildcard glob (*/path*) into a real RegExp.
          const regexStr = pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials except *
            .replace(/\*/g, '.*');                  // * → .*
          return new RegExp(regexStr).test(currentUrl);
        });

        if (urlMatched) {
          domainAction = domainRule.action_on_match || 'BLOCK';
          matchReason  = `Domain URL match on "${matchedDomainKey}"`;
          console.warn(
            `[EcoVoice Security] Domain URL match on "${matchedDomainKey}" →`,
            domainAction
          );
        }
      }

      // 3b. Restricted CSS selector check
      if (domainRule.restricted_elements?.length && targetElement && typeof targetElement.matches === 'function') {
        const elementMatched = domainRule.restricted_elements.some((selector) => {
          try {
            return targetElement.matches(selector);
          } catch {
            return false; // malformed selector — skip safely
          }
        });

        if (elementMatched) {
          domainAction = domainRule.action_on_match || 'BLOCK';
          matchReason  = `Domain element match on "${matchedDomainKey}"`;
          console.warn(
            `[EcoVoice Security] Domain element match on "${matchedDomainKey}" →`,
            domainAction
          );
        }
      }
    }
  }

  // ── 4. Resolution priority: BLOCK always wins ─────────────────────────────
  if (globalAction === 'BLOCK' || domainAction === 'BLOCK') {
    return { isSafe: false, action: 'BLOCK', reason: matchReason };
  }
  if (globalAction === 'REQUIRE_VOICE_CONFIRMATION' || domainAction === 'REQUIRE_VOICE_CONFIRMATION') {
    return { isSafe: false, action: 'REQUIRE_VOICE_CONFIRMATION', reason: matchReason };
  }

  return { isSafe: true, action: 'NONE', reason: '' };
}

// ─── Task 2: Central Guarded Execution Helpers ────────────────────────────────

function buildGuardTarget(command, resolvedEl = null) {
  const el = resolvedEl;
  const interactiveText = extractInteractiveElementText(el);

  const active = document.activeElement;
  const form = (el && el.closest ? el.closest('form') : null) ||
               (active && active.closest ? active.closest('form') : null) ||
               (active && active.tagName === 'FORM' ? active : null);
  const submitBtn = form ? form.querySelector('[type="submit"], button:not([type="button"]):not([type="reset"])') : null;
  const submitBtnText = submitBtn ? extractInteractiveElementText(submitBtn) : '';
  const activeText = (active && active !== document.body) ? extractInteractiveElementText(active) : '';

  return {
    spokenTarget: (command.target || '').trim(),
    elementText: interactiveText || activeText || submitBtnText || '',
    matches: (selector) => {
      try {
        if (el && typeof el.matches === 'function' && el.matches(selector)) return true;
        if (submitBtn && typeof submitBtn.matches === 'function' && submitBtn.matches(selector)) return true;
        if (form && typeof form.matches === 'function' && form.matches(selector)) return true;
        if (active && typeof active.matches === 'function' && active.matches(selector)) return true;
      } catch (_) {}
      return false;
    }
  };
}

async function guardedExecute(command, executeFn) {
  let resolvedEl = null;
  if (command.target) {
    resolvedEl = await resolveTargetElement(command.target);
  }

  const guardTarget = buildGuardTarget(command, resolvedEl);
  const securityCheck = await evaluateSecurityRules(guardTarget, command);

  if (securityCheck.action === 'BLOCK') {
    console.warn('[EcoVoice Decision] Action BLOCKED by security rule:', command);
    updateHUDResult('🚫 Blocked by Security Rule');
    if (_speakText) {
      await _speakText("Action strictly blocked by domain security rule.");
    }
    return;
  }

  if (securityCheck.action === 'REQUIRE_VOICE_CONFIRMATION') {
    clearPendingAction();
    console.log('[EcoVoice Decision] pending created:', command);
    _pendingAction = {
      command: { ...command },
      reason: securityCheck.reason || 'Restricted action',
      url: window.location.href,
      stage: 'AWAITING',
      unclearCount: 0,
      timerId: null,
    };
    updateHUDResult('🔒 Voice Confirmation Required');
    if (_speakText) {
      await _speakText("This is a restricted action. Please say confirm to proceed, or cancel to abort.");
    }
    if (_pendingAction && _pendingAction.stage === 'AWAITING') {
      startPendingTimer();
    }
    return;
  }

  // NONE — execute normally
  const execResult = executeFn();
  if (_updateContext) _updateContext(command);
  updateHUDResult(execResult || 'Done');
  console.log(`[EcoVoice] Dispatched: ${command.intent} → ${execResult}`);
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

function dispatchAction(command) {
  if (!_ActionEngine) {
    console.warn('[EcoVoice] ActionEngine not ready');
    return;
  }

  let result = '';

  switch (command.intent) {
    // Help
    case 'help':
    case 'HELP': {
      updateHUDResult('Help');
      if (_speakText) {
        (async () => {
          await _speakText("You can say: scroll down, scroll up, click and a name, go back, zoom in, open new tab, or read page.");
        })();
      }
      return;
    }

    // Conversational Follow-up (Phase 6)
    case 'CLARIFY':
    case 'clarify': {
      updateHUDResult('🗣️ Asking for clarification...');
      if (_speakText) {
        (async () => {
          await _speakText(command.message || "Could you please be more specific?");
        })();
      }
      return;
    }

    // Scroll
    case 'scroll':
      result = _ActionEngine.scroll(command.direction, command.amount);
      break;

    // Clicks & Actions — routed through security guard before firing
    case 'click':
    case 'open':
    case 'double-click':
    case 'double_click':
    case 'right-click':
    case 'right_click':
    case 'submit': {
      (async () => {
        await guardedExecute(command, () => {
          switch (command.intent) {
            case 'click':
            case 'open':
              return _ActionEngine.click(command.target);
            case 'double-click':
            case 'double_click':
              return _ActionEngine.doubleClick(command.target);
            case 'right-click':
            case 'right_click':
              return _ActionEngine.rightClick(command.target);
            case 'submit':
              return _ActionEngine.submit(command.target);
            default:
              return '';
          }
        });
      })();
      return;
    }

    // Hover / Focus
    case 'hover':
      result = _ActionEngine.hover(command.target);
      break;
    case 'focus':
      result = _ActionEngine.focus(command.target);
      break;

    // Input / Select
    case 'type':
    case 'input':
      result = _ActionEngine.input(command.target, command.value || '');
      break;
    case 'select':
      result = _ActionEngine.select(command.target, command.option || '');
      break;

    // Clipboard
    case 'copy':  result = _ActionEngine.copy();  break;
    case 'paste': result = _ActionEngine.paste(); break;
    case 'cut':   result = _ActionEngine.cut();   break;

    // Undo/Redo
    case 'undo': result = _ActionEngine.undo(); break;
    case 'redo': result = _ActionEngine.redo(); break;

    // Keyboard shortcuts
    case 'keyboard': {
      const k = (command.key || command.shortcut || '').toLowerCase();
      if (k === 'enter') {
        (async () => {
          await guardedExecute(command, () => {
            return _ActionEngine.keyboard(command.key || command.shortcut);
          });
        })();
        return;
      }
      result = _ActionEngine.keyboard(command.key || command.shortcut);
      break;
    }

    // Selection
    case 'select-all':
    case 'select_all':
      result = _ActionEngine.selectAll(); break;
    case 'scroll-into-view':
    case 'scroll_into_view':
      result = _ActionEngine.scrollIntoView(command.target); break;

    // Window
    case 'window-focus':
    case 'window_focus':
      result = _ActionEngine.windowFocus(); break;

    // Zoom
    case 'zoom-in':  case 'zoom_in':    result = _ActionEngine.zoom('in');    break;
    case 'zoom-out': case 'zoom_out':   result = _ActionEngine.zoom('out');   break;
    case 'zoom-reset':case 'zoom_reset':result = _ActionEngine.zoom('reset'); break;

    // Navigation
    case 'navigate':
      result = _ActionEngine.navigate(command.action, command.url);
      break;

    // Tab
    case 'tab':
      result = _ActionEngine.tab(command.action);
      break;

    // Drag
    case 'drag':
      result = _ActionEngine.drag(command.from, command.to);
      break;

    // DOM read
    case 'read':
      if (_DOMReader) {
        const snap = _DOMReader.snapshot();
        console.log('[EcoVoice] Page snapshot:', snap);
        result = `Page: "${snap.title}" — ${snap.buttons.length} buttons, ${snap.links.length} links`;
      }
      break;

    // Stop is a no-op here (handled by speech engine)
    case 'stop':
      result = 'Stopped';
      break;

    default:
      console.log('[EcoVoice] No handler for intent:', command.intent);
      result = 'Unknown command';
  }

  if (_updateContext) _updateContext(command);
  updateHUDResult(result || 'Done');
  console.log(`[EcoVoice] Dispatched: ${command.intent} → ${result}`);
}

// ─── HUD ─────────────────────────────────────────────────────────────────────

let _hudEl      = null;
let _hudContent = null;
let _isDragging = false;
let _curX, _curY, _initX, _initY;
let _xOff = 0, _yOff = 0;

function injectHUD() {
  if (document.getElementById('ecovoice-hud')) return;

  _hudEl = document.createElement('div');
  _hudEl.id = 'ecovoice-hud';
  _hudEl.style.cssText = `
    position:fixed; top:20px; right:20px; width:320px; z-index:2147483647;
    background:rgba(17,24,39,0.93); backdrop-filter:blur(14px);
    -webkit-backdrop-filter:blur(14px);
    border:1px solid rgba(255,255,255,0.12); border-radius:14px;
    box-shadow:0 10px 30px rgba(0,0,0,0.45); color:#f3f4f6;
    font-family:system-ui,-apple-system,sans-serif; font-size:13px;
    display:flex; flex-direction:column; overflow:hidden;
  `;

  const header = document.createElement('div');
  header.style.cssText = `
    padding:10px 16px; background:rgba(255,255,255,0.05);
    border-bottom:1px solid rgba(255,255,255,0.1); cursor:grab;
    display:flex; justify-content:space-between; align-items:center;
    user-select:none;
  `;
  header.innerHTML = `
    <span style="font-weight:600;font-size:14px;">🎙 EcoVoice V1</span>
    <div style="display:flex;gap:8px;">
      <button id="ev-collapse" style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:16px;" title="Collapse">_</button>
      <button id="ev-hide"     style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:16px;" title="Hide">×</button>
    </div>
  `;

  _hudContent = document.createElement('div');
  _hudContent.style.cssText = 'padding:14px;display:flex;flex-direction:column;gap:10px;';
  _hudContent.innerHTML = `
    <div style="display:flex;justify-content:space-between;">
      <span style="color:#9ca3af;">Connection:</span>
      <span style="color:#10b981;font-weight:600;">● Active</span>
    </div>
    <div style="display:flex;justify-content:space-between;">
      <span style="color:#9ca3af;">Status:</span>
      <span id="ev-status" style="color:#3b82f6;font-weight:600;">Idle</span>
    </div>
    <div>
      <div style="color:#9ca3af;font-size:11px;text-transform:uppercase;margin-bottom:4px;">Command</div>
      <div id="ev-command" style="background:rgba(0,0,0,0.3);padding:8px;border-radius:6px;word-break:break-word;">-</div>
    </div>
    <div>
      <div style="color:#9ca3af;font-size:11px;text-transform:uppercase;margin-bottom:4px;">Parsed JSON</div>
      <pre id="ev-json" style="background:rgba(0,0,0,0.3);padding:8px;border-radius:6px;margin:0;overflow-x:auto;font-family:monospace;color:#10b981;font-size:11px;">-</pre>
    </div>
    <div>
      <div style="color:#9ca3af;font-size:11px;text-transform:uppercase;margin-bottom:4px;">Result</div>
      <div id="ev-result" style="color:#f3f4f6;">-</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:4px;">
      <button id="ev-start-btn" style="
        flex:1;padding:10px;background:#10b981;color:white;
        border:none;border-radius:6px;cursor:pointer;font-weight:500;
      ">Start Listening</button>
      <button id="ev-stop-btn" style="
        flex:1;padding:10px;background:#ef4444;color:white;
        border:none;border-radius:6px;cursor:pointer;font-weight:500;
      ">Stop Listening</button>
    </div>
  `;

  _hudEl.appendChild(header);
  _hudEl.appendChild(_hudContent);
  document.body.appendChild(_hudEl);

  // Drag
  header.addEventListener('mousedown', (e) => {
    if (e.target.tagName.toLowerCase() === 'button') return;
    _isDragging = true;
    _initX = e.clientX - _xOff;
    _initY = e.clientY - _yOff;
    header.style.cursor = 'grabbing';
  });
  document.addEventListener('mousemove', (e) => {
    if (!_isDragging) return;
    e.preventDefault();
    _curX = e.clientX - _initX;
    _curY = e.clientY - _initY;
    _xOff = _curX; _yOff = _curY;
    _hudEl.style.transform = `translate3d(${_curX}px,${_curY}px,0)`;
  });
  document.addEventListener('mouseup', () => {
    _isDragging = false;
    header.style.cursor = 'grab';
    _initX = _curX; _initY = _curY;
  });

  // Restore position
  const sx = sessionStorage.getItem('ev-hud-x');
  const sy = sessionStorage.getItem('ev-hud-y');
  if (sx && sy) {
    _xOff = parseFloat(sx); _yOff = parseFloat(sy);
    _hudEl.style.transform = `translate3d(${_xOff}px,${_yOff}px,0)`;
  }
  window.addEventListener('beforeunload', () => {
    sessionStorage.setItem('ev-hud-x', _xOff);
    sessionStorage.setItem('ev-hud-y', _yOff);
  });
  window.addEventListener('pagehide', () => {
    clearClarifyState();
  });

  // Collapse panel toggle.
  document.getElementById('ev-collapse').addEventListener('click', () => {
    _hudContent.style.display = _hudContent.style.display === 'none' ? 'flex' : 'none';
  });

  // Fix 3b: Close (cross) button — stop mic before hiding so the loop fully terminates.
  document.getElementById('ev-hide').addEventListener('click', () => {
    clearClarifyState();
    clearPendingAction();
    if (window.ecoVoiceSR) window.ecoVoiceSR.stop();  // forces state → IDLE, kills restart timer
    sessionStorage.setItem('ecovoice_active', 'false');
    updateHUDStatus('Stopped');
    _hudEl.style.display = 'none';
  });

  // Fix 3a: Dedicated Start button — restarts from IDLE.
  document.getElementById('ev-start-btn').addEventListener('click', () => {
    if (window.ecoVoiceSR && window.ecoVoiceSR.supported) {
      sessionStorage.setItem('ecovoice_active', 'true');
      window.ecoVoiceSR.start();
    }
  });

  // Fix 3a: Dedicated Stop button — halts mic and marks session inactive.
  document.getElementById('ev-stop-btn').addEventListener('click', () => {
    clearClarifyState();
    clearPendingAction();
    if (window.ecoVoiceSR) window.ecoVoiceSR.stop();
    sessionStorage.setItem('ecovoice_active', 'false');
    updateHUDStatus('Stopped');
  });

  // Sync status label on initial inject.
  updateHUDStatus(sessionStorage.getItem('ecovoice_active') === 'true' ? 'listening' : 'Stopped');
}

// Expose for navigationManager
window.ecoVoiceInjectHUD = injectHUD;

// ─── LLM Fallback & Clarification (Phase 3 & 4) ───────────────────────────────

async function askClarification(originalText, question, round) {
  _clarifyState = { originalText, question, round, url: location.href, timerId: null };
  updateHUDResult('❓ ' + question);
  updateHUDJson({ intent: 'clarify', message: question });
  if (_speakText) {
    await _speakText(question);
  }
  if (_clarifyState) {
    if (_clarifyState.timerId) clearTimeout(_clarifyState.timerId);
    _clarifyState.timerId = setTimeout(() => {
      clearClarifyState();
      updateHUDResult('Clarification expired');
    }, 20000);
  }
}

async function handleUnknownWithLLM(text, history = null) {
  if (_llmBusy) {
    console.log('[EcoVoice LLM] busy, ignoring utterance');
    return;
  }

  const startUrl = location.href;
  _llmBusy = true;
  updateHUDResult('🤖 Asking AI...');

  let res = null;
  try {
    const payload = { type: 'LLM_PARSE', text };
    if (history) payload.history = history;
    res = await chrome.runtime.sendMessage(payload);
  } catch (err) {
    console.error('[EcoVoice LLM] Message sending failed:', err);
    res = { ok: false, error: err.message };
  } finally {
    _llmBusy = false;
  }

  // Discard the result if context changed while waiting
  if (sessionStorage.getItem('ecovoice_active') !== 'true' || location.href !== startUrl || _pendingAction !== null) {
    console.log('[EcoVoice LLM] Result discarded: context changed or inactive');
    clearClarifyState();
    return;
  }

  if (res && res.ok && res.command) {
    if (res.command.intent === 'clarify') {
      const round = (history && typeof history.round === 'number' ? history.round : 0) + 1;
      if (round > 2) {
        clearClarifyState();
        updateHUDResult("Couldn't understand");
        if (_speakText) {
          await _speakText("Sorry, I couldn't understand. Please try again.");
        }
        return;
      } else {
        const originalText = history ? history.originalText : text;
        await askClarification(originalText, res.command.message, round);
        return;
      }
    } else if (res.command.intent !== 'unknown') {
      clearClarifyState();
      updateHUDJson(res.command);
      dispatchAction(res.command);
      return;
    }
  }

  // Fallback for unknown / failed
  clearClarifyState();
  updateHUDJson({ intent: 'unknown', type: 'UNKNOWN' });
  dispatchAction({ intent: 'unknown', type: 'UNKNOWN' });
  if (res && res.error === 'NO_KEY') {
    updateHUDResult('AI key not set');
  }
}

function executeNormalUtterance(text) {
  let parsed = _resolveFollowUp ? _resolveFollowUp(text) : null;
  if (!parsed) parsed = _parseCommand(text);

  const PRONOUN_TARGETS = ['it', 'this', 'that', 'this one', 'that one', 'there', 'one', 'isko', 'usko', 'ise', 'use'];
  const isClickFamily = parsed && ['click', 'open', 'double-click', 'right-click', 'hover'].includes(parsed.intent);
  const isVagueTarget = isClickFamily && typeof parsed.target === 'string' && PRONOUN_TARGETS.includes(parsed.target.trim().toLowerCase());

  if (parsed && parsed.intent !== 'unknown' && !isVagueTarget) {
    updateHUDJson(parsed);
    dispatchAction(parsed);
  } else {
    handleUnknownWithLLM(text);
  }
  return parsed;
}

async function handleClarifyAnswer(text) {
  if (!_clarifyState) return;

  if (_clarifyState.timerId) {
    clearTimeout(_clarifyState.timerId);
    _clarifyState.timerId = null;
  }

  if (location.href !== _clarifyState.url) {
    clearClarifyState();
    executeNormalUtterance(text);
    return;
  }

  const CANCEL_PATTERN = /^(cancel|never\s*mind|nevermind|forget\s+it|stop|no|nahi|rehne\s+do|chhod\s+do)$/i;
  if (CANCEL_PATTERN.test((text || '').trim())) {
    clearClarifyState();
    updateHUDResult('Cancelled');
    if (_speakText) {
      await _speakText("Okay.");
    }
    return;
  }

  const h = {
    originalText: _clarifyState.originalText,
    question: _clarifyState.question,
    round: _clarifyState.round
  };
  await handleUnknownWithLLM(text, h);
}

// ─── Runtime (dynamic imports) ────────────────────────────────────────────────

window.ecoVoiceSR = null;

async function initRuntime() {
  if (window.ecoVoiceSR) {
    if (window.ecoVoiceSR.supported) window.ecoVoiceSR.start();
    return;
  }

  try {
    const base = chrome.runtime.getURL('');

    const [srMod, cpMod, aeMod, drMod, cmMod, ttsMod] = await Promise.all([
      import(chrome.runtime.getURL('src/services/speechRecognition.js')),
      import(chrome.runtime.getURL('src/parser/commandParser.js')),
      import(chrome.runtime.getURL('content/actionEngine.js')),
      import(chrome.runtime.getURL('content/domReader.js')),
      import(chrome.runtime.getURL('content/contextMemory.js')),
      import(chrome.runtime.getURL('src/services/ttsService.js')),
    ]);

    _parseCommand     = cpMod.parseCommand;
    _ActionEngine     = aeMod.ActionEngine;
    _DOMReader        = drMod.DOMReader;
    _resolveFollowUp  = cmMod.resolveFollowUp;
    _updateContext    = cmMod.updateContext;
    _speakText        = ttsMod.speakText;

    window.ecoVoiceSR = srMod.createSpeechRecognition({
      onStateChange: (s) => updateHUDStatus(s),
      onResult: (text) => {
        updateHUDCommand(text);
        updateHUDResult('Processing...');

        // ── Bug Fix 1: System command interceptor ─────────────────────────────
        // Intercept explicit control phrases BEFORE resolveFollowUp or parseCommand
        // run. This prevents the task parser from hallucinating them as CREATE_TASK.
        const lower = text.toLowerCase().trim();
        if (/^(stop listening|cancel listening|halt listening|stop ecovoice|disable listening|turn off listening)$/.test(lower)) {
          clearClarifyState();
          if (_pendingAction) {
            console.log('[EcoVoice Decision] cancelled: stop listening command');
            clearPendingAction();
          }
          updateHUDResult('Stopping...');
          if (window.ecoVoiceSR) window.ecoVoiceSR.stop();
          sessionStorage.setItem('ecovoice_active', 'false');
          updateHUDStatus('Stopped');
          updateHUDJson({ intent: 'stop' });
          return; // skip parser + restart entirely
        }
        if (/^(start listening|begin listening|activate listening|resume listening)$/.test(lower)) {
          updateHUDResult('Starting...');
          if (window.ecoVoiceSR && window.ecoVoiceSR.supported) {
            sessionStorage.setItem('ecovoice_active', 'true');
            window.ecoVoiceSR.start();
          }
          updateHUDJson({ intent: 'start' });
          return; // skip parser, already re-started
        }
        // ── End interceptor ───────────────────────────────────────────────────

        // ── Task 4: Pending action reply gate ─────────────────────────────────
        if (_pendingAction) {
          if (_pendingAction.url !== window.location.href) {
            console.log('[EcoVoice Decision] cancelled: URL changed from', _pendingAction.url, 'to', window.location.href);
            clearPendingAction();
          } else {
            handleConfirmationReply(text);
            return;
          }
        }
        // ── End pending action reply gate ─────────────────────────────────────

        // ── Clarify-answer gate & utterance execution ─────────────────────────
        let parsed = null;
        if (_clarifyState) {
          handleClarifyAnswer(text);
        } else {
          parsed = executeNormalUtterance(text);
        }

        // Only schedule restart if the command was NOT an explicit user-stop.
        const isExplicitStop = (parsed && parsed.intent === 'stop');
        if (!isExplicitStop) {
          setTimeout(() => {
            if (window.ecoVoiceSR) window.ecoVoiceSR.startAfterDelay(100);
          }, 50);
        }
      },
      onError: (err) => {
        console.error('[EcoVoice] Speech error:', err);
        updateHUDResult('Error: ' + err);
      },
    });

    window.ecoVoiceSR.start();
    updateHUDStatus('Listening');
  } catch (err) {
    console.error('[EcoVoice] Runtime init failed:', err);
    updateHUDResult('Init error: ' + err.message);
  }
}

window.ecoVoiceInitRuntime = initRuntime;

// ─── Continuous action handler ──────────────────────────────────────────────

window.addEventListener('ecovoice:continuous', (e) => {
  if (!_ActionEngine) return;
  const cmd = e.detail;
  if (cmd && cmd.intent === 'scroll') {
    _ActionEngine.scroll(cmd.direction, cmd.amount || 500);
  }
});

// ─── Navigation Manager integration ──────────────────────────────────────────

window.addEventListener('ecovoice:navigation', () => {
  if (sessionStorage.getItem('ecovoice_active') !== 'true') return;
  if (!document.getElementById('ecovoice-hud')) {
    console.log('[EcoVoice] HUD missing after nav — re-injecting');
    injectHUD();
  }
  initRuntime();
});

// ─── Auto-recover on page load ────────────────────────────────────────────────

if (sessionStorage.getItem('ecovoice_active') === 'true') {
  console.log('[EcoVoice] Auto-recovering session...');
  injectHUD();
  initRuntime();
}

// ─── Message listener ─────────────────────────────────────────────────────────

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'LAUNCH_ECOVOICE') {
      sessionStorage.setItem('ecovoice_active', 'true');
      injectHUD();
      initRuntime();
    }
    if (message.type === 'ECOVOICE_STOP_FROM_HUD') {
      clearClarifyState();
      clearPendingAction();
      if (window.ecoVoiceSR) window.ecoVoiceSR.stop();
      sessionStorage.setItem('ecovoice_active', 'false');
      updateHUDStatus('Stopped');
    }
  });
}
