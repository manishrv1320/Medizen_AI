import { api, canEdit, isOwnProfile, p, state } from '../api.js';
import {
  VITAL_ICON, busy, confirmDialog, fmtWhen, html, icon, openModal, toLocalInput, toast, toastError,
} from '../ui.js';
import { lineChart, shortDate } from '../charts.js';

const BANDS = {
  bp: { low: 60, high: 120 },
  sugar: { low: 70, high: 140 },
  heart_rate: { low: 60, high: 100 },
  spo2: { low: 95, high: 100 },
  temperature: { low: 97, high: 99.5 },
};
const RANGES = [['30', '30 days'], ['90', '3 months'], ['365', '1 year']];
const LEVEL_LABEL = { normal: 'normal', watch: 'elevated', high: 'high', urgent: 'very high' };

function assess(type, v, v2) {
  // Mirrors the server's thresholds for instant feedback in the form.
  if (type === 'bp') {
    if (v > 180 || v2 > 120) return 'urgent';
    if (v >= 140 || v2 >= 90) return 'high';
    if (v >= 120 || v2 >= 80) return 'watch';
    return 'normal';
  }
  return 'normal';
}

export function openLogVital(type = 'bp') {
  const types = state.meta.vitalTypes;
  openModal({
    title: 'Log a reading',
    body: html`<form class="form-grid" novalidate>
      <label class="field full"><span>What are you measuring?</span>
        <select name="type">${Object.entries(types).map(([k, t]) => html`<option value="${k}" ${k === type ? 'selected' : ''}>${t.label} (${t.unit})</option>`)}</select></label>
      <label class="field" data-v1><span data-v1-label>Value</span><input name="value" type="number" step="any" inputmode="decimal" required></label>
      <label class="field" data-v2><span>Diastolic (lower)</span><input name="value2" type="number" step="any" inputmode="decimal"></label>
      <label class="field"><span>When</span><input name="recorded_at" type="datetime-local" value="${toLocalInput()}"></label>
      <label class="field full"><span>Note <small class="muted">(optional)</small></span><input name="note" placeholder="e.g. fasting, after walk, felt dizzy"></label>
      <div class="form-error full" data-error hidden></div>
      <div class="form-actions full"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn primary" type="submit">${icon('check')} Save reading</button></div>
    </form>`,
    onMount(root, close) {
      const form = root.querySelector('form');
      const sync = () => {
        const t = form.type.value;
        root.querySelector('[data-v2]').hidden = t !== 'bp';
        root.querySelector('[data-v1-label]').textContent = t === 'bp' ? 'Systolic (upper)' : `Value (${types[t].unit})`;
        root.querySelector('[data-v1]').classList.toggle('full', t !== 'bp');
        form.value2.required = t === 'bp';
      };
      sync();
      form.type.onchange = sync;
      root.querySelector('[data-cancel]').onclick = close;
      form.onsubmit = async (e) => {
        e.preventDefault();
        const err = root.querySelector('[data-error]');
        err.hidden = true;
        const body = {
          type: form.type.value, value: form.value.value, value2: form.type.value === 'bp' ? form.value2.value : null,
          note: form.note.value, recorded_at: form.recorded_at.value ? new Date(form.recorded_at.value).toISOString() : undefined,
        };
        try {
          const v = await busy(form.querySelector('[type=submit]'), () => api(p('/vitals'), { method: 'POST', body }));
          close();
          const label = types[v.type].label;
          const ok = v.assessment.level === 'normal';
          toast({
            title: ok ? `${label} saved. That's in the normal range.` : `${label} saved: ${v.assessment.text}`,
            body: v.assessment.level === 'urgent' ? 'Please contact your doctor right away, or call 112 if you feel unwell.' : '',
            type: v.assessment.level === 'urgent' ? 'urgent' : ok ? 'success' : 'warning',
            timeout: v.assessment.level === 'urgent' ? 0 : 5000,
          });
        } catch (e2) {
          err.textContent = e2.message;
          err.hidden = false;
        }
      };
    },
  });
}

