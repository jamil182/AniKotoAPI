import { searchMedia } from "./comment-media-api.js";
import { mediaStyles } from "./comment-media-view.js";

/** @param {HTMLElement} root @param {(value: import('./comments.types.js').CommentMedia | null) => void} onChange */
export function createCommentMediaPicker(root, onChange) {
  mediaStyles();
  const toggle = root.querySelector("[data-media-toggle]"),
    selection = root.querySelector("[data-media-selection]");
  const panel = document.createElement("section");
  panel.className = "comment-media-picker";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "GIF and image search");
  panel.setAttribute("translate", "no");
  panel.innerHTML =
    '<div class="comment-media-search"><input type="search" placeholder="Search KLIPY" aria-label="Search KLIPY" maxlength="80"><button type="button" data-close aria-label="Close media search">×</button></div><div class="comment-media-tabs" role="group" aria-label="Media type"><button type="button" data-kind="gif" aria-pressed="true">GIFs</button><button type="button" data-kind="image" aria-pressed="false">Images</button></div><p class="comment-media-status" role="status"></p><div class="comment-media-results" aria-label="Media search results"></div><div class="comment-media-picker-footer"><a href="https://klipy.com/" target="_blank" rel="noopener noreferrer">Powered by KLIPY</a><button type="button" class="comment-media-more" hidden>Load more</button></div>';
  document.body.append(panel);
  const input = panel.querySelector("input"),
    results = panel.querySelector(".comment-media-results"),
    status = panel.querySelector("[role=status]"),
    more = panel.querySelector(".comment-media-more");
  /** @type {'gif' | 'image'} */ let kind = "gif";
  /** @type {import('./comment-media.types.js').MediaItem | null} */ let chosen =
    null;
  let page = 1,
    enabled = false,
    request = null,
    revision = 0,
    timer = null;
  function position() {
    const box = toggle.getBoundingClientRect(),
      width = Math.min(360, innerWidth - 24),
      height = Math.min(430, innerHeight * 0.8);
    panel.style.left =
      Math.max(12, Math.min(innerWidth - width - 12, box.right - width)) + "px";
    panel.style.top =
      Math.max(
        12,
        box.bottom + height + 8 > innerHeight
          ? box.top - height - 8
          : box.bottom + 8,
      ) + "px";
  }
  function close(focus = false) {
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    request?.abort();
    clearTimeout(timer);
    revision++;
    if (focus && !toggle.disabled) toggle.focus({ preventScroll: true });
  }
  async function load(append = false) {
    if (panel.hidden || !enabled) return;
    request?.abort();
    const controller = new AbortController();
    request = controller;
    const current = ++revision;
    status.textContent = "Searching…";
    more.disabled = true;
    results.setAttribute("aria-busy", "true");
    if (!append) {
      page = 1;
      results.replaceChildren();
    }
    const query = input.value.trim();
    try {
      const data = await searchMedia(kind, query, page, controller.signal);
      if (controller.signal.aborted || current !== revision || panel.hidden)
        return;
      for (const item of data.items) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "comment-media-result";
        button.setAttribute(
          "aria-label",
          item.media.title || (kind === "gif" ? "Select GIF" : "Select image"),
        );
        const image = document.createElement("img");
        image.src = item.preview;
        image.alt = item.media.title;
        image.loading = "lazy";
        image.decoding = "async";
        button.append(image);
        button.onclick = () => {
          chosen = item;
          selection.replaceChildren();
          const preview = document.createElement("img");
          preview.src = item.url;
          preview.alt = item.media.title;
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "×";
          remove.setAttribute("aria-label", "Remove attachment");
          remove.onclick = () => clear();
          selection.append(preview, remove);
          selection.hidden = false;
          close(true);
          onChange(item.media);
        };
        results.append(button);
      }
      status.textContent = results.children.length
        ? ""
        : "No media found. Try another search.";
      more.hidden = !data.hasNext || page >= 100;
    } catch (error) {
      if (!controller.signal.aborted && current === revision) {
        status.textContent =
          error instanceof Error ? error.message : "Media search unavailable.";
        more.hidden = true;
      }
    } finally {
      if (current === revision) {
        more.disabled = false;
        results.setAttribute("aria-busy", "false");
      }
    }
  }
  function clear() {
    chosen = null;
    selection.replaceChildren();
    selection.hidden = true;
    onChange(null);
  }
  const outside = (event) => {
    if (
      !panel.hidden &&
      !panel.contains(event.target) &&
      !toggle.contains(event.target)
    )
      close();
  };
  const keyboard = (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      event.preventDefault();
      close(true);
    }
  };
  const reposition = () => {
    if (!panel.hidden) position();
  };
  toggle.onclick = () => {
    if (!enabled) return;
    if (!panel.hidden) {
      close(true);
      return;
    }
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    position();
    input.focus();
    void load();
  };
  panel.querySelector("[data-close]").onclick = () => close(true);
  input.oninput = () => {
    clearTimeout(timer);
    request?.abort();
    revision++;
    results.replaceChildren();
    more.hidden = true;
    status.textContent = "Searching…";
    timer = setTimeout(() => void load(), 350);
  };
  input.onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      clearTimeout(timer);
      void load();
    }
  };
  more.onclick = () => {
    page++;
    void load(true);
  };
  for (const button of panel.querySelectorAll("[data-kind]"))
    button.onclick = () => {
      kind = button.getAttribute("data-kind") === "image" ? "image" : "gif";
      for (const option of panel.querySelectorAll("[data-kind]"))
        option.setAttribute("aria-pressed", String(option === button));
      void load();
    };
  document.addEventListener("pointerdown", outside);
  document.addEventListener("keydown", keyboard);
  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, true);
  return {
    value: () => chosen?.media || null,
    clear,
    close,
    setEnabled(value) {
      enabled = Boolean(value);
      toggle.disabled = !enabled;
      const remove = selection.querySelector("button");
      if (remove) remove.disabled = !enabled;
      if (!enabled) close();
    },
    destroy() {
      close();
      panel.remove();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keyboard);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    },
  };
}
