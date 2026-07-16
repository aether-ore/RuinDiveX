import * as THREE from 'three';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../../TraversalCapabilities.js';
import { RubyBeamPath } from './RubyBeamPath.js';
import { RubyCeilingEmitter } from './RubyCeilingEmitter.js';
import { RUBY_LENS_STATES, RubyOrbitalLens } from './RubyOrbitalLens.js';

export const RUBY_ORACLE_TUNING = Object.freeze({
  directBeam: Object.freeze({
    feedTime: 0.45,
    trackingTime: 0.65,
    lockTime: 0.35,
    fireTime: 0.2,
    recoveryTime: 0.85,
    width: 0.34,
    damageScale: 1,
  }),
  amplifiedBeam: Object.freeze({
    activationTime: 0.65,
    lensRaiseTime: 0.45,
    lockTime: 0.45,
    fireTime: 0.3,
    width: 1.15,
    damageScale: 1.7,
    lensStabilityHits: 3,
  }),
  ascension: Object.freeze({
    initialDelay: 1.5,
    channelDuration: 11,
    platformHazardInterval: 2.5,
    interruptHealthScale: 0.09,
    interruptHits: 6,
    successStaggerTime: 4.5,
    failureDamageHealthScale: 0.75,
    repeatCooldown: 25,
  }),
});

export const RUBY_ASCENSION_LAYOUT = Object.freeze({
  lower: Object.freeze({
    count: 3,
    radius: 4.7,
    height: 1.35,
    direction: 1,
    speed: 0.31,
    size: 1.55,
    verticalAmplitude: 0,
  }),
  middle: Object.freeze({
    count: 2,
    radius: 3.25,
    height: 3.2,
    direction: -1,
    speed: 0.42,
    size: 1.3,
    verticalAmplitude: 0,
  }),
  upper: Object.freeze({
    count: 1,
    radius: 1.65,
    height: 5.15,
    direction: 1,
    speed: 0.53,
    size: 1.05,
    verticalAmplitude: 0,
  }),
});

const PHASE_ONE_ATTACK_DECK = Object.freeze(['directBeam', 'singleLens', 'shutterFlash', 'directBeam']);
const PHASE_TWO_ATTACK_DECK = Object.freeze([
  'directBeam',
  'crossingReflection',
  'refractionCascade',
  'singleLens',
  'shutterFlash',
  'directBeam',
]);
export const RUBY_PLANETARIUM_LAYOUT = Object.freeze([
  Object.freeze({ tier: 'lower', size: 1.55, radius: 4.9, height: 1.7, verticalAmplitude: 0.25, direction: 1, speed: 0.16, angle: 0.2 }),
  Object.freeze({ tier: 'lower', size: 1.55, radius: 4.9, height: 1.7, verticalAmplitude: 0.25, direction: 1, speed: 0.16, angle: 0.2 + Math.PI * 2 / 3 }),
  Object.freeze({ tier: 'lower', size: 1.55, radius: 4.9, height: 1.7, verticalAmplitude: 0.25, direction: 1, speed: 0.16, angle: 0.2 + Math.PI * 4 / 3 }),
  Object.freeze({ tier: 'middle', size: 1.3, radius: 2.45, height: 4.05, verticalAmplitude: 0.3, direction: -1, speed: 0.21, angle: Math.PI * 0.5 }),
  Object.freeze({ tier: 'middle', size: 1.3, radius: 2.45, height: 4.05, verticalAmplitude: 0.3, direction: -1, speed: 0.21, angle: Math.PI * 1.5 }),
  Object.freeze({ tier: 'upper', size: 1.05, radius: 1.1, height: 6.65, verticalAmplitude: 0.2, direction: 1, speed: 0.27, angle: 0 }),
]);

const CHANNEL_CORE_PART_PREFIX = 'rubyOracleChannelCore:';
const MAX_TELEGRAPH_SEGMENTS = 12;
const ASCENSION_FALL_TIME = Object.freeze({ success: 0.72, failure: 0.68 });
const STOCK_BOSS_FIXTURE_NAMES = new Set([
  'bossArenaContainmentPylon',
  'bossArenaWarningCore',
  'bossArenaSignalRail',
  'bossArenaCentralBeacon',
  'bossRoomColossalEngine',
  'bossRoomLoadBearingGirder',
]);
const UP = new THREE.Vector3(0, 1, 0);
const tempA = new THREE.Vector3();
const tempB = new THREE.Vector3();
const tempC = new THREE.Vector3();
const tempD = new THREE.Vector3();

function clamp01(value) {
  return THREE.MathUtils.clamp(Number(value) || 0, 0, 1);
}

function flatDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function shortestAngleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function lineHit(point, start, direction, range, radius) {
  tempA.copy(point).sub(start);
  const along = tempA.dot(direction);
  if (along < 0 || along > range) return null;
  const perpendicularSq = Math.max(0, tempA.lengthSq() - along * along);
  return perpendicularSq <= radius * radius ? along : null;
}

function disposeOwnedTree(root) {
  if (!root) return;
  const geometries = new Set();
  const materials = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) if (material) materials.add(material);
  });
  root.removeFromParent();
  geometries.forEach((geometry) => geometry.dispose?.());
  materials.forEach((material) => material.dispose?.());
}

function createObservatoryFixtures(center, ceilingY) {
  const root = new THREE.Group();
  root.name = 'rubyOracleObservatoryArena';
  root.position.copy(center);
  root.userData.rubyOracleObservatory = true;

  const dark = new THREE.MeshStandardMaterial({
    color: 0x171619,
    emissive: 0x180006,
    emissiveIntensity: 0.12,
    roughness: 0.54,
    metalness: 0.68,
  });
  dark.name = 'material_rubyObservatoryDark';
  const gold = new THREE.MeshStandardMaterial({
    color: 0xc5a65d,
    emissive: 0x5b2307,
    emissiveIntensity: 0.32,
    roughness: 0.31,
    metalness: 0.84,
  });
  gold.name = 'material_rubyObservatoryGold';
  const ruby = new THREE.MeshBasicMaterial({
    color: 0xff244f,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  ruby.name = 'material_rubyObservatoryEnergy';
  const orbitGuide = new THREE.MeshBasicMaterial({
    color: 0xff315f,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  orbitGuide.name = 'material_rubyObservatoryPlanetariumGuide';

  const dais = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.38, 0.1, 48), dark);
  dais.name = 'rubyObservatoryCentralDais';
  dais.position.y = 0.05;
  dais.receiveShadow = true;
  root.add(dais);

  for (const radius of [1.65, 3.25, 4.7, 6.25]) {
    const material = radius === 4.7 ? ruby : gold;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, radius === 4.7 ? 0.045 : 0.032, 8, 96), material);
    ring.name = `rubyObservatoryOrbitRing_${radius}`;
    ring.rotation.x = Math.PI * 0.5;
    ring.position.y = 0.055;
    root.add(ring);
  }

  const tierGuides = new Map();
  for (const layout of RUBY_PLANETARIUM_LAYOUT) {
    if (tierGuides.has(layout.tier)) continue;
    tierGuides.set(layout.tier, layout);
    const guide = new THREE.Mesh(
      new THREE.TorusGeometry(layout.radius, 0.018, 6, 96),
      orbitGuide,
    );
    guide.name = `rubyObservatoryPlanetariumRing_${layout.tier}`;
    guide.rotation.x = Math.PI * 0.5;
    guide.position.y = layout.height - Math.max(0.12, layout.size * 0.13);
    guide.renderOrder = 3;
    root.add(guide);
  }

  for (let index = 0; index < 12; index += 1) {
    const angle = index / 12 * Math.PI * 2;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.035, 5.9), index % 3 === 0 ? ruby : gold);
    rail.name = `rubyObservatoryFocusingRail_${index}`;
    rail.position.set(Math.sin(angle) * 2.95, 0.05, Math.cos(angle) * 2.95);
    rail.rotation.y = angle;
    root.add(rail);

    // Keep the third-person sightline open: six high supports imply the
    // observatory cage without placing a dense picket fence between camera
    // and combatants at ground level.
    if (index % 2 === 0) {
      const pillarBaseY = 2.75;
      const pillarHeight = Math.max(2.5, ceilingY - center.y - pillarBaseY - 0.65);
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.11, pillarHeight, 8), dark);
      pillar.name = `rubyObservatoryPerimeterColumn_${index}`;
      pillar.position.set(
        Math.cos(angle) * 6.65,
        pillarBaseY + pillarHeight * 0.5,
        Math.sin(angle) * 6.65,
      );
      pillar.rotation.y = angle;
      pillar.castShadow = true;
      root.add(pillar);
    }
  }

  const overheadHeight = Math.max(5, ceilingY - center.y - 0.18);
  const overhead = new THREE.Mesh(new THREE.TorusGeometry(6.65, 0.12, 10, 96), gold);
  overhead.name = 'rubyObservatoryCeilingRail';
  overhead.rotation.x = Math.PI * 0.5;
  overhead.position.y = overheadHeight;
  root.add(overhead);

  const darknessMaterial = new THREE.MeshBasicMaterial({
    color: 0x050104,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  darknessMaterial.name = 'material_rubyObservatoryChannelDarkness';
  const darkness = new THREE.Mesh(new THREE.CircleGeometry(6.35, 72), darknessMaterial);
  darkness.name = 'rubyObservatoryChannelDarkness';
  darkness.rotation.x = -Math.PI * 0.5;
  darkness.position.y = 0.065;
  darkness.renderOrder = 2;
  root.add(darkness);

  return { root, darkness, darknessMaterial };
}

function createChannelMeter(scene) {
  const root = new THREE.Group();
  root.name = 'rubyOracleEyeChannelMeter';
  root.visible = false;
  const rings = [];
  for (let index = 0; index < RUBY_ORACLE_TUNING.ascension.interruptHits; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: 0x3d0713,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    material.name = `material_rubyChannelMeter_${index}`;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5 + index * 0.08, 0.018, 7, 36), material);
    ring.name = `rubyOracleChannelMeterRing_${index}`;
    ring.renderOrder = 25;
    root.add(ring);
    rings.push(ring);
  }
  scene.add(root);
  return { root, rings };
}

