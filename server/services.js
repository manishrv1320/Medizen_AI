// Domain operations shared by the HTTP routes, the scheduler and the assistant.
import { all, one, run } from './db.js';
import { broadcastChange, notify, notifyFamily } from './notify.js';
import {
  VITAL_TYPES, ageFrom, advancePast, assessMetric, assessVital, bmi, fmtDate, fmtWhen, formatVital,
} from './health.js';

// Access control

/** Profiles the user can see: their own plus everyone who shared with them. */
export function listProfiles(user) {
  const shared = all(
    `SELECT u.id, u.name, fs.relation, fs.access, fs.notify
       FROM family_shares fs JOIN users u ON u.id = fs.owner_id
      WHERE fs.member_user_id = ? ORDER BY u.name`,
    user.id,
  );
  return [{ id: user.id, name: user.name, relation: 'self', access: 'owner' }, ...shared];
}

/** Returns { id, name, access, timezone } or null if the user cannot see this profile. */
export function resolveProfile(user, pid) {
  if (pid === 'me' || Number(pid) === user.id) {
    return { id: user.id, name: user.name, access: 'owner', timezone: user.timezone };
  }
  const row = one(
    `SELECT u.id, u.name, u.timezone, fs.access, fs.relation
       FROM family_shares fs JOIN users u ON u.id = fs.owner_id
      WHERE fs.owner_id = ? AND fs.member_user_id = ?`,
    Number(pid), user.id,
  );
  return row || null;
}

export const canWrite = (profile) => profile.access === 'owner' || profile.access === 'manage';

// Vitals

export function addVital(ownerId, { type, value, value2 = null, note = null, recorded_at }, actor) {
  if (!VITAL_TYPES[type]) throw new UserError('Unknown vital type.');
  value = Number(value);
  value2 = value2 === null || value2 === '' || value2 === undefined ? null : Number(value2);
  if (!Number.isFinite(value) || value <= 0) throw new UserError('Please enter a valid reading.');
  if (type === 'bp' && !Number.isFinite(value2)) throw new UserError('Blood pressure needs both numbers, like 120/80.');

  const when = recorded_at ? new Date(recorded_at) : new Date();
  const { lastInsertRowid } = run(
    'INSERT INTO vitals (user_id, type, value, value2, note, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
    ownerId, type, value, value2, note || null, when.toISOString(),
  );
  const vital = one('SELECT * FROM vitals WHERE id = ?', lastInsertRowid);
  const assessment = assessVital(type, value, value2);

  if (assessment.level === 'urgent') {
    const owner = one('SELECT id, name FROM users WHERE id = ?', ownerId);
    const reading = `${VITAL_TYPES[type].label}: ${formatVital(vital)}`;
    notify(ownerId, {
      title: `${reading}: ${assessment.text}`,
      body: 'This reading needs attention. If you feel unwell, contact your doctor or emergency services right away.',
      type: 'urgent', link: '#/vitals',
    });
    notifyFamily(ownerId, {
      title: `${owner.name}'s ${reading}`,
      body: `${assessment.text}. You may want to check on ${owner.name}.`,
      type: 'urgent', link: '#/vitals',
    });
  } else if (actor && actor.id !== ownerId) {
    notify(ownerId, { title: `${actor.name} logged your ${VITAL_TYPES[type].label.toLowerCase()}`, body: formatVital(vital), link: '#/vitals' });
  }
  broadcastChange(ownerId, 'vitals');
  return { ...vital, assessment };
}

export function latestVitals(userId) {
  const rows = all(
    `SELECT v.* FROM vitals v
      WHERE v.user_id = ? AND v.id = (
        SELECT id FROM vitals WHERE user_id = v.user_id AND type = v.type ORDER BY recorded_at DESC, id DESC LIMIT 1)`,
    userId,
  );
  return Object.fromEntries(rows.map((v) => [v.type, { ...v, assessment: assessVital(v.type, v.value, v.value2) }]));
}

