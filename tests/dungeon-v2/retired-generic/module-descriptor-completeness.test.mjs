// RETIRED: documents the rejected generic Golden descriptor set; not acceptance coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSerializablePlanValue,
} from '../../../src/dungeon-v2/DungeonPlanV2Contract.js';
import {
  rotateBoundarySideQuarterTurns,
  rotatePointQuarterTurns,
  transformBoundsQuarterTurns,
} from '../../../src/dungeon-v2/DungeonSpatialMathV2.js';
import {
  GOLDEN_MODULE_DESCRIPTORS_V2,
  TRAVERSAL_LAB_MODULE_DESCRIPTORS_V2,
} from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';

const ALL_DESCRIPTORS = [
  ...GOLDEN_MODULE_DESCRIPTORS_V2,
  ...TRAVERSAL_LAB_MODULE_DESCRIPTORS_V2,
];

function descriptorFor(regionId) {
  return ALL_DESCRIPTORS.find((descriptor) => descriptor.id === `module.${regionId}.golden-v1`);
}

function assertFinitePoint(point, message) {
  assert.ok(point && ['x', 'y', 'z'].every((axis) => Number.isFinite(point[axis])), message);
}

function assertValidBounds(bounds, message) {
  assertFinitePoint(bounds?.min, `${message}:min`);
  assertFinitePoint(bounds?.max, `${message}:max`);
  assert.ok(['x', 'y', 'z'].every((axis) => bounds.max[axis] > bounds.min[axis]), message);
}

function collectPositionedData(value, path = 'descriptor', records = { bounds: [], points: [], sides: [] }) {
  if (!value || typeof value !== 'object') return records;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectPositionedData(entry, `${path}[${index}]`, records));
    return records;
  }

  if (value.min && value.max
    && ['x', 'y', 'z'].every((axis) => Number.isFinite(value.min?.[axis]) && Number.isFinite(value.max?.[axis]))) {
    records.bounds.push({ path, value });
    return records;
  }

  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    if (key === 'side' && typeof entry === 'string') {
      records.sides.push({ path: entryPath, value: entry });
      continue;
    }
    if (entry && typeof entry === 'object' && !Array.isArray(entry)
      && ['x', 'y', 'z'].every((axis) => Number.isFinite(entry[axis]))) {
      if (!['size', 'dimensions', 'minimumPlayerClearance'].includes(key)) {
        records.points.push({ path: entryPath, value: entry });
      }
      continue;
    }
    collectPositionedData(entry, entryPath, records);
  }
  return records;
}

