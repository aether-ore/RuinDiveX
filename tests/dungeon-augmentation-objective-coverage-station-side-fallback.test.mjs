import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inspectObjectiveCoverageStationSideOperationContract,
  objectiveCoverageGrantForOperationStationSide,
  objectiveCoverageGrantForStationSideSearchVariant,
} from '../src/dungeon-augmentation/objectiveCoverageStationSide.js';
import {
  computeDungeonAugmentationPlanHash,
} from '../src/dungeon-augmentation/validation.js';

function stationDiagnostic(z, { blocked = false } = {}) {
  return {
    selectedSideSign: -1,
    candidates: [{
      sideSign: -1,
      facing: { x: 1, y: 0, z: 0 },
      stationEligible: true,
      stationBodyBlocked: false,
      fullRoomBodyBlocked: false,
      approachIntersectsOwnCenterline: false,
      hardRouteOverlapArea: 0,
      roomOverlapArea: 0,
      ownRouteOverlapArea: 0,
      authoredScore: 0,
      fullRoomWitness: {
        center: { x: 16.8, z },
        continuationCenter: { x: 30.8, z },
        continuationRoute: [{ x: 25.2, z }, { x: 30.8, z }],
      },
    }, {
      sideSign: 1,
      facing: { x: -1, y: 0, z: 0 },
      stationEligible: true,
      stationBodyBlocked: blocked,
      fullRoomBodyBlocked: false,
      approachIntersectsOwnCenterline: false,
      hardRouteOverlapArea: 0,
      roomOverlapArea: 0,
      ownRouteOverlapArea: 0,
      authoredScore: 1,
      fullRoomWitness: {
        center: { x: -16.8, z },
        continuationCenter: { x: -30.8, z },
        continuationRoute: [{ x: -25.2, z }, { x: -30.8, z }],
      },
    }],
  };
}

function coverageGrant({ blockedSecondAlternative = false } = {}) {
  const endpointSockets = [0, 16.8].map((z, endpointOrdinal) => ({
    id: `fixture:socket:${endpointOrdinal}`,
    sourceCenterlinePosition: { x: 0, y: 0, z },
    position: { x: 4.2, y: 0, z },
    facing: { x: 1, y: 0, z: 0 },
    planningModuleCenter: { x: 16.8, y: 0, z },
    planningContinuationCenter: { x: 30.8, y: 0, z },
    planningContinuationRoute: [{ x: 25.2, y: 0, z }, { x: 30.8, y: 0, z }],
  }));
  return {
    id: 'fixture:coverage',
    kind: 'objective-route-coverage',
    endpointSockets,
    socketLandingOverlapGrants: endpointSockets.map((endpoint) => ({
      id: `${endpoint.id}:landing`,
      socketId: endpoint.id,
      center: { ...endpoint.position, y: 1.8 },
      size: { x: 14, y: 3.6, z: 8.4 },
    })),
    socketModuleOverlapGrants: endpointSockets.map((endpoint) => ({
      id: `${endpoint.id}:module`,
      socketId: endpoint.id,
      center: { x: 12.6, y: 4.2, z: endpoint.position.z },
      size: { x: 19.6, y: 8.4, z: 14 },
    })),
    source: {
      planningStationSideDiagnostics: [
        stationDiagnostic(0),
        stationDiagnostic(16.8, { blocked: blockedSecondAlternative }),
      ],
    },
  };
}

test('late objective coverage variants use one complete opposite-side socket tuple', () => {
  const canonical = coverageGrant();
  assert.equal(
    objectiveCoverageGrantForStationSideSearchVariant(canonical, 6),
    canonical,
    'early bounded variants must retain the canonical host tuple',
  );

  const alternate = objectiveCoverageGrantForStationSideSearchVariant(canonical, 7);
  assert.notEqual(alternate, canonical);
  assert.equal(alternate.planningStationSideAlternativeOrdinal, 1);
  assert.deepEqual(alternate.endpointSockets.map(({ position, facing }) => ({
    position,
    facing,
  })), [0, 16.8].map((z) => ({
    position: { x: -4.2, y: 0, z },
    facing: { x: -1, y: 0, z: 0 },
  })));
  assert.deepEqual(
    alternate.endpointSockets.map(({ planningModuleCenter }) => planningModuleCenter),
    [0, 16.8].map((z) => ({ x: -16.8, y: 0, z })),
  );
  assert.deepEqual(
    alternate.socketLandingOverlapGrants.map(({ center }) => center),
    [0, 16.8].map((z) => ({ x: -4.2, y: 1.8, z })),
  );
  assert.deepEqual(
    alternate.socketModuleOverlapGrants.map(({ center }) => ({
      ...center,
      x: Number(center.x.toFixed(6)),
      z: Number(center.z.toFixed(6)),
    })),
    [0, 16.8].map((z) => ({ x: -12.6, y: 4.2, z })),
  );
  assert.deepEqual(
    canonical.endpointSockets.map(({ position }) => position),
    [0, 16.8].map((z) => ({ x: 4.2, y: 0, z })),
    'the canonical host grant remains immutable',
  );
});

test('station-side fallback is all-or-nothing when any opposite endpoint is blocked', () => {
  const canonical = coverageGrant({ blockedSecondAlternative: true });
  assert.equal(
    objectiveCoverageGrantForStationSideSearchVariant(canonical, 7),
    canonical,
  );
});

test('serialized operation ordinal reconstructs the same authoritative station-side grant', () => {
  const canonical = coverageGrant();
  const operation = {
    id: 'fixture:operation',
    type: 'routeNetwork',
    planningStationSideAlternativeOrdinal: 1,
  };
  const plannedGrant = objectiveCoverageGrantForStationSideSearchVariant(canonical, 7);
  const resolvedGrant = objectiveCoverageGrantForOperationStationSide(
    canonical,
    operation,
  );
  assert.deepEqual(resolvedGrant, plannedGrant);
  assert.equal(
    objectiveCoverageGrantForOperationStationSide(resolvedGrant, operation),
    resolvedGrant,
    'consumer-to-consumer grant handoff must not apply the alternate twice',
  );
  assert.equal(
    inspectObjectiveCoverageStationSideOperationContract(
      resolvedGrant,
      operation,
    ).accepted,
    true,
  );
  assert.equal(
    inspectObjectiveCoverageStationSideOperationContract(canonical, operation).accepted,
    true,
  );

  const canonicalHash = computeDungeonAugmentationPlanHash({
    operations: [{ id: operation.id, type: operation.type }],
  });
  const alternateHash = computeDungeonAugmentationPlanHash({ operations: [operation] });
  assert.notEqual(alternateHash, canonicalHash, 'the selected side must affect the plan hash');
});

test('serialized operation rejects unsupported or unavailable station-side ordinals', () => {
  const canonical = coverageGrant({ blockedSecondAlternative: true });
  const unavailable = inspectObjectiveCoverageStationSideOperationContract(canonical, {
    planningStationSideAlternativeOrdinal: 1,
  });
  assert.equal(unavailable.accepted, false);
  assert.equal(unavailable.reason, 'alternative-station-side-unavailable');

  const unsupported = inspectObjectiveCoverageStationSideOperationContract(
    coverageGrant(),
    { planningStationSideAlternativeOrdinal: 2 },
  );
  assert.equal(unsupported.accepted, false);
  assert.equal(unsupported.reason, 'alternative-ordinal-unsupported');
});
