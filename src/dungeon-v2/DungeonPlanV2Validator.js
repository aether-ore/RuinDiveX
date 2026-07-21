import {
  BOUNDARY_SIDES_V2,
  CONDITION_OPERATIONS_V2,
  DUNGEON_PLAN_V2_SCHEMA_VERSION,
  EFFECT_OPERATIONS_V2,
  clonePlanData,
  deepFreezePlan,
  isSerializablePlanValue,
} from './DungeonPlanV2Contract.js';
import {
  DungeonPlanValidationError,
  createPlanDiagnostic,
  hashPlanDiagnostics,
  sortPlanDiagnostics,
} from './DungeonPlanDiagnostics.js';
import { solveDungeonPlanV2Symbolically } from './DungeonPlanV2Solver.js';
import { deriveDungeonTopologySignaturesV2 } from './DungeonTopologySignatureV2.js';
import {
  createEncounterSlotSeed,
  generateReaverbotGenome,
  validateReaverbotGenomeAgainstGenerationPolicy,
} from '../reaverbots/ReaverbotGenerator.js';
import { validateSemanticRoomPackPlanV2 } from './SemanticRoomPackPlanAdapterV2.js';
import { LEGACY_FIXED_ROOM_MODULE_IDS_V2 } from './LegacyFixedRoomModuleCatalogV2.js';

const GOLDEN_ROOM_PACK_IDS_V2 = Object.freeze({
  factory: 'rdx_factory_corkscrew_exchange',
  waterworks: 'rdx_waterworks_freight_sump',
  magma: 'rdx_magma_foundry_undercroft',
  electrical: 'rdx_electric_transformer_undercroft',
});

const REQUIRED_ARRAYS = Object.freeze([
  'districts', 'regions', 'modulePlacements', 'encounters', 'rewards', 'objectives',
  'environmentStates', 'mechanisms', 'spatialCells', 'structuralBoundaries',
  'portals', 'walkableSurfaces', 'falls', 'anchors', 'safeAnchors', 'actions',
  'traversalLinks', 'structuralFixtures',
]);

function isFiniteVector(value) {
  return value && ['x', 'y', 'z'].every((axis) => Number.isFinite(value[axis]));
}

function validBounds(bounds) {
  return isFiniteVector(bounds?.min)
    && isFiniteVector(bounds?.max)
    && ['x', 'y', 'z'].every((axis) => bounds.max[axis] > bounds.min[axis]);
}

function overlaps(left, right, epsilon = 0.001) {
  return ['x', 'y', 'z'].every((axis) => (
    left.min[axis] < right.max[axis] - epsilon
    && left.max[axis] > right.min[axis] + epsilon
  ));
}

const FACE_COVERAGE_EPSILON = 0.001;

function faceAxes(side) {
  if (side === 'north' || side === 'south') return { normal: 'z', u: 'x', v: 'y' };
  if (side === 'east' || side === 'west') return { normal: 'x', u: 'z', v: 'y' };
  return { normal: 'y', u: 'x', v: 'z' };
}

function facePlane(bounds, side, normal) {
  return ['north', 'west', 'floor'].includes(side) ? bounds.min[normal] : bounds.max[normal];
}

function projectedFaceRect(bounds, axes) {
  return {
    uMin: bounds.min[axes.u],
    uMax: bounds.max[axes.u],
    vMin: bounds.min[axes.v],
    vMax: bounds.max[axes.v],
  };
}

function projectedOpeningRect(opening, side) {
  const dimensions = opening?.dimensions ?? {};
  if (side === 'north' || side === 'south') {
    return {
      uMin: opening.center.x - dimensions.width * 0.5,
      uMax: opening.center.x + dimensions.width * 0.5,
      vMin: opening.center.y - dimensions.height * 0.5,
      vMax: opening.center.y + dimensions.height * 0.5,
    };
  }
  if (side === 'east' || side === 'west') {
    return {
      uMin: opening.center.z - dimensions.width * 0.5,
      uMax: opening.center.z + dimensions.width * 0.5,
      vMin: opening.center.y - dimensions.height * 0.5,
      vMax: opening.center.y + dimensions.height * 0.5,
    };
  }
  return {
    uMin: opening.center.x - dimensions.width * 0.5,
    uMax: opening.center.x + dimensions.width * 0.5,
    vMin: opening.center.z - dimensions.depth * 0.5,
    vMax: opening.center.z + dimensions.depth * 0.5,
  };
}

function rectContains(rect, u, v, epsilon = FACE_COVERAGE_EPSILON) {
  return u >= rect.uMin - epsilon && u <= rect.uMax + epsilon
    && v >= rect.vMin - epsilon && v <= rect.vMax + epsilon;
}

function sortedUniqueCuts(values) {
  const sorted = [...values].filter(Number.isFinite).sort((left, right) => left - right);
  const unique = [];
  for (const value of sorted) {
    if (!unique.length || Math.abs(value - unique.at(-1)) > FACE_COVERAGE_EPSILON) unique.push(value);
  }
  return unique;
}

/**
 * Prove that authored rectangles cover one complete cell face, excluding only
 * declared portal apertures. Native V1 rooms deliberately split walls and
 * ceilings into many exact panels; counting boundary records cannot establish
 * enclosure and incorrectly rejects those rooms.
 */
function validateCellFaceCoverage(cell, side, boundaries, error) {
  if (!boundaries.length) {
    error('cell-face-coverage-gap', `${cell.id} has no authored coverage on its ${side} face.`, {
      cellId: cell.id,
      side,
      reason: 'no-boundaries',
    });
    return;
  }

  if (boundaries.length > 1) {
    const owners = new Set(boundaries.map(({ presentationOwnerId }) => presentationOwnerId ?? null));
    if (owners.size !== 1 || owners.has(null)) {
      error('cell-face-owner-mixed', `${cell.id} has segmented ${side} coverage without one presentation owner.`, {
        cellId: cell.id,
        side,
        presentationOwnerIds: [...owners],
      });
    }
  }

  const axes = faceAxes(side);
  const expectedPlane = facePlane(cell.bounds, side, axes.normal);
  const face = projectedFaceRect(cell.bounds, axes);
  const segments = [];
  const openings = [];
  for (const boundary of boundaries) {
    const spansPlane = boundary.bounds.min[axes.normal] <= expectedPlane + FACE_COVERAGE_EPSILON
      && boundary.bounds.max[axes.normal] >= expectedPlane - FACE_COVERAGE_EPSILON;
    if (!spansPlane) {
      error('cell-face-segment-off-plane', `${boundary.id} does not cover its owning ${side} face plane.`, {
        cellId: cell.id,
        boundaryId: boundary.id,
        side,
        expectedPlane,
        bounds: boundary.bounds,
      });
      continue;
    }
    const rect = projectedFaceRect(boundary.bounds, axes);
    if (rect.uMin < face.uMin - FACE_COVERAGE_EPSILON
      || rect.uMax > face.uMax + FACE_COVERAGE_EPSILON
      || rect.vMin < face.vMin - FACE_COVERAGE_EPSILON
      || rect.vMax > face.vMax + FACE_COVERAGE_EPSILON) {
      error('cell-face-segment-outside', `${boundary.id} extends outside its owning ${side} face.`, {
        cellId: cell.id,
        boundaryId: boundary.id,
        side,
        face,
        segment: rect,
      });
    }
    const boundaryOpenings = (boundary.openings ?? []).map((opening) => ({
      id: opening.id,
      boundaryId: boundary.id,
      rect: projectedOpeningRect(opening, side),
    }));
    openings.push(...boundaryOpenings);
    segments.push({ id: boundary.id, rect, openings: boundaryOpenings });
  }

  for (const opening of openings) {
    const rect = opening.rect;
    if (![rect.uMin, rect.uMax, rect.vMin, rect.vMax].every(Number.isFinite)
      || rect.uMin < face.uMin - FACE_COVERAGE_EPSILON
      || rect.uMax > face.uMax + FACE_COVERAGE_EPSILON
      || rect.vMin < face.vMin - FACE_COVERAGE_EPSILON
      || rect.vMax > face.vMax + FACE_COVERAGE_EPSILON) {
      error('cell-face-opening-outside', `${opening.id} is not a finite aperture contained by ${cell.id}'s ${side} face.`, {
        cellId: cell.id,
        boundaryId: opening.boundaryId,
        openingId: opening.id,
        side,
        face,
        opening: rect,
      });
    }
  }

  const uCuts = sortedUniqueCuts([
    face.uMin,
    face.uMax,
    ...segments.flatMap(({ rect }) => [Math.max(face.uMin, rect.uMin), Math.min(face.uMax, rect.uMax)]),
    ...openings.flatMap(({ rect }) => [Math.max(face.uMin, rect.uMin), Math.min(face.uMax, rect.uMax)]),
  ]);
  const vCuts = sortedUniqueCuts([
    face.vMin,
    face.vMax,
    ...segments.flatMap(({ rect }) => [Math.max(face.vMin, rect.vMin), Math.min(face.vMax, rect.vMax)]),
    ...openings.flatMap(({ rect }) => [Math.max(face.vMin, rect.vMin), Math.min(face.vMax, rect.vMax)]),
  ]);
  let gap = null;
  let overlap = null;
  let obstruction = null;
  for (let uIndex = 0; uIndex < uCuts.length - 1; uIndex += 1) {
    if (uCuts[uIndex + 1] - uCuts[uIndex] <= FACE_COVERAGE_EPSILON) continue;
    const u = (uCuts[uIndex] + uCuts[uIndex + 1]) * 0.5;
    for (let vIndex = 0; vIndex < vCuts.length - 1; vIndex += 1) {
      if (vCuts[vIndex + 1] - vCuts[vIndex] <= FACE_COVERAGE_EPSILON) continue;
      const v = (vCuts[vIndex] + vCuts[vIndex + 1]) * 0.5;
      const insideAperture = openings.some(({ rect }) => rectContains(rect, u, v));
      const covering = segments.filter((segment) => (
        rectContains(segment.rect, u, v)
        && !segment.openings.some(({ rect }) => rectContains(rect, u, v))
      ));
      const sample = { u, v, coveringBoundaryIds: covering.map(({ id }) => id) };
      if (insideAperture && covering.length !== 0) obstruction ??= sample;
      if (!insideAperture && covering.length === 0) gap ??= sample;
      if (!insideAperture && covering.length > 1) overlap ??= sample;
    }
  }
  if (gap) error('cell-face-coverage-gap', `${cell.id}'s ${side} face has uncovered clear space outside declared portals.`, { cellId: cell.id, side, ...gap });
  if (overlap) error('cell-face-coverage-overlap', `${cell.id}'s ${side} face has overlapping structural panels.`, { cellId: cell.id, side, ...overlap });
  if (obstruction) error('cell-face-portal-obstructed', `${cell.id}'s ${side} portal aperture is covered by another structural panel.`, { cellId: cell.id, side, ...obstruction });
}

function planarDistanceToBounds(point, bounds) {
  const dx = point.x < bounds.min.x ? bounds.min.x - point.x
    : point.x > bounds.max.x ? point.x - bounds.max.x : 0;
  const dz = point.z < bounds.min.z ? bounds.min.z - point.z
    : point.z > bounds.max.z ? point.z - bounds.max.z : 0;
  return Math.hypot(dx, dz);
}

function minimumPlanarInset(point, bounds) {
  return Math.min(
    point.x - bounds.min.x,
    bounds.max.x - point.x,
    point.z - bounds.min.z,
    bounds.max.z - point.z,
  );
}

function capsuleIntersectsBounds(point, bounds, radius, height) {
  if (!validBounds(bounds)
    || bounds.max.y <= point.y + 0.03
    || bounds.min.y >= point.y + height - 0.005) return false;
  const dx = Math.max(bounds.min.x - point.x, 0, point.x - bounds.max.x);
  const dz = Math.max(bounds.min.z - point.z, 0, point.z - bounds.max.z);
  return dx * dx + dz * dz < radius * radius - 1e-8;
}

function capsuleIntersectsBoundaryOutsideOpenings(point, boundary, radius, height) {
  if (!capsuleIntersectsBounds(point, boundary?.bounds, radius, height)) return false;
  const capsuleBottom = point.y + 0.03;
  const capsuleTop = point.y + height - 0.005;
  const clearsOpening = (boundary.openings ?? []).some((opening) => {
    const width = Number(opening?.dimensions?.width);
    const openingHeight = Number(opening?.dimensions?.height);
    if (!isFiniteVector(opening?.center) || !Number.isFinite(width)
      || !Number.isFinite(openingHeight) || width <= radius * 2
      || openingHeight < height) return false;
    const verticalMin = opening.center.y - openingHeight * 0.5;
    const verticalMax = opening.center.y + openingHeight * 0.5;
    if (capsuleBottom < verticalMin - 0.001 || capsuleTop > verticalMax + 0.001) return false;
    if (boundary.side === 'north' || boundary.side === 'south') {
      return point.x - radius >= opening.center.x - width * 0.5 - 0.001
        && point.x + radius <= opening.center.x + width * 0.5 + 0.001;
    }
    if (boundary.side === 'east' || boundary.side === 'west') {
      return point.z - radius >= opening.center.z - width * 0.5 - 0.001
        && point.z + radius <= opening.center.z + width * 0.5 + 0.001;
    }
    return false;
  });
  return !clearsOpening;
}

function capsuleFootprintSupportedBySurfaces(point, surfaces, radius) {
  if (!isFiniteVector(point) || !Array.isArray(surfaces) || surfaces.length === 0
    || surfaces.some((surface) => !validBounds(surface?.bounds))
    || !Number.isFinite(radius) || radius <= 0) return false;
  const footprintSamples = [
    { x: 0, z: 0 },
    ...Array.from({ length: 16 }, (_, index) => {
      const angle = index / 16 * Math.PI * 2;
      return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
    }),
  ];
  return footprintSamples.every((offset) => surfaces.some((surface) => (
    Math.abs(point.y - surface.bounds.max.y) <= 0.051
      && point.x + offset.x >= surface.bounds.min.x - 1e-6
      && point.x + offset.x <= surface.bounds.max.x + 1e-6
      && point.z + offset.z >= surface.bounds.min.z - 1e-6
      && point.z + offset.z <= surface.bounds.max.z + 1e-6
  )));
}

