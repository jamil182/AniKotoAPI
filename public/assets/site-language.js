import { siteLocale, languageLabel } from './site-language-data.js';
import { translatedSynopsis } from './synopsis-language.js';

const skip='script,style,noscript,pre,code,textarea,input,[contenteditable],[translate="no"],#accountName,#accountEmail,.comment-body,.comment-preview,.comment-meta,.comment-avatar,.nav-account-name,.card-title,.tip-title,.rank-t,.t,.anime-description-title,.anime-description-alias,.hero h1,.weekly-card-copy h2,.sched-title,.ep-item,.seo-catalog-list a,.anime-synopsis-text,.hero-inner p,.tip-syn,.weekly-card-copy p';
const synopsisSelector='.anime-synopsis-text,.hero-inner p,.tip-syn,.weekly-card-copy p';
const key='aniyear:site-language:v1';
/** @type {'en' | 'id'} */ let locale='en';
try { locale=siteLocale(localStorage.getItem(key)); } catch { /* English is the default when storage is unavailable. */ }
/** @type {WeakMap<Node, import('./site-language.types.js').LabelState>} */ const textState=new WeakMap();
/** @type {WeakMap<Element, Map<string, import('./site-language.types.js').LabelState>>} */ const attributeState=new WeakMap();
/** @type {WeakMap<HTMLElement, import('./site-language.types.js').SynopsisState>} */ const synopsisState=new WeakMap();
/** @type {Set<HTMLElement>} */ const synopses=new Set();
/** @type {Set<Element>} */ const dirty=new Set();
/** @type {Map<string, string>} */ const cache=new Map();
/** @type {import('./site-language.types.js').SynopsisJob[]} */ const queue=[];
let observer, intersection, started=false, scheduled=false, working=false, generation=0, controller=new AbortController();

/** @param {HTMLElement} element */
function synopsisSlug(element) {
  const card=element.closest('.card');
  if (card?.getAttribute('data-id')) return card.getAttribute('data-id');
  const href=element.closest('.hero-inner')?.querySelector('a[href^="/anime/"]')?.getAttribute('href')
    || element.closest('a.weekly-card')?.getAttribute('href') || location.pathname;
  const match=/^\/(?:anime|watch)\/([a-z0-9][a-z0-9_-]{0,239})(?:\/|$)/i.exec(href);
  return match?.[1] || null;
}

function status(message='') {
  let element=document.getElementById('siteLanguageMessage');
  if (!element) { element=document.createElement('p');element.id='siteLanguageMessage';element.className='site-language-message';element.setAttribute('role','status');element.setAttribute('translate','no');document.body.append(element); }
  element.textContent=message;element.hidden=!message;
}

async function pump() {
  if (working) return;
  working=true;
  while (queue.length) {
    const job=queue.shift(), {element,source,slug,version,signal}=job;
    if (!element.isConnected || signal.aborted || locale!=='id') continue;
    try {
      const cacheKey=slug+'\n'+source;
      let text=cache.get(cacheKey);
      if (!text) {
        text=await translatedSynopsis(slug,signal);
        if (cache.size>=64) cache.delete(cache.keys().next().value);
        cache.set(cacheKey,text);
      }
      if (element.isConnected && locale==='id' && generation===version && !signal.aborted) {
        synopsisState.get(element).translated=text;element.textContent=text;
      }
    } catch {
      if (!signal.aborted && locale==='id' && generation===version) status('Terjemahan sinopsis belum tersedia. Teks asli tetap ditampilkan; pilih ID lagi untuk mencoba ulang.');
    }
  }
  working=false;
}

/** @param {HTMLElement} element */
function translateSynopsis(element) {
  const state=synopsisState.get(element), slug=synopsisSlug(element);
  if (!state || locale!=='id' || !slug || state.attempt===generation || queue.length>=32) return;
  const style=getComputedStyle(element);
  if (style.visibility==='hidden' || style.display==='none') return;
  if (state.translated) { element.textContent=state.translated;state.attempt=generation;return; }
  state.attempt=generation;
  queue.push({element,source:state.source,slug,version:generation,signal:controller.signal});
  void pump();
}

