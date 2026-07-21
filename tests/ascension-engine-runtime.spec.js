import { expect, test } from '@playwright/test';

const ASCENSION_PROFILE_ID = 'ascensionEngine';
const ASCENSION_ENVIRONMENT_ID = 'verticalTransitReliquary';
const BOSS_RESOURCE_LIMITS = Object.freeze({
  projectiles: 20,
  telegraphs: 12,
  constructs: 8,
});

async function waitForGame(page) {
  await page.waitForFunction(() => Boolean(window.game?.spawner && window.game?.ui));
}

async function selectAscensionHunt(page) {
  return page.evaluate(async (profileId) => {
    const game = window.game;
    game.stop();
    return game.selectBossHunt(profileId);
  }, ASCENSION_PROFILE_ID);
}

test('selected Ascension Engine hunt builds the authored Vertical Transit Reliquary contract', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=ascension-reliquary-runtime');
  await waitForGame(page);

  expect(await selectAscensionHunt(page)).toMatchObject({
    ok: true,
    bossProfileId: ASCENSION_PROFILE_ID,
  });
  await page.waitForFunction(() => {
    const group = window.game?.dungeon?.group;
    const roll = group?.getObjectByName('rollCaskettNpc')?.userData;
    const supportCar = group?.getObjectByName('expeditionSupportCar')?.userData;
    const workbench = group?.getObjectByName('rollWorkshopWorkbench')?.userData;
    return Boolean(
      roll?.modelLoaded
      && roll?.animationAssetsSettled
      && supportCar?.modelLoaded
      && workbench?.textureAssetsSettled
    );
  }, null, { timeout: 45_000 });

  const result = await page.evaluate(async () => {
    const game = window.game;
    const stage = game.bossStageRuntime;
    const {
      ASCENSION_ENGINE_TUNING,
      getAscensionTraversalDiagnostics,
    } = await import('/src/reaverbots/bosses/AscensionEngineContract.js');
    const { AscensionEngineEncounter } = await import('/src/reaverbots/bosses/AscensionEngineEncounter.js');
    const { createAscensionEngineEncounterProgress } = await import('/src/buster/BusterLabStorage.js');
    const manifest = stage?.getManifest?.();
    const dedicatedRoomIds = [
      'hubTown',
      'expeditionCamp',
      'entrance',
      'compressionFoundry',
      'brokenElevatorSpine',
      'suspendedMachinerySea',
      'summitTrial',
    ];
    const stockInteriorRoomIds = [
      'enemyNest',
      'keycardRoom',
      'trapRoom',
      'conveyorRoom',
      'bossRoom',
      'shrineRoom',
      'alienServerRoom',
      'machineFactoryRoom',
      'coolantRelayRoom',
      'bonusVault',
    ];
    const bossEncounter = game.dungeon.encounters.find((encounter) => encounter.isBoss);
    const routeRoles = [0, 1, 2, 3].map((segmentIndex) => (
      stage.getRoutePlatforms(segmentIndex).map((platform) => platform.role)
    ));
    const platformIds = stage.platforms.map((platform) => platform.id);
    const output = {
      selectedProfileId: game.getSelectedBossProfileId(),
      environmentId: game.dungeon.specialEnvironmentId,
      runtimeEnvironmentId: stage?.id,
      rootName: stage?.root?.name,
      authoredMarker: stage?.root?.userData?.authoredBossEnvironment,
      rootAttached: stage?.root?.parent === game.dungeon.group,
      dungeonKind: game.dungeon.dungeonKind,
      replacesStandardDungeon: game.dungeon.replacesStandardDungeon,
      encounterProfileId: bossEncounter?.bossProfileId,
      encounterEnvironmentId: bossEncounter?.specialEnvironmentId,
      dedicatedWorld: {
        roomIds: game.dungeon.rooms.map((room) => room.id),
        exteriorRooms: game.dungeon.rooms
          .filter((room) => ['hubTown', 'expeditionCamp', 'entrance'].includes(room.id))
          .map(({ id, type, x, z, width, depth }) => ({ id, type, x, z, width, depth })),
        unexpectedRoomIds: game.dungeon.rooms
          .map((room) => room.id)
          .filter((roomId) => !dedicatedRoomIds.includes(roomId)),
        forbiddenInteriorRoomIds: game.dungeon.rooms
          .map((room) => room.id)
          .filter((roomId) => stockInteriorRoomIds.includes(roomId)),
        tileCount: game.dungeon.tiles.size,
        floorTileCount: game.dungeon.floorTiles.length,
        floorTileVisualCount: game.dungeon.group.getObjectsByProperty(
          'name',
          'dungeonFloorTileVisual',
        ).length,
        doorCount: game.dungeon.doors.length,
        keycardCount: game.dungeon.keycards.length,
        trapCount: game.dungeon.traps.length,
        conveyorCount: game.dungeon.conveyors.length,
        nonBossEncounterCount: game.dungeon.encounters.filter((encounter) => !encounter.isBoss).length,
        exteriorObjects: [
          'minimalHubTown',
          'hubTownGarageWorkbench',
          'minimalExpeditionCamp',
          'expeditionCampTent',
          'expeditionQuestBoard',
          'rollSupportCampWorkshop',
          'expeditionSupportCar',
          'rollCaskettNpc',
          'rollWorkshopWorkbench',
          'expeditionRuinResetConsole',
          'expeditionRuinLift',
          'expeditionCampEntrancePad',
        ].map((name) => ({ name, present: Boolean(game.dungeon.group.getObjectByName(name)) })),
        interactables: game.dungeon.safeInteractables.map((entry) => ({
          id: entry.id,
          action: entry.action,
        })),
        safeZoneRoomIds: game.dungeon.safeZones.map((zone) => zone.roomId).sort(),
        campPlatformIds: game.dungeon.platforms
          .map((platform) => platform.id)
          .filter((id) => /^camp(?:LowJump|HighClimb|HighGap|Return)Deck$/.test(id))
          .sort(),
        exteriorCollisionIds: game.dungeon.solidZones
          .map((zone) => zone.id)
          .filter((id) => [
            'expeditionSupportCarCollision',
            'rollWorkshopWorkbenchCollision',
          ].includes(id))
          .sort(),
        rollInteractableId: game.dungeonController.rollInteractable?.id ?? null,
        keySeekerId: game.dungeon.keySeeker?.id ?? null,
        npcAssets: {
          rollModelLoaded: game.dungeon.group.getObjectByName('rollCaskettNpc')?.userData?.modelLoaded === true,
          rollAnimatorRegistered: Boolean(
            game.dungeon.group.getObjectByName('rollCaskettNpc')?.userData?.rollAnimator,
          ),
          supportCarModelLoaded: game.dungeon.group
            .getObjectByName('expeditionSupportCar')?.userData?.modelLoaded === true,
          workbenchTexturesSettled: game.dungeon.group
            .getObjectByName('rollWorkshopWorkbench')?.userData?.textureAssetsSettled === true,
        },
      },
      manifest: manifest ? {
        id: manifest.id,
        revision: manifest.revision,
        profileId: manifest.profileId,
        checkpointIds: [...manifest.checkpointIds],
        sealStationIds: [...manifest.sealStationIds],
        platformIds: [...manifest.platformIds],
        masteryPlatformIds: [...manifest.masteryPlatformIds],
        collisionZoneIds: [...manifest.collisionZoneIds],
        spatial: { ...manifest.spatial },
      } : null,
      routeRoles,
      platformCount: stage?.platforms?.length ?? 0,
      dungeonPlatformCount: game.dungeon.platforms.length,
      preparationPlatformCount: game.dungeon.platforms.filter((platform) => (
        !stage.platforms.includes(platform)
      )).length,
      uniquePlatformIdCount: new Set(platformIds).size,
      allPlatformsRegistered: stage?.platforms?.every((platform) => (
        game.dungeon.platforms.includes(platform)
        && game.platformingPlatforms.includes(platform)
      )),
      activeSegment: stage?.activeSegmentIndex,
      enabledSegments: [...new Set(stage?.platforms
        ?.filter((platform) => platform.enabled)
        .map((platform) => platform.segmentIndex)
        .filter(Number.isInteger))],
    };
    const victories = game.busterLabStorage.state.bossHunts.victoriesByProfile;
    const previousAscensionVictories = victories.ascensionEngine;
    const previousConventionalVictories = victories.revolvingFusillade;
    victories.ascensionEngine = 1;
    victories.revolvingFusillade = 1;
    const repeatProfiles = game.getBossHuntViewModel().profiles;
    output.repeatStatuses = {
      ascension: repeatProfiles.find((profile) => profile.id === 'ascensionEngine')?.repeatStatus,
      conventional: repeatProfiles.find((profile) => profile.id === 'revolvingFusillade')?.repeatStatus,
    };
    if (previousAscensionVictories === undefined) delete victories.ascensionEngine;
    else victories.ascensionEngine = previousAscensionVictories;
    if (previousConventionalVictories === undefined) delete victories.revolvingFusillade;
    else victories.revolvingFusillade = previousConventionalVictories;

    const collisionZoneIds = [...manifest.collisionZoneIds];
    output.collisionContract = {
      ids: collisionZoneIds,
      uniqueIdCount: new Set(collisionZoneIds).size,
      matchesStageZones: collisionZoneIds.join('|') === stage.collisionZones.map((zone) => zone.id).join('|'),
      allRegisteredInDungeon: collisionZoneIds.every((id) => (
        game.dungeon.solidZones.some((zone) => zone.id === id)
      )),
      allRegisteredInController: collisionZoneIds.every((id) => (
        game.dungeonController.solidZones.some((zone) => zone.id === id)
      )),
    };
    const supportSummary = (position) => {
      const support = game.getPlatformSupport(position);
      return support ? { id: support.surface.id, elevation: support.elevation } : null;
    };
    const voidPoint = stage.center.clone().setY(1);
    const initialCheckpoint = stage.getCheckpoint(0);
    const initialPoint = initialCheckpoint.position.clone().setY(initialCheckpoint.platform.topY + 0.2);
    stage.setActiveSegment(3);
    const summitPlatform = stage.sealPlatforms[3].platform;
    const summitPoint = summitPlatform.center.clone().setY(summitPlatform.topY + 0.2);
    const summitCorner = summitPlatform.center.clone().set(
      summitPlatform.center.x + summitPlatform.halfWidth * 0.95,
      summitPlatform.topY + 0.2,
      summitPlatform.center.z + summitPlatform.halfDepth * 0.95,
    );
    const summitInterior = summitPlatform.center.clone().set(
      summitPlatform.center.x + summitPlatform.radius * 0.5,
      summitPlatform.topY + 0.2,
      summitPlatform.center.z,
    );
    output.spatialContract = {
      void: {
        walkable: game.dungeonController.isPositionWalkable(voidPoint),
        floorElevation: game.dungeonController.getFloorElevationAt(voidPoint),
        surfaceElevation: game.dungeonController.getSurfaceElevationAt(voidPoint),
        support: supportSummary(voidPoint),
      },
      initialCheckpoint: {
        walkable: game.dungeonController.isPositionWalkable(initialPoint),
        support: supportSummary(initialPoint),
        containsTop: initialCheckpoint.platform.containsTop(initialPoint),
      },
      summit: {
        walkable: game.dungeonController.isPositionWalkable(summitPoint),
        support: supportSummary(summitPoint),
        cornerInside: summitPlatform.containsTop(summitCorner),
        interiorInside: summitPlatform.containsTop(summitInterior),
        radial: summitPlatform.radial,
        radius: summitPlatform.radius,
      },
    };
    stage.setActiveSegment(0);

    const masteryState = () => stage.masteryPlatforms.map((platform) => ({
      id: platform.id,
      segmentIndex: platform.segmentIndex,
      enabled: platform.enabled,
      active: platform.active,
      visible: platform.group.visible,
      requiresGearId: platform.requiresGearId,
    }));
    const routeState = (segmentIndex) => stage.getRoutePlatforms(segmentIndex).map((platform) => ({
      id: platform.id,
      sequence: platform.sequence,
      unlocked: platform.routeUnlocked,
      enabled: platform.enabled,
      active: platform.active,
      visible: platform.group.visible,
      createsLedgeCandidates: platform.createsLedgeCandidates,
    }));
    output.routeGateResults = [0, 1, 2, 3].map((segmentIndex) => {
      stage.setActiveSegment(segmentIndex);
      stage.resetSegment(segmentIndex);
      const initial = routeState(segmentIndex);
      const impacted = stage.commandPlatformImpact(segmentIndex, 0);
      const afterFirstImpact = routeState(segmentIndex);
      stage.resetSegment(segmentIndex);
      const afterReset = routeState(segmentIndex);
      return {
        segmentIndex,
        impactedSequence: impacted?.sequence ?? null,
        initial,
        afterFirstImpact,
        afterReset,
      };
    });
    const routePlatformIds = stage.platforms
      .filter((platform) => platform.routeId)
      .map((platform) => platform.id);
    output.routeLedgeContract = {
      allDisableLedgeCandidates: stage.platforms
        .filter((platform) => platform.routeId)
        .every((platform) => platform.createsLedgeCandidates === false),
      registeredRouteLedgeCandidates: game.platformingLedgeCandidates
        .filter((candidate) => routePlatformIds.some((id) => candidate.id.startsWith(`${id}-`)))
        .map((candidate) => candidate.id),
    };
    stage.setActiveSegment(0);
    stage.resetSegment(0);

    game.player.gearLoadout.unequip('mobility');
    game.player.gearEffects = game.player.gearLoadout.getEffects();
    output.ordinaryLoadout = {
      mobilityId: game.player.gearLoadout.getId('mobility'),
      jumpReachMultiplier: game.player.gearEffects.jumpReachMultiplier,
    };
    stage.prePlayerUpdate(1 / 60, game);
    output.ordinaryMasteryState = masteryState();
    const unlockResult = game.player.gearLoadout.unlock('jumpSprings');
    const equipResult = game.player.gearLoadout.equip('jumpSprings', 'mobility');
    game.player.gearEffects = game.player.gearLoadout.getEffects();
    output.jumpSpringsLoadout = {
      unlockOk: unlockResult.ok,
      equipOk: equipResult.ok,
      mobilityId: game.player.gearLoadout.getId('mobility'),
      jumpReachMultiplier: game.player.gearEffects.jumpReachMultiplier,
    };
    stage.prePlayerUpdate(1 / 60, game);
    output.jumpSpringsSegmentZeroState = masteryState();
    stage.setActiveSegment(2);
    output.jumpSpringsSegmentTwoState = masteryState();
    stage.setActiveSegment(0);

    const spawned = game.debugSpawnBoss('ascensionEngine');
    if (!spawned.ok) throw new Error(spawned.message ?? spawned.reason);
    const boss = spawned.boss;
    boss.specialEncounter.dispose(game, 'resume-rebuild');
    boss.expeditionSpec = {
      ...boss.expeditionSpec,
      encounterProgress: createAscensionEngineEncounterProgress(3),
    };
    boss.specialEncounter = new AscensionEngineEncounter(boss);
    boss.update(0, game);
    const encounter = boss.specialEncounter;
    output.summitResume = {
      segmentIndex: encounter.state.segmentIndex,
      securedCheckpoint: encounter.state.securedCheckpoint,
      brokenSeals: [...encounter.state.brokenSeals],
      phase: boss.bossState.phase,
      transitionRemaining: boss.bossState.transitionRemaining,
      healthRatio: boss.health / boss.stats.maxHealth,
      activeStageSegment: stage.activeSegmentIndex,
    };
    encounter._prepareSummitLaunch();
    const summitVent = stage.getRoutePlatforms(3)[0];
    encounter.ventLaunchCooldowns.delete(summitVent.routeId);
    game.player.restoreTraversalCheckpoint({
      position: summitVent.center.clone().setY(summitVent.topY),
      facing: stage.getSealStation(3).position.clone().sub(summitVent.center).setY(0),
      healthFloorRatio: 1,
    });
    const originalLaunch = game.player.launchFromTraversalMechanism.bind(game.player);
    let observedSummitLaunch = null;
    game.player.launchFromTraversalMechanism = (options) => {
      const launched = originalLaunch(options);
      observedSummitLaunch = {
        verticalVelocity: options.verticalVelocity,
        horizontalSpeed: options.horizontalSpeed,
        sourceId: options.sourceId,
        launched,
        playerVelocityY: game.player.velocity.y,
      };
      return launched;
    };
    const summitLaunchPreconditions = {
      ventState: summitVent.ventState,
      enabled: summitVent.enabled,
      active: summitVent.active,
      containsPlayer: summitVent.containsTop(game.player.root.position, 0.12),
      playerHeightDelta: Math.abs(game.player.root.position.y - summitVent.topY),
      playerAirborne: game.player.isJumpAirborne(),
      playerDead: game.player.dead,
      coolingDown: encounter.ventLaunchCooldowns.has(summitVent.routeId),
    };
    encounter._updateVentStates(0);
    game.player.launchFromTraversalMechanism = originalLaunch;
    const diagnostics = getAscensionTraversalDiagnostics();
    output.summitLaunch = {
      observed: observedSummitLaunch,
      preconditions: summitLaunchPreconditions,
      tunedVelocity: ASCENSION_ENGINE_TUNING.summitLaunchVelocity,
      diagnostic: { ...diagnostics.summitLaunch },
    };
    boss.dispose();
    boss.root.removeFromParent();
    const bossIndex = game.enemies.indexOf(boss);
    if (bossIndex >= 0) game.enemies.splice(bossIndex, 1);

    const platformRefs = [...stage.platforms];
    stage.dispose();
    output.cleanup = {
      disposed: stage.disposed,
      rootDetached: stage.root.parent === null,
      platformsDisabled: platformRefs.every((platform) => !platform.enabled && !platform.active),
    };
    game.bossStageRuntime = null;
    return output;
  });

  expect(result).toMatchObject({
    selectedProfileId: ASCENSION_PROFILE_ID,
    environmentId: ASCENSION_ENVIRONMENT_ID,
    runtimeEnvironmentId: ASCENSION_ENVIRONMENT_ID,
    rootName: 'verticalTransitReliquaryAuthoredEnvironment',
    authoredMarker: true,
    rootAttached: true,
    dungeonKind: 'ascensionReliquary',
    replacesStandardDungeon: true,
    encounterProfileId: ASCENSION_PROFILE_ID,
    dedicatedWorld: {
      roomIds: [
        'hubTown',
        'expeditionCamp',
        'entrance',
        'compressionFoundry',
        'brokenElevatorSpine',
        'suspendedMachinerySea',
        'summitTrial',
      ],
      exteriorRooms: [
        { id: 'hubTown', type: 'hub', x: 0, z: -20, width: 11, depth: 7 },
        { id: 'expeditionCamp', type: 'camp', x: 0, z: -11, width: 11, depth: 7 },
        { id: 'entrance', type: 'entrance', x: 0, z: 0, width: 9, depth: 9 },
      ],
      unexpectedRoomIds: [],
      forbiddenInteriorRoomIds: [],
      doorCount: 1,
      keycardCount: 0,
      trapCount: 0,
      conveyorCount: 0,
      nonBossEncounterCount: 0,
      exteriorObjects: [
        { name: 'minimalHubTown', present: true },
        { name: 'hubTownGarageWorkbench', present: true },
        { name: 'minimalExpeditionCamp', present: true },
        { name: 'expeditionCampTent', present: true },
        { name: 'expeditionQuestBoard', present: true },
        { name: 'rollSupportCampWorkshop', present: true },
        { name: 'expeditionSupportCar', present: true },
        { name: 'rollCaskettNpc', present: true },
        { name: 'rollWorkshopWorkbench', present: true },
        { name: 'expeditionRuinResetConsole', present: true },
        { name: 'expeditionRuinLift', present: true },
        { name: 'expeditionCampEntrancePad', present: true },
      ],
      interactables: expect.arrayContaining([
        { id: 'garageWorkbench', action: 'garage' },
        { id: 'rollCaskett', action: 'roll' },
        { id: 'ruinResetConsole', action: 'resetRuin' },
        { id: 'ruinLift', action: 'enterRuin' },
        { id: 'ascensionReliquaryReturnLift', action: 'extractRuin' },
      ]),
      safeZoneRoomIds: ['expeditionCamp', 'hubTown'],
      campPlatformIds: [
        'campHighClimbDeck',
        'campHighGapDeck',
        'campLowJumpDeck',
        'campReturnDeck',
      ],
      exteriorCollisionIds: [
        'expeditionSupportCarCollision',
        'rollWorkshopWorkbenchCollision',
      ],
      rollInteractableId: 'rollCaskett',
      keySeekerId: 'KeySeeker',
      npcAssets: {
        rollModelLoaded: true,
        rollAnimatorRegistered: true,
        supportCarModelLoaded: true,
        workbenchTexturesSettled: true,
      },
    },
    manifest: {
      id: ASCENSION_ENVIRONMENT_ID,
      revision: 2,
      profileId: ASCENSION_PROFILE_ID,
      checkpointIds: [
        'ascensionCheckpoint:initialFloor',
        'ascensionCheckpoint:compressionFoundry',
        'ascensionCheckpoint:brokenElevatorSpine',
        'ascensionCheckpoint:suspendedMachinerySea',
      ],
      sealStationIds: [
        'compressionSealStation:compressionFoundry',
        'compressionSealStation:brokenElevatorSpine',
        'compressionSealStation:suspendedMachinerySea',
        'compressionSealStation:summitTrial',
      ],
      masteryPlatformIds: [
        'verticalReliquaryMastery:compressionFoundry',
        'verticalReliquaryMastery:brokenElevatorSpine',
        'verticalReliquaryMastery:suspendedMachinerySea',
        'verticalReliquaryMastery:summitTrial',
      ],
      spatial: {
        playableRadius: 32,
        architectureRadius: 34,
        shellHeight: 82,
        chamberDiameter: 64,
        summitRadius: 27,
        summitCombatRadius: 23,
      },
    },
    routeRoles: [
      ['launchVent', 'landing', 'momentum', 'landing', 'momentum', 'launchVent'],
      [
        'counterweight',
        'landing',
        'rotatingBridge',
        'counterweight',
        'landing',
        'rotatingBridge',
        'counterweight',
        'counterweight',
      ],
      ['momentum', 'landing', 'momentum', 'landing', 'momentum', 'landing', 'momentum', 'landing'],
      ['launchVent'],
    ],
    platformCount: 32,
    dungeonPlatformCount: 36,
    preparationPlatformCount: 4,
    uniquePlatformIdCount: 32,
    allPlatformsRegistered: true,
    activeSegment: 0,
    cleanup: {
      disposed: true,
      rootDetached: true,
      platformsDisabled: true,
    },
  });
  expect(result.dedicatedWorld.tileCount).toBeGreaterThan(0);
  expect(result.dedicatedWorld.floorTileCount).toBeGreaterThan(0);
  expect(result.dedicatedWorld.floorTileVisualCount).toBe(result.dedicatedWorld.floorTileCount);
  expect(result.repeatStatuses).toEqual({
    ascension: 'Repeat recovery: 70%',
    conventional: 'Repeat recovery: 70% · overload guarantees',
  });
  expect(result.summitResume).toEqual({
    segmentIndex: 3,
    securedCheckpoint: 3,
    brokenSeals: [true, true, true, false],
    phase: 2,
    transitionRemaining: 0,
    healthRatio: 0.25,
    activeStageSegment: 3,
  });
  expect(result.manifest.platformIds).toHaveLength(32);
  expect(new Set(result.manifest.masteryPlatformIds).size).toBe(4);
  expect(result.manifest.collisionZoneIds.length).toBeGreaterThan(0);
  expect(result.collisionContract).toMatchObject({
    uniqueIdCount: result.manifest.collisionZoneIds.length,
    matchesStageZones: true,
    allRegisteredInDungeon: true,
    allRegisteredInController: true,
  });
  expect(result.collisionContract.ids).toEqual(result.manifest.collisionZoneIds);
  expect(result.collisionContract.ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
  expect(result.spatialContract).toEqual({
    void: {
      walkable: false,
      floorElevation: -12,
      surfaceElevation: -12,
      support: null,
    },
    initialCheckpoint: {
      walkable: true,
      support: {
        id: 'ascensionCheckpoint:initialFloor',
        elevation: 0.12,
      },
      containsTop: true,
    },
    summit: {
      walkable: true,
      support: {
        id: 'compressionSealStation:summitTrial',
        elevation: 68.5,
      },
      cornerInside: false,
      interiorInside: true,
      radial: true,
      radius: 27,
    },
  });
  expect(result.routeGateResults).toHaveLength(4);
  const expectedRouteCounts = [6, 8, 8, 1];
  for (const segment of result.routeGateResults) {
    expect(segment.impactedSequence).toBe(0);
    expect(segment.initial).toHaveLength(expectedRouteCounts[segment.segmentIndex]);
    for (const platform of segment.initial) {
      const expectedActive = platform.sequence === 0;
      expect(platform).toMatchObject({
        unlocked: expectedActive,
        enabled: expectedActive,
        active: expectedActive,
        visible: expectedActive,
        createsLedgeCandidates: false,
      });
    }
    for (const platform of segment.afterFirstImpact) {
      const expectedActive = platform.sequence <= 1;
      expect(platform).toMatchObject({
        unlocked: expectedActive,
        enabled: expectedActive,
        active: expectedActive,
        visible: expectedActive,
        createsLedgeCandidates: false,
      });
    }
    expect(segment.afterReset).toEqual(segment.initial);
  }
  expect(result.routeLedgeContract).toEqual({
    allDisableLedgeCandidates: true,
    registeredRouteLedgeCandidates: [],
  });
  expect(result.ordinaryLoadout).toEqual({
    mobilityId: null,
    jumpReachMultiplier: 1,
  });
  expect(result.jumpSpringsLoadout).toEqual({
    unlockOk: true,
    equipOk: true,
    mobilityId: 'jumpSprings',
    jumpReachMultiplier: 1.3,
  });
  expect(result.ordinaryMasteryState).toHaveLength(4);
  expect(result.ordinaryMasteryState).toEqual(result.ordinaryMasteryState.map((platform) => ({
    ...platform,
    enabled: false,
    active: false,
    visible: false,
    requiresGearId: 'jumpSprings',
  })));
  expect(result.jumpSpringsSegmentZeroState).toEqual(
    result.jumpSpringsSegmentZeroState.map((platform) => ({
      ...platform,
      enabled: platform.segmentIndex === 0,
      active: platform.segmentIndex === 0,
      visible: platform.segmentIndex === 0,
      requiresGearId: 'jumpSprings',
    })),
  );
  expect(result.jumpSpringsSegmentTwoState).toEqual(
    result.jumpSpringsSegmentTwoState.map((platform) => ({
      ...platform,
      enabled: platform.segmentIndex === 2,
      active: platform.segmentIndex === 2,
      visible: platform.segmentIndex === 2,
      requiresGearId: 'jumpSprings',
    })),
  );
  expect(result.summitLaunch.preconditions).toEqual({
    ventState: 'ready',
    enabled: true,
    active: true,
    containsPlayer: true,
    playerHeightDelta: 0,
    playerAirborne: false,
    playerDead: false,
    coolingDown: false,
  });
  expect(result.summitLaunch.observed).toMatchObject({
    verticalVelocity: result.summitLaunch.tunedVelocity,
    horizontalSpeed: 10,
    sourceId: 'summitLaunchVent',
    launched: true,
    playerVelocityY: result.summitLaunch.tunedVelocity,
  });
  expect(result.summitLaunch.tunedVelocity).toBe(18);
  expect(result.summitLaunch.diagnostic.reachable).toBe(true);
  expect(result.summitLaunch.diagnostic.apexRise)
    .toBeGreaterThanOrEqual(result.summitLaunch.diagnostic.requiredRise);
  expect(result.enabledSegments).toContain(0);
});

