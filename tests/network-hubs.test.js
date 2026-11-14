const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const N = require('../network-map.js');
const G = require('../journey-guidance.js');
const T = require('../transit-data.js');
const ref = { id: '940GZZLUCWR', name: 'Canada Water', lat: 51.498, lon: -.05, modes: ['tube', 'overground', 'bus'] };
const raw = () => ({ id: 'HUBZCW', commonName: 'Canada Water', modes: ref.modes, lat: ref.lat, lon: ref.lon,
    children: [{ id: ref.id }, { id: '910GCNDAW' }],
    lines: [{ id: 'jubilee', name: 'Jubilee' }, { id: 'windrush', name: 'Windrush' }, { id: '188', name: '188' }],
    lineModeGroups: [{ modeName: 'tube', lineIdentifier: ['jubilee'] }, { modeName: 'overground', lineIdentifier: ['windrush'] }, { modeName: 'bus', lineIdentifier: ['188'] }],
    additionalProperties: [{ key: 'Zone', value: '2' }, { key: 'Lifts', value: '4' }] });
const prediction = (overrides = {}) => ({ naptanId: ref.id, modeName: 'tube', lineId: 'jubilee', lineName: 'Jubilee',
    destinationName: 'Stratford', expectedArrival: new Date(Date.now() + 120000).toISOString(), timestamp: new Date().toISOString(), ...overrides });

test('a station hub lists only its provider-reported modes and services', () => {
    const data = raw(); data.lines.reverse();
    const p = N.stationProfile(data, ref);
    assert.deepEqual(p.modes, ['tube', 'overground', 'bus']); assert.equal(p.modes.includes('dlr'), false);
    assert.equal(p.modes.includes('national-rail'), false); assert.equal(p.properties.Lifts, '4'); assert.equal(p.zone, '2');
    assert.deepEqual(p.services.map(s => s.mode), ['tube', 'overground', 'bus']);
    assert.deepEqual(p.arrivalsIds, ['940GZZLUCWR', '910GCNDAW']);
});

test('unrelated station metadata and invalid network coordinates are refused', () => {
    assert.throws(() => N.stationProfile({ ...raw(), id: 'OTHER', children: [] }, ref), /different station/);
    for (const bad of [{ ...ref, lat: NaN }, { ...ref, lon: 100 }, { ...ref, id: '../../secret' }, { ...ref, modes: ['bus'] }])
        assert.equal(N.networkStationReference(bad), null);
    assert.ok(N.networkStationReference({ ...ref, id: '910GCNDAW', modes: ['overground'] }));
    assert.equal(N.stationReference({ ...ref, id: '910GCNDAW', modes: ['overground'] }), null);
});

test('multiple line statuses keep disruption instead of hiding it behind Good Service', () => {
    const s = N.statusSummary({ lineStatuses: [{ statusSeverityDescription: 'Good Service' }, { statusSeverityDescription: 'Minor Delays' }, { statusSeverityDescription: 'Part Closure' }] });
    assert.equal(s.text, 'Part Closure'); assert.equal(s.tone, 'bad'); assert.equal(s.statuses.length, 3);
    assert.equal(N.statusSummary({}).tone, 'unknown'); assert.equal(N.statusSummary({ lineStatuses: [{ statusSeverityDescription: 'Good Service' }] }).tone, 'good');
    assert.equal(N.lineMode({ id: 'windrush' }), 'overground'); assert.equal(N.lineMode({ id: 'elizabeth' }), 'elizabeth-line');
});

test('departure validation refuses wrong stops, buses, stale, malformed and departed predictions', () => {
    const now = Date.now(), good = prediction({ timestamp: new Date(now).toISOString() });
    const data = [good, good, prediction({ naptanId: 'other' }), prediction({ modeName: 'bus' }),
        prediction({ timestamp: new Date(now - 100000).toISOString() }), prediction({ timestamp: new Date(now + 60000).toISOString() }),
        prediction({ expectedArrival: new Date(now - 1).toISOString() }), prediction({ expectedArrival: 'bad' })];
    const verified = N.verifiedArrivals(data, [ref.id], now);
    assert.equal(verified.length, 1); assert.equal(verified[0], good);
    assert.throws(() => N.verifiedArrivals({ error: 'offline' }, [ref.id]), /valid departure/);
});

test('National Rail clipping never draws a fake bridge across omitted route points', () => {
    const path = [[51.4, -.1], [51.5, -.1], [50.8, -.1], [51.6, -.1], [51.7, -.1]];
    const clipped = N.londonRailPaths([path], 'national-rail');
    assert.deepEqual(clipped, [path.slice(0, 2), path.slice(3)]);
    assert.deepEqual(N.londonRailPaths([path], 'tube'), [path]);
});

