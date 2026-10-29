// Gemini-powered conversational assistant. Uses function calling so the assistant can
// read the user's records, log readings and manage reminders on their behalf.
import { ApiError, GoogleGenAI, ThinkingLevel } from '@google/genai';
import { z } from 'zod';
import { all } from '../db.js';
import {
  UserError, addVital, completeReminder, createReminder, getReport, healthSummary, listProfiles, listReminders,
  listReports, metricTrend, resolveProfile, vitalHistory,
} from '../services.js';
import { METRIC_PRESETS, VITAL_TYPES, fmtWhen, formatVital, parseLocalDateTime, zonedParts } from '../health.js';

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
// Used for the turn when the main model is overloaded, rate-limited or slow. Set it empty to disable.
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL ?? 'gemini-3.5-flash-lite';
const MAX_STEPS = 8;
const REQUEST_TIMEOUT_MS = 25_000;

// Only the key configured for Medizen in .env is used. Passing it explicitly takes precedence over
// GEMINI_API_KEY / GOOGLE_API_KEY, and vertexai: false keeps requests on the Gemini API.
const apiKey = () => process.env.MEDIZEN_GEMINI_API_KEY?.trim() || '';

let client = null;
export function aiEnabled() {
  return Boolean(apiKey());
}
function getClient() {
  client ??= new GoogleGenAI({
    apiKey: apiKey(),
    vertexai: false,
    // Fail fast so the chat never hangs: no long SDK back-off retries; geminiReply switches model instead.
    httpOptions: { timeout: REQUEST_TIMEOUT_MS, retryOptions: { attempts: 1 } },
  });
  return client;
}

/** Errors worth retrying on the fallback model: overload, rate limit / quota, server errors, timeouts. */
function isTransient(err) {
  if (err instanceof ApiError) return [429, 500, 502, 503, 504].includes(err.status);
  return err?.name === 'AbortError' || err?.name === 'TimeoutError' || /timed? ?out|aborted/i.test(err?.message ?? '');
}

const PERSONA = `You are a personal health assistant inside Medizen, a family health-records app. You talk with one person (the user) about their own health records, readings, reminders and, when they have been granted access, the records of family members who shared with them.

Personality: warm, caring and down-to-earth, like a trusted friend who happens to be a well-organised nurse. Use the user's first name now and then. Be encouraging about progress, gentle about concerns, never preachy. Keep replies short and conversational (usually 1–4 sentences); use a short bullet list only when listing several items. Use **bold** sparingly for key numbers or names. Write plainly, the way a person would text: no emoji, no headings, no em dashes.

How to work:
- Look things up with your tools instead of guessing. Never invent readings, reports or reminders.
- When the user tells you a reading ("my BP is 130/85", "sugar 110 fasting"), log it with log_vital, then react to it.
- When the user asks to be reminded of something, create the reminder with create_reminder. Use the user's local time given below; if they don't say a time, pick a sensible one and tell them.
- When the user says they took a medicine or finished something, mark the matching reminder done with complete_reminder (use list_reminders to find its id).
- For family questions use get_family_overview / get_family_member_summary. You can only read profiles the user has access to.
- When something is outside the normal range, say so plainly and kindly, suggest simple lifestyle steps where appropriate, and recommend discussing it with their doctor.

Safety:
- You are not a doctor. Do not diagnose conditions or change, start or stop medication doses; refer those decisions to their doctor.
- If the user describes possible emergency symptoms (chest pain, difficulty breathing, stroke signs such as face drooping or slurred speech, fainting, severe bleeding, very high or very low readings with symptoms) or thoughts of self-harm, tell them clearly to call emergency services now (112 in India, or their local number); for self-harm also mention Tele-MANAS 14416. Do this before anything else.
- Health data is private: only discuss the user's own records and those of people who shared with them.`;

function contextBlock(user) {
  const p = zonedParts(new Date(), user.timezone);
  const local = `${p.weekday}, ${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  return `Your name is ${user.assistant_name}. You are talking with ${user.name}.
User's local date and time: ${local} (timezone ${user.timezone}). Use this timezone for all times you mention or schedule.`;
}

