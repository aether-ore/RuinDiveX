import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPublicStrictGroundForward,
  applyPublicSteeringTurn,
  getRaisedCombatLaneAction,
  getPublicSteeringForwardBurst,
  getPublicSteeringTurnAction,
  holdPublicInputsForOneHeartbeat,
  tapPublicInputBurst,
  getPublicCombatAimAction,
  getPublicActionApproachPoints,
  getPreRaisedGroundClearanceAction,
  getTraversalLinkApproachWaypoints,
  hasClearedAuthoredApproachIngress,
  hasClearedAuthoredPortalIngress,
  publicCombatLaneNeedsClearance,
  publicCombatShouldTakeRaisedRoute,
  publicCombatTraversalRequiresLockRelease,
  publicPortalSettlingIsAccepted,
  resolveAutomaticSurfaceLandingContracts,
  resolvePublicGateApproachLink,
  publicSteeringEndpointReached,
  publicSteeringNeedsQuantizedTurnAdvance,
  publicSteeringSweepReachedTarget,
  selectPlanOwnedPortalIngressSettleTarget,
  selectPlanOwnedGroundEngagementAdvance,
  selectRaisedCombatTraversalLink,
  selectEncounterCombatTarget,
} from '../helpers/journey-runtime.mjs';

function enemy(id, encounterId, x, y, z, health) {
  return { id, encounterId, position: { x, y, z }, health };
}

test('either-side pickup approach stays on the player side of blocking presentation', () => {
  const action = {
    position: { x: -58, y: 0.35, z: 44 },
    forward: { x: 0, y: 0, z: 1 },
    activationSide: 'either',
    radius: 2.2,
  };
  const fromSpawn = getPublicActionApproachPoints(action, { x: -55, y: 0.35, z: 40 });
  assert.equal(fromSpawn.eitherSide, true);
  assert.ok(fromSpawn.approach.x > action.position.x);
  assert.ok(fromSpawn.approach.z < action.position.z,
    'the route must not cross through the cabinet to reach its positive-forward side');
  assert.ok(Math.hypot(
    fromSpawn.approach.x - action.position.x,
    fromSpawn.approach.z - action.position.z,
  ) <= 1.151);

  const frontOnly = getPublicActionApproachPoints({
    ...action,
    activationSide: 'front',
  }, { x: -55, y: 0.35, z: 40 });
  assert.equal(frontOnly.eitherSide, false);
  assert.equal(frontOnly.approach.x, action.position.x);
  assert.ok(frontOnly.approach.z > action.position.z,
    'a one-sided action must preserve its authored activation side');

  const vectorFacing = getPublicActionApproachPoints({
    ...action,
    forward: { x: 0, y: 0, z: 1 },
    activationSide: { x: -1, y: 0, z: 0 },
  }, { x: -55, y: 0.35, z: 40 });
  assert.equal(vectorFacing.eitherSide, false);
  assert.ok(vectorFacing.approach.x < action.position.x,
    'a serialized vector activation side must override the anchor forward vector');
  assert.equal(vectorFacing.approach.z, action.position.z);
});

test('gate approach resolution selects the authored room-side route instead of its connector', () => {
  const portal = {
    id: 'portal.security-sorting-alpha',
    from: { regionId: 'security', surfaceId: 'surface.security.alpha-landing' },
  };
  const navigation = {
    traversalLinks: [
      {
        id: 'traversal.canonical.security-sorting-alpha.from-endpoint',
        portalId: portal.id,
        regionId: 'security',
        fromSurfaceId: 'surface.security.alpha-landing',
        toSurfaceId: 'surface.connector.alpha.0',
        mode: 'walk',
        bidirectional: true,
      },
      {
        id: 'traversal.placement.security.alpha-stairs',
        regionId: 'security',
        fromSurfaceId: 'surface.security.main',
        toSurfaceId: 'surface.security.alpha-landing',
        mode: 'walkable-stairs',
        bidirectional: true,
      },
    ],
  };
  assert.deepEqual(resolvePublicGateApproachLink(navigation, portal, 'security'), {
    linkId: 'traversal.placement.security.alpha-stairs',
    direction: 'forward',
    endpointSurfaceId: 'surface.security.alpha-landing',
    score: 0,
  });
  assert.equal(resolvePublicGateApproachLink(navigation, portal, 'assembly'), null,
    'a stale semantic source region must fail closed');
});

test('automatic-surface resolution requires two distinct plan-owned useful landings', () => {
  const dynamic = {
    id: 'surface.sorting.moving-cargo',
    regionId: 'sorting',
    bounds: { min: { x: -1, y: 4, z: -1 }, max: { x: 1, y: 4.3, z: 1 } },
  };
  const landing = (id, x) => ({
    id,
    regionId: 'sorting',
    bounds: { min: { x: x - 2, y: 4, z: -2 }, max: { x: x + 2, y: 4.3, z: 2 } },
  });
  const near = landing('surface.sorting.cargo-near', -12);
  const far = landing('surface.sorting.cargo-far', 12);
  const navigation = {
    traversalLinks: [
      {
        id: 'traversal.sorting.cargo-near', mechanismId: 'mechanism.sorting-cargo',
        fromSurface: near, toSurface: dynamic,
      },
      {
        id: 'traversal.sorting.cargo-far', mechanismId: 'mechanism.sorting-cargo',
        fromSurface: dynamic, toSurface: far,
      },
    ],
  };
  const resolved = resolveAutomaticSurfaceLandingContracts(
    navigation,
    'mechanism.sorting-cargo',
    dynamic.id,
    { x: -10, y: 4.3, z: 0 },
  );
  assert.equal(resolved.boarding.surfaceId, near.id);
  assert.deepEqual(resolved.landingSurfaceIds, [near.id, far.id]);
  assert.equal(resolveAutomaticSurfaceLandingContracts({
    traversalLinks: navigation.traversalLinks.slice(0, 1),
  }, 'mechanism.sorting-cargo', dynamic.id, { x: -10, y: 4.3, z: 0 }), null,
  'one landing cannot satisfy a useful automatic moving-platform contract');
});

