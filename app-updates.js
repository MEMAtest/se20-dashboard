(function(root,factory) {
    if(typeof module==='object'&&module.exports)module.exports=factory();
    else {root.JourneyUpdates=factory();root.JourneyUpdates.start(root);}
}(typeof globalThis!=='undefined'?globalThis:this,function() {
    'use strict';
    const validVersion=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9._-]{0,63}$/.test(v);
    const fields=['destination-input','tube-route-from','tube-route-to','tube-from-query','tube-to-query','tube-route-tube-only'];
    function start(env) {
        const {document:doc,navigator:nav,location,sessionStorage:storage}=env;
        const current=doc.querySelector('meta[name="journey-release"]')?.content;
        if(!validVersion(current)||!nav.serviceWorker)return;
        let registration,pending,ready=false,inFlight=null,reloading=false,dirtyOther=false,applyTimer;
        const now=()=>Date.now();
        const badge=doc.getElementById('app-update-notice'),text=doc.getElementById('app-update-message'),button=doc.getElementById('app-update-button');
        function status(state,message) {
            if(badge){badge.dataset.state=state;badge.hidden=state==='current';}
            if(text)text.textContent=message;
            const version=doc.getElementById('app-version');if(version)version.textContent=`Web ${current} · ${message}`;
            if(button){button.hidden=['checking','updating'].includes(state);button.textContent=ready?'Update now':'Retry check';}
        }
        function read(key) {try{return JSON.parse(storage.getItem(key)||'null');}catch{return null;}}
        function safe() {
            return doc.visibilityState==='visible'&&!dirtyOther&&!doc.querySelector('input:focus,textarea:focus,[contenteditable="true"]:focus')
                &&env.pengeDash?.currentScreen!=='journey-live'&&doc.getElementById('tube-route-submit')?.getAttribute('aria-busy')!=='true';
        }
        function restore() {
            const saved=read('journey-update-form');
            if(!saved||saved.version!==current||!Array.isArray(saved.fields)||!Number.isFinite(saved.at)||saved.at<now()-120000||saved.at>now()+10000||saved.path!==location.pathname+location.search+location.hash)return;
            saved.fields=saved.fields.filter(f=>f&&fields.includes(f.id)&&typeof f.value==='string'&&f.value.length<=500);
            const selectors=['tube-route-from','tube-route-to'];
            if(saved.fields.some(f=>selectors.includes(f.id)&&f.value&&![...(doc.getElementById(f.id)?.options||[])].some(o=>o.value===f.value)))return;
            for(const f of saved.fields) {
                if(!fields.includes(f.id)||typeof f.value!=='string'||f.value.length>500)continue;
                const node=doc.getElementById(f.id);if(!node)continue;node.value=f.value;if(node.type==='checkbox')node.checked=!!f.checked;
            }
            doc.getElementById('tube-route-form')?.dispatchEvent(new env.Event('change',{bubbles:true}));
            env.pengeDash?._tubeSearchFrom?.sync();env.pengeDash?._tubeSearchTo?.sync();
            // Unconfirmed text stays unconfirmed; never restore old route estimates or GPS fixes.
            for(const id of ['tube-from-query','tube-to-query'])if(!doc.getElementById(id==='tube-from-query'?'tube-route-from':'tube-route-to')?.value) {
                const item=saved.fields.find(f=>f.id===id);if(item)doc.getElementById(id).value=item.value;
            }
            try{storage.removeItem('journey-update-form');}catch{}
        }
        function apply(force=false) {
            if(!ready||!pending||pending===current||reloading||doc.visibilityState!=='visible')return;
            if(env.pengeDash?.currentScreen==='journey-live'||(!force&&!safe())) {status('deferred','Update ready. It will apply when you finish your current interaction.');return;}
            const last=read('journey-update-attempt');
            if(last?.version===pending&&now()-last.at<60000){status('retry','Update could not finish. Try again after reconnecting.');return;}
            const snapshot={version:pending,at:now(),path:location.pathname+location.search+location.hash,
                fields:fields.map(id=>doc.getElementById(id)).filter(Boolean).map(n=>({id:n.id,value:String(n.value||'').slice(0,500),checked:!!n.checked}))};
            try{storage.setItem('journey-update-form',JSON.stringify(snapshot));storage.setItem('journey-update-attempt',JSON.stringify({version:pending,at:now()}));}
            catch{if(!force&&snapshot.fields.some(f=>f.value)){status('deferred','Update ready. Tap Update now when you are ready to refresh.');return;}}
            reloading=true;status('updating','Updating Journey…');location.reload();
        }
        function versionOf(worker) {
            if(!worker||!env.MessageChannel)return Promise.resolve(null);
            return new Promise(resolve=>{
                const channel=new env.MessageChannel();
                const finish=value=>{env.clearTimeout(timer);channel.port1.close();resolve(value);};
                const timer=env.setTimeout(()=>finish(null),2000);
                channel.port1.onmessage=e=>finish(validVersion(e.data?.version)?e.data.version:null);
                try{worker.postMessage({type:'JOURNEY_VERSION'},[channel.port2]);}catch{finish(null);}
            });
        }
        async function controlled() {
            const version=await versionOf(nav.serviceWorker.controller);
            if(version&&version!==current&&(!pending||version===pending)){pending=version;ready=true;apply();}
        }
        function observe(reg) {
            const watch=()=>{
                const worker=reg.installing;if(!worker)return;
                worker.addEventListener('statechange',()=>{
                    if(worker.state==='activated')controlled();
                    if(worker.state==='redundant'&&pending)status('retry','Update download failed. Your existing version is still available.');
                });
            };
            reg.addEventListener('updatefound',watch);watch();
        }
        async function check() {
            if(inFlight||reloading||doc.visibilityState!=='visible')return inFlight;
            const work=(async()=>{
                if(nav.onLine===false){status('offline','Offline. Updates will be checked when you reconnect.');return;}
                status('checking','Checking for updates…');
                const abort=new env.AbortController(),timeout=env.setTimeout(()=>abort.abort(),12000);
                const bounded=promise=>Promise.race([promise,new Promise((_,reject)=>{
                    const fail=()=>reject(new Error('update check timed out'));
                    if(abort.signal.aborted)fail();else abort.signal.addEventListener('abort',fail,{once:true});
                })]);
                try {
                    const response=await env.fetch('/app-release.json',{cache:'no-store',credentials:'omit',redirect:'error',signal:abort.signal});
                    if(!response.ok)throw new Error('release unavailable');
                    const data=await response.json();if(!validVersion(data.version))throw new Error('invalid release');
                    if(!registration){registration=await bounded(nav.serviceWorker.register('/sw.js',{updateViaCache:'none'}));observe(registration);}
                    if(data.version===current){pending=null;ready=false;status('current','Up to date');return;}
                    pending=data.version;status('checking','Downloading the latest Journey update…');
                    await bounded(registration.update());await controlled();
                    if(!reloading&&!ready)status('retry','Update is not ready yet. It will be checked again when you reopen or reconnect.');
                }catch{if(!reloading)status('offline','Could not check for updates. Your current version has been kept.');}
                finally{env.clearTimeout(timeout);}
            })();
            inFlight=work;try{await work;}finally{inFlight=null;}
        }
        nav.serviceWorker.addEventListener('controllerchange',controlled);
        nav.serviceWorker.addEventListener('message',event=>{
            if(event.source&&event.source!==nav.serviceWorker.controller)return;
            if(event.data?.type!=='JOURNEY_RELEASE_READY'||!validVersion(event.data.version))return;
            event.ports?.[0]?.postMessage({type:'JOURNEY_UPDATE_HANDLED',version:current});
            if(event.data.version!==current){pending=event.data.version;ready=true;apply();}
        });
        const later=()=>{env.clearTimeout(applyTimer);applyTimer=env.setTimeout(()=>apply(),250);};
        doc.addEventListener('visibilitychange',()=>{if(doc.visibilityState==='visible'){apply();check();}});
        doc.addEventListener('input',event=>{if(event.target?.id&&!fields.includes(event.target.id))dirtyOther=true;});
        doc.addEventListener('submit',()=>{dirtyOther=false;later();});
        doc.addEventListener('focusout',later);doc.addEventListener('click',later);
        env.addEventListener('online',check);env.addEventListener('pageshow',event=>{if(event.persisted)check();});
        env.addEventListener('journey:tube-ready',restore);
        env.addEventListener('journey:settings-saved',()=>{dirtyOther=false;later();});
        button?.addEventListener('click',()=>ready?apply(true):check());
        if(doc.readyState==='complete'){restore();check();}else env.addEventListener('load',()=>{restore();check();},{once:true});
        return {check,apply,restore};
    }
    return {validVersion,start};
}));
