import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';
import { createRouteNetworkConflictEntitySignature } from '../src/dungeon-augmentation/index.js';

const TILE_SIZE = 2.8;

function v4BoundaryPlan({
  id,
  offsetX = 0,
  offsetZ = 0,
  fromAttachmentSocketId = null,
  toAttachmentSocketId = null,
  coincidentBoundaryTopology = false,
  straightFacing = { x: 1, z: 0 },
  elevation = 0,
  routeStationProxy = false,
} = {}) {
  const themeBinding = { themeId: 'industrial-v1', themeRevision: 'test-v4' };
  const path = coincidentBoundaryTopology
    ? [
        { x: offsetX - 1, z: offsetZ },
        { x: offsetX, z: offsetZ },
        { x: offsetX, z: offsetZ + 1 },
        { x: offsetX, z: offsetZ + 2 },
      ]
    : [0, 1, 2, 3, 4, 5, 6].map((ordinal) => ({
        x: offsetX + straightFacing.x * ordinal,
        z: offsetZ + straightFacing.z * ordinal,
      }));
  const sectionPathIndexes = coincidentBoundaryTopology
    ? [1, 2, 3]
    : path.map((_, index) => index);
  const sections = sectionPathIndexes.map((pathIndex) => {
    const center = path[pathIndex];
    const next = path[Math.min(path.length - 1, pathIndex + 1)];
    const previous = path[Math.max(0, pathIndex - 1)];
    const directionSource = pathIndex < path.length - 1 ? center : previous;
    const directionTarget = pathIndex < path.length - 1 ? next : center;
    return {
      pathIndex,
      center: { ...center },
      direction: {
        x: Math.sign(directionTarget.x - directionSource.x),
        z: Math.sign(directionTarget.z - directionSource.z),
      },
      elevation,
      ceilingY: elevation + 8.4,
      connectorZone: coincidentBoundaryTopology && pathIndex === 1
        ? 'gallery_turn_landing'
        : 'main_gallery',
      ...(coincidentBoundaryTopology && pathIndex === 1 ? {
        activeJunction: true,
        activePhysicalArmCount: 3,
        connectorJunctionProxyId: `${id}:junction`,
      } : {}),
    };
  });
  const socket = (endpoint, attachmentSocketId) => {
    const section = endpoint === 'from' ? sections[0] : sections.at(-1);
    const parentOwnerId = `${id}:${endpoint}:parent-owner`;
    const facingSign = endpoint === 'from' ? 1 : -1;
    return {
      id: `${id}:${endpoint}:socket`,
      x: section.center.x,
      z: section.center.z,
      elevation: section.elevation,
      facingX: section.direction.x * facingSign,
      facingZ: section.direction.z * facingSign,
      roomId: parentOwnerId,
      parentRouteId: parentOwnerId,
      authoritativeSeamParentOwnerId: parentOwnerId,
      authoritativeSeamNodeId: parentOwnerId,
      ...(attachmentSocketId ? {
        attachmentSocketId,
        routeNetworkGrantId: 'grant-boundary-test',
      } : {}),
      ...((coincidentBoundaryTopology || routeStationProxy) && endpoint === 'from' ? {
        connectorJunctionProxyId: `${id}:junction`,
      } : {}),
    };
  };
  const plan = {
    id,
    isDungeonSupplement: true,
    augmentationOperationType: 'routeNetwork',
    augmentationOperationId: 'operation-boundary-test',
    routeNetworkGrantId: 'grant-boundary-test',
    augmentationThemeBinding: themeBinding,
    bridgePath: path,
    galleryCrossSections: sections.map((section) => ({
      pathIndex: section.pathIndex,
      sections: [section],
    })),
    fromSocket: socket('from', fromAttachmentSocketId),
    toSocket: socket('to', toAttachmentSocketId),
    connectorJunctionProxyIds: coincidentBoundaryTopology
      ? [`${id}:junction`]
      : [],
  };
  const floors = sections.map((section) => ({
    x: section.center.x,
    z: section.center.z,
    elevation: section.elevation,
    augmentationFloorCellId: `${id}:floor:${section.pathIndex}`,
    signedConnectorFloorOwnerId: id,
    walkabilityIntent: 'required-clear',
  }));
  return { plan, floors, sections };
}

function wallRunsForRequirements(plans) {
  return plans.flatMap((plan) => (plan.structuralFrameRequirements ?? []).flatMap((requirement) => {
    const pathRunsHorizontally = Math.abs(Number(requirement.direction?.x)) === 1;
    const horizontal = !pathRunsHorizontally;
    const socketAxis = pathRunsHorizontally
      ? Number(requirement.gridPoint.x)
      : Number(requirement.gridPoint.z);
    const lateral = pathRunsHorizontally
      ? Number(requirement.gridPoint.z)
      : Number(requirement.gridPoint.x);
    const socket = requirement.boundaryEndpoint === 'to'
      ? plan.toSocket
      : plan.fromSocket;
    const ownerId = socket.authoritativeSeamParentOwnerId;
    const longitudinalSign = pathRunsHorizontally
      ? Number(requirement.direction?.x ?? 0)
      : Number(requirement.direction?.z ?? 0);
    const line = socketAxis + longitudinalSign * 0.5;
    return [-1, 1].map((side) => ({
      facadeId: `${plan.id}:wall-run:${requirement.attachmentSocketId}:${side}`,
      ownerId,
      ownerIds: [ownerId],
      horizontal,
      dx: Number(requirement.direction?.x ?? 0),
      dz: Number(requirement.direction?.z ?? 0),
      line,
      start: lateral + side * 2,
      end: lateral + side * 2,
      ownerByAxis: { [lateral + side * 2]: ownerId },
      ownerIdsByAxis: { [lateral + side * 2]: [ownerId] },
      wallBottomY: Number(requirement.floorElevation),
      wallTopY: Number(requirement.ceilingY),
    }));
  }));
}

function ownerMapsForRun(start, end, ownerId) {
  const ownerByAxis = {};
  const ownerIdsByAxis = {};
  for (let axis = start; axis <= end; axis += 1) {
    ownerByAxis[axis] = ownerId;
    ownerIdsByAxis[axis] = [ownerId];
  }
  return { ownerByAxis, ownerIdsByAxis };
}

function boundarySupportGeometry(plan, requirement) {
  const pathRunsHorizontally = Math.abs(Number(requirement.direction?.x)) === 1;
  const socket = requirement.boundaryEndpoint === 'to'
    ? plan.toSocket
    : plan.fromSocket;
  return {
    pathRunsHorizontally,
    horizontal: !pathRunsHorizontally,
    line: pathRunsHorizontally
      ? Number(requirement.gridPoint.x) + Number(requirement.direction.x) * 0.5
      : Number(requirement.gridPoint.z) + Number(requirement.direction.z) * 0.5,
    lateral: pathRunsHorizontally
      ? Number(requirement.gridPoint.z)
      : Number(requirement.gridPoint.x),
    ownerId: socket.authoritativeSeamParentOwnerId,
  };
}

