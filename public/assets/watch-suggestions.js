/** @param {unknown} value @param {string} current
 * @returns {import('./watch-suggestions.types.js').WatchSuggestion[]} */
function rows(value, current) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || typeof item.slug !== 'string' || typeof item.title !== 'string' || !item.title.trim()) return [];
    const slug = item.slug.split('/')[0];
    if (!/^[a-z0-9][a-z0-9_-]{0,239}$/i.test(slug) || slug === current || seen.has(slug) || seen.size >= 40) return [];
    seen.add(slug);
    let poster = '/favicon.svg';
    try { const url = new URL(item.poster); if (url.protocol === 'https:' && !url.username && !url.password) poster = url.href; } catch { /* Keep the local image fallback. */ }
    return [{slug, title: item.title.trim().slice(0, 300), poster,
      type: typeof item.type === 'string' ? item.type.slice(0, 60) : '', relation: typeof item.relation === 'string' ? item.relation.slice(0, 80) : ''}];
  });
}

/** @param {unknown} value @param {string} current
 * @returns {import('./watch-suggestions.types.js').WatchSuggestionGroups} */
export function watchSuggestionGroups(value, current) {
  const data = value && typeof value === 'object' ? /** @type {Record<string,unknown>} */(value) : {};
  return {related: rows(data.related, current), recommended: rows(data.recommended, current)};
}

/** @param {HTMLElement} root @param {string} current
 * @returns {import('./watch-suggestions.types.js').WatchSuggestions} */
export function createWatchSuggestions(root, current) {
  root.innerHTML = '<div class="watch-suggestion-tabs" role="tablist" aria-label="Anime suggestions"><button type="button" role="tab" id="relatedTab" aria-controls="relatedPanel" aria-selected="true">Related</button><button type="button" role="tab" id="recommendedTab" aria-controls="recommendedPanel" aria-selected="false" tabindex="-1">Recommended</button></div><div class="watch-suggestion-list" role="tabpanel" id="relatedPanel" aria-labelledby="relatedTab"></div><div class="watch-suggestion-list" role="tabpanel" id="recommendedPanel" aria-labelledby="recommendedTab" hidden></div><p class="watch-suggestion-notice" role="status">Loading…</p>';
  const tabs = [...root.querySelectorAll('[role=tab]')], panels = [...root.querySelectorAll('[role=tabpanel]')];
  const notice = root.querySelector('[role=status]');
  let selected = 0, fingerprint = '';
  function select(index, focus = false) {
    selected = index;
    tabs.forEach((tab, number) => { tab.setAttribute('aria-selected', String(number === index)); tab.tabIndex = number === index ? 0 : -1; panels[number].hidden = number !== index; });
    if (focus) tabs[index].focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(index));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault(); select(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - selected, true);
    });
  });
  return {
    update(value) {
      const groups = watchSuggestionGroups(value, current), key = JSON.stringify(groups);
      notice.hidden = true; root.setAttribute('aria-busy', 'false');
      if (key === fingerprint) return;
      const first = !fingerprint; fingerprint = key;
      ['related','recommended'].forEach((kind, index) => {
        const panel = panels[index]; panel.replaceChildren();
        if (!groups[kind].length) { const empty = document.createElement('p'); empty.className = 'watch-suggestion-empty'; empty.textContent = kind === 'related' ? 'No related titles available.' : 'No recommendations available.'; panel.append(empty); return; }
        for (const item of groups[kind]) {
          const anchor = document.createElement('a'); anchor.className = 'related-row'; anchor.href = '/anime/' + encodeURIComponent(item.slug);
          const image = document.createElement('img'); image.src = item.poster; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
          image.onerror = () => { image.onerror = null; image.src = '/favicon.svg'; };
          const copy = document.createElement('div'), title = document.createElement('div'), detail = document.createElement('div');
          title.className = 't'; title.textContent = item.title; detail.className = 'm'; detail.textContent = [item.type, item.relation].filter(Boolean).join(' · ');
          copy.append(title, detail); anchor.append(image, copy); panel.append(anchor);
        }
      });
      select(first && !groups.related.length && groups.recommended.length ? 1 : selected);
    },
    error() { root.setAttribute('aria-busy', 'false'); notice.hidden = false; notice.textContent = fingerprint ? 'Suggestions could not be refreshed.' : 'Suggestions are temporarily unavailable.'; }
  };
}
