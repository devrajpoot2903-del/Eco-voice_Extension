import { createSpeechRecognition, RecognitionState } from '../src/services/speechRecognition.js';
import { parseCommand } from '../src/parser/commandParser.js';

document.addEventListener('DOMContentLoaded', () => {
  const btnStart = document.getElementById('btn-start');
  const btnStop = document.getElementById('btn-stop');
  const outputBox = document.getElementById('output-box');
  const micStatusEl = document.getElementById('mic-status');

  const sr = createSpeechRecognition({
    onStateChange: (state) => {
      micStatusEl.textContent = state;
      
      const isListening = [
        RecognitionState.LISTENING,
        RecognitionState.PROCESSING,
        RecognitionState.SPEAKING
      ].includes(state);

      if (isListening) {
        btnStart.disabled = true;
        btnStop.disabled = false;
      } else {
        btnStart.disabled = false;
        btnStop.disabled = true;
      }
    },
    onResult: (text) => {
      // Process speech with parser
      const parsedObject = parseCommand(text);
      
      // Console out as required
      console.log(parsedObject);
      
      // Update UI
      outputBox.textContent = JSON.stringify(parsedObject, null, 2);

      // Send to active tab content script
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'ECOVOICE_COMMAND',
              payload: parsedObject
            });
          }
        });
      }
    },
    onError: (err) => {
      console.error("Speech Recognition Error:", err);
      outputBox.textContent = "Error: " + err;
    }
  });

  btnStart.addEventListener('click', () => {
    outputBox.textContent = "Listening...";
    sr.start();
  });

  btnStop.addEventListener('click', () => {
    sr.stop();
    outputBox.textContent = "Stopped.";
  });
});
