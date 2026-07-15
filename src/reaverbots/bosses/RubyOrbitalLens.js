import * as THREE from 'three';
import { getReaverbotTexture } from '../ReaverbotTextureLibrary.js';

export const RUBY_LENS_STATES = Object.freeze({
  INERT_PLATFORM: 'INERT_PLATFORM',
  ACTIVATION_WARNING: 'ACTIVATION_WARNING',
  RAISING: 'RAISING',
  ACTIVE_MIRROR: 'ACTIVE_MIRROR',
  LOWERING: 'LOWERING',
  KNOCKED_DOWN: 'KNOCKED_DOWN',
});

const TARGETABLE_STATES = new Set([
  RUBY_LENS_STATES.ACTIVATION_WARNING,
  RUBY_LENS_STATES.RAISING,
  RUBY_LENS_STATES.ACTIVE_MIRROR,
]);
const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const DEFAULT_MIRROR_QUATERNION = new THREE.Quaternion().setFromAxisAngle(X_AXIS, Math.PI * 0.5);
const IDENTITY_QUATERNION = new THREE.Quaternion();
const MAX_PLATFORM_TILT = THREE.MathUtils.degToRad(35);
const PLATFORM_SUPPORT_TOLERANCE = 0.2;
const IMPACT_UNITS_TO_KNOCK_DOWN = 3;
const MAX_DEBOUNCE_KEYS = 48;
const LANDING_EDGE_SNAP_MAX = 0.22;
const LANDING_EDGE_INSET = 0.025;

const tempPosition = new THREE.Vector3();
const tempPositionB = new THREE.Vector3();
const tempIncoming = new THREE.Vector3();
const tempOutgoing = new THREE.Vector3();
const tempNormal = new THREE.Vector3();
const tempUp = new THREE.Vector3();
const tempInverseMatrix = new THREE.Matrix4();
const tempDeltaMatrix = new THREE.Matrix4();

