import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  INDUSTRIAL_SUPPLEMENT_BLUEPRINT_IDS,
  INDUSTRIAL_SUPPLEMENT_BLUEPRINT_LIST,
  INDUSTRIAL_SUPPLEMENT_BLUEPRINT_SCHEMA,
  INDUSTRIAL_SUPPLEMENT_BLUEPRINTS,
  resolveIndustrialSupplementBlueprint,
} from '../src/dungeon-augmentation/IndustrialSupplementBlueprintCatalog.js';

const EXPECTED_BLUEPRINT_IDS = [
  'ind-junction-through-t-01',
  'ind-junction-through-t-branch-entry-01',
  'ind-junction-crossroads-01',
  'ind-junction-staggered-cross-01',
  'ind-loop-paired-t-h-01',
  'ind-interchange-stacked-01',
  'ind-crossover-over-under-01',
  'ind-room-reaverbot-foundry-01',
  'ind-room-treatment-control-01',
  'ind-room-ladder-defense-rise-01',
  'ind-room-lift-defense-rise-01',
  'ind-room-compact-ramp-defense-rise-01',
  'ind-room-maintenance-rise-01',
  'ind-room-dispatch-vault-01',
  'ind-room-observation-break-01',
  'ind-rise-switchback-ramp-01',
  'ind-rise-stair-cascade-01',
  'ind-rise-freight-lift-dogleg-01',
  'ind-rise-ladder-bridge-01',
  'ind-room-turbine-helix-01',
  'ind-room-floodgate-descent-01',
  'ind-room-crane-gantry-lift-01',
  'ind-room-pressure-lock-reward-rise-01',
  'ind-room-pressure-lock-reward-descent-01',
  'ind-room-switchgear-cache-descent-01',
  'ind-room-survey-relay-cache-01',
  'ind-rise-long-freight-ramp-01',
  'ind-room-inclined-sorter-01',
];

const EXIT_ELEVATION_BLUEPRINT_IDS = [
  'ind-room-ladder-defense-rise-01',
  'ind-room-lift-defense-rise-01',
  'ind-room-compact-ramp-defense-rise-01',
  'ind-room-maintenance-rise-01',
  'ind-rise-switchback-ramp-01',
  'ind-rise-stair-cascade-01',
  'ind-rise-freight-lift-dogleg-01',
  'ind-rise-ladder-bridge-01',
  'ind-room-turbine-helix-01',
  'ind-room-floodgate-descent-01',
  'ind-room-crane-gantry-lift-01',
  'ind-room-pressure-lock-reward-rise-01',
  'ind-room-pressure-lock-reward-descent-01',
  'ind-room-switchgear-cache-descent-01',
  'ind-rise-long-freight-ramp-01',
  'ind-room-inclined-sorter-01',
];

