const selector = '.card-poster img,.rank-row img,.miruro-side-card img,.miruro-poster-card img,.history-media img,.search-result-image';
export function mountImageLoading() {
  document.documentElement.classList.add('image-loading-enabled');
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/assets/image-loading.css?v=1'; document.head.append(css);
  const ready = image => {
    const fallback = image.getAttribute('src')?.split('?')[0] === '/favicon.svg', loaded = image.naturalWidth>0 && !fallback;
    image.classList.remove('image-pending'); image.classList.toggle('image-ready',loaded); image.classList.toggle('image-unavailable',!loaded);
  };
  const prepare = image => {
    if (image.complete) ready(image);
    else {image.classList.add('image-pending');image.classList.remove('image-ready','image-unavailable');}
  };
  const scan = node => {
    if (!(node instanceof Element)) return;
    if (node.matches(selector)) prepare(node);
    node.querySelectorAll(selector).forEach(prepare);
  };
  document.addEventListener('load',event => { if (event.target instanceof HTMLImageElement && event.target.matches(selector)) ready(event.target); },true);
  document.addEventListener('error',event => { if (event.target instanceof HTMLImageElement && event.target.matches(selector)) ready(event.target); },true);
  new MutationObserver(changes => changes.forEach(change => change.addedNodes.forEach(scan))).observe(document.body,{childList:true,subtree:true});
  scan(document.body);
}
