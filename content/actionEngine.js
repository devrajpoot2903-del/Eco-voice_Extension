/**
 * actionEngine.js — Phase 6: Generic Action Engine
 *
 * All browser interactions route through this engine. No duplicated logic.
 * Uses elementFinder for DOM resolution with 95%+ accuracy scoring.
 */

import { findElement, findAllRanked, findAllVisible } from './elementFinder.js';

// ── Internal helpers ──────────────────────────────────────────────────────────

function simulateMouse(el, type, extra = {}) {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, ...extra }));
}

function simulateKey(el, type, key, code, keyCode) {
  el.dispatchEvent(new KeyboardEvent(type, {
    bubbles: true, cancelable: true,
    key, code, keyCode, which: keyCode,
  }));
}

function pressKey(el, key, code, keyCode) {
  simulateKey(el, 'keydown',  key, code, keyCode);
  simulateKey(el, 'keypress', key, code, keyCode);
  simulateKey(el, 'keyup',    key, code, keyCode);
}

// ── Sequential navigation state (for "next"/"previous" click targeting) ───────
let _lastFoundElements = [];
let _lastFoundIndex    = 0;
let _lastQuery         = '';

function resolveTarget(target) {
  if (!target) return null;

  // "next" / "previous" — cycle through ranked results of last query
  if (target === 'next') {
    if (_lastFoundElements.length === 0) return null;
    _lastFoundIndex = Math.min(_lastFoundIndex + 1, _lastFoundElements.length - 1);
    return _lastFoundElements[_lastFoundIndex];
  }
  if (target === 'previous') {
    if (_lastFoundElements.length === 0) return null;
    _lastFoundIndex = Math.max(_lastFoundIndex - 1, 0);
    return _lastFoundElements[_lastFoundIndex];
  }

  // Normal query
  const ranked = findAllRanked(target, 8);
  if (ranked.length > 0) {
    _lastFoundElements = ranked;
    _lastFoundIndex    = 0;
    _lastQuery         = target;
    return ranked[0];
  }
  return null;
}

// ── Scroll ────────────────────────────────────────────────────────────────────

function doScroll(direction, amount = 500) {
  switch (direction) {
    case 'down':      window.scrollBy({ top:  amount, behavior: 'smooth' }); break;
    case 'up':        window.scrollBy({ top: -amount, behavior: 'smooth' }); break;
    case 'right':     window.scrollBy({ left:  amount, behavior: 'smooth' }); break;
    case 'left':      window.scrollBy({ left: -amount, behavior: 'smooth' }); break;
    case 'bottom':    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); break;
    case 'top':       window.scrollTo({ top: 0, behavior: 'smooth' }); break;
    case 'page-down': window.scrollBy({ top:  window.innerHeight * 0.9, behavior: 'smooth' }); break;
    case 'page-up':   window.scrollBy({ top: -window.innerHeight * 0.9, behavior: 'smooth' }); break;
    case 'page-right':window.scrollBy({ left:  window.innerWidth * 0.9, behavior: 'smooth' }); break;
    case 'page-left': window.scrollBy({ left: -window.innerWidth * 0.9, behavior: 'smooth' }); break;
    default:          window.scrollBy({ top: amount, behavior: 'smooth' });
  }
  return `Scrolled ${direction} by ${amount === 99999 ? 'max' : amount}`;
}

// ── Click ─────────────────────────────────────────────────────────────────────

function doClick(target) {
  const el = resolveTarget(target);
  if (!el) return `No element found: "${target}"`;
  simulateMouse(el, 'mouseenter');
  simulateMouse(el, 'mouseover');
  simulateMouse(el, 'mousedown');
  simulateMouse(el, 'mouseup');
  el.click();
  return `Clicked: <${el.tagName.toLowerCase()}> "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 50)}"`;
}

function doDoubleClick(target) {
  const el = resolveTarget(target);
  if (!el) return `No element found: "${target}"`;
  el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window, detail: 2 }));
  return `Double-clicked: <${el.tagName.toLowerCase()}>`;
}

