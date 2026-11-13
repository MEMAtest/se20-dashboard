const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const G = require('../journey-guidance.js');
const now = Date.parse('2026-11-13T08:00:00Z');
const station = id => ({ id, name: id, lat: 51.5, lon: -.12 });
const tubeLeg = (line = 'Victoria', from = 'Oxford Circus', to = 'Kings Cross') => ({
    mode: { id: 'tube', name: 'Tube' }, duration: 5, instruction: { summary: line + ' line' },
    departurePoint: { commonName: from }, arrivalPoint: { commonName: to }, routeOptions: [{ name: line }],
});
const journey = (start, arrival, duration = 5, legs = [tubeLeg()]) => ({ startDateTime: `2026-11-13T08:${start}:00`,
    arrivalDateTime: `2026-11-13T08:${arrival}:00`, duration, legs });

test('request is bound to selected stations, least-time and next-minute London departure', () => {
    const url = new URL(G.tubeConnectionUrl(station('940GZZLUOXC'), station('940GZZLUKSX'), true, now));
    assert.match(url.pathname, /940GZZLUOXC\/to\/940GZZLUKSX$/);
    assert.equal(url.searchParams.get('mode'), 'tube,walking');
    assert.equal(url.searchParams.get('journeyPreference'), 'leasttime');
    assert.equal(url.searchParams.get('date'), '20261113'); assert.equal(url.searchParams.get('time'), '0801');
    assert.equal(url.searchParams.get('timeIs'), 'Departing');
});

test('Home/phone endpoints use exact coordinates and mixed-mode access by default', () => {
    const url = new URL(G.tubeConnectionUrl({ lat: 51.405312, lon: -.062353 }, station('HUBBRX'), false, now));
    assert.match(decodeURIComponent(url.pathname), /51\.405312,-0\.062353/);
    for (const mode of ['bus', 'tram', 'national-rail', 'tube', 'walking']) assert.ok(url.searchParams.get('mode').split(',').includes(mode));
});

test('invalid/same station and invalid coordinates do not create a provider request', () => {
    const dest = station('940GZZLUOXC');
    for (const origin of [dest, { id: 'https://evil.example' }, { lat: NaN, lon: 0 }, { lat: 100, lon: 0 }, null]) {
        assert.throws(() => G.tubeConnectionUrl(origin, dest));
    }
    assert.throws(() => G.tubeConnectionUrl(dest, { id: 'not-a-station' }));
});

test('quickest means earliest arrival including the initial wait, not shortest ride', () => {
    const later = journey('20', '25', 5, [tubeLeg('Bakerloo')]);
    const sooner = journey('01', '12', 11, [tubeLeg('Victoria')]);
    const routes = G.rankTubeConnections({ journeys: [later, sooner] }, now);
    assert.equal(routes[0].journey, sooner); assert.equal(routes[0].totalMinutes, 12); assert.equal(routes[0].leaveInMinutes, 1);
});

test('walking and changes use provider itinerary legs rather than guessed distances', () => {
    const walk = { mode: { id: 'walking' }, duration: 4 };
    const legs = [walk, tubeLeg('Victoria', 'Brixton', 'Oxford Circus'), { mode: { id: 'walking' }, duration: 2 }, tubeLeg('Central', 'Oxford Circus', 'Bank')];
    const [route] = G.rankTubeConnections({ journeys: [journey('01', '30', 29, legs)] }, now);
    assert.equal(route.walking, 6); assert.equal(route.changes, 1);
    assert.equal(G.rankTubeConnections({ journeys: [journey('01', '30', 29, [{ mode: { id: 'walking' } }, tubeLeg()])] }, now)[0].walking, null);
});

test('non-Tube, departed, malformed and expired routes are not promoted to quickest', () => {
    const invalid = [journey('01', '10', 9, [{ mode: { id: 'bus' } }]), journey('01', '10', 9, [null]),
        journey('01', '10', -1), { ...journey('01', '10'), startDateTime: '2026-11-13T07:59:00' },
        { ...journey('01', '10'), arrivalDateTime: 'bad' }];
    assert.equal(G.rankTubeConnections({ journeys: invalid }, now).length, 0);
    assert.throws(() => G.rankTubeConnections({ toLocationDisambiguation: {} }, now), /confirmed route/);
});