const EXPECTED_LAYOUTS = {
  'ind-junction-through-t-01': {
    width: 5,
    depth: 7,
    maskSha256: 'ce64ad73d1df8acb65947158eaab6c2203582e33699bbb9ad51f4b47fed94abe',
  },
  'ind-junction-through-t-branch-entry-01': {
    width: 5,
    depth: 7,
    maskSha256: 'ce64ad73d1df8acb65947158eaab6c2203582e33699bbb9ad51f4b47fed94abe',
  },
  'ind-junction-crossroads-01': {
    width: 7,
    depth: 7,
    maskSha256: 'ff58ddc7a12fdea490e9b46fc3f9d0c54cdcca006d58897e3395e396215a5145',
  },
  'ind-junction-staggered-cross-01': {
    width: 5,
    depth: 13,
    maskSha256: 'bd044e5e7b15448df2a6bf9e5dcd10397d4c8611af786123d9e72cc0fc0a2498',
  },
  'ind-loop-paired-t-h-01': {
    width: 15,
    depth: 11,
    maskSha256: '9d4085c02af890ed0047d716653246456f9c9dd8ccbdccb5695c1c1009dc5167',
  },
  'ind-interchange-stacked-01': {
    width: 9,
    depth: 13,
    maskSha256: 'ec064d0c22384d9bdf5ce28b3fab7725449b2ae8ffa6f848ebd0f7e83905382a',
  },
  'ind-crossover-over-under-01': {
    width: 7,
    depth: 7,
    maskSha256: '47d577d2c50e83fcdebf1a2d0ecb9c395cf5ef0c5ee2e04de78410f91f379a3e',
  },
  'ind-room-reaverbot-foundry-01': {
    width: 11,
    depth: 11,
    maskSha256: 'da726ba126ffdfd0c31b0ae4f34163731b40293b676c106833e1ee4445a5c4bb',
  },
  'ind-room-treatment-control-01': {
    width: 11,
    depth: 11,
    maskSha256: 'f61cd76f742611a30dfebd326d8a8f5e18d9bb9f9c12534ebfb4ebcc032596fd',
  },
  'ind-room-ladder-defense-rise-01': {
    width: 9,
    depth: 11,
    maskSha256: '8765e01234537557fe38bb1a5b3627f4a98eea994ee2e9418ecb9e120870abd9',
  },
  'ind-room-lift-defense-rise-01': {
    width: 9,
    depth: 11,
    maskSha256: 'e1eb711f2538dc5482a1538db5dc92f5ca539084eb944e7ccf54bb7966ca036c',
  },
  'ind-room-compact-ramp-defense-rise-01': {
    width: 7,
    depth: 11,
    maskSha256: 'b00e29aa560485242a8b82aef82706883aafcbf4ea2edf92d59d65e27d8e82e5',
  },
  'ind-room-maintenance-rise-01': {
    width: 9,
    depth: 11,
    maskSha256: '20aaaa12bdb3ea4b5d47dcfbbbcd23f5d35a73d293f6469e3a8ba5a0159b1133',
  },
  'ind-room-dispatch-vault-01': {
    width: 9,
    depth: 9,
    maskSha256: '5eef08045826ba8368bb64ec77ed965f91e94bf8298ecf019aa67a02d5f40034',
  },
  'ind-room-observation-break-01': {
    width: 9,
    depth: 9,
    maskSha256: '62bf4458990fc2fed0f5eb2172b4420596e9a2da92b347678e7820dd535aecc2',
  },
  'ind-rise-switchback-ramp-01': {
    width: 9,
    depth: 13,
    maskSha256: '1cdf5e594389f9c05bdb36459e2795fb6486c70c839dcfdf4500f3786801b8d7',
  },
  'ind-rise-stair-cascade-01': {
    width: 13,
    depth: 7,
    maskSha256: '50d148e33962f4154be58ba3382f0800115ef33757bd118e2e9e73928655d706',
  },
  'ind-rise-freight-lift-dogleg-01': {
    width: 9,
    depth: 11,
    maskSha256: '7ea44fd14c4076fdabf317cb80f494f69ee1fd103cd96790490d8f74da6fae71',
  },
  'ind-rise-ladder-bridge-01': {
    width: 9,
    depth: 9,
    maskSha256: '2efe505c7f89ba3375d7770e9b1efec231ebfc996f567b2950c3513f1b9340d4',
  },
  'ind-room-turbine-helix-01': {
    width: 13,
    depth: 13,
    maskSha256: 'da759d4263184a5278dbc491934021982b444cb070c4653c9844cdc32ead383b',
  },
  'ind-room-floodgate-descent-01': {
    width: 11,
    depth: 11,
    maskSha256: '31c316a4a1e9b67887f022b7180421f9863d0767df6679ede514798751b497a9',
  },
  'ind-room-crane-gantry-lift-01': {
    width: 13,
    depth: 11,
    maskSha256: '82f29ca86917e962619c21940eeaec1b121db42a8820efcd003e5e57db18dee2',
  },
  'ind-room-pressure-lock-reward-rise-01': {
    width: 9,
    depth: 11,
    maskSha256: 'd6753093d9b15ef1803c5e4d2fe9411ad7d8b06f3f144c206829eda88f96267d',
  },
  'ind-room-pressure-lock-reward-descent-01': {
    width: 9,
    depth: 11,
    maskSha256: 'f282d61d2d70e50f42b22e008bf7ea17f91dc6ed9cafcec7d5287261acb78393',
  },
  'ind-room-switchgear-cache-descent-01': {
    width: 7,
    depth: 7,
    maskSha256: '1578ac640a1504e18acc405cd20a60c3941e53d75e6744d9549489efa6eec388',
  },
  'ind-room-survey-relay-cache-01': {
    width: 7,
    depth: 7,
    maskSha256: '144e870d9df857bbc8dd97f8f5cb67a3e00c6465b1c6ae11f462e5352a29edc5',
  },
  'ind-rise-long-freight-ramp-01': {
    width: 7,
    depth: 15,
    maskSha256: '84b92534f922d2896f5de72b260784da6eb2670307ea9fa63723632695e5a254',
  },
  'ind-room-inclined-sorter-01': {
    width: 9,
    depth: 15,
    maskSha256: 'd8dc60d27439518a842ce6a3dc77d25c3d0f896f72532cfc0fb32069c707b652',
  },
};

