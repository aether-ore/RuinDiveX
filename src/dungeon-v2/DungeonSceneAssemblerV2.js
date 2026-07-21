import * as THREE from 'three';
import { DungeonRuntimeV2 } from './DungeonRuntimeV2.js';
import {
  createLegacyAuthoredRuntimeKitV2,
  LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2,
} from './LegacyAuthoredRuntimeKitV2.js';
import {
  createInstancedWorldTiledMaterial,
  createLegacyFixedRoomRuntimeAdapterV2,
  recompileAcceptedLegacyFixedRoomPlacementV2,
} from './LegacyFixedRoomRuntimeAdapterV2.js';
import {
  prepareSemanticRoomPackSceneIntegrationV2,
  renderSemanticRoomPackSceneIntegrationV2,
} from './SemanticRoomPackSceneIntegrationV2.js';
import { stablePlanStringify } from './DungeonPlanDiagnostics.js';

const DEFAULT_TILE_SIZE = 1.4;
// V1 authored its ruin panels on a 2.8m structural grid. Keep that physical
// scale when a V2 plan stretches a wall, ceiling, floor, or support across a
// much larger authored volume. Texture.repeat cannot be set on the shared
// material because differently sized plan objects intentionally reuse it; UVs
// therefore carry the per-object world dimensions instead.
const STRUCTURAL_TEXTURE_TILE_SCALE_METRES = LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2;
const FLOOR_PANEL_THICKNESS = 0.12;
const EPSILON = 0.0001;
const LEGACY_FIXED_ROOM_PRESENTATION_PROFILE_V2 = 'legacy-fixed-room-native-v2';

const MATERIAL_PRESETS = Object.freeze({
  factoryWall: { color: 0x56616a, emissive: 0x080b0e, roughness: 0.78, metalness: 0.48 },
  factoryFloor: { color: 0x39454c, emissive: 0x05080a, roughness: 0.72, metalness: 0.58 },
  factoryTrim: { color: 0x242c31, emissive: 0x06090b, roughness: 0.58, metalness: 0.72 },
  waterworksWall: { color: 0x3c6267, emissive: 0x031215, roughness: 0.72, metalness: 0.5 },
  waterworksFloor: { color: 0x315157, emissive: 0x031013, roughness: 0.7, metalness: 0.56 },
  undercroftWall: { color: 0x514447, emissive: 0x120606, roughness: 0.8, metalness: 0.38 },
  undercroftFloor: { color: 0x40383a, emissive: 0x100505, roughness: 0.84, metalness: 0.3 },
  shrineWall: { color: 0x54546f, emissive: 0x0a0b20, roughness: 0.55, metalness: 0.58 },
  support: { color: 0x222a2e, emissive: 0x030405, roughness: 0.62, metalness: 0.78 },
  hazard: { color: 0x7b2d22, emissive: 0x6f1208, emissiveIntensity: 0.8, roughness: 0.48, metalness: 0.38 },
  electric: { color: 0x385f89, emissive: 0x1768bb, emissiveIntensity: 0.7, roughness: 0.42, metalness: 0.5 },
  signal: { color: 0x5fcbe0, emissive: 0x1e9dbb, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.28 },
  key: { color: 0xffd66b, emissive: 0xd68a16, emissiveIntensity: 0.78, roughness: 0.3, metalness: 0.35 },
});

function finitePoint(value, label) {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new TypeError(`Dungeon V2 ${label} must contain finite x, y, and z values.`);
  }
  return value;
}

function asVector3(value, label = 'position') {
  finitePoint(value, label);
  return new THREE.Vector3(value.x, value.y, value.z);
}

function normalizeHorizontalFacing(value, label) {
  const cardinal = {
    north: { x: 0, z: -1 },
    south: { x: 0, z: 1 },
    east: { x: 1, z: 0 },
    west: { x: -1, z: 0 },
  };
  const source = typeof value === 'string' ? cardinal[value.toLowerCase()] : value;
  const length = Math.hypot(Number(source?.x), Number(source?.z));
  if (!source || !Number.isFinite(length) || length <= EPSILON) {
    throw new Error(`Dungeon V2 ${label} requires a cardinal string or non-zero x/z facing vector.`);
  }
  return { x: source.x / length, z: source.z / length };
}

function normalizeBounds(bounds, label) {
  if (!bounds?.min || !bounds?.max) {
    throw new TypeError(`Dungeon V2 ${label} requires explicit min/max bounds.`);
  }
  const min = finitePoint(bounds.min, `${label}.min`);
  const max = finitePoint(bounds.max, `${label}.max`);
  if (max.x - min.x <= EPSILON || max.y - min.y <= EPSILON || max.z - min.z <= EPSILON) {
    throw new RangeError(`Dungeon V2 ${label} must have positive three-dimensional volume.`);
  }
  return {
    min,
    max,
    center: new THREE.Vector3(
      (min.x + max.x) * 0.5,
      (min.y + max.y) * 0.5,
      (min.z + max.z) * 0.5,
    ),
    size: new THREE.Vector3(max.x - min.x, max.y - min.y, max.z - min.z),
  };
}

function materialsForObject(material) {
  return (Array.isArray(material) ? material : [material]).filter(Boolean);
}

function enforceRepeatWrapping(material) {
  for (const entry of materialsForObject(material)) {
    if (!entry.map) continue;
    entry.map.wrapS = THREE.RepeatWrapping;
    entry.map.wrapT = THREE.RepeatWrapping;
    entry.map.userData.v2WorldScaleTiling = true;
    entry.map.userData.v2TextureTileScaleMetres = STRUCTURAL_TEXTURE_TILE_SCALE_METRES;
    entry.userData.v2WorldScaleTiling = true;
    entry.userData.v2TextureTileScaleMetres = STRUCTURAL_TEXTURE_TILE_SCALE_METRES;
  }
  return material;
}

function materialUsesTexture(material) {
  return materialsForObject(material).some((entry) => Boolean(entry.map));
}

function repeatCount(worldExtent, tileScale = STRUCTURAL_TEXTURE_TILE_SCALE_METRES) {
  if (!Number.isFinite(worldExtent) || worldExtent <= 0
    || !Number.isFinite(tileScale) || tileScale <= 0) {
    throw new RangeError('World-scale texture repeats require positive finite extents and tile scale.');
  }
  // Do not force a complete panel onto geometry smaller than one V1 tile.
  // Doing so compresses the texture across thin ramp edges, floor slabs, and
  // supports. A fractional repeat displays the matching fraction of the 2.8m
  // source panel and therefore preserves the same physical texel density on
  // every face.
  return worldExtent / tileScale;
}

/**
 * BoxGeometry has independent vertices for each face, so its UVs can encode
 * the two real world dimensions of that face while all instances continue to
 * share the same V1 material/texture. This prevents a single ruin panel from
 * being stretched across an entire chamber without multiplying materials or
 * textures (and their associated draw-state cost).
 */
function applyWorldScaleBoxUvs(geometry, size, material) {
  enforceRepeatWrapping(material);
  if (!materialUsesTexture(material)) return null;
  const uv = geometry.getAttribute('uv');
  const normal = geometry.getAttribute('normal');
  if (!uv || !normal || uv.count !== normal.count) {
    throw new Error('World-scale box texturing requires matching UV and normal attributes.');
  }
  const faceRepeats = {
    x: { u: repeatCount(size.z), v: repeatCount(size.y) },
    y: { u: repeatCount(size.x), v: repeatCount(size.z) },
    z: { u: repeatCount(size.x), v: repeatCount(size.y) },
  };
  for (let index = 0; index < uv.count; index += 1) {
    const absX = Math.abs(normal.getX(index));
    const absY = Math.abs(normal.getY(index));
    const absZ = Math.abs(normal.getZ(index));
    const face = absX >= absY && absX >= absZ ? faceRepeats.x
      : absY >= absZ ? faceRepeats.y : faceRepeats.z;
    uv.setXY(index, uv.getX(index) * face.u, uv.getY(index) * face.v);
  }
  uv.needsUpdate = true;
  const metadata = {
    mode: 'per-face-world-dimensions',
    tileScaleMetres: STRUCTURAL_TEXTURE_TILE_SCALE_METRES,
    dimensions: { x: size.x, y: size.y, z: size.z },
    faceRepeats,
  };
  geometry.userData.v2TextureTiling = clonePlain(metadata);
  return metadata;
}

function createWorldTiledBoxGeometry(size, material) {
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  const metadata = applyWorldScaleBoxUvs(geometry, size, material);
  return { geometry, metadata };
}

function clonePlain(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function fixedRoomAssemblyError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = clonePlain(details);
  return error;
}

function exactSerializableMatch(actual, expected) {
  return stablePlanStringify(actual) === stablePlanStringify(expected);
}

function exactIdArray(actual, expected, label, placementId) {
  if (!Array.isArray(actual) || !exactSerializableMatch(actual, expected)) {
    throw fixedRoomAssemblyError(
      'DUNGEON_V2_FIXED_ROOM_RECORD_IDS_MISMATCH',
      `Fixed-room placement ${placementId} has mismatched ${label}.`,
      { expected, actual },
    );
  }
}

function coreBoundaryRecord(record) {
  return {
    id: record?.id,
    bounds: record?.bounds,
    side: record?.side,
    descriptorReference: record?.descriptorReference,
  };
}

function coreSurfaceRecord(record) {
  return {
    id: record?.id,
    bounds: record?.bounds,
    shape: record?.shape ?? null,
    topY: record?.topY,
    ramp: record?.ramp ?? null,
    descriptorReference: record?.descriptorReference,
  };
}

function collectPlanFixtureColliderRecords(plan) {
  if (Array.isArray(plan.fixtureColliders)) {
    return new Map(plan.fixtureColliders.map((collider) => [collider.id, collider]));
  }
  const records = new Map();
  for (const fixture of plan.structuralFixtures ?? []) {
    const colliderIds = fixture.colliderIds ?? [];
    const colliderBounds = fixture.colliderBounds ?? [];
    if (colliderIds.length !== colliderBounds.length) continue;
    colliderIds.forEach((id, index) => records.set(id, {
      id,
      fixtureId: fixture.id,
      bounds: colliderBounds[index],
      descriptorReference: fixture.descriptorReference ?? null,
    }));
  }
  return records;
}

function coreFixtureColliderRecord(record) {
  return {
    id: record?.id,
    fixtureId: record?.fixtureId,
    bounds: record?.bounds,
  };
}

function fixedRoomPresentationPlacements(plan) {
  const placements = [];
  for (const placement of plan.modulePlacements ?? []) {
    const explicitlyRequestsAdapter = placement?.presentation?.adapterId === 'legacy-fixed-room-runtime-v2';
    if (placement?.presentationProfileId !== LEGACY_FIXED_ROOM_PRESENTATION_PROFILE_V2) {
      if (explicitlyRequestsAdapter) {
        throw fixedRoomAssemblyError(
          'DUNGEON_V2_FIXED_ROOM_PROFILE_MISSING',
          `Fixed-room placement ${placement.id ?? '<unknown>'} requests the runtime adapter without ${LEGACY_FIXED_ROOM_PRESENTATION_PROFILE_V2}.`,
        );
      }
      continue;
    }
    if (placement.presentation?.source !== 'dungeon-v1'
      || placement.presentation?.adapterId !== 'legacy-fixed-room-runtime-v2') {
      throw fixedRoomAssemblyError(
        'DUNGEON_V2_FIXED_ROOM_PRESENTATION_OWNER_INVALID',
        `Fixed-room placement ${placement.id ?? '<unknown>'} lacks its explicit Dungeon V1 presentation owner.`,
      );
    }
    placements.push(placement);
  }
  return placements;
}

function prepareLegacyFixedRoomPresentation(plan, { allowInvalidPreview = false } = {}) {
  const placements = fixedRoomPresentationPlacements(plan);
  if (!placements.length) {
    return {
      placements: [],
      boundaryIds: new Set(),
      surfaceIds: new Set(),
      fixtureIds: new Set(),
      portalIds: new Set(),
      compiled: [],
    };
  }

  const boundaryById = new Map(plan.structuralBoundaries.map((record) => [record.id, record]));
  const surfaceById = new Map(plan.walkableSurfaces.map((record) => [record.id, record]));
  const fixtureColliderById = collectPlanFixtureColliderRecords(plan);
  const boundaryIds = new Set();
  const surfaceIds = new Set();
  const fixtureIds = new Set();
  const portalIds = new Set();
  const compiled = [];

  for (const placement of placements) {
    if (!placement.transform || placement.transform.id !== placement.id) {
      throw fixedRoomAssemblyError(
        'DUNGEON_V2_FIXED_ROOM_TRANSFORM_MISMATCH',
        `Fixed-room placement ${placement.id} requires its exact plan-owned transform.`,
      );
    }
    let recompiled;
    try {
      recompiled = recompileAcceptedLegacyFixedRoomPlacementV2(placement);
    } catch (cause) {
      throw fixedRoomAssemblyError(
        'DUNGEON_V2_FIXED_ROOM_SIGNATURE_MISMATCH',
        `Fixed-room placement ${placement.id} does not match its immutable catalog contract: ${cause.message}`,
      );
    }
    const { module, structuralContract, expectedPlacement: expected } = recompiled;
    for (const [field, expectedIds] of [
      ['structuralBoundaryIds', expected.placedRecordIds.structuralBoundaryIds],
      ['walkableSurfaceIds', expected.placedRecordIds.walkableSurfaceIds],
      ['fixtureColliderIds', expected.placedRecordIds.fixtureColliderIds],
      ['portalIds', expected.placedRecordIds.portalIds],
    ]) {
      if (!allowInvalidPreview) {
        exactIdArray(placement.placedRecordIds?.[field], expectedIds, field, placement.id);
      }
    }

    for (const expectedBoundary of expected.structuralBoundaries) {
      const accepted = boundaryById.get(expectedBoundary.id);
      if ((!accepted || !exactSerializableMatch(
        coreBoundaryRecord(accepted),
        coreBoundaryRecord(expectedBoundary),
      )) && !allowInvalidPreview) {
        throw fixedRoomAssemblyError(
          'DUNGEON_V2_FIXED_ROOM_BOUNDARY_MISMATCH',
          `Fixed-room boundary ${expectedBoundary.id} is missing or diverges from the accepted presentation contract.`,
        );
      }
      if (boundaryIds.has(expectedBoundary.id)) {
        throw fixedRoomAssemblyError('DUNGEON_V2_FIXED_ROOM_PRESENTATION_OVERLAP', `Fixed-room boundary ${expectedBoundary.id} has multiple presentation owners.`);
      }
      boundaryIds.add(expectedBoundary.id);
    }
    for (const expectedSurface of expected.walkableSurfaces) {
      const accepted = surfaceById.get(expectedSurface.id);
      if ((!accepted || !exactSerializableMatch(
        coreSurfaceRecord(accepted),
        coreSurfaceRecord(expectedSurface),
      )) && !allowInvalidPreview) {
        throw fixedRoomAssemblyError(
          'DUNGEON_V2_FIXED_ROOM_SURFACE_MISMATCH',
          `Fixed-room surface ${expectedSurface.id} is missing or diverges from the accepted presentation contract.`,
        );
      }
      if (surfaceIds.has(expectedSurface.id)) {
        throw fixedRoomAssemblyError('DUNGEON_V2_FIXED_ROOM_PRESENTATION_OVERLAP', `Fixed-room surface ${expectedSurface.id} has multiple presentation owners.`);
      }
      surfaceIds.add(expectedSurface.id);
    }
    for (const expectedCollider of expected.fixtureColliders) {
      const accepted = fixtureColliderById.get(expectedCollider.id);
      if ((!accepted || !exactSerializableMatch(
        coreFixtureColliderRecord(accepted),
        coreFixtureColliderRecord(expectedCollider),
      )) && !allowInvalidPreview) {
        throw fixedRoomAssemblyError(
          'DUNGEON_V2_FIXED_ROOM_FIXTURE_COLLIDER_MISMATCH',
          `Fixed-room collider ${expectedCollider.id} is missing or diverges from the accepted plan.`,
        );
      }
      fixtureIds.add(expectedCollider.fixtureId);
    }
    for (const portalId of expected.placedRecordIds.portalIds) portalIds.add(portalId);
    compiled.push({ placement, module, structuralContract, expected });
  }

  return { placements, boundaryIds, surfaceIds, fixtureIds, portalIds, compiled };
}

function emptySemanticRoomPackPreparation(plan, presentationRuntime = null) {
  return {
    schemaVersion: 'semantic-room-pack-scene-preparation/2-empty',
    plan,
    placements: [],
    presentationRuntime,
    ownedBoundaryIds: new Set(),
    ownedSurfaceIds: new Set(),
    ownedFixtureIds: new Set(),
    ownedPortalIds: new Set(),
    ownedPortalEndpointKeys: new Set(),
    waterBasinBindingDescriptors: new Map(),
    diagnostics: Object.freeze({
      accepted: true,
      active: false,
      cachedAuthoredTemplatesReady: true,
      placementCount: 0,
      boundaryCount: 0,
      surfaceCount: 0,
      fixtureCount: 0,
      portalCount: 0,
    }),
  };
}

function normalizeSemanticRoomPackPreviewOwnership(plan) {
  const previewPlan = clonePlain(plan);
  const specs = [
    ['structuralBoundaries', 'structuralBoundaryIds'],
    ['walkableSurfaces', 'walkableSurfaceIds'],
    ['structuralFixtures', 'structuralFixtureIds'],
  ];
  for (const placement of previewPlan.semanticRoomPackPlacements ?? []) {
    placement.placedRecordIds ??= {};
    for (const [planKey, ownershipKey] of specs) {
      const liveById = new Map((previewPlan[planKey] ?? []).map((record) => [record.id, record]));
      const records = (placement[planKey] ?? []).filter((record) => (
        liveById.has(record.id)
          && record.colliderId
          && record.sourceNodeName
          && (planKey !== 'structuralBoundaries'
            || (liveById.get(record.id).openings ?? []).length === 0)
      ));
      placement[planKey] = records;
      placement.placedRecordIds[ownershipKey] = records.map(({ id }) => id);
    }
    const livePortalIds = new Set((previewPlan.portals ?? []).map(({ id }) => id));
    placement.socketBindings = (placement.socketBindings ?? []).map((binding) => (
      binding.status === 'bound' && !livePortalIds.has(binding.portalId)
        ? {
          ...binding,
          status: 'capped',
          portalId: null,
          capId: binding.capId ?? `invalid-preview-cap.${placement.id}.${binding.socketId}`,
        }
        : binding
    ));
    placement.boundPortalIds = [...new Set((placement.socketBindings ?? [])
      .filter(({ status, portalId }) => status === 'bound' && livePortalIds.has(portalId))
      .map(({ portalId }) => portalId))];
  }
  return previewPlan;
}

function prepareSemanticRoomPackPresentation(
  plan,
  presentationRuntime = null,
  { allowInvalidPreview = false } = {},
) {
  const placements = plan.semanticRoomPackPlacements ?? [];
  if (!Array.isArray(placements)) {
    throw new TypeError('DungeonPlanV2.semanticRoomPackPlacements must be an array when present.');
  }
  if (!placements.length) return emptySemanticRoomPackPreparation(plan, presentationRuntime);
  // This deliberately throws the presentation cache's deterministic
  // template-not-ready error. A V2 authored room may never degrade to proxy
  // boxes simply because its GLB was not preloaded.
  const presentationPlan = allowInvalidPreview
    ? normalizeSemanticRoomPackPreviewOwnership(plan)
    : plan;
  return prepareSemanticRoomPackSceneIntegrationV2({
    plan: presentationPlan,
    presentationRuntime,
  });
}

function emptySemanticRoomPackPresentation(prepared) {
  return {
    groups: [],
    instances: [],
    physicalNodeBindings: new Map(),
    dynamicBindingsByPlacementId: new Map(),
    waterBasinBindings: new Map(),
    visualMappings: [],
    ownedBoundaryIds: prepared.ownedBoundaryIds,
    ownedSurfaceIds: prepared.ownedSurfaceIds,
    ownedFixtureIds: prepared.ownedFixtureIds,
    ownedPortalIds: prepared.ownedPortalIds,
    ownedPortalEndpointKeys: prepared.ownedPortalEndpointKeys,
    diagnostics: Object.freeze({
      schemaVersion: 'semantic-room-pack-scene-integration/2',
      accepted: true,
      active: false,
      placementCount: 0,
      mappedPhysicalRecordCount: 0,
      boundaryCount: 0,
      surfaceCount: 0,
      fixtureCount: 0,
      portalCount: 0,
      collisionAuthority: 'accepted-plan-semantic-room-pack-records',
      collisionDerivedFromMeshBounds: false,
      cachedAuthoredTemplatesRequired: true,
      genericFallbackGeometry: false,
      placements: [],
    }),
    dispose() {},
  };
}

function renderSemanticRoomPackPresentation({ prepared, group, registry }) {
  if (!prepared.placements.length) return emptySemanticRoomPackPresentation(prepared);
  return renderSemanticRoomPackSceneIntegrationV2({
    prepared,
    parent: group,
    structuralRegistry: registry,
  });
}

function unionPresentationIds(left, right, label) {
  const overlap = [...left].filter((id) => right.has(id));
  if (overlap.length) {
    throw fixedRoomAssemblyError(
      'DUNGEON_V2_PRESENTATION_OWNER_OVERLAP',
      `Legacy fixed-room and semantic room-pack presentations both own ${label} ${overlap[0]}.`,
      { collection: label, overlap },
    );
  }
  return new Set([...left, ...right]);
}

function combineAuthoredPresentationOwnership(fixed, semantic) {
  return {
    boundaryIds: unionPresentationIds(fixed.boundaryIds, semantic.ownedBoundaryIds, 'structural boundary'),
    surfaceIds: unionPresentationIds(fixed.surfaceIds, semantic.ownedSurfaceIds, 'walkable surface'),
    fixtureIds: unionPresentationIds(fixed.fixtureIds, semantic.ownedFixtureIds, 'structural fixture'),
    // Opposite endpoints of one portal may legitimately be owned by a V1
    // room and an authored room-pack module (or by two authored modules).
    // Endpoint ownership, not the connection ID alone, is exclusive.
    portalIds: new Set([...fixed.portalIds, ...semantic.ownedPortalIds]),
    portalEndpointKeys: new Set(semantic.ownedPortalEndpointKeys),
    legacyBoundaryIds: fixed.boundaryIds,
    legacySurfaceIds: fixed.surfaceIds,
    legacyFixtureIds: fixed.fixtureIds,
    semanticBoundaryIds: semantic.ownedBoundaryIds,
    semanticSurfaceIds: semantic.ownedSurfaceIds,
    semanticFixtureIds: semantic.ownedFixtureIds,
  };
}

function boundsTouchOrOverlap(left, right, tolerance = 0.08) {
  return left.min.x <= right.max.x + tolerance
    && left.max.x >= right.min.x - tolerance
    && left.min.y <= right.max.y + tolerance
    && left.max.y >= right.min.y - tolerance
    && left.min.z <= right.max.z + tolerance
    && left.max.z >= right.min.z - tolerance;
}

function registeredColliderBounds(collider) {
  if (collider?.bounds?.min && collider?.bounds?.max) {
    return {
      min: {
        x: Number(collider.bounds.min.x),
        y: Number(collider.bounds.min.y),
        z: Number(collider.bounds.min.z),
      },
      max: {
        x: Number(collider.bounds.max.x),
        y: Number(collider.bounds.max.y),
        z: Number(collider.bounds.max.z),
      },
    };
  }
  const center = collider?.position ?? collider?.center;
  const halfWidth = Number(collider?.halfWidth);
  const halfDepth = Number(collider?.halfDepth);
  const halfHeight = Number(collider?.verticalHalfHeight
    ?? (Number.isFinite(collider?.height) ? collider.height * 0.5 : Number.NaN));
  if (!center || !Number.isFinite(halfWidth) || !Number.isFinite(halfDepth)
    || !Number.isFinite(halfHeight)) return null;
  return {
    min: {
      x: Number(center.x) - halfWidth,
      y: Number.isFinite(collider.baseY) ? Number(collider.baseY) : Number(center.y) - halfHeight,
      z: Number(center.z) - halfDepth,
    },
    max: {
      x: Number(center.x) + halfWidth,
      y: Number.isFinite(collider.topY) ? Number(collider.topY) : Number(center.y) + halfHeight,
      z: Number(center.z) + halfDepth,
    },
  };
}

function cardinalApproachDirection(side) {
  if (side === 'north') return { x: 0, y: 0, z: 1 };
  if (side === 'south') return { x: 0, y: 0, z: -1 };
  if (side === 'east') return { x: -1, y: 0, z: 0 };
  if (side === 'west') return { x: 1, y: 0, z: 0 };
  if (side === 'floor') return { x: 0, y: 1, z: 0 };
  if (side === 'ceiling') return { x: 0, y: -1, z: 0 };
  return null;
}

function strictBoundsOverlap(left, right, epsilon = 0.001) {
  return left.min.x < right.max.x - epsilon
    && left.max.x > right.min.x + epsilon
    && left.min.y < right.max.y - epsilon
    && left.max.y > right.min.y + epsilon
    && left.min.z < right.max.z - epsilon
    && left.max.z > right.min.z + epsilon;
}

function registeredColliderIntersectsApproach(collider, approachBounds) {
  const colliderBounds = registeredColliderBounds(collider);
  if (!colliderBounds || !strictBoundsOverlap(approachBounds, colliderBounds)) return false;
  if (collider?.surfaceType !== 'exact-oriented-ramp-strip'
    || !Array.isArray(collider.collisionSamples)) return true;
  const sampleMargin = Math.max(0.105, Number(collider.collisionSampleSpacing ?? 0.21) * 0.75);
  return collider.collisionSamples.some((sample) => (
    sample.expectedInside === true
    && Number(sample.position?.x) >= approachBounds.min.x - sampleMargin
    && Number(sample.position?.x) <= approachBounds.max.x + sampleMargin
    && Number(sample.position?.z) >= approachBounds.min.z - sampleMargin
    && Number(sample.position?.z) <= approachBounds.max.z + sampleMargin
    // A stair surface flush with the approach floor is support, not an
    // obstruction. Only a raised/overhead portion occupying player headroom
    // rejects the declared approach volume.
    && Number(sample.position?.y) > approachBounds.min.y + 0.05
    && Number(sample.position?.y) < approachBounds.max.y - 0.001
  ));
}

function registeredColliderProvidesDeclaredApproachSupport(collider, approachBounds) {
  const colliderBounds = registeredColliderBounds(collider);
  if (!colliderBounds || !strictBoundsOverlap(approachBounds, colliderBounds)) return false;
  const maximumSupportTop = approachBounds.min.y + 0.05;
  const minimumSupportTop = approachBounds.min.y - 0.05;
  if (collider?.surfaceType !== 'exact-oriented-ramp-strip'
    || !Array.isArray(collider.collisionSamples)) {
    return colliderBounds.min.y <= approachBounds.min.y + 0.051
      && colliderBounds.max.y >= minimumSupportTop
      && colliderBounds.max.y <= maximumSupportTop;
  }
  const sampleMargin = Math.max(0.105, Number(collider.collisionSampleSpacing ?? 0.21) * 0.75);
  const samplesInApproach = collider.collisionSamples.filter((sample) => (
    sample.expectedInside === true
    && Number(sample.position?.x) >= approachBounds.min.x - sampleMargin
    && Number(sample.position?.x) <= approachBounds.max.x + sampleMargin
    && Number(sample.position?.z) >= approachBounds.min.z - sampleMargin
    && Number(sample.position?.z) <= approachBounds.max.z + sampleMargin
  ));
  return samplesInApproach.length > 0
    && samplesInApproach.some((sample) => Number(sample.position?.y) >= minimumSupportTop)
    && samplesInApproach.every((sample) => Number(sample.position?.y) <= maximumSupportTop);
}

function buildPortalApproachClearanceVolumes(plan, portal, registry) {
  const fixtureIds = new Set((plan.structuralFixtures ?? []).map(({ id }) => id));
  const interactionFixtureIds = new Set((plan.structuralFixtures ?? [])
    .filter(({ id }) => id.startsWith('fixture.interaction.'))
    .map(({ id }) => id));
  const routeSurfaceIds = new Set(portal.physicalRoute?.surfaceIds ?? []);
  const endpointSurfaceIds = new Set(Object.values(
    portal.physicalRoute?.endpointSurfaceIds ?? {},
  ).filter(Boolean));
  const surfaceById = new Map((plan.walkableSurfaces ?? []).map((surface) => [surface.id, surface]));
  const ignoredPlanIds = new Set([
    portal.barrierId,
    portal.from.boundaryId,
    portal.to.boundaryId,
  ].filter(Boolean));
  const minimumWidth = Number(portal.traversal?.minimumWidth
    ?? Math.min(portal.from.dimensions.width, portal.to.dimensions.width));
  const minimumHeadroom = Number(portal.traversal?.minimumHeadroom ?? 3.2);
  const approachDepth = Math.max(
    0.6,
    Number(portal.traversal?.interiorIngressDepth ?? 1.2),
  );

  return [['from', portal.from], ['to', portal.to]].map(([endpointName, endpoint]) => {
    const endpointSurfaceId = portal.physicalRoute?.endpointSurfaceIds?.[endpointName] ?? null;
    const declaredSupportingSurfaceIds = new Set([
      ...routeSurfaceIds,
      ...endpointSurfaceIds,
    ]);
    for (const link of plan.traversalLinks ?? []) {
      if (!endpointSurfaceId
        || (link.fromSurfaceId !== endpointSurfaceId && link.toSurfaceId !== endpointSurfaceId)) continue;
      if (link.viaSurfaceId) declaredSupportingSurfaceIds.add(link.viaSurfaceId);
      if (link.mode === 'walk' && link.bidirectional === true && !(link.conditions?.length)) {
        declaredSupportingSurfaceIds.add(link.fromSurfaceId);
        declaredSupportingSurfaceIds.add(link.toSurfaceId);
      }
    }
    const direction = cardinalApproachDirection(endpoint.side);
    if (!direction) {
      return {
        endpoint: endpointName,
        declaredBy: 'portal-endpoint-traversal-contract',
        sampleSpacing: 0.21,
        width: minimumWidth,
        headroom: minimumHeadroom,
        bounds: null,
        structuralFixtureIntrusions: [],
        interactionIntrusions: [],
        colliderIntrusions: ['unsupported-endpoint-side'],
        accepted: false,
      };
    }
    const endpointSurface = surfaceById.get(endpointSurfaceId);
    const sillY = Number(endpointSurface?.bounds?.max?.y ?? endpoint.elevation);
    const centerX = Number(endpoint.center.x) + direction.x * approachDepth * 0.5;
    const centerZ = Number(endpoint.center.z) + direction.z * approachDepth * 0.5;
    let bounds;
    if (Math.abs(direction.y) > 0.5) {
      // Floor/ceiling describe the portal plane, not the direction gravity
      // acts on the player. At either end of a lift or intentional drop the
      // capsule's headroom starts on the declared landing surface and extends
      // upward; extending downward for a ceiling endpoint scans foundations
      // beneath the player's feet instead of the playable landing volume.
      const lowerY = sillY;
      bounds = {
        min: {
          x: Number(endpoint.center.x) - minimumWidth * 0.5,
          y: lowerY,
          z: Number(endpoint.center.z) - minimumWidth * 0.5,
        },
        max: {
          x: Number(endpoint.center.x) + minimumWidth * 0.5,
          y: lowerY + minimumHeadroom,
          z: Number(endpoint.center.z) + minimumWidth * 0.5,
        },
      };
    } else {
      bounds = {
        min: {
          x: centerX - (Math.abs(direction.x) > 0.5 ? approachDepth : minimumWidth) * 0.5,
          y: sillY,
          z: centerZ - (Math.abs(direction.z) > 0.5 ? approachDepth : minimumWidth) * 0.5,
        },
        max: {
          x: centerX + (Math.abs(direction.x) > 0.5 ? approachDepth : minimumWidth) * 0.5,
          y: sillY + minimumHeadroom,
          z: centerZ + (Math.abs(direction.z) > 0.5 ? approachDepth : minimumWidth) * 0.5,
        },
      };
    }

    const structuralFixtureIntrusions = [];
    const interactionIntrusions = [];
    const colliderIntrusions = [];
    for (const [colliderId, collider] of registry.colliders) {
      if (collider?.active === false || collider?.enabled === false) continue;
      const metadata = registry.colliderMetadata.get(colliderId);
      const planId = metadata?.planId ?? collider.planId ?? null;
      if (!planId || ignoredPlanIds.has(planId)) continue;
      const colliderBounds = registeredColliderBounds(collider);
      const colliderRole = metadata?.role ?? collider.structuralRole ?? null;
      const isDeclaredWalkableSupport = declaredSupportingSurfaceIds.has(planId)
        && String(colliderRole).startsWith('walkable-surface:')
        && registeredColliderProvidesDeclaredApproachSupport(collider, bounds);
      if (isDeclaredWalkableSupport) continue;
      if (!colliderBounds || !registeredColliderIntersectsApproach(collider, bounds)) continue;
      const intrusion = {
        colliderId,
        planId,
        role: colliderRole,
        bounds: colliderBounds,
      };
      if (interactionFixtureIds.has(planId)) interactionIntrusions.push(intrusion);
      else if (fixtureIds.has(planId)) structuralFixtureIntrusions.push(intrusion);
      else colliderIntrusions.push(intrusion);
    }
    return {
      endpoint: endpointName,
      declaredBy: 'portal-endpoint-traversal-contract',
      sampleSpacing: 0.21,
      width: minimumWidth,
      headroom: minimumHeadroom,
      depth: approachDepth,
      bounds,
      structuralFixtureIntrusions,
      interactionIntrusions,
      colliderIntrusions,
      accepted: structuralFixtureIntrusions.length === 0
        && interactionIntrusions.length === 0
        && colliderIntrusions.length === 0,
    };
  });
}