/** Each tool: a zod schema (sent to Gemini as JSON Schema, and used to validate its arguments) and a handler. */
function buildTools(user) {
  const tz = user.timezone;
  return {
    get_health_summary: {
      description: "Get the user's current health snapshot: profile, latest vitals with assessment, report values outside normal range, reminders due in the next 24 hours, upcoming appointments and checkup status.",
      schema: z.object({}),
      run: () => healthSummary(user.id),
    },
    get_vital_history: {
      description: 'Get the history of one vital sign for the user, oldest first.',
      schema: z.object({
        type: z.enum(Object.keys(VITAL_TYPES)).describe('bp (value=systolic, value2=diastolic), sugar (mg/dL), weight (kg), heart_rate (bpm), spo2 (%), temperature (°F)'),
        days: z.number().int().min(1).max(730).optional().describe('How many days back. Default 90.'),
      }),
      run: ({ type, days }) => vitalHistory(user.id, type, days ?? 90).map(({ value, value2, note, recorded_at }) => ({ value, value2, note, recorded_at })),
    },
    log_vital: {
      description: 'Record a new vital-sign reading for the user (as of now). Returns the saved reading with an assessment.',
      schema: z.object({
        type: z.enum(Object.keys(VITAL_TYPES)),
        value: z.number().describe('Main value. For bp this is systolic.'),
        value2: z.number().optional().describe('Diastolic, only for bp.'),
        note: z.string().optional().describe('Context such as "fasting", "after lunch".'),
      }),
      run: (input) => addVital(user.id, input, user),
      saved: (v) => `I've logged your ${VITAL_TYPES[v.type].label.toLowerCase()} as ${formatVital(v)}.`,
    },
    list_reports: {
      description: "List the user's health reports (newest first) with counts of abnormal values.",
      schema: z.object({ limit: z.number().int().min(1).max(50).optional() }),
      run: ({ limit }) => listReports(user.id, limit ?? 10),
    },
    get_report: {
      description: 'Get one report with every measured value, its reference range and status (normal/high/low).',
      schema: z.object({ report_id: z.number().int() }),
      run: ({ report_id }) => getReport(user.id, report_id) ?? { error: 'Report not found.' },
    },
    get_metric_trend: {
      description: `Get every recorded value of one lab metric across the user's reports, oldest first. Common names: ${METRIC_PRESETS.map((m) => m.name).join(', ')}.`,
      schema: z.object({ name: z.string() }),
      run: ({ name }) => {
        const rows = metricTrend(user.id, name);
        if (rows.length) return rows;
        const names = all('SELECT DISTINCT m.name FROM report_metrics m JOIN reports r ON r.id = m.report_id WHERE r.user_id = ?', user.id).map((r) => r.name);
        return { error: `No values for "${name}".`, available_metrics: names };
      },
    },
    list_reminders: {
      description: "List the user's active reminders with their id and next due time.",
      schema: z.object({}),
      run: () => listReminders(user.id).map((r) => ({
        id: r.id, title: r.title, category: r.category, frequency: r.frequency, notes: r.notes,
        due: fmtWhen(r.effective_due, tz), overdue: new Date(r.effective_due) < new Date(),
      })),
    },
    create_reminder: {
      description: 'Create a reminder for the user (medicine, appointment, checkup, test, exercise, other).',
      schema: z.object({
        title: z.string().describe('Short, clear title, e.g. "Metformin 500 mg" or "Dentist appointment".'),
        category: z.enum(['medication', 'checkup', 'appointment', 'test', 'exercise', 'other']),
        due_local: z.string().describe("First due time in the user's local time, format YYYY-MM-DDTHH:mm."),
        frequency: z.enum(['once', 'daily', 'weekly', 'monthly', 'yearly']),
        notes: z.string().optional(),
      }),
      run: ({ due_local, ...rest }) => {
        const due = parseLocalDateTime(due_local, tz);
        if (!due) throw new UserError('due_local must look like 2026-01-31T09:00.');
        const r = createReminder(user.id, { ...rest, next_due_at: due.toISOString() });
        return { id: r.id, title: r.title, frequency: r.frequency, due: fmtWhen(r.next_due_at, tz) };
      },
      saved: (r) => `I've set a reminder for ${r.title}, ${r.due}${r.frequency === 'once' ? '' : ` (${r.frequency})`}.`,
    },
    complete_reminder: {
      description: 'Mark a reminder as done (recurring reminders move to their next occurrence).',
      schema: z.object({ reminder_id: z.number().int() }),
      run: ({ reminder_id }) => {
        const r = completeReminder(user.id, reminder_id);
        if (!r) return { error: 'Reminder not found.' };
        return { title: r.title, active: Boolean(r.active), next_due: r.active ? fmtWhen(r.next_due_at, tz) : null };
      },
      saved: (r) => (r.title ? `I've marked ${r.title} as done.` : null),
    },
    get_family_overview: {
      description: 'List family members who shared their records with the user (with access level) and the people the user shares their own records with.',
      schema: z.object({}),
      run: () => ({
        // `relation` is written by the owner about the user, e.g. "Son" means the user is their son.
        shared_with_me: listProfiles(user).filter((p) => p.access !== 'owner')
          .map(({ id, name, relation, access }) => ({ profile_id: id, name, access, user_is_their: relation })),
        i_share_with: all('SELECT member_email, relation, access, notify, member_user_id IS NOT NULL AS has_account FROM family_shares WHERE owner_id = ?', user.id),
      }),
    },
    get_family_member_summary: {
      description: 'Get the health snapshot of a family member who shared their records with the user. Use the profile_id from get_family_overview.',
      schema: z.object({ profile_id: z.number().int() }),
      run: ({ profile_id }) => {
        const profile = resolveProfile(user, profile_id);
        if (!profile || profile.access === 'owner') return { error: 'No access to that profile.' };
        return healthSummary(profile.id);
      },
    },
  };
}

