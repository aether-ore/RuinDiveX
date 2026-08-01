import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';

function v4FrameFixture() {
  const themeBinding = { themeId: 'industrial-v1' };
  const floor = {
    x: 0,
    z: 0,
    elevation: 0,
    augmentationFloorCellId: 'segment-1:floor:0',
    signedConnectorFloorOwnerId: 'segment-1',
    walkabilityIntent: 'required-clear',
  };
  const section = {
    pathIndex: 2,
    center: { x: 0, z: 0 },
    direction: { x: 1, z: 0 },
    elevation: 0,
    ceilingY: 8.4,
    connectorZone: 'main_gallery',
  };
  const plan = {
    id: 'segment-1',
    isDungeonSupplement: true,
    augmentationOperationType: 'routeNetwork',
    augmentationOperationId: 'operation-1',
    routeNetworkGrantId: 'grant-1',
    augmentationThemeBinding: themeBinding,
    bridgePath: [
      { x: 0, z: -2 },
      { x: 0, z: -1 },
      { x: 0, z: 0 },
      { x: 1, z: 0 },
    ],
    galleryCrossSections: [{ pathIndex: 2, sections: [section] }],
    fromSocket: { connectorJunctionProxyId: 'junction-proxy-1' },
    connectorJunctionProxyIds: ['junction-proxy-1'],
  };
  const derivationGenerator = new DungeonGenerator({ random: () => 0.5 });
  const derivation = derivationGenerator
    ._deriveDungeonSupplementStructuralFrameRequirements(plan, [floor]);
  assert.deepEqual(derivation.errors, []);
  assert.equal(derivation.requirements.length, 1);
  const requirement = derivation.requirements[0];
  requirement.collisionFreeOverheadFrame = true;
  requirement.finalWidthMeters = 14;
  requirement.finalInternalClearWidthMeters = 13;
  requirement.finalFrameHeightMeters = requirement.archHeightMeters;
  requirement.rendererObjectId = 'connectorIndustrialStructuralFrame_segment-1_0';
  requirement.clearanceResolved = true;
  const realization = {
    schema: 'ruindivex-dungeon-structural-frame-realization/v1',
    id: `${requirement.id}:realization`,
    requirementId: requirement.id,
    connectionId: 'segment-1',
    required: true,
    requiredRoles: [...requirement.requiredRoles],
    pathIndex: requirement.pathIndex,
    gridPoint: { ...requirement.gridPoint },
    direction: { ...requirement.direction },
    floorElevation: 0,
    anchorFloorCellId: requirement.anchorFloorCellId,
    finalWidthMeters: 14,
    internalClearWidthMeters: 13,
    clearHeightMeters: requirement.clearHeightMeters,
    ceilingY: requirement.ceilingY,
    frameHeightMeters: requirement.finalFrameHeightMeters,
    clearanceResolved: true,
    rendererObjectId: 'connectorIndustrialStructuralFrame_segment-1_0',
    themeBinding: requirement.themeBinding,
    sourceWallRunIds: [],
  };
  realization.anchorFloorRef = { ...requirement.anchorFloorRef };
  plan.structuralFrameRequirements = [requirement];
  plan.structuralFrameBeats = plan.structuralFrameRequirements;
  plan.structuralFrameRealizations = [realization];
  const wallRun = {
    facadeId: 'segment-1:wall-run:left',
    ownerId: plan.id,
    horizontal: true,
    line: 1.5,
    start: -2,
    end: 2,
    wallBottomY: 0,
    wallTopY: 8.4,
  };
  return { requirement, realization, plan, floor, wallRun };
}

