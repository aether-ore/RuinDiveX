import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../../../src/TraversalCapabilities.js';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';
import { assertAcceptedDungeonFixture } from '../helpers/accepted-fixture.mjs';

const GOLDEN_SEEDS = Object.freeze([
  Object.freeze({ seed: 'm1-golden-magma', undercroftType: 'magma' }),
  Object.freeze({ seed: 'm1-golden-electrical', undercroftType: 'electrical' }),
]);

const ORDINARY_KEYCARDS = Object.freeze([
  Object.freeze({ rewardId: 'reward.keycard-alpha', keycardId: 'Keycard_Alpha', displayName: 'Alpha Keycard' }),
  Object.freeze({ rewardId: 'reward.keycard-beta', keycardId: 'Keycard_Beta', displayName: 'Beta Keycard' }),
  Object.freeze({ rewardId: 'reward.keycard-gamma', keycardId: 'Keycard_Gamma', displayName: 'Gamma Keycard' }),
]);

// DungeonController clamps ordinary V2 pedestal pickups to this radius. This
// fixture proves a real capsule can reach the card inside the automatic-pickup
// envelope; the plan's larger prompt radius is not accepted as a substitute.
const AUTOMATIC_PICKUP_RADIUS = 1.45;
const AUTOMATIC_PICKUP_PROBE_MARGIN = 0.02;

// These are the production CameraController defaults and Game camera values.
// A keycard does not count as visible because a test camera was placed directly
// in front of it; it must fit the real third-person view from a legal player
// standing position.
const CAMERA = Object.freeze({
  fov: 48,
  aspect: 16 / 9,
  near: 0.1,
  far: 120,
  distance: 6.8,
  height: 3.25,
  lookHeight: 1.35,
  lookAhead: 1.7,
});

const PLAYER = Object.freeze({
  radius: PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
  height: Math.max(PLAYER_TRAVERSAL_ENVELOPE.standingHeight, 2.6),
  floorContactBand: 0.21,
});

const EPSILON = 1e-5;

function acceptedGolden({ seed, undercroftType }) {
  const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2({
    seed,
    undercroftType,
  }));
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  assertAcceptedDungeonFixture(validation.plan, { stage: 'plan', profile: 'golden' });
  return validation.plan;
}

function keycardBody(entry) {
  return entry.object?.getObjectByName('floatingKeycard') ?? null;
}

function keycardHalo(entry) {
  return entry.object?.getObjectByName('droppedKeycardHalo') ?? null;
}

function colliderBounds(collider) {
  if (collider?.bounds?.min && collider?.bounds?.max) return collider.bounds;
  const center = collider?.position ?? collider?.center;
  const verticalHalfHeight = collider?.verticalHalfHeight
    ?? (Number.isFinite(collider?.height) ? collider.height * 0.5 : null);
  if (!center || !Number.isFinite(collider?.halfWidth)
    || !Number.isFinite(collider?.halfDepth) || !Number.isFinite(verticalHalfHeight)) return null;
  return {
    min: {
      x: center.x - collider.halfWidth,
      y: Number.isFinite(collider.baseY) ? collider.baseY : center.y - verticalHalfHeight,
      z: center.z - collider.halfDepth,
    },
    max: {
      x: center.x + collider.halfWidth,
      y: Number.isFinite(collider.topY) ? collider.topY : center.y + verticalHalfHeight,
      z: center.z + collider.halfDepth,
    },
  };
}

function pointInsideSurfaceWithCapsule(point, surface) {
  const bounds = surface?.bounds;
  return Boolean(bounds
    && point.x >= bounds.min.x + PLAYER.radius - EPSILON
    && point.x <= bounds.max.x - PLAYER.radius + EPSILON
    && point.z >= bounds.min.z + PLAYER.radius - EPSILON
    && point.z <= bounds.max.z - PLAYER.radius + EPSILON
    && Math.abs(point.y - bounds.max.y) <= 0.051);
}

function capsuleIntersectsBounds(point, bounds) {
  if (!bounds) return false;
  const closestX = THREE.MathUtils.clamp(point.x, bounds.min.x, bounds.max.x);
  const closestZ = THREE.MathUtils.clamp(point.z, bounds.min.z, bounds.max.z);
  const horizontalOverlap = Math.hypot(point.x - closestX, point.z - closestZ)
    < PLAYER.radius - EPSILON;
  const bodyMinY = point.y + PLAYER.floorContactBand;
  const bodyMaxY = point.y + PLAYER.height;
  return horizontalOverlap
    && bounds.max.y > bodyMinY + EPSILON
    && bounds.min.y < bodyMaxY - EPSILON;
}

