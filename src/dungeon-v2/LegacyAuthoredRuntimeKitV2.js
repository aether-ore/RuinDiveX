import * as THREE from 'three';
import {
  LEGACY_AUTHORED_ASSET_CATALOG_V2,
  LEGACY_CODE_NATIVE_PREFABS_V2,
  LEGACY_RUIN_MATERIAL_PROFILES_V2,
} from './LegacyAuthoredModuleKitV2.js';

const FIT_TOLERANCE_METRES = 0.05;
const MIN_EXTENT = 1e-6;
const PRESENTATION_COLLISION_POLICY = 'presentation-only-plan-collider-authoritative';
export const LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2 = 2.8;

const MATERIAL_PROFILE_BY_ID = new Map(
  Object.values(LEGACY_RUIN_MATERIAL_PROFILES_V2)
    .map((profile) => [profile.id, profile]),
);

const TEXTURE_ASSET_BY_ID = new Map(
  Object.values(LEGACY_AUTHORED_ASSET_CATALOG_V2.textures)
    .map((asset) => [asset.id, asset]),
);

const PREFAB_BY_ID = new Map(
  Object.entries(LEGACY_CODE_NATIVE_PREFABS_V2)
    .flatMap(([key, prefab]) => [[key, prefab], [prefab.id, prefab]]),
);

const PROFILE_KEYS = Object.freeze({
  wall: 'wallIndustrial',
  ceiling: 'ceiling',
  floor: 'floor',
  cracked: 'crackedFloor',
  octagon: 'octagonFloor',
  catwalk: 'catwalk',
  raised: 'raisedDeck',
  server: 'serverFloor',
  machine: 'machineFloor',
  coolant: 'coolantFloor',
  conveyor: 'conveyor',
  shrine: 'shrine',
  keycard: 'keycard',
  terminal: 'terminal',
  support: 'support',
  rail: 'rail',
  hazard: 'hazardStripe',
  blue: 'glowBlue',
  yellow: 'glowYellow',
  red: 'glowRed',
  green: 'glowGreen',
  violet: 'glowViolet',
  refractor: 'refractor',
});

function joinedIdentifier(value) {
  if (typeof value === 'string') return value.toLowerCase();
  if (!value || typeof value !== 'object') return '';
  return [
    value.id,
    value.profileId,
    value.materialProfileId,
    value.regionId,
    value.fixtureId,
    value.fixtureType,
    value.type,
    value.assetFamilyId,
    value.familyId,
    value.presentationAsset?.familyId,
  ].filter((entry) => typeof entry === 'string').join(' ').toLowerCase();
}

function profileFromKey(key) {
  return LEGACY_RUIN_MATERIAL_PROFILES_V2[PROFILE_KEYS[key]];
}

/**
 * Maps either a known profile id or arbitrary V2 region/fixture/profile
 * identifiers onto the V1 ruin material language. This function is pure and
 * does not inspect scene objects or mesh names.
 */