function assertPortalPhysicalContinuity(plan) {
  const cellById = new Map(plan.spatialCells.map((cell) => [cell.id, cell]));
  const boundaryById = new Map(plan.structuralBoundaries.map((boundary) => [boundary.id, boundary]));
  const surfaceById = new Map(plan.walkableSurfaces.map((surface) => [surface.id, surface]));
  const diagnostics = [];

  for (const portal of plan.portals) {
    const fromCell = cellById.get(portal.from.cellId);
    const toCell = cellById.get(portal.to.cellId);
    const fromBoundary = boundaryById.get(portal.from.boundaryId);
    const toBoundary = boundaryById.get(portal.to.boundaryId);
    if (!fromCell || !toCell || !fromBoundary || !toBoundary) {
      const error = new Error(`Portal ${portal.id} references missing endpoint cells or boundary frames.`);
      error.code = 'DUNGEON_V2_PORTAL_ENDPOINT_MISSING';
      throw error;
    }
    for (const [endpoint, boundary] of [[portal.from, fromBoundary], [portal.to, toBoundary]]) {
      const endpointOpeningId = endpoint.openingId ?? endpoint.apertureId;
      const matchingOpening = (boundary.openings ?? []).find((opening) => (
        opening.portalId === portal.id
        || opening.id === endpointOpeningId
        || opening.id === `${portal.id}:${endpoint.regionId}`
      ));
      if (!matchingOpening) {
        const error = new Error(`Portal ${portal.id} endpoint ${endpoint.regionId} has no carved opening in boundary ${boundary.id}.`);
        error.code = 'DUNGEON_V2_PORTAL_APERTURE_NOT_CARVED';
        throw error;
      }
    }

    const route = portal.physicalRoute ?? portal.traversal?.physicalRoute ?? null;
    const routeCellIds = route?.cellIds ?? portal.connectorCellIds ?? [];
    const chain = [fromCell, ...routeCellIds.map((id) => cellById.get(id)), toCell];
    if (chain.some((cell) => !cell)) {
      const error = new Error(`Portal ${portal.id} physical route references a missing connector cell.`);
      error.code = 'DUNGEON_V2_PORTAL_ROUTE_CELL_MISSING';
      throw error;
    }

    const directlyAdjacent = boundsTouchOrOverlap(fromCell.bounds, toCell.bounds);
    if (!directlyAdjacent && routeCellIds.length === 0) {
      const error = new Error(`Portal ${portal.id} has separated endpoints without an authored physical route.`);
      error.code = 'DUNGEON_V2_PORTAL_ROUTE_MISSING';
      throw error;
    }
    for (let index = 1; index < chain.length; index += 1) {
      if (!boundsTouchOrOverlap(chain[index - 1].bounds, chain[index].bounds)) {
        const error = new Error(`Portal ${portal.id} physical route is discontinuous between ${chain[index - 1].id} and ${chain[index].id}.`);
        error.code = 'DUNGEON_V2_PORTAL_ROUTE_DISCONTINUOUS';
        throw error;
      }
    }

    for (const cellId of routeCellIds) {
      const sides = new Set(
        plan.structuralBoundaries
          .filter((boundary) => boundary.cellId === cellId)
          .map((boundary) => boundary.side),
      );
      const missingSides = ['north', 'south', 'east', 'west', 'floor', 'ceiling']
        .filter((side) => !sides.has(side));
      const hasWalkableSurface = plan.walkableSurfaces.some((surface) => surface.cellId === cellId);
      const isIntentionalDrop = portal.traversal?.mode === 'intentional-drop'
        || portal.approachType === 'intentional-drop';
      const hasTrajectoryContract = isIntentionalDrop
        && plan.falls.some((fall) => fall.sourcePortalId === portal.id && fall.trajectoryBounds);
      if (missingSides.length || (!hasWalkableSurface && !hasTrajectoryContract)) {
        const error = new Error(`Portal ${portal.id} connector cell ${cellId} is not a complete enclosed traversable volume.`);
        error.code = 'DUNGEON_V2_PORTAL_ROUTE_NOT_ENCLOSED';
        error.details = { cellId, missingSides, hasWalkableSurface, hasTrajectoryContract };
        throw error;
      }
    }
    for (const boundaryId of route?.boundaryIds ?? []) {
      if (!boundaryById.has(boundaryId)) {
        throw new Error(`Portal ${portal.id} physical route references missing boundary ${boundaryId}.`);
      }
    }
    for (const surfaceId of route?.surfaceIds ?? []) {
      if (!surfaceById.has(surfaceId)) {
        throw new Error(`Portal ${portal.id} physical route references missing surface ${surfaceId}.`);
      }
    }
    diagnostics.push({
      portalId: portal.id,
      directlyAdjacent,
      cellIds: chain.map((cell) => cell.id),
      enclosedConnectorCellCount: routeCellIds.length,
      accepted: true,
      sampleSpacing: 0.21,
      continuous: true,
      traversable: true,
      walkable: !['ladder', 'intentional-drop'].includes(portal.traversal?.mode),
      enclosed: true,
      supported: true,
      minimumWidth: Math.min(portal.from.dimensions.width, portal.to.dimensions.width),
      minimumHeadroom: Math.min(portal.from.dimensions.height, portal.to.dimensions.height),
      uncoveredSamples: [],
      blockedSamples: [],
      visualColliderMismatches: [],
    });
  }
  return diagnostics;
}

function materialKey(profileId = '') {
  const profile = String(profileId).toLowerCase();
  if (profile.includes('water')) return profile.includes('floor') ? 'waterworksFloor' : 'waterworksWall';
  if (profile.includes('magma') || profile.includes('hazard')) return 'hazard';
  if (profile.includes('electric')) return 'electric';
  if (profile.includes('under')) return profile.includes('floor') ? 'undercroftFloor' : 'undercroftWall';
  if (profile.includes('shrine')) return 'shrineWall';
  if (profile.includes('support') || profile.includes('trim')) return 'support';
  if (profile.includes('signal') || profile.includes('console')) return 'signal';
  if (profile.includes('key') || profile.includes('reward')) return 'key';
  return profile.includes('floor') ? 'factoryFloor' : 'factoryWall';
}

function getWaterDefinition(plan) {
  const canonical = (plan.environmentStates ?? []).find((entry) => entry.type === 'conserved-water-unit');
  if (canonical) {
    return {
      id: canonical.id,
      variableId: canonical.variableId,
      initialConfigurationId: canonical.initialStateId,
      conservedVolume: canonical.capacityUnits,
      basins: canonical.basins ?? [],
      configurations: (canonical.stableStates ?? []).map((state) => ({
        id: state.id,
        levels: state.basinLevels,
      })),
    };
  }
  return plan.environment?.water ?? plan.environmentModel?.water ?? plan.water ?? null;
}

function getHazardDefinitions(plan) {
  const canonical = (plan.environmentStates ?? []).filter((entry) => (
    entry.type === 'magma-floor-v1' || entry.type === 'electric-floor-cycle-v1'
  ));
  return canonical.length
    ? canonical.map((hazard) => ({
      ...hazard,
      kind: hazard.type.startsWith('electric') ? 'electrical' : 'magma',
      graceSeconds: hazard.graceSeconds ?? hazard.entryGraceSeconds ?? hazard.timing?.graceSeconds ?? hazard.timing?.grace,
      activeSeconds: hazard.activeSeconds ?? hazard.timing?.activeSeconds ?? hazard.timing?.active,
      recoverySeconds: hazard.recoverySeconds ?? hazard.timing?.recoverySeconds ?? hazard.timing?.recovery,
      damagePerPulse: hazard.damagePerPulse ?? hazard.damage?.perPulse,
      damagePerSecond: hazard.damagePerSecond ?? hazard.damage?.perSecond,
      pulseInterval: hazard.pulseInterval ?? hazard.pulseSeconds ?? hazard.timing?.pulseInterval,
    }))
    : plan.environment?.hazards ?? plan.environmentModel?.hazards ?? [];
}

function hazardSurfaceRuntimeId(hazard, surfaceContract) {
  return surfaceContract.id ?? `${hazard.id}:${surfaceContract.surfaceId}`;
}

class MaterialLibraryV2 {
  constructor(plan) {
    this.plan = plan;
    this.materials = new Map();
    this.legacyAuthoredKit = createLegacyAuthoredRuntimeKitV2();
  }

  get(profileValue, { vertexColors = false } = {}) {
    const profileId = typeof profileValue === 'string'
      ? profileValue
      : profileValue?.profileId ?? profileValue?.materialProfileId ?? profileValue?.visualProfile;
    const custom = this.plan.presentation?.materialProfiles?.[profileId]
      ?? this.plan.materialProfiles?.[profileId];
    const presetId = materialKey(profileId ?? 'wall');
    const key = `${profileId ?? presetId}:${vertexColors ? 'vc' : 'plain'}`;
    const legacyMaterial = this.legacyAuthoredKit.getMaterial(profileValue ?? profileId ?? presetId);
    if (!custom && !vertexColors) return enforceRepeatWrapping(legacyMaterial);
    if (this.materials.has(key)) return enforceRepeatWrapping(this.materials.get(key));

    // Future plan-owned color adjustments may tune a V1 material profile, but
    // they must not strip the actual V1 texture map. The previous V2 material
    // bridge explicitly deleted its texture reference, which was the direct
    // cause of the blank grey chambers reported during playtesting.
    const material = legacyMaterial.clone();
    const properties = { ...(custom ?? {}) };
    delete properties.id;
    delete properties.label;
    delete properties.texture;
    delete properties.transparent;
    delete properties.opacity;
    material.setValues({ ...properties, vertexColors, transparent: false, opacity: 1 });
    material.name = `v2LegacyDerivedMaterial:${profileId ?? presetId}`;
    material.userData.v2LegacyDerived = true;
    this.materials.set(key, material);
    return enforceRepeatWrapping(material);
  }

  renderLegacyFixture(fixture) {
    if (fixture?.presentationAsset?.source !== 'dungeon-v1' || !fixture.assetFamilyId) return null;
    return this.legacyAuthoredKit.renderFixture(fixture, {
      assetFamilyId: fixture.assetFamilyId,
      prefabId: fixture.presentationAsset.prefabId ?? null,
    });
  }

  createWater() {
    const material = new THREE.MeshStandardMaterial({
      color: 0x246c85,
      emissive: 0x082b3c,
      emissiveIntensity: 0.45,
      roughness: 0.28,
      metalness: 0.05,
      transparent: true,
      // A flooded basin is now a real visible volume rather than one alpha
      // plane. Keep it translucent enough that machinery, route markers, and
      // the player remain readable while bottom-walking inside that volume.
      opacity: 0.34,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    material.name = 'v2WaterVolumeMaterial';
    // Three normally renders transparent DoubleSide materials in two passes.
    // The closed volume does not need that corrective pass, so keep each basin
    // to one renderer submission while retaining visible interior faces.
    material.forceSinglePass = true;
    material.userData.v2WaterVolumePresentation = true;
    material.userData.v2UnderwaterVisibility = 'double-sided-translucent-volume';
    material.userData.v2CollisionAuthority = 'plan-environment-state-only';
    this.materials.set(`water:${this.materials.size}`, material);
    return material;
  }

  createCrumbleCrack(surfaceId) {
    const key = `crumble-crack:${surfaceId}`;
    if (!this.materials.has(key)) {
      const material = this.legacyAuthoredKit.getMaterial('crackedFloor').clone();
      material.setValues({
        color: 0x7d665f,
        emissive: 0x351006,
        emissiveIntensity: 0.28,
        roughness: 0.84,
        metalness: 0.06,
        // Cracks are part of the registered walkable structure.  Keep the
        // telegraph opaque so a transparent child cannot become a false shell
        // over an otherwise physical crumble surface.
        transparent: false,
        opacity: 1,
        depthWrite: true,
      });
      material.name = `v2CrumbleCrack:${surfaceId}`;
      this.materials.set(key, material);
    }
    return this.materials.get(key);
  }

  getKeycardHalo() {
    const key = 'keycard-halo-v1';
    if (!this.materials.has(key)) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffd66b,
        transparent: true,
        opacity: 0.26,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      material.name = 'v2DroppedKeycardHaloMaterial';
      material.userData.v2CollisionPolicy = 'nonblocking-presentation';
      this.materials.set(key, material);
    }
    return this.materials.get(key);
  }

  dispose() {
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.legacyAuthoredKit.dispose();
  }
}

export class DungeonStructuralRegistryV2 {
  constructor() {
    this.visuals = new Map();
    this.colliders = new Map();
    this.visualMetadata = new Map();
    this.colliderMetadata = new Map();
    this.byPlanId = new Map();
  }

  register(planId, {
    visual = null,
    collider = null,
    role,
    regionId = null,
    visualId: authoredVisualId = null,
    colliderId: authoredColliderId = null,
  }) {
    if (!planId || !role) throw new Error('Structural registry entries require planId and role.');
    const record = this.byPlanId.get(planId) ?? {
      planId,
      regionId,
      roles: [],
      visualIds: [],
      colliderIds: [],
    };
    if (visual) {
      const visualId = authoredVisualId ?? `${planId}:visual:${record.visualIds.length}`;
      if (this.visuals.has(visualId)) {
        throw new Error(`Structural registry visual ID ${visualId} is duplicated.`);
      }
      visual.userData.v2PlanId = planId;
      visual.userData.v2VisualFixtureId = visualId;
      visual.userData.v2StructuralRole = role;
      this.visuals.set(visualId, visual);
      this.visualMetadata.set(visualId, { planId, role, regionId });
      record.visualIds.push(visualId);
    }
    if (collider) {
      const colliderId = authoredColliderId ?? `${planId}:collider:${record.colliderIds.length}`;
      if (this.colliders.has(colliderId)) {
        throw new Error(`Structural registry collider ID ${colliderId} is duplicated.`);
      }
      collider.runtimeSourceId ??= collider.id ?? null;
      // The registry owns its own stable key.  Do not overwrite the
      // compatibility object's plan-owned ID (notably platform.id), because
      // consumers use that ID to relate runtime surfaces back to the accepted
      // DungeonPlanV2.  Keep the registry key explicitly alongside it.
      collider.structuralColliderId = colliderId;
      collider.planId = planId;
      collider.structuralRole = role;
      this.colliders.set(colliderId, collider);
      this.colliderMetadata.set(colliderId, { planId, role, regionId });
      record.colliderIds.push(colliderId);
    }
    if (!record.roles.includes(role)) record.roles.push(role);
    this.byPlanId.set(planId, record);
    return record;
  }

  registerInstancedVisual(planId, {
    visual,
    instanceIndex,
    instanceId,
    role,
    regionId = null,
    visualId = null,
  }) {
    if (!visual?.isInstancedMesh || !Number.isInteger(instanceIndex)
      || instanceIndex < 0 || instanceIndex >= visual.count) {
      throw new Error(`Instanced structural visual ${planId ?? '<unknown>'} requires a valid batch instance.`);
    }
    if (!instanceId) throw new Error(`Instanced structural visual ${planId} requires a stable instance ID.`);
    const authoredVisualId = visualId ?? `${planId}:legacy-fixed-room:${instanceId}`;
    if (this.visuals.has(authoredVisualId)) {
      throw new Error(`Structural registry visual ID ${authoredVisualId} is duplicated.`);
    }
    const record = this.byPlanId.get(planId) ?? {
      planId,
      regionId,
      roles: [],
      visualIds: [],
      colliderIds: [],
    };
    visual.userData.v2InstancedPlanMappings ??= [];
    visual.userData.v2InstancedPlanMappings.push({
      planId,
      visualId: authoredVisualId,
      instanceId,
      instanceIndex,
      role,
    });
    this.visuals.set(authoredVisualId, visual);
    this.visualMetadata.set(authoredVisualId, {
      planId,
      role,
      regionId,
      instanceIndex,
      instanceId,
      instanced: true,
    });
    record.visualIds.push(authoredVisualId);
    if (!record.roles.includes(role)) record.roles.push(role);
    this.byPlanId.set(planId, record);
    return record;
  }

  getVisual(planId) {
    const visualId = this.byPlanId.get(planId)?.visualIds?.[0];
    return visualId ? this.visuals.get(visualId) : null;
  }

  getCollider(planId) {
    const colliderId = this.byPlanId.get(planId)?.colliderIds?.[0];
    return colliderId ? this.colliders.get(colliderId) : null;
  }

  getVisualById(visualId) {
    return this.visuals.get(visualId) ?? null;
  }

  getColliderById(colliderId) {
    return this.colliders.get(colliderId) ?? null;
  }

  snapshot() {
    return [...this.byPlanId.values()].map((record) => clonePlain(record));
  }

  auditSnapshot() {
    const visualEntries = [];
    for (const [visualId, visual] of this.visuals) {
      const metadata = this.visualMetadata.get(visualId);
      visual.updateWorldMatrix?.(true, true);
      const bounds = new THREE.Box3();
      const materials = [];
      const segments = [];
      const visit = (object, ancestorsVisible = true, path = '0') => {
        const visible = ancestorsVisible && object.visible !== false;
        if (!visible) return;
        if (object.isMesh && object.geometry) {
          object.geometry.computeBoundingBox?.();
          if (object.geometry.boundingBox) {
            const localBounds = object.geometry.boundingBox;
            const worldBounds = localBounds.clone().applyMatrix4(object.matrixWorld);
            bounds.union(worldBounds);
            segments.push({
              segmentId: `${visualId}:segment:${path}`,
              name: object.name || null,
              collisionPolicy: object.userData?.v2CollisionPolicy ?? 'physical',
              localBounds: {
                min: { x: localBounds.min.x, y: localBounds.min.y, z: localBounds.min.z },
                max: { x: localBounds.max.x, y: localBounds.max.y, z: localBounds.max.z },
              },
              worldBounds: {
                min: { x: worldBounds.min.x, y: worldBounds.min.y, z: worldBounds.min.z },
                max: { x: worldBounds.max.x, y: worldBounds.max.y, z: worldBounds.max.z },
              },
              matrixWorld: object.matrixWorld.elements.slice(),
            });
          }
          const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of objectMaterials.filter(Boolean)) {
            materials.push({
              name: material.name || null,
              transparent: material.transparent === true,
              opacity: Number.isFinite(material.opacity) ? material.opacity : 1,
              depthWrite: material.depthWrite !== false,
            });
          }
        }
        for (const [index, child] of (object.children ?? []).entries()) {
          visit(child, visible, `${path}.${index}`);
        }
      };
      if (metadata?.instanced === true && visual.isInstancedMesh) {
        visual.geometry.computeBoundingBox?.();
        const localBounds = visual.geometry.boundingBox;
        const instanceMatrix = new THREE.Matrix4();
        visual.getMatrixAt(metadata.instanceIndex, instanceMatrix);
        const worldMatrix = visual.matrixWorld.clone().multiply(instanceMatrix);
        if (localBounds) {
          const worldBounds = localBounds.clone().applyMatrix4(worldMatrix);
          bounds.union(worldBounds);
          segments.push({
            segmentId: `${visualId}:instance:${metadata.instanceIndex}`,
            name: metadata.instanceId,
            collisionPolicy: visual.userData?.v2CollisionPolicy ?? 'physical',
            localBounds: {
              min: { x: localBounds.min.x, y: localBounds.min.y, z: localBounds.min.z },
              max: { x: localBounds.max.x, y: localBounds.max.y, z: localBounds.max.z },
            },
            worldBounds: {
              min: { x: worldBounds.min.x, y: worldBounds.min.y, z: worldBounds.min.z },
              max: { x: worldBounds.max.x, y: worldBounds.max.y, z: worldBounds.max.z },
            },
            matrixWorld: worldMatrix.elements.slice(),
            instanceIndex: metadata.instanceIndex,
            instanceId: metadata.instanceId,
          });
        }
        const objectMaterials = Array.isArray(visual.material) ? visual.material : [visual.material];
        for (const material of objectMaterials.filter(Boolean)) {
          materials.push({
            name: material.name || null,
            transparent: material.transparent === true,
            opacity: Number.isFinite(material.opacity) ? material.opacity : 1,
            depthWrite: material.depthWrite !== false,
          });
        }
      } else {
        visit(visual);
      }
      visualEntries.push({
        visualId,
        ...clonePlain(metadata),
        visible: visual.visible !== false,
        bounds: bounds.isEmpty() ? null : {
          min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
          max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
        },
        materials,
        segments,
      });
    }
    const colliderEntries = [...this.colliders].map(([colliderId, collider]) => {
      const center = collider.position ?? collider.center;
      const verticalHalfHeight = collider.verticalHalfHeight
        ?? (Number.isFinite(collider.height) ? collider.height * 0.5 : null);
      const derivedBounds = center
        && Number.isFinite(collider.halfWidth)
        && Number.isFinite(collider.halfDepth)
        && Number.isFinite(verticalHalfHeight)
        ? {
          min: {
            x: center.x - collider.halfWidth,
            y: Number.isFinite(collider.baseY) ? collider.baseY : center.y - verticalHalfHeight,
            z: center.z - collider.halfDepth,
          },
          max: {
            x: center.x + collider.halfWidth,
            y: Number.isFinite(collider.topY) ? collider.topY : center.y + verticalHalfHeight,
            z: center.z + collider.halfDepth,
          },
        }
        : null;
      return {
        colliderId,
        ...clonePlain(this.colliderMetadata.get(colliderId)),
        active: collider.active !== false && collider.enabled !== false,
        bounds: clonePlain(collider.bounds ?? derivedBounds),
        shape: clonePlain({
          position: collider.position ?? collider.center ?? null,
          halfWidth: collider.halfWidth ?? null,
          halfDepth: collider.halfDepth ?? null,
          verticalHalfHeight,
          surfaceType: collider.surfaceType ?? null,
          rampOrigin: collider.rampOrigin ?? null,
          rampDirection: collider.rampDirection ?? null,
          rampLength: collider.rampLength ?? null,
          rampWidth: collider.rampWidth ?? null,
          stepCount: collider.stepCount ?? null,
          actualMaximumRiser: collider.actualMaximumRiser ?? null,
          actualTread: collider.actualTread ?? null,
          ledgeClimbDisabled: collider.ledgeClimbDisabled ?? null,
        }),
      };
    });
    return clonePlain({
      sampleSpacing: 0.21,
      visualEntries,
      colliderEntries,
    });
  }

  getStructuralRaycastVisuals() {
    const includedRoles = (role) => role?.startsWith('boundary:')
      || role?.startsWith('walkable-surface:');
    return [...new Set([...this.visuals]
      .filter(([visualId, visual]) => visual.visible !== false
        && includedRoles(this.visualMetadata.get(visualId)?.role))
      .map(([, visual]) => visual))];
  }
}

function renderLegacyFixedRoomPresentation({
  plan,
  prepared,
  group,
  registry,
  allowInvalidPreview = false,
}) {
  if (!prepared.compiled.length) {
    return {
      adapter: null,
      groups: [],
      visualMappings: [],
      diagnostics: {
        active: false,
        placementCount: 0,
        drawCalls: 0,
        visualMappingCount: 0,
        genericFallbackGeometry: false,
      },
    };
  }

  const adapter = createLegacyFixedRoomRuntimeAdapterV2();
  const boundaryById = new Map(plan.structuralBoundaries.map((record) => [record.id, record]));
  const surfaceById = new Map(plan.walkableSurfaces.map((record) => [record.id, record]));
  const fixtureById = new Map(plan.structuralFixtures.map((record) => [record.id, record]));
  const groups = [];
  const visualMappings = [];
  let drawCalls = 0;

  for (const { placement, module, structuralContract, expected } of prepared.compiled) {
    const contractMapping = new Map();
    const addMapping = (localId, mapping) => {
      if (contractMapping.has(localId)) {
        throw fixedRoomAssemblyError(
          'DUNGEON_V2_FIXED_ROOM_LOCAL_VISUAL_ID_DUPLICATED',
          `Fixed-room placement ${placement.id} maps local contract ${localId} more than once.`,
        );
      }
      const canonicalWorldId = `${placement.id}:${localId}`;
      if (mapping.planId !== canonicalWorldId || mapping.planId.includes(`${placement.id}/`)) {
        throw fixedRoomAssemblyError(
          'DUNGEON_V2_FIXED_ROOM_WORLD_ID_NONCANONICAL',
          `Fixed-room visual ${mapping.planId} does not use the canonical colon namespace.`,
        );
      }
      contractMapping.set(localId, mapping);
    };

    for (const boundary of expected.structuralBoundaries) {
      const accepted = boundaryById.get(boundary.id);
      addMapping(boundary.localId, {
        planId: boundary.id,
        role: `boundary:${accepted?.side ?? boundary.side ?? 'authored-shell'}`,
        regionId: accepted?.regionId ?? placement.semanticRegionIds?.[0] ?? null,
      });
    }
    for (const surface of expected.walkableSurfaces) {
      const accepted = surfaceById.get(surface.id);
      const stairLike = Boolean(
        accepted?.stairs
        || accepted?.form === 'stairs'
        || ['stairs', 'walkable-stairs'].includes(accepted?.geometry?.type)
        || accepted?.shape === 'ramp-tile'
      );
      addMapping(surface.localId, {
        planId: surface.id,
        role: stairLike ? 'walkable-surface:stairs' : 'walkable-surface:static',
        regionId: accepted?.regionId ?? placement.semanticRegionIds?.[0] ?? null,
      });
    }
    for (const collider of expected.fixtureColliders) {
      if (contractMapping.has(collider.localFixtureId)) continue;
      const accepted = fixtureById.get(collider.fixtureId);
      if (!accepted && !allowInvalidPreview) {
        throw fixedRoomAssemblyError(
          'DUNGEON_V2_FIXED_ROOM_FIXTURE_VISUAL_MISSING',
          `Fixed-room fixture ${collider.fixtureId} has no plan-owned structural fixture.`,
        );
      }
      addMapping(collider.localFixtureId, {
        planId: collider.fixtureId,
        role: `structural-fixture:${accepted?.type ?? 'authored'}`,
        regionId: accepted?.regionId ?? placement.semanticRegionIds?.[0] ?? null,
        baseVisualId: accepted?.visualId ?? null,
      });
    }
    const openSocketIds = new Set(structuralContract.openSocketIds);
    for (const socket of module.extensionSockets) {
      if (!openSocketIds.has(socket.id)
        || !['north', 'south', 'east', 'west'].includes(socket.boundarySide)) continue;
      addMapping(socket.id, {
        planId: `${placement.id}:${socket.id}`,
        role: 'portal-frame:fixed-room-socket',
        regionId: placement.semanticRegionIds?.[0] ?? null,
      });
    }

    const moduleGroup = adapter.buildModule(module, {
      structuralContract,
      placement: expected.transform,
      parent: group,
    });
    moduleGroup.userData.v2PlacementId = placement.id;
    moduleGroup.userData.v2DescriptorId = placement.descriptorId;
    groups.push(moduleGroup);
    drawCalls += Number(moduleGroup.userData.v2PresentationDiagnostics?.drawCalls) || 0;
    const mappedLocalIds = new Set();
    const mappedInstanceCounts = new Map();
    moduleGroup.traverse((object) => {
      if (!object.isInstancedMesh) return;
      const instanceIds = object.userData.v2InstanceIds;
      const contractIds = object.userData.v2ContractIds;
      if (!Array.isArray(instanceIds) || !Array.isArray(contractIds)
        || instanceIds.length !== object.count || contractIds.length !== object.count) {
        throw fixedRoomAssemblyError(
          'DUNGEON_V2_FIXED_ROOM_BATCH_MAPPING_INVALID',
          `Fixed-room batch ${object.name} lacks parallel instance and contract mappings.`,
        );
      }
      for (let instanceIndex = 0; instanceIndex < object.count; instanceIndex += 1) {
        const localContractId = contractIds[instanceIndex];
        const mapping = contractMapping.get(localContractId);
        if (!mapping) {
          throw fixedRoomAssemblyError(
            'DUNGEON_V2_FIXED_ROOM_VISUAL_MAPPING_UNOWNED',
            `Fixed-room batch instance ${instanceIds[instanceIndex]} has no accepted plan contract mapping.`,
            { placementId: placement.id, localContractId },
          );
        }
        mappedLocalIds.add(localContractId);
        const mappedCount = mappedInstanceCounts.get(localContractId) ?? 0;
        mappedInstanceCounts.set(localContractId, mappedCount + 1);
        const stableInstanceId = `${placement.id}:${instanceIds[instanceIndex]}`;
        registry.registerInstancedVisual(mapping.planId, {
          visual: object,
          instanceIndex,
          instanceId: stableInstanceId,
          role: mapping.role,
          regionId: mapping.regionId,
          visualId: mapping.baseVisualId
            ? mappedCount === 0
              ? mapping.baseVisualId
              : `${mapping.baseVisualId}:${instanceIds[instanceIndex]}`
            : null,
        });
        visualMappings.push({
          placementId: placement.id,
          localContractId,
          planId: mapping.planId,
          instanceId: stableInstanceId,
          instanceIndex,
          batchName: object.name,
        });
      }
    });
    const missingMappings = [...contractMapping.keys()].filter((localId) => !mappedLocalIds.has(localId));
    if (missingMappings.length && !allowInvalidPreview) {
      throw fixedRoomAssemblyError(
        'DUNGEON_V2_FIXED_ROOM_VISUAL_MAPPING_MISSING',
        `Fixed-room placement ${placement.id} did not render every accepted visual contract.`,
        { missingMappings },
      );
    }
  }

  return {
    adapter,
    groups,
    visualMappings,
    diagnostics: {
      active: true,
      placementCount: prepared.compiled.length,
      drawCalls,
      visualMappingCount: visualMappings.length,
      genericFallbackGeometry: false,
      instanced: true,
      collisionAuthority: 'accepted-dungeon-plan-v2',
      adapter: clonePlain(adapter.getDiagnostics()),
    },
  };
}

