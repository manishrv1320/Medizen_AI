import { api, state } from '../api.js';
import { avatar, busy, confirmDialog, html, icon, toast, toastError } from '../ui.js';
import { refresh, reloadMe } from '../app.js';

const RELATIONS = ['Spouse', 'Wife', 'Husband', 'Son', 'Daughter', 'Mother', 'Father', 'Brother', 'Sister', 'Caregiver', 'Friend', 'Other'];

export default {
  title: 'Family',
  async render(el) {
    const { sharing, sharedWithMe } = await api('/api/family');

    el.innerHTML = html`
      <div class="page-header"><div><h1>Family</h1><p>Let the people close to you see your records, and keep an eye on theirs.</p></div></div>
      <div class="dash">
        <div class="stack">
          <div class="card">
            <div class="card-header"><h2>${icon('shield')} Who can see my records</h2></div>
            <div class="card-body">
              ${sharing.length ? html`<div class="list">${sharing.map((s) => html`
                <div class="list-item" data-share="${s.id}">
                  ${avatar(s.member_name || s.member_email, s.id, 'lg')}
                  <div class="grow"><div class="title">${s.member_name || s.member_email}</div>
                    <div class="sub">${s.relation ? `${s.relation} · ` : ''}${s.member_name ? s.member_email : 'Invited. They get access when they sign up with this email.'}</div></div>
                  <select data-access style="width:auto" aria-label="Access level">
                    <option value="view" ${s.access === 'view' ? 'selected' : ''}>View only</option>
                    <option value="manage" ${s.access === 'manage' ? 'selected' : ''}>Can manage</option>
                  </select>
                  <button class="icon-btn sm" data-remove aria-label="Stop sharing">${icon('trash')}</button>
                </div>`)}</div>`
              : html`<p class="muted">You aren't sharing your records with anyone yet.</p>`}
            </div>
          </div>

          <div class="card">
            <div class="card-header"><h2>${icon('plus')} Share my records</h2></div>
            <div class="card-body">
              <form class="form-grid" novalidate>
                <label class="field"><span>Their email</span><input name="email" type="email" required placeholder="family@example.com"></label>
                <label class="field"><span>They are my…</span><select name="relation"><option value="">Choose…</option>${RELATIONS.map((r) => html`<option>${r}</option>`)}</select></label>
                <label class="field"><span>Access</span><select name="access"><option value="view">View only: reports, readings and reminders</option><option value="manage">Can manage: can also add reports, readings and reminders</option></select></label>
                <label class="field"><span>Alerts</span><label class="check" style="height:42px"><input type="checkbox" name="notify" checked> Notify them about missed medicines & concerning readings</label></label>
                <div class="form-error full" data-error hidden></div>
                <div class="form-actions full"><button class="btn primary" type="submit">${icon('users')} Share access</button></div>
              </form>
            </div>
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <div class="card-header"><h2>${icon('heart')} Shared with me</h2></div>
            <div class="card-body">
              ${sharedWithMe.length ? html`<div class="list">${sharedWithMe.map((s) => html`
                <div class="list-item" data-owner="${s.owner_id}">
                  ${avatar(s.name, s.owner_id, 'lg')}
                  <div class="grow"><div class="title">${s.name}</div>
                    <div class="sub"><span class="pill ${s.access}">${s.access === 'manage' ? 'Can manage' : 'View only'}</span></div>
                    <label class="check small" style="margin-top:6px"><input type="checkbox" data-notify ${s.notify ? 'checked' : ''}> Alert me about missed medicines & concerning readings</label>
                  </div>
                  <div class="row-actions" style="flex-direction:column">
                    <a class="btn sm primary" href="#/dashboard?profile=${s.owner_id}">Open</a>
                    <button class="btn sm ghost" data-leave>Leave</button>
                  </div>
                </div>`)}</div>`
              : html`<div class="empty"><div class="ic">${icon('users')}</div><p>When a family member shares their records with <b>${state.user.email}</b>, they'll appear here.</p></div>`}
            </div>
          </div>
          <div class="card card-pad">
            <h3 style="margin-bottom:8px">How family sharing works</h3>
            <ul class="muted small" style="margin:0;padding-left:18px;display:grid;gap:6px">
              <li><b>View only</b> means they can see your reports, readings and reminders.</li>
              <li><b>Can manage</b> also lets them add reports, log readings and set reminders for you. Useful when you look after a parent.</li>
              <li>With alerts on, they're notified if you miss a medicine for over an hour, log a dangerous reading, or add a report with values out of range.</li>
              <li>You can change or remove access any time.</li>
            </ul>
          </div>
        </div>
      </div>`;

    const form = el.querySelector('form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const err = el.querySelector('[data-error]');
      err.hidden = true;
      const body = { email: form.email.value, relation: form.relation.value, access: form.access.value, notify: form.notify.checked };
      try {
        const res = await busy(form.querySelector('[type=submit]'), () => api('/api/family', { method: 'POST', body }));
        toast({ title: res.message, type: 'success' });
        refresh();
      } catch (e2) {
        err.textContent = e2.message;
        err.hidden = false;
      }
    };

    el.addEventListener('change', async (e) => {
      try {
        if (e.target.matches('[data-access]')) {
          const id = e.target.closest('[data-share]').dataset.share;
          await api(`/api/family/${id}`, { method: 'PUT', body: { access: e.target.value } });
          toast({ title: 'Access updated', type: 'success', timeout: 2500 });
        } else if (e.target.matches('[data-notify]')) {
          const owner = e.target.closest('[data-owner]').dataset.owner;
          await api(`/api/family/incoming/${owner}`, { method: 'PUT', body: { notify: e.target.checked } });
          toast({ title: e.target.checked ? 'Alerts turned on' : 'Alerts turned off', type: 'success', timeout: 2500 });
        }
      } catch (err) { toastError(err); }
    });

    el.addEventListener('click', async (e) => {
      try {
        if (e.target.closest('[data-remove]')) {
          const item = e.target.closest('[data-share]');
          if (!(await confirmDialog('Stop sharing your records with this person? They will lose access immediately.', { confirmLabel: 'Stop sharing' }))) return;
          await api(`/api/family/${item.dataset.share}`, { method: 'DELETE' });
          refresh();
        } else if (e.target.closest('[data-leave]')) {
          const item = e.target.closest('[data-owner]');
          if (!(await confirmDialog("Stop viewing this person's records? They'd need to share again.", { confirmLabel: 'Leave' }))) return;
          await api(`/api/family/incoming/${item.dataset.owner}`, { method: 'DELETE' });
          await reloadMe();
          refresh();
        }
      } catch (err) { toastError(err); }
    });
  },
};
