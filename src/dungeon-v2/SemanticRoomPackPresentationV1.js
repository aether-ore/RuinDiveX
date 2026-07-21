import {
  SEMANTIC_ROOM_PACK_V1_CATALOG,
  SEMANTIC_ROOM_PACK_V1_ID,
} from './SemanticRoomPackV1Catalog.js';

const PACK_ID = SEMANTIC_ROOM_PACK_V1_ID;
const PACK_ROOT_URL = `/${SEMANTIC_ROOM_PACK_V1_CATALOG.sourceRoot}`;
const QUARTER_TURN_RADIANS = Math.PI * 0.5;

export const SEMANTIC_ROOM_PACK_ID_V1 = PACK_ID;
export const SEMANTIC_ROOM_PACK_ROOT_URL_V1 = PACK_ROOT_URL;

export const SEMANTIC_ROOM_NODE_PREFIXES_V1 = Object.freeze([
  'SOCKET',
  'REGION',
  'WALK',
  'SHELL',
  'SUPPORT',
  'RAIL',
  'MECH',
  'FLUID',
  'HAZARD',
  'CONSOLE',
  'ANCHOR',
]);

const DYNAMIC_PREFIXES = new Set(['MECH', 'FLUID', 'HAZARD', 'CONSOLE']);
const MARKER_PREFIXES = new Set(['SOCKET', 'REGION', 'ANCHOR']);
// Shell and floor pieces remain separate so the camera-occlusion runtime can
// hide the exact obstruction. Supports and rails have no mutable presentation
// state and are the only classes that are safe to merge in this first pass.
const SAFE_STATIC_MERGE_PREFIXES = new Set(['SUPPORT', 'RAIL']);

// Compatibility aliases point at the single immutable catalog; this module
// never maintains its own room inventory, hashes, manifests, or node maps.
export const SEMANTIC_ROOM_PACK_CATALOG_V1 = SEMANTIC_ROOM_PACK_V1_CATALOG;

const ROOM_RECORDS = SEMANTIC_ROOM_PACK_V1_CATALOG.rooms;
const ROOM_BY_ID = new Map(ROOM_RECORDS.map((record) => [record.roomId, record]));

function deepFreezePlain(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreezePlain(child);
  return Object.freeze(value);
}

function clonePlain(value) {
  return value == null ? value : structuredClone(value);
}

function semanticPrefix(name = '') {
  const match = String(name).match(/^([A-Z]+)_/);
  return match && SEMANTIC_ROOM_NODE_PREFIXES_V1.includes(match[1]) ? match[1] : null;
}

function isSemanticName(value) {
  return typeof value === 'string' && semanticPrefix(value.replace(/\*+$/, '')) != null;
}

function asRequirement(value, key, path) {
  if (!isSemanticName(value)) return null;
  if (value.endsWith('*')) {
    return { kind: 'prefix', value: value.slice(0, -1), path };
  }
  if (/prefix$/i.test(key) || value.endsWith('_')) {
    return { kind: 'prefix', value, path };
  }
  return { kind: 'exact', value, path };
}

function collectManifestRequirements(manifest, stableSemanticIds = null) {
  const exact = new Map();
  const prefixes = new Map();
  const stable = new Map();
  const add = (requirement) => {
    if (!requirement) return;
    const target = requirement.kind === 'exact' ? exact : prefixes;
    const paths = target.get(requirement.value) ?? [];
    paths.push(requirement.path);
    target.set(requirement.value, paths);
  };
  const visit = (value, path = 'manifest', key = '') => {
    if (typeof value === 'string') {
      add(asRequirement(value, key, path));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [childKey, child] of Object.entries(value)) {
      visit(child, `${path}.${childKey}`, childKey);
    }
  };
  visit(manifest);

  for (const socket of manifest?.sockets ?? []) {
    if (!socket?.id || !socket?.nodeName) continue;
    stable.set(`socket:${socket.id}`, { kind: 'exact', value: socket.nodeName });
  }
  if (manifest?.controller?.id && manifest.controller.consoleNode) {
    stable.set(`controller:${manifest.controller.id}`, {
      kind: 'exact',
      value: manifest.controller.consoleNode,
    });
  }
  if (manifest?.fluidNetwork?.id && manifest.fluidNetwork.masterConsoleNode) {
    stable.set(`fluid-network:${manifest.fluidNetwork.id}:master-console`, {
      kind: 'exact',
      value: manifest.fluidNetwork.masterConsoleNode,
    });
  }
  for (const [category, definitions] of Object.entries(stableSemanticIds ?? {})) {
    const entries = Array.isArray(definitions)
      ? definitions.map((definition, index) => [null, definition, `${category}[${index}]`])
      : Object.entries(definitions ?? {}).map(([stableId, definition]) => [stableId, definition, `${category}.${stableId}`]);
    for (const [mappedStableId, definition, suffix] of entries) {
      let resolvedDefinition = definition;
      if (typeof definition === 'string' && !isSemanticName(definition)) {
        const socket = manifest?.sockets?.find(({ id }) => id === definition);
        if (socket) resolvedDefinition = { id: definition, nodeName: socket.nodeName };
      }
      const path = `binding.stableSemanticIds.${suffix}`;
      const requirement = typeof resolvedDefinition === 'string'
        ? asRequirement(resolvedDefinition, '', path)
        : resolvedDefinition?.nodeName
          ? { kind: 'exact', value: resolvedDefinition.nodeName, path }
          : resolvedDefinition?.nodePrefix
            ? { kind: 'prefix', value: resolvedDefinition.nodePrefix, path }
            : null;
      if (!requirement) continue;
      const stableId = mappedStableId
        ?? resolvedDefinition?.id
        ?? `${category}:${requirement.value}`;
      add(requirement);
      stable.set(stableId, { kind: requirement.kind, value: requirement.value });
    }
  }
  return { exact, prefixes, stable };
}