export function getRubyAscensionTraversalDiagnostics({ samples = 24 } = {}) {
  const horizontalLimit = PLAYER_TRAVERSAL_ENVELOPE.maximumHorizontalJumpDistance * 0.8;
  const verticalLimit = PLAYER_TRAVERSAL_ENVELOPE.maximumLedgeClimbRise * 0.75;
  const platformRadius = (tier) => RUBY_ASCENSION_LAYOUT[tier].size * 0.88;
  let minimumLowerMiddleRoutes = Infinity;
  let minimumMiddleUpperRoutes = Infinity;
  let maximumRequiredHorizontalGap = 0;
  let maximumRequiredVerticalRise = 0;

  for (let middleSample = 0; middleSample < samples; middleSample += 1) {
    const middleOffset = middleSample / samples * Math.PI * 2;
    const lowerAngles = [0, Math.PI * 2 / 3, Math.PI * 4 / 3];
    const middleAngles = [middleOffset, middleOffset + Math.PI];
    let lowerMiddleRoutes = 0;
    for (const lowerAngle of lowerAngles) {
      for (const middleAngle of middleAngles) {
        const centerGap = Math.sqrt(
          RUBY_ASCENSION_LAYOUT.lower.radius ** 2
          + RUBY_ASCENSION_LAYOUT.middle.radius ** 2
          - 2 * RUBY_ASCENSION_LAYOUT.lower.radius * RUBY_ASCENSION_LAYOUT.middle.radius
            * Math.cos(lowerAngle - middleAngle),
        );
        const edgeGap = Math.max(0, centerGap - platformRadius('lower') - platformRadius('middle'));
        const rise = RUBY_ASCENSION_LAYOUT.middle.height - RUBY_ASCENSION_LAYOUT.lower.height;
        if (edgeGap <= horizontalLimit && rise <= verticalLimit) {
          lowerMiddleRoutes += 1;
          maximumRequiredHorizontalGap = Math.max(maximumRequiredHorizontalGap, edgeGap);
          maximumRequiredVerticalRise = Math.max(maximumRequiredVerticalRise, rise);
        }
      }
    }
    minimumLowerMiddleRoutes = Math.min(minimumLowerMiddleRoutes, lowerMiddleRoutes);

    for (let upperSample = 0; upperSample < samples; upperSample += 1) {
      const upperAngle = upperSample / samples * Math.PI * 2;
      let middleUpperRoutes = 0;
      for (const middleAngle of middleAngles) {
        const centerGap = Math.sqrt(
          RUBY_ASCENSION_LAYOUT.middle.radius ** 2
          + RUBY_ASCENSION_LAYOUT.upper.radius ** 2
          - 2 * RUBY_ASCENSION_LAYOUT.middle.radius * RUBY_ASCENSION_LAYOUT.upper.radius
            * Math.cos(middleAngle - upperAngle),
        );
        const edgeGap = Math.max(0, centerGap - platformRadius('middle') - platformRadius('upper'));
        const rise = RUBY_ASCENSION_LAYOUT.upper.height - RUBY_ASCENSION_LAYOUT.middle.height;
        if (edgeGap <= horizontalLimit && rise <= verticalLimit) {
          middleUpperRoutes += 1;
          maximumRequiredHorizontalGap = Math.max(maximumRequiredHorizontalGap, edgeGap);
          maximumRequiredVerticalRise = Math.max(maximumRequiredVerticalRise, rise);
        }
      }
      minimumMiddleUpperRoutes = Math.min(minimumMiddleUpperRoutes, middleUpperRoutes);
    }
  }

  return Object.freeze({
    horizontalLimit,
    verticalLimit,
    minimumLandingWidth: PLAYER_TRAVERSAL_ENVELOPE.minimumLandingWidth,
    minimumLowerMiddleRoutes,
    minimumMiddleUpperRoutes,
    maximumRequiredHorizontalGap,
    maximumRequiredVerticalRise,
    reachable: minimumLowerMiddleRoutes >= 2 && minimumMiddleUpperRoutes >= 1,
  });
}

export class RubyOpticOracleEncounter {
  constructor(owner) {
    this.owner = owner;
    this.initialized = false;
    this.disposed = false;
    this.game = null;
    this.center = new THREE.Vector3();
    this.floorY = 0;
    this.ceilingY = 10;
    this.lenses = [];
    this.paths = [];
    this.emitter = null;
    this.observatory = null;
    this.channelMeter = null;
    this.hiddenStockFixtures = [];
    this.attack = null;
    this.attackCooldown = 2.2;
    this.attackDeckIndex = 0;
    this.attackSerial = 0;
    this.lastAttackType = null;
    this.ceremonyRemaining = 0;
    this.ascensionDue = Infinity;
    this.staggerRemaining = 0;
    this.burstRecoveryRemaining = 0;
    this.burstRecoveryDuration = 1.35;
    this.visualOffsetY = 0;
    this.channelCorePartId = `${CHANNEL_CORE_PART_PREFIX}${owner.id}`;
    this.channelCoreTarget = this._createChannelCoreTarget();
    this._elapsed = 0;
    this._lastPrePlayerElapsed = -1;
  }

  _createChannelCoreTarget() {
    const encounter = this;
    return {
      id: `${this.owner.id}:rubyChannelCore`,
      ownerEnemy: this.owner,
      partId: this.channelCorePartId,
      root: this.owner.root,
      radius: Math.max(0.48, this.owner.radius * 0.42),
      combatAimOffset: 0,
      isWeakPointTarget: true,
      isBossSignatureTarget: true,
      isRubyChannelCoreTarget: true,
      retainLockWhenInactive: false,
      get dead() { return encounter.disposed || encounter.owner.dead; },
      get active() { return encounter.isChannelCoreActive(); },
      getWorldPosition(out) { return encounter.getEyePosition(out); },
    };
  }

  initialize(game) {
    if (this.initialized || this.disposed || !game?.scene) return this.initialized;
    this.game = game;
    this.center.copy(this.owner.encounterArena?.zoneCenter
      ?? this.owner.encounterArena?.center
      ?? this.owner.root.position);
    this.floorY = game.dungeonController?.getSurfaceElevationAt?.(this.center) ?? this.center.y;
    this.center.y = this.floorY;
    const bossRoom = game.dungeon?.rooms?.find?.((room) => room.id === 'bossRoom');
    this.ceilingY = this.floorY + Math.max(9.5, Math.min(14.8, Number(bossRoom?.ceilingHeight) || 10.5));

    this.observatory = createObservatoryFixtures(this.center, this.ceilingY);
    game.scene.add(this.observatory.root);
    this.emitter = new RubyCeilingEmitter({
      owner: this.owner,
      scene: game.scene,
      center: this.center,
      ceilingY: this.ceilingY,
    });
    this.channelMeter = createChannelMeter(game.scene);

    this.lenses = RUBY_PLANETARIUM_LAYOUT.map((layout, index) => {
      const lens = new RubyOrbitalLens({
        owner: this.owner,
        index,
        tier: layout.tier,
        size: layout.size,
        arenaCenter: this.center,
        orbitRadius: layout.radius,
        orbitHeight: layout.height,
        orbitDirection: layout.direction,
        angularSpeed: layout.speed,
        angularPosition: layout.angle,
        verticalAmplitude: layout.verticalAmplitude,
        onKnockedDown: (knockedLens, runtimeGame) => this._onLensKnockedDown(knockedLens, runtimeGame),
      });
      lens.ordinaryLayout = layout;
      lens.mount(game);
      return lens;
    });

    game.scene.traverse((object) => {
      if (!STOCK_BOSS_FIXTURE_NAMES.has(object.name) || object.visible === false) return;
      this.hiddenStockFixtures.push({ object, visible: object.visible });
      object.visible = false;
    });

    this.owner.root.position.set(this.center.x, this.floorY, this.center.z);
    this.initialized = true;
    return true;
  }

