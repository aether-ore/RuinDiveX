import {
  INDUSTRIAL_SUPPLEMENT_STRUCTURAL_QUALITY_SCHEMA,
} from './IndustrialSupplementContent.js';
import {
  INDUSTRIAL_SUPPLEMENT_BLUEPRINT_SCHEMA,
} from './IndustrialSupplementBlueprintCatalog.js';

export const INDUSTRIAL_SUPPLEMENT_STRUCTURAL_QUALITY_REPORT_SCHEMA =
  'ruindivex-industrial-supplement-structural-quality-report/v1';

const ELEVATION_EPSILON = 0.000001;

function numeric(value, fallback = NaN) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function elevationKey(value) {
  return numeric(value, 0).toFixed(6);
}

function tileKey(x, z) {
  return `${Number(x)},${Number(z)}`;
}

function pointKey(point) {
  return `${tileKey(point.x, point.z)}@${elevationKey(point.elevation)}`;
}

function sortedUnique(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function localTile(record) {
  const tile = record?.localTile ?? record?.localPosition ?? null;
  if (!tile) return null;
  const x = numeric(tile.x);
  const z = numeric(tile.z);
  const elevation = numeric(tile.elevation ?? tile.y, 0);
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(elevation)) {
    return null;
  }
  return { x, z, elevation };
}

function maskCells(mask, origin = null) {
  const rows = Array.isArray(mask) ? mask.map((row) => String(row ?? '')) : [];
  const width = Math.max(0, ...rows.map((row) => row.length));
  const offsetX = numeric(origin?.x, -Math.floor(width / 2));
  const offsetZ = numeric(origin?.z, -Math.floor(rows.length / 2));
  const cells = [];
  for (let row = 0; row < rows.length; row += 1) {
    for (let column = 0; column < rows[row].length; column += 1) {
      if (rows[row][column] !== '#') continue;
      cells.push({ x: offsetX + column, z: offsetZ + row });
    }
  }
  return cells;
}

function floorCellsByElevation(manifest) {
  const index = new Map();
  for (const tier of manifest?.floorTiers ?? []) {
    const key = elevationKey(tier.elevation);
    const cells = index.get(key) ?? new Set();
    for (const cell of maskCells(tier.floorMask, tier.maskOriginTile)) {
      cells.add(tileKey(cell.x, cell.z));
    }
    index.set(key, cells);
  }
  return index;
}

function zoneElevations(zone) {
  if (Array.isArray(zone?.elevations) && zone.elevations.length > 0) {
    return zone.elevations.map((value) => numeric(value, 0));
  }
  return [numeric(zone?.elevation, 0)];
}

function boundsContain(bounds, x, z) {
  return bounds
    && x >= numeric(bounds.minX)
    && x <= numeric(bounds.maxX)
    && z >= numeric(bounds.minZ)
    && z <= numeric(bounds.maxZ);
}

function zoneContainsElevation(zone, elevation) {
  return zoneElevations(zone).some((candidate) => (
    Math.abs(candidate - elevation) <= ELEVATION_EPSILON
  ));
}

function manifestZoneCells(manifest, zone, floorIndex) {
  const zoneById = new Map((manifest?.zones ?? []).map((entry) => [String(entry.id), entry]));
  const cells = [];
  for (const elevation of zoneElevations(zone)) {
    const walkable = floorIndex.get(elevationKey(elevation)) ?? new Set();
    const bounds = zone?.tileBounds ?? {};
    for (let z = numeric(bounds.minZ); z <= numeric(bounds.maxZ); z += 1) {
      for (let x = numeric(bounds.minX); x <= numeric(bounds.maxX); x += 1) {
        if (!walkable.has(tileKey(x, z))) continue;
        const excluded = (zone.excludesZoneIds ?? []).some((zoneId) => {
          const excludedZone = zoneById.get(String(zoneId));
          return excludedZone
            && zoneContainsElevation(excludedZone, elevation)
            && boundsContain(excludedZone.tileBounds, x, z);
        });
        if (!excluded) cells.push({ x, z, elevation });
      }
    }
  }
  return cells;
}

function componentCount(cells) {
  const pendingKeys = new Set(cells.map((cell) => pointKey(cell)));
  let count = 0;
  while (pendingKeys.size > 0) {
    count += 1;
    const first = pendingKeys.values().next().value;
    pendingKeys.delete(first);
    const pending = [first];
    while (pending.length > 0) {
      const value = pending.pop();
      const [horizontal, elevation] = value.split('@');
      const [x, z] = horizontal.split(',').map(Number);
      for (const [offsetX, offsetZ] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const neighbor = `${tileKey(x + offsetX, z + offsetZ)}@${elevation}`;
        if (!pendingKeys.delete(neighbor)) continue;
        pending.push(neighbor);
      }
    }
  }
  return count;
}

function maximumPairwiseDistance(records) {
  const points = records.map(localTile).filter(Boolean);
  let maximum = 0;
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      maximum = Math.max(
        maximum,
        Math.abs(points[first].x - points[second].x)
          + Math.abs(points[first].z - points[second].z),
      );
    }
  }
  return maximum;
}