function addToNestedIndex(index, key, value, object) {
  const byValue = index.get(key) ?? new Map();
  const objects = byValue.get(value) ?? [];
  objects.push(object);
  byValue.set(value, objects);
  index.set(key, byValue);
}

export function indexSemanticRoomNodesV1(root) {
  if (!root?.traverse) throw new TypeError('A traversable THREE.Object3D root is required.');
  const nodesByName = new Map();
  const nodesByPrefix = new Map(SEMANTIC_ROOM_NODE_PREFIXES_V1.map((prefix) => [prefix, new Map()]));
  const extrasByKey = new Map();
  const nodesBySemanticExtra = new Map();

  root.traverse((object) => {
    const name = String(object.name ?? '');
    if (name) {
      const named = nodesByName.get(name) ?? [];
      named.push(object);
      nodesByName.set(name, named);
      const prefix = semanticPrefix(name);
      if (prefix) nodesByPrefix.get(prefix).set(name, object);
    }
    for (const [key, rawValue] of Object.entries(object.userData ?? {})) {
      const value = typeof rawValue === 'object'
        ? JSON.stringify(rawValue)
        : String(rawValue);
      addToNestedIndex(extrasByKey, key, value, object);
    }
    const semantic = object.userData?.semantic;
    if (typeof semantic === 'string') {
      const semanticNodes = nodesBySemanticExtra.get(semantic) ?? new Map();
      if (name) semanticNodes.set(name, object);
      nodesBySemanticExtra.set(semantic, semanticNodes);
    }
  });

  const nodesByUniqueName = new Map();
  for (const [name, objects] of nodesByName) {
    if (objects.length === 1) nodesByUniqueName.set(name, objects[0]);
  }
  return {
    nodesByName,
    nodesByUniqueName,
    nodesByPrefix,
    extrasByKey,
    nodesBySemanticExtra,
  };
}

function restoreManifestSemanticNodeNamesV1(root, manifest, stableSemanticIds, three) {
  const sanitizeNodeName = three?.PropertyBinding?.sanitizeNodeName;
  if (typeof sanitizeNodeName !== 'function') {
    return deepFreezePlain({ restored: [], ambiguous: [] });
  }

  const requirements = collectManifestRequirements(manifest, stableSemanticIds);
  const initialIndex = indexSemanticRoomNodesV1(root);
  const restored = [];
  const ambiguous = [];

  for (const rawName of requirements.exact.keys()) {
    if ((initialIndex.nodesByName.get(rawName) ?? []).length > 0) continue;
    const sanitizedName = sanitizeNodeName(rawName);
    if (!sanitizedName || sanitizedName === rawName) continue;
    const candidates = initialIndex.nodesByName.get(sanitizedName) ?? [];
    if (candidates.length === 1) {
      candidates[0].name = rawName;
      restored.push({ rawName, sanitizedName });
    } else if (candidates.length > 1) {
      ambiguous.push({ rawName, sanitizedName, count: candidates.length });
    }
  }

  restored.sort((left, right) => left.rawName.localeCompare(right.rawName));
  ambiguous.sort((left, right) => left.rawName.localeCompare(right.rawName));
  return deepFreezePlain({ restored, ambiguous });
}

function validateManifestIdentity(manifest, room, diagnostics) {
  const contractErrors = diagnostics.manifestContractErrors;
  if (!manifest || typeof manifest !== 'object') {
    contractErrors.push('manifest-not-object');
    return;
  }
  if (manifest.roomId !== room.roomId) contractErrors.push('room-id-mismatch');
  if (manifest.units !== 'meters') contractErrors.push('authored-units-not-meters');
  if (manifest.upAxis !== 'Y') contractErrors.push('authored-up-axis-not-y');
  if (!/do not recenter/i.test(String(manifest.originPolicy ?? ''))) {
    contractErrors.push('aggregate-bounds-origin-policy-not-forbidden');
  }
  if (!/do not derive/i.test(String(manifest.collisionPolicy ?? ''))) {
    contractErrors.push('mesh-bounds-collision-policy-not-forbidden');
  }
}

