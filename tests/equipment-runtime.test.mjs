import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { Player } from '../src/Player.js';
import { CombatSystem } from '../src/CombatSystem.js';
import { ProjectileSystem } from '../src/ProjectileSystem.js';
import { GearLoadout, createFixedArmDescriptor } from '../src/equipment/index.js';
import { ReaverbotEnemy } from '../src/reaverbots/ReaverbotEnemy.js';

const EPSILON = 1e-9;

function approximately(actual, expected, message = undefined) {
  assert.ok(
    Math.abs(actual - expected) <= EPSILON,
    message ?? `Expected ${actual} to be within ${EPSILON} of ${expected}.`,
  );
}

// Production model loading is deliberately irrelevant to these pure runtime
// contracts. The virtual call from Player's constructor resolves this no-op
// override, while retaining the real humanoid, animation, and equipment code.
class RuntimeTestPlayer extends Player {
  _loadCharacterModel() {}
}

function createPlayer(testContext, configureGear = null) {
  const player = new RuntimeTestPlayer();
  testContext.after(() => player.dispose());
  if (configureGear) {
    const loadout = new GearLoadout();
    configureGear(loadout);
    player.applyGearLoadoutState(loadout.snapshot(), { refillBarrier: true });
  }
  return player;
}

function equipDefense(loadout, gearId) {
  assert.equal(loadout.setDefenseUnlocked(true).ok, true);
  assert.equal(loadout.unlock(gearId).ok, true);
  assert.equal(loadout.equip(gearId, 'defense').ok, true);
}

function equipUtility(loadout, gearId, slot = 'utility1') {
  assert.equal(loadout.unlock(gearId).ok, true);
  assert.equal(loadout.equip(gearId, slot).ok, true);
}

test('Barrier absorbs before Reinforced Armor and preserves exact overflow math', (t) => {
  const player = createPlayer(t, (loadout) => equipDefense(loadout, 'barrierGenerator'));
  const healthBefore = player.health;

  const result = player.takeIncomingHit({
    amount: 50,
    source: null,
    guardable: true,
    reactionTier: 0,
  });

  assert.equal(result.contacted, true);
  assert.equal(result.barrierDamage, 40);
  approximately(result.healthDamage, 8.2);
  approximately(healthBefore - player.health, 8.2);
  assert.equal(player.barrier.current, 0);
  assert.equal(player.barrier.broken, true);
  assert.equal(player.barrier.rechargeDelayRemaining, 6);
});

test('Armor changes health damage while Helmet independently changes reactions', (t) => {
  const armorOnly = createPlayer(t, (loadout) => {
    assert.equal(loadout.unequip('helmet').ok, true);
  });
  const helmetOnly = createPlayer(t, (loadout) => {
    assert.equal(loadout.unequip('armor').ok, true);
  });

  const armored = armorOnly.takeIncomingHit({ amount: 10, reactionTier: 1 });
  const stabilized = helmetOnly.takeIncomingHit({ amount: 10, reactionTier: 1 });

  approximately(armored.healthDamage, 8.2);
  assert.equal(armored.resolvedReactionTier, 1);
  assert.equal(stabilized.healthDamage, 10);
  assert.equal(stabilized.resolvedReactionTier, 0);
});

test('a fully absorbed Barrier hit still resolves Helmet momentum but not health-gated status', (t) => {
  const player = createPlayer(t, (loadout) => equipDefense(loadout, 'barrierGenerator'));

  const result = player.takeIncomingHit({
    amount: 20,
    reactionTier: 2,
    statusEffects: [{ id: 'burn' }],
  });

  assert.equal(result.barrierDamage, 20);
  assert.equal(result.healthDamage, 0);
  assert.equal(result.resolvedReactionTier, 1);
  assert.equal(result.statusEligible, false);
  assert.equal(player.burnTimer, 0);
});

