// Penge Dash SE20 - Service Worker
const CACHE_NAME = 'penge-dash-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/config.js',
    '/manifest.json'
];

// Install - cache static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate - clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch - network first, fallback to cache
self.addEventListener('fetch', event => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // For API requests, try network only (no caching)
    if (event.request.url.includes('api.tfl.gov.uk') ||
        event.request.url.includes('api.openweathermap.org')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // For static assets, use cache-first strategy
    event.respondWith(
        caches.match(event.request)
            .then(cached => {
                const networked = fetch(event.request)
                    .then(response => {
                        // Update cache with fresh version
                        const clone = response.clone();
                        caches.open(CACHE_NAME)
                            .then(cache => cache.put(event.request, clone));
                        return response;
                    })
                    .catch(() => cached);

                return cached || networked;
            })
    );
});
