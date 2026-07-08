/**
 * speechService.js — EcoVoice Text-To-Speech Service
 * ---------------------------------------------------
 * Wraps the native Web SpeechSynthesis API.
 *
 * ROOT CAUSES ADDRESSED:
 *
 * 1. RACE CONDITION — cancel() fires too early
 *    The speech recognition `onend` fires and transitions state to IDLE/PROCESSING.
 *    If App.jsx called stopSpeaking() on every state change, it would silently
 *    cancel the utterance before it starts. This file no longer calls cancel()
 *    in response to state changes — that responsibility is removed entirely.
 *    Only speak() and stopSpeaking() are exposed.
 *
 * 2. VOICE NOT LOADED — async voice list
 *    getVoices() returns [] on first call in Chrome. We use the voiceschanged
 *    event + a cached ref so voice selection is always deferred until ready.
 *
 * 3. UTTERANCE INTERRUPTED — speak() called before previous ends
 *    We call cancel() ONLY inside speak() itself, immediately before creating
 *    the new utterance. This is intentional and safe.
 *
 * 4. Chrome SpeechSynthesis BUG — utterance pauses after ~15 seconds
 *    We apply the keep-alive resume() hack for long utterances on Chrome.
 *
 * Public API:
 *   speak(text)      — speak text aloud; cancels any current speech first
 *   stopSpeaking()   — stop immediately
 *   isSpeaking()     — true if synthesis is active
 */

// ─── Voice cache ───────────────────────────────────────────────────────────────

let _cachedVoice = null;
let _voicesLoaded = false;

const PREFERRED_NAMES = [
  'google uk english female',
  'google us english',
  'samantha',   // macOS
  'karen',      // macOS AU
  'daniel',     // macOS UK
  'zira',       // Windows
  'david',      // Windows
];

function selectBestVoice(voices) {
  for (const name of PREFERRED_NAMES) {
    const match = voices.find((v) => v.name.toLowerCase().includes(name));
    if (match) {
      console.log(`[TTS] Voice selected: "${match.name}" (${match.lang})`);
      return match;
    }
  }
  const english = voices.find((v) => v.lang.startsWith('en-'));
  if (english) {
    console.log(`[TTS] Voice selected (fallback): "${english.name}" (${english.lang})`);
    return english;
  }
  console.warn('[TTS] No English voice found — using browser default');
  return null;
}

function loadVoices() {
  if (!window.speechSynthesis) return;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    _cachedVoice = selectBestVoice(voices);
    _voicesLoaded = true;
  }
}

// Prime voice cache immediately and on voiceschanged
if (typeof window !== 'undefined' && window.speechSynthesis) {
  loadVoices();
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    loadVoices();
    console.log('[TTS] voiceschanged — voice cache refreshed');
  });
}

// ─── Chrome keep-alive timer ───────────────────────────────────────────────────
// Chrome pauses SpeechSynthesis after ~14 seconds. Resume it proactively.

let _keepAliveTimer = null;

function startKeepAlive() {
  stopKeepAlive();
  _keepAliveTimer = setInterval(() => {
    if (window.speechSynthesis?.speaking && window.speechSynthesis.paused) {
      console.log('[TTS] Keep-alive: resuming paused synthesis');
      window.speechSynthesis.resume();
    }
  }, 10_000);
}

function stopKeepAlive() {
  if (_keepAliveTimer !== null) {
    clearInterval(_keepAliveTimer);
    _keepAliveTimer = null;
  }
}

// ─── speak() ──────────────────────────────────────────────────────────────────

/**
 * Speak the given text aloud.
 *
 * - Cancels any currently playing speech first.
 * - Applies voice selection with async fallback.
 * - Logs all lifecycle events for debugging.
 *
 * @param {string} text
 */
