import { expect, test } from '@playwright/test';

test('revamped melee, persistent rotors, direct flight, and Tractor Controllers execute their combat contracts', async ({ page }) => {
  await page.goto('/?reaverbotSeed=melee-controller-runtime-proof');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(() => {
    const game = window.game;
    const Vector3 = game.player.root.position.constructor;
    game.stop();

    const clearEnemies = () => {
      for (const enemy of [...game.enemies]) {
        enemy.dispose?.();
        enemy.root.removeFromParent();
      }
      game.enemies.length = 0;
    };
    const findEnemy = (archetypeId, attackKind, position) => {
      for (let variant = 0; variant < 160; variant += 1) {
        const enemy = window.spawnReaverbot({
          archetypeId,
          seed: `runtime-combat:${archetypeId}:${attackKind}:${variant}`,
          position,
        });
        if (enemy.genome.archetypeId === archetypeId
          && enemy.genome.modules.weapon.attackKind === attackKind) {
          return enemy;
        }
        const index = game.enemies.indexOf(enemy);
        if (index >= 0) game.enemies.splice(index, 1);
        enemy.dispose?.();
        enemy.root.removeFromParent();
      }
      throw new Error(`Could not generate ${archetypeId}/${attackKind}`);
    };

    clearEnemies();
    const playerBase = game.player.root.position.clone();
    game.player.health = game.player.stats.maxHealth;
    const originalPlayerTakeDamage = game.player.takeDamage;
    const recordedPlayerHits = [];
    game.player.takeDamage = (amount, source, meta = {}) => {
      recordedPlayerHits.push({ amount, source: source?.id, attackKind: meta.attackKind });
      return amount;
    };

    const claw = findEnemy(
      'duelist',
      'clawMoveset',
      playerBase.clone().add(new Vector3(0, 0, 1.85)),
    );
    let massiveClawPartCount = 0;
    claw.visual.weapon.group.traverse((object) => {
      if (object.userData?.massiveWeaponPart) massiveClawPartCount += 1;
    });
    const clawShoulderPosition = claw.visual.weapon.clawSwingPivot.getWorldPosition(new Vector3());
    const clawMuzzlePosition = claw.visual.weapon.muzzle.getWorldPosition(new Vector3());
    const clawSummary = {
      attackKind: claw.genome.modules.weapon.attackKind,
      weakPointId: claw.genome.modules.weakPoint.id,
      defenseId: claw.genome.modules.defense?.id ?? null,
      hasSwingPivot: Boolean(claw.visual.weapon.clawSwingPivot),
      hasElbowPivot: Boolean(claw.visual.weapon.clawElbowPivot),
      massivePartCount: massiveClawPartCount,
      muzzleReach: clawShoulderPosition.distanceTo(clawMuzzlePosition),
      armor: claw.stats.armor,
    };

    clearEnemies();
    recordedPlayerHits.length = 0;
    const jaw = findEnemy(
      'pursuer',
      'jawCombo',
      playerBase.clone().add(new Vector3(0, 0, 2.45)),
    );
    jaw.root.rotation.y = Math.PI;
    jaw.brain.state = 'telegraph';
    jaw.brain.stateTime = jaw.genome.behavior.telegraphDuration * 0.78;
    jaw.brain.time = 0.07;
    jaw._animateVisual(0.1);
    const jawHeldOpenAngle = Math.abs(jaw.visual.weapon.jawUpperPivot.rotation.x);
    const jawBlinkColor = jaw.visual.materials.weapon.emissive.getHex();
    const jawBlinkIntensity = jaw.visual.materials.weapon.emissiveIntensity;

    const originalAddExplosion = game.addExplosion;
    const jawShockwaves = [];
    game.addExplosion = (position, damage, radius, color, meta = {}) => {
      if (meta.attackKind === 'jawBiteShockwave') {
        jawShockwaves.push({ position: position.clone(), damage, radius, color });
      }
    };
    jaw.brain.state = 'commit';
    jaw.brain.stateTime = 0;
    jaw.brain.attackDirection.set(0, 0, -1);
    jaw.brain.comboStrikesFired = 0;
    const jawStart = jaw.root.position.clone();
    const jawDuration = jaw.genome.behavior.commitDuration;
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const hopTime = jawDuration * ((cycle + 0.5) / 3);
      jaw._updateCommitState(hopTime - jaw.brain.stateTime, game);
      const strikeTime = jawDuration * ((cycle + 0.72) / 3);
      jaw._updateCommitState(strikeTime - jaw.brain.stateTime, game);
    }
    let massiveJawPartCount = 0;
    jaw.visual.weapon.group.traverse((object) => {
      if (object.userData?.massiveWeaponPart) massiveJawPartCount += 1;
    });
    const jawSummary = {
      bodyPlan: jaw.genome.body.planId,
      shockwaveCount: jawShockwaves.length,
      allShockwavesMeleeRange: jawShockwaves.every((wave) => wave.radius >= 1.8),
      hopTravel: jaw.root.position.distanceTo(jawStart),
      heldOpenAngle: jawHeldOpenAngle,
      blinkColor: jawBlinkColor,
      blinkIntensity: jawBlinkIntensity,
      massivePartCount: massiveJawPartCount,
      hasTwoHinges: Boolean(jaw.visual.weapon.jawUpperPivot && jaw.visual.weapon.jawLowerPivot),
      armor: jaw.stats.armor,
      speed: jaw.stats.moveSpeed,
    };
    game.addExplosion = originalAddExplosion;

    clearEnemies();
    recordedPlayerHits.length = 0;
    const rotor = findEnemy('rotorHunter', 'charge', playerBase.clone());
    rotor.brain.state = 'recovery';
    rotor.brain.attackHit = true;
    rotor.brain.contactCooldown = 0;
    rotor._updatePersistentWeaponContact(0.01, game);
    rotor._updatePersistentWeaponContact(0.3, game);
    rotor._updatePersistentWeaponContact(0.31, game);
    const rotorHits = recordedPlayerHits.filter((hit) => hit.attackKind === 'rotorContact');
    const rotorSummary = {
      contactHits: rotorHits.length,
      state: rotor.brain.state,
      attackHitStayedIndependent: rotor.brain.attackHit,
      continuous: rotor.genome.modules.weapon.continuousContactDamage,
      contactRadius: rotor.genome.modules.weapon.contactRadius,
    };

    clearEnemies();
    const flyer = findEnemy(
      'aerialBomber',
      'selfDestruct',
      playerBase.clone().add(new Vector3(0, 0, 5)),
    );
    const dungeonController = game.dungeonController;
    const originalAerialNavigation = dungeonController.getAerialNavigationDirection;
    const originalGroundNavigation = dungeonController.getNavigationDirection;
    let aerialNavigationCalls = 0;
    let groundNavigationCalls = 0;
    dungeonController.getAerialNavigationDirection = (from, target) => {
      aerialNavigationCalls += 1;
      return target.clone().sub(from).normalize();
    };
    dungeonController.getNavigationDirection = () => {
      groundNavigationCalls += 1;
      return new Vector3(1, 0, 0);
    };
    const originalPlayerY = game.player.root.position.y;
    game.player.root.position.y += 2;
    const flyerStartY = flyer.root.position.y;
    flyer._moveByMode('approach', 0.5, game, new Vector3(0, 0, -1), 5);
    const flyerSummary = {
      navigationMode: flyer.navigationMode,
      yTravel: flyer.root.position.y - flyerStartY,
      aerialNavigationCalls,
      groundNavigationCalls,
    };
    game.player.root.position.y = originalPlayerY;
    dungeonController.getAerialNavigationDirection = originalAerialNavigation;
    dungeonController.getNavigationDirection = originalGroundNavigation;

    clearEnemies();
    const cargoPosition = playerBase.clone().add(new Vector3(0, 0, 4));
    const cargo = findEnemy('pursuer', 'charge', cargoPosition);
    const tractor = findEnemy('tractorController', 'tractorBeam', cargoPosition.clone());
    tractor.root.position.y = tractor._getTractorControllerHeight(cargo);
    tractor.brain.cooldown = 0;
    const originalControllerAerialNavigation = dungeonController.getAerialNavigationDirection;
    const originalWalkable = dungeonController.isPositionWalkable;
    const originalSurface = dungeonController.getSurfaceElevationAt;
    dungeonController.getAerialNavigationDirection = (from, target) => {
      const direction = target.clone().sub(from);
      return direction.lengthSq() > 0.0001 ? direction.normalize() : new Vector3(0, 0, 1);
    };
    dungeonController.isPositionWalkable = () => true;
    dungeonController.getSurfaceElevationAt = () => playerBase.y;

    tractor._updateTractorController(0.05, game);
    const claimed = cargo.hasExternalControl(tractor);
    const telegraphState = tractor.brain.state;
    tractor._updateTractorController(tractor.genome.behavior.telegraphDuration + 0.01, game);
    const beamVisibleDuringTelegraph = tractor.visual.weapon.tractorBeam.visible;
    const commitState = tractor.brain.state;
    const cargoGroundY = cargo.root.position.y;
    tractor._updateTractorController(0.5, game);
    const cargoLift = cargo.root.position.y - cargoGroundY;
    const cargoRotation = Math.abs(cargo.root.rotation.y);

    const tractorImpacts = [];
    game.addExplosion = (position, damage, radius, color, meta = {}) => {
      if (meta.attackKind === 'tractorThrownEnemy') {
        tractorImpacts.push({ position: position.clone(), damage, radius, color });
      }
    };
    tractor._updateTractorController(1.8, game);
    const throwStarted = cargo.isExternalMotionActive();
    const landingTarget = cargo.externalBallisticMotion?.targetPosition.clone() ?? null;
    const targetReleasedByThrow = !cargo.hasExternalControl();
    const controllerRecoveryState = tractor.brain.state;
    tractor.dead = true;
    tractor.onDeath(game);
    cargo.update(1, game);
    const tractorSummary = {
      navigationMode: tractor.navigationMode,
      maxCargo: tractor.genome.modules.weapon.maxCargo,
      hasHorseshoe: Boolean(tractor.root.getObjectByName('generatedTractorHorseshoeMagnet')),
      claimed,
      telegraphState,
      beamVisibleDuringTelegraph,
      commitState,
      cargoLift,
      cargoRotation,
      throwStarted,
      targetReleasedByThrow,
      controllerRecoveryState,
      throwSurvivedController: tractorImpacts.length === 1 && !cargo.isExternalMotionActive(),
      landingNearPlayer: landingTarget
        ? landingTarget.distanceTo(game.player.root.position) < 2.4
        : false,
      impactRadius: tractorImpacts[0]?.radius ?? 0,
    };
    game.addExplosion = originalAddExplosion;
    dungeonController.getAerialNavigationDirection = originalControllerAerialNavigation;
    dungeonController.isPositionWalkable = originalWalkable;
    dungeonController.getSurfaceElevationAt = originalSurface;
    game.player.takeDamage = originalPlayerTakeDamage;
    clearEnemies();

    return { clawSummary, jawSummary, rotorSummary, flyerSummary, tractorSummary };
  });

  expect(result.clawSummary.attackKind).toBe('clawMoveset');
  expect(result.clawSummary.weakPointId).toBe('clawPalm');
  expect(result.clawSummary.defenseId).toBeNull();
  expect(result.clawSummary.hasSwingPivot).toBe(true);
  expect(result.clawSummary.hasElbowPivot).toBe(true);
  expect(result.clawSummary.massivePartCount).toBeGreaterThanOrEqual(4);
  expect(result.clawSummary.muzzleReach).toBeGreaterThan(2.2);
  expect(result.clawSummary.armor).toBeGreaterThan(20);

  expect(result.jawSummary.bodyPlan).toBe('quadruped');
  expect(result.jawSummary.shockwaveCount).toBe(3);
  expect(result.jawSummary.allShockwavesMeleeRange).toBe(true);
  expect(result.jawSummary.hopTravel).toBeGreaterThan(0.3);
  expect(result.jawSummary.heldOpenAngle).toBeGreaterThan(0.7);
  expect(result.jawSummary.blinkColor).toBe(0xff1010);
  expect(result.jawSummary.blinkIntensity).toBeGreaterThan(0.1);
  expect(result.jawSummary.massivePartCount).toBeGreaterThanOrEqual(3);
  expect(result.jawSummary.hasTwoHinges).toBe(true);
  expect(result.jawSummary.armor).toBeGreaterThan(25);
  expect(result.jawSummary.speed).toBeGreaterThan(3.5);

  expect(result.rotorSummary.contactHits).toBe(0);
  expect(result.rotorSummary.state).toBe('recovery');
  expect(result.rotorSummary.attackHitStayedIndependent).toBe(true);
  expect(result.rotorSummary.continuous).toBe(true);
  expect(result.rotorSummary.contactRadius).toBeGreaterThan(1.5);

  expect(result.flyerSummary.navigationMode).toBe('air');
  expect(result.flyerSummary.yTravel).toBeGreaterThan(0.1);
  expect(result.flyerSummary.aerialNavigationCalls).toBeGreaterThan(0);
  expect(result.flyerSummary.groundNavigationCalls).toBe(0);

  expect(result.tractorSummary.navigationMode).toBe('air');
  expect(result.tractorSummary.maxCargo).toBe(1);
  expect(result.tractorSummary.hasHorseshoe).toBe(true);
  expect(result.tractorSummary.claimed).toBe(true);
  expect(result.tractorSummary.telegraphState).toBe('telegraph');
  expect(result.tractorSummary.beamVisibleDuringTelegraph).toBe(true);
  expect(result.tractorSummary.commitState).toBe('commit');
  expect(result.tractorSummary.cargoLift).toBeGreaterThan(0.25);
  expect(result.tractorSummary.cargoRotation).toBeGreaterThan(0.5);
  expect(result.tractorSummary.throwStarted).toBe(true);
  expect(result.tractorSummary.targetReleasedByThrow).toBe(true);
  expect(result.tractorSummary.controllerRecoveryState).toBe('recovery');
  expect(result.tractorSummary.throwSurvivedController).toBe(true);
  expect(result.tractorSummary.landingNearPlayer).toBe(true);
  expect(result.tractorSummary.impactRadius).toBeGreaterThanOrEqual(1.5);
});