function lineCells(from, to) {
  let x = Math.round(from.x);
  let z = Math.round(from.z);
  const targetX = Math.round(to.x);
  const targetZ = Math.round(to.z);
  const deltaX = Math.abs(targetX - x);
  const deltaZ = Math.abs(targetZ - z);
  const stepX = x < targetX ? 1 : -1;
  const stepZ = z < targetZ ? 1 : -1;
  let error = deltaX - deltaZ;
  const cells = [];
  while (true) {
    cells.push({ x, z });
    if (x === targetX && z === targetZ) break;
    const doubled = error * 2;
    if (doubled > -deltaZ) {
      error -= deltaZ;
      x += stepX;
    }
    if (doubled < deltaX) {
      error += deltaX;
      z += stepZ;
    }
  }
  return cells;
}

function boundaryOrigins(baseCells, boundary) {
  if (baseCells.length === 0) return [];
  const coordinate = boundary === 'south'
    ? Math.min(...baseCells.map(({ z }) => z))
    : boundary === 'north'
      ? Math.max(...baseCells.map(({ z }) => z))
      : boundary === 'west'
        ? Math.min(...baseCells.map(({ x }) => x))
        : Math.max(...baseCells.map(({ x }) => x));
  return baseCells.filter((cell) => (
    ['south', 'north'].includes(boundary) ? cell.z === coordinate : cell.x === coordinate
  )).sort((left, right) => left.x - right.x || left.z - right.z);
}

function collectionIds(records, localIdField) {
  return sortedUnique((records ?? []).map((record) => (
    record?.[localIdField] ?? record?.id
  )));
}

function sameStringArrays(left, right) {
  return JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right));
}

function samePlainValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function finiteWorldPoint(point) {
  return Number.isFinite(Number(point?.x))
    && Number.isFinite(Number(point?.y))
    && Number.isFinite(Number(point?.z));
}

function realizedTierConnectivityAccepted(tier) {
  const cells = Array.isArray(tier?.worldCells) ? tier.worldCells : [];
  const cellIds = new Set(cells.map(({ id }) => String(id ?? '')).filter(Boolean));
  if (cellIds.size === 0 || cellIds.size !== cells.length) return false;
  const adjacency = new Map([...cellIds].map((id) => [id, new Set()]));
  for (const edge of tier?.worldConnectivityEdges ?? []) {
    const from = String(edge?.fromCellId ?? '');
    const to = String(edge?.toCellId ?? '');
    if (!cellIds.has(from) || !cellIds.has(to)) return false;
    adjacency.get(from).add(to);
    adjacency.get(to).add(from);
  }
  const pending = [[...cellIds][0]];
  const reachable = new Set();
  while (pending.length > 0) {
    const id = pending.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const adjacentId of adjacency.get(id) ?? []) {
      if (!reachable.has(adjacentId)) pending.push(adjacentId);
    }
  }
  return reachable.size === cellIds.size;
}

function blueprintRouteIds(blueprint) {
  const routeIds = (blueprint?.routes ?? []).map((_, ordinal) => `blueprint-route-${ordinal}`);
  if ((blueprint?.sectionRoute ?? []).length >= 2) routeIds.push('blueprint-section-route');
  return sortedUnique(routeIds);
}

function blueprintFeatureIds(blueprint, predicate = () => true) {
  return sortedUnique((blueprint?.features ?? []).filter(predicate).map(({ id }) => id));
}

function blueprintFootprintsOverlap(left, right) {
  const leftWidth = Math.max(1, numeric(left?.w ?? left?.width, 1));
  const leftDepth = Math.max(1, numeric(left?.d ?? left?.depth, 1));
  const rightWidth = Math.max(1, numeric(right?.w ?? right?.width, 1));
  const rightDepth = Math.max(1, numeric(right?.d ?? right?.depth, 1));
  return Math.abs(numeric(left?.x) - numeric(right?.x)) * 2 < leftWidth + rightWidth
    && Math.abs(numeric(left?.z) - numeric(right?.z)) * 2 < leftDepth + rightDepth;
}

