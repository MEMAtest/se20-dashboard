/*
 * Journey guidance data helpers.
 *
 * This module deliberately contains no fetches or DOM work.  It turns TfL
 * JourneyResults legs and StopPoint arrivals into conservative, display-ready
 * data that a UI can render safely.
 */
(function attachJourneyGuidance(root, factory) {
    const api = factory();
    root.JourneyGuidance = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function journeyGuidanceFactory() {
    'use strict';

    const WALK_MODES = new Set(['walking', 'walk']);
    const CYCLE_MODES = new Set(['cycle', 'cycling']);
    const IGNORED_DIRECTION_WORDS = new Set([
        'station', 'underground', 'rail', 'railway', 'bus', 'stop', 'the',
        'line', 'platform', 'via', 'to', 'towards'
    ]);

    function asArray(value) {
        return Array.isArray(value) ? value : (value == null ? [] : [value]);
    }

    function text(value) {
        return typeof value === 'string' ? value.trim() : (value == null ? '' : String(value).trim());
    }

    function normaliseId(value) {
        return text(value).toLowerCase();
    }

    function readMode(leg) {
        return normaliseId(leg && leg.mode && (leg.mode.id || leg.mode.name)) || 'walking';
    }

    function pointName(point, fallback) {
        return text(point && (point.commonName || point.name || point.localName || point.id)) || text(fallback);
    }

    function pointId(point) {
        return text(point && (point.individualStopId || point.naptanId || point.id || point.stopPointId)) || null;
    }

    function pointCoordinates(point) {
        const lat = Number(point && point.lat);
        const lon = Number(point && (point.lon != null ? point.lon : point.lng));
        return Number.isFinite(lat) && Number.isFinite(lon) ? { lat: lat, lon: lon } : null;
    }

    function firstText(values) {
        for (const value of values) {
            const found = text(value);
            if (found) return found;
        }
        return '';
    }

    function lineFromRouteOption(option) {
        const identifier = option && option.lineIdentifier;
        const id = firstText([
            option && option.lineId,
            option && option.id,
            identifier && identifier.id,
            identifier && identifier.lineId,
            identifier && identifier.name,
            option && option.name
        ]);
        const name = firstText([
            option && option.name,
            identifier && identifier.name,
            identifier && identifier.id,
            option && option.lineId,
            option && option.id
        ]) || id;
        return id ? { id: id, name: name } : null;
    }

    function directionValues(option) {
        if (!option || typeof option !== 'object') return [];
        const values = [];
        for (const value of asArray(option.directions)) values.push(value);
        values.push(option.direction, option.destination, option.destinationName, option.towards);
        return values.map(text).filter(Boolean);
    }

    function uniqueStrings(values) {
        const seen = new Set();
        return values.filter(value => {
            const key = normaliseId(value);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function stopCountFor(leg) {
        const path = leg && leg.path;
        const candidates = [
            leg && leg.stopCount,
            path && path.stopCount,
            path && path.stopPoints,
            path && path.stopPoint,
            leg && leg.stopPoints
        ];
        for (const value of candidates) {
            if (Array.isArray(value)) return value.length;
            const parsed = Number(value);
            if (Number.isFinite(parsed) && parsed >= 0) return parsed;
        }
        return 0;
    }

    function buildSegment(leg, index, destination, finalIndex) {
        const source = leg && typeof leg === 'object' ? leg : {};
        const mode = readMode(source);
        const routeOptions = asArray(source.routeOptions);
        const lines = [];
        const lineKeys = new Set();
        const directions = [];

        routeOptions.forEach(option => {
            const line = lineFromRouteOption(option);
            if (line && !lineKeys.has(normaliseId(line.id))) {
                lineKeys.add(normaliseId(line.id));
                lines.push(line);
            }
            directions.push.apply(directions, directionValues(option));
        });

        // Some otherwise-valid API shapes put the chosen line directly on a leg.
        if (!lines.length) {
            const direct = lineFromRouteOption({
                lineId: source.lineId,
                id: source.routeNumber,
                name: source.lineName || source.routeName
            });
            if (direct) lines.push(direct);
        }

        const directionNames = uniqueStrings(directions);
        const departurePoint = source.departurePoint || source.from || null;
        const arrivalPoint = source.arrivalPoint || source.to || null;
        return {
            index: index,
            original: leg,
            kind: WALK_MODES.has(mode) ? 'walk' : (CYCLE_MODES.has(mode) ? 'cycle' : 'transport'),
            mode: mode,
            fromName: pointName(departurePoint, index === 0 ? source.fromName : ''),
            toName: pointName(arrivalPoint, finalIndex === index ? destination : source.toName),
            departureTime: text(source.departureTime) || null,
            arrivalTime: text(source.arrivalTime) || null,
            durationMinutes: Number.isFinite(Number(source.duration)) ? Number(source.duration) : 0,
            stopCount: stopCountFor(source),
            lines: lines,
            acceptedLineIds: lines.map(line => line.id),
            // A string is easy to render; directionNames retains all TfL routeOptions
            // for matching rather than incorrectly treating routeOptions[0] as truth.
            direction: directionNames[0] || null,
            directionNames: directionNames,
            departureStopId: pointId(departurePoint),
            targetStopId: pointId(arrivalPoint),
            departureCoordinates: pointCoordinates(departurePoint)
        };
    }

    function buildJourneyGuidance(legs, destination) {
        const input = Array.isArray(legs) ? legs : [];
        return { segments: input.map((leg, index) => buildSegment(leg, index, destination, input.length - 1)) };
    }

    function namesMatch(left, right) {
        const a = directionTokens(left);
        const b = directionTokens(right);
        if (!a.length || !b.length) return false;
        if (a.join(' ') === b.join(' ')) return true;
        // This covers names such as "Brixton" vs "Brixton Underground Station"
        // without accepting an unrelated word embedded in a longer phrase.
        const shorter = a.length <= b.length ? a : b;
        const longer = a.length <= b.length ? b : a;
        return shorter.every(token => longer.indexOf(token) !== -1);
    }

    function directionTokens(value) {
        return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ')
            .split(/\s+/).filter(token => token && !IGNORED_DIRECTION_WORDS.has(token));
    }

    function sameLine(first, second) {
        const firstIds = (first && first.acceptedLineIds || []).map(normaliseId).filter(Boolean);
        const secondIds = new Set((second && second.acceptedLineIds || []).map(normaliseId).filter(Boolean));
        return firstIds.some(id => secondIds.has(id));
    }

    function explicitThroughService(segment) {
        const original = segment && segment.original;
        if (!original || typeof original !== 'object') return false;
        if (original.isThroughService === true || original.throughService === true) return true;
        return asArray(original.routeOptions).some(option => option &&
            (option.isThroughService === true || option.throughService === true));
    }

    function serviceIdentity(segment) {
        const original = segment && segment.original;
        if (!original || typeof original !== 'object') return '';
        return normaliseId(firstText([
            original.vehicleId, original.serviceId, original.rid, original.trainId,
            original.routeOptions && original.routeOptions[0] && original.routeOptions[0].serviceId
        ]));
    }

    function isThroughService(currentSegment, nextSegment) {
        if (!currentSegment || !nextSegment || currentSegment.kind !== 'transport' || nextSegment.kind !== 'transport') return false;
        const explicitlyThrough = explicitThroughService(currentSegment) || explicitThroughService(nextSegment);
        const currentService = serviceIdentity(currentSegment);
        const nextService = serviceIdentity(nextSegment);
        // A shared line/operator and direction do not prove that the passenger
        // remains on the same vehicle. Only trust an explicit through-service flag
        // or a stable service/run identity carried across both legs.
        if (explicitlyThrough && !sameLine(currentSegment, nextSegment)) return false;
        if (!explicitlyThrough && (!currentService || currentService !== nextService)) return false;
        if (!sameLine(currentSegment, nextSegment) && currentSegment.mode !== nextSegment.mode) return false;
        const joinsAtSameStop = (currentSegment.targetStopId && nextSegment.departureStopId &&
            normaliseId(currentSegment.targetStopId) === normaliseId(nextSegment.departureStopId)) ||
            namesMatch(currentSegment.toName, nextSegment.fromName);
        if (!joinsAtSameStop) return false;
        const firstDirection = currentSegment.direction;
        const nextDirection = nextSegment.direction;
        return !firstDirection || !nextDirection || namesMatch(firstDirection, nextDirection);
    }

    function parseTimeMs(value) {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : NaN;
    }

    function transferMinutes(currentSegment, nextSegment) {
        if (!currentSegment || !nextSegment) return null;
        if (isThroughService(currentSegment, nextSegment)) return 0;
        const arrival = parseTimeMs(currentSegment.arrivalTime);
        const departure = parseTimeMs(nextSegment.departureTime);
        if (!Number.isFinite(arrival) || !Number.isFinite(departure)) return null;
        return Math.max(0, Math.round((departure - arrival) / 60000));
    }

    function cancelled(arrival) {
        if (!arrival || typeof arrival !== 'object') return true;
        if (arrival.cancelled === true || arrival.isCancelled === true) return true;
        return /cancelled|canceled/i.test(text(arrival.status) + ' ' + text(arrival.timing && arrival.timing.status));
    }

    function arrivalTimeMs(arrival, nowMs) {
        const direct = parseTimeMs(arrival && (arrival.expectedArrival || arrival.expectedTime || arrival.timeToLive));
        if (Number.isFinite(direct)) return direct;
        const seconds = Number(arrival && arrival.timeToStation);
        return Number.isFinite(seconds) ? nowMs + seconds * 1000 : NaN;
    }

    function arrivalMatchesSegment(arrival, segment) {
        const accepted = new Set((segment && segment.acceptedLineIds || []).map(normaliseId).filter(Boolean));
        const lineId = normaliseId(arrival && (arrival.lineId || arrival.lineName || arrival.routeNumber));
        if (accepted.size && (!lineId || !accepted.has(lineId))) return false;

        const targetStop = normaliseId(segment && segment.targetStopId);
        const arrivalTarget = normaliseId(arrival && (arrival.destinationNaptanId || arrival.destinationStopId));
        if (targetStop && arrivalTarget && targetStop === arrivalTarget) return true;

        const expectedDirections = uniqueStrings((segment && segment.directionNames && segment.directionNames.length
            ? segment.directionNames : (segment && segment.direction ? [segment.direction] : [])));
        // Only use the leg target as a fallback when TfL supplied no route direction.
        if (!expectedDirections.length && segment && segment.toName) expectedDirections.push(segment.toName);
        if (!expectedDirections.length) return true;

        const actualDirections = [arrival && arrival.destinationName, arrival && arrival.towards, arrival && arrival.direction]
            .map(text).filter(Boolean);
        if (!actualDirections.length) return false;
        return expectedDirections.some(expected => actualDirections.some(actual => namesMatch(expected, actual)));
    }

    function normaliseDeparture(arrival, segment, nowMs) {
        const at = arrivalTimeMs(arrival, nowMs);
        if (!Number.isFinite(at) || at <= nowMs) return null;
        const planned = parseTimeMs(segment && segment.departureTime);
        // Earlier trains may be going the right way but are not catchable within
        // the selected itinerary. Keep a two-minute tolerance for prediction drift.
        if (Number.isFinite(planned) && at < planned - 2 * 60000) return null;
        if (!arrivalMatchesSegment(arrival, segment)) return null;
        const lineId = text(arrival.lineId || arrival.lineName || arrival.routeNumber) || null;
        const line = (segment && segment.lines || []).find(item => normaliseId(item.id) === normaliseId(lineId));
        return {
            serviceId: text(arrival.vehicleId || arrival.serviceId || arrival.id || arrival.$id) || null,
            lineId: lineId,
            lineName: text(arrival.lineName) || (line && line.name) || lineId,
            destination: text(arrival.destinationName || arrival.towards) || null,
            direction: text(arrival.towards || arrival.direction || arrival.destinationName) || null,
            expectedTime: new Date(at).toISOString(),
            minutes: Math.max(0, Math.ceil((at - nowMs) / 60000)),
            platform: text(arrival.platformName || arrival.platform) || null,
            cancelled: false
        };
    }

    function normalizeTflDepartures(arrivals, segment, nowMs) {
        const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
        const output = [];
        const seen = new Set();
        asArray(arrivals).forEach(arrival => {
            if (cancelled(arrival)) return;
            const item = normaliseDeparture(arrival, segment, now);
            if (!item) return;
            const key = item.serviceId
                ? [normaliseId(item.lineId), normaliseId(item.serviceId)].join('|')
                : [normaliseId(item.lineId), normaliseId(item.destination), item.expectedTime].join('|');
            if (seen.has(key)) return;
            seen.add(key);
            output.push(item);
        });
        return output.sort((first, second) => Date.parse(first.expectedTime) - Date.parse(second.expectedTime));
    }

    function isLiveEligible(departureTime, nowMs, windowMinutes) {
        const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
        const window = windowMinutes == null ? 30 : Number(windowMinutes);
        const departure = parseTimeMs(departureTime);
        return Number.isFinite(departure) && Number.isFinite(window) && window >= 0 &&
            departure >= now && departure <= now + window * 60000;
    }

    // TfL StopPoint/arrival data is inconsistent about how it labels a bus stop
    // letter/indicator: "->E", "Stop C", "C", or nothing at all. Normalise to a
    // short bare code (e.g. "C") or null when there isn't a usable one.
    function normalizeStopLetter(raw) {
        let value = text(raw).replace(/^->/, '').trim();
        value = value.replace(/^stop\s+/i, '').trim();
        if (!value || !/^[A-Za-z0-9]{1,3}$/.test(value)) return null;
        return value.toUpperCase();
    }

    // "Ride N stops" with correct singular/plural, or null when TfL didn't give
    // us a usable stop count (never render "Ride undefined stops").
    function formatBusStopCount(stopCount) {
        const n = Number(stopCount);
        if (!Number.isFinite(n) || n <= 0) return null;
        const rounded = Math.round(n);
        return `Ride ${rounded} stop${rounded === 1 ? '' : 's'}`;
    }

    // "towards X" for boarding guidance, suppressed when the direction is just
    // the leg's own destination restated (so we don't say "towards Brixton" right
    // next to "get off at Brixton").
    function directionLabel(direction, toName) {
        const dir = text(direction);
        if (!dir) return null;
        if (namesMatch(dir, toName)) return null;
        return `towards ${dir}`;
    }

    function isCallingPatternCompatible(callingPoints, fromName, toName) {
        const points = asArray(callingPoints);
        const boardingIndex = points.findIndex(point => namesMatch(
            point && (point.name || point.locationName || point.stationName) || point, fromName));
        const targetIndex = points.findIndex(point => namesMatch(
            point && (point.name || point.locationName || point.stationName) || point, toName));
        return boardingIndex >= 0 && targetIndex > boardingIndex;
    }

    // ---- Live "on the journey" follow-along helpers (pure — nowMs is always
    // passed in, never read from the clock here) ----

    // Which leg the passenger should be following right now. Defaults to the
    // first not-yet-arrived leg; before the journey starts that's leg 0, after
    // the last arrival it's the final leg (so the view never runs off the end).
    function currentLegIndex(segments, nowMs) {
        const list = Array.isArray(segments) ? segments : [];
        if (!list.length) return 0;
        const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : NaN;
        if (!Number.isFinite(now)) return 0;
        for (let i = 0; i < list.length; i++) {
            const arrival = parseTimeMs(list[i] && list[i].arrivalTime);
            // TfL routinely omits arrivalTime on a leg. Treat an unparseable time
            // as already passed (skip forward) rather than "still current forever"
            // — otherwise one bad leg permanently stalls progression through the
            // rest of the journey. minutesUntilAlight/stopsRemaining are untouched
            // and keep returning null for this leg's own timing.
            if (!Number.isFinite(arrival)) continue;
            if (arrival > now) return i;
        }
        return list.length - 1;
    }

    // Minutes until the current leg's alighting point, or null when the leg has
    // no usable arrival time (never guess/fabricate a countdown).
    function minutesUntilAlight(segment, nowMs) {
        const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : NaN;
        const arrival = parseTimeMs(segment && segment.arrivalTime);
        if (!Number.isFinite(arrival) || !Number.isFinite(now)) return null;
        return Math.max(0, Math.round((arrival - now) / 60000));
    }

    // Stops remaining on the current leg, scaled from the leg's total stop count
    // and duration by elapsed time. Conservative: null when we lack enough data
    // to estimate rather than showing a fabricated number.
    function stopsRemaining(segment, nowMs) {
        const total = Number(segment && segment.stopCount);
        if (!Number.isFinite(total) || total <= 0) return null;
        const departure = parseTimeMs(segment && segment.departureTime);
        const arrival = parseTimeMs(segment && segment.arrivalTime);
        const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : NaN;
        if (!Number.isFinite(departure) || !Number.isFinite(arrival) || !Number.isFinite(now) || arrival <= departure) {
            return Math.round(total);
        }
        const elapsed = Math.min(1, Math.max(0, (now - departure) / (arrival - departure)));
        return Math.max(0, Math.round(total * (1 - elapsed)));
    }

    // Fire an "get off soon" alert once minutes-to-alight drops to/below the
    // threshold, and never again for the same leg. `lastAlertedIndex` is
    // whatever this returned on the previous call (start with null/undefined) —
    // the caller stores it on the instance and passes it back in, so alerting
    // stays idempotent without this module touching any state itself.
    function shouldFireAlightAlert(segment, index, nowMs, lastAlertedIndex, thresholdMinutes) {
        const threshold = thresholdMinutes == null ? 2 : Number(thresholdMinutes);
        if (lastAlertedIndex === index) return false;
        const minutes = minutesUntilAlight(segment, nowMs);
        if (minutes == null) return false;
        return minutes <= threshold;
    }

    // Defect-2 fix: bundles currentLegIndex + shouldFireAlightAlert so a call
    // site cannot accidentally alert off a previewed/manually-selected display
    // leg. Always resolves the time-derived leg itself — a caller has no lever
    // here to substitute a different (e.g. manually navigated) index.
    function resolveLiveAlert(segments, nowMs, lastAlertedIndex, thresholdMinutes) {
        const list = Array.isArray(segments) ? segments : [];
        const index = currentLegIndex(list, nowMs);
        const segment = list[index] || null;
        const shouldFire = !!segment && shouldFireAlightAlert(segment, index, nowMs, lastAlertedIndex, thresholdMinutes);
        return { index: index, segment: segment, shouldFire: shouldFire };
    }

    return Object.freeze({
        buildJourneyGuidance: buildJourneyGuidance,
        isThroughService: isThroughService,
        transferMinutes: transferMinutes,
        normalizeTflDepartures: normalizeTflDepartures,
        isLiveEligible: isLiveEligible,
        isCallingPatternCompatible: isCallingPatternCompatible,
        normalizeStopLetter: normalizeStopLetter,
        formatBusStopCount: formatBusStopCount,
        directionLabel: directionLabel,
        currentLegIndex: currentLegIndex,
        minutesUntilAlight: minutesUntilAlight,
        stopsRemaining: stopsRemaining,
        shouldFireAlightAlert: shouldFireAlightAlert,
        resolveLiveAlert: resolveLiveAlert
    });
}));
