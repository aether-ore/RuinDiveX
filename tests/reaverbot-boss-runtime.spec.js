import { expect, test } from '@playwright/test';

const BOSS_PROFILE_IDS = [
  'crucibleWarden',
  'ascensionEngine',
  'pursuitRegent',
  'rubyOpticOracle',
  'ballisticsVizier',
  'revolvingFusillade',
  'highAngleBastion',
  'clusterSalvoReliquary',
  'feedDrumArsenal',
  'overloadReliquary',
];

const BOSS_TEST_FRAME_RATES = [30, 60, 120];
const GENERIC_ARENA_PATTERN_PROFILE_IDS = BOSS_PROFILE_IDS.filter(
  (profileId) => profileId !== 'rubyOpticOracle' && profileId !== 'ascensionEngine',
);

async function waitForGame(page) {
  await page.waitForFunction(() => Boolean(window.game?.spawner && window.game?.ui));
}

test('Ruby Optic Oracle prefers the authored model and retains procedural fallback state', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=authored-ruby-optic-oracle');
  await waitForGame(page);

  await page.evaluate(() => {
    window.game.stop();
    window.authoredRubyBoss = window.game.debugSpawnBoss('rubyOpticOracle').boss;
  });
  await page.waitForFunction(() => window.authoredRubyBoss?.authoredVisualState !== 'loading');

  const result = await page.evaluate(() => {
    const boss = window.authoredRubyBoss;
    const output = {
      state: boss.authoredVisualState,
      modelMarker: boss.root.userData.authoredBossModel,
      fallbackActive: boss.root.userData.authoredBossFallbackActive,
      authoredRoot: boss.visual.root.userData.authoredRubyOpticOracle === true,
      hasEye: Boolean(boss.visual.authoredEye),
      hasMuzzle: Boolean(boss.visual.weapon.muzzle),
      hasWeakPoint: Boolean(boss.visual.authoredWeakPoint),
      shutterCount: boss.visual.authoredShutters?.length ?? 0,
    };
    boss.dispose();
    boss.root.removeFromParent();
    const index = window.game.enemies.indexOf(boss);
    if (index >= 0) window.game.enemies.splice(index, 1);
    delete window.authoredRubyBoss;
    return output;
  });

  expect(result).toMatchObject({
    state: 'active',
    modelMarker: 'rubyOpticOracle',
    fallbackActive: false,
    authoredRoot: true,
    hasEye: true,
    hasMuzzle: true,
    hasWeakPoint: true,
    shutterCount: 8,
  });
});

test('Boss Hunts and the canonical Buster workshop redact materials, reveal discoveries, and lock on entry', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=boss-hunt-selector');
  await waitForGame(page);

  const initial = await page.evaluate(() => {
    const game = window.game;
    game.stop();
    game.setInventoryOpen(true, { mode: 'roll' });
    game.ui._selectRollWorkshopTab('hunts');
    const previewBoss = game.debugSpawnBoss('revolvingFusillade').boss;
    game._playBossRecoveryPresentation(previewBoss, { firstClear: true, victoryIndex: 1 });
    const undiscoveredVictoryText = document.getElementById('boss-victory-banner').textContent;
    previewBoss.dispose();
    previewBoss.root.removeFromParent();
    const previewIndex = game.enemies.indexOf(previewBoss);
    if (previewIndex >= 0) game.enemies.splice(previewIndex, 1);
    return {
      busterEnabled: game.busterLabEnabled,
      tabsHidden: document.getElementById('roll-workshop-tabs').hidden,
      busterTabHidden: document.getElementById('roll-buster-tab').hidden,
      profileIds: [...document.querySelectorAll('[data-action="boss-hunt-select"]')]
        .map((card) => card.dataset.bossProfileId),
      selected: document.querySelector('.boss-hunt-card.is-selected')?.dataset.bossProfileId,
      text: document.getElementById('boss-hunts-grid').textContent,
      undiscoveredVictoryText,
    };
  });

  expect(initial.busterEnabled).toBe(true);
  expect(initial.tabsHidden).toBe(false);
  expect(initial.busterTabHidden).toBe(false);
  expect(initial.profileIds).toEqual(BOSS_PROFILE_IDS);
  expect(initial.selected).toBe('revolvingFusillade');
  expect(initial.text).toContain('rapid pulse barrel');
  expect(initial.text).not.toContain('Revolving Pulse Barrel');
  expect(initial.undiscoveredVictoryText).toContain('Unidentified rapid pulse barrel');
  expect(initial.undiscoveredVictoryText).not.toContain('Revolving Pulse Barrel');

  const revealed = await page.evaluate(async () => {
    const game = window.game;
    await game.busterLabStorage.updateRollSalvageAsync((roll) => roll.addPart({
      id: 'revolvingPulseBarrel',
      name: 'Revolving Pulse Barrel',
      source: { enemyName: 'Pulse Cannon' },
    }));
    game._refreshRollSalvageStorage();
    game.ui._renderBossHunts();
    const card = document.querySelector('[data-boss-profile-id="revolvingFusillade"]');
    const previewBoss = game.debugSpawnBoss('revolvingFusillade').boss;
    game._playBossRecoveryPresentation(previewBoss, { firstClear: false, victoryIndex: 2 });
    const victoryText = document.getElementById('boss-victory-banner').textContent;
    previewBoss.dispose();
    previewBoss.root.removeFromParent();
    const previewIndex = game.enemies.indexOf(previewBoss);
    if (previewIndex >= 0) game.enemies.splice(previewIndex, 1);
    return { cardText: card?.textContent ?? '', victoryText };
  });
  expect(revealed.cardText).toContain('Revolving Pulse Barrel');
  expect(revealed.cardText).toContain('owned 1');
  expect(revealed.cardText).toContain('Known recipes');
  expect(revealed.victoryText).toContain('Revolving Pulse Barrel');

  const lockState = await page.evaluate(async () => {
    const game = window.game;
    const selected = await game.selectBossHunt('crucibleWarden');
    const entered = await game.enterRuinFromCamp();
    const firstExpeditionId = game.busterLabStorage.state.bossHunts.activeExpeditionId;
    const rejected = await game.selectBossHunt('highAngleBastion');
    game.ui._renderBossHunts();
    game.extractToCamp();
    await game.resetDungeonLayout({ free: true, message: 'Boss Hunt retry test' });
    const reentered = await game.enterRuinFromCamp();
    const secondExpeditionId = game.busterLabStorage.state.bossHunts.activeExpeditionId;
    return {
      selected,
      entered,
      rejected,
      selectedBossProfileId: game.getSelectedBossProfileId(),
      activeExpeditionId: game.busterLabStorage.state.bossHunts.activeExpeditionId,
      encounterProfileId: game.dungeon.encounters.find((entry) => entry.isBoss)?.bossProfileId,
      dungeonFamilyId: game.dungeon.dungeonFamilyId,
      hasMagmaFacilityState: Object.prototype.hasOwnProperty.call(game.dungeon, 'facilityState'),
      lockLabel: document.getElementById('boss-hunts-lock-status').textContent,
      disabledCards: [...document.querySelectorAll('[data-action="boss-hunt-select"]')]
        .every((card) => card.disabled),
      firstExpeditionId,
      reentered,
      secondExpeditionId,
      firstStatus: game.busterLabStorage.state.bossHunts.recordedExpeditions[firstExpeditionId]?.status,
    };
  });
  expect(lockState.selected.ok).toBe(true);
  expect(lockState.entered).toBe(true);
  expect(lockState.rejected).toMatchObject({ ok: false, reason: 'expedition-locked' });
  expect(lockState.selectedBossProfileId).toBe('crucibleWarden');
  expect(lockState.encounterProfileId).toBe('crucibleWarden');
  expect(lockState.dungeonFamilyId).toBe('industrial-v1');
  expect(lockState.hasMagmaFacilityState).toBe(false);
  expect(lockState.activeExpeditionId).toBeTruthy();
  expect(lockState.lockLabel).toContain('LOCKED');
  expect(lockState.disabledCards).toBe(true);
  expect(lockState.reentered).toBe(true);
  expect(lockState.secondExpeditionId).toBeTruthy();
  expect(lockState.secondExpeditionId).not.toBe(lockState.firstExpeditionId);
  expect(lockState.firstStatus).toBe('abandoned');
});