test('the first Ascension vent carries the real player onto the foundry middle landing', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=ascension-first-vent-transition');
  await waitForGame(page);
  expect((await selectAscensionHunt(page)).ok).toBe(true);

  const result = await page.evaluate(() => {
    const game = window.game;
    const spawned = game.debugSpawnBoss('ascensionEngine');
    if (!spawned.ok) throw new Error(spawned.message ?? spawned.reason);
    const boss = spawned.boss;
    boss.update(0, game);

    const encounter = boss.specialEncounter;
    const stage = encounter.stage;
    stage.setActiveSegment(0);
    stage.resetSegment(0);
    const route = stage.getRoutePlatforms(0);
    const vent = route.find((platform) => platform.routeId === 'foundryVentLower');
    const landing = route.find((platform) => platform.routeId === 'foundryLandingMiddle');
    if (!vent || !landing) throw new Error('Foundry vent transition is incomplete');

    const resetReasons = [];
    const originalResetCurrentChamber = encounter._resetCurrentChamber.bind(encounter);
    encounter._resetCurrentChamber = (reason) => {
      resetReasons.push(reason);
      return originalResetCurrentChamber(reason);
    };

    const dt = 1 / 120;
    // Let the production chase state lead across both halves of the vent pair:
    // impact the vent, withdraw, impact its landing, and withdraw again. The
    // vent must not fire while the boss still occupies its destination.
    let landingPrecleared = false;
    for (let frame = 0; frame < 1_800; frame += 1) {
      stage.prePlayerUpdate(dt, game);
      boss.prePlayerUpdate(dt, game);
      boss.update(dt, game);
      if (encounter.routeStep >= 2
        && encounter.routeLead?.holding
        && encounter._bossClearedRoutePlatform(landing)) {
        landingPrecleared = true;
        break;
      }
    }
    if (!landingPrecleared) {
      throw new Error(
        `Boss did not pre-clear the foundry vent landing; routeStep=${encounter.routeStep}, `
        + `playerRouteStep=${encounter.playerRouteStep}, mode=${encounter.state.mode}, `
        + `attack=${encounter.activeAttack?.platform?.routeId ?? encounter.activeAttack?.type ?? 'none'}, `
        + `transit=${encounter.bossTransit?.kind ?? 'none'}, `
        + `lead=${JSON.stringify(encounter.getRouteLeadDiagnostics?.() ?? null)}`,
      );
    }

    const ventPosition = vent.center.clone().setY(vent.topY);
    game.player.restoreTraversalCheckpoint({
      position: ventPosition,
      facing: landing.center.clone().sub(vent.center).setY(0),
      healthFloorRatio: 1,
    });
    game.dungeonController.lastSafePlayerPosition.copy(ventPosition);

    const input = new Set();
    let launchFrame = null;
    let airborneFrames = 0;
    let maximumY = game.player.root.position.y;
    let landedSupportId = null;
    let landedOnTarget = false;
    let frameCount = 0;

    for (let frame = 0; frame < 300; frame += 1) {
      frameCount = frame + 1;
      stage.prePlayerUpdate(dt, game);
      boss.prePlayerUpdate(dt, game);
      const groundY = game._getPlayerGroundY();
      game.player.update(dt, input, {
        arenaRadius: game.arenaRadius,
        groundY,
        game,
      });
      // Exercise the same walkability correction that used to pin mechanism
      // launches to the takeoff platform when crossing the shaft void.
      game.dungeonController._constrainPlayerToWalkable();
      boss.update(dt, game);

      maximumY = Math.max(maximumY, game.player.root.position.y);
      if (game.player.isJumpAirborne()) {
        airborneFrames += 1;
        launchFrame ??= frame;
      }
      const support = game.getPlatformSupport(game.player.root.position)?.surface ?? null;
      if (launchFrame !== null && !game.player.isJumpAirborne()) {
        landedSupportId = support?.id ?? null;
        landedOnTarget = support === landing
          && landing.containsTop(game.player.root.position, 0.08)
          && Math.abs(game.player.root.position.y - landing.topY) <= 0.01;
        break;
      }
    }

    encounter._resetCurrentChamber = originalResetCurrentChamber;
    const output = {
      routeIds: route.slice(0, 2).map((platform) => platform.routeId),
      ventState: vent.ventState,
      landingUnlocked: landing.routeUnlocked,
      landingPrecleared,
      launchSourceId: game.player.root.userData.lastTraversalLaunchSourceId ?? null,
      launchFrame,
      airborneFrames,
      maximumY,
      landingTopY: landing.topY,
      landedSupportId,
      expectedSupportId: landing.id,
      landedOnTarget,
      resetReasons,
      routeStep: encounter.routeStep,
      playerRouteStep: encounter.playerRouteStep,
      securedCheckpoint: encounter.state.securedCheckpoint,
      finalPosition: game.player.root.position.toArray(),
      frameCount,
    };

    boss.dispose();
    boss.root.removeFromParent();
    const bossIndex = game.enemies.indexOf(boss);
    if (bossIndex >= 0) game.enemies.splice(bossIndex, 1);
    return output;
  });

  expect(result.routeIds).toEqual(['foundryVentLower', 'foundryLandingMiddle']);
  expect(result.landingUnlocked).toBe(true);
  expect(result.landingPrecleared).toBe(true);
  expect(result.launchSourceId).toBe('foundryVentLower');
  expect(result.launchFrame).not.toBeNull();
  expect(result.airborneFrames).toBeGreaterThan(1);
  expect(result.maximumY).toBeGreaterThan(result.landingTopY);
  expect(result.landedSupportId).toBe(result.expectedSupportId);
  expect(result.landedOnTarget).toBe(true);
  expect(result.resetReasons).toEqual([]);
  expect(result.routeStep).toBe(2);
  expect(result.playerRouteStep).toBe(1);
  expect(result.securedCheckpoint).toBe(0);
  expect(result.frameCount).toBeLessThan(300);
});