test('public combat follows the retained target instead of chasing a different nearer enemy', () => {
  const diagnostics = {
    playerPosition: { x: 0, y: 0.35, z: 0 },
    lockOnTargetId: 'enemy-elevated:weak:clawPalm',
    activeEnemies: [
      enemy('enemy-ground', 'encounter.assembly', 1.5, 0.35, 0, 22),
      enemy('enemy-elevated', 'encounter.assembly', 4, 3.5, 0, 31),
      enemy('enemy-unrelated', 'encounter.sorting', 0.5, 0.35, 0, 99),
    ],
  };

  const selection = selectEncounterCombatTarget(
    diagnostics,
    'encounter.assembly',
    'enemy-ground',
  );

  assert.deepEqual(selection.enemies.map(({ id }) => id), ['enemy-ground', 'enemy-elevated']);
  assert.equal(selection.target.enemy.id, 'enemy-elevated');
  assert.equal(selection.totalEnemyHealth, 53);
});

test('pre-lock raised combat intent retains its enemy without overriding a real game lock', () => {
  const diagnostics = {
    playerPosition: { x: 0, y: 4.3, z: 0 },
    lockOnTargetId: null,
    activeEnemies: [
      enemy('enemy-ground', 'encounter.assembly', 1, 0.35, 0, 22),
      enemy('enemy-raised', 'encounter.assembly', 4, 4.3, 0, 31),
    ],
  };
  assert.equal(selectEncounterCombatTarget(
    diagnostics,
    'encounter.assembly',
    'enemy-raised',
  ).target.enemy.id, 'enemy-raised');

  diagnostics.lockOnTargetId = 'enemy-ground:weak:body';
  assert.equal(selectEncounterCombatTarget(
    diagnostics,
    'encounter.assembly',
    'enemy-raised',
  ).target.enemy.id, 'enemy-ground', 'the actual Tab lock must remain authoritative');
});

test('public combat falls back to the nearest encounter-owned enemy when no lock exists', () => {
  const diagnostics = {
    playerPosition: { x: 0, y: 0.35, z: 0 },
    lockOnTargetId: null,
    activeEnemies: [
      enemy('enemy-far', 'encounter.assembly', 7, 0.35, 0, 30),
      enemy('enemy-near', 'encounter.assembly', 3, 0.35, 0, 20),
    ],
  };

  assert.equal(
    selectEncounterCombatTarget(diagnostics, 'encounter.assembly').target.enemy.id,
    'enemy-near',
  );
});

test('public combat clears an encounter-owned ground enemy before committing to occupied stairs', () => {
  const diagnostics = {
    playerPosition: { x: 0, y: 0.35, z: 0 },
    lockOnTargetId: null,
    activeEnemies: [
      enemy('enemy-raised-near', 'encounter.assembly', 4, 4.3, 0, 30),
      enemy('enemy-ground-far', 'encounter.assembly', 7, 0.35, 0, 20),
    ],
  };
  assert.equal(selectEncounterCombatTarget(
    diagnostics,
    'encounter.assembly',
    null,
    { preferGroundBeforeRaisedTraversal: true },
  ).target.enemy.id, 'enemy-ground-far');
  diagnostics.lockOnTargetId = 'enemy-raised-near:weak:eye';
  assert.equal(selectEncounterCombatTarget(
    diagnostics,
    'encounter.assembly',
    null,
    { preferGroundBeforeRaisedTraversal: true },
  ).target.enemy.id, 'enemy-raised-near', 'a real game lock remains authoritative');
});

test('ground clearance holds the proven stair ingress until the enemy enters Buster range', () => {
  const ground = {
    enemy: enemy('enemy-ground', 'encounter.assembly', 8, 0.35, 0, 20),
    horizontalDistance: 8,
    verticalDistance: 0,
  };
  const enemies = [ground.enemy, enemy('enemy-raised', 'encounter.assembly', 4, 4.3, 0, 30)];
  const diagnostics = {
    playerPosition: { x: 0, y: 0.35, z: 0 },
    lockOnTargetId: null,
  };
  assert.equal(getPreRaisedGroundClearanceAction(diagnostics, ground, enemies), 'wait');
  ground.horizontalDistance = 6.6;
  assert.equal(getPreRaisedGroundClearanceAction(diagnostics, ground, enemies), 'lock');
  diagnostics.lockOnTargetId = 'enemy-ground:weak:eye';
  assert.equal(getPreRaisedGroundClearanceAction(diagnostics, ground, enemies), 'fire');
  ground.horizontalDistance = 7.2;
  assert.equal(getPreRaisedGroundClearanceAction(diagnostics, ground, enemies), null,
    'a retained lock outside projectile range must return to public pursuit instead of firing forever');
  assert.equal(getPreRaisedGroundClearanceAction(diagnostics, {
    ...ground,
    verticalDistance: 3.95,
  }, enemies), null);
});

