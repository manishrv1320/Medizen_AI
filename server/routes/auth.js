import { Router } from 'express';
import { all, one, run } from '../db.js';
import {
  USER_COLUMNS, createSession, destroySession, hashPassword, loginThrottle, requireAuth, userFromRequest, verifyPassword,
} from '../auth.js';
import { listProfiles, UserError } from '../services.js';
import { notify } from '../notify.js';
import { aiEnabled } from '../assistant/gemini.js';

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validTimezone(tz) {
  try {
    if (tz) new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz || null;
  } catch {
    return null;
  }
}

/** Link any shares that were waiting for this email address, and let the new member know. */
function claimPendingShares(user) {
  const pending = all(
    `SELECT fs.id, u.name AS owner_name FROM family_shares fs JOIN users u ON u.id = fs.owner_id
      WHERE fs.member_email = ? AND fs.member_user_id IS NULL`,
    user.email,
  );
  for (const share of pending) {
    run('UPDATE family_shares SET member_user_id = ? WHERE id = ?', user.id, share.id);
    notify(user.id, {
      title: `${share.owner_name} shared their health records with you`,
      body: 'You can now view their reports, readings and reminders from the profile switcher.',
      type: 'family', link: '#/family',
    });
  }
}

router.post('/signup', loginThrottle, (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!name) throw new UserError('Please tell us your name.');
  if (!EMAIL_RE.test(email)) throw new UserError('Please enter a valid email address.');
  if (password.length < 8) throw new UserError('Password must be at least 8 characters.');
  if (one('SELECT id FROM users WHERE email = ?', email)) throw new UserError('An account with this email already exists. Try signing in.');

  const timezone = validTimezone(req.body.timezone) || 'Asia/Kolkata';
  const { lastInsertRowid } = run(
    'INSERT INTO users (name, email, password_hash, timezone) VALUES (?, ?, ?, ?)',
    name, email, hashPassword(password), timezone,
  );
  const user = one(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, lastInsertRowid);
  notify(user.id, {
    title: `Hi ${name.split(' ')[0]}, I'm ${user.assistant_name}, your health assistant`,
    body: 'Start by adding your latest checkup report and any daily medicines. I\'ll remind you, keep an eye on your numbers, and keep your family in the loop.',
    type: 'assistant', link: '#/dashboard',
  });
  claimPendingShares(user);
  createSession(res, user.id);
  res.status(201).json({ user });
});

router.post('/login', loginThrottle, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const row = one('SELECT id, password_hash FROM users WHERE email = ?', email);
  if (!row || !verifyPassword(String(req.body.password || ''), row.password_hash)) {
    return res.status(401).json({ error: 'That email and password don\'t match. Please try again.' });
  }
  const tz = validTimezone(req.body.timezone);
  if (tz) run('UPDATE users SET timezone = ? WHERE id = ?', tz, row.id);
  createSession(res, row.id);
  res.json({ user: one(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, row.id) });
});

router.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

// Lets the page check whether it is signed in without a 401 when it isn't.
router.get('/session', (req, res) => {
  res.json({ signedIn: Boolean(userFromRequest(req)) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user, profiles: listProfiles(req.user), aiEnabled: aiEnabled() });
});

const EDITABLE = ['name', 'dob', 'gender', 'blood_group', 'height_cm', 'phone', 'conditions', 'allergies', 'assistant_name', 'voice_enabled', 'timezone'];

router.put('/me', requireAuth, (req, res) => {
  const updates = {};
  for (const key of EDITABLE) {
    if (!(key in req.body)) continue;
    let v = req.body[key];
    if (typeof v === 'string') v = v.trim();
    if (v === '') v = null;
    if (key === 'height_cm' && v !== null) v = Number(v) || null;
    if (key === 'voice_enabled') v = v ? 1 : 0;
    if (key === 'timezone' && !validTimezone(v)) continue;
    if ((key === 'name' || key === 'assistant_name') && !v) throw new UserError(`${key === 'name' ? 'Name' : 'Assistant name'} can't be empty.`);
    updates[key] = v;
  }
  const keys = Object.keys(updates);
  if (keys.length) {
    run(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => updates[k]), req.user.id);
  }
  res.json({ user: one(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, req.user.id) });
});

router.put('/password', requireAuth, (req, res) => {
  const row = one('SELECT password_hash FROM users WHERE id = ?', req.user.id);
  if (!verifyPassword(String(req.body.current || ''), row.password_hash)) throw new UserError('Your current password is incorrect.');
  if (String(req.body.next || '').length < 8) throw new UserError('New password must be at least 8 characters.');
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(req.body.next), req.user.id);
  res.json({ ok: true });
});

export default router;
