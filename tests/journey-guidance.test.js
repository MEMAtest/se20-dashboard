'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Guidance = require('../journey-guidance.js');

const NOW = Date.parse('2026-08-07T08:00:00.000Z');

function railLeg(overrides) {
    return Object.assign({
        mode: { id: 'tube' },
        departureTime: '2026-08-07T08:10:00.000Z',
        arrivalTime: '2026-08-07T08:20:00.000Z',
        duration: 10,
        departurePoint: { commonName: 'Brixton Underground Station', naptanId: '940GZZLUBXN', lat: 51.4627, lon: -0.1145 },
        arrivalPoint: { commonName: 'Oxford Circus Underground Station', naptanId: '940GZZLUOXC' },
        path: { stopPoints: [{}, {}, {}] },
        routeOptions: [{ id: 'victoria', name: 'Victoria', directions: ['Walthamstow Central'] }]
    }, overrides || {});
}

test('buildJourneyGuidance preserves all line options and transport metadata', () => {
    const leg = railLeg({
        routeOptions: [
            { id: 'victoria', name: 'Victoria', directions: ['Walthamstow Central'] },
            { id: 'northern', name: 'Northern', directions: ['High Barnet'] }
        ]
    });
    const segment = Guidance.buildJourneyGuidance([leg], 'King’s Cross').segments[0];
    assert.deepEqual(segment.lines, [{ id: 'victoria', name: 'Victoria' }, { id: 'northern', name: 'Northern' }]);
    assert.deepEqual(segment.acceptedLineIds, ['victoria', 'northern']);
    assert.equal(segment.stopCount, 3);
    assert.equal(segment.kind, 'transport');
    assert.deepEqual(segment.departureCoordinates, { lat: 51.4627, lon: -0.1145 });
    assert.equal(segment.targetStopId, '940GZZLUOXC');
});

test('buildJourneyGuidance accepts walk, cycle, bus, Tube and rail leg shapes', () => {
    const segments = Guidance.buildJourneyGuidance([
        { mode: { id: 'walking' }, duration: 4, arrivalPoint: { commonName: 'Bus stop' } },
        { mode: { id: 'cycle' }, duration: 8, arrivalPoint: { commonName: 'Park' } },
        { mode: { id: 'bus' }, duration: 12, routeOptions: [{ id: '176', name: '176', directions: ['Tottenham Court Road'] }] },
        railLeg(),
        { mode: { id: 'national-rail' }, duration: 18, routeOptions: [{ lineIdentifier: { id: 'southeastern', name: 'Southeastern' }, directions: ['London Victoria'] }] }
    ], 'Destination').segments;
    assert.deepEqual(segments.map(segment => segment.kind), ['walk', 'cycle', 'transport', 'transport', 'transport']);
    assert.equal(segments[2].acceptedLineIds[0], '176');
    assert.equal(segments[4].acceptedLineIds[0], 'southeastern');
});

test('through-service and transfer timing use line, interchange and scheduled times', () => {
    const [first, second] = Guidance.buildJourneyGuidance([
        railLeg({ isThroughService: true, arrivalPoint: { commonName: 'Oxford Circus', naptanId: 'OXC' }, routeOptions: [{ id: 'victoria', name: 'Victoria', directions: ['Walthamstow Central'] }] }),
        railLeg({ departureTime: '2026-08-07T08:25:00.000Z', departurePoint: { commonName: 'Oxford Circus', naptanId: 'OXC' }, routeOptions: [{ id: 'victoria', name: 'Victoria', directions: ['Walthamstow Central'] }] })
    ]).segments;
    assert.equal(Guidance.isThroughService(first, second), true);
    assert.equal(Guidance.transferMinutes(first, second), 0);

    const transfer = Object.assign({}, second, { acceptedLineIds: ['central'], lines: [{ id: 'central', name: 'Central' }] });
    assert.equal(Guidance.isThroughService(first, transfer), false);
    assert.equal(Guidance.transferMinutes(first, transfer), 5);
});

test('same operator, interchange and direction do not imply the same vehicle', () => {
    const [first, second] = Guidance.buildJourneyGuidance([
        railLeg({
            mode: { id: 'national-rail' },
            arrivalPoint: { commonName: 'London Bridge Rail Station', naptanId: 'LBG' },
            routeOptions: [{ id: 'southeastern', name: 'Southeastern', directions: ['London Victoria'] }]
        }),
        railLeg({
            mode: { id: 'national-rail' },
            departureTime: '2026-08-07T08:25:00.000Z',
            departurePoint: { commonName: 'London Bridge Rail Station', naptanId: 'LBG' },
            routeOptions: [{ id: 'southeastern', name: 'Southeastern', directions: ['London Victoria'] }]
        })
    ]).segments;
    assert.equal(Guidance.isThroughService(first, second), false);
    assert.equal(Guidance.transferMinutes(first, second), 5);
});

