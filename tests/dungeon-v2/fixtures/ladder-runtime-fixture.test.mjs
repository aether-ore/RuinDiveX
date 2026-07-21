import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createGoldenDungeonPlanV2,
  createTraversalLabPlanV2,
} from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';
import { buildLadderRuntimeProofs } from '../helpers/assembly-proofs.mjs';

const REQUIRED_WALK_AWAY_METRES = 1.2;

function horizontallyOverlaps(left, right, tolerance = 0.001) {
  return left.min.x < right.max.x - tolerance
    && left.max.x > right.min.x + tolerance
    && left.min.z < right.max.z - tolerance
    && left.max.z > right.min.z + tolerance;
}

function samePoint(left, right, tolerance = 0.001) {
  return Math.hypot(
    Number(left?.x) - Number(right?.x),
    Number(left?.y) - Number(right?.y),
    Number(left?.z) - Number(right?.z),
  ) <= tolerance;
}

function containsContiguousPointSequence(route, expected) {
  return route.some((point, startIndex) => expected.every((expectedPoint, offset) => (
    samePoint(route[startIndex + offset], expectedPoint)
  )));
}

function assertPlanRoutesOwnLadderMounts(plan) {
  const surfaceById = new Map(plan.walkableSurfaces.map((surface) => [surface.id, surface]));
  for (const portal of plan.portals) {
    const route = portal.physicalRoute?.routePoints ?? [];
    const connectorLadders = (portal.physicalRoute?.surfaceIds ?? [])
      .map((surfaceId) => surfaceById.get(surfaceId))
      .filter(({ geometry } = {}) => geometry?.type === 'ladder');
    for (const surface of connectorLadders) {
      const geometry = surface.geometry;
      const [firstRoot, secondRoot] = geometry.path;
      const bottomRoot = firstRoot.y <= secondRoot.y ? firstRoot : secondRoot;
      const topRoot = firstRoot.y > secondRoot.y ? firstRoot : secondRoot;
      const descending = [geometry.topExit, topRoot, bottomRoot, geometry.bottomExit];
      const ascending = descending.slice().reverse();
      assert.ok(
        containsContiguousPointSequence(route, descending)
          || containsContiguousPointSequence(route, ascending),
        `${portal.id} public route does not own ${surface.id}'s exit/mount/root sequence: ${JSON.stringify(route)}`,
      );
    }
  }
  for (const link of plan.traversalLinks.filter(({ viaSurfaceId }) => (
    surfaceById.get(viaSurfaceId)?.geometry?.type === 'ladder'
  ))) {
    const geometry = surfaceById.get(link.viaSurfaceId).geometry;
    const [firstRoot, secondRoot] = geometry.path;
    const bottomRoot = firstRoot.y <= secondRoot.y ? firstRoot : secondRoot;
    const topRoot = firstRoot.y > secondRoot.y ? firstRoot : secondRoot;
    const ascending = [geometry.bottomExit, bottomRoot, topRoot, geometry.topExit];
    const descending = ascending.slice().reverse();
    assert.ok(
      containsContiguousPointSequence(link.waypoints ?? [], ascending)
        || containsContiguousPointSequence(link.waypoints ?? [], descending),
      `${link.id} does not own ${link.viaSurfaceId}'s exit/mount/root sequence`,
    );
  }
}

function assertLadderRootsAndExitsMatchLandingTops(plan) {
  const surfaceById = new Map(plan.walkableSurfaces.map((surface) => [surface.id, surface]));
  for (const ladderSurface of plan.walkableSurfaces.filter(({ geometry }) => geometry?.type === 'ladder')) {
    const geometry = ladderSurface.geometry;
    const [firstRoot, secondRoot] = geometry.path;
    const endpoints = firstRoot.y <= secondRoot.y
      ? { bottom: firstRoot, top: secondRoot }
      : { bottom: secondRoot, top: firstRoot };
    for (const endpointName of ['bottom', 'top']) {
      const landing = geometry.landings?.[endpointName];
      const landingSurface = surfaceById.get(landing?.surfaceId);
      assert.ok(landingSurface,
        `${ladderSurface.id} ${endpointName} has no referenced landing surface`);
      const exactTopY = landingSurface.bounds.max.y;
      assert.ok(Math.abs(endpoints[endpointName].y - exactTopY) <= 1e-9,
        `${ladderSurface.id} ${endpointName} root differs from ${landingSurface.id} by ${endpoints[endpointName].y - exactTopY}m`);
      assert.ok(Math.abs(geometry[`${endpointName}Exit`].y - exactTopY) <= 1e-9,
        `${ladderSurface.id} ${endpointName} exit differs from ${landingSurface.id} by ${geometry[`${endpointName}Exit`].y - exactTopY}m`);
    }
  }
}

