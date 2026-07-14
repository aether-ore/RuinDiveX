import * as THREE from 'three';
import { CombatSystem } from './CombatSystem.js';
import { CameraController } from './CameraController.js';
import { DungeonController } from './DungeonController.js';
import { DungeonGenerator } from './DungeonGenerator.js';
import { EnemySpawner } from './EnemySpawner.js';
import { Inventory } from './Inventory.js';
import { LootSystem } from './LootSystem.js';
import { MapEventSystem } from './MapEventSystem.js';
import { Player } from './Player.js';
import { ProjectileSystem } from './ProjectileSystem.js';
import { RefractorPickupSystem } from './RefractorPickupSystem.js';
import { RollSalvageStorage } from './RollSalvageStorage.js';
import { UIManager } from './UIManager.js';
import { BusterLabStorage } from './buster/BusterLabStorage.js';
import { BUSTER_RECIPE_LIST, getRecipeDiscoveryState } from './buster/BusterRecipeCatalog.js';
import { BusterRuntime } from './buster/BusterRuntime.js';
import {
  CUSTOM_BUSTER_RULESET,
  MEGA_BUSTER_BASE_PROFILE,
  MEGA_BUSTER_CALIBRATION_CATALOG,
  getBusterModuleDefinition,
  getBusterTuningMultiplier,
} from './buster/catalog.js';
import {
  getClusterDirections,
  getSpreadDirections,
  sampleBallisticPoint,
} from './buster/BusterTrajectory.js';
import {
  compileBusterBuild,
  deepFreezeBusterValue,
  serializeBusterBuild,
  validateBusterBuild,
} from './buster/index.js';
import { PLAYER_TRAVERSAL_CAPABILITIES } from './TraversalCapabilities.js';
import { getCombatTargetWorldPosition } from './reaverbots/CombatTarget.js';
import { rollReaverbotSalvageDrops } from './reaverbots/ReaverbotSalvageCatalog.js';

const POSE_DEBUG_CAMERA_DEFAULT_DISTANCE = 8.3;
const CAMERA_LOOK_OFFSET = new THREE.Vector3(0, 1.1, 0);
const POSE_DEBUG_HANDLE_COLOR = 0xffd36f;
const POSE_DEBUG_HANDLE_SELECTED_COLOR = 0xffffff;
const POSE_DEBUG_DRAG_DEGREES_PER_PIXEL = 0.35;
const POSE_DEBUG_CAMERA_MIN_PITCH = 0.18;
const POSE_DEBUG_CAMERA_MAX_PITCH = 1.25;
const POSE_DEBUG_CAMERA_MIN_DISTANCE = 4.5;
const POSE_DEBUG_CAMERA_MAX_DISTANCE = 22;
const HIT_STOP_MAX_DURATION = 0.16;
const HIT_STOP_DEFAULT_TIME_SCALE = 0.06;
const ENEMY_ATTACK_HANDOFF_DELAY = 0.46;
const ENEMY_ATTACK_REQUEST_TTL = 0.35;
const ENEMY_DEATH_EXPLOSION_LIFE = 0.52;
const ENEMY_DEATH_PART_LIFE = 0.76;
const ENEMY_DEATH_PART_LIMIT = 3;
const MAX_ACTIVE_ENEMY_DEATH_EFFECTS = 6;
const MAX_ACTIVE_PARTICLES = 220;
const MAX_POOLED_PARTICLES = 220;
const MAX_POOLED_HIT_EFFECTS = 48;
const MAX_POOLED_DAMAGE_NUMBERS = 72;
const MAX_SYNCHRONOUS_EXPLOSIONS = 8;
const CAMERA_WALL_OCCLUSION_TARGET_HEIGHT = 1.25;
const DUNGEON_RENDER_CULL_UPDATE_INTERVAL = 0.2;
const DUNGEON_RENDER_CULL_HIDE_DISTANCE = 68;
const DUNGEON_RENDER_CULL_SHOW_DISTANCE = 54;
const CAMERA_OCCLUSION_BIN_SIZE = 11.2;
const DEBUG_LEDGE_CUBE_WIDTH = 3;
const DEBUG_LEDGE_CUBE_DEPTH = 3;
const DEBUG_LEDGE_CUBE_HEIGHT = 3;
// Keep world-space debug geometry in a side testing bay so the spawn point and
// the main route toward the expedition camp remain completely unobstructed.
const DEBUG_LEDGE_CUBE_LATERAL_OFFSET = 7.25;
const DEBUG_LEDGE_CUBE_FORWARD_OFFSET = 3.05;
const DEBUG_LEDGE_GRAB_DISTANCE_MIN = 0.05;
const DEBUG_LEDGE_GRAB_DISTANCE_MAX = 1.05;
const DEBUG_LEDGE_GRAB_PROGRESS_MIN = 0.34;
const DEBUG_LEDGE_GRAB_PROGRESS_MAX = 0.98;
const DEBUG_LEDGE_APPROACH_DOT_MAX = -0.2;
const PLATFORM_EDGE_CATCH_DISTANCE_MIN = -0.05;
const PLATFORM_EDGE_CATCH_DISTANCE_MAX = 0.2;
const PLATFORM_EDGE_CATCH_VERTICAL_ABOVE = 0.24;
const PLATFORM_EDGE_CLEAR_FOOT_TOLERANCE = 0.1;
const PLATFORM_EDGE_CLEAR_DISTANCE_MAX = 0.42;
const PLATFORM_EDGE_CLEAR_INWARD_SPEED_MIN = 0.65;
const PLATFORM_LEDGE_GRAB_HEIGHT_MIN = -0.45;
const PLATFORM_NORMAL_JUMP_REACH_RATIO = PLAYER_TRAVERSAL_CAPABILITIES.normalJumpReachRatio;
const PLATFORM_LEDGE_MAX_REACH_RATIO = PLAYER_TRAVERSAL_CAPABILITIES.ledgeGrabHeightRatio;
const PLATFORM_LEDGE_IDEAL_REACH_RATIO = 1.94;
const DEBUG_LEDGE_LANDING_INSET = 0.08;
const PLATFORM_LANDING_VERTICAL_TOLERANCE = 0.42;
const DEBUG_LEDGE_HANG_ROOT_DROP = 3.35;
const DEBUG_LEDGE_HANG_OFFSET = 0.42;
const DEBUG_LEDGE_CLIMB_INSET = 0.82;
const DEBUG_LEDGE_HAND_OUTWARD_OFFSET = 0.055;
const DEBUG_JUMP_HEIGHT_PRESETS = Object.freeze({
  normal: 1,
  double: 2,
  triple: 3,
});
const DEBUG_GRAVITY_PRESETS = Object.freeze({
  normal: 1,
  moon: 0.28,
});

const CUSTOM_BUSTER_ATTACK_META = Object.freeze({
  attackDomain: 'customBuster',
  suppressGenericOffense: true,
});

function isBusterLabFeatureEnabled() {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('busterLab') === '1';
  } catch {
    return false;
  }
}

function isBusterLabDebugPresetEnabled() {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('busterLabDebug') === '1';
  } catch {
    return false;
  }
}

const tempVectorA = new THREE.Vector3();
const tempVectorB = new THREE.Vector3();
const tempVectorC = new THREE.Vector3();
const tempVectorD = new THREE.Vector3();
const tempMatrixA = new THREE.Matrix4();
const tempColor = new THREE.Color();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const ENEMY_DEATH_SPHERE_GEOMETRY = new THREE.SphereGeometry(1, 16, 11);
const ENEMY_DEATH_CORE_GEOMETRY = new THREE.IcosahedronGeometry(0.72, 1);
const ENEMY_DEATH_PROXY_GEOMETRIES = [
  new THREE.BoxGeometry(0.34, 0.18, 0.46),
  new THREE.CylinderGeometry(0.1, 0.14, 0.42, 7),
  new THREE.OctahedronGeometry(0.19, 0),
];
for (const geometry of [
  ENEMY_DEATH_SPHERE_GEOMETRY,
  ENEMY_DEATH_CORE_GEOMETRY,
  ...ENEMY_DEATH_PROXY_GEOMETRIES,
]) {
  geometry.userData.sharedTimedEffectGeometry = true;
}

function createDamageCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 80;
  return canvas;
}

function formatBrowserDiagnosticNumber(value, digits = 3) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number.toFixed(digits)) : 'none';
}

function getBrowserDiagnosticAngleDelta(a, b) {
  const left = Number(a);
  const right = Number(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return NaN;
  }

  return Math.atan2(Math.sin(left - right), Math.cos(left - right));
}

function createBusterRangeDummy(id, position, { moving = false } = {}) {
  const root = new THREE.Group();
  root.name = `busterRangeDummy:${id}`;
  root.position.copy(position);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: moving ? 0x6b7d8d : 0x7d6f62,
    emissive: 0x102a35,
    emissiveIntensity: 0.28,
    metalness: 0.65,
    roughness: 0.38,
  });
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0x7df8ff,
    emissive: 0x42dff5,
    emissiveIntensity: 0.9,
    metalness: 0.25,
    roughness: 0.25,
  });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.62, 1.65, 16), bodyMaterial);
  body.position.y = 0.86;
  body.castShadow = true;
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), coreMaterial);
  core.position.set(0, 1.12, -0.48);
  root.add(body, core);
  const home = position.clone();

  return {
    id,
    typeKey: 'busterRangeDummy',
    root,
    radius: 0.58,
    dead: false,
    health: 9999,
    stats: { maxHealth: 9999, armor: 0, experience: 0, damage: 0 },
    moving,
    elapsed: 0,
    update(dt) {
      this.elapsed += dt;
      if (moving) root.position.x = home.x + Math.sin(this.elapsed * 1.35) * 2.2;
    },
    takeDamage(amount) {
      const dealt = Math.max(0, Number(amount) || 0);
      this.health = Math.max(1, this.health - dealt);
      if (this.health <= 1) this.health = this.stats.maxHealth;
      return dealt;
    },
    resolveProjectileHit(projectilePosition, projectileRadius) {
      const center = root.position.clone().add(new THREE.Vector3(0, 1.05, 0));
      if (center.distanceToSquared(projectilePosition) > (this.radius + projectileRadius) ** 2) return null;
      const weakPointPosition = core.getWorldPosition(new THREE.Vector3());
      const weakPointHit = weakPointPosition.distanceTo(projectilePosition) <= projectileRadius + 0.24;
      return {
        hitPartId: weakPointHit ? 'range-core' : 'range-body',
        weakPointHit,
        hitPosition: projectilePosition.clone(),
      };
    },
    applyStatus() {},
    onDeath() {},
    dispose() {
      root.removeFromParent();
      body.geometry.dispose();
      core.geometry.dispose();
      bodyMaterial.dispose();
      coreMaterial.dispose();
    },
  };
}

export class Game {
  constructor({ container = document.getElementById('game-container') } = {}) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.name = 'gameScene';
    this.scene.background = new THREE.Color(0x171712);
    this.scene.fog = new THREE.Fog(0x171712, 24, 58);

