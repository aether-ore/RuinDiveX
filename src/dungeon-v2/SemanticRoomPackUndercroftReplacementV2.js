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
import { compileSemanticRoomPackPlacementV2 } from './SemanticRoomPackPlanAdapterV2.js';
import { getSemanticRoomPackV1Descriptor } from './SemanticRoomPackV1Catalog.js';
import { deriveDungeonTopologySignaturesV2 } from './DungeonTopologySignatureV2.js';

export const SEMANTIC_ROOM_PACK_UNDERCROFT_REPLACEMENT_V2_REVISION = 1;

const ROOM_ID_BY_TYPE = Object.freeze({
  magma: 'rdx_magma_foundry_undercroft',
  electrical: 'rdx_electric_transformer_undercroft',
});
const ENTRY_PORTAL_ID = 'portal.hazard-intake-core';
const RETURN_PORTAL_ID = 'portal.hazard-core-credential-return';
const PACK_CELL_ID = 'cell.semantic-room-pack.undercroft';
const PLACEMENT_ID = 'placement.semantic-room-pack.undercroft';
const EPSILON = 1e-6;

function round(value) {
  const result = Math.round(Number(value) * 1e9) / 1e9;
  return Object.is(result, -0) ? 0 : result;
}

function vector(x, y, z) {
  return { x: round(x), y: round(y), z: round(z) };
}

function cloneBounds(bounds) {
  return { min: { ...bounds.min }, max: { ...bounds.max } };
}

function translateBounds(bounds, delta) {
  return {
    min: vector(bounds.min.x + delta.x, bounds.min.y + delta.y, bounds.min.z + delta.z),
    max: vector(bounds.max.x + delta.x, bounds.max.y + delta.y, bounds.max.z + delta.z),
  };
}

function centeredBounds(position, size) {
  return {
    min: vector(position.x - size.x * 0.5, position.y - size.y * 0.5, position.z - size.z * 0.5),
    max: vector(position.x + size.x * 0.5, position.y + size.y * 0.5, position.z + size.z * 0.5),
  };
}

function boundsSize(bounds) {
  return vector(
    bounds.max.x - bounds.min.x,
    bounds.max.y - bounds.min.y,
    bounds.max.z - bounds.min.z,
  );
}

function assertMutablePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new TypeError('Undercroft replacement requires a mutable DungeonPlanV2 draft.');
  }
  for (const key of [
    'regions', 'modulePlacements', 'semanticRoomPackPlacements', 'spatialCells',
    'structuralBoundaries', 'walkableSurfaces', 'structuralFixtures', 'portals',
    'traversalLinks', 'anchors', 'safeAnchors', 'actions', 'rewards',
    'environmentStates', 'mechanisms',
  ]) {
    if (!Array.isArray(plan[key]) || Object.isFrozen(plan[key])) {
      throw new TypeError(`Undercroft replacement requires mutable plan.${key}.`);
    }
  }
  if (plan.fixtureKind !== 'golden-complex') {
    throw new RangeError('Authored Undercroft macro replacement is Golden-complex only.');
  }
}

function undercroftTypeFor(plan, requested) {
  const type = requested ?? plan.undercroftType;
  if (!ROOM_ID_BY_TYPE[type]) throw new RangeError(`Unsupported Undercroft type ${type ?? '<missing>'}.`);
  if (plan.undercroftType && plan.undercroftType !== type) {
    throw new RangeError(`Requested ${type} Undercroft does not match plan ${plan.undercroftType}.`);
  }
  return type;
}

function colliderBounds(collider) {
  const center = collider.worldCenter;
  if (collider.shape === 'cylinder') {
    return centeredBounds(center, {
      x: collider.worldRadius * 2,
      y: collider.worldHeight,
      z: collider.worldRadius * 2,
    });
  }
  if (collider.shape !== 'box') throw new TypeError(`Unsupported manifest collider shape ${collider.shape}.`);
  const halfX = collider.worldSize.x * 0.5;
  const halfY = collider.worldSize.y * 0.5;
  const halfZ = collider.worldSize.z * 0.5;
  const cosine = Math.abs(Math.cos(collider.worldYawRadians));
  const sine = Math.abs(Math.sin(collider.worldYawRadians));
  const extentX = halfX * cosine + halfZ * sine;
  const extentZ = halfX * sine + halfZ * cosine;
  return {
    min: vector(center.x - extentX, center.y - halfY, center.z - extentZ),
    max: vector(center.x + extentX, center.y + halfY, center.z + extentZ),
  };
}

function rotatedSide(localSide, yawQuarterTurns) {
  if (localSide === 'floor' || localSide === 'ceiling') return localSide;
  const order = ['north', 'west', 'south', 'east'];
  const index = order.indexOf(localSide);
  if (index < 0) throw new Error(`Unsupported authored side ${localSide}.`);
  return order[(index + yawQuarterTurns) % order.length];
}

function shellSide(sourceNodeName, yawQuarterTurns) {
  if (/^SHELL_FLOOR(?:_|$)/u.test(sourceNodeName)) return 'floor';
  if (/^SHELL_CEILING(?:_|$)/u.test(sourceNodeName)) return 'ceiling';
  const match = sourceNodeName.match(/_(NORTH|SOUTH|EAST|WEST)(?:_|$)/u);
  if (!match) throw new Error(`Manifest shell ${sourceNodeName} has no cardinal side.`);
  return rotatedSide(match[1].toLowerCase(), yawQuarterTurns);
}

function sideForForward(forward) {
  if (Math.abs(forward.x - 1) <= EPSILON) return 'east';
  if (Math.abs(forward.x + 1) <= EPSILON) return 'west';
  if (Math.abs(forward.z - 1) <= EPSILON) return 'south';
  if (Math.abs(forward.z + 1) <= EPSILON) return 'north';
  throw new Error(`Socket forward is not cardinal: ${JSON.stringify(forward)}.`);
}

function visualFields(placement, record) {
  return {
    visualId: `visual.${record.id}`,
    visualIds: [`visual.${record.id}`],
    presentationOwnerId: placement.id,
    descriptorReference: {
      packId: placement.packId,
      packRevision: placement.packRevision,
      roomId: placement.roomId,
      placementId: placement.id,
      sourceNodeName: record.sourceNodeName,
      colliderId: record.colliderId,
      collisionSourcePolicy: placement.collisionSourcePolicy,
    },
  };
}

function enrichBoundary(placement, record) {
  const bounds = colliderBounds(record);
  const side = shellSide(record.sourceNodeName, placement.placementTransform.yawQuarterTurns);
  return {
    ...clonePlanData(record),
    regionId: 'hazard-core',
    cellId: PACK_CELL_ID,
    side,
    kind: 'solid',
    bounds,
    openings: [],
    materialProfileId: `semantic-room-pack-v1.${placement.archetype}.shell`,
    visualProfile: `semantic-room-pack-v1:${placement.roomId}:${side}`,
    collider: true,
    collision: 'static',
    opaque: true,
    colliderIds: [record.colliderId],
    colliderBounds: [bounds],
    gameplayPurpose: `authored enclosed ${side} shell for the playable Undercroft`,
    ...visualFields(placement, record),
  };
}

function fixturePurpose(record) {
  return ({
    support: 'visible load-bearing authored support',
    rail: 'authored fall-prevention railing',
    console: 'reachable authored hazard control',
    furnace: 'foundry processing machinery',
    transformer: 'electrical transformer machinery',
  })[record.semantic] ?? `authored ${record.semantic} machinery`;
}

function enrichFixture(placement, record, supportBoundaryIds) {
  const bounds = colliderBounds(record);
  return {
    ...clonePlanData(record),
    type: `semantic-room-pack-${record.semantic}`,
    regionId: 'hazard-core',
    cellId: PACK_CELL_ID,
    bounds,
    gameplayPurpose: fixturePurpose(record),
    collision: 'blocking',
    accessibility: 'reachable',
    supportBoundaryIds: [...supportBoundaryIds],
    colliderIds: [record.colliderId],
    colliderBounds: [bounds],
    blocksAerialTraversal: true,
    ...visualFields(placement, record),
  };
}