test('board-triggered Ascension lifts return and rearm after the rider falls off', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=ascension-lift-fall-retry');
  await waitForGame(page);
  expect((await selectAscensionHunt(page)).ok).toBe(true);

  const result = await page.evaluate(async () => {
    const game = window.game;
    const { ASCENSION_ENGINE_TUNING } = await import('/src/reaverbots/bosses/AscensionEngineContract.js');
    const spawned = game.debugSpawnBoss('ascensionEngine');
    if (!spawned.ok) throw new Error(spawned.message ?? spawned.reason);
    const boss = spawned.boss;
    boss.update(0, game);

    const encounter = boss.specialEncounter;
    const stage = encounter.stage;
    const player = game.player;
    const controller = game.dungeonController;
    const dt = 1 / 120;
    const zeroVelocity = player.root.position.clone().set(0, 0, 0);
    const route = stage.getRoutePlatforms(1);
    const lift = route.find((platform) => platform.routeId === 'elevatorCounterweightA');
    if (!lift) throw new Error('The first Broken Elevator Spine counterweight is missing');

    const boardTriggeredLiftIds = [0, 1, 2, 3].flatMap((segmentIndex) => (
      stage.getRoutePlatforms(segmentIndex)
        .filter((platform) => platform.boardTriggeredLift)
        .map((platform) => platform.routeId)
    ));
    stage.setActiveSegment(1);
    stage.resetSegment(1);

    let impactCount = 0;
    const originalCommandPlatformImpact = stage.commandPlatformImpact.bind(stage);
    stage.commandPlatformImpact = (...args) => {
      impactCount += 1;
      return originalCommandPlatformImpact(...args);
    };
    stage.commandPlatformImpact(1, 0);

    const restoreOntoLift = (x = lift.center.x) => {
      const position = lift.center.clone().set(x, lift.topY, lift.center.z);
      player.restoreTraversalCheckpoint({ position, healthFloorRatio: 1 });
      controller.lastSafePlayerPosition.copy(position);
    };
    const stepPlayer = (desiredVelocity = zeroVelocity) => {
      stage.prePlayerUpdate(dt, game);
      const groundY = game._getPlayerGroundY();
      player._updatePhysicalJumpAndMovement(dt, desiredVelocity, {
        arenaRadius: game.arenaRadius,
        movementOptions: { groundY },
      });
      controller._constrainPlayerToWalkable();
    };

    restoreOntoLift();
    stage.prePlayerUpdate(dt, game);
    player.velocity.x = 0;
    player.velocity.z = 0;
    player._startPhysicalJump();
    let returnedDuringVerticalJump = false;
    let sawVerticalJumpAirborne = player.isJumpAirborne();
    const verticalJumpFrames = Math.ceil(
      (ASCENSION_ENGINE_TUNING.liftRiderReleaseGraceSeconds + 0.05) / dt,
    );
    for (let frame = 0; frame < verticalJumpFrames; frame += 1) {
      stepPlayer();
      sawVerticalJumpAirborne ||= player.isJumpAirborne();
      returnedDuringVerticalJump ||= lift.mechanismState === 'returning';
    }
    const verticalJump = {
      sawAirborne: sawVerticalJumpAirborne,
      overFootprint: lift.containsTop(player.root.position, 0.06),
      returned: returnedDuringVerticalJump,
      platformTopY: lift.topY,
    };

    restoreOntoLift(lift.center.x + lift.halfWidth - 0.35);
    stage.prePlayerUpdate(dt, game);
    player.velocity.x = player.jumpSettings.forwardSpeed;
    player.velocity.z = 0;
    player._startPhysicalJump();
    const outwardVelocity = zeroVelocity.clone().set(player.jumpSettings.forwardSpeed, 0, 0);
    let leftFootprintFrame = null;
    let leftFootprintAtTopY = null;
    for (let frame = 0; frame < 120; frame += 1) {
      stepPlayer(outwardVelocity);
      if (!lift.containsTop(player.root.position, 0.06)) {
        leftFootprintFrame = frame;
        leftFootprintAtTopY = lift.topY;
        break;
      }
    }

    let returnFrame = null;
    for (let frame = 0; frame < 600; frame += 1) {
      stage.prePlayerUpdate(dt, game);
      if (lift.mechanismState === 'armed'
        && Math.abs(lift.topY - lift.baseTopY) <= 1e-9) {
        returnFrame = frame;
        break;
      }
    }
    const returned = {
      frame: returnFrame,
      topY: lift.topY,
      targetTopY: lift.currentTargetTopY,
      mechanismState: lift.mechanismState,
      rearmOnReturn: lift.rearmOnReturn,
      riderDelivered: lift.riderDelivered,
    };

    restoreOntoLift();
    let relaunchedFrame = null;
    for (let frame = 0; frame < 300; frame += 1) {
      stage.prePlayerUpdate(dt, game);
      if (lift.mechanismState === 'launched'
        && Math.abs(lift.topY - lift.targetTopY) <= 1e-9) {
        relaunchedFrame = frame;
        break;
      }
    }
    const support = game.getPlatformSupport(player.root.position)?.surface ?? null;
    const relaunched = {
      frame: relaunchedFrame,
      topY: lift.topY,
      targetTopY: lift.targetTopY,
      playerY: player.root.position.y,
      mechanismState: lift.mechanismState,
      riderDelivered: lift.riderDelivered,
      supportId: support?.id ?? null,
      containsPlayer: lift.containsTop(player.root.position, 0.06),
    };

    stage.commandPlatformImpact = originalCommandPlatformImpact;
    boss.dispose();
    boss.root.removeFromParent();
    const bossIndex = game.enemies.indexOf(boss);
    if (bossIndex >= 0) game.enemies.splice(bossIndex, 1);
    return {
      boardTriggeredLiftIds,
      impactCount,
      routeId: lift.routeId,
      baseTopY: lift.baseTopY,
      verticalJump,
      leftFootprintFrame,
      leftFootprintAtTopY,
      returned,
      relaunched,
    };
  });

  expect(result.boardTriggeredLiftIds).toEqual([
    'foundryCompressionLift',
    'foundryPistonLift',
    'elevatorCounterweightA',
    'elevatorCounterweightMiddle',
    'elevatorCounterweightB',
    'elevatorCounterweightFinal',
    'momentumPlatformOne',
    'momentumPlatformTwo',
    'momentumPlatformThree',
    'momentumPlatformFour',
  ]);
  expect(result.impactCount).toBe(1);
  expect(result.routeId).toBe('elevatorCounterweightA');
  expect(result.verticalJump).toMatchObject({
    sawAirborne: true,
    overFootprint: true,
    returned: false,
  });
  expect(result.verticalJump.platformTopY).toBeGreaterThan(result.baseTopY);
  expect(result.leftFootprintFrame).not.toBeNull();
  expect(result.leftFootprintAtTopY).toBeGreaterThan(result.baseTopY);
  expect(result.leftFootprintAtTopY).toBeLessThan(result.relaunched.targetTopY);
  expect(result.returned).toEqual({
    frame: expect.any(Number),
    topY: result.baseTopY,
    targetTopY: result.baseTopY,
    mechanismState: 'armed',
    rearmOnReturn: true,
    riderDelivered: false,
  });
  expect(result.relaunched).toMatchObject({
    frame: expect.any(Number),
    mechanismState: 'launched',
    riderDelivered: true,
    supportId: 'verticalReliquaryPlatform:elevatorCounterweightA',
    containsPlayer: true,
  });
  expect(result.relaunched.topY).toBeCloseTo(result.relaunched.targetTopY, 9);
  expect(result.relaunched.playerY).toBeCloseTo(result.relaunched.targetTopY, 9);
});