const EXPECTED_EXIT_ELEVATIONS = {
  'ind-room-ladder-defense-rise-01': {
    entry: 0,
    reconnect: 2.8,
    transferForms: ['ladder'],
  },
  'ind-room-lift-defense-rise-01': {
    entry: 0,
    reconnect: 2.8,
    transferForms: ['lift'],
  },
  'ind-room-compact-ramp-defense-rise-01': {
    entry: 0,
    reconnect: 2.8,
    transferForms: ['ramp'],
  },
  'ind-room-maintenance-rise-01': {
    entry: 0,
    reconnect: 2.8,
    transferForms: ['ramp', 'lift'],
  },
  'ind-rise-switchback-ramp-01': {
    entry: 0,
    reconnect: 2.8,
    transferForms: ['ramp', 'landing', 'ramp'],
  },
  'ind-rise-stair-cascade-01': {
    entry: 0,
    reconnect: 5.6,
    transferForms: ['stairs', 'landing', 'stairs'],
  },
  'ind-rise-freight-lift-dogleg-01': {
    entry: 0,
    reconnect: 5.6,
    transferForms: ['lift'],
  },
  'ind-rise-ladder-bridge-01': {
    entry: 0,
    reconnect: 2.8,
    transferForms: ['ladder'],
  },
  'ind-room-turbine-helix-01': {
    entry: 0,
    reconnect: 2.8,
    transferForms: ['ramp', 'landing', 'ramp'],
  },
  'ind-room-floodgate-descent-01': {
    entry: 2.8,
    reconnect: 0,
    transferForms: ['stairs'],
  },
  'ind-room-crane-gantry-lift-01': {
    entry: 0,
    reconnect: 5.6,
    transferForms: ['lift'],
  },
  'ind-room-pressure-lock-reward-rise-01': {
    entry: 0,
    reconnect: 2.8,
    transferForms: ['stairs'],
  },
  'ind-room-pressure-lock-reward-descent-01': {
    entry: 2.8,
    reconnect: 0,
    transferForms: ['stairs'],
  },
  'ind-room-switchgear-cache-descent-01': {
    entry: 2.8,
    reconnect: 0,
    transferForms: ['stairs'],
  },
  'ind-rise-long-freight-ramp-01': {
    entry: 0,
    reconnect: 2.8,
    transferForms: ['ramp'],
  },
  'ind-room-inclined-sorter-01': {
    entry: 0,
    reconnect: 2.8,
    transferForms: ['ramp'],
  },
};

function floorMaskOf(blueprint) {
  return blueprint.baseMask
    ?? blueprint.floorMask
    ?? blueprint.mask
    ?? blueprint.floorTiers?.find((tier) => (
      (tier.elevationMeters ?? tier.elevation ?? tier.y) === 0
    ))?.floorMask;
}

function upperFloorMaskOf(blueprint) {
  if (blueprint.upperFloorMask ?? blueprint.upperMask ?? blueprint.upper) {
    return blueprint.upperFloorMask ?? blueprint.upperMask ?? blueprint.upper;
  }
  const upperTier = blueprint.floorTiers
    ?.filter((tier) => (tier.elevationMeters ?? tier.elevation ?? tier.y) > 0)
    .sort((left, right) => (
      (right.elevationMeters ?? right.elevation ?? right.y)
      - (left.elevationMeters ?? left.elevation ?? left.y)
    ))[0];
  return upperTier?.floorMask ?? upperTier?.mask ?? [];
}

function footprintOf(blueprint) {
  return blueprint.footprintTiles
    ?? blueprint.dimensionsTiles
    ?? {
      width: floorMaskOf(blueprint)[0].length,
      depth: floorMaskOf(blueprint).length,
    };
}

function socketWidthOf(socket) {
  return socket.widthTiles ?? socket.width;
}