function enrichSurface(placement, descriptor, record, supportBoundaryIds, fixtures) {
  const bounds = colliderBounds(record);
  const supportFixtureIds = fixtures
    .filter((fixture) => fixture.sourceNodeName.startsWith(`SUPPORT_${record.sourceNodeName}_`))
    .map(({ id }) => id);
  const declaredPurpose = descriptor.platformPurposes?.[record.sourceNodeName];
  return {
    ...clonePlanData(record),
    regionId: 'hazard-core',
    cellId: PACK_CELL_ID,
    bounds,
    purpose: declaredPurpose
      ? `${declaredPurpose} authored Undercroft platform`
      : 'authored playable Undercroft traversal surface',
    supportBoundaryIds: [...supportBoundaryIds],
    supportFixtureIds,
    supportProfile: 'semantic-room-pack-v1-authored-support',
    visualProfile: `semantic-room-pack-v1:${placement.roomId}:walkable`,
    collision: 'static',
    hazardTag: null,
    colliderIds: [record.colliderId],
    colliderBounds: [bounds],
    createsLedgeCandidates: false,
    ledgePolicy: 'authored-semantic-surface-seams-disabled',
    ...visualFields(placement, record),
  };
}

function stripBounds(socket, side, minY, maxY, headerBounds) {
  if (maxY - minY <= EPSILON) return null;
  const halfWidth = socket.aperture.width * 0.5;
  if (side === 'north' || side === 'south') {
    return {
      min: vector(socket.worldPosition.x - halfWidth, minY, headerBounds.min.z),
      max: vector(socket.worldPosition.x + halfWidth, maxY, headerBounds.max.z),
    };
  }
  return {
    min: vector(headerBounds.min.x, minY, socket.worldPosition.z - halfWidth),
    max: vector(headerBounds.max.x, maxY, socket.worldPosition.z + halfWidth),
  };
}

function kitBoundary(placement, id, side, bounds, purpose) {
  return {
    id,
    regionId: 'hazard-core',
    cellId: PACK_CELL_ID,
    side,
    kind: 'solid',
    bounds,
    openings: [],
    materialProfileId: `semantic-room-pack-v1.${placement.archetype}.socket-frame`,
    visualProfile: `semantic-room-pack-v1:${placement.roomId}:opaque-socket-kit`,
    collider: true,
    collision: 'static',
    opaque: true,
    gameplayPurpose: purpose,
    structuralKitProfileId: 'semantic-room-pack-v1-opaque-socket-frame',
    presentationOwnerId: placement.id,
    visualId: `visual.${id}`,
    visualIds: [`visual.${id}`],
  };
}

function bindSockets(placement, manifestBoundaries, portalIdsBySocket) {
  const kitBoundaries = [];
  const bindings = [];
  const boundaryBySocketId = new Map();
  for (const socket of placement.sockets) {
    const side = sideForForward(socket.worldForward);
    const header = manifestBoundaries.find((boundary) => (
      boundary.side === side && boundary.sourceNodeName.includes('SHELL_DOOR_HEADER_')
    ));
    if (!header) throw new Error(`Authored socket ${socket.id} has no manifest door header.`);
    const portalId = portalIdsBySocket[socket.id] ?? null;
    const socketBottomY = socket.worldPosition.y;
    const socketTopY = socketBottomY + socket.aperture.height;
    if (portalId) {
      header.kind = 'portal-frame';
      header.openings.push({
        id: `opening.semantic-room-pack.undercroft.${socket.id}`,
        portalId,
        center: vector(socket.worldPosition.x, socketBottomY + socket.aperture.height * 0.5, socket.worldPosition.z),
        dimensions: { width: socket.aperture.width, height: socket.aperture.height, depth: 1.2 },
      });
      for (const [suffix, bounds] of [
        ['lower', stripBounds(socket, side, placement.worldBounds.min.y, socketBottomY, header.bounds)],
        ['upper', stripBounds(socket, side, socketTopY, header.bounds.min.y, header.bounds)],
      ]) {
        if (bounds) kitBoundaries.push(kitBoundary(
          placement,
          `${socket.worldId}:bound-${suffix}-infill`,
          side,
          bounds,
          `opaque structural infill around bound Undercroft socket ${socket.id}`,
        ));
      }
      bindings.push({
        socketId: socket.id,
        sourceNodeName: socket.sourceNodeName,
        status: 'bound',
        portalId,
        capId: null,
      });
      boundaryBySocketId.set(socket.id, header);
      continue;
    }
    const optionalSocket = socket.id === 'service_west' || socket.id === 'upper_east';
    if (!optionalSocket) throw new Error(`Required authored socket ${socket.id} is not bound.`);
    const capId = `${socket.worldId}:structural-cap`;
    const capBounds = stripBounds(socket, side, placement.worldBounds.min.y, header.bounds.min.y, header.bounds);
    if (!capBounds) throw new Error(`Optional authored socket ${socket.id} cannot be physically capped.`);
    kitBoundaries.push(kitBoundary(
      placement,
      capId,
      side,
      capBounds,
      `opaque colliding cap for optional Undercroft socket ${socket.id}`,
    ));
    bindings.push({
      socketId: socket.id,
      sourceNodeName: socket.sourceNodeName,
      status: 'capped',
      portalId: null,
      capId,
    });
    boundaryBySocketId.set(socket.id, header);
  }
  return { bindings, boundaryBySocketId, kitBoundaries };
}

function nearestSurface(surfaces, position, sourceNodeNames = null) {
  const allowed = sourceNodeNames ? new Set(sourceNodeNames) : null;
  return surfaces
    .filter((surface) => !allowed || allowed.has(surface.sourceNodeName))
    .map((surface) => {
      const x = Math.max(surface.bounds.min.x, Math.min(surface.bounds.max.x, position.x));
      const z = Math.max(surface.bounds.min.z, Math.min(surface.bounds.max.z, position.z));
      const dx = x - position.x;
      const dy = surface.bounds.max.y - position.y;
      const dz = z - position.z;
      return { surface, score: dx * dx + dy * dy + dz * dz };
    })
    .sort((left, right) => left.score - right.score)[0]?.surface ?? null;
}

function marker(placement, predicate, label) {
  const result = placement.semanticMarkers.find(predicate);
  if (!result) throw new Error(`${placement.id} has no authored ${label} marker.`);
  return result;
}

function replaceRegionGeometry(plan, newCell, boundaries, surfaces, fixtures) {
  const removedCellIds = new Set(plan.spatialCells
    .filter((cell) => cell.regionId === 'hazard-core' && cell.connector !== true)
    .map(({ id }) => id));
  if (!removedCellIds.has('cell.hazard-core.main')) {
    throw new Error('Golden plan has no replaceable Hazard Core macro cell.');
  }
  const removedSurfaceIds = new Set(plan.walkableSurfaces
    .filter((surface) => removedCellIds.has(surface.cellId))
    .map(({ id }) => id));
  const preservedFixturePrefixes = [
    'fixture.interaction.',
    'fixture.console-pad-support.',
    'fixture.mechanism.gamma-return-lift.support',
  ];
  const preservedFixtures = plan.structuralFixtures.filter((fixture) => (
    removedCellIds.has(fixture.cellId)
    && preservedFixturePrefixes.some((prefix) => fixture.id.startsWith(prefix))
  ));

  plan.spatialCells = plan.spatialCells.filter((cell) => !removedCellIds.has(cell.id));
  plan.structuralBoundaries = plan.structuralBoundaries.filter((boundary) => (
    !removedCellIds.has(boundary.cellId) || boundary.id === 'Gate_Shortcut_Gamma'
  ));
  plan.walkableSurfaces = plan.walkableSurfaces.filter((surface) => !removedCellIds.has(surface.cellId));
  plan.structuralFixtures = plan.structuralFixtures.filter((fixture) => !removedCellIds.has(fixture.cellId));
  plan.traversalLinks = plan.traversalLinks.filter((link) => (
    !String(link.id).startsWith('traversal.hazard-core.')
    && !removedSurfaceIds.has(link.fromSurfaceId)
    && !removedSurfaceIds.has(link.toSurfaceId)
  ));
  plan.spatialCells.push(newCell);
  plan.structuralBoundaries.push(...boundaries);
  plan.walkableSurfaces.push(...surfaces);
  plan.structuralFixtures.push(...fixtures);
  return { removedCellIds, removedSurfaceIds, preservedFixtures };
}

