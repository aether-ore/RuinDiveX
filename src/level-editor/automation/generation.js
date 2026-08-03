import {
  LEVEL_EDITOR_PROJECT_SCHEMA,
  ROOM_MODULE_SCHEMA,
  canonicalHash,
  createDefaultLevelEditorProject,
  createDefaultTransform,
  sha256Text,
} from '../core/index.js';
import {
  LEVEL_FORGE_RECEIPT_SCHEMA,
  LEVEL_FORGE_GENERATOR_VERSION,
  MAX_LEVEL_FORGE_LAYOUT_VARIANTS,
  MAX_LEVEL_FORGE_REPAIR_PASSES,
  createForgeDiagnostic,
  forgeResult,
  isNormalizedLevelForgeSpec,
  normalizeLevelForgeSpec,
} from './contracts.js';
import { validateGeneratedDungeon } from './validation.js';

const TILE_SIZE = 2.8;
const ROOM_SIZE = 16.8;
const ROOM_HEIGHT = 5.6;
const ROOM_HALF = ROOM_SIZE * 0.5;
const LEVEL_STEP = 14;
const HORIZONTAL_ROOM_SPACING = 25.2;
const SLOPE_ROOM_SPACING = 100.8;
const FIXED_TIMESTAMP = '2026-01-01T00:00:00.000Z';
const LAYOUT_DIRECTIONS = Object.freeze([
  Object.freeze({ id: 'southbound', x: 0, z: 1 }),
  Object.freeze({ id: 'eastbound', x: 1, z: 0 }),
  Object.freeze({ id: 'northbound', x: 0, z: -1 }),
  Object.freeze({ id: 'westbound', x: -1, z: 0 }),
]);

function clampInteger(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(numeric)));
}

function seedOffset(seed) {
  return Number.parseInt(sha256Text(seed).slice(0, 8), 16) % LAYOUT_DIRECTIONS.length;
}

function seedToken(seed) {
  return sha256Text(seed).slice(0, 10);
}

function forgeId(prefix, token, index = null) {
  return index == null
    ? `${prefix}-${token}`
    : `${prefix}-${token}-${String(index + 1).padStart(2, '0')}`;
}

function vector(x = 0, y = 0, z = 0) {
  return { x: Number(x), y: Number(y), z: Number(z) };
}

function entityTransform(x = 0, y = 0, z = 0, rotationY = 0) {
  return createDefaultTransform({ position: vector(x, y, z), rotationY });
}

function connectionKinds(spec, count) {
  const kinds = Array(Math.max(0, count)).fill('service-gallery');
  const reserved = new Set();
  const reserveNearMiddle = (kind, preferred) => {
    for (let offset = 0; offset < kinds.length; offset += 1) {
      for (const index of [preferred + offset, preferred - offset]) {
        if (index >= 0 && index < kinds.length && !reserved.has(index)) {
          kinds[index] = kind;
          reserved.add(index);
          return;
        }
      }
    }
  };
  if (spec.features.lifts) reserveNearMiddle('lift', Math.floor((kinds.length - 1) * 0.5));
  if (spec.features.slopes) reserveNearMiddle('slope', Math.floor((kinds.length - 1) * 0.66));
  return kinds;
}

