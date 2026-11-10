/**
 * navigationManager.js — EcoVoice SPA Navigation & DOM Monitor (Phase 6)
 *
 * Handles:
 *  - SPA navigation (pushState, replaceState, popstate)
 *  - Cross-origin navigation detection via visibilitychange + focus
 *  - HUD disappearance via MutationObserver
 *  - Redirect / full document reload via document-unload monitoring
 *  - URL polling fallback for sites that bypass History API
 */
(function () {
  if (window.__ecoVoiceNavManagerLoaded) return;
  window.__ecoVoiceNavManagerLoaded = true;

  console.log('[EcoVoice] Navigation Manager v2 loaded');

  function fireNav(source) {
    window.dispatchEvent(new CustomEvent('ecovoice:navigation', { detail: { source, url: location.href } }));
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

  // 4. Hash change (some SPAs use hash routing)
  window.addEventListener('hashchange', () => fireNav('hashchange'));

  // 5. URL polling fallback (covers redirects / meta-refresh / non-History SPAs)
  let _lastUrl = location.href;
  setInterval(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      fireNav('url_poll');
    }
  }, 500);

  // 6. Page visibility restored (user switches back to tab)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (sessionStorage.getItem('ecovoice_active') === 'true') {
        setTimeout(() => fireNav('visibility_restored'), 300);
      }
    }
  });

  // 7. Window focus (cross-origin navigation brings focus back)
  window.addEventListener('focus', () => {
    if (sessionStorage.getItem('ecovoice_active') === 'true') {
      setTimeout(() => fireNav('window_focus'), 300);
    }
  });

  // 8. MutationObserver: detect HUD removal by host SPA framework
  let _debounce = null;
  const observer = new MutationObserver(() => {
    if (sessionStorage.getItem('ecovoice_active') !== 'true') return;
    if (_debounce) return;
    _debounce = setTimeout(() => {
      _debounce = null;
      if (!document.getElementById('ecovoice-hud')) {
        fireNav('mutation_hud_removed');
      }
    }, 250);
  });

  function startObserver() {
    const target = document.body || document.documentElement;
    if (target) {
      observer.observe(target, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }
  }
  startObserver();
})();