test('normalizeTflDepartures rejects wrong direction, departed and cancelled records, and de-duplicates services', () => {
    const segment = Guidance.buildJourneyGuidance([railLeg()]).segments[0];
    const departures = Guidance.normalizeTflDepartures([
        { lineId: 'victoria', lineName: 'Victoria', destinationName: 'Walthamstow Central', towards: 'Walthamstow Central', vehicleId: 'A', expectedArrival: '2026-08-07T08:10:00.000Z', platformName: '2' },
        { lineId: 'victoria', lineName: 'Victoria', destinationName: 'Walthamstow Central', vehicleId: 'A', expectedArrival: '2026-08-07T08:11:00.000Z' },
        { lineId: 'victoria', destinationName: 'Walthamstow Central', vehicleId: 'too-early', expectedArrival: '2026-08-07T08:05:00.000Z' },
        { lineId: 'victoria', destinationName: 'Brixton', vehicleId: 'wrong-direction', expectedArrival: '2026-08-07T08:04:00.000Z' },
        { lineId: 'victoria', destinationName: 'Walthamstow Central', vehicleId: 'cancelled', cancelled: true, expectedArrival: '2026-08-07T08:03:00.000Z' },
        { lineId: 'victoria', destinationName: 'Walthamstow Central', vehicleId: 'departed', expectedArrival: '2026-08-07T07:59:00.000Z' }
    ], segment, NOW);
    assert.equal(departures.length, 1);
    assert.deepEqual(departures[0], {
        serviceId: 'A', lineId: 'victoria', lineName: 'Victoria', destination: 'Walthamstow Central',
        direction: 'Walthamstow Central', expectedTime: '2026-08-07T08:10:00.000Z', minutes: 10, platform: '2', cancelled: false
    });
});

test('normalise accepts timeToStation bus records and missing optional fields safely', () => {
    const segment = Guidance.buildJourneyGuidance([{
        mode: { id: 'bus' }, arrivalPoint: { commonName: 'Tottenham Court Road' }, routeOptions: [{ id: '176', name: '176' }]
    }]).segments[0];
    const departures = Guidance.normalizeTflDepartures([
        null,
        {},
        { lineId: '176', lineName: '176', destinationName: 'Tottenham Court Road', timeToStation: 125 }
    ], segment, NOW);
    assert.equal(departures.length, 1);
    assert.equal(departures[0].minutes, 3);
    assert.equal(departures[0].platform, null);
});

test('isLiveEligible only accepts future departures inside the requested window', () => {
    assert.equal(Guidance.isLiveEligible('2026-08-07T08:30:00.000Z', NOW), true);
    assert.equal(Guidance.isLiveEligible('2026-08-07T08:30:01.000Z', NOW), false);
    assert.equal(Guidance.isLiveEligible('2026-08-07T07:59:59.000Z', NOW), false);
    assert.equal(Guidance.isLiveEligible('not a date', NOW), false);
    assert.equal(Guidance.isLiveEligible('2026-08-07T08:45:00.000Z', NOW, 45), true);
});

test('National Rail calling patterns only work when the target follows boarding', () => {
    const southbound = [
        { name: 'Canada Water' }, { name: 'Anerley Rail Station' }, { name: 'West Croydon' }
    ];
    const northbound = [
        { name: 'Anerley' }, { name: 'New Cross Gate' }, { name: 'Canada Water Rail Station' }
    ];
    assert.equal(Guidance.isCallingPatternCompatible(southbound, 'Anerley', 'Canada Water'), false);
    assert.equal(Guidance.isCallingPatternCompatible(northbound, 'Anerley Rail Station', 'Canada Water'), true);
    assert.equal(Guidance.isCallingPatternCompatible([], 'Anerley', 'Canada Water'), false);
});