export default {
  title: 'Vitals',
  refreshOn: ['vitals'],
  async render(el, _params, query) {
    const types = state.meta.vitalTypes;
    let type = types[query?.type] ? query.type : 'bp';
    let days = '90';
    let chart = null;
    const editable = canEdit();

    el.innerHTML = html`
      <div class="page-header">
        <div><h1>Vitals</h1><p>Every reading you or your family log, with the normal range shaded in.</p></div>
        ${editable ? html`<div class="actions"><button class="btn primary" data-log>${icon('plus')} Log a reading</button></div>` : ''}
      </div>
      <div class="segmented" data-types>${Object.entries(types).map(([k, t]) => html`<button data-type="${k}">${t.label}</button>`)}</div>
      <div class="card" style="margin-top:16px">
        <div class="card-header"><h2 data-title></h2><div class="segmented" data-ranges>${RANGES.map(([d, l]) => html`<button data-days="${d}">${l}</button>`)}</div></div>
        <div class="card-body"><div data-stats class="stats"></div><div class="chart-box" data-chart-box></div></div>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="card-header"><h2>Readings</h2></div>
        <div class="card-body"><div class="list" data-list></div></div>
      </div>`;

    el.querySelector('[data-log]')?.addEventListener('click', () => openLogVital(type));

    async function load() {
      for (const b of el.querySelectorAll('[data-type]')) b.classList.toggle('active', b.dataset.type === type);
      for (const b of el.querySelectorAll('[data-days]')) b.classList.toggle('active', b.dataset.days === days);
      const info = types[type];
      el.querySelector('[data-title]').innerHTML = html`${icon(VITAL_ICON[type])} ${info.label}`;
      const rows = await api(p(`/vitals?type=${type}&days=${days}`));

      const stats = el.querySelector('[data-stats]');
      if (rows.length) {
        const vals = rows.map((r) => r.value);
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const last = rows.at(-1);
        const fmt = (n) => (Number.isInteger(n) ? n : n.toFixed(1));
        const avg2 = type === 'bp' ? rows.reduce((a, r) => a + r.value2, 0) / rows.length : null;
        stats.innerHTML = html`
          <div><div class="eyebrow">Latest</div><div class="v">${type === 'bp' ? `${last.value}/${last.value2}` : last.value} <small>${info.unit}</small></div></div>
          <div><div class="eyebrow">Average</div><div class="v">${type === 'bp' ? `${Math.round(avg)}/${Math.round(avg2)}` : fmt(Math.round(avg * 10) / 10)} <small>${info.unit}</small></div></div>
          <div><div class="eyebrow">Lowest to highest</div><div class="v">${fmt(Math.min(...vals))}–${fmt(Math.max(...vals))}</div></div>`;
      } else {
        stats.innerHTML = '';
      }

      chart?.destroy();
      chart = null;
      const box = el.querySelector('[data-chart-box]');
      if (rows.length > 1) {
        box.innerHTML = '<canvas aria-label="Vitals chart"></canvas>';
        let band = BANDS[type];
        const height = isOwnProfile() ? state.user.height_cm : null;
        if (type === 'weight' && height) {
          const h = (height / 100) ** 2;
          band = { low: Math.round(18.5 * h), high: Math.round(24.9 * h) };
        }
        chart = lineChart(box.querySelector('canvas'), {
          labels: rows.map((r) => shortDate(r.recorded_at)),
          series: type === 'bp'
            ? [{ label: 'Systolic', data: rows.map((r) => r.value) }, { label: 'Diastolic', data: rows.map((r) => r.value2) }]
            : [{ label: info.label, data: rows.map((r) => r.value) }],
          band, unit: info.unit,
        });
      } else {
        box.innerHTML = html`<div class="empty"><div class="ic">${icon(VITAL_ICON[type])}</div><h3>${rows.length ? 'One reading so far' : 'No readings yet'}</h3><p>Add a couple of readings to see your trend.${type === 'weight' && isOwnProfile() && !state.user.height_cm ? ' Add your height in settings to see a healthy-weight band.' : ''}</p></div>`;
      }

      const list = el.querySelector('[data-list]');
      list.innerHTML = rows.length ? [...rows].reverse().slice(0, 50).map((r) => html`
        <div class="list-item">
          <div class="ic">${icon(VITAL_ICON[type])}</div>
          <div class="grow"><div class="title">${type === 'bp' ? `${r.value}/${r.value2}` : r.value} ${info.unit}
            ${type === 'bp' ? html` <span class="status ${assess(type, r.value, r.value2)}" style="margin-left:8px"><i class="dot ${assess(type, r.value, r.value2)}"></i>${LEVEL_LABEL[assess(type, r.value, r.value2)]}</span>` : ''}</div>
            <div class="sub">${fmtWhen(r.recorded_at)}${r.note ? `, ${r.note}` : ''}</div></div>
          ${editable ? html`<button class="icon-btn sm" data-del="${r.id}" aria-label="Delete reading">${icon('trash')}</button>` : ''}
        </div>`).join('') : html`<p class="muted">No ${info.label.toLowerCase()} readings in this period.</p>`;
    }

    el.querySelector('[data-types]').onclick = (e) => {
      const b = e.target.closest('[data-type]');
      if (b) { type = b.dataset.type; history.replaceState(null, '', `#/vitals?type=${type}`); load(); }
    };
    el.querySelector('[data-ranges]').onclick = (e) => {
      const b = e.target.closest('[data-days]');
      if (b) { days = b.dataset.days; load(); }
    };
    el.querySelector('[data-list]').onclick = async (e) => {
      const b = e.target.closest('[data-del]');
      if (!b || !(await confirmDialog('Delete this reading? This can\'t be undone.'))) return;
      try { await api(p(`/vitals/${b.dataset.del}`), { method: 'DELETE' }); } catch (err) { toastError(err); }
    };

    await load();
    return () => chart?.destroy();
  },
};
