import * as THREE from 'three';
import { AssetResolver, createAssetResolver } from './AssetResolver.js';
import { asArray, cloneData, DisposableResourceSet, normalizeId } from './utils.js';

const TEXTURE_FIELDS = Object.freeze({
  map: { srgb: true },
  albedoMap: { target: 'map', srgb: true },
  baseColorMap: { target: 'map', srgb: true },
  normalMap: {},
  roughnessMap: {},
  metalnessMap: {},
  aoMap: {},
  emissiveMap: { srgb: true },
  alphaMap: {},
  bumpMap: {},
  displacementMap: {},
  lightMap: { srgb: true },
});

export const DEFAULT_PBR_MATERIALS = Object.freeze({
  default: { color: 0x777b80, roughness: 0.82, metalness: 0.08 },
  floor: { color: 0x4f555b, roughness: 0.88, metalness: 0.12 },
  wall: { color: 0x3d4247, roughness: 0.9, metalness: 0.1 },
  metal: { color: 0x5c6268, roughness: 0.48, metalness: 0.82 },
  trim: { color: 0x24292d, roughness: 0.58, metalness: 0.72 },
  accent: { color: 0x4fc9dc, emissive: 0x123c48, emissiveIntensity: 0.75, roughness: 0.4, metalness: 0.35 },
  hazard: { color: 0xd77825, emissive: 0x4b1704, emissiveIntensity: 0.5, roughness: 0.6, metalness: 0.25 },
  glass: { color: 0x8bc9d8, roughness: 0.16, metalness: 0, transparent: true, opacity: 0.35, transmission: 0.25 },
});