function rehomeFixture(fixture, anchor, surface, cellId = PACK_CELL_ID) {
  const size = boundsSize(fixture.bounds);
  const centerY = surface.bounds.max.y + size.y * 0.5;
  const position = vector(anchor.position.x, centerY, anchor.position.z);
  const bounds = centeredBounds(position, size);
  fixture.regionId = anchor.regionId;
  fixture.cellId = cellId;
  fixture.bounds = bounds;
  fixture.colliderBounds = (fixture.colliderBounds ?? [bounds]).map(() => cloneBounds(bounds));
  fixture.supportBoundaryIds = [...surface.supportBoundaryIds];
  return fixture;
}

function setAnchor(plan, id, regionId, position, surfaceId, purpose = null) {
  const anchor = plan.anchors.find((entry) => entry.id === id);
  if (!anchor) throw new Error(`Golden plan is missing anchor ${id}.`);
  anchor.regionId = regionId;
  anchor.position = { ...position };
  anchor.surfaceId = surfaceId;
  anchor.safeSurfaceId = surfaceId;
  if (purpose) anchor.purpose = purpose;
  return anchor;
}

function translatePortalOwnedGeometry(plan, portal, delta) {
  const routeCellIds = new Set(portal.physicalRoute?.cellIds ?? []);
  const routeBoundaryIds = new Set(portal.physicalRoute?.boundaryIds ?? []);
  const routeSurfaceIds = new Set(portal.physicalRoute?.surfaceIds ?? []);
  for (const cell of plan.spatialCells) {
    if (routeCellIds.has(cell.id)) cell.bounds = translateBounds(cell.bounds, delta);
  }
  for (const boundary of plan.structuralBoundaries) {
    if (routeBoundaryIds.has(boundary.id)) {
      boundary.bounds = translateBounds(boundary.bounds, delta);
      for (const opening of boundary.openings ?? []) {
        opening.center = vector(opening.center.x + delta.x, opening.center.y + delta.y, opening.center.z + delta.z);
      }
    }
  }
  for (const surface of plan.walkableSurfaces) {
    if (!routeSurfaceIds.has(surface.id)) continue;
    surface.bounds = translateBounds(surface.bounds, delta);
    if (surface.geometry?.routeBounds) surface.geometry.routeBounds = translateBounds(surface.geometry.routeBounds, delta);
  }
}

function bindPortalEndpoint(endpoint, socket, boundary) {
  endpoint.cellId = PACK_CELL_ID;
  endpoint.boundaryId = boundary.id;
  endpoint.side = sideForForward(socket.worldForward);
  endpoint.center = vector(
    socket.worldPosition.x,
    socket.worldPosition.y + socket.aperture.height * 0.5,
    socket.worldPosition.z,
  );
  endpoint.elevation = socket.worldPosition.y;
  endpoint.placementBucket = endpoint.side;
  endpoint.dimensions = { width: socket.aperture.width, height: socket.aperture.height, depth: 1.2 };
}

