import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DungeonController } from '../../../src/DungeonController.js';
import { Game } from '../../../src/Game.js';
import { Player } from '../../../src/Player.js';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../../../src/TraversalCapabilities.js';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';

const ASSEMBLY_STAIR_LINK_ID = 'traversal.assembly.landmark-stairs';
const ALPHA_GATE_LINK_ID = 'traversal.security.security-sorting-alpha';

function createPhysicalPlayer(position) {
  const player = Object.create(Player.prototype);
  player.root = new THREE.Group();
  player.root.position.copy(position);
  player.radius = PLAYER_TRAVERSAL_ENVELOPE.collisionRadius;
  player.dead = false;
  player.velocity = new THREE.Vector3();
  player.takeoffHorizontalVelocity = new THREE.Vector3();
  player.lastMoveDirection = new THREE.Vector3(0, 0, 1);
  player.jumpDirection = new THREE.Vector3(0, 0, 1);
  player.jumpSettings = {
    forwardSpeed: 6.2,
    groundAcceleration: 24,
    groundDeceleration: 22,
    coyoteTime: 0.03,
  };
  player.environmentTraversalProfile = {
    flooded: false,
    movementMultiplier: 1,
    jumpHeight: null,
    gravityScale: 1,
  };
  player.takeoffEnvironmentTraversalProfile = null;
  player.gearEffects = {};
  player.jetSkateState = { active: false };
  player.powerKnockbackState = null;
  player.externalControl = null;
  player.externalBallisticMotion = null;
  player.ladderTraversal = null;
  player.ladderDismountConstraintPasses = 0;
  player.ledgeCling = null;
  player.jumpState = 'Grounded';
  player._jumpGroundY = position.y;
  player._jumpBufferTimer = 0;
  player._coyoteTimer = 0.03;
  player._landingRecoveryTimer = 0;
  player._jumpAirTimer = 0;
  player._jumpFallTransitionActive = false;
  player._jumpKind = 'forwardJump';
  player._jumpLandingVisualTimer = 0;
  player._jumpLandingVisualState = null;
  player._jumpLandingVisualClipKey = null;
  player._jumpSlashVisualState = null;
  player.animation = {
    actionState: null,
    hurtTimer: 0,
    attackTimer: 0,
    externalControlLocked: false,
    isFullBodyActionActive: () => false,
  };
  return player;
}

function createProductionSupportGame(player, facade) {
  const game = {
    player,
    dungeon: facade,
    enemies: [],
    elapsedTime: 0,
    ruinCompleted: false,
    platformingPlatforms: (facade.platforms ?? []).filter(({ dynamic }) => dynamic !== true),
    dynamicPlatformingPlatforms: (facade.platforms ?? []).filter(({ dynamic }) => dynamic === true),
    debugSpawnedPlatforms: [],
    bossStageRuntime: null,
    ui: { showToast() {} },
    scene: new THREE.Scene(),
  };
  for (const methodName of [
    '_getPlatformingSurfaces',
    '_recordPlatformQuery',
    '_getPlatformFloorElevation',
    'getPlatformSupport',
    'getPlatformFloorElevation',
    '_isPositionInsidePlatformBlock',
    'isPositionInsidePlatformBlock',
  ]) {
    game[methodName] = Game.prototype[methodName].bind(game);
  }
  return game;
}

function createGoldenFixture() {
  const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2({
    seed: 'm1-golden-magma',
    undercroft: 'magma',
  }));
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  const facade = assembleDungeonPlanV2(validation.plan);
  const assemblyStairLink = validation.plan.traversalLinks.find(({ id }) => (
    id === ASSEMBLY_STAIR_LINK_ID
  ));
  assert.ok(assemblyStairLink, `${ASSEMBLY_STAIR_LINK_ID} missing from actual seeded golden complex`);
  assert.equal(assemblyStairLink.nativeFixedRoomPlacementId, 'placement.assembly');
  const stair = validation.plan.walkableSurfaces.find(({ id }) => (
    id === assemblyStairLink.viaSurfaceId
  ));
  assert.ok(stair, `${assemblyStairLink.viaSurfaceId} missing from the native Machine Factory`);
  assert.equal(stair.presentationOwnerId, 'placement.assembly');
  assert.equal(stair.id.startsWith('placement.assembly:surface.v1-room.machine-factory.'), true);
  const nativeRampSurfaces = (assemblyStairLink.nativeRampSurfaceIds ?? []).map((surfaceId) => (
    validation.plan.walkableSurfaces.find(({ id }) => id === surfaceId)
  ));
  assert.equal(nativeRampSurfaces.length, 11,
    'the V1 Machine Factory west-catwalk ramp retains all eleven authored tiles');
  assert.equal(nativeRampSurfaces.every(Boolean), true);
  assert.equal(new Set(nativeRampSurfaces.map(({ id }) => id)).size, nativeRampSurfaces.length);
  assert.equal(nativeRampSurfaces.every(({ presentationOwnerId }) => (
    presentationOwnerId === 'placement.assembly'
  )), true);
  return {
    validation,
    plan: validation.plan,
    facade,
    stair,
    assemblyStairLink,
    nativeRampSurfaces,
  };
}

