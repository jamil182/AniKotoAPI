import { commentMedia } from "./comment-media-data.js";
import { mediaItems } from "./comment-media-api.js";

const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
export function mediaStyles() {
  if (document.getElementById("commentMediaStyles")) return;
  const style = document.createElement("link");
  style.id = "commentMediaStyles";
  style.rel = "stylesheet";
  style.href = "/assets/comment-media.css?v=1";
  document.head.append(style);
}
/** @param {import('./comments.types.js').CommentMedia | null | undefined} value */
export function commentMediaHTML(value) {
  const media = commentMedia(value);
  if (!media) return "";
  return `<figure class="comment-media" data-media-slug="${escape(media.slug)}" data-media-kind="${media.kind}" translate="no"><span class="comment-media-loading">${media.kind === "gif" ? "GIF" : "Image"} · Loading…</span><figcaption>${escape(media.title)}</figcaption></figure>`;
}
/** @param {HTMLElement} host */
export async function hydrateCommentMedia(host) {
  const elements = [
    ...host.querySelectorAll("[data-media-slug]:not([data-media-loaded])"),
  ];
  if (!elements.length) return;
  mediaStyles();
  for (const element of elements)
    element.setAttribute("data-media-loaded", "pending");
  for (const kind of ["gif", "image"]) {
    const targets = elements.filter(
      (element) => element.getAttribute("data-media-kind") === kind,
    );
    const slugs = [
      ...new Set(
        targets.map((element) => element.getAttribute("data-media-slug")),
      ),
    ];
    for (let offset = 0; offset < slugs.length; offset += 40) {
      try {
        const data = await mediaItems(
          kind === "gif" ? "gif" : "image",
          slugs.slice(offset, offset + 40),
        );
        const items = new Map(
          data.items.map((item) => [item.media.slug, item]),
        );
        for (const element of targets) {
          const item = items.get(element.getAttribute("data-media-slug"));
          if (!item || !element.isConnected) continue;
          const image = document.createElement("img");
          image.src = item.url;
          image.alt = item.media.title || (kind === "gif" ? "GIF" : "Image");
          image.loading = "lazy";
          image.decoding = "async";
          image.width = item.width;
          image.height = item.height;
          image.onerror = () => {
            const text = document.createElement("span");
            text.textContent = "Media unavailable.";
            image.replaceWith(text);
          };
          element.querySelector(".comment-media-loading")?.replaceWith(image);
          element.setAttribute("data-media-loaded", "ready");
        }
      } catch {
        /* Each unavailable attachment keeps a readable fallback. */
      }
    }
    for (const element of targets)
      if (element.getAttribute("data-media-loaded") !== "ready") {
        const text = element.querySelector(".comment-media-loading");
        if (text) text.textContent = "Media unavailable.";
        element.setAttribute("data-media-loaded", "error");
      }
  }
}
