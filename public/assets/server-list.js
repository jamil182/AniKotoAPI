const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const playIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="m6 4.5 5 3.5-5 3.5Z" fill="var(--server-button-background)"/></svg>';

/** @param {{name: string, language: 'sub' | 'dub'}[]} sources @returns {string} */
export function serverRowsHTML(sources) {
  return ['sub', 'dub'].map(language => {
    const items = sources.map((source, index) => ({ ...source, index })).filter(source => source.language === language);
    const icon = language === 'sub'
      ? '<svg viewBox="0 0 20 16" aria-hidden="true"><rect x="1" y="1" width="18" height="14" rx="2" fill="currentColor"/><text x="10" y="11" text-anchor="middle" font-size="9" font-weight="700" fill="#0a121b">CC</text></svg>'
      : '<svg viewBox="0 0 16 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="1" width="6" height="11" rx="3"/><path d="M2 8v2a6 6 0 0 0 12 0V8M8 16v3M4 19h8"/></svg>';
    return `<div class="servers-group servers-language-row" data-language="${language}">
      <h4 class="server-language">${icon}<span>${language.toUpperCase()}</span></h4>
      <div class="server-btns">${items.length ? items.map(source => `<button type="button" class="server-btn" data-i="${source.index}" aria-pressed="false">${playIcon}${escapeHTML(source.name || 'Video server')}</button>`).join('') : `<span class="servers-empty">No ${language.toUpperCase()} server available</span>`}</div>
    </div>`;
  }).join('');
}