  prePlayerUpdate(dt, game) {
    if (!this.initialize(game) || this.disposed || this.owner.dead) return;
    for (const lens of this.lenses) lens.prePlayerUpdate(dt, game);
    this._lastPrePlayerElapsed = this._elapsed;
  }

  update(dt, game) {
    if (!this.initialize(game) || this.disposed || this.owner.dead) return;
    const delta = Math.max(0, Number(dt) || 0);
    this._elapsed += delta;
    this._updateOraclePose(delta, game);
    if (this.owner.bossState.phase === 2 && Number.isFinite(this.ascensionDue)) {
      this.ascensionDue = Math.max(0, this.ascensionDue - delta);
    }
    for (const lens of this.lenses) lens.updateVisual(delta);

    if ((this.owner.bossState?.interruptRemaining ?? 0) > 0) {
      this.attackCooldown = Math.max(
        this.attackCooldown,
        this.owner.bossState.interruptRemaining + 0.15,
      );
      this._updatePaths(delta, game);
      this._updateChannelMeter(game, delta);
      this.emitter?.update(delta, this.getEyePosition(tempA));
      return;
    }

    if (this.ceremonyRemaining > 0) {
      this._updatePhaseCeremony(delta, game);
    } else if (this.attack) {
      this._updateAttack(delta, game);
    } else if (this.staggerRemaining > 0) {
      this.owner.brain.weakPointExposed = true;
      this.staggerRemaining = Math.max(0, this.staggerRemaining - delta);
      this.visualOffsetY = THREE.MathUtils.lerp(this.visualOffsetY, 0, Math.min(1, delta * 5));
      if (this.staggerRemaining <= 0) {
        this.owner.brain.weakPointExposed = false;
        this.attackCooldown = Math.max(this.attackCooldown, 1.1);
      }
    } else if (this.burstRecoveryRemaining > 0) {
      this.burstRecoveryRemaining = Math.max(0, this.burstRecoveryRemaining - delta);
      this._setArenaDarkness(0.55 * this.burstRecoveryRemaining / this.burstRecoveryDuration);
      if (this.burstRecoveryRemaining <= 0) {
        this._setArenaDarkness(0);
        this.attackCooldown = Math.max(this.attackCooldown, 2.2);
      }
    } else {
      this.attackCooldown = Math.max(0, this.attackCooldown - delta);
      if (this.attackCooldown <= 0) this._startNextAttack(game);
    }

    this._updatePaths(delta, game);
    this._updateChannelMeter(game, delta);
    this.emitter?.update(delta, this.getEyePosition(tempA));
  }

  ownsBossPositioning() {
    return true;
  }

  _updateOraclePose(dt, game = this.game) {
    this.owner.root.position.x = this.center.x;
    this.owner.root.position.z = this.center.z;
    this.owner.brain.moving = false;
    tempA.copy(game?.player?.root?.position ?? this.center).sub(this.owner.root.position).setY(0);
    if (tempA.lengthSq() <= 0.0001) return;
    const targetYaw = Math.atan2(tempA.x, tempA.z);
    const turn = shortestAngleDelta(this.owner.root.rotation.y, targetYaw);
    const maximumTurn = Math.max(0, Number(dt) || 0) * 8.5;
    this.owner.root.rotation.y += THREE.MathUtils.clamp(turn, -maximumTurn, maximumTurn);
  }

  _updatePaths(dt, game) {
    for (let index = this.paths.length - 1; index >= 0; index -= 1) {
      const path = this.paths[index];
      path.update(dt, game);
      if (!path.complete) continue;
      for (const lens of this.lenses) lens.associatedTelegraphs.delete(path);
      path.dispose();
      this.paths.splice(index, 1);
    }
  }

  _createPath({ role, damage, fireDuration, segments, visible = true }) {
    this._pruneCompletePaths();
    const requestedSegments = segments.length;
    const activeSegments = this.paths.reduce(
      (sum, path) => sum + (path.complete ? 0 : path.segments.length),
      0,
    );
    if (requestedSegments > MAX_TELEGRAPH_SEGMENTS) {
      throw new RangeError(`Ruby beam path ${role} exceeds the telegraph segment cap.`);
    }
    if (activeSegments + requestedSegments > MAX_TELEGRAPH_SEGMENTS) {
      this._cancelPaths('telegraph-cap-guard');
    }
    const path = new RubyBeamPath({
      owner: this.owner,
      scene: this.game.scene,
      role,
      damage,
      fireDuration,
      segments,
    });
    path.setVisible(visible);
    const lensRefs = new Set(segments.flatMap((segment) => segment.lensRefs ?? []));
    for (const lens of lensRefs) lens.associatedTelegraphs.add(path);
    this.paths.push(path);
    return path;
  }

  _cancelPaths(reason = 'cancelled', predicate = null) {
    for (let index = this.paths.length - 1; index >= 0; index -= 1) {
      const path = this.paths[index];
      if (!predicate || predicate(path)) path.cancel(reason);
      if (!path.complete) continue;
      for (const lens of this.lenses) lens.associatedTelegraphs.delete(path);
      path.dispose();
      this.paths.splice(index, 1);
    }
  }

  _pruneCompletePaths() {
    for (let index = this.paths.length - 1; index >= 0; index -= 1) {
      const path = this.paths[index];
      if (!path.complete) continue;
      for (const lens of this.lenses) lens.associatedTelegraphs.delete(path);
      path.dispose();
      this.paths.splice(index, 1);
    }
  }

  _startNextAttack(game) {
    if (this.owner.bossState.phase === 2
      && this.ascensionDue <= 0
      && this.lastAttackType !== 'crossingReflection') {
      this._startAscension(game);
      return;
    }

    const deck = this.owner.bossState.phase === 2 ? PHASE_TWO_ATTACK_DECK : PHASE_ONE_ATTACK_DECK;
    let type = deck[this.attackDeckIndex % deck.length];
    this.attackDeckIndex += 1;
    if (type === 'crossingReflection' && this.ascensionDue < 4.5) type = 'directBeam';
    let started = false;
    if (type === 'directBeam') started = this._startDirectBeam(game);
    else if (type === 'singleLens') started = this._startSingleLens(game);
    else if (type === 'crossingReflection') started = this._startCrossingReflection(game);
    else if (type === 'refractionCascade') started = this._startRefractionCascade(game);
    else if (type === 'shutterFlash') started = this._startShutterFlash(game);
    if (!started) this._startDirectBeam(game);
  }

  debugStartAttack(type = 'directBeam', game = this.game) {
    if (!this.initialize(game) || this.disposed) return false;
    this.cancelCurrentAttack(game, 'debug-pattern-reset');
    this.attackCooldown = 0;
    if (type === 'singleLens') return this._startSingleLens(game);
    if (type === 'crossingReflection') return this._startCrossingReflection(game);
    if (type === 'refractionCascade') return this._startRefractionCascade(game);
    if (type === 'shutterFlash') return this._startShutterFlash(game);
    if (type === 'ascension') return this._startAscension(game);
    return this._startDirectBeam(game);
  }

  _beginAttack(type, extra = {}) {
    this.attackSerial += 1;
    this.attack = {
      type,
      elapsed: 0,
      fired: false,
      locked: false,
      interrupted: false,
      interruptElapsed: 0,
      ...extra,
    };
    this.lastAttackType = type;
    this.owner.brain.state = 'recovery';
    this.owner.brain.stateTime = 0;
    this.owner.brain.moving = false;
    return this.attack;
  }

  _finishAttack(game, { cooldown = null } = {}) {
    if (!this.attack) return;
    for (const lens of this.attack.lenses ?? []) {
      if (lens.state !== RUBY_LENS_STATES.INERT_PLATFORM
        && lens.state !== RUBY_LENS_STATES.KNOCKED_DOWN) lens.beginLowering();
    }
    this.attack = null;
    this.emitter?.setMode('cooldown');
    this.attackCooldown = cooldown ?? this.owner.aiRandom.float(
      this.owner.bossState.phase === 2 ? 3.5 : 3.8,
      this.owner.bossState.phase === 2 ? 4.65 : 5,
    );
    game.completeEnemyAttack?.(this.owner);
  }

  _startDirectBeam() {
    this._beginAttack('directBeam', {
      target: new THREE.Vector3(),
      primaryPath: null,
      echoTarget: new THREE.Vector3(),
      echoPath: null,
    });
    this._copyPlayerAim(this.attack.target);
    this.emitter?.setMode('charging');
    return true;
  }

