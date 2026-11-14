'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Transit = require('../transit-data.js');
const now = Date.parse('2026-11-11T08:00:00Z');
const station = { crs: 'ANZ', id: '910GANERLEY' };
const response = (data, ok = true, cached = false) => ({ ok, headers: { get: () => cached ? 'true' : null }, json: async () => data });
const prediction = (overrides = {}) => ({ naptanId: station.id, destinationName: 'Highbury & Islington', modeName: 'overground', expectedArrival: '2026-11-11T08:05:00Z', timestamp: '2026-11-11T08:00:00Z', lineName: 'Windrush', ...overrides });
const options = fetcher => ({ fetcher, now, railBase: 'https://rail.example' });

test('working National Rail is preferred and requests bypass HTTP cache', async () => {
    let count = 0;
    const board = await Transit.loadBoard(station, options(async (url, request) => {
        count++; assert.equal(request.cache, 'no-store');
        return response({ lastUpdate: new Date(now).toISOString(), departures: [{ destination: 'Victoria', mins: 5, platform: '1', scheduledTime: '08:05' }] });
    }));
    assert.equal(count, 1); assert.equal(board.partial, false); assert.equal(board.source, 'National Rail');
});

test('rail 503 uses fresh, stop-bound TfL predictions and labels partial coverage', async () => {
    let count = 0;
    const board = await Transit.loadBoard(station, options(async () => ++count === 1 ? response({}, false) : response([prediction()])));
    assert.equal(board.error, false); assert.equal(board.partial, true); assert.equal(board.source, 'TfL');
    assert.equal(board.deps[0].mins, 5); assert.equal(board.deps[0].exp, '08:05');
});

test('stale Kafka timestamp falls back even when HTTP request succeeds', async () => {
    let count = 0;
    const board = await Transit.loadBoard(station, options(async () => ++count === 1
        ? response({ lastUpdate: '2026-11-10T08:00:00Z', departures: [{ destination: 'Old service' }] }) : response([prediction()])));
    assert.equal(board.source, 'TfL'); assert.equal(board.deps[0].dest, 'Highbury & Islington');
});

test('a warming or error payload never certifies an empty live board', async () => {
    for (const data of [{ warming: true, departures: [] }, { error: 'offline', departures: [] }, { departures: [] }]) {
        let count = 0;
        const board = await Transit.loadBoard(station, options(async () => ++count === 1 ? response(data) : response([])));
        assert.equal(board.error, true); assert.deepEqual(board.deps, []);
    }
});

test('expired, wrong-stop, malformed, bus and future-stamped predictions are refused', async () => {
    for (const item of [prediction({ timestamp: '2026-11-10T08:00:00Z' }), prediction({ naptanId: 'WRONG' }), prediction({ expectedArrival: 'invalid' }), prediction({ modeName: 'bus' }), prediction({ timestamp: '2026-11-11T10:00:00Z' })]) {
        let count = 0;
        const board = await Transit.loadBoard(station, options(async () => ++count === 1 ? response({}, false) : response([item])));
        assert.equal(board.error, true);
    }
});

test('Birkbeck fallback uses the verified tram stop, not the National Rail ID', async () => {
    let count = 0;
    const board = await Transit.loadBoard({ crs: 'BIK', id: '910GBIRKBCK', tflId: '940GZZCRBIR' }, options(async url => {
        if (++count === 1) return response({}, false);
        assert.match(url, /940GZZCRBIR\/Arrivals/);
        return response([prediction({ naptanId: '940GZZCRBIR', modeName: 'tram' })]);
    }));
    assert.equal(board.source, 'TfL'); assert.equal(board.partial, true);
});

test('failed refresh never reuses an old successful board', async () => {
    const board = await Transit.loadBoard(station, options(async () => { throw new Error('offline'); }));
    assert.equal(board.error, true); assert.deepEqual(board.deps, []);
});

test('saved boards expire and clock-only rows cannot revive the next day', () => {
    assert.equal(Transit.freshBoard({ at: now, deps: [] }, now), true);
    assert.equal(Transit.freshBoard({ at: now - 91000, deps: [] }, now), false);
    assert.equal(Transit.freshBoard({ at: now + 1, deps: [] }, now), false);
    assert.equal(Transit.freshBoard({ at: now, error: true, deps: [] }, now), false);
});

test('a response marked cached cannot become a live rail board', async () => {
    let count = 0;
    const board = await Transit.loadBoard(station, options(async () => ++count === 1
        ? response({ lastUpdate: new Date(now).toISOString(), departures: [] }, true, true) : response([])));
    assert.equal(board.error, true);
});

