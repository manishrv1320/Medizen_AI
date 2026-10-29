import { api, canEdit, p, state } from '../api.js';
import {
  busy, confirmDialog, fmtDate, fmtSize, html, icon, todayISO, toast, toastError,
} from '../ui.js';
import { lineChart } from '../charts.js';
import { navigate } from '../app.js';

// List
export default {
  title: 'Reports',
  refreshOn: ['reports'],
  async render(el) {
    const reports = await api(p('/reports'));
    const editable = canEdit();
    let filter = 'All';
    const types = ['All', ...new Set(reports.map((r) => r.type))];

    el.innerHTML = html`
      <div class="page-header">
        <div><h1>Reports</h1><p>Lab results, checkups and prescriptions, newest first.</p></div>
        ${editable ? html`<div class="actions"><a class="btn primary" href="#/reports/new">${icon('plus')} Add a report</a></div>` : ''}
      </div>
      ${types.length > 2 ? html`<div class="segmented" data-filter style="margin-bottom:18px">${types.map((t) => html`<button data-t="${t}">${t}</button>`)}</div>` : ''}
      <div data-grid></div>`;

    const draw = () => {
      for (const b of el.querySelectorAll('[data-t]')) b.classList.toggle('active', b.dataset.t === filter);
      const shown = reports.filter((r) => filter === 'All' || r.type === filter);
      el.querySelector('[data-grid]').innerHTML = shown.length ? html`<div class="card card-pad"><table class="plain report-table">
        <thead><tr><th>Date</th><th>Report</th><th>Lab / doctor</th><th class="num">Results</th></tr></thead>
        <tbody>${shown.map((r) => html`<tr class="clickable" data-href="#/reports/${r.id}">
          <td class="num" style="text-align:left">${fmtDate(r.date)}</td>
          <td><a href="#/reports/${r.id}">${r.title}</a><small>${r.type}${r.file_count ? `, ${r.file_count} file${r.file_count > 1 ? 's' : ''}` : ''}</small></td>
          <td class="muted">${[r.provider, r.doctor].filter(Boolean).join(', ') || ''}</td>
          <td class="num">${r.abnormal_count
            ? html`<span class="flags">${r.abnormal_count} of ${r.metric_count} flagged</span>`
            : r.metric_count ? html`<span class="clean">${r.metric_count} normal</span>` : html`<span class="muted">No values</span>`}</td>
        </tr>`)}</tbody></table></div>`
        : html`<div class="card empty"><h3>No reports yet</h3>
            <p>Add a checkup and type in the main values. Anything outside the normal range gets flagged, and you can follow each value over the years.</p>
            ${editable ? html`<a class="btn primary" href="#/reports/new">Add a report</a>` : ''}</div>`;
    };
    el.addEventListener('click', (e) => {
      const row = e.target.closest('tr[data-href]');
      if (row && !e.target.closest('a')) location.hash = row.dataset.href;
    });
    el.querySelector('[data-filter]')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]');
      if (b) { filter = b.dataset.t; draw(); }
    });
    draw();
  },
};

// Detail
function rangeBar(m) {
  if (m.ref_low == null || m.ref_high == null) return '';
  const span = m.ref_high - m.ref_low || 1;
  const min = Math.min(m.ref_low - span * 0.5, m.value);
  const max = Math.max(m.ref_high + span * 0.5, m.value);
  const pos = (v) => ((v - min) / (max - min)) * 100;
  return html`<div class="range-bar" title="Normal range ${m.ref_low}–${m.ref_high}">
    <div class="ok-zone" style="left:${pos(m.ref_low)}%;right:${100 - pos(m.ref_high)}%"></div>
    <div class="marker ${m.status}" style="left:${pos(m.value)}%"></div></div>`;
}

