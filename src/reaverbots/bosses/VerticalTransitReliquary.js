import * as THREE from 'three';
import {
  ASCENSION_ENGINE_PROFILE_ID,
  ASCENSION_ENGINE_TUNING,
  ASCENSION_RELIQUARY_SCALE,
  ASCENSION_RELIQUARY_SEGMENTS,
} from './AscensionEngineContract.js';

export const VERTICAL_TRANSIT_RELIQUARY_ID = 'verticalTransitReliquary';
export const VERTICAL_TRANSIT_RELIQUARY_REVISION = 2;

const STOCK_BOSS_FIXTURE_NAMES = new Set([
  'bossArenaContainmentPylon',
  'bossArenaWarningCore',
  'bossArenaSignalRail',
  'bossArenaCentralBeacon',
  'bossRoomColossalEngine',
  'bossRoomLoadBearingGirder',
]);
function material(options) {
  const result = new THREE.MeshStandardMaterial({ flatShading: true, ...options });
  result.name = options.name;
  return result;
}

function basicMaterial(options) {
  const result = new THREE.MeshBasicMaterial(options);
  result.name = options.name;
  return result;
}

function addBox(group, name, size, position, materialRef, { castShadow = true } = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), materialRef);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addPlatformFrame(group, name, width, depth, topY, materialRef, {
  x = 0,
  z = 0,
  railWidth = 0.16,
  railHeight = 0.08,
} = {}) {
  const y = topY + railHeight * 0.5 + 0.002;
  const halfX = Math.max(0, width * 0.5 - railWidth * 0.5);
  const halfZ = Math.max(0, depth * 0.5 - railWidth * 0.5);
  addBox(group, `${name}North`, [width, railHeight, railWidth], [x, y, z - halfZ], materialRef);
  addBox(group, `${name}South`, [width, railHeight, railWidth], [x, y, z + halfZ], materialRef);
  addBox(group, `${name}West`, [railWidth, railHeight, Math.max(railWidth, depth - railWidth * 2)], [x - halfX, y, z], materialRef);
  addBox(group, `${name}East`, [railWidth, railHeight, Math.max(railWidth, depth - railWidth * 2)], [x + halfX, y, z], materialRef);
}

function addCylinder(group, name, radiusTop, radiusBottom, height, position, materialRef, segments = 10) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
    materialRef,
  );
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addRing(group, name, radius, tube, position, materialRef, segments = 48) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 7, segments), materialRef);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.x = Math.PI * 0.5;
  group.add(mesh);
  return mesh;
}

function disposeTree(root) {
  if (!root || root.userData.verticalReliquaryDisposed) return;
  root.userData.verticalReliquaryDisposed = true;
  const geometries = new Set();
  const materials = new Set(root.userData.authoredOwnedMaterials ?? []);
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const objectMaterial of objectMaterials) if (objectMaterial) materials.add(objectMaterial);
  });
  root.removeFromParent();
  geometries.forEach((geometry) => geometry.dispose?.());
  materials.forEach((objectMaterial) => objectMaterial.dispose?.());
}

function platformContainsTop(platform, position, inset = 0) {
  if (!platform?.enabled || !position) return false;
  const xLimit = Math.max(0, platform.halfWidth - Math.max(0, Number(inset) || 0));
  const zLimit = Math.max(0, platform.halfDepth - Math.max(0, Number(inset) || 0));
  return Math.abs(position.x - platform.center.x) <= xLimit
    && Math.abs(position.z - platform.center.z) <= zLimit;
}

function createPlatformDescriptor({ id, role, center, width, depth, topY, baseY, object, dynamic = false }) {
  const descriptor = {
    id,
    environmentId: VERTICAL_TRANSIT_RELIQUARY_ID,
    role,
    center: center.clone().setY(topY),
    halfWidth: width * 0.5,
    halfDepth: depth * 0.5,
    topY,
    baseY,
    enabled: true,
    active: true,
    oneWay: true,
    dynamic,
    blocksBelow: false,
    createsLedgeCandidates: true,
    ledgeCatchMode: 'instant-step',
    object,
    containsTop(position, inset = 0) {
      return platformContainsTop(descriptor, position, inset);
    },
    getTopY(position) {
      return descriptor.containsTop(position) ? descriptor.topY : null;
    },
  };
  return descriptor;
}

function checkpointId(index) {
  return index <= 0
    ? 'ascensionCheckpoint:initialFloor'
    : `ascensionCheckpoint:${ASCENSION_RELIQUARY_SEGMENTS[index - 1]?.id ?? 'compressionFoundry'}`;
}

function sealStationId(index) {
  return `compressionSealStation:${ASCENSION_RELIQUARY_SEGMENTS[index]?.id ?? 'compressionFoundry'}`;
}

export class VerticalTransitReliquary {
  constructor({ room, tileSize = 2.8, seed = 'vertical-transit-reliquary' } = {}) {
    if (!room) throw new TypeError('Vertical Transit Reliquary requires the logical bossRoom.');
    this.id = VERTICAL_TRANSIT_RELIQUARY_ID;
    this.revision = VERTICAL_TRANSIT_RELIQUARY_REVISION;
    this.profileId = ASCENSION_ENGINE_PROFILE_ID;
    this.seed = String(seed);
    this.roomId = room.id;
    this.room = room;
    this.tileSize = tileSize;
    this.center = new THREE.Vector3(room.x * tileSize, 0, room.z * tileSize);
    this.root = new THREE.Group();
    this.root.name = 'verticalTransitReliquaryAuthoredEnvironment';
    this.root.position.set(this.center.x, 0, this.center.z);
    this.root.userData.environmentId = this.id;
    this.root.userData.environmentRevision = this.revision;
    this.root.userData.authoredBossEnvironment = true;
    this.platforms = [];
    this.platformById = new Map();
    this.routePlatformsBySegment = new Map();
    this.checkpoints = [];
    this.sealPlatforms = [];
    this.sealStations = [];
    this.masteryPlatforms = [];
    this.collisionZones = [];
    this.chamberRoots = [];
    this.hiddenStockFixtures = [];
    this.hiddenGlobalFixtures = [];
    this.game = null;
    this.attachedGroup = null;
    this.attachedPlatformList = null;
    this.attachedSolidZoneList = null;
    this.disposed = false;
    this.activeSegmentIndex = 0;
    this.completed = false;
    this.masteryRouteActive = false;
    this.masteryRouteAnnounced = false;
    this.postClearRecoveryCooldown = 0;
    this.elapsed = 0;
    this.cameraProfileRestore = null;
    this.fogRestore = null;
    this._build();
  }