function refreshSingleFrameContract(fixture, generator) {
  const derivation = generator._deriveDungeonSupplementStructuralFrameRequirements(
    fixture.plan,
    [fixture.floor],
  );
  assert.deepEqual(derivation.errors, []);
  assert.equal(derivation.requirements.length, 1);
  const requirement = derivation.requirements[0];
  requirement.collisionFreeOverheadFrame = true;
  requirement.finalWidthMeters = 14;
  requirement.finalInternalClearWidthMeters = 13;
  requirement.finalFrameHeightMeters = requirement.archHeightMeters;
  requirement.rendererObjectId = 'connectorIndustrialStructuralFrame_segment-1_0';
  requirement.clearanceResolved = true;
  const realization = {
    ...fixture.realization,
    id: `${requirement.id}:realization`,
    requirementId: requirement.id,
    requiredRoles: [...requirement.requiredRoles],
    pathIndex: requirement.pathIndex,
    gridPoint: { ...requirement.gridPoint },
    direction: { ...requirement.direction },
    floorElevation: requirement.floorElevation,
    anchorFloorCellId: requirement.anchorFloorCellId,
    anchorFloorRef: { ...requirement.anchorFloorRef },
    clearHeightMeters: requirement.clearHeightMeters,
    ceilingY: requirement.ceilingY,
    frameHeightMeters: requirement.finalFrameHeightMeters,
    themeBinding: requirement.themeBinding,
    sourceWallRunIds: [],
  };
  fixture.requirement = requirement;
  fixture.realization = realization;
  fixture.plan.structuralFrameRequirements = [requirement];
  fixture.plan.structuralFrameBeats = fixture.plan.structuralFrameRequirements;
  fixture.plan.structuralFrameRealizations = [realization];
  return fixture;
}

test('V4 structural frames bind every required role to exact floor and wall identities', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const fixture = v4FrameFixture();

  const result = generator._bindDungeonSupplementStructuralFrameRealizations(
    [fixture.plan],
    [fixture.wallRun],
    [fixture.floor],
    [],
  );

  assert.equal(result.accepted, true);
  assert.equal(result.requirementCount, 1);
  assert.equal(result.realizationCount, 1);
  assert.deepEqual(
    fixture.plan.structuralFrameRealizations[0].requiredRoles,
    ['bend', 'entrance', 'interval', 'junction', 'reconnect'],
  );
  assert.equal(fixture.plan.structuralFrameRealizations[0].wallRunBindingResolved, true);
  assert.equal(fixture.plan.structuralFrameRealizations[0].floorIdentityResolved, true);
  assert.deepEqual(
    fixture.plan.structuralFrameRealizations[0].sourceWallRunIds,
    [fixture.wallRun.facadeId],
  );
  assert.equal(fixture.plan.structuralFrameRealizations[0].finalWidthMeters, 14);
  assert.equal(
    fixture.plan.structuralFrameRealizations[0].rendererObjectId,
    'connectorIndustrialStructuralFrame_segment-1_0',
  );
});

test('V4 frame derivation covers finalized endpoints, bends, junctions, and interval cadence', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const path = [
    { x: -3, z: 0 },
    { x: -2, z: 0 },
    { x: -1, z: 0 },
    { x: 0, z: 0 },
    { x: 0, z: 1 },
    { x: 0, z: 2 },
    { x: 0, z: 3 },
  ];
  const sections = path.map((center, pathIndex) => ({
    pathIndex,
    center: { ...center },
    direction: pathIndex < 3 ? { x: 1, z: 0 } : { x: 0, z: 1 },
    elevation: 0,
    ceilingY: 8.4,
    connectorZone: pathIndex === 3 ? 'gallery_turn_landing' : 'main_gallery',
  }));
  const plan = {
    id: 'derived-segment',
    isDungeonSupplement: true,
    augmentationOperationType: 'routeNetwork',
    routeNetworkGrantId: 'grant-derived',
    augmentationThemeBinding: { themeId: 'industrial-v1' },
    bridgePath: path,
    galleryCrossSections: sections.map((section) => ({
      pathIndex: section.pathIndex,
      sections: [section],
    })),
    fromSocket: { connectorJunctionProxyId: 'junction-a' },
    toSocket: { connectorJunctionProxyId: 'junction-b' },
    connectorJunctionProxyIds: ['junction-a', 'junction-b'],
  };
  const floors = path.map((point, index) => ({
    ...point,
    elevation: 0,
    augmentationFloorCellId: `derived-segment:floor:${index}`,
    signedConnectorFloorOwnerId: plan.id,
    walkabilityIntent: 'required-clear',
  }));

  const result = generator._deriveDungeonSupplementStructuralFrameRequirements(plan, floors);

  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.requirements.map(({ pathIndex, requiredRoles }) => ({ pathIndex, requiredRoles })),
    [
      { pathIndex: 0, requiredRoles: ['entrance', 'interval', 'junction'] },
      { pathIndex: 3, requiredRoles: ['bend', 'interval'] },
      { pathIndex: 6, requiredRoles: ['interval', 'junction', 'reconnect'] },
    ],
  );
});

