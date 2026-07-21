import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { isSerializablePlanValue } from '../../../src/dungeon-v2/DungeonPlanV2Contract.js';
import {
  LEGACY_FIXED_ROOM_MODULE_CATALOG_V2,
  cloneLegacyFixedRoomModuleV2,
} from '../../../src/dungeon-v2/LegacyFixedRoomModuleCatalogV2.js';
import {
  LEGACY_FIXED_ROOM_DEFAULT_DRAW_CALL_BUDGET_V2,
  LEGACY_FIXED_ROOM_NATIVE_RECIPE_IDS_V2,
  LEGACY_FIXED_ROOM_TEXTURE_TILE_SCALE_METRES_V2,
  compileLegacyFixedRoomPlacementV2,
  compileLegacyFixedRoomSupportContractsV2,
  compileLegacyFixedRoomStructuralContractV2,
  createLegacyFixedRoomPlanPlacementRecordV2,
  createLegacyFixedRoomRuntimeAdapterV2,
  createLegacyFixedRoomStructuralContractSignatureV2,
  getLegacyFixedRoomNativeRecipeV2,
  recompileAcceptedLegacyFixedRoomPlacementV2,
  toLegacyFixedRoomWorldIdV2,
} from '../../../src/dungeon-v2/LegacyFixedRoomRuntimeAdapterV2.js';
import { transformPointQuarterTurns } from '../../../src/dungeon-v2/DungeonSpatialMathV2.js';