    this.camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 120);
    this.camera.name = 'followCamera';
    this.cameraController = new CameraController(this.camera);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    this.clock = new THREE.Clock();
    this.keys = new Set();
    this.enemies = [];
    this.enemyAttackDirector = {
      owner: null,
      handoffTimer: 0,
      queue: [],
      time: 0,
      requestTimes: new Map(),
    };
    this.hazards = [];
    this.destructibles = [];
    this.timedEffects = [];
    this.damageNumbers = [];
    this.damageNumberPool = [];
    this.hitEffectPool = [];
    this.activeHitEffects = [];
    this.particlePool = [];
    this.activeParticles = [];
    this.pendingExplosions = [];
    this.explosionDispatchDepth = 0;
    this.elapsedTime = 0;
    this.hitStopTimer = 0;
    this.hitStopTimeScale = 1;
    this.busterLabEnabled = isBusterLabFeatureEnabled();
    this.busterLabDebugEnabled = this.busterLabEnabled && isBusterLabDebugPresetEnabled();
    this.busterLabStorage = null;
    this.busterLabState = null;
    this.busterLabLoadWarning = null;
    this.busterLabPlans = new Map();
    this.busterTestRange = null;
    this.animationPreview = this._readAnimationPreviewFromUrl();
    this.roomPreview = this._readRoomPreviewFromUrl();
    this.inventoryOpen = false;
    this.poseDebugOpen = false;
    this.isGameOver = false;
    this.ruinFloor = 1;
    this.largeRefractorsSecured = 0;
    this.ruinCompleted = false;
    this.expeditionAccepted = false;
    this.expeditionActive = false;
    this.arenaRadius = 82;
    this.pointer = {
      x: window.innerWidth * 0.5,
      y: window.innerHeight * 0.5,
      primary: false,
      primaryPressed: false,
      secondary: false,
      secondaryPressed: false,
      lockOnPressed: false,
      alternate: false,
      alternatePressed: false,
      aimWorld: new THREE.Vector3(0, 0, 1),
    };
    this.pointerLocked = false;
    this.lockOnMovementForward = new THREE.Vector3(0, 0, 1);
    this.lockOnMovementRight = new THREE.Vector3(1, 0, 0);
    this.lockOnMovementTargetPosition = new THREE.Vector3();
    this.lockOnMovementBasis = {
      forward: this.lockOnMovementForward,
      right: this.lockOnMovementRight,
      lockOnTarget: null,
      lockOnTargetPosition: this.lockOnMovementTargetPosition,
    };
    this.raycaster = new THREE.Raycaster();
    this.cameraOcclusionRaycaster = new THREE.Raycaster();
    this.cameraOcclusionEntries = [];
    this.cameraOcclusionBins = new Map();
    this.cameraOcclusionCandidateSet = new Set();
    this.cameraOcclusionCandidateObjects = [];
    this.cameraOcclusionHits = [];
    this.cameraOcclusionOwnerByObject = new WeakMap();
    this.cameraOcclusionHiddenOwners = new Set();
    this.cameraOcclusionOwnerBaseVisibility = new WeakMap();
    this.dungeonRenderCullGroups = [];
    this.dungeonRenderCullAccumulator = 0;
    this.dungeonRenderCullStats = {
      visibleGroupCount: 0,
      hiddenGroupCount: 0,
      hiddenObjectCount: 0,
      visibleDrawObjectCount: 0,
      hiddenDrawObjectCount: 0,
      totalDrawObjectCount: 0,
    };
    this.lastDungeonResourceDisposalStats = null;
    this.aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.manualAimPlaneActive = false;
    this.manualAimPlaneDepth = 0;
    this.pointerNdc = new THREE.Vector2();
    this.aimReticle = null;
    this.aimReticleScale = 1;
    this.poseDebugHandleGroup = new THREE.Group();
    this.poseDebugHandleGroup.name = 'poseDebugHandleGroup';
    this.poseDebugHandleGroup.visible = false;
    this.poseDebugHandles = [];
    this.poseDebugHandleMap = new Map();
    this.poseDebugPartPickables = [];
    this.poseDebugHandleGeometry = new THREE.SphereGeometry(0.1, 16, 12);
    this.poseDebugHandleMaterial = new THREE.MeshBasicMaterial({
      color: POSE_DEBUG_HANDLE_COLOR,
      transparent: true,
      opacity: 0.88,
      depthTest: false,
      depthWrite: false,
    });
    this.poseDebugHandleSelectedMaterial = new THREE.MeshBasicMaterial({
      color: POSE_DEBUG_HANDLE_SELECTED_COLOR,
      transparent: true,
      opacity: 0.96,
      depthTest: false,
      depthWrite: false,
    });
    this.poseDebugHandleHoverMaterial = new THREE.MeshBasicMaterial({
      color: 0x8cffd5,
      transparent: true,
      opacity: 0.96,
      depthTest: false,
      depthWrite: false,
    });
    this.poseDebugActiveDrag = null;
    this.poseDebugHoveredJointName = null;
    this.poseDebugCamera = {
      yaw: 0,
      pitch: 0.72,
      distance: POSE_DEBUG_CAMERA_DEFAULT_DISTANCE,
      rotating: false,
      lastX: 0,
      lastY: 0,
    };
    this.debugLedgeTester = null;
    this.debugLedgeCandidates = [];
    this.debugLedgePlatform = null;
    this.platformingPlatforms = [];
    this.platformingLedgeCandidates = [];
    this.debugSpawnedPlatforms = [];
    this.debugPlatformCounter = 0;
    this.debugJumpHeightPreset = 'normal';
    this.debugGravityPreset = 'normal';
    this.poseDebugSection = 'pose';
    this.debugSpawnedPlatformGroup = new THREE.Group();
    this.debugSpawnedPlatformGroup.name = 'debugSpawnedPlatformGroup';
    this.lastDebugLedgeClingId = null;
    this.lastDebugLedgeLandingId = null;

    this._buildWorld();
    this._buildAimReticle();
    this.scene.add(this.poseDebugHandleGroup, this.debugSpawnedPlatformGroup);

    this.player = new Player();
    this.scene.add(this.player.root);
    if (this.dungeon?.playerStart) {
      this.player.root.position.copy(this.dungeon.playerStart);
    }
    const roomPreviewPosition = this._getRoomPreviewPosition();
    if (roomPreviewPosition) {
      this.player.root.position.copy(roomPreviewPosition);
      const facingX = this.roomPreview?.facingX ?? 0;
      const facingZ = this.roomPreview?.facingZ ?? 1;
      this.player.lastMoveDirection.set(facingX, 0, facingZ).normalize();
      this.player.root.rotation.y = Math.atan2(facingX, facingZ);
    }
    this.player.jumpLedgeClingResolver = (context) => this._tryResolvePlatformLedgeCling(context);
    this.player.jumpPlatformLandingResolver = (context) => this._tryResolvePlatformLanding(context);

    this.inventory = new Inventory(54);
    if (this.busterLabEnabled) {
      this.busterLabStorage = new BusterLabStorage();
      this.busterLabState = this.busterLabStorage.load();
      this.busterLabLoadWarning = this.busterLabStorage.lastWarning;
      this.rollSalvageStorage = this.busterLabStorage.createRollSalvageStorage();
    } else {
      this.rollSalvageStorage = new RollSalvageStorage();
    }
    const getPickupFloorElevation = (position) => (
      this.dungeonController?.getSurfaceElevationAt?.(position)
    );
    this.lootSystem = new LootSystem(this.scene, { getFloorElevation: getPickupFloorElevation });
    this.refractors = new RefractorPickupSystem(this.scene, { getFloorElevation: getPickupFloorElevation });
    this.projectiles = new ProjectileSystem(this);
    this.busterRuntime = this.busterLabEnabled
      ? new BusterRuntime({
        executeShot: (execution) => this._executeCompiledBusterShot(execution),
        cancelExecution: ({ token, reason }) => {
          this.projectiles.cancelWhere(
            (projectile) => projectile.reservationToken === token,
            reason ?? 'busterCancelled',
          );
        },
      })
      : null;
    this.combat = new CombatSystem(this);
    this.player.onDodgeStarted = () => this.combat.cancelForDodge();
    this.player.onLedgeClingStarted = () => this.combat.cancelForLedgeCling();
    this.player.onDeathStarted = () => this.combat.cancelForDeath();
    this.player.onSwordJumpSlashLandingRecoveryStarted = (startProgress) => (
      this.combat.beginSwordJumpSlashLandingTrail(startProgress)
    );
    this.spawner = new EnemySpawner(this);
    this.ui = new UIManager(this);
    this.dungeonController = new DungeonController(this, this.dungeon);
    this.player.powerKnockbackTravelResolver = ({ fromPosition, position }) => (
      this.dungeonController.resolvePowerKnockbackTravel(fromPosition, position)
    );
    this.player.powerKnockbackLandingResolver = ({ position, direction, originPosition }) => (
      this.dungeonController.resolvePowerKnockbackLanding(position, direction, originPosition)
    );
    this.mapEvents = new MapEventSystem(this);

    this._addStarterItems();
    if (this.busterLabEnabled) {
      this._initializeBusterLabFeature();
    }
    this.spawner.spawnInitialPack();
    this.ui.renderInventory();
    this._bindEvents();
    this._syncAnimationPreviewDataset();
    this._syncBrowserTestDataset();
    this._updateCamera(1);
    this._updateDungeonRenderCulling(0, { force: true });
  }

  start() {
    this.clock.start();
    this.renderer.setAnimationLoop(() => this._loop());
  }

  stop() {
    this.renderer.setAnimationLoop(null);
  }

  setAnimationPreviewMode(mode = 'off', options = {}) {
    this.animationPreview = this._createAnimationPreview(mode, options);

    if (this.animationPreview.active) {
      this._exitGameplayPointerLock();
      this.keys.clear();
      this.pointer.primary = false;
      this.pointer.primaryPressed = false;
      this.pointer.secondary = false;
      this.pointer.secondaryPressed = false;
      this.pointer.lockOnPressed = false;
      this.pointer.alternate = false;
      this.pointer.alternatePressed = false;
    }

    this._syncAnimationPreviewDataset();
    return this.getAnimationPreviewState();
  }

  getAnimationPreviewState() {
    return {
      active: Boolean(this.animationPreview?.active),
      mode: this.animationPreview?.mode ?? 'off',
      moving: Boolean(this.animationPreview?.moving),
      running: Boolean(this.animationPreview?.running),
      moveAmount: this.animationPreview?.moveAmount ?? 0,
      projectileAiming: Boolean(this.animationPreview?.projectileAiming),
      lockOnActive: Boolean(this.animationPreview?.lockOnActive),
      strafeAmount: this.animationPreview?.strafeAmount ?? 0,
      turnAmount: this.animationPreview?.turnAmount ?? 0,
      backpedaling: Boolean(this.animationPreview?.backpedaling),
      cameraAngle: this.animationPreview?.cameraAngle ?? 'follow',
      attackKind: this.animationPreview?.attackKind ?? null,
      attackProgress: this.animationPreview?.currentAttackProgress ?? this.animationPreview?.attackProgress ?? null,
      clipKey: this.animationPreview?.clipKey ?? null,
    };
  }

  _readAnimationPreviewFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('animationPreview') ?? params.get('animPreview') ?? 'off';

    const parseNumberParam = (...names) => {
      for (const name of names) {
        const rawValue = params.get(name);
        if (rawValue === null) {
          continue;
        }

        const value = Number(rawValue);
        if (Number.isFinite(value)) {
          return value;
        }
      }

      return null;
    };

    const options = {
      cameraAngle: params.get('animationPreviewCamera') ?? params.get('animCamera') ?? 'follow',
    };
    const clipKey = params.get('animationPreviewClip') ?? params.get('fbxClip') ?? params.get('clip');
    const attackProgress = parseNumberParam('animationPreviewAttackProgress', 'animAttackProgress');
    const attackDuration = parseNumberParam('animationPreviewAttackDuration', 'animAttackDuration');
    const turnAmount = parseNumberParam('animationPreviewTurn', 'animTurn', 'turnAmount', 'turn');

    if (clipKey) {
      options.clipKey = clipKey;
    }

    if (attackProgress !== null) {
      options.attackProgress = attackProgress;
    }

    if (attackDuration !== null) {
      options.attackDuration = attackDuration;
    }

    if (turnAmount !== null) {
      options.turnAmount = THREE.MathUtils.clamp(turnAmount, -1, 1);
    }

    return this._createAnimationPreview(mode, options);
  }

  _readRoomPreviewFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('roomPreview');
    if (!roomId) {
      return null;
    }
    const levelParam = params.get('roomPreviewLevel');
    const levelValue = Number(levelParam);
    const facing = {
      north: { x: 0, z: -1 },
      south: { x: 0, z: 1 },
      east: { x: 1, z: 0 },
      west: { x: -1, z: 0 },
    }[params.get('roomPreviewFacing')];
    return {
      roomId,
      level: levelParam !== null && Number.isFinite(levelValue) ? levelValue : null,
      facingX: facing?.x,
      facingZ: facing?.z,
    };
  }

  _getRoomPreviewPosition() {
    if (!this.roomPreview || !this.dungeon) {
      return null;
    }
    const room = this.dungeon.rooms.find((candidate) => candidate.id === this.roomPreview.roomId);
    if (!room) {
      return null;
    }
    const halfW = Math.floor(room.width / 2);
    const halfD = Math.floor(room.depth / 2);
    const candidates = this.dungeon.floorTiles
      .filter((tile) => (
        tile.roomId === room.id
        || (
          Math.abs(tile.x - room.x) <= halfW
          && Math.abs(tile.z - room.z) <= halfD
        )
      ))
      .filter((tile) => tile.surface !== 'industrialRamp');
    const desiredLevel = this.roomPreview.level;
    candidates.sort((a, b) => {
      if (Number.isFinite(desiredLevel)) {
        const levelDelta = Math.abs((a.level ?? 0) - desiredLevel) - Math.abs((b.level ?? 0) - desiredLevel);
        if (Math.abs(levelDelta) > 0.001) {
          return levelDelta;
        }
      }
      const bridgeRankA = a.surface === 'upperConnectionBridge' ? 0 : 1;
      const bridgeRankB = b.surface === 'upperConnectionBridge' ? 0 : 1;
      if (bridgeRankA !== bridgeRankB) {
        return bridgeRankA - bridgeRankB;
      }
      return Math.abs(a.x - room.x) + Math.abs(a.z - room.z)
        - Math.abs(b.x - room.x) - Math.abs(b.z - room.z);
    });
    const tile = candidates[0];
    if (!Number.isFinite(this.roomPreview.facingX) || !Number.isFinite(this.roomPreview.facingZ)) {
      const connection = this.dungeon.connectionPlans.find((plan) => (
        plan.level > 0
        && (plan.fromRoomId === room.id || plan.toRoomId === room.id)
      ));
      const socket = connection
        ? (connection.fromRoomId === room.id ? connection.fromSocket : connection.toSocket)
        : null;
      if (socket) {
        this.roomPreview.facingX = socket.facingX;
        this.roomPreview.facingZ = socket.facingZ;
      }
    }
    return tile
      ? new THREE.Vector3(tile.x * this.dungeon.tileSize, tile.elevation ?? 0, tile.z * this.dungeon.tileSize)
      : null;
  }

  _createAnimationPreview(mode = 'off', options = {}) {
    const normalizedMode = String(mode ?? 'off').trim();
    const modeKey = normalizedMode.toLowerCase();
    const preview = {
      active: modeKey !== '' && modeKey !== 'off' && modeKey !== 'none',
      mode: normalizedMode || 'off',
      moving: false,
      running: false,
      moveAmount: 0,
      projectileAiming: false,
      lockOnActive: false,
      strafeAmount: 0,
      turnAmount: 0,
      backpedaling: false,
      cameraAngle: 'follow',
      attackKind: null,
      attackProgress: null,
      attackDuration: 0,
      currentAttackProgress: null,
      forceSwordArm: false,
      clipKey: null,
    };

    if (preview.active) {
      if (modeKey === 'walk') {
        preview.moving = true;
        preview.moveAmount = 1;
      } else if (modeKey === 'jog' || modeKey === 'sprint') {
        preview.moving = true;
        preview.running = true;
        preview.moveAmount = 1.35;
      } else if (modeKey === 'aim' || modeKey === 'aimidle') {
        preview.projectileAiming = true;
        preview.lockOnActive = true;
      } else if (modeKey === 'aimwalk') {
        preview.moving = true;
        preview.moveAmount = 1;
        preview.projectileAiming = true;
        preview.lockOnActive = true;
      } else if (modeKey === 'aimjog' || modeKey === 'aimsprint') {
        preview.moving = true;
        preview.running = true;
        preview.moveAmount = 1.35;
        preview.projectileAiming = true;
        preview.lockOnActive = true;
      } else if (modeKey === 'strafeleft' || modeKey === 'straferight') {
        preview.moving = true;
        preview.moveAmount = 1;
        preview.projectileAiming = true;
        preview.lockOnActive = true;
        preview.strafeAmount = modeKey === 'strafeleft' ? -1 : 1;
      } else if (modeKey === 'turnleft' || modeKey === 'leftturn') {
        preview.moving = true;
        preview.moveAmount = 1;
        preview.turnAmount = -1;
      } else if (modeKey === 'turnright' || modeKey === 'rightturn') {
        preview.moving = true;
        preview.moveAmount = 1;
        preview.turnAmount = 1;
      } else if (modeKey === 'backpedal' || modeKey === 'aimbackpedal') {
        preview.moving = true;
        preview.moveAmount = 0.92;
        preview.backpedaling = true;
        preview.projectileAiming = true;
        preview.lockOnActive = true;
      } else if (modeKey === 'beamslash'
        || modeKey === 'beamblade'
        || modeKey === 'beambladeslash'
        || modeKey === 'slash'
        || modeKey === 'swordslash') {
        preview.attackKind = 'beamBlade';
        preview.attackDuration = 0.86;
        preview.forceSwordArm = true;
      } else if (modeKey === 'idle') {
        preview.active = true;
      } else {
        preview.clipKey = normalizedMode;
      }
    }

    return {
      ...preview,
      ...options,
      mode: options.mode ?? preview.mode,
      active: options.active ?? preview.active,
      cameraAngle: options.cameraAngle ?? preview.cameraAngle,
    };
  }

  _syncAnimationPreviewDataset() {
    if (typeof document === 'undefined' || !document.body) {
      return;
    }

    const state = this.getAnimationPreviewState();
    document.body.dataset.animationPreview = state.active ? state.mode : 'off';
    document.body.dataset.animationPreviewMoving = state.moving ? 'true' : 'false';
    document.body.dataset.animationPreviewRunning = state.running ? 'true' : 'false';
    document.body.dataset.animationPreviewAiming = state.projectileAiming ? 'true' : 'false';
    document.body.dataset.animationPreviewStrafe = String(Number(state.strafeAmount).toFixed(2));
    document.body.dataset.animationPreviewTurn = String(Number(state.turnAmount).toFixed(2));
    document.body.dataset.animationPreviewBackpedaling = state.backpedaling ? 'true' : 'false';
    document.body.dataset.animationPreviewCamera = state.cameraAngle;
    document.body.dataset.animationPreviewAttackKind = state.attackKind ?? 'none';
    document.body.dataset.animationPreviewClip = state.clipKey ?? 'auto';
    document.body.dataset.animationPreviewAttackProgress = Number.isFinite(state.attackProgress)
      ? String(Number(state.attackProgress).toFixed(3))
      : 'none';
    document.body.dataset.animationPreviewRig = this.player?.externalRig ? 'ready' : 'loading';
    document.body.dataset.animationPreviewPhase = String(Number(this.player?._modelWalkTime ?? 0).toFixed(3));
    document.body.dataset.animationPreviewLegs = JSON.stringify(this._getAnimationPreviewLegTelemetry());
  }

  _syncBrowserTestDataset() {
    if (!this.container?.dataset) {
      return;
    }

    const dataset = this.container.dataset;
    const player = this.player;
    const animation = player?.animation;
    const rig = player?.externalRig;
    const activeAction = rig?.activeAction ?? null;
    const activeClipKey = rig?.activeClipKey ?? null;
    const activeClipDuration = activeClipKey
      ? rig?.animationMetadata?.get?.(activeClipKey)?.duration ?? activeAction?.getClip?.()?.duration ?? null
      : null;
    const actionProgress = animation?.getActionProgress?.();
    const grounding = player?.getExternalModelGroundingDiagnostics?.() ?? null;
    const ledge = player?.getLedgeClingDiagnostics?.() ?? null;
    const playerYaw = player?.root?.rotation?.y;
    const cameraYaw = this.cameraController?.yaw;

    dataset.browserTestReady = 'true';
    dataset.gameElapsed = formatBrowserDiagnosticNumber(this.elapsedTime);
    dataset.canvasCount = String(this.container.querySelectorAll?.('canvas').length ?? 0);
    dataset.playerAnimationState = animation?.state ?? 'none';
    dataset.playerFullBodyAction = animation?.actionState ?? 'none';
    dataset.playerActionProgress = formatBrowserDiagnosticNumber(actionProgress);
    dataset.playerActionDuration = formatBrowserDiagnosticNumber(animation?.actionDuration);
    dataset.playerActionTimer = formatBrowserDiagnosticNumber(animation?.actionTimer);
    dataset.playerRootY = formatBrowserDiagnosticNumber(player?.root?.position?.y);
    dataset.playerYaw = formatBrowserDiagnosticNumber(playerYaw);
    dataset.playerTankTurnActive = player?.tankTurnActive ? 'true' : 'false';
    dataset.playerTankTurnTranslating = player?.tankTurnTranslating ? 'true' : 'false';
    dataset.playerModelRootY = formatBrowserDiagnosticNumber(player?.modelRoot?.position?.y);
    dataset.playerModelVisible = player?.modelRoot?.visible ? 'true' : 'false';
    dataset.cameraYaw = formatBrowserDiagnosticNumber(cameraYaw);
    dataset.cameraYawPlayerDelta = formatBrowserDiagnosticNumber(getBrowserDiagnosticAngleDelta(cameraYaw, playerYaw));
    dataset.playerExternalRig = rig ? (rig.usesFbxAnimationClips ? 'fbx' : 'procedural') : 'loading';
    dataset.playerActiveFbxClip = activeClipKey ?? 'none';
    dataset.playerActiveFbxClipTime = formatBrowserDiagnosticNumber(activeAction?.time);
    dataset.playerActiveFbxClipDuration = formatBrowserDiagnosticNumber(activeClipDuration);
    dataset.playerFootGroundClearance = formatBrowserDiagnosticNumber(grounding?.footClearance);
    dataset.playerLeftFootGroundClearance = formatBrowserDiagnosticNumber(grounding?.leftFootClearance);
    dataset.playerRightFootGroundClearance = formatBrowserDiagnosticNumber(grounding?.rightFootClearance);
    dataset.playerModelBoundsGroundClearance = formatBrowserDiagnosticNumber(grounding?.boundsClearance);
    dataset.playerFootGroundCorrection = formatBrowserDiagnosticNumber(grounding?.correction);
    dataset.playerFootGroundingSource = grounding?.source ?? 'none';
    dataset.playerFootGroundingReason = grounding?.reason ?? 'none';
    dataset.playerFootVertexSampleCount = String(grounding?.footSampleCount ?? 0);
    dataset.playerLedgeState = ledge?.state ?? 'none';
    dataset.playerLedgeProgress = formatBrowserDiagnosticNumber(ledge?.progress);
    dataset.playerLedgeInputToward = ledge?.inputToward ? 'true' : 'false';
    dataset.playerLedgeTopY = formatBrowserDiagnosticNumber(ledge?.topY);
    dataset.debugLedgeCount = String(this.debugLedgeCandidates?.length ?? 0);
    dataset.debugLastLedgeClingId = this.lastDebugLedgeClingId ?? 'none';
    dataset.debugLastLedgeLandingId = this.lastDebugLedgeLandingId ?? 'none';
    const platformDebug = player?.getJumpPhysicsDebug?.();
    dataset.debugJumpHeightMultiplier = formatBrowserDiagnosticNumber(platformDebug?.jumpHeightMultiplier);
    dataset.debugGravityScale = formatBrowserDiagnosticNumber(platformDebug?.gravityScale);
    dataset.debugJumpHeight = formatBrowserDiagnosticNumber(platformDebug?.jumpHeight);
    dataset.debugSpawnedPlatformCount = String(this.debugSpawnedPlatforms?.length ?? 0);
  }

  _getAnimationPreviewLegTelemetry() {
    const rig = this.player?.externalRig;
    const root = this.player?.root;

    if (!rig?.joints || !root) {
      return null;
    }

    const readJoint = (name) => {
      const joint = rig.joints.get(name);
      if (!joint) {
        return null;
      }

      const local = tempVectorD;
      joint.getWorldPosition(local);
      root.worldToLocal(local);
      return {
        x: Number(local.x.toFixed(3)),
        y: Number(local.y.toFixed(3)),
        z: Number(local.z.toFixed(3)),
      };
    };

    const leftHip = readJoint('leftHip');
    const leftKnee = readJoint('leftKnee');
    const leftAnkle = readJoint('leftAnkle');
    const rightHip = readJoint('rightHip');
    const rightKnee = readJoint('rightKnee');
    const rightAnkle = readJoint('rightAnkle');

    return {
      left: {
        hip: leftHip,
        knee: leftKnee,
        ankle: leftAnkle,
        kneeBehindHip: leftHip && leftKnee ? Number((leftKnee.z - leftHip.z).toFixed(3)) : null,
        ankleAheadHip: leftHip && leftAnkle ? Number((leftAnkle.z - leftHip.z).toFixed(3)) : null,
      },
      right: {
        hip: rightHip,
        knee: rightKnee,
        ankle: rightAnkle,
        kneeBehindHip: rightHip && rightKnee ? Number((rightKnee.z - rightHip.z).toFixed(3)) : null,
        ankleAheadHip: rightHip && rightAnkle ? Number((rightAnkle.z - rightHip.z).toFixed(3)) : null,
      },
    };
  }

  setInventoryOpen(open, { mode = 'garage' } = {}) {
    if (open && this.poseDebugOpen) {
      this.setPoseDebugOpen(false);
    }

    this.inventoryOpen = open;
    if (open) {
      this._exitGameplayPointerLock();
      this.pointer.primary = false;
      this.pointer.primaryPressed = false;
      this.pointer.secondary = false;
      this.pointer.secondaryPressed = false;
      this.pointer.lockOnPressed = false;
      this.pointer.alternate = false;
      this.pointer.alternatePressed = false;
    }
    this.ui.setInventoryOpen(open, { mode });
  }

  setPoseDebugOpen(open) {
    if (open && this.inventoryOpen) {
      this.setInventoryOpen(false);
    }

    this.poseDebugOpen = open;
    if (open) {
      this._exitGameplayPointerLock();
      this.pointer.primary = false;
      this.pointer.primaryPressed = false;
      this.pointer.secondary = false;
      this.pointer.secondaryPressed = false;
      this.pointer.lockOnPressed = false;
      this.pointer.alternate = false;
      this.pointer.alternatePressed = false;
      this.keys.clear();
      this._syncPoseDebugCameraFromCurrent();
    } else {
      this._endPoseDebugDrag();
      this.poseDebugCamera.rotating = false;
    }

    this._setPoseDebugHandlesVisible(open && this.poseDebugSection === 'pose');
    this.ui.setPoseDebugOpen(open);
  }

  setPoseDebugSection(section = 'pose') {
    this.poseDebugSection = section === 'platforming'
      ? 'platforming'
      : section === 'buster' && this.busterLabEnabled
        ? 'buster'
        : 'pose';
    this._setPoseDebugHandlesVisible(this.poseDebugOpen && this.poseDebugSection === 'pose');
    if (this.poseDebugSection !== 'pose') {
      this.player.externalRig?.setDebugPoseEnabled?.(false);
    }
    return this.poseDebugSection;
  }

  setDebugJumpHeightPreset(preset = 'normal') {
    const key = Object.hasOwn(DEBUG_JUMP_HEIGHT_PRESETS, preset) ? preset : 'normal';
    this.debugJumpHeightPreset = key;
    this.player.setJumpPhysicsDebug({ jumpHeightMultiplier: DEBUG_JUMP_HEIGHT_PRESETS[key] });
    return this.getPlatformDebugState();
  }

  setDebugGravityPreset(preset = 'normal') {
    const key = Object.hasOwn(DEBUG_GRAVITY_PRESETS, preset) ? preset : 'normal';
    this.debugGravityPreset = key;
    this.player.setJumpPhysicsDebug({ gravityScale: DEBUG_GRAVITY_PRESETS[key] });
    return this.getPlatformDebugState();
  }

  getPlatformDebugState() {
    const jump = this.player.getJumpPhysicsDebug();
    return {
      jumpHeightPreset: this.debugJumpHeightPreset,
      gravityPreset: this.debugGravityPreset,
      jumpHeightMultiplier: jump.jumpHeightMultiplier,
      gravityScale: jump.gravityScale,
      jumpHeight: jump.jumpHeight,
      timeToApex: jump.timeToApex,
      minimumGrabElevation: jump.jumpHeight * PLATFORM_NORMAL_JUMP_REACH_RATIO,
      maximumGrabElevation: jump.jumpHeight * PLATFORM_LEDGE_MAX_REACH_RATIO,
      spawnedPlatformCount: this.debugSpawnedPlatforms.length,
    };
  }

  spawnDebugPlatform({ width = 3, depth = 3, height = 3, distance = 5 } = {}) {
    const resolvedWidth = THREE.MathUtils.clamp(Number(width) || 3, 0.5, 12);
    const resolvedDepth = THREE.MathUtils.clamp(Number(depth) || 3, 0.5, 12);
    const resolvedHeight = THREE.MathUtils.clamp(Number(height) || 3, 0.25, 12);
    const resolvedDistance = Math.max(
      THREE.MathUtils.clamp(Number(distance) || 5, 2, 20),
      resolvedDepth * 0.5 + 1.5,
    );
    const forward = tempVectorA.set(
      Math.sin(this.player.root.rotation.y),
      0,
      Math.cos(this.player.root.rotation.y),
    ).normalize();
    const baseY = this._getPlayerGroundY();
    const center = this.player.root.position.clone()
      .addScaledVector(forward, resolvedDistance)
      .setY(baseY + resolvedHeight * 0.5);
    const id = `debugPlatform${++this.debugPlatformCounter}`;
    const group = new THREE.Group();
    group.name = id;
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x34434f,
      roughness: 0.84,
      metalness: 0.1,
    });
    const lipMaterial = new THREE.MeshStandardMaterial({
      color: 0x74e6ff,
      emissive: 0x1a6070,
      emissiveIntensity: 0.55,
      roughness: 0.42,
      metalness: 0.2,
    });
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(resolvedWidth, resolvedHeight, resolvedDepth),
      bodyMaterial,
    );
    body.name = `${id}Body`;
    body.position.copy(center);
    body.castShadow = true;
    body.receiveShadow = true;
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(resolvedWidth + 0.08, 0.08, resolvedDepth + 0.08),
      lipMaterial,
    );
    lip.name = `${id}Lip`;
    lip.position.set(center.x, baseY + resolvedHeight - 0.04, center.z);
    lip.castShadow = true;
    lip.receiveShadow = true;
    group.add(body, lip);
    this.debugSpawnedPlatformGroup.add(group);

    const platform = {
      id,
      center,
      halfWidth: resolvedWidth * 0.5,
      halfDepth: resolvedDepth * 0.5,
      topY: baseY + resolvedHeight,
      baseY,
      object: group,
      debugSpawned: true,
    };
    this.debugSpawnedPlatforms.push(platform);
    this._rebuildPlatformingLedgeCandidates();
    return platform;
  }

  clearDebugPlatforms() {
    const activeLedgeId = this.player?.ledgeCling?.id ?? '';
    for (const platform of this.debugSpawnedPlatforms) {
      platform.object?.traverse?.((object) => {
        object.geometry?.dispose?.();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material?.dispose?.();
      });
      platform.object?.removeFromParent?.();
      if (activeLedgeId.startsWith(`${platform.id}-`)) {
        this.player.ledgeCling = null;
      }
    }
    const removed = this.debugSpawnedPlatforms.length;
    this.debugSpawnedPlatforms = [];
    this._rebuildPlatformingLedgeCandidates();
    return removed;
  }

  addEnemy(enemy) {
    this.enemies.push(enemy);
    this.scene.add(enemy.root);
  }

  damageJunkAtPosition(position, radius, amount, meta = {}) {
    let hits = 0;

    for (const junk of this.destructibles) {
      if (junk.dead) {
        continue;
      }

      tempVectorA.copy(junk.root.position);
      tempVectorA.y = position.y;
      const hitRadius = radius + junk.radius;
      if (tempVectorA.distanceToSquared(position) > hitRadius * hitRadius) {
        continue;
      }

      this._damageJunk(junk, amount, meta);
      hits += 1;
    }

    return hits;
  }

  damageJunkAlongLine(origin, direction, range, width, amount, meta = {}) {
    let hits = 0;
    tempVectorA.copy(origin);
    tempVectorA.y = 0;
    tempVectorB.copy(direction);
    tempVectorB.y = 0;

    if (tempVectorB.lengthSq() <= 0.0001) {
      return 0;
    }

    tempVectorB.normalize();

    for (const junk of this.destructibles) {
      if (junk.dead) {
        continue;
      }

      tempVectorC.copy(junk.root.position).sub(tempVectorA);
      tempVectorC.y = 0;
      const along = tempVectorC.dot(tempVectorB);
      if (along < -junk.radius * 0.35 || along > range + junk.radius * 0.35) {
        continue;
      }

      tempVectorD.copy(tempVectorA).addScaledVector(tempVectorB, Math.max(0, Math.min(range, along)));
      const hitRadius = width + junk.radius;
      if (junk.root.position.distanceToSquared(tempVectorD) > hitRadius * hitRadius) {
        continue;
      }

      this._damageJunk(junk, amount, meta);
      hits += 1;
    }

    return hits;
  }

  spawnEnemy(type = 'basic', elite = false) {
    return this.spawner.spawnEnemy(type, elite);
  }

  isPlayerInSafeArea() {
    return Boolean(this.dungeonController?.isPlayerInSafeZone?.());
  }

  getNearestInteractable() {
    return this.dungeonController?.getNearestInteractable?.()
      ?? this.mapEvents?.getNearestInteractable?.()
      ?? null;
  }

  activateNearestInteractable() {
    if (this.dungeonController?.activateNearest?.()) {
      return true;
    }

    return this.mapEvents?.activateNearest?.() ?? false;
  }

  getRuinResetCost() {
    return 120 + Math.max(0, this.ruinFloor - 1) * 45;
  }

  getObjectiveText() {
    if (this.busterTestRange?.active) return 'Buster Test Range — Escape to return';
    return this.dungeonController?.getObjectiveText?.()
      ?? (this.ruinCompleted ? 'Return to camp' : 'Explore ruin');
  }

  beginExpedition({ silent = false, position = null } = {}) {
    if (this.ruinCompleted) {
      return false;
    }

    const wasAccepted = this.expeditionAccepted;
    this.expeditionAccepted = true;

    if (!silent) {
      this.ui?.showToast?.(
        wasAccepted ? 'Briefing active: descend when ready' : 'Expedition briefing accepted',
        '#ffd66b',
      );
    }

    if (position) {
      tempVectorA.copy(position);
      tempVectorA.y = 0.7;
      this.addParticleBurst(tempVectorA, 0xffd66b, 14, 0.12);
    }

    this.ui?.renderInventory?.();
    return true;
  }

  enterRuinFromCamp() {
    const target = this.dungeon?.ruinEntryPosition?.clone?.()
      ?? this.dungeon?.playerStart?.clone?.()
      ?? null;

    if (!target || this.ruinCompleted) {
      return false;
    }

    this.beginExpedition({ silent: true });
    this.expeditionActive = true;
    this.player.root.position.copy(target);
    this.player.root.position.y = 0;
    this.player.lastMoveDirection.set(0, 0, 1);
    this.player.faceDirection(this.player.lastMoveDirection);
    this.dungeonController?.lastSafePlayerPosition?.copy?.(this.player.root.position);
    this.cameraController.snapTo(this.player);
    this.addParticleBurst(this.player.root.position, 0x7df8ff, 24, 0.16);
    this.ui?.showToast?.('Descending into the ruin', '#7df8ff');
    this.ui?.renderInventory?.();
    return true;
  }

  getQuestLogEntries() {
    const controller = this.dungeonController;
    const entries = [];
    const shrine = controller?.shrine ?? null;
    const shrineDoor = controller?.doors?.find?.((door) => door.id === 'Door_Shrine') ?? null;
    const trackedDoor = controller?.progressionManager?.getCurrentTrackedDoor?.(controller?.doors ?? []) ?? null;
    const nextKeycard = controller?._getNextUncollectedProgressionKeycard?.() ?? null;
    const bonusDoor = controller?.doors?.find?.((door) => door.id === 'bonusVaultDoor') ?? null;
    const conveyorPuzzle = controller?.conveyorPuzzles?.find?.((puzzle) => puzzle.targetDoorId === 'bonusVaultDoor')
      ?? controller?.conveyorPuzzles?.[0]
      ?? null;
    const conveyorPuzzleControls = conveyorPuzzle
      ? controller?.mechanisms?.filter?.((mechanism) => mechanism.conveyorPuzzleId === conveyorPuzzle.id) ?? []
      : [];
    const conveyorBlockingEncounter = conveyorPuzzleControls
      .map((mechanism) => (
        mechanism.requiresEncounterId
          ? controller?.encounters?.find?.((encounter) => encounter.id === mechanism.requiresEncounterId && !encounter.cleared)
          : null
      ))
      .find(Boolean);
    const conveyorRouteReady = Boolean(conveyorPuzzle?.junctions?.every?.((junction) => (
      (junction.stateIndex ?? 0) === (conveyorPuzzle.solutionState?.[junction.id] ?? junction.solutionStateIndex ?? 0)
    )));

    const refractorComplete = Boolean(this.ruinCompleted);
    const extracted = refractorComplete && Boolean(controller?.isPlayerInSafeZone?.());
    const expeditionStarted = Boolean(this.expeditionAccepted || this.expeditionActive);
    entries.push({
      id: 'largeRefractor',
      title: 'Large Refractor Expedition',
      status: extracted
        ? 'Recovered'
        : refractorComplete
          ? 'Extract to camp'
          : !expeditionStarted
            ? 'Enter ruin'
            : shrine?.collected
            ? 'Extraction pad online'
            : shrineDoor?.closed
              ? 'Defeat boss and unlock shrine'
              : 'Secure the refractor',
      detail: extracted
        ? `${this.largeRefractorsSecured} Large Refractor${this.largeRefractorsSecured === 1 ? '' : 's'} secured`
        : 'Enter the ruin, defeat the boss for the Shrine Key, recover the ruin core, and return to camp.',
      progress: extracted ? 1 : refractorComplete ? 0.9 : !expeditionStarted ? 0.18 : shrineDoor?.closed ? 0.55 : 0.78,
      color: '#7df8ff',
    });

    if (trackedDoor || nextKeycard) {
      entries.push({
        id: 'keycardRoute',
        title: 'Security Keycard Route',
        status: trackedDoor
          ? `${trackedDoor.keycard.displayName} ready`
          : nextKeycard
            ? `Recover ${nextKeycard.spawnMode === 'Chest' ? 'keycard chest' : nextKeycard.spawnMode === 'EliteEnemyDrop' ? 'elite carrier keycard' : nextKeycard.displayName}`
            : 'Route opened',
        detail: trackedDoor
          ? `Use ${trackedDoor.keycard.displayName} at ${trackedDoor.runtimeDoor.label}.`
          : 'Progressive keycards unlock their paired security doors.',
        progress: trackedDoor ? 0.72 : nextKeycard ? 0.34 : 1,
        color: '#ffd66b',
      });
    }

    if (bonusDoor && conveyorPuzzle) {
      const vaultOpened = !bonusDoor.closed || conveyorPuzzle.completed || conveyorPuzzle.state === 'VaultOpened';
      const cargoMoving = conveyorPuzzle.state === 'ObjectMoving';
      const cargoBlocked = conveyorPuzzle.state === 'ObjectBlocked';
      entries.push({
        id: 'conveyorCargoVault',
        title: 'Optional Cargo Routing Vault',
        status: vaultOpened
          ? 'Vault opened'
          : conveyorBlockingEncounter
            ? `Clear ${conveyorBlockingEncounter.label}`
            : cargoMoving
              ? 'Cargo moving'
              : cargoBlocked
                ? 'Reset cargo'
                : conveyorRouteReady
                  ? 'Release cargo'
                  : 'Set receiver route',
        detail: vaultOpened
          ? 'The optional conveyor vault route is unlocked.'
          : 'Set the conveyor route, release the cargo, and guide it to the receiver plate to open the optional vault.',
        progress: vaultOpened
          ? 1
          : conveyorBlockingEncounter
            ? 0.22
            : cargoMoving
              ? 0.66
              : cargoBlocked
                ? 0.48
                : conveyorRouteReady
                  ? 0.52
                  : 0.34,
        color: '#6bdcff',
      });
    }

    return entries;
  }

  identifyReaverbotScrap() {
    const pending = Math.max(0, Math.trunc(this.inventory.unidentifiedScrap) || 0);
    if (pending <= 0) {
      this.ui?.showToast?.('Roll: no unidentified scrap to inspect', '#c7d0d6');
      return null;
    }

    const transfer = this.inventory.takeAllUnidentifiedScrap();
    let result;
    try {
      result = this.rollSalvageStorage.identifyRecoveries(transfer);
    } catch (error) {
      this.inventory.unidentifiedScrap = transfer.total;
      this.inventory.unidentifiedRecoveries = transfer.recoveries.map((recovery) => ({
        quantity: recovery.quantity,
        source: recovery.source ? { ...recovery.source } : null,
        recoverableParts: (recovery.recoverableParts ?? []).map((part) => ({
          ...part,
          source: part.source ? { ...part.source } : null,
        })),
      }));
      this.ui?.showToast?.('Roll could not save the analysis; no scrap was consumed', '#ff9f73');
      this.ui?.renderInventory?.();
      return { ok: false, error };
    }
    const partMessage = result.partCount > 0
      ? `; ${result.partCount} recoverable part${result.partCount === 1 ? '' : 's'} found`
      : '';
    this.ui?.showToast?.(
      `Roll identified ${result.processed}: ${result.scrapStored} crafting scrap${partMessage}`,
      result.partCount > 0 ? '#ffd66b' : '#7df8ff',
    );
    this.ui?.setScrapIdentificationResult?.(result);
    this.ui?.renderInventory?.();
    return result;
  }

  completeRuinObjective({ reward = 650, position = null } = {}) {
    if (this.ruinCompleted) {
      return false;
    }

    this.ruinCompleted = true;
    this.largeRefractorsSecured += 1;
    this.inventory.gold += reward;

    if (position) {
      this.addParticleBurst(position, 0x7df8ff, 42, 0.24);
    }

    this.ui?.showToast?.(`Large Refractor secured +${reward}z`, '#7df8ff');
    this.ui?.renderInventory?.();
    return true;
  }

  extractToCamp() {
    const target = this.dungeon?.campReturnPosition?.clone?.()
      ?? this.dungeon?.playerStart?.clone?.()
      ?? null;

    if (!target) {
      return false;
    }

    this.player.root.position.copy(target);
    this.player.root.position.y = 0;
    this.player.lastMoveDirection.set(0, 0, 1);
    this.player.faceDirection(this.player.lastMoveDirection);
    this.expeditionActive = false;
    this.dungeonController?.lastSafePlayerPosition?.copy?.(this.player.root.position);
    this.cameraController.snapTo(this.player);
    this.addParticleBurst(this.player.root.position, 0x6bdcff, 28, 0.18);
    this.ui?.showToast?.('Returned to expedition camp', '#6bdcff');
    return true;
  }

  offerRuinReset() {
    if (this.ruinCompleted) {
      this.resetDungeonLayout({ free: true, message: 'Ruin shifted after Large Refractor recovery' });
      return true;
    }

    const cost = this.getRuinResetCost();
    if (this.inventory.gold < cost) {
      this.ui?.showToast?.(`Need ${cost}z to reset the ruin`, '#ffb347');
      return false;
    }

    this.inventory.gold -= cost;
    this.resetDungeonLayout({ free: true, message: `Ruin reset for ${cost}z` });
    return true;
  }

  resetDungeonLayout({ free = false, message = 'Ruin layout reset' } = {}) {
    if (!free) {
      const cost = this.getRuinResetCost();
      if (this.inventory.gold < cost) {
        this.ui?.showToast?.(`Need ${cost}z to reset the ruin`, '#ffb347');
        return false;
      }
      this.inventory.gold -= cost;
    }

    const previousDungeon = this.dungeon;
    this._clearDungeonRunState();
    const dungeon = new DungeonGenerator({ difficulty: this.ruinFloor }).generate();
    for (const animator of previousDungeon?.npcAnimators ?? []) animator.dispose?.();
    previousDungeon?.group?.removeFromParent?.();
    this.dungeon = dungeon;
    this.platformingPlatforms = [...(dungeon.platforms ?? [])];
    this._rebuildPlatformingLedgeCandidates();
    this.arenaRadius = dungeon.boundsRadius ?? this.arenaRadius;
    this.scene.add(dungeon.group);
    dungeon.activateNpcAssets?.();
    this.lastDungeonResourceDisposalStats = this._disposeDetachedDungeonResources(
      previousDungeon?.group,
    );
    this._collectCameraOcclusionWalls();
    this._collectDungeonRenderCullGroups();
    this._rebuildDebugLedgeTester(dungeon.playerStart);
    this.dungeonController = new DungeonController(this, dungeon);

    this.player.root.position.copy(dungeon.playerStart);
    this.player.lastMoveDirection.set(0, 0, 1);
    this.player.faceDirection(this.player.lastMoveDirection);
    this.cameraController.snapTo(this.player);
    this._updateDungeonRenderCulling(0, { force: true });

    this.spawner = new EnemySpawner(this);
    this.spawner.spawnInitialPack();
    this.ruinFloor += 1;
    this.ruinCompleted = false;
    this.expeditionAccepted = false;
    this.expeditionActive = false;

    this.ui?.showToast?.(message, '#6bdcff');
    this.ui?.renderInventory?.();
    return true;
  }

  generateLoot(type = null, rarity = null) {
    const item = this.lootSystem.generateItem(this.player.level, {
      type: type ?? undefined,
      rarity: rarity ?? undefined,
    });
    if (this.busterLabEnabled && this._convertLegacyBusterPartItem(item, { futureAcquisition: true })) {
      this.ui.renderInventory();
      return item;
    }
    this.inventory.addItem(item);
    this.ui.renderInventory();
    return item;
  }

  _initializeBusterLabFeature() {
    this._migrateLegacyBusterParts();
    this._recompileBusterPlans?.();
    this._restoreCustomBusterAssignments();
  }

  _getBusterLabState() {
    this.busterLabState = this.busterLabStorage?.state ?? this.busterLabState;
    return this.busterLabState;
  }

  _refreshRollSalvageStorage() {
    if (!this.busterLabStorage) return;
    this.busterLabState = this.busterLabStorage.state;
    this.rollSalvageStorage = this.busterLabStorage.createRollSalvageStorage();
  }

  _ensureMegaCalibrationState(state) {
    const source = state.megaCalibrations && typeof state.megaCalibrations === 'object'
      ? state.megaCalibrations
      : {};
    if (!Array.isArray(source.instances)) source.instances = [];
    if (!Array.isArray(source.slots)) source.slots = [null, null, null, null];
    source.slots = Array.from(
      { length: MEGA_BUSTER_BASE_PROFILE.socketCount },
      (_, index) => source.slots[index] ?? null,
    );
    source.nextInstanceId = Math.max(1, Math.trunc(Number(source.nextInstanceId)) || 1);
    source.revision = Math.max(1, Math.trunc(Number(source.revision)) || 1);
    state.megaCalibrations = source;
    return source;
  }

  _appendMegaCalibration(state, legacyType, { preferredSlot = null } = {}) {
    const definition = MEGA_BUSTER_CALIBRATION_CATALOG[legacyType];
    if (!definition) return null;
    const calibration = this._ensureMegaCalibrationState(state);
    let instanceId = '';
    do {
      instanceId = `calibration-${calibration.nextInstanceId++}`;
    } while (calibration.instances.some((entry) => entry.instanceId === instanceId));
    const instance = {
      instanceId,
      legacyType,
      name: definition.name,
      bonuses: { ...definition.bonuses },
    };
    calibration.instances.push(instance);
    if (Number.isInteger(preferredSlot)
      && preferredSlot >= 0
      && preferredSlot < MEGA_BUSTER_BASE_PROFILE.socketCount
      && !calibration.slots[preferredSlot]) {
      calibration.slots[preferredSlot] = instanceId;
      calibration.revision += 1;
    }
    return instance;
  }

  _migrateLegacyBusterParts() {
    const installed = (this.player.busterUpgradeSlots ?? [])
      .map((item, slotIndex) => ({ item, slotIndex }))
      .filter(({ item }) => Boolean(MEGA_BUSTER_CALIBRATION_CATALOG[item?.type]));
    const inventoryParts = this.inventory.items
      .filter((item) => Boolean(MEGA_BUSTER_CALIBRATION_CATALOG[item?.type]));
    const state = this._getBusterLabState();
    if (!state) return;

    const alreadyMigrated = Boolean(state.migrations?.legacyBusterPartsConverted);
    let conversionSucceeded = alreadyMigrated;
    if (!alreadyMigrated) {
      const result = this.busterLabStorage.mutate((candidate) => {
        candidate.migrations = candidate.migrations && typeof candidate.migrations === 'object'
          ? candidate.migrations
          : {};
        const calibration = this._ensureMegaCalibrationState(candidate);
        for (const { item, slotIndex } of installed) {
          this._appendMegaCalibration(candidate, item.type, { preferredSlot: slotIndex });
        }
        for (const item of inventoryParts) this._appendMegaCalibration(candidate, item.type);
        if (!candidate.migrations.starterPowerCalibrationGranted) {
          const starter = this._appendMegaCalibration(candidate, 'powerRaiser');
          const firstEmpty = calibration.slots.findIndex((entry) => !entry);
          if (starter && firstEmpty >= 0) {
            calibration.slots[firstEmpty] = starter.instanceId;
            calibration.revision += 1;
          }
          candidate.migrations.starterPowerCalibrationGranted = true;
        }
        candidate.migrations.legacyBusterPartsConverted = true;
      });
      conversionSucceeded = result.ok;
      if (result.ok) this.busterLabState = result.state;
    } else if (installed.length > 0 || inventoryParts.length > 0) {
      const result = this.busterLabStorage.mutate((candidate) => {
        for (const { item, slotIndex } of installed) {
          this._appendMegaCalibration(candidate, item.type, { preferredSlot: slotIndex });
        }
        for (const item of inventoryParts) this._appendMegaCalibration(candidate, item.type);
      });
      conversionSucceeded = result.ok;
      if (result.ok) this.busterLabState = result.state;
    }

    if (conversionSucceeded && (installed.length > 0 || inventoryParts.length > 0)) {
      for (const { slotIndex } of installed) this.player.busterUpgradeSlots[slotIndex] = null;
      const convertedIds = new Set(inventoryParts.map((item) => item.id));
      this.inventory.items = this.inventory.items.filter((item) => !convertedIds.has(item.id));
      this.player.recalculateStats();
      this.player.updateWeaponVisualState?.();
    }
  }

  _convertLegacyBusterPartItem(item, { futureAcquisition = false } = {}) {
    if (!this.busterLabEnabled || !MEGA_BUSTER_CALIBRATION_CATALOG[item?.type] || !this.busterLabStorage) {
      return false;
    }
    const result = this.busterLabStorage.mutate((state) => {
      this._appendMegaCalibration(state, item.type);
      state.migrations = state.migrations && typeof state.migrations === 'object' ? state.migrations : {};
      if (futureAcquisition) state.migrations.futureCalibrationIntercepted = true;
    });
    if (!result.ok) return false;
    this.busterLabState = result.state;
    this._recompileMegaBusterPlan?.();
    return true;
  }

  _getMegaCalibrationRatings(state = this._getBusterLabState()) {
    const calibration = this._ensureMegaCalibrationState(state);
    const ratings = { power: 4, energy: 4, range: 4, rapid: 4 };
    for (const instanceId of calibration.slots) {
      const instance = calibration.instances.find((entry) => entry.instanceId === instanceId);
      for (const [stat, amount] of Object.entries(instance?.bonuses ?? {})) {
        if (Object.hasOwn(ratings, stat)) ratings[stat] = Math.min(10, ratings[stat] + Number(amount || 0));
      }
    }
    return ratings;
  }

  setMegaBusterCalibration(slotIndex, instanceId) {
    if (!this.busterLabEnabled
      || !Number.isInteger(slotIndex)
      || slotIndex < 0
      || slotIndex >= MEGA_BUSTER_BASE_PROFILE.socketCount) {
      return { ok: false, message: 'Invalid Mega calibration socket.' };
    }
    const result = this.busterLabStorage.mutate((state) => {
      const calibration = this._ensureMegaCalibrationState(state);
      if (instanceId && !calibration.instances.some((entry) => entry.instanceId === instanceId)) {
        throw new Error('That calibration is not in Roll’s stockpile.');
      }
      if (instanceId && calibration.slots.some((entry, index) => index !== slotIndex && entry === instanceId)) {
        throw new Error('A physical calibration can occupy only one socket.');
      }
      const nextSlots = [...calibration.slots];
      nextSlots[slotIndex] = instanceId || null;
      const ratings = { power: 4, energy: 4, range: 4, rapid: 4 };
      for (const id of nextSlots) {
        const instance = calibration.instances.find((entry) => entry.instanceId === id);
        for (const [stat, amount] of Object.entries(instance?.bonuses ?? {})) {
          if (Object.hasOwn(ratings, stat)) ratings[stat] += Number(amount || 0);
        }
      }
      if (Object.values(ratings).some((rating) => rating > 10)) {
        throw new Error('That calibration would raise a Mega Buster rating above 10.');
      }
      calibration.slots = nextSlots;
      calibration.revision += 1;
    });
    if (!result.ok) return { ok: false, message: result.error?.message ?? 'Calibration could not be installed.' };
    this.busterLabState = result.state;
    this.busterRuntime?.cancelBuild('megaBuster', 'recompile');
    this._recompileMegaBusterPlan?.();
    return { ok: true, message: 'Mega Buster calibration updated.' };
  }

  _createCustomBusterArmDescriptor(buildId) {
    return {
      id: `custom-buster:${buildId}`,
      buildId,
      kind: 'customBuster',
      type: 'customBusterArm',
      typeLabel: 'Custom Buster',
      name: buildId === 'build-b' ? 'Custom Buster B' : 'Custom Buster A',
      slot: 'weapon',
      category: 'Arm Weapon',
      weaponKind: 'projectile',
      glowColor: 0xf2c84b,
      color: '#f2c84b',
      getStatTotals: () => ({}),
      getPowerScore: () => 0,
      getDisplayLines: () => ['Compiled weapon-local PWR / ENG / RNG / RPD'],
    };
  }

  handleDisplacedCustomBuster(slotIndex, item, reason = 'slotReplaced') {
    if (!this.busterLabEnabled || item?.type !== 'customBusterArm' || ![1, 2].includes(slotIndex)) {
      return false;
    }
    const result = this.busterLabStorage.assignBuildToSlot(null, slotIndex);
    if (result.ok) this.busterLabState = result.state;
    this.busterRuntime?.cancelBuild(item.buildId, reason);
    return true;
  }

  getResolvedArmSlot(slotIndex) {
    const index = Math.max(0, Math.min(3, Math.trunc(Number(slotIndex)) || 0));
    if (this.busterLabEnabled && index === 0) return { kind: 'megaBuster' };
    const item = this.player.armHotbar[index] ?? null;
    if (this.busterLabEnabled && item?.type === 'customBusterArm') {
      return { kind: 'customBuster', buildId: item.buildId };
    }
    return item ? { kind: 'legacyItem', item } : null;
  }

  getBusterPlanForSlot(slotIndex) {
    if (!this.busterLabEnabled) return null;
    if (this.busterTestRange?.active && slotIndex === this.player.activeArmIndex) {
      return this.busterTestRange.plan;
    }
    const resolved = this.getResolvedArmSlot(slotIndex);
    if (resolved?.kind === 'megaBuster') return this.busterLabPlans.get('megaBuster') ?? null;
    if (resolved?.kind === 'customBuster') return this.busterLabPlans.get(resolved.buildId) ?? null;
    return null;
  }

  getActiveBusterPlan() {
    return this.getBusterPlanForSlot(this.player.activeArmIndex);
  }

  _restoreCustomBusterAssignments() {
    const assignments = this._getBusterLabState()?.assignments?.slots ?? {};
    for (const slotIndex of [1, 2]) {
      const buildId = assignments[String(slotIndex)] ?? assignments[slotIndex];
      if (!buildId || !this.busterLabPlans.has(buildId)) continue;
      const displaced = this.player.armHotbar[slotIndex];
      if (displaced && displaced.type !== 'customBusterArm') this.inventory.addItem(displaced);
      this.player.armHotbar[slotIndex] = this._createCustomBusterArmDescriptor(buildId);
    }
    if (!this.getActiveBusterPlan() && this.player.getActiveArmWeapon?.()?.type === 'customBusterArm') {
      this.player.switchArmWeapon(0, true);
    }
  }

  _getBusterBuildRecord(buildId, kind = 'draft') {
    const state = this._getBusterLabState();
    const list = kind === 'saved' ? state?.chassisBuilds : state?.chassisDrafts;
    return list?.find((entry) => entry.buildId === buildId) ?? null;
  }

  _isBusterDraftSaved(buildId) {
    const draft = this._getBusterBuildRecord(buildId, 'draft');
    const saved = this._getBusterBuildRecord(buildId, 'saved');
    return Boolean(draft && saved && serializeBusterBuild(draft) === serializeBusterBuild(saved));
  }

  _getProgramSelections(build) {
    const selections = {
      emitter: '',
      rootModifier: '',
      trigger: '',
      childModifier: '',
      splitter: '',
      payload: 'pulsePayload',
    };
    const nodes = new Map((build?.program?.nodes ?? []).map((node) => [node.nodeId, node]));
    const nextByNode = new Map();
    const childByNode = new Map();
    for (const edge of build?.program?.edges ?? []) {
      if (edge.port === 'child') childByNode.set(edge.from, edge.to);
      else if (edge.port === 'next') nextByNode.set(edge.from, edge.to);
    }
    let nodeId = build?.program?.rootNodeId;
    let scope = 'root';
    const visited = new Set();
    while (nodeId && nodes.has(nodeId) && !visited.has(nodeId)) {
      visited.add(nodeId);
      const node = nodes.get(nodeId);
      const definition = getBusterModuleDefinition(node.moduleId);
      if (definition?.kind === 'emitter') selections.emitter = node.moduleId;
      else if (definition?.kind === 'modifier') {
        if (scope === 'root' && !selections.trigger) selections.rootModifier = node.moduleId;
        else selections.childModifier = node.moduleId;
      } else if (definition?.kind === 'trigger') {
        selections.trigger = node.moduleId;
        scope = 'child';
        nodeId = childByNode.get(nodeId);
        continue;
      } else if (definition?.kind === 'splitter') selections.splitter = node.moduleId;
      else if (definition?.kind === 'payload') selections.payload = node.moduleId;
      nodeId = nextByNode.get(nodeId);
    }
    return selections;
  }

  _getModuleInstanceForProgram(moduleId, buildId, used, existingInstances = []) {
    const definition = getBusterModuleDefinition(moduleId);
    if (!definition?.physical) return null;
    const state = this._getBusterLabState();
    const claimed = new Set(this.busterLabStorage.getClaimedModuleInstanceIds({ excludeBuildId: buildId }));
    const candidates = [
      ...existingInstances.filter((entry) => entry.moduleId === moduleId),
      ...(state?.moduleInstances ?? []).filter((entry) => entry.moduleId === moduleId),
    ];
    const instance = candidates.find((entry) => {
      const id = entry.moduleInstanceId ?? entry.instanceId;
      return id && !used.has(id) && !claimed.has(id);
    });
    const instanceId = instance?.moduleInstanceId ?? instance?.instanceId ?? null;
    if (instanceId) used.add(instanceId);
    return instanceId;
  }

  _buildProgramFromSelections(build, selections) {
    const nodes = [];
    const edges = [];
    const usedInstances = new Set();
    const existingInstances = (build?.program?.nodes ?? []).map((node) => ({
      moduleId: node.moduleId,
      moduleInstanceId: node.moduleInstanceId,
    }));
    const addNode = (nodeId, moduleId) => {
      if (!moduleId) return null;
      const node = {
        nodeId,
        moduleId,
        moduleInstanceId: this._getModuleInstanceForProgram(
          moduleId,
          build.buildId,
          usedInstances,
          existingInstances,
        ),
      };
      nodes.push(node);
      return node;
    };
    const connect = (from, to, port = 'next') => {
      if (from && to) edges.push({ from: from.nodeId, port, to: to.nodeId });
    };

    const emitter = addNode('emitter', selections.emitter);
    let rootTail = emitter;
    const rootModifier = addNode('root-modifier', selections.rootModifier);
    connect(rootTail, rootModifier);
    rootTail = rootModifier ?? rootTail;
    const trigger = addNode('trigger', selections.trigger);
    connect(rootTail, trigger);
    if (trigger) rootTail = trigger;

    let branchHead = null;
    let branchTail = null;
    const appendBranch = (node) => {
      if (!node) return;
      if (!branchHead) branchHead = node;
      connect(branchTail, node);
      branchTail = node;
    };
    appendBranch(addNode('child-modifier', selections.childModifier));
    appendBranch(addNode('splitter', selections.splitter));
    if (selections.payload === 'explosion') {
      appendBranch(addNode('payload', 'explosion'));
    } else if (trigger && !branchHead) {
      appendBranch(addNode('payload', 'pulsePayload'));
    } else if (trigger && selections.childModifier && !selections.splitter) {
      appendBranch(addNode('payload', 'pulsePayload'));
    }

    if (trigger) connect(trigger, branchHead, 'child');
    else connect(rootTail, branchHead);
    return {
      rootNodeId: emitter?.nodeId ?? null,
      nodes,
      edges,
    };
  }

  updateBusterDraft(buildId, action = {}) {
    if (!this.busterLabEnabled || buildId === 'megaBuster') return { ok: false, message: 'Select a Custom Buster chassis.' };
    const draft = this._getBusterBuildRecord(buildId, 'draft');
    if (!draft) return { ok: false, message: 'That Workshop Chassis has not been fabricated.' };
    const next = JSON.parse(JSON.stringify(draft));
    if (action.type === 'setTuning' && ['power', 'energy', 'range', 'rapid'].includes(action.stat)) {
      next.tuning[action.stat] = Math.max(1, Math.min(10, Math.trunc(Number(action.value)) || 1));
    } else if (action.type === 'setProgramSlot') {
      const selections = this._getProgramSelections(next);
      if (!Object.hasOwn(selections, action.slot)) return { ok: false, message: 'Unknown program slot.' };
      selections[action.slot] = action.moduleId ?? '';
      next.program = this._buildProgramFromSelections(next, selections);
    } else {
      return { ok: false, message: 'Unknown draft edit.' };
    }
    const result = this.busterLabStorage.saveDraft(next);
    if (!result.ok) return { ok: false, message: result.error?.message ?? 'The draft could not be stored.' };
    this.busterLabState = result.state;
    return { ok: true, draft: result.draft ?? next };
  }

  fabricateBusterModule(moduleId) {
    if (!this.busterLabEnabled) return { ok: false, message: 'Enable the Buster Lab first.' };
    const recipe = BUSTER_RECIPE_LIST.find((entry) => entry.moduleId === moduleId);
    if (!recipe) return { ok: false, message: 'Roll does not have a recipe for that function.' };
    const discovery = getRecipeDiscoveryState(recipe, this._getBusterLabState()?.discovery);
    if (!discovery?.fullyDiscovered) return { ok: false, message: 'Roll has not discovered the complete recipe yet.' };
    const result = this.busterLabStorage.fabricateModule(recipe);
    if (!result.ok) {
      return { ok: false, message: result.reason === 'insufficient-resources' ? 'Roll is missing salvage for that recipe.' : 'Fabrication failed without consuming salvage.' };
    }
    this._refreshRollSalvageStorage();
    return { ok: true, message: `${recipe.name} fabricated.`, instance: result.instance };
  }

  grantBusterLabDebugKit(mode = 'fullKit') {
    if (!this.busterLabEnabled) return { ok: false, message: 'Enable the Buster Lab first.' };
    if (mode !== 'fullKit') return { ok: false, message: 'Select the Full v0.1 testing kit first.' };
    const result = this.busterLabStorage.grantDebugKit();
    if (!result.ok) {
      return {
        ok: false,
        message: result.error?.message ?? 'The debug kit could not be granted; no Lab data changed.',
      };
    }
    this._refreshRollSalvageStorage();
    const chassisMessage = result.chassis ? ', Build B' : '';
    return {
      ok: true,
      message: `Debug kit ${result.grantNumber} granted: ${result.modules.length} modules, ${result.calibrations.length} Mega calibrations${chassisMessage}.`,
      ...result,
    };
  }

  purchaseSecondBusterChassis() {
    if (!this.busterLabEnabled) return { ok: false, message: 'Enable the Buster Lab first.' };
    const result = this.busterLabStorage.purchaseSecondChassis();
    if (!result.ok) {
      return { ok: false, message: result.reason === 'insufficient-scrap' ? 'Roll needs 20 identified scrap.' : 'Only two physical chassis are supported in v0.1.' };
    }
    this._refreshRollSalvageStorage();
    return { ok: true, message: 'Workshop Chassis B fabricated.' };
  }

  equipCustomBuster(buildId, slotIndex) {
    if (!this.busterLabEnabled || ![1, 2].includes(slotIndex)) return { ok: false, message: 'Custom Busters fit only in slots 2 and 3.' };
    const draft = this._getBusterBuildRecord(buildId, 'draft');
    const validation = draft
      ? validateBusterBuild(draft, { context: this._getBusterValidationContext(buildId) })
      : { valid: false, errors: [] };
    if (!validation.valid) return { ok: false, message: validation.errors[0]?.message ?? 'The current draft is invalid.', errors: validation.errors };
    if (!this._isBusterDraftSaved(buildId)) {
      return { ok: false, message: 'Save this draft revision before equipping it.' };
    }
    if (!this.busterLabPlans.has(buildId) || !this._getBusterBuildRecord(buildId, 'saved')) {
      return { ok: false, message: 'Save a valid compiled revision before equipping it.' };
    }
    const assignment = this.busterLabStorage.assignBuildToSlot(buildId, slotIndex);
    if (!assignment.ok) return { ok: false, message: 'That build cannot be assigned to this slot.' };
    const previous = this.player.armHotbar[slotIndex];
    if (previous?.type === 'customBusterArm') {
      if (previous.buildId !== buildId) this.busterRuntime?.cancelBuild(previous.buildId, 'slotReplaced');
    } else if (previous) {
      this.inventory.addItem(previous);
    }
    for (const otherSlot of [1, 2]) {
      if (otherSlot !== slotIndex && this.player.armHotbar[otherSlot]?.buildId === buildId) {
        this.player.armHotbar[otherSlot] = null;
      }
    }
    const descriptor = this._createCustomBusterArmDescriptor(buildId);
    this.player.armHotbar[slotIndex] = descriptor;
    this.player.switchArmWeapon(slotIndex, true);
    this.busterLabState = assignment.state;
    this.busterRuntime.register(this.busterLabPlans.get(buildId));
    return { ok: true, message: `${descriptor.name} equipped in slot ${slotIndex + 1}.` };
  }

  _executeCompiledBusterShot(execution) {
    const { plan, context, reservationToken } = execution;
    const actions = plan?.actions ?? [];
    const rootAction = actions.find((action) => action.type === 'emit' && action.scope === 'root');
    if (!rootAction || !context?.origin || !context?.direction) return false;

    const executionState = {
      activeProjectiles: 0,
      released: false,
      childAction: actions.find((action) => action.actionId === 'emit-child') ?? null,
      trigger: actions.find((action) => action.type === 'trigger') ?? null,
    };
    const releaseIfFinished = () => {
      if (!executionState.released && executionState.activeProjectiles <= 0) {
        executionState.released = true;
        this.busterRuntime?.releaseReservation(reservationToken);
      }
    };
    const spawnAction = (action, origin, baseDirection, scope = action.scope) => {
      if (!action) return 0;
      const sourceDirection = baseDirection.clone?.()
        ?? new THREE.Vector3(baseDirection.x, baseDirection.y, baseDirection.z);
      if (sourceDirection.lengthSq() <= 0.000001) sourceDirection.set(0, 0, 1);
      sourceDirection.normalize();
      const rawDirections = action.splitter?.pattern === 'spread'
        ? getSpreadDirections(sourceDirection, action.splitter.angles ?? action.splitter.angleOffsets ?? [])
        : action.splitter?.pattern === 'radial'
          ? getClusterDirections(sourceDirection, action.count ?? action.splitter.count ?? 5)
          : Array.from({ length: Math.max(1, action.count ?? 1) }, () => ({
            x: sourceDirection.x,
            y: sourceDirection.y,
            z: sourceDirection.z,
          }));
      const directions = rawDirections.map((entry) => new THREE.Vector3(entry.x, entry.y, entry.z).normalize());
      let spawned = 0;

      for (let index = 0; index < directions.length; index += 1) {
        const direction = directions[index];
        const controllerData = { action, elapsed: 0, pendingChild: null };
        const controller = {
          onEnemyImpact: ({ projectile }) => {
            if (action.payload?.type === 'explosion') {
              this._detonateCompiledBusterExplosion(projectile, action, context);
              return { suppressDefaultDamage: true, suppressDefaultExplosion: true, dispose: true };
            }
            if (executionState.trigger?.event === 'impact' && action.actionId === 'emit-carrier') {
              controllerData.pendingChild = {
                reason: 'impact',
                position: projectile.mesh.position.clone(),
                direction: projectile.direction.clone(),
              };
              return { dispose: true };
            }
            return { dispose: true };
          },
          onRangeEnd: ({ projectile }) => {
            if (action.payload?.type === 'explosion') {
              this._detonateCompiledBusterExplosion(projectile, action, context);
              return { suppressExpiry: true, allowCluster: false, reason: 'busterExplosion' };
            }
            if (executionState.trigger?.event === 'impact' && action.actionId === 'emit-carrier') {
              controllerData.pendingChild = {
                reason: 'impact',
                position: projectile.mesh.position.clone(),
                direction: projectile.direction.clone(),
              };
              return { suppressExpiry: true, allowCluster: false, reason: 'impact' };
            }
            return { suppressExpiry: true, allowCluster: false, reason: 'rangeEnd' };
          },
          onApexCrossing: ({ projectile }) => {
            if (executionState.trigger?.event !== 'apex' || action.actionId !== 'emit-carrier') return null;
            controllerData.pendingChild = {
              reason: 'apexTrigger',
              position: projectile.mesh.position.clone(),
              direction: projectile.direction.clone(),
            };
            return { dispose: true, reason: 'apexTrigger' };
          },
          onAdvance: ({ projectile, dt, previousDistance, previousPosition, travel }) => {
            if (executionState.trigger?.event !== 'delay' || action.actionId !== 'emit-carrier') return null;
            const before = controllerData.elapsed;
            const after = before + dt;
            controllerData.elapsed = after;
            const delay = executionState.trigger.delay ?? 0.6;
            if (before < delay && after >= delay) {
              const fraction = dt > 0 ? THREE.MathUtils.clamp((delay - before) / dt, 0, 1) : 0;
              const crossingDistance = previousDistance + travel * fraction;
              const crossingProgress = THREE.MathUtils.clamp(crossingDistance / Math.max(0.001, projectile.range), 0, 1);
              projectile.mesh.position.copy(previousPosition).addScaledVector(projectile.direction, travel * fraction);
              if (projectile.arcHeight > 0) {
                projectile.mesh.position.y = sampleBallisticPoint({
                  start: { x: 0, y: projectile.baseY, z: 0 },
                  end: { x: 0, y: projectile.endY, z: 0 },
                  arcHeight: projectile.arcHeight,
                }, crossingProgress).y;
              }
              controllerData.pendingChild = {
                reason: 'delayTrigger',
                position: projectile.mesh.position.clone(),
                direction: projectile.direction.clone(),
              };
              return { dispose: true, reason: 'delayTrigger' };
            }
            return null;
          },
          onDispose: ({ reason, projectile }) => {
            executionState.activeProjectiles = Math.max(0, executionState.activeProjectiles - 1);
            try {
              const pending = controllerData.pendingChild;
              if (pending && pending.reason === reason && executionState.childAction) {
                controllerData.pendingChild = null;
                spawnAction(
                  executionState.childAction,
                  pending.position,
                  pending.direction,
                  'child',
                );
              }
            } finally {
              projectile.controllerData = null;
              releaseIfFinished();
            }
          },
        };

        const ballistic = action.trajectory === 'ballistic';
        if (ballistic) direction.y = 0;
        if (direction.lengthSq() <= 0.000001) direction.set(0, 0, 1);
        direction.normalize();
        const prematureCarrier = action.actionId === 'emit-carrier'
          && executionState.trigger?.event !== 'impact';
        const damage = prematureCarrier
          ? action.power ?? 0
          : action.damagePower ?? action.power ?? 0;
        const stagger = prematureCarrier
          ? action.moduleId === 'mortarShell'
            ? Math.min(0.25, damage * 0.015)
            : Math.min(0.18, damage * 0.01)
          : action.stagger ?? 0;
        const attackMeta = {
          ...CUSTOM_BUSTER_ATTACK_META,
          suppressRewards: Boolean(context.noRewards),
          busterRange: Boolean(context.noRewards),
        };
        const projectile = this.projectiles.spawn({
          owner: 'player',
          position: origin,
          direction,
          speed: action.speed,
          range: action.range,
          radius: action.moduleId === 'mortarShell' ? 0.22 : 0.17,
          damage,
          color: plan.isMegaBuster ? 0x7ee7ff : 0xf2c84b,
          source: this.player,
          critical: false,
          element: null,
          pierce: 0,
          explosiveRadius: 0,
          explodeOnExpire: false,
          armorBreakChance: 0,
          armorPierce: 0,
          stagger,
          statusBuildup: 0,
          chainChance: 0,
          arcHeight: ballistic ? Math.max(1.15, action.range * 0.2) : 0,
          endY: ballistic ? (context.aimPoint?.y ?? origin.y) : origin.y,
          homingStrength: action.guidance ? 4.2 : 0,
          homingRange: action.guidance ? action.range : 0,
          target: action.guidance && scope === 'root' ? context.target : null,
          freeHoming: Boolean(action.guidance),
          visualType: action.moduleId === 'mortarShell' ? 'shell' : 'buster',
          controller,
          controllerData,
          buildRevision: execution.buildRevision,
          executionId: execution.executionId,
          actionId: action.actionId,
          triggerDepth: scope === 'child' ? 1 : 0,
          reservationToken,
          attackDomain: CUSTOM_BUSTER_ATTACK_META.attackDomain,
          attackMeta,
        });
        if (projectile) {
          executionState.activeProjectiles += 1;
          spawned += 1;
        }
      }
      return spawned;
    };

    try {
      const spawned = spawnAction(rootAction, context.origin, context.direction, 'root');
      if (spawned <= 0) {
        releaseIfFinished();
        return false;
      }
      this.addParticleBurst(context.origin, plan.isMegaBuster ? 0x7ee7ff : 0xf2c84b, 8, 0.1);
      return true;
    } catch (error) {
      this.projectiles.cancelWhere(
        (projectile) => projectile.reservationToken === reservationToken,
        'spawnRejected',
      );
      releaseIfFinished();
      console.error('Compiled Buster shot failed', error);
      return false;
    }
  }

  _detonateCompiledBusterExplosion(projectile, action, context) {
    this.addExplosion(
      projectile.mesh.position,
      action.power ?? 0,
      action.payload?.radius ?? 1.55,
      0xff6a16,
      {
        source: this.player,
        element: null,
        critical: false,
        stagger: action.stagger ?? 0,
        armorBreakChance: 0,
        armorPierce: 0,
        statusBuildup: 0,
        damagePlayer: false,
        triggerMines: false,
        visualStyle: 'fierySphere',
        attackDomain: CUSTOM_BUSTER_ATTACK_META.attackDomain,
        suppressGenericOffense: true,
        suppressRewards: Boolean(context.noRewards),
      },
    );
  }

  _getBusterValidationContext(buildId) {
    return {
      ownedModuleInstanceIds: this.busterLabStorage?.getOwnedModuleInstanceIds?.() ?? [],
      claimedModuleInstanceIds: this.busterLabStorage?.getClaimedModuleInstanceIds?.({ excludeBuildId: buildId }) ?? [],
    };
  }

  _getBuildRevision(buildId) {
    return (this._getBusterLabState()?.chassisRevisions ?? [])
      .filter((entry) => entry.buildId === buildId)
      .reduce((maximum, entry) => Math.max(maximum, Number(entry.revision) || 0), 0);
  }

  _compileCustomBusterBuild(build, { revision = null, test = false } = {}) {
    if (!build) return { ok: false, errors: [{ code: 'MISSING_BUILD', path: '', moduleId: null, message: 'No build source is available.' }] };
    const options = {
      context: this._getBusterValidationContext(build.buildId),
      revision: revision ?? this._getBuildRevision(build.buildId),
      throwOnError: false,
    };
    const compiled = compileBusterBuild(build, options);
    if (!compiled?.ok) return compiled;
    if (!test) return compiled;
    return Object.freeze({
      ...compiled,
      weaponKey: `test:${build.buildId}:${options.revision}`,
      testRange: true,
      name: `${build.name ?? build.buildId} Range Draft`,
    });
  }

  _recompileMegaBusterPlan() {
    const state = this._getBusterLabState();
    if (!state) return null;
    const calibration = this._ensureMegaCalibrationState(state);
    const tuning = this._getMegaCalibrationRatings(state);
    const source = {
      schemaVersion: 1,
      rulesetVersion: CUSTOM_BUSTER_RULESET.rulesetVersion,
      buildId: MEGA_BUSTER_BASE_PROFILE.buildId,
      chassisId: MEGA_BUSTER_BASE_PROFILE.chassisId,
      tuning: { ...MEGA_BUSTER_BASE_PROFILE.tuning },
      program: {
        rootNodeId: 'mega-pulse',
        nodes: [{
          nodeId: 'mega-pulse',
          moduleId: MEGA_BUSTER_BASE_PROFILE.emitterModuleId,
          moduleInstanceId: 'mega-pulse-core',
        }],
        edges: [],
      },
    };
    const compiled = compileBusterBuild(source, { revision: calibration.revision });
    const emitter = getBusterModuleDefinition(MEGA_BUSTER_BASE_PROFILE.emitterModuleId);
    const powerMultiplier = getBusterTuningMultiplier(tuning.power);
    const rangeMultiplier = getBusterTuningMultiplier(tuning.range);
    const rapidMultiplier = getBusterTuningMultiplier(tuning.rapid);
    const power = emitter.basePower * powerMultiplier;
    const rootRange = emitter.baseRange * rangeMultiplier;
    const baseRapid = emitter.baseRapid * rapidMultiplier;
    const cycleTime = 1 / baseRapid;
    const maxEnergy = CUSTOM_BUSTER_RULESET.maxEnergyBase
      + CUSTOM_BUSTER_RULESET.maxEnergyPerEnergyRating * tuning.energy;
    const stagger = Math.min(0.18, power * 0.01);
    const stats = {
      ...compiled.stats,
      tunedPower: power,
      effectivePower: power,
      rawEffectivePower: power,
      effectivePowerCap: power * 1.25,
      perChildPower: power,
      carrierPower: 0,
      maxEnergy,
      energyCost: MEGA_BUSTER_BASE_PROFILE.energyCost,
      energyRemaining: maxEnergy - MEGA_BUSTER_BASE_PROFILE.energyCost,
      baseRapid,
      cycleTime,
      finalRapid: baseRapid,
      rootRange,
      childRange: rootRange * CUSTOM_BUSTER_RULESET.childRangeMultiplier,
      shotsPerCharge: Math.floor(maxEnergy / MEGA_BUSTER_BASE_PROFILE.energyCost),
      stagger,
      tuningMultipliers: { power: powerMultiplier, range: rangeMultiplier, rapid: rapidMultiplier },
    };
    const action = {
      ...compiled.actions[0],
      power,
      totalPower: power,
      damagePower: power,
      range: rootRange,
      stagger,
    };
    const packets = {
      ...compiled.packets,
      root: {
        ...compiled.packets.root,
        power,
        totalPower: power,
        damagePower: power,
        range: rootRange,
      },
    };
    const powerLedger = [
      {
        stage: 'mega-calibration',
        moduleId: MEGA_BUSTER_BASE_PROFILE.emitterModuleId,
        scope: 'root',
        inputPower: emitter.basePower,
        multiplier: powerMultiplier,
        outputPower: power,
        allocation: { root: power },
        capClipped: 0,
      },
      {
        stage: 'effective-cap',
        moduleId: null,
        scope: 'root',
        inputPower: power,
        multiplier: 1,
        outputPower: power,
        allocation: { carrier: 0, terminalBatch: power },
        capClipped: 0,
      },
      {
        stage: 'projectile-allocation',
        moduleId: null,
        scope: 'root',
        inputPower: power,
        multiplier: 1,
        outputPower: power,
        allocation: { count: 1, each: power, total: power },
        capClipped: 0,
      },
    ];
    const ledger = {
      energy: {
        maxEnergy,
        energyCost: MEGA_BUSTER_BASE_PROFILE.energyCost,
        remaining: maxEnergy - MEGA_BUSTER_BASE_PROFILE.energyCost,
        entries: [{
          nodeId: 'mega-pulse',
          moduleId: MEGA_BUSTER_BASE_PROFILE.emitterModuleId,
          moduleInstanceId: 'mega-pulse-core',
          energyCost: MEGA_BUSTER_BASE_PROFILE.energyCost,
        }],
      },
      cycle: {
        baseCycleTime: cycleTime,
        moduleDelay: 0,
        cycleTime,
        entries: [],
      },
      power: {
        basePower: emitter.basePower,
        tunedPower: power,
        effectivePowerCap: power * CUSTOM_BUSTER_RULESET.effectivePowerCapMultiplier,
        rawEffectivePower: power,
        effectivePower: power,
        capClipped: 0,
        entries: powerLedger,
      },
    };
    const preview = {
      ...compiled.preview,
      packets,
      damage: {
        total: power,
        carrier: 0,
        terminalBatch: power,
        perProjectile: power,
        stagger,
        radius: 0,
      },
      timing: { cycleTime, triggerDelay: 0 },
    };
    const plan = deepFreezeBusterValue({
      ...compiled,
      weaponKey: 'megaBuster',
      buildId: 'megaBuster',
      isMegaBuster: true,
      revision: calibration.revision,
      buildRevision: calibration.revision,
      stats,
      actions: [action],
      packets,
      ledger,
      preview,
      rootPower: power,
      perChildPower: power,
      childPower: power,
      powerLedger,
      description: `Fixed Mega Buster Pulse. ${stats.shotsPerCharge} shots per battery; weapon-local PWR / ENG / RNG / RPD.`,
    });
    this.busterLabPlans.set('megaBuster', plan);
    this.busterRuntime?.register(plan);
    return plan;
  }

  _recompileBusterPlans() {
    if (!this.busterLabEnabled) return;
    const previousKeys = [...this.busterLabPlans.keys()];
    const nextPlans = new Map();
    this.busterLabPlans = nextPlans;
    this._recompileMegaBusterPlan();
    for (const build of this._getBusterLabState()?.chassisBuilds ?? []) {
      const compiled = this._compileCustomBusterBuild(build);
      if (!compiled?.ok) continue;
      nextPlans.set(build.buildId, compiled);
      this.busterRuntime?.register(compiled);
    }
    for (const key of previousKeys) {
      if (!nextPlans.has(key)) this.busterRuntime?.cancelBuild(key, 'invalidated');
    }
    this._quarantineInvalidBusterAssignments();
  }

  _quarantineInvalidBusterAssignments() {
    const state = this._getBusterLabState();
    const slots = state?.assignments?.slots ?? {};
    const invalidSlots = [1, 2].filter((slotIndex) => {
      const buildId = slots[String(slotIndex)] ?? slots[slotIndex];
      return buildId && !this.busterLabPlans.has(buildId);
    });
    if (invalidSlots.length === 0) return;
    const result = this.busterLabStorage.mutate((candidate) => {
      candidate.assignments = candidate.assignments ?? { slots: {} };
      candidate.assignments.slots = candidate.assignments.slots ?? {};
      for (const slotIndex of invalidSlots) candidate.assignments.slots[String(slotIndex)] = null;
    });
    if (result.ok) this.busterLabState = result.state;
    for (const slotIndex of invalidSlots) {
      if (this.player.armHotbar[slotIndex]?.type === 'customBusterArm') this.player.armHotbar[slotIndex] = null;
    }
    if (this.player.getActiveArmWeapon?.()?.type === 'customBusterArm') this.player.switchArmWeapon(0, true);
  }

  saveBusterDraft(buildId) {
    const draft = this._getBusterBuildRecord(buildId, 'draft');
    if (!draft) return { ok: false, message: 'No draft exists for that chassis.' };
    const validation = validateBusterBuild(draft, { context: this._getBusterValidationContext(buildId) });
    if (!validation.valid) return { ok: false, message: validation.errors[0]?.message ?? 'The draft is invalid.', errors: validation.errors };
    this.busterRuntime?.cancelBuild(buildId, 'recompile');
    const result = this.busterLabStorage.saveBuild(draft);
    if (!result.ok) return { ok: false, message: result.error?.message ?? 'The revision could not be saved.', errors: result.errors ?? [] };
    this.busterLabState = result.state;
    if (!(result.state.migrations?.unknownModuleQuarantine?.length > 0)) {
      this.busterLabLoadWarning = null;
    }
    this._recompileBusterPlans();
    return { ok: true, message: `${draft.name ?? buildId} revision ${this._getBuildRevision(buildId)} saved.` };
  }

  getBusterLabViewModel(selectedBuildId = 'build-a') {
    if (!this.busterLabEnabled) return null;
    const state = this._getBusterLabState();
    const buildId = selectedBuildId === 'megaBuster' ? 'megaBuster' : selectedBuildId;
    const chassisById = new Map((state.chassisInstances ?? []).map((entry) => [entry.chassisId, entry]));
    const assignmentSlots = state.assignments?.slots ?? {};
    const builds = ['build-a', 'build-b'].map((id, index) => {
      const chassisId = index === 0 ? 'chassis-a' : 'chassis-b';
      const saved = state.chassisBuilds?.find((entry) => entry.buildId === id) ?? null;
      return {
        buildId: id,
        label: index === 0 ? 'Build A' : 'Build B',
        chassisId,
        available: chassisById.has(chassisId),
        saved: Boolean(saved && this.busterLabPlans.has(id)),
        equippedSlots: [1, 2].filter((slotIndex) => (
          (assignmentSlots[String(slotIndex)] ?? assignmentSlots[slotIndex]) === id
        )),
      };
    });
    const selectedRecord = builds.find((entry) => entry.buildId === buildId) ?? null;
    const draft = buildId === 'megaBuster' ? null : this._getBusterBuildRecord(buildId, 'draft');
    const validation = draft
      ? validateBusterBuild(draft, { context: this._getBusterValidationContext(buildId) })
      : { valid: false, ok: false, errors: [] };
    const compiled = validation.valid
      ? this._compileCustomBusterBuild(draft, { revision: this._getBuildRevision(buildId) + 1 })
      : null;
    const savedBuild = buildId === 'megaBuster' ? null : this._getBusterBuildRecord(buildId, 'saved');
    const claims = new Map();
    for (const build of state.chassisBuilds ?? []) {
      for (const node of build.program?.nodes ?? []) {
        if (node.moduleInstanceId) claims.set(node.moduleInstanceId, build.buildId);
      }
    }
    const moduleInstances = (state.moduleInstances ?? []).map((instance) => ({
      ...instance,
      name: getBusterModuleDefinition(instance.moduleId)?.label ?? instance.name ?? instance.moduleId,
      installedBuildId: claims.get(instance.instanceId ?? instance.moduleInstanceId) ?? null,
    }));
    const recipeFunctions = {
      pulseBolt: 'Rapid, deterministic Pulse emitter.',
      mortarShell: 'Ballistic high-angle shell emitter.',
      pursuitGuidance: 'Tracks a lock first, then the nearest stable target.',
      atApex: 'Launches its child branch at a Mortar carrier’s apex.',
      afterDelay: 'Launches its child branch after exactly 0.60 seconds.',
      spread3: 'Splits a packet across three symmetric shots.',
      cluster5: 'Splits a packet across five deterministic radial children.',
      explosion: 'Replaces direct damage with a radius-1.55 blast.',
    };
    const recipes = BUSTER_RECIPE_LIST.map((recipe) => {
      const discovery = getRecipeDiscoveryState(recipe, state.discovery);
      const check = this.rollSalvageStorage.canTransactRecipe?.(recipe) ?? { ok: false };
      const ingredientsLabel = Object.entries(recipe.parts).map(([partId, count]) => {
        const partName = this.rollSalvageStorage.parts?.[partId]?.name ?? partId;
        return `${partName}${count > 1 ? ` ×${count}` : ''}`;
      }).join(' + ');
      return {
        ...discovery,
        moduleId: discovery.moduleId ?? (discovery.level === 'unknown' ? null : recipe.moduleId),
        discoveryState: discovery.level,
        name: discovery.level === 'unknown' ? discovery.displayName : recipe.name,
        function: discovery.level === 'unknown' ? '' : recipeFunctions[recipe.moduleId],
        hint: discovery.rollClue,
        parts: discovery.fullyDiscovered ? recipe.parts : null,
        ingredientsLabel: discovery.fullyDiscovered ? ingredientsLabel : null,
        scrapCost: discovery.fullyDiscovered ? recipe.scrapCost : null,
        canFabricate: discovery.fullyDiscovered && check.ok,
      };
    });
    const calibration = this._ensureMegaCalibrationState(state);
    const calibrationSlots = calibration.slots.map((instanceId) => (
      calibration.instances.find((entry) => entry.instanceId === instanceId) ?? null
    ));
    const megaPlan = this.busterLabPlans.get('megaBuster');
    const tuningTotal = Object.values(draft?.tuning ?? {}).reduce((sum, value) => sum + Number(value || 0), 0);

    return {
      enabled: true,
      debugPresetEnabled: this.busterLabDebugEnabled,
      debugGrantCount: Math.max(0, Math.trunc(Number(state.migrations?.debugKitGrantCount)) || 0),
      warning: this.busterLabLoadWarning ?? this.busterLabStorage.lastWarning ?? state.warning ?? null,
      identifiedScrap: this.rollSalvageStorage.identifiedScrap,
      builds,
      build: selectedRecord ? { ...selectedRecord, draft, savedBuild } : null,
      tuningRemaining: draft ? 16 - tuningTotal : 0,
      programSelections: draft ? this._getProgramSelections(draft) : null,
      programOptions: {
        emitter: [
          { value: '', label: 'Choose emitter' },
          { value: 'pulseBolt', label: 'Pulse Bolt' },
          { value: 'mortarShell', label: 'Mortar Shell' },
        ],
        rootModifier: [{ value: '', label: 'None' }, { value: 'pursuitGuidance', label: 'Pursuit Guidance' }],
        trigger: [
          { value: '', label: 'None (direct)' },
          { value: 'atApex', label: 'At Apex' },
          { value: 'onImpact', label: 'On Impact (built in)' },
          { value: 'afterDelay', label: 'After 0.60s' },
        ],
        childModifier: [{ value: '', label: 'None' }, { value: 'pursuitGuidance', label: 'Pursuit Guidance' }],
        splitter: [
          { value: '', label: 'None' },
          { value: 'spread3', label: 'Spread ×3' },
          { value: 'cluster5', label: 'Cluster ×5' },
        ],
        payload: [{ value: 'pulsePayload', label: 'Native Pulse' }, { value: 'explosion', label: 'Explosion' }],
      },
      nodeCount: draft?.program?.nodes?.length ?? 0,
      validation,
      result: compiled?.ok ? compiled : null,
      canSave: Boolean(selectedRecord?.available && validation.valid),
      canEquip: Boolean(
        validation.valid
        && savedBuild
        && this._isBusterDraftSaved(buildId)
        && this.busterLabPlans.has(buildId)
      ),
      canTest: buildId === 'megaBuster' ? Boolean(megaPlan) : Boolean(validation.valid && compiled?.ok),
      canBuySecondChassis: !chassisById.has('chassis-b') && this.rollSalvageStorage.identifiedScrap >= 20,
      moduleInstances,
      recipes,
      mega: {
        tuning: this._getMegaCalibrationRatings(state),
        calibrationSlots,
        availableCalibrations: calibration.instances,
        result: megaPlan,
      },
    };
  }

  enterBusterTestRange(buildId = 'build-a') {
    if (!this.busterLabEnabled) return { ok: false, message: 'Enable the Buster Lab first.' };
    if (this.busterTestRange?.active) this.exitBusterTestRange();
    let plan = null;
    if (buildId === 'megaBuster') {
      const mega = this.busterLabPlans.get('megaBuster');
      if (mega) {
        plan = deepFreezeBusterValue({
          ...mega,
          weaponKey: `test:megaBuster:${mega.revision}`,
          testRange: true,
        });
      }
    } else {
      const draft = this._getBusterBuildRecord(buildId, 'draft');
      const validation = draft
        ? validateBusterBuild(draft, { context: this._getBusterValidationContext(buildId) })
        : { valid: false, errors: [] };
      if (!validation.valid) {
        return { ok: false, message: validation.errors[0]?.message ?? 'The draft is not valid for testing.', errors: validation.errors };
      }
      const compiled = this._compileCustomBusterBuild(draft, {
        revision: this._getBuildRevision(buildId) + 1,
        test: true,
      });
      if (compiled?.ok) plan = compiled;
    }
    if (!plan) return { ok: false, message: 'The compiler could not produce a range plan.' };

    const bayCenter = new THREE.Vector3(72, 0, -72);
    const rangeGroup = new THREE.Group();
    rangeGroup.name = 'busterTestRange';
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x27313a,
      emissive: 0x0c2630,
      emissiveIntensity: 0.2,
      metalness: 0.65,
      roughness: 0.5,
    });
    const floorGeometry = new THREE.BoxGeometry(16, 0.18, 22);
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.position.copy(bayCenter).add(new THREE.Vector3(0, -0.12, 8));
    floor.receiveShadow = true;
    rangeGroup.add(floor);
    const railMaterial = new THREE.MeshBasicMaterial({ color: 0x43dff5, transparent: true, opacity: 0.55 });
    const railGeometry = new THREE.BoxGeometry(0.08, 0.08, 22);
    for (const xOffset of [-7.7, 7.7]) {
      const rail = new THREE.Mesh(railGeometry, railMaterial);
      rail.position.copy(bayCenter).add(new THREE.Vector3(xOffset, 0.02, 8));
      rangeGroup.add(rail);
    }
    const dummies = [
      // Keep both targets inside a neutral-rating Mortar's 6.2-unit range so
      // every v0.1 emitter can be meaningfully exercised in the bay.
      createBusterRangeDummy('range-stationary', bayCenter.clone().add(new THREE.Vector3(-1.8, 0, 4.8))),
      createBusterRangeDummy('range-moving', bayCenter.clone().add(new THREE.Vector3(0, 0, 5.2)), { moving: true }),
    ];
    for (const dummy of dummies) rangeGroup.add(dummy.root);
    this.scene.add(rangeGroup);

    const runtimeResources = this.busterRuntime.createResourceSnapshot();
    const previousPlan = this.getActiveBusterPlan();
    const previousWeaponKey = previousPlan?.weaponKey ?? previousPlan?.buildId ?? null;
    this.combat?._clearPendingAttacks?.();
    if (previousWeaponKey) this.busterRuntime.cancelBuild(previousWeaponKey, 'rangeEnter');
    const restore = {
      position: this.player.root.position.clone(),
      rotationY: this.player.root.rotation.y,
      lastMoveDirection: this.player.lastMoveDirection.clone(),
      armHotbar: [...this.player.armHotbar],
      activeArmIndex: this.player.activeArmIndex,
      arenaRadius: this.arenaRadius,
      inventoryWasOpen: this.inventoryOpen,
      inventoryMode: this.ui?.inventoryMode ?? 'roll',
      runtimeResources,
      combatSwapTimer: this.combat.swapTimer,
    };
    this.busterTestRange = {
      active: true,
      buildId,
      plan,
      group: rangeGroup,
      dummies,
      restore,
      resources: { floorGeometry, floorMaterial, railGeometry, railMaterial },
    };
    this.setInventoryOpen(false);
    this.keys.clear();
    this.pointer.primary = false;
    this.pointer.primaryPressed = false;
    this.arenaRadius = 160;
    this.player.root.position.copy(bayCenter);
    this.player.root.rotation.y = 0;
    this.player.lastMoveDirection.set(0, 0, 1);
    this.player.armHotbar[1] = this._createCustomBusterArmDescriptor(buildId);
    this.player.switchArmWeapon(1, true);
    this.combat.swapTimer = 0;
    this.busterRuntime.register(plan);
    this.busterRuntime.resetWeapon(plan.weaponKey);
    this.busterRuntime.equip(plan);
    this.cameraController.snapTo(this.player);
    this.ui.showToast('Buster Test Range — press Escape to return to Roll', '#7df8ff');
    return { ok: true, plan };
  }

  exitBusterTestRange() {
    const range = this.busterTestRange;
    if (!range?.active) return false;
    this.combat?._clearPendingAttacks?.();
    this.busterRuntime?.cancelBuild(range.plan.weaponKey, 'rangeExit');
    this.projectiles.cancelWhere(
      (projectile) => projectile.attackMeta?.busterRange || projectile.executionId?.startsWith?.(range.plan.weaponKey),
      'rangeExit',
    );
    for (const dummy of range.dummies) dummy.dispose();
    range.group.removeFromParent();
    range.resources.floorGeometry.dispose();
    range.resources.floorMaterial.dispose();
    range.resources.railGeometry.dispose();
    range.resources.railMaterial.dispose();
    this.busterRuntime?.resetWeapon(range.plan.weaponKey, { remove: true });

    const { restore } = range;
    this.busterRuntime?.restoreResourceSnapshot(restore.runtimeResources);
    this.busterTestRange = null;
    this.player.armHotbar = [...restore.armHotbar];
    this.arenaRadius = restore.arenaRadius;
    this.player.root.position.copy(restore.position);
    this.player.root.rotation.y = restore.rotationY;
    this.player.lastMoveDirection.copy(restore.lastMoveDirection);
    this.player.switchArmWeapon(restore.activeArmIndex, true);
    this.combat.swapTimer = restore.combatSwapTimer;
    this.cameraController.snapTo(this.player);
    if (restore.inventoryWasOpen) this.setInventoryOpen(true, { mode: restore.inventoryMode });
    this.ui.showToast('Returned from the Buster Test Range', '#7df8ff');
    return true;
  }

  _updateBusterTestRange(dt) {
    for (const dummy of this.busterTestRange?.dummies ?? []) dummy.update(dt);
  }

  getProjectileTargets() {
    return this.busterTestRange?.active ? this.busterTestRange.dummies : this.enemies;
  }

  damageEnemy(enemy, amount, meta = {}) {
    if (!enemy || enemy.dead) {
      return 0;
    }

    const externalMotionOwner = enemy.externalControl?.owner
      ?? enemy.externalBallisticMotion?.owner
      ?? null;
    const wasExternallyMoved = Boolean(enemy.isExternalMotionActive?.());
    const dealt = enemy.takeDamage(amount, meta);
    if (enemy.dead) {
      if (wasExternallyMoved) {
        this._prepareExternallyMovedEnemyDeath(enemy, externalMotionOwner);
      } else {
        this._prepareEnemyDeathLanding(enemy);
      }
    }
    const globalHitStopDuration = meta.globalHitStopDuration
      ?? (meta.projectileHit ? 0 : meta.hitStopDuration);
    const hitStopDuration = Number(globalHitStopDuration) || 0;
    if (dealt > 0 && hitStopDuration > 0 && !meta.statusTick) {
      this.requestHitStop(hitStopDuration, {
        timeScale: meta.hitStopTimeScale ?? (meta.critical ? 0.04 : HIT_STOP_DEFAULT_TIME_SCALE),
      });
    }

    const color = meta.critical
      ? 0xffe36e
      : meta.element === 'fire'
        ? 0xff8a42
        : meta.element === 'ice'
          ? 0x8bddff
          : meta.element === 'shock'
            ? 0xa6f7ff
            : meta.element === 'corrosion'
              ? 0xa6e86f
              : 0xffffff;

    const hitPosition = meta.hitPosition ?? enemy.root.position;
    const damageColor = meta.shieldBlocked ? 0xffd36f : meta.weakPointHit ? 0xffe36e : color;
    const hitEffectColor = meta.shieldBlocked ? 0xffd36f : meta.weakPointHit ? 0xffe36e : meta.projectileHit ? 0xffffff : color;
    if (dealt > 0) {
      this.addDamageNumber(enemy.root.position, dealt, damageColor, meta.critical || meta.weakPointHit);
    }

    if (!meta.shieldBlocked && dealt > 0) {
      this.addHitEffect(hitPosition, hitEffectColor, meta.critical ? 0.85 : 0.55, {
        absolute: Boolean(meta.hitPosition),
      });
    }

    if (meta.shieldBlocked) {
      this.addParticleBurst(hitPosition, 0xffd36f, meta.damageNullified ? 14 : 11, 0.075);
      this.addParticleBurst(hitPosition, 0xffffff, 4, 0.045);
    } else if (meta.weakPointHit && dealt > 0) {
      this.addParticleBurst(hitPosition, 0xffe36e, 14, 0.105);
    } else if (meta.projectileHit && dealt > 0) {
      this.addParticleBurst(hitPosition, 0xfff0a3, 9, 0.09);
      this.addParticleBurst(hitPosition, 0xffc533, 5, 0.055);
    }

    if (!meta.statusTick && dealt > 0 && !enemy.dead) {
      this._applyEnemyStatusFromHit(enemy, dealt, meta);
    }

    if (!meta.statusTick
      && !meta.suppressGenericOffense
      && meta.source === this.player
      && this.player.stats.lifeSteal > 0) {
      this.player.heal(dealt * this.player.stats.lifeSteal);
    }

    if (!meta.statusTick
      && !meta.chainProcessed
      && !meta.suppressGenericOffense
      && meta.source === this.player
      && this.player.stats.chainLightningChance > 0
      && Math.random() < this.player.stats.chainLightningChance) {
      this._chainLightning(enemy, dealt * 0.42);
    }

    if (enemy.dead && !enemy.userDataKilled) {
      enemy.userDataKilled = true;
      this._handleEnemyKilled(enemy, meta);
    }

    return dealt;
  }

  addDamageNumber(position, amount, color = 0xffffff, critical = false) {
    const number = this.damageNumbers.length >= MAX_POOLED_DAMAGE_NUMBERS
      ? this.damageNumbers.shift()
      : this._getDamageNumber();
    number.sprite.removeFromParent();
    const rounded = Math.max(1, Math.round(amount));

    number.context.clearRect(0, 0, number.canvas.width, number.canvas.height);
    number.context.font = critical ? '700 34px Arial' : '700 28px Arial';
    number.context.textAlign = 'center';
    number.context.textBaseline = 'middle';
    number.context.lineWidth = 6;
    number.context.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    number.context.fillStyle = `#${new THREE.Color(color).getHexString()}`;
    number.context.strokeText(critical ? `${rounded}!` : String(rounded), 96, 38);
    number.context.fillText(critical ? `${rounded}!` : String(rounded), 96, 38);
    number.texture.needsUpdate = true;
    number.sprite.position.copy(position);
    number.sprite.position.y += 2.2;
    number.sprite.scale.set(1.15, 0.48, 1);
    number.sprite.material.opacity = 1;
    number.life = 0.85;
    number.maxLife = 0.85;
    number.sprite.visible = true;
    this.scene.add(number.sprite);
    this.damageNumbers.push(number);
  }

  addHitEffect(position, color = 0xffffff, scale = 0.5, options = {}) {
    const effect = this.activeHitEffects.length >= MAX_POOLED_HIT_EFFECTS
      ? this.activeHitEffects.shift()
      : this._getHitEffect();
    effect.mesh.removeFromParent();
    effect.mesh.position.copy(position);
    if (!options.absolute) {
      effect.mesh.position.y += 1.05;
    }
    effect.mesh.material.color.set(color);
    if (effect.mesh.material.emissive) {
      effect.mesh.material.emissive.set(color);
    }
    effect.mesh.scale.setScalar(scale);
    effect.life = 0.26;
    effect.maxLife = 0.26;
    effect.mesh.visible = true;
    this.scene.add(effect.mesh);
    this.activeHitEffects.push(effect);
  }

  beginBeamBladeSweepTrail(color = 0xa8ff8a, options = {}) {
    const maxSamples = Math.max(8, options.maxSamples ?? 96);
    const followObject = options.followObject?.isObject3D ? options.followObject : null;
    const createRibbon = (name, innerRatio, opacity) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(
        new Float32Array(maxSamples * 2 * 3),
        3,
      ));

      const indices = new Uint16Array((maxSamples - 1) * 6);
      for (let index = 0; index < maxSamples - 1; index += 1) {
        const vertex = index * 2;
        const offset = index * 6;
        indices[offset] = vertex;
        indices[offset + 1] = vertex + 1;
        indices[offset + 2] = vertex + 2;
        indices[offset + 3] = vertex + 1;
        indices[offset + 4] = vertex + 3;
        indices[offset + 5] = vertex + 2;
      }
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      geometry.setDrawRange(0, 0);

      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.renderOrder = 7;
      Object.assign(mesh.userData, {
        trailMode: 'liveBladeSweep',
        slashClipKey: options.slashClipKey ?? null,
        innerRatio,
        sampleCount: 0,
        sweepStartProgress: options.startProgress ?? null,
        sweepEndProgress: options.endProgress ?? null,
        trailSpace: followObject ? 'followObjectLocal' : 'world',
        followObjectName: followObject?.name ?? null,
      });
      (followObject ?? this.scene).add(mesh);
      return mesh;
    };

    return {
      clipKey: options.slashClipKey ?? null,
      followObject,
      maxSamples,
      samples: [],
      finished: false,
      glow: createRibbon('laserBeamBladeSlashGlow', 0.24, 0.34),
      core: createRibbon('laserBeamBladeSlashCore', 0.76, 0.88),
    };
  }

  appendBeamBladeSweepTrail(trail, baseWorld, tipWorld, progress = null) {
    if (trail?.finished
      || !baseWorld?.isVector3
      || !tipWorld?.isVector3
      || trail.samples.length >= trail.maxSamples) {
      return false;
    }

    const sampleBase = baseWorld.clone();
    const sampleTip = tipWorld.clone();
    if (trail.followObject?.isObject3D) {
      // Store an equipment-relative sweep when the attack continues moving in
      // world space. This preserves the authored blade arc without turning the
      // character's downward jump travel into a tall ribbon segment.
      trail.followObject.updateWorldMatrix(true, false);
      tempMatrixA.copy(trail.followObject.matrixWorld).invert();
      sampleBase.applyMatrix4(tempMatrixA);
      sampleTip.applyMatrix4(tempMatrixA);
    }

    const coordinates = [
      sampleBase.x,
      sampleBase.y,
      sampleBase.z,
      sampleTip.x,
      sampleTip.y,
      sampleTip.z,
    ];
    if (!coordinates.every(Number.isFinite)) {
      return false;
    }

    const previous = trail.samples[trail.samples.length - 1];
    if (previous
      && previous.base.distanceToSquared(sampleBase) < 0.000001
      && previous.tip.distanceToSquared(sampleTip) < 0.000001) {
      return false;
    }

    const sample = {
      base: sampleBase,
      tip: sampleTip,
      baseWorld: baseWorld.clone(),
      tipWorld: tipWorld.clone(),
      progress: Number.isFinite(progress) ? progress : null,
    };
    trail.samples.push(sample);
    const sampleIndex = trail.samples.length - 1;

    for (const mesh of [trail.glow, trail.core]) {
      const innerRatio = mesh.userData.innerRatio;
      tempVectorA.copy(sample.base).lerp(sample.tip, innerRatio);
      const positions = mesh.geometry.attributes.position;
      const offset = sampleIndex * 2;
      positions.setXYZ(offset, tempVectorA.x, tempVectorA.y, tempVectorA.z);
      positions.setXYZ(offset + 1, sample.tip.x, sample.tip.y, sample.tip.z);
      positions.needsUpdate = true;
      mesh.geometry.setDrawRange(0, Math.max(0, sampleIndex * 6));
      mesh.userData.sampleCount = trail.samples.length;
      mesh.userData.firstSampleProgress = trail.samples[0]?.progress ?? null;
      mesh.userData.lastSampleProgress = sample.progress;
      mesh.userData.firstBladeBaseWorld = trail.samples[0]?.baseWorld?.clone() ?? null;
      mesh.userData.firstBladeTipWorld = trail.samples[0]?.tipWorld?.clone() ?? null;
      mesh.userData.lastBladeBaseWorld = sample.baseWorld.clone();
      mesh.userData.lastBladeTipWorld = sample.tipWorld.clone();
      mesh.userData.firstBladeBaseLocal = trail.followObject
        ? trail.samples[0]?.base.clone() ?? null
        : null;
      mesh.userData.firstBladeTipLocal = trail.followObject
        ? trail.samples[0]?.tip.clone() ?? null
        : null;
      mesh.userData.lastBladeBaseLocal = trail.followObject ? sample.base.clone() : null;
      mesh.userData.lastBladeTipLocal = trail.followObject ? sample.tip.clone() : null;
      mesh.visible = trail.samples.length >= 2;
    }

    return true;
  }

  finishBeamBladeSweepTrail(trail, fadeDuration = 0.16) {
    if (!trail || trail.finished) {
      return false;
    }

    trail.finished = true;
    if (trail.samples.length < 2) {
      this.cancelBeamBladeSweepTrail(trail);
      return false;
    }

    const life = Math.max(0.06, fadeDuration);
    for (const mesh of [trail.glow, trail.core]) {
      mesh.visible = true;
      this.timedEffects.push({
        object: mesh,
        life,
        maxLife: life,
        opacity: mesh.material.opacity,
      });
    }
    return true;
  }

  cancelBeamBladeSweepTrail(trail) {
    if (!trail) {
      return;
    }

    trail.finished = true;
    for (const mesh of [trail.glow, trail.core]) {
      if (!mesh) {
        continue;
      }
      mesh.removeFromParent();
      this._disposeTimedEffectObject(mesh);
    }
  }

  addSlashEffect(position, direction, range, color = 0xa8ff8a, options = {}) {
    const beamBlade = options.beamBlade ?? false;
    const arcSpan = Math.min(Math.PI * 1.65, (options.arcAngle ?? Math.PI * 0.35) * 2);
    const visualRange = options.visualRange ?? range;
    const height = options.height ?? (beamBlade ? 1.05 : 0.18);
    const duration = options.duration ?? (beamBlade ? 0.22 : 0.18);
    const delay = options.delay ?? 0;
    const rotation = Math.atan2(-direction.z, direction.x);
    const arcStart = beamBlade ? arcSpan * 0.5 : -arcSpan * 0.5;
    const arcLength = beamBlade ? -arcSpan : arcSpan;
    const additive = THREE.AdditiveBlending;
    const glowInnerRadius = visualRange * (beamBlade ? 0.24 : 0.28);
    const glowOuterRadius = visualRange * (beamBlade ? 1 : 0.36);
    const hasAuthoredTrailPlane = beamBlade
      && options.trailMotionLocal?.length >= 3
      && options.trailPlaneNormalLocal?.length >= 3;
    let trailMotionWorld = null;
    let trailPlaneNormalWorld = null;
    let trailCenterWorld = null;

    if (hasAuthoredTrailPlane) {
      tempVectorA.copy(direction).setY(0);
      if (tempVectorA.lengthSq() <= 0.0001) {
        tempVectorA.set(0, 0, 1);
      } else {
        tempVectorA.normalize();
      }
      tempVectorB.set(tempVectorA.z, 0, -tempVectorA.x);

      const [motionRight, motionUp, motionForward] = options.trailMotionLocal;
      const [normalRight, normalUp, normalForward] = options.trailPlaneNormalLocal;
      const [centerRight, centerUp, centerForward] = options.trailCenterLocal?.length >= 3
        ? options.trailCenterLocal
        : [0, height, 0];
      trailCenterWorld = position.clone()
        .addScaledVector(tempVectorB, centerRight)
        .addScaledVector(WORLD_UP, centerUp)
        .addScaledVector(tempVectorA, centerForward);
      tempVectorC.set(0, 0, 0)
        .addScaledVector(tempVectorB, motionRight)
        .addScaledVector(WORLD_UP, motionUp)
        .addScaledVector(tempVectorA, motionForward)
        .normalize();
      tempVectorD.set(0, 0, 0)
        .addScaledVector(tempVectorB, normalRight)
        .addScaledVector(WORLD_UP, normalUp)
        .addScaledVector(tempVectorA, normalForward)
        .normalize();

      // RingGeometry lives in XY. Its negative, symmetric arc travels along
      // local -Y, so point that axis along the measured blade motion and keep
      // local +Z on the authored sweep plane normal.
      tempVectorC.addScaledVector(tempVectorD, -tempVectorC.dot(tempVectorD)).normalize();
      trailMotionWorld = tempVectorC.clone();
      trailPlaneNormalWorld = tempVectorD.clone();
      tempVectorB.copy(tempVectorC).negate();
      tempVectorA.copy(tempVectorB).cross(tempVectorD).normalize();
      tempMatrixA.makeBasis(tempVectorA, tempVectorB, tempVectorD);
    }

    const glow = new THREE.Mesh(
      new THREE.RingGeometry(glowInnerRadius, glowOuterRadius, 56, 1, arcStart, arcLength),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: beamBlade ? 0.36 : 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: beamBlade ? additive : THREE.NormalBlending,
      }),
    );

    glow.name = beamBlade ? 'laserBeamBladeSlashGlow' : 'slashArcEffect';
    glow.position.copy(trailCenterWorld ?? position);
    if (!trailCenterWorld) {
      glow.position.y += height;
    }
    if (hasAuthoredTrailPlane) {
      glow.quaternion.setFromRotationMatrix(tempMatrixA);
      Object.assign(glow.userData, {
        trailMode: 'authoredSlashPlane',
        slashClipKey: options.slashClipKey ?? null,
        trailCenterWorld: trailCenterWorld?.clone() ?? null,
        trailMotionWorld,
        trailPlaneNormalWorld,
      });
    } else {
      glow.rotation.x = -Math.PI / 2;
      glow.rotation.z = rotation;
    }
    glow.visible = !delay;
    if (beamBlade) {
      glow.geometry.setDrawRange(0, 0);
    }
    this.scene.add(glow);
    if (options.followObject?.isObject3D) {
      options.followObject.attach(glow);
    }
    this.timedEffects.push({
      object: glow,
      life: duration,
      maxLife: duration,
      delay,
      grow: !beamBlade,
      opacity: beamBlade ? 0.44 : 0.52,
      sweepDraw: beamBlade,
    });

    if (!beamBlade) {
      return;
    }

    const core = new THREE.Mesh(
      new THREE.RingGeometry(visualRange * 0.76, visualRange, 56, 1, arcStart, arcLength),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.82,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: additive,
      }),
    );

    core.name = 'laserBeamBladeSlashCore';
    core.position.copy(trailCenterWorld ?? position);
    if (!trailCenterWorld) {
      core.position.y += height;
    }
    if (hasAuthoredTrailPlane) {
      core.position.addScaledVector(tempVectorD, 0.018);
      // glow may already be reparented to the player root, so rebuild the
      // shared world orientation before attaching the core as well.
      core.quaternion.setFromRotationMatrix(tempMatrixA);
      Object.assign(core.userData, {
        trailMode: 'authoredSlashPlane',
        slashClipKey: options.slashClipKey ?? null,
        trailCenterWorld: trailCenterWorld?.clone() ?? null,
        trailMotionWorld,
        trailPlaneNormalWorld,
      });
    } else {
      core.position.y += 0.018;
      core.rotation.x = -Math.PI / 2;
      core.rotation.z = rotation;
    }
    core.visible = !delay;
    core.geometry.setDrawRange(0, 0);
    this.scene.add(core);
    if (options.followObject?.isObject3D) {
      options.followObject.attach(core);
    }
    this.timedEffects.push({
      object: core,
      life: duration * 0.82,
      maxLife: duration * 0.82,
      delay,
      grow: false,
      opacity: 0.86,
      sweepDraw: true,
    });
  }

  addClawSwipeTrailHazard(position, options = {}) {
    const radius = Math.max(0.8, options.radius ?? 4.55);
    const duration = Math.max(0.1, options.duration ?? 0.65);
    const innerRadius = Math.max(0.35, options.innerRadius ?? radius * 0.62);
    const color = options.color ?? 0xff2020;
    const group = new THREE.Group();
    group.name = 'generatedReaverbotClawTrailHazard';
    group.position.copy(position);
    group.position.y = (this.dungeonController?.getSurfaceElevationAt?.(position)
      ?? position.y
      ?? 0) + (options.height ?? 0.9);

    for (let index = 0; index < 3; index += 1) {
      const ribbonRadius = THREE.MathUtils.lerp(innerRadius, radius, (index + 1) / 3);
      const halfWidth = Math.max(0.035, radius * 0.018);
      const ribbon = new THREE.Mesh(
        new THREE.RingGeometry(
          Math.max(0.05, ribbonRadius - halfWidth),
          ribbonRadius + halfWidth,
          72,
          1,
          index * 0.16,
          Math.PI * 2 - 0.24,
        ),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.78 - index * 0.1,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      ribbon.name = `generatedReaverbotClawTrailRibbon${index + 1}`;
      ribbon.rotation.x = -Math.PI / 2;
      ribbon.position.y = index * 0.13;
      ribbon.geometry.setDrawRange(0, 0);
      ribbon.userData.baseOpacity = 0.78 - index * 0.1;
      ribbon.userData.thetaStart = index * 0.16;
      ribbon.userData.thetaLength = Math.PI * 2 - 0.24;
      ribbon.userData.collisionRadius = ribbonRadius;
      ribbon.userData.collisionHalfWidth = halfWidth;
      group.add(ribbon);
    }

    this.scene.add(group);
    tempVectorA.copy(this.player.root.position).sub(group.position);
    const initialDistance = Math.hypot(tempVectorA.x, tempVectorA.z);
    this.hazards.push({
      kind: 'clawSwipeTrail',
      object: group,
      source: options.source ?? null,
      damage: Math.max(0, options.damage ?? 0),
      duration,
      maxDuration: duration,
      radius,
      innerRadius,
      consumed: false,
      spawnEntrySuppressed: Boolean(options.suppressInitialOverlap)
        && group.children.some((ribbon) => (
          Math.abs(initialDistance - ribbon.userData.collisionRadius)
            <= ribbon.userData.collisionHalfWidth + (this.player.radius ?? 0.42)
        )),
      wasInside: false,
    });
    return group;
  }

  addFireZone(position, damagePerSecond, duration = 2.4, radius = 1.1, options = {}) {
    const target = options.target ?? 'player';
    const zone = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 28),
      new THREE.MeshBasicMaterial({
        color: 0xff5b2d,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );

    zone.name = target === 'enemies' ? 'playerFireZone' : 'eliteFireZone';
    zone.position.copy(position);
    zone.position.y = (this.dungeonController?.getSurfaceElevationAt?.(position) ?? position.y ?? 0) + 0.035;
    zone.rotation.x = -Math.PI / 2;
    this.scene.add(zone);
    this.hazards.push({
      object: zone,
      damagePerSecond,
      duration,
      maxDuration: duration,
      radius,
      target,
      source: options.source ?? null,
      element: options.element ?? 'fire',
      tickTimer: 0,
    });
  }

  addGroundConeTelegraph(origin, direction, range = 4, halfAngle = 0.8, color = 0xff6a2e, options = {}) {
    tempVectorA.copy(direction);
    tempVectorA.y = 0;
    if (tempVectorA.lengthSq() <= 0.0001) {
      tempVectorA.set(0, 0, 1);
    }
    tempVectorA.normalize();
    tempVectorB.set(-tempVectorA.z, 0, tempVectorA.x);

    const segments = options.segments ?? 18;
    const startDistance = options.startDistance ?? 0.22;
    const positions = [];

    for (let i = 0; i < segments; i += 1) {
      const t0 = i / segments;
      const t1 = (i + 1) / segments;
      const angle0 = THREE.MathUtils.lerp(-halfAngle, halfAngle, t0);
      const angle1 = THREE.MathUtils.lerp(-halfAngle, halfAngle, t1);

      positions.push(tempVectorA.x * startDistance, 0, tempVectorA.z * startDistance);

      tempVectorC.copy(tempVectorA).multiplyScalar(Math.cos(angle0))
        .addScaledVector(tempVectorB, Math.sin(angle0))
        .normalize()
        .multiplyScalar(range);
      positions.push(tempVectorC.x, 0, tempVectorC.z);

      tempVectorC.copy(tempVectorA).multiplyScalar(Math.cos(angle1))
        .addScaledVector(tempVectorB, Math.sin(angle1))
        .normalize()
        .multiplyScalar(range);
      positions.push(tempVectorC.x, 0, tempVectorC.z);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();

    const cone = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: options.opacity ?? 0.34,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );

    cone.name = options.name ?? 'groundConeTelegraph';
    cone.position.set(origin.x, options.y ?? 0.052, origin.z);
    this.scene.add(cone);
    this.timedEffects.push({
      object: cone,
      life: options.duration ?? 0.14,
      maxLife: options.duration ?? 0.14,
      opacity: options.opacity ?? 0.34,
    });
  }

  _isEnemyDeathPartVisible(object, root) {
    let current = object;
    while (current) {
      if (!current.visible) return false;
      if (current === root) break;
      current = current.parent;
    }
    return true;
  }

  _scoreEnemyDeathPartMesh(mesh) {
    if (!mesh?.geometry) return 0;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere?.();
    const radius = mesh.geometry.boundingSphere?.radius ?? 0.1;
    const worldScale = mesh.getWorldScale(tempVectorD);
    return radius * Math.max(Math.abs(worldScale.x), Math.abs(worldScale.y), Math.abs(worldScale.z));
  }

  _findEnemyDeathPartMesh(root, chosen) {
    if (!root) return null;
    root.updateWorldMatrix?.(true, true);
    let best = null;
    let bestScore = -Infinity;
    root.traverse?.((object) => {
      if (!object.isMesh || object.isSkinnedMesh || chosen.has(object) || !object.geometry) return;
      if ((object.geometry.attributes?.position?.count ?? 0) > 4800) return;
      if (!this._isEnemyDeathPartVisible(object, root)) return;
      const name = object.name?.toLowerCase?.() ?? '';
      if (name.includes('healthbar') || name.includes('telegraph') || name.includes('targetmarker')) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (!materials.some((material) => material && (material.opacity ?? 1) > 0.06)) return;
      const score = this._scoreEnemyDeathPartMesh(object);
      if (score > bestScore) {
        best = object;
        bestScore = score;
      }
    });
    return best;
  }

  _collectEnemyDeathPartMeshes(enemy) {
    const chosen = new Set();
    const sources = [];
    const addFromRoot = (root) => {
      if (sources.length >= ENEMY_DEATH_PART_LIMIT) return;
      const mesh = this._findEnemyDeathPartMesh(root, chosen);
      if (!mesh) return;
      chosen.add(mesh);
      sources.push(mesh);
    };

    if (enemy.visual) {
      const { visual } = enemy;
      addFromRoot(visual.chargeModule?.group);
      addFromRoot(visual.weapon?.group);
      addFromRoot(visual.defense?.group);
      addFromRoot(visual.weakPoint?.group ?? visual.weakPoint?.core);
      addFromRoot(visual.eye?.group);
      addFromRoot(visual.frame?.body);
      addFromRoot(visual.frame?.headAssembly ?? visual.frame?.head);
      for (const limb of visual.frame?.limbs ?? []) addFromRoot(limb.pivot);
      for (const wing of visual.frame?.wings ?? []) addFromRoot(wing.pivot);
      addFromRoot(visual.frame?.tailPivot);
    }

    if (sources.length < ENEMY_DEATH_PART_LIMIT) {
      const fallback = [];
      enemy.root?.updateWorldMatrix?.(true, true);
      enemy.root?.traverse?.((object) => {
        if (!object.isMesh || object.isSkinnedMesh || chosen.has(object) || !object.geometry) return;
        if ((object.geometry.attributes?.position?.count ?? 0) > 4800) return;
        if (!this._isEnemyDeathPartVisible(object, enemy.root)) return;
        const name = object.name?.toLowerCase?.() ?? '';
        if (name.includes('healthbar') || name.includes('telegraph') || name.includes('targetmarker')) return;
        const entry = { object, score: this._scoreEnemyDeathPartMesh(object) };
        const insertAt = fallback.findIndex((candidate) => entry.score > candidate.score);
        if (insertAt < 0) fallback.push(entry);
        else fallback.splice(insertAt, 0, entry);
        if (fallback.length > ENEMY_DEATH_PART_LIMIT - sources.length) fallback.pop();
      });
      for (const entry of fallback) {
        if (sources.length >= ENEMY_DEATH_PART_LIMIT) break;
        chosen.add(entry.object);
        sources.push(entry.object);
      }
    }

    return sources;
  }

  _cloneEnemyDeathPartMesh(source, index) {
    if (!source?.geometry || source.isSkinnedMesh) return null;
    const sourceMaterials = Array.isArray(source.material) ? source.material : [source.material];
    const materials = sourceMaterials.map((material) => {
      const clone = material?.clone?.();
      if (!clone) return null;
      clone.transparent = true;
      clone.depthWrite = false;
      clone.opacity = material.opacity ?? 1;
      clone.userData = {
        ...clone.userData,
        enemyDeathBaseOpacity: clone.opacity,
      };
      return clone;
    });
    const material = Array.isArray(source.material) ? materials : materials[0];
    if (!material || (Array.isArray(material) && material.every((entry) => !entry))) return null;

    const clone = new THREE.Mesh(source.geometry.clone(), material);
    source.updateWorldMatrix(true, false);
    source.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
    clone.name = `enemyDeathPart_${source.name || index}`;
    clone.castShadow = false;
    clone.receiveShadow = false;
    clone.renderOrder = source.renderOrder;
    clone.userData = {
      enemyDeathPart: true,
      sourceName: source.name || `part-${index}`,
    };
    source.visible = false;
    source.userData.deathDetached = true;
    return clone;
  }

  _createEnemyDeathProxyPart(enemy, center, size, index) {
    const primaryColor = enemy.genome?.palette?.primary ?? enemy.type?.skinColor ?? 0x8d9382;
    const secondaryColor = enemy.genome?.palette?.secondary ?? enemy.type?.clothColor ?? 0x4f5548;
    const color = index % 2 === 0 ? primaryColor : secondaryColor;
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.42,
      metalness: 0.62,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    material.userData.enemyDeathBaseOpacity = 1;
    const part = new THREE.Mesh(
      ENEMY_DEATH_PROXY_GEOMETRIES[index % ENEMY_DEATH_PROXY_GEOMETRIES.length],
      material,
    );
    const angle = index * 2.39996;
    const spread = Math.max(0.18, Math.min(size.x, size.z) * 0.16);
    part.name = `enemyDeathPart_proxy${index}`;
    part.position.copy(center).add(new THREE.Vector3(
      Math.cos(angle) * spread,
      (index % 3 - 1) * 0.14,
      Math.sin(angle) * spread,
    ));
    part.rotation.set(angle * 0.3, angle * 0.6, angle * 0.2);
    part.scale.setScalar(0.8 + Math.min(0.65, Math.max(size.x, size.y, size.z) * 0.08));
    part.castShadow = false;
    part.userData = { enemyDeathPart: true, proxy: true };
    return part;
  }

  _addFieryExplosionVisual(position, radius, {
    kind = 'fieryExplosion',
    name = 'fieryExplosion',
    childNamePrefix = 'fieryExplosion',
    life = ENEMY_DEATH_EXPLOSION_LIFE,
    maxScale = 1.3,
  } = {}) {
    const explosion = new THREE.Group();
    explosion.name = name;
    explosion.position.copy(position);
    explosion.userData.explosionVisual = 'fierySphere';
    const addFireSphere = (geometry, color, opacity, childName) => {
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      material.userData.fieryExplosionBaseOpacity = opacity;
      const sphere = new THREE.Mesh(geometry, material);
      sphere.name = childName;
      explosion.add(sphere);
      return sphere;
    };
    addFireSphere(
      ENEMY_DEATH_SPHERE_GEOMETRY,
      0xff6a16,
      0.5,
      `${childNamePrefix}FieryShell`,
    );
    addFireSphere(
      ENEMY_DEATH_CORE_GEOMETRY,
      0xffa21a,
      0.78,
      `${childNamePrefix}FlameCore`,
    );
    const hotCore = addFireSphere(
      ENEMY_DEATH_SPHERE_GEOMETRY,
      0xffe06a,
      0.92,
      `${childNamePrefix}HotCore`,
    );
    hotCore.scale.setScalar(0.42);
    explosion.scale.setScalar(radius * 0.08);
    this.scene.add(explosion);
    const effect = {
      kind,
      object: explosion,
      life,
      maxLife: life,
      radius,
      maxScale,
    };
    this.timedEffects.push(effect);
    return effect;
  }

  addEnemyDeathEffect(enemy) {
    if (!enemy?.root || !this.scene) return false;

    const activeDeathEffects = this.timedEffects.reduce(
      (count, effect) => count + (effect.kind === 'enemyDeathExplosion' ? 1 : 0),
      0,
    );
    if (activeDeathEffects >= MAX_ACTIVE_ENEMY_DEATH_EFFECTS) {
      tempVectorA.copy(enemy.root.position);
      tempVectorA.y += Math.min(0.9, Math.max(0.42, (enemy.collisionHeight ?? 1.4) * 0.36));
      this.addParticleBurst(tempVectorA, 0xff7a16, 6, 0.13);
      return true;
    }

    enemy.root.updateWorldMatrix(true, true);
    const visualRoot = enemy.visual?.root ?? enemy.externalModelGroup ?? enemy.root;
    const bounds = new THREE.Box3().setFromObject(visualRoot);
    const center = bounds.isEmpty()
      ? enemy.root.position.clone().add(new THREE.Vector3(0, 0.65, 0))
      : bounds.getCenter(new THREE.Vector3());
    const size = bounds.isEmpty()
      ? new THREE.Vector3(1, 1.4, 1)
      : bounds.getSize(new THREE.Vector3());
    const burstRadius = THREE.MathUtils.clamp(Math.max(size.x, size.y, size.z) * 0.32, 0.48, 1.25);
    const floorY = enemy.deathLandingPosition?.y ?? enemy.deathFloorY ?? enemy.root.position.y;

    this._addFieryExplosionVisual(center, burstRadius, {
      kind: 'enemyDeathExplosion',
      name: 'enemyDeathExplosion',
      childNamePrefix: 'enemyDeathExplosion',
      life: ENEMY_DEATH_EXPLOSION_LIFE,
      maxScale: 1.3,
    });

    const debrisGroup = new THREE.Group();
    debrisGroup.name = 'enemyDeathParts';
    const parts = [];
    const sources = this._collectEnemyDeathPartMeshes(enemy);
    for (let index = 0; index < sources.length; index += 1) {
      const clone = this._cloneEnemyDeathPartMesh(sources[index], index);
      if (clone) debrisGroup.add(clone);
    }
    while (debrisGroup.children.length < ENEMY_DEATH_PART_LIMIT) {
      debrisGroup.add(this._createEnemyDeathProxyPart(enemy, center, size, debrisGroup.children.length));
    }

    for (let index = 0; index < debrisGroup.children.length; index += 1) {
      const object = debrisGroup.children[index];
      const outward = object.position.clone().sub(center);
      outward.y = Math.max(0.16, Math.abs(outward.y) * 0.35);
      if (outward.lengthSq() < 0.001) {
        const angle = index * 2.39996;
        outward.set(Math.cos(angle), 0.28, Math.sin(angle));
      }
      outward.normalize();
      const materials = [];
      object.traverse((child) => {
        const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of childMaterials) {
          if (material && !materials.includes(material)) materials.push(material);
        }
      });
      parts.push({
        object,
        materials,
        velocity: outward.multiplyScalar(2.35 + Math.random() * 1.65).add(new THREE.Vector3(0, 1.25 + Math.random() * 1.4, 0)),
        angularVelocity: new THREE.Vector3(
          (Math.random() - 0.5) * 9,
          (Math.random() - 0.5) * 12,
          (Math.random() - 0.5) * 9,
        ),
        bounces: 0,
      });
    }
    this.scene.add(debrisGroup);
    this.timedEffects.push({
      kind: 'enemyDeathParts',
      object: debrisGroup,
      parts,
      floorY,
      life: ENEMY_DEATH_PART_LIFE,
      maxLife: ENEMY_DEATH_PART_LIFE,
    });

    this.addParticleBurst(center, 0xff6a16, 10, 0.15);
    this.addParticleBurst(center, 0xffd45a, 6, 0.1);
    return true;
  }

  addExplosion(position, damage, radius = 2.2, color = 0xffb347, meta = {}) {
    const request = {
      position: position.clone?.() ?? new THREE.Vector3(position.x, position.y, position.z),
      damage,
      radius,
      color,
      meta: { ...meta },
    };
    if (this.explosionDispatchDepth > 0) {
      this.pendingExplosions.push(request);
      return true;
    }

    this.explosionDispatchDepth = 1;
    try {
      this._resolveExplosion(request.position, request.damage, request.radius, request.color, request.meta);
      let processed = 1;
      while (this.pendingExplosions.length > 0 && processed < MAX_SYNCHRONOUS_EXPLOSIONS) {
        const pending = this.pendingExplosions.shift();
        this._resolveExplosion(pending.position, pending.damage, pending.radius, pending.color, pending.meta);
        processed += 1;
      }
    } finally {
      this.explosionDispatchDepth = 0;
    }
    return true;
  }

  _updatePendingExplosions() {
    if (this.explosionDispatchDepth > 0 || this.pendingExplosions.length === 0) return;
    this.explosionDispatchDepth = 1;
    try {
      let processed = 0;
      while (this.pendingExplosions.length > 0 && processed < MAX_SYNCHRONOUS_EXPLOSIONS) {
        const pending = this.pendingExplosions.shift();
        this._resolveExplosion(pending.position, pending.damage, pending.radius, pending.color, pending.meta);
        processed += 1;
      }
    } finally {
      this.explosionDispatchDepth = 0;
    }
  }

  _resolveExplosion(position, damage, radius = 2.2, color = 0xffb347, meta = {}) {
    if (meta.visualStyle === 'fierySphere') {
      this._addFieryExplosionVisual(position, radius, {
        kind: 'busterExplosionSphere',
        name: 'busterExplosionSphere',
        childNamePrefix: 'busterExplosion',
        life: 0.46,
        maxScale: 1.08,
      });
      this.addParticleBurst(position, 0xff6a16, 8, 0.12);
      this.addParticleBurst(position, 0xffd45a, 4, 0.08);
    } else {
      const wave = new THREE.Mesh(
        new THREE.RingGeometry(radius * 0.15, radius, 36),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.52,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );

      wave.name = 'explosionWave';
      wave.position.copy(position);
      wave.position.y += 0.08;
      wave.rotation.x = -Math.PI / 2;
      this.scene.add(wave);
      this.timedEffects.push({ object: wave, life: 0.32, maxLife: 0.32, grow: true });
    }

    if (meta.damageEnemies !== false) {
      for (const enemy of this.getProjectileTargets()) {
        if (enemy.dead) {
          continue;
        }

        if (enemy.root.position.distanceTo(position) <= radius) {
          tempVectorA.copy(enemy.root.position).sub(position).setY(0).normalize();
          const enemyHitStopDuration = meta.enemyHitStopDuration ?? meta.hitStopDuration ?? 0.1;
          const globalHitStopDuration = meta.globalHitStopDuration ?? meta.hitStopDuration ?? 0.1;
          this.damageEnemy(enemy, damage, {
            source: meta.source ?? this.player,
            element: Object.prototype.hasOwnProperty.call(meta, 'element') ? meta.element : 'fire',
            critical: meta.critical ?? false,
            stagger: meta.stagger ?? 0.28,
            armorBreakChance: meta.armorBreakChance ?? 0.12,
            armorPierce: meta.armorPierce ?? 0,
            statusBuildup: meta.statusBuildup ?? 1,
            knockbackDirection: tempVectorA,
            knockback: meta.knockback ?? 4,
            hitStopDuration: enemyHitStopDuration,
            enemyHitStopDuration,
            globalHitStopDuration,
            hitStopTimeScale: meta.hitStopTimeScale ?? 0.05,
            attackDomain: meta.attackDomain,
            suppressGenericOffense: Boolean(meta.suppressGenericOffense),
            suppressRewards: Boolean(meta.suppressRewards),
          });
        }
      }
    }

    if ((meta.damagePlayer ?? true) && this.player.root.position.distanceTo(position) <= radius && !this.player.dead) {
      tempVectorA.copy(this.player.root.position).sub(position).setY(0);
      if (tempVectorA.lengthSq() <= 0.0001) {
        tempVectorA.copy(this.player.lastMoveDirection).multiplyScalar(-1);
      }
      tempVectorA.normalize();
      const dealt = this.player.takeDamage(damage * (meta.playerDamageScale ?? 0.35), meta.source ?? null, {
        impactPosition: position,
        attackKind: meta.attackKind ?? 'explosion',
        powerfulKnockback: meta.powerfulKnockback ?? true,
        knockbackDirection: tempVectorA,
        knockbackStrength: meta.knockbackStrength ?? 1.08,
        unblockable: Boolean(meta.unblockable),
      });
      if (dealt > 0) {
        this.requestHitStop(meta.playerHitStopDuration ?? meta.hitStopDuration ?? 0.11, {
          timeScale: meta.hitStopTimeScale ?? 0.05,
        });
      }
    }

    if (meta.triggerMines !== false) {
      this.combat?.triggerMinesNear(position, radius);
    }
  }

  addParticleBurst(position, color = 0x9fe8ff, count = 10, baseScale = 0.16) {
    const available = Math.max(0, MAX_ACTIVE_PARTICLES - this.activeParticles.length);
    for (let i = 0; i < Math.min(count, available); i += 1) {
      const particle = this._getParticle();
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.4 + Math.random() * 2.4;
      const lift = 0.65 + Math.random() * 1.5;

      particle.mesh.position.copy(position);
      particle.mesh.material.color.set(color);
      particle.mesh.material.opacity = 0.9;
      particle.maxOpacity = 0.9;
      particle.mesh.scale.setScalar(baseScale * (0.28 + Math.random() * 0.45));
      particle.velocity.set(Math.cos(angle) * speed, lift, Math.sin(angle) * speed);
      particle.gravityScale = 1;
      particle.life = 0.34 + Math.random() * 0.28;
      particle.maxLife = particle.life;
      particle.mesh.visible = true;

      this.scene.add(particle.mesh);
      this.activeParticles.push(particle);
    }
  }

  addDirectedParticleSpray(origin, direction, color = 0x8bddff, {
    count = 7,
    range = 4,
    halfAngle = 0.48,
    baseScale = 0.18,
    pressure = 1,
  } = {}) {
    tempVectorA.copy(direction);
    tempVectorA.y = 0;
    if (tempVectorA.lengthSq() <= 0.0001) {
      tempVectorA.set(0, 0, 1);
    }
    tempVectorA.normalize();
    tempVectorB.set(-tempVectorA.z, 0, tempVectorA.x);

    const available = Math.max(0, MAX_ACTIVE_PARTICLES - this.activeParticles.length);
    for (let i = 0; i < Math.min(count, available); i += 1) {
      const particle = this._getParticle();
      const distance = (0.18 + Math.random() * 0.82) * range;
      const side = Math.tan(halfAngle) * distance * (Math.random() - 0.5) * 1.35;
      const lift = 0.28 + Math.random() * 0.55;
      const speed = 0.55 + pressure * 1.45 + Math.random() * 0.55;

      particle.mesh.position.copy(origin)
        .addScaledVector(tempVectorA, distance)
        .addScaledVector(tempVectorB, side);
      particle.mesh.position.y += lift + Math.random() * 0.35;
      particle.mesh.material.color.set(color);
      particle.mesh.material.opacity = 0.42 + pressure * 0.26;
      particle.maxOpacity = particle.mesh.material.opacity;
      particle.mesh.scale.setScalar(baseScale * (0.7 + Math.random() * 0.9) * (0.82 + (1 - pressure) * 0.32));
      particle.velocity.copy(tempVectorA).multiplyScalar(speed)
        .addScaledVector(tempVectorB, side * 0.42);
      particle.velocity.y += 0.22 + Math.random() * 0.34;
      particle.gravityScale = 0.12;
      particle.life = 0.45 + Math.random() * 0.34;
      particle.maxLife = particle.life;
      particle.mesh.visible = true;

      this.scene.add(particle.mesh);
      this.activeParticles.push(particle);
    }
  }

  _loop() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const gameplayDt = this._consumeHitStopDt(dt);
    const gameplayActive = !this.inventoryOpen && !this.poseDebugOpen && !this.isGameOver;

    if (gameplayActive) {
      this.elapsedTime += gameplayDt;
      if (this.animationPreview?.active) {
        this._updateAnimationPreview(gameplayDt);
      } else {
        this._updateAimFromPointer();
        const movementBasis = this._getPlayerMovementBasis();
        const playerGroundY = this._getPlayerGroundY();
        this.player.update(gameplayDt, this.keys, {
          arenaRadius: this.arenaRadius,
          movementForward: movementBasis.forward,
          movementRight: movementBasis.right,
          lockOnTarget: movementBasis.lockOnTarget,
          lockOnTargetPosition: movementBasis.lockOnTargetPosition,
          aimWorld: this.pointer.aimWorld,
          projectileAimInputHeld: Boolean(this.pointer.primary || this.pointer.secondary),
          groundY: playerGroundY,
          game: this,
        });
        if (this.busterTestRange?.active) {
          this._updateBusterTestRange(gameplayDt);
        } else {
          this.dungeonController.update(gameplayDt);
          this.mapEvents.update(gameplayDt);
          this.spawner.update(gameplayDt);
          this._updateEnemies(gameplayDt);
          this.dungeonController.constrainEnemies();
        }
        this.busterRuntime?.update(gameplayDt);
        this.combat.update(gameplayDt);
        this.projectiles.update(gameplayDt);
        if (!this.busterTestRange?.active) {
          this._updateHazards(gameplayDt);
          this._updatePendingExplosions();
          this._updateDestructibles(gameplayDt);
        }

        const collected = this.busterTestRange?.active
          ? []
          : this.lootSystem.update(gameplayDt, this.player, this.inventory);
        for (const item of collected) {
          if (this.busterLabEnabled && this._convertLegacyBusterPartItem(item, { futureAcquisition: true })) {
            this.inventory.removeItem(item.id);
            this.ui.showToast(`${item.typeLabel ?? item.name} converted to a Mega calibration`, '#7df8ff');
          } else {
            this.ui.showLootToast(item);
          }
        }

        if (collected.length > 0) {
          this.ui.renderInventory();
        }

        const collectedRefractors = this.busterTestRange?.active
          ? []
          : this.refractors.update(gameplayDt, this.player, this.inventory);
        for (const refractor of collectedRefractors) {
          this.ui.showToast(`${refractor.label} +${refractor.value}z`, refractor.color);
        }

        if (this.player.dead) {
          this.isGameOver = true;
        }
      }
    }

    this.dungeonController?.updateNpcVisuals(dt, {
      allowAmbient: gameplayActive && !this.animationPreview?.active,
    });
    this._updateDamageNumbers(dt);
    this._updateHitEffects(dt);
    this._updateParticles(dt);
    this._updateTimedEffects(dt);
    if (this.poseDebugOpen && this.poseDebugSection === 'pose') {
      this._updatePoseDebugHandles();
    } else if (this.poseDebugOpen) {
      this.poseDebugHandleGroup.visible = false;
    }
    this._updateCamera(dt);
    this._updateDungeonRenderCulling(dt);
    this._updateCameraWallOcclusion();
    this.ui.update(dt);
    this._syncBrowserTestDataset();
    this.renderer.render(this.scene, this.camera);
  }

  _getPlayerGroundY() {
    const position = this.player?.root?.position;
    if (!position) {
      return 0;
    }

    const rampElevation = this.dungeonController?.getRampSurfaceElevationAt?.(position);
    if (Number.isFinite(rampElevation)) {
      return rampElevation;
    }

    const platformElevation = this.getPlatformFloorElevation?.(position);
    if (Number.isFinite(platformElevation)) {
      return platformElevation;
    }

    const railElevation = this.dungeonController?.getPlayerRailSupportElevation?.(position);
    if (Number.isFinite(railElevation)) {
      return railElevation;
    }

    return this.dungeonController?.getFloorElevationAt?.(position) ?? 0;
  }

  _updateAnimationPreview(dt) {
    const previewPosition = this.dungeon?.ruinEntryPosition ?? this.dungeon?.playerStart;
    if (previewPosition && this.player?.root) {
      this.player.root.position.copy(previewPosition);
      this.player.root.position.y = 0;
      this.player.root.rotation.y = 0;
    }

    const attackProgress = this._getAnimationPreviewAttackProgress(this.animationPreview);
    this.animationPreview.currentAttackProgress = attackProgress;
    this.player.previewExternalAnimation?.(dt, {
      ...this.animationPreview,
      attackProgress,
    });
    this._syncAnimationPreviewDataset();
  }

  _getAnimationPreviewAttackProgress(preview = this.animationPreview) {
    if (!preview?.attackKind) {
      return null;
    }

    if (Number.isFinite(preview.attackProgress)) {
      return THREE.MathUtils.clamp(preview.attackProgress, 0, 1);
    }

    const attackDuration = Number(preview.attackDuration);
    if (!Number.isFinite(attackDuration) || attackDuration <= 0) {
      return null;
    }

    return (this.elapsedTime % attackDuration) / attackDuration;
  }

  requestHitStop(duration = 0.06, { timeScale = HIT_STOP_DEFAULT_TIME_SCALE } = {}) {
    const safeDuration = THREE.MathUtils.clamp(Number(duration) || 0, 0, HIT_STOP_MAX_DURATION);

    if (safeDuration <= 0 || this.poseDebugOpen || this.inventoryOpen || this.isGameOver) {
      return false;
    }

    this.hitStopTimer = Math.max(this.hitStopTimer, safeDuration);
    this.hitStopTimeScale = Math.min(
      this.hitStopTimeScale,
      THREE.MathUtils.clamp(Number(timeScale) || HIT_STOP_DEFAULT_TIME_SCALE, 0, 1),
    );
    return true;
  }

  _consumeHitStopDt(dt) {
    if (this.hitStopTimer <= 0) {
      this.hitStopTimeScale = 1;
      return dt;
    }

    const scaledDt = dt * this.hitStopTimeScale;
    this.hitStopTimer = Math.max(0, this.hitStopTimer - dt);

    if (this.hitStopTimer <= 0) {
      this.hitStopTimeScale = 1;
    }

    return scaledDt;
  }

  _getPlayerMovementBasis() {
    const lockOnTarget = this.combat?.getMovementLockTarget?.() ?? null;

    if (!lockOnTarget?.root || lockOnTarget.dead) {
      return this.cameraController.getMovementBasis(this.player.lastMoveDirection);
    }

    getCombatTargetWorldPosition(lockOnTarget, this.lockOnMovementTargetPosition);
    this.lockOnMovementForward.copy(this.lockOnMovementTargetPosition).sub(this.player.root.position);
    this.lockOnMovementForward.y = 0;

    if (this.lockOnMovementForward.lengthSq() <= 0.0001) {
      return this.cameraController.getMovementBasis(this.player.lastMoveDirection);
    }

    this.lockOnMovementForward.normalize();
    this.lockOnMovementRight.crossVectors(this.lockOnMovementForward, WORLD_UP).normalize();
    this.lockOnMovementBasis.lockOnTarget = lockOnTarget;
    return this.lockOnMovementBasis;
  }

  _buildWorld() {
    const hemi = new THREE.HemisphereLight(0xd8e6ff, 0x34251d, 1.8);
    hemi.name = 'arenaHemisphereLight';
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.name = 'arenaKeyLight';
    key.position.set(5, 9, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -18;
    key.shadow.camera.right = 18;
    key.shadow.camera.top = 18;
    key.shadow.camera.bottom = -18;
    this.scene.add(key);

    const underlay = new THREE.Mesh(
      new THREE.PlaneGeometry(this.arenaRadius * 2.5, this.arenaRadius * 2.5),
      new THREE.MeshStandardMaterial({ color: 0x171b1d, roughness: 0.96, metalness: 0 }),
    );
    underlay.name = 'ruinVoidUnderlay';
    underlay.rotation.x = -Math.PI / 2;
    underlay.position.y = -0.09;
    underlay.receiveShadow = true;
    this.scene.add(underlay);

    const grid = new THREE.GridHelper(this.arenaRadius * 2.2, 64, 0x43515a, 0x283138);
    grid.name = 'ruinConstructionGrid';
    grid.position.y = 0.014;
    this.scene.add(grid);

    const dungeon = new DungeonGenerator({ difficulty: this.ruinFloor }).generate();
    this.dungeon = dungeon;
    this.platformingPlatforms = [...(dungeon.platforms ?? [])];
    this._rebuildPlatformingLedgeCandidates();
    this.arenaRadius = dungeon.boundsRadius ?? this.arenaRadius;
    this.scene.add(dungeon.group);
    dungeon.activateNpcAssets?.();
    this._collectCameraOcclusionWalls();
    this._collectDungeonRenderCullGroups();
    this._rebuildDebugLedgeTester(dungeon.playerStart);

  }

  _rebuildDebugLedgeTester(origin = new THREE.Vector3()) {
    this.debugLedgeTester?.removeFromParent?.();
    this.debugLedgeCandidates = [];
    this.debugLedgePlatform = null;

    const base = origin?.clone?.() ?? new THREE.Vector3();
    const center = base.clone().add(new THREE.Vector3(
      DEBUG_LEDGE_CUBE_LATERAL_OFFSET,
      DEBUG_LEDGE_CUBE_HEIGHT * 0.5,
      DEBUG_LEDGE_CUBE_FORWARD_OFFSET,
    ));
    const topY = center.y + DEBUG_LEDGE_CUBE_HEIGHT * 0.5;
    this.debugLedgePlatform = {
      id: 'debug-low-jump-cube',
      center: center.clone(),
      halfWidth: DEBUG_LEDGE_CUBE_WIDTH * 0.5,
      halfDepth: DEBUG_LEDGE_CUBE_DEPTH * 0.5,
      topY,
      baseY: base.y,
    };
    const group = new THREE.Group();
    group.name = 'debugLedgeClimbTester';

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(DEBUG_LEDGE_CUBE_WIDTH, DEBUG_LEDGE_CUBE_HEIGHT, DEBUG_LEDGE_CUBE_DEPTH),
      new THREE.MeshStandardMaterial({
        color: 0x34434f,
        roughness: 0.86,
        metalness: 0.08,
      }),
    );
    body.name = 'debugLedgeClimbCubeBody';
    body.position.copy(center);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const ledgeMaterial = new THREE.MeshStandardMaterial({
      color: 0x74e6ff,
      emissive: 0x1a6070,
      emissiveIntensity: 0.55,
      roughness: 0.42,
      metalness: 0.2,
    });
    const markerThickness = 0.08;
    const markerDrop = 0.1;
    const xHalf = DEBUG_LEDGE_CUBE_WIDTH * 0.5;
    const zHalf = DEBUG_LEDGE_CUBE_DEPTH * 0.5;

    this._addDebugLedge(group, {
      id: 'debug-front-ledge',
      center: new THREE.Vector3(center.x, topY, center.z - zHalf),
      normal: new THREE.Vector3(0, 0, -1),
      axis: new THREE.Vector3(1, 0, 0),
      halfSpan: xHalf,
      markerSize: new THREE.Vector3(DEBUG_LEDGE_CUBE_WIDTH + 0.16, markerThickness, markerThickness),
      markerPosition: new THREE.Vector3(center.x, topY - markerDrop, center.z - zHalf - 0.025),
      material: ledgeMaterial,
    });
    this._addDebugLedge(group, {
      id: 'debug-back-ledge',
      center: new THREE.Vector3(center.x, topY, center.z + zHalf),
      normal: new THREE.Vector3(0, 0, 1),
      axis: new THREE.Vector3(1, 0, 0),
      halfSpan: xHalf,
      markerSize: new THREE.Vector3(DEBUG_LEDGE_CUBE_WIDTH + 0.16, markerThickness, markerThickness),
      markerPosition: new THREE.Vector3(center.x, topY - markerDrop, center.z + zHalf + 0.025),
      material: ledgeMaterial,
    });
    this._addDebugLedge(group, {
      id: 'debug-left-ledge',
      center: new THREE.Vector3(center.x - xHalf, topY, center.z),
      normal: new THREE.Vector3(-1, 0, 0),
      axis: new THREE.Vector3(0, 0, 1),
      halfSpan: zHalf,
      markerSize: new THREE.Vector3(markerThickness, markerThickness, DEBUG_LEDGE_CUBE_DEPTH + 0.16),
      markerPosition: new THREE.Vector3(center.x - xHalf - 0.025, topY - markerDrop, center.z),
      material: ledgeMaterial,
    });
    this._addDebugLedge(group, {
      id: 'debug-right-ledge',
      center: new THREE.Vector3(center.x + xHalf, topY, center.z),
      normal: new THREE.Vector3(1, 0, 0),
      axis: new THREE.Vector3(0, 0, 1),
      halfSpan: zHalf,
      markerSize: new THREE.Vector3(markerThickness, markerThickness, DEBUG_LEDGE_CUBE_DEPTH + 0.16),
      markerPosition: new THREE.Vector3(center.x + xHalf + 0.025, topY - markerDrop, center.z),
      material: ledgeMaterial,
    });

    this.debugLedgeTester = group;
    this.scene.add(group);
  }

  getDebugLedgeFloorElevation(position) {
    const platform = this.debugLedgePlatform;
    return this._getPlatformFloorElevation(platform, position);
  }

  getPlatformFloorElevation(position) {
    let elevation = null;
    for (const platform of this._getPlatformingSurfaces()) {
      const candidate = this._getPlatformFloorElevation(platform, position);
      if (Number.isFinite(candidate) && (!Number.isFinite(elevation) || candidate > elevation)) {
        elevation = candidate;
      }
    }
    return elevation;
  }

  _getPlatformFloorElevation(platform, position) {
    if (!platform || !position) {
      return null;
    }

    const insideX = Math.abs(position.x - platform.center.x) <= platform.halfWidth + 0.08;
    const insideZ = Math.abs(position.z - platform.center.z) <= platform.halfDepth + 0.08;
    if (!insideX || !insideZ || position.y < platform.topY - 0.5) {
      return null;
    }

    return platform.topY;
  }

  isPositionInsideDebugLedgeBlock(position, margin = 0.08) {
    return this._isPositionInsidePlatformBlock(this.debugLedgePlatform, position, margin);
  }

  isPositionInsidePlatformBlock(position, margin = 0.08) {
    return this._getPlatformingSurfaces().some((platform) => (
      this._isPositionInsidePlatformBlock(platform, position, margin)
    ));
  }

  _isPositionInsidePlatformBlock(platform, position, margin = 0.08) {
    if (!platform || !position) {
      return false;
    }
    if (platform.blocksBelow === false) {
      return false;
    }

    const insideX = Math.abs(position.x - platform.center.x) <= platform.halfWidth + margin;
    const insideZ = Math.abs(position.z - platform.center.z) <= platform.halfDepth + margin;
    const belowTop = position.y < platform.topY - 0.05;
    return insideX && insideZ && belowTop;
  }

  _getPlatformingSurfaces() {
    return this.debugLedgePlatform
      ? [this.debugLedgePlatform, ...this.platformingPlatforms, ...this.debugSpawnedPlatforms]
      : [...this.platformingPlatforms, ...this.debugSpawnedPlatforms];
  }

  _rebuildPlatformingLedgeCandidates() {
    this.platformingLedgeCandidates = [
      ...this.platformingPlatforms,
      ...this.debugSpawnedPlatforms,
    ].flatMap((platform) => (
      this._createPlatformLedgeCandidates(platform)
    ));
  }

  _createPlatformLedgeCandidates(platform) {
    if (!platform || platform.createsLedgeCandidates === false) {
      return [];
    }

    const xHalf = platform.halfWidth;
    const zHalf = platform.halfDepth;
    const { center, topY } = platform;
    const candidates = [
      {
        edge: 'front',
        id: `${platform.id}-front-ledge`,
        center: new THREE.Vector3(center.x, topY, center.z - zHalf),
        normal: new THREE.Vector3(0, 0, -1),
        axis: new THREE.Vector3(1, 0, 0),
        halfSpan: xHalf,
        topY,
      },
      {
        edge: 'back',
        id: `${platform.id}-back-ledge`,
        center: new THREE.Vector3(center.x, topY, center.z + zHalf),
        normal: new THREE.Vector3(0, 0, 1),
        axis: new THREE.Vector3(1, 0, 0),
        halfSpan: xHalf,
        topY,
      },
      {
        edge: 'left',
        id: `${platform.id}-left-ledge`,
        center: new THREE.Vector3(center.x - xHalf, topY, center.z),
        normal: new THREE.Vector3(-1, 0, 0),
        axis: new THREE.Vector3(0, 0, 1),
        halfSpan: zHalf,
        topY,
      },
      {
        edge: 'right',
        id: `${platform.id}-right-ledge`,
        center: new THREE.Vector3(center.x + xHalf, topY, center.z),
        normal: new THREE.Vector3(1, 0, 0),
        axis: new THREE.Vector3(0, 0, 1),
        halfSpan: zHalf,
        topY,
      },
    ];
    if (Number.isFinite(platform.minimumHangRootY)) {
      for (const candidate of candidates) {
        candidate.minimumHangRootY = platform.minimumHangRootY;
      }
    }
    return Array.isArray(platform.ledgeEdges)
      ? candidates.filter((candidate) => platform.ledgeEdges.includes(candidate.edge))
      : candidates;
  }

  _addDebugLedge(group, {
    id,
    center,
    normal,
    axis,
    halfSpan,
    markerSize,
    markerPosition,
    material,
  }) {
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(markerSize.x, markerSize.y, markerSize.z),
      material,
    );
    marker.name = `${id}Marker`;
    marker.position.copy(markerPosition);
    marker.castShadow = true;
    marker.receiveShadow = true;
    group.add(marker);

    this.debugLedgeCandidates.push({
      id,
      center,
      normal: normal.clone().normalize(),
      axis: axis.clone().normalize(),
      halfSpan,
      topY: center.y,
    });
  }

  _tryResolvePlatformLanding(context = {}) {
    return this._tryResolveDebugPlatformLanding(context, this._getPlatformingSurfaces())
      || this.dungeonController?.tryResolvePlayerRailLanding?.(context) === true;
  }

  _tryResolveDebugPlatformLanding({
    player,
    root,
    jumpStartY,
    jumpReachHeight,
    previousRootY,
  } = {}, platforms = this.debugLedgePlatform ? [this.debugLedgePlatform] : []) {
    if (!player || !root || !platforms.length) {
      return false;
    }

    const startY = Number.isFinite(jumpStartY) ? jumpStartY : root.position.y;
    let landingPlatform = null;
    for (const platform of platforms) {
      const ledgeHeight = platform.topY - startY;
      if (ledgeHeight > jumpReachHeight * PLATFORM_NORMAL_JUMP_REACH_RATIO) {
        continue;
      }

      if (!this._isInsidePlatformTop(platform, root.position, DEBUG_LEDGE_LANDING_INSET)) {
        continue;
      }

      const verticalDistance = root.position.y - platform.topY;
      if (verticalDistance < -0.12 || verticalDistance > PLATFORM_LANDING_VERTICAL_TOLERANCE) {
        continue;
      }
      if (Number.isFinite(previousRootY)) {
        const crossedTop = previousRootY >= platform.topY && root.position.y <= platform.topY;
        const alreadyOnTop = Math.abs(verticalDistance) <= 0.01;
        if (!crossedTop && !alreadyOnTop) {
          continue;
        }
      }

      if (!landingPlatform || platform.topY > landingPlatform.topY) {
        landingPlatform = platform;
      }
    }

    if (!landingPlatform) {
      return false;
    }

    root.position.y = landingPlatform.topY;
    if (player.modelRoot) {
      player.modelRoot.position.y = 0;
    }
    this.lastDebugLedgeLandingId = landingPlatform.id;
    return true;
  }

  _isInsidePlatformTop(platform, position, inset = 0) {
    if (!platform || !position) {
      return false;
    }

    return Math.abs(position.x - platform.center.x) <= Math.max(0, platform.halfWidth - inset)
      && Math.abs(position.z - platform.center.z) <= Math.max(0, platform.halfDepth - inset);
  }

  _tryResolvePlatformLedgeCling(context = {}) {
    return this._tryResolveDebugLedgeCling(
      context,
      [...this.debugLedgeCandidates, ...this.platformingLedgeCandidates],
    );
  }

  _isExceptionalPlatformEdgeCatch({
    player,
    root,
    ledge,
    faceDistance,
    maximumGrabElevation,
  }) {
    if (player.jumpState !== 'Falling' || (player.velocity?.y ?? 1) > 0) {
      return false;
    }

    const verticalDistance = root.position.y - ledge.topY;
    return faceDistance >= PLATFORM_EDGE_CATCH_DISTANCE_MIN
      && faceDistance <= PLATFORM_EDGE_CATCH_DISTANCE_MAX
      && verticalDistance >= -maximumGrabElevation
      && verticalDistance <= PLATFORM_EDGE_CATCH_VERTICAL_ABOVE;
  }

  _isForwardJumpClearingPlatformEdge({ player, root, ledge, faceDistance }) {
    const verticalDistance = root.position.y - ledge.topY;
    const inwardSpeed = -(
      (player.velocity?.x ?? 0) * ledge.normal.x
      + (player.velocity?.z ?? 0) * ledge.normal.z
    );
    return faceDistance <= PLATFORM_EDGE_CLEAR_DISTANCE_MAX
      && verticalDistance >= -PLATFORM_EDGE_CLEAR_FOOT_TOLERANCE
      && verticalDistance <= PLATFORM_LANDING_VERTICAL_TOLERANCE
      && inwardSpeed >= PLATFORM_EDGE_CLEAR_INWARD_SPEED_MIN;
  }

  _tryResolveDebugLedgeCling({
    player,
    root,
    jumpDirection,
    progress = 0,
    jumpStartY,
    jumpReachHeight,
  } = {}, candidates = this.debugLedgeCandidates) {
    if (!player || !root || !candidates.length) {
      return false;
    }

    const normalProgressWindow = progress >= DEBUG_LEDGE_GRAB_PROGRESS_MIN
      && progress <= DEBUG_LEDGE_GRAB_PROGRESS_MAX;

    tempVectorA.copy(jumpDirection ?? player.lastMoveDirection ?? WORLD_UP);
    tempVectorA.y = 0;
    if (tempVectorA.lengthSq() <= 0.0001) {
      return false;
    }
    tempVectorA.normalize();

    const startY = Number.isFinite(jumpStartY) ? jumpStartY : root.position.y;
    const reachHeight = Number.isFinite(jumpReachHeight)
      ? jumpReachHeight
      : player.getJumpReachHeight?.() ?? 0;
    let best = null;
    for (const ledge of candidates) {
      tempVectorB.copy(root.position).sub(ledge.center);
      const faceDistance = tempVectorB.dot(ledge.normal);
      if (faceDistance < PLATFORM_EDGE_CATCH_DISTANCE_MIN || faceDistance > DEBUG_LEDGE_GRAB_DISTANCE_MAX) {
        continue;
      }

      const lateral = tempVectorB.dot(ledge.axis);
      if (Math.abs(lateral) > ledge.halfSpan + 0.52) {
        continue;
      }

      if (tempVectorA.dot(ledge.normal) > DEBUG_LEDGE_APPROACH_DOT_MAX) {
        continue;
      }

      const ledgeHeight = ledge.topY - startY;
      const maximumGrabElevation = reachHeight * PLATFORM_LEDGE_MAX_REACH_RATIO;
      if (ledgeHeight < PLATFORM_LEDGE_GRAB_HEIGHT_MIN || ledgeHeight > maximumGrabElevation) {
        continue;
      }
      if (this._isForwardJumpClearingPlatformEdge({
        player,
        root,
        ledge,
        faceDistance,
      })) {
        continue;
      }

      const exceptionalEdgeCatch = this._isExceptionalPlatformEdgeCatch({
        player,
        root,
        ledge,
        faceDistance,
        maximumGrabElevation,
      });
      if (!exceptionalEdgeCatch && !normalProgressWindow) {
        continue;
      }
      if (!exceptionalEdgeCatch && faceDistance < DEBUG_LEDGE_GRAB_DISTANCE_MIN) {
        continue;
      }

      const minimumGrabElevation = reachHeight * PLATFORM_NORMAL_JUMP_REACH_RATIO;
      if (ledgeHeight <= minimumGrabElevation && !exceptionalEdgeCatch) {
        continue;
      }

      const idealFaceDistance = exceptionalEdgeCatch ? 0.08 : 0.42;
      const score = Math.abs(faceDistance - idealFaceDistance)
        + Math.max(0, Math.abs(lateral) - ledge.halfSpan) * 1.5
        + Math.abs(ledgeHeight - reachHeight * PLATFORM_LEDGE_IDEAL_REACH_RATIO) * 0.15;
      if (!best || score < best.score) {
        best = {
          ledge,
          lateral,
          score,
          autoClimb: exceptionalEdgeCatch && ledgeHeight <= minimumGrabElevation,
        };
      }
    }

    if (!best) {
      return false;
    }

    const { ledge } = best;
    const lateral = THREE.MathUtils.clamp(best.lateral, -ledge.halfSpan + 0.28, ledge.halfSpan - 0.28);
    tempVectorC.copy(ledge.center).addScaledVector(ledge.axis, lateral);

    const authoredHangY = ledge.topY - DEBUG_LEDGE_HANG_ROOT_DROP;
    const hangY = Number.isFinite(ledge.minimumHangRootY)
      ? Math.max(authoredHangY, ledge.minimumHangRootY)
      : authoredHangY;
    const hangPosition = tempVectorC.clone()
      .addScaledVector(ledge.normal, DEBUG_LEDGE_HANG_OFFSET)
      .setY(hangY);
    const climbPosition = tempVectorC.clone()
      .addScaledVector(ledge.normal, -DEBUG_LEDGE_CLIMB_INSET)
      .setY(ledge.topY + 0.02);
    const handPosition = tempVectorC.clone()
      .addScaledVector(ledge.normal, DEBUG_LEDGE_HAND_OUTWARD_OFFSET)
      .setY(ledge.topY);

    const started = player.startLedgeCling({
      id: ledge.id,
      normal: ledge.normal,
      topY: ledge.topY,
      hangPosition,
      handPosition,
      climbPosition,
      autoClimb: best.autoClimb,
      minimumRootY: Number.isFinite(ledge.minimumHangRootY)
        ? ledge.minimumHangRootY
        : null,
    });

    if (started) {
      this.lastDebugLedgeClingId = ledge.id;
    }

    return started;
  }

  _clearDungeonRunState() {
    this.combat?._clearLockOn?.();
    this.combat?._clearPendingAttacks?.();
    this.combat?._clearMines?.();
    this.pendingExplosions.length = 0;
    this.explosionDispatchDepth = 0;
    if (this.enemyAttackDirector) {
      this.enemyAttackDirector.owner = null;
      this.enemyAttackDirector.queue.length = 0;
      this.enemyAttackDirector.requestTimes.clear();
      this.enemyAttackDirector.handoffTimer = 0;
    }

    for (const enemy of this.enemies) {
      enemy.dispose?.();
      enemy.root.removeFromParent();
    }
    this.enemies.length = 0;

    this.projectiles?.clear?.();
    this.lootSystem?.clear?.();
    this.refractors?.clear?.();

    for (const hazard of this.hazards) {
      hazard.object?.removeFromParent?.();
      this._disposeTimedEffectObject(hazard.object);
    }
    this.hazards.length = 0;

    for (const junk of this.destructibles) {
      junk.root?.removeFromParent?.();
    }
    this.destructibles.length = 0;

    for (const effect of this.timedEffects) {
      effect.object?.removeFromParent?.();
      this._disposeTimedEffectObject(effect.object);
    }
    this.timedEffects.length = 0;

    for (const number of this.damageNumbers) {
      number.sprite?.removeFromParent?.();
      number.sprite.visible = false;
      if (this.damageNumberPool.length < MAX_POOLED_DAMAGE_NUMBERS) {
        this.damageNumberPool.push(number);
      } else {
        number.texture?.dispose?.();
        number.sprite?.material?.dispose?.();
      }
    }
    this.damageNumbers.length = 0;

    for (const effect of this.activeHitEffects) {
      effect.mesh.visible = false;
      effect.mesh.removeFromParent();
      if (this.hitEffectPool.length < MAX_POOLED_HIT_EFFECTS) {
        this.hitEffectPool.push(effect);
      } else {
        effect.mesh.geometry?.dispose?.();
        effect.mesh.material?.dispose?.();
      }
    }
    this.activeHitEffects.length = 0;

    for (const particle of this.activeParticles) {
      particle.mesh.visible = false;
      particle.mesh.removeFromParent();
      if (this.particlePool.length < MAX_POOLED_PARTICLES) {
        this.particlePool.push(particle);
      } else {
        particle.mesh.geometry?.dispose?.();
        particle.mesh.material?.dispose?.();
      }
    }
    this.activeParticles.length = 0;
  }

  _collectRenderResources(root) {
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    const collectMaterial = (material) => {
      if (!material || materials.has(material)) {
        return;
      }
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) {
          textures.add(value);
        }
      }
      for (const uniform of Object.values(material.uniforms ?? {})) {
        const value = uniform?.value;
        if (value?.isTexture) {
          textures.add(value);
        } else if (Array.isArray(value)) {
          for (const entry of value) {
            if (entry?.isTexture) {
              textures.add(entry);
            }
          }
        }
      }
    };

    root?.traverse?.((object) => {
      if (object.geometry?.isBufferGeometry) {
        geometries.add(object.geometry);
      }
      const objectMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      objectMaterials.forEach(collectMaterial);
      if (object.skeleton?.boneTexture?.isTexture) {
        textures.add(object.skeleton.boneTexture);
      }
    });

    return { geometries, materials, textures };
  }

  _disposeDetachedDungeonResources(detachedRoot) {
    const emptyStats = {
      geometryCount: 0,
      materialCount: 0,
      textureCount: 0,
      disposedGeometryCount: 0,
      disposedMaterialCount: 0,
      disposedTextureCount: 0,
      preservedGeometryCount: 0,
      preservedMaterialCount: 0,
      preservedTextureCount: 0,
    };
    if (!detachedRoot) {
      return emptyStats;
    }

    const owned = this._collectRenderResources(detachedRoot);
    // The replacement dungeon is already live in the scene. Protect every
    // resource still referenced anywhere outside the detached dungeon before
    // releasing the old GPU allocations, including deliberately shared maps.
    const live = this._collectRenderResources(this.scene);
    const disposeUnreferenced = (ownedResources, liveResources) => {
      let disposedCount = 0;
      let preservedCount = 0;
      for (const resource of ownedResources) {
        if (liveResources.has(resource)) {
          preservedCount += 1;
          continue;
        }
        resource.dispose?.();
        disposedCount += 1;
      }
      return { disposedCount, preservedCount };
    };
    const geometryResult = disposeUnreferenced(owned.geometries, live.geometries);
    const materialResult = disposeUnreferenced(owned.materials, live.materials);
    const textureResult = disposeUnreferenced(owned.textures, live.textures);

    return {
      geometryCount: owned.geometries.size,
      materialCount: owned.materials.size,
      textureCount: owned.textures.size,
      disposedGeometryCount: geometryResult.disposedCount,
      disposedMaterialCount: materialResult.disposedCount,
      disposedTextureCount: textureResult.disposedCount,
      preservedGeometryCount: geometryResult.preservedCount,
      preservedMaterialCount: materialResult.preservedCount,
      preservedTextureCount: textureResult.preservedCount,
    };
  }

  _buildAimReticle() {
    this.aimReticle = document.getElementById('aim-reticle');
    if (!this.aimReticle) {
      return;
    }
    this.aimReticle.hidden = false;
    this.aimReticle.dataset.coordinateSpace = 'screen';
    this._setAimReticleScreenPosition(this.pointer.x, this.pointer.y);
  }

  _setAimReticleScreenPosition(clientX, clientY) {
    if (!this.aimReticle) {
      return false;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = THREE.MathUtils.clamp(Number(clientX) || 0, rect.left, rect.right);
    const y = THREE.MathUtils.clamp(Number(clientY) || 0, rect.top, rect.bottom);
    this.aimReticle.style.left = `${x}px`;
    this.aimReticle.style.top = `${y}px`;
    return true;
  }

  _projectAimReticleWorldPosition(worldPosition) {
    if (!this.aimReticle || !worldPosition) {
      return false;
    }
    tempVectorD.copy(worldPosition).project(this.camera);
    if (tempVectorD.z < -1 || tempVectorD.z > 1) {
      return false;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    return this._setAimReticleScreenPosition(
      rect.left + (tempVectorD.x + 1) * rect.width * 0.5,
      rect.top + (1 - tempVectorD.y) * rect.height * 0.5,
    );
  }

  _collectCameraOcclusionWalls() {
    for (const owner of this.cameraOcclusionHiddenOwners) {
      owner.visible = this.cameraOcclusionOwnerBaseVisibility.get(owner) ?? true;
    }

    this.cameraOcclusionHiddenOwners.clear();
    this.cameraOcclusionEntries.length = 0;
    this.cameraOcclusionBins.clear();
    this.cameraOcclusionCandidateSet.clear();
    this.cameraOcclusionCandidateObjects.length = 0;
    this.cameraOcclusionHits.length = 0;
    this.cameraOcclusionOwnerBaseVisibility = new WeakMap();
    this.cameraOcclusionOwnerByObject = new WeakMap();

    this.dungeon?.group?.traverse?.((object) => {
      const isWall = object.name === 'dungeonBoundaryWall'
        || object.name === 'factoryBasementRetainingWall'
        || object.name === 'factoryBasementEntryBackdrop'
        || object.name === 'factoryBasementEntryRevealWall';
      if (!isWall && object.userData?.cameraOcclusionSurface !== true) {
        return;
      }
      let owner = object;
      while (owner.parent && owner.parent !== this.dungeon.group) {
        if (owner.userData?.cameraOcclusionOwner) {
          break;
        }
        owner = owner.parent;
      }
      if (!owner.userData?.cameraOcclusionOwner) {
        owner = object;
      }
      this.cameraOcclusionOwnerBaseVisibility.set(owner, owner.visible);
      const bounds = new THREE.Box3().setFromObject(object);
      const entry = {
        object,
        owner,
        bounds,
      };
      this.cameraOcclusionEntries.push(entry);
      this.cameraOcclusionOwnerByObject.set(object, owner);
      const minBinX = Math.floor(bounds.min.x / CAMERA_OCCLUSION_BIN_SIZE);
      const maxBinX = Math.floor(bounds.max.x / CAMERA_OCCLUSION_BIN_SIZE);
      const minBinZ = Math.floor(bounds.min.z / CAMERA_OCCLUSION_BIN_SIZE);
      const maxBinZ = Math.floor(bounds.max.z / CAMERA_OCCLUSION_BIN_SIZE);
      for (let binX = minBinX; binX <= maxBinX; binX += 1) {
        for (let binZ = minBinZ; binZ <= maxBinZ; binZ += 1) {
          const binKey = `${binX},${binZ}`;
          const bin = this.cameraOcclusionBins.get(binKey) ?? [];
          bin.push(entry);
          this.cameraOcclusionBins.set(binKey, bin);
        }
      }
    });
  }

  _updateCameraWallOcclusion() {
    for (const owner of this.cameraOcclusionHiddenOwners) {
      owner.visible = this.cameraOcclusionOwnerBaseVisibility.get(owner) ?? true;
    }
    this.cameraOcclusionHiddenOwners.clear();

    if (!this.cameraOcclusionEntries.length || !this.player?.root) {
      return;
    }

    tempVectorC.set(1, 0, 0).applyQuaternion(this.camera.quaternion).setY(0);
    if (tempVectorC.lengthSq() <= 0.0001) {
      tempVectorC.set(1, 0, 0);
    } else {
      tempVectorC.normalize();
    }
    // Cast only through MegaMan's silhouette. Materials are made temporarily
    // double-sided for these geometry tests so a camera outside a room can see
    // the back face of an intervening wall without resorting to a proximity
    // rule that hides nearby, unobstructing architecture.
    const targetOffsets = [0, -0.42, 0.42];
    for (const offset of targetOffsets) {
      tempVectorA.copy(this.player.root.position)
        .addScaledVector(tempVectorC, offset);
      tempVectorA.y += CAMERA_WALL_OCCLUSION_TARGET_HEIGHT;
      tempVectorB.copy(tempVectorA).sub(this.camera.position);
      const distance = tempVectorB.length();
      if (distance <= 0.001) {
        continue;
      }
      const minX = Math.min(this.camera.position.x, tempVectorA.x) - 1.5;
      const maxX = Math.max(this.camera.position.x, tempVectorA.x) + 1.5;
      const minY = Math.min(this.camera.position.y, tempVectorA.y) - 0.5;
      const maxY = Math.max(this.camera.position.y, tempVectorA.y) + 0.5;
      const minZ = Math.min(this.camera.position.z, tempVectorA.z) - 1.5;
      const maxZ = Math.max(this.camera.position.z, tempVectorA.z) + 1.5;
      this.cameraOcclusionCandidateSet.clear();
      this.cameraOcclusionCandidateObjects.length = 0;
      const minBinX = Math.floor(minX / CAMERA_OCCLUSION_BIN_SIZE);
      const maxBinX = Math.floor(maxX / CAMERA_OCCLUSION_BIN_SIZE);
      const minBinZ = Math.floor(minZ / CAMERA_OCCLUSION_BIN_SIZE);
      const maxBinZ = Math.floor(maxZ / CAMERA_OCCLUSION_BIN_SIZE);
      for (let binX = minBinX; binX <= maxBinX; binX += 1) {
        for (let binZ = minBinZ; binZ <= maxBinZ; binZ += 1) {
          for (const entry of this.cameraOcclusionBins.get(`${binX},${binZ}`) ?? []) {
            if (
              this.cameraOcclusionCandidateSet.has(entry)
              || entry.bounds.max.x < minX
              || entry.bounds.min.x > maxX
              || entry.bounds.max.y < minY
              || entry.bounds.min.y > maxY
              || entry.bounds.max.z < minZ
              || entry.bounds.min.z > maxZ
            ) {
              continue;
            }
            this.cameraOcclusionCandidateSet.add(entry);
            this.cameraOcclusionCandidateObjects.push(entry.object);
          }
        }
      }
      tempVectorB.divideScalar(distance);
      this.cameraOcclusionRaycaster.set(this.camera.position, tempVectorB);
      this.cameraOcclusionRaycaster.near = 0.08;
      this.cameraOcclusionRaycaster.far = Math.max(0.08, distance - 0.08);
      this.cameraOcclusionHits.length = 0;
      const originalMaterialSides = new Map();
      for (const object of this.cameraOcclusionCandidateObjects) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material && material.side !== THREE.DoubleSide && !originalMaterialSides.has(material)) {
            originalMaterialSides.set(material, material.side);
            material.side = THREE.DoubleSide;
          }
        }
      }
      let hits;
      try {
        hits = this.cameraOcclusionRaycaster.intersectObjects(
          this.cameraOcclusionCandidateObjects,
          false,
          this.cameraOcclusionHits,
        );
      } finally {
        for (const [material, side] of originalMaterialSides) {
          material.side = side;
        }
      }
      for (const hit of hits) {
        const owner = this.cameraOcclusionOwnerByObject.get(hit.object) ?? hit.object;
        owner.visible = false;
        this.cameraOcclusionHiddenOwners.add(owner);
      }
    }
  }

  _collectDungeonRenderCullGroups() {
    for (const descriptor of this.dungeonRenderCullGroups) {
      if (descriptor.group) {
        descriptor.group.visible = true;
      }
    }
    this.dungeonRenderCullGroups = [...(this.dungeon?.renderCullGroups ?? [])];
    this.dungeonRenderCullAccumulator = 0;
  }

  _distanceToRenderCullBounds(position, descriptor) {
    if (!position || !descriptor) {
      return Infinity;
    }
    const dx = position.x < descriptor.minX
      ? descriptor.minX - position.x
      : position.x > descriptor.maxX
        ? position.x - descriptor.maxX
        : 0;
    const dz = position.z < descriptor.minZ
      ? descriptor.minZ - position.z
      : position.z > descriptor.maxZ
        ? position.z - descriptor.maxZ
        : 0;
    return Math.hypot(dx, dz);
  }

  _updateDungeonRenderCulling(dt = 0, { force = false } = {}) {
    if (!this.dungeonRenderCullGroups.length || !this.player?.root || !this.camera) {
      return;
    }
    this.dungeonRenderCullAccumulator += Math.max(0, dt);
    if (!force && this.dungeonRenderCullAccumulator < DUNGEON_RENDER_CULL_UPDATE_INTERVAL) {
      return;
    }
    this.dungeonRenderCullAccumulator = 0;
    let visibleGroupCount = 0;
    let hiddenGroupCount = 0;
    let hiddenObjectCount = 0;
    let visibleDrawObjectCount = 0;
    let hiddenDrawObjectCount = 0;
    for (const descriptor of this.dungeonRenderCullGroups) {
      const renderGroup = descriptor.group;
      if (!renderGroup) {
        continue;
      }
      const distance = Math.min(
        this._distanceToRenderCullBounds(this.player.root.position, descriptor),
        this._distanceToRenderCullBounds(this.camera.position, descriptor),
      );
      if (renderGroup.visible && distance > DUNGEON_RENDER_CULL_HIDE_DISTANCE) {
        renderGroup.visible = false;
      } else if (!renderGroup.visible && distance < DUNGEON_RENDER_CULL_SHOW_DISTANCE) {
        renderGroup.visible = true;
      }
      renderGroup.userData.distanceCulled = !renderGroup.visible;
      const drawObjectCount = descriptor.drawObjectCount ?? descriptor.objectCount ?? 0;
      if (renderGroup.visible) {
        visibleGroupCount += 1;
        visibleDrawObjectCount += drawObjectCount;
      } else {
        hiddenGroupCount += 1;
        hiddenObjectCount += drawObjectCount;
        hiddenDrawObjectCount += drawObjectCount;
      }
    }
    this.dungeonRenderCullStats = {
      visibleGroupCount,
      hiddenGroupCount,
      hiddenObjectCount,
      visibleDrawObjectCount,
      hiddenDrawObjectCount,
      totalDrawObjectCount: visibleDrawObjectCount + hiddenDrawObjectCount,
    };
  }

  _updateAimFromPointer() {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._setAimReticleScreenPosition(this.pointer.x, this.pointer.y);
    this.pointerNdc.x = ((this.pointer.x - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((this.pointer.y - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const manualAimActive = Boolean(this.combat?.isManualAimOverrideActive?.(this.pointer));
    if (manualAimActive) {
      this.camera.getWorldDirection(tempVectorB);

      if (!this.manualAimPlaneActive) {
        const projectileOrigin = this.player?.getProjectileOrigin?.()
          ?? this.player?.getAttackOrigin?.()
          ?? this.player?.root?.position;
        const projectileDepth = projectileOrigin
          ? tempVectorA.copy(projectileOrigin).sub(this.camera.position).dot(tempVectorB)
          : 0;
        const freeAimDistance = Math.max(6, this.player?.stats?.attackRange ?? 6);
        this.manualAimPlaneDepth = projectileDepth + freeAimDistance;

        this.manualAimPlaneDepth = Math.max(2, this.manualAimPlaneDepth);
        this.manualAimPlaneActive = true;
      }

      tempVectorA.copy(this.camera.position)
        .addScaledVector(tempVectorB, this.manualAimPlaneDepth);
      this.aimPlane.setFromNormalAndCoplanarPoint(tempVectorB, tempVectorA);
    } else {
      this.manualAimPlaneActive = false;
      this.manualAimPlaneDepth = 0;
      const aimSurfaceY = this.dungeonController?.getSurfaceElevationAt?.(this.player.root.position)
        ?? this.player.root.position.y
        ?? 0;
      this.aimPlane.set(WORLD_UP, -aimSurfaceY);
    }
    if (this.raycaster.ray.intersectPlane(this.aimPlane, this.pointer.aimWorld)) {
      this._updateAimReticleStyle();
    }
  }

  _updateAimReticleStyle() {
    const weaponHud = this.combat?.getWeaponHudData?.();
    if (!weaponHud || !this.aimReticle) {
      return;
    }

    this.aimReticle.style.setProperty(
      '--reticle-color',
      `#${tempColor.set(weaponHud.color).getHexString()}`,
    );
    const readiness = weaponHud.singleGauge
      ? weaponHud.energyPercent
      : Math.min(weaponHud.energyPercent, weaponHud.outputPercent ?? 1);
    this.aimReticle.style.setProperty('--reticle-opacity', readiness <= 0.2 ? '0.48' : '0.78');

    const scale = weaponHud.mode === 'Trap' || weaponHud.mode === 'Arc'
      ? 1.32
      : weaponHud.mode === 'Beam' || weaponHud.mode === 'Pierce'
        ? 0.9
        : weaponHud.mode.includes('Cone')
          ? 1.16
        : 1;
    this.aimReticleScale = THREE.MathUtils.lerp(this.aimReticleScale, scale, 0.22);
    this.aimReticle.style.setProperty('--reticle-scale', this.aimReticleScale.toFixed(3));
    this.aimReticle.dataset.weaponMode = weaponHud.mode;
  }

  _isGameplayPointerLockAllowed() {
    return !this.inventoryOpen && !this.poseDebugOpen && !this.isGameOver;
  }

  _requestGameplayPointerLock() {
    if (!this._isGameplayPointerLockAllowed() || document.pointerLockElement === this.renderer.domElement) {
      return;
    }

    try {
      this.renderer.domElement.requestPointerLock?.();
    } catch {
      // Pointer lock is best-effort and may be blocked by browser settings.
    }
  }

  _exitGameplayPointerLock() {
    if (document.pointerLockElement !== this.renderer.domElement) {
      return;
    }

    try {
      document.exitPointerLock?.();
    } catch {
      // Ignore pointer lock exit failures; browser state will correct on lockchange.
    }
  }

  _handlePointerLockChange() {
    this.pointerLocked = document.pointerLockElement === this.renderer.domElement;

    if (!this.pointerLocked) {
      this.pointer.primary = false;
      this.pointer.primaryPressed = false;
      this.pointer.secondary = false;
      this.pointer.secondaryPressed = false;
      this.pointer.lockOnPressed = false;
    }
  }

  _updatePointerFromMouseEvent(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();

    if (this.pointerLocked) {
      const nextX = this.pointer.x + (event.movementX ?? 0);
      const nextY = this.pointer.y + (event.movementY ?? 0);
      this.pointer.x = THREE.MathUtils.clamp(nextX, rect.left, rect.right);
      this.pointer.y = THREE.MathUtils.clamp(nextY, rect.top, rect.bottom);
      return;
    }

    this.pointer.x = event.clientX;
    this.pointer.y = event.clientY;
  }

  _setCombatMouseButton(button, pressed) {
    if (button === 0) {
      this.pointer.primary = pressed;
      if (pressed) {
        this.pointer.primaryPressed = true;
      }
      return true;
    }

    if (button === 2) {
      this.pointer.secondary = pressed;
      if (pressed) {
        this.pointer.secondaryPressed = true;
        this.player?.syncMoveDirectionToBodyFacing?.();
        this.cameraController?.swingBehindPlayer?.(this.player);
      }
      return true;
    }

    return false;
  }

  _bindEvents() {
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Backquote') {
        event.preventDefault();
        this.setPoseDebugOpen(!this.poseDebugOpen);
        return;
      }

      if (event.code === 'Escape' && this.busterTestRange?.active) {
        event.preventDefault();
        this.exitBusterTestRange();
        return;
      }

      if (event.code === 'KeyI' && this.busterTestRange?.active) {
        event.preventDefault();
        return;
      }

      if (event.code === 'KeyI') {
        this.setInventoryOpen(!this.inventoryOpen);
        return;
      }

      if (event.code === 'Escape' && this.poseDebugOpen) {
        this.setPoseDebugOpen(false);
        return;
      }

      if (event.code === 'Escape' && this.inventoryOpen) {
        this.setInventoryOpen(false);
        return;
      }

      if (!this.inventoryOpen && !this.poseDebugOpen && event.code === 'KeyZ') {
        event.preventDefault();
        this.pointer.alternate = true;
        if (!event.repeat) {
          this.pointer.alternatePressed = true;
        }
        return;
      }

      if (!this.inventoryOpen && !this.poseDebugOpen && !event.repeat && event.code === 'Tab') {
        event.preventDefault();
        this.pointer.lockOnPressed = true;
        return;
      }

      if (!this.inventoryOpen && !this.poseDebugOpen && !event.repeat && event.code === 'Space') {
        event.preventDefault();
        const movementBasis = this._getPlayerMovementBasis();

        if (this.player?.isLedgeClinging?.()) {
          this.player?.tryJump?.(this.keys, movementBasis);
          return;
        }

        if (this.player?.hasLateralDodgeInput?.(this.keys)) {
          this.player?.tryLateralDodgeRoll?.(this.keys, movementBasis);
          return;
        }

        if (this.player?.tryJump?.(this.keys, movementBasis)) {
          return;
        }
      }

      if (!this.inventoryOpen && !this.poseDebugOpen && !event.repeat && event.code === 'KeyQ') {
        event.preventDefault();
        if (this.player?.tryDodgeRoll?.(this.keys, this._getPlayerMovementBasis())) {
          return;
        }
      }

      if (!this.inventoryOpen && event.code.startsWith('Digit')) {
        const slotIndex = Number(event.code.slice(5)) - 1;

        if (slotIndex >= 0 && slotIndex < 4) {
          this.combat.switchArmSlot(slotIndex);
          return;
        }
      }

      if (!this.inventoryOpen && event.code === 'KeyE') {
        if (this.activateNearestInteractable()) {
          return;
        }
      }

      this.keys.add(event.code);
    });

    window.addEventListener('keyup', (event) => {
      if (event.code === 'KeyZ') {
        this.pointer.alternate = false;
        return;
      }

      this.keys.delete(event.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.pointer.primary = false;
      this.pointer.primaryPressed = false;
      this.pointer.secondary = false;
      this.pointer.secondaryPressed = false;
      this.pointer.lockOnPressed = false;
      this.pointer.alternate = false;
      this.pointer.alternatePressed = false;
    });

    document.addEventListener('pointerlockchange', () => this._handlePointerLockChange());

    document.addEventListener('mousemove', (event) => {
      if (!this.pointerLocked || this.poseDebugOpen) {
        return;
      }

      this._updatePointerFromMouseEvent(event);
    });

    document.addEventListener('mousedown', (event) => {
      if (!this.pointerLocked || this.poseDebugOpen || !this._isGameplayPointerLockAllowed()) {
        return;
      }

      if (this._setCombatMouseButton(event.button, true)) {
        event.preventDefault();
      }
    });

    document.addEventListener('mouseup', (event) => {
      if (!this.pointerLocked || this.poseDebugOpen) {
        return;
      }

      if (this._setCombatMouseButton(event.button, false)) {
        event.preventDefault();
      }
    });

    this.renderer.domElement.addEventListener('pointermove', (event) => {
      if (!this.pointerLocked) {
        this._updatePointerFromMouseEvent(event);
      }

      if (this.poseDebugOpen) {
        this._handlePoseDebugPointerMove(event);
      }
    });

    this.renderer.domElement.addEventListener('pointerdown', (event) => {
      if (this.poseDebugOpen) {
        event.preventDefault();
        try {
          this.renderer.domElement.setPointerCapture?.(event.pointerId);
        } catch {
          // Pointer capture is best-effort; dragging still works through window pointerup.
        }
        this._handlePoseDebugPointerDown(event);
        return;
      }

      this._requestGameplayPointerLock();
      event.preventDefault();
      this._setCombatMouseButton(event.button, true);
    });

    window.addEventListener('pointerup', (event) => {
      if (this.poseDebugOpen) {
        this._handlePoseDebugPointerUp(event);
        return;
      }

      this._setCombatMouseButton(event.button, false);
    });

    this.renderer.domElement.addEventListener('contextmenu', (event) => {
      event.preventDefault();
    });

    this.renderer.domElement.addEventListener('wheel', (event) => {
      if (!this.poseDebugOpen) {
        return;
      }

      event.preventDefault();
      const zoom = 1 + Math.sign(event.deltaY) * 0.08;
      this.poseDebugCamera.distance = THREE.MathUtils.clamp(
        this.poseDebugCamera.distance * zoom,
        POSE_DEBUG_CAMERA_MIN_DISTANCE,
        POSE_DEBUG_CAMERA_MAX_DISTANCE,
      );
    }, { passive: false });

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  _addStarterItems() {
    const starterBuster = this.lootSystem.generateItem(1, {
      type: 'busterArm',
      rarity: 'standard',
      name: 'Mega Buster',
      affixCount: 0,
      baseStats: {
        attackDamage: 8,
        maxEnergy: 6,
        attackRange: 6.9,
        attackSpeed: 0.1,
      },
    });
    const starterSword = this.lootSystem.generateItem(1, {
      type: 'swordArm',
      rarity: 'scrap',
      name: 'Rebuilt Laser Beam Blade',
    });
    const starterCannon = this.lootSystem.generateItem(1, {
      type: 'cannonArm',
      rarity: 'scrap',
      name: 'Patched Cannon Arm',
    });
    const starterLift = this.lootSystem.generateItem(1, {
      type: 'liftArm',
      rarity: 'standard',
      name: 'Lift Arm',
      affixCount: 0,
    });
    const starterMachineGun = this.lootSystem.generateItem(1, {
      type: 'machineGunArm',
      rarity: 'scrap',
      name: 'Rusted Machine Gun Arm',
    });
    const starterDrill = this.lootSystem.generateItem(1, {
      type: 'drillArm',
      rarity: Math.random() < 0.72 ? 'scrap' : 'standard',
    });
    const starterShield = this.lootSystem.generateItem(1, {
      type: 'shieldArm',
      rarity: 'standard',
      name: 'Rebuilt Shield Arm',
    });
    const starterBoots = this.lootSystem.generateItem(1, {
      type: 'servoBoots',
      rarity: 'scrap',
      name: 'Rebuilt Servo Boots',
    });

    this.player.setArmHotbar([starterBuster, starterSword, starterCannon]);
    this.player.setUtilityArms([starterLift]);
    this.player.switchArmWeapon(0, true);
    this.player.equipment.equip(starterShield, 'offhand');
    this.player.equipment.equip(starterBoots);

    this.inventory.addItem(starterMachineGun);
    this.inventory.addItem(starterDrill);
    if (!this.busterLabEnabled) {
      this.inventory.addItem(this.lootSystem.generateItem(1, { type: 'powerRaiser', rarity: 'standard' }));
    }
    this.inventory.addItem(this.lootSystem.generateItem(1, {
      type: 'flameArm',
      rarity: 'standard',
      name: 'Calibrated Flame Arm',
    }));
    this.inventory.addItem(this.lootSystem.generateItem(1, {
      type: 'mineArm',
      rarity: 'standard',
      name: 'Calibrated Mine Layer Arm',
    }));
    this.inventory.addItem(this.lootSystem.generateItem(1, {
      type: 'missileArm',
      rarity: 'standard',
      name: 'Calibrated Missile Arm',
    }));
    this.inventory.addItem(this.lootSystem.generateItem(1, {
      type: 'grenadeArm',
      rarity: 'standard',
      name: 'Calibrated Grenade Arm',
    }));
    this.inventory.addItem(this.lootSystem.generateItem(1, {
      type: 'laserArm',
      rarity: 'standard',
      name: 'Calibrated Shining Laser',
    }));
    this.inventory.addItem(this.lootSystem.generateItem(1, {
      type: 'railBusterArm',
      rarity: 'standard',
      name: 'Calibrated Rail Buster Arm',
    }));
    this.inventory.addItem(this.lootSystem.generateItem(1, {
      type: 'iceSprayerArm',
      rarity: 'standard',
      name: 'Calibrated Ice Sprayer Arm',
    }));
    this.inventory.addItem(this.lootSystem.generateItem(1, {
      type: 'shockCoilArm',
      rarity: 'standard',
      name: 'Calibrated Shock Coil Arm',
    }));
    this.inventory.addItem(this.lootSystem.generateItem(1, {
      type: 'drillArm',
      rarity: 'standard',
      name: 'Calibrated Drill Arm',
    }));
    this.inventory.addItem(this.lootSystem.generateItem(1, { type: 'utilityHelmet', rarity: 'standard' }));
    this.inventory.addItem(this.lootSystem.generateItem(2, { type: 'reactorChip', rarity: 'tuned' }));
    this.inventory.addItem(this.lootSystem.generateItem(2, { type: 'kevlarJacket', rarity: 'standard' }));
  }

  _updateEnemies(dt) {
    this._updateEnemyAttackDirector(dt);
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      enemy.update(dt, this);

      if (enemy.dead && enemy.deathTimer <= 0) {
        enemy.dispose?.();
        enemy.root.removeFromParent();
        this.enemies.splice(i, 1);
      }
    }
  }

  _updateEnemyAttackDirector(dt) {
    const director = this.enemyAttackDirector;
    if (!director) return;
    director.time += Math.max(0, dt);
    director.handoffTimer = Math.max(0, director.handoffTimer - Math.max(0, dt));
    this._pruneEnemyAttackQueue();

    const owner = director.owner;
    if (!owner) return;
    const brainState = owner.brain?.state;
    const customAttackActive = typeof owner.isAttackLeaseActive === 'function'
      ? owner.isAttackLeaseActive()
      : brainState === 'telegraph' || brainState === 'commit';
    if (owner.dead || !this.enemies.includes(owner) || !customAttackActive) {
      this.completeEnemyAttack(owner);
    }
  }

  requestEnemyAttack(enemy) {
    const director = this.enemyAttackDirector;
    if (!director || !enemy || enemy.dead) return false;
    director.requestTimes.set(enemy, director.time);
    this._pruneEnemyAttackQueue();
    if (director.owner && (director.owner.dead || !this.enemies.includes(director.owner))) {
      director.requestTimes.delete(director.owner);
      director.owner = null;
      director.handoffTimer = 0;
    }
    if (director.owner === enemy) return true;
    if (!director.queue.includes(enemy)) director.queue.push(enemy);
    if (director.owner || director.handoffTimer > 0 || director.queue[0] !== enemy) return false;
    director.queue.shift();
    director.owner = enemy;
    return true;
  }

  completeEnemyAttack(enemy, handoffDelay = ENEMY_ATTACK_HANDOFF_DELAY) {
    const director = this.enemyAttackDirector;
    if (!director) return;
    director.queue = director.queue.filter((candidate) => candidate !== enemy);
    director.requestTimes.delete(enemy);
    if (director.owner !== enemy) return;
    director.owner = null;
    director.handoffTimer = Math.max(director.handoffTimer, handoffDelay);
  }

  cancelEnemyAttackRequest(enemy) {
    const director = this.enemyAttackDirector;
    if (!director) return;
    director.queue = director.queue.filter((candidate) => candidate !== enemy);
    director.requestTimes.delete(enemy);
    if (director.owner === enemy) this.completeEnemyAttack(enemy);
  }

  _pruneEnemyAttackQueue() {
    const director = this.enemyAttackDirector;
    if (!director) return;
    director.queue = director.queue.filter((candidate) => {
      const alive = candidate && !candidate.dead && this.enemies.includes(candidate);
      const fresh = director.time - (director.requestTimes.get(candidate) ?? -Infinity)
        <= ENEMY_ATTACK_REQUEST_TTL;
      if (!alive || !fresh) director.requestTimes.delete(candidate);
      return alive && fresh;
    });
  }

  _updateHazards(dt) {
    for (let i = this.hazards.length - 1; i >= 0; i -= 1) {
      const hazard = this.hazards[i];
      hazard.duration -= dt;
      if (hazard.kind === 'clawSwipeTrail') {
        const remaining = THREE.MathUtils.clamp(
          hazard.duration / Math.max(0.001, hazard.maxDuration),
          0,
          1,
        );
        const reveal = THREE.MathUtils.smoothstep(1 - remaining, 0, 0.82);
        hazard.object.rotation.y += dt * 0.7;
        for (const ribbon of hazard.object.children) {
          const drawCount = ribbon.geometry?.index?.count
            ?? ribbon.geometry?.attributes?.position?.count
            ?? 0;
          ribbon.geometry?.setDrawRange?.(0, Math.floor(drawCount * reveal));
          if (ribbon.material) {
            ribbon.material.opacity = remaining * (ribbon.userData.baseOpacity ?? 0.7)
              * Math.max(0.35, reveal);
          }
        }

        tempVectorA.copy(this.player.root.position).sub(hazard.object.position);
        const horizontalDistance = Math.hypot(tempVectorA.x, tempVectorA.z);
        const playerRadius = this.player.radius ?? 0.42;
        const insideHeight = Math.abs(tempVectorA.y) <= 2.2;
        hazard.object.updateMatrixWorld(true);
        tempVectorB.copy(this.player.root.position);
        hazard.object.worldToLocal(tempVectorB);
        const playerAngle = THREE.MathUtils.euclideanModulo(
          Math.atan2(-tempVectorB.z, tempVectorB.x),
          Math.PI * 2,
        );
        const insideRibbonBand = insideHeight && hazard.object.children.some((ribbon) => (
          Math.abs(horizontalDistance - (ribbon.userData.collisionRadius ?? hazard.radius))
            <= (ribbon.userData.collisionHalfWidth ?? 0.08) + playerRadius
        ));
        const insideRevealedRibbon = insideHeight && hazard.object.children.some((ribbon) => {
          const insideRadius = Math.abs(
            horizontalDistance - (ribbon.userData.collisionRadius ?? hazard.radius),
          ) <= (ribbon.userData.collisionHalfWidth ?? 0.08) + playerRadius;
          if (!insideRadius) return false;
          const angleFromStart = THREE.MathUtils.euclideanModulo(
            playerAngle - (ribbon.userData.thetaStart ?? 0),
            Math.PI * 2,
          );
          return angleFromStart <= (ribbon.userData.thetaLength ?? Math.PI * 2) * reveal;
        });
        const hasLineOfSight = hazard.source?._hasClawAttackLineOfSight?.(
          this,
          hazard.object.position,
          this.player.root.position,
        ) ?? true;
        const inside = insideRevealedRibbon && hasLineOfSight;
        if (hazard.spawnEntrySuppressed && !insideRibbonBand) {
          hazard.spawnEntrySuppressed = false;
        }
        if (!hazard.consumed
          && !hazard.spawnEntrySuppressed
          && !hazard.wasInside
          && inside
          && !this.player.dead) {
          hazard.consumed = true;
          tempVectorA.y = 0;
          if (tempVectorA.lengthSq() <= 0.0001) tempVectorA.copy(this.player.lastMoveDirection);
          tempVectorA.normalize();
          const dealt = this.player.takeDamage(hazard.damage, hazard.source, {
            attackKind: 'clawSwipeTrail',
            knockbackDirection: tempVectorA,
            knockbackStrength: 0.72,
          });
          if (dealt > 0) {
            hazard.source?.onHitPlayer?.(this.player, dealt);
            this.addHitEffect(this.player.root.position, 0xff2020, 0.7);
            this.requestHitStop?.(0.07, { timeScale: 0.07 });
          }
        }
        hazard.wasInside = inside;
      } else {
        if (hazard.object.material) {
          hazard.object.material.opacity = Math.max(
            0,
            Math.min(0.32, hazard.duration / Math.max(0.001, hazard.maxDuration ?? 2.4) * 0.32),
          );
        }
        hazard.object.rotation.z += dt * 0.6;
      }

      if (hazard.kind === 'clawSwipeTrail') {
        // The specialized annular crossing check above owns its single hit.
      } else if (hazard.target === 'enemies') {
        hazard.tickTimer -= dt;
        if (hazard.tickTimer <= 0) {
          const tickInterval = 0.25;
          hazard.tickTimer = tickInterval;

          for (const enemy of this.enemies) {
            if (enemy.dead
              || (enemy.navigationMode === 'air' && hazard.groundOnly !== false)
              || enemy.root.position.distanceTo(hazard.object.position) > hazard.radius + enemy.radius) {
              continue;
            }

            this.damageEnemy(enemy, hazard.damagePerSecond * tickInterval, {
              source: hazard.source ?? this.player,
              element: hazard.element,
              statusTick: true,
              stagger: 0.02,
            });
          }
        }
      } else if (this.player.root.position.distanceTo(hazard.object.position) <= hazard.radius) {
        this.player.takeDamage(hazard.damagePerSecond * dt);
      }

      if (hazard.duration <= 0) {
        hazard.object.removeFromParent();
        this._disposeTimedEffectObject(hazard.object);
        this.hazards.splice(i, 1);
      }
    }
  }

  _updateDestructibles(dt) {
    for (const junk of this.destructibles) {
      if (junk.dead || junk.flashTimer <= 0) {
        continue;
      }

      junk.flashTimer = Math.max(0, junk.flashTimer - dt);
      const flash = junk.flashTimer / 0.12;

      for (const material of junk.materials) {
        material.emissive.set(flash > 0 ? 0xffd36f : 0x101822);
        material.emissiveIntensity = 0.08 + flash * 0.74;
      }
    }
  }

  _damageJunk(junk, amount, meta = {}) {
    if (!junk || junk.dead || amount <= 0) {
      return 0;
    }

    const dealt = Math.min(junk.hp, amount);
    junk.hp = Math.max(0, junk.hp - dealt);
    junk.flashTimer = 0.12;

    const color = meta.color ?? 0xffd36f;
    const hitPosition = junk.root.position.clone();
    hitPosition.y = 0.64;
    this.addDamageNumber(hitPosition, dealt, color, false);
    this.addHitEffect(hitPosition, color, 0.42);

    if (Math.random() < 0.45) {
      this.addParticleBurst(hitPosition, color, 4, 0.08);
    }

    if (junk.hp <= 0) {
      this._breakJunk(junk, meta);
    }

    return dealt;
  }

  _breakJunk(junk, meta = {}) {
    if (!junk || junk.dead) {
      return;
    }

    junk.dead = true;
    const position = junk.root.position.clone();
    position.y = 0.46;
    this.addParticleBurst(position, meta.color ?? 0xffd36f, 22, 0.14);
    this.addParticleBurst(position, 0x8da2b6, 14, 0.18);
    junk.root.removeFromParent();

    const level = Math.max(1, this.player?.level ?? 1);
    const zenny = 10 + Math.floor(Math.random() * 18) + Math.round(level * 2);
    if (this.inventory) {
      this.inventory.gold += zenny;
    }
    this.ui?.showToast?.(`Junk cache +${zenny}z`, '#f2c84b');
  }

  _updateDamageNumbers(dt) {
    for (let i = this.damageNumbers.length - 1; i >= 0; i -= 1) {
      const number = this.damageNumbers[i];
      number.life -= dt;
      number.sprite.position.y += dt * 1.15;
      number.sprite.material.opacity = Math.max(0, number.life / number.maxLife);

      if (number.life <= 0) {
        number.sprite.removeFromParent();
        number.sprite.visible = false;
        this.damageNumbers.splice(i, 1);
        if (this.damageNumberPool.length < MAX_POOLED_DAMAGE_NUMBERS) {
          this.damageNumberPool.push(number);
        } else {
          number.texture?.dispose?.();
          number.sprite.material?.dispose?.();
        }
      }
    }
  }

  _updateHitEffects(dt) {
    for (let i = this.activeHitEffects.length - 1; i >= 0; i -= 1) {
      const effect = this.activeHitEffects[i];
      effect.life -= dt;
      const progress = Math.max(0, effect.life / effect.maxLife);
      effect.mesh.material.opacity = progress;
      effect.mesh.scale.multiplyScalar(1 + dt * 6);

      if (effect.life <= 0) {
        effect.mesh.removeFromParent();
        effect.mesh.visible = false;
        this.activeHitEffects.splice(i, 1);
        if (this.hitEffectPool.length < MAX_POOLED_HIT_EFFECTS) {
          this.hitEffectPool.push(effect);
        } else {
          effect.mesh.geometry?.dispose?.();
          effect.mesh.material?.dispose?.();
        }
      }
    }
  }

  _updateParticles(dt) {
    for (let i = this.activeParticles.length - 1; i >= 0; i -= 1) {
      const particle = this.activeParticles[i];
      particle.life -= dt;
      particle.velocity.y -= 5.5 * (particle.gravityScale ?? 1) * dt;
      particle.mesh.position.addScaledVector(particle.velocity, dt);
      particle.mesh.material.opacity = Math.max(0, particle.life / particle.maxLife) * (particle.maxOpacity ?? 1);

      if (particle.life <= 0) {
        particle.mesh.removeFromParent();
        particle.mesh.visible = false;
        this.activeParticles.splice(i, 1);
        if (this.particlePool.length < MAX_POOLED_PARTICLES) {
          this.particlePool.push(particle);
        } else {
          particle.mesh.geometry?.dispose?.();
          particle.mesh.material?.dispose?.();
        }
      }
    }
  }

  _disposeTimedEffectObject(object) {
    const geometries = new Set();
    const materials = new Set();
    object?.traverse?.((child) => {
      if (child.geometry && !child.geometry.userData?.sharedTimedEffectGeometry) {
        geometries.add(child.geometry);
      }
      const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of childMaterials) {
        if (material) materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose?.();
    for (const material of materials) material.dispose?.();
  }

  _updateFieryExplosionEffect(effect, dt, progress) {
    const age = 1 - progress;
    const expansion = THREE.MathUtils.smoothstep(age, 0, 0.72);
    const scale = effect.radius * THREE.MathUtils.lerp(0.08, effect.maxScale ?? 1.3, expansion);
    const fade = Math.pow(progress, 1.35) * Math.min(1, age * 6 + 0.18);
    effect.object.scale.setScalar(scale);
    effect.object.rotation.y += dt * 2.4;
    effect.object.rotation.z += dt * 1.1;
    for (const child of effect.object.children) {
      if (child.material) {
        child.material.opacity = (
          child.material.userData.fieryExplosionBaseOpacity
          ?? child.material.userData.enemyDeathBaseOpacity
          ?? 0.7
        ) * fade;
      }
    }
  }

  _updateEnemyDeathPartsEffect(effect, dt, progress) {
    const fade = THREE.MathUtils.smoothstep(progress, 0, 0.38);
    const drag = Math.exp(-0.52 * dt);
    for (const part of effect.parts) {
      part.velocity.y -= 5.8 * dt;
      part.velocity.multiplyScalar(drag);
      part.object.position.addScaledVector(part.velocity, dt);
      part.object.rotation.x += part.angularVelocity.x * dt;
      part.object.rotation.y += part.angularVelocity.y * dt;
      part.object.rotation.z += part.angularVelocity.z * dt;

      const floor = effect.floorY + 0.08;
      if (part.object.position.y < floor) {
        part.object.position.y = floor;
        if (part.velocity.y < 0 && part.bounces < 1) {
          part.velocity.y *= -0.24;
          part.velocity.x *= 0.68;
          part.velocity.z *= 0.68;
          part.bounces += 1;
        } else {
          part.velocity.y = 0;
        }
      }

      for (const material of part.materials) {
        material.opacity = (material.userData.enemyDeathBaseOpacity ?? 1) * fade;
      }
    }
  }

  _updateTimedEffects(dt) {
    for (let i = this.timedEffects.length - 1; i >= 0; i -= 1) {
      const effect = this.timedEffects[i];
      if (effect.delay > 0) {
        effect.delay = Math.max(0, effect.delay - dt);
        effect.object.visible = false;
        continue;
      }

      effect.object.visible = true;
      effect.life -= dt;
      const progress = Math.max(0, effect.life / effect.maxLife);
      const reveal = THREE.MathUtils.smoothstep(1 - progress, 0, 0.78);

      if (effect.object?.userData?.explosionVisual === 'fierySphere') {
        this._updateFieryExplosionEffect(effect, dt, progress);
      } else if (effect.kind === 'enemyDeathParts') {
        this._updateEnemyDeathPartsEffect(effect, dt, progress);
      }

      if (effect.sweepDraw && effect.object.geometry) {
        const drawCount = effect.object.geometry.index?.count ?? effect.object.geometry.attributes.position?.count ?? 0;
        effect.object.geometry.setDrawRange(0, Math.max(0, Math.floor(drawCount * reveal)));
      }

      if (!effect.kind && effect.object.material) {
        effect.object.material.opacity = progress * (effect.opacity ?? 0.52) * (effect.sweepDraw ? Math.max(0.35, reveal) : 1);
      }

      if (!effect.kind && effect.grow) {
        effect.object.scale.multiplyScalar(1 + dt * 2.2);
      }

      if (effect.life <= 0) {
        effect.object.removeFromParent();
        this._disposeTimedEffectObject(effect.object);
        this.timedEffects.splice(i, 1);
      }
    }
  }

  _setPoseDebugHandlesVisible(visible) {
    this.poseDebugHandleGroup.visible = visible;
    this.renderer.domElement.style.cursor = visible ? 'crosshair' : '';

    if (!visible) {
      this._endPoseDebugDrag();
    }
  }

  _syncPoseDebugCameraFromCurrent() {
    tempVectorA.copy(this.player.root.position).add(CAMERA_LOOK_OFFSET);
    tempVectorB.copy(this.camera.position).sub(tempVectorA);

    const distance = THREE.MathUtils.clamp(tempVectorB.length() || POSE_DEBUG_CAMERA_DEFAULT_DISTANCE, POSE_DEBUG_CAMERA_MIN_DISTANCE, POSE_DEBUG_CAMERA_MAX_DISTANCE);
    const horizontal = Math.max(0.001, Math.hypot(tempVectorB.x, tempVectorB.z));

    this.poseDebugCamera.distance = distance;
    this.poseDebugCamera.yaw = Math.atan2(tempVectorB.x, tempVectorB.z);
    this.poseDebugCamera.pitch = THREE.MathUtils.clamp(
      Math.atan2(tempVectorB.y, horizontal),
      POSE_DEBUG_CAMERA_MIN_PITCH,
      POSE_DEBUG_CAMERA_MAX_PITCH,
    );
  }

  _updatePoseDebugHandles() {
    const rig = this.player.externalRig;
    const joints = this.ui?.getPoseDebugJoints?.() ?? [];

    if (!rig?.joints || joints.length === 0) {
      this.poseDebugHandleGroup.visible = false;
      return;
    }

    this.poseDebugHandleGroup.visible = true;

    for (const { name, label } of joints) {
      const joint = rig.joints.get(name);
      if (!joint) {
        continue;
      }

      let handle = this.poseDebugHandleMap.get(name);
      if (!handle) {
        handle = new THREE.Mesh(this.poseDebugHandleGeometry, this.poseDebugHandleMaterial);
        handle.name = `poseDebugHandle_${name}`;
        handle.renderOrder = 40;
        handle.userData.poseJointName = name;
        handle.userData.poseJointLabel = label;
        this.poseDebugHandleMap.set(name, handle);
        this.poseDebugHandles.push(handle);
        this.poseDebugHandleGroup.add(handle);
      }

      joint.getWorldPosition(handle.position);
      const distance = Math.max(1, this.camera.position.distanceTo(handle.position));
      handle.scale.setScalar(THREE.MathUtils.clamp(distance * 0.016, 0.075, 0.22));
      handle.material = this.poseDebugActiveDrag?.jointName === name
        ? this.poseDebugHandleSelectedMaterial
        : this.poseDebugHoveredJointName === name
          ? this.poseDebugHandleHoverMaterial
        : this.poseDebugHandleMaterial;
      handle.visible = true;
    }

    this._refreshPoseDebugPartPickables(rig);
  }

  _refreshPoseDebugPartPickables(rig) {
    this.poseDebugPartPickables.length = 0;

    rig.root?.traverse((object) => {
      if (object.isMesh && object.visible) {
        this.poseDebugPartPickables.push(object);
      }
    });
  }

  _handlePoseDebugPointerDown(event) {
    this.poseDebugCamera.lastX = event.clientX;
    this.poseDebugCamera.lastY = event.clientY;

    if (event.button === 0) {
      const target = this._pickPoseDebugTarget(event);
      if (target) {
        const startDegrees = this.ui.getPoseDebugJointDegrees(target.jointName);
        this.poseDebugActiveDrag = {
          type: 'joint',
          jointName: target.jointName,
          startX: event.clientX,
          startY: event.clientY,
          startDegrees,
        };
        this.ui.focusPoseDebugJoint?.(target.jointName);
        this.renderer.domElement.style.cursor = 'grabbing';
        this._updatePoseDebugHandles();
        return;
      }
    }

    this.poseDebugCamera.rotating = true;
    this.renderer.domElement.style.cursor = 'grabbing';
  }

  _handlePoseDebugPointerMove(event) {
    if (this.poseDebugActiveDrag?.type === 'joint') {
      this._updatePoseDebugJointDrag(event);
      return;
    }

    if (!this.poseDebugCamera.rotating) {
      this._updatePoseDebugHover(event);
      return;
    }

    const dx = event.clientX - this.poseDebugCamera.lastX;
    const dy = event.clientY - this.poseDebugCamera.lastY;
    this.poseDebugCamera.lastX = event.clientX;
    this.poseDebugCamera.lastY = event.clientY;
    this.poseDebugCamera.yaw -= dx * 0.008;
    this.poseDebugCamera.pitch = THREE.MathUtils.clamp(
      this.poseDebugCamera.pitch + dy * 0.006,
      POSE_DEBUG_CAMERA_MIN_PITCH,
      POSE_DEBUG_CAMERA_MAX_PITCH,
    );
  }

  _handlePoseDebugPointerUp(event) {
    try {
      if (this.renderer.domElement.hasPointerCapture?.(event.pointerId)) {
        this.renderer.domElement.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore stale pointer capture from interrupted debug drags.
    }
    this._endPoseDebugDrag();
    this.poseDebugCamera.rotating = false;
    this.renderer.domElement.style.cursor = this.poseDebugOpen ? 'crosshair' : '';
  }

  _endPoseDebugDrag() {
    this.poseDebugActiveDrag = null;

    for (const handle of this.poseDebugHandles) {
      handle.material = this.poseDebugHandleMaterial;
    }
  }

  _updatePoseDebugHover(event) {
    this._setRaycasterFromPointerEvent(event);
    this._updatePoseDebugHandles();

    const handleHits = this.raycaster.intersectObjects(this.poseDebugHandles.filter((handle) => handle.visible), false);
    this.poseDebugHoveredJointName = handleHits[0]?.object.userData.poseJointName ?? null;
    this.renderer.domElement.style.cursor = this.poseDebugHoveredJointName ? 'grab' : 'crosshair';
    this._updatePoseDebugHandles();
  }

  _updatePoseDebugJointDrag(event) {
    const drag = this.poseDebugActiveDrag;
    if (!drag) {
      return;
    }

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const next = { ...drag.startDegrees };

    if (event.shiftKey) {
      next.z = drag.startDegrees.z + dx * POSE_DEBUG_DRAG_DEGREES_PER_PIXEL;
    } else {
      next.x = drag.startDegrees.x - dy * POSE_DEBUG_DRAG_DEGREES_PER_PIXEL;
      next.y = drag.startDegrees.y + dx * POSE_DEBUG_DRAG_DEGREES_PER_PIXEL;
    }

    this.ui.setPoseDebugJointDegrees(drag.jointName, next);
  }

  _pickPoseDebugTarget(event) {
    this._setRaycasterFromPointerEvent(event);
    this._updatePoseDebugHandles();

    const handleHits = this.raycaster.intersectObjects(this.poseDebugHandles.filter((handle) => handle.visible), false);
    if (handleHits.length > 0) {
      return {
        jointName: handleHits[0].object.userData.poseJointName,
        source: 'handle',
      };
    }

    const partHits = this.raycaster.intersectObjects(this.poseDebugPartPickables, false);
    if (partHits.length > 0) {
      const jointName = this._findPoseDebugJointForObject(partHits[0].object);
      if (jointName) {
        return { jointName, source: 'part' };
      }
    }

    return null;
  }

  _findPoseDebugJointForObject(object) {
    const rig = this.player.externalRig;

    if (!rig?.joints) {
      return null;
    }

    const resolvedJointName = rig.resolveDebugJointForObject?.(object);
    if (resolvedJointName && rig.joints.has(resolvedJointName)) {
      return resolvedJointName;
    }

    for (let current = object; current; current = current.parent) {
      for (const [name, joint] of rig.joints.entries()) {
        if (joint === current) {
          return name;
        }
      }
    }

    return null;
  }

  _setRaycasterFromPointerEvent(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
  }

  _updateCamera(dt) {
    if (this.animationPreview?.active && this.animationPreview.cameraAngle !== 'follow') {
      this._updateAnimationPreviewCamera(dt);
      return;
    }

    if (this.poseDebugOpen) {
      tempVectorA.copy(this.player.root.position).add(CAMERA_LOOK_OFFSET);
      const horizontal = Math.cos(this.poseDebugCamera.pitch) * this.poseDebugCamera.distance;
      tempVectorB.set(
        Math.sin(this.poseDebugCamera.yaw) * horizontal,
        Math.sin(this.poseDebugCamera.pitch) * this.poseDebugCamera.distance,
        Math.cos(this.poseDebugCamera.yaw) * horizontal,
      ).add(tempVectorA);
      this.camera.position.lerp(tempVectorB, Math.min(1, dt * 12));
      this.camera.lookAt(tempVectorA);
      return;
    }

    this.cameraController.update(dt, this.player);
  }

  _updateAnimationPreviewCamera(dt) {
    const root = this.player?.root;
    if (!root) {
      return;
    }

    const angle = this.animationPreview?.cameraAngle ?? 'rear';
    const distance = 6.6;
    const height = angle === 'top' ? 8.4 : 2.65;
    const lookHeight = 1.22;
    const offset = tempVectorB.set(0, height, -distance);

    if (angle === 'front') {
      offset.set(0, height, distance);
    } else if (angle === 'left') {
      offset.set(-distance, height, 0);
    } else if (angle === 'right') {
      offset.set(distance, height, 0);
    } else if (angle === 'frontLeft') {
      offset.set(-distance * 0.72, height, distance * 0.72);
    } else if (angle === 'frontRight') {
      offset.set(distance * 0.72, height, distance * 0.72);
    } else if (angle === 'rearLeft') {
      offset.set(-distance * 0.72, height, -distance * 0.72);
    } else if (angle === 'rearRight') {
      offset.set(distance * 0.72, height, -distance * 0.72);
    } else if (angle === 'top') {
      offset.set(0, height, 0.12);
    }

    const desiredPosition = tempVectorC.copy(root.position).add(offset);
    const lookTarget = tempVectorA.copy(root.position);
    lookTarget.y += lookHeight;
    this.camera.position.lerp(desiredPosition, Math.min(1, dt * 14));
    this.camera.lookAt(lookTarget);
  }

  _handleEnemyKilled(enemy, meta) {
    enemy.onDeath(this, meta);
    if (meta.selfDestruct || meta.suppressRewards) {
      return;
    }
    this.player.addExperience(enemy.stats.experience);

    if (!meta.suppressGenericOffense
      && meta.source === this.player
      && this.player.stats.explodeOnKillChance > 0
      && Math.random() < this.player.stats.explodeOnKillChance) {
      this.addExplosion(enemy.root.position, this.player.stats.attackDamage * 1.4, 1.9, 0xff8a42);
    }

    this.refractors.rollEnemyDrop(enemy);
    this.dungeonController?.rollEnemyKeycardDrop?.(enemy);
    this._rollEnemyScrapDrop(enemy);
    this.lootSystem.rollDrop(enemy);
  }

  _prepareEnemyDeathLanding(enemy) {
    if (!enemy?.root) return null;
    const landing = enemy.root.position.clone();
    const surfaceY = this.dungeonController?.getSurfaceElevationAt?.(landing);
    if (Number.isFinite(surfaceY)) landing.y = surfaceY;
    enemy.deathStartPosition?.copy(enemy.root.position);
    enemy.deathLandingPosition = landing.clone();
    enemy.deathDropPosition = landing.clone();
    enemy.deathFloorY = landing.y;
    return landing;
  }

  _prepareExternallyMovedEnemyDeath(enemy, externalMotionOwner = null) {
    if (!enemy?.root) return null;
    let landing = externalMotionOwner?._findTractorReleaseLanding?.(this, enemy)?.position ?? null;
    if (!landing) {
      tempVectorA.copy(enemy.root.position).sub(this.player.root.position).setY(0);
      if (tempVectorA.lengthSq() <= 0.0001) tempVectorA.set(1, 0, 0);
      const resolved = this.dungeonController?.resolvePowerKnockbackLanding?.(
        enemy.root.position,
        tempVectorA,
      );
      landing = resolved?.position?.clone?.() ?? null;
    }
    if (!landing) {
      landing = enemy.root.position.clone();
      landing.y = this.dungeonController?.getSurfaceElevationAt?.(landing) ?? landing.y;
    }

    enemy.deathStartPosition?.copy(enemy.root.position);
    enemy.deathLandingPosition = landing.clone();
    enemy.deathDropPosition = landing.clone();
    enemy.deathFloorY = landing.y;
    return landing;
  }

  _rollEnemyModuleDrops(enemy, { random = Math.random } = {}) {
    if (!enemy?.isProceduralReaverbot || !enemy.genome) return [];

    const drops = rollReaverbotSalvageDrops(enemy.genome, {
      random,
      isElite: enemy.isElite,
      weakPointBroken: enemy.weakPointBroken,
      brokenWeaponModuleId: enemy.brokenWeaponModuleId ?? null,
    });

    enemy.lastSalvageDrops = drops;
    return drops;
  }

  _rollEnemyScrapDrop(enemy, { random = Math.random } = {}) {
    const chance = enemy?.isElite
      ? 0.92
      : ['gorubesshu', 'horokko', 'sharukurusu'].includes(enemy?.typeKey)
        ? 0.58
        : 0.42;

    if (random() > chance) {
      return 0;
    }

    const amount = (enemy?.isElite ? 2 : 1) + (random() < 0.18 ? 1 : 0);
    const recoverableParts = this._rollEnemyModuleDrops(enemy, { random });
    const position = (enemy.deathDropPosition ?? enemy.root.position).clone();
    position.x += (random() - 0.5) * 0.5;
    position.y += 0.34;
    position.z += (random() - 0.5) * 0.5;
    this.lootSystem.createUnidentifiedScrapPickup(amount, position, {
      source: enemy?.genome ? {
        enemyName: enemy.genome.name,
        enemySeed: enemy.genome.seed,
        threatTier: enemy.genome.threatTier ?? 1,
        elite: Boolean(enemy.isElite),
      } : {
        enemyName: enemy?.type?.name ?? enemy?.typeKey ?? 'Reaverbot',
        elite: Boolean(enemy?.isElite),
      },
      recoverableParts: recoverableParts.map((part) => ({
        ...part,
        source: {
          ...part.source,
          enemyName: enemy?.genome?.name ?? enemy?.type?.name ?? enemy?.typeKey ?? 'Reaverbot',
          enemySeed: enemy?.genome?.seed ?? null,
        },
      })),
    });
    return amount;
  }

  _applyEnemyStatusFromHit(enemy, dealt, meta = {}) {
    if (!enemy?.applyStatus) {
      return;
    }

    const sourceIsPlayer = meta.source === this.player;
    const buildup = meta.statusBuildup ?? 1;

    if (meta.element === 'fire') {
      enemy.applyStatus('burning', {
        duration: 2.8,
        dps: Math.max(1.1, dealt * 0.24),
      });
    } else if (meta.element === 'ice') {
      enemy.applyStatus('chill', {
        duration: 2.5,
        slow: 0.38,
        buildup,
        freezeDuration: 0.95,
      });
    } else if (meta.element === 'shock') {
      enemy.applyStatus('shock', {
        duration: 0.28,
        interruptTime: 0.22,
      });

      if (!meta.chained) {
        meta.chainProcessed = true;
        if (Math.random() < (meta.chainChance ?? 0.42)) {
          this._chainLightning(enemy, dealt * (meta.chainDamageMultiplier ?? 0.36));
        }
      }
    } else if (meta.element === 'corrosion') {
      enemy.applyStatus('corrosion', {
        duration: 3.6,
        dps: Math.max(0.8, dealt * 0.18),
        armorReduction: Math.max(5, Math.min(22, dealt * 0.55)),
      });
    }

    const armorBreakChance = sourceIsPlayer ? (meta.armorBreakChance ?? 0) : 0;
    if (armorBreakChance > 0 && Math.random() < armorBreakChance) {
      enemy.applyStatus('armorBreak', {
        duration: 3.2,
        armorReduction: Math.max(8, Math.min(34, dealt * 0.8)),
      });
      this.addHitEffect(enemy.root.position, 0xffd36f, 0.7);
    }

    if ((meta.stagger ?? 0) > 0) {
      enemy.applyStatus('stagger', { duration: meta.stagger });
    }
  }

  _chainLightning(originEnemy, damage) {
    let nearest = null;
    let nearestDistanceSq = 4.8 * 4.8;

    for (const enemy of this.enemies) {
      if (enemy === originEnemy || enemy.dead) {
        continue;
      }

      const distanceSq = enemy.root.position.distanceToSquared(originEnemy.root.position);
      if (distanceSq < nearestDistanceSq) {
        nearestDistanceSq = distanceSq;
        nearest = enemy;
      }
    }

    if (!nearest) {
      return;
    }

    const points = [
      originEnemy.root.position.clone().add(new THREE.Vector3(0, 1.3, 0)),
      nearest.root.position.clone().add(new THREE.Vector3(0, 1.3, 0)),
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: 0x8ee8ff, transparent: true, opacity: 0.85 }),
    );
    line.name = 'chainLightningEffect';
    this.scene.add(line);
    this.timedEffects.push({ object: line, life: 0.16, maxLife: 0.16 });
    nearest.applyStatus?.('shock', { duration: 0.2, interruptTime: 0.12 });
    this.damageEnemy(nearest, damage, {
      source: this.player,
      element: 'shock',
      statusTick: true,
      chained: true,
    });
  }

  _getDamageNumber() {
    const pooled = this.damageNumberPool.pop();
    if (pooled) {
      return pooled;
    }

    const canvas = createDamageCanvas();
    const context = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.name = 'floatingDamageNumber';
    return { sprite, canvas, context, texture, life: 0, maxLife: 0 };
  }

  _getHitEffect() {
    const pooled = this.hitEffectPool.pop();
    if (pooled) {
      return pooled;
    }

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 10, 8),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0.7,
        transparent: true,
        opacity: 0.85,
        roughness: 0.38,
      }),
    );
    mesh.name = 'pooledHitEffect';
    return { mesh, life: 0, maxLife: 0 };
  }

  _getParticle() {
    const pooled = this.particlePool.pop();
    if (pooled) {
      return pooled;
    }

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 6),
      new THREE.MeshBasicMaterial({
        color: 0x9fe8ff,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    );
    mesh.name = 'pooledDissipateParticle';
    return {
      mesh,
      velocity: new THREE.Vector3(),
      gravityScale: 1,
      maxOpacity: 1,
      life: 0,
      maxLife: 0,
    };
  }
}

export default Game;