test('Tractor Controller hardening preserves viable squads, reachable cargo, and readable carries', async ({ page }) => {
  await page.goto('/?reaverbotSeed=tractor-hardening-runtime-proof');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(() => {
    const game = window.game;
    const Vector3 = game.player.root.position.constructor;
    game.stop();

    const clearEnemies = () => {
      for (const enemy of [...game.enemies]) {
        enemy.dispose?.();
        enemy.root.removeFromParent();
      }
      game.enemies.length = 0;
    };
    const findEnemy = (archetypeId, attackKind, position) => {
      for (let variant = 0; variant < 180; variant += 1) {
        const enemy = window.spawnReaverbot({
          archetypeId,
          seed: `runtime-hardening:${archetypeId}:${attackKind}:${variant}`,
          position,
        });
        if (enemy.genome.archetypeId === archetypeId
          && enemy.genome.modules.weapon.attackKind === attackKind) {
          return enemy;
        }
        const index = game.enemies.indexOf(enemy);
        if (index >= 0) game.enemies.splice(index, 1);
        enemy.dispose?.();
        enemy.root.removeFromParent();
      }
      throw new Error(`Could not generate ${archetypeId}/${attackKind}`);
    };

    clearEnemies();
    const playerBase = game.player.root.position.clone();
    const originalRunSeed = game.spawner.runSeed;
    game.spawner.runSeed = 17;
    const encounterEnemies = game.spawner.spawnEncounter({
      id: 'audit-two',
      label: 'Controller cap proof',
      roster: ['basic', 'ranged'],
      spawnPoints: [
        playerBase.clone().add(new Vector3(-1, 0, 5)),
        playerBase.clone().add(new Vector3(1, 0, 5)),
      ],
      zone: { position: playerBase.clone(), halfWidth: 8, halfDepth: 8 },
    });
    const encounterArchetypes = encounterEnemies.map((enemy) => enemy.genome?.archetypeId);
    const encounterControllerCount = encounterArchetypes
      .filter((archetypeId) => archetypeId === 'tractorController').length;
    game.spawner.runSeed = originalRunSeed;

    clearEnemies();
    const tractor = findEnemy(
      'tractorController',
      'tractorBeam',
      playerBase.clone().add(new Vector3(0, 1.8, 0)),
    );
    const blockedCargo = findEnemy(
      'pursuer',
      'charge',
      playerBase.clone().add(new Vector3(1, 0, 4)),
    );
    const reachableCargo = findEnemy(
      'pursuer',
      'charge',
      playerBase.clone().add(new Vector3(4, 0, 4)),
    );
    tractor.encounterId = 'hardening-encounter';
    blockedCargo.encounterId = 'hardening-encounter';
    reachableCargo.encounterId = 'hardening-encounter';

    const dungeonController = game.dungeonController;
    const originalAerialNavigation = dungeonController.getAerialNavigationDirection;
    const originalCargoLiftPath = tractor._isTractorCargoRootPathClear;
    const originalSurface = dungeonController.getSurfaceElevationAt;
    dungeonController.getAerialNavigationDirection = (from, target) => {
      if (Math.abs(target.x - blockedCargo.root.position.x) < 0.2) return null;
      const direction = target.clone().sub(from);
      return direction.lengthSq() > 0.0001 ? direction.normalize() : new Vector3(0, 0, 1);
    };
    // This section isolates selection/reselection logic; actual modular-bounds
    // lift and carry sweeps are covered by aerial-navigation.spec.js.
    tractor._isTractorCargoRootPathClear = (runtimeGame, target) => target === reachableCargo;
    const selectedReachableCargo = tractor._findTractorTarget(game);
    tractor.brain.state = 'position';
    tractor.brain.tractorTarget = blockedCargo;
    tractor.brain.cooldown = 99;
    tractor._updateTractorController(0.1, game);
    const reselectedCargo = tractor.brain.tractorTarget;
    tractor._isTractorCargoRootPathClear = originalCargoLiftPath;

    tractor.brain.tractorTarget = blockedCargo;
    tractor.brain.tractorCargoTopOffset = tractor._measureTractorCargoTopOffset(blockedCargo);
    tractor.root.position.y = tractor._getTractorControllerHeight(blockedCargo);
    tractor.root.updateMatrixWorld(true);
    tractor._setTractorBeamForTarget(blockedCargo, 1);
    tractor._animateVisual(0.08);
    const beamAxis = new Vector3(0, -1, 0)
      .applyQuaternion(tractor.visual.weapon.tractorBeam.quaternion)
      .normalize();
    const intendedBeamDirection = tractor.visual.weapon.tractorDirection.clone().normalize();
    const beamHorizontalAim = Math.hypot(intendedBeamDirection.x, intendedBeamDirection.z);
    const beamAimDot = beamAxis.dot(intendedBeamDirection);

    const carryAnchor = tractor._getTractorCarryAnchor(blockedCargo, new Vector3());
    blockedCargo.root.position.copy(carryAnchor);
    blockedCargo.root.updateMatrixWorld(true);
    tractor.root.updateMatrixWorld(true);
    const Box3 = tractor.visual.bounds.constructor;
    const cargoBounds = new Box3().setFromObject(blockedCargo.visual.root);
    const magnet = tractor.root.getObjectByName('generatedTractorHorseshoeMagnet');
    const magnetBounds = new Box3().setFromObject(magnet);
    const cargoMagnetClearance = magnetBounds.min.y - cargoBounds.max.y;
    const cargoFloorClearance = cargoBounds.min.y
      - dungeonController.getSurfaceElevationAt(blockedCargo.root.position);

    const releaseClaimPosition = reachableCargo.root.position.clone();
    tractor.brain.tractorTarget = reachableCargo;
    reachableCargo.tryClaimExternalControl(tractor, 'tractorBeam', {
      freeze: true,
      ignoreGroundConstraint: true,
    });
    const heldReleasePosition = playerBase.clone().add(new Vector3(0.65, 2.4, 0.7));
    reachableCargo.root.position.copy(heldReleasePosition);
    dungeonController.getSurfaceElevationAt = () => playerBase.y;
    tractor._releaseTractorTarget('controller-death', game);
    const dropTarget = reachableCargo.externalBallisticMotion?.targetPosition.clone() ?? null;
    const releaseDropDistance = dropTarget
      ? Math.hypot(
        dropTarget.x - heldReleasePosition.x,
        dropTarget.z - heldReleasePosition.z,
      )
      : Infinity;
    const releaseKeptCurrentXZ = Boolean(dropTarget)
      && releaseDropDistance < 0.001;
    const releaseStayedNearCurrent = Boolean(dropTarget) && releaseDropDistance <= 3.05;
    const releaseLandingWalkable = Boolean(dropTarget)
      && dungeonController.isPositionWalkable(dropTarget);
    const releaseAvoidedClaimOrigin = Boolean(dropTarget)
      && Math.hypot(
        dropTarget.x - releaseClaimPosition.x,
        dropTarget.z - releaseClaimPosition.z,
      ) > 1;
    reachableCargo.update(1, game);
    const releaseLandedAtSurface = Math.abs(reachableCargo.root.position.y - playerBase.y) < 0.001;

    const originalAddFireZone = game.addFireZone;
    let frozenEliteHazards = 0;
    game.addFireZone = () => {
      frozenEliteHazards += 1;
    };
    blockedCargo.affix = { id: 'burningCore', color: 0xff6f35 };
    blockedCargo.affixTimers.burn = 0;
    blockedCargo.tryClaimExternalControl(tractor, 'tractorBeam', {
      freeze: true,
      ignoreGroundConstraint: true,
    });
    blockedCargo.update(0.2, game);
    const eliteTimerStayedFrozen = blockedCargo.affixTimers.burn === 0;
    blockedCargo.releaseExternalControl(tractor, 'test-complete');
    game.addFireZone = originalAddFireZone;

    dungeonController.getAerialNavigationDirection = originalAerialNavigation;
    dungeonController.getSurfaceElevationAt = originalSurface;
    clearEnemies();

    return {
      encounterControllerCount,
      encounterArchetypes,
      selectedReachableCargo: selectedReachableCargo?.id === reachableCargo.id,
      reselectedCargo: reselectedCargo?.id === reachableCargo.id,
      beamHorizontalAim,
      beamAimDot,
      cargoMagnetClearance,
      cargoFloorClearance,
      releaseKeptCurrentXZ,
      releaseStayedNearCurrent,
      releaseDropDistance,
      releaseLandingWalkable,
      releaseAvoidedClaimOrigin,
      releaseLandedAtSurface,
      frozenEliteHazards,
      eliteTimerStayedFrozen,
    };
  });

  expect(result.encounterControllerCount).toBe(1);
  expect(result.encounterArchetypes).toContain('tractorController');
  expect(result.encounterArchetypes.some((id) => id !== 'tractorController')).toBe(true);
  expect(result.selectedReachableCargo).toBe(true);
  expect(result.reselectedCargo).toBe(true);
  expect(result.beamHorizontalAim).toBeGreaterThan(0.1);
  expect(result.beamAimDot).toBeGreaterThan(0.999);
  expect(result.cargoMagnetClearance).toBeGreaterThan(0.35);
  expect(result.cargoFloorClearance).toBeGreaterThan(0.25);
  expect(result.releaseDropDistance).toBeLessThanOrEqual(3.05);
  expect(result.releaseLandingWalkable).toBe(true);
  expect(result.releaseAvoidedClaimOrigin).toBe(true);
  expect(result.releaseLandedAtSurface).toBe(true);
  expect(result.frozenEliteHazards).toBe(0);
  expect(result.eliteTimerStayedFrozen).toBe(true);
});