test('Guard Projector uses authored parry/guard windows and fixed reductions', (t) => {
  const parryPlayer = createPlayer(t, (loadout) => equipDefense(loadout, 'guardProjector'));
  assert.equal(parryPlayer.startShieldGuard(), true);
  assert.equal(parryPlayer.guardDuration, 0.7);
  assert.equal(parryPlayer.guardTimer, 0.7);
  assert.equal(parryPlayer.guardParryTimer, 0.18);
  assert.equal(parryPlayer.guardCooldown, 0.82);

  const parried = parryPlayer.takeIncomingHit({
    amount: 100,
    reactionTier: 3,
    source: { applyStatus() {} },
  });
  assert.equal(parried.guarded, true);
  assert.equal(parried.parried, true);
  approximately(parried.healthDamage, 8.2, '90% parry reduction must precede Armor.');
  assert.equal(parried.resolvedReactionTier, 0);

  const guardPlayer = createPlayer(t, (loadout) => equipDefense(loadout, 'guardProjector'));
  assert.equal(guardPlayer.startShieldGuard(), true);
  guardPlayer._updateShieldGuardState(0.18);
  assert.equal(guardPlayer.isShieldGuarding(), true);
  assert.equal(guardPlayer.isShieldParrying(), false);

  const guarded = guardPlayer.takeIncomingHit({ amount: 100, reactionTier: 3 });
  assert.equal(guarded.guarded, true);
  assert.equal(guarded.parried, false);
  approximately(guarded.healthDamage, 32.8, '60% guard reduction must precede Armor.');
  assert.equal(guarded.resolvedReactionTier, 0);
});

test('Barrier uses 4.5s normal delay, 6s broken delay, and 10 capacity per second', (t) => {
  const player = createPlayer(t, (loadout) => equipDefense(loadout, 'barrierGenerator'));

  player.takeIncomingHit({ amount: 10, reactionTier: 0 });
  assert.equal(player.barrier.current, 30);
  assert.equal(player.barrier.rechargeDelayRemaining, 4.5);
  player._updateBarrierState(4.49);
  assert.equal(player.barrier.current, 30);
  assert.ok(player.barrier.rechargeDelayRemaining > 0);

  player.refillBarrier();
  player.takeIncomingHit({ amount: 10, reactionTier: 0 });
  player._updateBarrierState(4.5);
  assert.equal(player.barrier.current, 30, 'The recharge-delay frame must not also recharge.');
  player._updateBarrierState(0.1);
  approximately(player.barrier.current, 31);

  player.barrier.rechargeDelayRemaining = 0;
  player._updateBarrierState(1);
  assert.equal(player.barrier.current, 40);
  assert.equal(player.barrier.recharging, false);

  player.refillBarrier();
  player.takeIncomingHit({ amount: 50, reactionTier: 0 });
  assert.equal(player.barrier.current, 0);
  assert.equal(player.barrier.rechargeDelayRemaining, 6);
  player._updateBarrierState(5.99);
  assert.equal(player.barrier.current, 0);
  player.takeIncomingHit({ amount: 1, reactionTier: 0 });
  assert.equal(player.barrier.rechargeDelayRemaining, 6, 'Health hits while broken reset the delay.');
});

test('crafted Jump Springs change only ordinary vertical reach from 1.65 to 2.145', (t) => {
  const player = createPlayer(t);
  const baseMoveSpeed = player.stats.moveSpeed;
  approximately(player.getJumpReachHeight(), 1.65);

  const loadout = new GearLoadout(player.gearLoadout.snapshot());
  assert.equal(loadout.unlock('jumpSprings').ok, true);
  assert.equal(loadout.equip('jumpSprings', 'mobility').ok, true);
  player.applyGearLoadoutState(loadout.snapshot());

  approximately(player.getJumpReachHeight(), 2.145);
  assert.equal(player.stats.moveSpeed, baseMoveSpeed);
});

test('Heat Resist blocks tagged environmental heat but not enemy Thermal damage', (t) => {
  const player = createPlayer(t, (loadout) => equipUtility(loadout, 'heatResistChip'));
  const healthBefore = player.health;

  const floor = player.takeIncomingHit({
    amount: 10,
    hazardDomain: 'environment',
    hazardTags: ['environmentalHeat', 'fireFloor'],
    reactionTier: 0,
    statusEffects: ['burn'],
  });
  assert.equal(floor.immune, true);
  assert.equal(floor.healthDamage, 0);
  assert.equal(player.health, healthBefore);
  assert.equal(player.burnTimer, 0);

  const enemyThermal = player.takeIncomingHit({
    amount: 10,
    hazardDomain: 'combat',
    hazardTags: ['environmentalHeat'],
    reactionTier: 0,
    statusEffects: [{ id: 'burn', duration: 2.5, damagePerSecond: 3 }],
  });
  assert.equal(enemyThermal.immune, false);
  approximately(enemyThermal.healthDamage, 8.2);
  assert.equal(player.burnTimer, 2.5);

  const omittedDomain = player.takeIncomingHit({
    amount: 1,
    hazardTags: ['fireFloor'],
    reactionTier: 0,
  });
  assert.equal(omittedDomain.immune, false, 'Heat immunity requires an explicit environment domain.');
});

