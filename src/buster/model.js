import {
  BUSTER_RULESET_VERSION,
  BUSTER_SCHEMA_VERSION,
} from './catalog.js';

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function cloneBusterValue(value, seen = new Map()) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const copy = [];
    seen.set(value, copy);
    for (const child of value) copy.push(cloneBusterValue(child, seen));
    return copy;
  }
  const copy = {};
  seen.set(value, copy);
  for (const [key, child] of Object.entries(value)) {
    copy[key] = cloneBusterValue(child, seen);
  }
  return copy;
}

export function deepFreezeBusterValue(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreezeBusterValue(child, seen);
  return Object.freeze(value);
}

function compareText(left, right) {
  const leftText = String(left ?? '');
  const rightText = String(right ?? '');
  if (leftText < rightText) return -1;
  if (leftText > rightText) return 1;
  return 0;
}

function normalizeNode(node) {
  const source = isRecord(node) ? node : {};
  return {
    nodeId: source.nodeId ?? null,
    moduleId: source.moduleId ?? null,
    moduleInstanceId: source.moduleInstanceId ?? null,
  };
}

function normalizeEdge(edge) {
  const source = isRecord(edge) ? edge : {};
  return {
    from: source.from ?? null,
    port: source.port ?? null,
    to: source.to ?? null,
  };
}

/**
 * Returns a detached, canonical source graph without validating or repairing it.
 * Unknown module ids and invalid scalar values are deliberately preserved so a
 * later validation pass can report them faithfully.
 */
export function normalizeBusterBuild(build) {
  const compiledSource = isRecord(build?.source?.build) ? build.source.build : build;
  const source = isRecord(compiledSource) ? compiledSource : {};
  const tuning = isRecord(source.tuning) ? source.tuning : {};
  const program = isRecord(source.program) ? source.program : {};
  const nodes = Array.isArray(program.nodes) ? program.nodes.map(normalizeNode) : [];
  const edges = Array.isArray(program.edges) ? program.edges.map(normalizeEdge) : [];

  nodes.sort((left, right) => (
    compareText(left.nodeId, right.nodeId)
    || compareText(left.moduleId, right.moduleId)
    || compareText(left.moduleInstanceId, right.moduleInstanceId)
  ));
  edges.sort((left, right) => (
    compareText(left.from, right.from)
    || (left.port === right.port ? 0 : left.port === 'next' ? -1 : right.port === 'next' ? 1 : compareText(left.port, right.port))
    || compareText(left.to, right.to)
  ));

  return {
    schemaVersion: source.schemaVersion ?? null,
    rulesetVersion: source.rulesetVersion ?? null,
    buildId: source.buildId ?? null,
    chassisId: source.chassisId ?? null,
    tuning: {
      power: tuning.power ?? null,
      energy: tuning.energy ?? null,
      range: tuning.range ?? null,
      rapid: tuning.rapid ?? null,
    },
    program: {
      rootNodeId: program.rootNodeId ?? null,
      nodes,
      edges,
    },
  };
}

export function serializeBusterBuild(build) {
  return JSON.stringify(normalizeBusterBuild(build));
}

export function deserializeBusterBuild(serialized) {
  const parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
  return normalizeBusterBuild(parsed);
}

export function createEmptyBusterBuild({
  buildId = 'custom-buster',
  chassisId = 'custom-buster-chassis',
  tuning = { power: 4, energy: 4, range: 4, rapid: 4 },
} = {}) {
  return normalizeBusterBuild({
    schemaVersion: BUSTER_SCHEMA_VERSION,
    rulesetVersion: BUSTER_RULESET_VERSION,
    buildId,
    chassisId,
    tuning,
    program: { rootNodeId: null, nodes: [], edges: [] },
  });
}