test('jaw triple hops stay player-facing, bounded, and in shockwave range', async ({ page }) => {
  await page.goto('/?reaverbotSeed=jaw-hop-regression');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(() => {
    const game = window.game;
    const Vector3 = game.player.root.position.constructor;
    game.stop();

    for (const enemy of [...game.enemies]) {
      enemy.dispose?.();
      enemy.root.removeFromParent();
    }
    game.enemies.length = 0;

    const playerPosition = game.player.root.position.clone();
    const spawnPosition = playerPosition.clone().add(new Vector3(0, 0, 3.6));
    let jaw = null;
    for (let variant = 0; variant < 240; variant += 1) {
      const candidate = window.spawnReaverbot({
        archetypeId: 'pursuer',
        seed: `jaw-hop-regression:${variant}`,
        position: spawnPosition,
      });
      if (candidate.genome.modules.weapon.attackKind === 'jawCombo') {
        jaw = candidate;
        break;
      }
      game.enemies.splice(game.enemies.indexOf(candidate), 1);
      candidate.dispose?.();
      candidate.root.removeFromParent();
    }
    if (!jaw) throw new Error('Could not generate a jaw pursuer');

    jaw.root.position.copy(spawnPosition);
    jaw.root.rotation.y = Math.PI;
    jaw.brain.state = 'commit';
    jaw.brain.stateTime = 0;
    jaw.brain.attackDirection.set(0, 0, -1);
    jaw.brain.comboStrikesFired = 0;

    const dungeonController = game.dungeonController;
    const originalWalkable = dungeonController.isPositionWalkable;
    const originalSurface = dungeonController.getSurfaceElevationAt;
    const originalExplosion = game.addExplosion;
    const originalBurst = game.addParticleBurst;
    dungeonController.isPositionWalkable = () => true;
    dungeonController.getSurfaceElevationAt = () => playerPosition.y;

    const shockwaves = [];
    game.addExplosion = (position, damage, radius, color, meta = {}) => {
      if (meta.attackKind === 'jawBiteShockwave') {
        shockwaves.push({
          distanceToPlayer: position.distanceTo(game.player.root.position),
          radius,
          rootDistanceToPlayer: jaw.root.position.distanceTo(game.player.root.position),
        });
      }
    };
    game.addParticleBurst = () => {};

    const duration = jaw.genome.behavior.commitDuration;
    const perCycleTravel = [0, 0, 0];
    const startOffset = jaw.root.position.clone().sub(game.player.root.position).setY(0).normalize();
    for (let frame = 0; frame < 60 && jaw.brain.state === 'commit'; frame += 1) {
      const before = jaw.root.position.clone();
      const nextTime = Math.min(duration, jaw.brain.stateTime + 0.05);
      const cycle = Math.min(2, Math.floor((nextTime / duration) * 3));
      jaw._updateCommitState(0.05, game);
      jaw._animateVisual(0.05);
      perCycleTravel[cycle] += before.distanceTo(jaw.root.position);
    }

    const finalOffset = jaw.root.position.clone().sub(game.player.root.position).setY(0);
    const resultSummary = {
      shockwaves,
      perCycleTravel,
      configuredHopDistance: jaw.genome.modules.weapon.hopDistance,
      minimumSeparation: jaw.genome.modules.weapon.minimumHopSeparation ?? 0.82,
      startDistance: spawnPosition.distanceTo(playerPosition),
      finalDistance: finalOffset.length(),
      finalSignedSide: finalOffset.dot(startOffset),
    };

    game.addExplosion = originalExplosion;
    game.addParticleBurst = originalBurst;
    dungeonController.isPositionWalkable = originalWalkable;
    dungeonController.getSurfaceElevationAt = originalSurface;
    jaw.dispose?.();
    jaw.root.removeFromParent();
    game.enemies.length = 0;
    return resultSummary;
  });

  expect(result.shockwaves).toHaveLength(3);
  expect(result.shockwaves.every((wave) => wave.distanceToPlayer <= wave.radius + 0.001)).toBe(true);
  expect(result.finalDistance).toBeLessThan(result.startDistance);
  expect(result.finalSignedSide).toBeGreaterThanOrEqual(result.minimumSeparation - 0.05);
  expect(result.perCycleTravel.every((travel) => travel <= result.configuredHopDistance + 0.01)).toBe(true);
});

