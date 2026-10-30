import { mountAnimeDescription } from './anime-description.js';
import { mountComments } from './comments.js?v=2';

mountNav();
const id = decodeURIComponent(location.pathname.replace(/^\/anime\//, '').replace(/\/$/, ''));
const page = document.getElementById('page');
let stopLive = null, loaded = false, fingerprint = '';
let discussion = null;

function renderDetail(info, eps) {
  const episodes = eps.episodes || [];
  const total = eps.totalEpisodes || episodes.length;
  if (!document.getElementById('animeDescription')) page.innerHTML = '<section class="wrap anime-details-panel"><div id="animeDescription"></div></section><section class="wrap eps" id="episodeSection"></section>';
  document.getElementById('episodeSection').innerHTML = `<div class="section-head"><h2 class="section-title">Episodes${total ? ` (${total})` : ''}</h2></div>
    ${episodes.length ? `<div class="eps-grid">${episodes.map(episode => `<a class="ep" href="/watch/${encodeURIComponent(id)}/${encodeURIComponent(episode.episode_no)}" title="Episode ${esc(episode.episode_no)}${episode.title ? ' — ' + esc(episode.title) : ''}" style="text-decoration:none">${esc(episode.episode_no)}</a>`).join('')}</div>` : '<div class="state">No episodes listed.</div>'}`;
  mountAnimeDescription(document.getElementById('animeDescription'), { ...info, total }, { heading: 'h1' });
  document.title = `${info.title} — AniJs`;
  if (!discussion) discussion = mountComments(document.getElementById('comments'), { slug: info.slug, episodes });
  else discussion.updateEpisodes(episodes);
}

function boot() {
  if (!id) { page.innerHTML = '<div class="wrap state">No anime specified.</div>'; return; }
  stopLive?.();
  stopLive = startLiveRefresh(async signal => {
    const [info, eps] = await Promise.all([
      apiGet('/catalog/anime/' + encodeURIComponent(id), { signal }),
      apiGet('/catalog/episodes/' + encodeURIComponent(id), { signal }),
    ]);
    return { info, eps };
  }, {
    onData: ({ info, eps }) => {
      const next = JSON.stringify({ info, eps });
      if (next !== fingerprint) renderDetail(info, eps);
      fingerprint = next;
      loaded = true;
    },
    onError: error => {
      if (loaded) return;
      page.innerHTML = `<div class="wrap state">Couldn't load this anime (${esc(error.message)}).<br><button>Retry</button></div>`;
      page.querySelector('button').onclick = boot;
    },
  });
}
boot();