  _updateDirectBeam(dt, game) {
    const tuning = RUBY_ORACLE_TUNING.directBeam;
    const attack = this.attack;
    attack.elapsed += dt;
    const trackingEnd = tuning.feedTime + tuning.trackingTime;
    const fireAt = trackingEnd + tuning.lockTime;
    if (!attack.primaryPath && attack.elapsed >= tuning.feedTime) {
      attack.primaryPath = this._createPath({
        role: 'oracleBeam',
        damage: this.owner.stats.damage * tuning.damageScale,
        fireDuration: tuning.fireTime,
        segments: [{
          getStart: (out) => this.getEyePosition(out),
          getEnd: (out) => out.copy(attack.target),
          width: tuning.width,
          damaging: true,
        }],
      });
      attack.primaryPath.setGuideMode('charging');
    }
    if (attack.elapsed < trackingEnd) this._copyPlayerAim(attack.target);
    if (!attack.locked && attack.elapsed >= trackingEnd) {
      attack.locked = true;
      attack.primaryPath?.lock();
      if (this.owner.bossState.phase === 2 && !this.owner.signaturePartOverloaded) {
        this._copyPlayerAim(attack.echoTarget);
        tempA.copy(game.player.lastMoveDirection ?? UP).setY(0);
        if (tempA.lengthSq() > 0.001) attack.echoTarget.addScaledVector(tempA.normalize(), 2.1);
        attack.echoPath = this._createPath({
          role: 'oracleBeamDodgeEcho',
          damage: this.owner.stats.damage * 0.62,
          fireDuration: 0.18,
          segments: [{
            getStart: (out) => this.getEyePosition(out),
            getEnd: (out) => out.copy(attack.echoTarget),
            width: 0.27,
            damaging: true,
          }],
        });
        attack.echoPath.lock();
      }
    }
    if (!attack.fired && attack.elapsed >= fireAt) {
      attack.fired = true;
      this.emitter?.setMode('attack');
      attack.primaryPath?.fire(game);
      const floorStart = this.owner.root.position.clone();
      floorStart.y = this.floorY + 0.075;
      const floorEnd = attack.target.clone();
      floorEnd.y = (game.dungeonController?.getSurfaceElevationAt?.(floorEnd) ?? this.floorY) + 0.075;
      attack.floorTrace = this._createPath({
        role: 'oracleBeamFloorTrace',
        damage: 0,
        fireDuration: 0.05,
        segments: [{
          getStart: (out) => out.copy(floorStart),
          getEnd: (out) => out.copy(floorEnd),
          width: 0.11,
          damaging: false,
        }],
      });
      attack.floorTrace.lock();
      attack.floorTrace.fire(game);
    }
    if (attack.echoPath && !attack.echoFired && attack.elapsed >= fireAt + 0.42) {
      attack.echoFired = true;
      attack.echoPath.fire(game);
    }
    if (attack.elapsed >= fireAt + tuning.fireTime + tuning.recoveryTime) this._finishAttack(game);
  }

  _availableLenses(tiers = null) {
    const liveSupport = this.game?.getPlatformSupport?.(this.game.player?.root?.position)?.surface ?? null;
    const candidates = this.lenses.filter((lens) => (
      lens.state === RUBY_LENS_STATES.INERT_PLATFORM
      && !lens.supportingPlayer
      && liveSupport !== lens.platformCollider
      && (!tiers || tiers.includes(lens.tier))
    ));
    candidates.sort((a, b) => a.index - b.index);
    if (candidates.length > 1) {
      const offset = this.attackSerial % candidates.length;
      return [...candidates.slice(offset), ...candidates.slice(0, offset)];
    }
    return candidates;
  }

  _holdForLateLensOccupancy(attack, dt, game) {
    const occupied = attack?.lenses?.find((lens) => (
      lens.supportingPlayer
      && lens.state === RUBY_LENS_STATES.ACTIVATION_WARNING
    ));
    if (!occupied) {
      if (attack) attack.occupancyHoldElapsed = 0;
      return false;
    }
    attack.occupancyHoldElapsed = (attack.occupancyHoldElapsed ?? 0) + dt;
    attack.elapsed = Math.min(attack.elapsed, Math.max(0, occupied.warningTime - 0.08));
    if (attack.occupancyHoldElapsed >= 0.75) {
      this._cancelPaths('occupied-lens-reselection');
      this._finishAttack(game, { cooldown: 0.45 });
    }
    return true;
  }

  _createReflectedPath(role, lens, target, { width, damageScale, fireDuration }) {
    return this._createPath({
      role,
      damage: this.owner.stats.damage * damageScale,
      fireDuration,
      segments: [
        {
          getStart: (out) => this.getEyePosition(out),
          getEnd: (out) => lens.getBeamJunctionPosition(out),
          width: 0.22,
          damaging: false,
          lensRefs: [lens],
        },
        {
          getStart: (out) => lens.getBeamJunctionPosition(out),
          getEnd: (out) => out.copy(target),
          width,
          damaging: true,
          lensRefs: [lens],
        },
      ],
    });
  }

  _startSingleLens() {
    const lens = this._availableLenses()[0];
    if (!lens) return false;
    const attack = this._beginAttack('singleLens', { lenses: [lens], target: new THREE.Vector3(), path: null });
    this._copyPlayerAim(attack.target);
    this._orientLens(lens, attack.target);
    lens.beginActivation({
      warningTime: RUBY_ORACLE_TUNING.amplifiedBeam.activationTime,
      raiseTime: RUBY_ORACLE_TUNING.amplifiedBeam.lensRaiseTime,
    });
    attack.path = this._createReflectedPath('singleLensMagnification', lens, attack.target, {
      width: RUBY_ORACLE_TUNING.amplifiedBeam.width,
      damageScale: RUBY_ORACLE_TUNING.amplifiedBeam.damageScale,
      fireDuration: RUBY_ORACLE_TUNING.amplifiedBeam.fireTime,
    });
    attack.path.setGuideMode('charging');
    this.emitter?.setMode('charging');
    return true;
  }

  _updateSingleLens(dt, game) {
    const attack = this.attack;
    attack.elapsed += dt;
    if (attack.interrupted) {
      attack.interruptElapsed += dt;
      if (attack.interruptElapsed >= 0.6) this._finishAttack(game, { cooldown: 3.5 });
      return;
    }
    if (this._holdForLateLensOccupancy(attack, dt, game)) {
      if (!this.attack) return;
      this._copyPlayerAim(attack.target);
      this._orientLens(attack.lenses[0], attack.target);
      return;
    }
    const lockAt = 1.2;
    const fireAt = 1.65;
    if (attack.elapsed < lockAt) {
      this._copyPlayerAim(attack.target);
    } else if (!attack.locked) {
      attack.locked = true;
      attack.path.lock();
    }
    if (attack.elapsed <= fireAt + RUBY_ORACLE_TUNING.amplifiedBeam.fireTime) {
      this._orientLens(attack.lenses[0], attack.target);
    }
    if (!attack.fired && attack.elapsed >= fireAt) {
      attack.fired = true;
      this.emitter?.setMode('attack');
      attack.path.fire(game);
    }
    if (!attack.lowered
      && attack.elapsed >= fireAt + RUBY_ORACLE_TUNING.amplifiedBeam.fireTime) {
      attack.lowered = true;
      attack.lenses[0].beginLowering();
    }
    if (attack.elapsed >= fireAt + 0.3 + 0.85) this._finishAttack(game);
  }

  _startCrossingReflection(game) {
    const available = this._availableLenses();
    if (available.length < 2) return false;
    const first = available[0];
    first.getWorldPosition(tempA);
    let second = available[1];
    let greatestDistance = -1;
    for (const candidate of available.slice(1)) {
      candidate.getWorldPosition(tempB);
      const distance = tempA.distanceToSquared(tempB);
      if (distance > greatestDistance) {
        greatestDistance = distance;
        second = candidate;
      }
    }
    const attack = this._beginAttack('crossingReflection', {
      lenses: [first, second],
      targets: [new THREE.Vector3(), new THREE.Vector3()],
      paths: [],
      knocked: new Set(),
    });
    this._copyPlayerAim(attack.targets[0]);
    attack.targets[1].copy(attack.targets[0]);
    tempA.copy(game?.player?.lastMoveDirection ?? new THREE.Vector3(1, 0, 0)).setY(0);
    if (tempA.lengthSq() <= 0.001) tempA.set(1, 0, 0);
    tempA.normalize();
    attack.targets[0].addScaledVector(tempA, 1.15);
    attack.targets[1].addScaledVector(tempA, -1.15);
    for (let index = 0; index < attack.lenses.length; index += 1) {
      const lens = attack.lenses[index];
      lens.beginActivation();
      this._orientLens(lens, attack.targets[index]);
      const path = this._createReflectedPath(`crossingReflection:${index}`, lens, attack.targets[index], {
        width: 0.72,
        damageScale: 1.08,
        fireDuration: 0.28,
      });
      path.setGuideMode('charging');
      attack.paths.push(path);
    }
    this.emitter?.setMode('charging');
    return true;
  }