test('crusher jaw mouth contact and real snap shockwaves damage the player', async ({ page }) => {
  await page.goto('/?reaverbotSeed=jaw-damage-volume-regression');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(() => {
    const game = window.game;
    const player = game.player;
    const Vector3 = player.root.position.constructor;
    game.stop();

    const clearEnemies = () => {
      for (const enemy of [...game.enemies]) {
        enemy.dispose?.();
        enemy.root.removeFromParent();
      }
      game.enemies.length = 0;
    };
    const removeEnemy = (enemy) => {
      const index = game.enemies.indexOf(enemy);
      if (index >= 0) game.enemies.splice(index, 1);
      enemy.dispose?.();
      enemy.root.removeFromParent();
    };
    const spawnJaw = (seed, position) => {
      for (let variant = 0; variant < 320; variant += 1) {
        const enemy = window.spawnReaverbot({
          archetypeId: 'pursuer',
          seed: `${seed}:${variant}`,
          position,
        });
        if (enemy.genome.modules.weapon.attackKind === 'jawCombo') return enemy;
        removeEnemy(enemy);
      }
      throw new Error(`Could not generate jaw enemy for ${seed}`);
    };

    clearEnemies();
    const originalPlayerPosition = player.root.position.clone();
    const originalPlayerHealth = player.health;
    const originalPlayerDead = player.dead;
    const originalTakeIncomingHit = player.takeIncomingHit;
    const originalAddExplosion = game.addExplosion;
    const originalAddParticleBurst = game.addParticleBurst;
    const dungeonController = game.dungeonController;
    const originalWalkable = dungeonController.isPositionWalkable;
    const originalEnemyPositionClear = dungeonController.isEnemyPositionClear;
    const originalAerialPositionClear = dungeonController.isAerialPositionClear;
    const originalSurface = dungeonController.getSurfaceElevationAt;
    const originalSafeZone = dungeonController.isPlayerInSafeZone;
    const floorY = originalPlayerPosition.y;
    dungeonController.isPositionWalkable = () => true;
    dungeonController.isEnemyPositionClear = () => true;
    dungeonController.isAerialPositionClear = () => true;
    dungeonController.getSurfaceElevationAt = () => floorY;
    dungeonController.isPlayerInSafeZone = () => false;
    game.addParticleBurst = () => {};

    let activeJaw = null;
    let playerHits = [];
    const shockwaveCalls = [];
    player.takeIncomingHit = (incomingHit = {}) => {
      const hitResult = originalTakeIncomingHit.call(player, incomingHit);
      playerHits.push({
        attackKind: incomingHit.attackKind ?? null,
        sourceIsJaw: incomingHit.source === activeJaw,
        reactionTier: incomingHit.reactionTier ?? null,
        minimumReactionTier: incomingHit.minimumReactionTier ?? 0,
        knockbackStrength: incomingHit.knockbackStrength ?? null,
        contacted: hitResult.contacted,
        dodged: hitResult.dodged,
        immune: hitResult.immune,
        barrierDamage: hitResult.barrierDamage,
        healthDamage: hitResult.healthDamage,
      });
      return hitResult;
    };
    game.addExplosion = function addRecordedExplosion(position, damage, radius, color, meta = {}) {
      if (meta.attackKind === 'jawBiteShockwave') {
        shockwaveCalls.push({
          sourceIsJaw: meta.source === activeJaw,
          damage,
          radius,
          damagePlayer: meta.damagePlayer,
          targetGeometry: meta.targetGeometry ?? null,
          reactionTier: meta.reactionTier ?? null,
          knockbackStrength: meta.knockbackStrength ?? null,
        });
      }
      return originalAddExplosion.call(this, position, damage, radius, color, meta);
    };

    const resetPlayer = (position) => {
      player.clearExternalMotion?.('jaw-damage-volume-test-reset');
      player.root.position.copy(position);
      player.health = player.stats.maxHealth;
      player.dead = false;
      player.powerKnockbackState = null;
      player.powerKnockbackTimer = 0;
      player.powerKnockbackDuration = 0;
      player.powerKnockbackLandingCommitted = false;
      player.movementLockTimer = 0;
      player.guardTimer = 0;
      player.guardParryTimer = 0;
      player.animation.externalControlLocked = false;
      player.animation.hurtTimer = 0;
      player.barrier.current = 0;
      player.barrier.broken = player.barrier.capacity > 0;
      playerHits = [];
    };

    const mouthJaw = spawnJaw(
      'jaw-mouth-contact-regression',
      originalPlayerPosition.clone().add(new Vector3(0, 0, 3)),
    );
    activeJaw = mouthJaw;
    mouthJaw.root.rotation.y = Math.PI;
    mouthJaw.brain.state = 'position';
    mouthJaw.brain.stateTime = 0;
    mouthJaw.brain.contactCooldown = 0;
    mouthJaw.root.updateMatrixWorld(true);
    const mouthHinge = mouthJaw.visual.weapon.group.getWorldPosition(new Vector3());
    const mouthMuzzle = mouthJaw.visual.weapon.muzzle.getWorldPosition(new Vector3());
    const mouthPosition = mouthHinge.clone().lerp(mouthMuzzle, 0.62);
    mouthPosition.y = floorY;
    resetPlayer(mouthPosition);
    const bodyDistance = mouthJaw.root.position.clone().setY(0)
      .distanceTo(player.root.position.clone().setY(0));
    const bodyContactRadius = mouthJaw.radius + player.radius + 0.12;
    const insideMouth = mouthJaw._isPlayerInsideJawMouth(player);
    const mouthHealthBefore = player.health;
    mouthJaw._updatePersistentWeaponContact(0.016, game);
    const mouthContact = {
      insideMouth,
      bodyDistance,
      bodyContactRadius,
      hits: playerHits.map((hit) => ({ ...hit })),
      healthLoss: mouthHealthBefore - player.health,
      contactCooldown: mouthJaw.brain.contactCooldown,
      state: mouthJaw.brain.state,
      retreatStarted: Boolean(mouthJaw.contactRetreatMotion),
    };
    removeEnemy(mouthJaw);

    const waveJaw = spawnJaw(
      'jaw-shockwave-capsule-regression',
      originalPlayerPosition.clone().add(new Vector3(0, 0, 3)),
    );
    activeJaw = waveJaw;
    waveJaw.root.rotation.y = Math.PI;
    waveJaw.root.updateMatrixWorld(true);
    const waveHinge = waveJaw.visual.weapon.group.getWorldPosition(new Vector3());
    const waveMuzzle = waveJaw.visual.weapon.muzzle.getWorldPosition(new Vector3());
    const forward = waveMuzzle.clone().sub(waveHinge).setY(0).normalize();
    const lateral = new Vector3(-forward.z, 0, forward.x);
    const waveRadius = waveJaw.genome.modules.weapon.shockwaveRadius;
    const lateralWavePosition = waveMuzzle.clone().addScaledVector(lateral, 2.1);
    lateralWavePosition.y = floorY;
    resetPlayer(lateralWavePosition);
    const waveOrigin = new Vector3();
    waveJaw._getJawShockwaveOrigin(game, waveOrigin);
    const waveRootDistance = waveOrigin.distanceTo(player.root.position);
    const lateralInsideMouth = waveJaw._isPlayerInsideJawMouth(player);
    const waveHealthBefore = player.health;
    const waveCallStart = shockwaveCalls.length;
    waveJaw._performJawBite(game, 0);
    const lateralWave = {
      insideMouth: lateralInsideMouth,
      rootDistance: waveRootDistance,
      radius: waveRadius,
      calls: shockwaveCalls.slice(waveCallStart),
      hits: playerHits.map((hit) => ({ ...hit })),
      healthLoss: waveHealthBefore - player.health,
      visualCount: game.timedEffects.filter((effect) => effect.object?.name === 'explosionWave').length,
    };

    const outsidePosition = waveMuzzle.clone().addScaledVector(
      lateral,
      waveRadius + player.radius + 0.4,
    );
    outsidePosition.y = floorY;
    resetPlayer(outsidePosition);
    const outsideHealthBefore = player.health;
    waveJaw._performJawBite(game, 1);
    const outsideWave = {
      insideMouth: waveJaw._isPlayerInsideJawMouth(player),
      hits: playerHits.map((hit) => ({ ...hit })),
      healthLoss: outsideHealthBefore - player.health,
    };
    removeEnemy(waveJaw);

    const commitJaw = spawnJaw(
      'jaw-normal-commit-damage-regression',
      originalPlayerPosition.clone().add(new Vector3(0, 0, 3.6)),
    );
    activeJaw = commitJaw;
    resetPlayer(originalPlayerPosition);
    commitJaw.root.rotation.y = Math.PI;
    commitJaw.brain.state = 'commit';
    commitJaw.brain.stateTime = 0;
    commitJaw.brain.attackDirection.set(0, 0, -1);
    commitJaw.brain.comboStrikesFired = 0;
    commitJaw.brain.jawHopTravel.fill(0);
    const commitHealthBefore = player.health;
    const commitCallStart = shockwaveCalls.length;
    for (let frame = 0; frame < 120 && playerHits.length === 0; frame += 1) {
      commitJaw._updateCustomBehavior(0.02, game);
    }
    const normalCommit = {
      calls: shockwaveCalls.slice(commitCallStart),
      hits: playerHits.map((hit) => ({ ...hit })),
      healthLoss: commitHealthBefore - player.health,
      strikesFired: commitJaw.brain.comboStrikesFired,
    };
    removeEnemy(commitJaw);

    game._updateTimedEffects(1);
    const lingeringShockwaveVisuals = game.timedEffects.filter(
      (effect) => effect.object?.name === 'explosionWave',
    ).length;

    player.takeIncomingHit = originalTakeIncomingHit;
    game.addExplosion = originalAddExplosion;
    game.addParticleBurst = originalAddParticleBurst;
    dungeonController.isPositionWalkable = originalWalkable;
    dungeonController.isEnemyPositionClear = originalEnemyPositionClear;
    dungeonController.isAerialPositionClear = originalAerialPositionClear;
    dungeonController.getSurfaceElevationAt = originalSurface;
    dungeonController.isPlayerInSafeZone = originalSafeZone;
    player.clearExternalMotion?.('jaw-damage-volume-test-cleanup');
    player.root.position.copy(originalPlayerPosition);
    player.health = originalPlayerHealth;
    player.dead = originalPlayerDead;
    player.powerKnockbackState = null;
    player.animation.externalControlLocked = false;
    clearEnemies();

    return {
      mouthContact,
      lateralWave,
      outsideWave,
      normalCommit,
      lingeringShockwaveVisuals,
    };
  });

  expect(result.mouthContact.insideMouth).toBe(true);
  expect(result.mouthContact.bodyDistance).toBeGreaterThan(result.mouthContact.bodyContactRadius);
  expect(result.mouthContact.hits).toHaveLength(1);
  expect(result.mouthContact.hits[0]).toMatchObject({
    attackKind: 'jawMouthContact',
    sourceIsJaw: true,
    reactionTier: 3,
    contacted: true,
    dodged: false,
    immune: false,
  });
  expect(result.mouthContact.hits[0].barrierDamage + result.mouthContact.hits[0].healthDamage).toBeGreaterThan(0);
  expect(result.mouthContact.healthLoss).toBeGreaterThan(0);
  expect(result.mouthContact.contactCooldown).toBeGreaterThan(0.6);
  expect(result.mouthContact.state).toBe('position');
  expect(result.mouthContact.retreatStarted).toBe(false);

  expect(result.lateralWave.insideMouth).toBe(false);
  expect(result.lateralWave.rootDistance).toBeGreaterThan(result.lateralWave.radius);
  expect(result.lateralWave.calls).toHaveLength(1);
  expect(result.lateralWave.calls[0]).toMatchObject({
    sourceIsJaw: true,
    damagePlayer: true,
    targetGeometry: 'verticalCapsule',
    reactionTier: 3,
  });
  expect(result.lateralWave.hits).toHaveLength(1);
  expect(result.lateralWave.hits[0]).toMatchObject({
    attackKind: 'jawBiteShockwave',
    sourceIsJaw: true,
    reactionTier: 3,
    contacted: true,
    dodged: false,
    immune: false,
  });
  expect(result.lateralWave.hits[0].barrierDamage + result.lateralWave.hits[0].healthDamage).toBeGreaterThan(0);
  expect(result.lateralWave.healthLoss).toBeGreaterThan(0);
  expect(result.lateralWave.visualCount).toBeGreaterThan(0);

  expect(result.outsideWave.insideMouth).toBe(false);
  expect(result.outsideWave.hits).toHaveLength(0);
  expect(result.outsideWave.healthLoss).toBe(0);

  expect(result.normalCommit.calls.length).toBeGreaterThanOrEqual(1);
  expect(result.normalCommit.hits).toHaveLength(1);
  expect(result.normalCommit.hits[0]).toMatchObject({
    attackKind: 'jawBiteShockwave',
    sourceIsJaw: true,
    reactionTier: 3,
    contacted: true,
    dodged: false,
    immune: false,
  });
  expect(result.normalCommit.hits[0].barrierDamage + result.normalCommit.hits[0].healthDamage).toBeGreaterThan(0);
  expect(result.normalCommit.healthLoss).toBeGreaterThan(0);
  expect(result.normalCommit.strikesFired).toBeGreaterThanOrEqual(1);
  expect(result.lingeringShockwaveVisuals).toBe(0);
});

