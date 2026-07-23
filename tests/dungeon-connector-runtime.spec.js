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

test('real V1 seed assembles signed vertical galleries, classic corridors, ladders, lifts, and track traps', async ({ page }) => {
  test.setTimeout(180_000);
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
      { timeout: 60_000 },
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
  await expect.poll(
    () => page.evaluate(() => {
      const visual = window.game?.getConnectorTrackTrapDiagnostics?.().visual;
      return visual?.loaded === true || Boolean(visual?.loadError);
    }),
    { timeout: 20_000 },
  ).toBe(true);

  const initial = await page.evaluate(() => {
    const { game } = window;
    const dungeon = game.dungeon;
    const elevationPlans = dungeon.connectionPlans.filter((plan) => (
      plan.connectorVariant?.elevationChange === true
    ));
    const lifts = dungeon.connectorLifts;
    const ladderAnimation = game.player.externalRig.animationMetadata.get('climbingLadder');
    const floorKeys = new Set(dungeon.floorTiles.map((tile) => (
      tile.floorKey
        ?? `${tile.x},${tile.z}@y${Number(tile.elevation ?? 0).toFixed(3)}`
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
      && Math.abs(plan.elevationDelta ?? 0) <= 0.001
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
    const controls = lifts.flatMap((lift) => (lift.controls ?? []).map((control) => ({
      id: control.id,
      liftId: lift.id,
      endpoint: control.endpoint,
      floorKey: lift.controlAnchors?.[control.endpoint]?.floorKey ?? null,
      onPhysicalLanding: floorKeys.has(lift.controlAnchors?.[control.endpoint]?.floorKey),
      outsideMovingPlatform: Math.abs(control.position.x - lift.center.x) > lift.surface.halfWidth
        || Math.abs(control.position.z - lift.center.z) > lift.surface.halfDepth,
      hasCollision: dungeon.solidZones.some((zone) => (
        zone.id === `${control.id}:collision`
      )),
    })));
    return {
      accepted: dungeon.progression.validation.accepted,
      validationErrors: dungeon.progression.validation.errors,
      roomIds: dungeon.rooms.map(({ id }) => id).sort(),
      connectorVariants: elevationPlans.map((plan) => plan.connectorVariantId).sort(),
      signedPlans: dungeon.connectionPlans.map((plan) => ({
        id: plan.id,
        connectorType: plan.connectorType,
        variantId: plan.connectorVariantId,
        traversalKind: plan.connectorVariant?.traversalKind ?? null,
        sourceElevation: plan.sourceElevation,
        destinationElevation: plan.destinationElevation,
        elevationDelta: plan.elevationDelta,
        direction: plan.direction,
        fromSocketElevation: plan.fromSocket?.elevation,
        toSocketElevation: plan.toSocket?.elevation,
        higherEndpoint: plan.higherEndpoint,
        lowerEndpoint: plan.lowerEndpoint,
        landingCount: plan.connectorVariant?.landings?.length ?? 0,
        apertureCount: plan.connectorVariant?.apertures?.length ?? 0,
      })),
      rooms: dungeon.rooms.map((room) => ({
        id: room.id,
        baseElevation: room.baseElevation,
        minY: room.minY,
        maxY: room.maxY,
        ceilingY: room.ceilingY,
      })),
      newConnectorsPreserveV1Presentation: elevationPlans.every((plan) => (
        plan.connectorPresentation?.baseFamily === 'v1_arch_corridor'
        && plan.connectorPresentation?.overlayFamily === plan.connectorVariant?.visualFamily
        && plan.connectorPresentation?.preservesV1Corridor === true
      )),
      classicCorridors,
      ladderCount: dungeon.ladders.length,
      ladderVisualCount,
      ladderContracts: dungeon.ladders.map((ladder) => ({
        id: ladder.id,
        direction: ladder.direction,
        bottomY: ladder.bottomY,
        topY: ladder.topY,
        bottomLandingCount: ladder.bottomLandingTiles?.length ?? 0,
        topLandingCount: ladder.topLandingTiles?.length ?? 0,
      })),
      ladderAnimation: {
        lockRootY: ladderAnimation.lockRootY,
        lockRootYToRest: ladderAnimation.lockRootYToRest,
        normalizeRootRotationToRest: ladderAnimation.normalizeRootRotationToRest,
      },
      liftCount: dungeon.connectorLifts.length,
      liftContracts: lifts.map((lift) => ({
        id: lift.id,
        direction: lift.direction,
        sourceElevation: lift.progressionSourceElevation,
        destinationElevation: lift.progressionDestinationElevation,
        initialElevation: lift.initialElevation,
        bottomElevation: lift.bottomElevation,
        topElevation: lift.topElevation,
        platformWidthMeters: lift.platformWidthMeters,
        platformDepthMeters: lift.platformDepthMeters,
        shaftWidthMeters: lift.shaftWidthMeters,
        shaftDepthMeters: lift.shaftDepthMeters,
        automatic: lift.automatic,
        requiresConsole: lift.requiresConsole,
        shaftHeadroomMeters: lift.shaftHeadroomMeters,
        riderClearanceMeters: lift.riderClearanceMeters,
        bottomLandingCount: lift.bottomLandingTiles?.length ?? 0,
        topLandingCount: lift.topLandingTiles?.length ?? 0,
        landingSills: (lift.landingSills ?? []).map((sill) => ({
          endpoint: sill.endpoint,
          spanMeters: sill.spanMeters,
          bridgeDepthMeters: sill.bridgeDepthMeters,
          topY: sill.topY,
          halfWidth: sill.halfWidth,
          halfDepth: sill.halfDepth,
          hasSurface: lift.landingSillSurfaces?.some((surface) => (
            surface.endpoint === sill.endpoint
            && surface.purpose === sill.purpose
            && Math.abs(surface.topY - sill.topY) <= 0.001
          )) === true,
        })),
        landingSillVisualCount: lift.object?.children?.filter((object) => (
          object.name?.startsWith('automaticConnectorLiftLandingSill_')
        )).length ?? 0,
        landingSillSupportCount: lift.object?.children?.filter((object) => (
          object.name === 'automaticConnectorLiftLandingSillSupport'
        )).length ?? 0,
      })),
      controls,
      galleries,
      wideDoors,
      upperPlanCount: upperPlans.length,
      upperPortalCount: dungeon.verticalPortals.length,
      upperPortalCoverageAccepted,
      runtime: game.getConnectorLiftDiagnostics(),
      traps: dungeon.connectorTrackTraps,
      trapInfrastructure: (dungeon.connectorTrackTrapInfrastructure ?? []).map((fixture) => ({
        id: fixture.id,
        trapId: fixture.trapId,
        connectionId: fixture.connectionId,
        trackLength: fixture.trackLength,
        railCount: fixture.object?.children?.filter((object) => (
          object.name === 'rotatingTrackTrapCeilingRail'
        )).length ?? 0,
        endStopCount: fixture.object?.children?.filter((object) => (
          object.name?.startsWith('rotatingTrackTrapPhysicalEndStop_')
        )).length ?? 0,
        ceilingSupportCount: fixture.object?.children?.filter((object) => (
          object.name?.startsWith('rotatingTrackTrapCeilingSupport_')
        )).length ?? 0,
        warningBandCount: fixture.object?.children?.filter((object) => (
          object.name === 'rotatingTrackTrapFloorWarningBand'
        )).length ?? 0,
        attachedToDungeon: fixture.object?.parent === dungeon.group,
      })),
      trapRuntime: game.getConnectorTrackTrapDiagnostics(),
      trapFacadeRuntime: dungeon.connectorTrackTrapRuntimeDiagnostics,
      trapVisualParity: game.getConnectorTrackTrapDiagnostics().traps.map((trap) => {
        const visual = dungeon.group.getObjectByName(`${trap.id}:visual`);
        const rotor = visual?.userData?.rotatingTrapRotor ?? null;
        return {
          id: trap.id,
          visualFound: Boolean(visual),
          meshCount: visual?.getObjectsByProperty?.('isMesh', true)?.length ?? 0,
          rotorDiameterMeters: visual?.userData?.rotorDiameterMeters ?? null,
          positionError: visual
            ? Math.hypot(
              visual.position.x - trap.currentPosition.x,
              visual.position.y - trap.currentPosition.y,
              visual.position.z - trap.currentPosition.z,
            )
            : Infinity,
          spinError: rotor
            ? Math.abs(rotor.rotation.y - trap.spinRadians)
            : Infinity,
        };
      }),
      standardDungeonVoidUnderlayCount: game.activeWorldBundle?.root
        ?.getObjectsByProperty?.('name', 'ruinVoidUnderlay')?.length ?? 0,
    };
  });

  expect(initial.accepted, initial.validationErrors.join('\n')).toBe(true);
  expect(initial.standardDungeonVoidUnderlayCount).toBe(0);
  expect(initial.roomIds).toEqual(EXPECTED_V1_ROOM_IDS);
  expect(initial.connectorVariants.length).toBeGreaterThanOrEqual(3);
  expect(initial.connectorVariants.length).toBeLessThanOrEqual(5);
  expect(initial.connectorVariants).toEqual(expect.arrayContaining([
    'automatic_lift_gallery_v1',
    'crested_slope_v1',
    'ladder_gallery_v1',
  ]));
  const elevationPlans = initial.signedPlans.filter(({ elevationDelta }) => (
    Math.abs(elevationDelta) > 0.001
  ));
  const levelPlans = initial.signedPlans.filter(({ elevationDelta }) => (
    Math.abs(elevationDelta) <= 0.001
  ));
  expect(elevationPlans).toHaveLength(initial.connectorVariants.length);
  expect(new Set(elevationPlans.map(({ direction }) => direction))).toEqual(
    new Set(['ascending', 'descending']),
  );
  expect(elevationPlans.every((plan) => (
    Math.abs(plan.elevationDelta) === 14
    && plan.destinationElevation - plan.sourceElevation === plan.elevationDelta
    && plan.fromSocketElevation === plan.sourceElevation
    && plan.toSocketElevation === plan.destinationElevation
    && plan.higherEndpoint
    && plan.lowerEndpoint
    && plan.higherEndpoint.elevation > plan.lowerEndpoint.elevation
    && plan.landingCount >= 4
  )), JSON.stringify(elevationPlans, null, 2)).toBe(true);
  expect(levelPlans.some(({ variantId }) => variantId === 'service_gallery_v1')).toBe(true);
  expect(levelPlans.every((plan) => (
    plan.sourceElevation === plan.destinationElevation
    && plan.direction === 'level'
    && plan.higherEndpoint === null
    && plan.lowerEndpoint === null
  )), JSON.stringify(levelPlans, null, 2)).toBe(true);
  const authoredRooms = initial.rooms.filter(({ id }) => !['hubTown', 'expeditionCamp'].includes(id));
  expect(authoredRooms.every((room) => (
    Number.isFinite(room.baseElevation)
    && Number.isFinite(room.minY)
    && Number.isFinite(room.maxY)
    && Number.isFinite(room.ceilingY)
    && room.ceilingY === room.maxY
    && room.minY <= room.baseElevation
    && room.maxY > room.baseElevation
  )), JSON.stringify(authoredRooms, null, 2)).toBe(true);
  const roomBases = authoredRooms.map(({ baseElevation }) => baseElevation);
  expect(Math.max(...roomBases) - Math.min(...roomBases)).toBeLessThanOrEqual(56);
  expect(Math.min(...roomBases)).toBeLessThan(0);
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
  )), JSON.stringify(initial.galleries, null, 2)).toBe(true);
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
  const ladderPlanCount = elevationPlans.filter(({ traversalKind }) => traversalKind === 'ladder').length;
  expect(initial.ladderCount).toBe(ladderPlanCount);
  expect(initial.ladderVisualCount).toBe(ladderPlanCount);
  expect(initial.ladderContracts.every((ladder) => (
    ['ascending', 'descending'].includes(ladder.direction)
    && ladder.topY - ladder.bottomY === 14
    && ladder.bottomLandingCount >= 9
    && ladder.topLandingCount >= 9
  )), JSON.stringify(initial.ladderContracts, null, 2)).toBe(true);
  expect(initial.ladderAnimation).toEqual({
    lockRootY: true,
    lockRootYToRest: true,
    normalizeRootRotationToRest: true,
  });
  const liftPlanCount = elevationPlans.filter(({ traversalKind }) => (
    traversalKind === 'automatic_lift'
  )).length;
  expect(initial.liftCount).toBe(liftPlanCount);
  expect(initial.liftContracts.every((lift) => (
    lift.automatic === true
    && lift.requiresConsole === false
    && lift.topElevation - lift.bottomElevation === 14
    && lift.destinationElevation - lift.sourceElevation === (lift.direction === 'ascending' ? 14 : -14)
    && lift.initialElevation === lift.sourceElevation
    && lift.platformWidthMeters === 8.4
    && lift.platformDepthMeters === 8.4
    && lift.shaftWidthMeters === 11.2
    && lift.shaftDepthMeters === 11.2
    && lift.shaftHeadroomMeters >= lift.riderClearanceMeters
    && lift.bottomLandingCount >= 9
    && lift.topLandingCount >= 9
    && lift.landingSills.length === 2
    && new Set(lift.landingSills.map(({ endpoint }) => endpoint)).size === 2
    && lift.landingSills.every((sill) => (
      sill.spanMeters === 8.4
      && Math.abs(sill.bridgeDepthMeters - 1.4) <= 0.001
      && sill.hasSurface
    ))
    && lift.landingSillVisualCount === 2
    && lift.landingSillSupportCount === 4
  )), JSON.stringify(initial.liftContracts, null, 2)).toBe(true);
  expect(initial.controls).toHaveLength(liftPlanCount * 2);
  expect(initial.controls.every((control) => (
    control.onPhysicalLanding && control.outsideMovingPlatform && control.hasCollision
  ))).toBe(true);
  expect(initial.runtime.mounted).toBe(true);
  expect(initial.runtime.liftCount).toBe(liftPlanCount);
  const trappedConnectorIds = new Set(initial.traps.map(({ connectionId }) => connectionId));
  expect(trappedConnectorIds.size).toBeGreaterThanOrEqual(1);
  expect(trappedConnectorIds.size).toBeLessThanOrEqual(Math.floor(elevationPlans.length * 0.4));
  expect([...trappedConnectorIds].every((connectionId) => {
    const count = initial.traps.filter((trap) => trap.connectionId === connectionId).length;
    return count >= 1 && count <= 3;
  })).toBe(true);
  expect(initial.trapInfrastructure).toHaveLength(initial.traps.length);
  expect(initial.trapInfrastructure.every((fixture) => (
    fixture.trackLength > 0
    && fixture.railCount === 1
    && fixture.endStopCount === 2
    && fixture.ceilingSupportCount === 2
    && fixture.warningBandCount === 3
    && fixture.attachedToDungeon
  )), JSON.stringify(initial.trapInfrastructure, null, 2)).toBe(true);
  expect(initial.traps.every((trap) => (
    trap.overlayId === 'rotating_ceiling_track_v1'
    && ['ascending', 'descending'].includes(trap.connectorDirection)
    && trap.patrolSpeedMetersPerSecond === 0.7
    && trap.alertSpeedMetersPerSecond === 3.2
    && trap.spinRadiansPerSecond === 3.2
    && trap.damage === 12
    && trap.reactionTier === 2
    && trap.pushStrength === 0.72
    && trap.rearmSeconds === 0.8
    && trap.placement?.transverseToConnector === true
    && trap.placement?.clearanceVerified === true
  )), JSON.stringify(initial.traps, null, 2)).toBe(true);
  expect(initial.trapRuntime).toMatchObject({
    mounted: true,
    invalidDescriptorCount: 0,
    trapCount: initial.traps.length,
    visualAcceptanceRequired: true,
    visualAcceptancePassed: true,
    visual: {
      loaded: true,
      loadCount: 1,
      activeInstanceCount: initial.traps.length,
      loadError: null,
    },
  });
  expect(initial.trapFacadeRuntime).toMatchObject({
    mounted: true,
    disposed: false,
    trapCount: initial.traps.length,
    invalidDescriptorCount: 0,
    visualAcceptanceRequired: true,
    visualAcceptancePassed: true,
  });
  expect(initial.trapFacadeRuntime.traps.map(({ id }) => id).sort()).toEqual(
    initial.trapRuntime.traps.map(({ id }) => id).sort(),
  );
  expect(initial.trapRuntime.traps.every((trap) => (
    trap.visualReady && trap.visualAttached && !trap.visualError
  ))).toBe(true);
  expect(initial.trapVisualParity.every((visual) => (
    visual.visualFound
    && visual.meshCount > 0
    && visual.rotorDiameterMeters === 2.2
    && visual.positionError <= 0.001
    && visual.spinError <= 0.001
  )), JSON.stringify(initial.trapVisualParity, null, 2)).toBe(true);

  const trapMotionBefore = new Map(initial.trapRuntime.traps.map((trap) => [
    trap.id,
    trap.distanceTravelledMeters,
  ]));
  await page.waitForTimeout(1_200);
  const trapMotionAfter = await page.evaluate(() => {
    const diagnostics = window.game.getConnectorTrackTrapDiagnostics();
    return diagnostics.traps.map((trap) => {
      const visual = window.game.dungeon.group.getObjectByName(`${trap.id}:visual`);
      const rotor = visual?.userData?.rotatingTrapRotor ?? null;
      return {
        id: trap.id,
        distanceTravelledMeters: trap.distanceTravelledMeters,
        positionError: visual
          ? Math.hypot(
            visual.position.x - trap.currentPosition.x,
            visual.position.y - trap.currentPosition.y,
            visual.position.z - trap.currentPosition.z,
          )
          : Infinity,
        spinError: rotor ? Math.abs(rotor.rotation.y - trap.spinRadians) : Infinity,
      };
    });
  });
  expect(trapMotionAfter.every((trap) => (
    trap.distanceTravelledMeters > trapMotionBefore.get(trap.id)
    && trap.positionError <= 0.001
    && trap.spinError <= 0.001
  )), JSON.stringify(trapMotionAfter, null, 2)).toBe(true);

  await expect.poll(
    () => page.evaluate(() => (
      Math.min(...window.game.getConnectorLiftDiagnostics().lifts.map((lift) => (
        lift.completedTrips ?? 0
      )))
    )),
    { timeout: 60_000 },
  ).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
