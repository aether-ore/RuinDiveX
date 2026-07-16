import * as THREE from 'three';

const GUIDE_MODES = new Set(['guide', 'charging', 'locked']);
const DEFAULT_SEGMENT_WIDTH = 0.34;
const TRACE_FADE_DURATION = 0.16;
const MIN_VISUAL_LENGTH = 0.0001;
const DEFAULT_PLAYER_RADIUS = 0.42;
const LOCKED_CORE_COLOR = new THREE.Color(0xffffff);
const LOCKED_AURA_COLOR = new THREE.Color(0xff9aaa);
const FIRING_CORE_COLOR = new THREE.Color(0xfff7f8);
const TRACE_CORE_COLOR = new THREE.Color(0xffd7dd);

const tempStart = new THREE.Vector3();
const tempEnd = new THREE.Vector3();
const tempMidpoint = new THREE.Vector3();
const tempSegment = new THREE.Vector3();
const tempToPoint = new THREE.Vector3();
const tempClosest = new THREE.Vector3();
const tempPlayerHitPoint = new THREE.Vector3();

function safeNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function sanitizeName(value) {
  return String(value ?? 'beam')
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'beam';
}

function normalizeLensRefs(lensRefs) {
  if (lensRefs == null) return [];
  if (Array.isArray(lensRefs)) return [...new Set(lensRefs.filter(Boolean))];
  if (lensRefs instanceof Set) return [...lensRefs].filter(Boolean);
  return [lensRefs].filter(Boolean);
}

function readEndpoint(segment, getterName, out) {
  const getter = segment.source[getterName];
  const result = getter.call(segment.source, out);
  if (result?.isVector3 && result !== out) out.copy(result);
  return out;
}

function pointToSegmentDistanceSquared(point, start, end) {
  tempSegment.copy(end).sub(start);
  const lengthSquared = tempSegment.lengthSq();
  if (lengthSquared <= Number.EPSILON) return point.distanceToSquared(start);

  tempToPoint.copy(point).sub(start);
  const along = THREE.MathUtils.clamp(tempToPoint.dot(tempSegment) / lengthSquared, 0, 1);
  tempClosest.copy(start).addScaledVector(tempSegment, along);
  return point.distanceToSquared(tempClosest);
}

function createBeamMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

export class RubyBeamPath {
  constructor({
    owner,
    scene,
    role,
    color = 0xff244f,
    damage,
    fireDuration = 0.2,
    segments,
  } = {}) {
    if (!scene?.add) throw new TypeError('RubyBeamPath requires a Three.js scene or Object3D parent.');
    if (!Array.isArray(segments)) throw new TypeError('RubyBeamPath segments must be an array.');

    this.owner = owner ?? null;
    this.scene = scene;
    this.role = String(role ?? 'rubyBeam');
    this.color = new THREE.Color(color);
    this.damage = Math.max(0, safeNumber(damage));
    this.fireDuration = Math.max(0.01, safeNumber(fireDuration, 0.2));
    this.traceFadeDuration = TRACE_FADE_DURATION;

    this.state = 'guide';
    this.guideMode = 'guide';
    this.complete = false;
    this.cancelReason = null;
    this.visible = true;
    this.hitPlayer = false;
    this.dealtDamage = 0;
    this.hitSegmentIndex = -1;

    this._disposed = false;
    this._locked = false;
    this._hasFired = false;
    this._damageResolved = false;
    this._elapsed = 0;
    this._fireElapsed = 0;

    this.root = new THREE.Group();
    this.root.name = `rubyBeamPath_${sanitizeName(this.role)}`;
    this.root.userData.rubyBeamPath = this;
    this.root.userData.rubyBeamRole = this.role;
    this.scene.add(this.root);

    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.geometry.name = 'geometry_rubyBeamPathUnitSegment';
    this.materials = new Set();
    this.segments = segments.map((segment, index) => this._createSegment(segment, index));

    this._refreshEndpoints();
    this._applyVisualStyle();
    this._updateSegmentTransforms();
  }

