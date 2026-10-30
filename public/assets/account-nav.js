import { accountRequest, safeReturnPath } from './accounts.js';

/** @param {HTMLElement} host */
export async function mountAccountNav(host) {
  const anonymous = () => {
    const next = safeReturnPath(location.pathname + location.search);
    host.replaceChildren(...['Login', 'Register'].map((label, index) => {
      const link = document.createElement('a');
      link.className = 'nav-btn' + (index ? ' solid' : '');
      link.href = '/' + label.toLowerCase() + '?next=' + encodeURIComponent(next);
      link.textContent = label;
      return link;
    }));
  };
  let user;
  try { ({ user } = await accountRequest('me')); }
  catch { return; }
  if (!user) { anonymous(); return; }
  const name = document.createElement('a');
  name.href = '/account';
  name.className = 'nav-account-name';
  name.textContent = user.displayName;
  name.title = 'Pengaturan akun';
  const logout = document.createElement('button');
  logout.className = 'nav-btn solid';
  logout.type = 'button';
  logout.textContent = 'Logout';
  const status = document.createElement('span');
  status.className = 'nav-account-status';
  status.setAttribute('role', 'status');
  logout.onclick = async () => {
    logout.disabled = true;
    status.textContent = '';
    try { await accountRequest('logout'); anonymous(); }
    catch (error) { status.textContent = error.message; logout.disabled = false; }
  };
  host.replaceChildren(name, logout, status);
}
