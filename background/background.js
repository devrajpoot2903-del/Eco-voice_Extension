/**
 * background.js — EcoVoice Extension Service Worker
 *
 * Handles tab management commands forwarded from ActionEngine,
 * plus extension lifecycle events.
 */

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

// ── Extension Lifecycle ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  console.log('[EcoVoice] Extension installed / updated');
});
