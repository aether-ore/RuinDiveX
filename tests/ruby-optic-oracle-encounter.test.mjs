import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  getRubyAscensionTraversalDiagnostics,
  RUBY_ASCENSION_LAYOUT,
  RUBY_ORACLE_TUNING,
  RUBY_PLANETARIUM_LAYOUT,
} from '../src/reaverbots/bosses/RubyOpticOracleEncounter.js';
import {
  RUBY_LENS_STATES,
  RubyOrbitalLens,
} from '../src/reaverbots/bosses/RubyOrbitalLens.js';
import { RubyBeamPath } from '../src/reaverbots/bosses/RubyBeamPath.js';

function createLensHarness() {
  const scene = new THREE.Scene();
  const owner = {
    id: 'ruby-test-owner',
    dead: false,
    root: new THREE.Group(),
  };
  scene.add(owner.root);
  const dynamicPlatformingPlatforms = [];
  const lockOn = { target: null, progress: 0.63 };
  const game = {
    scene,
    dynamicPlatformingPlatforms,
    player: {
      root: new THREE.Group(),
      radius: 0.42,
      collisionHeight: 2.85,
      jumpState: 'Grounded',
      dead: false,
      isJumpAirborne: () => false,
      isPowerKnockbackActive: () => false,
    },
    dungeonController: { lastSafePlayerPosition: new THREE.Vector3() },
    combat: {
      lockOn,
      transferLockOnTarget(from, to) {
        if (lockOn.target === from) lockOn.target = to;
      },
    },
    registerDynamicPlatformingSurface(surface) {
      if (!dynamicPlatformingPlatforms.includes(surface)) dynamicPlatformingPlatforms.push(surface);
      return true;
    },
    unregisterDynamicPlatformingSurface(surface) {
      const index = dynamicPlatformingPlatforms.indexOf(surface);
      if (index >= 0) dynamicPlatformingPlatforms.splice(index, 1);
      return index >= 0;
    },
    getPlatformSupport(position) {
      const surface = dynamicPlatformingPlatforms.find((candidate) => (
        candidate.enabled
        && candidate.containsTop(position)
        && Math.abs(position.y - candidate.topY) <= 0.5
      ));
      return surface ? { surface, elevation: surface.topY } : null;
    },
    addParticleBurst() {},
    addHitEffect() {},
  };
  scene.add(game.player.root);
  const knocked = [];
  const lens = new RubyOrbitalLens({
    owner,
    index: 0,
    tier: 'lower',
    size: RUBY_ASCENSION_LAYOUT.lower.size,
    arenaCenter: new THREE.Vector3(),
    orbitRadius: RUBY_ASCENSION_LAYOUT.lower.radius,
    orbitHeight: RUBY_ASCENSION_LAYOUT.lower.height,
    orbitDirection: 1,
    angularSpeed: RUBY_ASCENSION_LAYOUT.lower.speed,
    angularPosition: 0,
    onKnockedDown: (entry) => knocked.push(entry),
  });
  lens.mount(game);
  return { game, lens, owner, knocked };
}

test('Ruby ascension layout stays within the shared traversal envelope at every sampled alignment', () => {
  const diagnostics = getRubyAscensionTraversalDiagnostics({ samples: 72 });
  assert.equal(diagnostics.reachable, true);
  assert.ok(diagnostics.minimumLowerMiddleRoutes >= 2);
  assert.ok(diagnostics.minimumMiddleUpperRoutes >= 1);
  assert.ok(diagnostics.maximumRequiredHorizontalGap <= diagnostics.horizontalLimit);
  assert.ok(diagnostics.maximumRequiredVerticalRise <= diagnostics.verticalLimit);
  assert.ok(RUBY_ASCENSION_LAYOUT.upper.size * 2 >= diagnostics.minimumLandingWidth);
});

