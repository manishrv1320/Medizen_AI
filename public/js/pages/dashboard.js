import { api, canEdit, currentProfile, isOwnProfile, p, state } from '../api.js';
import { avatar, fmtDate, fmtTime, html, icon, md, timeAgo, toast, toastError } from '../ui.js';
import { lineChart, shortDate } from '../charts.js';
import { openLogVital } from './vitals.js';
import * as assistant from '../assistant.js';

const VITAL_ORDER = ['bp', 'sugar', 'weight', 'heart_rate', 'spo2', 'temperature'];
const SHORT_LABEL = { bp: 'Blood pressure', sugar: 'Blood sugar', weight: 'Weight', heart_rate: 'Pulse', spo2: 'Oxygen', temperature: 'Temperature' };
const CATEGORY_LABEL = { medication: 'Medicine', checkup: 'Checkup', appointment: 'Appointment', test: 'Lab test', exercise: 'Exercise', other: 'Reminder' };

const isToday = (d) => new Date(d).toDateString() === new Date().toDateString();

function reading(type, v, bmi) {
  const info = state.meta.vitalTypes[type];
  if (!v) {
    return html`<a class="reading" href="#/vitals?type=${type}">
      <span class="reading-label">${SHORT_LABEL[type]}</span>
      <span class="reading-value none">–</span>
      <span class="reading-meta"><span class="ago">Not logged yet</span></span></a>`;
  }
  const value = type === 'bp' ? `${v.value}/${v.value2}` : v.value;
  let level = v.assessment.level;
  let word = v.assessment.text.split(',')[0];
  if (type === 'weight') {
    level = bmi && bmi.label !== 'Healthy' ? 'watch' : bmi ? 'normal' : 'none';
    word = bmi ? `BMI ${bmi.value}` : '';
  }
  return html`<a class="reading" href="#/vitals?type=${type}">
    <span class="reading-label">${SHORT_LABEL[type]}</span>
    <span class="reading-value">${value}<small>${info.unit}</small></span>
    <span class="reading-meta">${word ? html`<i class="dot ${level}"></i>${word}` : ''}<span class="ago">${word ? '· ' : ''}${timeAgo(v.recorded_at)}</span></span></a>`;
}

function scheduleItem(r, editable) {
  const when = r.effective_due;
  return html`<li class="${r.overdue ? 'late' : ''}" data-id="${r.id}">
    <time>${fmtTime(when)}${r.overdue ? html`<small>late</small>` : !isToday(when) ? html`<small>tomorrow</small>` : ''}</time>
    <div class="what"><b>${r.title}</b><span>${CATEGORY_LABEL[r.category]}${r.notes ? `, ${r.notes.toLowerCase()}` : ''}</span></div>
    ${editable ? html`<button class="tick" data-done="${r.id}" aria-label="Mark ${r.title} as done" title="Mark as done">${icon('check')}</button>` : html`<span></span>`}
  </li>`;
}

