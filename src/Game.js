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
import { UIManager } from './UIManager.js';

const POSE_DEBUG_CAMERA_DEFAULT_DISTANCE = 8.3;
const CAMERA_LOOK_OFFSET = new THREE.Vector3(0, 1.1, 0);
const SCRAP_QUEST_BASE_REQUIREMENT = 5;
const SCRAP_QUEST_REWARD = 95;
const RESEARCH_PROCESS_BASE_REQUIREMENT = 3;
const RESEARCH_PROCESS_REWARD = 42;
const POSE_DEBUG_HANDLE_COLOR = 0xffd36f;
const POSE_DEBUG_HANDLE_SELECTED_COLOR = 0xffffff;
const POSE_DEBUG_DRAG_DEGREES_PER_PIXEL = 0.35;
const POSE_DEBUG_CAMERA_MIN_PITCH = 0.18;
const POSE_DEBUG_CAMERA_MAX_PITCH = 1.25;
const POSE_DEBUG_CAMERA_MIN_DISTANCE = 4.5;
const POSE_DEBUG_CAMERA_MAX_DISTANCE = 22;
const HIT_STOP_MAX_DURATION = 0.16;
const HIT_STOP_DEFAULT_TIME_SCALE = 0.06;
const CAMERA_WALL_OCCLUSION_TARGET_HEIGHT = 1.25;