export function vitalHistory(userId, type, days = 90) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  return all(
    'SELECT * FROM vitals WHERE user_id = ? AND type = ? AND recorded_at >= ? ORDER BY recorded_at',
    userId, type, since,
  );
}

// Reports

export function getReport(ownerId, id) {
  const report = one('SELECT * FROM reports WHERE id = ? AND user_id = ?', id, ownerId);
  if (!report) return null;
  report.metrics = all('SELECT * FROM report_metrics WHERE report_id = ? ORDER BY id', id)
    .map((m) => ({ ...m, status: assessMetric(m) }));
  report.files = all('SELECT id, original_name, mime, size FROM report_files WHERE report_id = ?', id);
  return report;
}

export function listReports(ownerId, limit = 100) {
  return all(
    `SELECT r.*,
            (SELECT COUNT(*) FROM report_metrics m WHERE m.report_id = r.id) AS metric_count,
            (SELECT COUNT(*) FROM report_metrics m WHERE m.report_id = r.id
               AND ((m.ref_low IS NOT NULL AND m.value < m.ref_low) OR (m.ref_high IS NOT NULL AND m.value > m.ref_high))) AS abnormal_count,
            (SELECT COUNT(*) FROM report_files f WHERE f.report_id = r.id) AS file_count
       FROM reports r WHERE r.user_id = ? ORDER BY r.date DESC, r.id DESC LIMIT ?`,
    ownerId, limit,
  );
}

/** Latest value of each metric name across all reports, with status. */
export function latestMetrics(ownerId) {
  return all(
    `SELECT m.*, r.date, r.title AS report_title, r.id AS report_id
       FROM report_metrics m JOIN reports r ON r.id = m.report_id
      WHERE r.user_id = ? AND r.id = (
        SELECT r2.id FROM reports r2 JOIN report_metrics m2 ON m2.report_id = r2.id
         WHERE r2.user_id = r.user_id AND m2.name = m.name ORDER BY r2.date DESC, r2.id DESC LIMIT 1)
      ORDER BY m.name`,
    ownerId,
  ).map((m) => ({ ...m, status: assessMetric(m) }));
}

export function metricTrend(ownerId, name) {
  return all(
    `SELECT m.value, m.unit, m.ref_low, m.ref_high, r.date FROM report_metrics m JOIN reports r ON r.id = m.report_id
      WHERE r.user_id = ? AND m.name = ? ORDER BY r.date`,
    ownerId, name,
  );
}

export function announceReport(ownerId, reportId, actor) {
  const owner = one('SELECT id, name FROM users WHERE id = ?', ownerId);
  const report = getReport(ownerId, reportId);
  const abnormal = report.metrics.filter((m) => m.status !== 'normal');
  const detail = abnormal.length
    ? `${abnormal.length} value${abnormal.length > 1 ? 's' : ''} outside the normal range: ${abnormal.map((m) => m.name).join(', ')}.`
    : 'All recorded values are within normal range.';
  if (actor.id !== ownerId) {
    notify(ownerId, { title: `${actor.name} added a report to your records: ${report.title}`, body: detail, link: `#/reports/${reportId}` });
  }
  notifyFamily(ownerId, {
    title: `New report for ${owner.name}: ${report.title}`,
    body: detail,
    type: abnormal.length ? 'warning' : 'info',
    link: `#/reports/${reportId}`,
  });
  broadcastChange(ownerId, 'reports');
}

// Reminders

export const REMINDER_CATEGORIES = ['medication', 'checkup', 'appointment', 'test', 'exercise', 'other'];
export const FREQUENCIES = ['once', 'daily', 'weekly', 'monthly', 'yearly'];

export function createReminder(ownerId, { title, category = 'other', notes = null, frequency = 'once', next_due_at }) {
  title = String(title || '').trim();
  if (!title) throw new UserError('Give the reminder a title.');
  if (!REMINDER_CATEGORIES.includes(category)) category = 'other';
  if (!FREQUENCIES.includes(frequency)) frequency = 'once';
  const due = new Date(next_due_at);
  if (Number.isNaN(due.getTime())) throw new UserError('Pick a valid date and time.');
  const { lastInsertRowid } = run(
    'INSERT INTO reminders (user_id, title, category, notes, frequency, next_due_at) VALUES (?, ?, ?, ?, ?, ?)',
    ownerId, title, category, notes || null, frequency, due.toISOString(),
  );
  broadcastChange(ownerId, 'reminders');
  return one('SELECT * FROM reminders WHERE id = ?', lastInsertRowid);
}

