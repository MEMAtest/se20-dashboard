// Penge Dash SE20 - Service Worker
const RELEASE_VERSION = '__JOURNEY_RELEASE__';
const CACHE_VERSION = `web-${RELEASE_VERSION}`;
importScripts('/transit-data.js?v=__JOURNEY_RELEASE__');
const TILE_CACHE = 'penge-dash-tiles-v1';
const MAX_TILES = 300;
const CACHE_NAME = `penge-dash-${CACHE_VERSION}`;
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles.css?v=__JOURNEY_RELEASE__',
    '/app.js?v=__JOURNEY_RELEASE__',
    '/app-updates.js?v=__JOURNEY_RELEASE__',
    '/journey-guidance.js?v=__JOURNEY_RELEASE__',
    '/transit-data.js?v=__JOURNEY_RELEASE__',
    '/network-map.js?v=__JOURNEY_RELEASE__',
    '/tube-network.js?v=__JOURNEY_RELEASE__',
    '/tube-map.js?v=__JOURNEY_RELEASE__',
    '/tube-search.js?v=__JOURNEY_RELEASE__',
    '/familiar-tube.svg?v=__JOURNEY_RELEASE__',
    '/TUBE-MAP-LICENCE.txt',
    '/config.js?v=__JOURNEY_RELEASE__',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png',
    '/icon.svg'
];

// A cached no-CORS response cannot satisfy a later CORS/SRI request for
// Leaflet or a font. Cache keys alone do not distinguish those request modes.
async function compatibleCacheMatch(request) {
    const cached = await caches.match(request);
    return cached?.type === 'opaque' && request.mode !== 'no-cors' ? null : cached;
}

// Install - cache static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Caching static assets');
                return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })));
            })
            .then(() => self.skipWaiting())
    );
});

// Activate - clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        self.clients.claim().then(async () => {
            const retained=new Set([CACHE_NAME,TILE_CACHE]);let legacyPending=false;
            const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
            await Promise.all(windows.filter(client=>{try{const page=new URL(client.url);return page.origin===self.location.origin&&['/','/index.html'].includes(page.pathname);}catch{return false;}}).map(client=>new Promise(resolve=>{
                const channel=new MessageChannel();
                const done=()=>{clearTimeout(timer);channel.port1.close();resolve();};
                const timer=setTimeout(async()=>{
                    channel.port1.close();
                    // One-time bridge for older installed web shells without an update listener.
                    try{await client.navigate(client.url);}catch{legacyPending=true;}
                    resolve();
                },3000);
                channel.port1.onmessage=event=>{
                    if(event.data?.type==='JOURNEY_UPDATE_HANDLED') {
                        if(typeof event.data.version==='string'&&/^[a-z0-9][a-z0-9._-]{0,63}$/.test(event.data.version))retained.add(`penge-dash-web-${event.data.version}`);
                        else legacyPending=true;
                        done();
                    }
                };
                try{client.postMessage({type:'JOURNEY_RELEASE_READY',version:RELEASE_VERSION},[channel.port2]);}catch{done();}
            })));
            const keys=await caches.keys();
            if(legacyPending){const previous=keys.filter(k=>k.startsWith('penge-dash-')&&!retained.has(k)).at(-1);if(previous)retained.add(previous);}
            await Promise.all(keys.filter(key=>key.startsWith('penge-dash-')&&!retained.has(key)).map(key=>caches.delete(key)));
        })
    );
});