  _build() {
    this.materials = {
      void: basicMaterial({ name: 'material_ascensionVoid', color: 0x030405, side: THREE.DoubleSide }),
      dark: material({ name: 'material_ascensionDarkIron', color: 0x17191b, roughness: 0.72, metalness: 0.68 }),
      armor: material({ name: 'material_ascensionRuinIvory', color: 0xa99c7e, roughness: 0.82, metalness: 0.24 }),
      verdigris: material({ name: 'material_ascensionVerdigris', color: 0x344d43, roughness: 0.78, metalness: 0.42 }),
      gold: material({ name: 'material_ascensionAncientGold', color: 0xb28c45, roughness: 0.43, metalness: 0.78 }),
      hazard: material({ name: 'material_ascensionHazard', color: 0x5e2b16, emissive: 0xff5a1f, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.38 }),
      ventIdle: material({ name: 'material_ascensionVentIdle', color: 0x46180f, emissive: 0x5c1005, emissiveIntensity: 0.25, roughness: 0.5, metalness: 0.5 }),
      ventCharge: material({ name: 'material_ascensionVentCharge', color: 0xdca544, emissive: 0xff731e, emissiveIntensity: 1.35, roughness: 0.3, metalness: 0.35 }),
      ventLaunch: material({ name: 'material_ascensionVentLaunch', color: 0xffffff, emissive: 0xffe6b0, emissiveIntensity: 3.5, roughness: 0.16, metalness: 0.1 }),
      guide: basicMaterial({ name: 'material_ascensionRouteGuide', color: 0xffd36f, transparent: true, opacity: 0.46, depthWrite: false, blending: THREE.AdditiveBlending }),
    };
    this.root.userData.authoredOwnedMaterials = new Set(Object.values(this.materials));

    const voidDisk = new THREE.Mesh(new THREE.CircleGeometry(ASCENSION_RELIQUARY_SCALE.voidRadius, 96), this.materials.void);
    voidDisk.name = 'verticalReliquaryCentralAbyss';
    voidDisk.rotation.x = -Math.PI * 0.5;
    voidDisk.position.y = 0.035;
    voidDisk.receiveShadow = true;
    this.root.add(voidDisk);

    this._buildShaftShell();
    this._buildChambers();
    this._buildSummit();
    this.setActiveSegment(0);
  }

  _buildShaftShell() {
    const shell = new THREE.Group();
    shell.name = 'verticalReliquaryShaftShell';
    const shaftHeight = ASCENSION_RELIQUARY_SCALE.shellHeight;
    const pillarCount = 16;
    for (let index = 0; index < pillarCount; index += 1) {
      // Four broad camera bays keep the route and the boss readable from the
      // outer decks. The remaining supports establish scale without becoming
      // a cage around the combat camera.
      if ([0, 4, 8, 12].includes(index)) continue;
      const angle = index / pillarCount * Math.PI * 2;
      const radius = ASCENSION_RELIQUARY_SCALE.architectureRadius;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const major = index % 2 === 0;
      const width = major ? 1.15 : 0.58;
      const pillar = addBox(
        shell,
        `verticalReliquaryShaftPillar_${index}`,
        [width, shaftHeight, width],
        [x, shaftHeight * 0.5, z],
        major ? this.materials.armor : this.materials.dark,
      );
      this._registerCollisionZone({
        id: `verticalReliquaryShaftPillarCollision:${index}`,
        x,
        z,
        baseY: 0,
        height: shaftHeight,
        halfWidth: width * 0.5,
        halfDepth: width * 0.5,
      });
      pillar.rotation.y = -angle;
      if (major) {
        for (let y = 8; y < shaftHeight; y += 8) {
          addBox(shell, `verticalReliquaryPillarBand_${index}_${y}`, [width + 0.38, 0.28, width + 0.38], [x, y, z], this.materials.gold);
        }
      }
    }
    const boundaryHeights = [0.45, ...ASCENSION_RELIQUARY_SEGMENTS.map((segment) => segment.checkpointHeight), shaftHeight - 0.5];
    for (const y of boundaryHeights) {
      addRing(shell, `verticalReliquaryShaftRing_${y}`, ASCENSION_RELIQUARY_SCALE.architectureRadius - 0.45, 0.18, [0, y, 0], this.materials.gold, 96);
    }
    for (const [index, y] of [9, 29, 52, 74].entries()) {
      const arch = addRing(shell, `verticalReliquaryBrokenTransitRing_${index}`, ASCENSION_RELIQUARY_SCALE.architectureRadius - 2.4, 0.3, [0, y, 0], index === 3 ? this.materials.hazard : this.materials.dark, 64);
      arch.scale.set(1, 1, index % 2 === 0 ? 0.92 : 1.05);
    }
    this.root.add(shell);
  }

  _buildChambers() {
    this.checkpoints.push(this._createInitialCheckpoint());
    for (const segment of ASCENSION_RELIQUARY_SEGMENTS) {
      const chamber = new THREE.Group();
      chamber.name = `verticalReliquaryChamber_${segment.id}`;
      chamber.userData.segmentIndex = segment.index;
      chamber.userData.segmentId = segment.id;
      this.root.add(chamber);
      this.chamberRoots.push(chamber);

      this._buildChamberArchitecture(chamber, segment);
      const sealPlatform = this._createCheckpointPlatform(chamber, segment);
      this.sealPlatforms.push(sealPlatform);
      if (segment.index < ASCENSION_RELIQUARY_SEGMENTS.length - 1) {
        this.checkpoints.push({
          id: checkpointId(segment.index + 1),
          segmentId: segment.id,
          index: segment.index + 1,
          platform: sealPlatform.platform,
          position: sealPlatform.position.clone(),
          facing: sealPlatform.facing.clone(),
        });
      }
      this.sealStations.push({
        id: sealStationId(segment.index),
        segmentId: segment.id,
        index: segment.index,
        position: sealPlatform.position.clone().add(new THREE.Vector3(0, 1.3, 0.1)),
        platform: sealPlatform.platform,
      });

      const routePlatforms = [];
      for (const route of segment.route) {
        const platform = this._createRoutePlatform(chamber, segment, route);
        routePlatforms.push(platform);
      }
      this.routePlatformsBySegment.set(segment.index, routePlatforms);
      this.masteryPlatforms.push(this._createMasteryPlatform(chamber, segment));
    }
  }