export function validateSemanticRoomTemplateV1({
  room,
  manifest,
  nodeIndex,
  stableSemanticIds = null,
} = {}) {
  if (!room?.roomId) throw new TypeError('A resolved room record is required.');
  if (!nodeIndex?.nodesByName) throw new TypeError('A semantic node index is required.');
  const requirements = collectManifestRequirements(manifest, stableSemanticIds);
  const diagnostics = {
    schemaVersion: 'semantic-room-pack-presentation-validation/1',
    packId: room.packId ?? PACK_ID,
    roomId: room.roomId,
    accepted: false,
    manifestContractErrors: [],
    missingNodes: [],
    duplicateNodes: [],
    missingPrefixes: [],
    requiredExactNodeCount: requirements.exact.size,
    requiredPrefixCount: requirements.prefixes.size,
    resolvedStableSemanticIds: [],
    unreferencedSemanticNodes: [],
    collisionAuthority: 'manifest-and-accepted-plan-data-only',
    collisionDerivedFromMeshBounds: false,
  };
  validateManifestIdentity(manifest, room, diagnostics);

  for (const [nodeName, manifestPaths] of requirements.exact) {
    const objects = nodeIndex.nodesByName.get(nodeName) ?? [];
    if (objects.length === 0) diagnostics.missingNodes.push({ nodeName, manifestPaths: [...manifestPaths] });
    if (objects.length > 1) diagnostics.duplicateNodes.push({ nodeName, count: objects.length, manifestPaths: [...manifestPaths] });
  }
  for (const [prefix, manifestPaths] of requirements.prefixes) {
    const matches = [...nodeIndex.nodesByName.keys()].filter((name) => name.startsWith(prefix));
    if (matches.length === 0) diagnostics.missingPrefixes.push({ prefix, manifestPaths: [...manifestPaths] });
  }
  for (const [stableId, requirement] of requirements.stable) {
    const resolved = requirement.kind === 'exact'
      ? (nodeIndex.nodesByName.get(requirement.value)?.length === 1)
      : [...nodeIndex.nodesByName.keys()].some((name) => name.startsWith(requirement.value));
    if (resolved) diagnostics.resolvedStableSemanticIds.push(stableId);
  }

  const referencedNames = new Set(requirements.exact.keys());
  const referencedPrefixes = [...requirements.prefixes.keys()];
  for (const name of nodeIndex.nodesByName.keys()) {
    if (!semanticPrefix(name)) continue;
    if (!referencedNames.has(name) && !referencedPrefixes.some((prefix) => name.startsWith(prefix))) {
      diagnostics.unreferencedSemanticNodes.push(name);
    }
  }
  diagnostics.manifestContractErrors.sort();
  diagnostics.missingNodes.sort((left, right) => left.nodeName.localeCompare(right.nodeName));
  diagnostics.duplicateNodes.sort((left, right) => left.nodeName.localeCompare(right.nodeName));
  diagnostics.missingPrefixes.sort((left, right) => left.prefix.localeCompare(right.prefix));
  diagnostics.resolvedStableSemanticIds.sort();
  diagnostics.unreferencedSemanticNodes.sort();
  diagnostics.accepted = diagnostics.manifestContractErrors.length === 0
    && diagnostics.missingNodes.length === 0
    && diagnostics.duplicateNodes.length === 0
    && diagnostics.missingPrefixes.length === 0;
  return deepFreezePlain(diagnostics);
}

function serializeTransform(object) {
  return deepFreezePlain({
    position: {
      x: Number(object?.position?.x ?? 0),
      y: Number(object?.position?.y ?? 0),
      z: Number(object?.position?.z ?? 0),
    },
    quaternion: {
      x: Number(object?.quaternion?.x ?? 0),
      y: Number(object?.quaternion?.y ?? 0),
      z: Number(object?.quaternion?.z ?? 0),
      w: Number(object?.quaternion?.w ?? 1),
    },
    scale: {
      x: Number(object?.scale?.x ?? 1),
      y: Number(object?.scale?.y ?? 1),
      z: Number(object?.scale?.z ?? 1),
    },
  });
}

function normalizeTranslation(value = {}) {
  const source = Array.isArray(value)
    ? { x: value[0], y: value[1], z: value[2] }
    : value;
  const translation = {
    x: Number(source?.x ?? 0),
    y: Number(source?.y ?? 0),
    z: Number(source?.z ?? 0),
  };
  if (!Object.values(translation).every(Number.isFinite)) {
    throw new TypeError('Semantic room placement translation must be finite.');
  }
  return translation;
}

function assertAuthoredUnitScale(scale) {
  if (scale == null) return;
  const values = typeof scale === 'number'
    ? [scale, scale, scale]
    : Array.isArray(scale)
      ? scale
      : [scale.x, scale.y, scale.z];
  if (values.length < 3 || values.some((value) => Math.abs(Number(value) - 1) > 1e-9)) {
    throw new RangeError('Semantic room pack GLBs must retain authored unit scale.');
  }
}

function assertAuthoredRootPolicy(binding) {
  const authored = binding?.authoredRootTransform;
  if (!authored) return;
  if (authored.recenter !== false) {
    throw new RangeError('Semantic room presentation bindings must explicitly forbid root recentering.');
  }
  const origin = authored.origin ?? { x: 0, y: 0, z: 0 };
  if ([origin.x, origin.y, origin.z].some((value) => Math.abs(Number(value)) > 1e-9)
    || Math.abs(Number(authored.entryTierY ?? 0)) > 1e-9) {
    throw new RangeError('Semantic room presentation bindings must preserve the authored entry-tier origin.');
  }
}

