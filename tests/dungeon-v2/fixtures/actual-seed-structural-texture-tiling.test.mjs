import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';
import { LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2 } from '../../../src/dungeon-v2/LegacyAuthoredRuntimeKitV2.js';

const EPSILON = 1e-5;
const GOLDEN_SEEDS = Object.freeze([
  Object.freeze({ seed: 'm1-golden-magma', undercroftType: 'magma' }),
  Object.freeze({ seed: 'm1-golden-electrical', undercroftType: 'electrical' }),
]);

function materialsFor(mesh) {
  return (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean);
}

function isExplicitlyNonStructural(mesh) {
  let object = mesh;
  while (object) {
    const policy = String(object.userData?.v2CollisionPolicy ?? '');
    if (policy === 'nonblocking-effect'
      || policy === 'nonblocking-presentation'
      || policy === 'nonblocking-pickup') return true;
    object = object.parent;
  }
  return false;
}

function close(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= EPSILON,
    `${label}: expected ${expected}, received ${actual}`);
}

function uvRange(geometry) {
  const uv = geometry.getAttribute('uv');
  assert.ok(uv, `${geometry.name || geometry.type} requires a UV attribute`);
  const result = {
    minU: Number.POSITIVE_INFINITY,
    maxU: Number.NEGATIVE_INFINITY,
    minV: Number.POSITIVE_INFINITY,
    maxV: Number.NEGATIVE_INFINITY,
  };
  for (let index = 0; index < uv.count; index += 1) {
    result.minU = Math.min(result.minU, uv.getX(index));
    result.maxU = Math.max(result.maxU, uv.getX(index));
    result.minV = Math.min(result.minV, uv.getY(index));
    result.maxV = Math.max(result.maxV, uv.getY(index));
  }
  return result;
}

function dominantNormalAxis(normal, index) {
  const x = Math.abs(normal.getX(index));
  const y = Math.abs(normal.getY(index));
  const z = Math.abs(normal.getZ(index));
  if (x >= y && x >= z) return 'x';
  return y >= z ? 'y' : 'z';
}

function assertPerFaceBoxTiling(mesh, metadata) {
  assert.ok(metadata.dimensions && ['x', 'y', 'z'].every((axis) => (
    Number.isFinite(metadata.dimensions[axis]) && metadata.dimensions[axis] > 0
  )), `${mesh.name} per-face tiling requires exact positive world dimensions`);
  const expectedRepeats = {
    x: {
      u: metadata.dimensions.z / LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2,
      v: metadata.dimensions.y / LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2,
    },
    y: {
      u: metadata.dimensions.x / LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2,
      v: metadata.dimensions.z / LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2,
    },
    z: {
      u: metadata.dimensions.x / LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2,
      v: metadata.dimensions.y / LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2,
    },
  };
  for (const axis of ['x', 'y', 'z']) {
    close(metadata.faceRepeats[axis].u, expectedRepeats[axis].u,
      `${mesh.name} ${axis} exact world-scale U repeat`);
    close(metadata.faceRepeats[axis].v, expectedRepeats[axis].v,
      `${mesh.name} ${axis} exact world-scale V repeat`);
  }
  const uv = mesh.geometry.getAttribute('uv');
  const normal = mesh.geometry.getAttribute('normal');
  assert.ok(uv && normal && uv.count === normal.count,
    `${mesh.name} per-face tiling requires matching UV and normal buffers`);
  const ranges = new Map();
  for (let index = 0; index < uv.count; index += 1) {
    const axis = dominantNormalAxis(normal, index);
    const component = axis === 'x' ? normal.getX(index)
      : axis === 'y' ? normal.getY(index) : normal.getZ(index);
    const key = `${axis}:${Math.sign(component) || 1}`;
    const range = ranges.get(key) ?? {
      minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity,
    };
    range.minU = Math.min(range.minU, uv.getX(index));
    range.maxU = Math.max(range.maxU, uv.getX(index));
    range.minV = Math.min(range.minV, uv.getY(index));
    range.maxV = Math.max(range.maxV, uv.getY(index));
    ranges.set(key, range);
  }
  assert.equal(ranges.size, 6, `${mesh.name} must retain six independently tiled box faces`);
  for (const [key, range] of ranges) {
    const repeat = metadata.faceRepeats[key[0]];
    close(range.maxU - range.minU, repeat.u, `${mesh.name} ${key} U repeat range`);
    close(range.maxV - range.minV, repeat.v, `${mesh.name} ${key} V repeat range`);
  }
}