  _createMasteryPlatform(chamber, segment) {
    const width = 8;
    const depth = 8;
    const topY = segment.startHeight + ASCENSION_ENGINE_TUNING.masteryShortcutRise;
    const priorCheckpointZ = segment.index === 0
      ? ASCENSION_RELIQUARY_SCALE.initialCheckpoint.offset[2]
      : ASCENSION_RELIQUARY_SEGMENTS[segment.index - 1].checkpointOffset[2];
    const localZ = priorCheckpointZ - Math.sign(priorCheckpointZ || 1) * 7;
    const group = new THREE.Group();
    group.name = `verticalReliquaryMasteryShortcut_${segment.id}`;
    group.position.set(0, topY, localZ);
    group.visible = false;
    chamber.add(group);
    addBox(group, 'verticalReliquaryMasteryShortcutBody', [width, 0.3, depth], [0, -0.15, 0], this.materials.verdigris);
    addPlatformFrame(group, 'verticalReliquaryMasteryShortcutTrim', width, depth, 0, this.materials.gold);
    const springGlyph = addRing(group, 'verticalReliquaryMasterySpringGlyph', 2.1, 0.12, [0, 0.04, 0], this.materials.hazard, 36);
    springGlyph.rotation.z = Math.PI * 0.25;
    const world = this.root.localToWorld(new THREE.Vector3(0, topY, localZ));
    const descriptor = createPlatformDescriptor({
      id: `verticalReliquaryMastery:${segment.id}`,
      role: 'masteryShortcut',
      center: world,
      width,
      depth,
      topY,
      baseY: segment.startHeight,
      object: group,
    });
    descriptor.segmentIndex = segment.index;
    descriptor.segmentId = segment.id;
    descriptor.masteryShortcut = true;
    descriptor.requiresGearId = 'jumpSprings';
    descriptor.enabled = false;
    descriptor.active = false;
    descriptor.group = group;
    this._registerPlatform(descriptor);
    return descriptor;
  }

  _createInitialCheckpoint() {
    const chamber = new THREE.Group();
    chamber.name = 'verticalReliquaryInitialEncounterFloor';
    this.root.add(chamber);
    const [localX, topY, localZ] = ASCENSION_RELIQUARY_SCALE.initialCheckpoint.offset;
    const [width, thickness, depth] = ASCENSION_RELIQUARY_SCALE.initialCheckpoint.size;
    const body = addBox(
      chamber,
      'verticalReliquaryInitialAnchorFloor',
      [width, thickness, depth],
      [localX, topY - thickness * 0.5, localZ],
      this.materials.armor,
    );
    addPlatformFrame(chamber, 'verticalReliquaryInitialAnchorTrim', width, depth, topY, this.materials.gold, { x: localX, z: localZ, railWidth: 0.2 });
    addRing(chamber, 'verticalReliquaryInitialDirectionRing', 3.2, 0.13, [localX, topY + 0.035, localZ - 1.1], this.materials.guide, 48);
    const world = this.root.localToWorld(new THREE.Vector3(localX, topY, localZ));
    const descriptor = createPlatformDescriptor({
      id: checkpointId(0),
      role: 'checkpoint',
      center: world,
      width,
      depth,
      topY,
      baseY: 0,
      object: body,
    });
    descriptor.segmentIndex = 0;
    descriptor.segmentId = 'initialFloor';
    descriptor.checkpoint = true;
    descriptor.securedCheckpoint = true;
    this._registerPlatform(descriptor);
    return {
      id: descriptor.id,
      segmentId: 'initialFloor',
      index: 0,
      platform: descriptor,
      position: world,
      facing: new THREE.Vector3(0, 0, -1),
    };
  }

  _buildChamberArchitecture(chamber, segment) {
    const centerY = (segment.startHeight + segment.checkpointHeight) * 0.5;
    const railHeight = Math.max(8, segment.checkpointHeight - segment.startHeight + 2);
    for (const side of [-1, 1]) {
      const railX = side * (ASCENSION_RELIQUARY_SCALE.playableRadius - 2.5);
      addBox(
        chamber,
        `${segment.id}ElevatorRail_${side < 0 ? 'left' : 'right'}`,
        [0.5, railHeight, 0.65],
        [railX, centerY, 0],
        segment.index === 1 ? this.materials.gold : this.materials.dark,
      );
      this._registerCollisionZone({
        id: `verticalReliquaryElevatorRailCollision:${segment.id}:${side < 0 ? 'left' : 'right'}`,
        x: railX,
        z: 0,
        baseY: centerY - railHeight * 0.5,
        height: railHeight,
        halfWidth: 0.25,
        halfDepth: 0.325,
      });
    }

    if (segment.index === 0) {
      for (const angle of [0.15, 2.25, 4.35]) {
        const x = Math.cos(angle) * 25.5;
        const z = Math.sin(angle) * 25.5;
        addCylinder(chamber, 'compressionFoundryFloorPiston', 1.15, 1.45, 7.5, [x, 3.75, z], this.materials.dark, 12);
        addRing(chamber, 'compressionFoundryPistonCollar', 1.42, 0.16, [x, 5.1, z], this.materials.hazard, 32);
        this._registerCollisionZone({
          id: `compressionFoundryPistonCollision:${angle}`,
          x,
          z,
          baseY: 0,
          height: 7.5,
          halfWidth: 1.45,
          halfDepth: 1.45,
        });
      }
    } else if (segment.index === 1) {
      for (const y of [22, 28, 34, 39]) {
        addBox(chamber, 'brokenElevatorSpineCrossBrace', [58, 0.32, 0.32], [0, y, 29], this.materials.gold);
      }
    } else if (segment.index === 2) {
      for (let index = 0; index < 12; index += 1) {
        const angle = index / 12 * Math.PI * 2;
        const radius = 19 + (index % 3) * 3.5;
        const fragment = addBox(
          chamber,
          `suspendedMachineryFragment_${index}`,
          [2.4 + (index % 3) * 0.65, 0.48, 1.4],
          [Math.cos(angle) * radius, centerY + Math.sin(index * 1.7) * 7, Math.sin(angle) * radius],
          index % 2 === 0 ? this.materials.verdigris : this.materials.armor,
        );
        fragment.rotation.set(0.15 * (index % 3), angle, 0.12 * (index % 2 ? 1 : -1));
        this._registerCollisionZone({
          id: `suspendedMachineryFragmentCollision:${index}`,
          x: fragment.position.x,
          z: fragment.position.z,
          baseY: fragment.position.y - 0.32,
          height: 0.64,
          halfWidth: 1.2 + (index % 3) * 0.325,
          halfDepth: 0.7,
          rotationY: -angle,
        });
      }
    }
  }

  _registerCollisionZone({
    id,
    x,
    z,
    baseY,
    height,
    halfWidth,
    halfDepth,
    rotationY = 0,
  }) {
    this.collisionZones.push({
      id,
      roomId: this.roomId,
      label: id,
      position: new THREE.Vector3(this.center.x + x, baseY + height * 0.5, this.center.z + z),
      halfWidth,
      halfDepth,
      verticalHalfHeight: height * 0.5,
      rotationY,
      obstacleKind: 'authoredReliquarySolid',
      fromAuthoredBossEnvironment: true,
    });
  }