function resolveProductionGroundY(controller, game, position) {
  const ramp = controller.getRampSurfaceElevationAt(position);
  if (Number.isFinite(ramp)) return ramp;
  const platform = game.getPlatformFloorElevation(position);
  if (Number.isFinite(platform)) return platform;
  return controller.getFloorElevationAt(position);
}

function advanceGroundedFrame(player, controller, game, direction, speed = 6.2, dt = 1 / 60) {
  const groundY = resolveProductionGroundY(controller, game, player.root.position);
  const targetVelocity = new THREE.Vector3(direction.x * speed, 0, direction.z * speed);
  player._updatePhysicalJumpAndMovement(dt, targetVelocity, {
    arenaRadius: 1_000,
    movementOptions: { groundY },
  });
  controller._constrainPlayerToWalkable();
}

test('actual seeded native V1 Machine Factory ramp climbs from lower floor at every production frame clamp', () => {
  const { facade, stair, nativeRampSurfaces } = createGoldenFixture();
  try {
    const stairGeometry = stair.stairs ?? stair.geometry;
    const [foot, top] = stairGeometry.path;
    const run = Math.hypot(top.x - foot.x, top.z - foot.z);
    const direction = {
      x: (top.x - foot.x) / run,
      z: (top.z - foot.z) / run,
    };
    // Game clamps real frames to at most 0.05s. Cover nominal 60/30 FPS and
    // the exact 20 FPS clamp so a loaded V2 scene cannot skip stair support.
    for (const frameRate of [60, 30, 20]) {
      const player = createPhysicalPlayer(new THREE.Vector3(
        foot.x - direction.x * 0.8,
        foot.y,
        foot.z - direction.z * 0.8,
      ));
      const game = createProductionSupportGame(player, facade);
      const controller = new DungeonController(game, facade);
      let previousY = player.root.position.y;
      let enteredStair = false;

      const traversalBudgetSeconds = (run + 0.8) / 6.2 + 1;
      for (let frame = 0; frame < Math.ceil(frameRate * traversalBudgetSeconds); frame += 1) {
        advanceGroundedFrame(player, controller, game, direction, 6.2, 1 / frameRate);
        const exact = facade.getExactStairSurfaceAt(player.root.position, {
          maxVerticalGap: 0.001,
          tolerance: 0.025,
        });
        if (exact?.surfaceId === stair.id) {
          enteredStair = true;
          assert.ok(player.root.position.y + 1e-9 >= previousY,
            `${frameRate} FPS support moved downward on frame ${frame}`);
          assert.ok(Math.abs(player.root.position.y - exact.elevation) <= 1e-9,
            `${frameRate} FPS controller did not own stair elevation on frame ${frame}`);
        }
        previousY = player.root.position.y;
        if (player.root.position.y >= top.y - 0.01) break;
      }

      assert.equal(enteredStair, true,
        `${frameRate} FPS KeyW-equivalent movement never acquired the stair`);
      assert.ok(player.root.position.y >= top.y - 0.01,
        `${frameRate} FPS reached only ${JSON.stringify(player.root.position.toArray())} instead of y=${top.y}`);
      assert.equal(player.jumpState, 'Grounded');
      assert.equal(player.ledgeCling, null);
    }

    const orderedLocalRampIds = nativeRampSurfaces.map(({ localId }) => localId);
    assert.equal(orderedLocalRampIds[0], 'surface.v1-room.machine-factory.-8.6.0');
    assert.equal(orderedLocalRampIds.at(-1), 'surface.v1-room.machine-factory.-8.-4.1');
    for (const surface of nativeRampSurfaces) {
      assert.deepEqual(surface.supportFixtureIds, ['fixture.placement.assembly.native-ramp-support.1']);
      assert.equal(surface.createsLedgeCandidates, false,
        `${surface.id} must not create ledge-warp candidates at internal V1 ramp seams`);
    }
  } finally {
    facade.dispose();
  }
});