export function resolveLegacyRuinMaterialProfileV2(value) {
  const directId = typeof value === 'string'
    ? value
    : value?.materialProfileId ?? value?.profileId;
  if (directId && MATERIAL_PROFILE_BY_ID.has(directId)) return MATERIAL_PROFILE_BY_ID.get(directId);
  if (directId && LEGACY_RUIN_MATERIAL_PROFILES_V2[directId]) {
    return LEGACY_RUIN_MATERIAL_PROFILES_V2[directId];
  }

  const id = joinedIdentifier(value);
  if (/large[-_ ]?refractor|refractor/.test(id)) return profileFromKey('refractor');
  if (/shrine|sanctum|extraction|chapel/.test(id)) return profileFromKey('shrine');
  if (/crack|crumble|fracture/.test(id)) return profileFromKey('cracked');
  if (/octagon|warehouse|nest/.test(id) && /floor|deck|surface/.test(id)) return profileFromKey('octagon');
  if (/conveyor|cargo[-_ ]?track|sorting[-_ ]?belt/.test(id)) return profileFromKey('conveyor');
  if (/key|credential|gate|door/.test(id)) return profileFromKey('keycard');
  if (/terminal|console|control|router|valve/.test(id)) return profileFromKey('terminal');
  if (/rail|guard/.test(id)) return profileFromKey('rail');
  if (/support|girder|column|frame|foundation/.test(id)) return profileFromKey('support');
  if (/hazard|magma|warning|stripe/.test(id)) return profileFromKey('hazard');
  if (/violet|nest|corrupt/.test(id) && /glow|light|liquid|signal/.test(id)) return profileFromKey('violet');
  if (/red|magma|danger/.test(id) && /glow|light|signal/.test(id)) return profileFromKey('red');
  if (/green|safe|ready/.test(id) && /glow|light|signal|status/.test(id)) return profileFromKey('green');
  if (/yellow|amber|credential/.test(id) && /glow|light|signal|status/.test(id)) return profileFromKey('yellow');
  if (/blue|coolant|water/.test(id) && /glow|light|signal|status/.test(id)) return profileFromKey('blue');
  if (/ceiling|overhead[-_ ]?shell/.test(id)) return profileFromKey('ceiling');
  if (/wall|boundary|bulkhead/.test(id)) return profileFromKey('wall');
  if (/trim/.test(id)) return profileFromKey('support');
  if (/signal|indicator/.test(id)) return profileFromKey('blue');
  if (/server|crypt|circuit|data/.test(id)) return profileFromKey('server');
  if (/coolant|waterworks|reservoir|sump|water/.test(id)) return profileFromKey('coolant');
  if (/catwalk|gantry|bridge/.test(id)) return profileFromKey('catwalk');
  if (/raised|mezzanine|platform|stair|deck/.test(id)) return profileFromKey('raised');
  if (/machine|factory|reactor|undercroft/.test(id)) return profileFromKey('machine');
  if (/floor|walkable|surface/.test(id)) return profileFromKey('floor');
  return profileFromKey('wall');
}

export function resolveLegacyRuinMaterialProfileIdV2(value) {
  return resolveLegacyRuinMaterialProfileV2(value).id;
}

/** Resolve a stable V1 presentation family without consulting runtime meshes. */
export function resolveLegacyAssetFamilyIdV2(value) {
  const explicit = value?.assetFamilyId
    ?? value?.presentationAsset?.familyId
    ?? value?.sourceAssetFamilyId
    ?? value?.familyId;
  if (typeof explicit === 'string' && explicit.trim()) return explicit;
  const id = joinedIdentifier(value);
  if (/shrine|sanctum|extraction|refractor/.test(id)) return 'v1.refractor-shrine';
  if (/server|crypt|data/.test(id)) return 'v1.server-crypt';
  if (/warehouse|parts|storage/.test(id)) return 'v1.parts-warehouse';
  if (/nest/.test(id)) return 'v1.nest-warehouse';
  if (/sorting|conveyor|cargo/.test(id)) return 'v1.factory-conveyor';
  if (/coolant|water|reservoir|sump|pump/.test(id)) return 'v1.coolant-relay';
  if (/hazard|reactor|undercroft/.test(id)) return 'v1.reactor-machine';
  if (/machine[-_ ]?core|turbine/.test(id)) return 'v1.machine-core';
  if (/credential|pyramid/.test(id)) return 'v1.credential-pyramid';
  return 'v1.factory-assembly';
}

function explicitPrefab(value) {
  const id = value?.prefabId ?? value?.presentationAsset?.prefabId;
  if (id == null) return null;
  const prefab = PREFAB_BY_ID.get(id);
  if (!prefab) throw new RangeError(`Unknown legacy-authored V2 prefab: ${id}`);
  return prefab;
}

