/** @param {unknown} value @returns {import('./comments.types.js').CommentMedia | null} */
export function commentMedia(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = /** @type {Record<string, unknown>} */ (value);
  if (
    Object.keys(row).some(
      (key) => !["provider", "kind", "slug", "title", "id"].includes(key),
    ) ||
    row.provider !== "klipy" ||
    (row.id !== undefined &&
      (!Number.isSafeInteger(row.id) || Number(row.id) <= 0)) ||
    (row.kind !== "gif" && row.kind !== "image") ||
    typeof row.slug !== "string" ||
    !/^[a-z0-9][a-z0-9_-]{0,159}$/i.test(row.slug) ||
    typeof row.title !== "string" ||
    row.title.length > 160 ||
    /[\x00-\x1f\x7f]/.test(row.title)
  )
    return null;
  return {
    provider: "klipy",
    kind: row.kind === "gif" ? "gif" : "image",
    slug: row.slug,
    title: row.title,
    ...(row.id === undefined ? {} : { id: Number(row.id) }),
  };
}

/** @param {import('./comments.types.js').CommentMedia} reference
 * @param {import('./comment-media.types.js').MediaItem[]} items @param {boolean} [single]
 * @returns {import('./comment-media.types.js').MediaItem | null} */
export function matchMediaItem(reference, items, single = false) {
  if (reference.id !== undefined)
    return items.find((item) => item.media.id === reference.id) || null;
  return (
    items.find((item) => item.media.slug === reference.slug) ||
    (single && items.length === 1 ? items[0] : null)
  );
}

/** @param {unknown} value */
export function klipyImageUrl(value) {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    /[\x00-\x20\x7f]/.test(value)
  )
    return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !["static.klipy.com", "static1.klipy.com", "static2.klipy.com"].includes(
        url.hostname,
      ) ||
      url.port ||
      url.username ||
      url.password ||
      !/\.(?:gif|webp|png|jpe?g)$/i.test(url.pathname)
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
