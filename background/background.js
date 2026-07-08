/**
 * background.js — EcoVoice Extension Service Worker
 *
 * Future responsibilities:
 *  - Manage persistent extension state across tabs.
 *  - Route messages between popup and content scripts via chrome.runtime.
 *  - Handle extension lifecycle events (onInstalled, onStartup, onSuspend).
 *  - Maintain a queue of pending voice commands when the popup is closed.
 *  - Coordinate AI processing (Groq) for commands that require background access.
 *  - Persist command history and session state to chrome.storage.local.
 *  - Implement keep-alive strategy for service worker longevity (MV3 constraint).
 */

// No logic implemented yet — architecture placeholder.
