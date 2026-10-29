import { api, canEdit, p, state } from '../api.js';
import {
  CATEGORY_ICON, busy, confirmDialog, fmtWhen, html, icon, openModal, toLocalInput, toast, toastError,
} from '../ui.js';

const CATEGORY_LABEL = { medication: 'Medicine', checkup: 'Checkup', appointment: 'Appointment', test: 'Lab test', exercise: 'Exercise', other: 'Other' };
const FREQ_LABEL = { once: 'Once', daily: 'Every day', weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' };

function openEditor(reminder = null) {
  const { reminderCategories, frequencies } = state.meta;
  const nextHour = new Date(Date.now() + 3600_000);
  nextHour.setMinutes(0, 0, 0);
  openModal({
    title: reminder ? 'Edit reminder' : 'New reminder',
    body: html`<form class="form-grid" novalidate>
      <label class="field full"><span>What should I remind you about?</span>
        <input name="title" required placeholder="e.g. Metformin 500 mg" value="${reminder?.title || ''}"></label>
      <label class="field"><span>Type</span><select name="category">${reminderCategories.map((c) => html`<option value="${c}" ${reminder?.category === c ? 'selected' : ''}>${CATEGORY_LABEL[c]}</option>`)}</select></label>
      <label class="field"><span>Repeat</span><select name="frequency">${frequencies.map((f) => html`<option value="${f}" ${reminder?.frequency === f ? 'selected' : ''}>${FREQ_LABEL[f]}</option>`)}</select></label>
      <label class="field full"><span>${reminder ? 'Next time' : 'First time'}</span>
        <input name="due" type="datetime-local" required value="${toLocalInput(reminder?.next_due_at || nextHour)}"></label>
      <label class="field full"><span>Notes <small class="muted">(optional)</small></span><input name="notes" placeholder="e.g. after breakfast, carry old reports" value="${reminder?.notes || ''}"></label>
      <div class="form-error full" data-error hidden></div>
      <div class="form-actions full"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn primary" type="submit">${icon('check')} ${reminder ? 'Save' : 'Create reminder'}</button></div>
    </form>`,
    onMount(root, close) {
      const form = root.querySelector('form');
      root.querySelector('[data-cancel]').onclick = close;
      form.title.addEventListener('input', () => {
        if (reminder) return;
        const t = form.title.value.toLowerCase();
        if (/\b(tab|tablet|pill|mg|capsule|syrup|insulin|medicine)\b/.test(t)) form.category.value = 'medication';
        else if (/\b(dr|doctor|appointment|dentist|clinic)\b/.test(t)) form.category.value = 'appointment';
        else if (/\b(walk|yoga|exercise|gym)\b/.test(t)) form.category.value = 'exercise';
      });
      form.onsubmit = async (e) => {
        e.preventDefault();
        const err = root.querySelector('[data-error]');
        err.hidden = true;
        const body = {
          title: form.title.value, category: form.category.value, frequency: form.frequency.value,
          notes: form.notes.value, next_due_at: form.due.value ? new Date(form.due.value).toISOString() : '',
        };
        try {
          await busy(form.querySelector('[type=submit]'), () =>
            api(p(reminder ? `/reminders/${reminder.id}` : '/reminders'), { method: reminder ? 'PUT' : 'POST', body }));
          close();
          toast({ title: reminder ? 'Reminder updated' : `Got it! I'll remind you ${fmtWhen(body.next_due_at).toLowerCase()}. ⏰`, type: 'success', timeout: 4000 });
        } catch (e2) {
          err.textContent = e2.message;
          err.hidden = false;
        }
      };
    },
  });
}

function row(r, editable) {
  const due = new Date(r.effective_due);
  const late = r.active && due < new Date();
  return html`<div class="list-item" data-id="${r.id}">
    <div class="ic ${late ? 'overdue' : r.category}">${icon(CATEGORY_ICON[r.category] || 'alarm')}</div>
    <div class="grow">
      <div class="title">${r.title}</div>
      <div class="sub">${r.active ? html`${late ? html`<b style="color:var(--urgent)">Pending since</b> ` : ''}${fmtWhen(r.effective_due)}` : 'Paused / completed'}
        · ${FREQ_LABEL[r.frequency]}${r.snooze_until && r.active ? ' · snoozed' : ''}${r.notes ? ` · ${r.notes}` : ''}</div>
    </div>
    ${editable ? html`<div class="row-actions">
      ${r.active ? html`<button class="btn sm ${late ? 'primary' : ''}" data-act="done">${icon('check')} Done</button>
        ${late ? html`<button class="icon-btn sm" data-act="snooze" title="Snooze 10 minutes" aria-label="Snooze 10 minutes">${icon('snooze')}</button>` : ''}`
      : html`<button class="btn sm" data-act="resume">Resume</button>`}
      <button class="icon-btn sm" data-act="edit" aria-label="Edit">${icon('edit')}</button>
      <button class="icon-btn sm" data-act="delete" aria-label="Delete">${icon('trash')}</button>
    </div>` : ''}
  </div>`;
}

export default {
  title: 'Reminders',
  refreshOn: ['reminders'],
  async render(el) {
    const all = await api(p('/reminders?all=1'));
    const editable = canEdit();
    const now = Date.now();
    const dayEnd = now + 24 * 3600_000;
    const active = all.filter((r) => r.active);
    const groups = [
      ['Today & pending', active.filter((r) => new Date(r.effective_due).getTime() <= dayEnd)],
      ['Coming up', active.filter((r) => new Date(r.effective_due).getTime() > dayEnd)],
      ['Paused & completed', all.filter((r) => !r.active)],
    ];

    el.innerHTML = html`
      <div class="page-header">
        <div><h1>Reminders</h1><p>Medicines, appointments and checkups. You'll get a nudge when each one is due${editable ? ', and family are told if a medicine is missed.' : '.'}</p></div>
        ${editable ? html`<div class="actions"><button class="btn primary" data-new>${icon('plus')} New reminder</button></div>` : ''}
      </div>
      ${all.length ? html`<div class="stack">${groups.filter(([, items]) => items.length).map(([label, items]) => html`
        <div class="card"><div class="card-header"><h2>${label}</h2><span class="muted small">${items.length}</span></div>
          <div class="card-body"><div class="list">${items.map((r) => row(r, editable))}</div></div></div>`)}</div>`
      : html`<div class="card empty"><div class="ic">${icon('alarm')}</div><h3>No reminders yet</h3>
          <p>Add your daily medicines and upcoming appointments. Tip: you can also just tell your assistant, “remind me to take my BP tablet every day at 8pm”.</p>
          ${editable ? html`<button class="btn primary" data-new>${icon('plus')} Add a reminder</button>` : ''}</div>`}`;

    el.querySelector('[data-new]')?.addEventListener('click', () => openEditor());
    el.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = Number(btn.closest('[data-id]').dataset.id);
      const r = all.find((x) => x.id === id);
      try {
        switch (btn.dataset.act) {
          case 'done':
            await api(p(`/reminders/${id}/done`), { method: 'POST' });
            toast({ title: `${r.title}: ${r.category === 'medication' ? 'taken' : 'done'}`, type: 'success', timeout: 2500 });
            break;
          case 'snooze':
            await api(p(`/reminders/${id}/snooze`), { method: 'POST', body: { minutes: 10 } });
            toast({ title: "Okay, I'll remind you again in 10 minutes.", type: 'reminder', timeout: 3000 });
            break;
          case 'resume': {
            const next = new Date(r.next_due_at) > new Date() ? r.next_due_at : new Date(Date.now() + 3600_000).toISOString();
            await api(p(`/reminders/${id}`), { method: 'PUT', body: { active: true, next_due_at: next } });
            break;
          }
          case 'edit':
            openEditor(r);
            break;
          case 'delete':
            if (await confirmDialog(`Delete the reminder "${r.title}"?`)) await api(p(`/reminders/${id}`), { method: 'DELETE' });
            break;
        }
      } catch (err) { toastError(err); }
    });
  },
};
