/** A stable page ID makes network retries and heartbeats idempotent.
 * @param {{path: string, eventId: string, send: (event: {path: string, eventId: string, type: string}) => Promise<{needsView?: boolean}>}} options
 */
export function createVisitorTracker({ path, eventId, send }) {
  let viewed = false, busy = false;
  return async () => {
    if (busy) return;
    busy = true;
    try {
      const result = await send({ path, eventId, type: viewed ? 'heartbeat' : 'view' });
      viewed = !result.needsView;
    } catch { /* Retry on the next visible heartbeat; never interrupt the page. */ }
    finally { busy = false; }
  };
}

if (typeof document !== 'undefined') {
  const path = location.pathname;
  let pulse = createVisitorTracker({ path, eventId: crypto.randomUUID(), send: async event => {
    const response = await fetch('/api/visit', { method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event), signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Visitor recording unavailable');
    const data = await response.json();
    if (data.success !== true) throw new Error('Invalid visitor response');
    return data.results;
  } });
  const visiblePulse = () => { if (!document.hidden) void pulse(); };
  visiblePulse();
  setInterval(visiblePulse, 30_000);
  document.addEventListener('visibilitychange', visiblePulse);
  window.addEventListener('pageshow', visiblePulse);
}