test('actual seeded Alpha gate stair is portal-aligned and supports the recorded public descent turn', () => {
  const { plan, facade } = createGoldenFixture();
  try {
    const link = plan.traversalLinks.find(({ id }) => (
      id === ALPHA_GATE_LINK_ID
    ));
    assert.ok(link, 'actual seeded Alpha gate traversal link is missing');
    const stair = plan.walkableSurfaces.find(({ id }) => id === link.viaSurfaceId);
    assert.ok(stair, 'actual seeded Alpha gate stair is missing');
    const stairGeometry = stair.stairs ?? stair.geometry;
    const [foot, top] = stairGeometry.path;
    assert.equal(foot.z, top.z,
      'native Alpha ramp must remain square to its raised north-wall exit');
    assert.equal(stair.presentationOwnerId, 'placement.security');
    assert.equal(stair.id.startsWith(
      'placement.security:surface.v1-room.security-entrance.',
    ), true);
    assert.equal(stairGeometry.width, 2.8,
      'native Alpha ramp retains its full three-tile V1 authored width');
    assert.equal(link.minimumWidth, stairGeometry.width);
    assert.equal(link.nativeRampSurfaceIds.length, 3);
    assert.deepEqual(link.approachWaypoints.at(-1), foot);
    assert.deepEqual(link.stairWaypoints[0], foot);
    assert.deepEqual(link.stairWaypoints.at(-1), top);
    assert.ok(link.stairWaypoints.length >= 5,
      'Alpha stair must own frequent centerline corrections for public tank movement');
    for (let index = 1; index < link.stairWaypoints.length; index += 1) {
      const previous = link.stairWaypoints[index - 1];
      const current = link.stairWaypoints[index];
      assert.ok(Math.hypot(current.x - previous.x, current.z - previous.z) <= 2.5 + 1e-9);
      assert.equal(
        facade.getExactStairSurfaceAt(new THREE.Vector3(current.x, current.y, current.z), {
          maxVerticalGap: 0.001,
          tolerance: 0.025,
        })?.surfaceId,
        stair.id,
      );
    }
    assert.deepEqual(link.reverseEgressWaypoints, [link.approachWaypoints[0]],
      'Alpha reverse route must retain a straight lower-deck egress before any room turn');

    const recordedLowTread = new THREE.Vector3(
      link.stairWaypoints.at(-2).x,
      link.stairWaypoints.at(-2).y,
      link.stairWaypoints.at(-2).z,
    );
    const exact = facade.getExactStairSurfaceAt(recordedLowTread, {
      maxVerticalGap: 0.001,
      tolerance: 0.025,
    });
    assert.equal(exact?.surfaceId, stair.id,
      'native public-input descent checkpoint must remain capsule-supported by the real ramp');
    assert.ok(Math.abs(exact.elevation - recordedLowTread.y) <= 1e-9);

    const player = createPhysicalPlayer(recordedLowTread);
    const game = createProductionSupportGame(player, facade);
    const controller = new DungeonController(game, facade);
    const safeEgress = new THREE.Vector3(
      link.reverseEgressWaypoints[0].x,
      link.reverseEgressWaypoints[0].y,
      link.reverseEgressWaypoints[0].z,
    );
    const direction = safeEgress.clone().sub(player.root.position).setY(0).normalize();
    for (let frame = 0; frame < 30; frame += 1) {
      advanceGroundedFrame(player, controller, game, direction, 6.2, 1 / 20);
      assert.equal(player.jumpState, 'Grounded',
        `Alpha descent turn entered ${player.jumpState} on frame ${frame}`);
      assert.equal(player.ledgeCling, null);
      if (player.root.position.y <= foot.y + 0.001
        && player.root.position.distanceTo(safeEgress) <= 0.5) break;
    }
    assert.ok(player.root.position.y <= foot.y + 0.001,
      `Alpha descent did not join the Security floor: ${JSON.stringify(player.root.position.toArray())}`);
    assert.ok(player.root.position.distanceTo(safeEgress) <= 0.5,
      `Alpha descent did not clear the final tread before turning: ${JSON.stringify(player.root.position.toArray())}`);

    const roomCenter = new THREE.Vector3(
      link.reverseEgressWaypoints[0].x,
      foot.y,
      link.reverseEgressWaypoints[0].z - 3,
    );
    const turnDirection = roomCenter.sub(player.root.position).setY(0).normalize();
    for (let frame = 0; frame < 12; frame += 1) {
      advanceGroundedFrame(player, controller, game, turnDirection, 6.2, 1 / 20);
      assert.equal(player.jumpState, 'Grounded',
        `Alpha lower-deck egress turn entered ${player.jumpState} on frame ${frame}`);
    }
  } finally {
    facade.dispose();
  }
});

