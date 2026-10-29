/**
 * Poll only while visible; schedule after completion so requests never overlap.
 * @param {(signal: AbortSignal) => Promise<unknown>} load
 * @param {{onData: (value: unknown) => void, onError?: (error: Error) => void, intervalMs?: number}} options
 */
function startLiveRefresh(load, { onData, onError = () => {}, intervalMs = 30000 }) {
  let timer = null;
  let controller = null;
  let running = false;
  let stopped = false;
  let failures = 0;
  let lastSuccess = null;

  const status = (message, state) => {
    const el = document.getElementById('liveStatus');
    if (!el) return;
    el.textContent = message;
    el.dataset.state = state;
    el.title = lastSuccess ? 'Last checked: ' + lastSuccess.toLocaleTimeString() : message;
  };
  const schedule = (delay) => {
    clearTimeout(timer);
    if (!stopped && !document.hidden) timer = setTimeout(refresh, delay);
  };
  async function refresh() {
    if (stopped || running || document.hidden) return;
    running = true;
    controller = new AbortController();
    let delay = intervalMs;
    try {
      status(lastSuccess ? 'Updating…' : 'Connecting…', 'loading');
      const value = await load(controller.signal);
      if (controller.signal.aborted || stopped) return;
      onData(value);
      lastSuccess = new Date();
      failures = 0;
      status('Live · ' + lastSuccess.toLocaleTimeString(), 'live');
    } catch (error) {
      if (controller.signal.aborted || stopped) return;
      failures++;
      delay = Math.max(Math.min(300000, intervalMs * 2 ** Math.min(failures - 1, 4)), (error.retryAfter || 0) * 1000);
      status(lastSuccess ? 'Reconnecting · showing last data' : 'Connection unavailable · retrying', 'stale');
      onError(error);
    } finally {
      running = false;
      controller = null;
      schedule(delay);
    }
  }
  function visibility() {
    clearTimeout(timer);
    if (document.hidden) {
      controller?.abort();
      status('Paused', 'paused');
    } else {
      refresh();
    }
  }
  function pageHide() {
    stopped = true;
    clearTimeout(timer);
    controller?.abort();
  }
  function pageShow(event) {
    if (event.persisted) { stopped = false; refresh(); }
  }
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', pageHide);
  window.addEventListener('pageshow', pageShow);
  refresh();
  return () => {
    pageHide();
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', pageHide);
    window.removeEventListener('pageshow', pageShow);
  };
}
