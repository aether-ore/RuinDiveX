import * as THREE from 'three';

const EMITTER_MODES = new Set([
  'idle',
  'guide',
  'charging',
  'attack',
  'overdrive',
  'cooldown',
]);

const MODE_PRESENTATION = Object.freeze({
  idle: Object.freeze({
    beam: false,
    guideOpacity: 0,
    coreOpacity: 0,
    auraOpacity: 0,
    guideRadius: 0.012,
    coreRadius: 0.025,
    auraRadius: 0.06,
    emissive: 0.72,
    light: 0.18,
    rotation: 0.3,
    moteSpeed: 0,
  }),
  guide: Object.freeze({
    beam: true,
    guideOpacity: 0.28,
    coreOpacity: 0.04,
    auraOpacity: 0.035,
    guideRadius: 0.022,
    coreRadius: 0.032,
    auraRadius: 0.075,
    emissive: 1.1,
    light: 0.32,
    rotation: 0.7,
    moteSpeed: 0,
  }),
  charging: Object.freeze({
    beam: true,
    guideOpacity: 0.46,
    coreOpacity: 0.58,
    auraOpacity: 0.18,
    guideRadius: 0.032,
    coreRadius: 0.06,
    auraRadius: 0.15,
    emissive: 2.25,
    light: 0.72,
    rotation: 1.75,
    moteSpeed: 1.6,
  }),
  attack: Object.freeze({
    beam: true,
    guideOpacity: 0.34,
    coreOpacity: 0.96,
    auraOpacity: 0.44,
    guideRadius: 0.04,
    coreRadius: 0.105,
    auraRadius: 0.245,
    emissive: 3.6,
    light: 1.15,
    rotation: 3.2,
    moteSpeed: 2.8,
  }),
  overdrive: Object.freeze({
    beam: true,
    guideOpacity: 0.48,
    coreOpacity: 1,
    auraOpacity: 0.62,
    guideRadius: 0.052,
    coreRadius: 0.14,
    auraRadius: 0.34,
    emissive: 4.8,
    light: 1.55,
    rotation: 4.6,
    moteSpeed: 4,
  }),
  cooldown: Object.freeze({
    beam: true,
    guideOpacity: 0.1,
    coreOpacity: 0.025,
    auraOpacity: 0.02,
    guideRadius: 0.018,
    coreRadius: 0.028,
    auraRadius: 0.07,
    emissive: 0.46,
    light: 0.08,
    rotation: 0.16,
    moteSpeed: 0,
  }),
});

const UNIT_Y = new THREE.Vector3(0, 1, 0);
const tempSource = new THREE.Vector3();
const tempTarget = new THREE.Vector3();
const tempDirection = new THREE.Vector3();
const tempMidpoint = new THREE.Vector3();
const tempSide = new THREE.Vector3();
const tempBinormal = new THREE.Vector3();
const tempWorld = new THREE.Vector3();

function resolveTargetPosition(target, out) {
  if (!target) return false;
  if (target.isVector3) {
    out.copy(target);
    return true;
  }
  if (target.isObject3D && typeof target.getWorldPosition === 'function') {
    target.getWorldPosition(out);
    return true;
  }
  if (target.position?.isVector3) {
    out.copy(target.position);
    return true;
  }
  if (typeof target.getWorldPosition === 'function') {
    target.getWorldPosition(out);
    return true;
  }
  return false;
}

/**
 * Static arena machinery and its harmless ceiling-to-Oracle energy feed.
 * Gameplay damage is intentionally owned by RubyBeamPath/the encounter; every
 * object in feedBeam is presentation-only.
 */