function assertEveryLadderEndWalksAway(plan, facade) {
  assertPlanRoutesOwnLadderMounts(plan);
  assertLadderRootsAndExitsMatchLandingTops(plan);
  const authoredLadders = plan.walkableSurfaces.filter(({ geometry }) => geometry?.type === 'ladder');
  const proof = buildLadderRuntimeProofs(plan, facade);
  assert.equal(proof.ladderCount, authoredLadders.length,
    'runtime proof must exercise every plan-owned ladder, not a hand-picked subset');
  assert.equal(proof.accepted, true, JSON.stringify(proof.rejectedLadders, null, 2));

  for (const ladderProof of proof.ladderProofs) {
    assert.deepEqual(ladderProof.directions.map(({ direction }) => direction).sort(), ['down', 'up']);
    for (const directionProof of ladderProof.directions) {
      assert.ok(directionProof.egress,
        `${ladderProof.ladderId}:${directionProof.direction} did not reach an ordinary walk-away test`);
      assert.equal(directionProof.egress.jumpInputUsed, false);
      assert.deepEqual(directionProof.egress.inputCodes, ['KeyW']);
      assert.ok(directionProof.egress.authoredClearLength >= REQUIRED_WALK_AWAY_METRES);
      assert.ok(directionProof.egress.maximumProjectedDistance + 0.001
        >= REQUIRED_WALK_AWAY_METRES);
      assert.equal(directionProof.egress.remainedGrounded, true);
      assert.equal(directionProof.egress.supportLost, false);
      assert.equal(directionProof.egress.snapBackDetected, false);
      assert.equal(directionProof.egress.safeguardActivations, 0);
      assert.ok(directionProof.egress.sampleFrames.every(({ supportSurfaceId }) => supportSurfaceId));
    }
  }

  const tileSize = plan.tileSize ?? 1.4;
  for (const surface of authoredLadders) {
    const opening = surface.geometry.topOpening?.bounds;
    assert.ok(opening, `${surface.id} must expose a visible top aperture`);
    const coveringTiles = facade.floorTiles.filter((tile) => {
      const worldX = Number(tile.x) * tileSize;
      const worldZ = Number(tile.z) * tileSize;
      return Number(tile.elevation) >= opening.min.y - 0.05
        && Number(tile.elevation) <= opening.max.y + 0.05
        && worldX >= opening.min.x && worldX <= opening.max.x
        && worldZ >= opening.min.z && worldZ <= opening.max.z;
    });
    assert.deepEqual(coveringTiles.map(({ id }) => id), [],
      `${surface.id} is hidden by generated floor-tile metadata`);
    const coveringPlatforms = facade.platforms.filter((platform) => (
      Math.abs(platform.topY - surface.geometry.path.at(-1).y) <= 0.05
      && horizontallyOverlaps(opening, {
        min: {
          x: platform.center.x - platform.halfWidth,
          z: platform.center.z - platform.halfDepth,
        },
        max: {
          x: platform.center.x + platform.halfWidth,
          z: platform.center.z + platform.halfDepth,
        },
      })
    ));
    assert.deepEqual(coveringPlatforms.map(({ id }) => id), [],
      `${surface.id} is physically capped by an assembled walkable platform`);
  }
}

