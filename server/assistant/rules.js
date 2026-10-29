// Rule-based assistant: works offline, with no API key. Understands common requests about
// reminders, readings, reports and family, and answers in a warm, conversational tone.
import { all, one } from '../db.js';
import {
  addVital, completeReminder, createReminder, latestMetrics, listProfiles, listReminders, metricTrend, vitalHistory,
} from '../services.js';
import { VITAL_TYPES, assessVital, fmtWhen, formatVital, zonedParts, zonedToUtc } from '../health.js';
import { dashboardGreeting, firstName, talkingPoints } from './briefing.js';

export const EMERGENCY_RE = /(chest pain|can'?t breathe|cannot breathe|trouble breathing|difficulty breathing|unconscious|passed out|fainted|stroke|face drooping|seizure|heart attack|severe bleeding|suicid|kill myself|end my life|overdose)/i;

export const EMERGENCY_REPLY =
  "I'm worried about what you just told me. **Please call emergency services right now: 112 in India** (or your local emergency number), or ask someone nearby to help you get to a hospital. " +
  "If you're thinking about harming yourself, you can call **Tele-MANAS at 14416** any time. I'm here, but a real person needs to help you right now.";

const VITAL_PATTERNS = [
  { type: 'bp', re: /(\d{2,3})\s*(?:\/|over)\s*(\d{2,3})/i },
  { type: 'sugar', re: /(?:sugar|glucose)\D{0,20}(\d{2,3}(?:\.\d+)?)/i },
  { type: 'weight', re: /weigh(?:t|ed|ing)?\D{0,15}(\d{2,3}(?:\.\d+)?)/i },
  { type: 'heart_rate', re: /(?:pulse|heart ?rate|hr)\D{0,15}(\d{2,3})/i },
  { type: 'spo2', re: /(?:spo2|sp o2|oxygen|o2)\D{0,15}(\d{2,3})/i },
  { type: 'temperature', re: /(?:temp(?:erature)?|fever)\D{0,15}(\d{2,3}(?:\.\d+)?)/i },
];

const VITAL_WORDS = {
  bp: /\b(bp|blood pressure|pressure)\b/i,
  sugar: /\b(sugar|glucose|diabet)/i,
  weight: /\b(weight|weigh|bmi)\b/i,
  heart_rate: /\b(pulse|heart ?rate)\b/i,
  spo2: /\b(spo2|oxygen|o2)\b/i,
  temperature: /\b(temp|temperature|fever)\b/i,
};

function guessCategory(text) {
  if (/\b(tablet|pill|medicine|medication|tab|capsule|insulin|dose|syrup|drops|inhaler)\b|\d+\s?mg\b/i.test(text)) return 'medication';
  if (/\b(doctor|dr\.?|appointment|dentist|clinic|hospital|consult)/i.test(text)) return 'appointment';
  if (/\b(check-?up)\b/i.test(text)) return 'checkup';
  if (/\b(test|scan|x-?ray|blood work|lab)\b/i.test(text)) return 'test';
  if (/\b(walk|exercise|yoga|gym|run|stretch)\b/i.test(text)) return 'exercise';
  return 'other';
}

/** Parse "remind me to take metformin every day at 9pm" → reminder fields. */
export function parseReminder(text, timeZone) {
  let rest = text.replace(/^.*?\b(remind me|set (?:a |an )?reminder|reminder)\s*(?:to|for|about)?\s*/i, '');
  let frequency = 'once';
  const freqRules = [
    [/\b(every ?day|daily|every morning|every night|every evening)\b/i, 'daily'],
    [/\b(every ?week|weekly|every (mon|tues|wednes|thurs|fri|satur|sun)day)\b/i, 'weekly'],
    [/\b(every ?month|monthly)\b/i, 'monthly'],
    [/\b(every ?year|yearly|annually)\b/i, 'yearly'],
  ];
  for (const [re, f] of freqRules) {
    if (re.test(rest)) { frequency = f; rest = rest.replace(re, ' '); break; }
  }

  let hour = null;
  let minute = 0;
  const t = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i.exec(rest) || /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/i.exec(rest);
  if (t) {
    hour = Number(t[1]);
    minute = Number(t[2] || 0);
    const mer = (t[3] || '').toLowerCase().replace(/\./g, '');
    if (mer === 'pm' && hour < 12) hour += 12;
    if (mer === 'am' && hour === 12) hour = 0;
    if (!mer && hour < 7) hour += 12; // "at 5" most likely means 5 PM
    rest = rest.replace(t[0], ' ');
  }
  const parts = [[/\b(in the )?morning\b/i, 8], [/\b(in the )?afternoon\b/i, 14], [/\b(in the )?evening\b/i, 18], [/\b(at )?night\b/i, 21]];
  for (const [re, h] of parts) {
    if (re.test(rest)) { if (hour === null) hour = h; rest = rest.replace(re, ' '); }
  }

  const now = new Date();
  const today = zonedParts(now, timeZone);
  let dayOffset = 0;
  if (/\btomorrow\b/i.test(rest)) { dayOffset = 1; rest = rest.replace(/\btomorrow\b/i, ' '); }
  rest = rest.replace(/\btoday\b/i, ' ');
  const inMatch = /\bin\s+(\d+)\s*(min(?:ute)?s?|hours?|hrs?)\b/i.exec(rest);

  let due;
  if (inMatch) {
    const n = Number(inMatch[1]);
    due = new Date(now.getTime() + n * (/^h/i.test(inMatch[2]) ? 3600_000 : 60_000));
    rest = rest.replace(inMatch[0], ' ');
  } else if (hour !== null) {
    due = zonedToUtc(today.year, today.month, today.day + dayOffset, hour, minute, timeZone);
    if (due <= now && dayOffset === 0) due = new Date(due.getTime() + 86400_000);
  } else if (dayOffset) {
    due = zonedToUtc(today.year, today.month, today.day + dayOffset, 9, 0, timeZone);
  } else {
    due = new Date(now.getTime() + 3600_000);
  }

  const title = rest.replace(/\b(my|to|at|on|for)\s*$/i, '').replace(/^\s*(to|about)\s+/i, '').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '');
  if (!title) return null;
  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    category: guessCategory(title),
    frequency,
    next_due_at: due.toISOString(),
  };
}

