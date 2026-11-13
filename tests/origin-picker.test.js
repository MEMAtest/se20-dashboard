const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const G = require('../journey-guidance.js');

function harness(fetcher = async () => ({ ok: true, json: async () => ({ journeys: [{ duration: 10 }] }) })) {
    const nodes = new Map();
    const element = id => {
        if (!nodes.has(id)) nodes.set(id, { value: '', hidden: true, innerHTML: '', textContent: '', style: {}, dataset: {}, events: {},
            classList: { add() {}, remove() {} },
            setAttribute(k, v) { this[k] = v; }, addEventListener(k, fn) { this.events[k] = fn; },
            querySelector() { return null; }, querySelectorAll() { return this.children || []; }, remove() {}, focus() {} });
        return nodes.get(id);
    };
    const store = new Map(); const timers = new Map(); let timerId = 0;
    const context = { console: { log() {}, error() {} }, Date, AbortController, JourneyGuidance: G, navigator: { geolocation: {} },
        CONFIG: { GEOCODE_URL: 'https://api.postcodes.io' },
        document: { addEventListener() {}, getElementById: element, querySelectorAll: () => [], createElement: () => ({
            set textContent(value) { this.innerHTML = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
        }) },
        localStorage: { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v) },
        sessionStorage: { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
        setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id), fetch: fetcher };
    vm.runInNewContext(fs.readFileSync(require.resolve('../app.js'), 'utf8') + '\nthis.App = PengeDash;', context);
    const app = Object.create(context.App.prototype);
    app.savedHome = { lat: 51.405312, lon: -.062353, postcode: 'SE20 7UA', label: 'Home (SE20)' };
    app.home = { lat: 51.6, lon: -.2, label: 'Different nearby area' };
    app.journeyOrigin = 'home'; app.savedPlaces = [];
    app.showScreen = () => {}; app.appendJourneyParams = u => u; app._resolveKnownLocalStation = () => null;
    app.displayRouteOptions = (journeys, dest) => { app.rendered = { journeys, dest }; };
    app.reverseGeocode = async () => 'London';
    return { app, element, context, timers, store };
}

test('origin label opens a picker without secretly toggling Home and phone', () => {
    const { app, element } = harness(); app.setupOriginPicker();
    element('from-text').events.click();
    assert.equal(element('origin-picker').hidden, false);
    assert.equal(element('from-text')['aria-expanded'], 'true'); assert.equal(app.journeyOrigin, 'home');
});

test('GPS validation refuses stale, future, out-of-range and imprecise positions', () => {
    const fix = { coords: { latitude: 51.5, longitude: -.1, accuracy: 20 }, timestamp: Date.now() };
    assert.equal(G.journeyPhoneFix(fix).accuracy, 20);
    for (const invalid of [{ ...fix, timestamp: fix.timestamp - 121000 }, { ...fix, timestamp: fix.timestamp + 11000 },
        { ...fix, coords: { ...fix.coords, latitude: NaN } }, { ...fix, coords: { ...fix.coords, longitude: 190 } },
        { ...fix, coords: { ...fix.coords, accuracy: 501 } }, { ...fix, coords: { latitude: 51.5, longitude: -.1 } }])
        assert.throws(() => G.journeyPhoneFix(invalid));
});

test('failed phone location never issues a route request from Home', async () => {
    let calls = 0; const { app, element } = harness(async () => { calls++; });
    app.journeyOrigin = 'here'; app._acquirePosition = async () => { throw { code: 1 }; };
    await app.planJourney('Oxford Circus');
    assert.equal(calls, 0); assert.match(element('journey-results').innerHTML, /Phone location unavailable/);
    assert.match(element('origin-status').textContent, /permission denied/); assert.equal(app.currentLocation, null);
});