test('ground combat advances only through its exact sampled-clear plan-owned rejoin', () => {
  const navigation = {
    encounters: [{
      encounterId: 'encounter.assembly',
      regionId: 'assembly',
      entryEngagementContracts: [{
        id: 'engagement.assembly.entry-ground',
        spawnPointIndex: 0,
        sourceTraversalLinkId: 'traversal.assembly.landmark-stairs',
        surfaceId: 'surface.assembly.floor-east',
        maximumEngagementRange: 6.7,
        capsuleRadius: 0.46,
        capsuleHeight: 3.2,
        sampleSpacing: 0.21,
        sameLevel: true,
        unobstructed: true,
      }],
    }],
    traversalLinks: [{
      id: 'traversal.assembly.landmark-stairs',
      regionId: 'assembly',
      approachSurfaces: [{
        id: 'surface.assembly.floor-east',
        bounds: {
          min: { x: -79.4, y: 0, z: 24.5 },
          max: { x: -70, y: 0.35, z: 55.5 },
        },
      }],
      approachContract: {
        combatRejoin: {
          id: 'combat-rejoin.assembly.entry-ground',
          encounterId: 'encounter.assembly',
          engagementId: 'engagement.assembly.entry-ground',
          surfaceId: 'surface.assembly.floor-east',
          segmentStart: { x: -71.2, y: 0.35, z: 47 },
          segmentEnd: { x: -75.5, y: 0.35, z: 47 },
          minimumProgress: 0,
          maximumProgress: 1,
          maximumLateralOffset: 0.25,
          capsuleRadius: 0.46,
          capsuleHeight: 3.2,
          sampleSpacing: 0.21,
        },
      },
    }],
  };
  const target = {
    enemy: {
      ...enemy('enemy-ground', 'encounter.assembly', -78.34, 0.35, 44.43, 22),
      planOwnedSpawnPointIndex: 0,
    },
    horizontalDistance: 7.59,
    verticalDistance: 0,
  };
  const input = {
    navigation,
    encounterId: 'encounter.assembly',
    target,
    playerPosition: { x: -71.2, y: 0.35, z: 47 },
  };
  const advance = selectPlanOwnedGroundEngagementAdvance(input);
  assert.ok(advance);
  assert.equal(advance.engagementId, 'engagement.assembly.entry-ground');
  assert.equal(advance.traversalLinkId, 'traversal.assembly.landmark-stairs');
  assert.equal(advance.combatRejoinId, 'combat-rejoin.assembly.entry-ground');
  assert.equal(advance.surfaceId, 'surface.assembly.floor-east');
  assert.ok(Math.hypot(
    target.enemy.position.x - advance.position.x,
    target.enemy.position.z - advance.position.z,
  ) <= 6.45);
  assert.ok(advance.supportSamples.length > 2);
  for (let index = 1; index < advance.supportSamples.length; index += 1) {
    const before = advance.supportSamples[index - 1].position;
    const after = advance.supportSamples[index].position;
    assert.ok(Math.hypot(after.x - before.x, after.z - before.z) <= 0.21 + 1e-6);
  }
  const ingressSettle = selectPlanOwnedPortalIngressSettleTarget({
    navigation,
    portalId: 'portal.security-assembly',
    minimumIngressPoint: { x: -71.2, y: 0.35, z: 47 },
    destinationSurfaceId: 'surface.assembly.floor-east',
  });
  // Bind the fixture's route to the actual ingress portal exactly as runtime
  // navigation does, then prove the target is forward on the same support.
  navigation.traversalLinks[0].approachContract.ingressPortalId = 'portal.security-assembly';
  const boundIngressSettle = selectPlanOwnedPortalIngressSettleTarget({
    navigation,
    portalId: 'portal.security-assembly',
    minimumIngressPoint: { x: -71.2, y: 0.35, z: 47 },
    destinationSurfaceId: 'surface.assembly.floor-east',
  });
  assert.equal(ingressSettle, null, 'a portal target requires an exact ingress-link binding');
  assert.ok(boundIngressSettle);
  assert.deepEqual(boundIngressSettle.position, { x: -72, y: 0.35, z: 47 });
  assert.ok(boundIngressSettle.supportSamples.every((point) => (
    point.x <= -71.2 && point.x >= -72 && point.z === 47
  )));

  const portalIngressContract = {
    boundaryPoint: { x: -70, y: 0.35, z: 47 },
    interiorPoint: { x: -71.2, y: 0.35, z: 47 },
    minimumDepth: 1.2,
    halfWidth: 2.4,
    capsuleRadius: 0.46,
    regionId: 'assembly',
    destinationSurfaceId: 'surface.assembly.floor-east',
    surfaceBounds: navigation.traversalLinks[0].approachSurfaces[0].bounds,
    surfaceTopY: 0.35,
  };
  const provenDiagnostics = {
    playerPosition: { x: -71.95, y: 0.35, z: 47.04 },
    currentRegionId: 'assembly',
    jumpState: 'Grounded',
    errors: [],
    safeguardActivations: 0,
  };
  const settledDiagnostics = {
    ...provenDiagnostics,
    playerPosition: { x: -71.88, y: 0.35, z: 47.08 },
  };
  assert.equal(publicPortalSettlingIsAccepted({
    provenDiagnostics,
    settledDiagnostics,
    portalIngressContract,
    combatRejoinContract: boundIngressSettle.contract,
  }), true);
  assert.equal(publicPortalSettlingIsAccepted({
    provenDiagnostics,
    settledDiagnostics: {
      ...settledDiagnostics,
      playerPosition: { x: -71.25, y: 0.35, z: 47.08 },
    },
    portalIngressContract,
    combatRejoinContract: boundIngressSettle.contract,
  }), false, 'large outward correction must fail even when the minimum depth remains satisfied');
  assert.equal(publicPortalSettlingIsAccepted({
    provenDiagnostics,
    settledDiagnostics: { ...settledDiagnostics, errors: [{ code: 'camera-origin-outside-closed-cell' }] },
    portalIngressContract,
    combatRejoinContract: boundIngressSettle.contract,
  }), false);
  assert.equal(publicPortalSettlingIsAccepted({
    provenDiagnostics,
    settledDiagnostics: { ...settledDiagnostics, safeguardActivations: 1 },
    portalIngressContract,
    combatRejoinContract: boundIngressSettle.contract,
  }), false);

  const missingRejoin = structuredClone(input);
  delete missingRejoin.navigation.traversalLinks[0].approachContract.combatRejoin;
  assert.equal(selectPlanOwnedGroundEngagementAdvance(missingRejoin), null);
  assert.equal(selectPlanOwnedGroundEngagementAdvance({
    ...input,
    playerPosition: { x: -71.2, y: 0.35, z: 47.3 },
  }), null, 'an off-corridor player cannot claim the plan-owned advance');
  assert.equal(selectPlanOwnedGroundEngagementAdvance({
    ...input,
    target: {
      ...target,
      enemy: { ...target.enemy, encounterId: 'encounter.sorting' },
    },
  }), null, 'an unrelated encounter target cannot be chased through this corridor');
  const wrongEngagement = structuredClone(input);
  wrongEngagement.navigation.encounters[0].entryEngagementContracts[0].sourceTraversalLinkId =
    'traversal.assembly.unrelated';
  assert.equal(selectPlanOwnedGroundEngagementAdvance(wrongEngagement), null);
  const unsupported = structuredClone(input);
  unsupported.navigation.traversalLinks[0].approachSurfaces[0].bounds.min.x = -74;
  assert.equal(selectPlanOwnedGroundEngagementAdvance(unsupported), null,
    'every sampled capsule point requires its declared supporting surface');
});

