import {
  canonicalHash,
  cloneJsonValue,
} from '../core/index.js';

export const LEVEL_FORGE_SPEC_SCHEMA = 'ruindivex-level-forge-spec/v1';
export const LEVEL_FORGE_SPEC_SCHEMA_ID = LEVEL_FORGE_SPEC_SCHEMA;
export const LEVEL_FORGE_RECEIPT_SCHEMA = 'ruindivex-level-forge-receipt/v1';
export const LEVEL_FORGE_GENERATOR_VERSION = 'deterministic-level-forge/v1';
export const PROMPT_UNSATISFIABLE = 'PROMPT_UNSATISFIABLE';
export const MAX_LEVEL_FORGE_LAYOUT_VARIANTS = 4;
export const MAX_LEVEL_FORGE_REPAIR_PASSES = 8;
export const DEFAULT_LEVEL_FORGE_ROOM_COUNT = 5;

const MIN_ROOM_COUNT = 2;
const MAX_ROOM_COUNT = 24;
const WORD_NUMBERS = Object.freeze({
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
});

export function createForgeDiagnostic(severity, code, path, message, details = {}) {
  return { severity, code, path, message, details };
}

export function forgeResult(diagnostics, fields = {}) {
  const errors = diagnostics.filter(({ severity }) => severity === 'error');
  const warnings = diagnostics.filter(({ severity }) => severity === 'warning');
  return {
    ok: errors.length === 0,
    value: null,
    spec: null,
    project: null,
    receipt: null,
    ...fields,
    diagnostics,
    errors,
    warnings,
  };
}

function slug(value, fallback = 'forge') {
  const normalized = String(value ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function normalizeStringList(value) {
  const entries = Array.isArray(value)
    ? value
    : value == null
      ? []
      : [value];
  return [...new Set(entries.map((entry) => {
    if (typeof entry === 'string') return entry.trim();
    if (entry && typeof entry === 'object') return String(entry.text ?? entry.requirement ?? entry.id ?? '').trim();
    return String(entry ?? '').trim();
  }).filter(Boolean))];
}

function bool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') {
    if (/^(?:false|no|off|0)$/i.test(value.trim())) return false;
    if (/^(?:true|yes|on|1)$/i.test(value.trim())) return true;
  }
  return Boolean(value);
}

function textRoomCounts(text) {
  const source = String(text ?? '').toLowerCase();
  const counts = [];
  for (const match of source.matchAll(/\b(\d{1,3})\s*(?:-|\s)?rooms?\b/g)) counts.push(Number(match[1]));
  for (const [word, count] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`\\b${word}(?:-|\\s)+rooms?\\b`).test(source)) counts.push(count);
  }
  return [...new Set(counts)];
}

function requestedAndForbidden(text, terms) {
  const source = String(text ?? '').toLowerCase();
  const group = `(?:${terms.join('|')})`;
  const mentioned = new RegExp(`\\b${group}\\b`).test(source);
  const forbidden = new RegExp(`(?:\\bno\\b|\\bwithout\\b|\\bforbid(?:den)?\\b|\\bexclude\\b|\\bavoid\\b)[^.;,]{0,28}\\b${group}\\b`).test(source)
    || new RegExp(`\\b${group}[- ]free\\b`).test(source);
  const explicitlyRequested = new RegExp(`(?:\\binclude\\b|\\bwith\\b|\\bmust(?: have| include| use)?\\b|\\brequire(?:s|d)?\\b|\\badd\\b)[^.;,]{0,28}\\b${group}\\b`).test(source);
  const requested = explicitlyRequested || (mentioned && !forbidden);
  return { requested, forbidden };
}

function explicitFeature(source, features, aliases, fallback) {
  for (const key of aliases) {
    if (Object.prototype.hasOwnProperty.call(features, key)) return bool(features[key]);
    if (Object.prototype.hasOwnProperty.call(source, key)) return bool(source[key]);
  }
  return fallback;
}

function contradictionDiagnostic(reasons, details = {}) {
  return createForgeDiagnostic(
    'error',
    PROMPT_UNSATISFIABLE,
    '$',
    reasons.length === 1
      ? reasons[0]
      : 'The prompt contains mutually incompatible hard requirements.',
    { reasons, ...details },
  );
}

function cloneInput(input) {
  if (typeof input === 'string') return { prompt: input };
  if (input?.spec && input.spec.schema === LEVEL_FORGE_SPEC_SCHEMA) return cloneJsonValue(input.spec);
  if (input == null) return {};
  return cloneJsonValue(input);
}