function normalizePlacement(binding, placement) {
  const transform = placement
    ?? binding?.placementTransform
    ?? binding?.worldTransform
    ?? binding?.transform
    ?? {};
  assertAuthoredUnitScale(binding?.authoredScale);
  assertAuthoredUnitScale(binding?.authoredRootTransform?.scale);
  assertAuthoredRootPolicy(binding);
  assertAuthoredUnitScale(transform.scale);
  const translation = normalizeTranslation(transform.translation ?? transform.position);
  const yawQuarterTurns = Number(transform.yawQuarterTurns ?? 0);
  if (!Number.isInteger(yawQuarterTurns)) {
    throw new TypeError('Semantic room placement yawQuarterTurns must be an integer.');
  }
  return deepFreezePlain({
    translation,
    yawQuarterTurns: ((yawQuarterTurns % 4) + 4) % 4,
    authoredScale: 1,
    placementId: binding?.placementId ?? transform.placementId ?? null,
  });
}

function resolveRoom(bindingOrRoomId) {
  const binding = typeof bindingOrRoomId === 'string'
    ? { roomId: bindingOrRoomId }
    : bindingOrRoomId;
  if (!binding?.roomId) throw new TypeError('A semantic roomId or presentation binding is required.');
  const catalogRoom = ROOM_BY_ID.get(binding.roomId);
  if (!catalogRoom && (!binding.assetPath || !binding.manifestPath) && !binding.manifest) {
    throw new RangeError(`Unknown semantic room pack room: ${binding.roomId}`);
  }
  if (binding.packId && binding.packId !== PACK_ID) {
    throw new RangeError(`Unsupported semantic room pack: ${binding.packId}`);
  }
  if (catalogRoom && typeof bindingOrRoomId !== 'string') {
    const integrity = catalogRoom.sourceIntegrity;
    const mismatches = [];
    const normalizePath = (value) => String(value ?? '').replace(/^\//, '');
    if (binding.assetPath && normalizePath(binding.assetPath) !== normalizePath(catalogRoom.assetPath)) mismatches.push('assetPath');
    if (binding.manifestPath && normalizePath(binding.manifestPath) !== normalizePath(catalogRoom.manifestPath)) mismatches.push('manifestPath');
    if (binding.manifestRevision != null && binding.manifestRevision !== catalogRoom.revision) mismatches.push('manifestRevision');
    if (binding.assetSha256 && binding.assetSha256 !== integrity.assetSha256) mismatches.push('assetSha256');
    if (binding.manifestContractHash && binding.manifestContractHash !== integrity.manifestContractHash) mismatches.push('manifestContractHash');
    if (binding.originPolicy && binding.originPolicy !== catalogRoom.authoredCoordinateSystem.originPolicy) mismatches.push('originPolicy');
    if (mismatches.length) {
      throw new SemanticRoomPackBindingErrorV1(binding.roomId, {
        code: 'semantic-room-pack-binding-integrity-mismatch',
        mismatches: mismatches.sort(),
      });
    }
  }
  const catalogSemanticIds = catalogRoom?.semanticNodeNames?.map((nodeName) => ({
    id: `catalog:${nodeName}`,
    nodeName,
  })) ?? [];
  const stableSemanticIds = {
    catalog: catalogSemanticIds,
    ...(binding.stableSemanticIds ?? {}),
  };
  return {
    packId: PACK_ID,
    ...catalogRoom,
    roomId: binding.roomId,
    assetPath: binding.assetPath ?? catalogRoom?.assetPath,
    manifestPath: binding.manifestPath ?? catalogRoom?.manifestPath,
    manifestRevision: binding.manifestRevision ?? catalogRoom?.revision ?? null,
    manifestHash: binding.manifestHash
      ?? binding.manifestContractHash
      ?? catalogRoom?.sourceIntegrity?.manifestContractHash
      ?? null,
    assetSha256: binding.assetSha256 ?? catalogRoom?.sourceIntegrity?.assetSha256 ?? null,
    stableSemanticIds: clonePlain(stableSemanticIds),
    manifest: binding.manifest ?? catalogRoom?.sourceManifest ?? null,
    binding,
  };
}

function materialKey(material, materialIds) {
  if (!materialIds.has(material)) materialIds.set(material, materialIds.size + 1);
  return materialIds.get(material);
}

function geometryLayoutKey(geometry) {
  return Object.entries(geometry.attributes ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, attribute]) => `${name}:${attribute.itemSize}:${attribute.normalized ? 1 : 0}`)
    .join('|');
}

function dynamicKindsForNode(object) {
  const prefix = semanticPrefix(object.name);
  const semantic = String(object.userData?.semantic ?? '').toLowerCase();
  const kinds = [];
  if (prefix === 'MECH' || semantic.includes('mechanism') || semantic === 'movingsurface') kinds.push('mechanisms');
  if (prefix === 'FLUID' || semantic === 'fluidsurface') kinds.push('fluids');
  if (prefix === 'HAZARD' || semantic === 'hazardsurface') kinds.push('hazards');
  if (prefix === 'CONSOLE' || semantic === 'console') kinds.push('consoles');
  return kinds;
}

