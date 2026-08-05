import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import * as THREE from 'three';

import {
  DungeonGenerator,
  verifyIndustrialV4AuthoredMaterializedDescriptors,
} from '../src/DungeonGenerator.js';
import { hashCanonicalValue } from '../src/dungeon-augmentation/canonical.js';
import { createDungeonRouteEndpointSeam } from '../src/dungeon-augmentation/geometry.js';
import { materializeIndustrialOverlay } from
  '../src/dungeon-augmentation/IndustrialOverlayMaterializer.js';
import {
  augmentDungeonDraft,
  createSegment,
} from '../src/dungeon-augmentation/planner.js';
import {
  computeDungeonAugmentationPlanHash,
  computeEffectiveDungeonPlanHash,
} from '../src/dungeon-augmentation/validation.js';
import { loadIndustrialV4AuthoredArtifactPayload } from
  '../src/dungeon-augmentation/authored/IndustrialV4AuthoredArtifact.generated.js';
import { INDUSTRIAL_V4_AUTHORED_LEVEL_SOURCE } from
  '../src/dungeon-augmentation/authored/IndustrialV4AuthoredLevelSource.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(
  repositoryRoot,
  'src/dungeon-augmentation/authored/IndustrialV4AuthoredLevelSource.js',
);
const writeSource = process.argv.includes('--write-source');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function authoredLocalApproachWitness(endpoint, socketById) {
  const socket = socketById.get(String(endpoint.socketId)) ?? endpoint;
  return {
    nodeId: String(endpoint.nodeId ?? socket.nodeId ?? ''),
    socketId: String(endpoint.socketId ?? endpoint.id ?? socket.id ?? ''),
    localSocketId: socket.localSocketId ?? endpoint.localSocketId ?? null,
    path: [
      {
        x: socket.position.x - socket.facing.x * 5.6,
        y: socket.position.y - socket.facing.y * 5.6,
        z: socket.position.z - socket.facing.z * 5.6,
      },
      { ...socket.position },
    ],
  };
}

function rebuildSegment(oldSegment, socketById) {
  const from = clone(oldSegment.from);
  const to = clone(oldSegment.to);
  const fromSocket = socketById.get(String(from.socketId));
  const toSocket = socketById.get(String(to.socketId));
  if (fromSocket) {
    from.position = { ...fromSocket.position };
    from.authoredSocketPosition = { ...fromSocket.position };
    from.facing = { ...fromSocket.facing };
  }
  if (toSocket) {
    to.position = { ...toSocket.position };
    to.authoredSocketPosition = { ...toSocket.position };
    to.facing = { ...toSocket.facing };
  }
  const pathPoints = clone(oldSegment.path);
  pathPoints[0] = { ...from.position };
  pathPoints[pathPoints.length - 1] = { ...to.position };
  const rebuilt = createSegment({
    id: oldSegment.id,
    operationId: oldSegment.operationId,
    parentRegionId: oldSegment.parentRegionId,
    physicalOrdinal: oldSegment.physicalOrdinal,
    logicalEdgeId: oldSegment.logicalEdgeId,
    from,
    to,
    connectorFamily: oldSegment.connectorFamily,
    themeBinding: clone(oldSegment.themeBinding),
    coordinateSpace: oldSegment.coordinateSpace,
    path: pathPoints,
    heightMeters: oldSegment.heightMeters,
    landingDepthMeters: 5.6,
  });
  const geometryKeys = new Set([
    'from', 'to', 'path', 'occupiedVolumes', 'clearanceVolumes',
    'landings', 'landingVolumes', 'endpointSeams', 'localApproachWitnesses',
  ]);
  for (const [key, value] of Object.entries(oldSegment)) {
    if (!geometryKeys.has(key) && !(key in rebuilt)) rebuilt[key] = clone(value);
  }
  rebuilt.endpointSeams = (oldSegment.endpointSeams ?? []).map((seam, index) => {
    const endpoint = index === 0 ? from : to;
    return createDungeonRouteEndpointSeam(endpoint, {
      id: seam.id,
      segmentId: oldSegment.id,
      operationId: oldSegment.operationId,
      networkId: seam.networkId,
      nodeId: seam.nodeId,
      socketId: seam.socketId,
      localSocketId: seam.localSocketId,
      role: seam.role,
      tileSize: seam.tileSize,
      widthTiles: seam.widthTiles,
      insideDepthTiles: seam.insideDepthTiles,
      outsideDepthTiles: seam.outsideDepthTiles,
      clearanceHeightMeters: seam.overlapEnvelope?.size?.y ?? 5.6,
      elevationBand: seam.elevationBand,
      parentOwnerId: seam.overlapEnvelope?.parentOwnerId ?? null,
    });
  });
  rebuilt.localApproachWitnesses = [from, to].map((endpoint) => (
    authoredLocalApproachWitness(endpoint, socketById)
  ));
  return rebuilt;
}

