/**
 * domReader.js — Phase 5E: Reusable DOM Reader
 *
 * Exposes page structure and state. Reusable by future AI modules.
 */

function isVisible(el) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const s = window.getComputedStyle(el);
  return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0;
}

function elInfo(el) {
  const r = el.getBoundingClientRect();
  return {
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || el.innerText || '').trim().slice(0, 120),
    ariaLabel: el.getAttribute('aria-label') || null,
    role: el.getAttribute('role') || null,
    href: el.getAttribute('href') || null,
    id: el.id || null,
    rect: { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) },
  };
}

export const DOMReader = {
  visibleButtons() {
    return Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'))
      .filter(isVisible).map(elInfo);
  },
  visibleInputs() {
    return Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'))
      .filter(isVisible).map(elInfo);
  },
  visibleLinks() {
    return Array.from(document.querySelectorAll('a[href]')).filter(isVisible).map(elInfo);
  },
  forms() {
    return Array.from(document.querySelectorAll('form')).map((f) => ({
      id: f.id || null,
      action: f.action || null,
      method: f.method || null,
      fields: Array.from(f.querySelectorAll('input, select, textarea')).map(elInfo),
    }));
  },
  headings() {
    return Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      .filter(isVisible)
      .map((h) => ({ level: parseInt(h.tagName[1]), text: h.textContent.trim() }));
  },
  lists() {
    return Array.from(document.querySelectorAll('ul, ol')).filter(isVisible).map((l) => ({
      type: l.tagName.toLowerCase(),
      items: Array.from(l.querySelectorAll('li')).map((li) => li.textContent.trim().slice(0, 80)),
    }));
  },
  menus() {
    return Array.from(document.querySelectorAll('nav, [role="menu"], [role="menubar"], [role="navigation"]'))
      .filter(isVisible).map(elInfo);
  },
  dialogs() {
    return Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog'))
      .filter(isVisible).map(elInfo);
  },
  tables() {
    return Array.from(document.querySelectorAll('table')).filter(isVisible).map((t) => ({
      rows: t.querySelectorAll('tr').length,
      cols: t.querySelector('tr') ? t.querySelector('tr').querySelectorAll('td,th').length : 0,
      caption: t.querySelector('caption') ? t.querySelector('caption').textContent.trim() : null,
    }));
  },
  activeElement() { return document.activeElement ? elInfo(document.activeElement) : null; },
  focusedElement() { return document.activeElement ? elInfo(document.activeElement) : null; },
  scrollPosition() {
    return { x: Math.round(window.scrollX), y: Math.round(window.scrollY), maxY: document.body.scrollHeight };
  },
  pageTitle() { return document.title; },
  url() { return location.href; },
  metadata() {
    const meta = {};
    document.querySelectorAll('meta[name], meta[property]').forEach((m) => {
      const k = m.getAttribute('name') || m.getAttribute('property');
      if (k) meta[k] = m.getAttribute('content');
    });
    return meta;
  },
  snapshot() {
    return {
      url: this.url(),
      title: this.pageTitle(),
      scroll: this.scrollPosition(),
      activeElement: this.activeElement(),
      buttons: this.visibleButtons(),
      inputs: this.visibleInputs(),
      links: this.visibleLinks(),
      headings: this.headings(),
    };
  },
};