  _createCheckpointPlatform(chamber, segment) {
    const summit = segment.index === ASCENSION_RELIQUARY_SEGMENTS.length - 1;
    const summitDiameter = ASCENSION_RELIQUARY_SCALE.summitRadius * 2;
    const [checkpointWidth, checkpointThickness, checkpointDepth] = ASCENSION_RELIQUARY_SCALE.checkpointSize;
    const width = summit ? summitDiameter : checkpointWidth;
    const depth = summit ? summitDiameter : checkpointDepth;
    const [localX, topY, localZ] = segment.checkpointOffset;
    const thickness = summit ? 0.72 : checkpointThickness;
    const body = summit
      ? addCylinder(chamber, 'verticalReliquarySummitArena', ASCENSION_RELIQUARY_SCALE.summitRadius, ASCENSION_RELIQUARY_SCALE.summitRadius + 0.7, thickness, [localX, topY - thickness * 0.5, localZ], this.materials.armor, 64)
      : addBox(chamber, `verticalReliquaryCheckpointBody_${segment.index}`, [width, thickness, depth], [localX, topY - thickness * 0.5, localZ], this.materials.armor);
    addRing(
      chamber,
      `verticalReliquaryCheckpointSealRing_${segment.index}`,
      summit ? ASCENSION_RELIQUARY_SCALE.summitCombatRadius : 4.2,
      summit ? 0.18 : 0.13,
      [localX, topY + 0.04, localZ],
      this.materials.hazard,
      summit ? 96 : 48,
    );
    const world = this.root.localToWorld(new THREE.Vector3(localX, topY, localZ));
    const descriptor = createPlatformDescriptor({
      // The physical seal station is not itself the durable checkpoint ID.
      // Checkpoints point at these platforms after a seal commits, while the
      // platform keeps a unique environment-scoped identity.
      id: sealStationId(segment.index),
      role: summit ? 'summit' : 'checkpoint',
      center: world,
      width,
      depth,
      topY,
      baseY: Math.max(0, segment.startHeight),
      object: body,
    });
    descriptor.segmentIndex = segment.index;
    descriptor.segmentId = segment.id;
    descriptor.sealStation = true;
    if (summit) {
      descriptor.radial = true;
      descriptor.radius = ASCENSION_RELIQUARY_SCALE.summitRadius;
      descriptor.combatRadius = ASCENSION_RELIQUARY_SCALE.summitCombatRadius;
      descriptor.createsLedgeCandidates = false;
      descriptor.containsTop = (position, inset = 0) => descriptor.enabled
        && Math.hypot(position.x - descriptor.center.x, position.z - descriptor.center.z)
          <= Math.max(0, descriptor.radius - Math.max(0, Number(inset) || 0));
      descriptor.getTopY = (position) => descriptor.containsTop(position) ? descriptor.topY : null;
    }
    this._registerPlatform(descriptor);
    return {
      id: descriptor.id,
      segmentId: segment.id,
      index: segment.index,
      platform: descriptor,
      position: world,
      facing: new THREE.Vector3(-localX, 0, -localZ).normalize(),
    };
  }