/** @param {Node} root */
function scan(root) {
  if (!(root instanceof Element)) return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  let node;
  while ((node=walker.nextNode())) {
    if (!node.parentElement || node.parentElement.closest(skip) || !node.textContent.trim()) continue;
    let state=textState.get(node);
    if (!state || state.last!==node.textContent) { state={source:node.textContent,last:node.textContent};textState.set(node,state); }
    const value=languageLabel(state.source,locale);
    if (node.textContent!==value) node.textContent=value;
    state.last=value;
  }
  for (const element of [root,...root.querySelectorAll('[placeholder],[aria-label],[title]')]) {
    if (element.closest(skip) && !element.matches('input,textarea')) continue;
    let states=attributeState.get(element);if (!states) {states=new Map();attributeState.set(element,states);}
    for (const name of ['placeholder','aria-label','title']) {
      const value=element.getAttribute(name);if (!value) continue;
      let state=states.get(name);
      if (!state || state.last!==value) { state={source:value,last:value};states.set(name,state); }
      const translated=languageLabel(state.source,locale);
      if (value!==translated) element.setAttribute(name,translated);
      state.last=translated;
    }
  }
  const descriptions=[...(root.matches(synopsisSelector) ? [root] : []),...root.querySelectorAll(synopsisSelector)];
  for (const element of descriptions) {
    if (!(element instanceof HTMLElement) || !element.textContent.trim()) continue;
    if (!synopsisState.has(element)) {
      synopsisState.set(element,{source:element.textContent,translated:'',attempt:-1});synopses.add(element);intersection.observe(element);
    }
    if (locale==='en') {
      const source=synopsisState.get(element).source;
      if (element.textContent!==source) element.textContent=source;
    } else {
      const rect=element.getBoundingClientRect();
      if (rect.bottom>0 && rect.top<innerHeight) translateSynopsis(element);
    }
  }
}

function mountControl() {
  if (document.getElementById('siteLanguage')) return;
  const host=document.querySelector('.nav-links') || document.querySelector('.landing');
  if (!host) return;
  const control=document.createElement('div');control.id='siteLanguage';control.className='site-language'+(host.matches('.landing') ? ' site-language--landing' : '');
  control.setAttribute('role','group');control.setAttribute('aria-label','Website language');control.setAttribute('translate','no');
  for (const code of ['en','id']) {
    const button=document.createElement('button');button.type='button';button.textContent=code.toUpperCase();button.dataset.locale=code;
    button.setAttribute('aria-label',code==='en' ? 'English' : 'Bahasa Indonesia');
    button.setAttribute('aria-pressed',String(locale===code));button.onclick=()=>select(siteLocale(code));control.append(button);
  }
  const account=host.querySelector('#navAccount');if (account) host.insertBefore(control,account);else host.append(control);
}

function flush() {
  scheduled=false;mountControl();
  const roots=[...dirty];dirty.clear();
  for (const root of roots) if (root.isConnected) scan(root);
  for (const element of synopses) if (!element.isConnected) {synopses.delete(element);intersection.unobserve(element);}
}
function schedule(root) {
  if (root instanceof Element) dirty.add(root);
  if (!scheduled) { scheduled=true;requestAnimationFrame(flush); }
}
/** @param {'en' | 'id'} next */
function select(next) {
  locale=next;generation++;controller.abort();controller=new AbortController();queue.length=0;
  try { localStorage.setItem(key,next); } catch { /* The choice still applies to the current page. */ }
  document.documentElement.lang=next;
  for (const button of document.querySelectorAll('#siteLanguage button[data-locale]')) button.setAttribute('aria-pressed',String(button.getAttribute('data-locale')===next));
  status();schedule(document.body);
}

export function mountSiteLanguage() {
  if (started || location.pathname.startsWith('/admin')) return;
  started=true;
  const stylesheet=document.createElement('link');stylesheet.rel='stylesheet';stylesheet.href='/assets/site-language.css?v=1';document.head.append(stylesheet);
  document.documentElement.lang=locale;
  intersection=new IntersectionObserver(entries=>{for (const entry of entries) if (entry.isIntersecting) translateSynopsis(entry.target);});
  observer=new MutationObserver(records=>{for (const record of records) schedule(record.target instanceof Element ? record.target : record.target.parentElement);});
  observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['placeholder','aria-label','title']});
  document.addEventListener('pointerover',event=>{
    const card=event.target instanceof Element ? event.target.closest('.card') : null;
    const synopsis=card?.querySelector('.tip-syn');if (synopsis instanceof HTMLElement) translateSynopsis(synopsis);
  });
  schedule(document.body);
}