test('straight V4 frames require both authoritative lateral wall runs', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const fixture = v4FrameFixture();
  fixture.plan.bridgePath = [
    { x: -1, z: 0 },
    { x: 0, z: 0 },
    { x: 1, z: 0 },
  ];
  fixture.plan.galleryCrossSections[0].pathIndex = 1;
  fixture.plan.galleryCrossSections[0].sections[0].pathIndex = 1;
  fixture.plan.fromSocket = {};
  fixture.plan.connectorJunctionProxyIds = [];
  refreshSingleFrameContract(fixture, generator);
  assert.deepEqual(
    fixture.requirement.requiredRoles,
    ['entrance', 'interval', 'reconnect'],
  );
  assert.throws(
    () => generator._bindDungeonSupplementStructuralFrameRealizations(
      [fixture.plan], [fixture.wallRun], [fixture.floor], [],
    ),
    (error) => error.compatibility?.errors?.some((entry) => (
      entry.includes('structural-frame-wall-run-missing')
    )),
  );

  const oppositeWallRun = {
    ...fixture.wallRun,
    facadeId: 'segment-1:wall-run:right',
    line: -1.5,
  };
  const accepted = generator._bindDungeonSupplementStructuralFrameRealizations(
    [fixture.plan], [fixture.wallRun, oppositeWallRun], [fixture.floor], [],
  );
  assert.equal(accepted.accepted, true);
  assert.deepEqual(
    fixture.realization.sourceWallRunIds,
    [fixture.wallRun.facadeId, oppositeWallRun.facadeId].sort(),
  );
});

test('V4 frame renderer emits exact accepted IDs for junction proxy endpoints', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const fixture = v4FrameFixture();
  generator._bindDungeonSupplementStructuralFrameRealizations(
    [fixture.plan], [fixture.wallRun], [fixture.floor], [],
  );
  const group = new THREE.Group();
  generator._addVolumetricIndustrialPrefabs(
    group,
    [],
    [],
    [fixture.plan],
    {
      supportMetal: new THREE.MeshBasicMaterial(),
      hazardStripe: new THREE.MeshBasicMaterial(),
    },
    [],
  );
  const rendered = group.getObjectByName(fixture.realization.rendererObjectId);
  assert.ok(rendered, 'junction-proxy frame was silently omitted');
  assert.equal(fixture.realization.rendered, true);
  assert.equal(
    rendered.userData.structuralFrameRealizationId,
    fixture.realization.id,
  );
});

test('V4 structural-frame binding rejects missing or duplicated realizations', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const missing = v4FrameFixture();
  missing.plan.structuralFrameRealizations = [];
  assert.throws(
    () => generator._bindDungeonSupplementStructuralFrameRealizations(
      [missing.plan], [missing.wallRun], [missing.floor], [],
    ),
    (error) => error.compatibility?.code === 'DUNGEON_AUGMENTATION_STRUCTURAL_FRAME_BINDING_FAILED'
      && error.compatibility?.errors?.some((entry) => (
        entry.includes('missing-or-duplicate-structural-frame-realization')
      )),
  );

  const duplicate = v4FrameFixture();
  duplicate.plan.structuralFrameRealizations.push({
    ...duplicate.realization,
    id: `${duplicate.realization.id}:duplicate`,
  });
  assert.throws(
    () => generator._bindDungeonSupplementStructuralFrameRealizations(
      [duplicate.plan], [duplicate.wallRun], [duplicate.floor], [],
    ),
    (error) => error.compatibility?.code === 'DUNGEON_AUGMENTATION_STRUCTURAL_FRAME_BINDING_FAILED',
  );
});

test('V4 binding rejects supplied requirements that omit or invent finalized geometry roles', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const missingBend = v4FrameFixture();
  missingBend.requirement.requiredRoles = missingBend.requirement.requiredRoles
    .filter((role) => role !== 'bend');
  missingBend.realization.requiredRoles = [...missingBend.requirement.requiredRoles];
  assert.throws(
    () => generator._bindDungeonSupplementStructuralFrameRealizations(
      [missingBend.plan], [missingBend.wallRun], [missingBend.floor], [],
    ),
    (error) => error.compatibility?.errors?.some((entry) => (
      entry.includes('structural-frame-derived-requirement-mismatch')
    )),
  );

  const extra = v4FrameFixture();
  const extraRequirement = {
    ...extra.requirement,
    id: `${extra.plan.id}:structural-frame-requirement:extra`,
  };
  extra.plan.structuralFrameRequirements.push(extraRequirement);
  extra.plan.structuralFrameBeats = extra.plan.structuralFrameRequirements;
  extra.plan.structuralFrameRealizations.push({
    ...extra.realization,
    id: `${extraRequirement.id}:realization`,
    requirementId: extraRequirement.id,
    rendererObjectId: `connectorIndustrialStructuralFrame_${extra.plan.id}_1`,
  });
  assert.throws(
    () => generator._bindDungeonSupplementStructuralFrameRealizations(
      [extra.plan], [extra.wallRun], [extra.floor], [],
    ),
    (error) => error.compatibility?.errors?.some((entry) => (
      entry.includes('structural-frame-derived-requirement-set-mismatch')
    )),
  );
});

