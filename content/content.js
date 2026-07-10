/**
 * content.js — EcoVoice Extension Content Script
 *
 * Phase 4–6: Full HUD, Dispatcher, Runtime (Speech + Parser via dynamic import),
 * session persistence, and Navigation Manager integration.
 */

console.log('[EcoVoice] content.js loaded');

// ─── Dispatcher ───────────────────────────────────────────────────────────────

function logAction(command, handlerName, matchText, resultText) {
  updateHUDResult(resultText);
  console.log(
    `[EcoVoice] Command: ${JSON.stringify(command)}\n` +
    `  Handler: ${handlerName}\n` +
    `  Match: ${matchText || 'none'}\n` +
    `  Result: ${resultText}`
  );
}

function findVisibleElementByText(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const candidates = Array.from(
    document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"], [tabindex]')
  );
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    const visible =
      r.width > 0 && r.height > 0 &&
      r.top >= 0 && r.left >= 0 &&
      r.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      r.right  <= (window.innerWidth  || document.documentElement.clientWidth);
    if (visible) {
      const label = (
        el.textContent || el.innerText ||
        el.getAttribute('aria-label') || el.getAttribute('title') || ''
      ).toLowerCase();
      if (label.includes(lower)) return el;
    }
  }
  return null;
}

function handleScroll(command) {
  const dir = command.direction;
  if      (dir === 'down')   window.scrollBy({ top:  500, behavior: 'smooth' });
  else if (dir === 'up')     window.scrollBy({ top: -500, behavior: 'smooth' });
  else if (dir === 'bottom') window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  else if (dir === 'top')    window.scrollTo({ top: 0, behavior: 'smooth' });
  logAction(command, 'handleScroll()', null, 'Scrolled: ' + dir);
}

function handleClick(command) {
  const el = findVisibleElementByText(command.target);
  if (el) { el.click(); logAction(command, 'handleClick()', `<${el.tagName.toLowerCase()}>`, 'Clicked'); }
  else     logAction(command, 'handleClick()', null, 'No matching element');
}

function handleHover(command) {
  const el = findVisibleElementByText(command.target);
  if (el) {
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('mouseover',  { bubbles: true, cancelable: true, view: window }));
    logAction(command, 'handleHover()', `<${el.tagName.toLowerCase()}>`, 'Hovered');
  } else {
    logAction(command, 'handleHover()', null, 'No matching element');
  }
}

function handleOpen(command) {
  const el = findVisibleElementByText(command.target);
  if (el) { el.click(); logAction(command, 'handleOpen()', `<${el.tagName.toLowerCase()}>`, 'Opened'); }
  else     logAction(command, 'handleOpen()', null, 'No matching element');
}

function dispatchAction(command) {
  switch (command.intent) {
    case 'scroll': handleScroll(command); break;
    case 'click':  handleClick(command);  break;
    case 'hover':  handleHover(command);  break;
    case 'open':   handleOpen(command);   break;
    case 'read':   logAction(command, 'handleRead()', null, 'Read (placeholder)'); break;
    default:       console.log('[EcoVoice] No handler for intent:', command.intent);
  }
}

// ─── HUD ─────────────────────────────────────────────────────────────────────

let _hudEl = null;
let _hudContent = null;
let _isDragging = false;
let _curX, _curY, _initX, _initY;
let _xOff = 0, _yOff = 0;

function injectHUD() {
  if (document.getElementById('ecovoice-hud')) return; // prevent duplicate

  _hudEl = document.createElement('div');
  _hudEl.id = 'ecovoice-hud';
  _hudEl.style.cssText = `
    position:fixed; top:20px; right:20px; width:320px; z-index:2147483647;
    background:rgba(17,24,39,0.92); backdrop-filter:blur(14px);
    -webkit-backdrop-filter:blur(14px);
    border:1px solid rgba(255,255,255,0.12); border-radius:14px;
    box-shadow:0 10px 30px rgba(0,0,0,0.4); color:#f3f4f6;
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
      <button id="ev-collapse" style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:16px;">_</button>
      <button id="ev-hide"     style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:16px;">×</button>
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

  // Restore saved position
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

  // Buttons
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

// Expose so navigationManager can call them after SPA transition
window.ecoVoiceInjectHUD = injectHUD;

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

// ─── Runtime (Speech + Parser via dynamic import) ─────────────────────────────

window.ecoVoiceSR = null;

async function initRuntime() {
  // If already running, just ensure it's listening
  if (window.ecoVoiceSR) {
    if (window.ecoVoiceSR.supported) window.ecoVoiceSR.start();
    return;
  }

  try {
    const srUrl = chrome.runtime.getURL('src/services/speechRecognition.js');
    const cpUrl = chrome.runtime.getURL('src/parser/commandParser.js');

    const [srMod, cpMod] = await Promise.all([import(srUrl), import(cpUrl)]);
    const { createSpeechRecognition } = srMod;
    const { parseCommand } = cpMod;

    window.ecoVoiceSR = createSpeechRecognition({
      onStateChange: (state) => updateHUDStatus(state),
      onResult: (text) => {
        updateHUDCommand(text);
        updateHUDResult('Executing...');
        const parsed = parseCommand(text);
        updateHUDJson(parsed);
        dispatchAction(parsed);
        // Continuous: restart after each command
        setTimeout(() => {
          if (window.ecoVoiceSR) window.ecoVoiceSR.startAfterDelay(100);
        }, 50);
      },
      onError: (err) => {
        console.error('[EcoVoice] Speech error:', err);
        updateHUDResult('Error: ' + err);
      }
    });

    window.ecoVoiceSR.start();
    updateHUDStatus('Listening');
  } catch (err) {
    console.error('[EcoVoice] Failed to init runtime:', err);
    updateHUDResult('Init error: ' + err.message);
  }
}

// Expose so navigationManager can call it
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

// ─── Auto-recover on hard page refresh ────────────────────────────────────────

if (sessionStorage.getItem('ecovoice_active') === 'true') {
  console.log('[EcoVoice] Auto-recovering session...');
  injectHUD();
  initRuntime();
}

// ─── Message listener (from popup launcher) ──────────────────────────────────

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
