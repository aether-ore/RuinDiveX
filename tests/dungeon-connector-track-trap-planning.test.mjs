import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDungeonConnectorTrackTrapGlobalExclusions,
  DUNGEON_CONNECTOR_TRACK_TRAP_PLANNING_DEFAULTS,
  planDungeonConnectorTrackTraps,
} from '../src/DungeonConnectorTrackTrapPlanning.js';

function makeElevationPlan(index, overrides = {}) {
  return {
    id: `connection-${index}`,
    logicalConnectionId: `room-${index}_room-${index + 1}`,
    fromRoomId: `room-${index}`,
    toRoomId: `room-${index + 1}`,
    sourceElevation: index * 14,
    destinationElevation: (index + 1) * 14,
    elevationDelta: 14,
    direction: 'ascending',
    connectorVariantId: ['crested_slope_v1', 'ladder_gallery_v1', 'automatic_lift_gallery_v1'][index % 3],
    connectorVariant: {
      elevationChange: true,
      variantId: ['crested_slope_v1', 'ladder_gallery_v1', 'automatic_lift_gallery_v1'][index % 3],
      direction: 'ascending',
      occupiedVolumes: [],
      landings: [],
      apertures: [],
    },
    ...overrides,
  };
}

function makeBay(id, longitudinalIndex, overrides = {}) {
  return {
    id,
    flat: true,
    surfaceKind: 'flat_gallery',
    clearanceVerified: true,
    center: { x: longitudinalIndex * 2.8, y: 0, z: 0 },
    floorElevation: 0,
    ceilingY: 8.315572557081793,
    longitudinalIndex,
    longitudinalDirection: { x: 1, z: 0 },
    galleryWidthMeters: 8.4,
    ...overrides,
  };
}

function candidatesForPlans(plans) {
  return Object.fromEntries(plans.map((plan, index) => [
    plan.id,
    [makeBay(`${plan.id}:bay`, index * 10)],
  ]));
}

function assertDeepFrozen(value) {
  assert.equal(Object.isFrozen(value), true);
  if (!value || typeof value !== 'object') return;
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') assertDeepFrozen(child);
  }
}

test('selection is deterministic, frozen, capped at 40%, and never consecutive', () => {
  const plans = Array.from({ length: 5 }, (_, index) => makeElevationPlan(index));
  const bayCandidatesByConnectionId = candidatesForPlans(plans);
  const options = { seed: 'track-trap-seed-a', bayCandidatesByConnectionId };
  const first = planDungeonConnectorTrackTraps(plans, options);
  const second = planDungeonConnectorTrackTraps(plans, options);

  assert.deepEqual(first, second);
  assert.equal(first.diagnostics.accepted, true);
  assert.equal(first.diagnostics.selectionCap, 2);
  assert.ok(first.diagnostics.trappedConnectorCount >= 1);
  assert.ok(first.diagnostics.trappedConnectorCount <= 2);
  const selectedIndexes = first.trappedAlternates.map((entry) => entry.connectionPlanIndex);
  for (let index = 1; index < selectedIndexes.length; index += 1) {
    assert.ok(Math.abs(selectedIndexes[index] - selectedIndexes[index - 1]) > 1);
  }
  assertDeepFrozen(first);
  assert.doesNotThrow(() => JSON.stringify(first));
});

test('three elevation connectors guarantee exactly one trapped alternate when a legal bay exists', () => {
  const plans = Array.from({ length: 3 }, (_, index) => makeElevationPlan(index));
  const result = planDungeonConnectorTrackTraps(plans, {
    seed: 'minimum-count',
    bayCandidatesByConnectionId: candidatesForPlans(plans),
  });
  assert.equal(result.diagnostics.selectionCap, 1);
  assert.equal(result.diagnostics.trappedConnectorCount, 1);
  assert.ok(result.connectorTrackTraps.length >= 1 && result.connectorTrackTraps.length <= 3);
});

test('destination approach is preferred and trap bays remain at least three longitudinal tiles apart', () => {
  const plans = Array.from({ length: 3 }, (_, index) => makeElevationPlan(index));
  const candidates = {
    [plans[0].id]: [
      makeBay('source-bay', 4, { side: 'source' }),
      makeBay('destination-bay', 10, { destinationSide: true }),
      makeBay('too-close-to-destination', 12),
      makeBay('middle-bay', 13),
      makeBay('far-bay', 16),
    ],
  };
  const result = planDungeonConnectorTrackTraps(plans, {
    seed: 'destination-first',
    bayCandidatesByConnectionId: candidates,
  });
  assert.equal(result.trappedAlternates.length, 1);
  const traps = result.connectorTrackTraps;
  assert.equal(traps.length, 3);
  assert.equal(traps[0].bayId, 'destination-bay');
  for (let first = 0; first < traps.length; first += 1) {
    for (let second = first + 1; second < traps.length; second += 1) {
      assert.ok(Math.abs(traps[first].longitudinalIndex - traps[second].longitudinalIndex) >= 3);
    }
  }
});

