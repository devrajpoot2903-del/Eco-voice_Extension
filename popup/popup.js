document.addEventListener('DOMContentLoaded', () => {
  const btnStart = document.getElementById('btn-start');
  const btnStop = document.getElementById('btn-stop');
  const outputBox = document.getElementById('output-box');
  const micStatusEl = document.getElementById('mic-status');

  // Helper to send messages to active tab
  function sendToTab(type, payload) {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, { type, payload });
        }
      });
    }
  }

  btnStart.addEventListener('click', () => {
    micStatusEl.textContent = 'Launching...';
    outputBox.textContent = 'EcoVoice HUD launched in the active tab.\nYou can safely close this popup.';
    
    btnStart.disabled = true;
    btnStop.disabled = false;

    sendToTab('LAUNCH_ECOVOICE');
  });

  btnStop.addEventListener('click', () => {
    micStatusEl.textContent = 'Stopped';
    outputBox.textContent = 'EcoVoice stopped.';
    
    btnStart.disabled = false;
    btnStop.disabled = true;

    // We can also tell the HUD to stop if needed, but the HUD has its own stop button.
    sendToTab('ECOVOICE_STOP_FROM_HUD'); // Reusing this intent for simplicity, though the HUD handles it now
  });
});
