import { cloneDungeonAugmentationValue } from './canonical.js';
import { toDungeonFacing } from './geometry.js';

export const OBJECTIVE_COVERAGE_STATION_SIDE_FALLBACK_SEARCH_VARIANT = 7;
export const OBJECTIVE_COVERAGE_STATION_SIDE_ALTERNATIVE_FIELD =
  'planningStationSideAlternativeOrdinal';

function toDungeonCardinalFacing(value) {
  const facing = toDungeonFacing(value);
  if (Math.abs(facing.x) >= Math.abs(facing.z)) {
    return { x: Math.sign(facing.x) || 1, y: 0, z: 0 };
  }
  return { x: 0, y: 0, z: Math.sign(facing.z) || 1 };
}

function rotateCoverageStationSidePoint(
  point,
  oldAnchor,
  newAnchor,
  oldFacing,
  newFacing,
) {
  const oldTangent = { x: -Number(oldFacing.z), z: Number(oldFacing.x) };
  const newTangent = { x: -Number(newFacing.z), z: Number(newFacing.x) };
  const deltaX = Number(point.x) - Number(oldAnchor.x);
  const deltaZ = Number(point.z) - Number(oldAnchor.z);
  const forward = deltaX * Number(oldFacing.x) + deltaZ * Number(oldFacing.z);
  const tangent = deltaX * oldTangent.x + deltaZ * oldTangent.z;
  return {
    ...cloneDungeonAugmentationValue(point),
    x: Number(newAnchor.x) + forward * Number(newFacing.x) + tangent * newTangent.x,
    z: Number(newAnchor.z) + forward * Number(newFacing.z) + tangent * newTangent.z,
  };
}

function rotateCoverageStationSideVolume(
  volume,
  oldAnchor,
  newAnchor,
  oldFacing,
  newFacing,
) {
  const rotated = {
    ...cloneDungeonAugmentationValue(volume),
    center: rotateCoverageStationSidePoint(
      volume.center,
      oldAnchor,
      newAnchor,
      oldFacing,
      newFacing,
    ),
  };
  const swapsPlanarAxes = Math.abs(Number(oldFacing.x))
    !== Math.abs(Number(newFacing.x));
  if (swapsPlanarAxes && rotated.size) {
    rotated.size = {
      ...rotated.size,
      x: Number(volume.size?.z ?? 0),
      z: Number(volume.size?.x ?? 0),
    };
  }
  return rotated;
}

/**
 * Resolve one complete host-advertised station-side tuple. Alternate ordinal
 * zero is the canonical grant. Ordinal one uses the opposite viable side at
 * every station and rotates only the socket-scoped overlap envelopes.
 */