function layoutPlan(spec, direction) {
  const centers = Array(spec.roomCount).fill(null);
  centers[0] = vector(0, 0, 0);
  const topology = [];
  let branchRoomIndex = null;
  let branchAnchorIndex = null;
  if (spec.layout === 'branching') {
    branchRoomIndex = spec.roomCount - 2;
    const backbone = [
      ...Array.from({ length: spec.roomCount - 2 }, (_entry, index) => index),
      spec.roomCount - 1,
    ];
    branchAnchorIndex = backbone[Math.max(1, Math.floor((backbone.length - 1) * 0.5))];
    for (let index = 0; index < backbone.length - 1; index += 1) {
      topology.push({ fromIndex: backbone[index], toIndex: backbone[index + 1], branch: false });
    }
    topology.push({ fromIndex: branchAnchorIndex, toIndex: branchRoomIndex, branch: true });
  } else {
    for (let index = 0; index < spec.roomCount - 1; index += 1) {
      topology.push({ fromIndex: index, toIndex: index + 1, branch: false });
    }
  }
  const kinds = connectionKinds(spec, topology.length);
  const perpendicular = { x: -direction.z, z: direction.x };
  const edges = topology.map((entry, index) => ({
    ...entry,
    index,
    kind: kinds[index],
    direction: entry.branch ? perpendicular : direction,
  }));
  const place = (edge) => {
    const previous = centers[edge.fromIndex];
    if (!previous) return false;
    if (edge.kind === 'lift') {
      centers[edge.toIndex] = vector(previous.x, previous.y + LEVEL_STEP, previous.z);
      return true;
    }
    const spacing = edge.kind === 'slope' ? SLOPE_ROOM_SPACING : HORIZONTAL_ROOM_SPACING;
    centers[edge.toIndex] = vector(
      previous.x + edge.direction.x * spacing,
      previous.y + (edge.kind === 'slope' ? LEVEL_STEP : 0),
      previous.z + edge.direction.z * spacing,
    );
    return true;
  };
  // Backbone edges are ordered first; the branch is therefore placed only
  // after its anchor has a deterministic position.
  for (const edge of edges) place(edge);
  const gateEdge = spec.layout === 'branching'
    ? edges.find((edge) => !edge.branch && edge.fromIndex === branchAnchorIndex)
      ?? edges.filter((edge) => !edge.branch).at(-1)
    : edges[Math.max(1, edges.length - 1)];
  return {
    direction,
    centers,
    edges,
    branchRoomIndex,
    branchAnchorIndex,
    gateEdgeIndex: gateEdge?.index ?? Math.max(0, edges.length - 1),
  };
}

function roleForRoom(index, roomCount, layout = 'linear') {
  if (index === 0) return 'entrance';
  if (index === roomCount - 1) return 'extraction';
  if (layout === 'branching' && index === roomCount - 2) return 'side-cache';
  if (index === 1) return 'encounter';
  if (index === roomCount - 2) return 'sanctuary';
  return 'traversal';
}

function socketDefinition(socketId, kind, direction, side) {
  const lift = kind === 'lift';
  const facingSign = side === 'out' ? 1 : -1;
  const family = lift ? 'lift' : 'service-gallery';
  const facing = lift
    ? vector(0, 0, facingSign)
    : vector(direction.x * facingSign, 0, direction.z * facingSign);
  const position = lift
    ? vector(0, 0, 0)
    : vector(direction.x * ROOM_HALF * facingSign, 0, direction.z * ROOM_HALF * facingSign);
  return {
    id: socketId,
    name: `${side === 'out' ? 'Outbound' : 'Inbound'} ${lift ? 'Lift' : 'Door'}`,
    kind: lift ? 'lift' : 'door',
    actorKind: 'player',
    position,
    transform: entityTransform(position.x, position.y, position.z),
    facing,
    widthMeters: TILE_SIZE * 3,
    heightMeters: ROOM_HEIGHT,
    depth: 0.3,
    landingRequirements: {
      minWidthMeters: TILE_SIZE * 3,
      minDepthMeters: TILE_SIZE * 3,
    },
    clearanceRequirements: {
      widthMeters: TILE_SIZE * 3,
      heightMeters: 3.6,
      depthMeters: TILE_SIZE * 2,
    },
    compatibleFamilies: [family],
    optional: false,
    capPreset: 'sealed-wall',
    properties: { positionAnchor: 'threshold-floor' },
  };
}