function inspectIndustrialSupplementBlueprintRealizedStructuralQuality(
  room,
  { clearanceVolumes } = {},
) {
  const blueprint = room?.augmentationBlueprint;
  const manifest = room?.augmentationModuleManifest;
  const manifestReport = manifest
    ? inspectIndustrialSupplementManifestStructuralQuality(manifest, {
      structure: room?.augmentationStructure?.sourceStructure
        ?? room?.augmentationStructureMetadata?.sourceStructure,
      clearanceVolumes,
    })
    : {
      schema: INDUSTRIAL_SUPPLEMENT_STRUCTURAL_QUALITY_REPORT_SCHEMA,
      phase: 'manifest',
      manifestId: null,
      accepted: true,
      errors: [],
      metrics: {
        sightlines: [],
        enclosureAndCamera: null,
      },
    };
  const errors = [...manifestReport.errors];
  const declaredBlueprintId = String(
    room?.augmentationBlueprintId
      ?? room?.augmentationPhysicalRealization?.blueprintId
      ?? '',
  );
  if (!blueprint || typeof blueprint !== 'object') {
    errors.push('realized-blueprint-definition-missing');
  }
  if (blueprint?.schema !== INDUSTRIAL_SUPPLEMENT_BLUEPRINT_SCHEMA) {
    errors.push('realized-blueprint-schema-mismatch');
  }
  if (!declaredBlueprintId || String(blueprint?.id ?? '') !== declaredBlueprintId) {
    errors.push('realized-blueprint-id-mismatch');
  }
  if (room?.augmentationPhysicalRealization?.blueprintId != null
      && String(room.augmentationPhysicalRealization.blueprintId) !== declaredBlueprintId) {
    errors.push('realized-physical-blueprint-id-mismatch');
  }

  const expected = {
    floorTierIds: sortedUnique((blueprint?.floorTiers ?? []).map(({ id }) => id)),
    clearRouteIds: blueprintRouteIds(blueprint),
    zoneIds: sortedUnique((blueprint?.zones ?? []).map(({ id }) => id)),
    featureIds: blueprintFeatureIds(blueprint),
    coverIds: blueprintFeatureIds(blueprint, ({ type }) => type === 'cover'),
    landmarkIds: blueprintFeatureIds(blueprint, ({ type }) => type === 'machine'),
    lightingIds: [],
    socketIds: sortedUnique((blueprint?.sockets ?? []).map(({ id }) => id)),
    transferIds: sortedUnique((blueprint?.physicalTransfers ?? []).map(({ id }) => id)),
    voidIds: sortedUnique((blueprint?.voids ?? []).map(({ id }) => id)),
    stateIds: sortedUnique(blueprint?.stateIds ?? blueprint?.persistentStateIds ?? []),
  };
  const actual = {
    floorTierIds: collectionIds(room?.augmentationFloorTiers, 'localTierId'),
    clearRouteIds: collectionIds(room?.augmentationClearRoutes, 'localRouteId'),
    zoneIds: collectionIds(room?.augmentationZones, 'localZoneId'),
    featureIds: collectionIds(room?.augmentationBlueprintFeatures, 'localFeatureId'),
    coverIds: collectionIds(room?.augmentationCover, 'localFeatureId'),
    landmarkIds: collectionIds(room?.augmentationLandmarks, 'localFeatureId'),
    lightingIds: collectionIds(room?.augmentationLighting, 'localLightingId'),
    socketIds: collectionIds(room?.augmentationSocketRecords, 'localSocketId'),
    transferIds: collectionIds(room?.augmentationTransfers, 'localTransferId'),
    voidIds: collectionIds(room?.augmentationVoids, 'localVoidId'),
    stateIds: collectionIds(room?.augmentationBlueprintStateRecords, 'localStateId'),
  };
  for (const key of Object.keys(expected)) {
    if (!sameStringArrays(expected[key], actual[key])) {
      errors.push(`realized-blueprint-${key}-mismatch`);
    }
  }

  const authoritativeBaseMask = blueprint?.baseMask ?? blueprint?.mask;
  if (!samePlainValue(room?.augmentationFloorMask, authoritativeBaseMask)) {
    errors.push('realized-blueprint-floor-mask-mismatch');
  }
  if (room?.augmentationPhysicalRealization
      && !samePlainValue(room.augmentationPhysicalRealization.floorMask, authoritativeBaseMask)) {
    errors.push('realized-physical-blueprint-floor-mask-mismatch');
  }

  const realizedTierById = new Map((room?.augmentationFloorTiers ?? []).map((tier) => (
    [String(tier.localTierId ?? tier.id), tier]
  )));
  const allFloorCellIds = new Set();
  const floorTierConnectivity = [];
  for (const sourceTier of blueprint?.floorTiers ?? []) {
    const tierId = String(sourceTier.id);
    const realizedTier = realizedTierById.get(tierId);
    const sourceCells = maskCells(sourceTier.floorMask, sourceTier.maskOriginTile);
    const expectedCellKeys = sortedUnique(sourceCells.map(({ x, z }) => tileKey(x, z)));
    const realizedCellKeys = sortedUnique((realizedTier?.worldCells ?? []).map(({ localTile: tile }) => (
      tileKey(tile?.x, tile?.z)
    )));
    const elevationAccepted = realizedTier
      && Math.abs(numeric(realizedTier.localElevation) - numeric(sourceTier.elevation))
        <= ELEVATION_EPSILON
      && (realizedTier.worldCells ?? []).every((cell) => (
        Math.abs(numeric(cell?.localTile?.elevation) - numeric(sourceTier.elevation))
          <= ELEVATION_EPSILON
          && Math.abs(numeric(cell?.elevation) - numeric(realizedTier.worldElevation))
            <= ELEVATION_EPSILON
          && finiteWorldPoint(cell?.position ?? cell?.worldPosition)
      ));
    const maskAccepted = Boolean(realizedTier)
      && samePlainValue(realizedTier.floorMask, sourceTier.floorMask)
      && samePlainValue(realizedTier.maskOriginTile, sourceTier.maskOriginTile)
      && sameStringArrays(realizedCellKeys, expectedCellKeys);
    const connectivityAccepted = Boolean(realizedTier)
      && realizedTierConnectivityAccepted(realizedTier);
    if (!maskAccepted) errors.push(`realized-blueprint-tier-mask-mismatch:${tierId}`);
    if (!elevationAccepted) errors.push(`realized-blueprint-tier-elevation-invalid:${tierId}`);
    if (!connectivityAccepted) errors.push(`realized-blueprint-tier-disconnected:${tierId}`);
    for (const cell of realizedTier?.worldCells ?? []) allFloorCellIds.add(String(cell.id));
    floorTierConnectivity.push({
      tierId,
      expectedCellCount: expectedCellKeys.length,
      realizedCellCount: realizedCellKeys.length,
      maskAccepted,
      elevationAccepted,
      connectivityAccepted,
      accepted: maskAccepted && elevationAccepted && connectivityAccepted,
    });
  }

  const realizedRouteById = new Map((room?.augmentationClearRoutes ?? []).map((route) => (
    [String(route.localRouteId ?? route.id), route]
  )));
  const allTransferCellIds = new Set((room?.augmentationTransfers ?? []).flatMap((transfer) => (
    (transfer.worldCells ?? []).map(({ id }) => String(id))
  )));
  const blueprintTraversalRoutes = expected.clearRouteIds.map((routeId) => {
    const route = realizedRouteById.get(routeId);
    const validCellIds = routeId === 'blueprint-section-route'
      ? allTransferCellIds
      : allFloorCellIds;
    const worldCellIds = (route?.worldCellIds ?? []).map(String);
    const accepted = Boolean(route)
      && worldCellIds.length > 0
      && worldCellIds.every((cellId) => validCellIds.has(cellId));
    if (!accepted) errors.push(`realized-blueprint-clear-route-invalid:${routeId}`);
    return {
      routeId,
      worldCellCount: worldCellIds.length,
      accepted,
    };
  });

  const socketById = new Map((room?.augmentationSocketRecords ?? []).map((socket) => (
    [String(socket.localSocketId ?? socket.id), socket]
  )));
  const accessibleExitSocketIds = [];
  const ordinaryRouteCellIds = new Set((room?.augmentationClearRoutes ?? [])
    .filter(({ localRouteId, id }) => String(localRouteId ?? id) !== 'blueprint-section-route')
    .flatMap(({ worldCellIds }) => (worldCellIds ?? []).map(String)));
  for (const socketId of expected.socketIds) {
    const socket = socketById.get(socketId);
    const apertureCellIds = sortedUnique(socket?.apertureFloorCellIds ?? []);
    const accessible = Boolean(socket)
      && socket.reservedOpening === true
      && apertureCellIds.length === 3
      && apertureCellIds.every((cellId) => allFloorCellIds.has(cellId))
      && apertureCellIds.some((cellId) => ordinaryRouteCellIds.has(cellId))
      && finiteWorldPoint(socket.position ?? socket.worldPosition);
    if (accessible) accessibleExitSocketIds.push(socketId);
    else errors.push(`realized-blueprint-required-exit-route-missing:${socketId}`);
  }
  if (!sameStringArrays(accessibleExitSocketIds, expected.socketIds)) {
    errors.push('realized-blueprint-required-exit-coverage-incomplete');
  }

  const zoneFloorCoverage = (room?.augmentationZones ?? []).map((zone) => {
    const worldCells = Array.isArray(zone?.worldCells) ? zone.worldCells : [];
    const validReferences = worldCells.every((cell) => (
      (cell.floorCellId && allFloorCellIds.has(String(cell.floorCellId)))
        || (cell.transferCellId && allTransferCellIds.has(String(cell.transferCellId)))
    ));
    const zoneId = String(zone.localZoneId ?? zone.id);
    const sourceZone = (blueprint?.zones ?? []).find(({ id }) => String(id) === zoneId);
    const reservedVoidClearance = worldCells.length === 0
      && String(sourceZone?.type) === 'clear'
      && (blueprint?.voids ?? []).some((record) => (
        blueprintFootprintsOverlap(sourceZone, record)
      ));
    const accepted = (worldCells.length > 0 && validReferences) || reservedVoidClearance;
    if (!accepted) errors.push(`realized-blueprint-zone-floor-coverage-invalid:${zoneId}`);
    return {
      zoneId,
      cellCount: worldCells.length,
      componentCount: componentCount(worldCells.map((cell) => (
        localTile(cell) ?? { x: NaN, z: NaN, elevation: NaN }
      )).filter(({ x, z, elevation }) => (
        Number.isFinite(x) && Number.isFinite(z) && Number.isFinite(elevation)
      ))),
      reservedVoidClearance,
      accepted,
    };
  }).sort((left, right) => left.zoneId.localeCompare(right.zoneId));

  const sourceFeatureById = new Map((blueprint?.features ?? []).map((feature) => (
    [String(feature.id), feature]
  )));
  for (const feature of room?.augmentationBlueprintFeatures ?? []) {
    const featureId = String(feature.localFeatureId ?? feature.id);
    const source = sourceFeatureById.get(featureId);
    if (!source
        || String(feature.blueprintFeatureType ?? feature.type) !== String(source.type)
        || !finiteWorldPoint(feature.position ?? feature.worldPosition)) {
      errors.push(`realized-blueprint-feature-invalid:${featureId}`);
    }
  }
  for (const transfer of room?.augmentationTransfers ?? []) {
    const transferId = String(transfer.localTransferId ?? transfer.id);
    const source = (blueprint?.physicalTransfers ?? []).find(({ id }) => (
      String(id) === transferId
    ));
    const endpointValues = Object.values(transfer.worldEndpoints ?? {});
    const expectedCellCount = Math.max(1, Math.trunc(numeric(
      source?.widthTiles ?? source?.footprintTiles?.width,
      1,
    ))) * Math.max(1, Math.trunc(numeric(
      source?.depthTiles ?? source?.footprintTiles?.depth,
      1,
    )));
    const accepted = Boolean(source)
      && transfer.bidirectional === true
      && (transfer.worldCells ?? []).length === expectedCellCount
      && (transfer.worldCells ?? []).every((cell) => finiteWorldPoint(
        cell.position ?? cell.worldPosition,
      ))
      && endpointValues.length === 2
      && endpointValues.every((endpoint) => finiteWorldPoint(
        endpoint.position ?? endpoint.worldPosition,
      ));
    if (!accepted) errors.push(`realized-blueprint-transfer-invalid:${transferId}`);
  }
  for (const record of room?.augmentationVoids ?? []) {
    const voidId = String(record.localVoidId ?? record.id);
    if (record.reservedVoid !== true
        || record.walkable !== false
        || !finiteWorldPoint(record.position ?? record.worldPosition)) {
      errors.push(`realized-blueprint-void-invalid:${voidId}`);
    }
  }
  for (const [kind, records] of [
    ['cover', room?.augmentationCover],
    ['landmark', room?.augmentationLandmarks],
    ['lighting', room?.augmentationLighting],
  ]) {
    if (!(records ?? []).every((record) => finiteWorldPoint(
      record.position ?? record.worldPosition,
    ))) errors.push(`realized-${kind}-world-projection-invalid`);
  }
  if (numeric(room?.ceilingHeight)
      < numeric(manifest?.structuralQuality?.camera?.minimumClearanceHeightMeters)) {
    errors.push('realized-camera-headroom-insufficient');
  }
  return {
    ...manifestReport,
    phase: 'realized-blueprint',
    blueprintId: declaredBlueprintId || null,
    accepted: errors.length === 0,
    errors: sortedUnique(errors),
    metrics: {
      ...manifestReport.metrics,
      requiredExitSocketIds: expected.socketIds,
      accessibleExitSocketIds: sortedUnique(accessibleExitSocketIds),
      zoneFloorCoverage,
      expectedRecordIds: expected,
      realizedRecordIds: actual,
      floorTierConnectivity,
      blueprintTraversalRoutes,
      realizedCeilingHeightMeters: numeric(room?.ceilingHeight, null),
    },
  };
}