export class RubyCeilingEmitter {
  constructor({
    owner = null,
    scene = null,
    center = new THREE.Vector3(),
    ceilingY = center?.y ?? 0,
  } = {}) {
    this.owner = owner;
    this.scene = scene;
    this.center = center?.clone?.() ?? new THREE.Vector3();
    this.ceilingY = Number.isFinite(Number(ceilingY)) ? Number(ceilingY) : this.center.y;
    this.mode = 'idle';
    this.modeTime = 0;
    this.elapsed = 0;
    this.disposed = false;
    this._geometries = new Set();
    this._materials = new Set();

    this.root = new THREE.Group();
    this.root.name = 'rubyCeilingEmitter';
    this.root.position.set(this.center.x, this.ceilingY, this.center.z);
    this.root.userData.rubyCeilingEmitter = true;
    this.root.userData.mode = this.mode;

    this.fixtureRoot = new THREE.Group();
    this.fixtureRoot.name = 'rubyCeilingEmitterFixture';
    this.root.add(this.fixtureRoot);

    this.feedBeamRoot = new THREE.Group();
    this.feedBeamRoot.name = 'rubyCeilingEmitterFeedBeam';
    this.feedBeamRoot.visible = false;
    this.feedBeamRoot.userData.nonDamaging = true;
    this.feedBeamRoot.userData.rubyEnergyFeed = true;

    this._buildFixture();
    this._buildFeedBeam();
    this.scene?.add?.(this.root);
    this.scene?.add?.(this.feedBeamRoot);
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
    this.darkMaterial = this._ownMaterial(new THREE.MeshStandardMaterial({
      color: 0x17171a,
      emissive: 0x220007,
      emissiveIntensity: 0.12,
      roughness: 0.38,
      metalness: 0.82,
    }), 'material_rubyCeilingEmitterDark');
    this.armorMaterial = this._ownMaterial(new THREE.MeshStandardMaterial({
      color: 0x535038,
      emissive: 0x2b1607,
      emissiveIntensity: 0.12,
      roughness: 0.48,
      metalness: 0.72,
    }), 'material_rubyCeilingEmitterArmor');
    this.goldMaterial = this._ownMaterial(new THREE.MeshStandardMaterial({
      color: 0xd9bd6a,
      emissive: 0x6d2c08,
      emissiveIntensity: 0.3,
      roughness: 0.27,
      metalness: 0.86,
    }), 'material_rubyCeilingEmitterGold');
    this.rubyMaterial = this._ownMaterial(new THREE.MeshStandardMaterial({
      color: 0xff315f,
      emissive: 0xff0d3f,
      emissiveIntensity: 0.72,
      roughness: 0.12,
      metalness: 0.08,
    }), 'material_rubyCeilingEmitterRuby');
    this.apertureMaterial = this._ownMaterial(new THREE.MeshBasicMaterial({
      color: 0xff315f,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }), 'material_rubyCeilingEmitterAperture');

    const mountGeometry = this._ownGeometry(new THREE.CylinderGeometry(1.72, 1.5, 0.34, 12, 2));
    this._addMesh(
      this.fixtureRoot,
      mountGeometry,
      this.armorMaterial,
      'rubyCeilingEmitterMount',
      new THREE.Vector3(0, -0.17, 0),
    );
    const mountRingGeometry = this._ownGeometry(new THREE.TorusGeometry(1.38, 0.09, 8, 48));
    this.mountRing = this._addMesh(
      this.fixtureRoot,
      mountRingGeometry,
      this.goldMaterial,
      'rubyCeilingEmitterMountRing',
      new THREE.Vector3(0, -0.35, 0),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    );

    const socketGeometry = this._ownGeometry(new THREE.CylinderGeometry(0.68, 0.9, 0.58, 16, 2));
    this._addMesh(
      this.fixtureRoot,
      socketGeometry,
      this.darkMaterial,
      'rubyCeilingEmitterDarkSocket',
      new THREE.Vector3(0, -0.58, 0),
    );

    const braceGeometry = this._ownGeometry(new THREE.BoxGeometry(0.18, 0.72, 0.24));
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2;
      const brace = this._addMesh(
        this.fixtureRoot,
        braceGeometry,
        index % 2 === 0 ? this.goldMaterial : this.armorMaterial,
        `rubyCeilingEmitterBrace_${index}`,
        new THREE.Vector3(Math.cos(angle) * 1.12, -0.58, Math.sin(angle) * 1.12),
      );
      brace.rotation.y = -angle;
      brace.rotation.z = Math.sin(angle) * 0.18;
    }

