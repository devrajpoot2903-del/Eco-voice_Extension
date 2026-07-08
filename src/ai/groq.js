/**
 * groq.js — EcoVoice Groq Service Layer
 *
 * Provides a clean, reusable interface to Groq (llama-3.3-70b-versatile).
 * Replaces the former gemini.js.
 * Only used for direct single-turn or chat functionality.
 * Does NOT touch task logic, parser, or any existing feature.
 */

import Groq from 'groq-sdk';

// ─── Client initialisation ─────────────────────────────────────────────────────

const API_KEY = import.meta.env.VITE_GROQ_API_KEY;

if (!API_KEY || API_KEY === 'your_groq_api_key_here') {
  console.warn(
    '[EcoVoice/Groq] VITE_GROQ_API_KEY is not set. ' +
    'Add your key to the .env file to enable AI features.'
  );
}

const groq = new Groq({
  apiKey:                  API_KEY || '',
  dangerouslyAllowBrowser: true, // required for Vite/browser environments
});

const MODEL = 'llama-3.3-70b-versatile';

// ─── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are EcoVoice Assistant — a helpful, concise productivity AI
built into the EcoVoice task manager app.
Help users with task planning, productivity tips, and brief questions.
Keep responses short and practical.
Do not offer to create, delete, or modify tasks — that is handled by voice commands.`;

// ─── sendMessage — single-turn ─────────────────────────────────────────────────

/**
 * Send a single message to Groq and receive a plain-text reply.
 *
 * @param {string} message
 * @returns {Promise<string>}
 */
export async function sendMessage(message) {
  if (!message || typeof message !== 'string' || message.trim() === '') {
    return 'Please enter a valid message.';
  }

  if (!API_KEY || API_KEY === 'your_groq_api_key_here') {
    return 'Groq API key is not configured. Please add VITE_GROQ_API_KEY to your .env file.';
  }

  try {
    const completion = await groq.chat.completions.create({
      model:       MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: message.trim() },
      ],
      temperature: 0.7,
      max_tokens:  512,
    });

    return completion.choices[0]?.message?.content?.trim()
      || 'No response received from Groq.';

  } catch (error) {
    console.error('[EcoVoice/Groq] API error:', error);

    if (error?.status === 401 || String(error?.message).includes('API_KEY')) {
      return 'Invalid Groq API key. Please check your VITE_GROQ_API_KEY in .env.';
    }
    if (error?.status === 429) {
      return 'Groq rate limit reached. Please wait a moment and try again.';
    }
    if (error?.status === 503 || String(error?.message).includes('network')) {
      return 'Unable to reach Groq. Please check your internet connection.';
    }

    return `Groq error: ${error?.message || 'Unknown error occurred.'}`;
  }
}

// ─── createChatSession — multi-turn ───────────────────────────────────────────

/**
 * Creates a stateful multi-turn chat session with Groq.
 * History is managed client-side (Groq uses stateless completions).
 *
 * @returns {{ sendMessage: (msg: string) => Promise<string>, reset: () => void }}
 */
export function createChatSession() {
  if (!API_KEY || API_KEY === 'your_groq_api_key_here') {
    return {
      sendMessage: async () =>
        'Groq API key is not configured. Please add VITE_GROQ_API_KEY to your .env file.',
      reset: () => {},
    };
  }

  /** @type {Array<{ role: string, content: string }>} */
  let history = [];

  return {
    /**
     * Send a message within the conversation context.
     * @param {string} message
     * @returns {Promise<string>}
     */
    sendMessage: async (message) => {
      if (!message || message.trim() === '') return 'Please enter a valid message.';

      history.push({ role: 'user', content: message.trim() });

      try {
        const completion = await groq.chat.completions.create({
          model:    MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...history,
          ],
          temperature: 0.7,
          max_tokens:  512,
        });

        const reply = completion.choices[0]?.message?.content?.trim() || 'No response received.';
        history.push({ role: 'assistant', content: reply });
        return reply;

      } catch (error) {
        console.error('[EcoVoice/Groq] Chat error:', error);
        // Remove the user turn we just pushed so history stays consistent
        history.pop();
        if (error?.status === 429) return 'Rate limit reached. Please wait and try again.';
        return `Groq error: ${error?.message || 'Unknown error.'}`;
      }
    },

    /** Reset conversation history — starts a fresh chat. */
    reset: () => { history = []; },
  };
}

// ─── Quick test utility ────────────────────────────────────────────────────────

/**
 * Quick connectivity test. Sends "Hello" and logs the response.
 * Run from browser console: import('/src/services/groq.js').then(m => m.testGroq())
 *
 * @returns {Promise<string>}
 */
export async function testGroq() {
  console.log('[EcoVoice/Groq] Sending test message: "Hello"');
  const response = await sendMessage('Hello');
  console.log('[EcoVoice/Groq] Test response:', response);
  return response;
}
