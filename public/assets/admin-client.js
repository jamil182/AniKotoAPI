export function createAdminClient() {
  let token = '';
  return {
    setToken(value) { token = value; },
    async request(path, { method = 'GET', body } = {}) {
      const response = await fetch('/api/admin' + path, {
        method, cache: 'no-store', signal: AbortSignal.timeout(30000),
        headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) {
        const error = new Error(data.message || `Permintaan gagal (${response.status}).`);
        error.status = response.status;
        throw error;
      }
      return data.results;
    },
  };
}