  _createSegment(source, index) {
    if (typeof source?.getStart !== 'function' || typeof source?.getEnd !== 'function') {
      throw new TypeError(`RubyBeamPath segment ${index} requires getStart(out) and getEnd(out).`);
    }

    const coreMaterial = createBeamMaterial(this.color, 0.4);
    coreMaterial.name = `material_rubyBeamCore_${sanitizeName(this.role)}_${index}`;
    const auraMaterial = createBeamMaterial(this.color, 0.12);
    auraMaterial.name = `material_rubyBeamAura_${sanitizeName(this.role)}_${index}`;
    this.materials.add(coreMaterial);
    this.materials.add(auraMaterial);

    const group = new THREE.Group();
    group.name = `rubyBeamSegment_${sanitizeName(this.role)}_${index}`;
    group.userData.rubyBeamSegment = true;
    group.userData.rubyBeamRole = this.role;
    group.userData.segmentIndex = index;

    const aura = new THREE.Mesh(this.geometry, auraMaterial);
    aura.name = `rubyBeamAura_${sanitizeName(this.role)}_${index}`;
    aura.renderOrder = 18;
    const core = new THREE.Mesh(this.geometry, coreMaterial);
    core.name = `rubyBeamCore_${sanitizeName(this.role)}_${index}`;
    core.renderOrder = 19;
    group.add(aura, core);
    this.root.add(group);

    return {
      source,
      getStart: source.getStart,
      getEnd: source.getEnd,
      width: Math.max(0.01, safeNumber(source.width, DEFAULT_SEGMENT_WIDTH)),
      damaging: source.damaging !== false,
      lensRefs: normalizeLensRefs(source.lensRefs),
      start: new THREE.Vector3(),
      end: new THREE.Vector3(),
      lockedStart: new THREE.Vector3(),
      lockedEnd: new THREE.Vector3(),
      visual: { group, core, aura, coreMaterial, auraMaterial },
      hasVisualLength: false,
    };
  }

  _refreshEndpoints() {
    if (this._disposed) return;
    for (const segment of this.segments) {
      readEndpoint(segment, 'getStart', segment.start);
      readEndpoint(segment, 'getEnd', segment.end);
    }
  }

  _updateSegmentTransforms() {
    if (this._disposed) return;
    for (const segment of this.segments) {
      const { group, core, aura } = segment.visual;
      tempStart.copy(segment.start);
      tempEnd.copy(segment.end);
      const length = tempStart.distanceTo(tempEnd);
      segment.hasVisualLength = length > MIN_VISUAL_LENGTH;
      group.visible = this.visible && !this.complete && segment.hasVisualLength;
      if (!segment.hasVisualLength) continue;

      tempMidpoint.copy(tempStart).lerp(tempEnd, 0.5);
      group.position.copy(tempMidpoint);
      group.lookAt(tempEnd);
      core.scale.z = length;
      aura.scale.z = length;
    }
  }

  _applyVisualStyle() {
    if (this._disposed) return;
    const pulse = 0.5 + Math.sin(this._elapsed * 18) * 0.5;
    let coreColor = this.color;
    let auraColor = this.color;
    let coreOpacity = 0.4;
    let auraOpacity = 0.12;
    let coreWidthScale = 0.16;
    let auraWidthScale = 0.36;

    if (this.state === 'charging') {
      coreOpacity = 0.58 + pulse * 0.18;
      auraOpacity = 0.15 + pulse * 0.12;
      coreWidthScale = 0.25 + pulse * 0.08;
      auraWidthScale = 0.58 + pulse * 0.14;
    } else if (this.state === 'locked') {
      coreColor = LOCKED_CORE_COLOR;
      auraColor = LOCKED_AURA_COLOR;
      coreOpacity = 0.92;
      auraOpacity = 0.3;
      coreWidthScale = 0.28;
      auraWidthScale = 0.68;
    } else if (this.state === 'firing') {
      coreColor = FIRING_CORE_COLOR;
      auraColor = this.color;
      coreOpacity = 1;
      auraOpacity = 0.5 + pulse * 0.12;
      coreWidthScale = 1;
      auraWidthScale = 2.35 + pulse * 0.2;
    } else if (this.state === 'trace') {
      const fade = 1 - THREE.MathUtils.clamp(
        (this._fireElapsed - this.fireDuration) / this.traceFadeDuration,
        0,
        1,
      );
      coreColor = TRACE_CORE_COLOR;
      auraColor = this.color;
      coreOpacity = 0.72 * fade;
      auraOpacity = 0.32 * fade;
      coreWidthScale = THREE.MathUtils.lerp(0.24, 0.7, fade);
      auraWidthScale = THREE.MathUtils.lerp(0.5, 1.65, fade);
    }

    for (const segment of this.segments) {
      const { core, aura, coreMaterial, auraMaterial } = segment.visual;
      coreMaterial.color.copy(coreColor);
      coreMaterial.opacity = coreOpacity;
      auraMaterial.color.copy(auraColor);
      auraMaterial.opacity = auraOpacity;
      const coreDiameter = Math.max(0.018, segment.width * coreWidthScale * 2);
      const auraDiameter = Math.max(0.028, segment.width * auraWidthScale * 2);
      core.scale.x = coreDiameter;
      core.scale.y = coreDiameter;
      aura.scale.x = auraDiameter;
      aura.scale.y = auraDiameter;
    }
  }

  setVisible(visible) {
    if (this._disposed) return false;
    this.visible = Boolean(visible) && !this.complete;
    this.root.visible = this.visible;
    if (this.visible) this._refreshEndpoints();
    this._updateSegmentTransforms();
    return this.visible;
  }

  setGuideMode(mode) {
    if (!GUIDE_MODES.has(mode)) {
      throw new RangeError(`Unknown Ruby beam guide mode: ${mode}`);
    }
    if (this._disposed || this.complete || this._hasFired) return false;
    if (mode === 'locked') return this.lock();

    this._locked = false;
    this.guideMode = mode;
    this.state = mode;
    this._refreshEndpoints();
    this._applyVisualStyle();
    this._updateSegmentTransforms();
    return true;
  }

