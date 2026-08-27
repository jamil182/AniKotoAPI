/*
 * ======= • ======= • ======= • ======= • =======• =======
 * AniKotoAPI — streamResolver.extractor.js
 * Repository: https://github.com/Shineii86/AniKotoAPI
 *
 * @description
 *   Resolves actual streaming video URLs (m3u8/mp4) from embed player URLs.
 *   Follows the chain: vidtube.site embed → megaplay API → m3u8 playlist.
 *   Supports quality selection and subtitle extraction.
 *
 * @exports
 *   resolveStreamUrl, resolveStreamUrls, parseM3u8Qualities
 *
 * @author  Shinei Nouzen
 * @license MIT
 * ======= • ======= • ======= • ======= • =======• =======
 */

import axios from "axios";
import { headers } from "../configs/header.config.js";

// ══════════════════════════════════════════════════════════════
// STREAM RESOLVER
// ══════════════════════════════════════════════════════════════

// Server name normalization map
const SERVER_NAME_MAP = {
  "VidPlay-1": "vidplay",
  "VidPlay-2": "vidplay",
  "HD-1": "hd",
  "HD-2": "hd",
  "Vidstream-1": "vidstream",
  "Vidstream-2": "vidstream",
  "VidCloud-1": "vidcloud",
  "VidCloud-2": "vidcloud",
  "StreamTape-1": "streamtape",
  "StreamTape-2": "streamtape",
};

// Embed domain to API domain overrides
// NOTE: Prefer the base_url the embed page declares in its own `settings` block —
// a hardcoded map rots. The previous map pointed every host at megaplay-1.buzz,
// which no longer resolves (ENOTFOUND), breaking resolution for all servers.
// Entries here are a last-resort override for pages that declare no base_url.
const EMBED_API_MAP = {};

// Sources endpoint paths, in priority order. The player ships a rewrite that
// swaps getSources -> getSourcesNew, so the "New" variant is the current one;
// the legacy path is kept as a fallback while both are served.
const SOURCES_PATHS = ["/stream/getSourcesNew", "/stream/getSources"];

// ---- FEATURE: Server Name Normalization ----
/**
 * Normalizes server display names to clean identifiers
 * @param {string} name - Raw server name (e.g., "VidPlay-1")
 * @returns {string} Normalized name (e.g., "vidplay")
 */
const normalizeServerName = (name) => {
  if (!name) return "unknown";
  return SERVER_NAME_MAP[name] || name.toLowerCase().replace(/[-\s]+\d+$/, "").trim();
};

// ---- FEATURE: Stream URL Resolution ----
/**
 * Resolves the actual video stream URL from an embed player page.
 * Extracts data-id from the embed HTML, then queries the megaplay API.
 *
 * @param {string} embedUrl - The embed player URL (e.g., vidtube.site/stream/...)
 * @param {object} [options] - Resolution options
 * @param {boolean} [options.followRedirects=true] - Follow HTTP redirects
 * @param {number} [options.timeout=10000] - Request timeout in ms
 * @returns {Promise<Object>} Object with url, qualities, skipData, type
 *
 * @example
 *   const resolved = await resolveStreamUrl("https://vidtube.site/stream/...");
 *   console.log(resolved.url);      // m3u8 URL
 *   console.log(resolved.qualities); // [{ label: "720p", url: "..." }]
 */