  _updateCrossingReflection(dt, game) {
    const attack = this.attack;
    attack.elapsed += dt;
    if (attack.interrupted) {
      attack.interruptElapsed += dt;
      if (attack.interruptElapsed >= 0.6) this._finishAttack(game, { cooldown: 3.7 });
      return;
    }
    if (this._holdForLateLensOccupancy(attack, dt, game)) return;
    const lockAt = 1.22;
    const fireAt = 1.67;
    if (attack.elapsed < lockAt) {
      const base = this._copyPlayerAim(tempC);
      tempA.copy(game.player.lastMoveDirection ?? new THREE.Vector3(1, 0, 0)).setY(0);
      if (tempA.lengthSq() <= 0.001) tempA.set(1, 0, 0);
      tempA.normalize();
      attack.targets[0].copy(base).addScaledVector(tempA, 1.15);
      attack.targets[1].copy(base).addScaledVector(tempA, -1.15);
    } else if (!attack.locked) {
      attack.locked = true;
      attack.paths.forEach((path) => path.lock());
    }
    if (attack.elapsed <= fireAt + 0.28) {
      attack.lenses.forEach((lens, index) => this._orientLens(lens, attack.targets[index]));
    }
    if (!attack.fired && attack.elapsed >= fireAt) {
      attack.fired = true;
      this.emitter?.setMode('attack');
      attack.paths.forEach((path) => {
        if (!path.complete) path.fire(game);
      });
    }
    if (!attack.lowered && attack.elapsed >= fireAt + 0.28) {
      attack.lowered = true;
      attack.lenses.forEach((lens) => {
        if (lens.state !== RUBY_LENS_STATES.KNOCKED_DOWN) lens.beginLowering();
      });
    }
    if (attack.elapsed >= fireAt + 1.05) this._finishAttack(game);
  }

  _startRefractionCascade() {
    const first = this._availableLenses(['lower'])[0];
    const second = this._availableLenses(['upper', 'middle']).find((lens) => lens !== first);
    if (!first || !second) return false;
    const attack = this._beginAttack('refractionCascade', {
      lenses: [first, second],
      target: new THREE.Vector3(),
      paths: [],
      redirectPath: null,
      redirected: false,
      knocked: new Set(),
    });
    this._copyPlayerAim(attack.target);
    first.beginActivation();
    second.beginActivation();
    this._orientCascade(attack);
    const incomingPath = this._createPath({
      role: 'refractionCascade:incoming',
      damage: 0,
      fireDuration: 0.32,
      segments: [
        {
          getStart: (out) => this.getEyePosition(out),
          getEnd: (out) => first.getBeamJunctionPosition(out),
          width: 0.24,
          damaging: false,
          lensRefs: [first],
        },
        {
          getStart: (out) => first.getBeamJunctionPosition(out),
          getEnd: (out) => second.getBeamJunctionPosition(out),
          width: 0.56,
          damaging: false,
          // The first lens owns the whole chain. The second lens may be
          // knocked flat while this incoming energy still reaches its edge.
          lensRefs: [first],
        },
      ],
    });
    const outgoingPath = this._createPath({
      role: 'refractionCascade:outgoing',
      damage: this.owner.stats.damage * 1.55,
      fireDuration: 0.32,
      segments: [{
        getStart: (out) => second.getBeamJunctionPosition(out),
        getEnd: (out) => out.copy(attack.target),
        width: 1.05,
        damaging: true,
        lensRefs: [first, second],
      }],
    });
    incomingPath.setGuideMode('charging');
    outgoingPath.setGuideMode('charging');
    attack.paths.push(incomingPath, outgoingPath);
    this.emitter?.setMode('charging');
    return true;
  }

  _redirectCascadeFromSecond(attack, game) {
    if (!attack || attack.redirected || attack.fired) return false;
    const [first, second] = attack.lenses;
    second.getWorldPosition(tempA);
    tempB.copy(tempA).sub(this.center).setY(0);
    if (tempB.lengthSq() <= 0.001) tempB.set(1, 0, 0);
    tempB.normalize();
    const redirectTarget = tempA.clone().addScaledVector(tempB, 4.4);
    redirectTarget.y = Math.min(this.ceilingY - 0.8, tempA.y + 4.2);
    attack.redirected = true;
    attack.redirectPath = this._createPath({
      role: 'refractionCascade:harmlessRedirect',
      damage: 0,
      fireDuration: 0.32,
      segments: [{
        getStart: (out) => second.getBeamJunctionPosition(out),
        getEnd: (out) => out.copy(redirectTarget),
        width: 0.92,
        damaging: false,
        lensRefs: [first],
      }],
    });
    attack.redirectPath.setGuideMode('charging');
    if (attack.locked) attack.redirectPath.lock();
    game?.addDirectedParticleSpray?.(
      second.getWorldPosition(tempA),
      tempB.set(0, 1, 0),
      0xffffff,
      { count: 18, range: 4.2, pressure: 1.1 },
    );
    return true;
  }

  _orientCascade(attack) {
    const [first, second] = attack.lenses;
    first.getWorldPosition(tempA);
    second.getWorldPosition(tempB);
    tempC.copy(tempA).sub(this.getEyePosition(tempD)).normalize();
    tempD.copy(tempB).sub(tempA).normalize();
    first.orientForReflection(tempC, tempD);
    tempC.copy(tempB).sub(tempA).normalize();
    tempD.copy(attack.target).sub(tempB).normalize();
    second.orientForReflection(tempC, tempD);
  }

  _updateRefractionCascade(dt, game) {
    const attack = this.attack;
    attack.elapsed += dt;
    if (attack.interrupted) {
      attack.interruptElapsed += dt;
      if (attack.interruptElapsed >= 0.6) this._finishAttack(game, { cooldown: 3.8 });
      return;
    }
    if (this._holdForLateLensOccupancy(attack, dt, game)) return;
    const lockAt = 1.26;
    const fireAt = 1.72;
    if (attack.elapsed < lockAt) {
      this._copyPlayerAim(attack.target);
    } else if (!attack.locked) {
      attack.locked = true;
      [...attack.paths, attack.redirectPath].filter(Boolean).forEach((path) => {
        if (!path.complete) path.lock();
      });
    }
    if (attack.elapsed <= fireAt + 0.32) this._orientCascade(attack);
    if (!attack.fired && attack.elapsed >= fireAt) {
      attack.fired = true;
      this.emitter?.setMode('attack');
      [...attack.paths, attack.redirectPath].filter(Boolean).forEach((path) => {
        if (!path.complete) path.fire(game);
      });
    }
    if (!attack.lowered && attack.elapsed >= fireAt + 0.32) {
      attack.lowered = true;
      attack.lenses.forEach((lens) => {
        if (lens.state !== RUBY_LENS_STATES.KNOCKED_DOWN) lens.beginLowering();
      });
    }
    if (attack.elapsed >= fireAt + 1.15) this._finishAttack(game);
  }

  _startShutterFlash() {
    this._beginAttack('shutterFlash', { flashed: false });
    this.emitter?.setMode('idle');
    return true;
  }

  _updateShutterFlash(dt, game) {
    const attack = this.attack;
    attack.elapsed += dt;
    if (!attack.flashed && attack.elapsed >= 0.35) {
      attack.flashed = true;
      tempA.copy(game.player.root.position).sub(this.owner.root.position).setY(0);
      const distance = tempA.length();
      if (distance <= 2.85 + game.player.radius) {
        if (distance <= 0.001) tempA.set(0, 0, 1);
        else tempA.divideScalar(distance);
        game.player.takeDamage(this.owner.stats.damage * 0.46, this.owner, {
          attackKind: 'rubyOracleShutterFlash',
          knockbackDirection: tempA,
          knockbackStrength: 0.72,
          impactPosition: this.owner.root.position.clone(),
        });
      }
      game.addExplosion?.(this.owner.root.position, 0, 2.85, 0xff315f, {
        source: this.owner,
        damageEnemies: false,
        damagePlayer: false,
        triggerMines: false,
      });
    }
    if (attack.elapsed >= 1.35) this._finishAttack(game, { cooldown: 3.5 });
  }

  _startAscension() {
    if (this.paths.some((path) => !path.complete)) return false;
    const attack = this._beginAttack('ascension', {
      stage: 'rising',
      channelElapsed: 0,
      channelHits: 0,
      channelDamage: 0,
      channelCoreUnlocked: false,
      groundRootY: this.owner.root.position.y,
      hazardTimer: RUBY_ORACLE_TUNING.ascension.platformHazardInterval,
      platformHazard: null,
    });
    this._cancelPaths('ascension-start');
    this.lenses.forEach((lens) => {
      lens.forceInert();
      const layout = RUBY_ASCENSION_LAYOUT[lens.tier];
      lens.setOrbitLayout({
        radius: layout.radius,
        height: layout.height,
        direction: layout.direction,
        speed: layout.speed,
        verticalAmplitude: layout.verticalAmplitude,
      }, RUBY_ORACLE_TUNING.ascension.initialDelay);
    });
    this.emitter?.setMode('overdrive');
    this.channelMeter.root.visible = true;
    return Boolean(attack);
  }