/**
 * Selects one of the code-native V1-derived recipes. Selection depends only
 * on accepted plan data (fixture type and asset family), never mesh names.
 */
export function selectLegacyAuthoredPrefabV2(value = {}) {
  const explicit = explicitPrefab(value);
  if (explicit) return explicit;
  const type = String(value.fixtureType ?? value.type ?? value.presentationAsset?.role ?? '').toLowerCase();
  const family = resolveLegacyAssetFamilyIdV2(value).toLowerCase();

  if (/processing[-_ ]?tank|vat|occupation[-_ ]?vessel/.test(type)) return LEGACY_CODE_NATIVE_PREFABS_V2.processingVat;
  if (/conveyor|cargo[-_ ]?track|moving[-_ ]?cargo|sorting[-_ ]?belt/.test(type)) return LEGACY_CODE_NATIVE_PREFABS_V2.conveyorDrive;
  if (/reservoir|pressure[-_ ]?vessel|pressure[-_ ]?pipe|coolant[-_ ]?pipe|traversal[-_ ]?pipe|conduit|main$/.test(type)) {
    return LEGACY_CODE_NATIVE_PREFABS_V2.waterTank;
  }
  if (/server[-_ ]?bank|archive|pylon|rack|storage|shelf/.test(type)) {
    if (/shrine|sanctum|refractor|chapel/.test(family)) return LEGACY_CODE_NATIVE_PREFABS_V2.shrineMonolith;
    if (/warehouse|parts|nest|salvage|freight/.test(family)) return LEGACY_CODE_NATIVE_PREFABS_V2.storageRack;
    return LEGACY_CODE_NATIVE_PREFABS_V2.serverMonolith;
  }
  if (/shrine|sanctum|refractor|chapel|monolith/.test(type)) return LEGACY_CODE_NATIVE_PREFABS_V2.shrineMonolith;
  if (/pump|generator|control[-_ ]?bank|motor|drive|turbine/.test(type)) return LEGACY_CODE_NATIVE_PREFABS_V2.circulationPump;
  if (/girder|structural|functional[-_ ]?machine|frame|support/.test(type)) return LEGACY_CODE_NATIVE_PREFABS_V2.girderFrame;

  if (/warehouse|parts|nest|salvage/.test(family)) return LEGACY_CODE_NATIVE_PREFABS_V2.storageRack;
  if (/server|crypt/.test(family)) return LEGACY_CODE_NATIVE_PREFABS_V2.serverMonolith;
  if (/coolant|water/.test(family)) return LEGACY_CODE_NATIVE_PREFABS_V2.circulationPump;
  if (/conveyor|sorting/.test(family)) return LEGACY_CODE_NATIVE_PREFABS_V2.conveyorDrive;
  return LEGACY_CODE_NATIVE_PREFABS_V2.circulationPump;
}

function finitePoint(value, label) {
  if (!value || !['x', 'y', 'z'].every((axis) => Number.isFinite(value[axis]))) {
    throw new TypeError(`${label} must contain finite x, y, and z values.`);
  }
  return value;
}

function normalizeBounds(fixture) {
  const source = fixture?.worldBounds ?? fixture?.bounds ?? fixture?.localBounds;
  if (source?.min && source?.max) {
    const min = finitePoint(source.min, 'fixture bounds.min');
    const max = finitePoint(source.max, 'fixture bounds.max');
    const size = new THREE.Vector3(max.x - min.x, max.y - min.y, max.z - min.z);
    if ([size.x, size.y, size.z].some((extent) => extent <= MIN_EXTENT)) {
      throw new RangeError('Legacy-authored fixture bounds must have positive three-dimensional volume.');
    }
    return {
      min: new THREE.Vector3(min.x, min.y, min.z),
      max: new THREE.Vector3(max.x, max.y, max.z),
      size,
      center: new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5),
    };
  }
  const center = finitePoint(fixture?.center, 'fixture center');
  const dimensions = finitePoint(fixture?.dimensions ?? fixture?.size, 'fixture dimensions');
  if (['x', 'y', 'z'].some((axis) => dimensions[axis] <= MIN_EXTENT)) {
    throw new RangeError('Legacy-authored fixture dimensions must be positive.');
  }
  const size = new THREE.Vector3(dimensions.x, dimensions.y, dimensions.z);
  const centerVector = new THREE.Vector3(center.x, center.y, center.z);
  return {
    min: centerVector.clone().addScaledVector(size, -0.5),
    max: centerVector.clone().addScaledVector(size, 0.5),
    size,
    center: centerVector,
  };
}