function allowedApproachDirections(action, anchor) {
  const forward = new THREE.Vector3(
    Number(anchor.forward?.x) || 0,
    0,
    Number(anchor.forward?.z) || 0,
  );
  if (forward.lengthSq() <= EPSILON) forward.set(0, 0, 1);
  forward.normalize();
  if (action.interaction.activationSide === 'back') return [forward.multiplyScalar(-1)];
  if (!['either', 'any'].includes(action.interaction.activationSide)) return [forward];
  const lateral = new THREE.Vector3(-forward.z, 0, forward.x);
  return [
    forward,
    forward.clone().multiplyScalar(-1),
    lateral,
    lateral.clone().multiplyScalar(-1),
  ];
}

function candidateApproaches(plan, facade, action, anchor, pedestalBounds, pickupPosition) {
  const promptRadius = Number(action.interaction?.radius);
  assert.ok(Number.isFinite(promptRadius) && promptRadius > PLAYER.radius,
    `${action.id} lacks a finite physical prompt radius`);
  assert.ok(promptRadius + EPSILON >= AUTOMATIC_PICKUP_RADIUS,
    `${action.id} prompt radius is smaller than the production automatic-pickup radius`);
  const surface = plan.walkableSurfaces.find(({ id }) => (
    id === (anchor.surfaceId ?? anchor.safeSurfaceId)
  ));
  assert.ok(surface, `${anchor.id} has no authored supporting surface`);
  assert.ok(!surface.ramp && surface.shape !== 'ramp',
    `${anchor.id} placed a pedestal on a sloped surface`);

  const center = new THREE.Vector3(
    (pedestalBounds.min.x + pedestalBounds.max.x) * 0.5,
    surface.bounds.max.y,
    (pedestalBounds.min.z + pedestalBounds.max.z) * 0.5,
  );
  const halfX = (pedestalBounds.max.x - pedestalBounds.min.x) * 0.5;
  const halfZ = (pedestalBounds.max.z - pedestalBounds.min.z) * 0.5;
  const colliders = [...facade.structuralRegistry.colliders.values()]
    .filter((collider) => collider?.active !== false && collider?.enabled !== false)
    .map((collider) => ({ collider, bounds: colliderBounds(collider) }))
    .filter(({ bounds }) => bounds);

  const attempts = [];
  for (const direction of allowedApproachDirections(action, anchor)) {
    const pedestalExtent = Math.abs(direction.x) * halfX + Math.abs(direction.z) * halfZ;
    const minimumDistance = pedestalExtent + PLAYER.radius + 0.16;
    const maximumProbeDistance = AUTOMATIC_PICKUP_RADIUS - AUTOMATIC_PICKUP_PROBE_MARGIN;
    const distances = [...new Set([
      minimumDistance,
      minimumDistance + 0.14,
      maximumProbeDistance,
    ].map((value) => Math.min(maximumProbeDistance, value))
      .filter((value) => value > PLAYER.radius && value <= maximumProbeDistance + EPSILON))];
    for (const distance of distances) {
      const position = center.clone().addScaledVector(direction, distance);
      const pickupDistance = position.distanceTo(pickupPosition);
      const blockedBy = colliders.filter(({ bounds }) => capsuleIntersectsBounds(position, bounds));
      attempts.push({
        position,
        direction: direction.clone(),
        distance,
        pickupDistance,
        surfaceId: surface.id,
        supported: pointInsideSurfaceWithCapsule(position, surface),
        blockedBy,
      });
    }
  }
  return attempts.filter(({ supported, blockedBy, pickupDistance }) => (
    supported
    && blockedBy.length === 0
    && pickupDistance <= AUTOMATIC_PICKUP_RADIUS + EPSILON
  ));
}

function visibleThroughAncestors(object) {
  for (let current = object; current; current = current.parent) {
    if (current.visible === false) return false;
  }
  return true;
}

function materialIsOpaque(material) {
  const entries = (Array.isArray(material) ? material : [material]).filter(Boolean);
  return entries.some((entry) => entry.visible !== false
    && (entry.transparent !== true || (Number(entry.opacity) || 0) >= 0.98));
}

function objectLabel(object) {
  for (let current = object; current; current = current.parent) {
    if (current.userData?.v2FixtureId) return current.userData.v2FixtureId;
    if (current.userData?.v2PlanId) return current.userData.v2PlanId;
    if (current.name) return current.name;
  }
  return object?.uuid ?? '<unknown-object>';
}

function frustumForCamera(camera) {
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  return new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
}

function boxCorners(box) {
  return [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ];
}

function productionCameraFromApproach(approach, cardCenter) {
  const facing = cardCenter.clone().sub(approach.position).setY(0);
  assert.ok(facing.lengthSq() > EPSILON, 'keycard approach coincides with its pedestal');
  facing.normalize();
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, CAMERA.aspect, CAMERA.near, CAMERA.far);
  camera.position.copy(approach.position)
    .addScaledVector(facing, -CAMERA.distance);
  camera.position.y += CAMERA.height;
  const lookTarget = approach.position.clone()
    .addScaledVector(facing, CAMERA.lookAhead);
  lookTarget.y += CAMERA.lookHeight;
  camera.lookAt(lookTarget);
  return { camera, facing, lookTarget };
}

