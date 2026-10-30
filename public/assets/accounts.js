/** Return only a local path; reject protocol-relative URLs and backslash redirects. */
export function safeReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x20\x7f]/.test(value)) return '/home';
  try {
    const url = new URL(value, 'https://anijs.invalid');
    if (url.origin !== 'https://anijs.invalid' || /^\/(?:login|register|api\/auth)(?:\/|$)/.test(url.pathname)) return '/home';
    return url.pathname + url.search + url.hash;
  } catch { return '/home'; }
}

/**
 * @param {'me' | 'login' | 'register' | 'logout'} action
 * @param {{email?: string, password?: string, displayName?: string}} [body]
 * @returns {Promise<import('./accounts.types.js').AccountResponse>}
 */
export async function accountRequest(action, body) {
  const response = await fetch('/api/auth/' + action, {
    method: action === 'me' ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    signal: AbortSignal.timeout(20000),
    ...(action === 'me' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success !== true) throw new Error(data?.message || 'Layanan akun tidak dapat dihubungi. Coba lagi.');
  return data.results;
}