function floorPrimitive(moduleId) {
  return {
    id: `${moduleId}-floor`,
    kind: 'structural',
    type: 'floor',
    shape: 'box',
    name: 'Editable Floor',
    size: vector(ROOM_SIZE, 0.2, ROOM_SIZE),
    transform: entityTransform(0, -0.1, 0),
    materialId: 'floor',
    collision: true,
    walkable: true,
    surfaceRole: 'floor',
    blocksBelow: false,
    enabled: true,
    properties: { generatedRole: 'walkable-floor' },
  };
}

function wallPrimitives(moduleId) {
  const common = {
    kind: 'structural',
    type: 'wall',
    shape: 'box',
    materialId: 'wall',
    collision: true,
    collider: true,
    enabled: true,
  };
  return [
    {
      ...common,
      id: `${moduleId}-wall-north`,
      name: 'North Wall',
      size: vector(ROOM_SIZE, ROOM_HEIGHT, 0.2),
      transform: entityTransform(0, ROOM_HEIGHT * 0.5, -ROOM_HALF),
    },
    {
      ...common,
      id: `${moduleId}-wall-south`,
      name: 'South Wall',
      size: vector(ROOM_SIZE, ROOM_HEIGHT, 0.2),
      transform: entityTransform(0, ROOM_HEIGHT * 0.5, ROOM_HALF),
    },
    {
      ...common,
      id: `${moduleId}-wall-east`,
      name: 'East Wall',
      size: vector(0.2, ROOM_HEIGHT, ROOM_SIZE),
      transform: entityTransform(ROOM_HALF, ROOM_HEIGHT * 0.5, 0),
    },
    {
      ...common,
      id: `${moduleId}-wall-west`,
      name: 'West Wall',
      size: vector(0.2, ROOM_HEIGHT, ROOM_SIZE),
      transform: entityTransform(-ROOM_HALF, ROOM_HEIGHT * 0.5, 0),
    },
  ];
}

function createRoomModule(spec, token, plan, index) {
  const role = roleForRoom(index, spec.roomCount, spec.layout);
  const moduleId = forgeId(`forge-${role}`, token, index);
  const sockets = plan.edges.flatMap((edge) => {
    if (edge.fromIndex === index) {
      return [socketDefinition(`edge-${edge.index + 1}-out`, edge.kind, edge.direction, 'out')];
    }
    if (edge.toIndex === index) {
      return [socketDefinition(`edge-${edge.index + 1}-in`, edge.kind, edge.direction, 'in')];
    }
    return [];
  });
  return {
    schema: ROOM_MODULE_SCHEMA,
    moduleId,
    topologyRevision: 1,
    themePackId: spec.themePackId,
    tileSize: TILE_SIZE,
    dimensions: {
      width: ROOM_SIZE,
      height: ROOM_HEIGHT,
      depth: ROOM_SIZE,
      widthMeters: ROOM_SIZE,
      heightMeters: ROOM_HEIGHT,
      depthMeters: ROOM_SIZE,
      widthTiles: ROOM_SIZE / TILE_SIZE,
      depthTiles: ROOM_SIZE / TILE_SIZE,
    },
    room: {
      id: moduleId,
      name: `${role[0].toUpperCase()}${role.slice(1)} Chamber`,
      type: 'authored-room',
      archetype: `industrial-${role}`,
      baseElevation: 0,
      width: ROOM_SIZE / TILE_SIZE,
      depth: ROOM_SIZE / TILE_SIZE,
      ceilingHeight: ROOM_HEIGHT,
    },
    selection: {
      family: spec.themePackId,
      roomType: role,
      archetype: `industrial-${role}`,
      tags: ['level-forge', 'industrial', role],
      weight: 1,
      allowedQuarterTurns: [0, 1, 2, 3],
      difficulty: { min: 1, max: 10 },
      maximumInstances: 1,
    },
    primitives: [floorPrimitive(moduleId), ...wallPrimitives(moduleId)],
    models: [],
    materials: [],
    sockets,
    anchors: [],
    entities: [],
    metadata: {
      authoredBy: 'RuinDiver Level Forge',
      generator: LEVEL_FORGE_GENERATOR_VERSION,
      generatorVersion: LEVEL_FORGE_GENERATOR_VERSION,
      generatedRole: role,
      sourceSpecHash: spec.specHash,
      promptSpecHash: spec.specHash,
    },
  };
}

