import { RollSalvageStorage } from '../RollSalvageStorage.js';
import {
  BUSTER_RECIPE_LIST,
  getBusterRecipe,
  getRecipeDiscoveryState,
} from './BusterRecipeCatalog.js';
import {
  BUSTER_MODULE_LIST,
  MEGA_BUSTER_CALIBRATION_CATALOG,
  getBusterModuleDefinition,
} from './catalog.js';
import { validateBusterBuild } from './validation.js';

export const BUSTER_LAB_STORAGE_KEY = 'ruinDigger.busterLab.v1';
export const BUSTER_LAB_STORAGE_VERSION = 1;
export const BUSTER_LAB_RULESET_VERSION = 'custom-buster-v0.1';
export const SECOND_BUSTER_CHASSIS_COST = 20;
export const MAX_BUSTER_CHASSIS = 2;

const NON_PHYSICAL_BUILTIN_MODULE_IDS = new Set(['onImpact', 'pulsePayload']);

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

function sanitizeBuild(build) {
  if (!build || typeof build !== 'object') return null;
  const buildId = typeof build.buildId === 'string' ? build.buildId : '';
  const chassisId = typeof build.chassisId === 'string' ? build.chassisId : '';
  if (!buildId || !chassisId) return null;
  const sanitized = {
    schemaVersion: build.schemaVersion ?? 1,
    rulesetVersion: typeof build.rulesetVersion === 'string' && build.rulesetVersion
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
    megaCalibrations: {
      instances: [],
      slots: [null, null, null, null],
      nextInstanceId: 1,
      revision: 1,
    },
    migrations: {
      starterChassisGranted: true,
      applied: ['buster-lab-v1', 'starter-build-a-v1'],
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
    megaCalibrations: raw.megaCalibrations ?? raw.calibrations ?? {},
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
    megaCalibrations: normalizeMegaCalibrations(source.megaCalibrations),
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
  return quarantineUnknownSavedBuilds(applyStarterMigration(sanitizeState(mapped)));
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
  return errors;
}

export class BusterLabValidationError extends Error {
  constructor(errors) {
    super(errors.join(' '));
    this.name = 'BusterLabValidationError';
    this.errors = [...errors];
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

export class BusterLabStorage {
  constructor({ storage = resolveDefaultStorage(), idFactory = null } = {}) {
    this.storage = storage;
    this.idFactory = typeof idFactory === 'function' ? idFactory : null;
    this.state = null;
    this.lastWarning = null;
    this.lastSaveSucceeded = null;
  }

  load() {
    this.lastWarning = null;
    let serialized = null;
    if (this.storage) {
      try {
        serialized = this.storage.getItem(BUSTER_LAB_STORAGE_KEY);
      } catch (error) {
        this.lastWarning = `Roll couldn't open the Buster Lab save (${error.message}). A safe starter lab is available for this session.`;
      }
    } else {
      this.lastWarning = 'Buster Lab persistence is unavailable. Changes will last only for this session.';
    }

    if (serialized == null) {
      this._adoptState(createDefaultBusterLabState());
      if (this.storage && !this.lastWarning) {
        try {
          this.storage.setItem(BUSTER_LAB_STORAGE_KEY, JSON.stringify(this.state));
          this.lastSaveSucceeded = true;
        } catch (error) {
          this.lastSaveSucceeded = false;
          this.lastWarning = `Roll couldn't create the Buster Lab save (${error.message}). A safe starter lab is available for this session.`;
        }
      }
      return attachWarning(this.state, this.lastWarning);
    }

    try {
      const parsed = JSON.parse(serialized);
      const migrated = migrateBusterLabState(parsed);
      const quarantined = migrated.migrations?.unknownModuleQuarantine ?? [];
      if (quarantined.length > 0) {
        const names = quarantined.map((entry) => entry.buildId).join(', ');
        this.lastWarning = `Unknown Custom Buster modules were found in ${names}. Roll preserved the source as an invalid draft, cleared its arm assignment, and returned control to the Mega Buster.`;
      }
      const errors = validateBusterLabState(migrated);
      if (errors.length > 0) throw new BusterLabValidationError(errors);
      this._adoptState(migrated);
      const normalizedSerialized = JSON.stringify(migrated);
      if ((parsed.version ?? 0) !== BUSTER_LAB_STORAGE_VERSION
        || normalizedSerialized !== JSON.stringify(parsed)) {
        try {
          this.storage?.setItem(BUSTER_LAB_STORAGE_KEY, normalizedSerialized);
        } catch (error) {
          this.lastSaveSucceeded = false;
          this.lastWarning = `Roll updated the Buster Lab data in memory, but couldn't save the migration (${error.message}).`;
          return attachWarning(this.state, this.lastWarning);
        }
      }
      this.lastSaveSucceeded = true;
    } catch (error) {
      this._adoptState(createDefaultBusterLabState());
      this.lastSaveSucceeded = false;
      this.lastWarning = `Roll couldn't read the saved Buster Lab data (${error.message}). A safe starter lab was restored.`;
    }
    return attachWarning(this.state, this.lastWarning);
  }

  loadWithStatus() {
    const state = this.load();
    return { state, warning: this.lastWarning };
  }

  serialize(state = this.state ?? createDefaultBusterLabState()) {
    const migrated = migrateBusterLabState(state);
    const errors = validateBusterLabState(migrated);
    if (errors.length > 0) throw new BusterLabValidationError(errors);
    return JSON.stringify(migrated);
  }

  deserialize(serialized) {
    const parsed = JSON.parse(serialized);
    const state = migrateBusterLabState(parsed);
    const errors = validateBusterLabState(state);
    if (errors.length > 0) throw new BusterLabValidationError(errors);
    return state;
  }

  save(state = this.state ?? createDefaultBusterLabState()) {
    const candidate = this.deserialize(JSON.stringify(state));
    this._persistCandidate(candidate);
    this._adoptState(candidate);
    return this.state;
  }

  reset() {
    if (this.storage) {
      try {
        this.storage.removeItem(BUSTER_LAB_STORAGE_KEY);
      } catch (error) {
        this.lastWarning = `Roll couldn't clear the old Buster Lab save (${error.message}).`;
      }
    }
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
        reason: error instanceof BusterLabValidationError ? 'invalid-state' : 'transaction-failed',
        error,
        errors: error.errors ?? [],
        state: this.state,
      };
    }
  }

  transaction(mutator) {
    return this.mutate(mutator);
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
    const roll = new RollSalvageStorage({
      ...candidate.rollSalvage,
      discoveredSalvageTypes: candidate.discovery.salvageTypes,
      discoveryHistory: candidate.discovery.history,
    });
    const transaction = roll.transactRecipe(recipe, {
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
          fabricationSequence: candidate.nextInstanceId - 1,
        };
      },
    });
    if (!transaction.ok) return { ...transaction, state: this.state };

    candidate.moduleInstances.push(transaction.result);
    this._applyRollSnapshot(candidate, roll.serialize());
    try {
      const normalized = this.deserialize(JSON.stringify(candidate));
      this._persistCandidate(normalized);
      this._adoptState(normalized);
      return {
        ok: true,
        recipeId: recipe.id,
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
      for (const recipe of BUSTER_RECIPE_LIST) {
        for (const partId of recipe.requiredPartIds) {
          roll.markPartDiscovered(partId, { debugKit: true, grantNumber }, { notify: false });
        }
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
      };
    });
    return result.ok ? { ...result, ...result.result } : result;
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

  getOwnedModuleInstanceIds() {
    return this._ensureLoaded().moduleInstances.map((module) => module.instanceId);
  }

  getState() {
    return this._ensureLoaded();
  }

  getClaimedModuleInstanceIds(options = {}) {
    return getClaimedModuleInstanceIds(this._ensureLoaded(), options);
  }

  _ensureLoaded() {
    return this.state ?? this.load();
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

  _persistCandidate(candidate) {
    if (!this.storage) {
      this.lastSaveSucceeded = true;
      return;
    }
    try {
      this.storage.setItem(BUSTER_LAB_STORAGE_KEY, JSON.stringify(candidate));
      this.lastSaveSucceeded = true;
      this.lastWarning = null;
    } catch (error) {
      this.lastSaveSucceeded = false;
      this.lastWarning = `Roll couldn't save the Buster Lab changes (${error.message}). No resources were spent.`;
      throw error;
    }
  }
}