export function speak(text, { onStart, onEnd } = {}) {
  if (!text || typeof text !== 'string' || text.trim() === '') {
    console.warn('[TTS] speak() called with empty text — skipped');
    return;
  }

  if (!window.speechSynthesis) {
    console.error('[TTS] SpeechSynthesis is not supported in this browser');
    return;
  }

  // Load settings dynamically from localStorage
  let settings = { voiceEnabled: true, speed: 0.92, volume: 1.0 };
  try {
    const raw = window.localStorage.getItem('ecovoice:settings');
    if (raw) {
      settings = { ...settings, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.warn('[TTS] Failed to read settings from localStorage:', e);
  }

  // If voice is disabled, trigger callbacks immediately and skip speaking.
  if (!settings.voiceEnabled) {
    console.log('[TTS] Voice feedback is disabled in settings — skipping speak');
    onStart?.();
    setTimeout(() => {
      onEnd?.();
    }, 100);
    return;
  }

  console.log(`[TTS] Speaking: "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`);

  // Cancel anything already speaking
  window.speechSynthesis.cancel();

  // Small delay so cancel() fully flushes before we enqueue the new utterance.
  // This is the key fix for the "silent speak" Chrome bug where cancel() + speak()
  // called in the same tick results in the new utterance being swallowed.
  setTimeout(() => {
    // Read settings again to ensure the absolute latest values
    let settingsCurrent = { voiceEnabled: true, speed: 0.92, volume: 1.0 };
    try {
      const raw = window.localStorage.getItem('ecovoice:settings');
      if (raw) {
        settingsCurrent = { ...settingsCurrent, ...JSON.parse(raw) };
      }
    } catch (e) {}

    const utterance = new SpeechSynthesisUtterance(text.trim());
    utterance.rate = settingsCurrent.speed;
    utterance.pitch = 1.0;
    utterance.volume = settingsCurrent.volume;
    utterance.lang = 'en-US';

    // Apply best available voice
    if (_voicesLoaded && _cachedVoice) {
      utterance.voice = _cachedVoice;
      utterance.lang = _cachedVoice.lang;
    } else if (!_voicesLoaded) {
      // Voices not ready yet — try once more inline
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        _cachedVoice = selectBestVoice(voices);
        _voicesLoaded = true;
        if (_cachedVoice) {
          utterance.voice = _cachedVoice;
          utterance.lang = _cachedVoice.lang;
        }
      }
    }

    // ── Lifecycle event logging ──────────────────────────────────────────────
    utterance.onstart = () => {
      console.log('[TTS] Started — recognition suppressed');
      startKeepAlive();
      onStart?.();
    };

    utterance.onend = () => {
      console.log('[TTS] Ended — recognition restored');
      stopKeepAlive();
      onEnd?.();
    };

    utterance.onerror = (e) => {
      if (e.error === 'interrupted' || e.error === 'canceled') {
        console.log(`[TTS] Utterance ${e.error} (normal during cancel)`);
      } else {
        console.error(`[TTS] Error: ${e.error}`);
      }
      stopKeepAlive();
      onEnd?.(); // always lift suppression
    };

    utterance.onpause = () => console.log('[TTS] Paused');
    utterance.onresume = () => console.log('[TTS] Resumed');

    window.speechSynthesis.speak(utterance);
    console.log(`[TTS] Enqueued — queue length: ${window.speechSynthesis.pending ? 'pending' : 'none'}, speaking: ${window.speechSynthesis.speaking}`);
  }, 50); // 50ms flush delay — resolves Chrome cancel race condition
}

// ─── stopSpeaking() ────────────────────────────────────────────────────────────

/**
 * Immediately stop any active speech.
 */
export function stopSpeaking() {
  if (!window.speechSynthesis) return;
  console.log('[TTS] stopSpeaking() called');
  stopKeepAlive();
  window.speechSynthesis.cancel();
}

// ─── isSpeaking() ──────────────────────────────────────────────────────────────

/**
 * Returns true if synthesis is currently active.
 * @returns {boolean}
 */
export function isSpeaking() {
  return window.speechSynthesis?.speaking ?? false;
}