test('Tube-only rejects a bus feeder and identical next trains are not fake route alternatives', () => {
    const mixed = journey('01', '30', 29, [{ mode: { id: 'bus' }, duration: 5 }, tubeLeg()]);
    assert.equal(G.rankTubeConnections({ journeys: [mixed] }, now, true).length, 0);
    const same = [journey('01', '06'), journey('02', '07'), journey('03', '08')];
    const result = G.rankTubeConnections({ journeys: same }, now);
    assert.equal(result.length, 1); assert.equal(result[0].arrival, Date.parse('2026-11-13T08:06:00Z'));
});

test('London timestamp interpretation does not depend on a travelling phone timezone', () => {
    assert.equal(G.tflJourneyInstant('2026-07-13T09:00:00'), Date.parse('2026-07-13T08:00:00Z'));
    assert.equal(G.tflJourneyInstant('2026-11-13T08:00:00'), now);
    assert.equal(G.tflJourneyInstant('2026-07-13T09:00:00+01:00'), Date.parse('2026-07-13T08:00:00Z'));
    assert.ok(Number.isNaN(G.tflJourneyInstant('2026-10-25T01:30:00')));
    assert.ok(Number.isNaN(G.tflJourneyInstant('2026-03-29T01:30:00')));
    assert.ok(Number.isNaN(G.tflJourneyInstant('not-a-date')));
});

function appHarness(fetcher) {
    const nodes = {};
    for (const id of ['tube-route-form', 'tube-route-status', 'tube-route-results', 'tube-route-submit', 'tube-route-from', 'tube-route-to', 'tube-route-tube-only']) {
        nodes[id] = { value: '', checked: false, disabled: false, textContent: '', innerHTML: '', events: {},
            replaceChildren() { this.innerHTML = ''; }, setAttribute(k, v) { this[k] = v; }, addEventListener(k, fn) { this.events[k] = fn; } };
    }
    const timers = new Map(); let count = 0;
    const context = { console, Date, Map, URL, AbortController, JourneyGuidance: G, CONFIG: {}, navigator: {},
        setTimeout: fn => { const id = ++count; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
        document: { addEventListener() {}, getElementById: id => nodes[id] }, fetch: fetcher };
    vm.runInNewContext(fs.readFileSync(require.resolve('../app.js'), 'utf8') + '\nthis.App = PengeDash;', context);
    const app = Object.create(context.App.prototype);
    app._tubeStations = new Map([['940GZZLUOXC', station('940GZZLUOXC')], ['940GZZLUKSX', station('940GZZLUKSX')]]);
    app.escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    app.homeLabel = () => 'Saved Home'; app.savedHome = { lat: 51.405, lon: -.062 };
    app.setupTubeConnections(); nodes['tube-route-from'].value = 'home'; nodes['tube-route-to'].value = '940GZZLUKSX';
    return { app, nodes, timers };
}

test('controller denial never silently substitutes Home or sends a route request', async () => {
    let requests = 0; const { app, nodes } = appHarness(async () => { requests++; });
    nodes['tube-route-from'].value = 'here'; app._acquirePosition = async () => { throw { code: 1 }; };
    await app.findTubeConnection(); assert.equal(requests, 0);
    assert.match(nodes['tube-route-status'].textContent, /No other origin has been substituted/);
    assert.equal(nodes['tube-route-submit'].disabled, false);
});

test('changing a route while a response is pending discards the response and unlocks submit', async () => {
    let finish; const { app, nodes } = appHarness(() => new Promise(resolve => { finish = resolve; }));
    const pending = app.findTubeConnection(); nodes['tube-route-from'].value = 'here'; nodes['tube-route-form'].events.change();
    finish({ ok: true, json: async () => ({ journeys: [] }) }); await pending;
    assert.equal(nodes['tube-route-results'].innerHTML, ''); assert.equal(nodes['tube-route-submit'].disabled, false);
    assert.match(nodes['tube-route-status'].textContent, /Choose your origin/);
});

test('controller reports provider errors without reusing old route cards', async () => {
    const { app, nodes } = appHarness(async () => ({ ok: false }));
    nodes['tube-route-results'].innerHTML = 'old route'; await app.findTubeConnection();
    assert.equal(nodes['tube-route-results'].innerHTML, ''); assert.match(nodes['tube-route-status'].textContent, /unavailable/);
});

test('controller renders a fresh route safely and expires it instead of replaying it later', async () => {
    const start = new Date(Date.now() + 60000).toISOString(), arrival = new Date(Date.now() + 600000).toISOString();
    const leg = tubeLeg('<script>bad()</script>');
    const { app, nodes, timers } = appHarness(async () => ({ ok: true, json: async () => ({ journeys: [{
        startDateTime: start, arrivalDateTime: arrival, duration: 9, legs: [leg],
    }] }) }));
    await app.findTubeConnection();
    assert.match(nodes['tube-route-results'].innerHTML, /Quickest returned connection/);
    assert.match(nodes['tube-route-results'].innerHTML, /&lt;script&gt;/);
    assert.doesNotMatch(nodes['tube-route-results'].innerHTML, /<script>/);
    assert.match(nodes['tube-route-status'].textContent, /Estimates, not guaranteed/);
    assert.equal(nodes['tube-route-submit'].disabled, false);
    assert.equal(timers.size, 1); [...timers.values()][0]();
    assert.equal(nodes['tube-route-results'].innerHTML, ''); assert.match(nodes['tube-route-status'].textContent, /expired/);
});

test('routing form is labelled and is discoverable from Plan and map markers', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    assert.match(html, /id="plan-tube-link"/); assert.match(html, /aria-label="Quickest Tube connection"/);
    for (const id of ['tube-route-from', 'tube-route-to', 'tube-route-tube-only', 'tube-route-submit', 'tube-route-status']) assert.ok(html.includes(`id="${id}"`));
    assert.match(fs.readFileSync(require.resolve('../network-map.js'), 'utf8'), /Quickest route here/);
});

