// API client and shared app state.

export const state = {
  user: null,
  profiles: [],
  profileId: 'me',
  meta: null,
  aiEnabled: false,
  unread: 0,
};

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (form) {
    opts.body = form;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event('mz:signed-out'));
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  }
  return data;
}

/** URL prefix for the profile currently being viewed. */
export const p = (path = '') => `/api/p/${state.profileId}${path}`;

export function currentProfile() {
  const id = state.profileId === 'me' ? state.user?.id : Number(state.profileId);
  return state.profiles.find((x) => x.id === id) || state.profiles[0];
}
export const isOwnProfile = () => currentProfile()?.access === 'owner';
export const canEdit = () => ['owner', 'manage'].includes(currentProfile()?.access);

export function setProfile(id) {
  const own = !id || id === 'me' || Number(id) === state.user?.id;
  const valid = own || state.profiles.some((x) => x.id === Number(id));
  state.profileId = own || !valid ? 'me' : String(Number(id));
  try { localStorage.setItem('mz.profile', state.profileId); } catch { /* storage unavailable */ }
}

export function restoreProfile() {
  let saved = 'me';
  try { saved = localStorage.getItem('mz.profile') || 'me'; } catch { /* storage unavailable */ }
  setProfile(saved);
}