test('boss ExpeditionSpec depth owns runtime level, threat tier, and combat depth', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=boss-expedition-depth');
  await waitForGame(page);

  const result = await page.evaluate(() => {
    const game = window.game;
    game.stop();
    const encounter = game.dungeon.encounters.find((entry) => entry.isBoss);
    if (!encounter) throw new Error('Generated dungeon has no boss encounter');
    const originalGetDifficulty = game.spawner.getDifficulty;
    const previousProfileId = encounter.bossProfileId;
    const previousExpeditionSpec = encounter.expeditionSpec;
    const expeditionSpec = Object.freeze({
      schemaVersion: 1,
      id: 'playwright-depth-seven-expedition',
      seed: 0x7e57c0de,
      depth: 7,
      bossProfileId: 'rubyOpticOracle',
    });
    game.spawner.getDifficulty = () => 2;
    game.setBusterCombatDepthLevel(1, { encounterId: 'test-reset' });
    encounter.bossProfileId = expeditionSpec.bossProfileId;
    encounter.expeditionSpec = expeditionSpec;
    const boss = game.spawner.spawnEncounter(encounter)[0];
    const output = {
      liveDifficulty: game.spawner.getDifficulty(),
      expeditionDepth: boss.expeditionSpec?.depth,
      level: boss.level,
      threatTier: boss.genome?.threatTier,
      combatDepthLevel: game.combatDepthLevel,
      combatDepthEncounterId: game.busterCombatDepthEncounterId,
      encounterId: encounter.id,
    };

    game.spawner.getDifficulty = originalGetDifficulty;
    encounter.bossProfileId = previousProfileId;
    encounter.expeditionSpec = previousExpeditionSpec;
    boss.dispose();
    boss.root.removeFromParent();
    const bossIndex = game.enemies.indexOf(boss);
    if (bossIndex >= 0) game.enemies.splice(bossIndex, 1);
    return output;
  });

  expect(result.liveDifficulty).toBe(2);
  expect(result.expeditionDepth).toBe(7);
  expect(result.level).toBe(7);
  expect(result.threatTier).toBe(7);
  expect(result.combatDepthLevel).toBe(7);
  expect(result.combatDepthEncounterId).toBe(result.encounterId);
});

test('boss phase clamp, signature overload, direct-only integrity, and lock transfer use live combat objects', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=boss-signature-runtime');
  await waitForGame(page);

  const result = await page.evaluate(() => {
    const game = window.game;
    game.stop();
    const boss = game.debugSpawnBoss('highAngleBastion').boss;
    const Vector3 = boss.root.position.constructor;
    boss._runtimeGame = game;
    const initialIntegrity = boss.signatureIntegrity;
    const initialHealth = boss.health;
    const signaturePosition = boss.signatureVisual.core.getWorldPosition(new Vector3());
    game.projectiles.spawn({
      owner: 'player',
      position: signaturePosition,
      direction: new Vector3(0, 0, 1),
      speed: 0,
      range: 1,
      radius: 0.12,
      damage: 4,
      source: game.player,
      attackMeta: {
        armorPierce: Number.POSITIVE_INFINITY,
        unblockable: true,
        playerOwnedAttack: true,
      },
    });
    game.projectiles.update(1 / 60);
    const integrityAfterLiveProjectile = boss.signatureIntegrity;
    const healthAfterLiveProjectile = boss.health;

    boss._ensureArenaConstructs(game);
    boss._startSignaturePattern(game);
    const arenaNode = boss.bossState.activeArenaNodes[0];
    const nodeHealthBefore = boss.health;
    const nodeTelegraphsBefore = boss.bossState.activeTelegraphs
      .filter((entry) => entry.arenaNode === arenaNode).length;
    game.combat.lockOn.target = arenaNode.target;
    game.combat.lockOn.progress = 0.72;
    const nodePosition = arenaNode.object.getWorldPosition(new Vector3());
    game.projectiles.spawn({
      owner: 'player',
      position: nodePosition,
      direction: new Vector3(0, 0, 1),
      speed: 0,
      range: 1,
      radius: 0.12,
      damage: 100,
      source: game.player,
      attackMeta: { playerOwnedAttack: true, unblockable: true },
    });
    game.projectiles.update(1 / 60);
    const nodeResult = {
      active: arenaNode.active,
      nodeHealthBefore,
      nodeHealthAfter: boss.health,
      nodeTelegraphsBefore,
      nodeTelegraphsAfter: boss.bossState.activeTelegraphs
        .filter((entry) => entry.arenaNode === arenaNode).length,
      lockTransferred: game.combat.lockOn.target === boss,
      lockProgress: game.combat.lockOn.progress,
    };

    game.combat.lockOn.target = boss.signatureTarget;
    game.combat.lockOn.progress = 1;
    game.combat.lockOn.movementLocked = true;
    game.combat.lockOn.manual = true;
    const splashMeta = {
      source: game.player,
      playerOwnedAttack: true,
      signaturePartHit: true,
      directHit: true,
      areaDamage: true,
      armorPierce: Number.POSITIVE_INFINITY,
      unblockable: true,
      knockbackDirection: new Vector3(1, 0, 0),
      knockback: 12,
    };
    boss.takeDamage(4, splashMeta);
    const integrityAfterSplash = boss.signatureIntegrity;

    const phaseDamage = boss.takeDamage(boss.stats.maxHealth * 4, {
      source: game.player,
      directHit: true,
      armorPierce: Number.POSITIVE_INFINITY,
      unblockable: true,
    });
    const phaseHealth = boss.health;
    const transitionDamage = boss.takeDamage(20, {
      source: game.player,
      directHit: true,
      armorPierce: Number.POSITIVE_INFINITY,
      unblockable: true,
    });
    boss.bossState.transitionRemaining = 0;
    boss.takeDamage(boss.signatureIntegrity / 1.5 + 0.01, {
      source: game.player,
      playerOwnedAttack: true,
      signaturePartHit: true,
      projectileHit: true,
      directHit: true,
      armorPierce: Number.POSITIVE_INFINITY,
      unblockable: true,
    });
    const output = {
      initialIntegrity,
      initialHealth,
      integrityAfterLiveProjectile,
      healthAfterLiveProjectile,
      nodeResult,
      integrityAfterSplash,
      splashMultiplier: splashMeta.bossSignatureMultiplier ?? null,
      phaseDamage,
      phaseHealth,
      phase: boss.bossState.phase,
      transitionDamage,
      overloaded: boss.signaturePartOverloaded,
      interruptRemaining: boss.bossState.interruptRemaining,
      outerVisible: boss.signatureVisual.outer.visible,
      signatureStillTargetable: boss.getCombatTargets().includes(boss.signatureTarget),
      lockTransferredToBody: game.combat.lockOn.target === boss,
      lockProgress: game.combat.lockOn.progress,
      movementLocked: game.combat.lockOn.movementLocked,
      knockbackLength: boss.knockback.length(),
      hud: boss.getBossHudState(),
    };
    boss.dispose();
    boss.root.removeFromParent();
    return output;
  });

  expect(result.initialIntegrity - result.integrityAfterLiveProjectile).toBeCloseTo(6, 6);
  expect(result.initialHealth - result.healthAfterLiveProjectile).toBeCloseTo(6, 6);
  expect(result.nodeResult.active).toBe(false);
  expect(result.nodeResult.nodeHealthAfter).toBeCloseTo(result.nodeResult.nodeHealthBefore, 8);
  expect(result.nodeResult.nodeTelegraphsBefore).toBeGreaterThan(0);
  expect(result.nodeResult.nodeTelegraphsAfter).toBe(0);
  expect(result.nodeResult.lockTransferred).toBe(true);
  expect(result.nodeResult.lockProgress).toBeCloseTo(0.72, 8);
  expect(result.integrityAfterSplash).toBeCloseTo(result.integrityAfterLiveProjectile, 8);
  expect(result.splashMultiplier).toBeNull();
  expect(result.phaseDamage).toBeGreaterThan(0);
  expect(result.phaseHealth).toBeCloseTo(result.hud.maxHealth * 0.5, 6);
  expect(result.phase).toBe(2);
  expect(result.transitionDamage).toBe(0);
  expect(result.overloaded).toBe(true);
  expect(result.interruptRemaining).toBeCloseTo(2, 8);
  expect(result.outerVisible).toBe(false);
  expect(result.signatureStillTargetable).toBe(false);
  expect(result.lockTransferredToBody).toBe(true);
  expect(result.lockProgress).toBe(1);
  expect(result.movementLocked).toBe(true);
  expect(result.knockbackLength).toBe(0);
});