function doRightClick(target) {
  const el = resolveTarget(target);
  if (!el) return `No element found: "${target}"`;
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window }));
  return `Right-clicked: <${el.tagName.toLowerCase()}>`;
}

// ── Hover ─────────────────────────────────────────────────────────────────────

function doHover(target) {
  const el = resolveTarget(target);
  if (!el) return `No element found: "${target}"`;
  simulateMouse(el, 'mouseenter');
  simulateMouse(el, 'mouseover');
  simulateMouse(el, 'mousemove');
  return `Hovered: <${el.tagName.toLowerCase()}> "${(el.textContent || '').trim().slice(0, 40)}"`;
}

// ── Focus ─────────────────────────────────────────────────────────────────────

function doFocus(target) {
  const el = resolveTarget(target);
  if (!el) return `No element found: "${target}"`;
  el.focus();
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return `Focused: <${el.tagName.toLowerCase()}>`;
}

// ── Selection ─────────────────────────────────────────────────────────────────

function doSelect(target, optionText) {
  const el = resolveTarget(target);
  if (!el) return `No element found: "${target}"`;

  // <select> element
  if (el.tagName.toLowerCase() === 'select') {
    const opt = Array.from(el.options).find((o) =>
      o.text.toLowerCase().includes((optionText || '').toLowerCase())
    );
    if (!opt) return `Option "${optionText}" not found`;
    el.value = opt.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return `Selected "${opt.text}"`;
  }

  // Text selection
  if (window.getSelection) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return `Selected text in <${el.tagName.toLowerCase()}>`;
  }
  return 'Selection not supported here';
}

function doSelectAll() {
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
    active.select();
    return 'Selected all text in input';
  }
  document.execCommand('selectAll');
  return 'Selected all';
}

// ── Input ─────────────────────────────────────────────────────────────────────

function doInput(target, value) {
  const el = target ? resolveTarget(target) : document.activeElement;
  if (!el) return `No input found: "${target}"`;
  el.focus();
  // Support React-controlled inputs
  const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  if (nativeInputSetter && nativeInputSetter.set) {
    nativeInputSetter.set.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return `Typed "${value}" into <${el.tagName.toLowerCase()}>`;
}

// ── Submit ────────────────────────────────────────────────────────────────────

function doSubmit(target) {
  const el = target ? resolveTarget(target) : document.activeElement;
  if (!el) return `No element found: "${target}"`;
  const form = el.closest('form') || (el.tagName.toLowerCase() === 'form' ? el : null);
  if (form) {
    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) { submitBtn.click(); return 'Form submit button clicked'; }
    form.submit();
    return 'Form submitted';
  }
  el.click();
  return 'Element clicked for submit';
}

// ── Keyboard ─────────────────────────────────────────────────────────────────

function doKeyboard(shortcut) {
  const target = document.activeElement || document.body;
  switch (shortcut) {
    case 'enter':      pressKey(target, 'Enter',     'Enter',     13);  break;
    case 'escape':     pressKey(target, 'Escape',    'Escape',    27);  break;
    case 'tab':        pressKey(target, 'Tab',       'Tab',        9);  break;
    case 'space':      pressKey(target, ' ',         'Space',     32);  break;
    case 'backspace':  pressKey(target, 'Backspace', 'Backspace',  8);  break;
    case 'delete':     pressKey(target, 'Delete',    'Delete',    46);  break;
    case 'arrowup':    pressKey(target, 'ArrowUp',   'ArrowUp',   38);  break;
    case 'arrowdown':  pressKey(target, 'ArrowDown', 'ArrowDown', 40);  break;
    case 'arrowleft':  pressKey(target, 'ArrowLeft', 'ArrowLeft', 37);  break;
    case 'arrowright': pressKey(target, 'ArrowRight','ArrowRight',39);  break;
    default:           return `Unknown shortcut: ${shortcut}`;
  }
  return `Key pressed: ${shortcut}`;
}

// ── Clipboard ─────────────────────────────────────────────────────────────────

