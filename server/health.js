// Shared health knowledge: reference ranges, vital-sign assessment and timezone helpers.
// Ranges are general adult reference values; labs differ, so reports store their own range per metric.

export const METRIC_PRESETS = [
  { name: 'Fasting Blood Sugar', unit: 'mg/dL', ref_low: 70, ref_high: 99 },
  { name: 'Post-meal Blood Sugar', unit: 'mg/dL', ref_low: 70, ref_high: 139 },
  { name: 'HbA1c', unit: '%', ref_low: 4, ref_high: 5.6 },
  { name: 'Total Cholesterol', unit: 'mg/dL', ref_low: 125, ref_high: 199 },
  { name: 'LDL Cholesterol', unit: 'mg/dL', ref_low: 0, ref_high: 99 },
  { name: 'HDL Cholesterol', unit: 'mg/dL', ref_low: 40, ref_high: 100 },
  { name: 'Triglycerides', unit: 'mg/dL', ref_low: 0, ref_high: 149 },
  { name: 'Hemoglobin', unit: 'g/dL', ref_low: 12, ref_high: 17.5 },
  { name: 'WBC Count', unit: '10³/µL', ref_low: 4, ref_high: 11 },
  { name: 'Platelet Count', unit: '10³/µL', ref_low: 150, ref_high: 450 },
  { name: 'TSH', unit: 'mIU/L', ref_low: 0.4, ref_high: 4 },
  { name: 'Vitamin D', unit: 'ng/mL', ref_low: 30, ref_high: 100 },
  { name: 'Vitamin B12', unit: 'pg/mL', ref_low: 200, ref_high: 900 },
  { name: 'Creatinine', unit: 'mg/dL', ref_low: 0.6, ref_high: 1.3 },
  { name: 'Uric Acid', unit: 'mg/dL', ref_low: 3.5, ref_high: 7.2 },
  { name: 'SGPT (ALT)', unit: 'U/L', ref_low: 7, ref_high: 56 },
  { name: 'SGOT (AST)', unit: 'U/L', ref_low: 8, ref_high: 48 },
];

export const REPORT_TYPES = [
  'Full Body Checkup', 'Blood Test', 'Lipid Profile', 'Diabetes Panel', 'Thyroid Profile',
  'Liver Function', 'Kidney Function', 'X-Ray / Imaging', 'ECG / Cardiac', 'Eye Checkup',
  'Dental Checkup', 'Prescription', 'Vaccination', 'Other',
];

export const VITAL_TYPES = {
  bp: { label: 'Blood pressure', unit: 'mmHg' },
  sugar: { label: 'Blood sugar', unit: 'mg/dL' },
  weight: { label: 'Weight', unit: 'kg' },
  heart_rate: { label: 'Heart rate', unit: 'bpm' },
  spo2: { label: 'Oxygen (SpO₂)', unit: '%' },
  temperature: { label: 'Temperature', unit: '°F' },
};

/**
 * Classify a vital reading. level: normal | watch | high | low | urgent.
 * Urgent readings trigger an immediate alert to the user and their family.
 */
export function assessVital(type, value, value2) {
  switch (type) {
    case 'bp': {
      const [sys, dia] = [value, value2 ?? 0];
      if (sys > 180 || dia > 120) return { level: 'urgent', text: 'Very high, crisis range' };
      if (sys < 90 || (dia && dia < 60)) return { level: 'low', text: 'Lower than usual' };
      if (sys >= 140 || dia >= 90) return { level: 'high', text: 'High, stage 2 range' };
      if (sys >= 130 || dia >= 80) return { level: 'watch', text: 'Slightly high, stage 1 range' };
      if (sys >= 120) return { level: 'watch', text: 'Elevated' };
      return { level: 'normal', text: 'Normal' };
    }
    case 'sugar':
      if (value < 54 || value > 300) return { level: 'urgent', text: value < 54 ? 'Dangerously low' : 'Very high' };
      if (value < 70) return { level: 'low', text: 'Low' };
      if (value > 180) return { level: 'high', text: 'High' };
      if (value > 140) return { level: 'watch', text: 'A little high' };
      return { level: 'normal', text: 'In range' };
    case 'heart_rate':
      if (value < 40 || value > 130) return { level: 'urgent', text: value < 40 ? 'Very slow' : 'Very fast' };
      if (value < 60) return { level: 'low', text: 'Slow, which can be normal for fit people' };
      if (value > 100) return { level: 'high', text: 'Fast' };
      return { level: 'normal', text: 'Normal' };
    case 'spo2':
      if (value < 90) return { level: 'urgent', text: 'Low oxygen, seek care' };
      if (value < 95) return { level: 'watch', text: 'Slightly low' };
      return { level: 'normal', text: 'Normal' };
    case 'temperature':
      if (value >= 103 || value < 95) return { level: 'urgent', text: value < 95 ? 'Too low' : 'High fever' };
      if (value >= 100.4) return { level: 'high', text: 'Fever' };
      return { level: 'normal', text: 'Normal' };
    default:
      return { level: 'normal', text: '' };
  }
}