function assertTextureMetadata(mesh) {
  const metadata = mesh.userData.v2TextureTiling ?? mesh.geometry.userData.v2TextureTiling;
  assert.ok(metadata,
    `${mesh.name || '<unnamed>'} (${mesh.geometry.type}) has a texture map but no world-scale tiling metadata`);
  assert.equal(metadata.tileScaleMetres, LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2,
    `${mesh.name} geometry tile scale`);
  if (metadata.mode === 'per-face-world-dimensions') {
    assertPerFaceBoxTiling(mesh, metadata);
  } else if (metadata.mode === 'per-instance-world-dimensions') {
    assert.equal(mesh.isInstancedMesh, true, `${mesh.name} per-instance tiling requires InstancedMesh`);
    const dimensions = mesh.geometry.getAttribute(metadata.attribute);
    assert.ok(dimensions?.isInstancedBufferAttribute,
      `${mesh.name} requires ${metadata.attribute} instanced dimensions`);
    assert.ok(dimensions.count >= mesh.count,
      `${mesh.name} dimension count must cover every visible instance`);
    for (let index = 0; index < mesh.count; index += 1) {
      assert.ok(dimensions.getX(index) > 0 && dimensions.getY(index) > 0 && dimensions.getZ(index) > 0,
        `${mesh.name} instance ${index} requires positive exact world dimensions`);
    }
    assert.match(mesh.material.customProgramCacheKey(), /world-tiled-instancing-v2/,
      `${mesh.name} material must consume its per-instance dimensions`);
    const shader = { vertexShader: '#include <common>\n#include <uv_vertex>' };
    mesh.material.onBeforeCompile(shader, null);
    assert.match(shader.vertexShader, /v2TextureRepeats \/= 2\.8/,
      `${mesh.name} shader must divide by the exact V1 tile scale`);
    assert.doesNotMatch(shader.vertexShader, /max\(vec2\(1\.0\)/,
      `${mesh.name} shader must not squeeze one whole tile onto sub-tile geometry`);
  } else if (metadata.mode === 'per-instance-world-uv-ranges') {
    assert.equal(mesh.isInstancedMesh, true, `${mesh.name} per-instance tiling requires InstancedMesh`);
    const repeats = mesh.geometry.getAttribute(metadata.attribute);
    assert.ok(repeats?.isInstancedBufferAttribute,
      `${mesh.name} requires ${metadata.attribute} instanced repeat counts`);
    assert.ok(repeats.count >= mesh.count,
      `${mesh.name} repeat count must cover every visible instance`);
    for (let index = 0; index < mesh.count; index += 1) {
      assert.ok(repeats.getX(index) > 0 && repeats.getY(index) > 0,
        `${mesh.name} instance ${index} requires positive exact world repeat counts`);
    }
    assert.match(mesh.material.customProgramCacheKey(), /world-tiled-uv-ranges-v2/,
      `${mesh.name} material must consume its per-instance UV repeat counts`);
    const shader = { vertexShader: '#include <common>\n#include <uv_vertex>' };
    mesh.material.onBeforeCompile(shader, null);
    assert.doesNotMatch(shader.vertexShader, /max\(vec2\(1\.0\)/,
      `${mesh.name} shader must preserve fractional repeat counts`);
  } else if (metadata.mode === 'world-extent-uv-ranges') {
    assert.ok(metadata.uRepeat > 0 && metadata.vRepeat > 0,
      `${mesh.name} requires positive world-extent repeat counts`);
    close(metadata.uRepeat, metadata.uExtent / LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2,
      `${mesh.name} exact world-scale U extent`);
    close(metadata.vRepeat, metadata.vExtent / LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2,
      `${mesh.name} exact world-scale V extent`);
    const range = uvRange(mesh.geometry);
    close(range.maxU - range.minU, metadata.uRepeat, `${mesh.name} U repeat range`);
    close(range.maxV - range.minV, metadata.vRepeat, `${mesh.name} V repeat range`);
  } else if (metadata.mode === 'merged-per-component-world-dimensions') {
    assert.ok(Number.isInteger(metadata.componentCount) && metadata.componentCount > 0,
      `${mesh.name} merged tiling requires its exact component count`);
    assert.equal(metadata.bakedIntoUvs, true, `${mesh.name} merged world tiling must be baked into UVs`);
    const range = uvRange(mesh.geometry);
    assert.ok(range.maxU - range.minU > 0 && range.maxV - range.minV > 0,
      `${mesh.name} merged UVs must retain positive exact world-scale ranges`);
  } else {
    assert.fail(`${mesh.name} uses unsupported texture tiling mode ${metadata.mode}`);
  }
}

function assertFinalSceneTiling(facade) {
  const audited = [];
  const excluded = [];
  const missingMetadata = [];
  const byMode = new Map();
  const byGeometry = new Map();
  let fractionalWorldScaleMeshes = 0;
  facade.group.traverse((object) => {
    if (!object.isMesh) return;
    const mappedMaterials = materialsFor(object).filter((material) => material.map);
    if (!mappedMaterials.length) return;
    if (isExplicitlyNonStructural(object)) {
      excluded.push(object);
      return;
    }
    audited.push(object);
    byGeometry.set(object.geometry.type, (byGeometry.get(object.geometry.type) ?? 0) + 1);
    if (!object.userData.v2TextureTiling && !object.geometry.userData.v2TextureTiling) {
      missingMetadata.push({
        name: object.name,
        geometry: object.geometry.type,
        parent: object.parent?.name ?? null,
      });
      return;
    }
    const mode = object.userData.v2TextureTiling?.mode
      ?? object.geometry.userData.v2TextureTiling?.mode;
    byMode.set(mode, (byMode.get(mode) ?? 0) + 1);
    const metadata = object.userData.v2TextureTiling ?? object.geometry.userData.v2TextureTiling;
    const repeats = mode === 'per-face-world-dimensions'
      ? Object.values(metadata.faceRepeats).flatMap(({ u, v }) => [u, v])
      : mode === 'world-extent-uv-ranges'
        ? [metadata.uRepeat, metadata.vRepeat]
        : [];
    if (repeats.some((repeat) => repeat > 0 && repeat < 1)) fractionalWorldScaleMeshes += 1;
    for (const material of mappedMaterials) {
      assert.equal(material.map.wrapS, THREE.RepeatWrapping, `${object.name} map.wrapS`);
      assert.equal(material.map.wrapT, THREE.RepeatWrapping, `${object.name} map.wrapT`);
      assert.equal(material.userData.v2WorldScaleTiling, true,
        `${object.name} material world-scale tiling marker`);
      assert.equal(material.map.userData.v2WorldScaleTiling, true,
        `${object.name} texture world-scale tiling marker`);
      assert.equal(material.userData.v2TextureTileScaleMetres,
        LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2, `${object.name} material tile scale`);
      assert.equal(material.map.userData.v2TextureTileScaleMetres,
        LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2, `${object.name} texture tile scale`);
    }
    assertTextureMetadata(object);
  });
  assert.deepEqual(missingMetadata, [],
    `mapped structural meshes without exact tiling metadata:\n${JSON.stringify(missingMetadata, null, 2)}`);
  assert.ok(audited.length >= 300,
    `actual golden scene exposed only ${audited.length} mapped structural meshes`);
  assert.ok(fractionalWorldScaleMeshes >= 100,
    `only ${fractionalWorldScaleMeshes} mapped meshes prove exact fractional tiling on sub-2.8m faces`);
  return {
    auditedDrawMeshes: audited.length,
    auditedRenderedInstances: audited.reduce((total, mesh) => (
      total + (mesh.isInstancedMesh ? mesh.count : 1)
    ), 0),
    excluded: excluded.length,
    fractionalWorldScaleMeshes,
    byMode: Object.fromEntries([...byMode].sort(([left], [right]) => left.localeCompare(right))),
    byGeometry: Object.fromEntries([...byGeometry].sort(([left], [right]) => left.localeCompare(right))),
  };
}

for (const fixture of GOLDEN_SEEDS) {
  test(`${fixture.seed} world-tiles every mapped structural mesh in the final assembled scene`, (context) => {
    const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2(fixture));
    assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
    const facade = assembleDungeonPlanV2(validation.plan);
    try {
      const counts = assertFinalSceneTiling(facade);
      context.diagnostic(`${fixture.seed}: ${JSON.stringify(counts)}`);
    } finally {
      facade.dispose();
    }
  });
}
