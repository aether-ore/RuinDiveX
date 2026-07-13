import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  REAVERBOT_BODY_PLANS,
  REAVERBOT_CHARGE_MODULES,
  REAVERBOT_DEFENSES,
  REAVERBOT_WEAK_POINTS,
  REAVERBOT_WEAPONS,
} from '../src/reaverbots/ReaverbotCatalog.js';
import {
  REAVERBOT_BODY_TEXTURE_PROFILES,
  REAVERBOT_CHARGE_TEXTURE_PROFILES,
  REAVERBOT_DECOR_TEXTURE_PROFILE,
  REAVERBOT_DEFENSE_TEXTURE_PROFILES,
  REAVERBOT_EYE_TEXTURE_PROFILES,
  REAVERBOT_TEXTURE_ASSETS,
  REAVERBOT_WEAK_POINT_TEXTURE_PROFILES,
  REAVERBOT_WEAPON_TEXTURE_PROFILES,
  resolveReaverbotTextureProfile,
} from '../src/reaverbots/ReaverbotTextureCatalog.js';
import {
  REAVERBOT_SEMANTIC_UV_LAYOUT,
  REAVERBOT_SEMANTIC_UV_REGIONS,
  REAVERBOT_SURFACE_ROLE_LAYOUTS,
  applyReaverbotSemanticUv,
  inferReaverbotSurfaceRole,
} from '../src/reaverbots/ReaverbotSurfaceCatalog.js';
import { getReaverbotTexture } from '../src/reaverbots/ReaverbotTextureLibrary.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EYE_TEXTURE_PATH = '/assets/textures/reaverbots/procedural/shared/eye_red_lens.png';
const EYE_TEXTURE_SHA256 = 'c02c6989943283794b3a25ea8c32b7f869346ef83f2161097409102528049392';

const EXPECTED_ASSET_KEYS = [
  'armorPrimary',
  'armorSecondaryCircuit',
  'bladeMetal',
  'energyFieldMask',
  'eyeRedLens',
  'jointDark',
  'moduleEmissiveMask',
  'trimAlloy',
  'weaponHousing',
];
const EXPECTED_BODY_KEYS = ['biped', 'lowBiped', 'quadruped', 'tripod', 'crawler', 'hopper', 'hoverBell', 'flyer'];
const EXPECTED_WEAPON_KEYS = [
  'rocketLance',
  'crusherJaw',
  'clawArm',
  'pounceActuator',
  'shockPiston',
  'pulseCannon',
  'mortarPod',
  'clusterMortar',
  'arcEmitter',
  'flameNozzle',
  'beamPrism',
  'mineDispenser',
  'rotorBlade',
  'tractorMagnet',
  'overloadCore',
];
const EXPECTED_CHARGE_KEYS = ['spineJet', 'twinRocketPack', 'vectorRocket'];
const EXPECTED_DEFENSE_KEYS = [
  'directionalShield',
  'armoredSkull',
  'sidePlates',
  'armoredBack',
  'armoredCarapace',
  'guardArms',
  'armorShutters',
  'rotatingPlates',
  'energyMembrane',
  'phaseShell',
  'reactivePlate',
];
const EXPECTED_WEAK_POINT_KEYS = [
  'rearBattery',
  'bellyCore',
  'eyeLens',
  'shieldHinge',
  'ammoDrum',
  'coolingVents',
  'emitterCore',
  'overloadCore',
  'legJoint',
  'counterweightCore',
  'clawPalm',
];

function sortedKeys(value) {
  return Object.keys(value).sort();
}

function assertExactKeySet(actual, expected, label) {
  assert.deepEqual(sortedKeys(actual), [...expected].sort(), `${label} must have an explicit, exact mapping`);
}

function assertProfileReferences(profile, label) {
  assert.ok(profile && Object.keys(profile).length > 0, `${label} must not be empty`);
  for (const [slot, assetKey] of Object.entries(profile)) {
    assert.equal(typeof assetKey, 'string', `${label}.${slot} must name an asset`);
    assert.ok(REAVERBOT_TEXTURE_ASSETS[assetKey], `${label}.${slot} references missing asset ${assetKey}`);
  }
}