function declarations(tools) {
  return Object.entries(tools).map(([name, t]) => {
    const { $schema, ...parametersJsonSchema } = z.toJSONSchema(t.schema);
    return { name, description: t.description, parametersJsonSchema };
  });
}

/**
 * Run one function call and return the object sent back to Gemini as its functionResponse.
 * Plain-language notes about anything saved are pushed to `saved`.
 */
async function runTool(tools, call, saved) {
  const tool = tools[call.name];
  if (!tool) return { error: `Unknown tool "${call.name}".` };
  const parsed = tool.schema.safeParse(call.args ?? {});
  if (!parsed.success) return { error: `Invalid arguments: ${z.prettifyError(parsed.error)}` };
  try {
    const result = await tool.run(parsed.data);
    const note = !result?.error && tool.saved?.(result);
    if (note) saved.push(note);
    return { result };
  } catch (err) {
    if (err instanceof UserError) return { error: err.message };
    throw err;
  }
}

/**
 * Generate a reply with Gemini. `history` is prior turns as { role: 'user' | 'assistant', content } text.
 * Throws on API errors so the caller can fall back to the rule-based assistant, except when this turn has
 * already saved something: then it confirms what was saved, so the fallback can't do it a second time.
 */
export async function geminiReply(user, history, message) {
  const tools = buildTools(user);
  const contents = history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  while (contents.length && contents[0].role !== 'user') contents.shift();
  contents.push({ role: 'user', parts: [{ text: message }] });

  const models = [...new Set([MODEL, FALLBACK_MODEL].filter(Boolean))];
  let model = models[0];
  const configFor = (m) => ({
    systemInstruction: `${PERSONA}\n\n${contextBlock(user)}`,
    tools: [{ functionDeclarations: declarations(tools) }],
    // Gemini 3+ models take a thinking level; keep it low for quick, conversational replies.
    ...(/^gemini-2\./.test(m) ? {} : { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }),
  });
  const saved = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    let response;
    try {
      response = await getClient().models.generateContent({ model, contents, config: configFor(model) });
    } catch (err) {
      // Switch models only before anything has happened this turn, so no tool runs twice
      // and no thought signatures cross models.
      if (step === 0 && isTransient(err) && model !== models.at(-1)) {
        console.warn(`[assistant] ${model} unavailable (${err.status ?? err.name}); trying ${models[models.indexOf(model) + 1]}.`);
        model = models[models.indexOf(model) + 1];
        step--;
        continue;
      }
      if (saved.length) return `${saved.join(' ')} I couldn't finish the rest of my reply just now, but that part is saved.`;
      throw err;
    }
    const calls = response.functionCalls;
    if (!calls?.length) {
      const text = response.text?.trim();
      if (text) return text;
      if (saved.length) return saved.join(' ');
      if (response.promptFeedback?.blockReason || response.candidates?.[0]?.finishReason === 'SAFETY') {
        return "I'm not able to help with that one, but I'm happy to help with your health records, readings or reminders.";
      }
      return "Sorry, I got a little tangled up there. Could you say that again?";
    }
    // Send the model's turn back unchanged so its thought signatures are preserved.
    contents.push(response.candidates[0].content);
    const parts = [];
    for (const call of calls) {
      parts.push({ functionResponse: { id: call.id, name: call.name, response: await runTool(tools, call, saved) } });
    }
    contents.push({ role: 'user', parts });
  }
  return saved.length ? saved.join(' ') : "Sorry, that took me more steps than expected. Could you ask me again, a bit more simply?";
}
