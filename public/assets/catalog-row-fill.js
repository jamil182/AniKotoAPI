/**
 * Fill an incomplete responsive row with distinct previews from the next API page.
 * @template {{id: string}} T
 * @param {T[]} items @param {T[]} nextPage @param {number} columns @returns {T[]}
 */
export function fillCatalogRow(items, nextPage, columns) {
  if (!Number.isInteger(columns) || columns < 1 || columns > 12) return [...items];
  const needed = (columns - items.length % columns) % columns;
  const result = [...items];
  const seen = new Set(items.map(item => item.id));
  for (const item of nextPage) {
    if (result.length >= items.length + needed) break;
    if (!item?.id || seen.has(item.id)) continue;
    result.push(item);
    seen.add(item.id);
  }
  return result;
}