test('texture profiles exactly cover every current procedural Reaverbot module id', () => {
  assertExactKeySet(REAVERBOT_TEXTURE_ASSETS, EXPECTED_ASSET_KEYS, 'texture assets');
  assertExactKeySet(REAVERBOT_BODY_TEXTURE_PROFILES, EXPECTED_BODY_KEYS, 'body profiles');
  assertExactKeySet(REAVERBOT_WEAPON_TEXTURE_PROFILES, EXPECTED_WEAPON_KEYS, 'weapon profiles');
  assertExactKeySet(REAVERBOT_CHARGE_TEXTURE_PROFILES, EXPECTED_CHARGE_KEYS, 'charge profiles');
  assertExactKeySet(REAVERBOT_DEFENSE_TEXTURE_PROFILES, EXPECTED_DEFENSE_KEYS, 'defense profiles');
  assertExactKeySet(REAVERBOT_WEAK_POINT_TEXTURE_PROFILES, EXPECTED_WEAK_POINT_KEYS, 'weak-point profiles');
  assertExactKeySet(REAVERBOT_EYE_TEXTURE_PROFILES, ['singleRubyLens'], 'eye profiles');

  // Catch both an unmapped new catalog entry and a stale manifest entry.
  assert.deepEqual(sortedKeys(REAVERBOT_BODY_TEXTURE_PROFILES), sortedKeys(REAVERBOT_BODY_PLANS));
  assert.deepEqual(sortedKeys(REAVERBOT_WEAPON_TEXTURE_PROFILES), sortedKeys(REAVERBOT_WEAPONS));
  assert.deepEqual(sortedKeys(REAVERBOT_CHARGE_TEXTURE_PROFILES), sortedKeys(REAVERBOT_CHARGE_MODULES));
  assert.deepEqual(sortedKeys(REAVERBOT_DEFENSE_TEXTURE_PROFILES), sortedKeys(REAVERBOT_DEFENSES));
  assert.deepEqual(sortedKeys(REAVERBOT_WEAK_POINT_TEXTURE_PROFILES), sortedKeys(REAVERBOT_WEAK_POINTS));
});

test('all profile and decor slots reference one of the nine declared assets', () => {
  const profileFamilies = {
    body: REAVERBOT_BODY_TEXTURE_PROFILES,
    weapon: REAVERBOT_WEAPON_TEXTURE_PROFILES,
    charge: REAVERBOT_CHARGE_TEXTURE_PROFILES,
    defense: REAVERBOT_DEFENSE_TEXTURE_PROFILES,
    weakPoint: REAVERBOT_WEAK_POINT_TEXTURE_PROFILES,
    eye: REAVERBOT_EYE_TEXTURE_PROFILES,
  };

  for (const [family, profiles] of Object.entries(profileFamilies)) {
    for (const [id, profile] of Object.entries(profiles)) {
      assertProfileReferences(profile, `${family}.${id}`);
    }
  }
  assertExactKeySet(REAVERBOT_DECOR_TEXTURE_PROFILE, [
    'primary',
    'secondary',
    'trim',
    'dark',
    'weapon',
    'emissive',
    'weakPoint',
    'eyeSocket',
    'eye',
    'glint',
    'shieldEnergy',
  ], 'decor slots');
  assertProfileReferences(REAVERBOT_DECOR_TEXTURE_PROFILE, 'decor');
});