test('phase transition and signature overload cancel active arena offense and hold boss control', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=boss-interrupt-cancellation');
  await waitForGame(page);

  const result = await page.evaluate(() => {
    const game = window.game;
    game.stop();
    const boss = game.debugSpawnBoss('pursuitRegent').boss;
    const Vector3 = boss.root.position.constructor;
    boss._runtimeGame = game;
    boss._ensureArenaConstructs(game);

    const resetAttackDirector = () => {
      game.enemyAttackDirector.owner = null;
      game.enemyAttackDirector.queue = [];
      game.enemyAttackDirector.requestTimes.clear();
      game.enemyAttackDirector.handoffTimer = 0;
    };
    const seedArenaOffense = (key) => {
      const origin = boss.root.position.clone();
      const direction = game.player.root.position.clone().sub(origin).setY(0);
      if (direction.lengthSq() <= 0.001) direction.set(0, 0, 1);
      direction.normalize();
      boss._queueLane(game, origin, direction, 12, 0.42, 2, 0.8, { projectile: true });
      boss._spawnCraterHazard(game, origin.clone().add(new Vector3(1.5, 0, 0)), 0.9);
      const node = boss._spawnArenaNode(
        game,
        origin.clone().add(new Vector3(-1.5, 0, 0)),
        'interruptProbe',
        key,
      );
      boss._spawnBossProjectile(game, origin, direction, 12, 1);
      boss.brain.state = 'telegraph';
      boss.brain.stateTime = 0;
      resetAttackDirector();
      const attackLeaseClaimed = game.requestEnemyAttack(boss);
      return {
        attackLeaseClaimed,
        objects: [
          ...boss.bossState.activeTelegraphs.map((entry) => entry.object),
          ...boss.bossState.activeHazards.map((entry) => entry.object),
          ...boss.bossState.activeArenaNodes.map((entry) => entry.object),
          ...game.projectiles.active
            .filter((projectile) => projectile.source === boss)
            .map((projectile) => projectile.mesh),
        ],
        node,
      };
    };
    const getCancellationState = (artifacts) => ({
      telegraphs: boss.bossState.activeTelegraphs.length,
      hazards: boss.bossState.activeHazards.length,
      arenaNodes: boss.bossState.activeArenaNodes.length,
      projectiles: game.projectiles.active.filter((projectile) => projectile.source === boss).length,
      allDetached: artifacts.objects.every((object) => object.parent === null),
      nodeActive: artifacts.node?.active ?? null,
      attackOwnerCleared: game.enemyAttackDirector.owner !== boss,
      attackRequestCleared: !game.enemyAttackDirector.requestTimes.has(boss)
        && !game.enemyAttackDirector.queue.includes(boss),
      controlLocked: boss._isControlLocked(),
      externalControlRejected: boss.tryClaimExternalControl({ id: 'test-controller' }) === false,
      ballisticControlRejected: boss.startExternalBallisticMotion({ velocity: new Vector3(1, 0, 0) }) === false,
    });

    const phaseArtifacts = seedArenaOffense('phase-transition');
    const phaseDamage = boss.takeDamage(boss.stats.maxHealth * 4, {
      source: game.player,
      directHit: true,
      armorPierce: Number.POSITIVE_INFINITY,
      unblockable: true,
    });
    const phase = {
      attackLeaseClaimed: phaseArtifacts.attackLeaseClaimed,
      damage: phaseDamage,
      phase: boss.bossState.phase,
      transitionRemaining: boss.bossState.transitionRemaining,
      persistentConstructs: boss.bossState.constructs.length,
      constructsStillAttached: boss.bossState.constructs.every((object) => object.parent === game.scene),
      ...getCancellationState(phaseArtifacts),
    };

    boss.bossState.transitionRemaining = 0;
    boss.bossState.interruptRemaining = 0;
    const overloadArtifacts = seedArenaOffense('signature-overload');
    game.combat.lockOn.target = boss.signatureTarget;
    game.combat.lockOn.progress = 0.64;
    game.combat.lockOn.movementLocked = true;
    game.combat.lockOn.manual = true;
    game.combat.lockOn.source = 'manual';
    boss.takeDamage(boss.signatureIntegrity / 1.5 + 0.01, {
      source: game.player,
      playerOwnedAttack: true,
      signaturePartHit: true,
      projectileHit: true,
      directHit: true,
      armorPierce: Number.POSITIVE_INFINITY,
      unblockable: true,
    });
    const overload = {
      attackLeaseClaimed: overloadArtifacts.attackLeaseClaimed,
      overloaded: boss.signaturePartOverloaded,
      interruptRemaining: boss.bossState.interruptRemaining,
      lockTransferred: game.combat.lockOn.target === boss,
      lockProgress: game.combat.lockOn.progress,
      movementLocked: game.combat.lockOn.movementLocked,
      manualLock: game.combat.lockOn.manual,
      lockSource: game.combat.lockOn.source,
      ...getCancellationState(overloadArtifacts),
    };

    boss.dispose();
    boss.root.removeFromParent();
    const bossIndex = game.enemies.indexOf(boss);
    if (bossIndex >= 0) game.enemies.splice(bossIndex, 1);
    return { phase, overload };
  });

  expect(result.phase.attackLeaseClaimed).toBe(true);
  expect(result.phase.damage).toBeGreaterThan(0);
  expect(result.phase.phase).toBe(2);
  expect(result.phase.transitionRemaining).toBeGreaterThan(0);
  expect(result.phase.persistentConstructs).toBeGreaterThan(0);
  expect(result.phase.constructsStillAttached).toBe(true);
  expect(result.phase).toMatchObject({
    telegraphs: 0,
    hazards: 0,
    arenaNodes: 0,
    projectiles: 0,
    allDetached: true,
    nodeActive: false,
    attackOwnerCleared: true,
    attackRequestCleared: true,
    controlLocked: true,
    externalControlRejected: true,
    ballisticControlRejected: true,
  });

  expect(result.overload.attackLeaseClaimed).toBe(true);
  expect(result.overload.overloaded).toBe(true);
  expect(result.overload.interruptRemaining).toBeGreaterThan(0);
  expect(result.overload).toMatchObject({
    telegraphs: 0,
    hazards: 0,
    arenaNodes: 0,
    projectiles: 0,
    allDetached: true,
    nodeActive: false,
    attackOwnerCleared: true,
    attackRequestCleared: true,
    controlLocked: true,
    externalControlRejected: true,
    ballisticControlRejected: true,
    lockTransferred: true,
    movementLocked: true,
    manualLock: true,
    lockSource: 'manual',
  });
  expect(result.overload.lockProgress).toBeCloseTo(0.64, 8);
});

