export const DUNGEON_ROUTE_ENDPOINT_SEAM_GRID_LATTICE_DIAGNOSTIC =
  'route-network-endpoint-seam-grid-lattice-invalid';

function finiteInteger(value) {
  return Number.isInteger(Number(value));
}

function nonNegativeInteger(value) {
  return finiteInteger(value) && Number(value) >= 0;
}

/**
 * Verifies the discrete traversal identity of one V4 endpoint seam without
 * rebuilding or normalizing it. The seam's metric positions remain separate;
 * this contract only proves that the serialized grid cells form one complete
 * cardinal lattice anchored at the threshold center.
 */
export function inspectDungeonRouteEndpointSeamGridLattice(seam = {}) {
  const facingX = Number(seam?.facing?.x);
  const facingZ = Number(seam?.facing?.z);
  if (![-1, 0, 1].includes(facingX)
    || ![-1, 0, 1].includes(facingZ)
    || Math.abs(facingX) + Math.abs(facingZ) !== 1) {
    return {
      accepted: false,
      reason: 'facing-is-not-cardinal',
      seamId: seam?.id ?? null,
      facing: { x: facingX, z: facingZ },
    };
  }

  const widthTiles = Number(seam.widthTiles);
  const insideDepthTiles = Number(seam.insideDepthTiles);
  const thresholdDepthTiles = Number(seam.thresholdDepthTiles);
  const outsideDepthTiles = Number(seam.outsideDepthTiles);
  if (!finiteInteger(widthTiles)
    || widthTiles < 1
    || !nonNegativeInteger(insideDepthTiles)
    || thresholdDepthTiles !== 1
    || !nonNegativeInteger(outsideDepthTiles)) {
    return {
      accepted: false,
      reason: 'lattice-dimensions-are-invalid',
      seamId: seam?.id ?? null,
      widthTiles,
      insideDepthTiles,
      thresholdDepthTiles,
      outsideDepthTiles,
    };
  }

  const minimumLane = -Math.floor(widthTiles / 2);
  const maximumLane = minimumLane + widthTiles - 1;
  const minimumDepth = -insideDepthTiles;
  const maximumDepth = outsideDepthTiles;
  const expectedCellCount = widthTiles
    * (insideDepthTiles + thresholdDepthTiles + outsideDepthTiles);
  const orderedCells = Array.isArray(seam.orderedCells) ? seam.orderedCells : [];
  if (orderedCells.length !== expectedCellCount) {
    return {
      accepted: false,
      reason: 'cell-count-mismatch',
      seamId: seam?.id ?? null,
      expectedCellCount,
      actualCellCount: orderedCells.length,
    };
  }

  const byCoordinate = new Map();
  for (const cell of orderedCells) {
    const lane = Number(cell?.lane);
    const signedDepthTiles = Number(cell?.signedDepthTiles);
    const coordinateKey = `${signedDepthTiles}:${lane}`;
    const matches = byCoordinate.get(coordinateKey) ?? [];
    matches.push(cell);
    byCoordinate.set(coordinateKey, matches);
  }
  const thresholdCells = byCoordinate.get('0:0') ?? [];
  if (thresholdCells.length !== 1
    || !finiteInteger(thresholdCells[0]?.gridX)
    || !finiteInteger(thresholdCells[0]?.gridZ)) {
    return {
      accepted: false,
      reason: 'threshold-grid-anchor-is-invalid',
      seamId: seam?.id ?? null,
      thresholdCellCount: thresholdCells.length,
    };
  }

  const thresholdGridX = Number(thresholdCells[0].gridX);
  const thresholdGridZ = Number(thresholdCells[0].gridZ);
  const lateralX = -facingZ;
  const lateralZ = facingX;
  const occupiedGridIdentities = new Set();
  let expectedOrdinal = 0;
  for (let signedDepthTiles = minimumDepth;
    signedDepthTiles <= maximumDepth;
    signedDepthTiles += 1) {
    for (let lane = minimumLane; lane <= maximumLane; lane += 1) {
      const serializedCell = orderedCells[expectedOrdinal];
      if (Number(serializedCell?.signedDepthTiles) !== signedDepthTiles
        || Number(serializedCell?.lane) !== lane) {
        return {
          accepted: false,
          reason: 'serialized-cell-order-mismatch',
          seamId: seam?.id ?? null,
          ordinal: expectedOrdinal,
          expectedLocalIdentity: { lane, signedDepthTiles },
          actualLocalIdentity: {
            lane: serializedCell?.lane ?? null,
            signedDepthTiles: serializedCell?.signedDepthTiles ?? null,
          },
        };
      }
      expectedOrdinal += 1;
      const coordinateKey = `${signedDepthTiles}:${lane}`;
      const matches = byCoordinate.get(coordinateKey) ?? [];
      if (matches.length !== 1) {
        return {
          accepted: false,
          reason: matches.length === 0
            ? 'lane-depth-cell-is-missing'
            : 'lane-depth-cell-is-duplicated',
          seamId: seam?.id ?? null,
          lane,
          signedDepthTiles,
          matchCount: matches.length,
        };
      }
      const cell = matches[0];
      if (!finiteInteger(cell.gridX) || !finiteInteger(cell.gridZ)) {
        return {
          accepted: false,
          reason: 'cell-grid-identity-is-not-integer',
          seamId: seam?.id ?? null,
          cellId: cell?.id ?? null,
          lane,
          signedDepthTiles,
          gridX: cell?.gridX ?? null,
          gridZ: cell?.gridZ ?? null,
        };
      }
      const expectedGridX = thresholdGridX
        + facingX * signedDepthTiles
        + lateralX * lane;
      const expectedGridZ = thresholdGridZ
        + facingZ * signedDepthTiles
        + lateralZ * lane;
      if (Number(cell.gridX) !== expectedGridX || Number(cell.gridZ) !== expectedGridZ) {
        return {
          accepted: false,
          reason: 'cell-grid-offset-mismatch',
          seamId: seam?.id ?? null,
          cellId: cell?.id ?? null,
          lane,
          signedDepthTiles,
          expectedGrid: { x: expectedGridX, z: expectedGridZ },
          actualGrid: { x: Number(cell.gridX), z: Number(cell.gridZ) },
        };
      }
      const gridIdentity = `${Number(cell.gridX)},${Number(cell.gridZ)}`;
      if (occupiedGridIdentities.has(gridIdentity)) {
        return {
          accepted: false,
          reason: 'grid-identity-is-duplicated',
          seamId: seam?.id ?? null,
          cellId: cell?.id ?? null,
          gridIdentity,
        };
      }
      occupiedGridIdentities.add(gridIdentity);
    }
  }

  return {
    accepted: true,
    reason: null,
    seamId: seam?.id ?? null,
    expectedCellCount,
    uniqueGridCellCount: occupiedGridIdentities.size,
    thresholdGrid: { x: thresholdGridX, z: thresholdGridZ },
  };
}