test('declared Reaverbot textures are non-empty clamped PNG maps with complete loader metadata', async () => {
  const declaredPaths = Object.values(REAVERBOT_TEXTURE_ASSETS).map((asset) => asset.path);
  assert.equal(new Set(declaredPaths).size, declaredPaths.length, 'texture asset paths must be unique');
  for (const [key, asset] of Object.entries(REAVERBOT_TEXTURE_ASSETS)) {
    assert.equal(asset.id, key);
    assert.match(asset.path, /^\/assets\/textures\/reaverbots\/procedural\/.+\.png$/);
    assert.ok(['color', 'mask'].includes(asset.type));
    assert.ok(['srgb', 'none'].includes(asset.colorSpace));
    assert.equal(asset.wrapS, 'clampToEdge', `${key} must not tile horizontally`);
    assert.equal(asset.wrapT, 'clampToEdge', `${key} must not tile vertically`);
    assert.deepEqual(asset.repeat, [1, 1]);
    assert.equal(asset.anisotropy, 4);
    assert.equal(asset.generateMipmaps, true);
    if (asset.type === 'mask') {
      assert.equal(asset.colorSpace, 'none');
      assert.equal(asset.mask, 'luminance');
      assert.equal(asset.minFilter, 'linearMipmapLinear');
      assert.equal(asset.magFilter, 'linear');
    } else {
      assert.equal(asset.colorSpace, 'srgb');
      assert.equal(asset.mask, null);
      assert.equal(asset.minFilter, 'nearestMipmapNearest');
      assert.equal(asset.magFilter, 'nearest');
    }

    const relativePath = asset.path.replace(/^[/\\]+/, '');
    const bytes = await readFile(path.join(REPO_ROOT, relativePath));
    assert.ok(bytes.length > 24, `${key} must not be empty or truncated`);
    assert.ok(bytes.subarray(0, 8).equals(PNG_SIGNATURE), `${key} must have a PNG signature`);
    assert.equal(bytes.toString('ascii', 12, 16), 'IHDR', `${key} must begin with an IHDR chunk`);
    assert.equal(bytes.readUInt32BE(16), 256, `${key} width`);
    assert.equal(bytes.readUInt32BE(20), 256, `${key} height`);
  }
});

test('the approved ruby eye map remains byte-identical and keeps its original path', async () => {
  const eyeAsset = REAVERBOT_TEXTURE_ASSETS.eyeRedLens;
  assert.equal(eyeAsset.path, EYE_TEXTURE_PATH);
  assert.equal(eyeAsset.wrapS, 'clampToEdge');
  assert.equal(eyeAsset.wrapT, 'clampToEdge');
  assert.deepEqual(eyeAsset.repeat, [1, 1]);

  const bytes = await readFile(path.join(REPO_ROOT, eyeAsset.path.replace(/^[/\\]+/, '')));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), EYE_TEXTURE_SHA256);
});

test('semantic UV layout exposes valid padded regions, value classes, and a preserved full-map eye view', () => {
  assert.equal(REAVERBOT_SEMANTIC_UV_LAYOUT.version, 1);
  assert.equal(REAVERBOT_SEMANTIC_UV_LAYOUT.referenceSize, 256);
  assert.ok(REAVERBOT_SEMANTIC_UV_LAYOUT.gutterPixels >= 2);
  assert.strictEqual(REAVERBOT_SEMANTIC_UV_LAYOUT.regions, REAVERBOT_SEMANTIC_UV_REGIONS);
  assert.strictEqual(REAVERBOT_SEMANTIC_UV_LAYOUT.roles, REAVERBOT_SURFACE_ROLE_LAYOUTS);

  for (const [regionId, region] of Object.entries(REAVERBOT_SEMANTIC_UV_REGIONS)) {
    assert.equal(region.id, regionId);
    assert.equal(region.rect.length, 4);
    const [u0, v0, u1, v1] = region.rect;
    assert.ok(Number.isFinite(u0) && Number.isFinite(v0) && Number.isFinite(u1) && Number.isFinite(v1));
    assert.ok(u0 >= 0 && v0 >= 0 && u1 <= 1 && v1 <= 1, `${regionId} lies inside the atlas`);
    assert.ok(u1 > u0 && v1 > v0, `${regionId} is nondegenerate`);
    if (region.padded) {
      assert.ok(u0 > 0 && v0 > 0 && u1 < 1 && v1 < 1, `${regionId} retains a filtering gutter`);
    }
  }
  assert.deepEqual(REAVERBOT_SEMANTIC_UV_REGIONS.fullMap.rect, [0, 0, 1, 1]);
  assert.equal(REAVERBOT_SEMANTIC_UV_REGIONS.fullMap.padded, false);

  for (const [roleId, role] of Object.entries(REAVERBOT_SURFACE_ROLE_LAYOUTS)) {
    assert.equal(role.id, roleId);
    assert.match(role.valueClass, /^[a-z][a-z-]+$/);
    assert.ok(role.mappingMode.length > 0);
    assert.ok(role.regionIds.length > 0);
    for (const regionId of role.regionIds) assert.ok(REAVERBOT_SEMANTIC_UV_REGIONS[regionId]);
  }
  assert.equal(REAVERBOT_SURFACE_ROLE_LAYOUTS.workingEdge.mappingMode, 'longitudinal-working-end');
  assert.equal(REAVERBOT_SURFACE_ROLE_LAYOUTS.workingEdge.workingEnd, 'vMax');
  assert.deepEqual(REAVERBOT_SURFACE_ROLE_LAYOUTS.eye.regionIds, ['fullMap']);
  assert.equal(REAVERBOT_SURFACE_ROLE_LAYOUTS.eye.valueClass, 'ruby-eye');
});