function harness(fetcher) {
    const nodes = new Map(); const timers = new Map(); const store = new Map(); let timerId = 0;
    const element = id => {
        if (!nodes.has(id)) nodes.set(id, { value: '', innerHTML: '', textContent: '', events: {}, style: {},
            classList: { add() {}, remove() {}, toggle() {} },
            setAttribute(k, v) { this[k] = v; }, addEventListener(k, fn) { this.events[k] = fn; },
            querySelectorAll: () => [], focus() {} });
        return nodes.get(id);
    };
    const context = { console: { log() {}, error() {} }, navigator: {}, Date, Map, AbortSignal, JourneyNetworkMap: N, JourneyGuidance: G, TransitData: T,
        CONFIG: { LIVE_NOW_STATIONS: [], DARWIN_API_URL: 'https://rail.example' }, fetch: fetcher,
        setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
        localStorage: { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v) },
        document: { addEventListener() {}, querySelectorAll: () => [], getElementById: element, createElement: () => ({
            set textContent(value) { this.innerHTML = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
        }) } };
    vm.runInNewContext(fs.readFileSync(require.resolve('../app.js'), 'utf8') + '\nthis.App = PengeDash;', context);
    const app = Object.create(context.App.prototype);
    app.showScreen = name => { app.currentScreen = name; }; app.isFavStation = () => false;
    app.nearbyStations = []; app.favStations = []; app._favLineIds = [];
    return { app, context, element, timers, store };
}
const response = data => ({ ok: true, json: async () => data });
const stationFetch = async url => response(url.endsWith('/Arrivals') ? [prediction()]
    : url.endsWith('/Disruption') ? [] : raw());

test('station controller renders real services, source boundaries and registered facilities safely', async () => {
    const { app, element, timers } = harness(stationFetch);
    await app.openStationHub(ref);
    const html = element('station-hub-content').innerHTML;
    assert.match(html, /Station hub · Zone 2/); assert.match(html, /Overground/); assert.match(html, /Stratford/);
    assert.doesNotMatch(html, /DLR|Southern|Check National Rail live departures/); assert.match(html, /does not confirm it is operating/);
    assert.match(html, /Step-free route/); assert.match(html, /Check official station guidance/);
    assert.equal(timers.size, 1);
    timers.values().next().value(); assert.match(element('hub-live-rows').textContent, /expired/);
});

test('provider errors remain partial or unavailable and never replay an old board', async () => {
    const { app, element } = harness(async url => url.endsWith('/Arrivals') || url.endsWith('/Disruption') ? { ok: false } : response(raw()));
    element('hub-live-rows').textContent = 'old board'; await app.openStationHub(ref);
    const html = element('station-hub-content').innerHTML;
    assert.match(html, /partial coverage/); assert.match(html, /No verified upcoming predictions/); assert.match(html, /source unavailable/);
});

test('mismatched provider station metadata produces a retry state, not a false hub', async () => {
    const { app, element } = harness(async () => response({ ...raw(), id: 'wrong', children: [] }));
    await app.openStationHub(ref); assert.match(element('station-hub-content').innerHTML, /could not be verified/);
    assert.equal(typeof element('hub-retry').onclick, 'function');
});

test('late station responses cannot replace a more recently chosen station', async () => {
    let finish; const { app, element } = harness(() => new Promise(resolve => { finish = resolve; }));
    const pending = app.openStationHub(ref);
    app._networkJson = async path => path.includes('/Arrivals') || path.includes('/Disruption') ? [] : ({
        id: '940GZZLUOXC', commonName: 'Oxford Circus', modes: ['tube'], children: [] });
    await app.openStationHub({ ...ref, id: '940GZZLUOXC', name: 'Oxford Circus', modes: ['tube'] });
    finish(response(raw())); await pending;
    assert.match(element('station-hub-content').innerHTML, /Oxford Circus/);
    assert.doesNotMatch(element('station-hub-content').innerHTML, /Canada Water/);
});

