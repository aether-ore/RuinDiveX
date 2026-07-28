import {
  DUNGEON_AUGMENTATION_PROFILE_SCHEMA,
  DUNGEON_SUPPLEMENT_GRAMMAR_SCHEMA,
} from './contracts.js';
import { deepFreezeDungeonAugmentationValue } from './canonical.js';

function socket(id, x, z, facingX, facingZ, kinds = ['player', 'enemy']) {
  return {
    id,
    localPosition: { x, y: 0, z },
    localFacing: { x: facingX, y: 0, z: facingZ },
    kinds,
    widthMeters: 8.4,
    heightMeters: 5.6,
    connectorFamilies: ['service-gallery'],
  };
}

function anchor(id, kind, x, z, extra = {}) {
  return { id, kind, localPosition: { x, y: 0, z }, ...extra };
}

function grammar({ id, size, sockets, anchors, topology, weight = 1 }) {
  return deepFreezeDungeonAugmentationValue({
    schema: DUNGEON_SUPPLEMENT_GRAMMAR_SCHEMA,
    id,
    revision: 1,
    weight,
    sizeClass: size.width <= 8.4 ? 'narrow' : size.width <= 11.2 ? 'compact' : 'standard',
    allowedRotationQuarterTurns: [0, 1, 2, 3],
    topology,
    size,
    structure: {
      floors: [{ id: 'main-floor', role: 'primary-floor', elevation: 0, width: size.width, depth: size.depth }],
      walls: [{ id: 'perimeter-walls', role: 'wall', height: size.height }],
      ceilings: [{ id: 'main-ceiling', role: 'ceiling', elevation: size.height }],
      supports: [{ id: 'structural-supports', role: 'support', spacingMeters: 2.8 }],
      caps: [{ id: 'unused-socket-cap', role: 'cap' }],
      catwalks: [],
    },
    occupiedVolumes: [{
      id: 'room-body',
      center: { x: 0, y: size.height * 0.5, z: 0 },
      size: { ...size },
      purpose: 'supplement-room-occupied',
    }],
    clearanceVolumes: [{
      id: 'player-clearance',
      center: { x: 0, y: 1.8, z: 0 },
      size: { x: Math.max(2.8, size.width - 1.4), y: 3.6, z: Math.max(2.8, size.depth - 1.4) },
      purpose: 'walkable-player-clearance',
    }],
    sockets,
    anchors,
    requiredThemeCapabilities: {
      materials: ['primary-floor', 'wall', 'ceiling', 'support', 'cap'],
      assets: ['light-fixture'],
      connectors: ['service-gallery'],
      transitions: [],
    },
    selectionConstraints: {
      maximumRepeatsPerOperation: 2,
      bossArenaEligible: false,
    },
  });
}

const COMPACT_SIZE = Object.freeze({ width: 11.2, height: 5.6, depth: 11.2 });
const GALLERY_SIZE = Object.freeze({ width: 8.4, height: 5.6, depth: 14 });
const JUNCTION_SIZE = Object.freeze({ width: 14, height: 5.6, depth: 14 });

export const GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS = deepFreezeDungeonAugmentationValue({
  'supplement-chamber-compact-v1': grammar({
    id: 'supplement-chamber-compact-v1',
    size: COMPACT_SIZE,
    topology: 'through-room',
    weight: 4,
    sockets: [
      socket('entry', 0, -COMPACT_SIZE.depth * 0.5, 0, -1),
      socket('exit', 0, COMPACT_SIZE.depth * 0.5, 0, 1),
    ],
    anchors: [
      anchor('encounter', 'encounter', 0, 0),
      anchor('reward', 'reward', 2.8, 1.4),
      anchor('progression', 'progression', -2.8, 1.4),
      anchor('light', 'light-fixture', 0, 0, { elevation: 4.8 }),
    ],
  }),
  'supplement-gallery-bay-v1': grammar({
    id: 'supplement-gallery-bay-v1',
    size: GALLERY_SIZE,
    topology: 'through-gallery',
    weight: 3,
    sockets: [
      socket('entry', 0, -GALLERY_SIZE.depth * 0.5, 0, -1),
      socket('exit', 0, GALLERY_SIZE.depth * 0.5, 0, 1),
    ],
    anchors: [
      anchor('encounter', 'encounter', 0, 0),
      anchor('reward', 'reward', 0, 2.8),
      anchor('progression', 'progression', 0, -2.8),
      anchor('light', 'light-fixture', 0, 0, { elevation: 4.8 }),
    ],
  }),
  'supplement-junction-v1': grammar({
    id: 'supplement-junction-v1',
    size: JUNCTION_SIZE,
    topology: 'four-way-junction',
    weight: 1,
    sockets: [
      socket('entry', 0, -JUNCTION_SIZE.depth * 0.5, 0, -1),
      socket('exit', 0, JUNCTION_SIZE.depth * 0.5, 0, 1),
      socket('left', -JUNCTION_SIZE.width * 0.5, 0, -1, 0),
      socket('right', JUNCTION_SIZE.width * 0.5, 0, 1, 0),
    ],
    anchors: [
      anchor('encounter', 'encounter', 0, 0),
      anchor('reward', 'reward', 2.8, 2.8),
      anchor('progression', 'progression', -2.8, 2.8),
      anchor('light', 'light-fixture', 0, 0, { elevation: 4.8 }),
    ],
  }),
});

