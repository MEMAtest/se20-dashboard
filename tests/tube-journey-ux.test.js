const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = name => fs.readFileSync(require('node:path').join(__dirname, '..', name), 'utf8');
function harness() {
    const store = new Map(), context = {document:{addEventListener() {}}, localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)}};
    vm.runInNewContext(read('app.js')+'\nthis.App=PengeDash;',context);
    const app=Object.create(context.App.prototype);
    app._tubeOrigins=new Map([['HUBZCW',{id:'HUBZCW'}]]);
    app._tubeStations=new Map([['940GZZLUWAC',{id:'940GZZLUWAC'}]]);
    app.renderSavedTubeRoutes=()=>{};app.renderFavStations=()=>{};app.favStations=[];
    return {app,store,context};
}
const selected = {from:'HUBZCW',fromName:'Canada Water',to:'940GZZLUWAC',toName:'West Acton',tubeOnly:true};
test('saved Tube routes retain exact endpoints, not stale times, predictions or phone coordinates',()=>{
    const {app,store}=harness();app._saveTubeSelection({...selected,lat:51,lon:0,arrival:123});
    const saved=JSON.parse(store.get('journey-saved-tube-routes'));
    assert.deepEqual(saved,[selected]);app._saveTubeSelection(selected);assert.equal(app._readSavedTubeRoutes().length,1);
    for(const from of ['home','here'])app._saveTubeSelection({...selected,from});
    assert.equal(app._readSavedTubeRoutes().length,3);assert.equal(store.has('pengedash-home'),false);
});
test('saved routes reject unconfirmed and unknown station selections without changing existing entries',()=>{
    const {app,store}=harness();app._saveTubeSelection(selected);const before=store.get('journey-saved-tube-routes');
    assert.throws(()=>app._saveTubeSelection({...selected,from:'unconfirmed'}));
    assert.throws(()=>app._saveTubeSelection({...selected,to:'bad'}));
    assert.equal(store.get('journey-saved-tube-routes'),before);
    store.set('journey-saved-tube-routes','[{"from":"home","to":"bad"}]');assert.equal(app._readSavedTubeRoutes().length,0);
});
test('station saving works through the shared hub/map method and a failed write never claims saved',()=>{
    const {app,store,context}=harness();const station={id:'HUBZCW',name:'Canada Water',modes:['tube']};
    assert.equal(app.toggleFavStation(station),true);assert.equal(app.isFavStation(station.id),true);
    assert.equal(JSON.parse(store.get('pengedash-fav-stations'))[0].id,station.id);
    assert.equal(app.toggleFavStation(station),false);assert.equal(app.isFavStation(station.id),false);
    context.localStorage.setItem=()=>{throw Error('quota');};
    assert.throws(()=>app.toggleFavStation(station),/Could not save/);assert.equal(app.isFavStation(station.id),false);
});
test('result itinerary appears before the map, with explicit endpoints, follow and save actions',()=>{
    const source=read('app.js'),html=read('index.html');
    assert.ok(html.indexOf('id="tube-route-results"')<html.indexOf('id="tube-map-section"'));
    for(const text of ['START','FINISH','Follow this journey','Save route','Your route, step by step'])assert.ok(source.includes(text));
    assert.match(source,/_showTubeRoute\(0, \{ scroll: false \}\)/);
    assert.match(source,/originLabel: fromLabel/);
    assert.equal((source.match(/returnScreen: this\._journeyReturnScreen, originLabel: this\._journeyDetailOrigin/g)||[]).length,2);
    assert.match(source,/this\._lastDestination = destination;/);
});
test('zoomed Tube station names and nodes expose start, navigate, trains and persistent save actions',()=>{
    const map=read('tube-map.js');for(const text of ['Start here','Navigate here','Next trains & station','Save station'])assert.ok(map.includes(text));
    assert.match(map,/closest\('\[data-station\],\[data-label\]'\)/);
    assert.match(map,/onSaveStation\(station\)/);assert.match(map,/permanent: false/);
    assert.match(map,/event\.stopPropagation\(\); openStation\(id\)/);
    assert.match(map,/bubblingMouseEvents: false/);
    assert.match(map,/tube-route-waypoint/);
});
