const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const {MessageChannel}=require('node:worker_threads');
const Updates=require('../app-updates.js');

class Target {
    constructor(){this.events=new Map();}
    addEventListener(name,fn){const list=this.events.get(name)||[];list.push(fn);this.events.set(name,list);}
    fire(name,event={}){for(const fn of this.events.get(name)||[])fn(event);}
}
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),values};};
function harness({current='a',latest='a',offline=false,focus=false,active=false,fail=false}={}) {
    const nodes=new Map(),doc=new Target(),env=new Target(),sw=new Target(),reg=new Target(),session=storage(),local=storage();
    let reloads=0,fetches=0,registered,workerVersion=current;
    const timers=new Map();let next=0;
    const get=id=>{
        if(!nodes.has(id))nodes.set(id,{id,hidden:true,dataset:{},textContent:'',value:'',checked:false,options:[],getAttribute(){return 'false';},dispatchEvent(){},addEventListener(){}});
        return nodes.get(id);
    };
    doc.visibilityState='visible';doc.readyState='loading';doc.getElementById=get;
    doc.querySelector=query=>query.startsWith('meta')?{content:current}:focus?{}:null;
    sw.controller={postMessage(data,ports){ports[0].postMessage({version:workerVersion});ports[0].close();}};
    sw.register=async(url,options)=>{registered={url,options};return reg;};
    reg.update=async()=>{workerVersion=latest;};
    Object.assign(env,{document:doc,navigator:{serviceWorker:sw,onLine:!offline},sessionStorage:session,localStorage:local,
        location:{pathname:'/',search:'?widget=1',hash:'#tube',reload(){reloads++;}},Event,MessageChannel,AbortController,
        pengeDash:{currentScreen:active?'journey-live':'tube',_tubeSearchFrom:{sync(){}},_tubeSearchTo:{sync(){}}},
        fetch:async(url,options)=>{fetches++;assert.equal(url,'/app-release.json');assert.equal(options.cache,'no-store');if(fail)throw new Error('offline');return {ok:true,json:async()=>({version:latest})};},
        setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
    local.setItem('pengedash-favorite-journeys','keep favourites');
    const api=Updates.start(env);
    return {api,env,doc,sw,reg,get,session,local,timers,unfocus(){focus=false;},stats:()=>({reloads,fetches,registered})};
}

test('release check is fresh on opening, foreground, bfcache return and reconnect; no recurring polling',async()=>{
    const h=harness();await h.api.check();assert.equal(h.get('app-update-notice').dataset.state,'current');
    assert.equal(h.stats().registered.options.updateViaCache,'none');
    h.doc.fire('visibilitychange');await h.api.check();
    h.env.fire('online');await h.api.check();h.env.fire('pageshow',{persisted:true});await h.api.check();
    assert.equal(h.stats().fetches,4);assert.equal(h.stats().reloads,0);assert.equal(h.timers.size,0);
});

test('new release reloads once, preserves deep-link form state and never clears Home/favourites',async()=>{
    const h=harness({latest:'b'});h.get('tube-route-from').value='HUBLBG';h.get('tube-from-query').value='London Bridge';
    await h.api.check();assert.equal(h.stats().reloads,1);
    const form=JSON.parse(h.session.getItem('journey-update-form'));assert.equal(form.version,'b');assert.equal(form.path,'/?widget=1#tube');
    assert.equal(form.fields.find(f=>f.id==='tube-route-from').value,'HUBLBG');
    assert.doesNotMatch(JSON.stringify(form),/latitude|longitude|expectedArrival/);
    assert.equal(h.local.getItem('pengedash-favorite-journeys'),'keep favourites');
    h.api.apply();assert.equal(h.stats().reloads,1);
});

test('typing and active navigation defer reload; it applies automatically after interaction ends',async()=>{
    const h=harness({latest:'b',focus:true});await h.api.check();assert.equal(h.stats().reloads,0);
    assert.equal(h.get('app-update-notice').dataset.state,'deferred');
    h.unfocus();h.doc.fire('focusout');for(const t of [...h.timers.values()])if(t.ms===250)t.fn();assert.equal(h.stats().reloads,1);
    const active=harness({latest:'b',active:true});await active.api.check();active.api.apply(true);assert.equal(active.stats().reloads,0);
    active.env.pengeDash.currentScreen='tube';active.api.apply();assert.equal(active.stats().reloads,1);
});

test('offline or failed checks are honest and never reload or erase stored settings',async()=>{
    for(const options of [{offline:true},{fail:true}]) {
        const h=harness({...options,latest:'b'});await h.api.check();
        assert.equal(h.stats().reloads,0);assert.equal(h.get('app-update-notice').dataset.state,'offline');
        assert.equal(h.local.getItem('pengedash-favorite-journeys'),'keep favourites');
    }
});

test('committing saved Home clears the unfinished-settings guard without losing the saved preference',async()=>{
    const h=harness({latest:'b'});h.doc.fire('input',{target:{id:'postcode-input'}});await h.api.check();assert.equal(h.stats().reloads,0);
    h.local.setItem('pengedash-home','public postcode fixture');h.env.fire('journey:settings-saved');
    for(const t of [...h.timers.values()])if(t.ms===250)t.fn();
    assert.equal(h.stats().reloads,1);assert.equal(h.local.getItem('pengedash-home'),'public postcode fixture');
});

test('a hung worker update times out and a later opening can check again',async()=>{
    const h=harness({latest:'b'});h.reg.update=()=>new Promise(()=>{});
    const first=h.api.check();await new Promise(setImmediate);
    for(const t of [...h.timers.values()])if(t.ms===12000)t.fn();await first;
    assert.equal(h.get('app-update-notice').dataset.state,'offline');assert.equal(h.stats().reloads,0);
    h.reg.update=async()=>{};await h.api.check();assert.equal(h.stats().fetches,2);
});

test('failed reload cannot loop, and malformed or cross-page temporary state is ignored',async()=>{
    const h=harness({latest:'b'});h.session.setItem('journey-update-attempt',JSON.stringify({version:'b',at:Date.now()}));
    await h.api.check();assert.equal(h.stats().reloads,0);assert.equal(h.get('app-update-notice').dataset.state,'retry');
    for(const state of [{version:'a',at:Date.now(),path:'/?widget=1#tube',fields:{}},{version:'a',at:Date.now(),path:'/other',fields:[]},
        {version:'a',at:0,path:'/?widget=1#tube',fields:[]}]) {h.session.setItem('journey-update-form',JSON.stringify(state));assert.doesNotThrow(()=>h.api.restore());}
});

test('matching saved station IDs and unconfirmed text restore after station options are ready',()=>{
    const h=harness();const form={version:'a',at:Date.now(),path:'/?widget=1#tube',fields:[
        {id:'tube-route-from',value:'HUBLBG'},{id:'tube-from-query',value:'London Bridge'},
        {id:'tube-route-to',value:''},{id:'tube-to-query',value:'vict'}]};
    h.session.setItem('journey-update-form',JSON.stringify(form));h.api.restore();assert.equal(h.get('tube-route-from').value,'');
    h.get('tube-route-from').options=[{value:'HUBLBG'}];h.env.fire('journey:tube-ready');
    assert.equal(h.get('tube-route-from').value,'HUBLBG');assert.equal(h.get('tube-to-query').value,'vict');assert.equal(h.session.getItem('journey-update-form'),null);
});

test('new client acknowledges activation without forced navigation; an older shell has a bounded migration bridge',async()=>{
    for(const acknowledge of [true,false]) {
        const handlers={},timers=new Map();let n=0,navCount=0,ackMessages=0;
        class Channel {constructor(){this.port1={close(){}};this.port2={postMessage:data=>this.port1.onmessage?.({data})};}}
        const client={url:'https://journey.test/?widget=1#tube',navigate:async()=>{navCount++;},postMessage(data,ports){ackMessages++;assert.equal(data.type,'JOURNEY_RELEASE_READY');if(acknowledge)ports[0].postMessage({type:'JOURNEY_UPDATE_HANDLED',version:'a'});}};
        const context={URL,console,MessageChannel:Channel,importScripts(){},setTimeout:fn=>{timers.set(++n,fn);return n;},clearTimeout:id=>timers.delete(id),
            caches:{keys:async()=>['penge-dash-v62','penge-dash-web-a','unrelated-cache'],delete:async key=>{assert.notEqual(key,'unrelated-cache');if(acknowledge)assert.notEqual(key,'penge-dash-web-a','Keep the active old client cache while its reload is deferred');}},
            self:{location:{origin:'https://journey.test'},addEventListener:(name,fn)=>handlers[name]=fn,clients:{claim:async()=>{},matchAll:async()=>[client]}}};
        vm.runInNewContext(fs.readFileSync(require.resolve('../sw.js'),'utf8'),context);let accepted;
        handlers.activate({waitUntil:p=>accepted=p});await new Promise(setImmediate);
        for(const fn of [...timers.values()])await fn();await accepted;
        assert.equal(ackMessages,1);assert.equal(navCount,acknowledge?0:1);
    }
});

test('navigation is network-first, release metadata never falls back, and versioned assets are not overwritten',async()=>{
    let fetches=0,reads=0,stored=0,fail=false,response;
    const handlers={},context={URL,Response,console,importScripts(){},TransitData:require('../transit-data.js'),
        fetch:async(_req,opts)=>{fetches++;if(fail)throw new Error('offline');assert.equal(opts?.cache,'no-store');return new Response('new shell');},
        caches:{match:async()=>{reads++;return new Response('old shell');},open:async()=>({put:async()=>{stored++;},match:async()=>{reads++;return new Response('old shell');}})},
        self:{location:{origin:'https://journey.test'},addEventListener:(name,fn)=>handlers[name]=fn}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../sw.js'),'utf8'),context);
    const run=async(path,mode='cors')=>{handlers.fetch({request:{method:'GET',url:'https://journey.test'+path,mode},respondWith:p=>response=p});return response;};
    assert.equal(await(await run('/?widget=1','navigate')).text(),'new shell');assert.equal(reads,0);assert.equal(stored,1);
    fail=true;assert.equal(await(await run('/?widget=1','navigate')).text(),'old shell');
    const before=reads;await assert.rejects(()=>run('/app-release.json'));assert.equal(reads,before);
    const networkBefore=fetches;assert.equal(await(await run('/app.js?v=old')).text(),'old shell');assert.equal(fetches,networkBefore);
});

test('staging fingerprints every source and renders consistent, deterministic versioned assets',()=>{
    const root=require('node:path').resolve(__dirname,'..');
    const stage=()=>JSON.parse(execFileSync(process.execPath,['scripts/stage-assets.mjs'],{cwd:root,encoding:'utf8'}));
    const first=stage(),second=stage();assert.equal(first.version,second.version);assert.equal(first.staticAssetCount,20);
    const html=fs.readFileSync(root+'/.deploy-assets/index.html','utf8'),sw=fs.readFileSync(root+'/.deploy-assets/sw.js','utf8');
    assert.match(html,new RegExp(`name="journey-release" content="${first.version}"`));
    assert.match(sw,new RegExp(`RELEASE_VERSION = '${first.version}'`));
    assert.doesNotMatch(html+sw,/__JOURNEY_RELEASE__/);
    assert.equal(JSON.parse(fs.readFileSync(root+'/.deploy-assets/app-release.json')).version,first.version);
    assert.match(html,/app-updates.js\?v=/);assert.match(fs.readFileSync(root+'/_headers','utf8'),/\/app-release.json\n  Cache-Control: no-store/);
});

test('an incomplete release installation cannot skip waiting or activate a broken shell',async()=>{
    const handlers={};let skipped=0,installed;
    const context={console,Request:class {constructor(url,options){return new Request(new URL(url,'https://journey.test'),options);}},importScripts(){},caches:{open:async()=>({addAll:async()=>{throw new Error('missing asset');}})},
        self:{skipWaiting(){skipped++;},addEventListener:(name,fn)=>handlers[name]=fn}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../sw.js'),'utf8'),context);
    handlers.install({waitUntil:p=>installed=p});await assert.rejects(installed,/missing asset/);assert.equal(skipped,0);
});

test('the pinned Leaflet dependency is retained in the new release cache for later offline openings',async()=>{
    const handlers={};let stored=0,result;
    const context={URL,Response,console,importScripts(){},fetch:()=>assert.fail('Do not refetch the immutable dependency'),
        caches:{match:async()=>new Response('pinned library'),open:async()=>({put:async(_request,body)=>{assert.equal(await body.text(),'pinned library');stored++;}})},
        self:{location:{origin:'https://journey.test'},addEventListener:(name,fn)=>handlers[name]=fn}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../sw.js'),'utf8'),context);
    handlers.fetch({request:{method:'GET',url:'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js?journey=20261113b',mode:'cors'},respondWith:p=>result=p});
    assert.equal(await(await result).text(),'pinned library');assert.equal(stored,1);
});
