/** @param {string} slug @param {AbortSignal} signal @returns {Promise<string>} */
export async function translatedSynopsis(slug, signal) {
  if (!/^[a-z0-9][a-z0-9_-]{0,239}$/i.test(slug)) throw new Error('Invalid anime');
  const deadline=Date.now()+200000;
  while (!signal.aborted && Date.now()<deadline) {
    const response=await fetch('/api/catalog/synopsis/'+encodeURIComponent(slug)+'?lang=id',{
      credentials:'omit',cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(20000)]),
    });
    if (response.status===202 || (response.status===503 && Number(response.headers.get('Retry-After'))<=5)) {
      const delay=Math.max(1,Math.min(10,Number(response.headers.get('Retry-After'))||3))*1000;
      await new Promise((resolve,reject)=>{
        const stop=()=>{clearTimeout(timer);reject(signal.reason);};
        const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},delay);
        if(signal.aborted){stop();return;}signal.addEventListener('abort',stop,{once:true});
      });
      continue;
    }
    const body=await response.json().catch(()=>null);
    if (!response.ok || body?.success!==true || body.results?.status!=='ready' || typeof body.results.text!=='string' || !body.results.text.trim()) throw new Error('Synopsis translation unavailable');
    return body.results.text;
  }
  throw new Error('Synopsis translation timed out');
}
