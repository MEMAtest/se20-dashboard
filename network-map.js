(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.JourneyNetworkMap = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const lines = [
        ['bakerloo', '#B36305'], ['central', '#E32017'], ['circle', '#FFD300'],
        ['district', '#00782A'], ['hammersmith-city', '#F3A9BB'], ['jubilee', '#A0A5A9'],
        ['metropolitan', '#9B0056'], ['northern', '#171717'], ['piccadilly', '#003688'],
        ['victoria', '#0098D4'], ['waterloo-city', '#95CDBA']
    ];
    const modes = Object.freeze({ tube: 'Underground', overground: 'Overground', dlr: 'DLR',
        'elizabeth-line': 'Elizabeth line', tram: 'Tram', 'national-rail': 'National Rail', bus: 'Bus' });
    const extraLines = [
        ['dlr', '#00afad', 'dlr'], ['elizabeth', '#6950a1', 'elizabeth-line'],
        ['liberty', '#61686b', 'overground'], ['lioness', '#e5a900', 'overground'], ['mildmay', '#168ac5', 'overground'],
        ['suffragette', '#51a226', 'overground'], ['weaver', '#9b0058', 'overground'], ['windrush', '#dc371b', 'overground'],
        ['tram', '#70af19', 'tram'], ['southern', '#19704a', 'national-rail'],
        ['southeastern', '#183b78', 'national-rail'], ['thameslink', '#c44687', 'national-rail']
    ];
    const networkLines = [...lines.map(([id, color]) => [id, color, 'tube']), ...extraLines];
    const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{3,80}$/.test(value);
    const safeLineId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
    function networkStationReference(station) {
        if (!station || !safeId(station.id) || typeof (station.name || station.commonName) !== 'string'
            || (station.name || station.commonName).length > 200 || !Number.isFinite(station.lat) || !Number.isFinite(station.lon)
            || station.lat < 49 || station.lat > 61 || station.lon < -9 || station.lon > 3) return null;
        const served = Array.isArray(station.modes) ? [...new Set(station.modes.filter(m => modes[m]))] : [];
        if (!served.some(m => m !== 'bus')) return null;
        return { id: station.id, name: station.name || station.commonName, lat: station.lat, lon: station.lon, modes: served,
            lineIds: (Array.isArray(station.lines) ? station.lines : []).map(l => l.id).filter(safeId).slice(0, 60) };
    }
    function lineMode(line) {
        return modes[line?.modeName] ? line.modeName : networkLines.find(([id]) => id === line?.id)?.[2] || 'national-rail';
    }
    function statusSummary(line) {
        const statuses = (Array.isArray(line?.lineStatuses) ? line.lineStatuses : []).filter(Boolean).slice(0, 30);
        const score = s => /suspend|closure|closed|severe|not running/i.test(s.statusSeverityDescription || '') ? 3
            : /good service/i.test(s.statusSeverityDescription || '') ? 0 : 1;
        const primary = [...statuses].sort((a, b) => score(b) - score(a))[0];
        const text = typeof primary?.statusSeverityDescription === 'string' ? primary.statusSeverityDescription : 'Unknown';
        return { text, tone: !primary || text === 'Unknown' ? 'unknown' : score(primary) === 0 ? 'good' : score(primary) === 3 ? 'bad' : 'warn', statuses };
    }
    function stationProfile(raw, requested) {
        const ref = networkStationReference(requested);
        if (!raw || !ref) throw new Error('Station information unavailable.');
        const ids = []; let visited = 0;
        const walk = (node, depth) => {
            if (!node || depth > 4 || ++visited > 500) return;
            if (safeId(node.id)) ids.push(node.id);
            (Array.isArray(node.children) ? node.children : []).slice(0, 100).forEach(n => walk(n, depth + 1));
        };
        walk(raw, 0);
        if (!ids.includes(ref.id)) throw new Error('The provider returned a different station.');
        const properties = {};
        (Array.isArray(raw.additionalProperties) ? raw.additionalProperties : []).slice(0, 100).forEach(p => {
            if (typeof p.key === 'string' && typeof p.value === 'string') properties[p.key] = p.value.slice(0, 600);
        });
        const priority = ['tube', 'dlr', 'overground', 'elizabeth-line', 'tram', 'national-rail', 'bus'];
        const actualModes = [...new Set((Array.isArray(raw.modes) ? raw.modes : []).filter(m => modes[m]))].sort((a, b) => priority.indexOf(a) - priority.indexOf(b));
        const modeByLine = new Map();
        (Array.isArray(raw.lineModeGroups) ? raw.lineModeGroups : []).forEach(g => {
            if (modes[g.modeName]) (Array.isArray(g.lineIdentifier) ? g.lineIdentifier : []).filter(safeLineId).forEach(id => modeByLine.set(id, g.modeName));
        });
        const services = (Array.isArray(raw.lines) ? raw.lines : []).filter(l => safeLineId(l.id) && typeof l.name === 'string').slice(0, 80)
            .map(l => ({ id: l.id, name: l.name.slice(0, 200), mode: modeByLine.get(l.id) || null }))
            .sort((a, b) => (priority.indexOf(a.mode) < 0 ? 99 : priority.indexOf(a.mode))
                - (priority.indexOf(b.mode) < 0 ? 99 : priority.indexOf(b.mode)) || a.name.localeCompare(b.name, 'en', { numeric: true }));
        const arrivalsIds = [...new Set(ids.filter(id => /^(940G|910G)/.test(id)))].slice(0, 6);
        return { ...ref, name: typeof raw.commonName === 'string' ? raw.commonName.slice(0, 200) : ref.name,
            modes: actualModes, services, properties, arrivalsIds,
            zone: properties.Zone || null, address: properties.Address || null };
    }
    function verifiedArrivals(data, ids, now = Date.now()) {
        if (!Array.isArray(data)) throw new Error('No valid departure response.');
        const seen = new Set();
        return data.filter(a => {
            const stamp = Date.parse(a?.timestamp), arrival = Date.parse(a?.expectedArrival);
            return ids.includes(a?.naptanId) && modes[a.modeName] && a.modeName !== 'bus'
                && typeof a.destinationName === 'string' && Number.isFinite(stamp) && now - stamp <= 90000 && stamp <= now + 30000
                && Number.isFinite(arrival) && arrival >= now && arrival - now < 6 * 3600000;
        }).sort((a, b) => Date.parse(a.expectedArrival) - Date.parse(b.expectedArrival)).filter(a => {
            const key = `${a.id || ''}:${a.lineId}:${a.vehicleId}:${a.expectedArrival}:${a.naptanId}`;
            if (seen.has(key)) return false;
            seen.add(key); return true;
        }).slice(0, 20);
    }
    function londonRailPaths(paths, mode) {
        if (mode !== 'national-rail') return paths;
        const result = [];
        for (const path of paths) {
            let segment = [];
            for (const point of path) {
                if (point[0] >= 51.2 && point[0] <= 51.78 && point[1] >= -.65 && point[1] <= .4) segment.push(point);
                else { if (segment.length > 1) result.push(segment); segment = []; }
            }
            if (segment.length > 1) result.push(segment);
        }
        return result;
    }
    function stationReference(station) {
        if (!station || !/^(?:940G|HUB)[A-Za-z0-9]+$/.test(station.id || '') || typeof station.name !== 'string'
            || station.name.length > 200 || !station.modes?.includes('tube')
            || !Number.isFinite(station.lat) || !Number.isFinite(station.lon)
            || station.lat < 49 || station.lat > 61 || station.lon < -9 || station.lon > 3) return null;
        return { id: station.id, name: station.name, lat: station.lat, lon: station.lon };
    }
    function geometry(data) {
        if (!data || !Array.isArray(data.lineStrings) || data.lineStrings.length > 100) throw new Error('Invalid network geometry');
        const paths = [];
        for (const raw of data.lineStrings) {
            if (typeof raw !== 'string' || raw.length > 500000) throw new Error('Invalid geometry size');
            const groups = JSON.parse(raw);
            if (!Array.isArray(groups)) throw new Error('Invalid geometry');
            for (const group of groups) {
                if (!Array.isArray(group) || group.length > 10000 || group.some(p => !Array.isArray(p) || p.length !== 2
                    || !p.every(Number.isFinite) || p[0] < -9 || p[0] > 3 || p[1] < 49 || p[1] > 61)) throw new Error('Invalid coordinates');
                if (group.length > 1) paths.push(group.map(([lon, lat]) => [lat, lon]));
            }
        }
        return paths;
    }
    // These are diagram positions, never coordinates used for navigation or routing.
    const diagramAnchors = {
        paddington: [200, 380], bakerstreet: [520, 300], regentspark: [690, 300],
        greatportlandstreet: [810, 210], eustonsquare: [970, 210], euston: [970, 100],
        kingscrossstpancras: [1170, 100], warrenstreet: [850, 320],
        oxfordcircus: [720, 480], bondstreet: [550, 480], marblearch: [370, 480],
        lancastergate: [200, 480], nottinghillgate: [20, 480],
        tottenhamcourtroad: [970, 480], holborn: [1170, 480], chancerylane: [1320, 480],
        stpauls: [1480, 480], bank: [1640, 580], liverpoolstreet: [1810, 350],
        moorgate: [1630, 350], barbican: [1470, 350], farringdon: [1320, 300],
        aldgate: [1980, 530], aldgateeast: [2110, 530], towerhill: [1980, 740],
        monument: [1730, 740], cannonstreet: [1580, 740], mansionhouse: [1430, 740],
        blackfriars: [1270, 740], temple: [1110, 740], embankment: [940, 740],
        charingcross: [940, 640], leicestersquare: [1050, 580], coventgarden: [1170, 580],
        piccadillycircus: [790, 580], greenpark: [610, 660], hydeparkcorner: [430, 660],
        knightsbridge: [260, 660], southkensington: [80, 850], gloucesterroad: [-90, 850],
        earlscourt: [-270, 850], sloanesquare: [260, 850], victoria: [440, 850],
        stjamesspark: [610, 850], westminster: [790, 850], waterloo: [1000, 1000],
        southwark: [1230, 1000], londonbridge: [1480, 1000], bermondsey: [1750, 1150],
        canadawater: [2030, 1150], canarywharf: [2350, 1150], northgreenwich: [2650, 1150],
        canningtown: [2810, 850], westham: [2810, 580], stratford: [2810, 280],
        mileend: [2490, 480], bethnalgreen: [2190, 480], whitechapel: [2210, 740],
        borough: [1480, 1190], elephantcastle: [1310, 1310], kennington: [1130, 1440],
        oval: [1020, 1620], stockwell: [830, 1790], brixton: [1030, 1960]
    };
    const stationKey = name => String(name).toLowerCase().replace(/(underground|rail|dlr|tram) station|tram stop|international/g, '').replace(/[^a-z0-9]/g, '');
    function schematicPath(a, b, offset = 0) {
        const dx = b.x - a.x, dy = b.y - a.y, diagonal = Math.min(Math.abs(dx), Math.abs(dy));
        const bend = Math.abs(dx) > Math.abs(dy)
            ? [b.y, a.x + Math.sign(dx) * diagonal] : [a.y + Math.sign(dy) * diagonal, b.x];
        return [[-a.y + offset, a.x + offset], [-bend[0] + offset, bend[1] + offset], [-b.y + offset, b.x + offset]];
    }
    function schematicLabelDirection(station, edges) {
        const connected = edges.filter(e => e.a.id === station.id || e.b.id === station.id);
        const relevant = connected.some(e => e.mode === 'tube') ? connected.filter(e => e.mode === 'tube') : connected;
        let horizontal = 0, vertical = 0;
        for (const e of relevant) { horizontal += Math.abs(e.a.x - e.b.x); vertical += Math.abs(e.a.y - e.b.y); }
        return horizontal > vertical * 1.3 ? Math.round(station.x / 150) % 2 ? 'top' : 'bottom' : 'right';
    }
    function schematicLabels(points, zoom, width, height) {
        const placed = [], visible = new Set();
        const candidates = points.filter(p => (zoom >= -.75 || p.interchange && zoom >= -2)
            && p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height)
            .sort((a, b) => b.priority - a.priority || Math.hypot(a.x - width / 2, a.y - height / 2) - Math.hypot(b.x - width / 2, b.y - height / 2) || a.id.localeCompare(b.id));
        for (const p of candidates) {
            const w = Math.min(96, Math.max(40, p.name.length * 6.8 + 6)), h = Math.ceil((p.name.length * 6.8 + 6) / 90) * 15 + 4;
            const x = p.direction === 'right' ? p.x + 14 : p.x - w / 2;
            const y = p.direction === 'top' ? p.y - h - 14 : p.direction === 'bottom' ? p.y + 14 : p.y - h / 2;
            const box = { x, y, w, h };
            if (x < 3 || y < 3 || x + w > width - 3 || y + h > height - 3) continue;
            if (placed.some(b => x < b.x + b.w + 7 && x + w + 7 > b.x && y < b.y + b.h + 7 && y + h + 7 > b.y)) continue;
            if (points.some(q => q.id !== p.id && q.x > x - 5 && q.x < x + w + 5 && q.y > y - 5 && q.y < y + h + 5)) continue;
            placed.push(box); visible.add(p.id);
        }
        return visible;
    }
    function schematicLayout(datasets) {
        datasets = [...datasets].sort((a, b) => networkLines.findIndex(l => l[0] === a.definition[0]) - networkLines.findIndex(l => l[0] === b.definition[0]) || a.definition[0].localeCompare(b.definition[0]));
        const stations = new Map(), aliases = new Map(), routes = [];
        for (const { data, definition } of datasets) {
            const [lineId, color, mode] = definition;
            const records = [...(data.stations || []).slice(0, 500), ...(data.stopPointSequences || []).slice(0, 100).flatMap(s => (s.stopPoint || []).slice(0, 500))];
            for (const raw of records) {
                const valid = networkStationReference(raw);
                if (!valid || mode === 'national-rail' && !(valid.lat >= 51.2 && valid.lat <= 51.78 && valid.lon >= -.65 && valid.lon <= .4)) continue;
                const id = /^HUB[A-Za-z0-9]+$/.test(raw.topMostParentId || '') ? raw.topMostParentId : valid.id;
                aliases.set(valid.id, id);
                const prior = stations.get(id);
                if (!prior && stations.size >= 1500) throw new Error('Schematic station limit exceeded.');
                stations.set(id, { ...valid, id, lat: prior?.lat ?? valid.lat, lon: prior?.lon ?? valid.lon,
                    name: prior?.name || valid.name.replace(/ (Underground|Rail|DLR) Station$| Tram Stop$/i, '').replace(' & St Pancras International', ' St Pancras'),
                    modes: [...new Set([...(prior?.modes || []), ...valid.modes])],
                    lineIds: [...new Set([...(prior?.lineIds || []), lineId])] });
            }
            const ordered = (data.orderedLineRoutes || []).slice(0, 100).filter(r => Array.isArray(r.naptanIds) && r.naptanIds.length <= 1000);
            if (!ordered.length) throw new Error('Ordered station topology is unavailable.');
            routes.push({ id: lineId, color, mode, ordered });
        }
        const nodes = [...stations.values()];
        const anchored = nodes.filter(s => diagramAnchors[stationKey(s.name)]);
        for (const s of nodes) {
            const anchor = diagramAnchors[stationKey(s.name)];
            if (anchor) { [s.x, s.y] = anchor; s.fixed = true; }
            else {
                const nearest = anchored.map(a => ({ a, d: Math.hypot((s.lon - a.lon) * .62, s.lat - a.lat) }))
                    .sort((a, b) => a.d - b.d).slice(0, 3);
                let x = 0, y = 0, total = 0;
                for (const { a, d } of nearest) {
                    const w = 1 / Math.max(.0001, d) ** 3, p = diagramAnchors[stationKey(a.name)];
                    x += (p[0] + (s.lon - a.lon) * 14000) * w;
                    y += (p[1] - (s.lat - a.lat) * 22000) * w; total += w;
                }
                s.x = total ? x / total : (s.lon + .12) * 14000 + 1000;
                s.y = total ? y / total : (51.51 - s.lat) * 22000 + 600;
            }
            s.targetX = s.x; s.targetY = s.y;
        }
        // Spread close stops for legible labels without changing the supplied adjacency.
        for (let iteration = 0; iteration < 70; iteration++) {
            for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
                const a = nodes[i], b = nodes[j]; let dx = b.x - a.x, dy = b.y - a.y;
                let distance = Math.hypot(dx, dy);
                if (distance >= 130 || a.fixed && b.fixed) continue;
                if (distance < .01) { dx = (i % 2 ? 1 : -1); dy = 1; distance = Math.SQRT2; }
                const amount = (130 - distance) * .18;
                if (!a.fixed) { a.x -= dx / distance * amount; a.y -= dy / distance * amount; }
                if (!b.fixed) { b.x += dx / distance * amount; b.y += dy / distance * amount; }
            }
            for (const s of nodes) if (!s.fixed) { s.x += (s.targetX - s.x) * .008; s.y += (s.targetY - s.y) * .008; }
        }
        for (const s of nodes) { s.x = Math.round(s.x / 10) * 10; s.y = Math.round(s.y / 10) * 10; }
        const edges = [], seen = new Set(), shared = new Map();
        for (const route of routes) for (const ordered of route.ordered) {
            for (let i = 1; i < ordered.naptanIds.length; i++) {
                const a = stations.get(aliases.get(ordered.naptanIds[i - 1])), b = stations.get(aliases.get(ordered.naptanIds[i]));
                if (!a || !b || a.id === b.id) continue;
                const pair = [a.id, b.id].sort().join('|'), key = `${route.id}:${pair}`;
                if (seen.has(key)) continue;
                seen.add(key); const edge = { ...route, a, b, pair }; delete edge.ordered;
                edges.push(edge); if (!shared.has(pair)) shared.set(pair, []); shared.get(pair).push(edge);
            }
        }
        for (const group of shared.values()) group.sort((a, b) => a.id.localeCompare(b.id)).forEach((e, i) => {
            const [a, b] = e.a.id.localeCompare(e.b.id) < 0 ? [e.a, e.b] : [e.b, e.a];
            e.path = schematicPath(a, b, (i - (group.length - 1) / 2) * 7);
        });
        return { stations, edges, routes };
    }
    async function mount({ element, status, stationSelect, routeFromSelect, routeToSelect, onStations, onNetworkStations, onRouteTarget, onPlanTarget, leaflet, onStation, multiMode = false }) {
        if (!leaflet) { status.textContent = 'The map library is unavailable. Open the official Tube map above.'; return null; }
        const map = leaflet.map(element, { crs: leaflet.CRS?.Simple, minZoom: -4, maxZoom: 2, zoomSnap: .25, attributionControl: false });
        const rawSetView = map.setView.bind(map);
        rawSetView([-650, 1150], -1.25);
        const definitions = multiMode ? networkLines : lines.map(([id, color]) => [id, color, 'tube']);
        const bounds = [], datasets = [], layers = new Map(), markers = []; let loaded = 0;
        status.textContent = 'Loading schematic station connections from TfL...';
        for (let index = 0; index < definitions.length; index += 3) {
            await Promise.all(definitions.slice(index, index + 3).map(async ([id, color, mode]) => {
                try {
                    const response = await fetch(`https://api.tfl.gov.uk/Line/${id}/Route/Sequence/all`, { signal: AbortSignal.timeout(10000) });
                    if (!response.ok) throw new Error('Network source unavailable');
                    const data = await response.json();
                    if (data.lineId !== id) throw new Error('Wrong line');
                    if (!Array.isArray(data.orderedLineRoutes) || !data.orderedLineRoutes.some(r => r.naptanIds?.length > 1)) throw new Error('No ordered connections');
                    datasets.push({ data, definition: [id, color, mode] });
                    loaded++;
                } catch (_) { /* The counter exposes partial network coverage. */ }
            }));
            status.textContent = `${loaded} of ${definitions.length} routes loaded. Network reference, not live service status.`;
        }
        const { stations, edges } = schematicLayout(datasets);
        if (leaflet.polyline) leaflet.polyline([[-1180, -600], [-1180, 300], [-1050, 500], [-920, 700], [-880, 980], [-850, 1250], [-930, 1550], [-1020, 1830], [-950, 2110], [-930, 2450], [-1270, 2850]], {
            color: '#cfe9f8', weight: 24, opacity: .75, interactive: false, lineCap: 'round', lineJoin: 'round'
        }).addTo(map);
        for (const [id, color, mode] of definitions) {
            const paths = edges.filter(e => e.id === id).map(e => e.path);
            if (!paths.length) continue;
            const group = leaflet.layerGroup ? leaflet.layerGroup().addTo(map) : map;
            for (const path of paths) { leaflet.polyline(path, { color, weight: 5, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(group); bounds.push(...path); }
            layers.set(id, { group, mode, paths });
        }
        for (const station of stations.values()) {
            const content = document.createElement('div');
            const label = document.createElement('strong'); label.textContent = station.name;
            const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Open station hub';
            button.addEventListener('click', () => onStation(station));
            content.append(label, document.createElement('br'), button);
            if (onRouteTarget && station.modes.includes('tube')) {
                const route = document.createElement('button'); route.type = 'button'; route.textContent = 'Quickest route here';
                route.addEventListener('click', () => onRouteTarget(station));
                content.append(document.createElement('br'), route);
            }
            if (onPlanTarget) {
                const plan = document.createElement('button'); plan.type = 'button'; plan.textContent = 'Plan a journey here';
                plan.addEventListener('click', () => onPlanTarget(station)); content.append(document.createElement('br'), plan);
            }
            const interchange = station.lineIds.length > 1;
            const marker = leaflet.circleMarker([-station.y, station.x], { radius: interchange ? 6 : 3.5,
                color: '#17233b', weight: interchange ? 2 : 1.5, fillColor: '#fff', fillOpacity: 1 }).addTo(map).bindPopup(content);
            const stationLabel = document.createElement('span'); stationLabel.textContent = station.name;
            const direction = schematicLabelDirection(station, edges);
            if (marker.bindTooltip) marker.bindTooltip(stationLabel, { permanent: true, direction, offset: direction === 'right' ? [9, 0] : [0, direction === 'top' ? -8 : 8], className: 'schematic-label', interactive: false });
            markers.push({ marker, station, interchange, direction });
        }
        const sortedStations = [...stations.values()].sort((a, b) => a.name.localeCompare(b.name));
        const tubeStations = sortedStations.filter(station => station.modes.includes('tube') && /^(940G|HUB)/.test(station.id));
        for (const select of [routeFromSelect, routeToSelect]) {
            if (!select) continue;
            select.replaceChildren();
            const seeds = select === routeFromSelect
                ? [['here', 'Phone location'], ['home', 'Saved Home']]
                : [['', 'Choose destination station']];
            for (const [value, text] of seeds) {
                const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
            }
            for (const station of tubeStations) {
                const option = document.createElement('option'); option.value = station.id; option.textContent = station.name; select.append(option);
            }
            select.disabled = tubeStations.length === 0;
        }
        if (onStations) onStations(tubeStations);
        if (onNetworkStations) onNetworkStations(sortedStations);
        if (stationSelect) {
            stationSelect.replaceChildren();
            const prompt = document.createElement('option'); prompt.value = ''; prompt.textContent = 'Choose a station hub';
            stationSelect.append(prompt);
            for (const station of [...stations.values()].sort((a, b) => a.name.localeCompare(b.name))) {
                const option = document.createElement('option'); option.value = station.id; option.textContent = `${station.name} · ${station.modes.filter(m => m !== 'bus').map(m => modes[m]).join(' / ')}`;
                stationSelect.append(option);
            }
            stationSelect.disabled = stations.size === 0;
            stationSelect.addEventListener('change', () => {
                const station = stations.get(stationSelect.value);
                if (!station) return;
                rawSetView([-station.y, station.x], 0); onStation(station);
            });
        }
        let selectedMode = 'tube', selectedLine = null, favourites = [];
        const refreshLabels = () => {
            if (!map.latLngToContainerPoint || !map.getSize) return;
            const size = map.getSize();
            const current = markers.filter(m => map.hasLayer(m.marker));
            const points = current.map(({ station, interchange, direction }) => ({ ...map.latLngToContainerPoint([-station.y, station.x]), id: station.id, name: station.name, priority: station.lineIds.length, interchange, direction }));
            const visible = schematicLabels(points, map.getZoom(), size.x, size.y);
            for (const { marker, station } of current) { if (visible.has(station.id)) marker.openTooltip(); else marker.closeTooltip(); }
        };
        const apply = () => {
            const visible = ([id, , mode]) => selectedLine ? id === selectedLine : selectedMode === 'all' || (selectedMode === 'favourites' ? favourites.includes(id) : selectedMode === mode);
            const selected = definitions.filter(visible);
            for (const [id, layer] of layers) {
                if (layer.group === map) continue;
                if (selected.some(([key]) => key === id)) map.addLayer(layer.group); else map.removeLayer(layer.group);
            }
            for (const { marker, station } of markers) {
                if (!map.addLayer || !map.removeLayer) continue;
                if (selected.some(([id]) => station.lineIds.includes(id) && layers.has(id))) {
                    map.addLayer(marker);
                } else map.removeLayer(marker);
            }
            if (stationSelect) {
                const previous = stationSelect.value;
                const visibleStations = sortedStations.filter(s => selected.some(([id]) => s.lineIds.includes(id) && layers.has(id)));
                stationSelect.replaceChildren();
                const prompt = document.createElement('option'); prompt.value = ''; prompt.textContent = 'Choose a station hub'; stationSelect.append(prompt);
                for (const station of visibleStations) {
                    const option = document.createElement('option'); option.value = station.id;
                    option.textContent = `${station.name} · ${station.modes.filter(m => m !== 'bus').map(m => modes[m]).join(' / ')}`; stationSelect.append(option);
                }
                stationSelect.disabled = !visibleStations.length;
                stationSelect.value = visibleStations.some(s => s.id === previous) ? previous : '';
            }
            const count = selected.filter(([id]) => layers.has(id)).length;
            const unsupported = selectedLine && !layers.has(selectedLine) || selectedMode === 'favourites' && favourites.some(id => !definitions.some(([key]) => key === id));
            status.textContent = `${selectedLine ? selectedLine + ': ' : ''}${count} of ${selected.length} selected lines drawn. Schematic - not to scale or live service status. ${selectedMode === 'national-rail' ? 'National Rail is limited to Southern, Southeastern and Thameslink in the London area. ' : ''}${count < selected.length || unsupported || !selected.length ? 'Some selected services have no verified schematic connections.' : ''}`;
            refreshLabels();
        };
        map.setMode = (mode, saved = []) => { selectedMode = mode; selectedLine = null; favourites = saved; apply(); };
        map.focusLine = id => {
            selectedLine = id; apply();
            const paths = layers.get(id)?.paths.flat(); if (paths?.length) map.fitBounds(paths, { padding: [18, 18] });
        };
        map.fitRoutes = () => {
            const paths = [...layers.entries()].filter(([id, l]) => selectedLine ? selectedLine === id : selectedMode === 'all' || (selectedMode === 'favourites' ? favourites.includes(id) : l.mode === selectedMode)).flatMap(([, l]) => l.paths.flat());
            if (paths.length) map.fitBounds(paths, { padding: [18, 18] });
        };
        // Public callers pass real-world coordinates; convert only through a verified station.
        map.setView = (point) => {
            const available = definitions.filter(([id, , mode]) => layers.has(id) && (selectedLine ? id === selectedLine : selectedMode === 'all' || (selectedMode === 'favourites' ? favourites.includes(id) : selectedMode === mode))).map(([id]) => id);
            const visible = [...stations.values()].filter(s => s.lineIds.some(id => available.includes(id)));
            const nearest = visible.sort((a, b) => Math.hypot((a.lon - point[1]) * .62, a.lat - point[0]) - Math.hypot((b.lon - point[1]) * .62, b.lat - point[0]))[0];
            if (nearest) { rawSetView([-nearest.y, nearest.x], -.25); map.focusedStation = nearest.name; }
            return map;
        };
        map.on?.('zoomend moveend resize', refreshLabels);
        apply();
        if (!loaded) status.textContent = 'TfL network data is unavailable. Open the official Tube map above.';
        map.invalidateSize(); return map;
    }
    return { geometry, mount, stationReference, networkStationReference, stationProfile, verifiedArrivals, statusSummary, lineMode,
        londonRailPaths, schematicLayout, schematicPath, schematicLabelDirection, schematicLabels, modes, networkLines, tubeLineIds: Object.freeze(lines.map(([id]) => id)) };
}));