function evaluatePhysicalKeycardView(facade, entry, approach) {
  const body = keycardBody(entry);
  assert.ok(body?.isMesh, `${entry.keycardId} lacks its opaque floating-card body`);
  facade.group.updateWorldMatrix(true, true);
  body.updateWorldMatrix(true, false);
  const cardBounds = new THREE.Box3().setFromObject(body);
  const cardCenter = cardBounds.getCenter(new THREE.Vector3());
  const { camera, lookTarget } = productionCameraFromApproach(approach, cardCenter);
  const frustum = frustumForCamera(camera);
  const cornersInside = boxCorners(cardBounds).every((corner) => frustum.containsPoint(corner));

  const ray = cardCenter.clone().sub(camera.position);
  const targetDistance = ray.length();
  ray.normalize();
  const raycaster = new THREE.Raycaster(camera.position, ray, CAMERA.near, targetDistance + 0.08);
  const hits = raycaster.intersectObjects(facade.group.children, true);
  let firstOpaqueHit = null;
  const ignoredPresentationHits = [];
  for (const hit of hits) {
    if (!visibleThroughAncestors(hit.object)) continue;
    const collisionPolicy = hit.object.userData?.v2CollisionPolicy;
    if (collisionPolicy === 'nonblocking-presentation'
      || !materialIsOpaque(hit.object.material)) {
      ignoredPresentationHits.push(objectLabel(hit.object));
      continue;
    }
    firstOpaqueHit = hit;
    break;
  }
  const reachesCard = firstOpaqueHit?.object === body;
  return {
    accepted: cornersInside && reachesCard,
    cornersInside,
    reachesCard,
    approach,
    camera,
    lookTarget,
    cardBounds,
    cardCenter,
    targetDistance,
    firstOpaqueHit,
    ignoredPresentationHits,
  };
}

function assertKeycardVisibleFromApproach(facade, entry, approach) {
  const result = evaluatePhysicalKeycardView(facade, entry, approach);
  assert.equal(result.cornersInside, true,
    `${entry.keycardId} does not fit the production camera frustum from its legal approach`);
  assert.equal(result.reachesCard, true,
    `${entry.keycardId} is occluded by ${objectLabel(result.firstOpaqueHit?.object)} before its card body`);
  return result;
}