function capsuleFootprintPlanarSupportedBySurfaces(point, surfaces, radius) {
  if (!isFiniteVector(point) || !Array.isArray(surfaces) || surfaces.length === 0
    || surfaces.some((surface) => !validBounds(surface?.bounds))
    || !Number.isFinite(radius) || radius <= 0) return false;
  const footprintSamples = [
    { x: 0, z: 0 },
    ...Array.from({ length: 16 }, (_, index) => {
      const angle = index / 16 * Math.PI * 2;
      return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
    }),
  ];
  return footprintSamples.every((offset) => surfaces.some((surface) => (
    point.x + offset.x >= surface.bounds.min.x - 1e-6
      && point.x + offset.x <= surface.bounds.max.x + 1e-6
      && point.z + offset.z >= surface.bounds.min.z - 1e-6
      && point.z + offset.z <= surface.bounds.max.z + 1e-6
  )));
}

function mapById(values) {
  return new Map((values ?? []).map((entry) => [entry.id, entry]));
}

function validateOperation(operation, allowed, path, error) {
  if (!operation || typeof operation !== 'object' || !allowed.includes(operation.op)) {
    error('action-operation-invalid', `Unsupported serializable operation at ${path}.`, { path, operation: operation?.op ?? null });
    return;
  }
  if (operation.op === 'all' || operation.op === 'any') {
    if (!Array.isArray(operation.conditions) || operation.conditions.length === 0) {
      error('condition-group-empty', `${operation.op} requires conditions.`, { path });
      return;
    }
    operation.conditions.forEach((entry, index) => validateOperation(entry, CONDITION_OPERATIONS_V2, `${path}.conditions[${index}]`, error));
  }
}

function validateIds(collectionName, values, error) {
  const seen = new Set();
  for (const [index, entry] of values.entries()) {
    if (!entry?.id || typeof entry.id !== 'string') {
      error('stable-id-missing', `${collectionName}[${index}] has no stable ID.`, { collectionName, index });
    } else if (seen.has(entry.id)) {
      error('stable-id-duplicate', `${collectionName} repeats ${entry.id}.`, { collectionName, id: entry.id });
    } else {
      seen.add(entry.id);
    }
  }
}

function validateGoldenRules(plan, error, options = {}) {
  if (options.allowIncompleteGoldenComposition !== true) {
    const nativeDescriptorIds = new Set(LEGACY_FIXED_ROOM_MODULE_IDS_V2);
    const nativePlacements = plan.modulePlacements.filter(({ descriptorId }) => (
      nativeDescriptorIds.has(descriptorId)
    ));
    const nativeCounts = new Map();
    for (const placement of nativePlacements) {
      nativeCounts.set(placement.descriptorId, (nativeCounts.get(placement.descriptorId) ?? 0) + 1);
    }
    for (const descriptorId of LEGACY_FIXED_ROOM_MODULE_IDS_V2) {
      if ((nativeCounts.get(descriptorId) ?? 0) !== 1) {
        error(
          'golden-native-room-count-invalid',
          `${descriptorId} must be physically placed exactly once in the Golden complex.`,
          { descriptorId, actualCount: nativeCounts.get(descriptorId) ?? 0, expectedCount: 1 },
        );
      }
    }

    const expectedPackRoomIds = new Set([
      GOLDEN_ROOM_PACK_IDS_V2.factory,
      GOLDEN_ROOM_PACK_IDS_V2.waterworks,
      GOLDEN_ROOM_PACK_IDS_V2[plan.undercroftType],
    ].filter(Boolean));
    const packPlacements = plan.semanticRoomPackPlacements ?? [];
    const packRoomIds = new Set(packPlacements.map(({ roomId }) => roomId));
    if (packPlacements.length !== 3 || packRoomIds.size !== 3
      || expectedPackRoomIds.size !== 3
      || [...expectedPackRoomIds].some((roomId) => !packRoomIds.has(roomId))) {
      error(
        'golden-room-pack-composition-invalid',
        'Golden complex requires the Factory and Waterworks macros plus exactly one seeded Undercroft macro.',
        {
          expectedRoomIds: [...expectedPackRoomIds].sort(),
          actualRoomIds: packPlacements.map(({ roomId }) => roomId).sort(),
        },
      );
    }

    const moduleById = new Map(plan.modulePlacements.map((placement) => [placement.id, placement]));
    for (const packPlacement of packPlacements) {
      const placementId = packPlacement.placementId ?? packPlacement.id;
      const modulePlacement = moduleById.get(placementId);
      if (!modulePlacement || modulePlacement.roomId !== packPlacement.roomId
        || modulePlacement.semanticRoomPackPlacementId !== placementId) {
        error(
          'golden-room-pack-module-missing',
          `${placementId} must be a live module placement owned by its authored room-pack placement.`,
          {
            placementId,
            roomId: packPlacement.roomId,
            resolvedModuleId: modulePlacement?.id ?? null,
            resolvedRoomId: modulePlacement?.roomId ?? null,
          },
        );
      }
    }
    if (plan.modulePlacements.length !== 14 || nativePlacements.length !== 11) {
      error(
        'golden-authored-composition-count-invalid',
        'Golden complex must contain exactly eleven distinct V1 rooms and three authored room-pack macros.',
        {
          totalPlacementCount: plan.modulePlacements.length,
          nativePlacementCount: nativePlacements.length,
          packPlacementCount: packPlacements.length,
          expectedTotalPlacementCount: 14,
        },
      );
    }
  }

  if (plan.districts.length !== 3) {
    error('golden-district-count', 'Golden complex must contain exactly three districts.', { actual: plan.districts.length });
  }
  if (plan.regions.length !== 17) {
    error('golden-region-count', 'Golden complex must contain exactly 17 playable regions.', { actual: plan.regions.length });
  }
  const districtIds = new Set(plan.districts.map((entry) => entry.id));
  for (const id of ['factory', 'waterworks', 'undercroft']) {
    if (!districtIds.has(id)) error('golden-district-missing', `Golden complex is missing ${id}.`, { districtId: id });
  }
  let derivedSignatures = null;
  try {
    derivedSignatures = deriveDungeonTopologySignaturesV2(plan);
  } catch (topologyError) {
    error('topology-signature-unverifiable', 'Golden topology signatures could not be reconstructed from plan geometry.', {
      reason: topologyError instanceof Error ? topologyError.message : String(topologyError),
    });
  }
  const signatures = new Set();
  for (const region of plan.regions) {
    if (!region.topologySignature) error('topology-signature-missing', `${region.id} has no normalized topology signature.`, { regionId: region.id });
    else if (derivedSignatures && region.topologySignature !== derivedSignatures[region.id]) error('topology-signature-not-derived', `${region.id} topology signature does not match its physical D4-normalized topology.`, { regionId: region.id, claimed: region.topologySignature, derived: derivedSignatures[region.id] });
    else if (signatures.has(region.topologySignature)) error('topology-signature-reused', `${region.id} reuses a playable topology signature.`, { regionId: region.id, signature: region.topologySignature });
    signatures.add(region.topologySignature);
  }
  if (!['magma', 'electrical'].includes(plan.undercroftType)) {
    error('undercroft-type-invalid', 'Golden complex requires a seeded Magma or Electrical Undercroft.', { undercroftType: plan.undercroftType });
  }

  const portalById = mapById(plan.portals);
  const ordered = (plan.connectionOrder ?? []).map((id) => portalById.get(id)).filter(Boolean);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index - 1].connectorForm === ordered[index].connectorForm) {
      error('connector-form-consecutive', 'The same connector form may not appear consecutively.', { first: ordered[index - 1].id, second: ordered[index].id, connectorForm: ordered[index].connectorForm });
    }
  }
  const formCounts = new Map();
  for (const portal of plan.portals) formCounts.set(portal.connectorForm, (formCounts.get(portal.connectorForm) ?? 0) + 1);
  for (const [connectorForm, count] of formCounts) {
    if (count / plan.portals.length > 0.4) error('connector-form-excessive', `${connectorForm} exceeds 40% of connections.`, { connectorForm, count, total: plan.portals.length });
  }

  const diversityGroups = [...plan.districts.map((entry) => ({ id: `district:${entry.id}`, regionIds: entry.regionIds })), ...(plan.keycardZones ?? []).map((entry) => ({ id: entry.id, regionIds: entry.regionIds }))];
  for (const group of diversityGroups) {
    const regionIds = new Set(group.regionIds);
    const endpoints = plan.portals.flatMap((portal) => [portal.from, portal.to]).filter((endpoint) => regionIds.has(endpoint.regionId));
    const elevations = [...new Set(endpoints.map((entry) => entry.elevation))].sort((a, b) => a - b);
    const buckets = new Set(endpoints.map((entry) => entry.placementBucket));
    const forms = new Set(plan.portals.filter((portal) => regionIds.has(portal.from.regionId) || regionIds.has(portal.to.regionId)).map((entry) => entry.connectorForm));
    if (elevations.length < 2 || elevations.at(-1) - elevations[0] < 3) error('portal-height-diversity', `${group.id} lacks portal height variation of at least three metres.`, { groupId: group.id, elevations });
    if (buckets.size < 2) error('portal-placement-diversity', `${group.id} lacks varied portal placement.`, { groupId: group.id, buckets: [...buckets] });
    if (forms.size < 2) error('portal-form-diversity', `${group.id} lacks varied connector forms.`, { groupId: group.id, forms: [...forms] });
  }

  const keyIds = new Set(plan.progression?.keyContracts?.map((entry) => entry.keyId));
  for (const keyId of ['Keycard_Alpha', 'Keycard_Beta', 'Keycard_Gamma', 'Shrine_Key']) {
    if (!keyIds.has(keyId)) error('progression-key-missing', `Missing required progression key ${keyId}.`, { keyId });
  }
  const nonBypassable = plan.progression?.gates?.filter((entry) => entry.classification === 'non-bypassable-progression') ?? [];
  if (nonBypassable.length < 1) error('non-bypassable-gate-missing', 'At least one gate must be explicitly non-bypassable.', {});
  const shrineRewards = plan.rewards.filter((entry) => entry.keycardId === 'Shrine_Key');
  if (shrineRewards.length !== 1 || shrineRewards[0].conditions?.[0]?.op !== 'encounterComplete') {
    error('shrine-key-source-invalid', 'Shrine Key must exist once and only as the final-elite reward.', { rewardIds: shrineRewards.map((entry) => entry.id) });
  }
}

