import { RollSalvageStorage } from '../RollSalvageStorage.js';
import {
  DEFAULT_BOSS_PROFILE_ID,
  getReaverbotBossProfile,
  normalizeBossProfileId,
  resolveBossFeaturedMaterial,
} from '../reaverbots/ReaverbotBossCatalog.js';
import {
  BUSTER_RECIPE_LIST,
  LEGACY_AFTER_DELAY_RECIPE,
  getBusterRecipe,
  getRecipeDiscoveryState,
} from './BusterRecipeCatalog.js';
import {
  BUSTER_MODULE_LIST,
  BUSTER_RULESET_VERSION,
  MEGA_BUSTER_CALIBRATION_CATALOG,
  getBusterModuleDefinition,
} from './catalog.js';
import { validateBusterBuild } from './validation.js';
import {
  BUSTER_LAB_LEGACY_STORAGE_KEY,
  BUSTER_LAB_ENVELOPE_VERSION,
  BUSTER_LAB_V1_IMPORT_CLAIM_KEY,
  BusterLabConflictError,
  createBusterLabEnvelope,
  createBusterLabRecoveryBundle,
  getBusterLabLockName,
  getBusterLabStorageKeys,
  inspectBusterLabStorageEvent,
  parseBusterLabEnvelope,
  resolveBusterLabLockManager,
  resolveSaveContext,
  rotateSaveContext,
  withBusterLabLock,
} from './BusterLabPersistence.js';

// Compatibility export for callers that need to inspect or explicitly adopt
// the old global payload. Durable v2 state uses context-scoped storageKeys.
export const BUSTER_LAB_STORAGE_KEY = BUSTER_LAB_LEGACY_STORAGE_KEY;
export const BUSTER_LAB_STORAGE_VERSION = BUSTER_LAB_ENVELOPE_VERSION;
export const BUSTER_LAB_RULESET_VERSION = BUSTER_RULESET_VERSION;
export const SECOND_BUSTER_CHASSIS_COST = 20;
export const MAX_BUSTER_CHASSIS = 2;
export const MAX_BUSTER_BLUEPRINTS = 8;
export const LEGACY_BUSTER_INVENTORY_CAPACITY = 40;
export const BOSS_HUNT_REPEAT_REWARD_CHANCE = 0.70;

const NON_PHYSICAL_BUILTIN_MODULE_IDS = new Set(['onImpact', 'afterDelay', 'pulsePayload']);

export const STARTER_BUSTER_IDS = Object.freeze({
  chassisId: 'chassis-a',
  buildId: 'build-a',
  moduleInstanceId: 'module-pulse-starter',
  nodeId: 'node-pulse-bolt',
});

function nonNegativeInteger(value, fallback = 0) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function plainObject(value, fallback = {}) {
  const cloned = cloneJson(value, fallback);
  return cloned && typeof cloned === 'object' && !Array.isArray(cloned) ? cloned : fallback;
}

function stableHash01(value) {
  const text = String(value ?? '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

export function getBossHuntRewardRoll({
  saveContextId,
  bossProfileId,
  victoryIndex,
} = {}) {
  const profileId = normalizeBossProfileId(bossProfileId);
  const index = Math.max(1, nonNegativeInteger(victoryIndex, 1));
  return stableHash01(`${String(saveContextId ?? '')}:${profileId}:${index}`);
}

function normalizeTuning(tuning = {}) {
  return {
    power: tuning.power ?? null,
    energy: tuning.energy ?? null,
    range: tuning.range ?? null,
    rapid: tuning.rapid ?? null,
  };
}

function sanitizeProgram(program = {}) {
  const nodes = Array.isArray(program.nodes)
    ? program.nodes
      .filter((node) => node && typeof node === 'object')
      .map((node) => ({
        nodeId: typeof node.nodeId === 'string' ? node.nodeId : null,
        moduleId: typeof node.moduleId === 'string' ? node.moduleId : null,
        moduleInstanceId: typeof node.moduleInstanceId === 'string' ? node.moduleInstanceId : null,
      }))
    : [];
  const edges = Array.isArray(program.edges)
    ? program.edges
      .filter((edge) => edge && typeof edge === 'object')
      .map((edge) => ({
        from: typeof edge.from === 'string' ? edge.from : null,
        port: typeof edge.port === 'string' ? edge.port : null,
        to: typeof edge.to === 'string' ? edge.to : null,
      }))
    : [];
  return {
    rootNodeId: typeof program.rootNodeId === 'string' && program.rootNodeId
      ? program.rootNodeId
      : null,
    nodes,
    edges,
  };
}

function getProgramNodesInGraphOrder(program = {}) {
  const nodes = Array.isArray(program.nodes) ? program.nodes : [];
  const edges = Array.isArray(program.edges) ? program.edges : [];
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
  const outgoing = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, new Map());
    const ports = outgoing.get(edge.from);
    if (!ports.has(edge.port)) ports.set(edge.port, edge.to);
  }
  const ordered = [];
  const visited = new Set();
  const visit = (nodeId) => {
    if (!nodeId || visited.has(nodeId)) return;
    const node = nodeById.get(nodeId);
    if (!node) return;
    visited.add(nodeId);
    ordered.push(node);
    const ports = outgoing.get(nodeId);
    visit(ports?.get('next'));
    visit(ports?.get('child'));
  };
  visit(program.rootNodeId);
  // Invalid/disconnected blueprints still need a stable, lossless suggestion
  // record. Valid programs are entirely ordered by their authored edges.
  for (const node of nodes) visit(node.nodeId);
  return ordered;
}

function sanitizeBuild(build) {
  if (!build || typeof build !== 'object') return null;
  const buildId = typeof build.buildId === 'string' ? build.buildId : '';
  const chassisId = typeof build.chassisId === 'string' ? build.chassisId : '';
  if (!buildId || !chassisId) return null;
  const sanitized = {
    schemaVersion: build.schemaVersion ?? 1,
    rulesetVersion: build.rulesetVersion === 'custom-buster-v0.1'
      ? BUSTER_LAB_RULESET_VERSION
      : typeof build.rulesetVersion === 'string' && build.rulesetVersion
        ? build.rulesetVersion
        : BUSTER_LAB_RULESET_VERSION,
    buildId,
    chassisId,
    tuning: normalizeTuning(build.tuning),
    program: sanitizeProgram(build.program),
  };
  if (typeof build.name === 'string' && build.name) sanitized.name = build.name;
  if (typeof build.label === 'string' && build.label) sanitized.label = build.label;
  return sanitized;
}

function sanitizeBlueprint(blueprint, { fallbackId = '' } = {}) {
  if (!blueprint || typeof blueprint !== 'object') return null;
  const blueprintId = typeof blueprint.blueprintId === 'string' && blueprint.blueprintId
    ? blueprint.blueprintId
    : typeof blueprint.id === 'string' && blueprint.id
      ? blueprint.id
      : fallbackId;
  if (!blueprintId) return null;
  const program = sanitizeProgram(blueprint.program ?? blueprint.source?.program);
  // Blueprints describe behavior and tuning. Physical ownership is assigned
  // only during materialization and can never leak into this source record.
  for (const node of program.nodes) delete node.moduleInstanceId;
  return {
    blueprintId,
    schemaVersion: blueprint.schemaVersion ?? blueprint.source?.schemaVersion ?? 1,
    rulesetVersion: typeof blueprint.rulesetVersion === 'string' && blueprint.rulesetVersion
      ? blueprint.rulesetVersion
      : BUSTER_LAB_RULESET_VERSION,
    name: typeof blueprint.name === 'string' && blueprint.name
      ? blueprint.name.slice(0, 80)
      : 'Untitled Blueprint',
    tuning: normalizeTuning(blueprint.tuning ?? blueprint.source?.tuning),
    program,
    revision: Math.max(1, nonNegativeInteger(blueprint.revision, 1)),
    sourceContextId: typeof blueprint.sourceContextId === 'string'
      ? blueprint.sourceContextId
      : null,
    imported: Boolean(blueprint.imported),
  };
}

function normalizeBlueprints(blueprints) {
  const result = [];
  const ids = new Set();
  for (const raw of Array.isArray(blueprints) ? blueprints : []) {
    const blueprint = sanitizeBlueprint(raw);
    if (!blueprint || ids.has(blueprint.blueprintId) || result.length >= MAX_BUSTER_BLUEPRINTS) continue;
    ids.add(blueprint.blueprintId);
    result.push(blueprint);
  }
  return result;
}

function normalizeFabricationHistory(history, moduleInstances = []) {
  const normalized = {};
  for (const [moduleId, raw] of Object.entries(plainObject(history))) {
    if (!getBusterModuleDefinition(moduleId) || !raw || typeof raw !== 'object') continue;
    normalized[moduleId] = {
      originalCrafts: nonNegativeInteger(raw.originalCrafts),
      replicationCrafts: nonNegativeInteger(raw.replicationCrafts),
      firstOriginalSequence: raw.firstOriginalSequence == null
        ? null
        : nonNegativeInteger(raw.firstOriginalSequence),
    };
  }
  // A v1 fabricated instance is proof that the original named-part route was
  // completed, so importing it unlocks replication without inventing parts.
  for (const instance of moduleInstances) {
    if (instance.origin !== 'fabricated' || !getBusterModuleDefinition(instance.moduleId)) continue;
    const entry = normalized[instance.moduleId] ?? {
      originalCrafts: 0,
      replicationCrafts: 0,
      firstOriginalSequence: null,
    };
    entry.originalCrafts = Math.max(1, entry.originalCrafts);
    if (entry.firstOriginalSequence == null) {
      entry.firstOriginalSequence = nonNegativeInteger(instance.fabricationSequence, 0);
    }
    normalized[instance.moduleId] = entry;
  }
  return normalized;
}

function sanitizeLegacyLocation(location) {
  if (location?.kind === 'megaSocket') {
    const socketIndex = Math.trunc(Number(location.socketIndex));
    if (socketIndex >= 0 && socketIndex <= 3) return { kind: 'megaSocket', socketIndex };
  }
  return { kind: 'inventory' };
}

function normalizeLegacyBusterParts(value) {
  const source = value && typeof value === 'object' ? value : {};
  const records = [];
  const ids = new Set();
  for (const raw of Array.isArray(source.records) ? source.records : []) {
    const legacyId = typeof raw?.legacyId === 'string' ? raw.legacyId : '';
    const calibrationInstanceId = typeof raw?.calibrationInstanceId === 'string'
      ? raw.calibrationInstanceId
      : '';
    if (!legacyId || !calibrationInstanceId || ids.has(legacyId)) continue;
    ids.add(legacyId);
    records.push({
      legacyId,
      legacyType: typeof raw.legacyType === 'string' ? raw.legacyType : null,
      calibrationInstanceId,
      item: plainObject(raw.item),
      location: sanitizeLegacyLocation(raw.location),
      starter: Boolean(raw.starter),
      createdSequence: nonNegativeInteger(raw.createdSequence),
    });
  }
  return {
    records,
    nextSequence: Math.max(1, nonNegativeInteger(source.nextSequence, 1)),
    starterRegistered: Boolean(source.starterRegistered),
  };
}

function sanitizeModuleInstance(module) {
  if (!module || typeof module !== 'object') return null;
  const instanceId = module.instanceId ?? module.moduleInstanceId ?? module.id;
  const moduleId = module.moduleId;
  if (typeof instanceId !== 'string' || !instanceId || typeof moduleId !== 'string' || !moduleId) {
    return null;
  }
  const recipe = getBusterRecipe(module.recipeId ?? moduleId);
  return {
    id: instanceId,
    instanceId,
    moduleInstanceId: instanceId,
    moduleId,
    recipeId: typeof module.recipeId === 'string' ? module.recipeId : recipe?.id ?? null,
    name: typeof module.name === 'string' ? module.name : recipe?.name ?? moduleId,
    origin: module.origin === 'starter'
      ? 'starter'
      : module.origin === 'debug'
        ? 'debug'
        : 'fabricated',
    fabricationRoute: module.fabricationRoute === 'replication' ? 'replication' : 'original',
    fabricationSequence: nonNegativeInteger(module.fabricationSequence),
  };
}

function sanitizeChassisInstance(chassis) {
  if (!chassis || typeof chassis !== 'object') return null;
  const chassisId = chassis.chassisId ?? chassis.instanceId ?? chassis.id;
  if (typeof chassisId !== 'string' || !chassisId) return null;
  return {
    id: chassisId,
    instanceId: chassisId,
    chassisId,
    slot: chassis.slot === 'B' ? 'B' : 'A',
    name: typeof chassis.name === 'string'
      ? chassis.name
      : chassis.slot === 'B' ? 'Build B' : 'Build A',
    origin: chassis.origin === 'starter'
      ? 'starter'
      : chassis.origin === 'debug'
        ? 'debug'
        : 'fabricated',
  };
}

function sanitizeRevision(revision) {
  if (!revision || typeof revision !== 'object') return null;
  const snapshot = sanitizeBuild(revision.snapshot ?? revision.build ?? revision);
  if (!snapshot) return null;
  const number = Math.max(1, nonNegativeInteger(revision.revision ?? revision.revisionNumber, 1));
  return {
    revisionId: typeof revision.revisionId === 'string' && revision.revisionId
      ? revision.revisionId
      : `${snapshot.buildId}-r${number}`,
    buildId: snapshot.buildId,
    chassisId: snapshot.chassisId,
    revision: number,
    snapshot,
  };
}

function starterBuild() {
  return {
    schemaVersion: 1,
    rulesetVersion: BUSTER_LAB_RULESET_VERSION,
    buildId: STARTER_BUSTER_IDS.buildId,
    chassisId: STARTER_BUSTER_IDS.chassisId,
    name: 'Build A',
    tuning: { power: 4, energy: 4, range: 4, rapid: 4 },
    program: {
      rootNodeId: STARTER_BUSTER_IDS.nodeId,
      nodes: [{
        nodeId: STARTER_BUSTER_IDS.nodeId,
        moduleId: 'pulseBolt',
        moduleInstanceId: STARTER_BUSTER_IDS.moduleInstanceId,
      }],
      edges: [],
    },
  };
}

function starterModule() {
  return {
    id: STARTER_BUSTER_IDS.moduleInstanceId,
    instanceId: STARTER_BUSTER_IDS.moduleInstanceId,
    moduleInstanceId: STARTER_BUSTER_IDS.moduleInstanceId,
    moduleId: 'pulseBolt',
    recipeId: 'pulse',
    name: 'Pulse Bolt',
    origin: 'starter',
    fabricationSequence: 0,
  };
}

function starterChassis() {
  return {
    id: STARTER_BUSTER_IDS.chassisId,
    instanceId: STARTER_BUSTER_IDS.chassisId,
    chassisId: STARTER_BUSTER_IDS.chassisId,
    slot: 'A',
    name: 'Build A',
    origin: 'starter',
  };
}

function secondChassis(origin = 'fabricated') {
  return {
    id: 'chassis-b',
    instanceId: 'chassis-b',
    chassisId: 'chassis-b',
    slot: 'B',
    name: 'Build B',
    origin,
  };
}

function secondChassisDraft() {
  return {
    schemaVersion: 1,
    rulesetVersion: BUSTER_LAB_RULESET_VERSION,
    buildId: 'build-b',
    chassisId: 'chassis-b',
    name: 'Build B',
    tuning: { power: 4, energy: 4, range: 4, rapid: 4 },
    program: { rootNodeId: null, nodes: [], edges: [] },
  };
}

export function createDefaultBossHuntState() {
  return {
    selectedBossProfileId: DEFAULT_BOSS_PROFILE_ID,
    activeExpeditionId: null,
    victoriesByProfile: {},
    recordedExpeditions: {},
    pendingRecoveries: [],
    fallbackFromProfileId: null,
    quarantinedRecoveryCount: 0,
  };
}

export function createDefaultBusterLabState() {
  const build = starterBuild();
  return {
    version: BUSTER_LAB_STORAGE_VERSION,
    rollSalvage: { identifiedScrap: 0, parts: {} },
    discovery: { salvageTypes: [], history: [], recipeHistory: {} },
    moduleInstances: [starterModule()],
    chassisInstances: [starterChassis()],
    chassisBuilds: [cloneJson(build)],
    chassisDrafts: [cloneJson(build)],
    chassisRevisions: [{
      revisionId: `${STARTER_BUSTER_IDS.buildId}-r1`,
      buildId: STARTER_BUSTER_IDS.buildId,
      chassisId: STARTER_BUSTER_IDS.chassisId,
      revision: 1,
      snapshot: cloneJson(build),
    }],
    assignments: { slots: { 1: null, 2: null } },
    blueprints: [],
    nextBlueprintId: 1,
    fabricationHistory: {},
    megaCalibrations: {
      instances: [],
      slots: [null, null, null, null],
      nextInstanceId: 1,
      revision: 1,
    },
    legacyBusterParts: {
      records: [],
      nextSequence: 1,
      starterRegistered: false,
    },
    bossHunts: createDefaultBossHuntState(),
    migrations: {
      starterChassisGranted: true,
      applied: ['buster-lab-v1', 'starter-build-a-v1', 'buster-lab-state-v2'],
    },
    nextInstanceId: 1,
  };
}

function refreshRecipeHistory(discovery) {
  const recipeHistory = plainObject(discovery.recipeHistory);
  for (const recipe of BUSTER_RECIPE_LIST) {
    const reveal = getRecipeDiscoveryState(recipe, discovery);
    const existing = recipeHistory[recipe.id] && typeof recipeHistory[recipe.id] === 'object'
      ? recipeHistory[recipe.id]
      : null;
    if (!reveal.discovered && !existing) continue;
    const firstSequence = discovery.history
      .filter((entry) => recipe.requiredPartIds.includes(entry.partId))
      .reduce((earliest, entry) => Math.min(earliest, entry.sequence), Number.POSITIVE_INFINITY);
    const fullSequence = reveal.fullyDiscovered
      ? Math.max(...recipe.requiredPartIds.map((partId) => (
        discovery.history.find((entry) => entry.partId === partId)?.sequence ?? 0
      )))
      : null;
    recipeHistory[recipe.id] = {
      recipeId: recipe.id,
      highestLevel: reveal.fullyDiscovered ? 'full' : existing?.highestLevel ?? 'hinted',
      firstDiscoveredSequence: existing?.firstDiscoveredSequence
        ?? (Number.isFinite(firstSequence) ? firstSequence : null),
      fullyDiscoveredSequence: existing?.fullyDiscoveredSequence ?? fullSequence,
    };
  }
  discovery.recipeHistory = recipeHistory;
  return discovery;
}