test('assembled traversal-lab ladders mount, climb, and dismount at both authored exits', () => {
  const validation = validateDungeonPlanV2(createTraversalLabPlanV2({
    seed: 'm1-ladder-runtime-fixture',
  }));
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  const facade = assembleDungeonPlanV2(validation.plan);
  try {
    assertPlanRoutesOwnLadderMounts(validation.plan);
    assertLadderRootsAndExitsMatchLandingTops(validation.plan);
    const proof = buildLadderRuntimeProofs(validation.plan, facade);
    assert.ok(proof.ladderCount > 0, 'traversal lab must exercise at least one real ladder');
    assert.equal(proof.accepted, true, JSON.stringify(proof.rejectedLadders, null, 2));
    assert.deepEqual(proof.rejectedLadders, []);
    for (const ladderProof of proof.ladderProofs) {
      for (const directionProof of ladderProof.directions) {
        assert.equal(directionProof.egress.publicPlayerUpdate, true);
        assert.equal(directionProof.egress.publicControllerConstraint, true);
        assert.deepEqual(directionProof.egress.inputCodes, ['KeyW']);
        assert.equal(directionProof.egress.jumpInputUsed, false);
        assert.equal(directionProof.egress.remainedGrounded, true);
        assert.equal(directionProof.egress.supportLost, false);
        assert.equal(directionProof.egress.snapBackDetected, false);
        assert.ok(directionProof.egress.maximumProjectedDistance + 0.001
          >= directionProof.egress.authoredClearLength);
        assert.ok(directionProof.egress.sampleFrames.every(({ supportSurfaceId }) => supportSurfaceId));
      }
    }
  } finally {
    facade.dispose();
  }
});

for (const [label, createPlan] of [
  ['golden magma', () => createGoldenDungeonPlanV2({
    seed: 'm1-ladder-all-ends-magma',
    undercroftType: 'magma',
  })],
  ['golden electrical', () => createGoldenDungeonPlanV2({
    seed: 'm1-ladder-all-ends-electrical',
    undercroftType: 'electrical',
  })],
]) {
  test(`${label} assembles every ladder with two visible, grounded 1.2m walk-away routes`, () => {
    const validation = validateDungeonPlanV2(createPlan());
    assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
    const facade = assembleDungeonPlanV2(validation.plan);
    try {
      assertEveryLadderEndWalksAway(validation.plan, facade);
    } finally {
      facade.dispose();
    }
  });
}

test('assembled ladder proof rejects a real blocker in the bottom walk-away route', () => {
  const validation = validateDungeonPlanV2(createTraversalLabPlanV2({
    seed: 'm1-ladder-egress-blocker-negative',
  }));
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  const facade = assembleDungeonPlanV2(validation.plan);
  try {
    const ladder = facade.ladders[0];
    assert.ok(ladder?.landings?.bottom, 'negative fixture requires a bottom landing contract');
    const direction = new THREE.Vector3(
      ladder.bottomExitFacing.x,
      0,
      ladder.bottomExitFacing.z,
    ).normalize();
    const center = ladder.bottomExit.clone().addScaledVector(direction, 0.55);
    const halfWidth = Math.abs(direction.x) > 0.5 ? 0.14 : 0.7;
    const halfDepth = Math.abs(direction.z) > 0.5 ? 0.14 : 0.7;
    facade.solidZones.push({
      id: 'fixture.blocked-ladder-bottom-egress',
      planId: 'fixture.blocked-ladder-bottom-egress',
      position: new THREE.Vector3(center.x, center.y + 1.6, center.z),
      halfWidth,
      halfDepth,
      verticalHalfHeight: 1.6,
      bounds: {
        min: { x: center.x - halfWidth, y: center.y, z: center.z - halfDepth },
        max: { x: center.x + halfWidth, y: center.y + 3.2, z: center.z + halfDepth },
      },
      active: true,
      obstacleKind: 'fixture',
      allowFlyOver: false,
    });
    const proof = buildLadderRuntimeProofs(validation.plan, facade);
    const blocked = proof.ladderProofs
      .find(({ ladderId }) => ladderId === ladder.id)
      ?.directions.find(({ direction: traversalDirection }) => traversalDirection === 'down');
    assert.ok(blocked?.egress, JSON.stringify(proof.rejectedLadders, null, 2));
    assert.equal(blocked.egress.accepted, false);
    assert.equal(blocked.egress.snapBackDetected, true);
    assert.ok(blocked.egress.maximumProjectedDistance + 0.001
      < blocked.egress.authoredClearLength);
    assert.equal(proof.accepted, false);
  } finally {
    facade.dispose();
  }
});