function trendSentence(userId, type) {
  const hist = vitalHistory(userId, type, 60);
  if (hist.length < 3) return '';
  const last = hist.at(-1);
  const prev = hist.slice(-8, -1);
  const avg = prev.reduce((s, v) => s + v.value, 0) / prev.length;
  const diff = last.value - avg;
  const pct = Math.abs(diff) / avg;
  if (pct < 0.03) return ' That\'s about where it usually is, nice and steady.';
  return diff > 0
    ? ` That's a bit higher than your recent average of ${Math.round(avg)}.`
    : ` That's lower than your recent average of ${Math.round(avg)}.`;
}

function describeVital(user, type) {
  const v = one('SELECT * FROM vitals WHERE user_id = ? AND type = ? ORDER BY recorded_at DESC LIMIT 1', user.id, type);
  const label = VITAL_TYPES[type].label.toLowerCase();
  if (!v) return `I don't have any ${label} readings for you yet. You can tell me one, like "my ${type === 'bp' ? 'BP is 120/80' : `${label} is ${type === 'weight' ? '70' : '100'}`}", and I'll log it.`;
  const a = assessVital(type, v.value, v.value2);
  let text = `Your last ${label} was **${formatVital(v)}** (${a.text.toLowerCase()}), recorded ${fmtWhen(v.recorded_at, user.timezone)}.`;
  text += trendSentence(user.id, type);
  if (type === 'weight' && user.height_cm) {
    const b = v.value / (user.height_cm / 100) ** 2;
    text += ` Your BMI is about **${b.toFixed(1)}**.`;
  }
  return text;
}

function remindersReply(user) {
  const items = listReminders(user.id);
  const dayEnd = Date.now() + 24 * 3600_000;
  const soon = items.filter((r) => new Date(r.effective_due).getTime() <= dayEnd);
  if (!soon.length) {
    return items.length
      ? `Nothing due in the next 24 hours. Your next one is **${items[0].title}** ${fmtWhen(items[0].effective_due, user.timezone)}.`
      : 'You have no reminders set. Try: "remind me to take my vitamin D every day at 9am".';
  }
  const lines = soon.map((r) => {
    const late = new Date(r.effective_due) < new Date();
    return `• **${r.title}**, ${fmtWhen(r.effective_due, user.timezone)}${late ? ' (still pending)' : ''}`;
  });
  return `Here's what's coming up for you:\n${lines.join('\n')}\n\nJust tell me "I took my ${soon[0].title.toLowerCase()}" when it's done.`;
}