test('Ruby planetarium lanes remain airborne and separated throughout their orbit', () => {
  const visualRadius = (layout) => layout.size * 0.97;
  const positionAt = (layout, seconds) => {
    const angle = layout.angle + layout.direction * layout.speed * seconds;
    return new THREE.Vector3(
      Math.cos(angle) * layout.radius,
      layout.height + Math.sin(angle) * layout.verticalAmplitude,
      Math.sin(angle) * layout.radius,
    );
  };
  let minimumClearance = Infinity;
  let minimumHeight = Infinity;
  let maximumHeight = -Infinity;
  for (let sample = 0; sample <= 1200; sample += 1) {
    const seconds = sample * 0.1;
    const positions = RUBY_PLANETARIUM_LAYOUT.map((layout) => positionAt(layout, seconds));
    for (let index = 0; index < positions.length; index += 1) {
      minimumHeight = Math.min(minimumHeight, positions[index].y);
      maximumHeight = Math.max(maximumHeight, positions[index].y);
      for (let other = index + 1; other < positions.length; other += 1) {
        minimumClearance = Math.min(
          minimumClearance,
          positions[index].distanceTo(positions[other])
            - visualRadius(RUBY_PLANETARIUM_LAYOUT[index])
            - visualRadius(RUBY_PLANETARIUM_LAYOUT[other]),
        );
      }
    }
  }

  assert.ok(minimumHeight > 1.3, `lowest inert lens was only ${minimumHeight.toFixed(3)} above the floor`);
  assert.ok(maximumHeight - minimumHeight > 5, 'the inert formation must span the observatory vertically');
  assert.ok(minimumClearance > 0.18, `ordinary lens clearance fell to ${minimumClearance.toFixed(3)}`);
});

test('Ruby tuning preserves the authored beam, interruption, and ultimate timing contract', () => {
  assert.deepEqual(RUBY_ORACLE_TUNING.directBeam, {
    feedTime: 0.45,
    trackingTime: 0.65,
    lockTime: 0.35,
    fireTime: 0.2,
    recoveryTime: 0.85,
    width: 0.34,
    damageScale: 1,
  });
  assert.equal(RUBY_ORACLE_TUNING.amplifiedBeam.lensStabilityHits, 3);
  assert.equal(RUBY_ORACLE_TUNING.ascension.channelDuration, 11);
  assert.equal(RUBY_ORACLE_TUNING.ascension.interruptHits, 6);
  assert.equal(RUBY_ORACLE_TUNING.ascension.failureDamageHealthScale, 0.75);
  assert.equal(RUBY_ORACLE_TUNING.ascension.repeatCooldown, 25);
});

test('orbital lens carries grounded support and direct-only impacts knock it down in three units', () => {
  const { game, lens, owner, knocked } = createLensHarness();
  const collider = lens.platformCollider;
  assert.equal(collider.createsLedgeCandidates, true);
  assert.equal(collider.ledgeCatchMode, 'instant-step');
  const landingInset = 0.08;
  const usableRadius = collider.radius - landingInset;
  const nearEdge = collider.center.clone().add(new THREE.Vector3(usableRadius + 0.16, 0, 0));
  nearEdge.y = collider.topY;
  const snappedLanding = collider.getLandingSnapPosition(nearEdge, {
    player: game.player,
    inset: landingInset,
    previousRootY: collider.topY + 0.1,
  });
  assert.ok(snappedLanding?.isVector3);
  assert.equal(collider.containsTop(nearEdge, landingInset), false);
  assert.equal(collider.containsTop(snappedLanding, landingInset), true);
  assert.equal(nearEdge.x, collider.center.x + usableRadius + 0.16);
  const tooFar = collider.center.clone().add(new THREE.Vector3(usableRadius + 0.24, 0, 0));
  tooFar.y = collider.topY;
  assert.equal(collider.getLandingSnapPosition(tooFar, {
    player: game.player,
    inset: landingInset,
    previousRootY: collider.topY + 0.1,
  }), null);

  game.player.root.position.copy(collider.center);
  game.player.root.position.y = collider.topY;
  game.dungeonController.lastSafePlayerPosition.copy(game.player.root.position);

  const before = game.player.root.position.clone();
  lens.prePlayerUpdate(0.5, game);
  assert.equal(lens.supportingPlayer, true);
  assert.ok(game.player.root.position.distanceTo(before) > 0.2);
  assert.equal(game.player.root.position.y, collider.topY);
  assert.equal(game.dungeonController.lastSafePlayerPosition.distanceTo(game.player.root.position), 0);

  lens.beginActivation();
  game.combat.lockOn.target = lens.combatTarget;
  assert.equal(lens.receiveDirectImpact({ explosionSplash: true, areaDamage: true, amount: 99 }, game), false);
  assert.equal(lens.stabilityHits, 0);
  assert.equal(lens.receiveDirectImpact({ projectileHit: true, amount: 1, executionId: 'shot-1' }, game), true);
  assert.equal(lens.receiveDirectImpact({ projectileHit: true, amount: 1, executionId: 'shot-1' }, game), false);
  assert.equal(lens.receiveDirectImpact({ directHit: true, mirrorImpactUnits: 2, amount: 1 }, game), true);
  assert.equal(lens.state, RUBY_LENS_STATES.KNOCKED_DOWN);
  assert.equal(knocked.length, 1);
  assert.equal(game.combat.lockOn.target, owner);

  lens.dispose(game);
  assert.equal(game.dynamicPlatformingPlatforms.length, 0);
  assert.equal(lens.orbitPivot.parent, null);
});

