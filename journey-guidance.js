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

    function isCallingPatternCompatible(callingPoints, fromName, toName) {
        const points = asArray(callingPoints);
        const boardingIndex = points.findIndex(point => namesMatch(
            point && (point.name || point.locationName || point.stationName) || point, fromName));
        const targetIndex = points.findIndex(point => namesMatch(
            point && (point.name || point.locationName || point.stationName) || point, toName));
        return boardingIndex >= 0 && targetIndex > boardingIndex;
    }

    return Object.freeze({
        buildJourneyGuidance: buildJourneyGuidance,
        isThroughService: isThroughService,
        transferMinutes: transferMinutes,
        normalizeTflDepartures: normalizeTflDepartures,
        isLiveEligible: isLiveEligible,
        isCallingPatternCompatible: isCallingPatternCompatible
    });
}));