function routeForConnection(plan, edge) {
  if (edge.kind !== 'slope') return null;
  const fromCenter = plan.centers[edge.fromIndex];
  const toCenter = plan.centers[edge.toIndex];
  const start = vector(
    fromCenter.x + edge.direction.x * ROOM_HALF,
    fromCenter.y,
    fromCenter.z + edge.direction.z * ROOM_HALF,
  );
  const end = vector(
    toCenter.x - edge.direction.x * ROOM_HALF,
    toCenter.y,
    toCenter.z - edge.direction.z * ROOM_HALF,
  );
  return {
    waypoints: [
      vector(
        start.x + edge.direction.x * TILE_SIZE * 2,
        start.y,
        start.z + edge.direction.z * TILE_SIZE * 2,
      ),
      vector(
        end.x - edge.direction.x * TILE_SIZE * 2,
        end.y,
        end.z - edge.direction.z * TILE_SIZE * 2,
      ),
    ],
  };
}

function createConnections(spec, token, plan) {
  const lockedEdge = plan.gateEdgeIndex;
  const credentialId = forgeId('credential', token);
  const doorId = forgeId('door', token);
  const mechanismId = forgeId('mechanism', token);
  return plan.edges.map((edge) => {
    const { kind, index } = edge;
    const properties = {
      authoredWith: LEVEL_FORGE_GENERATOR_VERSION,
      family: kind === 'lift' ? 'lift' : 'service-gallery',
      kind,
      connectorType: kind,
      widthMeters: TILE_SIZE * 3,
      clearHeight: ROOM_HEIGHT,
      floorThickness: 0.22,
      rails: true,
      requiredForProgression: true,
    };
    const route = routeForConnection(plan, edge);
    if (route) properties.route = route;
    if (spec.features.gates && index === lockedEdge) {
      properties.doorId = doorId;
      properties.requiredCredentialIds = [credentialId];
      properties.requiredKeycardId = credentialId;
    }
    if (spec.features.puzzles && index === lockedEdge) {
      properties.requiredMechanismStateIds = [mechanismId];
    }
    return {
      id: forgeId('connection', token, index),
      from: { roomId: forgeId('room', token, edge.fromIndex), socketId: `edge-${index + 1}-out` },
      to: { roomId: forgeId('room', token, edge.toIndex), socketId: `edge-${index + 1}-in` },
      kind,
      bidirectional: true,
      properties,
      metadata: { generatedBy: LEVEL_FORGE_GENERATOR_VERSION, sequence: index },
    };
  });
}

function gameplayEntity(idValue, kind, type, roomId, position, properties = {}, name = null) {
  return {
    id: idValue,
    kind,
    type,
    name: name ?? type,
    roomId,
    transform: entityTransform(position.x, position.y, position.z),
    properties: { enabled: true, editorCategory: 'gameplay', ...properties },
    metadata: { generatedBy: LEVEL_FORGE_GENERATOR_VERSION },
  };
}