test('public combat creates clearance from body overlap, elevated cover, and a blocked firing lane', () => {
  assert.equal(publicCombatLaneNeedsClearance({
    horizontalDistance: 2.9,
    verticalDistance: 0,
  }, 0), true, 'body overlap must trigger a retreat');
  assert.equal(publicCombatLaneNeedsClearance({
    horizontalDistance: 4.4,
    verticalDistance: 3.1,
  }, 0), true, 'an elevated close target must trigger a clear-angle retreat');
  assert.equal(publicCombatLaneNeedsClearance({
    horizontalDistance: 5.8,
    verticalDistance: 0,
  }, 5), true, 'a damage-free firing lull must trigger a new lane');
  assert.equal(publicCombatLaneNeedsClearance({
    horizontalDistance: 2.9,
    verticalDistance: 3.1,
  }, 5, 0.5), false, 'a completed clearance must be followed by a real firing opportunity');
  assert.equal(publicCombatLaneNeedsClearance({
    horizontalDistance: 5.8,
    verticalDistance: 0.4,
  }, 1), false, 'a clear ranged lane should remain stable');
});

test('public combat selects a plan-owned raised route matching the retained target elevation', () => {
  const diagnostics = {
    currentRegionId: 'assembly',
    playerPosition: { x: -78, y: 0.35, z: 47 },
    navigation: {
      traversalLinks: [{
        id: 'traversal.assembly.landmark-stairs',
        regionId: 'assembly',
        mode: 'walkable-stairs',
        bidirectional: true,
        conditions: [],
        fromSurfaceId: 'surface.assembly.main',
        toSurfaceId: 'surface.assembly.catwalk',
        fromSurface: {
          bounds: { min: { x: -100, y: 0, z: 38 }, max: { x: -84, y: 0.35, z: 55 } },
          topY: 0.35,
        },
        toSurface: {
          bounds: { min: { x: -103, y: 4, z: 38 }, max: { x: -77, y: 4.3, z: 44 } },
          topY: 4.3,
          purpose: 'elevated machinery inspection route in Assembly Pump Cavern',
        },
      }, {
        id: 'traversal.assembly.portal-landing',
        regionId: 'assembly',
        mode: 'walkable-stairs',
        bidirectional: true,
        conditions: [],
        fromSurfaceId: 'surface.assembly.main',
        toSurfaceId: 'surface.assembly.portal-landing',
        fromSurface: {
          bounds: { min: { x: -100, y: 0, z: 38 }, max: { x: -84, y: 0.35, z: 55 } },
          topY: 0.35,
        },
        toSurface: {
          bounds: { min: { x: -91, y: 3, z: 24 }, max: { x: -89, y: 3.3, z: 27 } },
          topY: 3.3,
          purpose: 'supported landing for portal.assembly-server',
        },
      }, {
        id: 'traversal.other-room.stairs',
        regionId: 'server',
        mode: 'walkable-stairs',
        bidirectional: true,
        conditions: [],
        fromSurface: { bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 0.35, z: 1 } } },
        toSurface: {
          bounds: { min: { x: 0, y: 4, z: 0 }, max: { x: 1, y: 4.3, z: 1 } },
          purpose: 'raised combat inspection route',
        },
      }],
    },
  };
  const target = {
    enemy: enemy('enemy-elevated', 'encounter.assembly', -85, 3.8, 42, 30),
    horizontalDistance: 8,
    verticalDistance: 3.45,
  };

  const route = selectRaisedCombatTraversalLink(diagnostics, target);
  assert.deepEqual({ ...route, score: undefined }, {
    linkId: 'traversal.assembly.landmark-stairs',
    direction: 'forward',
    returnDirection: 'reverse',
    surfaceId: 'surface.assembly.catwalk',
    surfaceY: 4.3,
    targetEnemyId: 'enemy-elevated',
    score: undefined,
  });
  assert.ok(Number.isFinite(route.score));
});

