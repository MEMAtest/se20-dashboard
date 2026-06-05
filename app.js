// Penge Dash SE20 - Main Application

const PLATFORM_DIRECTIONS = {
    pnw: { '1': '→ Victoria', '2': '→ London Br' },
    pne: { '1': '→ London Br', '2': '→ Orpington' },
    bkb: { '1': '→ Elmers End', '2': '→ Wimbledon' },
    anr: { '1': '→ Highbury & Islington', '2': '→ West Croydon' }
};

// The 6 named Overground lines (TfL rename, late 2024)
const OVERGROUND_LINES = ['liberty', 'lioness', 'mildmay', 'suffragette', 'weaver', 'windrush'];

// Display name + CSS class per line id (Overground + common National Rail TOCs)
const LINE_META = {
    'liberty':     { name: 'Liberty',     class: 'overground' },
    'lioness':     { name: 'Lioness',     class: 'overground' },
    'mildmay':     { name: 'Mildmay',     class: 'overground' },
    'suffragette': { name: 'Suffragette', class: 'overground' },
    'weaver':      { name: 'Weaver',      class: 'overground' },
    'windrush':    { name: 'Windrush',    class: 'overground' },
    'jubilee':     { name: 'Jubilee',     class: 'jubilee' },
    'northern':    { name: 'Northern',    class: 'northern' },
    'victoria':    { name: 'Victoria',    class: 'victoria' },
    'elizabeth':   { name: 'Elizabeth',   class: 'elizabeth' },
    'central':     { name: 'Central',     class: 'central' },
    'district':    { name: 'District',    class: 'district' },
    'bakerloo':    { name: 'Bakerloo',    class: 'bakerloo' },
    'piccadilly':  { name: 'Piccadilly',  class: 'piccadilly' },
    'dlr':         { name: 'DLR',         class: 'dlr' },
    'southern':     { name: 'Southern',     class: 'southern' },
    'southeastern': { name: 'Southeastern', class: 'southeastern' },
    'thameslink':   { name: 'Thameslink',   class: 'thameslink' }
};

class PengeDash {
    constructor() {
        this.isRefreshing = false;
        this.stationData = {}; // Store all departures for modal
        this.home = null;              // {lat, lon, postcode, label, isDefault}
        this.savedPlaces = [];         // [{label, postcode, lat, lon}]
        this.nearbyStations = [];      // dynamic stations (relocated homes)
        this.nearbyBusStops = [];      // dynamic bus stops (relocated homes)
        this.lineStatusData = {};      // {id: {status, reason, disruption, name}}
        this.init();
    }

    init() {
        // Load persisted home + saved places before anything renders
        this.loadHome();
        this.loadSavedPlaces();
        this.loadCachedNearby();
        this.updateHeaderLocation();

        this.updateClock();
        this.updateGreeting();
        setInterval(() => this.updateClock(), 1000);
        setInterval(() => this.updateGreeting(), 60000); // Update greeting every minute

        // Auto dark mode (8pm - 6am)
        this.updateTheme();
        setInterval(() => this.updateTheme(), 60000); // Check every minute

        // Setup offline detection
        this.setupOfflineDetection();

        // If starting offline, load cached data immediately
        if (!navigator.onLine) {
            this.loadCachedData();
        }

        // Bind refresh button
        document.getElementById('refresh-btn').addEventListener('click', () => this.refreshAll());

        // Bind collapsible toggles
        document.getElementById('coming-soon-toggle').addEventListener('click', () => this.toggleComingSoon());
        document.getElementById('line-status-toggle').addEventListener('click', () => this.toggleLineStatus());

        // Bind alert close (stopPropagation so it doesn't open the detail modal)
        document.getElementById('alert-close').addEventListener('click', (e) => {
            e.stopPropagation();
            this.hideAlert();
        });
        // Tap the alert banner to see full disruption detail
        document.getElementById('service-alert').addEventListener('click', () => this.openAlertModal());

        // Setup pull-to-refresh
        this.setupPullToRefresh();

        // Create modals (next trains + generic detail)
        this.createModal();

        // Setup journey planner
        this.setupJourneyPlanner();

        // Settings (home postcode + saved places) and quick-nav
        this.setupSettings();
        this.setupQuickNav();

        // Map (Leaflet) — guarded if library/offline
        this.initMap();

        // Reflect saved home in the journey "from" label + curated-vs-dynamic cards
        this.applyHomeToJourney();
        this.applyHomeMode();
        // Show a "finding nearby…" placeholder if relocated and not yet detected
        if (!this.home.isDefault) this.renderNearbySection(this.nearbyStations.length === 0);

        // Initial data load
        this.refreshAll();

        // Detect nearby stops — for the map always, and for cards when relocated
        if (this.nearbyStations.length === 0) {
            this.detectNearbyForHome();
        } else {
            this.updateMap();
        }

        // Set up auto-refresh intervals
        this.setupAutoRefresh();

        // Keep Darwin backend alive only for the SE20 default (it serves SE20 only)
        if (this.home.isDefault) this.pingDarwinBackend();
    }

    // ==================== HOME / SAVED PLACES PERSISTENCE ====================
    loadHome() {
        try {
            const saved = localStorage.getItem('pengedash-home');
            this.home = saved ? JSON.parse(saved) : { ...CONFIG.DEFAULT_HOME };
        } catch (e) {
            this.home = { ...CONFIG.DEFAULT_HOME };
        }
        // Back-compat / safety: ensure required fields exist (lat/lon may legitimately be 0)
        if (!this.home || this.home.lat == null || this.home.lon == null) this.home = { ...CONFIG.DEFAULT_HOME };
        if (this.home.isDefault === undefined) {
            this.home.isDefault = (this.home.postcode || '').replace(/\s/g, '').toUpperCase()
                === CONFIG.DEFAULT_HOME.postcode.replace(/\s/g, '').toUpperCase();
        }
    }

    saveHome() {
        try {
            localStorage.setItem('pengedash-home', JSON.stringify(this.home));
        } catch (e) { /* ignore quota */ }
    }

    loadSavedPlaces() {
        try {
            const saved = localStorage.getItem('pengedash-saved-places');
            this.savedPlaces = saved ? JSON.parse(saved) : [];
        } catch (e) {
            this.savedPlaces = [];
        }
    }

    saveSavedPlace(place) {
        if (!place || !place.label) return;
        this.savedPlaces = this.savedPlaces.filter(
            p => p.label.toLowerCase() !== place.label.toLowerCase()
        );
        this.savedPlaces.unshift(place);
        this.savedPlaces = this.savedPlaces.slice(0, 8);
        try {
            localStorage.setItem('pengedash-saved-places', JSON.stringify(this.savedPlaces));
        } catch (e) { /* ignore */ }
    }

    removeSavedPlace(label) {
        this.savedPlaces = this.savedPlaces.filter(
            p => p.label.toLowerCase() !== label.toLowerCase()
        );
        try {
            localStorage.setItem('pengedash-saved-places', JSON.stringify(this.savedPlaces));
        } catch (e) { /* ignore */ }
    }

    loadCachedNearby() {
        const cached = this.getCachedData('nearby-cache');
        if (cached && cached.home && cached.home === (this.home && this.home.postcode)) {
            this.nearbyStations = cached.stations || [];
            this.nearbyBusStops = cached.busStops || [];
        }
    }

    updateHeaderLocation() {
        const el = document.getElementById('header-location');
        if (el && this.home) {
            // Show the postcode district (e.g. "SE20") or label
            const pc = (this.home.postcode || '').toUpperCase();
            const district = pc.split(' ')[0] || this.home.label || 'Home';
            el.textContent = district;
        }
    }

    applyHomeToJourney() {
        const fromText = document.getElementById('from-text');
        if (fromText && this.home && this.journeyOrigin !== 'here') {
            fromText.textContent = this.home.label || `Home (${(this.home.postcode || '').split(' ')[0]})`;
        }
    }

    // Show curated SE20 cards for the default home; show dynamic nearby cards when relocated
    applyHomeMode() {
        const se20Cards = document.querySelectorAll('.se20-card');
        const nearby = document.getElementById('nearby-section');
        if (this.home && this.home.isDefault) {
            se20Cards.forEach(c => { c.style.display = ''; });
            if (nearby) nearby.style.display = 'none';
        } else {
            se20Cards.forEach(c => { c.style.display = 'none'; });
            if (nearby) nearby.style.display = '';
        }
    }

    // ==================== GEOCODING + NEARBY DETECTION ====================
    async geocodePostcode(postcode) {
        const clean = (postcode || '').trim();
        if (!clean) throw new Error('Empty postcode');

        // Primary: postcodes.io (free, no key, CORS-enabled)
        try {
            const res = await fetch(`${CONFIG.GEOCODE_URL}/postcodes/${encodeURIComponent(clean)}`);
            if (res.ok) {
                const json = await res.json();
                if (json.result) {
                    return {
                        lat: json.result.latitude,
                        lon: json.result.longitude,
                        postcode: json.result.postcode || clean.toUpperCase(),
                        label: `Home (${(json.result.postcode || clean).split(' ')[0].toUpperCase()})`
                    };
                }
            }
        } catch (e) { /* fall through to TfL */ }

        // Fallback: TfL StopPoint search (handles place names too)
        let url = `https://api.tfl.gov.uk/StopPoint/Search?query=${encodeURIComponent(clean)}&maxResults=1`;
        if (CONFIG.TFL_APP_KEY) url += `&app_id=${CONFIG.TFL_APP_ID}&app_key=${CONFIG.TFL_APP_KEY}`;
        const res = await fetch(url);
        const data = await res.json();
        const match = data.matches && data.matches[0];
        if (match && match.lat != null && match.lon != null) {
            return {
                lat: match.lat,
                lon: match.lon,
                postcode: clean.toUpperCase(),
                label: `Home (${match.name})`
            };
        }
        throw new Error('Could not find that postcode or place');
    }

    async detectNearby(lat, lon, radius) {
        const stationRadius = radius || CONFIG.NEARBY.stationRadius;
        const tflAuth = CONFIG.TFL_APP_KEY ? `&app_id=${CONFIG.TFL_APP_ID}&app_key=${CONFIG.TFL_APP_KEY}` : '';

        const stationsUrl = `https://api.tfl.gov.uk/StopPoint?lat=${lat}&lon=${lon}` +
            `&stopTypes=NaptanMetroStation,NaptanRailStation&radius=${stationRadius}${tflAuth}`;
        const busUrl = `https://api.tfl.gov.uk/StopPoint?lat=${lat}&lon=${lon}` +
            `&stopTypes=NaptanPublicBusCoachTram&radius=${CONFIG.NEARBY.busRadius}${tflAuth}`;

        const [stationsRes, busRes] = await Promise.all([
            fetch(stationsUrl).then(r => r.json()).catch(() => ({ stopPoints: [] })),
            fetch(busUrl).then(r => r.json()).catch(() => ({ stopPoints: [] }))
        ]);

        const seenStation = new Set();
        const stations = (stationsRes.stopPoints || [])
            .sort((a, b) => (a.distance || 0) - (b.distance || 0))
            .map(sp => ({
                id: sp.id || sp.naptanId,
                name: this.cleanStationName(sp.commonName || ''),
                modes: sp.modes || [],
                lat: sp.lat,
                lon: sp.lon,
                distance: Math.round(sp.distance || 0),
                lines: (sp.lines || []).map(l => ({ id: l.id, name: l.name })),
                platformDirections: {}
            }))
            // Drop entries with no usable id/name, then dedup hub variants, keep nearest
            .filter(s => {
                if (!s.id || !s.name) return false;
                const key = s.name.toLowerCase();
                if (seenStation.has(key)) return false;
                seenStation.add(key);
                return true;
            })
            .slice(0, CONFIG.NEARBY.maxStations);

        const busStops = (busRes.stopPoints || [])
            .filter(sp => sp.id || sp.naptanId)
            .sort((a, b) => (a.distance || 0) - (b.distance || 0))
            .slice(0, CONFIG.NEARBY.maxBusStops)
            .map(sp => ({
                id: sp.id || sp.naptanId,
                name: (sp.commonName || '').replace(/ \(Stop [A-Z0-9]+\)$/i, ''),
                indicator: sp.stopLetter || sp.indicator || '',
                towards: this._stopProp(sp, 'Towards') || sp.towards || '',
                lat: sp.lat,
                lon: sp.lon,
                distance: Math.round(sp.distance || 0)
            }));

        return { stations, busStops };
    }

    _stopProp(stopPoint, key) {
        const props = stopPoint.additionalProperties || [];
        const found = props.find(p => p.key === key);
        return found ? found.value : '';
    }

    // Full relocation: geocode -> detect nearby -> persist -> rebuild everything
    async resolveLocation(input, opts = {}) {
        // input can be a postcode string, or {lat, lon, label} for "use current location"
        let home;
        if (typeof input === 'string') {
            home = await this.geocodePostcode(input);
        } else {
            home = {
                lat: input.lat,
                lon: input.lon,
                postcode: input.postcode || '',
                label: input.label || 'Current area'
            };
        }

        // Is this the SE20 default?
        const defPc = CONFIG.DEFAULT_HOME.postcode.replace(/\s/g, '').toUpperCase();
        home.isDefault = (home.postcode || '').replace(/\s/g, '').toUpperCase() === defPc;

        // Detect nearby (widen radius once if empty)
        let nearby = await this.detectNearby(home.lat, home.lon);
        if (nearby.stations.length === 0) {
            nearby = await this.detectNearby(home.lat, home.lon, CONFIG.NEARBY.stationRadius * 2);
        }

        this.home = home;
        this.nearbyStations = nearby.stations;
        this.nearbyBusStops = nearby.busStops;
        this.saveHome();
        this.cacheData('nearby-cache', { home: home.postcode, stations: nearby.stations, busStops: nearby.busStops });

        // Optionally remember as a saved place
        if (opts.savePlace !== false) {
            this.saveSavedPlace({ label: home.label, postcode: home.postcode, lat: home.lat, lon: home.lon });
        }

        // Rebuild UI
        this.updateHeaderLocation();
        this.applyHomeToJourney();
        this.applyHomeMode();
        this.renderNearbySection();
        this.updateMap();
        await this.refreshAll();
        return home;
    }

    async detectNearbyForHome() {
        try {
            let nearby = await this.detectNearby(this.home.lat, this.home.lon);
            if (nearby.stations.length === 0) {
                nearby = await this.detectNearby(this.home.lat, this.home.lon, CONFIG.NEARBY.stationRadius * 2);
            }
            this.nearbyStations = nearby.stations;
            this.nearbyBusStops = nearby.busStops;
            this.cacheData('nearby-cache', { home: this.home.postcode, stations: nearby.stations, busStops: nearby.busStops });
            this.renderNearbySection(); // no-op for default home
            this.updateMap();
            if (!this.home.isDefault) await this.fetchNearbyArrivals();
        } catch (e) {
            console.error('Nearby detection failed:', e);
        }
    }