function isAttachedToRoot(object, root) {
  for (let current = object; current; current = current.parent) {
    if (current === root) return true;
  }
  return false;
}

function isVisibleThroughRoot(object, root) {
  for (let current = object; current; current = current.parent) {
    if (current.visible === false) return false;
    if (current === root) return true;
  }
  return false;
}

function buildNativeFixedRoomAssemblyDiagnostics({
  plan,
  root,
  registry,
  presentation,
}) {
  if (!plan.nativeFixedRoomIntegration) return null;
  const ledger = plan.nativeFixedRoomIntegration;
  const activePlacementIds = [...(ledger.activePlacementIds ?? [])];
  const activeDescriptorIds = [...(ledger.activeDescriptorIds ?? [])];
  const incompleteDescriptorIds = [...(ledger.incompleteDescriptorIds ?? [])];
  const requiredPlacementCount = Number(ledger.requiredPlacementCount) || 11;
  const placementById = new Map((plan.modulePlacements ?? []).map((placement) => [
    placement.id,
    placement,
  ]));
  const groupByPlacementId = new Map(presentation.groups.map((moduleGroup) => [
    moduleGroup.userData.v2PlacementId,
    moduleGroup,
  ]));
  const mappingsByPlacementId = new Map();
  for (const mapping of presentation.visualMappings) {
    const mappings = mappingsByPlacementId.get(mapping.placementId) ?? [];
    mappings.push(mapping);
    mappingsByPlacementId.set(mapping.placementId, mappings);
  }

  const placements = activePlacementIds.map((placementId) => {
    const placement = placementById.get(placementId);
    const moduleGroup = groupByPlacementId.get(placementId) ?? null;
    const mappings = mappingsByPlacementId.get(placementId) ?? [];
    const mappedPlanIds = [...new Set(mappings.map(({ planId }) => planId))];
    const mappedVisualIds = [...new Set(mappedPlanIds.flatMap((planId) => (
      registry.byPlanId.get(planId)?.visualIds ?? []
    )))];
    const attachedMappedVisualIds = mappedVisualIds.filter((visualId) => (
      isAttachedToRoot(registry.getVisualById(visualId), root)
    ));
    const visibleMappedVisualIds = attachedMappedVisualIds.filter((visualId) => (
      isVisibleThroughRoot(registry.getVisualById(visualId), root)
    ));
    const surfaceIds = (plan.walkableSurfaces ?? [])
      .filter(({ presentationOwnerId }) => presentationOwnerId === placementId)
      .map(({ id }) => id);
    const registeredSurfaceIds = surfaceIds.filter((surfaceId) => {
      const record = registry.byPlanId.get(surfaceId);
      return (record?.colliderIds ?? []).some((colliderId) => (
        registry.getColliderById(colliderId) != null
      ));
    });
    const registeredColliderIds = [...new Set([
      ...surfaceIds,
      ...(plan.structuralBoundaries ?? [])
        .filter(({ presentationOwnerId }) => presentationOwnerId === placementId)
        .map(({ id }) => id),
      ...(plan.structuralFixtures ?? [])
        .filter(({ nativeFixedRoomPlacementId }) => nativeFixedRoomPlacementId === placementId)
        .map(({ id }) => id),
    ].flatMap((planId) => registry.byPlanId.get(planId)?.colliderIds ?? []))]
      .filter((colliderId) => registry.getColliderById(colliderId) != null);
    let renderedObjectCount = 0;
    let visibleRenderedObjectCount = 0;
    moduleGroup?.traverse?.((object) => {
      if (!object.isMesh || !isAttachedToRoot(object, root)) return;
      renderedObjectCount += 1;
      if (isVisibleThroughRoot(object, root)) visibleRenderedObjectCount += 1;
    });
    return {
      placementId,
      descriptorId: placement?.descriptorId ?? null,
      renderGroupAttached: isAttachedToRoot(moduleGroup, root),
      renderGroupVisible: isVisibleThroughRoot(moduleGroup, root),
      renderedObjectCount,
      visibleRenderedObjectCount,
      visualMappingCount: mappings.length,
      registeredMappedVisualCount: mappedVisualIds.length,
      attachedMappedVisualCount: attachedMappedVisualIds.length,
      visibleMappedVisualCount: visibleMappedVisualIds.length,
      planSurfaceCount: surfaceIds.length,
      registeredSurfaceCount: registeredSurfaceIds.length,
      registeredColliderCount: registeredColliderIds.length,
    };
  });

  return clonePlain({
    requiredPlacementCount,
    activePlacementIds,
    activeDescriptorIds,
    incompleteDescriptorIds,
    activePlacementCount: activePlacementIds.length,
    incompleteDescriptorCount: incompleteDescriptorIds.length,
    allRequiredPlacementsActive: activePlacementIds.length === requiredPlacementCount
      && incompleteDescriptorIds.length === 0,
    presentationActive: presentation.diagnostics.active === true,
    presentationPlacementCount: presentation.diagnostics.placementCount,
    genericFallbackGeometry: ledger.genericFallbackGeometry === true
      || presentation.diagnostics.genericFallbackGeometry === true,
    placements,
  });
}

function makeBoxMesh(bounds, material, name) {
  const normalized = normalizeBounds(bounds, name);
  const { geometry, metadata } = createWorldTiledBoxGeometry(normalized.size, material);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.copy(normalized.center);
  if (metadata) mesh.userData.v2TextureTiling = clonePlain(metadata);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function markOpaqueCameraOcclusionSurface(object, classification, {
  instanceIds = null,
  contractIds = null,
} = {}) {
  if (!object?.isMesh || !classification) return false;
  const objectMaterials = materialsForObject(object.material);
  const opaque = objectMaterials.length > 0 && objectMaterials.every((material) => (
    material.transparent !== true
    && (material.opacity ?? 1) >= 0.999
    && material.depthWrite !== false
  ));
  if (!opaque) return false;
  object.userData.cameraOcclusionSurface = true;
  object.userData.cameraOcclusionOwner = true;
  object.userData.v2CameraOcclusionClass = classification;
  if (object.isInstancedMesh) {
    object.userData.v2CameraOcclusionInstanceMode = 'per-instance';
    object.userData.v2CameraOcclusionInstanceIds = [
      ...(instanceIds ?? object.userData.v2InstanceIds ?? []),
    ];
    object.userData.v2CameraOcclusionContractIds = [
      ...(contractIds ?? object.userData.v2ContractIds ?? []),
    ];
  } else {
    object.userData.v2CameraOcclusionInstanceMode = 'per-object';
  }
  return true;
}

function makeCollider(bounds, id, extras = {}) {
  const normalized = normalizeBounds(bounds, `${id}.collider`);
  return {
    id,
    position: normalized.center,
    halfWidth: normalized.size.x * 0.5,
    halfDepth: normalized.size.z * 0.5,
    verticalHalfHeight: normalized.size.y * 0.5,
    bounds: clonePlain(bounds),
    active: true,
    ...extras,
  };
}

function exactRuntimeCollisionShape(record) {
  if (record?.shape !== 'cylinder') return {};
  const radius = Number(record.worldRadius);
  const height = Number(record.worldHeight);
  if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error(`Manifest cylinder ${record.id ?? '<unknown>'} requires positive worldRadius and worldHeight.`);
  }
  return {
    // Keep halfWidth/halfDepth and bounds as the broad-phase AABB consumed by
    // the spatial index and structural parity diagnostics. The narrow-phase
    // collision contract remains the exact vertical cylinder authored in the
    // immutable room manifest, so its empty diagonal corners never become
    // invisible square blockers.
    shape: 'cylinder',
    collisionShape: 'cylinder',
    collisionRadius: radius,
    radius,
    verticalHalfHeight: height * 0.5,
    manifestCollisionShape: 'cylinder',
    manifestCollisionRadius: radius,
    manifestCollisionHeight: height,
  };
}

function boundaryPlaneAxes(side) {
  if (side === 'north' || side === 'south') return ['x', 'y'];
  if (side === 'east' || side === 'west') return ['z', 'y'];
  if (side === 'floor' || side === 'ceiling') return ['x', 'z'];
  throw new Error(`Unsupported structural boundary side ${side}.`);
}

function openingExtentForAxis(opening, axis, boundarySide) {
  const dimensions = opening.dimensions ?? {};
  if (axis === 'y') return dimensions.height;
  if (axis === 'z' && (boundarySide === 'floor' || boundarySide === 'ceiling')) {
    return dimensions.depth;
  }
  return dimensions.width;
}

function splitBoundaryAroundOpenings(boundary) {
  // Native fixed-room foundations arrive pre-segmented around intentional
  // floor apertures. Their declaration-only opening binds the portal to that
  // segmented face but must not split an already exact panel a second time.
  const openings = (boundary.openings ?? []).filter(({ declarationOnly }) => declarationOnly !== true);
  if (!openings.length) return [boundary.bounds];
  const [axisA, axisB] = boundaryPlaneAxes(boundary.side);
  const bounds = boundary.bounds;
  // The acceptance sampler treats the 1.5 cm perimeter of an aperture as
  // structural frame and allows a 3 cm coverage tolerance.  Expand the void
  // cut by the same 1.5 cm so a sample cannot be attributed to the adjoining
  // wall segment merely through that tolerance.  The resulting edge lip is
  // still within the authored visual/collider parity budget.
  const apertureProofMargin = 0.015;
  const normalizedOpenings = openings.map((opening) => {
    const center = finitePoint(opening.center, `boundary ${boundary.id} opening ${opening.id}`);
    const extentA = openingExtentForAxis(opening, axisA, boundary.side);
    const extentB = openingExtentForAxis(opening, axisB, boundary.side);
    if (!Number.isFinite(extentA) || extentA <= 0 || !Number.isFinite(extentB) || extentB <= 0) {
      throw new Error(`Boundary ${boundary.id} opening ${opening.id} has invalid aperture dimensions.`);
    }
    return {
      ...opening,
      originalMinA: center[axisA] - extentA * 0.5,
      originalMaxA: center[axisA] + extentA * 0.5,
      originalMinB: center[axisB] - extentB * 0.5,
      originalMaxB: center[axisB] + extentB * 0.5,
      minA: center[axisA] - extentA * 0.5 - apertureProofMargin,
      maxA: center[axisA] + extentA * 0.5 + apertureProofMargin,
      minB: center[axisB] - extentB * 0.5 - apertureProofMargin,
      maxB: center[axisB] + extentB * 0.5 + apertureProofMargin,
    };
  });
  for (const opening of normalizedOpenings) {
    if (opening.maxA <= bounds.min[axisA] || opening.minA >= bounds.max[axisA]
      || opening.maxB <= bounds.min[axisB] || opening.minB >= bounds.max[axisB]) {
      throw new Error(`Boundary ${boundary.id} opening ${opening.id} lies outside its structural face.`);
    }
  }

  // Aperture proof margins may extend just beyond the authored face. Clamp
  // split coordinates to the face itself; otherwise the splitter creates
  // 1.5cm phantom wall strips outside the boundary which still block the
  // production-size player capsule at otherwise fully open connector seams.
  const clampA = (value) => THREE.MathUtils.clamp(value, bounds.min[axisA], bounds.max[axisA]);
  const clampB = (value) => THREE.MathUtils.clamp(value, bounds.min[axisB], bounds.max[axisB]);
  const cutsA = [...new Set([
    bounds.min[axisA],
    bounds.max[axisA],
    ...normalizedOpenings.flatMap((opening) => [clampA(opening.minA), clampA(opening.maxA)]),
  ])].sort((left, right) => left - right);
  const cutsB = [...new Set([
    bounds.min[axisB],
    bounds.max[axisB],
    ...normalizedOpenings.flatMap((opening) => [clampB(opening.minB), clampB(opening.maxB)]),
  ])].sort((left, right) => left - right);
  const segments = [];
  for (let aIndex = 1; aIndex < cutsA.length; aIndex += 1) {
    for (let bIndex = 1; bIndex < cutsB.length; bIndex += 1) {
      const minA = cutsA[aIndex - 1];
      const maxA = cutsA[aIndex];
      const minB = cutsB[bIndex - 1];
      const maxB = cutsB[bIndex];
      if (maxA - minA <= EPSILON || maxB - minB <= EPSILON) continue;
      const midpointA = (minA + maxA) * 0.5;
      const midpointB = (minB + maxB) * 0.5;
      const insideOpening = normalizedOpenings.some((opening) => (
        midpointA > opening.minA - EPSILON
        && midpointA < opening.maxA + EPSILON
        && midpointB > opening.minB - EPSILON
        && midpointB < opening.maxB + EPSILON
      ));
      if (insideOpening) continue;
      const segment = clonePlain(bounds);
      segment.min[axisA] = minA;
      segment.max[axisA] = maxA;
      segment.min[axisB] = minB;
      segment.max[axisB] = maxB;
      segments.push(segment);
    }
  }
  // When an aperture terminates exactly at the authored face perimeter there
  // is no in-bounds material on which the sampler's solid edge can land. Add
  // a narrow, outward-facing frame lip. It never intrudes into the playable
  // aperture and remains within the 5 cm structural parity tolerance.
  const edgeLipKeys = new Set();
  const addEdgeLip = (axis, edge) => {
    const key = `${axis}:${edge}`;
    if (edgeLipKeys.has(key)) return;
    edgeLipKeys.add(key);
    const segment = clonePlain(bounds);
    if (edge === 'min') {
      segment.min[axis] = bounds.min[axis] - apertureProofMargin * 2;
      segment.max[axis] = bounds.min[axis] - apertureProofMargin;
    } else {
      segment.min[axis] = bounds.max[axis] + apertureProofMargin;
      segment.max[axis] = bounds.max[axis] + apertureProofMargin * 2;
    }
    segments.push(segment);
  };
  for (const opening of normalizedOpenings) {
    if (Math.abs(opening.originalMinA - bounds.min[axisA]) <= apertureProofMargin) addEdgeLip(axisA, 'min');
    if (Math.abs(opening.originalMaxA - bounds.max[axisA]) <= apertureProofMargin) addEdgeLip(axisA, 'max');
    if (Math.abs(opening.originalMinB - bounds.min[axisB]) <= apertureProofMargin) addEdgeLip(axisB, 'min');
    if (Math.abs(opening.originalMaxB - bounds.max[axisB]) <= apertureProofMargin) addEdgeLip(axisB, 'max');
  }
  if (!segments.length) {
    throw new Error(`Boundary ${boundary.id} openings remove its complete structural face.`);
  }
  return segments;
}

function aggregateRegionBounds(plan, regionId) {
  const cells = (plan.spatialCells ?? []).filter((cell) => cell.regionId === regionId);
  if (!cells.length) throw new Error(`Dungeon V2 region ${regionId} has no spatial cell.`);
  return cells.reduce((result, cell) => ({
    min: {
      x: Math.min(result.min.x, cell.bounds.min.x),
      y: Math.min(result.min.y, cell.bounds.min.y),
      z: Math.min(result.min.z, cell.bounds.min.z),
    },
    max: {
      x: Math.max(result.max.x, cell.bounds.max.x),
      y: Math.max(result.max.y, cell.bounds.max.y),
      z: Math.max(result.max.z, cell.bounds.max.z),
    },
  }), {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  });
}

function createPipeMesh(bounds, material) {
  const normalized = normalizeBounds(bounds, 'pipe fixture');
  const axes = [
    ['x', normalized.size.x],
    ['y', normalized.size.y],
    ['z', normalized.size.z],
  ].sort((left, right) => right[1] - left[1]);
  const [axis, length] = axes[0];
  const radius = Math.max(0.08, Math.min(...axes.slice(1).map((entry) => entry[1])) * 0.5);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 16), material);
  mesh.position.copy(normalized.center);
  if (axis === 'x') mesh.rotation.z = Math.PI * 0.5;
  else if (axis === 'z') mesh.rotation.x = Math.PI * 0.5;
  return mesh;
}

function boundsPortion(bounds, {
  x0 = 0,
  x1 = 1,
  y0 = 0,
  y1 = 1,
  z0 = 0,
  z1 = 1,
} = {}) {
  const mix = (min, max, amount) => THREE.MathUtils.lerp(min, max, amount);
  return {
    min: {
      x: mix(bounds.min.x, bounds.max.x, x0),
      y: mix(bounds.min.y, bounds.max.y, y0),
      z: mix(bounds.min.z, bounds.max.z, z0),
    },
    max: {
      x: mix(bounds.min.x, bounds.max.x, x1),
      y: mix(bounds.min.y, bounds.max.y, y1),
      z: mix(bounds.min.z, bounds.max.z, z1),
    },
  };
}