test('IncomingHit direction controls frontal Guard Projector eligibility', (t) => {
  const frontPlayer = createPlayer(t, (loadout) => equipDefense(loadout, 'guardProjector'));
  frontPlayer.lastMoveDirection.set(0, 0, 1);
  assert.equal(frontPlayer.startShieldGuard(), true);
  const frontal = frontPlayer.takeIncomingHit({
    amount: 10,
    direction: { x: 0, y: 0, z: -1 },
    reactionTier: 1,
  });
  assert.equal(frontal.guarded, true);

  const rearPlayer = createPlayer(t, (loadout) => equipDefense(loadout, 'guardProjector'));
  rearPlayer.lastMoveDirection.set(0, 0, 1);
  assert.equal(rearPlayer.startShieldGuard(), true);
  const rear = rearPlayer.takeIncomingHit({
    amount: 10,
    direction: { x: 0, y: 0, z: 1 },
    reactionTier: 1,
  });
  assert.equal(rear.guarded, false);
});

test('Jet Skates preserve sprint momentum through wind-up and accelerate to the fixed cap', (t) => {
  const player = createPlayer(t, (loadout) => equipUtility(loadout, 'jetSkates'));
  const sprintSpeed = player._getTunedForwardSpeed() * 2.25;

  assert.equal(player._updateJetSkateBoost(0.34, {
    sprintInputHeld: true,
    moving: true,
    translatingInput: true,
    forwardInput: 1,
  }), null);
  const activationSpeed = player._updateJetSkateBoost(0.01, {
    sprintInputHeld: true,
    moving: true,
    translatingInput: true,
    forwardInput: 1,
  });
  approximately(activationSpeed, sprintSpeed);

  const accelerated = player._updateJetSkateBoost(0.1, {
    sprintInputHeld: true,
    moving: true,
    translatingInput: true,
    forwardInput: 1,
  });
  approximately(accelerated, Math.min(18, sprintSpeed + 2));
  player._updateJetSkateBoost(1, {
    sprintInputHeld: true,
    moving: true,
    translatingInput: true,
    forwardInput: 1,
  });
  assert.equal(player.jetSkateState.speed, 18);
  assert.equal(player.gearEffects.jetSkates.ledgeVerticalImpulse, 2.8);

  assert.equal(player._updateJetSkateBoost(0.016, { sprintInputHeld: false }), null);
  assert.equal(player.jetSkateState.active, false);
  assert.equal(player.jetSkateState.speed, 0);
});

test('Barrier-absorbed projectiles register contact without running health-gated hooks', (t) => {
  const player = createPlayer(t, (loadout) => equipDefense(loadout, 'barrierGenerator'));
  const healthBefore = player.health;
  let onHealthHitCalls = 0;
  let contactEffects = 0;
  let hitStops = 0;
  let damageNumbers = 0;
  const source = {
    onHitPlayer() {
      onHealthHitCalls += 1;
    },
  };
  const game = {
    player,
    addDamageNumber() {
      damageNumbers += 1;
    },
    addHitEffect() {
      contactEffects += 1;
    },
    requestHitStop() {
      hitStops += 1;
    },
    addExplosion() {},
  };
  const projectiles = new ProjectileSystem(game);
  const projectile = {
    collisionRadius: 0.2,
    radius: 0.2,
    mesh: {
      position: player.root.position.clone().add(new THREE.Vector3(0, 1, 0)),
    },
    damage: 20,
    source,
    direction: new THREE.Vector3(0, 0, 1),
    visualType: 'electricOrb',
    attackMeta: null,
    explosiveRadius: 0,
    persistentOnPlayerHit: true,
    playerHitCooldown: 0,
    hitInterval: 0.36,
    playerHitCount: 0,
    maxPlayerHits: 7,
  };

  assert.equal(projectiles._checkPlayerHit(projectile), false);
  assert.equal(player.barrier.current, 20);
  assert.equal(player.health, healthBefore);
  assert.equal(onHealthHitCalls, 0);
  assert.equal(damageNumbers, 0);
  assert.equal(contactEffects, 1);
  assert.equal(hitStops, 1);
  assert.equal(projectile.playerHitCount, 1);
  assert.equal(projectile.playerHitCooldown, 0.36);

  assert.equal(projectiles._checkPlayerHit(projectile), false);
  assert.equal(player.barrier.current, 20, 'Persistent projectile cooldown prevents an immediate second Barrier hit.');
  assert.equal(contactEffects, 1);
});

