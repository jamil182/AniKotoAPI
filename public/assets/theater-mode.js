const storageKey = 'aniyear:theater:v1';

/** Resize the existing player with CSS so neither video nor iframe is reloaded.
 * @param {HTMLElement} root
 * @param {HTMLButtonElement} button
 * @param {{storage?: Pick<Storage, 'getItem' | 'setItem'> | null}} options
 * @returns {import('./theater-mode.types.js').TheaterMode}
 */
export function mountTheaterMode(root, button, { storage } = {}) {
  const document = root.ownerDocument;
  const label = button.querySelector('[data-theater-label]');
  let expanded = false;
  try {
    if (storage === undefined) storage = globalThis.localStorage;
    expanded = storage?.getItem(storageKey) === '1';
  } catch { /* Layout controls also work when browser storage is unavailable. */ }

  /** @param {boolean} value @param {boolean} persist */
  function apply(value, persist) {
    expanded = value;
    root.classList.toggle('is-expanded', expanded);
    button.classList.toggle('on', expanded);
    button.setAttribute('aria-pressed', String(expanded));
    button.setAttribute('title', expanded ? 'Collapse player' : 'Expand player');
    if (label) label.textContent = expanded ? 'Collapse' : 'Expand';
    if (persist) {
      try { storage?.setItem(storageKey, expanded ? '1' : '0'); }
      catch { /* Keep the current layout even when a preference cannot be saved. */ }
    }
  }
  function toggle() {
    apply(!expanded, true);
    root.querySelector('.watch-player-column')?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  /** @param {KeyboardEvent} event */
  function escape(event) {
    if (event.key !== 'Escape' || event.defaultPrevented || document.fullscreenElement || !expanded) return;
    const target = event.target;
    if (target && 'closest' in target && typeof target.closest === 'function' &&
      target.closest('input,textarea,select,[contenteditable], [role="dialog"],.v-menu.open')) return;
    apply(false, true);
  }
  apply(expanded, false);
  button.addEventListener('click', toggle);
  document.addEventListener('keydown', escape);
  return {
    setExpanded(value) { apply(value === true, true); },
    destroy() { button.removeEventListener('click', toggle); document.removeEventListener('keydown', escape); },
  };
}