test('the complete Ascension route is executable through live impacts, traversal, seals, and summit victory', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=ascension-complete-live-route');
  await waitForGame(page);
  expect((await selectAscensionHunt(page)).ok).toBe(true);

  const result = await page.evaluate(async () => {
    const game = window.game;
    const spawned = game.debugSpawnBoss('ascensionEngine');
    if (!spawned.ok) throw new Error(spawned.message ?? spawned.reason);
    const boss = spawned.boss;
    boss.update(0, game);

    const encounter = boss.specialEncounter;
    const stage = encounter.stage;
    const player = game.player;
    const controller = game.dungeonController;
    const dt = 1 / 60;
    const zeroVelocity = player.root.position.clone().set(0, 0, 0);
    let simulatedFrames = 0;

    const checkpointCommits = [];
    let victoryCommits = 0;
    const originalCommitCheckpoint = game.commitAscensionCheckpoint;
    const originalCommitVictory = game.commitAscensionVictory;
    game.commitAscensionCheckpoint = async (_enemy, checkpoint) => {
      checkpointCommits.push({ ...checkpoint });
      return { ok: true, debug: true, encounterProgress: { ...checkpoint } };
    };
    game.commitAscensionVictory = async () => {
      victoryCommits += 1;
      return { ok: true, debug: true };
    };
    const projectileSealImpacts = [];
    const originalDamageEnemy = game.damageEnemy;
    game.damageEnemy = (enemy, amount, meta = {}) => {
      const activeSealIndexBefore = encounter.state.activeSealIndex;
      const dealt = originalDamageEnemy.call(game, enemy, amount, meta);
      if (enemy === boss && meta.projectileHit) {
        projectileSealImpacts.push({
          hitPartId: meta.hitPartId ?? null,
          ascensionSealIndex: meta.ascensionSealIndex ?? null,
          ascensionSealHit: meta.ascensionSealHit === true,
          activeSealIndexBefore,
          damageNullified: meta.damageNullified === true,
          nominalDamage: amount,
          dealt,
        });
      }
      return dealt;
    };

    const resetReasons = [];
    const resetDiagnostics = [];
    const originalResetCurrentChamber = encounter._resetCurrentChamber.bind(encounter);
    encounter._resetCurrentChamber = (reason) => {
      resetReasons.push(reason);
      resetDiagnostics.push({
        reason,
        label: currentRouteTestLabel,
        segmentIndex: encounter.state.segmentIndex,
        bossRouteStep: encounter.routeStep,
        playerRouteStep: encounter.playerRouteStep,
        supportId: game.getPlatformSupport(player.root.position)?.surface?.id ?? null,
        playerPosition: player.root.position.toArray(),
        playerVelocity: player.velocity?.toArray?.() ?? null,
        desiredVelocity: latestDesiredVelocity.toArray(),
        takeoffHorizontalVelocity: player.takeoffHorizontalVelocity?.toArray?.() ?? null,
        jumpDirection: player.jumpDirection?.toArray?.() ?? null,
        lastMoveDirection: player.lastMoveDirection?.toArray?.() ?? null,
        jumpState: player.jumpState,
        shockwaveDodgeAirborne,
        lastShockwaveDodge: shockwaveDodgeRecords.at(-1) ?? null,
        shockwaves: encounter.shockwaves.map((wave) => {
          const progress = Math.max(0, Math.min(1, wave.elapsed / wave.duration));
          const radius = 0.8 + (wave.maximumRadius - 0.8) * progress;
          return {
            center: wave.center.toArray(),
            elapsed: wave.elapsed,
            duration: wave.duration,
            radius,
            maximumRadius: wave.maximumRadius,
            distanceToPlayer: Math.hypot(
              player.root.position.x - wave.center.x,
              player.root.position.z - wave.center.z,
            ),
            hit: wave.hit === true,
          };
        }),
        bossPosition: boss.root.position.toArray(),
      });
      return originalResetCurrentChamber(reason);
    };

    const routeProgressByKey = new Map();
    const routeProgressRecords = [];
    const routeKey = (segmentIndex, sequence) => `${segmentIndex}:${sequence}`;
    const nextRequiredSupport = (platform) => (
      stage.getRoutePlatforms(platform.segmentIndex)
        .find((entry) => entry.sequence === platform.sequence + 1)
      ?? stage.getSealStation(platform.segmentIndex)?.platform
      ?? null
    );
    const pointToSupportEdgeDistance = (point, support) => {
      const dx = Math.max(0, Math.abs(point.x - support.center.x) - support.halfWidth);
      const dz = Math.max(0, Math.abs(point.z - support.center.z) - support.halfDepth);
      return Math.hypot(dx, dz);
    };
    const getRouteProgress = (segmentIndex, sequence) => (
      routeProgressByKey.get(routeKey(segmentIndex, sequence)) ?? null
    );

    const attackMotion = new WeakMap();
    const bossLandings = [];
    const transitMotion = new WeakMap();
    const routeLeadMotion = new WeakMap();
    const bossTransits = [];
    const originalStartTraversalAttack = encounter._startTraversalAttack.bind(encounter);
    encounter._startTraversalAttack = (...args) => {
      const start = boss.root.position.clone();
      const output = originalStartTraversalAttack(...args);
      if (encounter.activeAttack) {
        const platform = encounter.activeAttack.platform;
        const key = routeKey(encounter.state.segmentIndex, platform.sequence);
        let routeProgress = routeProgressByKey.get(key);
        if (!routeProgress) {
          routeProgress = {
            key,
            segmentIndex: encounter.state.segmentIndex,
            sequence: platform.sequence,
            platform,
            platformId: platform.id,
            routeId: platform.routeId,
            nextSupport: nextRequiredSupport(platform),
            attackStartFrame: simulatedFrames,
            previousPlayerCompletionFrame: platform.sequence > 0
              ? getRouteProgress(encounter.state.segmentIndex, platform.sequence - 1)?.playerCompletionFrame
                ?? (encounter.playerRouteStep >= platform.sequence - 1 ? simulatedFrames : null)
              : null,
            playerCompletionFrame: null,
            playerCompletion: null,
            bossClearanceAtPlayerCompletion: null,
            landingFrame: null,
            landedBeforePlayerCompletion: false,
            leadStartFrame: null,
            leadCompleteFrame: null,
            leadPathDistance: 0,
            leadLandingError: null,
            leadTarget: null,
            leadTargetEdgeClearance: null,
            leadTargetHoverHeight: null,
            leadTargetInwardAlignment: null,
            leadTargetInsideTraversalBounds: null,
            leadHoldFrames: 0,
            leadHoldMaximumDrift: 0,
          };
          routeProgressByKey.set(key, routeProgress);
          routeProgressRecords.push(routeProgress);
        }
        attackMotion.set(encounter.activeAttack, {
          start,
          pathDistance: 0,
          segmentIndex: encounter.state.segmentIndex,
          summit: false,
          record: null,
          routeProgress,
        });
      }
      return output;
    };
    const originalStartSummitAttack = encounter._startSummitAttack.bind(encounter);
    encounter._startSummitAttack = (...args) => {
      const start = boss.root.position.clone();
      const output = originalStartSummitAttack(...args);
      if (encounter.activeAttack) {
        attackMotion.set(encounter.activeAttack, {
          start,
          pathDistance: 0,
          segmentIndex: encounter.state.segmentIndex,
          summit: true,
          record: null,
        });
      }
      return output;
    };
    const originalLandAttack = encounter._landAttack.bind(encounter);
    encounter._landAttack = (attack) => {
      const motion = attackMotion.get(attack) ?? {
        start: boss.root.position.clone(),
        pathDistance: 0,
        segmentIndex: encounter.state.segmentIndex,
        summit: Boolean(attack?.summit),
        record: null,
      };
      const intendedTarget = attack.target.clone();
      const output = originalLandAttack(attack);
      if (motion.routeProgress) {
        motion.routeProgress.landingFrame = simulatedFrames;
        motion.routeProgress.landedBeforePlayerCompletion = motion.routeProgress.playerCompletionFrame == null;
      }
      const record = {
        segmentIndex: motion.segmentIndex,
        sequence: attack.platform?.sequence ?? null,
        platformId: attack.platform?.id ?? null,
        routeId: attack.platform?.routeId ?? null,
        attackType: attack.type,
        summit: Boolean(attack.summit || motion.summit),
        directTravelDistance: motion.start.distanceTo(boss.root.position),
        pathDistance: motion.pathDistance,
        landingError: boss.root.position.distanceTo(intendedTarget),
        playerCompletionFrame: motion.routeProgress?.playerCompletionFrame ?? null,
      };
      motion.record = record;
      attackMotion.set(attack, motion);
      bossLandings.push(record);
      return output;
    };
    const originalStartBossTransit = encounter._startBossTransit.bind(encounter);
    encounter._startBossTransit = (kind, target, options) => {
      const start = boss.root.position.clone();
      const output = originalStartBossTransit(kind, target, options);
      if (output && encounter.bossTransit) {
        if (kind === 'routeLead') {
          const sequence = Math.max(0, encounter.routeStep - 1);
          const routeProgress = getRouteProgress(encounter.state.segmentIndex, sequence);
          if (routeProgress) {
            const nextSupport = routeProgress.nextSupport;
            const leadTarget = target.clone();
            const offset = leadTarget.clone().sub(nextSupport.center).setY(0);
            const inward = stage.center.clone().sub(nextSupport.center).setY(0);
            const alignment = offset.lengthSq() > 0.0001 && inward.lengthSq() > 0.0001
              ? offset.normalize().dot(inward.normalize())
              : -1;
            routeProgress.leadStartFrame = simulatedFrames;
            routeProgress.leadTarget = leadTarget;
            routeProgress.leadTargetEdgeClearance = pointToSupportEdgeDistance(
              leadTarget,
              nextSupport,
            );
            routeProgress.leadTargetHoverHeight = leadTarget.y - nextSupport.topY;
            routeProgress.leadTargetInwardAlignment = alignment;
            routeProgress.leadTargetInsideTraversalBounds = !stage.isOutsideTraversalBounds?.(
              leadTarget,
              0,
            );
            routeLeadMotion.set(encounter.bossTransit, {
              routeProgress,
              start,
              target: leadTarget,
              pathDistance: 0,
            });
          }
        } else {
          transitMotion.set(encounter.bossTransit, {
            kind,
            segmentIndex: encounter.state.segmentIndex,
            start,
            target: target.clone(),
            pathDistance: 0,
          });
        }
      }
      return output;
    };

    const currentSupport = () => game.getPlatformSupport(player.root.position)?.surface ?? null;
    const horizontalDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    const isOnPlatformSurface = (platform, inset = 0.25) => Boolean(
      platform?.enabled
      && currentSupport() === platform
      && platform.containsTop(player.root.position, inset)
      && Math.abs(player.root.position.y - platform.topY) <= 0.28
    );
    const isOverPlatform = (platform, inset = 0.25) => {
      if (!isOnPlatformSurface(platform, inset)) return false;
      if (platform.role !== 'launchVent') return true;
      const activationRadius = Math.max(0, Number(platform.launchActivationRadius) || 0);
      return activationRadius > 0
        && horizontalDistance(player.root.position, platform.center)
          <= Math.min(0.12, activationRadius * 0.1);
    };
    const launchedFromPlatform = (platform) => Boolean(
      platform?.role === 'launchVent'
      && player.isJumpAirborne()
      && player.root.userData.lastTraversalLaunchSourceId === platform.routeId
    );
    const hasOccupiedPlatform = (platform) => (
      isOverPlatform(platform) || launchedFromPlatform(platform)
    );
    const desiredVelocityToward = (point, maximumSpeed = 4.35) => {
      const desired = point.clone().sub(player.root.position).setY(0);
      const distance = desired.length();
      if (distance <= 0.001) return desired.set(0, 0, 0);
      return desired.multiplyScalar(Math.min(maximumSpeed, distance * 7) / distance);
    };

    const shockwaveDodgeRecords = [];
    const shockwaveDodgeByWave = new Map();
    let shockwaveDodgeAirborne = false;
    let currentRouteTestLabel = 'initialization';
    const latestDesiredVelocity = zeroVelocity.clone();
    const tryJumpApproachingShockwave = () => {
      if (player.isJumpAirborne()
        || player.isPowerKnockbackActive?.()
        || player.isLedgeClinging?.()
        || player.isExternalMotionActive?.()) return;
      for (const wave of encounter.shockwaves) {
        if (wave.hit || shockwaveDodgeByWave.has(wave)) continue;
        const progress = Math.max(0, Math.min(1, wave.elapsed / wave.duration));
        const nextProgress = Math.max(0, Math.min(1, (wave.elapsed + dt) / wave.duration));
        const radius = 0.8 + (wave.maximumRadius - 0.8) * progress;
        const nextRadius = 0.8 + (wave.maximumRadius - 0.8) * nextProgress;
        const distance = horizontalDistance(player.root.position, wave.center);
        const band = 0.28 + radius * 0.08;
        const bandApproaching = distance >= radius - band
          && distance <= nextRadius + band + 0.35;
        if (!bandApproaching) continue;
        if (!player.tryJump(new Set()) || !player.isJumpAirborne()) continue;
        const record = {
          segmentIndex: encounter.state.segmentIndex,
          mode: encounter.state.mode,
          distance,
          radius,
          hit: false,
        };
        shockwaveDodgeRecords.push(record);
        shockwaveDodgeByWave.set(wave, record);
        shockwaveDodgeAirborne = true;
        break;
      }
    };

    const stepWorld = (desiredVelocity = zeroVelocity) => {
      if (boss.dead) return;
      latestDesiredVelocity.copy(desiredVelocity);
      const playerRouteStepBefore = Number.isFinite(encounter.playerRouteStep)
        ? encounter.playerRouteStep
        : -1;
      stage.prePlayerUpdate(dt, game);
      boss.prePlayerUpdate(dt, game);
      tryJumpApproachingShockwave();
      const groundY = game._getPlayerGroundY();
      if (player.isPowerKnockbackActive?.() || player.animation.hurtTimer > 0) {
        player.update(dt, new Set(), {
          arenaRadius: game.arenaRadius,
          groundY,
          game,
        });
      } else {
        player._updatePhysicalJumpAndMovement(dt, desiredVelocity, {
          arenaRadius: game.arenaRadius,
          movementOptions: { groundY },
        });
      }
      controller._constrainPlayerToWalkable();
      if (!player.isJumpAirborne()) shockwaveDodgeAirborne = false;

      const activeBefore = encounter.activeAttack;
      const transitBefore = encounter.bossTransit;
      const bossBefore = boss.root.position.clone();
      boss.update(dt, game);
      const motion = activeBefore ? attackMotion.get(activeBefore) : null;
      if (motion) {
        motion.pathDistance += bossBefore.distanceTo(boss.root.position);
        if (motion.record) motion.record.pathDistance = motion.pathDistance;
      }
      const transit = transitBefore ? transitMotion.get(transitBefore) : null;
      if (transit) {
        transit.pathDistance += bossBefore.distanceTo(boss.root.position);
        if (encounter.bossTransit !== transitBefore) {
          bossTransits.push({
            kind: transit.kind,
            segmentIndex: transit.segmentIndex,
            directTravelDistance: transit.start.distanceTo(boss.root.position),
            pathDistance: transit.pathDistance,
            landingError: boss.root.position.distanceTo(transit.target),
          });
        }
      }
      const leadTransit = transitBefore ? routeLeadMotion.get(transitBefore) : null;
      if (leadTransit) {
        leadTransit.pathDistance += bossBefore.distanceTo(boss.root.position);
        leadTransit.routeProgress.leadPathDistance = leadTransit.pathDistance;
        if (encounter.bossTransit !== transitBefore) {
          leadTransit.routeProgress.leadCompleteFrame = simulatedFrames;
          leadTransit.routeProgress.leadLandingError = boss.root.position.distanceTo(
            leadTransit.target,
          );
          leadTransit.routeProgress.leadHoldPosition = boss.root.position.clone();
        }
      }
      const playerRouteStepAfter = Number.isFinite(encounter.playerRouteStep)
        ? encounter.playerRouteStep
        : -1;
      if (playerRouteStepAfter > playerRouteStepBefore) {
        for (let sequence = playerRouteStepBefore + 1; sequence <= playerRouteStepAfter; sequence += 1) {
          const routeProgress = getRouteProgress(encounter.state.segmentIndex, sequence);
          if (!routeProgress || routeProgress.playerCompletionFrame != null) continue;
          const platform = routeProgress.platform;
          const support = currentSupport();
          routeProgress.playerCompletionFrame = simulatedFrames;
          routeProgress.bossClearanceAtPlayerCompletion = pointToSupportEdgeDistance(
            boss.root.position,
            platform,
          );
          routeProgress.playerCompletion = {
            role: platform.role,
            supportId: support?.id ?? null,
            playerY: player.root.position.y,
            platformTopY: platform.topY,
            targetTopY: platform.targetTopY,
            airborne: player.isJumpAirborne(),
            launchSourceId: player.root.userData.lastTraversalLaunchSourceId ?? null,
            onPlatformFootprint: platform.containsTop(player.root.position, 0.06),
          };
        }
      }
      for (const routeProgress of routeProgressRecords) {
        if (routeProgress.leadCompleteFrame == null
          || routeProgress.playerCompletionFrame != null
          || !routeProgress.leadHoldPosition) continue;
        routeProgress.leadHoldFrames += 1;
        routeProgress.leadHoldMaximumDrift = Math.max(
          routeProgress.leadHoldMaximumDrift,
          boss.root.position.distanceTo(routeProgress.leadHoldPosition),
        );
      }
      for (const [wave, record] of shockwaveDodgeByWave) {
        record.hit ||= wave.hit === true;
      }
      simulatedFrames += 1;
      if (resetReasons.length > 0) {
        throw new Error(
          `Encounter reset during ${currentRouteTestLabel}: ${resetReasons.join(', ')}; `
          + `segment=${encounter.state.segmentIndex}, bossStep=${encounter.routeStep}, `
          + `playerStep=${encounter.playerRouteStep}, support=${currentSupport()?.id ?? 'none'}, `
          + `position=${player.root.position.toArray().map((value) => value.toFixed(2)).join(',')}; `
          + `beforeReset=${JSON.stringify(resetDiagnostics.at(-1))}`,
        );
      }
    };

    const waitForGroundedPlatform = (platform, label, maximumFrames = 300) => {
      let sawAirborne = player.isJumpAirborne();
      for (let frame = 0; frame < maximumFrames; frame += 1) {
        if (!player.isJumpAirborne() && isOnPlatformSurface(platform)) return;
        stepWorld(zeroVelocity);
        sawAirborne ||= player.isJumpAirborne();
        if (sawAirborne && !player.isJumpAirborne() && !isOnPlatformSurface(platform)) {
          const support = currentSupport();
          throw new Error(
            `${label} landed on ${support?.id ?? 'no support'} instead of ${platform.id}`,
          );
        }
      }
      throw new Error(`${label} did not land on ${platform.id} within ${maximumFrames} frames`);
    };

    const settleAirborneOnAnySupport = (platform, label, maximumFrames = 300) => {
      for (let frame = 0; frame < maximumFrames; frame += 1) {
        if (!player.isJumpAirborne()) {
          if (!currentSupport()) throw new Error(`${label} landed without valid support`);
          return;
        }
        stepWorld(desiredVelocityToward(platform.center));
      }
      throw new Error(`${label} remained airborne for ${maximumFrames} frames`);
    };

    const driveOntoPlatform = (platform, sourceHint = null) => {
      if (!platform?.enabled) throw new Error(`Target platform ${platform?.id ?? 'missing'} is disabled`);
      if (hasOccupiedPlatform(platform)) return;
      if (player.isJumpAirborne()) {
        settleAirborneOnAnySupport(platform, `airborne entry toward ${platform.id}`);
        if (hasOccupiedPlatform(platform)) return;
      }

      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (hasOccupiedPlatform(platform)) return;
        let source = sourceHint && sourceHint.containsTop(player.root.position, 0)
          && Math.abs(player.root.position.y - sourceHint.topY) <= 0.32
          ? sourceHint
          : currentSupport();
        if (!source) {
          throw new Error(`No takeoff support while approaching ${platform.id}`);
        }

        const topsOverlap = Math.abs(source.center.x - platform.center.x)
            < source.halfWidth + platform.halfWidth
          && Math.abs(source.center.z - platform.center.z)
            < source.halfDepth + platform.halfDepth;
        const groundedStep = Math.abs(source.topY - platform.topY) <= 0.24;
        if (topsOverlap && groundedStep) {
          const overlapMinX = Math.max(
            source.center.x - source.halfWidth,
            platform.center.x - platform.halfWidth,
          );
          const overlapMaxX = Math.min(
            source.center.x + source.halfWidth,
            platform.center.x + platform.halfWidth,
          );
          const overlapMinZ = Math.max(
            source.center.z - source.halfDepth,
            platform.center.z - platform.halfDepth,
          );
          const overlapMaxZ = Math.min(
            source.center.z + source.halfDepth,
            platform.center.z + platform.halfDepth,
          );
          const overlapInset = Math.min(
            0.35,
            Math.max(0, (overlapMaxX - overlapMinX) * 0.25),
            Math.max(0, (overlapMaxZ - overlapMinZ) * 0.25),
          );
          const handoff = source.center.clone().set(
            Math.min(
              overlapMaxX - overlapInset,
              Math.max(overlapMinX + overlapInset, (overlapMinX + overlapMaxX) * 0.5),
            ),
            source.topY,
            Math.min(
              overlapMaxZ - overlapInset,
              Math.max(overlapMinZ + overlapInset, (overlapMinZ + overlapMaxZ) * 0.5),
            ),
          );
          for (const waypoint of [handoff, platform.center]) {
            let previousDistance = Infinity;
            let stalledFrames = 0;
            for (let frame = 0; frame < 180; frame += 1) {
              if (hasOccupiedPlatform(platform)) return;
              const distance = horizontalDistance(player.root.position, waypoint);
              if (distance <= 0.1) break;
              stepWorld(desiredVelocityToward(waypoint));
              if (distance >= previousDistance - 0.002) stalledFrames += 1;
              else stalledFrames = 0;
              previousDistance = distance;
              if (stalledFrames >= 18) break;
            }
          }
          if (hasOccupiedPlatform(platform)) return;
        }

        const direction = platform.center.clone().sub(player.root.position).setY(0);
        if (direction.lengthSq() <= 0.0001) {
          stepWorld(zeroVelocity);
          if (isOverPlatform(platform)) return;
          throw new Error(`Player shares X/Z with ${platform.id} but cannot stand on it`);
        }
        direction.normalize();
        const xBoundary = Math.abs(direction.x) > 0.0001
          ? source.halfWidth / Math.abs(direction.x)
          : Infinity;
        const zBoundary = Math.abs(direction.z) > 0.0001
          ? source.halfDepth / Math.abs(direction.z)
          : Infinity;
        const takeoffDistance = Math.max(0, Math.min(xBoundary, zBoundary) - 0.58);
        const takeoff = source.center.clone().addScaledVector(direction, takeoffDistance);
        takeoff.y = source.topY;

        let previousDistance = Infinity;
        let stalledFrames = 0;
        for (let frame = 0; frame < 240; frame += 1) {
          if (hasOccupiedPlatform(platform)) return;
          if (player.isJumpAirborne()) break;
          const distance = horizontalDistance(player.root.position, takeoff);
          if (distance <= 0.1) break;
          stepWorld(desiredVelocityToward(takeoff));
          if (distance >= previousDistance - 0.002) stalledFrames += 1;
          else stalledFrames = 0;
          previousDistance = distance;
          if (stalledFrames >= 18) break;
        }
        if (hasOccupiedPlatform(platform)) return;
        if (player.isJumpAirborne()) {
          if (shockwaveDodgeAirborne) {
            settleAirborneOnAnySupport(platform, `shockwave dodge before ${platform.id}`);
            sourceHint = currentSupport();
            continue;
          }
          waitForGroundedPlatform(platform, `mechanism transition to ${platform.id}`);
          return;
        }

        const jumpDirection = platform.center.clone().sub(player.root.position).setY(0);
        if (jumpDirection.lengthSq() <= 0.0001) jumpDirection.set(0, 0, -1);
        else jumpDirection.normalize();
        const forwardSpeed = player.jumpSettings?.forwardSpeed ?? 4.35;
        player.velocity.x = jumpDirection.x * forwardSpeed;
        player.velocity.z = jumpDirection.z * forwardSpeed;
        player._startPhysicalJump();
        const airborneVelocity = jumpDirection.clone().multiplyScalar(forwardSpeed);
        let becameAirborne = player.isJumpAirborne();
        for (let frame = 0; frame < 180; frame += 1) {
          stepWorld(airborneVelocity);
          becameAirborne ||= player.isJumpAirborne();
          if (launchedFromPlatform(platform)) return;
          if (!player.isJumpAirborne() && isOnPlatformSurface(platform)) {
            if (hasOccupiedPlatform(platform)) return;
            sourceHint = platform;
            break;
          }
          if (becameAirborne && !player.isJumpAirborne()) break;
        }
        sourceHint = currentSupport();
      }

      const support = currentSupport();
      throw new Error(
        `Live jump could not reach ${platform.id} from ${support?.id ?? 'no support'}; `
        + `position=${player.root.position.toArray().map((value) => value.toFixed(2)).join(',')}, `
        + `target=${platform.center.toArray().map((value) => value.toFixed(2)).join(',')}, `
        + `ventState=${platform.ventState}, airborne=${player.isJumpAirborne()}, `
        + `lastLaunch=${player.root.userData.lastTraversalLaunchSourceId ?? 'none'}, `
        + `launch=${JSON.stringify(player.getTraversalMechanismLaunchDiagnostics?.() ?? null)}`,
      );
    };

    const waitForImpact = (platform) => {
      const expectedRouteStep = platform.sequence + 1;
      for (let frame = 0; frame < 720 && encounter.routeStep < expectedRouteStep; frame += 1) {
        stepWorld(zeroVelocity);
      }
      if (encounter.routeStep < expectedRouteStep) {
        throw new Error(`Boss never impacted ${platform.id}; mode=${encounter.state.mode}`);
      }
      const landing = bossLandings.find((entry) => entry.platformId === platform.id);
      if (!landing) throw new Error(`Impact advanced without a recorded boss landing on ${platform.id}`);
      if (landing.landingError > 0.001) {
        throw new Error(`Boss missed ${platform.id} by ${landing.landingError}`);
      }
    };

    const waitForRouteLeadClearance = (platform) => {
      const routeProgress = getRouteProgress(platform.segmentIndex, platform.sequence);
      for (let frame = 0; frame < 720 && routeProgress?.leadCompleteFrame == null; frame += 1) {
        stepWorld(zeroVelocity);
      }
      if (!routeProgress || routeProgress.leadCompleteFrame == null) {
        throw new Error(`Boss did not withdraw toward the next support after ${platform.id}`);
      }
      if (routeProgress.playerCompletionFrame == null) {
        const minimumHoldFrames = routeProgress.leadHoldFrames + 12;
        for (let frame = 0; frame < 120 && routeProgress.leadHoldFrames < minimumHoldFrames; frame += 1) {
          stepWorld(zeroVelocity);
        }
        if (routeProgress.leadHoldFrames < minimumHoldFrames) {
          throw new Error(`Boss did not hold its lead while waiting beyond ${platform.id}`);
        }
      }
    };

    const waitForRaisedMechanism = (platform) => {
      if (!platform.dynamic || Math.abs(platform.targetTopY - platform.topY) <= 0.02) return;
      const route = stage.getRoutePlatforms(platform.segmentIndex);
      const handoffSurface = route.find((entry) => entry.sequence === platform.sequence + 1)
        ?? stage.getSealStation(platform.segmentIndex)?.platform
        ?? null;
      for (let frame = 0; frame < 360; frame += 1) {
        if (!platform.containsTop(player.root.position, 0.06)) {
          throw new Error(`${platform.id} moved without carrying the player on its footprint`);
        }
        const support = currentSupport();
        const handedOffAtEqualHeight = support === handoffSurface
          && Math.abs((handoffSurface?.topY ?? -Infinity) - platform.targetTopY) <= 0.02;
        if (Math.abs(platform.targetTopY - platform.topY) <= 0.02
          && Math.abs(player.root.position.y - platform.targetTopY) <= 0.28
          && (support === platform || handedOffAtEqualHeight)) return;
        stepWorld(desiredVelocityToward(platform.center));
      }
      throw new Error(
        `${platform.id} did not carry the player to ${platform.targetTopY}; top=${platform.topY}`,
      );
    };

    const ventLaunches = [];
    const waitForVentLanding = (vent, target) => {
      let sawLaunch = player.isJumpAirborne()
        && player.root.userData.lastTraversalLaunchSourceId === vent.routeId;
      let maximumY = player.root.position.y;
      for (let frame = 0; frame < 360; frame += 1) {
        if (sawLaunch && !player.isJumpAirborne() && isOverPlatform(target)) {
          ventLaunches.push({
            routeId: vent.routeId,
            fromPlatformId: vent.id,
            toPlatformId: target.id,
            maximumY,
            landingY: player.root.position.y,
          });
          return;
        }
        stepWorld(sawLaunch
          ? zeroVelocity
          : desiredVelocityToward(vent.center));
        maximumY = Math.max(maximumY, player.root.position.y);
        sawLaunch ||= player.isJumpAirborne()
          && player.root.userData.lastTraversalLaunchSourceId === vent.routeId;
        if (sawLaunch && !player.isJumpAirborne() && !isOverPlatform(target)) {
          throw new Error(
            `${vent.routeId} launch landed on ${currentSupport()?.id ?? 'no support'} instead of ${target.id}`,
          );
        }
      }
      throw new Error(
        `${vent.routeId} did not complete a live launch to ${target.id}; `
        + `sawLaunch=${sawLaunch}, jumpState=${player.jumpState}, `
        + `support=${currentSupport()?.id ?? 'none'}, targetEnabled=${target.enabled}, `
        + `ventState=${vent.ventState}, routeStep=${encounter.routeStep}, `
        + `containsVent=${vent.containsTop(player.root.position, 0.12)}, `
        + `heightDelta=${Math.abs(player.root.position.y - vent.topY).toFixed(3)}, `
        + `dead=${player.dead}, powerKnockback=${player.isPowerKnockbackActive?.() ?? false}, `
        + `ledge=${player.isLedgeClinging?.() ?? false}, external=${player.isExternalMotionActive?.() ?? false}, `
        + `position=${player.root.position.toArray().map((value) => value.toFixed(2)).join(',')}, `
        + `launch=${JSON.stringify(player.getTraversalMechanismLaunchDiagnostics?.() ?? null)}`,
      );
    };

    const waitForMode = (mode, sealIndex, label, maximumFrames = 900) => {
      for (let frame = 0; frame < maximumFrames; frame += 1) {
        if (encounter.state.mode === mode
          && (sealIndex == null || encounter.state.activeSealIndex === sealIndex)) return;
        stepWorld(zeroVelocity);
      }
      throw new Error(
        `${label} never reached ${mode}; actual=${encounter.state.mode}, seal=${encounter.state.activeSealIndex}`,
      );
    };

    const moveToFiringPosition = (station) => {
      const awayFromBoss = player.root.position.clone().sub(boss.root.position).setY(0);
      if (awayFromBoss.lengthSq() <= 0.0001) awayFromBoss.set(1, 0, 0);
      else awayFromBoss.normalize();
      const point = boss.root.position.clone().addScaledVector(awayFromBoss, 3.5);
      point.y = station.topY;
      if (station.radial) {
        const fromCenter = point.clone().sub(station.center).setY(0);
        const maximumRadius = Math.max(0, (Number(station.radius) || 0) - 0.6);
        if (fromCenter.length() > maximumRadius) {
          fromCenter.setLength(maximumRadius);
          point.copy(station.center).add(fromCenter);
          point.y = station.topY;
        }
      } else {
        point.x = Math.max(
          station.center.x - station.halfWidth + 0.6,
          Math.min(station.center.x + station.halfWidth - 0.6, point.x),
        );
        point.z = Math.max(
          station.center.z - station.halfDepth + 0.6,
          Math.min(station.center.z + station.halfDepth - 0.6, point.z),
        );
      }
      for (let frame = 0; frame < 180; frame += 1) {
        if (horizontalDistance(player.root.position, point) <= 0.2
          && currentSupport() === station) return;
        stepWorld(desiredVelocityToward(point));
      }
      throw new Error(
        `Could not establish a firing line on ${station.id}; `
        + `mode=${encounter.state.mode}, knockback=${player.powerKnockbackState ?? 'none'}, `
        + `hurt=${player.animation.hurtTimer.toFixed(2)}, support=${currentSupport()?.id ?? 'none'}, `
        + `position=${player.root.position.toArray().map((value) => value.toFixed(2)).join(',')}, `
        + `target=${point.toArray().map((value) => value.toFixed(2)).join(',')}`,
      );
    };

    const busterFireProgress = [];
    const fireAtActiveSeal = async (sealIndex, goal) => {
      const target = encounter.getCombatTargets().find((entry) => entry.sealIndex === sealIndex);
      if (!target?.active) throw new Error(`Compression Seal ${sealIndex + 1} is not naturally active`);
      const plan = game.getActiveBusterPlan?.();
      const weaponKey = plan?.weaponKey ?? plan?.buildId ?? game.busterRuntime?.activeKey;
      if (!game.busterRuntime || !weaponKey) throw new Error('No live Buster runtime is available');
      game.busterRuntime.update(0, { activeWeaponKey: weaponKey });
      const startIntegrity = encounter.sealIntegrity[sealIndex];
      const shots = [];

      for (let attempt = 0; attempt < 96 && !goal(); attempt += 1) {
        const activeTarget = encounter.getCombatTargets()
          .find((entry) => entry.sealIndex === sealIndex);
        if (!activeTarget?.active) break;
        const origin = player.getProjectileOrigin?.() ?? player.getAttackOrigin();
        const aimPoint = activeTarget.getWorldPosition(player.root.position.clone());
        const direction = aimPoint.clone().sub(origin);
        if (direction.lengthSq() <= 0.0001) direction.set(-1, 0, 0);
        else direction.normalize();
        const integrityBefore = encounter.sealIntegrity[sealIndex];
        const originSnapshot = origin.toArray();
        const aimPointSnapshot = aimPoint.toArray();
        const fired = game.busterRuntime.fire({
          origin: origin.clone(),
          direction,
          aimPoint: aimPoint.clone(),
          target: activeTarget,
          noRewards: true,
        }, weaponKey);
        if (!fired.ok) {
          for (let frame = 0; frame < 20; frame += 1) {
            game.busterRuntime.update(1 / 120, { activeWeaponKey: weaponKey });
            game.projectiles.update(1 / 120);
          }
          continue;
        }

        let flightFrames = 0;
        for (; flightFrames < 240; flightFrames += 1) {
          game.busterRuntime.update(1 / 120, { activeWeaponKey: weaponKey });
          game.projectiles.update(1 / 120);
          if (encounter.sealIntegrity[sealIndex] < integrityBefore - 1e-6 || goal()) break;
        }
        shots.push({
          executionId: fired.execution.executionId,
          integrityBefore,
          integrityAfter: encounter.sealIntegrity[sealIndex],
          flightFrames: flightFrames + 1,
          origin: originSnapshot,
          aimPoint: aimPointSnapshot,
          aimDistance: origin.distanceTo(aimPoint),
        });
      }

      const progress = {
        sealIndex,
        weaponKey,
        startIntegrity,
        endIntegrity: encounter.sealIntegrity[sealIndex],
        shots,
        goalReached: goal(),
      };
      busterFireProgress.push(progress);
      if (!progress.goalReached) {
        throw new Error(
          `Live Buster fire did not complete Compression Seal ${sealIndex + 1}; `
          + `integrity=${progress.endIntegrity}, mode=${encounter.state.mode}, shots=${shots.length}, `
          + `firstShot=${JSON.stringify(shots[0] ?? null)}, `
          + `impacts=${JSON.stringify(projectileSealImpacts.slice(-3))}, `
          + `player=${player.root.position.toArray().map((value) => value.toFixed(2)).join(',')}, `
          + `boss=${boss.root.position.toArray().map((value) => value.toFixed(2)).join(',')}`,
        );
      }
    };

    const settleCheckpoint = async (nextSegmentIndex) => {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (!encounter.pendingCheckpointCommit
          && encounter.state.segmentIndex === nextSegmentIndex) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      throw new Error(`Checkpoint ${nextSegmentIndex} did not commit`);
    };
    const settleVictory = async () => {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (!encounter.pendingVictoryCommit && boss.dead) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      throw new Error('Final Ascension victory did not commit');
    };

    const visitedPlatformIds = [];
    const visitedSealStationIds = [];
    let currentSurface = stage.getCheckpoint(0).platform;

    for (let segmentIndex = 0; segmentIndex < 3; segmentIndex += 1) {
      const route = stage.getRoutePlatforms(segmentIndex);
      for (const platform of route) {
        currentRouteTestLabel = `route ${platform.routeId}`;
        waitForImpact(platform);
        waitForRouteLeadClearance(platform);
        if (platform.role === 'launchVent') {
          const immediateLanding = route.find((entry) => entry.sequence === platform.sequence + 1);
          if (immediateLanding) {
            waitForImpact(immediateLanding);
            waitForRouteLeadClearance(immediateLanding);
          }
        }
        driveOntoPlatform(platform, currentSurface);
        if (!(platform.role === 'launchVent'
          ? hasOccupiedPlatform(platform)
          : isOverPlatform(platform))) {
          throw new Error(`Player never occupied ${platform.id}`);
        }
        visitedPlatformIds.push(platform.id);
        waitForRaisedMechanism(platform);
        if (platform.role === 'launchVent') {
          const next = route.find((entry) => entry.sequence === platform.sequence + 1)
            ?? stage.getSealStation(segmentIndex).platform;
          waitForVentLanding(platform, next);
          currentSurface = next;
        } else {
          currentSurface = platform;
        }
      }

      const station = stage.getSealStation(segmentIndex).platform;
      driveOntoPlatform(station, currentSurface);
      if (!isOverPlatform(station)) throw new Error(`Player never reached ${station.id}`);
      visitedSealStationIds.push(station.id);
      currentSurface = station;
      waitForMode('punish', segmentIndex, `Compression Seal ${segmentIndex + 1}`);
      moveToFiringPosition(station);
      await fireAtActiveSeal(
        segmentIndex,
        () => Boolean(encounter.pendingCheckpointCommit)
          || encounter.state.activeSealIndex !== segmentIndex,
      );
      await settleCheckpoint(segmentIndex + 1);
    }

    const phaseTwoAfterThirdSeal = boss.bossState.phase === 2;
    const summitVent = stage.getRoutePlatforms(3)[0];
    driveOntoPlatform(summitVent, currentSurface);
    if (!hasOccupiedPlatform(summitVent)) throw new Error('Player never occupied the summit launch vent');
    visitedPlatformIds.push(summitVent.id);
    const summitStation = stage.getSealStation(3).platform;
    waitForVentLanding(summitVent, summitStation);
    visitedSealStationIds.push(summitStation.id);
    currentSurface = summitStation;
    waitForMode('summit', null, 'Summit arrival');

    const summitLandingCountBefore = bossLandings.filter((entry) => entry.summit).length;
    waitForMode('punish', 3, 'Natural summit attack punish window', 1_200);
    const summitLandings = bossLandings.filter((entry) => entry.summit);
    const naturalSummitCycleCompleted = summitLandings.length > summitLandingCountBefore;

    moveToFiringPosition(summitStation);
    await fireAtActiveSeal(3, () => encounter.state.mode === 'finalCharge');
    const finalChargeStarted = encounter.state.mode === 'finalCharge'
      && encounter.state.activeSealIndex === 3;
    await fireAtActiveSeal(
      3,
      () => Boolean(encounter.pendingVictoryCommit) || boss.dead,
    );
    await settleVictory();

    const expectedRoutePlatformIds = [0, 1, 2, 3]
      .flatMap((segmentIndex) => stage.getRoutePlatforms(segmentIndex).map((platform) => platform.id));
    const expectedBossImpactPlatformIds = [0, 1, 2]
      .flatMap((segmentIndex) => stage.getRoutePlatforms(segmentIndex).map((platform) => platform.id));
    const traversalBossLandings = bossLandings.filter((entry) => entry.platformId !== null);
    const bossLeadProgress = routeProgressRecords.map((entry) => ({
      segmentIndex: entry.segmentIndex,
      sequence: entry.sequence,
      platformId: entry.platformId,
      routeId: entry.routeId,
      role: entry.platform.role,
      dynamic: entry.platform.dynamic === true,
      nextSupportId: entry.nextSupport?.id ?? null,
      attackStartFrame: entry.attackStartFrame,
      previousPlayerCompletionFrame: entry.previousPlayerCompletionFrame,
      landingFrame: entry.landingFrame,
      landedBeforePlayerCompletion: entry.landedBeforePlayerCompletion,
      playerCompletionFrame: entry.playerCompletionFrame,
      playerCompletion: entry.playerCompletion,
      bossClearanceAtPlayerCompletion: entry.bossClearanceAtPlayerCompletion,
      leadStartFrame: entry.leadStartFrame,
      leadCompleteFrame: entry.leadCompleteFrame,
      leadPathDistance: entry.leadPathDistance,
      leadLandingError: entry.leadLandingError,
      leadTargetEdgeClearance: entry.leadTargetEdgeClearance,
      leadTargetHoverHeight: entry.leadTargetHoverHeight,
      leadTargetInwardAlignment: entry.leadTargetInwardAlignment,
      leadTargetInsideTraversalBounds: entry.leadTargetInsideTraversalBounds,
      leadHoldFrames: entry.leadHoldFrames,
      leadHoldMaximumDrift: entry.leadHoldMaximumDrift,
    }));
    const output = {
      expectedRoutePlatformIds,
      visitedPlatformIds,
      expectedBossImpactPlatformIds,
      traversalBossLandings,
      bossLeadProgress,
      bossTransits,
      summitLandings,
      naturalSummitCycleCompleted,
      ventLaunches,
      visitedSealStationIds,
      checkpointCommits,
      victoryCommits,
      busterFireProgress,
      projectileSealImpacts,
      shockwaveDodgeRecords,
      finalChargeStarted,
      phaseTwoAfterThirdSeal,
      final: {
        brokenSeals: [...encounter.state.brokenSeals],
        phase: boss.bossState.phase,
        dead: boss.dead,
        stageCompleted: stage.completed,
        encounterMode: encounter.state.mode,
        resetReasons,
      },
      simulatedFrames,
    };

    encounter._resetCurrentChamber = originalResetCurrentChamber;
    game.commitAscensionCheckpoint = originalCommitCheckpoint;
    game.commitAscensionVictory = originalCommitVictory;
    game.damageEnemy = originalDamageEnemy;
    boss.dispose();
    boss.root.removeFromParent();
    const bossIndex = game.enemies.indexOf(boss);
    if (bossIndex >= 0) game.enemies.splice(bossIndex, 1);
    return output;
  });

  expect(result.visitedPlatformIds).toEqual(result.expectedRoutePlatformIds);
  expect(result.traversalBossLandings.map((entry) => entry.platformId))
    .toEqual(result.expectedBossImpactPlatformIds);
  expect(result.traversalBossLandings.every((entry) => (
    entry.pathDistance > 0.1
    && entry.directTravelDistance > 0.1
    && entry.landingError <= 0.001
  ))).toBe(true);
  expect(result.bossLeadProgress.map((entry) => entry.platformId))
    .toEqual(result.expectedBossImpactPlatformIds);
  expect(result.bossLeadProgress.every((entry) => (
    entry.attackStartFrame != null
    && entry.landingFrame != null
    && entry.playerCompletionFrame != null
    && entry.attackStartFrame <= entry.landingFrame
    && entry.landingFrame < entry.playerCompletionFrame
    && entry.landedBeforePlayerCompletion
    && entry.leadStartFrame >= entry.landingFrame
    && entry.leadCompleteFrame >= entry.leadStartFrame
    && entry.leadCompleteFrame < entry.playerCompletionFrame
    && entry.bossClearanceAtPlayerCompletion >= 4.5 - 0.02
    && entry.leadPathDistance > 0.1
    && entry.leadLandingError <= 0.001
    && entry.leadTargetEdgeClearance >= 4.5 - 0.001
    && Math.abs(entry.leadTargetHoverHeight - 3.5) <= 0.001
    && entry.leadTargetInwardAlignment >= Math.cos(Math.PI / 30)
    && entry.leadTargetInsideTraversalBounds
    && entry.leadHoldFrames > 0
    && (entry.role === 'launchVent' || entry.leadHoldMaximumDrift <= 0.02)
  ))).toBe(true);
  const bossLeadOrderingValid = result.bossLeadProgress.every((entry, _index, records) => {
    if (entry.sequence === 0) return entry.previousPlayerCompletionFrame == null;
    const previous = records.find((candidate) => (
      candidate.segmentIndex === entry.segmentIndex
      && candidate.sequence === entry.sequence - 1
    ));
    if (previous?.role === 'launchVent') {
      return previous.playerCompletionFrame != null
        && entry.attackStartFrame < previous.playerCompletionFrame
        && entry.leadCompleteFrame < previous.playerCompletionFrame;
    }
    return previous?.playerCompletionFrame != null
      && entry.previousPlayerCompletionFrame === previous.playerCompletionFrame
      && entry.attackStartFrame >= previous.playerCompletionFrame;
  });
  expect(
    bossLeadOrderingValid,
    `Invalid boss/player route ordering: ${JSON.stringify(result.bossLeadProgress)}`,
  ).toBe(true);
  expect(result.bossLeadProgress.every((entry) => {
    const completion = entry.playerCompletion;
    if (!completion) return false;
    if (entry.role === 'launchVent') {
      return completion.airborne && completion.launchSourceId === entry.routeId;
    }
    if (entry.dynamic) {
      return completion.onPlatformFootprint
        && Math.abs(completion.platformTopY - completion.targetTopY) <= 0.02
        && Math.abs(completion.playerY - completion.targetTopY) <= 0.28;
    }
    return completion.onPlatformFootprint
      && Math.abs(completion.playerY - completion.platformTopY) <= 0.28;
  })).toBe(true);
  expect(result.bossTransits.map((entry) => ({
    kind: entry.kind,
    segmentIndex: entry.segmentIndex,
  }))).toEqual([
    { kind: 'sealApproach', segmentIndex: 0 },
    { kind: 'segmentAscent', segmentIndex: 1 },
    { kind: 'sealApproach', segmentIndex: 1 },
    { kind: 'segmentAscent', segmentIndex: 2 },
    { kind: 'sealApproach', segmentIndex: 2 },
    { kind: 'segmentAscent', segmentIndex: 3 },
  ]);
  expect(result.bossTransits.every((entry) => (
    entry.pathDistance > 0.1
    && entry.directTravelDistance > 0.1
    && entry.landingError <= 0.001
  ))).toBe(true);
  expect(result.ventLaunches.map((entry) => entry.routeId)).toEqual([
    'foundryVentLower',
    'foundryVentUpper',
    'summitLaunchVent',
  ]);
  expect(result.visitedSealStationIds).toEqual([
    'compressionSealStation:compressionFoundry',
    'compressionSealStation:brokenElevatorSpine',
    'compressionSealStation:suspendedMachinerySea',
    'compressionSealStation:summitTrial',
  ]);
  expect(result.checkpointCommits).toEqual([
    {
      securedCheckpointIndex: 1,
      securedCheckpointId: 'ascensionCheckpoint:compressionFoundry',
      brokenSealIndex: 0,
    },
    {
      securedCheckpointIndex: 2,
      securedCheckpointId: 'ascensionCheckpoint:brokenElevatorSpine',
      brokenSealIndex: 1,
    },
    {
      securedCheckpointIndex: 3,
      securedCheckpointId: 'ascensionCheckpoint:suspendedMachinerySea',
      brokenSealIndex: 2,
    },
  ]);
  expect(result.busterFireProgress.map((entry) => entry.sealIndex)).toEqual([0, 1, 2, 3, 3]);
  expect(result.busterFireProgress.every((entry) => (
    entry.goalReached
    && entry.shots.length > 0
    && entry.endIntegrity < entry.startIntegrity
    && entry.shots.some((shot) => shot.integrityAfter < shot.integrityBefore)
  ))).toBe(true);
  const resolvedSealImpacts = result.projectileSealImpacts
    .filter((impact) => impact.ascensionSealHit);
  expect(resolvedSealImpacts.length).toBeGreaterThanOrEqual(5);
  expect([...new Set(resolvedSealImpacts.map((impact) => impact.ascensionSealIndex))])
    .toEqual([0, 1, 2, 3]);
  expect(resolvedSealImpacts.every((impact) => (
    impact.ascensionSealHit
    && impact.ascensionSealIndex === impact.activeSealIndexBefore
    && impact.damageNullified
    && typeof impact.hitPartId === 'string'
  ))).toBe(true);
  expect(result.shockwaveDodgeRecords.length).toBeGreaterThan(0);
  expect(result.shockwaveDodgeRecords.every((dodge) => dodge.hit === false)).toBe(true);
  expect(result.naturalSummitCycleCompleted).toBe(true);
  expect(result.summitLandings.length).toBeGreaterThanOrEqual(1);
  expect(result.summitLandings.every((entry) => entry.landingError <= 0.001)).toBe(true);
  expect(result.finalChargeStarted).toBe(true);
  expect(result.phaseTwoAfterThirdSeal).toBe(true);
  expect(result.victoryCommits).toBe(1);
  expect(result.final).toEqual({
    brokenSeals: [true, true, true, true],
    phase: 2,
    dead: true,
    stageCompleted: true,
    encounterMode: 'defeated',
    resetReasons: [],
  });
  expect(result.simulatedFrames).toBeGreaterThan(0);
});

