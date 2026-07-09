import React, { useState, useEffect, useRef } from 'react';

// ── Reusable core services (preserved for extension integration) ──────────────
import { createSpeechRecognition, RecognitionState } from './services/speechRecognition';
import { isAIAvailable } from './ai/aiCommandProcessor';
import { runHealthCheck } from './utils/systemHealth';
import { parseCommand } from './parser/commandParser';

export default function App() {
  const [micStatus, setMicStatus] = useState(RecognitionState.IDLE);
  const [voiceReady, setVoiceReady] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const srRef = useRef(null);

  useEffect(() => {
    runHealthCheck();

    const sr = createSpeechRecognition({
      onStateChange: (nextState) => setMicStatus(nextState),
      onResult: (text) => {
        const intentJson = parseCommand(text);
        console.log(JSON.stringify(intentJson, null, 2));
      },
      onError: (err) => console.error(err),
    });
    srRef.current = sr;
    setVoiceReady(sr.supported);
    setAiReady(isAIAvailable());

    return () => srRef.current?.stop();
  }, []);

  const toggleMic = () => {
    if (!srRef.current) return;
    if (micStatus === RecognitionState.IDLE || micStatus === RecognitionState.ERROR) {
      srRef.current.start();
    } else {
      srRef.current.stop();
    }
  };

  const isListening = micStatus === RecognitionState.LISTENING
    || micStatus === RecognitionState.PROCESSING
    || micStatus === RecognitionState.SPEAKING;

  return (
    <div style={{ fontFamily: 'monospace', padding: '2rem' }}>
      <h1>EcoVoice Extension V1</h1>
      <div style={{ marginTop: '1rem' }}>
        <button 
          onClick={toggleMic}
          style={{
            padding: '0.5rem 1rem',
            background: isListening ? '#ffebee' : '#e3f2fd',
            border: '1px solid #ccc',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          {isListening ? 'Listening...' : 'Start Listening'}
        </button>
      </div>
      <div style={{ marginTop: '1rem', fontSize: '0.85rem', color: '#666' }}>
        <p>Voice Ready: {voiceReady ? '✓' : '✗'}</p>
        <p>AI Ready: {aiReady ? '✓' : '✗'}</p>
      </div>
    </div>
  );
}
