import { api } from '../api.js';
import { html, icon, timeAgo, toastError } from '../ui.js';
import { updateUnread } from '../app.js';

const TYPE_ICON = { urgent: 'alert', warning: 'alert', reminder: 'alarm', family: 'users', assistant: 'sparkles', info: 'bell' };
const TYPE_CLASS = { urgent: 'overdue', warning: 'overdue', reminder: 'medication', family: 'appointment', assistant: 'checkup', info: '' };

export default {
  title: 'Notifications',
  async render(el) {
    const { items } = await api('/api/notifications?limit=100');
    el.innerHTML = html`
      <div class="page-header">
        <div><h1>Notifications</h1><p>Reminders, alerts and updates from your assistant and family.</p></div>
        ${'Notification' in window && Notification.permission === 'default'
          ? html`<div class="actions"><button class="btn" data-enable>${icon('bell')} Enable desktop alerts</button></div>` : ''}
      </div>
      <div class="card"><div class="card-body">
        ${items.length ? html`<div class="list">${items.map((n) => html`
          <div class="list-item" data-id="${n.id}" style="${n.read ? '' : 'font-weight:600'}">
            <div class="ic ${TYPE_CLASS[n.type] || ''}">${icon(TYPE_ICON[n.type] || 'bell')}</div>
            <div class="grow">
              <div class="title" style="white-space:normal">${n.title}</div>
              ${n.body ? html`<div class="sub" style="font-weight:400">${n.body}</div>` : ''}
              <div class="sub" style="font-weight:400">${timeAgo(n.created_at)}</div>
            </div>
            ${n.link ? html`<a class="btn sm" href="${n.link}">View</a>` : ''}
            <button class="icon-btn sm" data-del aria-label="Delete notification">${icon('x')}</button>
          </div>`)}</div>`
        : html`<div class="empty"><div class="ic">${icon('bell')}</div><h3>You're all caught up</h3><p>New reminders and alerts will show up here.</p></div>`}
      </div></div>`;

    if (items.some((n) => !n.read)) {
      api('/api/notifications/read', { method: 'POST', body: {} }).then(() => updateUnread(0)).catch(() => {});
    }
    el.querySelector('[data-enable]')?.addEventListener('click', async (e) => {
      await Notification.requestPermission();
      e.target.closest('button').remove();
    });
    el.addEventListener('click', async (e) => {
      const del = e.target.closest('[data-del]');
      if (!del) return;
      const row = del.closest('[data-id]');
      try {
        await api(`/api/notifications/${row.dataset.id}`, { method: 'DELETE' });
        row.remove();
      } catch (err) { toastError(err); }
    });
  },
};
