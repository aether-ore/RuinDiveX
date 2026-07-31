import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DUNGEON_AUGMENTATION_PROFILES,
  GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
  INDUSTRIAL_SUPPLEMENT_BLUEPRINT_GRAMMAR_POOL,
  INDUSTRIAL_SUPPLEMENT_BLUEPRINT_GRAMMARS,
} from '../src/dungeon-augmentation/catalog.js';
import {
  INDUSTRIAL_SUPPLEMENT_BLUEPRINT_IDS,
  INDUSTRIAL_SUPPLEMENT_BLUEPRINTS,
} from '../src/dungeon-augmentation/IndustrialSupplementBlueprintCatalog.js';
import { orientBlueprintTransferChoice } from '../src/dungeon-augmentation/IndustrialOverlayMaterializer.js';

const V4_PROFILE_ID = 'industrial-supplement-preview-v4';

function realizedTierCells(blueprint) {
  return blueprint.floorTiers.map((tier) => ({
    localElevation: tier.elevation,
    worldCells: tier.floorMask.flatMap((row, rowIndex) => [...row].flatMap((symbol, columnIndex) => (
      symbol === '#'
        ? [{
            id: `${tier.id}:${columnIndex}:${rowIndex}`,
            localTile: {
              x: tier.maskOriginTile.x + columnIndex,
              z: tier.maskOriginTile.z + rowIndex,
            },
          }]
        : []
    ))),
  }));
}

test('treatment-control ramp rises toward its authored upper ledge', () => {
  const blueprint = INDUSTRIAL_SUPPLEMENT_BLUEPRINTS['ind-room-treatment-control-01'];
  const transfer = blueprint.physicalTransfers.find(({ id }) => id === 'tc-ramp');
  const halfDepth = (transfer.depthTiles - 1) * 0.5;
  const orientation = orientBlueprintTransferChoice({
    choice: {
      axis: 'z',
      first: { x: transfer.footprintTiles.x, z: transfer.footprintTiles.z - halfDepth },
      second: { x: transfer.footprintTiles.x, z: transfer.footprintTiles.z + halfDepth },
      span: transfer.depthTiles,
    },
    previousPoint: { x: 0, z: 5 },
    floorTiers: realizedTierCells(blueprint),
    fromElevation: 0,
    toElevation: 2.8,
  });

  assert.equal(orientation.orientationSource, 'floor-tier-alignment');
  assert.equal(orientation.reversed, false);
  assert.deepEqual(orientation.from, { x: 4, z: -3 });
  assert.deepEqual(orientation.to, { x: 4, z: 3 });
});

const LEGACY_GRAMMAR_POOLS = Object.freeze({
  'industrial-supplement-preview-v1': Object.freeze([
    Object.freeze({ id: 'supplement-chamber-compact-v1', weight: 4 }),
    Object.freeze({ id: 'supplement-gallery-bay-v1', weight: 3 }),
    Object.freeze({ id: 'supplement-junction-v1', weight: 1 }),
  ]),
  'industrial-supplement-preview-v2': Object.freeze([
    Object.freeze({ id: 'supplement-chamber-compact-v1', weight: 4 }),
    Object.freeze({ id: 'supplement-gallery-bay-v1', weight: 3 }),
    Object.freeze({ id: 'supplement-junction-v1', weight: 1 }),
  ]),
  'industrial-supplement-preview-v3': Object.freeze([
    Object.freeze({ id: 'supplement-hall-cluster-junction-v1', weight: 1 }),
    Object.freeze({ id: 'supplement-hall-cluster-encounter-v1', weight: 1 }),
    Object.freeze({ id: 'supplement-hall-cluster-reward-v1', weight: 1 }),
    Object.freeze({ id: 'supplement-hall-cluster-terminal-v1', weight: 1 }),
  ]),
});

const LEGACY_PADDING_GRAMMAR_POOLS = Object.freeze({
  'industrial-supplement-preview-v1': null,
  'industrial-supplement-preview-v2': null,
  'industrial-supplement-preview-v3': Object.freeze([
    Object.freeze({ id: 'supplement-padding-through-chamber-v1', weight: 1 }),
  ]),
});

const CONNECTOR_BLUEPRINT_IDS = Object.freeze([
  'ind-junction-through-t-01',
  'ind-junction-crossroads-01',
  'ind-junction-staggered-cross-01',
  'ind-interchange-stacked-01',
  'ind-crossover-over-under-01',
  'ind-junction-through-t-branch-entry-01',
]);

function blueprintGrammar(blueprintId) {
  return Object.values(INDUSTRIAL_SUPPLEMENT_BLUEPRINT_GRAMMARS)
    .find(grammar => grammar.blueprintId === blueprintId);
}

function assertNear(actual, expected, message) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= 1e-9, message);
}