export const reportDetail = {
  title: 'Report',
  refreshOn: ['reports'],
  async render(el, { id }) {
    const r = await api(p(`/reports/${id}`));
    const editable = canEdit();
    const abnormal = r.metrics.filter((m) => m.status !== 'normal');
    let chart = null;

    el.innerHTML = html`
      <a class="back" href="#/reports">${icon('chevronLeft')} All reports</a>
      <div class="page-header">
        <div><h1>${r.title}</h1><p>${fmtDate(r.date)}, ${[r.type, r.provider, r.doctor].filter(Boolean).join(', ')}</p></div>
        ${editable ? html`<div class="actions"><button class="btn danger" data-delete>Delete</button></div>` : ''}
      </div>
      ${r.metrics.length ? html`<div class="banner ${abnormal.length ? 'watch' : 'ok'}">
        <span>${abnormal.length
          ? html`<b>${abnormal.length} of ${r.metrics.length}</b> values are outside the normal range (${abnormal.map((m) => m.name).join(', ')}). Worth bringing up with your doctor.`
          : `All ${r.metrics.length} values are within the normal range.`}</span></div>` : ''}
      <div class="dash" style="margin-top:14px">
        <div class="stack">
          <div class="card">
            <div class="card-header"><h2>Results</h2><span class="muted small">Select a test to see how it has changed</span></div>
            <div class="card-body">${r.metrics.length ? html`<div class="table-wrap"><table class="plain">
              <thead><tr><th>Test</th><th class="num">Result</th><th class="num">Normal</th><th style="width:26%"></th><th></th></tr></thead>
              <tbody>${r.metrics.map((m) => html`<tr class="clickable" data-metric="${m.name}">
                <td>${m.name}</td>
                <td class="num"><b>${m.value}</b> <span class="muted small">${m.unit || ''}</span></td>
                <td class="num muted">${m.ref_low ?? '–'}–${m.ref_high ?? '–'}</td>
                <td style="vertical-align:middle">${rangeBar(m)}</td>
                <td><span class="status ${m.status}"><i class="dot ${m.status}"></i>${m.status === 'normal' ? 'Normal' : m.status === 'high' ? 'High' : 'Low'}</span></td></tr>`)}</tbody></table></div>`
              : html`<p class="muted">No test values were entered for this report.</p>`}</div>
          </div>
          <div class="card" data-trend-card hidden>
            <div class="card-header"><h2 data-trend-title></h2></div>
            <div class="card-body"><div class="chart-box sm"><canvas data-trend></canvas></div></div>
          </div>
        </div>
        <div class="stack">
          <div class="card"><div class="card-header"><h2>Attachments</h2></div>
            <div class="card-body">${r.files.length ? html`<div class="file-chips">${r.files.map((f) => html`
              <a class="chip" href="${p(`/reports/${r.id}/files/${f.id}`)}" target="_blank" rel="noopener">${icon(f.mime === 'application/pdf' ? 'report' : 'eye')}<span>${f.original_name}</span><small class="muted">${fmtSize(f.size)}</small></a>`)}</div>`
              : html`<p class="muted small">No files attached.</p>`}</div></div>
          <div class="card"><div class="card-header"><h2>Notes</h2></div>
            <div class="card-body"><p style="white-space:pre-wrap">${r.notes || html`<span class="muted">No notes.</span>`}</p></div></div>
        </div>
      </div>`;

    el.querySelector('[data-delete]')?.addEventListener('click', async () => {
      if (!(await confirmDialog(`Delete "${r.title}" and its attachments? This can't be undone.`))) return;
      try {
        await api(p(`/reports/${r.id}`), { method: 'DELETE' });
        toast({ title: 'Report deleted', type: 'success', timeout: 3000 });
        navigate('/reports');
      } catch (err) { toastError(err); }
    });

    el.querySelector('tbody')?.addEventListener('click', async (e) => {
      const row = e.target.closest('[data-metric]');
      if (!row) return;
      const name = row.dataset.metric;
      const trend = await api(p(`/metrics/trend?name=${encodeURIComponent(name)}`));
      const card = el.querySelector('[data-trend-card]');
      card.hidden = false;
      el.querySelector('[data-trend-title]').textContent = trend.length > 1 ? `${name} over time` : `${name}: only one result so far`;
      chart?.destroy();
      const last = trend.at(-1);
      const values = trend.map((t) => t.value);
      chart = lineChart(el.querySelector('[data-trend]'), {
        labels: trend.map((t) => fmtDate(t.date)),
        series: [{ label: name, data: values }],
        band: { low: last.ref_low, high: last.ref_high }, unit: last.unit || '',
        // Keep the normal-range band in view so the trend has context.
        suggestedMin: Math.min(...values, last.ref_low ?? Infinity),
        suggestedMax: Math.max(...values, last.ref_high ?? -Infinity),
      });
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    return () => chart?.destroy();
  },
};

// New report
export const reportNew = {
  title: 'Add report',
  async render(el) {
    if (!canEdit()) {
      el.innerHTML = html`<div class="card empty"><h3>View only</h3><p>You can't add reports to this profile.</p></div>`;
      return;
    }
    const { reportTypes, metricPresets } = state.meta;
    const files = [];

    el.innerHTML = html`
      <a class="back" href="#/reports">${icon('chevronLeft')} All reports</a>
      <div class="page-header"><div><h1>Add a report</h1><p>Attach the PDF or a photo of the report, then type in the main values so they can be tracked over time.</p></div></div>
      <form class="stack" novalidate>
        <div class="card card-pad"><div class="form-grid">
          <label class="field full"><span>Title</span><input name="title" required placeholder="e.g. Annual full body checkup"></label>
          <label class="field"><span>Type</span><select name="type">${reportTypes.map((t) => html`<option>${t}</option>`)}</select></label>
          <label class="field"><span>Date of test</span><input name="date" type="date" value="${todayISO()}" max="${todayISO()}" required></label>
          <label class="field"><span>Lab / hospital</span><input name="provider" placeholder="e.g. Apollo Diagnostics"></label>
          <label class="field"><span>Doctor</span><input name="doctor" placeholder="e.g. Dr. Rao"></label>
          <label class="field full"><span>Notes</span><textarea name="notes" placeholder="Doctor's advice, medicines changed, follow-up date…"></textarea></label>
        </div></div>

        <div class="card">
          <div class="card-header"><h2>Test values</h2><button type="button" class="btn sm" data-add-metric>${icon('plus')} Add value</button></div>
          <div class="card-body">
            <p class="muted small" style="margin-bottom:12px">Start typing a test name. Common tests fill in the unit and normal range for you; change the range if your lab prints a different one.</p>
            <div class="metric-rows">
              <div class="metric-row metric-head"><span>Test</span><span>Result</span><span>Unit</span><span>Normal from</span><span>Normal to</span><span></span></div>
              <div data-metrics></div>
            </div>
            <datalist id="metric-presets">${metricPresets.map((m) => html`<option value="${m.name}">`)}</datalist>
          </div>
        </div>

        <div class="card card-pad">
          <label class="dropzone" data-drop><b>Attach the report</b><span class="small">PDF or images, up to 15 MB each</span>
            <input type="file" name="files" multiple accept="application/pdf,image/*" hidden></label>
          <div class="file-chips" data-files style="margin-top:12px"></div>
        </div>

        <div class="form-error" data-error hidden></div>
        <div class="form-actions"><a class="btn" href="#/reports">Cancel</a><button class="btn primary" type="submit">${icon('check')} Save report</button></div>
      </form>`;

    const form = el.querySelector('form');
    const metricsEl = el.querySelector('[data-metrics]');
    const addRow = (m = {}) => {
      const row = document.createElement('div');
      row.className = 'metric-row';
      row.innerHTML = html`
        <input list="metric-presets" data-k="name" placeholder="Test name" value="${m.name || ''}">
        <input type="number" step="any" data-k="value" placeholder="Result">
        <input data-k="unit" placeholder="Unit" value="${m.unit || ''}">
        <input type="number" step="any" data-k="ref_low" placeholder="Low">
        <input type="number" step="any" data-k="ref_high" placeholder="High">
        <button type="button" class="icon-btn sm" data-remove aria-label="Remove">${icon('x')}</button>`;
      row.querySelector('[data-k=name]').addEventListener('change', (e) => {
        const preset = metricPresets.find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase());
        if (!preset) return;
        e.target.value = preset.name;
        row.querySelector('[data-k=unit]').value = preset.unit;
        row.querySelector('[data-k=ref_low]').value = preset.ref_low;
        row.querySelector('[data-k=ref_high]').value = preset.ref_high;
        row.querySelector('[data-k=value]').focus();
      });
      row.querySelector('[data-remove]').onclick = () => row.remove();
      metricsEl.append(row);
    };
    addRow();
    addRow();
    el.querySelector('[data-add-metric]').onclick = () => addRow();

    const drop = el.querySelector('[data-drop]');
    const fileInput = form.files;
    const drawFiles = () => {
      el.querySelector('[data-files]').innerHTML = files.map((f, i) => html`
        <span class="chip">${icon('clip')}<span>${f.name}</span><small class="muted">${fmtSize(f.size)}</small>
        <button type="button" class="icon-btn sm" data-rm="${i}" aria-label="Remove file">${icon('x')}</button></span>`).join('');
    };
    const addFiles = (list) => { files.push(...list); drawFiles(); };
    fileInput.onchange = () => { addFiles(fileInput.files); fileInput.value = ''; };
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });
    el.querySelector('[data-files]').onclick = (e) => {
      const b = e.target.closest('[data-rm]');
      if (b) { files.splice(Number(b.dataset.rm), 1); drawFiles(); }
    };

    form.onsubmit = async (e) => {
      e.preventDefault();
      const err = el.querySelector('[data-error]');
      err.hidden = true;
      const metrics = [...metricsEl.querySelectorAll('.metric-row')].map((row) =>
        Object.fromEntries([...row.querySelectorAll('[data-k]')].map((i) => [i.dataset.k, i.value.trim()])))
        .filter((m) => m.name && m.value !== '');
      const fd = new FormData();
      for (const k of ['title', 'type', 'date', 'provider', 'doctor', 'notes']) fd.append(k, form[k].value);
      fd.append('metrics', JSON.stringify(metrics));
      for (const f of files) fd.append('files', f);
      try {
        const report = await busy(form.querySelector('[type=submit]'), () => api(p('/reports'), { method: 'POST', form: fd }));
        const flagged = report.metrics.filter((m) => m.status !== 'normal');
        toast({
          title: 'Report saved',
          body: flagged.length ? `${flagged.length} value${flagged.length > 1 ? 's' : ''} outside the normal range, marked in the results.` : report.metrics.length ? 'Everything is within the normal range.' : '',
          type: flagged.length ? 'warning' : 'success',
        });
        navigate(`/reports/${report.id}`);
      } catch (e2) {
        err.textContent = e2.message;
        err.hidden = false;
        err.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
  },
};