test('summit punish expiry resumes Phase II without replaying the summit transition', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=ascension-summit-punish-resume');
  await waitForGame(page);
  expect((await selectAscensionHunt(page)).ok).toBe(true);

  const result = await page.evaluate(async () => {
    const game = window.game;
    const { AscensionEngineEncounter } = await import('/src/reaverbots/bosses/AscensionEngineEncounter.js');
    const { createAscensionEngineEncounterProgress } = await import('/src/buster/BusterLabStorage.js');
    const spawned = game.debugSpawnBoss('ascensionEngine');
    if (!spawned.ok) throw new Error(spawned.message ?? spawned.reason);
    const boss = spawned.boss;
    boss.update(0, game);

    boss.specialEncounter.dispose(game, 'summit-punish-resume');
    boss.expeditionSpec = {
      ...boss.expeditionSpec,
      encounterProgress: createAscensionEngineEncounterProgress(3),
    };
    boss.specialEncounter = new AscensionEngineEncounter(boss);
    boss.update(0, game);

    const encounter = boss.specialEncounter;
    const stage = encounter.stage;
    const player = game.player;
    const controller = game.dungeonController;
    const summitVent = stage.getRoutePlatforms(3)[0];
    const summitPlatform = stage.getSealStation(3).platform;
    const dt = 1 / 60;
    const zeroVelocity = player.root.position.clone().set(0, 0, 0);
    const desiredVelocityToward = (point, maximumSpeed = 4.35) => {
      const desired = point.clone().sub(player.root.position).setY(0);
      const distance = desired.length();
      if (distance <= 0.001) return desired.set(0, 0, 0);
      return desired.multiplyScalar(Math.min(maximumSpeed, distance * 7) / distance);
    };

    let summitTrialCalls = 0;
    let phaseTransitionCalls = 0;
    let beginPhaseTwoCalls = 0;
    let incomingHits = 0;
    const resetReasons = [];
    const originalBeginSummitTrial = encounter._beginSummitTrial.bind(encounter);
    encounter._beginSummitTrial = (...args) => {
      summitTrialCalls += 1;
      return originalBeginSummitTrial(...args);
    };
    const originalResetCurrentChamber = encounter._resetCurrentChamber.bind(encounter);
    encounter._resetCurrentChamber = (reason) => {
      resetReasons.push(reason);
      return originalResetCurrentChamber(reason);
    };
    const originalBeginPhaseTwo = boss._beginPhaseTwo.bind(boss);
    boss._beginPhaseTwo = (...args) => {
      beginPhaseTwoCalls += 1;
      return originalBeginPhaseTwo(...args);
    };
    const originalShowBossPhaseTransition = game.ui.showBossPhaseTransition;
    game.ui.showBossPhaseTransition = (...args) => {
      phaseTransitionCalls += 1;
      return originalShowBossPhaseTransition?.call(game.ui, ...args);
    };
    const originalTakeIncomingHit = player.takeIncomingHit;
    player.takeIncomingHit = () => {
      incomingHits += 1;
      return true;
    };

    const stepPlayerAndBoss = (desiredVelocity = zeroVelocity) => {
      stage.prePlayerUpdate(dt, game);
      boss.prePlayerUpdate(dt, game);
      const groundY = game._getPlayerGroundY();
      player._updatePhysicalJumpAndMovement(dt, desiredVelocity, {
        arenaRadius: game.arenaRadius,
        movementOptions: { groundY },
      });
      controller._constrainPlayerToWalkable();
      boss.update(dt, game);
    };

    const summitLaunchInitial = {
      mode: encounter.state.mode,
      segmentIndex: encounter.state.segmentIndex,
      ventState: summitVent.ventState,
      enabled: summitVent.enabled,
      bossCleared: encounter._bossClearedRoutePlatform(summitVent),
      containsPlayer: summitVent.containsTop(player.root.position, 0.12),
      playerHeightDelta: Math.abs(player.root.position.y - summitVent.topY),
      activationRadius: summitVent.launchActivationRadius,
      playerDistance: Math.hypot(
        player.root.position.x - summitVent.center.x,
        player.root.position.z - summitVent.center.z,
      ),
      playerAirborne: player.isJumpAirborne(),
      sourceId: player.root.userData.lastTraversalLaunchSourceId ?? null,
      bossPosition: boss.root.position.toArray(),
    };
    let ventLaunchSeen = player.root.userData.lastTraversalLaunchSourceId === summitVent.routeId
      && player.isJumpAirborne();
    let summitEntryFrame = null;
    for (let frame = 0; frame < 600; frame += 1) {
      stepPlayerAndBoss(desiredVelocityToward(summitPlatform.center));
      ventLaunchSeen ||= player.root.userData.lastTraversalLaunchSourceId === summitVent.routeId
        && player.isJumpAirborne();
      if (encounter.state.mode === 'summit') {
        summitEntryFrame = frame;
        break;
      }
    }
    if (summitEntryFrame == null) {
      throw new Error(
        `Natural summit entry failed: mode=${encounter.state.mode}, `
        + `position=${player.root.position.toArray().map((value) => value.toFixed(2)).join(',')}; `
        + `launch=${JSON.stringify(summitLaunchInitial)}`,
      );
    }

    const summitEntry = {
      mode: encounter.state.mode,
      phase: boss.bossState.phase,
      brokenSeals: [...encounter.state.brokenSeals],
      summitTrialCalls,
      phaseTransitionCalls,
      beginPhaseTwoCalls,
    };
    const finalSealIntegrityBefore = encounter.sealIntegrity[3];
    let firstAttackType = null;
    let punishFrame = null;
    for (let frame = 0; frame < 1_200; frame += 1) {
      boss.update(dt, game);
      if (!firstAttackType && encounter.activeAttack?.summit) {
        firstAttackType = encounter.activeAttack.type;
      }
      if (firstAttackType
        && encounter.state.mode === 'punish'
        && !encounter.activeAttack) {
        punishFrame = frame;
        break;
      }
    }
    if (punishFrame == null) throw new Error('Natural summit attack never completed its punish transition');

    const punish = {
      mode: encounter.state.mode,
      phase: boss.bossState.phase,
      activeSealIndex: encounter.state.activeSealIndex,
      punishRemaining: encounter.state.punishRemaining,
      summitTrialCalls,
      phaseTransitionCalls,
      beginPhaseTwoCalls,
    };
    const modeHistory = ['punish'];
    let previousMode = encounter.state.mode;
    let resumedAttackType = null;
    for (let frame = 0; frame < 1_200; frame += 1) {
      boss.update(dt, game);
      if (encounter.state.mode !== previousMode) {
        previousMode = encounter.state.mode;
        modeHistory.push(previousMode);
      }
      if (encounter.state.mode === 'summit' && encounter.activeAttack?.summit) {
        resumedAttackType = encounter.activeAttack.type;
        break;
      }
    }

    const resumed = {
      mode: encounter.state.mode,
      phase: boss.bossState.phase,
      activeSealIndex: encounter.state.activeSealIndex,
      brokenSeals: [...encounter.state.brokenSeals],
      finalSealIntegrity: encounter.sealIntegrity[3],
      summitTrialCalls,
      phaseTransitionCalls,
      beginPhaseTwoCalls,
      resetReasons: [...resetReasons],
    };
    let secondPunishFrame = null;
    for (let frame = 0; frame < 1_200; frame += 1) {
      boss.update(dt, game);
      if (encounter.state.mode === 'punish' && !encounter.activeAttack) {
        secondPunishFrame = frame;
        break;
      }
    }
    if (secondPunishFrame == null) throw new Error('Resumed summit attack never reached punish');

    const finalSeal = encounter.sealTargets[3];
    const finalHitMeta = {
      source: player,
      directHit: true,
      projectileHit: true,
      armorPierce: 9999,
      hitPartId: finalSeal.partId,
    };
    const finalThresholdDealt = game.damageEnemy(
      boss,
      encounter.sealIntegrityMax * 2,
      finalHitMeta,
    );
    const finalCharge = {
      mode: encounter.state.mode,
      integrityRatio: encounter.sealIntegrity[3] / encounter.sealIntegrityMax,
      dealt: finalThresholdDealt,
      damageNullified: finalHitMeta.damageNullified === true,
      summitTrialCalls,
      phaseTransitionCalls,
      beginPhaseTwoCalls,
    };
    const failuresBefore = encounter.finalChargeFailures;
    let failedChargeFrame = null;
    for (let frame = 0; frame < 1_200; frame += 1) {
      boss.update(dt, game);
      if (encounter.state.mode === 'punish'
        && encounter.finalChargeFailures > failuresBefore) {
        failedChargeFrame = frame;
        break;
      }
    }
    if (failedChargeFrame == null) throw new Error('Final charge never failed into its retry punish');
    const failedChargePunish = {
      mode: encounter.state.mode,
      phase: boss.bossState.phase,
      activeSealIndex: encounter.state.activeSealIndex,
      brokenSeals: [...encounter.state.brokenSeals],
      finalChargeFailures: encounter.finalChargeFailures,
      punishRemaining: encounter.state.punishRemaining,
      summitTrialCalls,
      phaseTransitionCalls,
      beginPhaseTwoCalls,
    };

    const failedChargeModeHistory = ['punish'];
    previousMode = encounter.state.mode;
    let retryAttackType = null;
    for (let frame = 0; frame < 1_200; frame += 1) {
      boss.update(dt, game);
      if (encounter.state.mode !== previousMode) {
        previousMode = encounter.state.mode;
        failedChargeModeHistory.push(previousMode);
      }
      if (encounter.state.mode === 'summit' && encounter.activeAttack?.summit) {
        retryAttackType = encounter.activeAttack.type;
        break;
      }
    }

    const output = {
      summitLaunchInitial,
      ventLaunchSeen,
      summitEntryFrame,
      summitEntry,
      firstAttackType,
      punishFrame,
      punish,
      modeHistory,
      resumedAttackType,
      resumed,
      secondPunishFrame,
      finalCharge,
      failedChargeFrame,
      failedChargePunish,
      failedChargeModeHistory,
      retryAttackType,
      retryResumed: {
        mode: encounter.state.mode,
        phase: boss.bossState.phase,
        activeSealIndex: encounter.state.activeSealIndex,
        brokenSeals: [...encounter.state.brokenSeals],
        finalSealIntegrity: encounter.sealIntegrity[3],
        summitTrialCalls,
        phaseTransitionCalls,
        beginPhaseTwoCalls,
        resetReasons: [...resetReasons],
        incomingHits,
      },
      finalSealIntegrityBefore,
    };

    player.takeIncomingHit = originalTakeIncomingHit;
    game.ui.showBossPhaseTransition = originalShowBossPhaseTransition;
    boss._beginPhaseTwo = originalBeginPhaseTwo;
    encounter._beginSummitTrial = originalBeginSummitTrial;
    encounter._resetCurrentChamber = originalResetCurrentChamber;
    boss.dispose();
    boss.root.removeFromParent();
    const bossIndex = game.enemies.indexOf(boss);
    if (bossIndex >= 0) game.enemies.splice(bossIndex, 1);
    return output;
  });

  expect(result.summitLaunchInitial).toMatchObject({
    mode: 'escape',
    segmentIndex: 3,
    ventState: 'launching',
    enabled: true,
    bossCleared: true,
    containsPlayer: true,
    activationRadius: 1.55,
    playerAirborne: true,
    sourceId: 'summitLaunchVent',
  });
  expect(result.summitLaunchInitial.playerHeightDelta).toBeLessThanOrEqual(0.24);
  expect(result.summitLaunchInitial.playerDistance)
    .toBeLessThanOrEqual(result.summitLaunchInitial.activationRadius);
  expect(result.ventLaunchSeen).toBe(true);
  expect(result.summitEntryFrame).toBeGreaterThan(0);
  expect(result.summitEntry).toEqual({
    mode: 'summit',
    phase: 2,
    brokenSeals: [true, true, true, false],
    summitTrialCalls: 1,
    phaseTransitionCalls: 0,
    beginPhaseTwoCalls: 0,
  });
  expect(result.firstAttackType).toEqual(expect.any(String));
  expect(result.punishFrame).toBeGreaterThan(0);
  expect(result.punish).toMatchObject({
    mode: 'punish',
    phase: 2,
    activeSealIndex: 3,
    summitTrialCalls: 1,
    phaseTransitionCalls: 0,
    beginPhaseTwoCalls: 0,
  });
  expect(result.punish.punishRemaining).toBeGreaterThan(0);
  expect(result.modeHistory).toEqual(['punish', 'summit']);
  expect(result.resumedAttackType).toEqual(expect.any(String));
  expect(result.resumed).toEqual({
    mode: 'summit',
    phase: 2,
    activeSealIndex: null,
    brokenSeals: [true, true, true, false],
    finalSealIntegrity: result.finalSealIntegrityBefore,
    summitTrialCalls: 1,
    phaseTransitionCalls: 0,
    beginPhaseTwoCalls: 0,
    resetReasons: [],
  });
  expect(result.secondPunishFrame).toBeGreaterThan(0);
  expect(result.finalCharge).toEqual({
    mode: 'finalCharge',
    integrityRatio: expect.closeTo(0.42, 8),
    dealt: 0,
    damageNullified: true,
    summitTrialCalls: 1,
    phaseTransitionCalls: 0,
    beginPhaseTwoCalls: 0,
  });
  expect(result.failedChargeFrame).toBeGreaterThan(0);
  expect(result.failedChargePunish).toMatchObject({
    mode: 'punish',
    phase: 2,
    activeSealIndex: 3,
    brokenSeals: [true, true, true, false],
    finalChargeFailures: 1,
    summitTrialCalls: 1,
    phaseTransitionCalls: 0,
    beginPhaseTwoCalls: 0,
  });
  expect(result.failedChargePunish.punishRemaining).toBeGreaterThan(0);
  expect(result.failedChargeModeHistory).toEqual(['punish', 'summit']);
  expect(result.retryAttackType).toEqual(expect.any(String));
  expect(result.retryResumed).toEqual({
    mode: 'summit',
    phase: 2,
    activeSealIndex: null,
    brokenSeals: [true, true, true, false],
    finalSealIntegrity: result.finalCharge.integrityRatio * result.finalSealIntegrityBefore,
    summitTrialCalls: 1,
    phaseTransitionCalls: 0,
    beginPhaseTwoCalls: 0,
    resetReasons: [],
    incomingHits: expect.any(Number),
  });
  expect(result.retryResumed.incomingHits).toBeGreaterThan(0);
});