function mergeSafeStaticMeshes(scene, { three, mergeGeometries }) {
  const diagnostics = {
    enabled: typeof mergeGeometries === 'function',
    sourceMeshCount: 0,
    mergedSourceMeshCount: 0,
    mergedMeshCount: 0,
    retainedStaticMeshCount: 0,
    dynamicMeshCount: 0,
    semanticClasses: [],
  };
  if (typeof mergeGeometries !== 'function') return diagnostics;
  scene.updateWorldMatrix?.(true, true);
  const inverseRoot = new three.Matrix4().copy(scene.matrixWorld).invert();
  const materialIds = new Map();
  const groups = new Map();

  scene.traverse((object) => {
    if (!object?.isMesh || !object.geometry) return;
    diagnostics.sourceMeshCount += 1;
    if (dynamicKindsForNode(object).length) {
      diagnostics.dynamicMeshCount += 1;
      return;
    }
    const prefix = semanticPrefix(object.name);
    const material = Array.isArray(object.material) ? null : object.material;
    const safe = SAFE_STATIC_MERGE_PREFIXES.has(prefix)
      && object.children.length === 0
      && !object.isSkinnedMesh
      && !object.geometry.morphAttributes?.position?.length
      && material;
    if (!safe) {
      diagnostics.retainedStaticMeshCount += 1;
      return;
    }
    let geometry = object.geometry.clone();
    geometry.applyMatrix4(new three.Matrix4().multiplyMatrices(inverseRoot, object.matrixWorld));
    if (geometry.index) geometry = geometry.toNonIndexed();
    geometry.morphAttributes = {};
    const key = `${prefix}|${materialKey(material, materialIds)}|${geometryLayoutKey(geometry)}`;
    const group = groups.get(key) ?? { prefix, material, entries: [] };
    group.entries.push({ object, geometry });
    groups.set(key, group);
  });

  const mergedRoot = new three.Group();
  mergedRoot.name = 'STATIC_MERGED_SEMANTIC_VISUALS';
  mergedRoot.userData.semantic = 'staticMergedPresentation';
  mergedRoot.userData.collisionDerivedFromMeshBounds = false;
  const mergedClasses = new Set();
  let slice = 0;
  for (const { prefix, material, entries } of groups.values()) {
    if (entries.length < 2) {
      entries.forEach(({ geometry }) => geometry.dispose?.());
      diagnostics.retainedStaticMeshCount += entries.length;
      continue;
    }
    const merged = mergeGeometries(entries.map(({ geometry }) => geometry), false);
    entries.forEach(({ geometry }) => geometry.dispose?.());
    if (!merged) {
      diagnostics.retainedStaticMeshCount += entries.length;
      continue;
    }
    const mesh = new three.Mesh(merged, material);
    mesh.name = `STATIC_MERGED_${prefix}_${slice}`;
    mesh.castShadow = entries.some(({ object }) => object.castShadow);
    mesh.receiveShadow = entries.some(({ object }) => object.receiveShadow);
    mesh.userData.semantic = `staticMerged:${prefix.toLowerCase()}`;
    mesh.userData.sourceNodeNames = entries.map(({ object }) => object.name).sort();
    mesh.userData.collisionDerivedFromMeshBounds = false;
    mergedRoot.add(mesh);
    for (const { object } of entries) {
      object.visible = false;
      object.userData.semanticVisualMergedInto = mesh.name;
    }
    diagnostics.mergedSourceMeshCount += entries.length;
    diagnostics.mergedMeshCount += 1;
    mergedClasses.add(prefix);
    slice += 1;
  }
  if (mergedRoot.children.length) scene.add(mergedRoot);
  diagnostics.semanticClasses = [...mergedClasses].sort();
  return diagnostics;
}

function cloneSceneSafely(templateRoot, modules) {
  const root = typeof modules.cloneObjectGraph === 'function'
    ? modules.cloneObjectGraph(templateRoot)
    : templateRoot.clone(true);
  root.traverse((object) => {
    if (!object?.isMesh || !object.material) return;
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => material?.clone?.() ?? material)
      : object.material.clone?.() ?? object.material;
  });
  return root;
}

function mapSingletonNodes(nodesByName, predicate) {
  const result = new Map();
  for (const [name, objects] of nodesByName) {
    if (objects.length === 1 && predicate(objects[0], name)) result.set(name, objects[0]);
  }
  return result;
}

function buildInstanceBindings(index, requirements) {
  const stableSemanticIds = new Map();
  for (const [stableId, requirement] of requirements.stable) {
    if (requirement.kind === 'exact') {
      const objects = index.nodesByName.get(requirement.value) ?? [];
      if (objects.length === 1) stableSemanticIds.set(stableId, objects[0]);
    } else {
      stableSemanticIds.set(stableId, [...index.nodesByName]
        .filter(([name]) => name.startsWith(requirement.value))
        .flatMap(([, objects]) => objects));
    }
  }
  const dynamicNodes = {
    mechanisms: mapSingletonNodes(index.nodesByName, (node) => dynamicKindsForNode(node).includes('mechanisms')),
    fluids: mapSingletonNodes(index.nodesByName, (node) => dynamicKindsForNode(node).includes('fluids')),
    hazards: mapSingletonNodes(index.nodesByName, (node) => dynamicKindsForNode(node).includes('hazards')),
    consoles: mapSingletonNodes(index.nodesByName, (node) => dynamicKindsForNode(node).includes('consoles')),
  };
  const staticVisualGroups = new Map();
  const markerNodes = {
    sockets: new Map(),
    regions: new Map(),
    anchors: new Map(),
  };
  for (const [name, objects] of index.nodesByName) {
    if (objects.length !== 1) continue;
    const node = objects[0];
    const prefix = semanticPrefix(name);
    if (prefix === 'SOCKET') markerNodes.sockets.set(name, node);
    if (prefix === 'REGION') markerNodes.regions.set(name, node);
    if (prefix === 'ANCHOR') markerNodes.anchors.set(name, node);
    if (!node.isMesh || dynamicKindsForNode(node).length || MARKER_PREFIXES.has(prefix)) continue;
    const semanticClass = String(node.userData?.semantic ?? prefix ?? 'presentation');
    const group = staticVisualGroups.get(semanticClass) ?? [];
    group.push(node);
    staticVisualGroups.set(semanticClass, group);
  }
  return { stableSemanticIds, dynamicNodes, staticVisualGroups, markerNodes };
}