function thresholdRun({
  plan,
  requirement,
  id,
  start,
  end,
  wallBottomY = Number(requirement.floorElevation),
  wallTopY = Number(requirement.ceilingY),
  ownerId = null,
  line = null,
} = {}) {
  const geometry = boundarySupportGeometry(plan, requirement);
  const resolvedOwnerId = ownerId ?? geometry.ownerId;
  return {
    facadeId: id,
    ownerId: resolvedOwnerId,
    ownerIds: [resolvedOwnerId],
    horizontal: geometry.horizontal,
    dx: Number(requirement.direction?.x ?? 0),
    dz: Number(requirement.direction?.z ?? 0),
    line: line ?? geometry.line,
    start,
    end,
    ...ownerMapsForRun(start, end, resolvedOwnerId),
    wallBottomY,
    wallTopY,
  };
}

function thresholdRunsAtOffset(plan, requirement, offsetTiles, { ownerId = null } = {}) {
  const geometry = boundarySupportGeometry(plan, requirement);
  const axis = geometry.pathRunsHorizontally
    ? Number(requirement.gridPoint.x)
    : Number(requirement.gridPoint.z);
  const longitudinalSign = geometry.pathRunsHorizontally
    ? Number(requirement.direction.x)
    : Number(requirement.direction.z);
  const line = axis + longitudinalSign * offsetTiles;
  return [-1, 1].map((side) => thresholdRun({
    plan,
    requirement,
    id: `${plan.id}:threshold:${offsetTiles}:${side}`,
    start: geometry.lateral + side * 2,
    end: geometry.lateral + side * 2,
    ownerId,
    line,
  }));
}

function parallelGalleryRuns(plan, requirement, { ownerId = plan.id } = {}) {
  const geometry = boundarySupportGeometry(plan, requirement);
  const axis = geometry.pathRunsHorizontally
    ? Number(requirement.gridPoint.x)
    : Number(requirement.gridPoint.z);
  return [-1, 1].map((side) => ({
    facadeId: `${plan.id}:gallery-side-wall:${side}`,
    ownerId,
    ownerIds: [ownerId],
    horizontal: geometry.pathRunsHorizontally,
    dx: geometry.pathRunsHorizontally ? 0 : side,
    dz: geometry.pathRunsHorizontally ? side : 0,
    line: geometry.lateral + side * 1.5,
    start: Math.floor(axis) - 3,
    end: Math.ceil(axis) + 3,
    ...ownerMapsForRun(Math.floor(axis) - 3, Math.ceil(axis) + 3, ownerId),
    wallBottomY: Number(requirement.floorElevation),
    wallTopY: Number(requirement.ceilingY),
  }));
}

function indicatorMetalBand(realization) {
  const frameBottom = Number(realization.floorElevation);
  const frameHeight = Number(realization.frameHeightMeters);
  const headerHeight = 0.38;
  const bracketHeight = Math.min(1.1, Math.max(0.72, frameHeight * 0.18));
  return {
    bottom: frameBottom + frameHeight - headerHeight - bracketHeight,
    top: frameBottom + frameHeight,
  };
}

function reserveSingleBoundary(options = {}) {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const fixture = v4BoundaryPlan({
    id: options.id ?? 'single-boundary-segment',
    fromAttachmentSocketId: options.attachmentSocketId ?? 'single-parent-attachment',
    ...options,
  });
  generator._reserveConnectorPresentationOutsideAuthoritativeSeams(
    [fixture.plan],
    [],
    fixture.floors,
  );
  return {
    generator,
    ...fixture,
    requirement: fixture.plan.structuralFrameRequirements[0],
    realization: fixture.plan.structuralFrameRealizations[0],
  };
}

function assertWallRunBindingFailure(fixture, wallRuns) {
  assertWallRunBindingError(fixture, wallRuns, 'structural-frame-wall-run-missing');
}

function assertWallRunBindingError(fixture, wallRuns, expectedError) {
  assert.throws(
    () => fixture.generator._bindDungeonSupplementStructuralFrameRealizations(
      [fixture.plan],
      wallRuns,
      fixture.floors,
      [],
    ),
    (error) => error.compatibility?.errors?.some((message) => (
      message.includes(expectedError)
    )),
  );
}

function reservedBoundaryNetwork(count, { duplicateFirstAttachment = true } = {}) {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const attachmentSocketIds = Array.from(
    { length: count },
    (_, index) => `parent-attachment-${index + 1}`,
  );
  const fixtures = attachmentSocketIds.map((attachmentSocketId, index) => v4BoundaryPlan({
    id: `network-segment-${String(index).padStart(2, '0')}`,
    offsetX: index * 12,
    offsetZ: index * 8,
    fromAttachmentSocketId: attachmentSocketId,
  }));
  if (duplicateFirstAttachment && attachmentSocketIds.length > 0) {
    fixtures.push(v4BoundaryPlan({
      id: 'zz-duplicate-attachment-segment',
      offsetX: 100,
      offsetZ: 100,
      fromAttachmentSocketId: attachmentSocketIds[0],
    }));
  }
  const plans = fixtures.map(({ plan }) => plan);
  const floors = fixtures.flatMap((fixture) => fixture.floors);
  const reservation = generator._reserveConnectorPresentationOutsideAuthoritativeSeams(
    plans,
    [],
    floors,
  );
  const wallRuns = wallRunsForRequirements(plans);
  return { generator, attachmentSocketIds, plans, floors, wallRuns, reservation };
}

test('V4 derivation emits only attachment-socket boundary indicators and retains coincident topology as metadata', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const fixture = v4BoundaryPlan({
    id: 'coincident-boundary-segment',
    fromAttachmentSocketId: 'parent-attachment-coincident',
    coincidentBoundaryTopology: true,
  });
  const result = generator._deriveDungeonSupplementStructuralFrameRequirements(
    fixture.plan,
    fixture.floors,
  );

  assert.deepEqual(result.errors, []);
  assert.equal(result.requirements.length, 1);
  const [indicator] = result.requirements;
  assert.equal(indicator.attachmentSocketId, 'parent-attachment-coincident');
  assert.equal(indicator.boundaryIndicator, true);
  assert.deepEqual(indicator.requiredRoles, ['bend', 'boundary', 'junction']);
  assert.deepEqual(indicator.coincidentTopologyRoles, ['bend', 'junction']);
  assert.equal(indicator.requiredRoles.includes('interval'), false);
  assert.equal(indicator.requiredRoles.includes('entrance'), false);
  assert.equal(indicator.requiredRoles.includes('reconnect'), false);
  assert.equal(indicator.blocking, false);
  assert.equal(indicator.collisionRole, 'none');
  assert.equal(indicator.navigationRole, 'none');

  const internal = v4BoundaryPlan({ id: 'internal-segment-with-long-bend-free-cadence' });
  const internalResult = generator._deriveDungeonSupplementStructuralFrameRequirements(
    internal.plan,
    internal.floors,
  );
  assert.deepEqual(internalResult, {
    schema: 'ruindivex-dungeon-structural-frame-derivation/v1',
    requirements: [],
    errors: [],
  });
});