test('service worker returns 503 offline instead of a previously cached arrival', async () => {
    const handlers = {}; let cachedReads = 0; let returned;
    const context = { URL, Request, Response, console, TransitData: Transit,
        importScripts() {}, fetch: async () => { throw new Error('offline'); },
        caches: { match: async () => { cachedReads++; return response([prediction()]); } },
        self: { addEventListener: (name, fn) => { handlers[name] = fn; } } };
    vm.runInNewContext(fs.readFileSync(require.resolve('../sw.js'), 'utf8'), context);
    handlers.fetch({ request: { method: 'GET', url: 'https://api.tfl.gov.uk/StopPoint/910GANERLEY/Arrivals' }, respondWith: p => { returned = p; } });
    assert.equal((await returned).status, 503); assert.equal(cachedReads, 0);
});

test('Tube map is a separate labelled panel with an official external fallback', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    assert.match(html, /role="tab"[^>]+aria-controls="network-map-panel"/);
    assert.match(html, /id="network-map-panel"[^>]+hidden/);
    assert.match(html, /aria-label="Zoomable TfL rail network map"/);
    assert.match(html, /https:\/\/content.tfl.gov.uk\/standard-tube-map.pdf/);
    assert.match(html, /not live service status/);
});

test('network geometry preserves geographic axes and rejects malformed coordinates', () => {
    const network = require('../network-map.js');
    assert.deepEqual(network.geometry({ lineStrings: ['[[[-0.12,51.5],[-0.13,51.6]]]'] }), [[[51.5, -0.12], [51.6, -0.13]]]);
    for (const data of [{}, { lineStrings: ['bad json'] }, { lineStrings: ['[[[90,51],[1,52]]]'] }, { lineStrings: ['[[["0",51],[1,52]]]'] }]) assert.throws(() => network.geometry(data));
});

test('network map mounts once, preserves the list, and opens the selected station hub', async () => {
    const nodes = {};
    for (const id of ['network-status-tab', 'network-map-tab', 'network-status-panel', 'network-map-panel', 'tube-map-frame', 'tube-map-status', 'tube-map-station', 'tube-location-status', 'modal-departures']) {
        nodes[id] = { id, events: {}, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; },
            getAttribute(k) { return k === 'aria-controls' ? this.id.replace('-tab', '-panel') : this.attributes[k]; },
            addEventListener(k, v) { this.events[k] = v; }, focus() {} };
    }
    let params, centre; let mounts = 0;
    const context = {
        document: { addEventListener() {}, querySelectorAll: () => [], getElementById: id => nodes[id] }, window: { L: {} }, navigator: {},
        CONFIG: { DEFAULT_HOME: { lat: 51.41, lon: -.05 } },
        JourneyNetworkMap: { tubeLineIds: ['victoria'], mount(options) { mounts++; params = options; return Promise.resolve({ invalidateSize() {}, setView(point) { centre = point; } }); } }
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../app.js'), 'utf8') + '\nthis.Dashboard = PengeDash;', context);
    const app = Object.create(context.Dashboard.prototype);
    app.homeLabel = () => 'Home (SE20)';
    app.stationData = {}; app._fetchStopArrivals = async () => [{ dest: 'Oxford Circus', mins: 3, lineId: 'victoria' }];
    const opened = []; app.openStationHub = station => { opened.push(station); };
    app.setupNetworkMaps();
    nodes['network-map-tab'].events.click(); nodes['network-map-tab'].events.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(Array.from(centre), [51.41, -.05]);
    assert.equal(mounts, 1); assert.equal(nodes['network-status-panel'].hidden, true);
    assert.equal(nodes['network-map-panel'].hidden, false);
    await params.onStation({ id: '940GZZLUBXN', name: 'Brixton', lat: 51.46, lon: -.11 });
    assert.equal(opened[0].id, '940GZZLUBXN');
    assert.equal(opened.length, 1);
    assert.equal(params.multiMode, true);
    nodes['network-status-tab'].events.click();
    assert.equal(nodes['network-map-panel'].hidden, true);
});

test('Tube interchanges such as Brixton are included and non-Tube stops are excluded', () => {
    const network = require('../network-map.js');
    assert.equal(network.stationReference({ id: 'HUBBRX', name: 'Brixton', lat: 51.46, lon: -.11, modes: ['national-rail', 'tube'] }).id, 'HUBBRX');
    assert.equal(network.stationReference({ id: 'HUBBRX', name: 'Brixton', lat: 51.46, lon: -.11, modes: ['national-rail'] }), null);
});
