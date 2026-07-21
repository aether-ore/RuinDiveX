import {
  clonePlanData,
  deepFreezePlan,
  isSerializablePlanValue,
} from './DungeonPlanV2Contract.js';
import {
  createPlanDiagnostic,
  hashPlanDiagnostics,
  sortPlanDiagnostics,
} from './DungeonPlanDiagnostics.js';
import { validateDungeonPlanV2 } from './DungeonPlanV2Validator.js';
import { deriveDungeonTopologySignaturesV2 } from './DungeonTopologySignatureV2.js';
import { replaceGoldenFactoryWithSemanticRoomPackV2 } from './SemanticRoomPackFactoryReplacementV2.js';
import { replaceGoldenWaterworksWithSemanticRoomPackV2 } from './SemanticRoomPackWaterworksReplacementV2.js';
import { replaceGoldenUndercroftWithSemanticRoomPackV2 } from './SemanticRoomPackUndercroftReplacementV2.js';
import { reconcileSemanticRoomPackStateBridgeV2 } from './SemanticRoomPackStateBridgeV2.js';

export const SEMANTIC_ROOM_PACK_PRODUCTION_INTEGRATION_V2_REVISION = 1;

const REQUIRED_ROOM_IDS = Object.freeze([
  'rdx_factory_corkscrew_exchange',
  'rdx_waterworks_freight_sump',
]);

const UNDERCROFT_ROOM_IDS = Object.freeze({
  magma: 'rdx_magma_foundry_undercroft',
  electrical: 'rdx_electric_transformer_undercroft',
});

function refreshTopologySignatures(plan) {
  const signatures = deriveDungeonTopologySignaturesV2(plan);
  for (const region of plan.regions ?? []) {
    if (signatures[region.id]) region.topologySignature = signatures[region.id];
  }
  for (const placement of plan.modulePlacements ?? []) {
    const regionId = placement.regionIds?.[0];
    if (regionId && signatures[regionId]) placement.topologySignature = signatures[regionId];
  }
}

function integrationLedger(plan) {
  const placements = plan.semanticRoomPackPlacements ?? [];
  const expectedUndercroftRoomId = UNDERCROFT_ROOM_IDS[plan.undercroftType];
  const expectedRoomIds = [...REQUIRED_ROOM_IDS, expectedUndercroftRoomId];
  const placementByRoomId = new Map(placements.map((placement) => [placement.roomId, placement]));
  for (const roomId of expectedRoomIds) {
    if (!roomId || !placementByRoomId.has(roomId)) {
      throw new Error(`Production room-pack integration is missing ${roomId ?? 'a seeded Undercroft room'}.`);
    }
  }
  if (placements.length !== expectedRoomIds.length || placementByRoomId.size !== placements.length) {
    throw new Error('Production room-pack integration must own exactly three distinct authored placements.');
  }
  return {
    revision: SEMANTIC_ROOM_PACK_PRODUCTION_INTEGRATION_V2_REVISION,
    undercroftType: plan.undercroftType,
    placementIds: placements.map(({ placementId, id }) => placementId ?? id),
    roomIds: placements.map(({ roomId }) => roomId),
    macroReplacements: [
      'corkscrew-machine-hall',
      'waterworks-freight-sump-complex',
      'hazard-undercroft',
    ],
    diagnosticConnectorCellCount: 0,
    collisionSourcePolicy: 'manifest-collision-volumes-only-plus-explicit-plan-owned-dynamic-and-trigger-surfaces',
    aggregateBoundsPlacementAllowed: false,
    visibleMeshAabbCollisionAllowed: false,
    fullyIntegrated: true,
    acceptanceBlocking: false,
    productionEligible: true,
    diagnostics: [],
  };
}

