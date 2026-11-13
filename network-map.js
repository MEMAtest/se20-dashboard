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
    async function mount({ element, status, stationSelect, routeFromSelect, routeToSelect, onStations, onRouteTarget, leaflet, onStation }) {
        if (!leaflet) { status.textContent = 'The map library is unavailable. Open the official Tube map above.'; return null; }
        const map = leaflet.map(element).setView([51.51, -0.12], 11);
        leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors · Network data: Transport for London', maxZoom: 18
        }).addTo(map);
        const bounds = []; const stations = new Map(); let loaded = 0;
        status.textContent = 'Loading TfL Tube network…';
        for (let index = 0; index < lines.length; index += 3) {
            await Promise.all(lines.slice(index, index + 3).map(async ([id, color]) => {
                try {
                    const response = await fetch(`https://api.tfl.gov.uk/Line/${id}/Route/Sequence/all`, { signal: AbortSignal.timeout(10000) });
                    if (!response.ok) throw new Error('Network source unavailable');
                    const data = await response.json();
                    if (data.lineId !== id) throw new Error('Wrong line');
                    for (const path of geometry(data)) { leaflet.polyline(path, { color, weight: 4, opacity: .9 }).addTo(map); bounds.push(...path); }
                    for (const raw of (data.stations || []).slice(0, 500)) {
                        const station = stationReference(raw);
                        if (station) stations.set(station.id, station);
                    }
                    loaded++;
                } catch (_) { /* The counter exposes partial network coverage. */ }
            }));
            status.textContent = `${loaded} of ${lines.length} Tube lines loaded. Network reference, not live service status.`;
        }
        for (const station of stations.values()) {
            const content = document.createElement('div');
            const label = document.createElement('strong'); label.textContent = station.name;
            const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Show live arrivals';
            button.addEventListener('click', () => onStation(station));
            content.append(label, document.createElement('br'), button);
            if (onRouteTarget) {
                const route = document.createElement('button'); route.type = 'button'; route.textContent = 'Quickest route here';
                route.addEventListener('click', () => onRouteTarget(station));
                content.append(document.createElement('br'), route);
            }
            leaflet.circleMarker([station.lat, station.lon], { radius: 4, color: '#17233b', weight: 1, fillColor: '#fff', fillOpacity: 1 }).addTo(map).bindPopup(content);
        }
        const sortedStations = [...stations.values()].sort((a, b) => a.name.localeCompare(b.name));
        for (const select of [routeFromSelect, routeToSelect]) {
            if (!select) continue;
            select.replaceChildren();
            const seeds = select === routeFromSelect
                ? [['here', 'Phone location'], ['home', 'Saved Home']]
                : [['', 'Choose destination station']];
            for (const [value, text] of seeds) {
                const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
            }
            for (const station of sortedStations) {
                const option = document.createElement('option'); option.value = station.id; option.textContent = station.name; select.append(option);
            }
            select.disabled = stations.size === 0;
        }
        if (onStations) onStations(sortedStations);
        if (stationSelect) {
            stationSelect.replaceChildren();
            const prompt = document.createElement('option'); prompt.value = ''; prompt.textContent = 'Choose a station for live arrivals';
            stationSelect.append(prompt);
            for (const station of [...stations.values()].sort((a, b) => a.name.localeCompare(b.name))) {
                const option = document.createElement('option'); option.value = station.id; option.textContent = station.name;
                stationSelect.append(option);
            }
            stationSelect.disabled = stations.size === 0;
            stationSelect.addEventListener('change', () => {
                const station = stations.get(stationSelect.value);
                if (!station) return;
                map.setView([station.lat, station.lon], 14); onStation(station);
            });
        }
        if (bounds.length) map.fitBounds(bounds, { padding: [14, 14] });
        if (!loaded) status.textContent = 'TfL network data is unavailable. Open the official Tube map above.';
        map.invalidateSize(); return map;
    }
    return { geometry, mount, stationReference, tubeLineIds: Object.freeze(lines.map(([id]) => id)) };
}));
