import { expect, test } from '@playwright/test';
import {
  createDungeonAugmentationCompleteLayoutSignature,
} from '../src/dungeon-augmentation/varietySignature.js';
import {
  abandonExpeditionThroughEntrance,
  beginBossExpedition,
  readWorldDiagnostics,
  waitForOverworldAssetsSettled,
  waitForWorld,
} from './helpers/overworld-runtime.js';

const INDUSTRIAL_PROFILE_ID = 'industrial-supplement-preview-v4';
const INDUSTRIAL_THEME_ID = 'industrial-v1';
const INDUSTRIAL_THEME_REVISION = 'industrial-v1-presentation-r1';
const SAVE_IDENTITY_SCHEMA = 'ruindivex-dungeon-augmentation-save-identity/v1';

function captureRuntimeErrors(page) {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  return { pageErrors, consoleErrors };
}

async function waitForDungeon(page, runtimeErrors, timeout = 120_000) {
  try {
    await expect.poll(
      () => page.locator('#game-container').getAttribute('data-browser-test-ready'),
      { timeout },
    ).toBe('true');
    await expect.poll(
      () => page.evaluate(() => Boolean(window.game?.dungeon?.group)),
      { timeout: 15_000 },
    ).toBe(true);
  } catch (error) {
    throw new Error([
      error.message,
      ...runtimeErrors.pageErrors.map((message) => `pageerror: ${message}`),
      ...runtimeErrors.consoleErrors.map((message) => `console: ${message}`),
    ].join('\n'));
  }
}

async function waitForDungeonPresentationAssets(page, timeout = 20_000) {
  await expect.poll(
    () => page.evaluate(() => {
      const group = window.game?.dungeon?.group;
      if (!group) return false;
      const modelSettled = (name) => {
        const anchor = group.getObjectByName(name);
        return !anchor || (
          anchor.userData.modelLoading === false
          && Boolean(anchor.userData.modelLoaded || anchor.userData.modelLoadError)
        );
      };
      const workbench = group.getObjectByName('rollWorkshopWorkbench');
      const workbenchSettled = !workbench || (
        workbench.userData.textureLoading === false
        && workbench.userData.textureAssetsSettled === true
      );
      let pendingPresentationLoad = false;
      group.traverse((object) => {
        if (object.userData.modelLoading || object.userData.textureLoading) {
          pendingPresentationLoad = true;
        }
      });
      return modelSettled('rollCaskettNpc')
        && modelSettled('expeditionSupportCar')
        && workbenchSettled
        && !pendingPresentationLoad;
    }),
    { timeout },
  ).toBe(true);
  await page.evaluate(() => new Promise((resolve) => (
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  )));
}