    this.gimbalOuter = new THREE.Group();
    this.gimbalOuter.name = 'rubyCeilingEmitterOuterGimbal';
    this.gimbalOuter.position.y = -0.92;
    this.fixtureRoot.add(this.gimbalOuter);
    const outerGimbalGeometry = this._ownGeometry(new THREE.TorusGeometry(0.91, 0.075, 8, 52));
    this._addMesh(
      this.gimbalOuter,
      outerGimbalGeometry,
      this.goldMaterial,
      'rubyCeilingEmitterOuterGimbalRing',
      null,
      new THREE.Euler(0, 0, 0),
    );

    this.gimbalInner = new THREE.Group();
    this.gimbalInner.name = 'rubyCeilingEmitterInnerGimbal';
    this.gimbalOuter.add(this.gimbalInner);
    const innerGimbalGeometry = this._ownGeometry(new THREE.TorusGeometry(0.67, 0.055, 7, 44));
    this._addMesh(
      this.gimbalInner,
      innerGimbalGeometry,
      this.armorMaterial,
      'rubyCeilingEmitterInnerGimbalRing',
      null,
      new THREE.Euler(0, Math.PI * 0.5, 0),
    );

    const coreHousingGeometry = this._ownGeometry(new THREE.SphereGeometry(0.48, 24, 16));
    this.coreHousing = this._addMesh(
      this.gimbalInner,
      coreHousingGeometry,
      this.darkMaterial,
      'rubyCeilingEmitterCoreHousing',
    );
    this.coreHousing.scale.set(1, 0.72, 1);

    const rubyCoreGeometry = this._ownGeometry(new THREE.OctahedronGeometry(0.33, 2));
    this.rubyCore = this._addMesh(
      this.gimbalInner,
      rubyCoreGeometry,
      this.rubyMaterial,
      'rubyCeilingEmitterRubyCore',
    );
    this.rubyCore.castShadow = false;

    const apertureGeometry = this._ownGeometry(new THREE.RingGeometry(0.18, 0.47, 40));
    this.aperture = this._addMesh(
      this.fixtureRoot,
      apertureGeometry,
      this.apertureMaterial,
      'rubyCeilingEmitterAperture',
      new THREE.Vector3(0, -1.34, 0),
      new THREE.Euler(Math.PI * 0.5, 0, 0),
    );
    this.aperture.castShadow = false;
    this.aperture.receiveShadow = false;
    this.aperture.renderOrder = 8;

    const nozzleGeometry = this._ownGeometry(new THREE.CylinderGeometry(0.24, 0.43, 0.52, 16, 1, true));
    this.nozzle = this._addMesh(
      this.fixtureRoot,
      nozzleGeometry,
      this.goldMaterial,
      'rubyCeilingEmitterNozzle',
      new THREE.Vector3(0, -1.19, 0),
    );

    this.sourceAnchor = new THREE.Object3D();
    this.sourceAnchor.name = 'rubyCeilingEmitterSourceAnchor';
    this.sourceAnchor.position.set(0, -1.48, 0);
    this.fixtureRoot.add(this.sourceAnchor);

    // One small, non-shadowing light gives the fixture local response without
    // turning every beam segment into an expensive dynamic light source.
    this.coreLight = new THREE.PointLight(0xff315f, 0.18, 8, 2);
    this.coreLight.name = 'rubyCeilingEmitterCoreLight';
    this.coreLight.position.set(0, -1.02, 0);
    this.coreLight.castShadow = false;
    this.fixtureRoot.add(this.coreLight);