function socketElevationOf(socket) {
  return socket.elevationMeters ?? socket.elevation ?? socket.y;
}

function upperElevationOf(blueprint) {
  if (
    blueprint.upperElevationMeters !== undefined
    || blueprint.upperElevation !== undefined
    || blueprint.upperY !== undefined
  ) {
    return blueprint.upperElevationMeters ?? blueprint.upperElevation ?? blueprint.upperY;
  }
  return Math.max(
    0,
    ...(blueprint.floorTiers ?? []).map((tier) => (
      tier.elevationMeters ?? tier.elevation ?? tier.y
    )),
  );
}

function sectionRouteOf(blueprint) {
  return blueprint.sectionRoute ?? blueprint.section?.points ?? [];
}

function sectionPointElevation(point) {
  return Array.isArray(point) ? point[1] : point.elevationMeters ?? point.elevation ?? point.y;
}

function sectionPointProgress(point) {
  return Array.isArray(point) ? point[0] : point.progress;
}

function physicalTransfersOf(blueprint) {
  return blueprint.physicalTransfers
    ?? blueprint.transfers
    ?? (blueprint.features ?? []).filter((feature) => (
      feature.type === 'transfer' || feature.kind === 'transfer'
    ));
}

function transferFormOf(transfer) {
  return transfer.form ?? transfer.traversal ?? transfer.transferKind;
}

function localCellInTransferFootprint(transfer, localTile) {
  const footprint = transfer.footprintTiles ?? transfer;
  const width = Number(transfer.widthTiles ?? footprint.width ?? transfer.w ?? 1);
  const depth = Number(transfer.depthTiles ?? footprint.depth ?? transfer.d ?? 1);
  const minimumX = Number(footprint.x ?? transfer.x) - (width - 1) * 0.5;
  const minimumZ = Number(footprint.z ?? transfer.z) - (depth - 1) * 0.5;
  const xOrdinal = Number(localTile?.x) - minimumX;
  const zOrdinal = Number(localTile?.z) - minimumZ;
  return Number.isInteger(xOrdinal)
    && xOrdinal >= 0
    && xOrdinal < width
    && Number.isInteger(zOrdinal)
    && zOrdinal >= 0
    && zOrdinal < depth;
}

function exactBlueprintTierCell(blueprint, floorTierId, localTile) {
  const tier = (blueprint.floorTiers ?? []).find(({ id }) => id === floorTierId);
  if (!tier) return null;
  const column = Number(localTile?.x) - Number(tier.maskOriginTile?.x);
  const row = Number(localTile?.z) - Number(tier.maskOriginTile?.z);
  return Number.isInteger(column)
    && Number.isInteger(row)
    && tier.floorMask?.[row]?.[column] === '#'
    ? tier
    : null;
}

function routeTierOf(route) {
  return route.tier ?? route.floorTierId;
}

function maskHash(blueprint) {
  const signature = [
    floorMaskOf(blueprint).join('/'),
    upperFloorMaskOf(blueprint).join('/'),
  ].join('|');
  return createHash('sha256').update(signature).digest('hex');
}