  _updateAscension(dt, game) {
    const attack = this.attack;
    attack.elapsed += dt;
    if (attack.stage === 'falling') {
      this._updateAscensionFall(dt, game);
      return;
    }
    if (attack.stage === 'rising') {
      const progress = clamp01(attack.elapsed / RUBY_ORACLE_TUNING.ascension.initialDelay);
      this.visualOffsetY = 0;
      this.owner.root.position.x = THREE.MathUtils.lerp(this.owner.root.position.x, this.center.x, Math.min(1, dt * 4));
      this.owner.root.position.y = THREE.MathUtils.lerp(
        attack.groundRootY,
        this.floorY + 6.9,
        progress,
      );
      this.owner.root.position.z = THREE.MathUtils.lerp(this.owner.root.position.z, this.center.z, Math.min(1, dt * 4));
      this._setArenaDarkness(progress * 0.22);
      if (progress >= 1) {
        this.owner.root.position.set(this.center.x, this.floorY + 6.9, this.center.z);
        attack.stage = 'channel';
        attack.channelElapsed = 0;
        this.emitter?.setMode('overdrive');
      }
      return;
    }

    attack.channelElapsed += dt;
    if (!attack.channelCoreUnlocked) {
      attack.channelCoreUnlocked = this.lenses.some((lens) => (
        lens.tier === 'upper' && lens.supportingPlayer && lens.platformCollider.enabled
      ));
      if (attack.channelCoreUnlocked) {
        if (game.combat?.lockOn?.target === this.owner.signatureTarget) {
          game.combat.transferLockOnTarget?.(this.owner.signatureTarget, this.channelCoreTarget);
        }
        game.ui?.showToast?.('Upper aperture aligned — channel core exposed', '#ffe1e8');
      }
    }
    const channelProgress = clamp01(attack.channelElapsed / RUBY_ORACLE_TUNING.ascension.channelDuration);
    this._setArenaDarkness(0.22 + channelProgress * 0.38);
    attack.hazardTimer -= dt;
    if (!attack.platformHazard && attack.hazardTimer <= 0) {
      this._beginPlatformHazard(game);
      attack.hazardTimer = this.owner.aiRandom.float(2.2, 2.8);
    }
    this._updatePlatformHazard(dt, game);
    if (attack.channelElapsed >= RUBY_ORACLE_TUNING.ascension.channelDuration) {
      this._failAscension(game);
    }
  }

  _beginPlatformHazard() {
    const attack = this.attack;
    const occupied = this.lenses.find((lens) => lens.supportingPlayer && lens.platformCollider.enabled);
    if (!occupied || !this._hasReachableAlternative(occupied)) return false;
    const path = this._createPath({
      role: `platformTarget:${occupied.index}`,
      damage: this.owner.stats.damage * 0.38,
      fireDuration: 0.2,
      segments: [{
        getStart: (out) => occupied.getWorldPosition(out),
        getEnd: (out) => {
          occupied.getWorldPosition(out);
          out.y = this.ceilingY;
          return out;
        },
        width: 0.46,
        damaging: true,
        lensRefs: [occupied],
      }],
    });
    path.setGuideMode('charging');
    attack.platformHazard = { lens: occupied, path, elapsed: 0, fired: false };
    return true;
  }

  _updatePlatformHazard(dt, game) {
    const hazard = this.attack?.platformHazard;
    if (!hazard) return;
    hazard.elapsed += dt;
    if (!hazard.fired && hazard.elapsed >= 1) {
      hazard.fired = true;
      hazard.path.lock();
      hazard.path.fire(game);
      game.addParticleBurst?.(hazard.lens.getWorldPosition(tempA), 0xff315f, 24, 0.18);
    }
    if (hazard.path.complete || hazard.elapsed >= 1.45) this.attack.platformHazard = null;
  }

  _hasReachableAlternative(source) {
    source.getWorldPosition(tempA);
    return this.lenses.some((candidate) => {
      if (candidate === source || !candidate.platformCollider.enabled) return false;
      candidate.getWorldPosition(tempB);
      const edgeGap = Math.max(0, flatDistance(tempA, tempB) - source.platformRadius - candidate.platformRadius);
      const rise = candidate.platformCollider.topY - source.platformCollider.topY;
      return edgeGap <= PLAYER_TRAVERSAL_ENVELOPE.maximumHorizontalJumpDistance * 0.8
        && rise <= PLAYER_TRAVERSAL_ENVELOPE.maximumLedgeClimbRise * 0.75;
    });
  }

  _succeedAscension(game) {
    if (this.attack?.type !== 'ascension') return false;
    const attack = this.attack;
    this._cancelPaths('ascension-interrupted');
    this._restoreOrdinaryLensLayout(1.05);
    attack.stage = 'falling';
    attack.fallOutcome = 'success';
    attack.fallElapsed = 0;
    attack.fallDuration = ASCENSION_FALL_TIME.success;
    attack.fallStartY = this.owner.root.position.y;
    attack.fallDarknessStart = 0.22
      + clamp01(attack.channelElapsed / RUBY_ORACLE_TUNING.ascension.channelDuration) * 0.38;
    attack.channelCoreUnlocked = false;
    attack.platformHazard = null;
    this.visualOffsetY = 0;
    this.staggerRemaining = 0;
    this.emitter?.setMode('cooldown');
    this.channelMeter.root.visible = false;
    this.owner.brain.state = 'recovery';
    this.owner.brain.stateTime = 0;
    this.owner.brain.weakPointExposed = false;
    if (game.combat?.lockOn?.target === this.channelCoreTarget) {
      game.combat.transferLockOnTarget?.(this.channelCoreTarget, this.owner);
    }
    game.addParticleBurst?.(this.getEyePosition(tempA), 0xffffff, 52, 0.28);
    return true;
  }

  _failAscension(game) {
    if (this.attack?.type !== 'ascension') return false;
    this._cancelPaths('all-seeing-burst');
    const player = game.player;
    const mitigationInverse = (100 + Math.max(0, player.stats?.armor ?? 0)) / 100;
    const rawDamage = player.stats.maxHealth
      * RUBY_ORACLE_TUNING.ascension.failureDamageHealthScale
      * mitigationInverse;
    tempA.copy(this.center).sub(player.root.position).setY(0);
    if (tempA.lengthSq() <= 0.001) tempA.set(0, 0, 1);
    else tempA.normalize();
    player.takeDamage(rawDamage, this.owner, {
      attackKind: 'rubyOracleAllSeeingBurst',
      powerfulKnockback: true,
      knockbackDirection: tempA,
      knockbackStrength: 0.74,
      unblockable: true,
      impactPosition: this.getEyePosition(tempB).clone(),
    });
    game.addExplosion?.(this.getEyePosition(tempA), 0, 8.5, 0xff164f, {
      source: this.owner,
      damageEnemies: false,
      damagePlayer: false,
      triggerMines: false,
    });
    this._restoreOrdinaryLensLayout(1.15);
    for (const lens of this.lenses) {
      lens.getWorldPosition(tempA);
      tempB.copy(tempA).sub(this.center).setY(0);
      if (tempB.lengthSq() <= 0.001) tempB.set(1, 0, 0);
      tempB.normalize();
      const reflectedEnd = tempA.clone().addScaledVector(tempB, 6.2);
      reflectedEnd.y += 1.8;
      const burstPath = this._createPath({
        role: `allSeeingBurstReflection:${lens.index}`,
        damage: 0,
        fireDuration: ASCENSION_FALL_TIME.failure + 0.12,
        segments: [
          {
            getStart: (out) => this.getEyePosition(out),
            getEnd: (out) => lens.getBeamJunctionPosition(out),
            width: 0.48,
            damaging: false,
            lensRefs: [lens],
          },
          {
            getStart: (out) => lens.getBeamJunctionPosition(out),
            getEnd: (out) => out.copy(reflectedEnd),
            width: 0.86,
            damaging: false,
            lensRefs: [lens],
          },
        ],
      });
      burstPath.lock();
      burstPath.fire(game);
    }
    const attack = this.attack;
    attack.stage = 'falling';
    attack.fallOutcome = 'failure';
    attack.fallElapsed = 0;
    attack.fallDuration = ASCENSION_FALL_TIME.failure;
    attack.fallStartY = this.owner.root.position.y;
    attack.fallDarknessStart = 0.55;
    attack.channelCoreUnlocked = false;
    attack.platformHazard = null;
    this.visualOffsetY = 0;
    this.owner.brain.weakPointExposed = false;
    this.burstRecoveryRemaining = 0;
    this._setArenaDarkness(0.55);
    this.emitter?.setMode('cooldown');
    this.channelMeter.root.visible = false;
    if (game.combat?.lockOn?.target === this.channelCoreTarget) {
      game.combat.transferLockOnTarget?.(this.channelCoreTarget, this.owner);
    }
    return true;
  }