function sanitizeRollState(rawState, rawDiscovery = {}) {
  const roll = new RollSalvageStorage({
    ...(rawState && typeof rawState === 'object' ? rawState : {}),
    discoveredSalvageTypes: rawDiscovery.salvageTypes
      ?? rawState?.discoveredSalvageTypes
      ?? [],
    discoveryHistory: rawDiscovery.history
      ?? rawState?.discoveryHistory
      ?? [],
  });
  const serialized = roll.serialize();
  return {
    rollSalvage: {
      identifiedScrap: serialized.identifiedScrap,
      parts: serialized.parts,
    },
    discovery: refreshRecipeHistory({
      salvageTypes: serialized.discoveredSalvageTypes,
      history: serialized.discoveryHistory,
      recipeHistory: plainObject(rawDiscovery.recipeHistory),
    }),
  };
}

function legacyMappedState(raw) {
  return {
    version: BUSTER_LAB_STORAGE_VERSION,
    rollSalvage: raw.rollSalvage ?? raw.roll ?? raw.salvage ?? {},
    discovery: raw.discovery ?? {
      salvageTypes: raw.discoveredSalvageTypes ?? [],
      history: raw.discoveryHistory ?? [],
      recipeHistory: raw.recipeDiscoveryHistory ?? {},
    },
    moduleInstances: raw.moduleInstances ?? raw.modules ?? [],
    chassisInstances: raw.chassisInstances ?? raw.chassis ?? [],
    chassisBuilds: raw.chassisBuilds ?? raw.builds ?? [],
    chassisDrafts: raw.chassisDrafts ?? raw.drafts ?? [],
    chassisRevisions: raw.chassisRevisions ?? raw.revisions ?? [],
    assignments: raw.assignments ?? {},
    blueprints: raw.blueprints ?? [],
    nextBlueprintId: raw.nextBlueprintId ?? 1,
    fabricationHistory: raw.fabricationHistory ?? {},
    megaCalibrations: raw.megaCalibrations ?? raw.calibrations ?? {},
    legacyBusterParts: raw.legacyBusterParts ?? {},
    bossHunts: raw.bossHunts ?? {},
    migrations: raw.migrations ?? {},
    nextInstanceId: raw.nextInstanceId ?? 1,
  };
}

function normalizeAssignments(assignments) {
  const normalized = plainObject(assignments);
  const legacyEquippedBuildId = typeof normalized.equippedBuildId === 'string'
    ? normalized.equippedBuildId
    : null;
  const rawSlots = plainObject(normalized.slots);
  const ownsSlot1 = Object.prototype.hasOwnProperty.call(rawSlots, '1');
  const ownsSlot2 = Object.prototype.hasOwnProperty.call(rawSlots, '2');
  const slots = {
    1: ownsSlot1 ? (typeof rawSlots['1'] === 'string' ? rawSlots['1'] : null) : legacyEquippedBuildId,
    2: ownsSlot2 ? (typeof rawSlots['2'] === 'string' ? rawSlots['2'] : null) : null,
  };
  return { slots };
}

function normalizeMegaCalibrations(calibrations) {
  const source = Array.isArray(calibrations)
    ? { slots: calibrations }
    : calibrations && typeof calibrations === 'object'
      ? calibrations
      : {};
  const instances = (Array.isArray(source.instances) ? source.instances : [])
    .filter((instance) => instance && typeof instance === 'object')
    .map((instance) => {
      const instanceId = typeof instance.instanceId === 'string'
        ? instance.instanceId
        : typeof instance.id === 'string'
          ? instance.id
          : '';
      if (!instanceId) return null;
      return {
        instanceId,
        legacyType: typeof instance.legacyType === 'string' ? instance.legacyType : null,
        name: typeof instance.name === 'string' ? instance.name : instance.legacyType ?? instanceId,
        bonuses: Object.fromEntries(Object.entries(plainObject(instance.bonuses))
          .filter(([, value]) => Number.isFinite(Number(value)))
          .map(([stat, value]) => [stat, Number(value)])),
      };
    })
    .filter(Boolean);
  const rawSlots = Array.isArray(source.slots) ? source.slots : [];
  const slots = Array.from({ length: 4 }, (_, index) => (
    typeof rawSlots[index] === 'string' && rawSlots[index] ? rawSlots[index] : null
  ));
  return {
    instances,
    slots,
    nextInstanceId: Math.max(1, nonNegativeInteger(source.nextInstanceId, 1)),
    revision: Math.max(1, nonNegativeInteger(source.revision, 1)),
  };
}

function sanitizeBossRecoveryPart(part) {
  if (!part || typeof part !== 'object' || typeof part.id !== 'string' || !part.id) return null;
  return {
    id: part.id,
    name: typeof part.name === 'string' ? part.name : part.id,
    family: typeof part.family === 'string' ? part.family : 'Reaverbot Part',
    aspect: typeof part.aspect === 'string' ? part.aspect : null,
    tier: typeof part.tier === 'string' ? part.tier : 'common',
    color: typeof part.color === 'string' ? part.color : '#c7d0d6',
    description: typeof part.description === 'string' ? part.description : '',
    craftingTags: Array.isArray(part.craftingTags) ? cloneJson(part.craftingTags, []) : [],
    exampleUses: Array.isArray(part.exampleUses) ? cloneJson(part.exampleUses, []) : [],
    quantity: 1,
    source: plainObject(part.source),
  };
}

function sanitizeRecordedBossExpedition(raw, fallbackExpeditionId = '') {
  if (!raw || typeof raw !== 'object') return null;
  const expeditionId = typeof raw.expeditionId === 'string' && raw.expeditionId
    ? raw.expeditionId
    : fallbackExpeditionId;
  if (!expeditionId) return null;
  const rawProfileId = typeof raw.bossProfileId === 'string' ? raw.bossProfileId : '';
  if (!getReaverbotBossProfile(rawProfileId)) return null;
  const bossProfileId = rawProfileId;
  const status = ['active', 'victory', 'defeat', 'abandoned'].includes(raw.status)
    ? raw.status
    : raw.completed
      ? 'victory'
      : 'active';
  const reward = raw.reward && typeof raw.reward === 'object'
    ? {
      eligible: Boolean(raw.reward.eligible),
      queued: Boolean(raw.reward.queued),
      recoveryId: typeof raw.reward.recoveryId === 'string' ? raw.reward.recoveryId : null,
      deterministicRoll: Number.isFinite(Number(raw.reward.deterministicRoll))
        ? Number(raw.reward.deterministicRoll)
        : null,
      reason: typeof raw.reward.reason === 'string' ? raw.reward.reason : null,
      identified: Boolean(raw.reward.identified),
    }
    : null;
  return {
    expeditionId,
    bossProfileId,
    invalidBossProfileId: rawProfileId && !getReaverbotBossProfile(rawProfileId)
      ? rawProfileId
      : null,
    seed: typeof raw.seed === 'string' || Number.isFinite(Number(raw.seed)) ? raw.seed : null,
    depth: Math.max(1, nonNegativeInteger(raw.depth, 1)),
    status,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : null,
    victoryIndex: status === 'victory' ? Math.max(1, nonNegativeInteger(raw.victoryIndex, 1)) : null,
    signaturePartOverloaded: Boolean(raw.signaturePartOverloaded),
    reward,
  };
}

function normalizeBossHunts(value) {
  const source = value && typeof value === 'object' ? value : {};
  const rawSelected = typeof source.selectedBossProfileId === 'string'
    ? source.selectedBossProfileId
    : DEFAULT_BOSS_PROFILE_ID;
  const selectedBossProfileId = normalizeBossProfileId(rawSelected);

  const victoriesByProfile = {};
  for (const [rawProfileId, rawCount] of Object.entries(plainObject(source.victoriesByProfile))) {
    if (!getReaverbotBossProfile(rawProfileId)) continue;
    const count = nonNegativeInteger(rawCount);
    if (count > 0) victoriesByProfile[rawProfileId] = count;
  }

  const recordedExpeditions = {};
  let quarantinedBossProfileId = null;
  const recordedSource = Array.isArray(source.recordedExpeditions)
    ? source.recordedExpeditions.map((entry) => [entry?.expeditionId, entry])
    : Object.entries(plainObject(source.recordedExpeditions));
  for (const [key, raw] of recordedSource) {
    const rawProfileId = typeof raw?.bossProfileId === 'string' ? raw.bossProfileId : '';
    if (rawProfileId && !getReaverbotBossProfile(rawProfileId)) {
      quarantinedBossProfileId ??= rawProfileId;
      continue;
    }
    const record = sanitizeRecordedBossExpedition(raw, typeof key === 'string' ? key : '');
    if (!record || recordedExpeditions[record.expeditionId]) continue;
    recordedExpeditions[record.expeditionId] = record;
  }

  const pendingRecoveries = [];
  const recoveryIds = new Set();
  let quarantinedRecoveryCount = nonNegativeInteger(source.quarantinedRecoveryCount);
  for (const raw of Array.isArray(source.pendingRecoveries) ? source.pendingRecoveries : []) {
    const recoveryId = typeof raw?.recoveryId === 'string' && raw.recoveryId
      ? raw.recoveryId
      : '';
    const expeditionId = typeof raw?.expeditionId === 'string' && raw.expeditionId
      ? raw.expeditionId
      : '';
    const rawProfileId = typeof raw?.bossProfileId === 'string' ? raw.bossProfileId : '';
    const bossProfile = getReaverbotBossProfile(rawProfileId);
    if (!bossProfile) {
      quarantinedBossProfileId ??= rawProfileId || 'unknown-recovery-profile';
      quarantinedRecoveryCount += 1;
      continue;
    }
    const recorded = recordedExpeditions[expeditionId];
    const canonicalPart = resolveBossFeaturedMaterial(rawProfileId);
    const part = sanitizeBossRecoveryPart(raw?.part ?? raw?.recoverableParts?.[0]);
    if (!recoveryId
      || !expeditionId
      || !part
      || !canonicalPart
      || part.id !== canonicalPart.id
      || recoveryIds.has(recoveryId)
      || !recorded
      || recorded.status !== 'victory'
      || recorded.bossProfileId !== rawProfileId
      || recorded.reward?.recoveryId !== recoveryId
      || !recorded.reward?.eligible) {
      quarantinedRecoveryCount += 1;
      continue;
    }
    recoveryIds.add(recoveryId);
    pendingRecoveries.push({
      recoveryId,
      expeditionId,
      bossProfileId: rawProfileId,
      victoryIndex: Math.max(1, nonNegativeInteger(raw.victoryIndex, 1)),
      signaturePartOverloaded: Boolean(raw.signaturePartOverloaded),
      deterministicRoll: Number.isFinite(Number(raw.deterministicRoll))
        ? Number(raw.deterministicRoll)
        : null,
      queuedAt: typeof raw.queuedAt === 'string' ? raw.queuedAt : null,
      quantity: 1,
      part: {
        ...cloneJson(canonicalPart),
        quantity: 1,
        source: {
          ...plainObject(canonicalPart.source),
          ...plainObject(part.source),
        },
      },
    });
  }

  const requestedActiveId = typeof source.activeExpeditionId === 'string'
    ? source.activeExpeditionId
    : null;
  const activeExpeditionId = requestedActiveId
    && recordedExpeditions[requestedActiveId]?.status === 'active'
    ? requestedActiveId
    : Object.values(recordedExpeditions).find((entry) => entry.status === 'active')?.expeditionId ?? null;

  return {
    selectedBossProfileId,
    activeExpeditionId,
    victoriesByProfile,
    recordedExpeditions,
    pendingRecoveries,
    fallbackFromProfileId: rawSelected !== selectedBossProfileId
      ? rawSelected
      : quarantinedBossProfileId,
    quarantinedRecoveryCount,
  };
}

function sanitizeState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const normalizedRoll = sanitizeRollState(source.rollSalvage, source.discovery);
  const moduleInstances = (Array.isArray(source.moduleInstances) ? source.moduleInstances : [])
    .map(sanitizeModuleInstance)
    .filter(Boolean);
  const chassisInstances = (Array.isArray(source.chassisInstances) ? source.chassisInstances : [])
    .map(sanitizeChassisInstance)
    .filter(Boolean);
  const chassisBuilds = (Array.isArray(source.chassisBuilds) ? source.chassisBuilds : [])
    .map(sanitizeBuild)
    .filter(Boolean);
  const chassisDrafts = (Array.isArray(source.chassisDrafts) ? source.chassisDrafts : [])
    .map(sanitizeBuild)
    .filter(Boolean);
  const chassisRevisions = (Array.isArray(source.chassisRevisions) ? source.chassisRevisions : [])
    .map(sanitizeRevision)
    .filter(Boolean);
  const blueprints = normalizeBlueprints(source.blueprints);

  return {
    version: BUSTER_LAB_STORAGE_VERSION,
    rollSalvage: normalizedRoll.rollSalvage,
    discovery: normalizedRoll.discovery,
    moduleInstances,
    chassisInstances,
    chassisBuilds,
    chassisDrafts,
    chassisRevisions,
    assignments: normalizeAssignments(source.assignments),
    blueprints,
    nextBlueprintId: Math.max(1, nonNegativeInteger(source.nextBlueprintId, 1)),
    fabricationHistory: normalizeFabricationHistory(source.fabricationHistory, moduleInstances),
    megaCalibrations: normalizeMegaCalibrations(source.megaCalibrations),
    legacyBusterParts: normalizeLegacyBusterParts(source.legacyBusterParts),
    bossHunts: normalizeBossHunts(source.bossHunts),
    migrations: plainObject(source.migrations),
    nextInstanceId: Math.max(1, nonNegativeInteger(source.nextInstanceId, 1)),
  };
}

function applyStarterMigration(state) {
  if (state.migrations.starterChassisGranted) return state;

  const build = starterBuild();
  if (!state.chassisInstances.some((entry) => entry.chassisId === STARTER_BUSTER_IDS.chassisId)) {
    if (state.chassisInstances.length >= MAX_BUSTER_CHASSIS) {
      throw new RangeError('The legacy Buster Lab has no room for its starter chassis.');
    }
    state.chassisInstances.push(starterChassis());
  }
  if (!state.moduleInstances.some((module) => module.instanceId === STARTER_BUSTER_IDS.moduleInstanceId)) {
    state.moduleInstances.push(starterModule());
  }
  if (!state.chassisBuilds.some((entry) => entry.buildId === STARTER_BUSTER_IDS.buildId)) {
    state.chassisBuilds.push(cloneJson(build));
  }
  if (!state.chassisDrafts.some((entry) => entry.buildId === STARTER_BUSTER_IDS.buildId)) {
    state.chassisDrafts.push(cloneJson(build));
  }
  if (!state.chassisRevisions.some((entry) => (
    entry.buildId === STARTER_BUSTER_IDS.buildId && entry.revision === 1
  ))) {
    state.chassisRevisions.push({
      revisionId: `${STARTER_BUSTER_IDS.buildId}-r1`,
      buildId: STARTER_BUSTER_IDS.buildId,
      chassisId: STARTER_BUSTER_IDS.chassisId,
      revision: 1,
      snapshot: cloneJson(build),
    });
  }
  state.migrations.starterChassisGranted = true;
  const applied = Array.isArray(state.migrations.applied) ? state.migrations.applied : [];
  state.migrations.applied = [...new Set([...applied, 'buster-lab-v1', 'starter-build-a-v1'])];
  return state;
}

function getUnknownModuleIds(build) {
  return [...new Set((build?.program?.nodes ?? [])
    .map((node) => node.moduleId)
    .filter((moduleId) => moduleId && !getBusterModuleDefinition(moduleId)))];
}

function quarantineUnknownSavedBuilds(state) {
  const quarantined = [];
  const retainedBuilds = [];
  for (const build of state.chassisBuilds) {
    const unknownModuleIds = getUnknownModuleIds(build);
    if (unknownModuleIds.length === 0) {
      retainedBuilds.push(build);
      continue;
    }
    quarantined.push({ buildId: build.buildId, unknownModuleIds });
    const draftIndex = state.chassisDrafts.findIndex((entry) => entry.buildId === build.buildId);
    if (draftIndex >= 0) state.chassisDrafts[draftIndex] = cloneJson(build);
    else state.chassisDrafts.push(cloneJson(build));
  }
  if (quarantined.length === 0) return state;

  state.chassisBuilds = retainedBuilds;
  const quarantinedIds = new Set(quarantined.map((entry) => entry.buildId));
  for (const slot of ['1', '2']) {
    if (quarantinedIds.has(state.assignments.slots[slot])) state.assignments.slots[slot] = null;
  }
  state.migrations.unknownModuleQuarantine = quarantined;
  return state;
}

function stripPhysicalInstanceFromAfterDelayNodes(build) {
  if (!build?.program?.nodes) return;
  for (const node of build.program.nodes) {
    if (node.moduleId === 'afterDelay') node.moduleInstanceId = null;
  }
}

function applyAfterDelayBuiltInMigration(state) {
  if (state.migrations?.afterDelayBuiltInV2?.completed) return state;
  const removed = state.moduleInstances.filter((entry) => entry.moduleId === 'afterDelay');
  const fabricatedRefunded = removed.filter((entry) => entry.origin === 'fabricated').length;
  const debugRemoved = removed.filter((entry) => entry.origin === 'debug').length;
  state.moduleInstances = state.moduleInstances.filter((entry) => entry.moduleId !== 'afterDelay');

  for (const collection of [state.chassisBuilds, state.chassisDrafts]) {
    for (const build of collection) stripPhysicalInstanceFromAfterDelayNodes(build);
  }
  for (const revision of state.chassisRevisions) stripPhysicalInstanceFromAfterDelayNodes(revision.snapshot);
  for (const blueprint of state.blueprints ?? []) stripPhysicalInstanceFromAfterDelayNodes(blueprint);

  if (fabricatedRefunded > 0) {
    state.rollSalvage.identifiedScrap += LEGACY_AFTER_DELAY_RECIPE.scrapCost * fabricatedRefunded;
    const partId = 'clusterBurstSequencer';
    const existing = state.rollSalvage.parts[partId] ?? {
      id: partId,
      name: 'Cluster Burst Sequencer',
      family: 'Reaverbot Part',
      aspect: null,
      tier: 'common',
      color: '#c7d0d6',
      description: '',
      craftingTags: [],
      exampleUses: [],
      quantity: 0,
      lastSource: null,
    };
    existing.quantity += fabricatedRefunded;
    state.rollSalvage.parts[partId] = existing;
    if (!state.discovery.salvageTypes.includes(partId)) {
      state.discovery.salvageTypes.push(partId);
      state.discovery.history.push({
        partId,
        name: existing.name,
        sequence: state.discovery.history.length + 1,
        source: { migration: 'after-delay-built-in-v2' },
      });
    }
  }

  state.discovery.recipeHistory.afterDelay = {
    ...(state.discovery.recipeHistory.afterDelay ?? {}),
    recipeId: 'afterDelay',
    retired: true,
    retirementReason: 'built-in-v0.2',
  };
  state.migrations.afterDelayBuiltInV2 = {
    completed: true,
    totalRemoved: removed.length,
    fabricatedRefunded,
    debugRemoved,
    refundedScrap: LEGACY_AFTER_DELAY_RECIPE.scrapCost * fabricatedRefunded,
    refundedParts: fabricatedRefunded > 0 ? { clusterBurstSequencer: fabricatedRefunded } : {},
  };
  const applied = Array.isArray(state.migrations.applied) ? state.migrations.applied : [];
  state.migrations.applied = [...new Set([...applied, 'after-delay-built-in-v2'])];
  return state;
}

