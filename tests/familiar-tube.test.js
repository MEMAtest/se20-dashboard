const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const T = require('../tube-map.js');
const bundle = require('../tube-network.js');
const ref = T.reference(bundle);
const xml = fs.readFileSync(require.resolve('../familiar-tube.svg'),'utf8');
const canonical = raw => ref.aliases.get(raw);
const point = id => ({ naptanId:id });
const leg = (line, ids) => ({ mode:{id:'tube'}, routeOptions:[{lineIdentifier:{id:line}}], departurePoint:point(ids[0]), arrivalPoint:point(ids.at(-1)), path:{stopPoints:ids.slice(1).map(id => ({id}))} });
const jubilee = ['940GZZLUNGW','940GZZLUCYF','940GZZLUCWR','940GZZLUBMY','940GZZLULNB','940GZZLUSWK','940GZZLUWLO','940GZZLUWSM'];
const district = ['940GZZLUWSM','940GZZLUSJP','940GZZLUVIC'];
const journey = () => ({legs:[leg('jubilee',jubilee),leg('district',district)]});

test('authored SVG has all 270 verified stations and labels, not coordinate-generated placement', () => {
    const positions = JSON.parse(xml.match(/<metadata id="journey-layout">([^<]+)/)[1]).positions;
    const labels = new Set([...xml.matchAll(/data-label="([^"]+)"/g)].map(m=>m[1]));
    assert.equal(Object.keys(positions).length,270); assert.equal(labels.size,270);
    for (const station of ref.stations.values()) { assert.ok(positions[station.id]); assert.ok(labels.has(station.id)); }
    assert.ok(positions[canonical('940GZZLUNGW')].some(([x,y])=>x===2000&&y===648));
    assert.ok(positions[canonical('940GZZLUVIC')].some(([x,y])=>x===1176&&y===786));
    assert.match(xml, /Sameboat/); assert.match(xml, /CC BY-SA 4.0/);
    assert.match(xml, /#journey-authored-map text/);
    const covent = [...ref.stations.values()].find(s=>s.name==='Covent Garden').id;
    assert.match(xml, new RegExp(`<g data-label="${covent}"[^>]*class="[^"]*end`), 'Authored text alignment must survive flattening');
    assert.doesNotMatch(xml, /<(?:script|animate|set|foreignObject|image|a)[\s>]|\son\w+=|(?:href|src)="(?!#)/i);
    assert.equal((xml.match(/xmlns:xlink=/g)||[]).length,1);
    assert.equal(createHash('sha256').update(fs.readFileSync(require.resolve('../vendor/tube-map-source.svg'))).digest('hex'),'25bfec37cc74a1073505f6de2d70e5b5d511f04c57503f5ac0997319cfd25615');
});

test('real-shaped North Greenwich to Victoria plan highlights only actual provider stops and correct lines', () => {
    const plan = T.routePlan(journey(),ref);
    assert.equal(plan.complete,true); assert.equal(plan.segments.length,9); assert.equal(plan.stops.length,10);
    assert.deepEqual(plan.keys.map(k=>[ref.stations.get(k.id).name,k.role]),[['North Greenwich','from'],['Westminster','change'],['Victoria','to']]);
    assert.equal(plan.segments.filter(s=>s.line==='jubilee').length,7);
    assert.equal(plan.segments.filter(s=>s.line==='district').length,2);
    assert.equal(plan.stops.some(s=>s.name==='Green Park'),false,'Do not highlight a guessed alternative branch');
    assert.equal(T.routePlan({legs:[leg('jubilee',[...jubilee].reverse())]},ref).complete,true);
});

test('unknown stops, skipped connections, ambiguous lines and non-Tube data never manufacture a full route', () => {
    for (const bad of [
        leg('jubilee',['940GZZLUNGW','940GZZLUVIC']),
        leg('jubilee',['940GZZLUNGW','UNKNOWN','940GZZLUWSM']),
        {...leg('jubilee',jubilee),routeOptions:[{lineIdentifier:{id:'jubilee'}},{lineIdentifier:{id:'district'}}]},
        {...leg('jubilee',jubilee),routeOptions:{}},
        leg('not-a-line',jubilee)
    ]) assert.equal(T.routePlan({legs:[bad]},ref).complete,false);
    for (const data of [null,{}, {legs:{}}, {legs:[{mode:{id:'bus'}}]}]) assert.equal(T.routePlan(data,ref).complete,false);
    const partial = T.routePlan({legs:[leg('jubilee',jubilee),leg('district',['940GZZLUWSM','UNKNOWN','940GZZLUVIC'])]},ref);
    assert.equal(partial.complete,false); assert.equal(partial.segments.length,7);
    const feeder = T.routePlan({legs:[{mode:{id:'bus'}},...journey().legs]},ref);
    assert.equal(feeder.complete,true); assert.equal(feeder.tubeOnly,false);
});

test('SVG projection follows the exact continuous branch, supports reverse travel and refuses distant or disconnected points', () => {
    const paths = [{samples:[[0,0],[5,0],[10,0],[15,5],[20,10]]},{samples:[[100,0],[105,0],[110,0]]}];
    assert.deepEqual(T.projectedSegment(paths,[[5,0]],[[20,10]]),[[5,0],[10,0],[15,5],[20,10]]);
    assert.deepEqual(T.projectedSegment(paths,[[20,10]],[[5,0]]),[[20,10],[15,5],[10,0],[5,0]]);
    assert.equal(T.projectedSegment(paths,[[0,0]],[[110,0]]),null);
    assert.equal(T.projectedSegment(paths,[[400,200]],[[20,10]]),null);
});

test('route callouts avoid the highlighted line for horizontal, reverse and vertical travel', () => {
    const route = Array.from({length:41},(_,i)=>({x:90+i*5,y:i<5?435-i*3:420}));
    const keys = [{id:'start',role:'from',x:300,y:420},{id:'change',role:'change',x:110,y:420},{id:'end',role:'to',x:90,y:435}];
    const forward = T.labelDirections(keys,route,390,844);
    assert.equal(forward.get('start'),'top'); assert.equal(forward.get('end'),'bottom');
    const reverse = T.labelDirections([{...keys[2],role:'from'}, {...keys[1]}, {...keys[0],role:'to'}],route,390,844);
    assert.equal(reverse.get('end'),'bottom');
    const vertical = T.labelDirections([{id:'middle',role:'change',x:195,y:400}],Array.from({length:50},(_,i)=>({x:195,y:250+i*6})),390,844);
    assert.ok(['left','right'].includes(vertical.get('middle')));
});

test('new map, adapted artwork and attribution are cached and explicitly staged, with no raw vendor publication', () => {
    for (const path of ['../sw.js','../scripts/stage-assets.mjs','../.assetsignore']) {
        const source=fs.readFileSync(require.resolve(path),'utf8');
        for (const name of ['familiar-tube.svg','tube-map.js','TUBE-MAP-LICENCE.txt']) assert.ok(source.includes(name));
        assert.doesNotMatch(source,/!vendor|['"]vendor\/tube-map-source/);
    }
    const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
    assert.match(html,/id="tube-map-expand"/); assert.match(html,/id="quick-tube-route"/);
    assert.match(html,/creativecommons.org\/licenses\/by-sa\/4.0/);
    const css=fs.readFileSync(require.resolve('../styles.css'),'utf8');
    assert.doesNotMatch(css,/#quick-tube-map svg\s*\{\s*background:/,'An opaque Leaflet renderer would hide the familiar map');
});
