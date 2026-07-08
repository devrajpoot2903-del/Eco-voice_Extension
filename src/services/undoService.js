/**
 * undoService.js — EcoVoice Single-Action Undo (Phase D1)
 * --------------------------------------------------------
 * Stores the LAST undoable action in memory (not persisted — undo is
 * session-scoped by design, like most voice assistants).
 *
 * Supported undoable intents:
 *   CREATE_TASK    → undo = delete the created task
 *   DELETE_TASK    → undo = restore the deleted task(s)
 *   COMPLETE_TASK  → undo = uncomplete the task
 *   PIN_TASK       → undo = unpin the task
 *   UNPIN_TASK     → undo = re-pin the task
 *
 * Shape stored:
 *   {
 *     intent:    string,        — original intent type
 *     snapshot:  Task[],        — full task objects affected (for restore)
 *     query:     string,        — query/task label used in command
 *   }
 */

let _lastAction = null;

/**
 * Record the last undoable action.
 *
 * @param {string}  intent    — intent that was executed
 * @param {string}  query     — task label / query used
 * @param {object[]} snapshot — task objects that were affected BEFORE mutation
 */
export function recordUndoAction(intent, query, snapshot = []) {
  _lastAction = { intent, query, snapshot };
  console.debug('[EcoVoice/Undo] Recorded:', intent, '| query:', query, '| snapshot count:', snapshot.length);
}

/**
 * Returns the last recorded action and clears it (one-shot undo).
 * Returns null if nothing is available.
 *
 * @returns {{ intent: string, query: string, snapshot: object[] } | null}
 */
export function popUndoAction() {
  const action = _lastAction;
  _lastAction = null;
  return action;
}

/**
 * Peek at the last action without consuming it.
 * @returns {{ intent: string, query: string, snapshot: object[] } | null}
 */
export function peekUndoAction() {
  return _lastAction;
}

/**
 * Clear the undo stack.
 */
export function clearUndo() {
  _lastAction = null;
}