test('jaw AI holds its attack envelope and completes a natural three-snap lifecycle from mouth range', async ({ page }) => {
  await page.goto('/?reaverbotSeed=jaw-natural-lifecycle-regression');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(() => {
    const game = window.game;
    const player = game.player;
    const Vector3 = player.root.position.constructor;
    game.stop();

    const removeEnemy = (enemy) => {
      const index = game.enemies.indexOf(enemy);
      if (index >= 0) game.enemies.splice(index, 1);
      enemy.dispose?.();
      enemy.root.removeFromParent();
    };
    const clearEnemies = () => {
      for (const enemy of [...game.enemies]) removeEnemy(enemy);
      game.enemies.length = 0;
    };
    const spawnMatching = (archetypeId, attackKind, seed, position) => {
      for (let variant = 0; variant < 360; variant += 1) {
        const enemy = window.spawnReaverbot({
          archetypeId,
          seed: `${seed}:${variant}`,
          position,
        });
        if (enemy.genome.modules.weapon.attackKind === attackKind) return enemy;
        removeEnemy(enemy);
      }
      throw new Error(`Could not generate ${archetypeId}/${attackKind}`);
    };
    const resetAttackDirector = () => {
      const director = game.enemyAttackDirector;
      if (!director) return;
      director.owner = null;
      director.queue.length = 0;
      director.requestTimes.clear();
      director.handoffTimer = 0;
    };

    clearEnemies();
    resetAttackDirector();
    const originalPlayerPosition = player.root.position.clone();
    const originalPlayerHealth = player.health;
    const originalPlayerDead = player.dead;
    const originalTakeIncomingHit = player.takeIncomingHit;
    const originalAddExplosion = game.addExplosion;
    const originalAddParticleBurst = game.addParticleBurst;
    const originalAddHitEffect = game.addHitEffect;
    const originalRequestHitStop = game.requestHitStop;
    const dungeonController = game.dungeonController;
    const originalWalkable = dungeonController.isPositionWalkable;
    const originalEnemyPositionClear = dungeonController.isEnemyPositionClear;
    const originalAerialPositionClear = dungeonController.isAerialPositionClear;
    const originalSurface = dungeonController.getSurfaceElevationAt;
    const originalSafeZone = dungeonController.isPlayerInSafeZone;
    const floorY = originalPlayerPosition.y;

    dungeonController.isPositionWalkable = () => true;
    dungeonController.isEnemyPositionClear = () => true;
    dungeonController.isAerialPositionClear = () => true;
    dungeonController.getSurfaceElevationAt = () => floorY;
    dungeonController.isPlayerInSafeZone = () => false;
    game.addParticleBurst = () => {};
    game.addHitEffect = () => {};
    game.requestHitStop = () => {};
    player.dead = false;

    const incomingHits = [];
    player.takeIncomingHit = (incomingHit = {}) => {
      incomingHits.push({
        attackKind: incomingHit.attackKind ?? null,
        reactionTier: incomingHit.reactionTier ?? null,
        knockbackStrength: incomingHit.knockbackStrength ?? null,
        sourceId: incomingHit.source?.id ?? null,
      });
      return {
        contacted: true,
        dodged: false,
        immune: false,
        barrierDamage: 0,
        healthDamage: incomingHit.amount ?? 0,
        resolvedReactionTier: incomingHit.reactionTier ?? 0,
      };
    };

    // A jaw's locomotion policy still calls this an approach distance, but its
    // authored strike volume already reaches MegaMan. Cooldown must hold that
    // envelope, and the first ready frame must begin the telegraph in place.
    const approachJaw = spawnMatching(
      'pursuer',
      'jawCombo',
      'jaw-approach-envelope',
      originalPlayerPosition.clone(),
    );
    const approachThreshold = Math.max(
      2.65,
      approachJaw.genome.behavior.preferredRange + 0.35,
    );
    const attackEnvelopeLimit = approachJaw.stats.attackRange + 0.5;
    const approachDistance = Math.min(
      attackEnvelopeLimit - 0.08,
      Math.max(approachThreshold + 0.18, approachJaw.stats.attackRange + 0.1),
    );
    player.root.position.copy(originalPlayerPosition);
    approachJaw.root.position.copy(originalPlayerPosition).add(new Vector3(0, 0, approachDistance));
    // Start perpendicular to the attack lane so this scenario proves the AI
    // does not translate into mouth/body contact while turning to telegraph.
    approachJaw.root.rotation.y = 0;
    approachJaw.brain.state = 'position';
    approachJaw.brain.stateTime = 0;
    approachJaw.brain.cooldown = 0.5;
    approachJaw.brain.alerted = true;
    approachJaw.brain.contactCooldown = 0;
    const approachStart = approachJaw.root.position.clone();
    const hitsBeforeApproach = incomingHits.length;
    approachJaw.update(0.08, game);
    const coolingState = approachJaw.brain.state;
    const coolingTravel = approachJaw.root.position.distanceTo(approachStart);
    const coolingMoving = approachJaw.brain.moving;
    approachJaw.brain.cooldown = 0;
    approachJaw.update(0.016, game);
    const approachContract = {
      distance: approachDistance,
      approachThreshold,
      attackEnvelopeLimit,
      inAttackEnvelope: approachJaw._isAttackDistance(approachDistance),
      coolingState,
      coolingTravel,
      coolingMoving,
      readyState: approachJaw.brain.state,
      readyTravel: approachJaw.root.position.distanceTo(approachStart),
      readyMoving: approachJaw.brain.moving,
      ownsAttackLease: game.enemyAttackDirector.owner === approachJaw,
      incidentalContactHits: incomingHits.length - hitsBeforeApproach,
    };
    removeEnemy(approachJaw);
    resetAttackDirector();

    // Start the real controller in the visible mouth volume. A resolved mouth
    // hit may set its own repeat cooldown, but it must not replace the authored
    // position -> telegraph -> commit lifecycle with contact retreat/recovery.
    const mouthJaw = spawnMatching(
      'pursuer',
      'jawCombo',
      'jaw-mouth-natural-lifecycle',
      originalPlayerPosition.clone().add(new Vector3(0, 0, 3)),
    );
    mouthJaw.root.rotation.y = Math.PI;
    mouthJaw.root.updateMatrixWorld(true);
    const mouthHinge = mouthJaw.visual.weapon.group.getWorldPosition(new Vector3());
    const mouthMuzzle = mouthJaw.visual.weapon.muzzle.getWorldPosition(new Vector3());
    const mouthPosition = mouthHinge.clone().lerp(mouthMuzzle, 0.62);
    mouthPosition.y = floorY;
    player.root.position.copy(mouthPosition);
    mouthJaw.brain.state = 'position';
    mouthJaw.brain.stateTime = 0;
    mouthJaw.brain.cooldown = 0;
    mouthJaw.brain.alerted = true;
    mouthJaw.brain.attackFired = false;
    mouthJaw.brain.attackHit = false;
    mouthJaw.brain.comboStrikesFired = 0;
    mouthJaw.brain.jawHopTravel.fill(0);
    mouthJaw.brain.contactCooldown = 0;
    resetAttackDirector();

    const stateHistory = ['position'];
    const snapCalls = [];
    let contactRetreatStarted = false;
    let recoverySnapCount = null;
    game.addExplosion = (position, damage, radius, color, meta = {}) => {
      if (meta.attackKind === 'jawBiteShockwave' && meta.source === mouthJaw) {
        snapCalls.push({
          damage,
          radius,
          reactionTier: meta.reactionTier ?? null,
          knockbackStrength: meta.knockbackStrength ?? null,
          targetGeometry: meta.targetGeometry ?? null,
          damagePlayer: meta.damagePlayer,
        });
      }
      return true;
    };
    const mouthHitStart = incomingHits.length;
    const startsInsideMouth = mouthJaw._isPlayerInsideJawMouth(player);
    const startingAttackDistance = mouthJaw.root.position.clone().setY(0)
      .distanceTo(player.root.position.clone().setY(0));
    for (let frame = 0; frame < 280; frame += 1) {
      mouthJaw.update(0.02, game);
      contactRetreatStarted ||= Boolean(mouthJaw.contactRetreatMotion);
      if (stateHistory.at(-1) !== mouthJaw.brain.state) {
        stateHistory.push(mouthJaw.brain.state);
        if (mouthJaw.brain.state === 'recovery') recoverySnapCount = snapCalls.length;
      }
      if (mouthJaw.brain.state === 'recovery' && snapCalls.length === 3) break;
    }
    const mouthHits = incomingHits.slice(mouthHitStart)
      .filter((hit) => hit.attackKind === 'jawMouthContact');
    const lifecycle = {
      startsInsideMouth,
      startingAttackDistance,
      startsInAttackEnvelope: mouthJaw._isAttackDistance(startingAttackDistance),
      stateHistory,
      mouthHits,
      contactRetreatStarted,
      snapCalls,
      recoverySnapCount,
      strikesFired: mouthJaw.brain.comboStrikesFired,
      finalState: mouthJaw.brain.state,
      attackLeaseReleased: game.enemyAttackDirector.owner !== mouthJaw,
    };
    removeEnemy(mouthJaw);
    resetAttackDirector();

    // Direct charge and pounce contacts share the same authored heavy-reaction
    // contract as jaw snaps. Capture their production metadata without starting
    // MegaMan's long knockdown simulation in this controller-focused test.
    player.root.position.copy(originalPlayerPosition);
    const heavyHitStart = incomingHits.length;
    const charge = spawnMatching(
      'pursuer',
      'charge',
      'charge-tier-three-contract',
      originalPlayerPosition.clone().add(new Vector3(0, 0, 0.2)),
    );
    charge.brain.attackHit = false;
    charge._tryContactHit(game, 1);
    removeEnemy(charge);
    resetAttackDirector();
    const pounce = spawnMatching(
      'pouncer',
      'pounce',
      'pounce-tier-three-contract',
      originalPlayerPosition.clone().add(new Vector3(0, 0, 0.2)),
    );
    pounce.brain.attackHit = false;
    pounce._tryContactHit(game, 1);
    removeEnemy(pounce);
    const heavyHits = incomingHits.slice(heavyHitStart)
      .filter((hit) => hit.attackKind === 'charge' || hit.attackKind === 'pounce');

    player.takeIncomingHit = originalTakeIncomingHit;
    game.addExplosion = originalAddExplosion;
    game.addParticleBurst = originalAddParticleBurst;
    game.addHitEffect = originalAddHitEffect;
    game.requestHitStop = originalRequestHitStop;
    dungeonController.isPositionWalkable = originalWalkable;
    dungeonController.isEnemyPositionClear = originalEnemyPositionClear;
    dungeonController.isAerialPositionClear = originalAerialPositionClear;
    dungeonController.getSurfaceElevationAt = originalSurface;
    dungeonController.isPlayerInSafeZone = originalSafeZone;
    player.root.position.copy(originalPlayerPosition);
    player.health = originalPlayerHealth;
    player.dead = originalPlayerDead;
    resetAttackDirector();
    clearEnemies();

    return { approachContract, lifecycle, heavyHits };
  });

  expect(result.approachContract.distance).toBeGreaterThan(result.approachContract.approachThreshold);
  expect(result.approachContract.distance).toBeLessThan(result.approachContract.attackEnvelopeLimit);
  expect(result.approachContract.inAttackEnvelope).toBe(true);
  expect(result.approachContract.coolingState).toBe('position');
  expect(result.approachContract.coolingTravel).toBeLessThan(0.0001);
  expect(result.approachContract.coolingMoving).toBe(false);
  expect(result.approachContract.readyState).toBe('telegraph');
  expect(result.approachContract.readyTravel).toBeLessThan(0.0001);
  expect(result.approachContract.readyMoving).toBe(false);
  expect(result.approachContract.ownsAttackLease).toBe(true);
  expect(result.approachContract.incidentalContactHits).toBe(0);

  expect(result.lifecycle.startsInsideMouth).toBe(true);
  expect(result.lifecycle.startsInAttackEnvelope).toBe(true);
  expect(result.lifecycle.stateHistory).toEqual(['position', 'telegraph', 'commit', 'recovery']);
  expect(result.lifecycle.mouthHits.length).toBeGreaterThan(0);
  expect(result.lifecycle.mouthHits.every((hit) => hit.reactionTier === 3)).toBe(true);
  expect(result.lifecycle.contactRetreatStarted).toBe(false);
  expect(result.lifecycle.snapCalls).toHaveLength(3);
  expect(result.lifecycle.snapCalls.every((snap) => (
    snap.reactionTier === 3
    && snap.targetGeometry === 'verticalCapsule'
    && snap.damagePlayer === true
  ))).toBe(true);
  expect(result.lifecycle.snapCalls[2].knockbackStrength).toBeGreaterThan(
    result.lifecycle.snapCalls[0].knockbackStrength,
  );
  expect(result.lifecycle.recoverySnapCount).toBe(3);
  expect(result.lifecycle.strikesFired).toBe(3);
  expect(result.lifecycle.finalState).toBe('recovery');
  expect(result.lifecycle.attackLeaseReleased).toBe(true);

  expect(result.heavyHits).toHaveLength(2);
  expect(result.heavyHits.map((hit) => hit.attackKind).sort()).toEqual(['charge', 'pounce']);
  expect(result.heavyHits.every((hit) => hit.reactionTier === 3)).toBe(true);
});

