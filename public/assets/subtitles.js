/** @typedef {import('./subtitles.types.js').SubtitleTrack} SubtitleTrack */
/** @typedef {import('./subtitles.types.js').SubtitleCue} SubtitleCue */

/** @param {SubtitleTrack} track */
export function subtitleLanguage(track) {
  const value = `${track.language || ''} ${track.label || ''}`.toLowerCase();
  if (/\b(?:id|ind|indonesian)\b|bahasa indonesia/.test(value)) return 'id';
  if (/\b(?:en|eng|english)\b/.test(value)) return 'en';
  return '';
}

/** The local translation engine uses an English source, never an arbitrary track.
 * @param {unknown} list @returns {SubtitleTrack[]}
 */
export function withIndonesianTranslation(list) {
  const tracks = Array.isArray(list) ? list.filter(track => track && typeof track === 'object'
    && typeof (track.url || track.file) === 'string') : [];
  if (tracks.some(track => subtitleLanguage(track) === 'id')) return tracks;
  const source = tracks.find(track => subtitleLanguage(track) === 'en');
  if (!source) return tracks;
  return [...tracks, { label: 'Indonesian (auto-translate)', language: 'id', sourceLanguage: 'en',
    url: source.url || source.file, translated: true }];
}

const entity = value => value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, match => {
  const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
  if (named[match.toLowerCase()]) return named[match.toLowerCase()];
  const hex = match.toLowerCase().startsWith('&#x');
  const code = Number.parseInt(match.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
});

/** @param {string} text @returns {SubtitleCue[]} */
export function parseVtt(text) {
  if (!/^\uFEFF?WEBVTT(?:\s|$)/.test(text.trimStart())) return [];
  const seconds = value => {
    const match = /^\s*(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{1,3})(?:\s|$)/.exec(value);
    if (!match || Number(match[2]) >= 60 || Number(match[3]) >= 60) return null;
    return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number('0.' + match[4]);
  };
  const cues = [];
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    if (/^(?:NOTE|STYLE|REGION)(?:\s|$)/.test(block.trim())) continue;
    const lines = block.split('\n'), index = lines.findIndex(line => line.includes('-->'));
    if (index < 0) continue;
    const [left, right] = lines[index].split('-->');
    const start = seconds(left), end = seconds(right || '');
    const content = entity(lines.slice(index + 1).join('\n').replace(/<[^>]*>/g, '')).trim();
    if (start !== null && end !== null && end > start && content) cues.push({ start, end, text: content });
  }
  return cues;
}

/** @param {number} milliseconds @param {AbortSignal} signal */
function pause(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Poll background translations without holding a long HTTP request.
 * @param {SubtitleTrack} track
 * @param {{signal?: AbortSignal, fetchImpl?: typeof fetch, wait?: typeof pause, onProgress?: (progress: {completed: number,total: number}) => void}} options
 * @returns {Promise<SubtitleCue[]>}
 */
export async function loadSubtitleTrack(track, { signal, fetchImpl = fetch, wait = pause, onProgress } = {}) {
  const deadline = AbortSignal.timeout(900_000);
  const lifetime = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const url = track.url || track.file;
  if (!url) throw new Error('Alamat subtitle tidak tersedia.');
  const endpoint = track.translated
    ? '/api/stream/sub-translate?to=id&from=' + encodeURIComponent(track.sourceLanguage || 'en') + '&url=' + encodeURIComponent(url)
    : '/api/stream/sub-proxy?url=' + encodeURIComponent(url);
  while (true) {
    lifetime.throwIfAborted();
    const response = await fetchImpl(endpoint, { cache: 'no-store', signal: AbortSignal.any([lifetime, AbortSignal.timeout(25_000)]) });
    if (response.status === 202 && track.translated) {
      const data = await response.json();
      if (data.success !== true || data.results?.status !== 'translating') throw new Error('Respons penerjemah tidak valid.');
      onProgress?.({ completed: Math.max(0, Number(data.results.completed) || 0), total: Math.max(0, Number(data.results.total) || 0) });
      await wait(Math.min(10, Math.max(2, Number(response.headers.get('Retry-After')) || 3)) * 1000, lifetime);
      continue;
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Subtitle belum dapat dimuat. Coba lagi.');
    }
    const cues = parseVtt(await response.text());
    if (!cues.length) throw new Error('File subtitle kosong atau tidak valid. Pilih server atau bahasa lain.');
    return cues;
  }
}
