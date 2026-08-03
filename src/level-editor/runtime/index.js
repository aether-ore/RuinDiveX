export {
  AssetResolver,
  createAssetResolver,
  normalizeAssetSpec,
} from './AssetResolver.js';

export {
  DEFAULT_PBR_MATERIALS,
  PBRMaterialLibrary,
  createPBRMaterial,
  createPBRMaterialLibrary,
  createMaterialLibrary,
  createAuthoredMaterialLibrary,
  mergeMaterialDefinitions,
  listMaterialDefinitions,
} from './materials.js';

export {
  AuthoredRoomRegistry,
  createAuthoredRoomRegistry,
  listRoomRegistryDefinitions,
} from './AuthoredRoomRegistry.js';

export {
  assembleAuthoredRoom,
  assembleRoom,
  createAuthoredRoom,
  createAuthoredSolidZone,
} from './roomAssembler.js';

export {
  assembleAuthoredGameplay,
  assembleGameplay,
  assembleGameplayEntities,
  createGameplayRuntime,
  canonicalGameplayEntityType,
} from './gameplayAssembler.js';

export {
  AuthoredProgression,
  AuthoredProgressionManager,
  GenericProgressionManager,
  createAuthoredProgression,
  createAuthoredProgressionData,
  createGenericProgression,
  createProgression,
  createProgressionData,
} from './progression.js';

export {
  assembleAuthoredDungeon,
  assembleDungeon,
  createAuthoredDungeon,
  normalizeAuthoredDungeonSource,
} from './dungeonAssembler.js';

export {
  generateRegistryDungeon,
  createRegistryDungeonPlan,
  generateAuthoredDungeonFromRegistry,
} from './registryDungeonGenerator.js';

export {
  createDungeonFacade,
  createDungeonFacadeFactory,
  createLevelEditorDungeonFacade,
  createAuthoredOrLegacyDungeon,
  isAuthoredDungeonSource,
  normalizeDungeonFacade,
} from './createDungeonFacade.js';

export {
  DisposableResourceSet,
  applyTransform,
  readTransform,
  readVector3,
  transformMatrix,
  transformPoint,
  transformDirection,
  unwrapCompiledSource,
} from './utils.js';