test('validator rejects an Alpha gate stair without its physical reverse egress and centerline checkpoints', () => {
  const missingEgress = structuredClone(createGoldenDungeonPlanV2({
    seed: 'm1-golden-magma',
    undercroftType: 'magma',
  }));
  const missingEgressLink = missingEgress.traversalLinks.find(({ id }) => (
    id === 'traversal.security.security-sorting-alpha'
  ));
  missingEgressLink.reverseEgressWaypoints = [];
  const missingEgressValidation = validateDungeonPlanV2(missingEgress);
  assert.equal(missingEgressValidation.accepted, false);
  assert.ok(missingEgressValidation.errors.some(({ code }) => (
    code === 'stair-reverse-egress-invalid'
  )));

  const offStairRoute = structuredClone(createGoldenDungeonPlanV2({
    seed: 'm1-golden-magma',
    undercroftType: 'magma',
  }));
  const offStairLink = offStairRoute.traversalLinks.find(({ id }) => (
    id === 'traversal.security.security-sorting-alpha'
  ));
  offStairLink.stairWaypoints[1].x += 4.2;
  const offStairValidation = validateDungeonPlanV2(offStairRoute);
  assert.equal(offStairValidation.accepted, false);
  assert.ok(offStairValidation.errors.some(({ code }) => (
    code === 'stair-route-checkpoints-invalid'
  )));
});

test('native Machine Factory ramp top owns a capsule-wide supported turning apron', () => {
  const { validation, facade, stair } = createGoldenFixture();
  try {
    const catwalk = validation.plan.walkableSurfaces.find(
      ({ id }) => id === (stair.stairs ?? stair.geometry).endpointSurfaceIds.end,
    );
    assert.ok(catwalk, 'Assembly stair destination catwalk missing');
    assert.equal(catwalk.presentationOwnerId, 'placement.assembly');
    assert.equal(catwalk.id.startsWith('placement.assembly:surface.v1-room.machine-factory.'), true);
    assert.ok(catwalk.supportFixtureIds.some((id) => (
      id.startsWith('fixture.placement.assembly.native-catwalk-frame.')
    )), 'native upper landing must name its visible thin V1 post/beam/rail frame');
    const capsuleRadius = PLAYER_TRAVERSAL_ENVELOPE.collisionRadius;
    const inset = capsuleRadius + 0.1;
    const recordedPositions = [
      {
        x: catwalk.bounds.min.x + inset,
        y: catwalk.bounds.max.y,
        z: catwalk.bounds.min.z + inset,
      },
      {
        x: catwalk.bounds.max.x - inset,
        y: catwalk.bounds.max.y,
        z: catwalk.bounds.max.z - inset,
      },
    ];
    const player = createPhysicalPlayer(new THREE.Vector3(
      recordedPositions[0].x,
      recordedPositions[0].y,
      recordedPositions[0].z,
    ));
    const game = createProductionSupportGame(player, facade);
    for (const position of recordedPositions) {
      assert.ok(position.x >= catwalk.bounds.min.x + capsuleRadius
        && position.x <= catwalk.bounds.max.x - capsuleRadius
        && position.z >= catwalk.bounds.min.z + capsuleRadius
        && position.z <= catwalk.bounds.max.z - capsuleRadius,
      `recorded public-input overshoot lacks a capsule-contained upper landing: ${JSON.stringify(position)}`);
      assert.equal(
        game.getPlatformFloorElevation(new THREE.Vector3(position.x, position.y, position.z)),
        catwalk.bounds.max.y,
        `production support lookup lost the Assembly turning apron at ${JSON.stringify(position)}`,
      );
    }
  } finally {
    facade.dispose();
  }
});