function updatePortalsAndLift(plan, placement, socketFrames, surfaces) {
  const entryPortal = plan.portals.find(({ id }) => id === ENTRY_PORTAL_ID);
  const returnPortal = plan.portals.find(({ id }) => id === RETURN_PORTAL_ID);
  if (!entryPortal || !returnPortal) throw new Error('Golden Undercroft portals are missing.');
  const entrySocket = placement.sockets.find(({ id }) => id === 'entry_south');
  const exitSocket = placement.sockets.find(({ id }) => id === 'exit_north');
  const entrySurface = nearestSurface(surfaces, entrySocket.worldPosition, [
    'WALK_ENTRY_FOUNDRY_DECK', 'WALK_ENTRY_INSULATED_DECK',
  ]);
  const exitSurface = nearestSurface(surfaces, exitSocket.worldPosition, [
    'WALK_NORTH_CONTROL_DECK', 'WALK_NORTH_SWITCH_DECK',
  ]);
  if (!entrySurface || !exitSurface) throw new Error('Authored Undercroft socket landings are unresolved.');

  bindPortalEndpoint(entryPortal.to, entrySocket, socketFrames.boundaryBySocketId.get('entry_south'));
  entryPortal.visibleDestinationRegionId = 'hazard-core';
  entryPortal.physicalRoute.endpointSurfaceIds.to = entrySurface.id;
  entryPortal.physicalRoute.routePoints[entryPortal.physicalRoute.routePoints.length - 1] = {
    ...entrySocket.worldPosition,
  };
  const lastEntryCellId = entryPortal.physicalRoute.cellIds.at(-1);
  const lastEntryCell = plan.spatialCells.find(({ id }) => id === lastEntryCellId);
  if (lastEntryCell && entrySocket.worldPosition.y < lastEntryCell.bounds.min.y) {
    lastEntryCell.bounds.min.y = entrySocket.worldPosition.y;
    for (const boundary of plan.structuralBoundaries.filter(({ cellId }) => cellId === lastEntryCell.id)) {
      if (boundary.side === 'floor') {
        const thickness = boundary.bounds.max.y - boundary.bounds.min.y;
        boundary.bounds.min.y = entrySocket.worldPosition.y - thickness;
        boundary.bounds.max.y = entrySocket.worldPosition.y;
      } else if (['north', 'south', 'east', 'west'].includes(boundary.side)) {
        boundary.bounds.min.y = entrySocket.worldPosition.y;
      }
    }
    const lastSurfaceId = entryPortal.physicalRoute.surfaceIds.at(-1);
    const lastSurface = plan.walkableSurfaces.find(({ id }) => id === lastSurfaceId);
    if (lastSurface) {
      const thickness = lastSurface.bounds.max.y - lastSurface.bounds.min.y;
      lastSurface.bounds.min.y = entrySocket.worldPosition.y;
      lastSurface.bounds.max.y = entrySocket.worldPosition.y + thickness;
      lastSurface.geometry = {
        type: 'walk',
        path: [
          vector(entrySocket.worldPosition.x, entryPortal.from.elevation, entrySocket.worldPosition.z),
          { ...entrySocket.worldPosition },
        ],
        width: entrySocket.aperture.width,
        enclosed: true,
        verticalTransfer: 'authored-ladder-throat',
      };
    }
  }

  const previousReturnPosition = {
    x: returnPortal.to.center.x,
    y: returnPortal.to.elevation,
    z: returnPortal.to.center.z,
  };
  // Keep the shaft four metres outside the west socket. This short framed
  // throat clears Credential's authored process alcove while preserving a
  // direct, non-corridor permanent return.
  const shaftPosition = vector(exitSocket.worldPosition.x - 1, 0, exitSocket.worldPosition.z - 5);
  const returnHorizontalDelta = vector(
    shaftPosition.x - previousReturnPosition.x,
    0,
    shaftPosition.z - previousReturnPosition.z,
  );
  translatePortalOwnedGeometry(plan, returnPortal, returnHorizontalDelta);
  const shaftCellId = returnPortal.physicalRoute.cellIds[0];
  const shaftCell = plan.spatialCells.find(({ id }) => id === shaftCellId);
  if (shaftCell) {
    shaftCell.bounds.min.x = shaftPosition.x - 2.6;
    shaftCell.bounds.max.x = shaftPosition.x + 2.6;
    shaftCell.bounds.min.z = shaftPosition.z - 2.6;
    shaftCell.bounds.max.z = shaftPosition.z + 2.6;
    for (const boundary of plan.structuralBoundaries.filter(({ cellId }) => cellId === shaftCell.id)) {
      const thickness = 0.4;
      if (boundary.side === 'north') boundary.bounds = {
        min: vector(shaftCell.bounds.min.x, shaftCell.bounds.min.y, shaftCell.bounds.min.z - thickness),
        max: vector(shaftCell.bounds.max.x, shaftCell.bounds.max.y, shaftCell.bounds.min.z),
      };
      if (boundary.side === 'south') boundary.bounds = {
        min: vector(shaftCell.bounds.min.x, shaftCell.bounds.min.y, shaftCell.bounds.max.z),
        max: vector(shaftCell.bounds.max.x, shaftCell.bounds.max.y, shaftCell.bounds.max.z + thickness),
      };
      if (boundary.side === 'west') boundary.bounds = {
        min: vector(shaftCell.bounds.min.x - thickness, shaftCell.bounds.min.y, shaftCell.bounds.min.z),
        max: vector(shaftCell.bounds.min.x, shaftCell.bounds.max.y, shaftCell.bounds.max.z),
      };
      if (boundary.side === 'east') boundary.bounds = {
        min: vector(shaftCell.bounds.max.x, shaftCell.bounds.min.y, shaftCell.bounds.min.z),
        max: vector(shaftCell.bounds.max.x + thickness, shaftCell.bounds.max.y, shaftCell.bounds.max.z),
      };
      if (boundary.side === 'floor') boundary.bounds = {
        min: vector(shaftCell.bounds.min.x, shaftCell.bounds.min.y - thickness, shaftCell.bounds.min.z),
        max: vector(shaftCell.bounds.max.x, shaftCell.bounds.min.y, shaftCell.bounds.max.z),
      };
      if (boundary.side === 'ceiling') boundary.bounds = {
        min: vector(shaftCell.bounds.min.x, shaftCell.bounds.max.y, shaftCell.bounds.min.z),
        max: vector(shaftCell.bounds.max.x, shaftCell.bounds.max.y + thickness, shaftCell.bounds.max.z),
      };
    }
  }
  bindPortalEndpoint(returnPortal.from, exitSocket, socketFrames.boundaryBySocketId.get('exit_north'));
  returnPortal.to.center.x = shaftPosition.x;
  returnPortal.to.center.z = shaftPosition.z;
  returnPortal.to.dimensions.width = 5.2;
  returnPortal.to.dimensions.depth = 5.2;
  const credentialOpening = plan.structuralBoundaries
    .flatMap((boundary) => boundary.openings ?? [])
    .find(({ id }) => id === 'opening.hazard-core-credential-return.to');
  if (credentialOpening) {
    credentialOpening.center.x = shaftPosition.x;
    credentialOpening.center.z = shaftPosition.z;
    credentialOpening.dimensions.width = 5.2;
    credentialOpening.dimensions.depth = 5.2;
  }
  const shaftStartOpening = plan.structuralBoundaries
    .flatMap((boundary) => boundary.openings ?? [])
    .find(({ id }) => id === 'opening.connector.hazard-core-credential-return.0.start');
  if (shaftStartOpening) {
    shaftStartOpening.center.x = shaftPosition.x;
    shaftStartOpening.center.z = shaftPosition.z;
    shaftStartOpening.dimensions.width = 5.2;
    shaftStartOpening.dimensions.depth = 5.2;
  }
  returnPortal.physicalRoute.endpointSurfaceIds.from = exitSurface.id;
  returnPortal.physicalRoute.routePoints = [
    { ...exitSocket.worldPosition },
    vector(shaftPosition.x, exitSocket.worldPosition.y, shaftPosition.z),
    vector(shaftPosition.x, returnPortal.to.elevation, shaftPosition.z),
  ];
  if (returnPortal.physicalRoute.fullHeightShaftBounds) {
    returnPortal.physicalRoute.fullHeightShaftBounds = translateBounds(
      returnPortal.physicalRoute.fullHeightShaftBounds,
      returnHorizontalDelta,
    );
    returnPortal.physicalRoute.fullHeightShaftBounds.min.y = exitSocket.worldPosition.y;
  }

  const gate = plan.structuralBoundaries.find(({ id }) => id === 'Gate_Shortcut_Gamma');
  if (!gate) throw new Error('Gamma shortcut gate barrier is missing.');
  gate.cellId = PACK_CELL_ID;
  gate.regionId = 'hazard-core';
  gate.side = sideForForward(exitSocket.worldForward);
  gate.bounds = centeredBounds(
    vector(
      exitSocket.worldPosition.x,
      exitSocket.worldPosition.y + exitSocket.aperture.height * 0.5,
      exitSocket.worldPosition.z,
    ),
    gate.side === 'west' || gate.side === 'east'
      ? { x: 1.2, y: exitSocket.aperture.height, z: exitSocket.aperture.width }
      : { x: exitSocket.aperture.width, y: exitSocket.aperture.height, z: 1.2 },
  );

  const upperLanding = plan.walkableSurfaces.find(({ id }) => id === 'surface.mechanism.gamma-return-lift.landing.upper');
  const dynamicLift = plan.walkableSurfaces.find(({ id }) => id === 'surface.hazard-core.return-lift');
  if (!upperLanding || !dynamicLift) throw new Error('Gamma return lift surfaces are missing.');
  const upperDelta = vector(
    shaftPosition.x - ((upperLanding.bounds.min.x + upperLanding.bounds.max.x) * 0.5),
    0,
    shaftPosition.z - ((upperLanding.bounds.min.z + upperLanding.bounds.max.z) * 0.5),
  );
  upperLanding.bounds = translateBounds(upperLanding.bounds, upperDelta);
  dynamicLift.bounds = centeredBounds(
    vector(exitSocket.worldPosition.x, exitSocket.worldPosition.y - 0.175, exitSocket.worldPosition.z),
    { x: 4.8, y: 0.35, z: 4.8 },
  );
  dynamicLift.geometry.routeBounds = {
    min: { ...dynamicLift.bounds.min },
    max: vector(dynamicLift.bounds.max.x, upperLanding.bounds.max.y, dynamicLift.bounds.max.z),
  };
  dynamicLift.supportBoundaryIds = [...exitSurface.supportBoundaryIds];
  dynamicLift.supportFixtureIds = [];

  const lift = plan.mechanisms.find(({ id }) => id === 'mechanism.gamma-return-lift');
  if (!lift) throw new Error('Gamma return lift controller is missing.');
  const lowerState = lift.states.find(({ id }) => id === 'LowerLanding');
  const upperState = lift.states.find(({ id }) => id === 'UpperLanding');
  lowerState.surfaceY = exitSocket.worldPosition.y;
  lowerState.position = { ...exitSocket.worldPosition };
  lowerState.landingSurfaceId = exitSurface.id;
  upperState.position.x = shaftPosition.x;
  upperState.position.z = shaftPosition.z;

  return { entrySurface, exitSurface, entrySocket, exitSocket, shaftPosition };
}