test('V4 boundary indicators retain every cardinal socket floor and resolve an exact supported presentation plane', () => {
  for (const [name, facing] of Object.entries({
    east: { x: 1, z: 0 },
    west: { x: -1, z: 0 },
    south: { x: 0, z: 1 },
    north: { x: 0, z: -1 },
  })) {
    const fixture = reserveSingleBoundary({
      id: `cardinal-${name}-boundary`,
      attachmentSocketId: `cardinal-${name}-attachment`,
      offsetX: 20,
      offsetZ: 30,
      straightFacing: facing,
    });
    const socket = fixture.plan.fromSocket;
    const anchorFloor = fixture.floors.find((floor) => (
      floor.x === socket.x && floor.z === socket.z
    ));

    assert.deepEqual(fixture.requirement.gridPoint, { x: socket.x, z: socket.z }, name);
    assert.deepEqual(
      fixture.requirement.boundarySocketGridPoint,
      { x: socket.x, z: socket.z },
      name,
    );
    assert.deepEqual(fixture.requirement.direction, facing, name);
    assert.equal(fixture.requirement.anchorFloorCellId, anchorFloor.augmentationFloorCellId, name);
    assert.equal(fixture.realization.anchorFloorCellId, anchorFloor.augmentationFloorCellId, name);

    const binding = fixture.generator._bindDungeonSupplementStructuralFrameRealizations(
      [fixture.plan],
      wallRunsForRequirements([fixture.plan]),
      fixture.floors,
      [],
    );
    assert.equal(binding.accepted, true, name);
    assert.deepEqual(fixture.realization.presentationGridPoint, {
      x: socket.x + facing.x * 0.5,
      z: socket.z + facing.z * 0.5,
    }, name);
    assert.equal(fixture.realization.wallRunSupportKind, 'parent-threshold-facade');
  }
});

test('V4 to-boundary indicators retain a nonzero exact socket floor despite a coincident foreign decoy', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const fixture = v4BoundaryPlan({
    id: 'elevated-to-boundary',
    toAttachmentSocketId: 'elevated-to-attachment',
    straightFacing: { x: 0, z: 1 },
    elevation: 4.2,
  });
  const socket = fixture.plan.toSocket;
  const foreignDecoy = {
    x: socket.x,
    z: socket.z,
    elevation: socket.elevation,
    augmentationFloorCellId: 'foreign-coincident-floor',
    roomId: 'foreign-room',
    walkabilityIntent: 'required-clear',
  };
  const floors = [foreignDecoy, ...fixture.floors];
  generator._reserveConnectorPresentationOutsideAuthoritativeSeams(
    [fixture.plan],
    [],
    floors,
  );
  const [requirement] = fixture.plan.structuralFrameRequirements;
  const [realization] = fixture.plan.structuralFrameRealizations;
  const exactSocketFloor = fixture.floors.at(-1);

  assert.equal(requirement.boundaryEndpoint, 'to');
  assert.equal(requirement.floorElevation, 4.2);
  assert.equal(requirement.anchorFloorCellId, exactSocketFloor.augmentationFloorCellId);
  assert.notEqual(requirement.anchorFloorCellId, foreignDecoy.augmentationFloorCellId);

  const binding = generator._bindDungeonSupplementStructuralFrameRealizations(
    [fixture.plan],
    thresholdRunsAtOffset(fixture.plan, requirement, 0.5),
    floors,
    [],
  );
  assert.equal(binding.accepted, true);
  assert.deepEqual(realization.presentationGridPoint, {
    x: socket.x + requirement.direction.x * 0.5,
    z: socket.z + requirement.direction.z * 0.5,
  });
  assert.equal(realization.anchorFloorCellId, exactSocketFloor.augmentationFloorCellId);
});

test('V4 exact connector-gallery support binds at the socket for every cardinal facing', () => {
  for (const [name, facing] of Object.entries({
    east: { x: 1, z: 0 },
    west: { x: -1, z: 0 },
    south: { x: 0, z: 1 },
    north: { x: 0, z: -1 },
  })) {
    const fixture = reserveSingleBoundary({
      id: `cardinal-gallery-${name}`,
      attachmentSocketId: `cardinal-gallery-${name}-attachment`,
      straightFacing: facing,
    });
    const galleryRuns = parallelGalleryRuns(fixture.plan, fixture.requirement);
    const pathRunsHorizontally = Math.abs(facing.x) === 1;
    for (const [index, run] of galleryRuns.entries()) {
      const side = index === 0 ? -1 : 1;
      assert.equal(run.dx, pathRunsHorizontally ? 0 : side, name);
      assert.equal(run.dz, pathRunsHorizontally ? side : 0, name);
    }

    const binding = fixture.generator._bindDungeonSupplementStructuralFrameRealizations(
      [fixture.plan],
      galleryRuns,
      fixture.floors,
      [],
    );
    assert.equal(binding.accepted, true, name);
    assert.equal(fixture.realization.wallRunSupportKind, 'connector-gallery-sides', name);
    assert.deepEqual(
      fixture.realization.presentationGridPoint,
      fixture.requirement.boundarySocketGridPoint,
      name,
    );
  }
});

test('V4 corridor-station boundaries bind the nearest complete gallery-side pair inside the outside seam', () => {
  for (const [name, facing] of Object.entries({
    east: { x: 1, z: 0 },
    west: { x: -1, z: 0 },
    south: { x: 0, z: 1 },
    north: { x: 0, z: -1 },
  })) {
    const fixture = reserveSingleBoundary({
      id: `corridor-station-outside-seam-${name}`,
      attachmentSocketId: `corridor-station-outside-seam-${name}-attachment`,
      straightFacing: facing,
      routeStationProxy: true,
    });
    const pathRunsHorizontally = Math.abs(facing.x) === 1;
    const axis = pathRunsHorizontally
      ? Number(fixture.requirement.gridPoint.x)
      : Number(fixture.requirement.gridPoint.z);
    const supportAxis = axis + (pathRunsHorizontally ? facing.x : facing.z);
    const outwardSign = pathRunsHorizontally ? facing.x : facing.z;
    const outwardGalleryRuns = parallelGalleryRuns(
      fixture.plan,
      fixture.requirement,
    ).map((run) => {
      const outerAxis = supportAxis + outwardSign * 2;
      const start = Math.min(supportAxis, outerAxis);
      const end = Math.max(supportAxis, outerAxis);
      return {
        ...run,
        start,
        end,
        ...ownerMapsForRun(start, end, fixture.plan.id),
      };
    });

    const binding = fixture.generator._bindDungeonSupplementStructuralFrameRealizations(
      [fixture.plan],
      outwardGalleryRuns,
      fixture.floors,
      [],
    );

    assert.equal(binding.accepted, true, name);
    assert.equal(fixture.realization.wallRunSupportKind, 'connector-gallery-sides', name);
    assert.deepEqual(fixture.realization.presentationGridPoint, {
      x: Number(fixture.requirement.gridPoint.x) + facing.x,
      z: Number(fixture.requirement.gridPoint.z) + facing.z,
    }, name);
  }
});

