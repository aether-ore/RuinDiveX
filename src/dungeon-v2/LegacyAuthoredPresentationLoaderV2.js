import { LEGACY_AUTHORED_ASSET_CATALOG_V2 } from './LegacyAuthoredModuleKitV2.js';

// Browser-only work is deliberately deferred until this function is called.
// Importing the authored module catalog in Node therefore never constructs or
// requires a THREE object. Mesh names are used only to filter presentation;
// collision always comes from the accepted plan's fixture/surface bounds.

function findRoomAsset(assetId) {
  const asset = Object.values(LEGACY_AUTHORED_ASSET_CATALOG_V2.rooms)
    .find((candidate) => candidate.id === assetId);
  if (!asset) throw new RangeError(`Unknown legacy-authored presentation asset: ${assetId}`);
  return asset;
}

function isLegacyShellPresentationNode(name = '') {
  const normalized = name.toLowerCase();
  if (
    normalized.includes('data_screen')
    || normalized.includes('puzzle_monitor')
    || normalized.includes('monitor')
    || normalized.includes('red_eye')
    || normalized.includes('red_status')
    || normalized.includes('status_light')
    || normalized.includes('console')
    || normalized.includes('cable')
    || normalized.includes('conduit')
    || normalized.includes('pipe')
    || normalized.includes('tank')
    || normalized.includes('valve')
    || normalized.includes('terminal')
  ) {
    return false;
  }
  return normalized.includes('floor_slab')
    || normalized.includes('factory_floor_slab')
    || normalized.includes('main_floor_slab')
    || normalized.includes('floor_panel_seam')
    || normalized.includes('floor_seam')
    || normalized.includes('_wall')
    || normalized.endsWith('wall')
    || normalized.includes('wall_trim')
    || normalized.endsWith('_trim')
    || normalized.includes('door_header')
    || normalized.includes('entry_header')
    || normalized.includes('exit_header')
    || normalized.includes('locked_exit_gate')
    || normalized.includes('optional_reward_gate')
    || normalized.includes('gate_frame')
    || normalized.includes('gate_energy_bar');
}

function isVisibleThroughParents(object) {
  for (let current = object; current; current = current.parent) {
    if (current.visible === false) return false;
  }
  return true;
}

function shouldIncludePresentationMesh(mesh, asset) {
  if (!mesh?.isMesh || !mesh.geometry || !isVisibleThroughParents(mesh)) return false;
  if (asset.presentationNodePolicy.hideLegacyRoomShell && isLegacyShellPresentationNode(mesh.name)) return false;
  const normalized = String(mesh.name ?? '').toLowerCase();
  return !(asset.presentationNodePolicy.hideLooseDetailTokens ?? [])
    .some((token) => normalized.includes(token));
}

function vertexLayoutKey(geometry) {
  return Object.entries(geometry.attributes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, attribute]) => `${name}:${attribute.itemSize}:${attribute.normalized ? 1 : 0}`)
    .join('|');
}

function applyNormalizedPlacement(geometry, bounds, scale) {
  const centerX = (bounds.min.x + bounds.max.x) * 0.5;
  const centerZ = (bounds.min.z + bounds.max.z) * 0.5;
  geometry.translate(-centerX, -bounds.min.y, -centerZ);
  geometry.scale(scale, scale, scale);
}

export async function loadMergedLegacyAuthoredPresentationV2(assetId, {
  assetFamilyId = null,
  footprint = null,
  loadingManager = undefined,
  loader = null,
  onProgress = undefined,
  maximumDrawCalls = 3,
  materialFactory = null,
  runtimeModules = null,
} = {}) {
  const asset = findRoomAsset(assetId);
  const modules = runtimeModules ?? await Promise.all([
    import('three'),
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/utils/BufferGeometryUtils.js'),
  ]).then(([three, gltf, geometryUtils]) => ({
    three,
    GLTFLoader: gltf.GLTFLoader,
    mergeGeometries: geometryUtils.mergeGeometries,
  }));
  const { three, GLTFLoader, mergeGeometries } = modules;
  if (!three?.Group || !three?.Mesh || typeof mergeGeometries !== 'function') {
    throw new TypeError('runtimeModules must provide THREE classes and mergeGeometries.');
  }

  const activeLoader = loader ?? new GLTFLoader(loadingManager);
  const gltf = await activeLoader.loadAsync(asset.url, onProgress);
  const sourceScene = gltf?.scene;
  if (!sourceScene) throw new Error(`GLTF ${asset.url} did not contain a scene.`);
  sourceScene.updateWorldMatrix(true, true);

  const entries = [];
  sourceScene.traverse((object) => {
    if (!shouldIncludePresentationMesh(object, asset)) return;
    let geometry = object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    if (geometry.index) geometry = geometry.toNonIndexed();
    geometry.morphAttributes = {};
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    entries.push({ geometry, sourceMaterial: Array.isArray(object.material) ? object.material[0] : object.material });
  });
  if (entries.length === 0) throw new Error(`No mergeable presentation geometry remained for ${assetId}.`);

  const bounds = new three.Box3();
  bounds.makeEmpty();
  for (const { geometry } of entries) {
    geometry.computeBoundingBox();
    bounds.union(geometry.boundingBox);
  }
  const sourceSize = new three.Vector3();
  bounds.getSize(sourceSize);
  const target = footprint ?? asset.footprint;
  const scale = Math.min(
    target.width / Math.max(0.001, sourceSize.x),
    target.depth / Math.max(0.001, sourceSize.z),
  );
  for (const { geometry } of entries) applyNormalizedPlacement(geometry, bounds, scale);

  const groups = new Map();
  for (const entry of entries) {
    const key = vertexLayoutKey(entry.geometry);
    const group = groups.get(key) ?? { geometries: [], sourceMaterial: entry.sourceMaterial };
    group.geometries.push(entry.geometry);
    groups.set(key, group);
  }
  if (groups.size > maximumDrawCalls) {
    for (const { geometry } of entries) geometry.dispose();
    throw new Error(`${assetId} needs ${groups.size} merged slices, exceeding the ${maximumDrawCalls} draw-call budget.`);
  }

  const root = new three.Group();
  root.name = `legacyAuthoredMergedPresentation:${assetId}`;
  root.userData.assetId = assetId;
  root.userData.assetFamilyId = assetFamilyId;
  root.userData.collisionAuthority = 'accepted-plan-fixture-bounds';
  root.userData.presentationMeshCollisionForbidden = true;
  root.userData.rawSourceMeshCount = entries.length;

  let sliceIndex = 0;
  for (const { geometries, sourceMaterial } of groups.values()) {
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) throw new Error(`Could not merge a compatible geometry slice for ${assetId}.`);
    const material = materialFactory
      ? materialFactory({ asset, sourceMaterial, sliceIndex, geometry: merged })
      : sourceMaterial?.clone?.() ?? new three.MeshStandardMaterial({ color: 0xb9c8ce, roughness: 0.6, metalness: 0.2 });
    if (merged.getAttribute('color') && material && 'vertexColors' in material) material.vertexColors = true;
    const mesh = new three.Mesh(merged, material);
    mesh.name = `legacyAuthoredMergedSlice:${assetId}:${sliceIndex}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.assetFamilyId = assetFamilyId;
    mesh.userData.collisionAuthority = 'accepted-plan-fixture-bounds';
    root.add(mesh);
    sliceIndex += 1;
  }
  root.userData.mergedDrawCallCount = root.children.length;
  return root;
}

export default loadMergedLegacyAuthoredPresentationV2;