test('line filters and favourites preserve provider text escaping and mode separation', () => {
    const { app, element, store } = harness();
    app._networkStatusSource = 'cached'; app._renderNetworkLines = () => {};
    app._toggleLineFavourite('windrush'); assert.equal(JSON.parse(store.get('pengedash-fav-lines'))[0], 'windrush');
    app._toggleLineFavourite('windrush'); assert.equal(JSON.parse(store.get('pengedash-fav-lines')).length, 0);
    delete app._renderNetworkLines;
    app._networkLines = [{ id: 'central', name: '<script>bad()</script>', modeName: 'tube', lineStatuses: [{ statusSeverityDescription: '<script>bad()</script>' }] },
        { id: 'windrush', name: 'Windrush', modeName: 'overground' }];
    app.networkMode = 'tube'; app._renderNetworkLines();
    assert.match(element('line-statuses').innerHTML, /&lt;script&gt;/); assert.doesNotMatch(element('line-statuses').innerHTML, /<script>|Windrush/);
    assert.match(element('network-source-status').textContent, /Cached/);
});

test('leaving a station while predictions are pending prevents later publication', async () => {
    const { app, element } = harness(stationFetch); let finish;
    const gate = new Promise(resolve => { finish = resolve; });
    app._networkJson = async path => path.endsWith('/Arrivals') ? gate : path.endsWith('/Disruption') ? [] : raw();
    const pending = app.openStationHub(ref); await new Promise(resolve => setImmediate(resolve));
    app.currentScreen = 'lines'; app._hubRevision++;
    finish([prediction()]); await pending;
    assert.doesNotMatch(element('station-hub-content').innerHTML, /Next departures/);
});

test('station disruption is network-only in the service-worker routing policy', () => {
    assert.equal(T.isLiveUrl(new URL('https://api.tfl.gov.uk/StopPoint/940GZZLUCWR/Disruption')), true);
    assert.equal(T.isLiveUrl(new URL('https://api.tfl.gov.uk/StopPoint/940GZZLUCWR')), false);
});

test('UI references are represented by actual network filters, hub sections and official schematic link', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    for (const mode of ['all', 'tube', 'overground', 'dlr', 'elizabeth-line', 'tram', 'national-rail', 'favourites']) assert.ok(html.includes(`data-network-mode="${mode}"`));
    for (const id of ['screen-line', 'screen-station', 'station-hub-content', 'line-detail-content', 'network-legend']) assert.ok(html.includes(`id="${id}"`));
    assert.ok(html.includes('official schematic Tube map')); assert.ok(html.includes('not the entire UK'));
});

test('multimode map filters layers and hub choices without contaminating Tube-only route pickers', async () => {
    const node = () => ({ children: [], events: {}, value: '', append(...c) { this.children.push(...c); },
        replaceChildren(...c) { this.children = c; }, addEventListener(k, f) { this.events[k] = f; } });
    const active = new Set(), map = { setView() { return this; }, fitBounds() {}, invalidateSize() {}, addLayer(l) { active.add(l); }, removeLayer(l) { active.delete(l); } };
    const layer = () => ({ addTo(m) { m.addLayer?.(this); return this; }, bindPopup() { return this; } });
    const context = { Map, Set, AbortSignal, document: { createElement: node }, fetch: async url => {
        const id = /Line\/([^/]+)/.exec(url)[1], definition = N.networkLines.find(d => d[0] === id);
        const mode = definition[2];
        return response({ lineId: id === 'southern' ? 'wrong-line' : id, lineStrings: ['[[[-0.1,51.4],[-0.12,51.5]]]'],
            stations: [{ id: (mode === 'tube' ? '940G' : '910G') + id.replace(/-/g, ''), name: id, modes: [mode], lat: 51.5, lon: -.12 }] });
    } };
    vm.runInNewContext(fs.readFileSync(require.resolve('../network-map.js'), 'utf8'), context);
    const status = node(), stations = node(), from = node(), to = node(); let tube, all;
    const mounted = await context.JourneyNetworkMap.mount({ element: node(), status, stationSelect: stations, routeFromSelect: from, routeToSelect: to, multiMode: true,
        leaflet: { map: () => map, tileLayer: layer, layerGroup: layer, polyline: layer, circleMarker: layer },
        onStation() {}, onStations: s => { tube = s; }, onNetworkStations: s => { all = s; } });
    assert.equal(tube.length, 11); assert.equal(all.length, 22); assert.equal(to.children.length, 12);
    mounted.setMode('dlr'); assert.equal(stations.children.length, 2); assert.match(stations.children[1].textContent, /dlr/);
    assert.match(status.textContent, /1 of 1/); assert.equal(to.children.length, 12);
    mounted.setMode('national-rail'); assert.match(status.textContent, /2 of 3/); assert.match(status.textContent, /no available map geometry/);
    mounted.setMode('favourites', ['avanti-west-coast']); assert.match(status.textContent, /no available map geometry/);
});