async function readLegacySnapshot(page) {
  return page.evaluate(() => {
    const { game } = window;
    const dungeon = game.dungeon;
    const diagnostics = game.getWorldTransitionDiagnostics();
    return {
      groupName: dungeon.group.name,
      basePlanHash: dungeon.basePlanHash ?? null,
      augmentationPlanHash: dungeon.augmentationPlanHash ?? null,
      effectivePlanHash: dungeon.effectivePlanHash ?? null,
      activePlanHash: game.activeWorldBundle?.planHash ?? null,
      augmentationStatus: dungeon.augmentationStatus ?? null,
      augmentationIdentity: dungeon.augmentationIdentity ?? null,
      augmentationOverlayPlan: dungeon.augmentationOverlayPlan ?? null,
      diagnostics: diagnostics.dungeonAugmentation,
      supplementRootCount: dungeon.group.children.filter((child) => (
        child.name === 'DungeonSupplementRoot'
        || child.userData?.dungeonSupplementRoot === true
      )).length,
      supplementalRoomCount: dungeon.rooms.filter((room) => room.isDungeonSupplement).length,
      rooms: dungeon.rooms
        .map((room) => ({
          id: room.id,
          type: room.type,
          x: room.x,
          z: room.z,
          width: room.width,
          depth: room.depth,
          baseElevation: Number(room.baseElevation ?? 0),
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      connections: dungeon.connectionPlans
        .map((connection) => ({
          id: connection.id,
          logicalConnectionId: connection.logicalConnectionId ?? null,
          fromRoomId: connection.fromRoomId,
          toRoomId: connection.toRoomId,
          doorId: connection.doorId ?? null,
          connectorVariantId: connection.connectorVariantId ?? null,
          fullPath: (connection.fullPath ?? []).map(({ x, z }) => ({ x, z })),
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    };
  });
}

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.game?.stop?.()).catch(() => {});
});

test('default and explicit off preserve the exact legacy dungeon facade and hashes', async ({ page }) => {
  test.setTimeout(240_000);
  const runtimeErrors = captureRuntimeErrors(page);
  const seedQuery = 'startupWorld=dungeon&busterLab=sandbox&dungeonSeed=augmentation-off-runtime';

  await page.goto(`/?${seedQuery}`);
  await waitForDungeon(page, runtimeErrors);
  const defaultSnapshot = await readLegacySnapshot(page);

  await page.evaluate(() => window.game.stop());
  await page.goto(`/?${seedQuery}&dungeonAugmentation=off`);
  await waitForDungeon(page, runtimeErrors);
  const explicitOffSnapshot = await readLegacySnapshot(page);

  expect(explicitOffSnapshot).toEqual(defaultSnapshot);
  expect(defaultSnapshot.rooms).toHaveLength(13);
  expect(defaultSnapshot.basePlanHash).toBeTruthy();
  expect(defaultSnapshot.effectivePlanHash).toBe(defaultSnapshot.basePlanHash);
  expect(defaultSnapshot.activePlanHash).toBe(defaultSnapshot.basePlanHash);
  expect(defaultSnapshot.augmentationPlanHash).toBeNull();
  expect(defaultSnapshot.augmentationStatus).toBeNull();
  expect(defaultSnapshot.augmentationIdentity).toBeNull();
  expect(defaultSnapshot.augmentationOverlayPlan).toBeNull();
  expect(defaultSnapshot.supplementRootCount).toBe(0);
  expect(defaultSnapshot.supplementalRoomCount).toBe(0);
  expect(defaultSnapshot.diagnostics).toMatchObject({
    status: 'disabled',
    profileId: null,
    basePlanHash: defaultSnapshot.basePlanHash,
    augmentationPlanHash: null,
    effectivePlanHash: defaultSnapshot.basePlanHash,
  });
});

test('opt-in Industrial preview assembles the deterministic inherited sidecar', async ({ page }) => {
  test.setTimeout(240_000);
  const runtimeErrors = captureRuntimeErrors(page);

  await page.goto([
    '/?startupWorld=dungeon',
    'busterLab=sandbox',
    'dungeonSeed=augmentation-runtime-check',
    'dungeonAugmentation=preview',
  ].join('&'));
  await waitForDungeon(page, runtimeErrors, 180_000);

  const snapshot = await page.evaluate(() => {
    const { game } = window;
    const dungeon = game.dungeon;
    const supplementRoot = dungeon.dungeonSupplementRoot ?? dungeon.supplementRoot ?? null;
    const supplementRooms = dungeon.rooms
      .filter((room) => room.isDungeonSupplement)
      .sort((left, right) => left.id.localeCompare(right.id));
    const routeStationProxies = [...(dungeon.connectorJunctionProxies ?? [])]
      .sort((left, right) => left.id.localeCompare(right.id));
    const leakedRouteStationProxies = dungeon.rooms.filter((room) => (
      room.isRouteStationProxy === true || room.isConnectorJunctionProxy === true
    ));
    const authoredRooms = dungeon.rooms.filter((room) => !room.isDungeonSupplement);
    const supplementRoomIds = supplementRooms.map((room) => room.id);
    const supplementRoomIdSet = new Set(supplementRoomIds);
    const routeStationProxyIdSet = new Set(routeStationProxies.map((room) => room.id));
    const supplementConnections = dungeon.connectionPlans.filter((connection) => (
      connection.isDungeonSupplement
    ));
    const minimapRooms = dungeon.minimap?.rooms ?? [];
    const minimapRoomIds = minimapRooms
      .map((room) => room.roomId ?? room.id)
      .filter((roomId) => supplementRoomIdSet.has(roomId))
      .sort();
    const minimapProxyRoomIds = minimapRooms
      .map((room) => room.roomId ?? room.id)
      .filter((roomId) => routeStationProxyIdSet.has(roomId))
      .sort();
    const allMinimapHallways = dungeon.minimap?.hallways ?? dungeon.minimap?.connections ?? [];
    const minimapHallways = allMinimapHallways
      .filter((hallway) => {
        const from = hallway.fromRoomId ?? hallway.fromNodeId ?? hallway.from;
        const to = hallway.toRoomId ?? hallway.toNodeId ?? hallway.to;
        return supplementRoomIdSet.has(from) || supplementRoomIdSet.has(to);
      });
    const minimapHallwayProxyRoomIds = allMinimapHallways
      .flatMap((hallway) => [
        hallway.fromRoomId ?? hallway.fromNodeId ?? hallway.from,
        hallway.toRoomId ?? hallway.toNodeId ?? hallway.to,
      ])
      .filter((roomId) => routeStationProxyIdSet.has(roomId))
      .sort();
    const supplementEncounters = (dungeon.encounters ?? []).filter((encounter) => (
      encounter.isDungeonSupplement
      || supplementRoomIdSet.has(encounter.roomId)
    ));
    const supplementChests = (dungeon.chests ?? []).filter((chest) => (
      supplementRoomIdSet.has(chest.roomId)
    ));
    const supplementTraps = (dungeon.traps ?? []).filter((trap) => (
      trap.isDungeonSupplement
      || supplementRoomIdSet.has(trap.roomId)
    ));
    const encounterProxyRoomIds = (dungeon.encounters ?? [])
      .map((record) => record.roomId ?? record.nodeId ?? record.ownerRoomId)
      .filter((roomId) => routeStationProxyIdSet.has(roomId))
      .sort();
    const rewardProxyRoomIds = [
      ...(dungeon.rewards ?? []),
      ...(dungeon.chests ?? []),
    ].map((record) => record.roomId ?? record.nodeId ?? record.ownerRoomId)
      .filter((roomId) => routeStationProxyIdSet.has(roomId))
      .sort();

    const supplementObjects = new Set();
    supplementRoot?.traverse((object) => supplementObjects.add(object));
    const outsideSupplementOwners = [];
    const supplementMaterials = new Map();
    const supplementMaterialOwners = new Map();
    const parentMaterials = new Set();
    const assetCatalogIds = [];
    const boundThemeIds = [];
    let supplementLightCount = 0;
    const addMaterials = (target, material) => {
      for (const entry of (Array.isArray(material) ? material : [material])) {
        if (!entry) continue;
        if (target instanceof Map) target.set(entry.uuid, entry.name || entry.type || entry.uuid);
        else target.add(entry.uuid);
      }
    };
    supplementRoot?.traverse((object) => {
      if (object.isLight) supplementLightCount += 1;
      if (object.isMesh) {
        addMaterials(supplementMaterials, object.material);
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (!material) continue;
          const owners = supplementMaterialOwners.get(material.uuid) ?? [];
          owners.push(object.name || object.type || object.uuid);
          supplementMaterialOwners.set(material.uuid, owners);
        }
      }
      if (object.userData?.parentAssetCatalogId) {
        assetCatalogIds.push(object.userData.parentAssetCatalogId);
      }
      const themeId = object.userData?.themeBinding?.themeRef?.id;
      if (themeId) boundThemeIds.push(themeId);
    });
    dungeon.group.traverse((object) => {
      if (!supplementObjects.has(object) && object.isMesh) {
        addMaterials(parentMaterials, object.material);
      }
      if (supplementObjects.has(object)) return;
      const directOwners = [
        object.userData?.augmentationOwnerId,
        object.userData?.roomId,
        object.userData?.connectorId,
      ].filter(Boolean);
      if (directOwners.some((ownerId) => String(ownerId).startsWith('supplement:'))) {
        outsideSupplementOwners.push(object.name || object.uuid);
      }
    });
    const foreignSupplementMaterials = [...supplementMaterials]
      .filter(([uuid]) => !parentMaterials.has(uuid))
      .map(([uuid, name]) => ({
        name,
        owners: [...new Set(supplementMaterialOwners.get(uuid) ?? [])].sort(),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const resourceCounts = dungeon.dungeonSupplement
      ?.diagnostics?.assembled?.resourceCounts ?? null;
    const identity = dungeon.augmentationIdentity ?? null;
    const overlay = dungeon.augmentationOverlayPlan ?? null;
    const diagnostics = game.getWorldTransitionDiagnostics().dungeonAugmentation;
    const routeNetworks = (overlay?.operations ?? []).filter(({ type }) => (
      type === 'routeNetwork'
    ));
    const parentAnchoredNetworks = routeNetworks.filter(({ realizationMode }) => (
      realizationMode === 'parent-anchored-forest'
    ));
    const fullyRealizedNetworks = routeNetworks.filter(({ realizationMode }) => (
      realizationMode !== 'parent-anchored-forest'
    ));
    const minimumPhysicalSupplementConnectionCount = fullyRealizedNetworks.length * 2
      + parentAnchoredNetworks.length;
    const minimumSupplementRoomCount = fullyRealizedNetworks.length * 2;
    const minimumSubstantiveModuleCount = fullyRealizedNetworks.length * 3;
    const routeNetworkGrantIds = routeNetworks.map(({ grantId }) => String(grantId ?? ''));
    const routeNetworkGrantManifestAccepted = routeNetworkGrantIds.every(Boolean)
      && new Set(routeNetworkGrantIds).size === routeNetworks.length
      && JSON.stringify(overlay?.routeNetworkGrantIds ?? [])
        === JSON.stringify(routeNetworks.map(({ grantId }) => grantId));
    const coverageNetworks = routeNetworks.filter(({ routeNetworkKind }) => (
      routeNetworkKind === 'objective-route-coverage'
    ));
    const salvagedCoverageNetworks = coverageNetworks.filter(({ realizationMode }) => (
      realizationMode === 'parent-anchored-forest'
    ));
    const realizedCoverageNetworks = coverageNetworks.filter(({ realizationMode }) => (
      realizationMode !== 'parent-anchored-forest'
    ));
    const coverageWitnessesAccepted = coverageNetworks.length > 0
      && coverageNetworks.every(({ coverage }) => (
        coverage?.coverageComplete === true
          && String(coverage.logicalEdgeId ?? '').length > 0
          && Array.isArray(coverage.ordinaryTraversalSpans)
          && coverage.ordinaryTraversalSpans.length > 0
          && Array.isArray(coverage.stationDistancesMeters)
          && coverage.stationDistancesMeters.length >= 2
          && Array.isArray(coverage.featurelessSpansMeters)
          && coverage.featurelessSpansMeters.length > 0
          && coverage.featurelessSpansMeters.every((distanceMeters) => (
            Number.isFinite(Number(distanceMeters))
              && Number(distanceMeters) >= 0
              && Number(distanceMeters) <= 33.6 + 1e-6
          ))
      ))
      && salvagedCoverageNetworks.every(({ authoredCoverageRealized }) => (
        authoredCoverageRealized === false
      ))
      && JSON.stringify((overlay?.featurelessCoverage ?? [])
        .map(({ operationId }) => operationId).sort())
        === JSON.stringify(realizedCoverageNetworks.map(({ id }) => id).sort());
    const featurelessWitnessesAccepted = routeNetworks.every((operation) => (
      Array.isArray(operation.featurelessSpans)
        && operation.featurelessSpans.length > 0
        && operation.featurelessSpans.every(({ distanceMeters }) => (
          Number.isFinite(Number(distanceMeters))
            && Number(distanceMeters) >= 0
            && Number(distanceMeters) <= 33.6 + 1e-6
        ))
    ));
    const featurelessSpans = routeNetworks.flatMap((operation) => (
      operation.featurelessSpans ?? []
    )).map(({ distanceMeters }) => Number(distanceMeters));
    const pyramidLoop = routeNetworks.find(({ routeNetworkKind }) => (
      routeNetworkKind === 'landmark-perimeter-loop'
    ));
    const topologyTemplateIds = [...new Set(routeNetworks
      .map(({ topologyTemplateId }) => topologyTemplateId)
      .filter(Boolean))].sort();
    const topologyTemplateSequence = routeNetworks
      .map(({ topologyTemplateId }) => topologyTemplateId ?? null);
    const junctionKinds = [...new Set(routeNetworks
      .flatMap((operation) => operation.junctionKinds ?? []))].sort();
    const fullyRealizedJunctionKinds = [...new Set(fullyRealizedNetworks
      .flatMap((operation) => operation.junctionKinds ?? []))].sort();
    const elevationModes = [...new Set(routeNetworks
      .flatMap((operation) => operation.elevationModes ?? []))].sort();
    const fullyRealizedElevationModes = [...new Set(fullyRealizedNetworks
      .flatMap((operation) => operation.elevationModes ?? []))].sort();
    const elevationModeSequence = routeNetworks
      .map((operation) => operation.elevationModes?.[0] ?? null);
    const isGraphOnlyConnection = (plan) => Boolean(
      plan.isSupplementGraphConnection
      || plan.graphOnly === true
      || plan.connectorVariantConstraints?.graphOnly === true
    );
    const graphOnlyConnections = dungeon.connectionPlans.filter(isGraphOnlyConnection);
    const graphOnlyConnectionIds = new Set(graphOnlyConnections.map(({ id }) => id));
    const minimapGraphOnlyConnectionIds = allMinimapHallways
      .map((hallway) => (
        hallway.hallwayId ?? hallway.connectionId ?? hallway.connectorId ?? hallway.id
      ))
      .filter((connectionId) => graphOnlyConnectionIds.has(connectionId))
      .sort();
    const physicalSupplementConnections = dungeon.connectionPlans.filter((plan) => (
      plan.isDungeonSupplement && !isGraphOnlyConnection(plan)
    ));
    const physicalSupplementConnectionIds = new Set(
      physicalSupplementConnections.map(({ id }) => id),
    );
    const shortcutConnectionIds = physicalSupplementConnections
      .filter((plan) => plan.oneSideActivatedShortcut || plan.shortcutMode)
      .map(({ id }) => id)
      .sort();
    const supplementRoomById = new Map(supplementRooms.map((room) => [room.id, room]));
    const connectorProxyById = new Map(routeStationProxies.map((room) => [room.id, room]));
    const junctionMetadataRoomById = new Map([
      ...supplementRooms,
      ...routeStationProxies,
    ].map((room) => [room.id, room]));
    const overlayNodes = overlay?.nodes ?? [];
    const overlayRoomNodes = overlayNodes.filter(({ kind }) => kind === 'supplementRoom');
    const overlayConnectorModuleNodes = overlayNodes.filter(({ kind }) => (
      kind === 'supplementConnectorModule'
    ));
    const overlayConnectorJunctionNodes = overlayNodes.filter(({ kind }) => (
      kind === 'supplementConnectorJunction'
    ));
    const overlayConnectorNodes = [
      ...overlayConnectorModuleNodes,
      ...overlayConnectorJunctionNodes,
    ];
    const overlayRoomNodeIdSet = new Set(overlayRoomNodes.map(({ id }) => id));
    const overlayNodeById = new Map(overlayNodes.map((node) => [node.id, node]));
    const overlayOperationById = new Map(routeNetworks.map((operation) => [operation.id, operation]));
    const overlaySubstantiveModuleCount = routeNetworks.reduce((count, operation) => (
      count + Number(operation.substantiveModuleCount ?? operation.moduleCount ?? 0)
    ), 0);
    const overlayPhysicalArmIdsByNodeId = new Map(overlayConnectorNodes.map(({ id }) => (
      [id, new Set()]
    )));
    for (const segment of overlay?.segments ?? []) {
      for (const endpoint of [segment.from, segment.to]) {
        if (overlayPhysicalArmIdsByNodeId.has(endpoint?.nodeId)) {
          overlayPhysicalArmIdsByNodeId.get(endpoint.nodeId).add(String(segment.id));
        }
      }
    }
    // An exact objective-corridor station is one composite T: two explicit
    // supplemental approaches plus the parent corridor's authored through
    // route. Keep that contribution visible in the semantic arm set, but do
    // not invent a third supplemental connection or local floor approach.
    for (const node of overlayConnectorJunctionNodes) {
      if (node.exactParentEndpoint !== true
        || node.parentEndpointSocketKind !== 'authored-corridor-station') continue;
      const contribution = Math.min(
        1,
        Math.max(0, Number(node.parentThroughRouteDegreeContribution ?? 0)),
      );
      for (let index = 0; index < contribution; index += 1) {
        overlayPhysicalArmIdsByNodeId.get(node.id)
          ?.add(String(
            node.parentThroughPhysicalArmId ?? `${node.id}:authored-through:${index}`,
          ));
      }
    }
    const floorExistsAt = (point, elevation) => dungeon.floorTiles.some((tile) => (
      tile.x === point?.x
      && tile.z === point?.z
      && Math.abs(Number(tile.elevation ?? 0) - Number(elevation ?? 0)) <= 0.56
    ));
    const realizedJunctionCandidateIds = [...new Set([
      ...overlayConnectorNodes.map(({ id }) => id),
      ...overlayRoomNodes
        .filter((node) => (
          Number(node.graphDegree ?? node.junction?.graphDegree ?? 0) >= 3
            && node.junction?.countsAsMeaningfulStation === true
        ))
        .map(({ id }) => id),
      ...routeStationProxies.map(({ id }) => id),
    ])];
    const inspectParentRouteArms = (room) => {
      if (room?.isRouteStationProxy !== true) {
        return { accepted: false, parentPlan: null };
      }
      const parentPlan = dungeon.connectionPlans.find((plan) => (
        plan.id === room.parentRouteId && !isGraphOnlyConnection(plan)
      ));
      const parentPath = parentPlan?.bridgePath ?? parentPlan?.fullPath ?? [];
      const stationPathIndex = parentPath.findIndex((point) => (
        point.x === room.x && point.z === room.z
      ));
      const previous = parentPath[stationPathIndex - 1];
      const station = parentPath[stationPathIndex];
      const next = parentPath[stationPathIndex + 1];
      return {
        parentPlan,
        accepted: Boolean(
          parentPlan
          && stationPathIndex > 0
          && stationPathIndex < parentPath.length - 1
          && (previous.x !== station.x || previous.z !== station.z)
          && (next.x !== station.x || next.z !== station.z)
          && (previous.x !== next.x || previous.z !== next.z)
          && floorExistsAt(previous, room.baseElevation)
          && floorExistsAt(station, room.baseElevation)
          && floorExistsAt(next, room.baseElevation)
        ),
      };
    };
    const realizedNetworkJunctionChecks = realizedJunctionCandidateIds.map((nodeId) => {
      const node = overlayNodeById.get(nodeId) ?? null;
      const room = junctionMetadataRoomById.get(nodeId);
      const operationId = node?.operationId ?? room?.augmentationOperationId ?? null;
      const operation = overlayOperationById.get(operationId);
      const approachIds = new Set();
      for (const plan of physicalSupplementConnections.filter((candidate) => (
        candidate.augmentationOperationId === operationId
      ))) {
        if (plan.fromRoomId === nodeId && plan.fromSocket?.roomId === nodeId) {
          approachIds.add([
            'physical',
            Number(plan.fromSocket.x),
            Number(plan.fromSocket.z),
            Number(plan.fromSocket.elevation ?? plan.sourceElevation ?? 0).toFixed(3),
          ].join(':'));
        }
        if (plan.toRoomId === nodeId && plan.toSocket?.roomId === nodeId) {
          approachIds.add([
            'physical',
            Number(plan.toSocket.x),
            Number(plan.toSocket.z),
            Number(plan.toSocket.elevation ?? plan.destinationElevation ?? 0).toFixed(3),
          ].join(':'));
        }
      }
      let parentRouteArmsRealized = false;
      if (room?.isRouteStationProxy) {
        const parentRoute = inspectParentRouteArms(room);
        const parentPlan = parentRoute.parentPlan;
        parentRouteArmsRealized = parentRoute.accepted;
        if (parentRouteArmsRealized) {
          approachIds.add(`parent-route:${parentPlan.id}:source-arm`);
          approachIds.add(`parent-route:${parentPlan.id}:destination-arm`);
        }
      }
      const exactParentStationComposite = room?.isExactParentStationComposite === true;
      let exactParentStationCompositeBound = !exactParentStationComposite;
      let parentStationProxyId = null;
      if (exactParentStationComposite) {
        const attachment = physicalSupplementConnections.find((plan) => (
          plan.networkRole === 'parent-station-attachment'
          && (plan.fromRoomId === nodeId || plan.toRoomId === nodeId)
        ));
        parentStationProxyId = attachment
          ? (attachment.fromRoomId === nodeId ? attachment.toRoomId : attachment.fromRoomId)
          : null;
        const parentStationProxy = junctionMetadataRoomById.get(parentStationProxyId);
        const parentRoute = inspectParentRouteArms(parentStationProxy);
        exactParentStationCompositeBound = Boolean(
          attachment
          && parentStationProxy
          && parentRoute.accepted
          && String(parentStationProxy.routeNetworkSocketId ?? '')
            === String(room.parentEndpointSocketId ?? ''),
        );
        if (exactParentStationCompositeBound) {
          approachIds.add(`parent-route:${parentRoute.parentPlan.id}:authored-through`);
        }
      }
      const actualDegree = approachIds.size;
      const overlayJunction = node?.junction ?? null;
      const runtimeJunction = room?.augmentationJunction ?? room?.junction ?? null;
      return {
        nodeId,
        nodeKind: node?.kind ?? null,
        operationId,
        operationContainsNode: Boolean(
          operation?.nodeIds?.includes(nodeId)
          || (room?.isRouteStationProxy && operationId === operation?.id)
        ),
        actualDegree,
        approachIds: [...approachIds].sort(),
        routeStationProxy: room?.isRouteStationProxy === true,
        parentRouteArmsRealized,
        exactParentStationComposite,
        exactParentStationCompositeBound,
        parentStationProxyId,
        overlayMeaningful: room?.isRouteStationProxy === true && !node
          ? true
          : Number(node?.graphDegree ?? node?.junction?.graphDegree ?? 0) >= 3
            && node?.countsAsMeaningfulStation === true
            && overlayJunction?.countsAsMeaningfulStation === true,
        runtimeMeaningful: room?.countsAsMeaningfulStation === true
          && runtimeJunction?.countsAsMeaningfulStation === true,
        runtimeJunctionKind: runtimeJunction?.junctionKind ?? null,
      };
    });
    const actualNetworkNodeDegrees = Object.fromEntries(realizedNetworkJunctionChecks
      .map(({ nodeId, actualDegree }) => [nodeId, actualDegree]));
    const overlayConnectorProxyChecks = overlayConnectorNodes.map((node) => {
      const proxy = connectorProxyById.get(node.id) ?? null;
      const expectedArmIds = [...(
        overlayPhysicalArmIdsByNodeId.get(node.id) ?? []
      )].sort();
      const realizedArmIds = [...(proxy?.physicalArmIds ?? [])].sort();
      const coreFloors = dungeon.floorTiles.filter((tile) => (
        tile.connectorJunctionOwnerId === node.id
      ));
      const coreWidth = Math.max(3, Math.round(Number(proxy?.width ?? 0)));
      const coreDepth = Math.max(3, Math.round(Number(proxy?.depth ?? 0)));
      const expectedCoreFloorCount = proxy
        ? (Math.floor(coreWidth / 2) * 2 + 1)
          * (Math.floor(coreDepth / 2) * 2 + 1)
        : 0;
      const exactParentStationComposite = proxy?.isExactParentStationComposite === true;
      const requiredApproachCount = node.kind === 'supplementConnectorModule'
        || exactParentStationComposite
        ? 2
        : 3;
      return {
        nodeId: node.id,
        kind: node.kind,
        materializedOnlyAsProxy: Boolean(
          proxy
            && !supplementRoomById.has(node.id)
            && proxy.isConnectorJunctionProxy === true
            && proxy.suppressRoomGeometry === true
        ),
        expectedArmIds,
        realizedArmIds,
        physicalArmCount: Number(proxy?.physicalArmCount ?? 0),
        actualApproachCount: Number(actualNetworkNodeDegrees[node.id] ?? 0),
        requiredApproachCount,
        exactParentStationComposite,
        parentThroughPhysicalArmId: node.parentThroughPhysicalArmId ?? null,
        meaningful: proxy?.countsAsMeaningfulStation === true,
        coreFloorCount: coreFloors.length,
        expectedCoreFloorCount,
      };
    });
    const realizedMeaningfulJunctions = realizedNetworkJunctionChecks.filter((check) => (
      check.operationContainsNode
      && check.nodeKind === 'supplementConnectorJunction'
      && check.actualDegree >= 3
      && check.overlayMeaningful
      && check.runtimeMeaningful
      && Boolean(check.runtimeJunctionKind)
      && (!check.exactParentStationComposite || check.exactParentStationCompositeBound)
      && (!check.routeStationProxy || check.parentRouteArmsRealized)
    ));
    const actualJunctionKinds = [...new Set(realizedMeaningfulJunctions
      .map(({ runtimeJunctionKind }) => runtimeJunctionKind))].sort();
    const supplementRoomOwnedFloorCounts = Object.fromEntries(supplementRooms.map((room) => [
      room.id,
      dungeon.floorTiles.filter((tile) => tile.roomId === room.id).length,
    ]));
    const supplementRoomFootprintChecks = overlayRoomNodes.map((node) => {
      const room = supplementRoomById.get(node.id) ?? null;
      const floorMask = Array.isArray(room?.augmentationFloorMask)
        ? room.augmentationFloorMask.map((row) => String(row ?? ''))
        : [];
      const maskWidth = floorMask.length > 0
        ? Math.max(...floorMask.map((row) => row.length))
        : 0;
      const maskDepth = floorMask.length;
      const floorMaskCellCount = floorMask.reduce((count, row) => (
        count + [...row].filter((cell) => cell === '#').length
      ), 0);
      const turns = ((Math.trunc(Number(room?.augmentationRotationQuarterTurns ?? 0)) % 4) + 4) % 4;
      const expectedWidth = turns % 2 === 1 ? maskDepth : maskWidth;
      const expectedDepth = turns % 2 === 1 ? maskWidth : maskDepth;
      const spans = [Number(room?.width ?? 0), Number(room?.depth ?? 0)]
        .sort((left, right) => left - right);
      return {
        nodeId: node.id,
        materializedAsRoom: Boolean(room),
        leakedAsProxy: connectorProxyById.has(node.id),
        shortSpanTiles: spans[0],
        longSpanTiles: spans[1],
        floorMaskCellCount,
        moduleTemplateId: room?.augmentationModuleTemplateId ?? null,
        moduleKind: room?.augmentationModuleKind ?? null,
        accepted: Boolean(room)
          && floorMaskCellCount > 0
          && Number(room.width) === expectedWidth
          && Number(room.depth) === expectedDepth
          && room.augmentationModuleKind !== 'connector',
      };
    });
    const physicalSupplementFloorOwnership = physicalSupplementConnections.map((plan) => {
      const path = plan.bridgePath ?? plan.fullPath ?? [];
      const ownedFloorCount = dungeon.floorTiles.filter((tile) => (
        tile.signedConnectorFloorOwnerId === plan.id
        || tile.connectorId === plan.id
        || tile.connectionId === plan.id
      )).length;
      const sharedThresholdRoomFloorCount = plan.isSharedThresholdConnection
        ? dungeon.floorTiles.filter((tile) => (
          path.some((point) => point.x === tile.x && point.z === tile.z)
          && [plan.fromRoomId, plan.toRoomId].includes(tile.roomId)
        )).length
        : 0;
      return {
        connectionId: plan.id,
        ownedFloorCount,
        sharedThresholdRoomFloorCount,
        hasRealizedOwner: ownedFloorCount > 0 || sharedThresholdRoomFloorCount > 0,
      };
    });
    const realizedPhysicalSpanMeters = physicalSupplementConnections.map((plan) => ({
      connectionId: plan.id,
      distanceMeters: (plan.bridgePath ?? plan.fullPath ?? []).slice(1)
        .reduce((distance, point, index) => {
          const previous = (plan.bridgePath ?? plan.fullPath)[index];
          return distance + Math.hypot(
            Number(point.x) - Number(previous.x),
            Number(point.z) - Number(previous.z),
          ) * dungeon.tileSize;
        }, 0),
    }));
    const realizedTopologyChecks = routeNetworks.map((operation) => {
      const parentAnchored = operation.realizationMode === 'parent-anchored-forest';
      const plans = physicalSupplementConnections.filter((plan) => (
        plan.augmentationOperationId === operation.id
      ));
      const rooms = operation.nodeIds
        .filter((nodeId) => overlayRoomNodeIdSet.has(nodeId))
        .map((nodeId) => supplementRoomById.get(nodeId));
      return {
        operationId: operation.id,
        topologyTemplateId: operation.topologyTemplateId,
        accepted: plans.length > 0
          && rooms.length + operation.nodeIds.filter((nodeId) => (
            overlayNodeById.get(nodeId)?.kind === 'supplementConnectorJunction'
          )).length === Number(operation.substantiveModuleCount)
          && Number(operation.substantiveModuleCount) >= (parentAnchored ? 0 : 3)
          && Number(operation.substantiveModuleCount) <= 6
          && plans.every((plan) => plan.topologyTemplateId === operation.topologyTemplateId)
          && rooms.every((room) => (
            room?.augmentationTopologyTemplateId === operation.topologyTemplateId
          )),
      };
    });
    const realizedElevationChecks = routeNetworks.map((operation) => {
      const mode = operation.elevationModes?.[0] ?? null;
      const plans = physicalSupplementConnections.filter((plan) => (
        plan.augmentationOperationId === operation.id
      ));
      const nodeIds = new Set(operation.nodeIds.filter((nodeId) => (
        overlayRoomNodeIdSet.has(nodeId)
      )));
      const hasElevatedPlatform = dungeon.floorTiles.some((tile) => {
        if (!nodeIds.has(tile.roomId) || !tile.isPlatformingSurface) return false;
        const room = supplementRoomById.get(tile.roomId);
        return Number(tile.elevation ?? 0) > Number(room?.baseElevation ?? 0) + 0.001;
      });
      const hasConnector = (variantId, shortcutMode = null) => plans.some((plan) => (
        plan.connectorVariantId === variantId
        && Math.abs(Number(plan.elevationDelta ?? 0)) > 0.001
        && (shortcutMode === null || plan.shortcutMode === shortcutMode)
      ));
      const accepted = mode === 'slope'
        ? hasConnector('crested_slope_v1')
        : mode === 'ladder'
          ? hasConnector('ladder_gallery_v1')
          : mode === 'lift'
            ? hasConnector('automatic_lift_gallery_v1')
            : mode === 'shortcut-lift'
              ? hasConnector('automatic_lift_gallery_v1', 'shortcut-lift')
              : mode === 'drop-ladder'
                ? hasConnector('ladder_gallery_v1', 'drop-ladder')
                : mode === 'split-level-platform'
                  ? hasElevatedPlatform
                  : false;
      return {
        operationId: operation.id,
        mode,
        accepted,
        localProgressionArcRealized: operation.localProgressionArcRealized !== false,
      };
    });
    const actualElevationModes = [...new Set(realizedElevationChecks
      .filter(({ accepted }) => accepted)
      .map(({ mode }) => mode))].sort();
    const completeLayoutSignatureInputs = routeNetworks.map((operation) => {
      const degreeSequence = operation.nodeIds
        .map((nodeId) => Number(actualNetworkNodeDegrees[nodeId] ?? 0))
        .sort((left, right) => left - right);
      const contentSequence = operation.nodeIds.map((nodeId) => (
        overlayNodeById.get(nodeId)?.contentRole ?? null
      ));
      return {
        legacyFields: {
          topologyTemplateId: operation.topologyTemplateId,
          degreeSequence,
          elevationMode: operation.elevationModes?.[0] ?? null,
          contentSequence,
        },
        rooms: operation.nodeIds.flatMap((nodeId, ordinal) => {
          const room = supplementRoomById.get(nodeId);
          if (!room) return [];
          const node = overlayNodeById.get(nodeId);
          const manifest = room.augmentationModuleManifest ?? {};
          const anchors = room.augmentationAnchors ?? [];
          const roomChests = (dungeon.chests ?? []).filter((chest) => (
            chest.roomId === room.id
          ));
          const rewardSources = roomChests.length > 0
            ? roomChests
            : anchors.filter(({ kind }) => kind === 'reward');
          return [{
            ordinal,
            contentRole: node?.contentRole ?? room.augmentationContentRole ?? null,
            moduleManifestId: manifest.id ?? null,
            moduleTemplateId: room.augmentationModuleTemplateId ?? null,
            moduleKind: room.augmentationModuleKind ?? null,
            physicalModuleKind: room.augmentationPhysicalModuleKind ?? null,
            geometry: {
              dimensionsTiles: {
                width: Number(room.width),
                depth: Number(room.depth),
              },
              rotationQuarterTurns: room.augmentationRotationQuarterTurns ?? 0,
              layout: manifest.layout ?? null,
              floorCellMeters: manifest.floorCellMeters ?? null,
              floorMask: room.augmentationFloorMask ?? [],
              floorTiers: room.augmentationFloorTiers ?? [],
              clearRoutes: room.augmentationClearRoutes ?? [],
              zones: room.augmentationZones ?? [],
            },
            furnishing: anchors,
            cover: room.augmentationCover ?? [],
            landmarks: room.augmentationLandmarks ?? [],
            lighting: room.augmentationLighting ?? [],
            hazardRecipes: anchors
              .filter(({ kind }) => (
                ['trap', 'hazard', 'environmentalHazard'].includes(kind)
              ))
              .map((anchor) => anchor.hazardRecipe ?? (
                anchor.hazardProfileId ? { hazardProfileId: anchor.hazardProfileId } : null
              ))
              .filter(Boolean),
            encounterChoices: (dungeon.encounters ?? [])
              .filter((encounter) => encounter.roomId === room.id)
              .map((encounter) => ({
                encounterProfileId: encounter.encounterProfileId ?? null,
                encounterRecipe: encounter.encounterRecipe ?? null,
                roster: encounter.roster ?? [],
                spatialRoles: encounter.spatialRoles ?? [],
              })),
            rewardRecipes: rewardSources
              .map((reward) => reward.rewardRecipe ?? (
                reward.rewardProfileId ? { rewardProfileId: reward.rewardProfileId } : null
              ))
              .filter(Boolean),
          }];
        }),
      };
    });
    const verticalConnectorPlans = physicalSupplementConnections.filter((plan) => (
      Math.abs(Number(plan.elevationDelta ?? 0)) > 0.001
        || ['crested_slope_v1', 'ladder_gallery_v1', 'automatic_lift_gallery_v1']
          .includes(plan.connectorVariantId)
    ));
    const progressionRoomConnections = dungeon.progression?.roomConnections ?? [];
    const declaredSupplementalProgressionConnections = (
      dungeon.progression?.supplementalRoomConnections ?? []
    );
    const progressionSupplementConnections = progressionRoomConnections
      .filter((connection) => connection.isDungeonSupplement);
    const progressionGraphOnlyConnectionIds = [...new Set([
      ...progressionRoomConnections,
      ...declaredSupplementalProgressionConnections,
    ].map((connection) => connection.id ?? connection.connectorId)
      .filter((connectionId) => graphOnlyConnectionIds.has(connectionId)))].sort();
    const progressionRoomIds = new Set([
      ...(dungeon.progression?.rooms ?? []).map((room) => room.roomId ?? room.id),
      ...(dungeon.progression?.bands ?? []).flatMap((band) => band.roomIds ?? []),
    ]);
    const progressionProxyRoomIds = [...routeStationProxyIdSet]
      .filter((roomId) => progressionRoomIds.has(roomId))
      .sort();
    const progressionConnectionProxyRoomIds = [
      ...progressionRoomConnections,
      ...declaredSupplementalProgressionConnections,
    ].flatMap((connection) => [
      connection.fromRoomId ?? connection.fromNodeId ?? connection.from,
      connection.toRoomId ?? connection.toNodeId ?? connection.to,
    ]).filter((roomId) => routeStationProxyIdSet.has(roomId)).sort();
    const connectorEntrances = dungeon.progression?.validation?.connectorEntrances ?? null;
    const augmentationMetrics = dungeon.augmentationMetrics ?? null;

    return {
      generationAccepted: dungeon.progression?.validation?.accepted ?? false,
      status: dungeon.augmentationStatus ?? null,
      profileId: identity?.profileId ?? null,
      basePlanHash: dungeon.basePlanHash ?? null,
      augmentationPlanHash: dungeon.augmentationPlanHash ?? null,
      effectivePlanHash: dungeon.effectivePlanHash ?? null,
      activePlanHash: game.activeWorldBundle?.planHash ?? null,
      operationTypes: (overlay?.operations ?? [])
        .map((operation) => operation.type ?? operation.operationType ?? operation.kind)
        .sort(),
      overlaySchema: overlay?.schema ?? null,
      routeNetworkCount: routeNetworks.length,
      parentAnchoredRouteNetworkCount: parentAnchoredNetworks.length,
      fullyRealizedRouteNetworkCount: fullyRealizedNetworks.length,
      parentAnchoredRouteNetworkIds: parentAnchoredNetworks.map(({ id }) => id).sort(),
      fullyRealizedRouteNetworkIds: fullyRealizedNetworks.map(({ id }) => id).sort(),
      minimumPhysicalSupplementConnectionCount,
      minimumSupplementRoomCount,
      minimumSubstantiveModuleCount,
      coverageNetworkCount: routeNetworks.filter(({ routeNetworkKind }) => (
        routeNetworkKind === 'objective-route-coverage'
      )).length,
      coverageEndpointSocketCounts: coverageNetworks
        .map((operation) => operation.endpointSocketIds?.length ?? 0)
        .sort((left, right) => left - right),
      routeNetworkGrantManifestAccepted,
      coverageWitnessesAccepted,
      featurelessWitnessesAccepted,
      pyramidLoopCount: routeNetworks.filter(({ routeNetworkKind }) => (
        routeNetworkKind === 'landmark-perimeter-loop'
      )).length,
      overlayModuleCount: overlaySubstantiveModuleCount,
      overlayPhysicalNodeCount: overlayNodes.length,
      overlayRoomNodeCount: overlayRoomNodes.length,
      overlayRoomNodeIds: overlayRoomNodes.map(({ id }) => id).sort(),
      overlayConnectorModuleCount: overlayConnectorModuleNodes.length,
      overlayConnectorJunctionCount: overlayConnectorJunctionNodes.length,
      overlayConnectorNodeIds: overlayConnectorNodes.map(({ id }) => id).sort(),
      overlayNodePartitionAccepted: overlayNodes.every(({ kind }) => [
        'supplementRoom',
        'supplementConnectorModule',
        'supplementConnectorJunction',
      ].includes(kind)),
      maximumFeaturelessSpanMeters: Math.max(0, ...featurelessSpans),
      topologyTemplateIds,
      topologyTemplateSequence,
      junctionKinds,
      fullyRealizedJunctionKinds,
      elevationModes,
      fullyRealizedElevationModes,
      elevationModeSequence,
      networkContractsAccepted: routeNetworks.every((operation) => {
        const parentAnchored = operation.realizationMode === 'parent-anchored-forest';
        return operation.substantiveModuleCount >= (parentAnchored ? 0 : 3)
          && operation.substantiveModuleCount <= 6
          && operation.moduleCount === operation.substantiveModuleCount
          && operation.physicalNodeCount === operation.nodeIds.length
          && operation.physicalNodeCount >= 1
          && operation.segmentIds.length >= 1
          && operation.substantiveModuleCount === operation.nodeIds.filter((nodeId) => (
            overlayRoomNodeIdSet.has(nodeId)
              || overlayNodeById.get(nodeId)?.kind === 'supplementConnectorJunction'
          )).length
          && operation.connectorModuleCount === operation.nodeIds.filter((nodeId) => (
            overlayNodeById.get(nodeId)?.kind === 'supplementConnectorModule'
          )).length
          && operation.endpointSocketIds.length >= (parentAnchored ? 1 : 2)
          && operation.returnRouteGuaranteed === true
          && operation.bidirectional === true
          && operation.localProgressionArc.join(':') === 'enter:challenge:mechanism:payoff:reconnect'
          && (parentAnchored
            ? operation.localProgressionArcRealized === false
              && operation.parentAnchoredComponents.length >= 1
            : operation.localProgressionArcRealized == null
              && operation.contentRoles.includes('challenge')
              && operation.contentRoles.includes('reward')
              && operation.contentRoles.includes('elevation')
              && realizedMeaningfulJunctions.some((check) => (
                check.operationId === operation.id
              )));
      }),
      actualNetworkNodeDegrees,
      realizedNetworkJunctionChecks,
      overlayConnectorProxyChecks,
      actualJunctionCount: realizedMeaningfulJunctions.length,
      actualJunctionKinds,
      realizedTopologyChecks,
      realizedElevationChecks,
      actualElevationModes,
      completeLayoutSignatureInputs,
      pyramidLoop: pyramidLoop ? {
        realizationMode: pyramidLoop.realizationMode ?? null,
        localProgressionArcRealized: pyramidLoop.localProgressionArcRealized ?? null,
        cycleRankDelta: pyramidLoop.cycleRankDelta,
        landmarkRoomId: pyramidLoop.landmarkRoomId,
        occupiedCriticalWallSides: pyramidLoop.occupiedCriticalWallSides,
        openedWallSides: pyramidLoop.openedWallSides,
        progressionBandId: pyramidLoop.progressionBandId,
      } : null,
      totalRoomCount: dungeon.rooms.length,
      authoredRoomCount: authoredRooms.length,
      supplementRoomIds,
      supplementRoomFootprintChecks,
      roomProxyLeakIds: leakedRouteStationProxies.map(({ id }) => id).sort(),
      routeStationProxyCount: routeStationProxies.length,
      authoredRouteStationProxyCount: routeStationProxies.filter((room) => (
        room.isRouteStationProxy === true
      )).length,
      routeStationProxyIds: routeStationProxies.map(({ id }) => id),
      routeStationProxyContractsAccepted: routeStationProxies.every((room) => (
        room.isDungeonSupplement === false
          && room.suppressRoomGeometry === true
          && room.isConnectorJunctionProxy === true
          && (
            room.isRouteStationProxy === true
            || room.isSupplementConnectorModule === true
            || room.isSupplementConnectorJunction === true
          )
      )),
      supplementConnectionCount: supplementConnections.length,
      physicalSupplementConnectionCount: physicalSupplementConnections.length,
      graphSupplementConnectionCount: supplementConnections.filter((connection) => (
        isGraphOnlyConnection(connection)
      )).length,
      parentRouteStationLinkCount: supplementConnections.filter((connection) => (
        isGraphOnlyConnection(connection) && connection.parentRouteStationLink === true
      )).length,
      graphOnlyConnectionIds: [...graphOnlyConnectionIds].sort(),
      supplementRoomOwnedFloorCounts,
      physicalSupplementFloorOwnership,
      realizedPhysicalSpanMeters,
      maximumRealizedPhysicalSpanMeters: Math.max(
        0,
        ...realizedPhysicalSpanMeters.map(({ distanceMeters }) => distanceMeters),
      ),
      verticalConnectorCount: verticalConnectorPlans.length,
      verticalConnectorVariantIds: [...new Set(verticalConnectorPlans
        .map(({ connectorVariantId }) => connectorVariantId)
        .filter(Boolean))].sort(),
      rootName: supplementRoot?.name ?? null,
      rootParentIsDungeon: supplementRoot?.parent === dungeon.group,
      rootRoomIds: [...(supplementRoot?.userData?.supplementalRoomIds ?? [])].sort(),
      minimapRoomIds,
      minimapProxyRoomIds,
      minimapHallwayProxyRoomIds,
      minimapHallwayCount: minimapHallways.length,
      minimapGraphOnlyConnectionIds,
      supplementEncounterCount: supplementEncounters.length,
      supplementEncounterRoomIds: [...new Set(
        supplementEncounters.map((encounter) => encounter.roomId).filter(Boolean),
      )].sort(),
      supplementChestCount: supplementChests.length,
      supplementTrapCount: supplementTraps.length,
      encounterProxyRoomIds,
      rewardProxyRoomIds,
      elevatedPlatformTileCount: dungeon.floorTiles.filter((tile) => (
        supplementRoomIdSet.has(tile.roomId)
        && tile.isPlatformingSurface
        && Number(tile.elevation ?? 0) > Number(
          supplementRooms.find((room) => room.id === tile.roomId)?.baseElevation ?? 0,
        )
      )).length,
      supplementLightCount,
      localLightRecordCount: (dungeon.localLights ?? []).length,
      identity,
      diagnostics,
      assetCatalogIds: [...new Set(assetCatalogIds)].sort(),
      boundThemeIds: [...new Set(boundThemeIds)].sort(),
      supplementMaterialCount: supplementMaterials.size,
      foreignSupplementMaterials,
      outsideSupplementOwners,
      resourceCounts,
      progressionSupplementConnectionCount: progressionSupplementConnections.length,
      declaredSupplementalProgressionConnectionCount:
        declaredSupplementalProgressionConnections.length,
      progressionGraphOnlyConnectionIds,
      progressionProxyRoomIds,
      progressionConnectionProxyRoomIds,
      progressionSupplementEndpointsResolve: progressionSupplementConnections.every((connection) => (
        dungeon.rooms.some((room) => room.id === connection.fromRoomId)
          && dungeon.rooms.some((room) => room.id === connection.toRoomId)
      )),
      connectorEntrances,
      platformability: dungeon.progression?.validation?.platformability ?? null,
      segmentBarriersValidated:
        dungeon.progression?.validation?.platformability?.segmentBarriersValidated ?? false,
      effectiveGraphAccepted:
        dungeon.progression?.validation?.effectiveGraph?.accepted ?? false,
      lockedGatePlacements: (dungeon.doors ?? [])
        .filter(({ locked }) => locked)
        .map(({
          id,
          gatePlacementSide,
          fromRoomId,
          toRoomId,
          connectionPlanId,
          graphBlockingPosition,
          thresholdAnchored,
          thresholdOwnerRoomId,
          fromPortal,
        }) => {
          const plan = dungeon.connectionPlans.find((candidate) => candidate.id === connectionPlanId);
          const source = plan?.fromSocket;
          return {
            id,
            gatePlacementSide,
            fromRoomId,
            toRoomId,
            connectionPlanId: connectionPlanId ?? null,
            thresholdAnchored: thresholdAnchored === true,
            thresholdOwnerRoomId: thresholdOwnerRoomId ?? null,
            planFromRoomId: plan?.fromRoomId ?? null,
            planDoorId: plan?.doorId ?? plan?.logicalGateId ?? null,
            sourcePortalMatchesPlan: Boolean(
              fromPortal
              && source
              && fromPortal.roomId === source.roomId
              && fromPortal.x === source.x
              && fromPortal.z === source.z
            ),
            sourceEntranceDistanceMeters: source && graphBlockingPosition
              ? Math.hypot(
                graphBlockingPosition.x - source.x * dungeon.tileSize,
                graphBlockingPosition.z - source.z * dungeon.tileSize,
              )
              : null,
            sourceEntranceElevationDistanceMeters: source && graphBlockingPosition
              ? Math.abs(
                Number(graphBlockingPosition.y) - Number(source.elevation ?? 0),
              )
              : null,
          };
        }),
      physicalSupplementConnectionIds: [...physicalSupplementConnectionIds].sort(),
      shortcutConnectionIds,
      augmentationMetrics,
    };
  });

  snapshot.completeLayoutSignatures = snapshot.completeLayoutSignatureInputs.map((input) => (
    createDungeonAugmentationCompleteLayoutSignature(input)
  ));
  delete snapshot.completeLayoutSignatureInputs;

  expect(snapshot.generationAccepted).toBe(true);
  expect(snapshot.status, JSON.stringify(snapshot.diagnostics, null, 2)).toBe('applied');
  expect(snapshot.profileId).toBe(INDUSTRIAL_PROFILE_ID);
  expect(snapshot.overlaySchema).toBe('ruindivex-dungeon-augmentation-overlay/v2');
  expect(snapshot.operationTypes.every((type) => type === 'routeNetwork')).toBe(true);
  expect(snapshot.routeNetworkCount).toBeGreaterThanOrEqual(3);
  expect(snapshot.routeNetworkCount).toBeLessThanOrEqual(8);
  expect(
    snapshot.fullyRealizedRouteNetworkCount + snapshot.parentAnchoredRouteNetworkCount,
  ).toBe(snapshot.routeNetworkCount);
  expect(snapshot.coverageNetworkCount).toBeGreaterThanOrEqual(1);
  expect(snapshot.coverageEndpointSocketCounts.every((count) => count >= 1)).toBe(true);
  expect(snapshot.routeNetworkGrantManifestAccepted).toBe(true);
  expect(snapshot.coverageWitnessesAccepted).toBe(true);
  expect(snapshot.featurelessWitnessesAccepted).toBe(true);
  expect(snapshot.pyramidLoopCount).toBe(1);
  expect(snapshot.overlayModuleCount).toBeGreaterThanOrEqual(
    snapshot.minimumSubstantiveModuleCount,
  );
  expect(snapshot.overlayModuleCount).toBeLessThanOrEqual(30);
  expect(snapshot.overlayNodePartitionAccepted).toBe(true);
  expect(snapshot.overlayModuleCount).toBe(
    snapshot.overlayRoomNodeCount + snapshot.overlayConnectorJunctionCount,
  );
  expect(snapshot.overlayPhysicalNodeCount).toBe(
    snapshot.overlayRoomNodeCount
      + snapshot.overlayConnectorModuleCount
      + snapshot.overlayConnectorJunctionCount,
  );
  expect(snapshot.overlayPhysicalNodeCount).toBe(
    snapshot.overlayModuleCount + snapshot.overlayConnectorModuleCount,
  );
  expect(snapshot.supplementRoomIds).toEqual(snapshot.overlayRoomNodeIds);
  expect(snapshot.supplementRoomIds.length).toBe(snapshot.overlayRoomNodeCount);
  expect(snapshot.supplementRoomIds.length).toBeGreaterThanOrEqual(
    snapshot.minimumSupplementRoomCount,
  );
  expect(snapshot.supplementRoomIds.length).toBeLessThanOrEqual(30);
  expect(snapshot.maximumFeaturelessSpanMeters).toBeLessThanOrEqual(33.6);
  expect(snapshot.maximumRealizedPhysicalSpanMeters).toBeLessThanOrEqual(33.6 + 1e-6);
  expect(snapshot.topologyTemplateIds.length).toBeGreaterThanOrEqual(3);
  if (snapshot.fullyRealizedRouteNetworkCount > 0) {
    expect(snapshot.junctionKinds.length).toBeGreaterThanOrEqual(1);
  }
  expect(snapshot.elevationModes.length).toBeGreaterThanOrEqual(3);
  expect(snapshot.realizedTopologyChecks.every(({ accepted }) => accepted)).toBe(true);
  expect(snapshot.actualJunctionKinds).toEqual(
    expect.arrayContaining(snapshot.fullyRealizedJunctionKinds),
  );
  expect(snapshot.realizedElevationChecks.filter(({ localProgressionArcRealized }) => (
    localProgressionArcRealized
  )).every(({ accepted }) => accepted)).toBe(true);
  expect(snapshot.actualElevationModes).toEqual(
    expect.arrayContaining(snapshot.fullyRealizedElevationModes),
  );
  const selectionBagPrefixLength = Math.min(snapshot.routeNetworkCount, 6);
  expect(new Set(
    snapshot.topologyTemplateSequence.slice(0, selectionBagPrefixLength),
  ).size).toBe(selectionBagPrefixLength);
  expect(new Set(
    snapshot.elevationModeSequence.slice(0, selectionBagPrefixLength),
  ).size).toBe(selectionBagPrefixLength);
  expect(new Set(
    snapshot.completeLayoutSignatures.slice(0, selectionBagPrefixLength),
  ).size).toBe(selectionBagPrefixLength);
  expect(snapshot.networkContractsAccepted).toBe(true);
  expect(snapshot.actualJunctionCount).toBeGreaterThanOrEqual(
    snapshot.fullyRealizedRouteNetworkCount,
  );
  expect(snapshot.realizedNetworkJunctionChecks.filter((check) => (
    check.actualDegree >= 3
    && (!check.exactParentStationComposite || check.exactParentStationCompositeBound)
    && (!check.routeStationProxy || check.parentRouteArmsRealized)
  )).every((check) => (
    check.overlayMeaningful && check.runtimeMeaningful && check.runtimeJunctionKind
  ))).toBe(true);
  expect(snapshot.pyramidLoop).toMatchObject({
    landmarkRoomId: 'keycardRoom',
    progressionBandId: 0,
  });
  if (snapshot.pyramidLoop.realizationMode === 'parent-anchored-forest') {
    expect(snapshot.pyramidLoop.localProgressionArcRealized).toBe(false);
    expect(snapshot.pyramidLoop.cycleRankDelta).toBeGreaterThanOrEqual(0);
  } else {
    expect(snapshot.pyramidLoop.localProgressionArcRealized).toBeNull();
    expect(snapshot.pyramidLoop.cycleRankDelta).toBe(1);
    expect(snapshot.pyramidLoop.occupiedCriticalWallSides).toHaveLength(2);
    expect(snapshot.pyramidLoop.openedWallSides).toHaveLength(2);
    expect(new Set([
      ...snapshot.pyramidLoop.occupiedCriticalWallSides,
      ...snapshot.pyramidLoop.openedWallSides,
    ]).size).toBe(4);
  }
  expect(snapshot.authoredRoomCount).toBe(13);
  expect(snapshot.supplementRoomFootprintChecks).toHaveLength(snapshot.overlayRoomNodeCount);
  expect(snapshot.supplementRoomFootprintChecks.every((check) => (
    check.materializedAsRoom
      && !check.leakedAsProxy
      && check.accepted
      && check.floorMaskCellCount > 0
      && Boolean(check.moduleTemplateId)
      && check.moduleKind !== 'connector'
  ))).toBe(true);
  expect(snapshot.roomProxyLeakIds).toEqual([]);
  expect(snapshot.routeStationProxyContractsAccepted).toBe(true);
  expect(new Set(snapshot.routeStationProxyIds).size).toBe(snapshot.routeStationProxyCount);
  expect(snapshot.totalRoomCount).toBe(
    snapshot.authoredRoomCount
      + snapshot.supplementRoomIds.length,
  );
  expect(snapshot.supplementConnectionCount).toBeGreaterThanOrEqual(
    snapshot.minimumPhysicalSupplementConnectionCount,
  );
  expect(snapshot.physicalSupplementConnectionCount).toBeGreaterThanOrEqual(
    snapshot.minimumPhysicalSupplementConnectionCount,
  );
  expect(snapshot.routeStationProxyCount).toBeGreaterThanOrEqual(
    snapshot.overlayConnectorNodeIds.length,
  );
  expect(snapshot.overlayConnectorProxyChecks).toHaveLength(
    snapshot.overlayConnectorNodeIds.length,
  );
  expect(snapshot.overlayConnectorProxyChecks.every((check) => (
    check.materializedOnlyAsProxy
      && check.expectedArmIds.length === check.realizedArmIds.length
      && check.expectedArmIds.every((armId, index) => armId === check.realizedArmIds[index])
      && check.physicalArmCount === check.expectedArmIds.length
      && check.actualApproachCount === check.expectedArmIds.length
      && check.coreFloorCount === check.expectedCoreFloorCount
      && check.coreFloorCount > 0
      && check.requiredApproachCount === (
        check.kind === 'supplementConnectorModule' || check.exactParentStationComposite
          ? 2
          : 3
      )
      && (
        check.kind === 'supplementConnectorJunction'
          ? check.actualApproachCount >= 3 && check.meaningful
          : check.actualApproachCount === 2 && !check.meaningful
      )
  ))).toBe(true);
  expect(snapshot.graphSupplementConnectionCount).toBeGreaterThanOrEqual(
    snapshot.authoredRouteStationProxyCount,
  );
  expect(snapshot.parentRouteStationLinkCount).toBe(snapshot.authoredRouteStationProxyCount);
  expect(snapshot.graphOnlyConnectionIds.length).toBeGreaterThan(0);
  expect(snapshot.physicalSupplementConnectionIds.some((connectionId) => (
    snapshot.graphOnlyConnectionIds.includes(connectionId)
  ))).toBe(false);
  expect(Object.values(snapshot.supplementRoomOwnedFloorCounts).every((count) => (
    count > 0
  ))).toBe(true);
  expect(snapshot.physicalSupplementFloorOwnership.every(({ hasRealizedOwner }) => (
    hasRealizedOwner
  ))).toBe(true);
  expect(snapshot.augmentationMetrics).toMatchObject({
    operationCount: snapshot.routeNetworkCount,
    roomCount: snapshot.supplementRoomIds.length,
    physicalConnectionCount: snapshot.physicalSupplementConnectionCount,
  });
  expect(snapshot.augmentationMetrics.tileCount).toBeGreaterThan(0);
  expect(snapshot.augmentationMetrics.meshCount).toBeGreaterThan(0);

  expect(snapshot.connectorEntrances.checkedSocketCount).toBeGreaterThan(0);
  expect(snapshot.connectorEntrances.acceptedSocketCount).toBe(
    snapshot.connectorEntrances.checkedSocketCount,
  );
  expect(snapshot.connectorEntrances.checks.filter((check) => (
    check.strictApproachContract
  )).length).toBeGreaterThanOrEqual(snapshot.minimumPhysicalSupplementConnectionCount);
  expect(snapshot.connectorEntrances.checks.every((check) => (
    check.socketReachable
      && check.outsideReachable
      && check.traversableOutward
      && check.traversableReturn
      && check.blockingWallFacadeId === null
      && (
        !check.strictApproachContract
        || (
          check.requiredLaneCount >= 3
          && check.acceptedLaneCount === check.requiredLaneCount
          && check.requiredApproachDepthTiles === 2
          && check.laneChecks.every((lane) => lane.accepted)
        )
      )
  ))).toBe(true);
  expect(snapshot.connectorEntrances.skippedGraphConnectionIds.sort()).toEqual(
    snapshot.graphOnlyConnectionIds,
  );
  expect(snapshot.connectorEntrances.checks.some(({ connectionId }) => (
    snapshot.graphOnlyConnectionIds.includes(connectionId)
  ))).toBe(false);
  expect(snapshot.segmentBarriersValidated).toBe(true);
  expect(snapshot.platformability.orphanSupplementFloorCount).toBe(0);
  expect(snapshot.platformability.blockedSupplementFloorCount).toBe(0);
  expect(snapshot.platformability.nonReturnableSupplementFloorCount).toBe(0);
  expect(snapshot.platformability.supplementConnectivityChecks.length).toBe(
    snapshot.physicalSupplementConnectionCount,
  );
  expect(snapshot.platformability.supplementConnectivityChecks
    .map(({ connectionId }) => connectionId)
    .sort()).toEqual(snapshot.physicalSupplementConnectionIds);
  expect(snapshot.platformability.supplementConnectivityChecks.every((check) => (
    check.accepted
      && check.centerlinePointCount > 0
      && check.centerlineChecks.every((point) => (
        (point.floorKey || point.contractTraversal)
        && point.reachable
        && (
          point.contractTraversal
          || (point.elevationMatchesExpected && point.expectedElevations.length > 0)
        )
      ))
      && check.verticalContractChecks.every((contract) => contract.accepted)
      && check.missingOwnedCenterlinePointCount === 0
      && check.unreachableCenterlinePointCount === 0
      && check.strictLocalComponentAccepted
      && check.locallyUnreachableTraversalFloorKeys.length === 0
      && check.locallyNonReturnableTraversalFloorKeys.length === 0
  ))).toBe(true);
  expect(snapshot.platformability.supplementRoomConnectivityChecks).toHaveLength(
    snapshot.supplementRoomIds.length,
  );
  expect(snapshot.platformability.supplementRoomConnectivityChecks.every((check) => (
    check.accepted
      && check.attachedPhysicalConnectionIds.length > 0
      && snapshot.supplementRoomOwnedFloorCounts[check.roomId] > 0
      && check.totalNavigableFloorCount > 0
      && check.realizedRoomOwnedFloorCount
        === check.totalNavigableFloorCount + check.authoredBlockingRoomFloorCount
      && check.reachableFloorCount === check.totalNavigableFloorCount
      && check.meetsSubstantiveRoomFootprint
      && check.usesAuthoredFloorMask
      && check.expectedBaseFootprintFloorCount > 0
      && Boolean(check.authoredModuleTemplateId)
      && check.authoredModuleKind !== 'connector'
      && check.realizedBaseFootprintFloorCount === check.expectedBaseFootprintFloorCount
      && check.baseFootprintCoverageAccepted
      && check.missingBaseFootprintColumnKeys.length === 0
      && check.nonNavigableBaseFootprintFloorKeys.length === 0
      && check.globallyUnreachableBaseFootprintFloorKeys.length === 0
      && check.locallyUnreachableBaseFootprintFloorKeys.length === 0
      && check.locallyNonReturnableBaseFootprintFloorKeys.length === 0
      && check.unexpectedNonNavigableRoomFloorKeys.length === 0
      && check.outsideDeclaredRoomFloorKeys.length === 0
      && check.foreignRoomFloorOwnership.length === 0
      && check.globallyNonReturnableRoomFloorKeys.length === 0
      && check.orphanFloorKeys.length === 0
      && check.localRoomConnectivityAccepted
      && check.locallyUnreachableRoomFloorKeys.length === 0
      && check.locallyNonReturnableRoomFloorKeys.length === 0
      && check.localApproachChecks.every((approach) => (
        approach.floorKey
        && approach.reachableFromFirstApproach
        && approach.returnReachable
      ))
  ))).toBe(true);
  expect(snapshot.platformability.supplementJunctionConnectivityChecks).toHaveLength(
    snapshot.realizedNetworkJunctionChecks.length,
  );
  const connectorProxyCheckById = new Map(snapshot.overlayConnectorProxyChecks.map((check) => (
    [check.nodeId, check]
  )));
  expect(snapshot.platformability.supplementJunctionConnectivityChecks.every((check) => {
    const connector = connectorProxyCheckById.get(check.roomId);
    const expectedApproachCount = connector?.exactParentStationComposite
      ? 2
      : connector?.kind === 'supplementConnectorModule'
        ? 2
        : connector?.expectedArmIds.length ?? check.approachCount;
    const minimumApproachCount = connector?.requiredApproachCount ?? 3;
    const realizedLocalArmIds = connector?.realizedArmIds.filter((armId) => (
      String(armId) !== String(connector?.parentThroughPhysicalArmId ?? '')
      && !String(armId).includes(':authored-through:')
    ));
    const exactAttachedArmIds = !connector || JSON.stringify(
      [...(check.attachedPhysicalConnectionIds ?? [])].sort(),
    ) === JSON.stringify(realizedLocalArmIds);
    const exactCompositeBound = !connector?.exactParentStationComposite || (
      check.exactParentStationComposite === true
      && check.exactParentStationCompositeBound === true
      && Boolean(check.parentStationAttachmentId)
      && snapshot.platformability.supplementJunctionConnectivityChecks.some((candidate) => (
        candidate.roomId === check.parentStationProxyId
          && candidate.routeStationProxy === true
          && candidate.accepted
          && candidate.approachCount >= 3
      ))
    );
    return check.accepted
      && check.approachCount === expectedApproachCount
      && exactAttachedArmIds
      && exactCompositeBound
      && check.requiredApproachCount === minimumApproachCount
      && check.coreFloorCoverageAccepted
      && check.foreignCoreFloorOwnerIds.length === 0
      && check.unownedMergedCoreFloorSourceCount === 0
      && check.coreFloorCount === check.expectedCoreFloorCount
      && check.navigableCoreFloorCount === check.expectedCoreFloorCount
      && check.approachChecks.length === expectedApproachCount
      && check.approachChecks.every((approach) => (
        approach.floorKey
          && approach.globallyReachable
          && approach.locallyReachable
          && approach.returnReachable
      ));
  })).toBe(true);
  expect(snapshot.fullyRealizedRouteNetworkCount).toBeLessThanOrEqual(
    new Set(snapshot.platformability.supplementJunctionConnectivityChecks
      .filter((check) => (
        snapshot.fullyRealizedRouteNetworkIds.includes(check.operationId)
          && check.accepted
          && (
            check.approachCount >= 3
            || (
              check.exactParentStationComposite === true
              && check.exactParentStationCompositeBound === true
            )
          )
      ))
      .map(({ operationId }) => operationId)).size,
  );
  expect(snapshot.fullyRealizedRouteNetworkIds.every((operationId) => (
    snapshot.platformability.supplementVerticalConnectivityChecks.some((check) => (
      check.operationId === operationId
        && check.accepted
        && check.allOperationRoomsConnected
        && check.hasRealVerticalTransfer
    ))
  ))).toBe(true);
  expect(snapshot.parentAnchoredRouteNetworkIds.every((operationId) => (
    snapshot.platformability.supplementVerticalConnectivityChecks.some((check) => (
      check.operationId === operationId
        && check.accepted
        && check.localProgressionArcRealized === false
        && check.parentAnchoredPhysicalContractAccepted
        && check.parentAnchoredComponentChecks.length > 0
        && check.parentAnchoredComponentChecks.every((component) => (
          component.accepted
            && component.exactDeclaredMembership
            && component.physicalConnectionIds.length > 0
            && component.ownedFloorChecks.length > 0
            && component.attachmentChecks.every((attachment) => (
              attachment.exactEndpointPresent
                && attachment.navigable
                && attachment.reachable
                && attachment.returnable
            ))
        ))
    ))
  ))).toBe(true);
  expect(snapshot.platformability.supplementShortcutConnectivityChecks
    .map(({ connectionId }) => connectionId)
    .sort()).toEqual(snapshot.shortcutConnectionIds);
  expect(snapshot.platformability.supplementShortcutConnectivityChecks.every((check) => (
    check.accepted
      && check.mechanismRecordAccepted
      && check.initiallyUnavailable
      && check.sourceReachableBeforeActivation
      && check.farSideReachableBeforeActivation
      && check.matchingTraversalLinkIds.length >= 2
      && check.postActivationBidirectional
  ))).toBe(true);
  expect(snapshot.effectiveGraphAccepted).toBe(true);
  expect(snapshot.lockedGatePlacements.length).toBeGreaterThan(0);
  expect(snapshot.lockedGatePlacements.every(({ gatePlacementSide }) => (
    gatePlacementSide === 'source'
  ))).toBe(true);
  expect(snapshot.lockedGatePlacements.every(({ sourceEntranceDistanceMeters }) => (
    sourceEntranceDistanceMeters !== null && sourceEntranceDistanceMeters <= 0.01
  ))).toBe(true);
  expect(snapshot.lockedGatePlacements.every(({ sourceEntranceElevationDistanceMeters }) => (
    sourceEntranceElevationDistanceMeters !== null
      && sourceEntranceElevationDistanceMeters <= 0.01
  ))).toBe(true);
  expect(snapshot.lockedGatePlacements.every((gate) => (
    gate.thresholdAnchored
      && gate.thresholdOwnerRoomId === gate.fromRoomId
      && gate.planFromRoomId === gate.fromRoomId
      && gate.planDoorId === gate.id
      && gate.sourcePortalMatchesPlan
  ))).toBe(true);

  expect(snapshot.basePlanHash).toBeTruthy();
  expect(snapshot.augmentationPlanHash).toBeTruthy();
  expect(snapshot.augmentationPlanHash).not.toBe(snapshot.basePlanHash);
  expect(snapshot.effectivePlanHash).toBeTruthy();
  expect(snapshot.effectivePlanHash).not.toBe(snapshot.basePlanHash);
  expect(snapshot.activePlanHash).toBe(snapshot.effectivePlanHash);

  expect(snapshot.rootName).toBe('DungeonSupplementRoot');
  expect(snapshot.rootParentIsDungeon).toBe(true);
  expect(snapshot.rootRoomIds).toEqual(snapshot.supplementRoomIds);
  expect(snapshot.minimapRoomIds).toEqual(snapshot.supplementRoomIds);
  expect(snapshot.minimapProxyRoomIds).toEqual([]);
  expect(snapshot.minimapHallwayProxyRoomIds).toEqual([]);
  expect(snapshot.minimapGraphOnlyConnectionIds).toEqual([]);
  expect(snapshot.minimapHallwayCount).toBeGreaterThanOrEqual(
    snapshot.minimumPhysicalSupplementConnectionCount,
  );
  expect(snapshot.supplementEncounterCount).toBeGreaterThanOrEqual(
    snapshot.fullyRealizedRouteNetworkCount,
  );
  expect(snapshot.supplementEncounterRoomIds.length).toBeGreaterThanOrEqual(
    snapshot.fullyRealizedRouteNetworkCount,
  );
  expect(snapshot.supplementChestCount).toBeGreaterThanOrEqual(
    snapshot.fullyRealizedRouteNetworkCount,
  );
  if (snapshot.fullyRealizedRouteNetworkCount > 0) {
    expect(snapshot.supplementTrapCount).toBeGreaterThanOrEqual(1);
  }
  expect(snapshot.encounterProxyRoomIds).toEqual([]);
  expect(snapshot.rewardProxyRoomIds).toEqual([]);
  if (snapshot.fullyRealizedRouteNetworkCount > 0) {
    expect(snapshot.elevatedPlatformTileCount).toBeGreaterThan(0);
  }
  if (snapshot.fullyRealizedElevationModes.some((mode) => mode !== 'split-level-platform')) {
    expect(snapshot.verticalConnectorCount).toBeGreaterThanOrEqual(1);
  }
  expect(snapshot.verticalConnectorVariantIds.every((variantId) => [
    'crested_slope_v1',
    'ladder_gallery_v1',
    'automatic_lift_gallery_v1',
  ].includes(variantId))).toBe(true);
  expect(snapshot.supplementLightCount).toBeGreaterThan(0);
  expect(snapshot.localLightRecordCount).toBeGreaterThan(0);

  expect(snapshot.identity).toMatchObject({
    schema: SAVE_IDENTITY_SCHEMA,
    profileId: INDUSTRIAL_PROFILE_ID,
    basePlanHash: snapshot.basePlanHash,
    augmentationPlanHash: snapshot.augmentationPlanHash,
    effectivePlanHash: snapshot.effectivePlanHash,
    themeRevisions: [{
      themeId: INDUSTRIAL_THEME_ID,
      revision: INDUSTRIAL_THEME_REVISION,
    }],
  });
  expect(snapshot.diagnostics).toMatchObject({
    status: 'applied',
    profileId: INDUSTRIAL_PROFILE_ID,
    basePlanHash: snapshot.basePlanHash,
    augmentationPlanHash: snapshot.augmentationPlanHash,
    effectivePlanHash: snapshot.effectivePlanHash,
  });

  expect(snapshot.assetCatalogIds.length).toBeGreaterThan(0);
  expect(snapshot.assetCatalogIds.every((id) => id.startsWith('industrial-v1:'))).toBe(true);
  expect(snapshot.boundThemeIds).toEqual([INDUSTRIAL_THEME_ID]);
  expect(snapshot.supplementMaterialCount).toBeGreaterThan(0);
  expect(snapshot.foreignSupplementMaterials).toEqual([]);
  // Parent-integrated floors, ceilings, and threshold arches intentionally
  // remain in the parent's culling/occlusion hierarchy. They may carry the
  // supplemental connector owner ID without becoming foreign presentation.
  expect(snapshot.outsideSupplementOwners.length).toBeGreaterThan(0);
  expect(snapshot.outsideSupplementOwners.every((name) => (
    name === 'dungeonFloorTileVisual'
      || name === 'dungeonRoomCeiling'
      || name.startsWith('connectorIndustrialArch_')
      || name.startsWith('classicV1CorridorFurnishing_')
  ))).toBe(true);
  expect(snapshot.progressionSupplementConnectionCount).toBe(
    snapshot.physicalSupplementConnectionCount,
  );
  expect(snapshot.declaredSupplementalProgressionConnectionCount).toBe(
    snapshot.physicalSupplementConnectionCount,
  );
  expect(snapshot.progressionGraphOnlyConnectionIds).toEqual([]);
  expect(snapshot.progressionProxyRoomIds).toEqual([]);
  expect(snapshot.progressionConnectionProxyRoomIds).toEqual([]);
  expect(snapshot.progressionSupplementEndpointsResolve).toBe(true);
  expect(snapshot.resourceCounts).toMatchObject({
    borrowedCount: expect.any(Number),
    ownedCount: expect.any(Number),
  });
  // Facade-only assembly owns its generated asset groups at the fragment
  // level; the parent material borrows are tracked by the resolved theme
  // session inside those products.
  expect(snapshot.resourceCounts.ownedCount).toBeGreaterThan(0);
  expect(snapshot.resourceCounts.themeSessions?.[0]?.borrowedCount ?? 0).toBeGreaterThan(0);

  const teardown = await page.evaluate(() => {
    const dungeon = window.game.dungeon;
    const fragment = dungeon.dungeonSupplement;
    const root = dungeon.dungeonSupplementRoot;
    const materials = new Set();
    const supplementGeometries = new Set();
    const parentGeometries = new Set();
    let materialDisposeEvents = 0;
    let geometryDisposeEvents = 0;
    let sharedGeometryDisposeEvents = 0;
    root.traverse((object) => {
      if (object.geometry && !supplementGeometries.has(object.geometry)) {
        supplementGeometries.add(object.geometry);
        object.geometry.addEventListener?.('dispose', () => { geometryDisposeEvents += 1; });
      }
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!material || materials.has(material)) continue;
        materials.add(material);
        material.addEventListener?.('dispose', () => { materialDisposeEvents += 1; });
      }
    });
    const supplementObjects = new Set();
    root.traverse((object) => supplementObjects.add(object));
    dungeon.group.traverse((object) => {
      if (!supplementObjects.has(object) && object.geometry) parentGeometries.add(object.geometry);
    });
    const sharedGeometries = [...supplementGeometries].filter((geometry) => parentGeometries.has(geometry));
    for (const geometry of sharedGeometries) {
      geometry.addEventListener?.('dispose', () => { sharedGeometryDisposeEvents += 1; });
    }
    fragment.dispose();
    fragment.dispose();
    return {
      rootDetached: root.parent === null,
      materialDisposeEvents,
      geometryDisposeEvents,
      sharedGeometryCount: sharedGeometries.length,
      sharedGeometryDisposeEvents,
    };
  });
  expect(teardown.rootDetached).toBe(true);
  expect(teardown.materialDisposeEvents).toBe(0);
  expect(teardown.geometryDisposeEvents).toBeGreaterThan(0);
  expect(teardown.sharedGeometryCount).toBeGreaterThan(0);
  expect(teardown.sharedGeometryDisposeEvents).toBe(0);
});

test('five opt-in enter/fresh-reset/exit cycles plateau supplement ownership and resources', async ({ page }) => {
  test.setTimeout(900_000);
  const runtimeErrors = captureRuntimeErrors(page);
  await page.goto([
    '/?busterLab=sandbox',
    'dungeonSeed=augmentation-runtime-check',
    `dungeonAugmentation=${INDUSTRIAL_PROFILE_ID}`,
    'playerInvulnerable=1',
  ].join('&'));
  await waitForWorld(page, 'overworld');
  await waitForOverworldAssetsSettled(page);

  const initialWorld = await readWorldDiagnostics(page);
  const dungeonSamples = [];
  const overworldSamples = [];
  const dungeonRootIds = new Set();
  let entryStateSignature = null;

  for (let cycle = 1; cycle <= 5; cycle += 1) {
    await beginBossExpedition(page, 'revolvingFusillade');
    await waitForDungeon(page, runtimeErrors, 180_000);
    await waitForDungeonPresentationAssets(page);

    const sample = await page.evaluate(() => {
      const { game } = window;
      const overlayNodes = game.dungeon.augmentationOverlayPlan?.nodes ?? [];
      const routeNetworks = (game.dungeon.augmentationOverlayPlan?.operations ?? [])
        .filter(({ type }) => type === 'routeNetwork');
      const publicState = game.getPublicDungeonJourneyDiagnostics?.({ includeGeometry: false });
      const geometries = new Set();
      const materials = new Set();
      game.dungeon.group.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry.uuid);
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (material) materials.add(material.uuid);
        }
      });
      return {
        rootId: game.activeWorldBundle?.root?.uuid ?? null,
        status: game.dungeon.augmentationStatus,
        roomCount: game.dungeon.rooms.length,
        supplementRoomCount: game.dungeon.rooms.filter((room) => room.isDungeonSupplement).length,
        overlayModuleCount: routeNetworks.reduce((count, operation) => (
          count + Number(operation.substantiveModuleCount ?? operation.moduleCount ?? 0)
        ), 0),
        overlayPhysicalNodeCount: overlayNodes.length,
        overlayRoomNodeCount: overlayNodes.filter(({ kind }) => kind === 'supplementRoom').length,
        overlayConnectorModuleCount: overlayNodes.filter(({ kind }) => (
          kind === 'supplementConnectorModule'
        )).length,
        overlayConnectorJunctionCount: overlayNodes.filter(({ kind }) => (
          kind === 'supplementConnectorJunction'
        )).length,
        overlayConnectorNodeCount: overlayNodes.filter(({ kind }) => (
          kind === 'supplementConnectorModule' || kind === 'supplementConnectorJunction'
        )).length,
        routeNetworkCount: routeNetworks.length,
        parentAnchoredRouteNetworkCount: routeNetworks.filter(({ realizationMode }) => (
          realizationMode === 'parent-anchored-forest'
        )).length,
        supplementRootCount: game.dungeon.group.children.filter((child) => (
          child.userData?.dungeonSupplementRoot === true
        )).length,
        geometryCount: geometries.size,
        materialCount: materials.size,
        encounterCount: game.dungeon.encounters.length,
        hazardCount: (game.dungeon.environmentalHazards ?? []).length
          + (game.dungeon.traps ?? []).length,
        disposableResourceCount: game.activeWorldBundle?.disposableResources?.length ?? 0,
        rendererGeometries: game.renderer.info.memory.geometries,
        rendererTextures: game.renderer.info.memory.textures,
        controllerBoundToCurrentDungeon: game.dungeonController?.dungeon === game.dungeon,
        entryState: {
          ownedKeys: publicState?.ownedKeys ?? [],
          keycards: (publicState?.keycards ?? []).map(({ id, collected }) => ({ id, collected })),
          encounters: (publicState?.encounters ?? []).map(({ id, spawned, cleared }) => ({
            id, spawned, cleared,
          })),
          mechanisms: (publicState?.mechanisms ?? []).map(({ id, activated }) => ({
            id, activated,
          })),
          chests: (publicState?.chests ?? []).map(({ id, opened }) => ({ id, opened })),
          mutableState: structuredClone(game.dungeon.augmentationIdentity?.mutableState ?? {}),
        },
      };
    });
    dungeonSamples.push(sample);
    dungeonRootIds.add(sample.rootId);
    if (entryStateSignature === null) entryStateSignature = sample.entryState;
    else expect(sample.entryState, `cycle ${cycle} did not receive fresh dungeon-local state`)
      .toEqual(entryStateSignature);

    const dungeonReferences = await page.evaluateHandle(() => ({
      bundle: window.game.activeWorldBundle,
      root: window.game.activeWorldBundle.root,
      controller: window.game.dungeonController,
    }));
    await abandonExpeditionThroughEntrance(page);
    await waitForOverworldAssetsSettled(page);

    const released = await page.evaluate((previous) => ({
      disposed: previous.bundle.disposed === true,
      detached: previous.root.parent === null,
      controllerReplaced: window.game.dungeonController !== previous.controller,
    }), dungeonReferences);
    expect(released, `cycle ${cycle} retained dungeon-owned runtime objects`).toEqual({
      disposed: true,
      detached: true,
      controllerReplaced: true,
    });
    await dungeonReferences.dispose();

    await page.requestGC();
    const postGcHeapBytes = await page.evaluate(() => (
      Number(performance.memory?.usedJSHeapSize) || null
    ));
    const world = await readWorldDiagnostics(page);
    overworldSamples.push({ ...world, postGcHeapBytes });
    expect(world.worldKind).toBe('overworld');
    expect(world.planHash).toBe(initialWorld.planHash);
  }

  expect(dungeonRootIds.size).toBe(5);
  for (const sample of dungeonSamples) {
    expect(sample).toMatchObject({
      status: 'applied',
      supplementRootCount: 1,
      disposableResourceCount: 1,
      controllerBoundToCurrentDungeon: true,
    });
    expect(sample.supplementRoomCount).toBe(sample.overlayRoomNodeCount);
    expect(sample.supplementRoomCount).toBeGreaterThanOrEqual(
      (sample.routeNetworkCount - sample.parentAnchoredRouteNetworkCount) * 2,
    );
    expect(sample.supplementRoomCount).toBeLessThanOrEqual(30);
    expect(sample.overlayModuleCount).toBe(
      sample.overlayRoomNodeCount + sample.overlayConnectorJunctionCount,
    );
    expect(sample.overlayPhysicalNodeCount).toBe(
      sample.overlayRoomNodeCount
        + sample.overlayConnectorModuleCount
        + sample.overlayConnectorJunctionCount,
    );
    expect(sample.overlayPhysicalNodeCount).toBe(
      sample.overlayModuleCount + sample.overlayConnectorModuleCount,
    );
  }
  for (const key of [
    'roomCount',
    'supplementRoomCount',
    'overlayModuleCount',
    'overlayPhysicalNodeCount',
    'overlayRoomNodeCount',
    'overlayConnectorModuleCount',
    'overlayConnectorJunctionCount',
    'overlayConnectorNodeCount',
    'routeNetworkCount',
    'parentAnchoredRouteNetworkCount',
    'geometryCount',
    'materialCount',
    'encounterCount',
    'hazardCount',
    'disposableResourceCount',
  ]) {
    expect(
      new Set(dungeonSamples.slice(2).map((sample) => sample[key])).size,
      `${key} did not plateau: ${JSON.stringify(dungeonSamples.map((sample) => sample[key]))}`,
    ).toBe(1);
  }
  for (const key of ['geometries', 'textures']) {
    const values = overworldSamples.slice(1).map(({ renderer }) => renderer[key]);
    expect(
      Math.max(...values) - Math.min(...values),
      `overworld renderer ${key} kept growing: ${JSON.stringify(values)}`,
    ).toBeLessThanOrEqual(1);
  }
  for (const key of [
    'activeRootObjectCount',
    'activeRootMeshCount',
    'activeRootLightCount',
    'sceneObjectCount',
    'scenePlayerRootCount',
    'sceneActiveWorldRootCount',
    'controllerRuntimeRootCount',
    'disposableResourceCount',
    'activeControllerCount',
  ]) {
    const values = overworldSamples.slice(1).map(({ ownership }) => ownership[key]);
    expect(new Set(values).size, `overworld ${key} did not plateau: ${JSON.stringify(values)}`)
      .toBe(1);
  }
  const cycleTwoHeapBytes = overworldSamples[1]?.postGcHeapBytes;
  const cycleFiveHeapBytes = overworldSamples.at(-1)?.postGcHeapBytes;
  expect(cycleTwoHeapBytes, 'Chromium did not expose a post-GC heap measurement').toBeTruthy();
  expect(cycleFiveHeapBytes).toBeLessThanOrEqual(cycleTwoHeapBytes * 1.1);
  expect(runtimeErrors.pageErrors).toEqual([]);
  expect(runtimeErrors.consoleErrors).toEqual([]);
});