  _updateAscensionFall(dt, game) {
    const attack = this.attack;
    if (attack?.type !== 'ascension' || attack.stage !== 'falling') return;
    attack.fallElapsed = Math.min(attack.fallDuration, attack.fallElapsed + dt);
    const progress = clamp01(attack.fallElapsed / Math.max(0.001, attack.fallDuration));
    const gravityProgress = progress * progress;
    this.owner.root.position.set(
      this.center.x,
      THREE.MathUtils.lerp(attack.fallStartY, this.floorY, gravityProgress),
      this.center.z,
    );
    if (attack.fallOutcome === 'success') {
      this._setArenaDarkness(THREE.MathUtils.lerp(attack.fallDarknessStart, 0, progress));
    } else {
      this._setArenaDarkness(attack.fallDarknessStart);
    }
    if (progress < 1) return;
    this._completeAscensionLanding(game, attack.fallOutcome);
  }

  _completeAscensionLanding(game, outcome) {
    if (this.attack?.type !== 'ascension' || this.attack.stage !== 'falling') return false;
    this.owner.root.position.set(this.center.x, this.floorY, this.center.z);
    this.visualOffsetY = 0;
    this.attack = null;
    this.ascensionDue = RUBY_ORACLE_TUNING.ascension.repeatCooldown;
    this.owner.brain.state = 'recovery';
    this.owner.brain.stateTime = 0;
    this.channelMeter.root.visible = false;
    game.addParticleBurst?.(this.owner.root.position, outcome === 'success' ? 0xffffff : 0xff315f, 34, 0.2);
    if (outcome === 'success') {
      this.staggerRemaining = RUBY_ORACLE_TUNING.ascension.successStaggerTime;
      this.owner.brain.weakPointExposed = true;
      this._setArenaDarkness(0);
      game.ui?.showToast?.('Ruby aperture blinded — Oracle vulnerable', '#ffe1e8');
    } else {
      this.owner.brain.weakPointExposed = false;
      this.burstRecoveryRemaining = this.burstRecoveryDuration;
      this._setArenaDarkness(0.55);
    }
    return true;
  }

  _restoreOrdinaryLensLayout(blendSeconds = 0.8) {
    this.lenses.forEach((lens, index) => {
      lens.forceInert();
      const layout = RUBY_PLANETARIUM_LAYOUT[index];
      lens.setOrbitLayout({
        radius: layout.radius,
        height: layout.height,
        direction: layout.direction,
        speed: layout.speed,
        verticalAmplitude: layout.verticalAmplitude,
      }, blendSeconds);
    });
  }

  _updateAttack(dt, game) {
    if (this.attack.type === 'directBeam') this._updateDirectBeam(dt, game);
    else if (this.attack.type === 'singleLens') this._updateSingleLens(dt, game);
    else if (this.attack.type === 'crossingReflection') this._updateCrossingReflection(dt, game);
    else if (this.attack.type === 'refractionCascade') this._updateRefractionCascade(dt, game);
    else if (this.attack.type === 'shutterFlash') this._updateShutterFlash(dt, game);
    else if (this.attack.type === 'ascension') this._updateAscension(dt, game);
  }

  _onLensKnockedDown(lens, game) {
    game?.addDirectedParticleSpray?.(
      lens.getWorldPosition(tempA),
      new THREE.Vector3(0, 1, 0),
      0xffd36f,
      { count: 12, range: 2.8, pressure: 0.8 },
    );
    const attack = this.attack;
    if (!attack || !attack.lenses?.includes(lens)) return;
    if (attack.type === 'crossingReflection') {
      attack.knocked.add(lens);
      if (attack.knocked.size >= 2) {
        attack.interrupted = true;
        this.emitter?.setMode('cooldown');
      }
      return;
    }
    if (attack.type === 'refractionCascade') {
      attack.knocked.add(lens);
      if (lens === attack.lenses[0]) {
        attack.interrupted = true;
        this.emitter?.setMode('cooldown');
      } else {
        this._redirectCascadeFromSecond(attack, game);
      }
      return;
    }
    attack.interrupted = true;
    this.emitter?.setMode('cooldown');
  }

  _orientLens(lens, target) {
    lens.getWorldPosition(tempA);
    tempB.copy(tempA).sub(this.getEyePosition(tempC)).normalize();
    tempC.copy(target).sub(tempA).normalize();
    lens.orientForReflection(tempB, tempC);
  }

  _copyPlayerAim(out) {
    out.copy(this.game.player.root.position);
    out.y += Math.max(0.68, (this.game.player.collisionHeight ?? 2.85) * 0.34);
    return out;
  }

  getEyePosition(out = new THREE.Vector3()) {
    const eye = this.owner.visual?.eye?.lens ?? this.owner.visual?.eye?.group;
    if (eye?.getWorldPosition) return eye.getWorldPosition(out);
    out.copy(this.owner.root.position);
    out.y += this.owner.collisionHeight * 0.7 + this.visualOffsetY;
    return out;
  }

  getPrismPosition(out = new THREE.Vector3()) {
    const muzzle = this.owner.visual?.weapon?.muzzle;
    if (muzzle?.getWorldPosition) return muzzle.getWorldPosition(out);
    return this.getEyePosition(out);
  }

  _setArenaDarkness(ratio) {
    if (this.observatory?.darknessMaterial) {
      this.observatory.darknessMaterial.opacity = clamp01(ratio) * 0.68;
      this.observatory.darkness.visible = ratio > 0.001;
    }
  }

  _updateChannelMeter(game, dt = 0) {
    if (!this.channelMeter) return;
    const channelAscension = this.attack?.type === 'ascension'
      && (this.attack.stage === 'rising' || this.attack.stage === 'channel');
    const visible = this.ceremonyRemaining > 0 || channelAscension;
    this.channelMeter.root.visible = visible;
    if (!visible) return;
    this.channelMeter.root.position.copy(this.getEyePosition(tempA));
    this.channelMeter.root.lookAt(game.camera?.position ?? game.player.root.position);
    const hits = channelAscension ? this.attack.channelHits : 0;
    const channelProgress = channelAscension
      ? clamp01(this.attack.channelElapsed / RUBY_ORACLE_TUNING.ascension.channelDuration)
      : clamp01(1 - this.ceremonyRemaining / 2);
    const spinStep = Math.max(0, Number(dt) || 0) * 0.36;
    this.channelMeter.rings.forEach((ring, index) => {
      const filled = index < hits || channelProgress * this.channelMeter.rings.length > index + 0.75;
      ring.material.color.setHex(filled ? 0xfff0ee : 0x7f0b25);
      ring.material.opacity = filled ? 0.94 : 0.36;
      ring.rotation.z += spinStep * (index % 2 === 0 ? 1 : -1);
    });
  }

  beginPhaseTwo(game = this.game) {
    if (this.disposed) return;
    this.initialize(game);
    this.cancelCurrentAttack(game, 'phase-transition');
    this.ceremonyRemaining = 2;
    this.ascensionDue = 1.2;
    this.attackCooldown = 1.2;
    this.emitter?.setMode('overdrive');
    this.channelMeter.root.visible = true;
    this.lenses.forEach((lens, index) => {
      lens.forceInert();
      const layout = RUBY_PLANETARIUM_LAYOUT[index];
      lens.setOrbitLayout({
        radius: layout.radius,
        height: layout.height + 0.55,
        direction: layout.direction,
        speed: layout.speed * 0.55,
        verticalAmplitude: layout.verticalAmplitude,
      }, 0.45);
      this.getEyePosition(tempD);
      this._orientLens(lens, tempD);
    });
  }

  _updatePhaseCeremony(dt) {
    const before = this.ceremonyRemaining;
    this.ceremonyRemaining = Math.max(0, before - dt);
    const progress = clamp01(1 - this.ceremonyRemaining / 2);
    this.owner.root.position.x = THREE.MathUtils.lerp(this.owner.root.position.x, this.center.x, Math.min(1, dt * 4));
    this.owner.root.position.z = THREE.MathUtils.lerp(this.owner.root.position.z, this.center.z, Math.min(1, dt * 4));
    this.lenses.forEach((lens, index) => {
      lens.setCeremonyTilt(lens.supportingPlayer ? 0 : Math.sin(progress * Math.PI) * (0.42 + index * 0.025));
    });
    if (this.ceremonyRemaining <= 0) {
      this.lenses.forEach((lens) => lens.setCeremonyTilt(0));
      this._restoreOrdinaryLensLayout(0.65);
      this.emitter?.setMode('idle');
      this.channelMeter.root.visible = false;
      this.attackCooldown = Math.max(this.attackCooldown, 0.8);
    }
  }