test('Home is routed from saved Home, not the transient Nearby area', async () => {
    let url; const { app } = harness(async u => { url = u; return { ok: true, json: async () => ({ journeys: [{}] }) }; });
    await app.planJourney('Oxford Circus');
    assert.match(url, /51\.405312,-0\.062353\/to\//); assert.equal(app._activeOriginLabel, 'Home (SE20)');
});

test('an unavailable geolocation API cannot revive an old cached phone fix', async () => {
    let calls = 0; const { app, context, element } = harness(async () => { calls++; });
    context.navigator = {}; app.journeyOrigin = 'here'; app.currentLocation = { lat: 51.5, lon: -.1 }; app._currentLocationAt = Date.now() - 180000;
    await app.planJourney('Bank'); assert.equal(calls, 0); assert.equal(app.currentLocation, null);
    assert.match(element('journey-results').innerHTML, /Phone location unavailable/);
});

test('selected station coordinates bind the origin and do not change saved Home', async () => {
    let url; const { app } = harness(async u => { url = u; return { ok: true, json: async () => ({ journeys: [{}] }) }; });
    app._selectJourneyOrigin({ lat: 51.505881, lon: -.086807, label: 'London Bridge' });
    await app.planJourney('Oxford Circus');
    assert.match(url, /51\.505881,-0\.086807/); assert.equal(app._activeOriginLabel, 'London Bridge');
    assert.equal(app.savedHome.postcode, 'SE20 7UA');
});

test('typing an origin invalidates old results and requires an explicit selection', async () => {
    let calls = 0; const { app, element } = harness(async () => { calls++; });
    app.setupOriginPicker(); element('origin-query').value = 'Victoria'; element('origin-query').events.input();
    await app.planJourney('Bank');
    assert.equal(calls, 0); assert.match(element('journey-results').innerHTML, /Select an exact starting point/);
});

test('postcode search offers the real centroid for confirmation, never automatically selects it', async () => {
    let url; const { app, element } = harness(async u => { url = u; return { ok: true, json: async () => ({ status: 200, result: { postcode: 'SE20 7UA', latitude: 51.405312, longitude: -.062353 } }) }; });
    element('origin-query').value = 'SE20 7UA'; await app.searchJourneyOrigins();
    assert.match(url, /postcodes\/SE20%207UA$/); assert.match(element('origin-candidates').innerHTML, /Confirm this postcode centre/);
    assert.equal(app.journeyOrigin, 'home'); assert.equal(app.selectedOrigin, undefined);
});

test('station search escapes provider text and refuses missing or invalid coordinates', async () => {
    const { app, element } = harness(async () => ({ ok: true, json: async () => ({ matches: [
        { id: 'HUBLBG', name: '<img onerror=alert(1)>', lat: 51.5, lon: -.1, modes: ['tube'] },
        { id: 'bad', name: 'Missing coords' }, { id: 'bad2', name: 'Bad coords', lat: 100, lon: 0 }] }) }));
    element('origin-query').value = 'London Bridge'; await app.searchJourneyOrigins();
    assert.match(element('origin-candidates').innerHTML, /&lt;img/);
    assert.doesNotMatch(element('origin-candidates').innerHTML, /Missing coords|Bad coords|<img/);
});

test('late origin search cannot replace a later explicit Home selection', async () => {
    let finish; const { app, element } = harness(() => new Promise(resolve => { finish = resolve; }));
    element('origin-query').value = 'London Bridge'; const pending = app.searchJourneyOrigins();
    app.setJourneyOrigin('home'); finish({ ok: true, json: async () => ({ matches: [{ id: 'HUBLBG', name: 'Old', lat: 51.5, lon: -.1 }] }) });
    await pending; assert.equal(element('origin-candidates').innerHTML, ''); assert.equal(app.journeyOrigin, 'home');
});

test('a late route cannot replace a newer starting point', async () => {
    let finish; const { app } = harness(() => new Promise(resolve => { finish = resolve; }));
    const pending = app.planJourney('Bank'); app._selectJourneyOrigin({ lat: 51.51, lon: -.12, label: 'New origin' });
    finish({ ok: true, json: async () => ({ journeys: [{ duration: 99 }] }) }); await pending;
    assert.equal(app.rendered, undefined); assert.equal(app.selectedOrigin.label, 'New origin');
});

test('a late phone fix cannot relabel a manually selected origin', async () => {
    let finish; const { app, element } = harness(); app.journeyOrigin = 'here';
    app._acquirePosition = () => new Promise(resolve => { finish = resolve; });
    const pending = app.getCurrentLocation(); app._selectJourneyOrigin({ lat: 51.51, lon: -.12, label: 'New origin' });
    finish({ coords: { latitude: 51.5, longitude: -.1, accuracy: 10 }, timestamp: Date.now() }); await pending;
    assert.equal(element('from-text').textContent, 'New origin'); assert.equal(app.currentLocation, null);
});

test('ambiguous destination requires user choice instead of guessing the first match', async () => {
    let calls = 0; const { app, element } = harness(async () => { calls++; return { ok: false, status: 300,
        json: async () => ({ toLocationDisambiguation: { matchStatus: 'list', disambiguationOptions: [
            { parameterValue: '123', place: { commonName: 'Victoria Road' } }, { parameterValue: '456', place: { commonName: 'Victoria Station' } }] } }) }; });
    await app.planJourney('Victoria'); assert.equal(calls, 1); assert.equal(app.rendered, undefined);
    assert.match(element('journey-results').innerHTML, /Which destination/); assert.match(element('journey-results').innerHTML, /Victoria Station/);
});

test('HTTP failures and timeouts produce explicit errors without routing old data', async () => {
    const { app, element } = harness(async () => ({ ok: false, status: 503 }));
    await app.planJourney('Bank'); assert.match(element('journey-results').innerHTML, /provider unavailable/);
    let finish; const h = harness(() => new Promise(resolve => { finish = resolve; }));
    const pending = h.app.planJourney('Bank'); h.timers.values().next().value();
    finish({ ok: true, json: async () => ({ journeys: [{}] }) }); await pending;
    assert.equal(h.app.rendered, undefined); assert.match(h.element('journey-results').innerHTML, /timed out/);
});

test('journey summary does not invent missing walking or distance data', () => {
    const overview = G.journeyOverview({ duration: 10, arrivalDateTime: '2026-07-13T09:00:00', legs: [{ mode: { id: 'walking' } }] });
    assert.equal(overview.walking, null); assert.equal(overview.distance, undefined);
    assert.equal(overview.walkingDistance, null);
    assert.equal(G.journeyOverview({ legs: [{ mode: { id: 'walking' }, distance: 191 }, { mode: { id: 'walking' }, distance: 262 }, { mode: { id: 'tube' }, distance: 1 }] }).walkingDistance, 453);
    assert.equal(overview.arrival, Date.parse('2026-07-13T08:00:00Z'));
    assert.equal(G.journeyOverview({ legs: [{ mode: { id: 'tube' }, distance: 0 }, { mode: { id: 'walking' }, distance: 949 }] }).distance, undefined);
});

test('map geometry is validated; missing paths use explicitly approximate endpoints', () => {
    const leg = { mode: { id: 'tube' }, departurePoint: { lat: 51.5, lon: -.1 }, arrivalPoint: { lat: 51.51, lon: -.12 } };
    let mapped = G.journeyMapLegs({ legs: [leg] })[0]; assert.equal(mapped.approximate, true); assert.equal(mapped.points.length, 2);
    mapped = G.journeyMapLegs({ legs: [{ ...leg, path: { lineString: '[[51.5,-0.1],[51.51,-0.12]]' } }] })[0];
    assert.equal(mapped.approximate, false);
    mapped = G.journeyMapLegs({ legs: [{ ...leg, path: { lineString: '[[500,0],[51,0]]' }, arrivalPoint: null }] })[0];
    assert.equal(mapped.points.length, 0); assert.equal(mapped.approximate, true);
});

test('origin controls and new journey view remain accessible and do not claim actual travel progress', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    assert.match(html, /aria-controls="origin-picker"/); assert.match(html, /Station or full UK postcode/);
    const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
    assert.match(source, /Planned itinerary/); assert.match(source, /not completed travel/);
    assert.doesNotMatch(source, /\? 'You have arrived'/);
    assert.match(source, /aria-controls="jd-map-panel"/);
});