test('network loading populates both route selectors with verified stations and binds map routing', async () => {
    const created = [];
    const node = () => ({ children: [], events: {}, append(...items) { this.children.push(...items); },
        replaceChildren(...items) { this.children = items; }, addEventListener(key, fn) { this.events[key] = fn; } });
    const map = { setView() { return this; }, fitBounds() {}, invalidateSize() {} };
    const layer = () => ({ addTo() { return this; }, bindPopup() { return this; } });
    const context = { Map, AbortSignal, document: { createElement() { const el = node(); created.push(el); return el; } },
        fetch: async url => ({ ok: true, json: async () => ({ lineId: /Line\/([^/]+)/.exec(url)[1],
            lineStrings: ['[[[-0.11,51.46],[-0.12,51.47]]]'],
            stations: [{ id: 'HUBBRX', name: 'Brixton', lat: 51.46, lon: -.11, modes: ['tube'] },
                { id: 'invalid', name: 'Not Tube', lat: 51.46, lon: -.11, modes: ['bus'] }] }) }) };
    vm.runInNewContext(fs.readFileSync(require.resolve('../network-map.js'), 'utf8'), context);
    const from = node(), to = node(); let stations, target;
    await context.JourneyNetworkMap.mount({ element: node(), status: node(), routeFromSelect: from, routeToSelect: to,
        leaflet: { map: () => map, tileLayer: layer, polyline: layer, circleMarker: layer },
        onStations: value => { stations = value; }, onRouteTarget: value => { target = value; } });
    assert.deepEqual(from.children.map(option => option.value), ['here', 'home', 'HUBBRX']);
    assert.deepEqual(to.children.map(option => option.value), ['', 'HUBBRX']);
    assert.equal(stations.length, 1); assert.equal(from.disabled, false); assert.equal(to.disabled, false);
    created.find(el => el.textContent === 'Quickest route here').events.click();
    assert.equal(target.id, 'HUBBRX');
});