test('Ascension entry and extraction preserve the original hub, camp, and NPC services', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=ascension-exterior-transition');
  await waitForGame(page);
  expect((await selectAscensionHunt(page)).ok).toBe(true);

  const result = await page.evaluate(async () => {
    const game = window.game;
    const group = game.dungeon.group;
    const exteriorObjects = [
      group.getObjectByName('minimalHubTown'),
      group.getObjectByName('minimalExpeditionCamp'),
      group.getObjectByName('rollCaskettNpc'),
      group.getObjectByName('expeditionSupportCar'),
      group.getObjectByName('rollWorkshopWorkbench'),
      group.getObjectByName('expeditionRuinLift'),
    ];
    const entry = game.dungeon.ruinEntryPosition.clone();
    const camp = game.dungeon.campReturnPosition.clone();
    const entered = await game.enterRuinFromCamp();
    const entryDistance = game.player.root.position.distanceTo(entry);
    const expeditionActiveAfterEntry = game.expeditionActive;
    const attachedAfterEntry = exteriorObjects.every((object) => object?.parent);
    game.ruinCompleted = true;
    const extracted = game.extractToCamp();
    return {
      entered,
      entryDistance,
      expeditionActiveAfterEntry,
      attachedAfterEntry,
      extracted,
      campDistance: game.player.root.position.distanceTo(camp),
      attachedAfterExtraction: exteriorObjects.every((object) => object?.parent),
      roomIds: game.dungeon.rooms.map((room) => room.id),
      interactableIds: game.dungeon.safeInteractables.map((entry) => entry.id),
    };
  });

  expect(result).toMatchObject({
    entered: true,
    expeditionActiveAfterEntry: true,
    attachedAfterEntry: true,
    extracted: true,
    attachedAfterExtraction: true,
    roomIds: expect.arrayContaining(['hubTown', 'expeditionCamp', 'entrance', 'compressionFoundry']),
    interactableIds: expect.arrayContaining([
      'garageWorkbench',
      'rollCaskett',
      'ruinResetConsole',
      'ruinLift',
    ]),
  });
  expect(result.entryDistance).toBeLessThanOrEqual(0.01);
  expect(result.campDistance).toBeLessThanOrEqual(0.01);
});