/**
 * Normalize the intentionally small, renderer-free generation contract.
 * Prompt prose is only used for a conservative set of unambiguous aliases;
 * unknown prose is preserved and never silently promoted to a hard constraint.
 */
export function normalizeLevelForgeSpec(input = {}, options = {}) {
  const diagnostics = [];
  let source;
  try {
    source = cloneInput(input);
  } catch (caught) {
    diagnostics.push(contradictionDiagnostic([
      caught?.message ?? 'The level forge specification must be JSON-safe.',
    ], { cause: 'SPEC_NOT_JSON_SAFE' }));
    return forgeResult(diagnostics);
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    diagnostics.push(contradictionDiagnostic([
      'The level forge specification must be an object or prompt string.',
    ], { cause: 'SPEC_NOT_OBJECT' }));
    return forgeResult(diagnostics);
  }
  if (source.schema != null && source.schema !== LEVEL_FORGE_SPEC_SCHEMA) {
    diagnostics.push(contradictionDiagnostic([
      `Unsupported level forge specification schema ${source.schema}.`,
    ], { expectedSchema: LEVEL_FORGE_SPEC_SCHEMA, actualSchema: source.schema }));
    return forgeResult(diagnostics);
  }

  const prompt = String(source.prompt ?? source.description ?? '').trim();
  const hard = normalizeStringList(source.requirements?.hard ?? source.hardRequirements ?? source.must);
  const soft = normalizeStringList(source.requirements?.soft ?? source.softRequirements ?? source.prefer);
  const hardText = [prompt, ...hard].filter(Boolean).join('. ');
  const promptCounts = textRoomCounts(hardText);
  const explicitRoomCount = source.roomCount ?? source.rooms?.count ?? source.constraints?.roomCount;
  const parsedExplicitRoomCount = explicitRoomCount == null ? null : Number(explicitRoomCount);
  const countCandidates = [
    ...(Number.isFinite(parsedExplicitRoomCount) ? [parsedExplicitRoomCount] : []),
    ...promptCounts,
  ].map((value) => Math.trunc(value));
  const distinctCounts = [...new Set(countCandidates)];
  const contradictionReasons = [];
  if (explicitRoomCount != null && !Number.isFinite(parsedExplicitRoomCount)) {
    contradictionReasons.push('roomCount must be a finite integer.');
  }
  if (distinctCounts.length > 1) {
    contradictionReasons.push(`Conflicting room counts were requested: ${distinctCounts.join(', ')}.`);
  }
  const roomCount = distinctCounts[0] ?? DEFAULT_LEVEL_FORGE_ROOM_COUNT;
  if (!Number.isInteger(roomCount) || roomCount < MIN_ROOM_COUNT || roomCount > MAX_ROOM_COUNT) {
    contradictionReasons.push(`roomCount must be between ${MIN_ROOM_COUNT} and ${MAX_ROOM_COUNT}.`);
  }

  const features = source.features && typeof source.features === 'object' && !Array.isArray(source.features)
    ? source.features
    : {};
  const liftText = requestedAndForbidden(hardText, ['lift', 'lifts', 'elevator', 'elevators', 'hoist', 'hoists']);
  const slopeText = requestedAndForbidden(hardText, ['slope', 'slopes', 'ramp', 'ramps', 'stairs']);
  const gateText = requestedAndForbidden(hardText, ['gate', 'gates', 'locked door', 'locked doors', 'keycard', 'keycards']);
  const puzzleText = requestedAndForbidden(hardText, ['puzzle', 'puzzles', 'mechanism', 'mechanisms']);
  const groundedText = /\b(?:grounded|single[- ]level|one[- ]level|flat layout|no vertical traversal)\b/i.test(hardText);

  const lifts = explicitFeature(source, features, ['lifts', 'lift', 'includeLifts', 'includeLift'], liftText.requested);
  const slopes = explicitFeature(source, features, ['slopes', 'slope', 'includeSlopes', 'includeSlope'], slopeText.requested);
  const gates = explicitFeature(source, features, ['gates', 'gate', 'lockedGates', 'includeGate'], gateText.requested);
  const puzzles = explicitFeature(source, features, ['puzzles', 'puzzle', 'includePuzzles', 'includePuzzle'], puzzleText.requested);
  const groundedExplicit = source.constraints?.grounded ?? source.grounded;
  const grounded = groundedExplicit == null
    ? (groundedText || (!lifts && !slopes))
    : bool(groundedExplicit);

  for (const [label, state] of [
    ['lifts', liftText],
    ['slopes', slopeText],
    ['gates', gateText],
    ['puzzles', puzzleText],
  ]) {
    if (state.requested && state.forbidden) contradictionReasons.push(`${label} are both required and forbidden.`);
  }
  if (liftText.forbidden && lifts) contradictionReasons.push('lifts are explicitly forbidden but enabled.');
  if (slopeText.forbidden && slopes) contradictionReasons.push('slopes are explicitly forbidden but enabled.');
  if (gateText.forbidden && gates) contradictionReasons.push('gates are explicitly forbidden but enabled.');
  if (puzzleText.forbidden && puzzles) contradictionReasons.push('puzzles are explicitly forbidden but enabled.');
  if (grounded && (lifts || slopes)) {
    contradictionReasons.push('A grounded single-level layout cannot require lifts or slopes.');
  }
  const neededSpecialConnections = Number(lifts) + Number(slopes);
  if (neededSpecialConnections > Math.max(0, roomCount - 1)) {
    contradictionReasons.push('The requested room count has too few connections for all required traversal types.');
  }
  if (puzzles && roomCount < 3) contradictionReasons.push('A puzzle gate needs at least three rooms to avoid a start-room soft lock.');
  if (gates && roomCount < 3) contradictionReasons.push('A credential gate needs at least three rooms to place its key before the gate.');

  const inferredLayout = /\bbranch(?:ed|ing)?\b/i.test(hardText) ? 'branching' : 'linear';
  const requestedLayout = String(source.layout ?? source.layoutStyle ?? inferredLayout).trim().toLowerCase();
  const layout = ['linear', 'line', 'corridor'].includes(requestedLayout)
    ? 'linear'
    : ['branch', 'branched', 'branching'].includes(requestedLayout)
      ? 'branching'
      : requestedLayout;
  if (!['linear', 'branching'].includes(layout)) {
    contradictionReasons.push(`Unsupported hard layout ${requestedLayout}; this forge version supports deterministic linear and branching layouts.`);
  }
  if (layout === 'branching' && roomCount < 4) {
    contradictionReasons.push('A branching layout requires at least four rooms so the safe backbone retains a separate extraction room.');
  }
  if (contradictionReasons.length) {
    diagnostics.push(contradictionDiagnostic(contradictionReasons, {
      roomCounts: distinctCounts,
      requestedFeatures: { lifts, slopes, gates, puzzles },
    }));
    return forgeResult(diagnostics);
  }

  const themePackId = slug(source.themePackId ?? source.theme ?? 'industrial-v1', 'industrial-v1');
  const seed = String(source.seed ?? options.seed ?? 'ruindiver-level-forge-default').trim()
    || 'ruindiver-level-forge-default';
  const name = String(source.name ?? source.title ?? 'Forged Industrial Expedition').trim()
    || 'Forged Industrial Expedition';
  const normalized = {
    schema: LEVEL_FORGE_SPEC_SCHEMA,
    revision: 1,
    prompt,
    name,
    seed,
    themePackId,
    roomCount,
    layout,
    requirements: { hard, soft },
    features: {
      lifts,
      slopes,
      gates,
      puzzles,
      encounters: explicitFeature(source, features, ['encounters', 'encounter'], true),
      rewards: explicitFeature(source, features, ['rewards', 'reward', 'loot'], true),
      safeZone: explicitFeature(source, features, ['safeZone', 'safeZones', 'sanctuary'], true),
    },
    constraints: {
      grounded,
      fullyEditable: true,
      strictAssembly: true,
      maximumLayoutVariants: MAX_LEVEL_FORGE_LAYOUT_VARIANTS,
      maximumRepairPasses: MAX_LEVEL_FORGE_REPAIR_PASSES,
      registryFallback: false,
    },
  };
  normalized.specHash = canonicalHash(normalized, {
    namespace: LEVEL_FORGE_SPEC_SCHEMA,
    omitKeys: ['specHash'],
  });
  diagnostics.push(createForgeDiagnostic(
    'info',
    'FORGE_SPEC_NORMALIZED',
    '$',
    `Normalized a ${roomCount}-room ${themePackId} level forge specification.`,
    { specHash: normalized.specHash },
  ));
  return forgeResult(diagnostics, { value: normalized, spec: normalized });
}

export function isNormalizedLevelForgeSpec(value) {
  return Boolean(value
    && value.schema === LEVEL_FORGE_SPEC_SCHEMA
    && value.specHash
    && Number.isInteger(value.roomCount));
}