function createFixtureVisual(fixture, materials) {
  const bounds = normalizeBounds(fixture.bounds, `structural fixture ${fixture.id}`);
  const legacyAuthoredObject = materials.renderLegacyFixture(fixture);
  if (legacyAuthoredObject) {
    legacyAuthoredObject.name = `v2StructuralFixture:${fixture.id}`;
    legacyAuthoredObject.userData.v2PresentationSource = 'dungeon-v1';
    legacyAuthoredObject.userData.v2ColliderAuthority = 'accepted-dungeon-plan-v2';
    const landmarkCasterTypes = new Set([
      'generator',
      'processing-tank',
      'reservoir',
      'refractor-shrine',
      'shrine-dais',
    ]);
    const receiverOnly = !landmarkCasterTypes.has(fixture.type);
    const shadowPolicy = receiverOnly
      ? 'authored-repeated-receiver-only'
      : 'authored-feature-caster';
    legacyAuthoredObject.userData.v2ShadowPolicy = shadowPolicy;
    legacyAuthoredObject.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = !receiverOnly;
      object.receiveShadow = true;
      object.userData.v2ShadowPolicy = shadowPolicy;
      markOpaqueCameraOcclusionSurface(object, 'opaque-fixture');
    });
    return legacyAuthoredObject;
  }

  const material = materials.get(fixture);
  const group = new THREE.Group();
  group.name = `v2StructuralFixture:${fixture.id}`;
  const add = (mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  if (['support-column', 'girder', 'catwalk-support', 'bulkhead-brace', 'rail', 'server-bank', 'native-v1-solid-deck-mass', 'native-v1-catwalk-frame'].includes(fixture.type)) {
    if (fixture.type === 'native-v1-solid-deck-mass') {
      const deckParts = fixture.colliderBounds ?? [];
      if (!deckParts.length || deckParts.length !== fixture.colliderIds?.length) {
        throw new Error(`${fixture.id} requires one visible native deck part per collider.`);
      }
      const deckGeometry = new THREE.BoxGeometry(1, 1, 1);
      const textureDimensions = new Float32Array(deckParts.length * 3);
      const deckBatch = new THREE.InstancedMesh(
        deckGeometry,
        createInstancedWorldTiledMaterial(material),
        deckParts.length,
      );
      deckBatch.name = `${group.name}:carved-deck-parts`;
      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion();
      for (const [index, partBounds] of deckParts.entries()) {
        const normalized = normalizeBounds(partBounds, `${fixture.id} deck part ${index + 1}`);
        matrix.compose(normalized.center, quaternion, normalized.size);
        deckBatch.setMatrixAt(index, matrix);
        textureDimensions[index * 3] = normalized.size.x;
        textureDimensions[index * 3 + 1] = normalized.size.y;
        textureDimensions[index * 3 + 2] = normalized.size.z;
      }
      deckGeometry.setAttribute(
        'instanceV2TextureDimensions',
        new THREE.InstancedBufferAttribute(textureDimensions, 3),
      );
      deckGeometry.userData.v2TextureTiling = {
        mode: 'per-instance-world-dimensions',
        tileScaleMetres: STRUCTURAL_TEXTURE_TILE_SCALE_METRES,
        attribute: 'instanceV2TextureDimensions',
      };
      deckBatch.instanceMatrix.needsUpdate = true;
      deckBatch.computeBoundingBox();
      deckBatch.computeBoundingSphere();
      deckBatch.userData.v2InstancedNativeDeckMasses = true;
      deckBatch.userData.v2InstanceIds = [...fixture.colliderIds];
      deckBatch.userData.v2ColliderIds = [...fixture.colliderIds];
      deckBatch.userData.v2TextureTiling = clonePlain(deckGeometry.userData.v2TextureTiling);
      add(deckBatch);
      group.userData.v2NativeSupportProof = {
        type: 'solid-architectural-deck-mass',
        sourceArchitecture: fixture.sourceArchitecture,
        supportedSurfaceIds: [...(fixture.supportedSurfaceIds ?? [])],
        visualColliderParity: 'exact-carved-parts',
        rampClearanceProfile: clonePlain(fixture.rampClearanceProfile ?? null),
      };
    } else if (fixture.type === 'native-v1-catwalk-frame') {
      const frameParts = fixture.colliderBounds ?? [];
      const partRoles = fixture.partRoles ?? [];
      const partMaterialProfileIds = fixture.partMaterialProfileIds ?? [];
      if (!frameParts.length
        || frameParts.length !== fixture.colliderIds?.length
        || frameParts.length !== partRoles.length
        || frameParts.length !== partMaterialProfileIds.length) {
        throw new Error(`${fixture.id} requires one visible native catwalk-frame part, role, and V1 material per collider.`);
      }
      const profileIndices = new Map();
      partMaterialProfileIds.forEach((profileId, index) => {
        const indices = profileIndices.get(profileId) ?? [];
        indices.push(index);
        profileIndices.set(profileId, indices);
      });
      for (const [profileId, indices] of profileIndices) {
        const frameGeometry = new THREE.BoxGeometry(1, 1, 1);
        const textureDimensions = new Float32Array(indices.length * 3);
        const frameBatch = new THREE.InstancedMesh(
          frameGeometry,
          createInstancedWorldTiledMaterial(materials.get(profileId)),
          indices.length,
        );
        frameBatch.name = `${group.name}:catwalk-frame-${profileId === 'legacy-rail' ? 'rails' : 'supports'}`;
        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion();
        for (const [batchIndex, partIndex] of indices.entries()) {
          const normalized = normalizeBounds(
            frameParts[partIndex],
            `${fixture.id} frame part ${partIndex + 1}`,
          );
          matrix.compose(normalized.center, quaternion, normalized.size);
          frameBatch.setMatrixAt(batchIndex, matrix);
          textureDimensions[batchIndex * 3] = normalized.size.x;
          textureDimensions[batchIndex * 3 + 1] = normalized.size.y;
          textureDimensions[batchIndex * 3 + 2] = normalized.size.z;
        }
        frameGeometry.setAttribute(
          'instanceV2TextureDimensions',
          new THREE.InstancedBufferAttribute(textureDimensions, 3),
        );
        frameGeometry.userData.v2TextureTiling = {
          mode: 'per-instance-world-dimensions',
          tileScaleMetres: STRUCTURAL_TEXTURE_TILE_SCALE_METRES,
          attribute: 'instanceV2TextureDimensions',
        };
        frameBatch.instanceMatrix.needsUpdate = true;
        frameBatch.computeBoundingBox();
        frameBatch.computeBoundingSphere();
        frameBatch.userData.v2InstancedNativeCatwalkFrame = true;
        frameBatch.userData.v2FramePartIndices = [...indices];
        frameBatch.userData.v2FrameMaterialProfileId = profileId;
        frameBatch.userData.v2InstanceIds = indices.map((index) => fixture.colliderIds[index]);
        frameBatch.userData.v2ColliderIds = indices.map((index) => fixture.colliderIds[index]);
        frameBatch.userData.v2PartRoles = indices.map((index) => partRoles[index]);
        frameBatch.userData.v2PartSourceSurfaceIds = indices.map((index) => (
          clonePlain(fixture.partSourceSurfaceIds?.[index] ?? [])
        ));
        frameBatch.userData.v2TextureTiling = clonePlain(frameGeometry.userData.v2TextureTiling);
        add(frameBatch);
      }
      group.userData.v2NativeSupportProof = {
        type: 'thin-deck-railing-and-post-frame',
        sourceArchitecture: fixture.sourceArchitecture,
        supportedSurfaceIds: [...(fixture.supportedSurfaceIds ?? [])],
        visualColliderParity: 'exact-instanced-frame-parts',
        partRoles: [...partRoles],
        partMaterialProfileIds: [...partMaterialProfileIds],
        visualDrawObjects: profileIndices.size,
        catwalkProfile: clonePlain(fixture.catwalkProfile ?? null),
      };
    } else {
      add(makeBoxMesh(fixture.bounds, material, `${group.name}:body`));
    }
  } else if (fixture.type === 'native-v1-ramp-support') {
    const massMaterial = materials.get('legacy-wall-industrial');
    const stringerMaterial = materials.get('legacy-support');
    const foundationBounds = fixture.colliderBounds ?? [];
    if (foundationBounds.length) {
      const foundationGeometry = new THREE.BoxGeometry(1, 1, 1);
      const textureDimensions = new Float32Array(foundationBounds.length * 3);
      const foundations = new THREE.InstancedMesh(
        foundationGeometry,
        createInstancedWorldTiledMaterial(massMaterial),
        foundationBounds.length,
      );
      foundations.name = `${group.name}:foundation-steps`;
      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion();
      for (const [index, stepBounds] of foundationBounds.entries()) {
        const normalized = normalizeBounds(stepBounds, `${fixture.id} foundation ${index + 1}`);
        matrix.compose(normalized.center, quaternion, normalized.size);
        foundations.setMatrixAt(index, matrix);
        textureDimensions[index * 3] = normalized.size.x;
        textureDimensions[index * 3 + 1] = normalized.size.y;
        textureDimensions[index * 3 + 2] = normalized.size.z;
      }
      foundationGeometry.setAttribute(
        'instanceV2TextureDimensions',
        new THREE.InstancedBufferAttribute(textureDimensions, 3),
      );
      foundationGeometry.userData.v2TextureTiling = {
        mode: 'per-instance-world-dimensions',
        tileScaleMetres: STRUCTURAL_TEXTURE_TILE_SCALE_METRES,
        attribute: 'instanceV2TextureDimensions',
      };
      foundations.instanceMatrix.needsUpdate = true;
      foundations.computeBoundingBox();
      foundations.computeBoundingSphere();
      foundations.userData.v2InstancedNativeRampFoundations = true;
      foundations.userData.v2InstanceIds = [...fixture.colliderIds];
      foundations.userData.v2ColliderIds = [...fixture.colliderIds];
      foundations.userData.v2TextureTiling = clonePlain(foundationGeometry.userData.v2TextureTiling);
      add(foundations);
    }
    const localForward = new THREE.Vector3(0, 0, 1);
    const stringers = fixture.stringers ?? [];
    if (stringers.length) {
      const stringerGeometry = new THREE.BoxGeometry(1, 1, 1);
      const textureDimensions = new Float32Array(stringers.length * 3);
      const stringerBatch = new THREE.InstancedMesh(
        stringerGeometry,
        createInstancedWorldTiledMaterial(stringerMaterial),
        stringers.length,
      );
      stringerBatch.name = `${group.name}:sloped-stringers`;
      const matrix = new THREE.Matrix4();
      const scale = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      for (const [index, stringer] of stringers.entries()) {
      const start = new THREE.Vector3(stringer.start.x, stringer.start.y, stringer.start.z);
      const end = new THREE.Vector3(stringer.end.x, stringer.end.y, stringer.end.z);
      const direction = end.clone().sub(start);
      const length = direction.length();
      if (!(length > 0.001)) throw new Error(`${fixture.id} has a zero-length native ramp stringer.`);
        const midpoint = start.clone().add(end).multiplyScalar(0.5);
        quaternion.setFromUnitVectors(localForward, direction.normalize());
        scale.set(stringer.width, stringer.height, length);
        matrix.compose(midpoint, quaternion, scale);
        stringerBatch.setMatrixAt(index, matrix);
        textureDimensions[index * 3] = stringer.width;
        textureDimensions[index * 3 + 1] = stringer.height;
        textureDimensions[index * 3 + 2] = length;
      }
      stringerGeometry.setAttribute(
        'instanceV2TextureDimensions',
        new THREE.InstancedBufferAttribute(textureDimensions, 3),
      );
      stringerGeometry.userData.v2TextureTiling = {
        mode: 'per-instance-world-dimensions',
        tileScaleMetres: STRUCTURAL_TEXTURE_TILE_SCALE_METRES,
        attribute: 'instanceV2TextureDimensions',
      };
      stringerBatch.instanceMatrix.needsUpdate = true;
      stringerBatch.computeBoundingBox();
      stringerBatch.computeBoundingSphere();
      stringerBatch.userData.v2InstancedNativeRampStringers = true;
      stringerBatch.userData.v2InstanceIds = stringers.map(({ id }) => `${fixture.id}:${id}`);
      stringerBatch.userData.v2TextureTiling = clonePlain(stringerGeometry.userData.v2TextureTiling);
      add(stringerBatch);
    }
    group.userData.v2NativeSupportProof = {
      type: 'contiguous-industrial-ramp-foundation-and-stringers',
      sourceArchitecture: fixture.sourceArchitecture,
      rampRouteId: fixture.rampRouteId,
      supportedSurfaceIds: [...(fixture.supportedSurfaceIds ?? [])],
      foundationColliderCount: fixture.colliderBounds?.length ?? 0,
      stringerCount: fixture.stringers?.length ?? 0,
      visualDrawObjects: (foundationBounds.length ? 1 : 0) + (stringers.length ? 1 : 0),
      instancing: 'one-foundation-batch-plus-one-stringer-batch-per-ramp-run',
      nonSnaggingPolicy: 'foundation-steps-stop-at-lowest-slope-underside',
    };
  } else if (fixture.type === 'mechanism-shaft-support') {
    const postWidth = Math.max(0.18, Math.min(0.32, Math.min(bounds.size.x, bounds.size.z) * 0.12));
    const beamHeight = Math.max(0.18, Math.min(0.3, bounds.size.y * 0.12));
    const collisionBounds = [];
    for (const x of [bounds.min.x + postWidth * 0.5, bounds.max.x - postWidth * 0.5]) {
      for (const z of [bounds.min.z + postWidth * 0.5, bounds.max.z - postWidth * 0.5]) {
        const postBounds = {
          min: { x: x - postWidth * 0.5, y: bounds.min.y, z: z - postWidth * 0.5 },
          max: { x: x + postWidth * 0.5, y: bounds.max.y, z: z + postWidth * 0.5 },
        };
        add(makeBoxMesh(postBounds, material, `${group.name}:shaft-post`));
        collisionBounds.push(postBounds);
      }
    }
    for (const y of [bounds.min.y + beamHeight * 0.5, bounds.max.y - beamHeight * 0.5]) {
      for (const z of [bounds.min.z + postWidth * 0.5, bounds.max.z - postWidth * 0.5]) {
        const crossBeamBounds = {
          min: { x: bounds.min.x, y: y - beamHeight * 0.5, z: z - postWidth * 0.5 },
          max: { x: bounds.max.x, y: y + beamHeight * 0.5, z: z + postWidth * 0.5 },
        };
        add(makeBoxMesh(crossBeamBounds, material, `${group.name}:shaft-crossbeam`));
        collisionBounds.push(crossBeamBounds);
      }
    }
    group.userData.v2ColliderBounds = collisionBounds;
  } else if (fixture.type === 'overhead-track-support') {
    const postWidth = Math.max(0.2, Math.min(0.34, Math.min(bounds.size.x, bounds.size.z) * 0.14));
    const railHeight = Math.max(0.2, Math.min(0.36, bounds.size.y * 0.14));
    const alongX = bounds.size.x >= bounds.size.z;
    const collisionBounds = [];
    const postCoordinates = alongX
      ? [
        { x: bounds.min.x + postWidth * 0.5, z: bounds.min.z + postWidth * 0.5 },
        { x: bounds.min.x + postWidth * 0.5, z: bounds.max.z - postWidth * 0.5 },
        { x: bounds.max.x - postWidth * 0.5, z: bounds.min.z + postWidth * 0.5 },
        { x: bounds.max.x - postWidth * 0.5, z: bounds.max.z - postWidth * 0.5 },
      ]
      : [
        { x: bounds.min.x + postWidth * 0.5, z: bounds.min.z + postWidth * 0.5 },
        { x: bounds.max.x - postWidth * 0.5, z: bounds.min.z + postWidth * 0.5 },
        { x: bounds.min.x + postWidth * 0.5, z: bounds.max.z - postWidth * 0.5 },
        { x: bounds.max.x - postWidth * 0.5, z: bounds.max.z - postWidth * 0.5 },
      ];
    for (const coordinate of postCoordinates) {
      const postBounds = {
        min: { x: coordinate.x - postWidth * 0.5, y: bounds.min.y, z: coordinate.z - postWidth * 0.5 },
        max: { x: coordinate.x + postWidth * 0.5, y: bounds.max.y, z: coordinate.z + postWidth * 0.5 },
      };
      add(makeBoxMesh(postBounds, material, `${group.name}:track-post`));
      collisionBounds.push(postBounds);
    }
    const railBounds = {
      min: {
        x: alongX ? bounds.min.x : bounds.center.x - postWidth * 0.5,
        y: bounds.max.y - railHeight,
        z: alongX ? bounds.center.z - postWidth * 0.5 : bounds.min.z,
      },
      max: {
        x: alongX ? bounds.max.x : bounds.center.x + postWidth * 0.5,
        y: bounds.max.y,
        z: alongX ? bounds.center.z + postWidth * 0.5 : bounds.max.z,
      },
    };
    add(makeBoxMesh(railBounds, material, `${group.name}:overhead-rail`));
    collisionBounds.push(railBounds);
    group.userData.v2ColliderBounds = collisionBounds;
  } else if (fixture.type === 'structural-support') {
    const columnWidth = Math.max(0.22, Math.min(0.48, Math.min(bounds.size.x, bounds.size.z) * 0.12));
    const collisionBounds = [];
    for (const x of [bounds.min.x + columnWidth * 0.5, bounds.max.x - columnWidth * 0.5]) {
      for (const z of [bounds.min.z + columnWidth * 0.5, bounds.max.z - columnWidth * 0.5]) {
        const columnBounds = {
          min: { x: x - columnWidth * 0.5, y: bounds.min.y, z: z - columnWidth * 0.5 },
          max: { x: x + columnWidth * 0.5, y: bounds.max.y, z: z + columnWidth * 0.5 },
        };
        add(makeBoxMesh(columnBounds, material, `${group.name}:column`));
        collisionBounds.push(columnBounds);
      }
    }
    const includeXBeams = fixture.openApproachAxis !== 'z';
    const includeZBeams = fixture.openApproachAxis !== 'x';
    const beamBounds = [
      ...(includeXBeams ? [bounds.min.z, bounds.max.z - columnWidth].map((z) => ({
        min: { x: bounds.min.x, y: bounds.max.y - columnWidth, z },
        max: { x: bounds.max.x, y: bounds.max.y, z: z + columnWidth },
      })) : []),
      ...(includeZBeams ? [bounds.min.x, bounds.max.x - columnWidth].map((x) => ({
        min: { x, y: bounds.max.y - columnWidth, z: bounds.min.z },
        max: { x: x + columnWidth, y: bounds.max.y, z: bounds.max.z },
      })) : []),
    ];
    for (const perimeterBeamBounds of beamBounds) {
      add(makeBoxMesh(perimeterBeamBounds, material, `${group.name}:perimeter-beam`));
      collisionBounds.push(perimeterBeamBounds);
    }
    group.userData.v2ColliderBounds = collisionBounds;
  } else if (['pipe', 'pressure-pipe', 'coolant-pipe', 'conduit', 'traversal-pipe'].includes(fixture.type)) {
    add(createPipeMesh(fixture.bounds, material));
  } else if (['pump', 'pump-array'].includes(fixture.type)) {
    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(bounds.size.x, bounds.size.y * 0.72, bounds.size.z),
      material,
    );
    housing.position.copy(bounds.center).setY(bounds.min.y + bounds.size.y * 0.36);
    add(housing);
    const wheelRadius = Math.max(0.2, Math.min(bounds.size.x, bounds.size.y) * 0.28);
    const wheelTubeRadius = Math.max(0.05, wheelRadius * 0.12);
    const wheel = new THREE.Mesh(
      new THREE.TorusGeometry(wheelRadius, wheelTubeRadius, 10, 28),
      materials.get('signal'),
    );
    wheel.position.copy(bounds.center);
    // Seat the handwheel inside the authored blocking volume with its front
    // edge flush to the collider instead of protruding into the player path.
    wheel.position.z = bounds.min.z + wheelTubeRadius;
    add(wheel);
  } else if (['reservoir', 'processing-tank', 'pressure-vessel'].includes(fixture.type)) {
    const radius = Math.min(bounds.size.x, bounds.size.z) * 0.5;
    const tank = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, bounds.size.y, 20),
      material,
    );
    tank.position.copy(bounds.center);
    add(tank);
  } else if (['machine', 'generator', 'control-bank', 'functional-machine'].includes(fixture.type)) {
    add(makeBoxMesh(fixture.bounds, material, `${group.name}:body`));
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(bounds.size.x * 0.62, bounds.size.y * 0.28, 0.06),
      materials.get('signal'),
    );
    // Keep the readable face flush with the authored blocking volume.  A
    // protruding screen would otherwise be a reachable visual without a
    // matching collider.
    panel.position.set(bounds.center.x, bounds.center.y + bounds.size.y * 0.16, bounds.min.z + 0.03);
    add(panel);
  } else if ([
    'interaction-console',
    'selector-console',
    'water-router-console',
    'mechanism-console',
    'gate-console',
    'recall-console',
    'control-console',
  ].includes(fixture.type)) {
    add(makeBoxMesh(fixture.bounds, material, `${group.name}:console-cabinet`));
    const bodyBounds = boundsPortion(bounds, { x0: 0.12, x1: 0.88, y1: 0.72, z0: 0.18, z1: 0.82 });
    const screenBounds = {
      min: {
        x: THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, 0.16),
        y: THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, 0.7),
        z: bounds.min.z - 0.035,
      },
      max: {
        x: THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, 0.84),
        y: THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, 0.94),
        z: bounds.min.z + 0.015,
      },
    };
    const capBounds = boundsPortion(bounds, { x0: 0.06, x1: 0.94, y0: 0.66, y1: 0.75, z0: 0.1, z1: 0.9 });
    add(makeBoxMesh(bodyBounds, material, `${group.name}:pedestal`));
    const screen = add(makeBoxMesh(screenBounds, materials.get('signal'), 'mechanismTerminalScreen'));
    screen.name = 'mechanismTerminalScreen';
    add(makeBoxMesh(capBounds, materials.get('factoryTrim'), `${group.name}:console-cap`));
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(Math.max(0.07, Math.min(bounds.size.x, bounds.size.z) * 0.1)),
      materials.get('signal'),
    );
    core.name = 'mechanismTerminalCore';
    core.position.set(bounds.center.x, bounds.min.y + bounds.size.y * 0.82, bounds.center.z);
    add(core);
    group.userData.v2ColliderBounds = [fixture.bounds];
  } else if (fixture.type === 'key-seeker-console') {
    add(makeBoxMesh(fixture.bounds, material, `${group.name}:key-seeker-cabinet`));
    const bodyBounds = boundsPortion(bounds, { x0: 0.14, x1: 0.86, y1: 0.7, z0: 0.14, z1: 0.86 });
    const capBounds = boundsPortion(bounds, { x0: 0.06, x1: 0.94, y0: 0.65, y1: 0.76, z0: 0.06, z1: 0.94 });
    add(makeBoxMesh(bodyBounds, material, `${group.name}:pedestal`));
    add(makeBoxMesh(capBounds, materials.get('factoryTrim'), `${group.name}:cap`));
    const lensRadius = Math.max(
      0.08,
      Math.min(
        Math.min(bounds.size.x, bounds.size.z) * 0.24,
        bounds.size.y * 0.14,
      ),
    );
    const ringTubeRadius = Math.min(0.035, lensRadius * 0.2);
    const ringRadius = Math.min(
      Math.min(bounds.size.x, bounds.size.z) * 0.32,
      lensRadius * 1.28,
    );
    const signalCenterY = Math.min(
      bounds.min.y + bounds.size.y * 0.84,
      bounds.max.y - ringRadius - ringTubeRadius,
    );
    const signalFrontZ = bounds.min.z + ringTubeRadius;
    const lens = new THREE.Mesh(
      new THREE.SphereGeometry(lensRadius, 18, 12),
      materials.get('signal'),
    );
    lens.name = 'keySeekerSignalLens';
    lens.scale.z = 0.12;
    lens.position.set(
      bounds.center.x,
      signalCenterY,
      bounds.min.z + lensRadius * lens.scale.z,
    );
    add(lens);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(ringRadius, ringTubeRadius, 8, 24),
      materials.get('signal'),
    );
    ring.name = 'keySeekerSignalRing';
    ring.position.set(bounds.center.x, signalCenterY, signalFrontZ);
    add(ring);
    group.userData.v2ColliderBounds = [fixture.bounds];
  } else if (['keycard-pedestal', 'reward-pedestal'].includes(fixture.type)) {
    add(makeBoxMesh(fixture.bounds, material, `${group.name}:solid-plinth`));
    const baseBounds = boundsPortion(bounds, { x0: 0.04, x1: 0.96, y1: 0.16, z0: 0.04, z1: 0.96 });
    const stemBounds = boundsPortion(bounds, { x0: 0.28, x1: 0.72, y0: 0.14, y1: 0.78, z0: 0.28, z1: 0.72 });
    const topBounds = boundsPortion(bounds, { x0: 0.12, x1: 0.88, y0: 0.76, y1: 0.9, z0: 0.12, z1: 0.88 });
    add(makeBoxMesh(baseBounds, materials.get('factoryTrim'), `${group.name}:base`));
    add(makeBoxMesh(stemBounds, material, `${group.name}:stem`));
    add(makeBoxMesh(topBounds, materials.get('key'), `${group.name}:display-deck`));
    group.userData.v2ColliderBounds = [fixture.bounds];
  } else if (['cache-chest', 'treasure-chest'].includes(fixture.type)) {
    add(makeBoxMesh(fixture.bounds, material, `${group.name}:chest-body`));
    const baseBounds = boundsPortion(bounds, { x0: 0.03, x1: 0.97, y1: 0.64, z0: 0.03, z1: 0.97 });
    const lidBounds = boundsPortion(bounds, { y0: 0.64, y1: 0.91 });
    const trimBounds = boundsPortion(bounds, { x0: 0, x1: 1, y0: 0.58, y1: 0.68, z0: 0, z1: 1 });
    add(makeBoxMesh(baseBounds, material, `${group.name}:base`));
    const lid = add(makeBoxMesh(lidBounds, materials.get('key'), 'ruinChestLid'));
    lid.name = 'ruinChestLid';
    const trim = add(makeBoxMesh(trimBounds, materials.get('signal'), 'ruinChestTrim'));
    trim.name = 'ruinChestTrim';
    const lockBounds = boundsPortion(bounds, { x0: 0.42, x1: 0.58, y0: 0.45, y1: 0.72, z0: 0, z1: 0.08 });
    const lock = add(makeBoxMesh(lockBounds, materials.get('key'), 'ruinChestLock'));
    lock.name = 'ruinChestLock';
    const glowMaterial = materials.get('signal').clone();
    glowMaterial.transparent = true;
    glowMaterial.opacity = 0.16;
    glowMaterial.depthWrite = false;
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(Math.min(bounds.size.x, bounds.size.z) * 0.48, 24),
      glowMaterial,
    );
    glow.name = 'ruinChestGlow';
    glow.rotation.x = -Math.PI * 0.5;
    glow.position.set(bounds.center.x, bounds.min.y + 0.012, bounds.center.z);
    add(glow);
    group.userData.v2ColliderBounds = [fixture.bounds];
  } else if (['refractor-shrine', 'shrine-dais'].includes(fixture.type)) {
    add(makeBoxMesh(fixture.bounds, material, `${group.name}:solid-shrine-plinth`));
    const baseBounds = boundsPortion(bounds, { y1: 0.16 });
    const middleBounds = boundsPortion(bounds, { x0: 0.1, x1: 0.9, y0: 0.15, y1: 0.28, z0: 0.1, z1: 0.9 });
    const upperBounds = boundsPortion(bounds, { x0: 0.2, x1: 0.8, y0: 0.27, y1: 0.38, z0: 0.2, z1: 0.8 });
    add(makeBoxMesh(baseBounds, material, `${group.name}:base-tier`));
    add(makeBoxMesh(middleBounds, materials.get('factoryTrim'), `${group.name}:middle-tier`));
    add(makeBoxMesh(upperBounds, materials.get('shrine-wall'), `${group.name}:upper-tier`));
    group.userData.v2ColliderBounds = [fixture.bounds];
  } else if (fixture.type === 'extraction-pad') {
    const padBounds = boundsPortion(bounds, { y1: Math.min(1, Math.max(0.08, 0.12 / bounds.size.y)) });
    add(makeBoxMesh(padBounds, materials.get('signal'), `${group.name}:pad`));
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(
        Math.max(0.3, Math.min(bounds.size.x, bounds.size.z) * 0.36),
        Math.min(0.04, bounds.size.y * 0.2),
        8,
        32,
      ),
      materials.get('signal'),
    );
    ring.name = 'largeRefractorExtractionPadRing';
    ring.userData.v2CollisionPolicy = 'nonblocking-effect';
    ring.position.set(bounds.center.x, bounds.center.y, bounds.center.z);
    ring.rotation.x = Math.PI * 0.5;
    add(ring);
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.22, bounds.size.y * 0.8, 8),
      materials.get('signal'),
    );
    core.name = 'largeRefractorExtractionPadCore';
    core.userData.v2CollisionPolicy = 'nonblocking-effect';
    core.position.copy(bounds.center);
    add(core);
    group.name = 'largeRefractorExtractionPad';
    group.visible = false;
    group.userData.v2ColliderBounds = [padBounds];
  } else if (['conveyor', 'cargo-track'].includes(fixture.type)) {
    add(makeBoxMesh(fixture.bounds, material, `${group.name}:bed`));
    const alongX = bounds.size.x >= bounds.size.z;
    const length = alongX ? bounds.size.x : bounds.size.z;
    const rollerCount = Math.max(2, Math.floor(length / 0.7));
    for (let index = 0; index < rollerCount; index += 1) {
      const roller = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, alongX ? bounds.size.z * 0.84 : bounds.size.x * 0.84, 10),
        materials.get('factoryTrim'),
      );
      // A belt running along X has rollers spanning Z (and vice versa). Keep
      // the full composite visual inside the authored blocking volume so the
      // plan-owned collider and rendered machinery agree exactly.
      if (alongX) roller.rotation.x = Math.PI * 0.5;
      else roller.rotation.z = Math.PI * 0.5;
      const progress = (index + 0.5) / rollerCount;
      roller.position.set(
        alongX ? THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, progress) : bounds.center.x,
        bounds.max.y - 0.08,
        alongX ? bounds.center.z : THREE.MathUtils.lerp(bounds.min.z, bounds.max.z, progress),
      );
      add(roller);
    }
  } else if (['valve', 'handwheel'].includes(fixture.type)) {
    const stem = createPipeMesh(fixture.bounds, material);
    add(stem);
    const wheel = new THREE.Mesh(
      new THREE.TorusGeometry(Math.min(bounds.size.x, bounds.size.y) * 0.34, 0.06, 10, 28),
      materials.get('hazard'),
    );
    wheel.position.copy(bounds.center);
    add(wheel);
  } else if (fixture.type === 'industrial-light') {
    add(makeBoxMesh(fixture.bounds, materials.get('signal'), `${group.name}:light`));
    const light = new THREE.PointLight(0x6bdcff, fixture.intensity ?? 1.2, fixture.range ?? 12, 2);
    light.position.copy(bounds.center);
    group.add(light);
  } else {
    throw new Error(`Unsupported explicit Dungeon V2 structural fixture type ${fixture.type} (${fixture.id}).`);
  }
  const elevatedOccluderFixtureTypes = new Set([
    'catwalk-support', 'rail',
    'native-v1-solid-deck-mass', 'native-v1-catwalk-frame', 'native-v1-ramp-support',
    'mechanism-shaft-support', 'overhead-track-support',
  ]);
  const fixtureOcclusionClass = elevatedOccluderFixtureTypes.has(fixture.type)
    ? 'elevated-catwalk'
    : 'opaque-fixture';
  group.traverse((object) => {
    if (!object.isMesh) return;
    markOpaqueCameraOcclusionSurface(object, fixtureOcclusionClass);
  });

  // Bulk structural kit pieces already read through their lit materials and
  // receive the chamber's shadows. Submitting every brace, rung, roller, and
  // pipe to the directional shadow map multiplied the V2 draw workload
  // without adding useful route information. Keep authored machinery,
  // controls, and rewards as shadow casters; mark repeated kit receiver-only
  // while retaining every visible and colliding mesh.
  const receiverOnlyFixtureTypes = new Set([
    'support-column', 'girder', 'catwalk-support', 'bulkhead-brace', 'rail',
    'mechanism-shaft-support', 'overhead-track-support', 'structural-support',
    'native-v1-solid-deck-mass', 'native-v1-catwalk-frame', 'native-v1-ramp-support',
    'pipe', 'pressure-pipe', 'coolant-pipe', 'conduit', 'traversal-pipe',
    'conveyor', 'cargo-track', 'industrial-light',
    // These small repeated props remain fully lit and colliding, but casting
    // every console/pedestal/chest into the shadow atlas recreates the V2 lag
    // spike without improving route readability.
    'interaction-console', 'keycard-pedestal', 'reward-pedestal',
    'cache-chest', 'treasure-chest',
  ]);
  const receiverOnly = receiverOnlyFixtureTypes.has(fixture.type);
  group.userData.v2ShadowPolicy = receiverOnly
    ? 'structural-receiver-only'
    : 'authored-feature-caster';
  if (receiverOnly) {
    group.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = false;
      object.receiveShadow = true;
      object.userData.v2ShadowPolicy = 'structural-receiver-only';
    });
  }
  return group;
}

function createInvalidPreviewFixtureVisual(fixture, materials) {
  const group = new THREE.Group();
  group.name = `v2InvalidPreviewFixture:${fixture.id}`;
  group.userData.v2InvalidPreviewFallback = true;
  group.userData.v2PresentationSource = 'invalid-plan-preview';
  const visualBounds = Array.isArray(fixture.colliderBounds) && fixture.colliderBounds.length
    ? fixture.colliderBounds
    : [fixture.bounds];
  for (const [index, bounds] of visualBounds.entries()) {
    const mesh = makeBoxMesh(
      bounds,
      materials.get(fixture),
      `${group.name}:part-${index + 1}`,
    );
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.v2InvalidPreviewFallback = true;
    markOpaqueCameraOcclusionSurface(mesh, 'opaque-fixture');
    group.add(mesh);
  }
  group.userData.v2ColliderBounds = visualBounds.map((bounds) => clonePlain(bounds));
  return group;
}

function addStructuralFixtures({
  plan,
  group,
  materials,
  registry,
  solidZones,
  aerialBoundaryZones,
  resources,
  authoredPresentation = null,
  allowInvalidPreview = false,
}) {
  for (const fixture of plan.structuralFixtures) {
    if (fixture.collision === false && fixture.accessibility !== 'inaccessible') {
      throw new Error(`Non-colliding fixture ${fixture.id} must be explicitly classified as inaccessible.`);
    }
    let usesAuthoredVisual = authoredPresentation?.fixtureIds.has(fixture.id) === true;
    let usesLegacyFixedRoomVisual = authoredPresentation?.legacyFixtureIds.has(fixture.id) === true;
    let usesSemanticRoomPackVisual = authoredPresentation?.semanticFixtureIds.has(fixture.id) === true;
    const previewAuthoredVisualFallback = allowInvalidPreview
      && usesAuthoredVisual
      && !registry.getVisual(fixture.id);
    if (previewAuthoredVisualFallback) {
      usesAuthoredVisual = false;
      usesLegacyFixedRoomVisual = false;
      usesSemanticRoomPackVisual = false;
    }
    if (usesLegacyFixedRoomVisual && fixture.mechanismId) {
      throw fixedRoomAssemblyError(
        'DUNGEON_V2_FIXED_ROOM_DYNAMIC_FIXTURE_UNSUPPORTED',
        `Fixed-room fixture ${fixture.id} is instanced presentation and cannot own mutable mechanism visuals.`,
      );
    }
    let object;
    if (usesAuthoredVisual) {
      object = registry.getVisual(fixture.id);
    } else if (previewAuthoredVisualFallback) {
      object = createInvalidPreviewFixtureVisual(fixture, materials);
    } else {
      try {
        object = createFixtureVisual(fixture, materials);
      } catch (error) {
        if (!allowInvalidPreview) throw error;
        object = createInvalidPreviewFixtureVisual(fixture, materials);
        object.userData.v2InvalidPreviewFallbackReason = error?.message ?? String(error);
      }
    }
    if (!object) {
      throw fixedRoomAssemblyError(
        'DUNGEON_V2_AUTHORED_FIXTURE_VISUAL_MISSING',
        `Authored fixture ${fixture.id} has no registered presentation visual.`,
      );
    }
    if (!usesAuthoredVisual) {
      object.userData.v2FixtureId = fixture.id;
      object.userData.v2FixtureType = fixture.type;
      object.userData.v2GameplayPurpose = fixture.purpose ?? fixture.gameplayPurpose;
      group.add(object);
    }
    if (!fixture.visualId) {
      throw new Error(`Structural fixture ${fixture.id} requires a stable plan-owned visualId.`);
    }
    if (!Array.isArray(fixture.supportBoundaryIds) || !fixture.supportBoundaryIds.length) {
      throw new Error(`Structural fixture ${fixture.id} requires explicit visible supportBoundaryIds.`);
    }
    if (usesAuthoredVisual && fixture.collision !== false && !Array.isArray(fixture.colliderBounds)) {
      throw fixedRoomAssemblyError(
        'DUNGEON_V2_AUTHORED_FIXTURE_COLLIDER_BOUNDS_MISSING',
        `Authored fixture ${fixture.id} requires explicit plan-owned colliderBounds.`,
      );
    }
    const colliderBounds = fixture.collision === false
      ? []
      : fixture.colliderBounds ?? object.userData.v2ColliderBounds ?? [fixture.bounds];
    const colliderIds = fixture.colliderIds
      ?? (usesSemanticRoomPackVisual && fixture.colliderId ? [fixture.colliderId] : []);
    if (colliderIds.length !== colliderBounds.length) {
      throw new Error(`Structural fixture ${fixture.id} has ${colliderBounds.length} physical collider bounds but ${colliderIds.length} stable colliderIds.`);
    }
    const runtimeColliders = [];
    if (!colliderBounds.length && !usesAuthoredVisual) {
      registry.register(fixture.id, {
        visual: object,
        visualId: fixture.visualId,
        role: `structural-fixture:${fixture.type}`,
        regionId: fixture.regionId,
      });
    }
    for (const [index, bounds] of colliderBounds.entries()) {
      const collider = makeCollider(bounds, `v2FixtureCollider:${fixture.id}:${index}`, {
        regionId: fixture.regionId,
        cellId: fixture.cellId,
        obstacleKind: 'structuralFixture',
        blocksPowerKnockback: fixture.blocksPowerKnockback === true,
        allowPowerKnockbackRecovery: fixture.blocksPowerKnockback !== true,
        ...exactRuntimeCollisionShape(fixture),
      });
      registry.register(fixture.id, {
        visual: !usesAuthoredVisual && index === 0 ? object : null,
        visualId: !usesAuthoredVisual && index === 0 ? fixture.visualId : null,
        collider,
        colliderId: colliderIds[index],
        role: `structural-fixture:${fixture.type}`,
        regionId: fixture.regionId,
      });
      solidZones.push(collider);
      if (fixture.blocksAerialTraversal !== false) aerialBoundaryZones.push(collider);
      runtimeColliders.push(collider);
    }
    if (fixture.mechanismId) {
      if (!resources.mechanismFixtures.has(fixture.mechanismId)) {
        resources.mechanismFixtures.set(fixture.mechanismId, []);
      }
      resources.mechanismFixtures.get(fixture.mechanismId).push({
        fixtureId: fixture.id,
        object,
        colliders: runtimeColliders,
      });
    }
  }
}

function validateInternalTraversal(plan) {
  const surfaceById = new Map(plan.walkableSurfaces.map((surface) => [surface.id, surface]));
  const allAnchors = new Map([
    ...plan.anchors.map((anchor) => [anchor.id, anchor]),
    ...plan.safeAnchors.map((anchor) => [anchor.id, anchor]),
  ]);
  const startAnchor = allAnchors.get(plan.compatibility?.playerStartAnchorId)
    ?? plan.safeAnchors.find((anchor) => anchor.purpose === 'player-start')
    ?? plan.safeAnchors[0];
  const startSurfaceId = startAnchor?.surfaceId ?? startAnchor?.safeSurfaceId;
  if (!startSurfaceId || !surfaceById.has(startSurfaceId)) {
    throw new Error('Dungeon V2 player-start anchor must name its supporting walkable surfaceId.');
  }
  const outgoing = new Map(plan.walkableSurfaces.map((surface) => [surface.id, []]));
  const validModes = new Set([
    'walk',
    'stairs',
    'walkable-stairs',
    'ladder',
    'catwalk',
    'lift',
    'cargo-lift',
    'moving-platform',
    'moving-cargo',
    'intentional-drop',
    'crumble-drop',
    'pipe-platforming',
    'ramped-descent',
    'ramped-ascent',
    'bottom-walk',
    'gear-platform',
    'corkscrew-gear',
    'crumbling-floor',
  ]);
  for (const link of plan.traversalLinks) {
    if (!surfaceById.has(link.fromSurfaceId) || !surfaceById.has(link.toSurfaceId)) {
      throw new Error(`Traversal link ${link.id} references a missing walkable surface.`);
    }
    if (!validModes.has(link.mode)) {
      throw new Error(`Traversal link ${link.id} has unsupported explicit mode ${link.mode}.`);
    }
    const bidirectional = link.bidirectional !== false && link.direction !== 'forward-only';
    if (link.viaSurfaceId) {
      if (!surfaceById.has(link.viaSurfaceId)) {
        throw new Error(`Traversal link ${link.id} references missing via surface ${link.viaSurfaceId}.`);
      }
      outgoing.get(link.fromSurfaceId).push(link.viaSurfaceId);
      outgoing.get(link.viaSurfaceId).push(link.toSurfaceId);
      if (bidirectional) {
        outgoing.get(link.toSurfaceId).push(link.viaSurfaceId);
        outgoing.get(link.viaSurfaceId).push(link.fromSurfaceId);
      }
    } else {
      outgoing.get(link.fromSurfaceId).push(link.toSurfaceId);
      if (bidirectional) outgoing.get(link.toSurfaceId).push(link.fromSurfaceId);
    }
  }
  const visit = (start) => {
    const visited = new Set([start]);
    const queue = [start];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const next of outgoing.get(queue[cursor]) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return visited;
  };
  const reachable = visit(startSurfaceId);
  const unreachable = [...surfaceById.keys()].filter((surfaceId) => !reachable.has(surfaceId));
  if (unreachable.length) {
    const error = new Error(`Dungeon V2 contains walkable surfaces without authored traversal from spawn: ${unreachable.join(', ')}.`);
    error.code = 'DUNGEON_V2_INTERNAL_TRAVERSAL_DISCONNECTED';
    throw error;
  }
  const withoutReturn = [...surfaceById.keys()].filter((surfaceId) => !visit(surfaceId).has(startSurfaceId));
  if (withoutReturn.length) {
    const error = new Error(`Dungeon V2 contains surfaces without a damage-free authored return: ${withoutReturn.join(', ')}.`);
    error.code = 'DUNGEON_V2_INTERNAL_RETURN_MISSING';
    throw error;
  }
  return {
    startSurfaceId,
    reachableSurfaceIds: [...reachable],
    returnVerifiedSurfaceIds: [...surfaceById.keys()],
    linkCount: plan.traversalLinks.length,
    accepted: true,
  };
}

function createCompatibilityRooms(plan, tileSize) {
  return (plan.regions ?? []).map((region) => {
    const bounds = region.bounds ?? aggregateRegionBounds(plan, region.id);
    const centerX = (bounds.min.x + bounds.max.x) * 0.5;
    const centerZ = (bounds.min.z + bounds.max.z) * 0.5;
    return {
      id: region.id,
      stableRegionId: region.id,
      type: region.type ?? region.semanticBeat ?? 'dungeonV2Region',
      archetype: region.label ?? region.displayName ?? region.id,
      archetypeId: region.archetypeId ?? region.id,
      purpose: region.purpose ?? region.functionalPurpose ?? region.semanticBeat ?? null,
      environmentalStory: region.environmentalStory ?? null,
      flavorId: region.flavorId ?? null,
      x: Math.round(centerX / tileSize),
      z: Math.round(centerZ / tileSize),
      width: Math.max(1, Math.ceil((bounds.max.x - bounds.min.x) / tileSize)),
      depth: Math.max(1, Math.ceil((bounds.max.z - bounds.min.z) / tileSize)),
      minY: bounds.min.y,
      maxY: bounds.max.y,
      ceilingHeight: bounds.max.y,
      bounds: clonePlain(bounds),
      districtId: region.districtId,
    };
  });
}

