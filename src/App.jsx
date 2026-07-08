import React, { useState, useEffect, useRef } from 'react';

// ── Reusable core services (preserved for extension integration) ──────────────
import { createSpeechRecognition, RecognitionState } from './services/speechRecognition';
import { isAIAvailable } from './ai/aiCommandProcessor';
import { runHealthCheck } from './utils/systemHealth';

export default function App() {
  const [voiceReady, setVoiceReady] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const srRef = useRef(null);

  useEffect(() => {
    runHealthCheck();

    const sr = createSpeechRecognition({
      onStateChange: () => {},
      onResult: () => {},
      onError: () => {},
    });
    srRef.current = sr;
    setVoiceReady(sr.supported);
    setAiReady(isAIAvailable());

    return () => srRef.current?.stop();
  }, []);

  return (
    <div style={{ fontFamily: 'monospace', padding: '2rem' }}>
      <h1>EcoVoice Extension V1</h1>
    </div>
  );
}
