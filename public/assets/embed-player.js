import { parseEmbedUrl } from './embed-policy.js';

/**
 * Separates allowlisted third-party playback from the native HLS player.
 * An iframe load event confirms navigation, not successful video playback.
 * @param {{container: HTMLElement, onLoading: () => void, onLoad: () => void, onError: () => void}} options
 */
export function createEmbedPlayer({ container, onLoading, onLoad, onError }) {
  let frame = null;
  let timeout = null;
  const clear = () => {
    clearTimeout(timeout);
    if (frame) { frame.onload = null; frame.onerror = null; frame.remove(); }
    frame = null;
    container.classList.remove('embed-active');
  };
  return {
    get active() { return frame !== null; },
    clear,
    load(rawUrl, title) {
      const url = parseEmbedUrl(rawUrl);
      if (!url) throw new Error('Video embed URL is not supported');
      clear();
      const current = document.createElement('iframe');
      frame = current;
      current.className = 'video-embed';
      current.title = title;
      current.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
      current.allowFullscreen = true;
      current.referrerPolicy = 'strict-origin-when-cross-origin';
      // These players reject sandboxed frames. Origins remain restricted by
      // the shared URL policy and the server's frame-src CSP directive.
      current.onload = () => {
        if (frame !== current) return;
        clearTimeout(timeout);
        onLoad();
      };
      current.onerror = () => {
        if (frame !== current) return;
        clearTimeout(timeout);
        onError();
      };
      container.classList.add('embed-active');
      onLoading();
      timeout = setTimeout(() => { if (frame === current) onError(); }, 25000);
      current.src = url.href;
      container.append(current);
    },
  };
}