function inspectEnclosureAndCamera(quality, { structure, clearanceVolumes }, errors) {
  const enclosure = quality?.enclosure;
  const camera = quality?.camera;
  const metadataAccepted = enclosure?.mode === 'sealed-room-shell'
    && enclosure?.aperturePolicy === 'active-sockets-only'
    && enclosure?.inactiveSocketPolicy === 'capped'
    && numeric(enclosure?.minimumCeilingHeightMeters) >= 5.6
    && Array.isArray(enclosure?.requiredStructureCollections)
    && enclosure.requiredStructureCollections.length > 0;
  if (!metadataAccepted) errors.push('invalid-enclosure-metadata');
  const cameraMetadataAccepted = numeric(camera?.minimumClearanceHeightMeters) >= 3.6
    && camera?.occlusionPolicy === 'camera-owned-enclosure-fade'
    && Array.isArray(camera?.protectedClearRouteIds)
    && camera.protectedClearRouteIds.length > 0;
  if (!cameraMetadataAccepted) errors.push('invalid-camera-metadata');

  let structureAccepted = null;
  if (structure !== undefined) {
    structureAccepted = Boolean(structure) && (
      enclosure?.requiredStructureCollections ?? []
    ).every((collection) => Array.isArray(structure?.[collection])
      && structure[collection].length > 0);
    const minimumCeilingHeight = numeric(enclosure?.minimumCeilingHeightMeters);
    structureAccepted = structureAccepted
      && (structure?.walls ?? []).every(({ height }) => numeric(height) >= minimumCeilingHeight)
      && (structure?.ceilings ?? []).every(({ elevation, height }) => (
        numeric(elevation ?? height) >= minimumCeilingHeight
      ));
    if (!structureAccepted) errors.push('enclosure-structure-incomplete');
  }

  let clearanceAccepted = null;
  if (clearanceVolumes !== undefined) {
    const minimumHeight = numeric(camera?.minimumClearanceHeightMeters);
    clearanceAccepted = Array.isArray(clearanceVolumes) && clearanceVolumes.some((volume) => (
      numeric(volume?.size?.x) > 0
        && numeric(volume?.size?.z) > 0
        && numeric(volume?.size?.y) >= minimumHeight
        && /clearance/i.test(String(volume?.purpose ?? ''))
    ));
    if (!clearanceAccepted) errors.push('camera-clearance-volume-missing');
  }
  return {
    metadataAccepted,
    structureAccepted,
    cameraMetadataAccepted,
    clearanceAccepted,
  };
}