test('public combat will not invent a raised lane from gated or mismatched traversal', () => {
  const diagnostics = {
    currentRegionId: 'assembly',
    playerPosition: { x: 0, y: 0.35, z: 0 },
    navigation: {
      traversalLinks: [{
        id: 'traversal.assembly.locked-lift',
        regionId: 'assembly',
        mode: 'lift',
        mechanismId: 'mechanism.locked',
        conditions: [{ op: 'stateEquals', variableId: 'mechanism.locked.state', value: 'Raised' }],
        fromSurface: { bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 0.35, z: 2 } } },
        toSurface: {
          bounds: { min: { x: 0, y: 4, z: 0 }, max: { x: 2, y: 4.3, z: 2 } },
          purpose: 'raised combat platform',
        },
      }],
    },
  };
  const target = {
    enemy: enemy('enemy-elevated', 'encounter.assembly', 2, 4, 2, 30),
    horizontalDistance: 3,
    verticalDistance: 3.65,
  };

  assert.equal(selectRaisedCombatTraversalLink(diagnostics, target), null);
});

test('raised combat lane is held until target transfer or a confirmed elevation stall', () => {
  const lane = {
    surfaceY: 4.3,
    targetEnemyId: 'enemy-elevated',
  };
  const sameTarget = {
    enemy: enemy('enemy-elevated', 'encounter.assembly', 1, 4.1, 1, 30),
  };
  const transferredTarget = {
    enemy: enemy('enemy-ground', 'encounter.assembly', 1, 0.35, 1, 20),
  };

  assert.equal(getRaisedCombatLaneAction(lane, sameTarget, { y: 4.3 }, 10), 'hold');
  assert.equal(getRaisedCombatLaneAction(lane, transferredTarget, { y: 4.3 }, 0), 'leave');
  assert.equal(getRaisedCombatLaneAction(lane, {
    enemy: enemy('enemy-elevated', 'encounter.assembly', 1, 0.35, 1, 30),
  }, { y: 4.3 }, 4), 'leave');
  assert.equal(getRaisedCombatLaneAction(lane, sameTarget, { y: 0.35 }, 0), 'lost');
});

test('raised public combat turns toward its retained enemy before firing without Tab', () => {
  const player = { x: -90, y: 4.3, z: 41 };
  const target = { x: -85.8, y: 4.2, z: 42.5 };
  const turn = getPublicCombatAimAction(-Math.PI / 2, player, target);
  assert.equal(turn.kind, 'turn');
  assert.ok(['KeyA', 'KeyD'].includes(turn.key));
  assert.ok(turn.duration >= 35 && turn.duration <= 180);
  const desiredYaw = Math.atan2(target.x - player.x, target.z - player.z);
  assert.equal(getPublicCombatAimAction(desiredYaw, player, target).kind, 'fire');
});

test('public combat takes a visible raised lane before running underneath an out-of-range enemy', () => {
  const target = {
    enemy: enemy('enemy-elevated', 'encounter.assembly', 0, 4.3, 12, 30),
    horizontalDistance: 12,
    verticalDistance: 3.95,
  };
  assert.equal(publicCombatShouldTakeRaisedRoute({
    playerPosition: { x: 0, y: 0.35, z: 0 },
    lockOnTargetId: null,
  }, target, 0), true);
  assert.equal(publicCombatShouldTakeRaisedRoute({
    playerPosition: { x: 0, y: 0.35, z: 0 },
    lockOnTargetId: 'enemy-elevated',
  }, target, 2), false, 'a retained target must show a sustained no-damage stall first');
  assert.equal(publicCombatShouldTakeRaisedRoute({
    playerPosition: { x: 0, y: 0.35, z: 0 },
    lockOnTargetId: null,
  }, {
    ...target,
    enemy: enemy('enemy-ground', 'encounter.assembly', 0, 0.35, 12, 30),
  }, 10), false, 'ordinary ground enemies do not justify a raised detour');
});

test('public combat releases a retained lock before ordinary authored traversal', () => {
  assert.equal(publicCombatTraversalRequiresLockRelease({
    lockOnTargetId: 'enemy-raised:weak:eye',
  }, {
    linkId: 'traversal.assembly.landmark-stairs',
  }), true);
  assert.equal(publicCombatTraversalRequiresLockRelease({
    lockOnTargetId: null,
  }, {
    linkId: 'traversal.assembly.landmark-stairs',
  }), false);
  assert.equal(publicCombatTraversalRequiresLockRelease({
    lockOnTargetId: 'enemy-raised:weak:eye',
  }, null), false);
});

test('plan-owned stair approach is consumed only before forward traversal', () => {
  const link = {
    approachWaypoints: [
      { x: -98.4, y: 0.35, z: 53.7 },
      { x: -97.05, y: 0.35, z: 52.64 },
    ],
  };
  const forward = getTraversalLinkApproachWaypoints(link, 'forward');
  assert.deepEqual(forward, link.approachWaypoints);
  assert.notEqual(forward, link.approachWaypoints, 'journey policy must not mutate plan diagnostics');
  assert.notEqual(forward[0], link.approachWaypoints[0]);
  assert.deepEqual(getTraversalLinkApproachWaypoints(link, 'reverse'), []);
});

