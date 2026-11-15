const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const S=require('../tube-search.js');
const T=require('../tube-map.js');
const stations=[...T.reference(require('../tube-network.js')).stations.values()];

test('station search handles case, partial tokens and punctuation without guessing a selection',()=>{
    assert.equal(S.search(stations,'nOrTh gReEn')[0].name,'North Greenwich');
    assert.equal(S.search(stations,'bridge london')[0].name,'London Bridge');
    assert.ok(S.search(stations,'kings cross').some(s=>s.name==="King's Cross St Pancras"));
    assert.equal(S.search(stations,'no such station!').length,0);
    assert.equal(S.search(stations,'<script>').length,0);
    assert.ok(S.search(stations,'').length<=8);
});

test('location must be fresh, bounded and accurate before it can be used for a route',()=>{
    const now=Date.now(),good={timestamp:now,coords:{latitude:51.5,longitude:0,accuracy:25}};
    assert.equal(S.locationFix(good,now).accuracy,25);
    for(const bad of [null,{...good,timestamp:now-120001},{...good,timestamp:now+11000},
        {...good,coords:{...good.coords,accuracy:501}},{...good,coords:{...good.coords,accuracy:NaN}},
        {...good,coords:{...good.coords,latitude:91}},{...good,coords:{...good.coords,longitude:Infinity}}]) assert.throws(()=>S.locationFix(bad,now));
    assert.equal(S.locationFix({...good,coords:{...good.coords,accuracy:500}},now).accuracy,500);
});

test('nearby stations are distance-sorted suggestions, not a replacement for the GPS origin',()=>{
    const north=stations.find(s=>s.name==='North Greenwich'),fix={lat:north.lat,lon:north.lon};
    const result=S.nearby(stations,fix);
    assert.equal(result[0].id,north.id);assert.equal(result[0].distance,0);assert.equal(result.length,3);
    assert.ok(result[1].distance<=result[2].distance);
    assert.deepEqual(fix,{lat:north.lat,lon:north.lon});
});

