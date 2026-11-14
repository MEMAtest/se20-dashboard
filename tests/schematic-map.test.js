const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const N = require('../network-map.js');
const stop = (id, name, extra = {}) => ({ id, name, lat: 51.51, lon: -.12, modes: ['tube'], ...extra });
const a = stop('HUBTCR', 'Tottenham Court Road');
const aChild = stop('940GZZLUTCR', 'Tottenham Court Road Underground Station', { topMostParentId: 'HUBTCR' });
const b = stop('940GZZLUHBN', 'Holborn Underground Station', { lon: -.11 });
const c = stop('940GZZLUCYL', 'Chancery Lane Underground Station', { lon: -.10 });
const dataset = (id = 'central', ids = [aChild.id, b.id, c.id]) => ({ definition: [id, '#e32017', 'tube'], data: {
    stations: [a, b, c], stopPointSequences: [{ stopPoint: [aChild, b, c] }], orderedLineRoutes: [{ naptanIds: ids }, { naptanIds: [...ids].reverse() }]
} });

test('schematic edges follow ordered station IDs, not alphabetic or geographic order', () => {
    const scene = N.schematicLayout([dataset()]);
    assert.equal(scene.edges.length, 2);
    assert.deepEqual(scene.edges.map(e => [e.a.id, e.b.id]), [[a.id, b.id], [b.id, c.id]]);
    assert.ok(scene.edges.every(e => e.path.length === 3));
});

test('child station IDs resolve to the actual TfL parent without dropping interchange edges', () => {
    const scene = N.schematicLayout([dataset(), dataset('northern', [aChild.id, c.id])]);
    assert.equal(scene.stations.has(aChild.id), false);
    assert.deepEqual(scene.stations.get(a.id).lineIds, ['central', 'northern']);
    assert.equal(scene.edges.filter(e => e.a.id === a.id).length, 2);
});

test('unknown intermediate IDs never produce an invented direct connection', () => {
    const scene = N.schematicLayout([dataset('central', [aChild.id, 'UNKNOWN', c.id])]);
    assert.equal(scene.edges.length, 0);
});

test('schematic layout leaves navigation coordinates intact and separate from diagram positions', () => {
    const original = JSON.stringify(dataset()), scene = N.schematicLayout([dataset()]);
    const station = scene.stations.get(a.id);
    assert.equal(station.lat, a.lat); assert.equal(station.lon, a.lon);
    assert.equal(station.x, 970); assert.equal(station.y, 480);
    assert.equal(JSON.stringify(dataset()), original);
});

test('every diagram segment is horizontal, vertical or 45 degrees', () => {
    for (const [a, b] of [[{ x: 10, y: 40 }, { x: 200, y: 100 }], [{ x: 300, y: 500 }, { x: 20, y: 90 }], [{ x: 0, y: 0 }, { x: 0, y: 200 }]]) {
        const points = N.schematicPath(a, b);
        for (let i = 1; i < points.length; i++) {
            const dx = Math.abs(points[i][1] - points[i - 1][1]), dy = Math.abs(points[i][0] - points[i - 1][0]);
            assert.ok(dx === 0 || dy === 0 || dx === dy);
        }
    }
});

test('parallel services retain distinct paths rather than painting over one another', () => {
    const scene = N.schematicLayout([dataset(), dataset('district')]);
    const shared = scene.edges.filter(e => e.pair === [a.id, b.id].sort().join('|'));
    assert.equal(shared.length, 2); assert.notDeepEqual(shared[0].path, shared[1].path);
});

test('network response completion order cannot shuffle the diagram', () => {
    const data = [dataset('district'), dataset('central')];
    const select = scene => [...scene.stations.values()].map(s => [s.id, s.x, s.y]);
    assert.deepEqual(select(N.schematicLayout(data)), select(N.schematicLayout([...data].reverse())));
});

test('missing topology is rejected rather than quietly reverting to a street map', () => {
    assert.throws(() => N.schematicLayout([{ definition: ['central', '#f00', 'tube'], data: { stations: [a, b] } }]), /topology/);
    const source = fs.readFileSync(require.resolve('../network-map.js'), 'utf8');
    assert.doesNotMatch(source, /tileLayer|openstreetmap|tile\.openstreetmap/);
    assert.match(source, /CRS\?\.Simple/);
});

test('Tube is selected by default and the diagram is explicitly not a geographic distance map', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    assert.match(html, /data-network-mode="tube" aria-pressed="true"/);
    assert.match(html, /data-network-mode="all" aria-pressed="false"/);
    assert.match(html, /Zoomable schematic Tube and rail map/);
    assert.match(html, /Not to scale/);
});

test('later rail metadata cannot rename or move an existing Tube interchange', () => {
    const rail = { definition: ['thameslink', '#f0a', 'national-rail'], data: {
        stations: [{ ...a, name: 'Different rail label', lat: 51.52, lon: -.13, modes: ['national-rail'] }, c],
        orderedLineRoutes: [{ naptanIds: [a.id, c.id] }]
    } };
    const station = N.schematicLayout([rail, dataset()]).stations.get(a.id);
    assert.equal(station.name, a.name); assert.equal(station.lat, a.lat); assert.equal(station.x, 970);
});

test('horizontal labels alternate above and below the track while vertical labels sit alongside', () => {
    const a = { id: 'a', x: 150, y: 0 }, b = { id: 'b', x: 300, y: 0 };
    const edges = [{ a, b, mode: 'tube' }];
    assert.equal(N.schematicLabelDirection(a, edges), 'top');
    assert.equal(N.schematicLabelDirection(b, edges), 'bottom');
    assert.equal(N.schematicLabelDirection(a, [{ a, b: { ...b, x: 150, y: 150 }, mode: 'tube' }]), 'right');
});

test('mobile label selection avoids collisions, keeps interchanges first and reveals detail on zoom', () => {
    const points = [
        { id: 'a', x: 100, y: 100, name: 'Tottenham Court Road', interchange: true, priority: 3, direction: 'right' },
        { id: 'b', x: 115, y: 140, name: 'A crowded label', interchange: true, priority: 2, direction: 'right' },
        { id: 'c', x: 270, y: 250, name: 'Temple', interchange: false, priority: 1, direction: 'bottom' }
    ];
    assert.deepEqual([...N.schematicLabels(points, -1.25, 390, 640)], ['a']);
    assert.deepEqual([...N.schematicLabels(points, 0, 390, 640)], ['a', 'c']);
});
