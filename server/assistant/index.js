// Chooses between the Gemini assistant and the rule-based one, and keeps chat history.
import { ApiError } from '@google/genai';
import { all, run } from '../db.js';
import { aiEnabled, geminiReply } from './gemini.js';
import { EMERGENCY_REPLY, EMERGENCY_RE, fallbackReply, ruleReply } from './rules.js';

const HISTORY_TURNS = 20;

export function chatHistory(userId, limit = 50) {
  return all(
    'SELECT id, role, content, created_at FROM (SELECT * FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id',
    userId, limit,
  );
}

export async function reply(user, message) {
  const history = chatHistory(user.id, HISTORY_TURNS).map(({ role, content }) => ({ role, content }));
  run('INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)', user.id, 'user', message);

  let text;
  let mode = 'rules';
  if (EMERGENCY_RE.test(message)) {
    // Safety first: answer instantly and deterministically, whatever mode we're in.
    text = EMERGENCY_REPLY;
  } else if (aiEnabled()) {
    try {
      text = await geminiReply(user, history, message);
      mode = 'ai';
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 401 || err.status === 403) && /api key|permission|unauth/i.test(err.message)) {
        console.error('[assistant] The Gemini API key was rejected; using built-in assistant.', err.message);
      } else if (err instanceof ApiError && err.status === 429) {
        console.warn('[assistant] Gemini rate limit / free-tier quota reached; using built-in assistant.');
      } else if (err instanceof ApiError) {
        console.error(`[assistant] Gemini API error ${err.status}: ${err.message}`);
      } else {
        console.error('[assistant]', err);
      }
    }
  }
  text ??= ruleReply(user, message) ?? fallbackReply(user);

  run('INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)', user.id, 'assistant', text);
  return { reply: text, mode };
}
