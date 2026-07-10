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

// ─── HUD helpers (defined before injectHUD so logAction can use them) ─────────

function updateHUDStatus(s) {
  const el = document.getElementById('ev-status');
  if (el) el.textContent = s;
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

// ─── Dispatcher ───────────────────────────────────────────────────────────────

function dispatchAction(command) {
  if (!_ActionEngine) {
    console.warn('[EcoVoice] ActionEngine not ready');
    return;
  }

  let result = '';

  switch (command.intent) {
    // Scroll
    case 'scroll':
      result = _ActionEngine.scroll(command.direction, command.amount);
      break;

    // Clicks
    case 'click':
      result = _ActionEngine.click(command.target);
      break;
    case 'double-click':
    case 'double_click':
      result = _ActionEngine.doubleClick(command.target);
      break;
    case 'right-click':
    case 'right_click':
      result = _ActionEngine.rightClick(command.target);
      break;

    // Hover / Focus
    case 'hover':
      result = _ActionEngine.hover(command.target);
      break;
    case 'focus':
      result = _ActionEngine.focus(command.target);
      break;

    // Open acts like click
    case 'open':
      result = _ActionEngine.click(command.target);
      break;

    // Input / Select / Submit
    case 'type':
    case 'input':
      result = _ActionEngine.input(command.target, command.value || '');
      break;
    case 'select':
      result = _ActionEngine.select(command.target, command.option || '');
      break;
    case 'submit':
      result = _ActionEngine.submit(command.target);
      break;

    // Clipboard
    case 'copy':  result = _ActionEngine.copy();  break;
    case 'paste': result = _ActionEngine.paste(); break;
    case 'cut':   result = _ActionEngine.cut();   break;

    // Undo/Redo
    case 'undo': result = _ActionEngine.undo(); break;
    case 'redo': result = _ActionEngine.redo(); break;

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
    <button id="ev-stop" style="
      margin-top:4px;padding:10px;background:#ef4444;color:white;
      border:none;border-radius:6px;cursor:pointer;font-weight:500;
    ">Stop Listening</button>
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

  // Collapse / hide
  document.getElementById('ev-collapse').addEventListener('click', () => {
    _hudContent.style.display = _hudContent.style.display === 'none' ? 'flex' : 'none';
  });
  document.getElementById('ev-hide').addEventListener('click', () => {
    _hudEl.style.display = 'none';
  });
  document.getElementById('ev-stop').addEventListener('click', () => {
    if (window.ecoVoiceSR) window.ecoVoiceSR.stop();
    sessionStorage.setItem('ecovoice_active', 'false');
    updateHUDStatus('Stopped');
  });
}

// Expose for navigationManager
window.ecoVoiceInjectHUD = injectHUD;

// ─── Runtime (dynamic imports) ────────────────────────────────────────────────

window.ecoVoiceSR = null;

async function initRuntime() {
  if (window.ecoVoiceSR) {
    if (window.ecoVoiceSR.supported) window.ecoVoiceSR.start();
    return;
  }

  try {
    const base = chrome.runtime.getURL('');

    const [srMod, cpMod, aeMod, drMod, cmMod] = await Promise.all([
      import(chrome.runtime.getURL('src/services/speechRecognition.js')),
      import(chrome.runtime.getURL('src/parser/commandParser.js')),
      import(chrome.runtime.getURL('content/actionEngine.js')),
      import(chrome.runtime.getURL('content/domReader.js')),
      import(chrome.runtime.getURL('content/contextMemory.js')),
    ]);

    _parseCommand     = cpMod.parseCommand;
    _ActionEngine     = aeMod.ActionEngine;
    _DOMReader        = drMod.DOMReader;
    _resolveFollowUp  = cmMod.resolveFollowUp;
    _updateContext    = cmMod.updateContext;

    window.ecoVoiceSR = srMod.createSpeechRecognition({
      onStateChange: (s) => updateHUDStatus(s),
      onResult: (text) => {
        updateHUDCommand(text);
        updateHUDResult('Processing...');

        // Try follow-up resolution first
        let parsed = _resolveFollowUp ? _resolveFollowUp(text) : null;
        if (!parsed) parsed = _parseCommand(text);

        updateHUDJson(parsed);
        dispatchAction(parsed);

        // Continuous listening
        setTimeout(() => {
          if (window.ecoVoiceSR) window.ecoVoiceSR.startAfterDelay(100);
        }, 50);
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
      if (window.ecoVoiceSR) window.ecoVoiceSR.stop();
      sessionStorage.setItem('ecovoice_active', 'false');
      updateHUDStatus('Stopped');
    }
  });
}
