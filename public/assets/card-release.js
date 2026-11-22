/** @param {{latestEpisode?: number, releasedAt?: string}} item @param {number} now */
export function releaseCardHTML(item, now = Date.now()) {
  const episode = item.latestEpisode;
  const timestamp = typeof item.releasedAt === 'string' ? Date.parse(item.releasedAt) : NaN;
  if (!Number.isSafeInteger(episode) || episode <= 0 || episode > 100000 || !Number.isFinite(timestamp) || timestamp > now + 60000) return '';
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  const age = minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
  return `<div class="card-release"><span>EP ${episode}</span><time datetime="${new Date(timestamp).toISOString()}">${age}</time></div>`;
}
