# Medizen

A personal health dashboard with a caring personal assistant. Keep every checkup report, reading and medicine in one place, get reminded on time, and let family members view your records (and get alerted when something needs attention).

## Features

- **Sign in / sign up**: email + password (scrypt-hashed), 30-day httpOnly session cookie, sign-in throttling.
- **Dashboard**: a personal greeting from your assistant with what matters today, latest vitals with status, a 30-day BP trend, report values that need attention, today's reminders, upcoming checkups and family.
- **Reports**: add lab reports or checkups with test values (common tests fill in units and normal ranges) and attach PDFs or photos. Out-of-range values are flagged, and you can click any value to see its trend across reports.
- **Vitals**: log blood pressure, sugar, weight, heart rate, SpO₂ and temperature. Charts shade the normal range. Dangerous readings alert you and your family immediately.
- **Reminders**: medicines, appointments, checkups, tests and exercise; one-time or daily, weekly, monthly or yearly. Done and Snooze work from the notification itself.
- **Notifications**: live in-app alerts (Server-Sent Events), desktop alerts and a morning briefing at 8 AM local time. If a medicine or appointment isn't marked done within an hour, family members with alerts on are notified.
- **Family sharing**: share your records by email with **View only** or **Can manage** access (good for looking after parents). You can switch between your own profile and family profiles from the top bar.
- **Personal assistant**: a chat panel with voice input and spoken replies. It logs readings ("my BP is 130/85"), sets reminders ("remind me to take metformin every day at 9am"), marks them done ("I took my metformin"), explains results and checks on family.
  - **AI mode** (with `MEDIZEN_GEMINI_API_KEY`): Google Gemini holds a natural conversation and uses function calling to read and update your records.
  - **Built-in mode** (no key): a rule-based assistant that understands the common requests above.
  - Emergency phrases always get an immediate "call 112" response.

## Quick start

Requires **Node.js 22.13+** (uses the built-in `node:sqlite`; no native modules).

```bash
npm install
npm run seed      # optional: creates a demo family
npm start         # http://localhost:3000
```

Demo accounts (password `demo1234`):

| Email | Who |
|---|---|
| `demo@medizen.app` | Arjun: main demo user, manages his mother's records |
| `meera@medizen.app` | Meera: Arjun's wife, can view Arjun's and Kamala's records |
| `kamala@medizen.app` | Kamala: Arjun's mother |

`npm run dev` restarts on file changes.

### Enable the AI assistant

Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) and put it in `.env` (copy `.env.example` if `.env` doesn't exist yet), then restart the server:

```bash
MEDIZEN_GEMINI_API_KEY=your-key-here
```

Medizen uses only this key. Any other key on the computer (`GEMINI_API_KEY`, `GOOGLE_API_KEY`) is ignored, and requests always go to the Gemini API, never Vertex AI. `.env` is git-ignored, so the key never gets committed.

The assistant uses `gemini-3.8-flash` by default, which is free of charge on the Gemini API free tier (rate-limited). Override it with `GEMINI_MODEL`, e.g. `gemini-3.5-flash-lite` for the cheapest paid option. It runs with a low thinking level for quick, conversational replies. If the API is unreachable or the free-tier quota runs out, it falls back to built-in mode automatically.

## Project structure

```
server/
  index.js            Express app, security headers, routes, SPA fallback
  db.js               SQLite schema + tiny query helpers
  auth.js             password hashing, sessions, auth middleware
  services.js         domain logic shared by routes, scheduler and assistant
  health.js           reference ranges, vital assessment, timezone helpers
  notify.js           notifications + live event stream (SSE)
  scheduler.js        fires reminders, escalates missed ones, morning briefing
  seed.js             demo data
  routes/             auth, profile data (/api/p/:pid/...), family, notifications, assistant
  assistant/
    gemini.js         Gemini function-calling assistant
    rules.js          built-in rule-based assistant
    briefing.js       personable summaries (dashboard, morning notification)
    index.js          picks AI or built-in mode, stores chat history
public/
  index.html, css/app.css
  js/app.js           shell, router, profile switcher, live events
  js/assistant.js     chat panel, voice in/out
  js/pages/*.js       dashboard, reports, vitals, reminders, family, notifications, settings
data/                 SQLite database (git-ignored)
uploads/              report attachments (git-ignored)
```

`/api/p/:pid/...` serves a health profile: `me`, or the id of someone who shared with you. Access is checked on every request. View-only members get `403` on any change.

## Going to production

- Serve over HTTPS and set `NODE_ENV=production` (cookies become `Secure`).
- Back up `data/` and `uploads/` regularly; they hold personal health data.
- Notifications currently reach users in the app and as desktop alerts. For alerts when the app is closed, add Web Push, SMS or WhatsApp delivery in `server/notify.js` (`notify()` is the single place every notification passes through).
- Medizen helps people organise their health information. It is not a medical device, and the assistant is instructed not to diagnose or change medication.