test('V4 corridor-station boundary binding consumes the real T-junction wall runs at outside seam depth two', () => {
  const fixture = reserveSingleBoundary({
    id: 'collected-corridor-station-outside-seam',
    attachmentSocketId: 'collected-corridor-station-outside-seam-attachment',
    straightFacing: { x: 1, z: 0 },
    routeStationProxy: true,
  });
  const parentOwnerId = fixture.plan.fromSocket.authoritativeSeamParentOwnerId;
  const floorByColumn = new Map();
  for (let x = -1; x <= 1; x += 1) {
    for (let z = -3; z <= 3; z += 1) {
      floorByColumn.set(`${x},${z}`, {
        x,
        z,
        elevation: 0,
        roomId: parentOwnerId,
        walkabilityIntent: 'required-clear',
      });
    }
  }
  for (let x = 0; x <= 2; x += 1) {
    for (let z = -1; z <= 1; z += 1) {
      const key = `${x},${z}`;
      const floor = floorByColumn.get(key) ?? {
        x,
        z,
        elevation: 0,
        walkabilityIntent: 'required-clear',
      };
      floor.signedConnectorFloorOwnerId = fixture.plan.id;
      floorByColumn.set(key, floor);
    }
  }
  const anchorFloor = floorByColumn.get('0,0');
  anchorFloor.augmentationFloorCellId = fixture.requirement.anchorFloorCellId;
  const floors = [...floorByColumn.values()];
  const wallRuns = fixture.generator._collectBoundaryWallRuns(
    new Map(),
    new Set(),
    // The authored through-route shoulders are intentionally too short for
    // the marker's complete metal band. The connector-owned outside seam
    // retains the full 8.4 m shell and is therefore the exact valid support.
    [{ id: parentOwnerId, baseElevation: 0, ceilingY: 4.2 }],
    new Map(),
    floors,
  );

  const binding = fixture.generator._bindDungeonSupplementStructuralFrameRealizations(
    [fixture.plan],
    wallRuns,
    floors,
    [],
  );

  assert.equal(binding.accepted, true);
  assert.equal(fixture.realization.wallRunSupportKind, 'connector-gallery-sides');
  assert.deepEqual(fixture.realization.presentationGridPoint, { x: 2, z: 0 });
  assert.equal(fixture.realization.sourceWallRunIds.length, 2);
  assert.ok(fixture.realization.sourceWallRunIds.every((id) => (
    id.startsWith('h:') && (id.includes(':1.5:') || id.includes(':-1.5:'))
  )));
});

test('two-, three-, and four-socket networks deduplicate indicators to the exact parent attachment set', () => {
  for (const count of [2, 3, 4]) {
    const fixture = reservedBoundaryNetwork(count);
    const requirements = fixture.plans.flatMap((plan) => (
      plan.structuralFrameRequirements ?? []
    ));
    assert.equal(requirements.length, count);
    assert.deepEqual(
      requirements.map(({ attachmentSocketId }) => attachmentSocketId).sort(),
      [...fixture.attachmentSocketIds].sort(),
    );
    assert.equal(new Set(requirements.map(({ attachmentSocketId }) => (
      attachmentSocketId
    ))).size, count);
    assert.equal(
      fixture.plans.find(({ id }) => id === 'zz-duplicate-attachment-segment')
        .structuralFrameRequirements.length,
      0,
      'a repeated physical occurrence does not duplicate the network indicator',
    );
    assert.equal(fixture.reservation.boundaryIndicatorCount, count);
    assert.deepEqual(
      fixture.reservation.boundaryIndicatorAttachmentSocketIds,
      [...fixture.attachmentSocketIds].sort(),
    );
    assert.ok(requirements.every(({ requiredRoles }) => (
      !requiredRoles.includes('interval')
    )));

    const binding = fixture.generator._bindDungeonSupplementStructuralFrameRealizations(
      fixture.plans,
      fixture.wallRuns,
      fixture.floors,
      [],
    );
    assert.equal(binding.accepted, true);
    assert.equal(binding.boundaryIndicatorCount, count);
    assert.deepEqual(
      binding.boundaryIndicatorAttachmentSocketIds,
      [...fixture.attachmentSocketIds].sort(),
    );
  }
});

test('V4 boundary binding preserves exact floor, wall, theme, and renderer identities', () => {
  const fixture = reservedBoundaryNetwork(1, { duplicateFirstAttachment: false });
  const binding = fixture.generator._bindDungeonSupplementStructuralFrameRealizations(
    fixture.plans,
    fixture.wallRuns,
    fixture.floors,
    [],
  );
  const [plan] = fixture.plans;
  const [requirement] = plan.structuralFrameRequirements;
  const [realization] = plan.structuralFrameRealizations;

  assert.equal(binding.accepted, true);
  assert.equal(binding.requirementCount, 1);
  assert.equal(binding.realizationCount, 1);
  assert.equal(realization.anchorFloorCellId, requirement.anchorFloorCellId);
  assert.equal(realization.floorIdentityResolved, true);
  assert.equal(realization.wallRunBindingResolved, true);
  assert.deepEqual(realization.sourceWallRunIds, fixture.wallRuns.map(({ facadeId }) => facadeId));
  assert.deepEqual(realization.themeBinding, plan.augmentationThemeBinding);
  assert.equal(
    realization.rendererObjectId,
    `connectorIndustrialStructuralFrame_${plan.id}_0`,
  );
  assert.equal(realization.attachmentSocketId, fixture.attachmentSocketIds[0]);
  assert.equal(realization.blocking, false);
  assert.equal(realization.collisionRole, 'none');
  assert.equal(realization.navigationRole, 'none');
});

test('V4 lightweight boundary header can bind one parent-owned upper transom that covers both bracket contacts', () => {
  const fixture = reserveSingleBoundary({ id: 'upper-transom-boundary' });
  const geometry = boundarySupportGeometry(fixture.plan, fixture.requirement);
  const metalBand = indicatorMetalBand(fixture.realization);
  const transom = thresholdRun({
    plan: fixture.plan,
    requirement: fixture.requirement,
    id: 'parent-threshold-upper-transom',
    start: geometry.lateral - 2,
    end: geometry.lateral + 2,
    wallBottomY: metalBand.bottom - 0.01,
    wallTopY: metalBand.top + 0.01,
  });
  assert.ok(transom.wallBottomY > fixture.realization.floorElevation);

  const binding = fixture.generator._bindDungeonSupplementStructuralFrameRealizations(
    [fixture.plan],
    [transom],
    fixture.floors,
    [],
  );

  assert.equal(binding.accepted, true);
  assert.deepEqual(fixture.realization.sourceWallRunIds, [transom.facadeId]);
});

test('V4 boundary support accepts an exact non-mixed gallery-side pair at the socket', () => {
  const fixture = reserveSingleBoundary({ id: 'stale-parallel-frame-boundary' });
  const galleryRuns = parallelGalleryRuns(fixture.plan, fixture.requirement);
  const binding = fixture.generator._bindDungeonSupplementStructuralFrameRealizations(
    [fixture.plan],
    galleryRuns,
    fixture.floors,
    [],
  );
  assert.equal(binding.accepted, true);
  assert.equal(fixture.realization.wallRunSupportKind, 'connector-gallery-sides');
  assert.deepEqual(fixture.realization.presentationGridPoint, {
    ...fixture.requirement.boundarySocketGridPoint,
  });
});

test('V4 route-station proxy thresholds accept their exact connector-produced shell owner', () => {
  for (const [name, facing] of Object.entries({
    conveyorBoss: { x: -1, z: 0 },
    bossShrine: { x: 1, z: 0 },
  })) {
    const fixture = reserveSingleBoundary({
      id: `connector-owned-route-station-threshold-${name}`,
      straightFacing: facing,
      routeStationProxy: true,
    });
    assert.ok(fixture.plan.fromSocket.connectorJunctionProxyId);
    const connectorOwnedThreshold = thresholdRunsAtOffset(
      fixture.plan,
      fixture.requirement,
      1.5,
      { ownerId: fixture.plan.id },
    );

    const binding = fixture.generator._bindDungeonSupplementStructuralFrameRealizations(
      [fixture.plan],
      connectorOwnedThreshold,
      fixture.floors,
      [],
    );
    assert.equal(binding.accepted, true, name);
    assert.equal(
      fixture.realization.wallRunSupportKind,
      'parent-threshold-facade',
      name,
    );
    assert.deepEqual(
      fixture.realization.sourceWallRunIds,
      connectorOwnedThreshold.map(({ facadeId }) => facadeId),
      name,
    );
  }
});