function materialParameters(profile, texture) {
  const parameters = {
    color: profile.color ?? 0xffffff,
    emissive: profile.emissive ?? 0x000000,
    emissiveIntensity: profile.emissiveIntensity ?? 1,
    roughness: profile.roughness ?? 0.75,
    metalness: profile.metalness ?? 0.08,
    transparent: profile.transparent ?? false,
    opacity: profile.opacity ?? 1,
  };
  if (texture) parameters.map = texture;
  return parameters;
}

function geometryCacheKey(shape, dimensions) {
  return `${shape}:${JSON.stringify(dimensions)}`;
}

function boxGeometryDimensions(dimensions) {
  const x = Number(dimensions?.x);
  const y = Number(dimensions?.y);
  const z = Number(dimensions?.z);
  if (![x, y, z].every((entry) => Number.isFinite(entry) && entry > 0)) {
    throw new RangeError('Legacy-authored box primitive requires positive x, y, and z dimensions.');
  }
  return { x, y, z };
}

function textureRepeatCount(worldExtent) {
  if (!Number.isFinite(worldExtent) || worldExtent <= 0) {
    throw new RangeError('Legacy-authored texture extents must be positive and finite.');
  }
  return worldExtent / LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2;
}

function applyWorldScaleBoxUvs(geometry, dimensions) {
  const uv = geometry.getAttribute('uv');
  const normal = geometry.getAttribute('normal');
  if (!uv || !normal || uv.count !== normal.count) {
    throw new Error('Legacy-authored fitted box texturing requires matching UV and normal attributes.');
  }
  const faceRepeats = {
    x: { u: textureRepeatCount(dimensions.z), v: textureRepeatCount(dimensions.y) },
    y: { u: textureRepeatCount(dimensions.x), v: textureRepeatCount(dimensions.z) },
    z: { u: textureRepeatCount(dimensions.x), v: textureRepeatCount(dimensions.y) },
  };
  for (let index = 0; index < uv.count; index += 1) {
    const x = Math.abs(normal.getX(index));
    const y = Math.abs(normal.getY(index));
    const z = Math.abs(normal.getZ(index));
    const repeats = x >= y && x >= z ? faceRepeats.x : y >= z ? faceRepeats.y : faceRepeats.z;
    uv.setXY(index, uv.getX(index) * repeats.u, uv.getY(index) * repeats.v);
  }
  uv.needsUpdate = true;
  geometry.userData.v2TextureTiling = {
    mode: 'per-face-world-dimensions',
    tileScaleMetres: LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2,
    dimensions: { ...dimensions },
    faceRepeats,
  };
}

function applyWorldScaleUvRanges(geometry, uExtent, vExtent) {
  const uv = geometry.getAttribute('uv');
  if (!uv) throw new Error(`${geometry.type} fitted world-scale texturing requires a UV attribute.`);
  const uRepeat = textureRepeatCount(uExtent);
  const vRepeat = textureRepeatCount(vExtent);
  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(index, uv.getX(index) * uRepeat, uv.getY(index) * vRepeat);
  }
  uv.needsUpdate = true;
  geometry.userData.v2TextureTiling = {
    mode: 'world-extent-uv-ranges',
    tileScaleMetres: LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2,
    uExtent,
    vExtent,
    uRepeat,
    vRepeat,
  };
}