    this.fixtureRoot.traverse((object) => {
      object.userData.rubyCeilingEmitter = true;
    });
  }

  _buildFeedBeam() {
    this.feedGeometry = this._ownGeometry(new THREE.CylinderGeometry(1, 1, 1, 14, 1, true));
    this.guideMaterial = this._ownMaterial(new THREE.MeshBasicMaterial({
      color: 0xffb07a,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }), 'material_rubyCeilingEmitterGuideBeam');
    this.feedCoreMaterial = this._ownMaterial(new THREE.MeshBasicMaterial({
      color: 0xff315f,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }), 'material_rubyCeilingEmitterFeedCore');
    this.feedAuraMaterial = this._ownMaterial(new THREE.MeshBasicMaterial({
      color: 0xff164f,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }), 'material_rubyCeilingEmitterFeedAura');
    this.moteMaterial = this._ownMaterial(new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }), 'material_rubyCeilingEmitterFeedMotes');

    this.guideBeam = this._addMesh(
      this.feedBeamRoot,
      this.feedGeometry,
      this.guideMaterial,
      'rubyCeilingEmitterGuideFeed',
    );
    this.feedAura = this._addMesh(
      this.feedBeamRoot,
      this.feedGeometry,
      this.feedAuraMaterial,
      'rubyCeilingEmitterFeedAura',
    );
    this.feedCore = this._addMesh(
      this.feedBeamRoot,
      this.feedGeometry,
      this.feedCoreMaterial,
      'rubyCeilingEmitterFeedCore',
    );
    for (const beam of [this.guideBeam, this.feedAura, this.feedCore]) {
      beam.castShadow = false;
      beam.receiveShadow = false;
      beam.frustumCulled = false;
      beam.renderOrder = beam === this.feedCore ? 12 : 11;
      beam.userData.nonDamaging = true;
    }

    const moteGeometry = this._ownGeometry(new THREE.SphereGeometry(0.045, 8, 6));
    this.flowMotes = [];
    for (let index = 0; index < 7; index += 1) {
      const mote = this._addMesh(
        this.feedBeamRoot,
        moteGeometry,
        this.moteMaterial,
        `rubyCeilingEmitterFeedMote_${index}`,
      );
      mote.castShadow = false;
      mote.receiveShadow = false;
      mote.visible = false;
      mote.renderOrder = 13;
      mote.userData.nonDamaging = true;
      this.flowMotes.push(mote);
    }

    this.feedBeam = {
      root: this.feedBeamRoot,
      guide: this.guideBeam,
      core: this.feedCore,
      aura: this.feedAura,
      motes: this.flowMotes,
      damaging: false,
    };
  }

  setMode(mode) {
    const resolved = String(mode ?? '').toLowerCase();
    if (this.disposed || !EMITTER_MODES.has(resolved)) return false;
    if (resolved !== this.mode) {
      this.mode = resolved;
      this.modeTime = 0;
      this.root.userData.mode = resolved;
    }
    return true;
  }

  getSourcePosition(out = new THREE.Vector3()) {
    return this.sourceAnchor.getWorldPosition(out);
  }

  _setBeamTransform(mesh, source, direction, length, radius) {
    mesh.position.copy(source).addScaledVector(direction, length * 0.5);
    mesh.quaternion.setFromUnitVectors(UNIT_Y, direction);
    mesh.scale.set(radius, length, radius);
  }

  _hideFeedBeam() {
    this.feedBeamRoot.visible = false;
    this.guideMaterial.opacity = 0;
    this.feedCoreMaterial.opacity = 0;
    this.feedAuraMaterial.opacity = 0;
    for (const mote of this.flowMotes) mote.visible = false;
  }

  update(dt, targetPosition) {
    if (this.disposed) return;
    const delta = Math.max(0, Number(dt) || 0);
    this.elapsed += delta;
    this.modeTime += delta;
    const presentation = MODE_PRESENTATION[this.mode] ?? MODE_PRESENTATION.idle;
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * (this.mode === 'overdrive' ? 13 : 8));

    this.gimbalOuter.rotation.y += delta * presentation.rotation;
    this.gimbalOuter.rotation.z = Math.sin(this.elapsed * 0.72) * 0.08;
    this.gimbalInner.rotation.x += delta * presentation.rotation * -0.72;
    this.gimbalInner.rotation.z += delta * presentation.rotation * 0.38;
    this.mountRing.rotation.z += delta * presentation.rotation * 0.16;
    this.rubyCore.rotation.y += delta * presentation.rotation * 1.45;
    this.rubyCore.rotation.x -= delta * presentation.rotation * 0.62;
    const coreScale = 1 + pulse * (
      this.mode === 'overdrive' ? 0.16
        : this.mode === 'attack' ? 0.1
          : this.mode === 'charging' ? 0.065
            : 0.025
    );
    this.rubyCore.scale.setScalar(coreScale);
    this.rubyMaterial.emissiveIntensity = presentation.emissive * (0.88 + pulse * 0.22);
    this.goldMaterial.emissiveIntensity = 0.26 + presentation.light * 0.34 + pulse * 0.1;
    this.apertureMaterial.opacity = THREE.MathUtils.clamp(
      0.12 + presentation.light * 0.3 + pulse * presentation.light * 0.12,
      0,
      0.92,
    );
    const refractorScale = this.mode === 'overdrive' ? 1.34 : 1;
    this.aperture.scale.setScalar(refractorScale + pulse * presentation.light * 0.09);
    const gimbalScale = this.mode === 'overdrive' ? 1.12 : 1;
    this.gimbalOuter.scale.lerp(
      tempWorld.setScalar(gimbalScale),
      Math.min(1, delta * 4.5),
    );
    this.coreLight.intensity = presentation.light * (0.86 + pulse * 0.28);
    this.coreLight.color.setHex(
      this.mode === 'attack' || this.mode === 'overdrive' ? 0xfff0ee : 0xff315f,
    );

    if (!presentation.beam || !resolveTargetPosition(targetPosition, tempTarget)) {
      this._hideFeedBeam();
      return;
    }
    this.getSourcePosition(tempSource);
    tempDirection.copy(tempTarget).sub(tempSource);
    const length = tempDirection.length();
    if (length <= 0.02) {
      this._hideFeedBeam();
      return;
    }
    tempDirection.divideScalar(length);
    tempMidpoint.copy(tempSource).addScaledVector(tempDirection, length * 0.5);
    this.feedBeamRoot.visible = true;
    const activePulse = 0.88 + pulse * 0.18;
    this.guideMaterial.opacity = presentation.guideOpacity * activePulse;
    this.feedCoreMaterial.opacity = presentation.coreOpacity * activePulse;
    this.feedAuraMaterial.opacity = presentation.auraOpacity * (0.82 + pulse * 0.25);
    this.feedCoreMaterial.color.setHex(
      this.mode === 'attack' || this.mode === 'overdrive' ? 0xfff4f2 : 0xff315f,
    );
    this._setBeamTransform(
      this.guideBeam,
      tempSource,
      tempDirection,
      length,
      presentation.guideRadius,
    );
    this._setBeamTransform(
      this.feedCore,
      tempSource,
      tempDirection,
      length,
      presentation.coreRadius * activePulse,
    );
    this._setBeamTransform(
      this.feedAura,
      tempSource,
      tempDirection,
      length,
      presentation.auraRadius * (0.9 + pulse * 0.16),
    );

    const showMotes = presentation.moteSpeed > 0;
    this.moteMaterial.opacity = showMotes
      ? THREE.MathUtils.clamp(0.32 + presentation.light * 0.42, 0, 1)
      : 0;
    tempSide.crossVectors(tempDirection, UNIT_Y);
    if (tempSide.lengthSq() <= 1e-6) tempSide.set(1, 0, 0);
    else tempSide.normalize();
    tempBinormal.crossVectors(tempDirection, tempSide).normalize();
    for (let index = 0; index < this.flowMotes.length; index += 1) {
      const mote = this.flowMotes[index];
      mote.visible = showMotes;
      if (!showMotes) continue;
      const fraction = (this.modeTime * presentation.moteSpeed + index / this.flowMotes.length) % 1;
      const helixAngle = fraction * Math.PI * 5 + index * 1.37;
      const helixRadius = presentation.auraRadius * (0.38 + 0.22 * Math.sin(fraction * Math.PI));
      tempWorld.lerpVectors(tempSource, tempTarget, fraction)
        .addScaledVector(tempSide, Math.cos(helixAngle) * helixRadius)
        .addScaledVector(tempBinormal, Math.sin(helixAngle) * helixRadius);
      mote.position.copy(tempWorld);
      mote.scale.setScalar(0.65 + pulse * 0.38 + presentation.light * 0.2);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._hideFeedBeam();
    this.root.removeFromParent();
    this.feedBeamRoot.removeFromParent();
    for (const geometry of this._geometries) geometry.dispose?.();
    for (const material of this._materials) material.dispose?.();
    this._geometries.clear();
    this._materials.clear();
    this.scene = null;
    this.owner = null;
  }
}

export default RubyCeilingEmitter;