const resolveStreamUrl = async (embedUrl, options = {}) => {
  const { followRedirects = true, timeout = 10000 } = options;

  try {
    // NOTE: Extract the embed page to find data-id and API domain
    const embedResponse = await axios.get(embedUrl, {
      headers: {
        ...headers,
        "Referer": "https://anikototv.to/",
        "Origin": "https://anikototv.to",
      },
      timeout,
      maxRedirects: followRedirects ? 5 : 0,
    });

    const embedHtml = typeof embedResponse.data === "string"
      ? embedResponse.data
      : String(embedResponse.data);

    // NOTE: Extract data attributes from the player div
    const dataId = embedHtml.match(/data-id="(\d+)"/)?.[1];
    const realId = embedHtml.match(/data-realid="([^"]+)"/)?.[1];
    const mediaId = embedHtml.match(/data-mediaid="([^"]+)"/)?.[1];

    if (!dataId) {
      return {
        url: null,
        qualities: [],
        skipData: null,
        type: null,
        error: "Could not extract player data-id from embed page",
      };
    }

    // NOTE: Determine API domain — the page's own settings.base_url is authoritative,
    // since the player reads its API host from there. Fall back to an override, then
    // to the embed host itself.
    const embedDomain = new URL(embedUrl).hostname;
    const declaredBaseUrl = embedHtml.match(/base_url\s*:\s*['"]([^'"]+)['"]/)?.[1];
    let apiDomain = EMBED_API_MAP[embedDomain] || embedDomain;
    if (declaredBaseUrl) {
      try { apiDomain = new URL(declaredBaseUrl).hostname; } catch { /* keep fallback */ }
    }

    // NOTE: Query the sources API. Try each known path until one returns JSON —
    // a wrong path answers 200 with an HTML error page, not a 4xx.
    let apiData = null;
    let lastPathError = null;
    for (const sourcesPath of SOURCES_PATHS) {
      try {
        const apiResponse = await axios.get(
          `https://${apiDomain}${sourcesPath}?id=${encodeURIComponent(dataId)}`,
          {
            headers: {
              ...headers,
              "Referer": embedUrl,
              "Origin": `https://${embedDomain}`,
              "X-Requested-With": "XMLHttpRequest",
            },
            timeout,
          }
        );

        const parsed = typeof apiResponse.data === "string"
          ? (() => { try { return JSON.parse(apiResponse.data); } catch { return null; } })()
          : apiResponse.data;

        if (parsed && typeof parsed === "object") {
          apiData = parsed;
          break;
        }
        lastPathError = `${sourcesPath} returned a non-JSON body`;
      } catch (pathError) {
        lastPathError = `${sourcesPath}: ${pathError.message}`;
      }
    }

    if (!apiData) {
      return {
        url: null,
        qualities: [],
        skipData: null,
        type: null,
        error: `Sources API did not return JSON (${lastPathError})`,
      };
    }

    // NOTE: Stream URL lives under `sources` — object or array depending on server.
    // Older shapes (source/url/file at the top level) are kept as fallbacks.
    const streamUrl = (Array.isArray(apiData.sources) ? apiData.sources[0]?.file : apiData.sources?.file)
      || apiData?.source || apiData?.url || apiData?.file || null;
    const streamType = apiData?.type || (streamUrl?.includes(".m3u8") ? "hls" : "mp4");

    // NOTE: Parse m3u8 qualities if it's an HLS stream.
    // The CDN checks Referer and answers 403 to the full embed page URL —
    // it only accepts the player origin, so send that.
    const playerOrigin = `${new URL(embedUrl).origin}/`;
    let qualities = [];
    if (streamUrl && streamType === "hls") {
      qualities = await parseM3u8Qualities(streamUrl, {
        headers: {
          ...headers,
          "Referer": playerOrigin,
        },
        timeout,
      });
    }

    // NOTE: Extract subtitles if available
    const subtitles = extractSubtitles(apiData);

    return {
      url: streamUrl,
      type: streamType,
      qualities,
      subtitles,
      skipData: normalizeSkipData(apiData),
      dataId,
      realId,
      mediaId,
      backup: apiData?.backup || null,
    };
  } catch (error) {
    return {
      url: null,
      qualities: [],
      skipData: null,
      type: null,
      error: error.message,
    };
  }
};

// ---- FEATURE: Batch Stream URL Resolution ----
/**
 * Resolves stream URLs for multiple episodes in batch
 * @param {string} embedUrl - The embed player URL
 * @param {object} [options] - Resolution options
 * @returns {Promise<Object>} Batch resolution result
 */
const resolveStreamUrls = async (embedUrl, options = {}) => {
  try {
    const resolved = await resolveStreamUrl(embedUrl, options);
    return resolved;
  } catch (error) {
    return { url: null, error: error.message };
  }
};

// ══════════════════════════════════════════════════════════════
// M3U8 PARSER
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: M3U8 Quality Parser ----
/**
 * Parses an M3U8 playlist to extract available quality options.
 * Supports both master playlists (multiple qualities) and media playlists.
 *
 * @param {string} m3u8Url - URL of the M3U8 playlist
 * @param {object} [options] - Fetch options
 * @param {object} [options.headers] - Custom headers
 * @param {number} [options.timeout=10000] - Request timeout
 * @returns {Promise<Array<Object>>} Array of quality objects
 *
 * @example
 *   const qualities = await parseM3u8Qualities("https://example.com/master.m3u8");
 *   qualities.forEach(q => console.log(`${q.label}: ${q.url}`));
 */