export function validateDungeonPlanV2(candidate, options = {}) {
  const errors = [];
  const warnings = [];
  const error = (code, message, details) => errors.push(createPlanDiagnostic(code, message, details));
  const warn = (code, message, details) => warnings.push(createPlanDiagnostic(code, message, details));
  let symbolicResult = null;

  if (!candidate || typeof candidate !== 'object') {
    error('plan-missing', 'DungeonPlanV2 must be an object.', {});
  } else {
    if (candidate.schemaVersion !== DUNGEON_PLAN_V2_SCHEMA_VERSION) error('schema-version-invalid', 'DungeonPlanV2 schema version is unsupported.', { expected: DUNGEON_PLAN_V2_SCHEMA_VERSION, actual: candidate.schemaVersion });
    if (!isSerializablePlanValue(candidate)) error('plan-not-serializable', 'DungeonPlanV2 contains a function, class instance, cycle, or non-finite value.', {});
    for (const name of REQUIRED_ARRAYS) {
      if (!Array.isArray(candidate[name])) error('collection-missing', `DungeonPlanV2.${name} must be an array.`, { collectionName: name });
    }
  }

  if (errors.length === 0) {
    if (Array.isArray(candidate.semanticRoomPackPlacements)) {
      const authoredRoomPackValidation = validateSemanticRoomPackPlanV2(candidate);
      errors.push(...authoredRoomPackValidation.errors);
    }
    if (candidate.semanticRoomPackIntegration?.acceptanceBlocking === true
      || candidate.semanticRoomPackIntegration?.fullyIntegrated === false) {
      error(
        'semantic-room-pack-integration-incomplete',
        'Authored semantic room-pack routes are not yet fully physicalized and cannot enter an accepted dungeon.',
        {
          pendingRoutes: clonePlanData(candidate.semanticRoomPackIntegration?.pendingRoutes ?? []),
          placementIds: clonePlanData(candidate.semanticRoomPackIntegration?.placementIds ?? []),
        },
      );
    }
    for (const name of REQUIRED_ARRAYS) validateIds(name, candidate[name], error);
    if (!candidate.progression || typeof candidate.progression !== 'object') error('progression-missing', 'DungeonPlanV2.progression is required.', {});
    if (!candidate.minimap || typeof candidate.minimap !== 'object') error('minimap-missing', 'DungeonPlanV2.minimap is required.', {});

    const districtById = mapById(candidate.districts);
    const regionById = mapById(candidate.regions);
    const cellById = mapById(candidate.spatialCells);
    const boundaryById = mapById(candidate.structuralBoundaries);
    const portalById = mapById(candidate.portals);
    const surfaceById = mapById(candidate.walkableSurfaces);
    const fixtureById = mapById(candidate.structuralFixtures);
    const anchorById = mapById(candidate.anchors);
    const actionById = mapById(candidate.actions);
    const mechanismById = mapById(candidate.mechanisms);
    const encounterById = mapById(candidate.encounters);
    const traversalLinkById = mapById(candidate.traversalLinks);

    for (const region of candidate.regions) {
      if (!districtById.has(region.districtId)) error('region-district-missing', `${region.id} references an unknown district.`, { regionId: region.id, districtId: region.districtId });
      if (!validBounds(region.bounds)) error('region-bounds-invalid', `${region.id} has invalid bounds.`, { regionId: region.id });
    }
    for (const cell of candidate.spatialCells) {
      if (!regionById.has(cell.regionId)) error('cell-region-missing', `${cell.id} references an unknown region.`, { cellId: cell.id, regionId: cell.regionId });
      if (!validBounds(cell.bounds)) error('cell-bounds-invalid', `${cell.id} has invalid bounds.`, { cellId: cell.id });
      const boundaries = candidate.structuralBoundaries.filter((entry) => entry.cellId === cell.id && ['solid', 'portal-frame'].includes(entry.kind));
      for (const side of BOUNDARY_SIDES_V2) {
        validateCellFaceCoverage(cell, side, boundaries.filter((entry) => entry.side === side), error);
      }
    }
    for (let leftIndex = 0; leftIndex < candidate.spatialCells.length; leftIndex += 1) {
      const left = candidate.spatialCells[leftIndex];
      if (!validBounds(left.bounds)) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < candidate.spatialCells.length; rightIndex += 1) {
        const right = candidate.spatialCells[rightIndex];
        if (!validBounds(right.bounds) || !overlaps(left.bounds, right.bounds)) continue;
        if (left.compoundId && left.compoundId === right.compoundId) continue;
        const leftPortal = left.portalId ? portalById.get(left.portalId) : null;
        const rightPortal = right.portalId ? portalById.get(right.portalId) : null;
        const connectorTouchesRoom = (connector, room, portal) => {
          if (!connector.connector || room.connector || !portal) return false;
          const routeCellIds = portal.physicalRoute?.cellIds ?? [];
          return (room.id === portal.from.cellId && connector.id === routeCellIds[0])
            || (room.id === portal.to.cellId && connector.id === routeCellIds.at(-1));
        };
        if (connectorTouchesRoom(left, right, leftPortal) || connectorTouchesRoom(right, left, rightPortal)) continue;
        error('occupied-volume-overlap', `${left.id} overlaps ${right.id} without a shared compound contract.`, { leftCellId: left.id, rightCellId: right.id });
      }
    }
    for (const boundary of candidate.structuralBoundaries) {
      if (!cellById.has(boundary.cellId)) error('boundary-cell-missing', `${boundary.id} references an unknown cell.`, { boundaryId: boundary.id, cellId: boundary.cellId });
      if (!BOUNDARY_SIDES_V2.includes(boundary.side) || !validBounds(boundary.bounds)) error('boundary-invalid', `${boundary.id} has invalid side or bounds.`, { boundaryId: boundary.id });
      if (boundary.collider !== true || boundary.opaque !== true) error('boundary-not-physical', `${boundary.id} must be opaque visual and collision geometry.`, { boundaryId: boundary.id });
      if (!Array.isArray(boundary.openings)) error('boundary-openings-invalid', `${boundary.id} openings must be explicit objects.`, { boundaryId: boundary.id });
      for (const opening of boundary.openings ?? []) {
        if (!opening?.id || !opening.portalId || !isFiniteVector(opening.center) || !opening.dimensions) error('boundary-opening-invalid', `${boundary.id} has an incomplete opening.`, { boundaryId: boundary.id, openingId: opening?.id ?? null });
        if (opening?.jointId && isFiniteVector(opening.center)
          && BOUNDARY_SIDES_V2.includes(boundary.side)) {
          const cell = cellById.get(boundary.cellId);
          const fixedAxis = ['east', 'west'].includes(boundary.side) ? 'x'
            : ['north', 'south'].includes(boundary.side) ? 'z' : 'y';
          const expectedPlane = ['west', 'north', 'floor'].includes(boundary.side)
            ? cell?.bounds?.min?.[fixedAxis]
            : cell?.bounds?.max?.[fixedAxis];
          if (!Number.isFinite(expectedPlane)
            || Math.abs(opening.center[fixedAxis] - expectedPlane) > 0.001) {
            error('connector-elbow-opening-off-plane', `${opening.id} must lie on its owning connector cell face.`, {
              boundaryId: boundary.id,
              cellId: boundary.cellId,
              openingId: opening.id,
              jointId: opening.jointId,
              side: boundary.side,
              fixedAxis,
              expectedPlane,
              actualPlane: opening.center[fixedAxis],
            });
          }
        }
        if (opening?.pairedWithinCompound === true) {
          const sourceCell = cellById.get(opening.sourceCellId);
          const targetCell = cellById.get(opening.targetCellId);
          const internalTraversal = candidate.traversalLinks.find((link) => link.internalPortalId === opening.internalPortalId);
          if (!sourceCell || !targetCell || sourceCell.id !== boundary.cellId
            || sourceCell.regionId !== targetCell.regionId
            || !sourceCell.compoundId || sourceCell.compoundId !== targetCell.compoundId
            || opening.targetRegionId !== targetCell.regionId || !internalTraversal) {
            error('compound-opening-unpaired', `${opening.id} is not paired to a traversable cell in the same authored compound.`, { boundaryId: boundary.id, openingId: opening.id, sourceCellId: opening.sourceCellId, targetCellId: opening.targetCellId });
          }
        }
      }
    }
    for (const portal of candidate.portals) {
      for (const endpoint of [portal.from, portal.to]) {
        const endpointCell = cellById.get(endpoint.cellId);
        const endpointBoundary = boundaryById.get(endpoint.boundaryId);
        if (!regionById.has(endpoint.regionId) || !endpointCell || !endpointBoundary) {
          error('portal-endpoint-invalid', `${portal.id} has an unresolved endpoint.`, { portalId: portal.id, endpoint });
          continue;
        }
        const physicallyOwnedRegionIds = new Set([
          endpointCell.regionId,
          ...(endpointCell.semanticRegionIds ?? []),
        ]);
        if (!physicallyOwnedRegionIds.has(endpoint.regionId)) {
          error(
            'portal-endpoint-region-ownership-invalid',
            `${portal.id} labels ${endpoint.cellId} as ${endpoint.regionId}, but that authored physical cell does not own the semantic region.`,
            {
              portalId: portal.id,
              cellId: endpoint.cellId,
              endpointRegionId: endpoint.regionId,
              physicallyOwnedRegionIds: [...physicallyOwnedRegionIds].sort(),
            },
          );
        }
        if (endpointBoundary.cellId !== endpoint.cellId) {
          error(
            'portal-endpoint-boundary-cell-mismatch',
            `${portal.id} endpoint boundary ${endpoint.boundaryId} is not part of ${endpoint.cellId}.`,
            {
              portalId: portal.id,
              cellId: endpoint.cellId,
              boundaryId: endpoint.boundaryId,
              boundaryCellId: endpointBoundary.cellId,
            },
          );
        }
      }
      if (!regionById.has(portal.visibleDestinationRegionId)) error('portal-visible-destination-invalid', `${portal.id} exposes an unplayable destination.`, { portalId: portal.id, regionId: portal.visibleDestinationRegionId });
      const route = portal.physicalRoute;
      if (!route?.authored || !route.enclosed || !route.continuous || !route.supported || !Array.isArray(route.cellIds) || route.cellIds.length === 0) error('portal-route-missing', `${portal.id} lacks an authored enclosed physical route.`, { portalId: portal.id });
      for (const id of route?.cellIds ?? []) if (!cellById.has(id)) error('portal-route-cell-missing', `${portal.id} references missing connector cell ${id}.`, { portalId: portal.id, cellId: id });
      for (const id of route?.boundaryIds ?? []) if (!boundaryById.has(id)) error('portal-route-boundary-missing', `${portal.id} references missing connector boundary ${id}.`, { portalId: portal.id, boundaryId: id });
      for (const id of route?.surfaceIds ?? []) if (!surfaceById.has(id)) error('portal-route-surface-missing', `${portal.id} references missing connector surface ${id}.`, { portalId: portal.id, surfaceId: id });
    }
    for (const surface of candidate.walkableSurfaces) {
      if (!cellById.has(surface.cellId) || !validBounds(surface.bounds)) error('walkable-surface-invalid', `${surface.id} has invalid cell or bounds.`, { surfaceId: surface.id });
      if (!surface.purpose || !surface.supportProfile) error('walkable-surface-purpose-support-missing', `${surface.id} requires a gameplay purpose and visible support profile.`, { surfaceId: surface.id });
      for (const id of surface.supportBoundaryIds ?? []) if (!boundaryById.has(id)) error('surface-support-boundary-missing', `${surface.id} references missing support boundary ${id}.`, { surfaceId: surface.id, boundaryId: id });
      for (const id of surface.supportFixtureIds ?? []) if (!fixtureById.has(id)) error('surface-support-fixture-missing', `${surface.id} references missing support fixture ${id}.`, { surfaceId: surface.id, fixtureId: id });
      if (surface.collision === 'dynamic' && !surface.mechanismId) error('dynamic-surface-controller-missing', `${surface.id} is dynamic without a mechanism controller.`, { surfaceId: surface.id });
      const stairContract = surface.stairs ?? (['stairs', 'walkable-stairs'].includes(surface.geometry?.type) ? surface.geometry : null);
      if (stairContract) {
        const start = stairContract.start ?? stairContract.path?.[0];
        const end = stairContract.end ?? stairContract.path?.at(-1);
        const maxRiser = Number(stairContract.maxRiser ?? stairContract.maximumRiser);
        const minimumTread = Number(stairContract.minimumTread);
        const width = Number(stairContract.width);
        const run = start && end ? Math.hypot(end.x - start.x, end.z - start.z) : Number.NaN;
        const rise = start && end ? Math.abs(end.y - start.y) : Number.NaN;
        const minimumSteps = Number.isFinite(rise) && Number.isFinite(maxRiser) && maxRiser > 0 ? Math.max(1, Math.ceil(rise / maxRiser - 0.000001)) : Number.POSITIVE_INFINITY;
        const maximumSteps = Number.isFinite(run) && Number.isFinite(minimumTread) && minimumTread > 0 ? Math.floor(run / minimumTread + 0.000001) : -1;
        if (!isFiniteVector(start) || !isFiniteVector(end) || width < 1.2 || maxRiser <= 0 || maxRiser > 0.18 || minimumTread < 0.45 || maximumSteps < minimumSteps) error('stair-envelope-impossible', `${surface.id} cannot satisfy its exact smooth stair riser/tread contract.`, { surfaceId: surface.id, rise, run, maxRiser, minimumTread, minimumSteps, maximumSteps });
        const endpointIds = stairContract.endpointSurfaceIds;
        const startSurface = surfaceById.get(endpointIds?.start);
        const endSurface = surfaceById.get(endpointIds?.end);
        if (!startSurface || !endSurface || startSurface.id === surface.id || endSurface.id === surface.id) {
          error('stair-endpoint-surface-missing', `${surface.id} must bind both ends to distinct authored walkable surfaces.`, { surfaceId: surface.id, endpointSurfaceIds: endpointIds ?? null });
        } else if (isFiniteVector(start) && isFiniteVector(end)) {
          const maximumHeightDelta = Math.min(0.05, Number(stairContract.maximumEndpointHeightDelta ?? 0.05));
          const minimumOverlap = Math.max(1.2, Number(stairContract.minimumEndpointOverlap ?? 1.2));
          const runLength = Math.hypot(end.x - start.x, end.z - start.z);
          const direction = runLength > 1e-6
            ? { x: (end.x - start.x) / runLength, z: (end.z - start.z) / runLength }
            : null;
          const endpointChecks = [
            { role: 'start', point: start, deck: startSurface, deckDirection: -1 },
            { role: 'end', point: end, deck: endSurface, deckDirection: 1 },
          ];
          for (const endpoint of endpointChecks) {
            const heightDelta = Math.abs(endpoint.point.y - endpoint.deck.bounds.max.y);
            const horizontalGap = planarDistanceToBounds(endpoint.point, endpoint.deck.bounds);
            if (heightDelta > maximumHeightDelta + 1e-6 || horizontalGap > 0.05 + 1e-6) {
              error('stair-endpoint-seam-gap', `${surface.id} ${endpoint.role} is not flush with ${endpoint.deck.id}.`, { surfaceId: surface.id, endpoint: endpoint.role, deckSurfaceId: endpoint.deck.id, heightDelta, horizontalGap });
            }
            const outwardDeckPoint = direction ? {
              x: endpoint.point.x + direction.x * endpoint.deckDirection * minimumOverlap,
              y: endpoint.deck.bounds.max.y,
              z: endpoint.point.z + direction.z * endpoint.deckDirection * minimumOverlap,
            } : null;
            const outwardDeckGap = outwardDeckPoint
              ? planarDistanceToBounds(outwardDeckPoint, endpoint.deck.bounds)
              : Number.POSITIVE_INFINITY;
            if (outwardDeckGap > 0.05 + 1e-6) {
              error('stair-endpoint-overlap-short', `${surface.id} ${endpoint.role} deck does not continue ${minimumOverlap}m outward from the exact ramp seam.`, { surfaceId: surface.id, endpoint: endpoint.role, deckSurfaceId: endpoint.deck.id, outwardDeckPoint, outwardDeckGap, minimumOverlap });
            }
          }
          if (width < 1.2 || Number(stairContract.minimumUsableSeamWidth) < 1.2) {
            error('stair-endpoint-width-narrow', `${surface.id} does not provide a 1.2m usable seam at both decks.`, { surfaceId: surface.id, width, minimumUsableSeamWidth: stairContract.minimumUsableSeamWidth });
          }
        }
      }
    }
    for (const link of candidate.traversalLinks) {
      if (!surfaceById.has(link.fromSurfaceId) || !surfaceById.has(link.toSurfaceId)) error('traversal-link-surface-missing', `${link.id} references an unknown surface.`, { linkId: link.id, fromSurfaceId: link.fromSurfaceId, toSurfaceId: link.toSurfaceId });
      if (link.viaSurfaceId && !surfaceById.has(link.viaSurfaceId)) error('traversal-link-via-missing', `${link.id} references an unknown traversal surface.`, { linkId: link.id, viaSurfaceId: link.viaSurfaceId });
      const assemblyApproachRequired = link.id === 'traversal.assembly.landmark-stairs';
      const alphaGateApproach = link.id === 'traversal.security.security-sorting-alpha';
      const approachRequired = assemblyApproachRequired || alphaGateApproach;
      const approach = link.approachWaypoints;
      if (approachRequired && (!Array.isArray(approach) || approach.length < 2)) {
        error('stair-ground-approach-missing', `${link.id} requires a plan-owned ground staging route.`, { linkId: link.id });
      }
      if (Array.isArray(approach) && approach.length > 0) {
        const sourceSurface = surfaceById.get(link.fromSurfaceId);
        const stairSurface = surfaceById.get(link.viaSurfaceId);
        const stairGeometry = stairSurface?.stairs ?? stairSurface?.geometry;
        const foot = stairGeometry?.path?.[0];
        const upper = stairGeometry?.path?.at(-1);
        const contract = link.approachContract;
        const radius = Number(contract?.capsuleRadius);
        const approachSurfaceIds = link.approachSurfaceIds;
        const approachSegments = link.approachSegments;
        if (approach.length < 2 || !sourceSurface || !stairSurface
          || !approach.every(isFiniteVector)
          || !Array.isArray(approachSurfaceIds)
          || approachSurfaceIds.length !== approach.length
          || !Array.isArray(approachSegments)
          || contract?.sourceSurfaceId !== sourceSurface?.id
          || contract?.stairSurfaceId !== stairSurface?.id
          || contract?.groundedOnly !== true
          || contract?.jumpAllowed !== false
          || contract?.ledgeClimbAllowed !== false
          || !Number.isFinite(radius) || radius < 0.42) {
          error('stair-ground-approach-invalid', `${link.id} has an incomplete grounded stair approach contract.`, { linkId: link.id, approachContract: contract ?? null });
        } else {
          for (const [index, point] of approach.entries()) {
            const owner = surfaceById.get(approachSurfaceIds[index]);
            const ordinaryInsideOwner = owner
              && point.x >= owner.bounds.min.x + radius - 1e-6
              && point.x <= owner.bounds.max.x - radius + 1e-6
              && point.z >= owner.bounds.min.z + radius - 1e-6
              && point.z <= owner.bounds.max.z - radius + 1e-6
              && Math.abs(point.y - owner.bounds.max.y) <= 0.051;
            const runLength = isFiniteVector(foot) && isFiniteVector(upper)
              ? Math.hypot(upper.x - foot.x, upper.z - foot.z)
              : 0;
            const tangent = runLength > 1e-6
              ? { x: -(upper.z - foot.z) / runLength, z: (upper.x - foot.x) / runLength }
              : null;
            const exactFootSeam = owner && tangent && index === approach.length - 1
              && Math.hypot(point.x - foot.x, point.y - foot.y, point.z - foot.z) <= 0.051
              && Math.abs(point.y - owner.bounds.max.y) <= 0.051
              && [-radius, radius].every((offset) => planarDistanceToBounds({
                x: point.x + tangent.x * offset,
                z: point.z + tangent.z * offset,
              }, owner.bounds) <= 0.001);
            const insideOwner = ordinaryInsideOwner || exactFootSeam;
            if (!insideOwner) error('stair-ground-approach-off-surface', `${link.id} approach point ${index} leaves its declared walkable surface.`, { linkId: link.id, pointIndex: index, point, surfaceId: approachSurfaceIds[index] });
          }
          const ingressPoint = contract.ingressPoint;
          const expectedSegmentCount = approach.length - 1;
          if (approachSegments.length !== expectedSegmentCount) {
            error('stair-ground-approach-segments-incomplete', `${link.id} must own every ordered post-ingress segment.`, { linkId: link.id, expectedSegmentCount, actualSegmentCount: approachSegments.length });
          }
          const seamWidth = (left, right) => {
            if (!left || !right) return -Infinity;
            const sharedX = Math.min(left.bounds.max.x, right.bounds.max.x) - Math.max(left.bounds.min.x, right.bounds.min.x);
            const sharedZ = Math.min(left.bounds.max.z, right.bounds.max.z) - Math.max(left.bounds.min.z, right.bounds.min.z);
            const touchesX = Math.abs(left.bounds.max.x - right.bounds.min.x) <= 0.001 || Math.abs(right.bounds.max.x - left.bounds.min.x) <= 0.001;
            const touchesZ = Math.abs(left.bounds.max.z - right.bounds.min.z) <= 0.001 || Math.abs(right.bounds.max.z - left.bounds.min.z) <= 0.001;
            return touchesX ? sharedZ : touchesZ ? sharedX : -Infinity;
          };
          for (const [segmentIndex, segment] of approachSegments.entries()) {
            const start = approach[segment.fromWaypointIndex];
            const end = approach[segment.toWaypointIndex];
            const segmentSurfaces = (segment.surfaceIds ?? []).map((id) => surfaceById.get(id));
            const indicesValid = segment.fromIngress !== true
              && segment.fromWaypointIndex === segmentIndex
              && segment.toWaypointIndex === segmentIndex + 1;
            if (!indicesValid || !isFiniteVector(start) || !isFiniteVector(end)
              || segmentSurfaces.length === 0 || segmentSurfaces.some((surface) => !surface)) {
              error('stair-ground-approach-segment-invalid', `${link.id} has an unresolved ordered approach segment.`, { linkId: link.id, segmentIndex, segment });
              continue;
            }
            const distance = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
            const spacing = Math.min(0.21, Number(contract.sampleSpacing) || 0.21);
            const sampleCount = Math.max(1, Math.ceil(distance / spacing));
            for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
              const ratio = sampleIndex / sampleCount;
              const point = {
                x: start.x + (end.x - start.x) * ratio,
                y: start.y + (end.y - start.y) * ratio,
                z: start.z + (end.z - start.z) * ratio,
              };
              const supported = segmentSurfaces.some((surface) => point.x >= surface.bounds.min.x - 1e-6
                && point.x <= surface.bounds.max.x + 1e-6
                && point.z >= surface.bounds.min.z - 1e-6
                && point.z <= surface.bounds.max.z + 1e-6
                && Math.abs(point.y - surface.bounds.max.y) <= 0.051);
              if (!supported) {
                error('stair-ground-approach-segment-unsupported', `${link.id} approach segment ${segmentIndex} leaves its declared walkable surfaces.`, { linkId: link.id, segmentIndex, point });
                break;
              }
            }
            if (segmentSurfaces.length > 1) {
              const actualSeamWidth = seamWidth(segmentSurfaces[0], segmentSurfaces[1]);
              if (actualSeamWidth < 1.2 || Math.abs(Number(segment.seamWidth) - actualSeamWidth) > 0.001) {
                error('stair-ground-approach-seam-narrow', `${link.id} approach segment ${segmentIndex} lacks a 1.2m authored floor seam.`, { linkId: link.id, segmentIndex, actualSeamWidth, declaredSeamWidth: segment.seamWidth });
              }
            }
          }
          const last = approach.at(-1);
          if (!isFiniteVector(foot) || Math.hypot(last.x - foot.x, last.y - foot.y, last.z - foot.z) > 0.051) {
            error('stair-ground-approach-misses-foot', `${link.id} ground approach must terminate at its exact first tread.`, { linkId: link.id, lastPoint: last, stairFoot: foot ?? null });
          }
          if (alphaGateApproach) {
            const reverseEgress = link.reverseEgressWaypoints;
            // Alpha's public route continues from the exact three-tile ramp
            // across the supported native perimeter catwalk to the north gate.
            // Validate the ramp subset against the incline centerline while
            // leaving `waypoints` authoritative for the complete physical path.
            const route = link.stairWaypoints;
            const egressMatches = Array.isArray(reverseEgress)
              && reverseEgress.length === 1
              && isFiniteVector(reverseEgress[0])
              && Math.hypot(
                reverseEgress[0].x - approach[0].x,
                reverseEgress[0].y - approach[0].y,
                reverseEgress[0].z - approach[0].z,
              ) <= 0.051;
            if (!egressMatches) {
              error('stair-reverse-egress-invalid', `${link.id} must clear its final tread through the grounded approach before turning.`, { linkId: link.id, reverseEgressWaypoints: reverseEgress ?? null, expectedEgress: approach[0] });
            }
            let routeValid = Array.isArray(route) && route.length >= 2
              && route.every(isFiniteVector) && isFiniteVector(foot) && isFiniteVector(upper);
            const routeRunX = Number(upper?.x) - Number(foot?.x);
            const routeRunZ = Number(upper?.z) - Number(foot?.z);
            const routeRunSquared = routeRunX * routeRunX + routeRunZ * routeRunZ;
            if (routeValid) {
              routeValid = Math.hypot(
                route[0].x - foot.x,
                route[0].y - foot.y,
                route[0].z - foot.z,
              ) <= 0.051 && Math.hypot(
                route.at(-1).x - upper.x,
                route.at(-1).y - upper.y,
                route.at(-1).z - upper.z,
              ) <= 0.051 && routeRunSquared > 0.0025;
            }
            for (let index = 0; routeValid && index < route.length; index += 1) {
              const point = route[index];
              const progress = ((point.x - foot.x) * routeRunX + (point.z - foot.z) * routeRunZ)
                / routeRunSquared;
              const projectedX = foot.x + routeRunX * progress;
              const projectedZ = foot.z + routeRunZ * progress;
              const expectedY = foot.y + (upper.y - foot.y) * progress;
              const previous = route[index - 1];
              const segmentLength = previous
                ? Math.hypot(point.x - previous.x, point.z - previous.z)
                : 0;
              routeValid = progress >= -0.001 && progress <= 1.001
                && Math.hypot(point.x - projectedX, point.z - projectedZ) <= 0.051
                && Math.abs(point.y - expectedY) <= 0.051
                && segmentLength <= 2.5 + 0.001;
            }
            if (!routeValid) {
              error('stair-route-checkpoints-invalid', `${link.id} must expose short stairWaypoints on its exact supported centerline.`, { linkId: link.id, stairWaypoints: route ?? null, maximumSegmentLength: 2.5 });
            }
          }
          if (assemblyApproachRequired) {
            const pointsMatch = (left, right) => isFiniteVector(left) && isFiniteVector(right)
              && Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z) <= 0.001;
            const nativeRampSurfaces = (link.nativeRampSurfaceIds ?? [])
              .map((surfaceId) => surfaceById.get(surfaceId));
            const expectedStairRoute = isFiniteVector(foot) && isFiniteVector(upper)
              && nativeRampSurfaces.length === 11
              && nativeRampSurfaces.every((surface) => isFiniteVector(surface?.center))
              ? [foot, ...nativeRampSurfaces.map(({ center }) => center), upper]
              : [];
            const stairRoute = link.stairWaypoints;
            const publicRoute = link.waypoints;
            const routeMatchesNativeRamp = expectedStairRoute.length === 13
              && Array.isArray(stairRoute) && stairRoute.length === expectedStairRoute.length
              && Array.isArray(publicRoute) && publicRoute.length === expectedStairRoute.length
              && expectedStairRoute.every((point, index) => (
                pointsMatch(stairRoute[index], point)
                && pointsMatch(publicRoute[index], point)
                && (index === 0 || Math.hypot(
                  point.x - expectedStairRoute[index - 1].x,
                  point.z - expectedStairRoute[index - 1].z,
                ) <= 2.8 + 0.001)
              ));
            if (!routeMatchesNativeRamp) {
              error('assembly-stair-route-checkpoints-invalid', `${link.id} must expose its exact eleven-tile native V1 ramp centerline to public combat traversal.`, {
                linkId: link.id,
                nativeRampSurfaceIds: link.nativeRampSurfaceIds ?? null,
                stairWaypoints: stairRoute ?? null,
                waypoints: publicRoute ?? null,
              });
            }
            const reverseEgress = link.reverseEgressWaypoints;
            const reverseEgressPoint = reverseEgress?.[0];
            const rampRunX = Number(upper?.x) - Number(foot?.x);
            const rampRunZ = Number(upper?.z) - Number(foot?.z);
            const reverseDeltaX = Number(reverseEgressPoint?.x) - Number(foot?.x);
            const reverseDeltaZ = Number(reverseEgressPoint?.z) - Number(foot?.z);
            const reverseEgressValid = Array.isArray(reverseEgress)
              && reverseEgress.length === 1
              && isFiniteVector(reverseEgressPoint)
              && reverseEgressPoint.x >= sourceSurface.bounds.min.x + radius - 1e-6
              && reverseEgressPoint.x <= sourceSurface.bounds.max.x - radius + 1e-6
              && reverseEgressPoint.z >= sourceSurface.bounds.min.z + radius - 1e-6
              && reverseEgressPoint.z <= sourceSurface.bounds.max.z - radius + 1e-6
              && Math.abs(reverseEgressPoint.y - sourceSurface.bounds.max.y) <= 0.051
              && Math.hypot(reverseDeltaX, reverseDeltaZ) >= 1.2 - 0.001
              && reverseDeltaX * rampRunX + reverseDeltaZ * rampRunZ < 0;
            if (!reverseEgressValid) {
              error('assembly-stair-reverse-egress-invalid', `${link.id} must leave the native ramp through a capsule-contained lower-deck egress.`, {
                linkId: link.id,
                reverseEgressWaypoints: reverseEgress ?? null,
                sourceSurfaceId: sourceSurface.id,
              });
            }
            const rejoin = contract.combatRejoin;
            const rejoinEncounter = encounterById.get(rejoin?.encounterId);
            const rejoinEngagement = rejoinEncounter?.entryEngagementContracts?.find(({ id }) => (
              id === rejoin?.engagementId
            ));
            const rejoinSurface = surfaceById.get(rejoin?.surfaceId);
            const rejoinSurfaceIds = rejoin?.surfaceIds ?? [rejoin?.surfaceId];
            const rejoinSurfaces = rejoinSurfaceIds.map((surfaceId) => surfaceById.get(surfaceId));
            const rejoinSpawn = rejoinEncounter?.spawnPoints?.[rejoinEngagement?.spawnPointIndex];
            const expectedRejoinStart = contract.ingressPoint;
            const expectedRejoinEnd = rejoinSpawn && rejoinSurface ? {
              x: rejoinSpawn.x,
              y: rejoinSurface.bounds.max.y,
              z: rejoinSpawn.z,
            } : null;
            const rejoinRadius = Number(rejoin?.capsuleRadius);
            const rejoinHeight = Number(rejoin?.capsuleHeight);
            const rejoinLateral = Number(rejoin?.maximumLateralOffset);
            const rejoinSpacing = Math.min(0.21, Number(rejoin?.sampleSpacing));
            const rejoinBaseValid = rejoin?.id === 'combat-rejoin.assembly.entry-ground'
              && rejoinEngagement?.sourceTraversalLinkId === link.id
              && rejoinEngagement?.surfaceId === rejoin?.surfaceId
              && Array.isArray(rejoinEngagement?.surfaceIds)
              && rejoinEngagement.surfaceIds.length === rejoinSurfaceIds.length
              && rejoinEngagement.surfaceIds.every((surfaceId, index) => (
                surfaceId === rejoinSurfaceIds[index]
              ))
              && rejoinSurfaces.length >= 3
              && rejoinSurfaces.every(Boolean)
              && rejoin?.nextWaypointIndex === 3
              && rejoin?.minimumProgress === 0
              && rejoin?.maximumProgress === 1
              && Number.isFinite(rejoinRadius) && rejoinRadius >= radius
              && Number.isFinite(rejoinHeight) && rejoinHeight >= 3.2
              && Number.isFinite(rejoinLateral) && rejoinLateral >= 0.1
              && Number.isFinite(rejoinSpacing) && rejoinSpacing > 0
              && pointsMatch(rejoin?.segmentStart, expectedRejoinStart)
              && pointsMatch(rejoin?.segmentEnd, expectedRejoinEnd)
              && Array.isArray(rejoin?.waypoints)
              && rejoin.waypoints.length === 3
              && pointsMatch(rejoin.waypoints[0], expectedRejoinStart)
              && pointsMatch(rejoin.waypoints[1], approach[1])
              && pointsMatch(rejoin.waypoints[2], expectedRejoinEnd);
            const rejoinBlockers = [];
            if (rejoinBaseValid) {
              for (let segmentIndex = 1; segmentIndex < rejoin.waypoints.length
                && !rejoinBlockers.length; segmentIndex += 1) {
                const segmentStart = rejoin.waypoints[segmentIndex - 1];
                const segmentEnd = rejoin.waypoints[segmentIndex];
                const deltaX = segmentEnd.x - segmentStart.x;
                const deltaZ = segmentEnd.z - segmentStart.z;
                const length = Math.hypot(deltaX, deltaZ);
                const tangent = { x: -deltaZ / length, z: deltaX / length };
                const sampleCount = Math.max(1, Math.ceil(length / rejoinSpacing));
                for (let sampleIndex = 0; sampleIndex <= sampleCount && !rejoinBlockers.length; sampleIndex += 1) {
                  const progress = sampleIndex / sampleCount;
                  for (const lateral of [-rejoinLateral, 0, rejoinLateral]) {
                    const point = {
                      x: segmentStart.x + deltaX * progress + tangent.x * lateral,
                      y: segmentStart.y,
                      z: segmentStart.z + deltaZ * progress + tangent.z * lateral,
                    };
                    if (!capsuleFootprintSupportedBySurfaces(point, rejoinSurfaces, rejoinRadius)) {
                      rejoinBlockers.push(`unsupported:${segmentIndex - 1}:${sampleIndex}:${lateral}`);
                      break;
                    }
                    for (const fixture of candidate.structuralFixtures.filter((entry) => (
                      entry.regionId === link.regionId && entry.collision === 'blocking'
                    ))) {
                      if ((fixture.colliderBounds ?? []).some((bounds) => (
                        capsuleIntersectsBounds(point, bounds, rejoinRadius, rejoinHeight)
                      ))) rejoinBlockers.push(fixture.id);
                    }
                    for (const boundary of candidate.structuralBoundaries.filter((entry) => (
                      entry.regionId === link.regionId && entry.collider !== false
                    ))) {
                      if (capsuleIntersectsBounds(point, boundary.bounds, rejoinRadius, rejoinHeight)) {
                        rejoinBlockers.push(boundary.id);
                      }
                    }
                    if (rejoinBlockers.length) break;
                  }
                }
              }
            }
            if (!rejoinBaseValid || rejoinBlockers.length) {
              error('stair-combat-rejoin-invalid', `${link.id} must reuse the clear Assembly entry-engagement lane after public combat.`, {
                linkId: link.id,
                combatRejoin: rejoin ?? null,
                blockers: [...new Set(rejoinBlockers)],
              });
            }
            const ingressPortal = portalById.get(contract.ingressPortalId);
            const expectedIngressSurface = ingressPortal?.physicalRoute?.endpointSurfaceIds?.to;
            const expectedIngressDeck = surfaceById.get(expectedIngressSurface);
            const portalDestination = ingressPortal?.to?.center;
            const priorRoutePoint = [...(ingressPortal?.physicalRoute?.routePoints ?? [])]
              .reverse()
              .find((point) => isFiniteVector(point)
                && isFiniteVector(portalDestination)
                && Math.hypot(point.x - portalDestination.x, point.z - portalDestination.z) > 0.05);
            const interiorIngressDepth = Number(ingressPortal?.traversal?.interiorIngressDepth);
            const routeDeltaX = Number(portalDestination?.x) - Number(priorRoutePoint?.x);
            const routeDeltaZ = Number(portalDestination?.z) - Number(priorRoutePoint?.z);
            const routeLength = Math.hypot(routeDeltaX, routeDeltaZ);
            const expectedIngressPoint = routeLength > 0.05 && Number.isFinite(interiorIngressDepth)
              && expectedIngressDeck
              ? {
                  x: portalDestination.x + (routeDeltaX / routeLength) * interiorIngressDepth,
                  y: expectedIngressDeck.bounds.max.y,
                  z: portalDestination.z + (routeDeltaZ / routeLength) * interiorIngressDepth,
                }
              : null;
            if (!ingressPortal || ingressPortal.to.regionId !== link.regionId
              || expectedIngressSurface !== approachSurfaceIds[0]
              || contract.ingressSurfaceIds?.length !== 1
              || contract.ingressSurfaceIds[0] !== expectedIngressSurface
              || !Number.isFinite(interiorIngressDepth)
              || interiorIngressDepth < radius
              || !Number.isFinite(Number(contract.ingressDepth))
              || Math.abs(Number(contract.ingressDepth) - interiorIngressDepth) > 0.001) {
              error('stair-ground-approach-ingress-invalid', `${link.id} must begin at its actual seeded east portal floor.`, { linkId: link.id, ingressPortalId: contract.ingressPortalId, expectedIngressSurface, firstApproachSurfaceId: approachSurfaceIds[0] });
            }
            const ingressMatchesFirst = isFiniteVector(ingressPoint)
              && Math.hypot(
                ingressPoint.x - approach[0].x,
                ingressPoint.y - approach[0].y,
                ingressPoint.z - approach[0].z,
              ) <= 0.051;
            const ingressMatchesPortalTraversal = isFiniteVector(ingressPoint)
              && isFiniteVector(expectedIngressPoint)
              && Math.hypot(
                ingressPoint.x - expectedIngressPoint.x,
                ingressPoint.y - expectedIngressPoint.y,
                ingressPoint.z - expectedIngressPoint.z,
              ) <= 0.051;
            if (!ingressMatchesFirst || !ingressMatchesPortalTraversal) {
              error('stair-ground-approach-ingress-mismatch', `${link.id} must start at the same post-portal interior anchor proven by public traversal.`, {
                linkId: link.id,
                ingressPoint: ingressPoint ?? null,
                firstApproachPoint: approach[0],
                expectedIngressPoint,
                interiorIngressDepth: Number.isFinite(interiorIngressDepth) ? interiorIngressDepth : null,
              });
            }
            const doorwayEgress = contract.doorwayEgress;
            const exteriorStagingDepth = Number(doorwayEgress?.exteriorStagingDepth);
            const straightClearanceDepth = Number(doorwayEgress?.straightClearanceDepth);
            const maximumLaneOffset = Number(doorwayEgress?.maximumLaneOffset);
            const doorwayRadius = Number(doorwayEgress?.capsuleRadius);
            const doorwayHeight = Number(doorwayEgress?.capsuleHeight);
            const doorwaySpacing = Math.min(0.21, Number(doorwayEgress?.sampleSpacing));
            const connectorSurface = surfaceById.get(doorwayEgress?.connectorSurfaceId);
            const doorwayDestinationSurfaces = (doorwayEgress?.destinationSurfaceIds ?? [])
              .map((surfaceId) => surfaceById.get(surfaceId));
            const forward = routeLength > 0.05
              ? { x: routeDeltaX / routeLength, z: routeDeltaZ / routeLength }
              : null;
            const tangent = forward ? { x: -forward.z, z: forward.x } : null;
            const exteriorStagingPoint = forward && isFiniteVector(portalDestination)
              ? {
                  x: portalDestination.x - forward.x * exteriorStagingDepth,
                  y: expectedIngressDeck?.bounds.max.y,
                  z: portalDestination.z - forward.z * exteriorStagingDepth,
                }
              : null;
            const straightClearancePoint = forward && isFiniteVector(portalDestination)
              ? {
                  x: portalDestination.x + forward.x * straightClearanceDepth,
                  y: expectedIngressDeck?.bounds.max.y,
                  z: portalDestination.z + forward.z * straightClearanceDepth,
                }
              : null;
            const minimumFrameClearanceDepth = Number(ingressPortal?.to?.dimensions?.depth) * 0.5
              + doorwayRadius * 2;
            const lateralClearance = (surface) => {
              if (!surface || !isFiniteVector(portalDestination) || !forward) return -Infinity;
              return Math.abs(forward.x) > Math.abs(forward.z)
                ? Math.min(
                    portalDestination.z - surface.bounds.min.z,
                    surface.bounds.max.z - portalDestination.z,
                  ) - doorwayRadius
                : Math.min(
                    portalDestination.x - surface.bounds.min.x,
                    surface.bounds.max.x - portalDestination.x,
                  ) - doorwayRadius;
            };
            const doorwayBaseValid = doorwayEgress?.id
              === 'doorway-egress.security-assembly.native-machine-factory'
              && doorwayEgress?.mode === 'lane-preserving-then-recenter'
              && doorwayEgress?.portalId === ingressPortal?.id
              && doorwayEgress?.connectorSurfaceId === ingressPortal?.physicalRoute?.surfaceIds?.at(-1)
              && doorwayEgress?.destinationSurfaceIds?.[0] === expectedIngressSurface
              && doorwayDestinationSurfaces.length === 2
              && doorwayDestinationSurfaces.every(Boolean)
              && Number.isFinite(exteriorStagingDepth) && exteriorStagingDepth >= doorwayRadius
              && Number.isFinite(straightClearanceDepth)
              && straightClearanceDepth >= minimumFrameClearanceDepth - 0.001
              && straightClearanceDepth > interiorIngressDepth
              && Number.isFinite(maximumLaneOffset) && maximumLaneOffset >= doorwayRadius
              && maximumLaneOffset <= lateralClearance(connectorSurface) + 0.001
              && maximumLaneOffset <= lateralClearance(expectedIngressDeck) + 0.001
              && Number.isFinite(doorwayRadius) && doorwayRadius >= radius
              && Number.isFinite(doorwayHeight) && doorwayHeight >= 3.2
              && Number.isFinite(doorwaySpacing) && doorwaySpacing > 0
              && pointsMatch(doorwayEgress?.recenterPoint, approach[1]);
            const doorwayFailures = [];
            const doorwayRegionIds = new Set([
              ingressPortal?.from?.regionId,
              ingressPortal?.to?.regionId,
            ].filter(Boolean));
            const doorwayBlockingFixtures = candidate.structuralFixtures.filter((entry) => (
              doorwayRegionIds.has(entry.regionId) && entry.collision === 'blocking'
            ));
            const doorwayBlockingBoundaries = candidate.structuralBoundaries.filter((entry) => (
              doorwayRegionIds.has(entry.regionId) && entry.collider !== false
            ));
            if (doorwayBaseValid) {
              for (const lateral of [-maximumLaneOffset, 0, maximumLaneOffset]) {
                const laneStart = {
                  x: exteriorStagingPoint.x + tangent.x * lateral,
                  y: exteriorStagingPoint.y,
                  z: exteriorStagingPoint.z + tangent.z * lateral,
                };
                const laneEnd = {
                  x: straightClearancePoint.x + tangent.x * lateral,
                  y: straightClearancePoint.y,
                  z: straightClearancePoint.z + tangent.z * lateral,
                };
                const straightDistance = Math.hypot(
                  laneEnd.x - laneStart.x,
                  laneEnd.z - laneStart.z,
                );
                const straightSamples = Math.max(1, Math.ceil(straightDistance / doorwaySpacing));
                for (let sampleIndex = 0; sampleIndex <= straightSamples; sampleIndex += 1) {
                  const progress = sampleIndex / straightSamples;
                  const point = {
                    x: laneStart.x + (laneEnd.x - laneStart.x) * progress,
                    y: laneStart.y,
                    z: laneStart.z + (laneEnd.z - laneStart.z) * progress,
                  };
                  if (!capsuleFootprintPlanarSupportedBySurfaces(
                    point,
                    [connectorSurface, expectedIngressDeck],
                    doorwayRadius,
                  )) {
                    doorwayFailures.push(`unsupported-straight:${lateral}:${sampleIndex}`);
                    break;
                  }
                  for (const fixture of doorwayBlockingFixtures) {
                    if ((fixture.colliderBounds ?? []).some((bounds) => (
                      capsuleIntersectsBounds(point, bounds, doorwayRadius, doorwayHeight)
                    ))) doorwayFailures.push(fixture.id);
                  }
                  for (const boundary of doorwayBlockingBoundaries) {
                    if (capsuleIntersectsBoundaryOutsideOpenings(
                      point,
                      boundary,
                      doorwayRadius,
                      doorwayHeight,
                    )) doorwayFailures.push(boundary.id);
                  }
                  if (doorwayFailures.length) break;
                }
                const recenterDistance = Math.hypot(
                  doorwayEgress.recenterPoint.x - laneEnd.x,
                  doorwayEgress.recenterPoint.z - laneEnd.z,
                );
                const recenterSamples = Math.max(1, Math.ceil(recenterDistance / doorwaySpacing));
                for (let sampleIndex = 0; sampleIndex <= recenterSamples
                  && doorwayFailures.length === 0; sampleIndex += 1) {
                  const progress = sampleIndex / recenterSamples;
                  const point = {
                    x: laneEnd.x + (doorwayEgress.recenterPoint.x - laneEnd.x) * progress,
                    y: laneEnd.y,
                    z: laneEnd.z + (doorwayEgress.recenterPoint.z - laneEnd.z) * progress,
                  };
                  if (!capsuleFootprintSupportedBySurfaces(
                    point,
                    doorwayDestinationSurfaces,
                    doorwayRadius,
                  )) {
                    doorwayFailures.push(`unsupported-recenter:${lateral}:${sampleIndex}`);
                    break;
                  }
                  for (const fixture of doorwayBlockingFixtures) {
                    if ((fixture.colliderBounds ?? []).some((bounds) => (
                      capsuleIntersectsBounds(point, bounds, doorwayRadius, doorwayHeight)
                    ))) doorwayFailures.push(fixture.id);
                  }
                  for (const boundary of doorwayBlockingBoundaries) {
                    if (capsuleIntersectsBoundaryOutsideOpenings(
                      point,
                      boundary,
                      doorwayRadius,
                      doorwayHeight,
                    )) doorwayFailures.push(boundary.id);
                  }
                  if (doorwayFailures.length) break;
                }
                if (doorwayFailures.length) break;
              }
            }
            const minimumSpawnSeparation = Number(rejoinEngagement?.minimumPlayerSpawnSeparation);
            const spawnSeparation = isFiniteVector(doorwayEgress?.recenterPoint)
              && isFiniteVector(rejoinSpawn)
              ? Math.hypot(
                  rejoinSpawn.x - doorwayEgress.recenterPoint.x,
                  rejoinSpawn.z - doorwayEgress.recenterPoint.z,
                )
              : Number.NaN;
            if (!doorwayBaseValid || doorwayFailures.length
              || !Number.isFinite(minimumSpawnSeparation) || minimumSpawnSeparation < 1.8
              || !Number.isFinite(spawnSeparation)
              || spawnSeparation < minimumSpawnSeparation - 0.001) {
              error('portal-doorway-egress-invalid', `${ingressPortal?.id ?? contract.ingressPortalId} must clear the native doorway before recentering or spawning combat.`, {
                linkId: link.id,
                portalId: ingressPortal?.id ?? contract.ingressPortalId,
                doorwayEgress: doorwayEgress ?? null,
                minimumFrameClearanceDepth: Number.isFinite(minimumFrameClearanceDepth)
                  ? minimumFrameClearanceDepth
                  : null,
                spawnSeparation: Number.isFinite(spawnSeparation) ? spawnSeparation : null,
                minimumSpawnSeparation: Number.isFinite(minimumSpawnSeparation)
                  ? minimumSpawnSeparation
                  : null,
                failures: [...new Set(doorwayFailures)],
              });
            }
            const minimumEnemyIngressClearance = Number(
              rejoinEngagement?.minimumEnemyIngressClearance,
            );
            const conservativeSoftArenaMargin = 1.25;
            const softArenaBounds = validBounds(rejoinEncounter?.zoneBounds) ? {
              min: {
                x: rejoinEncounter.zoneBounds.min.x + conservativeSoftArenaMargin,
                y: rejoinEncounter.zoneBounds.min.y,
                z: rejoinEncounter.zoneBounds.min.z + conservativeSoftArenaMargin,
              },
              max: {
                x: rejoinEncounter.zoneBounds.max.x - conservativeSoftArenaMargin,
                y: rejoinEncounter.zoneBounds.max.y,
                z: rejoinEncounter.zoneBounds.max.z - conservativeSoftArenaMargin,
              },
            } : null;
            const softArenaDepths = softArenaBounds && forward && isFiniteVector(portalDestination)
              ? [
                  [softArenaBounds.min.x, softArenaBounds.min.z],
                  [softArenaBounds.min.x, softArenaBounds.max.z],
                  [softArenaBounds.max.x, softArenaBounds.min.z],
                  [softArenaBounds.max.x, softArenaBounds.max.z],
                ].map(([x, z]) => (
                  (x - portalDestination.x) * forward.x
                    + (z - portalDestination.z) * forward.z
                ))
              : [];
            const nearestEnemySoftArenaDepth = softArenaDepths.length
              ? Math.min(...softArenaDepths)
              : Number.NaN;
            const enemyIngressClearance = nearestEnemySoftArenaDepth - straightClearanceDepth;
            if (!Number.isFinite(minimumEnemyIngressClearance)
              || minimumEnemyIngressClearance < 2
              || !Number.isFinite(enemyIngressClearance)
              || enemyIngressClearance < minimumEnemyIngressClearance - 0.001) {
              error('portal-doorway-enemy-exclusion-invalid', `${rejoinEncounter?.id ?? 'Assembly encounter'} may not pursue the player into the native doorway egress.`, {
                linkId: link.id,
                portalId: ingressPortal?.id ?? contract.ingressPortalId,
                encounterId: rejoinEncounter?.id ?? null,
                nearestEnemySoftArenaDepth: Number.isFinite(nearestEnemySoftArenaDepth)
                  ? nearestEnemySoftArenaDepth
                  : null,
                straightClearanceDepth: Number.isFinite(straightClearanceDepth)
                  ? straightClearanceDepth
                  : null,
                enemyIngressClearance: Number.isFinite(enemyIngressClearance)
                  ? enemyIngressClearance
                  : null,
                minimumEnemyIngressClearance: Number.isFinite(minimumEnemyIngressClearance)
                  ? minimumEnemyIngressClearance
                  : null,
              });
            }
            const entryEncounter = candidate.encounters.find((encounter) => (
              encounter.regionId === link.regionId && encounter.required === true
            ));
            const entryTriggerBounds = entryEncounter?.triggerZoneBounds ?? entryEncounter?.zoneBounds;
            const ingressActivatesEncounter = isFiniteVector(expectedIngressPoint)
              && validBounds(entryTriggerBounds)
              && ['x', 'y', 'z'].every((axis) => (
                expectedIngressPoint[axis] >= entryTriggerBounds.min[axis] - 0.001
                && expectedIngressPoint[axis] <= entryTriggerBounds.max[axis] + 0.001
              ));
            if (!entryEncounter || !ingressActivatesEncounter) {
              error('stair-ground-approach-trigger-gap', `${link.id} post-portal anchor must activate its required room encounter before leaving the validated approach.`, {
                linkId: link.id,
                encounterId: entryEncounter?.id ?? null,
                expectedIngressPoint,
                triggerZoneBounds: entryTriggerBounds ?? null,
              });
            }
          }
        }
      }
    }
    const runtimeFixtureIds = new Set();
    for (const fixture of candidate.structuralFixtures) {
      const collisionValid = fixture.collision === 'blocking'
        || (fixture.collision === false && fixture.accessibility === 'inaccessible');
      if (!regionById.has(fixture.regionId) || !cellById.has(fixture.cellId) || !validBounds(fixture.bounds) || !fixture.gameplayPurpose || !collisionValid) error('structural-fixture-invalid', `${fixture.id} lacks authored geometry, explicit collision/accessibility, or purpose.`, { fixtureId: fixture.id });
      if (!fixture.visualId || !(fixture.visualIds?.length > 0) || !fixture.visualIds.includes(fixture.visualId)) error('fixture-runtime-visual-contract-invalid', `${fixture.id} requires stable runtime visual IDs.`, { fixtureId: fixture.id, visualId: fixture.visualId, visualIds: fixture.visualIds });
      const colliderContractValid = fixture.collision === false
        ? Array.isArray(fixture.colliderIds) && fixture.colliderIds.length === 0 && Array.isArray(fixture.colliderBounds) && fixture.colliderBounds.length === 0
        : fixture.colliderIds?.length > 0 && fixture.colliderIds.length === fixture.colliderBounds?.length && fixture.colliderBounds.every((bounds) => validBounds(bounds));
      if (!colliderContractValid) error('fixture-runtime-collider-contract-invalid', `${fixture.id} must pair each stable runtime collider ID with one exact collider bound.`, { fixtureId: fixture.id, colliderIds: fixture.colliderIds, colliderBoundsCount: fixture.colliderBounds?.length ?? 0 });
      for (const runtimeId of [...(fixture.visualIds ?? []), ...(fixture.colliderIds ?? [])]) {
        if (runtimeFixtureIds.has(runtimeId)) error('fixture-runtime-id-duplicate', `${runtimeId} is owned by more than one fixture component.`, { fixtureId: fixture.id, runtimeId });
        runtimeFixtureIds.add(runtimeId);
      }
    }
    for (const fall of candidate.falls) {
      if (!portalById.has(fall.sourcePortalId) || !surfaceById.has(fall.catchmentSurfaceId) || !candidate.safeAnchors.some((entry) => entry.id === fall.safeAnchorId) || !fall.damageFree || !fall.playableDestination || !(fall.returnPortalIds?.length > 0)) error('fall-contract-invalid', `${fall.id} must terminate in a playable damage-free catchment with a return.`, { fallId: fall.id });
      const sourcePortal = portalById.get(fall.sourcePortalId);
      const catchment = surfaceById.get(fall.catchmentSurfaceId);
      if (!validBounds(fall.trajectoryBounds) || (sourcePortal && catchment && (
        fall.trajectoryBounds.min.y > catchment.bounds.max.y + 0.001
        || fall.trajectoryBounds.max.y < sourcePortal.from.center.y - 0.001
        || fall.trajectoryBounds.min.x > catchment.bounds.min.x + 0.001
        || fall.trajectoryBounds.max.x < catchment.bounds.max.x - 0.001
        || fall.trajectoryBounds.min.z > catchment.bounds.min.z + 0.001
        || fall.trajectoryBounds.max.z < catchment.bounds.max.z - 0.001
      ))) error('fall-trajectory-catchment-mismatch', `${fall.id} trajectory must span the authored aperture and exact playable catchment footprint.`, { fallId: fall.id, trajectoryBounds: fall.trajectoryBounds, catchmentBounds: catchment?.bounds });
    }
    for (const safeAnchor of candidate.safeAnchors) {
      if (!regionById.has(safeAnchor.regionId) || !surfaceById.has(safeAnchor.surfaceId ?? safeAnchor.safeSurfaceId) || !isFiniteVector(safeAnchor.position)) error('safe-anchor-invalid', `${safeAnchor.id} has unresolved region, surface, or position.`, { safeAnchorId: safeAnchor.id });
      const surface = surfaceById.get(safeAnchor.surfaceId ?? safeAnchor.safeSurfaceId);
      if (surface && (safeAnchor.position.x < surface.bounds.min.x || safeAnchor.position.x > surface.bounds.max.x || safeAnchor.position.z < surface.bounds.min.z || safeAnchor.position.z > surface.bounds.max.z || Math.abs(safeAnchor.position.y - surface.bounds.max.y) > 0.051)) error('safe-anchor-surface-mismatch', `${safeAnchor.id} is not planted on its authored safe surface.`, { safeAnchorId: safeAnchor.id, surfaceId: surface.id, position: safeAnchor.position, surfaceTopY: surface.bounds.max.y });
    }
    if (!candidate.safeAnchors.some((entry) => entry.isPlayerStart === true || entry.safeAnchorType === 'player-start')) error('player-start-safe-anchor-missing', 'A machine-readable player-start safe anchor is required.', {});
    const selectableAnchorOwners = new Map();
    const validatePhysicalFixtureRefs = (owner, required) => {
      if (!required) return;
      if (!(owner.visualFixtureIds?.length > 0) || !(owner.colliderIds?.length > 0)) {
        error('physical-prop-fixture-refs-missing', `${owner.id} lacks plan-owned visual fixture and collider references.`, { ownerId: owner.id });
        return;
      }
      for (const fixtureId of new Set([...owner.visualFixtureIds, ...owner.colliderIds])) {
        const fixture = fixtureById.get(fixtureId);
        if (!fixture || fixture.collision !== 'blocking' || !(fixture.visualIds?.length > 0) || !(fixture.colliderIds?.length > 0)) error('physical-prop-fixture-unresolved', `${owner.id} references an incomplete physical fixture ${fixtureId}.`, { ownerId: owner.id, fixtureId });
      }
    };
    for (const action of candidate.actions) {
      if (!anchorById.has(action.anchorId)) error('action-anchor-missing', `${action.id} references unknown anchor ${action.anchorId}.`, { actionId: action.id, anchorId: action.anchorId });
      if (!action.interaction || !Number.isFinite(action.interaction.radius)) error('action-interaction-invalid', `${action.id} requires an explicit interaction contract.`, { actionId: action.id });
      (action.conditions ?? []).forEach((entry, index) => validateOperation(entry, CONDITION_OPERATIONS_V2, `${action.id}.conditions[${index}]`, error));
      (action.effects ?? []).forEach((entry, index) => validateOperation(entry, EFFECT_OPERATIONS_V2, `${action.id}.effects[${index}]`, error));
      const selectable = action.interaction?.activationSide !== 'system';
      validatePhysicalFixtureRefs(action, selectable);
      if (selectable) {
        const prior = selectableAnchorOwners.get(action.anchorId);
        if (prior) error('duplicate-selectable-action-anchor', `${action.anchorId} stacks selectable actions ${prior} and ${action.id}.`, { anchorId: action.anchorId, actionIds: [prior, action.id] });
        else selectableAnchorOwners.set(action.anchorId, action.id);
      }
      if (selectable && ['gate-control', 'water-router', 'mechanism-control'].includes(action.type)) {
        const anchorRecord = anchorById.get(action.anchorId);
        const supportingSurface = surfaceById.get(anchorRecord?.surfaceId ?? anchorRecord?.safeSurfaceId);
        if (!supportingSurface || supportingSurface.collision === 'dynamic' || !/(?:console|control|terminal|station|alcove|pedestal)/i.test(supportingSurface.purpose ?? '')) error('console-side-pad-missing', `${action.id} must stand on a static authored side-console pad.`, { actionId: action.id, surfaceId: supportingSurface?.id ?? null });
      }
    }
    for (const gate of candidate.progression?.gateContracts ?? []) {
      const portal = portalById.get(gate.portalId);
      const action = actionById.get(gate.actionId);
      const barrier = boundaryById.get(gate.barrierBoundaryId ?? gate.barrierId);
      if (!portal || !action || !barrier || !['gate-barrier', 'movable-gate-barrier'].includes(barrier.kind)) {
        error('gate-contract-unresolved', `${gate.id} lacks a portal, action, or physical gate barrier.`, { gateId: gate.id, portalId: gate.portalId, actionId: gate.actionId, barrierId: gate.barrierBoundaryId ?? gate.barrierId });
        continue;
      }
      if ((barrier.blocksPortalId ?? barrier.portalId) !== portal.id || !action.barrierIds?.includes(barrier.id) || portal.barrierId !== barrier.id) error('gate-barrier-reference-mismatch', `${gate.id} does not share one exact barrier ID across portal/action/structure.`, { gateId: gate.id, portalBarrierId: portal.barrierId, actionBarrierIds: action.barrierIds, barrierId: barrier.id });
      if (!barrier.collider || !barrier.opaque) error('gate-barrier-not-physical', `${gate.id} barrier must be opaque and colliding when closed.`, { gateId: gate.id, barrierId: barrier.id });
      if (gate.requiredKeycardId && !action.conditions?.some((condition) => condition.op === 'hasKey' && condition.keyId === gate.requiredKeycardId)) error('gate-key-condition-mismatch', `${gate.id} action does not require its declared key.`, { gateId: gate.id, requiredKeycardId: gate.requiredKeycardId });

      const anchorRecord = anchorById.get(action.anchorId);
      const endpoint = anchorRecord
        ? [portal.from, portal.to].find(({ regionId }) => regionId === anchorRecord.regionId)
        : null;
      const sidePad = surfaceById.get(anchorRecord?.surfaceId ?? anchorRecord?.safeSurfaceId);
      if (endpoint && ['north', 'south', 'east', 'west'].includes(endpoint.side)) {
        const lateralAxis = ['north', 'south'].includes(endpoint.side) ? 'x' : 'z';
        const apertureMinimum = endpoint.center[lateralAxis] - endpoint.dimensions.width * 0.5;
        const apertureMaximum = endpoint.center[lateralAxis] + endpoint.dimensions.width * 0.5;
        const padOverlapsPortalLane = sidePad
          && sidePad.bounds.min[lateralAxis] < apertureMaximum - 0.001
          && sidePad.bounds.max[lateralAxis] > apertureMinimum + 0.001;
        if (padOverlapsPortalLane) {
          error('gate-control-in-portal-lane', `${gate.id} control pad overlaps the traversable gate lane instead of sitting beside it.`, {
            gateId: gate.id,
            actionId: action.id,
            surfaceId: sidePad.id,
            lateralAxis,
            apertureMinimum,
            apertureMaximum,
            padMinimum: sidePad.bounds.min[lateralAxis],
            padMaximum: sidePad.bounds.max[lateralAxis],
          });
        }

        const forward = anchorRecord?.forward;
        const towardPortal = anchorRecord
          ? {
            x: endpoint.center.x - anchorRecord.position.x,
            z: endpoint.center.z - anchorRecord.position.z,
          }
          : null;
        const activationSign = action.interaction?.activationSide === 'back' ? -1 : 1;
        const forwardLength = forward ? Math.hypot(forward.x, forward.z) : 0;
        const towardPortalLength = towardPortal ? Math.hypot(towardPortal.x, towardPortal.z) : 0;
        const facingDot = forwardLength > 0 && towardPortalLength > 0
          ? activationSign * (
            forward.x * towardPortal.x + forward.z * towardPortal.z
          ) / (forwardLength * towardPortalLength)
          : -1;
        if (facingDot < 0.75) {
          error('gate-control-facing-away-from-lane', `${gate.id} legal activation face does not point from its side console toward the clear gate approach.`, {
            gateId: gate.id,
            actionId: action.id,
            anchorId: action.anchorId,
            facingDot,
          });
        }
      }

      const barrierDepthAxis = ['north', 'south'].includes(endpoint?.side)
        ? 'z'
        : ['east', 'west'].includes(endpoint?.side)
          ? 'x'
          : 'y';
      const barrierDepth = barrier.bounds.max[barrierDepthAxis] - barrier.bounds.min[barrierDepthAxis];
      const requiredThroatDepth = ['floor', 'ceiling'].includes(endpoint?.side)
        ? endpoint?.dimensions?.height
        : endpoint?.dimensions?.depth;
      if (!Number.isFinite(requiredThroatDepth) || barrierDepth + 0.001 < requiredThroatDepth) {
        error('gate-barrier-throat-gap', `${gate.id} barrier does not seal the full authored portal throat.`, {
          gateId: gate.id,
          barrierId: barrier.id,
          barrierDepth,
          requiredThroatDepth: requiredThroatDepth ?? null,
        });
      }

      for (const protectedSurfaceId of new Set([
        portal.physicalRoute?.endpointSurfaceIds?.from,
        portal.physicalRoute?.endpointSurfaceIds?.to,
        ...(portal.physicalRoute?.surfaceIds ?? []),
      ].filter(Boolean))) {
        const protectedSurface = surfaceById.get(protectedSurfaceId);
        if (protectedSurface?.createsLedgeCandidates !== false) {
          error('gate-route-ledge-candidates-enabled', `${gate.id} route surface ${protectedSurfaceId} can create a cross-gate ledge correction.`, {
            gateId: gate.id,
            portalId: portal.id,
            surfaceId: protectedSurfaceId,
          });
        }
      }
    }
    for (const reward of candidate.rewards) {
      if (!anchorById.has(reward.anchorId) || !actionById.has(reward.actionId) || !reward.safePlacement || reward.hazardTag) error('reward-contract-invalid', `${reward.id} requires safe anchor and action contracts.`, { rewardId: reward.id });
      validatePhysicalFixtureRefs(reward, true);
    }
    const hazardSurfaces = candidate.walkableSurfaces.filter((entry) => entry.hazardTag);
    for (const reward of candidate.rewards) {
      const rewardAnchor = anchorById.get(reward.anchorId);
      if (!rewardAnchor) continue;
      const hazard = hazardSurfaces.find((surface) => rewardAnchor.position.x >= surface.bounds.min.x && rewardAnchor.position.x <= surface.bounds.max.x && rewardAnchor.position.z >= surface.bounds.min.z && rewardAnchor.position.z <= surface.bounds.max.z);
      if (hazard) error('reward-on-hazard', `${reward.id} is positioned on harmful surface ${hazard.id}.`, { rewardId: reward.id, surfaceId: hazard.id });
    }
    for (const encounter of candidate.encounters) {
      const triggerBounds = encounter.triggerZoneBounds ?? encounter.zoneBounds;
      const ownerRegion = regionById.get(encounter.regionId);
      const triggerInsideRegion = validBounds(triggerBounds) && validBounds(ownerRegion?.bounds)
        && ['x', 'y', 'z'].every((axis) => (
          triggerBounds.min[axis] >= ownerRegion.bounds.min[axis] - 0.001
          && triggerBounds.max[axis] <= ownerRegion.bounds.max[axis] + 0.001
        ));
      if (!anchorById.has(encounter.anchorId) || !actionById.has(encounter.completionActionId)
        || !(encounter.roster?.length > 0) || !(encounter.spawnPoints?.length > 0)
        || !validBounds(encounter.zoneBounds) || !triggerInsideRegion
        || encounter.blocksPermanentRoute) {
        error('encounter-contract-invalid', `${encounter.id} lacks authored safe encounter data.`, { encounterId: encounter.id });
      }
      const exactSpawnContractValid = encounter.spawnPlacementMode === 'exact-plan-owned'
        && encounter.spawnGroundingMode === 'plan-y'
        && validBounds(encounter.zoneBounds)
        && Array.isArray(encounter.spawnSurfaceIds)
        && encounter.spawnSurfaceIds.length === encounter.spawnPoints?.length
        && encounter.spawnPattern?.points?.length === encounter.spawnPoints?.length
        && Number.isFinite(encounter.spawnClearance?.radius)
        && encounter.spawnClearance.radius >= 0.42
        && Number.isFinite(encounter.spawnClearance?.height)
        && encounter.spawnClearance.height >= 3.2;
      if (!exactSpawnContractValid) {
        error('encounter-exact-spawn-contract-invalid', `${encounter.id} must use exact plan-owned spawn points with declared supporting surfaces.`, {
          encounterId: encounter.id,
          spawnPlacementMode: encounter.spawnPlacementMode ?? null,
          spawnGroundingMode: encounter.spawnGroundingMode ?? null,
          spawnPointCount: encounter.spawnPoints?.length ?? null,
          spawnSurfaceCount: encounter.spawnSurfaceIds?.length ?? null,
        });
      }
      if (exactSpawnContractValid) {
        const radius = encounter.spawnClearance.radius;
        const height = encounter.spawnClearance.height;
        for (const [spawnIndex, spawnPoint] of encounter.spawnPoints.entries()) {
          const surfaceId = encounter.spawnSurfaceIds[spawnIndex];
          const surface = surfaceById.get(surfaceId);
          const runtimeSpawnPoint = encounter.spawnPattern.points[spawnIndex];
          const capsuleContained = isFiniteVector(spawnPoint) && surface
            && surface.regionId === encounter.regionId
            && spawnPoint.x >= surface.bounds.min.x + radius
            && spawnPoint.x <= surface.bounds.max.x - radius
            && spawnPoint.z >= surface.bounds.min.z + radius
            && spawnPoint.z <= surface.bounds.max.z - radius
            && Math.abs(spawnPoint.y - surface.bounds.max.y) <= 0.051
            && spawnPoint.x >= encounter.zoneBounds.min.x + radius
            && spawnPoint.x <= encounter.zoneBounds.max.x - radius
            && spawnPoint.z >= encounter.zoneBounds.min.z + radius
            && spawnPoint.z <= encounter.zoneBounds.max.z - radius
            && spawnPoint.y >= encounter.zoneBounds.min.y - 0.001
            && spawnPoint.y + height <= encounter.zoneBounds.max.y + 0.001;
          const runtimePointMatches = isFiniteVector(runtimeSpawnPoint)
            && isFiniteVector(spawnPoint)
            && Math.hypot(
              spawnPoint.x - runtimeSpawnPoint.x,
              spawnPoint.y - runtimeSpawnPoint.y,
              spawnPoint.z - runtimeSpawnPoint.z,
            ) <= 0.001;
          const blockers = [];
          if (capsuleContained) {
            for (const fixture of candidate.structuralFixtures.filter((entry) => (
              entry.regionId === encounter.regionId && entry.collision === 'blocking'
            ))) {
              if ((fixture.colliderBounds ?? []).some((bounds) => (
                capsuleIntersectsBounds(spawnPoint, bounds, radius, height)
              ))) blockers.push(fixture.id);
            }
            for (const boundary of candidate.structuralBoundaries.filter((entry) => (
              entry.regionId === encounter.regionId && entry.collider !== false
            ))) {
              if (capsuleIntersectsBounds(spawnPoint, boundary.bounds, radius, height)) {
                blockers.push(boundary.id);
              }
            }
          }
          if (!capsuleContained || !runtimePointMatches || blockers.length) {
            error('encounter-exact-spawn-clearance-invalid', `${encounter.id} spawn ${spawnIndex} must remain exactly on its declared clear walkable surface.`, {
              encounterId: encounter.id,
              spawnIndex,
              spawnPoint: spawnPoint ?? null,
              runtimeSpawnPoint: runtimeSpawnPoint ?? null,
              surfaceId,
              blockers: [...new Set(blockers)],
            });
          }
        }
      }
      const slotGenerationPolicies = encounter.slotGenerationPolicies ?? [];
      const seenGenerationPolicyIds = new Set();
      const seenGenerationPolicySlots = new Set();
      if (!Array.isArray(slotGenerationPolicies)) {
        error('encounter-slot-generation-policies-invalid', `${encounter.id} slotGenerationPolicies must be an array.`, {
          encounterId: encounter.id,
        });
      } else {
        for (const policy of slotGenerationPolicies) {
          const slotIndex = policy?.slotIndex;
          const contractShapeValid = typeof policy?.id === 'string' && policy.id.trim()
            && Number.isInteger(slotIndex) && slotIndex >= 0 && slotIndex < (encounter.roster?.length ?? 0)
            && policy.elitePolicy === 'forbid'
            && Array.isArray(policy.protectedTraversalLinkIds) && policy.protectedTraversalLinkIds.length > 0
            && policy.protectedTraversalLinkIds.every((linkId) => traversalLinkById.has(linkId))
            && Array.isArray(policy.verificationThreatTiers)
            && policy.verificationThreatTiers.length === 8
            && policy.verificationThreatTiers.every((tier, index) => tier === index + 1)
            && policy.generationContext && typeof policy.generationContext === 'object'
            && !Array.isArray(policy.generationContext)
            && policy.capabilityContract && typeof policy.capabilityContract === 'object'
            && !Array.isArray(policy.capabilityContract);
          if (!contractShapeValid || seenGenerationPolicyIds.has(policy?.id)
            || seenGenerationPolicySlots.has(slotIndex)) {
            error('encounter-slot-generation-policy-invalid', `${encounter.id} has an incomplete or duplicate slot generation policy.`, {
              encounterId: encounter.id,
              policyId: policy?.id ?? null,
              slotIndex: Number.isInteger(slotIndex) ? slotIndex : null,
            });
            continue;
          }
          seenGenerationPolicyIds.add(policy.id);
          seenGenerationPolicySlots.add(slotIndex);
          const slotSeed = createEncounterSlotSeed(encounter.seed, encounter.id, slotIndex);
          for (const threatTier of policy.verificationThreatTiers) {
            try {
              const genome = generateReaverbotGenome({
                seed: slotSeed,
                threatTier,
                intent: encounter.roster[slotIndex],
                roomArchetypeId: encounter.roomArchetypeId,
                roomFlavorId: encounter.roomFlavorId,
                favoredTags: encounter.enemyTags,
                suppressedTags: encounter.enemySuppressedTags,
                behaviorModifiers: encounter.enemyBehaviorModifiers,
                encounterSize: encounter.roster.length,
                ...policy.generationContext,
              });
              const policyValidation = validateReaverbotGenomeAgainstGenerationPolicy(genome, policy);
              if (!policyValidation.valid) {
                error('encounter-slot-generation-policy-capability-invalid', `${encounter.id} slot ${slotIndex} generated an enemy that violates its traversal-safety contract.`, {
                  encounterId: encounter.id,
                  policyId: policy.id,
                  slotIndex,
                  threatTier,
                  errors: [...policyValidation.errors],
                  attackKind: policyValidation.capabilities.attackKind,
                });
                break;
              }
            } catch (generationError) {
              error('encounter-slot-generation-policy-unresolvable', `${encounter.id} slot ${slotIndex} generation policy cannot produce its declared enemy.`, {
                encounterId: encounter.id,
                policyId: policy.id,
                slotIndex,
                threatTier,
                reason: generationError?.message ?? String(generationError),
              });
              break;
            }
          }
        }
      }
      if (encounter.id === 'encounter.assembly') {
        const elevatedPolicy = Array.isArray(slotGenerationPolicies)
          ? slotGenerationPolicies.find((policy) => policy?.slotIndex === 1)
          : null;
        if (!elevatedPolicy
          || !elevatedPolicy.protectedTraversalLinkIds?.includes('traversal.assembly.landmark-stairs')) {
          error('assembly-elevated-route-generation-policy-missing', 'Assembly elevated enemy must declare a verified generation policy protecting its mandatory stair.', {
            encounterId: encounter.id,
            slotIndex: 1,
          });
        }
      }
      for (const engagement of encounter.entryEngagementContracts ?? []) {
        const surface = surfaceById.get(engagement.surfaceId);
        const engagementSurfaceIds = engagement.surfaceIds ?? [engagement.surfaceId];
        const engagementSurfaces = engagementSurfaceIds
          .map((surfaceId) => surfaceById.get(surfaceId));
        const traversalLink = candidate.traversalLinks.find(({ id }) => (
          id === engagement.sourceTraversalLinkId
        ));
        const sourcePoint = traversalLink?.approachContract?.ingressPoint;
        const spawnPoint = encounter.spawnPoints?.[engagement.spawnPointIndex];
        const runtimeSpawnPoint = encounter.spawnPattern?.points?.[engagement.spawnPointIndex];
        const radius = Number(engagement.capsuleRadius);
        const capsuleHeight = Number(engagement.capsuleHeight);
        const sampleSpacing = Math.min(0.21, Number(engagement.sampleSpacing));
        const maximumRange = Number(engagement.maximumEngagementRange);
        const minimumArenaEdgeClearance = Number(engagement.minimumArenaEdgeClearance);
        const minimumPlayerSpawnSeparation = Number(engagement.minimumPlayerSpawnSeparation ?? 0);
        const groundedSpawn = isFiniteVector(spawnPoint) && surface
          ? { x: spawnPoint.x, y: surface.bounds.max.y, z: spawnPoint.z }
          : null;
        const pointOnSurface = (point) => point
          && capsuleFootprintSupportedBySurfaces(point, engagementSurfaces, radius);
        const contractBaseValid = engagement.sourcePointRole === 'post-portal-ingress'
          && engagement.sameLevel === true && engagement.unobstructed === true
          && isFiniteVector(sourcePoint) && isFiniteVector(groundedSpawn)
          && isFiniteVector(runtimeSpawnPoint)
          && engagementSurfaceIds.length >= 1
          && engagementSurfaces.every(Boolean)
          && engagementSurfaceIds.includes(engagement.surfaceId)
          && Number.isFinite(radius) && radius >= 0.42
          && Number.isFinite(capsuleHeight) && capsuleHeight >= 3.2
          && Number.isFinite(sampleSpacing) && sampleSpacing > 0
          && Number.isFinite(maximumRange) && maximumRange > 0
          && Number.isFinite(minimumArenaEdgeClearance) && minimumArenaEdgeClearance >= 1.25
          && Number.isFinite(minimumPlayerSpawnSeparation)
          && minimumPlayerSpawnSeparation >= 0
          && pointOnSurface(sourcePoint) && pointOnSurface(groundedSpawn)
          && validBounds(encounter.zoneBounds)
          && minimumPlanarInset(groundedSpawn, encounter.zoneBounds) >= minimumArenaEdgeClearance - 0.001
          && Math.abs(spawnPoint.y - surface.bounds.max.y) <= 0.5
          && Math.hypot(
            spawnPoint.x - runtimeSpawnPoint.x,
            spawnPoint.y - runtimeSpawnPoint.y,
            spawnPoint.z - runtimeSpawnPoint.z,
          ) <= 0.001;
        const distance = contractBaseValid
          ? Math.hypot(groundedSpawn.x - sourcePoint.x, groundedSpawn.z - sourcePoint.z)
          : Number.POSITIVE_INFINITY;
        const sampleCount = contractBaseValid
          ? Math.max(1, Math.ceil(distance / sampleSpacing))
          : -1;
        const blockers = [];
        const rejoinWaypoints = traversalLink?.approachContract?.combatRejoin?.engagementId
          === engagement.id
          ? traversalLink.approachContract.combatRejoin.waypoints
          : null;
        const engagementRoute = Array.isArray(rejoinWaypoints) && rejoinWaypoints.length >= 2
          ? rejoinWaypoints
          : [sourcePoint, groundedSpawn];
        if (contractBaseValid) {
          for (let segmentIndex = 1; segmentIndex < engagementRoute.length
            && blockers.length === 0; segmentIndex += 1) {
            const segmentStart = engagementRoute[segmentIndex - 1];
            const segmentEnd = engagementRoute[segmentIndex];
            const segmentDistance = Math.hypot(
              segmentEnd.x - segmentStart.x,
              segmentEnd.y - segmentStart.y,
              segmentEnd.z - segmentStart.z,
            );
            const segmentSampleCount = Math.max(1, Math.ceil(segmentDistance / sampleSpacing));
            for (let sampleIndex = 0; sampleIndex <= segmentSampleCount; sampleIndex += 1) {
              const ratio = sampleIndex / segmentSampleCount;
              const point = {
                x: segmentStart.x + (segmentEnd.x - segmentStart.x) * ratio,
                y: segmentStart.y + (segmentEnd.y - segmentStart.y) * ratio,
                z: segmentStart.z + (segmentEnd.z - segmentStart.z) * ratio,
              };
              if (!pointOnSurface(point)) {
                blockers.push(`unsupported:${segmentIndex - 1}:${sampleIndex}`);
                break;
              }
              for (const fixture of candidate.structuralFixtures.filter((entry) => (
                entry.regionId === encounter.regionId && entry.collision === 'blocking'
              ))) {
                if ((fixture.colliderBounds ?? []).some((bounds) => (
                  capsuleIntersectsBounds(point, bounds, radius, capsuleHeight)
                ))) {
                  blockers.push(fixture.id);
                }
              }
              for (const boundary of candidate.structuralBoundaries.filter((entry) => (
                entry.regionId === encounter.regionId && entry.collider !== false
              ))) {
                if (capsuleIntersectsBounds(point, boundary.bounds, radius, capsuleHeight)) {
                  blockers.push(boundary.id);
                }
              }
              if (blockers.length) break;
            }
          }
        }
        if (!contractBaseValid || distance > maximumRange + 0.001
          || distance < minimumPlayerSpawnSeparation - 0.001 || blockers.length) {
          error('encounter-entry-engagement-invalid', `${engagement.id} must provide an unobstructed same-level capsule and firing segment from the accepted ingress.`, {
            encounterId: encounter.id,
            engagementId: engagement.id,
            surfaceId: engagement.surfaceId,
            sourcePoint: sourcePoint ?? null,
            spawnPoint: spawnPoint ?? null,
            distance: Number.isFinite(distance) ? distance : null,
            maximumRange: Number.isFinite(maximumRange) ? maximumRange : null,
            arenaEdgeClearance: groundedSpawn && validBounds(encounter.zoneBounds)
              ? minimumPlanarInset(groundedSpawn, encounter.zoneBounds)
              : null,
            minimumArenaEdgeClearance: Number.isFinite(minimumArenaEdgeClearance)
              ? minimumArenaEdgeClearance
              : null,
            minimumPlayerSpawnSeparation: Number.isFinite(minimumPlayerSpawnSeparation)
              ? minimumPlayerSpawnSeparation
              : null,
            blockers: [...new Set(blockers)],
          });
        }
      }
    }
    for (const objective of candidate.objectives) {
      const objectiveAction = actionById.get(objective.actionId);
      if (!objectiveAction) error('objective-action-missing', `${objective.id} has no action contract.`, { objectiveId: objective.id, actionId: objective.actionId });
      validatePhysicalFixtureRefs(objective, objectiveAction?.interaction?.activationSide !== 'system');
    }
    for (const mechanism of candidate.mechanisms) {
      if (!regionById.has(mechanism.regionId) || !(mechanism.states?.length > 0) || !mechanism.states.some((entry) => entry.id === mechanism.initialStateId)) error('mechanism-contract-invalid', `${mechanism.id} has invalid region or stable-state table.`, { mechanismId: mechanism.id });
      if (mechanism.runtimeProfile?.dynamicSurfaceId && !surfaceById.has(mechanism.runtimeProfile.dynamicSurfaceId)) error('mechanism-surface-missing', `${mechanism.id} references unknown dynamic surface.`, { mechanismId: mechanism.id, surfaceId: mechanism.runtimeProfile.dynamicSurfaceId });
    }
    const water = candidate.environmentStates.find((entry) => entry.type === 'conserved-water-unit');
    if (!water || water.capacityUnits !== 1 || water.stableStates?.length !== 3 || water.stableStates.some((entry) => entry.totalUnits !== 1) || water.basins?.length !== 3) error('water-conservation-invalid', 'Waterworks requires exactly one conserved unit and three exact configurations/basins.', {});
    if (water) {
      const basinById = mapById(water.basins ?? []);
      const volumeRecords = (water.stableStates ?? []).map((state) => ({
        state,
        volume: Object.entries(state.basinLevels ?? {}).reduce((total, [basinId, level]) => {
        const basin = basinById.get(basinId);
        if (!basin || !validBounds(basin.bounds) || !Number.isFinite(level)) return Number.NaN;
        const area = (basin.bounds.max.x - basin.bounds.min.x) * (basin.bounds.max.z - basin.bounds.min.z);
        return total + area * level;
        }, 0),
      }));
      const volumes = volumeRecords.map(({ volume }) => volume);
      if (volumes.some((entry) => !Number.isFinite(entry)) || volumes.some((entry) => Math.abs(entry - volumes[0]) > 0.001)) error('water-geometric-volume-changed', 'Rendered basin cross-section and committed levels do not conserve exact water volume.', { volumes });
      for (const { state, volume } of volumeRecords) {
        if (!Number.isFinite(state.exactVolume) || !Number.isFinite(volume) || Math.abs(volume - state.exactVolume) > 0.001) {
          error('water-exact-volume-mismatch', `${state.id} rendered volume does not match its exactVolume contract.`, { stateId: state.id, renderedVolume: volume, exactVolume: state.exactVolume });
        }
      }
      for (const basin of water.basins ?? []) {
        const floor = surfaceById.get(basin.floorSurfaceId);
        const footprintMatchesFloor = floor
          && Math.abs(basin.bounds.min.x - floor.bounds.min.x) <= 0.001
          && Math.abs(basin.bounds.max.x - floor.bounds.max.x) <= 0.001
          && Math.abs(basin.bounds.min.z - floor.bounds.min.z) <= 0.001
          && Math.abs(basin.bounds.max.z - floor.bounds.max.z) <= 0.001;
        if (basin.footprintPolicy !== 'complete-main-walkable-basin' || !footprintMatchesFloor) {
          error('water-basin-footprint-incomplete', `${basin.id} does not cover its complete authored basin floor.`, { basinId: basin.id, floorSurfaceId: basin.floorSurfaceId });
        }
        const area = validBounds(basin.bounds)
          ? (basin.bounds.max.x - basin.bounds.min.x) * (basin.bounds.max.z - basin.bounds.min.z)
          : Number.NaN;
        if (!Number.isFinite(basin.exactFilledLevel)
          || !Number.isFinite(area)
          || Math.abs(area * basin.exactFilledLevel - basin.exactFilledVolume) > 0.001) {
          error('water-basin-level-volume-mismatch', `${basin.id} exact filled level does not conserve its authored volume.`, { basinId: basin.id, area, exactFilledLevel: basin.exactFilledLevel, exactFilledVolume: basin.exactFilledVolume });
        }
      }
      for (const anchorId of water.permanentDryControlAnchorIds ?? []) {
        const controlAnchor = anchorById.get(anchorId);
        const support = surfaceById.get(controlAnchor?.surfaceId ?? controlAnchor?.safeSurfaceId);
        if (!controlAnchor || !support || support.collision === 'dynamic') {
          error('water-router-not-permanent-dry', `${anchorId} lacks a static dry control surface.`, { anchorId });
          continue;
        }
        for (const state of water.stableStates ?? []) {
          for (const [basinId, level] of Object.entries(state.basinLevels ?? {})) {
            if (!(level > 0)) continue;
            const basin = basinById.get(basinId);
            const inside = basin && controlAnchor.position.x >= basin.bounds.min.x && controlAnchor.position.x <= basin.bounds.max.x
              && controlAnchor.position.z >= basin.bounds.min.z && controlAnchor.position.z <= basin.bounds.max.z;
            const waterTopY = basin ? basin.bounds.min.y + level : Number.POSITIVE_INFINITY;
            if (inside && controlAnchor.position.y < waterTopY + 1) error('water-router-not-permanent-dry', `${anchorId} is submerged or lacks one metre of dry clearance in ${state.id}.`, { anchorId, stateId: state.id, waterTopY, anchorY: controlAnchor.position.y });
          }
        }
      }
    }
    for (const hazard of candidate.environmentStates.filter((entry) => entry.hazardTag)) {
      if (!(hazard.surfaces?.length > 0)) error('hazard-surface-missing', `${hazard.id} has no explicit surfaces.`, { environmentId: hazard.id });
      for (const entry of hazard.surfaces ?? []) if (surfaceById.get(entry.surfaceId)?.hazardTag !== hazard.hazardTag) error('hazard-surface-tag-mismatch', `${hazard.id} surface tag does not match.`, { environmentId: hazard.id, surfaceId: entry.surfaceId });
    }
    if (candidate.recoverySafeguard?.acceptanceActivationLimit !== 0) error('recovery-safeguard-policy-invalid', 'Recovery safeguard activation must fail acceptance.', {});
    if (candidate.fixtureKind === 'golden-complex') validateGoldenRules(candidate, error, options);
    if (candidate.fixtureKind === 'golden-complex' && errors.length === 0) {
      symbolicResult = solveDungeonPlanV2Symbolically(candidate, options.symbolicSolverOptions);
      if (!symbolicResult.solvable) error('symbolic-full-journey-unsolved', 'No deterministic symbolic journey visits all regions/content and extracts.', { visitedStates: symbolicResult.visitedStates, evaluatedTransitions: symbolicResult.evaluatedTransitions, frontierSize: symbolicResult.frontierSize, exhaustedBudget: symbolicResult.exhaustedBudget });
    }
    if (candidate.fixtureKind !== 'golden-complex' && candidate.fixtureKind !== 'traversal-lab') warn('fixture-kind-unknown', 'Plan uses an unrecognized acceptance profile.', { fixtureKind: candidate.fixtureKind });
  }

  const sortedErrors = sortPlanDiagnostics(errors);
  const sortedWarnings = sortPlanDiagnostics(warnings);
  const accepted = sortedErrors.length === 0;
  const diagnosticHash = hashPlanDiagnostics([...sortedErrors, ...sortedWarnings]);
  let plan = candidate;
  if (accepted) {
    const acceptedPlan = clonePlanData(candidate);
    acceptedPlan.accepted = true;
    acceptedPlan.validation = {
      accepted: true,
      diagnosticHash,
      errorCount: 0,
      warningCount: sortedWarnings.length,
      validatorVersion: 'restart-m1',
      symbolicTrace: symbolicResult?.trace ?? [],
    };
    plan = deepFreezePlan(acceptedPlan);
  }
  const result = Object.freeze({
    accepted,
    valid: accepted,
    plan,
    candidate,
    errors: Object.freeze(sortedErrors),
    warnings: Object.freeze(sortedWarnings),
    diagnosticHash,
    diagnostics: Object.freeze({
      diagnosticHash,
      regionCount: candidate?.regions?.length ?? 0,
      cellCount: candidate?.spatialCells?.length ?? 0,
      portalCount: candidate?.portals?.length ?? 0,
      surfaceCount: candidate?.walkableSurfaces?.length ?? 0,
      errorCount: sortedErrors.length,
      warningCount: sortedWarnings.length,
      symbolicVisitedStates: symbolicResult?.visitedStates ?? 0,
      symbolicTransitions: symbolicResult?.evaluatedTransitions ?? 0,
      symbolicTrace: symbolicResult?.trace ?? [],
    }),
  });
  if (!accepted && options.throwOnError) throw new DungeonPlanValidationError(result);
  return result;
}

export function assertValidDungeonPlanV2(plan) {
  return validateDungeonPlanV2(plan, { throwOnError: true }).plan;
}

export default validateDungeonPlanV2;
