/* Only DUO's explicit static shell is cached. Account and authentication routes
   are deliberately outside this worker's fetch handling. */
const CACHE_PREFIX = 'duo-ember-shell-';
const CACHE_NAME = `${CACHE_PREFIX}20261101-collection-v17`;
const BASE = new URL('./', self.location.href);
const ASSETS = [
  'index.html', 'style.css', 'app.js', 'audio.js', 'ring.js',
  'appearance.js', 'appearance.css', 'shell.css', 'floating-panels.js', 'touch-controls.js', 'tempo-control.js', 'visual-config.js', 'pwa.js', 'signal-field.js', 'galaxy.js', 'galaxy.css',
  'manifest.webmanifest', 'vendor/Tone.js', 'vendor/three.module.min.js',
  'collection.html', 'collection.css', 'collection.js', 'collection-audio.js',
  'instrument-menu.js', 'instrument-menu.css', 'instruments/catalog.js', 'instruments/kit.js',
  'instruments/carrier.js', 'instruments/cellular.js', 'instruments/census.js',
  'instruments/swarm.js', 'instruments/graticule.js', 'instruments/waveform.js',
  'instruments/geo.js', 'instruments/hand.js', 'instruments/structure.js', 'instruments/granular.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'
].map(path => new URL(path, BASE).href);
const ASSET_SET = new Set(ASSETS);
const INDEX = new URL('index.html', BASE).href;
const COLLECTION = new URL('collection.html', BASE).href;

const validShellResponse = (response, expectedURL) => response && response.ok &&
  response.type !== 'opaque' && !response.redirected &&
  (!response.url || new URL(response.url).pathname === new URL(expectedURL).pathname);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Bound simultaneous downloads and store each response as it arrives, rather
    // than retaining every renderer/audio asset in memory during installation.
    let next=0;
    const results=await Promise.allSettled(Array.from({length:4},async()=>{
      while(next<ASSETS.length){
        const url=ASSETS[next++],response=await fetch(url,{cache:'reload',credentials:'same-origin'});
        if(!validShellResponse(response,url))throw new Error('Instrument shell unavailable');
        await cache.put(url,response);
      }
    }));
    if(results.some(result=>result.status==='rejected')){
      await caches.delete(CACHE_NAME);
      throw new Error('Instrument shell unavailable');
    }
    // Updates wait for an explicit message from an idle instrument.
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_IDLE_UPDATE') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== BASE.origin || url.search) return;
  const isInstrumentNavigation = request.mode === 'navigate' &&
    (url.pathname === BASE.pathname || url.href === INDEX || url.href === COLLECTION);

  if (isInstrumentNavigation) {
    event.respondWith((async () => {
      try {
        // Do not replace the offline shell with a sign-in or other redirect.
        return await fetch(request);
      } catch (error) {
        const cached = await caches.match(url.href === COLLECTION ? COLLECTION : INDEX, {cacheName: CACHE_NAME});
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }

  if (!ASSET_SET.has(url.href)) return;
  event.respondWith((async () => {
    const cached = await caches.match(url.href, {cacheName: CACHE_NAME});
    if (cached) return cached;
    return fetch(request);
  })());
});