const tempVectorA = new THREE.Vector3();
const tempVectorB = new THREE.Vector3();
const tempVectorC = new THREE.Vector3();
const tempVectorD = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function createDamageCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 80;
  return canvas;
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
    this.hazards = [];
    this.destructibles = [];
    this.timedEffects = [];
    this.damageNumbers = [];
    this.damageNumberPool = [];
    this.hitEffectPool = [];
    this.activeHitEffects = [];
    this.particlePool = [];
    this.activeParticles = [];
    this.elapsedTime = 0;
    this.hitStopTimer = 0;
    this.hitStopTimeScale = 1;
    this.animationPreview = this._readAnimationPreviewFromUrl();
    this.inventoryOpen = false;
    this.poseDebugOpen = false;
    this.isGameOver = false;
    this.ruinFloor = 1;
    this.largeRefractorsSecured = 0;
    this.ruinCompleted = false;
    this.expeditionAccepted = false;
    this.expeditionActive = false;
    this.scrapQuestTurnIns = 0;
    this.arenaRadius = 82;
    this.pointer = {
      x: window.innerWidth * 0.5,
      y: window.innerHeight * 0.5,
      primary: false,
      primaryPressed: false,
      secondary: false,
      secondaryPressed: false,
      alternate: false,
      alternatePressed: false,
      aimWorld: new THREE.Vector3(0, 0, 1),
    };
    this.pointerLocked = false;
    this.bodyFacingAimOverrideFrames = 0;
    this.lockOnMovementForward = new THREE.Vector3(0, 0, 1);
    this.lockOnMovementRight = new THREE.Vector3(1, 0, 0);
    this.lockOnMovementBasis = {
      forward: this.lockOnMovementForward,
      right: this.lockOnMovementRight,
      lockOnTarget: null,
    };
    this.raycaster = new THREE.Raycaster();
    this.cameraOcclusionRaycaster = new THREE.Raycaster();
    this.cameraOcclusionWalls = [];
    this.cameraOcclusionHiddenWalls = new Set();
    this.aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.pointerNdc = new THREE.Vector2();
    this.aimReticle = null;
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

    this._buildWorld();
    this._buildAimReticle();
    this.scene.add(this.poseDebugHandleGroup);

    this.player = new Player();
    this.scene.add(this.player.root);
    if (this.dungeon?.playerStart) {
      this.player.root.position.copy(this.dungeon.playerStart);
    }

    this.inventory = new Inventory(54);
    this.lootSystem = new LootSystem(this.scene);
    this.refractors = new RefractorPickupSystem(this.scene);
    this.projectiles = new ProjectileSystem(this);
    this.combat = new CombatSystem(this);
    this.spawner = new EnemySpawner(this);
    this.ui = new UIManager(this);
    this.dungeonController = new DungeonController(this, this.dungeon);
    this.mapEvents = new MapEventSystem(this);

    this._addStarterItems();
    this.spawner.spawnInitialPack();
    this.ui.renderInventory();
    this._bindEvents();
    this._syncAnimationPreviewDataset();
    this._updateCamera(1);
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

  setInventoryOpen(open) {
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
      this.pointer.alternate = false;
      this.pointer.alternatePressed = false;
    }
    this.ui.setInventoryOpen(open);
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
      this.pointer.alternate = false;
      this.pointer.alternatePressed = false;
      this.keys.clear();
      this._syncPoseDebugCameraFromCurrent();
    } else {
      this._endPoseDebugDrag();
      this.poseDebugCamera.rotating = false;
    }

    this._setPoseDebugHandlesVisible(open);
    this.ui.setPoseDebugOpen(open);
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

    const scrapRequired = this.getScrapQuestRequirement();
    const scraps = this.inventory.scraps ?? 0;
    entries.push({
      id: 'scrapQuest',
      title: 'Reaverbot Scrap Contract',
      status: scraps >= scrapRequired ? 'Ready to turn in' : `${scraps}/${scrapRequired} scraps`,
      detail: `Quest Board reward: ${SCRAP_QUEST_REWARD + this.ruinFloor * 18 + this.scrapQuestTurnIns * 24}z`,
      progress: Math.min(1, scraps / Math.max(1, scrapRequired)),
      color: '#c7d0d6',
    });

    const researchRequired = this.getResearchProcessRequirement();
    entries.push({
      id: 'researchProcessing',
      title: 'Ruin Research Processing',
      status: scraps >= researchRequired ? 'Ready to process' : `${scraps}/${researchRequired} scraps`,
      detail: `Research Data ${this.inventory.researchData ?? 0}`,
      progress: Math.min(1, scraps / Math.max(1, researchRequired)),
      color: '#7df8ff',
    });

    return entries;
  }

  getScrapQuestRequirement() {
    return SCRAP_QUEST_BASE_REQUIREMENT + Math.floor(this.scrapQuestTurnIns * 1.5);
  }

  getResearchProcessRequirement() {
    return RESEARCH_PROCESS_BASE_REQUIREMENT + Math.floor((this.inventory.researchData ?? 0) / 4);
  }

  processResearchScraps() {
    const required = this.getResearchProcessRequirement();
    const current = this.inventory.scraps ?? 0;

    if (current < required) {
      this.ui?.showToast?.(`Research needs ${required} scrap samples`, '#7df8ff');
      return false;
    }

    const reward = RESEARCH_PROCESS_REWARD + this.ruinFloor * 8 + (this.inventory.researchData ?? 0) * 5;
    this.inventory.scraps = current - required;
    this.inventory.researchData = (this.inventory.researchData ?? 0) + 1;
    this.inventory.gold += reward;
    this.ui?.showToast?.(`Research data processed +${reward}z`, '#7df8ff');
    this.ui?.renderInventory?.();
    return true;
  }

  turnInScrapQuest() {
    const required = this.getScrapQuestRequirement();
    const current = this.inventory.scraps ?? 0;

    if (current < required) {
      this.ui?.showToast?.(`Scrap quest: ${current}/${required} Reaverbot scraps`, '#ffd66b');
      return false;
    }

    const reward = SCRAP_QUEST_REWARD + this.ruinFloor * 18 + this.scrapQuestTurnIns * 24;
    this.inventory.scraps = current - required;
    this.inventory.gold += reward;
    this.scrapQuestTurnIns += 1;
    this.ui?.showToast?.(`Scrap quest complete +${reward}z`, '#ffd66b');
    this.ui?.renderInventory?.();
    return true;
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

    this._clearDungeonRunState();

    if (this.dungeon?.group) {
      this.dungeon.group.removeFromParent();
    }

    const dungeon = new DungeonGenerator({ difficulty: this.ruinFloor }).generate();
    this.dungeon = dungeon;
    this.arenaRadius = dungeon.boundsRadius ?? this.arenaRadius;
    this.scene.add(dungeon.group);
    this._collectCameraOcclusionWalls();
    this.dungeonController = new DungeonController(this, dungeon);

    this.player.root.position.copy(dungeon.playerStart);
    this.player.lastMoveDirection.set(0, 0, 1);
    this.player.faceDirection(this.player.lastMoveDirection);
    this.cameraController.snapTo(this.player);

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
    this.inventory.addItem(item);
    this.ui.renderInventory();
    return item;
  }

  damageEnemy(enemy, amount, meta = {}) {
    if (!enemy || enemy.dead) {
      return 0;
    }

    const dealt = enemy.takeDamage(amount, meta);
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
    const hitEffectColor = meta.shieldBlocked ? 0xffd36f : meta.projectileHit ? 0xffffff : color;
    this.addDamageNumber(enemy.root.position, dealt, meta.shieldBlocked ? 0xffd36f : color, meta.critical);

    if (!meta.shieldBlocked) {
      this.addHitEffect(hitPosition, hitEffectColor, meta.critical ? 0.85 : 0.55, {
        absolute: Boolean(meta.hitPosition),
      });
    }

    if (meta.shieldBlocked && dealt > 0) {
      this.addParticleBurst(hitPosition, 0xffd36f, 11, 0.075);
      this.addParticleBurst(hitPosition, 0xffffff, 4, 0.045);
    } else if (meta.projectileHit && dealt > 0) {
      this.addParticleBurst(hitPosition, 0xfff0a3, 9, 0.09);
      this.addParticleBurst(hitPosition, 0xffc533, 5, 0.055);
    }

    if (!meta.statusTick && dealt > 0 && !enemy.dead) {
      this._applyEnemyStatusFromHit(enemy, dealt, meta);
    }

    if (!meta.statusTick && meta.source === this.player && this.player.stats.lifeSteal > 0) {
      this.player.heal(dealt * this.player.stats.lifeSteal);
    }

    if (!meta.statusTick && meta.source === this.player && this.player.stats.chainLightningChance > 0 && Math.random() < this.player.stats.chainLightningChance) {
      this._chainLightning(enemy, dealt * 0.42);
    }

    if (enemy.dead && !enemy.userDataKilled) {
      enemy.userDataKilled = true;
      this._handleEnemyKilled(enemy, meta);
    }

    return dealt;
  }

  addDamageNumber(position, amount, color = 0xffffff, critical = false) {
    const number = this._getDamageNumber();
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
    number.sprite.position.copy(position).add(new THREE.Vector3(0, 2.2, 0));
    number.sprite.scale.set(1.15, 0.48, 1);
    number.sprite.material.opacity = 1;
    number.life = 0.85;
    number.maxLife = 0.85;
    number.sprite.visible = true;
    this.scene.add(number.sprite);
    this.damageNumbers.push(number);
  }

  addHitEffect(position, color = 0xffffff, scale = 0.5, options = {}) {
    const effect = this._getHitEffect();
    effect.mesh.position.copy(position);
    if (!options.absolute) {
      effect.mesh.position.add(new THREE.Vector3(0, 1.05, 0));
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
    glow.position.copy(position);
    glow.position.y = height;
    glow.rotation.x = -Math.PI / 2;
    glow.rotation.z = rotation;
    glow.visible = !delay;
    if (beamBlade) {
      glow.geometry.setDrawRange(0, 0);
    }
    this.scene.add(glow);
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
    core.position.copy(position);
    core.position.y = height + 0.018;
    core.rotation.x = -Math.PI / 2;
    core.rotation.z = rotation;
    core.visible = !delay;
    core.geometry.setDrawRange(0, 0);
    this.scene.add(core);
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
    zone.position.y = 0.035;
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

  addExplosion(position, damage, radius = 2.2, color = 0xffb347, meta = {}) {
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
    wave.position.y = 0.08;
    wave.rotation.x = -Math.PI / 2;
    this.scene.add(wave);
    this.timedEffects.push({ object: wave, life: 0.32, maxLife: 0.32, grow: true });

    if (meta.damageEnemies !== false) {
      for (const enemy of this.enemies) {
        if (enemy.dead) {
          continue;
        }

        if (enemy.root.position.distanceTo(position) <= radius) {
          tempVectorA.copy(enemy.root.position).sub(position).setY(0).normalize();
          const enemyHitStopDuration = meta.enemyHitStopDuration ?? meta.hitStopDuration ?? 0.1;
          const globalHitStopDuration = meta.globalHitStopDuration ?? meta.hitStopDuration ?? 0.1;
          this.damageEnemy(enemy, damage, {
            source: meta.source ?? this.player,
            element: meta.element ?? 'fire',
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
          });
        }
      }
    }

    if ((meta.damagePlayer ?? true) && this.player.root.position.distanceTo(position) <= radius && !this.player.dead) {
      const dealt = this.player.takeDamage(damage * (meta.playerDamageScale ?? 0.35), meta.source ?? null);
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
    for (let i = 0; i < count; i += 1) {
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

    for (let i = 0; i < count; i += 1) {
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
        .addScaledVector(tempVectorB, side * 0.42)
        .add(new THREE.Vector3(0, 0.22 + Math.random() * 0.34, 0));
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

    if (!this.inventoryOpen && !this.poseDebugOpen && !this.isGameOver) {
      this.elapsedTime += gameplayDt;
      if (this.animationPreview?.active) {
        this._updateAnimationPreview(gameplayDt);
      } else {
        this._updateAimFromPointer();
        const movementBasis = this._getPlayerMovementBasis();
        this.player.update(gameplayDt, this.keys, {
          arenaRadius: this.arenaRadius,
          movementForward: movementBasis.forward,
          movementRight: movementBasis.right,
          lockOnTarget: movementBasis.lockOnTarget,
          aimWorld: this.pointer.aimWorld,
          projectileAimInputHeld: Boolean(this.pointer.primary || this.pointer.secondary),
        });
        this.dungeonController.update(gameplayDt);
        this.mapEvents.update(gameplayDt);
        this.spawner.update(gameplayDt);
        this._updateEnemies(gameplayDt);
        this.dungeonController.constrainEnemies();
        this.combat.update(gameplayDt);
        this.projectiles.update(gameplayDt);
        this._updateHazards(gameplayDt);
        this._updateDestructibles(gameplayDt);

        const collected = this.lootSystem.update(gameplayDt, this.player, this.inventory);
        for (const item of collected) {
          this.ui.showLootToast(item);
        }

        if (collected.length > 0) {
          this.ui.renderInventory();
        }

        const collectedRefractors = this.refractors.update(gameplayDt, this.player, this.inventory);
        for (const refractor of collectedRefractors) {
          this.ui.showToast(`${refractor.label} +${refractor.value}z`, refractor.color);
        }

        if (this.player.dead) {
          this.isGameOver = true;
        }
      }
    }

    this._updateDamageNumbers(dt);
    this._updateHitEffects(dt);
    this._updateParticles(dt);
    this._updateTimedEffects(dt);
    if (this.poseDebugOpen) {
      this._updatePoseDebugHandles();
    }
    this._updateCamera(dt);
    this._updateCameraWallOcclusion();
    this.ui.update(dt);
    this.renderer.render(this.scene, this.camera);
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

    this.lockOnMovementForward.copy(lockOnTarget.root.position).sub(this.player.root.position);
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
    this.arenaRadius = dungeon.boundsRadius ?? this.arenaRadius;
    this.scene.add(dungeon.group);
    this._collectCameraOcclusionWalls();

  }

  _clearDungeonRunState() {
    for (const enemy of this.enemies) {
      enemy.root.removeFromParent();
    }
    this.enemies.length = 0;

    this.projectiles?.clear?.();
    this.lootSystem?.clear?.();
    this.refractors?.clear?.();

    for (const hazard of this.hazards) {
      hazard.object?.removeFromParent?.();
    }
    this.hazards.length = 0;

    for (const junk of this.destructibles) {
      junk.root?.removeFromParent?.();
    }
    this.destructibles.length = 0;

    for (const effect of this.timedEffects) {
      effect.object?.removeFromParent?.();
    }
    this.timedEffects.length = 0;

    for (const number of this.damageNumbers) {
      number.sprite?.removeFromParent?.();
    }
    this.damageNumbers.length = 0;

    for (const effect of this.activeHitEffects) {
      effect.mesh.visible = false;
      effect.mesh.removeFromParent();
      this.hitEffectPool.push(effect);
    }
    this.activeHitEffects.length = 0;

    for (const particle of this.activeParticles) {
      particle.mesh.visible = false;
      particle.mesh.removeFromParent();
      this.particlePool.push(particle);
    }
    this.activeParticles.length = 0;
  }

  _buildAimReticle() {
    const material = new THREE.MeshBasicMaterial({
      color: 0x77e8ff,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const reticleMesh = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.25, 32), material);
    reticleMesh.name = 'manualAimReticle';
    reticleMesh.rotation.x = -Math.PI / 2;
    reticleMesh.position.y = 0.055;
    this.scene.add(reticleMesh);
    this.aimReticle = reticleMesh;
  }

  _collectCameraOcclusionWalls() {
    for (const wall of this.cameraOcclusionHiddenWalls) {
      wall.visible = true;
    }

    this.cameraOcclusionHiddenWalls.clear();
    this.cameraOcclusionWalls.length = 0;

    this.dungeon?.group?.traverse?.((object) => {
      if (object.name !== 'dungeonBoundaryWall') {
        return;
      }

      this.cameraOcclusionWalls.push(object);
    });
  }

  _updateCameraWallOcclusion() {
    for (const wall of this.cameraOcclusionHiddenWalls) {
      wall.visible = true;
    }
    this.cameraOcclusionHiddenWalls.clear();

    if (!this.cameraOcclusionWalls.length || !this.player?.root) {
      return;
    }

    tempVectorA.copy(this.player.root.position);
    tempVectorA.y += CAMERA_WALL_OCCLUSION_TARGET_HEIGHT;
    tempVectorB.copy(tempVectorA).sub(this.camera.position);
    const distance = tempVectorB.length();

    if (distance <= 0.001) {
      return;
    }

    tempVectorB.divideScalar(distance);
    this.cameraOcclusionRaycaster.set(this.camera.position, tempVectorB);
    this.cameraOcclusionRaycaster.near = 0.08;
    this.cameraOcclusionRaycaster.far = Math.max(0.08, distance - 0.08);

    const hits = this.cameraOcclusionRaycaster.intersectObjects(this.cameraOcclusionWalls, false);
    for (const hit of hits) {
      hit.object.visible = false;
      this.cameraOcclusionHiddenWalls.add(hit.object);
    }
  }

  _updateAimFromPointer() {
    if (this.bodyFacingAimOverrideFrames > 0 && this._alignAimWorldToTankTurnFacing()) {
      this.bodyFacingAimOverrideFrames -= 1;
      this._updateAimReticleStyle();
      return;
    }

    this.bodyFacingAimOverrideFrames = 0;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((this.pointer.x - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((this.pointer.y - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    if (this.raycaster.ray.intersectPlane(this.aimPlane, this.pointer.aimWorld)) {
      this.aimReticle.position.copy(this.pointer.aimWorld);
      this.aimReticle.position.y = 0.055;
      this._updateAimReticleStyle();
    }
  }

  _updateAimReticleStyle() {
    const weaponHud = this.combat?.getWeaponHudData?.();
    if (!weaponHud || !this.aimReticle) {
      return;
    }

    this.aimReticle.material.color.set(weaponHud.color);
    const readiness = Math.min(weaponHud.energyPercent, weaponHud.outputPercent ?? 1);
    this.aimReticle.material.opacity = readiness <= 0.2 ? 0.48 : 0.78;

    const scale = weaponHud.mode === 'Trap' || weaponHud.mode === 'Arc'
      ? 1.32
      : weaponHud.mode === 'Beam' || weaponHud.mode === 'Pierce'
        ? 0.9
        : weaponHud.mode.includes('Cone')
          ? 1.16
        : 1;
    this.aimReticle.scale.lerp(tempVectorA.set(scale, scale, scale), 0.22);
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
        if (this._alignAimWorldToTankTurnFacing()) {
          this.bodyFacingAimOverrideFrames = 2;
        }
        this.cameraController?.swingBehindPlayer?.(this.player);
      }
      return true;
    }

    return false;
  }

  _alignAimWorldToTankTurnFacing() {
    const player = this.player;
    const lockedTarget = this.combat?.getMovementLockTarget?.() ?? null;

    if (!player?.root
      || lockedTarget?.root
      || !player.tankTurnActive
      || player.tankTurnTranslating) {
      return false;
    }

    const range = Math.max(2, player.stats?.attackRange ?? 6.2);
    tempVectorA.set(Math.sin(player.root.rotation.y), 0, Math.cos(player.root.rotation.y));

    if (tempVectorA.lengthSq() <= 0.0001) {
      return false;
    }

    tempVectorA.normalize();
    this.pointer.aimWorld.copy(player.root.position).addScaledVector(tempVectorA, range);
    this.pointer.aimWorld.y = 0;

    if (this.aimReticle) {
      this.aimReticle.position.copy(this.pointer.aimWorld);
      this.aimReticle.position.y = 0.055;
    }

    return true;
  }

  _bindEvents() {
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Backquote') {
        event.preventDefault();
        this.setPoseDebugOpen(!this.poseDebugOpen);
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

      if (!this.inventoryOpen && !this.poseDebugOpen && !event.repeat && event.code === 'Space') {
        event.preventDefault();
        const movementBasis = this._getPlayerMovementBasis();

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
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;

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
    this.inventory.addItem(this.lootSystem.generateItem(1, { type: 'powerRaiser', rarity: 'standard' }));
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
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      enemy.update(dt, this);

      if (enemy.dead && enemy.deathTimer <= 0) {
        enemy.root.removeFromParent();
        this.enemies.splice(i, 1);
      }
    }
  }

  _updateHazards(dt) {
    for (let i = this.hazards.length - 1; i >= 0; i -= 1) {
      const hazard = this.hazards[i];
      hazard.duration -= dt;
      hazard.object.material.opacity = Math.max(0, Math.min(0.32, hazard.duration / Math.max(0.001, hazard.maxDuration ?? 2.4) * 0.32));
      hazard.object.rotation.z += dt * 0.6;

      if (hazard.target === 'enemies') {
        hazard.tickTimer -= dt;
        if (hazard.tickTimer <= 0) {
          const tickInterval = 0.25;
          hazard.tickTimer = tickInterval;

          for (const enemy of this.enemies) {
            if (enemy.dead || enemy.root.position.distanceTo(hazard.object.position) > hazard.radius + enemy.radius) {
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
        this.damageNumberPool.push(number);
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
        this.hitEffectPool.push(effect);
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
        this.particlePool.push(particle);
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

      if (effect.sweepDraw && effect.object.geometry) {
        const drawCount = effect.object.geometry.index?.count ?? effect.object.geometry.attributes.position?.count ?? 0;
        effect.object.geometry.setDrawRange(0, Math.max(0, Math.floor(drawCount * reveal)));
      }

      if (effect.object.material) {
        effect.object.material.opacity = progress * (effect.opacity ?? 0.52) * (effect.sweepDraw ? Math.max(0.35, reveal) : 1);
      }

      if (effect.grow) {
        effect.object.scale.multiplyScalar(1 + dt * 2.2);
      }

      if (effect.life <= 0) {
        effect.object.removeFromParent();
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
    enemy.onDeath(this);
    this.player.addExperience(enemy.stats.experience);

    if (meta.source === this.player && this.player.stats.explodeOnKillChance > 0 && Math.random() < this.player.stats.explodeOnKillChance) {
      this.addExplosion(enemy.root.position, this.player.stats.attackDamage * 1.4, 1.9, 0xff8a42);
    }

    this.refractors.rollEnemyDrop(enemy);
    this.dungeonController?.rollEnemyKeycardDrop?.(enemy);
    this._rollEnemyScrapDrop(enemy);
    this.lootSystem.rollDrop(enemy);
  }

  _rollEnemyScrapDrop(enemy) {
    const chance = enemy?.isElite ? 0.92 : enemy?.typeKey === 'gorubesshu' || enemy?.typeKey === 'horokko' ? 0.58 : 0.42;

    if (Math.random() > chance) {
      return 0;
    }

    const amount = (enemy?.isElite ? 2 : 1) + (Math.random() < 0.18 ? 1 : 0);
    this.inventory.scraps = (this.inventory.scraps ?? 0) + amount;
    tempVectorA.copy(enemy.root.position);
    tempVectorA.y = 0.7;
    this.addParticleBurst(tempVectorA, 0x9aa7ad, 10 + amount * 4, 0.11);
    this.ui?.showToast?.(`Reaverbot Scrap +${amount}`, '#c7d0d6');
    this.ui?.renderInventory?.();
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

      if (!meta.chained && Math.random() < (meta.chainChance ?? 0.42)) {
        this._chainLightning(enemy, dealt * (meta.chainDamageMultiplier ?? 0.36));
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
