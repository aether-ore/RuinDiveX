import {
  DungeonPlanValidationError,
  createPlanDiagnostic,
  hashPlanDiagnostics,
} from './DungeonPlanDiagnostics.js';
import {
  createGoldenDungeonPlanV2,
  createTraversalLabPlanV2,
} from './GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from './DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from './DungeonSceneAssemblerV2.js';

const GOLDEN_FIXTURE = 'golden';
const TRAVERSAL_LAB_FIXTURE = 'traversal-lab';

export class DungeonGenerationV2Error extends Error {
  constructor(code, message, result, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DungeonGenerationV2Error';
    this.code = code;
    this.result = result;
  }
}

function assemblyFailureResult({ plan, error }) {
  const errors = [createPlanDiagnostic(
    'v2-assembly-contract-failed',
    error?.message ?? 'Dungeon V2 assembly failed.',
    {
      planId: plan?.id ?? plan?.planId ?? null,
      seed: plan?.seed ?? null,
    },
  )];
  return Object.freeze({
    accepted: false,
    phase: 'assembly',
    errors,
    warnings: [],
    diagnosticHash: hashPlanDiagnostics(errors),
  });
}

function planningFailureResult({ seed, fixture, error }) {
  const errors = [createPlanDiagnostic(
    'v2-plan-construction-failed',
    error?.message ?? 'Dungeon V2 plan construction failed.',
    { seed, fixture },
  )];
  return Object.freeze({
    accepted: false,
    phase: 'planning',
    errors,
    warnings: [],
    diagnosticHash: hashPlanDiagnostics(errors),
  });
}

export class DungeonGeneratorV2 {
  constructor({
    seed = 'dungeon-v2-golden',
    fixture = GOLDEN_FIXTURE,
    undercroftType = null,
    difficulty = 1,
    bossProfileId = null,
    allowInvalidPreview = true,
  } = {}) {
    this.seed = String(seed);
    this.fixture = fixture === TRAVERSAL_LAB_FIXTURE
      ? TRAVERSAL_LAB_FIXTURE
      : GOLDEN_FIXTURE;
    this.undercroftType = undercroftType;
    this.difficulty = Math.max(1, Math.trunc(difficulty) || 1);
    this.bossProfileId = bossProfileId;
    this.allowInvalidPreview = allowInvalidPreview !== false;
  }

  generate() {
    let plan;
    try {
      plan = this.fixture === TRAVERSAL_LAB_FIXTURE
        ? createTraversalLabPlanV2({ seed: this.seed })
        : createGoldenDungeonPlanV2({
          seed: this.seed,
          undercroftType: this.undercroftType ?? undefined,
        });
    } catch (error) {
      const result = planningFailureResult({
        seed: this.seed,
        fixture: this.fixture,
        error,
      });
      throw new DungeonGenerationV2Error(
        'DUNGEON_V2_PLANNING_FAILED',
        `Dungeon V2 planning rejected (${result.diagnosticHash}).`,
        result,
        error,
      );
    }
    const validation = validateDungeonPlanV2(plan);
    if (!validation.accepted && !this.allowInvalidPreview) {
      throw new DungeonPlanValidationError(validation);
    }
    const acceptedPlan = validation.plan ?? plan;

    let facade;
    try {
      facade = assembleDungeonPlanV2(acceptedPlan, {
        difficulty: this.difficulty,
        bossProfileId: this.bossProfileId,
        allowInvalidPreview: !validation.accepted && this.allowInvalidPreview,
      });
    } catch (error) {
      const result = assemblyFailureResult({ plan: acceptedPlan, error });
      throw new DungeonGenerationV2Error(
        'DUNGEON_V2_ASSEMBLY_FAILED',
        `Dungeon V2 assembly rejected (${result.diagnosticHash}).`,
        result,
        error,
      );
    }

    facade.fixture = this.fixture;
    facade.layoutSeed = this.seed;
    facade.validation = validation;
    facade.validationDiagnosticHash = validation.diagnosticHash;
    facade.invalidPreview = validation.accepted !== true;
    facade.invalidPreviewDiagnostics = validation.accepted === true ? null : {
      diagnosticHash: validation.diagnosticHash,
      errors: validation.errors,
      warnings: validation.warnings,
    };
    if (facade.progression) facade.progression.validation = validation;
    return facade;
  }
}

export default DungeonGeneratorV2;
