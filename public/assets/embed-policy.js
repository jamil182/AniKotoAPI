export const EMBED_ORIGINS = Object.freeze([
  'https://megaplay.buzz',
  'https://vidtube.site',
  'https://vidplay.site',
  'https://anixo.buzz',
  'https://megavid.buzz',
]);

/** @param {unknown} value @returns {URL | null} */
export function parseEmbedUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const supported = ['https://anixo.buzz', 'https://megavid.buzz'].includes(url.origin)
      ? /^\/(?:embed\/)?(?:ani|mal)\/[1-9]\d*\/\d+(?:\.\d+)?\/(?:sub|dub)$/.test(url.pathname)
      : /^\/(?:videojs\/)?stream\//.test(url.pathname);
    return EMBED_ORIGINS.includes(url.origin) && !url.username && !url.password && supported
      ? url : null;
  } catch {
    return null;
  }
}

/** @param {unknown} malId @param {unknown} episode */
export function malEmbedSources(malId, episode) {
  const id = String(malId ?? '');
  const number = String(episode ?? '');
  if (!/^[1-9]\d{0,9}$/.test(id) || !/^\d+(?:\.\d+)?$/.test(number) || Number(number) <= 0) return [];
  return ['sub', 'dub'].map(language => ({
    id: `megaplay-${language}`, name: 'MegaPlay', language,
    url: `https://megaplay.buzz/stream/mal/${id}/${number}/${language}`,
  }));
}
