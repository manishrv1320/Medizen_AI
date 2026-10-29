import { api, state } from '../api.js';
import { busy, formData, html, icon, toast } from '../ui.js';
import { refresh, reloadMe, setTheme } from '../app.js';
import * as assistant from '../assistant.js';

const BLOOD = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const GENDER = ['', 'Female', 'Male', 'Other'];

const option = (v, cur, label = v) => html`<option value="${v}" ${String(cur ?? '') === v ? 'selected' : ''}>${label || 'Not set'}</option>`;

export default {
  title: 'Settings',
  async render(el) {
    const u = state.user;
    let theme = 'system';
    try { theme = localStorage.getItem('mz.theme') || 'system'; } catch { /* storage unavailable */ }
    const notifPerm = 'Notification' in window ? Notification.permission : 'unsupported';

    el.innerHTML = html`
      <div class="page-header"><div><h1>Profile & settings</h1><p>Your details help your assistant give better, more personal advice.</p></div></div>
      <div class="dash">
        <div class="stack">
          <form class="card" data-profile novalidate>
            <div class="card-header"><h2>${icon('user')} About you</h2></div>
            <div class="card-body form-grid">
              <label class="field full"><span>Full name</span><input name="name" required value="${u.name}"></label>
              <label class="field"><span>Date of birth</span><input name="dob" type="date" value="${u.dob || ''}"></label>
              <label class="field"><span>Gender</span><select name="gender">${GENDER.map((g) => option(g, u.gender))}</select></label>
              <label class="field"><span>Blood group</span><select name="blood_group">${BLOOD.map((b) => option(b, u.blood_group))}</select></label>
              <label class="field"><span>Height (cm)</span><input name="height_cm" type="number" min="50" max="250" value="${u.height_cm ?? ''}"></label>
              <label class="field full"><span>Phone</span><input name="phone" type="tel" value="${u.phone || ''}"></label>
              <label class="field full"><span>Health conditions</span><input name="conditions" placeholder="e.g. Type 2 diabetes, hypertension" value="${u.conditions || ''}"></label>
              <label class="field full"><span>Allergies</span><input name="allergies" placeholder="e.g. Penicillin, peanuts" value="${u.allergies || ''}"></label>
              <div class="form-actions full"><button class="btn primary" type="submit">${icon('check')} Save profile</button></div>
            </div>
          </form>

          <form class="card" data-password novalidate>
            <div class="card-header"><h2>${icon('shield')} Password</h2></div>
            <div class="card-body form-grid">
              <label class="field"><span>Current password</span><input name="current" type="password" autocomplete="current-password" required></label>
              <label class="field"><span>New password</span><input name="next" type="password" autocomplete="new-password" minlength="8" required></label>
              <div class="form-error full" data-error hidden></div>
              <div class="form-actions full"><button class="btn" type="submit">Change password</button></div>
            </div>
          </form>
        </div>

        <div class="stack">
          <form class="card" data-assistant novalidate>
            <div class="card-header"><h2>${icon('sparkles')} Your assistant</h2></div>
            <div class="card-body form-grid">
              <label class="field full"><span>Assistant's name</span><input name="assistant_name" required maxlength="24" value="${u.assistant_name}"></label>
              <label class="check full"><input type="checkbox" name="voice_enabled" ${u.voice_enabled ? 'checked' : ''}> Speak replies and reminders out loud</label>
              <div class="full muted small">${state.aiEnabled
                ? html`<span class="pill normal">AI mode</span> Your assistant is powered by Google Gemini and understands natural conversation.`
                : html`<span class="pill neutral">Built-in mode</span> Your assistant understands common requests. Add your key as <code>MEDIZEN_GEMINI_API_KEY</code> in the server's <code>.env</code> file for full natural conversation.`}</div>
              <div class="form-actions full"><button type="button" class="btn ghost" data-test-voice>${icon('volume')} Test voice</button><button class="btn primary" type="submit">${icon('check')} Save</button></div>
            </div>
          </form>

          <div class="card">
            <div class="card-header"><h2>${icon('bell')} Notifications & display</h2></div>
            <div class="card-body form-grid">
              <div class="field full"><span>Desktop alerts</span>
                ${notifPerm === 'granted' ? html`<p class="small"><span class="pill normal">On</span> You'll get alerts even when this tab is in the background.</p>`
                  : notifPerm === 'denied' ? html`<p class="small muted">Blocked in your browser settings. Allow notifications for this site to turn them on.</p>`
                  : notifPerm === 'unsupported' ? html`<p class="small muted">Not supported in this browser.</p>`
                  : html`<button class="btn" type="button" data-enable-notifs>${icon('bell')} Enable desktop alerts</button>`}
              </div>
              <label class="field full"><span>Theme</span>
                <select data-theme>${[['system', 'Match my device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => option(v, theme, l))}</select></label>
              <label class="field full"><span>Timezone</span><input value="${u.timezone}" disabled><span class="hint">Updated automatically each time you sign in.</span></label>
            </div>
          </div>
        </div>
      </div>`;

    const save = async (form, body, message) => {
      await busy(form.querySelector('[type=submit]'), () => api('/api/auth/me', { method: 'PUT', body }));
      await reloadMe();
      toast({ title: message, type: 'success', timeout: 3000 });
    };

    const profile = el.querySelector('[data-profile]');
    profile.onsubmit = (e) => {
      e.preventDefault();
      save(profile, formData(profile), 'Profile saved').catch((err) => toast({ title: err.message, type: 'error' }));
    };

    const asst = el.querySelector('[data-assistant]');
    asst.onsubmit = (e) => {
      e.preventDefault();
      const body = { assistant_name: asst.assistant_name.value, voice_enabled: asst.voice_enabled.checked };
      save(asst, body, 'Assistant settings saved').catch((err) => toast({ title: err.message, type: 'error' }));
    };
    el.querySelector('[data-test-voice]').onclick = () =>
      assistant.speak(`Hi ${u.name.split(' ')[0]}, I'm ${asst.assistant_name.value}. I'll help you stay on top of your health.`, true);

    const pw = el.querySelector('[data-password]');
    pw.onsubmit = async (e) => {
      e.preventDefault();
      const err = pw.querySelector('[data-error]');
      err.hidden = true;
      try {
        await busy(pw.querySelector('[type=submit]'), () => api('/api/auth/password', { method: 'PUT', body: formData(pw) }));
        pw.reset();
        toast({ title: 'Password changed', type: 'success', timeout: 3000 });
      } catch (e2) {
        err.textContent = e2.message;
        err.hidden = false;
      }
    };

    el.querySelector('[data-theme]').onchange = (e) => setTheme(e.target.value);
    el.querySelector('[data-enable-notifs]')?.addEventListener('click', async () => {
      await Notification.requestPermission();
      refresh();
    });
  },
};