function assertMaskDimensions(mask, width, depth, label) {
  assert.equal(mask.length, depth, `${label} depth`);
  for (const [rowIndex, row] of mask.entries()) {
    assert.equal(row.length, width, `${label} row ${rowIndex} width`);
    assert.match(row, /^[.#]+$/, `${label} row ${rowIndex} legend`);
  }
}

function assertSocketApertureIsFloor(blueprint, socket) {
  const floorMask = floorMaskOf(blueprint);
  const upperMask = upperFloorMaskOf(blueprint);
  const footprint = footprintOf(blueprint);
  const elevation = socketElevationOf(socket);
  const upperElevation = upperElevationOf(blueprint);
  const mask = elevation === 0 ? floorMask : upperMask;

  assert.ok(
    elevation === 0 || elevation === upperElevation,
    `${blueprint.id}/${socket.id} must terminate on a declared floor tier`,
  );
  assert.ok(mask.length > 0, `${blueprint.id}/${socket.id} tier must have a floor mask`);

  const halfWidth = Math.floor(footprint.width / 2);
  const halfDepth = Math.floor(footprint.depth / 2);
  const halfSocket = Math.floor(socketWidthOf(socket) / 2);

  if (socket.side === 'N' || socket.side === 'S') {
    const rowIndex = socket.side === 'N' ? 0 : footprint.depth - 1;
    const centerColumn = socket.center + halfWidth;
    for (let offset = -halfSocket; offset <= halfSocket; offset += 1) {
      assert.equal(
        mask[rowIndex][centerColumn + offset],
        '#',
        `${blueprint.id}/${socket.id} aperture tile ${offset} must be walkable`,
      );
    }
    return;
  }

  const columnIndex = socket.side === 'W' ? 0 : footprint.width - 1;
  const centerRow = socket.center + halfDepth;
  for (let offset = -halfSocket; offset <= halfSocket; offset += 1) {
    assert.equal(
      mask[centerRow + offset][columnIndex],
      '#',
      `${blueprint.id}/${socket.id} aperture tile ${offset} must be walkable`,
    );
  }
}

test('Industrial supplement blueprint catalog exposes the exact 28 authored templates', () => {
  assert.equal(
    INDUSTRIAL_SUPPLEMENT_BLUEPRINT_SCHEMA,
    'ruindivex-industrial-supplement-blueprint/v1',
  );
  assert.deepEqual(
    INDUSTRIAL_SUPPLEMENT_BLUEPRINT_IDS,
    EXPECTED_BLUEPRINT_IDS,
  );
  assert.equal(INDUSTRIAL_SUPPLEMENT_BLUEPRINT_IDS.length, 28);
  assert.deepEqual(
    Object.keys(INDUSTRIAL_SUPPLEMENT_BLUEPRINTS),
    INDUSTRIAL_SUPPLEMENT_BLUEPRINT_IDS,
  );

  assert.equal(INDUSTRIAL_SUPPLEMENT_BLUEPRINT_LIST.length, 28);
  assert.deepEqual(
    INDUSTRIAL_SUPPLEMENT_BLUEPRINT_LIST.map(({ id }) => id),
    INDUSTRIAL_SUPPLEMENT_BLUEPRINT_IDS,
  );
  for (const blueprint of INDUSTRIAL_SUPPLEMENT_BLUEPRINT_LIST) {
    assert.equal(blueprint.schema, INDUSTRIAL_SUPPLEMENT_BLUEPRINT_SCHEMA);
    assert.equal(blueprint.floorCellMeters, 2.8);
    assert.ok(blueprint.family.length > 4);
    assert.ok(blueprint.purpose.length > 20);
    assert.deepEqual(blueprint.dimensionsTiles, {
      width: blueprint.widthTiles,
      depth: blueprint.depthTiles,
    });
    assert.deepEqual(blueprint.baseMask, blueprint.mask);
    assert.deepEqual(blueprint.persistentStateIds, blueprint.stateIds);
    assert.ok(blueprint.floorTiers.length >= 1);
    const baseTier = blueprint.floorTiers.find((tier) => (
      (tier.elevationMeters ?? tier.elevation ?? tier.y) === 0
    ));
    assert.ok(baseTier, `${blueprint.id} has a normalized base tier`);
    assert.deepEqual(
      baseTier.floorMask ?? baseTier.mask,
      blueprint.baseMask,
      `${blueprint.id} normalized base tier mask`,
    );
  }
});

test('all 28 authored blueprints retain their exact plan footprints and floor masks', () => {
  assert.deepEqual(
    Object.keys(EXPECTED_LAYOUTS),
    INDUSTRIAL_SUPPLEMENT_BLUEPRINT_IDS,
  );

  for (const blueprintId of INDUSTRIAL_SUPPLEMENT_BLUEPRINT_IDS) {
    const blueprint = INDUSTRIAL_SUPPLEMENT_BLUEPRINTS[blueprintId];
    const expected = EXPECTED_LAYOUTS[blueprintId];
    const footprint = footprintOf(blueprint);
    const floorMask = floorMaskOf(blueprint);
    const upperFloorMask = upperFloorMaskOf(blueprint);

    assert.deepEqual(
      footprint,
      { width: expected.width, depth: expected.depth },
      `${blueprintId} footprint`,
    );
    assertMaskDimensions(
      floorMask,
      expected.width,
      expected.depth,
      `${blueprintId} base mask`,
    );
    assert.ok(floorMask.some((row) => row.includes('#')), `${blueprintId} has base floor`);
    if (upperFloorMask.length > 0) {
      assertMaskDimensions(
        upperFloorMask,
        expected.width,
        expected.depth,
        `${blueprintId} upper mask`,
      );
      assert.ok(
        upperFloorMask.some((row) => row.includes('#')),
        `${blueprintId} has upper floor`,
      );
    }
    assert.equal(maskHash(blueprint), expected.maskSha256, `${blueprintId} exact masks`);
  }
});

test('the three required junction kits retain their specified exact footprints and active arms', () => {
  const throughT = resolveIndustrialSupplementBlueprint('ind-junction-through-t-01');
  assert.deepEqual(footprintOf(throughT), { width: 5, depth: 7 });
  assert.deepEqual(floorMaskOf(throughT), [
    '.###.',
    '.###.',
    '.####',
    '.####',
    '.####',
    '.###.',
    '.###.',
  ]);
  assert.deepEqual(throughT.sockets.map(({ side }) => side), ['N', 'S', 'E']);

  const crossroads = resolveIndustrialSupplementBlueprint('ind-junction-crossroads-01');
  assert.deepEqual(footprintOf(crossroads), { width: 7, depth: 7 });
  assert.deepEqual(floorMaskOf(crossroads), [
    '..###..',
    '..###..',
    '#######',
    '#######',
    '#######',
    '..###..',
    '..###..',
  ]);
  assert.deepEqual(crossroads.sockets.map(({ side }) => side), ['N', 'E', 'S', 'W']);

  const staggered = resolveIndustrialSupplementBlueprint(
    'ind-junction-staggered-cross-01',
  );
  assert.deepEqual(footprintOf(staggered), { width: 5, depth: 13 });
  assert.deepEqual(floorMaskOf(staggered), [
    '.###.',
    '.###.',
    '####.',
    '####.',
    '####.',
    '.###.',
    '.###.',
    '.###.',
    '.####',
    '.####',
    '.####',
    '.###.',
    '.###.',
  ]);
  assert.deepEqual(staggered.sockets.map(({ side }) => side), ['N', 'W', 'E', 'S']);
  const west = staggered.sockets.find(({ side }) => side === 'W');
  const east = staggered.sockets.find(({ side }) => side === 'E');
  assert.equal(east.center - west.center, 6);
});

test('every socket is an exact three-tile aperture backed by walkable floor on its tier', () => {
  for (const blueprintId of INDUSTRIAL_SUPPLEMENT_BLUEPRINT_IDS) {
    const blueprint = INDUSTRIAL_SUPPLEMENT_BLUEPRINTS[blueprintId];
    assert.ok(blueprint.sockets.length >= 2, `${blueprintId} has an entry and reconnect`);
    assert.equal(
      new Set(blueprint.sockets.map(({ id }) => id)).size,
      blueprint.sockets.length,
      `${blueprintId} socket IDs`,
    );

    for (const socket of blueprint.sockets) {
      assert.match(socket.id, /^[a-z0-9-]+$/);
      assert.ok(['N', 'E', 'S', 'W'].includes(socket.side));
      assert.equal(socketWidthOf(socket), 3, `${blueprintId}/${socket.id} aperture width`);
      assert.equal(socket.widthMeters, 8.4);
      assert.ok(Number.isFinite(socket.center));
      assert.ok(Number.isFinite(socketElevationOf(socket)));
      assertSocketApertureIsFloor(blueprint, socket);
    }
  }
});

test('all 16 executable exit-elevation blueprints physically connect both authored tiers', () => {
  const acceptedTransferForms = new Set(['ramp', 'stairs', 'lift', 'ladder']);

  for (const blueprintId of EXIT_ELEVATION_BLUEPRINT_IDS) {
    const blueprint = INDUSTRIAL_SUPPLEMENT_BLUEPRINTS[blueprintId];
    const expected = EXPECTED_EXIT_ELEVATIONS[blueprintId];
    const floorMask = floorMaskOf(blueprint);
    const upperFloorMask = upperFloorMaskOf(blueprint);
    const upperElevation = upperElevationOf(blueprint);
    const socketElevations = blueprint.sockets.map(socketElevationOf);
    const sectionRoute = sectionRouteOf(blueprint);
    const transfers = physicalTransfersOf(blueprint);

    assert.ok(floorMask.some((row) => row.includes('#')), `${blueprintId} base tier`);
    assert.ok(upperFloorMask.some((row) => row.includes('#')), `${blueprintId} upper tier`);
    assert.ok([2.8, 5.6].includes(upperElevation), `${blueprintId} authored upper elevation`);
    assert.equal(socketElevations[0], expected.entry, `${blueprintId} entry elevation`);
    assert.equal(
      socketElevations.at(-1),
      expected.reconnect,
      `${blueprintId} reconnect elevation`,
    );
    assert.deepEqual(
      new Set(blueprint.floorTiers.map((tier) => (
        tier.elevationMeters ?? tier.elevation ?? tier.y
      ))),
      new Set([0, upperElevation]),
      `${blueprintId} normalized floor tiers`,
    );
    assert.equal(socketElevations[0], sectionPointElevation(sectionRoute[0]));
    assert.equal(
      socketElevations.at(-1),
      sectionPointElevation(sectionRoute.at(-1)),
      `${blueprintId} section terminates at reconnect elevation`,
    );
    assert.notEqual(
      socketElevations[0],
      socketElevations.at(-1),
      `${blueprintId} exits must differ in elevation`,
    );
    assert.deepEqual(
      new Set(socketElevations),
      new Set([0, upperElevation]),
      `${blueprintId} sockets occupy both tiers`,
    );
    assert.ok(sectionRoute.length >= 2, `${blueprintId} has an executable section`);
    assert.equal(sectionPointProgress(sectionRoute[0]), 0);
    assert.equal(sectionPointProgress(sectionRoute.at(-1)), 1);
    for (let index = 0; index < sectionRoute.length; index += 1) {
      const point = sectionRoute[index];
      assert.ok(Number.isFinite(sectionPointProgress(point)));
      assert.ok(Number.isFinite(sectionPointElevation(point)));
      assert.ok(sectionPointElevation(point) >= 0);
      assert.ok(sectionPointElevation(point) <= upperElevation);
      if (index > 0) {
        assert.ok(
          sectionPointProgress(point) >= sectionPointProgress(sectionRoute[index - 1]),
          `${blueprintId} section progress is ordered`,
        );
      }
    }
    assert.ok(transfers.length >= 1, `${blueprintId} has physical transfer geometry`);
    assert.ok(
      transfers.some((transfer) => acceptedTransferForms.has(transferFormOf(transfer))),
      `${blueprintId} uses a ramp, stairs, lift, or ladder rather than metadata alone`,
    );
    assert.deepEqual(
      transfers.map(transferFormOf),
      expected.transferForms,
      `${blueprintId} exact authored transfer sequence`,
    );
    for (const transfer of transfers) {
      assert.ok(transfer.id.length > 0);
      assert.ok((transfer.widthTiles ?? transfer.w) > 0);
      assert.ok((transfer.depthTiles ?? transfer.d) > 0);
    }

    const routeTiers = new Set((blueprint.routes ?? []).map(routeTierOf));
    assert.ok(routeTiers.has('base'), `${blueprintId} has a base-tier route`);
    assert.ok(routeTiers.has('upper'), `${blueprintId} has an upper-tier route`);
  }
});

test('every authored physical transfer endpoint names exact local transfer and support cells', () => {
  let transferCount = 0;
  let endpointCount = 0;
  let floorSupportCount = 0;
  let transferSupportCount = 0;

  for (const blueprint of INDUSTRIAL_SUPPLEMENT_BLUEPRINT_LIST) {
    const transferById = new Map(physicalTransfersOf(blueprint).map((transfer) => (
      [transfer.id, transfer]
    )));
    transferCount += transferById.size;
    for (const transfer of transferById.values()) {
      for (const role of ['from', 'to']) {
        endpointCount += 1;
        const endpoint = transfer.endpoints?.[role];
        assert.ok(endpoint, `${blueprint.id}/${transfer.id}/${role} endpoint`);
        assert.ok(
          Number.isFinite(endpoint.localElevation),
          `${blueprint.id}/${transfer.id}/${role} local elevation`,
        );
        assert.ok(
          localCellInTransferFootprint(transfer, endpoint.localTransferCell),
          `${blueprint.id}/${transfer.id}/${role} exact owning transfer cell`,
        );

        const support = endpoint.localSupportRef;
        assert.ok(support?.localTile, `${blueprint.id}/${transfer.id}/${role} support ref`);
        if (support.kind === 'floor-cell') {
          floorSupportCount += 1;
          const tier = exactBlueprintTierCell(
            blueprint,
            support.floorTierId,
            support.localTile,
          );
          assert.ok(tier, `${blueprint.id}/${transfer.id}/${role} exact floor support`);
          assert.equal(
            tier.elevation,
            endpoint.localElevation,
            `${blueprint.id}/${transfer.id}/${role} support tier elevation`,
          );
        } else {
          assert.equal(
            support.kind,
            'transfer-cell',
            `${blueprint.id}/${transfer.id}/${role} support kind`,
          );
          transferSupportCount += 1;
          const supportingTransfer = transferById.get(support.transferId);
          assert.ok(
            supportingTransfer && supportingTransfer !== transfer,
            `${blueprint.id}/${transfer.id}/${role} supporting transfer`,
          );
          assert.ok(
            localCellInTransferFootprint(supportingTransfer, support.localTile),
            `${blueprint.id}/${transfer.id}/${role} exact neighboring transfer cell`,
          );
        }
      }
    }
  }

  assert.equal(transferCount, 27);
  assert.equal(endpointCount, 54);
  assert.equal(floorSupportCount, 42);
  assert.equal(transferSupportCount, 12);
});

test('maintenance rise provides at least six playable ramp intervals for its 2.8 metre rise', () => {
  const blueprint = resolveIndustrialSupplementBlueprint('ind-room-maintenance-rise-01');
  const ramp = physicalTransfersOf(blueprint).find((transfer) => (
    transfer.id === 'mr-switchback-ramp'
  ));
  assert.ok(ramp);
  assert.equal(transferFormOf(ramp), 'ramp');
  const intervalCount = Math.max(ramp.widthTiles, ramp.depthTiles) - 1;
  const rise = ramp.elevationRangeMeters.max - ramp.elevationRangeMeters.min;
  assert.ok(intervalCount >= Math.ceil(rise / 0.55));
  assert.ok(rise / intervalCount <= 0.55);
});

test('blueprint catalog, list, and resolver expose deeply immutable independent values', () => {
  assert.ok(Object.isFrozen(INDUSTRIAL_SUPPLEMENT_BLUEPRINTS));
  assert.ok(Object.isFrozen(INDUSTRIAL_SUPPLEMENT_BLUEPRINT_IDS));
  assert.ok(Object.isFrozen(INDUSTRIAL_SUPPLEMENT_BLUEPRINT_LIST));

  const catalogBlueprint = INDUSTRIAL_SUPPLEMENT_BLUEPRINTS[
    'ind-rise-switchback-ramp-01'
  ];
  const first = resolveIndustrialSupplementBlueprint('ind-rise-switchback-ramp-01');
  const second = resolveIndustrialSupplementBlueprint('ind-rise-switchback-ramp-01');

  assert.notEqual(first, catalogBlueprint);
  assert.notEqual(first, second);
  assert.notEqual(
    first,
    INDUSTRIAL_SUPPLEMENT_BLUEPRINT_LIST.find(({ id }) => id === first.id),
  );
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(catalogBlueprint));
  assert.ok(Object.isFrozen(catalogBlueprint.sockets));
  assert.ok(Object.isFrozen(catalogBlueprint.sockets[0]));
  assert.ok(Object.isFrozen(floorMaskOf(catalogBlueprint)));
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.sockets));
  assert.ok(Object.isFrozen(first.sockets[0]));
  assert.ok(Object.isFrozen(sectionRouteOf(first)));
  assert.throws(() => {
    first.sockets[0].center = 99;
  }, TypeError);
  assert.throws(() => {
    floorMaskOf(first)[0] = 'mutated';
  }, TypeError);

  for (const unknownId of [undefined, null, '', 'unknown', '__proto__']) {
    assert.equal(resolveIndustrialSupplementBlueprint(unknownId), null);
  }
});

test('Three.js blueprint catalog has no Unity dependency', async () => {
  const source = await readFile(
    new URL(
      '../src/dungeon-augmentation/IndustrialSupplementBlueprintCatalog.js',
      import.meta.url,
    ),
    'utf8',
  );
  assert.doesNotMatch(source, /(?:from\s+|import\s*\()[^;\n]*unity/i);
  assert.doesNotMatch(source, /(?:Assets|Packages)[\\/].*Unity/i);
});