test('every authored arena pattern respects its warning boundary and matching hit geometry', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=boss-telegraph-parity');
  await waitForGame(page);

  const results = await page.evaluate((profileIds) => {
    const game = window.game;
    game.stop();
    const originalTakeIncomingHit = game.player.takeIncomingHit;
    const summaries = [];
    for (const profileId of profileIds) {
      game.projectiles.clear('telegraph-parity-reset');
      const spawned = game.debugSpawnBoss(profileId);
      if (!spawned.ok) throw new Error(spawned.message ?? spawned.reason);
      const boss = spawned.boss;
      boss._runtimeGame = game;
      boss.bossState.phase = 2;
      boss.bossState.transitionRemaining = 0;
      boss.bossState.interruptRemaining = 0;
      boss._ensureArenaConstructs(game);
      if (profileId === 'overloadReliquary') {
        boss.root.position.copy(boss._getOverloadArenaCenterTarget(game));
      }
      boss._startSignaturePattern(game);
      const selected = boss.bossState.activeTelegraphs
        .filter((entry) => !entry.visualOnly)
        .reduce((best, entry) => (!best || entry.warning < best.warning ? entry : best), null);
      if (!selected) throw new Error(`${profileId} created no telegraph`);

      if (selected.kind === 'lane') {
        game.player.root.position.copy(selected.origin).addScaledVector(
          selected.direction,
          Math.max(1.2, Math.min(3, selected.length * 0.42)),
        );
        game.player.root.position.y = game.dungeonController?.getSurfaceElevationAt?.(game.player.root.position) ?? 0;
      } else if (selected.kind === 'ring') {
        const radius = (selected.innerRadius + selected.radius) * 0.5;
        game.player.root.position.copy(selected.center);
        if (selected.safeSectors?.length) {
          game.player.root.position.addScaledVector(selected.safeSectors[0].direction, -radius);
        } else {
          game.player.root.position.x += radius;
        }
      } else {
        game.player.root.position.copy(selected.center);
        if (selected.safeSectors?.length) {
          game.player.root.position.addScaledVector(
            selected.safeSectors[0].direction,
            -Math.min(1.5, selected.radius * 0.6),
          );
        }
      }

      let damageEvents = 0;
      game.player.takeIncomingHit = (incomingHit = {}) => {
        const amount = Math.max(0, Number(incomingHit.amount) || 0);
        if (amount > 0) damageEvents += 1;
        return {
          contacted: amount > 0,
          dodged: false,
          guarded: false,
          parried: false,
          immune: false,
          barrierDamage: 0,
          healthDamage: amount,
          resolvedReactionTier: incomingHit.reactionTier ?? 0,
          statusEligible: amount > 0,
        };
      };
      boss._updateArenaObjects(Math.max(0, selected.warning - 0.01), game);
      const beforeBoundary = damageEvents;
      boss._updateArenaObjects(0.02, game);
      const atBoundary = damageEvents;
      for (let tick = 0; tick < 240; tick += 1) game.projectiles.update(1 / 120);
      summaries.push({
        profileId,
        kind: selected.kind,
        projectile: Boolean(selected.projectile),
        warning: selected.warning,
        beforeBoundary,
        atBoundary,
        afterDelivery: damageEvents,
      });
      boss.dispose();
      boss.root.removeFromParent();
      const index = game.enemies.indexOf(boss);
      if (index >= 0) game.enemies.splice(index, 1);
    }
    game.player.takeIncomingHit = originalTakeIncomingHit;
    game.projectiles.clear('telegraph-parity-complete');
    return summaries;
  }, GENERIC_ARENA_PATTERN_PROFILE_IDS);

  expect(results.map((entry) => entry.profileId)).toEqual(GENERIC_ARENA_PATTERN_PROFILE_IDS);
  for (const result of results) {
    expect(result.beforeBoundary, `${result.profileId} fired before its warning`).toBe(0);
    expect(result.warning, result.profileId).toBeGreaterThanOrEqual(
      result.profileId === 'revolvingFusillade' ? 0.55 : 0.75,
    );
    expect(result.afterDelivery, `${result.profileId} telegraph did not match a damaging path`).toBeGreaterThan(0);
    if (!(result.kind === 'lane' && result.projectile)) {
      expect(result.atBoundary, `${result.profileId} did not resolve at its displayed boundary`).toBeGreaterThan(0);
    }
  }
});

test('signature patterns expose authored pylon, feed-mode, and raid-grid mechanics', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=boss-signature-pattern-fidelity');
  await waitForGame(page);

  const result = await page.evaluate(() => {
    const game = window.game;
    game.stop();
    const spawnPhaseTwo = (profileId) => {
      const boss = game.debugSpawnBoss(profileId).boss;
      boss._runtimeGame = game;
      boss.bossState.phase = 2;
      boss.bossState.transitionRemaining = 0;
      boss.bossState.interruptRemaining = 0;
      boss._ensureArenaConstructs(game);
      return boss;
    };
    const discard = (boss) => {
      boss.dispose();
      boss.root.removeFromParent();
      const index = game.enemies.indexOf(boss);
      if (index >= 0) game.enemies.splice(index, 1);
    };

    const revolving = spawnPhaseTwo('revolvingFusillade');
    revolving._startSignaturePattern(game);
    const revolvingRoles = revolving.bossState.activeTelegraphs.map((entry) => entry.patternRole);
    const revolvingCounts = revolving.getBossResourceCounts(game);
    discard(revolving);

    const feed = spawnPhaseTwo('feedDrumArsenal');
    feed._startSignaturePattern(game);
    const firstFeedRoles = feed.bossState.activeTelegraphs.map((entry) => entry.patternRole);
    const firstFeedLinks = feed.bossState.activeTelegraphs.filter((entry) => entry.visualOnly);
    feed._cancelBossArenaAttacks(game, 'feed-mode-switch');
    feed._startSignaturePattern(game);
    const secondFeedRoles = feed.bossState.activeTelegraphs.map((entry) => entry.patternRole);
    const feedCounts = feed.getBossResourceCounts(game);
    discard(feed);

    const overload = spawnPhaseTwo('overloadReliquary');
    overload.root.position.copy(overload._getOverloadArenaCenterTarget(game));
    overload._startSignaturePattern(game);
    const raidTelegraphs = overload.bossState.activeTelegraphs
      .filter((entry) => String(entry.patternRole ?? '').startsWith('overloadRaid'));
    const waveA = raidTelegraphs.filter((entry) => entry.patternRole === 'overloadRaidWaveA');
    const waveB = raidTelegraphs.filter((entry) => entry.patternRole === 'overloadRaidWaveB');
    const raidCenters = raidTelegraphs.map((entry) => entry.center.clone());
    const minX = Math.min(...raidCenters.map((center) => center.x));
    const maxX = Math.max(...raidCenters.map((center) => center.x));
    const minZ = Math.min(...raidCenters.map((center) => center.z));
    const maxZ = Math.max(...raidCenters.map((center) => center.z));
    const overloadShape = {
      mode: overload.bossState.reliquary.mode,
      count: raidTelegraphs.length,
      allCircles: raidTelegraphs.every((entry) => entry.kind === 'circle'),
      waveACount: waveA.length,
      waveBCount: waveB.length,
      waveWarnings: [...new Set(raidTelegraphs.map((entry) => entry.warning))].sort((a, b) => a - b),
      xExtent: maxX - minX,
      zExtent: maxZ - minZ,
      distinctX: new Set(raidCenters.map((center) => center.x.toFixed(5))).size,
      distinctZ: new Set(raidCenters.map((center) => center.z.toFixed(5))).size,
      counts: overload.getBossResourceCounts(game),
    };
    const raidObjects = raidTelegraphs.map((entry) => entry.object);
    overload._cancelBossArenaAttacks(game, 'raid-grid-test');
    overloadShape.cleanup = {
      telegraphsDetached: raidObjects.every((object) => object.parent === null),
      telegraphsRemaining: overload.bossState.activeTelegraphs.length,
    };
    discard(overload);

    game.projectiles.clear('boss-pattern-fidelity-complete');
    return {
      revolving: { roles: revolvingRoles, counts: revolvingCounts },
      feed: {
        firstRoles: firstFeedRoles,
        secondRoles: secondFeedRoles,
        visibleLinks: firstFeedLinks.length,
        linksAreNonDamaging: firstFeedLinks.every((entry) => entry.damageScale === 0),
        counts: feedCounts,
      },
      overload: overloadShape,
    };
  });

  expect(result.revolving.roles.filter((role) => role === 'rotatingPylonCrossfire')).toHaveLength(3);
  expect(result.revolving.roles.filter((role) => role === 'sustainedPylonSweep')).toHaveLength(3);
  expect(result.revolving.roles.filter((role) => role === 'mobileSustainedSweep')).toHaveLength(3);
  expect(result.revolving.counts.telegraphs).toBeLessThanOrEqual(12);
  expect(result.revolving.counts.projectiles).toBeLessThanOrEqual(20);

  expect(result.feed.visibleLinks).toBe(2);
  expect(result.feed.linksAreNonDamaging).toBe(true);
  expect(result.feed.firstRoles).toContain('ammunitionOutput:fan');
  expect(result.feed.secondRoles).toContain('ammunitionOutput:focused');
  expect(result.feed.counts.telegraphs).toBeLessThanOrEqual(12);

  expect(result.overload).toMatchObject({
    mode: 'raidCast',
    count: 9,
    allCircles: true,
    waveACount: 5,
    waveBCount: 4,
    waveWarnings: [1.05, 1.82],
    distinctX: 3,
    distinctZ: 3,
    cleanup: { telegraphsDetached: true, telegraphsRemaining: 0 },
  });
  expect(result.overload.xExtent).toBeGreaterThan(5);
  expect(result.overload.zExtent).toBeGreaterThan(5);
  expect(result.overload.counts.telegraphs).toBeLessThanOrEqual(12);
  expect(result.overload.counts.constructs).toBe(0);
});

