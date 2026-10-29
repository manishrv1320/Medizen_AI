// Deterministic, personable summaries: used for the dashboard greeting, the morning
// notification and the rule-based assistant. No AI call needed.
import { one } from '../db.js';
import { healthSummary } from '../services.js';
import { VITAL_TYPES, formatVital, greetingFor } from '../health.js';

const TIPS = {
  bp: { watch: 'maybe go easy on salt today and fit in a short walk', high: 'please keep an eye on it and mention it to your doctor if it stays high', low: 'drink some water and stand up slowly' },
  sugar: { watch: 'a lighter, low-sugar meal would help', high: 'stay hydrated and keep sweets to a minimum today', low: 'have a quick snack with some sugar' },
  heart_rate: { high: 'try to rest and take a few slow breaths', low: 'if you feel dizzy, sit down and rest' },
  spo2: { watch: 'if you feel breathless at all, please call your doctor' },
  temperature: { high: 'rest, drink plenty of fluids, and check again in a few hours' },
};

export const firstName = (name) => String(name || '').split(' ')[0];

/**
 * Things worth mentioning, most important first. Each item is one friendly sentence.
 * `onDashboard`: the page already shows today's schedule and the flagged results, so the note
 * refers to them instead of repeating them.
 */
export function talkingPoints(userId, { onDashboard = false } = {}) {
  const s = healthSummary(userId);
  const points = [];

  const overdue = s.reminders_today.filter((r) => r.overdue);
  const later = s.reminders_today.filter((r) => !r.overdue);
  if (overdue.length) {
    points.push(`You still have ${overdue.length === 1 ? `**${overdue[0].title}** pending from ${overdue[0].when.replace('today at ', '')}` : `${overdue.length} pending reminders: ${overdue.map((r) => `**${r.title}**`).join(', ')}`}.`);
  }
  if (later.length && !onDashboard) {
    const list = later.slice(0, 4).map((r) => `**${r.title}** ${r.when.replace('today ', '')}`).join(', ');
    points.push(`Coming up: ${list}${later.length > 4 ? ` and ${later.length - 4} more` : ''}.`);
  }

  for (const [type, v] of Object.entries(s.vitals)) {
    const tip = TIPS[type]?.[v.assessment.level];
    if (v.assessment.level !== 'normal') {
      points.push(`Your last ${VITAL_TYPES[type].label.toLowerCase()} was ${formatVital(v)} (${v.assessment.text.toLowerCase()})${tip ? `, so ${tip}` : ''}.`);
    }
  }

  if (s.attention_metrics.length) {
    const n = s.attention_metrics.length;
    if (onDashboard) {
      const top = s.attention_metrics[0];
      points.push(`${n === 1 ? 'One result' : `${n} results`} from your reports ${n === 1 ? 'is' : 'are'} outside the normal range, ${n === 1 ? 'your' : 'including your'} ${top.name} at ${top.value} ${top.unit || ''}. They're listed below; worth going over with your doctor.`.replace(' .', '.'));
    } else {
      const names = s.attention_metrics.slice(0, 3).map((m) => `${m.name} (${m.value} ${m.unit || ''}, ${m.status})`.replace(' ,', ','));
      points.push(`From your reports, ${n === 1 ? 'one value needs' : `${n} values need`} attention${n > 3 ? ', including' : ''}: ${names.join('; ')}. Worth discussing with your doctor.`);
    }
  }

  const booked = s.upcoming.find((r) => r.category === 'checkup');
  if (s.next_checkup?.overdue) {
    points.push(booked
      ? `Your yearly full-body checkup is due, and it's booked for ${booked.when}.`
      : `Your yearly full-body checkup is due (last one was ${s.last_full_checkup.date_label}). Want me to set a reminder to book it?`);
  } else if (!s.last_full_checkup && s.recent_reports.length === 0) {
    points.push("I don't have any of your reports yet. Add your latest checkup and I'll keep track of the numbers.");
  }

  // Keep the briefing short: only mention later appointments when there isn't much else to say.
  const appointments = s.upcoming.filter((u) => u !== booked || !s.next_checkup?.overdue);
  if (points.length < 4 && !onDashboard) for (const u of appointments.slice(0, 2)) points.push(`Don't forget: **${u.title}** ${u.when}.`);

  return { summary: s, points };
}

export function dashboardGreeting(userId, options = {}) {
  const user = one('SELECT name, timezone, assistant_name FROM users WHERE id = ?', userId);
  const { points } = talkingPoints(userId, options);
  const greeting = `${greetingFor(user.timezone)}, ${firstName(user.name)}.`;
  const lines = points.length ? points : ["Nothing needs your attention today. If you can, fit in a short walk."];
  return { assistant: user.assistant_name, greeting, lines };
}

/** Morning notification, only sent when there is something worth saying. */
export function morningBriefing(userId) {
  const user = one('SELECT name, timezone, assistant_name FROM users WHERE id = ?', userId);
  const { points, summary } = talkingPoints(userId);
  if (!summary.reminders_today.length && !points.length) return null;
  return {
    title: `${greetingFor(user.timezone)}, ${firstName(user.name)}. Here's your day.`,
    body: points.map((p) => p.replace(/\*\*/g, '')).join(' '),
  };
}