function matrixAxisLengths(matrix) {
  const elements = matrix.elements;
  return {
    x: Math.hypot(elements[0], elements[1], elements[2]),
    y: Math.hypot(elements[4], elements[5], elements[6]),
    z: Math.hypot(elements[8], elements[9], elements[10]),
  };
}

function ellipseCircumference(radiusX, radiusY) {
  return Math.PI * (
    3 * (radiusX + radiusY)
    - Math.sqrt((3 * radiusX + radiusY) * (radiusX + 3 * radiusY))
  );
}

function tagPresentationObject(object, tags) {
  object.userData.v2LegacyAuthoredPresentation = true;
  object.userData.v2PresentationOnly = true;
  object.userData.v2CollisionPolicy = PRESENTATION_COLLISION_POLICY;
  object.userData.v2FixtureId = tags.fixtureId;
  object.userData.v2AssetFamilyId = tags.assetFamilyId;
  object.userData.v2LegacyPrefabId = tags.prefabId;
  object.userData.v2LegacyPrefabPrimitiveId = tags.primitiveId ?? null;
}

function pipeAxisRotation(fixture, bounds) {
  const type = String(fixture?.fixtureType ?? fixture?.type ?? '').toLowerCase();
  if (!/pipe|conduit|main/.test(type)) return null;
  if (bounds.size.x >= bounds.size.y && bounds.size.x >= bounds.size.z) return { z: Math.PI / 2 };
  if (bounds.size.z >= bounds.size.x && bounds.size.z >= bounds.size.y) return { x: Math.PI / 2 };
  return null;
}

export class LegacyAuthoredRuntimeKitV2 {
  constructor({
    textureLoader = null,
    loadBrowserTextures = typeof document !== 'undefined' && typeof Image !== 'undefined',
  } = {}) {
    this.loadBrowserTextures = Boolean(loadBrowserTextures);
    this.textureLoader = textureLoader ?? (this.loadBrowserTextures ? new THREE.TextureLoader() : null);
    this.textures = new Map();
    this.materials = new Map();
    this.geometries = new Map();
    this.generatedGeometries = new Set();
    this.disposed = false;
  }

  _assertActive() {
    if (this.disposed) throw new Error('LegacyAuthoredRuntimeKitV2 has been disposed.');
  }

  getTexture(textureAssetId) {
    this._assertActive();
    if (!textureAssetId) return null;
    if (this.textures.has(textureAssetId)) return this.textures.get(textureAssetId);
    const asset = TEXTURE_ASSET_BY_ID.get(textureAssetId);
    if (!asset) throw new RangeError(`Unknown legacy ruin texture asset: ${textureAssetId}`);

    let texture;
    if (this.loadBrowserTextures) {
      if (!this.textureLoader?.load) throw new TypeError('Browser texture loading requires a TextureLoader-compatible object.');
      texture = this.textureLoader.load(asset.url);
      texture.userData.v2TextureSource = 'dungeon-v1-asset';
    } else {
      // TextureLoader touches document/Image. A real THREE.Texture keeps Node
      // fixture tests representative without requiring a DOM or decoding PNGs.
      texture = new THREE.Texture();
      texture.userData.v2TextureSource = 'node-placeholder';
      texture.userData.v2TextureUrl = asset.url;
    }
    texture.name = asset.id;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.userData.v2TextureAssetId = asset.id;
    texture.userData.v2TextureUrl = asset.url;
    texture.userData.v2WorldScaleTiling = true;
    texture.userData.v2TextureTileScaleMetres = LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2;
    this.textures.set(textureAssetId, texture);
    return texture;
  }

