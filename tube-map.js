(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./network-map.js'));
    else root.JourneyTubeMap = factory(root.JourneyNetworkMap);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (network) {
    'use strict';
    const pair = (a, b) => [a, b].sort().join('|');
    function reference(bundle) {
        const scene = network.schematicLayout(bundle.datasets), aliases = new Map();
        for (const station of scene.stations.values()) {
            aliases.set(station.id, station.id);
            if (station.routingId) aliases.set(station.routingId, station.id);
        }
        for (const { data } of bundle.datasets) for (const station of data.stations) {
            const id = /^HUB/.test(station.topMostParentId || '') ? station.topMostParentId : station.id;
            if (scene.stations.has(id)) aliases.set(station.id, id);
        }
        return { stations: scene.stations, aliases, edges: new Set(scene.edges.map(e => `${e.id}:${pair(e.a.id, e.b.id)}`)) };
    }
    function routePlan(journey, ref) {
        const segments = [], stops = new Map(), keys = new Map(), problems = [];
        const legs = Array.isArray(journey?.legs) ? journey.legs.slice(0,50) : [];
        const tubeLegs = legs.filter(l => l?.mode?.id === 'tube');
        if (!tubeLegs.length) return { segments, stops: [], keys: [], problems: ['no_tube_legs'], complete: false };
        for (const [index, leg] of tubeLegs.entries()) {
            const lines = [...new Set((Array.isArray(leg.routeOptions) ? leg.routeOptions : []).slice(0,20).map(r => r?.lineIdentifier?.id).filter(id => network.tubeLineIds.includes(id)))];
            if (lines.length !== 1) { problems.push('ambiguous_line'); continue; }
            const line = lines[0];
            const canonical = point => ref.aliases.get(point?.naptanId || point?.id);
            const from = canonical(leg.departurePoint), to = canonical(leg.arrivalPoint);
            if (!from || !to) { problems.push('unknown_endpoint'); continue; }
            const ids = [from, ...(Array.isArray(leg.path?.stopPoints) ? leg.path.stopPoints.slice(0,500).map(canonical) : []), to]
                .filter((id, i, all) => i === 0 || id !== all[i - 1]);
            if (ids.some(id => !id)) { problems.push('unknown_stop'); continue; }
            keys.set(from, { id: from, line, role: index === 0 ? 'from' : 'change' });
            keys.set(to, { id: to, line, role: index === tubeLegs.length - 1 ? 'to' : 'change' });
            for (const id of ids) stops.set(id, { id, line, name: ref.stations.get(id).name });
            for (let i = 1; i < ids.length; i++) {
                if (!ref.edges.has(`${line}:${pair(ids[i - 1], ids[i])}`)) { problems.push('unverified_connection'); continue; }
                segments.push({ line, from: ids[i - 1], to: ids[i] });
            }
        }
        return { segments, stops: [...stops.values()], keys: [...keys.values()], problems,
            complete: problems.length === 0 && segments.length > 0,
            tubeOnly: legs.every(l => ['tube', 'walking'].includes(l?.mode?.id)) };
    }
    function nearest(points, samples) {
        let best = null;
        for (const point of points) for (let i = 0; i < samples.length; i++) {
            const distance = Math.hypot(point[0] - samples[i][0], point[1] - samples[i][1]);
            if (!best || distance < best.distance) best = { index: i, distance, point };
        }
        return best;
    }
    function projectedSegment(paths, a, b) {
        let best = null;
        for (const path of paths) {
            const from = nearest(a, path.samples), to = nearest(b, path.samples);
            if (!from || !to || from.distance > 22 || to.distance > 22 || from.index === to.index) continue;
            const score = from.distance + to.distance + Math.abs(from.index - to.index) * .00001;
            if (!best || score < best.score) {
                const lo = Math.min(from.index, to.index), hi = Math.max(from.index, to.index);
                const points = path.samples.slice(lo, hi + 1);
                best = { score, points: from.index < to.index ? points : points.reverse() };
            }
        }
        return best?.points || null;
    }
    function labelDirections(keys, route, width, height) {
        const occupied = [], result = new Map(), grid = new Map();
        for (const p of route) grid.set(`${Math.round(p.x/6)},${Math.round(p.y/6)}`, p);
        for (const key of keys) {
            const preferred = key.role === 'to' ? ['bottom','top','right','left'] : ['top','bottom','right','left'];
            const candidates = preferred.map((direction, preference) => {
                const w = 140, h = 76, gap = 18;
                const x = direction === 'left' ? key.x-gap-w : direction === 'right' ? key.x+gap : key.x-w/2;
                const y = direction === 'top' ? key.y-gap-h : direction === 'bottom' ? key.y+gap : key.y-h/2;
                const box = { x, y, w, h };
                const area = (a,b) => Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
                let score = preference + (w*h-area(box,{x:8,y:8,w:Math.max(0,width-16),h:Math.max(0,height-16)}))*10;
                for (const previous of occupied) score += area(box,previous)*5;
                for (const p of grid.values()) if (p.x>x-5 && p.x<x+w+5 && p.y>y-5 && p.y<y+h+5) score += 500;
                return { direction, box, score };
            }).sort((a,b)=>a.score-b.score);
            result.set(key.id,candidates[0].direction); occupied.push(candidates[0].box);
        }
        return result;
    }
    async function mount({ element, status, stationSelect, routeFromSelect, routeToSelect, onStations, onNetworkStations, onStation, onRouteTarget, onRouteClear, initialData, leaflet }) {
        if (!leaflet?.svgOverlay) throw new Error('Map library unavailable');
        const response = await fetch('familiar-tube.svg?v=20261115g');
        if (!response.ok) throw new Error('Authored diagram unavailable');
        const text = await response.text();
        if (text.length > 300000) throw new Error('Invalid diagram size');
        const doc = new DOMParser().parseFromString(text, 'image/svg+xml'), svg = doc.documentElement;
        if (svg.localName !== 'svg' || doc.querySelector('parsererror,script,foreignObject,animate,set,image,a')) throw new Error('Invalid static diagram');
        if (/@import|url\(/i.test(svg.querySelector('style')?.textContent || '')) throw new Error('External diagram styles are not allowed');
        for (const node of [svg, ...svg.querySelectorAll('*')]) for (const attr of node.attributes) {
            if (/^on/i.test(attr.name) || /href$/i.test(attr.name) && !attr.value.startsWith('#')) throw new Error('Unsafe diagram reference');
        }
        const metadata = JSON.parse(svg.querySelector('#journey-layout').textContent), ref = reference(initialData);
        const positions = metadata.positions;
        if ([...ref.stations.keys()].some(id => !Array.isArray(positions[id]) || !positions[id].length || positions[id].some(p => p.length !== 2 || p.some(v => !Number.isFinite(v))))) throw new Error('Incomplete diagram station positions');
        const map = leaflet.map(element, { crs: leaflet.CRS.Simple, minZoom: -3, maxZoom: 2, zoomSnap: .25, attributionControl: false });
        const [x, y, width, height] = svg.getAttribute('viewBox').split(/\s+/).map(Number);
        leaflet.svgOverlay(svg, [[-y-height, x], [-y, x+width]], { interactive: true }).addTo(map);
        const overlay = leaflet.layerGroup().addTo(map), pathCache = new Map();
        let activeBounds = null, keyLabels = [];
        function pathsFor(line) {
            if (!pathCache.has(line)) pathCache.set(line, [...svg.querySelectorAll(`path[data-line="${line}"]`)].map(path => {
                const length = path.getTotalLength(), samples = [];
                for (let d = 0; d < length; d += 2) { const p = path.getPointAtLength(d); samples.push([p.x, p.y]); }
                const last = path.getPointAtLength(length); samples.push([last.x, last.y]); return { samples };
            }));
            return pathCache.get(line);
        }
        const pointsFor = (id, line) => {
            const options = positions[id];
            const candidates = pathsFor(line).map(path => nearest(options, path.samples)).filter(Boolean).sort((a, b) => a.distance - b.distance);
            return candidates[0]?.point || options[0];
        };
        function frameRoute() { if (activeBounds?.length) map.fitBounds(activeBounds, { paddingTopLeft: [80, 75], paddingBottomRight: [80, 75], maxZoom: 1 }); }
        function positionLabels() {
            if (!activeBounds || !keyLabels.length) return;
            const size = map.getSize();
            const keys = keyLabels.map(({key,marker})=>({ ...key, ...map.latLngToContainerPoint(marker.getLatLng()) }));
            const directions = labelDirections(keys,activeBounds.map(p=>map.latLngToContainerPoint(p)),size.x,size.y);
            for (const {key,marker} of keyLabels) {
                const tooltip = marker.getTooltip(), direction = directions.get(key.id);
                tooltip.options.direction = direction;
                tooltip.options.offset = leaflet.point(direction==='left'?-12:direction==='right'?12:0,direction==='top'?-12:direction==='bottom'?12:0);
                tooltip.setLatLng(marker.getLatLng());
            }
        }
        map.on('moveend zoomend',positionLabels);
        function clearRoute() {
            keyLabels = []; overlay.clearLayers(); svg.classList.remove('route-focused'); activeBounds = null;
            svg.querySelectorAll('[data-line]').forEach(path => { path.style.opacity = ''; });
            svg.querySelectorAll('[data-on-route]').forEach(node => node.removeAttribute('data-on-route'));
            onRouteClear?.();
            status.textContent = 'Hand-positioned Tube diagram. Pinch or use + to read more stations.';
        }
        map.clearRoute = clearRoute;
        map.showJourney = journey => {
            clearRoute(); const plan = routePlan(journey, ref), bounds = [], projected = [];
            for (const segment of plan.segments) {
                const points = projectedSegment(pathsFor(segment.line), positions[segment.from], positions[segment.to]);
                if (!points) { plan.problems.push('unmapped_artwork_segment'); continue; }
                const path = points.map(([x, y]) => [-y, x]); bounds.push(...path);
                projected.push({ ...segment, path });
            }
            if (!projected.length) { status.textContent = 'This route cannot be highlighted reliably. Use the itinerary below; no connection has been invented.'; return { complete: false, drawn: 0 }; }
            svg.classList.add('route-focused');
            const stopIds = new Set(plan.stops.map(s => s.id));
            svg.querySelectorAll('[data-station],[data-label]').forEach(node => {
                if (stopIds.has(node.getAttribute('data-station') || node.getAttribute('data-label'))) node.setAttribute('data-on-route','');
            });
            for (const segment of projected) {
                const colour = network.networkLines.find(([id]) => id === segment.line)[1];
                leaflet.polyline(segment.path, { color: '#fff', weight: 10, opacity: 1, interactive: false }).addTo(overlay);
                leaflet.polyline(segment.path, { color: colour, weight: 6, opacity: 1, interactive: false }).addTo(overlay);
            }
            activeBounds = bounds; frameRoute();
            for (const stop of plan.stops) {
                const point = pointsFor(stop.id, stop.line);
                const marker = leaflet.circleMarker([-point[1], point[0]], { radius: plan.keys.some(k => k.id === stop.id) ? 6 : 3, color: '#14213b', fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(overlay);
                marker.on('click', () => openStation(stop.id));
                const key = plan.keys.find(k => k.id === stop.id);
                if (key) {
                    const label = document.createElement('div'), role = document.createElement('small'), name = document.createElement('b');
                    role.textContent = key.role === 'from' ? 'START' : key.role === 'to' ? 'DESTINATION' : 'CHANGE'; name.textContent = stop.name; label.append(role, name);
                    marker.bindTooltip(label, { permanent: true, opacity: 1, direction: 'top', className: 'tube-selected-label' });
                    keyLabels.push({key,marker});
                } else marker.bindTooltip(stop.name, { className: 'tube-selected-label' });
            }
            positionLabels();
            const complete = plan.complete && !plan.problems.length && projected.length === plan.segments.length;
            status.textContent = complete ? `Selected ${plan.tubeOnly ? 'Tube route' : 'Tube portion of your route'} highlighted. Start, destination and changes are labelled. Other lines are faded.`
                : 'Partial route highlight: some sections could not be matched safely. Follow the full itinerary below.';
            return { complete, drawn: projected.length, stops: plan.stops.length };
        };
        map.fitRoute = frameRoute;
        map.fitRoutes = () => { const all = Object.values(positions).flat(); map.fitBounds(all.map(([x,y]) => [-y,x]), { padding: [25,25] }); };
        map.showCentral = () => { map.setView([-620, 1340], .25); };
        map.setMode = () => {};
        map.focusLocation = point => {
            const station = [...ref.stations.values()].sort((a,b) => Math.hypot(a.lat-point[0],(a.lon-point[1])*.62) - Math.hypot(b.lat-point[0],(b.lon-point[1])*.62))[0];
            clearRoute(); const p = positions[station.id][0]; map.setView([-p[1],p[0]],1); map.focusedStation = station.name;
        };
        map.focusLine = line => {
            clearRoute();
            svg.querySelectorAll('[data-line]').forEach(path => { path.style.opacity = path.dataset.line === line ? '1' : '.12'; });
            const stations = [...ref.stations.values()].filter(s => s.lineIds.includes(line));
            map.fitBounds(stations.map(s => { const p=pointsFor(s.id,line); return [-p[1],p[0]]; }), { padding: [30,30] });
            status.textContent = `${line.replace(/-/g,' ')} highlighted. Diagram only; check service status separately.`;
        };
        function openStation(id) {
            const station = ref.stations.get(id); if (!station) return;
            const content = document.createElement('div'), name = document.createElement('b'); name.textContent = station.name; content.append(name);
            for (const [label, action] of [['Next trains & station', () => onStation(station)], ['Set starting station', () => {
                routeFromSelect.value = id; routeFromSelect.dispatchEvent(new Event('change', { bubbles: true })); map.closePopup();
            }], ['Route to this station', () => onRouteTarget(station)]]) {
                const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.addEventListener('click', action); content.append(button);
            }
            const p = positions[id][0]; leaflet.popup().setLatLng([-p[1],p[0]]).setContent(content).openOn(map);
        }
        svg.addEventListener('click', event => { const id = event.target.closest('[data-station]')?.getAttribute('data-station'); if (id) openStation(id); });
        svg.addEventListener('keydown', event => { if (['Enter',' '].includes(event.key)) { event.preventDefault(); const id=event.target.closest('[data-station]')?.getAttribute('data-station'); if(id)openStation(id); } });
        const stations = [...ref.stations.values()].sort((a,b) => a.name.localeCompare(b.name));
        for (const select of [stationSelect, routeFromSelect, routeToSelect]) {
            select.replaceChildren();
            const seeds = select === routeFromSelect ? [['','Choose starting station'],['here','Phone location'],['home','Saved Home']]
                : [['', select === stationSelect ? 'Find a station on the map' : 'Choose destination station']];
            for (const [value, text] of seeds.concat(stations.map(s => [s.id,s.name]))) { const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option); }
            select.disabled = false;
        }
        stationSelect.addEventListener('change', () => {
            const station = ref.stations.get(stationSelect.value); if (!station) return;
            map.clearRoute(); const p=positions[station.id][0]; map.setView([-p[1],p[0]],1); openStation(station.id);
        });
        onStations(stations); onNetworkStations(stations); map.showCentral(); map.invalidateSize();
        return map;
    }
    return { reference, routePlan, projectedSegment, labelDirections, mount };
}));