function createHazardRuntime(plan, type, placement, surfaces, supportBoundaryIds) {
  const contract = placement.hazardContracts[0];
  if (!contract) throw new Error('Authored Undercroft hazard contract is missing.');
  const markers = placement.semanticMarkers.filter(({ semantic }) => semantic === 'hazardSurface');
  const hazardTag = type === 'magma' ? 'environmental:magma' : 'environmental:electrical';
  const rewardMarker = placement.semanticMarkers.find(({ semantic }) => semantic === 'rewardAnchor');
  const triggerSurfaces = markers.map((hazardMarker, index) => {
    const half = type === 'magma' ? 10 : 2;
    const safeOverlay = type === 'electrical'
      && rewardMarker
      && Math.abs(hazardMarker.worldPosition.x - rewardMarker.worldPosition.x) <= 0.01
      && Math.abs(hazardMarker.worldPosition.z - rewardMarker.worldPosition.z) <= 0.01;
    const bounds = safeOverlay ? {
      // The authored insulated reward pad overlays this cycling panel. Keep
      // the narrow exposed rim hazardous while the reward anchor itself is
      // permanently safe and physically reachable.
      min: vector(hazardMarker.worldPosition.x + 1.55, hazardMarker.worldPosition.y - 0.12, hazardMarker.worldPosition.z - half),
      max: vector(hazardMarker.worldPosition.x + half, hazardMarker.worldPosition.y, hazardMarker.worldPosition.z + half),
    } : {
      min: vector(hazardMarker.worldPosition.x - half, hazardMarker.worldPosition.y - 0.12, hazardMarker.worldPosition.z - half),
      max: vector(hazardMarker.worldPosition.x + half, hazardMarker.worldPosition.y, hazardMarker.worldPosition.z + half),
    };
    return {
      id: `surface.semantic-room-pack.undercroft.hazard.${String(index).padStart(2, '0')}`,
      regionId: 'hazard-core',
      cellId: PACK_CELL_ID,
      bounds,
      purpose: `plan-owned ${contract.profile} contact surface at authored ${hazardMarker.sourceNodeName}`,
      supportBoundaryIds: [...supportBoundaryIds],
      supportFixtureIds: [],
      supportProfile: 'authored-hazard-foundation-v1',
      visualProfile: `semantic-room-pack-v1:hazard:${contract.profile}`,
      collision: 'static',
      hazardTag,
      environmentStateId: 'environment.undercroft-hazard',
      sourceNodeName: hazardMarker.sourceNodeName,
      collisionAuthority: 'plan-contract-authored-hazard-marker-not-visible-mesh-bounds',
      derivedFromVisibleMeshBounds: false,
      safeOverlayExclusionSourceNodeName: safeOverlay ? rewardMarker.sourceNodeName : null,
      createsLedgeCandidates: false,
    };
  });
  plan.walkableSurfaces.push(...triggerSurfaces);

  const environment = plan.environmentStates.find(({ id }) => id === 'environment.undercroft-hazard');
  const mechanism = plan.mechanisms.find(({ id }) => id === 'mechanism.undercroft-hazard');
  if (!environment || !mechanism) throw new Error('Global Undercroft hazard runtime contracts are missing.');
  environment.type = contract.profile.replaceAll('_', '-');
  environment.hazardTag = hazardTag;
  environment.tags = type === 'magma'
    ? ['environmental:magma', 'environmentalHeat', 'fireFloor']
    : ['environmental:electrical'];
  environment.damagePerSecond = contract.parameters.damagePerSecond;
  environment.surfaces = triggerSurfaces.map((surface) => ({
    surfaceId: surface.id,
    regionId: 'hazard-core',
    sourceSemanticRoomPackPlacementId: placement.id,
  }));
  environment.safeRouteRequired = true;
  environment.unavoidableExposureAllowed = false;
  environment.ordinaryEnemyAvoidance = true;
  environment.sourceEnvironmentContractId = contract.id;
  environment.sourceSemanticRoomPackPlacementId = placement.id;
  if (type === 'magma') {
    environment.pulseSeconds = contract.parameters.pulseSeconds;
    environment.entryGraceSeconds = contract.parameters.entryGraceSeconds;
    environment.graceSeconds = contract.parameters.entryGraceSeconds;
    environment.activeSeconds = contract.parameters.pulseSeconds;
    environment.recoverySeconds = 0;
    delete environment.phaseCycleSeconds;
    delete environment.phases;
    delete environment.timing;
    mechanism.initialStateId = 'Active';
    mechanism.states = [{ id: 'Active', stable: true }];
    mechanism.transitions = [];
  } else {
    environment.phaseCycleSeconds = contract.parameters.cycleSeconds;
    environment.entryPhase = 'safe';
    environment.phases = [
      { id: 'safe', durationSeconds: contract.parameters.safeSeconds },
      { id: 'charging', durationSeconds: contract.parameters.chargingSeconds },
      { id: 'energized', durationSeconds: contract.parameters.energizedSeconds },
    ];
    environment.timing = {
      safeSeconds: contract.parameters.safeSeconds,
      chargingSeconds: contract.parameters.chargingSeconds,
      activeSeconds: contract.parameters.energizedSeconds,
      cycleSeconds: contract.parameters.cycleSeconds,
    };
    delete environment.pulseSeconds;
    delete environment.entryGraceSeconds;
    delete environment.graceSeconds;
    mechanism.initialStateId = 'Safe';
    mechanism.states = [
      { id: 'Safe', stable: true },
      { id: 'Charging', stable: false },
      { id: 'Energized', stable: true },
    ];
    mechanism.transitions = [
      { fromStateId: 'Safe', toStateId: 'Charging', automatic: true, afterSeconds: contract.parameters.safeSeconds },
      { fromStateId: 'Charging', toStateId: 'Energized', automatic: true, afterSeconds: contract.parameters.chargingSeconds },
      { fromStateId: 'Energized', toStateId: 'Safe', automatic: true, afterSeconds: contract.parameters.energizedSeconds },
    ];
  }
  mechanism.type = environment.type;
  mechanism.regionId = 'hazard-core';
  mechanism.runtimeProfile = {
    ...(mechanism.runtimeProfile ?? {}),
    environmentStateId: environment.id,
    sourceEnvironmentContractId: contract.id,
  };
  return { contract, environment, mechanism, triggerSurfaces };
}

function createInternalTraversalLinks(placement, surfaces) {
  const surfaceByNode = new Map(surfaces.map((surface) => [surface.sourceNodeName, surface]));
  const regionSurfaceByLocalId = new Map();
  const hints = placement.roomId.includes('magma') ? {
    entry_deck: 'WALK_ENTRY_FOUNDRY_DECK',
    control_deck: 'WALK_NORTH_CONTROL_DECK',
    heat_reward_branch: 'WALK_WEST_SAFE_SERVICE',
  } : {
    entry_deck: 'WALK_ENTRY_INSULATED_DECK',
    switch_deck: 'WALK_NORTH_SWITCH_DECK',
    upper_gallery: 'WALK_UPPER_EAST_GALLERY',
    timing_reward_branch: 'WALK_TIMING_REWARD_PAD_00',
  };
  for (const [localId, nodeName] of Object.entries(hints)) {
    if (surfaceByNode.has(nodeName)) regionSurfaceByLocalId.set(localId, surfaceByNode.get(nodeName));
  }
  const resolve = (reference) => surfaceByNode.get(reference) ?? regionSurfaceByLocalId.get(reference) ?? null;
  return placement.traversalLinks.map((source, index) => {
    const from = resolve(source.localFrom);
    const to = resolve(source.localTo);
    const via = source.viaAnchorIds.map((id) => {
      const local = id.split(':').at(-1);
      return resolve(local)?.id ?? null;
    }).filter(Boolean);
    if (!from || !to) throw new Error(`Authored traversal edge ${source.id} has unresolved endpoint surfaces.`);
    return {
      id: `traversal.semantic-room-pack.undercroft.${String(index).padStart(2, '0')}`,
      fromSurfaceId: from.id,
      toSurfaceId: to.id,
      viaSurfaceIds: via,
      mode: source.kind ?? 'authored-traversal',
      direction: 'bidirectional',
      bidirectional: true,
      optional: source.optional === true,
      damageFree: source.damageFree === true || placement.roomId.includes('magma'),
      condition: source.condition,
      sourceSemanticRoomPackTraversalId: source.id,
      playableDestination: true,
    };
  });
}