function createEntities(spec, token, plan) {
  const roomId = (index) => forgeId('room', token, index);
  const entities = [
    gameplayEntity(
      forgeId('player-start', token),
      'player-spawn',
      'player-spawn',
      roomId(0),
      vector(0, 0, 0),
      { primary: true },
      'Player Start',
    ),
    gameplayEntity(
      forgeId('extraction', token),
      'extraction',
      'extraction',
      roomId(spec.roomCount - 1),
      vector(0, 0, 0),
      { required: true, action: 'extract', role: 'extraction' },
      'Extraction Beacon',
    ),
  ];
  if (spec.features.encounters && spec.roomCount > 2) {
    entities.push(gameplayEntity(
      forgeId('encounter', token),
      'encounter',
      'encounter',
      roomId(1),
      vector(0, 0, 0),
      { radius: 4.2, roster: [], required: false },
      'Calibration Encounter',
    ));
  }
  if (spec.features.rewards && spec.roomCount > 2) {
    const rewardIndex = Math.max(1, Math.floor(spec.roomCount * 0.5));
    entities.push(gameplayEntity(
      forgeId('reward-cache', token),
      'chest',
      'chest',
      roomId(rewardIndex),
      vector(TILE_SIZE, 0, 0),
      { lootTableId: 'level-forge-safe-default' },
      'Ruin Cache',
    ));
  }
  if (spec.features.safeZone && spec.roomCount > 2) {
    entities.push(gameplayEntity(
      forgeId('safe-zone', token),
      'safe-zone',
      'safe-zone',
      roomId(spec.roomCount - 2),
      vector(0, 0, 0),
      { size: vector(TILE_SIZE * 3, ROOM_HEIGHT, TILE_SIZE * 3), showVolume: false },
      'Recovery Zone',
    ));
  }
  if (spec.features.gates) {
    const credentialId = forgeId('credential', token);
    const doorId = forgeId('door', token);
    const lockedEdge = plan.edges[plan.gateEdgeIndex];
    const keyRoomIndex = plan.branchRoomIndex ?? Math.min(1, Math.max(0, lockedEdge.fromIndex));
    const doorPosition = lockedEdge.kind === 'lift'
      ? vector(0, 0, 0)
      : vector(lockedEdge.direction.x * ROOM_HALF, 0, lockedEdge.direction.z * ROOM_HALF);
    entities.push(
      gameplayEntity(
        credentialId,
        'keycard',
        'keycard',
        roomId(keyRoomIndex),
        vector(-TILE_SIZE, 0, 0),
        { keycardId: credentialId, credentialId, displayName: 'Forge Access Card', isRequiredForMainProgression: true },
        'Forge Access Card',
      ),
      gameplayEntity(
        doorId,
        'door',
        'door',
        roomId(lockedEdge.fromIndex),
        doorPosition,
        {
          doorId,
          requiredCredentialIds: [credentialId],
          requiredKeycardId: credentialId,
          locked: true,
          closed: true,
          width: TILE_SIZE * 3,
          height: 3.6,
        },
        'Credential Gate',
      ),
    );
  }
  if (spec.features.puzzles) {
    const mechanismId = forgeId('mechanism', token);
    const controlRoomIndex = plan.branchRoomIndex ?? 1;
    entities.push(
      gameplayEntity(
        mechanismId,
        'mechanism',
        'mechanism',
        roomId(controlRoomIndex),
        vector(TILE_SIZE, 0, TILE_SIZE),
        { mechanismId, prompt: 'Activate route control' },
        'Route Control',
      ),
      gameplayEntity(
        forgeId('puzzle-block', token),
        'puzzle-block',
        'puzzle-block',
        roomId(controlRoomIndex),
        vector(-TILE_SIZE, 0, TILE_SIZE),
        { mass: 1, locked: false },
        'Editable Puzzle Block',
      ),
    );
  }
  return entities;
}