test('Overload Reliquary flits, lays capped mines, summons detonators, and exposes a shield-break damage window', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=overload-reliquary-moveset');
  await waitForGame(page);

  const result = await page.evaluate(() => {
    const game = window.game;
    game.stop();
    game.projectiles.clear('overload-reliquary-moveset-reset');
    const boss = game.debugSpawnBoss('overloadReliquary').boss;
    boss._runtimeGame = game;
    boss.bossState.arenaCooldown = 999;
    boss.bossState.transitionRemaining = 0;
    boss.bossState.interruptRemaining = 0;
    const reliquary = boss.bossState.reliquary;
    reliquary.mineTimer = 999;
    reliquary.minionTimer = 999;

    const controller = game.dungeonController;
    const originalIsEnemyPositionClear = controller.isEnemyPositionClear;
    controller.isEnemyPositionClear = () => true;
    reliquary.mode = 'flit';
    reliquary.waypoint.copy(boss.root.position);
    reliquary.waypoint.x += 4;
    reliquary.waypointTimer = 1;
    reliquary.waypointSerial = 2;
    const flitOrigin = boss.root.position.clone();
    const yawBeforeFirstFlit = boss.root.rotation.y;
    boss._updatePositionState(0.2, game, game.player.root.position.clone().sub(boss.root.position), 4);
    const afterFirstFlit = boss.root.position.clone();
    const firstSpin = boss.root.rotation.y - yawBeforeFirstFlit;

    reliquary.waypoint.copy(boss.root.position);
    reliquary.waypoint.z -= 4;
    reliquary.waypointTimer = 1;
    reliquary.waypointSerial = 3;
    const yawBeforeSecondFlit = boss.root.rotation.y;
    boss._updatePositionState(0.2, game, game.player.root.position.clone().sub(boss.root.position), 4);
    const afterSecondFlit = boss.root.position.clone();
    const secondSpin = boss.root.rotation.y - yawBeforeSecondFlit;
    controller.isEnemyPositionClear = originalIsEnemyPositionClear;
    const firstHeading = afterFirstFlit.clone().sub(flitOrigin).setY(0).normalize();
    const secondHeading = afterSecondFlit.clone().sub(afterFirstFlit).setY(0).normalize();
    const flit = {
      mode: reliquary.mode,
      firstDistance: flitOrigin.distanceTo(afterFirstFlit),
      secondDistance: afterFirstFlit.distanceTo(afterSecondFlit),
      headingDot: firstHeading.dot(secondHeading),
      firstSpin,
      secondSpin,
      moving: boss.brain.moving,
      speedRatio: boss.brain.speedRatio,
    };

    boss._beginPhaseTwo();
    boss.bossState.transitionRemaining = 0;
    reliquary.mineTimer = 999;
    reliquary.minionTimer = 999;
    const phaseTwoHealth = boss.health;
    const firstBlockMeta = { projectileHit: true, directHit: true, armorPierce: 999 };
    const firstBlockedDamage = boss.takeDamage(11, firstBlockMeta);
    const initialShield = {
      phase: boss.bossState.phase,
      active: reliquary.shieldActive,
      hits: reliquary.shieldHits,
      visible: boss.overloadShieldVisual.object.visible,
      dealt: firstBlockedDamage,
      healthLost: phaseTwoHealth - boss.health,
      meta: firstBlockMeta,
    };

    const firstSpawnCount = boss._spawnOverloadDetonators(game, 10);
    const secondSpawnCount = boss._spawnOverloadDetonators(game, 2);
    const detonators = boss._getLiveOverloadDetonators();
    const minions = {
      firstSpawnCount,
      secondSpawnCount,
      liveCount: detonators.length,
      ordinarySelfDestruct: detonators.every((enemy) => (
        enemy.genome.archetypeId === 'aerialBomber'
        && enemy.genome.modules.weapon.attackKind === 'selfDestruct'
        && enemy.genome.modules.weapon.tags.includes('selfDestruct')
        && enemy.isReliquaryDetonator === true
        && enemy.summonerBoss === boss
        && !enemy.isBoss
      )),
    };

    detonators[2].brain.detonatorKnockback = { redirectedByPlayer: true };
    boss.bossState.transitionRemaining = 0.5;
    const transitionShieldImpact = boss.onWeaponizedDetonatorImpact(detonators[2], game, {
      position: boss.root.position.clone(),
    });
    const transitionShield = {
      active: reliquary.shieldActive,
      hits: reliquary.shieldHits,
    };
    boss.bossState.transitionRemaining = 0;

    detonators[0].brain.detonatorKnockback = { redirectedByPlayer: true };
    detonators[1].brain.detonatorKnockback = { redirectedByPlayer: true };
    const firstShieldImpact = boss.onWeaponizedDetonatorImpact(detonators[0], game, {
      position: boss.root.position.clone(),
    });
    const shieldAfterFirstImpact = {
      active: reliquary.shieldActive,
      hits: reliquary.shieldHits,
    };
    const secondShieldImpact = boss.onWeaponizedDetonatorImpact(detonators[1], game, {
      position: boss.root.position.clone(),
    });
    const shieldAfterSecondImpact = {
      active: reliquary.shieldActive,
      hits: reliquary.shieldHits,
      breakCount: reliquary.shieldBreakCount,
      stunRemaining: reliquary.shieldStunRemaining,
      mode: reliquary.mode,
      moving: boss.brain.moving,
      defenseActive: boss.brain.defenseActive,
    };

    const stunPosition = boss.root.position.clone();
    boss.update(0.25, game);
    const stunHealth = boss.health;
    const stunDamageMeta = { projectileHit: true, directHit: true, armorPierce: 999 };
    const stunDamage = boss.takeDamage(11, stunDamageMeta);
    const stun = {
      flatMovement: Math.hypot(
        boss.root.position.x - stunPosition.x,
        boss.root.position.z - stunPosition.z,
      ),
      moving: boss.brain.moving,
      dealt: stunDamage,
      healthLost: stunHealth - boss.health,
      vulnerableMeta: stunDamageMeta.overloadShieldStunVulnerable === true,
      remaining: reliquary.shieldStunRemaining,
    };

    reliquary.shieldStunRemaining = 0.01;
    boss.update(0.02, game);
    const reformedHealth = boss.health;
    const reformedBlockMeta = { projectileHit: true, directHit: true, armorPierce: 999 };
    const reformedDamage = boss.takeDamage(11, reformedBlockMeta);
    const reformed = {
      active: reliquary.shieldActive,
      hits: reliquary.shieldHits,
      visible: boss.overloadShieldVisual.object.visible,
      dealt: reformedDamage,
      healthLost: reformedHealth - boss.health,
      blockedMeta: reformedBlockMeta.overloadReliquaryShield === true,
    };

    boss._cancelBossArenaAttacks(game, 'blocked-center-proof-reset');
    const blockedCenterTarget = boss._getOverloadArenaCenterTarget(game).clone();
    boss.root.position.copy(blockedCenterTarget);
    boss.root.position.x += 4;
    reliquary.mode = 'raidApproach';
    reliquary.raidApproachTimer = 0;
    const originalRaidPositionClear = controller.isEnemyPositionClear;
    controller.isEnemyPositionClear = () => false;
    boss._updatePositionState(
      2.36,
      game,
      game.player.root.position.clone().sub(boss.root.position),
      4,
    );
    controller.isEnemyPositionClear = originalRaidPositionClear;
    const blockedRaid = {
      mode: reliquary.mode,
      telegraphs: boss.bossState.activeTelegraphs.filter((entry) => (
        String(entry.patternRole ?? '').startsWith('overloadRaid')
      )).length,
    };
    boss._cancelBossArenaAttacks(game, 'blocked-center-proof-complete');

    const mineDropResults = Array.from({ length: 8 }, () => boss._dropOverloadMine(game));
    const mines = game.projectiles.active.filter((projectile) => (
      projectile.source === boss && (projectile.landAsMine || projectile.landedMine)
    ));
    boss._removeTelegraphMarker?.();
    const raidCount = boss._queueOverloadRaidPattern(game);
    const telegraphObjects = boss.bossState.activeTelegraphs.map((entry) => entry.object);
    const mineMeshes = mines.map((projectile) => projectile.mesh);
    const minionRoots = detonators.map((enemy) => enemy.root);
    const beforeCleanup = {
      mineDropResults,
      mineCount: mines.length,
      raidCount,
      telegraphCount: boss.bossState.activeTelegraphs.length,
      summonCount: reliquary.summonedDetonators.size,
    };

    boss.dispose();
    const cleanup = {
      cleaned: boss.bossState.cleaned,
      summonsRemaining: reliquary.summonedDetonators.size,
      summonsRemovedFromGame: detonators.every((enemy) => !game.enemies.includes(enemy)),
      summonRootsDetached: minionRoots.every((root) => root.parent === null),
      minesRemaining: game.projectiles.active.filter((projectile) => projectile.source === boss).length,
      mineMeshesDetached: mineMeshes.every((mesh) => mesh.parent === null),
      telegraphsRemaining: boss.bossState.activeTelegraphs.length,
      telegraphsDetached: telegraphObjects.every((object) => object.parent === null),
      resources: boss.getBossResourceCounts(game),
    };
    boss.root.removeFromParent();
    const bossIndex = game.enemies.indexOf(boss);
    if (bossIndex >= 0) game.enemies.splice(bossIndex, 1);

    return {
      flit,
      initialShield,
      minions,
      transitionShieldImpact,
      transitionShield,
      firstShieldImpact,
      shieldAfterFirstImpact,
      secondShieldImpact,
      shieldAfterSecondImpact,
      stun,
      reformed,
      blockedRaid,
      beforeCleanup,
      cleanup,
    };
  });

  expect(result.flit.mode).toBe('flit');
  expect(result.flit.firstDistance).toBeCloseTo(1.48, 5);
  expect(result.flit.secondDistance).toBeCloseTo(1.48, 5);
  expect(Math.abs(result.flit.headingDot)).toBeLessThan(0.01);
  expect(result.flit.firstSpin).toBeGreaterThan(1);
  expect(result.flit.secondSpin).toBeLessThan(-1);
  expect(result.flit).toMatchObject({ moving: true, speedRatio: 1.85 });

  expect(result.initialShield).toMatchObject({
    phase: 2,
    active: true,
    hits: 2,
    visible: true,
    dealt: 0,
    healthLost: 0,
    meta: { shieldBlocked: true, damageNullified: true, overloadReliquaryShield: true },
  });
  expect(result.minions).toEqual({
    firstSpawnCount: 3,
    secondSpawnCount: 0,
    liveCount: 3,
    ordinarySelfDestruct: true,
  });
  expect(result.transitionShieldImpact).toMatchObject({
    absorbed: true,
    excludeFromExplosion: true,
    shieldHit: false,
    transitionProtected: true,
    shieldHitsRemaining: 2,
  });
  expect(result.transitionShield).toEqual({ active: true, hits: 2 });
  expect(result.firstShieldImpact).toMatchObject({
    absorbed: true,
    excludeFromExplosion: true,
    shieldHit: true,
    shieldBroken: false,
    shieldHitsRemaining: 1,
  });
  expect(result.shieldAfterFirstImpact).toEqual({ active: true, hits: 1 });
  expect(result.secondShieldImpact).toMatchObject({
    absorbed: true,
    excludeFromExplosion: true,
    shieldHit: true,
    shieldBroken: true,
    shieldHitsRemaining: 0,
  });
  expect(result.shieldAfterSecondImpact).toMatchObject({
    active: false,
    hits: 0,
    breakCount: 1,
    stunRemaining: 4,
    mode: 'shieldStun',
    moving: false,
    defenseActive: false,
  });
  expect(result.stun.flatMovement).toBeLessThan(0.0001);
  expect(result.stun.moving).toBe(false);
  expect(result.stun.dealt).toBeGreaterThan(0);
  expect(result.stun.healthLost).toBeGreaterThan(0);
  expect(result.stun.vulnerableMeta).toBe(true);
  expect(result.stun.remaining).toBeCloseTo(3.75, 5);
  expect(result.reformed).toEqual({
    active: true,
    hits: 2,
    visible: true,
    dealt: 0,
    healthLost: 0,
    blockedMeta: true,
  });
  expect(result.blockedRaid).toEqual({ mode: 'raidCast', telegraphs: 9 });
  expect(result.beforeCleanup).toMatchObject({
    mineDropResults: [true, true, true, true, true, true, false, false],
    mineCount: 6,
    raidCount: 9,
    telegraphCount: 9,
    summonCount: 3,
  });
  expect(result.cleanup).toEqual({
    cleaned: true,
    summonsRemaining: 0,
    summonsRemovedFromGame: true,
    summonRootsDetached: true,
    minesRemaining: 0,
    mineMeshesDetached: true,
    telegraphsRemaining: 0,
    telegraphsDetached: true,
    resources: { projectiles: 0, telegraphs: 0, constructs: 0 },
  });
});