  update(dt, game) {
    if (this._disposed || this.complete) return this.state;
    const elapsed = Math.max(0, safeNumber(dt));
    this._elapsed += elapsed;
    // Aim targets stop changing once locked, but the live emitter, eye, and
    // mirror anchors continue to move. Refreshing here keeps the drawn and
    // damaging route attached to those anchors without allowing aim sweep.
    this._refreshEndpoints();
    if (this.state === 'firing') this._resolvePlayerHit(game);

    if (this.state === 'firing' || this.state === 'trace') {
      this._fireElapsed += elapsed;
      if (this._fireElapsed >= this.fireDuration + this.traceFadeDuration) {
        this.complete = true;
        this.state = 'complete';
        this.visible = false;
        this.root.visible = false;
        return this.state;
      }
      this.state = this._fireElapsed >= this.fireDuration ? 'trace' : 'firing';
    }

    this._applyVisualStyle();
    this._updateSegmentTransforms();
    return this.state;
  }

  lock() {
    if (this._disposed || this.complete || this._hasFired) return false;
    if (!this._locked) {
      this._refreshEndpoints();
      for (const segment of this.segments) {
        segment.lockedStart.copy(segment.start);
        segment.lockedEnd.copy(segment.end);
      }
      this._locked = true;
    }
    this.guideMode = 'locked';
    this.state = 'locked';
    this._applyVisualStyle();
    this._updateSegmentTransforms();
    return true;
  }

  fire(game) {
    if (this._disposed || this.complete || this._hasFired) return false;
    if (!this._locked && !this.lock()) return false;

    this._hasFired = true;
    this._fireElapsed = 0;
    this.state = 'firing';
    this.visible = true;
    this.root.visible = true;
    this._refreshEndpoints();
    this._applyVisualStyle();
    this._updateSegmentTransforms();
    this._resolvePlayerHit(game);
    return this.hitPlayer;
  }

  _resolvePlayerHit(game) {
    if (this._damageResolved) return this.hitPlayer;
    const player = game?.player;
    const playerPosition = player?.root?.position;
    if (!playerPosition || player.dead) return false;

    const playerRadius = Math.max(0, safeNumber(player.radius, DEFAULT_PLAYER_RADIUS));
    tempPlayerHitPoint.copy(playerPosition);
    tempPlayerHitPoint.y += Math.max(0.62, safeNumber(player.collisionHeight, 2.85) * 0.34);
    let closestHit = null;
    for (let index = 0; index < this.segments.length; index += 1) {
      const segment = this.segments[index];
      if (!segment.damaging) continue;
      const distanceSquared = pointToSegmentDistanceSquared(
        tempPlayerHitPoint,
        segment.start,
        segment.end,
      );
      const hitRadius = segment.width + playerRadius;
      if (distanceSquared > hitRadius * hitRadius) continue;
      if (!closestHit || distanceSquared < closestHit.distanceSquared) {
        closestHit = { index, distanceSquared };
      }
    }

    if (!closestHit) return false;
    this._damageResolved = true;
    this.hitPlayer = true;
    this.hitSegmentIndex = closestHit.index;
    const hitResult = player.takeIncomingHit({
      amount: this.damage,
      source: this.owner,
      attackKind: `rubyBeam:${this.role}`,
      bossAttackRole: this.role,
      rubyBeamRole: this.role,
      rubyBeamPath: true,
      guardable: true,
      reactionTier: 1,
    });
    this.dealtDamage = Math.max(0, safeNumber(hitResult.healthDamage));
    return true;
  }

  cancel(reason = 'cancelled') {
    if (this._disposed || this.complete) return false;
    this.cancelReason = String(reason ?? 'cancelled');
    this.complete = true;
    this.state = 'cancelled';
    this.visible = false;
    this.root.visible = false;
    // Cancellation is expected to be instantaneous when a lens is shot.
    // Release GPU and scene resources now instead of waiting for a later
    // encounter update to prune the completed path.
    this._disposed = true;
    this._releaseResources();
    return true;
  }

  referencesLens(lens) {
    if (!lens) return false;
    return this.segments.some((segment) => segment.lensRefs.includes(lens));
  }

  getTelegraphCount() {
    if (this._disposed || !this.root.visible) return 0;
    return this.segments.reduce(
      (count, segment) => count + Number(segment.visual.group.visible),
      0,
    );
  }

  dispose() {
    if (this._disposed) return false;
    this._disposed = true;
    this.complete = true;
    this.visible = false;
    this.state = 'disposed';
    this.root.visible = false;
    this._releaseResources();
    return true;
  }

  _releaseResources() {
    this.root.removeFromParent();
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.materials.clear();
    this.root.clear();
  }
}

export default RubyBeamPath;