test('normalizeStopLetter cleans TfL stop-letter/indicator shapes and rejects junk', () => {
    assert.equal(Guidance.normalizeStopLetter('->E'), 'E');
    assert.equal(Guidance.normalizeStopLetter('Stop C'), 'C');
    assert.equal(Guidance.normalizeStopLetter('c'), 'C');
    assert.equal(Guidance.normalizeStopLetter('K1'), 'K1');
    assert.equal(Guidance.normalizeStopLetter(''), null);
    assert.equal(Guidance.normalizeStopLetter(null), null);
    assert.equal(Guidance.normalizeStopLetter(undefined), null);
    assert.equal(Guidance.normalizeStopLetter('Platform for the 176 towards Penge'), null);
});

test('formatBusStopCount phrases singular/plural and hides an unusable count', () => {
    assert.equal(Guidance.formatBusStopCount(1), 'Ride 1 stop');
    assert.equal(Guidance.formatBusStopCount(5), 'Ride 5 stops');
    assert.equal(Guidance.formatBusStopCount(0), null);
    assert.equal(Guidance.formatBusStopCount(undefined), null);
    assert.equal(Guidance.formatBusStopCount('not a number'), null);
});

test('directionLabel surfaces towards-text and suppresses it when redundant with the destination', () => {
    assert.equal(Guidance.directionLabel('Brixton', 'Oxford Circus'), 'towards Brixton');
    assert.equal(Guidance.directionLabel('Brixton Underground Station', 'Brixton'), null);
    assert.equal(Guidance.directionLabel('', 'Brixton'), null);
    assert.equal(Guidance.directionLabel(null, 'Brixton'), null);
});

test('currentLegIndex picks the first not-yet-arrived leg and clamps to the last leg', () => {
    const segments = Guidance.buildJourneyGuidance([
        railLeg({ departureTime: '2026-08-07T08:00:00.000Z', arrivalTime: '2026-08-07T08:10:00.000Z' }),
        railLeg({ departureTime: '2026-08-07T08:15:00.000Z', arrivalTime: '2026-08-07T08:30:00.000Z' })
    ]).segments;
    assert.equal(Guidance.currentLegIndex(segments, Date.parse('2026-08-07T07:55:00.000Z')), 0);
    assert.equal(Guidance.currentLegIndex(segments, Date.parse('2026-08-07T08:05:00.000Z')), 0);
    assert.equal(Guidance.currentLegIndex(segments, Date.parse('2026-08-07T08:20:00.000Z')), 1);
    assert.equal(Guidance.currentLegIndex(segments, Date.parse('2026-08-07T08:45:00.000Z')), 1);
    assert.equal(Guidance.currentLegIndex([], NOW), 0);
});

test('minutesUntilAlight counts down to the arrival time and never goes negative', () => {
    const segment = Guidance.buildJourneyGuidance([railLeg()]).segments[0];
    assert.equal(Guidance.minutesUntilAlight(segment, Date.parse('2026-08-07T08:15:00.000Z')), 5);
    assert.equal(Guidance.minutesUntilAlight(segment, Date.parse('2026-08-07T08:25:00.000Z')), 0);
    assert.equal(Guidance.minutesUntilAlight({ arrivalTime: null }, NOW), null);
});

test('stopsRemaining scales down by elapsed time and falls back to the full count without timing', () => {
    const segment = Guidance.buildJourneyGuidance([railLeg()]).segments[0]; // 08:10-08:20, 3 stops
    assert.equal(Guidance.stopsRemaining(segment, Date.parse('2026-08-07T08:10:00.000Z')), 3);
    assert.equal(Guidance.stopsRemaining(segment, Date.parse('2026-08-07T08:15:00.000Z')), 2);
    assert.equal(Guidance.stopsRemaining(segment, Date.parse('2026-08-07T08:20:00.000Z')), 0);
    assert.equal(Guidance.stopsRemaining({ stopCount: 4 }, NOW), 4);
    assert.equal(Guidance.stopsRemaining({ stopCount: 0 }, NOW), null);
});

test('shouldFireAlightAlert fires once per leg at the threshold and never repeats for the same index', () => {
    const segment = Guidance.buildJourneyGuidance([railLeg()]).segments[0]; // arrives 08:20
    assert.equal(Guidance.shouldFireAlightAlert(segment, 0, Date.parse('2026-08-07T08:10:00.000Z'), null), false);
    assert.equal(Guidance.shouldFireAlightAlert(segment, 0, Date.parse('2026-08-07T08:18:30.000Z'), null), true);
    assert.equal(Guidance.shouldFireAlightAlert(segment, 0, Date.parse('2026-08-07T08:19:00.000Z'), 0), false);
    assert.equal(Guidance.shouldFireAlightAlert({ arrivalTime: null }, 0, NOW, null), false);
});

