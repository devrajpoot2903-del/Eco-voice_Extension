/**
 * content.js — EcoVoice Extension Content Script
 *
 * Future responsibilities:
 *  - Inject into all browser tabs to enable DOM interaction.
 *  - Receive automation commands from the background service worker.
 *  - Analyse the active page DOM to extract interactive elements
 *    (buttons, inputs, links, forms) for use by the DOM Analyzer module.
 *  - Execute browser actions: click, fill, scroll, navigate.
 *  - Report page state snapshots back to the background worker.
 *  - Handle Stagehand / Playwright-style element targeting when integrated.
 *  - Operate safely within Chrome Extension content script sandbox constraints.
 */

// No DOM interaction implemented yet — architecture placeholder.

console.log("EcoVoice Extension V1 Loaded Successfully");

/**
 * Handle scrolling actions based on the parsed JSON intent.
 * @param {Object} command - The parsed JSON intent.
 */
function handleScroll(command) {
  if (command.direction === 'down') {
    window.scrollBy({
      top: 500,
      behavior: 'smooth'
    });
  } else if (command.direction === 'up') {
    window.scrollBy({
      top: -500,
      behavior: 'smooth'
    });
  }
}

/**
 * Action Dispatcher — routes commands to specific handlers.
 * @param {Object} command - The parsed JSON intent.
 */
function dispatchAction(command) {
  switch (command.intent) {
    case 'scroll':
      handleScroll(command);
      break;
    default:
      console.log("No handler implemented yet for intent: " + command.intent);
  }
}

// Phase 3 & 4: Receive parsed JSON intent from the popup and dispatch actions
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'ECOVOICE_COMMAND') {
      console.log("Received EcoVoice Command:\n" + JSON.stringify(message.payload, null, 2));
      dispatchAction(message.payload);
    }
  });
}
