import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';
import { LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2 } from '../../../src/dungeon-v2/LegacyAuthoredRuntimeKitV2.js';

const EPSILON = 1e-6;
const GOLDEN_FIXTURES = Object.freeze([
  Object.freeze({ seed: 'm1-golden-magma', undercroftType: 'magma' }),
  Object.freeze({ seed: 'm1-golden-electrical', undercroftType: 'electrical' }),
]);

function close(actual, expected, message, tolerance = EPSILON) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual}`);
}

function materialList(mesh) {
  return (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean);
}

function assertClosedWaterVolumeGeometry(waterObject, basin) {
  const geometry = waterObject.geometry;
  assert.equal(geometry.type, 'BoxGeometry',
    `${basin.id} must render a closed volume rather than a one-dimensional plane`);
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  assert.ok(position && normal && position.count === normal.count,
    `${basin.id} closed volume requires actual position and normal buffers`);
  assert.equal(geometry.index?.count, 36, `${basin.id} closed box requires twelve rendered triangles`);
  const faceDirections = new Set();
  for (let index = 0; index < normal.count; index += 1) {
    const components = [normal.getX(index), normal.getY(index), normal.getZ(index)];
    const dominantIndex = components.reduce((best, value, candidate) => (
      Math.abs(value) > Math.abs(components[best]) ? candidate : best
    ), 0);
    const axis = ['x', 'y', 'z'][dominantIndex];
    faceDirections.add(`${axis}:${Math.sign(components[dominantIndex]) || 1}`);
  }
  assert.deepEqual([...faceDirections].sort(), ['x:-1', 'x:1', 'y:-1', 'y:1', 'z:-1', 'z:1'],
    `${basin.id} water must retain a top, bottom, and four visible side faces`);
}

function assertFilledWaterSurfaceCoverage(waterObject, basin, level, stateId) {
  assert.ok(level > 0 && waterObject.visible,
    `${stateId}/${basin.id} coverage proof requires a visible filled volume`);
  waterObject.updateWorldMatrix(true, false);
  const surfaceY = basin.bounds.min.y + level;
  const position = waterObject.geometry.getAttribute('position');
  const normal = waterObject.geometry.getAttribute('normal');
  const index = waterObject.geometry.index;
  const topTriangles = [];
  for (let offset = 0; offset < index.count; offset += 3) {
    const indices = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
    if (!indices.every((vertexIndex) => normal.getY(vertexIndex) > 0.999)) continue;
    topTriangles.push(indices.map((vertexIndex) => (
      new THREE.Vector3().fromBufferAttribute(position, vertexIndex).applyMatrix4(waterObject.matrixWorld)
    )));
  }
  assert.equal(topTriangles.length, 2,
    `${stateId}/${basin.id} must render two triangles across its complete top surface`);
  const ray = new THREE.Ray();
  const down = new THREE.Vector3(0, -1, 0);
  // Samples deliberately reach to 2% inside every basin edge. A legacy small
  // central blue square cannot satisfy this physical top-surface proof even if
  // metadata or a parent bounding box claims the full room footprint.
  for (const xProgress of [0.02, 0.26, 0.5, 0.74, 0.98]) {
    for (const zProgress of [0.02, 0.26, 0.5, 0.74, 0.98]) {
      const x = THREE.MathUtils.lerp(basin.bounds.min.x, basin.bounds.max.x, xProgress);
      const z = THREE.MathUtils.lerp(basin.bounds.min.z, basin.bounds.max.z, zProgress);
      ray.set(new THREE.Vector3(x, surfaceY + 2, z), down);
      const hit = topTriangles
        .map(([a, b, c]) => ray.intersectTriangle(a, b, c, false, new THREE.Vector3()))
        .find(Boolean);
      assert.ok(hit, `${stateId}/${basin.id} misses visible water at room sample ${xProgress},${zProgress}`);
      close(hit.y, surfaceY,
        `${stateId}/${basin.id} exact top surface at room sample ${xProgress},${zProgress}`,
        1e-5);
    }
  }
}

function dominantNormalAxis(normal, index) {
  const absolute = {
    x: Math.abs(normal.getX(index)),
    y: Math.abs(normal.getY(index)),
    z: Math.abs(normal.getZ(index)),
  };
  if (absolute.x >= absolute.y && absolute.x >= absolute.z) return 'x';
  return absolute.y >= absolute.z ? 'y' : 'z';
}

function assertBoxUvRanges(mesh) {
  const metadata = mesh.userData.v2TextureTiling;
  const uv = mesh.geometry.getAttribute('uv');
  const normal = mesh.geometry.getAttribute('normal');
  assert.ok(uv && normal && uv.count === normal.count, `${mesh.name} requires actual UV/normal buffers`);
  const ranges = new Map();
  for (let index = 0; index < uv.count; index += 1) {
    const axis = dominantNormalAxis(normal, index);
    const sign = Math.sign(normal[`get${axis.toUpperCase()}`](index)) || 1;
    const key = `${axis}:${sign}`;
    const range = ranges.get(key) ?? {
      minU: Number.POSITIVE_INFINITY,
      maxU: Number.NEGATIVE_INFINITY,
      minV: Number.POSITIVE_INFINITY,
      maxV: Number.NEGATIVE_INFINITY,
    };
    range.minU = Math.min(range.minU, uv.getX(index));
    range.maxU = Math.max(range.maxU, uv.getX(index));
    range.minV = Math.min(range.minV, uv.getY(index));
    range.maxV = Math.max(range.maxV, uv.getY(index));
    ranges.set(key, range);
  }
  assert.equal(ranges.size, 6, `${mesh.name} must retain all six independently tiled faces`);
  for (const [key, range] of ranges) {
    const axis = key[0];
    const expected = metadata.faceRepeats[axis];
    close(range.maxU - range.minU, expected.u, `${mesh.name} ${key} U repeat range`);
    close(range.maxV - range.minV, expected.v, `${mesh.name} ${key} V repeat range`);
  }
}

function assertMaterialAndUvTiling(facade) {
  const structuralMeshes = [];
  facade.group.updateWorldMatrix(true, true);
  facade.group.traverse((object) => {
    if (!object.isMesh || !/^v2(?:Boundary|WalkableSurface|Stairs):/.test(object.name)) return;
    const texturedMaterials = materialList(object).filter((material) => material.map);
    if (!texturedMaterials.length) return;
    structuralMeshes.push(object);
    assert.ok(object.userData.v2TextureTiling,
      `${object.name} stretches a mapped material without per-object world-scale UVs`);
    for (const material of texturedMaterials) {
      assert.equal(material.map.wrapS, THREE.RepeatWrapping, `${object.name} map.wrapS`);
      assert.equal(material.map.wrapT, THREE.RepeatWrapping, `${object.name} map.wrapT`);
      assert.equal(material.userData.v2TextureTileScaleMetres,
        LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2, `${object.name} material tile scale`);
      assert.equal(material.map.userData.v2TextureTileScaleMetres,
        LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2, `${object.name} texture tile scale`);
    }
    assert.equal(object.userData.v2TextureTiling.tileScaleMetres,
      LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2, `${object.name} UV tile scale`);
    assert.equal(object.userData.v2TextureTiling.mode, 'per-face-world-dimensions');
    assertBoxUvRanges(object);
  });
  assert.ok(structuralMeshes.length >= 100,
    `golden assembly exposed only ${structuralMeshes.length} world-tiled structural meshes`);
  const visiblyRepeated = structuralMeshes.filter((mesh) => {
    const uv = mesh.geometry.getAttribute('uv');
    let minU = Number.POSITIVE_INFINITY;
    let maxU = Number.NEGATIVE_INFINITY;
    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < uv.count; index += 1) {
      minU = Math.min(minU, uv.getX(index));
      maxU = Math.max(maxU, uv.getX(index));
      minV = Math.min(minV, uv.getY(index));
      maxV = Math.max(maxV, uv.getY(index));
    }
    return maxU - minU >= 4 || maxV - minV >= 4;
  });
  assert.ok(visiblyRepeated.length >= 20,
    'large golden walls/floors must repeat multiple 2.8m panels in their actual UV buffers');
}

function assertWaterStateVisuals(plan, facade) {
  const water = plan.environmentStates.find((entry) => entry.type === 'conserved-water-unit');
  assert.ok(water, 'golden plan owns the conserved Waterworks unit');
  const runtime = facade.environmentRuntime;
  const registeredDynamicSurfaces = [];
  const player = {
    root: new THREE.Object3D(),
    setEnvironmentalTraversalProfile() {},
  };
  player.root.position.copy(facade.playerStart);
  runtime.mount({
    player,
    dungeon: facade,
    enemies: [],
    registerDynamicPlatformingSurface(surface) {
      registeredDynamicSurfaces.push(surface);
    },
    unregisterDynamicPlatformingSurface(surface) {
      const index = registeredDynamicSurfaces.indexOf(surface);
      if (index >= 0) registeredDynamicSurfaces.splice(index, 1);
    },
  });
  const surfaces = new Map(plan.walkableSurfaces.map((surface) => [surface.id, surface]));
  const playableCellByRegionId = new Map(plan.spatialCells
    .filter((cell) => (
      cell.playable === true
      && cell.id === `cell.${cell.regionId}.main`
    ))
    .map((cell) => [cell.regionId, cell]));
  const anchors = new Map([...plan.anchors, ...plan.safeAnchors].map((anchor) => [anchor.id, anchor]));
  const basinById = new Map(water.basins.map((basin) => [basin.id, basin]));

  for (const basin of water.basins) {
    const floor = surfaces.get(basin.floorSurfaceId);
    assert.ok(floor, `${basin.id} has its authored floor`);
    assert.equal(basin.footprintPolicy, 'complete-main-walkable-basin');
    for (const axis of ['x', 'z']) {
      close(basin.bounds.min[axis], floor.bounds.min[axis], `${basin.id} minimum ${axis} footprint`);
      close(basin.bounds.max[axis], floor.bounds.max[axis], `${basin.id} maximum ${axis} footprint`);
    }
    const area = (basin.bounds.max.x - basin.bounds.min.x)
      * (basin.bounds.max.z - basin.bounds.min.z);
    assert.ok(area >= 700, `${basin.id} regressed to a small central water patch (${area}m2)`);
    const playableCell = playableCellByRegionId.get(basin.regionId);
    assert.ok(playableCell, `${basin.id} belongs to an authored playable cell`);
    const cellArea = (playableCell.bounds.max.x - playableCell.bounds.min.x)
      * (playableCell.bounds.max.z - playableCell.bounds.min.z);
    assert.ok(
      area / cellArea >= 0.9,
      `${basin.id} must cover at least 90% of its playable room footprint (${area / cellArea})`,
    );
    for (const axis of ['x', 'z']) {
      const minimumInset = basin.bounds.min[axis] - playableCell.bounds.min[axis];
      const maximumInset = playableCell.bounds.max[axis] - basin.bounds.max[axis];
      assert.ok(minimumInset >= -1e-6 && minimumInset <= 0.5 + 1e-6,
        `${basin.id} minimum ${axis} edge must reach the room wall (inset ${minimumInset}m)`);
      assert.ok(maximumInset >= -1e-6 && maximumInset <= 0.5 + 1e-6,
        `${basin.id} maximum ${axis} edge must reach the room wall (inset ${maximumInset}m)`);
    }
    close(area * basin.exactFilledLevel, basin.exactFilledVolume,
      `${basin.id} filled level conserves exact volume`);

    const waterObject = runtime.resources.waterObjects.get(basin.id);
    assert.ok(waterObject?.isMesh, `${basin.id} has an assembled water volume`);
    assertClosedWaterVolumeGeometry(waterObject, basin);
    assert.match(waterObject.name, /^v2WaterVolume:/, `${basin.id} uses the volume presentation`);
    assert.equal(waterObject.userData.v2WaterVolumePresentation, true,
      `${basin.id} identifies its constant-draw volume presentation`);
    assert.equal(waterObject.userData.v2WaterDrawCount, 1,
      `${basin.id} water volume must remain one draw`);
    assert.equal(waterObject.userData.v2UnderwaterVisibility,
      'double-sided-translucent-volume', `${basin.id} underwater visibility contract`);
    assert.equal(waterObject.userData.v2CollisionAuthority,
      'plan-environment-state-only', `${basin.id} must not invent mesh collision`);
    let renderedMeshCount = 0;
    waterObject.traverse((object) => {
      if (object.isMesh) renderedMeshCount += 1;
    });
    assert.equal(renderedMeshCount, 1, `${basin.id} water must render as one mesh`);
    const materials = materialList(waterObject);
    assert.equal(materials.length, 1, `${basin.id} uses one water material`);
    const [material] = materials;
    assert.equal(material.transparent, true, `${basin.id} water material is transparent`);
    assert.equal(material.side, THREE.DoubleSide, `${basin.id} side faces remain visible underwater`);
    assert.equal(material.depthWrite, false, `${basin.id} water does not occlude submerged routes`);
    assert.equal(material.forceSinglePass, true, `${basin.id} transparent volume remains one renderer draw`);
    assert.ok(material.opacity > 0 && material.opacity <= 0.4,
      `${basin.id} water opacity must retain underwater route visibility`);
    assert.equal(material.userData.v2WaterVolumePresentation, true,
      `${basin.id} material identifies volume presentation`);
    assert.equal(material.name, 'v2WaterVolumeMaterial', `${basin.id} uses the authored water volume material`);
    assert.equal(material.userData.v2UnderwaterVisibility,
      'double-sided-translucent-volume', `${basin.id} material underwater visibility contract`);
    waterObject.geometry.computeBoundingBox();
    const localSize = waterObject.geometry.boundingBox.getSize(new THREE.Vector3());
    close(localSize.x, basin.bounds.max.x - basin.bounds.min.x, `${basin.id} rendered width`);
    close(localSize.y, 1, `${basin.id} unit source height`);
    close(localSize.z, basin.bounds.max.z - basin.bounds.min.z, `${basin.id} rendered depth`);
    assert.equal(waterObject.geometry.userData.v2WaterUnitHeight, 1,
      `${basin.id} must use a unit-height volume scaled by exact level`);
    const worldBounds = new THREE.Box3().setFromObject(waterObject);
    close(worldBounds.min.x, basin.bounds.min.x, `${basin.id} visual minimum X`);
    close(worldBounds.max.x, basin.bounds.max.x, `${basin.id} visual maximum X`);
    close(worldBounds.min.z, basin.bounds.min.z, `${basin.id} visual minimum Z`);
    close(worldBounds.max.z, basin.bounds.max.z, `${basin.id} visual maximum Z`);
  }

  for (const state of water.stableStates) {
    const changed = runtime.applyMechanismStableState(
      'mechanism.water-router',
      state.id,
      { emitEvent: false, source: 'assembled-water-coverage-proof' },
    );
    assert.equal(changed, true, `${state.id} is a legal exact stable water state`);
    let renderedVolume = 0;
    let visibleVolumeCount = 0;
    for (const basin of water.basins) {
      const level = state.basinLevels[basin.id];
      const area = (basin.bounds.max.x - basin.bounds.min.x)
        * (basin.bounds.max.z - basin.bounds.min.z);
      renderedVolume += area * level;
      const waterObject = runtime.resources.waterObjects.get(basin.id);
      close(waterObject.position.y, basin.bounds.min.y + level * 0.5,
        `${state.id}/${basin.id} exact rendered volume centre`);
      if (level > 0) {
        close(waterObject.scale.y, level,
          `${state.id}/${basin.id} exact rendered volume scale`);
      } else {
        assert.ok(waterObject.scale.y > 0 && waterObject.scale.y <= 0.001,
          `${state.id}/${basin.id} empty basin retains only an invisible numerical-safe scale`);
      }
      assert.equal(waterObject.visible, level > 0, `${state.id}/${basin.id} visibility`);
      if (waterObject.visible) visibleVolumeCount += 1;
      close(waterObject.userData.v2ExactLevel, level, `${state.id}/${basin.id} runtime level metadata`);
      close(waterObject.userData.v2ExactSurfaceY, basin.bounds.min.y + level,
        `${state.id}/${basin.id} exact surface metadata`);
      close(waterObject.userData.v2ExactBottomY, basin.bounds.min.y,
        `${state.id}/${basin.id} exact basin bottom metadata`);
      close(waterObject.userData.v2VisibleDepth, level,
        `${state.id}/${basin.id} exact visible-depth metadata`);
      if (level > 0) {
        const worldBounds = new THREE.Box3().setFromObject(waterObject);
        close(worldBounds.min.x, basin.bounds.min.x, `${state.id}/${basin.id} minimum X`);
        close(worldBounds.max.x, basin.bounds.max.x, `${state.id}/${basin.id} maximum X`);
        close(worldBounds.min.z, basin.bounds.min.z, `${state.id}/${basin.id} minimum Z`);
        close(worldBounds.max.z, basin.bounds.max.z, `${state.id}/${basin.id} maximum Z`);
        close(worldBounds.min.y, basin.bounds.min.y, `${state.id}/${basin.id} basin bottom`);
        close(worldBounds.max.y, basin.bounds.min.y + level,
          `${state.id}/${basin.id} exact water surface`);
        close(worldBounds.max.y - worldBounds.min.y, level,
          `${state.id}/${basin.id} visible water depth`);
        assertFilledWaterSurfaceCoverage(waterObject, basin, level, state.id);
      }
    }
    assert.equal(visibleVolumeCount, 1,
      `${state.id} presents exactly one filled conserved-water volume`);
    close(renderedVolume, state.exactVolume, `${state.id} exact rendered volume`, 1e-4);
  }

  const [transferFrom, transferTo] = water.stableStates;
  assert.ok(transferFrom && transferTo,
    'golden Waterworks exposes at least two exact states for transfer proof');
  runtime.applyMechanismStableState(
    'mechanism.water-router',
    transferFrom.id,
    { emitEvent: false, source: 'assembled-water-transfer-proof' },
  );
  assert.equal(runtime.setWaterConfiguration(transferTo.id), true,
    `${transferFrom.id} can begin its authored transfer to ${transferTo.id}`);
  const transferDuration = runtime.getDiagnostics().waterTransfer.duration;
  assert.ok(Number.isFinite(transferDuration) && transferDuration > 0,
    'water router resolves a finite positive authored transfer interval');
  runtime.update(transferDuration * 0.5);
  let midTransferVolume = 0;
  for (const basin of water.basins) {
    const fromLevel = transferFrom.basinLevels[basin.id];
    const toLevel = transferTo.basinLevels[basin.id];
    const expectedLevel = (fromLevel + toLevel) * 0.5;
    const area = (basin.bounds.max.x - basin.bounds.min.x)
      * (basin.bounds.max.z - basin.bounds.min.z);
    midTransferVolume += area * expectedLevel;
    const waterObject = runtime.resources.waterObjects.get(basin.id);
    close(waterObject.position.y, basin.bounds.min.y + expectedLevel * 0.5,
      `mid-transfer/${basin.id} exact rendered volume centre`);
    close(waterObject.userData.v2ExactLevel, expectedLevel,
      `mid-transfer/${basin.id} exact interpolated level metadata`);
    close(waterObject.userData.v2ExactSurfaceY, basin.bounds.min.y + expectedLevel,
      `mid-transfer/${basin.id} exact interpolated surface metadata`);
    close(waterObject.userData.v2VisibleDepth, expectedLevel,
      `mid-transfer/${basin.id} exact interpolated depth metadata`);
    assert.equal(waterObject.userData.v2WaterVisualPhase, 'transfer',
      `mid-transfer/${basin.id} visual phase metadata`);
    close(waterObject.userData.v2WaterTransferProgress, 0.5,
      `mid-transfer/${basin.id} progress metadata`);
    if (expectedLevel <= 0) continue;
    const worldBounds = new THREE.Box3().setFromObject(waterObject);
    close(worldBounds.min.y, basin.bounds.min.y,
      `mid-transfer/${basin.id} remains anchored to basin floor`);
    close(worldBounds.max.y, basin.bounds.min.y + expectedLevel,
      `mid-transfer/${basin.id} reaches exact interpolated surface`);
  }
  close(midTransferVolume, transferFrom.exactVolume,
    'mid-transfer rendered basin volumes conserve the exact water unit', 1e-4);
  runtime.update(transferDuration * 0.5);
  assert.equal(runtime.getDiagnostics().waterConfigurationId, transferTo.id,
    'water configuration commits only after its exact volume animation completes');

  for (const anchorId of water.permanentDryControlAnchorIds) {
    const anchor = anchors.get(anchorId);
    const support = surfaces.get(anchor.surfaceId ?? anchor.safeSurfaceId);
    assert.ok(anchor && support, `${anchorId} retains a static authored support`);
    for (const state of water.stableStates) {
      for (const [basinId, level] of Object.entries(state.basinLevels)) {
        if (!(level > 0)) continue;
        const basin = basinById.get(basinId);
        const inside = anchor.position.x >= basin.bounds.min.x && anchor.position.x <= basin.bounds.max.x
          && anchor.position.z >= basin.bounds.min.z && anchor.position.z <= basin.bounds.max.z;
        if (!inside) continue;
        assert.ok(support.bounds.max.y >= basin.bounds.min.y + level + 1 - EPSILON,
          `${anchorId} is not one metre clear of ${state.id}`);
      }
    }
  }
}

for (const fixture of GOLDEN_FIXTURES) {
  test(`${fixture.seed} assembles world-tiled structure and full-footprint conserved basins`, () => {
    const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2(fixture));
    assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
    assert.deepEqual(validation.errors.filter(({ code }) => code.startsWith('water-')), [],
      'validator must retain volume conservation, authored footprint, and permanent-dry controls');
    const facade = assembleDungeonPlanV2(validation.plan);
    try {
      assertMaterialAndUvTiling(facade);
      assertWaterStateVisuals(validation.plan, facade);
    } finally {
      facade.dispose();
    }
  });
}