test('only the selected Ascension hunt replaces the procedural dungeon interior', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=ascension-selection-routing');
  await waitForGame(page);
  expect((await selectAscensionHunt(page)).ok).toBe(true);

  const result = await page.evaluate(async () => {
    const game = window.game;
    const ascension = {
      selected: game.getSelectedBossProfileId(),
      dungeonKind: game.dungeon.dungeonKind,
      replacesStandardDungeon: game.dungeon.replacesStandardDungeon,
      roomIds: game.dungeon.rooms.map((room) => room.id),
      environmentId: game.dungeon.specialEnvironmentId,
    };
    const switched = await game.selectBossHunt('revolvingFusillade');
    const conventional = {
      selected: game.getSelectedBossProfileId(),
      dungeonKind: game.dungeon.dungeonKind ?? null,
      replacesStandardDungeon: game.dungeon.replacesStandardDungeon === true,
      roomIds: game.dungeon.rooms.map((room) => room.id),
      environmentId: game.dungeon.specialEnvironmentId ?? null,
      hasProceduralTiles: game.dungeon.floorTiles.length > 0,
      hasOrdinaryEncounters: game.dungeon.encounters.some((encounter) => !encounter.isBoss),
      progressionAccepted: game.dungeon.progression?.validation?.accepted === true,
      exteriorPresent: [
        'minimalHubTown',
        'minimalExpeditionCamp',
        'rollCaskettNpc',
        'expeditionSupportCar',
      ].every((name) => Boolean(game.dungeon.group.getObjectByName(name))),
    };
    return { switched, ascension, conventional };
  });

  expect(result.switched).toMatchObject({
    ok: true,
    bossProfileId: 'revolvingFusillade',
  });
  expect(result.ascension).toMatchObject({
    selected: ASCENSION_PROFILE_ID,
    dungeonKind: 'ascensionReliquary',
    replacesStandardDungeon: true,
    environmentId: ASCENSION_ENVIRONMENT_ID,
    roomIds: expect.arrayContaining(['compressionFoundry', 'summitTrial']),
  });
  expect(result.conventional).toMatchObject({
    selected: 'revolvingFusillade',
    dungeonKind: null,
    replacesStandardDungeon: false,
    environmentId: null,
    roomIds: expect.arrayContaining([
      'hubTown',
      'expeditionCamp',
      'entrance',
      'enemyNest',
      'keycardRoom',
      'trapRoom',
      'conveyorRoom',
      'bossRoom',
      'shrineRoom',
    ]),
    hasProceduralTiles: true,
    hasOrdinaryEncounters: true,
    progressionAccepted: true,
    exteriorPresent: true,
  });
});

test('authored Ascension Engine exposes four seal anchors, blocks body damage, and cleans transient resources', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=ascension-authored-runtime');
  await waitForGame(page);
  expect((await selectAscensionHunt(page)).ok).toBe(true);

  const result = await page.evaluate(() => {
    const game = window.game;
    const spawned = game.openBossGeometryGallery('ascensionEngine');
    if (!spawned.ok) throw new Error(spawned.message ?? spawned.reason);
    const boss = spawned.boss;
    boss.update(0, game);
    boss.root.updateMatrixWorld(true);
    const encounter = boss.specialEncounter;
    encounter._startTraversalAttack();
    encounter._createShockwave(boss.root.position.clone(), 5.4);
    const galleryResourcesSeeded = boss.getBossResourceCounts(game);
    boss.update(1 / 60, game);
    const galleryContract = {
      debugGallery: boss.debugGallery,
      frozen: boss.hasStatus('freeze'),
      damage: boss.stats.damage,
      activeAttack: encounter.activeAttack !== null,
      resources: boss.getBossResourceCounts(game),
      attackCooldownFinite: Number.isFinite(encounter.attackCooldown),
      brainState: boss.brain.state,
      brainMoving: boss.brain.moving,
    };
    boss.update(1 / 60, game);
    galleryContract.stableAfterSecondUpdate = encounter.activeAttack === null
      && boss.getBossResourceCounts(game).telegraphs === 0
      && !Number.isFinite(encounter.attackCooldown);
    boss.brain.weakPointExposed = true;
    boss.weakPointBroken = false;
    boss.signaturePartOverloaded = false;
    const armoredLockTargets = boss.getLockOnTargets();
    const armoredAutoCandidate = game.combat._findLockCandidate({ homingRange: 100 });
    encounter._beginPunishWindow();
    boss.root.updateMatrixWorld(true);
    const combatTargets = boss.getCombatTargets();
    const exposedLockTargets = boss.getLockOnTargets();
    const exposedAutoCandidate = game.combat._findLockCandidate({ homingRange: 100 });
    Object.assign(game.combat.lockOn, {
      target: boss,
      progress: 1,
      movementLocked: true,
      manual: true,
      source: 'tab',
    });
    game.combat._maintainRetainedLock();
    const bodyLockRedirectedToSeal = game.combat.lockOn.target === encounter.sealTargets[0];
    encounter.state.activeSealIndex = 1;
    game.combat._maintainRetainedLock();
    const staleSealRedirectedToCurrentSeal = game.combat.lockOn.target === encounter.sealTargets[1];
    encounter.state.activeSealIndex = null;
    const inactiveSealClearsLock = game.combat._maintainRetainedLock() === false
      && game.combat.lockOn.target === null;
    encounter.state.activeSealIndex = 0;
    const genericWeakPointPosition = boss.weakPointTarget.getWorldPosition(
      new boss.root.position.constructor(),
    );
    const genericSignaturePosition = boss.signatureTarget.getWorldPosition(
      new boss.root.position.constructor(),
    );
    const resolveToward = (position, kind) => {
      const start = position.clone().add(new boss.root.position.constructor(0, 0, -3));
      const direction = position.clone().sub(start).normalize();
      if (kind === 'line') return boss.resolveLineHit(start, direction, 6, 0.08);
      return boss.resolveArcHit(start, direction, 6, 0.12);
    };
    const resolutionResults = [
      boss.resolveProjectileHit(genericWeakPointPosition, 0.08),
      boss.resolveProjectileHit(genericSignaturePosition, 0.08),
      resolveToward(genericWeakPointPosition, 'line'),
      resolveToward(genericSignaturePosition, 'line'),
      resolveToward(genericWeakPointPosition, 'arc'),
      resolveToward(genericSignaturePosition, 'arc'),
    ].map((hit) => hit ? {
      hitPartId: hit.hitPartId ?? null,
      ascensionSealHit: hit.ascensionSealHit === true,
    } : null);
    const combatIsolation = {
      targetKinds: combatTargets.map((target) => (
        target === boss
          ? 'bossBody'
          : target.isAscensionCompressionSeal
            ? `compressionSeal:${target.sealIndex}`
            : target === boss.weakPointTarget
              ? 'genericWeakPoint'
              : target === boss.signatureTarget
                ? 'genericSignature'
                : 'unknown'
      )),
      exposesGenericWeakPoint: combatTargets.includes(boss.weakPointTarget),
      exposesGenericSignature: combatTargets.includes(boss.signatureTarget),
      genericWeakPointPartId: boss.weakPointTarget.partId,
      genericSignaturePartId: boss.signatureTarget.partId,
      resolutionResults,
      armoredLockTargetCount: armoredLockTargets.length,
      armoredAutoCandidateIsBoss: armoredAutoCandidate === boss,
      exposedLockTargetKinds: exposedLockTargets.map((target) => (
        target.isAscensionCompressionSeal ? `compressionSeal:${target.sealIndex}` : 'other'
      )),
      exposedAutoCandidateIsCurrentSeal: exposedAutoCandidate === encounter.sealTargets[0],
      bodyLockRedirectedToSeal,
      staleSealRedirectedToCurrentSeal,
      inactiveSealClearsLock,
    };
    const bodyHealthBefore = boss.health;
    const bodyMeta = {
      source: game.player,
      directHit: true,
      projectileHit: true,
      armorPierce: 9999,
    };
    const bodyDamage = game.damageEnemy(boss, boss.stats.maxHealth, bodyMeta);
    const sealPositions = encounter.sealTargets.map((target) => {
      const position = target.getWorldPosition(new boss.root.position.constructor());
      return [position.x, position.y, position.z];
    });
    const sealTargetIds = encounter.sealTargets.map((target) => target.partId);
    const markers = {
      model: boss.root.userData.authoredBossModel,
      fallbackActive: boss.root.userData.authoredBossFallbackActive,
      authoredState: boss.authoredVisualState,
      authoredRoot: boss.visual.root.userData.authoredAscensionEngine,
      framePlan: boss.visual.frame.plan,
      shrineTorso: Boolean(boss.visual.root.getObjectByName('authoredAscensionShrineTorso')),
      compressionStack: Boolean(boss.visual.root.getObjectByName('authoredAscensionCompressionStack')),
      rubyEyeAnchor: Boolean(boss.visual.root.getObjectByName('authoredAscensionHipRubyEyeAnchor')),
      muzzleAnchor: boss.visual.weapon.muzzle?.name,
      sealAnchors: boss.visual.authoredSeals?.length ?? 0,
      clawAnchors: boss.visual.authoredClaws?.length ?? 0,
      boosterAnchors: boss.visual.authoredBoosters?.length ?? 0,
    };

    encounter._createLandingTelegraph(boss.root.position.clone(), 1.7, 'runtimeProbe');
    encounter._createShockwave(boss.root.position.clone(), 5.4);
    const namedObjects = [];
    game.scene.traverse((object) => {
      if (/^ascensionEngine(?:Telegraph|ExpandingShockwave)/.test(object.name)) namedObjects.push(object);
    });
    const resourcesBefore = boss.getBossResourceCounts(game);
    boss.dispose();
    boss.root.removeFromParent();
    const index = game.enemies.indexOf(boss);
    if (index >= 0) game.enemies.splice(index, 1);
    const resourcesAfter = boss.getBossResourceCounts(game);
    const lingeringNames = [];
    game.scene.traverse((object) => {
      if (/^ascensionEngine(?:Telegraph|ExpandingShockwave)/.test(object.name)) lingeringNames.push(object.name);
    });
    return {
      galleryResourcesSeeded,
      galleryContract,
      markers,
      sealTargetCount: sealTargetIds.length,
      uniqueSealTargetCount: new Set(sealTargetIds).size,
      sealTargetIds,
      finiteSealPositions: sealPositions.every((position) => position.every(Number.isFinite)),
      genericSignatureActive: boss.signatureTarget.active,
      combatIsolation,
      bodyDamage,
      bodyHealthBefore,
      bodyHealthAfter: boss.health,
      bodyMeta: {
        bossInvulnerable: bodyMeta.bossInvulnerable,
        traversalDamageBlocked: bodyMeta.ascensionTraversalDamageBlocked,
      },
      resourcesBefore,
      resourcesAfter,
      transientObjectsDetached: namedObjects.every((object) => object.parent === null),
      lingeringNames,
    };
  });

  expect(result.markers).toEqual({
    model: ASCENSION_PROFILE_ID,
    fallbackActive: false,
    authoredState: 'active',
    authoredRoot: true,
    framePlan: 'authoredAscensionEngine',
    shrineTorso: true,
    compressionStack: true,
    rubyEyeAnchor: true,
    muzzleAnchor: 'authoredAscensionEngineMuzzle',
    sealAnchors: 4,
    clawAnchors: 3,
    boosterAnchors: 2,
  });
  expect(result.galleryResourcesSeeded.telegraphs).toBe(2);
  expect(result.galleryContract).toEqual({
    debugGallery: true,
    frozen: false,
    damage: 0,
    activeAttack: false,
    resources: { projectiles: 0, telegraphs: 0, constructs: 0 },
    attackCooldownFinite: false,
    brainState: 'idle',
    brainMoving: false,
    stableAfterSecondUpdate: true,
  });
  expect(result.sealTargetCount).toBe(4);
  expect(result.uniqueSealTargetCount).toBe(4);
  expect(result.sealTargetIds).toEqual([
    expect.stringMatching(/^ascensionSeal:.*:0$/),
    expect.stringMatching(/^ascensionSeal:.*:1$/),
    expect.stringMatching(/^ascensionSeal:.*:2$/),
    expect.stringMatching(/^ascensionSeal:.*:3$/),
  ]);
  expect(result.finiteSealPositions).toBe(true);
  expect(result.genericSignatureActive).toBe(false);
  expect(result.combatIsolation.targetKinds).toEqual(['compressionSeal:0', 'bossBody']);
  expect(result.combatIsolation.exposesGenericWeakPoint).toBe(false);
  expect(result.combatIsolation.exposesGenericSignature).toBe(false);
  expect(result.combatIsolation).toMatchObject({
    armoredLockTargetCount: 0,
    armoredAutoCandidateIsBoss: false,
    exposedLockTargetKinds: ['compressionSeal:0'],
    exposedAutoCandidateIsCurrentSeal: true,
    bodyLockRedirectedToSeal: true,
    staleSealRedirectedToCurrentSeal: true,
    inactiveSealClearsLock: true,
  });
  expect(result.combatIsolation.resolutionResults).toHaveLength(6);
  for (const hit of result.combatIsolation.resolutionResults) {
    if (!hit) continue;
    expect(hit.hitPartId).not.toBe(result.combatIsolation.genericWeakPointPartId);
    expect(hit.hitPartId).not.toBe(result.combatIsolation.genericSignaturePartId);
    expect(hit.ascensionSealHit).toBe(true);
    expect(hit.hitPartId).toMatch(/^ascensionSeal:.*:0$/);
  }
  expect(result.bodyDamage).toBe(0);
  expect(result.bodyHealthAfter).toBe(result.bodyHealthBefore);
  expect(result.bodyMeta).toEqual({
    bossInvulnerable: true,
    traversalDamageBlocked: true,
  });
  expect(result.resourcesBefore.projectiles).toBeLessThanOrEqual(BOSS_RESOURCE_LIMITS.projectiles);
  expect(result.resourcesBefore.telegraphs).toBe(2);
  expect(result.resourcesBefore.telegraphs).toBeLessThanOrEqual(BOSS_RESOURCE_LIMITS.telegraphs);
  expect(result.resourcesBefore.constructs).toBeLessThanOrEqual(BOSS_RESOURCE_LIMITS.constructs);
  expect(result.resourcesAfter).toEqual({ projectiles: 0, telegraphs: 0, constructs: 0 });
  expect(result.transientObjectsDetached).toBe(true);
  expect(result.lingeringNames).toEqual([]);
});

test('shaft falls preserve combat resources, supported checkpoint corners stay valid, and defeat restores resources', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=ascension-checkpoint-lifecycle');
  await waitForGame(page);
  expect((await selectAscensionHunt(page)).ok).toBe(true);

  const result = await page.evaluate(() => {
    const game = window.game;
    const player = game.player;
    const loadout = player.gearLoadout;
    const barrierSetup = {
      slot: loadout.setDefenseUnlocked(true).ok,
      unlock: loadout.unlock('barrierGenerator').ok,
      equip: loadout.equip('barrierGenerator', 'defense').ok,
    };
    player.applyGearLoadoutState(loadout.snapshot(), { refillBarrier: true });

    const spawned = game.debugSpawnBoss('ascensionEngine');
    if (!spawned.ok) throw new Error(spawned.message ?? spawned.reason);
    const boss = spawned.boss;
    boss.update(0, game);
    const encounter = boss.specialEncounter;
    const stage = encounter.stage;
    const checkpoint = stage.getCheckpoint(0);

    const fallHealth = player.stats.maxHealth * 0.31;
    const fallBarrier = player.barrier.capacity * 0.2875;
    player.health = fallHealth;
    player.barrier.current = fallBarrier;
    player.barrier.broken = false;
    player.root.position.copy(checkpoint.position);
    player.root.position.y = stage.getFloorElevationOverride(checkpoint.position) - 1;
    encounter.elapsed = 2;
    encounter._detectFall();
    const fallRecovery = {
      health: player.health,
      barrierCurrent: player.barrier.current,
      barrierCapacity: player.barrier.capacity,
      dead: player.dead,
      animationDead: player.animation.dead,
      checkpointDistance: player.root.position.distanceTo(checkpoint.position.clone().add(
        new player.root.position.constructor(0, 0.03, 0),
      )),
      resetAt: encounter._lastResetAt,
    };

    const corner = checkpoint.platform.center.clone();
    corner.x += checkpoint.platform.halfWidth - 0.05;
    corner.z += checkpoint.platform.halfDepth - 0.05;
    corner.y = checkpoint.platform.topY + 0.03;
    player.root.position.copy(corner);
    const cornerSupport = game.getPlatformSupport(corner);
    const boundaryResetAtBefore = encounter._lastResetAt;
    encounter.elapsed = boundaryResetAtBefore + 1;
    encounter._detectFall();
    const boundaryCorner = {
      radialDistance: Math.hypot(corner.x - stage.center.x, corner.z - stage.center.z),
      playableRadius: stage.getSpatialDiagnostics().playableRadius,
      outsideTraversalBounds: stage.isOutsideTraversalBounds(corner),
      containsTop: checkpoint.platform.containsTop(corner),
      supportId: cornerSupport?.surface?.id ?? null,
      supportElevation: cornerSupport?.elevation ?? null,
      positionUnchanged: player.root.position.distanceTo(corner) <= 1e-9,
      resetTimestampUnchanged: encounter._lastResetAt === boundaryResetAtBefore,
    };

    player.health = 0;
    const deathStarted = player._handleHealthDepleted();
    const trueDefeat = {
      deathStarted,
      dead: player.dead,
      animationDead: player.animation.dead,
    };
    // Preserve a genuinely depleted resource state for the encounter's
    // checkpoint recovery path to refill, independent of death presentation.
    player.barrier.current = player.barrier.capacity * 0.1;
    player.barrier.broken = true;
    const defeatHandled = encounter.handlePlayerDefeat(game);
    const defeatRecovery = {
      handled: defeatHandled,
      health: player.health,
      maximumHealth: player.stats.maxHealth,
      barrierCurrent: player.barrier.current,
      barrierCapacity: player.barrier.capacity,
      barrierBroken: player.barrier.broken,
      dead: player.dead,
      animationDead: player.animation.dead,
      checkpointDistance: player.root.position.distanceTo(checkpoint.position.clone().add(
        new player.root.position.constructor(0, 0.03, 0),
      )),
    };

    const postClearHealth = player.stats.maxHealth * 0.22;
    const postClearBarrier = player.barrier.capacity * 0.3;
    player.health = postClearHealth;
    player.barrier.current = postClearBarrier;
    player.barrier.broken = false;
    stage.setCompleted(true);
    player.root.position.copy(checkpoint.position);
    player.root.position.y = -3;
    stage.prePlayerUpdate(1 / 60, game);
    const postClearRecovery = {
      health: player.health,
      barrierCurrent: player.barrier.current,
      dead: player.dead,
      checkpointDistance: player.root.position.distanceTo(checkpoint.position.clone().add(
        new player.root.position.constructor(0, 0.03, 0),
      )),
      expectedHealth: postClearHealth,
      expectedBarrier: postClearBarrier,
    };

    boss.dispose();
    boss.root.removeFromParent();
    const bossIndex = game.enemies.indexOf(boss);
    if (bossIndex >= 0) game.enemies.splice(bossIndex, 1);
    return {
      barrierSetup,
      expectedFallHealth: fallHealth,
      expectedFallBarrier: fallBarrier,
      fallRecovery,
      boundaryCorner,
      trueDefeat,
      defeatRecovery,
      postClearRecovery,
    };
  });

  expect(result.barrierSetup).toEqual({ slot: true, unlock: true, equip: true });
  expect(result.fallRecovery.health).toBeCloseTo(result.expectedFallHealth, 8);
  expect(result.fallRecovery.barrierCurrent).toBeCloseTo(result.expectedFallBarrier, 8);
  expect(result.fallRecovery.barrierCapacity).toBeGreaterThan(0);
  expect(result.fallRecovery.dead).toBe(false);
  expect(result.fallRecovery.animationDead).toBe(false);
  expect(result.fallRecovery.checkpointDistance).toBeLessThanOrEqual(1e-9);
  expect(result.boundaryCorner.radialDistance)
    .toBeLessThanOrEqual(result.boundaryCorner.playableRadius);
  expect(result.boundaryCorner).toMatchObject({
    playableRadius: 32,
    outsideTraversalBounds: false,
    containsTop: true,
    supportId: 'ascensionCheckpoint:initialFloor',
    supportElevation: 0.12,
    positionUnchanged: true,
    resetTimestampUnchanged: true,
  });
  expect(result.trueDefeat).toEqual({
    deathStarted: true,
    dead: true,
    animationDead: true,
  });
  expect(result.defeatRecovery.handled).toBe(true);
  expect(result.defeatRecovery.health)
    .toBeGreaterThanOrEqual(result.defeatRecovery.maximumHealth * 0.5);
  expect(result.defeatRecovery.barrierCapacity).toBeGreaterThan(0);
  expect(result.defeatRecovery.barrierCurrent).toBe(result.defeatRecovery.barrierCapacity);
  expect(result.defeatRecovery.barrierBroken).toBe(false);
  expect(result.defeatRecovery.dead).toBe(false);
  expect(result.defeatRecovery.animationDead).toBe(false);
  expect(result.defeatRecovery.checkpointDistance).toBeLessThanOrEqual(1e-9);
  expect(result.postClearRecovery).toEqual({
    health: result.postClearRecovery.expectedHealth,
    barrierCurrent: result.postClearRecovery.expectedBarrier,
    dead: false,
    checkpointDistance: expect.closeTo(0, 8),
    expectedHealth: result.postClearRecovery.expectedHealth,
    expectedBarrier: result.postClearRecovery.expectedBarrier,
  });
});

