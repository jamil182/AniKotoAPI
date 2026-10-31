/** Extract only explicitly labelled sections; trending is not a series relation.
 * @param {import('cheerio').CheerioAPI} $ @param {'Related' | 'Recommended'} label */
export function extractWatchSuggestions($, label) {
  const sections = $('.w-side-section').filter((_index, section) => {
    const heading = $(section).find('.title').first().text().trim();
    return new RegExp(`^${label}\\b`, 'i').test(heading);
  });
  const items = sections.find('.item').add($(label === 'Related' ? '#w-related .item' : '#w-recommended .item'));
  const seen = new Set(), rows = [];
  items.each((_index, item) => {
    const node = $(item), link = node.is('a') ? node : node.find('a[href*="/watch/"]').first();
    let pathname;
    try {
      const url = new URL(link.attr('href') || '', 'https://anikoto.cz');
      if (url.protocol !== 'https:' || url.username || url.password) return;
      pathname = url.pathname;
    } catch { return; }
    const match = /^\/(?:watch|anime)\/([a-z0-9][a-z0-9_-]{0,239})(?:\/|$)/i.exec(pathname);
    const title = node.find('.name').first().text().trim().slice(0, 300);
    if (!match || !title || seen.has(match[1]) || rows.length >= 40) return;
    seen.add(match[1]);
    const image = node.find('img').first();
    rows.push({slug: match[1], title, poster: image.attr('data-src') || image.attr('src') || '',
      type: node.find('.meta .dot').first().text().trim().slice(0, 60),
      relation: node.find('.relation,.serieslabelitem').first().text().trim().slice(0, 80)});
  });
  return rows;
}