test('service worker never replays opaque cached Leaflet CSS into a CORS request', async () => {
    let listener; let networkCalls = 0; let delivered;
    const live = { ok: true, type: 'cors', clone() { return this; } };
    const context = { URL, console, importScripts() {}, self: { addEventListener: (name, fn) => { if (name === 'fetch') listener = fn; } },
        caches: { match: async () => ({ type: 'opaque' }), open: async () => ({ put: async () => {} }) },
        fetch: async () => { networkCalls++; return live; } };
    vm.runInNewContext(fs.readFileSync(require.resolve('../sw.js'), 'utf8'), context);
    listener({ request: { method: 'GET', mode: 'cors', url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' }, respondWith(p) { delivered = p; } });
    assert.equal(await delivered, live); assert.equal(networkCalls, 1);
});

test('reload cannot restore routes from a different origin or an already departed trip', () => {
    const { app, store } = harness();
    const data = { journeys: [{ startDateTime: new Date(Date.now() + 600000).toISOString() }], ts: Date.now(),
        originLabel: 'Home (SE20)', originChoice: 'home', homeSignature: app._coordSig(app.savedHome.lat, app.savedHome.lon) };
    app.journeyOrigin = 'here'; store.set('pengedash-journey-cache', JSON.stringify(data)); app._restoreJourneyState();
    assert.equal(app.rendered, undefined);
    app.journeyOrigin = 'home'; data.journeys[0].startDateTime = new Date(Date.now() - 60000).toISOString();
    store.set('pengedash-journey-cache', JSON.stringify(data)); app._restoreJourneyState(); assert.equal(app.rendered, undefined);
    data.journeys[0].startDateTime = new Date(Date.now() + 600000).toISOString();
    store.set('pengedash-journey-cache', JSON.stringify(data)); app._restoreJourneyState(); assert.ok(app.rendered);
    assert.equal(JSON.parse(store.get('pengedash-journey-cache')).ts, data.ts);
});

test('a dismissed destination lookup cannot reopen after Enter or a new search', async () => {
    let finish; const { app, element } = harness(() => new Promise(resolve => { finish = resolve; }));
    element('destination-input').value = 'London Bridge'; app.renderAutocomplete = () => { app.reopened = true; };
    const pending = app.fetchAutocompleteSuggestions('London Bridge'); app.hideAutocomplete();
    finish({ ok: true, json: async () => ({ matches: [{ name: 'London Bridge', id: 'HUBLBG' }] }) }); await pending;
    assert.equal(app.reopened, undefined);
});

test('Now and offset searches use London time, including the correct next date at midnight', () => {
    const { app, context } = harness(); app.journeyTimeOffset = 30;
    const url = context.App.prototype.appendJourneyParams.call(app, 'https://api.tfl.gov.uk/Journey/test', Date.parse('2026-07-13T22:40:00Z'));
    assert.match(url, /date=20260714&time=0011&timeIs=Departing/); assert.match(url, /journeyPreference=leasttime/);
    assert.deepEqual(G.journeyDepartureClock(Date.parse('2026-11-13T16:00:00Z')), { date: '20261113', time: '1601', timeIs: 'Departing' });
});

test('departed or malformed provider journeys cannot become fresh route options', async () => {
    const good = { startDateTime: new Date(Date.now() + 600000).toISOString(), arrivalDateTime: new Date(Date.now() + 1200000).toISOString() };
    const { app } = harness(async () => ({ ok: true, json: async () => ({ journeys: [good,
        { ...good, startDateTime: new Date(Date.now() - 60000).toISOString() }, { startDateTime: 'bad' }] }) }));
    await app.planJourney('Bank'); assert.equal(app.rendered.journeys.length, 1); assert.equal(app.rendered.journeys[0], good);
});

test('destination suggestions are keyboard buttons and bind the validated TfL interchange ID', () => {
    const { app, element } = harness();
    const choice = { dataset: { name: 'London Bridge', stopId: '1000139' }, events: {}, addEventListener(k, fn) { this.events[k] = fn; } };
    element('autocomplete-dropdown').children = [choice];
    app.renderAutocomplete([{ id: 'HUBLBG', icsId: '1000139', name: 'London Bridge', modes: ['tube'] }]);
    assert.match(element('autocomplete-dropdown').innerHTML, /<button type="button"/);
    assert.match(element('autocomplete-dropdown').innerHTML, /data-stop-id="1000139"/);
    app.planJourney = destination => { app.chosenDestination = destination; };
    choice.events.click(); assert.equal(app._selectedDestination.id, '1000139'); assert.equal(app.chosenDestination, 'London Bridge');
});