export function inspectIndustrialSupplementManifestStructuralQuality(
  manifest,
  { structure, clearanceVolumes } = {},
) {
  const errors = [];
  const quality = manifest?.structuralQuality;
  if (quality?.schema !== INDUSTRIAL_SUPPLEMENT_STRUCTURAL_QUALITY_SCHEMA) {
    errors.push('missing-or-invalid-structural-quality-schema');
  }
  const floorIndex = floorCellsByElevation(manifest);
  const baseCells = maskCells(manifest?.floorMask, {
    x: -Math.floor(numeric(manifest?.layout?.dimensionsTiles?.width, 0) / 2),
    z: -Math.floor(numeric(manifest?.layout?.dimensionsTiles?.depth, 0) / 2),
  });
  const cover = Array.isArray(manifest?.cover) ? manifest.cover : [];
  const landmarks = Array.isArray(manifest?.landmarks) ? manifest.landmarks : [];
  const lighting = Array.isArray(manifest?.lighting) ? manifest.lighting : [];
  const anchors = Array.isArray(manifest?.anchors) ? manifest.anchors : [];
  const distribution = quality?.presentationDistribution ?? {};
  const presentation = [...cover, ...landmarks];
  const presentationGroups = new Map();
  for (const record of presentation) {
    const point = localTile(record);
    if (!point) {
      errors.push(`invalid-presentation-tile:${record?.id ?? 'unnamed'}`);
      continue;
    }
    const key = pointKey(point);
    const records = presentationGroups.get(key) ?? [];
    records.push(record);
    presentationGroups.set(key, records);
  }
  for (const [key, records] of presentationGroups) {
    if (records.length > numeric(distribution.maximumColocatedRecordsPerTile, 1)) {
      errors.push(`presentation-tile-overfilled:${key}`);
    }
    if (records.length > 1) {
      const groupIds = sortedUnique(records.map(({ assemblyGroupId }) => assemblyGroupId));
      if (groupIds.length !== 1 || records.some(({ assemblyGroupId }) => !assemblyGroupId)) {
        errors.push(`ungrouped-presentation-colocation:${key}`);
      }
    }
  }

  const coverSpanTiles = maximumPairwiseDistance(cover);
  const landmarkSpanTiles = maximumPairwiseDistance(landmarks);
  if (cover.length < numeric(distribution.minimumCoverCount, Infinity)) {
    errors.push('insufficient-cover-count');
  }
  if (landmarks.length < numeric(distribution.minimumLandmarkCount, Infinity)) {
    errors.push('insufficient-landmark-count');
  }
  if (presentationGroups.size < numeric(distribution.minimumDistinctTiles, Infinity)) {
    errors.push('insufficient-presentation-distribution');
  }
  if (coverSpanTiles < numeric(distribution.minimumCoverSpanTiles, Infinity)) {
    errors.push('insufficient-cover-span');
  }
  if (landmarkSpanTiles < numeric(distribution.minimumLandmarkSpanTiles, Infinity)) {
    errors.push('insufficient-landmark-span');
  }
  if (distribution.requireNonBlockingCover === true
      && !cover.some(({ blocksLineOfSight }) => blocksLineOfSight === false)) {
    errors.push('missing-nonblocking-cover');
  }

  const unsupportedRecords = [];
  for (const [kind, records] of [
    ['cover', cover],
    ['landmark', landmarks],
    ['anchor', anchors],
  ]) {
    for (const record of records) {
      const point = localTile(record);
      if (!point || !floorIndex.get(elevationKey(point.elevation))?.has(tileKey(point.x, point.z))) {
        unsupportedRecords.push(`${kind}:${record?.id ?? 'unnamed'}`);
      }
    }
  }
  if (unsupportedRecords.length > 0) errors.push(...unsupportedRecords.map((entry) => (
    `unsupported-local-record:${entry}`
  )));

  const featurePoints = [...cover, ...landmarks, ...lighting].map(localTile).filter(Boolean);
  let maximumDistanceToFeatureTiles = Infinity;
  let emptiestFloorCell = null;
  if (baseCells.length > 0 && featurePoints.length > 0) {
    maximumDistanceToFeatureTiles = -Infinity;
    for (const cell of baseCells) {
      const distance = Math.min(...featurePoints.map((point) => (
        Math.abs(point.x - cell.x) + Math.abs(point.z - cell.z)
      )));
      if (distance > maximumDistanceToFeatureTiles) {
        maximumDistanceToFeatureTiles = distance;
        emptiestFloorCell = tileKey(cell.x, cell.z);
      }
    }
  }
  const maximumAllowedDistance = numeric(
    quality?.emptyFloor?.maximumDistanceToFeatureTiles,
  );
  if (!Number.isFinite(maximumDistanceToFeatureTiles)
      || maximumDistanceToFeatureTiles > maximumAllowedDistance) {
    errors.push('empty-floor-radius-exceeded');
  }

  const zoneFloorCoverage = (manifest?.zones ?? []).map((zone) => {
    const cells = manifestZoneCells(manifest, zone, floorIndex);
    const components = componentCount(cells);
    const expectedComponents = Math.max(1, Math.trunc(numeric(zone.expectedComponentCount, 1)));
    const accepted = cells.length > 0 && components === expectedComponents;
    if (!accepted && (zone.validFor ?? []).length > 0) {
      errors.push(`zone-floor-coverage-invalid:${zone.id}`);
    }
    return {
      zoneId: String(zone.id),
      cellCount: cells.length,
      componentCount: components,
      expectedComponentCount: expectedComponents,
      accepted,
    };
  }).sort((left, right) => left.zoneId.localeCompare(right.zoneId));

  const clearRouteById = new Map((manifest?.clearRoutes ?? []).map((route) => (
    [String(route.id), route]
  )));
  const minimumExitWidth = numeric(quality?.minimumExitRouteWidthTiles);
  const accessibleExitSocketIds = [];
  for (const socketId of quality?.requiredExitSocketIds ?? []) {
    const accessible = (manifest?.clearRoutes ?? []).some((route) => (
      route.required === true
        && !route.requiredState
        && route.traversal === 'walk'
        && numeric(route.minimumClearWidthTiles) >= minimumExitWidth
        && (route.fromSocketIds ?? []).map(String).includes(String(socketId))
    ));
    if (accessible) accessibleExitSocketIds.push(String(socketId));
    else errors.push(`required-exit-route-missing:${socketId}`);
  }
  const requiredExitSocketIds = sortedUnique(quality?.requiredExitSocketIds ?? []);
  if (!sameStringArrays(accessibleExitSocketIds, requiredExitSocketIds)) {
    errors.push('required-exit-coverage-incomplete');
  }

  for (const routeId of quality?.camera?.protectedClearRouteIds ?? []) {
    const route = clearRouteById.get(String(routeId));
    if (!route || route.required !== true) errors.push(`camera-route-not-required:${routeId}`);
  }

  const landmarkById = new Map(landmarks.map((landmark) => [String(landmark.id), landmark]));
  const anchorById = new Map(anchors.map((anchor) => [String(anchor.id), anchor]));
  const blockingCover = cover.filter(({ blocksLineOfSight }) => blocksLineOfSight === true);
  const sightlines = (quality?.requiredSightlines ?? []).map((sightline) => {
    const targetRecord = landmarkById.get(String(sightline.targetLandmarkId))
      ?? anchorById.get(String(sightline.targetAnchorId));
    const target = localTile(targetRecord);
    const origins = boundaryOrigins(baseCells, sightline.fromBoundary);
    const routeIds = sortedUnique(sightline.requiredClearRouteIds ?? []);
    const routeReferencesAccepted = routeIds.length > 0 && routeIds.every((routeId) => (
      clearRouteById.get(routeId)?.required === true
    ));
    const sourceRouteAccepted = routeIds.some((routeId) => (
      clearRouteById.get(routeId)?.fromSocketIds?.map(String)
        .includes(String(sightline.fromSocketId))
    ));
    const blockerIds = new Set();
    let visibleOriginCount = 0;
    if (target) {
      for (const origin of origins) {
        const ray = lineCells(origin, target);
        const blockers = blockingCover.filter((record) => {
          const point = localTile(record);
          return point
            && !(point.x === target.x && point.z === target.z)
            && !(point.x === origin.x && point.z === origin.z)
            && ray.some((cell) => cell.x === point.x && cell.z === point.z);
        });
        if (blockers.length === 0) visibleOriginCount += 1;
        else blockers.forEach(({ id }) => blockerIds.add(String(id)));
      }
    }
    const accepted = Boolean(target)
      && routeReferencesAccepted
      && sourceRouteAccepted
      && visibleOriginCount >= Math.max(1, numeric(sightline.minimumVisibleOrigins, 1));
    if (!accepted) errors.push(`required-sightline-blocked:${sightline.id}`);
    return {
      sightlineId: String(sightline.id),
      targetId: String(sightline.targetLandmarkId ?? sightline.targetAnchorId ?? ''),
      originCount: origins.length,
      visibleOriginCount,
      blockerIds: [...blockerIds].sort(),
      routeReferencesAccepted,
      sourceRouteAccepted,
      accepted,
    };
  }).sort((left, right) => left.sightlineId.localeCompare(right.sightlineId));

  const enclosureAndCamera = inspectEnclosureAndCamera(
    quality,
    { structure, clearanceVolumes },
    errors,
  );
  return {
    schema: INDUSTRIAL_SUPPLEMENT_STRUCTURAL_QUALITY_REPORT_SCHEMA,
    phase: 'manifest',
    manifestId: manifest?.id ?? null,
    accepted: errors.length === 0,
    errors: sortedUnique(errors),
    metrics: {
      coverCount: cover.length,
      landmarkCount: landmarks.length,
      nonBlockingCoverCount: cover.filter(({ blocksLineOfSight }) => (
        blocksLineOfSight === false
      )).length,
      distinctPresentationTileCount: presentationGroups.size,
      coverSpanTiles,
      landmarkSpanTiles,
      unsupportedRecords: unsupportedRecords.sort(),
      maximumDistanceToFeatureTiles,
      maximumAllowedDistanceToFeatureTiles: maximumAllowedDistance,
      emptiestFloorCell,
      requiredExitSocketIds,
      accessibleExitSocketIds: sortedUnique(accessibleExitSocketIds),
      zoneFloorCoverage,
      sightlines,
      enclosureAndCamera,
    },
  };
}