test('V4 ordinary thresholds and gallery sides reject the opposite support owner family', () => {
  const thresholdFixture = reserveSingleBoundary({ id: 'wrong-threshold-owner-family' });
  assert.equal(thresholdFixture.plan.fromSocket.connectorJunctionProxyId, undefined);
  assertWallRunBindingFailure(
    thresholdFixture,
    thresholdRunsAtOffset(
      thresholdFixture.plan,
      thresholdFixture.requirement,
      0.5,
      { ownerId: thresholdFixture.plan.id },
    ),
  );

  const galleryFixture = reserveSingleBoundary({ id: 'wrong-gallery-owner-family' });
  assertWallRunBindingFailure(
    galleryFixture,
    parallelGalleryRuns(galleryFixture.plan, galleryFixture.requirement, {
      ownerId: galleryFixture.plan.fromSocket.authoritativeSeamParentOwnerId,
    }),
  );
});

test('V4 gallery support rejects wall normals that the boundary collector cannot emit', () => {
  const fixture = reserveSingleBoundary({ id: 'impossible-gallery-wall-normal' });
  const invalidRuns = parallelGalleryRuns(fixture.plan, fixture.requirement)
    .map((run) => ({
      ...run,
      dx: Number(fixture.requirement.direction.x),
      dz: Number(fixture.requirement.direction.z),
    }));
  assertWallRunBindingFailure(fixture, invalidRuns);
});

test('V4 boundary support never combines one threshold contact with one gallery contact', () => {
  const fixture = reserveSingleBoundary({ id: 'mixed-support-family' });
  const [thresholdLeft] = thresholdRunsAtOffset(
    fixture.plan,
    fixture.requirement,
    0.5,
  );
  const galleryRight = parallelGalleryRuns(fixture.plan, fixture.requirement)[1];
  assertWallRunBindingFailure(fixture, [galleryRight, thresholdLeft]);
});

test('V4 threshold support rejects complete facades behind or beyond the bounded parent seam', () => {
  for (const offsetTiles of [-0.5, 2.5]) {
    const fixture = reserveSingleBoundary({
      id: `out-of-bounds-threshold-${String(offsetTiles).replace('.', '_')}`,
    });
    assertWallRunBindingFailure(
      fixture,
      thresholdRunsAtOffset(fixture.plan, fixture.requirement, offsetTiles),
    );
  }
});

test('V4 threshold support selects the nearest valid plane independent of wall-run order', () => {
  for (const reverseOrder of [false, true]) {
    const fixture = reserveSingleBoundary({
      id: `nearest-threshold-order-${reverseOrder ? 'reverse' : 'forward'}`,
    });
    const near = thresholdRunsAtOffset(fixture.plan, fixture.requirement, 0.5);
    const far = thresholdRunsAtOffset(fixture.plan, fixture.requirement, 1.5);
    const wallRuns = reverseOrder
      ? [...near].reverse().concat([...far].reverse())
      : [...far, ...near];
    const binding = fixture.generator._bindDungeonSupplementStructuralFrameRealizations(
      [fixture.plan],
      wallRuns,
      fixture.floors,
      [],
    );
    assert.equal(binding.accepted, true);
    assert.deepEqual(fixture.realization.presentationGridPoint, {
      x: fixture.requirement.boundarySocketGridPoint.x
        + fixture.requirement.direction.x * 0.5,
      z: fixture.requirement.boundarySocketGridPoint.z
        + fixture.requirement.direction.z * 0.5,
    });
    assert.ok(fixture.realization.sourceWallRunIds.every((id) => (
      id.includes(':threshold:0.5:')
    )));
  }
});

test('V4 boundary support requires both exact threshold bracket contacts', () => {
  const fixture = reserveSingleBoundary({ id: 'missing-threshold-shoulder-boundary' });
  const [oneShoulder] = wallRunsForRequirements([fixture.plan]);
  assertWallRunBindingFailure(fixture, [oneShoulder]);
});

test('V4 boundary support reads parent ownership at the exact contact axis', () => {
  const fixture = reserveSingleBoundary({ id: 'foreign-contact-owner-boundary' });
  const wallRuns = wallRunsForRequirements([fixture.plan]);
  const [corrupted] = wallRuns;
  const [contactAxis] = Object.keys(corrupted.ownerByAxis);
  corrupted.ownerId = fixture.plan.fromSocket.authoritativeSeamParentOwnerId;
  corrupted.ownerIds = [
    fixture.plan.fromSocket.authoritativeSeamParentOwnerId,
    'foreign-wall-owner',
  ];
  corrupted.ownerByAxis = { [contactAxis]: 'foreign-wall-owner' };
  corrupted.ownerIdsByAxis = { [contactAxis]: ['foreign-wall-owner'] };

  assertWallRunBindingFailure(fixture, wallRuns);
});

test('V4 boundary support requires full vertical coverage of the actual header and bracket metal band', () => {
  const fixture = reserveSingleBoundary({ id: 'short-wall-metal-band-boundary' });
  const wallRuns = wallRunsForRequirements([fixture.plan]);
  const metalBand = indicatorMetalBand(fixture.realization);
  wallRuns[0].wallBottomY = metalBand.bottom + 0.01;

  assertWallRunBindingFailure(fixture, wallRuns);
});

test('V4 boundary support fails closed when vertical or per-axis owner evidence is absent', () => {
  const cases = [
    {
      name: 'wall-bottom',
      mutate(run) { delete run.wallBottomY; },
    },
    {
      name: 'wall-top',
      mutate(run) { delete run.wallTopY; },
    },
    {
      name: 'owner-ids-by-axis',
      mutate(run) { delete run.ownerIdsByAxis; },
    },
  ];
  for (const entry of cases) {
    const fixture = reserveSingleBoundary({ id: `missing-${entry.name}-evidence` });
    const wallRuns = wallRunsForRequirements([fixture.plan]);
    entry.mutate(wallRuns[0]);
    assertWallRunBindingFailure(fixture, wallRuns);
  }
});

test('V4 resolved wall binding metadata is immutable across repeated validation', () => {
  const cases = [
    {
      name: 'realization-point',
      mutate(fixture) { delete fixture.realization.presentationGridPoint; },
    },
    {
      name: 'requirement-kind',
      mutate(fixture) { delete fixture.requirement.wallRunSupportKind; },
    },
    {
      name: 'realization-run-ids',
      mutate(fixture) { fixture.realization.sourceWallRunIds = []; },
    },
    {
      name: 'requirement-resolved-flag',
      mutate(fixture) { delete fixture.requirement.wallRunBindingResolved; },
    },
  ];
  for (const entry of cases) {
    const fixture = reserveSingleBoundary({ id: `binding-drift-${entry.name}` });
    const wallRuns = wallRunsForRequirements([fixture.plan]);
    const firstBinding = fixture.generator._bindDungeonSupplementStructuralFrameRealizations(
      [fixture.plan],
      wallRuns,
      fixture.floors,
      [],
    );
    assert.equal(firstBinding.accepted, true);
    assert.equal(fixture.requirement.wallRunBindingResolved, true);
    const repeatedBinding = fixture.generator._bindDungeonSupplementStructuralFrameRealizations(
      [fixture.plan],
      wallRuns,
      fixture.floors,
      [],
    );
    assert.equal(repeatedBinding.accepted, true);

    entry.mutate(fixture);
    assertWallRunBindingError(
      fixture,
      wallRuns,
      'structural-frame-wall-run-binding-drift',
    );
  }
});