export function objectiveCoverageGrantForStationSideAlternative(
  grant,
  alternativeOrdinal = 0,
) {
  const normalizedAlternativeOrdinal = Math.max(
    0,
    Math.trunc(Number(alternativeOrdinal) || 0),
  );
  if (grant?.kind !== 'objective-route-coverage'
    || normalizedAlternativeOrdinal === 0) return grant;
  if (Number(grant?.planningStationSideAlternativeOrdinal)
    === normalizedAlternativeOrdinal) return grant;
  const stationDiagnostics = grant?.source?.planningStationSideDiagnostics
    ?? grant?.planningStationSideDiagnostics;
  if (!Array.isArray(stationDiagnostics)
    || stationDiagnostics.length !== grant.endpointSockets?.length) return grant;

  const alternateRecords = grant.endpointSockets.map((endpoint, endpointOrdinal) => {
    const diagnostics = stationDiagnostics[endpointOrdinal];
    const sourceCenterlinePosition = endpoint.sourceCenterlinePosition;
    const canonicalFacing = toDungeonCardinalFacing(endpoint.facing);
    const alternate = (diagnostics?.candidates ?? []).filter((candidate) => (
      candidate?.stationEligible !== false
        && candidate?.stationBodyBlocked !== true
        && candidate?.fullRoomBodyBlocked !== true
        && candidate?.approachIntersectsOwnCenterline !== true
        && Number(candidate?.hardRouteOverlapArea ?? 0) <= 1e-6
        && Number(candidate?.roomOverlapArea ?? 0) <= 1e-6
        && Number(candidate?.ownRouteOverlapArea ?? 0) <= 1e-6
        && candidate?.fullRoomWitness?.center
        && candidate?.fullRoomWitness?.continuationCenter
        && candidate?.facing
    )).map((candidate) => ({
      candidate,
      facing: toDungeonCardinalFacing(candidate.facing),
    })).filter(({ facing }) => (
      Number(facing.x) !== Number(canonicalFacing.x)
        || Number(facing.z) !== Number(canonicalFacing.z)
    )).sort((first, second) => (
      Number(first.candidate.authoredScore ?? 0)
        - Number(second.candidate.authoredScore ?? 0)
        || Number(first.candidate.sideSign ?? 0)
          - Number(second.candidate.sideSign ?? 0)
    ))[0] ?? null;
    if (!alternate || !sourceCenterlinePosition) return null;
    const canonicalThresholdDelta = {
      x: Number(endpoint.position.x) - Number(sourceCenterlinePosition.x),
      z: Number(endpoint.position.z) - Number(sourceCenterlinePosition.z),
    };
    const thresholdLeadMeters = Math.abs(
      canonicalThresholdDelta.x * Number(canonicalFacing.x)
        + canonicalThresholdDelta.z * Number(canonicalFacing.z),
    );
    const position = {
      ...cloneDungeonAugmentationValue(endpoint.position),
      x: Number(sourceCenterlinePosition.x)
        + Number(alternate.facing.x) * thresholdLeadMeters,
      z: Number(sourceCenterlinePosition.z)
        + Number(alternate.facing.z) * thresholdLeadMeters,
    };
    const witness = alternate.candidate.fullRoomWitness;
    const endpointElevation = Number(endpoint.position.y ?? 0);
    const updatedEndpoint = {
      ...cloneDungeonAugmentationValue(endpoint),
      position,
      facing: cloneDungeonAugmentationValue(alternate.facing),
      ...(endpoint.planningModuleCenter ? {
        planningModuleCenter: {
          ...cloneDungeonAugmentationValue(witness.center),
          y: endpointElevation,
        },
      } : {}),
      ...(endpoint.planningContinuationCenter ? {
        planningContinuationCenter: {
          ...cloneDungeonAugmentationValue(witness.continuationCenter),
          y: endpointElevation,
        },
      } : {}),
      ...(Array.isArray(endpoint.planningContinuationRoute) ? {
        planningContinuationRoute: (witness.continuationRoute ?? []).map((point) => ({
          ...cloneDungeonAugmentationValue(point),
          y: endpointElevation,
        })),
      } : {}),
    };
    if (updatedEndpoint.source) {
      updatedEndpoint.source = {
        ...updatedEndpoint.source,
        position: cloneDungeonAugmentationValue(position),
        facing: cloneDungeonAugmentationValue(alternate.facing),
        ...(updatedEndpoint.source.planningModuleCenter ? {
          planningModuleCenter: cloneDungeonAugmentationValue(
            updatedEndpoint.planningModuleCenter,
          ),
        } : {}),
        ...(updatedEndpoint.source.planningContinuationCenter ? {
          planningContinuationCenter: cloneDungeonAugmentationValue(
            updatedEndpoint.planningContinuationCenter,
          ),
        } : {}),
        ...(Array.isArray(updatedEndpoint.source.planningContinuationRoute) ? {
          planningContinuationRoute: cloneDungeonAugmentationValue(
            updatedEndpoint.planningContinuationRoute,
          ),
        } : {}),
      };
    }
    return {
      endpoint,
      updatedEndpoint,
      canonicalFacing,
      alternateFacing: alternate.facing,
    };
  });
  if (alternateRecords.some((record) => !record)) return grant;

  const recordBySocketId = new Map(alternateRecords.map((record) => [
    String(record.endpoint.id),
    record,
  ]));
  const rotateOverlapGrant = (overlapGrant) => {
    const record = recordBySocketId.get(String(overlapGrant.socketId ?? ''));
    if (!record?.endpoint?.position || !overlapGrant?.center) {
      return cloneDungeonAugmentationValue(overlapGrant);
    }
    return rotateCoverageStationSideVolume(
      overlapGrant,
      record.endpoint.position,
      record.updatedEndpoint.position,
      record.canonicalFacing,
      record.alternateFacing,
    );
  };
  return {
    ...cloneDungeonAugmentationValue(grant),
    endpointSockets: alternateRecords.map(({ updatedEndpoint }) => updatedEndpoint),
    socketLandingOverlapGrants: (grant.socketLandingOverlapGrants ?? [])
      .map(rotateOverlapGrant),
    socketModuleOverlapGrants: (grant.socketModuleOverlapGrants ?? [])
      .map(rotateOverlapGrant),
    planningStationSideAlternativeOrdinal: 1,
  };
}

