// Everything under /api/p/:pid: a health profile the signed-in user can see.
// pid is "me" or the id of a family member who shared their records.
import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR, all, one, run, tx } from '../db.js';
import { broadcastChange } from '../notify.js';
import {
  UserError, addVital, announceReport, canWrite, completeReminder, createReminder, getReport, healthSummary,
  latestMetrics, listReminders, listReports, metricTrend, resolveProfile, snoozeReminder, vitalHistory,
  FREQUENCIES, REMINDER_CATEGORIES,
} from '../services.js';
import { REPORT_TYPES, VITAL_TYPES } from '../health.js';
import { dashboardGreeting, firstName } from '../assistant/briefing.js';

const router = Router({ mergeParams: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase().slice(0, 10)}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => {
    const ok = /^(application\/pdf|image\/(png|jpe?g|webp|heic|heif))$/.test(file.mimetype);
    cb(ok ? null : new UserError('Only PDF and image files can be attached.'), ok);
  },
});

router.use((req, res, next) => {
  const profile = resolveProfile(req.user, req.params.pid);
  if (!profile) return res.status(404).json({ error: 'Profile not found or not shared with you.' });
  req.profile = profile;
  next();
});

function requireWrite(req, res, next) {
  if (!canWrite(req.profile)) return res.status(403).json({ error: `You have view-only access to ${req.profile.name}'s records.` });
  next();
}