test('Overload summon cleanup is update-loop safe and suppressed detonator kills still record boss victory', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=overload-reliquary-deferred-cleanup');
  await waitForGame(page);

  const result = await page.evaluate(() => {
    const game = window.game;
    game.stop();
    game.projectiles.clear('overload-reliquary-deferred-cleanup-reset');
    for (const enemy of [...game.enemies]) game.removeEnemy(enemy);
    game.enemyAttackDirector.owner = null;
    game.enemyAttackDirector.queue = [];
    game.enemyAttackDirector.requestTimes.clear();

    const boss = game.debugSpawnBoss('overloadReliquary').boss;
    boss.debugBoss = false;
    boss._runtimeGame = game;
    boss.bossState.phase = 2;
    boss.bossState.transitionRemaining = 0;
    boss.bossState.interruptRemaining = 0;
    boss.bossState.reliquary.shieldActive = false;
    boss.bossState.reliquary.shieldStunRemaining = 1;
    boss._spawnOverloadDetonators(game, 3);
    const minions = boss._getLiveOverloadDetonators();
    const trigger = minions[minions.length - 1];

    let victories = 0;
    let recordedProfile = null;
    const originalRecordBossVictory = game._recordBossVictory;
    game._recordBossVictory = (enemy) => {
      victories += 1;
      recordedProfile = enemy.bossProfileId;
      return Promise.resolve({ ok: true });
    };
    boss.health = 1;
    trigger.update = () => {
      game.damageEnemy(boss, boss.stats.maxHealth * 10, {
        source: trigger,
        attackKind: 'weaponizedDetonator',
        weaponizedDetonator: true,
        suppressRewards: true,
        armorPierce: 999,
        unblockable: true,
      });
    };

    game._updateEnemies(1 / 60);
    const summary = {
      bossDead: boss.dead,
      victories,
      recordedProfile,
      minionsRemoved: minions.every((enemy) => !game.enemies.includes(enemy)),
      minionRootsDetached: minions.every((enemy) => enemy.root.parent === null),
      summonSetSize: boss.bossState.reliquary.summonedDetonators.size,
      deferredRemovalCount: game._deferredEnemyRemovals?.size ?? 0,
      updateFlagCleared: game._updatingEnemies === false,
    };

    game._recordBossVictory = originalRecordBossVictory;
    boss.debugBoss = true;
    game.removeEnemy(boss);
    return summary;
  });

  expect(result).toEqual({
    bossDead: true,
    victories: 1,
    recordedProfile: 'overloadReliquary',
    minionsRemoved: true,
    minionRootsDetached: true,
    summonSetSize: 0,
    deferredRemovalCount: 0,
    updateFlagCleared: true,
  });
});

