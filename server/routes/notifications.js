import { Router } from 'express';
import { all, one, run } from '../db.js';
import { openStream } from '../notify.js';

const router = Router();

router.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({
    items: all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?', req.user.id, limit),
    unread: one('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0', req.user.id).n,
  });
});

router.post('/read', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : null;
  if (ids?.length) {
    run(`UPDATE notifications SET read = 1 WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`, req.user.id, ...ids);
  } else {
    run('UPDATE notifications SET read = 1 WHERE user_id = ?', req.user.id);
  }
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  run('DELETE FROM notifications WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

export const eventsHandler = openStream;
export default router;
