import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LEGACY_FIXED_ROOM_MODULE_BY_ID_V2,
  LEGACY_FIXED_ROOM_MODULE_CATALOG_REVISION_V2,
  LEGACY_FIXED_ROOM_MODULE_CATALOG_V2,
  LEGACY_FIXED_ROOM_MODULE_IDS_V2,
  LEGACY_FIXED_ROOM_TILE_SIZE_V2,
  cloneLegacyFixedRoomModuleV2,
  getLegacyFixedRoomModuleV2,
  validateLegacyFixedRoomModuleCatalogV2,
} from '../../../src/dungeon-v2/LegacyFixedRoomModuleCatalogV2.js';
import { isSerializablePlanValue } from '../../../src/dungeon-v2/DungeonPlanV2Contract.js';

const EXPECTED_MODULE_IDS = [
  'v1-room.security-entrance',
  'v1-room.machine-factory',
  'v1-room.server-crypt',
  'v1-room.conveyor-gantry',
  'v1-room.credential-pyramid',
  'v1-room.parts-vault',
  'v1-room.enemy-nest',
  'v1-room.machine-core',
  'v1-room.refractor-shrine',
  'v1-room.coolant-relay',
  'v1-room.hazard-processing',
];

const EXPECTED_REGIONS = [
  'security', 'assembly', 'server', 'freight', 'sorting', 'credential', 'parts', 'nest',
  'corkscrew', 'machine-core', 'extraction', 'freight-sump', 'reservoir', 'gantry-sump',
  'salvage-tunnel', 'hazard-intake', 'hazard-core',
];

function surfaces(moduleId, predicate) {
  return getLegacyFixedRoomModuleV2(moduleId).floorTopology.walkableSurfaces.filter(predicate);
}

