/**
 * ttsService.js — Text-to-Speech Service
 * Provides human-in-the-loop voice feedback with hardened lifecycle.
 */

export async function speakText(text) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      console.warn('[EcoVoice TTS] Speech Synthesis API not supported.');
      return resolve();
    }

    if (!text || typeof text !== 'string') {
      return resolve();
    }

    let done = false;
    let safetyTimer = null;

    function finish() {
      if (done) return;
      done = true;

      if (safetyTimer) {
        clearTimeout(safetyTimer);
        safetyTimer = null;
      }

      // Restore mic using SR API: only restarts if not manually stopped
      if (window.ecoVoiceSR && typeof window.ecoVoiceSR.startAfterDelay === 'function') {
        window.ecoVoiceSR.startAfterDelay(400, { afterSpeech: true });
      }
      resolve();
    }

    // 15-second safety timer: if onend/onerror never fires, resolve and restore mic
    safetyTimer = setTimeout(() => {
      console.warn('[EcoVoice TTS] Utterance timed out after 15s.');
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
      finish();
    }, 15000);

    // Enter speaking state to drop stray recognition results and hard-stop mic
    if (window.ecoVoiceSR && typeof window.ecoVoiceSR.enterSpeaking === 'function') {
      window.ecoVoiceSR.enterSpeaking();
    } else if (window.ecoVoiceSR && typeof window.ecoVoiceSR.stop === 'function') {
      window.ecoVoiceSR.stop();
    }

    // Cancel any queued utterances to avoid backlog
    try {
      window.speechSynthesis.cancel();
    } catch (_) {}

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onend = () => {
      finish();
    };

    utterance.onerror = (e) => {
      console.error('[EcoVoice TTS] Error occurred:', e);
      finish();
    };

    try {
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.error('[EcoVoice TTS] Failed to call speak():', err);
      finish();
    }
  });
}