test('V4 widened route-station boundaries bind the exact short-seam threshold facade, never nearby gallery walls', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const fixture = v4BoundaryPlan({
    id: 'widened-route-station-boundary',
    fromAttachmentSocketId: 'widened-route-station-attachment',
  });
  fixture.plan.bridgePath = fixture.plan.bridgePath.slice(0, 3);
  fixture.plan.galleryCrossSections = [fixture.plan.galleryCrossSections[2]];
  generator._reserveConnectorPresentationOutsideAuthoritativeSeams(
    [fixture.plan],
    [],
    fixture.floors,
  );
  const [requirement] = fixture.plan.structuralFrameRequirements;
  const [realization] = fixture.plan.structuralFrameRealizations;
  const exactThresholdRuns = wallRunsForRequirements([fixture.plan]);
  const staleWidenedGalleryRuns = parallelGalleryRuns(fixture.plan, requirement)
    .map((run, index) => ({
      ...run,
      facadeId: `${fixture.plan.id}:widened-gallery-wall:${index}`,
      line: run.line + Math.sign(run.line || 1),
    }));

  assert.deepEqual(requirement.gridPoint, { x: 0, z: 0 });
  assert.equal(requirement.anchorFloorCellId, `${fixture.plan.id}:floor:0`);
  const binding = generator._bindDungeonSupplementStructuralFrameRealizations(
    [fixture.plan],
    [...staleWidenedGalleryRuns, ...exactThresholdRuns],
    fixture.floors,
    [],
  );

  assert.equal(binding.accepted, true);
  assert.deepEqual(realization.presentationGridPoint, { x: 0.5, z: 0 });
  assert.equal(realization.wallRunSupportKind, 'parent-threshold-facade');
  assert.deepEqual(
    realization.sourceWallRunIds,
    exactThresholdRuns.map(({ facadeId }) => facadeId),
  );
});

test('boundary wall collection retains every physical floor owner at each exact wall-run axis', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const floors = [-1, 0, 1].map((x) => ({
    x,
    z: 0,
    elevation: 0,
    roomId: 'authored-parent-room',
    signedConnectorFloorOwnerId: 'supplement-boundary-segment',
    authoritativeSocketSeamOwnerIds: ['supplement-boundary-segment'],
    walkabilityIntent: 'required-clear',
  }));
  const wallRuns = generator._collectBoundaryWallRuns(
    new Map(),
    new Set(),
    [{ id: 'authored-parent-room', baseElevation: 0, ceilingY: 8.4 }],
    new Map(),
    floors,
  );
  const northFacade = wallRuns.find((run) => (
    run.horizontal && run.line === -0.5 && run.start === -1 && run.end === 1
  ));

  assert.ok(northFacade);
  for (const axis of [-1, 0, 1]) {
    assert.deepEqual(northFacade.ownerIdsByAxis[axis], [
      'authored-parent-room',
      'supplement-boundary-segment',
    ]);
  }
});

test('boundary wall collection unions co-located physical owners instead of keeping the last contributor', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const floors = [
    {
      x: 0,
      z: 0,
      elevation: 0,
      roomId: 'co-located-parent-owner',
      walkabilityIntent: 'required-clear',
    },
    {
      x: 0,
      z: 0,
      elevation: 0,
      signedConnectorFloorOwnerId: 'co-located-connector-owner',
      augmentationOwnerId: 'co-located-connector-owner',
      connectorCeilingY: 8.4,
      walkabilityIntent: 'required-clear',
    },
  ];
  const wallRuns = generator._collectBoundaryWallRuns(
    new Map(),
    new Set(),
    [{ id: 'co-located-parent-owner', baseElevation: 0, ceilingY: 8.4 }],
    new Map(),
    floors,
  );

  assert.equal(wallRuns.length, 4);
  for (const run of wallRuns) {
    assert.deepEqual([...run.ownerIdsByAxis[0]].sort(), [
      'co-located-connector-owner',
      'co-located-parent-owner',
    ]);
  }
});

test('V4 binding rejects attachment-set drift and missing or duplicated realizations', () => {
  const missing = reservedBoundaryNetwork(2);
  missing.plans.find((plan) => plan.structuralFrameRealizations.length > 0)
    .structuralFrameRealizations.length = 0;
  assert.throws(
    () => missing.generator._bindDungeonSupplementStructuralFrameRealizations(
      missing.plans, missing.wallRuns, missing.floors, [],
    ),
    (error) => error.compatibility?.errors?.some((entry) => (
      entry.includes('missing-or-duplicate-structural-frame-realization')
    )),
  );

  const duplicate = reservedBoundaryNetwork(2);
  const duplicateOwner = duplicate.plans.find((plan) => plan.structuralFrameRealizations.length > 0);
  duplicateOwner.structuralFrameRealizations.push({
    ...duplicateOwner.structuralFrameRealizations[0],
    id: `${duplicateOwner.structuralFrameRealizations[0].id}:duplicate`,
  });
  assert.throws(
    () => duplicate.generator._bindDungeonSupplementStructuralFrameRealizations(
      duplicate.plans, duplicate.wallRuns, duplicate.floors, [],
    ),
    (error) => error.compatibility?.code
      === 'DUNGEON_AUGMENTATION_STRUCTURAL_FRAME_BINDING_FAILED',
  );

  const drift = reservedBoundaryNetwork(2);
  const driftOwner = drift.plans.find((plan) => plan.structuralFrameRequirements.length > 0);
  driftOwner.structuralFrameRequirements[0].attachmentSocketId = 'invented-parent-attachment';
  driftOwner.structuralFrameRealizations[0].attachmentSocketId = 'invented-parent-attachment';
  assert.throws(
    () => drift.generator._bindDungeonSupplementStructuralFrameRealizations(
      drift.plans, drift.wallRuns, drift.floors, [],
    ),
    (error) => error.compatibility?.errors?.includes(
      'v4-boundary-indicator-attachment-socket-set-mismatch',
    ),
  );
});

test('V4 network binding rejects parent attachment metadata missing from physical plans', () => {
  const fixture = reservedBoundaryNetwork(2, { duplicateFirstAttachment: false });
  const missingSocketPlan = fixture.plans.find((plan) => (
    plan.fromSocket?.attachmentSocketId === fixture.attachmentSocketIds[1]
  ));
  delete missingSocketPlan.fromSocket.attachmentSocketId;
  fixture.generator._reserveConnectorPresentationOutsideAuthoritativeSeams(
    fixture.plans,
    [],
    fixture.floors,
  );
  fixture.wallRuns = wallRunsForRequirements(fixture.plans);
  assert.throws(
    () => fixture.generator._bindDungeonSupplementStructuralFrameRealizations(
      fixture.plans,
      fixture.wallRuns,
      fixture.floors,
      [],
      [{
        grantId: 'grant-boundary-test',
        endpointSocketIds: fixture.attachmentSocketIds,
      }],
    ),
    (error) => error.compatibility?.errors?.some((entry) => (
      entry.includes('materialized-parent-attachment-socket-set-mismatch')
        || entry.includes('boundary-indicator-network-socket-set-mismatch')
    )),
  );
});