export function migrateBusterLabState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Buster Lab save is not an object.');
  }
  const rawVersion = raw.version ?? raw.storageVersion ?? 0;
  const version = nonNegativeInteger(rawVersion);
  if (version > BUSTER_LAB_STORAGE_VERSION) {
    throw new RangeError(`Buster Lab save version ${version} is newer than supported version ${BUSTER_LAB_STORAGE_VERSION}.`);
  }
  const mapped = version < BUSTER_LAB_STORAGE_VERSION ? legacyMappedState(raw) : raw;
  const state = quarantineUnknownSavedBuilds(
    applyAfterDelayBuiltInMigration(applyStarterMigration(sanitizeState(mapped))),
  );
  if (version < BUSTER_LAB_STORAGE_VERSION
    && !state.migrations.unlinkedLegacyCalibrationsV2) {
    const linked = new Set((state.legacyBusterParts?.records ?? [])
      .map((record) => record.calibrationInstanceId));
    const unlinkedIds = state.megaCalibrations.instances
      .map((instance) => instance.instanceId)
      .filter((instanceId) => !linked.has(instanceId));
    state.migrations.unlinkedLegacyCalibrationsV2 = {
      permanent: true,
      count: unlinkedIds.length,
      instanceIds: unlinkedIds,
      reason: 'v1-destructive-conversion-had-no-authoritative-item-snapshot',
    };
  }
  return state;
}

function validateBuildGraph(build) {
  const errors = [];
  if (!build.program.rootNodeId) errors.push(`Saved build ${build.buildId} has no root node.`);
  const nodeIds = new Set();
  for (const node of build.program.nodes) {
    if (!node.nodeId || nodeIds.has(node.nodeId)) errors.push(`Saved build ${build.buildId} has an invalid or duplicate node id.`);
    nodeIds.add(node.nodeId);
    if (!node.moduleId) errors.push(`Saved build ${build.buildId} has a node without a module id.`);
    if (!NON_PHYSICAL_BUILTIN_MODULE_IDS.has(node.moduleId) && !node.moduleInstanceId) {
      errors.push(`Saved build ${build.buildId} has a node without a physical module instance.`);
    }
  }
  if (build.program.rootNodeId && !nodeIds.has(build.program.rootNodeId)) {
    errors.push(`Saved build ${build.buildId} root node does not exist.`);
  }
  return errors;
}

export function validateBusterLabState(state) {
  const errors = [];
  if (!state || typeof state !== 'object') return ['Buster Lab state is missing.'];
  if (state.chassisInstances.length > MAX_BUSTER_CHASSIS) {
    errors.push(`Only ${MAX_BUSTER_CHASSIS} physical Buster chassis may exist.`);
  }
  if ((state.blueprints?.length ?? 0) > MAX_BUSTER_BLUEPRINTS) {
    errors.push(`Only ${MAX_BUSTER_BLUEPRINTS} ownership-free blueprints may be stored.`);
  }
  const blueprintIds = new Set();
  for (const blueprint of state.blueprints ?? []) {
    if (!blueprint.blueprintId || blueprintIds.has(blueprint.blueprintId)) {
      errors.push('Blueprint ids must be non-empty and unique.');
    }
    blueprintIds.add(blueprint.blueprintId);
    if (blueprint.program.nodes.some((node) => node.moduleInstanceId)) {
      errors.push(`Blueprint ${blueprint.blueprintId} contains a physical module assignment.`);
    }
  }
  if (state.migrations.starterChassisGranted) {
    const quarantinedBuildIds = new Set((state.migrations.unknownModuleQuarantine ?? [])
      .map((entry) => entry?.buildId)
      .filter(Boolean));
    if (!state.chassisInstances.some((entry) => entry.chassisId === STARTER_BUSTER_IDS.chassisId)) {
      errors.push('Starter chassis migration is marked complete, but chassis-a is missing.');
    }
    if (!state.moduleInstances.some((entry) => entry.instanceId === STARTER_BUSTER_IDS.moduleInstanceId)) {
      errors.push('Starter chassis migration is marked complete, but its Pulse Bolt is missing.');
    }
    if (!state.chassisBuilds.some((entry) => entry.buildId === STARTER_BUSTER_IDS.buildId)
      && !quarantinedBuildIds.has(STARTER_BUSTER_IDS.buildId)) {
      errors.push('Starter chassis migration is marked complete, but Build A is missing.');
    }
    if (!state.chassisDrafts.some((entry) => entry.buildId === STARTER_BUSTER_IDS.buildId)) {
      errors.push('Starter chassis migration is marked complete, but the Build A draft is missing.');
    }
    if (!state.chassisRevisions.some((entry) => (
      entry.buildId === STARTER_BUSTER_IDS.buildId && entry.revision === 1
    ))) {
      errors.push('Starter chassis migration is marked complete, but revision 1 is missing.');
    }
  }

  const moduleIds = new Set();
  const modulesById = new Map();
  for (const module of state.moduleInstances) {
    if (moduleIds.has(module.instanceId)) errors.push(`Duplicate module instance ${module.instanceId}.`);
    moduleIds.add(module.instanceId);
    modulesById.set(module.instanceId, module);
    const recipe = getBusterRecipe(module.moduleId);
    if (recipe && module.recipeId && module.recipeId !== recipe.id) {
      errors.push(`Physical module ${module.instanceId} has mismatched recipe id ${module.recipeId}.`);
    }
  }
  const chassisIds = new Set();
  for (const chassis of state.chassisInstances) {
    if (chassisIds.has(chassis.chassisId)) errors.push(`Duplicate chassis instance ${chassis.chassisId}.`);
    chassisIds.add(chassis.chassisId);
  }

  const buildIds = new Set();
  const buildChassisIds = new Set();
  const claimedByModule = new Map();
  for (const build of state.chassisBuilds) {
    if (buildIds.has(build.buildId)) errors.push(`Duplicate saved build ${build.buildId}.`);
    buildIds.add(build.buildId);
    if (!chassisIds.has(build.chassisId)) errors.push(`Saved build ${build.buildId} has no physical chassis.`);
    if (buildChassisIds.has(build.chassisId)) errors.push(`Physical chassis ${build.chassisId} is used by multiple saved builds.`);
    buildChassisIds.add(build.chassisId);
    errors.push(...validateBuildGraph(build));
    const claimedByOtherBuilds = state.chassisBuilds
      .filter((other) => other !== build)
      .flatMap((other) => other.program.nodes)
      .filter((node) => !NON_PHYSICAL_BUILTIN_MODULE_IDS.has(node.moduleId))
      .map((node) => node.moduleInstanceId)
      .filter(Boolean);
    const compilerValidation = validateBusterBuild(build, {
      context: {
        ownedModuleInstanceIds: moduleIds,
        claimedModuleInstanceIds: claimedByOtherBuilds,
      },
    });
    for (const error of compilerValidation.errors) {
      errors.push(`Saved build ${build.buildId}: ${error.message}`);
    }
    const localClaims = new Set();
    for (const node of build.program.nodes) {
      const instanceId = node.moduleInstanceId;
      if (NON_PHYSICAL_BUILTIN_MODULE_IDS.has(node.moduleId)) continue;
      if (!instanceId) continue;
      if (!moduleIds.has(instanceId)) errors.push(`Saved build ${build.buildId} does not own module ${instanceId}.`);
      const physicalModule = modulesById.get(instanceId);
      if (physicalModule && physicalModule.moduleId !== node.moduleId) {
        errors.push(`Saved build ${build.buildId} uses ${instanceId} as ${node.moduleId}, but the physical module is ${physicalModule.moduleId}.`);
      }
      if (localClaims.has(instanceId)) errors.push(`Saved build ${build.buildId} reuses physical module ${instanceId}.`);
      localClaims.add(instanceId);
      const otherBuild = claimedByModule.get(instanceId);
      if (otherBuild && otherBuild !== build.buildId) {
        errors.push(`Physical module ${instanceId} is already installed in saved build ${otherBuild}.`);
      } else {
        claimedByModule.set(instanceId, build.buildId);
      }
    }
  }
  if (state.chassisBuilds.length > state.chassisInstances.length) {
    errors.push('There are more saved builds than physical chassis.');
  }

  const slots = plainObject(state.assignments.slots, { 1: null, 2: null });
  for (const slot of ['1', '2']) {
    const buildId = slots[slot] ?? null;
    if (buildId !== null && (typeof buildId !== 'string' || !buildIds.has(buildId))) {
      errors.push(`Arm hotbar slot ${slot} does not reference a valid saved build.`);
    }
  }
  const assignedBuildIds = Object.values(slots).filter(Boolean);
  if (new Set(assignedBuildIds).size !== assignedBuildIds.length) {
    errors.push('One physical Buster build cannot occupy both arm hotbar slots.');
  }
  const calibrationInstanceIds = new Set(state.megaCalibrations.instances.map((entry) => entry.instanceId));
  if (calibrationInstanceIds.size !== state.megaCalibrations.instances.length) {
    errors.push('Mega Buster calibration instance ids must be unique.');
  }
  for (const instanceId of state.megaCalibrations.slots) {
    if (instanceId !== null && !calibrationInstanceIds.has(instanceId)) {
      errors.push(`Mega Buster calibration slot references missing instance ${instanceId}.`);
    }
  }
  const installedCalibrationIds = state.megaCalibrations.slots.filter(Boolean);
  if (new Set(installedCalibrationIds).size !== installedCalibrationIds.length) {
    errors.push('One physical Mega calibration cannot occupy multiple sockets.');
  }
  const calibrationRatings = { power: 4, energy: 4, range: 4, rapid: 4 };
  for (const instanceId of installedCalibrationIds) {
    const instance = state.megaCalibrations.instances.find((entry) => entry.instanceId === instanceId);
    for (const [stat, amount] of Object.entries(instance?.bonuses ?? {})) {
      if (Object.hasOwn(calibrationRatings, stat)) calibrationRatings[stat] += Number(amount) || 0;
    }
  }
  if (Object.values(calibrationRatings).some((rating) => rating < 1 || rating > 10)) {
    errors.push('Installed Mega calibrations must keep every rating between 1 and 10.');
  }
  const legacyRecords = state.legacyBusterParts?.records ?? [];
  if (legacyRecords.filter((entry) => entry.location?.kind === 'inventory').length
    > LEGACY_BUSTER_INVENTORY_CAPACITY) {
    errors.push(`Legacy Buster shadow inventory exceeds ${LEGACY_BUSTER_INVENTORY_CAPACITY} records.`);
  }
  const legacyIds = new Set();
  const linkedCalibrationIds = new Set();
  const occupiedLegacySockets = new Set();
  for (const record of legacyRecords) {
    if (legacyIds.has(record.legacyId)) errors.push(`Duplicate legacy Buster record ${record.legacyId}.`);
    legacyIds.add(record.legacyId);
    if (linkedCalibrationIds.has(record.calibrationInstanceId)) {
      errors.push(`Calibration ${record.calibrationInstanceId} is linked to multiple legacy Buster records.`);
    }
    linkedCalibrationIds.add(record.calibrationInstanceId);
    const calibration = state.megaCalibrations.instances.find((entry) => (
      entry.instanceId === record.calibrationInstanceId
    ));
    if (!calibration) {
      errors.push(`Legacy Buster record ${record.legacyId} has no linked calibration.`);
      continue;
    }
    if (record.legacyType && calibration.legacyType !== record.legacyType) {
      errors.push(`Legacy Buster record ${record.legacyId} has a mismatched calibration type.`);
    }
    if (record.location?.kind === 'megaSocket') {
      const socketIndex = record.location.socketIndex;
      if (occupiedLegacySockets.has(socketIndex)) errors.push(`Multiple legacy Buster records use socket ${socketIndex}.`);
      occupiedLegacySockets.add(socketIndex);
      if (state.megaCalibrations.slots[socketIndex] !== record.calibrationInstanceId) {
        errors.push(`Legacy Buster record ${record.legacyId} is not reciprocally linked to socket ${socketIndex}.`);
      }
    } else if (state.megaCalibrations.slots.includes(record.calibrationInstanceId)) {
      errors.push(`Inventory legacy Buster record ${record.legacyId} has an installed calibration.`);
    }
  }
  const bossHunts = state.bossHunts;
  if (!bossHunts || !getReaverbotBossProfile(bossHunts.selectedBossProfileId)) {
    errors.push('Boss Hunt selection must reference a known boss profile.');
  } else {
    for (const [profileId, victories] of Object.entries(bossHunts.victoriesByProfile ?? {})) {
      if (!getReaverbotBossProfile(profileId) || nonNegativeInteger(victories) !== victories) {
        errors.push(`Boss Hunt victories for ${profileId} are invalid.`);
      }
    }
    const recoveryIds = new Set();
    for (const recovery of bossHunts.pendingRecoveries ?? []) {
      if (!recovery.recoveryId || recoveryIds.has(recovery.recoveryId)) {
        errors.push('Pending Boss Recovery ids must be non-empty and unique.');
      }
      recoveryIds.add(recovery.recoveryId);
      if (!bossHunts.recordedExpeditions?.[recovery.expeditionId]) {
        errors.push(`Boss Recovery ${recovery.recoveryId} has no recorded expedition.`);
      }
      const recoveryProfile = getReaverbotBossProfile(recovery.bossProfileId);
      const canonicalPart = recoveryProfile
        ? resolveBossFeaturedMaterial(recovery.bossProfileId)
        : null;
      const recorded = bossHunts.recordedExpeditions?.[recovery.expeditionId];
      if (!recoveryProfile
        || recovery.part?.id !== canonicalPart?.id
        || recorded?.bossProfileId !== recovery.bossProfileId
        || recorded?.status !== 'victory'
        || recorded?.reward?.recoveryId !== recovery.recoveryId
        || !recorded?.reward?.eligible) {
        errors.push(`Boss Recovery ${recovery.recoveryId} has invalid material metadata.`);
      }
    }
    if (bossHunts.activeExpeditionId) {
      const active = bossHunts.recordedExpeditions?.[bossHunts.activeExpeditionId];
      if (!active || active.status !== 'active') {
        errors.push('Active Boss Hunt expedition must reference an active recorded expedition.');
      }
    }
  }
  return errors;
}

export class BusterLabValidationError extends Error {
  constructor(errors) {
    super(errors.join(' '));
    this.name = 'BusterLabValidationError';
    this.errors = [...errors];
  }
}

export class BusterLabOperationError extends Error {
  constructor(reason, result = null) {
    super(result?.error?.message ?? `Buster Lab operation failed: ${reason}.`);
    this.name = 'BusterLabOperationError';
    this.busterReason = reason || 'operation-failed';
    this.result = result;
  }
}

export function getClaimedModuleInstanceIds(state, { excludeBuildId = null } = {}) {
  return [...new Set((state?.chassisBuilds ?? [])
    .filter((build) => build.buildId !== excludeBuildId)
    .flatMap((build) => build.program?.nodes ?? [])
    .filter((node) => !NON_PHYSICAL_BUILTIN_MODULE_IDS.has(node.moduleId))
    .map((node) => node.moduleInstanceId)
    .filter(Boolean))];
}

function attachWarning(state, warning) {
  if (!state || !warning) return state;
  Object.defineProperty(state, 'warning', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: warning,
  });
  return state;
}

function resolveDefaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function resolveDefaultStorageEventTarget() {
  try {
    return typeof globalThis.window?.addEventListener === 'function'
      ? globalThis.window
      : null;
  } catch {
    return null;
  }
}

export class BusterLabStorage {
  constructor({
    storage = resolveDefaultStorage(),
    idFactory = null,
    saveContextId = null,
    lockManager = undefined,
    lockTimeoutMs = 5_000,
    storageEventTarget = undefined,
  } = {}) {
    this.storage = storage;
    this.idFactory = typeof idFactory === 'function' ? idFactory : null;
    const context = resolveSaveContext(storage, { saveContextId, idFactory: this.idFactory });
    this.saveContextId = context.saveContextId;
    this.storageKeys = getBusterLabStorageKeys(this.saveContextId);
    this.lockName = getBusterLabLockName(this.saveContextId);
    this.lockManager = resolveBusterLabLockManager(lockManager);
    this.lockTimeoutMs = Math.max(1, Math.trunc(Number(lockTimeoutMs)) || 5_000);
    this._lockUnavailable = Boolean(storage && !this.lockManager
      && (lockManager === null || typeof globalThis.window !== 'undefined'));
    this.readOnly = this._lockUnavailable;
    this.writePauseReason = this._lockUnavailable ? 'lock-unavailable' : null;
    this.conflict = null;
    this.storageEventTarget = storageEventTarget === undefined
      ? resolveDefaultStorageEventTarget()
      : storageEventTarget;
    this._boundStorageEvent = (event) => this._handleStorageEvent(event);
    this._storageListenerAttached = false;
    this._pendingStorageEvents = [];
    this._transactionDepth = 0;
    this._disposed = false;
    this.state = null;
    this.revision = 0;
    this.writeId = null;
    this.updatedAt = null;
    this.lastWarning = null;
    this.lastSaveSucceeded = null;
    this.pendingLegacyAdoption = false;
  }

  static async open(options = {}) {
    const lab = new BusterLabStorage(options);
    await lab.open();
    return lab;
  }

  async open() {
    this._disposed = false;
    let state;
    if (this.readOnly) {
      state = this.load();
      this.lastWarning = this.lastWarning
        ?? 'This browser does not provide the cross-tab lock required for durable Buster Lab writes. The Lab is read-only; export and sandbox testing remain available.';
      state = attachWarning(this.state, this.lastWarning);
    } else {
      try {
        state = await this._withLock(async () => this.load());
      } catch (error) {
        if (error?.code !== 'BUSTER_LAB_LOCK_TIMEOUT') throw error;
        this.readOnly = true;
        this.writePauseReason = 'lock-timeout';
        state = this.load();
        this._pauseWrites('lock-timeout', {
          warning: 'Roll could not acquire the Buster Lab save lock within five seconds. Writes are paused; reload or export a recovery copy.',
        });
        state = attachWarning(this.state, this.lastWarning);
      }
    }
    this._attachStorageListener();
    return state;
  }