  getMaterial(value) {
    this._assertActive();
    const profile = resolveLegacyRuinMaterialProfileV2(value);
    if (this.materials.has(profile.id)) return this.materials.get(profile.id);
    const texture = profile.textureAssetId ? this.getTexture(profile.textureAssetId) : null;
    const material = new THREE.MeshStandardMaterial(materialParameters(profile, texture));
    material.name = profile.id;
    material.userData.v2LegacyRuinMaterial = true;
    material.userData.v2LegacyMaterialProfileId = profile.id;
    material.userData.v2TextureAssetId = profile.textureAssetId ?? null;
    material.userData.v2WorldScaleTiling = Boolean(texture);
    material.userData.v2TextureTileScaleMetres = texture
      ? LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2
      : null;
    this.materials.set(profile.id, material);
    return material;
  }

  _getGeometry(shape, dimensions) {
    this._assertActive();
    const key = geometryCacheKey(shape, dimensions);
    if (this.geometries.has(key)) return this.geometries.get(key);
    let geometry;
    if (shape === 'box') {
      const { x, y, z } = boxGeometryDimensions(dimensions);
      geometry = new THREE.BoxGeometry(x, y, z);
    } else if (shape === 'cylinder' || shape === 'open-cylinder') {
      geometry = new THREE.CylinderGeometry(
        Number(dimensions.radiusTop),
        Number(dimensions.radiusBottom),
        Number(dimensions.height),
        Number(dimensions.radialSegments ?? 16),
        1,
        shape === 'open-cylinder',
      );
    } else if (shape === 'octahedron') {
      geometry = new THREE.OctahedronGeometry(Number(dimensions.radius), 0);
    } else if (shape === 'torus') {
      geometry = new THREE.TorusGeometry(
        Number(dimensions.radius),
        Number(dimensions.tube),
        Number(dimensions.radialSegments ?? 8),
        Number(dimensions.tubularSegments ?? 16),
      );
    } else {
      throw new RangeError(`Unsupported legacy-authored primitive shape: ${shape}`);
    }
    geometry.name = `legacy-authored:${key}`;
    this.geometries.set(key, geometry);
    return geometry;
  }

  _createIBeam(primitive, material, horizontal = false) {
    const dimensions = primitive.dimensions;
    const length = Number(dimensions.length);
    const web = Number(dimensions.web);
    const flange = Number(dimensions.flange);
    if (![length, web, flange].every((entry) => Number.isFinite(entry) && entry > 0)) {
      throw new RangeError('Legacy-authored I-beam requires positive length, web, and flange dimensions.');
    }
    const group = new THREE.Group();
    const pieces = horizontal
      ? [
        { center: [0, 0, 0], size: [length, web, web] },
        { center: [0, flange * 0.5, 0], size: [length, web, flange] },
        { center: [0, -flange * 0.5, 0], size: [length, web, flange] },
      ]
      : [
        { center: [0, 0, 0], size: [web, length, web] },
        { center: [flange * 0.5, 0, 0], size: [web, length, flange] },
        { center: [-flange * 0.5, 0, 0], size: [web, length, flange] },
      ];
    for (const piece of pieces) {
      const mesh = new THREE.Mesh(
        this._getGeometry('box', { x: piece.size[0], y: piece.size[1], z: piece.size[2] }),
        material,
      );
      mesh.position.fromArray(piece.center);
      group.add(mesh);
    }
    return group;
  }

  _createPrimitive(primitive, tags) {
    const material = this.getMaterial(primitive.materialProfileId);
    let object;
    if (primitive.shape === 'i-beam' || primitive.shape === 'i-beam-horizontal') {
      object = this._createIBeam(primitive, material, primitive.shape === 'i-beam-horizontal');
    } else {
      object = new THREE.Mesh(this._getGeometry(primitive.shape, primitive.dimensions), material);
    }
    object.position.set(primitive.center.x, primitive.center.y, primitive.center.z);
    const rotation = primitive.rotation ?? {};
    object.rotation.set(
      Number(rotation.x ?? 0),
      Number(rotation.y ?? primitive.yaw ?? 0),
      Number(rotation.z ?? 0),
    );
    object.traverse((child) => {
      tagPresentationObject(child, { ...tags, primitiveId: primitive.id });
      if (child.isMesh) {
        child.castShadow = primitive.castShadow !== false;
        child.receiveShadow = primitive.receiveShadow !== false;
      }
    });
    return object;
  }

