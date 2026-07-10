/**
 * navigationManager.js — EcoVoice SPA Navigation & DOM Monitor
 *
 * Responsibilities:
 *  - Intercept SPA navigation (pushState, replaceState, popstate).
 *  - Monitor the DOM for unexpected HUD removal.
 *  - Notify content.js via a custom window event so it can re-inject the HUD.
 */
(function () {
  if (window.__ecoVoiceNavManagerLoaded) return;
  window.__ecoVoiceNavManagerLoaded = true;

  console.log('[EcoVoice] Navigation Manager loaded');

  function fireNav(source) {
    window.dispatchEvent(new CustomEvent('ecovoice:navigation', { detail: { source } }));
  }

  // 1. Patch history.pushState
  const _origPushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    _origPushState(...args);
    fireNav('pushState');
  };

  // 2. Patch history.replaceState
  const _origReplaceState = history.replaceState.bind(history);
  history.replaceState = function (...args) {
    _origReplaceState(...args);
    fireNav('replaceState');
  };

  // 3. Browser back/forward
  window.addEventListener('popstate', () => fireNav('popstate'));

  // 4. MutationObserver: detect if HUD was removed by the host page
  let _debounce = null;
  const observer = new MutationObserver(() => {
    if (sessionStorage.getItem('ecovoice_active') !== 'true') return;
    if (_debounce) return;
    _debounce = setTimeout(() => {
      _debounce = null;
      if (!document.getElementById('ecovoice-hud')) {
        fireNav('mutation_hud_removed');
      }
    }, 200);
  });

  // Wait for body to be available
  function startObserver() {
    const target = document.body || document.documentElement;
    if (target) {
      observer.observe(target, { childList: true, subtree: false });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: false });
      });
    }
  }
  startObserver();
})();