  _attachStorageListener() {
    if (this._storageListenerAttached || this._disposed) return false;
    if (typeof this.storageEventTarget?.addEventListener !== 'function') return false;
    this.storageEventTarget.addEventListener('storage', this._boundStorageEvent);
    this._storageListenerAttached = true;
    return true;
  }

  _detachStorageListener() {
    if (!this._storageListenerAttached) return false;
    this.storageEventTarget?.removeEventListener?.('storage', this._boundStorageEvent);
    this._storageListenerAttached = false;
    return true;
  }

  dispose() {
    this._disposed = true;
    this._pendingStorageEvents.length = 0;
    this._detachStorageListener();
  }

  _pauseWrites(reason, {
    warning = null,
    conflict = null,
  } = {}) {
    this.readOnly = true;
    this.writePauseReason = reason;
    this.conflict = conflict ? cloneJson(conflict) : null;
    this.lastSaveSucceeded = false;
    this.lastWarning = warning
      ?? 'The Buster Lab save changed in another tab. Writes are paused; reload the Lab or export a recovery copy before continuing.';
    return this.getPersistenceStatus();
  }

  _handleStorageEvent(event) {
    if (this._disposed) return;
    const inspected = inspectBusterLabStorageEvent(event, {
      storageKey: this.storageKeys.main,
      saveContextId: this.saveContextId,
    });
    if (!inspected.relevant) return;
    if (event.storageArea && this.storage && event.storageArea !== this.storage) return;
    if (!inspected.removed && !inspected.error
      && inspected.envelope?.revision === this.revision
      && inspected.envelope?.writeId === this.writeId) {
      return;
    }
    if (this._transactionDepth > 0) {
      this._pendingStorageEvents.push(inspected);
      return;
    }
    this._applyStorageEventInspection(inspected);
  }

  _applyStorageEventInspection(inspected) {
    const envelope = inspected.envelope;
    if (!inspected.removed && !inspected.error
      && envelope?.revision === this.revision
      && envelope?.writeId === this.writeId) {
      return false;
    }
    const conflict = {
      expectedRevision: this.revision,
      expectedWriteId: this.writeId,
      actualRevision: envelope?.revision ?? (inspected.removed ? 0 : null),
      actualWriteId: envelope?.writeId ?? null,
      removed: Boolean(inspected.removed),
      invalid: Boolean(inspected.error),
      message: inspected.error?.message ?? null,
    };
    this._pauseWrites('external-conflict', { conflict });
    return true;
  }

  _flushPendingStorageEvents() {
    if (this._transactionDepth > 0 || this._pendingStorageEvents.length === 0) return;
    const pending = this._pendingStorageEvents.splice(0);
    for (const inspected of pending) {
      if (inspected.relevant && this._applyStorageEventInspection(inspected)) break;
    }
  }

  load() {
    this.lastWarning = null;
    let serialized = null;
    if (this.storage) {
      try {
        serialized = this.storage.getItem(this.storageKeys.main);
      } catch (error) {
        this.lastWarning = `Roll couldn't open the Buster Lab save (${error.message}). A safe starter lab is available for this session.`;
      }
    } else {
      this.lastWarning = 'Buster Lab persistence is unavailable. Changes will last only for this session.';
    }

    if (serialized == null) {
      this._adoptState(createDefaultBusterLabState());
      this.revision = 0;
      this.writeId = null;
      this.updatedAt = null;
      this.pendingLegacyAdoption = Boolean(this.storage?.getItem?.(BUSTER_LAB_LEGACY_STORAGE_KEY));
      if (this.pendingLegacyAdoption) {
        this.lastWarning = 'Roll found an older Buster Lab payload. It remains untouched until the player explicitly confirms adoption into this campaign.';
      }
      if (this.storage && !this.lastWarning && !this.readOnly) {
        try {
          this._persistCandidate(this.state, { allowMissing: true });
        } catch (error) {
          this.lastSaveSucceeded = false;
          this.lastWarning = `Roll couldn't create the Buster Lab save (${error.message}). A safe starter lab is available for this session.`;
        }
      }
      return attachWarning(this.state, this.lastWarning);
    }

    try {
      const envelope = parseBusterLabEnvelope(serialized, {
        expectedSaveContextId: this.saveContextId,
      });
      const migrated = this.deserialize(envelope.state);
      if (migrated.bossHunts?.fallbackFromProfileId) {
        this.lastWarning = `Roll couldn't find the saved Boss Hunt "${migrated.bossHunts.fallbackFromProfileId}". Revolving Fusillade was selected instead.`;
      }
      if ((migrated.bossHunts?.quarantinedRecoveryCount ?? 0) > 0) {
        const count = migrated.bossHunts.quarantinedRecoveryCount;
        const recoveryWarning = `Roll quarantined ${count} Boss Recover${count === 1 ? 'y' : 'ies'} whose saved material did not match the recorded hunt.`;
        this.lastWarning = this.lastWarning ? `${this.lastWarning} ${recoveryWarning}` : recoveryWarning;
      }
      const quarantined = migrated.migrations?.unknownModuleQuarantine ?? [];
      if (quarantined.length > 0) {
        const names = quarantined.map((entry) => entry.buildId).join(', ');
        const moduleWarning = `Unknown Custom Buster modules were found in ${names}. Roll preserved the source as an invalid draft, cleared its arm assignment, and returned control to the Mega Buster.`;
        this.lastWarning = this.lastWarning ? `${this.lastWarning} ${moduleWarning}` : moduleWarning;
      }
      const errors = validateBusterLabState(migrated);
      if (errors.length > 0) throw new BusterLabValidationError(errors);
      this._adoptState(migrated);
      this._adoptEnvelopeMetadata(envelope);
      if (!this.readOnly && JSON.stringify(migrated) !== JSON.stringify(envelope.state)) {
        const migrationWarning = this.lastWarning;
        this._persistCandidate(migrated, {
          expectedRevision: envelope.revision,
          expectedWriteId: envelope.writeId,
        });
        this.lastWarning = migrationWarning;
      }
      this.lastSaveSucceeded = true;
    } catch (error) {
      this._quarantineCorruptPayload(serialized, error);
      const backup = this._tryReadEnvelope(this.storageKeys.backup);
      if (backup.ok) {
        this._adoptState(this.deserialize(backup.envelope.state));
        this._adoptEnvelopeMetadata(backup.envelope);
        if (!this.readOnly) {
          try { this.storage?.setItem(this.storageKeys.main, backup.raw); } catch { /* Warning below remains actionable. */ }
        }
        this.lastSaveSucceeded = false;
        this.lastWarning = `Roll quarantined unreadable Buster Lab data (${error.message}) and recovered the previous backup.`;
      } else {
        this._adoptState(createDefaultBusterLabState());
        const fallbackEnvelope = createBusterLabEnvelope({
          saveContextId: this.saveContextId,
          state: this.state,
          revision: 1,
        });
        this._adoptEnvelopeMetadata(fallbackEnvelope);
        if (!this.readOnly) {
          try { this.storage?.setItem(this.storageKeys.main, JSON.stringify(fallbackEnvelope)); } catch { /* Session fallback still works. */ }
        }
        this.lastSaveSucceeded = false;
        this.lastWarning = `Roll couldn't read the saved Buster Lab data (${error.message}). A safe starter lab was restored; the corrupt payload was retained for recovery.`;
      }
    }
    return attachWarning(this.state, this.lastWarning);
  }

  loadWithStatus() {
    const state = this.load();
    return {
      state,
      warning: this.lastWarning,
      saveContextId: this.saveContextId,
      revision: this.revision,
      writeId: this.writeId,
      readOnly: this.readOnly,
      writePauseReason: this.writePauseReason,
      conflict: cloneJson(this.conflict),
      pendingLegacyAdoption: this.pendingLegacyAdoption,
    };
  }

  getPersistenceStatus() {
    return {
      saveContextId: this.saveContextId,
      revision: this.revision,
      writeId: this.writeId,
      updatedAt: this.updatedAt,
      readOnly: this.readOnly,
      writePaused: Boolean(this.writePauseReason),
      writePauseReason: this.writePauseReason,
      conflict: cloneJson(this.conflict),
      warning: this.lastWarning,
      listenerAttached: this._storageListenerAttached,
      canReload: Boolean(this.storage),
      canExport: true,
    };
  }

  /**
   * Re-reads the context payload under its named lock. This is the sole path
   * that clears a conflict/timeout write pause; merely dismissing the warning
   * cannot make stale in-memory state writable again.
   */
  async reloadFromStorage() {
    if (!this.storage) {
      return {
        ok: false,
        reason: 'storage-unavailable',
        state: this._ensureLoaded(),
      };
    }
    if (!this.lockManager) {
      this.readOnly = true;
      this.writePauseReason = 'lock-unavailable';
      const state = this.load();
      this.lastWarning = this.lastWarning
        ?? 'This browser does not provide the cross-tab lock required for durable Buster Lab writes. The Lab remains read-only.';
      return {
        ok: true,
        state,
        ...this.getPersistenceStatus(),
      };
    }
    try {
      const result = await this._withLock(async () => {
        this.readOnly = false;
        this.writePauseReason = null;
        this.conflict = null;
        const state = this.load();
        return {
          ok: true,
          state,
          ...this.getPersistenceStatus(),
        };
      });
      return result;
    } catch (error) {
      const reason = error?.code === 'BUSTER_LAB_LOCK_TIMEOUT'
        ? 'lock-timeout'
        : 'reload-failed';
      this._pauseWrites(reason, {
        warning: reason === 'lock-timeout'
          ? 'Roll could not acquire the Buster Lab save lock. Writes remain paused; reload or export a recovery copy.'
          : `Roll couldn't reload the Buster Lab save (${error.message}). Writes remain paused.`,
      });
      return { ok: false, reason, error, state: this.state, ...this.getPersistenceStatus() };
    }
  }

  reloadDurableState() {
    return this.reloadFromStorage();
  }

  /** Returns both the current in-memory envelope and all context recovery keys. */
  exportRecoveryData() {
    const read = (key) => {
      try { return this.storage?.getItem?.(key) ?? null; } catch { return null; }
    };
    const activeEnvelope = createBusterLabEnvelope({
      saveContextId: this.saveContextId,
      state: this.state ?? createDefaultBusterLabState(),
      revision: this.revision,
      writeId: this.writeId,
      updatedAt: this.updatedAt,
    });
    const payload = createBusterLabRecoveryBundle({
      saveContextId: this.saveContextId,
      activeEnvelope,
      main: read(this.storageKeys.main),
      backup: read(this.storageKeys.backup),
      corrupt: read(this.storageKeys.corrupt),
    });
    return {
      ok: true,
      payload,
      serialized: JSON.stringify(payload, null, 2),
    };
  }

  exportRecoverySnapshot() {
    return this.exportRecoveryData();
  }

  serialize(state = this.state ?? createDefaultBusterLabState()) {
    const migrated = migrateBusterLabState(state);
    const errors = validateBusterLabState(migrated);
    if (errors.length > 0) throw new BusterLabValidationError(errors);
    return JSON.stringify(createBusterLabEnvelope({
      saveContextId: this.saveContextId,
      state: migrated,
      revision: this.revision,
      writeId: this.writeId,
      updatedAt: this.updatedAt,
    }));
  }

  deserialize(serialized) {
    const parsed = typeof serialized === 'string' ? JSON.parse(serialized) : cloneJson(serialized);
    const source = Number(parsed?.storageVersion) === BUSTER_LAB_ENVELOPE_VERSION && parsed?.state
      ? parseBusterLabEnvelope(parsed, { expectedSaveContextId: this.saveContextId }).state
      : parsed;
    const state = migrateBusterLabState(source);
    const errors = validateBusterLabState(state);
    if (errors.length > 0) throw new BusterLabValidationError(errors);
    return state;
  }

  save(state = this.state ?? createDefaultBusterLabState()) {
    if (this.readOnly) throw new Error('The Buster Lab is read-only because durable locking is unavailable.');
    const candidate = this.deserialize(state);
    this._persistCandidate(candidate);
    this._adoptState(candidate);
    return this.state;
  }

  reset() {
    const state = createDefaultBusterLabState();
    try {
      this._persistCandidate(state);
    } catch (error) {
      this.lastWarning = `Roll couldn't save the reset Buster Lab (${error.message}). A clean lab is available for this session.`;
    }
    this._adoptState(state);
    return attachWarning(this.state, this.lastWarning);
  }

