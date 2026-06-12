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
        this.favStations = [];         // [{id, name, modes, isBus}] — pinned live boards
        this.nearbyStations = [];      // dynamic stations (relocated homes)
        this.nearbyBusStops = [];      // dynamic bus stops (relocated homes)
        this.lineStatusData = {};      // {id: {status, reason, disruption, name}}
        this.init();
    }

    init() {
        // Load persisted home + saved places before anything renders
        this.loadHome();
        this.loadSavedPlaces();
        this.loadFavStations();
        this.loadCachedNearby();
        this.updateHeaderLocation();

        // Auto dark mode (8pm - 6am)
        this.updateTheme();
        setInterval(() => this.updateTheme(), 60000);

        // Offline detection
        this.setupOfflineDetection();

        // Navigation (top tabs + bottom nav) and shell links
        this.setupNav();
        this.setupShellLinks();

        // Modals (next-trains + generic detail)
        this.createModal();

        // Journey planner controls (where-to, chips, filters)
        this.setupJourneyPlanner();

        // Settings + saved/recents (Saved screen)
        this.setupSettings();
        this.renderSavedPlaces();
        this.renderRecents();

        // Station search + favourite stations (Nearby screen)
        this.setupStationSearch();
        this.fetchFavArrivals();

        // Map (Leaflet) — guarded if library/offline
        this.initMap();

        // Reflect saved home in the journey "from" label
        this.applyHomeToJourney();

        // Nearby placeholder until detection completes
        this.renderNearbyNow(this.nearbyStations.length === 0);

        // Initial data load
        this.refreshAll();

        // Detect nearby (all homes) — feeds the map + Nearby screen.
        // When cache exists, render it immediately; refreshAll() above already
        // fetches live arrivals via fetchActiveTransit (no duplicate fetch here).
        if (this.nearbyStations.length === 0) {
            this.detectNearbyForHome();
        } else {
            this.updateMap();
            this.renderNearbyNow();
        }

        // Auto-refresh intervals
        this.setupAutoRefresh();
    }

    // ==================== NAVIGATION (screens) ====================
    setupNav() {
        this.currentScreen = 'plan';
        this._screenHistory = ['plan'];
        const handler = (btn) => this.showScreen(btn.dataset.screen);
        document.querySelectorAll('#top-tabs .top-tab').forEach(b =>
            b.addEventListener('click', () => handler(b)));
        document.querySelectorAll('#bottom-nav .bn-btn').forEach(b =>
            b.addEventListener('click', () => handler(b)));
    }

    showScreen(name) {
        if (!name) return;
        this.currentScreen = name;
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const screen = document.getElementById(`screen-${name}`);
        if (screen) screen.classList.add('active');
        // Sync tab highlights (top tabs only have the 4 main; saved/journey have none)
        document.querySelectorAll('#top-tabs .top-tab').forEach(b =>
            b.classList.toggle('active', b.dataset.screen === name));
        document.querySelectorAll('#bottom-nav .bn-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.screen === name));
        window.scrollTo({ top: 0, behavior: 'smooth' });

        // Leaflet measures 0×0 while its screen is hidden — recompute size on show
        // (markers are already drawn by updateMap during detection; no need to re-add)
        if (name === 'nearby' && this.map) {
            requestAnimationFrame(() => this.map.invalidateSize());
        }
    }

    setupShellLinks() {
        const go = (id, screen) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', () => this.showScreen(screen));
        };
        go('bell-btn', 'alerts');
        go('location-chip', 'saved');
        go('plan-alerts-link', 'alerts');
        go('nearby-alerts-link', 'alerts');
        const back = document.getElementById('journey-back');
        if (back) back.addEventListener('click', () => this.showScreen('plan'));
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
        // If on the default home, always trust the current (corrected) default
        // coordinates — fixes stale coords persisted by older versions.
        if (this.home.isDefault) {
            this.home.lat = CONFIG.DEFAULT_HOME.lat;
            this.home.lon = CONFIG.DEFAULT_HOME.lon;
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

    _coordSig(lat, lon) { return `${(+lat).toFixed(4)},${(+lon).toFixed(4)}`; }

    loadCachedNearby() {
        const cached = this.getCachedData('nearby-cache');
        // Only reuse the cache when BOTH the postcode and the coordinates match —
        // otherwise a corrected/relocated home would show stale nearby stations.
        const sigOk = cached && cached.sig && this.home &&
            cached.sig === this._coordSig(this.home.lat, this.home.lon);
        if (cached && cached.home && cached.home === (this.home && this.home.postcode) && sigOk) {
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
        this.stationData = {};        // clear previous location's departures
        this.busStopData = {};
        this.liveDepartures = [];
        this.saveHome();
        this.cacheData('nearby-cache', { home: home.postcode, sig: this._coordSig(home.lat, home.lon), stations: nearby.stations, busStops: nearby.busStops });

        // Optionally remember as a saved place
        if (opts.savePlace !== false) {
            this.saveSavedPlace({ label: home.label, postcode: home.postcode, lat: home.lat, lon: home.lon });
        }

        // Rebuild UI
        this.updateHeaderLocation();
        this.applyHomeToJourney();
        this.renderSavedPlaces();
        if (this.updateSettingsUI) this.updateSettingsUI();
        this.renderNearbyNow();
        this.updateMap();
        await this.refreshAll();
        return home;
    }

    async detectNearbyForHome() {
        // Coalesce concurrent calls (init + refreshAll can both trigger detection)
        if (this._detecting) return this._detecting;
        this._detecting = (async () => {
            try {
                let nearby = await this.detectNearby(this.home.lat, this.home.lon);
                if (nearby.stations.length === 0) {
                    nearby = await this.detectNearby(this.home.lat, this.home.lon, CONFIG.NEARBY.stationRadius * 2);
                }
                this.nearbyStations = nearby.stations;
                this.nearbyBusStops = nearby.busStops;
                this.cacheData('nearby-cache', { home: this.home.postcode, sig: this._coordSig(this.home.lat, this.home.lon), stations: nearby.stations, busStops: nearby.busStops });
                this.renderNearbyNow();
                this.updateMap();
                await this.fetchNearbyArrivals();
            } catch (e) {
                console.error('Nearby detection failed:', e);
                // Don't leave the Nearby screen stuck on "Finding…"
                this.renderNearbyNow(false);
                this.liveDepartures = [];
                this.renderLiveDepartures();
            } finally {
                this._detecting = null;
            }
        })();
        return this._detecting;
    }

    // ==================== NEARBY SCREEN ====================
    _stationMode(st) {
        const m = st.modes || [];
        return m.includes('tube') ? 'tube' : m.includes('overground') ? 'overground'
            : m.includes('dlr') ? 'dlr' : m.includes('elizabeth-line') ? 'elizabeth' : 'rail';
    }
    _modeEmoji(mode, isBus) {
        if (isBus) return '🚌';
        return mode === 'overground' ? '🚆' : mode === 'dlr' ? '🚈'
            : mode === 'tube' ? '🚇' : mode === 'elizabeth' ? '🚆' : '🚉';
    }
    // TfL only provides live arrivals for these modes (National Rail is not covered)
    _hasLiveArrivals(st) {
        return (st.modes || []).some(m => ['tube', 'overground', 'dlr', 'elizabeth-line', 'tram'].includes(m));
    }

    renderNearbyNow(detecting = false) {
        const list = document.getElementById('nearby-now-list');
        if (!list) return;
        if (this.nearbyStations.length === 0 && this.nearbyBusStops.length === 0) {
            list.innerHTML = detecting
                ? '<div class="loading">Finding nearby stations…</div>'
                : `<div class="no-data">No stations or stops found near ${this.escapeHtml(this.home.label || 'here')}.</div>`;
            return;
        }
        const modeName = { tube: 'Tube', overground: 'Overground', dlr: 'DLR',
            'elizabeth-line': 'Elizabeth line', 'national-rail': 'National Rail', tram: 'Tram' };
        const items = [];
        this.nearbyStations.forEach(st => {
            const walk = Math.max(1, Math.round(st.distance / 80));
            const mode = this._stationMode(st);
            // "live" = TfL live mode OR we have departures (e.g. National Rail via Darwin)
            const live = this._hasLiveArrivals(st) || !!(st.nextDepartures && st.nextDepartures.length);
            const tagList = (st.modes || []).slice(0, 2)
                .map(m => `<span class="ni-tag line">${this.escapeHtml(modeName[m] || m)}</span>`);
            if (!live) tagList.push('<span class="ni-tag">No live times</span>');
            const tags = tagList.join('');
            // Inline next departures (live TfL modes only)
            let nextHtml = '';
            if (live && st.nextDepartures && st.nextDepartures.length) {
                nextHtml = '<span class="ni-next">' + st.nextDepartures.slice(0, 2).map(d =>
                    `<span class="ni-next-row"><span class="ni-next-dest">${d.line ? this.escapeHtml(d.line) + ' → ' : ''}${this.escapeHtml(d.dest)}</span><span class="ni-next-mins ${d.mins <= 3 ? 'urgent' : ''}">${d.mins} min</span></span>`
                ).join('') + '</span>';
            } else if (live) {
                nextHtml = '<span class="ni-next-empty">No trains running right now</span>';
            }
            items.push(`
                <button class="nearby-item" data-station-id="${this.escapeAttr(st.id)}" data-station-name="${this.escapeAttr(st.name)}">
                    <span class="ni-icon ${mode}">${this._modeEmoji(mode)}</span>
                    <span class="ni-body">
                        <span class="ni-name">${this.escapeHtml(st.name)}</span>
                        <span class="ni-sub">${walk} min walk · ${st.distance} m</span>
                        <span class="ni-tags">${tags}</span>
                        ${nextHtml}
                    </span>
                    <span class="ni-chev">›</span>
                </button>`);
        });
        this.nearbyBusStops.forEach(stop => {
            const walk = Math.max(1, Math.round(stop.distance / 80));
            const towards = stop.towards ? `towards ${stop.towards}` : (stop.indicator ? `Stop ${stop.indicator}` : '');
            items.push(`
                <button class="nearby-item" data-busstop-id="${this.escapeAttr(stop.id)}" data-busstop-name="${this.escapeAttr(stop.name)}">
                    <span class="ni-icon bus">🚌</span>
                    <span class="ni-body">
                        <span class="ni-name">${this.escapeHtml(stop.name)}</span>
                        <span class="ni-sub">${walk} min walk · ${stop.distance} m${towards ? ' · ' + this.escapeHtml(towards) : ''}</span>
                    </span>
                    <span class="ni-chev">›</span>
                </button>`);
        });
        list.innerHTML = items.join('');
        list.querySelectorAll('.nearby-item').forEach(el => {
            el.addEventListener('click', () => {
                if (el.dataset.stationId) this.openStopModal(el.dataset.stationId, el.dataset.stationName, false);
                else if (el.dataset.busstopId) this.openStopModal(el.dataset.busstopId, el.dataset.busstopName, true);
            });
        });
    }

    renderLiveDepartures() {
        const list = document.getElementById('live-departures-list');
        if (!list) return;
        const deps = (this.liveDepartures || []).slice(0, 8);
        if (deps.length === 0) { list.innerHTML = '<div class="no-data">No live departures right now.</div>'; return; }
        list.innerHTML = deps.map(d => {
            const icon = this._modeEmoji(d.mode, d.isBus);
            const title = d.isBus
                ? `${d.line ? 'Bus ' + this.escapeHtml(d.line) : 'Bus'} to ${this.escapeHtml(d.dest)}`
                : `${this.escapeHtml(d.line || d.station)} to ${this.escapeHtml(d.dest)}`;
            const sub = d.isBus
                ? `From ${this.escapeHtml(d.station)}`
                : `${this.escapeHtml(d.station)}${d.platform && d.platform !== '-' ? ' · Platform ' + this.escapeHtml(d.platform) : ''}`;
            return `
            <button class="dep-item" data-id="${this.escapeAttr(d.id)}" data-bus="${d.isBus ? '1' : ''}" data-name="${this.escapeAttr(d.name)}">
                <span class="di-icon">${icon}</span>
                <span class="di-body">
                    <span class="di-title">${title}</span>
                    <span class="di-sub">${sub}</span>
                </span>
                <span class="di-right">
                    <span class="di-mins ${d.mins <= 3 ? 'urgent' : ''}">${d.mins} min</span>
                    <span class="ni-chev">›</span>
                </span>
            </button>`;
        }).join('');
        list.querySelectorAll('.dep-item').forEach(el =>
            el.addEventListener('click', () => this.openStopModal(el.dataset.id, el.dataset.name, el.dataset.bus === '1')));
    }

    openStopModal(id, name, isBus = false) {
        const modal = document.getElementById('next-trains-modal');
        document.getElementById('modal-station-name').textContent = name || 'Departures';
        const sub = modal.querySelector('.modal-subtitle');
        if (sub) sub.textContent = 'Next live departures';
        // Remember which stop this modal is showing (for the favourite toggle)
        const station = isBus ? null : (this.nearbyStations || []).concat(this.favStations || []).find(s => s.id === id);
        this._currentModalStop = { id, name, isBus, modes: (station && station.modes) || [] };
        this._updateModalFav();
        const el = document.getElementById('modal-departures');
        const data = isBus ? ((this.busStopData || {})[id] || []) : (this.stationData[id] || []);
        const darwinCovered = station && this._darwinCovered()[(station.name || '').toLowerCase()];
        if (data.length === 0 && station && !this._hasLiveArrivals(station) && !darwinCovered) {
            // National Rail station with no live feed (not Darwin-covered) — link out
            el.innerHTML = `<div class="no-data">🚂 This is a National Rail station — live departures aren't available in TfL data here.<br><br>
                <a href="https://www.nationalrail.co.uk/live-trains/departures/" target="_blank" rel="noopener" style="color:var(--blue);font-weight:600;">Check National Rail live times ↗</a></div>`;
        } else if (data.length === 0) {
            el.innerHTML = '<div class="no-data">No live departures right now</div>';
        } else {
            el.innerHTML = data.slice(0, 8).map(d => `
                <div class="modal-departure">
                    <div class="modal-departure-info">
                        <span class="modal-departure-dest">${isBus && d.line ? this.escapeHtml(d.line) + ' · ' : ''}${this.escapeHtml(d.dest)}</span>
                        ${d.platform && d.platform !== '-' ? `<span class="departure-platform-dir">Platform ${this.escapeHtml(d.platform)}</span>` : ''}
                    </div>
                    <div class="modal-departure-time-col">
                        <span class="modal-departure-time">${d.mins} min</span>
                        ${d.scheduledTime ? `<span class="departure-scheduled">${d.scheduledTime}</span>` : ''}
                    </div>
                </div>`).join('');
        }
        modal.classList.add('active');
    }

    // ==================== FAVOURITE STATIONS ====================
    loadFavStations() {
        try {
            const saved = localStorage.getItem('pengedash-fav-stations');
            this.favStations = saved ? JSON.parse(saved) : [];
        } catch (e) { this.favStations = []; }
    }

    saveFavStations() {
        try { localStorage.setItem('pengedash-fav-stations', JSON.stringify(this.favStations)); } catch (e) { /* ignore */ }
    }

    isFavStation(id) {
        return (this.favStations || []).some(s => s.id === id);
    }

    toggleModalFav() {
        const stop = this._currentModalStop;
        if (!stop || !stop.id) return;
        if (this.isFavStation(stop.id)) {
            this.favStations = this.favStations.filter(s => s.id !== stop.id);
        } else {
            this.favStations.unshift({ id: stop.id, name: stop.name, modes: stop.modes || [], isBus: !!stop.isBus });
            this.favStations = this.favStations.slice(0, 8);
        }
        this.saveFavStations();
        this._updateModalFav();
        this.fetchFavArrivals();
    }

    _updateModalFav() {
        const btn = document.getElementById('modal-fav');
        if (!btn || !this._currentModalStop) return;
        const fav = this.isFavStation(this._currentModalStop.id);
        btn.textContent = fav ? '★' : '☆';
        btn.classList.toggle('active', fav);
        btn.title = fav ? 'Remove from saved' : 'Save station';
    }

    // Fetch + render live boards for favourite stations (also reuses nearby data when overlapping)
    async fetchFavArrivals() {
        const favs = this.favStations || [];
        const head = document.getElementById('fav-stations-head');
        const list = document.getElementById('fav-stations-list');
        if (!head || !list) return;
        if (favs.length === 0) { head.style.display = 'none'; list.innerHTML = ''; return; }
        head.style.display = '';

        await Promise.all(favs.map(async (fav) => {
            // Reuse data only for stops the nearby cycle keeps fresh; others refetch
            const isNearby = (this.nearbyStations || []).some(s => s.id === fav.id) ||
                (this.nearbyBusStops || []).some(s => s.id === fav.id);
            const cached = fav.isBus ? (this.busStopData || {})[fav.id] : this.stationData[fav.id];
            if (isNearby && cached && cached.length) { fav.nextDepartures = cached.slice(0, 3); return; }
            try {
                const deps = await this._fetchStopArrivals(fav.id);
                fav.nextDepartures = deps.slice(0, 3);
                if (fav.isBus) { this.busStopData = this.busStopData || {}; this.busStopData[fav.id] = deps; }
                else this.stationData[fav.id] = deps;
            } catch (e) { fav.nextDepartures = []; }
        }));

        this.renderFavStations();
        const upd = document.getElementById('fav-updated');
        if (upd) upd.textContent = this.getTimeAgo(new Date());
    }

    renderFavStations() {
        const list = document.getElementById('fav-stations-list');
        if (!list) return;
        const favs = this.favStations || [];
        list.innerHTML = favs.map(fav => {
            const mode = fav.isBus ? 'bus' : this._stationMode(fav);
            const next = (fav.nextDepartures || []).slice(0, 2).map(d =>
                `<span class="ni-next-row"><span class="ni-next-dest">${d.line ? this.escapeHtml(d.line) + ' → ' : ''}${this.escapeHtml(d.dest)}</span><span class="ni-next-mins ${d.mins <= 3 ? 'urgent' : ''}">${d.mins} min</span></span>`).join('');
            const nextHtml = next ? `<span class="ni-next">${next}</span>`
                : '<span class="ni-next-empty">No live departures right now</span>';
            return `
                <div class="nearby-item fav-item" data-id="${this.escapeAttr(fav.id)}" data-name="${this.escapeAttr(fav.name)}" data-bus="${fav.isBus ? '1' : ''}">
                    <span class="ni-icon ${mode}">${this._modeEmoji(mode, fav.isBus)}</span>
                    <span class="ni-body">
                        <span class="ni-name">⭐ ${this.escapeHtml(fav.name)}</span>
                        ${nextHtml}
                    </span>
                    <button class="saved-item-x fav-x" data-remove="${this.escapeAttr(fav.id)}" aria-label="Remove">&times;</button>
                </div>`;
        }).join('');

        list.querySelectorAll('.fav-item').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('.fav-x')) return;
                this.openStopModal(el.dataset.id, el.dataset.name, el.dataset.bus === '1');
            });
        });
        list.querySelectorAll('.fav-x').forEach(x => x.addEventListener('click', (e) => {
            e.stopPropagation();
            this.favStations = this.favStations.filter(s => s.id !== x.dataset.remove);
            this.saveFavStations();
            this.fetchFavArrivals();
        }));
    }

    // Hub ids (HUB...) have no arrivals of their own — resolve to child station ids
    async _resolveHubChildren(hubId) {
        const tflAuth = CONFIG.TFL_APP_KEY ? `?app_id=${CONFIG.TFL_APP_ID}&app_key=${CONFIG.TFL_APP_KEY}` : '';
        try {
            const sp = await fetch(`https://api.tfl.gov.uk/StopPoint/${hubId}${tflAuth}`).then(r => r.json());
            const ids = [];
            const walk = (node) => {
                if (!node) return;
                if (/^(940G|910G)/.test(node.id || '') && node.id !== hubId) ids.push(node.id);
                (node.children || []).forEach(walk);
            };
            walk(sp);
            return [...new Set(ids)].slice(0, 3); // cap requests
        } catch (e) { return []; }
    }

    // Shared: fetch + map TfL arrivals for any stop id (hubs resolved to children)
    async _fetchStopArrivals(id) {
        const tflAuth = CONFIG.TFL_APP_KEY ? `?app_id=${CONFIG.TFL_APP_ID}&app_key=${CONFIG.TFL_APP_KEY}` : '';
        let ids = [id];
        if (/^HUB/i.test(id)) {
            const children = await this._resolveHubChildren(id);
            if (children.length) ids = children;
        }
        const results = await Promise.all(ids.map(i =>
            fetch(`https://api.tfl.gov.uk/StopPoint/${i}/Arrivals${tflAuth}`).then(r => r.json()).catch(() => [])));
        const data = results.flat();
        return (Array.isArray(data) ? data : []).map(a => ({
            dest: this.cleanStationName(a.destinationName || a.towards || 'Check board'),
            platform: this.cleanPlatform(a.platformName),
            line: a.lineName || '',
            mins: Math.floor((a.timeToStation || 0) / 60),
            scheduledTime: a.expectedArrival
                ? new Date(a.expectedArrival).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''
        })).filter(d => d.mins >= 0).sort((a, b) => a.mins - b.mins);
    }

    // ==================== STATION SEARCH (Nearby screen) ====================
    setupStationSearch() {
        const input = document.getElementById('station-search-input');
        const dropdown = document.getElementById('station-search-dropdown');
        const clearBtn = document.getElementById('station-search-clear');
        if (!input || !dropdown) return;

        let timer = null;
        const hide = () => { dropdown.classList.remove('visible'); dropdown.innerHTML = ''; };

        input.addEventListener('input', () => {
            clearTimeout(timer);
            clearBtn.style.display = input.value ? 'flex' : 'none';
            const q = input.value.trim();
            if (q.length < 2) { hide(); return; }
            timer = setTimeout(async () => {
                try {
                    let url = `https://api.tfl.gov.uk/StopPoint/Search?query=${encodeURIComponent(q)}&modes=tube,bus,national-rail,overground,dlr,elizabeth-line,tram&maxResults=6`;
                    if (CONFIG.TFL_APP_KEY) url += `&app_id=${CONFIG.TFL_APP_ID}&app_key=${CONFIG.TFL_APP_KEY}`;
                    const data = await fetch(url).then(r => r.json());
                    const matches = (data.matches || []).filter(m => m.id);
                    if (!matches.length) { hide(); return; }
                    const icons = { tube: '🚇', bus: '🚌', 'national-rail': '🚂', overground: '🚆', dlr: '🚈', 'elizabeth-line': '🟣', tram: '🚊' };
                    dropdown.innerHTML = matches.map(m => `
                        <div class="autocomplete-item" data-id="${this.escapeAttr(m.id)}" data-name="${this.escapeAttr(m.name)}" data-modes="${this.escapeAttr((m.modes || []).join(','))}">
                            <div class="ac-name">${this.escapeHtml(m.name)}</div>
                            <div class="ac-modes">${(m.modes || []).map(x => icons[x] || '').filter(Boolean).join(' ')}</div>
                        </div>`).join('');
                    dropdown.classList.add('visible');
                    dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
                        item.addEventListener('mousedown', async (e) => {
                            e.preventDefault();
                            hide();
                            input.value = item.dataset.name;
                            clearBtn.style.display = 'flex';
                            await this.openSearchedStation(item.dataset.id, item.dataset.name, (item.dataset.modes || '').split(','));
                        });
                    });
                } catch (err) { hide(); }
            }, 300);
        });
        input.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
        input.addEventListener('blur', () => setTimeout(hide, 200));
        clearBtn.addEventListener('click', () => { input.value = ''; clearBtn.style.display = 'none'; hide(); input.focus(); });
    }

    // Open a searched station: fetch its live board, then show the modal (with ☆ to save)
    async openSearchedStation(id, name, modes) {
        const isBus = (modes || []).includes('bus') && !(modes || []).some(m => ['tube', 'overground', 'dlr', 'elizabeth-line', 'tram', 'national-rail'].includes(m));
        try {
            const deps = await this._fetchStopArrivals(id);
            if (isBus) { this.busStopData = this.busStopData || {}; this.busStopData[id] = deps; }
            else this.stationData[id] = deps;
        } catch (e) { /* modal will show empty state */ }
        this._currentModalStop = { id, name, isBus, modes: modes || [] };
        this.openStopModal(id, name, isBus);
    }

    async fetchActiveTransit() {
        // Unified: live arrivals for nearby stations/buses via TfL (correct for all homes)
        if (this.nearbyStations.length === 0 && this.nearbyBusStops.length === 0) {
            await this.detectNearbyForHome();
        } else {
            await this.fetchNearbyArrivals();
        }
    }

    async fetchNearbyArrivals() {
        const tflAuth = CONFIG.TFL_APP_KEY ? `?app_id=${CONFIG.TFL_APP_ID}&app_key=${CONFIG.TFL_APP_KEY}` : '';
        const merged = [];
        this.busStopData = this.busStopData || {};

        const liveStations = this.nearbyStations.filter(st =>
            (st.modes || []).some(m => ['tube', 'overground', 'dlr', 'elizabeth-line', 'tram'].includes(m)));

        await Promise.all(liveStations.map(async (st) => {
            try {
                const data = await fetch(`https://api.tfl.gov.uk/StopPoint/${st.id}/Arrivals${tflAuth}`).then(r => r.json());
                const deps = (Array.isArray(data) ? data : []).map(a => ({
                    dest: this.cleanStationName(a.destinationName || a.towards || 'Check board'),
                    platform: this.cleanPlatform(a.platformName),
                    line: a.lineName || '',
                    mins: Math.floor((a.timeToStation || 0) / 60),
                    scheduledTime: a.expectedArrival
                        ? new Date(a.expectedArrival).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''
                })).filter(d => d.mins >= 0).sort((a, b) => a.mins - b.mins);

                st.platformDirections = this.getPlatformDirections(deps);
                st.nextDepartures = deps.slice(0, 3);
                this.stationData[st.id] = deps;
                const mode = this._stationMode(st);
                deps.slice(0, 2).forEach(d => merged.push({
                    mode, station: st.name, dest: d.dest, line: d.line, mins: d.mins,
                    platform: d.platform, id: st.id, name: st.name, isBus: false
                }));
            } catch (e) { /* skip */ }
        }));

        await Promise.all((this.nearbyBusStops || []).map(async (stop) => {
            try {
                const data = await fetch(`https://api.tfl.gov.uk/StopPoint/${stop.id}/Arrivals${tflAuth}`).then(r => r.json());
                const arr = (Array.isArray(data) ? data : []).map(b => ({
                    dest: b.destinationName || b.towards || 'Check board',
                    line: b.lineName || '',
                    mins: Math.floor((b.timeToStation || 0) / 60),
                    platform: '-',
                    scheduledTime: (b.expectedArrival ? new Date(b.expectedArrival) : new Date(Date.now() + (b.timeToStation || 0) * 1000))
                        .toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                })).filter(d => d.mins >= 0).sort((a, b) => a.mins - b.mins);
                this.busStopData[stop.id] = arr;
                if (arr[0]) merged.push({
                    mode: 'bus', station: stop.name, dest: arr[0].dest, line: arr[0].line,
                    mins: arr[0].mins, id: stop.id, name: stop.name, isBus: true
                });
            } catch (e) { /* skip */ }
        }));

        // National Rail live times via the Darwin backend (SE20 default home only)
        const darwinMerged = await this.fetchDarwinForDefault();
        if (darwinMerged.length) merged.push(...darwinMerged);

        merged.sort((a, b) => a.mins - b.mins);
        this.liveDepartures = merged;
        this.renderLiveDepartures();
        this.renderNearbyNow();   // refresh station rows with inline live times
        this.fetchFavArrivals();  // keep favourite stations' boards current too
        const now = this.getTimeAgo(new Date());
        ['departures-updated', 'nearby-updated'].forEach(id => {
            const el = document.getElementById(id); if (el) el.textContent = now;
        });
    }

    // National Rail stations the Darwin backend covers (SE20 default home)
    _darwinCovered() { return { 'penge east': 'PNE', 'penge west': 'PNW', 'birkbeck': 'BKB' }; }

    // Format raw Darwin TIPLOC codes the backend didn't resolve (SE20-area destinations)
    _formatNRDest(s) {
        const map = {
            VICTRIC: 'Victoria', VICTRIA: 'Victoria', VICTRIE: 'Victoria',
            LNDNBDE: 'London Bridge', LONBDGE: 'London Bridge', LNDNBDG: 'London Bridge',
            BLFR: 'Blackfriars', CHRX: 'Charing Cross', CHARING: 'Charing Cross',
            ORPNGTN: 'Orpington', BROMLYS: 'Bromley South', BRMLYSC: 'Bromley South',
            BECKNHM: 'Beckenham Junction', BCKNHMJ: 'Beckenham Junction', BCKNHM: 'Beckenham Junction',
            KENTHOS: 'Kent House', WDULWCH: 'West Dulwich', SYDENHL: 'Sydenham Hill',
            HERNEHL: 'Herne Hill', HNHL: 'Herne Hill', WCROYDN: 'West Croydon',
            CRYSTLP: 'Crystal Palace', NRWD: 'Norwood Junction', NORWDJ: 'Norwood Junction',
            SYDENHM: 'Sydenham', SUTTON: 'Sutton', EPSOM: 'Epsom',
            CLTHRPS: 'Clapham Junction', PRSP: 'Crystal Palace'
        };
        return map[s] || s;
    }

    // Pull live National Rail departures from the Darwin backend for SE20's NR stations.
    // Returns merged rows for the Live-departures list; also sets per-station data inline.
    async fetchDarwinForDefault() {
        if (!this.home.isDefault) return [];
        let data;
        try {
            data = await fetch(`${CONFIG.DARWIN_API_URL}/api/departures`).then(r => r.json());
        } catch (e) { return []; }
        if (!data || !data.stations) return [];

        const map = this._darwinCovered();
        const extra = [];
        this.nearbyStations.forEach(st => {
            const crs = map[(st.name || '').toLowerCase()];
            if (!crs) return;
            const raw = (data.stations[crs] && data.stations[crs].departures) || [];
            const selfName = (st.name || '').toLowerCase();
            const deps = raw
                .filter(d => !d.cancelled && typeof d.mins === 'number' && d.mins >= -1 && (d.scheduledTime || d.expectedTime))
                .map(d => ({
                    dest: this._formatNRDest(this.cleanStationName(d.destination || 'Check board')),
                    platform: (d.platform && d.platform !== '-') ? String(d.platform) : '-',
                    line: st.line || '',
                    mins: d.mins,
                    scheduledTime: d.scheduledTime || ''
                }))
                // Drop self-referential garbage (dest === this station) and unresolved blanks
                .filter(d => d.dest && d.dest.toLowerCase() !== selfName)
                .sort((a, b) => a.mins - b.mins);
            if (deps.length) {
                st.nextDepartures = deps.slice(0, 3);
                this.stationData[st.id] = deps;
                deps.slice(0, 2).forEach(d => extra.push({
                    mode: 'rail', station: st.name, dest: d.dest, line: '', mins: d.mins,
                    platform: d.platform, id: st.id, name: st.name, isBus: false
                }));
            }
        });
        return extra;
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
                'pengedash-home', 'pengedash-saved-places', 'pengedash-fav-stations'];
            if (key && key.startsWith('pengedash-') && !preserve.includes(key)) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
        console.log('Cleared', keysToRemove.length, 'cache entries');
    }

    loadCachedData() {
        const cachedWeather = this.getCachedData('weather');
        if (cachedWeather) this.displayWeather(cachedWeather);

        const cachedLines = this.getCachedData('lines');
        if (cachedLines) {
            this.displayLineStatus(cachedLines);
            this.checkServiceAlerts(cachedLines);
        }
    }

    updateTheme() {
        const hour = new Date().getHours();
        const isNight = hour >= 20 || hour < 6; // 8pm to 6am
        document.documentElement.setAttribute('data-theme', isNight ? 'dark' : 'light');
    }

    // ==================== QUIRKY PERSONALITY ====================
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
                    <div class="modal-actions">
                        <button class="modal-fav" id="modal-fav" title="Save station" aria-label="Save station">☆</button>
                        <button class="modal-close" id="modal-close">&times;</button>
                    </div>
                </div>
                <div class="modal-departures" id="modal-departures"></div>
            </div>
        `;
        document.body.appendChild(modal);

        // Close modal handlers
        document.getElementById('modal-close').addEventListener('click', () => this.closeModal());
        // Favourite toggle (state + handler set per-open)
        document.getElementById('modal-fav').addEventListener('click', () => this.toggleModalFav());
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

    closeModal() {
        document.getElementById('next-trains-modal').classList.remove('active');
    }

    setupAutoRefresh() {
        setInterval(() => this.fetchWeather(), CONFIG.REFRESH_INTERVALS.weather);
        setInterval(() => this.fetchActiveTransit(), CONFIG.REFRESH_INTERVALS.trains);
        setInterval(() => this.fetchLineStatus(), CONFIG.REFRESH_INTERVALS.trains);
        setInterval(() => this.fetchTrafficDisruptions(), CONFIG.REFRESH_INTERVALS.traffic);
    }

    // ==================== DARWIN KEEP-ALIVE ====================
    // ==================== AIR QUALITY ====================
    async refreshAll() {
        if (this.isRefreshing) return;
        this.isRefreshing = true;
        const status = document.getElementById('status-message');
        if (status) status.textContent = 'Refreshing…';

        try {
            await Promise.all([
                this.fetchWeather(),
                this.fetchActiveTransit(),
                this.fetchLineStatus(),
                this.fetchTrafficDisruptions()
            ]);
            const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            if (status) status.textContent = `Updated ${now}`;
        } catch (error) {
            console.error('Refresh error:', error);
            if (status) status.textContent = 'Some data failed to load';
        } finally {
            this.isRefreshing = false;
        }
    }

    // ==================== WEATHER (Open-Meteo - No API key needed!) ====================
    async fetchWeather() {
        try {
            const { lat, lon } = this.home || CONFIG.LOCATION;
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability,weather_code&timezone=Europe/London&forecast_hours=12`;
            const response = await fetch(url);
            const data = await response.json();
            this.cacheData('weather', data);
            this.displayWeather(data);
        } catch (error) {
            console.error('Weather fetch error:', error);
            const cachedWeather = this.getCachedData('weather');
            if (cachedWeather) this.displayWeather(cachedWeather);
            else this.displayMockWeather();
        }
    }

    displayWeather(data) {
        if (!data || !data.current) return;
        const current = data.current;
        const temp = Math.round(current.temperature_2m);
        const feelsLike = Math.round(current.apparent_temperature);
        const windSpeed = Math.round(current.wind_speed_10m * 0.621371);
        const currentHour = new Date().getHours();
        const rainChance = data.hourly?.precipitation_probability?.[currentHour] || 0;
        const { icon, condition } = this.getWeatherFromCode(current.weather_code);

        // Store for smart journey insights
        this.currentWeather = { temp, feelsLike, rainChance, condition, windSpeed, hourlyData: data.hourly };

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('temp', `${temp}°`);
        set('weather-condition', condition);
        set('weather-icon', icon);
        set('feels-like-row', `Feels ${feelsLike}°`);
        set('rain-row', `Rain ${rainChance}%`);
        set('mini-weather', `${icon} ${temp}°`);
        this.updateClothingAdvice(feelsLike, rainChance, windSpeed);
    }

    displayMockWeather() {
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('temp', '12°'); set('weather-condition', 'Partly cloudy'); set('weather-icon', '🌤️');
        set('feels-like-row', 'Feels 10°'); set('rain-row', 'Rain 30%'); set('mini-weather', '🌤️ 12°');
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
    // ==================== DYNAMIC WEATHER BACKGROUNDS ====================
    // ==================== DARWIN TRAINS (All stations via backend) ====================
    // Parse "HH:MM" clock time into minutes-from-now (handles midnight rollover).
    // Falls back to the provided value if parsing fails.
    // ==================== ANERLEY OVERGROUND (TfL Fallback) ====================
    // ==================== BUSES ====================
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

        if (!container) return;
        container.innerHTML = lines.map(line => {
            const meta = LINE_META[line.id] || { name: line.name, class: '' };
            const ls = line.lineStatuses && line.lineStatuses[0];
            const statusText = (ls && ls.statusSeverityDescription) || 'Unknown';
            const statusClass = statusText.toLowerCase().replace(/\s+/g, '-');

            return `
                <button class="line-status ${meta.class}" data-line-id="${this.escapeAttr(line.id)}">
                    <span class="line-name">${this.escapeHtml(meta.name)}</span>
                    <span class="line-status-badge ${statusClass}">${this.escapeHtml(statusText)}</span>
                </button>`;
        }).join('');
        container.querySelectorAll('.line-status').forEach(el =>
            el.addEventListener('click', () => this.openLineDetail(el.dataset.lineId)));
    }

    openLineDetail(lineId) {
        const d = (this.lineDetails || {})[lineId];
        if (!d) return;
        const detail = d.reason || d.disruption ||
            (d.status === 'Good Service' ? 'Good service on the whole line.' : 'No further detail provided by TfL.');
        this.openDetailModal(`${d.name} · ${d.status}`,
            `<div class="alert-detail-item ${d.status !== 'Good Service' ? 'bad' : ''}">
                <div class="alert-detail-reason">${this.escapeHtml(detail)}</div>
             </div>`);
    }

    checkServiceAlerts(lines) {
        // Lines with issues (not "Good Service")
        const issues = lines.filter(line => {
            const ls = line.lineStatuses && line.lineStatuses[0];
            return ls && ls.statusSeverityDescription !== 'Good Service';
        });
        this._alertIssues = issues.map(line => {
            const ls = line.lineStatuses[0];
            return {
                name: (LINE_META[line.id] && LINE_META[line.id].name) || line.name,
                status: ls.statusSeverityDescription,
                reason: ls.reason || '',
                disruption: (ls.disruption && ls.disruption.description) || ''
            };
        });
        // Bell indicator
        const dot = document.getElementById('bell-dot');
        if (dot) dot.style.display = issues.length > 0 ? 'block' : 'none';
        this.renderAlerts();
    }

    renderAlerts() {
        const list = document.getElementById('alerts-list');
        if (!list) return;
        const issues = this._alertIssues || [];
        const upd = document.getElementById('alerts-updated');
        if (upd) upd.textContent = this.getTimeAgo(new Date());
        if (issues.length === 0) {
            list.innerHTML = `<div class="all-good"><span class="ag-emoji">✅</span>All services running normally right now.</div>`;
            return;
        }
        list.innerHTML = issues.map(i => {
            const detail = i.reason || i.disruption || 'No further detail provided by TfL.';
            const bad = /suspend|severe|closed|part/i.test(i.status);
            return `
                <div class="alert-card ${bad ? 'bad' : ''}">
                    <div class="alert-card-line">${this.escapeHtml(i.name)}</div>
                    <div class="alert-card-status">${this.escapeHtml(i.status)}</div>
                    <div class="alert-card-reason">${this.escapeHtml(detail)}</div>
                </div>`;
        }).join('');
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
        this.defaultDestinations = ['Victoria', 'London Bridge', 'Croydon', 'Bromley South', 'Canary Wharf'];
        this.journeyOrigin = 'home';
        this.journeyTimeOffset = 0;
        this.journeyModes = null;      // null = all modes
        this.journeyPref = '';         // '' | leastwalking | leastinterchange
        this.journeyStepFree = false;
        this.currentLocation = null;
        this.fetchingLocation = false;
        this._hasSearched = false;

        this.loadDestinations();
        this.renderDestinationChips();
        this.loadFavouriteJourneys();
        this.renderFavouriteJourneys();

        // Origin toggle (Home ↔ current location)
        const fromBtn = document.getElementById('from-text');
        if (fromBtn) fromBtn.addEventListener('click', () => this.toggleOrigin());
        const swapBtn = document.getElementById('origin-swap-btn');
        if (swapBtn) swapBtn.addEventListener('click', () => this.toggleOrigin());

        // Search + clear
        const input = document.getElementById('destination-input');
        const goBtn = document.getElementById('journey-search-btn');
        const clearBtn = document.getElementById('destination-clear');
        goBtn.addEventListener('click', () => {
            const dest = input.value.trim();
            if (dest) this.planJourney(dest);
        });
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { this.hideAutocomplete(); goBtn.click(); }
        });
        input.addEventListener('input', () => { clearBtn.style.display = input.value ? 'flex' : 'none'; });
        clearBtn.addEventListener('click', () => {
            input.value = ''; clearBtn.style.display = 'none';
            this.hideAutocomplete(); input.focus();
        });

        this.setupAutocomplete();

        // Preference pills (Fastest / Least walking / Fewest changes / Step-free toggle)
        document.querySelectorAll('#journey-pref-row .pill').forEach(pill => {
            pill.addEventListener('click', () => {
                if (pill.dataset.stepfree) {
                    this.journeyStepFree = !this.journeyStepFree;
                    pill.classList.toggle('active', this.journeyStepFree);
                } else {
                    document.querySelectorAll('#journey-pref-row .pill:not([data-stepfree])').forEach(p => p.classList.remove('active'));
                    pill.classList.add('active');
                    this.journeyPref = pill.dataset.pref || '';
                }
                this._replanIfActive();
            });
        });

        // Mode pills
        document.querySelectorAll('#journey-mode-row .pill').forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll('#journey-mode-row .pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                this.journeyModes = pill.dataset.mode === 'all' ? null : pill.dataset.mode;
                this._replanIfActive();
            });
        });

        // Time pills
        document.querySelectorAll('#journey-time-row .pill').forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll('#journey-time-row .pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                this.journeyTimeOffset = parseInt(pill.dataset.offset, 10);
                this._replanIfActive();
            });
        });
    }

    _replanIfActive() {
        const dest = document.getElementById('destination-input').value.trim();
        if (dest && this._hasSearched) this.planJourney(dest);
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
        const chips = this.destinations.map(dest => `
            <span class="chip" data-destination="${this.escapeAttr(dest)}">${this.escapeHtml(dest)}<button class="chip-x" data-remove="${this.escapeAttr(dest)}" aria-label="Remove">&times;</button></span>`).join('');
        container.innerHTML = chips + `<button class="chip add" id="add-dest-chip">+ Add</button>`;

        container.querySelectorAll('.chip[data-destination]').forEach(chip => {
            chip.addEventListener('click', (e) => {
                if (e.target.closest('.chip-x')) return;
                const input = document.getElementById('destination-input');
                input.value = chip.dataset.destination;
                const clr = document.getElementById('destination-clear'); if (clr) clr.style.display = 'flex';
                this.planJourney(chip.dataset.destination);
            });
        });
        container.querySelectorAll('.chip-x').forEach(x =>
            x.addEventListener('click', (e) => { e.stopPropagation(); this.removeDestination(x.dataset.remove); }));
        const add = document.getElementById('add-dest-chip');
        if (add) add.addEventListener('click', () => {
            const dest = prompt('Add a quick destination:');
            if (dest && dest.trim() && !this.destinations.some(d => d.toLowerCase() === dest.trim().toLowerCase())) {
                this.destinations.push(dest.trim());
                this.saveDestinations();
                this.renderDestinationChips();
            }
        });
    }

    removeDestination(destination) {
        this.destinations = this.destinations.filter(d => d !== destination);
        this.saveDestinations();
        this.renderDestinationChips();
    }

    appendJourneyParams(url) {
        const sep = () => url.includes('?') ? '&' : '?';
        if (this.journeyTimeOffset > 0) {
            // TfL Journey API expects separate date=yyyyMMdd & time=HHmm (local), not ISO dateTime
            const dt = new Date(Date.now() + this.journeyTimeOffset * 60000);
            const pad = n => String(n).padStart(2, '0');
            const date = `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}`;
            const time = `${pad(dt.getHours())}${pad(dt.getMinutes())}`;
            url += `${sep()}date=${date}&time=${time}&timeIs=Departing`;
        }
        if (this.journeyModes) url += `${sep()}mode=${this.journeyModes}`;
        if (this.journeyPref) url += `${sep()}journeyPreference=${this.journeyPref}`;
        if (this.journeyStepFree) url += `${sep()}accessibilityPreference=stepFreeToVehicle`;
        return url;
    }

    async planJourney(destination) {
        const resultsContainer = document.getElementById('journey-results');
        const updateTime = document.getElementById('journey-updated');
        this._hasSearched = true;
        this.showScreen('plan');

        // Show loading state
        resultsContainer.style.display = 'block';
        resultsContainer.innerHTML = '<div class="empty-hint">Finding the best routes… 🔍</div>';
        updateTime.textContent = 'Searching…';

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

            url = this.appendJourneyParams(url);

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
                resolvedUrl = this.appendJourneyParams(resolvedUrl);

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
        this._lastJourneys = journeys;
        this.saveFavouriteJourney(destination);

        // Tagging: fastest / cheapest / least-walking
        const durations = journeys.map(j => j.duration);
        const fares = journeys.map(j => (j.fare && j.fare.totalCost != null) ? j.fare.totalCost : Infinity);
        const walks = journeys.map(j => (j.legs || []).filter(l => l.mode?.id === 'walking').reduce((s, l) => s + (l.duration || 0), 0));
        const idxFast = durations.indexOf(Math.min(...durations));
        const idxCheap = Math.min(...fares) < Infinity ? fares.indexOf(Math.min(...fares)) : -1;
        const idxLeast = walks.indexOf(Math.min(...walks));
        const tagFor = (i) => i === idxFast ? { cls: 'tag-best', label: 'Fastest' }
            : i === idxCheap ? { cls: 'tag-cheapest', label: 'Cheapest' }
            : i === idxLeast ? { cls: 'tag-least', label: 'Least walking' } : null;

        const cards = journeys.map((journey, index) => {
            const tag = tagFor(index);
            const dep = new Date(journey.startDateTime);
            const leaveMins = Math.max(0, Math.round((dep - new Date()) / 60000));
            const depStr = dep.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            const arrStr = new Date(journey.arrivalDateTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            const status = this.routeStatus(journey);
            const fare = (journey.fare && journey.fare.totalCost != null) ? `£${(journey.fare.totalCost / 100).toFixed(2)}` : '—';
            const walkTotal = walks[index];
            return `
                <div class="route-card ${tag ? tag.cls : ''}" data-index="${index}">
                    ${tag ? `<span class="route-tag">${tag.label}</span>` : ''}
                    <div class="route-top">
                        <div>
                            <div class="route-time"><span class="rt-num">${journey.duration}</span><span class="rt-unit">min</span></div>
                            <div class="route-time-label">Total time</div>
                        </div>
                        <span class="route-status ${status.cls}">${status.label}</span>
                    </div>
                    <div class="route-modes">${this.buildModeStrip(journey)}</div>
                    <div class="route-meta">Leaves in <b>${leaveMins} min</b> · ${depStr}–${arrStr}</div>
                    <div class="route-foot">
                        <span class="route-foot-item">💷 ${fare}</span>
                        <span class="route-foot-item">🚶 ${walkTotal} min</span>
                        <span class="route-foot-item">›  Details</span>
                    </div>
                </div>`;
        }).join('');

        container.style.display = 'block';
        container.innerHTML = cards;

        // Draw fastest on the map (no auto-scroll)
        this.drawJourneyRoute(journeys[idxFast >= 0 ? idxFast : 0]);

        container.querySelectorAll('.route-card').forEach(card => {
            card.addEventListener('click', () => {
                const idx = parseInt(card.dataset.index, 10);
                if (!isNaN(idx) && journeys[idx]) this.showJourneyDetail(journeys[idx], destination);
            });
        });
    }

    routeStatus(journey) {
        let cls = 'ok';
        (journey.legs || []).forEach(leg => {
            const name = (leg.routeOptions?.[0]?.name || '').toLowerCase();
            const st = this.lineStatusData ? this.lineStatusData[name] : null;
            if (st && st !== 'Good Service') {
                if (/sever|suspend|closed|part/i.test(st)) cls = 'bad';
                else if (cls !== 'bad') cls = 'warn';
            }
        });
        return { cls, label: cls === 'ok' ? 'On time' : cls === 'warn' ? 'Minor delays' : 'Disruption' };
    }

    buildModeStrip(journey) {
        const parts = [];
        (journey.legs || []).forEach(leg => {
            const mode = leg.mode?.id || 'walking';
            const dur = leg.duration || 0;
            if (mode === 'walking') {
                if (dur >= 2) parts.push(`<span class="route-mode-seg">🚶 ${dur} min</span>`);
            } else if (mode === 'bus') {
                const line = leg.routeOptions?.[0]?.name || '';
                parts.push(`<span class="route-mode-seg"><span class="bus-badge">${this.escapeHtml(line)}</span> Bus</span>`);
            } else {
                const line = leg.routeOptions?.[0]?.name || mode;
                parts.push(`<span class="route-mode-seg">${this._routeRoundel(mode)} ${this.escapeHtml(line)}</span>`);
            }
        });
        return parts.join('<span class="route-sep">›</span>') || '<span class="route-mode-seg">🚶 Walk</span>';
    }

    _routeRoundel(mode) {
        const cls = mode === 'tube' ? 'tube' : mode === 'overground' ? 'overground'
            : mode === 'dlr' ? 'dlr' : mode === 'elizabeth-line' ? 'elizabeth' : 'rail';
        return `<span class="roundel ${cls}"></span>`;
    }

    showJourneyDetail(journey, destination) {
        const content = document.getElementById('journey-detail-content');
        if (!content) return;
        this.drawJourneyRoute(journey, false);

        const fromLabel = this.journeyOrigin === 'here' ? 'Here' : (this.home.label || 'Home');
        const dep = new Date(journey.startDateTime);
        const arr = new Date(journey.arrivalDateTime);
        const arrStr = arr.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const status = this.routeStatus(journey);
        const fare = (journey.fare && journey.fare.totalCost != null) ? `£${(journey.fare.totalCost / 100).toFixed(2)}` : '—';
        const legs = journey.legs || [];
        const walkTotal = legs.filter(l => l.mode?.id === 'walking').reduce((s, l) => s + (l.duration || 0), 0);

        // Timeline steps
        const steps = legs.map((leg, i) => {
            const mode = leg.mode?.id || 'walking';
            const dur = leg.duration || 0;
            const nodeCls = mode === 'walking' ? 'walk' : mode === 'bus' ? 'bus' : '';
            const icon = mode === 'walking' ? '🚶' : mode === 'bus' ? '🚌' : this._modeEmoji(this._legMode(mode));
            const lineName = leg.routeOptions?.[0]?.name || '';
            const toName = this.cleanStationName(leg.arrivalPoint?.commonName || (i === legs.length - 1 ? destination : 'next stop'));
            let title, sub;
            if (mode === 'walking') {
                title = `Walk to ${this.escapeHtml(toName)}`;
                sub = `${dur} min${leg.distance ? ' · ' + (leg.distance >= 1000 ? (leg.distance / 1000).toFixed(1) + ' km' : Math.round(leg.distance) + ' m') : ''}`;
            } else {
                const verb = mode === 'bus' ? `Bus ${this.escapeHtml(lineName)}` : this.escapeHtml(lineName || mode);
                title = `${verb} to ${this.escapeHtml(toName)}`;
                const depAt = leg.departureTime ? new Date(leg.departureTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
                sub = `${dur} min${depAt ? ' · departs ' + depAt : ''}`;
            }
            const lineCls = mode === 'walking' ? 'green' : mode === 'bus' ? 'red' : '';
            return `
                <div class="tl-step">
                    <div class="tl-rail">
                        <div class="tl-node ${nodeCls}">${icon}</div>
                        ${i < legs.length - 1 ? `<div class="tl-line ${lineCls}"></div>` : ''}
                    </div>
                    <div class="tl-card">
                        <div class="tl-card-title">${title}</div>
                        <div class="tl-card-sub">${sub}</div>
                    </div>
                </div>`;
        }).join('');

        const insights = [];
        const haveLineData = Object.keys(this.lineStatusData || {}).length > 0;
        if (status.cls !== 'ok') insights.push(`<div class="jd-insight" style="background:var(--amber-soft);color:var(--amber)">⚠️ <span class="jd-i-body"><b>${status.label}</b> on part of this route.</span></div>`);
        else if (haveLineData) insights.push(`<div class="jd-insight ok">🛡️ <span class="jd-i-body"><b>Low disruption</b> — no major issues on your route.</span></div>`);
        if (this.currentWeather && this.currentWeather.rainChance >= 50 && walkTotal >= 3) {
            insights.push(`<div class="jd-insight info">🌧️ <span class="jd-i-body"><b>Rain likely</b> — ${this.currentWeather.rainChance}% chance, allow extra time walking.</span></div>`);
        }

        content.innerHTML = `
            <div class="jd-summary">
                <div class="jd-route">
                    <span class="jd-od">${this.escapeHtml(fromLabel)} → ${this.escapeHtml(destination)}</span>
                    <span class="route-status ${status.cls}">${status.label}</span>
                </div>
                <div class="jd-big">
                    <span class="jd-total">${journey.duration}<span class="u"> min</span></span>
                    <span class="jd-arrive">Arrive<b>${arrStr}</b></span>
                </div>
                <div class="jd-foot">
                    <span>💷 ${fare}</span><span>🚶 ${walkTotal} min walk</span><span>🚉 ${legs.filter(l=>l.mode?.id!=='walking').length} legs</span>
                </div>
            </div>
            <div class="section-head"><h3>Your journey</h3></div>
            <div class="timeline">${steps}</div>
            ${insights.join('')}
            <div class="jd-actions">
                <button class="jd-act primary" id="jd-save">★ Save route</button>
            </div>`;

        const saveBtn = document.getElementById('jd-save');
        if (saveBtn) saveBtn.addEventListener('click', () => {
            this.saveFavouriteJourney(destination);
            saveBtn.textContent = '✓ Saved';
        });

        this.showScreen('journey');
    }

    _legMode(mode) {
        return mode === 'overground' ? 'overground' : mode === 'dlr' ? 'dlr'
            : mode === 'tube' ? 'tube' : mode === 'elizabeth-line' ? 'elizabeth' : 'rail';
    }

    // ==================== SMART INSIGHTS ====================
    // ==================== ORIGIN TOGGLE (From Home / Current Location) ====================
    homeLabel() {
        return (this.home && this.home.label) || `Home (${((this.home && this.home.postcode) || 'SE20').split(' ')[0]})`;
    }

    setJourneyOrigin(origin) {
        const fromText = document.getElementById('from-text');
        if (!fromText) return;
        this.journeyOrigin = origin;
        if (origin === 'here') {
            fromText.textContent = 'Locating…';
            this.getCurrentLocation();
        } else {
            fromText.textContent = this.homeLabel();
            this.currentLocation = null;
        }
    }

    async getCurrentLocation() {
        const fromText = document.getElementById('from-text');
        const setFrom = (t) => { if (fromText) fromText.textContent = t; };

        if (!navigator.geolocation) { setFrom('Location N/A'); this.journeyOrigin = 'home'; return; }
        if (this.fetchingLocation) return;
        this.fetchingLocation = true;
        setFrom('Locating…');

        try {
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true, timeout: 8000, maximumAge: 15000
                });
            });
            this.currentLocation = { lat: position.coords.latitude, lon: position.coords.longitude };
            const locationName = await this.reverseGeocode(this.currentLocation);
            setFrom(`📍 ${locationName}`);
        } catch (error) {
            console.error('Geolocation error:', error);
            setFrom('Location denied — tap for Home');
            this.currentLocation = null;
            this.journeyOrigin = 'home';
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
        const list = document.getElementById('favourites-list');
        if (list) {
            const display = (this.favouriteJourneys || []).slice(0, 4);
            list.innerHTML = display.map(f =>
                `<span class="chip" data-destination="${this.escapeAttr(f.destination)}">🕐 ${this.escapeHtml(f.destination)}<button class="chip-x" data-remove="${this.escapeAttr(f.destination)}" aria-label="Remove">&times;</button></span>`
            ).join('');
            list.querySelectorAll('.chip[data-destination]').forEach(chip => {
                chip.addEventListener('click', (e) => {
                    if (e.target.closest('.chip-x')) return;
                    const input = document.getElementById('destination-input');
                    input.value = chip.dataset.destination;
                    const clr = document.getElementById('destination-clear'); if (clr) clr.style.display = 'flex';
                    this.planJourney(chip.dataset.destination);
                });
            });
            list.querySelectorAll('.chip-x').forEach(x =>
                x.addEventListener('click', (e) => { e.stopPropagation(); this.removeFavouriteJourney(x.dataset.remove); }));
        }
        this.renderRecents();
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
        this.radiusLayer = L.layerGroup().addTo(this.map);
        this.markersLayer = L.layerGroup().addTo(this.map);
        this.userLayer = L.layerGroup().addTo(this.map);
        this.routeLayer = L.layerGroup().addTo(this.map);

        // "Locate me" control (pinpoints the user's real position)
        const LocateCtl = L.Control.extend({
            options: { position: 'bottomright' },
            onAdd: () => {
                const btn = L.DomUtil.create('button', 'map-locate-btn');
                btn.innerHTML = '◎';
                btn.title = 'Find my location';
                L.DomEvent.on(btn, 'click', (e) => { L.DomEvent.stop(e); this.locateMe(); });
                return btn;
            }
        });
        this.map.addControl(new LocateCtl());

        this.updateMap();
    }

    updateMap() {
        if (!this.map || typeof L === 'undefined') return;
        this.markersLayer.clearLayers();
        this.radiusLayer.clearLayers();
        const center = [this.home.lat, this.home.lon];
        this.map.setView(center, 14);

        // Walk-radius rings (~80 m/min): 5 min and 10 min
        [{ r: 400, label: '5 min walk' }, { r: 800, label: '10 min walk' }].forEach(c => {
            L.circle(center, { radius: c.r, color: '#2f6bff', weight: 1, opacity: 0.5, fillColor: '#2f6bff', fillOpacity: 0.05, dashArray: '4 4' }).addTo(this.radiusLayer);
        });

        // Home pin
        const homeIcon = L.divIcon({ className: 'map-pin', html: '<span>🏠</span>', iconSize: [28, 28] });
        L.marker(center, { icon: homeIcon }).addTo(this.markersLayer).bindPopup(`🏠 ${this.escapeHtml(this.home.label || 'Home')}`);

        const mk = (lat, lon, emoji, label, onClick) => {
            if (lat == null || lon == null) return;
            const icon = L.divIcon({ className: 'map-pin', html: `<span>${emoji}</span>`, iconSize: [26, 26] });
            const m = L.marker([lat, lon], { icon }).addTo(this.markersLayer).bindPopup(this.escapeHtml(label));
            if (onClick) m.on('click', onClick);
        };
        (this.nearbyStations || []).forEach(s => {
            const emoji = this._modeEmoji(this._stationMode(s));
            mk(s.lat, s.lon, emoji, s.name, () => this.openStopModal(s.id, s.name, false));
        });
        (this.nearbyBusStops || []).forEach(b => mk(b.lat, b.lon, '🚌', b.name, () => this.openStopModal(b.id, b.name, true)));

        // Leaflet needs a size recalc when its container was hidden/resized
        setTimeout(() => { if (this.map) this.map.invalidateSize(); }, 200);
    }

    locateMe() {
        if (!this.map || typeof L === 'undefined' || !navigator.geolocation) return;
        this.showScreen('nearby');
        navigator.geolocation.getCurrentPosition((pos) => {
            const here = [pos.coords.latitude, pos.coords.longitude];
            this.userLayer.clearLayers();
            // Pulsing blue "you are here" dot
            L.circleMarker(here, { radius: 8, color: '#fff', weight: 3, fillColor: '#2f6bff', fillOpacity: 1 })
                .addTo(this.userLayer).bindPopup('📍 You are here').openPopup();
            L.circle(here, { radius: pos.coords.accuracy || 60, color: '#2f6bff', weight: 1, opacity: 0.4, fillColor: '#2f6bff', fillOpacity: 0.08 })
                .addTo(this.userLayer);
            this.map.setView(here, 15);
            setTimeout(() => this.map.invalidateSize(), 100);
        }, () => {
            // Permission denied / unavailable — no-op (home pin stays)
        }, { enableHighAccuracy: true, timeout: 8000 });
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

    // ==================== SETTINGS (Saved screen) ====================
    setupSettings() {
        const setStatus = (msg, isErr) => {
            const s = document.getElementById('settings-status');
            if (s) { s.textContent = msg || ''; s.className = `settings-status ${isErr ? 'error' : ''}`; }
        };
        this._settingsResolve = async (input) => {
            setStatus('Locating…', false);
            try {
                const home = await this.resolveLocation(input);
                setStatus(`Moved to ${home.label}`, false);
                this.updateSettingsUI();
            } catch (e) {
                setStatus(e.message || 'Could not set that location', true);
            }
        };

        const setBtn = document.getElementById('settings-set-home');
        const input = document.getElementById('settings-postcode');
        if (setBtn && input) {
            setBtn.addEventListener('click', () => { const v = input.value.trim(); if (v) this._settingsResolve(v); });
            input.addEventListener('keypress', (e) => { if (e.key === 'Enter') setBtn.click(); });
        }
        const locBtn = document.getElementById('settings-use-location');
        if (locBtn) locBtn.addEventListener('click', () => {
            setStatus('Getting GPS…', false);
            if (!navigator.geolocation) { setStatus('Geolocation not supported', true); return; }
            navigator.geolocation.getCurrentPosition(
                (pos) => this._settingsResolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'Current area', postcode: '' }),
                () => setStatus('Location denied or unavailable', true),
                { enableHighAccuracy: true, timeout: 8000 }
            );
        });
        const reset = document.getElementById('settings-reset');
        if (reset) reset.addEventListener('click', () => this._settingsResolve(CONFIG.DEFAULT_HOME.postcode));

        this.updateSettingsUI();
    }

    updateSettingsUI() {
        const cur = document.getElementById('settings-current-label');
        if (cur) cur.textContent = this.home.label || this.home.postcode || 'SE20';
        const reset = document.getElementById('settings-reset');
        if (reset) reset.style.display = this.home.isDefault ? 'none' : 'block';
    }

    renderSavedPlaces() {
        const list = document.getElementById('saved-places-list');
        if (!list) return;
        if (!this.savedPlaces || this.savedPlaces.length === 0) {
            list.innerHTML = '<div class="saved-empty">No saved places yet — set a home or search to add some.</div>';
            return;
        }
        list.innerHTML = this.savedPlaces.map(p => `
            <div class="saved-item">
                <button class="saved-item-go" data-postcode="${this.escapeAttr(p.postcode || '')}" data-lat="${p.lat}" data-lon="${p.lon}" data-label="${this.escapeAttr(p.label)}">📍 ${this.escapeHtml(p.label)}</button>
                <button class="saved-item-x" data-label="${this.escapeAttr(p.label)}" aria-label="Remove">&times;</button>
            </div>`).join('');
        list.querySelectorAll('.saved-item-go').forEach(b => b.addEventListener('click', () => {
            if (b.dataset.postcode) { this._settingsResolve(b.dataset.postcode); return; }
            const lat = parseFloat(b.dataset.lat), lon = parseFloat(b.dataset.lon);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
                this._settingsResolve({ lat, lon, label: b.dataset.label, postcode: '' });
            }
        }));
        list.querySelectorAll('.saved-item-x').forEach(x => x.addEventListener('click', () => {
            this.removeSavedPlace(x.dataset.label);
            this.renderSavedPlaces();
        }));
    }

    renderRecents() {
        const list = document.getElementById('saved-recents-list');
        if (!list) return;
        const recents = this.favouriteJourneys || [];
        if (recents.length === 0) {
            list.innerHTML = '<div class="saved-empty">No recent journeys yet.</div>';
            return;
        }
        list.innerHTML = recents.map(f => `
            <div class="saved-item">
                <button class="saved-item-go" data-destination="${this.escapeAttr(f.destination)}">🕐 ${this.escapeHtml(f.destination)}</button>
                <button class="saved-item-x" data-remove="${this.escapeAttr(f.destination)}" aria-label="Remove">&times;</button>
            </div>`).join('');
        list.querySelectorAll('.saved-item-go').forEach(b => b.addEventListener('click', () => {
            const input = document.getElementById('destination-input');
            input.value = b.dataset.destination;
            this.planJourney(b.dataset.destination);
        }));
        list.querySelectorAll('.saved-item-x').forEach(x => x.addEventListener('click', () => {
            this.removeFavouriteJourney(x.dataset.remove);
            this.renderRecents();
        }));
    }

    // ==================== UTILITIES ====================
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    escapeAttr(str) {
        return String(str == null ? '' : str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
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