  getCombatTargets() {
    if (this.disposed) return [];
    const targets = this.lenses.filter((lens) => lens.combatTarget.active).map((lens) => lens.combatTarget);
    if (this.channelCoreTarget.active) targets.unshift(this.channelCoreTarget);
    return targets;
  }

  resolveProjectileHit(position, projectileRadius = 0.1) {
    if (this.disposed) return null;
    let closest = null;
    for (const target of this.getCombatTargets()) {
      target.getWorldPosition(tempA);
      const radius = target.radius + projectileRadius;
      const distanceSq = position.distanceToSquared(tempA);
      if (distanceSq <= radius * radius && (!closest || distanceSq < closest.distanceSq)) {
        closest = { target, distanceSq, position: tempA.clone() };
      }
    }
    return closest ? this._hitInfoForTarget(closest.target, 0, closest.position) : null;
  }

  resolveLineHit(start, direction, range, width = 0.1) {
    let closest = null;
    for (const target of this.getCombatTargets()) {
      target.getWorldPosition(tempA);
      const along = lineHit(tempA, start, direction, range, width + target.radius);
      if (along == null || (closest && along >= closest.along)) continue;
      closest = { target, along, position: tempA.clone() };
    }
    return closest ? this._hitInfoForTarget(closest.target, closest.along, closest.position) : null;
  }

  resolveArcHit(origin, direction, range, halfAngle) {
    let closest = null;
    tempD.copy(direction).setY(0);
    if (tempD.lengthSq() <= 0.001) tempD.set(0, 0, 1);
    tempD.normalize();
    for (const target of this.getCombatTargets()) {
      target.getWorldPosition(tempA);
      tempB.copy(tempA).sub(origin);
      const vertical = Math.abs(tempB.y);
      tempB.y = 0;
      const distance = tempB.length();
      if (distance > range + target.radius || vertical > 2.8 + target.radius) continue;
      if (distance > 0.001) tempB.divideScalar(distance);
      if (tempD.dot(tempB) < Math.cos(halfAngle)) continue;
      if (!closest || distance < closest.along) closest = { target, along: distance, position: tempA.clone() };
    }
    return closest ? this._hitInfoForTarget(closest.target, closest.along, closest.position) : null;
  }

  _hitInfoForTarget(target, along, position) {
    return {
      along,
      hitPartId: target.partId,
      hitPosition: position,
      rubyOrbitalLensHit: Boolean(target.isRubyOrbitalLensTarget),
      rubyChannelCoreHit: Boolean(target.isRubyChannelCoreTarget),
      bossArenaNodeHit: Boolean(target.isRubyOrbitalLensTarget),
      signaturePartHit: Boolean(target.isRubyChannelCoreTarget),
    };
  }

  handlesPartId(partId) {
    return partId === this.channelCorePartId
      || this.lenses.some((lens) => lens.combatTarget.partId === partId);
  }

  handleLensImpact(amount, meta = {}, game = this.game) {
    const lens = this.lenses.find((candidate) => candidate.combatTarget.partId === meta.hitPartId);
    if (!lens) return false;
    lens.receiveDirectImpact({ ...meta, amount }, game);
    return true;
  }

  recordChannelDamage(dealt, meta = {}, game = this.game) {
    if (!this.isChannelCoreActive() || meta.hitPartId !== this.channelCorePartId || dealt <= 0) return false;
    const direct = meta.projectileHit || meta.directHit || meta.directContactHit;
    if (!direct || meta.explosionSplash || meta.areaDamage) return false;
    const explicitUnits = Number(meta.mirrorImpactUnits);
    const units = Number.isFinite(explicitUnits) && explicitUnits > 0
      ? explicitUnits
      : (meta.critical || meta.heavy || meta.charged || meta.chargedShot) ? 2 : 1;
    this.attack.channelHits += units;
    this.attack.channelDamage += dealt;
    if (this.attack.channelHits >= RUBY_ORACLE_TUNING.ascension.interruptHits
      || this.attack.channelDamage >= this.owner.stats.maxHealth * RUBY_ORACLE_TUNING.ascension.interruptHealthScale) {
      return this._succeedAscension(game);
    }
    return true;
  }

  isChannelCoreActive() {
    return this.attack?.type === 'ascension'
      && this.attack.stage === 'channel'
      && this.attack.channelCoreUnlocked === true
      && !this.disposed;
  }

  isAscensionActive() {
    return this.attack?.type === 'ascension';
  }

  isSuccessStaggerActive() {
    return this.staggerRemaining > 0;
  }

  isShutterProtected() {
    return this.attack?.type === 'shutterFlash' && this.attack.elapsed < 0.92;
  }

  isMovementLocked() {
    return this.ceremonyRemaining > 0
      || this.isAscensionActive()
      || this.staggerRemaining > 0
      || this.burstRecoveryRemaining > 0;
  }

  getVisualState() {
    const shutterFlash = this.attack?.type === 'shutterFlash' && this.attack.elapsed < 0.92;
    const ascension = this.attack?.type === 'ascension' ? this.attack : null;
    const ascensionProgress = ascension
      ? ascension.stage === 'rising'
        ? clamp01(ascension.elapsed / RUBY_ORACLE_TUNING.ascension.initialDelay)
        : 1
      : 0;
    const ceremonyProgress = this.ceremonyRemaining > 0
      ? clamp01(1 - this.ceremonyRemaining / 2)
      : 0;
    return {
      charging: this.ceremonyRemaining > 0
        || (this.attack && this.attack.type !== 'shutterFlash'),
      shuttersClosed: shutterFlash,
      weakPointExposed: this.ceremonyRemaining > 0 || this.staggerRemaining > 0,
      visualOffsetY: this.visualOffsetY,
      ascensionActive: Boolean(ascension),
      ascensionProgress,
      pupilIntensity: Math.max(ceremonyProgress, ascensionProgress, this.staggerRemaining > 0 ? 0.72 : 0),
    };
  }

  getHudState() {
    const ascension = this.attack?.type === 'ascension'
      && (this.attack.stage === 'rising' || this.attack.stage === 'channel')
      ? this.attack
      : null;
    return {
      channelActive: Boolean(ascension),
      channelRatio: ascension
        ? clamp01(ascension.channelElapsed / RUBY_ORACLE_TUNING.ascension.channelDuration)
        : 0,
      channelHits: ascension?.channelHits ?? 0,
      channelHitsRequired: RUBY_ORACLE_TUNING.ascension.interruptHits,
      signatureStatus: ascension
        ? ascension.channelCoreUnlocked
          ? `RUBY APERTURE ${ascension.channelHits}/${RUBY_ORACLE_TUNING.ascension.interruptHits}`
          : 'CLIMB TO THE UPPER APERTURE'
        : this.staggerRemaining > 0
          ? 'ORACLE BLINDED — VULNERABLE'
          : null,
    };
  }

  getResourceCounts() {
    return {
      projectiles: 0,
      telegraphs: this.paths.reduce((sum, path) => sum + path.getTelegraphCount(), 0),
      constructs: this.lenses.filter((lens) => !lens.disposed).length,
    };
  }

  cancelCurrentAttack(game = this.game, reason = 'cancelled') {
    const wasAscension = this.isAscensionActive();
    this._cancelPaths(reason);
    this.attack = null;
    this.lenses.forEach((lens) => {
      if (lens.state !== RUBY_LENS_STATES.INERT_PLATFORM) lens.forceInert();
    });
    this.emitter?.setMode('idle');
    this._setArenaDarkness(0);
    if (wasAscension) {
      this.owner.root.position.y = this.floorY;
      this.visualOffsetY = 0;
      this.owner.brain.weakPointExposed = false;
      this._restoreOrdinaryLensLayout(0.65);
    }
    if (this.channelMeter) this.channelMeter.root.visible = false;
    if (game?.combat?.lockOn?.target === this.channelCoreTarget) {
      game.combat.transferLockOnTarget?.(this.channelCoreTarget, this.owner);
    }
    game?.projectiles?.cancelWhere?.((projectile) => projectile.source === this.owner, `ruby-${reason}`);
  }

  dispose(game = this.game) {
    if (this.disposed) return;
    this.cancelCurrentAttack(game, 'dispose');
    this.disposed = true;
    for (const path of this.paths) path.dispose();
    this.paths.length = 0;
    for (const lens of this.lenses) lens.dispose(game);
    this.lenses.length = 0;
    this.emitter?.dispose();
    this.emitter = null;
    disposeOwnedTree(this.channelMeter?.root);
    this.channelMeter = null;
    disposeOwnedTree(this.observatory?.root);
    this.observatory = null;
    for (const hidden of this.hiddenStockFixtures) hidden.object.visible = hidden.visible;
    this.hiddenStockFixtures.length = 0;
  }
}

export default RubyOpticOracleEncounter;