test('descriptors use transverse tracks and floor-specific warning volumes matching the runtime API', () => {
  const plans = Array.from({ length: 3 }, (_, index) => makeElevationPlan(index));
  const bay = makeBay('destination-z-bay', 8, {
    center: { x: 4, y: -14, z: 7 },
    floorElevation: -14,
    ceilingY: -5.684427442918207,
    longitudinalDirection: { x: 0, z: -1 },
    destinationSide: true,
  });
  const result = planDungeonConnectorTrackTraps(plans, {
    seed: 'descriptor-contract',
    bayCandidatesByConnectionId: { [plans[1].id]: [bay] },
  });
  const descriptor = result.connectorTrackTraps[0];
  const trackDelta = {
    x: descriptor.trackEnd.x - descriptor.trackStart.x,
    z: descriptor.trackEnd.z - descriptor.trackStart.z,
  };
  assert.equal(descriptor.schema, 'ruindivex.connector-track-trap/v1');
  assert.equal(descriptor.overlayId, 'rotating_ceiling_track_v1');
  assert.ok(Math.abs(trackDelta.z) < 1e-9, 'track must be transverse to a Z-axis hallway');
  assert.ok(Math.abs(trackDelta.x) > 0);
  assert.equal(descriptor.trackStart.y, bay.ceilingY);
  assert.equal(descriptor.trackEnd.y, bay.ceilingY);
  assert.equal(descriptor.warningVolume.center.y, -14 + 3.15 * 0.5);
  assert.equal(descriptor.warningVolume.halfSize.y, 3.15 * 0.5);
  assert.deepEqual(descriptor.contactOffsetMeters, { x: 0, y: -6.165572557081793, z: 0 });
  assert.equal(descriptor.patrolSpeedMetersPerSecond, 0.7);
  assert.equal(descriptor.alertSpeedMetersPerSecond, 3.2);
  assert.equal(descriptor.spinRadiansPerSecond, 3.2);
  assert.equal(descriptor.damage, 12);
  assert.equal(descriptor.reactionTier, 2);
  assert.equal(descriptor.pushStrength, 0.72);
  assert.equal(descriptor.rearmSeconds, 0.8);
});

test('the shared overlay preserves every ascending and descending connector family contract', () => {
  const families = [
    'crested_slope_v1',
    'ladder_gallery_v1',
    'automatic_lift_gallery_v1',
  ];
  for (const family of families) {
    for (const direction of ['ascending', 'descending']) {
      const elevationDelta = direction === 'ascending' ? 14 : -14;
      const target = makeElevationPlan(0, {
        id: `${family}:${direction}`,
        sourceElevation: 0,
        destinationElevation: elevationDelta,
        elevationDelta,
        direction,
        connectorVariantId: family,
        connectorVariant: {
          elevationChange: true,
          variantId: family,
          direction,
          occupiedVolumes: [],
          landings: [],
          apertures: [],
        },
      });
      const plans = [target, makeElevationPlan(1), makeElevationPlan(2)];
      const result = planDungeonConnectorTrackTraps(plans, {
        seed: `six-way-overlay:${family}:${direction}`,
        bayCandidatesByConnectionId: {
          [target.id]: [makeBay(`${target.id}:bay`, 8, {
            destinationSide: true,
          })],
        },
      });
      assert.equal(result.diagnostics.accepted, true);
      assert.equal(result.connectorTrackTraps.length, 1);
      assert.equal(result.connectorTrackTraps[0].connectorVariantId, family);
      assert.equal(result.connectorTrackTraps[0].connectorDirection, direction);
      assert.equal(result.connectorTrackTraps[0].overlayId, 'rotating_ceiling_track_v1');
    }
  }
});

