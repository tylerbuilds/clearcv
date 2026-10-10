/** Browser client for the optional same-origin workspace service. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MAX_RESPONSE_BYTES = 42 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const invalidResponse = status => new CloudError(status, { error: { code: 'invalid_response', message: 'The sharing server returned an invalid response. Try again or check the server.' } });
function cancelReader(reader, reason) {
  // Do not let a faulty response source's cleanup delay the caller's result.
  try { Promise.resolve(reader.cancel(reason)).catch(() => {}); } catch { /* Preserve the response error. */ }
}

export class CloudError extends Error {
  constructor(status, payload) {
    const message = payload?.error?.message;
    super(typeof message === 'string' && message.length <= 500 ? message : 'We couldn’t connect to the shared CV. Check your connection and try again.');
    const code = payload?.error?.code;
    this.name = 'CloudError'; this.status = status; this.code = typeof code === 'string' && code.length <= 80 ? code : 'request_failed';
    this.revision = payload?.revision; this.current = payload?.workspace;
  }
}

async function readPayload(response, signal) {
  const reader = response.body?.getReader(); if (!reader) throw invalidResponse(response.status);
  const decoder = new TextDecoder('utf-8', { fatal: true }); let size = 0, text = '', rejectAbort;
  const aborted = new Promise((_resolve, reject) => { rejectAbort = reject; });
  const abort = () => { rejectAbort(signal.reason); cancelReader(reader, signal.reason); };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (signal.aborted) throw signal.reason; if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new CloudError(response.status, { error: { code: 'response_too_large', message: 'The shared CV response is too large. Check the sharing server before trying again.' } });
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode(); return JSON.parse(text);
  } catch (error) {
    cancelReader(reader, error);
    throw error;
  } finally { signal.removeEventListener('abort', abort); try { reader.releaseLock(); } catch { /* Cleanup cannot replace the original result. */ } }
}

function connection(id, token) {
  if (typeof id !== 'string' || typeof token !== 'string' || !ID.test(id) || !TOKEN.test(token)) throw new TypeError('The share link is incomplete or invalid. Paste the full link.');
}

export function shareLink({ id, token, baseURL = globalThis.location?.href }) {
  connection(id, token);
  const url = new URL(baseURL);
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('Share links need an HTTP(S) application URL.');
  url.hash = new URLSearchParams({ workspace: id, token }).toString();
  return url.href;
}

export function readShareLink(url = globalThis.location?.href) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    const params = new URLSearchParams(parsed.hash.slice(1));
    if (params.getAll('workspace').length !== 1 || params.getAll('token').length !== 1) return null;
    const id = params.get('workspace'); const token = params.get('token');
    connection(id, token);
    return { id, token };
  } catch { return null; }
}

export function createCloudClient({ baseURL = '/api/workspaces', fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('Fetch is required.');
  if (typeof baseURL !== 'string' || !baseURL.startsWith('/') || baseURL.startsWith('//') || /[\u0000-\u0020\u007f?#\\]/.test(baseURL)) throw new TypeError('The workspace API must use a same-origin absolute path.');
  const normalized = new URL(baseURL, 'http://workspace-client.invalid');
  if (normalized.origin !== 'http://workspace-client.invalid' || normalized.pathname !== baseURL) throw new TypeError('The workspace API must use a same-origin absolute path.');
  const base = baseURL.replace(/\/$/, '');
  const request = async (route, { method = 'GET', token, body, signal } = {}) => {
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const headers = { Accept: 'application/json' };
    if (token) headers['X-Workspace-Token'] = token;
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; headers['X-Workspace-Client'] = '1'; }
    let response, payload;
    try {
      response = await fetchImpl(`${base}${route}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: requestSignal });
      payload = await readPayload(response, requestSignal);
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (requestSignal.aborted) throw new CloudError(408, { error: { code: 'request_timeout', message: 'The sharing server took too long to respond. Your local CV hasn’t changed. Try again.' } });
      if (error instanceof CloudError) throw error;
      throw invalidResponse(response?.status || 0);
    }
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw invalidResponse(response.status);
    if (!response.ok) throw new CloudError(response.status, payload);
    return payload;
  };
  const scoped = (args, route, method, body) => { connection(args.id, args.token); return request(`/${args.id}${route}`, { token: args.token, method, body, signal: args.signal }); };
  const client = {
    status: ({ signal } = {}) => request('/status', { signal }),
    create: ({ kind, title, document, signal }) => request('', { method: 'POST', body: { kind, title, document }, signal }),
    open: args => scoped(args, '', 'GET'),
    update: args => scoped(args, '', 'PUT', { baseRevision: args.baseRevision, document: args.document, ...(args.title === undefined ? {} : { title: args.title }) }),
    comments: args => scoped(args, '/comments', 'GET'),
    addComment: args => scoped(args, '/comments', 'POST', { baseRevision: args.baseRevision, text: args.text, author: args.author }),
    revisions: args => scoped(args, '/revisions', 'GET'),
    setPermission: args => scoped(args, '/permissions', 'POST', { baseRevision: args.baseRevision, role: args.role, enabled: args.enabled }),
    watch({ id, token, revision, onChange, onError = () => {}, intervalMs = 1500, signal }) {
      connection(id, token);
      if (typeof onChange !== 'function' || typeof onError !== 'function') throw new TypeError('Watch callbacks must be functions.');
      const controller = new AbortController(); let timer; let stopped = false; let current = revision;
      const stop = () => { if (stopped) return; stopped = true; clearTimeout(timer); controller.abort(); signal?.removeEventListener('abort', stop); };
      const poll = async () => {
        try {
          const result = await client.open({ id, token, signal: controller.signal });
          if (!stopped && result.workspace.revision !== current) { current = result.workspace.revision; await onChange(result); }
        } catch (error) {
          if (!stopped) {
            try { await onError(error); } catch { /* Caller errors cannot strand the poller. */ }
            if (error instanceof CloudError && [403, 404, 503].includes(error.status)) stop();
          }
        } finally { if (!stopped) timer = setTimeout(poll, Math.min(60_000, Math.max(250, Number(intervalMs) || 1500))); }
      };
      if (signal?.aborted) stop();
      else { signal?.addEventListener('abort', stop, { once: true }); void poll(); }
      return stop;
    }
  };
  return client;
}
