import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';
import { LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2 } from '../../../src/dungeon-v2/LegacyAuthoredRuntimeKitV2.js';

// Instanced matrices are uploaded as Float32; world positions near x=200m
// retain roughly 1e-5m precision. This is still twenty times tighter than the
// authored 1mm panel/landing seam contract.
const EPSILON = 5e-5;
const FIXTURES = Object.freeze([
  Object.freeze({ seed: 'm1-golden-magma', undercroftType: 'magma' }),
  Object.freeze({ seed: 'm1-golden-electrical', undercroftType: 'electrical' }),
]);

function close(actual, expected, message, tolerance = EPSILON) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual}`);
}

function closePoint(actual, expected, message) {
  for (const axis of ['x', 'y', 'z']) close(actual[axis], expected[axis], `${message}.${axis}`);
}

function stairSurfaces(plan) {
  return plan.walkableSurfaces.filter((surface) => (
    surface.stairs
    || surface.form === 'stairs'
    || ['stairs', 'walkable-stairs'].includes(surface.geometry?.type)
    || surface.shape === 'ramp-tile'
  ));
}

function endpointPath(surface) {
  const geometry = surface.stairs ?? surface.geometry ?? surface;
  const start = geometry.start ?? geometry.path?.[0];
  const end = geometry.end ?? geometry.path?.at(-1);
  assert.ok(start && end, `${surface.id} owns explicit ramp endpoints`);
  return { start, end };
}

function instanceWorldMatrix(batch, index) {
  const local = new THREE.Matrix4();
  batch.getMatrixAt(index, local);
  return new THREE.Matrix4().multiplyMatrices(batch.matrixWorld, local);
}

function assertActualTopFaceUvRange(panelBatch, surfaceId) {
  const position = panelBatch.geometry.getAttribute('position');
  const normal = panelBatch.geometry.getAttribute('normal');
  const uv = panelBatch.geometry.getAttribute('uv');
  assert.ok(position && normal && uv && position.count === uv.count,
    `${surfaceId} panel batch owns actual UV buffers`);
  const topUvs = [];
  for (let index = 0; index < normal.count; index += 1) {
    if (normal.getY(index) > 0.999) topUvs.push({ u: uv.getX(index), v: uv.getY(index) });
  }
  assert.equal(topUvs.length, 4, `${surfaceId} has one independently tiled top face`);
  const rangeU = Math.max(...topUvs.map(({ u }) => u)) - Math.min(...topUvs.map(({ u }) => u));
  const rangeV = Math.max(...topUvs.map(({ v }) => v)) - Math.min(...topUvs.map(({ v }) => v));
  const dimensions = panelBatch.userData.v2TextureTiling.dimensions;
  close(rangeU, dimensions.x / LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2,
    `${surfaceId} top-face width repeat`);
  close(rangeV, dimensions.z / LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2,
    `${surfaceId} top-face run repeat`);
  close(panelBatch.userData.v2TextureTiling.faceRepeats.x.v,
    dimensions.y / LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2,
    `${surfaceId} thin ramp edge retains exact physical texture scale`);
  assert.ok(panelBatch.userData.v2TextureTiling.faceRepeats.x.v < 1,
    `${surfaceId} must show a fractional source panel on its thin edge instead of squeezing a full tile`);
  assert.equal(panelBatch.material.map.wrapS, THREE.RepeatWrapping, `${surfaceId} wrapS`);
  assert.equal(panelBatch.material.map.wrapT, THREE.RepeatWrapping, `${surfaceId} wrapT`);
}

function assertRampVisual(plan, facade, surface) {
  const root = facade.environmentRuntime.resources.surfaceObjects.get(surface.id);
  assert.ok(root?.isGroup, `${surface.id} assembles as a V1-derived ramp run`);
  const contract = root.userData.v2RampPanelContract;
  assert.equal(contract?.source, 'DungeonGenerator._createFloorTileMesh');
  assert.equal(contract?.sourceStyle, 'v1-industrial-ramp-tiles');
  assert.equal(contract?.tileWorldSize, LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2);
  assert.equal(contract?.collisionAuthority, 'plan-owned-continuous-oriented-ramp-strip');

  const panelBatch = root.children.find((child) => child.userData.v2V1RampPanelBatch === true);
  const stringerBatch = root.children.find((child) => child.userData.v2StairSupport === true);
  assert.ok(panelBatch?.isInstancedMesh, `${surface.id} owns an instanced visible panel run`);
  assert.ok(stringerBatch?.isInstancedMesh, `${surface.id} owns visible load-bearing stringers`);

  const { start, end } = endpointPath(surface);
  const horizontalLength = Math.hypot(end.x - start.x, end.z - start.z);
  const expectedPanelCount = Math.ceil(horizontalLength / LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2);
  assert.equal(panelBatch.count, expectedPanelCount, `${surface.id} uses one V1-scale panel per 2.8m run`);
  assert.ok(panelBatch.count >= 2, `${surface.id} must not regress to one monolithic incline`);
  assert.equal(panelBatch.userData.v2RampPanels.length, panelBatch.count);
  assert.ok(contract.horizontalPanelRun <= LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2 + EPSILON);
  assertActualTopFaceUvRange(panelBatch, surface.id);

  root.updateWorldMatrix(true, true);
  const panelHalfThickness = contract.panelThickness * 0.5;
  const localStart = new THREE.Vector3(0, panelHalfThickness, -contract.slopePanelLength * 0.5);
  const localEnd = new THREE.Vector3(0, panelHalfThickness, contract.slopePanelLength * 0.5);
  let previousEnd = null;
  for (let index = 0; index < panelBatch.count; index += 1) {
    const matrix = instanceWorldMatrix(panelBatch, index);
    const actualStart = localStart.clone().applyMatrix4(matrix);
    const actualEnd = localEnd.clone().applyMatrix4(matrix);
    const authoredPanel = panelBatch.userData.v2RampPanels[index];
    closePoint(actualStart, authoredPanel.start, `${surface.id} panel ${index} exact top start`);
    closePoint(actualEnd, authoredPanel.end, `${surface.id} panel ${index} exact top end`);
    if (previousEnd) closePoint(actualStart, previousEnd, `${surface.id} panel seam ${index - 1}/${index}`);
    previousEnd = actualEnd;
  }
  closePoint(panelBatch.userData.v2RampPanels[0].start, start, `${surface.id} lower landing flush edge`);
  closePoint(panelBatch.userData.v2RampPanels.at(-1).end, end, `${surface.id} upper landing flush edge`);

  assert.equal(stringerBatch.count, 2, `${surface.id} has paired stringers`);
  assert.deepEqual(stringerBatch.userData.v2SupportBoundaryIds, surface.supportBoundaryIds,
    `${surface.id} stringers retain exact plan support ownership`);
  assert.equal(stringerBatch.userData.v2SupportProfile,
    surface.supportProfile ?? 'continuous-stair-stringers-v2');
  assert.equal(stringerBatch.userData.v2CollisionAuthority, `${surface.id}:sampled-ramp-collider`);
  stringerBatch.computeBoundingBox();
  assert.equal(stringerBatch.boundingBox.isEmpty(), false, `${surface.id} stringers have actual visible geometry`);

  const registryRecord = facade.structuralRegistry.byPlanId.get(surface.id);
  assert.ok(registryRecord, `${surface.id} is registered by plan identity`);
  const colliders = registryRecord.colliderIds.map((id) => facade.structuralRegistry.colliders.get(id));
  assert.ok(colliders.some((collider) => (
    collider.shape === 'oriented-ramp-strip'
      && collider.surfaceType === 'exact-oriented-ramp-strip'
      && collider.ledgeClimbDisabled === true
  )), `${surface.id} retains its continuous plan-owned collision strip`);
}

for (const fixture of FIXTURES) {
  test(`${fixture.seed} assembles every generic stair as supported V1-scale ramp panels`, () => {
    const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2(fixture));
    assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
    const facade = assembleDungeonPlanV2(validation.plan);
    try {
      const surfaces = stairSurfaces(validation.plan).filter((surface) => (
        facade.environmentRuntime.resources.surfaceObjects.get(surface.id)?.isGroup
      ));
      assert.ok(surfaces.length >= 20,
        `${fixture.seed} exposes only ${surfaces.length} generic authored ramp runs`);
      for (const surface of surfaces) assertRampVisual(validation.plan, facade, surface);
    } finally {
      facade.dispose();
    }
  });
}