function stripPlacementProvenance(overlayPlan) {
  delete overlayPlan.placementProvenance;
  for (const record of [
    ...(overlayPlan.operations ?? []),
    ...(overlayPlan.nodes ?? []),
    ...(overlayPlan.segments ?? []),
  ]) delete record.placementProvenance;
  return overlayPlan;
}

function descriptor(record, kind, details = {}) {
  return {
    id: String(record.id),
    kind,
    ...details,
    recordHash: hashCanonicalValue(record, {
      namespace: 'ruindivex-industrial-v4-authored-' + kind + '-record/v1',
    }),
  };
}

function compactMaterializedLayout(layout) {
  return {
    schema: 'ruindivex-dungeon-augmentation-effective-layout-records/v1',
    recordMode: 'compact-descriptors',
    rooms: layout.rooms.map((room) => descriptor(room, 'room', {
      blueprintId: room.augmentationBlueprintId ?? null,
      operationId: room.augmentationOperationId ?? null,
      x: Number(room.x),
      z: Number(room.z),
      baseElevation: Number(room.baseElevation ?? 0),
      isDungeonSupplement: room.isDungeonSupplement === true,
    })),
    connectionPlans: layout.connectionPlans.map((plan) => descriptor(
      plan,
      'connection',
      {
        fromRoomId: plan.fromRoomId ?? null,
        toRoomId: plan.toRoomId ?? null,
        isDungeonSupplement: plan.isDungeonSupplement === true,
        graphOnly: plan.isSupplementGraphConnection === true
          || plan.connectorVariantConstraints?.graphOnly === true,
      },
    )),
    connectorJunctionProxies: layout.connectorJunctionProxies.map((proxy) => (
      descriptor(proxy, 'connector-junction', {
        operationId: proxy.augmentationOperationId ?? null,
        x: Number(proxy.x),
        z: Number(proxy.z),
        baseElevation: Number(proxy.baseElevation ?? 0),
      })
    )),
    supplementalRoomIds: [...layout.supplementalRoomIds],
    supplementalConnectorJunctionIds: [...layout.supplementalConnectorJunctionIds],
    supplementalConnectionIds: [...layout.supplementalConnectionIds],
    supplementalPhysicalConnectionIds: [...layout.supplementalPhysicalConnectionIds],
    supplementalGraphOnlyConnectionIds: [...layout.supplementalGraphOnlyConnectionIds],
    assemblyOverlayPlanRef: {
      schema: 'ruindivex-dungeon-augmentation-overlay-reference/v1',
      augmentationPlanHash: layout.assemblyOverlayPlan?.augmentationPlanHash,
    },
    diagnostics: {
      accepted: true,
      reason: layout.diagnostics?.reason ?? 'materialized',
      errors: [],
      routeNetworks: clone(layout.diagnostics?.routeNetworks ?? []),
    },
  };
}

const artifact = await loadIndustrialV4AuthoredArtifactPayload();
let tapeCursor = 0;
let capturedContext = null;
const generator = new DungeonGenerator({
  offlineAugmentationPlanner: augmentDungeonDraft,
  random: () => artifact.canonicalBaseRandomTape[tapeCursor++],
  difficulty: Number(artifact.canonicalBaseDraft.difficulty),
  augmentationProfileId: artifact.profileId,
  basePlanHash: artifact.baseGeometryHash,
});
generator._planIndustrialDungeonAugmentation = (input) => {
  capturedContext = generator._createIndustrialDungeonAugmentationPlanningContext(input);
  return null;
};
const texture = new THREE.Texture();
generator.textureCache.set('authored-materialization-verifier', texture);
generator._loadRuinTexture = () => texture;

