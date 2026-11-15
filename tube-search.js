(function(root,factory) {
    if (typeof module === 'object' && module.exports) module.exports=factory();
    else root.JourneyTubeSearch=factory();
}(typeof globalThis !== 'undefined' ? globalThis : this,function() {
    'use strict';
    const normalise = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/['’]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
    function search(stations,query) {
        const q=normalise(query), tokens=q.split(' ').filter(Boolean);
        return stations.filter(s=>tokens.every(t=>normalise(s.name).includes(t)))
            .sort((a,b)=>Number(normalise(b.name).startsWith(q))-Number(normalise(a.name).startsWith(q)) || a.name.localeCompare(b.name)).slice(0,8);
    }
    function locationFix(position,now=Date.now()) {
        const c=position?.coords;
        if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude) || Math.abs(c.latitude)>90 || Math.abs(c.longitude)>180) throw new Error('Location is unavailable. Search for a station or try Locate me again.');
        if (!Number.isFinite(position.timestamp) || now-position.timestamp>120000 || position.timestamp>now+10000) throw new Error('That location is out of date. Try Locate me again or search for a station.');
        if (!Number.isFinite(c.accuracy) || c.accuracy<0 || c.accuracy>500) throw new Error('Location is too approximate to use safely. Move near a window and retry, or search for your starting station.');
        return {lat:c.latitude,lon:c.longitude,accuracy:c.accuracy,at:position.timestamp};
    }
    function nearby(stations,fix) {
        const rad=d=>d*Math.PI/180;
        return stations.filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)).map(s=>{
            const a=Math.sin(rad(s.lat-fix.lat)/2)**2+Math.cos(rad(fix.lat))*Math.cos(rad(s.lat))*Math.sin(rad(s.lon-fix.lon)/2)**2;
            return {...s,distance:6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)))};
        }).sort((a,b)=>a.distance-b.distance).slice(0,3);
    }
    function mount({root,input,list,status,select,labelFor}) {
        let stations=[],results=[],active=-1,editing=false;
        const close=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;};
        function sync() {
            if (editing) return;
            input.value=labelFor(select.value) || stations.find(s=>s.id===select.value)?.name || '';
            status.textContent=input.value ? `${input.value} selected.` : '';
        }
        function choose(station) {
            select.value=station.id; select.dispatchEvent(new Event('change',{bubbles:true})); sync();close();input.focus();
            status.textContent=`${station.name} selected.`;
        }
        function highlight(index) {
            active=index;
            [...list.children].forEach((node,i)=>node.setAttribute('aria-selected',String(i===active)));
            if (active>=0) {input.setAttribute('aria-activedescendant',`${list.id}-${active}`);list.children[active].scrollIntoView({block:'nearest'});}
        }
        function render() {
            results=search(stations,input.value);list.replaceChildren();active=-1;input.removeAttribute('aria-activedescendant');
            for (const [i,station] of results.entries()) {
                const option=document.createElement('button');option.type='button';option.id=`${list.id}-${i}`;option.tabIndex=-1;
                option.setAttribute('role','option');option.setAttribute('aria-selected','false');option.textContent=station.name;
                option.addEventListener('click',()=>choose(station));list.append(option);
            }
            list.hidden=!results.length;input.setAttribute('aria-expanded',String(!!results.length));
            status.textContent=results.length ? `${results.length} station suggestions. Choose one or use arrow keys and Enter.` : 'No matching Tube station. Try another station name.';
        }
        input.addEventListener('input',()=>{
            editing=true;select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));editing=false;render();
        });
        input.addEventListener('focus',()=>{if(!select.value)render();});
        input.addEventListener('keydown',event=>{
            if(event.key==='Escape'){close();return;}
            if(['ArrowDown','ArrowUp'].includes(event.key)) {
                event.preventDefault();if(list.hidden)render();if(results.length)highlight(active<0 ? (event.key==='ArrowDown'?0:results.length-1) : (active+(event.key==='ArrowDown'?1:-1)+results.length)%results.length);
            } else if(event.key==='Enter' && !list.hidden) {event.preventDefault();if(active>=0)choose(results[active]);else status.textContent='Choose a suggested station to confirm it.';}
            else if(event.key==='Tab')close();
        });
        select.addEventListener('change',sync);
        root.querySelector('[data-clear-station]').addEventListener('click',()=>{
            input.value='';select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));input.focus();render();
        });
        document.addEventListener('pointerdown',event=>{if(!root.contains(event.target))close();});
        return { update(next) {stations=next;input.disabled=!stations.length;sync();}, sync, close };
    }
    return {search,locationFix,nearby,mount};
}));