function rehomeContent(plan, placement, surfaces, portalBindings, preservedFixtures) {
  const rewardMarker = marker(placement, ({ semantic }) => semantic === 'rewardAnchor', 'reward');
  const safeMarker = marker(placement, ({ semantic }) => semantic === 'safeAnchor', 'safe landing');
  const rewardSurface = nearestSurface(surfaces, rewardMarker.worldPosition);
  const safeSurface = nearestSurface(surfaces, safeMarker.worldPosition);
  const controlSurface = portalBindings.exitSurface;
  if (!rewardSurface || !safeSurface || !controlSurface) throw new Error('Authored Undercroft content surfaces are unresolved.');

  setAnchor(plan, 'anchor.cache.undercroft', 'hazard-core', rewardMarker.worldPosition, rewardSurface.id,
    'authored Undercroft major cache');
  const gammaPosition = vector(
    Math.max(controlSurface.bounds.min.x + 1.2, Math.min(controlSurface.bounds.max.x - 1.2, portalBindings.exitSocket.worldPosition.x + 2)),
    controlSurface.bounds.max.y,
    Math.max(controlSurface.bounds.min.z + 1.2, Math.min(controlSurface.bounds.max.z - 1.2, portalBindings.exitSocket.worldPosition.z)),
  );
  setAnchor(plan, 'anchor.key.gamma', 'hazard-core', gammaPosition, controlSurface.id,
    'Gamma pedestal beyond the complete authored hazard route');
  const padCenterX = controlSurface.bounds.max.x - 1.5;
  const shortcutPosition = vector(padCenterX, controlSurface.bounds.max.y + 0.15, controlSurface.bounds.min.z + 1.3);
  const lowerConsolePosition = vector(padCenterX, controlSurface.bounds.max.y + 0.15, controlSurface.bounds.max.z - 1.3);
  const consolePads = [
    {
      id: 'surface.semantic-room-pack.undercroft.console-pad.shortcut-gamma',
      position: shortcutPosition,
      actionId: 'action.open.shortcut-gamma',
    },
    {
      id: 'surface.semantic-room-pack.undercroft.console-pad.gamma-lift-lower',
      position: lowerConsolePosition,
      actionId: 'action.gamma-lift.recall-lower',
    },
  ].map(({ id, position, actionId }) => ({
    id,
    regionId: 'hazard-core',
    cellId: PACK_CELL_ID,
    bounds: centeredBounds(position, { x: 2.5, y: 0.3, z: 2.5 }),
    purpose: `${actionId} static authored side-console pad clear of the return-gate lane`,
    supportBoundaryIds: [...controlSurface.supportBoundaryIds],
    supportFixtureIds: [],
    supportProfile: 'semantic-room-pack-v1-authored-console-foundation',
    visualProfile: 'semantic-room-pack-v1:undercroft:console-pad',
    collision: 'static',
    hazardTag: null,
    interactionSurfaceRole: 'side-console-pad',
    consoleActionId: actionId,
    createsLedgeCandidates: false,
  }));
  plan.walkableSurfaces.push(...consolePads);
  const shortcutAnchorPosition = vector(
    shortcutPosition.x,
    consolePads[0].bounds.max.y,
    shortcutPosition.z,
  );
  const lowerConsoleAnchorPosition = vector(
    lowerConsolePosition.x,
    consolePads[1].bounds.max.y,
    lowerConsolePosition.z,
  );
  setAnchor(plan, 'anchor.shortcut.gamma', 'hazard-core', shortcutAnchorPosition, consolePads[0].id,
    'Gamma permanent-return release on the authored exit deck');
  setAnchor(plan, 'anchor.gamma-lift.lower-console', 'hazard-core', lowerConsoleAnchorPosition, consolePads[1].id,
    'automatic return-lift recall beside the authored exit walkway');
  const shortcutAnchor = plan.anchors.find(({ id }) => id === 'anchor.shortcut.gamma');
  const facingX = portalBindings.exitSocket.worldPosition.x - shortcutAnchor.position.x;
  const facingZ = portalBindings.exitSocket.worldPosition.z - shortcutAnchor.position.z;
  const facingLength = Math.hypot(facingX, facingZ);
  shortcutAnchor.forward = vector(facingX / facingLength, 0, facingZ / facingLength);
  shortcutAnchor.forwardX = shortcutAnchor.forward.x;
  shortcutAnchor.forwardZ = shortcutAnchor.forward.z;

  const upperAnchor = plan.anchors.find(({ id }) => id === 'anchor.gamma-lift.upper-console');
  const upperSurface = plan.walkableSurfaces.find(({ id }) => id === 'surface.mechanism.gamma-return-lift.landing.upper');
  if (upperAnchor && upperSurface) {
    upperAnchor.position.x = portalBindings.shaftPosition.x - 2;
    upperAnchor.position.z = portalBindings.shaftPosition.z;
    upperAnchor.position.y = upperSurface.bounds.max.y;
    upperAnchor.surfaceId = upperSurface.id;
    upperAnchor.safeSurfaceId = upperSurface.id;
  }

  const safeAnchor = plan.safeAnchors.find(({ id }) => id === 'safe.undercroft-island');
  if (!safeAnchor) throw new Error('Golden Undercroft safe anchor is missing.');
  safeAnchor.regionId = 'hazard-core';
  safeAnchor.position = vector(safeMarker.worldPosition.x, safeSurface.bounds.max.y, safeMarker.worldPosition.z);
  safeAnchor.surfaceId = safeSurface.id;
  safeAnchor.safeSurfaceId = safeSurface.id;
  safeAnchor.descriptorReference = {
    placementId: placement.id,
    roomId: placement.roomId,
    sourceNodeName: safeMarker.sourceNodeName,
  };

  const anchorByFixtureId = {
    'fixture.interaction.pickup.keycard-gamma': 'anchor.key.gamma',
    'fixture.interaction.open.shortcut-gamma': 'anchor.shortcut.gamma',
    'fixture.interaction.gamma-lift.recall-lower': 'anchor.gamma-lift.lower-console',
    'fixture.interaction.open.cache-undercroft': 'anchor.cache.undercroft',
  };
  for (const fixture of preservedFixtures) {
    if (fixture.id === 'fixture.mechanism.gamma-return-lift.support') {
      const dynamicLift = plan.walkableSurfaces.find(({ id }) => id === 'surface.hazard-core.return-lift');
      const liftAnchor = {
        regionId: 'hazard-core',
        position: vector(
          (dynamicLift.bounds.min.x + dynamicLift.bounds.max.x) * 0.5,
          controlSurface.bounds.max.y,
          (dynamicLift.bounds.min.z + dynamicLift.bounds.max.z) * 0.5,
        ),
      };
      plan.structuralFixtures.push(rehomeFixture(fixture, liftAnchor, controlSurface));
      dynamicLift.supportFixtureIds = [fixture.id];
      continue;
    }
    const anchorId = anchorByFixtureId[fixture.id]
      ?? (fixture.id.includes('shortcut-gamma') ? 'anchor.shortcut.gamma'
        : fixture.id.includes('gamma-lift') ? 'anchor.gamma-lift.lower-console' : null);
    if (!anchorId) continue;
    const anchor = plan.anchors.find(({ id }) => id === anchorId);
    const surface = plan.walkableSurfaces.find(({ id }) => id === anchor.surfaceId);
    plan.structuralFixtures.push(rehomeFixture(fixture, anchor, surface));
  }
  return { rewardMarker, rewardSurface, safeMarker, safeSurface, controlSurface };
}