test('short bus line IDs survive station connection normalization', () => {
    const data = raw(); data.lines.push({ id: '1', name: '1' }); data.lineModeGroups.push({ modeName: 'bus', lineIdentifier: ['1'] });
    assert.equal(N.stationProfile(data, ref).services.find(l => l.id === '1').mode, 'bus');
});

test('changing a mode fits its routes instead of retaining the previous network zoom', () => {
    const { app, context, element } = harness();
    const button = element('dlr-mode'); button.dataset = { networkMode: 'dlr' };
    context.document.querySelectorAll = () => [button];
    app._renderNetworkLines = () => {};
    const calls = [];
    app._tubeMap = { setMode: mode => calls.push(mode), fitRoutes: () => calls.push('fit') };
    app.setupNetworkUI(); button.events.click();
    assert.deepEqual(calls, ['dlr', 'fit']);
    assert.match(element('tube-location-status').textContent, /Showing DLR routes/);
    assert.equal(button['aria-pressed'], 'true');
});

test('National Rail station hubs bind the fresh board to the requested CRS', async () => {
    for (const crs of ['NWD', 'PNW']) {
        const station = { ...ref, id: '910GNORWDJ', name: 'Norwood Junction', modes: ['national-rail'] };
        const data = { ...raw(), id: station.id, commonName: station.name, modes: station.modes, children: [] };
        const { app, context, element } = harness(async url => new Response(JSON.stringify(url.includes('/api/board') ? {
            station: { crs }, source: 'huxley', departures: [{ destination: 'London Bridge', platform: '3', mins: 7 }]
        } : url.endsWith('/Arrivals') || url.endsWith('/Disruption') ? [] : data), { status: 200, headers: { 'content-type': 'application/json' } }));
        context.CONFIG.LIVE_NOW_STATIONS = [{ ...station, crs: 'NWD' }];
        await app.openStationHub(station);
        const html = element('station-hub-content').innerHTML;
        if (crs === 'NWD') { assert.match(html, /London Bridge/); assert.match(html, /Platform 3/); }
        else { assert.match(html, /verified National Rail board is not available/); assert.doesNotMatch(html, /Platform 3/); }
    }
});

test('late line directory responses cannot replace another selected line', async () => {
    let finish; const { app, element } = harness(() => new Promise(resolve => { finish = resolve; }));
    app.lineDetails = { southern: { name: 'Southern', status: 'Good Service', mode: 'national-rail', raw: { lineStatuses: [{ statusSeverityDescription: 'Good Service' }] } } };
    const pending = app.openLineDetail('southern'); app.currentScreen = 'lines'; app._lineRevision++;
    finish(response([{ ...ref, name: 'A late station' }])); await pending;
    assert.doesNotMatch(element('line-detail-content').innerHTML, /A late station/);
});

test('an app left open overnight expires departed route cards rather than saying Just now', () => {
    const { app, element } = harness(); app.currentScreen = 'plan';
    app._lastJourneys = [{ startDateTime: new Date(Date.now() - 3600000).toISOString() }];
    app._ageRouteOptions();
    assert.equal(app._lastJourneys, null); assert.match(element('journey-results').innerHTML, /departure times have passed/);
    assert.equal(element('journey-updated').textContent, 'Route options expired');
});

test('route ageing hides departed choices while keeping future alternatives', () => {
    const { app, element } = harness(); app.currentScreen = 'plan'; app._journeyResultsCheckedAt = Date.now() - 60000;
    const cards = [{ dataset: { index: '0' } }, { dataset: { index: '1' } }];
    element('journey-results').querySelectorAll = () => cards;
    app._lastJourneys = [{ startDateTime: new Date(Date.now() - 60000).toISOString() }, { startDateTime: new Date(Date.now() + 60000).toISOString() }];
    app._ageRouteOptions(); assert.equal(cards[0].hidden, true); assert.equal(cards[1].hidden, false);
    assert.match(element('journey-updated').textContent, /estimates/);
});

test('ageing old cards never cancels an in-flight replan or active journey view', () => {
    const { app, element } = harness(); app.currentScreen = 'plan';
    app._lastJourneys = [{ startDateTime: new Date(Date.now() - 60000).toISOString() }];
    element('journey-results').classList.contains = () => true; app._ageRouteOptions(); assert.ok(app._lastJourneys);
    element('journey-results').classList.contains = () => false; app.currentScreen = 'journey-live';
    app._ageRouteOptions(); assert.ok(app._lastJourneys);
});