test('jaw hinge overlap recovers before snapping and melee body contact forces knockback', async ({ page }) => {
  await page.goto('/?reaverbotSeed=jaw-hinge-overlap-regression');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(() => {
    const game = window.game;
    const Vector3 = game.player.root.position.constructor;
    game.stop();

    for (const enemy of [...game.enemies]) {
      enemy.dispose?.();
      enemy.root.removeFromParent();
    }
    game.enemies.length = 0;

    const playerPosition = game.player.root.position.clone();
    const overlapPosition = playerPosition.clone().add(new Vector3(0, 0, 0.08));
    let jaw = null;
    for (let variant = 0; variant < 320; variant += 1) {
      const candidate = window.spawnReaverbot({
        archetypeId: 'pursuer',
        seed: `jaw-hinge-overlap-regression:${variant}`,
        position: overlapPosition,
      });
      if (candidate.genome.modules.weapon.attackKind === 'jawCombo') {
        jaw = candidate;
        break;
      }
      game.enemies.splice(game.enemies.indexOf(candidate), 1);
      candidate.dispose?.();
      candidate.root.removeFromParent();
    }
    if (!jaw) throw new Error('Could not generate a jaw pursuer');

    const dungeonController = game.dungeonController;
    const originalWalkable = dungeonController.isPositionWalkable;
    const originalEnemyPositionClear = dungeonController.isEnemyPositionClear;
    const originalAerialPositionClear = dungeonController.isAerialPositionClear;
    const originalSurface = dungeonController.getSurfaceElevationAt;
    const originalSafeZone = dungeonController.isPlayerInSafeZone;
    const originalExplosion = game.addExplosion;
    const originalBurst = game.addParticleBurst;
    const originalHitEffect = game.addHitEffect;
    const originalHitStop = game.requestHitStop;
    const originalTakeIncomingHit = game.player.takeIncomingHit;
    const originalRequestEnemyAttack = game.requestEnemyAttack;
    const originalMoveSpeed = jaw.stats.moveSpeed;
    const originalAttackCooldown = jaw.stats.attackCooldown;
    const originalAiFloat = jaw.aiRandom.float;
    const safeLandingChecks = [];
    const isSafeDiagonalLanding = (position) => (
      position.x < overlapPosition.x - 0.55
      && position.z > overlapPosition.z + 1.25
      && Math.abs(position.y - playerPosition.y) < 0.001
    );
    dungeonController.isPositionWalkable = (position) => (
      position.distanceTo(overlapPosition) < 0.2 || isSafeDiagonalLanding(position)
    );
    dungeonController.isEnemyPositionClear = (_enemy, position) => {
      const accepted = isSafeDiagonalLanding(position);
      safeLandingChecks.push({
        position: position.clone(),
        accepted,
      });
      return accepted;
    };
    dungeonController.isAerialPositionClear = () => true;
    dungeonController.getSurfaceElevationAt = () => playerPosition.y;
    dungeonController.isPlayerInSafeZone = () => false;

    const damageAttempts = [];
    const successfulContacts = [];
    let rejectNextContact = true;
    let hitEffects = 0;
    game.player.takeIncomingHit = (incomingHit = {}) => {
      const { amount, source } = incomingHit;
      damageAttempts.push({
        amount,
        sourceIsJaw: source === jaw,
        attackKind: incomingHit.attackKind,
        reactionTier: incomingHit.reactionTier,
        guardable: incomingHit.guardable,
        knockbackStrength: incomingHit.knockbackStrength,
        knockbackDirection: incomingHit.knockbackDirection?.clone?.() ?? null,
      });
      if (rejectNextContact) {
        rejectNextContact = false;
        return {
          contacted: true,
          dodged: true,
          immune: false,
          healthDamage: 0,
        };
      }
      successfulContacts.push(incomingHit.attackKind);
      return {
        contacted: true,
        dodged: false,
        immune: false,
        healthDamage: amount,
      };
    };
    game.addHitEffect = () => { hitEffects += 1; };
    game.requestHitStop = () => {};
    game.addParticleBurst = () => {};

    jaw.root.position.copy(overlapPosition);
    jaw.root.rotation.y = Math.PI;
    jaw.brain.state = 'position';
    jaw.brain.stateTime = 0;
    jaw.brain.cooldown = 0;
    jaw.brain.attackDirection.set(0, 0, -1);
    jaw.brain.contactCooldown = 0;
    game.enemyAttackDirector.owner = jaw;
    game.enemyAttackDirector.handoffTimer = 0;

    // The first rejected hit models dodge-roll invulnerability: it must not
    // consume the contact cooldown or emit impact feedback. The next frame can
    // then apply the real body hit, and the cooldown suppresses a duplicate.
    const rejectedContactStart = jaw.root.position.clone();
    jaw._updatePersistentWeaponContact(0.016, game);
    const cooldownAfterRejectedContact = jaw.brain.contactCooldown;
    const hitEffectsAfterRejectedContact = hitEffects;
    const motionAfterRejectedContact = Boolean(jaw.contactRetreatMotion);
    const stateAfterRejectedContact = jaw.brain.state;
    const travelAfterRejectedContact = jaw.root.position.distanceTo(rejectedContactStart);
    const directorRetainedAfterRejectedContact = game.enemyAttackDirector.owner === jaw;
    jaw._updatePersistentWeaponContact(0.016, game);
    const cooldownAfterSuccessfulContact = jaw.brain.contactCooldown;
    const stateAfterSuccessfulContact = jaw.brain.state;
    const successfulRetreatStart = jaw.contactRetreatMotion?.startPosition.clone() ?? null;
    const successfulRetreatTarget = jaw.contactRetreatMotion?.targetPosition.clone() ?? null;
    const successfulRetreatDuration = jaw.contactRetreatMotion?.duration ?? 0;
    const directorReleasedAfterSuccessfulContact = game.enemyAttackDirector.owner !== jaw;
    jaw._updatePersistentWeaponContact(0.016, game);
    const attemptsAfterImmediateRepeat = damageAttempts.length;

    const awayFromPlayer = overlapPosition.clone().sub(playerPosition).setY(0).normalize();
    const retreatDisplacement = successfulRetreatStart && successfulRetreatTarget
      ? successfulRetreatTarget.clone().sub(successfulRetreatStart).setY(0)
      : new Vector3();
    const retreatBackwardDot = retreatDisplacement.lengthSq() > 0.0001
      ? retreatDisplacement.clone().normalize().dot(awayFromPlayer)
      : 0;
    const retreatLateralTravel = Math.abs(retreatDisplacement.x);
    const rejectedStraightLandingCount = safeLandingChecks.filter((check) => (
      !check.accepted
      && Math.abs(check.position.x - overlapPosition.x) < 0.05
    )).length;
    const retreatTargetWasClear = Boolean(
      successfulRetreatTarget && isSafeDiagonalLanding(successfulRetreatTarget),
    );
    const retreatTargetWasWalkable = Boolean(
      successfulRetreatTarget && dungeonController.isPositionWalkable(successfulRetreatTarget),
    );

    let maximumRetreatY = jaw.root.position.y;
    let retreatElapsed = 0;
    for (let frame = 0; frame < 80 && jaw.contactRetreatMotion; frame += 1) {
      const step = Math.min(0.02, jaw.contactRetreatMotion.duration - jaw.contactRetreatMotion.elapsed);
      jaw.update(Math.max(0.001, step), game);
      retreatElapsed += Math.max(0.001, step);
      maximumRetreatY = Math.max(maximumRetreatY, jaw.root.position.y);
    }
    const retreatFinished = !jaw.contactRetreatMotion;
    const retreatLandingError = successfulRetreatTarget
      ? jaw.root.position.distanceTo(successfulRetreatTarget)
      : Infinity;
    const retreatLandingGroundError = Math.abs(jaw.root.position.y - playerPosition.y);

    // Recovery owns a complete no-attack window after the visible leap. Make
    // its randomized cooldown deterministic, hold the fixture in range, and
    // observe the first subsequent attack request instead of relying only on
    // internal timer values.
    jaw.stats.moveSpeed = 0;
    jaw.stats.attackCooldown = 0.6;
    jaw.aiRandom.float = () => 1;
    const attackRequestTimes = [];
    let timeAfterLanding = 0;
    game.requestEnemyAttack = (enemy) => {
      if (enemy === jaw) attackRequestTimes.push(timeAfterLanding);
      return false;
    };
    const recoveryDuration = jaw._getStateDuration('recovery');
    for (let frame = 0; frame < 160 && jaw.brain.state === 'recovery'; frame += 1) {
      jaw.update(0.02, game);
      timeAfterLanding += 0.02;
    }
    const attackRequestsDuringRecovery = attackRequestTimes.length;
    const recoveryElapsed = timeAfterLanding;
    const stateAfterRecovery = jaw.brain.state;
    const cooldownAfterRecovery = jaw.brain.cooldown;
    const cooldownObservationStart = timeAfterLanding;
    const protectedCooldownWindow = Math.max(0, cooldownAfterRecovery * 0.72);
    while (timeAfterLanding < cooldownObservationStart + protectedCooldownWindow) {
      jaw.update(0.02, game);
      timeAfterLanding += 0.02;
    }
    const attackRequestsBeforeCooldown = attackRequestTimes.length;
    for (let frame = 0; frame < 100 && attackRequestTimes.length === 0; frame += 1) {
      jaw.update(0.02, game);
      timeAfterLanding += 0.02;
    }
    const firstAttackRequestAfterLanding = attackRequestTimes[0] ?? null;
    const firstAttackRequestAfterRecovery = firstAttackRequestAfterLanding == null
      ? null
      : firstAttackRequestAfterLanding - recoveryElapsed;
    game.requestEnemyAttack = originalRequestEnemyAttack;
    jaw.stats.moveSpeed = originalMoveSpeed;
    jaw.stats.attackCooldown = originalAttackCooldown;
    jaw.aiRandom.float = originalAiFloat;

    // The remaining assertions exercise the jaw's independent authored combo.
    // Return it to the original overlap only after the retreat has physically
    // landed and the post-contact recovery/cooldown proof is complete.
    dungeonController.isPositionWalkable = () => true;
    dungeonController.isEnemyPositionClear = originalEnemyPositionClear;
    jaw.root.position.copy(overlapPosition);
    jaw.brain.state = 'commit';
    jaw.brain.contactCooldown = 0;
    jaw._updatePersistentWeaponContact(0.016, game);
    const attemptsDuringCommit = damageAttempts.length;

    let radiusAwareRecoverySamples = 0;
    dungeonController.isEnemyPositionClear = () => {
      radiusAwareRecoverySamples += 1;
      return false;
    };
    const blockedRecoveryStart = jaw.root.position.clone();
    const blockedRecoveryMoved = jaw._moveJawAlongClearPath(
      game,
      jaw.root.position.x + 0.18,
      jaw.root.position.z,
      jaw.root.position.y,
    );
    const blockedRecoveryTravel = jaw.root.position.distanceTo(blockedRecoveryStart);
    dungeonController.isEnemyPositionClear = originalEnemyPositionClear;
    jaw.root.position.copy(overlapPosition);

    const minimumSeparation = jaw._getJawMinimumRootSeparation(game);
    const initialDistance = jaw.root.position.distanceTo(playerPosition);
    const shockwaves = [];
    game.addExplosion = (position, damage, radius, color, meta = {}) => {
      if (meta.attackKind === 'jawBiteShockwave') {
        shockwaves.push({
          distanceToPlayer: position.distanceTo(game.player.root.position),
          radius,
          rootDistanceToPlayer: jaw.root.position.distanceTo(game.player.root.position),
        });
      }
    };

    jaw.brain.state = 'commit';
    jaw.brain.stateTime = 0;
    jaw.brain.comboStrikesFired = 0;
    jaw.brain.jawHopTravel.fill(0);
    const duration = jaw.genome.behavior.commitDuration;
    for (let frame = 0; frame < 100 && jaw.brain.state === 'commit'; frame += 1) {
      jaw._updateCustomBehavior(Math.min(0.035, duration - jaw.brain.stateTime), game);
    }

    const resultSummary = {
      damageAttempts: damageAttempts.map((attempt) => ({
        ...attempt,
        knockbackDirectionLength: attempt.knockbackDirection?.length?.() ?? 0,
      })),
      successfulContacts,
      cooldownAfterRejectedContact,
      cooldownAfterSuccessfulContact,
      hitEffectsAfterRejectedContact,
      motionAfterRejectedContact,
      stateAfterRejectedContact,
      travelAfterRejectedContact,
      directorRetainedAfterRejectedContact,
      stateAfterSuccessfulContact,
      directorReleasedAfterSuccessfulContact,
      attemptsAfterImmediateRepeat,
      attemptsDuringCommit,
      rejectedStraightLandingCount,
      retreatBackwardDot,
      retreatLateralTravel,
      retreatTargetWasClear,
      retreatTargetWasWalkable,
      successfulRetreatDuration,
      retreatElapsed,
      maximumRetreatRise: maximumRetreatY - Math.max(
        successfulRetreatStart?.y ?? playerPosition.y,
        successfulRetreatTarget?.y ?? playerPosition.y,
      ),
      retreatFinished,
      retreatLandingError,
      retreatLandingGroundError,
      recoveryDuration,
      recoveryElapsed,
      stateAfterRecovery,
      cooldownAfterRecovery,
      attackRequestsDuringRecovery,
      attackRequestsBeforeCooldown,
      firstAttackRequestAfterLanding,
      firstAttackRequestAfterRecovery,
      hitEffects,
      radiusAwareRecoverySamples,
      blockedRecoveryMoved,
      blockedRecoveryTravel,
      initialDistance,
      minimumSeparation,
      shockwaves,
      finalDistance: jaw.root.position.distanceTo(playerPosition),
    };

    game.player.takeIncomingHit = originalTakeIncomingHit;
    game.addExplosion = originalExplosion;
    game.addParticleBurst = originalBurst;
    game.addHitEffect = originalHitEffect;
    game.requestHitStop = originalHitStop;
    game.requestEnemyAttack = originalRequestEnemyAttack;
    jaw.stats.moveSpeed = originalMoveSpeed;
    jaw.stats.attackCooldown = originalAttackCooldown;
    jaw.aiRandom.float = originalAiFloat;
    dungeonController.isPositionWalkable = originalWalkable;
    dungeonController.isEnemyPositionClear = originalEnemyPositionClear;
    dungeonController.isAerialPositionClear = originalAerialPositionClear;
    dungeonController.getSurfaceElevationAt = originalSurface;
    dungeonController.isPlayerInSafeZone = originalSafeZone;
    jaw.dispose?.();
    jaw.root.removeFromParent();
    game.enemies.length = 0;
    return resultSummary;
  });

  expect(result.initialDistance).toBeLessThan(result.minimumSeparation);
  expect(result.cooldownAfterRejectedContact).toBe(0);
  expect(result.hitEffectsAfterRejectedContact).toBe(0);
  expect(result.motionAfterRejectedContact).toBe(false);
  expect(result.stateAfterRejectedContact).toBe('position');
  expect(result.travelAfterRejectedContact).toBeLessThan(0.000001);
  expect(result.directorRetainedAfterRejectedContact).toBe(true);
  expect(result.cooldownAfterSuccessfulContact).toBeGreaterThan(0.6);
  expect(result.stateAfterSuccessfulContact).toBe('recovery');
  expect(result.directorReleasedAfterSuccessfulContact).toBe(true);
  expect(result.attemptsAfterImmediateRepeat).toBe(2);
  expect(result.attemptsDuringCommit).toBe(2);
  expect(result.rejectedStraightLandingCount).toBeGreaterThan(0);
  expect(result.retreatBackwardDot).toBeGreaterThan(0.9);
  expect(result.retreatLateralTravel).toBeGreaterThan(0.55);
  expect(result.retreatTargetWasClear).toBe(true);
  expect(result.retreatTargetWasWalkable).toBe(true);
  expect(result.successfulRetreatDuration).toBeGreaterThan(0.3);
  expect(result.retreatElapsed).toBeGreaterThanOrEqual(result.successfulRetreatDuration - 0.001);
  expect(result.maximumRetreatRise).toBeGreaterThan(0.75);
  expect(result.retreatFinished).toBe(true);
  expect(result.retreatLandingError).toBeLessThan(0.000001);
  expect(result.retreatLandingGroundError).toBeLessThan(0.000001);
  expect(result.recoveryElapsed).toBeGreaterThanOrEqual(result.recoveryDuration - 0.02);
  expect(result.stateAfterRecovery).toBe('position');
  expect(result.cooldownAfterRecovery).toBeCloseTo(0.6, 5);
  expect(result.attackRequestsDuringRecovery).toBe(0);
  expect(result.attackRequestsBeforeCooldown).toBe(0);
  expect(result.firstAttackRequestAfterLanding).not.toBeNull();
  expect(result.firstAttackRequestAfterRecovery).toBeGreaterThanOrEqual(
    result.cooldownAfterRecovery - 0.03,
  );
  expect(result.radiusAwareRecoverySamples).toBeGreaterThan(0);
  expect(result.blockedRecoveryMoved).toBe(false);
  expect(result.blockedRecoveryTravel).toBeLessThan(0.001);
  expect(result.successfulContacts).toEqual(['meleeBodyContact']);
  expect(result.damageAttempts[1]).toMatchObject({
    sourceIsJaw: true,
    attackKind: 'meleeBodyContact',
    reactionTier: 2,
    guardable: false,
  });
  expect(result.damageAttempts[1].knockbackStrength).toBeGreaterThanOrEqual(0.85);
  expect(result.damageAttempts[1].knockbackDirectionLength).toBeGreaterThan(0.99);
  expect(result.shockwaves).toHaveLength(3);
  expect(result.shockwaves.every((wave) => wave.distanceToPlayer <= wave.radius + 0.001)).toBe(true);
  expect(result.shockwaves[0].rootDistanceToPlayer).toBeGreaterThanOrEqual(result.minimumSeparation - 0.08);
  expect(result.finalDistance).toBeGreaterThanOrEqual(result.minimumSeparation - 0.08);
});

