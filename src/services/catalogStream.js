import { AniKotoError } from './anikotoApi.js';
import { resolveStreamUrl } from '../extractors/streamResolver.extractor.js';
import { parseEmbedUrl } from '../../public/assets/embed-policy.js';
import { assertProxyableUrl, rememberResolvedHost } from '../helper/streamProxy.helper.js';

/** Resolve locally so changes in provider payloads do not depend on a hosted API release. */
export async function resolveCatalogStream(client, id, slug, resolver = resolveStreamUrl) {
  const metadata = await client.get('/stream', { id, slug });
  const embed = parseEmbedUrl(metadata?.url);
  if (!embed) throw new AniKotoError('AniKotoAPI did not return a supported video embed');
  const result = await resolver(embed.href);
  let url;
  try { url = new URL(result?.url); } catch { throw new AniKotoError('This server did not return a playable stream. Try another server.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new AniKotoError('Invalid video stream URL');
  rememberResolvedHost(url.hostname);
  if (!assertProxyableUrl(url.href).ok) throw new AniKotoError('Invalid video stream destination');
  for (const track of Array.isArray(result.subtitles) ? result.subtitles : []) {
    try {
      const subtitle = new URL(track.url || track.file);
      if (subtitle.protocol === 'https:' && !subtitle.username && !subtitle.password) rememberResolvedHost(subtitle.hostname);
    } catch { /* Missing subtitle URLs do not prevent video playback. */ }
  }
  return { ...result, url: url.href, linkId: id, embedUrl: embed.href, skipData: metadata.skipData || result.skipData || null };
}