let dungeon = null;
try {
  dungeon = generator._generateOnce();
  if (tapeCursor !== artifact.canonicalBaseRandomTape.length) {
    throw new Error(
      'Canonical base tape consumption drifted: '
        + tapeCursor + '/' + artifact.canonicalBaseRandomTape.length + '.',
    );
  }
  if (!capturedContext) throw new Error('The authored pre-commit planning seam was not captured.');
  const baseDraft = clone(capturedContext.baseDraft);
  const baseGeometryHash = hashCanonicalValue(baseDraft, {
    namespace: 'ruindivex-industrial-v4-authored-base-geometry/v1',
    omitKeys: ['basePlanHash', 'planHash'],
  });
  if (!writeSource && baseGeometryHash !== artifact.baseGeometryHash) {
    throw new Error('Canonical base geometry drifted: ' + baseGeometryHash + '.');
  }
  const overlayPlan = clone(artifact.overlayPlan);
  const endpointSocketIds = new Set([
    'industrial-v1:main-region:route-socket:enemyNest_keycardRoom:1',
    'industrial-v1:main-region:route-socket:keycardRoom_trapRoom:0',
  ]);
  const grantSockets = capturedContext.host.extensionRegions.flatMap((region) => (
    (region.routeNetworkGrants ?? []).flatMap((grant) => grant.endpointSockets ?? [])
  )).filter((socket) => endpointSocketIds.has(String(socket.id)));
  const socketById = new Map([
    ...overlayPlan.nodes.flatMap((node) => (node.sockets ?? []).map((socket) => (
      [String(socket.id), socket]
    ))),
    ...grantSockets.map((socket) => [String(socket.id), socket]),
  ]);
  overlayPlan.segments = overlayPlan.segments.map((segment) => (
    endpointSocketIds.has(String(segment.from?.socketId))
      || endpointSocketIds.has(String(segment.to?.socketId))
      ? rebuildSegment(segment, socketById)
      : segment
  ));
  overlayPlan.augmentationPlanHash = computeDungeonAugmentationPlanHash(overlayPlan);
  overlayPlan.effectivePlanHash = computeEffectiveDungeonPlanHash(
    overlayPlan.basePlanHash,
    overlayPlan.augmentationPlanHash,
  );
  const materialized = materializeIndustrialOverlay({
    rooms: clone(capturedContext.planningSnapshot.rooms),
    connectionPlans: clone(capturedContext.planningSnapshot.connectionPlans),
    overlayPlan,
    extensionRegions: clone(capturedContext.host.extensionRegions),
    tileSize: generator.tileSize,
  });
  if (materialized.diagnostics?.accepted !== true) {
    throw new Error(
      'Authored materialization was rejected: '
        + JSON.stringify(materialized.diagnostics?.errors ?? []),
    );
  }
  const compact = compactMaterializedLayout(materialized);
  const verification = verifyIndustrialV4AuthoredMaterializedDescriptors(
    writeSource ? compact : artifact.materializedLayout,
    materialized,
  );
  if (!verification.accepted) {
    throw new Error(
      'Authored compact descriptors are stale: ' + JSON.stringify(verification.errors),
    );
  }

  if (writeSource) {
    const source = clone(INDUSTRIAL_V4_AUTHORED_LEVEL_SOURCE);
    baseDraft.basePlanHash = baseGeometryHash;
    baseDraft.planHash = baseGeometryHash;
    source.canonicalBaseDraft = baseDraft;
    const sourceOverlayPlan = stripPlacementProvenance(clone(overlayPlan));
    sourceOverlayPlan.basePlanHash = baseGeometryHash;
    sourceOverlayPlan.augmentationPlanHash = computeDungeonAugmentationPlanHash(
      sourceOverlayPlan,
    );
    sourceOverlayPlan.effectivePlanHash = computeEffectiveDungeonPlanHash(
      baseGeometryHash,
      sourceOverlayPlan.augmentationPlanHash,
    );
    source.overlayPlan = sourceOverlayPlan;
    source.materializedLayout = compact;
    const text = '// Generated by scripts/author-industrial-v4-artifact-source.mjs.\n'
      + '// Browser runtime must load only the compiled artifact, never this offline source.\n'
      + 'export const INDUSTRIAL_V4_AUTHORED_LEVEL_SOURCE = '
      + JSON.stringify(source)
      + ';\n';
    await writeFile(sourcePath, text, 'utf8');
  }

  process.stdout.write(JSON.stringify({
    accepted: true,
    mode: writeSource ? 'write-source' : 'check',
    tapeLength: tapeCursor,
    baseGeometryHash,
    counts: verification.counts,
  }) + '\n');
} finally {
  if (dungeon) generator._disposeGeneratedDungeonCandidate(dungeon);
  texture.dispose();
}
