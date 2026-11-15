const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const N = require('../network-map.js');
const bundle = require('../tube-network.js');

test('bundled Tube snapshot has all 11 lines and every ordered endpoint, not 23 optional feeds', () => {
    assert.equal(bundle.datasets.length, 11);
    assert.deepEqual(bundle.datasets.map(d => d.definition[0]), N.tubeLineIds);
    assert.ok(Number.isFinite(Date.parse(bundle.retrievedAt)));
    for (const { data, definition } of bundle.datasets) {
        assert.equal(data.lineId, definition[0]); assert.equal(definition[2], 'tube');
        assert.ok(data.orderedLineRoutes.length);
        const ids = new Set(data.stations.map(s => s.id));
        for (const s of data.stations) assert.ok(N.networkStationReference(s));
        for (const route of data.orderedLineRoutes) for (const id of route.naptanIds) assert.ok(ids.has(id), id);
    }
    const diagram = N.schematicLayout(bundle.datasets);
    assert.equal(diagram.stations.size, 270);
    for (const name of ['North Greenwich', 'Victoria', 'London Bridge', 'Battersea Power Station']) {
        assert.ok([...diagram.stations.values()].some(s => s.name === name));
    }
    assert.deepEqual([...new Set(diagram.edges.map(e => e.id))].sort(), [...N.tubeLineIds].sort());
});

function mountHarness() {
    const node = () => ({ children: [], events: {}, value: '', append(...items) { this.children.push(...items); },
        replaceChildren(...items) { this.children = items; }, addEventListener(k, fn) { this.events[k] = fn; } });
    const map = { setView(point, zoom) { this.center = point; this.zoom = zoom; return this; },
        fitBounds(paths) { this.bounds = paths; this.setView(paths[0], -5); }, invalidateSize() {} };
    const layer = () => ({ addTo() { return this; }, bindPopup() { return this; } });
    let fetches = 0, mapOptions;
    const context = { Map, AbortSignal, document: { createElement: node }, fetch: () => { fetches++; throw new Error('offline'); } };
    vm.runInNewContext(fs.readFileSync(require.resolve('../network-map.js'), 'utf8'), context);
    return { mount: context.JourneyNetworkMap.mount, map, node, get fetches() { return fetches; }, get options() { return mapOptions; },
        leaflet: { map: (_, options) => { mapOptions = options; return map; }, polyline: layer, circleMarker: layer } };
}

test('Tube map and both selectors work with every topology feed offline and no fetch attempts', async () => {
    const h = mountHarness(), from = h.node(), to = h.node(), status = h.node(); let stations;
    const map = await h.mount({ initialData: bundle, element: h.node(), status, routeFromSelect: from, routeToSelect: to,
        leaflet: h.leaflet, onStations: s => { stations = s; } });
    assert.equal(h.fetches, 0); assert.equal(stations.length, 270);
    assert.equal(from.disabled, false); assert.equal(to.disabled, false);
    assert.match(status.textContent, /11 of 11/);
    assert.ok(h.options.minZoom <= -6, 'Whole network must fit even on narrow screens');
    map.fitRoutes(); assert.ok(map.bounds.length > 500); assert.equal(map.zoom, -5);
    map.showCentral(); assert.equal(map.bounds.length, 2); assert.equal(map.center[0], -1450);
    assert.equal(map.center[1], -300, 'Leaflet diagram framing must not be converted as GPS');
    map.focusLocation([51.5007, .003]); assert.equal(map.focusedStation, 'North Greenwich');
});

test('an incomplete or duplicated bundled network cannot masquerade as a complete Tube map', async () => {
    const h = mountHarness();
    for (const datasets of [bundle.datasets.slice(1), [...bundle.datasets.slice(0, 10), bundle.datasets[0]]]) {
        await assert.rejects(h.mount({ element: h.node(), status: h.node(), leaflet: h.leaflet, initialData: { datasets } }), /incomplete/);
    }
    assert.equal(h.fetches, 0);
});

test('Tube is a dedicated navigable screen, route form is not a collapsed disclosure, bundle is cached and staged', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const page = html.split('id="screen-tube"')[1].split('id="screen-line"')[0];
    assert.match(page, /id="quick-tube-map"/); assert.match(page, /id="tube-route-form"/);
    assert.doesNotMatch(page, /<details id="tube-planner-details"/);
    assert.equal((html.match(/id="tube-route-form"/g) || []).length, 1);
    assert.match(html, /data-screen="tube"/);
    for (const path of ['../sw.js', '../scripts/stage-assets.mjs', '../.assetsignore']) {
        assert.match(fs.readFileSync(require.resolve(path), 'utf8'), /tube-network\.js/);
    }
    assert.match(fs.readFileSync(require.resolve('../app.js'), 'utf8'), /window\.location\.hash === '#tube'/);
});