test('V4 boundary binding rejects floor, wall, theme, and renderer identity drift', () => {
  const cases = [
    {
      expected: 'structural-frame-floor-identity-invalid',
      mutate(fixture) {
        const requirement = fixture.plans[0].structuralFrameRequirements[0];
        const floor = fixture.floors.find(({ augmentationFloorCellId }) => (
          augmentationFloorCellId === requirement.anchorFloorCellId
        ));
        floor.augmentationFloorCellId = 'foreign-floor-cell';
      },
    },
    {
      expected: 'structural-frame-wall-run-missing',
      mutate(fixture) { fixture.wallRuns = []; },
    },
    {
      expected: 'structural-frame-theme-binding-missing',
      mutate(fixture) {
        fixture.plans[0].augmentationThemeBinding = null;
      },
    },
    {
      expected: 'structural-frame-realization-unresolved',
      mutate(fixture) {
        fixture.plans[0].structuralFrameRealizations[0].rendererObjectId =
          'renderer-may-not-rename-boundary-indicator';
      },
    },
  ];
  for (const entry of cases) {
    const fixture = reservedBoundaryNetwork(1, { duplicateFirstAttachment: false });
    entry.mutate(fixture);
    assert.throws(
      () => fixture.generator._bindDungeonSupplementStructuralFrameRealizations(
        fixture.plans, fixture.wallRuns, fixture.floors, [],
      ),
      (error) => error.compatibility?.errors?.some((message) => (
        message.includes(entry.expected)
      )),
      entry.expected,
    );
  }
});

test('missing V4 boundary support attributes only the exact route segment for replay exclusion', () => {
  const fixture = reserveSingleBoundary({
    id: 'exact-structural-frame-conflict-segment',
    attachmentSocketId: 'exact-structural-frame-conflict-attachment',
  });
  const operation = {
    id: fixture.plan.augmentationOperationId,
    type: 'routeNetwork',
    grantId: fixture.plan.routeNetworkGrantId,
    routeNetworkKind: 'objective-route-coverage',
  };
  const segment = {
    id: fixture.plan.id,
    operationId: operation.id,
    kind: 'route-network-segment',
    routeRole: 'objective-route-coverage:spine',
    connectorFamily: 'service-gallery',
    from: {
      nodeId: fixture.plan.fromRoomId ?? 'authored:from',
      socketId: fixture.plan.fromSocket.id,
      position: { ...fixture.plan.bridgePath[0], y: 0 },
    },
    to: {
      nodeId: fixture.plan.toRoomId ?? 'supplement:to',
      socketId: fixture.plan.toSocket.id,
      position: { ...fixture.plan.bridgePath.at(-1), y: 0 },
    },
    path: fixture.plan.bridgePath.map((point) => ({ ...point, y: 0 })),
  };
  const overlayPlan = {
    augmentationPlanHash: 'augmentation:exact-structural-frame-conflict',
    effectivePlanHash: 'effective:exact-structural-frame-conflict',
    operations: [operation],
    nodes: [],
    segments: [segment],
  };

  let caught = null;
  try {
    fixture.generator._bindDungeonSupplementStructuralFrameRealizations(
      [fixture.plan],
      [],
      fixture.floors,
      [],
      [],
      overlayPlan,
    );
  } catch (error) {
    caught = error;
  }

  assert.ok(caught);
  assert.equal(caught.code, 'DUNGEON_AUGMENTATION_INCOMPATIBLE_CONTENT');
  assert.equal(
    caught.compatibility?.code,
    'DUNGEON_AUGMENTATION_STRUCTURAL_FRAME_BINDING_FAILED',
  );
  assert.equal(caught.compatibility?.structuralFrameFailures?.length, 1);
  assert.deepEqual(
    caught.compatibility.structuralFrameFailures[0],
    {
      code: 'DUNGEON_AUGMENTATION_STRUCTURAL_FRAME_WALL_RUN_MISSING',
      diagnosticCode: 'structural-frame-wall-run-missing',
      message: `${fixture.plan.id}:${fixture.realization.id}:structural-frame-wall-run-missing`,
      operationId: operation.id,
      grantId: operation.grantId,
      entityKind: 'segment',
      segmentId: segment.id,
      connectionId: segment.id,
      requirementId: fixture.realization.requirementId,
      realizationId: fixture.realization.id,
      attachmentSocketId: fixture.realization.attachmentSocketId,
      boundaryEndpoint: fixture.realization.boundaryEndpoint,
    },
  );
  assert.deepEqual(caught.augmentationDiagnostics?.failedRouteNetworkGrants, [{
    grantId: operation.grantId,
    augmentationOperationId: operation.id,
    routeNetworkKind: operation.routeNetworkKind,
    connectionIds: [segment.id],
    roomIds: [],
    socketIds: [fixture.realization.attachmentSocketId],
    failureKinds: ['DUNGEON_AUGMENTATION_STRUCTURAL_FRAME_WALL_RUN_MISSING'],
  }]);
  assert.deepEqual(caught.augmentationDiagnostics?.routeNetworkConflictExclusions, [{
    grantId: operation.grantId,
    entityKind: 'segment',
    entityId: segment.id,
    signature: createRouteNetworkConflictEntitySignature(segment, 'segment'),
    reason: 'route-network-structural-frame-wall-run-missing',
  }]);
  assert.equal(
    Object.hasOwn(caught.augmentationDiagnostics, 'routeNetworkPruningOverrides'),
    false,
  );
});

test('V4 boundary renderer uses at most two meshes and adds no collision or navigation footprint', () => {
  const fixture = reservedBoundaryNetwork(1, { duplicateFirstAttachment: false });
  fixture.generator._bindDungeonSupplementStructuralFrameRealizations(
    fixture.plans,
    fixture.wallRuns,
    fixture.floors,
    [],
  );
  const [plan] = fixture.plans;
  const [realization] = plan.structuralFrameRealizations;
  const group = new THREE.Group();
  const solidZones = [];
  const materials = {
    supportMetal: new THREE.MeshBasicMaterial(),
    hazardStripe: new THREE.MeshBasicMaterial(),
    glowBlue: new THREE.MeshBasicMaterial(),
  };
  fixture.generator._addVolumetricIndustrialPrefabs(
    group,
    [],
    [],
    fixture.plans,
    materials,
    solidZones,
  );

  const rendered = group.getObjectByName(realization.rendererObjectId);
  assert.ok(rendered);
  assert.equal(rendered.userData.connectorBoundaryIndicator, true);
  assert.equal(rendered.userData.attachmentSocketId, fixture.attachmentSocketIds[0]);
  assert.equal(rendered.userData.nonBlockingPresentation, true);
  assert.equal(rendered.userData.drawCallUpperBound, 2);
  assert.equal(rendered.userData.bracketCenterOffsetMeters, 1.5 * TILE_SIZE);
  const meshes = [];
  rendered.traverse((object) => {
    if (object.isMesh) meshes.push(object);
  });
  assert.equal(meshes.length, 2);
  assert.ok(meshes.length <= 2);
  assert.deepEqual(meshes.map(({ name }) => name).sort(), [
    'industrialBoundaryIndicatorMergedHeader',
    'industrialBoundaryIndicatorServiceStripe',
  ]);
  assert.equal(solidZones.length, 0);
  assert.equal(realization.blocking, false);
  assert.equal(realization.collisionRole, 'none');
  assert.equal(realization.navigationRole, 'none');
  assert.equal(realization.rendered, true);

  group.traverse((object) => object.geometry?.dispose?.());
  Object.values(materials).forEach((material) => material.dispose());
});