test('Barrier-absorbed melee body contact starts cooldown and cannot double-hit next tick', (t) => {
  const player = createPlayer(t, (loadout) => equipDefense(loadout, 'barrierGenerator'));
  player.root.position.set(0.5, 0, 0);
  const healthBefore = player.health;
  let onHealthHitCalls = 0;
  let retreats = 0;
  let contactEffects = 0;
  const weapon = {
    tags: ['melee'],
    continuousContactDamage: false,
    bodyContactDamageScale: 1,
    bodyContactHitInterval: 0.72,
    bodyContactKnockback: 0.86,
  };
  const enemy = {
    root: {
      position: new THREE.Vector3(0, 0, 0),
      rotation: { y: 0 },
    },
    radius: 0.75,
    collisionHeight: 1.8,
    dead: false,
    stats: { damage: 16 },
    genome: {
      modules: { weapon },
      palette: { emissive: 0xff3344 },
    },
    brain: {
      state: 'position',
      attackDirection: new THREE.Vector3(1, 0, 0),
      contactCooldown: 0,
    },
    _isClawCarrier: () => false,
    isExternalMotionActive: () => false,
    _tryMeleeBodyContact: ReaverbotEnemy.prototype._tryMeleeBodyContact,
    onHitPlayer() {
      onHealthHitCalls += 1;
    },
    beginContactRetreat() {
      retreats += 1;
    },
  };
  const game = {
    player,
    addHitEffect() {
      contactEffects += 1;
    },
    requestHitStop() {},
  };

  ReaverbotEnemy.prototype._updatePersistentWeaponContact.call(enemy, 0, game);
  assert.equal(player.barrier.current, 24);
  assert.equal(player.health, healthBefore);
  assert.equal(enemy.brain.contactCooldown, 0.72);
  assert.equal(onHealthHitCalls, 0);
  assert.equal(retreats, 1);
  assert.equal(contactEffects, 1);

  ReaverbotEnemy.prototype._updatePersistentWeaponContact.call(enemy, 0.1, game);
  assert.equal(player.barrier.current, 24, 'The body-contact cooldown prevents a duplicate overlap hit.');
  approximately(enemy.brain.contactCooldown, 0.62);
  assert.equal(retreats, 1);
});

test('Fast-Swap Adapter replaces, rather than adds to, the arm transition time', (t) => {
  const player = createPlayer(t);
  assert.equal(player.gearEffects.armSwapTransitionTime, 0.34);

  player.armHotbar[0] = createFixedArmDescriptor('megaBuster');
  player.armHotbar[1] = createFixedArmDescriptor('laserBeamBlade');
  const game = {
    player,
    getActiveBusterPlan: () => null,
    getBusterPlanForSlot: () => null,
  };
  const combat = new CombatSystem(game);
  assert.equal(combat.switchArmSlot(1), true);
  assert.equal(combat.swapTimer, 0.34);

  const loadout = new GearLoadout(player.gearLoadout.snapshot());
  equipUtility(loadout, 'fastSwapAdapter');
  player.applyGearLoadoutState(loadout.snapshot());

  assert.equal(player.gearEffects.armSwapTransitionTime, 0.14);
  assert.equal(player.stats.swapSpeed, 0);
  assert.equal(combat.switchArmSlot(0), true);
  assert.equal(combat.swapTimer, 0.14);
});

test('Arm telemetry reports resolved profile behavior rather than raw local inputs', (t) => {
  const player = createPlayer(t);
  player.armHotbar[1] = createFixedArmDescriptor('laserBeamBlade');
  player.armHotbar[2] = createFixedArmDescriptor('machineGunArm');
  const combat = new CombatSystem({
    player,
    getBusterPlanForSlot: () => null,
  });

  const blade = combat.getResolvedArmTelemetry(1);
  assert.equal(blade.damage, 29.9);
  assert.equal(blade.effectiveRange, '2.82m');
  assert.equal(blade.cadence, '1.16/s');
  assert.deepEqual(blade.modes, ['Beam Blade']);

  const machineGun = combat.getResolvedArmTelemetry(2);
  assert.equal(machineGun.damage, 10.2);
  assert.equal(machineGun.effectiveRange, '12.17m');
  assert.equal(machineGun.cadence, '2.94/s');
  assert.notEqual(machineGun.damage, player.armHotbar[2].combatStats.pwr);
  assert.notEqual(machineGun.cadence, `${player.armHotbar[2].combatStats.rpd}/s`);
});
