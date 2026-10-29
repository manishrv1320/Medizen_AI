import { api } from '../api.js';
import { busy, formData, html } from '../ui.js';

export function renderAuth(root, { onSignedIn }) {
  const mode = location.hash.startsWith('#/signup') ? 'signup' : 'login';
  document.title = mode === 'signup' ? 'Create an account · Medizen' : 'Sign in · Medizen';
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  root.innerHTML = html`
    <div class="auth">
      <section class="auth-hero">
        <img class="auth-logo" src="/img/logo.webp" alt="Medizen" width="960" height="640">
        <div class="auth-caption"><span>Checkups, readings and medicines for the whole family.</span><span>© ${new Date().getFullYear()} Medizen</span></div>
      </section>
      <section class="auth-panel">
        <div class="auth-card">
          <div>
            <h1>${mode === 'signup' ? 'Create your account' : 'Sign in'}</h1>
            <p class="lead">${mode === 'signup'
              ? 'You can add your reports, readings and medicines once you\'re in.'
              : 'Good to see you again.'}</p>
          </div>
          <form novalidate>
            ${mode === 'signup' ? html`<label class="field"><span>Your name</span><input name="name" autocomplete="name" required></label>` : ''}
            <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
            <label class="field"><span>Password</span>
              <input name="password" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" required minlength="8">
              ${mode === 'signup' ? html`<span class="hint">At least 8 characters.</span>` : ''}
            </label>
            <div class="form-error" data-error hidden></div>
            <button class="btn primary block" type="submit">${mode === 'signup' ? 'Create account' : 'Sign in'}</button>
          </form>
          <p class="switch">${mode === 'signup'
            ? html`Already have an account? <a href="#/login">Sign in</a>`
            : html`New here? <a href="#/signup">Create an account</a>`}</p>
          ${mode === 'login' ? html`<p class="demo">Want to look around first? <button type="button" data-demo>Open the demo account</button></p>` : ''}
        </div>
      </section>
    </div>`;

  const form = root.querySelector('form');
  const errorEl = root.querySelector('[data-error]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const body = { ...formData(form), timezone };
    try {
      await busy(form.querySelector('button[type=submit]'), () =>
        api(mode === 'signup' ? '/api/auth/signup' : '/api/auth/login', { method: 'POST', body }));
      await onSignedIn();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });
  root.querySelector('[data-demo]')?.addEventListener('click', () => {
    form.email.value = 'demo@medizen.app';
    form.password.value = 'demo1234';
    form.requestSubmit();
  });
}