export function completeReminder(ownerId, id) {
  const r = one('SELECT * FROM reminders WHERE id = ? AND user_id = ?', id, ownerId);
  if (!r) return null;
  const now = new Date().toISOString();
  if (r.frequency === 'once') {
    run('UPDATE reminders SET active = 0, last_done_at = ?, snooze_until = NULL WHERE id = ?', now, id);
  } else {
    const next = advancePast(r.next_due_at, r.frequency, new Date());
    run(
      'UPDATE reminders SET next_due_at = ?, last_done_at = ?, snooze_until = NULL, notified_for = NULL, escalated_for = NULL WHERE id = ?',
      next, now, id,
    );
  }
  broadcastChange(ownerId, 'reminders');
  return one('SELECT * FROM reminders WHERE id = ?', id);
}

export function snoozeReminder(ownerId, id, minutes = 10) {
  const r = one('SELECT * FROM reminders WHERE id = ? AND user_id = ?', id, ownerId);
  if (!r) return null;
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  run('UPDATE reminders SET snooze_until = ?, notified_for = NULL WHERE id = ?', until, id);
  broadcastChange(ownerId, 'reminders');
  return one('SELECT * FROM reminders WHERE id = ?', id);
}

export function listReminders(ownerId, { includeInactive = false } = {}) {
  return all(
    `SELECT *, COALESCE(snooze_until, next_due_at) AS effective_due FROM reminders
      WHERE user_id = ? ${includeInactive ? '' : 'AND active = 1'} ORDER BY active DESC, effective_due`,
    ownerId,
  );
}

// Summary (dashboard + assistant)

export function healthSummary(ownerId) {
  const user = one('SELECT * FROM users WHERE id = ?', ownerId);
  const tz = user.timezone;
  const vitals = latestVitals(ownerId);
  const metrics = latestMetrics(ownerId);
  const reminders = listReminders(ownerId);
  const now = Date.now();
  const dayAhead = now + 24 * 3600_000;

  const lastFull = one(
    "SELECT id, title, date FROM reports WHERE user_id = ? AND type = 'Full Body Checkup' ORDER BY date DESC LIMIT 1",
    ownerId,
  );
  let nextCheckup = null;
  if (lastFull) {
    const due = new Date(lastFull.date);
    due.setFullYear(due.getFullYear() + 1);
    nextCheckup = { due: due.toISOString().slice(0, 10), overdue: due.getTime() < now };
  }

  return {
    profile: {
      id: user.id, name: user.name, age: ageFrom(user.dob), gender: user.gender, blood_group: user.blood_group,
      height_cm: user.height_cm, conditions: user.conditions, allergies: user.allergies, timezone: tz,
    },
    bmi: bmi(vitals.weight?.value, user.height_cm),
    vitals,
    attention_metrics: metrics.filter((m) => m.status !== 'normal'),
    metric_count: metrics.length,
    recent_reports: listReports(ownerId, 5),
    reminders_today: reminders
      .filter((r) => new Date(r.effective_due).getTime() <= dayAhead)
      .map((r) => ({ ...r, overdue: new Date(r.effective_due).getTime() < now, when: fmtWhen(r.effective_due, tz) })),
    upcoming: reminders
      .filter((r) => new Date(r.effective_due).getTime() > dayAhead && ['checkup', 'appointment', 'test'].includes(r.category))
      .slice(0, 5)
      .map((r) => ({ ...r, when: fmtWhen(r.effective_due, tz) })),
    last_full_checkup: lastFull ? { ...lastFull, date_label: fmtDate(lastFull.date, tz) } : null,
    next_checkup: nextCheckup,
  };
}

export class UserError extends Error {
  status = 400;
}
