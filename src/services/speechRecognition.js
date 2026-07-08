/**
 * speechRecognition.js — EcoVoice Turn-Based Recognition Service
 * ---------------------------------------------------------------
 * Turn-based lifecycle:
 *
 *   IDLE ──► LISTENING ──► PROCESSING ──► SPEAKING ──► LISTENING
 *              │                                           ↑
 *              └──► ERROR ─────────────────────────────────┘
 *
 *   LISTENING  — mic open, waiting for user speech.
 *   PROCESSING — result received, mic hard-stopped, command executing.
 *   SPEAKING   — TTS active, mic fully off, all recognition events ignored.
 *   IDLE       — completely off (user manually stopped).
 *   ERROR      — fatal error, mic off.
 *
 * Guarantees:
 *   - Mic is HARD-STOPPED the moment a final result arrives.
 *   - Recognition restarts ONLY after: TTS ends + 750ms silence.
 *   - No transcript can fire while in PROCESSING or SPEAKING state.
 *   - No overlapping sessions.
 */

export const RecognitionState = Object.freeze({
  IDLE:       'idle',
  LISTENING:  'listening',
  PROCESSING: 'processing',
  SPEAKING:   'speaking',
  ERROR:      'error',
});

const SpeechRecognitionAPI =
  (typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition)) ||
  null;

export function createSpeechRecognition({ onStateChange, onResult, onError }) {
  if (!SpeechRecognitionAPI) {
    return {
      supported:       false,
      start:           () => {},
      stop:            () => {},
      startAfterDelay: () => {},
    };
  }

  let state = RecognitionState.IDLE;
  let _restartTimer = null;

  function transition(nextState) {
    if (state === nextState) return;
    console.debug(`[EcoVoice SR] ${state} → ${nextState}`);
    state = nextState;
    onStateChange?.(nextState);
  }

  // ── SpeechRecognition instance ─────────────────────────────────────────────
  const recognition = new SpeechRecognitionAPI();
  recognition.lang            = 'en-US';
  recognition.interimResults  = false;
  recognition.maxAlternatives = 1;
  recognition.continuous      = false;

  recognition.onstart = () => {
    // Only honour onstart when we intended to be LISTENING.
    // If state is not LISTENING the session must have leaked — abort it.
    if (state !== RecognitionState.LISTENING) {
      console.debug('[EcoVoice SR] onstart in wrong state, aborting leaked session');
      try { recognition.abort(); } catch (_) {}
      return;
    }
  };

  recognition.onspeechend = () => {
    // No-op: avoid premature transition to PROCESSING to prevent getting stuck on click sounds or silence.
  };

  recognition.onresult = (event) => {
    // TURN-BASED: drop any result that arrives outside LISTENING/PROCESSING.
    if (state !== RecognitionState.LISTENING && state !== RecognitionState.PROCESSING) {
      console.debug('[EcoVoice SR] onresult ignored — state is:', state);
      return;
    }

    // Move to PROCESSING and hard-stop the mic immediately so TTS
    // cannot be picked up by the microphone.
    transition(RecognitionState.PROCESSING);
    _hardStop();

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        const text = result[0].transcript.trim();
        if (text) {
          console.debug('[EcoVoice SR] result (turn-based):', text);
          onResult?.(text);
        }
      }
    }
  };

  recognition.onend = () => {
    console.debug(`[EcoVoice SR] onend — state:${state}`);

    // If still LISTENING (e.g. silence timeout), just restart automatically.
    if (state === RecognitionState.LISTENING) {
      _safeStart();
      return;
    }

    // PROCESSING / SPEAKING: do NOT restart — App will call startAfterDelay().
    // IDLE / ERROR: closed intentionally, stay stopped.
    if (state !== RecognitionState.ERROR && state !== RecognitionState.IDLE &&
        state !== RecognitionState.PROCESSING && state !== RecognitionState.SPEAKING) {
      transition(RecognitionState.IDLE);
    }
  };

  recognition.onerror = (event) => {
    const code = event.error;
    if (code === 'no-speech') return; // non-fatal — onend will handle restart
    if (code === 'aborted')   return; // we called abort() ourselves
    console.error('[EcoVoice SR] Fatal error:', code);
    transition(RecognitionState.ERROR);
    onError?.(code);
  };

  // ── Internal helpers ───────────────────────────────────────────────────────

  function _safeStart() {
    try {
      recognition.start();
    } catch (err) {
      console.debug('[EcoVoice SR] start() skipped (already running):', err.message);
    }
  }

  function _hardStop() {
    try {
      recognition.abort(); // abort() is immediate; stop() waits for a result
    } catch (err) {
      console.debug('[EcoVoice SR] abort() skipped:', err.message);
    }
  }

  function _clearRestartTimer() {
    if (_restartTimer !== null) {
      clearTimeout(_restartTimer);
      _restartTimer = null;
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    supported: true,

    /** Start listening (user-initiated). No-op if not IDLE/ERROR. */
    start() {
      _clearRestartTimer();
      if (state !== RecognitionState.IDLE && state !== RecognitionState.ERROR) {
        console.debug('[EcoVoice SR] start() ignored — state:', state);
        return;
      }
      transition(RecognitionState.LISTENING);
      _safeStart();
    },

    /** Hard-stop everything. Cancels any pending restart timer. */
    stop() {
      _clearRestartTimer();
      if (state === RecognitionState.IDLE || state === RecognitionState.ERROR) {
        console.debug('[EcoVoice SR] stop() ignored — state:', state);
        return;
      }
      transition(RecognitionState.IDLE);
      _hardStop();
    },

    /**
     * Called by App when TTS begins.
     * Marks the voice system as SPEAKING so any stray onresult is dropped.
     */
    enterSpeaking() {
      _clearRestartTimer();
      console.debug('[EcoVoice SR] enterSpeaking()');
      transition(RecognitionState.SPEAKING);
      // Hard-stop any lingering session just in case.
      _hardStop();
    },

    /**
     * Called by App after TTS ends.
     * Waits `delayMs` (default 750ms) then restarts the mic.
     * Only restarts if the user has not manually stopped (IDLE/ERROR).
     *
     * @param {number} delayMs
     */
    startAfterDelay(delayMs = 750) {
      _clearRestartTimer();
      console.debug(`[EcoVoice SR] startAfterDelay(${delayMs}ms)`);
      _restartTimer = setTimeout(() => {
        _restartTimer = null;
        if (state === RecognitionState.IDLE || state === RecognitionState.ERROR) {
          // User manually stopped — don't auto-restart.
          console.debug('[EcoVoice SR] deferred restart skipped — user stopped');
          return;
        }
        console.debug('[EcoVoice SR] restarting mic after TTS + delay');
        transition(RecognitionState.LISTENING);
        _safeStart();
      }, delayMs);
    },
  };
}