function containsPoint(localBounds, point, epsilon = 1e-7) {
  return ['x', 'y', 'z'].every((axis) => (
    Math.abs(point[axis] - localBounds.center[axis]) <= localBounds.halfSize[axis] + epsilon
  ));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('native recipe registry is explicit and the adapter never invokes DungeonGenerator', async () => {
  const recipeIds = Object.values(LEGACY_FIXED_ROOM_NATIVE_RECIPE_IDS_V2);
  assert.equal(new Set(recipeIds).size, recipeIds.length);
  for (const recipeId of recipeIds) {
    const recipe = getLegacyFixedRoomNativeRecipeV2(recipeId, recipeId.includes('fence')
      ? { width: 8, height: 2.9 }
      : undefined);
    assert.equal(recipe.id, recipeId);
    assert.equal(recipe.source, 'dungeon-v1');
    assert.equal(recipe.scalePolicy, 'source-authored-uniform-only');
    assert.ok(recipe.components.length >= 1);
    assert.equal(isSerializablePlanValue(recipe), true);
    assert.equal(Object.isFrozen(recipe), true);
  }
  assert.equal(getLegacyFixedRoomNativeRecipeV2('generic-room-box'), null);

  const source = await readFile(new URL('../../../src/dungeon-v2/LegacyFixedRoomRuntimeAdapterV2.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /import .*DungeonGenerator\.js/);
  assert.doesNotMatch(source, /genericFallback\s*:\s*true/);
  assert.match(source, /makeScale\(authoredScale, authoredScale, authoredScale\)/);
});

test('structural contracts physically cap unused sockets and open only exact paired apertures', () => {
  for (const module of LEGACY_FIXED_ROOM_MODULE_CATALOG_V2) {
    const capped = compileLegacyFixedRoomStructuralContractV2(module);
    const allSocketIds = module.extensionSockets.map(({ id }) => id);
    const opened = compileLegacyFixedRoomStructuralContractV2(module, { openSocketIds: allSocketIds });
    assert.notEqual(capped.id, opened.id);
    assert.deepEqual(capped.openSocketIds, []);
    assert.deepEqual(opened.openSocketIds, [...allSocketIds].sort());
    assert.equal(Object.isFrozen(capped), true);
    assert.equal(isSerializablePlanValue(capped), true);

    for (const socket of module.extensionSockets.filter(({ boundarySide }) => (
      ['north', 'south', 'east', 'west'].includes(boundarySide)
    ))) {
      const probe = {
        ...socket.anchor,
        y: socket.opening.sillElevation + socket.opening.height * 0.5,
      };
      assert.ok(
        capped.structuralBoundaries.some(({ localBounds }) => containsPoint(localBounds, probe)),
        `${socket.id} has an opaque physical cap`,
      );
      assert.equal(
        opened.structuralBoundaries.some(({ localBounds }) => containsPoint(localBounds, probe)),
        false,
        `${socket.id} cuts a real paired opening`,
      );
    }

    const expectedRemovedIds = new Set(module.extensionSockets
      .filter((socket) => (
        socket.boundarySide === 'interior-floor'
        && socket.aperture.mode === 'remove-declared-surfaces'
      ))
      .flatMap(({ aperture }) => aperture.surfaceIds));
    const cappedSurfaceIds = new Set(capped.walkableSurfaces.map(({ id }) => id));
    const openedSurfaceIds = new Set(opened.walkableSurfaces.map(({ id }) => id));
    const actualRemovedIds = new Set([...cappedSurfaceIds].filter((id) => !openedSurfaceIds.has(id)));
    assert.deepEqual(actualRemovedIds, expectedRemovedIds, `${module.id} removes only declared fall-aperture tiles`);
  }
});

test('placement compiler owns all four yaw transforms, canonical bounds, IDs, and deterministic signatures', () => {
  const module = LEGACY_FIXED_ROOM_MODULE_CATALOG_V2.find(({ extensionSockets }) => (
    extensionSockets.some(({ boundarySide }) => boundarySide === 'east')
  ));
  const openSocketIds = module.extensionSockets.slice(0, 2).map(({ id }) => id);
  const contract = compileLegacyFixedRoomStructuralContractV2(module, { openSocketIds });
  const translation = { x: 41.25, y: -3.5, z: 19.75 };
  for (let yawQuarterTurns = 0; yawQuarterTurns < 4; yawQuarterTurns += 1) {
    const placementId = `test-placement-yaw-${yawQuarterTurns}`;
    const placement = compileLegacyFixedRoomPlacementV2(module, {
      id: placementId,
      translation,
      yawQuarterTurns,
      structuralContract: contract,
    });
    assert.equal(Object.isFrozen(placement), true);
    assert.equal(isSerializablePlanValue(placement), true);
    assert.equal(placement.presentationProfileId, 'legacy-fixed-room-native-v2');
    assert.match(placement.structuralContractSignature, /^legacy-fixed-room-structural-v2:[0-9a-f]{8}$/);
    assert.deepEqual(placement.localOpenSocketIds, contract.openSocketIds);
    assert.deepEqual(placement.placedRecordIds.structuralBoundaryIds, placement.structuralBoundaries.map(({ id }) => id));
    assert.deepEqual(placement.placedRecordIds.walkableSurfaceIds, placement.walkableSurfaces.map(({ id }) => id));
    assert.deepEqual(placement.placedRecordIds.fixtureColliderIds, placement.fixtureColliders.map(({ id }) => id));
    assert.deepEqual(placement.placedRecordIds.portalIds, placement.portals.map(({ id }) => id));

    const localSurface = contract.walkableSurfaces[0];
    const placedSurface = placement.walkableSurfaces.find(({ localId }) => localId === localSurface.id);
    assert.deepEqual(
      placedSurface.center,
      transformPointQuarterTurns(localSurface.center, { translation, yawQuarterTurns }),
    );
    assert.equal(placedSurface.id, toLegacyFixedRoomWorldIdV2(placementId, localSurface.id));
    assert.equal(placedSurface.presentationOwnerId, placementId);
    assert.equal(placedSurface.presentationContractId, placement.presentation.contractId);
    assert.deepEqual(placedSurface.descriptorReference, {
      moduleId: module.id,
      moduleRevision: module.revision,
      structuralContractId: contract.id,
      localId: localSurface.id,
    });
    assert.ok(placedSurface.bounds.min.x < placedSurface.bounds.max.x);
    assert.ok(placedSurface.bounds.min.y < placedSurface.bounds.max.y);
    assert.ok(placedSurface.bounds.min.z < placedSurface.bounds.max.z);
    for (const boundary of placement.structuralBoundaries) {
      assert.ok(boundary.bounds.min.x < boundary.bounds.max.x);
      assert.ok(boundary.bounds.min.y < boundary.bounds.max.y);
      assert.ok(boundary.bounds.min.z < boundary.bounds.max.z);
    }
    for (const collider of placement.fixtureColliders) {
      assert.ok(collider.bounds.min.x < collider.bounds.max.x);
      assert.ok(collider.bounds.min.y < collider.bounds.max.y);
      assert.ok(collider.bounds.min.z < collider.bounds.max.z);
    }

    const rebuilt = recompileAcceptedLegacyFixedRoomPlacementV2(placement);
    assert.strictEqual(rebuilt.module, module);
    assert.deepEqual(rebuilt.structuralContract.openSocketIds, contract.openSocketIds);
    assert.equal(
      createLegacyFixedRoomStructuralContractSignatureV2(placement),
      placement.structuralContractSignature,
    );
  }
  assert.equal(toLegacyFixedRoomWorldIdV2('placement', 'surface.local'), 'placement:surface.local');
});

test('lean accepted placements recompile exact geometry and hard-fail stale revisions, signatures, and slash aliases', () => {
  const module = LEGACY_FIXED_ROOM_MODULE_CATALOG_V2[0];
  const contract = compileLegacyFixedRoomStructuralContractV2(module);
  const compiled = compileLegacyFixedRoomPlacementV2(module, {
    id: 'tamper-proof-placement',
    translation: { x: 2, y: 3, z: 4 },
    yawQuarterTurns: 1,
    structuralContract: contract,
  });
  const placement = createLegacyFixedRoomPlanPlacementRecordV2(compiled, {
    semanticRegionIds: module.semanticRegions.map(({ id }) => id),
  });
  assert.equal(placement.structuralBoundaries, undefined);
  assert.equal(placement.walkableSurfaces, undefined);
  assert.equal(placement.fixtureColliders, undefined);
  assert.equal(placement.portals, undefined);
  const rebuilt = recompileAcceptedLegacyFixedRoomPlacementV2(placement);
  assert.deepEqual(rebuilt.expectedPlacement.structuralBoundaries, compiled.structuralBoundaries);
  assert.deepEqual(rebuilt.expectedPlacement.walkableSurfaces, compiled.walkableSurfaces);

  const stale = clone(placement);
  stale.descriptorRevision += 1;
  assert.throws(() => recompileAcceptedLegacyFixedRoomPlacementV2(stale), /missing or stale/);

  const wrongSignature = clone(placement);
  wrongSignature.structuralContractSignature = 'legacy-fixed-room-structural-v2:00000000';
  assert.throws(() => recompileAcceptedLegacyFixedRoomPlacementV2(wrongSignature), /structuralContractSignature/);

  const slashAlias = clone(placement);
  slashAlias.placedRecordIds.walkableSurfaceIds[0] = slashAlias.placedRecordIds.walkableSurfaceIds[0].replace(':', '/');
  assert.throws(() => recompileAcceptedLegacyFixedRoomPlacementV2(slashAlias), /placedRecordIds/);
});

test('every service-ladder shaft preserves the authored 0.40m player-root path at all yaws', () => {
  const rootRadius = 0.4;
  let ladderSocketCount = 0;
  for (const module of LEGACY_FIXED_ROOM_MODULE_CATALOG_V2) {
    for (const socket of module.extensionSockets.filter(({ form }) => form === 'service-ladder')) {
      ladderSocketCount += 1;
      const contract = compileLegacyFixedRoomStructuralContractV2(module, {
        openSocketIds: [socket.id],
      });
      for (let yawQuarterTurns = 0; yawQuarterTurns < 4; yawQuarterTurns += 1) {
        const translation = { x: 17, y: -2, z: 31 };
        const placement = compileLegacyFixedRoomPlacementV2(module, {
          id: `ladder-clearance-${ladderSocketCount}-${yawQuarterTurns}`,
          translation,
          yawQuarterTurns,
          structuralContract: contract,
        });
        const worldAnchor = transformPointQuarterTurns(socket.anchor, { translation, yawQuarterTurns });
        const approachSurfaceIds = new Set(socket.approachSurfaceIds.map((id) => (
          toLegacyFixedRoomWorldIdV2(placement.id, id)
        )));
        const approachY = Math.min(...placement.walkableSurfaces
          .filter(({ id }) => approachSurfaceIds.has(id))
          .map(({ topY }) => topY));
        const shaftTopY = translation.y + module.enclosure.ceilingHeight + rootRadius;
        const blockers = [...placement.structuralBoundaries, ...placement.fixtureColliders].filter(({ bounds }) => {
          const dx = Math.max(bounds.min.x - worldAnchor.x, 0, worldAnchor.x - bounds.max.x);
          const dz = Math.max(bounds.min.z - worldAnchor.z, 0, worldAnchor.z - bounds.max.z);
          const overlapsVerticalPath = bounds.max.y > approachY + 1e-6 && bounds.min.y < shaftTopY;
          return overlapsVerticalPath && Math.hypot(dx, dz) < rootRadius;
        });
        assert.deepEqual(
          blockers.map(({ id }) => id),
          [],
          `${socket.id}/yaw${yawQuarterTurns} has no hidden frame or fixture collision in the climb root path`,
        );
      }
    }
  }
  assert.equal(ladderSocketCount, 3);
});

test('native raised floors compile only explicit masses plus V1 catwalk frames and supported ramp runs', () => {
  const module = LEGACY_FIXED_ROOM_MODULE_CATALOG_V2.find(({ id }) => id === 'v1-room.refractor-shrine');
  const socket = module.extensionSockets.find(({ id }) => id.endsWith('catwalk.north-east-bucket'));
  const structuralContract = compileLegacyFixedRoomStructuralContractV2(module, {
    openSocketIds: [socket.id],
  });
  const placement = compileLegacyFixedRoomPlacementV2(module, {
    id: 'support-proof-shrine',
    translation: { x: 220, y: 16, z: 0 },
    yawQuarterTurns: 1,
    structuralContract,
  });
  const floorBoundary = placement.structuralBoundaries.find(({ side }) => side === 'floor');
  const support = compileLegacyFixedRoomSupportContractsV2(placement, {
    regionId: 'extraction',
    cellId: 'cell.extraction.main',
    floorBoundaryId: floorBoundary.id,
  });
  assert.equal(Object.isFrozen(support), true);
  assert.equal(isSerializablePlanValue(support), true);
  assert.equal(support.fixtures.filter(({ type }) => type === 'native-v1-solid-deck-mass').length, 1,
    'only the explicitly authored Refractor dais remains a solid architectural mass');
  assert.equal(support.fixtures.filter(({ type }) => type === 'native-v1-catwalk-frame').length, 2,
    'the V1 perimeter catwalk and revered mezzanine each retain a thin framed support contract');
  assert.equal(support.fixtures.filter(({ type }) => type === 'native-v1-ramp-support').length, 2);

  const raisedSurfaces = placement.walkableSurfaces.filter((surface) => (
    surface.bounds.min.y > placement.worldBounds.min.y + 0.5
  ));
  for (const surface of raisedSurfaces) {
    const fixtureIds = support.surfaceSupportFixtureIds[surface.id];
    assert.equal(fixtureIds?.length, 1, `${surface.id} has one exact native support owner`);
    const fixture = support.fixtures.find(({ id }) => id === fixtureIds[0]);
    assert.ok(fixture.supportedSurfaceIds.includes(surface.id));
    assert.equal(fixture.collision, 'blocking');
    assert.ok(fixture.colliderIds.length > 0);
    assert.equal(fixture.colliderIds.length, fixture.colliderBounds.length);
    assert.equal(fixture.supportBoundaryIds[0], floorBoundary.id);
    if (surface.shape === 'ramp-tile') {
      assert.equal(fixture.type, 'native-v1-ramp-support');
      const supportedRampTileCount = fixture.supportedSurfaceIds.filter((surfaceId) => (
        placement.walkableSurfaces.find(({ id }) => id === surfaceId)?.shape === 'ramp-tile'
      )).length;
      assert.equal(fixture.stringers.length, supportedRampTileCount * 2,
        'flat turn landings share the route support but do not invent extra sloped stringers');
      const surfaceSequence = fixture.supportedSurfaceIds.indexOf(surface.id) + 1;
      assert.deepEqual(
        fixture.stringers
          .filter(({ id }) => id.startsWith(`stringer.${surfaceSequence}.`))
          .map(({ id }) => id),
        [`stringer.${surfaceSequence}.left`, `stringer.${surfaceSequence}.right`],
        `${surface.id} keeps its paired visible stringers even when its underside meets the base floor`,
      );
      const alongX = Math.abs(surface.ramp.direction.x) > 0.5;
      const foundations = fixture.colliderBounds.filter((bounds) => (
        bounds.min.x >= surface.bounds.min.x - 1e-6
        && bounds.max.x <= surface.bounds.max.x + 1e-6
        && bounds.min.z >= surface.bounds.min.z - 1e-6
        && bounds.max.z <= surface.bounds.max.z + 1e-6
        && (alongX
          ? Math.abs(bounds.min.x - surface.bounds.min.x) <= 1e-6
            && Math.abs(bounds.max.x - surface.bounds.max.x) <= 1e-6
          : Math.abs(bounds.min.z - surface.bounds.min.z) <= 1e-6
            && Math.abs(bounds.max.z - surface.bounds.max.z) <= 1e-6)
      ));
      assert.ok(
        foundations.length === 0 || foundations.length === 2,
        `${surface.id} has either paired edge foundations or no redundant base-floor mass`,
      );
      assert.equal(fixture.foundationProfile, 'paired-edge-foundations-outside-player-lane');
      for (const foundation of foundations) {
        assert.ok(
          foundation.max.y <= Math.min(surface.ramp.startY, surface.ramp.endY) - surface.size.y + 1e-6,
          `${surface.id} support cannot protrude through the walkable slope`,
        );
        const crossWidth = alongX
          ? foundation.max.z - foundation.min.z
          : foundation.max.x - foundation.min.x;
        assert.ok(crossWidth <= 0.22 + 1e-6,
          `${surface.id} foundation must stay outside the player lane`);
      }
    } else if (surface.support?.style === 'solid_mass') {
      assert.equal(fixture.type, 'native-v1-solid-deck-mass');
      assert.equal(fixture.bounds.min.y, placement.worldBounds.min.y);
      assert.ok(fixture.bounds.max.y <= surface.bounds.min.y + 1e-6);
    } else if (surface.traversalRoute?.routeId) {
      assert.equal(fixture.type, 'native-v1-ramp-support',
        `${surface.id} is an authored ramp landing supported by its route stringers`);
    } else {
      assert.equal(fixture.type, 'native-v1-catwalk-frame');
      assert.equal(fixture.sourceArchitecture,
        'DungeonGenerator._addFactoryTileSupports+_addFactoryRailRuns');
      assert.equal(fixture.colliderBounds.length, fixture.partRoles.length);
      assert.equal(fixture.partMaterialProfileIds.length, fixture.partRoles.length);
      assert.equal(fixture.partRoles.every((role, index) => (
        fixture.partMaterialProfileIds[index]
          === (role.startsWith('rail-') ? 'legacy-rail' : 'legacy-support')
      )), true, 'V1 factoryRail and supportMetal remain distinct authored materials');
      assert.ok(fixture.partRoles.includes('support-post'));
      assert.ok(fixture.partRoles.includes('underbeam-x'));
      assert.ok(fixture.partRoles.includes('underbeam-z'));
      assert.ok(fixture.partRoles.includes('rail-run'));
      assert.ok(fixture.partRoles.includes('rail-post'));
      assert.equal(fixture.catwalkProfile.deckAuthority, 'native-walkable-surface-0.12m');
    }
  }
});

test('Shrine stacked V1 catwalk routes retain 3.2m capsule clearance at all four yaws', () => {
  const module = LEGACY_FIXED_ROOM_MODULE_CATALOG_V2.find(({ id }) => (
    id === 'v1-room.refractor-shrine'
  ));
  const structuralContract = compileLegacyFixedRoomStructuralContractV2(module, {
    openSocketIds: module.extensionSockets.map(({ id }) => id),
  });
  const capsuleRadius = 0.42;
  const capsuleHeight = 3.2;
  for (let yawQuarterTurns = 0; yawQuarterTurns < 4; yawQuarterTurns += 1) {
    const placement = compileLegacyFixedRoomPlacementV2(module, {
      id: `support-proof-shrine-yaw-${yawQuarterTurns}`,
      translation: { x: 37, y: 8, z: -29 },
      yawQuarterTurns,
      structuralContract,
    });
    const floorBoundary = placement.structuralBoundaries.find(({ side }) => side === 'floor');
    const support = compileLegacyFixedRoomSupportContractsV2(placement, {
      regionId: 'extraction',
      cellId: 'cell.extraction.main',
      floorBoundaryId: floorBoundary.id,
    });
    const frames = support.fixtures.filter(({ type }) => type === 'native-v1-catwalk-frame');
    assert.equal(frames.length, 2, `yaw ${yawQuarterTurns} keeps both framed routes`);
    const frameBounds = frames.flatMap(({ colliderBounds }) => colliderBounds);
    const lowerSurfaces = placement.walkableSurfaces.filter(({ sourceSurface }) => (
      sourceSurface === 'catwalk'
    ));
    const upperByTile = new Map(placement.walkableSurfaces
      .filter(({ sourceSurface }) => sourceSurface === 'reveredMezzanine')
      .map((surface) => [`${surface.localTile.x}:${surface.localTile.z}`, surface]));
    let overlapCount = 0;
    for (const lower of lowerSurfaces) {
      const upper = upperByTile.get(`${lower.localTile.x}:${lower.localTile.z}`);
      if (!upper) continue;
      overlapCount += 1;
      assert.ok(upper.bounds.min.y - lower.bounds.max.y >= 3.2 - 1e-9,
        `${lower.id} has a full 3.2m envelope below ${upper.id}`);
      const point = { x: lower.center.x, y: lower.bounds.max.y, z: lower.center.z };
      const blockers = frameBounds.filter((bounds) => {
        if (bounds.max.y <= point.y + 0.03
          || bounds.min.y >= point.y + capsuleHeight - 0.005) return false;
        const dx = Math.max(bounds.min.x - point.x, 0, point.x - bounds.max.x);
        const dz = Math.max(bounds.min.z - point.z, 0, point.z - bounds.max.z);
        return dx * dx + dz * dz < capsuleRadius * capsuleRadius - 1e-8;
      });
      assert.deepEqual(blockers, [], `${lower.id} centerline is clear at yaw ${yawQuarterTurns}`);
    }
    assert.equal(overlapCount, 69, `yaw ${yawQuarterTurns} audits every stacked Shrine tile`);
  }
});

test('native Machine Factory thin catwalk frame leaves the complete player ramp corridor clear', () => {
  const module = LEGACY_FIXED_ROOM_MODULE_CATALOG_V2.find(({ id }) => (
    id === 'v1-room.machine-factory'
  ));
  const structuralContract = compileLegacyFixedRoomStructuralContractV2(module, {
    openSocketIds: module.extensionSockets.map(({ id }) => id),
  });
  const placement = compileLegacyFixedRoomPlacementV2(module, {
    id: 'support-proof-machine-factory',
    translation: { x: -96, y: 0, z: 40 },
    yawQuarterTurns: 0,
    structuralContract,
  });
  const floorBoundary = placement.structuralBoundaries.find(({ side }) => side === 'floor');
  const support = compileLegacyFixedRoomSupportContractsV2(placement, {
    regionId: 'assembly',
    cellId: 'cell.assembly.main',
    floorBoundaryId: floorBoundary.id,
  });
  const deckMasses = support.fixtures.filter(({ type }) => type === 'native-v1-solid-deck-mass');
  const catwalkFrames = support.fixtures.filter(({ type }) => type === 'native-v1-catwalk-frame');
  const ramp = [...placement.walkableSurfaces]
    .filter(({ shape, ramp: rampContract }) => (
      shape === 'ramp-tile'
      && rampContract?.routeId === 'ramp.machine-factory.west-catwalk'
    ))
    .sort((left, right) => (
      left.traversalRoute.sequenceIndex - right.traversalRoute.sequenceIndex
    ));
  assert.equal(deckMasses.length, 0,
    'ordinary Machine Factory catwalks must never become full-height architectural masses');
  assert.equal(catwalkFrames.length, 2,
    'the source perimeter catwalk and upper machine catwalk each use one exact V1 frame');
  assert.equal(ramp.length, 11);
  const routeStartY = ramp[0].ramp.startY;
  const routeEndY = ramp.at(-1).ramp.endY;
  for (const [index, surface] of ramp.entries()) {
    const expectedStartY = routeStartY + (routeEndY - routeStartY) * (index / ramp.length);
    const expectedEndY = routeStartY + (routeEndY - routeStartY) * ((index + 1) / ramp.length);
    assert.equal(surface.ramp.startY, expectedStartY,
      `${surface.id} starts on the shared continuous ramp profile`);
    assert.equal(surface.ramp.endY, expectedEndY,
      `${surface.id} ends on the shared continuous ramp profile`);
    assert.equal(surface.topY, (expectedStartY + expectedEndY) * 0.5,
      `${surface.id} visual center matches its exact collider slope`);
    assert.equal(surface.ramp.collisionProfile, 'continuous-linear-run');
  }
  assert.equal(catwalkFrames.every(({ partRoles }) => (
    partRoles.includes('support-post')
    && partRoles.includes('underbeam-x')
    && partRoles.includes('underbeam-z')
    && partRoles.includes('rail-run')
    && partRoles.includes('rail-post')
  )), true, 'each thin catwalk component keeps V1 posts, underbeams, and perimeter rails');
  assert.equal(catwalkFrames.some(({ catwalkProfile }) => (
    catwalkProfile.railOpenings.some(({ reason }) => reason === 'authored-ramp-connection')
  )), true, 'the upper frame records an intentional rail opening at the authored ramp');

  const direction = ramp[0].ramp.direction;
  const runLength = Math.abs(direction.x) > 0.5 ? ramp[0].size.x : ramp[0].size.z;
  const start = {
    x: ramp[0].center.x - direction.x * runLength * 0.5,
    y: ramp[0].ramp.startY,
    z: ramp[0].center.z - direction.z * runLength * 0.5,
  };
  const end = {
    x: ramp.at(-1).center.x + direction.x * runLength * 0.5,
    y: ramp.at(-1).ramp.endY,
    z: ramp.at(-1).center.z + direction.z * runLength * 0.5,
  };
  assert.deepEqual(start, { x: -118.4, y: 0, z: 58.199999999999996 });
  assert.deepEqual(end, { x: -118.4, y: 4.05, z: 27.400000000000002 });
  const capsuleRadius = 0.42;
  const capsuleHeight = 3.2;
  const capsuleIntersects = (point, bounds) => {
    if (bounds.max.y <= point.y + 0.03 || bounds.min.y >= point.y + capsuleHeight - 0.005) {
      return false;
    }
    const dx = Math.max(bounds.min.x - point.x, 0, point.x - bounds.max.x);
    const dz = Math.max(bounds.min.z - point.z, 0, point.z - bounds.max.z);
    return dx * dx + dz * dz < capsuleRadius * capsuleRadius - 1e-8;
  };
  const distance = Math.hypot(end.x - start.x, end.z - start.z);
  const sampleCount = Math.ceil(distance / 0.1);
  const samples = Array.from({ length: sampleCount + 1 }, (_, index) => {
    const ratio = index / sampleCount;
    return {
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio,
      z: start.z + (end.z - start.z) * ratio,
    };
  });
  const blockingSupports = support.fixtures.filter(({ collision }) => collision === 'blocking');
  const carvedBlockers = samples.flatMap((point) => blockingSupports.flatMap((fixture) => (
    fixture.colliderBounds
      .filter((bounds) => capsuleIntersects(point, bounds))
      .map(() => ({ fixtureId: fixture.id, point }))
  )));
  assert.deepEqual(carvedBlockers, [],
    'no native deck or ramp foundation collider may occupy the public player capsule along the ramp');

  for (const frame of catwalkFrames) {
    for (const [index, bounds] of frame.colliderBounds.entries()) {
      const size = {
        x: bounds.max.x - bounds.min.x,
        y: bounds.max.y - bounds.min.y,
        z: bounds.max.z - bounds.min.z,
      };
      const role = frame.partRoles[index];
      assert.notEqual(
        size.y > 1 && size.x > 2.7 && size.z > 2.7,
        true,
        `${frame.id}/${role} cannot recreate a broad floor-to-deck wall`,
      );
    }
  }
});

test('all eleven rooms render capped and all-open at every yaw within the native draw budget', () => {
  const adapter = createLegacyFixedRoomRuntimeAdapterV2({ loadBrowserTextures: false });
  try {
    for (const module of LEGACY_FIXED_ROOM_MODULE_CATALOG_V2) {
      const socketModes = [
        { label: 'capped', openSocketIds: [] },
        { label: 'all-open', openSocketIds: module.extensionSockets.map(({ id }) => id) },
      ];
      for (const { label, openSocketIds } of socketModes) {
        const structuralContract = compileLegacyFixedRoomStructuralContractV2(module, { openSocketIds });
        for (let yawQuarterTurns = 0; yawQuarterTurns < 4; yawQuarterTurns += 1) {
          const group = adapter.buildModule(module, {
            structuralContract,
            placement: {
              translation: { x: 13, y: -2, z: 29 },
              yawQuarterTurns,
            },
          });
          const diagnostics = group.userData.v2PresentationDiagnostics;
          assert.ok(
            diagnostics.drawCalls <= LEGACY_FIXED_ROOM_DEFAULT_DRAW_CALL_BUDGET_V2,
            `${module.id}/${label}/yaw${yawQuarterTurns} uses ${diagnostics.drawCalls} draw calls`,
          );
          assert.equal(diagnostics.nonUniformPrefabScaling, false);
          assert.equal(diagnostics.genericFallbackGeometry, false);
          assert.equal(diagnostics.visibleFixtureCount, module.fixtures.length);
          assert.equal(group.position.x, 13);
          assert.equal(group.position.y, -2);
          assert.equal(group.position.z, 29);
          assert.equal(group.rotation.y, yawQuarterTurns * Math.PI * 0.5);

          let texturedBatchCount = 0;
          let worldTiledStructuralBatchCount = 0;
          group.traverse((object) => {
            if (!object.isInstancedMesh) return;
            assert.ok(object instanceof THREE.InstancedMesh);
            assert.equal(object.userData.v2PresentationOnly, true);
            assert.equal(object.userData.v2LegacyFixedRoomPresentation, true);
            assert.ok(Array.isArray(object.userData.v2InstanceIds));
            assert.ok(Array.isArray(object.userData.v2ContractIds));
            assert.equal(object.userData.collider, undefined);
            assert.equal(object.userData.collisionZone, undefined);
            assert.equal(object.userData.solidZone, undefined);
            if (object.material.userData.v2TextureAssetId) {
              texturedBatchCount += 1;
              assert.equal(object.material.userData.v2LegacyRuinMaterial, true);
              assert.match(object.material.map.userData.v2TextureUrl, /^\/assets\/textures\/ruins\//);
            }
            const textureDimensions = object.geometry.getAttribute('instanceV2TextureDimensions');
            if (textureDimensions) {
              worldTiledStructuralBatchCount += 1;
              assert.ok(textureDimensions instanceof THREE.InstancedBufferAttribute);
              assert.equal(textureDimensions.count, object.count);
              assert.deepEqual(object.userData.v2TextureTiling, {
                mode: 'per-instance-world-dimensions',
                tileScaleMetres: LEGACY_FIXED_ROOM_TEXTURE_TILE_SCALE_METRES_V2,
                attribute: 'instanceV2TextureDimensions',
              });
              for (let index = 0; index < textureDimensions.count; index += 1) {
                assert.ok(textureDimensions.getX(index) > 0);
                assert.ok(textureDimensions.getY(index) > 0);
                assert.ok(textureDimensions.getZ(index) > 0);
              }
              if (object.material.map) {
                assert.equal(object.material.userData.v2WorldScaleTiling, true);
                assert.equal(
                  object.material.userData.v2TextureTileScaleMetres,
                  LEGACY_FIXED_ROOM_TEXTURE_TILE_SCALE_METRES_V2,
                );
                const shader = {
                  vertexShader: '#include <common>\n#include <uv_vertex>',
                  fragmentShader: '',
                  uniforms: {},
                };
                object.material.onBeforeCompile(shader, null);
                assert.match(shader.vertexShader, /attribute vec3 instanceV2TextureDimensions/);
                assert.match(shader.vertexShader, /vMapUv/);
              }
            }
          });
          assert.ok(texturedBatchCount >= 1, `${module.id} renders V1 ruin texture maps`);
          assert.ok(
            worldTiledStructuralBatchCount >= 1,
            `${module.id} carries real per-instance panel dimensions instead of stretching unit-box UVs`,
          );
          group.clear();
        }
      }
    }
  } finally {
    adapter.dispose();
  }
});

test('unknown recipes and mismatched contracts are rejected without fallback', () => {
  const module = LEGACY_FIXED_ROOM_MODULE_CATALOG_V2[0];
  const contract = compileLegacyFixedRoomStructuralContractV2(module);
  const adapter = createLegacyFixedRoomRuntimeAdapterV2({ loadBrowserTextures: false });
  try {
    const wrongModule = LEGACY_FIXED_ROOM_MODULE_CATALOG_V2[1];
    assert.throws(
      () => adapter.buildModule(wrongModule, { structuralContract: contract }),
      /does not match/,
    );

    const invalidModule = cloneLegacyFixedRoomModuleV2(module.id);
    invalidModule.fixtures[0].prefabId = 'generic-room-box';
    invalidModule.fixtures[0].presentation.recipeId = 'generic-room-box';
    const invalidContract = compileLegacyFixedRoomStructuralContractV2(invalidModule);
    assert.throws(
      () => adapter.buildModule(invalidModule, { structuralContract: invalidContract }),
      /unknown V1 prefab/,
    );
  } finally {
    adapter.dispose();
  }
});
