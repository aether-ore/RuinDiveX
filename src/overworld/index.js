export {
  OVERWORLD_APRON_CELLS,
  OVERWORLD_CELL_SIZE,
  OVERWORLD_CHUNK_CELLS,
  OVERWORLD_CORE_CELLS,
  OVERWORLD_CORE_SIZE,
  OVERWORLD_LEVEL_HEIGHT,
  OVERWORLD_PLAN_ID,
  OVERWORLD_PLAN_VERSION,
  OVERWORLD_SURFACE_MATERIALS,
  OVERWORLD_VISUAL_CELLS,
  OVERWORLD_VISUAL_SIZE,
  createAuthoredOverworldPlan,
  getTerrainCell,
  validateOverworldPlan,
} from './OverworldPlan.js';

export {
  DEFAULT_VOXEL_FACE_TEXTURE_MANIFEST,
  VOXEL_FACE_FAMILY_IDS,
  VOXEL_TEXTURE_BASE_PATH,
  createVoxelFaceTextureManifest,
  toSixFaceTexturePaths,
  validateVoxelFaceTextureManifest,
} from './VoxelFaceTextureManifest.js';

export {
  OVERWORLD_BUILDING_GEOMETRY_CONTRACT,
  TERRAIN_MATERIAL_KEYS,
  assembleOverworld,
  buildTerrainChunkGeometry,
  buildTerrainRangeGeometry,
  createOverworldSharedGeometryLibrary,
  disposeOverworldFacade,
} from './VoxelTerrainAssembler.js';

export { OverworldController, SpatialBlockerHash } from './OverworldController.js';

export {
  SHARED_CAMP_OBJECT_NAMES,
  createSharedCampAssets,
} from './SharedCampAssetFactory.js';

export {
  LEGACY_CAMP_ASSET_ADAPTER_ID,
  LegacyCampAssetAdapter,
  createLegacyCampAssetAdapter,
  validateLegacyCampAssetAdapter,
} from './LegacyCampAssetAdapter.js';

export {
  BUNDLE_LOCAL_STATE_FIELDS,
  BUNDLE_LOCAL_STATE_OWNERSHIP,
  LOADED_WORLD_BUNDLE_KIND,
  LOADED_WORLD_BUNDLE_FIELDS,
  MOUNTED_RUNTIME_LOCAL_STATE_FIELDS,
  MOUNTED_RUNTIME_LOCAL_STATE_OWNERSHIP,
  PERSISTENT_HOST_STATE_FIELDS,
  PERSISTENT_HOST_STATE_OWNERSHIP,
  WORLD_KINDS,
  WORLD_LIFECYCLE_STATES,
  WORLD_LIFECYCLE_TRANSITIONS,
  WORLD_STATE_OWNERSHIP,
  WORLD_STATE_OWNERSHIP_DESCRIPTORS,
  WorldLifecycleState,
  WorldLifecycleTransitionError,
  assertLoadedWorldBundle,
  assertMountedRuntimeStateHost,
  assertWorldLifecycleTransition,
  canTransitionWorldLifecycle,
  createLoadedWorldBundle,
  createWorldLifecycleState,
  getWorldStateOwner,
  isLoadedWorldBundle,
  isWorldLifecycleTransitionAllowed,
  validateLoadedWorldBundle,
  validateMountedRuntimeStateHost,
  validateWorldLifecycleTransition,
} from './WorldLifecycleContracts.js';