function readColor(value, fallback = 0xffffff) {
  if (value?.isColor) return value.clone();
  if (Array.isArray(value)) {
    const scale = value.some((component) => Number(component) > 1) ? 255 : 1;
    return new THREE.Color(
      (Number(value[0]) || 0) / scale,
      (Number(value[1]) || 0) / scale,
      (Number(value[2]) || 0) / scale,
    );
  }
  if (value && typeof value === 'object') {
    const components = [value.r, value.g, value.b].map(Number);
    const scale = components.some((component) => component > 1) ? 255 : 1;
    if (components.every(Number.isFinite)) {
      return new THREE.Color(components[0] / scale, components[1] / scale, components[2] / scale);
    }
  }
  try {
    return new THREE.Color(value ?? fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

function materialSide(value) {
  const side = String(value ?? 'front').toLowerCase();
  if (side === 'double' || side === 'doubleside' || side === 'both') return THREE.DoubleSide;
  if (side === 'back' || side === 'backside') return THREE.BackSide;
  return THREE.FrontSide;
}

function materialDefinitions(value) {
  if (Array.isArray(value)) {
    return value.map((definition, index) => ({
      id: normalizeId(definition?.id ?? definition?.name, `material-${index + 1}`),
      ...(definition ?? {}),
    }));
  }
  return Object.entries(value ?? {}).map(([id, definition]) => ({
    id,
    ...(definition && typeof definition === 'object' ? definition : { color: definition }),
  }));
}

async function resolveTextureFields(definition, assetResolver) {
  const result = {};
  for (const [field, settings] of Object.entries(TEXTURE_FIELDS)) {
    const spec = definition[field];
    if (spec == null) continue;
    const target = settings.target ?? field;
    result[target] = await assetResolver.loadTexture(spec, {
      srgb: settings.srgb,
      ...(typeof spec === 'object' ? spec : {}),
    });
  }
  return result;
}

export async function createPBRMaterial(definition = {}, {
  assetResolver = null,
  resources = null,
  name = null,
} = {}) {
  if (definition?.isMaterial) return definition;
  const resolver = assetResolver instanceof AssetResolver
    ? assetResolver
    : createAssetResolver(assetResolver ?? {});
  const textures = await resolveTextureFields(definition, resolver);
  const physical = definition.type === 'physical'
    || definition.transmission != null
    || definition.clearcoat != null
    || definition.ior != null
    || definition.thickness != null;
  const parameters = {
    name: normalizeId(name ?? definition.name ?? definition.id, 'authoredPbrMaterial'),
    color: readColor(definition.color ?? definition.baseColor, 0xffffff),
    emissive: readColor(definition.emissive, 0x000000),
    emissiveIntensity: Number(definition.emissiveIntensity ?? 0),
    roughness: Number(definition.roughness ?? 0.8),
    metalness: Number(definition.metalness ?? 0.05),
    opacity: Number(definition.opacity ?? 1),
    transparent: definition.transparent === true || Number(definition.opacity ?? 1) < 1,
    alphaTest: Number(definition.alphaTest ?? 0),
    side: materialSide(definition.side),
    flatShading: definition.flatShading === true,
    wireframe: definition.wireframe === true,
    depthWrite: definition.depthWrite !== false,
    depthTest: definition.depthTest !== false,
    ...textures,
  };
  if (definition.normalScale != null) {
    const normalScale = Array.isArray(definition.normalScale)
      ? definition.normalScale
      : [definition.normalScale.x ?? definition.normalScale, definition.normalScale.y ?? definition.normalScale];
    parameters.normalScale = new THREE.Vector2(Number(normalScale[0]) || 1, Number(normalScale[1]) || 1);
  }
  if (physical) {
    Object.assign(parameters, {
      clearcoat: Number(definition.clearcoat ?? 0),
      clearcoatRoughness: Number(definition.clearcoatRoughness ?? 0),
      transmission: Number(definition.transmission ?? 0),
      thickness: Number(definition.thickness ?? 0),
      ior: Number(definition.ior ?? 1.5),
      sheen: Number(definition.sheen ?? 0),
    });
  }
  const material = physical
    ? new THREE.MeshPhysicalMaterial(parameters)
    : new THREE.MeshStandardMaterial(parameters);
  material.userData = {
    ...material.userData,
    ...(cloneData(definition.userData) ?? {}),
    authoredMaterialId: definition.id ?? name ?? null,
    authoredPbr: true,
  };
  resources?.own?.(material);
  return material;
}

export class PBRMaterialLibrary {
  constructor({ materials = new Map(), resources = null, assetResolver = null, ownsResolver = false } = {}) {
    this.materials = materials instanceof Map ? materials : new Map(Object.entries(materials));
    this.resources = resources ?? new DisposableResourceSet();
    this.assetResolver = assetResolver;
    this.ownsResolver = ownsResolver;
    this.disposed = false;
  }

  has(id) {
    return this.materials.has(String(id));
  }

  get(id, fallback = 'default') {
    if (id?.isMaterial) return id;
    return this.materials.get(String(id ?? ''))
      ?? this.materials.get(String(fallback ?? ''))
      ?? this.materials.values().next().value
      ?? null;
  }

  resolve(id, fallback = 'default') {
    return this.get(id, fallback);
  }

  set(id, material, { owned = false } = {}) {
    this.materials.set(String(id), material);
    if (owned) this.resources.own(material);
    return this;
  }

  entries() {
    return this.materials.entries();
  }

  keys() {
    return this.materials.keys();
  }

  values() {
    return this.materials.values();
  }

  [Symbol.iterator]() {
    return this.materials[Symbol.iterator]();
  }

  toObject() {
    return Object.fromEntries(this.materials);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resources.dispose();
    if (this.ownsResolver) this.assetResolver?.dispose?.();
    this.materials.clear();
  }
}

export async function createPBRMaterialLibrary(definitions = {}, options = {}) {
  if (definitions instanceof PBRMaterialLibrary) return definitions;
  const suppliedResolver = options.assetResolver instanceof AssetResolver;
  const assetResolver = suppliedResolver
    ? options.assetResolver
    : createAssetResolver(options.assetResolver ?? options);
  const resources = options.resources ?? new DisposableResourceSet();
  const source = options.includeDefaults === false
    ? definitions
    : { ...DEFAULT_PBR_MATERIALS, ...(definitions ?? {}) };
  const materials = new Map();
  for (const definition of materialDefinitions(source)) {
    const material = await createPBRMaterial(definition, {
      assetResolver,
      resources,
      name: definition.id,
    });
    materials.set(definition.id, material);
  }
  return new PBRMaterialLibrary({
    materials,
    resources,
    assetResolver,
    ownsResolver: options.ownsResolver ?? !suppliedResolver,
  });
}

export const createMaterialLibrary = createPBRMaterialLibrary;
export const createAuthoredMaterialLibrary = createPBRMaterialLibrary;

export function mergeMaterialDefinitions(...sources) {
  const result = {};
  for (const source of sources) {
    for (const definition of materialDefinitions(source)) {
      result[definition.id] = { ...(result[definition.id] ?? {}), ...cloneData(definition) };
    }
  }
  return result;
}

export function listMaterialDefinitions(source) {
  return asArray(materialDefinitions(source)).map(cloneData);
}