function expectedSocketPosition(blueprint, socket) {
  const halfWidth = (blueprint.widthTiles - 1) * blueprint.floorCellMeters * 0.5;
  const halfDepth = (blueprint.depthTiles - 1) * blueprint.floorCellMeters * 0.5;
  const transverse = socket.center * blueprint.floorCellMeters;
  let point;
  if (socket.side === 'N') point = { x: transverse, y: socket.y, z: -halfDepth };
  else if (socket.side === 'S') point = { x: transverse, y: socket.y, z: halfDepth };
  else if (socket.side === 'W') point = { x: -halfWidth, y: socket.y, z: transverse };
  else point = { x: halfWidth, y: socket.y, z: transverse };
  return rotateQuarterTurns(point, canonicalRotationQuarterTurns(blueprint));
}

function expectedSocketFacing(side) {
  if (side === 'N') return { x: 0, y: 0, z: -1 };
  if (side === 'S') return { x: 0, y: 0, z: 1 };
  if (side === 'W') return { x: -1, y: 0, z: 0 };
  return { x: 1, y: 0, z: 0 };
}

function canonicalRotationQuarterTurns(blueprint) {
  const entry = blueprint.sockets.find(({ role }) => String(role).includes('entry'))
    ?? blueprint.sockets[0];
  return { N: 0, E: 1, S: 2, W: 3 }[entry.side] ?? 0;
}

function rotateQuarterTurns(point, quarterTurns) {
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 1) return { ...point, x: point.z, z: -point.x };
  if (turns === 2) return { ...point, x: -point.x, z: -point.z };
  if (turns === 3) return { ...point, x: -point.z, z: point.x };
  return { ...point };
}

test('the V4 grammar pool contains exactly every authored blueprint', () => {
  const profile = DUNGEON_AUGMENTATION_PROFILES[V4_PROFILE_ID];
  assert.equal(profile.revision, 5);
  assert.deepEqual(profile.grammarPool, INDUSTRIAL_SUPPLEMENT_BLUEPRINT_GRAMMAR_POOL);
  assert.equal(profile.grammarPool.length, INDUSTRIAL_SUPPLEMENT_BLUEPRINT_IDS.length);
  assert.equal(
    new Set(profile.grammarPool.map(({ id }) => id)).size,
    INDUSTRIAL_SUPPLEMENT_BLUEPRINT_IDS.length,
  );

  const pooledGrammars = profile.grammarPool.map(({ id }) => (
    GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS[id]
  ));
  assert.equal(pooledGrammars.every(Boolean), true);
  assert.deepEqual(
    pooledGrammars.map(({ blueprintId }) => blueprintId).sort(),
    [...INDUSTRIAL_SUPPLEMENT_BLUEPRINT_IDS].sort(),
  );
  for (const grammar of pooledGrammars) {
    assert.equal(INDUSTRIAL_SUPPLEMENT_BLUEPRINT_GRAMMARS[grammar.id], grammar);
  }
});

test('blueprint grammars preserve exact masks, tiers, sockets, routes, and transfers', () => {
  for (const blueprintId of INDUSTRIAL_SUPPLEMENT_BLUEPRINT_IDS) {
    const blueprint = INDUSTRIAL_SUPPLEMENT_BLUEPRINTS[blueprintId];
    const grammar = blueprintGrammar(blueprintId);
    assert.ok(grammar, `${blueprintId} grammar`);
    assert.equal(grammar.structure.blueprintId, blueprintId);
    assert.equal(grammar.selectionConstraints.blueprintId, blueprintId);
    const swapsAxes = canonicalRotationQuarterTurns(blueprint) % 2 === 1;
    assert.equal(grammar.size.width, swapsAxes ? blueprint.depthMeters : blueprint.widthMeters);
    assert.equal(grammar.size.depth, swapsAxes ? blueprint.widthMeters : blueprint.depthMeters);

    assert.equal(grammar.structure.floors.length, blueprint.floorTiers.length);
    for (const tier of blueprint.floorTiers) {
      const grammarTier = grammar.structure.floors.find(({ id }) => id === tier.id);
      assert.ok(grammarTier, `${blueprintId}/${tier.id} tier`);
      assert.equal(grammarTier.elevation, tier.elevation);
      assert.deepEqual(grammarTier.floorMask, tier.floorMask);
      assert.deepEqual(grammarTier.maskOriginTile, tier.maskOriginTile);
    }
    assert.deepEqual(grammar.structure.routes, blueprint.routes);
    assert.deepEqual(grammar.structure.zones, blueprint.zones);
    assert.deepEqual(grammar.structure.features, blueprint.features);
    assert.deepEqual(grammar.structure.voids, blueprint.voids);
    assert.deepEqual(grammar.structure.physicalTransfers, blueprint.physicalTransfers);
    assert.deepEqual(grammar.structure.elevationTransfers, blueprint.physicalTransfers);

    assert.equal(grammar.sockets.length, blueprint.sockets.length);
    for (const sourceSocket of blueprint.sockets) {
      const grammarSocket = grammar.sockets.find(({ blueprintSocketId }) => (
        blueprintSocketId === sourceSocket.id
      ));
      assert.ok(grammarSocket, `${blueprintId}/${sourceSocket.id} socket`);
      const expectedPosition = expectedSocketPosition(blueprint, sourceSocket);
      assertNear(grammarSocket.localPosition.x, expectedPosition.x, `${sourceSocket.id} x`);
      assertNear(grammarSocket.localPosition.y, expectedPosition.y, `${sourceSocket.id} y`);
      assertNear(grammarSocket.localPosition.z, expectedPosition.z, `${sourceSocket.id} z`);
      assert.deepEqual(
        grammarSocket.localFacing,
        rotateQuarterTurns(
          expectedSocketFacing(sourceSocket.side),
          canonicalRotationQuarterTurns(blueprint),
        ),
      );
      assert.equal(grammarSocket.widthMeters, 8.4);
      assert.ok(grammarSocket.connectivityGroupId);
    }
    assert.deepEqual(
      grammar.selectionConstraints.authoredTransferKinds,
      [...new Set(blueprint.physicalTransfers.map(({ form }) => String(form)))],
    );
  }
});