function smooth01(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function normalizedDirection(value, fallback = 1) {
  const direction = Math.sign(Number(value) || 0);
  return direction || Math.sign(fallback) || 1;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function resolveImpactDebounceKey(meta = {}) {
  const executionId = meta.executionId
    ?? meta.attackExecutionId
    ?? meta.busterExecutionId
    ?? meta.projectileId
    ?? meta.attackId
    ?? null;
  const tickId = meta.tickId
    ?? meta.damageTickId
    ?? meta.hitTickId
    ?? meta.impactTickId
    ?? null;
  if (executionId == null && tickId == null) return null;
  return `${executionId == null ? '-' : String(executionId)}:${tickId == null ? '-' : String(tickId)}`;
}

function isHeavyImpact(meta = {}) {
  return Boolean(
    meta.critical
    || meta.heavy
    || meta.heavyHit
    || meta.charged
    || meta.chargedShot
    || meta.isCharged
    || Number(meta.chargeLevel) > 0
    || Number(meta.chargeTier) > 0
    || meta.attackKind === 'heavy'
    || meta.attackKind === 'chargedShot',
  );
}

/**
 * A world-space orbital fixture whose authored face normal is +Y.  Keeping the
 * orbit pivot separate from the tilt pivot lets the platform inherit orbital
 * rotation without coupling collision to the mirror's visual raising motion.
 */
export class RubyOrbitalLens {
  constructor({
    owner,
    index = 0,
    tier = 'lower',
    size = 1.5,
    arenaCenter = new THREE.Vector3(),
    orbitRadius = 5,
    orbitHeight = 1.2,
    orbitDirection = 1,
    angularSpeed = 0.3,
    angularPosition = 0,
    onKnockedDown = null,
  } = {}) {
    this.owner = owner ?? null;
    this.index = Math.max(0, Math.trunc(Number(index) || 0));
    this.tier = String(tier ?? 'lower');
    this.size = positiveNumber(size, 1.5);
    this.arenaCenter = arenaCenter?.clone?.() ?? new THREE.Vector3();

    this.state = RUBY_LENS_STATES.INERT_PLATFORM;
    this.orbitRadius = Math.max(0, Number(orbitRadius) || 0);
    this.orbitHeight = Number(orbitHeight) || 0;
    this.orbitDirection = normalizedDirection(orbitDirection);
    this.angularSpeed = Math.max(0, Number(angularSpeed) || 0);
    this.angularPosition = Number(angularPosition) || 0;
    this.platformCollider = null;
    this.combatTarget = null;
    this.supportingPlayer = false;
    this.stabilityHits = 0;
    this.associatedTelegraphs = new Set();

    this.onKnockedDown = typeof onKnockedDown === 'function' ? onKnockedDown : null;
    this.warningTime = 0.65;
    this.raiseTime = 0.45;
    this.stateTime = 0;
    this.stateDuration = 0;
    this.disposed = false;
    this.mounted = false;

    this._game = null;
    this._layoutBlend = null;
    this._platformRegistration = null;
    this._registeredPlatformArray = null;
    this._visualTime = 0;
    this._impactFlash = 0;
    this._wobbleStrength = 0;
    this._wobblePhase = this.index * 1.71;
    this._debouncedImpactKeys = new Set();
    this._debouncedImpactOrder = [];
    this._geometries = new Set();
    this._materials = new Set();
    this._reflectionQuaternion = DEFAULT_MIRROR_QUATERNION.clone();
    this._ceremonyQuaternion = IDENTITY_QUATERNION.clone();
    this._tiltStartQuaternion = IDENTITY_QUATERNION.clone();
    this._previousWorldMatrix = new THREE.Matrix4();
    this._currentWorldMatrix = new THREE.Matrix4();

    this.platformSurfaceOffset = Math.max(0.12, this.size * 0.13);
    this.platformRadius = Math.max(0.6, this.size * 0.88);

    this.orbitPivot = new THREE.Group();
    this.orbitPivot.name = `rubyOrbitalLensOrbit_${this.index}`;
    this.orbitPivot.position.copy(this.arenaCenter);
    this.orbitPivot.rotation.y = -this.angularPosition;

    this.radialAnchor = new THREE.Group();
    this.radialAnchor.name = `rubyOrbitalLensAnchor_${this.index}`;
    this.radialAnchor.position.set(
      this.orbitRadius,
      this.orbitHeight - this.platformSurfaceOffset,
      0,
    );
    this.orbitPivot.add(this.radialAnchor);

    this.tiltPivot = new THREE.Group();
    this.tiltPivot.name = `rubyOrbitalLensTilt_${this.index}`;
    this.radialAnchor.add(this.tiltPivot);

    this.visualPivot = new THREE.Group();
    this.visualPivot.name = `rubyOrbitalLensVisual_${this.index}`;
    this.tiltPivot.add(this.visualPivot);
    this.root = this.radialAnchor;

    this._buildFixture();
    this._createPlatformCollider();
    this._createCombatTarget();
    this._updateColliderFromWorldTransform();
  }

  _ownGeometry(geometry) {
    this._geometries.add(geometry);
    return geometry;
  }

  _ownMaterial(material, name) {
    material.name = name;
    this._materials.add(material);
    return material;
  }

  _addMesh(parent, geometry, material, name, position = null, rotation = null) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    if (position) mesh.position.copy(position);
    if (rotation) mesh.rotation.set(rotation.x, rotation.y, rotation.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  _buildFixture() {
    const rubyTexture = getReaverbotTexture('rubyOpticOracleEye');
    this.darkMaterial = this._ownMaterial(new THREE.MeshStandardMaterial({
      color: 0x151417,
      emissive: 0x250008,
      emissiveIntensity: 0.16,
      roughness: 0.42,
      metalness: 0.78,
    }), `material_rubyOrbitalLensDark_${this.index}`);
    this.goldMaterial = this._ownMaterial(new THREE.MeshStandardMaterial({
      color: 0xd4b867,
      emissive: 0x5c2608,
      emissiveIntensity: 0.28,
      roughness: 0.29,
      metalness: 0.84,
    }), `material_rubyOrbitalLensGold_${this.index}`);
    this.rubyMaterial = this._ownMaterial(new THREE.MeshStandardMaterial({
      color: 0xff315f,
      map: rubyTexture,
      emissiveMap: rubyTexture,
      emissive: 0xff0d3f,
      emissiveIntensity: 0.72,
      roughness: 0.14,
      metalness: 0.08,
    }), `material_rubyOrbitalLensRuby_${this.index}`);
    this.warningMaterial = this._ownMaterial(new THREE.MeshBasicMaterial({
      color: 0xffd36f,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }), `material_rubyOrbitalLensWarning_${this.index}`);
    this.glintMaterial = this._ownMaterial(new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }), `material_rubyOrbitalLensGlint_${this.index}`);

    const undersideGeometry = this._ownGeometry(new THREE.CylinderGeometry(
      this.size * 0.76,
      this.size * 0.92,
      this.size * 0.22,
      32,
      2,
    ));
    this._addMesh(
      this.visualPivot,
      undersideGeometry,
      this.darkMaterial,
      `rubyOrbitalLensUnderside_${this.index}`,
      new THREE.Vector3(0, -this.size * 0.03, 0),
    );

    const lensGeometry = this._ownGeometry(new THREE.CylinderGeometry(
      this.size * 0.73,
      this.size * 0.73,
      this.size * 0.105,
      40,
      1,
    ));
    this.rubyDisc = this._addMesh(
      this.visualPivot,
      lensGeometry,
      this.rubyMaterial,
      `rubyOrbitalLensRubyDisc_${this.index}`,
      new THREE.Vector3(0, this.size * 0.095, 0),
    );
    this.rubyDisc.userData.rubyOrbitalLensFace = true;
    this.rubyDisc.userData.lensIndex = this.index;

    const outerRingGeometry = this._ownGeometry(new THREE.TorusGeometry(
      this.size * 0.82,
      this.size * 0.07,
      8,
      48,
    ));
    this.outerGoldRing = this._addMesh(
      this.visualPivot,
      outerRingGeometry,
      this.goldMaterial,
      `rubyOrbitalLensOuterGoldRing_${this.index}`,
      new THREE.Vector3(0, this.size * 0.16, 0),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    );

    const innerRingGeometry = this._ownGeometry(new THREE.TorusGeometry(
      this.size * 0.48,
      this.size * 0.025,
      6,
      36,
    ));
    this.innerGoldRing = this._addMesh(
      this.visualPivot,
      innerRingGeometry,
      this.goldMaterial,
      `rubyOrbitalLensInnerGoldRing_${this.index}`,
      new THREE.Vector3(0, this.size * 0.158, 0),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    );

    const hubGeometry = this._ownGeometry(new THREE.CylinderGeometry(
      this.size * 0.18,
      this.size * 0.25,
      this.size * 0.24,
      16,
    ));
    this._addMesh(
      this.visualPivot,
      hubGeometry,
      this.goldMaterial,
      `rubyOrbitalLensLowerHub_${this.index}`,
      new THREE.Vector3(0, -this.size * 0.15, 0),
    );

    const bracketGeometry = this._ownGeometry(new THREE.BoxGeometry(
      this.size * 0.18,
      this.size * 0.12,
      this.size * 0.34,
    ));
    for (let bracketIndex = 0; bracketIndex < 8; bracketIndex += 1) {
      const angle = (bracketIndex / 8) * Math.PI * 2;
      const bracket = this._addMesh(
        this.visualPivot,
        bracketGeometry,
        bracketIndex % 2 === 0 ? this.goldMaterial : this.darkMaterial,
        `rubyOrbitalLensBracket_${this.index}_${bracketIndex}`,
        new THREE.Vector3(
          Math.cos(angle) * this.size * 0.77,
          this.size * 0.035,
          Math.sin(angle) * this.size * 0.77,
        ),
      );
      bracket.rotation.y = -angle;
    }

    const warningGeometry = this._ownGeometry(new THREE.TorusGeometry(
      this.size * 0.97,
      this.size * 0.035,
      6,
      56,
    ));
    this.warningRing = this._addMesh(
      this.visualPivot,
      warningGeometry,
      this.warningMaterial,
      `rubyOrbitalLensWarningRing_${this.index}`,
      new THREE.Vector3(0, this.size * 0.21, 0),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    );
    this.warningRing.castShadow = false;
    this.warningRing.receiveShadow = false;
    this.warningRing.visible = false;
    this.warningRing.renderOrder = 9;

    const glintGeometry = this._ownGeometry(new THREE.CircleGeometry(this.size * 0.3, 28));
    this.glint = this._addMesh(
      this.visualPivot,
      glintGeometry,
      this.glintMaterial,
      `rubyOrbitalLensGlint_${this.index}`,
      new THREE.Vector3(-this.size * 0.19, this.size * 0.155, -this.size * 0.12),
      new THREE.Euler(-Math.PI * 0.5, 0, -0.24),
    );
    this.glint.castShadow = false;
    this.glint.receiveShadow = false;
    this.glint.renderOrder = 8;

    this.visualPivot.traverse((object) => {
      object.userData.rubyOrbitalLens = true;
      object.userData.rubyOrbitalLensIndex = this.index;
    });
  }

  _createPlatformCollider() {
    const lens = this;
    const halfExtent = this.platformRadius / Math.sqrt(2);
    this.platformCollider = {
      id: `rubyOrbitalLensPlatform_${this.owner?.id ?? 'oracle'}_${this.index}`,
      owner: this.owner,
      lens: this,
      center: new THREE.Vector3(),
      radius: this.platformRadius,
      halfWidth: halfExtent,
      halfDepth: halfExtent,
      topY: this.arenaCenter.y + this.orbitHeight,
      baseY: this.arenaCenter.y,
      enabled: true,
      active: true,
      oneWay: true,
      circular: true,
      dynamic: true,
      blocksBelow: false,
      createsLedgeCandidates: true,
      ledgeCatchMode: 'instant-step',
      object: this.radialAnchor,
      containsTop(position, inset = 0) {
        if (!lens.platformCollider.enabled || !position) return false;
        const radius = Math.max(0, lens.platformCollider.radius - Math.max(0, Number(inset) || 0));
        const dx = position.x - lens.platformCollider.center.x;
        const dz = position.z - lens.platformCollider.center.z;
        return dx * dx + dz * dz <= radius * radius;
      },
      getTopY(position) {
        return lens.platformCollider.containsTop(position) ? lens.platformCollider.topY : null;
      },
      getLandingSnapPosition(position, { player = null, inset = 0 } = {}) {
        if (!lens.platformCollider.enabled || !position) return null;
        const resolvedInset = Math.max(0, Number(inset) || 0);
        const usableRadius = Math.max(0.1, lens.platformCollider.radius - resolvedInset);
        const snapBand = Math.min(
          LANDING_EDGE_SNAP_MAX,
          Math.max(0.12, Math.max(0, Number(player?.radius) || 0.42) * 0.45),
        );
        const dx = position.x - lens.platformCollider.center.x;
        const dz = position.z - lens.platformCollider.center.z;
        const distance = Math.hypot(dx, dz);
        if (distance <= usableRadius || distance > usableRadius + snapBand || distance <= 0.0001) {
          return null;
        }
        const snappedRadius = Math.max(0, usableRadius - LANDING_EDGE_INSET);
        const scale = snappedRadius / distance;
        return position.clone().set(
          lens.platformCollider.center.x + dx * scale,
          position.y,
          lens.platformCollider.center.z + dz * scale,
        );
      },
    };
  }

  _createCombatTarget() {
    const lens = this;
    const partId = `rubyOrbitalLens:${this.owner?.id ?? 'oracle'}:${this.index}`;
    this.combatTarget = {
      id: `${this.owner?.id ?? 'rubyOracle'}:${partId}`,
      ownerEnemy: this.owner,
      lens: this,
      partId,
      root: this.radialAnchor,
      radius: Math.max(0.42, this.size * 0.76),
      combatAimOffset: 0,
      aimHeight: 0,
      isBossArenaNodeTarget: true,
      isRubyOrbitalLensTarget: true,
      retainLockWhenInactive: false,
      get dead() {
        return lens.disposed || Boolean(lens.owner?.dead);
      },
      get active() {
        return lens.mounted
          && !lens.disposed
          && !lens.owner?.dead
          && TARGETABLE_STATES.has(lens.state);
      },
      getWorldPosition(out = new THREE.Vector3()) {
        return lens.getWorldPosition(out);
      },
    };
  }

  mount(game) {
    if (this.disposed || this.mounted || !game?.scene) return false;
    this._game = game;
    game.scene.add(this.orbitPivot);
    this.mounted = true;
    this.orbitPivot.updateMatrixWorld(true);
    this._previousWorldMatrix.copy(this.radialAnchor.matrixWorld);
    this._currentWorldMatrix.copy(this.radialAnchor.matrixWorld);
    this._updateColliderFromWorldTransform();

    if (typeof game.registerDynamicPlatformingSurface === 'function') {
      game.registerDynamicPlatformingSurface(this.platformCollider);
      this._platformRegistration = () => (
        game.unregisterDynamicPlatformingSurface?.(this.platformCollider)
      );
    } else if (typeof game.registerDynamicPlatform === 'function') {
      this._platformRegistration = game.registerDynamicPlatform(this.platformCollider) ?? true;
    } else if (Array.isArray(game.platformingPlatforms)) {
      if (!game.platformingPlatforms.includes(this.platformCollider)) {
        game.platformingPlatforms.push(this.platformCollider);
      }
      this._registeredPlatformArray = game.platformingPlatforms;
      game._rebuildPlatformingLedgeCandidates?.();
    }
    return true;
  }

  setOrbitLayout({ radius, height, direction, speed } = {}, blendSeconds = 0) {
    if (this.disposed) return false;
    const targetRadius = Number.isFinite(Number(radius)) ? Math.max(0, Number(radius)) : this.orbitRadius;
    const targetHeight = Number.isFinite(Number(height)) ? Number(height) : this.orbitHeight;
    const targetDirection = normalizedDirection(direction, this.orbitDirection);
    const targetSpeed = Number.isFinite(Number(speed)) ? Math.max(0, Number(speed)) : this.angularSpeed;
    const duration = Math.max(0, Number(blendSeconds) || 0);
    if (duration <= 0) {
      this.orbitRadius = targetRadius;
      this.orbitHeight = targetHeight;
      this.orbitDirection = targetDirection;
      this.angularSpeed = targetSpeed;
      this._layoutBlend = null;
      return true;
    }
    this._layoutBlend = {
      elapsed: 0,
      duration,
      startRadius: this.orbitRadius,
      startHeight: this.orbitHeight,
      startAngularVelocity: this.orbitDirection * this.angularSpeed,
      targetRadius,
      targetHeight,
      targetAngularVelocity: targetDirection * targetSpeed,
    };
    return true;
  }

  setCeremonyTilt(radians = 0) {
    if (this.disposed) return false;
    const tilt = Number.isFinite(Number(radians)) ? Number(radians) : 0;
    this._ceremonyQuaternion.setFromAxisAngle(X_AXIS, tilt);
    return true;
  }

  beginActivation({ warningTime = 0.65, raiseTime = 0.45 } = {}) {
    if (this.disposed || !this.mounted || this.owner?.dead) return false;
    if (TARGETABLE_STATES.has(this.state)) return false;
    this.warningTime = positiveNumber(warningTime, 0.65);
    this.raiseTime = positiveNumber(raiseTime, 0.45);
    this.state = RUBY_LENS_STATES.ACTIVATION_WARNING;
    this.stateTime = 0;
    this.stateDuration = this.warningTime;
    this.stabilityHits = 0;
    this._debouncedImpactKeys.clear();
    this._debouncedImpactOrder.length = 0;
    this._ceremonyQuaternion.identity();
    this.warningRing.visible = true;
    return true;
  }

  beginLowering(duration = 0.32) {
    if (this.disposed || this.state === RUBY_LENS_STATES.INERT_PLATFORM) return false;
    this.state = RUBY_LENS_STATES.LOWERING;
    this.stateTime = 0;
    this.stateDuration = positiveNumber(duration, 0.32);
    this._tiltStartQuaternion.copy(this.tiltPivot.quaternion);
    this._ceremonyQuaternion.identity();
    return true;
  }

  forceInert({ cancelTelegraphs = true } = {}) {
    if (this.disposed) return false;
    if (cancelTelegraphs) this._cancelAssociatedTelegraphs('lens-force-inert');
    this.state = RUBY_LENS_STATES.INERT_PLATFORM;
    this.stateTime = 0;
    this.stateDuration = 0;
    this.stabilityHits = 0;
    this.supportingPlayer = false;
    this._ceremonyQuaternion.identity();
    this.tiltPivot.quaternion.identity();
    this.visualPivot.rotation.set(0, 0, 0);
    this.warningRing.visible = false;
    this.warningMaterial.opacity = 0;
    this._updateColliderFromWorldTransform();
    return true;
  }

  orientForReflection(incoming, outgoing) {
    if (this.disposed || !incoming || !outgoing) return false;
    tempIncoming.copy(incoming);
    tempOutgoing.copy(outgoing);
    if (tempIncoming.lengthSq() <= 1e-8 || tempOutgoing.lengthSq() <= 1e-8) return false;
    tempIncoming.normalize();
    tempOutgoing.normalize();
    tempNormal.copy(tempIncoming).sub(tempOutgoing);
    if (tempNormal.lengthSq() <= 1e-8) return false;
    tempNormal.normalize();
    this._reflectionQuaternion.setFromUnitVectors(UP, tempNormal);
    return true;
  }

  receiveDirectImpact(meta = {}, game = this._game) {
    if (this.disposed || !this.combatTarget.active) return false;
    const direct = Boolean(meta.projectileHit || meta.directHit || meta.directContactHit);
    if (!direct || meta.explosionSplash || meta.areaDamage || meta.damageNullified) return false;
    const statedAmount = meta.amount ?? meta.damage ?? meta.rawDamage ?? null;
    if (statedAmount != null && (!(Number(statedAmount) > 0))) return false;

    const debounceKey = resolveImpactDebounceKey(meta);
    if (debounceKey && this._debouncedImpactKeys.has(debounceKey)) return false;
    if (debounceKey) {
      this._debouncedImpactKeys.add(debounceKey);
      this._debouncedImpactOrder.push(debounceKey);
      if (this._debouncedImpactOrder.length > MAX_DEBOUNCE_KEYS) {
        this._debouncedImpactKeys.delete(this._debouncedImpactOrder.shift());
      }
    }

    const explicitUnits = Number(meta.mirrorImpactUnits);
    const units = Number.isFinite(explicitUnits) && explicitUnits > 0
      ? explicitUnits
      : isHeavyImpact(meta) ? 2 : 1;
    this.stabilityHits = Math.min(IMPACT_UNITS_TO_KNOCK_DOWN, this.stabilityHits + units);
    this._impactFlash = 1;
    this._wobbleStrength = Math.min(1, this._wobbleStrength + 0.42 + units * 0.14);
    this.getWorldPosition(tempPosition);
    game?.addParticleBurst?.(tempPosition, 0xff315f, units >= 2 ? 18 : 10, 0.1);
    game?.addHitEffect?.(tempPosition, units >= 2 ? 0xffffff : 0xff5878, 0.52 + units * 0.12, {
      absolute: true,
    });
    if (this.stabilityHits >= IMPACT_UNITS_TO_KNOCK_DOWN) this.knockDown(game);
    return true;
  }

  _advanceLayout(dt) {
    const blend = this._layoutBlend;
    if (blend) {
      blend.elapsed = Math.min(blend.duration, blend.elapsed + dt);
      const alpha = smooth01(blend.elapsed / blend.duration);
      this.orbitRadius = THREE.MathUtils.lerp(blend.startRadius, blend.targetRadius, alpha);
      this.orbitHeight = THREE.MathUtils.lerp(blend.startHeight, blend.targetHeight, alpha);
      const velocity = THREE.MathUtils.lerp(
        blend.startAngularVelocity,
        blend.targetAngularVelocity,
        alpha,
      );
      this.orbitDirection = normalizedDirection(velocity, blend.targetAngularVelocity);
      this.angularSpeed = Math.abs(velocity);
      if (blend.elapsed >= blend.duration) {
        this.orbitRadius = blend.targetRadius;
        this.orbitHeight = blend.targetHeight;
        this.orbitDirection = normalizedDirection(blend.targetAngularVelocity, this.orbitDirection);
        this.angularSpeed = Math.abs(blend.targetAngularVelocity);
        this._layoutBlend = null;
      }
    }
    const orbitStateScale = this.state === RUBY_LENS_STATES.ACTIVATION_WARNING ? 0.58 : 1;
    this.angularPosition += this.orbitDirection * this.angularSpeed * orbitStateScale * dt;
    this.orbitPivot.rotation.y = -this.angularPosition;
    this.radialAnchor.position.set(
      this.orbitRadius,
      this.orbitHeight - this.platformSurfaceOffset,
      0,
    );
  }

  _advanceState(dt) {
    this.stateTime += dt;
    if (this.state === RUBY_LENS_STATES.ACTIVATION_WARNING) {
      this.tiltPivot.quaternion.slerp(IDENTITY_QUATERNION, Math.min(1, dt * 12));
      if (this.stateTime >= this.warningTime) {
        if (this.supportingPlayer) {
          this.stateTime = this.warningTime;
          return;
        }
        this.state = RUBY_LENS_STATES.RAISING;
        this.stateTime = 0;
        this.stateDuration = this.raiseTime;
        this._tiltStartQuaternion.copy(this.tiltPivot.quaternion);
      }
      return;
    }

    if (this.state === RUBY_LENS_STATES.RAISING) {
      const alpha = smooth01(this.stateTime / Math.max(0.001, this.stateDuration));
      this.tiltPivot.quaternion.copy(this._tiltStartQuaternion).slerp(this._reflectionQuaternion, alpha);
      if (this.stateTime >= this.stateDuration) {
        this.state = RUBY_LENS_STATES.ACTIVE_MIRROR;
        this.stateTime = 0;
        this.stateDuration = 0;
        this.tiltPivot.quaternion.copy(this._reflectionQuaternion);
      }
      return;
    }

    if (this.state === RUBY_LENS_STATES.ACTIVE_MIRROR) {
      this.tiltPivot.quaternion.slerp(this._reflectionQuaternion, Math.min(1, dt * 11));
      return;
    }

    if (this.state === RUBY_LENS_STATES.LOWERING
      || this.state === RUBY_LENS_STATES.KNOCKED_DOWN) {
      const alpha = smooth01(this.stateTime / Math.max(0.001, this.stateDuration));
      this.tiltPivot.quaternion.copy(this._tiltStartQuaternion).slerp(IDENTITY_QUATERNION, alpha);
      if (this.stateTime >= this.stateDuration) this.forceInert({ cancelTelegraphs: false });
      return;
    }

    this.tiltPivot.quaternion.slerp(this._ceremonyQuaternion, Math.min(1, dt * 7.5));
  }

  _canCarryPlayer(player, game = this._game) {
    if (!player?.root || player.dead || !this.platformCollider.enabled) return false;
    if (player.externalControl || player.externalBallisticMotion) return false;
    if (player.isPowerKnockbackActive?.() || player.powerKnockbackState != null) return false;
    if (player.isJumpAirborne?.()) return false;
    if (player.jumpState === 'Rising' || player.jumpState === 'Falling') return false;
    const grounded = player.jumpState === 'Grounded'
      || player.jumpState === 'LandRecovery'
      || player.grounded === true
      || player.onGround === true;
    if (!grounded) return false;

    const resolvedSupport = game?.getPlatformSupport?.(player.root.position) ?? null;
    if (resolvedSupport?.surface === this.platformCollider) {
      return Math.abs(
        player.root.position.y - (resolvedSupport.elevation ?? this.platformCollider.topY),
      ) <= PLATFORM_SUPPORT_TOLERANCE;
    }
    if (resolvedSupport?.surface) return false;

    const declaredSupport = player.groundSupport === this.platformCollider
      || player.groundSupportId === this.platformCollider.id
      || player.supportingPlatform === this.platformCollider
      || player.supportingPlatformId === this.platformCollider.id;
    if (declaredSupport) return true;
    if (!this.platformCollider.containsTop(player.root.position, Math.min(0.08, this.platformRadius * 0.08))) {
      return false;
    }
    return Math.abs(player.root.position.y - this.platformCollider.topY) <= PLATFORM_SUPPORT_TOLERANCE;
  }

  _updateColliderFromWorldTransform() {
    if (!this.platformCollider) return;
    this.radialAnchor.getWorldPosition(tempPosition);
    const topY = tempPosition.y + this.platformSurfaceOffset;
    this.platformCollider.center.set(tempPosition.x, topY, tempPosition.z);
    this.platformCollider.topY = topY;
    this.platformCollider.baseY = this.arenaCenter.y;
    tempUp.copy(UP).applyQuaternion(this.tiltPivot.quaternion).normalize();
    const tilt = Math.acos(THREE.MathUtils.clamp(tempUp.dot(UP), -1, 1));
    this.platformCollider.enabled = !this.disposed && tilt <= MAX_PLATFORM_TILT;
    this.platformCollider.active = this.platformCollider.enabled;
  }

  _carryPlayerWithPlatform(player, controller) {
    tempInverseMatrix.copy(this._previousWorldMatrix).invert();
    tempDeltaMatrix.multiplyMatrices(this._currentWorldMatrix, tempInverseMatrix);
    player.root.position.applyMatrix4(tempDeltaMatrix);
    if (controller?.lastSafePlayerPosition?.isVector3) {
      controller.lastSafePlayerPosition.applyMatrix4(tempDeltaMatrix);
    }
  }

  prePlayerUpdate(dt, game = this._game) {
    if (this.disposed || !this.mounted) return false;
    const delta = Math.max(0, Number(dt) || 0);
    this.orbitPivot.updateMatrixWorld(true);
    this._previousWorldMatrix.copy(this.radialAnchor.matrixWorld);
    this._updateColliderFromWorldTransform();
    const supportedBeforeMotion = this._canCarryPlayer(game?.player, game);
    this.supportingPlayer = supportedBeforeMotion;

    this._advanceLayout(delta);
    this._advanceState(delta);
    this.orbitPivot.updateMatrixWorld(true);
    this._currentWorldMatrix.copy(this.radialAnchor.matrixWorld);

    if (supportedBeforeMotion) {
      this._carryPlayerWithPlatform(game.player, game.dungeonController);
    }
    this._updateColliderFromWorldTransform();
    this.supportingPlayer = supportedBeforeMotion && this.platformCollider.enabled;
    return true;
  }

  updateVisual(dt) {
    if (this.disposed) return;
    const delta = Math.max(0, Number(dt) || 0);
    this._visualTime += delta;
    this._impactFlash = Math.max(0, this._impactFlash - delta * 5.8);
    this._wobbleStrength = Math.max(0, this._wobbleStrength - delta * 1.45);

    const warning = this.state === RUBY_LENS_STATES.ACTIVATION_WARNING;
    const raising = this.state === RUBY_LENS_STATES.RAISING;
    const active = this.state === RUBY_LENS_STATES.ACTIVE_MIRROR;
    const progress = warning
      ? THREE.MathUtils.clamp(this.stateTime / Math.max(0.001, this.warningTime), 0, 1)
      : 0;
    const warningPulse = warning
      ? 0.5 + 0.5 * Math.sin(progress * Math.PI * 6 - Math.PI * 0.5)
      : 0;
    this.warningRing.visible = warning || raising;
    this.warningMaterial.opacity = warning
      ? 0.3 + warningPulse * 0.58
      : raising ? 0.38 : 0;
    this.warningRing.scale.setScalar(1 + warningPulse * 0.07);
    this.warningRing.rotation.z += delta * (warning ? 1.8 : 0.7);

    const activePulse = active ? 0.5 + 0.5 * Math.sin(this._visualTime * 10.5) : 0;
    this.rubyMaterial.emissiveIntensity = 0.58
      + warningPulse * 1.75
      + (raising ? 1.05 : 0)
      + activePulse * 1.45
      + this._impactFlash * 2.25;
    this.goldMaterial.emissiveIntensity = 0.24
      + warningPulse * 0.55
      + (active ? 0.34 : 0)
      + this._impactFlash * 0.7;
    this.glintMaterial.opacity = 0.18
      + (warning || raising ? 0.24 : 0)
      + (active ? 0.3 : 0)
      + this._impactFlash * 0.28;
    this.innerGoldRing.rotation.z -= delta * (active ? 1.8 : 0.18);

    const wobble = this._wobbleStrength;
    this._wobblePhase += delta * (9 + wobble * 7);
    this.visualPivot.rotation.x = Math.sin(this._wobblePhase) * wobble * 0.12;
    this.visualPivot.rotation.z = Math.cos(this._wobblePhase * 0.83) * wobble * 0.1;
  }

  _cancelAssociatedTelegraphs(reason) {
    for (const telegraph of this.associatedTelegraphs) {
      if (typeof telegraph === 'function') {
        telegraph(reason, this);
      } else if (typeof telegraph?.cancel === 'function') {
        telegraph.cancel(reason, this);
      } else if (typeof telegraph?.dispose === 'function') {
        telegraph.dispose(reason);
      } else if (telegraph) {
        telegraph.active = false;
        telegraph.object?.removeFromParent?.();
      }
    }
    this.associatedTelegraphs.clear();
  }

  knockDown(game = this._game) {
    if (this.disposed
      || this.state === RUBY_LENS_STATES.INERT_PLATFORM
      || this.state === RUBY_LENS_STATES.LOWERING
      || this.state === RUBY_LENS_STATES.KNOCKED_DOWN) return false;
    this._cancelAssociatedTelegraphs('lens-knocked-down');
    this.state = RUBY_LENS_STATES.KNOCKED_DOWN;
    this.stateTime = 0;
    this.stateDuration = 0.3;
    this._tiltStartQuaternion.copy(this.tiltPivot.quaternion);
    this._ceremonyQuaternion.identity();
    this._impactFlash = 1;
    this._wobbleStrength = 1;
    this.getWorldPosition(tempPosition);
    game?.addParticleBurst?.(tempPosition, 0xffffff, 28, 0.16);
    game?.addParticleBurst?.(tempPosition, 0xff315f, 22, 0.2);
    if (game?.combat?.lockOn?.target === this.combatTarget) {
      game.combat.transferLockOnTarget?.(this.combatTarget, this.owner);
    }
    this.onKnockedDown?.(this, game);
    return true;
  }

  getWorldPosition(out = new THREE.Vector3()) {
    return this.radialAnchor.getWorldPosition(out);
  }

  getBeamJunctionPosition(out = new THREE.Vector3()) {
    this.getWorldPosition(out);
    if (this._wobbleStrength <= 0.001) return out;
    const offset = this._wobbleStrength * Math.min(0.2, this.platformRadius * 0.11);
    out.x += Math.cos(this._wobblePhase * 0.91) * offset;
    out.y += Math.sin(this._wobblePhase * 1.17) * offset * 0.55;
    out.z += Math.sin(this._wobblePhase * 0.83) * offset;
    return out;
  }

  dispose(game = this._game) {
    if (this.disposed) return;
    this.disposed = true;
    this.supportingPlayer = false;
    this.platformCollider.enabled = false;
    this.platformCollider.active = false;
    this._cancelAssociatedTelegraphs('lens-dispose');
    if (game?.combat?.lockOn?.target === this.combatTarget) {
      game.combat.transferLockOnTarget?.(this.combatTarget, this.owner);
    }

    if (typeof this._platformRegistration === 'function') {
      this._platformRegistration();
    } else if (typeof this._platformRegistration?.unregister === 'function') {
      this._platformRegistration.unregister();
    } else {
      game?.unregisterDynamicPlatformingSurface?.(this.platformCollider);
      game?.unregisterDynamicPlatform?.(this.platformCollider);
    }
    if (this._registeredPlatformArray) {
      const index = this._registeredPlatformArray.indexOf(this.platformCollider);
      if (index >= 0) this._registeredPlatformArray.splice(index, 1);
      game?._rebuildPlatformingLedgeCandidates?.();
      this._registeredPlatformArray = null;
    }

    this.orbitPivot.removeFromParent();
    for (const geometry of this._geometries) geometry.dispose?.();
    for (const material of this._materials) material.dispose?.();
    this._geometries.clear();
    this._materials.clear();
    this.mounted = false;
    this._game = null;
  }
}

export default RubyOrbitalLens;