function buildProject(spec, direction, variantIndex, options = {}) {
  const token = seedToken(spec.seed);
  const plan = layoutPlan(spec, direction);
  const timestamp = String(options.timestamp ?? FIXED_TIMESTAMP);
  const project = createDefaultLevelEditorProject({
    projectId: forgeId('level-forge-project', token),
    name: spec.name,
    createdAt: timestamp,
    updatedAt: timestamp,
    tileSize: TILE_SIZE,
    themePackId: spec.themePackId,
    metadata: {
      authoredBy: 'RuinDiver Level Forge',
      generator: LEVEL_FORGE_GENERATOR_VERSION,
      generatorVersion: LEVEL_FORGE_GENERATOR_VERSION,
      sourceSpecHash: spec.specHash,
      promptSpecHash: spec.specHash,
      seed: spec.seed,
      layoutVariant: direction.id,
      layoutVariantIndex: variantIndex,
      fullyEditable: true,
      registryFallback: false,
    },
  });
  project.roomModules = plan.centers.map((_center, index) => createRoomModule(spec, token, plan, index));
  project.rooms = plan.centers.map((center, index) => ({
    id: forgeId('room', token, index),
    moduleId: project.roomModules[index].moduleId,
    name: project.roomModules[index].room.name,
    transform: entityTransform(center.x, center.y, center.z),
    dimensions: {
      width: ROOM_SIZE,
      height: ROOM_HEIGHT,
      depth: ROOM_SIZE,
    },
    properties: {
      generatedRole: roleForRoom(index, spec.roomCount, spec.layout),
      progressionBand: index,
      sequence: index,
    },
    metadata: { generatedBy: 'deterministic-level-forge/v1' },
  }));
  project.connections = createConnections(spec, token, plan);
  project.entities = createEntities(spec, token, plan);
  project.settings.spawnId = forgeId('player-start', token);
  project.settings.levelForgeSpecHash = spec.specHash;
  project.settings.grounded = spec.constraints.grounded;
  return project;
}