test('Tractor Controllers evade, break interrupted abductions, crash and relaunch while coil legs truly bounce', async ({ page }) => {
  await page.goto('/?reaverbotSeed=controller-crash-coil-bounce-proof');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(() => {
    const game = window.game;
    const Vector3 = game.player.root.position.constructor;
    game.stop();

    const clearEnemies = () => {
      for (const enemy of [...game.enemies]) {
        enemy.dispose?.();
        enemy.root.removeFromParent();
      }
      game.enemies.length = 0;
    };
    const findEnemy = (archetypeId, predicate, position) => {
      for (let variant = 0; variant < 240; variant += 1) {
        const enemy = window.spawnReaverbot({
          archetypeId,
          seed: `controller-crash-coil:${archetypeId}:${variant}`,
          position,
        });
        if (enemy.genome.archetypeId === archetypeId && predicate(enemy)) return enemy;
        game.enemies.splice(game.enemies.indexOf(enemy), 1);
        enemy.dispose?.();
        enemy.root.removeFromParent();
      }
      throw new Error(`Could not generate ${archetypeId}`);
    };

    clearEnemies();
    const dungeon = game.dungeonController;
    const playerStart = game.player.root.position.clone();
    const originalAerialNavigation = dungeon.getAerialNavigationDirection;
    const originalAerialPathClear = dungeon.isAerialPathClear;
    const originalSurface = dungeon.getSurfaceElevationAt;
    const originalWalkable = dungeon.isPositionWalkable;
    dungeon.getAerialNavigationDirection = (from, target) => {
      const direction = target.clone().sub(from);
      return direction.lengthSq() > 0.0001 ? direction.normalize() : new Vector3(0, 0, 1);
    };
    dungeon.isAerialPathClear = () => true;
    dungeon.getSurfaceElevationAt = () => playerStart.y;
    dungeon.isPositionWalkable = () => true;

    const cargo = findEnemy(
      'pursuer',
      (enemy) => enemy.genome.modules.weapon.attackKind === 'clawMoveset',
      playerStart.clone().add(new Vector3(0, 0, 11.2)),
    );
    const tractor = findEnemy(
      'tractorController',
      (enemy) => enemy.genome.modules.weapon.attackKind === 'tractorBeam',
      playerStart.clone().add(new Vector3(0, 2.2, 2.1)),
    );
    tractor.encounterId = 'controller-speed-proof';
    cargo.encounterId = 'controller-speed-proof';
    tractor._runtimeGame = game;
    const originalCargoPathCheck = tractor._isTractorCargoRootPathClear;
    tractor._isTractorCargoRootPathClear = () => true;

    const acquiredAtLongRange = tractor._findTractorTarget(game) === cargo;
    const fastStart = tractor.root.position.clone();
    const awayFromPlayer = fastStart.clone().sub(game.player.root.position).setY(0).normalize();
    tractor._moveTractorAboveTarget(0.25, game, cargo, 3.15);
    const fastDelta = tractor.root.position.clone().sub(fastStart);
    const fastTravel = fastDelta.length();
    const movedAwayFromPlayer = fastDelta.clone().setY(0).dot(awayFromPlayer) > 0;

    tractor.brain.state = 'position';
    tractor.brain.tractorTarget = null;
    const pauseStart = tractor.root.position.clone();
    game.damageEnemy(tractor, 2, {
      source: game.player,
      directHit: true,
      unblockable: true,
      armorPierce: 999,
    });
    const pauseBeforeTick = tractor.brain.controllerTagPause;
    tractor._updateTractorController(0.1, game);
    const pausedTravel = tractor.root.position.distanceTo(pauseStart);
    const pauseAfterTick = tractor.brain.controllerTagPause;

    tractor.brain.controllerTagPause = 0;
    tractor.brain.state = 'commit';
    tractor.brain.tractorTarget = cargo;
    tractor.brain.tractorCargoTopOffset = tractor._measureTractorCargoTopOffset(cargo);
    cargo.tryClaimExternalControl(tractor, 'tractorBeam', {
      freeze: true,
      ignoreGroundConstraint: true,
    });
    cargo.root.position.copy(tractor._getTractorCarryAnchor(cargo, new Vector3()));
    const originalReleaseLanding = tractor._findTractorReleaseLanding;
    tractor._findTractorReleaseLanding = (runtimeGame, target) => ({
      position: new Vector3(target.root.position.x, playerStart.y, target.root.position.z),
      arcHeight: 0,
    });
    const cargoHealthBefore = cargo.health;
    const tractorHealthBefore = tractor.health;
    game.damageEnemy(tractor, 3, {
      source: game.player,
      projectileHit: true,
      directHit: true,
      unblockable: true,
      armorPierce: 999,
    });
    const cargoDamage = cargoHealthBefore - cargo.health;
    const tractorDamage = tractorHealthBefore - tractor.health;
    const droppedImmediately = !cargo.hasExternalControl(tractor)
      && Boolean(cargo.externalBallisticMotion || cargo.dead);
    const crashPhaseAfterHit = tractor.brain.tractorCrashPhase;

    tractor.hitStopTimer = 0;
    tractor._updateTractorController(0.54, game);
    const groundedPhase = tractor.brain.tractorCrashPhase;
    const groundedY = tractor.root.position.y;
    const laidFlatRotation = Math.abs(tractor.root.rotation.z);
    tractor._updateTractorController(1.36, game);
    const relaunchPhase = tractor.brain.tractorCrashPhase;
    tractor._updateTractorController(0.64, game);
    const relaunched = tractor.brain.tractorCrashPhase === null
      && tractor.brain.state === 'position';
    const relaunchHeight = tractor.root.position.y - groundedY;

    tractor._findTractorReleaseLanding = originalReleaseLanding;
    tractor._isTractorCargoRootPathClear = originalCargoPathCheck;
    clearEnemies();

    const originalEnemyNavigation = dungeon.getEnemyNavigationDirection;
    const originalEnemyClear = dungeon.isEnemyPositionClear;
    const originalAerialClear = dungeon.isAerialPositionClear;
    game.player.root.position.set(playerStart.x + 4, playerStart.y + 2.4, playerStart.z);
    dungeon.getEnemyNavigationDirection = (enemy, target) => {
      const direction = target.clone().sub(enemy.root.position).setY(0);
      return direction.lengthSq() > 0.0001 ? direction.normalize() : null;
    };
    dungeon.getSurfaceElevationAt = (position) => (
      position.x >= playerStart.x + 1 ? playerStart.y + 2.4 : playerStart.y
    );
    dungeon.isEnemyPositionClear = () => true;
    dungeon.isAerialPositionClear = () => true;

    const hopper = findEnemy(
      'pouncer',
      (enemy) => enemy.genome.body.planId === 'hopper'
        && enemy.genome.modules.weapon.attackKind === 'pounce',
      new Vector3(playerStart.x, playerStart.y, playerStart.z),
    );
    const bounceStart = hopper.root.position.clone();
    const toPlatform = new Vector3(1, 0, 0);
    const bounceStarted = hopper._moveByMode('approach', 0.016, game, toPlatform, 4);
    const noInitialSlide = hopper.root.position.distanceTo(bounceStart) < 0.0001;
    const ignoresGroundWhileAirborne = hopper.shouldIgnoreGroundConstraint();
    const bounceDuration = hopper.brain.coilBounceDuration;
    hopper._moveByMode('approach', bounceDuration * 0.5, game, toPlatform, 4);
    const apexHeight = hopper.root.position.y - bounceStart.y;
    const horizontalAtApex = Math.hypot(
      hopper.root.position.x - bounceStart.x,
      hopper.root.position.z - bounceStart.z,
    );
    hopper._moveByMode('approach', bounceDuration * 0.5 + 0.02, game, toPlatform, 4);
    const landing = hopper.root.position.clone();
    const landedOnHighPlatform = Math.abs(landing.y - (playerStart.y + 2.4)) < 0.001;
    const landingTravel = Math.hypot(landing.x - bounceStart.x, landing.z - bounceStart.z);
    const cooldownStart = hopper.root.position.clone();
    const cooldownMoved = hopper._moveByMode('approach', 0.05, game, toPlatform, 4);
    const noCooldownSlide = !cooldownMoved && hopper.root.position.distanceTo(cooldownStart) < 0.0001;
    hopper.brain.state = 'commit';
    hopper.brain.stateTime = 0;
    hopper.brain.commitStart.copy(hopper.root.position);
    hopper.brain.targetPosition.copy(hopper.root.position).add(new Vector3(2, 0, 0));
    hopper.brain.attackFired = false;
    const pounceBaseY = hopper.root.position.y;
    hopper._updateCommitState(hopper.genome.behavior.commitDuration * 0.5, game);
    const pounceRise = hopper.root.position.y - pounceBaseY;
    const pounceIgnoresGroundConstraint = hopper.shouldIgnoreGroundConstraint();

    dungeon.getAerialNavigationDirection = originalAerialNavigation;
    dungeon.isAerialPathClear = originalAerialPathClear;
    dungeon.getEnemyNavigationDirection = originalEnemyNavigation;
    dungeon.isEnemyPositionClear = originalEnemyClear;
    dungeon.isAerialPositionClear = originalAerialClear;
    dungeon.getSurfaceElevationAt = originalSurface;
    dungeon.isPositionWalkable = originalWalkable;
    game.player.root.position.copy(playerStart);
    clearEnemies();

    return {
      acquiredAtLongRange,
      fastTravel,
      movedAwayFromPlayer,
      pauseBeforeTick,
      pauseAfterTick,
      pausedTravel,
      cargoDamage,
      cargoMaximumHealth: cargo.stats.maxHealth,
      tractorDamage,
      tractorMaximumHealth: tractor.stats.maxHealth,
      droppedImmediately,
      crashPhaseAfterHit,
      groundedPhase,
      laidFlatRotation,
      relaunchPhase,
      relaunched,
      relaunchHeight,
      bounceStarted,
      noInitialSlide,
      ignoresGroundWhileAirborne,
      apexHeight,
      horizontalAtApex,
      landedOnHighPlatform,
      landingTravel,
      noCooldownSlide,
      pounceRise,
      pounceIgnoresGroundConstraint,
    };
  });

  expect(result.acquiredAtLongRange).toBe(true);
  expect(result.fastTravel).toBeGreaterThan(1.2);
  expect(result.movedAwayFromPlayer).toBe(true);
  expect(result.pauseBeforeTick).toBeGreaterThanOrEqual(0.2);
  expect(result.pauseAfterTick).toBeGreaterThan(0);
  expect(result.pausedTravel).toBeLessThan(0.0001);
  expect(result.cargoDamage).toBeGreaterThanOrEqual(result.cargoMaximumHealth * 0.4);
  expect(result.tractorDamage).toBeGreaterThanOrEqual(result.tractorMaximumHealth * 0.4);
  expect(result.droppedImmediately).toBe(true);
  expect(result.crashPhaseAfterHit).toBe('falling');
  expect(result.groundedPhase).toBe('grounded');
  expect(result.laidFlatRotation).toBeGreaterThan(1.5);
  expect(result.relaunchPhase).toBe('relaunching');
  expect(result.relaunched).toBe(true);
  expect(result.relaunchHeight).toBeGreaterThan(1.8);
  expect(result.bounceStarted).toBe(true);
  expect(result.noInitialSlide).toBe(true);
  expect(result.ignoresGroundWhileAirborne).toBe(true);
  expect(result.apexHeight).toBeGreaterThan(3);
  expect(result.horizontalAtApex).toBeGreaterThan(0.7);
  expect(result.landedOnHighPlatform).toBe(true);
  expect(result.landingTravel).toBeGreaterThan(1.5);
  expect(result.noCooldownSlide).toBe(true);
  expect(result.pounceRise).toBeGreaterThan(2.3);
  expect(result.pounceIgnoresGroundConstraint).toBe(true);
});

