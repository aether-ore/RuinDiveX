import { hashSeed } from '../reaverbots/SeededRandom.js';

function normalize(value) {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  }
  return value;
}

export function stablePlanStringify(value) {
  return JSON.stringify(normalize(value));
}

export function createPlanDiagnostic(code, message, details = {}) {
  return Object.freeze({
    code: String(code),
    message: String(message),
    details: normalize(details),
  });
}

export function sortPlanDiagnostics(diagnostics) {
  return [...diagnostics].sort((left, right) => {
    const code = left.code.localeCompare(right.code);
    return code || stablePlanStringify(left.details).localeCompare(stablePlanStringify(right.details));
  });
}

export function hashPlanDiagnostics(diagnostics) {
  return hashSeed(stablePlanStringify(sortPlanDiagnostics(diagnostics)))
    .toString(16)
    .padStart(8, '0');
}

export class DungeonPlanValidationError extends Error {
  constructor(result) {
    const first = result.errors?.[0];
    super(first ? `DungeonPlanV2 rejected: ${first.code}: ${first.message}` : 'DungeonPlanV2 rejected.');
    this.name = 'DungeonPlanValidationError';
    this.code = 'DUNGEON_PLAN_V2_INVALID';
    this.result = result;
  }
}