const parseM3u8Qualities = async (m3u8Url, options = {}) => {
  const { headers: customHeaders = {}, timeout = 10000 } = options;

  try {
    const response = await axios.get(m3u8Url, {
      headers: { ...headers, ...customHeaders },
      timeout,
    });

    const content = typeof response.data === "string"
      ? response.data
      : String(response.data);

    const qualities = [];
    const lines = content.split("\n").map((l) => l.trim());

    // NOTE: Parse master playlist (contains #EXT-X-STREAM-INF)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("#EXT-X-STREAM-INF:")) {
        const attrs = lines[i].substring("#EXT-X-STREAM-INF:".length);
        const bandwidth = parseInt(attrs.match(/BANDWIDTH=(\d+)/)?.[1] || "0");
        const resolution = attrs.match(/RESOLUTION=(\d+x\d+)/)?.[1] || "";
        const [width, height] = resolution.split("x").map(Number);
        const nextLine = lines[i + 1];

        if (nextLine && !nextLine.startsWith("#")) {
          // NOTE: Resolve relative URLs against base M3U8 URL
          const qualityUrl = nextLine.startsWith("http")
            ? nextLine
            : new URL(nextLine, m3u8Url).href;

          qualities.push({
            label: height ? `${height}p` : `${bandwidth}bps`,
            width: width || 0,
            height: height || 0,
            bandwidth,
            url: qualityUrl,
          });
        }
      }
    }

    // NOTE: If no qualities found, it's likely a single-quality stream
    if (qualities.length === 0 && content.includes("#EXTINF")) {
      qualities.push({
        label: "default",
        width: 0,
        height: 0,
        bandwidth: 0,
        url: m3u8Url,
      });
    }

    // NOTE: Sort by resolution/bandwidth descending (highest first)
    qualities.sort((a, b) => (b.height || b.bandwidth) - (a.height || a.bandwidth));

    return qualities;
  } catch (error) {
    return [];
  }
};

// ══════════════════════════════════════════════════════════════
// SKIP DATA NORMALIZER
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: Intro/Outro Skip Range Normalization ----
/**
 * Normalizes intro/outro skip ranges to the { intro: [start, end] } shape the
 * rest of the API emits. The sources API returns them as separate
 * { start, end } objects; older responses used a single `skip_data` field.
 *
 * @param {object} apiData - The sources API response
 * @returns {object|null} { intro: [start, end], outro: [start, end] } or null
 */
const normalizeSkipData = (apiData) => {
  if (apiData?.skip_data) return apiData.skip_data;

  const toRange = (range) => [Number(range?.start) || 0, Number(range?.end) || 0];
  if (!apiData?.intro && !apiData?.outro) return null;

  return { intro: toRange(apiData.intro), outro: toRange(apiData.outro) };
};

// ══════════════════════════════════════════════════════════════
// SUBTITLE EXTRACTOR
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: Subtitle Track Extractor ----
/**
 * Extracts subtitle information from API response data
 * @param {object} apiData - The megaplay API response
 * @returns {Array<Object>} Array of subtitle objects
 */
const extractSubtitles = (apiData) => {
  const subtitles = [];

  // NOTE: Subtitles may be in different formats depending on the source
  if (apiData?.subtitles && Array.isArray(apiData.subtitles)) {
    for (const sub of apiData.subtitles) {
      subtitles.push({
        label: sub.label || sub.language || "Unknown",
        language: sub.code || sub.language || "unknown",
        url: sub.url || sub.file || null,
        format: sub.format || "srt",
      });
    }
  }

  // NOTE: Some sources embed subtitles in tracks array
  if (apiData?.tracks && Array.isArray(apiData.tracks)) {
    for (const track of apiData.tracks) {
      // NOTE: The player labels subtitle tracks "captions"; "subtitles" is the
      // WebVTT spelling other sources use. Accept both.
      const trackKind = track.kind || track.type;
      if (trackKind === "subtitles" || trackKind === "captions") {
        subtitles.push({
          label: track.label || track.language || "Unknown",
          language: track.srclang || track.language || "unknown",
          url: track.file || track.src || null,
          format: track.format || "srt",
        });
      }
    }
  }

  return subtitles;
};

export { resolveStreamUrl, resolveStreamUrls, parseM3u8Qualities, normalizeServerName, extractSubtitles };

// ══════════════════════════════════════════════════════════════ END: streamResolver.extractor.js
