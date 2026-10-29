import { Router } from 'express';
import { run } from '../db.js';
import { chatHistory, reply } from '../assistant/index.js';
import { dashboardGreeting } from '../assistant/briefing.js';
import { aiEnabled } from '../assistant/gemini.js';
import { UserError } from '../services.js';

const router = Router();

router.get('/history', (req, res) => {
  res.json({ messages: chatHistory(req.user.id), greeting: dashboardGreeting(req.user.id), aiEnabled: aiEnabled() });
});

router.post('/chat', async (req, res) => {
  const message = String(req.body.message || '').trim();
  if (!message) throw new UserError('Say something to your assistant.');
  if (message.length > 2000) throw new UserError('That message is a little long. Please keep it under 2000 characters.');
  res.json(await reply(req.user, message));
});

router.delete('/history', (req, res) => {
  run('DELETE FROM chat_messages WHERE user_id = ?', req.user.id);
  res.json({ ok: true });
});

export default router;
