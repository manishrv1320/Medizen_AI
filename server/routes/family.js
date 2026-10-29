import { Router } from 'express';
import { all, one, run } from '../db.js';
import { notify } from '../notify.js';
import { UserError } from '../services.js';

const router = Router();
const ACCESS = ['view', 'manage'];

router.get('/', (req, res) => {
  const sharing = all(
    `SELECT fs.id, fs.member_email, fs.relation, fs.access, fs.notify, fs.created_at, u.name AS member_name
       FROM family_shares fs LEFT JOIN users u ON u.id = fs.member_user_id
      WHERE fs.owner_id = ? ORDER BY fs.created_at`,
    req.user.id,
  );
  const sharedWithMe = all(
    `SELECT fs.owner_id, u.name, u.email, fs.relation, fs.access, fs.notify
       FROM family_shares fs JOIN users u ON u.id = fs.owner_id
      WHERE fs.member_user_id = ? ORDER BY u.name`,
    req.user.id,
  );
  res.json({ sharing, sharedWithMe });
});

router.post('/', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError('Enter your family member\'s email address.');
  if (email === req.user.email.toLowerCase()) throw new UserError('That\'s your own email address.');
  if (one('SELECT id FROM family_shares WHERE owner_id = ? AND member_email = ?', req.user.id, email)) {
    throw new UserError('You already share your records with this person.');
  }
  const access = ACCESS.includes(req.body.access) ? req.body.access : 'view';
  const member = one('SELECT id FROM users WHERE email = ?', email);
  const { lastInsertRowid } = run(
    'INSERT INTO family_shares (owner_id, member_email, member_user_id, relation, access, notify) VALUES (?, ?, ?, ?, ?, ?)',
    req.user.id, email, member?.id ?? null, String(req.body.relation || '').trim() || null, access, req.body.notify === false ? 0 : 1,
  );
  if (member) {
    notify(member.id, {
      title: `${req.user.name} shared their health records with you`,
      body: access === 'manage'
        ? 'You can view and help manage their reports, readings and reminders.'
        : 'You can now view their reports, readings and reminders.',
      type: 'family', link: `#/dashboard?profile=${req.user.id}`,
    });
  }
  res.status(201).json({
    share: one('SELECT * FROM family_shares WHERE id = ?', lastInsertRowid),
    message: member
      ? 'Shared! They\'ll see your records right away.'
      : 'Saved. When they sign up with this email, they\'ll automatically get access.',
  });
});

router.put('/:id', (req, res) => {
  const share = one('SELECT * FROM family_shares WHERE id = ? AND owner_id = ?', Number(req.params.id), req.user.id);
  if (!share) return res.status(404).json({ error: 'Not found.' });
  const access = ACCESS.includes(req.body.access) ? req.body.access : share.access;
  const relation = req.body.relation !== undefined ? String(req.body.relation).trim() || null : share.relation;
  run('UPDATE family_shares SET access = ?, relation = ? WHERE id = ?', access, relation, share.id);
  res.json(one('SELECT * FROM family_shares WHERE id = ?', share.id));
});

router.delete('/:id', (req, res) => {
  run('DELETE FROM family_shares WHERE id = ? AND owner_id = ?', Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

// The member side: choose whether to get alerts, or stop viewing someone's records.
router.put('/incoming/:ownerId', (req, res) => {
  run('UPDATE family_shares SET notify = ? WHERE owner_id = ? AND member_user_id = ?', req.body.notify ? 1 : 0, Number(req.params.ownerId), req.user.id);
  res.json({ ok: true });
});

router.delete('/incoming/:ownerId', (req, res) => {
  run('DELETE FROM family_shares WHERE owner_id = ? AND member_user_id = ?', Number(req.params.ownerId), req.user.id);
  res.json({ ok: true });
});

export default router;
