/** @type {WeakMap<Document, Promise<void>>} */
const pending = new WeakMap();

/** Keep theme elements out of the document until their layout rules are ready.
 * @param {Document} page
 * @param {{timeoutMs?: number}} options
 * @returns {Promise<void>} */
export function loadMiruroStyles(page = document, { timeoutMs = 10000 } = {}) {
  const existing = pending.get(page);
  if (existing) return existing;
  const link = page.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/assets/miruro-theme.css?v=3';
  const ready = new Promise((resolve, reject) => {
    /** @param {Error|null} error */
    const finish = error => {
      clearTimeout(timer);
      link.removeEventListener('load', loaded);
      link.removeEventListener('error', failed);
      if (error) { link.remove(); reject(error); }
      else resolve();
    };
    const loaded = () => finish(null);
    const failed = () => finish(new Error('Theme stylesheet could not load'));
    const timer = setTimeout(() => finish(new Error('Theme stylesheet timed out')), timeoutMs);
    link.addEventListener('load', loaded, { once: true });
    link.addEventListener('error', failed, { once: true });
    page.head.append(link);
  });
  pending.set(page, ready);
  ready.catch(() => pending.delete(page));
  return ready;
}