test('articulated claw carriers drag into MegaMan\'s lane and vault low obstacles', async ({ page }) => {
  await page.goto('/?reaverbotSeed=constructor-claw-drag-vault-proof');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(() => {
    const game = window.game;
    const Vector3 = game.player.root.position.constructor;
    game.stop();

    for (const enemy of [...game.enemies]) {
      enemy.dispose?.();
      enemy.root.removeFromParent();
    }
    game.enemies.length = 0;

    let claw = null;
    for (let variant = 0; variant < 260; variant += 1) {
      const candidate = window.spawnReaverbot({
        archetypeId: 'duelist',
        seed: `constructor-drag-vault:${variant}`,
        position: game.player.root.position,
      });
      if (candidate.genome.modules.weapon.attackKind === 'clawMoveset') {
        claw = candidate;
        break;
      }
      game.enemies.splice(game.enemies.indexOf(candidate), 1);
      candidate.dispose?.();
      candidate.root.removeFromParent();
    }
    if (!claw) throw new Error('Could not generate an articulated claw carrier');

    const dungeon = game.dungeonController;
    const originalSurface = dungeon.getSurfaceElevationAt;
    const originalEnemyClear = dungeon.isEnemyPositionClear;
    const originalAerialClear = dungeon.isAerialPositionClear;
    const originalArenaTarget = dungeon.getEnemyArenaTarget;
    const originalParticles = game.addParticleBurst;
    const base = game.player.root.position.clone();
    claw.root.position.copy(base);
    claw.root.rotation.set(0, 0, 0);
    game.player.root.position.copy(base).add(new Vector3(0, 0, 5));
    claw.brain.state = 'commit';
    claw.brain.attackDirection.set(0, 0, 1);
    claw._runtimeGame = game;

    dungeon.getSurfaceElevationAt = () => base.y;
    dungeon.getEnemyArenaTarget = (enemy, target, out = new Vector3()) => out.copy(target);
    dungeon.isAerialPositionClear = () => true;
    dungeon.isEnemyPositionClear = () => true;
    game.addParticleBurst = () => {};

    const dragStart = claw.root.position.clone();
    const dragMoved = claw._updateClawDragAndVault(0.18, game, 0.12);
    const dragTravel = claw.root.position.distanceTo(dragStart);

    claw.root.position.copy(base);
    claw.root.rotation.set(0, 0, 0);
    claw.brain.attackDirection.set(0, 0, 1);
    claw.brain.clawDragSpeed = 0;
    claw.brain.clawVaultActive = false;
    claw.brain.clawVaultCooldown = 0;
    dungeon.isEnemyPositionClear = (enemy, position) => (
      position.z <= base.z + 0.12 || position.z >= base.z + 1.05
    );
    dungeon.isAerialPositionClear = (position) => !(
      position.z > base.z + 0.12
      && position.z < base.z + 1.05
      && position.y < base.y + 1
    );

    const vaultMoved = claw._updateClawDragAndVault(0.12, game, 0.1);
    const vaultStarted = claw.brain.clawVaultActive;
    const ignoresGroundDuringVault = claw.shouldIgnoreGroundConstraint();
    const roseOverBlockedLane = claw.root.position.y > base.y + 0.4;
    const vaultDuration = claw.brain.clawVaultDuration;
    const timeToApex = Math.max(0, vaultDuration * 0.5 - claw.brain.clawVaultTime);
    claw._updateClawDragAndVault(timeToApex, game, 0.32);
    const apexHeight = claw.root.position.y - base.y;
    claw._updateClawDragAndVault(vaultDuration, game, 0.7);
    const vaultTravel = Math.hypot(claw.root.position.x - base.x, claw.root.position.z - base.z);
    const landed = !claw.brain.clawVaultActive && Math.abs(claw.root.position.y - base.y) < 0.001;

    claw.brain.state = 'commit';
    claw.brain.stateTime = claw.genome.behavior.commitDuration * 0.48;
    claw._animateVisual(1);
    const shoulder = claw.visual.weapon.clawSwingPivot.getWorldPosition(new Vector3());
    const tip = claw.visual.weapon.muzzle.getWorldPosition(new Vector3());
    const physicalReach = shoulder.distanceTo(tip);

    dungeon.getSurfaceElevationAt = originalSurface;
    dungeon.isEnemyPositionClear = originalEnemyClear;
    dungeon.isAerialPositionClear = originalAerialClear;
    dungeon.getEnemyArenaTarget = originalArenaTarget;
    game.addParticleBurst = originalParticles;
    game.player.root.position.copy(base);
    claw.dispose?.();
    claw.root.removeFromParent();
    game.enemies.length = 0;

    return {
      dragMoved,
      dragTravel,
      vaultMoved,
      vaultStarted,
      ignoresGroundDuringVault,
      roseOverBlockedLane,
      apexHeight,
      vaultTravel,
      landed,
      physicalReach,
    };
  });

  expect(result.dragMoved).toBe(true);
  expect(result.dragTravel).toBeGreaterThan(0.3);
  expect(result.vaultMoved).toBe(true);
  expect(result.vaultStarted).toBe(true);
  expect(result.ignoresGroundDuringVault).toBe(true);
  expect(result.roseOverBlockedLane).toBe(true);
  expect(result.apexHeight).toBeGreaterThan(2);
  expect(result.vaultTravel).toBeGreaterThan(2);
  expect(result.landed).toBe(true);
  expect(result.physicalReach).toBeGreaterThan(4);
});
