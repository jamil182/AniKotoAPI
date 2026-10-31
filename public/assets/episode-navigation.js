/** @param {unknown} value @returns {number | null} */
export function episodeNumber(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d{1,6}(?:\.\d{1,3})?$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100000 ? number : null;
}

/** @param {import('./episode-navigation.types.js').EpisodeSummary[]} episodes */
export function navigationEpisodes(episodes) {
  const seen = new Set();
  return episodes.filter(item => {
    const number = episodeNumber(item?.episode_no);
    if (number === null || seen.has(number)) return false;
    seen.add(number); return true;
  }).sort((left, right) => Number(left.episode_no) - Number(right.episode_no));
}

/** @param {import('./episode-navigation.types.js').EpisodeSummary[]} episodes
 * @returns {import('./episode-navigation.types.js').EpisodeRange[]} */
export function episodeRanges(episodes) {
  const ranges = [];
  for (let start = 0; start < episodes.length; start += 100) {
    const end = Math.min(start + 100, episodes.length);
    ranges.push({ start, end, label: `${episodes[start].episode_no}-${episodes[end - 1].episode_no}` });
  }
  return ranges;
}

/** @param {HTMLElement} root
 * @param {{href: (episode: number | string) => string, title: (value: string) => string}} options
 * @returns {import('./episode-navigation.types.js').EpisodeNavigation} */
export function createEpisodeNavigation(root, { href, title }) {
  const range = /** @type {HTMLSelectElement} */ (root.querySelector('[data-episode-range]'));
  const input = /** @type {HTMLInputElement} */ (root.querySelector('[data-episode-find]'));
  const grid = /** @type {HTMLElement} */ (root.querySelector('[data-episode-grid]'));
  const status = /** @type {HTMLElement} */ (root.querySelector('[data-episode-status]'));
  /** @type {import('./episode-navigation.types.js').EpisodeSummary[]} */ let rows = [];
  /** @type {import('./episode-navigation.types.js').EpisodeRange[]} */ let ranges = [];
  /** @type {number | null} */ let current = null;
  let selected = 0;

  /** @param {HTMLAnchorElement | null} anchor */
  function reveal(anchor) {
    if (!anchor) return;
    grid.scrollTop += anchor.getBoundingClientRect().top - grid.getBoundingClientRect().top - (grid.clientHeight - anchor.offsetHeight) / 2;
  }
  function draw() {
    const part = ranges[selected];
    grid.replaceChildren();
    if (!part) { status.textContent = 'No episodes listed.'; status.hidden = false; return; }
    for (const item of rows.slice(part.start, part.end)) {
      const anchor = document.createElement('a');
      anchor.className = 'ep-item'; anchor.href = href(item.episode_no);
      anchor.textContent = String(item.episode_no); anchor.dataset.episode = String(Number(item.episode_no));
      anchor.title = `Episode ${item.episode_no}${item.title ? ` — ${title(item.title)}` : ''}`;
      anchor.setAttribute('aria-label', anchor.title);
      if (Number(item.episode_no) === current) { anchor.classList.add('on'); anchor.setAttribute('aria-current', 'page'); }
      grid.append(anchor);
    }
    grid.scrollTop = 0;
  }
  /** @param {boolean} [focus] */
  function find(focus = false) {
    const query = input.value.trim(), number = episodeNumber(query);
    for (const anchor of grid.querySelectorAll('.is-match')) anchor.classList.remove('is-match');
    const index = query && number !== null ? rows.findIndex(item => Number(item.episode_no) === number) : -1;
    const missing = Boolean(query && index < 0);
    input.setAttribute('aria-invalid', String(missing)); status.hidden = !missing;
    status.textContent = missing ? 'Episode not found.' : '';
    if (index < 0) return;
    const targetRange = Math.floor(index / 100);
    if (targetRange !== selected) { selected = targetRange; range.value = String(selected); draw(); }
    const anchor = /** @type {HTMLAnchorElement | null} */ (grid.querySelector(`[data-episode="${number}"]`));
    anchor?.classList.add('is-match'); reveal(anchor);
    if (focus) anchor?.focus({ preventScroll: true });
  }
  range.onchange = () => {
    const next = Number(range.value);
    if (!Number.isInteger(next) || !ranges[next]) return;
    selected = next; input.value = ''; input.setAttribute('aria-invalid', 'false'); status.hidden = true; draw();
  };
  input.oninput = () => find();
  input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); find(true); } };
  return {
    update(episodes, currentEpisode) {
      const previousStart = rows[ranges[selected]?.start]?.episode_no;
      const watched = episodeNumber(currentEpisode), changed = current !== watched;
      const previousScroll = grid.scrollTop;
      rows = navigationEpisodes(episodes); ranges = episodeRanges(rows); current = watched;
      const index = !changed && previousStart !== undefined ? rows.findIndex(item => Number(item.episode_no) === Number(previousStart)) : rows.findIndex(item => Number(item.episode_no) === current);
      selected = Math.max(0, Math.floor(index / 100));
      range.replaceChildren(...ranges.map((item, index) => new Option(item.label, String(index))));
      range.value = String(selected); range.disabled = !rows.length; input.disabled = !rows.length;
      status.hidden = Boolean(rows.length); draw();
      if (input.value.trim()) find();
      else if (changed) reveal(grid.querySelector('[aria-current=page]'));
      else grid.scrollTop = previousScroll;
    },
    destroy() { range.onchange = null; input.oninput = null; input.onkeydown = null; }
  };
}
