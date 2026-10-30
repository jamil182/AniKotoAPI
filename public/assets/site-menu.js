export const navigationItems = Object.freeze([
  { label: 'HOME', href: '/home' },
  { label: 'WEEKLY SCHEDULE', href: '/schedule' },
  { label: 'GENRE', href: '/home#genresSection' },
  { label: 'UPDATED', href: '/browse?source=latest' },
  { label: 'ADDED', href: '/browse?source=added' },
  { label: 'POPULAR', href: '/browse?source=popular' },
  { label: 'UPCOMING', href: '/browse?source=upcoming' },
  { label: 'ONGOING', href: '/browse?source=ongoing' },
  { label: 'COMPLETED', href: '/browse?source=completed' },
]);

/** @param {HTMLElement} header */
export function mountSiteMenu(header) {
  const button = header.querySelector('#navMenuToggle');
  const panel = document.createElement('nav');
  panel.id = 'siteMenu';
  panel.className = 'site-menu';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Site navigation');
  const link = item => `<a href="${item.href}">${item.label}</a>`;
  panel.innerHTML = navigationItems.map(item => link(item) + (item.label === 'GENRE'
    ? `<details class="site-menu-types"><summary>TYPES</summary><div>${['tv', 'movie', 'ova', 'ona', 'special'].map(type => `<a href="/browse?type=${type}">${type === 'movie' ? 'Movie' : type === 'special' ? 'Special' : type.toUpperCase()}</a>`).join('')}</div></details>` : '')).join('');
  header.append(panel);
  const setOpen = open => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };
  button.onclick = () => { const open = panel.hidden; setOpen(open); if (open) panel.querySelector('a').focus(); };
  button.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); panel.querySelector('a').focus(); }
  });
  panel.addEventListener('keydown', event => event.stopPropagation());
  const escape = event => {
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); event.stopPropagation(); setOpen(false); button.focus(); }
  };
  header.addEventListener('keydown', escape, true);
  document.addEventListener('keydown', escape);
  document.addEventListener('pointerdown', event => {
    if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) setOpen(false);
  });
  panel.addEventListener('click', event => { if (event.target.closest('a')) setOpen(false); });
  document.addEventListener('focusin', event => {
    if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) setOpen(false);
  });
}