test('V1 through V3 retain their legacy non-blueprint grammar pools', () => {
  for (const [profileId, expectedPool] of Object.entries(LEGACY_GRAMMAR_POOLS)) {
    const profile = DUNGEON_AUGMENTATION_PROFILES[profileId];
    assert.deepEqual(profile.grammarPool, expectedPool, profileId);
    assert.deepEqual(
      profile.paddingGrammarPool ?? null,
      LEGACY_PADDING_GRAMMAR_POOLS[profileId],
      `${profileId} padding pool`,
    );
    const replayPool = [...profile.grammarPool, ...(profile.paddingGrammarPool ?? [])];
    for (const { id } of replayPool) {
      const grammar = GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS[id];
      assert.ok(grammar, `${profileId}/${id}`);
      assert.equal('blueprintId' in grammar, false);
      assert.equal('blueprintId' in grammar.structure, false);
      assert.equal('blueprintId' in grammar.selectionConstraints, false);
    }
  }
});

test('only compact junction infrastructure is connector-owned', () => {
  const connectorIds = [];
  const substantiveIds = [];
  for (const blueprintId of INDUSTRIAL_SUPPLEMENT_BLUEPRINT_IDS) {
    const grammar = blueprintGrammar(blueprintId);
    const constraints = grammar.selectionConstraints;
    if (constraints.routeNetworkModuleKind === 'connector-module') {
      connectorIds.push(blueprintId);
      assert.equal(constraints.connectorOwned, true);
      assert.equal(constraints.substantiveRoom, false);
      assert.equal(constraints.meaningfulStation, false);
      assert.equal(grammar.structure.ownership, 'connector');
    } else {
      substantiveIds.push(blueprintId);
      assert.equal(constraints.routeNetworkModuleKind, 'room');
      assert.equal(constraints.connectorOwned, false);
      assert.equal(constraints.substantiveRoom, true);
      assert.equal(constraints.meaningfulStation, true);
      assert.equal(grammar.structure.ownership, 'room');
    }
  }
  assert.deepEqual(connectorIds.sort(), [...CONNECTOR_BLUEPRINT_IDS].sort());
  assert.equal(
    substantiveIds.length,
    INDUSTRIAL_SUPPLEMENT_BLUEPRINT_IDS.length - CONNECTOR_BLUEPRINT_IDS.length,
  );
  assert.ok(substantiveIds.includes('ind-loop-paired-t-h-01'));
  assert.ok(substantiveIds.includes('ind-rise-long-freight-ramp-01'));
});

test('over-under routes stay disjoint while stacked routes have one transfer link', () => {
  const overUnder = blueprintGrammar('ind-crossover-over-under-01');
  const overGroups = overUnder.structure.socketConnectivityGroups;
  assert.deepEqual(overGroups, [
    { id: 'lower-route', localSocketIds: ['entry', 'exit'] },
    { id: 'upper-route', localSocketIds: ['left', 'right'] },
  ]);
  assert.deepEqual(overUnder.socketConnectivityGroups, overGroups);
  assert.deepEqual(overUnder.structure.socketConnectivityLinks, []);
  assert.deepEqual(overUnder.structure.physicalTransfers, []);
  assert.equal(
    overGroups[0].localSocketIds.some(id => overGroups[1].localSocketIds.includes(id)),
    false,
  );

  const stacked = blueprintGrammar('ind-interchange-stacked-01');
  const stackedGroups = stacked.structure.socketConnectivityGroups;
  assert.deepEqual(stackedGroups, [
    { id: 'lower-route', localSocketIds: ['entry', 'exit'] },
    { id: 'upper-route', localSocketIds: ['left', 'right'] },
  ]);
  assert.deepEqual(stacked.socketConnectivityGroups, stackedGroups);
  assert.deepEqual(stacked.structure.socketConnectivityLinks, [{
    id: 'stacked-lift-link',
    fromGroupId: 'lower-route',
    toGroupId: 'upper-route',
  }]);
  assert.equal(stacked.structure.physicalTransfers.length, 1);
  assert.equal(stacked.structure.physicalTransfers[0].form, 'lift');
});