test('V4 binding rejects resized, relocated, or renamed accepted realizations', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  for (const mutate of [
    (fixture) => { fixture.realization.finalWidthMeters += 2.8; },
    (fixture) => { fixture.realization.gridPoint.x += 1; },
    (fixture) => { fixture.realization.id += ':renamed'; },
  ]) {
    const fixture = v4FrameFixture();
    mutate(fixture);
    assert.throws(
      () => generator._bindDungeonSupplementStructuralFrameRealizations(
        [fixture.plan], [fixture.wallRun], [fixture.floor], [],
      ),
      (error) => error.compatibility?.errors?.some((entry) => (
        entry.includes('structural-frame-realization-unresolved')
      )),
    );
  }
});

test('V4 structural-frame binding rejects foreign floor identity and absent shell support', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const foreignFloor = v4FrameFixture();
  foreignFloor.floor.augmentationFloorCellId = 'foreign:floor';
  assert.throws(
    () => generator._bindDungeonSupplementStructuralFrameRealizations(
      [foreignFloor.plan], [foreignFloor.wallRun], [foreignFloor.floor], [],
    ),
    (error) => error.compatibility?.code === 'DUNGEON_AUGMENTATION_STRUCTURAL_FRAME_BINDING_FAILED'
      && error.compatibility?.errors?.some((entry) => (
        entry.includes('structural-frame-floor-identity-invalid')
      )),
  );

  const missingWall = v4FrameFixture();
  assert.throws(
    () => generator._bindDungeonSupplementStructuralFrameRealizations(
      [missingWall.plan], [], [missingWall.floor], [],
    ),
    (error) => error.compatibility?.code === 'DUNGEON_AUGMENTATION_STRUCTURAL_FRAME_BINDING_FAILED'
      && error.compatibility?.errors?.some((entry) => (
        entry.includes('structural-frame-wall-run-missing')
      )),
  );
});

test('V4 structural-frame binding rejects unsafe clearance and renderer identity drift', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const unsafe = v4FrameFixture();
  unsafe.realization.clearanceResolved = false;
  assert.throws(
    () => generator._bindDungeonSupplementStructuralFrameRealizations(
      [unsafe.plan], [unsafe.wallRun], [unsafe.floor], [],
    ),
    (error) => error.compatibility?.code === 'DUNGEON_AUGMENTATION_STRUCTURAL_FRAME_BINDING_FAILED'
      && error.compatibility?.errors?.some((entry) => (
        entry.includes('structural-frame-realization-unresolved')
      )),
  );

  const renamed = v4FrameFixture();
  renamed.realization.rendererObjectId = 'renderer-may-not-rename-an-accepted-frame';
  assert.throws(
    () => generator._bindDungeonSupplementStructuralFrameRealizations(
      [renamed.plan], [renamed.wallRun], [renamed.floor], [],
    ),
    (error) => error.compatibility?.code === 'DUNGEON_AUGMENTATION_STRUCTURAL_FRAME_BINDING_FAILED',
  );
});

test('legacy authored arches are outside the V4 structural-frame binding path', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const legacyPlan = {
    id: 'legacy-v1-connector',
    decorativeArchBeats: [{ id: 'legacy-v1-arch' }],
  };
  const result = generator._bindDungeonSupplementStructuralFrameRealizations(
    [legacyPlan], [], [], [],
  );
  assert.deepEqual(result, {
    schema: 'ruindivex-dungeon-structural-frame-binding-diagnostics/v1',
    requirementCount: 0,
    realizationCount: 0,
    boundWallRunCount: 0,
    accepted: true,
  });
  assert.deepEqual(legacyPlan.decorativeArchBeats, [{ id: 'legacy-v1-arch' }]);
});