test('portal ingress requires full interior depth and capsule-clear aperture alignment', () => {
  const contract = {
    boundaryPoint: { x: -70, y: 0.35, z: 47 },
    interiorPoint: { x: -71.2, y: 0.35, z: 47 },
    minimumDepth: 1.2,
    halfWidth: 2.4,
    capsuleRadius: 0.46,
    regionId: 'assembly',
    destinationSurfaceId: 'surface.assembly.floor-east',
    surfaceBounds: {
      min: { x: -79.4, y: 0, z: 24.5 },
      max: { x: -70, y: 0.35, z: 55.5 },
    },
    surfaceTopY: 0.35,
  };
  const diagnostics = (position, overrides = {}) => ({
    playerPosition: position,
    currentRegionId: 'assembly',
    jumpState: 'Grounded',
    ...overrides,
  });
  assert.equal(hasClearedAuthoredPortalIngress(
    diagnostics({ x: -70.9, y: 0.35, z: 47 }),
    contract,
  ), false);
  assert.equal(hasClearedAuthoredPortalIngress(
    diagnostics({ x: -71.2, y: 0.35, z: 47 }),
    contract,
  ), true, 'the exact authored 1.2m depth must pass');
  assert.equal(hasClearedAuthoredPortalIngress(
    diagnostics({ x: -71.74, y: 0.35, z: 48.07 }),
    contract,
  ), true);
  assert.equal(hasClearedAuthoredPortalIngress(
    diagnostics({ x: -71.74, y: 0.35, z: 49.2 }),
    contract,
  ), false);
  assert.equal(hasClearedAuthoredPortalIngress(
    diagnostics({ x: -71.74, y: 0.35, z: 48.07 }, { currentRegionId: 'security' }),
    contract,
  ), false);
  assert.equal(hasClearedAuthoredPortalIngress(
    diagnostics({ x: -71.74, y: 0.35, z: 48.07 }, { jumpState: 'Falling' }),
    contract,
  ), false);
  const toleranceOnlyPosition = diagnostics({
    x: -71.18590331581571,
    y: 0.35,
    z: 46.871558439710356,
  });
  assert.equal(Math.hypot(
    toleranceOnlyPosition.playerPosition.x - contract.interiorPoint.x,
    toleranceOnlyPosition.playerPosition.z - contract.interiorPoint.z,
  ) < 0.4, true, 'negative fixture must be inside the ordinary waypoint tolerance');
  assert.equal(publicSteeringEndpointReached(true, {
    portalIngressContract: contract,
    diagnostics: toleranceOnlyPosition,
  }), false, 'distance tolerance alone cannot satisfy a portal endpoint');
  assert.equal(publicSteeringEndpointReached(true, {
    portalIngressContract: contract,
    diagnostics: diagnostics({ x: -71.2, y: 0.35, z: 47 }),
  }), true, 'the exact grounded 1.2m ingress predicate owns endpoint success');
  assert.equal(publicSteeringEndpointReached(false, {
    portalIngressContract: contract,
    diagnostics: diagnostics({ x: -71.74, y: 0.35, z: 48.07 }),
  }), false, 'physical ingress away from the authored route centerline cannot replace positional proof');
  assert.equal(publicSteeringEndpointReached(true), true,
    'ordinary non-portal waypoints retain positional completion');
});

test('stair approach ingress accepts only grounded capsule-contained forward progress', () => {
  const contract = {
    targetPoint: { x: -42, y: 0.35, z: 44.2 },
    nextPoint: { x: -42, y: 0.35, z: 41.8 },
    surfaceId: 'surface.security.main',
    surfaceBounds: {
      min: { x: -61.5, y: 0, z: 30.5 },
      max: { x: -32.5, y: 0.35, z: 49.5 },
    },
    surfaceTopY: 0.35,
    capsuleRadius: 0.46,
    halfWidth: 3,
    verticalTolerance: 0.2,
    maximumForwardProgress: 0.92,
  };
  const diagnostics = (playerPosition, overrides = {}) => ({
    playerPosition,
    jumpState: 'Grounded',
    ledgeCling: null,
    animationState: 'idle',
    errors: [],
    safeguardActivations: 0,
    ...overrides,
  });
  const crossedInsideApproach = diagnostics({ x: -41.23, y: 0.35, z: 43.95 });
  assert.equal(hasClearedAuthoredApproachIngress(crossedInsideApproach, contract), true,
    'crossing the authored approach plane inside its usable width must pass');
  assert.equal(publicSteeringEndpointReached(false, {
    approachIngressContract: contract,
    diagnostics: crossedInsideApproach,
  }), true, 'physical approach ingress may complete when the exact point tolerance did not');
  assert.equal(publicSteeringEndpointReached(true, {
    approachIngressContract: contract,
    diagnostics: diagnostics({ x: -42, y: 0.35, z: 44.2 }),
  }), true, 'the original exact point proof remains valid');
  assert.equal(publicSteeringEndpointReached(true, {
    approachIngressContract: contract,
    diagnostics: diagnostics(
      { x: -42, y: 0.35, z: 44.2 },
      { errors: [{ code: 'physics-recovery-safeguard-activated' }], safeguardActivations: 1 },
    ),
  }), false, 'even exact point proximity cannot erase recovery or validation errors');

  assert.equal(hasClearedAuthoredApproachIngress(
    diagnostics({ x: -31.9, y: 0.35, z: 43.95 }),
    contract,
  ), false, 'an off-surface capsule cannot satisfy approach ingress');
  assert.equal(hasClearedAuthoredApproachIngress(
    diagnostics({ x: -42, y: 0.35, z: 38 }),
    contract,
  ), false, 'a floor position under the stair cannot substitute for crossing its entrance plane');
  assert.equal(hasClearedAuthoredApproachIngress(
    diagnostics({ x: -42, y: 1.2, z: 43.95 }),
    contract,
  ), false, 'wrong-elevation movement cannot satisfy a grounded approach');
  assert.equal(hasClearedAuthoredApproachIngress(
    diagnostics({ x: -42, y: 0.35, z: 43.95 }, { jumpState: 'LandRecovery' }),
    contract,
  ), false, 'fall recovery cannot satisfy a walk-only approach');
  assert.equal(hasClearedAuthoredApproachIngress(
    diagnostics({ x: -42, y: 0.35, z: 43.95 }, {
      errors: [{ code: 'physics-recovery-safeguard-activated' }],
      safeguardActivations: 1,
    }),
    contract,
  ), false, 'safeguard or validation errors cannot satisfy an approach');
});