test('locked beam anchors stay live, firing collision persists, and cancellation frees resources immediately', () => {
  const scene = new THREE.Scene();
  const start = new THREE.Vector3(0, 1, 0);
  const end = new THREE.Vector3(0, 1, 4);
  let hitCount = 0;
  const game = {
    player: {
      root: new THREE.Group(),
      radius: 0.42,
      collisionHeight: 2.85,
      dead: false,
      takeDamage(amount) {
        hitCount += 1;
        return amount;
      },
    },
  };
  game.player.root.position.set(3, 0, 2);
  const path = new RubyBeamPath({
    owner: { id: 'ruby-beam-owner' },
    scene,
    role: 'persistent-hit-test',
    damage: 12,
    fireDuration: 0.3,
    segments: [{
      getStart: (out) => out.copy(start),
      getEnd: (out) => out.copy(end),
      width: 0.3,
      damaging: true,
    }],
  });
  path.lock();
  start.x = 1;
  end.x = 1;
  path.update(0.01, game);
  assert.equal(path.segments[0].start.x, 1);
  assert.equal(path.segments[0].end.x, 1);

  assert.equal(path.fire(game), false);
  game.player.root.position.set(1, 0, 2);
  path.update(0.05, game);
  path.update(0.05, game);
  assert.equal(hitCount, 1);
  assert.equal(path.hitPlayer, true);
  assert.equal(path.complete, false);
  assert.equal(path.root.parent, scene);
  path.dispose();

  const cancelled = new RubyBeamPath({
    owner: { id: 'ruby-beam-owner' },
    scene,
    role: 'immediate-cancel-test',
    damage: 0,
    segments: [{
      getStart: (out) => out.set(0, 0, 0),
      getEnd: (out) => out.set(0, 0, 1),
      damaging: false,
    }],
  });
  assert.equal(cancelled.root.parent, scene);
  assert.equal(cancelled.cancel('lens-knocked-down'), true);
  assert.equal(cancelled.root.parent, null);
  assert.equal(cancelled.materials.size, 0);
  assert.equal(cancelled.getTelegraphCount(), 0);
});

test('overlapping orbital lenses inherit player motion from exactly one resolved support', () => {
  const { game, lens: first, owner } = createLensHarness();
  const second = new RubyOrbitalLens({
    owner,
    index: 1,
    tier: 'lower',
    size: RUBY_ASCENSION_LAYOUT.lower.size,
    arenaCenter: new THREE.Vector3(),
    orbitRadius: RUBY_ASCENSION_LAYOUT.lower.radius,
    orbitHeight: RUBY_ASCENSION_LAYOUT.lower.height,
    orbitDirection: 1,
    angularSpeed: RUBY_ASCENSION_LAYOUT.lower.speed,
    angularPosition: 0,
  });
  second.mount(game);
  game.player.root.position.copy(first.platformCollider.center);
  game.player.root.position.y = first.platformCollider.topY;
  game.dungeonController.lastSafePlayerPosition.copy(game.player.root.position);

  first.prePlayerUpdate(0.5, game);
  const afterResolvedSupport = game.player.root.position.clone();
  second.prePlayerUpdate(0.5, game);
  assert.equal(first.supportingPlayer, true);
  assert.equal(second.supportingPlayer, false);
  assert.equal(game.player.root.position.distanceTo(afterResolvedSupport), 0);

  first.dispose(game);
  second.dispose(game);
  assert.equal(game.dynamicPlatformingPlatforms.length, 0);
});
