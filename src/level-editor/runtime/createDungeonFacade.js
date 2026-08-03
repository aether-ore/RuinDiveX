import * as THREE from 'three';
import { assembleAuthoredDungeon, normalizeAuthoredDungeonSource } from './dungeonAssembler.js';
import { generateRegistryDungeon } from './registryDungeonGenerator.js';

const FACADE_ARRAY_FIELDS = Object.freeze([
  'rooms',
  'floorTiles',
  'solidZones',
  'aerialBoundaryZones',
  'platforms',
  'socketFrames',
  'socketCaps',
  'connections',
  'connectionPlans',
  'verticalConnectors',
  'doors',
  'keycards',
  'chests',
  'encounters',
  'traps',
  'conveyors',
  'conveyorPuzzles',
  'ladders',
  'connectorLifts',
  'mechanisms',
  'puzzleBlocks',
  'pressurePlates',
  'safeZones',
  'safeInteractables',
  'interactables',
  'exits',
  'npcAnimationMixers',
  'npcAnimators',
  'renderCullGroups',
  'environmentalHazards',
  'enemySpawnPoints',
]);

export function isAuthoredDungeonSource(input) {
  const source = normalizeAuthoredDungeonSource(input);
  if (!source || typeof source !== 'object') return false;
  if (String(source.schema ?? '').startsWith('ruindivex-authored-dungeon/')) return true;
  if (source.authored === true || source.dungeonKind === 'authoredDungeon') return true;
  return Array.isArray(source.rooms)
    && (Array.isArray(source.entities) || Array.isArray(source.connections))
    && (source.dungeonId != null || source.contentHash != null || source.spawnId != null);
}

export function normalizeDungeonFacade(result, { kind = null } = {}) {
  const facade = result?.facade ?? result?.dungeon ?? result;
  if (!facade || typeof facade !== 'object') {
    throw new TypeError('Dungeon factory did not return a facade object.');
  }
  facade.group ??= facade.root ?? new THREE.Group();
  facade.root ??= facade.group;
  facade.tiles ??= new Map();
  for (const field of FACADE_ARRAY_FIELDS) facade[field] ??= [];
  facade.tileSize ??= 2.8;
  facade.playerStart ??= new THREE.Vector3();
  facade.playerStartFacing ??= new THREE.Vector3(0, 0, -1);
  facade.ruinEntryPosition ??= facade.playerStart.clone();
  facade.campReturnPosition ??= facade.playerStart.clone();
  facade.dungeonKind ??= kind ?? 'legacyDungeon';
  facade.minimap ??= { rooms: [], connections: [], markers: [] };
  facade.progression ??= {
    entranceRoomId: facade.rooms[0]?.id ?? null,
    bands: [],
    roomConnections: [],
    doors: [],
    keycards: [],
    shrineKey: null,
    validation: { accepted: true, errors: [], warnings: [] },
  };
  return facade;
}

function injectedLegacyFactory(source, options) {
  return options.legacyFactory
    ?? options.createLegacyDungeon
    ?? options.legacy?.createDungeon
    ?? options.legacy?.factory
    ?? source?.legacyFactory
    ?? source?.createLegacyDungeon
    ?? null;
}

/**
 * Selects the authored data-driven runtime or delegates legacy generation to
 * an injected factory. The level-editor runtime intentionally does not import
 * DungeonGenerator, preventing a second copy of legacy game policy.
 */
export async function createDungeonFacade(source, options = {}) {
  if (options.mode === 'registry' || options.generateFromRegistry === true) {
    const generation = await generateRegistryDungeon(
      options.roomRegistry ?? source?.roomRegistry ?? source,
      { ...(options.generation ?? {}), ...(options.generatorOptions ?? {}) },
    );
    if (!generation.ok) {
      const legacyFactory = injectedLegacyFactory(source, options);
      if (typeof legacyFactory === 'function' && options.fallbackToLegacy !== false) {
        const result = await legacyFactory(source, {
          ...options,
          registryGenerationDiagnostics: generation.diagnostics,
        });
        const facade = normalizeDungeonFacade(result, { kind: 'legacyDungeon' });
        facade.generationDiagnostics = {
          ...generation.diagnostics,
          fallback: {
            used: true,
            family: options.legacyFamily ?? 'industrial',
            reason: 'registry-coverage-incomplete',
          },
        };
        return facade;
      }
      if (options.strict !== false) {
        throw new AggregateError(
          generation.diagnostics.errors.map((message) => new Error(message)),
          'Registry dungeon generation failed and no legacy fallback was available.',
        );
      }
    }
    const factory = options.authoredFactory ?? options.assembleAuthored ?? assembleAuthoredDungeon;
    const result = await factory(generation.dungeon, {
      ...options,
      roomRegistry: generation.registry,
    });
    const facade = normalizeDungeonFacade(result, { kind: 'authoredDungeon' });
    facade.generationDiagnostics = generation.diagnostics;
    return facade;
  }
  const authored = options.mode === 'authored'
    || options.authored === true
    || (options.mode !== 'legacy' && options.forceLegacy !== true && isAuthoredDungeonSource(source));
  if (authored) {
    const factory = options.authoredFactory ?? options.assembleAuthored ?? assembleAuthoredDungeon;
    const result = await factory(source, options);
    return normalizeDungeonFacade(result, { kind: 'authoredDungeon' });
  }

  const legacyFactory = injectedLegacyFactory(source, options);
  if (typeof legacyFactory !== 'function') {
    throw new TypeError(
      'Legacy dungeon input requires an injected legacyFactory(source, options).',
    );
  }
  const result = await legacyFactory(source, options);
  return normalizeDungeonFacade(result, { kind: 'legacyDungeon' });
}

export function createDungeonFacadeFactory(defaultOptions = {}) {
  return (source, options = {}) => createDungeonFacade(source, {
    ...defaultOptions,
    ...options,
  });
}

export const createLevelEditorDungeonFacade = createDungeonFacade;
export const createAuthoredOrLegacyDungeon = createDungeonFacade;
