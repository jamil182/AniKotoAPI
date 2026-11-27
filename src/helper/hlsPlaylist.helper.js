import { assertProxyableUrl, rememberResolvedHost } from "./streamProxy.helper.js";

const PLAYLIST_URI_TAG = /^(\s*#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT):)(.*)$/;
const ATTRIBUTE = /(^|,)(\s*)([A-Z0-9-]+)=("[^"]*"|[^,"]*)/g;

function mediaUrl(reference, playlistUrl) {
  try {
    const url = new URL(reference, playlistUrl);
    if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) {
      return url;
    }
  } catch {
    return null;
  }
  return null;
}

function proxyUrl(endpoint, url) {
  return `/api/stream/${endpoint}?url=${encodeURIComponent(url.href)}`;
}

/**
 * Resolve HLS references against the upstream playlist, then route them through
 * the same proxy as the playlist itself.
 * @param {string} content
 * @param {URL} playlistUrl
 * @returns {string}
 */
export function rewriteHlsPlaylist(content, playlistUrl) {
  let nextIsVariant = false;
  return content.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    const tagged = PLAYLIST_URI_TAG.exec(line);
    if (tagged) {
      const [, tag, attributes] = tagged;
      return tag + attributes.replace(ATTRIBUTE, (attribute, separator, space, name, value) => {
        if (name !== "URI" || !value.startsWith('"') || value.length <= 2) return attribute;
        const url = mediaUrl(value.slice(1, -1), playlistUrl);
        // URI attributes may use an allowed CDN, including the playlist host.
        // Do not extend host trust using a newly recognized attribute.
        if (!url || !assertProxyableUrl(url.href).ok) return attribute;
        return `${separator}${space}URI="${proxyUrl("proxy", url)}"`;
      });
    }
    if (trimmed.startsWith("#EXT-X-STREAM-INF:")) nextIsVariant = true;
    if (!trimmed || trimmed.startsWith("#")) return line;

    const isVariant = nextIsVariant;
    nextIsVariant = false;
    const url = mediaUrl(trimmed, playlistUrl);
    if (!url) return line;
    rememberResolvedHost(url.hostname);
    if (!assertProxyableUrl(url.href).ok) return line;
    const endpoint = isVariant || /\.m3u8$/i.test(url.pathname) ? "proxy" : "ts-proxy";
    return proxyUrl(endpoint, url);
  }).join("\n");
}