test('authored arena patterns keep warning cadence and resource caps at 30, 60, and 120 Hz', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=boss-frame-rate-parity');
  await waitForGame(page);

  const summaries = await page.evaluate(({ profileIds, frameRates }) => {
    const game = window.game;
    game.stop();
    const originalTakeDamage = game.player.takeDamage;
    const originalAddExplosion = game.addExplosion;
    const originalAddParticleBurst = game.addParticleBurst;
    const originalAddHitEffect = game.addHitEffect;
    game.player.takeDamage = () => 0;
    game.addExplosion = () => null;
    game.addParticleBurst = () => null;
    game.addHitEffect = () => null;
    game.player.dead = false;
    const results = [];

    for (const profileId of profileIds) {
      for (const frameRate of frameRates) {
        game.projectiles.clear('boss-frame-rate-reset');
        const spawned = game.debugSpawnBoss(profileId);
        if (!spawned.ok) throw new Error(spawned.message ?? spawned.reason);
        const boss = spawned.boss;
        boss._runtimeGame = game;
        boss.bossState.phase = 2;
        boss.bossState.transitionRemaining = 0;
        boss.bossState.interruptRemaining = 0;
        if (profileId === 'overloadReliquary') {
          boss.root.position.copy(boss._getOverloadArenaCenterTarget(game));
        }
        game.player.root.position.copy(boss.root.position);
        game.player.root.position.z += 4;
        game.player.velocity?.set?.(0, 0, 0);
        boss._ensureArenaConstructs(game);
        boss._startSignaturePattern(game);

        const patternShape = boss.bossState.activeTelegraphs.map((entry) => ({
          kind: entry.kind,
          warning: entry.warning,
          projectile: Boolean(entry.projectile),
          hazard: Boolean(entry.hazard),
          arenaNodeRole: entry.arenaNode?.role ?? null,
        }));
        const initialTelegraphs = boss.bossState.activeTelegraphs.length;
        const fired = [];
        let elapsed = 0;
        let maxProjectiles = 0;
        let maxTelegraphs = initialTelegraphs;
        let maxConstructs = boss.getBossResourceCounts(game).constructs;
        const originalFireTelegraph = boss._fireTelegraph.bind(boss);
        boss._fireTelegraph = (entry, runtimeGame) => {
          fired.push({
            kind: entry.kind,
            warning: entry.warning,
            firedAt: elapsed,
          });
          return originalFireTelegraph(entry, runtimeGame);
        };

        const dt = 1 / frameRate;
        for (let frame = 0; frame < frameRate * 3; frame += 1) {
          elapsed += dt;
          boss._updateArenaObjects(dt, game);
          game.projectiles.update(dt);
          const counts = boss.getBossResourceCounts(game);
          maxProjectiles = Math.max(maxProjectiles, counts.projectiles);
          maxTelegraphs = Math.max(maxTelegraphs, counts.telegraphs);
          maxConstructs = Math.max(maxConstructs, counts.constructs);
        }

        results.push({
          profileId,
          frameRate,
          dt,
          patternShape,
          initialTelegraphs,
          fired,
          remainingTelegraphs: boss.bossState.activeTelegraphs.length,
          maxProjectiles,
          maxTelegraphs,
          maxConstructs,
        });
        boss.dispose();
        boss.root.removeFromParent();
        const index = game.enemies.indexOf(boss);
        if (index >= 0) game.enemies.splice(index, 1);
      }
    }

    game.player.takeDamage = originalTakeDamage;
    game.addExplosion = originalAddExplosion;
    game.addParticleBurst = originalAddParticleBurst;
    game.addHitEffect = originalAddHitEffect;
    game.projectiles.clear('boss-frame-rate-complete');
    return results;
  }, { profileIds: GENERIC_ARENA_PATTERN_PROFILE_IDS, frameRates: BOSS_TEST_FRAME_RATES });

  expect(summaries).toHaveLength(GENERIC_ARENA_PATTERN_PROFILE_IDS.length * BOSS_TEST_FRAME_RATES.length);
  for (const profileId of GENERIC_ARENA_PATTERN_PROFILE_IDS) {
    const profileSummaries = summaries.filter((entry) => entry.profileId === profileId);
    expect(profileSummaries.map((entry) => entry.frameRate)).toEqual(BOSS_TEST_FRAME_RATES);
    const expectedPatternShape = profileSummaries[0].patternShape;
    expect(expectedPatternShape.length, `${profileId} did not author a pattern`).toBeGreaterThan(0);
    for (const summary of profileSummaries) {
      expect(summary.patternShape, `${profileId} changed pattern shape at ${summary.frameRate} Hz`)
        .toEqual(expectedPatternShape);
      expect(summary.fired, `${profileId} did not resolve every telegraph at ${summary.frameRate} Hz`)
        .toHaveLength(summary.initialTelegraphs);
      for (const fired of summary.fired) {
        expect(fired.firedAt + 1e-9, `${profileId} fired early at ${summary.frameRate} Hz`)
          .toBeGreaterThanOrEqual(fired.warning);
        expect(
          fired.firedAt - fired.warning,
          `${profileId} exceeded one-frame warning tolerance at ${summary.frameRate} Hz`,
        ).toBeLessThanOrEqual(summary.dt + 1e-6);
      }
      expect(summary.remainingTelegraphs, `${profileId} retained telegraphs at ${summary.frameRate} Hz`).toBe(0);
      expect(summary.maxProjectiles, `${profileId} projectile cap at ${summary.frameRate} Hz`).toBeLessThanOrEqual(20);
      expect(summary.maxTelegraphs, `${profileId} telegraph cap at ${summary.frameRate} Hz`).toBeLessThanOrEqual(12);
      expect(summary.maxConstructs, `${profileId} construct cap at ${summary.frameRate} Hz`).toBeLessThanOrEqual(8);
    }
  }
});

test('all nine live bosses sustain a simulated 60-second encounter within authored resource caps and clean up', async ({ page }) => {
  test.slow();
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=boss-performance-runtime');
  await waitForGame(page);

  const summaries = await page.evaluate((profileIds) => {
    const game = window.game;
    game.stop();
    const originalTakeDamage = game.player.takeDamage;
    game.player.takeDamage = () => 0;
    game.player.dead = false;
    const results = [];
    for (const profileId of profileIds) {
      const spawned = game.debugSpawnBoss(profileId);
      if (!spawned.ok) throw new Error(spawned.message ?? spawned.reason);
      const boss = spawned.boss;
      boss._runtimeGame = game;
      boss.bossState.arenaCooldown = 0;
      const uniqueGeometryCount = () => {
        const geometries = new Set();
        boss.root.traverse((object) => { if (object.geometry) geometries.add(object.geometry.uuid); });
        return geometries.size;
      };
      const uniqueMaterialCount = () => {
        const materials = new Set();
        boss.root.traverse((object) => {
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (material) materials.add(material.uuid);
          }
        });
        return materials.size;
      };
      const startingGeometry = uniqueGeometryCount();
      const startingMaterials = uniqueMaterialCount();
      let maxProjectiles = 0;
      let maxTelegraphs = 0;
      let maxConstructs = 0;
      let minimumWarning = Number.POSITIVE_INFINITY;
      for (let frame = 0; frame < 60 * 60; frame += 1) {
        boss.update(1 / 60, game);
        game.projectiles.update(1 / 60);
        game._updateTimedEffects(1 / 60);
        game._updateParticles(1 / 60);
        const counts = boss.getBossResourceCounts(game);
        maxProjectiles = Math.max(maxProjectiles, counts.projectiles);
        maxTelegraphs = Math.max(maxTelegraphs, counts.telegraphs);
        maxConstructs = Math.max(maxConstructs, counts.constructs);
        for (const telegraph of boss.bossState.activeTelegraphs) {
          minimumWarning = Math.min(minimumWarning, telegraph.warning);
        }
      }
      const endGeometry = uniqueGeometryCount();
      const endMaterials = uniqueMaterialCount();
      boss.dispose();
      boss.root.removeFromParent();
      const bossIndex = game.enemies.indexOf(boss);
      if (bossIndex >= 0) game.enemies.splice(bossIndex, 1);
      game.projectiles.clear('boss-performance-cleanup');
      results.push({
        profileId,
        maxProjectiles,
        maxTelegraphs,
        maxConstructs,
        minimumWarning,
        startingGeometry,
        endGeometry,
        startingMaterials,
        endMaterials,
        cleanup: boss.getBossResourceCounts(game),
      });
    }
    game.player.takeDamage = originalTakeDamage;
    return results;
  }, BOSS_PROFILE_IDS);

  expect(summaries.map((entry) => entry.profileId)).toEqual(BOSS_PROFILE_IDS);
  for (const summary of summaries) {
    expect(summary.maxProjectiles, summary.profileId).toBeLessThanOrEqual(20);
    expect(summary.maxTelegraphs, summary.profileId).toBeLessThanOrEqual(12);
    expect(summary.maxConstructs, summary.profileId).toBeLessThanOrEqual(8);
    expect(summary.minimumWarning, summary.profileId).toBeGreaterThanOrEqual(0.55);
    expect(summary.endGeometry, summary.profileId).toBe(summary.startingGeometry);
    expect(summary.endMaterials, summary.profileId).toBe(summary.startingMaterials);
    expect(summary.cleanup).toEqual({ projectiles: 0, telegraphs: 0, constructs: 0 });
  }
});