    // ==================== DYNAMIC NEARBY CARDS (relocated homes) ====================
    renderNearbySection(detecting = false) {
        const host = document.getElementById('nearby-section');
        if (!host || this.home.isDefault) return;

        if (this.nearbyStations.length === 0 && this.nearbyBusStops.length === 0) {
            host.innerHTML = detecting
                ? `<section class="card"><div class="loading">Finding nearby stations…</div></section>`
                : `<section class="card"><div class="no-data">No stations or stops found near ${this.escapeHtml(this.home.label || 'here')}.</div></section>`;
            return;
        }

        const stationCards = this.nearbyStations.map(st => this.renderStationCard(st)).join('');
        const busCard = this.renderBusCard();
        host.innerHTML = stationCards + busCard;

        // Tap a departure to open the modal (delegated)
        host.querySelectorAll('.station-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const dep = e.target.closest('.departure');
                if (!dep) return;
                const sid = card.dataset.stationId;
                const sname = card.dataset.stationName;
                this.openModal(sid, sname, dep.dataset.dest || '');
            });
        });
    }

    renderStationCard(station) {
        const walk = Math.max(1, Math.round(station.distance / 80)); // ~80 m/min
        const isTflLive = (station.modes || []).some(m =>
            ['tube', 'overground', 'dlr', 'elizabeth-line', 'tram'].includes(m));
        const roundelClass = (station.modes || []).includes('tube') ? 'tube-roundel'
            : (station.modes || []).includes('overground') ? 'overground-roundel'
            : (station.modes || []).includes('dlr') ? 'dlr-roundel' : 'rail-roundel';

        const body = isTflLive
            ? `<div class="departures" id="arrivals-${this.escapeAttr(station.id)}"><div class="loading">Loading...</div></div>`
            : `<div class="nr-unavailable">🚂 National Rail — live times not available here.
                 <a href="https://www.nationalrail.co.uk/live-trains/departures/" target="_blank" rel="noopener">Live departures ↗</a></div>`;

        return `
            <section class="card trains-card station-card" data-station-id="${this.escapeAttr(station.id)}" data-station-name="${this.escapeAttr(station.name)}">
                <div class="card-header">
                    <h2><span class="${roundelClass}"></span> ${this.escapeHtml(station.name)}</h2>
                    <div class="header-badges">
                        <span class="walk-time-badge">🚶 ${walk} min</span>
                        ${isTflLive ? '<span class="live-badge">LIVE</span>' : ''}
                        <span class="update-time" id="updated-${this.escapeAttr(station.id)}">--</span>
                    </div>
                </div>
                ${body}
            </section>`;
    }

    renderBusCard() {
        if (!this.nearbyBusStops || this.nearbyBusStops.length === 0) return '';
        const stops = this.nearbyBusStops.map(stop => {
            const label = stop.towards ? `→ ${stop.towards}` : (stop.indicator ? `Stop ${stop.indicator}` : stop.name);
            return `
                <div class="bus-direction">
                    <div class="direction-header">
                        <span class="direction-name">${this.escapeHtml(stop.name)} ${this.escapeHtml(label)}</span>
                    </div>
                    <div class="bus-arrivals" id="busstop-${this.escapeAttr(stop.id)}">
                        <div class="loading">Loading...</div>
                    </div>
                </div>`;
        }).join('');

        return `
            <section class="card buses-card">
                <div class="card-header">
                    <h2><span class="tfl-bus-icon"></span> Buses</h2>
                    <div class="header-badges">
                        <span class="live-badge">LIVE</span>
                        <span class="update-time" id="nearby-buses-updated">--</span>
                    </div>
                </div>
                <div class="bus-directions">${stops}</div>
            </section>`;
    }

    // ==================== UNIVERSAL ARRIVALS (TfL StopPoint/Arrivals) ====================
    async fetchActiveTransit() {
        if (this.home.isDefault) {
            await Promise.all([this.fetchDarwinTrains(), this.fetchBuses()]);
        } else {
            await this.fetchNearbyArrivals();
        }
    }

    async fetchNearbyArrivals() {
        const tflAuth = CONFIG.TFL_APP_KEY ? `?app_id=${CONFIG.TFL_APP_ID}&app_key=${CONFIG.TFL_APP_KEY}` : '';

        // Stations with TfL live modes
        const liveStations = this.nearbyStations.filter(st =>
            (st.modes || []).some(m => ['tube', 'overground', 'dlr', 'elizabeth-line', 'tram'].includes(m)));

        await Promise.all(liveStations.map(async (st) => {
            try {
                const res = await fetch(`https://api.tfl.gov.uk/StopPoint/${st.id}/Arrivals${tflAuth}`);
                const data = await res.json();
                const departures = (Array.isArray(data) ? data : [])
                    .map(a => ({
                        dest: this.cleanStationName(a.destinationName || a.towards || 'Check board'),
                        platform: this.cleanPlatform(a.platformName),
                        mins: Math.floor((a.timeToStation || 0) / 60),
                        currentLocation: a.currentLocation || '',
                        scheduledTime: a.expectedArrival
                            ? new Date(a.expectedArrival).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''
                    }))
                    .filter(d => d.mins >= 0)
                    .sort((a, b) => a.mins - b.mins);

                st.platformDirections = this.getPlatformDirections(departures);
                this.stationData[st.id] = departures;
                this.renderStationArrivals(st, departures);
                const upd = document.getElementById(`updated-${st.id}`);
                if (upd) upd.textContent = this.getTimeAgo(new Date());
            } catch (e) {
                const upd = document.getElementById(`updated-${st.id}`);
                if (upd) upd.textContent = 'Error';
            }
        }));

        // Bus stops
        await Promise.all((this.nearbyBusStops || []).map(async (stop) => {
            try {
                const res = await fetch(`https://api.tfl.gov.uk/StopPoint/${stop.id}/Arrivals${tflAuth}`);
                const data = await res.json();
                this.renderBusStopArrivals(stop.id, Array.isArray(data) ? data : []);
            } catch (e) { /* leave loading */ }
        }));
        const busUpd = document.getElementById('nearby-buses-updated');
        if (busUpd) busUpd.textContent = this.getTimeAgo(new Date());
    }

    cleanStationName(name) {
        return (name || '').replace(/ (Underground|Rail|DLR|Overground) Station$/i, '').replace(/ Station$/i, '').trim();
    }

    // TfL platform names look like "Westbound - Platform 1" — reduce to just the number when present
    cleanPlatform(platformName) {
        if (!platformName) return '-';
        const num = String(platformName).match(/Platform\s*(\d+)/i) || String(platformName).match(/\b(\d+)\b/);
        return num ? num[1] : '-';
    }

    // Derive platform -> direction labels from live arrivals (replaces hardcoded PLATFORM_DIRECTIONS)
    getPlatformDirections(departures) {
        const byPlatform = {};
        departures.forEach(d => {
            if (!d.platform || d.platform === '-') return;
            const key = String(d.platform).match(/\d+/)?.[0] || d.platform;
            byPlatform[key] = byPlatform[key] || {};
            byPlatform[key][d.dest] = (byPlatform[key][d.dest] || 0) + 1;
        });
        const result = {};
        Object.keys(byPlatform).forEach(p => {
            const top = Object.entries(byPlatform[p]).sort((a, b) => b[1] - a[1])[0];
            if (top) result[p] = `→ ${top[0]}`;
        });
        return result;
    }

    renderStationArrivals(station, departures) {
        const container = document.getElementById(`arrivals-${station.id}`);
        if (!container) return;
        if (!departures || departures.length === 0) {
            container.innerHTML = '<div class="no-data">No live arrivals</div>';
            return;
        }
        const dir = station.platformDirections || {};
        container.innerHTML = departures.slice(0, 6).map(dep => {
            const pKey = String(dep.platform).match(/\d+/)?.[0] || dep.platform;
            const dirLabel = (dep.platform && dep.platform !== '-') ? (dir[pKey] || '') : '';
            return `
            <div class="departure" data-dest="${this.escapeAttr(dep.dest)}">
                <div class="departure-info">
                    ${dep.platform && dep.platform !== '-' ? `<span class="departure-platform">P${this.escapeHtml(dep.platform)}</span>` : ''}
                    ${dirLabel ? `<span class="departure-platform-dir">${dirLabel}</span>` : ''}
                    <span class="departure-destination">${this.escapeHtml(dep.dest)}</span>
                </div>
                <div class="departure-time">
                    <span class="departure-due ${dep.mins <= 3 ? 'urgent' : ''}">${dep.mins} min</span>
                    ${dep.scheduledTime ? `<span class="departure-scheduled">${dep.scheduledTime}</span>` : ''}
                </div>
            </div>`;
        }).join('');
    }

    renderBusStopArrivals(stopId, arrivals) {
        const container = document.getElementById(`busstop-${stopId}`);
        if (!container) return;
        if (!arrivals || arrivals.length === 0) {
            container.innerHTML = '<div class="no-data">No buses</div>';
            return;
        }
        const sorted = arrivals.sort((a, b) => (a.timeToStation || 0) - (b.timeToStation || 0)).slice(0, 4);
        container.innerHTML = sorted.map(bus => {
            const mins = Math.floor((bus.timeToStation || 0) / 60);
            const arrivalStr = (bus.expectedArrival ? new Date(bus.expectedArrival) : new Date(Date.now() + bus.timeToStation * 1000))
                .toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            const loc = bus.currentLocation || (mins <= 1 ? 'Arriving' : '');
            return `
                <div class="bus-arrival">
                    <div class="bus-route">
                        <span class="bus-number">${this.escapeHtml(bus.lineName)}</span>
                        <div class="bus-info">
                            <span class="bus-destination">${this.escapeHtml(bus.destinationName)}</span>
                            ${loc ? `<span class="bus-location">${this.escapeHtml(loc)}</span>` : ''}
                        </div>
                    </div>
                    <div class="bus-time-col">
                        <span class="bus-time">${mins} min</span>
                        <span class="bus-scheduled">${arrivalStr}</span>
                    </div>
                </div>`;
        }).join('');
    }

    toggleComingSoon() {
        const content = document.getElementById('coming-soon-content');
        const icon = document.getElementById('collapsible-icon');
        const isOpen = content.style.display !== 'none';

        content.style.display = isOpen ? 'none' : 'block';
        icon.classList.toggle('open', !isOpen);

        // Load demo data if opening for first time
        if (!isOpen && !this.demoDataLoaded) {
            this.loadDemoStations();
            this.demoDataLoaded = true;
        }
    }

    toggleLineStatus() {
        const content = document.getElementById('line-status-content');
        const icon = document.getElementById('line-status-icon');
        const isOpen = content.style.display !== 'none';

        content.style.display = isOpen ? 'none' : 'block';
        icon.classList.toggle('open', !isOpen);
    }

    loadDemoStations() {
        ['pnw', 'pne', 'bkb'].forEach(station => this.displayMockTrains(station));
    }

    hideAlert() {
        document.getElementById('service-alert').style.display = 'none';
    }

    setupPullToRefresh() {
        let startY = 0;
        let pulling = false;
        const dashboard = document.getElementById('dashboard');

        dashboard.addEventListener('touchstart', (e) => {
            if (window.scrollY === 0) {
                startY = e.touches[0].pageY;
                pulling = true;
            }
        }, { passive: true });

        dashboard.addEventListener('touchmove', (e) => {
            if (!pulling) return;
            const currentY = e.touches[0].pageY;
            const diff = currentY - startY;

            if (diff > 80 && !this.isRefreshing) {
                pulling = false;
                this.refreshAll();
            }
        }, { passive: true });

        dashboard.addEventListener('touchend', () => {
            pulling = false;
        }, { passive: true });
    }

    // ==================== OFFLINE DETECTION & CACHING ====================
    setupOfflineDetection() {
        this.isOnline = navigator.onLine;
        this.updateOfflineBanner();

        window.addEventListener('online', () => {
            this.isOnline = true;
            this.updateOfflineBanner();
            // Auto-refresh when back online
            this.refreshAll();
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.updateOfflineBanner();
            // Load cached data when offline
            this.loadCachedData();
        });
    }

    updateOfflineBanner() {
        const banner = document.getElementById('offline-banner');
        if (!banner) return;

        if (!this.isOnline) {
            const cachedTime = localStorage.getItem('pengedash-cache-time');
            if (cachedTime) {
                const ago = this.getTimeAgo(new Date(parseInt(cachedTime)));
                banner.querySelector('.offline-text').textContent = `Offline - data from ${ago}`;
            }
            banner.style.display = 'flex';
        } else {
            banner.style.display = 'none';
        }
    }

    cacheData(key, data) {
        try {
            localStorage.setItem(`pengedash-${key}`, JSON.stringify(data));
            localStorage.setItem('pengedash-cache-time', Date.now().toString());
        } catch (e) {
            // Handle QuotaExceededError - clear old cache and retry
            if (e.name === 'QuotaExceededError' || e.code === 22) {
                console.warn('Storage quota exceeded, clearing old cache...');
                this.clearOldCache();
                try {
                    localStorage.setItem(`pengedash-${key}`, JSON.stringify(data));
                    localStorage.setItem('pengedash-cache-time', Date.now().toString());
                } catch (e2) {
                    console.error('Cache storage failed after cleanup:', e2);
                }
            } else {
                console.warn('Cache storage failed:', e);
            }
        }
    }

    getCachedData(key) {
        try {
            const data = localStorage.getItem(`pengedash-${key}`);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.warn('Cache retrieval failed:', e);
            return null;
        }
    }

    clearOldCache() {
        // Remove all pengedash cache entries to free up space
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const preserve = ['pengedash-destinations', 'pengedash-favorite-journeys',
                'pengedash-home', 'pengedash-saved-places'];
            if (key && key.startsWith('pengedash-') && !preserve.includes(key)) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
        console.log('Cleared', keysToRemove.length, 'cache entries');
    }

    loadCachedData() {
        // Load weather from cache
        const cachedWeather = this.getCachedData('weather');
        if (cachedWeather) {
            this.displayWeather(cachedWeather);
            this.displayHourlyForecast(cachedWeather);
            if (cachedWeather.daily) {
                this.displaySunTimes(cachedWeather);
            }
            // Validate weather_code exists and is a number before applying background
            if (cachedWeather.current?.weather_code !== undefined &&
                typeof cachedWeather.current.weather_code === 'number') {
                this.applyWeatherBackground(cachedWeather.current.weather_code);
            }
        }

        // Load buses from cache
        const cachedBuses = this.getCachedData('buses');
        if (cachedBuses) {
            this.displayBuses(cachedBuses.east, cachedBuses.west);
        }

        // Load trains from cache
        const cachedTrains = this.getCachedData('trains');
        if (cachedTrains) {
            ['PNW', 'PNE', 'BKB', 'ANR'].forEach(stationCode => {
                if (cachedTrains[stationCode]) {
                    this.displayStationDepartures(stationCode, cachedTrains[stationCode]);
                }
            });
        }

        // Load line status from cache
        const cachedLines = this.getCachedData('lines');
        if (cachedLines) {
            this.displayLineStatus(cachedLines);
        }
    }

    updateTheme() {
        const hour = new Date().getHours();
        const isNight = hour >= 20 || hour < 6; // 8pm to 6am
        document.documentElement.setAttribute('data-theme', isNight ? 'dark' : 'light');
    }

    // ==================== QUIRKY PERSONALITY ====================
    updateGreeting() {
        const hour = new Date().getHours();
        const greetingEl = document.getElementById('greeting');

        let greeting;
        if (hour >= 5 && hour < 12) {
            const morningGreetings = [
                "Morning! ☕",
                "Rise and shine! ☀️",
                "Good morning! 🌅",
                "Morning, early bird! 🐦"
            ];
            greeting = morningGreetings[Math.floor(Math.random() * morningGreetings.length)];
        } else if (hour >= 12 && hour < 17) {
            const afternoonGreetings = [
                "Afternoon! 🌤️",
                "Hey there! 👋",
                "Good afternoon! ☀️"
            ];
            greeting = afternoonGreetings[Math.floor(Math.random() * afternoonGreetings.length)];
        } else if (hour >= 17 && hour < 21) {
            const eveningGreetings = [
                "Evening! 🏠",
                "Heading home? 🚶",
                "Good evening! 🌆",
                "Home time! 🎉"
            ];
            greeting = eveningGreetings[Math.floor(Math.random() * eveningGreetings.length)];
        } else {
            const nightGreetings = [
                "Night owl! 🦉",
                "Late one? 🌙",
                "Burning the midnight oil? 💫"
            ];
            greeting = nightGreetings[Math.floor(Math.random() * nightGreetings.length)];
        }

        greetingEl.textContent = greeting;
    }

    getWeatherSass(weatherCode, temp, rainChance) {
        // Sassy weather commentary
        if (weatherCode === 0) {
            return temp > 20
                ? "☀️ Finally! Don't waste it indoors"
                : "☀️ Sun's out! About time, London";
        }
        if (weatherCode <= 3) {
            return "Not bad! Could be worse 🤷";
        }
        if (weatherCode >= 51 && weatherCode <= 69) {
            return "🌧️ Classic London... umbrella essential";
        }
        if (weatherCode >= 71 && weatherCode <= 79) {
            return "❄️ Snow?! In SE20?! Chaos incoming";
        }
        if (weatherCode >= 95) {
            return "⛈️ Stay inside if you can!";
        }
        if (temp <= 5) {
            return "🥶 It's giving arctic vibes out there";
        }
        if (temp >= 25) {
            return "🔥 Ice cream weather, no debate";
        }
        if (rainChance >= 70) {
            return "🌧️ Rain's coming... you've been warned";
        }
        return "Standard London weather innit";
    }

    getTransportMood(issues) {
        if (issues.length === 0) {
            const goodMoods = [
                "Smooth sailing today! 🚀",
                "TfL gods are smiling 🙏",
                "All systems go! ✨",
                "No drama today 🎭"
            ];
            return goodMoods[Math.floor(Math.random() * goodMoods.length)];
        }

        const hasOverground = issues.some(i => OVERGROUND_LINES.includes(i.id));
        const hasSouthern = issues.some(i => i.id === 'southern');

        if (hasSouthern) {
            return "Southern being Southern... 😤";
        }
        if (hasOverground) {
            return "Overground's having a moment 🙄";
        }
        return "Bit of chaos out there... 🎢";
    }

    getDepartureHype(mins) {
        if (mins <= 1) {
            const hypes = ["Go go go! 🏃", "RUN! 🏃‍♂️", "NOW! ⚡"];
            return hypes[Math.floor(Math.random() * hypes.length)];
        }
        if (mins <= 3) {
            return "You've got this! 💪";
        }
        if (mins <= 5) {
            return "Perfect timing ✨";
        }
        return null;
    }

    createModal() {
        const modal = document.createElement('div');
        modal.id = 'next-trains-modal';
        modal.className = 'next-trains-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <div>
                        <div class="modal-title" id="modal-station-name">Station</div>
                        <div class="modal-subtitle">Tap a train to see next departures</div>
                    </div>
                    <button class="modal-close" id="modal-close">&times;</button>
                </div>
                <div class="modal-departures" id="modal-departures"></div>
            </div>
        `;
        document.body.appendChild(modal);

        // Close modal handlers
        document.getElementById('modal-close').addEventListener('click', () => this.closeModal());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.closeModal();
        });

        // Generic detail modal (alerts, settings, etc.)
        const detail = document.createElement('div');
        detail.id = 'detail-modal';
        detail.className = 'next-trains-modal';
        detail.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <div class="modal-title" id="detail-modal-title">Details</div>
                    <button class="modal-close" id="detail-modal-close">&times;</button>
                </div>
                <div class="modal-departures" id="detail-modal-body"></div>
            </div>
        `;
        document.body.appendChild(detail);
        document.getElementById('detail-modal-close').addEventListener('click', () => this.closeDetailModal());
        detail.addEventListener('click', (e) => {
            if (e.target === detail) this.closeDetailModal();
        });
    }

    openDetailModal(title, bodyHtml) {
        const modal = document.getElementById('detail-modal');
        document.getElementById('detail-modal-title').textContent = title;
        document.getElementById('detail-modal-body').innerHTML = bodyHtml;
        modal.classList.add('active');
        return modal;
    }

    closeDetailModal() {
        document.getElementById('detail-modal').classList.remove('active');
    }

    openModal(stationId, stationName, destination) {
        const modal = document.getElementById('next-trains-modal');
        const titleEl = document.getElementById('modal-station-name');
        const departuresEl = document.getElementById('modal-departures');

        titleEl.textContent = `${stationName} → ${destination}`;

        const data = this.stationData[stationId] || [];
        // Filter by destination and show next 6
        const filtered = data
            .filter(d => d.dest.toLowerCase().includes(destination.toLowerCase().split(' ')[0]))
            .slice(0, 6);

        // Prefer runtime-derived directions for dynamic stations; fall back to SE20 constant
        const dynamicStation = (this.nearbyStations || []).find(s => s.id === stationId);
        const dirLookup = (dynamicStation && dynamicStation.platformDirections) || PLATFORM_DIRECTIONS[stationId] || {};

        if (filtered.length === 0) {
            departuresEl.innerHTML = '<div class="no-data">No more trains to this destination</div>';
        } else {
            departuresEl.innerHTML = filtered.map((dep, i) => {
                const pKey = String(dep.platform).match(/\d+/)?.[0] || dep.platform;
                const dirLabel = dep.platform && dep.platform !== '-' ? (dirLookup[dep.platform] || dirLookup[pKey] || '') : '';
                const scheduledStr = dep.scheduledTime || (dep.mins != null ? new Date(Date.now() + dep.mins * 60000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
                return `
                <div class="modal-departure">
                    <div class="modal-departure-info">
                        <span class="modal-departure-dest">${this.escapeHtml(dep.dest)}</span>
                        ${dep.platform && dep.platform !== '-' ? `<span class="modal-departure-platform">P${this.escapeHtml(dep.platform)}</span>` : ''}
                        ${dirLabel ? `<span class="departure-platform-dir">${dirLabel}</span>` : ''}
                    </div>
                    <div class="modal-departure-time-col">
                        <span class="modal-departure-time">${dep.mins} min</span>
                        ${scheduledStr ? `<span class="departure-scheduled">${scheduledStr}</span>` : ''}
                    </div>
                </div>
            `}).join('');
        }

        modal.classList.add('active');
    }

    closeModal() {
        document.getElementById('next-trains-modal').classList.remove('active');
    }

    updateClock() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        document.getElementById('current-time').textContent = timeStr;
    }

    setupAutoRefresh() {
        setInterval(() => this.fetchWeather(), CONFIG.REFRESH_INTERVALS.weather);
        setInterval(() => this.fetchAirQuality(), CONFIG.REFRESH_INTERVALS.weather);
        setInterval(() => this.fetchActiveTransit(), CONFIG.REFRESH_INTERVALS.trains);
        setInterval(() => this.fetchLineStatus(), CONFIG.REFRESH_INTERVALS.trains);
        setInterval(() => this.fetchTrafficDisruptions(), CONFIG.REFRESH_INTERVALS.traffic);
    }

    // ==================== DARWIN KEEP-ALIVE ====================
    pingDarwinBackend() {
        const ping = async () => {
            try {
                const response = await fetch(`${CONFIG.DARWIN_API_URL}/health`, {
                    method: 'GET',
                    mode: 'cors'
                });
                if (response.ok) {
                    console.log('Darwin backend ping OK');
                }
            } catch (error) {
                console.log('Darwin backend waking up...');
            }
        };

        // Initial ping
        ping();

        // Repeat every 9 minutes while app is open
        setInterval(ping, 9 * 60 * 1000);
    }

    // ==================== AIR QUALITY ====================
    async fetchAirQuality() {
        try {
            let url = 'https://api.tfl.gov.uk/AirQuality';
            if (CONFIG.TFL_APP_KEY) {
                url += `?app_id=${CONFIG.TFL_APP_ID}&app_key=${CONFIG.TFL_APP_KEY}`;
            }

            const response = await fetch(url);
            const data = await response.json();

            this.displayAirQuality(data);
        } catch (error) {
            console.error('Air quality fetch error:', error);
            document.getElementById('air-quality').textContent = 'Air: --';
        }
    }

    displayAirQuality(data) {
        const badge = document.getElementById('air-quality');
        const forecast = data.currentForecast?.[0];

        if (!forecast) {
            badge.textContent = 'Air: --';
            return;
        }

        const band = forecast.forecastBand || 'Low';
        badge.textContent = `Air: ${band}`;
        badge.className = `air-quality-badge ${band.toLowerCase().replace(/\s+/g, '-')}`;
    }

    async refreshAll() {
        if (this.isRefreshing) return;

        this.isRefreshing = true;
        const btn = document.getElementById('refresh-btn');
        btn.classList.add('spinning');
        document.getElementById('status-message').textContent = 'Refreshing...';

        try {
            await Promise.all([
                this.fetchWeather(),
                this.fetchAirQuality(),
                this.fetchActiveTransit(),
                this.fetchLineStatus(),
                this.fetchTrafficDisruptions()
            ]);

            const now = new Date().toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit'
            });
            document.getElementById('last-refresh').textContent = `Last refresh: ${now}`;
            document.getElementById('status-message').textContent = 'Ready';
        } catch (error) {
            console.error('Refresh error:', error);
            document.getElementById('status-message').textContent = 'Some data failed to load';
        } finally {
            this.isRefreshing = false;
            btn.classList.remove('spinning');
        }
    }

    // ==================== WEATHER (Open-Meteo - No API key needed!) ====================
    async fetchWeather() {
        const updateTime = document.getElementById('weather-updated');

        try {
            const { lat, lon } = this.home || CONFIG.LOCATION;
            // Open-Meteo: Free, no API key required - now with hourly forecast + sunrise/sunset
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability,weather_code&daily=sunrise,sunset&timezone=Europe/London&forecast_hours=12`;

            const response = await fetch(url);
            const data = await response.json();

            // Cache the weather data
            this.cacheData('weather', data);

            this.displayWeather(data);
            this.displayHourlyForecast(data);
            this.displaySunTimes(data);
            this.applyWeatherBackground(data.current.weather_code);
            updateTime.textContent = this.getTimeAgo(new Date());
        } catch (error) {
            console.error('Weather fetch error:', error);
            // Try to load from cache first
            const cachedWeather = this.getCachedData('weather');
            if (cachedWeather) {
                this.displayWeather(cachedWeather);
                this.displayHourlyForecast(cachedWeather);
                if (cachedWeather.daily) this.displaySunTimes(cachedWeather);
                if (cachedWeather.current) this.applyWeatherBackground(cachedWeather.current.weather_code);
                updateTime.textContent = 'Cached';
            } else {
                this.displayMockWeather();
            }
        }
    }

    displayWeather(data) {
        const current = data.current;
        const temp = Math.round(current.temperature_2m);
        const feelsLike = Math.round(current.apparent_temperature);
        const windSpeed = Math.round(current.wind_speed_10m * 0.621371); // km/h to mph

        // Get rain probability for current hour
        const currentHour = new Date().getHours();
        const rainChance = data.hourly?.precipitation_probability?.[currentHour] || 0;
        const { icon, condition } = this.getWeatherFromCode(current.weather_code);

        // Store weather data for smart journey insights
        this.currentWeather = { temp, feelsLike, rainChance, condition, windSpeed, hourlyData: data.hourly };

        document.getElementById('temp').textContent = `${temp}°`;
        document.getElementById('feels-like').textContent = `${feelsLike}°`;
        document.getElementById('wind').textContent = `${windSpeed} mph`;

        document.getElementById('rain-chance').textContent = `${rainChance}%`;

        // Rain hint - make the percentage more meaningful
        const rainHint = document.getElementById('rain-hint');
        if (rainChance <= 10) {
            rainHint.textContent = 'Dry';
        } else if (rainChance <= 30) {
            rainHint.textContent = 'Unlikely';
        } else if (rainChance <= 60) {
            rainHint.textContent = 'Possible';
        } else if (rainChance <= 80) {
            rainHint.textContent = 'Likely';
        } else {
            rainHint.textContent = 'Expect rain';
        }

        // Weather icon and condition from WMO code
        document.getElementById('weather-icon').textContent = icon;
        document.getElementById('weather-condition').textContent = condition;

        // Clothing advice
        this.updateClothingAdvice(feelsLike, rainChance, windSpeed);
    }

    displayMockWeather() {
        document.getElementById('temp').textContent = '12°';
        document.getElementById('feels-like').textContent = '10°';
        document.getElementById('rain-chance').textContent = '30%';
        document.getElementById('rain-hint').textContent = 'Unlikely';
        document.getElementById('wind').textContent = '8 mph';
        document.getElementById('weather-icon').textContent = '🌤️';
        document.getElementById('weather-condition').textContent = 'Partly cloudy';
        document.getElementById('weather-updated').textContent = 'Demo data';

        // Show clothing advice for demo
        this.updateClothingAdvice(10, 30, 8);
    }

    getWeatherFromCode(code) {
        // WMO Weather interpretation codes
        // https://open-meteo.com/en/docs
        if (code === 0) return { icon: '☀️', condition: 'Clear sky' };
        if (code === 1) return { icon: '🌤️', condition: 'Mostly clear' };
        if (code === 2) return { icon: '⛅', condition: 'Partly cloudy' };
        if (code === 3) return { icon: '☁️', condition: 'Overcast' };
        if (code === 45) return { icon: '🌫️', condition: 'Foggy' };
        if (code === 48) return { icon: '🌫️', condition: 'Icy fog' };
        if (code >= 51 && code <= 55) return { icon: '🌦️', condition: 'Drizzle' };
        if (code >= 56 && code <= 57) return { icon: '🌧️', condition: 'Freezing drizzle' };
        if (code >= 61 && code <= 63) return { icon: '🌧️', condition: 'Rain' };
        if (code === 65) return { icon: '🌧️', condition: 'Heavy rain' };
        if (code >= 66 && code <= 67) return { icon: '🌧️', condition: 'Freezing rain' };
        if (code >= 71 && code <= 75) return { icon: '🌨️', condition: 'Snow' };
        if (code === 77) return { icon: '🌨️', condition: 'Snow grains' };
        if (code >= 80 && code <= 82) return { icon: '🌦️', condition: 'Rain showers' };
        if (code >= 85 && code <= 86) return { icon: '🌨️', condition: 'Snow showers' };
        if (code === 95) return { icon: '⛈️', condition: 'Thunderstorm' };
        if (code >= 96) return { icon: '⛈️', condition: 'Thunderstorm with hail' };
        return { icon: '🌤️', condition: 'Fair' };
    }

    displayHourlyForecast(data) {
        const container = document.getElementById('forecast-scroll');
        const hourly = data.hourly;

        if (!hourly || !hourly.time) {
            container.innerHTML = '<div class="forecast-loading">No forecast data</div>';
            return;
        }

        const currentHour = new Date().getHours();
        const forecasts = [];

        // Get next 8 hours
        for (let i = 0; i < Math.min(8, hourly.time.length); i++) {
            const time = new Date(hourly.time[i]);
            const hour = time.getHours();

            // Skip past hours
            if (hour < currentHour && time.getDate() === new Date().getDate()) continue;

            const temp = Math.round(hourly.temperature_2m[i]);
            const rain = hourly.precipitation_probability[i] || 0;
            const weatherCode = hourly.weather_code[i] || 0;
            const { icon } = this.getWeatherFromCode(weatherCode);

            forecasts.push({
                hour: hour === currentHour ? 'Now' : `${hour}:00`,
                icon,
                temp,
                rain
            });

            if (forecasts.length >= 8) break;
        }

        // Check for upcoming rain
        const rainAlert = forecasts.find((f, i) => i > 0 && f.rain >= 50);

        container.innerHTML = forecasts.map(f => `
            <div class="forecast-hour">
                <span class="forecast-time">${f.hour}</span>
                <span class="forecast-icon">${f.icon}</span>
                <span class="forecast-temp">${f.temp}°</span>
                <span class="forecast-rain ${f.rain >= 50 ? 'high' : ''}">${f.rain}%</span>
            </div>
        `).join('');

        // Add rain alert if needed
        if (rainAlert) {
            const alertDiv = document.createElement('div');
            alertDiv.className = 'rain-alert warning';
            alertDiv.innerHTML = `🌧️ Rain likely at ${rainAlert.hour}`;
            container.parentElement.appendChild(alertDiv);
        }
    }

    updateClothingAdvice(feelsLike, rainChance, windSpeed) {
        const adviceEl = document.getElementById('clothing-advice');
        const iconEl = document.getElementById('clothing-icon');
        const textEl = document.getElementById('clothing-text');

        let icon, text, tempClass;

        if (feelsLike <= 5) {
            // Freezing cold
            icon = '🧥';
            text = 'Parka weather! Layer up, it\'s freezing out there.';
            tempClass = 'cold';
        } else if (feelsLike <= 10) {
            // Cold
            icon = '🧥';
            text = 'Bring a warm coat. Consider gloves too.';
            tempClass = 'cold';
        } else if (feelsLike <= 14) {
            // Cool
            icon = '🧥';
            text = 'Jacket weather. A light coat will do.';
            tempClass = 'mild';
        } else if (feelsLike <= 18) {
            // Mild
            icon = '👔';
            text = 'Nice and mild. Light layers are fine.';
            tempClass = 'mild';
        } else if (feelsLike <= 23) {
            // Warm
            icon = '👕';
            text = 'T-shirt weather! Maybe a light layer for later.';
            tempClass = 'warm';
        } else {
            // Hot
            icon = '🩳';
            text = 'Shorts and t-shirt! Stay cool out there.';
            tempClass = 'hot';
        }

        // Add rain warning
        if (rainChance >= 60) {
            icon = '☔';
            text += ' Grab an umbrella!';
        } else if (rainChance >= 30) {
            text += ' Maybe pack a brolly.';
        }

        // Add wind warning
        if (windSpeed >= 20) {
            text += ' It\'s windy!';
        }

        iconEl.textContent = icon;
        textEl.textContent = text;
        adviceEl.className = `clothing-advice ${tempClass}`;
    }

    // ==================== SUNRISE/SUNSET ====================
    displaySunTimes(data) {
        const sunTimesEl = document.getElementById('sun-times');
        const daylightEl = document.getElementById('daylight-remaining');

        if (!sunTimesEl || !data.daily) return;

        const sunrise = new Date(data.daily.sunrise[0]);
        const sunset = new Date(data.daily.sunset[0]);
        const now = new Date();

        const sunriseStr = sunrise.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const sunsetStr = sunset.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

        sunTimesEl.innerHTML = `
            <span class="sun-icon">🌅</span>
            <span class="sun-time">${sunriseStr}</span>
            <span class="sun-divider">·</span>
            <span class="sun-icon">🌇</span>
            <span class="sun-time">${sunsetStr}</span>
        `;

        // Calculate daylight remaining
        if (daylightEl) {
            if (now < sunrise) {
                // Before sunrise
                const minsToSunrise = Math.round((sunrise - now) / 60000);
                const hrs = Math.floor(minsToSunrise / 60);
                const mins = minsToSunrise % 60;
                daylightEl.textContent = `☀️ Sunrise in ${hrs}h ${mins}m`;
                daylightEl.className = 'daylight-badge before-sunrise';
            } else if (now > sunset) {
                // After sunset
                daylightEl.textContent = '🌙 Sun has set';
                daylightEl.className = 'daylight-badge after-sunset';
            } else {
                // During the day
                const minsRemaining = Math.round((sunset - now) / 60000);
                const hrs = Math.floor(minsRemaining / 60);
                const mins = minsRemaining % 60;
                daylightEl.textContent = `☀️ ${hrs}h ${mins}m daylight left`;
                daylightEl.className = 'daylight-badge during-day';
            }
        }
    }

    // ==================== DYNAMIC WEATHER BACKGROUNDS ====================
    applyWeatherBackground(weatherCode) {
        const weatherCard = document.querySelector('.weather-card');
        if (!weatherCard) return;

        // Remove any existing weather classes
        weatherCard.classList.remove('weather-sunny', 'weather-cloudy', 'weather-rainy', 'weather-snow', 'weather-night', 'weather-storm');

        const hour = new Date().getHours();
        const isNight = hour >= 20 || hour < 6;

        if (isNight) {
            weatherCard.classList.add('weather-night');
            return;
        }

        // Apply weather-based background
        if (weatherCode === 0 || weatherCode === 1) {
            // Clear / Mostly clear
            weatherCard.classList.add('weather-sunny');
        } else if (weatherCode >= 2 && weatherCode <= 3) {
            // Partly cloudy / Overcast
            weatherCard.classList.add('weather-cloudy');
        } else if (weatherCode === 45 || weatherCode === 48) {
            // Fog
            weatherCard.classList.add('weather-cloudy');
        } else if ((weatherCode >= 51 && weatherCode <= 67) || (weatherCode >= 80 && weatherCode <= 82)) {
            // Drizzle / Rain / Rain showers
            weatherCard.classList.add('weather-rainy');
        } else if (weatherCode >= 71 && weatherCode <= 86) {
            // Snow
            weatherCard.classList.add('weather-snow');
        } else if (weatherCode >= 95) {
            // Thunderstorm
            weatherCard.classList.add('weather-storm');
        } else {
            // Default
            weatherCard.classList.add('weather-cloudy');
        }
    }

    // ==================== DARWIN TRAINS (All stations via backend) ====================
    async fetchDarwinTrains() {
        try {
            const response = await fetch(`${CONFIG.DARWIN_API_URL}/api/departures`);
            const data = await response.json();

            if (!data.stations) {
                console.warn('No Darwin data, using fallback');
                this.fetchAnerleyTfL();
                return;
            }

            // Process each station and build cache
            const trainsCache = {};
            ['PNW', 'PNE', 'BKB', 'ANR'].forEach(stationCode => {
                const stationData = data.stations[stationCode];
                if (stationData && stationData.departures) {
                    const departures = stationData.departures.map(dep => ({
                        dest: this.formatDestination(dep.destination),
                        platform: dep.platform || '-',
                        mins: dep.mins,
                        scheduledTime: dep.scheduledTime,
                        expectedTime: dep.expectedTime,
                        cancelled: dep.cancelled,
                        delayed: dep.delayed
                    })).filter(d => d.mins !== null && d.mins >= 0);

                    this.stationData[stationCode.toLowerCase()] = departures;
                    trainsCache[stationCode] = departures;
                    this.displayStationDepartures(stationCode, departures);
                }
            });

            // Cache train data
            this.cacheData('trains', trainsCache);

            document.getElementById('anerley-updated').textContent = this.getTimeAgo(new Date());
        } catch (error) {
            console.error('Darwin fetch error:', error);
            // Try cached data first
            const cachedTrains = this.getCachedData('trains');
            if (cachedTrains && Object.keys(cachedTrains).length > 0) {
                ['PNW', 'PNE', 'BKB', 'ANR'].forEach(stationCode => {
                    if (cachedTrains[stationCode]) {
                        this.stationData[stationCode.toLowerCase()] = cachedTrains[stationCode];
                        this.displayStationDepartures(stationCode, cachedTrains[stationCode]);
                    }
                });
                document.getElementById('anerley-updated').textContent = 'Cached';
            } else {
                // Fallback to TfL for Anerley (Overground)
                this.fetchAnerleyTfL();
            }
        }
    }

    formatDestination(tiploc) {
        // Convert TIPLOC codes to readable names
        const names = {
            'VICTRIC': 'Victoria', 'VICTRIA': 'Victoria',
            'LNDNBDE': 'London Bridge', 'LONBDGE': 'London Bridge',
            'CHRX': 'Charing Cross', 'CHARING': 'Charing Cross',
            'CANNON': 'Cannon Street', 'CANNS': 'Cannon Street',
            'BNKCHSX': 'Beckenham Junction', 'BCKJN': 'Beckenham Junction',
            'WIMBLDN': 'Wimbledon', 'WMBLEDN': 'Wimbledon',
            'ORPNGTN': 'Orpington', 'ORPINTN': 'Orpington',
            'HGHBYIS': 'Highbury & Islington',
            'WCROYDN': 'West Croydon',
            'CRYSTLP': 'Crystal Palace'
        };
        return names[tiploc] || tiploc || 'Unknown';
    }

    displayStationDepartures(stationCode, departures) {
        const stationId = stationCode.toLowerCase();

        // Anerley uses platform-based display
        if (stationCode === 'ANR') {
            const platform1 = departures.filter(d => d.platform.includes('1')).slice(0, 3);
            const platform2 = departures.filter(d => d.platform.includes('2')).slice(0, 3);
            this.displayPlatformTrains('anr-platform-1', platform1);
            this.displayPlatformTrains('anr-platform-2', platform2);
            return;
        }

        // Other stations - display in their containers if they exist
        const container = document.getElementById(`${stationId}-departures`);
        if (!container) return;

        if (!departures || departures.length === 0) {
            container.innerHTML = '<div class="no-data">No departures</div>';
            return;
        }

        const stationNames = { 'pnw': 'Penge West', 'pne': 'Penge East', 'bkb': 'Birkbeck', 'anr': 'Anerley' };

        const dirLookup = PLATFORM_DIRECTIONS[stationId] || {};

        container.innerHTML = departures.slice(0, 6).map(dep => {
            const dirLabel = dep.platform && dep.platform !== '-' ? (dirLookup[dep.platform] || '') : '';
            const scheduledStr = dep.scheduledTime || (dep.mins != null ? new Date(Date.now() + dep.mins * 60000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
            return `
            <div class="departure ${dep.cancelled ? 'cancelled' : ''}" onclick="pengeDash.openModal('${this.escapeAttr(stationId)}', '${this.escapeAttr(stationNames[stationId])}', '${this.escapeAttr(dep.dest)}')">
                <div class="departure-info">
                    ${dep.platform && dep.platform !== '-' ? `<span class="departure-platform">P${this.escapeHtml(dep.platform)}</span>` : ''}
                    ${dirLabel ? `<span class="departure-platform-dir">${dirLabel}</span>` : ''}
                    <span class="departure-destination">${this.escapeHtml(dep.dest)}${dep.cancelled ? ' ❌' : ''}${dep.delayed ? ' ⚠️' : ''}</span>
                </div>
                <div class="departure-time">
                    <span class="departure-due ${dep.mins <= 3 ? 'urgent' : ''}">${dep.mins} min</span>
                    ${scheduledStr ? `<span class="departure-scheduled">${scheduledStr}</span>` : ''}
                </div>
            </div>
        `}).join('');
    }

    // ==================== ANERLEY OVERGROUND (TfL Fallback) ====================
    async fetchAnerleyTfL() {
        try {
            let url = 'https://api.tfl.gov.uk/StopPoint/910GANERLEY/Arrivals';
            if (CONFIG.TFL_APP_KEY) {
                url += `?app_id=${CONFIG.TFL_APP_ID}&app_key=${CONFIG.TFL_APP_KEY}`;
            }

            const response = await fetch(url);
            const data = await response.json();

            if (!Array.isArray(data) || data.length === 0) {
                this.displayMockAnerley();
                document.getElementById('anerley-updated').textContent = 'No trains';
                return;
            }

            // Transform data
            const departures = data.map(dep => ({
                dest: dep.destinationName || dep.towards,
                platform: dep.platformName || '-',
                mins: Math.floor(dep.timeToStation / 60),
                currentLocation: dep.currentLocation || ''
            })).sort((a, b) => a.mins - b.mins);

            // Store all data for modal
            this.stationData['anr'] = departures;

            // Split by platform (Platform 1 = Highbury, Platform 2 = West Croydon)
            const platform1 = departures.filter(d => d.platform.includes('1')).slice(0, 3);
            const platform2 = departures.filter(d => d.platform.includes('2')).slice(0, 3);

            this.displayPlatformTrains('anr-platform-1', platform1);
            this.displayPlatformTrains('anr-platform-2', platform2);
            document.getElementById('anerley-updated').textContent = this.getTimeAgo(new Date());
        } catch (error) {
            console.error('Anerley TfL fetch error:', error);
            this.displayMockAnerley();
            document.getElementById('anerley-updated').textContent = 'Error';
        }
    }

    displayPlatformTrains(containerId, departures) {
        const container = document.getElementById(containerId);

        if (!departures || departures.length === 0) {
            container.innerHTML = '<div class="no-data">No trains</div>';
            return;
        }

        container.innerHTML = departures.map((dep, index) => {
            // Use real currentLocation from TfL API, fall back to estimated stops
            let locationText;
            if (dep.currentLocation) {
                locationText = dep.currentLocation;
            } else {
                const stopsAway = Math.max(1, Math.round(dep.mins / 3));
                locationText = dep.mins <= 1 ? 'Arriving' : `~${stopsAway} stop${stopsAway > 1 ? 's' : ''}`;
            }

            // Only show hype for first departure
            const hype = index === 0 ? this.getDepartureHype(dep.mins) : null;

            const scheduledStr = dep.scheduledTime || (dep.mins != null ? new Date(Date.now() + dep.mins * 60000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');

            return `
                <div class="departure" onclick="pengeDash.openModal('anr', 'Anerley', '${this.escapeAttr(dep.dest)}')">
                    <div class="departure-info">
                        <span class="departure-destination">${this.escapeHtml(dep.dest)}</span>
                        <span class="departure-location">${this.escapeHtml(locationText)}</span>
                    </div>
                    <div class="departure-time">
                        <span class="departure-due ${dep.mins <= 3 ? 'urgent' : ''}">${dep.mins} min</span>
                        ${scheduledStr ? `<span class="departure-scheduled">${scheduledStr}</span>` : ''}
                        ${hype ? `<span class="departure-hype">${hype}</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    displayMockAnerley() {
        const mockPlatform1 = [
            { dest: 'Highbury & Islington', mins: 6 },
            { dest: 'Highbury & Islington', mins: 21 },
            { dest: 'Highbury & Islington', mins: 36 }
        ];
        const mockPlatform2 = [
            { dest: 'West Croydon', mins: 11 },
            { dest: 'West Croydon', mins: 26 },
            { dest: 'West Croydon', mins: 41 }
        ];

        this.displayPlatformTrains('anr-platform-1', mockPlatform1);
        this.displayPlatformTrains('anr-platform-2', mockPlatform2);
    }

    displayTrains(stationId, departures) {
        const container = document.getElementById(`${stationId}-departures`);
        const stationNames = {
            'pnw': 'Penge West',
            'pne': 'Penge East',
            'bkb': 'Birkbeck',
            'anr': 'Anerley'
        };

        if (!departures || departures.length === 0) {
            container.innerHTML = '<div class="no-data">No departures found</div>';
            return;
        }

        container.innerHTML = departures.map(dep => `
            <div class="departure" onclick="pengeDash.openModal('${this.escapeAttr(stationId)}', '${this.escapeAttr(stationNames[stationId])}', '${this.escapeAttr(dep.dest)}')">
                <div class="departure-info">
                    ${dep.platform && dep.platform !== '-' ? `<span class="departure-platform">P${this.escapeHtml(dep.platform)}</span>` : ''}
                    <span class="departure-destination">${this.escapeHtml(dep.dest)}</span>
                </div>
                <div class="departure-time">
                    <span class="departure-due">${dep.mins} min</span>
                </div>
            </div>
        `).join('');
    }

    displayMockTrains(stationId) {
        // Anerley uses platform-based display
        if (stationId === 'anr') {
            this.displayMockAnerley();
            return;
        }

        const container = document.getElementById(`${stationId}-departures`);
        const stationNames = {
            'pnw': 'Penge West',
            'pne': 'Penge East',
            'bkb': 'Birkbeck'
        };

        const mockData = {
            pnw: [
                { dest: 'Victoria', platform: '1', mins: 3 },
                { dest: 'London Bridge', platform: '2', mins: 8 },
                { dest: 'Victoria', platform: '1', mins: 18 },
                { dest: 'London Bridge', platform: '2', mins: 23 },
                { dest: 'Victoria', platform: '1', mins: 33 },
                { dest: 'London Bridge', platform: '2', mins: 38 }
            ],
            pne: [
                { dest: 'London Bridge', platform: '1', mins: 5 },
                { dest: 'Orpington', platform: '2', mins: 12 },
                { dest: 'London Bridge', platform: '1', mins: 20 },
                { dest: 'Orpington', platform: '2', mins: 27 },
                { dest: 'London Bridge', platform: '1', mins: 35 },
                { dest: 'Orpington', platform: '2', mins: 42 }
            ],
            bkb: [
                { dest: 'Beckenham Junction', platform: '1', mins: 4 },
                { dest: 'Wimbledon', platform: '2', mins: 9 },
                { dest: 'West Croydon', platform: '1', mins: 15 },
                { dest: 'Beckenham Junction', platform: '1', mins: 19 },
                { dest: 'Wimbledon', platform: '2', mins: 24 },
                { dest: 'West Croydon', platform: '1', mins: 30 }
            ],
            anr: [
                { dest: 'Highbury & Islington', platform: '1', mins: 6 },
                { dest: 'West Croydon', platform: '2', mins: 11 },
                { dest: 'Highbury & Islington', platform: '1', mins: 21 },
                { dest: 'West Croydon', platform: '2', mins: 26 },
                { dest: 'Highbury & Islington', platform: '1', mins: 36 },
                { dest: 'West Croydon', platform: '2', mins: 41 }
            ]
        };

        const data = mockData[stationId] || [];

        // Store all data for modal
        this.stationData[stationId] = data;

        // Display first 3
        const displayData = data.slice(0, 3);

        const dirLookup = PLATFORM_DIRECTIONS[stationId] || {};

        container.innerHTML = displayData.map(dep => {
            const dirLabel = dep.platform ? (dirLookup[dep.platform] || '') : '';
            const scheduledStr = new Date(Date.now() + dep.mins * 60000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            return `
            <div class="departure" onclick="pengeDash.openModal('${this.escapeAttr(stationId)}', '${this.escapeAttr(stationNames[stationId])}', '${this.escapeAttr(dep.dest)}')">
                <div class="departure-info">
                    ${dep.platform ? `<span class="departure-platform">P${this.escapeHtml(dep.platform)}</span>` : ''}
                    ${dirLabel ? `<span class="departure-platform-dir">${dirLabel}</span>` : ''}
                    <span class="departure-destination">${this.escapeHtml(dep.dest)}</span>
                </div>
                <div class="departure-time">
                    <span class="departure-due">${dep.mins} min</span>
                    <span class="departure-scheduled">${scheduledStr}</span>
                </div>
            </div>
        `}).join('');
    }

    // ==================== BUSES ====================
    async fetchBuses() {
        if (CONFIG.USE_MOCK_DATA) {
            this.displayMockBuses();
            return;
        }

        try {
            // Fetch from both stops separately
            const eastStop = CONFIG.BUS_STOPS[0]; // 490009371E - towards Crystal Palace
            const westStop = CONFIG.BUS_STOPS[1]; // 490009371W - towards Beckenham

            const fetchStop = async (stopId) => {
                let url = `https://api.tfl.gov.uk/StopPoint/${stopId}/Arrivals`;
                if (CONFIG.TFL_APP_KEY) {
                    url += `?app_id=${CONFIG.TFL_APP_ID}&app_key=${CONFIG.TFL_APP_KEY}`;
                }
                const response = await fetch(url);
                return response.json();
            };

            const [eastArrivals, westArrivals] = await Promise.all([
                fetchStop(eastStop),
                fetchStop(westStop)
            ]);

            // Cache bus data
            this.cacheData('buses', { east: eastArrivals, west: westArrivals });

            this.displayBuses(eastArrivals, westArrivals);
            document.getElementById('buses-updated').textContent = this.getTimeAgo(new Date());
        } catch (error) {
            console.error('Bus fetch error:', error);
            // Try cached data first
            const cachedBuses = this.getCachedData('buses');
            if (cachedBuses) {
                this.displayBuses(cachedBuses.east, cachedBuses.west);
                document.getElementById('buses-updated').textContent = 'Cached';
            } else {
                this.displayMockBuses();
            }
        }
    }

    displayBuses(eastArrivals, westArrivals) {
        const eastContainer = document.getElementById('bus-arrivals-east');
        const westContainer = document.getElementById('bus-arrivals-west');

        // Store bus data for smart journey insights
        this.busArrivalData = [...(eastArrivals || []), ...(westArrivals || [])];

        // Helper to render bus list
        const renderBuses = (container, arrivals) => {
            if (!arrivals || arrivals.length === 0) {
                container.innerHTML = '<div class="no-data">No buses</div>';
                return;
            }

            // Sort by time and take first 4
            const sorted = arrivals
                .sort((a, b) => a.timeToStation - b.timeToStation)
                .slice(0, 4);

            container.innerHTML = sorted.map(bus => {
                const mins = Math.floor(bus.timeToStation / 60);
                // Use real currentLocation from TfL API, fall back to estimated stops
                let locationText;
                if (bus.currentLocation) {
                    locationText = bus.currentLocation;
                } else {
                    const stopsAway = Math.max(1, Math.round(mins / 2));
                    locationText = mins <= 1 ? 'Arriving' : `~${stopsAway} stop${stopsAway > 1 ? 's' : ''}`;
                }

                // Scheduled arrival time
                const arrivalTime = bus.expectedArrival
                    ? new Date(bus.expectedArrival)
                    : new Date(Date.now() + bus.timeToStation * 1000);
                const arrivalStr = arrivalTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

                return `
                    <div class="bus-arrival">
                        <div class="bus-route">
                            <span class="bus-number">${this.escapeHtml(bus.lineName)}</span>
                            <div class="bus-info">
                                <span class="bus-destination">${this.escapeHtml(bus.destinationName)}</span>
                                <span class="bus-location">${this.escapeHtml(locationText)}</span>
                            </div>
                        </div>
                        <div class="bus-time-col">
                            <span class="bus-time">${mins} min</span>
                            <span class="bus-scheduled">${arrivalStr}</span>
                        </div>
                    </div>
                `;
            }).join('');
        };

        renderBuses(eastContainer, eastArrivals);
        renderBuses(westContainer, westArrivals);
    }

    displayMockBuses() {
        const eastContainer = document.getElementById('bus-arrivals-east');
        const westContainer = document.getElementById('bus-arrivals-west');

        const mockEastBuses = [
            { route: '227', dest: 'Crystal Palace', mins: 3 },
            { route: '176', dest: 'Tottenham Ct Rd', mins: 8 },
            { route: '227', dest: 'Crystal Palace', mins: 15 },
            { route: '176', dest: 'Tottenham Ct Rd', mins: 22 }
        ];

        const mockWestBuses = [
            { route: '176', dest: 'Penge', mins: 2 },
            { route: '227', dest: 'Bromley North', mins: 6 },
            { route: '354', dest: 'Bromley', mins: 11 },
            { route: '176', dest: 'Penge', mins: 17 }
        ];

        const renderMockBus = (bus) => {
            const arrivalStr = new Date(Date.now() + bus.mins * 60000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            return `
            <div class="bus-arrival">
                <div class="bus-route">
                    <span class="bus-number">${bus.route}</span>
                    <span class="bus-destination">${bus.dest}</span>
                </div>
                <div class="bus-time-col">
                    <span class="bus-time">${bus.mins} min</span>
                    <span class="bus-scheduled">${arrivalStr}</span>
                </div>
            </div>
        `};

        eastContainer.innerHTML = mockEastBuses.map(renderMockBus).join('');
        westContainer.innerHTML = mockWestBuses.map(renderMockBus).join('');

        document.getElementById('buses-updated').textContent = 'Demo data';
    }

    // ==================== LINE STATUS ====================
    async fetchLineStatus() {
        const container = document.getElementById('line-statuses');

        try {
            // Fetch status for relevant lines (location-aware)
            const lines = this.getRelevantLineIds();
            let url = `https://api.tfl.gov.uk/Line/${lines.join(',')}/Status`;

            if (CONFIG.TFL_APP_KEY) {
                url += `?app_id=${CONFIG.TFL_APP_ID}&app_key=${CONFIG.TFL_APP_KEY}`;
            }

            const response = await fetch(url);
            const data = await response.json();

            // Cache line status
            this.cacheData('lines', data);

            this.displayLineStatus(data);
            this.checkServiceAlerts(data);
            document.getElementById('lines-updated').textContent = this.getTimeAgo(new Date());
        } catch (error) {
            console.error('Line status fetch error:', error);
            // Try cached data first
            const cachedLines = this.getCachedData('lines');
            if (cachedLines) {
                this.displayLineStatus(cachedLines);
                this.checkServiceAlerts(cachedLines);
                document.getElementById('lines-updated').textContent = 'Cached';
            } else {
                container.innerHTML = '<div class="no-data">Unable to load line status</div>';
            }
        }
    }

    getRelevantLineIds() {
        const base = ['jubilee', 'northern', 'victoria', 'elizabeth',
            'southern', 'southeastern', 'thameslink', ...OVERGROUND_LINES];
        const nearby = [];
        (this.nearbyStations || []).forEach(s =>
            (s.lines || []).forEach(l => { if (l.id) nearby.push(l.id); }));
        return [...new Set([...base, ...nearby])];
    }

    displayLineStatus(lines) {
        const container = document.getElementById('line-statuses');

        // Store line status data for smart journey insights (string map, used elsewhere)
        this.lineStatusData = {};
        // Store full details for the tappable alert modal
        this.lineDetails = {};
        lines.forEach(line => {
            const ls = line.lineStatuses && line.lineStatuses[0];
            const status = (ls && ls.statusSeverityDescription) || 'Unknown';
            this.lineStatusData[line.id] = status;
            if (line.name) this.lineStatusData[line.name.toLowerCase()] = status;
            this.lineDetails[line.id] = {
                name: (LINE_META[line.id] && LINE_META[line.id].name) || line.name,
                status,
                reason: (ls && ls.reason) || '',
                disruption: (ls && ls.disruption && ls.disruption.description) || ''
            };
        });

        container.innerHTML = lines.map(line => {
            const meta = LINE_META[line.id] || { name: line.name, class: '' };
            const ls = line.lineStatuses && line.lineStatuses[0];
            const statusText = (ls && ls.statusSeverityDescription) || 'Unknown';
            const statusClass = statusText.toLowerCase().replace(/\s+/g, '-');

            return `
                <div class="line-status ${meta.class}">
                    <span class="line-name">${this.escapeHtml(meta.name)}</span>
                    <span class="line-status-badge ${statusClass}">${this.escapeHtml(statusText)}</span>
                </div>
            `;
        }).join('');
    }

    checkServiceAlerts(lines) {
        const alertBanner = document.getElementById('service-alert');
        const alertText = document.getElementById('alert-text');
        const statusMessage = document.getElementById('status-message');

        // Find lines with issues (not "Good Service")
        const issues = lines.filter(line => {
            const ls = line.lineStatuses && line.lineStatuses[0];
            return ls && ls.statusSeverityDescription !== 'Good Service';
        });

        // Update status message with transport mood
        statusMessage.textContent = this.getTransportMood(issues);

        if (issues.length === 0) {
            alertBanner.style.display = 'none';
            this._alertIssues = [];
            return;
        }

        // Build alert summary + retain detail for the modal
        this._alertIssues = issues.map(line => {
            const ls = line.lineStatuses[0];
            return {
                name: (LINE_META[line.id] && LINE_META[line.id].name) || line.name,
                status: ls.statusSeverityDescription,
                reason: ls.reason || '',
                disruption: (ls.disruption && ls.disruption.description) || ''
            };
        });

        const summary = this._alertIssues.map(i => `${i.name}: ${i.status}`);
        alertText.textContent = summary.join(' | ');
        alertBanner.style.display = 'flex';
    }

    openAlertModal() {
        const issues = this._alertIssues || [];
        if (issues.length === 0) return;
        const body = issues.map(i => {
            const detail = i.reason || i.disruption || 'No further detail provided by TfL.';
            return `
                <div class="alert-detail-item">
                    <div class="alert-detail-line">${this.escapeHtml(i.name)}</div>
                    <div class="alert-detail-status">${this.escapeHtml(i.status)}</div>
                    <div class="alert-detail-reason">${this.escapeHtml(detail)}</div>
                </div>`;
        }).join('');
        this.openDetailModal('⚠️ Service disruptions', body);
    }

    // ==================== TRAFFIC DISRUPTIONS ====================
    async fetchTrafficDisruptions() {
        const container = document.getElementById('traffic-disruptions');
        const updateTime = document.getElementById('traffic-updated');

        if (!container) return; // Card not in DOM yet

        try {
            let url = 'https://api.tfl.gov.uk/Road/all/Disruption';
            if (CONFIG.TFL_APP_KEY) {
                url += `?app_id=${CONFIG.TFL_APP_ID}&app_key=${CONFIG.TFL_APP_KEY}`;
            }

            const response = await fetch(url);
            const data = await response.json();

            // Filter to SE20 area (approximately 3km radius)
            const localDisruptions = this.filterLocalDisruptions(data);
            this.displayTrafficDisruptions(localDisruptions);
            if (updateTime) updateTime.textContent = this.getTimeAgo(new Date());
        } catch (error) {
            console.error('Traffic disruption fetch error:', error);
            if (container) container.innerHTML = '<div class="no-data">Unable to load traffic</div>';
        }
    }

    filterLocalDisruptions(disruptions) {
        const { lat: homeLat, lon: homeLon } = this.home || CONFIG.LOCATION;
        const radiusKm = 3;

        return disruptions.filter(d => {
            // Check if point coordinates exist
            if (d.point) {
                const coords = d.point.split(',').map(Number);
                if (coords.length === 2) {
                    const [lon, lat] = coords; // TfL returns [lon, lat]
                    if (!isNaN(lat) && !isNaN(lon)) {
                        const distance = this.calculateDistance(homeLat, homeLon, lat, lon);
                        return distance <= radiusKm;
                    }
                }
            }

            // Fallback: check if location mentions SE20 area
            const location = (d.location || '').toLowerCase();
            return location.includes('penge') ||
                   location.includes('crystal palace') ||
                   location.includes('anerley') ||
                   location.includes('beckenham') ||
                   location.includes('sydenham') ||
                   location.includes('se20') ||
                   location.includes('se26') ||
                   location.includes('se19');
        }).slice(0, 5);
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        // Haversine formula
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    displayTrafficDisruptions(disruptions) {
        const container = document.getElementById('traffic-disruptions');
        if (!container) return;

        if (!disruptions || disruptions.length === 0) {
            container.innerHTML = `
                <div class="traffic-clear">
                    <span class="traffic-icon">✅</span>
                    <span>No major disruptions nearby</span>
                </div>
            `;
            return;
        }

        container.innerHTML = disruptions.map(d => {
            const severityClass = this.getSeverityClass(d.severity);
            const icon = this.getDisruptionIcon(d.category);
            const desc = d.comments || d.currentUpdate || 'No details';
            const shortDesc = desc.length > 80 ? desc.substring(0, 80) + '...' : desc;

            return `
                <div class="traffic-disruption ${severityClass}">
                    <div class="disruption-header">
                        <span class="disruption-icon">${icon}</span>
                        <span class="disruption-severity ${severityClass}">${this.escapeHtml(d.severity || 'Info')}</span>
                    </div>
                    <div class="disruption-location">${this.escapeHtml(d.location || 'Unknown')}</div>
                    <div class="disruption-desc">${this.escapeHtml(shortDesc)}</div>
                </div>
            `;
        }).join('');
    }

    getSeverityClass(severity) {
        if (!severity) return 'unknown';
        const s = severity.toLowerCase();
        if (s.includes('severe') || s.includes('serious')) return 'severe';
        if (s.includes('moderate')) return 'moderate';
        return 'minimal';
    }

    getDisruptionIcon(category) {
        if (!category) return '⚠️';
        const c = category.toLowerCase();
        if (c.includes('works')) return '🚧';
        if (c.includes('collision') || c.includes('accident')) return '💥';
        if (c.includes('closure')) return '🚫';
        if (c.includes('event')) return '🎭';
        return '🚗';
    }

    // ==================== JOURNEY PLANNER (CityMapper-style) ====================
    setupJourneyPlanner() {
        // Default destinations
        this.defaultDestinations = ['Victoria', 'London Br', 'E.Croydon', 'Bromley S', 'Canary Whf'];
        this.journeyOrigin = 'home';
        this.journeyTimeOffset = 0;
        this.journeyModes = null; // null = all modes
        this.currentLocation = null;
        this.fetchingLocation = false;

        // Load saved destinations or use defaults
        this.loadDestinations();
        this.renderDestinationChips();

        // Load favourite journeys
        this.loadFavouriteJourneys();
        this.renderFavouriteJourneys();

        // From field tap → toggle origin
        const fromRow = document.getElementById('journey-from-row');
        if (fromRow) {
            fromRow.addEventListener('click', (e) => {
                // Don't toggle if swap button was clicked
                if (e.target.closest('.journey-origin-swap')) return;
                this.toggleOrigin();
            });
        }

        // Swap button
        const swapBtn = document.getElementById('origin-swap-btn');
        if (swapBtn) {
            swapBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleOrigin();
            });
        }

        // Search button
        document.getElementById('journey-search-btn').addEventListener('click', () => {
            const input = document.getElementById('destination-input');
            const destination = input.value.trim();
            if (destination) {
                document.querySelectorAll('.destination-chip').forEach(c => c.classList.remove('active'));
                this.planJourney(destination);
            }
        });

        // Enter key in search input
        document.getElementById('destination-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.hideAutocomplete();
                document.getElementById('journey-search-btn').click();
            }
        });

        // Setup autocomplete
        this.setupAutocomplete();

        // Time pill handlers
        document.querySelectorAll('.time-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll('.time-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                this.journeyTimeOffset = parseInt(pill.dataset.offset, 10);
            });
        });

        // Mode filter pill handlers (re-runs the search if one is active)
        document.querySelectorAll('.mode-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll('.mode-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                const mode = pill.dataset.mode;
                this.journeyModes = (mode === 'all') ? null : mode;
                // If a destination is already entered, re-plan with the new mode
                const dest = document.getElementById('destination-input').value.trim();
                if (dest && document.getElementById('journey-results').style.display === 'block') {
                    this.planJourney(dest);
                }
            });
        });
    }

    // ==================== AUTOCOMPLETE ====================
    setupAutocomplete() {
        const input = document.getElementById('destination-input');
        const dropdown = document.getElementById('autocomplete-dropdown');
        if (!input || !dropdown) return;

        this._acDebounceTimer = null;

        input.addEventListener('input', () => {
            clearTimeout(this._acDebounceTimer);
            const query = input.value.trim();

            if (query.length < 2) {
                this.hideAutocomplete();
                return;
            }

            this._acDebounceTimer = setTimeout(() => {
                this.fetchAutocompleteSuggestions(query);
            }, 300);
        });

        // Hide on Escape
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideAutocomplete();
            }
        });

        // Hide on blur (delay to allow click on dropdown item)
        input.addEventListener('blur', () => {
            setTimeout(() => this.hideAutocomplete(), 200);
        });
    }

    async fetchAutocompleteSuggestions(query) {
        try {
            let url = `https://api.tfl.gov.uk/StopPoint/Search?query=${encodeURIComponent(query)}&modes=tube,bus,national-rail,overground,dlr,elizabeth-line&maxResults=5`;
            if (CONFIG.TFL_APP_KEY) {
                url += `&app_id=${CONFIG.TFL_APP_ID}&app_key=${CONFIG.TFL_APP_KEY}`;
            }

            const response = await fetch(url);
            const data = await response.json();

            if (data.matches && data.matches.length > 0) {
                this.renderAutocomplete(data.matches);
            } else {
                this.hideAutocomplete();
            }
        } catch (error) {
            console.error('Autocomplete fetch error:', error);
            this.hideAutocomplete();
        }
    }

    renderAutocomplete(results) {
        const dropdown = document.getElementById('autocomplete-dropdown');
        if (!dropdown) return;

        const modeIcons = {
            'tube': '🚇', 'bus': '🚌', 'national-rail': '🚂',
            'overground': '🚆', 'dlr': '🚈', 'elizabeth-line': '🟣'
        };

        dropdown.innerHTML = results.map(result => {
            const modes = (result.modes || [])
                .map(m => modeIcons[m] || '')
                .filter(Boolean)
                .join(' ');

            return `
                <div class="autocomplete-item" data-name="${this.escapeAttr(result.name)}">
                    <div class="ac-name">${this.escapeHtml(result.name)}</div>
                    ${modes ? `<div class="ac-modes">${modes}</div>` : ''}
                </div>
            `;
        }).join('');

        dropdown.classList.add('visible');

        // Click handlers on items
        dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('mousedown', (e) => {
                e.preventDefault(); // Prevent blur from firing first
                const name = item.dataset.name;
                const input = document.getElementById('destination-input');
                input.value = name;
                this.hideAutocomplete();
                document.querySelectorAll('.destination-chip').forEach(c => c.classList.remove('active'));
                this.planJourney(name);
            });
        });
    }

    hideAutocomplete() {
        const dropdown = document.getElementById('autocomplete-dropdown');
        if (dropdown) {
            dropdown.classList.remove('visible');
            dropdown.innerHTML = '';
        }
    }

    toggleOrigin() {
        if (this.journeyOrigin === 'home') {
            this.setJourneyOrigin('here');
        } else {
            this.setJourneyOrigin('home');
        }
    }

    loadDestinations() {
        try {
            const saved = localStorage.getItem('pengedash-destinations');
            this.destinations = saved ? JSON.parse(saved) : [...this.defaultDestinations];
        } catch (e) {
            this.destinations = [...this.defaultDestinations];
        }
    }

    saveDestinations() {
        localStorage.setItem('pengedash-destinations', JSON.stringify(this.destinations));
    }

    renderDestinationChips() {
        const container = document.getElementById('journey-quick-picks');
        if (!container) return;

        const chipsHtml = this.destinations.map(dest => `
            <button class="destination-chip" data-destination="${this.escapeHtml(dest)}">${this.escapeHtml(dest)}</button>
        `).join('');

        container.innerHTML = chipsHtml + `<button class="add-chip" id="add-dest-chip">+</button>`;

        // Use single delegated handler (avoids listener leak on re-render)
        // Remove old handler if exists
        if (this._chipHandler) container.removeEventListener('click', this._chipHandler);

        this._chipHandler = (e) => {
            const chip = e.target.closest('.destination-chip');
            const addBtn = e.target.closest('.add-chip');

            if (chip) {
                container.querySelectorAll('.destination-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                document.getElementById('destination-input').value = '';
                this.planJourney(chip.dataset.destination);
            } else if (addBtn) {
                const dest = prompt('Add destination:');
                if (dest && dest.trim()) {
                    const trimmed = dest.trim();
                    if (!this.destinations.some(d => d.toLowerCase() === trimmed.toLowerCase())) {
                        this.destinations.push(trimmed);
                        this.saveDestinations();
                        this.renderDestinationChips();
                    }
                }
            }
        };
        container.addEventListener('click', this._chipHandler);

        // Long-press to delete on mobile (delegated)
        if (this._chipTouchStart) container.removeEventListener('touchstart', this._chipTouchStart);
        if (this._chipTouchEnd) container.removeEventListener('touchend', this._chipTouchEnd);
        if (this._chipTouchMove) container.removeEventListener('touchmove', this._chipTouchMove);

        let pressTimer;
        this._chipTouchStart = (e) => {
            const chip = e.target.closest('.destination-chip');
            if (!chip) return;
            pressTimer = setTimeout(() => {
                if (confirm(`Remove "${chip.dataset.destination}"?`)) {
                    this.removeDestination(chip.dataset.destination);
                }
            }, 600);
        };
        this._chipTouchEnd = () => clearTimeout(pressTimer);
        this._chipTouchMove = () => clearTimeout(pressTimer);

        container.addEventListener('touchstart', this._chipTouchStart, { passive: true });
        container.addEventListener('touchend', this._chipTouchEnd);
        container.addEventListener('touchmove', this._chipTouchMove);
    }

    removeDestination(destination) {
        this.destinations = this.destinations.filter(d => d !== destination);
        this.saveDestinations();
        this.renderDestinationChips();
    }

    async planJourney(destination) {
        const resultsContainer = document.getElementById('journey-results');
        const updateTime = document.getElementById('journey-updated');

        // Show loading state
        resultsContainer.style.display = 'block';
        resultsContainer.innerHTML = '<div class="journey-loading">Finding best route... 🔍</div>';
        updateTime.textContent = 'Searching...';

        try {
            // Determine origin based on mode
            let from;
            if (this.journeyOrigin === 'here' && this.currentLocation) {
                // Use current GPS coordinates
                from = `${this.currentLocation.lat},${this.currentLocation.lon}`;
            } else if (this.journeyOrigin === 'here' && !this.currentLocation) {
                // Location not available
                resultsContainer.innerHTML = `
                    <div class="journey-error">
                        📍 Location not available.<br>
                        Please allow location access or switch to "From Home".
                    </div>
                `;
                updateTime.textContent = 'No location';
                return;
            } else {
                // Default: from the active home. Use postcode if we have one,
                // otherwise fall back to the home's coordinates.
                const home = this.home || CONFIG.LOCATION;
                from = home.postcode
                    ? home.postcode.replace(/\s/g, '')
                    : `${home.lat},${home.lon}`;
            }
            const to = encodeURIComponent(destination);

            let url = `https://api.tfl.gov.uk/Journey/JourneyResults/${from}/to/${to}`;
            if (CONFIG.TFL_APP_KEY) {
                url += `?app_id=${CONFIG.TFL_APP_ID}&app_key=${CONFIG.TFL_APP_KEY}`;
            }

            // Apply time offset if set
            if (this.journeyTimeOffset > 0) {
                const departTime = new Date(Date.now() + this.journeyTimeOffset * 60000);
                const sep = url.includes('?') ? '&' : '?';
                url += `${sep}dateTime=${departTime.toISOString().slice(0,16)}&timeIs=Departing`;
            }
            // Apply mode filter if set
            if (this.journeyModes) {
                const sep = url.includes('?') ? '&' : '?';
                url += `${sep}mode=${this.journeyModes}`;
            }

            let response = await fetch(url);
            let data = await response.json();

            // Handle disambiguation - TfL API returns this when destination is ambiguous
            // (e.g., "Victoria" could be multiple places)
            if (data.toLocationDisambiguation &&
                data.toLocationDisambiguation.matchStatus === 'list' &&
                data.toLocationDisambiguation.disambiguationOptions &&
                data.toLocationDisambiguation.disambiguationOptions.length > 0) {

                // Find the best match - prefer stations over general places
                const options = data.toLocationDisambiguation.disambiguationOptions;
                let bestOption = options[0]; // Default to first (highest match quality)

                // Try to find a station match (StopPoint) for better results
                // Prioritize rail/tube/overground/dlr stations over bus stops
                const stationMatch = options.find(opt =>
                    opt.place &&
                    opt.place.placeType === 'StopPoint' &&
                    opt.place.modes &&
                    (opt.place.modes.includes('national-rail') ||
                     opt.place.modes.includes('tube') ||
                     opt.place.modes.includes('overground') ||
                     opt.place.modes.includes('dlr') ||
                     opt.place.modes.includes('elizabeth-line'))
                );

                if (stationMatch) {
                    bestOption = stationMatch;
                }

                // Make a second request with the resolved destination
                const resolvedTo = bestOption.parameterValue;
                let resolvedUrl = `https://api.tfl.gov.uk/Journey/JourneyResults/${from}/to/${encodeURIComponent(resolvedTo)}`;
                if (CONFIG.TFL_APP_KEY) {
                    resolvedUrl += `?app_id=${CONFIG.TFL_APP_ID}&app_key=${CONFIG.TFL_APP_KEY}`;
                }
                if (this.journeyTimeOffset > 0) {
                    const departTime = new Date(Date.now() + this.journeyTimeOffset * 60000);
                    const sep = resolvedUrl.includes('?') ? '&' : '?';
                    resolvedUrl += `${sep}dateTime=${departTime.toISOString().slice(0,16)}&timeIs=Departing`;
                }
                if (this.journeyModes) {
                    const sep = resolvedUrl.includes('?') ? '&' : '?';
                    resolvedUrl += `${sep}mode=${this.journeyModes}`;
                }

                response = await fetch(resolvedUrl);
                data = await response.json();
            }

            if (data.journeys && data.journeys.length > 0) {
                this.displayRouteOptions(data.journeys, destination);
                updateTime.textContent = this.getTimeAgo(new Date());
            } else {
                resultsContainer.innerHTML = `
                    <div class="journey-error">
                        😕 Couldn't find a route to "${this.escapeHtml(destination)}".<br>
                        Try a more specific location or station name.
                    </div>
                `;
                updateTime.textContent = 'No route found';
            }
        } catch (error) {
            console.error('Journey planner error:', error);
            resultsContainer.innerHTML = `
                <div class="journey-error">
                    😵 Something went wrong. Try again?
                </div>
            `;
            updateTime.textContent = 'Error';
        }
    }

    displayRouteOptions(journeys, destination) {
        const container = document.getElementById('journey-results');

        // Save as favourite journey
        this.saveFavouriteJourney(destination);

        // Build route cards for each journey option
        const routeCards = journeys.map((journey, index) => {
            const primaryMode = this.getPrimaryMode(journey);
            const modeIcon = this.getJourneyModeIcon(primaryMode.mode);
            const modeClass = this.getRouteModeClass(primaryMode);
            const duration = journey.duration;
            const depTime = new Date(journey.startDateTime);
            const arrTime = new Date(journey.arrivalDateTime);
            const depStr = depTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            const arrStr = arrTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

            // Route summary
            const summary = this.getRouteSummary(journey);

            // Smart insights
            const smartInsights = this.getSmartInsight(journey);
            const weatherInsight = this.getWeatherInsight(primaryMode.mode, duration);
            const disruptionInsights = this.getDisruptionInsight(journey);

            const allInsights = [...smartInsights, ...disruptionInsights];
            if (weatherInsight) allInsights.push(weatherInsight);

            const insightsHtml = allInsights.length > 0 ? `
                <div class="route-card-smart">
                    ${allInsights.map(i => `<div class="smart-insight ${i.type}">${i.text}</div>`).join('')}
                </div>
            ` : '';

            // Full leg detail (hidden, shown on tap)
            const legsHtml = journey.legs.map(leg => {
                const mode = leg.mode?.id || 'walking';
                const icon = this.getJourneyModeIcon(mode);
                const lineName = leg.routeOptions?.[0]?.name || leg.instruction?.detailed || '';
                const lineId = this.getLineClass(lineName);
                let instruction = leg.instruction?.summary || leg.instruction?.detailed || '';

                if (mode === 'walking') {
                    instruction = `Walk to ${leg.arrivalPoint?.commonName || 'destination'}`;
                } else if (mode === 'bus') {
                    instruction = `${lineName} bus to ${leg.arrivalPoint?.commonName || ''}`;
                } else {
                    instruction = `${lineName} to ${leg.arrivalPoint?.commonName || ''}`;
                }

                const durationMins = leg.duration || 0;

                return `
                    <div class="journey-leg">
                        <div class="leg-icon">${icon}</div>
                        <div class="leg-details">
                            <div class="leg-instruction">
                                ${instruction}
                                ${lineId && mode !== 'walking' ? `<span class="leg-line-badge ${lineId}">${lineName}</span>` : ''}
                            </div>
                            <div class="leg-time">${this.formatLegTime(leg)}</div>
                        </div>
                        <div class="leg-duration">${durationMins} min</div>
                    </div>
                `;
            }).join('');

            // Extract fare if available (in pence)
            const farePence = journey.fare?.totalCost;
            const fareHtml = farePence != null ? ` · <span class="route-fare">£${(farePence / 100).toFixed(2)}</span>` : '';

            return `
                <div class="route-card ${modeClass}" data-index="${index}">
                    <div class="route-card-header">
                        <span class="route-mode-icon">${modeIcon}</span>
                        <span class="route-summary">${summary}</span>
                        <span class="route-duration">${duration} min</span>
                    </div>
                    <div class="route-card-meta">Departs ${depStr} · Arrives ${arrStr}${fareHtml}</div>
                    ${insightsHtml}
                    <div class="route-card-detail">
                        <div class="journey-route">${legsHtml}</div>
                    </div>
                </div>
            `;
        }).join('');

        // Add walking option if destination is relatively close
        const walkingCard = this.getWalkingOption(destination, journeys[0]);

        // Show departure time header if using offset
        let headerText = 'Getting there';
        if (this.journeyTimeOffset > 0) {
            const departAt = new Date(Date.now() + this.journeyTimeOffset * 60000);
            const timeStr = departAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            headerText = `Departing at ${timeStr}`;
        }

        container.innerHTML = `
            <div class="route-options-header">${headerText}</div>
            <div class="route-options">
                ${routeCards}
                ${walkingCard}
            </div>
        `;

        // Draw the first journey on the map
        this._lastJourneys = journeys;
        this.drawJourneyRoute(journeys[0]);

        // Bind tap-to-expand on route cards (and redraw that route on the map)
        container.querySelectorAll('.route-card').forEach(card => {
            card.addEventListener('click', () => {
                const wasActive = card.classList.contains('active');
                // Collapse all
                container.querySelectorAll('.route-card').forEach(c => c.classList.remove('active'));
                // Toggle this one
                if (!wasActive) {
                    card.classList.add('active');
                    const idx = parseInt(card.dataset.index, 10);
                    if (!isNaN(idx) && this._lastJourneys[idx]) this.drawJourneyRoute(this._lastJourneys[idx], true);
                    // Scroll into view
                    setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
                }
            });
        });
    }

    getPrimaryMode(journey) {
        // Find the main non-walking leg
        const nonWalkingLegs = journey.legs.filter(l => l.mode?.id !== 'walking');
        if (nonWalkingLegs.length === 0) return { mode: 'walking', line: '' };

        // If multiple different modes, it's mixed
        const modes = new Set(nonWalkingLegs.map(l => l.mode?.id));
        if (modes.size > 1) {
            return { mode: 'mixed', line: '' };
        }

        const mainLeg = nonWalkingLegs[0];
        return {
            mode: mainLeg.mode?.id || 'walking',
            line: mainLeg.routeOptions?.[0]?.name || ''
        };
    }

    getRouteModeClass(primaryMode) {
        const mode = primaryMode.mode;
        const line = (primaryMode.line || '').toLowerCase();

        if (mode === 'walking') return 'mode-walk';
        if (mode === 'bus') return 'mode-bus';
        if (mode === 'tube') return 'mode-tube';
        if (mode === 'overground') return 'mode-overground';
        if (mode === 'mixed') return 'mode-mixed';
        if (mode === 'national-rail') {
            if (line.includes('southeastern')) return 'mode-southeastern';
            return 'mode-train';
        }
        return 'mode-mixed';
    }

    getRouteSummary(journey) {
        const nonWalkingLegs = journey.legs.filter(l => l.mode?.id !== 'walking');
        if (nonWalkingLegs.length === 0) return 'Walk';

        return nonWalkingLegs.map(leg => {
            const lineName = leg.routeOptions?.[0]?.name || '';
            const mode = leg.mode?.id || '';
            const via = leg.departurePoint?.commonName || '';

            if (mode === 'bus') return `Bus ${lineName}`;
            if (lineName) return `${lineName}${via ? ` via ${via.split(' ')[0]}` : ''}`;
            return this.getJourneyModeIcon(mode);
        }).join(' → ');
    }

    getWalkingOption(destination, referenceJourney) {
        if (!referenceJourney) return '';

        // Estimate walking distance from journey endpoint
        const arrivalPoint = referenceJourney.legs[referenceJourney.legs.length - 1]?.arrivalPoint;
        if (!arrivalPoint?.lat || !arrivalPoint?.lon) return '';

        const { lat, lon } = this.home || CONFIG.LOCATION;
        const distance = this.calculateDistance(lat, lon, arrivalPoint.lat, arrivalPoint.lon);

        // Only show walking if under 4km
        if (distance > 4) return '';

        const walkingMins = Math.round((distance * 1.3) / (5 / 60)); // 5 km/h, 1.3x for non-straight paths
        const weatherInsight = this.getWeatherInsight('walking', walkingMins);

        const insightHtml = weatherInsight ? `
            <div class="route-card-smart">
                <div class="smart-insight ${weatherInsight.type}">${weatherInsight.text}</div>
            </div>
        ` : '';

        return `
            <div class="route-card mode-walk" data-index="walk">
                <div class="route-card-header">
                    <span class="route-mode-icon">🚶</span>
                    <span class="route-summary">Walk (${distance.toFixed(1)} km)</span>
                    <span class="route-duration">${walkingMins} min</span>
                </div>
                <div class="route-card-meta">Direct walking route</div>
                ${insightHtml}
            </div>
        `;
    }

    // ==================== SMART INSIGHTS ====================
    getSmartInsight(journey) {
        const insights = [];

        journey.legs.forEach(leg => {
            const mode = leg.mode?.id;

            // Train insight: match against live station data
            if (mode === 'national-rail' || mode === 'overground') {
                const stationName = (leg.departurePoint?.commonName || '').toLowerCase();
                const stationMap = {
                    'penge west': 'pnw',
                    'penge east': 'pne',
                    'anerley': 'anr',
                    'birkbeck': 'bkb'
                };

                for (const [name, id] of Object.entries(stationMap)) {
                    if (stationName.includes(name)) {
                        const liveData = this.stationData[id];
                        if (liveData && liveData.length > 0) {
                            const next = liveData[0];
                            const platformText = next.platform && next.platform !== '-' ? ` from Platform ${next.platform}` : '';
                            insights.push({
                                type: 'live',
                                text: `⚡ Next train in ${next.mins} min${platformText}`
                            });
                        }
                        break;
                    }
                }
            }

            // Bus insight: match against live bus data
            if (mode === 'bus') {
                const routeName = leg.routeOptions?.[0]?.name;
                if (routeName && this.busArrivalData) {
                    const matchingBus = this.busArrivalData
                        .filter(b => b.lineName === routeName)
                        .sort((a, b) => a.timeToStation - b.timeToStation)[0];

                    if (matchingBus) {
                        const mins = Math.floor(matchingBus.timeToStation / 60);
                        insights.push({
                            type: 'live',
                            text: `🚌 ${routeName} arriving in ${mins} min`
                        });
                    }
                }
            }
        });

        return insights;
    }

    getWeatherInsight(mode, durationMins) {
        if (!this.currentWeather) return null;

        const { temp, rainChance, condition } = this.currentWeather;

        if (mode === 'walking') {
            if (rainChance >= 60) {
                return { type: 'weather', text: '🌧️ Rain right now — consider other options' };
            }
            if (temp >= 10 && temp <= 25 && rainChance < 30) {
                return { type: 'weather', text: '🌤️ Nice weather — great for walking' };
            }
            if (temp < 5) {
                return { type: 'weather', text: '🥶 Cold out — wrap up if walking' };
            }
        }

        // For any mode: rain warning if expected during journey
        if (rainChance >= 50 && this.currentWeather.hourlyData) {
            const currentHour = new Date().getHours();
            const hoursAhead = Math.ceil(durationMins / 60);
            for (let i = 1; i <= hoursAhead && i < 12; i++) {
                const idx = currentHour + i;
                if (idx < this.currentWeather.hourlyData.precipitation_probability?.length) {
                    const prob = this.currentWeather.hourlyData.precipitation_probability[idx];
                    if (prob >= 60) {
                        const rainTime = `${(idx % 24).toString().padStart(2, '0')}:00`;
                        return { type: 'weather', text: `☔ Rain expected at ${rainTime} — bring umbrella` };
                    }
                }
            }
        }

        return null;
    }

    getDisruptionInsight(journey) {
        const insights = [];
        if (!this.lineStatusData) return insights;

        journey.legs.forEach(leg => {
            if (leg.mode?.id === 'walking') return;

            const lineName = (leg.routeOptions?.[0]?.name || '').toLowerCase();

            // Check against stored line status data
            for (const [lineId, status] of Object.entries(this.lineStatusData)) {
                if (status === 'Good Service') continue;

                if (lineName.includes(lineId) || lineId.includes(lineName.split(' ')[0])) {
                    const icon = status.toLowerCase().includes('severe') ? '🚫' : '⚠️';
                    const displayName = lineName.charAt(0).toUpperCase() + lineName.slice(1);
                    insights.push({
                        type: 'warning',
                        text: `${icon} ${displayName}: ${status.toLowerCase()}`
                    });
                    break;
                }
            }
        });

        return insights;
    }

    getJourneyModeIcon(mode) {
        const icons = {
            'walking': '🚶',
            'bus': '🚌',
            'tube': '🚇',
            'overground': '🚆',
            'dlr': '🚈',
            'national-rail': '🚂',
            'elizabeth-line': '🚇',
            'tram': '🚊',
            'cycle': '🚴',
            'coach': '🚌'
        };
        return icons[mode] || '🚆';
    }

    getLineClass(lineName) {
        if (!lineName) return '';
        const name = lineName.toLowerCase();

        if (name.includes('overground')) return 'overground';
        if (name.includes('southern')) return 'southern';
        if (name.includes('southeastern')) return 'southeastern';
        if (name.includes('thameslink')) return 'thameslink';
        if (name.includes('victoria')) return 'victoria';
        if (name.includes('northern')) return 'northern';
        if (name.includes('central')) return 'central';
        if (name.includes('jubilee')) return 'jubilee';
        if (name.includes('district')) return 'district';
        if (name.includes('circle')) return 'circle';
        if (name.includes('piccadilly')) return 'piccadilly';
        if (name.includes('bakerloo')) return 'bakerloo';
        if (name.includes('hammersmith')) return 'hammersmith';
        if (name.includes('metropolitan')) return 'metropolitan';
        if (name.includes('dlr')) return 'dlr';
        if (name.includes('elizabeth')) return 'elizabeth';
        if (/^\d+$/.test(name.trim())) return 'bus'; // Bus numbers

        return '';
    }

    formatLegTime(leg) {
        const dep = leg.departureTime ? new Date(leg.departureTime) : null;
        const arr = leg.arrivalTime ? new Date(leg.arrivalTime) : null;

        if (dep && arr) {
            const depStr = dep.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            const arrStr = arr.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            return `${depStr} → ${arrStr}`;
        }
        return '';
    }

    // ==================== ORIGIN TOGGLE (From Home / Current Location) ====================
    setJourneyOrigin(origin) {
        const fromText = document.getElementById('from-text');
        const locationStatus = document.getElementById('location-status');

        if (!fromText) return;

        this.journeyOrigin = origin;

        if (origin === 'here') {
            fromText.textContent = 'Current Location';
            if (locationStatus) locationStatus.style.display = 'flex';
            this.getCurrentLocation();
        } else {
            fromText.textContent = (this.home && this.home.label)
                || `Home (${((this.home && this.home.postcode) || 'SE20').split(' ')[0]})`;
            if (locationStatus) locationStatus.style.display = 'none';
            this.currentLocation = null;
        }
    }

    async getCurrentLocation() {
        const statusText = document.getElementById('location-text');
        if (!statusText) return;

        // Check for secure context (required for geolocation in most browsers)
        if (!window.isSecureContext && location.hostname !== 'localhost') {
            statusText.textContent = '❌ HTTPS required for location';
            return;
        }

        if (!navigator.geolocation) {
            statusText.textContent = '❌ Geolocation not supported';
            return;
        }

        // Prevent race conditions from rapid clicks
        if (this.fetchingLocation) return;
        this.fetchingLocation = true;

        statusText.textContent = 'Getting location...';

        try {
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 8000,
                    maximumAge: 15000  // 15 seconds - fresher for travel
                });
            });

            this.currentLocation = {
                lat: position.coords.latitude,
                lon: position.coords.longitude
            };

            // Try to get a friendly location name
            const locationName = await this.reverseGeocode(this.currentLocation);
            statusText.textContent = `📍 ${locationName}`;

        } catch (error) {
            console.error('Geolocation error:', error);
            if (error.code === 1) {
                statusText.textContent = '❌ Location denied - tap to use Home';
            } else if (error.code === 2) {
                statusText.textContent = '❌ Location unavailable';
            } else {
                statusText.textContent = '❌ Location timeout - try again';
            }
            this.currentLocation = null;
        } finally {
            this.fetchingLocation = false;
        }
    }

    async reverseGeocode(coords) {
        try {
            // Use TfL's StopPoint search to find nearby stations/stops
            let url = `https://api.tfl.gov.uk/StopPoint?lat=${coords.lat}&lon=${coords.lon}&stopTypes=NaptanRailStation,NaptanMetroStation&radius=500`;
            if (CONFIG.TFL_APP_KEY) {
                url += `&app_id=${CONFIG.TFL_APP_ID}&app_key=${CONFIG.TFL_APP_KEY}`;
            }

            const response = await fetch(url);
            const data = await response.json();

            if (data.stopPoints && data.stopPoints.length > 0) {
                return `Near ${data.stopPoints[0].commonName}`;
            }

            // Fallback to coordinates display
            return `${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}`;
        } catch (error) {
            return `${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}`;
        }
    }

    // ==================== FAVOURITE JOURNEYS ====================
    loadFavouriteJourneys() {
        try {
            const saved = localStorage.getItem('pengedash-favorite-journeys');
            this.favouriteJourneys = saved ? JSON.parse(saved) : [];
        } catch (e) {
            this.favouriteJourneys = [];
        }
    }

    saveFavouriteJourney(destination) {
        if (!destination) return;
        // Remove existing duplicate (case-insensitive)
        this.favouriteJourneys = this.favouriteJourneys.filter(
            f => f.destination.toLowerCase() !== destination.toLowerCase()
        );
        // Add to front
        this.favouriteJourneys.unshift({ destination, timestamp: Date.now() });
        // Max 5
        this.favouriteJourneys = this.favouriteJourneys.slice(0, 5);
        try {
            localStorage.setItem('pengedash-favorite-journeys', JSON.stringify(this.favouriteJourneys));
        } catch (e) { /* ignore */ }
        this.renderFavouriteJourneys();
    }

    removeFavouriteJourney(destination) {
        this.favouriteJourneys = this.favouriteJourneys.filter(
            f => f.destination.toLowerCase() !== destination.toLowerCase()
        );
        try {
            localStorage.setItem('pengedash-favorite-journeys', JSON.stringify(this.favouriteJourneys));
        } catch (e) { /* ignore */ }
        this.renderFavouriteJourneys();
    }

    renderFavouriteJourneys() {
        const container = document.getElementById('journey-favourites');
        const list = document.getElementById('favourites-list');
        if (!container || !list) return;

        if (!this.favouriteJourneys || this.favouriteJourneys.length === 0) {
            container.style.display = 'none';
            return;
        }

        // Show max 3
        const display = this.favouriteJourneys.slice(0, 3);
        list.innerHTML = display.map(f =>
            `<button class="favourite-chip" data-destination="${this.escapeAttr(f.destination)}">🕐 ${this.escapeHtml(f.destination)}</button>`
        ).join('');

        container.style.display = 'flex';

        // Click to search
        list.querySelectorAll('.favourite-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const dest = chip.dataset.destination;
                document.getElementById('destination-input').value = dest;
                document.querySelectorAll('.destination-chip').forEach(c => c.classList.remove('active'));
                this.planJourney(dest);
            });
        });

        // Long-press to remove (pressTimer scoped per chip)
        list.querySelectorAll('.favourite-chip').forEach(chip => {
            let pressTimer;
            chip.addEventListener('touchstart', () => {
                pressTimer = setTimeout(() => {
                    if (confirm(`Remove "${chip.dataset.destination}" from recent?`)) {
                        this.removeFavouriteJourney(chip.dataset.destination);
                    }
                }, 600);
            }, { passive: true });
            chip.addEventListener('touchend', () => clearTimeout(pressTimer));
            chip.addEventListener('touchmove', () => clearTimeout(pressTimer));
        });
    }

    // ==================== MAP (Leaflet) ====================
    initMap() {
        if (this._mapInit) return;
        const el = document.getElementById('map');
        if (!el) return;
        if (typeof L === 'undefined') {
            // Leaflet not ready yet (slow CDN / offline) — try again on window load
            window.addEventListener('load', () => { if (typeof L !== 'undefined') this.initMap(); }, { once: true });
            return;
        }
        this._mapInit = true;
        const center = this.home ? [this.home.lat, this.home.lon] : [CONFIG.LOCATION.lat, CONFIG.LOCATION.lon];
        this.map = L.map(el, { zoomControl: true, attributionControl: true }).setView(center, 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap'
        }).addTo(this.map);
        this.markersLayer = L.layerGroup().addTo(this.map);
        this.routeLayer = L.layerGroup().addTo(this.map);
        this.updateMap();
    }

    updateMap() {
        if (!this.map || typeof L === 'undefined') return;
        this.markersLayer.clearLayers();
        const center = [this.home.lat, this.home.lon];
        this.map.setView(center, 14);

        // Home pin
        L.marker(center).addTo(this.markersLayer).bindPopup(`🏠 ${this.escapeHtml(this.home.label || 'Home')}`);

        // Nearby station + bus markers
        const mk = (lat, lon, emoji, label, onClick) => {
            if (lat == null || lon == null) return;
            const icon = L.divIcon({ className: 'map-pin', html: `<span>${emoji}</span>`, iconSize: [24, 24] });
            const m = L.marker([lat, lon], { icon }).addTo(this.markersLayer).bindPopup(this.escapeHtml(label));
            if (onClick) m.on('click', onClick);
        };
        (this.nearbyStations || []).forEach(s => {
            const emoji = (s.modes || []).includes('tube') ? '🚇'
                : (s.modes || []).includes('overground') ? '🚆'
                : (s.modes || []).includes('dlr') ? '🚈' : '🚂';
            mk(s.lat, s.lon, emoji, s.name, () => {
                const card = document.querySelector(`.station-card[data-station-id="${s.id}"]`);
                if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        });
        (this.nearbyBusStops || []).forEach(b => mk(b.lat, b.lon, '🚌', b.name));

        // Leaflet needs a size recalc when its container was hidden/resized
        setTimeout(() => { if (this.map) this.map.invalidateSize(); }, 200);
    }

    drawJourneyRoute(journey, scrollToMap = false) {
        if (!this.map || typeof L === 'undefined' || !journey) return;
        this.routeLayer.clearLayers();
        const allPoints = [];
        const modeColour = { tube: '#dc241f', bus: '#e3221b', overground: '#ee7c0e',
            'dlr': '#00afad', 'national-rail': '#1d1d1b', walking: '#888', 'elizabeth-line': '#6950a1' };

        (journey.legs || []).forEach(leg => {
            const mode = leg.mode?.id || 'walking';
            const colour = modeColour[mode] || '#4361ee';
            let pts = [];
            try {
                const ls = leg.path && leg.path.lineString;
                if (ls) pts = JSON.parse(ls); // "[[lat,lon],...]"
            } catch (e) { /* fall back below */ }
            if (!pts || pts.length === 0) {
                // Fall back to straight line between leg endpoints
                const dp = leg.departurePoint, ap = leg.arrivalPoint;
                if (dp && ap) pts = [[dp.lat, dp.lon], [ap.lat, ap.lon]];
            }
            if (pts.length > 0) {
                L.polyline(pts, { color: colour, weight: 5, opacity: 0.8 }).addTo(this.routeLayer);
                allPoints.push(...pts);
            }
        });

        if (allPoints.length > 0) {
            this.map.fitBounds(L.latLngBounds(allPoints).pad(0.15));
            if (scrollToMap) document.getElementById('map-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    // ==================== SETTINGS (home postcode + saved places) ====================
    setupSettings() {
        const btn = document.getElementById('settings-btn');
        if (btn) btn.addEventListener('click', () => this.openSettingsModal());
    }

    openSettingsModal() {
        const savedHtml = (this.savedPlaces || []).length === 0
            ? '<div class="settings-empty">No saved places yet.</div>'
            : this.savedPlaces.map(p => `
                <div class="saved-place">
                    <button class="saved-place-go" data-postcode="${this.escapeAttr(p.postcode || '')}" data-label="${this.escapeAttr(p.label)}">
                        📍 ${this.escapeHtml(p.label)}
                    </button>
                    <button class="saved-place-remove" data-label="${this.escapeAttr(p.label)}">&times;</button>
                </div>`).join('');

        const body = `
            <div class="settings-section">
                <div class="settings-label">Home location</div>
                <div class="settings-current">Currently: <strong>${this.escapeHtml(this.home.label || this.home.postcode || 'SE20')}</strong></div>
                <div class="settings-input-row">
                    <input type="text" id="settings-postcode" placeholder="Enter postcode (e.g. E1 6AN)" autocomplete="off">
                    <button class="settings-set-btn" id="settings-set-home">Set</button>
                </div>
                <button class="settings-loc-btn" id="settings-use-location">📍 Use my current location</button>
                <div class="settings-status" id="settings-status"></div>
            </div>
            <div class="settings-section">
                <div class="settings-label">Saved places</div>
                <div id="settings-saved-list">${savedHtml}</div>
            </div>
            ${this.home.isDefault ? '' : '<button class="settings-reset-btn" id="settings-reset">Reset to SE20 (Penge)</button>'}
        `;
        this.openDetailModal('⚙️ Settings', body);
        this.wireSettingsHandlers();
    }

    wireSettingsHandlers() {
        const status = document.getElementById('settings-status');
        const setStatus = (msg, isErr) => { if (status) { status.textContent = msg; status.className = `settings-status ${isErr ? 'error' : ''}`; } };

        const doResolve = async (input) => {
            setStatus('Locating…', false);
            try {
                const home = await this.resolveLocation(input);
                setStatus(`Moved to ${home.label}`, false);
                setTimeout(() => this.closeDetailModal(), 700);
            } catch (e) {
                setStatus(e.message || 'Could not set that location', true);
            }
        };

        const setBtn = document.getElementById('settings-set-home');
        const input = document.getElementById('settings-postcode');
        if (setBtn && input) {
            setBtn.addEventListener('click', () => {
                const v = input.value.trim();
                if (v) doResolve(v);
            });
            input.addEventListener('keypress', (e) => { if (e.key === 'Enter') setBtn.click(); });
        }

        const locBtn = document.getElementById('settings-use-location');
        if (locBtn) {
            locBtn.addEventListener('click', async () => {
                setStatus('Getting GPS…', false);
                if (!navigator.geolocation) { setStatus('Geolocation not supported', true); return; }
                navigator.geolocation.getCurrentPosition(
                    (pos) => doResolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'Current area', postcode: '' }),
                    () => setStatus('Location denied or unavailable', true),
                    { enableHighAccuracy: true, timeout: 8000 }
                );
            });
        }

        const reset = document.getElementById('settings-reset');
        if (reset) reset.addEventListener('click', () => doResolve(CONFIG.DEFAULT_HOME.postcode));

        document.querySelectorAll('.saved-place-go').forEach(b =>
            b.addEventListener('click', () => {
                const pc = b.dataset.postcode;
                if (pc) doResolve(pc);
            }));
        document.querySelectorAll('.saved-place-remove').forEach(b =>
            b.addEventListener('click', () => {
                this.removeSavedPlace(b.dataset.label);
                this.openSettingsModal(); // re-render list
            }));
    }

    // ==================== QUICK NAV ====================
    setupQuickNav() {
        const nav = document.getElementById('quick-nav');
        if (!nav) return;
        nav.querySelectorAll('.quick-nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = document.getElementById(btn.dataset.target);
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                nav.querySelectorAll('.quick-nav-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // Highlight active section while scrolling
        if ('IntersectionObserver' in window) {
            const sections = ['journey-section', 'transit-section', 'lines-section', 'weather-section'];
            const obs = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const id = entry.target.id;
                        nav.querySelectorAll('.quick-nav-btn').forEach(b =>
                            b.classList.toggle('active', b.dataset.target === id));
                    }
                });
            }, { rootMargin: '-40% 0px -55% 0px' });
            sections.forEach(id => { const el = document.getElementById(id); if (el) obs.observe(el); });
        }
    }

    // ==================== UTILITIES ====================
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    escapeAttr(str) {
        return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    }

    getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);

        if (seconds < 60) return 'Just now';
        if (seconds < 120) return '1 min ago';
        if (seconds < 3600) return `${Math.floor(seconds / 60)} mins ago`;

        return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.pengeDash = new PengeDash();
});

// Service Worker registration for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('SW registered'))
            .catch(err => console.log('SW registration failed:', err));
    });
}