test('every Golden and traversal-lab descriptor exposes the complete immutable plan-first contract', () => {
  assert.equal(GOLDEN_MODULE_DESCRIPTORS_V2.length, 17);
  assert.equal(TRAVERSAL_LAB_MODULE_DESCRIPTORS_V2.length, 9);

  for (const descriptor of ALL_DESCRIPTORS) {
    assert.equal(Object.isFrozen(descriptor), true, descriptor.id);
    assert.equal(isSerializablePlanValue(descriptor), true, descriptor.id);
    assert.doesNotThrow(() => JSON.stringify(descriptor), descriptor.id);
    assert.equal(JSON.stringify(descriptor).includes('THREE'), false, descriptor.id);

    assertValidBounds(descriptor.bounds, `${descriptor.id}:bounds`);
    assert.ok(descriptor.occupiedVolumes.length >= 4, `${descriptor.id}:occupied volumes include shell and functional fixtures`);
    descriptor.occupiedVolumes.forEach((volume) => assertValidBounds(volume.bounds, `${descriptor.id}:${volume.id}`));

    assert.equal(descriptor.regions.length, 1, descriptor.id);
    assertValidBounds(descriptor.regions[0].bounds, `${descriptor.id}:main-region`);
    assert.ok(descriptor.subRegions.length >= 1, descriptor.id);
    descriptor.subRegions.forEach((subRegion) => assertValidBounds(subRegion.bounds, `${descriptor.id}:${subRegion.id}`));

    assert.ok(descriptor.sockets.length >= 1, descriptor.id);
    assert.equal(new Set(descriptor.sockets.map((socket) => socket.id)).size, descriptor.sockets.length, descriptor.id);
    for (const socket of descriptor.sockets) {
      assertFinitePoint(socket.position, `${descriptor.id}:${socket.id}:position`);
      assertFinitePoint(socket.openingCenter, `${descriptor.id}:${socket.id}:opening-center`);
      assertFinitePoint(socket.inwardFacing, `${descriptor.id}:${socket.id}:facing`);
      assert.ok(socket.minimumPlayerClearance.width >= 1.2, `${descriptor.id}:${socket.id}`);
      assert.ok(socket.minimumPlayerClearance.height >= 3.2, `${descriptor.id}:${socket.id}`);
      assert.ok(socket.minimumCameraClearance >= 1.8, `${descriptor.id}:${socket.id}`);
    }

    assert.ok(descriptor.surfaces.length >= 1, descriptor.id);
    for (const surface of descriptor.surfaces) {
      assertValidBounds(surface.bounds, `${descriptor.id}:${surface.id}`);
      assert.equal(typeof surface.purpose, 'string', `${descriptor.id}:${surface.id}`);
      assert.equal(surface.visibleSupportRequired, true, `${descriptor.id}:${surface.id}`);
      assert.equal(typeof surface.platformPurposeId, 'string', `${descriptor.id}:${surface.id}`);
      assert.equal(typeof surface.supportPurposeId, 'string', `${descriptor.id}:${surface.id}`);
    }

    assert.equal(descriptor.traversalNodes.length, descriptor.subRegions.length + descriptor.sockets.length, descriptor.id);
    descriptor.traversalNodes.forEach((node) => assertFinitePoint(node.position, `${descriptor.id}:${node.id}`));
    assert.ok(descriptor.traversalEdges.length >= descriptor.sockets.length, descriptor.id);
    assert.ok(descriptor.traversalEdges.every((edge) => edge.routePoints.length >= 2), descriptor.id);

    assert.deepEqual(descriptor.boundarySegments.map((boundary) => boundary.side).sort(),
      ['ceiling', 'east', 'floor', 'north', 'south', 'west'], descriptor.id);
    for (const boundary of descriptor.boundarySegments) {
      assertValidBounds(boundary.bounds, `${descriptor.id}:${boundary.id}`);
      assert.equal(boundary.opaque, true, `${descriptor.id}:${boundary.id}`);
      assert.equal(boundary.collider, true, `${descriptor.id}:${boundary.id}`);
      for (const socketId of boundary.socketIds) {
        assert.ok(descriptor.sockets.some((socket) => socket.id === socketId), `${descriptor.id}:${boundary.id}:${socketId}`);
      }
    }

    assert.ok(Array.isArray(descriptor.fallApertures), descriptor.id);
    assert.ok(Array.isArray(descriptor.fallCatchments), descriptor.id);
    assert.ok(Array.isArray(descriptor.basins), descriptor.id);
    assert.deepEqual(descriptor.waterBasins, descriptor.basins, descriptor.id);
    assert.ok(Array.isArray(descriptor.hazardSurfaces), descriptor.id);
    assert.ok(Array.isArray(descriptor.controllers), descriptor.id);
    assert.ok(Array.isArray(descriptor.controls), descriptor.id);
    assert.ok(Array.isArray(descriptor.mechanisms), descriptor.id);
    assert.ok(Array.isArray(descriptor.encounterAnchors), descriptor.id);
    assert.ok(Array.isArray(descriptor.rewardAnchors), descriptor.id);
    assert.ok(descriptor.safeAnchors.length >= 1, descriptor.id);
    assert.ok(descriptor.safeAnchors.every((anchor) => anchor.damageFree === true), descriptor.id);

    assert.equal(descriptor.platformPurposes.length, descriptor.platformPurposeContracts.length, descriptor.id);
    assert.deepEqual(descriptor.platformPurposeContracts.map((contract) => contract.id), descriptor.platformPurposes, descriptor.id);
    assert.equal(typeof descriptor.presentation.profileId, 'string', descriptor.id);
    assert.equal(descriptor.presentation.exteriorVoidMaskingAllowed, false, descriptor.id);
    assert.equal(descriptor.material.opaqueStructuralShell, true, descriptor.id);
    assert.ok(descriptor.authoredFunctionalFixtures.length >= 3, descriptor.id);
    descriptor.authoredFunctionalFixtures.forEach((fixture) => {
      assertValidBounds(fixture.localBounds, `${descriptor.id}:${fixture.id}`);
      assert.equal(fixture.collision, 'blocking', `${descriptor.id}:${fixture.id}`);
      assert.equal(fixture.reachableCollisionRequired, true, `${descriptor.id}:${fixture.id}`);
    });
  }
});

