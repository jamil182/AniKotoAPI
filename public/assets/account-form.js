import { accountRequest, safeReturnPath } from './accounts.js';

mountNav();
document.getElementById('liveStatus').remove();
const form = document.getElementById('accountForm');
const errorBox = document.getElementById('accountError');
const button = form.querySelector('button[type="submit"]');
const registration = form.dataset.action === 'register';
const next = safeReturnPath(new URLSearchParams(location.search).get('next'));
const alternate = document.getElementById('accountAlternate');
alternate.href = (registration ? '/login' : '/register') + '?next=' + encodeURIComponent(next);

accountRequest('me').then(({ user }) => { if (user) location.replace(next); }).catch(() => {});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (button.disabled) return;
  errorBox.hidden = true;
  const values = new FormData(form);
  const password = String(values.get('password') || '');
  if (registration && password !== values.get('confirmPassword')) {
    errorBox.textContent = 'Konfirmasi kata sandi tidak sama.';
    errorBox.hidden = false;
    form.elements.namedItem('confirmPassword').focus();
    return;
  }
  const body = { email: String(values.get('email') || ''), password };
  if (registration) body.displayName = String(values.get('displayName') || '');
  const controls = [...form.querySelectorAll('input, button')];
  controls.forEach(control => { control.disabled = true; });
  button.textContent = registration ? 'Membuat akun…' : 'Memproses…';
  try {
    await accountRequest(registration ? 'register' : 'login', body);
    form.reset();
    location.assign(next);
  } catch (error) {
    errorBox.textContent = error.name === 'TimeoutError' ? 'Permintaan terlalu lama. Silakan coba lagi.' : error.message;
    errorBox.hidden = false;
    errorBox.focus();
  } finally {
    controls.forEach(control => { control.disabled = false; });
    button.textContent = registration ? 'Register' : 'Login';
  }
});