test('debug Ascension fallback stage is wholly removed from a generic dungeon on boss disposal', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=ascension-owned-stage-cleanup');
  await waitForGame(page);

  const result = await page.evaluate(async () => {
    const game = window.game;
    game.stop();
    const selected = await game.selectBossHunt('revolvingFusillade');
    const before = {
      selected,
      environmentId: game.dungeon.specialEnvironmentId ?? null,
      runtimeEnvironmentId: game.bossStageRuntime?.id ?? null,
      platformCount: game.dungeon.platforms.length,
      gameplayPlatformCount: game.platformingPlatforms.length,
      dynamicPlatformCount: game.dynamicPlatformingPlatforms.length,
      collisionCount: game.dungeon.solidZones.length,
    };
    const spawned = game.debugSpawnBoss('ascensionEngine');
    if (!spawned.ok) throw new Error(spawned.message ?? spawned.reason);
    const boss = spawned.boss;
    boss.update(0, game);
    const encounter = boss.specialEncounter;
    const stage = encounter.stage;
    const ownedPlatforms = [...stage.platforms];
    const ownedDynamicPlatforms = ownedPlatforms.filter((platform) => platform.dynamic);
    const collisionIds = new Set(stage.collisionZones.map((zone) => zone.id));
    const during = {
      ownsStage: encounter.ownsStage,
      rootAttached: stage.root.parent === game.dungeon.group,
      runtimeOwned: game.bossStageRuntime === stage,
      dungeonOwned: game.dungeon.specialEnvironment === stage,
      allStaticRegistered: ownedPlatforms.every((platform) => (
        game.dungeon.platforms.includes(platform)
        && game.platformingPlatforms.includes(platform)
      )),
      dynamicCount: ownedDynamicPlatforms.length,
      allDynamicRegistered: ownedDynamicPlatforms.every((platform) => (
        game.dynamicPlatformingPlatforms.includes(platform)
      )),
      collisionCount: collisionIds.size,
      allCollisionRegistered: [...collisionIds].every((id) => (
        game.dungeon.solidZones.some((zone) => zone.id === id)
        && game.dungeonController.solidZones.some((zone) => zone.id === id)
      )),
    };

    boss.dispose();
    const after = {
      stageDisposed: stage.disposed,
      rootDetached: stage.root.parent === null,
      runtimeEnvironment: game.bossStageRuntime?.id ?? null,
      dungeonEnvironment: game.dungeon.specialEnvironment?.id ?? null,
      dungeonEnvironmentId: game.dungeon.specialEnvironmentId ?? null,
      ownedDungeonPlatformsRemaining: ownedPlatforms.filter((platform) => (
        game.dungeon.platforms.includes(platform)
      )).length,
      ownedGameplayPlatformsRemaining: ownedPlatforms.filter((platform) => (
        game.platformingPlatforms.includes(platform)
      )).length,
      ownedDynamicPlatformsRemaining: ownedDynamicPlatforms.filter((platform) => (
        game.dynamicPlatformingPlatforms.includes(platform)
      )).length,
      ownedDungeonCollisionRemaining: game.dungeon.solidZones.filter((zone) => (
        collisionIds.has(zone.id)
      )).length,
      ownedControllerCollisionRemaining: game.dungeonController.solidZones.filter((zone) => (
        collisionIds.has(zone.id)
      )).length,
      platformCountRestored: game.dungeon.platforms.length === before.platformCount,
      gameplayPlatformCountRestored: game.platformingPlatforms.length === before.gameplayPlatformCount,
      dynamicPlatformCountRestored: game.dynamicPlatformingPlatforms.length === before.dynamicPlatformCount,
      collisionCountRestored: game.dungeon.solidZones.length === before.collisionCount,
    };
    boss.root.removeFromParent();
    const bossIndex = game.enemies.indexOf(boss);
    if (bossIndex >= 0) game.enemies.splice(bossIndex, 1);
    return { before, during, after };
  });

  expect(result.before.selected.ok).toBe(true);
  expect(result.before.environmentId).toBeNull();
  expect(result.before.runtimeEnvironmentId).toBeNull();
  expect(result.during).toMatchObject({
    ownsStage: true,
    rootAttached: true,
    runtimeOwned: true,
    dungeonOwned: true,
    allStaticRegistered: true,
    allDynamicRegistered: true,
    allCollisionRegistered: true,
  });
  expect(result.during.dynamicCount).toBeGreaterThan(0);
  expect(result.during.collisionCount).toBeGreaterThan(0);
  expect(result.after).toEqual({
    stageDisposed: true,
    rootDetached: true,
    runtimeEnvironment: null,
    dungeonEnvironment: null,
    dungeonEnvironmentId: null,
    ownedDungeonPlatformsRemaining: 0,
    ownedGameplayPlatformsRemaining: 0,
    ownedDynamicPlatformsRemaining: 0,
    ownedDungeonCollisionRemaining: 0,
    ownedControllerCollisionRemaining: 0,
    platformCountRestored: true,
    gameplayPlatformCountRestored: true,
    dynamicPlatformCountRestored: true,
    collisionCountRestored: true,
  });
});

test('missing persistence bridges fail closed for checkpoint and final-seal commits', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=ascension-missing-commit-bridges');
  await waitForGame(page);
  expect((await selectAscensionHunt(page)).ok).toBe(true);

  const result = await page.evaluate(async () => {
    const game = window.game;
    const spawned = game.debugSpawnBoss('ascensionEngine');
    if (!spawned.ok) throw new Error(spawned.message ?? spawned.reason);
    const boss = spawned.boss;
    boss.update(0, game);
    const encounter = boss.specialEncounter;
    game.commitAscensionCheckpoint = undefined;
    game.commitAscensionVictory = undefined;
    const hitSeal = (index, damage = encounter.sealIntegrityMax * 2) => {
      const target = encounter.sealTargets[index];
      return game.damageEnemy(boss, damage, {
        source: game.player,
        directHit: true,
        projectileHit: true,
        armorPierce: 9999,
        hitPartId: target.partId,
      });
    };
    const waitForPendingToClear = async (field) => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (!encounter[field]) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      throw new Error(`${field} did not settle`);
    };

    const checkpointHealthBefore = boss.health;
    encounter._beginPunishWindow();
    hitSeal(0);
    await waitForPendingToClear('pendingCheckpointCommit');
    const checkpointFailure = {
      segmentIndex: encounter.state.segmentIndex,
      securedCheckpoint: encounter.state.securedCheckpoint,
      brokenSeals: [...encounter.state.brokenSeals],
      activeSealIndex: encounter.state.activeSealIndex,
      mode: encounter.state.mode,
      integrityRatio: encounter.sealIntegrity[0] / encounter.sealIntegrityMax,
      healthUnchanged: boss.health === checkpointHealthBefore,
      dead: boss.dead,
      pending: encounter.pendingCheckpointCommit !== null,
    };

    encounter.state.segmentIndex = 3;
    encounter.state.securedCheckpoint = 3;
    encounter.state.securedCheckpointId = 'ascensionCheckpoint:suspendedMachinerySea';
    encounter.state.brokenSeals = [true, true, true, false];
    encounter.state.activeSealIndex = null;
    encounter.state.mode = 'punish';
    encounter.sealIntegrity = [0, 0, 0, encounter.sealIntegrityMax];
    encounter.stage.setActiveSegment(3);
    encounter.stage.resetSegment(3);
    encounter._beginPunishWindow();
    boss.health = boss.stats.maxHealth * 0.25;
    const finalHealthBefore = boss.health;
    hitSeal(3);
    const chargeStarted = {
      mode: encounter.state.mode,
      activeSealIndex: encounter.state.activeSealIndex,
      integrityRatio: encounter.sealIntegrity[3] / encounter.sealIntegrityMax,
    };
    hitSeal(3);
    await waitForPendingToClear('pendingVictoryCommit');
    const victoryFailure = {
      segmentIndex: encounter.state.segmentIndex,
      securedCheckpoint: encounter.state.securedCheckpoint,
      brokenSeals: [...encounter.state.brokenSeals],
      activeSealIndex: encounter.state.activeSealIndex,
      mode: encounter.state.mode,
      integrityRatio: encounter.sealIntegrity[3] / encounter.sealIntegrityMax,
      healthUnchanged: boss.health === finalHealthBefore,
      dead: boss.dead,
      bossVictoryCommitted: Boolean(boss.bossVictoryCommitted),
      pending: encounter.pendingVictoryCommit !== null,
    };

    delete game.commitAscensionCheckpoint;
    delete game.commitAscensionVictory;
    boss.dispose();
    boss.root.removeFromParent();
    const bossIndex = game.enemies.indexOf(boss);
    if (bossIndex >= 0) game.enemies.splice(bossIndex, 1);
    return { checkpointFailure, chargeStarted, victoryFailure };
  });

  expect(result.checkpointFailure).toEqual({
    segmentIndex: 0,
    securedCheckpoint: 0,
    brokenSeals: [false, false, false, false],
    activeSealIndex: 0,
    mode: 'punish',
    integrityRatio: expect.closeTo(0.08, 8),
    healthUnchanged: true,
    dead: false,
    pending: false,
  });
  expect(result.chargeStarted).toEqual({
    mode: 'finalCharge',
    activeSealIndex: 3,
    integrityRatio: expect.closeTo(0.42, 8),
  });
  expect(result.victoryFailure).toEqual({
    segmentIndex: 3,
    securedCheckpoint: 3,
    brokenSeals: [true, true, true, false],
    activeSealIndex: 3,
    mode: 'finalCharge',
    integrityRatio: expect.closeTo(0.08, 8),
    healthUnchanged: true,
    dead: false,
    bossVictoryCommitted: false,
    pending: false,
  });
});

test('debug seal hits commit in order, remove exact health quarters, and begin phase two after seal three', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=ascension-seal-order-runtime');
  await waitForGame(page);
  expect((await selectAscensionHunt(page)).ok).toBe(true);

  const result = await page.evaluate(async () => {
    const game = window.game;
    const spawned = game.debugSpawnBoss('ascensionEngine');
    if (!spawned.ok) throw new Error(spawned.message ?? spawned.reason);
    const boss = spawned.boss;
    boss.update(0, game);
    const encounter = boss.specialEncounter;
    const stage = encounter.stage;
    const checkpointCommits = [];
    let victoryCommits = 0;
    game.commitAscensionCheckpoint = async (_enemy, checkpoint) => {
      checkpointCommits.push({ ...checkpoint });
      return { ok: true, debug: true, encounterProgress: { ...checkpoint } };
    };
    game.commitAscensionVictory = async () => {
      victoryCommits += 1;
      return { ok: true, debug: true };
    };

    const healthRatios = [];
    const phases = [];
    const states = [];
    const settleCommit = async (kind) => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (kind === 'checkpoint' && !encounter.pendingCheckpointCommit) return;
        if (kind === 'victory' && (!encounter.pendingVictoryCommit || boss.dead)) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      throw new Error(`${kind} commit did not settle`);
    };
    const hitSeal = (index, damage = encounter.sealIntegrityMax * 2) => {
      const target = encounter.sealTargets[index];
      const meta = {
        source: game.player,
        directHit: true,
        projectileHit: true,
        armorPierce: 9999,
        hitPartId: target.partId,
      };
      const dealt = game.damageEnemy(boss, damage, meta);
      return { dealt, damageNullified: meta.damageNullified };
    };

    encounter._beginPunishWindow();
    const inactiveIntegrityBefore = encounter.sealIntegrity[1];
    const wrongOrderHit = hitSeal(1);
    const inactiveIntegrityAfter = encounter.sealIntegrity[1];

    for (let index = 0; index < 3; index += 1) {
      if (encounter.state.activeSealIndex !== index) encounter._beginPunishWindow();
      const hit = hitSeal(index);
      await settleCommit('checkpoint');
      healthRatios.push(boss.health / boss.stats.maxHealth);
      phases.push(boss.bossState.phase);
      states.push({
        hit,
        segmentIndex: encounter.state.segmentIndex,
        securedCheckpoint: encounter.state.securedCheckpoint,
        brokenSeals: [...encounter.state.brokenSeals],
        activeSealIndex: encounter.state.activeSealIndex,
      });
    }

    encounter._beginPunishWindow();
    const finalThresholdHit = hitSeal(3);
    const finalMode = encounter.state.mode;
    const finalThresholdRatio = encounter.sealIntegrity[3] / encounter.sealIntegrityMax;
    const finalBreakHit = hitSeal(3);
    await settleCommit('victory');

    const output = {
      wrongOrderHit,
      inactiveIntegrityBefore,
      inactiveIntegrityAfter,
      checkpointCommits,
      victoryCommits,
      healthRatios,
      phases,
      states,
      finalThresholdHit,
      finalMode,
      finalThresholdRatio,
      finalBreakHit,
      dead: boss.dead,
      finalHealth: boss.health,
      finalState: {
        mode: encounter.state.mode,
        brokenSeals: [...encounter.state.brokenSeals],
      },
      stageLifecycle: {
        completed: stage.completed,
        retainedAsRuntime: game.bossStageRuntime === stage,
        disposed: stage.disposed,
      },
      resources: boss.getBossResourceCounts(game),
    };
    boss.dispose();
    boss.root.removeFromParent();
    const index = game.enemies.indexOf(boss);
    if (index >= 0) game.enemies.splice(index, 1);
    return output;
  });

  expect(result.wrongOrderHit).toEqual({ dealt: 0, damageNullified: true });
  expect(result.inactiveIntegrityAfter).toBe(result.inactiveIntegrityBefore);
  expect(result.checkpointCommits).toEqual([
    {
      securedCheckpointIndex: 1,
      securedCheckpointId: 'ascensionCheckpoint:compressionFoundry',
      brokenSealIndex: 0,
    },
    {
      securedCheckpointIndex: 2,
      securedCheckpointId: 'ascensionCheckpoint:brokenElevatorSpine',
      brokenSealIndex: 1,
    },
    {
      securedCheckpointIndex: 3,
      securedCheckpointId: 'ascensionCheckpoint:suspendedMachinerySea',
      brokenSealIndex: 2,
    },
  ]);
  expect(result.healthRatios).toEqual([
    expect.closeTo(0.75, 8),
    expect.closeTo(0.5, 8),
    expect.closeTo(0.25, 8),
  ]);
  expect(result.phases).toEqual([1, 1, 2]);
  expect(result.states).toEqual([
    expect.objectContaining({
      hit: { dealt: 0, damageNullified: true },
      segmentIndex: 1,
      securedCheckpoint: 1,
      brokenSeals: [true, false, false, false],
      activeSealIndex: null,
    }),
    expect.objectContaining({
      hit: { dealt: 0, damageNullified: true },
      segmentIndex: 2,
      securedCheckpoint: 2,
      brokenSeals: [true, true, false, false],
      activeSealIndex: null,
    }),
    expect.objectContaining({
      hit: { dealt: 0, damageNullified: true },
      segmentIndex: 3,
      securedCheckpoint: 3,
      brokenSeals: [true, true, true, false],
      activeSealIndex: null,
    }),
  ]);
  expect(result.finalThresholdHit).toEqual({ dealt: 0, damageNullified: true });
  expect(result.finalMode).toBe('finalCharge');
  expect(result.finalThresholdRatio).toBeCloseTo(0.42, 8);
  expect(result.finalBreakHit).toEqual({ dealt: 0, damageNullified: true });
  expect(result.victoryCommits).toBe(1);
  expect(result.dead).toBe(true);
  expect(result.finalHealth).toBe(0);
  expect(result.finalState).toEqual({
    mode: 'defeated',
    brokenSeals: [true, true, true, true],
  });
  expect(result.stageLifecycle).toEqual({
    completed: true,
    retainedAsRuntime: true,
    disposed: false,
  });
  expect(result.resources).toEqual({ projectiles: 0, telegraphs: 0, constructs: 0 });
});