test('semantic descriptor families carry positioned authored content rather than empty placeholders', () => {
  assert.deepEqual(descriptorFor('assembly').mechanisms.map((entry) => entry.type), ['crumbling-floor']);
  assert.deepEqual(descriptorFor('sorting').mechanisms.map((entry) => entry.type), ['moving-cargo']);
  assert.deepEqual(descriptorFor('reservoir').mechanisms.map((entry) => entry.type), ['water-router']);
  assert.deepEqual(descriptorFor('salvage-tunnel').mechanisms.map((entry) => entry.type), ['cargo-lift']);
  assert.deepEqual(descriptorFor('corkscrew').mechanisms.map((entry) => entry.type), ['corkscrew-gear']);
  assert.deepEqual(descriptorFor('hazard-core').mechanisms.map((entry) => entry.type), ['cargo-lift', 'environmental-hazard']);
  assert.deepEqual(descriptorFor('lab-upper').mechanisms.map((entry) => entry.type), ['moving-cargo']);
  assert.deepEqual(descriptorFor('lab-gear').mechanisms.map((entry) => entry.type), ['crumbling-floor', 'corkscrew-gear']);
  assert.deepEqual(descriptorFor('lab-recovery').mechanisms.map((entry) => entry.type), ['cargo-lift']);

  for (const regionId of ['freight-sump', 'reservoir', 'gantry-sump', 'lab-water-freight', 'lab-water-reservoir', 'lab-water-gantry']) {
    const descriptor = descriptorFor(regionId);
    assert.equal(descriptor.basins.length, 1, regionId);
    assert.equal(descriptor.basins[0].capacityUnits, 1, regionId);
    assert.equal(descriptor.basins[0].exactFilledVolume, 600, regionId);
    assert.equal(descriptor.basins[0].movementProfile.groundMovementMultiplier, 0.76, regionId);
    assert.equal(descriptor.basins[0].movementProfile.jumpHeight, 4.95, regionId);
    assert.equal(descriptor.basins[0].movementProfile.gravityScale, 0.28, regionId);
  }

  assert.equal(descriptorFor('hazard-core').hazardSurfaces.length, 1);
  assert.equal(descriptorFor('lab-hazards').hazardSurfaces.length, 2);
  assert.equal(descriptorFor('assembly').fallApertures.length, 1);
  assert.equal(descriptorFor('lab-gear').fallApertures.length, 1);
  assert.equal(descriptorFor('freight').fallCatchments.length, 1);
  assert.equal(descriptorFor('lab-recovery').fallCatchments.length, 1);

  const encounters = GOLDEN_MODULE_DESCRIPTORS_V2.flatMap((descriptor) => descriptor.encounterAnchors);
  assert.deepEqual(encounters.map((entry) => entry.id).sort(), [
    'encounter.assembly',
    'encounter.machine-core',
    'encounter.nest',
    'encounter.sorting',
  ]);
  assert.ok(GOLDEN_MODULE_DESCRIPTORS_V2.flatMap((descriptor) => descriptor.rewardAnchors).length >= 10);
  assert.ok(descriptorFor('reservoir').controls.every((control) => control.type === 'water-router'));
  assert.equal(descriptorFor('salvage-tunnel').mechanisms[0].recallable, true);
  assert.equal(descriptorFor('salvage-tunnel').mechanisms[0].automaticTravel, true);
  assert.equal(descriptorFor('lab-recovery').mechanisms[0].recallable, true);
  assert.equal(descriptorFor('lab-recovery').mechanisms[0].automaticTravel, true);
});

test('all descriptor bounds, anchors, routes, controls, sockets, and fixture points transform at every supported yaw', () => {
  let boundCount = 0;
  let pointCount = 0;
  let sideCount = 0;
  for (const descriptor of ALL_DESCRIPTORS) {
    const serializedBefore = JSON.stringify(descriptor);
    const positioned = collectPositionedData(descriptor, descriptor.id);
    boundCount += positioned.bounds.length;
    pointCount += positioned.points.length;
    sideCount += positioned.sides.length;
    for (const yawQuarterTurns of [0, 1, 2, 3]) {
      for (const record of positioned.bounds) {
        const transformed = transformBoundsQuarterTurns(record.value, { yawQuarterTurns, translation: { x: 17, y: -3, z: 29 } });
        assertValidBounds(transformed, `${record.path}:yaw-${yawQuarterTurns}`);
      }
      for (const record of positioned.points) {
        const transformed = rotatePointQuarterTurns(record.value, yawQuarterTurns);
        assertFinitePoint(transformed, `${record.path}:yaw-${yawQuarterTurns}`);
        assert.equal(transformed.y, record.value.y, `${record.path}:yaw-${yawQuarterTurns}:elevation`);
      }
      for (const record of positioned.sides) {
        assert.doesNotThrow(() => rotateBoundarySideQuarterTurns(record.value, yawQuarterTurns), `${record.path}:yaw-${yawQuarterTurns}`);
      }
    }
    assert.equal(JSON.stringify(descriptor), serializedBefore, `${descriptor.id}:transform purity`);
  }
  assert.ok(boundCount > 350, `expected comprehensive positioned bounds, received ${boundCount}`);
  assert.ok(pointCount > 350, `expected comprehensive positioned points, received ${pointCount}`);
  assert.ok(sideCount >= ALL_DESCRIPTORS.length * 6, `expected every structural side, received ${sideCount}`);
});