  mutate(mutator) {
    const current = this._ensureLoaded();
    if (this.readOnly) return { ok: false, reason: 'read-only', state: current };
    const candidate = cloneJson(current);
    try {
      const result = typeof mutator === 'function' ? mutator(candidate) : undefined;
      const normalized = this.deserialize(JSON.stringify(candidate));
      this._persistCandidate(normalized);
      this._adoptState(normalized);
      return { ok: true, state: this.state, result };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof BusterLabValidationError
          ? 'invalid-state'
          : error instanceof BusterLabConflictError
            ? 'conflict'
            : 'transaction-failed',
        error,
        errors: error.errors ?? [],
        state: this.state,
      };
    }
  }

  transaction(mutator) {
    return this.mutate(mutator);
  }

  async transact({
    operation = 'transaction',
    expectedRevision = this.revision,
    expectedWriteId = this.writeId,
  } = {}, mutator) {
    if (this.readOnly) return { ok: false, reason: 'read-only', state: this._ensureLoaded() };
    this._transactionDepth += 1;
    try {
      return await this._withLock(async () => {
        const latest = this._readCurrentEnvelope();
        const actualRevision = latest?.revision ?? 0;
        const actualWriteId = latest?.writeId ?? null;
        if (expectedRevision != null && actualRevision !== expectedRevision) {
          throw new BusterLabConflictError('The Buster Lab revision changed before commit.', {
            expectedRevision,
            actualRevision,
            expectedWriteId,
            actualWriteId,
          });
        }
        if (expectedWriteId != null && actualWriteId !== expectedWriteId) {
          throw new BusterLabConflictError('The Buster Lab write id changed before commit.', {
            expectedRevision,
            actualRevision,
            expectedWriteId,
            actualWriteId,
          });
        }
        const base = latest ? this.deserialize(latest.state) : createDefaultBusterLabState();
        const candidate = cloneJson(base);
        const result = typeof mutator === 'function'
          ? await mutator(candidate, { operation, revision: actualRevision, writeId: actualWriteId })
          : undefined;
        const normalized = this.deserialize(candidate);
        const envelope = this._persistCandidate(normalized, {
          expectedRevision: actualRevision,
          expectedWriteId: actualWriteId,
          allowMissing: latest == null,
        });
        this._adoptState(normalized);
        this._adoptEnvelopeMetadata(envelope);
        return { ok: true, operation, state: this.state, result, revision: this.revision, writeId: this.writeId };
      });
    } catch (error) {
      const reason = error instanceof BusterLabConflictError
        ? 'conflict'
        : error?.code === 'BUSTER_LAB_LOCK_TIMEOUT'
          ? 'lock-timeout'
          : error instanceof BusterLabValidationError
            ? 'invalid-state'
            : error?.busterReason ?? 'transaction-failed';
      if (reason === 'lock-timeout' || reason === 'conflict') {
        this._pauseWrites(reason, {
          warning: reason === 'lock-timeout'
            ? 'Roll could not acquire the Buster Lab save lock. Writes are paused; reload or export a recovery copy.'
            : 'The Buster Lab save changed before this transaction could commit. Writes are paused; reload or export a recovery copy.',
          conflict: error instanceof BusterLabConflictError ? error : null,
        });
      }
      return { ok: false, reason, operation, error, errors: error.errors ?? [], state: this.state };
    } finally {
      this._transactionDepth = Math.max(0, this._transactionDepth - 1);
      this._flushPendingStorageEvents();
    }
  }

  /**
   * Runs one of the synchronous compatibility commands against the locked
   * candidate only. The scratch store has no durable backend, so the outer
   * transaction performs the sole persistent write after validation.
   */
  async _runAsyncCommand(operation, command, concurrency = {}) {
    const transaction = await this.transact({
      operation,
      expectedRevision: concurrency.expectedRevision ?? this.revision,
      expectedWriteId: concurrency.expectedWriteId ?? this.writeId,
    }, (state) => {
      const scratch = new BusterLabStorage({
        storage: null,
        idFactory: this.idFactory,
        saveContextId: this.saveContextId,
        lockManager: null,
      });
      scratch.state = state;
      const result = command(scratch);
      if (!result?.ok) throw new BusterLabOperationError(result?.reason, result);
      const { state: _scratchState, ...safeResult } = result;
      return safeResult;
    });
    if (!transaction.ok) return transaction;
    return { ...transaction, ...transaction.result, state: transaction.state };
  }

  updateRollSalvageAsync(mutator, concurrency = {}) {
    return this._runAsyncCommand('update-roll-salvage', (lab) => lab.updateRollSalvage(mutator), concurrency);
  }

  fabricateAsync(recipeOrId, options = {}, concurrency = {}) {
    return this._runAsyncCommand('fabricate-module', (lab) => lab.fabricate(recipeOrId, options), concurrency);
  }

  grantDebugKitAsync(concurrency = {}) {
    return this._runAsyncCommand('grant-debug-kit', (lab) => lab.grantDebugKit(), concurrency);
  }

  purchaseSecondChassisAsync(concurrency = {}) {
    return this._runAsyncCommand('purchase-second-chassis', (lab) => lab.purchaseSecondChassis(), concurrency);
  }

  saveDraftAsync(draft, concurrency = {}) {
    return this._runAsyncCommand('save-buster-draft', (lab) => lab.saveDraft(draft), concurrency);
  }

  saveBuildAsync(build, concurrency = {}) {
    return this._runAsyncCommand('save-buster-build', (lab) => lab.saveBuild(build), concurrency);
  }

  assignBuildToSlotAsync(buildId, slotIndex, concurrency = {}) {
    return this._runAsyncCommand(
      'assign-buster-slot',
      (lab) => lab.assignBuildToSlot(buildId, slotIndex),
      concurrency,
    );
  }

  setAssignmentsAsync(assignments, concurrency = {}) {
    return this._runAsyncCommand('set-buster-assignments', (lab) => lab.setAssignments(assignments), concurrency);
  }

  setMegaCalibrationStateAsync(calibrations, concurrency = {}) {
    return this._runAsyncCommand(
      'set-mega-calibrations',
      (lab) => lab.setMegaCalibrationState(calibrations),
      concurrency,
    );
  }

  setMegaCalibrationAsync(slotIndex, instanceId, concurrency = {}) {
    return this._runAsyncCommand(
      'set-mega-calibration',
      (lab) => lab.setMegaCalibration(slotIndex, instanceId),
      concurrency,
    );
  }

  getBossHuntState() {
    return cloneJson(this._ensureLoaded().bossHunts, createDefaultBossHuntState());
  }

  getActiveBossExpedition() {
    const hunts = this._ensureLoaded().bossHunts;
    return hunts.activeExpeditionId
      ? cloneJson(hunts.recordedExpeditions[hunts.activeExpeditionId])
      : null;
  }

  async selectBossHunt(bossProfileId, concurrency = {}) {
    const profile = getReaverbotBossProfile(bossProfileId);
    if (!profile) return { ok: false, reason: 'unknown-boss-profile', state: this._ensureLoaded() };
    const current = this._ensureLoaded().bossHunts;
    if (current.activeExpeditionId) {
      return {
        ok: false,
        reason: 'expedition-active',
        activeExpeditionId: current.activeExpeditionId,
        state: this.state,
      };
    }
    if (current.selectedBossProfileId === profile.id) {
      return { ok: true, unchanged: true, bossProfileId: profile.id, state: this.state };
    }
    const transaction = await this.transact({
      operation: 'select-boss-hunt',
      expectedRevision: concurrency.expectedRevision ?? this.revision,
      expectedWriteId: concurrency.expectedWriteId ?? this.writeId,
    }, (state) => {
      if (state.bossHunts.activeExpeditionId) {
        throw new BusterLabOperationError('expedition-active');
      }
      state.bossHunts.selectedBossProfileId = profile.id;
      state.bossHunts.fallbackFromProfileId = null;
      return { bossProfileId: profile.id };
    });
    return transaction.ok ? { ...transaction, ...transaction.result } : transaction;
  }

  selectBossHuntAsync(bossProfileId, concurrency = {}) {
    return this.selectBossHunt(bossProfileId, concurrency);
  }

  async lockBossHuntForExpedition(expeditionSpec = {}, concurrency = {}) {
    const expeditionId = typeof expeditionSpec.id === 'string' && expeditionSpec.id
      ? expeditionSpec.id
      : typeof expeditionSpec.expeditionId === 'string' && expeditionSpec.expeditionId
        ? expeditionSpec.expeditionId
        : '';
    if (!expeditionId) return { ok: false, reason: 'invalid-expedition-id', state: this._ensureLoaded() };
    const currentHunts = this._ensureLoaded().bossHunts;
    const requestedProfileId = expeditionSpec.bossProfileId ?? currentHunts.selectedBossProfileId;
    if (!getReaverbotBossProfile(requestedProfileId)) {
      return { ok: false, reason: 'unknown-boss-profile', state: this.state };
    }
    const existing = currentHunts.recordedExpeditions[expeditionId];
    if (existing) {
      if (existing.bossProfileId !== requestedProfileId) {
        return { ok: false, reason: 'expedition-profile-mismatch', expedition: cloneJson(existing), state: this.state };
      }
      if (existing.status !== 'active') {
        return { ok: false, reason: 'expedition-closed', expedition: cloneJson(existing), state: this.state };
      }
      const requestedDepth = Math.max(1, nonNegativeInteger(expeditionSpec.depth, 1));
      const requestedSeed = typeof expeditionSpec.seed === 'string' || Number.isFinite(Number(expeditionSpec.seed))
        ? expeditionSpec.seed
        : null;
      if (existing.depth !== requestedDepth || existing.seed !== requestedSeed) {
        return { ok: false, reason: 'expedition-spec-mismatch', expedition: cloneJson(existing), state: this.state };
      }
      return { ok: true, unchanged: true, expedition: cloneJson(existing), state: this.state };
    }
    if (currentHunts.activeExpeditionId) {
      return {
        ok: false,
        reason: 'expedition-active',
        activeExpeditionId: currentHunts.activeExpeditionId,
        state: this.state,
      };
    }
    if (requestedProfileId !== currentHunts.selectedBossProfileId) {
      return {
        ok: false,
        reason: 'boss-selection-mismatch',
        selectedBossProfileId: currentHunts.selectedBossProfileId,
        requestedBossProfileId: requestedProfileId,
        state: this.state,
      };
    }
    const transaction = await this.transact({
      operation: 'lock-boss-hunt-expedition',
      expectedRevision: concurrency.expectedRevision ?? this.revision,
      expectedWriteId: concurrency.expectedWriteId ?? this.writeId,
    }, (state) => {
      const hunts = state.bossHunts;
      const concurrentExisting = hunts.recordedExpeditions[expeditionId];
      if (concurrentExisting) {
        if (concurrentExisting.bossProfileId !== requestedProfileId) {
          throw new BusterLabOperationError('expedition-profile-mismatch');
        }
        if (concurrentExisting.status !== 'active') {
          throw new BusterLabOperationError('expedition-closed');
        }
        const concurrentDepth = Math.max(1, nonNegativeInteger(expeditionSpec.depth, 1));
        const concurrentSeed = typeof expeditionSpec.seed === 'string' || Number.isFinite(Number(expeditionSpec.seed))
          ? expeditionSpec.seed
          : null;
        if (concurrentExisting.depth !== concurrentDepth || concurrentExisting.seed !== concurrentSeed) {
          throw new BusterLabOperationError('expedition-spec-mismatch');
        }
        return { expedition: cloneJson(concurrentExisting), unchanged: true };
      }
      if (hunts.activeExpeditionId) throw new BusterLabOperationError('expedition-active');
      if (hunts.selectedBossProfileId !== requestedProfileId) {
        throw new BusterLabOperationError('boss-selection-mismatch');
      }
      const expedition = {
        expeditionId,
        bossProfileId: requestedProfileId,
        invalidBossProfileId: null,
        seed: typeof expeditionSpec.seed === 'string' || Number.isFinite(Number(expeditionSpec.seed))
          ? expeditionSpec.seed
          : null,
        depth: Math.max(1, nonNegativeInteger(expeditionSpec.depth, 1)),
        status: 'active',
        startedAt: new Date().toISOString(),
        completedAt: null,
        victoryIndex: null,
        signaturePartOverloaded: false,
        reward: null,
      };
      hunts.recordedExpeditions[expeditionId] = expedition;
      hunts.activeExpeditionId = expeditionId;
      return { expedition: cloneJson(expedition) };
    });
    return transaction.ok ? { ...transaction, ...transaction.result } : transaction;
  }

  lockBossHuntForExpeditionAsync(expeditionSpec = {}, concurrency = {}) {
    return this.lockBossHuntForExpedition(expeditionSpec, concurrency);
  }

  async clearActiveBossExpedition({ expeditionId = null, reason = 'defeat' } = {}, concurrency = {}) {
    const hunts = this._ensureLoaded().bossHunts;
    const targetId = expeditionId ?? hunts.activeExpeditionId;
    if (!targetId || hunts.activeExpeditionId !== targetId) {
      return { ok: true, unchanged: true, state: this.state };
    }
    const status = reason === 'abandoned' ? 'abandoned' : 'defeat';
    const transaction = await this.transact({
      operation: 'clear-boss-hunt-expedition',
      expectedRevision: concurrency.expectedRevision ?? this.revision,
      expectedWriteId: concurrency.expectedWriteId ?? this.writeId,
    }, (state) => {
      const entry = state.bossHunts.recordedExpeditions[targetId];
      if (entry?.status === 'active') {
        entry.status = status;
        entry.completedAt = new Date().toISOString();
      }
      if (state.bossHunts.activeExpeditionId === targetId) {
        state.bossHunts.activeExpeditionId = null;
      }
      return { expedition: cloneJson(entry) };
    });
    return transaction.ok ? { ...transaction, ...transaction.result } : transaction;
  }

  completeBossExpedition(expeditionId, { outcome = 'defeat', ...concurrency } = {}) {
    return this.clearActiveBossExpedition({ expeditionId, reason: outcome }, concurrency);
  }

  unlockBossHuntAfterExpedition(expeditionId, options = {}) {
    return this.completeBossExpedition(expeditionId, options);
  }

  async recordBossVictory({
    expeditionId,
    bossProfileId,
    signaturePartOverloaded = false,
    sandbox = false,
    debugRewardOutcome = null,
    allowDebugOverride = false,
  } = {}, concurrency = {}) {
    if (sandbox) {
      return { ok: true, suppressed: true, reason: 'sandbox', rewardQueued: false, state: this._ensureLoaded() };
    }
    if (typeof expeditionId !== 'string' || !expeditionId) {
      return { ok: false, reason: 'invalid-expedition-id', state: this._ensureLoaded() };
    }
    if (!getReaverbotBossProfile(bossProfileId)) {
      return { ok: false, reason: 'unknown-boss-profile', state: this._ensureLoaded() };
    }
    const existing = this._ensureLoaded().bossHunts.recordedExpeditions[expeditionId];
    if (existing?.status === 'victory') {
      if (existing.bossProfileId !== bossProfileId) {
        return { ok: false, reason: 'expedition-profile-mismatch', state: this.state };
      }
      return {
        ok: true,
        unchanged: true,
        idempotent: true,
        victoryIndex: existing.victoryIndex,
        rewardQueued: Boolean(existing.reward?.queued),
        reward: cloneJson(existing.reward),
        state: this.state,
      };
    }
    const activeExpeditionId = this._ensureLoaded().bossHunts.activeExpeditionId;
    if (activeExpeditionId && activeExpeditionId !== expeditionId) {
      return {
        ok: false,
        reason: 'expedition-active',
        activeExpeditionId,
        state: this.state,
      };
    }
    if (this.readOnly) {
      return {
        ok: false,
        reason: 'read-only',
        rewardQueued: false,
        firstClearEligible: (this.state.bossHunts.victoriesByProfile[bossProfileId] ?? 0) === 0,
        state: this.state,
      };
    }
    const featuredPart = resolveBossFeaturedMaterial(bossProfileId);
    if (!featuredPart) return { ok: false, reason: 'missing-featured-material', state: this.state };

    const transaction = await this.transact({
      operation: 'record-boss-victory',
      expectedRevision: concurrency.expectedRevision ?? this.revision,
      expectedWriteId: concurrency.expectedWriteId ?? this.writeId,
    }, (state) => {
      const hunts = state.bossHunts;
      const prior = hunts.recordedExpeditions[expeditionId];
      if (prior?.status === 'victory') {
        if (prior.bossProfileId !== bossProfileId) {
          throw new BusterLabOperationError('expedition-profile-mismatch');
        }
        return {
          unchanged: true,
          idempotent: true,
          victoryIndex: prior.victoryIndex,
          rewardQueued: Boolean(prior.reward?.queued),
          reward: cloneJson(prior.reward),
        };
      }
      if (hunts.activeExpeditionId && hunts.activeExpeditionId !== expeditionId) {
        throw new BusterLabOperationError('expedition-active');
      }
      if (prior && prior.bossProfileId !== bossProfileId) {
        throw new BusterLabOperationError('expedition-profile-mismatch');
      }
      const previousVictories = nonNegativeInteger(hunts.victoriesByProfile[bossProfileId]);
      const victoryIndex = previousVictories + 1;
      const firstClear = previousVictories === 0;
      const deterministicRoll = getBossHuntRewardRoll({
        saveContextId: this.saveContextId,
        bossProfileId,
        victoryIndex,
      });
      const forcedOutcome = allowDebugOverride && typeof debugRewardOutcome === 'boolean'
        ? debugRewardOutcome
        : null;
      const rewardEligible = forcedOutcome ?? (
        firstClear
        || Boolean(signaturePartOverloaded)
        || deterministicRoll < BOSS_HUNT_REPEAT_REWARD_CHANCE
      );
      const rewardReason = forcedOutcome != null
        ? 'debug-override'
        : firstClear
          ? 'first-clear'
          : signaturePartOverloaded
            ? 'signature-overload'
            : rewardEligible
              ? 'repeat-roll'
              : 'repeat-miss';
      const recoveryId = rewardEligible ? `boss-recovery:${expeditionId}` : null;
      const reward = {
        eligible: rewardEligible,
        queued: rewardEligible,
        recoveryId,
        deterministicRoll,
        reason: rewardReason,
        identified: false,
      };
      const completed = {
        expeditionId,
        bossProfileId,
        invalidBossProfileId: null,
        seed: prior?.seed ?? null,
        depth: prior?.depth ?? 1,
        status: 'victory',
        startedAt: prior?.startedAt ?? null,
        completedAt: new Date().toISOString(),
        victoryIndex,
        signaturePartOverloaded: Boolean(signaturePartOverloaded),
        reward,
      };
      hunts.recordedExpeditions[expeditionId] = completed;
      hunts.victoriesByProfile[bossProfileId] = victoryIndex;
      if (hunts.activeExpeditionId === expeditionId) hunts.activeExpeditionId = null;
      if (rewardEligible && !hunts.pendingRecoveries.some((entry) => entry.recoveryId === recoveryId)) {
        hunts.pendingRecoveries.push({
          recoveryId,
          expeditionId,
          bossProfileId,
          victoryIndex,
          signaturePartOverloaded: Boolean(signaturePartOverloaded),
          deterministicRoll,
          queuedAt: completed.completedAt,
          quantity: 1,
          part: {
            ...cloneJson(featuredPart),
            quantity: 1,
            source: {
              ...plainObject(featuredPart.source),
              kind: 'bossHunt',
              expeditionId,
              bossProfileId,
              victoryIndex,
            },
          },
        });
      }
      return {
        expedition: cloneJson(completed),
        firstClear,
        victoryIndex,
        rewardQueued: rewardEligible,
        reward: cloneJson(reward),
      };
    });
    return transaction.ok ? { ...transaction, ...transaction.result } : transaction;
  }

  recordBossVictoryAsync(result = {}, concurrency = {}) {
    return this.recordBossVictory(result, concurrency);
  }

  getPendingBossRecoveryTransfer({ recoveryIds = null } = {}) {
    const selectedIds = Array.isArray(recoveryIds) ? new Set(recoveryIds) : null;
    const pending = this._ensureLoaded().bossHunts.pendingRecoveries
      .filter((entry) => !selectedIds || selectedIds.has(entry.recoveryId));
    return {
      total: pending.length,
      recoveries: pending.map((entry) => ({
        id: entry.recoveryId,
        recoveryId: entry.recoveryId,
        quantity: 1,
        source: {
          kind: 'bossHunt',
          expeditionId: entry.expeditionId,
          bossProfileId: entry.bossProfileId,
          victoryIndex: entry.victoryIndex,
        },
        recoverableParts: [{
          ...cloneJson(entry.part),
          quantity: 1,
          source: cloneJson(entry.part.source),
        }],
      })),
    };
  }

  async identifyRecoveriesWithBossRewards(ordinaryTransfer = {}, options = {}, concurrency = {}) {
    const recoveryIds = Array.isArray(options.recoveryIds) ? new Set(options.recoveryIds) : null;
    const ordinaryTotal = nonNegativeInteger(ordinaryTransfer?.total);
    const ordinaryRecoveries = Array.isArray(ordinaryTransfer?.recoveries)
      ? cloneJson(ordinaryTransfer.recoveries, [])
      : [];
    const availableBossRecoveries = this._ensureLoaded().bossHunts.pendingRecoveries
      .filter((entry) => !recoveryIds || recoveryIds.has(entry.recoveryId));
    if (ordinaryTotal <= 0 && availableBossRecoveries.length === 0) {
      return { ok: false, reason: 'nothing-to-identify', state: this.state };
    }
    const transaction = await this.transact({
      operation: 'identify-all-recoveries',
      expectedRevision: concurrency.expectedRevision ?? this.revision,
      expectedWriteId: concurrency.expectedWriteId ?? this.writeId,
    }, (state) => {
      const bossRecoveries = state.bossHunts.pendingRecoveries
        .filter((entry) => !recoveryIds || recoveryIds.has(entry.recoveryId));
      const bossTransfer = {
        total: bossRecoveries.length,
        recoveries: bossRecoveries.map((entry) => ({
          id: entry.recoveryId,
          quantity: 1,
          source: {
            kind: 'bossHunt',
            expeditionId: entry.expeditionId,
            bossProfileId: entry.bossProfileId,
            victoryIndex: entry.victoryIndex,
          },
          recoverableParts: [{
            ...cloneJson(entry.part),
            quantity: 1,
            source: cloneJson(entry.part.source),
          }],
        })),
      };
      const roll = new RollSalvageStorage({
        ...state.rollSalvage,
        discoveredSalvageTypes: state.discovery.salvageTypes,
        discoveryHistory: state.discovery.history,
      });
      const ordinaryResult = ordinaryTotal > 0
        ? roll.identifyRecoveries({ total: ordinaryTotal, recoveries: ordinaryRecoveries })
        : { processed: 0, scrapStored: 0, partCount: 0, recoveredParts: [] };
      // Boss recoveries are resolved as their own batch inside the same durable
      // transaction. An inconsistent ordinary transfer therefore cannot spend
      // the reserved unit that represents a guaranteed named boss material.
      const bossResult = bossTransfer.total > 0
        ? roll.identifyRecoveries(bossTransfer)
        : { processed: 0, scrapStored: 0, partCount: 0, recoveredParts: [] };
      const recoveredParts = new Map();
      for (const part of [...ordinaryResult.recoveredParts, ...bossResult.recoveredParts]) {
        const prior = recoveredParts.get(part.id) ?? { ...part, quantity: 0 };
        prior.quantity += nonNegativeInteger(part.quantity);
        recoveredParts.set(part.id, prior);
      }
      const result = {
        processed: ordinaryResult.processed + bossResult.processed,
        scrapStored: ordinaryResult.scrapStored + bossResult.scrapStored,
        partCount: ordinaryResult.partCount + bossResult.partCount,
        recoveredParts: [...recoveredParts.values()],
        identifiedScrap: roll.identifiedScrap,
        storedPartCount: roll.getStoredPartCount(),
      };
      this._applyRollSnapshot(state, roll.serialize());
      const consumedIds = new Set(bossRecoveries.map((entry) => entry.recoveryId));
      state.bossHunts.pendingRecoveries = state.bossHunts.pendingRecoveries
        .filter((entry) => !consumedIds.has(entry.recoveryId));
      for (const entry of Object.values(state.bossHunts.recordedExpeditions)) {
        if (entry.reward?.recoveryId && consumedIds.has(entry.reward.recoveryId)) {
          entry.reward.queued = false;
          entry.reward.identified = true;
        }
      }
      return {
        identification: result,
        ordinaryProcessed: ordinaryTotal,
        bossRecoveriesProcessed: bossTransfer.total,
        bossRecoveryIds: [...consumedIds],
      };
    });
    return transaction.ok ? { ...transaction, ...transaction.result } : transaction;
  }

  identifyBossRecoveries(options = {}, concurrency = {}) {
    return this.identifyRecoveriesWithBossRewards({}, options, concurrency);
  }

  swapMegaCalibrationAsync(slotIndex, instanceId, options = {}, concurrency = {}) {
    return this._runAsyncCommand(
      'swap-mega-calibration',
      (lab) => {
        const slot = Math.trunc(Number(slotIndex));
        const currentInstanceId = lab.state.megaCalibrations.slots[slot] ?? null;
        const currentRecord = lab.state.legacyBusterParts.records
          .find((record) => record.calibrationInstanceId === currentInstanceId);
        const nextRecord = lab.state.legacyBusterParts.records
          .find((record) => record.calibrationInstanceId === instanceId);

        if (currentInstanceId && currentInstanceId !== instanceId) {
          const removed = currentRecord
            ? lab.moveLegacyBusterPart(currentRecord.legacyId, { kind: 'inventory' }, options)
            : lab.setMegaCalibration(slot, null);
          if (!removed.ok) return removed;
        }
        if (instanceId === currentInstanceId) {
          return { ok: true, calibrations: cloneJson(lab.state.megaCalibrations), state: lab.state };
        }
        if (nextRecord) {
          const installed = lab.moveLegacyBusterPart(
            nextRecord.legacyId,
            { kind: 'megaSocket', socketIndex: slot },
            options,
          );
          return installed.ok
            ? { ...installed, calibrations: cloneJson(lab.state.megaCalibrations) }
            : installed;
        }
        const installed = lab.setMegaCalibration(slot, instanceId ?? null);
        return installed.ok
          ? { ...installed, calibrations: cloneJson(lab.state.megaCalibrations) }
          : installed;
      },
      concurrency,
    );
  }

  saveBlueprintAsync(source, options = {}, concurrency = {}) {
    return this._runAsyncCommand(
      'save-buster-blueprint',
      (lab) => lab.saveBlueprint(source, options),
      concurrency,
    );
  }

  deleteBlueprintAsync(blueprintId, concurrency = {}) {
    return this._runAsyncCommand(
      'delete-buster-blueprint',
      (lab) => lab.deleteBlueprint(blueprintId),
      concurrency,
    );
  }

  importBlueprintAsync(payload, concurrency = {}) {
    return this._runAsyncCommand(
      'import-buster-blueprint',
      (lab) => lab.importBlueprint(payload),
      concurrency,
    );
  }

  createRollSalvageStorage({ autosave = true } = {}) {
    const state = this._ensureLoaded();
    return new RollSalvageStorage({
      ...state.rollSalvage,
      discoveredSalvageTypes: state.discovery.salvageTypes,
      discoveryHistory: state.discovery.history,
      onChange: autosave
        ? (snapshot) => {
          const result = this._commitRollSnapshot(snapshot);
          if (!result.ok) throw result.error;
        }
        : null,
    });
  }

  updateRollSalvage(mutator) {
    const state = this._ensureLoaded();
    const roll = new RollSalvageStorage({
      ...state.rollSalvage,
      discoveredSalvageTypes: state.discovery.salvageTypes,
      discoveryHistory: state.discovery.history,
    });
    try {
      const result = mutator(roll);
      const committed = this._commitRollSnapshot(roll.serialize());
      return committed.ok ? { ...committed, result, roll } : committed;
    } catch (error) {
      return { ok: false, reason: 'transaction-failed', error, state: this.state };
    }
  }

  fabricate(recipeOrId, options = {}) {
    const recipe = getBusterRecipe(recipeOrId);
    if (!recipe) return { ok: false, reason: 'unknown-recipe', state: this._ensureLoaded() };

    const candidate = cloneJson(this._ensureLoaded());
    const route = options.route === 'replication' ? 'replication' : 'original';
    const history = candidate.fabricationHistory[recipe.moduleId] ?? {
      originalCrafts: 0,
      replicationCrafts: 0,
      firstOriginalSequence: null,
    };
    if (route === 'replication' && history.originalCrafts < 1) {
      return { ok: false, reason: 'replication-locked', recipeId: recipe.id, state: this.state };
    }
    const routeRecipe = route === 'replication'
      ? {
        id: recipe.id,
        requirements: { identifiedScrap: recipe.scrapCost * 2, parts: {} },
      }
      : recipe;
    const roll = new RollSalvageStorage({
      ...candidate.rollSalvage,
      discoveredSalvageTypes: candidate.discovery.salvageTypes,
      discoveryHistory: candidate.discovery.history,
    });
    const transaction = roll.transactRecipe(routeRecipe, {
      createResult: () => {
        const instanceId = this._allocateInstanceId(candidate, 'module');
        return {
          id: instanceId,
          instanceId,
          moduleInstanceId: instanceId,
          moduleId: recipe.moduleId,
          recipeId: recipe.id,
          name: recipe.name,
          origin: 'fabricated',
          fabricationRoute: route,
          fabricationSequence: candidate.nextInstanceId - 1,
        };
      },
    });
    if (!transaction.ok) return { ...transaction, state: this.state };

    candidate.moduleInstances.push(transaction.result);
    if (route === 'original') {
      history.originalCrafts += 1;
      if (history.firstOriginalSequence == null) {
        history.firstOriginalSequence = transaction.result.fabricationSequence;
      }
    } else {
      history.replicationCrafts += 1;
    }
    candidate.fabricationHistory[recipe.moduleId] = history;
    this._applyRollSnapshot(candidate, roll.serialize());
    try {
      const normalized = this.deserialize(JSON.stringify(candidate));
      this._persistCandidate(normalized);
      this._adoptState(normalized);
      return {
        ok: true,
        recipeId: recipe.id,
        route,
        module: cloneJson(transaction.result),
        instance: cloneJson(transaction.result),
        spent: transaction.spent,
        state: this.state,
      };
    } catch (error) {
      return { ok: false, reason: 'transaction-failed', error, state: this.state };
    }
  }

  fabricateModule(recipeOrId, options = {}) {
    return this.fabricate(recipeOrId, options);
  }

  fabricateRecipe(recipeOrId, options = {}) {
    return this.fabricate(recipeOrId, options);
  }

  grantDebugKit() {
    const result = this.mutate((state) => {
      state.migrations = state.migrations && typeof state.migrations === 'object'
        ? state.migrations
        : {};
      const grantNumber = nonNegativeInteger(state.migrations.debugKitGrantCount) + 1;
      const modules = [];

      for (const definition of BUSTER_MODULE_LIST.filter((entry) => entry.physical)) {
        const recipe = getBusterRecipe(definition.id);
        const instanceId = this._allocateInstanceId(state, 'module');
        const instance = {
          id: instanceId,
          instanceId,
          moduleInstanceId: instanceId,
          moduleId: definition.id,
          recipeId: recipe?.id ?? null,
          name: definition.label,
          origin: 'debug',
          fabricationSequence: state.nextInstanceId - 1,
        };
        state.moduleInstances.push(instance);
        modules.push({ instanceId, moduleId: definition.id });
      }

      let chassis = null;
      if (!state.chassisInstances.some((entry) => entry.chassisId === 'chassis-b')) {
        if (state.chassisInstances.length >= MAX_BUSTER_CHASSIS) {
          throw new RangeError('The debug kit cannot add Build B because the chassis limit is already full.');
        }
        chassis = secondChassis('debug');
        state.chassisInstances.push(chassis);
      }
      if (!state.chassisDrafts.some((entry) => entry.buildId === 'build-b')) {
        state.chassisDrafts.push(secondChassisDraft());
      }

      const roll = new RollSalvageStorage({
        ...state.rollSalvage,
        discoveredSalvageTypes: state.discovery.salvageTypes,
        discoveryHistory: state.discovery.history,
      });
      const debugRecipeBill = { identifiedScrap: 0, parts: {} };
      for (const recipe of BUSTER_RECIPE_LIST) {
        debugRecipeBill.identifiedScrap += recipe.scrapCost;
        for (const partId of recipe.requiredPartIds) {
          debugRecipeBill.parts[partId] = (debugRecipeBill.parts[partId] ?? 0)
            + (recipe.parts[partId] ?? 1);
          roll.markPartDiscovered(partId, { debugKit: true, grantNumber }, { notify: false });
        }
      }
      roll.addIdentifiedScrap(debugRecipeBill.identifiedScrap);
      for (const [partId, quantity] of Object.entries(debugRecipeBill.parts)) {
        roll.addPart({
          id: partId,
          name: partId,
          family: 'Debug Buster Lab Part',
          tier: 'debug',
          color: '#ffb14a',
        }, quantity, { debugKit: true, grantNumber }, { notify: false });
      }
      this._applyRollSnapshot(state, roll.serialize());

      state.megaCalibrations = normalizeMegaCalibrations(state.megaCalibrations);
      const calibrations = [];
      for (const [legacyType, definition] of Object.entries(MEGA_BUSTER_CALIBRATION_CATALOG)) {
        let instanceId = '';
        do {
          instanceId = `calibration-${state.megaCalibrations.nextInstanceId++}`;
        } while (state.megaCalibrations.instances.some((entry) => entry.instanceId === instanceId));
        state.megaCalibrations.instances.push({
          instanceId,
          legacyType,
          name: definition.name,
          bonuses: { ...definition.bonuses },
        });
        calibrations.push({ instanceId, legacyType });
      }

      state.migrations.debugKitGrantCount = grantNumber;
      const applied = Array.isArray(state.migrations.applied) ? state.migrations.applied : [];
      state.migrations.applied = [...new Set([...applied, 'debug-kit-v0.1'])];
      return {
        grantNumber,
        modules,
        calibrations,
        chassis: chassis ? cloneJson(chassis) : null,
        recipesRevealed: BUSTER_RECIPE_LIST.length,
        resources: debugRecipeBill,
      };
    });
    return result.ok ? { ...result, ...result.result } : result;
  }

  saveBlueprint(source, options = {}) {
    const current = this._ensureLoaded();
    const requestedId = source?.blueprintId ?? options.blueprintId ?? null;
    if (!requestedId && current.blueprints.length >= MAX_BUSTER_BLUEPRINTS) {
      return { ok: false, reason: 'blueprint-limit', state: current };
    }
    const result = this.mutate((state) => {
      let blueprintId = requestedId;
      if (!blueprintId) {
        do {
          blueprintId = `blueprint-${state.nextBlueprintId++}`;
        } while (state.blueprints.some((entry) => entry.blueprintId === blueprintId));
      }
      const index = state.blueprints.findIndex((entry) => entry.blueprintId === blueprintId);
      if (index < 0 && state.blueprints.length >= MAX_BUSTER_BLUEPRINTS) {
        throw new RangeError(`Only ${MAX_BUSTER_BLUEPRINTS} blueprints may be stored.`);
      }
      const prior = index >= 0 ? state.blueprints[index] : null;
      const blueprint = sanitizeBlueprint({
        ...source,
        blueprintId,
        revision: prior ? prior.revision + 1 : 1,
      });
      if (!blueprint) throw new TypeError('The blueprint source is invalid.');
      if (index >= 0) state.blueprints[index] = blueprint;
      else state.blueprints.push(blueprint);
      return cloneJson(blueprint);
    });
    return result.ok ? { ...result, blueprint: result.result } : result;
  }

  deleteBlueprint(blueprintId) {
    const current = this._ensureLoaded();
    if (!current.blueprints.some((entry) => entry.blueprintId === blueprintId)) {
      return { ok: false, reason: 'missing-blueprint', state: current };
    }
    return this.mutate((state) => {
      state.blueprints = state.blueprints.filter((entry) => entry.blueprintId !== blueprintId);
      return blueprintId;
    });
  }

  exportBlueprint(blueprintId) {
    const blueprint = this._ensureLoaded().blueprints.find((entry) => entry.blueprintId === blueprintId);
    if (!blueprint) return { ok: false, reason: 'missing-blueprint' };
    return {
      ok: true,
      payload: {
        format: 'ruin-digger-buster-blueprint',
        formatVersion: 1,
        sourceContextId: this.saveContextId,
        blueprint: cloneJson(blueprint),
      },
    };
  }

  importBlueprint(payload) {
    const root = typeof payload === 'string' ? JSON.parse(payload) : cloneJson(payload);
    const source = root?.blueprint ?? root;
    return this.saveBlueprint({
      ...source,
      blueprintId: null,
      imported: true,
      sourceContextId: root?.sourceContextId ?? source?.sourceContextId ?? null,
    });
  }

  getFabricationRoutes(recipeOrId, state = this._ensureLoaded()) {
    const recipe = getBusterRecipe(recipeOrId);
    if (!recipe) return [];
    const discovery = getRecipeDiscoveryState(recipe, state.discovery);
    if (!discovery?.fullyDiscovered) return [];
    const roll = new RollSalvageStorage({
      ...state.rollSalvage,
      discoveredSalvageTypes: state.discovery.salvageTypes,
      discoveryHistory: state.discovery.history,
    });
    const original = roll.canTransactRecipe(recipe);
    const routes = [{
      id: 'original',
      label: 'Original fabrication',
      requirements: cloneJson(original.requirements),
      missing: cloneJson(original.missing),
      affordable: original.ok,
    }];
    if ((state.fabricationHistory?.[recipe.moduleId]?.originalCrafts ?? 0) > 0) {
      const replicationRecipe = {
        id: recipe.id,
        requirements: { identifiedScrap: recipe.scrapCost * 2, parts: {} },
      };
      const replication = roll.canTransactRecipe(replicationRecipe);
      routes.push({
        id: 'replication',
        label: 'Roll replication',
        requirements: cloneJson(replication.requirements),
        missing: cloneJson(replication.missing),
        affordable: replication.ok,
      });
    }
    return routes;
  }

  suggestMaterialization(blueprintOrId, options = {}) {
    return this._buildMaterializationSuggestion(this._ensureLoaded(), blueprintOrId, options, {
      revision: this.revision,
      writeId: this.writeId,
    });
  }

  async confirmMaterialization(suggestion, { routeSelections = {} } = {}) {
    if (!suggestion || suggestion.ok !== true) {
      return { ok: false, reason: 'invalid-suggestion', state: this._ensureLoaded() };
    }
    return this.transact({
      operation: 'materialize-blueprint',
      expectedRevision: suggestion.baseRevision,
      expectedWriteId: suggestion.baseWriteId,
    }, (state) => {
      const current = this._buildMaterializationSuggestion(
        state,
        suggestion.blueprintId,
        { buildId: suggestion.buildId, chassisId: suggestion.chassisId },
        { revision: suggestion.baseRevision, writeId: suggestion.baseWriteId },
      );
      if (!current.ok || current.blueprintRevision !== suggestion.blueprintRevision) {
        throw new BusterLabConflictError('The blueprint or materialization target changed.');
      }

      const assignments = { ...current.assignments };
      const roll = new RollSalvageStorage({
        ...state.rollSalvage,
        discoveredSalvageTypes: state.discovery.salvageTypes,
        discoveryHistory: state.discovery.history,
      });
      const fabricated = [];
      for (const request of current.requests) {
        if (request.instanceId) continue;
        if (request.discoveryLevel !== 'full') {
          const error = new Error(`Recipe for ${request.moduleId} is not fully discovered.`);
          error.code = 'RECIPE_REDACTED';
          throw error;
        }
        const recipe = getBusterRecipe(request.recipeId);
        if (!recipe) throw new Error(`No active recipe exists for ${request.moduleId}.`);
        const routes = this._getCandidateFabricationRoutes(recipe, state, roll);
        const affordable = routes.filter((route) => route.affordable);
        let selected = routeSelections[request.nodeId] ?? routeSelections[request.moduleId] ?? null;
        if (!selected && affordable.length === 1) selected = affordable[0].id;
        if (!selected && affordable.length > 1) {
          const error = new Error(`Choose an original or replication route for ${request.moduleId}.`);
          error.code = 'ROUTE_CHOICE_REQUIRED';
          throw error;
        }
        const route = routes.find((entry) => entry.id === selected);
        if (!route?.affordable) {
          const error = new Error(`The selected ${selected ?? 'fabrication'} route is unavailable for ${request.moduleId}.`);
          error.code = 'ROUTE_UNAVAILABLE';
          throw error;
        }
        const instanceId = this._allocateInstanceId(state, 'module');
        const transaction = roll.transactRecipe(route.recipe, {
          result: {
            id: instanceId,
            instanceId,
            moduleInstanceId: instanceId,
            moduleId: recipe.moduleId,
            recipeId: recipe.id,
            name: recipe.name,
            origin: 'fabricated',
            fabricationRoute: route.id,
            fabricationSequence: state.nextInstanceId - 1,
          },
        });
        if (!transaction.ok) throw transaction.error ?? new Error(`Could not fabricate ${request.moduleId}.`);
        state.moduleInstances.push(transaction.result);
        assignments[request.nodeId] = instanceId;
        fabricated.push({ moduleId: recipe.moduleId, instanceId, route: route.id, spent: transaction.spent });
        const history = state.fabricationHistory[recipe.moduleId] ?? {
          originalCrafts: 0,
          replicationCrafts: 0,
          firstOriginalSequence: null,
        };
        if (route.id === 'original') {
          history.originalCrafts += 1;
          if (history.firstOriginalSequence == null) history.firstOriginalSequence = state.nextInstanceId - 1;
        } else {
          history.replicationCrafts += 1;
        }
        state.fabricationHistory[recipe.moduleId] = history;
      }
      this._applyRollSnapshot(state, roll.serialize());

      const blueprint = state.blueprints.find((entry) => entry.blueprintId === current.blueprintId);
      const build = {
        schemaVersion: blueprint.schemaVersion,
        rulesetVersion: BUSTER_LAB_RULESET_VERSION,
        buildId: current.buildId,
        chassisId: current.chassisId,
        name: blueprint.name,
        tuning: cloneJson(blueprint.tuning),
        program: {
          rootNodeId: blueprint.program.rootNodeId,
          nodes: blueprint.program.nodes.map((node) => ({
            nodeId: node.nodeId,
            moduleId: node.moduleId,
            moduleInstanceId: assignments[node.nodeId] ?? null,
          })),
          edges: cloneJson(blueprint.program.edges),
        },
      };
      const buildIndex = state.chassisBuilds.findIndex((entry) => entry.buildId === build.buildId);
      if (buildIndex >= 0) state.chassisBuilds[buildIndex] = build;
      else state.chassisBuilds.push(build);
      const draftIndex = state.chassisDrafts.findIndex((entry) => entry.buildId === build.buildId);
      if (draftIndex >= 0) state.chassisDrafts[draftIndex] = cloneJson(build);
      else state.chassisDrafts.push(cloneJson(build));
      const revision = 1 + state.chassisRevisions
        .filter((entry) => entry.buildId === build.buildId)
        .reduce((maximum, entry) => Math.max(maximum, entry.revision), 0);
      state.chassisRevisions.push({
        revisionId: `${build.buildId}-r${revision}`,
        buildId: build.buildId,
        chassisId: build.chassisId,
        revision,
        snapshot: cloneJson(build),
      });
      return { build: cloneJson(build), fabricated };
    });
  }

  purchaseSecondChassis() {
    const current = this._ensureLoaded();
    if (current.chassisInstances.some((chassis) => chassis.chassisId === 'chassis-b')
      || current.chassisInstances.length >= MAX_BUSTER_CHASSIS) {
      return { ok: false, reason: 'chassis-limit', state: current };
    }

    const candidate = cloneJson(current);
    const roll = new RollSalvageStorage({
      ...candidate.rollSalvage,
      discoveredSalvageTypes: candidate.discovery.salvageTypes,
      discoveryHistory: candidate.discovery.history,
    });
    const purchase = roll.transactRecipe({
      id: 'secondChassis',
      requirements: { identifiedScrap: SECOND_BUSTER_CHASSIS_COST, parts: {} },
    });
    if (!purchase.ok) return { ...purchase, reason: 'insufficient-scrap', state: current };

    const chassis = secondChassis();
    const draft = secondChassisDraft();
    candidate.chassisInstances.push(chassis);
    candidate.chassisDrafts.push(draft);
    this._applyRollSnapshot(candidate, roll.serialize());
    try {
      const normalized = this.deserialize(JSON.stringify(candidate));
      this._persistCandidate(normalized);
      this._adoptState(normalized);
      return {
        ok: true,
        chassis: cloneJson(chassis),
        draft: cloneJson(draft),
        spent: purchase.spent,
        state: this.state,
      };
    } catch (error) {
      return { ok: false, reason: 'transaction-failed', error, state: current };
    }
  }

  fabricateSecondChassis() {
    return this.purchaseSecondChassis();
  }

  purchaseChassis() {
    return this.purchaseSecondChassis();
  }

  saveDraft(draft) {
    const sanitized = sanitizeBuild(draft);
    if (!sanitized) return { ok: false, reason: 'invalid-draft', state: this._ensureLoaded() };
    if (!this._ensureLoaded().chassisInstances.some((entry) => entry.chassisId === sanitized.chassisId)) {
      return { ok: false, reason: 'missing-chassis', state: this.state };
    }
    const result = this.mutate((state) => {
      const index = state.chassisDrafts.findIndex((entry) => entry.buildId === sanitized.buildId);
      if (index >= 0) state.chassisDrafts[index] = sanitized;
      else state.chassisDrafts.push(sanitized);
      return sanitized;
    });
    return result.ok ? { ...result, draft: sanitized } : result;
  }

  saveChassisBuild(build) {
    const sanitized = sanitizeBuild(build);
    if (!sanitized) return { ok: false, reason: 'invalid-build', state: this._ensureLoaded() };
    const current = this._ensureLoaded();
    const structuralErrors = validateBuildGraph(sanitized);
    const compilerValidation = validateBusterBuild(sanitized, {
      context: {
        ownedModuleInstanceIds: current.moduleInstances.map((entry) => entry.instanceId),
        claimedModuleInstanceIds: getClaimedModuleInstanceIds(current, {
          excludeBuildId: sanitized.buildId,
        }),
      },
    });
    if (structuralErrors.length > 0 || !compilerValidation.valid) {
      return {
        ok: false,
        reason: 'invalid-build',
        errors: [...structuralErrors, ...compilerValidation.errors],
        state: current,
      };
    }
    const result = this.mutate((state) => {
      const index = state.chassisBuilds.findIndex((entry) => entry.buildId === sanitized.buildId);
      if (index >= 0) state.chassisBuilds[index] = sanitized;
      else state.chassisBuilds.push(sanitized);
      const draftIndex = state.chassisDrafts.findIndex((entry) => entry.buildId === sanitized.buildId);
      if (draftIndex >= 0) state.chassisDrafts[draftIndex] = cloneJson(sanitized);
      else state.chassisDrafts.push(cloneJson(sanitized));
      if (Array.isArray(state.migrations?.unknownModuleQuarantine)) {
        state.migrations.unknownModuleQuarantine = state.migrations.unknownModuleQuarantine
          .filter((entry) => entry?.buildId !== sanitized.buildId);
        if (state.migrations.unknownModuleQuarantine.length === 0) {
          delete state.migrations.unknownModuleQuarantine;
        }
      }
      const revision = 1 + state.chassisRevisions
        .filter((entry) => entry.buildId === sanitized.buildId)
        .reduce((maximum, entry) => Math.max(maximum, entry.revision), 0);
      state.chassisRevisions.push({
        revisionId: `${sanitized.buildId}-r${revision}`,
        buildId: sanitized.buildId,
        chassisId: sanitized.chassisId,
        revision,
        snapshot: cloneJson(sanitized),
      });
      return sanitized;
    });
    return result.ok ? { ...result, build: sanitized } : result;
  }

  saveBuild(build) {
    return this.saveChassisBuild(build);
  }

  assignBuildToSlot(buildId, slotIndex) {
    const current = this._ensureLoaded();
    const slot = String(Math.trunc(Number(slotIndex)));
    if (slot !== '1' && slot !== '2') {
      return { ok: false, reason: 'invalid-slot', state: current };
    }
    if (buildId == null) {
      return this.mutate((state) => {
        state.assignments = {
          ...state.assignments,
          slots: { 1: null, 2: null, ...plainObject(state.assignments.slots), [slot]: null },
        };
        return cloneJson(state.assignments);
      });
    }
    const build = current.chassisBuilds.find((entry) => entry.buildId === buildId);
    if (!build) return { ok: false, reason: 'invalid-build', state: current };
    return this.mutate((state) => {
      const slots = { 1: null, 2: null, ...plainObject(state.assignments.slots) };
      // One physical chassis cannot occupy both arm hotbar assignments.
      for (const key of ['1', '2']) if (slots[key] === build.buildId) slots[key] = null;
      slots[slot] = build.buildId;
      state.assignments = {
        ...state.assignments,
        slots,
      };
      return cloneJson(state.assignments);
    });
  }

  setAssignments(assignments) {
    return this.mutate((state) => {
      state.assignments = plainObject(assignments);
      return cloneJson(state.assignments);
    });
  }

  setMegaCalibrationState(calibrations) {
    return this.mutate((state) => {
      state.megaCalibrations = normalizeMegaCalibrations(calibrations);
      return cloneJson(state.megaCalibrations);
    });
  }

  setMegaCalibration(slotIndex, instanceId) {
    if (slotIndex && typeof slotIndex === 'object' && instanceId === undefined) {
      return this.setMegaCalibrationState(slotIndex);
    }
    const slot = Math.trunc(Number(slotIndex));
    if (slot < 0 || slot > 3 || (instanceId !== null && typeof instanceId !== 'string')) {
      return { ok: false, reason: 'invalid-calibration-slot', state: this._ensureLoaded() };
    }
    const current = this._ensureLoaded();
    if (instanceId !== null
      && !current.megaCalibrations.instances.some((entry) => entry.instanceId === instanceId)) {
      return { ok: false, reason: 'missing-calibration', state: current };
    }
    if (instanceId !== null
      && current.megaCalibrations.slots.some((entry, index) => index !== slot && entry === instanceId)) {
      return { ok: false, reason: 'calibration-already-installed', state: current };
    }
    return this.mutate((state) => {
      if (state.megaCalibrations.slots[slot] !== instanceId) {
        state.megaCalibrations.revision += 1;
      }
      state.megaCalibrations.slots[slot] = instanceId;
      return cloneJson(state.megaCalibrations);
    });
  }

  registerLegacyBusterPart(item, {
    legacyType = item?.legacyType ?? item?.type ?? null,
    location = { kind: 'inventory' },
    starter = false,
    occupiedInventoryCount = 0,
  } = {}) {
    const definition = MEGA_BUSTER_CALIBRATION_CATALOG[legacyType];
    if (!definition) return { ok: false, reason: 'unsupported-legacy-type', state: this._ensureLoaded() };
    const normalizedLocation = sanitizeLegacyLocation(location);
    const current = this._ensureLoaded();
    const claimedLegacyId = typeof item?.legacyBusterId === 'string' && item.legacyBusterId
      ? item.legacyBusterId
      : typeof item?.canonicalId === 'string' && item.canonicalId
        ? item.canonicalId
        : null;
    const existing = claimedLegacyId
      ? current.legacyBusterParts.records.find((entry) => entry.legacyId === claimedLegacyId)
      : null;
    if (existing) {
      return {
        ok: true,
        created: false,
        record: cloneJson(existing),
        state: current,
      };
    }
    if (normalizedLocation.kind === 'inventory'
      && Math.max(0, nonNegativeInteger(occupiedInventoryCount))
        + current.legacyBusterParts.records.filter((entry) => entry.location.kind === 'inventory').length
        >= LEGACY_BUSTER_INVENTORY_CAPACITY) {
      return { ok: false, reason: 'inventory-capacity', state: current };
    }
    const result = this.mutate((state) => {
      const sequence = state.legacyBusterParts.nextSequence++;
      const legacyId = `legacy-buster:${this.saveContextId}:${sequence}`;
      const calibrationInstanceId = `${legacyId}:calibration`;
      if (normalizedLocation.kind === 'megaSocket'
        && state.megaCalibrations.slots[normalizedLocation.socketIndex] !== null) {
        throw new RangeError(`Mega calibration socket ${normalizedLocation.socketIndex} is occupied.`);
      }
      state.megaCalibrations.instances.push({
        instanceId: calibrationInstanceId,
        legacyType,
        name: definition.name,
        bonuses: { ...definition.bonuses },
      });
      if (normalizedLocation.kind === 'megaSocket') {
        state.megaCalibrations.slots[normalizedLocation.socketIndex] = calibrationInstanceId;
        state.megaCalibrations.revision += 1;
      }
      const record = {
        legacyId,
        legacyType,
        calibrationInstanceId,
        item: { ...plainObject(item), canonicalId: legacyId },
        location: normalizedLocation,
        starter: Boolean(starter),
        createdSequence: sequence,
      };
      state.legacyBusterParts.records.push(record);
      if (starter) state.legacyBusterParts.starterRegistered = true;
      return cloneJson(record);
    });
    return result.ok ? { ...result, record: result.result } : result;
  }

  ensureStarterPowerRaiserShadow(item = {}) {
    const existing = this._ensureLoaded().legacyBusterParts.records.find((entry) => entry.starter);
    if (existing) return { ok: true, created: false, record: cloneJson(existing), state: this.state };
    // `starterRegistered` is an ever-granted campaign marker. A player who
    // deliberately sells/scraps the canonical starter must not receive a new
    // copy merely by toggling the feature flag or reloading the page.
    if (this._ensureLoaded().legacyBusterParts.starterRegistered) {
      return { ok: true, created: false, record: null, state: this.state };
    }
    const result = this.registerLegacyBusterPart({
      ...item,
      type: 'powerRaiser',
      name: item.name ?? 'Power Raiser',
      rarity: item.rarity ?? 'standard',
    }, {
      legacyType: 'powerRaiser',
      location: { kind: 'megaSocket', socketIndex: 0 },
      starter: true,
    });
    return result.ok ? { ...result, created: true } : result;
  }

  moveLegacyBusterPart(legacyId, location, { occupiedInventoryCount = 0 } = {}) {
    const normalizedLocation = sanitizeLegacyLocation(location);
    const current = this._ensureLoaded();
    const record = current.legacyBusterParts.records.find((entry) => entry.legacyId === legacyId);
    if (!record) return { ok: false, reason: 'missing-legacy-record', state: current };
    if (normalizedLocation.kind === 'inventory' && record.location.kind !== 'inventory'
      && nonNegativeInteger(occupiedInventoryCount)
        + current.legacyBusterParts.records.filter((entry) => entry.location.kind === 'inventory').length
        >= LEGACY_BUSTER_INVENTORY_CAPACITY) {
      return { ok: false, reason: 'inventory-capacity', state: current };
    }
    return this.mutate((state) => {
      const mutable = state.legacyBusterParts.records.find((entry) => entry.legacyId === legacyId);
      const oldSocket = mutable.location.kind === 'megaSocket' ? mutable.location.socketIndex : null;
      if (normalizedLocation.kind === 'megaSocket') {
        const occupant = state.megaCalibrations.slots[normalizedLocation.socketIndex];
        if (occupant !== null && occupant !== mutable.calibrationInstanceId) {
          throw new RangeError(`Mega calibration socket ${normalizedLocation.socketIndex} is occupied.`);
        }
      }
      if (oldSocket !== null && state.megaCalibrations.slots[oldSocket] === mutable.calibrationInstanceId) {
        state.megaCalibrations.slots[oldSocket] = null;
      }
      if (normalizedLocation.kind === 'megaSocket') {
        state.megaCalibrations.slots[normalizedLocation.socketIndex] = mutable.calibrationInstanceId;
      }
      if (JSON.stringify(mutable.location) !== JSON.stringify(normalizedLocation)) {
        state.megaCalibrations.revision += 1;
      }
      mutable.location = normalizedLocation;
      return cloneJson(mutable);
    });
  }

  updateLegacyBusterItem(legacyId, updater) {
    const current = this._ensureLoaded();
    if (!current.legacyBusterParts.records.some((entry) => entry.legacyId === legacyId)) {
      return { ok: false, reason: 'missing-legacy-record', state: current };
    }
    return this.mutate((state) => {
      const record = state.legacyBusterParts.records.find((entry) => entry.legacyId === legacyId);
      const next = typeof updater === 'function' ? updater(cloneJson(record.item)) : updater;
      record.item = { ...plainObject(next), canonicalId: legacyId };
      return cloneJson(record);
    });
  }

  removeLegacyBusterPart(legacyId) {
    const current = this._ensureLoaded();
    if (!current.legacyBusterParts.records.some((entry) => entry.legacyId === legacyId)) {
      return { ok: false, reason: 'missing-legacy-record', state: current };
    }
    return this.mutate((state) => {
      const record = state.legacyBusterParts.records.find((entry) => entry.legacyId === legacyId);
      state.legacyBusterParts.records = state.legacyBusterParts.records
        .filter((entry) => entry.legacyId !== legacyId);
      state.megaCalibrations.instances = state.megaCalibrations.instances
        .filter((entry) => entry.instanceId !== record.calibrationInstanceId);
      state.megaCalibrations.slots = state.megaCalibrations.slots
        .map((entry) => entry === record.calibrationInstanceId ? null : entry);
      state.megaCalibrations.revision += 1;
      return cloneJson(record);
    });
  }

  reconcileLegacyBusterParts({ locations = [], removals = [] } = {}, {
    occupiedInventoryCount = 0,
  } = {}) {
    const current = this._ensureLoaded();
    const removalIds = new Set((Array.isArray(removals) ? removals : [])
      .filter((legacyId) => typeof legacyId === 'string' && legacyId));
    const desiredLocations = new Map();
    for (const entry of Array.isArray(locations) ? locations : []) {
      if (!entry || typeof entry.legacyId !== 'string' || !entry.legacyId) continue;
      if (removalIds.has(entry.legacyId)) continue;
      desiredLocations.set(entry.legacyId, sanitizeLegacyLocation(entry.location));
    }
    const recordsById = new Map(current.legacyBusterParts.records
      .map((record) => [record.legacyId, record]));
    for (const legacyId of [...removalIds, ...desiredLocations.keys()]) {
      if (!recordsById.has(legacyId)) {
        return { ok: false, reason: 'missing-legacy-record', legacyId, state: current };
      }
    }

    const projectedRecords = current.legacyBusterParts.records
      .filter((record) => !removalIds.has(record.legacyId))
      .map((record) => ({
        ...record,
        location: desiredLocations.get(record.legacyId) ?? record.location,
      }));
    const targetSockets = new Set();
    for (const record of projectedRecords) {
      if (record.location.kind !== 'megaSocket') continue;
      if (targetSockets.has(record.location.socketIndex)) {
        return { ok: false, reason: 'socket-occupied', state: current };
      }
      targetSockets.add(record.location.socketIndex);
    }
    const logicalInventoryCount = projectedRecords
      .filter((record) => record.location.kind === 'inventory').length;
    if (logicalInventoryCount + nonNegativeInteger(occupiedInventoryCount)
      > LEGACY_BUSTER_INVENTORY_CAPACITY) {
      return { ok: false, reason: 'inventory-capacity', state: current };
    }

    const result = this.mutate((state) => {
      const affectedIds = new Set([...removalIds, ...desiredLocations.keys()]);
      const affectedCalibrationIds = new Set(state.legacyBusterParts.records
        .filter((record) => affectedIds.has(record.legacyId))
        .map((record) => record.calibrationInstanceId));

      // Clear every affected reciprocal socket before assigning any target so
      // a two-way socket swap is one valid atomic operation.
      state.megaCalibrations.slots = state.megaCalibrations.slots.map((instanceId) => (
        affectedCalibrationIds.has(instanceId) ? null : instanceId
      ));

      const removedCalibrationIds = new Set(state.legacyBusterParts.records
        .filter((record) => removalIds.has(record.legacyId))
        .map((record) => record.calibrationInstanceId));
      state.legacyBusterParts.records = state.legacyBusterParts.records
        .filter((record) => !removalIds.has(record.legacyId));
      state.megaCalibrations.instances = state.megaCalibrations.instances
        .filter((entry) => !removedCalibrationIds.has(entry.instanceId));

      for (const record of state.legacyBusterParts.records) {
        const location = desiredLocations.get(record.legacyId);
        if (!location) continue;
        record.location = location;
      }
      for (const record of state.legacyBusterParts.records) {
        if (record.location.kind !== 'megaSocket') continue;
        const occupant = state.megaCalibrations.slots[record.location.socketIndex];
        if (occupant !== null && occupant !== record.calibrationInstanceId) {
          const error = new RangeError(`Mega calibration socket ${record.location.socketIndex} is occupied.`);
          error.busterReason = 'socket-occupied';
          throw error;
        }
        state.megaCalibrations.slots[record.location.socketIndex] = record.calibrationInstanceId;
      }
      if (affectedIds.size > 0) state.megaCalibrations.revision += 1;
      return {
        removedLegacyIds: [...removalIds],
        movedLegacyIds: [...desiredLocations.keys()],
      };
    });
    return result.ok ? { ...result, ...result.result } : result;
  }

  getLegacyBusterView({ featureEnabled = false } = {}) {
    const records = this._ensureLoaded().legacyBusterParts.records;
    return records.map((record) => ({
      legacyId: record.legacyId,
      legacyType: record.legacyType,
      location: cloneJson(record.location),
      item: featureEnabled ? null : cloneJson(record.item),
      calibrationInstanceId: featureEnabled ? record.calibrationInstanceId : null,
    }));
  }

  registerLegacyBusterPartAsync(item, options = {}, concurrency = {}) {
    return this._runAsyncCommand(
      'register-legacy-buster-part',
      (lab) => lab.registerLegacyBusterPart(item, options),
      concurrency,
    );
  }

  ensureStarterPowerRaiserShadowAsync(item = {}, concurrency = {}) {
    return this._runAsyncCommand(
      'ensure-starter-power-raiser',
      (lab) => lab.ensureStarterPowerRaiserShadow(item),
      concurrency,
    );
  }

  moveLegacyBusterPartAsync(legacyId, location, options = {}, concurrency = {}) {
    return this._runAsyncCommand(
      'move-legacy-buster-part',
      (lab) => lab.moveLegacyBusterPart(legacyId, location, options),
      concurrency,
    );
  }

  updateLegacyBusterItemAsync(legacyId, updater, concurrency = {}) {
    return this._runAsyncCommand(
      'update-legacy-buster-item',
      (lab) => lab.updateLegacyBusterItem(legacyId, updater),
      concurrency,
    );
  }

  removeLegacyBusterPartAsync(legacyId, concurrency = {}) {
    return this._runAsyncCommand(
      'remove-legacy-buster-part',
      (lab) => lab.removeLegacyBusterPart(legacyId),
      concurrency,
    );
  }

  reconcileLegacyBusterPartsAsync(commands = {}, options = {}, concurrency = {}) {
    return this._runAsyncCommand(
      'reconcile-legacy-buster-parts',
      (lab) => lab.reconcileLegacyBusterParts(commands, options),
      concurrency,
    );
  }

  getOwnedModuleInstanceIds() {
    return this._ensureLoaded().moduleInstances.map((module) => module.instanceId);
  }

  getState() {
    return this._ensureLoaded();
  }

  inspectLegacyV1() {
    if (!this.storage) return { eligible: false, reason: 'storage-unavailable' };
    const claimed = this.storage.getItem(BUSTER_LAB_V1_IMPORT_CLAIM_KEY);
    if (claimed) {
      let claim = null;
      try { claim = JSON.parse(claimed); } catch { /* Preserve the blocking claim even if malformed. */ }
      return { eligible: false, reason: 'already-claimed', claim };
    }
    const raw = this.storage.getItem(BUSTER_LAB_LEGACY_STORAGE_KEY);
    if (!raw) return { eligible: false, reason: 'missing' };
    try {
      const state = migrateBusterLabState(JSON.parse(raw));
      return {
        eligible: true,
        summary: {
          identifiedScrap: state.rollSalvage.identifiedScrap,
          namedPartCount: Object.values(state.rollSalvage.parts)
            .reduce((total, part) => total + nonNegativeInteger(part.quantity), 0),
          moduleCount: state.moduleInstances.length,
          chassisCount: state.chassisInstances.length,
          buildCount: state.chassisBuilds.length,
          calibrationCount: state.megaCalibrations.instances.length,
          afterDelayRefund: cloneJson(state.migrations.afterDelayBuiltInV2),
        },
      };
    } catch (error) {
      return { eligible: false, reason: 'corrupt', error };
    }
  }

  async adoptLegacyV1({ confirmed = false } = {}) {
    if (!confirmed) return { ok: false, reason: 'confirmation-required', preview: this.inspectLegacyV1() };
    if (this.readOnly) return { ok: false, reason: 'read-only', state: this._ensureLoaded() };
    const globalLock = 'ruinDigger:busterLab:v1-adoption';
    try {
      return await withBusterLabLock(this.lockManager, globalLock, async () => {
        const preview = this.inspectLegacyV1();
        if (!preview.eligible) return { ok: false, reason: preview.reason, preview };
        const legacyRaw = this.storage.getItem(BUSTER_LAB_LEGACY_STORAGE_KEY);
        const candidate = migrateBusterLabState(JSON.parse(legacyRaw));
        const committed = await this._withLock(async () => {
          const latest = this._readCurrentEnvelope();
          const envelope = this._persistCandidate(candidate, {
            expectedRevision: latest?.revision ?? 0,
            expectedWriteId: latest?.writeId ?? null,
            allowMissing: latest == null,
          });
          this._adoptState(candidate);
          this._adoptEnvelopeMetadata(envelope);
          this.storage.setItem(BUSTER_LAB_V1_IMPORT_CLAIM_KEY, JSON.stringify({
            storageVersion: 1,
            saveContextId: this.saveContextId,
            adoptedAt: new Date().toISOString(),
            sourceKey: BUSTER_LAB_LEGACY_STORAGE_KEY,
          }));
          this.pendingLegacyAdoption = false;
          return { ok: true, state: this.state, revision: this.revision, writeId: this.writeId };
        });
        return committed;
      }, { timeoutMs: this.lockTimeoutMs });
    } catch (error) {
      return {
        ok: false,
        reason: error?.code === 'BUSTER_LAB_LOCK_TIMEOUT' ? 'lock-timeout' : 'transaction-failed',
        error,
        state: this.state,
      };
    }
  }

  async beginNewCampaign({ confirmed = false } = {}) {
    if (!confirmed) return { ok: false, reason: 'confirmation-required' };
    if (!this.storage) return { ok: false, reason: 'storage-unavailable' };
    const nextContextId = rotateSaveContext(this.storage, { idFactory: this.idFactory });
    this.saveContextId = nextContextId;
    this.storageKeys = getBusterLabStorageKeys(nextContextId);
    this.lockName = getBusterLabLockName(nextContextId);
    this.state = null;
    this.revision = 0;
    this.writeId = null;
    this.updatedAt = null;
    await this.open();
    return { ok: true, saveContextId: nextContextId, state: this.state };
  }

  getClaimedModuleInstanceIds(options = {}) {
    return getClaimedModuleInstanceIds(this._ensureLoaded(), options);
  }

  _ensureLoaded() {
    return this.state ?? this.load();
  }

  _getCandidateFabricationRoutes(recipe, state, roll) {
    const originalCheck = roll.canTransactRecipe(recipe);
    const routes = [{ id: 'original', recipe, affordable: originalCheck.ok, check: originalCheck }];
    if ((state.fabricationHistory?.[recipe.moduleId]?.originalCrafts ?? 0) > 0) {
      const replicationRecipe = {
        id: recipe.id,
        requirements: { identifiedScrap: recipe.scrapCost * 2, parts: {} },
      };
      const replicationCheck = roll.canTransactRecipe(replicationRecipe);
      routes.push({
        id: 'replication',
        recipe: replicationRecipe,
        affordable: replicationCheck.ok,
        check: replicationCheck,
      });
    }
    return routes;
  }

  _buildMaterializationSuggestion(state, blueprintOrId, options = {}, metadata = {}) {
    const blueprint = typeof blueprintOrId === 'string'
      ? state.blueprints.find((entry) => entry.blueprintId === blueprintOrId)
      : sanitizeBlueprint(blueprintOrId);
    if (!blueprint) return { ok: false, reason: 'missing-blueprint' };

    const existingBuild = options.buildId
      ? state.chassisBuilds.find((entry) => entry.buildId === options.buildId)
      : null;
    const chassisId = options.chassisId
      ?? existingBuild?.chassisId
      ?? state.chassisInstances[0]?.chassisId
      ?? null;
    const chassis = state.chassisInstances.find((entry) => entry.chassisId === chassisId);
    if (!chassis) return { ok: false, reason: 'missing-chassis', blueprintId: blueprint.blueprintId };
    const buildId = options.buildId
      ?? state.chassisBuilds.find((entry) => entry.chassisId === chassisId)?.buildId
      ?? (chassisId === 'chassis-a' ? 'build-a' : 'build-b');

    const claimed = new Set(getClaimedModuleInstanceIds(state, { excludeBuildId: buildId }));
    const available = state.moduleInstances
      .filter((entry) => !claimed.has(entry.instanceId))
      .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
    const used = new Set();
    const assignments = {};
    const requests = [];
    const blocked = [];
    const planningState = cloneJson(state);
    const roll = new RollSalvageStorage({
      ...state.rollSalvage,
      discoveredSalvageTypes: state.discovery.salvageTypes,
      discoveryHistory: state.discovery.history,
    });

    for (const node of getProgramNodesInGraphOrder(blueprint.program)) {
      const definition = getBusterModuleDefinition(node.moduleId);
      if (!definition) {
        blocked.push({ code: 'UNKNOWN_MODULE', nodeId: node.nodeId });
        requests.push({ nodeId: node.nodeId, moduleId: null, discoveryLevel: 'unknown', unavailable: true });
        continue;
      }
      if (!definition.physical || NON_PHYSICAL_BUILTIN_MODULE_IDS.has(node.moduleId)) {
        assignments[node.nodeId] = null;
        continue;
      }
      const owned = available.find((entry) => (
        !used.has(entry.instanceId) && entry.moduleId === node.moduleId
      ));
      if (owned) {
        used.add(owned.instanceId);
        assignments[node.nodeId] = owned.instanceId;
        requests.push({
          nodeId: node.nodeId,
          moduleId: node.moduleId,
          displayName: definition.label,
          instanceId: owned.instanceId,
          discoveryLevel: 'owned',
          routes: [],
        });
        continue;
      }

      const recipe = getBusterRecipe(node.moduleId);
      const discovery = recipe ? getRecipeDiscoveryState(recipe, state.discovery) : null;
      if (!recipe) {
        blocked.push({ code: 'NO_ACTIVE_RECIPE', nodeId: node.nodeId, moduleId: node.moduleId });
        requests.push({
          nodeId: node.nodeId,
          moduleId: discovery?.discovered ? node.moduleId : null,
          displayName: discovery?.displayName ?? 'Unknown Buster Part',
          discoveryLevel: discovery?.level ?? 'unknown',
          unavailable: true,
        });
        continue;
      }
      if (!discovery?.fullyDiscovered) {
        blocked.push({
          code: discovery?.discovered ? 'RECIPE_PARTIAL' : 'RECIPE_UNKNOWN',
          nodeId: node.nodeId,
          moduleId: discovery?.discovered ? node.moduleId : null,
        });
        requests.push({
          nodeId: node.nodeId,
          moduleId: discovery?.discovered ? node.moduleId : null,
          displayName: discovery?.displayName ?? 'Unknown Buster Part',
          discoveryLevel: discovery?.level ?? 'unknown',
          clue: discovery?.clue ?? null,
          // No recipe id, ingredient ids, costs, or affordability escape this
          // domain boundary before full discovery.
          routes: [],
        });
        continue;
      }
      const candidateRoutes = this._getCandidateFabricationRoutes(recipe, planningState, roll);
      const routes = candidateRoutes.map((route) => ({
        id: route.id,
        label: route.id === 'original' ? 'Original fabrication' : 'Roll replication',
        requirements: cloneJson(route.check.requirements),
        missing: cloneJson(route.check.missing),
        affordable: route.affordable,
      }));
      const affordableCount = routes.filter((route) => route.affordable).length;
      if (affordableCount === 0) blocked.push({ code: 'INSUFFICIENT_RESOURCES', nodeId: node.nodeId, moduleId: node.moduleId });
      requests.push({
        nodeId: node.nodeId,
        moduleId: node.moduleId,
        displayName: definition.label,
        recipeId: recipe.id,
        instanceId: null,
        discoveryLevel: 'full',
        routes,
        requiresRouteChoice: affordableCount > 1,
      });
      // Suggestion affordability follows the same deterministic graph order as
      // confirmation. Prefer an original route for the provisional ledger so
      // its successful craft can unlock replication for a later copy of the
      // same module within this one atomic materialization.
      const plannedRoute = candidateRoutes.find((route) => route.id === 'original' && route.affordable)
        ?? candidateRoutes.find((route) => route.affordable)
        ?? null;
      if (plannedRoute) {
        const plannedTransaction = roll.transactRecipe(plannedRoute.recipe);
        if (plannedTransaction.ok) {
          const history = planningState.fabricationHistory[recipe.moduleId] ?? {
            originalCrafts: 0,
            replicationCrafts: 0,
            firstOriginalSequence: null,
          };
          if (plannedRoute.id === 'original') history.originalCrafts += 1;
          else history.replicationCrafts += 1;
          planningState.fabricationHistory[recipe.moduleId] = history;
        }
      }
    }

    return {
      ok: true,
      blueprintId: blueprint.blueprintId,
      blueprintRevision: blueprint.revision,
      buildId,
      chassisId,
      baseRevision: metadata.revision ?? this.revision,
      baseWriteId: metadata.writeId ?? this.writeId,
      assignments,
      requests,
      blocked,
      canConfirm: blocked.length === 0,
    };
  }

  _adoptState(nextState) {
    if (!this.state || this.state === nextState) {
      this.state = nextState;
      return this.state;
    }
    // Keep references returned by load() live for Game/UI consumers. A
    // candidate reaches this point only after its persistence write succeeds,
    // so a failed transaction still leaves the current object untouched.
    if (Object.prototype.hasOwnProperty.call(this.state, 'warning')) delete this.state.warning;
    for (const key of Object.keys(this.state)) delete this.state[key];
    Object.assign(this.state, nextState);
    return this.state;
  }

  _adoptEnvelopeMetadata(envelope) {
    this.revision = envelope?.revision ?? 0;
    this.writeId = envelope?.writeId ?? null;
    this.updatedAt = envelope?.updatedAt ?? null;
  }

  _tryReadEnvelope(key) {
    try {
      const raw = this.storage?.getItem(key);
      if (!raw) return { ok: false, reason: 'missing' };
      const envelope = parseBusterLabEnvelope(raw, { expectedSaveContextId: this.saveContextId });
      // State validation is part of deciding whether a backup is safe.
      this.deserialize(envelope.state);
      return { ok: true, envelope, raw };
    } catch (error) {
      return { ok: false, reason: 'invalid', error };
    }
  }

  _readCurrentEnvelope() {
    if (!this.storage) return null;
    const raw = this.storage.getItem(this.storageKeys.main);
    if (!raw) return null;
    const envelope = parseBusterLabEnvelope(raw, { expectedSaveContextId: this.saveContextId });
    this.deserialize(envelope.state);
    return envelope;
  }

  _quarantineCorruptPayload(raw, error) {
    if (!this.storage || raw == null) return;
    try {
      this.storage.setItem(this.storageKeys.corrupt, JSON.stringify({
        storageVersion: 1,
        saveContextId: this.saveContextId,
        capturedAt: new Date().toISOString(),
        error: error?.message ?? String(error),
        payload: String(raw),
      }));
    } catch {
      // Recovery must never fail merely because quarantine storage is full.
    }
  }

  _withLock(callback) {
    return withBusterLabLock(this.lockManager, this.lockName, callback, {
      timeoutMs: this.lockTimeoutMs,
    });
  }

  _allocateInstanceId(state, kind) {
    const used = new Set([
      ...state.moduleInstances.map((entry) => entry.instanceId),
      ...state.chassisInstances.map((entry) => entry.chassisId),
    ]);
    let id = '';
    do {
      const sequence = state.nextInstanceId;
      state.nextInstanceId += 1;
      id = this.idFactory
        ? this.idFactory(kind, sequence, state)
        : `${kind}-${sequence}`;
      if (typeof id !== 'string' || !id) id = `${kind}-${sequence}`;
    } while (used.has(id));
    return id;
  }

  _applyRollSnapshot(state, snapshot) {
    state.rollSalvage = {
      identifiedScrap: nonNegativeInteger(snapshot.identifiedScrap),
      parts: plainObject(snapshot.parts),
    };
    state.discovery = refreshRecipeHistory({
      salvageTypes: Array.isArray(snapshot.discoveredSalvageTypes)
        ? [...snapshot.discoveredSalvageTypes]
        : [],
      history: Array.isArray(snapshot.discoveryHistory)
        ? cloneJson(snapshot.discoveryHistory, [])
        : [],
      recipeHistory: plainObject(state.discovery.recipeHistory),
    });
  }

  _commitRollSnapshot(snapshot) {
    const candidate = cloneJson(this._ensureLoaded());
    this._applyRollSnapshot(candidate, snapshot);
    try {
      const normalized = this.deserialize(JSON.stringify(candidate));
      this._persistCandidate(normalized);
      this._adoptState(normalized);
      return { ok: true, state: this.state };
    } catch (error) {
      return { ok: false, reason: 'transaction-failed', error, state: this.state };
    }
  }

  _persistCandidate(candidate, {
    expectedRevision = this.revision,
    expectedWriteId = this.writeId,
    allowMissing = false,
  } = {}) {
    const normalized = this.deserialize(candidate);
    if (!this.storage) {
      const envelope = createBusterLabEnvelope({
        saveContextId: this.saveContextId,
        state: normalized,
        revision: Math.max(0, expectedRevision ?? 0) + 1,
      });
      this._adoptEnvelopeMetadata(envelope);
      this.lastSaveSucceeded = true;
      return envelope;
    }
    try {
      const currentRaw = this.storage.getItem(this.storageKeys.main);
      const current = currentRaw
        ? parseBusterLabEnvelope(currentRaw, { expectedSaveContextId: this.saveContextId })
        : null;
      if (!current && !allowMissing && (expectedRevision ?? 0) !== 0) {
        throw new BusterLabConflictError('The current Buster Lab payload disappeared before commit.', {
          expectedRevision,
          actualRevision: 0,
          expectedWriteId,
          actualWriteId: null,
        });
      }
      if (current && expectedRevision != null && current.revision !== expectedRevision) {
        throw new BusterLabConflictError('The Buster Lab revision changed before commit.', {
          expectedRevision,
          actualRevision: current.revision,
          expectedWriteId,
          actualWriteId: current.writeId,
        });
      }
      if (current && expectedWriteId != null && current.writeId !== expectedWriteId) {
        throw new BusterLabConflictError('The Buster Lab write id changed before commit.', {
          expectedRevision,
          actualRevision: current.revision,
          expectedWriteId,
          actualWriteId: current.writeId,
        });
      }
      const envelope = createBusterLabEnvelope({
        saveContextId: this.saveContextId,
        state: normalized,
        revision: (current?.revision ?? 0) + 1,
      });
      if (currentRaw) this.storage.setItem(this.storageKeys.backup, currentRaw);
      this.storage.setItem(this.storageKeys.main, JSON.stringify(envelope));
      this._adoptEnvelopeMetadata(envelope);
      this.lastSaveSucceeded = true;
      this.lastWarning = null;
      return envelope;
    } catch (error) {
      this.lastSaveSucceeded = false;
      this.lastWarning = `Roll couldn't save the Buster Lab changes (${error.message}). No resources were spent.`;
      throw error;
    }
  }
}