function groupVertexIndices(geometry, group) {
  const index = geometry.getIndex();
  const result = new Set();
  const end = group.start + group.count;
  for (let cursor = group.start; cursor < end; cursor += 1) {
    result.add(index ? index.getX(cursor) : cursor);
  }
  return [...result];
}

function assertGroupUvsInsideRects(result) {
  const geometry = result.geometry;
  const uv = geometry.getAttribute('uv');
  const groups = geometry.groups.length > 0
    ? geometry.groups
    : [{ start: 0, count: geometry.getIndex()?.count ?? uv.count }];
  assert.equal(groups.length, result.uvRects.length);
  groups.forEach((group, groupIndex) => {
    const [u0, v0, u1, v1] = result.uvRects[groupIndex];
    for (const vertexIndex of groupVertexIndices(geometry, group)) {
      const u = uv.getX(vertexIndex);
      const v = uv.getY(vertexIndex);
      assert.ok(u >= u0 - 1e-7 && u <= u1 + 1e-7, `group ${groupIndex} u remains inside its region`);
      assert.ok(v >= v0 - 1e-7 && v <= v1 + 1e-7, `group ${groupIndex} v remains inside its region`);
    }
  });
}

test('semantic UV remapping is deterministic, group-varied, mirrored, and texture-transform neutral', () => {
  const config = {
    scope: 'weapon',
    moduleId: 'clawArm',
    partName: 'generatedConstructorClawRazorTalon',
    role: 'workingEdge',
  };
  const first = applyReaverbotSemanticUv(new THREE.ConeGeometry(0.16, 1.22, 5), config);
  const repeated = applyReaverbotSemanticUv(new THREE.ConeGeometry(0.16, 1.22, 5), config);

  assert.deepEqual(repeated.regionIds, first.regionIds);
  assert.deepEqual(repeated.uvRects, first.uvRects);
  assert.deepEqual(
    [...repeated.geometry.getAttribute('uv').array],
    [...first.geometry.getAttribute('uv').array],
  );
  assert.equal(first.valueClass, 'working-edge');
  assert.equal(first.mappingMode, 'longitudinal-working-end');
  assert.ok(new Set(first.regionIds).size > 1, 'primitive groups select varied semantic views');
  assertGroupUvsInsideRects(first);

  const left = applyReaverbotSemanticUv(new THREE.BoxGeometry(1, 1, 1), {
    scope: 'body', moduleId: 'biped', partName: 'generatedLeftArm', role: 'armor', mirror: false,
  });
  const right = applyReaverbotSemanticUv(new THREE.BoxGeometry(1, 1, 1), {
    scope: 'body', moduleId: 'biped', partName: 'generatedRightArm', role: 'armor', mirror: true,
  });
  assert.deepEqual(right.regionIds, left.regionIds, 'paired part names share a layout before mirroring');
  const leftUv = left.geometry.getAttribute('uv');
  const rightUv = right.geometry.getAttribute('uv');
  for (let index = 0; index < leftUv.count; index += 1) {
    const groupIndex = Math.floor(index / 4);
    const [u0, , u1] = left.uvRects[groupIndex];
    assert.ok(Math.abs((leftUv.getX(index) + rightUv.getX(index)) - (u0 + u1)) < 1e-6);
    assert.ok(Math.abs(leftUv.getY(index) - rightUv.getY(index)) < 1e-6);
  }
  assertGroupUvsInsideRects(left);
  assertGroupUvsInsideRects(right);

  const sharedTexture = getReaverbotTexture('armorPrimary');
  const textureState = {
    uuid: sharedTexture.uuid,
    offset: sharedTexture.offset.toArray(),
    repeat: sharedTexture.repeat.toArray(),
    rotation: sharedTexture.rotation,
    center: sharedTexture.center.toArray(),
    matrix: sharedTexture.matrix.toArray(),
  };
  applyReaverbotSemanticUv(new THREE.CylinderGeometry(1, 1, 1, 8), {
    scope: 'defense', moduleId: 'directionalShield', partName: 'generatedDirectionalShield', role: 'armor',
  });
  assert.strictEqual(getReaverbotTexture('armorPrimary'), sharedTexture, 'shared cache identity remains exact');
  assert.deepEqual({
    uuid: sharedTexture.uuid,
    offset: sharedTexture.offset.toArray(),
    repeat: sharedTexture.repeat.toArray(),
    rotation: sharedTexture.rotation,
    center: sharedTexture.center.toArray(),
    matrix: sharedTexture.matrix.toArray(),
  }, textureState, 'geometry remapping never mutates shared texture transforms');
});

