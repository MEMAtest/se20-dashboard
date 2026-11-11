const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(extra = {}) {
    const store = new Map(); const messages = [];
    const context = { console, AbortSignal, Date, setTimeout, clearTimeout,
        navigator: {}, CONFIG: { DEFAULT_HOME: { lat: 51.405312, lon: -.062353, postcode: 'SE20 7UA', label: 'Home (SE20)', isDefault: true },
            NEARBY: { stationRadius: 2000, busRadius: 500, maxStations: 10, maxBusStops: 4 } },
        localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value) },
        document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null },
        ...extra };
    vm.runInNewContext(fs.readFileSync(require.resolve('../app.js'), 'utf8') + '\nthis.Dashboard = PengeDash;', context);
    const app = Object.create(context.Dashboard.prototype);
    app.loadHome(); app.savedPlaces = []; app.nearbyStations = []; app.nearbyBusStops = [];
    app.detectNearby = async () => ({ stations: [{ name: 'Oxford Circus' }], busStops: [] });
    for (const method of ['cacheData', 'updateHeaderLocation', 'applyHomeToJourney', 'renderSavedPlaces', 'renderNearbyNow', 'updateMap', 'showScreen', '_setLocateBusy']) app[method] = () => {};
    app.refreshAll = async () => {};
    app.updateNearbyLocationUI = text => messages.push(text);
    return { app, context, store, messages };
}

test('phone centring preserves saved home and never caches precise nearby GPS coordinates', async () => {
    const { app, store } = harness(); let cached = 0; app.cacheData = () => cached++;
    await app.relocateToCoords(51.515, -.142);
    assert.equal(app.home.isCurrentLocation, true);
    assert.equal(app.savedHome.postcode, 'SE20 7UA');
    assert.equal(app.homeLabel(), 'Home (SE20)');
    assert.equal(store.has('pengedash-home'), false); assert.equal(cached, 0);
    await app.centerOnHome();
    assert.equal(app.home.lat, app.savedHome.lat); assert.equal(app.home.isCurrentLocation, false);
});

test('a late phone fix cannot override an explicit Home selection', async () => {
    const { app, context } = harness(); context.navigator.geolocation = {};
    let deliver; app._acquirePosition = () => new Promise(resolve => { deliver = resolve; });
    const pending = app.locateMe(); await app.centerOnHome();
    deliver({ coords: { latitude: 51.515, longitude: -.142, accuracy: 10 }, timestamp: Date.now() });
    await pending; assert.equal(app.home.isCurrentLocation, false); assert.equal(app.homeLabel(), 'Home (SE20)');
});

test('Tube-map Home centring does not wait for an unrelated hung global refresh', async () => {
    const { app } = harness(); let centre;
    app.refreshAll = () => new Promise(() => {});
    app._tubeMap = { setView: value => { centre = value; } };
    await Promise.race([app.centerOnHome({ network: true }), new Promise((_, reject) => setTimeout(() => reject(new Error('Home blocked by provider refresh')), 100))]);
    assert.equal(centre[0], app.savedHome.lat); assert.equal(centre[1], app.savedHome.lon);
});

test('an obsolete nearby lookup cannot overwrite a newer area', async () => {
    const { app } = harness(); let first;
    app.detectNearby = () => new Promise(resolve => { first = resolve; });
    const old = app.resolveLocation({ lat: 51.51, lon: -.14 }, { persist: false });
    app.detectNearby = async () => ({ stations: [{ name: 'New area' }], busStops: [] });
    await app.resolveLocation({ lat: 51.405, lon: -.062 }, { persist: false });
    first({ stations: [{ name: 'Old area' }], busStops: [] }); await old;
    assert.equal(app.home.lat, 51.405); assert.equal(app.nearbyStations[0].name, 'New area');
});

test('denied, stale and invalid phone fixes retain the previous area with a visible error', async () => {
    for (const fix of [{ coords: { latitude: NaN, longitude: 0 }, timestamp: Date.now() },
        { coords: { latitude: 51.5, longitude: 0 }, timestamp: Date.now() - 180000 },
        { coords: { latitude: 51.5, longitude: 0 }, timestamp: Date.now() + 60000 }, null]) {
        const { app, context, messages } = harness(); context.navigator.geolocation = {};
        app._acquirePosition = async () => { if (!fix) throw { code: 1 }; return fix; };
        await app.locateMe(); assert.equal(app.home.postcode, 'SE20 7UA');
        assert.match(messages.at(-1), /invalid|denied/);
    }
});

test('nearby-source failure is not a successful empty result', async () => {
    const { app, context } = harness({ fetch: async () => ({ ok: false }) });
    app._tflAuth = () => '';
    await assert.rejects(context.Dashboard.prototype.detectNearby.call(app, 51.5, -.1), /unavailable/);
});

test('nearby modes keep tram stops out of the bus list and expose partial sources', async () => {
    const stops = [{ id: 'tram', commonName: 'Tram', lat: 51.5001, lon: -.1, modes: ['tram'], distance: 2 },
        { id: 'bus', commonName: 'Bus', lat: 51.5002, lon: -.1, modes: ['bus'], distance: 1 }];
    const { app, context } = harness({ fetch: async url => ({ ok: !url.includes('MetroStation'), json: async () => ({ stopPoints: stops }) }) });
    app._tflAuth = () => '';
    const nearby = await context.Dashboard.prototype.detectNearby.call(app, 51.5, -.1);
    assert.equal(nearby.busStops.length, 1); assert.equal(nearby.busStops[0].id, 'bus'); assert.equal(nearby.partial, true);
    assert.equal(app._stationMode({ modes: ['tram'] }), 'tram');
});

test('transport filters preserve mode separation and give Home/Near me accessible names', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    for (const id of ['nearby-home', 'nearby-here', 'tube-map-home', 'tube-map-here', 'nearby-location-status']) assert.ok(html.includes(`id="${id}"`));
    for (const mode of ['all', 'bus', 'tube', 'rail', 'tram']) assert.ok(html.includes(`data-nearby-mode="${mode}"`));
    assert.match(html, /No background tracking/);
});
