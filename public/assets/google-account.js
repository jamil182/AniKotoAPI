const messages = Object.freeze({
  cancelled: 'Login Google dibatalkan. Anda dapat mencoba lagi.',
  expired: 'Sesi login Google sudah berakhir atau berasal dari browser lain. Silakan mulai lagi.',
  unavailable: 'Login Google belum diaktifkan oleh pengelola website.',
  existing_account: 'Email ini sudah terdaftar. Login dengan kata sandi, lalu buka halaman Akun untuk menautkan Google.',
  identity_in_use: 'Akun ini sudah memiliki tautan Google lain. Gunakan akun Google yang sebelumnya ditautkan.',
  verification_failed: 'Login Google belum berhasil diverifikasi. Silakan coba lagi.',
  busy: 'Login Google sedang sibuk. Silakan coba beberapa saat lagi.',
  failed: 'Login Google belum berhasil. Silakan coba lagi.',
});
/** @param {unknown} code */
export const googleErrorMessage = code => typeof code === 'string' && Object.hasOwn(messages, code) ? messages[code] : '';

async function request(path, body) {
  const response = await fetch('/api/auth/google/' + path, { method: body ? 'POST' : 'GET',
    credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000),
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success !== true) throw new Error(data?.message || 'Login Google belum dapat dihubungi. Silakan coba lagi.');
  return data.results;
}
/** @returns {Promise<{enabled: boolean, linked: boolean}>} */
export async function googleAccountStatus() {
  const data = await request('status');
  if (typeof data?.enabled !== 'boolean' || typeof data?.linked !== 'boolean') throw new Error('Status akun Google tidak valid.');
  return { enabled: data.enabled, linked: data.linked };
}
export async function linkGoogleAccount() {
  const data = await request('link', {});
  let url;
  try { url = new URL(data?.url); } catch { throw new Error('Alamat login Google tidak valid.'); }
  if (url.origin !== 'https://accounts.google.com' || !/^\/o\/oauth2\/(?:v2\/)?auth$/.test(url.pathname) || url.username || url.password) throw new Error('Alamat login Google tidak valid.');
  return url.href;
}

/** @param {{next?: string, linking?: boolean, errorBox: HTMLElement}} options */
export async function mountGoogleButton({ next = '/home', linking = false, errorBox }) {
  const button = document.getElementById('googleSignIn'), status = document.getElementById('googleStatus');
  try {
    const state = await googleAccountStatus();
    if (linking && state.linked) {
      button.querySelector('span').textContent = 'Google terhubung';
      status.textContent = state.enabled ? 'Anda dapat login menggunakan akun Google yang sudah ditautkan.' : 'Akun Google ditautkan, tetapi login Google saat ini belum diaktifkan.';
      return state;
    }
    if (!state.enabled) { status.textContent = messages.unavailable; return state; }
    status.hidden = true; button.disabled = false;
    button.onclick = async () => {
      button.disabled = true; errorBox.hidden = true;
      try { location.assign(linking ? await linkGoogleAccount() : '/api/auth/google/start?' + new URLSearchParams({ next })); }
      catch (error) { errorBox.textContent = error.message; errorBox.hidden = false; errorBox.focus(); button.disabled = false; }
    };
    return state;
  } catch { status.textContent = 'Login Google belum dapat dimuat. Silakan muat ulang halaman.'; return null; }
}
