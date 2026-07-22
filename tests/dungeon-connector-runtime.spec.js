import { expect, test } from '@playwright/test';

const EXPECTED_V1_ROOM_IDS = [
  'alienServerRoom',
  'bonusVault',
  'bossRoom',
  'conveyorRoom',
  'coolantRelayRoom',
  'enemyNest',
  'entrance',
  'expeditionCamp',
  'hubTown',
  'keycardRoom',
  'machineFactoryRoom',
  'shrineRoom',
  'trapRoom',
].sort();

test('real V1 seed assembles wide arched galleries, ladder animation, and an automatic recallable lift', async ({ page }) => {
  test.setTimeout(45_000);
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/?startupWorld=dungeon&dungeonSeed=connector-c');
  try {
    await expect.poll(
      () => page.locator('#game-container').getAttribute('data-browser-test-ready'),
      { timeout: 20_000 },
    ).toBe('true');
  } catch (error) {
    throw new Error([
      error.message,
      ...pageErrors.map((message) => `pageerror: ${message}`),
      ...consoleErrors.map((message) => `console: ${message}`),
    ].join('\n'));
  }
  await expect.poll(
    () => page.evaluate(() => Boolean(
      window.game?.player?.externalRig?.animationMetadata?.has('climbingLadder'),
    )),
    { timeout: 20_000 },
  ).toBe(true);

  const initial = await page.evaluate(() => {
    const { game } = window;
    const dungeon = game.dungeon;
    const variedPlans = dungeon.connectionPlans.filter((plan) => plan.connectorVariant);
    const lift = dungeon.connectorLifts[0];
    const ladderAnimation = game.player.externalRig.animationMetadata.get('climbingLadder');
    const floorKeys = new Set(dungeon.floorTiles.map((tile) => (
      `${tile.x},${tile.z}@${tile.level ?? 0}`
    )));
    const floorsByColumn = new Map();
    for (const floor of dungeon.floorTiles) {
      const key = `${floor.x},${floor.z}`;
      const column = floorsByColumn.get(key) ?? [];
      column.push(floor);
      floorsByColumn.set(key, column);
    }
    const roomById = new Map(dungeon.rooms.map((room) => [room.id, room]));
    const isInteriorPlan = (plan) => (
      !['hub', 'camp'].includes(roomById.get(plan.fromRoomId)?.type)
      && !['hub', 'camp'].includes(roomById.get(plan.toRoomId)?.type)
    );
    const classicPlans = dungeon.connectionPlans.filter((plan) => (
      isInteriorPlan(plan)
      && !plan.connectorVariant
      && plan.connectorPresentation?.overlayFamily === 'v1_service_bay'
    ));
    let ladderVisualCount = 0;
    const decorativeArchVisualCounts = new Map();
    const decorativeArchVisualProfiles = new Map();
    const classicFurnishingVisuals = new Map();
    dungeon.group.traverse((object) => {
      if (object.name?.startsWith('dungeonConnectorLadder_')) ladderVisualCount += 1;
      if (object.userData?.connectorDecorativeArch) {
        const connectorId = object.userData.connectorId;
        decorativeArchVisualCounts.set(
          connectorId,
          (decorativeArchVisualCounts.get(connectorId) ?? 0) + 1,
        );
        const profiles = decorativeArchVisualProfiles.get(connectorId) ?? [];
        const torus = object.getObjectByName('industrialCylinderArch');
        profiles.push({
          minimumLaneHeadroomMeters: object.userData.archClearanceProfile
            ?.minimumLaneHeadroomMeters ?? null,
          torusVerticalScale: torus?.scale?.y ?? null,
          declaredTorusVerticalScale: object.userData.archClearanceProfile
            ?.torusVerticalScale ?? null,
        });
        decorativeArchVisualProfiles.set(connectorId, profiles);
      }
      if (object.userData?.classicV1CorridorFurnishing) {
        const connectorId = object.userData.connectorId;
        const visuals = classicFurnishingVisuals.get(connectorId) ?? [];
        visuals.push({
          serviceBeatId: object.userData.serviceBeatId,
          keepsTravelEnvelopeClear: object.userData.keepsTravelEnvelopeClear,
        });
        classicFurnishingVisuals.set(connectorId, visuals);
      }
    });
    const galleries = dungeon.connectionPlans
      .filter((plan) => (
        (plan.galleryCrossSections?.length ?? 0) > 0
        && isInteriorPlan(plan)
      ))
      .map((plan) => {
        const sectionWidths = (plan.galleryCrossSections ?? []).flatMap((crossSection) => (
          (crossSection.sections ?? []).map((section) => {
            const points = [section.center, ...(section.lateralPoints ?? [])];
            const centerFloors = floorsByColumn.get(`${section.center.x},${section.center.z}`) ?? [];
            return centerFloors.some((centerFloor) => points.every((point) => (
              (floorsByColumn.get(`${point.x},${point.z}`) ?? []).some((floor) => (
                Math.abs((floor.elevation ?? 0) - (centerFloor.elevation ?? 0)) <= 0.05
              ))
            ))) ? points.length : 0;
          })
        ));
        const arches = [...(plan.decorativeArchBeats ?? [])].sort((a, b) => a.pathIndex - b.pathIndex);
        const visualProfiles = decorativeArchVisualProfiles.get(plan.id) ?? [];
        return {
          id: plan.id,
          level: plan.level,
          minimumWidthTiles: Math.min(...sectionWidths),
          crossSectionCount: sectionWidths.length,
          archPlanCount: arches.length,
          archVisualCount: decorativeArchVisualCounts.get(plan.id) ?? 0,
          minimumArchClearWidth: Math.min(...arches.map((arch) => arch.internalClearWidthMeters)),
          minimumOuterLaneHeadroom: Math.min(...arches.map((arch) => (
            arch.minimumLaneHeadroomMeters
          ))),
          minimumVisualOuterLaneHeadroom: Math.min(...visualProfiles.map((profile) => (
            profile.minimumLaneHeadroomMeters
          ))),
          visualProfileParity: visualProfiles.every((profile) => (
            Number.isFinite(profile.torusVerticalScale)
            && Math.abs(profile.torusVerticalScale - profile.declaredTorusVerticalScale) < 0.000001
          )),
          maximumArchSpacing: Math.max(0, ...arches.slice(1).map((arch, index) => (
            arch.pathIndex - arches[index].pathIndex
          ))),
        };
      });
    const classicCorridors = classicPlans.map((plan) => {
      const serviceBeats = plan.classicV1ServiceBeats ?? [];
      const plannedBeatIds = serviceBeats
        .map((beat) => beat.id)
        .sort();
      const visuals = classicFurnishingVisuals.get(plan.id) ?? [];
      const visualBeatIds = visuals.map((visual) => visual.serviceBeatId).sort();
      return {
        id: plan.id,
        baseFamily: plan.connectorPresentation?.baseFamily,
        overlayFamily: plan.connectorPresentation?.overlayFamily,
        preservesV1Corridor: plan.connectorPresentation?.preservesV1Corridor,
        plannedBeatCount: plannedBeatIds.length,
        visualBeatCount: visualBeatIds.length,
        visualParity: JSON.stringify(plannedBeatIds) === JSON.stringify(visualBeatIds),
        declaresClassicArchServiceAndGirder: serviceBeats.every((beat) => (
          ['pump', 'water_tank'].includes(beat.serviceKind)
          && Number.isFinite(beat.servicePoint?.x)
          && Number.isFinite(beat.servicePoint?.z)
          && Number.isFinite(beat.fencePoint?.x)
          && Number.isFinite(beat.fencePoint?.z)
          && Number.isFinite(beat.girderPoint?.x)
          && Number.isFinite(beat.girderPoint?.z)
          && beat.girderWidthMeters >= 5.6
        )),
        plannedTravelEnvelopeClear: serviceBeats.every((beat) => {
          const serviceDistance = Math.hypot(
            beat.servicePoint.x - beat.galleryCenter.x,
            beat.servicePoint.z - beat.galleryCenter.z,
          ) * dungeon.tileSize;
          return beat.keepsTravelEnvelopeClear === true
            && beat.minimumTravelClearanceMeters > 0
            && serviceDistance - beat.serviceHalfExtentMeters + 1e-6
              >= beat.travelEnvelopeHalfWidthMeters;
        }),
        travelEnvelopeClear: visuals.every((visual) => (
          visual.keepsTravelEnvelopeClear === true
        )),
      };
    });
    const wideDoors = dungeon.doors
      .filter((door) => door.connectionPlanId)
      .map((door) => ({
        id: door.id,
        portalSpan: door.thresholdPortalSpan,
        transverseCollisionSpan: (door.alongX ? door.collisionHalfDepth : door.collisionHalfWidth) * 2,
        slidingOpenOffset: door.slidingOpenOffset,
      }));
    const upperPlans = dungeon.connectionPlans.filter((plan) => plan.level > 0);
    const upperPortalCoverageAccepted = upperPlans.every((plan) => (
      [plan.fromSocket, plan.toSocket].every((socket) => {
        const portal = dungeon.verticalPortals.find((candidate) => (
          candidate.id === socket.id && candidate.connectionId === plan.id
        ));
        return portal?.portalSpan >= 5.6
          && portal.object?.userData?.verticalPortal?.portalSpan === portal.portalSpan
          && portal.object?.userData?.verticalPortal?.connectionId === plan.id;
      })
    ));
    const controls = (lift?.controls ?? []).map((control) => ({
      id: control.id,
      endpoint: control.endpoint,
      floorKey: lift?.controlAnchors?.[control.endpoint]?.floorKey ?? null,
      onPhysicalLanding: floorKeys.has(lift?.controlAnchors?.[control.endpoint]?.floorKey),
      outsideMovingPlatform: Math.abs(control.position.x - lift.center.x) > lift.surface.halfWidth
        || Math.abs(control.position.z - lift.center.z) > lift.surface.halfDepth,
      hasCollision: dungeon.solidZones.some((zone) => (
        zone.id === `${control.id}:collision`
      )),
    }));
    return {
      accepted: dungeon.progression.validation.accepted,
      validationErrors: dungeon.progression.validation.errors,
      roomIds: dungeon.rooms.map(({ id }) => id).sort(),
      connectorVariants: variedPlans.map((plan) => plan.connectorVariantId).sort(),
      newConnectorsPreserveV1Presentation: variedPlans.every((plan) => (
        plan.connectorPresentation?.baseFamily === 'v1_arch_corridor'
        && plan.connectorPresentation?.overlayFamily === plan.connectorVariant?.visualFamily
        && plan.connectorPresentation?.preservesV1Corridor === true
      )),
      classicCorridors,
      ladderCount: dungeon.ladders.length,
      ladderVisualCount,
      ladderAnimation: {
        lockRootY: ladderAnimation.lockRootY,
        lockRootYToRest: ladderAnimation.lockRootYToRest,
        normalizeRootRotationToRest: ladderAnimation.normalizeRootRotationToRest,
      },
      liftCount: dungeon.connectorLifts.length,
      liftAutomatic: lift?.automatic ?? null,
      liftRequiresConsole: lift?.requiresConsole ?? null,
      liftHeadroom: lift?.shaftHeadroomMeters ?? null,
      liftRiderClearance: lift?.riderClearanceMeters ?? null,
      controls,
      galleries,
      wideDoors,
      upperPlanCount: upperPlans.length,
      upperPortalCount: dungeon.verticalPortals.length,
      upperPortalCoverageAccepted,
      runtime: game.getConnectorLiftDiagnostics(),
    };
  });

  expect(initial.accepted, initial.validationErrors.join('\n')).toBe(true);
  expect(initial.roomIds).toEqual(EXPECTED_V1_ROOM_IDS);
  expect(initial.connectorVariants).toEqual(expect.arrayContaining([
    'automatic_lift_gallery_v1',
    'ladder_gallery_v1',
  ]));
  expect(initial.newConnectorsPreserveV1Presentation).toBe(true);
  expect(initial.classicCorridors.length).toBeGreaterThan(0);
  expect(initial.classicCorridors.every((corridor) => (
    corridor.baseFamily === 'v1_arch_corridor'
    && corridor.overlayFamily === 'v1_service_bay'
    && corridor.preservesV1Corridor === true
    && corridor.plannedBeatCount > 0
    && corridor.visualBeatCount === corridor.plannedBeatCount
    && corridor.visualParity
    && corridor.declaresClassicArchServiceAndGirder
    && corridor.plannedTravelEnvelopeClear
    && corridor.travelEnvelopeClear
  )), JSON.stringify(initial.classicCorridors, null, 2)).toBe(true);
  expect(initial.galleries.length).toBeGreaterThan(0);
  expect(initial.galleries.every((gallery) => (
    gallery.crossSectionCount > 0
    && gallery.minimumWidthTiles >= 3
    && gallery.archPlanCount > 0
    && gallery.archVisualCount === gallery.archPlanCount
    && gallery.minimumArchClearWidth >= 5.6
    && gallery.minimumOuterLaneHeadroom >= 3.15
    && gallery.minimumVisualOuterLaneHeadroom >= 3.15
    && gallery.visualProfileParity
    && gallery.maximumArchSpacing <= 3
  ))).toBe(true);
  const upperGalleries = initial.galleries.filter((gallery) => gallery.level > 0);
  expect(upperGalleries.length).toBeGreaterThan(0);
  expect(upperGalleries.every((gallery) => (
    gallery.crossSectionCount > 0
    && gallery.minimumWidthTiles >= 3
    && gallery.archPlanCount > 0
    && gallery.archVisualCount === gallery.archPlanCount
    && gallery.minimumOuterLaneHeadroom >= 3.15
  ))).toBe(true);
  expect(initial.upperPlanCount).toBeGreaterThan(0);
  expect(initial.upperPortalCount).toBe(initial.upperPlanCount * 2);
  expect(initial.upperPortalCoverageAccepted).toBe(true);
  expect(initial.wideDoors.length).toBeGreaterThan(0);
  expect(initial.wideDoors.every((door) => (
    door.portalSpan >= 5.6
    && door.transverseCollisionSpan >= door.portalSpan
    && door.slidingOpenOffset >= door.portalSpan * 0.5
  ))).toBe(true);
  expect(initial.ladderCount).toBe(2);
  expect(initial.ladderVisualCount).toBe(2);
  expect(initial.ladderAnimation).toEqual({
    lockRootY: true,
    lockRootYToRest: true,
    normalizeRootRotationToRest: true,
  });
  expect(initial.liftCount).toBe(1);
  expect(initial.liftAutomatic).toBe(true);
  expect(initial.liftRequiresConsole).toBe(false);
  expect(initial.liftHeadroom).toBeGreaterThanOrEqual(initial.liftRiderClearance);
  expect(initial.controls).toHaveLength(2);
  expect(initial.controls.every((control) => (
    control.onPhysicalLanding && control.outsideMovingPlatform && control.hasCollision
  ))).toBe(true);
  expect(initial.runtime.mounted).toBe(true);
  expect(initial.runtime.liftCount).toBe(1);

  await expect.poll(
    () => page.evaluate(() => (
      window.game.getConnectorLiftDiagnostics().lifts[0]?.completedTrips ?? 0
    )),
    { timeout: 10_000 },
  ).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