test('near-target public steering pulse stays below remaining exact-waypoint clearance', () => {
  const distance = 1.34;
  const tolerance = 0.35;
  const pulse = getPublicSteeringForwardBurst(distance, tolerance);
  assert.ok(pulse <= 20);
  assert.ok(pulse * 0.012 <= distance - tolerance);
});

test('strict authored-route turning converges under quantized 20 FPS tank turns', () => {
  const desiredYaw = 1.959;
  let playerYaw = -3.8605494247209826;
  const appliedKeys = [];
  for (let index = 0; index < 8; index += 1) {
    const action = getPublicSteeringTurnAction(playerYaw, desiredYaw, {
      yawTolerance: 0.36,
      constrainedGroundRoute: true,
    });
    if (!action) break;
    assert.equal(action.duration, null);
    assert.equal(action.frameSynchronized, true,
      'strict traversal turns must be bounded by the game heartbeat, not wall-clock timing');
    appliedKeys.push(action.key);
    // Production tank turning is 2.7 rad/s with dt clamped to 0.05s.
    // Apply the coarsest possible single observed frame for every pulse.
    playerYaw += action.key === 'KeyA' ? 0.135 : -0.135;
  }
  assert.equal(getPublicSteeringTurnAction(playerYaw, desiredYaw, {
    yawTolerance: 0.36,
    constrainedGroundRoute: true,
  }), null, 'quantized correction must enter the existing heading tolerance');
  assert.deepEqual([...new Set(appliedKeys)], ['KeyD'],
    'the correction must not alternate around the heading dead-zone');

  const ordinary = getPublicSteeringTurnAction(0, 1, {
    yawTolerance: 0.36,
    constrainedGroundRoute: false,
  });
  assert.ok(ordinary.duration >= 40,
    'ordinary open-floor steering retains its established turn timing');
  assert.equal(ordinary.frameSynchronized, false);
});

test('stationary loaded-frame yaw sign flips recover through public forward-turn input', () => {
  const position = { x: -79.47154037918573, y: 0.35, z: 52.205764109360025 };
  assert.equal(publicSteeringNeedsQuantizedTurnAdvance({
    yawDelta: 0.417,
    position,
  }, {
    yawDelta: -0.393,
    position,
  }, {
    yawTolerance: 0.36,
  }), true, 'the observed Assembly oscillation must advance without changing its tolerance');

  assert.equal(publicSteeringNeedsQuantizedTurnAdvance({
    yawDelta: 0.417,
    position,
  }, {
    yawDelta: -0.393,
    position: { ...position, x: position.x - 0.2 },
  }), false, 'ordinary movement must not be mistaken for a stationary turn oscillation');
  assert.equal(publicSteeringNeedsQuantizedTurnAdvance({
    yawDelta: 0.417,
    position,
  }, {
    yawDelta: 0.393,
    position,
  }), false, 'same-sided convergence remains a pure turn');
  assert.equal(publicSteeringNeedsQuantizedTurnAdvance({
    yawDelta: 0.9,
    position,
  }, {
    yawDelta: -0.9,
    position,
  }), false, 'a large heading reversal is not a near-tolerance quantization recovery');
});

test('strict steering consumes a proven yaw sign flip as one forward-turn heartbeat', async () => {
  const calls = [];
  const result = await applyPublicSteeringTurn({}, {
    key: 'KeyD',
    duration: null,
    frameSynchronized: true,
  }, {
    quantizedTurnAdvance: true,
    heartbeatInput: async (_page, codes) => calls.push({ kind: 'heartbeat', codes }),
    tapInput: async () => calls.push({ kind: 'tap' }),
    timedInput: async () => calls.push({ kind: 'timed' }),
  });

  assert.deepEqual(calls, [{ kind: 'heartbeat', codes: ['KeyW', 'KeyD'] }],
    'the detected oscillation must not be discarded into another turn-only tap');
  assert.deepEqual(result, {
    mode: 'forward-turn-heartbeat',
    codes: ['KeyW', 'KeyD'],
  });
});

function heartbeatPage() {
  const keyboardEvents = [];
  return {
    keyboardEvents,
    keyboard: {
      async down(code) { keyboardEvents.push(`down:${code}`); },
      async up(code) { keyboardEvents.push(`up:${code}`); },
    },
  };
}

test('frame-synchronized public turns release every key after exactly one heartbeat', async () => {
  const page = heartbeatPage();
  const observer = { async dispose() { page.keyboardEvents.push('dispose'); } };
  const result = await holdPublicInputsForOneHeartbeat(page, ['KeyW', 'KeyD'], {
    armHeartbeat: async (_page, codes) => {
      assert.deepEqual(codes, ['KeyW', 'KeyD']);
      return observer;
    },
    waitForIncrement: async (armed) => armed === observer ? 41 : -1,
  });
  assert.equal(result, 41);
  assert.deepEqual(page.keyboardEvents, [
    'down:KeyW',
    'down:KeyD',
    'up:KeyD',
    'up:KeyW',
    'dispose',
  ]);
});

test('frame-synchronized public turns fail closed and release keys on heartbeat stall', async () => {
  const page = heartbeatPage();
  await assert.rejects(
    holdPublicInputsForOneHeartbeat(page, ['KeyA'], {
      armHeartbeat: async () => ({ async dispose() {} }),
      waitForIncrement: async () => { throw new Error('V2 frame heartbeat stalled at 72 during public input.'); },
    }),
    /heartbeat stalled at 72/,
  );
  assert.deepEqual(page.keyboardEvents, ['down:KeyA', 'up:KeyA']);
});