test('surface inference and keyed selection create deterministic part-specific diversity', () => {
  assert.equal(inferReaverbotSurfaceRole('generatedConstructorClawElbowHinge', 'joint'), 'joint');
  assert.equal(inferReaverbotSurfaceRole('generatedConstructorClawRazorTalon', 'workingSurface'), 'workingEdge');
  assert.equal(inferReaverbotSurfaceRole('generatedReaverbotCircuitInlay', 'secondary'), 'circuit');
  assert.equal(inferReaverbotSurfaceRole('generatedReaverbotRedEye', 'eye'), 'eye');
  assert.equal(inferReaverbotSurfaceRole('generatedEyeArmorShutter', 'primary'), 'armor');

  const signatures = new Set();
  for (const [moduleId, partName] of [
    ['biped', 'generatedReaverbotTorso'],
    ['quadruped', 'generatedReaverbotAnimalTorso'],
    ['tripod', 'generatedReaverbotTripodChassis'],
    ['crawler', 'generatedReaverbotCrawlerShell'],
  ]) {
    const result = applyReaverbotSemanticUv(new THREE.BoxGeometry(1, 1, 1), {
      scope: 'body', moduleId, partName, role: 'armor',
    });
    signatures.add(result.regionIds.join('|'));
  }
  assert.ok(signatures.size > 1, 'scope, module, and part identity vary the selected semantic regions');

  const eye = applyReaverbotSemanticUv(new THREE.SphereGeometry(0.2, 8, 5), {
    scope: 'eye', moduleId: 'singleRubyLens', partName: 'generatedReaverbotRedEye', role: 'eye',
  });
  assert.deepEqual(eye.regionIds, ['fullMap']);
  assert.deepEqual(eye.uvRects, [[0, 0, 1, 1]]);
  assert.equal(eye.mappingMode, 'full-map-preserve');
});

test('resolver deterministically merges module profiles and permits claw genomes with no defense', () => {
  const genome = {
    body: { planId: 'quadruped' },
    modules: {
      weapon: { id: 'clawArm' },
      defense: null,
      weakPoint: { id: 'clawPalm' },
      eye: { id: 'singleRubyLens' },
    },
  };
  const first = resolveReaverbotTextureProfile(genome);
  const second = resolveReaverbotTextureProfile(genome);

  assert.deepEqual(first, second);
  assert.equal(first.defense, null);
  assert.strictEqual(first.body, REAVERBOT_BODY_TEXTURE_PROFILES.quadruped);
  assert.strictEqual(first.weapon, REAVERBOT_WEAPON_TEXTURE_PROFILES.clawArm);
  assert.strictEqual(first.weakPoint, REAVERBOT_WEAK_POINT_TEXTURE_PROFILES.clawPalm);
  assert.strictEqual(first.eye, REAVERBOT_EYE_TEXTURE_PROFILES.singleRubyLens);
  assert.equal(first.materialSlots.weapon, 'weaponHousing');
  assert.equal(first.materialSlots.trim, 'bladeMetal');
  assert.equal(first.materialSlots.eye, 'eyeRedLens');
  assert.equal(first.materialSlots.primary, 'armorPrimary');
  assert.throws(
    () => resolveReaverbotTextureProfile({ ...genome, body: { planId: 'unknown' } }),
    /Unknown Reaverbot body texture profile: unknown/,
  );
});