export function createDungeonAugmentationProfile(input = {}) {
  const profile = {
    schema: DUNGEON_AUGMENTATION_PROFILE_SCHEMA,
    id: String(input.id ?? ''),
    revision: Number(input.revision ?? 1),
    enabled: input.enabled !== false,
    operationBudget: {
      optionalBranchCount: Number(input.operationBudget?.optionalBranchCount ?? 1),
      optionalBranchRooms: [
        Number(input.operationBudget?.optionalBranchRooms?.[0] ?? 1),
        Number(input.operationBudget?.optionalBranchRooms?.[1] ?? 2),
      ],
      edgePaddingCount: Number(input.operationBudget?.edgePaddingCount ?? 1),
      edgePaddingRooms: [
        Number(input.operationBudget?.edgePaddingRooms?.[0] ?? 1),
        Number(input.operationBudget?.edgePaddingRooms?.[1] ?? 2),
      ],
      minimumTotalRooms: Number(input.operationBudget?.minimumTotalRooms ?? 2),
      maximumTotalRooms: Number(input.operationBudget?.maximumTotalRooms ?? 4),
    },
    requiredOperations: {
      optionalBranch: input.requiredOperations?.optionalBranch !== false,
      edgePadding: input.requiredOperations?.edgePadding !== false,
    },
    grammarPool: (input.grammarPool ?? [
      { id: 'supplement-chamber-compact-v1', weight: 4 },
      { id: 'supplement-gallery-bay-v1', weight: 3 },
      { id: 'supplement-junction-v1', weight: 1 },
    ]).map((entry) => ({ id: String(entry.id), weight: Number(entry.weight ?? 1) })),
    connectorFamilies: [...(input.connectorFamilies ?? ['service-gallery'])],
    connectorGapMeters: Number(input.connectorGapMeters ?? 2.8),
    branchTopology: String(input.branchTopology ?? 'out-and-back'),
    allowDelegatedProgression: input.allowDelegatedProgression === true,
    maximumPlanningAttempts: Math.max(1, Number(input.maximumPlanningAttempts ?? 12)),
  };
  return deepFreezeDungeonAugmentationValue(profile);
}

export const INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE = createDungeonAugmentationProfile({
  id: 'industrial-supplement-preview-v1',
  revision: 1,
  operationBudget: {
    optionalBranchCount: 1,
    optionalBranchRooms: [1, 2],
    edgePaddingCount: 1,
    edgePaddingRooms: [1, 2],
    minimumTotalRooms: 2,
    maximumTotalRooms: 4,
  },
  requiredOperations: { optionalBranch: true, edgePadding: true },
  allowDelegatedProgression: false,
});

// Keep v1 immutable for committed expedition reconstruction. The current
// preview raises the visible delta without broadening the sidecar's authority:
// Industrial still owns every authored room and progression beat, while the
// supplement must realize a two-room exploration branch plus route padding.
export const INDUSTRIAL_SUPPLEMENT_PREVIEW_V2_PROFILE = createDungeonAugmentationProfile({
  id: 'industrial-supplement-preview-v2',
  revision: 2,
  operationBudget: {
    optionalBranchCount: 1,
    optionalBranchRooms: [2, 2],
    edgePaddingCount: 1,
    edgePaddingRooms: [1, 2],
    minimumTotalRooms: 3,
    maximumTotalRooms: 4,
  },
  requiredOperations: { optionalBranch: true, edgePadding: true },
  allowDelegatedProgression: false,
  // Three grid cells leave at least two truly exterior corridor cells between
  // room boundary sockets after Industrial's integer-grid materialization.
  // This guarantees the branch is a visible, measurable gallery instead of
  // two adjacent doorway cells with no place to validate or dress the route.
  connectorGapMeters: 8.4,
  maximumPlanningAttempts: 64,
});

export const DUNGEON_AUGMENTATION_PROFILES = deepFreezeDungeonAugmentationValue({
  [INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE.id]: INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE,
  [INDUSTRIAL_SUPPLEMENT_PREVIEW_V2_PROFILE.id]: INDUSTRIAL_SUPPLEMENT_PREVIEW_V2_PROFILE,
});
