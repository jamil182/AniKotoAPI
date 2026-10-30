export class CommentRequestError extends Error {
  constructor(message, status, retryAfter = 0) { super(message); this.name = 'CommentRequestError'; this.status = status; this.retryAfter = retryAfter; }
}
/** @template T @param {string} path @param {{method?: string, body?: object, signal?: AbortSignal}} [options] @returns {Promise<T>} */
export async function commentRequest(path = '', { method = 'GET', body, signal } = {}) {
  const response = await fetch('/api/comments' + path, { method, credentials: 'same-origin', cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success !== true) throw new CommentRequestError(typeof data?.message === 'string' ? data.message : 'Komentar belum dapat dimuat. Silakan coba lagi.', response.status, Number(response.headers.get('retry-after')) || 0);
  return data.results;
}