test('side entry cannot use the overlapping base floor to walk underneath the Assembly stair', () => {
  const { facade, stair } = createGoldenFixture();
  try {
    const [foot, top] = (stair.stairs ?? stair.geometry).path;
    const run = Math.hypot(top.x - foot.x, top.z - foot.z);
    const direction = {
      x: (top.x - foot.x) / run,
      z: (top.z - foot.z) / run,
    };
    const tangent = { x: -direction.z, z: direction.x };
    const midpoint = {
      x: (foot.x + top.x) * 0.5,
      z: (foot.z + top.z) * 0.5,
    };
    const startOffset = (stair.stairs ?? stair.geometry).width * 0.5 + 1;
    const player = createPhysicalPlayer(new THREE.Vector3(
      midpoint.x + tangent.x * startOffset,
      foot.y,
      midpoint.z + tangent.z * startOffset,
    ));
    const game = createProductionSupportGame(player, facade);
    const controller = new DungeonController(game, facade);
    const start = player.root.position.clone();

    for (let frame = 0; frame < 90; frame += 1) {
      advanceGroundedFrame(player, controller, game, { x: -tangent.x, z: -tangent.z });
    }

    const crossing = facade.getExactStairSurfaceAt(player.root.position, {
      maxVerticalGap: Infinity,
      tolerance: 0.025,
    });
    assert.equal(crossing, null,
      `player entered solid stair footprint from its side at ${JSON.stringify(player.root.position)}`);
    assert.ok(player.root.position.y < foot.y + 0.05,
      'remote stair support warped the grounded player upward');
    const crossedDistance = (start.x - player.root.position.x) * tangent.x
      + (start.z - player.root.position.z) * tangent.z;
    assert.ok(crossedDistance < startOffset - (stair.stairs ?? stair.geometry).width * 0.5 + 0.2,
      'overlapping base floor allowed traversal beneath the incline');
  } finally {
    facade.dispose();
  }
});

test('stacked and parallel stair profiles never capture a remote elevation', () => {
  const player = createPhysicalPlayer(new THREE.Vector3(0, 0.35, 0));
  const sampleProfiles = (position, maxVerticalGap) => [
    { surfaceId: 'stair.lower', elevation: 0.42 },
    { surfaceId: 'stair.parallel-upper', elevation: 7.42 },
  ].filter(({ elevation }) => Math.abs(elevation - position.y) <= maxVerticalGap)
    .sort((left, right) => (
      Math.abs(left.elevation - position.y) - Math.abs(right.elevation - position.y)
    ))[0] ?? null;
  const dungeon = {
    generationMode: 'v2',
    kind: 'DungeonV2',
    tileSize: 2.8,
    tiles: new Map(),
    floorTiles: [{ id: 'floor.base', surfaceId: 'floor.base', x: 0, z: 0, elevation: 0.35 }],
    doors: [],
    progression: null,
    solidZones: [],
    aerialBoundaryZones: [],
    platforms: [],
    getExactStairSurfaceAt(position, { maxVerticalGap = Infinity } = {}) {
      return sampleProfiles(position, maxVerticalGap);
    },
    getExactStairSurfaceElevationAt(position, options) {
      return sampleProfiles(position, options?.maxVerticalGap ?? Infinity)?.elevation ?? null;
    },
    isPositionOnExactStairSurface: () => false,
  };
  const game = createProductionSupportGame(player, dungeon);
  const controller = new DungeonController(game, dungeon);

  assert.equal(controller.getRampSurfaceElevationAt(player.root.position), 0.42,
    'nearest physically reachable parallel slope was not selected');
  controller._constrainPlayerToWalkable();
  assert.equal(player.root.position.y, 0.42);
  assert.notEqual(player.root.position.y, 7.42, 'remote stacked slope captured the player');

  dungeon.getExactStairSurfaceAt = (position, { maxVerticalGap = Infinity } = {}) => (
    Math.abs(7.42 - position.y) <= maxVerticalGap
      ? { surfaceId: 'stair.remote-only', elevation: 7.42 }
      : null
  );
  dungeon.getExactStairSurfaceElevationAt = (position, options) => (
    dungeon.getExactStairSurfaceAt(position, options)?.elevation ?? null
  );
  player.root.position.set(0, 0.35, 0);
  controller.lastSafePlayerPosition.set(-2.8, 0.35, 0);
  controller._constrainPlayerToWalkable();
  assert.deepEqual(player.root.position.toArray(), [-2.8, 0.35, 0],
    'remote-only slope should block/revert instead of vertically warping the player');
});
