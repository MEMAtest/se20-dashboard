const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = name => fs.readFileSync(require('node:path').join(__dirname, '..', name), 'utf8');

test('nearby markers use bounded SVG shapes and escape invalid mode input into a fixed fallback', () => {
    const context = {document: {addEventListener() {}}, L: {divIcon: x => x}};
    vm.runInNewContext(read('app.js') + '\nthis.App = PengeDash;', context);
    const app = Object.create(context.App.prototype);
    for (const kind of ['home','here','bus','rail','tube','tram','<script>']) {
        const icon = app._mapIcon(kind);
        assert.match(icon.html, /^<svg aria-hidden="true"/);
        assert.doesNotMatch(icon.html, /<script>|undefined/);
        assert.equal(icon.iconSize[0], 34);
        assert.match(icon.className, /^map-pin map-pin--(?:home|here|bus|rail|tube|tram)$/);
    }
});

test('the geographic map has a readable surface and legend, with no inverted dark-theme geography', () => {
    const css = read('styles.css'), html = read('index.html'), source = read('app.js');
    assert.match(html, /Geographic map of nearby transport/);
    assert.match(html, /Rings: 5 &amp; 10 min walk/);
    assert.match(css, /height: clamp\(320px, 48vh, 440px\)/);
    assert.doesNotMatch(css, /hue-rotate\(180deg\) invert\(1\)/);
    assert.match(source, /tile\.openstreetmap\.org/);
    assert.doesNotMatch(source, /cartocdn|mapbox\.com|api\.maptiler/);
});