function markDone(user, text) {
  const active = listReminders(user.id);
  const words = text.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !['took', 'taken', 'done', 'finished', 'completed', 'with'].includes(w));
  const named = active.find((r) => words.some((w) => r.title.toLowerCase().includes(w)));
  const soon = (r) => new Date(r.effective_due).getTime() <= Date.now() + 12 * 3600_000;
  if (named && !soon(named)) {
    return `Nice! Your next **${named.title}** isn't due until ${fmtWhen(named.effective_due, user.timezone)}. I'll remind you then.`;
  }
  const due = active.filter((r) => new Date(r.effective_due).getTime() <= Date.now() + 2 * 3600_000);
  const match = named || (due.length === 1 ? due[0] : null);
  if (!match) {
    return due.length
      ? `Which one did you finish? ${due.map((r) => `**${r.title}**`).join(', ')}`
      : "There's nothing due right now, but thanks for letting me know.";
  }
  const updated = completeReminder(user.id, match.id);
  const next = updated.active ? ` Next one is ${fmtWhen(updated.next_due_at, user.timezone)}.` : '';
  return `Great job, ${firstName(user.name)}! I've marked **${match.title}** as done.${next}`;
}

function reportsReply(user, text) {
  const metrics = latestMetrics(user.id);
  const hit = metrics.find((m) => text.toLowerCase().includes(m.name.toLowerCase().split(' ')[0].replace(/[()]/g, '')));
  if (hit) {
    const trend = metricTrend(user.id, hit.name);
    const range = [hit.ref_low, hit.ref_high].every((x) => x != null) ? ` (normal ${hit.ref_low}–${hit.ref_high})` : '';
    let msg = `Your latest **${hit.name}** is **${hit.value} ${hit.unit || ''}**${range} from ${hit.report_title}, which is ${hit.status === 'normal' ? 'within the normal range' : `**${hit.status}**`}.`;
    if (trend.length > 1) msg += ` Earlier: ${trend.slice(0, -1).slice(-3).map((t) => `${t.value} (${t.date})`).join(', ')}.`;
    if (hit.status !== 'normal') msg += ' It would be good to talk this over with your doctor.';
    return msg;
  }
  const latest = one('SELECT id, title, date FROM reports WHERE user_id = ? ORDER BY date DESC LIMIT 1', user.id);
  if (!latest) return "You haven't added any reports yet. Head to **Reports → Add report** and I'll keep track of the numbers for you.";
  const flagged = metrics.filter((m) => m.status !== 'normal');
  let msg = `Your most recent report is **${latest.title}** from ${latest.date}.`;
  msg += flagged.length
    ? ` Across your reports, these need attention:\n${flagged.map((m) => `• **${m.name}**: ${m.value} ${m.unit || ''} (${m.status})`).join('\n')}`
    : ' All the values I\'m tracking are within the normal range.';
  return msg;
}

function familyReply(user) {
  const profiles = listProfiles(user).filter((p) => p.access !== 'owner');
  const sharingWith = all('SELECT member_email, relation, member_user_id FROM family_shares WHERE owner_id = ?', user.id);
  const parts = [];
  for (const p of profiles) {
    const due = listReminders(p.id).filter((r) => new Date(r.effective_due) < new Date());
    const bp = one("SELECT * FROM vitals WHERE user_id = ? AND type = 'bp' ORDER BY recorded_at DESC LIMIT 1", p.id);
    const flags = latestMetrics(p.id).filter((m) => m.status !== 'normal').length;
    parts.push(`• **${p.name}**: ${due.length ? `${due.length} pending reminder${due.length > 1 ? 's' : ''}` : 'all reminders on track'}${bp ? `, last BP ${bp.value}/${bp.value2}` : ''}${flags ? `, ${flags} report value${flags > 1 ? 's' : ''} to watch` : ''}.`);
  }
  let msg = parts.length ? `Here's how your family is doing:\n${parts.join('\n')}` : 'No one has shared their health records with you yet.';
  msg += sharingWith.length
    ? `\n\nYou're sharing your records with ${sharingWith.map((s) => s.relation ? `${s.member_email} (${s.relation})` : s.member_email).join(', ')}.`
    : '\n\nYou can share your records with family from the **Family** page so they can keep an eye on you too.';
  return msg;
}

const HELP =
  "Here's what I can do for you:\n" +
  '• **Reminders**: "remind me to take metformin every day at 9am", "what do I have today?", "I took my metformin"\n' +
  '• **Log readings**: "my BP is 128/84", "sugar 110", "weight 72.5"\n' +
  '• **Check readings**: "how is my blood pressure?", "what\'s my BMI?"\n' +
  '• **Reports**: "summarize my reports", "what was my HbA1c?"\n' +
  '• **Family**: "how is my family doing?"';

