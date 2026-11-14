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
    async function mount({ element, status, stationSelect, routeFromSelect, routeToSelect, onStations, onNetworkStations, onRouteTarget, onPlanTarget, leaflet, onStation, multiMode = false }) {
        if (!leaflet) { status.textContent = 'The map library is unavailable. Open the official Tube map above.'; return null; }
        const map = leaflet.map(element).setView([51.51, -0.12], 11);
        leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors · Network data: Transport for London', maxZoom: 18
        }).addTo(map);
        const definitions = multiMode ? networkLines : lines.map(([id, color]) => [id, color, 'tube']);
        const bounds = []; const stations = new Map(); const layers = new Map(); const markers = []; let loaded = 0;
        status.textContent = 'Loading TfL network routes...';
        for (let index = 0; index < definitions.length; index += 3) {
            await Promise.all(definitions.slice(index, index + 3).map(async ([id, color, mode]) => {
                try {
                    const response = await fetch(`https://api.tfl.gov.uk/Line/${id}/Route/Sequence/all`, { signal: AbortSignal.timeout(10000) });
                    if (!response.ok) throw new Error('Network source unavailable');
                    const data = await response.json();
                    if (data.lineId !== id) throw new Error('Wrong line');
                    const paths = londonRailPaths(geometry(data), mode);
                    if (!paths.length) throw new Error('No mapped route segments');
                    const group = leaflet.layerGroup ? leaflet.layerGroup().addTo(map) : map;
                    for (const path of paths) { leaflet.polyline(path, { color, weight: mode === 'national-rail' ? 3 : 4, opacity: .85 }).addTo(group); bounds.push(...path); }
                    layers.set(id, { group, mode, paths });
                    for (const raw of (data.stations || []).slice(0, 500)) {
                        const valid = multiMode ? networkStationReference(raw) : stationReference(raw);
                        if (valid) {
                            const prior = stations.get(valid.id);
                            const station = { ...valid, modes: [...new Set([...(prior?.modes || []), ...(valid.modes || ['tube'])])], lineIds: [...new Set([...(prior?.lineIds || []), ...(valid.lineIds || []), id])] };
                            if (mode === 'national-rail' && !(station.lat >= 51.2 && station.lat <= 51.78 && station.lon >= -.65 && station.lon <= .4)) continue;
                            stations.set(station.id, station);
                        }
                    }
                    loaded++;
                } catch (_) { /* The counter exposes partial network coverage. */ }
            }));
            status.textContent = `${loaded} of ${definitions.length} routes loaded. Network reference, not live service status.`;
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
            const marker = leaflet.circleMarker([station.lat, station.lon], { radius: station.modes.filter(m => m !== 'bus').length > 1 ? 5 : 3,
                color: '#17233b', weight: 1.5, fillColor: '#fff', fillOpacity: 1 }).addTo(map).bindPopup(content);
            markers.push({ marker, station });
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
                map.setView([station.lat, station.lon], 14); onStation(station);
            });
        }
        let selectedMode = 'all', selectedLine = null, favourites = [];
        const apply = () => {
            const visible = ([id, , mode]) => selectedLine ? id === selectedLine : selectedMode === 'all' || (selectedMode === 'favourites' ? favourites.includes(id) : selectedMode === mode);
            const selected = definitions.filter(visible);
            for (const [id, layer] of layers) {
                if (layer.group === map) continue;
                if (selected.some(([key]) => key === id)) map.addLayer(layer.group); else map.removeLayer(layer.group);
            }
            for (const { marker, station } of markers) {
                if (!map.addLayer || !map.removeLayer) continue;
                if (selected.some(([id]) => station.lineIds.includes(id) && layers.has(id))) map.addLayer(marker); else map.removeLayer(marker);
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
            status.textContent = `${selectedLine ? selectedLine + ': ' : ''}${count} of ${selected.length} selected routes loaded. ${selectedMode === 'national-rail' ? 'National Rail is limited to Southern, Southeastern and Thameslink in the London area. ' : ''}Network reference, not live service status.${count < selected.length || unsupported || !selected.length ? ' Some selected services have no available map geometry.' : ''}`;
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
        if (bounds.length) map.fitBounds(bounds, { padding: [14, 14] });
        if (!loaded) status.textContent = 'TfL network data is unavailable. Open the official Tube map above.';
        map.invalidateSize(); return map;
    }
    return { geometry, mount, stationReference, networkStationReference, stationProfile, verifiedArrivals, statusSummary, lineMode,
        londonRailPaths, modes, networkLines, tubeLineIds: Object.freeze(lines.map(([id]) => id)) };
}));