test('the module is exposed on globalThis for browser use', () => {
    assert.equal(globalThis.JourneyGuidance, Guidance);
});

// ---- Defect 4: currentLegIndex must not stall on a leg with a missing or
// unparseable arrivalTime — it should skip that leg and keep progressing. ----

test('currentLegIndex skips past a leg with missing/null/malformed arrivalTime instead of stalling', () => {
    const segments = Guidance.buildJourneyGuidance([
        railLeg({ departureTime: '2026-08-07T08:00:00.000Z', arrivalTime: null }),
        railLeg({ departureTime: '2026-08-07T08:15:00.000Z', arrivalTime: 'not-a-date' }),
        railLeg({ departureTime: '2026-08-07T08:30:00.000Z', arrivalTime: '2026-08-07T08:45:00.000Z' })
    ]).segments;
    // Both bad-time legs are treated as already passed — the search lands on
    // leg 2, the first (only) leg with a usable, still-future arrival time.
    assert.equal(Guidance.currentLegIndex(segments, Date.parse('2026-08-07T08:35:00.000Z')), 2);
    assert.equal(Guidance.currentLegIndex(segments, Date.parse('2026-08-07T08:50:00.000Z')), 2);
    // minutesUntilAlight/stopsRemaining still return null/fallback for the bad legs
    // — the fix must not regress those.
    assert.equal(Guidance.minutesUntilAlight(segments[0], NOW), null);
    assert.equal(Guidance.minutesUntilAlight(segments[1], NOW), null);
});

test('currentLegIndex still advances through a run of entirely unusable arrival times', () => {
    const segments = Guidance.buildJourneyGuidance([
        railLeg({ arrivalTime: undefined }),
        railLeg({ arrivalTime: '' }),
        railLeg({ arrivalTime: 'garbage' })
    ]).segments;
    // No leg has a usable time — falls through to the last leg rather than
    // freezing on leg 0 forever.
    assert.equal(Guidance.currentLegIndex(segments, NOW), 2);
});

test('currentLegIndex handles a departure far in the future (timeIs=Departing use case)', () => {
    const segments = Guidance.buildJourneyGuidance([
        railLeg({ departureTime: '2026-08-07T18:00:00.000Z', arrivalTime: '2026-08-07T18:10:00.000Z' }),
        railLeg({ departureTime: '2026-08-07T18:15:00.000Z', arrivalTime: '2026-08-07T18:30:00.000Z' })
    ]).segments;
    assert.equal(Guidance.currentLegIndex(segments, NOW), 0); // NOW is 08:00, hours before departure
});

test('currentLegIndex handles an overnight journey crossing midnight', () => {
    const segments = Guidance.buildJourneyGuidance([
        railLeg({ departureTime: '2026-08-07T23:50:00.000Z', arrivalTime: '2026-08-08T00:15:00.000Z' }),
        railLeg({ departureTime: '2026-08-08T00:20:00.000Z', arrivalTime: '2026-08-08T00:40:00.000Z' })
    ]).segments;
    assert.equal(Guidance.currentLegIndex(segments, Date.parse('2026-08-07T23:55:00.000Z')), 0);
    assert.equal(Guidance.currentLegIndex(segments, Date.parse('2026-08-08T00:16:00.000Z')), 1);
    assert.equal(Guidance.currentLegIndex(segments, Date.parse('2026-08-08T00:41:00.000Z')), 1);
});

test('currentLegIndex on an exact leg-boundary timestamp', () => {
    const segments = Guidance.buildJourneyGuidance([
        railLeg({ departureTime: '2026-08-07T08:00:00.000Z', arrivalTime: '2026-08-07T08:10:00.000Z' }),
        railLeg({ departureTime: '2026-08-07T08:15:00.000Z', arrivalTime: '2026-08-07T08:30:00.000Z' })
    ]).segments;
    // nowMs exactly equal to leg 0's arrival: arrival > now is false, so leg 0
    // is considered passed and the search moves to leg 1.
    assert.equal(Guidance.currentLegIndex(segments, Date.parse('2026-08-07T08:10:00.000Z')), 1);
    // nowMs exactly equal to leg 1's departure: leg 1's own arrival (08:30) is
    // still in the future, so leg 1 is current.
    assert.equal(Guidance.currentLegIndex(segments, Date.parse('2026-08-07T08:15:00.000Z')), 1);
});