/** Returns a reply string, or null if the message wasn't understood. */
export function ruleReply(user, message) {
  const text = message.trim();
  const lower = text.toLowerCase();
  const isQuestion = text.includes('?') || /^(what|how|is|are|was|should|can|do|does|why|when)\b/i.test(text);

  if (EMERGENCY_RE.test(text)) return EMERGENCY_REPLY;

  if (/\b(remind me|set (a |an )?reminder)\b/i.test(text)) {
    const parsed = parseReminder(text, user.timezone);
    if (!parsed) return 'Sure. What should I remind you about, and when? For example: "remind me to take my BP tablet every day at 8am".';
    const r = createReminder(user.id, parsed);
    const freq = r.frequency === 'once' ? '' : ` (${r.frequency})`;
    return `Done! I'll remind you to **${r.title}** ${fmtWhen(r.next_due_at, user.timezone)}${freq}. ⏰`;
  }

  if (/\b(took|taken|have taken|done with|finished|completed|i did)\b/i.test(text) && !isQuestion) return markDone(user, text);

  if (!isQuestion) {
    for (const { type, re } of VITAL_PATTERNS) {
      const m = re.exec(text);
      if (!m) continue;
      if (type === 'bp' && !VITAL_WORDS.bp.test(text) && !/^\s*\d{2,3}\s*\/\s*\d{2,3}\s*$/.test(text)) continue;
      const v = addVital(user.id, { type, value: m[1], value2: type === 'bp' ? m[2] : null }, user);
      const label = VITAL_TYPES[type].label.toLowerCase();
      const ok = v.assessment.level === 'normal';
      let reply = `Got it, I've logged your ${label} as **${formatVital(v)}**. ${ok ? 'That looks good.' : `That's ${v.assessment.text.toLowerCase()}.`}`;
      if (v.assessment.level === 'urgent') reply += ' **Please contact your doctor right away, or call 112 if you feel unwell.** I\'ve also alerted your family.';
      else if (!ok) reply += trendSentence(user.id, type);
      return reply;
    }
  }

  if (/^(hi|hello|hey|hii+|good (morning|afternoon|evening)|namaste|yo)\b/i.test(lower)) {
    const g = dashboardGreeting(user.id);
    return `${g.greeting} ${g.lines.slice(0, 3).join(' ')}`;
  }
  if (/\b(how are you|how're you)\b/i.test(lower)) return `I'm doing well, thank you for asking! More importantly, how are you feeling today, ${firstName(user.name)}?`;
  if (/\b(thank|thanks|thx|dhanyavad|shukriya)\b/i.test(lower)) return "Anytime. Take care of yourself.";
  if (/\b(bye|good ?night|see you)\b/i.test(lower)) return `Take care, ${firstName(user.name)}! I'll be here whenever you need me.`;
  if (/\b(help|what can you do)\b/i.test(lower)) return HELP;
  if (/\b(feel|feeling)\b.*\b(tired|weak|dizzy|sick|unwell|headache|pain|nause|bad)\b/i.test(lower)) {
    return "I'm sorry you're not feeling well. Try to rest and drink some water. If you have a BP machine or glucometer nearby, a quick reading can help. Just tell me the numbers. If it gets worse or doesn't settle, please call your doctor.";
  }

  for (const [type, re] of Object.entries(VITAL_WORDS)) {
    if (re.test(lower)) return describeVital(user, type);
  }

  if (/\b(report|result|test|lab|cholesterol|hba1c|thyroid|tsh|vitamin|hemoglobin|haemoglobin|creatinine|triglyceride|ldl|hdl|uric|platelet|sgpt|sgot|liver|kidney)/i.test(lower)) {
    return reportsReply(user, lower);
  }
  if (/\b(today|schedule|plan|reminder|medicine|medication|pill|tablet|due|pending|what do i have)\b/i.test(lower)) return remindersReply(user);
  if (/\b(family|mom|mother|mum|dad|father|wife|husband|son|daughter|parent|grand)/i.test(lower)) return familyReply(user);
  if (/\b(how am i|my health|summary|overview|status|doing)\b/i.test(lower)) {
    const { points } = talkingPoints(user.id);
    return points.length ? `Here's your health snapshot:\n${points.map((p) => `• ${p}`).join('\n')}` : 'Everything I\'m tracking looks fine right now.';
  }
  return null;
}

export function fallbackReply(user) {
  return `I'm not sure I caught that, ${firstName(user.name)}. ${HELP}`;
}