function buildCandidate(sourcePlan, options = {}) {
  if (!sourcePlan || sourcePlan.fixtureKind !== 'golden-complex') {
    throw new TypeError('Production semantic room-pack integration requires the mutable Golden complex plan.');
  }
  if ((sourcePlan.semanticRoomPackPlacements ?? []).length !== 0) {
    throw new Error('Production semantic room-pack integration requires an empty placement collection.');
  }

  const draft = clonePlanData(sourcePlan);
  replaceGoldenFactoryWithSemanticRoomPackV2(draft, {
    requireDungeonAcceptance: false,
    validateDungeon: options.validateDungeon,
  });
  replaceGoldenWaterworksWithSemanticRoomPackV2(draft, {
    validateDungeon: options.validateDungeon,
  });
  replaceGoldenUndercroftWithSemanticRoomPackV2(draft, {
    undercroftType: draft.undercroftType,
  });
  reconcileSemanticRoomPackStateBridgeV2(draft);
  // State reconciliation clones and rewrites the placement records while it
  // migrates global water/mechanism references. Restore the public contract:
  // accepted authored placements are immutable plan data, not mutable runtime
  // controller objects.
  draft.semanticRoomPackPlacements = draft.semanticRoomPackPlacements
    .map((placement) => deepFreezePlan(placement));
  refreshTopologySignatures(draft);
  draft.semanticRoomPackIntegration = integrationLedger(draft);

  if (draft.semanticRoomPackFactoryReplacement) {
    draft.semanticRoomPackFactoryReplacement.productionEligible = true;
  }
  if (draft.semanticRoomPackWaterworksReplacement) {
    draft.semanticRoomPackWaterworksReplacement.fullyPhysicalized = true;
    draft.semanticRoomPackWaterworksReplacement.productionEligible = true;
    draft.semanticRoomPackWaterworksReplacement.pendingSharedValidation = false;
  }
  if (draft.semanticRoomPackUndercroftReplacement) {
    draft.semanticRoomPackUndercroftReplacement.productionEligible = true;
    draft.semanticRoomPackUndercroftReplacement.acceptanceBlocking = false;
  }

  if (!isSerializablePlanValue(draft)) {
    throw new Error('Production semantic room-pack integration produced non-serializable plan data.');
  }
  return draft;
}

function resultFor({ candidate = null, errors = [], validation = null }) {
  const sorted = sortPlanDiagnostics(errors);
  return deepFreezePlan({
    accepted: sorted.length === 0 && (validation == null || validation.accepted === true),
    candidateAccepted: sorted.length === 0,
    plan: candidate,
    errors: sorted,
    diagnosticHash: sorted.length > 0
      ? hashPlanDiagnostics(sorted)
      : validation?.diagnosticHash ?? hashPlanDiagnostics([]),
    dungeonValidation: validation ? {
      accepted: validation.accepted,
      diagnosticHash: validation.diagnosticHash,
      errors: clonePlanData(validation.errors),
      warnings: clonePlanData(validation.warnings),
      diagnostics: clonePlanData(validation.diagnostics),
    } : null,
  });
}

export function prepareSemanticRoomPackProductionIntegrationV2(sourcePlan, options = {}) {
  let candidate = null;
  try {
    candidate = buildCandidate(sourcePlan, options);
  } catch (cause) {
    const errors = [createPlanDiagnostic(
      'semantic-room-pack-production-integration-failed',
      cause?.message ?? 'Production semantic room-pack integration failed.',
      { name: cause?.name ?? 'Error' },
    )];
    return resultFor({ errors });
  }
  const validation = options.validateDungeon === false
    ? null
    : validateDungeonPlanV2(candidate, {
      ...(options.validatorOptions ?? {}),
      allowIncompleteGoldenComposition: true,
    });
  return resultFor({ candidate, validation });
}

export class SemanticRoomPackProductionIntegrationErrorV2 extends Error {
  constructor(result) {
    const first = result.errors?.[0] ?? result.dungeonValidation?.errors?.[0];
    super(first
      ? `Production semantic room-pack integration rejected: ${first.code}: ${first.message}`
      : 'Production semantic room-pack integration rejected.');
    this.name = 'SemanticRoomPackProductionIntegrationErrorV2';
    this.code = 'SEMANTIC_ROOM_PACK_PRODUCTION_INTEGRATION_INVALID';
    this.result = result;
  }
}

export function integrateSemanticRoomPackProductionV2(plan, options = {}) {
  const result = prepareSemanticRoomPackProductionIntegrationV2(plan, options);
  if (!result.accepted) throw new SemanticRoomPackProductionIntegrationErrorV2(result);
  for (const key of Object.keys(plan)) delete plan[key];
  Object.assign(plan, clonePlanData(result.plan));
  return plan;
}

export default integrateSemanticRoomPackProductionV2;
