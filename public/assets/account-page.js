import { accountRequest } from './accounts.js?v=google-1';
import { googleErrorMessage, mountGoogleButton } from './google-account.js?v=1';

mountNav();
document.getElementById('liveStatus').remove();
const errorBox = document.getElementById('accountError');
async function loadAccount() {
  try {
    const { user } = await accountRequest('me');
    if (!user) { location.replace('/login?next=%2Faccount'); return; }
    document.getElementById('accountName').textContent = user.displayName;
    document.getElementById('accountEmail').textContent = user.email;
    const result = new URLSearchParams(location.search).get('google'), error = googleErrorMessage(result);
    if (error) { errorBox.textContent = error; errorBox.hidden = false; }
    const state = await mountGoogleButton({ linking: true, errorBox });
    if (result === 'linked' && state?.linked) {
      const notice = document.getElementById('accountNotice');
      notice.textContent = 'Akun Google berhasil ditautkan.'; notice.hidden = false;
    }
  } catch { errorBox.textContent = 'Akun belum dapat dimuat. Silakan muat ulang halaman.'; errorBox.hidden = false; }
}
void loadAccount();
