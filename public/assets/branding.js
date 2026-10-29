/** @typedef {{logo: string, favicon: string}} Branding */

/** @param {unknown} value @returns {Branding | null} */
export function brandingUrls(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = /** @type {Record<string, unknown>} */ (value);
  if (typeof fields.logo !== 'string' || !/^\/logo\.png\?v=[a-f0-9]{24}$/.test(fields.logo)) return null;
  if (typeof fields.favicon !== 'string' || !/^\/favicon\.png\?v=[a-f0-9]{24}$/.test(fields.favicon)) return null;
  return { logo: fields.logo, favicon: fields.favicon };
}

/** @param {Pick<Document, 'querySelectorAll'>} page @param {unknown} value */
export function applyBranding(page, value) {
  const branding = brandingUrls(value);
  if (!branding) return false;
  for (const [selector, attribute, url] of [
    ['.logo img, .landing-logo img', 'src', branding.logo],
    ['link[rel~="icon"], link[rel="apple-touch-icon"]', 'href', branding.favicon],
  ]) {
    for (const element of page.querySelectorAll(selector)) {
      if (element.getAttribute(attribute) !== url) element.setAttribute(attribute, url);
    }
  }
  return true;
}

if (typeof document !== 'undefined') {
  /** @type {Promise<void> | null} */
  let pending = null;
  const refresh = () => {
    if (pending || document.hidden) return;
    pending = (async () => {
      try {
        const response = await fetch('/api/branding', { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(8000) });
        if (!response.ok) return;
        const data = await response.json();
        if (data?.success === true) applyBranding(document, data.results);
      } catch { /* Keep the current images if the branding endpoint is unavailable. */ }
    })().finally(() => { pending = null; });
  };
  // Shared navigation is mounted by the page's other modules before this event.
  if (document.readyState === 'complete') refresh();
  else document.addEventListener('DOMContentLoaded', refresh, { once: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
}
