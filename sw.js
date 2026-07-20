// Penge Dash SE20 - Service Worker
const CACHE_VERSION = 'v21';
const TILE_CACHE = 'penge-dash-tiles-v1';
const MAX_TILES = 300;
const CACHE_NAME = `penge-dash-${CACHE_VERSION}`;
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/config.js',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png',
    '/icon.svg'
];

// Install - cache static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate - clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME && key !== TILE_CACHE)
                    .map(key => {
                        console.log('[SW] Deleting old cache:', key);
                        return caches.delete(key);
                    })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch - stale-while-revalidate for static, network-first for API
self.addEventListener('fetch', event => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);

    // OSM map tiles — cache-first with a capped tile cache (immutable, fail-soft offline)
    if (url.hostname.includes('tile.openstreetmap.org')) {
        event.respondWith(
            caches.open(TILE_CACHE).then(async cache => {
                const cached = await cache.match(event.request);
                if (cached) return cached;
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
            caches.match(event.request).then(cached => {
                if (cached) return cached;
                return fetch(event.request).then(response => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    return response;
                }).catch(() => new Response('', { status: 504 }));
            })
        );
        return;
    }

    // For API requests, try network first with cache fallback
    if (url.hostname.includes('api.tfl.gov.uk') ||
        url.hostname.includes('api.open-meteo.com') ||
        url.hostname.includes('api.postcodes.io') ||
        url.hostname.includes('railway-tlmc.onrender.com')) {
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
                    const cached = await caches.match(event.request);
                    if (cached) {
                        console.log('[SW] Serving cached API response:', event.request.url);
                        return cached;
                    }
                    // Return empty response if nothing cached
                    return new Response(JSON.stringify({ error: 'offline' }), {
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
            caches.match(event.request).then(cached => {
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
        caches.match(event.request)
            .then(cached => {
                if (cached) {
                    // Return cached, but also fetch in background to update
                    fetch(event.request).then(response => {
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, response);
                        });
                    }).catch(() => {});
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