/**
 * Use the host's opposite station sides as one late bounded search axis. The
 * first seven variants retain the canonical host tuple and all public IDs.
 */
export function objectiveCoverageGrantForStationSideSearchVariant(
  grant,
  searchVariant = 0,
) {
  const normalizedSearchVariant = Math.max(
    0,
    Math.trunc(Number(searchVariant) || 0),
  );
  return objectiveCoverageGrantForStationSideAlternative(
    grant,
    normalizedSearchVariant >= OBJECTIVE_COVERAGE_STATION_SIDE_FALLBACK_SEARCH_VARIANT
      ? 1
      : 0,
  );
}

/**
 * Reconstruct the exact host grant selected by a serialized route-network
 * operation. The optional ordinal lives on the operation, so it participates
 * in the ordinary canonical overlay hash while preserving canonical V4 plans
 * (and every V1 plan) byte-for-byte when no alternate station side was used.
 */
export function inspectObjectiveCoverageStationSideOperationContract(
  grant,
  operation,
) {
  const rawOrdinal = operation?.[OBJECTIVE_COVERAGE_STATION_SIDE_ALTERNATIVE_FIELD];
  const fieldPresent = rawOrdinal != null;
  const ordinal = fieldPresent ? Number(rawOrdinal) : 0;
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > 1) {
    return {
      accepted: false,
      reason: 'alternative-ordinal-unsupported',
      ordinal,
      grant,
    };
  }
  if (ordinal === 0) {
    return { accepted: true, reason: null, ordinal, grant };
  }
  if (grant?.kind !== 'objective-route-coverage') {
    return {
      accepted: false,
      reason: 'alternative-operation-kind-invalid',
      ordinal,
      grant,
    };
  }
  if (Number(grant?.planningStationSideAlternativeOrdinal) === ordinal) {
    return { accepted: true, reason: null, ordinal, grant };
  }
  const resolvedGrant = objectiveCoverageGrantForStationSideAlternative(grant, ordinal);
  if (resolvedGrant === grant
    || Number(resolvedGrant?.planningStationSideAlternativeOrdinal) !== ordinal) {
    return {
      accepted: false,
      reason: 'alternative-station-side-unavailable',
      ordinal,
      grant,
    };
  }
  return {
    accepted: true,
    reason: null,
    ordinal,
    grant: resolvedGrant,
  };
}

export function objectiveCoverageGrantForOperationStationSide(grant, operation) {
  const inspection = inspectObjectiveCoverageStationSideOperationContract(
    grant,
    operation,
  );
  return inspection.accepted ? inspection.grant : grant;
}