  _tileFittedFixtureGeometry(group) {
    group.updateWorldMatrix(true, true);
    group.traverse((object) => {
      if (!object.isMesh) return;
      const materials = (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean);
      if (!materials.some((material) => material.map)) return;
      const geometry = object.geometry.clone();
      geometry.computeBoundingBox();
      const localSize = geometry.boundingBox.getSize(new THREE.Vector3());
      const axes = matrixAxisLengths(object.matrixWorld);
      const worldDimensions = {
        x: localSize.x * axes.x,
        y: localSize.y * axes.y,
        z: localSize.z * axes.z,
      };
      if (geometry.type === 'BoxGeometry') {
        applyWorldScaleBoxUvs(geometry, worldDimensions);
      } else if (geometry.type === 'CylinderGeometry') {
        const parameters = geometry.parameters;
        const radiusX = Math.max(parameters.radiusTop, parameters.radiusBottom) * axes.x;
        const radiusZ = Math.max(parameters.radiusTop, parameters.radiusBottom) * axes.z;
        applyWorldScaleUvRanges(
          geometry,
          ellipseCircumference(radiusX, radiusZ),
          parameters.height * axes.y,
        );
      } else if (geometry.type === 'TorusGeometry') {
        const parameters = geometry.parameters;
        applyWorldScaleUvRanges(
          geometry,
          Math.PI * 2 * parameters.radius * ((axes.x + axes.y) * 0.5),
          Math.PI * 2 * parameters.tube * ((axes.x + axes.y + axes.z) / 3),
        );
      } else {
        applyWorldScaleUvRanges(
          geometry,
          Math.max(worldDimensions.x, worldDimensions.z),
          worldDimensions.y,
        );
      }
      geometry.name = `${object.geometry.name}:fitted-world-tiled`;
      object.geometry = geometry;
      object.userData.v2TextureTiling = JSON.parse(JSON.stringify(geometry.userData.v2TextureTiling));
      this.generatedGeometries.add(geometry);
    });
  }