test('V4 boundary renderer faces its one-sided service stripe toward every cardinal socket direction', () => {
  for (const [name, facing] of Object.entries({
    east: { x: 1, z: 0 },
    west: { x: -1, z: 0 },
    south: { x: 0, z: 1 },
    north: { x: 0, z: -1 },
  })) {
    const fixture = reserveSingleBoundary({
      id: `cardinal-stripe-${name}`,
      attachmentSocketId: `cardinal-stripe-${name}-attachment`,
      straightFacing: facing,
    });
    fixture.generator._bindDungeonSupplementStructuralFrameRealizations(
      [fixture.plan],
      wallRunsForRequirements([fixture.plan]),
      fixture.floors,
      [],
    );
    const group = new THREE.Group();
    const materials = {
      supportMetal: new THREE.MeshBasicMaterial(),
      hazardStripe: new THREE.MeshBasicMaterial(),
      glowBlue: new THREE.MeshBasicMaterial(),
    };
    fixture.generator._addVolumetricIndustrialPrefabs(
      group,
      [],
      [],
      [fixture.plan],
      materials,
      [],
    );
    group.updateMatrixWorld(true);
    const rendered = group.getObjectByName(fixture.realization.rendererObjectId);
    const stripe = rendered?.getObjectByName('industrialBoundaryIndicatorServiceStripe');
    assert.ok(rendered, name);
    assert.ok(stripe, name);
    const frameWorld = rendered.getWorldPosition(new THREE.Vector3());
    const stripeWorld = stripe.getWorldPosition(new THREE.Vector3());
    assert.ok(Math.abs((stripeWorld.x - frameWorld.x) - facing.x * 0.25) <= 1e-6, name);
    assert.ok(Math.abs((stripeWorld.z - frameWorld.z) - facing.z * 0.25) <= 1e-6, name);

    group.traverse((object) => object.geometry?.dispose?.());
    Object.values(materials).forEach((material) => material.dispose());
  }
});

test('authoritative V4 supplemental rooms bypass the legacy Industrial room-setpiece renderer', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const group = new THREE.Group();
  generator._addIndustrialRoomSetpieces(group, [{
    id: 'supplemental-presentation-owner',
    type: 'supplement',
    isDungeonSupplement: true,
    x: 0,
    z: 0,
    width: 5,
    depth: 5,
  }], [], {}, [], { suppressDungeonSupplementPresentation: true });
  assert.equal(group.children.length, 0);
});

test('legacy supplemental rooms retain their V1 Industrial room-setpiece rendering', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const group = new THREE.Group();
  const materials = Object.fromEntries([
    'glowBlue',
    'glowRed',
    'wallTrim',
    'supportMetal',
  ].map((key) => [key, new THREE.MeshBasicMaterial()]));

  generator._addIndustrialRoomSetpieces(group, [{
    id: 'legacy-supplemental-presentation-owner',
    type: 'supplement',
    isDungeonSupplement: true,
    x: 0,
    z: 0,
    width: 5,
    depth: 5,
  }], [], materials, []);

  assert.equal(group.children.length, 1);
  assert.equal(group.children[0].name, 'industrialRoomSetpiece_legacy-supplemental-presentation-owner');
  assert.ok(group.children[0].children.length > 0);

  group.traverse((object) => object.geometry?.dispose?.());
  Object.values(materials).forEach((material) => material.dispose());
});

test('unsigned V4 gallery preparation never inherits V1 arch or service cadence', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const path = Array.from({ length: 13 }, (_, x) => ({ x, z: 0 }));
  const tiles = new Map(path.map((point) => [
    `${point.x},${point.z}`,
    { ...point, type: 'hallway', elevation: 0, level: 0 },
  ]));
  const plan = {
    id: 'unsigned-v4-gallery',
    isDungeonSupplement: true,
    augmentationOperationType: 'routeNetwork',
    augmentationOperationId: 'unsigned-v4-operation',
    routeNetworkGrantId: 'unsigned-v4-grant',
    fromRoomId: 'unsigned-from',
    toRoomId: 'unsigned-to',
    level: 0,
    elevation: 0,
    fullPath: path.map((point) => ({ ...point })),
    bridgePath: path.map((point) => ({ ...point })),
    fromSocket: { id: 'unsigned-from-socket', x: 0, z: 0 },
    toSocket: { id: 'unsigned-to-socket', x: 12, z: 0 },
  };
  generator._addConnectorExplorationSpaces(tiles, [{
    id: 'unsigned-from', type: 'machine', x: -20, z: 0, width: 1, depth: 1,
  }, {
    id: 'unsigned-to', type: 'server', x: 20, z: 0, width: 1, depth: 1,
  }], [plan]);

  assert.deepEqual(plan.decorativeArchBeats, []);
  assert.deepEqual(plan.classicV1ServiceBeats, []);
  assert.equal(plan.connectorPresentation.baseFamily, 'v4_parent_socket_boundary_indicator');
});

test('signed V4 gallery preparation does not reserve phantom interval-arch cadence', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const path = Array.from({ length: 13 }, (_, x) => ({ x, z: 0 }));
  const tiles = new Map(path.map((point) => [
    `${point.x},${point.z}`,
    { ...point, type: 'hallway', elevation: 0, level: 0 },
  ]));
  const plan = {
    id: 'signed-v4-gallery',
    isDungeonSupplement: true,
    augmentationOperationType: 'routeNetwork',
    augmentationOperationId: 'signed-v4-operation',
    routeNetworkGrantId: 'signed-v4-grant',
    fromRoomId: 'signed-from',
    toRoomId: 'signed-to',
    level: 0,
    elevation: 0,
    sourceElevation: 0,
    destinationElevation: 0,
    elevationDelta: 0,
    fullPath: path.map((point) => ({ ...point })),
    bridgePath: path.map((point) => ({ ...point })),
    fromSocket: { id: 'signed-from-socket', x: 0, z: 0, elevation: 0 },
    toSocket: { id: 'signed-to-socket', x: 12, z: 0, elevation: 0 },
    connectorVariantConstraints: { roomFootprints: [] },
  };
  generator._addConnectorExplorationSpaces(tiles, [], [plan]);
  generator._applyConnectorTraversalSurfaces(tiles, [plan], [...tiles.values()]);

  assert.deepEqual(plan.decorativeArchBeats, []);
  assert.deepEqual(
    plan.flatBayCandidates.map(({ longitudinalIndex }) => longitudinalIndex),
    [3, 4, 5, 6, 7, 8, 9],
  );
});

test('legacy authored arches are outside the V4 boundary-indicator binding path', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const legacyPlan = {
    id: 'legacy-v1-connector',
    decorativeArchBeats: [{ id: 'legacy-v1-arch' }],
  };
  const result = generator._bindDungeonSupplementStructuralFrameRealizations(
    [legacyPlan], [], [], [],
  );
  assert.deepEqual(result, {
    schema: 'ruindivex-dungeon-structural-frame-binding-diagnostics/v1',
    requirementCount: 0,
    realizationCount: 0,
    boundWallRunCount: 0,
    boundaryIndicatorCount: 0,
    boundaryIndicatorAttachmentSocketIds: [],
    accepted: true,
  });
  assert.deepEqual(legacyPlan.decorativeArchBeats, [{ id: 'legacy-v1-arch' }]);
});