export function inspectIndustrialSupplementRealizedStructuralQuality(
  room,
  { clearanceVolumes } = {},
) {
  const declaredBlueprintId = room?.augmentationBlueprintId
    ?? room?.augmentationPhysicalRealization?.blueprintId
    ?? null;
  if (declaredBlueprintId) {
    return inspectIndustrialSupplementBlueprintRealizedStructuralQuality(room, {
      clearanceVolumes,
    });
  }
  const manifest = room?.augmentationModuleManifest;
  const manifestReport = inspectIndustrialSupplementManifestStructuralQuality(manifest, {
    structure: room?.augmentationStructure?.sourceStructure
      ?? room?.augmentationStructureMetadata?.sourceStructure,
    clearanceVolumes,
  });
  const errors = [...manifestReport.errors];
  const expected = {
    floorTierIds: sortedUnique((manifest?.floorTiers ?? []).map(({ id }) => id)),
    clearRouteIds: sortedUnique((manifest?.clearRoutes ?? []).map(({ id }) => id)),
    zoneIds: sortedUnique((manifest?.zones ?? []).map(({ id }) => id)),
    coverIds: sortedUnique((manifest?.cover ?? []).map(({ id }) => id)),
    landmarkIds: sortedUnique((manifest?.landmarks ?? []).map(({ id }) => id)),
    lightingIds: sortedUnique((manifest?.lighting ?? []).map(({ id }) => id)),
    anchorIds: sortedUnique((manifest?.anchors ?? []).map(({ id }) => id)),
  };
  const actual = {
    floorTierIds: collectionIds(room?.augmentationFloorTiers, 'localTierId'),
    clearRouteIds: collectionIds(room?.augmentationClearRoutes, 'localRouteId'),
    zoneIds: collectionIds(room?.augmentationZones, 'localZoneId'),
    coverIds: collectionIds(room?.augmentationCover, 'localCoverId'),
    landmarkIds: collectionIds(room?.augmentationLandmarks, 'localLandmarkId'),
    lightingIds: collectionIds(room?.augmentationLighting, 'localLightingId'),
    anchorIds: sortedUnique((room?.augmentationAnchors ?? [])
      .map(({ localAnchorId }) => localAnchorId)
      .filter(Boolean)),
  };
  for (const key of Object.keys(expected)) {
    if (!sameStringArrays(expected[key], actual[key])) {
      errors.push(`realized-${key}-mismatch`);
    }
  }
  if (JSON.stringify(room?.augmentationFloorMask) !== JSON.stringify(manifest?.floorMask)) {
    errors.push('realized-floor-mask-mismatch');
  }
  const routeById = new Map((room?.augmentationClearRoutes ?? []).map((route) => (
    [String(route.localRouteId ?? route.id), route]
  )));
  for (const route of manifest?.clearRoutes ?? []) {
    const realized = routeById.get(String(route.id));
    const realizedSocketIds = sortedUnique((realized?.fromSocketBindings ?? []).map((binding) => (
      binding.localSocketId
    )));
    if (!realized
        || !sameStringArrays(realizedSocketIds, route.fromSocketIds ?? [])
        || !Array.isArray(realized.worldCellIds)
        || realized.worldCellIds.length === 0) {
      errors.push(`realized-clear-route-invalid:${route.id}`);
    }
  }
  const zoneMetricById = new Map(manifestReport.metrics.zoneFloorCoverage.map((metric) => (
    [metric.zoneId, metric]
  )));
  for (const zone of room?.augmentationZones ?? []) {
    const metric = zoneMetricById.get(String(zone.localZoneId ?? zone.id));
    if (!metric || zone.worldCells?.length !== metric.cellCount) {
      errors.push(`realized-zone-floor-coverage-mismatch:${zone.localZoneId ?? zone.id}`);
    }
  }
  for (const [kind, records] of [
    ['cover', room?.augmentationCover],
    ['landmark', room?.augmentationLandmarks],
    ['lighting', room?.augmentationLighting],
  ]) {
    if (!(records ?? []).every(({ position }) => (
      Number.isFinite(Number(position?.x))
        && Number.isFinite(Number(position?.y))
        && Number.isFinite(Number(position?.z))
    ))) errors.push(`realized-${kind}-world-projection-invalid`);
  }
  if (numeric(room?.ceilingHeight) < numeric(manifest?.structuralQuality?.camera?.minimumClearanceHeightMeters)) {
    errors.push('realized-camera-headroom-insufficient');
  }
  return {
    ...manifestReport,
    phase: 'realized',
    accepted: errors.length === 0,
    errors: sortedUnique(errors),
    metrics: {
      ...manifestReport.metrics,
      expectedRecordIds: expected,
      realizedRecordIds: actual,
      realizedCeilingHeightMeters: numeric(room?.ceilingHeight, null),
    },
  };
}