function collectAssemblyPerformanceSnapshot(root) {
  const geometries = new Set();
  const materials = new Set();
  const shadowCasterByPolicy = {};
  let meshCount = 0;
  let visibleMeshCount = 0;
  let triangleCount = 0;
  let visibleTriangleCount = 0;
  let visibleShadowCasterCount = 0;
  let visibleReceiverOnlyMeshCount = 0;
  const triangleCountFor = (geometry) => {
    if (!geometry) return 0;
    const count = geometry.index?.count ?? geometry.attributes?.position?.count ?? 0;
    return Math.floor(count / 3);
  };
  const visit = (object, ancestorsVisible = true, inheritedPolicy = null) => {
    const visible = ancestorsVisible && object.visible !== false;
    const policy = object.userData?.v2ShadowPolicy ?? inheritedPolicy ?? 'unclassified';
    if (object.isMesh) {
      meshCount += 1;
      geometries.add(object.geometry);
      for (const material of (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean)) {
        materials.add(material);
      }
      const triangles = triangleCountFor(object.geometry);
      triangleCount += triangles;
      if (visible) {
        visibleMeshCount += 1;
        visibleTriangleCount += triangles;
        if (object.castShadow) {
          visibleShadowCasterCount += 1;
          shadowCasterByPolicy[policy] = (shadowCasterByPolicy[policy] ?? 0) + 1;
        } else if (/receiver-only/.test(policy)) {
          visibleReceiverOnlyMeshCount += 1;
        }
      }
    }
    for (const child of object.children ?? []) visit(child, visible, policy);
  };
  visit(root);
  return Object.freeze({
    meshCount,
    visibleMeshCount,
    geometryCount: geometries.size,
    materialCount: materials.size,
    triangleCount,
    visibleTriangleCount,
    visibleShadowCasterCount,
    visibleReceiverOnlyMeshCount,
    shadowCasterByPolicy: Object.freeze({ ...shadowCasterByPolicy }),
  });
}

