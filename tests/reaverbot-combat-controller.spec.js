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

  expect(result.rotorSummary.contactHits).toBe(2);
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
    const originalSurface = dungeonController.getSurfaceElevationAt;
    const originalSafeZone = dungeonController.isPlayerInSafeZone;
    const originalExplosion = game.addExplosion;
    const originalBurst = game.addParticleBurst;
    const originalHitEffect = game.addHitEffect;
    const originalHitStop = game.requestHitStop;
    const originalTakeDamage = game.player.takeDamage;
    dungeonController.isPositionWalkable = () => true;
    dungeonController.getSurfaceElevationAt = () => playerPosition.y;
    dungeonController.isPlayerInSafeZone = () => false;

    const damageAttempts = [];
    const successfulContacts = [];
    let rejectNextContact = true;
    let hitEffects = 0;
    game.player.takeDamage = (amount, source, context = {}) => {
      damageAttempts.push({
        amount,
        sourceIsJaw: source === jaw,
        attackKind: context.attackKind,
        powerfulKnockback: context.powerfulKnockback,
        unblockable: context.unblockable,
        knockbackStrength: context.knockbackStrength,
        knockbackDirection: context.knockbackDirection?.clone?.() ?? null,
      });
      if (rejectNextContact) {
        rejectNextContact = false;
        return 0;
      }
      successfulContacts.push(context.attackKind);
      return amount;
    };
    game.addHitEffect = () => { hitEffects += 1; };
    game.requestHitStop = () => {};
    game.addParticleBurst = () => {};

    jaw.root.position.copy(overlapPosition);
    jaw.root.rotation.y = Math.PI;
    jaw.brain.attackDirection.set(0, 0, -1);
    jaw.brain.contactCooldown = 0;

    // The first rejected hit models dodge-roll invulnerability: it must not
    // consume the contact cooldown or emit impact feedback. The next frame can
    // then apply the real body hit, and the cooldown suppresses a duplicate.
    jaw._updatePersistentWeaponContact(0.016, game);
    const cooldownAfterRejectedContact = jaw.brain.contactCooldown;
    const hitEffectsAfterRejectedContact = hitEffects;
    jaw._updatePersistentWeaponContact(0.016, game);
    const cooldownAfterSuccessfulContact = jaw.brain.contactCooldown;
    jaw._updatePersistentWeaponContact(0.016, game);
    const attemptsAfterImmediateRepeat = damageAttempts.length;

    jaw.brain.state = 'commit';
    jaw.brain.contactCooldown = 0;
    jaw._updatePersistentWeaponContact(0.016, game);
    const attemptsDuringCommit = damageAttempts.length;

    const originalEnemyPositionClear = dungeonController.isEnemyPositionClear;
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
      attemptsAfterImmediateRepeat,
      attemptsDuringCommit,
      hitEffects,
      radiusAwareRecoverySamples,
      blockedRecoveryMoved,
      blockedRecoveryTravel,
      initialDistance,
      minimumSeparation,
      shockwaves,
      finalDistance: jaw.root.position.distanceTo(playerPosition),
    };

    game.player.takeDamage = originalTakeDamage;
    game.addExplosion = originalExplosion;
    game.addParticleBurst = originalBurst;
    game.addHitEffect = originalHitEffect;
    game.requestHitStop = originalHitStop;
    dungeonController.isPositionWalkable = originalWalkable;
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
  expect(result.cooldownAfterSuccessfulContact).toBeGreaterThan(0.6);
  expect(result.attemptsAfterImmediateRepeat).toBe(2);
  expect(result.attemptsDuringCommit).toBe(2);
  expect(result.radiusAwareRecoverySamples).toBeGreaterThan(0);
  expect(result.blockedRecoveryMoved).toBe(false);
  expect(result.blockedRecoveryTravel).toBeLessThan(0.001);
  expect(result.successfulContacts).toEqual(['meleeBodyContact']);
  expect(result.damageAttempts[1]).toMatchObject({
    sourceIsJaw: true,
    attackKind: 'meleeBodyContact',
    powerfulKnockback: true,
    unblockable: true,
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