test('currentLegIndex clamps before first departure and after final arrival', () => {
    const segments = Guidance.buildJourneyGuidance([
        railLeg({ departureTime: '2026-08-07T08:00:00.000Z', arrivalTime: '2026-08-07T08:10:00.000Z' }),
        railLeg({ departureTime: '2026-08-07T08:15:00.000Z', arrivalTime: '2026-08-07T08:30:00.000Z' })
    ]).segments;
    assert.equal(Guidance.currentLegIndex(segments, Date.parse('2026-08-07T07:00:00.000Z')), 0); // well before departure
    assert.equal(Guidance.currentLegIndex(segments, Date.parse('2026-08-07T09:00:00.000Z')), 1);  // well after arrival
});

test('stopsRemaining sweep across an increasing time range is monotonic non-increasing, never negative, never fractional', () => {
    const segment = Guidance.buildJourneyGuidance([railLeg({
        departureTime: '2026-08-07T08:00:00.000Z',
        arrivalTime: '2026-08-07T08:20:00.000Z',
        path: { stopPoints: [{}, {}, {}, {}, {}, {}, {}] } // 7 stops
    })]).segments[0];
    const start = Date.parse('2026-08-07T07:50:00.000Z');
    const end = Date.parse('2026-08-07T08:30:00.000Z');
    let previous = Infinity;
    for (let t = start; t <= end; t += 60000) {
        const remaining = Guidance.stopsRemaining(segment, t);
        assert.equal(Number.isInteger(remaining), true, `expected an integer at t=${new Date(t).toISOString()}`);
        assert.equal(remaining >= 0, true, `expected non-negative at t=${new Date(t).toISOString()}`);
        assert.equal(remaining <= previous, true, `expected non-increasing at t=${new Date(t).toISOString()}`);
        previous = remaining;
    }
    assert.equal(previous, 0); // by the time we reach/pass arrival, no stops remain
});

// ---- Defect 2: alert-firing must be driven by the time-derived leg, never a
// manually previewed/displayed leg. ----

test('resolveLiveAlert always evaluates the time-derived leg, ignoring any display/override index', () => {
    const segments = Guidance.buildJourneyGuidance([
        railLeg({ departureTime: '2026-08-07T08:00:00.000Z', arrivalTime: '2026-08-07T08:10:00.000Z' }),
        railLeg({ departureTime: '2026-08-07T08:15:00.000Z', arrivalTime: '2026-08-07T08:30:00.000Z' })
    ]).segments;
    // At 08:28 the rider is genuinely on leg 1, 2 minutes from alighting —
    // resolveLiveAlert must fire for leg 1 regardless of what a caller might be
    // displaying (e.g. a manual preview pinned back on leg 0).
    const now = Date.parse('2026-08-07T08:28:00.000Z');
    const result = Guidance.resolveLiveAlert(segments, now, null, 2);
    assert.equal(result.index, 1);
    assert.equal(result.shouldFire, true);
    assert.equal(result.segment, segments[1]);
});

test('resolveLiveAlert does not fire early for a leg not yet boarded, even if it were the displayed leg', () => {
    const segments = Guidance.buildJourneyGuidance([
        railLeg({ departureTime: '2026-08-07T08:00:00.000Z', arrivalTime: '2026-08-07T08:10:00.000Z' }),
        railLeg({ departureTime: '2026-08-07T08:15:00.000Z', arrivalTime: '2026-08-07T08:30:00.000Z' })
    ]).segments;
    // Still on leg 0 (08:05) — even though a UI could be previewing leg 1
    // (2 minutes from ITS arrival would look alert-worthy in isolation),
    // resolveLiveAlert must resolve/alert off leg 0 (currentLegIndex), which
    // is not yet within its own threshold.
    const now = Date.parse('2026-08-07T08:05:00.000Z');
    const result = Guidance.resolveLiveAlert(segments, now, null, 2);
    assert.equal(result.index, 0);
    assert.equal(result.shouldFire, false);
});

test('resolveLiveAlert respects idempotency (lastAlertedIndex) the same as shouldFireAlightAlert', () => {
    const segments = Guidance.buildJourneyGuidance([railLeg()]).segments; // arrives 08:20
    const now = Date.parse('2026-08-07T08:18:30.000Z');
    const first = Guidance.resolveLiveAlert(segments, now, null, 2);
    assert.equal(first.shouldFire, true);
    const second = Guidance.resolveLiveAlert(segments, now, first.index, 2);
    assert.equal(second.shouldFire, false);
});