function createSafeRenderCullGroups(root, { binSize = 32 } = {}) {
  const staticPrefixes = [
    'v2Boundary:',
    'v2StructuralFixture:',
    'v2WalkableSurface:',
    'v2Stairs:',
    'v2Ladder:',
    'v2PortalFrame:',
  ];
  const buckets = new Map();
  const candidates = [...root.children].filter((object) => (
    staticPrefixes.some((prefix) => object.name?.startsWith(prefix))
    && !object.name?.startsWith('v2DynamicSurfaceRoot:')
    && !object.name?.startsWith('v2GateMotionRoot:')
  ));
  for (const object of candidates) {
    object.updateWorldMatrix?.(true, true);
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) continue;
    const center = bounds.getCenter(new THREE.Vector3());
    const key = `${Math.floor(center.x / binSize)}:${Math.floor(center.z / binSize)}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(object);
    buckets.set(key, bucket);
  }

  const descriptors = [];
  for (const [key, objects] of [...buckets].sort(([left], [right]) => left.localeCompare(right))) {
    const renderGroup = new THREE.Group();
    renderGroup.name = `v2SafeRenderCullGroup:${key}`;
    renderGroup.userData.v2RenderCullPolicy = 'outside-120m-camera-proof-only';
    for (const object of objects) renderGroup.add(object);
    root.add(renderGroup);
    renderGroup.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(renderGroup);
    let drawObjectCount = 0;
    renderGroup.traverse((object) => {
      if (object.isMesh) drawObjectCount += 1;
    });
    descriptors.push({
      id: `v2-cull:${key}`,
      group: renderGroup,
      minX: bounds.min.x,
      maxX: bounds.max.x,
      minZ: bounds.min.z,
      maxZ: bounds.max.z,
      objectCount: objects.length,
      drawObjectCount,
      hideDistance: 132,
      showDistance: 124,
      maximumCameraRayDistance: 120,
      safetyMargin: 12,
      staticOnly: true,
    });
  }
  return descriptors;
}

function addStructuralBoundaries({
  plan,
  group,
  materials,
  registry,
  solidZones,
  aerialBoundaryZones,
  authoredPresentation = null,
}) {
  const gateBarrierIds = new Set([
    ...(plan.progression?.gateContracts ?? [])
      .map((gate) => gate.barrierBoundaryId ?? gate.barrierId)
      .filter(Boolean),
    ...(plan.actions ?? []).flatMap((action) => ['gate', 'open-gate', 'gate-control'].includes(action.type)
      ? action.barrierIds ?? []
      : []),
  ]);
  for (const boundary of plan.structuralBoundaries) {
    const usesAuthoredVisual = authoredPresentation?.boundaryIds.has(boundary.id) === true;
    const usesSemanticRoomPackVisual = authoredPresentation?.semanticBoundaryIds.has(boundary.id) === true;
    const segmentBounds = gateBarrierIds.has(boundary.id)
      ? [boundary.bounds]
      : splitBoundaryAroundOpenings(boundary);
    if (usesSemanticRoomPackVisual && segmentBounds.length !== 1) {
      throw fixedRoomAssemblyError(
        'DUNGEON_V2_SEMANTIC_ROOM_BOUNDARY_SPLIT_UNSUPPORTED',
        `Semantic room-pack boundary ${boundary.id} must remain its exact single manifest collider.`,
      );
    }
    if (usesSemanticRoomPackVisual
      && !(boundary.colliderId ?? boundary.colliderIds?.[0])) {
      throw fixedRoomAssemblyError(
        'DUNGEON_V2_SEMANTIC_ROOM_BOUNDARY_COLLIDER_ID_MISSING',
        `Semantic room-pack boundary ${boundary.id} has no manifest-owned collider ID.`,
      );
    }
    for (const [segmentIndex, bounds] of segmentBounds.entries()) {
      let mesh = null;
      if (!usesAuthoredVisual) {
        mesh = makeBoxMesh(
          bounds,
          materials.get({
            ...boundary,
            profileId: boundary.side === 'ceiling'
              ? 'ceiling'
              : boundary.side === 'floor'
                ? `${boundary.regionId}-floor`
                : 'wall',
            type: `structural-${boundary.side}`,
          }),
          `v2Boundary:${boundary.id}:segment:${segmentIndex}`,
        );
        mesh.userData.v2BoundaryId = boundary.id;
        mesh.userData.v2BoundarySegmentIndex = segmentIndex;
        mesh.userData.v2CellId = boundary.cellId;
        mesh.userData.v2BoundarySide = boundary.side;
        mesh.userData.v2BoundaryKind = boundary.kind;
        // Keep the accepted enclosure fully rendered and colliding without
        // submitting every split wall/ceiling panel to a second shadow-map
        // draw. Movable gate slabs remain casters so their state still reads.
        mesh.castShadow = gateBarrierIds.has(boundary.id);
        mesh.receiveShadow = true;
        mesh.userData.v2ShadowPolicy = mesh.castShadow
          ? 'movable-gate-caster'
          : 'enclosure-receiver-only';
        if (boundary.side !== 'floor') {
          markOpaqueCameraOcclusionSurface(mesh, 'opaque-enclosure');
        }
        group.add(mesh);
      }

      const collider = boundary.collider === false
        ? null
        : makeCollider(bounds, `v2BoundaryCollider:${boundary.id}:${segmentIndex}`, {
          regionId: boundary.regionId,
          cellId: boundary.cellId,
          obstacleKind: boundary.side === 'ceiling' ? 'ceiling' : 'boundaryWall',
          blocksPowerKnockback: boundary.side !== 'floor',
          allowFlyOver: boundary.side === 'floor',
          boundarySegmentIndex: segmentIndex,
          ...exactRuntimeCollisionShape(boundary),
        });
      registry.register(boundary.id, {
        visual: mesh,
        collider,
        colliderId: usesSemanticRoomPackVisual
          ? (boundary.colliderId ?? boundary.colliderIds?.[segmentIndex] ?? null)
          : null,
        role: `boundary:${boundary.side}`,
        regionId: boundary.regionId,
      });

      if (!collider) continue;
      if (gateBarrierIds.has(boundary.id)) {
        collider.active = true;
        collider.isGateBarrier = true;
        continue;
      }
      if (!['floor', 'ceiling'].includes(boundary.side)) solidZones.push(collider);
      if (boundary.side !== 'floor') aerialBoundaryZones.push(collider);
    }
  }
}

function deriveStairProfile(surface) {
  const nativeRamp = surface.shape === 'ramp-tile' && surface.ramp
    ? (() => {
        const directionLength = Math.hypot(surface.ramp.direction?.x, surface.ramp.direction?.z);
        if (directionLength <= EPSILON) {
          throw new Error(`Native fixed-room ramp ${surface.id} requires a non-zero direction.`);
        }
        const direction = {
          x: surface.ramp.direction.x / directionLength,
          z: surface.ramp.direction.z / directionLength,
        };
        const size = surface.size ?? {
          x: surface.bounds.max.x - surface.bounds.min.x,
          z: surface.bounds.max.z - surface.bounds.min.z,
        };
        const center = surface.center ?? {
          x: (surface.bounds.min.x + surface.bounds.max.x) * 0.5,
          z: (surface.bounds.min.z + surface.bounds.max.z) * 0.5,
        };
        const length = Math.abs(direction.x) >= Math.abs(direction.z) ? size.x : size.z;
        const width = Math.abs(direction.x) >= Math.abs(direction.z) ? size.z : size.x;
        return {
          start: {
            x: center.x - direction.x * length * 0.5,
            y: surface.ramp.startY,
            z: center.z - direction.z * length * 0.5,
          },
          end: {
            x: center.x + direction.x * length * 0.5,
            y: surface.ramp.endY,
            z: center.z + direction.z * length * 0.5,
          },
          width,
          maxRiser: 0.18,
          minimumTread: 0.45,
          ledgeClimbDisabled: true,
          sourceRamp: surface.ramp,
        };
      })()
    : null;
  const stairs = surface.stairs
    ?? (['stairs', 'walkable-stairs'].includes(surface.geometry?.type) ? surface.geometry : null)
    ?? (surface.form === 'stairs' ? surface : null)
    ?? nativeRamp;
  if (!stairs) return null;
  const start = stairs.start ?? stairs.path?.[0];
  const end = stairs.end ?? stairs.path?.[stairs.path.length - 1];
  if (!start || !end) {
    throw new Error(`Stair surface ${surface.id} requires explicit start/end or geometry.path.`);
  }
  finitePoint(start, `stair surface ${surface.id} path start`);
  finitePoint(end, `stair surface ${surface.id} path end`);
  const length = Math.hypot(end.x - start.x, end.z - start.z);
  if (length <= EPSILON) throw new Error(`Stair surface ${surface.id} has no horizontal run.`);
  const direction = {
    x: (end.x - start.x) / length,
    z: (end.z - start.z) / length,
  };
  const width = Number(stairs.width);
  const maximumRiser = Number(stairs.maxRiser ?? stairs.maximumRiser);
  const minimumTread = Number(stairs.minimumTread);
  const rise = Math.abs(end.y - start.y);
  if (!Number.isFinite(width) || width < 1.2) {
    throw new Error(`Stair surface ${surface.id} requires an explicit width of at least 1.2m.`);
  }
  if (!Number.isFinite(maximumRiser) || maximumRiser <= 0 || maximumRiser > 0.18 + EPSILON) {
    throw new Error(`Stair surface ${surface.id} requires maximumRiser no greater than 0.18m.`);
  }
  if (!Number.isFinite(minimumTread) || minimumTread < 0.45 - EPSILON) {
    throw new Error(`Stair surface ${surface.id} requires minimumTread of at least 0.45m.`);
  }
  const minimumStepCount = Math.max(1, Math.ceil(rise / maximumRiser - EPSILON));
  const maximumStepCount = Math.floor(length / minimumTread + EPSILON);
  const authoredStepCount = Number.isFinite(stairs.stepCount ?? stairs.steps)
    ? Math.trunc(stairs.stepCount ?? stairs.steps)
    : minimumStepCount;
  const stepCount = Math.max(minimumStepCount, authoredStepCount);
  if (maximumStepCount < minimumStepCount || stepCount > maximumStepCount) {
    throw new Error(`Stair surface ${surface.id} cannot satisfy ${maximumRiser}m risers and ${minimumTread}m treads across its ${rise.toFixed(3)}m rise and ${length.toFixed(3)}m run.`);
  }
  const actualRiser = rise / stepCount;
  const actualTread = length / stepCount;
  return {
    stairs,
    blocksBelow: surface.blocksBelow !== false,
    minimumStructuralY: Number.isFinite(surface.bounds?.min?.y)
      ? surface.bounds.min.y
      : Math.min(start.y, end.y),
    start,
    end,
    origin: { x: start.x, y: start.y, z: start.z },
    direction,
    tangent: { x: -direction.z, z: direction.x },
    length,
    width,
    rise,
    stepCount,
    maximumRiser,
    minimumTread,
    actualRiser,
    actualTread,
    continuousCollision: true,
    ledgeClimbDisabled: stairs.ledgeClimbDisabled !== false,
  };
}

function createStairProof(surface, profile = deriveStairProfile(surface)) {
  const baseY = Math.min(profile.start.y, profile.end.y);
  const deltaY = profile.end.y - profile.start.y;
  const yaw = Math.atan2(profile.direction.x, profile.direction.z);
  const visualSteps = Array.from({ length: profile.stepCount }, (_, index) => {
    const centerProgress = (index + 0.5) / profile.stepCount;
    const topProgress = (index + (deltaY >= 0 ? 1 : 0)) / profile.stepCount;
    const topY = THREE.MathUtils.lerp(profile.start.y, profile.end.y, topProgress);
    const height = Math.max(FLOOR_PANEL_THICKNESS, topY - baseY + FLOOR_PANEL_THICKNESS);
    return {
      index,
      center: {
        x: THREE.MathUtils.lerp(profile.start.x, profile.end.x, centerProgress),
        y: baseY - FLOOR_PANEL_THICKNESS + height * 0.5,
        z: THREE.MathUtils.lerp(profile.start.z, profile.end.z, centerProgress),
      },
      size: { x: profile.width, y: height, z: profile.actualTread + 0.01 },
      yaw,
      topY,
      riser: profile.actualRiser,
      tread: profile.actualTread,
    };
  });
  const sampleCount = Math.max(1, Math.ceil(profile.length / 0.21));
  const sampleSpacing = profile.length / sampleCount;
  const collisionSamples = [];
  const lateralSamples = [
    { offset: -profile.width * 0.5, expectedInside: true, kind: 'inside-left-edge' },
    { offset: 0, expectedInside: true, kind: 'inside-center' },
    { offset: profile.width * 0.5, expectedInside: true, kind: 'inside-right-edge' },
    { offset: -profile.width * 0.5 - 0.011, expectedInside: false, kind: 'outside-left' },
    { offset: profile.width * 0.5 + 0.011, expectedInside: false, kind: 'outside-right' },
  ];
  for (let index = 0; index <= sampleCount; index += 1) {
    const along = Math.min(profile.length, index * sampleSpacing);
    const progress = along / profile.length;
    const centerX = profile.start.x + profile.direction.x * along;
    const centerZ = profile.start.z + profile.direction.z * along;
    const elevation = THREE.MathUtils.lerp(profile.start.y, profile.end.y, progress);
    for (const lateral of lateralSamples) {
      collisionSamples.push({
        sampleId: `${index}:${lateral.kind}`,
        position: {
          x: centerX + profile.tangent.x * lateral.offset,
          y: elevation,
          z: centerZ + profile.tangent.z * lateral.offset,
        },
        along,
        lateral: lateral.offset,
        expectedInside: lateral.expectedInside,
      });
    }
  }
  return {
    surfaceId: surface.id,
    origin: clonePlain(profile.origin),
    end: clonePlain(profile.end),
    direction: clonePlain(profile.direction),
    tangent: clonePlain(profile.tangent),
    length: profile.length,
    width: profile.width,
    rise: profile.rise,
    stepCount: profile.stepCount,
    maximumRiser: profile.maximumRiser,
    minimumTread: profile.minimumTread,
    actualMaximumRiser: profile.actualRiser,
    actualTread: profile.actualTread,
    collisionSampleSpacing: sampleSpacing,
    collisionSamples,
    continuousCollision: true,
    ledgeClimbDisabled: profile.ledgeClimbDisabled,
    visualSteps,
    collision: {
      type: 'continuous-sampled-ramp',
      origin: clonePlain(profile.origin),
      end: clonePlain(profile.end),
      direction: clonePlain(profile.direction),
      length: profile.length,
      width: profile.width,
      sampleSpacing,
      samples: collisionSamples,
      ledgeClimbDisabled: profile.ledgeClimbDisabled,
    },
    accepted: profile.actualRiser <= profile.maximumRiser + EPSILON
      && profile.actualTread >= profile.minimumTread - EPSILON,
  };
}

function surfaceElevationAt(surface, worldX, worldZ) {
  const profile = deriveStairProfile(surface);
  if (!profile) return surface.bounds.max.y;
  const { start, end, direction, length } = profile;
  const distance = (worldX - start.x) * (direction.x || 0) + (worldZ - start.z) * (direction.z || 0);
  return THREE.MathUtils.lerp(start.y, end.y, THREE.MathUtils.clamp(distance / length, 0, 1));
}

function sampleExactStairSurface(profile, position, tolerance = 0.001) {
  const offsetX = position.x - profile.start.x;
  const offsetZ = position.z - profile.start.z;
  const along = offsetX * profile.direction.x + offsetZ * profile.direction.z;
  const lateral = offsetX * profile.tangent.x + offsetZ * profile.tangent.z;
  const inside = along >= -tolerance
    && along <= profile.length + tolerance
    && Math.abs(lateral) <= profile.width * 0.5 + tolerance;
  return {
    inside,
    along,
    lateral,
    elevation: inside
      ? THREE.MathUtils.lerp(
        profile.start.y,
        profile.end.y,
        THREE.MathUtils.clamp(along / profile.length, 0, 1),
      )
      : null,
  };
}

function createFloorTilesForSurface(surface, tileSize, ladderOpenings = []) {
  const bounds = normalizeBounds(surface.bounds, `walkable surface ${surface.id}`);
  const tiles = [];
  const minTileX = Math.ceil((bounds.min.x - tileSize * 0.5) / tileSize);
  const maxTileX = Math.floor((bounds.max.x + tileSize * 0.5) / tileSize);
  const minTileZ = Math.ceil((bounds.min.z - tileSize * 0.5) / tileSize);
  const maxTileZ = Math.floor((bounds.max.z + tileSize * 0.5) / tileSize);
  const isStairs = Boolean(
    surface.stairs
    || surface.form === 'stairs'
    || ['stairs', 'walkable-stairs'].includes(surface.geometry?.type)
    || surface.shape === 'ramp-tile'
  );
  const stairProfile = isStairs ? deriveStairProfile(surface) : null;

  for (let x = minTileX; x <= maxTileX; x += 1) {
    for (let z = minTileZ; z <= maxTileZ; z += 1) {
      const worldX = x * tileSize;
      const worldZ = z * tileSize;
      if (worldX < bounds.min.x - tileSize * 0.45
        || worldX > bounds.max.x + tileSize * 0.45
        || worldZ < bounds.min.z - tileSize * 0.45
        || worldZ > bounds.max.z + tileSize * 0.45) {
        continue;
      }
      if (stairProfile) {
        const offsetX = worldX - stairProfile.start.x;
        const offsetZ = worldZ - stairProfile.start.z;
        const along = offsetX * stairProfile.direction.x + offsetZ * stairProfile.direction.z;
        const lateral = Math.abs(offsetX * stairProfile.tangent.x + offsetZ * stairProfile.tangent.z);
        if (along < -tileSize * 0.45
          || along > stairProfile.length + tileSize * 0.45
          || lateral > stairProfile.width * 0.5 + tileSize * 0.45) {
          continue;
        }
      }
      const elevation = surfaceElevationAt(surface, worldX, worldZ);
      const occupiesLadderOpening = ladderOpenings.some((opening) => (
        elevation >= opening.bounds.min.y - 0.05
        && elevation <= opening.bounds.max.y + 0.05
        && worldX >= opening.bounds.min.x - EPSILON
        && worldX <= opening.bounds.max.x + EPSILON
        && worldZ >= opening.bounds.min.z - EPSILON
        && worldZ <= opening.bounds.max.z + EPSILON
      ));
      if (occupiesLadderOpening) continue;
      const tile = {
        id: `${surface.id}:tile:${x}:${z}`,
        x,
        z,
        elevation,
        level: surface.elevationBand ?? Math.round(elevation / tileSize),
        roomId: surface.regionId,
        regionId: surface.regionId,
        cellId: surface.cellId,
        surfaceId: surface.id,
        surface: isStairs ? 'industrialRamp' : (surface.surfaceType ?? 'dungeonV2Floor'),
        gameplayPurpose: surface.purpose,
        hazardTag: surface.hazardTag ?? null,
        blocksEnemyNavigation: Boolean(surface.hazardTag),
      };
      if (isStairs) {
        const halfAxisX = stairProfile.direction.x * tileSize * 0.5;
        const halfAxisZ = stairProfile.direction.z * tileSize * 0.5;
        tile.rampOriginX = stairProfile.origin.x;
        tile.rampOriginY = stairProfile.origin.y;
        tile.rampOriginZ = stairProfile.origin.z;
        tile.rampDirectionX = stairProfile.direction.x;
        tile.rampDirectionZ = stairProfile.direction.z;
        tile.rampLength = stairProfile.length;
        tile.rampWidth = stairProfile.width;
        tile.rampStartElevation = surfaceElevationAt(surface, worldX - halfAxisX, worldZ - halfAxisZ);
        tile.rampEndElevation = surfaceElevationAt(surface, worldX + halfAxisX, worldZ + halfAxisZ);
        tile.groundedStepTransitionHeight = stairProfile.actualRiser;
        tile.actualMaximumRiser = stairProfile.actualRiser;
        tile.actualTread = stairProfile.actualTread;
        tile.ledgeClimbDisabled = stairProfile.ledgeClimbDisabled;
      }
      tiles.push(tile);
    }
  }
  return tiles;
}

function addStairVisual(group, surface, materials) {
  normalizeBounds(surface.bounds, `stair surface ${surface.id}`);
  const profile = deriveStairProfile(surface);
  const { start, end, width } = profile;
  const signedRise = end.y - start.y;
  const slopeLength = Math.hypot(profile.length, signedRise);
  const panelCount = Math.max(1, Math.ceil(profile.length / STRUCTURAL_TEXTURE_TILE_SCALE_METRES));
  const horizontalPanelRun = profile.length / panelCount;
  const slopePanelLength = slopeLength / panelCount;
  const panelThickness = FLOOR_PANEL_THICKNESS;
  const slopeAxis = new THREE.Vector3(
    profile.direction.x * profile.length / slopeLength,
    signedRise / slopeLength,
    profile.direction.z * profile.length / slopeLength,
  );
  // Local X points across the ramp, local Z follows the exact walkable line,
  // and local Y remains the upward-facing surface normal for either ascent
  // direction. This explicit basis avoids Euler-order drift on diagonal runs.
  const widthAxis = new THREE.Vector3(
    -profile.tangent.x,
    0,
    -profile.tangent.z,
  ).normalize();
  const surfaceNormal = new THREE.Vector3().crossVectors(slopeAxis, widthAxis).normalize();
  if (surfaceNormal.y < 0) {
    widthAxis.multiplyScalar(-1);
    surfaceNormal.crossVectors(slopeAxis, widthAxis).normalize();
  }
  const frame = new THREE.Matrix4().makeBasis(widthAxis, surfaceNormal, slopeAxis);
  const frameQuaternion = new THREE.Quaternion().setFromRotationMatrix(frame);
  const requestedPanelMaterial = materials.get({
    ...surface,
    profileId: surface.visualProfile ?? surface.materialProfileId ?? `${surface.regionId}-floor`,
    type: surface.geometry?.type ?? surface.form ?? 'walkable-floor',
  });
  // A hazard-region identifier resolves to V1's untextured hazard-stripe
  // accent. That is appropriate for warning trim, not an entire traversal
  // surface. Every ramp panel must retain a real V1 floor texture; hazard
  // signaling remains on the plan-owned hazard surfaces around it.
  const material = materialUsesTexture(requestedPanelMaterial)
    ? requestedPanelMaterial
    : materials.get('raisedDeck');
  const root = new THREE.Group();
  root.name = `v2Stairs:${surface.id}`;
  root.userData.v2StairProof = clonePlain(profile);
  root.userData.v2ContinuousWalkableIncline = true;
  root.userData.v2RampPanelContract = {
    source: 'DungeonGenerator._createFloorTileMesh',
    sourceStyle: 'v1-industrial-ramp-tiles',
    tileWorldSize: STRUCTURAL_TEXTURE_TILE_SCALE_METRES,
    panelCount,
    horizontalPanelRun,
    slopePanelLength,
    panelThickness,
    start: clonePlain(start),
    end: clonePlain(end),
    collisionAuthority: 'plan-owned-continuous-oriented-ramp-strip',
    requestedMaterialProfile: requestedPanelMaterial.name,
    panelMaterialProfile: material.name,
    gapTolerance: 0.001,
  };

  // V1 presents an industrial incline as consecutive 2.8m floor tiles. Use
  // the same visible cadence, but size each thin box along the true slope so
  // adjacent panels meet exactly and the first/last top edges remain flush
  // with their authored landing elevations. One instanced draw keeps the V2
  // performance improvement while restoring readable panel scale.
  const { geometry: panelGeometry, metadata: panelTextureTiling } = createWorldTiledBoxGeometry(
    new THREE.Vector3(width, panelThickness, slopePanelLength),
    material,
  );
  const panels = new THREE.InstancedMesh(panelGeometry, material, panelCount);
  panels.name = `${root.name}:v1-ramp-panels`;
  panels.userData.v2V1RampPanelBatch = true;
  panels.userData.v2SurfaceId = surface.id;
  panels.userData.v2TextureTiling = clonePlain(panelTextureTiling);
  panels.userData.v2RampPanels = [];
  const instanceMatrix = new THREE.Matrix4();
  for (let index = 0; index < panelCount; index += 1) {
    const startProgress = index / panelCount;
    const endProgress = (index + 1) / panelCount;
    const centerProgress = (startProgress + endProgress) * 0.5;
    const surfaceCenter = new THREE.Vector3(
      THREE.MathUtils.lerp(start.x, end.x, centerProgress),
      THREE.MathUtils.lerp(start.y, end.y, centerProgress),
      THREE.MathUtils.lerp(start.z, end.z, centerProgress),
    );
    const objectCenter = surfaceCenter.clone().addScaledVector(surfaceNormal, -panelThickness * 0.5);
    instanceMatrix.compose(objectCenter, frameQuaternion, new THREE.Vector3(1, 1, 1));
    panels.setMatrixAt(index, instanceMatrix);
    panels.userData.v2RampPanels.push({
      index,
      start: {
        x: THREE.MathUtils.lerp(start.x, end.x, startProgress),
        y: THREE.MathUtils.lerp(start.y, end.y, startProgress),
        z: THREE.MathUtils.lerp(start.z, end.z, startProgress),
      },
      end: {
        x: THREE.MathUtils.lerp(start.x, end.x, endProgress),
        y: THREE.MathUtils.lerp(start.y, end.y, endProgress),
        z: THREE.MathUtils.lerp(start.z, end.z, endProgress),
      },
      horizontalRun: horizontalPanelRun,
      slopeLength: slopePanelLength,
    });
  }
  panels.instanceMatrix.needsUpdate = true;
  panels.computeBoundingBox();
  panels.computeBoundingSphere();
  panels.castShadow = false;
  panels.receiveShadow = true;
  panels.userData.v2ShadowPolicy = 'v1-scale-ramp-panels-receiver-only';
  root.add(panels);

  // Two continuous steel stringers make the load path readable without
  // inventing a second collision surface. They remain inside the accepted
  // oriented ramp strip and explicitly name that surface/boundary authority.
  const stringerWidth = Math.min(0.22, width * 0.08);
  const stringerDepth = 0.28;
  const supportMaterial = materials.get({
    ...surface,
    profileId: 'support',
    type: 'continuous-stair-stringer',
  });
  const { geometry: stringerGeometry } = createWorldTiledBoxGeometry(
    new THREE.Vector3(stringerWidth, stringerDepth, slopeLength),
    supportMaterial,
  );
  const stringers = new THREE.InstancedMesh(stringerGeometry, supportMaterial, 2);
  stringers.name = `${root.name}:load-bearing-stringers`;
  stringers.userData.v2StairSupport = true;
  stringers.userData.v2SurfaceId = surface.id;
  stringers.userData.v2SupportBoundaryIds = [...surface.supportBoundaryIds];
  stringers.userData.v2SupportProfile = surface.supportProfile ?? 'continuous-stair-stringers-v2';
  stringers.userData.v2CollisionAuthority = `${surface.id}:sampled-ramp-collider`;
  const routeCenter = new THREE.Vector3(
    (start.x + end.x) * 0.5,
    (start.y + end.y) * 0.5,
    (start.z + end.z) * 0.5,
  ).addScaledVector(surfaceNormal, -(panelThickness + stringerDepth * 0.5));
  const lateralOffset = Math.max(0, width * 0.5 - stringerWidth * 0.75);
  for (const [index, side] of [-1, 1].entries()) {
    const stringerCenter = routeCenter.clone().addScaledVector(widthAxis, lateralOffset * side);
    instanceMatrix.compose(stringerCenter, frameQuaternion, new THREE.Vector3(1, 1, 1));
    stringers.setMatrixAt(index, instanceMatrix);
  }
  stringers.instanceMatrix.needsUpdate = true;
  stringers.computeBoundingBox();
  stringers.computeBoundingSphere();
  stringers.castShadow = false;
  stringers.receiveShadow = true;
  stringers.userData.v2ShadowPolicy = 'load-bearing-stringer-receiver-only';
  root.add(stringers);

  group.add(root);
  return root;
}

function addCrumbleCrackOverlay(surfaceObject, surface, bounds, materials) {
  const overlay = new THREE.Group();
  overlay.name = `v2CrumbleCracks:${surface.id}`;
  overlay.userData.v2SurfaceId = surface.id;
  overlay.userData.v2StructuralRole = 'crumble-crack-telegraph';
  const material = materials.createCrumbleCrack(surface.id);
  const span = Math.max(0.8, Math.min(bounds.size.x, bounds.size.z));
  const seams = [
    { x: -0.18, z: -0.08, length: 0.52, angle: 0.24 },
    { x: 0.16, z: 0.03, length: 0.46, angle: -0.62 },
    { x: -0.03, z: 0.2, length: 0.4, angle: 1.02 },
    { x: 0.06, z: -0.22, length: 0.34, angle: -1.14 },
    { x: -0.28, z: 0.24, length: 0.26, angle: 0.68 },
  ];
  for (const [index, seam] of seams.entries()) {
    const seamSize = new THREE.Vector3(
      span * seam.length,
      0.025,
      Math.max(0.045, span * 0.012),
    );
    const { geometry, metadata } = createWorldTiledBoxGeometry(seamSize, material);
    const mesh = new THREE.Mesh(
      geometry,
      material,
    );
    mesh.name = `${overlay.name}:seam:${index}`;
    mesh.position.set(
      bounds.size.x * seam.x,
      bounds.size.y * 0.5 + 0.018,
      bounds.size.z * seam.z,
    );
    mesh.rotation.y = seam.angle;
    if (metadata) mesh.userData.v2TextureTiling = clonePlain(metadata);
    overlay.add(mesh);
  }
  overlay.visible = false;
  surfaceObject.add(overlay);
  return overlay;
}

function addWalkableSurfaces({
  plan,
  group,
  materials,
  registry,
  resources,
  floorTiles,
  platforms,
  authoredPresentation = null,
  allowInvalidPreview = false,
}) {
  const ladderOpenings = plan.walkableSurfaces
    .filter((surface) => surface.geometry?.type === 'ladder' && surface.geometry.topOpening?.bounds)
    .map((surface) => ({
      ladderSurfaceId: surface.id,
      bounds: clonePlain(surface.geometry.topOpening.bounds),
    }));
  const mechanismBySurfaceId = new Map();
  for (const mechanism of plan.mechanisms ?? []) {
    const runtime = mechanism.runtime ?? mechanism.runtimeProfile ?? mechanism.controller ?? mechanism.behavior ?? {};
    for (const surfaceId of [runtime.surfaceId, runtime.dynamicSurfaceId, ...(runtime.surfaceIds ?? [])].filter(Boolean)) {
      mechanismBySurfaceId.set(surfaceId, mechanism.id);
    }
  }

  for (const surface of plan.walkableSurfaces) {
    const bounds = normalizeBounds(surface.bounds, `walkable surface ${surface.id}`);
    const dynamic = surface.collision === 'dynamic';
    const isStairs = Boolean(
      surface.stairs
      || surface.form === 'stairs'
      || ['stairs', 'walkable-stairs'].includes(surface.geometry?.type)
      || surface.shape === 'ramp-tile'
    );
    const isLadderSurface = surface.geometry?.type === 'ladder';
    let usesAuthoredVisual = authoredPresentation?.surfaceIds.has(surface.id) === true;
    let usesLegacyFixedRoomVisual = authoredPresentation?.legacySurfaceIds.has(surface.id) === true;
    let usesSemanticRoomPackVisual = authoredPresentation?.semanticSurfaceIds.has(surface.id) === true;
    if (allowInvalidPreview && usesAuthoredVisual && !registry.getVisual(surface.id)) {
      usesAuthoredVisual = false;
      usesLegacyFixedRoomVisual = false;
      usesSemanticRoomPackVisual = false;
    }
    if (usesLegacyFixedRoomVisual && (dynamic || isLadderSurface || surface.hazardTag)) {
      throw fixedRoomAssemblyError(
        'DUNGEON_V2_FIXED_ROOM_MUTABLE_SURFACE_UNSUPPORTED',
        `Fixed-room surface ${surface.id} must remain static presentation with plan-owned collision.`,
      );
    }
    if (usesSemanticRoomPackVisual && isLadderSurface) {
      throw fixedRoomAssemblyError(
        'DUNGEON_V2_SEMANTIC_ROOM_LADDER_SURFACE_UNSUPPORTED',
        `Semantic room-pack surface ${surface.id} cannot replace the plan-owned ladder traversal contract.`,
      );
    }
    const semanticColliderId = usesSemanticRoomPackVisual
      ? (surface.colliderId ?? surface.colliderIds?.[0] ?? null)
      : null;
    if (usesSemanticRoomPackVisual && !semanticColliderId) {
      throw fixedRoomAssemblyError(
        'DUNGEON_V2_SEMANTIC_ROOM_SURFACE_COLLIDER_ID_MISSING',
        `Semantic room-pack surface ${surface.id} has no manifest-owned collider ID.`,
      );
    }
    let object;
    if (isStairs) {
      if (dynamic) throw new Error(`Stair surface ${surface.id} cannot use dynamic collision.`);
      object = usesAuthoredVisual
        ? registry.getVisual(surface.id)
        : addStairVisual(group, surface, materials);
    } else if (isLadderSurface) {
      const geometry = surface.geometry;
      const start = geometry.start ?? geometry.path?.[0];
      const end = geometry.end ?? geometry.path?.[geometry.path.length - 1];
      const planeStart = geometry.planePath?.[0];
      const planeEnd = geometry.planePath?.[geometry.planePath.length - 1];
      if (!start || !end) throw new Error(`Ladder surface ${surface.id} requires explicit geometry.path.`);
      if (!planeStart || !planeEnd) throw new Error(`Ladder surface ${surface.id} requires explicit geometry.planePath.`);
      const bottom = start.y <= end.y ? start : end;
      const top = start.y > end.y ? start : end;
      const planeBottom = planeStart.y <= planeEnd.y ? planeStart : planeEnd;
      const planeTop = planeStart.y > planeEnd.y ? planeStart : planeEnd;
      if (top.y - bottom.y < 1) {
        throw new Error(`Ladder surface ${surface.id} must span at least one vertical metre.`);
      }
      const horizontalRun = Math.hypot(top.x - bottom.x, top.z - bottom.z);
      if (horizontalRun > 0.25) {
        throw new Error(`Ladder surface ${surface.id} path must be vertical; horizontal run is ${horizontalRun.toFixed(3)}m.`);
      }
      const facing = normalizeHorizontalFacing(
        geometry.climbFacing ?? geometry.facing,
        `ladder surface ${surface.id} climbFacing`,
      );
      const planeNormal = normalizeHorizontalFacing(
        geometry.planeNormal,
        `ladder surface ${surface.id} planeNormal`,
      );
      const bodyClearance = Number(geometry.bodyClearance);
      if (!Number.isFinite(bodyClearance) || bodyClearance < 0.35) {
        throw new Error(`Ladder surface ${surface.id} requires at least 0.35m player-root body clearance.`);
      }
      if (facing.x * planeNormal.x + facing.z * planeNormal.z > -0.999) {
        throw new Error(`Ladder surface ${surface.id} planeNormal must oppose climbFacing.`);
      }
      for (const [rootPoint, planePoint, endpointName] of [
        [bottom, planeBottom, 'bottom'],
        [top, planeTop, 'top'],
      ]) {
        const deltaX = rootPoint.x - planePoint.x;
        const deltaZ = rootPoint.z - planePoint.z;
        const normalDistance = deltaX * planeNormal.x + deltaZ * planeNormal.z;
        const tangentDistance = Math.abs(deltaX * -planeNormal.z + deltaZ * planeNormal.x);
        if (Math.abs(normalDistance - bodyClearance) > 0.01 || tangentDistance > 0.01) {
          throw new Error(`Ladder surface ${surface.id} ${endpointName} root path is not bodyClearance from its plane.`);
        }
      }
      const ladderWidth = geometry.width ?? 1.6;
      const mountRadius = geometry.mountRadius ?? geometry.mountClearance ?? 1.4;
      const maximumTraversalSpan = Math.max(3, ladderWidth + mountRadius * 2 + 0.5);
      if (bounds.size.x > maximumTraversalSpan || bounds.size.z > maximumTraversalSpan) {
        throw new Error(`Ladder surface ${surface.id} traversal bounds are not narrowly authored around the ladder.`);
      }
      const ladder = {
        id: `${surface.id}:ladder`,
        label: geometry.label ?? 'Service Ladder',
        position: new THREE.Vector3(bottom.x, bottom.y, bottom.z),
        center: { x: (bottom.x + top.x) * 0.5, z: (bottom.z + top.z) * 0.5 },
        planeCenter: {
          x: (planeBottom.x + planeTop.x) * 0.5,
          z: (planeBottom.z + planeTop.z) * 0.5,
        },
        planeNormal,
        bodyClearance,
        rootPath: geometry.path.map((point) => ({ ...point })),
        planePath: geometry.planePath.map((point) => ({ ...point })),
        bottomY: bottom.y,
        topY: top.y,
        width: ladderWidth,
        facing,
        bottomExit: asVector3(geometry.bottomExit ?? bottom, `${surface.id} bottom exit`),
        topExit: asVector3(geometry.topExit ?? top, `${surface.id} top exit`),
        bottomExitFacing: normalizeHorizontalFacing(
          geometry.bottomExitFacing ?? planeNormal,
          `${surface.id} bottom exit facing`,
        ),
        topExitFacing: normalizeHorizontalFacing(
          geometry.topExitFacing ?? facing,
          `${surface.id} top exit facing`,
        ),
        topOpening: clonePlain(geometry.topOpening),
        landings: clonePlain(geometry.landings),
        mountRadius,
        surfaceId: surface.id,
      };
      object = createLadderObject(ladder, materials.get({ ...surface, profileId: 'support', type: 'ladder-support' }));
      ladder.object = object;
      resources.ladders.push(ladder);
      group.add(object);
    } else {
      if (usesAuthoredVisual) {
        object = registry.getVisual(surface.id);
      } else if (dynamic) {
        object = new THREE.Group();
        object.name = `v2DynamicSurfaceRoot:${surface.id}`;
        object.position.copy(bounds.center);
        const panelThickness = Math.min(FLOOR_PANEL_THICKNESS, bounds.size.y);
        const panelMaterial = materials.get({
          ...surface,
          profileId: surface.visualProfile ?? surface.materialProfileId ?? `${surface.regionId}-floor`,
          type: 'walkable-stairs',
        });
        const { geometry: panelGeometry, metadata: panelTextureTiling } = createWorldTiledBoxGeometry(
          new THREE.Vector3(bounds.size.x, panelThickness, bounds.size.z),
          panelMaterial,
        );
        const panel = new THREE.Mesh(panelGeometry, panelMaterial);
        panel.name = `v2WalkableSurface:${surface.id}:panel`;
        panel.position.y = bounds.size.y * 0.5 - panelThickness * 0.5;
        if (panelTextureTiling) panel.userData.v2TextureTiling = clonePlain(panelTextureTiling);
        panel.castShadow = true;
        panel.receiveShadow = true;
        object.add(panel);
      } else {
        const renderBounds = {
          min: { ...surface.bounds.min, y: bounds.max.y - Math.min(FLOOR_PANEL_THICKNESS, bounds.size.y) },
          max: { ...surface.bounds.max },
        };
        object = makeBoxMesh(
          renderBounds,
          materials.get({
            ...surface,
            profileId: surface.visualProfile ?? surface.materialProfileId ?? `${surface.regionId}-floor`,
            type: surface.geometry?.type ?? surface.form ?? 'walkable-floor',
          }),
          `v2WalkableSurface:${surface.id}`,
        );
        object.castShadow = false;
        object.receiveShadow = true;
        object.userData.v2ShadowPolicy = 'walkable-structure-receiver-only';
      }
      if (!usesAuthoredVisual) group.add(object);
    }
    if (!object) {
      throw fixedRoomAssemblyError(
        'DUNGEON_V2_AUTHORED_SURFACE_VISUAL_MISSING',
        `Authored surface ${surface.id} has no registered presentation visual.`,
      );
    }
    if (!usesAuthoredVisual) {
      object.userData.v2SurfaceId = surface.id;
      object.userData.v2GameplayPurpose = surface.purpose;
      object.userData.v2SupportBoundaryIds = [...surface.supportBoundaryIds];
      if (!isLadderSurface && (isStairs || surface.supportFixtureIds?.length)) {
        object.traverse((child) => {
          if (!child.isMesh) return;
          markOpaqueCameraOcclusionSurface(child, 'elevated-catwalk');
        });
      }
    }

    const platformCenter = bounds.center.clone();
    const platform = {
      id: surface.id,
      // `position` is the canonical collider center consumed by independent
      // assembly proofs; keep `center` as the same Vector3 for the legacy
      // dynamic-platform compatibility facade.
      position: platformCenter,
      center: platformCenter,
      bounds: {
        min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
        max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
      },
      halfWidth: bounds.size.x * 0.5,
      halfDepth: bounds.size.z * 0.5,
      verticalHalfHeight: bounds.size.y * 0.5,
      topY: bounds.max.y,
      baseY: bounds.min.y,
      height: bounds.size.y,
      blocksBelow: surface.blocksBelow !== false,
      createsLedgeCandidates: surface.createsLedgeCandidates !== false,
      dynamic,
      enabled: true,
      regionId: surface.regionId,
      gameplayPurpose: surface.purpose,
      obstacleKind: 'floor',
      supportBoundaryIds: [...surface.supportBoundaryIds],
    };
    resources.surfaceObjects.set(surface.id, object);

    if (isStairs) {
      const stairProfile = deriveStairProfile(surface);
      const stairProof = createStairProof(surface, stairProfile);
      const stairTiles = createFloorTilesForSurface(
        surface,
        plan.tileSize ?? DEFAULT_TILE_SIZE,
        ladderOpenings,
      );
      object.updateWorldMatrix(true, true);
      const visualBounds = usesAuthoredVisual
        ? new THREE.Box3(
            new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
            new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
          )
        : new THREE.Box3().setFromObject(object);
      const visualCenter = visualBounds.getCenter(new THREE.Vector3());
      const visualSize = visualBounds.getSize(new THREE.Vector3());
      floorTiles.push(...stairTiles);
      resources.stairProofs.set(surface.id, stairProof);
      resources.stairProfiles.set(surface.id, stairProfile);
      registry.register(surface.id, {
        visual: usesAuthoredVisual ? null : object,
        collider: {
          id: `${surface.id}:sampled-ramp-collider`,
          position: visualCenter,
          halfWidth: visualSize.x * 0.5,
          halfDepth: visualSize.z * 0.5,
          verticalHalfHeight: visualSize.y * 0.5,
          bounds: {
            min: { x: visualBounds.min.x, y: visualBounds.min.y, z: visualBounds.min.z },
            max: { x: visualBounds.max.x, y: visualBounds.max.y, z: visualBounds.max.z },
          },
          surfaceType: 'exact-oriented-ramp-strip',
          obstacleKind: 'floor',
          shape: 'oriented-ramp-strip',
          rampOrigin: clonePlain(stairProfile.origin),
          rampDirection: clonePlain(stairProfile.direction),
          rampLength: stairProfile.length,
          rampWidth: stairProfile.width,
          collisionSampleSpacing: stairProof.collisionSampleSpacing,
          collisionSamples: clonePlain(stairProof.collisionSamples),
          stepCount: stairProfile.stepCount,
          actualMaximumRiser: stairProfile.actualRiser,
          actualTread: stairProfile.actualTread,
          ledgeClimbDisabled: stairProfile.ledgeClimbDisabled,
          floorTileIds: stairTiles.map((tile) => tile.id),
          active: true,
        },
        colliderId: semanticColliderId,
        role: 'walkable-surface:stairs',
        regionId: surface.regionId,
      });
    } else if (isLadderSurface) {
      object.updateWorldMatrix(true, true);
      const visualBounds = new THREE.Box3().setFromObject(object);
      const visualCenter = visualBounds.getCenter(new THREE.Vector3());
      const visualSize = visualBounds.getSize(new THREE.Vector3());
      registry.register(surface.id, {
        visual: object,
        collider: {
          id: `${surface.id}:ladder-traversal-volume`,
          position: visualCenter,
          halfWidth: visualSize.x * 0.5,
          halfDepth: visualSize.z * 0.5,
          verticalHalfHeight: visualSize.y * 0.5,
          bounds: {
            min: { x: visualBounds.min.x, y: visualBounds.min.y, z: visualBounds.min.z },
            max: { x: visualBounds.max.x, y: visualBounds.max.y, z: visualBounds.max.z },
          },
          surfaceType: 'ladder-traversal-volume',
          obstacleKind: 'floor',
          active: true,
        },
        role: 'walkable-surface:ladder',
        regionId: surface.regionId,
      });
    } else if (dynamic) {
      resources.platformSurfaces.set(surface.id, platform);
      platforms.push(platform);
      const mechanismId = surface.controllerId
        ?? surface.mechanismId
        ?? mechanismBySurfaceId.get(surface.id);
      if (!mechanismId) {
        throw new Error(`Dynamic surface ${surface.id} has no explicit mechanism/controller binding.`);
      }
      resources.dynamicSurfaces.set(surface.id, platform);
      if (!resources.dynamicSurfaceByController.has(mechanismId)) {
        resources.dynamicSurfaceByController.set(mechanismId, platform);
      }
      if (!resources.mechanismObjects.has(mechanismId)) {
        resources.mechanismObjects.set(mechanismId, object);
      }
      if (surface.geometry?.type === 'crumble') {
        const overlay = addCrumbleCrackOverlay(object, surface, bounds, materials);
        resources.crumbleOverlays.set(mechanismId, overlay);
      }
      registry.register(surface.id, {
        visual: usesAuthoredVisual ? null : object,
        collider: platform,
        colliderId: semanticColliderId,
        role: 'walkable-surface:dynamic',
        regionId: surface.regionId,
      });
    } else {
      resources.platformSurfaces.set(surface.id, platform);
      platforms.push(platform);
      floorTiles.push(...createFloorTilesForSurface(
        surface,
        plan.tileSize ?? DEFAULT_TILE_SIZE,
        ladderOpenings,
      ));
      registry.register(surface.id, {
        visual: usesAuthoredVisual ? null : object,
        collider: platform,
        colliderId: semanticColliderId,
        role: 'walkable-surface:static',
        regionId: surface.regionId,
      });
    }

    if (surface.hazardTag) {
      resources.hazardObjects.set(surface.hazardId ?? surface.id, object);
    }
  }
}

function createLadderObject(ladder, material) {
  const group = new THREE.Group();
  group.name = `v2Ladder:${ladder.id}`;
  const height = ladder.topY - ladder.bottomY;
  const topGuideHeight = 1.15;
  const width = ladder.width ?? 1.05;
  const facing = ladder.facing;
  const tangent = new THREE.Vector3(-facing.z, 0, facing.x);
  const planeCenter = ladder.planeCenter ?? ladder.center;
  const center = new THREE.Vector3(planeCenter.x, ladder.bottomY + height * 0.5, planeCenter.z);
  for (const sign of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, height + topGuideHeight, 10),
      material,
    );
    rail.position.copy(center)
      .addScaledVector(tangent, sign * width * 0.5)
      .add(new THREE.Vector3(0, topGuideHeight * 0.5, 0));
    rail.castShadow = false;
    rail.receiveShadow = true;
    rail.userData.v2ShadowPolicy = 'ladder-receiver-only';
    group.add(rail);
  }
  const rungCount = Math.max(2, Math.floor(height / 0.34));
  for (let index = 0; index <= rungCount; index += 1) {
    const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, width, 8), material);
    rung.rotation.z = Math.PI * 0.5;
    rung.rotation.y = Math.atan2(tangent.z, tangent.x);
    rung.position.set(
      planeCenter.x,
      THREE.MathUtils.lerp(ladder.bottomY + 0.2, ladder.topY - 0.2, index / rungCount),
      planeCenter.z,
    );
    rung.castShadow = false;
    rung.receiveShadow = true;
    rung.userData.v2ShadowPolicy = 'ladder-receiver-only';
    group.add(rung);
  }
  group.userData.v2LadderPlane = {
    center: { x: planeCenter.x, z: planeCenter.z },
    normal: ladder.planeNormal ? { ...ladder.planeNormal } : null,
    bodyClearance: Number(ladder.bodyClearance) || 0,
    climbFacing: ladder.facing ? { ...ladder.facing } : null,
  };
  group.userData.v2LadderOpening = clonePlain(ladder.topOpening);
  group.userData.v2LadderLandings = clonePlain(ladder.landings);
  return group;
}

function addLadders({ plan, group, materials, registry }) {
  const ladders = [];
  for (const portal of plan.portals) {
    if (portal.traversal?.mode !== 'ladder' || !portal.traversal?.ladder) continue;
    const traversal = portal.traversal;
    const bottom = traversal.ladder.bottom;
    const top = traversal.ladder.top;
    if (!bottom || !top) throw new Error(`Portal ${portal.id} ladder contract requires bottom and top points.`);
    const horizontalRun = Math.hypot(top.x - bottom.x, top.z - bottom.z);
    if (horizontalRun > 0.25) {
      throw new Error(`Portal ${portal.id} ladder path must be vertical; horizontal run is ${horizontalRun.toFixed(3)}m.`);
    }
    const facing = normalizeHorizontalFacing(
      traversal.ladder.facing ?? portal.from.facing,
      `portal ${portal.id} ladder facing`,
    );
    const center = traversal.ladder.center ?? {
      x: (bottom.x + top.x) * 0.5,
      z: (bottom.z + top.z) * 0.5,
    };
    const ladder = {
      id: traversal.ladder.id ?? `${portal.id}:ladder`,
      label: traversal.ladder.label ?? 'Service Ladder',
      position: new THREE.Vector3(center.x, bottom.y, center.z),
      bottomY: bottom.y,
      topY: top.y,
      center: { x: center.x, z: center.z },
      facing,
      bottomExit: asVector3(traversal.ladder.bottomExit ?? bottom, `${portal.id} bottom ladder exit`),
      topExit: asVector3(traversal.ladder.topExit ?? top, `${portal.id} top ladder exit`),
      mountRadius: Number(traversal.ladder.mountRadius) || 1.1,
      width: Number(traversal.ladder.width) || 1.05,
      portalId: portal.id,
    };
    if (ladder.topY - ladder.bottomY < 1) {
      throw new Error(`Ladder portal ${portal.id} must span at least one metre.`);
    }
    const object = createLadderObject(ladder, materials.get('support'));
    object.userData.v2PortalId = portal.id;
    group.add(object);
    registry.register(ladder.id, {
      visual: object,
      role: 'traversal:ladder',
      regionId: portal.from.regionId,
    });
    ladder.object = object;
    ladders.push(ladder);
  }
  return ladders;
}

function addPortalFrames({ plan, group, materials, registry, authoredPresentation = null }) {
  for (const portal of plan.portals) {
    for (const [endpointName, endpoint] of [['from', portal.from], ['to', portal.to]]) {
      if (authoredPresentation?.boundaryIds.has(endpoint.boundaryId)
        || authoredPresentation?.portalEndpointKeys.has(`${portal.id}:${endpointName}`)) continue;
      const width = endpoint.dimensions.width;
      const height = endpoint.dimensions.height;
      const depth = Math.max(0.12, endpoint.dimensions.depth ?? 0.2);
      const frame = new THREE.Group();
      frame.name = `v2PortalFrame:${portal.id}:${endpoint.regionId}`;
      const verticalOpening = endpoint.side === 'floor' || endpoint.side === 'ceiling';
      if (verticalOpening) {
        // A floor/ceiling portal is a horizontal hatch. The wall-door frame
        // below used to place its single "header" directly across the entire
        // lift shaft, producing a solid visual ceiling even after the gate
        // collider opened. Build a four-sided perimeter ring instead; the
        // accepted split boundary remains the collision authority.
        const frameMaterial = materials.get('factoryTrim');
        const center = asVector3(endpoint.center);
        center.y += endpoint.side === 'floor' ? 0.11 : -0.11;
        const xBeamGeometry = new THREE.BoxGeometry(width + 0.44, 0.22, 0.22);
        const zBeamGeometry = new THREE.BoxGeometry(0.22, 0.22, depth + 0.44);
        for (const sign of [-1, 1]) {
          const xBeam = new THREE.Mesh(xBeamGeometry, frameMaterial);
          xBeam.position.copy(center);
          xBeam.position.z += sign * (depth * 0.5 + 0.11);
          frame.add(xBeam);
          const zBeam = new THREE.Mesh(zBeamGeometry, frameMaterial);
          zBeam.position.copy(center);
          zBeam.position.x += sign * (width * 0.5 + 0.11);
          frame.add(zBeam);
        }
        frame.userData.v2PortalFrameForm = 'horizontal-perimeter-ring';
        group.add(frame);
        registry.register(`${portal.id}:${endpoint.regionId}:frame`, {
          visual: frame,
          role: 'portal-frame',
          regionId: endpoint.regionId,
        });
        continue;
      }
      // Plan endpoints own a cardinal boundary side even when they omit the
      // optional facing vector. Defaulting every missing facing to north/south
      // rotated east/west doorway trim across the aperture itself.
      const facing = endpoint.facing ?? ({
        north: { x: 0, y: 0, z: 1 },
        south: { x: 0, y: 0, z: -1 },
        east: { x: 1, y: 0, z: 0 },
        west: { x: -1, y: 0, z: 0 },
      }[endpoint.side] ?? { x: 0, y: 0, z: 1 });
      const alongX = Math.abs(facing.z || 0) >= Math.abs(facing.x || 0);
      const sideGeometry = alongX
        ? new THREE.BoxGeometry(0.22, height, depth)
        : new THREE.BoxGeometry(depth, height, 0.22);
      const headerGeometry = alongX
        ? new THREE.BoxGeometry(width + 0.44, 0.22, depth)
        : new THREE.BoxGeometry(depth, 0.22, width + 0.44);
      const tangent = alongX ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      for (const sign of [-1, 1]) {
        const side = new THREE.Mesh(sideGeometry, materials.get('factoryTrim'));
        side.position.copy(asVector3(endpoint.center)).addScaledVector(tangent, sign * (width * 0.5 + 0.11));
        frame.add(side);
      }
      const header = new THREE.Mesh(headerGeometry, materials.get('factoryTrim'));
      header.position.copy(asVector3(endpoint.center));
      header.position.y += height * 0.5 + 0.11;
      frame.add(header);
      group.add(frame);
      registry.register(`${portal.id}:${endpoint.regionId}:frame`, {
        visual: frame,
        role: 'portal-frame',
        regionId: endpoint.regionId,
      });
    }
  }
}

function resolveAnchor(plan, anchorById, anchorId, label) {
  const anchor = anchorById.get(anchorId);
  if (!anchor) throw new Error(`Dungeon V2 ${label} references missing anchor ${anchorId}.`);
  return anchor;
}

function resolveRegisteredPhysicalRefs(contract, registry, label, { allowEmpty = false } = {}) {
  const visualFixtureIds = contract?.visualFixtureIds ?? [];
  const colliderIds = contract?.colliderIds ?? [];
  if (!Array.isArray(visualFixtureIds) || !Array.isArray(colliderIds)) {
    throw new Error(`Dungeon V2 ${label} requires visualFixtureIds[] and colliderIds[].`);
  }
  if (!allowEmpty && (!visualFixtureIds.length || !colliderIds.length)) {
    throw new Error(`Dungeon V2 ${label} requires plan-owned visual and collider references.`);
  }
  const registeredVisualIds = [];
  const visuals = [];
  for (const fixtureId of visualFixtureIds) {
    const record = registry.byPlanId.get(fixtureId);
    if (!record?.visualIds?.length) {
      throw new Error(`Dungeon V2 ${label} references unregistered visual fixture ${fixtureId}.`);
    }
    for (const visualId of record.visualIds) {
      registeredVisualIds.push(visualId);
      visuals.push(registry.getVisualById(visualId));
    }
  }
  const registeredColliderIds = [];
  const colliders = [];
  for (const fixtureId of colliderIds) {
    const record = registry.byPlanId.get(fixtureId);
    if (!record?.colliderIds?.length) {
      throw new Error(`Dungeon V2 ${label} references unregistered colliding fixture ${fixtureId}.`);
    }
    for (const colliderId of record.colliderIds) {
      registeredColliderIds.push(colliderId);
      colliders.push(registry.getColliderById(colliderId));
    }
  }
  const planFixtureIds = [...new Set([...visualFixtureIds, ...colliderIds])];
  return {
    visualFixtureIds: [...visualFixtureIds],
    colliderIds: [...colliderIds],
    registeredVisualIds,
    registeredColliderIds,
    planFixtureIds,
    visuals,
    colliders,
    primaryVisual: visuals[0] ?? null,
  };
}

function addGateObjects({ plan, group, materials, registry, anchorById }) {
  const gateContracts = plan.progression?.gateContracts;
  if (!Array.isArray(gateContracts)) {
    throw new Error('Dungeon V2 progression requires explicit gateContracts.');
  }
  return gateContracts.map((gate) => {
    const action = gate.actionId
      ? (plan.actions ?? []).find(({ id }) => id === gate.actionId)
      : (plan.actions ?? []).find((candidate) => candidate.effects?.some((effect) => (
        effect.op === 'openGate' && effect.gateId === gate.id
      )));
    const anchor = gate.anchorId || action?.anchorId
      ? resolveAnchor(plan, anchorById, gate.anchorId ?? action.anchorId, `gate ${gate.id}`)
      : null;
    const portal = plan.portals.find(({ id }) => id === gate.portalId);
    if (!portal) throw new Error(`Dungeon V2 gate ${gate.id} references missing portal ${gate.portalId}.`);
    const barrierId = gate.barrierBoundaryId
      ?? gate.barrierId
      ?? portal.barrierBoundaryId
      ?? action?.barrierIds?.find((id) => registry.byPlanId.has(id));
    const barrierDescriptor = plan.structuralBoundaries.find(({ id }) => id === barrierId);
    if (!barrierDescriptor
      || barrierDescriptor.collider !== true
      || barrierDescriptor.opaque !== true
      || !['gate-barrier', 'movable-gate-barrier'].includes(barrierDescriptor.kind)) {
      throw new Error(`Dungeon V2 gate ${gate.id} requires an opaque colliding plan-owned gate-barrier structuralBoundary.`);
    }
    if ((barrierDescriptor.blocksPortalId ?? barrierDescriptor.portalId) !== portal.id) {
      throw new Error(`Dungeon V2 gate barrier ${barrierId} is not tied to portal aperture ${portal.id}.`);
    }
    const endpoint = [portal.from, portal.to].find(({ cellId, boundaryId }) => (
      cellId === barrierDescriptor.cellId
      || boundaryId === barrierDescriptor.apertureBoundaryId
    ));
    if (!endpoint) {
      throw new Error(`Dungeon V2 gate barrier ${barrierId} is not attached to either ${portal.id} endpoint.`);
    }
    const barrierBounds = normalizeBounds(barrierDescriptor.bounds, `gate barrier ${barrierId}`);
    const endpointCenter = asVector3(endpoint.center, `portal ${portal.id} gate endpoint`);
    if (barrierBounds.center.distanceTo(endpointCenter) > 0.11) {
      throw new Error(`Dungeon V2 gate barrier ${barrierId} does not occupy its authored portal aperture center.`);
    }
    const barrier = barrierId ? registry.getVisual(barrierId) : null;
    if (!anchor || !barrier || !action) {
      throw new Error(`Dungeon V2 gate ${gate.id} requires an explicit action, anchor, and registered barrier.`);
    }
    const interactionRefs = resolveRegisteredPhysicalRefs(action, registry, `gate action ${action.id}`);
    for (const visual of interactionRefs.visuals) {
      visual.userData.v2ActionIds = [...new Set([...(visual.userData.v2ActionIds ?? []), action.id])];
    }
    barrier.material = materials.get(gate.materialProfileId ?? 'factoryTrim');
    const collider = registry.getCollider(barrierId);
    const interactionPosition = asVector3(anchor.position, `gate ${gate.id} anchor`);
    const requiredKeycardId = gate.requiredKeycardId
      ?? plan.progression?.keyContracts?.find((contract) => (
        contract.gateId === gate.id || contract.shortcutGateId === gate.id
      ))?.keyId;
    const size = collider
      ? { x: collider.halfWidth * 2, y: collider.verticalHalfHeight * 2, z: collider.halfDepth * 2 }
      : { x: 0.3, y: 4.8, z: 2.4 };
    const barrierColliders = (registry.byPlanId.get(barrierId)?.colliderIds ?? [])
      .map((colliderId) => registry.colliders.get(colliderId))
      .filter(Boolean);
    const collisionPosition = collider?.position?.clone?.() ?? barrier.position.clone();
    const baseY = collisionPosition.y - (collider?.verticalHalfHeight ?? size.y * 0.5);
    const motionRoot = new THREE.Group();
    motionRoot.name = `v2GateMotionRoot:${gate.id}`;
    const horizontalHatch = endpoint.side === 'floor' || endpoint.side === 'ceiling';
    motionRoot.position.set(
      barrier.position.x,
      horizontalHatch ? collisionPosition.y : baseY,
      barrier.position.z,
    );
    barrier.removeFromParent();
    barrier.position.set(0, horizontalHatch ? 0 : collisionPosition.y - baseY, 0);
    motionRoot.add(barrier);
    group.add(motionRoot);
    const door = {
      ...clonePlain(gate),
      id: gate.id,
      label: gate.label ?? gate.displayName ?? 'Security Gate',
      fromRoomId: gate.fromRegionId ?? gate.fromRoomId ?? portal?.from.regionId,
      toRoomId: gate.toRegionId ?? gate.toRoomId ?? portal?.to.regionId,
      position: interactionPosition,
      interactionPosition,
      collisionPosition,
      object: motionRoot,
      barrierObject: barrier,
      interactionObject: interactionRefs.primaryVisual,
      baseY,
      alongX: size.z > size.x,
      collisionHalfWidth: size.x * 0.5,
      collisionHalfDepth: size.z * 0.5,
      collisionHeight: size.y,
      closedY: horizontalHatch ? collisionPosition.y : baseY,
      openOffsetY: size.y + 0.6,
      openY: horizontalHatch ? collisionPosition.y : baseY + size.y + 0.6,
      ...(horizontalHatch ? {
        hatchMotionAxis: 'x',
        closedPosition: collisionPosition.clone(),
        openPosition: collisionPosition.clone().add(new THREE.Vector3(size.x + 0.6, 0, 0)),
      } : {}),
      requiredKeycardId,
      requiresKeycard: Boolean(requiredKeycardId),
      locked: gate.initiallyOpen !== true,
      closed: gate.initiallyOpen !== true,
      opened: gate.initiallyOpen === true,
      isShrineDoor: requiredKeycardId === 'Shrine_Key' || gate.isShrineDoor === true,
      interactionRadius: action?.interaction?.radius ?? 2.45,
      v2ActionId: gate.actionId ?? action?.id ?? null,
      v2BarrierId: barrierId,
      barrierColliders,
      planFixtureIds: interactionRefs.planFixtureIds,
      visualFixtureIds: interactionRefs.visualFixtureIds,
      colliderIds: interactionRefs.colliderIds,
      registeredVisualIds: interactionRefs.registeredVisualIds,
      registeredColliderIds: interactionRefs.registeredColliderIds,
      interactionColliders: interactionRefs.colliders,
    };
    door.setOpen = (open) => {
      door.closed = !open;
      door.locked = !open;
      door.opened = open;
      for (const barrierCollider of barrierColliders) barrierCollider.active = !open;
    };
    door.setOpen(gate.initiallyOpen === true);
    return door;
  });
}

const KEYCARD_PEDESTAL_HOVER_HEIGHT = 0.32;
const KEYCARD_DISPLAY_NAMES = Object.freeze({
  Keycard_Alpha: 'Alpha Keycard',
  Keycard_Beta: 'Beta Keycard',
  Keycard_Gamma: 'Gamma Keycard',
  Shrine_Key: 'Shrine Key',
});

function getKeycardDisplayName(reward) {
  if (typeof reward.displayName === 'string' && reward.displayName.trim()) {
    return reward.displayName.trim();
  }
  if (typeof reward.label === 'string' && reward.label.trim()) {
    return reward.label.trim();
  }
  const keycardId = reward.keycardId ?? reward.keyId;
  if (KEYCARD_DISPLAY_NAMES[keycardId]) return KEYCARD_DISPLAY_NAMES[keycardId];
  const readableId = String(keycardId ?? 'Keycard')
    .replace(/^Keycard[_\s-]*/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return readableId ? `${readableId} Keycard` : 'Keycard';
}

function createKeycardObject(material, haloMaterial) {
  const group = new THREE.Group();
  group.name = 'keycardPickupPlaceholder';
  group.userData.v2KeycardVisualStyle = 'dungeon-v1-floating-keycard';
  group.userData.v2CollisionPolicy = 'nonblocking-pickup';

  // Match both pieces of the existing dropped-keycard silhouette. The
  // plan-owned fixture supplies the physical pedestal, so the card and halo
  // remain presentation-only and never enter a collision registry.
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.62), material);
  body.name = 'floatingKeycard';
  body.rotation.y = Math.PI * 0.18;
  body.castShadow = true;

  const halo = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.44, 28), haloMaterial);
  halo.name = 'droppedKeycardHalo';
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -0.18;
  halo.userData.v2CollisionPolicy = 'nonblocking-presentation';

  group.add(body, halo);
  return group;
}

function getColliderTopY(collider) {
  if (Number.isFinite(collider?.bounds?.max?.y)) return collider.bounds.max.y;
  if (Number.isFinite(collider?.position?.y) && Number.isFinite(collider?.verticalHalfHeight)) {
    return collider.position.y + collider.verticalHalfHeight;
  }
  return null;
}

function resolveKeycardCollectAction(plan, reward) {
  const action = reward.actionId
    ? (plan.actions ?? []).find(({ id }) => id === reward.actionId)
    : null;
  const keycardId = reward.keycardId ?? reward.keyId;
  const collectedRewardIds = (action?.effects ?? [])
    .filter(({ op }) => op === 'collectReward')
    .map(({ rewardId }) => rewardId);
  const grantedKeyIds = (action?.effects ?? [])
    .filter(({ op }) => op === 'grantKey')
    .map(({ keyId }) => keyId);
  if (!action
    || action.anchorId !== reward.anchorId
    || collectedRewardIds.length !== 1
    || collectedRewardIds[0] !== reward.id
    || grantedKeyIds.length !== 1
    || grantedKeyIds[0] !== keycardId) {
    throw new Error(
      `Dungeon V2 keycard ${reward.id} must use one anchored action that collects only ${reward.id} and grants only ${keycardId}.`,
    );
  }
  return action;
}

function addRewards({ plan, group, materials, anchorById, registry }) {
  const rewards = [];
  const keycards = [];
  const chests = [];
  let shrine = null;
  let keySeeker = null;

  for (const reward of plan.rewards ?? []) {
    const anchor = resolveAnchor(plan, anchorById, reward.anchorId, `reward ${reward.id}`);
    const position = asVector3(anchor.position, `reward ${reward.id} anchor`);
    const kind = reward.kind ?? reward.type;
    const collectAction = reward.actionId
      ? (plan.actions ?? []).find(({ id }) => id === reward.actionId)
      : (plan.actions ?? []).find((action) => action.effects?.some((effect) => (
        effect.op === 'collectReward' && effect.rewardId === reward.id
      )));
    const interactionRadius = collectAction?.interaction?.radius ?? 2.05;
    const physicalRefs = resolveRegisteredPhysicalRefs(reward, registry, `reward ${reward.id}`);
    for (const visual of physicalRefs.visuals) {
      visual.userData.v2RewardIds = [...new Set([...(visual.userData.v2RewardIds ?? []), reward.id])];
    }
    const referenceFields = {
      planFixtureIds: physicalRefs.planFixtureIds,
      visualFixtureIds: physicalRefs.visualFixtureIds,
      colliderIds: physicalRefs.colliderIds,
      registeredVisualIds: physicalRefs.registeredVisualIds,
      registeredColliderIds: physicalRefs.registeredColliderIds,
      fixtureObjects: physicalRefs.visuals,
      fixtureColliders: physicalRefs.colliders,
    };
    if (kind === 'key-seeker') {
      const object = physicalRefs.primaryVisual;
      keySeeker = {
        ...clonePlain(reward),
        ...referenceFields,
        object,
        position,
        roomId: reward.regionId ?? anchor.regionId,
        activated: false,
        collected: false,
        interactionRadius,
      };
      rewards.push(keySeeker);
    } else if (kind === 'keycard') {
      const keycardAction = resolveKeycardCollectAction(plan, reward);
      const pedestalTopY = Math.max(
        ...physicalRefs.colliders.map(getColliderTopY).filter(Number.isFinite),
      );
      if (!Number.isFinite(pedestalTopY)) {
        throw new Error(`Dungeon V2 keycard ${reward.id} has no finite authored pedestal top.`);
      }
      const object = createKeycardObject(materials.get('key'), materials.getKeycardHalo());
      const visualRestY = pedestalTopY + KEYCARD_PEDESTAL_HOVER_HEIGHT;
      object.position.set(position.x, visualRestY, position.z);
      object.name = `v2Keycard:${reward.keycardId ?? reward.keyId}`;
      object.userData.v2RewardId = reward.id;
      object.userData.v2ActionId = keycardAction.id;
      object.userData.v2PedestalTopY = pedestalTopY;
      object.userData.v2CollisionPolicy = 'nonblocking-pickup';
      group.add(object);
      const entry = {
        ...clonePlain(reward),
        ...referenceFields,
        object,
        pedestalObject: physicalRefs.primaryVisual,
        position,
        visualRestY,
        pedestalTopY,
        collected: false,
        keycardId: reward.keycardId ?? reward.keyId,
        actionId: keycardAction.id,
        displayName: getKeycardDisplayName(reward),
        spawnRoomId: reward.regionId ?? anchor.regionId,
        spawnMode: 'Pedestal',
        interactionRadius,
      };
      keycards.push(entry);
      rewards.push(entry);
    } else if (['cache', 'chest', 'treasure', 'reaverbot-parts-cache', 'major-reaverbot-parts-cache'].includes(kind)) {
      const object = physicalRefs.primaryVisual;
      const entry = {
        ...clonePlain(reward),
        ...referenceFields,
        object,
        position,
        opened: false,
        collected: false,
        roomId: reward.regionId ?? anchor.regionId,
        rareBoost: reward.rareBoost !== false,
        rewardTags: [...(reward.rewardTags ?? [])],
        interactionRadius,
      };
      chests.push(entry);
      rewards.push(entry);
    } else if (['large-refractor', 'refractor', 'objective-reward'].includes(kind)) {
      const object = new THREE.Group();
      object.name = `v2RewardPickup:${reward.id}`;
      object.position.copy(position);
      object.userData.v2RewardId = reward.id;
      object.userData.v2CollisionPolicy = 'nonblocking-pickup';
      const refractor = new THREE.Mesh(new THREE.OctahedronGeometry(0.72), materials.get('signal'));
      refractor.name = 'largeRefractorObjective';
      refractor.position.y = 1.6;
      refractor.castShadow = true;
      refractor.userData.v2CollisionPolicy = 'nonblocking-pickup';
      object.add(refractor);
      group.add(object);
      shrine = {
        ...clonePlain(reward),
        ...referenceFields,
        object,
        daisObject: physicalRefs.primaryVisual,
        position,
        collected: false,
        interactionRadius,
      };
      rewards.push(shrine);
    } else {
      throw new Error(`Dungeon V2 reward ${reward.id} has unsupported explicit kind ${kind}.`);
    }
  }
  const extractionAction = (plan.actions ?? []).find((action) => action.type === 'extraction');
  if (shrine && extractionAction) {
    const extractionAnchor = resolveAnchor(
      plan,
      anchorById,
      extractionAction.anchorId,
      `extraction action ${extractionAction.id}`,
    );
    const extractionRefs = resolveRegisteredPhysicalRefs(
      extractionAction,
      registry,
      `extraction action ${extractionAction.id}`,
    );
    const extractionPosition = asVector3(extractionAnchor.position, 'extraction action anchor');
    for (const visual of extractionRefs.visuals) {
      visual.userData.v2ActionIds = [...new Set([...(visual.userData.v2ActionIds ?? []), extractionAction.id])];
      visual.visible = false;
    }
    Object.assign(shrine, {
      extractionObject: extractionRefs.primaryVisual,
      extractionPosition,
      extractionVisualPosition: extractionPosition.clone(),
      extractionInteractionRadius: extractionAction.interaction?.radius ?? 3,
      extractionActionId: extractionAction.id,
      extractionAnchorId: extractionAction.anchorId,
      extractionPlanFixtureIds: extractionRefs.planFixtureIds,
      extractionVisualFixtureIds: extractionRefs.visualFixtureIds,
      extractionColliderIds: extractionRefs.colliderIds,
      extractionRegisteredVisualIds: extractionRefs.registeredVisualIds,
      extractionRegisteredColliderIds: extractionRefs.registeredColliderIds,
      extractionFixtureObjects: extractionRefs.visuals,
      extractionFixtureColliders: extractionRefs.colliders,
    });
  }
  return { rewards, keycards, chests, shrine, keySeeker };
}

function addActionInteractables({ plan, anchorById, resources, registry }) {
  const mechanisms = [];
  const safeInteractables = [];
  let keySeeker = null;
  const mechanismById = new Map((plan.mechanisms ?? []).map((mechanism) => [mechanism.id, mechanism]));

  for (const action of plan.actions ?? []) {
    if (!action.anchorId) continue;
    const anchor = resolveAnchor(plan, anchorById, action.anchorId, `action ${action.id}`);
    const position = asVector3(anchor.position, `action ${action.id} anchor`);
    const actionType = action.type;
    if ([
      'gate',
      'open-gate',
      'gate-control',
      'pickup',
      'collect',
      'cache',
      'extract',
      'extraction',
      'encounter-complete',
      'objective-complete',
    ].includes(actionType)) {
      continue;
    }
    const physicalRefs = resolveRegisteredPhysicalRefs(action, registry, `action ${action.id}`);
    const object = physicalRefs.primaryVisual;
    for (const visual of physicalRefs.visuals) {
      visual.userData.v2ActionIds = [...new Set([...(visual.userData.v2ActionIds ?? []), action.id])];
    }
    const referenceFields = {
      planFixtureIds: physicalRefs.planFixtureIds,
      visualFixtureIds: physicalRefs.visualFixtureIds,
      colliderIds: physicalRefs.colliderIds,
      registeredVisualIds: physicalRefs.registeredVisualIds,
      registeredColliderIds: physicalRefs.registeredColliderIds,
      fixtureObjects: physicalRefs.visuals,
      fixtureColliders: physicalRefs.colliders,
    };
    if (actionType === 'key-seeker') {
      keySeeker = {
        ...referenceFields,
        id: action.id,
        label: action.label ?? 'Key Seeker',
        roomId: anchor.regionId,
        position,
        object,
        activated: false,
        interactionRadius: action.interaction?.radius ?? 2.1,
      };
      continue;
    }
    if (actionType === 'safe-interactable') {
      safeInteractables.push({
        ...referenceFields,
        id: action.id,
        label: action.label ?? action.id,
        action: action.safeAction,
        position,
        object,
        color: 0x6bdcff,
        interactionRadius: action.interaction?.radius ?? 2.1,
      });
      continue;
    }

    if (action.controllerId && !mechanismById.has(action.controllerId)) {
      throw new Error(`Dungeon V2 action ${action.id} references missing controller ${action.controllerId}.`);
    }
    object.userData.v2ActionId = action.id;
    object.userData.v2ActivationSide = clonePlain(action.interaction?.activationSide ?? null);
    mechanisms.push({
      ...referenceFields,
      id: action.id,
      controllerId: action.controllerId ?? null,
      label: action.label ?? action.id,
      object,
      position,
      activated: false,
      repeatable: action.repeatable ?? Boolean(action.controllerId),
      v2ActionId: action.id,
      interactionRadius: action.interaction?.radius ?? 2.1,
    });
    if (action.controllerId && !resources.mechanismObjects.has(action.controllerId)) {
      resources.mechanismConsoles.set(action.controllerId, object);
    }
  }
  return { mechanisms, safeInteractables, keySeeker };
}

function createEncounters(plan, anchorById) {
  return (plan.encounters ?? []).map((encounter) => {
    const anchor = resolveAnchor(plan, anchorById, encounter.anchorId, `encounter ${encounter.id}`);
    const position = asVector3(anchor.position, `encounter ${encounter.id} anchor`);
    const bounds = encounter.zoneBounds ?? anchor.zoneBounds;
    const normalized = bounds ? normalizeBounds(bounds, `encounter ${encounter.id} zone`) : null;
    const triggerBounds = encounter.triggerZoneBounds ?? bounds;
    const normalizedTrigger = triggerBounds
      ? normalizeBounds(triggerBounds, `encounter ${encounter.id} trigger zone`)
      : normalized;
    const halfWidth = normalized?.size.x * 0.5 ?? encounter.halfWidth;
    const halfDepth = normalized?.size.z * 0.5 ?? encounter.halfDepth;
    if (!Number.isFinite(halfWidth) || !Number.isFinite(halfDepth)) {
      throw new Error(`Dungeon V2 encounter ${encounter.id} requires explicit zoneBounds or half extents.`);
    }
    const spawnPoints = (encounter.spawnPattern?.points ?? encounter.spawnPoints ?? [])
      .map((point, index) => asVector3(point, `encounter ${encounter.id} spawn ${index}`));
    const roster = encounter.roster
      ?? (Array.isArray(encounter.spawnPattern) ? encounter.spawnPattern : encounter.spawnPattern?.roster)
      ?? [];
    if (!spawnPoints.length) {
      throw new Error(`Dungeon V2 encounter ${encounter.id} requires authored world-space spawnPoints.`);
    }
    if (!roster.length || roster.some((entry) => typeof entry !== 'string' || !entry.trim())) {
      throw new Error(`Dungeon V2 encounter ${encounter.id} requires a non-empty explicit roster.`);
    }
    return {
      ...clonePlain(encounter),
      roomId: encounter.regionId ?? anchor.regionId,
      label: encounter.label ?? encounter.id,
      zone: {
        id: `${encounter.id}:zone`,
        roomId: encounter.regionId ?? anchor.regionId,
        position: normalized?.center ?? position.clone(),
        halfWidth,
        halfDepth,
        verticalHalfHeight: normalized?.size.y * 0.5,
        active: true,
      },
      triggerZone: {
        id: `${encounter.id}:trigger`,
        roomId: encounter.regionId ?? anchor.regionId,
        position: normalizedTrigger?.center ?? position.clone(),
        halfWidth: encounter.triggerHalfWidth ?? normalizedTrigger?.size.x * 0.5 ?? halfWidth,
        halfDepth: encounter.triggerHalfDepth ?? normalizedTrigger?.size.z * 0.5 ?? halfDepth,
        verticalHalfHeight: normalizedTrigger?.size.y * 0.5,
        active: true,
      },
      spawnPoints,
      spawned: false,
      cleared: false,
      enemyIds: [],
      roster: [...roster],
      isBoss: encounter.kind === 'final-elite' || encounter.isBoss === true,
    };
  });
}

function createSemanticAuthoredWaterRuntimeObject(binding, basin, group) {
  const node = binding?.node;
  const placementGroup = binding?.placementGroup;
  if (!node?.isObject3D || !placementGroup?.isObject3D) {
    throw new Error(`Authored water basin ${basin.id} requires its exact live FLUID node and placement group.`);
  }
  let current = node;
  let belongsToPlacement = false;
  while (current) {
    if (current === placementGroup) {
      belongsToPlacement = true;
      break;
    }
    current = current.parent;
  }
  if (!belongsToPlacement) {
    throw new Error(`Authored water basin ${basin.id} FLUID node is not attached to its accepted placement.`);
  }

  group.updateMatrixWorld(true);
  placementGroup.updateMatrixWorld(true);
  node.updateMatrixWorld(true);
  const worldPosition = node.getWorldPosition(new THREE.Vector3());

  // Runtime water state is expressed in plan/world coordinates. Keep the
  // authored node inside its placement for ownership/disposal, but cancel the
  // static placement transform for this mutable presentation subtree so the
  // existing water controller can set exact world Y levels without a hidden
  // translation or quarter-turn offset.
  const worldSpaceCompensation = new THREE.Group();
  worldSpaceCompensation.name = `v2SemanticWaterWorldSpace:${basin.id}`;
  worldSpaceCompensation.matrixAutoUpdate = false;
  worldSpaceCompensation.matrix.copy(placementGroup.matrixWorld).invert();
  placementGroup.add(worldSpaceCompensation);
  worldSpaceCompensation.updateMatrixWorld(true);

  const runtimeRoot = new THREE.Group();
  runtimeRoot.name = `v2AuthoredWaterSurface:${basin.id}`;
  runtimeRoot.position.copy(worldPosition);
  worldSpaceCompensation.add(runtimeRoot);
  runtimeRoot.updateMatrixWorld(true);
  runtimeRoot.attach(node);
  runtimeRoot.userData.v2SemanticRoomPackWater = true;
  runtimeRoot.userData.v2SemanticRoomPackPlacementId = binding.placementId;
  runtimeRoot.userData.v2SemanticRoomPackSourceNodeName = binding.sourceNodeName;
  runtimeRoot.userData.v2WaterVolumePresentation = false;
  runtimeRoot.userData.v2CollisionAuthority = 'plan-environment-state-only';
  return runtimeRoot;
}

function addWaterAndHazards({ plan, group, materials, resources, traps }) {
  const water = getWaterDefinition(plan);
  if (water) {
    const initial = water.configurations.find(({ id }) => id === water.initialConfigurationId);
    for (const basin of water.basins ?? []) {
      const normalized = normalizeBounds(basin.bounds, `water basin ${basin.id}`);
      const level = initial?.levels?.[basin.id];
      if (!Number.isFinite(level)) {
        throw new Error(`Water basin ${basin.id} has no exact level in initial configuration.`);
      }
      const authoredBinding = resources.semanticRoomPackWaterBasinBindings?.get(basin.id) ?? null;
      // A binding is explicit plan metadata; never infer it from a FLUID mesh
      // name or spatial overlap. Unbound basins retain the normal full-volume
      // presentation, while the one bound basin uses only its authored node.
      const object = authoredBinding
        ? createSemanticAuthoredWaterRuntimeObject(authoredBinding, basin, group)
        : new THREE.Mesh(
            new THREE.BoxGeometry(normalized.size.x, 1, normalized.size.z),
            materials.createWater(),
          );
      if (!authoredBinding) {
        // One unit-height box scaled to the committed level provides a top,
        // bottom, and four visible side faces in one draw. Its bottom remains
        // locked to bounds.min.y while runtime changes the scale/center so the
        // top is always the exact conserved level, including transfer frames.
        object.name = `v2WaterVolume:${basin.id}`;
        object.position.set(
          normalized.center.x,
          basin.bounds.min.y + level * 0.5,
          normalized.center.z,
        );
        object.scale.y = Math.max(EPSILON, level);
        object.userData.v2WaterVolumePresentation = true;
      } else {
        object.position.y = basin.bounds.min.y + level;
      }
      object.visible = level > 0.001;
      object.frustumCulled = true;
      object.userData.v2WaterBasinId = basin.id;
      object.userData.v2WaterRegionId = basin.regionId;
      object.userData.v2WaterDrawCount = 1;
      object.userData.v2UnderwaterVisibility = 'double-sided-translucent-volume';
      object.userData.v2CollisionAuthority = 'plan-environment-state-only';
      object.userData.v2BasinFootprintPolicy = basin.footprintPolicy;
      object.userData.v2BasinFootprint = clonePlain({
        min: { x: basin.bounds.min.x, z: basin.bounds.min.z },
        max: { x: basin.bounds.max.x, z: basin.bounds.max.z },
      });
      object.userData.v2BasinFootprintArea = normalized.size.x * normalized.size.z;
      object.userData.v2ExactLevel = level;
      object.userData.v2ExactSurfaceY = basin.bounds.min.y + level;
      object.userData.v2ExactBottomY = basin.bounds.min.y;
      object.userData.v2VisibleDepth = level;
      if (object.geometry) {
        object.geometry.userData.v2BasinFootprint = clonePlain(object.userData.v2BasinFootprint);
        object.geometry.userData.v2WaterUnitHeight = 1;
      }
      if (!authoredBinding) group.add(object);
      resources.waterObjects.set(basin.id, object);
    }
  }

  const hazards = getHazardDefinitions(plan);
  for (const hazard of hazards) {
    const surfaceContracts = hazard.surfaces?.length
      ? hazard.surfaces
      : hazard.surfaceId
        ? [{ surfaceId: hazard.surfaceId }]
        : [];
    if (!surfaceContracts.length) {
      throw new Error(`Hazard ${hazard.id} must declare at least one surfaces[] entry.`);
    }
    const seenSurfaceIds = new Set();
    for (const surfaceContract of surfaceContracts) {
      const { surfaceId } = surfaceContract;
      if (!surfaceId || seenSurfaceIds.has(surfaceId)) {
        throw new Error(`Hazard ${hazard.id} contains a missing or duplicate surfaces[].surfaceId.`);
      }
      seenSurfaceIds.add(surfaceId);
      const surface = plan.walkableSurfaces.find(({ id }) => id === surfaceId);
      if (!surface) throw new Error(`Hazard ${hazard.id} references missing surface ${surfaceId}.`);
      const normalized = normalizeBounds(surface.bounds, `hazard surface ${surface.id}`);
      const object = resources.surfaceObjects.get(surface.id);
      if (!object) throw new Error(`Hazard ${hazard.id} surface ${surfaceId} has no assembled visual.`);
      const trapId = hazardSurfaceRuntimeId(hazard, surfaceContract);
      if (resources.hazardObjects.has(trapId) || traps.some(({ id }) => id === trapId)) {
        throw new Error(`Hazard surface runtime ID ${trapId} is not unique.`);
      }
      resources.hazardObjects.set(trapId, object);
      traps.push({
        id: trapId,
        label: surfaceContract.label
          ?? hazard.label
          ?? (hazard.kind === 'electrical' ? 'Electrical Floor' : 'Magma Floor'),
        object,
        position: normalized.center,
        halfWidth: normalized.size.x * 0.5,
        halfDepth: normalized.size.z * 0.5,
        verticalHalfHeight: Math.max(0.25, normalized.size.y),
        ambientHazardTags: [...new Set([
          ...(surfaceContract.tags ?? []),
          ...(hazard.tags ?? []),
          hazard.hazardTag,
          surface.hazardTag,
        ].filter(Boolean))],
        damagePerPulse: 0,
        damagePerSecond: 0,
        pulseInterval: surfaceContract.pulseInterval ?? hazard.pulseInterval,
        v2DamagePerPulse: surfaceContract.damagePerPulse ?? hazard.damagePerPulse,
        v2DamagePerSecond: surfaceContract.damagePerSecond ?? hazard.damagePerSecond,
        v2RuntimeOwnsDamage: true,
        active: true,
        v2HazardId: hazard.id,
        v2HazardGroupId: hazard.id,
        v2HazardSurfaceId: surfaceId,
      });
    }
  }
}

function createMinimap(plan, rooms, anchorById, tileSize) {
  const canonical = clonePlain(plan.minimap ?? {});
  const canonicalRegions = new Map(
    (canonical.regions ?? []).map((region) => [region.id ?? region.regionId, region]),
  );
  const canonicalConnections = canonical.connections ?? (plan.portals ?? []).map((portal) => ({
    id: portal.id,
    fromRegionId: portal.from.regionId,
    toRegionId: portal.to.regionId,
    direction: portal.direction,
    barrierId: portal.barrierId ?? null,
    mechanismId: portal.mechanismId ?? null,
  }));
  const minimapRooms = rooms.map((room) => {
    const authored = canonicalRegions.get(room.id);
    const bounds = authored?.bounds ?? room.bounds;
    const roomBounds2D = {
      x: bounds.min.x / tileSize,
      z: bounds.min.z / tileSize,
      width: (bounds.max.x - bounds.min.x) / tileSize,
      depth: (bounds.max.z - bounds.min.z) / tileSize,
    };
    const connectedRoomIds = canonicalConnections
      .filter((connection) => (
        connection.fromRegionId === room.id || connection.toRegionId === room.id
      ))
      .map((connection) => (
        connection.fromRegionId === room.id
          ? connection.toRegionId
          : connection.fromRegionId
      ));
    const elevations = authored?.elevations
      ?? (Number.isFinite(authored?.elevation) ? [authored.elevation] : [room.minY, room.maxY]);
    return {
      ...clonePlain(authored ?? {}),
      roomId: room.id,
      roomType: room.type,
      roomBounds2D,
      roomCenter2D: {
        x: roomBounds2D.x + roomBounds2D.width * 0.5,
        z: roomBounds2D.z + roomBounds2D.depth * 0.5,
      },
      connectedRoomIds: [...new Set(connectedRoomIds)],
      elevations,
      minY: room.minY,
      maxY: room.maxY,
      districtId: room.districtId,
      archetype: room.archetype,
      purpose: room.purpose,
    };
  });
  const boundsExtents = minimapRooms.reduce((result, room) => ({
    minX: Math.min(result.minX, room.roomBounds2D.x),
    minZ: Math.min(result.minZ, room.roomBounds2D.z),
    maxX: Math.max(result.maxX, room.roomBounds2D.x + room.roomBounds2D.width),
    maxZ: Math.max(result.maxZ, room.roomBounds2D.z + room.roomBounds2D.depth),
  }), { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity });
  const padding = 6;
  const bounds = Number.isFinite(boundsExtents.minX)
    ? {
      minX: boundsExtents.minX - padding,
      minZ: boundsExtents.minZ - padding,
      width: Math.max(1, boundsExtents.maxX - boundsExtents.minX + padding * 2),
      depth: Math.max(1, boundsExtents.maxZ - boundsExtents.minZ + padding * 2),
    }
    : { minX: -24, minZ: -24, width: 48, depth: 48 };
  const staticMarkers = canonical.staticMarkers ?? plan.staticMarkers ?? [];
  const markers = staticMarkers.map((marker) => {
    const anchor = marker.anchorId ? anchorById.get(marker.anchorId) : null;
    if (marker.anchorId && !anchor) {
      throw new Error(`Dungeon V2 minimap marker ${marker.id} references missing anchor ${marker.anchorId}.`);
    }
    const position = anchor?.position ? clonePlain(anchor.position) : clonePlain(marker.position ?? null);
    if (!position) {
      throw new Error(`Dungeon V2 minimap marker ${marker.id} requires an authored anchor or position.`);
    }
    return {
      ...clonePlain(marker),
      markerId: marker.markerId ?? marker.id,
      markerType: marker.markerType ?? marker.type,
      roomId: marker.roomId ?? anchor?.regionId ?? null,
      position,
      point: { x: position.x / tileSize, z: position.z / tileSize },
    };
  });
  const hallways = canonicalConnections.map((connection) => ({
    ...clonePlain(connection),
    hallwayId: connection.hallwayId ?? connection.id,
    fromRoomId: connection.fromRoomId ?? connection.fromRegionId,
    toRoomId: connection.toRoomId ?? connection.toRegionId,
    connectorType: connection.connectorType
      ?? plan.portals?.find(({ id }) => id === connection.id)?.connectorForm
      ?? null,
  }));
  return {
    ...canonical,
    source: canonical.source ?? 'DungeonPlanV2',
    projection: canonical.projection ?? 'plan-regions',
    bounds,
    rooms: minimapRooms,
    hallways,
    markers,
    staticMarkers: markers,
  };
}

function createCompatibilityProgression({ plan, doors, keycards, keySeeker, encounters, minimap, anchorById }) {
  const progression = clonePlain(plan.progression ?? {});
  const portalById = new Map(plan.portals.map((portal) => [portal.id, portal]));
  const runtimeDoorById = new Map(doors.map((door) => [door.id, door]));
  const rewardById = new Map(plan.rewards.map((reward) => [reward.id, reward]));
  const keyContracts = progression.keyContracts ?? [];

  progression.roomConnections = (progression.connections ?? plan.portals).map((connection) => {
    const portal = portalById.get(connection.id) ?? connection;
    return {
      id: connection.id ?? portal.id,
      fromRoomId: connection.fromRegionId ?? portal.from.regionId,
      toRoomId: connection.toRegionId ?? portal.to.regionId,
      doorId: connection.barrierId ?? portal.barrierId ?? null,
      direction: portal.direction ?? connection.direction ?? 'bidirectional',
      routes: [{
        id: `${portal.id}:physical-route`,
        connectorType: portal.connectorForm,
        requiredForProgression: true,
        physicalRoute: clonePlain(portal.physicalRoute ?? null),
        fromSocket: {
          id: `${portal.id}:from`,
          roomId: portal.from.regionId,
          elevation: portal.from.elevation ?? portal.from.center.y,
          matchingSocketId: `${portal.id}:to`,
        },
        toSocket: {
          id: `${portal.id}:to`,
          roomId: portal.to.regionId,
          elevation: portal.to.elevation ?? portal.to.center.y,
          matchingSocketId: `${portal.id}:from`,
        },
      }],
    };
  });

  const normalKeyContracts = keyContracts.filter(({ keyId }) => keyId !== 'Shrine_Key');
  progression.keycards = normalKeyContracts.map((contract, index) => {
    const reward = rewardById.get(contract.rewardId);
    const anchor = reward ? anchorById.get(reward.anchorId) : null;
    return {
      keycardId: contract.keyId,
      displayName: contract.displayName ?? contract.keyId.replace('_', ' '),
      pairedDoorId: contract.gateId,
      progressionTier: index + 1,
      spawnRoomId: reward?.regionId ?? anchor?.regionId,
      spawnMode: 'Pedestal',
      sourcePosition: anchor ? clonePlain(anchor.position) : null,
      isCollected: false,
      isRequiredForMainProgression: contract.required !== false,
    };
  });
  const shrineContract = keyContracts.find(({ keyId }) => keyId === 'Shrine_Key');
  if (shrineContract) {
    const reward = rewardById.get(shrineContract.rewardId);
    const anchor = reward ? anchorById.get(reward.anchorId) : null;
    progression.shrineKey = {
      keycardId: 'Shrine_Key',
      displayName: 'Shrine Key',
      pairedDoorId: shrineContract.gateId,
      progressionTier: 'Final',
      spawnRoomId: reward?.regionId ?? anchor?.regionId,
      spawnMode: 'BossReward',
      sourcePosition: anchor ? clonePlain(anchor.position) : null,
      isCollected: false,
      isRequiredForMainProgression: true,
      isShrineKey: true,
    };
  }

  progression.doors = (progression.gateContracts ?? []).map((gate, index) => {
    const runtime = runtimeDoorById.get(gate.id);
    return {
      doorId: gate.id,
      displayName: runtime?.label ?? gate.displayName ?? gate.id,
      requiredKeycardId: runtime?.requiredKeycardId ?? null,
      progressionTier: runtime?.isShrineDoor ? 'Final' : index + 1,
      leadsToDepthBand: index + 1,
      isCriticalPathDoor: gate.classification === 'non-bypassable-progression',
      isShrineDoor: runtime?.isShrineDoor === true,
      isUnlocked: runtime?.closed === false,
    };
  });
  progression.bands = (plan.keycardZones ?? []).map((zone, index) => ({
    bandId: index,
    label: zone.id,
    roomIds: [...zone.regionIds],
    requiredKeycardIdForExit: zone.keyId,
  }));
  const bossEncounter = encounters.find(({ isBoss }) => isBoss);
  progression.entranceRoomId ??= plan.compatibility?.entranceRoomId;
  progression.shrineRoomId ??= plan.compatibility?.shrineRoomId;
  progression.bossRoomId ??= plan.compatibility?.bossRoomId;
  progression.keySeeker = keySeeker;
  progression.boss = bossEncounter ? {
    encounterId: bossEncounter.id,
    roomId: bossEncounter.roomId,
    rewardKeycardId: shrineContract?.keyId ?? null,
    mustDropShrineKey: Boolean(shrineContract),
  } : null;
  progression.minimap = minimap;
  progression.validation = clonePlain(plan.validation ?? { accepted: true, errors: [], warnings: [] });
  return progression;
}

function assertAssemblerInput(plan, { allowInvalidPreview = false } = {}) {
  if (!plan || typeof plan !== 'object') throw new TypeError('assembleDungeonPlanV2 requires a plan object.');
  if (!allowInvalidPreview && (plan.accepted !== true || plan.validation?.accepted === false)) {
    const error = new Error(`Dungeon V2 refuses a plan that is not validated/accepted: ${plan.id ?? '<unknown>'}.`);
    error.code = 'DUNGEON_V2_PLAN_NOT_ACCEPTED';
    throw error;
  }
  for (const collection of [
    'regions',
    'spatialCells',
    'structuralBoundaries',
    'portals',
    'walkableSurfaces',
    'structuralFixtures',
    'traversalLinks',
    'safeAnchors',
    'actions',
    'mechanisms',
    'encounters',
    'rewards',
    'objectives',
  ]) {
    if (!Array.isArray(plan[collection])) {
      throw new TypeError(`Dungeon V2 plan ${plan.id ?? '<unknown>'} is missing ${collection}.`);
    }
  }
  if (!plan.structuralBoundaries.length || !plan.walkableSurfaces.length) {
    throw new Error('Dungeon V2 plans cannot assemble without authored boundaries and walkable surfaces.');
  }
  // Invalid V2 preview is an explicit development-only inspection path. The
  // collections above are the minimum needed to render anything safely; all
  // stricter fixture/support/anchor assertions remain acceptance-blocking but
  // must not prevent a tester from seeing the rejected geometry in-game.
  if (allowInvalidPreview) return;
  const cellById = new Map(plan.spatialCells.map((cell) => [cell.id, cell]));
  const fixtureById = new Map(plan.structuralFixtures.map((fixture) => [fixture.id, fixture]));
  const surfaceById = new Map(plan.walkableSurfaces.map((surface) => [surface.id, surface]));
  const fixtureVisualIds = new Set();
  const fixtureColliderIds = new Set();
  for (const fixture of plan.structuralFixtures) {
    if (!fixture.visualId || fixtureVisualIds.has(fixture.visualId)) {
      throw new Error(`Structural fixture ${fixture.id} requires a unique stable visualId.`);
    }
    fixtureVisualIds.add(fixture.visualId);
    if (!Array.isArray(fixture.colliderIds)) {
      throw new Error(`Structural fixture ${fixture.id} requires explicit colliderIds[].`);
    }
    for (const colliderId of fixture.colliderIds) {
      if (!colliderId || fixtureColliderIds.has(colliderId)) {
        throw new Error(`Structural fixture ${fixture.id} has a missing or duplicated stable collider ID.`);
      }
      fixtureColliderIds.add(colliderId);
    }
  }
  for (const surface of plan.walkableSurfaces) {
    if (!surface.purpose || !Array.isArray(surface.supportBoundaryIds) || !surface.supportBoundaryIds.length) {
      throw new Error(`Walkable surface ${surface.id} requires a gameplay purpose and visible structural support IDs.`);
    }
    for (const boundaryId of surface.supportBoundaryIds) {
      if (!plan.structuralBoundaries.some((boundary) => boundary.id === boundaryId)) {
        throw new Error(`Walkable surface ${surface.id} references missing support boundary ${boundaryId}.`);
      }
    }
    const cell = cellById.get(surface.cellId);
    const geometryType = surface.stairs ? 'stairs' : surface.geometry?.type;
    const selfSupportingTraversal = ['stairs', 'walkable-stairs', 'ladder'].includes(geometryType);
    const raisedAboveCellFloor = cell
      && surface.bounds.min.y > cell.bounds.min.y + 0.5;
    const requiresVisibleFixtureSupport = surface.collision === 'dynamic'
      || (raisedAboveCellFloor && !selfSupportingTraversal);
    if (requiresVisibleFixtureSupport && !(surface.supportFixtureIds?.length > 0)) {
      throw new Error(`Raised or dynamic walkable surface ${surface.id} requires explicit visible supportFixtureIds.`);
    }
    for (const fixtureId of surface.supportFixtureIds ?? []) {
      const fixture = fixtureById.get(fixtureId);
      if (!fixture) throw new Error(`Walkable surface ${surface.id} references missing support fixture ${fixtureId}.`);
      if (fixture.collision === false) {
        throw new Error(`Walkable surface ${surface.id} support fixture ${fixtureId} cannot be decorative-only.`);
      }
    }
    if (surface.stairs
      || surface.form === 'stairs'
      || ['stairs', 'walkable-stairs'].includes(surface.geometry?.type)
      || surface.shape === 'ramp-tile') {
      deriveStairProfile(surface);
    }
  }
  const actionById = new Map(plan.actions.map((action) => [action.id, action]));
  const assertOwnerFixtureReferences = (owner, label, physical) => {
    if (!Array.isArray(owner.visualFixtureIds) || !Array.isArray(owner.colliderIds)) {
      throw new Error(`${label} requires visualFixtureIds[] and colliderIds[].`);
    }
    if (physical && (!owner.visualFixtureIds.length || !owner.colliderIds.length)) {
      throw new Error(`${label} is a physical interaction and requires colliding plan fixture references.`);
    }
    for (const fixtureId of owner.visualFixtureIds) {
      if (!fixtureById.has(fixtureId)) {
        throw new Error(`${label} references missing visual structural fixture ${fixtureId}.`);
      }
    }
    for (const fixtureId of owner.colliderIds) {
      const fixture = fixtureById.get(fixtureId);
      if (!fixture || fixture.collision === false || !(fixture.colliderIds?.length > 0)) {
        throw new Error(`${label} references non-colliding or missing structural fixture ${fixtureId}.`);
      }
    }
  };
  for (const action of plan.actions) {
    assertOwnerFixtureReferences(
      action,
      `Action ${action.id}`,
      action.interaction?.activationSide !== 'system',
    );
  }
  for (const reward of plan.rewards) {
    assertOwnerFixtureReferences(reward, `Reward ${reward.id}`, true);
  }
  for (const objective of plan.objectives) {
    const action = actionById.get(objective.actionId);
    assertOwnerFixtureReferences(
      objective,
      `Objective ${objective.id}`,
      action?.interaction?.activationSide !== 'system',
    );
  }
  for (const mechanism of plan.mechanisms) {
    if (['cargo-lift', 'lift', 'moving-cargo', 'moving-platform'].includes(mechanism.type)
      && mechanism.automaticTravel !== true) {
      throw new Error(`Moving mechanism ${mechanism.id} must travel automatically.`);
    }
    if (mechanism.recallable !== true) continue;
    const recallTransitions = (mechanism.transitions ?? []).filter((transition) => (
      transition.toStateId === mechanism.initialStateId && transition.actionId
    ));
    const nonInitialStateIds = (mechanism.states ?? [])
      .map((state) => state.id)
      .filter((stateId) => stateId !== mechanism.initialStateId);
    const missingRecallStates = nonInitialStateIds.filter((stateId) => !recallTransitions.some((transition) => (
      transition.fromStateId === stateId || transition.fromStateId === '*'
    )));
    if (missingRecallStates.length) {
      throw new Error(`Recallable mechanism ${mechanism.id} lacks authored recall transitions from ${missingRecallStates.join(', ')}.`);
    }
    for (const transition of recallTransitions) {
      const action = actionById.get(transition.actionId);
      if (!action || action.controllerId !== mechanism.id || !action.anchorId) {
        throw new Error(`Recall transition ${transition.actionId} for ${mechanism.id} lacks a plan-owned console action.`);
      }
    }
  }
  const allAnchorById = new Map([
    ...(plan.anchors ?? []).map((anchor) => [anchor.id, anchor]),
    ...(plan.safeAnchors ?? []).map((anchor) => [anchor.id, anchor]),
  ]);
  const playerStartAnchor = allAnchorById.get(plan.compatibility?.playerStartAnchorId);
  const physicallySafeAnchors = [
    ...(plan.safeAnchors ?? []),
    ...(playerStartAnchor ? [playerStartAnchor] : []),
  ];
  for (const anchor of physicallySafeAnchors) {
    const supportingSurface = surfaceById.get(anchor.safeSurfaceId ?? anchor.surfaceId);
    if (!supportingSurface) {
      throw new Error(`Safe anchor ${anchor.id} references a missing walkable surface.`);
    }
    const { x, y, z } = finitePoint(anchor.position, `safe anchor ${anchor.id}.position`);
    if (x < supportingSurface.bounds.min.x - 0.05
      || x > supportingSurface.bounds.max.x + 0.05
      || z < supportingSurface.bounds.min.z - 0.05
      || z > supportingSurface.bounds.max.z + 0.05) {
      throw new Error(`Safe anchor ${anchor.id} lies outside supporting surface ${supportingSurface.id}.`);
    }
    const expectedY = surfaceElevationAt(supportingSurface, x, z);
    if (Math.abs(y - expectedY) > 0.05) {
      throw new Error(`Safe anchor ${anchor.id} height does not match supporting surface ${supportingSurface.id} within 0.05m.`);
    }
  }
}

export function assembleDungeonPlanV2(plan, {
  difficulty = 1,
  bossProfileId = null,
  semanticRoomPackPresentationRuntime = null,
  allowInvalidPreview = false,
} = {}) {
  assertAssemblerInput(plan, { allowInvalidPreview });
  const fixedRoomPresentation = prepareLegacyFixedRoomPresentation(plan, { allowInvalidPreview });
  const semanticRoomPackPreparation = prepareSemanticRoomPackPresentation(
    plan,
    semanticRoomPackPresentationRuntime,
    { allowInvalidPreview },
  );
  const authoredPresentation = combineAuthoredPresentationOwnership(
    fixedRoomPresentation,
    semanticRoomPackPreparation,
  );
  const planId = plan.planId ?? plan.id;
  let portalContinuityDiagnostics;
  let internalTraversalProof;
  if (allowInvalidPreview) {
    try {
      portalContinuityDiagnostics = assertPortalPhysicalContinuity(plan);
    } catch (error) {
      portalContinuityDiagnostics = plan.portals.map((portal, index) => ({
        portalId: portal.id,
        accepted: false,
        previewOnly: true,
        code: index === 0
          ? error.code ?? 'DUNGEON_V2_INVALID_PREVIEW_PORTAL_CONTRACT'
          : 'DUNGEON_V2_INVALID_PREVIEW_PORTAL_CONTRACT_NOT_EVALUATED',
        message: index === 0 ? error.message : 'Skipped after the first invalid preview portal contract.',
        sampleSpacing: 0.21,
        continuous: false,
        traversable: false,
        walkable: false,
        enclosed: false,
        supported: false,
        minimumWidth: Number(portal.traversal?.minimumWidth) || 0,
        minimumHeadroom: Number(portal.traversal?.minimumHeadroom) || 0,
      }));
    }
    try {
      internalTraversalProof = validateInternalTraversal(plan);
    } catch (error) {
      internalTraversalProof = {
        accepted: false,
        previewOnly: true,
        code: error.code ?? 'DUNGEON_V2_INVALID_PREVIEW_TRAVERSAL_CONTRACT',
        message: error.message,
      };
    }
  } else {
    portalContinuityDiagnostics = assertPortalPhysicalContinuity(plan);
    internalTraversalProof = validateInternalTraversal(plan);
  }
  const tileSize = plan.tileSize ?? DEFAULT_TILE_SIZE;
  const group = new THREE.Group();
  group.name = `dungeonV2:${planId}`;
  group.userData.dungeonPlanId = planId;
  group.userData.dungeonPlanRevision = plan.revision;

  const materials = new MaterialLibraryV2(plan);
  const structuralRegistry = new DungeonStructuralRegistryV2();
  const solidZones = [];
  const aerialBoundaryZones = [];
  const floorTiles = [];
  const platforms = [];
  const traps = [];
  const resources = {
    mechanismObjects: new Map(),
    mechanismFixtures: new Map(),
    mechanismConsoles: new Map(),
    dynamicSurfaces: new Map(),
    dynamicSurfaceByController: new Map(),
    platformSurfaces: new Map(),
    surfaceObjects: new Map(),
    waterObjects: new Map(),
    hazardObjects: new Map(),
    crumbleOverlays: new Map(),
    stairProofs: new Map(),
    stairProfiles: new Map(),
    ladders: [],
    semanticRoomPackPhysicalNodeBindings: new Map(),
    semanticRoomPackDynamicBindingsByPlacementId: new Map(),
    semanticRoomPackWaterBasinBindings: new Map(),
  };
  const semanticRoomPackPresentation = renderSemanticRoomPackPresentation({
    prepared: semanticRoomPackPreparation,
    group,
    registry: structuralRegistry,
  });
  resources.semanticRoomPackPhysicalNodeBindings = semanticRoomPackPresentation.physicalNodeBindings;
  resources.semanticRoomPackDynamicBindingsByPlacementId = semanticRoomPackPresentation.dynamicBindingsByPlacementId;
  resources.semanticRoomPackWaterBasinBindings = semanticRoomPackPresentation.waterBasinBindings;
  const legacyFixedRoomPresentation = renderLegacyFixedRoomPresentation({
    plan,
    prepared: fixedRoomPresentation,
    group,
    registry: structuralRegistry,
    allowInvalidPreview,
  });
  const anchorById = new Map([
    ...(plan.anchors ?? []).map((anchor) => [anchor.id, anchor]),
    ...(plan.safeAnchors ?? []).map((anchor) => [anchor.id, anchor]),
  ]);

  addStructuralBoundaries({
    plan,
    group,
    materials,
    registry: structuralRegistry,
    solidZones,
    aerialBoundaryZones,
    authoredPresentation,
  });
  addStructuralFixtures({
    plan,
    group,
    materials,
    registry: structuralRegistry,
    solidZones,
    aerialBoundaryZones,
    resources,
    authoredPresentation,
    allowInvalidPreview,
  });
  addWalkableSurfaces({
    plan,
    group,
    materials,
    registry: structuralRegistry,
    resources,
    floorTiles,
    platforms,
    authoredPresentation,
    allowInvalidPreview,
  });
  addPortalFrames({
    plan,
    group,
    materials,
    registry: structuralRegistry,
    authoredPresentation,
  });
  const ladders = [
    ...resources.ladders,
    ...addLadders({ plan, group, materials, registry: structuralRegistry }),
  ];
  const doors = addGateObjects({ plan, group, materials, registry: structuralRegistry, anchorById });
  const rewardCollections = addRewards({
    plan,
    group,
    materials,
    anchorById,
    registry: structuralRegistry,
  });
  const actionCollections = addActionInteractables({
    plan,
    anchorById,
    resources,
    registry: structuralRegistry,
  });
  const encounters = createEncounters(plan, anchorById);
  addWaterAndHazards({ plan, group, materials, resources, traps });
  const renderCullGroups = createSafeRenderCullGroups(group);
  const assemblyPerformanceSnapshot = collectAssemblyPerformanceSnapshot(group);

  const rooms = createCompatibilityRooms(plan, tileSize);
  const tiles = new Map();
  const compatibilitySurfaceById = new Map((plan.walkableSurfaces ?? [])
    .map((surface) => [surface.id, surface]));
  const surfaceOrderById = new Map((plan.walkableSurfaces ?? [])
    .map((surface, index) => [surface.id, index]));
  const compatibilityStairProfiles = new Map();
  const compatibilitySelectionElevation = (tile) => {
    const surface = compatibilitySurfaceById.get(tile.surfaceId);
    const isStairs = Boolean(
      surface?.stairs
      || surface?.form === 'stairs'
      || ['stairs', 'walkable-stairs'].includes(surface?.geometry?.type)
      || surface?.shape === 'ramp-tile'
    );
    if (!isStairs) return surface?.bounds?.max?.y ?? tile.elevation ?? 0;
    if (!compatibilityStairProfiles.has(surface.id)) {
      compatibilityStairProfiles.set(surface.id, deriveStairProfile(surface));
    }
    const profile = compatibilityStairProfiles.get(surface.id);
    const worldX = tile.x * tileSize;
    const worldZ = tile.z * tileSize;
    const distance = (worldX - profile.start.x) * profile.direction.x
      + (worldZ - profile.start.z) * profile.direction.z;
    const progress = Math.max(0, Math.min(1, distance / profile.length));
    // Keep this canonical arithmetic independent from THREE.MathUtils.lerp.
    // The facade's one-tile-per-column map represents the lowest authored
    // contract, including sub-ULP distinctions at stair/landing seams.
    return profile.start.y + (profile.end.y - profile.start.y) * progress;
  };
  for (const tile of floorTiles) {
    const key = `${tile.x},${tile.z}`;
    const existing = tiles.get(key);
    const elevation = compatibilitySelectionElevation(tile);
    const existingElevation = existing
      ? compatibilitySelectionElevation(existing)
      : 0;
    const appearsEarlierInPlan = (surfaceOrderById.get(tile.surfaceId) ?? Number.MAX_SAFE_INTEGER)
      < (surfaceOrderById.get(existing?.surfaceId) ?? Number.MAX_SAFE_INTEGER);
    if (!existing
      || elevation < existingElevation
      || (elevation === existingElevation && appearsEarlierInPlan)) {
      tiles.set(key, tile);
    }
  }
  const playerAnchor = anchorById.get(plan.compatibility?.playerStartAnchorId)
    ?? (plan.safeAnchors ?? []).find((anchor) => anchor.purpose === 'player-start')
    ?? (plan.safeAnchors ?? [])[0];
  if (!playerAnchor) throw new Error('Dungeon V2 plan requires a player-start safe anchor.');
  const extractionAnchorId = plan.compatibility?.extractionAnchorId;
  const extractionAnchor = extractionAnchorId ? anchorById.get(extractionAnchorId) : null;
  if (extractionAnchorId && !extractionAnchor) {
    throw new Error(`Dungeon V2 compatibility references missing extraction anchor ${extractionAnchorId}.`);
  }
  const campReturnAnchorId = plan.compatibility?.campReturnAnchorId;
  const campReturnAnchor = campReturnAnchorId ? anchorById.get(campReturnAnchorId) : null;
  if (!campReturnAnchorId || !campReturnAnchor) {
    throw new Error('Dungeon V2 compatibility requires an explicit resolvable campReturnAnchorId.');
  }
  const extractionReward = rewardCollections.shrine;
  const minimap = createMinimap(plan, rooms, anchorById, tileSize);
  const progression = createCompatibilityProgression({
    plan,
    doors,
    keycards: rewardCollections.keycards,
    keySeeker: actionCollections.keySeeker ?? rewardCollections.keySeeker,
    encounters,
    minimap,
    anchorById,
  });
  progression.entranceRoomId ??= playerAnchor.regionId;
  progression.shrineRoomId ??= extractionReward?.regionId ?? extractionReward?.roomId ?? null;
  progression.bossRoomId ??= encounters.find(({ isBoss }) => isBoss)?.roomId ?? null;

  const facade = {
    kind: 'DungeonV2',
    generationMode: 'v2',
    fixture: plan.fixtureKind === 'traversal-lab' || String(planId).includes('traversal-lab')
      ? 'traversal-lab'
      : 'golden',
    generatorVersion: 'v2',
    plan,
    planId,
    seed: plan.seed,
    difficulty,
    bossProfileId,
    group,
    rooms,
    roomArchetypes: rooms.map((room) => ({
      id: room.id,
      archetypeId: room.archetypeId,
      purpose: room.purpose,
      districtId: room.districtId,
      minY: room.minY,
      maxY: room.maxY,
    })),
    tiles,
    floorTiles,
    platforms,
    doors,
    keycards: rewardCollections.keycards,
    chests: rewardCollections.chests,
    rewards: rewardCollections.rewards,
    objectives: (plan.objectives ?? []).map((objective) => ({ ...clonePlain(objective), complete: false })),
    mechanisms: actionCollections.mechanisms,
    safeInteractables: actionCollections.safeInteractables,
    keySeeker: actionCollections.keySeeker ?? rewardCollections.keySeeker,
    shrine: rewardCollections.shrine,
    encounters,
    ladders,
    traps,
    conveyors: [],
    conveyorPuzzles: [],
    puzzleBlocks: [],
    pressurePlates: [],
    npcAnimationMixers: [],
    npcAnimators: [],
    safeZones: [],
    solidZones,
    aerialBoundaryZones,
    progression,
    minimap,
    verticalConnectors: plan.portals.map((portal) => clonePlain(portal)),
    connectionPlans: plan.portals.map((portal) => ({
      id: portal.id,
      logicalConnectionId: `${portal.from.regionId}_${portal.to.regionId}`,
      connectorType: portal.connectorForm,
      fromRoomId: portal.from.regionId,
      toRoomId: portal.to.regionId,
      elevation: portal.from.center.y,
      direction: portal.direction,
    })),
    tileSize,
    playerStart: asVector3(playerAnchor.position, 'player start'),
    playerStartFacing: asVector3(playerAnchor.forward ?? { x: 0, y: 0, z: 1 }, 'player facing'),
    ruinEntryPosition: asVector3(playerAnchor.position, 'ruin entry'),
    campReturnPosition: asVector3(campReturnAnchor.position, 'camp return'),
    shrinePosition: rewardCollections.shrine?.position?.clone?.() ?? null,
    extractionVisualPosition: rewardCollections.shrine?.extractionVisualPosition?.clone?.()
      ?? (extractionAnchor ? asVector3(extractionAnchor.position, 'extraction visual position') : null),
    extractionActionId: rewardCollections.shrine?.extractionActionId ?? null,
    extractionAnchorId: rewardCollections.shrine?.extractionAnchorId ?? extractionAnchorId ?? null,
    extractionPosition: extractionAnchor
      ? asVector3(extractionAnchor.position, 'extraction position')
      : rewardCollections.shrine?.position?.clone?.() ?? null,
    enemySpawnPoints: encounters.flatMap((encounter) => encounter.spawnPoints.map((point) => point.clone())),
    boundsRadius: Math.max(...plan.spatialCells.flatMap((cell) => [
      Math.hypot(cell.bounds.min.x, cell.bounds.min.z),
      Math.hypot(cell.bounds.max.x, cell.bounds.max.z),
    ])),
    renderCullGroups,
    get assemblyPerformance() {
      return clonePlain(assemblyPerformanceSnapshot);
    },
    structuralRegistry,
    structuralDiagnostics: structuralRegistry.snapshot(),
    get legacyPresentationDiagnostics() {
      return clonePlain(materials.legacyAuthoredKit.getDiagnostics());
    },
    get legacyFixedRoomPresentationDiagnostics() {
      return clonePlain(legacyFixedRoomPresentation.diagnostics);
    },
    get semanticRoomPackPresentationDiagnostics() {
      return clonePlain(semanticRoomPackPresentation.diagnostics);
    },
    semanticRoomPackVisualMappings: clonePlain(semanticRoomPackPresentation.visualMappings),
    // Runtime mechanism/environment controllers consume these live bindings;
    // diagnostics use the serializable mapping/summary fields above.
    semanticRoomPackPhysicalNodeBindings: semanticRoomPackPresentation.physicalNodeBindings,
    semanticRoomPackDynamicBindingsByPlacementId: semanticRoomPackPresentation.dynamicBindingsByPlacementId,
    semanticRoomPackWaterBasinBindings: semanticRoomPackPresentation.waterBasinBindings,
    get nativeFixedRoomAssemblyDiagnostics() {
      return buildNativeFixedRoomAssemblyDiagnostics({
        plan,
        root: group,
        registry: structuralRegistry,
        presentation: legacyFixedRoomPresentation,
      });
    },
    legacyFixedRoomVisualMappings: clonePlain(legacyFixedRoomPresentation.visualMappings),
    get structuralAuditSnapshot() {
      return structuralRegistry.auditSnapshot();
    },
    portalContinuityDiagnostics,
    connectorRouteProofs: portalContinuityDiagnostics.map((diagnostic) => {
      const portal = plan.portals.find(({ id }) => id === diagnostic.portalId);
      const approachClearanceVolumes = buildPortalApproachClearanceVolumes(
        plan,
        portal,
        structuralRegistry,
      );
      return {
        portalId: diagnostic.portalId,
        sampleSpacing: diagnostic.sampleSpacing,
        continuous: diagnostic.continuous,
        traversable: diagnostic.traversable,
        walkable: diagnostic.walkable,
        enclosed: diagnostic.enclosed,
        supported: diagnostic.supported,
        minimumWidth: diagnostic.minimumWidth,
        minimumHeadroom: diagnostic.minimumHeadroom,
        approachClearanceVolumes,
        approachClearanceAccepted: approachClearanceVolumes.every(({ accepted }) => accepted),
        uncoveredSamples: [],
        blockedSamples: [],
        visualColliderMismatches: [],
        stairProofs: (portal?.physicalRoute?.surfaceIds ?? [])
          .map((surfaceId) => resources.stairProofs.get(surfaceId))
          .filter(Boolean)
          .map((proof) => clonePlain(proof)),
      };
    }),
    stairProofs: [...resources.stairProofs.values()].map((proof) => clonePlain(proof)),
    getExactStairSurfaceAt(position, { maxVerticalGap = Infinity, tolerance = 0.001 } = {}) {
      if (!position) return null;
      let nearest = null;
      let nearestDistance = Infinity;
      let nearestIsCoreCandidate = false;
      for (const [surfaceId, profile] of resources.stairProfiles) {
        const sample = sampleExactStairSurface(profile, position, tolerance);
        if (!sample.inside) continue;
        const distance = Math.abs(sample.elevation - (position.y ?? sample.elevation));
        const isCoreCandidate = sample.along >= 0 && sample.along <= profile.length;
        // Tolerance exists to keep one profile selectable at its outer edge;
        // it must not let the previous tile win after the player has crossed
        // a shared seam. Prefer a profile whose projected position is inside
        // its true [0,length] run, then choose the nearest vertical surface.
        if (distance <= maxVerticalGap && (
          nearest === null
          || (isCoreCandidate && !nearestIsCoreCandidate)
          || (isCoreCandidate === nearestIsCoreCandidate && distance < nearestDistance)
        )) {
          nearest = {
            surfaceId,
            blocksBelow: profile.blocksBelow,
            minimumStructuralY: profile.minimumStructuralY,
            coreInside: isCoreCandidate,
            ...sample,
          };
          nearestDistance = distance;
          nearestIsCoreCandidate = isCoreCandidate;
        }
      }
      return nearest;
    },
    getExactStairSurfaceElevationAt(position, options = {}) {
      return facade.getExactStairSurfaceAt(position, options)?.elevation ?? null;
    },
    isPositionOnExactStairSurface(surfaceId, position, tolerance = 0.001) {
      const profile = resources.stairProfiles.get(surfaceId);
      return profile ? sampleExactStairSurface(profile, position, tolerance).inside : false;
    },
    internalTraversalProof,
    validation: clonePlain(plan.validation ?? { accepted: true, errors: [], warnings: [] }),
    recoverySafeguard: {
      minimumWalkableY: Math.min(...plan.walkableSurfaces.map((surface) => surface.bounds.min.y)),
      safeguardY: Math.min(...plan.walkableSurfaces.map((surface) => surface.bounds.min.y)) - 8,
      activationCount: 0,
    },
    dispose() {
      facade.environmentRuntime?.dispose?.();
      // Removes cloned instances and disposes only clone-owned materials.
      // Cached GLB geometry is shared across dungeon resets and must survive.
      semanticRoomPackPresentation.dispose?.();
      group.traverse((object) => {
        if (!object.userData?.v2LegacyAuthoredPresentation
          && !object.userData?.v2LegacyFixedRoomPresentation
          && !object.userData?.v2SemanticRoomPackPresentation) object.geometry?.dispose?.();
      });
      legacyFixedRoomPresentation.adapter?.dispose?.();
      materials.dispose();
      group.removeFromParent();
    },
  };

  facade.environmentRuntime = new DungeonRuntimeV2({
    plan,
    facade,
    resources,
    allowInvalidPreview,
  });
  facade.specialEnvironment = facade.environmentRuntime;
  facade.specialEnvironmentId = 'dungeon-v2-runtime';
  facade.runtimeValidationErrors = facade.environmentRuntime.errors;
  Object.defineProperty(facade, 'runtimeDiagnostics', {
    configurable: false,
    enumerable: true,
    get() {
      const diagnostics = facade.environmentRuntime.getDiagnostics();
      return {
        ...diagnostics,
        recoverySafeguardActivations: diagnostics.safeguardActivations,
      };
    },
  });
  return facade;
}

export class DungeonSceneAssemblerV2 {
  assemble(plan, options = {}) {
    return assembleDungeonPlanV2(plan, options);
  }
}