test('forbidden authored tags, explicit overlaps, unverified bays, and occupied volumes are rejected', () => {
  const plans = Array.from({ length: 3 }, (_, index) => makeElevationPlan(index));
  const candidates = [];
  for (const tag of DUNGEON_CONNECTOR_TRACK_TRAP_PLANNING_DEFAULTS.forbiddenBayTags) {
    candidates.push(makeBay(`forbidden-${tag}`, candidates.length * 4, { exclusionTags: [tag] }));
  }
  candidates.push(makeBay('not-flat', 100, { flat: false, surfaceKind: 'uneven' }));
  candidates.push(makeBay('not-verified', 104, {
    clearanceVerified: false,
    clearOfExclusions: false,
  }));
  candidates.push(makeBay('explicit-overlap', 108, { overlapsControl: true }));
  candidates.push(makeBay('volume-overlap', 112, {
    center: { x: 0, y: 0, z: 0 },
  }));
  candidates.push(makeBay('only-legal-bay', 116, {
    center: { x: 80, y: 0, z: 0 },
    destinationSide: true,
  }));

  const result = planDungeonConnectorTrackTraps(plans, {
    seed: 'exclusion-audit',
    bayCandidatesByConnectionId: { [plans[0].id]: candidates },
    extraExclusionVolumesByConnectionId: {
      [plans[0].id]: [{
        id: 'authored-control-clearance',
        center: { x: 0, y: 4, z: 0 },
        size: { x: 8, y: 8, z: 8 },
      }],
    },
  });
  assert.ok(result.connectorTrackTraps.some((trap) => trap.bayId === 'only-legal-bay'));
  assert.ok(!result.connectorTrackTraps.some((trap) => trap.bayId !== 'only-legal-bay'));
  const rejectedIds = new Set(result.diagnostics.candidateRejections.map((entry) => entry.bayId));
  for (const candidate of candidates.filter((entry) => entry.id !== 'only-legal-bay')) {
    assert.equal(rejectedIds.has(candidate.id), true, `${candidate.id} should be rejected`);
  }
});

test('ordinary walkable-lane clearance permits the intended hazard while reserved mechanism clearance rejects it', () => {
  const guardedPlan = makeElevationPlan(0, {
    clearanceVolumes: [
      {
        id: 'ordinary-flat-gallery-player-envelope',
        purpose: 'walkable_connector_player_clearance',
        center: { x: 0, y: 1.8, z: 0 },
        size: { x: 8.4, y: 3.6, z: 8.4 },
      },
      {
        id: 'reserved-lift-control-envelope',
        purpose: 'lift_control_clearance',
        center: { x: 56, y: 1.8, z: 0 },
        size: { x: 8.4, y: 3.6, z: 8.4 },
      },
    ],
  });
  const plans = [guardedPlan, makeElevationPlan(1), makeElevationPlan(2)];
  const result = planDungeonConnectorTrackTraps(plans, {
    seed: 'walkable-lane-versus-reserved-clearance',
    bayCandidatesByConnectionId: {
      [guardedPlan.id]: [
        makeBay('ordinary-lane-bay', 0, { destinationSide: true }),
        makeBay('reserved-control-bay', 20),
      ],
    },
  });

  assert.equal(result.connectorTrackTraps.length, 1);
  assert.equal(result.connectorTrackTraps[0].bayId, 'ordinary-lane-bay');
  const reservedRejection = result.diagnostics.candidateRejections.find((entry) => (
    entry.bayId === 'reserved-control-bay'
  ));
  assert.ok(reservedRejection?.reasons.includes(
    'occupied-volume-overlap:reserved-lift-control-envelope',
  ));
});

test('global room, connector structure, and required-clearance volumes reject trap sweeps', () => {
  const guardedPlan = makeElevationPlan(0);
  const neighboringPlan = makeElevationPlan(1, {
    occupiedStructuralVolumes: [{
      id: 'neighbor-support',
      center: { x: 56, y: 4, z: 0 },
      size: { x: 8.4, y: 8, z: 8.4 },
    }],
    clearanceVolumes: [{
      id: 'neighbor-required-clearance',
      purpose: 'lift_control_clearance',
      center: { x: 84, y: 4, z: 0 },
      size: { x: 8.4, y: 8, z: 8.4 },
    }],
  });
  const plans = [guardedPlan, neighboringPlan, makeElevationPlan(2)];
  const rooms = [{
    id: 'global-room',
    x: 0,
    z: 0,
    width: 5,
    depth: 5,
    minY: 0,
    maxY: 12,
  }];
  const exclusions = createDungeonConnectorTrackTrapGlobalExclusions(plans, rooms);
  const result = planDungeonConnectorTrackTraps(plans, {
    seed: 'global-trap-exclusion-audit',
    extraExclusionVolumesByConnectionId: exclusions,
    bayCandidatesByConnectionId: {
      [guardedPlan.id]: [
        makeBay('room-overlap', 0, { center: { x: 0, y: 0, z: 0 } }),
        makeBay('connector-structure-overlap', 20, { center: { x: 56, y: 0, z: 0 } }),
        makeBay('required-clearance-overlap', 30, { center: { x: 84, y: 0, z: 0 } }),
        makeBay('globally-clear', 50, {
          center: { x: 140, y: 0, z: 0 },
          destinationSide: true,
        }),
      ],
    },
  });

  assert.equal(result.connectorTrackTraps.length, 1);
  assert.equal(result.connectorTrackTraps[0].bayId, 'globally-clear');
  const rejectionByBayId = new Map(result.diagnostics.candidateRejections.map((entry) => [
    entry.bayId,
    entry.reasons,
  ]));
  assert.ok(rejectionByBayId.get('room-overlap')?.some((reason) => (
    reason.includes('global-room-volume:global-room')
  )));
  assert.ok(rejectionByBayId.get('connector-structure-overlap')?.some((reason) => (
    reason.includes('global-connector-volume:connection-1:neighbor-support')
  )));
  assert.ok(rejectionByBayId.get('required-clearance-overlap')?.some((reason) => (
    reason.includes('global-connector-volume:connection-1:neighbor-required-clearance')
  )));
  assert.ok(result.diagnostics.globalExclusionVolumeCountByConnectionId[guardedPlan.id] >= 3);
  assert.deepEqual(
    result.diagnostics.selectedTrapExclusionChecks.map((check) => check.accepted),
    [true],
  );
});

