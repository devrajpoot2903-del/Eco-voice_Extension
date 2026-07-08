import React, { useState, useEffect, useRef } from 'react';

// ── Reusable services (preserved for future extension integration) ─────────────
import { createSpeechRecognition, RecognitionState } from './services/speechRecognition';
import { isAIAvailable } from './services/aiCommandProcessor';
import { runHealthCheck } from './utils/systemHealth';

export default function App() {
  const [micStatus, setMicStatus] = useState(RecognitionState.IDLE);
  const [voiceReady, setVoiceReady] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const srRef = useRef(null);

  useEffect(() => {
    // Health check on startup (generic — no task dependency)
    const report = runHealthCheck();
    if (!report.healthy) {
      console.warn('[EcoVoice] Startup health issues:', report.issues);
    }

    // Probe speech recognition support
    const sr = createSpeechRecognition({
      onStateChange: (nextState) => setMicStatus(nextState),
      onResult: () => {},
      onError: () => {},
    });
    srRef.current = sr;
    setVoiceReady(sr.supported);

    // Probe AI availability
    setAiReady(isAIAvailable());

    return () => srRef.current?.stop();
  }, []);

  const statuses = [
    { label: 'Voice Engine Ready',    ready: voiceReady,  coming: false },
    { label: 'Parser Ready',          ready: true,        coming: false },
    { label: 'AI Service Ready',      ready: aiReady,     coming: false },
    { label: 'Browser Runtime',       ready: false,       coming: true  },
    { label: 'DOM Analyzer',          ready: false,       coming: true  },
    { label: 'Planner',               ready: false,       coming: true  },
    { label: 'Extension Runtime',     ready: false,       coming: true  },
  ];

  return (
    <div style={styles.root}>
      <div style={styles.card}>
        <h1 style={styles.title}>EcoVoice Extension</h1>
        <p style={styles.subtitle}>Status</p>
        <ul style={styles.list}>
          {statuses.map(({ label, ready, coming }) => (
            <li key={label} style={styles.item}>
              <span style={styles.icon}>
                {coming ? '⏳' : ready ? '✓' : '✗'}
              </span>
              <span style={coming ? styles.labelDim : styles.label}>
                {label}{coming ? ' (Coming Soon)' : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const styles = {
  root: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
    fontFamily: 'monospace',
  },
  card: {
    border: '1px solid #ccc',
    padding: '2rem 2.5rem',
    backgroundColor: '#fff',
    minWidth: '320px',
  },
  title: {
    fontSize: '1.25rem',
    fontWeight: 'bold',
    marginBottom: '0.25rem',
  },
  subtitle: {
    fontSize: '0.9rem',
    color: '#555',
    marginBottom: '1rem',
  },
  list: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    padding: '0.3rem 0',
    fontSize: '0.9rem',
  },
  icon: {
    width: '1.25rem',
    flexShrink: 0,
  },
  label: {
    color: '#111',
  },
  labelDim: {
    color: '#888',
  },
};
