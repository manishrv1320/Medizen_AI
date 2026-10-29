import { all, one, run } from './db.js';

// userId -> Set of open Server-Sent Events responses
const streams = new Map();

export function openStream(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');

  const userId = req.user.id;
  if (!streams.has(userId)) streams.set(userId, new Set());
  streams.get(userId).add(res);

  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    streams.get(userId)?.delete(res);
  });
}

export function push(userId, event, data) {
  for (const res of streams.get(userId) || []) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

/** Tell the owner and everyone viewing their profile that some of its data changed, so open pages refresh. */
export function broadcastChange(ownerId, kind) {
  const viewers = all('SELECT member_user_id FROM family_shares WHERE owner_id = ? AND member_user_id IS NOT NULL', ownerId);
  for (const id of [ownerId, ...viewers.map((v) => v.member_user_id)]) push(id, 'data-changed', { profileId: ownerId, kind });
}

/** Store a notification and deliver it live to any open tabs of that user. */
export function notify(userId, { title, body = null, type = 'info', link = null }) {
  const { lastInsertRowid } = run(
    'INSERT INTO notifications (user_id, title, body, type, link) VALUES (?, ?, ?, ?, ?)',
    userId, title, body, type, link,
  );
  const notification = one('SELECT * FROM notifications WHERE id = ?', lastInsertRowid);
  push(userId, 'notification', notification);
  return notification;
}

/** Notify every family member who has access to ownerId's profile and opted in to alerts. */
export function notifyFamily(ownerId, payload) {
  const watchers = all(
    'SELECT member_user_id FROM family_shares WHERE owner_id = ? AND member_user_id IS NOT NULL AND notify = 1',
    ownerId,
  );
  for (const { member_user_id } of watchers) {
    notify(member_user_id, { ...payload, link: `${payload.link || '#/dashboard'}?profile=${ownerId}` });
  }
  return watchers.length;
}