// Fetch - stale-while-revalidate for static, network-first for API
self.addEventListener('fetch', event => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);

    if(url.origin===self.location?.origin&&(url.pathname==='/app-release.json'||url.pathname==='/sw.js')) {
        event.respondWith(fetch(event.request,{cache:'no-store'}));return;
    }
    if(event.request.mode==='navigate'&&url.origin===self.location?.origin&&['/','/index.html'].includes(url.pathname)) {
        event.respondWith((async()=>{
            try {
                const response=await fetch(event.request,{cache:'no-store'});
                if(!response.ok)throw new Error('navigation unavailable');
                const cache=await caches.open(CACHE_NAME);await cache.put('/index.html',response.clone());return response;
            } catch {
                const cache=await caches.open(CACHE_NAME);
                return await cache.match('/index.html') || new Response('Journey is offline and has no saved app shell.',{status:503,headers:{'Content-Type':'text/plain'}});
            }
        })());return;
    }

    // OSM map tiles — cache-first with a capped tile cache (immutable, fail-soft offline)
    if (url.hostname.includes('tile.openstreetmap.org')) {
        event.respondWith(
            caches.open(TILE_CACHE).then(async cache => {
                const cached = await cache.match(event.request);
                if (cached && (cached.type !== 'opaque' || event.request.mode === 'no-cors')) return cached;
                try {
                    const response = await fetch(event.request);
                    cache.put(event.request, response.clone());
                    // Trim cache opportunistically
                    cache.keys().then(keys => {
                        if (keys.length > MAX_TILES) cache.delete(keys[0]);
                    });
                    return response;
                } catch (e) {
                    return new Response('', { status: 504 });
                }
            })
        );
        return;
    }

    // Leaflet from unpkg — cache-first (versioned, immutable)
    if (url.hostname.includes('unpkg.com')) {
        event.respondWith(
            compatibleCacheMatch(event.request).then(cached => {
                if (cached) {
                    // Keep the pinned map dependency with the new shell before retiring its older cache.
                    return caches.open(CACHE_NAME).then(async cache=>{try{await cache.put(event.request,cached.clone());}catch{}return cached;});
                }
                return fetch(event.request).then(response => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    return response;
                }).catch(() => new Response('', { status: 504 }));
            })
        );
        return;
    }

    // Never replay a cached prediction or board as current travel information.
    if ((url.hostname === 'api.tfl.gov.uk' || url.hostname === 'rail-89-167-95-173.sslip.io')
        && TransitData.isLiveUrl(url)) {
        event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => new Response(
            JSON.stringify({ error: 'live_data_unavailable' }),
            { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
        )));
        return;
    }

    // Static lookup APIs may still fall back to cached data.
    if (url.hostname.includes('api.tfl.gov.uk') ||
        url.hostname.includes('api.open-meteo.com') ||
        url.hostname.includes('api.postcodes.io') ||
        url.hostname.includes('rail-89-167-95-173.sslip.io')) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Clone and cache the response
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, clone);
                    });
                    return response;
                })
                .catch(async () => {
                    // Network failed, try cache
                    const cached = await compatibleCacheMatch(event.request);
                    if (cached) {
                        console.log('[SW] Serving cached API response:', event.request.url);
                        return cached;
                    }
                    // Return empty response if nothing cached. Status 503 (not the
                    // default 200) so callers' `res.ok` check actually reflects that
                    // this failed — a 200 here previously let a backend-down state
                    // be read as a real (empty) board, i.e. "no trains running",
                    // which is a false negative rather than an honest error.
                    return new Response(JSON.stringify({ error: 'offline' }), {
                        status: 503,
                        headers: { 'Content-Type': 'application/json' }
                    });
                })
        );
        return;
    }

    // For fonts (Google Fonts), cache with stale-while-revalidate
    if (url.hostname.includes('fonts.googleapis.com') ||
        url.hostname.includes('fonts.gstatic.com')) {
        event.respondWith(
            compatibleCacheMatch(event.request).then(cached => {
                const fetching = fetch(event.request).then(response => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    return response;
                }).catch(() => cached);

                return cached || fetching;
            })
        );
        return;
    }

    // For static assets, use cache-first with network fallback
    event.respondWith(
        compatibleCacheMatch(event.request)
            .then(cached => {
                if (cached) {
                    // Versioned URLs are immutable within a release; never overwrite them with another build.
                    return cached;
                }

                // Not in cache, fetch from network
                return fetch(event.request).then(response => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    return response;
                });
            })
    );
});

// Handle messages from main thread
self.addEventListener('message', event => {
    if(event.data?.type==='JOURNEY_VERSION')event.ports?.[0]?.postMessage({version:RELEASE_VERSION});
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
});

// ---- Web push: show platform-change / cancellation alerts ----
self.addEventListener('push', event => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'Journey', body: event.data && event.data.text() }; }
    const title = data.title || 'Journey';
    event.waitUntil(self.registration.showNotification(title, {
        body: data.body || '',
        tag: data.tag || 'journey',
        renotify: true,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url: data.url || '/' }
    }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            for (const c of list) { if ('focus' in c) return c.focus(); }
            if (clients.openWindow) return clients.openWindow(url);
        })
    );
});
