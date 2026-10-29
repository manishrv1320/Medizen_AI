// Background loop: fires due reminders, escalates missed ones to family, and sends a morning briefing.
import { all, run } from './db.js';
import { notify, notifyFamily, push } from './notify.js';
import { advance, fmtTime, zonedParts } from './health.js';
import { morningBriefing } from './assistant/briefing.js';

const TICK_MS = 30_000;
const ESCALATE_AFTER_MIN = 60;
const BRIEFING_HOUR = 8;

function rollForwardMissed(now) {
  // A recurring reminder whose next occurrence has already arrived moves to that occurrence,
  // so a missed dose never blocks the following one.
  const rows = all("SELECT id, next_due_at, frequency FROM reminders WHERE active = 1 AND frequency != 'once' AND next_due_at <= ?", now.toISOString());
  for (const r of rows) {
    let due = r.next_due_at;
    let next = advance(due, r.frequency);
    if (new Date(next) > now) continue;
    while (new Date(next) <= now) {
      due = next;
      next = advance(due, r.frequency);
    }
    run('UPDATE reminders SET next_due_at = ?, snooze_until = NULL, notified_for = NULL, escalated_for = NULL WHERE id = ?', due, r.id);
  }
}

function fireDue(now) {
  const due = all(
    `SELECT r.*, u.name AS user_name, u.timezone, u.assistant_name, COALESCE(r.snooze_until, r.next_due_at) AS effective_due
       FROM reminders r JOIN users u ON u.id = r.user_id
      WHERE r.active = 1 AND COALESCE(r.snooze_until, r.next_due_at) <= ?
        AND (r.notified_for IS NULL OR r.notified_for != COALESCE(r.snooze_until, r.next_due_at))`,
    now.toISOString(),
  );
  for (const r of due) {
    const firstName = r.user_name.split(' ')[0];
    const line = r.category === 'medication'
      ? `Hey ${firstName}, it's time for your ${r.title}.`
      : `Hey ${firstName}, just a reminder: ${r.title}.`;
    notify(r.user_id, {
      title: line,
      body: r.notes || `Scheduled for ${fmtTime(r.next_due_at, r.timezone)}. Tap Done once you've taken care of it.`,
      type: 'reminder',
      link: '#/reminders',
    });
    push(r.user_id, 'reminder-due', { id: r.id, title: r.title, category: r.category, speech: line, from: r.assistant_name });
    run('UPDATE reminders SET notified_for = ? WHERE id = ?', r.effective_due, r.id);
  }
}

function escalateMissed(now) {
  const cutoff = new Date(now.getTime() - ESCALATE_AFTER_MIN * 60_000).toISOString();
  const missed = all(
    `SELECT r.*, u.name AS user_name, u.timezone FROM reminders r JOIN users u ON u.id = r.user_id
      WHERE r.active = 1 AND r.category IN ('medication', 'appointment')
        AND r.next_due_at <= ? AND (r.escalated_for IS NULL OR r.escalated_for != r.next_due_at)
        AND (r.last_done_at IS NULL OR r.last_done_at < r.next_due_at)`,
    cutoff,
  );
  for (const r of missed) {
    const at = fmtTime(r.next_due_at, r.timezone);
    notify(r.user_id, {
      title: `Did you get to "${r.title}"?`,
      body: `It was due at ${at}. Mark it done so I can keep your records accurate.`,
      type: 'warning', link: '#/reminders',
    });
    notifyFamily(r.user_id, {
      title: `${r.user_name} hasn't marked "${r.title}" as done`,
      body: `It was due at ${at}. You may want to check in with them.`,
      type: 'warning', link: '#/reminders',
    });
    run('UPDATE reminders SET escalated_for = ? WHERE id = ?', r.next_due_at, r.id);
  }
}

function sendBriefings(now) {
  for (const u of all('SELECT id, timezone, last_briefing_on FROM users')) {
    const p = zonedParts(now, u.timezone);
    const today = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
    if (p.hour < BRIEFING_HOUR || u.last_briefing_on === today) continue;
    run('UPDATE users SET last_briefing_on = ? WHERE id = ?', today, u.id);
    const briefing = morningBriefing(u.id);
    if (briefing) notify(u.id, { title: briefing.title, body: briefing.body, type: 'assistant', link: '#/dashboard' });
  }
}

export function tick(now = new Date()) {
  try {
    rollForwardMissed(now);
    fireDue(now);
    escalateMissed(now);
    sendBriefings(now);
  } catch (err) {
    console.error('[scheduler]', err);
  }
}

export function startScheduler() {
  tick();
  return setInterval(tick, TICK_MS);
}