export default {
  title: 'Home',
  refreshOn: ['vitals', 'reports', 'reminders'],
  async render(el) {
    const [s, bp] = await Promise.all([api(p('/summary')), api(p('/vitals?type=bp&days=30'))]);
    const editable = canEdit();
    const own = isOwnProfile();
    const who = currentProfile();
    const g = s.greeting;
    const first = who.name.split(' ')[0];

    el.innerHTML = html`
      <div class="top">
        <section class="note">
          <div class="note-meta"><span class="zen-avatar sm" aria-hidden="true"></span><b>${g.assistant}</b><span>${own ? 'wrote this for you' : `on ${first}`}, ${fmtTime(new Date())}</span></div>
          <h1>${g.greeting}</h1>
          <div class="note-body">${g.lines.slice(0, 4).map((l) => html`<p>${md(l)}</p>`)}</div>
          <div class="note-actions">
            ${own ? html`<button class="btn primary" data-chat>Reply to ${g.assistant}</button>` : ''}
            ${editable ? html`<button class="btn" data-log>Log a reading</button><a class="btn" href="#/reports/new">Add a report</a>` : ''}
          </div>
        </section>

        <section class="card">
          <div class="card-header"><h2>Today</h2><a class="link" href="#/reminders">All reminders</a></div>
          <div class="card-body">
            ${s.reminders_today.length
              ? html`<ol class="schedule" data-schedule>${s.reminders_today.map((r) => scheduleItem(r, editable))}</ol>`
              : html`<p class="muted" style="padding:6px 0 4px">Nothing else on the list for today.</p>
                ${editable ? html`<a class="link" href="#/reminders">Add a reminder</a>` : ''}`}
          </div>
        </section>
      </div>

      <div class="section-head"><h2>Latest readings</h2><a class="link" href="#/vitals">History</a></div>
      <section class="readings">${VITAL_ORDER.map((t) => reading(t, s.vitals[t], s.bmi))}</section>

      <div class="dash" style="margin-top:22px">
        <div class="stack">
          <section class="card">
            <div class="card-header"><h2>Blood pressure, last 30 days</h2><a class="link" href="#/vitals?type=bp">Open</a></div>
            <div class="card-body">${bp.length > 1
              ? html`<div class="chart-box sm"><canvas data-bp-chart aria-label="Blood pressure over the last 30 days"></canvas></div>`
              : html`<p class="muted">A couple more readings and the trend will show up here.</p>`}</div>
          </section>

          <section class="card">
            <div class="card-header"><h2>Worth a look</h2><span class="muted small">From the latest reports</span></div>
            <div class="card-body">
              ${s.attention_metrics.length ? html`<table class="plain">
                <thead><tr><th>Test</th><th class="num">Result</th><th class="num">Normal</th><th></th></tr></thead>
                <tbody>${s.attention_metrics.map((m) => html`<tr class="clickable" data-href="#/reports/${m.report_id}">
                  <td>${m.name}<small>${m.report_title}, ${fmtDate(m.date)}</small></td>
                  <td class="num"><b>${m.value}</b> <span class="muted small">${m.unit || ''}</span></td>
                  <td class="num muted">${m.ref_low ?? '–'}–${m.ref_high ?? '–'}</td>
                  <td><span class="status ${m.status}"><i class="dot ${m.status}"></i>${m.status === 'high' ? 'High' : 'Low'}</span></td>
                </tr>`)}</tbody></table>`
              : html`<p class="muted">${s.metric_count ? 'Everything from the latest reports is within the normal range.' : 'Add a report with test values and anything outside the normal range will show up here.'}</p>`}
            </div>
          </section>

          <section class="card">
            <div class="card-header"><h2>Recent reports</h2><a class="link" href="#/reports">All reports</a></div>
            <div class="card-body">
              ${s.recent_reports.length ? html`<table class="plain">
                <tbody>${s.recent_reports.map((r) => html`<tr class="clickable" data-href="#/reports/${r.id}">
                  <td class="muted nowrap" style="width:96px">${fmtDate(r.date)}</td>
                  <td><a href="#/reports/${r.id}">${r.title}</a><small>${[r.type, r.provider].filter(Boolean).join(', ')}</small></td>
                  <td class="num">${r.abnormal_count ? html`<span class="status high"><i class="dot high"></i>${r.abnormal_count} flagged</span>` : r.metric_count ? html`<span class="status"><i class="dot"></i>All normal</span>` : ''}</td>
                </tr>`)}</tbody></table>`
              : html`<p class="muted">No reports yet.</p>
                ${editable ? html`<a class="btn" style="margin-top:12px" href="#/reports/new">Add the first one</a>` : ''}`}
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="card">
            <div class="card-header"><h2>Coming up</h2></div>
            <div class="card-body">
              <p class="small" style="margin-bottom:10px">
                ${s.last_full_checkup
                  ? html`<span class="status ${s.next_checkup.overdue ? 'high' : ''}"><i class="dot ${s.next_checkup.overdue ? 'high' : ''}"></i>Yearly checkup ${s.next_checkup.overdue ? 'is due' : `due by ${fmtDate(s.next_checkup.due)}`}</span><span class="muted">. Last one was ${s.last_full_checkup.date_label}.</span>`
                  : html`<span class="status"><i class="dot none"></i>No full-body checkup on record yet</span>`}
              </p>
              ${s.upcoming.length ? html`<ul class="upcoming">${s.upcoming.map((r) => {
                const d = new Date(r.effective_due);
                return html`<li><span class="date-block"><small>${d.toLocaleDateString(undefined, { month: 'short' })}</small><b>${d.getDate()}</b></span>
                  <div class="what"><b>${r.title}</b><span>${d.toLocaleDateString(undefined, { weekday: 'long' })}, ${fmtTime(d)}</span></div></li>`;
              })}</ul>` : html`<p class="muted small">No appointments booked.</p>`}
            </div>
          </section>

          <section class="card">
            <div class="card-header"><h2>${own ? 'About you' : `About ${first}`}</h2>${own ? html`<a class="link" href="#/settings">Edit</a>` : ''}</div>
            <div class="card-body">
              <dl class="facts">
                <dt>Age</dt><dd>${s.profile.age != null ? `${s.profile.age}` : '–'}</dd>
                <dt>Blood group</dt><dd>${s.profile.blood_group || '–'}</dd>
                <dt>Height</dt><dd>${s.profile.height_cm ? `${s.profile.height_cm} cm` : '–'}</dd>
                <dt>Conditions</dt><dd>${s.profile.conditions || 'None noted'}</dd>
                <dt>Allergies</dt><dd>${s.profile.allergies || 'None noted'}</dd>
              </dl>
              ${own && !s.profile.age ? html`<p class="small muted" style="margin-top:12px">Adding your age and height helps ${g.assistant} give better advice.</p>` : ''}
            </div>
          </section>

          ${own ? familyCard() : ''}
        </div>
      </div>`;

    el.querySelector('[data-chat]')?.addEventListener('click', () => assistant.open());
    el.querySelector('[data-log]')?.addEventListener('click', () => openLogVital());
    el.addEventListener('click', (e) => {
      const row = e.target.closest('tr[data-href]');
      if (row && !e.target.closest('a')) location.hash = row.dataset.href;
    });
    el.querySelector('[data-schedule]')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-done]');
      if (!btn) return;
      btn.classList.add('done');
      btn.disabled = true;
      try {
        await api(p(`/reminders/${btn.dataset.done}/done`), { method: 'POST' });
        toast({ title: 'Ticked off', type: 'success', timeout: 2500 });
      } catch (err) {
        btn.classList.remove('done');
        btn.disabled = false;
        toastError(err);
      }
    });

    let chart = null;
    const canvas = el.querySelector('[data-bp-chart]');
    if (canvas) {
      chart = lineChart(canvas, {
        labels: bp.map((v) => shortDate(v.recorded_at)),
        series: [{ label: 'Systolic', data: bp.map((v) => v.value) }, { label: 'Diastolic', data: bp.map((v) => v.value2) }],
        band: { low: 60, high: 120 }, unit: 'mmHg',
      });
    }
    return () => chart?.destroy();
  },
};

function familyCard() {
  const others = state.profiles.filter((x) => x.access !== 'owner');
  return html`<section class="card">
    <div class="card-header"><h2>Family</h2><a class="link" href="#/family">Manage</a></div>
    <div class="card-body">
      ${others.length ? html`<div class="list">${others.map((x) => html`
        <a class="list-item" href="#/dashboard?profile=${x.id}">${avatar(x.name, x.id)}
          <div class="grow"><div class="title">${x.name}</div></div>
          <span class="muted small">${x.access === 'manage' ? 'You help manage' : 'View only'}</span></a>`)}</div>`
      : html`<p class="muted small">Nobody has shared their records with you yet.</p>`}
    </div>
  </section>`;
}