test('explicit non-transverse tracks and same-elevation service galleries cannot be selected', () => {
  const plans = Array.from({ length: 3 }, (_, index) => makeElevationPlan(index));
  const service = makeElevationPlan(3, {
    id: 'level-service',
    sourceElevation: 14,
    destinationElevation: 14,
    elevationDelta: 0,
    direction: 'level',
    connectorVariantId: 'service_gallery_v1',
    connectorVariant: { elevationChange: false, variantId: 'service_gallery_v1' },
  });
  plans.push(service);
  const invalidTrack = makeBay('parallel-track', 20, {
    trackStart: { x: 0, y: 8.315572557081793, z: 0 },
    trackEnd: { x: 8, y: 8.315572557081793, z: 0 },
    longitudinalDirection: { x: 1, z: 0 },
  });
  const result = planDungeonConnectorTrackTraps(plans, {
    seed: 'non-elevation-filter',
    bayCandidatesByConnectionId: {
      [plans[0].id]: [invalidTrack],
      [plans[1].id]: [makeBay('legal-elevation', 30)],
      [service.id]: [makeBay('illegal-service-trap', 40)],
    },
  });
  assert.ok(result.connectorTrackTraps.some((trap) => trap.bayId === 'legal-elevation'));
  assert.ok(!result.connectorTrackTraps.some((trap) => trap.bayId === 'parallel-track'));
  assert.ok(!result.connectorTrackTraps.some((trap) => trap.bayId === 'illegal-service-trap'));
  assert.equal(result.diagnostics.elevationConnectorCount, 3);
});

test('non-adjacent array entries that share a graph room are treated as consecutive edges', () => {
  const plans = [
    makeElevationPlan(0, { id: 'edge-a', fromRoomId: 'a', toRoomId: 'shared' }),
    makeElevationPlan(1, { id: 'spacer', fromRoomId: 'other-a', toRoomId: 'other-b' }),
    makeElevationPlan(2, { id: 'edge-b', fromRoomId: 'shared', toRoomId: 'b' }),
    makeElevationPlan(3, { id: 'no-bay-a' }),
    makeElevationPlan(4, { id: 'no-bay-b' }),
  ];
  const result = planDungeonConnectorTrackTraps(plans, {
    seed: 'shared-room',
    bayCandidatesByConnectionId: {
      'edge-a': [makeBay('edge-a-bay', 0)],
      'edge-b': [makeBay('edge-b-bay', 20)],
    },
  });
  assert.equal(result.diagnostics.selectionCap, 2);
  assert.equal(result.diagnostics.trappedConnectorCount, 1);
});

test('no legal bay means no trapped alternate and does not invent a primitive fallback', () => {
  const plans = Array.from({ length: 3 }, (_, index) => makeElevationPlan(index));
  const result = planDungeonConnectorTrackTraps(plans, {
    seed: 'no-fallback',
    bayCandidatesByConnectionId: {
      [plans[0].id]: [makeBay('blocked', 0, { overlapsLanding: true })],
    },
  });
  assert.deepEqual(result.connectorTrackTraps, []);
  assert.deepEqual(result.trappedAlternates, []);
  assert.equal(result.diagnostics.accepted, true);
  assert.equal(result.diagnostics.legalConnectorCount, 0);
});