  _createRoutePlatform(chamber, segment, route) {
    const [width, thickness, depth] = route.size;
    const [x, baseTopY, z] = route.offset;
    const group = new THREE.Group();
    group.name = `verticalReliquaryMechanism_${route.id}`;
    group.position.set(x, baseTopY, z);
    chamber.add(group);
    const body = addBox(group, `${route.id}PlatformBody`, [width, thickness, depth], [0, -thickness * 0.5, 0], route.role === 'launchVent' ? this.materials.dark : this.materials.verdigris);
    addPlatformFrame(group, `${route.id}PlatformTrim`, width, depth, 0, this.materials.gold, { railWidth: 0.2, railHeight: 0.09 });
    const vent = route.role === 'launchVent'
      ? addCylinder(group, `${route.id}VentCore`, 1.55, 1.8, 0.12, [0, 0.06, 0], this.materials.ventIdle, 24)
      : null;
    const spring = route.role === 'momentum' || route.role === 'counterweight'
      ? addCylinder(group, `${route.id}CompressionSpring`, 0.85, 1.1, Math.max(0.7, baseTopY - segment.startHeight), [0, -(baseTopY - segment.startHeight) * 0.5 - 0.2, 0], this.materials.dark, 12)
      : null;
    const guide = new THREE.Group();
    guide.name = `${route.id}RouteBeacon`;
    const guideBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.28, 8, 8), this.materials.guide);
    guideBeam.name = `${route.id}RouteBeaconBeam`;
    guideBeam.position.y = 4;
    guide.add(guideBeam);
    addRing(guide, `${route.id}RouteBeaconRing`, Math.min(width, depth) * 0.32, 0.12, [0, 0.08, 0], this.materials.guide, 40);
    guide.visible = route.sequence === 0;
    group.add(guide);
    const world = this.root.localToWorld(new THREE.Vector3(x, baseTopY, z));
    const descriptor = createPlatformDescriptor({
      id: `verticalReliquaryPlatform:${route.id}`,
      role: route.role,
      center: world,
      width,
      depth,
      topY: baseTopY,
      baseY: segment.startHeight,
      object: group,
      dynamic: route.role === 'momentum'
        || route.role === 'counterweight'
        || route.role === 'rotatingBridge',
    });
    descriptor.segmentIndex = segment.index;
    descriptor.segmentId = segment.id;
    descriptor.routeId = route.id;
    descriptor.sequence = route.sequence;
    descriptor.routeUnlocked = route.sequence === 0;
    descriptor.baseTopY = baseTopY;
    descriptor.targetTopY = route.role === 'launchVent' ? baseTopY : route.targetHeight;
    descriptor.boardTriggeredLift = descriptor.dynamic
      && descriptor.targetTopY > descriptor.baseTopY + 0.05;
    descriptor.currentTargetTopY = baseTopY;
    descriptor.motionSpeed = route.role === 'momentum' || route.role === 'counterweight' ? 4.8 : 3.4;
    descriptor.mechanismState = route.role === 'landing' ? 'stable' : 'dormant';
    descriptor.ventState = 'inactive';
    descriptor.vent = vent;
    // Launches are intentionally armed by the visible vent core, not by the
    // full platform footprint. Keeping the gameplay radius sourced from the
    // authored mesh prevents an invisible edge trigger from throwing the
    // player before they have actually stepped onto the mechanism.
    descriptor.launchActivationRadius = vent
      ? Math.min(
        Math.max(
          Number(vent.geometry?.parameters?.radiusTop) || 0,
          Number(vent.geometry?.parameters?.radiusBottom) || 0,
        ),
        ASCENSION_ENGINE_TUNING.launchActivationRadius,
      )
      : 0;
    descriptor.spring = spring;
    descriptor.guide = guide;
    descriptor.body = body;
    descriptor.group = group;
    descriptor.baseGroupPositionY = group.position.y;
    descriptor.baseSpringPositionY = spring?.position?.y ?? null;
    descriptor.baseSpringScaleY = spring?.scale?.y ?? null;
    descriptor.rearmOnReturn = false;
    descriptor.riderReleaseRemaining = 0;
    descriptor.riderDelivered = false;
    descriptor.createsLedgeCandidates = false;
    descriptor.launchTargetHeight = route.targetHeight;
    this._registerPlatform(descriptor);
    return descriptor;
  }

  _registerPlatform(platform) {
    this.platforms.push(platform);
    this.platformById.set(platform.id, platform);
  }

  _buildSummit() {
    const summit = this.chamberRoots[3];
    const summitY = ASCENSION_RELIQUARY_SEGMENTS[3].checkpointHeight;
    for (let index = 0; index < 12; index += 1) {
      const angle = index / 12 * Math.PI * 2;
      const radius = ASCENSION_RELIQUARY_SCALE.summitRadius - 1.2;
      const height = 4.8 + (index % 3) * 1.35;
      const pylon = addBox(
        summit,
        `summitTrialBrokenSpire_${index}`,
        [0.9, height, 0.9],
        [Math.cos(angle) * radius, summitY + height * 0.5, Math.sin(angle) * radius],
        index % 2 === 0 ? this.materials.armor : this.materials.verdigris,
      );
      pylon.rotation.y = -angle;
      this._registerCollisionZone({
        id: `summitTrialBrokenSpireCollision:${index}`,
        x: pylon.position.x,
        z: pylon.position.z,
        baseY: summitY,
        height,
        halfWidth: 0.45,
        halfDepth: 0.45,
        rotationY: -angle,
      });
    }
    const crown = addRing(summit, 'summitTrialOpenSkyCrown', ASCENSION_RELIQUARY_SCALE.architectureRadius - 1, 0.3, [0, ASCENSION_RELIQUARY_SCALE.shellHeight - 2, 0], this.materials.gold, 96);
    crown.rotation.z = 0.08;
  }

  attachToDungeon(dungeon) {
    if (!dungeon?.group || this.disposed) return false;
    dungeon.group.add(this.root);
    this.attachedGroup = dungeon.group;
    dungeon.platforms ??= [];
    for (const platform of this.platforms) {
      if (!dungeon.platforms.includes(platform)) dungeon.platforms.push(platform);
    }
    this.attachedPlatformList = dungeon.platforms;
    dungeon.solidZones ??= [];
    for (const zone of this.collisionZones) {
      if (!dungeon.solidZones.some((entry) => entry.id === zone.id)) dungeon.solidZones.push(zone);
    }
    this.attachedSolidZoneList = dungeon.solidZones;
    dungeon.specialEnvironment = this;
    dungeon.specialEnvironmentId = this.id;
    return true;
  }

  mount(game) {
    if (this.disposed) return false;
    this.game = game;
    const camera = game?.cameraController;
    if (camera && !this.cameraProfileRestore) {
      this.cameraProfileRestore = {
        baseDistance: camera.baseDistance,
        baseHeight: camera.baseHeight,
        baseLookAhead: camera.baseLookAhead,
        lookHeight: camera.lookHeight,
      };
      camera.baseDistance = 9.5;
      camera.baseHeight = 4.4;
      camera.baseLookAhead = 2.2;
      camera.lookHeight = 2.35;
    }
    if (game?.scene && !this.fogRestore) {
      this.fogRestore = game.scene.fog?.clone?.() ?? null;
      if (game.scene.fog) {
        game.scene.fog.near = 36;
        game.scene.fog.far = 120;
      }
    }
    for (const platform of this.platforms) {
      if (platform.dynamic) game?.registerDynamicPlatformingSurface?.(platform);
    }
    this._updateMasteryRoute(game, { announce: false });
    const constructionGrid = game?.scene?.getObjectByName?.('ruinConstructionGrid');
    if (constructionGrid?.visible && this.hiddenGlobalFixtures.length === 0) {
      this.hiddenGlobalFixtures.push({ object: constructionGrid, visible: true });
      constructionGrid.visible = false;
    }
    this._hideStockBossRoom(game);
    return true;
  }

  _hideStockBossRoom(game) {
    if (!game?.scene || this.hiddenStockFixtures.length > 0) return;
    const halfWidth = this.room.width * this.tileSize * 0.5;
    const halfDepth = this.room.depth * this.tileSize * 0.5;
    game.scene.traverse((object) => {
      if (object === this.root || this.root.getObjectById(object.id)) return;
      const inRoom = Math.abs(object.position.x - this.center.x) <= halfWidth
        && Math.abs(object.position.z - this.center.z) <= halfDepth;
      const shouldHide = STOCK_BOSS_FIXTURE_NAMES.has(object.name)
        || (object.name === 'dungeonRoomCeiling' && inRoom);
      if (!shouldHide || object.visible === false) return;
      this.hiddenStockFixtures.push({ object, visible: object.visible });
      object.visible = false;
    });
  }

  setActiveSegment(segmentIndex) {
    const resolved = Math.max(0, Math.min(3, Math.trunc(Number(segmentIndex) || 0)));
    this.activeSegmentIndex = resolved;
    if (this.completed) return;
    // Keep the complete tower visible. Route surfaces remain gated below, but
    // seeing the next chamber and the summit is essential to reading the
    // Reliquary as one dungeon-scale ascent.
    this.chamberRoots.forEach((root) => { root.visible = true; });
    for (const platform of this.platforms) {
      const active = platform.masteryShortcut
        ? this.masteryRouteActive && (this.completed || platform.segmentIndex === resolved)
        : platform.routeId
          ? platform.segmentIndex === resolved && platform.routeUnlocked
        : platform.checkpoint
        ? true
        : platform.sealStation
          ? platform.segmentIndex <= resolved
        : platform.segmentIndex === resolved;
      platform.enabled = active;
      platform.active = active;
      if (platform.masteryShortcut && platform.group) platform.group.visible = active;
      if (platform.routeId && platform.group) platform.group.visible = active;
      if (platform.guide) {
        platform.guide.visible = active && platform.mechanismState !== 'launched';
      }
    }
    this.game?._rebuildPlatformingLedgeCandidates?.();
  }

  setCompleted(completed = true) {
    this.completed = Boolean(completed);
    if (!this.completed) {
      this.setActiveSegment(this.activeSegmentIndex);
      return;
    }
    this.chamberRoots.forEach((root) => { root.visible = true; });
    for (const platform of this.platforms) {
      const active = !platform.masteryShortcut || this.masteryRouteActive;
      platform.enabled = active;
      platform.active = active;
      if (platform.masteryShortcut && platform.group) platform.group.visible = active;
      if (platform.routeId && platform.group) platform.group.visible = active;
      if (platform.guide) platform.guide.visible = false;
      if (platform.role === 'counterweight' || platform.role === 'momentum' || platform.role === 'rotatingBridge') {
        platform.rearmOnReturn = false;
        platform.riderReleaseRemaining = 0;
        platform.riderDelivered = true;
        platform.currentTargetTopY = platform.targetTopY;
        platform.topY = platform.targetTopY;
        platform.center.y = platform.topY;
        if (platform.group) platform.group.position.y = platform.topY;
        if (platform.spring) {
          const springHeight = Math.max(0.3, platform.topY - platform.baseY);
          platform.spring.scale.y = springHeight / Math.max(0.7, platform.baseTopY - platform.baseY);
          platform.spring.position.y = -springHeight * 0.5 - 0.2;
        }
        platform.mechanismState = 'launched';
      }
      if (platform.role === 'launchVent') {
        platform.ventState = 'ready';
        this._setVentMaterial(platform, 'ready');
      }
    }
    for (const interactable of this.game?.dungeon?.safeInteractables ?? []) {
      if (interactable.requiresRuinComplete && interactable.object) {
        interactable.object.visible = true;
      }
    }
    this.game?._rebuildPlatformingLedgeCandidates?.();
  }

  _hasJumpSprings(game = this.game) {
    return game?.player?.gearLoadout?.getId?.('mobility') === 'jumpSprings';
  }

  _updateMasteryRoute(game = this.game, { announce = true } = {}) {
    const active = this._hasJumpSprings(game);
    if (active === this.masteryRouteActive) return false;
    this.masteryRouteActive = active;
    if (this.completed) {
      for (const platform of this.masteryPlatforms) {
        platform.enabled = active;
        platform.active = active;
        if (platform.group) platform.group.visible = active;
      }
      this.game?._rebuildPlatformingLedgeCandidates?.();
    } else {
      this.setActiveSegment(this.activeSegmentIndex);
    }
    if (active && announce && !this.masteryRouteAnnounced) {
      this.masteryRouteAnnounced = true;
      game?.ui?.showToast?.('Jump Springs resonate · mastery ledges online', '#7df8ff');
    }
    return true;
  }

  getCheckpoint(index = 0) {
    return this.checkpoints[Math.max(0, Math.min(3, Math.trunc(Number(index) || 0)))] ?? this.checkpoints[0];
  }

  isTraversalVoid(position) {
    if (!position) return false;
    return Math.hypot(position.x - this.center.x, position.z - this.center.z)
      < ASCENSION_RELIQUARY_SCALE.voidRadius;
  }

  getFloorElevationOverride(position) {
    return this.isTraversalVoid(position) ? ASCENSION_RELIQUARY_SCALE.floorDepth : null;
  }

  isOutsideTraversalBounds(position, margin = 0) {
    if (!position) return false;
    return Math.hypot(position.x - this.center.x, position.z - this.center.z)
      > ASCENSION_RELIQUARY_SCALE.playableRadius + Math.max(0, Number(margin) || 0);
  }

  getSpatialDiagnostics() {
    return Object.freeze({
      playableRadius: ASCENSION_RELIQUARY_SCALE.playableRadius,
      voidRadius: ASCENSION_RELIQUARY_SCALE.voidRadius,
      architectureRadius: ASCENSION_RELIQUARY_SCALE.architectureRadius,
      shellHeight: ASCENSION_RELIQUARY_SCALE.shellHeight,
      chamberDiameter: ASCENSION_RELIQUARY_SCALE.chamberDiameter,
      summitRadius: ASCENSION_RELIQUARY_SCALE.summitRadius,
      summitCombatRadius: ASCENSION_RELIQUARY_SCALE.summitCombatRadius,
      segmentHeights: Object.freeze(ASCENSION_RELIQUARY_SEGMENTS.map((segment) => Object.freeze({
        id: segment.id,
        startHeight: segment.startHeight,
        checkpointHeight: segment.checkpointHeight,
      }))),
    });
  }

  getMinimapSnapshot(playerPosition = this.game?.player?.root?.position) {
    if (!playerPosition) return null;
    const mapZForHeight = (height) => 48 - THREE.MathUtils.clamp(
      height / ASCENSION_RELIQUARY_SEGMENTS[3].checkpointHeight,
      0,
      1,
    ) * 42;
    const exteriorRoomId = this.game?.dungeonController?._getRoomAtPosition?.(playerPosition)?.id;
    const exteriorRoomIds = new Set(['hubTown', 'expeditionCamp', 'entrance']);
    const inExterior = exteriorRoomIds.has(exteriorRoomId);
    const currentSegment = inExterior
      ? null
      : ASCENSION_RELIQUARY_SEGMENTS.findIndex((segment) => (
        playerPosition.y >= segment.startHeight - 0.5
        && playerPosition.y < segment.checkpointHeight + (segment.index === 3 ? 8 : 0.5)
      ));
    const definitions = [
      { roomId: 'summitTrial', roomType: 'bossStage', title: 'SUMMIT TRIAL', x: -6, z: 1, width: 12, depth: 10, index: 3 },
      { roomId: 'suspendedMachinerySea', roomType: 'bossStage', title: 'MACHINERY SEA', x: -6, z: 15, width: 12, depth: 10, index: 2 },
      { roomId: 'brokenElevatorSpine', roomType: 'bossStage', title: 'ELEVATOR SPINE', x: -6, z: 29, width: 12, depth: 10, index: 1 },
      { roomId: 'compressionFoundry', roomType: 'bossStage', title: 'COMPRESSION FOUNDRY', x: -6, z: 43, width: 12, depth: 10, index: 0 },
      { roomId: 'entrance', roomType: 'entrance', title: 'RUIN LIFT', x: -5, z: 57, width: 10, depth: 7, index: -1 },
      { roomId: 'expeditionCamp', roomType: 'camp', title: 'EXPEDITION CAMP', x: -5, z: 68, width: 10, depth: 7, index: -2 },
      { roomId: 'hubTown', roomType: 'hub', title: 'START ZONE', x: -5, z: 79, width: 10, depth: 7, index: -3 },
    ];
    const rooms = definitions.map((room) => ({
      roomId: room.roomId,
      roomType: room.roomType,
      title: room.title,
      roomBounds2D: { x: room.x, z: room.z, width: room.width, depth: room.depth },
      roomCenter2D: { x: room.x + room.width * 0.5, z: room.z + room.depth * 0.5 },
      isDiscovered: true,
      isReachable: room.index < 0 || room.index <= this.activeSegmentIndex,
      isCurrent: exteriorRoomId === room.roomId || room.index === currentSegment,
    }));
    const hallways = rooms.slice(0, -1).map((room, index) => ({
      hallwayId: `ascensionMinimapLink:${index}`,
      fromRoomId: rooms[index + 1].roomId,
      toRoomId: room.roomId,
      from: rooms[index + 1].roomCenter2D,
      to: room.roomCenter2D,
      isDiscovered: true,
    }));
    const currentExteriorRoom = rooms.find((room) => room.roomId === exteriorRoomId);
    const player = inExterior
      ? { ...(currentExteriorRoom?.roomCenter2D ?? { x: 0, z: 82.5 }) }
      : {
        x: THREE.MathUtils.clamp(
          (playerPosition.x - this.center.x) / ASCENSION_RELIQUARY_SCALE.playableRadius * 5,
          -5,
          5,
        ),
        z: mapZForHeight(playerPosition.y),
      };
    const nextRoute = this.getRoutePlatforms(this.activeSegmentIndex)
      .find((platform) => platform.enabled && platform.guide?.visible);
    const markers = nextRoute ? [{
      type: 'mechanism',
      point: {
        x: THREE.MathUtils.clamp(
          (nextRoute.center.x - this.center.x) / ASCENSION_RELIQUARY_SCALE.playableRadius * 5,
          -5,
          5,
        ),
        z: mapZForHeight(nextRoute.topY),
      },
      isReachable: true,
      label: 'Next impact route',
    }] : [];
    return {
      verticalStage: true,
      bounds: { minX: -8, minZ: -2, width: 16, depth: 92 },
      rooms,
      hallways,
      markers,
      arrows: [],
      player,
    };
  }

  getCheckpointById(id) {
    return this.checkpoints.find((checkpoint) => checkpoint.id === id) ?? null;
  }

  getSealStation(index = this.activeSegmentIndex) {
    return this.sealStations[Math.max(0, Math.min(3, Math.trunc(Number(index) || 0)))] ?? null;
  }

  getRoutePlatforms(segmentIndex = this.activeSegmentIndex) {
    return this.routePlatformsBySegment.get(segmentIndex) ?? [];
  }

  resetSegment(segmentIndex = this.activeSegmentIndex) {
    for (const platform of this.getRoutePlatforms(segmentIndex)) {
      platform.routeUnlocked = platform.sequence === 0;
      // A retry is a physical reset, not only a state-machine reset. Returning
      // every moving surface to its authored transform keeps the first jump of
      // a chamber identical after a fall, defeat, or checkpoint resume.
      platform.topY = platform.baseTopY;
      platform.center.y = platform.baseTopY;
      if (platform.group) platform.group.position.y = platform.baseGroupPositionY;
      if (platform.spring) {
        platform.spring.position.y = platform.baseSpringPositionY;
        platform.spring.scale.y = platform.baseSpringScaleY;
      }
      platform.currentTargetTopY = platform.baseTopY;
      platform.rearmOnReturn = false;
      platform.riderReleaseRemaining = 0;
      platform.riderDelivered = false;
      platform.mechanismState = platform.role === 'landing' ? 'stable' : 'dormant';
      platform.ventState = 'inactive';
      this._setVentMaterial(platform, 'inactive');
      const active = segmentIndex === this.activeSegmentIndex && platform.routeUnlocked;
      platform.enabled = active;
      platform.active = active;
      if (platform.group) platform.group.visible = active;
      if (platform.guide) platform.guide.visible = active;
    }
    this.game?._rebuildPlatformingLedgeCandidates?.();
  }

  commandPlatformImpact(segmentIndex, sequence) {
    const route = this.getRoutePlatforms(segmentIndex);
    const platform = route.find((entry) => entry.sequence === sequence);
    if (!platform) return null;
    if (platform.role === 'launchVent') {
      platform.ventState = 'charging';
      platform.mechanismState = 'compressed';
      this._setVentMaterial(platform, 'charging');
    } else if (platform.boardTriggeredLift) {
      // The Engine's impact authors and arms the route. The lift does not leave
      // without MegaMan; boarding the visible mechanism is what releases it.
      platform.currentTargetTopY = platform.baseTopY;
      platform.rearmOnReturn = true;
      platform.riderReleaseRemaining = 0;
      platform.riderDelivered = false;
      platform.mechanismState = 'armed';
    } else {
      platform.currentTargetTopY = platform.targetTopY;
      platform.mechanismState = 'stable';
    }
    if (platform.guide) platform.guide.visible = false;
    const next = route.find((entry) => entry.sequence === sequence + 1);
    if (next) {
      next.routeUnlocked = true;
      next.enabled = segmentIndex === this.activeSegmentIndex;
      next.active = next.enabled;
      if (next.group) next.group.visible = next.enabled;
      if (next.guide) next.guide.visible = next.enabled;
    }
    return platform;
  }

  setVentState(routeId, state) {
    const platform = [...this.platformById.values()].find((entry) => entry.routeId === routeId);
    if (!platform?.vent) return false;
    platform.ventState = state;
    this._setVentMaterial(platform, state);
    return true;
  }

  _setVentMaterial(platform, state) {
    if (!platform?.vent) return;
    platform.vent.material = state === 'launching'
      ? this.materials.ventLaunch
      : state === 'charging' || state === 'ready'
        ? this.materials.ventCharge
        : this.materials.ventIdle;
  }

  _isPlayerSupportedBy(platform) {
    const player = this.game?.player;
    if (!player?.root || player.dead || player.isJumpAirborne?.()) return false;
    if (!platform.containsTop(player.root.position, 0.06)) return false;
    return Math.abs(player.root.position.y - platform.topY) <= 0.22;
  }

  _isPlayerRidingOrAbove(platform) {
    const player = this.game?.player;
    if (!player?.root || player.dead || !platform.containsTop(player.root.position, 0.06)) return false;
    const height = player.root.position.y - platform.topY;
    return height >= -0.22 && height <= ASCENSION_ENGINE_TUNING.liftRiderAirborneHeight;
  }

  _movePlatform(platform, dt) {
    const before = platform.topY;
    const supported = this._isPlayerSupportedBy(platform);
    const maximum = platform.motionSpeed * dt;
    const delta = THREE.MathUtils.clamp(platform.currentTargetTopY - before, -maximum, maximum);
    if (Math.abs(delta) <= 1e-6) {
      if (Math.abs(platform.topY - platform.currentTargetTopY) <= 0.015) {
        const raised = platform.currentTargetTopY > platform.baseTopY + 0.05;
        platform.mechanismState = raised
          ? 'launched'
          : platform.rearmOnReturn
            ? 'armed'
            : 'stable';
        if (raised && supported) platform.riderDelivered = true;
      }
      return;
    }
    platform.topY += delta;
    platform.center.y = platform.topY;
    platform.group.position.y = platform.topY;
    if (platform.spring) {
      const springHeight = Math.max(0.3, platform.topY - platform.baseY);
      platform.spring.scale.y = springHeight / Math.max(0.7, platform.baseTopY - platform.baseY);
      platform.spring.position.y = -springHeight * 0.5 - 0.2;
    }
    if (Math.abs(platform.topY - platform.currentTargetTopY) <= 0.015) {
      const raised = platform.currentTargetTopY > platform.baseTopY + 0.05;
      platform.mechanismState = raised
        ? 'launched'
        : platform.rearmOnReturn
          ? 'armed'
          : 'stable';
      if (raised && supported) platform.riderDelivered = true;
    }
    if (supported) {
      this.game.player.root.position.y += delta;
      if (this.game.dungeonController?.lastSafePlayerPosition) {
        this.game.dungeonController.lastSafePlayerPosition.y += delta;
      }
    }
  }

  prePlayerUpdate(dt, game = this.game) {
    if (this.disposed) return;
    if (game) this.game = game;
    this._updateMasteryRoute(this.game);
    const delta = Math.max(0, Number(dt) || 0);
    this.elapsed += delta;
    this.postClearRecoveryCooldown = Math.max(0, this.postClearRecoveryCooldown - delta);
    if (this.completed
      && this.postClearRecoveryCooldown <= 0
      && this.game?.player?.root?.position?.y < -2.35
      && !this.game.player.dead) {
      const checkpoint = this.getCheckpoint(0);
      const position = checkpoint.position.clone();
      position.y += 0.03;
      this.game.player.restoreTraversalCheckpoint?.({
        position,
        facing: checkpoint.facing,
        healthFloorRatio: 0,
        restoreHealth: false,
        refillBarrier: false,
      });
      this.game.cameraController?.snapTo?.(this.game.player);
      this.game.ui?.showToast?.('Reliquary return floor restored', '#ffd36f');
      this.postClearRecoveryCooldown = 1;
    }
    for (const platform of this.getRoutePlatforms(this.activeSegmentIndex)) {
      if (!this.completed && platform.boardTriggeredLift) {
        const supported = this._isPlayerSupportedBy(platform);
        const riderPresent = this._isPlayerRidingOrAbove(platform);
        if ((platform.mechanismState === 'armed' || platform.mechanismState === 'returning') && supported) {
          platform.currentTargetTopY = platform.targetTopY;
          platform.mechanismState = 'compressed';
          platform.riderReleaseRemaining = ASCENSION_ENGINE_TUNING.liftRiderReleaseGraceSeconds;
        } else if (platform.mechanismState === 'compressed' || platform.mechanismState === 'launched') {
          if (riderPresent) {
            platform.riderReleaseRemaining = ASCENSION_ENGINE_TUNING.liftRiderReleaseGraceSeconds;
          } else {
            platform.riderReleaseRemaining = Math.max(0, platform.riderReleaseRemaining - delta);
            if (platform.riderReleaseRemaining <= 0) {
              platform.currentTargetTopY = platform.baseTopY;
              platform.mechanismState = 'returning';
            }
          }
        }
        this._movePlatform(platform, delta);
      }
      if (platform.vent) {
        const pulse = 1 + Math.sin(this.elapsed * 8 + platform.sequence) * 0.06;
        platform.vent.scale.set(pulse, 1, pulse);
      }
      if (platform.guide?.visible) {
        const pulse = 0.9 + Math.sin(this.elapsed * 3.6 + platform.sequence) * 0.12;
        platform.guide.scale.set(pulse, 1, pulse);
        platform.guide.rotation.y += delta * 0.45;
      }
    }
  }

  getManifest() {
    return Object.freeze({
      id: this.id,
      revision: this.revision,
      profileId: this.profileId,
      seed: this.seed,
      checkpointIds: Object.freeze(this.checkpoints.map((entry) => entry.id)),
      sealStationIds: Object.freeze(this.sealStations.map((entry) => entry.id)),
      masteryPlatformIds: Object.freeze(this.masteryPlatforms.map((entry) => entry.id)),
      collisionZoneIds: Object.freeze(this.collisionZones.map((entry) => entry.id)),
      platformIds: Object.freeze(this.platforms.map((entry) => entry.id)),
      spatial: this.getSpatialDiagnostics(),
    });
  }

  dispose({ restoreStock = true } = {}) {
    if (this.disposed) return;
    this.disposed = true;
    for (const platform of this.platforms) {
      if (platform.dynamic) this.game?.unregisterDynamicPlatformingSurface?.(platform);
    }
    if (this.attachedPlatformList) {
      for (let index = this.attachedPlatformList.length - 1; index >= 0; index -= 1) {
        if (this.platforms.includes(this.attachedPlatformList[index])) this.attachedPlatformList.splice(index, 1);
      }
    }
    if (this.game?.platformingPlatforms) {
      for (let index = this.game.platformingPlatforms.length - 1; index >= 0; index -= 1) {
        if (this.platforms.includes(this.game.platformingPlatforms[index])) this.game.platformingPlatforms.splice(index, 1);
      }
    }
    const collisionIds = new Set(this.collisionZones.map((zone) => zone.id));
    const collisionLists = new Set([
      this.attachedSolidZoneList,
      this.game?.dungeon?.solidZones,
      this.game?.dungeonController?.solidZones,
    ].filter(Boolean));
    for (const list of collisionLists) {
      for (let index = list.length - 1; index >= 0; index -= 1) {
        if (collisionIds.has(list[index]?.id)) list.splice(index, 1);
      }
    }
    if (restoreStock) {
      for (const hidden of this.hiddenStockFixtures) hidden.object.visible = hidden.visible;
      for (const hidden of this.hiddenGlobalFixtures) hidden.object.visible = hidden.visible;
    }
    if (this.game?.cameraController && this.cameraProfileRestore) {
      Object.assign(this.game.cameraController, this.cameraProfileRestore);
    }
    if (this.game?.scene && this.fogRestore) {
      this.game.scene.fog = this.fogRestore;
    }
    this.hiddenStockFixtures.length = 0;
    this.hiddenGlobalFixtures.length = 0;
    for (const platform of this.platforms) {
      platform.enabled = false;
      platform.active = false;
    }
    disposeTree(this.root);
    this.game?._rebuildPlatformingLedgeCandidates?.();
    this.game?.dungeonController?.invalidateNavigationTopology?.();
    this.game = null;
    this.attachedGroup = null;
    this.attachedPlatformList = null;
    this.attachedSolidZoneList = null;
    this.cameraProfileRestore = null;
    this.fogRestore = null;
  }
}

export function createVerticalTransitReliquary(options = {}) {
  return new VerticalTransitReliquary(options);
}

export default VerticalTransitReliquary;