test('fixed-room catalog is immutable serializable data and never imports the V1 runtime or THREE', async () => {
  assert.equal(LEGACY_FIXED_ROOM_MODULE_CATALOG_REVISION_V2, 2);
  assert.equal(LEGACY_FIXED_ROOM_TILE_SIZE_V2, 2.8);
  assert.deepEqual(LEGACY_FIXED_ROOM_MODULE_IDS_V2, EXPECTED_MODULE_IDS);
  assert.equal(Object.isFrozen(LEGACY_FIXED_ROOM_MODULE_CATALOG_V2), true);
  assert.equal(Object.isFrozen(LEGACY_FIXED_ROOM_MODULE_BY_ID_V2), true);
  assert.equal(isSerializablePlanValue(LEGACY_FIXED_ROOM_MODULE_CATALOG_V2), true);
  assert.doesNotThrow(() => JSON.stringify(LEGACY_FIXED_ROOM_MODULE_CATALOG_V2));

  const source = await readFile(new URL('../../../src/dungeon-v2/LegacyFixedRoomModuleCatalogV2.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"]three(?:\/|['"])/);
  assert.doesNotMatch(source, /new THREE\./);
  assert.doesNotMatch(source, /import .*DungeonGenerator\.js/);
});

test('exactly eleven unique V1 rooms own the seventeen semantic golden regions', () => {
  assert.equal(new Set(LEGACY_FIXED_ROOM_MODULE_CATALOG_V2.map(({ sourceRoom }) => sourceRoom.id)).size, 11);
  const semanticRegions = LEGACY_FIXED_ROOM_MODULE_CATALOG_V2.flatMap((module) => (
    module.semanticRegions.map((region) => region.id)
  ));
  assert.deepEqual([...semanticRegions].sort(), [...EXPECTED_REGIONS].sort());
  assert.equal(new Set(semanticRegions).size, 17);

  assert.deepEqual(getLegacyFixedRoomModuleV2('v1-room.machine-factory').semanticRegions.map(({ id }) => id), ['assembly', 'freight']);
  assert.deepEqual(getLegacyFixedRoomModuleV2('v1-room.machine-core').semanticRegions.map(({ id }) => id), ['corkscrew', 'machine-core']);
  assert.deepEqual(getLegacyFixedRoomModuleV2('v1-room.coolant-relay').semanticRegions.map(({ id }) => id), ['freight-sump', 'reservoir', 'gantry-sump', 'salvage-tunnel']);
  assert.deepEqual(getLegacyFixedRoomModuleV2('v1-room.hazard-processing').semanticRegions.map(({ id }) => id), ['hazard-intake', 'hazard-core']);
});

test('catalog validation proves physical approaches, visible collision parity, and all extension forms', () => {
  const validation = validateLegacyFixedRoomModuleCatalogV2();
  assert.equal(validation.accepted, true, validation.errors.join('\n'));
  assert.deepEqual(validation.errors, []);
  assert.deepEqual(validation.details, {
    revision: 2,
    moduleCount: 11,
    semanticRegionCount: 17,
    surfaceCount: 3771,
    fixtureCount: 67,
    socketCount: 38,
    structuralBoundaryTemplateCount: 66,
    sourceRoomCount: 11,
    connectorForms: [
      'cargo-lift',
      'elevated-catwalk',
      'ground-bulkhead',
      'intentional-lower-zone',
      'pipe-water-breach',
      'service-ladder',
    ],
  });

  for (const module of LEGACY_FIXED_ROOM_MODULE_CATALOG_V2) {
    const surfaceIds = new Set(module.floorTopology.walkableSurfaces.map(({ id }) => id));
    assert.deepEqual(
      module.structuralBoundaries.map(({ side }) => side).sort(),
      ['ceiling', 'east', 'floor', 'north', 'south', 'west'],
      `${module.id} owns all six shell faces`,
    );
    assert.ok(module.structuralBoundaries.every(({ opaque, collider }) => opaque && collider));
    const boundarySocketIds = module.structuralBoundaries.flatMap(({ candidateSocketIds }) => candidateSocketIds);
    assert.deepEqual(
      [...boundarySocketIds].sort(),
      module.extensionSockets.map(({ id }) => id).sort(),
      `${module.id} assigns every extension aperture to one closed-shell face`,
    );
    for (const socket of module.extensionSockets) {
      assert.ok(socket.approachSurfaceIds.length >= 2, `${socket.id} has a real approach`);
      assert.ok(socket.approachSurfaceIds.every((id) => surfaceIds.has(id)), `${socket.id} approach is plan-owned`);
      assert.ok(socket.aperture.surfaceIds.every((id) => surfaceIds.has(id)), `${socket.id} aperture is plan-owned`);
      assert.ok(socket.approachSurfaceIds.every((id) => !socket.aperture.surfaceIds.includes(id)), `${socket.id} never removes its own approach`);
      assert.equal(socket.unusedSocketCapRequired, true);
    }
    for (const fixture of module.fixtures) {
      if (fixture.collision.runtimeColliderRequired) {
        assert.ok(fixture.presentation.recipeId, `${fixture.id} cannot create collision belonging to no visible object`);
      }
      if (fixture.collision.mode === 'compound-blocking') {
        assert.ok(fixture.collision.parts.length >= 1, `${fixture.id} blocks only visible parts`);
        if (/(?:arch|girder|press)/.test(fixture.kind)) {
          assert.equal(fixture.collision.parts.length, 2, `${fixture.id} has two visible supports`);
        }
      }
    }
  }
});

test('V1 pyramid, machine, server, conveyor, coolant, hazard, and shrine floor topology is concrete', () => {
  const pyramid = getLegacyFixedRoomModuleV2('v1-room.credential-pyramid');
  const pyramidTiles = pyramid.floorTopology.walkableSurfaces.filter(({ sourceSurface }) => sourceSurface.startsWith('mechanicalPyramid'));
  assert.equal(pyramidTiles.length, 291, '17x17 terraces plus two perimeter side-route tiles remain concrete');
  assert.equal(surfaces(pyramid.id, ({ sourceSurface }) => sourceSurface === 'mechanicalPyramidSummit').length, 9);
  assert.deepEqual(
    [...new Set(pyramidTiles.map(({ topY }) => topY))].sort((a, b) => a - b),
    [0.5, 1, 1.35, 1.5, 2, 2.5, 2.7, 3, 3.5, 4, 4.05],
  );

  const server = getLegacyFixedRoomModuleV2('v1-room.server-crypt');
  assert.equal(server.fixtures.filter(({ kind }) => kind === 'alien-server-monolith').length, 16, 'V1 4x4 server aisle is retained');
  assert.equal(surfaces(server.id, ({ sourceSurface }) => sourceSurface === 'serverUpperCatwalk').length, 31,
    'the V1 inspection run includes the full supported outer-ramp top landing');
  assert.ok(surfaces(server.id, ({ shape }) => shape === 'ramp-tile').length >= 9);

  const machine = getLegacyFixedRoomModuleV2('v1-room.machine-factory');
  assert.equal(surfaces(machine.id, ({ sourceSurface }) => sourceSurface === 'machineSideConveyor').length, 18);
  assert.equal(surfaces(machine.id, ({ sourceSurface }) => sourceSurface === 'machineUpperCatwalk').length, 62,
    'seven upper-catwalk tiles that physically covered the west ramp are intentionally absent');
  assert.equal(surfaces(machine.id, ({ sourceSurface }) => sourceSurface === 'machineCrossBridge').length, 16,
    'the cross-bridge tile directly over the west ramp is intentionally absent');
  assert.deepEqual(
    surfaces(machine.id, ({ sourceSurface }) => sourceSurface === 'machineCrossBridge').map(({ localTile }) => localTile.x),
    Array.from({ length: 16 }, (_, index) => index - 7),
    'the cross bridge begins beside the cleared incline and remains continuous to the east catwalk',
  );

  const conveyor = getLegacyFixedRoomModuleV2('v1-room.conveyor-gantry');
  assert.equal(surfaces(conveyor.id, ({ sourceSurface }) => sourceSurface === 'conveyorPuzzleBelt').length, 19, 'V1 TwoRouteJunction belt graph is retained');
  assert.equal(surfaces(conveyor.id, ({ sourceSurface }) => sourceSurface === 'thirdFloorGantry').length, 18);

  const coolant = getLegacyFixedRoomModuleV2('v1-room.coolant-relay');
  assert.equal(surfaces(coolant.id, ({ sourceSurface }) => sourceSurface === 'coolantServicePit').length, 25);
  assert.equal(surfaces(coolant.id, ({ sourceSurface }) => sourceSurface === 'coolantControlBalcony').length, 18);

  const hazard = getLegacyFixedRoomModuleV2('v1-room.hazard-processing');
  const lowerHazardSurfaces = surfaces(hazard.id, ({ sourceSurface }) => [
    'undercroftHazardFloor',
    'undercroftPipeGallery',
    'undercroftSalvageBranch',
  ].includes(sourceSurface));
  assert.ok(lowerHazardSurfaces.length >= 90, 'purpose-built lower cavern remains a sprawling playable destination');
  for (const sourceSurface of ['undercroftHazardFloor', 'undercroftPipeGallery', 'undercroftSalvageBranch']) {
    assert.ok(lowerHazardSurfaces.some((surface) => surface.sourceSurface === sourceSurface), `${sourceSurface} is physically represented`);
  }
  const hazardReturnStairs = surfaces(hazard.id, ({ tags = [] }) => tags.includes('walkable-stairs-no-ledge-climb'));
  assert.equal(hazardReturnStairs.length, 15, 'the lower sub-zone has a long continuous walking return');
  assert.equal(hazardReturnStairs[0].ramp.startY, -4.8);
  assert.equal(hazardReturnStairs.at(-1).ramp.endY, 0);
  assert.ok(hazardReturnStairs.every(({ collision }) => collision.ordinaryStairs && collision.ledgeClimbDisabled));
  assert.equal(surfaces(hazard.id, ({ sourceSurface }) => /basement(?:Floor|ReturnShelf)/.test(sourceSurface)).length, 0);
  assert.equal(surfaces(hazard.id, ({ tags = [] }) => tags.some((tag) => /required-action:ledge-climb/.test(tag))).length, 0);
  assert.equal(hazard.landmarkAnchors.some(({ id }) => /rearm/i.test(id)), false);

  const shrine = getLegacyFixedRoomModuleV2('v1-room.refractor-shrine');
  assert.equal(surfaces(shrine.id, ({ sourceSurface }) => sourceSurface === 'refractorDais').length, 25);
  assert.ok(surfaces(shrine.id, ({ sourceSurface }) => sourceSurface === 'reveredMezzanine').length >= 80);
  assert.ok(surfaces(shrine.id, ({ shape }) => shape === 'ramp-tile').length >= 35);
});

test('every authored ramp route is edge-continuous and flush with both endpoint decks', () => {
  let routeCount = 0;
  for (const module of LEGACY_FIXED_ROOM_MODULE_CATALOG_V2) {
    const routeIds = new Set(module.floorTopology.walkableSurfaces
      .map(({ traversalRoute }) => traversalRoute?.routeId)
      .filter(Boolean));
    for (const routeId of routeIds) {
      routeCount += 1;
      const route = module.floorTopology.walkableSurfaces
        .filter((surface) => surface.traversalRoute?.routeId === routeId)
        .sort((left, right) => left.traversalRoute.sequenceIndex - right.traversalRoute.sequenceIndex);
      assert.ok(route.length >= 2, `${routeId} has a physical run`);
      const declaredSurfaceCount = route[0].traversalRoute.surfaceCount;
      const sequenceIndices = route.map(({ traversalRoute }) => traversalRoute.sequenceIndex);
      assert.ok(route.every(({ traversalRoute }) => traversalRoute.surfaceCount === declaredSurfaceCount));
      for (let index = 1; index < sequenceIndices.length; index += 1) {
        assert.equal(sequenceIndices[index] - sequenceIndices[index - 1], 1, `${routeId} has no missing interior route step`);
      }

      let maximumSharedEdgeDelta = 0;
      for (let index = 0; index < route.length - 1; index += 1) {
        const current = route[index];
        const next = route[index + 1];
        const tileDistance = Math.abs(current.localTile.x - next.localTile.x)
          + Math.abs(current.localTile.z - next.localTile.z);
        assert.equal(tileDistance, 1, `${routeId} has no missing tile between ${current.id} and ${next.id}`);
        const currentEdgeY = current.ramp?.endY ?? current.topY;
        const nextEdgeY = next.ramp?.startY ?? next.topY;
        const sharedEdgeDelta = Math.abs(currentEdgeY - nextEdgeY);
        maximumSharedEdgeDelta = Math.max(maximumSharedEdgeDelta, sharedEdgeDelta);
        assert.ok(
          sharedEdgeDelta <= 0.18 + 1e-6,
          `${routeId} shared edge ${index} is ${sharedEdgeDelta.toFixed(4)}m rather than an ordinary walkable stair seam`,
        );
      }

      const assertEndpointSeam = (surface, role) => {
        const atStart = role === 'start';
        const routeIndex = surface.traversalRoute.sequenceIndex;
        const isDeclaredEndpoint = atStart ? routeIndex === 0 : routeIndex === declaredSurfaceCount - 1;
        const edgeY = atStart ? (surface.ramp?.startY ?? surface.topY) : (surface.ramp?.endY ?? surface.topY);
        if (isDeclaredEndpoint) {
          assert.ok(Math.abs(edgeY - surface.topY) <= 0.0001, `${routeId} ${role} endpoint is exactly flush`);
          return;
        }
        assert.ok(surface.ramp?.direction, `${routeId} ${role} endpoint can locate its adjoining authored deck`);
        const directionSign = atStart ? -1 : 1;
        const endpointTile = {
          x: surface.localTile.x + surface.ramp.direction.x * directionSign,
          z: surface.localTile.z + surface.ramp.direction.z * directionSign,
        };
        const adjoiningDecks = module.floorTopology.walkableSurfaces.filter((candidate) => (
          candidate.id !== surface.id
          && candidate.localTile.x === endpointTile.x
          && candidate.localTile.z === endpointTile.z
        ));
        assert.ok(adjoiningDecks.length > 0, `${routeId} ${role} endpoint reaches a real authored deck`);
        const endpointDelta = Math.min(...adjoiningDecks.map(({ topY }) => Math.abs(topY - edgeY)));
        maximumSharedEdgeDelta = Math.max(maximumSharedEdgeDelta, endpointDelta);
        assert.ok(endpointDelta <= 0.18 + 1e-6, `${routeId} ${role} deck seam is ${endpointDelta.toFixed(4)}m`);
      };
      assertEndpointSeam(route[0], 'start');
      assertEndpointSeam(route.at(-1), 'end');
      assert.ok(Number.isFinite(maximumSharedEdgeDelta));
    }
  }
  assert.ok(routeCount >= 8, 'the assertion covers every V1-derived and V2 lower-return ramp route');
});

test('source references point to the exact unchanged V1 room implementation areas', async () => {
  const source = await readFile(new URL('../../../src/DungeonGenerator.js', import.meta.url), 'utf8');
  const sourceLines = source.split(/\r?\n/);
  const requiredSymbols = new Set([
    '_generateOnce',
    '_assignRoomArchetypes',
    '_markRoomCatwalks',
    '_createFactoryLevelTiles',
    '_getCoolantFixtureSpecs',
    '_createSolidCollisionZones',
    '_addIndustrialRoomSetpieces',
    '_addVolumetricIndustrialPrefabs',
    '_addRoomLandmarks',
    'addMinorDropSpace',
    'createMechanicalPyramid',
  ]);

  const referencedSymbols = new Set();
  for (const module of LEGACY_FIXED_ROOM_MODULE_CATALOG_V2) {
    assert.ok(module.sourceReferences.length >= 7);
    for (const reference of module.sourceReferences) {
      assert.equal(reference.file, 'src/DungeonGenerator.js');
      assert.ok(reference.startLine >= 1 && reference.endLine <= sourceLines.length);
      const baseSymbol = reference.symbol.split('.')[0];
      referencedSymbols.add(baseSymbol);
      assert.match(source, new RegExp(baseSymbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  }
  for (const symbol of requiredSymbols) {
    assert.ok(referencedSymbols.has(symbol), `catalog cites ${symbol}`);
  }
});

test('getters preserve immutable catalog identity while clones are safe mutable plan data', () => {
  const descriptor = getLegacyFixedRoomModuleV2('v1-room.server-crypt');
  assert.strictEqual(descriptor, LEGACY_FIXED_ROOM_MODULE_BY_ID_V2['v1-room.server-crypt']);
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(Object.isFrozen(descriptor.floorTopology.walkableSurfaces), true);
  assert.equal(getLegacyFixedRoomModuleV2('not-a-room'), null);

  const clone = cloneLegacyFixedRoomModuleV2('v1-room.server-crypt');
  assert.notStrictEqual(clone, descriptor);
  clone.displayName = 'Mutable clone';
  clone.floorTopology.walkableSurfaces[0].topY = 99;
  assert.notEqual(descriptor.displayName, clone.displayName);
  assert.notEqual(descriptor.floorTopology.walkableSurfaces[0].topY, 99);
  assert.equal(cloneLegacyFixedRoomModuleV2('not-a-room'), null);
});