function node() {
    return {value:'',textContent:'',disabled:false,hidden:false,attrs:{},children:[],events:{},
        setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},
        addEventListener(k,f){this.events[k]=f;},dispatchEvent(e){this.events[e.type]?.(e);},
        append(e){this.children.push(e);},replaceChildren(){this.children=[];},focus(){},scrollIntoView(){}};
}
test('combobox requires confirmation, supports keyboard, clears stale IDs and synchronises external map choices',()=>{
    const context={module:{exports:{}},Event,document:{createElement:node,addEventListener(){}}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../tube-search.js'),'utf8'),context);
    const root=node(),input=node(),list=node(),status=node(),select=node(),clear=node();root.querySelector=()=>clear;root.contains=()=>true;list.id='suggestions';
    const widget=context.module.exports.mount({root,input,list,status,select,labelFor:value=>value==='home'?'Saved Home':''});
    widget.update(stations);input.value='North Green';input.events.input();
    assert.equal(select.value,'');assert.equal(input.value,'North Green');assert.equal(input.attrs['aria-expanded'],'true');
    const key=k=>({key:k,preventDefault(){}});
    input.events.keydown(key('Enter'));assert.equal(select.value,'');
    input.events.keydown(key('ArrowDown'));assert.ok(input.attrs['aria-activedescendant']);
    input.events.keydown(key('Enter'));assert.equal(input.value,'North Greenwich');assert.equal(select.value,stations.find(s=>s.name==='North Greenwich').id);
    assert.equal(list.hidden,true);
    input.value='Victoria';input.events.input();assert.equal(select.value,'');list.children[0].events.click();assert.equal(input.value,'Victoria');
    select.value='home';select.dispatchEvent(new Event('change'));assert.equal(input.value,'Saved Home');
    clear.events.click();assert.equal(select.value,'');assert.equal(input.value,'');
    input.events.keydown(key('Escape'));assert.equal(list.hidden,true);
});

test('search controls have visible location shortcuts, accessible suggestions and no exposed endpoint dropdown',()=>{
    const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
    for(const side of ['from','to']) {
        assert.match(html,new RegExp(`id="tube-${side}-query"[^>]+role="combobox"`));
        assert.match(html,new RegExp(`id="tube-route-${side}" hidden aria-hidden="true"`));
        assert.match(html,new RegExp(`id="tube-${side}-suggestions"[^>]+role="listbox"`));
    }
    assert.match(html,/id="tube-locate"/);assert.match(html,/id="tube-use-home"/);
    const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    assert.equal(new Set(ids).size,ids.length,'Duplicate IDs must not hide location feedback on another page');
});

function controller(acquire) {
    const nodes={};
    const get=id=>nodes[id]||=node();
    const select=get('tube-route-from');
    select.dispatchEvent=e=>{select.events[e.type]?.(e);if(e.bubbles)get('tube-route-form').events[e.type]?.(e);};
    const queries=[];
    const context={console,Date,Map,URL,AbortController,Event,CONFIG:{},LINE_META:{},navigator:{},
        JourneyTubeSearch:{...S,mount:()=>({sync(){},update(){}})},JourneyGuidance:require('../journey-guidance.js'),JourneyNetworkMap:require('../network-map.js'),
        document:{getElementById:get,addEventListener(){},querySelectorAll:()=>[],createElement:node},
        setTimeout:()=>1,clearTimeout(){},fetch:async url=>{queries.push(url);return {ok:true,json:async()=>({journeys:[]})};}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../app.js'),'utf8')+'\nthis.App=PengeDash;',context);
    const app=Object.create(context.App.prototype);
    app._tubeStations=new Map(stations.map(s=>[s.id,s]));app._tubeOrigins=app._tubeStations;
    app._acquirePosition=acquire;app.homeLabel=()=> 'Saved Home';app._quickTubeMap={clearRoute(){}};
    app.setupTubeConnections();get('tube-route-to').value=stations.find(s=>s.name==='Victoria').id;
    return {app,nodes,get,queries};
}

test('Locate me reports permission denial beside the control without substituting Home or requesting routes',async()=>{
    const h=controller(async()=>{throw {code:1};});h.get('tube-route-from').value='home';
    await h.app._locateTubeOrigin();
    assert.equal(h.get('tube-route-from').value,'');assert.equal(h.queries.length,0);
    assert.match(h.get('tube-origin-status').textContent,/permission denied.*No fallback/);
    assert.equal(h.get('tube-locate').disabled,false);
});

test('fresh GPS offers nearby stations but routes from actual coordinates only after Find is requested',async()=>{
    const north=stations.find(s=>s.name==='North Greenwich');
    const position={timestamp:Date.now(),coords:{latitude:north.lat+.0002,longitude:north.lon+.0001,accuracy:25}};
    const h=controller(async()=>position);await h.app._locateTubeOrigin();
    assert.equal(h.get('tube-route-from').value,'here');assert.equal(h.queries.length,0);
    assert.match(h.get('tube-origin-status').textContent,/accuracy ±25 m/);
    assert.ok(h.get('tube-nearby-options').children.length>0);
    await h.app.findTubeConnection();assert.equal(h.queries.length,1);
    assert.ok(decodeURIComponent(new URL(h.queries[0]).pathname).includes(`${position.coords.latitude},${position.coords.longitude}`));
    h.get('tube-nearby-options').children[0].events.click();assert.equal(h.get('tube-route-from').value,north.id);
    assert.equal(h.app._tubeLocatedPosition,null);
});

test('a late GPS result cannot overwrite a station selected while locating',async()=>{
    let resolve;const h=controller(()=>new Promise(r=>{resolve=r;}));
    const pending=h.app._locateTubeOrigin();h.get('tube-route-from').value=stations[0].id;
    h.get('tube-route-from').dispatchEvent(new Event('change',{bubbles:true}));
    resolve({timestamp:Date.now(),coords:{latitude:51.5,longitude:0,accuracy:10}});await pending;
    assert.equal(h.get('tube-route-from').value,stations[0].id);assert.equal(h.get('tube-nearby-options').children.length,0);
    assert.equal(h.queries.length,0);
});

test('approximate GPS and browser timeouts stay explicit, with no fallback route',async()=>{
    for(const acquire of [async()=>({timestamp:Date.now(),coords:{latitude:51.5,longitude:0,accuracy:900}}),async()=>{throw {code:3};}]) {
        const h=controller(acquire);await h.app._locateTubeOrigin();
        assert.equal(h.get('tube-route-from').value,'');assert.equal(h.queries.length,0);
        assert.match(h.get('tube-origin-status').textContent,/too approximate|timed out/);
    }
});