test('frame-synchronized public turns reject a skipped frame and release keys', async () => {
  const page = heartbeatPage();
  await assert.rejects(
    holdPublicInputsForOneHeartbeat(page, ['KeyW', 'KeyA'], {
      armHeartbeat: async () => ({ async dispose() {} }),
      waitForIncrement: async () => { throw new Error('V2 frame heartbeat skipped from 90 to 92 during public input.'); },
    }),
    /heartbeat skipped from 90 to 92/,
  );
  assert.deepEqual(page.keyboardEvents, [
    'down:KeyW',
    'down:KeyA',
    'up:KeyA',
    'up:KeyW',
  ]);
});

test('strict public forward input consumes exactly one authoritative heartbeat', async () => {
  const calls = [];
  const result = await applyPublicStrictGroundForward({}, {
    heartbeatInput: async (_page, codes) => calls.push({ kind: 'heartbeat', codes }),
  });

  assert.deepEqual(calls, [{ kind: 'heartbeat', codes: ['KeyW'] }],
    'strict forward movement must not rely on a wall-clock keyboard.press duration');
  assert.deepEqual(result, { mode: 'forward-heartbeat', codes: ['KeyW'] });
});

test('bounded public turn-forward correction releases each key in its own press operation', async () => {
  const calls = [];
  const page = {
    keyboard: {
      async press(code, options) { calls.push({ code, options }); },
    },
  };
  await tapPublicInputBurst(page, ['KeyD', 'KeyW', 'KeyD']);
  assert.deepEqual(calls, [
    { code: 'KeyD', options: { delay: 160 } },
    { code: 'KeyW', options: { delay: 160 } },
  ]);
});

test('public steering observes an unchanged waypoint tolerance across bounded input sweeps', () => {
  const target = { x: -71.2, y: 0.35, z: 47 };
  const before = { x: -71.4, y: 0.35, z: 46.09 };
  const after = { x: -70.37, y: 0.35, z: 47.81 };
  assert.ok(Math.hypot(target.x - before.x, target.z - before.z) > 0.35);
  assert.ok(Math.hypot(target.x - after.x, target.z - after.z) > 0.35);
  assert.equal(publicSteeringSweepReachedTarget(before, after, target, 0.35, 0.2), true);
  assert.equal(publicSteeringSweepReachedTarget(before, {
    x: -67,
    y: 0.35,
    z: 50,
  }, target, 0.35, 0.2), false, 'large correction/warp sweeps must never satisfy a waypoint');
  assert.equal(publicSteeringSweepReachedTarget(before, {
    ...after,
    y: 1,
  }, target, 0.35, 0.2), false, 'wrong-elevation sweeps must never satisfy a grounded waypoint');
  assert.equal(publicSteeringSweepReachedTarget(before, {
    x: -70.2,
    y: 0.35,
    z: 46.1,
  }, target, 0.35, 0.2), false, 'lateral movement that misses the waypoint must fail');
  assert.equal(publicSteeringSweepReachedTarget(before, after, target, 0.35, 0.2, {
    requireGrounded: true,
    diagnostics: { jumpState: 'Falling', errors: [], safeguardActivations: 0 },
  }), false, 'forbidden aerial traversal must fail');
  assert.equal(publicSteeringSweepReachedTarget(before, after, target, 0.35, 0.2, {
    diagnostics: { jumpState: 'Grounded', errors: ['physics-recovery'], safeguardActivations: 1 },
  }), false, 'recovery/correction evidence must fail');
});

test('stair approach continues forward from an already occupied plan segment', () => {
  const link = {
    approachContract: { capsuleRadius: 0.46 },
    approachWaypoints: [
      { x: -71.2, y: 0.35, z: 47 },
      { x: -71.5, y: 0.35, z: 53 },
      { x: -82, y: 0.35, z: 53 },
    ],
  };
  assert.deepEqual(getTraversalLinkApproachWaypoints(link, 'forward', {
    x: -71.74,
    y: 0.35,
    z: 48.07,
  }), link.approachWaypoints.slice(1));
  assert.deepEqual(getTraversalLinkApproachWaypoints(link, 'forward', {
    x: -75.28,
    y: 0.35,
    z: 44.88,
  }), link.approachWaypoints, 'off-route combat positions must not skip unproven segments');
});

test('post-combat stair approach rejoins only from its plan-owned engagement corridor', () => {
  const link = {
    approachContract: {
      capsuleRadius: 0.46,
      combatRejoin: {
        segmentStart: { x: -71.2, y: 0.35, z: 47 },
        segmentEnd: { x: -75.5, y: 0.35, z: 47 },
        minimumProgress: 0,
        maximumProgress: 1,
        maximumLateralOffset: 0.25,
        nextWaypointIndex: 1,
      },
    },
    approachWaypoints: [
      { x: -71.2, y: 0.35, z: 47 },
      { x: -71.5, y: 0.35, z: 53 },
      { x: -82, y: 0.35, z: 53 },
    ],
  };
  assert.deepEqual(getTraversalLinkApproachWaypoints(link, 'forward', {
    x: -72.47484413946634,
    y: 0.35,
    z: 47.09966800618625,
  }), link.approachWaypoints.slice(1),
  'the recorded post-combat position must join the already-proven east-floor route');
  assert.deepEqual(getTraversalLinkApproachWaypoints(link, 'forward', {
    x: -75.28,
    y: 0.35,
    z: 44.88,
  }), link.approachWaypoints,
  'an off-corridor combat position must still traverse the complete authored approach');
});