function modulePlacement(placement) {
  return {
    id: placement.id,
    placementId: placement.id,
    descriptorId: `semantic-room-pack-v1.${placement.roomId}`,
    descriptorRevision: placement.packRevision,
    roomId: placement.roomId,
    packId: placement.packId,
    packRevision: placement.packRevision,
    semanticRoomPackPlacementId: placement.id,
    regionIds: ['hazard-intake', 'hazard-core'],
    translation: clonePlanData(placement.placementTransform.translation),
    yawQuarterTurns: placement.placementTransform.yawQuarterTurns,
    bounds: clonePlanData(placement.worldBounds),
    topologySignature: `semantic-room-pack-v1:${placement.roomId}:${placement.topologyVariant}`,
    occupiedCellIds: [PACK_CELL_ID],
    collisionSourcePolicy: placement.collisionSourcePolicy,
    socketBindings: clonePlanData(placement.socketBindings),
    boundPortalIds: [ENTRY_PORTAL_ID, RETURN_PORTAL_ID],
    placedRecordIds: clonePlanData(placement.placedRecordIds),
    nativeIntegrationStatus: 'authored-macro-cell-replacement-v1',
    fullyIntegrated: true,
  };
}

function validationResult(errors, details = {}) {
  const sorted = sortPlanDiagnostics(errors);
  return deepFreezePlan({
    accepted: sorted.length === 0,
    errors: sorted,
    diagnosticHash: hashPlanDiagnostics(sorted),
    details,
  });
}

function diagnostic(errors, code, message, details = {}) {
  errors.push(createPlanDiagnostic(code, message, details));
}

export function validateSemanticRoomPackUndercroftReplacementV2(plan) {
  const errors = [];
  const ledger = plan?.semanticRoomPackUndercroftReplacement;
  const placement = plan?.semanticRoomPackPlacements?.find(({ id }) => id === PLACEMENT_ID);
  if (!ledger || ledger.revision !== SEMANTIC_ROOM_PACK_UNDERCROFT_REPLACEMENT_V2_REVISION) {
    diagnostic(errors, 'semantic-room-pack-undercroft-replacement-missing', 'Authored Undercroft replacement ledger is missing.');
    return validationResult(errors);
  }
  if (!placement || placement.roomId !== ROOM_ID_BY_TYPE[plan.undercroftType]) {
    diagnostic(errors, 'semantic-room-pack-undercroft-placement-mismatch', 'Authored Undercroft placement does not match the seeded district type.');
  }
  const packCell = plan.spatialCells?.find(({ id }) => id === PACK_CELL_ID);
  if (!packCell || plan.spatialCells.some((cell) => cell.regionId === 'hazard-core' && cell.connector !== true && cell.id !== PACK_CELL_ID)) {
    diagnostic(errors, 'semantic-room-pack-undercroft-generic-cell-remains', 'Generic Hazard Core macro geometry remains after replacement.');
  }
  if (placement) {
    const socketStatuses = Object.fromEntries(placement.socketBindings.map(({ socketId, status }) => [socketId, status]));
    if (socketStatuses.entry_south !== 'bound' || socketStatuses.exit_north !== 'bound') {
      diagnostic(errors, 'semantic-room-pack-undercroft-functional-socket-unbound', 'Entry and permanent-return sockets must both be physically bound.');
    }
    for (const optionalId of placement.roomId.includes('magma') ? ['service_west'] : ['upper_east']) {
      if (socketStatuses[optionalId] !== 'capped') {
        diagnostic(errors, 'semantic-room-pack-undercroft-optional-socket-uncapped', 'Unused optional socket must have an opaque colliding cap.', { socketId: optionalId });
      }
    }
    const acceptedIds = new Set([
      ...(plan.structuralBoundaries ?? []).map(({ id }) => id),
      ...(plan.walkableSurfaces ?? []).map(({ id }) => id),
      ...(plan.structuralFixtures ?? []).map(({ id }) => id),
    ]);
    for (const id of [
      ...placement.placedRecordIds.structuralBoundaryIds,
      ...placement.placedRecordIds.walkableSurfaceIds,
      ...placement.placedRecordIds.structuralFixtureIds,
    ]) {
      if (!acceptedIds.has(id)) diagnostic(errors, 'semantic-room-pack-undercroft-manifest-record-missing', 'A manifest collision record is absent from the plan.', { id });
    }
    if (placement.transformedCollisionVolumes.some(({ derivedFromVisibleMeshBounds }) => derivedFromVisibleMeshBounds !== false)) {
      diagnostic(errors, 'semantic-room-pack-undercroft-mesh-aabb-collision', 'Authored Undercroft collision may only use manifest volumes.');
    }
  }
  const entryPortal = plan?.portals?.find(({ id }) => id === ENTRY_PORTAL_ID);
  const returnPortal = plan?.portals?.find(({ id }) => id === RETURN_PORTAL_ID);
  if (!entryPortal || entryPortal.to.cellId !== PACK_CELL_ID || !returnPortal || returnPortal.from.cellId !== PACK_CELL_ID) {
    diagnostic(errors, 'semantic-room-pack-undercroft-graph-binding-missing', 'Golden entry or permanent-return portal is not bound directly to the authored macro cell.');
  }
  const environment = plan?.environmentStates?.find(({ id }) => id === 'environment.undercroft-hazard');
  const expected = plan?.undercroftType === 'magma'
    ? { profile: 'magma-floor-v1', dps: 12, surfaceCount: 1 }
    : { profile: 'electric-floor-cycle-v1', dps: 9, surfaceCount: 25 };
  if (!environment || environment.type !== expected.profile || environment.damagePerSecond !== expected.dps
    || environment.surfaces?.length !== expected.surfaceCount || environment.safeRouteRequired !== true
    || environment.unavoidableExposureAllowed !== false) {
    diagnostic(errors, 'semantic-room-pack-undercroft-hazard-contract-mismatch', 'Authored hazard timing/surface/safe-route contract is incomplete.', {
      expected,
      actualType: environment?.type ?? null,
      actualDps: environment?.damagePerSecond ?? null,
      actualSurfaceCount: environment?.surfaces?.length ?? null,
    });
  }
  const cacheAnchor = plan?.anchors?.find(({ id }) => id === 'anchor.cache.undercroft');
  if (!cacheAnchor || cacheAnchor.descriptorReference?.sourceNodeName == null) {
    diagnostic(errors, 'semantic-room-pack-undercroft-reward-anchor-unbound', 'Undercroft major cache is not bound to its authored reward anchor.');
  }
  if ((ledger.addedConnectorCellIds?.length ?? 0) !== 0) {
    diagnostic(errors, 'semantic-room-pack-undercroft-long-corridor-added', 'Macro replacement must not append connector chains.', { addedConnectorCellIds: ledger.addedConnectorCellIds });
  }
  if (!ledger.safeRouteTraversalLinkIds?.length) {
    diagnostic(errors, 'semantic-room-pack-undercroft-safe-route-missing', 'Authored Undercroft has no plan-owned damage-free traversal route.');
  }
  if (!isSerializablePlanValue(plan)) {
    diagnostic(errors, 'semantic-room-pack-undercroft-plan-not-serializable', 'Replacement introduced non-serializable plan data.');
  }
  return validationResult(errors, {
    undercroftType: plan?.undercroftType ?? null,
    roomId: placement?.roomId ?? null,
    placementId: placement?.id ?? null,
    replacedCellIds: ledger?.replacedCellIds ?? [],
    addedConnectorCellCount: ledger?.addedConnectorCellIds?.length ?? null,
  });
}

export class SemanticRoomPackUndercroftReplacementErrorV2 extends Error {
  constructor(result) {
    const first = result.errors?.[0];
    super(first
      ? `Authored Undercroft replacement rejected: ${first.code}: ${first.message}`
      : 'Authored Undercroft replacement rejected.');
    this.name = 'SemanticRoomPackUndercroftReplacementErrorV2';
    this.code = 'SEMANTIC_ROOM_PACK_UNDERCROFT_REPLACEMENT_INVALID';
    this.result = result;
  }
}

