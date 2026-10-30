const notice = document.getElementById('bookmarkNotice');
const close = notice?.querySelector('[data-dismiss]');
const storageKey = 'aniyear:bookmark-notice:v1';

if (notice instanceof HTMLElement && close instanceof HTMLButtonElement) {
  try { notice.hidden = sessionStorage.getItem(storageKey) === 'dismissed'; }
  catch { /* The reminder remains usable when browser storage is unavailable. */ }

  close.addEventListener('click', () => {
    notice.hidden = true;
    document.getElementById('latestViewMore')?.focus({ preventScroll: true });
    try { sessionStorage.setItem(storageKey, 'dismissed'); }
    catch { /* Closing still works for this page when storage is unavailable. */ }
  });
}
