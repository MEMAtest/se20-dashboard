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

test('the module is exposed on globalThis for browser use', () => {
    assert.equal(globalThis.JourneyGuidance, Guidance);
});