function doCopy()  { document.execCommand('copy');  return 'Copied selection'; }
function doPaste() { document.execCommand('paste'); return 'Pasted'; }
function doCut()   { document.execCommand('cut');   return 'Cut selection'; }
function doUndo()  { document.execCommand('undo');  return 'Undo executed'; }
function doRedo()  { document.execCommand('redo');  return 'Redo executed'; }

// ── Zoom ──────────────────────────────────────────────────────────────────────

let _zoom = 1.0;
function doZoom(direction) {
  if      (direction === 'in')    _zoom = Math.min(_zoom + 0.15, 3.0);
  else if (direction === 'out')   _zoom = Math.max(_zoom - 0.15, 0.3);
  else                            _zoom = 1.0;
  document.body.style.zoom = _zoom;
  return `Zoom: ${Math.round(_zoom * 100)}%`;
}

// ── Navigation ────────────────────────────────────────────────────────────────

function doNavigate(action, url) {
  switch (action) {
    case 'back':    history.back();           return 'Navigated back';
    case 'forward': history.forward();        return 'Navigated forward';
    case 'reload':  location.reload();        return 'Page reloaded';
    case 'home':    location.href = '/';      return 'Navigating home';
    case 'url':
      if (url) { location.href = url; return `Navigating to ${url}`; }
      return 'No URL provided';
    default:
      return `Unknown navigation: ${action}`;
  }
}

// ── Tab Management ────────────────────────────────────────────────────────────

function doTab(action) {
  if (typeof chrome === 'undefined' || !chrome.runtime) return 'Tab control requires extension context';
  chrome.runtime.sendMessage({ type: 'TAB_ACTION', action });
  return `Tab: ${action}`;
}

// ── Window focus ──────────────────────────────────────────────────────────────

function doWindowFocus() {
  window.focus();
  return 'Window focused';
}

// ── Drag & Drop ───────────────────────────────────────────────────────────────

function doDrag(fromTarget, toTarget) {
  const from = resolveTarget(fromTarget);
  const to   = resolveTarget(toTarget);
  if (!from) return `Source not found: "${fromTarget}"`;
  if (!to)   return `Target not found: "${toTarget}"`;
  const fromRect = from.getBoundingClientRect();
  const toRect   = to.getBoundingClientRect();
  const dt = new DataTransfer();
  from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt, clientX: fromRect.x, clientY: fromRect.y }));
  to.dispatchEvent(new DragEvent('dragover',   { bubbles: true, dataTransfer: dt, clientX: toRect.x,   clientY: toRect.y }));
  to.dispatchEvent(new DragEvent('drop',       { bubbles: true, dataTransfer: dt, clientX: toRect.x,   clientY: toRect.y }));
  from.dispatchEvent(new DragEvent('dragend',  { bubbles: true, dataTransfer: dt }));
  return `Dragged "${fromTarget}" → "${toTarget}"`;
}

// ── Scroll into view ──────────────────────────────────────────────────────────

function doScrollIntoView(target) {
  const el = resolveTarget(target);
  if (!el) return `No element found: "${target}"`;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return `Scrolled "${target}" into view`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export const ActionEngine = {
  scroll:          (dir, amt)         => doScroll(dir, amt),
  click:           (target)           => doClick(target),
  doubleClick:     (target)           => doDoubleClick(target),
  rightClick:      (target)           => doRightClick(target),
  hover:           (target)           => doHover(target),
  focus:           (target)           => doFocus(target),
  input:           (target, value)    => doInput(target, value),
  select:          (target, option)   => doSelect(target, option),
  selectAll:       ()                 => doSelectAll(),
  submit:          (target)           => doSubmit(target),
  keyboard:        (shortcut)         => doKeyboard(shortcut),
  copy:            ()                 => doCopy(),
  paste:           ()                 => doPaste(),
  cut:             ()                 => doCut(),
  undo:            ()                 => doUndo(),
  redo:            ()                 => doRedo(),
  zoom:            (dir)              => doZoom(dir),
  navigate:        (action, url)      => doNavigate(action, url),
  tab:             (action)           => doTab(action),
  windowFocus:     ()                 => doWindowFocus(),
  drag:            (from, to)         => doDrag(from, to),
  scrollIntoView:  (target)           => doScrollIntoView(target),
};
