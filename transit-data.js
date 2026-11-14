(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.TransitData = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const MAX_BOARD_AGE = 90 * 1000;
    const clock = value => new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(new Date(value));

    function freshBoard(board, now = Date.now()) {
        return !!board && Number.isFinite(board.at) && board.at <= now
            && now - board.at <= MAX_BOARD_AGE && !board.error && Array.isArray(board.deps);
    }

    function liveRequest(url) {
        return { url, options: { cache: 'no-store', signal: AbortSignal.timeout(10000) } };
    }

    async function json(fetcher, url) {
        const request = liveRequest(url);
        const response = await fetcher(request.url, request.options);
        if (!response.ok || response.headers?.get('X-Journey-Cached') === 'true') throw new Error('Live source unavailable');
        return response.json();
    }

    async function loadBoard(station, { fetcher = fetch, railBase, auth = '', now = Date.now() } = {}) {
        try {
            const data = await json(fetcher, `${railBase}/api/board?crs=${encodeURIComponent(station.crs)}`);
            if (!data || data.error || !Array.isArray(data.departures) || data.warming === true) throw new Error('Rail source unavailable');
            // A Kafka board needs an advancing upstream timestamp, not merely a new HTTP response.
            if (data.source !== 'huxley' && (!Number.isFinite(Date.parse(data.lastUpdate))
                || now - Date.parse(data.lastUpdate) > MAX_BOARD_AGE || Date.parse(data.lastUpdate) > now + 30000)) throw new Error('Rail source stale');
            return { at: now, error: false, source: 'National Rail', partial: false,
                deps: data.departures.filter(d => typeof d.destination === 'string').slice(0, 15).map(d => ({
                    dest: d.destination, sched: d.scheduledTime, exp: d.expectedTime,
                    plat: d.platform, cancelled: !!d.cancelled, rid: d.rid || null,
                    mins: d.mins, line: d.line || '', reason: d.reason || null
                })) };
        } catch (_) { /* An independent, explicitly partial TfL source may still work. */ }
        try {
            const id = station.tflId || station.id;
            if (!/^[A-Za-z0-9]+$/.test(id || '')) throw new Error('Invalid stop');
            const data = await json(fetcher, `https://api.tfl.gov.uk/StopPoint/${id}/Arrivals${auth}`);
            if (!Array.isArray(data)) throw new Error('TfL unavailable');
            const deps = data.filter(d => d.naptanId === id && typeof d.destinationName === 'string'
                && ['tube', 'overground', 'dlr', 'elizabeth-line', 'tram'].includes(d.modeName)
                && Number.isFinite(Date.parse(d.expectedArrival)) && Date.parse(d.expectedArrival) >= now
                && Number.isFinite(Date.parse(d.timestamp)) && now - Date.parse(d.timestamp) <= MAX_BOARD_AGE
                && Date.parse(d.timestamp) <= now + 30000)
                .sort((a, b) => Date.parse(a.expectedArrival) - Date.parse(b.expectedArrival))
                .slice(0, 15).map(d => ({ dest: d.destinationName, exp: clock(d.expectedArrival),
                    expectedArrival: d.expectedArrival,
                    plat: /unknown/i.test(d.platformName || '') ? '' : (d.platformName || '').replace(/^Platform\s+/i, ''), cancelled: false,
                    mins: Math.max(0, Math.ceil((Date.parse(d.expectedArrival) - now) / 60000)), line: d.lineName || '', rid: null }));
            if (!deps.length) throw new Error('No verified TfL predictions');
            return { at: now, error: false, source: 'TfL', partial: true, deps };
        } catch (_) {
            return { at: now, error: true, source: null, partial: true, deps: [] };
        }
    }

    function isLiveUrl(url) {
        return /\/Arrivals(?:\/|$)/i.test(url.pathname)
            || /\/api\/(?:board|service|journey|train)(?:\/|$)/i.test(url.pathname)
            || /\/Line\/.*\/(?:Status|Disruption)(?:\/|$)/i.test(url.pathname)
            || /\/StopPoint\/[^/]+\/Disruption(?:\/|$)/i.test(url.pathname)
            || /\/Journey\//i.test(url.pathname) || /\/crowding\//i.test(url.pathname);
    }
    return { loadBoard, freshBoard, isLiveUrl, MAX_BOARD_AGE };
}));