async function loadDefaultRuntimeModules() {
  const [three, gltf, geometryUtils, skeletonUtils] = await Promise.all([
    import('three'),
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/utils/BufferGeometryUtils.js'),
    import('three/addons/utils/SkeletonUtils.js'),
  ]);
  return {
    three,
    GLTFLoader: gltf.GLTFLoader,
    mergeGeometries: geometryUtils.mergeGeometries,
    cloneObjectGraph: skeletonUtils.clone,
  };
}

async function defaultManifestLoader(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load semantic room manifest ${url}: HTTP ${response.status}.`);
  return response.json();
}

export class SemanticRoomPackPresentationRuntimeV1 {
  constructor({
    runtimeModules = null,
    loader = null,
    loadingManager = undefined,
    manifestLoader = defaultManifestLoader,
    mergeStaticVisuals = true,
  } = {}) {
    this.runtimeModules = runtimeModules;
    this.loader = loader;
    this.loadingManager = loadingManager;
    this.manifestLoader = manifestLoader;
    this.mergeStaticVisuals = mergeStaticVisuals;
    this.templatePromises = new Map();
    this.templates = new Map();
    this.failures = new Map();
    this.manifestIdentityIds = new WeakMap();
    this.nextManifestIdentityId = 1;
    this.stats = { requests: 0, hits: 0, misses: 0, loads: 0 };
    this.modulesPromise = null;
  }

  async getRuntimeModules() {
    if (!this.modulesPromise) {
      this.modulesPromise = Promise.resolve(
        typeof this.runtimeModules === 'function'
          ? this.runtimeModules()
          : this.runtimeModules ?? loadDefaultRuntimeModules(),
      );
    }
    const modules = await this.modulesPromise;
    if (!modules?.three?.Group || !modules?.three?.Matrix4 || !modules?.GLTFLoader && !this.loader) {
      throw new TypeError('Semantic room runtime modules must provide THREE and a GLTFLoader or loader instance.');
    }
    return modules;
  }

  cacheKey(room) {
    let suppliedManifestKey = '';
    if (room.manifest && typeof room.manifest === 'object') {
      if (!this.manifestIdentityIds.has(room.manifest)) {
        this.manifestIdentityIds.set(room.manifest, this.nextManifestIdentityId);
        this.nextManifestIdentityId += 1;
      }
      suppliedManifestKey = `|manifest-object:${this.manifestIdentityIds.get(room.manifest)}`;
    }
    return [room.packId, room.roomId, room.assetPath, room.manifestPath, room.manifestHash ?? '', room.assetSha256 ?? '', room.manifestRevision ?? ''].join('|')
      + suppliedManifestKey;
  }

  async loadTemplate(bindingOrRoomId, { onProgress = undefined } = {}) {
    const room = resolveRoom(bindingOrRoomId);
    const key = this.cacheKey(room);
    this.stats.requests += 1;
    if (this.templatePromises.has(key)) {
      this.stats.hits += 1;
      return this.templatePromises.get(key);
    }
    this.stats.misses += 1;
    const promise = this.loadTemplateUncached(room, { onProgress });
    this.templatePromises.set(key, promise);
    try {
      const template = await promise;
      this.templates.set(key, template);
      this.failures.delete(key);
      return template;
    } catch (error) {
      this.templatePromises.delete(key);
      this.templates.delete(key);
      this.failures.set(key, error);
      throw error;
    }
  }

  async loadTemplateUncached(room, { onProgress }) {
    const modules = await this.getRuntimeModules();
    const manifest = room.manifest ?? await this.manifestLoader(room.manifestPath, {
      packId: room.packId,
      roomId: room.roomId,
    });
    const activeLoader = this.loader ?? new modules.GLTFLoader(this.loadingManager);
    const gltf = await activeLoader.loadAsync(room.assetPath, onProgress);
    const templateRoot = gltf?.scene;
    if (!templateRoot?.traverse) {
      throw new Error(`Semantic room GLB ${room.assetPath} did not contain a scene.`);
    }
    this.stats.loads += 1;
    templateRoot.updateWorldMatrix?.(true, true);
    const authoredRootTransform = serializeTransform(templateRoot);
    // GLTFLoader sanitizes periods and several other PropertyBinding-reserved
    // characters in Object3D names. The authored manifests intentionally use
    // decimal coordinates in semantic node names, so restore those exact names
    // before indexing. Placement and collision remain manifest-authoritative;
    // this only reverses loader name mangling on a unique matching node.
    const nameRestoration = restoreManifestSemanticNodeNamesV1(
      templateRoot,
      manifest,
      room.stableSemanticIds,
      modules.three,
    );
    const initialIndex = indexSemanticRoomNodesV1(templateRoot);
    const validation = validateSemanticRoomTemplateV1({
      room,
      manifest,
      nodeIndex: initialIndex,
      stableSemanticIds: room.stableSemanticIds,
    });
    if (!validation.accepted) {
      throw new SemanticRoomPackValidationErrorV1(room.roomId, validation);
    }
    const staticMerge = this.mergeStaticVisuals
      ? mergeSafeStaticMeshes(templateRoot, modules)
      : {
          enabled: false,
          sourceMeshCount: 0,
          mergedSourceMeshCount: 0,
          mergedMeshCount: 0,
          retainedStaticMeshCount: 0,
          dynamicMeshCount: 0,
          semanticClasses: [],
        };
    templateRoot.userData.semanticRoomPackId = room.packId;
    templateRoot.userData.semanticRoomId = room.roomId;
    templateRoot.userData.authoredScalePreserved = true;
    templateRoot.userData.aggregateBoundsNormalizationApplied = false;
    templateRoot.userData.collisionDerivedFromMeshBounds = false;
    const requirements = collectManifestRequirements(manifest, room.stableSemanticIds);
    return Object.freeze({
      schemaVersion: 'semantic-room-pack-presentation-template/1',
      packId: room.packId,
      roomId: room.roomId,
      assetPath: room.assetPath,
      manifestPath: room.manifestPath,
      manifestRevision: room.manifestRevision ?? manifest.schemaVersion ?? null,
      manifestHash: room.manifestHash ?? null,
      assetSha256: room.assetSha256 ?? room.sha256 ?? null,
      manifest: deepFreezePlain(clonePlain(manifest)),
      authoredRootTransform,
      authoredScale: 1,
      templateRoot,
      requirements,
      validation,
      nameRestoration,
      staticMerge: deepFreezePlain(clonePlain(staticMerge)),
      collisionDerivedFromMeshBounds: false,
      manifestCollisionVolumes: deepFreezePlain(clonePlain(manifest.collisionVolumes ?? [])),
      modules,
    });
  }

  async instantiate(bindingOrRoomId, { placement = null, onProgress = undefined } = {}) {
    const template = await this.loadTemplate(bindingOrRoomId, { onProgress });
    return this.instantiateFromTemplate(template, bindingOrRoomId, { placement });
  }

  instantiateFromTemplate(template, bindingOrRoomId, { placement = null } = {}) {
    const binding = typeof bindingOrRoomId === 'string' ? { roomId: bindingOrRoomId } : bindingOrRoomId;
    const appliedPlacement = normalizePlacement(binding, placement);
    const authoredRoot = cloneSceneSafely(template.templateRoot, template.modules);
    const group = new template.modules.three.Group();
    group.name = `semanticRoomPack:${template.roomId}:${appliedPlacement.placementId ?? 'instance'}`;
    group.position.set(
      appliedPlacement.translation.x,
      appliedPlacement.translation.y,
      appliedPlacement.translation.z,
    );
    group.rotation.set(0, appliedPlacement.yawQuarterTurns * QUARTER_TURN_RADIANS, 0);
    group.scale.set(1, 1, 1);
    group.userData.semanticRoomPackId = template.packId;
    group.userData.semanticRoomId = template.roomId;
    group.userData.placementId = appliedPlacement.placementId;
    group.userData.authoredScalePreserved = true;
    group.userData.aggregateBoundsNormalizationApplied = false;
    group.userData.collisionDerivedFromMeshBounds = false;
    group.userData.collisionAuthority = 'manifest-and-accepted-plan-data-only';
    group.add(authoredRoot);
    group.updateWorldMatrix?.(true, true);

    const semanticIndex = indexSemanticRoomNodesV1(authoredRoot);
    const bindings = buildInstanceBindings(semanticIndex, template.requirements);
    const mergedStaticVisualGroup = authoredRoot.getObjectByName?.('STATIC_MERGED_SEMANTIC_VISUALS') ?? null;
    return {
      schemaVersion: 'semantic-room-pack-presentation-instance/1',
      packId: template.packId,
      roomId: template.roomId,
      manifestRevision: template.manifestRevision,
      manifestHash: template.manifestHash,
      assetSha256: template.assetSha256,
      group,
      authoredRoot,
      authoredRootTransform: template.authoredRootTransform,
      appliedPlacement,
      semanticIndex,
      stableSemanticIds: bindings.stableSemanticIds,
      staticVisualGroups: bindings.staticVisualGroups,
      mergedStaticVisualGroup,
      dynamicNodes: bindings.dynamicNodes,
      markerNodes: bindings.markerNodes,
      manifest: template.manifest,
      validation: template.validation,
      staticMerge: template.staticMerge,
      collisionDerivedFromMeshBounds: false,
      manifestCollisionVolumes: template.manifestCollisionVolumes,
      getNodeByName(name) {
        return semanticIndex.nodesByUniqueName.get(name) ?? null;
      },
      getStableSemanticNode(stableId) {
        return bindings.stableSemanticIds.get(stableId) ?? null;
      },
    };
  }

  getTemplateSync(bindingOrRoomId) {
    const room = resolveRoom(bindingOrRoomId);
    const key = this.cacheKey(room);
    const template = this.templates.get(key);
    if (template) return template;
    const failure = this.failures.get(key);
    throw new SemanticRoomPackTemplateNotReadyErrorV1(room.roomId, {
      cacheKey: key,
      preloadFailed: Boolean(failure),
      preloadFailure: failure?.message ?? null,
    });
  }

  instantiateSync(bindingOrRoomId, options = {}) {
    const template = this.getTemplateSync(bindingOrRoomId);
    return this.instantiateFromTemplate(template, bindingOrRoomId, options);
  }

  async preload(bindingsOrRoomIds = ROOM_RECORDS.map(({ roomId }) => roomId), options = {}) {
    const entries = Array.isArray(bindingsOrRoomIds) ? bindingsOrRoomIds : [bindingsOrRoomIds];
    const templates = await Promise.all(entries.map((entry) => this.loadTemplate(entry, options)));
    return deepFreezePlain({
      schemaVersion: 'semantic-room-pack-preload/1',
      accepted: true,
      packId: PACK_ID,
      roomIds: templates.map(({ roomId }) => roomId).sort(),
      templateCount: templates.length,
    });
  }

  isReady(bindingOrRoomId = null) {
    if (bindingOrRoomId != null) {
      const room = resolveRoom(bindingOrRoomId);
      return this.templates.has(this.cacheKey(room));
    }
    return this.templatePromises.size > 0
      && this.templates.size === this.templatePromises.size
      && this.failures.size === 0;
  }

  clearCache() {
    this.templatePromises.clear();
    this.templates.clear();
    this.failures.clear();
  }

  getCacheDiagnostics() {
    return deepFreezePlain({
      ...this.stats,
      entryCount: this.templatePromises.size,
      readyCount: this.templates.size,
      failureCount: this.failures.size,
    });
  }
}

export class SemanticRoomPackValidationErrorV1 extends Error {
  constructor(roomId, diagnostics) {
    const missing = diagnostics.missingNodes.map(({ nodeName }) => nodeName);
    const missingPrefixes = diagnostics.missingPrefixes.map(({ prefix }) => `${prefix}*`);
    const duplicates = diagnostics.duplicateNodes.map(({ nodeName }) => nodeName);
    const details = [...diagnostics.manifestContractErrors, ...missing, ...missingPrefixes, ...duplicates];
    super(`Semantic room ${roomId} failed manifest validation${details.length ? `: ${details.join(', ')}` : '.'}`);
    this.name = 'SemanticRoomPackValidationErrorV1';
    this.roomId = roomId;
    this.diagnostics = diagnostics;
  }
}

export class SemanticRoomPackTemplateNotReadyErrorV1 extends Error {
  constructor(roomId, diagnostics) {
    super(`Semantic room ${roomId} has no preloaded authored GLB template; live V2 assembly cannot continue.`);
    this.name = 'SemanticRoomPackTemplateNotReadyErrorV1';
    this.roomId = roomId;
    this.code = 'semantic-room-pack-template-not-ready';
    this.diagnostics = deepFreezePlain(clonePlain(diagnostics));
  }
}

export class SemanticRoomPackBindingErrorV1 extends Error {
  constructor(roomId, diagnostics) {
    super(`Semantic room ${roomId} presentation binding does not match the immutable room-pack catalog.`);
    this.name = 'SemanticRoomPackBindingErrorV1';
    this.roomId = roomId;
    this.code = diagnostics?.code ?? 'semantic-room-pack-binding-invalid';
    this.diagnostics = deepFreezePlain(clonePlain(diagnostics));
  }
}

export function createSemanticRoomPackPresentationRuntimeV1(options = {}) {
  return new SemanticRoomPackPresentationRuntimeV1(options);
}

let defaultRuntime = null;

function getDefaultRuntime() {
  if (!defaultRuntime) defaultRuntime = createSemanticRoomPackPresentationRuntimeV1();
  return defaultRuntime;
}

export function loadSemanticRoomTemplateV1(bindingOrRoomId, options = {}) {
  return getDefaultRuntime().loadTemplate(bindingOrRoomId, options);
}

export function instantiateSemanticRoomPresentationV1(bindingOrRoomId, options = {}) {
  return getDefaultRuntime().instantiate(bindingOrRoomId, options);
}

export function preloadSemanticRoomPackV1(bindingsOrRoomIds, options = {}) {
  return getDefaultRuntime().preload(bindingsOrRoomIds, options);
}

export function isSemanticRoomPackPresentationReadyV1(bindingOrRoomId = null) {
  return getDefaultRuntime().isReady(bindingOrRoomId);
}

export function getCachedSemanticRoomTemplateV1(bindingOrRoomId) {
  return getDefaultRuntime().getTemplateSync(bindingOrRoomId);
}

export function instantiateCachedSemanticRoomPresentationV1(bindingOrRoomId, options = {}) {
  return getDefaultRuntime().instantiateSync(bindingOrRoomId, options);
}

export default createSemanticRoomPackPresentationRuntimeV1;
