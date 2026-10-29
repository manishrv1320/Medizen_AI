import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './db.js';
import { requireAuth } from './auth.js';
import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import familyRoutes from './routes/family.js';
import notificationRoutes, { eventsHandler } from './routes/notifications.js';
import assistantRoutes from './routes/assistant.js';
import { METRIC_PRESETS, REPORT_TYPES, VITAL_TYPES } from './health.js';
import { FREQUENCIES, REMINDER_CATEGORIES, listProfiles } from './services.js';
import { startScheduler } from './scheduler.js';
import { aiEnabled } from './assistant/gemini.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'",
  );
  next();
});
app.use(express.json({ limit: '1mb' }));

app.use(express.static(path.join(root, 'public')));
app.use('/vendor/chart.js', express.static(path.join(root, 'node_modules/chart.js/dist')));
app.use('/vendor/fonts/fraunces', express.static(path.join(root, 'node_modules/@fontsource-variable/fraunces')));
app.use('/vendor/fonts/figtree', express.static(path.join(root, 'node_modules/@fontsource-variable/figtree')));

// API
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth);
app.get('/api/meta', (req, res) => {
  res.json({ metricPresets: METRIC_PRESETS, reportTypes: REPORT_TYPES, vitalTypes: VITAL_TYPES, reminderCategories: REMINDER_CATEGORIES, frequencies: FREQUENCIES, aiEnabled: aiEnabled() });
});
app.get('/api/profiles', (req, res) => res.json(listProfiles(req.user)));
app.use('/api/p/:pid', profileRoutes);
app.use('/api/family', familyRoutes);
app.use('/api/notifications', notificationRoutes);
app.get('/api/events', eventsHandler);
app.use('/api/assistant', assistantRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Single-page app: every other GET serves the shell.
app.get('/{*splat}', (req, res) => res.sendFile(path.join(root, 'public/index.html')));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be under 15 MB.' : 'Could not upload those files.';
    return res.status(400).json({ error: msg });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Medizen running at http://localhost:${port}`);
  console.log(aiEnabled()
    ? `Assistant: Google Gemini AI enabled (${process.env.GEMINI_MODEL || 'gemini-3.8-flash'})`
    : 'Assistant: built-in mode (set MEDIZEN_GEMINI_API_KEY in .env to enable the full AI assistant)');
  startScheduler();
});