export function assessMetric({ value, ref_low, ref_high }) {
  if (ref_low != null && value < ref_low) return 'low';
  if (ref_high != null && value > ref_high) return 'high';
  return 'normal';
}

export function bmi(weightKg, heightCm) {
  if (!weightKg || !heightCm) return null;
  const v = weightKg / (heightCm / 100) ** 2;
  const label = v < 18.5 ? 'Underweight' : v < 25 ? 'Healthy' : v < 30 ? 'Overweight' : 'Obese';
  return { value: Math.round(v * 10) / 10, label };
}

export function ageFrom(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) age--;
  return age;
}

export function formatVital(v) {
  const unit = VITAL_TYPES[v.type]?.unit || '';
  return v.type === 'bp' ? `${v.value}/${v.value2} ${unit}` : `${v.value} ${unit}`;
}

// ---- Timezone helpers (no external libraries) ----

function tzOffsetMs(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

/** Convert a wall-clock time in `timeZone` to a UTC Date. */
export function zonedToUtc(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - tzOffsetMs(new Date(guess), timeZone);
  return new Date(guess - tzOffsetMs(new Date(first), timeZone));
}

/** Parse "YYYY-MM-DDTHH:mm" as local time in `timeZone`. */
export function parseLocalDateTime(str, timeZone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(str || '');
  if (!m) return null;
  return zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], timeZone);
}

/** Wall-clock parts of `date` in `timeZone`. */
export function zonedParts(date, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'long',
    }).formatToParts(date).map((x) => [x.type, x.value]),
  );
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, weekday: p.weekday };
}

export function fmtTime(date, timeZone) {
  return new Date(date).toLocaleTimeString('en-IN', { timeZone, hour: 'numeric', minute: '2-digit' });
}

export function fmtDate(date, timeZone) {
  return new Date(date).toLocaleDateString('en-IN', { timeZone, day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtWhen(date, timeZone) {
  const d = new Date(date);
  const today = zonedParts(new Date(), timeZone);
  const that = zonedParts(d, timeZone);
  const tomorrow = zonedParts(new Date(Date.now() + 86400_000), timeZone);
  const same = (a, b) => a.year === b.year && a.month === b.month && a.day === b.day;
  if (same(today, that)) return `today at ${fmtTime(d, timeZone)}`;
  if (same(tomorrow, that)) return `tomorrow at ${fmtTime(d, timeZone)}`;
  return `${d.toLocaleDateString('en-IN', { timeZone, weekday: 'short', day: 'numeric', month: 'short' })} at ${fmtTime(d, timeZone)}`;
}

export function greetingFor(timeZone) {
  const { hour } = zonedParts(new Date(), timeZone);
  if (hour < 5) return 'Hi';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Next occurrence of a recurring reminder after `from`. */
export function advance(dateIso, frequency) {
  const d = new Date(dateIso);
  switch (frequency) {
    case 'daily': d.setUTCDate(d.getUTCDate() + 1); break;
    case 'weekly': d.setUTCDate(d.getUTCDate() + 7); break;
    case 'monthly': d.setUTCMonth(d.getUTCMonth() + 1); break;
    case 'yearly': d.setUTCFullYear(d.getUTCFullYear() + 1); break;
    default: return null;
  }
  return d.toISOString();
}

/** Advance repeatedly until strictly after `after`. */
export function advancePast(dateIso, frequency, after = new Date()) {
  let next = advance(dateIso, frequency);
  while (next && new Date(next) <= after) next = advance(next, frequency);
  return next;
}
