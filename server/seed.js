// Creates a demo family with realistic data. Safe to re-run: it recreates the demo accounts.
//   npm run seed
import { one, run, tx } from './db.js';
import { hashPassword } from './auth.js';
import { METRIC_PRESETS, zonedParts, zonedToUtc } from './health.js';

const TZ = 'Asia/Kolkata';
const PASSWORD = 'demo1234';
const preset = Object.fromEntries(METRIC_PRESETS.map((m) => [m.name, m]));

const now = new Date();
const today = zonedParts(now, TZ);
const daysAgo = (n) => new Date(now.getTime() - n * 86400_000);
const isoDate = (d) => d.toISOString().slice(0, 10);
const at = (dayOffset, hour, minute = 0) => zonedToUtc(today.year, today.month, today.day + dayOffset, hour, minute, TZ);
const jitter = (v, spread) => Math.round((v + (Math.random() - 0.5) * 2 * spread) * 10) / 10;

/** Next daily occurrence at hh:mm (today's if it hasn't passed by more than `graceMin`). */
function nextDaily(hour, minute = 0, graceMin = 0) {
  const t = at(0, hour, minute);
  return t.getTime() + graceMin * 60_000 >= now.getTime() ? t : at(1, hour, minute);
}

function createUser(u) {
  run('DELETE FROM users WHERE email = ?', u.email);
  const { lastInsertRowid } = run(
    `INSERT INTO users (name, email, password_hash, dob, gender, blood_group, height_cm, phone, conditions, allergies, timezone, last_briefing_on)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    u.name, u.email, hashPassword(PASSWORD), u.dob, u.gender, u.blood_group, u.height_cm, u.phone ?? null, u.conditions ?? null, u.allergies ?? null, TZ, null,
  );
  return Number(lastInsertRowid);
}

function addReport(userId, { title, type, daysBack, provider, doctor, notes, metrics }) {
  const { lastInsertRowid } = run(
    'INSERT INTO reports (user_id, title, type, date, provider, doctor, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    userId, title, type, isoDate(daysAgo(daysBack)), provider ?? null, doctor ?? null, notes ?? null, userId,
  );
  for (const [name, value] of Object.entries(metrics)) {
    const p = preset[name];
    run('INSERT INTO report_metrics (report_id, name, value, unit, ref_low, ref_high) VALUES (?, ?, ?, ?, ?, ?)',
      lastInsertRowid, name, value, p.unit, p.ref_low, p.ref_high);
  }
}

function addVital(userId, type, value, value2, when, note = null) {
  run('INSERT INTO vitals (user_id, type, value, value2, note, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
    userId, type, value, value2, note, when.toISOString());
}

function addReminder(userId, title, category, frequency, due, notes = null) {
  run('INSERT INTO reminders (user_id, title, category, notes, frequency, next_due_at) VALUES (?, ?, ?, ?, ?, ?)',
    userId, title, category, notes, frequency, due.toISOString());
}

function share(ownerId, memberId, memberEmail, relation, access) {
  run('INSERT INTO family_shares (owner_id, member_email, member_user_id, relation, access, notify) VALUES (?, ?, ?, ?, ?, 1)',
    ownerId, memberEmail, memberId, relation, access);
}

function notify(userId, title, body, type, link, minutesAgo) {
  run("INSERT INTO notifications (user_id, title, body, type, link, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    userId, title, body, type, link, new Date(now.getTime() - minutesAgo * 60_000).toISOString());
}

tx(() => {
  // ---- Arjun: the main demo user ----
  const arjun = createUser({
    name: 'Arjun Sharma', email: 'demo@medizen.app', dob: '1978-04-12', gender: 'Male', blood_group: 'B+', height_cm: 172,
    phone: '+91 98765 43210', conditions: 'Type 2 diabetes, Hypertension', allergies: 'Penicillin',
  });
  addReport(arjun, {
    title: 'Annual Full Body Checkup', type: 'Full Body Checkup', daysBack: 395, provider: 'Apollo Diagnostics', doctor: 'Dr. S. Rao',
    notes: 'Advised diet control, 30 min walk daily, Vitamin D supplementation.',
    metrics: {
      'Fasting Blood Sugar': 132, HbA1c: 7.2, 'Total Cholesterol': 218, 'LDL Cholesterol': 142, 'HDL Cholesterol': 38,
      Triglycerides: 180, Hemoglobin: 14.2, TSH: 2.1, 'Vitamin D': 18, 'Vitamin B12': 310, Creatinine: 1.0, 'SGPT (ALT)': 42,
    },
  });
  addReport(arjun, { title: 'Diabetes Follow-up', type: 'Diabetes Panel', daysBack: 180, provider: 'Apollo Diagnostics', metrics: { 'Fasting Blood Sugar': 118, HbA1c: 6.8 } });
  addReport(arjun, {
    title: 'Lipid Profile', type: 'Lipid Profile', daysBack: 60, provider: 'Thyrocare',
    metrics: { 'Total Cholesterol': 196, 'LDL Cholesterol': 118, 'HDL Cholesterol': 41, Triglycerides: 152 },
  });
  addReport(arjun, {
    title: 'Quarterly Sugar Check', type: 'Diabetes Panel', daysBack: 14, provider: 'Apollo Diagnostics', doctor: 'Dr. S. Rao',
    notes: 'Good improvement. Continue current medication.',
    metrics: { 'Fasting Blood Sugar': 108, 'Post-meal Blood Sugar': 152, HbA1c: 6.5, 'Vitamin D': 27 },
  });

  for (let d = 45; d >= 1; d--) {
    const progress = (45 - d) / 45;
    addVital(arjun, 'bp', Math.round(jitter(142 - 13 * progress, 4)), Math.round(jitter(92 - 9 * progress, 3)), at(-d, 7, 30));
    if (d % 2 === 0) addVital(arjun, 'sugar', Math.round(jitter(124 - 18 * progress, 6)), null, at(-d, 7, 15), 'fasting');
    if (d % 7 === 0) addVital(arjun, 'weight', jitter(84 - 1.8 * progress, 0.3), null, at(-d, 7, 0));
    if (d % 3 === 0) addVital(arjun, 'heart_rate', Math.round(jitter(78, 5)), null, at(-d, 7, 30));
  }
  addVital(arjun, 'spo2', 98, null, at(-2, 8));
  addVital(arjun, 'weight', 82.1, null, at(0, 7) < now ? at(0, 7) : at(-1, 7));

  addReminder(arjun, 'Metformin 500 mg', 'medication', 'daily', nextDaily(9, 0, 180), 'After breakfast');
  addReminder(arjun, 'Telmisartan 40 mg', 'medication', 'daily', nextDaily(21, 0), 'BP tablet, after dinner');
  addReminder(arjun, 'Evening walk, 30 minutes', 'exercise', 'daily', nextDaily(18, 30));
  addReminder(arjun, 'Vitamin D3 60K', 'medication', 'weekly', at(((7 - new Date(at(0, 12)).getUTCDay()) % 7) || 7, 10), 'One sachet with milk, every Sunday');
  addReminder(arjun, 'Follow-up with Dr. Rao (diabetologist)', 'appointment', 'once', at(5, 17, 30), 'Carry the latest sugar report.');
  addReminder(arjun, 'Annual full body checkup', 'checkup', 'once', at(10, 8), 'Fast for 10–12 hours before the test.');

  // ---- Meera: spouse ----
  const meera = createUser({ name: 'Meera Sharma', email: 'meera@medizen.app', dob: '1982-09-03', gender: 'Female', blood_group: 'O+', height_cm: 160 });
  addReport(meera, {
    title: 'Routine Blood Test', type: 'Blood Test', daysBack: 30, provider: 'Thyrocare',
    metrics: { Hemoglobin: 11.2, 'Vitamin D': 22, 'Vitamin B12': 420, TSH: 1.8, 'Fasting Blood Sugar': 88 },
  });
  for (let d = 20; d >= 1; d -= 4) addVital(meera, 'bp', Math.round(jitter(116, 3)), Math.round(jitter(76, 3)), at(-d, 8));
  addVital(meera, 'weight', 58.4, null, at(-3, 7));
  addReminder(meera, 'Iron supplement', 'medication', 'daily', nextDaily(14), 'After lunch');

  // ---- Kamala: elderly mother, managed by Arjun ----
  const kamala = createUser({
    name: 'Kamala Sharma', email: 'kamala@medizen.app', dob: '1952-01-20', gender: 'Female', blood_group: 'B+', height_cm: 152,
    conditions: 'Hypothyroidism, Hypertension',
  });
  addReport(kamala, {
    title: 'Thyroid & Kidney Panel', type: 'Thyroid Profile', daysBack: 21, provider: 'SRL Diagnostics', doctor: 'Dr. Anita Menon',
    metrics: { TSH: 5.8, Creatinine: 1.1, Hemoglobin: 11.8, 'Uric Acid': 6.4 },
  });
  for (let d = 14; d >= 1; d--) addVital(kamala, 'bp', Math.round(jitter(146, 6)), Math.round(jitter(88, 4)), at(-d, 9));
  addReminder(kamala, 'Thyroxine 50 mcg', 'medication', 'daily', nextDaily(7, 0, 240), 'Empty stomach, 30 min before breakfast');
  addReminder(kamala, 'Amlodipine 5 mg', 'medication', 'daily', nextDaily(20));
  addReminder(kamala, 'Thyroid recheck with Dr. Menon', 'appointment', 'once', at(12, 11));

  // ---- Family sharing ----
  share(arjun, meera, 'meera@medizen.app', 'Wife', 'view');
  share(meera, arjun, 'demo@medizen.app', 'Husband', 'view');
  share(kamala, arjun, 'demo@medizen.app', 'Son', 'manage');
  share(kamala, meera, 'meera@medizen.app', 'Daughter-in-law', 'view');

  // ---- A few past notifications ----
  notify(arjun, "Hi Arjun, I'm Zen, your health assistant", 'I\'ll remind you about medicines, watch your numbers and keep your family in the loop.', 'assistant', '#/dashboard', 60 * 24 * 3);
  notify(arjun, 'Kamala Sharma shared their health records with you', 'You can view and help manage their reports, readings and reminders.', 'family', `#/dashboard?profile=${kamala}`, 60 * 24 * 2);
  notify(arjun, 'New report for Kamala Sharma: Thyroid & Kidney Panel', '1 value outside the normal range: TSH.', 'warning', `#/reports?profile=${kamala}`, 60 * 24);

  console.log(`Seeded demo family (password for all: ${PASSWORD})
  • demo@medizen.app    Arjun (main demo user; manages his mother's records)
  • meera@medizen.app   Meera (Arjun's wife; can view Arjun's and Kamala's records)
  • kamala@medizen.app  Kamala (Arjun's mother)`);
});

const count = one('SELECT COUNT(*) AS n FROM users').n;
console.log(`Database now has ${count} user(s).`);