/** Generate a deterministic, fully editable level-editor project. */
export async function generateLevelForgeProject(input = {}, options = {}) {
  const normalized = isNormalizedLevelForgeSpec(input)
    ? normalizeLevelForgeSpec(input, options)
    : normalizeLevelForgeSpec(input, options);
  if (!normalized.ok) {
    return forgeResult(normalized.diagnostics, {
      value: null,
      spec: null,
      project: null,
      receipt: null,
    });
  }
  const spec = normalized.spec;
  const layoutVariantCount = clampInteger(
    options.layoutVariants,
    1,
    MAX_LEVEL_FORGE_LAYOUT_VARIANTS,
    MAX_LEVEL_FORGE_LAYOUT_VARIANTS,
  );
  const maximumRepairPasses = clampInteger(
    options.maxRepairPasses,
    0,
    MAX_LEVEL_FORGE_REPAIR_PASSES,
    MAX_LEVEL_FORGE_REPAIR_PASSES,
  );
  const maximumAttempts = Math.min(layoutVariantCount, maximumRepairPasses + 1);
  const initialDirection = seedOffset(spec.seed);
  const attempts = [];
  const seenProjectHashes = new Set();
  let repeatedHashGuardTriggered = false;
  let lastProject = null;
  let lastValidation = null;
  let successfulVariant = null;

  for (let attemptIndex = 0; attemptIndex < maximumAttempts; attemptIndex += 1) {
    const variantIndex = (initialDirection + attemptIndex) % LAYOUT_DIRECTIONS.length;
    const direction = LAYOUT_DIRECTIONS[variantIndex];
    const project = buildProject(spec, direction, variantIndex, options);
    const projectHash = canonicalHash(project, { namespace: LEVEL_EDITOR_PROJECT_SCHEMA });
    if (seenProjectHashes.has(projectHash)) {
      repeatedHashGuardTriggered = true;
      break;
    }
    seenProjectHashes.add(projectHash);
    lastProject = project;
    const validation = await validateGeneratedDungeon(project, {
      spec,
      strictAssembly: options.strictAssembly !== false && options.validate !== false,
      createGameplayVisuals: false,
      createConnectorGeometry: true,
      warningsAsErrors: options.warningsAsErrors === true,
    });
    lastValidation = validation;
    attempts.push({
      attempt: attemptIndex + 1,
      repairPass: attemptIndex,
      layoutVariantIndex: variantIndex,
      layoutVariant: direction.id,
      projectHash,
      dungeonHash: validation.dungeon?.contentHash ?? null,
      ok: validation.ok,
      errorCodes: validation.errors.map(({ code }) => code),
    });
    if (validation.ok) {
      successfulVariant = { variantIndex, direction, attemptIndex, project, projectHash, validation };
      break;
    }
  }

  const success = successfulVariant !== null;
  const selected = successfulVariant ?? {
    variantIndex: attempts.at(-1)?.layoutVariantIndex ?? initialDirection,
    direction: LAYOUT_DIRECTIONS[attempts.at(-1)?.layoutVariantIndex ?? initialDirection],
    attemptIndex: Math.max(0, attempts.length - 1),
    project: lastProject,
    projectHash: attempts.at(-1)?.projectHash ?? null,
    validation: lastValidation,
  };
  const receipt = {
    schema: LEVEL_FORGE_RECEIPT_SCHEMA,
    specHash: spec.specHash,
    promptSpecHash: selected.validation?.receipt?.promptSpecHash
      ?? selected.project?.metadata?.promptSpecHash
      ?? spec.specHash,
    generatorVersion: selected.validation?.receipt?.generatorVersion
      ?? selected.project?.metadata?.generatorVersion
      ?? LEVEL_FORGE_GENERATOR_VERSION,
    seed: spec.seed,
    projectId: selected.project?.projectId ?? null,
    projectHash: selected.projectHash,
    dungeonHash: selected.validation?.dungeon?.contentHash ?? null,
    registryHash: selected.validation?.registry?.contentHash ?? null,
    layoutVariant: selected.direction?.id ?? null,
    layoutVariantIndex: selected.variantIndex,
    layoutVariantsTried: attempts.length,
    maximumLayoutVariants: layoutVariantCount,
    repairPasses: Math.max(0, attempts.length - 1),
    maximumRepairPasses,
    repeatedHashGuardTriggered,
    strictAssembly: options.strictAssembly !== false && options.validate !== false,
    exactRegistry: true,
    registryFallback: false,
    attempts,
  };
  receipt.receiptHash = canonicalHash(receipt, {
    namespace: LEVEL_FORGE_RECEIPT_SCHEMA,
    omitKeys: ['receiptHash'],
  });

  if (!success) {
    const failure = createForgeDiagnostic(
      'error',
      'LEVEL_FORGE_GENERATION_FAILED',
      '$',
      'No deterministic layout variant passed the generated dungeon gates.',
      {
        attempts,
        maximumLayoutVariants: layoutVariantCount,
        maximumRepairPasses,
        repeatedHashGuardTriggered,
      },
    );
    const diagnostics = [
      ...normalized.diagnostics,
      ...(lastValidation?.diagnostics ?? []),
      failure,
    ];
    return forgeResult(diagnostics, {
      value: null,
      spec,
      project: null,
      candidate: lastProject,
      receipt,
      validation: lastValidation,
    });
  }

  const diagnostics = [
    ...normalized.diagnostics,
    createForgeDiagnostic(
      'info',
      'LEVEL_FORGE_GENERATED',
      '$',
      `Generated and validated ${spec.roomCount} editable rooms.`,
      {
        projectHash: selected.projectHash,
        dungeonHash: selected.validation.dungeon?.contentHash ?? null,
        layoutVariant: selected.direction.id,
      },
    ),
    ...selected.validation.warnings,
  ];
  return forgeResult(diagnostics, {
    value: selected.project,
    spec,
    project: selected.project,
    dungeon: selected.validation.dungeon,
    registry: selected.validation.registry,
    compiled: selected.validation.compiled,
    validation: selected.validation,
    progression: selected.validation.progression,
    traversal: selected.validation.traversal,
    receipt,
  });
}

export const LEVEL_FORGE_LAYOUT_VARIANTS = LAYOUT_DIRECTIONS;
