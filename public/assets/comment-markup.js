export const commentEscape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

export function timestampText(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return Math.floor(value / 60).toString().padStart(2, '0') + ':' + (value % 60).toString().padStart(2, '0');
}
/** Render only a small formatting whitelist. User HTML and links always remain escaped text. */
export function commentMarkup(value, seek = false) {
  const inline = line => {
    const pattern = /\*\*([^\n]+?)\*\*|~~([^\n]+?)~~|\|\|([^\n]+?)\|\||_([^_\n]+)_|\[(\d{1,4}:[0-5]\d)\]/g;
    let result = '', offset = 0;
    for (const match of line.matchAll(pattern)) {
      result += commentEscape(line.slice(offset, match.index));
      if (match[1] !== undefined) result += '<strong>' + commentEscape(match[1]) + '</strong>';
      else if (match[2] !== undefined) result += '<s>' + commentEscape(match[2]) + '</s>';
      else if (match[3] !== undefined) result += '<button type="button" class="comment-inline-spoiler" data-reveal aria-expanded="false"><span>Spoiler · klik untuk melihat</span><span hidden>' + commentEscape(match[3]) + '</span></button>';
      else if (match[4] !== undefined) result += '<em>' + commentEscape(match[4]) + '</em>';
      else {
        const [minutes, seconds] = match[5].split(':').map(Number);
        result += seek ? `<button type="button" class="comment-timestamp" data-seek="${minutes * 60 + seconds}">${commentEscape(match[5])}</button>` : commentEscape(match[0]);
      }
      offset = match.index + match[0].length;
    }
    return result + commentEscape(line.slice(offset));
  };
  return String(value || '').slice(0, 4000).split('\n').map(line => line.startsWith('> ') ? '<blockquote>' + inline(line.slice(2)) + '</blockquote>' : inline(line)).join('<br>');
}

/** @param {string} text @param {number} start @param {number} end @param {string} tool */
export function formatCommentSelection(text, start, end, tool) {
  const markers = { bold: '**', italic: '_', strike: '~~', spoiler: '||' };
  const selected = text.slice(start, end);
  if (tool === 'quote') {
    const replacement = selected.split('\n').map(line => '> ' + line).join('\n');
    return { text: text.slice(0, start) + replacement + text.slice(end), start: start + 2, end: start + replacement.length };
  }
  const marker = markers[tool];
  if (!marker) return { text, start, end };
  return { text: text.slice(0, start) + marker + selected + marker + text.slice(end), start: start + marker.length, end: end + marker.length };
}