export function replaceGoldenUndercroftWithSemanticRoomPackV2(plan, options = {}) {
  assertMutablePlan(plan);
  const type = undercroftTypeFor(plan, options.undercroftType);
  if (plan.semanticRoomPackUndercroftReplacement) {
    throw new Error('Authored Undercroft replacement has already been applied.');
  }
  if (plan.semanticRoomPackPlacements.some(({ id, roomId }) => (
    id === PLACEMENT_ID || Object.values(ROOM_ID_BY_TYPE).includes(roomId)
  ))) {
    throw new Error('Dungeon plan already contains an authored Undercroft placement.');
  }
  const entryPortal = plan.portals.find(({ id }) => id === ENTRY_PORTAL_ID);
  if (!entryPortal) throw new Error(`Golden plan is missing ${ENTRY_PORTAL_ID}.`);
  const entryY = type === 'magma' ? -9 : -9.5;
  const compiled = compileSemanticRoomPackPlacementV2(ROOM_ID_BY_TYPE[type], {
    placementId: PLACEMENT_ID,
    entrySocketId: 'entry_south',
    yawQuarterTurns: 1,
    targetPortal: {
      id: ENTRY_PORTAL_ID,
      position: vector(entryPortal.to.center.x, entryY, entryPortal.to.center.z),
      forward: vector(1, 0, 0),
      connectorType: 'hazard_door',
      aperture: [5.2, 5.1],
    },
  });
  const descriptor = getSemanticRoomPackV1Descriptor(compiled.roomId);
  const boundaries = compiled.structuralBoundaries.map((record) => enrichBoundary(compiled, record));
  const supportBoundaryIds = boundaries.filter(({ side }) => side === 'floor').map(({ id }) => id);
  if (!supportBoundaryIds.length) throw new Error('Authored Undercroft has no manifest floor foundation.');
  const fixtures = compiled.structuralFixtures.map((record) => enrichFixture(compiled, record, supportBoundaryIds));
  const surfaces = compiled.walkableSurfaces.map((record) => enrichSurface(
    compiled, descriptor, record, supportBoundaryIds, fixtures,
  ));
  const socketFrames = bindSockets(compiled, boundaries, {
    entry_south: ENTRY_PORTAL_ID,
    exit_north: RETURN_PORTAL_ID,
  });
  const enrichedPlacement = {
    ...compiled,
    goldenIntegrationRevision: SEMANTIC_ROOM_PACK_UNDERCROFT_REPLACEMENT_V2_REVISION,
    goldenRegionId: 'hazard-core',
    goldenRegionIds: ['hazard-intake', 'hazard-core'],
    goldenCellId: PACK_CELL_ID,
    socketBindings: socketFrames.bindings,
    boundPortalIds: [ENTRY_PORTAL_ID, RETURN_PORTAL_ID],
    socketCapBoundaryIds: socketFrames.bindings.filter(({ status }) => status === 'capped').map(({ capId }) => capId),
    structuralKitBoundaryIds: socketFrames.kitBoundaries.map(({ id }) => id),
    structuralBoundaries: boundaries,
    walkableSurfaces: surfaces,
    structuralFixtures: fixtures,
    fullyIntegrated: true,
  };
  const packCell = {
    id: PACK_CELL_ID,
    regionId: 'hazard-core',
    bounds: clonePlanData(compiled.worldBounds),
    playable: true,
    interior: true,
    cameraContained: true,
    occupiedVolume: true,
    authored: true,
    semanticRoomPackPlacementId: compiled.id,
  };
  const geometryChange = replaceRegionGeometry(
    plan,
    packCell,
    [...boundaries, ...socketFrames.kitBoundaries],
    surfaces,
    fixtures,
  );
  const portalBindings = updatePortalsAndLift(plan, enrichedPlacement, socketFrames, surfaces);
  const hazard = createHazardRuntime(plan, type, enrichedPlacement, surfaces, supportBoundaryIds);
  const content = rehomeContent(plan, enrichedPlacement, surfaces, portalBindings, geometryChange.preservedFixtures);
  const traversalLinks = createInternalTraversalLinks(enrichedPlacement, surfaces);
  plan.traversalLinks.push(...traversalLinks);

  const cacheAnchor = plan.anchors.find(({ id }) => id === 'anchor.cache.undercroft');
  cacheAnchor.descriptorReference = {
    placementId: compiled.id,
    roomId: compiled.roomId,
    sourceNodeName: content.rewardMarker.sourceNodeName,
  };
  enrichedPlacement.runtimeContractBindings = {
    hazard: {
      environmentStateId: 'environment.undercroft-hazard',
      mechanismId: 'mechanism.undercroft-hazard',
      profile: hazard.contract.profile,
      parameters: clonePlanData(hazard.contract.parameters),
      surfaceIds: hazard.triggerSurfaces.map(({ id }) => id),
      surfaceSourceNodeNames: hazard.triggerSurfaces.map(({ sourceNodeName }) => sourceNodeName),
      safeRouteSurfaceIds: surfaces.filter(({ sourceNodeName }) => (
        /WALK_(SAFE_ISLAND|INSULATED_PAD|ENTRY_|NORTH_)/u.test(sourceNodeName)
      )).map(({ id }) => id),
      rewardSurfaceId: content.rewardSurface.id,
      rewardSourceNodeName: content.rewardMarker.sourceNodeName,
      collisionAuthority: 'manifest-collision-volumes-plus-serialized-hazard-trigger-contracts',
      collisionDerivedFromVisibleMeshBounds: false,
    },
    reward: {
      rewardId: 'reward.cache.undercroft',
      anchorId: 'anchor.cache.undercroft',
      surfaceId: content.rewardSurface.id,
      sourceNodeName: content.rewardMarker.sourceNodeName,
    },
    permanentReturn: {
      portalId: RETURN_PORTAL_ID,
      gateId: 'Gate_Shortcut_Gamma',
      liftMechanismId: 'mechanism.gamma-return-lift',
      socketId: 'exit_north',
      landingSurfaceId: portalBindings.exitSurface.id,
    },
  };
  const placement = deepFreezePlan(enrichedPlacement);
  plan.semanticRoomPackPlacements.push(placement);
  plan.modulePlacements = plan.modulePlacements.filter((record) => (
    !(record.regionIds ?? []).includes('hazard-core')
  ));
  plan.modulePlacements.push(modulePlacement(placement));
  const coreRegion = plan.regions.find(({ id }) => id === 'hazard-core');
  if (coreRegion) {
    coreRegion.bounds = clonePlanData(compiled.worldBounds);
    coreRegion.functionalPurpose = compiled.gameplayPurpose;
    coreRegion.authoredModulePlacementId = compiled.id;
  }
  plan.semanticRoomPackUndercroftReplacement = {
    revision: SEMANTIC_ROOM_PACK_UNDERCROFT_REPLACEMENT_V2_REVISION,
    placementId: placement.id,
    roomId: placement.roomId,
    undercroftType: type,
    replacedCellIds: [...geometryChange.removedCellIds].sort(),
    replacedSurfaceIds: [...geometryChange.removedSurfaceIds].sort(),
    addedConnectorCellIds: [],
    boundPortalIds: [ENTRY_PORTAL_ID, RETURN_PORTAL_ID],
    safeRouteTraversalLinkIds: traversalLinks.filter(({ damageFree }) => damageFree).map(({ id }) => id),
    collisionAuthority: 'manifest-collision-volumes-only',
    collisionDerivedFromVisibleMeshBounds: false,
    fullyIntegrated: true,
    acceptanceBlocking: false,
  };
  const signatures = deriveDungeonTopologySignaturesV2(plan);
  for (const region of plan.regions) region.topologySignature = signatures[region.id];
  for (const module of plan.modulePlacements) {
    const regionId = module.regionIds?.[0];
    if (signatures[regionId]) module.topologySignature = signatures[regionId];
  }
  const result = validateSemanticRoomPackUndercroftReplacementV2(plan);
  if (!result.accepted) throw new SemanticRoomPackUndercroftReplacementErrorV2(result);
  return plan;
}

export default replaceGoldenUndercroftWithSemanticRoomPackV2;
