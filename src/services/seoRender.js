import { animeDescriptionHTML } from '../../public/assets/anime-description.js';
import { load } from 'cheerio';

/** @param {unknown} value */
export const seoEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
/** @param {unknown} value @param {number} [limit] */
export function seoText(value, limit = 165) {
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}
/** @param {unknown} value */
export function seoImage(value) {
  try { const url = new URL(String(value)); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
/** @param {Record<string, unknown>[]} value */
const jsonLd = value => JSON.stringify({ '@context':'https://schema.org', '@graph':value }).replace(/[<>&\u2028\u2029]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4,'0'));

/** @param {string} template @param {import('./seo.types.js').SeoConfiguration} config
 * @param {import('./seo.types.js').SeoMetadata} metadata */
export function renderSeo(template, config, metadata) {
  const url = config.origin + metadata.path;
  const title = metadata.title + ' — ' + config.name;
  const description = seoText(metadata.description);
  const image = seoImage(metadata.image) || config.origin + '/logo.png';
  const graph = [
    { '@type':'WebSite', '@id':config.origin + '/#website', url:config.origin + '/', name:config.name },
    { '@type':'Organization', '@id':config.origin + '/#organization', url:config.origin + '/', name:config.name,
      logo:{ '@type':'ImageObject', url:config.origin + '/logo.png' } },
    ...(metadata.schema || []),
  ];
  const head = `<title>${seoEscape(title)}</title>
  <meta name="description" content="${seoEscape(description)}">
  <meta name="application-name" content="${seoEscape(config.name)}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <link rel="canonical" href="${seoEscape(url)}">
  <link rel="sitemap" type="application/xml" href="${seoEscape(config.origin)}/sitemap.xml">
  <meta property="og:type" content="website"><meta property="og:site_name" content="${seoEscape(config.name)}">
  <meta property="og:title" content="${seoEscape(title)}"><meta property="og:description" content="${seoEscape(description)}">
  <meta property="og:url" content="${seoEscape(url)}"><meta property="og:image" content="${seoEscape(image)}">
  <meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${seoEscape(title)}">
  <meta name="twitter:description" content="${seoEscape(description)}"><meta name="twitter:image" content="${seoEscape(image)}">
  <script type="application/ld+json">${jsonLd(graph)}</script>`;
  return template.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta\b[^>]*(?:name\s*=\s*["'](?:description|robots|application-name|twitter:[^"']*)["']|property\s*=\s*["']og:[^"']*["'])[^>]*>/gi, '')
    .replace(/<link\b[^>]*rel\s*=\s*["'](?:canonical|sitemap)["'][^>]*>/gi, '')
    .replace(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, '')
    .replace('</head>', () => head + '\n</head>')
    .replace(/\/assets\/api\.js(?:\?[^"']*)?(["'])/g, '/assets/api.js?v=language-2$1')
    .replace(/\/assets\/anime-page\.js(?:\?[^"']*)?(["'])/g, '/assets/anime-page.js?v=media-1$1')
    .replace(/\/assets\/browse-page\.js(?:\?[^"']*)?(["'])/g, '/assets/browse-page.js?v=language-1$1');
}

/** @param {import('./seo.types.js').SeoAnime[]} rows */
export function seoLinks(rows) {
  return `<ul class="seo-catalog-list">${rows.map(anime => `<li><a href="/anime/${encodeURIComponent(anime.slug)}">${seoEscape(anime.title)}</a></li>`).join('')}</ul>`;
}

/** Preserve customized landing text and footer while adding visible catalog links.
 * @param {string} template @param {string} links */
export function seoLanding(template, links) {
  const page = load(template);
  const target = page('.landing-right').first();
  const section = '<section aria-label="Discover anime"><h2>Explore the latest anime</h2>'+links+'</section>';
  if (target.length) target.append(section);
  else page('main').first().append(section);
  return page.html();
}

/** @param {import('./seo.types.js').SeoDetail} detail */
export function seoAnimeBody({ anime, episodes }) {
  return `<nav class="wrap" aria-label="Breadcrumb"><a href="/home">Home</a> / <a href="/browse">Anime</a> / ${seoEscape(anime.title)}</nav>
  <section class="wrap anime-details-panel"><div id="animeDescription">${animeDescriptionHTML({ ...anime, synopsis:seoText(anime.synopsis || anime.description, 20000) }, {heading:'h1'})}</div></section>
  <section class="wrap eps" id="episodeSection"><h2>Episodes</h2><div class="eps-grid">${episodes.map(ep => `<a class="ep" href="/watch/${encodeURIComponent(anime.slug)}/${ep.episode_no}" title="${seoEscape(ep.title)}">${ep.episode_no}</a>`).join('')}</div></section>`;
}

/** @param {string[]} paths @param {string} origin @param {boolean} [index] */
export function sitemapXml(paths, origin, index = false) {
  const root = index ? 'sitemapindex' : 'urlset', tag = index ? 'sitemap' : 'url';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${root} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + [...new Set(paths)].map(path => `<${tag}><loc>${seoEscape(origin + path)}</loc></${tag}>`).join('\n') + `\n</${root}>\n`;
}