function proveKeycardVisibility(plan, facade, expected) {
  const reward = plan.rewards.find(({ id }) => id === expected.rewardId);
  const action = plan.actions.find(({ id }) => id === reward?.actionId);
  const anchor = plan.anchors.find(({ id }) => id === reward?.anchorId);
  const entry = facade.keycards.find(({ keycardId }) => keycardId === expected.keycardId);
  assert.ok(reward && action && anchor && entry,
    `${expected.keycardId} lacks accepted plan/runtime ownership`);
  assert.equal(entry.object.parent, facade.group, `${expected.keycardId} is detached from the assembled dungeon`);
  assert.equal(visibleThroughAncestors(entry.object), true, `${expected.keycardId} is hidden before collection`);
  assert.equal(entry.displayName, expected.displayName,
    `${expected.keycardId} exposes a machine identifier instead of a readable pickup name`);
  assert.equal(entry.displayName.includes('_'), false,
    `${expected.keycardId} display name leaks its serialized identifier`);

  const fixtureId = reward.visualFixtureIds?.[0];
  const structuralRecord = facade.structuralRegistry.byPlanId.get(fixtureId);
  assert.ok(structuralRecord?.visualIds?.length > 0 && structuralRecord?.colliderIds?.length > 0,
    `${expected.keycardId} pedestal lacks real registered visual/collider ownership`);
  assert.equal(structuralRecord.visualIds.some((id) => (
    facade.structuralRegistry.visuals.get(id) === entry.pedestalObject
  )), true, `${expected.keycardId} runtime pedestal is not the registered plan visual`);
  assert.equal([...facade.structuralRegistry.visuals.values()].includes(entry.object), false,
    `${expected.keycardId} nonblocking pickup was confused with structural geometry`);
  assert.equal([...facade.structuralRegistry.visuals.values()].includes(keycardHalo(entry)), false,
    `${expected.keycardId} nonblocking halo was confused with structural geometry`);

  facade.group.updateWorldMatrix(true, true);
  const pedestalBounds = new THREE.Box3().setFromObject(entry.pedestalObject);
  const cardBounds = new THREE.Box3().setFromObject(keycardBody(entry));
  const pedestalCenter = pedestalBounds.getCenter(new THREE.Vector3());
  const cardCenter = cardBounds.getCenter(new THREE.Vector3());
  assert.ok(Math.abs(cardCenter.x - pedestalCenter.x) <= EPSILON
    && Math.abs(cardCenter.z - pedestalCenter.z) <= EPSILON,
  `${expected.keycardId} card body is not centered over its registered pedestal`);
  assert.ok(Math.abs(entry.pedestalTopY - pedestalBounds.max.y) <= EPSILON,
    `${expected.keycardId} runtime pedestal height disagrees with its assembled visual`);
  assert.ok(Math.abs(entry.visualRestY - (entry.pedestalTopY + 0.32)) <= EPSILON,
    `${expected.keycardId} hover position disagrees with the V1 pedestal presentation`);
  assert.ok(cardBounds.min.y > pedestalBounds.max.y,
    `${expected.keycardId} card body clips into its pedestal`);

  const approaches = candidateApproaches(
    plan,
    facade,
    action,
    anchor,
    pedestalBounds,
    entry.position,
  );
  assert.ok(approaches.length > 0,
    `${expected.keycardId} has no collision-free capsule approach inside the true ${AUTOMATIC_PICKUP_RADIUS}m automatic-pickup radius on ${anchor.surfaceId}`);
  assert.equal(approaches.every(({ pickupDistance }) => (
    pickupDistance <= AUTOMATIC_PICKUP_RADIUS + EPSILON
  )), true, `${expected.keycardId} accepted an approach outside the production automatic-pickup radius`);
  const attempts = approaches.map((approach) => evaluatePhysicalKeycardView(facade, entry, approach));
  const accepted = attempts.find((attempt) => attempt.accepted);
  assert.ok(accepted, `${expected.keycardId} has no legal production-camera view: ${JSON.stringify(
    attempts.map((attempt) => ({
      approach: attempt.approach.position.toArray(),
      pickupDistance: attempt.approach.pickupDistance,
      camera: attempt.camera.position.toArray(),
      cornersInside: attempt.cornersInside,
      firstOpaqueHit: objectLabel(attempt.firstOpaqueHit?.object),
      hitDistance: attempt.firstOpaqueHit?.distance ?? null,
      cardDistance: attempt.targetDistance,
    })),
  )}`);
  return accepted;
}

for (const fixture of GOLDEN_SEEDS) {
  test(`${fixture.seed} exposes Alpha, Beta, and Gamma as physically visible assembled keycards`, () => {
    const plan = acceptedGolden(fixture);
    const facade = assembleDungeonPlanV2(plan);
    try {
      for (const expected of ORDINARY_KEYCARDS) proveKeycardVisibility(plan, facade, expected);
    } finally {
      facade.dispose();
    }
  });
}

test('actual-seed keycard visibility gate rejects an opaque wall between a legal approach and card', () => {
  const plan = acceptedGolden(GOLDEN_SEEDS[0]);
  const facade = assembleDungeonPlanV2(plan);
  let wallGeometry = null;
  let wallMaterial = null;
  try {
    const proof = proveKeycardVisibility(plan, facade, ORDINARY_KEYCARDS[0]);
    const entry = facade.keycards.find(({ keycardId }) => keycardId === 'Keycard_Alpha');
    const midpoint = proof.camera.position.clone().lerp(proof.cardCenter, 0.5);
    wallGeometry = new THREE.BoxGeometry(2.4, 2.4, 0.3);
    wallMaterial = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const wall = new THREE.Mesh(wallGeometry, wallMaterial);
    wall.name = 'negativeFixtureOpaqueKeycardWall';
    wall.position.copy(midpoint);
    wall.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      proof.cardCenter.clone().sub(proof.camera.position).normalize(),
    );
    facade.group.add(wall);
    facade.structuralRegistry.register('negative-fixture.keycard-opaque-wall', {
      visual: wall,
      visualId: 'visual.negative-fixture.keycard-opaque-wall',
      collider: {
        id: 'negativeFixtureKeycardOpaqueWallCollider',
        position: midpoint.clone(),
        halfWidth: 1.2,
        halfDepth: 1.2,
        verticalHalfHeight: 1.2,
        active: true,
      },
      colliderId: 'collider.negative-fixture.keycard-opaque-wall',
      role: 'structural-fixture:test-opaque-wall',
      regionId: 'server',
    });
    facade.group.updateWorldMatrix(true, true);

    assert.throws(
      () => assertKeycardVisibleFromApproach(facade, entry, proof.approach),
      /occluded by (?:negative-fixture\.keycard-opaque-wall|negativeFixtureOpaqueKeycardWall)/,
      'visibility acceptance ignored an opaque prop/wall placed directly before the card',
    );
  } finally {
    facade.dispose();
    wallGeometry?.dispose();
    wallMaterial?.dispose();
  }
});
