let csrf = '';
export const setCsrf = (token) => { csrf = token || ''; };

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || 'Something went wrong. Check your connection and try again.');
    this.status = status;
    this.field = data?.field;
    this.data = data || {};
  }
}

/** Talk to the server. Throws ApiError with a message that is safe to show. */
export async function api(path, { method = 'GET', body, file } = {}) {
  const headers = {};
  let payload;
  if (file) { payload = file; headers['Content-Type'] = file.type || 'application/octet-stream'; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf;

  let res;
  try { res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' }); }
  catch { throw new ApiError(0, { error: 'You appear to be offline. Check your connection and try again.' }); }

  let data = null;
  try { data = await res.json(); } catch { /* empty or non-JSON reply */ }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/') && path !== '/api/session') {
      window.dispatchEvent(new Event('anonymous:signed-out'));
    }
    throw new ApiError(res.status, data);
  }
  if (data?.csrf) setCsrf(data.csrf);
  return data;
}

export const get = (path) => api(path);
export const post = (path, body = {}) => api(path, { method: 'POST', body });
export const put = (path, body = {}) => api(path, { method: 'PUT', body });
export const patch = (path, body = {}) => api(path, { method: 'PATCH', body });
export const del = (path) => api(path, { method: 'DELETE' });
