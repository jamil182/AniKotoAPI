/** @param {string} value @returns {'live' | 'managed'} */
export function getCatalogMode(value = 'live') {
  const mode = value.trim().toLowerCase() || 'live';
  if (mode !== 'live' && mode !== 'managed') {
    throw new Error('PUBLIC_CATALOG_MODE must be live or managed');
  }
  return mode;
}