  /**
   * Builds a presentation-only group whose final world AABB is aligned to the
   * supplied plan fixture bounds. The plan's collider remains authoritative.
   */
  renderFixture(fixture, { parent = null, assetFamilyId = null, prefabId = null } = {}) {
    this._assertActive();
    if (!fixture || typeof fixture !== 'object') throw new TypeError('renderFixture requires a fixture object.');
    const fixtureId = String(fixture.id ?? '').trim();
    if (!fixtureId) throw new TypeError('Legacy-authored runtime fixtures require a stable id.');
    const bounds = normalizeBounds(fixture);
    const resolvedFamilyId = assetFamilyId ?? resolveLegacyAssetFamilyIdV2(fixture);
    const prefab = selectLegacyAuthoredPrefabV2(prefabId ? { ...fixture, prefabId } : fixture);
    const tags = { fixtureId, assetFamilyId: resolvedFamilyId, prefabId: prefab.id };

    const group = new THREE.Group();
    group.name = `legacy-authored-fixture:${fixtureId}`;
    tagPresentationObject(group, tags);
    group.userData.v2TargetBounds = {
      min: bounds.min.toArray(),
      max: bounds.max.toArray(),
      tolerance: FIT_TOLERANCE_METRES,
    };

    // Keep fitting scale on a world-axis-aligned parent. The recipe child may
    // rotate by a quarter turn (or turn a vertical tank into a pipe); putting
    // non-uniform scale on that rotated child would shear the intended AABB.
    const fitRoot = new THREE.Group();
    fitRoot.name = `${group.name}:fit-root`;
    tagPresentationObject(fitRoot, tags);
    const content = new THREE.Group();
    content.name = `${group.name}:content`;
    tagPresentationObject(content, tags);
    for (const primitive of prefab.primitives) content.add(this._createPrimitive(primitive, tags));

    const quarterTurns = ((Number(fixture.yawQuarterTurns ?? 0) % 4) + 4) % 4;
    content.rotation.y = quarterTurns * Math.PI / 2;
    const pipeRotation = pipeAxisRotation(fixture, bounds);
    if (pipeRotation?.x) content.rotation.x = pipeRotation.x;
    if (pipeRotation?.z) content.rotation.z = pipeRotation.z;
    fitRoot.add(content);
    group.add(fitRoot);
    group.updateMatrixWorld(true);

    const sourceBounds = new THREE.Box3().setFromObject(content);
    const sourceSize = sourceBounds.getSize(new THREE.Vector3());
    if ([sourceSize.x, sourceSize.y, sourceSize.z].some((extent) => !Number.isFinite(extent) || extent <= MIN_EXTENT)) {
      throw new Error(`Legacy-authored prefab ${prefab.id} has invalid visual bounds.`);
    }
    const sourceCenter = sourceBounds.getCenter(new THREE.Vector3());
    content.position.set(-sourceCenter.x, -sourceCenter.y, -sourceCenter.z);
    fitRoot.scale.set(
      bounds.size.x / sourceSize.x,
      bounds.size.y / sourceSize.y,
      bounds.size.z / sourceSize.z,
    );
    group.position.copy(bounds.center);
    group.updateMatrixWorld(true);

    const fittedBounds = new THREE.Box3().setFromObject(group);
    const fitError = Math.max(
      Math.abs(fittedBounds.min.x - bounds.min.x),
      Math.abs(fittedBounds.min.y - bounds.min.y),
      Math.abs(fittedBounds.min.z - bounds.min.z),
      Math.abs(fittedBounds.max.x - bounds.max.x),
      Math.abs(fittedBounds.max.y - bounds.max.y),
      Math.abs(fittedBounds.max.z - bounds.max.z),
    );
    if (!Number.isFinite(fitError) || fitError > FIT_TOLERANCE_METRES) {
      throw new Error(`Legacy-authored prefab ${prefab.id} missed fixture ${fixtureId} bounds by ${fitError.toFixed(4)}m.`);
    }
    group.userData.v2BoundsFitError = fitError;
    this._tileFittedFixtureGeometry(group);
    if (parent) parent.add(group);
    return group;
  }

  getDiagnostics() {
    return Object.freeze({
      disposed: this.disposed,
      textureCount: this.textures.size,
      materialCount: this.materials.size,
      geometryCount: this.geometries.size,
      browserTextures: this.loadBrowserTextures,
      presentationCollisionPolicy: PRESENTATION_COLLISION_POLICY,
    });
  }

  dispose() {
    if (this.disposed) return;
    for (const material of new Set(this.materials.values())) material.dispose();
    for (const texture of new Set(this.textures.values())) texture.dispose();
    for (const geometry of new Set(this.geometries.values())) geometry.dispose();
    for (const geometry of this.generatedGeometries) geometry.dispose();
    this.materials.clear();
    this.textures.clear();
    this.geometries.clear();
    this.generatedGeometries.clear();
    this.disposed = true;
  }
}

export function createLegacyAuthoredRuntimeKitV2(options) {
  return new LegacyAuthoredRuntimeKitV2(options);
}

export const LEGACY_AUTHORED_PRESENTATION_FIT_TOLERANCE_V2 = FIT_TOLERANCE_METRES;
export const LEGACY_AUTHORED_PRESENTATION_COLLISION_POLICY_V2 = PRESENTATION_COLLISION_POLICY;

export default LegacyAuthoredRuntimeKitV2;