// Rephrase second-person talking points for someone viewing a family member's profile.
function thirdPerson(text, name) {
  const n = firstName(name);
  return text
    .replace(/\bYou still have\b/g, `${n} still has`)
    .replace(/\bYour\b/g, `${n}'s`)
    .replace(/\byour\b/g, 'their')
    .replace(/ Want me to set a reminder to book it\?/g, '')
    .replace(/^Don't forget:/, 'Coming up:');
}

// Dashboard

router.get('/summary', (req, res) => {
  const summary = healthSummary(req.profile.id);
  const g = dashboardGreeting(req.profile.id, { onDashboard: true });
  const viewer = one('SELECT assistant_name, timezone FROM users WHERE id = ?', req.user.id);
  const greeting = req.profile.access === 'owner'
    ? g
    : { assistant: viewer.assistant_name, greeting: `Here's how ${firstName(req.profile.name)} is doing.`, lines: g.lines.map((l) => thirdPerson(l, req.profile.name)) };
  res.json({ ...summary, greeting, access: req.profile.access });
});

// Reports

router.get('/reports', (req, res) => res.json(listReports(req.profile.id)));

router.get('/reports/:id', (req, res) => {
  const report = getReport(req.profile.id, Number(req.params.id));
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  res.json(report);
});

router.post('/reports', requireWrite, upload.array('files', 6), (req, res) => {
  const cleanup = () => (req.files || []).forEach((f) => fs.rm(f.path, { force: true }, () => {}));
  try {
    const title = String(req.body.title || '').trim();
    const type = REPORT_TYPES.includes(req.body.type) ? req.body.type : 'Other';
    const date = String(req.body.date || '').slice(0, 10);
    if (!title) throw new UserError('Give the report a title.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UserError('Pick the report date.');

    let metrics = [];
    try {
      metrics = JSON.parse(req.body.metrics || '[]');
    } catch {
      throw new UserError('Could not read the test values.');
    }
    const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
    metrics = metrics
      .map((m) => ({ name: String(m.name || '').trim(), value: num(m.value), unit: String(m.unit || '').trim() || null, ref_low: num(m.ref_low), ref_high: num(m.ref_high) }))
      .filter((m) => m.name && Number.isFinite(m.value));

    const reportId = tx(() => {
      const { lastInsertRowid } = run(
        'INSERT INTO reports (user_id, title, type, date, provider, doctor, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        req.profile.id, title, type, date, req.body.provider || null, req.body.doctor || null, req.body.notes || null, req.user.id,
      );
      for (const m of metrics) {
        run('INSERT INTO report_metrics (report_id, name, value, unit, ref_low, ref_high) VALUES (?, ?, ?, ?, ?, ?)',
          lastInsertRowid, m.name, m.value, m.unit, Number.isFinite(m.ref_low) ? m.ref_low : null, Number.isFinite(m.ref_high) ? m.ref_high : null);
      }
      for (const f of req.files || []) {
        run('INSERT INTO report_files (report_id, stored_name, original_name, mime, size) VALUES (?, ?, ?, ?, ?)',
          lastInsertRowid, f.filename, f.originalname, f.mimetype, f.size);
      }
      return Number(lastInsertRowid);
    });
    announceReport(req.profile.id, reportId, req.user);
    res.status(201).json(getReport(req.profile.id, reportId));
  } catch (err) {
    cleanup();
    throw err;
  }
});

router.delete('/reports/:id', requireWrite, (req, res) => {
  const id = Number(req.params.id);
  if (!one('SELECT id FROM reports WHERE id = ? AND user_id = ?', id, req.profile.id)) return res.status(404).json({ error: 'Report not found.' });
  const files = all('SELECT stored_name FROM report_files WHERE report_id = ?', id);
  run('DELETE FROM reports WHERE id = ?', id);
  for (const f of files) fs.rm(path.join(UPLOAD_DIR, f.stored_name), { force: true }, () => {});
  broadcastChange(req.profile.id, 'reports');
  res.json({ ok: true });
});

router.get('/reports/:id/files/:fileId', (req, res) => {
  const file = one(
    `SELECT f.* FROM report_files f JOIN reports r ON r.id = f.report_id
      WHERE f.id = ? AND r.id = ? AND r.user_id = ?`,
    Number(req.params.fileId), Number(req.params.id), req.profile.id,
  );
  if (!file) return res.status(404).json({ error: 'File not found.' });
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.original_name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(path.join(UPLOAD_DIR, path.basename(file.stored_name)));
});

router.get('/metrics', (req, res) => res.json(latestMetrics(req.profile.id)));
router.get('/metrics/trend', (req, res) => res.json(metricTrend(req.profile.id, String(req.query.name || ''))));

// Vitals

router.get('/vitals', (req, res) => {
  const type = String(req.query.type || '');
  const days = Math.min(Number(req.query.days) || 90, 3650);
  if (type) {
    if (!VITAL_TYPES[type]) throw new UserError('Unknown vital type.');
    return res.json(vitalHistory(req.profile.id, type, days));
  }
  res.json(all('SELECT * FROM vitals WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 100', req.profile.id));
});

router.post('/vitals', requireWrite, (req, res) => {
  res.status(201).json(addVital(req.profile.id, req.body, req.user));
});

router.delete('/vitals/:id', requireWrite, (req, res) => {
  run('DELETE FROM vitals WHERE id = ? AND user_id = ?', Number(req.params.id), req.profile.id);
  broadcastChange(req.profile.id, 'vitals');
  res.json({ ok: true });
});

// Reminders

router.get('/reminders', (req, res) => {
  res.json(listReminders(req.profile.id, { includeInactive: req.query.all === '1' }));
});

router.post('/reminders', requireWrite, (req, res) => {
  res.status(201).json(createReminder(req.profile.id, req.body));
});

router.put('/reminders/:id', requireWrite, (req, res) => {
  const id = Number(req.params.id);
  const r = one('SELECT * FROM reminders WHERE id = ? AND user_id = ?', id, req.profile.id);
  if (!r) return res.status(404).json({ error: 'Reminder not found.' });
  const title = String(req.body.title ?? r.title).trim();
  if (!title) throw new UserError('Give the reminder a title.');
  const category = REMINDER_CATEGORIES.includes(req.body.category) ? req.body.category : r.category;
  const frequency = FREQUENCIES.includes(req.body.frequency) ? req.body.frequency : r.frequency;
  const due = req.body.next_due_at ? new Date(req.body.next_due_at) : new Date(r.next_due_at);
  if (Number.isNaN(due.getTime())) throw new UserError('Pick a valid date and time.');
  const active = req.body.active === undefined ? r.active : req.body.active ? 1 : 0;
  run(
    `UPDATE reminders SET title = ?, category = ?, notes = ?, frequency = ?, next_due_at = ?, active = ?,
            snooze_until = NULL, notified_for = NULL, escalated_for = NULL WHERE id = ?`,
    title, category, req.body.notes ?? r.notes, frequency, due.toISOString(), active, id,
  );
  broadcastChange(req.profile.id, 'reminders');
  res.json(one('SELECT * FROM reminders WHERE id = ?', id));
});

router.post('/reminders/:id/done', requireWrite, (req, res) => {
  const r = completeReminder(req.profile.id, Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'Reminder not found.' });
  res.json(r);
});

router.post('/reminders/:id/snooze', requireWrite, (req, res) => {
  const minutes = Math.min(Math.max(Number(req.body.minutes) || 10, 1), 24 * 60);
  const r = snoozeReminder(req.profile.id, Number(req.params.id), minutes);
  if (!r) return res.status(404).json({ error: 'Reminder not found.' });
  res.json(r);
});

router.delete('/reminders/:id', requireWrite, (req, res) => {
  run('DELETE FROM reminders WHERE id = ? AND user_id = ?', Number(req.params.id), req.profile.id);
  broadcastChange(req.profile.id, 'reminders');
  res.json({ ok: true });
});

export default router;