test('player defeat immediately clears boss arena objects, projectiles, and attack ownership', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=boss-player-defeat-cleanup');
  await waitForGame(page);

  const result = await page.evaluate(() => {
    const game = window.game;
    game.stop();
    const boss = game.debugSpawnBoss('highAngleBastion').boss;
    const Vector3 = boss.root.position.constructor;
    boss._runtimeGame = game;
    boss.bossState.phase = 2;
    boss._ensureArenaConstructs(game);
    boss.root.position.copy(boss._getOverloadArenaCenterTarget(game));
    boss._startSignaturePattern(game);
    const origin = boss.root.position.clone();
    const direction = game.player.root.position.clone().sub(origin).setY(0);
    if (direction.lengthSq() <= 0.001) direction.set(0, 0, 1);
    direction.normalize();
    boss._queueLane(game, origin, direction, 12, 0.4, 2, 0.8, { projectile: true });
    boss._spawnCraterHazard(game, origin.clone().add(new Vector3(1.2, 0, 0)), 0.9);
    boss._spawnArenaNode(
      game,
      origin.clone().add(new Vector3(-1.2, 0, 0)),
      'defeatProbe',
      'defeat-cleanup',
    );
    boss._spawnBossProjectile(game, origin, direction, 12, 1);

    game.enemyAttackDirector.owner = null;
    game.enemyAttackDirector.queue = [];
    game.enemyAttackDirector.requestTimes.clear();
    game.enemyAttackDirector.handoffTimer = 0;
    boss.brain.state = 'telegraph';
    const attackLeaseClaimed = game.requestEnemyAttack(boss);
    const isNamedBossArenaObject = (object) => /^reaverbotBoss(?:Arena|Lane|Circle|Crater)/.test(object.name);
    const namedArenaObjects = [];
    game.scene.traverse((object) => {
      if (isNamedBossArenaObject(object)) namedArenaObjects.push(object);
    });
    const projectileObjects = game.projectiles.active
      .filter((projectile) => projectile.source === boss)
      .map((projectile) => projectile.mesh);
    const before = {
      namedArenaObjects: namedArenaObjects.map((object) => object.name),
      resources: boss.getBossResourceCounts(game),
      attackLeaseClaimed,
    };

    game.player.dead = true;
    boss.update(1 / 60, game);
    const lingeringNames = [];
    game.scene.traverse((object) => {
      if (isNamedBossArenaObject(object)) lingeringNames.push(object.name);
    });
    const after = {
      cleaned: boss.bossState.cleaned,
      resources: boss.getBossResourceCounts(game),
      lingeringNames,
      allArenaObjectsDetached: namedArenaObjects.every((object) => object.parent === null),
      allProjectilesDetached: projectileObjects.every((object) => object.parent === null),
      attackOwnerCleared: game.enemyAttackDirector.owner !== boss,
      attackRequestCleared: !game.enemyAttackDirector.requestTimes.has(boss)
        && !game.enemyAttackDirector.queue.includes(boss),
      moving: boss.brain.moving,
      knockbackLength: boss.knockback.length(),
    };

    game.player.dead = false;
    boss.dispose();
    boss.root.removeFromParent();
    const bossIndex = game.enemies.indexOf(boss);
    if (bossIndex >= 0) game.enemies.splice(bossIndex, 1);
    return { before, after };
  });

  expect(result.before.attackLeaseClaimed).toBe(true);
  expect(result.before.namedArenaObjects.length).toBeGreaterThan(0);
  expect(result.before.resources.projectiles).toBeGreaterThan(0);
  expect(result.before.resources.telegraphs).toBeGreaterThan(0);
  expect(result.before.resources.constructs).toBeGreaterThan(0);
  expect(result.after).toMatchObject({
    cleaned: true,
    resources: { projectiles: 0, telegraphs: 0, constructs: 0 },
    lingeringNames: [],
    allArenaObjectsDetached: true,
    allProjectilesDetached: true,
    attackOwnerCleared: true,
    attackRequestCleared: true,
    moving: false,
  });
  expect(result.after.knockbackLength).toBe(0);
});

test('boss disposal releases named arena geometry and material resources without scene remnants', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=boss-resource-disposal');
  await waitForGame(page);

  const result = await page.evaluate(() => {
    const game = window.game;
    game.stop();
    const boss = game.debugSpawnBoss('overloadReliquary').boss;
    boss._runtimeGame = game;
    boss.bossState.phase = 2;
    boss._ensureArenaConstructs(game);
    boss._startSignaturePattern(game);
    const isNamedBossArenaObject = (object) => /^reaverbotBoss(?:Arena|Lane|Circle|Crater)/.test(object.name);
    const namedArenaObjects = [];
    game.scene.traverse((object) => {
      if (isNamedBossArenaObject(object)) namedArenaObjects.push(object);
    });

    const tracked = [];
    for (const [key, resource] of Object.entries(boss.bossResources)) {
      tracked.push({ label: `shared:${key}`, resource });
    }
    for (const [index, resource] of boss.signatureVisual.materials.entries()) {
      tracked.push({ label: `signature:material:${index}`, resource });
    }
    tracked.push(
      { label: 'signature:outerGeometry', resource: boss.signatureVisual.outer.geometry },
      { label: 'signature:braceGeometry', resource: boss.signatureVisual.brace.geometry },
      { label: 'signature:coreGeometry', resource: boss.signatureVisual.core.geometry },
    );
    for (const [index, entry] of boss.bossState.activeTelegraphs.entries()) {
      tracked.push({ label: `telegraph:${index}:material`, resource: entry.object.material });
      if (entry.object.userData.dynamicBossTelegraphGeometry) {
        tracked.push({ label: `telegraph:${index}:geometry`, resource: entry.object.geometry });
      }
    }
    const disposeEvents = new Map(tracked.map(({ resource }) => [resource, 0]));
    for (const { resource } of tracked) {
      resource.addEventListener('dispose', () => {
        disposeEvents.set(resource, (disposeEvents.get(resource) ?? 0) + 1);
      });
    }
    const before = {
      namedArenaObjects: namedArenaObjects.map((object) => object.name),
      trackedResources: tracked.length,
      resources: boss.getBossResourceCounts(game),
    };

    boss.dispose();
    const lingeringNames = [];
    game.scene.traverse((object) => {
      if (isNamedBossArenaObject(object)) lingeringNames.push(object.name);
    });
    const missedDisposals = tracked
      .filter(({ resource }) => (disposeEvents.get(resource) ?? 0) === 0)
      .map(({ label }) => label);
    const after = {
      resources: boss.getBossResourceCounts(game),
      lingeringNames,
      allArenaObjectsDetached: namedArenaObjects.every((object) => object.parent === null),
      missedDisposals,
    };

    boss.root.removeFromParent();
    const bossIndex = game.enemies.indexOf(boss);
    if (bossIndex >= 0) game.enemies.splice(bossIndex, 1);
    return { before, after };
  });

  expect(result.before.namedArenaObjects.length).toBeGreaterThan(0);
  expect(result.before.trackedResources).toBeGreaterThan(0);
  expect(result.before.resources.telegraphs).toBeGreaterThan(0);
  expect(result.before.resources.constructs).toBe(0);
  expect(result.after).toEqual({
    resources: { projectiles: 0, telegraphs: 0, constructs: 0 },
    lingeringNames: [],
    allArenaObjectsDetached: true,
    missedDisposals: [],
  });
});
