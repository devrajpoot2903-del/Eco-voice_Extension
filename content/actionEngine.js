/**
 * actionEngine.js — Phase 5D: Generic Action Engine
 *
 * All browser interactions go through this engine. No duplicate logic.
 * Uses elementFinder for DOM resolution.
 */

import { findElement } from './elementFinder.js';

// ── Internal helpers ─────────────────────────────────────────────────────────

function simulateMouse(el, type) {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
}

function scrollBy(x, y) {
  window.scrollBy({ left: x, top: y, behavior: 'smooth' });
}

function scrollTo(x, y) {
  window.scrollTo({ left: x, top: y, behavior: 'smooth' });
}

// ── Scroll ────────────────────────────────────────────────────────────────────

function doScroll(direction, amount = 500) {
  switch (direction) {
    case 'down':     scrollBy(0, amount);  break;
    case 'up':       scrollBy(0, -amount); break;
    case 'right':    scrollBy(amount, 0);  break;
    case 'left':     scrollBy(-amount, 0); break;
    case 'bottom':   scrollTo(window.scrollX, document.body.scrollHeight); break;
    case 'top':      scrollTo(window.scrollX, 0); break;
    case 'page-down':scrollBy(0, window.innerHeight * 0.9);  break;
    case 'page-up':  scrollBy(0, -window.innerHeight * 0.9); break;
    default:         scrollBy(0, amount);
  }
  return `Scrolled ${direction}`;
}

// ── Click ─────────────────────────────────────────────────────────────────────

function doClick(target) {
  const el = findElement(target);
  if (!el) return `No element found: "${target}"`;
  simulateMouse(el, 'mouseenter');
  simulateMouse(el, 'mouseover');
  simulateMouse(el, 'mousedown');
  simulateMouse(el, 'mouseup');
  el.click();
  return `Clicked: <${el.tagName.toLowerCase()}> "${(el.textContent || '').trim().slice(0, 40)}"`;
}

function doDoubleClick(target) {
  const el = findElement(target);
  if (!el) return `No element found: "${target}"`;
  el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
  return `Double-clicked: <${el.tagName.toLowerCase()}>`;
}

function doRightClick(target) {
  const el = findElement(target);
  if (!el) return `No element found: "${target}"`;
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window }));
  return `Right-clicked: <${el.tagName.toLowerCase()}>`;
}

// ── Hover ─────────────────────────────────────────────────────────────────────

function doHover(target) {
  const el = findElement(target);
  if (!el) return `No element found: "${target}"`;
  simulateMouse(el, 'mouseenter');
  simulateMouse(el, 'mouseover');
  simulateMouse(el, 'mousemove');
  return `Hovered: <${el.tagName.toLowerCase()}>`;
}

// ── Focus ─────────────────────────────────────────────────────────────────────

function doFocus(target) {
  const el = findElement(target);
  if (!el) return `No element found: "${target}"`;
  el.focus();
  return `Focused: <${el.tagName.toLowerCase()}>`;
}

// ── Input ─────────────────────────────────────────────────────────────────────

function doInput(target, value) {
  const el = findElement(target);
  if (!el) return `No input found: "${target}"`;
  el.focus();
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return `Typed "${value}" into <${el.tagName.toLowerCase()}>`;
}

// ── Select ────────────────────────────────────────────────────────────────────

function doSelect(target, optionText) {
  const el = findElement(target);
  if (!el || el.tagName.toLowerCase() !== 'select') return `No <select> found: "${target}"`;
  const option = Array.from(el.options).find((o) =>
    o.text.toLowerCase().includes(optionText.toLowerCase())
  );
  if (!option) return `Option "${optionText}" not found`;
  el.value = option.value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return `Selected "${option.text}"`;
}

// ── Submit ────────────────────────────────────────────────────────────────────

function doSubmit(target) {
  const el = findElement(target);
  if (!el) return `No element found: "${target}"`;
  const form = el.closest('form') || (el.tagName.toLowerCase() === 'form' ? el : null);
  if (form) { form.submit(); return 'Form submitted'; }
  el.click();
  return 'Submit clicked';
}

// ── Clipboard ─────────────────────────────────────────────────────────────────

function doCopy() {
  document.execCommand('copy');
  return 'Copied selection';
}

function doPaste() {
  document.execCommand('paste');
  return 'Pasted';
}

function doCut() {
  document.execCommand('cut');
  return 'Cut selection';
}

// ── Undo / Redo ───────────────────────────────────────────────────────────────

function doUndo() {
  document.execCommand('undo');
  return 'Undo executed';
}

function doRedo() {
  document.execCommand('redo');
  return 'Redo executed';
}

// ── Zoom ──────────────────────────────────────────────────────────────────────

let _zoom = 1.0;
function doZoom(direction) {
  if (direction === 'in')        _zoom = Math.min(_zoom + 0.1, 3.0);
  else if (direction === 'out')  _zoom = Math.max(_zoom - 0.1, 0.3);
  else                           _zoom = 1.0;
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
  return `Tab action: ${action}`;
}

// ── Drag & Drop ───────────────────────────────────────────────────────────────

function doDrag(fromTarget, toTarget) {
  const from = findElement(fromTarget);
  const to   = findElement(toTarget);
  if (!from) return `Source not found: "${fromTarget}"`;
  if (!to)   return `Target not found: "${toTarget}"`;
  from.dispatchEvent(new DragEvent('dragstart', { bubbles: true }));
  to.dispatchEvent(new DragEvent('dragover',   { bubbles: true }));
  to.dispatchEvent(new DragEvent('drop',       { bubbles: true }));
  from.dispatchEvent(new DragEvent('dragend',  { bubbles: true }));
  return `Dragged "${fromTarget}" to "${toTarget}"`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export const ActionEngine = {
  scroll:      (dir, amt)          => doScroll(dir, amt),
  click:       (target)            => doClick(target),
  doubleClick: (target)            => doDoubleClick(target),
  rightClick:  (target)            => doRightClick(target),
  hover:       (target)            => doHover(target),
  focus:       (target)            => doFocus(target),
  input:       (target, value)     => doInput(target, value),
  select:      (target, option)    => doSelect(target, option),
  submit:      (target)            => doSubmit(target),
  copy:        ()                  => doCopy(),
  paste:       ()                  => doPaste(),
  cut:         ()                  => doCut(),
  undo:        ()                  => doUndo(),
  redo:        ()                  => doRedo(),
  zoom:        (dir)               => doZoom(dir),
  navigate:    (action, url)       => doNavigate(action, url),
  tab:         (action)            => doTab(action),
  drag:        (from, to)          => doDrag(from, to),
};
