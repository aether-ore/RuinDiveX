import * as THREE from 'three';
import { EQUIPMENT_SLOTS } from './EquipmentManager.js';
import { formatStatValue, RARITIES, STAT_LABELS } from './Item.js';

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function slotLabel(slot) {
  return {
    weapon: 'Arm Weapon',
    offhand: 'Shield / Utility Arm',
    head: 'Sensor Gear',
    chest: 'Armor Frame',
    hands: 'Buster Parts',
    feet: 'Mobility Gear',
    module: 'Utility Module',
    module1: 'Utility Module I',
    module2: 'Utility Module II',
    core: 'Refractor Core',
    back: 'Back Mount',
  }[slot] ?? slot;
}

function isArmWeapon(item) {
  return item?.slot === 'weapon' && item?.category === 'Arm Weapon';
}

function isBusterArm(item) {
  return isArmWeapon(item) && item?.type === 'busterArm';
}

function isUtilityArm(item) {
  return isArmWeapon(item) && (item?.type === 'liftArm' || item?.tags?.includes('utility'));
}

function isCombatArm(item) {
  return isArmWeapon(item) && !isBusterArm(item) && !isUtilityArm(item);
}

function isBusterUpgrade(item) {
  return item?.category === 'Buster Part';
}

function getItemPower(item) {
  return item?.getPowerScore?.() ?? 0;
}

function compareByPower(a, b) {
  const powerDiff = getItemPower(b) - getItemPower(a);
  if (powerDiff !== 0) return powerDiff;

  const levelDiff = (b?.level ?? 0) - (a?.level ?? 0);
  if (levelDiff !== 0) return levelDiff;

  return (b?.value ?? 0) - (a?.value ?? 0);
}

const OUTPUT_BEHAVIOR_LINES = {
  busterArm: 'Output: buster shots are unlimited, but Energy sets how many rapid shots fit in one burst.',
  liftArm: 'Output: lifting Junk is free; holding small Reaverbots drains Lift Output until they break free.',
  machineGunArm: 'Output: rapid fire spends small chunks; low Output widens spread and slows effective fire.',
  cannonArm: 'Output: heavy shells drain nearly all Chamber Output before it rebuilds.',
  mineArm: 'Output: mine placement spends Arming Output, limiting rapid trap stacking.',
  missileArm: 'Output: missiles spend Lock Stability, and salvos demand a large stable charge.',
  grenadeArm: 'Output: each lob spends a heavy chunk of Throw Output.',
  railBusterArm: 'Output: rail shots consume Capacitor Output before the next full-power line.',
  scatterBusterArm: 'Output: spread bursts spend modest Output; low Output makes the burst less controlled.',
  homingSeekerArm: 'Output: seeker rounds spend Tracking Output and lock quality weakens when low.',
  laserArm: 'Output: held beams drain Beam Stability very quickly and vent at empty.',
  flameArm: 'Output: pressure drains while held; low pressure reduces cone range, force, and buildup.',
  iceSprayerArm: 'Output: pressure drains while held; low pressure weakens icy gas range, damage, and freeze buildup.',
  shockCoilArm: 'Output: chain shots spend Coil Output before the next stable discharge.',
  swordArm: 'Output: beam-blade slashes spend Servo Output, so heavy swings cannot be spammed.',
  drillArm: 'Output: held drilling drains Torque Output rapidly and does not recover until released; Z fires the drill head.',
};

const POSE_DEBUG_JOINTS = [
  ['hips', 'Hips'],
  ['spine', 'Spine'],
  ['neck', 'Neck'],
  ['leftShoulder', 'Left shoulder'],
  ['leftElbow', 'Left elbow'],
  ['leftWrist', 'Left wrist'],
  ['rightShoulder', 'Right shoulder'],
  ['rightElbow', 'Right elbow'],
  ['rightWrist', 'Right wrist'],
  ['leftHip', 'Left hip'],
  ['leftKnee', 'Left knee'],
  ['leftAnkle', 'Left ankle'],
  ['rightHip', 'Right hip'],
  ['rightKnee', 'Right knee'],
  ['rightAnkle', 'Right ankle'],
].map(([name, label]) => ({ name, label }));

const POSE_AXES = ['x', 'y', 'z'];
const POSE_DEBUG_CURRENT_ANIMATION_ID = 'currentPose';
const POSE_DEBUG_CURRENT_KEYFRAME_ID = 'capturedPose';
const POSE_AXIS_LABELS = {
  x: 'Local X',
  y: 'Local Y',
  z: 'Local Z',
};

const POSE_SEMANTIC_AXIS_LABELS = {
  leftShoulder: {
    x: 'Local X / Arm Twist',
    y: 'Local Y / Arm Forward/Back',
    z: 'Local Z / Arm Raise',
  },
  rightShoulder: {
    x: 'Local X / Arm Twist',
    y: 'Local Y / Arm Forward/Back',
    z: 'Local Z / Arm Raise',
  },
  leftElbow: {
    x: 'Local X / Forearm Twist',
    y: 'Local Y / Elbow Depth',
    z: 'Local Z / Elbow Bend',
  },
  rightElbow: {
    x: 'Local X / Forearm Twist',
    y: 'Local Y / Elbow Depth',
    z: 'Local Z / Elbow Bend',
  },
  leftWrist: {
    x: 'Local X / Wrist Aim',
    y: 'Local Y / Wrist Yaw',
    z: 'Local Z / Wrist Roll',
  },
  rightWrist: {
    x: 'Local X / Wrist Aim',
    y: 'Local Y / Wrist Yaw',
    z: 'Local Z / Wrist Roll',
  },
  leftHip: {
    x: 'Local X / Hip Pitch',
    y: 'Local Y / Hip Yaw',
    z: 'Local Z / Hip Roll',
  },
  rightHip: {
    x: 'Local X / Hip Pitch',
    y: 'Local Y / Hip Yaw',
    z: 'Local Z / Hip Roll',
  },
  leftKnee: {
    x: 'Local X / Knee Bend',
    y: 'Local Y / Knee Yaw',
    z: 'Local Z / Knee Roll',
  },
  rightKnee: {
    x: 'Local X / Knee Bend',
    y: 'Local Y / Knee Yaw',
    z: 'Local Z / Knee Roll',
  },
  leftAnkle: {
    x: 'Local X / Ankle Pitch',
    y: 'Local Y / Ankle Yaw',
    z: 'Local Z / Ankle Roll',
  },
  rightAnkle: {
    x: 'Local X / Ankle Pitch',
    y: 'Local Y / Ankle Yaw',
    z: 'Local Z / Ankle Roll',
  },
};

const POSE_HELPER_NOTES = {
  leftShoulder: 'Arm side lift/drop is mostly local Z. Positive semantic armRaise maps to negative local Z on this side.',
  rightShoulder: 'Arm side lift/drop is mostly local Z. Positive semantic armRaise maps to positive local Z on this side.',
  leftElbow: 'Visible elbow bend is mostly local Z. Positive semantic elbowBend maps to negative local Z on this side.',
  rightElbow: 'Visible elbow bend is mostly local Z. Positive semantic elbowBend maps to positive local Z on this side.',
  leftHip: 'Hip and knee local X behaved predictably in testing and can be treated as pitch for most leg poses.',
  rightHip: 'Hip and knee local X behaved predictably in testing and can be treated as pitch for most leg poses.',
  leftKnee: 'Knee bend is primarily local X/pitch.',
  rightKnee: 'Knee bend is primarily local X/pitch.',
};

const WEAPON_MODE_SHAPES = new Set([
  'arc',
  'beam',
  'blade',
  'chain',
  'cluster',
  'cone',
  'contact',
  'detonate',
  'explosive',
  'lock',
  'manual',
  'pierce',
  'salvo',
  'seeker',
  'spread',
  'trap',
  'utility',
]);

function degreesToRadians(value) {
  return THREE.MathUtils.degToRad(Number(value) || 0);
}

function radiansToDegrees(value) {
  return Number(THREE.MathUtils.radToDeg(value).toFixed(1));
}

function formatPoseDegrees(value) {
  const number = Number(value) || 0;
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function normalizePoseDegrees(poseDegrees = {}) {
  const normalized = {};

  for (const { name } of POSE_DEBUG_JOINTS) {
    const joint = poseDegrees[name] ?? {};
    normalized[name] = {
      pitch: Number(joint.pitch ?? joint.x ?? 0) || 0,
      yaw: Number(joint.yaw ?? joint.y ?? 0) || 0,
      roll: Number(joint.roll ?? joint.z ?? 0) || 0,
    };
  }

  return normalized;
}

function clonePoseDegrees(poseDegrees = {}) {
  return normalizePoseDegrees(poseDegrees);
}

function createPoseValueMap(poseDegrees = {}) {
  const normalized = normalizePoseDegrees(poseDegrees);
  return new Map(POSE_DEBUG_JOINTS.map(({ name }) => {
    const joint = normalized[name] ?? { pitch: 0, yaw: 0, roll: 0 };
    return [name, { x: joint.pitch, y: joint.yaw, z: joint.roll }];
  }));
}

function getPoseAxisLabel(jointName, axis) {
  return POSE_SEMANTIC_AXIS_LABELS[jointName]?.[axis] ?? POSE_AXIS_LABELS[axis] ?? axis;
}

const POSE_DEBUG_ANIMATION_PRESETS = [
  {
    id: 'walkCycle',
    label: 'Walk Cycle',
    keyframes: [
      {
        id: 'rightKneeUp',
        label: 'Right knee up',
        frame: 0,
        poseDegrees: normalizePoseDegrees({
          rightHip: { pitch: -38, yaw: 0, roll: -4 },
          rightKnee: { pitch: 89.25, yaw: 13.3, roll: -22 },
          rightAnkle: { pitch: -4.9, yaw: -22.55, roll: -4 },
          leftHip: { pitch: 2, yaw: 0, roll: 3 },
          leftKnee: { pitch: 8, yaw: 0, roll: 0 },
          leftAnkle: { pitch: 2, yaw: 0, roll: 0 },
        }),
      },
      {
        id: 'rightFootDown',
        label: 'Right foot down',
        frame: 6,
        poseDegrees: normalizePoseDegrees({
          rightHip: { pitch: -8, yaw: 0, roll: -2 },
          rightKnee: { pitch: 18, yaw: 0, roll: -4 },
          rightAnkle: { pitch: 0, yaw: 0, roll: -1 },
          leftHip: { pitch: 0, yaw: 0, roll: 2 },
          leftKnee: { pitch: 10, yaw: 0, roll: 0 },
        }),
      },
      {
        id: 'leftKneeUp',
        label: 'Left knee up',
        frame: 12,
        poseDegrees: normalizePoseDegrees({
          leftHip: { pitch: -38, yaw: 0, roll: 4 },
          leftKnee: { pitch: 89.25, yaw: -13.3, roll: 22 },
          leftAnkle: { pitch: -4.9, yaw: 22.55, roll: 4 },
          rightHip: { pitch: 2, yaw: 0, roll: -3 },
          rightKnee: { pitch: 8, yaw: 0, roll: 0 },
          rightAnkle: { pitch: 2, yaw: 0, roll: 0 },
        }),
      },
      {
        id: 'leftFootDown',
        label: 'Left foot down',
        frame: 18,
        poseDegrees: normalizePoseDegrees({
          leftHip: { pitch: -8, yaw: 0, roll: 2 },
          leftKnee: { pitch: 18, yaw: 0, roll: 4 },
          leftAnkle: { pitch: 0, yaw: 0, roll: 1 },
          rightHip: { pitch: 0, yaw: 0, roll: -2 },
          rightKnee: { pitch: 10, yaw: 0, roll: 0 },
        }),
      },
    ],
  },
  {
    id: 'busterAim',
    label: 'Buster Aim',
    keyframes: [
      {
        id: 'brace',
        label: 'Brace',
        frame: 0,
        poseDegrees: normalizePoseDegrees({
          spine: { pitch: -4, yaw: 6, roll: -2 },
          rightShoulder: { pitch: -3, yaw: 90, roll: 2 },
          rightElbow: { pitch: 1, yaw: 0, roll: 0 },
          leftShoulder: { pitch: 3, yaw: -78, roll: -49 },
          leftElbow: { pitch: 10, yaw: -68, roll: 53 },
          leftHip: { pitch: -8, yaw: 0, roll: 10 },
          rightHip: { pitch: -8, yaw: 0, roll: -10 },
          leftKnee: { pitch: 16, yaw: 0, roll: 0 },
          rightKnee: { pitch: 16, yaw: 0, roll: 0 },
        }),
      },
      {
        id: 'fireHold',
        label: 'Fire hold',
        frame: 6,
        poseDegrees: normalizePoseDegrees({
          spine: { pitch: -5, yaw: 8, roll: -3 },
          rightShoulder: { pitch: -4, yaw: 92, roll: 3 },
          leftShoulder: { pitch: 4, yaw: -80, roll: -52 },
          leftElbow: { pitch: 14, yaw: -72, roll: 58 },
          leftWrist: { pitch: -12, yaw: -10, roll: -22 },
          leftKnee: { pitch: 18, yaw: 0, roll: 0 },
          rightKnee: { pitch: 18, yaw: 0, roll: 0 },
        }),
      },
    ],
  },
  {
    id: 'beamBladeSlash',
    label: 'Beam Blade Slash',
    keyframes: [
      {
        id: 'chamber',
        label: 'Chamber',
        frame: 0,
        poseDegrees: normalizePoseDegrees({
          spine: { pitch: -4, yaw: 2, roll: -2 },
          leftShoulder: { pitch: 8, yaw: 14, roll: -55 },
          leftElbow: { pitch: 11, yaw: -72, roll: 7 },
          rightShoulder: { pitch: -2, yaw: 78, roll: -5 },
          rightElbow: { pitch: 19, yaw: 107, roll: -31 },
          leftHip: { pitch: -45, yaw: -5, roll: -7 },
          leftKnee: { pitch: 62, yaw: -5, roll: -2 },
          leftAnkle: { pitch: -14, yaw: 11, roll: 2 },
          rightHip: { pitch: 14, yaw: -42, roll: -2 },
          rightKnee: { pitch: 0, yaw: -4, roll: 0 },
        }),
      },
      {
        id: 'activeSlash',
        label: 'Active slash',
        frame: 12,
        poseDegrees: normalizePoseDegrees({
          hips: { pitch: -2, yaw: -18, roll: -2 },
          spine: { pitch: -8, yaw: -34, roll: -5 },
          rightShoulder: { pitch: -9, yaw: -54, roll: 8 },
          rightElbow: { pitch: 10, yaw: 10, roll: -4 },
          rightWrist: { pitch: -5, yaw: 28, roll: 12 },
          leftHip: { pitch: -33, yaw: -2, roll: 12 },
          leftKnee: { pitch: 66, yaw: -2, roll: 0 },
          rightHip: { pitch: 6, yaw: -12, roll: -14 },
          rightKnee: { pitch: 22, yaw: 0, roll: 0 },
        }),
      },
    ],
  },
];

function itemFitsSlot(item, slot) {
  if (!item) {
    return false;
  }

  if (slot === 'module1' || slot === 'module2') {
    return item.slot === 'module';
  }

  if (slot === 'hands' && isBusterUpgrade(item)) {
    return false;
  }

  return item.slot === slot;
}

export class UIManager {
  constructor(game) {
    this.game = game;
    this.selectedItemId = null;
    this.root = document.getElementById('ui-root');
    this.healthGauge = document.getElementById('health-gauge');
    this.healthFill = document.getElementById('health-fill');
    this.healthText = document.getElementById('health-text');
    this.timeValue = document.getElementById('time-value');
    this.enemyCount = document.getElementById('enemy-count');
    this.floorValue = document.getElementById('floor-value');
    this.keycardValue = document.getElementById('keycard-value');
    this.objectiveValue = document.getElementById('objective-value');
    this.minimap = document.getElementById('dungeon-minimap');
    this.minimapZoom = 1;
    this.minimapMinZoom = 1;
    this.minimapMaxZoom = 4;
    this.minimapZoomStep = 0.25;
    this.levelValue = document.getElementById('level-value');
    this.weaponValue = document.getElementById('weapon-value');
    this.weaponGauge = document.getElementById('weapon-gauge');
    this.energyValue = document.getElementById('energy-value');
    this.weaponEnergyFill = document.getElementById('weapon-energy-fill');
    this.weaponOutputFill = document.getElementById('weapon-output-fill');
    this.weaponEnergyTrack = this.weaponEnergyFill?.parentElement ?? null;
    this.weaponOutputTrack = this.weaponOutputFill?.parentElement ?? null;
    this.weaponModeNode = document.getElementById('weapon-mode-node');
    this.weaponModeMark = document.getElementById('weapon-mode-mark');
    this.weaponStatus = document.getElementById('weapon-status');
    this.weaponStats = document.getElementById('weapon-stats');
    this.armHotbar = document.getElementById('arm-hotbar');
    this.goldValue = document.getElementById('gold-value');
    this.unidentifiedScrapValue = document.getElementById('unidentified-scrap-value');
    this.inventoryPanel = document.getElementById('inventory-panel');
    this.inventoryPanelTitle = document.getElementById('inventory-panel-title');
    this.inventoryActions = document.getElementById('inventory-actions');
    this.materialInventory = document.getElementById('material-inventory');
    this.rollScrapService = document.getElementById('roll-scrap-service');
    this.rollUnidentifiedValue = document.getElementById('roll-unidentified-value');
    this.rollIdentifiedValue = document.getElementById('roll-identified-value');
    this.rollPartsValue = document.getElementById('roll-parts-value');
    this.rollIdentifyButton = document.getElementById('roll-identify-scrap');
    this.rollIdentificationResult = document.getElementById('roll-identification-result');
    this.rollWorkshopTabs = document.getElementById('roll-workshop-tabs');
    this.rollSalvageView = document.getElementById('roll-salvage-view');
    this.busterLabView = document.getElementById('buster-lab-view');
    this.busterLabWarning = document.getElementById('buster-lab-warning');
    this.busterLabPersistence = document.getElementById('buster-lab-persistence');
    this.busterStorageStatus = document.getElementById('buster-storage-status');
    this.busterStorageMode = document.getElementById('buster-storage-mode');
    this.busterStorageContext = document.getElementById('buster-storage-context');
    this.busterStorageReload = document.getElementById('buster-storage-reload');
    this.busterAdoptV1 = document.getElementById('buster-adopt-v1');
    this.busterBlueprintImportFile = document.getElementById('buster-blueprint-import-file');
    this.busterBuyChassisButton = document.getElementById('buster-buy-chassis');
    this.busterMegaPanel = document.getElementById('buster-mega-panel');
    this.busterMegaCalibrations = document.getElementById('buster-mega-calibrations');
    this.busterCustomEditor = document.getElementById('buster-custom-editor');
    this.busterTuningRemaining = document.getElementById('buster-tuning-remaining');
    this.busterProgramCapacity = document.getElementById('buster-program-capacity');
    this.busterCompilerResult = document.getElementById('buster-compiler-result');
    this.busterValidationErrors = document.getElementById('buster-validation-errors');
    this.busterModuleInventory = document.getElementById('buster-module-inventory');
    this.busterRecipeList = document.getElementById('buster-recipe-list');
    this.busterRecipeScrap = document.getElementById('buster-recipe-scrap');
    this.busterBlueprintPanel = document.getElementById('buster-blueprint-panel');
    this.busterBlueprintSelect = document.getElementById('buster-blueprint-select');
    this.busterBlueprintCount = document.getElementById('buster-blueprint-count');
    this.busterBlueprintStatus = document.getElementById('buster-blueprint-status');
    this.busterMaterializationSuggestion = document.getElementById('buster-materialization-suggestion');
    this.busterMaterializeConfirm = document.getElementById('buster-materialize-confirm');
    this.busterMaterializeTarget = document.getElementById('buster-materialize-target');
    this.busterTestSandboxButton = document.getElementById('buster-test-sandbox');
    this.busterBenchmarkPanel = document.getElementById('buster-benchmark-panel');
    this.busterBenchmarkStatus = document.getElementById('buster-benchmark-status');
    this.busterBenchmarkMetrics = document.getElementById('buster-benchmark-metrics');
    this.inventoryItems = document.getElementById('inventory-items');
    this.equipmentSlots = document.getElementById('equipment-slots');
    this.garageWeaponSlots = document.getElementById('garage-weapon-slots');
    this.questLog = document.getElementById('quest-log');
    this.tooltip = document.getElementById('item-tooltip');
    this.poseDebugPanel = document.getElementById('pose-debug-panel');
    this.busterDebugTabButton = document.getElementById('buster-debug-tab');
    this.busterDebugGrantButton = document.getElementById('buster-debug-grant');
    this.busterDebugStatus = document.getElementById('buster-debug-status');
    this.busterDebugBuildSelect = document.getElementById('buster-debug-build');
    this.busterDebugTargetSelect = document.getElementById('buster-debug-targets');
    this.busterDebugProfileSelect = document.getElementById('buster-debug-profile');
    this.busterDebugDepthSelect = document.getElementById('buster-debug-depth');
    this.busterDebugRangeButton = document.getElementById('buster-debug-range');
    this.busterDebugSandboxButton = document.getElementById('buster-debug-sandbox');
    this.busterDebugOpenLabButton = document.getElementById('buster-debug-open-lab');
    this.busterDebugRefillButton = document.getElementById('buster-debug-refill');
    this.busterDebugTestStatus = document.getElementById('buster-debug-test-status');
    this.poseDebugAnimationSelect = document.getElementById('pose-debug-animation');
    this.poseDebugKeyframeSelect = document.getElementById('pose-debug-keyframe');
    this.poseDebugControls = document.getElementById('pose-debug-controls');
    this.poseDebugOutput = document.getElementById('pose-debug-output');
    this.poseDebugStatus = document.getElementById('pose-debug-status');
    this.platformDebugView = document.getElementById('platform-debug-view');
    this.platformDebugJumpHeight = document.getElementById('platform-debug-jump-height');
    this.platformDebugGravity = document.getElementById('platform-debug-gravity');
    this.platformDebugApex = document.getElementById('platform-debug-apex');
    this.platformDebugApexTime = document.getElementById('platform-debug-apex-time');
    this.platformDebugGrabMin = document.getElementById('platform-debug-grab-min');
    this.platformDebugWidth = document.getElementById('platform-debug-width');
    this.platformDebugDepth = document.getElementById('platform-debug-depth');
    this.platformDebugHeight = document.getElementById('platform-debug-height');
    this.platformDebugDistance = document.getElementById('platform-debug-distance');
    this.platformDebugCount = document.getElementById('platform-debug-count');
    this.toast = document.getElementById('loot-toast');
    this.eventPrompt = document.getElementById('event-prompt');
    this.buffTray = document.getElementById('buff-tray');
    this.gameOver = document.getElementById('game-over');
    this.inventoryButton = document.getElementById('inventory-button');
    this.restartButton = document.getElementById('restart-button');
    this.toastTimer = 0;
    this.inventoryMode = 'garage';
    this.rollWorkshopTab = 'salvage';
    this.busterLabSelectedBuildId = 'build-a';
    this.busterLabSelectedBlueprintId = null;
    this.busterLabReadOnly = false;
    this.pendingBusterMaterialization = null;
    this.busterLabActionQueue = Promise.resolve();
    this.lastScrapIdentification = null;
    this.previousHealth = null;
    this.healthDamagePulseTimer = 0;
    this.poseDebugOpen = false;
    this.poseDebugTab = this.game.busterLabDebugEnabled ? 'buster' : 'pose';
    this.busterDebugSelectedBuildId = 'build-a';
    this.poseDebugControlsRendered = false;
    this.poseDebugFocusedJointName = null;
    this.poseDebugPresetAnimations = this._createPoseDebugAnimations();
    this.poseDebugAnimations = this._createPoseDebugAnimations();
    this.poseDebugAnimationId = this.poseDebugAnimations[0]?.id ?? '';
    this.poseDebugKeyframeId = this.poseDebugAnimations[0]?.keyframes[0]?.id ?? '';
    this.poseDebugValues = createPoseValueMap(this._getActivePoseKeyframe()?.poseDegrees);

    this._bindEvents();
    this.renderInventory();
  }

  update(dt) {
    const player = this.game.player;
    const healthPercent = Math.max(0, player.health / player.stats.maxHealth);
    if (this.previousHealth !== null && player.health < this.previousHealth) {
      this.healthDamagePulseTimer = 0.36;
    }

    this.previousHealth = player.health;
    this.healthDamagePulseTimer = Math.max(0, this.healthDamagePulseTimer - dt);

    this.healthFill.style.height = `${healthPercent * 100}%`;
    this.healthText.textContent = `${Math.ceil(player.health)} / ${Math.ceil(player.stats.maxHealth)}`;
    this.healthGauge?.classList.toggle('is-warning', healthPercent <= 0.25);
    this.healthGauge?.classList.toggle('is-damaged', this.healthDamagePulseTimer > 0);
    this.healthGauge?.classList.toggle(
      'is-power-knockback',
      player.isPowerKnockbackActive?.() === true,
    );
    this.timeValue.textContent = formatTime(this.game.elapsedTime);
    this.enemyCount.textContent = String(this.game.enemies.filter((enemy) => !enemy.dead).length);
    if (this.floorValue) {
      this.floorValue.textContent = String(this.game.ruinFloor ?? 1);
    }
    if (this.keycardValue) {
      this.keycardValue.textContent = this.game.dungeonController?.getKeycardHudLabel?.()
        ?? String(this.game.dungeonController?.keycardCount ?? 0);
    }
    if (this.objectiveValue) {
      this.objectiveValue.textContent = this.game.getObjectiveText?.() ?? 'Explore ruin';
    }
    this.levelValue.textContent = String(player.level);
    const weaponHud = this.game.combat?.getWeaponHudData?.() ?? null;
    if (this.weaponValue) {
      this.weaponValue.textContent = weaponHud?.name ?? player.equipment.getSummary();
    }
    this._renderWeaponTelemetry(weaponHud);
    this.goldValue.textContent = String(this.game.inventory.gold);
    if (this.unidentifiedScrapValue) {
      this.unidentifiedScrapValue.textContent = String(this.game.inventory.unidentifiedScrap ?? 0);
    }
    this._renderArmHotbar(weaponHud?.tabs);
    this._renderMinimap();
    this._renderMapEventPrompt();
    this._renderBuffTray();
    if (this.poseDebugOpen && this.poseDebugTab === 'pose') {
      this._syncPoseDebugRigState();
    } else if (this.poseDebugOpen && this.poseDebugTab === 'platforming') {
      this._syncPlatformDebugControls();
    } else if (this.poseDebugOpen && this.poseDebugTab === 'buster') {
      this._syncBusterDebugControls();
    }

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) {
        this.toast.classList.remove('is-visible');
      }
    }

    this.gameOver.hidden = !this.game.isGameOver;
  }

  setInventoryOpen(open, { mode = 'garage' } = {}) {
    this.inventoryMode = open && mode === 'roll' ? 'roll' : 'garage';
    this.root?.classList.toggle('is-inventory-open', open);
    this.root?.classList.toggle('is-roll-workshop', open && this.inventoryMode === 'roll');
    this.root?.classList.toggle(
      'is-buster-lab',
      open && this.inventoryMode === 'roll' && this.rollWorkshopTab === 'buster',
    );
    this.inventoryPanel.hidden = !open;
    this.inventoryPanel.dataset.mode = this.inventoryMode;
    if (this.inventoryPanelTitle) {
      this.inventoryPanelTitle.textContent = this.inventoryMode === 'roll'
        ? "Roll's Workshop"
        : 'Garage Loadout';
    }
    if (this.rollScrapService) {
      this.rollScrapService.hidden = this.inventoryMode !== 'roll';
    }
    if (this.rollWorkshopTabs) {
      this.rollWorkshopTabs.hidden = !this.game.busterLabEnabled;
    }
    this.inventoryButton?.setAttribute('aria-pressed', String(open));

    if (open) {
      this._selectRollWorkshopTab(this.game.busterLabEnabled ? this.rollWorkshopTab : 'salvage', { render: false });
      this.renderInventory();
    } else {
      this.hideTooltip();
    }
  }

  setPoseDebugOpen(open) {
    this.poseDebugOpen = open;
    this.root?.classList.toggle('is-pose-debug-open', open);

    if (this.poseDebugPanel) {
      this.poseDebugPanel.hidden = !open;
    }
    if (this.busterDebugTabButton) {
      this.busterDebugTabButton.hidden = !this.game.busterLabDebugEnabled;
    }

    if (open) {
      this._captureCurrentPoseDebugPose();
      this._renderPoseDebugTimeline();
      this._renderPoseDebugControls();
      this._syncAllPoseDebugControls();
      this._renderPoseDebugPrompt();
      this._selectPoseDebugTab(this.poseDebugTab);
    } else {
      this.game.player.externalRig?.setDebugPoseEnabled?.(false);
    }
  }

  _selectPoseDebugTab(tab = 'pose') {
    this.poseDebugTab = tab === 'platforming'
      ? 'platforming'
      : tab === 'buster' && this.game.busterLabEnabled
        ? 'buster'
        : 'pose';
    for (const button of this.poseDebugPanel?.querySelectorAll('[data-debug-tab]') ?? []) {
      button.setAttribute('aria-selected', String(button.dataset.debugTab === this.poseDebugTab));
    }
    for (const view of this.poseDebugPanel?.querySelectorAll('[data-debug-view]') ?? []) {
      view.hidden = view.dataset.debugView !== this.poseDebugTab;
    }
    for (const control of this.poseDebugPanel?.querySelectorAll('[data-pose-only]') ?? []) {
      control.hidden = this.poseDebugTab !== 'pose';
    }

    this.game.setPoseDebugSection?.(this.poseDebugTab);
    if (this.poseDebugTab === 'pose') {
      this._syncPoseDebugRigState();
    } else if (this.poseDebugTab === 'platforming') {
      this.game.player.externalRig?.setDebugPoseEnabled?.(false);
      this._syncPlatformDebugControls();
    } else {
      this.game.player.externalRig?.setDebugPoseEnabled?.(false);
      this._syncBusterDebugControls();
    }
  }

  _syncBusterDebugControls() {
    const catalogView = this.game.getBusterLabViewModel?.('build-a');
    const candidates = [
      { id: 'megaBuster', label: 'Mega Buster', available: true },
      ...(catalogView?.builds ?? []).map((build) => ({
        id: build.buildId,
        label: `${build.label}${build.available ? '' : ' (no chassis)'}`,
        available: build.available,
      })),
      ...(catalogView?.blueprints ?? []).map((blueprint) => ({
        id: blueprint.blueprintId,
        label: `Blueprint: ${blueprint.name}${blueprint.locked ? ' (sandbox only)' : ''}`,
        available: true,
      })),
    ];
    if (!candidates.some((entry) => entry.id === this.busterDebugSelectedBuildId && entry.available)) {
      this.busterDebugSelectedBuildId = candidates.find((entry) => entry.id === 'build-a' && entry.available)?.id
        ?? candidates.find((entry) => entry.available)?.id
        ?? 'megaBuster';
    }
    if (this.busterDebugBuildSelect) {
      const selectedId = this.busterDebugSelectedBuildId;
      this.busterDebugBuildSelect.replaceChildren(...candidates.map((entry) => {
        const option = document.createElement('option');
        option.value = entry.id;
        option.textContent = entry.label;
        option.disabled = !entry.available;
        return option;
      }));
      this.busterDebugBuildSelect.value = selectedId;
      this.busterDebugBuildSelect.disabled = !catalogView;
    }

    const view = this.game.getBusterLabViewModel?.(this.busterDebugSelectedBuildId) ?? catalogView;
    if (this.busterDebugGrantButton) {
      this.busterDebugGrantButton.disabled = !this.game.busterLabDebugEnabled
        || Boolean(view?.persistence?.readOnly ?? view?.readOnly)
        || Boolean(this.game.busterSandboxSession?.active);
    }
    if (this.busterDebugStatus) {
      if (!view) {
        this.busterDebugStatus.textContent = 'Enable ?busterLab=1&busterLabDebug=1 to use the Custom Buster testing kit.';
      } else {
        const count = view.debugGrantCount ?? 0;
        const calibrationCount = view.mega?.availableCalibrations?.length ?? 0;
        const buildBReady = Boolean(view.builds?.find((entry) => entry.buildId === 'build-b')?.available);
        this.busterDebugStatus.textContent = count > 0
          ? `${count} kit${count === 1 ? '' : 's'} granted | ${view.moduleInstances?.length ?? 0} physical modules | ${calibrationCount} Mega calibrations | Build B ${buildBReady ? 'ready' : 'missing'}`
          : 'No debug kits granted in this save.';
      }
    }

    const benchmark = view?.benchmarkRange?.config ?? this.game.busterBenchmarkOptions ?? {};
    if (this.busterDebugTargetSelect) this.busterDebugTargetSelect.value = String(benchmark.targetCount ?? 1);
    if (this.busterDebugProfileSelect) this.busterDebugProfileSelect.value = String(benchmark.profile ?? 'stationary');
    if (this.busterDebugDepthSelect) this.busterDebugDepthSelect.value = String(benchmark.depthLevel ?? 1);

    const sandboxActive = Boolean(this.game.busterSandboxSession?.active);
    const rangeActive = Boolean(this.game.busterTestRange?.active);
    const testModeActive = sandboxActive || rangeActive;
    if (this.busterDebugRangeButton) {
      this.busterDebugRangeButton.disabled = !this.game.busterLabDebugEnabled
        || testModeActive
        || !view?.canTest;
    }
    if (this.busterDebugSandboxButton) {
      this.busterDebugSandboxButton.disabled = !this.game.busterLabDebugEnabled
        || testModeActive
        || !view?.canSandbox;
      this.busterDebugSandboxButton.title = this.game.busterLabSandboxEnabled
        ? ''
        : 'Launch with ?busterLab=sandbox to enable the disposable dungeon.';
    }
    if (this.busterDebugOpenLabButton) this.busterDebugOpenLabButton.disabled = testModeActive;
    if (this.busterDebugRefillButton) {
      this.busterDebugRefillButton.disabled = !this.game.busterLabDebugEnabled
        || (this.game.busterRuntime?.states?.size ?? 0) === 0;
    }

    if (!this.busterDebugTestStatus) return;
    const selectedLabel = candidates.find((entry) => entry.id === this.busterDebugSelectedBuildId)?.label
      ?? this.busterDebugSelectedBuildId;
    if (!view) {
      this.busterDebugTestStatus.textContent = 'Buster Lab testing is unavailable.';
    } else if (sandboxActive) {
      this.busterDebugTestStatus.textContent = 'Disposable sandbox active. Close Debug Tools and press Escape to restore production.';
    } else if (rangeActive) {
      this.busterDebugTestStatus.textContent = 'Benchmark range active. Close Debug Tools and press Escape to return.';
    } else if (this.busterDebugSelectedBuildId !== 'megaBuster' && !view.validation?.valid) {
      this.busterDebugTestStatus.textContent = view.validation?.errors?.[0]?.message
        ?? `${selectedLabel} is not a valid test program yet.`;
    } else if (view.selectedBlueprint?.locked) {
      this.busterDebugTestStatus.textContent = `${selectedLabel} is redacted: full-catalog sandbox is available, but the production range remains locked.`;
    } else if (!this.game.busterLabSandboxEnabled) {
      this.busterDebugTestStatus.textContent = `${selectedLabel} is ready for the range. Use ?busterLab=sandbox to enable Enter Sandbox.`;
    } else {
      this.busterDebugTestStatus.textContent = `${selectedLabel} is ready for range or disposable-dungeon testing.`;
    }
  }

  _syncPlatformDebugControls() {
    const state = this.game.getPlatformDebugState?.();
    if (!state) {
      return;
    }

    if (this.platformDebugJumpHeight) this.platformDebugJumpHeight.value = state.jumpHeightPreset;
    if (this.platformDebugGravity) this.platformDebugGravity.value = state.gravityPreset;
    if (this.platformDebugApex) this.platformDebugApex.textContent = state.jumpHeight.toFixed(2);
    if (this.platformDebugApexTime) this.platformDebugApexTime.textContent = `${state.timeToApex.toFixed(2)}s`;
    if (this.platformDebugGrabMin) this.platformDebugGrabMin.textContent = state.minimumGrabElevation.toFixed(2);
    if (this.platformDebugCount) {
      const count = state.spawnedPlatformCount;
      this.platformDebugCount.textContent = `${count} block${count === 1 ? '' : 's'}`;
    }
  }

  _spawnPlatformDebugBlock() {
    const platform = this.game.spawnDebugPlatform?.({
      width: Number(this.platformDebugWidth?.value),
      depth: Number(this.platformDebugDepth?.value),
      height: Number(this.platformDebugHeight?.value),
      distance: Number(this.platformDebugDistance?.value),
    });
    if (platform) {
      this.showToast(`${platform.id}: ${platform.halfWidth * 2}×${platform.topY - platform.baseY}×${platform.halfDepth * 2}`);
    }
    this._syncPlatformDebugControls();
  }

  _createPoseDebugAnimations() {
    return POSE_DEBUG_ANIMATION_PRESETS.map((animation) => ({
      id: animation.id,
      label: animation.label,
      keyframes: animation.keyframes.map((keyframe) => ({
        id: keyframe.id,
        label: keyframe.label,
        frame: keyframe.frame,
        poseDegrees: clonePoseDegrees(keyframe.poseDegrees),
      })),
    }));
  }

  _getActivePoseAnimation() {
    return this.poseDebugAnimations.find((animation) => animation.id === this.poseDebugAnimationId)
      ?? this.poseDebugAnimations[0]
      ?? null;
  }

  _getActivePoseKeyframe() {
    const animation = this._getActivePoseAnimation();
    return animation?.keyframes.find((keyframe) => keyframe.id === this.poseDebugKeyframeId)
      ?? animation?.keyframes[0]
      ?? null;
  }

  _writePoseDebugValuesToActiveKeyframe() {
    const keyframe = this._getActivePoseKeyframe();

    if (!keyframe) {
      return;
    }

    keyframe.poseDegrees = this._getPoseDebugDegrees();
  }

  _captureCurrentPoseDebugPose() {
    const rig = this.game.player.externalRig;
    const jointNames = POSE_DEBUG_JOINTS.map(({ name }) => name);
    const currentPoseDegrees = rig?.getCurrentDebugPoseDegrees?.(jointNames);

    if (!currentPoseDegrees) {
      return false;
    }

    const poseDegrees = normalizePoseDegrees(currentPoseDegrees);
    let animation = this.poseDebugAnimations.find((entry) => entry.id === POSE_DEBUG_CURRENT_ANIMATION_ID);

    if (!animation) {
      animation = {
        id: POSE_DEBUG_CURRENT_ANIMATION_ID,
        label: 'Current Pose',
        keyframes: [],
      };
      this.poseDebugAnimations.unshift(animation);
    }

    let keyframe = animation.keyframes.find((entry) => entry.id === POSE_DEBUG_CURRENT_KEYFRAME_ID);
    if (!keyframe) {
      keyframe = {
        id: POSE_DEBUG_CURRENT_KEYFRAME_ID,
        label: 'Captured on open',
        frame: 0,
        poseDegrees,
      };
      animation.keyframes.unshift(keyframe);
    } else {
      keyframe.poseDegrees = poseDegrees;
    }

    this.poseDebugAnimationId = animation.id;
    this.poseDebugKeyframeId = keyframe.id;
    this.poseDebugValues = createPoseValueMap(poseDegrees);
    return true;
  }

  _loadPoseDebugKeyframe(keyframe) {
    if (!keyframe) {
      return;
    }

    this.poseDebugValues = createPoseValueMap(keyframe.poseDegrees);
    this._syncAllPoseDebugControls();
    this._applyPoseDebugValues();
    this._renderPoseDebugPrompt();
  }

  _renderPoseDebugTimeline() {
    const animation = this._getActivePoseAnimation();

    if (this.poseDebugAnimationSelect) {
      this.poseDebugAnimationSelect.innerHTML = this.poseDebugAnimations.map((entry) => (
        `<option value="${entry.id}"${entry.id === animation?.id ? ' selected' : ''}>${entry.label}</option>`
      )).join('');
    }

    if (this.poseDebugKeyframeSelect) {
      const keyframes = animation?.keyframes ?? [];
      const activeKeyframe = this._getActivePoseKeyframe();
      this.poseDebugKeyframeSelect.innerHTML = keyframes.map((keyframe) => (
        `<option value="${keyframe.id}"${keyframe.id === activeKeyframe?.id ? ' selected' : ''}>${keyframe.frame}: ${keyframe.label}</option>`
      )).join('');
    }
  }

  _selectPoseDebugAnimation(animationId) {
    this._writePoseDebugValuesToActiveKeyframe();
    const animation = this.poseDebugAnimations.find((entry) => entry.id === animationId);

    if (!animation) {
      return;
    }

    this.poseDebugAnimationId = animation.id;
    this.poseDebugKeyframeId = animation.keyframes[0]?.id ?? '';
    this._renderPoseDebugTimeline();
    this._loadPoseDebugKeyframe(this._getActivePoseKeyframe());
  }

  _selectPoseDebugKeyframe(keyframeId) {
    this._writePoseDebugValuesToActiveKeyframe();
    const animation = this._getActivePoseAnimation();
    const keyframe = animation?.keyframes.find((entry) => entry.id === keyframeId);

    if (!keyframe) {
      return;
    }

    this.poseDebugKeyframeId = keyframe.id;
    this._renderPoseDebugTimeline();
    this._loadPoseDebugKeyframe(keyframe);
  }

  _addPoseDebugKeyframe() {
    const animation = this._getActivePoseAnimation();

    if (!animation) {
      return;
    }

    this._writePoseDebugValuesToActiveKeyframe();
    const lastFrame = animation.keyframes.reduce((maxFrame, keyframe) => Math.max(maxFrame, keyframe.frame ?? 0), 0);
    const keyframe = {
      id: `customKey${Date.now().toString(36)}`,
      label: `Custom ${animation.keyframes.length + 1}`,
      frame: lastFrame + 6,
      poseDegrees: this._getPoseDebugDegrees(),
    };

    animation.keyframes.push(keyframe);
    this.poseDebugKeyframeId = keyframe.id;
    this._renderPoseDebugTimeline();
    this._renderPoseDebugPrompt();
    this.showToast('Animation keyframe added');
  }

  _deletePoseDebugKeyframe() {
    const animation = this._getActivePoseAnimation();

    if (!animation || animation.keyframes.length <= 1) {
      this.showToast('Keep at least one keyframe');
      return;
    }

    const index = animation.keyframes.findIndex((keyframe) => keyframe.id === this.poseDebugKeyframeId);
    if (index < 0) {
      return;
    }

    animation.keyframes.splice(index, 1);
    const nextKeyframe = animation.keyframes[Math.max(0, index - 1)] ?? animation.keyframes[0];
    this.poseDebugKeyframeId = nextKeyframe.id;
    this._renderPoseDebugTimeline();
    this._loadPoseDebugKeyframe(nextKeyframe);
    this.showToast('Animation keyframe deleted');
  }

  getPoseDebugJoints() {
    return POSE_DEBUG_JOINTS.map((joint) => ({ ...joint }));
  }

  getPoseDebugJointDegrees(jointName) {
    const joint = this.poseDebugValues.get(jointName);

    if (!joint) {
      return { x: 0, y: 0, z: 0 };
    }

    return { x: joint.x, y: joint.y, z: joint.z };
  }

  setPoseDebugJointDegrees(jointName, values = {}) {
    const joint = this.poseDebugValues.get(jointName);

    if (!joint) {
      return;
    }

    for (const axis of ['x', 'y', 'z']) {
      if (!Number.isFinite(Number(values[axis]))) {
        continue;
      }

      joint[axis] = THREE.MathUtils.clamp(Number(values[axis]), -180, 180);
      this._syncPoseDebugAxisControl(jointName, axis);
      this.game.player.externalRig?.updateDebugPoseOverride?.(jointName, axis, degreesToRadians(joint[axis]));
    }

    this.focusPoseDebugJoint(jointName);
    this._writePoseDebugValuesToActiveKeyframe();
    this._renderPoseDebugPrompt();
  }

  focusPoseDebugJoint(jointName, { scroll = true, focusAxis = null } = {}) {
    if (!jointName || !this.poseDebugControlsRendered) {
      return;
    }

    const group = this.poseDebugControls?.querySelector(`[data-pose-joint-group="${jointName}"]`);
    if (!group) {
      return;
    }

    const jointChanged = this.poseDebugFocusedJointName !== jointName;
    this.poseDebugFocusedJointName = jointName;

    for (const entry of this.poseDebugControls?.querySelectorAll('.pose-joint-group.is-active') ?? []) {
      entry.classList.remove('is-active');
    }

    group.classList.add('is-active');
    group.open = true;

    if (focusAxis) {
      group.querySelector(`input[data-pose-joint="${jointName}"][data-pose-axis="${focusAxis}"]`)?.focus({ preventScroll: true });
    }

    if (scroll && jointChanged) {
      group.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  showLootToast(item) {
    this.showToast(item.name, item.color);
  }

  showToast(message, color = '#f2c84b') {
    this.toast.textContent = message;
    this.toast.style.borderColor = color;
    this.toast.style.color = color;
    this.toast.classList.add('is-visible');
    this.toastTimer = 2.2;
  }

  renderInventory() {
    if (this.goldValue) this.goldValue.textContent = String(this.game.inventory.gold ?? 0);
    if (this.unidentifiedScrapValue) {
      this.unidentifiedScrapValue.textContent = String(this.game.inventory.unidentifiedScrap ?? 0);
    }
    this._renderEquipment();
    this._renderQuestLog();
    this._renderInventoryActions();
    this._renderRollScrapWorkshop();
    this._renderBusterLab();
    this._renderCraftingMaterials();
    this._renderInventoryItems();
  }

  setScrapIdentificationResult(result) {
    this.lastScrapIdentification = result;
    this._renderRollScrapWorkshop();
  }

  _renderRollScrapWorkshop() {
    const unidentified = Math.max(
      0,
      Math.trunc(this.game.inventory.unidentifiedScrap) || 0,
    );
    const storage = this.game.rollSalvageStorage;
    const identified = Math.max(0, Math.trunc(storage?.identifiedScrap) || 0);
    const partCount = storage?.getStoredPartCount?.() ?? 0;

    if (this.rollUnidentifiedValue) this.rollUnidentifiedValue.textContent = String(unidentified);
    if (this.rollIdentifiedValue) this.rollIdentifiedValue.textContent = String(identified);
    if (this.rollPartsValue) this.rollPartsValue.textContent = String(partCount);
    if (this.rollIdentifyButton) {
      this.rollIdentifyButton.disabled = unidentified <= 0;
      this.rollIdentifyButton.textContent = unidentified > 0
        ? `Identify All (${unidentified})`
        : 'Nothing to Identify';
    }

    if (!this.rollIdentificationResult) return;
    const result = this.lastScrapIdentification;
    if (!result?.processed) {
      this.rollIdentificationResult.textContent = unidentified > 0
        ? `${unidentified} unidentified scrap awaiting Roll's inspection.`
        : 'Bring unidentified Reaverbot scrap back from the ruins for Roll to inspect.';
      return;
    }

    const partNames = result.recoveredParts
      .map((part) => `${part.name}${part.quantity > 1 ? ` x${part.quantity}` : ''}`)
      .join(', ');
    this.rollIdentificationResult.textContent = result.partCount > 0
      ? `Last analysis: ${result.scrapStored} crafting scrap stored. Intact part found: ${partNames}.`
      : `Last analysis: ${result.scrapStored} crafting scrap stored; no intact parts recovered.`;
  }

  _selectRollWorkshopTab(tab = 'salvage', { render = true } = {}) {
    const nextTab = this.game.busterLabEnabled && tab === 'buster' ? 'buster' : 'salvage';
    this.rollWorkshopTab = nextTab;
    this.root?.classList.toggle(
      'is-buster-lab',
      this.inventoryMode === 'roll' && nextTab === 'buster',
    );
    for (const button of this.rollWorkshopTabs?.querySelectorAll('[data-roll-tab]') ?? []) {
      button.setAttribute('aria-selected', String(button.dataset.rollTab === nextTab));
    }
    if (this.rollSalvageView) this.rollSalvageView.hidden = nextTab !== 'salvage';
    if (this.busterLabView) this.busterLabView.hidden = nextTab !== 'buster';
    if (render && nextTab === 'buster') this._renderBusterLab();
  }

  _renderBusterLab() {
    if (!this.busterLabView || !this.game.busterLabEnabled) return;
    const view = this.game.getBusterLabViewModel?.(this.busterLabSelectedBuildId);
    if (!view) return;

    this._renderBusterPersistence(view);
    this._renderBusterBlueprints(view);
    this._renderBusterBenchmark(view);

    if (!view.build?.available && this.busterLabSelectedBuildId === 'build-b') {
      this.busterLabSelectedBuildId = 'build-a';
      return this._renderBusterLab();
    }

    const selectedId = this.busterLabSelectedBuildId;
    for (const button of this.busterLabView.querySelectorAll('[data-action="buster-select-build"]')) {
      const build = view.builds?.find((entry) => entry.buildId === button.dataset.buildId);
      const isMega = button.dataset.buildId === 'megaBuster';
      button.disabled = !isMega && !build?.available;
      button.setAttribute('aria-selected', String(button.dataset.buildId === selectedId));
      const slots = build?.equippedSlots?.length ? ` · S${build.equippedSlots.map((slot) => slot + 1).join('/')}` : '';
      button.textContent = `${isMega ? 'Mega' : build?.label ?? button.textContent.split(' · ')[0]}${slots}`;
    }

    if (this.busterBuyChassisButton) {
      this.busterBuyChassisButton.hidden = Boolean(view.builds?.find((entry) => entry.buildId === 'build-b')?.available);
      this.busterBuyChassisButton.disabled = this.busterLabReadOnly || !view.canBuySecondChassis;
    }
    if (this.busterLabWarning) {
      this.busterLabWarning.hidden = !view.warning;
      this.busterLabWarning.textContent = view.warning ?? '';
    }
    if (this.busterRecipeScrap) {
      this.busterRecipeScrap.textContent = `${view.identifiedScrap ?? 0} identified scrap`;
    }

    const megaSelected = selectedId === 'megaBuster';
    const blueprintSelected = Boolean(
      view.selectedBlueprint
      || view.build?.kind === 'blueprint'
      || view.build?.blueprintId,
    );
    const lockedBlueprint = Boolean(view.selectedBlueprint?.locked || view.selectedBlueprint?.redacted);
    if (this.busterMegaPanel) this.busterMegaPanel.hidden = !megaSelected;
    if (this.busterCustomEditor) this.busterCustomEditor.hidden = megaSelected;
    this._renderMegaBusterCalibration(view);

    const draft = view.build?.draft;
    if (!megaSelected && draft) {
      for (const input of this.busterLabView.querySelectorAll('[data-buster-tuning]')) {
        input.value = String(draft.tuning?.[input.dataset.busterTuning] ?? 1);
        input.disabled = this.busterLabReadOnly || !view.build.available || lockedBlueprint;
      }
      if (this.busterTuningRemaining) {
        const remaining = view.tuningRemaining ?? (16 - Object.values(draft.tuning ?? {}).reduce((sum, value) => sum + Number(value || 0), 0));
        this.busterTuningRemaining.textContent = `${remaining} point${Math.abs(remaining) === 1 ? '' : 's'} remaining`;
        this.busterTuningRemaining.classList.toggle('is-invalid', remaining !== 0);
      }
      this._renderBusterProgramControls({ ...view, editingLocked: lockedBlueprint });
    }

    this._renderBusterCompilerResult(view, megaSelected);
    this._renderBusterModuleInventory(view);
    this._renderBusterRecipes(view);

    for (const button of this.busterLabView.querySelectorAll('[data-action="buster-save"], [data-action="buster-equip"], [data-action="buster-test-range"], [data-action="buster-test-sandbox"]')) {
      if (button.dataset.action === 'buster-save') button.disabled = this.busterLabReadOnly || megaSelected || blueprintSelected || !view.canSave;
      if (button.dataset.action === 'buster-equip') button.disabled = this.busterLabReadOnly || megaSelected || blueprintSelected || !view.canEquip;
      if (button.dataset.action === 'buster-test-range') button.disabled = !view.canTest;
      if (button.dataset.action === 'buster-test-sandbox') button.disabled = !view.canSandbox || !this.game.busterLabSandboxEnabled;
    }
    if (this.busterTestSandboxButton) {
      this.busterTestSandboxButton.hidden = !(view.sandboxEnabled ?? this.game.busterLabSandboxEnabled);
    }
  }

  _renderBusterPersistence(view) {
    const persistence = view.persistence ?? view.storage ?? {};
    const hasStatus = Object.keys(persistence).length > 0
      || view.readOnly !== undefined
      || view.saveContextId !== undefined;
    const readOnly = Boolean(persistence.readOnly ?? view.readOnly);
    this.busterLabReadOnly = readOnly;

    if (this.busterStorageStatus) this.busterStorageStatus.hidden = !hasStatus;
    if (this.busterStorageMode) {
      const status = persistence.status
        ?? view.persistenceStatus
        ?? (readOnly ? 'Read-only — durable writes unavailable' : 'Durable storage ready');
      this.busterStorageMode.textContent = status;
      this.busterStorageMode.classList.toggle('is-read-only', readOnly);
    }
    if (this.busterStorageContext) {
      const contextId = persistence.saveContextId ?? view.saveContextId ?? null;
      const revision = persistence.revision ?? view.storageRevision;
      const contextLabel = contextId ? `Campaign ${String(contextId).slice(0, 12)}` : '';
      const revisionLabel = Number.isFinite(revision) ? `revision ${revision}` : '';
      this.busterStorageContext.textContent = [contextLabel, revisionLabel].filter(Boolean).join(' · ');
      this.busterStorageContext.title = contextId ? `Save context: ${contextId}` : '';
    }
    if (this.busterLabPersistence) {
      this.busterLabPersistence.textContent = readOnly
        ? 'This Lab is read-only. Inspection, range testing, sandbox testing, and export remain available.'
        : persistence.message ?? 'Workshop ownership is durably stored for this campaign context.';
      this.busterLabPersistence.classList.toggle('is-read-only', readOnly);
    }
    if (this.busterStorageReload) {
      this.busterStorageReload.hidden = !persistence.canReload || !persistence.writePaused;
    }
    if (this.busterAdoptV1) {
      this.busterAdoptV1.hidden = !persistence.legacyAdoption?.eligible;
      this.busterAdoptV1.disabled = readOnly;
      if (persistence.legacyAdoption?.eligible) {
        const summary = persistence.legacyAdoption.summary ?? {};
        this.busterAdoptV1.title = `Adopt ${summary.moduleCount ?? 0} modules, ${summary.chassisCount ?? 0} chassis, and ${summary.identifiedScrap ?? 0} scrap from the untouched v1 payload.`;
      }
    }
  }

  _renderBusterBlueprints(view) {
    if (!this.busterBlueprintPanel) return;
    const supported = Object.hasOwn(view, 'blueprints')
      || Boolean(view.blueprintSupport)
      || Number.isFinite(view.blueprintCapacity);
    this.busterBlueprintPanel.hidden = !supported;
    if (!supported) return;

    const blueprints = Array.isArray(view.blueprints) ? view.blueprints : [];
    const capacity = Math.max(1, Number(view.blueprintCapacity) || 8);
    const requestedSelection = view.selectedBlueprint?.blueprintId
      ?? view.selectedBlueprint?.buildId
      ?? view.selectedBlueprintId
      ?? this.busterLabSelectedBlueprintId
      ?? '';
    const selected = blueprints.some((entry) => (
      (entry.blueprintId ?? entry.buildId) === requestedSelection
    )) ? requestedSelection : '';
    this.busterLabSelectedBlueprintId = selected || null;

    if (this.busterBlueprintCount) {
      this.busterBlueprintCount.textContent = `${blueprints.length} / ${capacity}`;
      this.busterBlueprintCount.classList.toggle('is-invalid', blueprints.length > capacity);
    }
    if (this.busterBlueprintSelect) {
      const emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = blueprints.length ? 'Choose blueprint' : 'No blueprints saved';
      this.busterBlueprintSelect.replaceChildren(emptyOption, ...blueprints.map((blueprint, index) => {
        const option = document.createElement('option');
        option.value = blueprint.blueprintId ?? blueprint.buildId ?? '';
        option.textContent = `${blueprint.name ?? blueprint.label ?? `Blueprint ${index + 1}`}${blueprint.invalid ? ' · invalid' : ''}`;
        return option;
      }));
      this.busterBlueprintSelect.value = selected;
    }

    const selectedBlueprint = view.selectedBlueprint
      ?? blueprints.find((entry) => (entry.blueprintId ?? entry.buildId) === selected)
      ?? null;
    if (this.busterMaterializeTarget) {
      const availableBuilds = (view.builds ?? []).filter((build) => build.available);
      const currentTarget = this.busterMaterializeTarget.value;
      this.busterMaterializeTarget.replaceChildren(...availableBuilds.map((build) => {
        const option = document.createElement('option');
        option.value = build.buildId;
        option.textContent = build.label ?? build.buildId;
        return option;
      }));
      if (availableBuilds.some((build) => build.buildId === currentTarget)) {
        this.busterMaterializeTarget.value = currentTarget;
      }
      this.busterMaterializeTarget.disabled = this.busterLabReadOnly || !selectedBlueprint;
    }
    const locked = Boolean(selectedBlueprint?.locked || selectedBlueprint?.redacted);
    if (this.busterBlueprintStatus) {
      this.busterBlueprintStatus.textContent = selectedBlueprint
        ? locked
          ? 'This imported design is locked and redacted until its known modules are discovered.'
          : selectedBlueprint.materializedBuildId
            ? `Materialized as ${selectedBlueprint.materializedBuildId}.`
            : 'Ownership-free design: simulation is available; production equip requires materialization.'
        : 'Create a blueprint from the current program, or select an existing design.';
    }

    for (const button of this.busterBlueprintPanel.querySelectorAll('button[data-action]')) {
      const action = button.dataset.action;
      if (action === 'buster-blueprint-new') button.disabled = this.busterLabReadOnly || blueprints.length >= capacity;
      if (action === 'buster-blueprint-save') button.disabled = this.busterLabReadOnly || !selectedBlueprint;
      if (action === 'buster-blueprint-delete') button.disabled = this.busterLabReadOnly || !selectedBlueprint;
      if (action === 'buster-materialize-suggest') {
        button.disabled = this.busterLabReadOnly || !selectedBlueprint || locked || view.canSuggestMaterialization === false;
      }
    }

    const suggestion = view.materializationSuggestion ?? this.pendingBusterMaterialization;
    this._renderBusterMaterializationSuggestion(suggestion);
  }

  _renderBusterMaterializationSuggestion(suggestion) {
    if (!this.busterMaterializationSuggestion || !this.busterMaterializeConfirm) return;
    this.busterMaterializationSuggestion.hidden = !suggestion;
    this.busterMaterializeConfirm.hidden = !suggestion;
    if (!suggestion) {
      this.busterMaterializationSuggestion.replaceChildren();
      return;
    }

    const heading = document.createElement('strong');
    heading.textContent = suggestion.title ?? 'Revision-bound materialization plan';
    const detail = document.createElement('p');
    detail.textContent = suggestion.message
      ?? `This suggestion is bound to revision ${suggestion.expectedRevision ?? suggestion.revision ?? 'current'}.`;
    const requests = suggestion.requests ?? suggestion.missingModules ?? [];
    const list = document.createElement('div');
    list.className = 'buster-materialization-routes';
    for (const request of requests) {
      const row = document.createElement('label');
      const name = document.createElement('span');
      const fullyDiscovered = request.fullyDiscovered !== false && !request.redacted;
      name.textContent = fullyDiscovered
        ? request.name ?? request.moduleName ?? request.moduleId ?? 'Required module'
        : request.roleClue ?? request.hint ?? 'Unidentified required component';
      row.appendChild(name);
      const routes = fullyDiscovered ? request.routes ?? [] : [];
      if (routes.length > 0) {
        const select = document.createElement('select');
        select.dataset.busterMaterializationModule = request.requestId ?? request.moduleId ?? '';
        select.setAttribute('aria-label', `Fabrication route for ${name.textContent}`);
        select.replaceChildren(...routes.map((route) => {
          const option = document.createElement('option');
          option.value = route.routeId ?? route.id ?? route.type ?? '';
          option.textContent = route.label ?? route.name ?? 'Fabrication route';
          option.disabled = route.affordable === false;
          return option;
        }));
        row.appendChild(select);
      } else {
        const clue = document.createElement('small');
        clue.textContent = fullyDiscovered
          ? request.message ?? 'No affordable route is currently available.'
          : 'Exact requirements remain hidden until normal recipe discovery is complete.';
        row.appendChild(clue);
      }
      list.appendChild(row);
    }
    this.busterMaterializationSuggestion.replaceChildren(heading, detail, list);
    this.busterMaterializeConfirm.disabled = this.busterLabReadOnly
      || suggestion.canConfirm === false
      || requests.some((request) => request.redacted || request.fullyDiscovered === false);
  }

  _renderBusterBenchmark(view) {
    if (!this.busterBenchmarkPanel) return;
    const benchmark = view.benchmarkRange ?? view.benchmark ?? null;
    this.busterBenchmarkPanel.hidden = !benchmark;
    if (!benchmark) return;
    const config = benchmark.config ?? benchmark.options ?? {};
    for (const select of this.busterBenchmarkPanel.querySelectorAll('[data-buster-benchmark]')) {
      const key = select.dataset.busterBenchmark;
      if (config[key] !== undefined) select.value = String(config[key]);
      select.disabled = benchmark.configurable === false;
    }
    if (this.busterBenchmarkStatus) {
      this.busterBenchmarkStatus.textContent = benchmark.status ?? (benchmark.running ? 'Running' : 'Ready');
    }
    if (!this.busterBenchmarkMetrics) return;
    const metrics = benchmark.metrics ?? {};
    const definitions = [
      ['Delivered PWR', metrics.deliveredPower],
      ['Mitigated', metrics.mitigation ?? metrics.mitigatedPower],
      ['Opening mag', metrics.openingMagazine ?? metrics.openingPower],
      ['Recovery', metrics.recoveryTime],
      ['10s output', metrics.output10s],
      ['30s output', metrics.output30s],
      ['Occupancy', metrics.occupancy ?? metrics.peakOccupancy],
      ['Weak point', metrics.weakPointResult ?? metrics.weakPointPower],
      ['Stagger', metrics.stagger ?? metrics.controlTime],
      ['Misses', metrics.misses],
      ['TTK / clear', metrics.ttk ?? metrics.clearTime],
    ].filter(([, value]) => value !== undefined && value !== null);
    this.busterBenchmarkMetrics.replaceChildren(...definitions.map(([label, value]) => {
      const card = document.createElement('div');
      card.className = 'buster-result-stat';
      const labelNode = document.createElement('span');
      labelNode.textContent = label;
      const valueNode = document.createElement('strong');
      valueNode.textContent = typeof value === 'number' ? String(Number(value.toFixed(2))) : String(value);
      card.append(labelNode, valueNode);
      return card;
    }));
  }

  _renderBusterProgramControls(view) {
    const selections = view.programSelections ?? {};
    const optionGroups = view.programOptions ?? {
      emitter: [
        { value: 'pulseBolt', label: 'Pulse Bolt' },
        { value: 'mortarShell', label: 'Mortar Shell' },
      ],
      rootModifier: [{ value: '', label: 'None' }, { value: 'pursuitGuidance', label: 'Pursuit Guidance' }],
      trigger: [
        { value: '', label: 'None (direct)' },
        { value: 'atApex', label: 'At Apex' },
        { value: 'onImpact', label: 'Terminal Relay' },
        { value: 'afterDelay', label: 'After 0.60s' },
      ],
      childModifier: [{ value: '', label: 'None' }, { value: 'pursuitGuidance', label: 'Pursuit Guidance' }],
      splitter: [
        { value: '', label: 'None' },
        { value: 'spread3', label: 'Spread ×3' },
        { value: 'cluster5', label: 'Cluster ×5' },
      ],
      payload: [
        { value: 'pulsePayload', label: 'Native Pulse' },
        { value: 'explosion', label: 'Explosion' },
      ],
    };

    for (const select of this.busterLabView.querySelectorAll('[data-buster-program]')) {
      const slot = select.dataset.busterProgram;
      const options = optionGroups[slot] ?? [];
      select.replaceChildren(...options.map((option) => {
        const element = document.createElement('option');
        element.value = option.value ?? option.moduleId ?? '';
        element.textContent = element.value === 'onImpact'
          ? 'Terminal Relay'
          : option.label ?? option.name ?? option.moduleId ?? 'None';
        element.disabled = Boolean(option.disabled);
        return element;
      }));
      select.value = selections[slot] ?? '';
      select.disabled = this.busterLabReadOnly || !view.build?.available || view.editingLocked;
    }
    if (this.busterProgramCapacity) {
      const used = view.semanticCapacity?.used
        ?? view.capacity?.used
        ?? view.nodeCount
        ?? view.build?.draft?.program?.nodes?.length
        ?? 0;
      const maximum = view.semanticCapacity?.maximum ?? view.capacity?.maximum ?? 5;
      this.busterProgramCapacity.textContent = `${used} / ${maximum} capacity`;
    }
  }

  _renderBusterCompilerResult(view, megaSelected) {
    if (!megaSelected && (view.selectedBlueprint?.locked || view.selectedBlueprint?.redacted)) {
      if (this.busterCompilerResult) {
        this.busterCompilerResult.innerHTML = '<p class="buster-redacted">Compiler preview redacted until normal recipe discovery reveals every known module. Full-catalog sandbox execution remains available.</p>';
      }
      if (this.busterValidationErrors) this.busterValidationErrors.replaceChildren();
      return;
    }
    const result = megaSelected ? view.mega?.result : view.result;
    const stats = result?.stats ?? result ?? null;
    if (this.busterCompilerResult) {
      const triggerBehavior = result?.trigger
        ? result.trigger.event === 'delay'
          ? `After ${Number(result.trigger.delay ?? 0).toFixed(2)}s`
          : result.trigger.event === 'apex'
            ? 'At ballistic apex'
            : 'Terminal Relay (contact / expiry)'
        : 'Direct';
      const rawMultiplier = Number(
        result?.ledger?.power?.rawMultiplier
        ?? result?.ledger?.power?.rawEffectiveMultiplier
        ?? result?.powerLedger?.rawMultiplier
        ?? 0,
      );
      const capClipped = Number(result?.ledger?.power?.capClipped ?? result?.softCap?.compression ?? 0);
      const softCapActive = result?.softCap?.active === true || rawMultiplier > 1.25 || capClipped > 0;
      const entries = stats ? [
        ['Base PWR', stats.basePower],
        ['Effective', stats.effectivePower],
        ['Per child', stats.perChildPower],
        ['Projectiles', stats.projectileCount ?? result?.projectileCount],
        ['Energy cost', stats.energyCost],
        ['Shots / magazine', stats.shotsPerMagazine ?? stats.shotsPerCharge],
        ['Rapid', stats.finalRapid],
        ['Root range', stats.rootRange],
        ['Child range', stats.childRange],
        ['Trigger', triggerBehavior],
        ['Reservation', result?.peakProjectileReservation ?? stats.peakProjectileReservation],
        ['Occupancy', result?.occupancyEstimate ?? stats.occupancyEstimate],
        ...(softCapActive ? [
          ['Raw multiplier', rawMultiplier || result?.softCap?.rawMultiplier],
          ['Soft-cap compression', capClipped || result?.softCap?.compression],
        ] : []),
      ] : [];
      this.busterCompilerResult.replaceChildren(...entries.map(([label, value]) => {
        const card = document.createElement('div');
        card.className = 'buster-result-stat';
        const normalized = typeof value === 'number'
          ? Number(value.toFixed(Math.abs(value) < 10 ? 2 : 1))
          : value ?? '—';
        card.innerHTML = `<span>${label}</span><strong>${normalized}</strong>`;
        return card;
      }));
      if (result?.description) {
        const description = document.createElement('p');
        description.className = 'buster-program-help';
        description.textContent = result.description;
        this.busterCompilerResult.appendChild(description);
      }
    }

    if (this.busterValidationErrors) {
      const errors = megaSelected ? [] : view.validation?.errors ?? [];
      const warnings = megaSelected ? result?.warnings ?? [] : [
        ...(view.validation?.warnings ?? []),
        ...(result?.warnings ?? []),
      ];
      this.busterValidationErrors.replaceChildren(...[
        ...errors.map((error) => ({ ...error, severity: 'error' })),
        ...warnings.map((warning) => ({ ...warning, severity: 'warning' })),
      ].map((error) => {
        const item = document.createElement('li');
        item.textContent = error.message ?? error.code ?? 'Invalid program';
        item.title = error.path ?? '';
        item.classList.toggle('is-warning', error.severity === 'warning');
        return item;
      }));
    }
  }

  _renderBusterModuleInventory(view) {
    if (!this.busterModuleInventory) return;
    const instances = view.moduleInstances ?? [];
    this.busterModuleInventory.replaceChildren(...instances.map((instance) => {
      const card = document.createElement('article');
      card.className = 'buster-module-card';
      card.innerHTML = `
        <strong>${instance.name ?? instance.moduleId}</strong>
        <span>${instance.instanceId}</span>
        <span>${instance.installedBuildId ? `Installed: ${instance.installedBuildId}` : 'Available'}</span>
      `;
      return card;
    }));
    if (instances.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'material-empty';
      empty.textContent = 'No physical modules fabricated';
      this.busterModuleInventory.appendChild(empty);
    }
  }

  _renderBusterRecipes(view) {
    if (!this.busterRecipeList) return;
    const visibleRecipes = (view.recipes ?? []).filter((recipe) => (
      !recipe.hidden
      && !recipe.legacyOnly
      && recipe.moduleId !== 'afterDelay'
      && recipe.recipeId !== 'afterDelay'
      && recipe.id !== 'afterDelay'
      && recipe.legacyModuleId !== 'afterDelay'
    ));
    this.busterRecipeList.replaceChildren(...visibleRecipes.map((recipe) => {
      const card = document.createElement('article');
      const state = recipe.discoveryState ?? recipe.state ?? 'unknown';
      card.className = `buster-recipe-card${state === 'unknown' ? ' is-unknown' : ''}`;
      if (state === 'unknown') {
        card.innerHTML = '<strong>Unknown module</strong><span>Silhouette — identify a compatible Reaverbot part.</span>';
        return card;
      }
      const isPartial = state === 'hinted' || state === 'partial' || state === 'clue';
      const ingredients = recipe.ingredientsLabel
        ?? Object.entries(recipe.parts ?? recipe.requirements ?? {}).map(([id, count]) => `${id} ×${count}`).join(' + ');
      const title = document.createElement('strong');
      title.textContent = recipe.name ?? recipe.moduleId;
      const description = document.createElement('span');
      description.textContent = recipe.function ?? recipe.description ?? '';
      const details = document.createElement('small');
      details.className = isPartial ? 'buster-recipe-clue' : '';
      details.textContent = isPartial
        ? recipe.hint ?? recipe.rollLine ?? ''
        : `${ingredients} · ${recipe.scrapCost ?? 0} scrap`;
      card.append(title, description, details);

      if (!isPartial) {
        const routes = recipe.routes ?? recipe.fabricationRoutes ?? null;
        if (Array.isArray(routes) && routes.length > 0) {
          const routeGroup = document.createElement('div');
          routeGroup.className = 'buster-recipe-routes';
          for (const route of routes) {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.action = 'buster-fabricate';
            button.dataset.moduleId = recipe.moduleId;
            button.dataset.routeId = route.routeId ?? route.id ?? route.type ?? '';
            button.textContent = route.label ?? route.name ?? 'Fabricate copy';
            button.disabled = this.busterLabReadOnly || route.affordable === false || route.available === false;
            routeGroup.appendChild(button);
          }
          card.appendChild(routeGroup);
        } else {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.action = 'buster-fabricate';
          button.dataset.moduleId = recipe.moduleId;
          button.textContent = 'Fabricate copy';
          button.disabled = this.busterLabReadOnly || !recipe.canFabricate;
          card.appendChild(button);
        }
      }
      return card;
    }));
  }

  _renderMegaBusterCalibration(view) {
    if (!this.busterMegaCalibrations || !view.mega) return;
    const installed = view.mega.calibrationSlots ?? [];
    const available = view.mega.availableCalibrations ?? [];
    this.busterMegaCalibrations.replaceChildren(...[0, 1, 2, 3].map((slotIndex) => {
      const label = document.createElement('label');
      label.className = 'buster-calibration-slot';
      const title = document.createElement('span');
      title.textContent = `Socket ${slotIndex + 1}`;
      const select = document.createElement('select');
      select.dataset.busterCalibrationSlot = String(slotIndex);
      select.disabled = this.busterLabReadOnly;
      const options = [{ instanceId: '', name: 'Empty' }, ...available];
      select.replaceChildren(...options.map((entry) => {
        const option = document.createElement('option');
        option.value = entry.instanceId ?? '';
        option.textContent = entry.name ?? entry.calibrationId ?? 'Calibration';
        option.disabled = Boolean(
          entry.instanceId
          && installed.some((installedEntry, installedIndex) => (
            installedIndex !== slotIndex
            && (installedEntry?.instanceId ?? installedEntry) === entry.instanceId
          ))
        );
        return option;
      }));
      select.value = installed[slotIndex]?.instanceId ?? installed[slotIndex] ?? '';
      label.append(title, select);
      return label;
    }));
  }

  hideTooltip() {
    this.tooltip.hidden = true;
  }

  _renderPoseDebugControls() {
    if (!this.poseDebugControls || this.poseDebugControlsRendered) {
      return;
    }

    this.poseDebugControls.innerHTML = '';

    for (const { name, label } of POSE_DEBUG_JOINTS) {
      const group = document.createElement('details');
      group.className = 'pose-joint-group';
      group.dataset.poseJointGroup = name;
      group.open = ['hips', 'spine', 'rightShoulder', 'rightElbow', 'leftHip', 'rightHip'].includes(name);
      const helperNote = POSE_HELPER_NOTES[name] ?? 'Raw local Euler axes are shown for inspecting the active FBX rig pose.';
      group.innerHTML = `
        <summary>${label}</summary>
        <p class="pose-joint-helper">${helperNote}</p>
        <div class="pose-axis-grid">
          ${POSE_AXES.map((axis) => `
            <label class="pose-axis-control">
              <span>${getPoseAxisLabel(name, axis)}</span>
              <input
                type="range"
                min="-180"
                max="180"
                step="0.5"
                value="${this.poseDebugValues.get(name)?.[axis] ?? 0}"
                data-pose-joint="${name}"
                data-pose-axis="${axis}"
              />
              <input
                class="pose-axis-number"
                type="number"
                min="-180"
                max="180"
                step="0.5"
                value="${formatPoseDegrees(this.poseDebugValues.get(name)?.[axis] ?? 0)}"
                aria-label="${label} ${getPoseAxisLabel(name, axis)} degrees"
                data-pose-number-joint="${name}"
                data-pose-number-axis="${axis}"
              />
            </label>
          `).join('')}
        </div>
      `;
      this.poseDebugControls.appendChild(group);
    }

    this.poseDebugControlsRendered = true;
    if (this.poseDebugFocusedJointName) {
      this.focusPoseDebugJoint(this.poseDebugFocusedJointName, { scroll: false });
    }
  }

  _syncPoseDebugRigState() {
    const rig = this.game.player.externalRig;
    const ready = Boolean(rig?.setDebugPoseEnabled && rig?.setDebugPoseOverrides);

    if (this.poseDebugStatus) {
      this.poseDebugStatus.textContent = ready
        ? 'Pose debug active. Drag empty space to orbit. Shift-drag selected handle to edit roll/local Z.'
        : 'External Mega Man rig is still loading; controls will apply when it is ready.';
    }

    if (!ready) {
      return;
    }

    rig.setDebugPoseEnabled(true);
    rig.setDebugPoseOverrides(this._getPoseDebugRadians());
  }

  _getPoseDebugRadians() {
    const values = {};

    for (const { name } of POSE_DEBUG_JOINTS) {
      const joint = this.poseDebugValues.get(name) ?? { x: 0, y: 0, z: 0 };
      values[name] = {
        x: degreesToRadians(joint.x),
        y: degreesToRadians(joint.y),
        z: degreesToRadians(joint.z),
      };
    }

    return values;
  }

  _getPoseDebugDegrees() {
    const values = {};

    for (const { name } of POSE_DEBUG_JOINTS) {
      const joint = this.poseDebugValues.get(name) ?? { x: 0, y: 0, z: 0 };
      values[name] = {
        pitch: Number(joint.x) || 0,
        yaw: Number(joint.y) || 0,
        roll: Number(joint.z) || 0,
      };
    }

    return values;
  }

  _applyPoseDebugValues() {
    const rig = this.game.player.externalRig;

    if (!rig?.setDebugPoseOverrides) {
      return;
    }

    rig.setDebugPoseOverrides(this._getPoseDebugRadians());
  }

  _syncPoseDebugAxisControl(jointName, axis) {
    const joint = this.poseDebugValues.get(jointName);

    if (!joint) {
      return;
    }

    const input = this.poseDebugPanel?.querySelector(`input[type="range"][data-pose-joint="${jointName}"][data-pose-axis="${axis}"]`);
    if (input) {
      input.value = String(joint[axis]);
    }

    const numberInput = this.poseDebugPanel?.querySelector(`input[data-pose-number-joint="${jointName}"][data-pose-number-axis="${axis}"]`);
    if (numberInput) {
      numberInput.value = formatPoseDegrees(joint[axis]);
    }
  }

  _syncAllPoseDebugControls() {
    for (const { name } of POSE_DEBUG_JOINTS) {
      for (const axis of POSE_AXES) {
        this._syncPoseDebugAxisControl(name, axis);
      }
    }
  }

  _updatePoseDebugValue(jointName, axis, value, { focusAxis = axis } = {}) {
    const joint = this.poseDebugValues.get(jointName);

    if (!joint || !['x', 'y', 'z'].includes(axis)) {
      return;
    }

    joint[axis] = THREE.MathUtils.clamp(Number(value) || 0, -180, 180);
    this._syncPoseDebugAxisControl(jointName, axis);
    this.focusPoseDebugJoint(jointName, { scroll: false, focusAxis });

    this.game.player.externalRig?.updateDebugPoseOverride?.(jointName, axis, degreesToRadians(joint[axis]));
    this._writePoseDebugValuesToActiveKeyframe();
    this._renderPoseDebugPrompt();
  }

  _commitPoseDebugNumberInput(input) {
    const jointName = input?.dataset.poseNumberJoint;
    const axis = input?.dataset.poseNumberAxis;

    if (!jointName || !axis) {
      return;
    }

    const valueText = input.value.trim();
    if (!valueText) {
      this._syncPoseDebugAxisControl(jointName, axis);
      return;
    }

    const value = Number(valueText);
    if (!Number.isFinite(value)) {
      this._syncPoseDebugAxisControl(jointName, axis);
      return;
    }

    this._updatePoseDebugValue(jointName, axis, value, { focusAxis: null });
  }

  _resetPoseDebugValues() {
    for (const { name } of POSE_DEBUG_JOINTS) {
      const joint = this.poseDebugValues.get(name);
      if (joint) {
        joint.x = 0;
        joint.y = 0;
        joint.z = 0;
      }
    }

    this._syncAllPoseDebugControls();

    this._applyPoseDebugValues();
    this._writePoseDebugValuesToActiveKeyframe();
    this._renderPoseDebugPrompt();
  }

  _restorePoseDebugKeyframe() {
    const presetAnimation = this.poseDebugPresetAnimations.find((entry) => entry.id === this.poseDebugAnimationId);
    const presetKeyframe = presetAnimation?.keyframes.find((entry) => entry.id === this.poseDebugKeyframeId);

    if (!presetKeyframe) {
      this.showToast('No preset keyframe to restore');
      return;
    }

    const activeKeyframe = this._getActivePoseKeyframe();
    if (activeKeyframe) {
      activeKeyframe.poseDegrees = clonePoseDegrees(presetKeyframe.poseDegrees);
    }

    this._loadPoseDebugKeyframe(activeKeyframe);
    this.showToast('Preset keyframe restored');
  }

  _renderPoseDebugPrompt() {
    if (!this.poseDebugOutput) {
      return;
    }

    this._writePoseDebugValuesToActiveKeyframe();
    const poseDegrees = this._getPoseDebugDegrees();
    const animation = this._getActivePoseAnimation();
    const keyframe = this._getActivePoseKeyframe();
    const activeWeapon = this.game.player.getActiveArmWeapon?.();
    const animationPayload = animation
      ? {
          id: animation.id,
          label: animation.label,
          selectedKeyframeId: keyframe?.id ?? null,
          keyframes: animation.keyframes.map((entry) => ({
            id: entry.id,
            label: entry.label,
            frame: entry.frame,
            poseDegrees: clonePoseDegrees(entry.poseDegrees),
          })),
        }
      : null;
    const prompt = [
      'Use this Mega Man Legends FBX rig pose/keyframe set as the target.',
      'rawLocalPoseDegrees are the editable local joint rotations in degrees as pitch/yaw/roll.',
      'Keep the current model proportions and equipment unless I say otherwise.',
      '',
      `Active weapon: ${activeWeapon?.name ?? 'none'}`,
      `Selected animation: ${animation?.label ?? 'none'}`,
      `Selected keyframe: ${keyframe ? `${keyframe.frame}: ${keyframe.label}` : 'none'}`,
      '',
      JSON.stringify({ animation: animationPayload, rawLocalPoseDegrees: poseDegrees }, null, 2),
    ].join('\n');

    this.poseDebugOutput.value = prompt;
  }

  _copyPoseDebugPrompt() {
    const text = this.poseDebugOutput?.value ?? '';

    if (!text) {
      return;
    }

    navigator.clipboard?.writeText(text)
      .then(() => this.showToast('Pose prompt copied'))
      .catch(() => {
        this.poseDebugOutput.focus();
        this.poseDebugOutput.select();
        document.execCommand?.('copy');
        this.showToast('Pose prompt copied');
      });
  }

  _renderArmHotbar(tabs = null) {
    if (!this.armHotbar) {
      return;
    }

    this.armHotbar.innerHTML = '';

    const tabData = tabs ?? this.game.combat?.getWeaponTabData?.() ?? [];

    for (const tab of tabData) {
      const slot = document.createElement('button');
      const readyClass = {
        EMPTY: 'is-empty',
        NO_ENERGY: 'is-no-energy',
        ENERGY: 'is-no-energy',
        RECOVERY: 'is-recovery',
        CYCLE: 'is-cooldown',
        LOW_OUTPUT: 'is-low-output',
        BOTH_ENERGY_AND_OUTPUT: 'is-no-energy is-low-output',
        COOLDOWN: 'is-cooldown',
        RELOADING: 'is-reloading',
      }[tab.readyState] ?? '';

      slot.className = `arm-slot${tab.active ? ' is-active' : ''}${tab.singleGauge ? ' is-single-gauge' : ''}${readyClass ? ` ${readyClass}` : ''}`;
      slot.dataset.action = 'switch-arm-slot';
      slot.dataset.slotIndex = String(tab.slot - 1);
      slot.disabled = tab.readyState === 'EMPTY';
      slot.style.borderColor = tab.active && tab.color ? tab.color : '';
      slot.title = tab.readyState === 'EMPTY'
        ? `Slot ${tab.slot}: Empty`
        : `${tab.name} - ${tab.readyLabel}`;
      slot.innerHTML = `
        <span class="arm-slot-cooldown" style="transform: scaleY(${tab.cooldownPercent ?? 0})"></span>
        <span class="arm-slot-index">${tab.slot}</span>
        <span class="arm-slot-main">
          <span class="arm-slot-abbr">${tab.abbreviation}</span>
          <strong class="arm-slot-name">${tab.name}</strong>
          <span class="arm-slot-state">${tab.readyLabel}</span>
        </span>
        <span class="arm-slot-meters" aria-hidden="true">
          <span class="arm-slot-meter arm-slot-meter-energy"><i style="width: ${(tab.energyPercent ?? 0) * 100}%"></i></span>
          <span class="arm-slot-meter arm-slot-meter-output"><i style="width: ${(tab.outputPercent ?? 0) * 100}%"></i></span>
        </span>
      `;
      this.armHotbar.appendChild(slot);
    }
  }

  _renderWeaponTelemetry(data) {
    if (!this.weaponEnergyFill) {
      return;
    }

    if (!data) {
      this.weaponEnergyFill.style.height = '0%';
      if (this.weaponOutputFill) {
        this.weaponOutputFill.style.height = '0%';
      }
      this.energyValue.textContent = 'E 0/0 O 0%';
      this.weaponGauge?.classList.remove('is-warning', 'is-cycle', 'is-energy-blocked', 'is-recovery');
      if (this.weaponGauge) this.weaponGauge.dataset.resourceState = '';
      this.weaponEnergyTrack?.classList.remove('is-energy-warning');
      this.weaponOutputTrack?.classList.remove('is-output-warning');
      this._renderWeaponModeIndicator(null);
      if (this.weaponStatus) {
        this.weaponStatus.textContent = 'No active arm telemetry';
        this.weaponStatus.dataset.resourceState = '';
      }
      this.weaponStats?.replaceChildren();
      return;
    }

    const energyPercent = Math.round(data.energyPercent * 100);
    const outputPercent = Math.round((data.outputPercent ?? 1) * 100);
    const lowEnergy = data.energyPercent <= 0.2;
    const lowOutput = !data.singleGauge && (data.outputPercent ?? 1) <= 0.2;
    const shotCost = Number(data.energyCost ?? data.shotCost ?? data.energyPerShot ?? 0);
    const shotsRemaining = Number.isFinite(data.shotsRemaining)
      ? Math.max(0, Math.floor(data.shotsRemaining))
      : shotCost > 0
        ? Math.max(0, Math.floor((Number(data.energy) || 0) / shotCost))
        : null;
    const shotsPerMagazine = Number.isFinite(data.shotsPerMagazine)
      ? Math.max(0, Math.floor(data.shotsPerMagazine))
      : shotCost > 0
        ? Math.max(0, Math.floor((Number(data.maxEnergy) || 0) / shotCost))
        : null;
    const explicitState = String(data.resourceState ?? data.busterState ?? '').toUpperCase();
    const blockReason = String(data.cannotFireReason ?? data.blockReason ?? '').toUpperCase();
    const busterResourceState = data.unifiedBuster
      ? data.recoveryLocked || explicitState === 'RECOVERY' || blockReason === 'RECOVERY'
        ? 'RECOVERY'
        : data.cycleRemaining > 0 || data.cooldownState || explicitState === 'CYCLE' || blockReason === 'CYCLE'
          ? 'CYCLE'
          : blockReason === 'ENERGY' || blockReason === 'NO_ENERGY'
            ? 'ENERGY'
            : 'READY'
      : null;

    this.weaponGauge?.classList.toggle('is-single-gauge', Boolean(data.singleGauge));
    this.weaponGauge?.classList.toggle('is-cycle', busterResourceState === 'CYCLE');
    this.weaponGauge?.classList.toggle('is-energy-blocked', busterResourceState === 'ENERGY');
    this.weaponGauge?.classList.toggle('is-recovery', busterResourceState === 'RECOVERY');
    if (this.weaponGauge) this.weaponGauge.dataset.resourceState = busterResourceState ?? '';

    this.weaponEnergyFill.style.height = `${energyPercent}%`;
    if (this.weaponOutputFill) {
      this.weaponOutputFill.style.height = `${outputPercent}%`;
    }
    this.energyValue.textContent = data.singleGauge
      ? `BAT ${Math.floor(data.energy)}/${Math.round(data.maxEnergy)}${shotsRemaining !== null ? ` · ${shotsRemaining}/${shotsPerMagazine} shots` : ''}`
      : `E ${Math.floor(data.energy)}/${Math.round(data.maxEnergy)} O ${outputPercent}%`;
    this.weaponGauge?.classList.toggle('is-warning', lowEnergy || lowOutput || data.reloadState || data.overheatState || busterResourceState === 'RECOVERY');
    this.weaponEnergyTrack?.classList.toggle('is-energy-warning', Boolean(data.energyWarning));
    this.weaponOutputTrack?.classList.toggle('is-output-warning', Boolean(data.outputWarning));
    this._renderWeaponModeIndicator(data.modeIndicator);
    if (this.weaponStatus) {
      this.weaponStatus.textContent = data.unifiedBuster
        ? `${data.mode}: ${busterResourceState}`
        : `${data.mode}: ${data.status}`;
      this.weaponStatus.style.borderColor = data.color;
      this.weaponStatus.dataset.resourceState = busterResourceState ?? '';
    }

    const chips = [
      [data.unifiedBuster ? 'PWR' : 'ATK', data.stats.attack],
      ['ENG', data.stats.energy],
      ['RNG', data.stats.range],
      ['RPD', data.stats.rapid],
      ...(data.unifiedBuster && shotsPerMagazine !== null ? [['MAG', shotsPerMagazine]] : []),
    ];

    this.weaponStats?.replaceChildren(...chips.map(([label, value]) => {
      const chip = document.createElement('div');
      chip.className = 'weapon-chip';
      chip.style.borderColor = data.color;

      const labelElement = document.createElement('span');
      labelElement.textContent = label;

      const valueElement = document.createElement('strong');
      valueElement.textContent = String(value);

      chip.append(labelElement, valueElement);
      return chip;
    }));
  }

  _renderWeaponModeIndicator(indicator) {
    if (!this.weaponModeMark) {
      return;
    }

    const shape = WEAPON_MODE_SHAPES.has(indicator?.shape) ? indicator.shape : 'manual';
    const mode = ['main', 'alternate', 'alternate-ready'].includes(indicator?.mode) ? indicator.mode : 'main';
    const color = indicator?.color ?? '#aebbd0';
    const label = indicator?.label ?? 'Weapon Mode';

    this.weaponModeMark.className = `node-mark output-mark mode-mark mode-symbol-${shape} is-${mode}`;
    this.weaponModeMark.style.setProperty('--mode-color', color);
    this.weaponModeNode?.style.setProperty('--mode-color', color);

    if (this.weaponModeNode) {
      this.weaponModeNode.setAttribute('aria-label', label);
      this.weaponModeNode.title = label;
    }
  }

  _renderEquipment() {
    this._renderGarageWeapons();
    this.equipmentSlots.innerHTML = '';

    for (const slot of EQUIPMENT_SLOTS) {
      const item = this.game.player.equipment.get(slot);
      const slotElement = document.createElement('button');
      slotElement.className = 'equipment-slot';
      slotElement.dataset.slot = slot;
      slotElement.dataset.action = item ? 'unequip' : 'empty';
      slotElement.style.borderColor = item ? item.color : 'rgba(166,190,220,0.22)';
      slotElement.innerHTML = `
        <span class="slot-name">${slotLabel(slot)}</span>
        <span class="slot-item" style="color: ${item?.color ?? '#aebbd0'}">${item?.name ?? 'Empty'}</span>
      `;
      this.equipmentSlots.appendChild(slotElement);
    }
  }

  _renderQuestLog() {
    if (!this.questLog) {
      return;
    }

    const entries = this.game.getQuestLogEntries?.() ?? [];
    this.questLog.innerHTML = '';

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'quest-entry is-empty';
      empty.textContent = 'No active expedition tasks';
      this.questLog.appendChild(empty);
      return;
    }

    for (const entry of entries) {
      const progress = Number.isFinite(entry.progress) ? Math.max(0, Math.min(1, entry.progress)) : null;
      const card = document.createElement('div');
      card.className = `quest-entry${progress >= 1 ? ' is-complete' : ''}`;
      card.style.borderColor = entry.color ?? '#6bdcff';
      card.innerHTML = `
        <div class="quest-entry-header">
          <strong>${entry.title}</strong>
          <span style="color: ${entry.color ?? '#6bdcff'}">${entry.status}</span>
        </div>
        <p>${entry.detail}</p>
        ${progress === null ? '' : `
          <div class="quest-progress" aria-label="${entry.title} progress">
            <span style="width: ${Math.round(progress * 100)}%; background: ${entry.color ?? '#6bdcff'}"></span>
          </div>
        `}
      `;
      this.questLog.appendChild(card);
    }
  }

  _renderGarageWeapons() {
    if (!this.garageWeaponSlots) {
      return;
    }

    this.garageWeaponSlots.innerHTML = '';

    for (let i = 0; i < this.game.player.armHotbar.length; i += 1) {
      const item = this.game.player.armHotbar[i];
      const card = document.createElement('button');
      card.className = `garage-weapon-card${i === this.game.player.activeArmIndex ? ' is-active' : ''}${item ? '' : ' is-empty'}`;
      card.dataset.action = item ? 'switch-arm-slot' : 'empty';
      card.dataset.slotIndex = String(i);

      if (!item) {
        card.innerHTML = `
          <span class="garage-weapon-index">${i + 1}</span>
          <span class="garage-weapon-main">
            <strong class="garage-weapon-name">Empty</strong>
            <span class="garage-weapon-meta">Arm slot</span>
          </span>
        `;
        this.garageWeaponSlots.appendChild(card);
        continue;
      }

      const compiledPlan = this.game.getBusterPlanForSlot?.(i) ?? null;
      const compiledStats = compiledPlan?.stats ?? null;
      const totals = compiledStats ? {
        attackDamage: compiledStats.effectivePower ?? compiledStats.basePower ?? 0,
        maxEnergy: compiledStats.maxEnergy ?? 0,
        attackRange: compiledStats.rootRange ?? 0,
        attackSpeed: compiledStats.finalRapid ?? 0,
      } : item.getStatTotals();
      const chips = [
        [compiledPlan ? 'PWR' : 'ATK', totals.attackDamage ?? 0],
        ['ENG', totals.maxEnergy ?? 0],
        ['RNG', totals.attackRange ?? 0],
        ['RPD', totals.attackSpeed ?? 0],
      ].map(([label, value]) => `<span class="garage-stat-chip">${label} ${formatStatValue(label === 'RPD' ? 'attackSpeed' : label === 'ENG' ? 'maxEnergy' : label === 'RNG' ? 'attackRange' : 'attackDamage', value)}</span>`).join('');

      const itemColor = item.color ?? (compiledPlan?.isMegaBuster ? '#7ee7ff' : '#f2c84b');
      const itemMeta = compiledPlan
        ? `${compiledPlan.isMegaBuster ? 'Fixed Pulse' : 'Compiled Custom Buster'} - revision ${compiledPlan.revision ?? 1}`
        : `${RARITIES[item.rarity]?.label ?? 'Arm'} ${item.typeLabel} - Lv ${item.level}`;
      card.style.borderColor = itemColor;
      card.innerHTML = `
        <span class="garage-weapon-index">${i + 1}</span>
        <span class="garage-weapon-main">
          <strong class="garage-weapon-name" style="color: ${itemColor}">${compiledPlan?.isMegaBuster ? 'Mega Buster' : item.name}</strong>
          <span class="garage-weapon-meta">${itemMeta}</span>
          <span class="garage-stat-grid">${chips}</span>
        </span>
      `;
      this.garageWeaponSlots.appendChild(card);
    }

    for (let i = 0; i < (this.game.player.busterUpgradeSlots?.length ?? 0); i += 1) {
      const item = this.game.player.busterUpgradeSlots[i];
      const card = document.createElement('button');
      card.className = `garage-weapon-card garage-buster-upgrade${item ? '' : ' is-empty'}`;
      card.dataset.action = item ? 'unassign-buster-upgrade' : 'empty';
      card.dataset.slotIndex = String(i);

      if (!item) {
        card.innerHTML = `
          <span class="garage-weapon-index">B${i + 1}</span>
          <span class="garage-weapon-main">
            <strong class="garage-weapon-name">Empty</strong>
            <span class="garage-weapon-meta">Buster upgrade slot</span>
          </span>
        `;
        this.garageWeaponSlots.appendChild(card);
        continue;
      }

      const totals = item.getStatTotals();
      const chips = Object.entries(totals)
        .slice(0, 3)
        .map(([stat, value]) => `<span class="garage-stat-chip">${STAT_LABELS[stat] ?? stat} ${formatStatValue(stat, value)}</span>`)
        .join('');

      card.style.borderColor = item.color;
      card.innerHTML = `
        <span class="garage-weapon-index">B${i + 1}</span>
        <span class="garage-weapon-main">
          <strong class="garage-weapon-name" style="color: ${item.color}">${item.name}</strong>
          <span class="garage-weapon-meta">${RARITIES[item.rarity].label} ${item.typeLabel} - Lv ${item.level}</span>
          <span class="garage-stat-grid">${chips}</span>
        </span>
      `;
      this.garageWeaponSlots.appendChild(card);
    }
  }

  _renderInventoryActions() {
    if (!this.inventoryActions) {
      return;
    }

    const rarityCounts = this.game.inventory.items.reduce((counts, item) => {
      counts[item.rarity] = (counts[item.rarity] ?? 0) + 1;
      return counts;
    }, {});

    this.inventoryActions.innerHTML = '';

    for (const [rarityKey, rarity] of Object.entries(RARITIES)) {
      const count = rarityCounts[rarityKey] ?? 0;
      const button = document.createElement('button');
      button.dataset.action = 'salvage-rarity';
      button.dataset.rarity = rarityKey;
      button.disabled = count === 0;
      button.style.borderColor = rarity.color;
      button.style.color = rarity.color;
      button.textContent = `${rarity.label} (${count})`;
      this.inventoryActions.appendChild(button);
    }
  }

  _renderMinimap() {
    if (!this.minimap) {
      return;
    }

    const snapshot = this.game.dungeonController?.getMinimapSnapshot?.() ?? null;
    if (!snapshot) {
      this.minimap.hidden = true;
      return;
    }

    this.minimap.hidden = false;
    const number = (value) => Number(value ?? 0).toFixed(2);
    const viewBox = this._getMinimapViewBox(snapshot);
    const canZoomOut = this.minimapZoom > this.minimapMinZoom + 0.001;
    const canZoomIn = this.minimapZoom < this.minimapMaxZoom - 0.001;
    const roomMarkup = snapshot.rooms.map((room) => {
      const bounds = room.roomBounds2D;
      const classes = [
        'minimap-room',
        room.isDiscovered ? 'is-discovered' : 'is-undiscovered',
        room.isReachable ? 'is-reachable' : 'is-blocked',
        room.isCurrent ? 'is-current' : '',
        `room-${room.roomType}`,
      ].filter(Boolean).join(' ');
      return `
        <rect
          class="${classes}"
          x="${number(bounds.x)}"
          y="${number(bounds.z)}"
          width="${number(bounds.width)}"
          height="${number(bounds.depth)}"
          rx="0.8"
          ry="0.8"
        />`;
    }).join('');
    const hallwayMarkup = snapshot.hallways
      .filter((hallway) => hallway.from && hallway.to)
      .map((hallway) => `
        <line
          class="minimap-hallway ${hallway.isDiscovered ? 'is-discovered' : 'is-undiscovered'}"
          x1="${number(hallway.from.x)}"
          y1="${number(hallway.from.z)}"
          x2="${number(hallway.to.x)}"
          y2="${number(hallway.to.z)}"
        />`)
      .join('');
    const markerMarkup = snapshot.markers.map((marker) => this._renderMinimapMarker(marker, number)).join('');
    const arrowMarkup = snapshot.arrows.map((arrow) => `
      <g
        class="minimap-arrow marker-${arrow.type} ${arrow.isDim ? 'is-dim' : ''}"
        transform="translate(${number(arrow.point.x)} ${number(arrow.point.z)}) rotate(${number(arrow.angle)})"
      >
        <path d="M -1.7 -1.05 L 1.8 0 L -1.7 1.05 L -0.75 0 Z"></path>
      </g>
    `).join('');

    this.minimap.innerHTML = `
      <div class="minimap-controls" aria-label="Minimap zoom controls">
        <button
          type="button"
          class="minimap-zoom-button"
          data-action="minimap-zoom-out"
          aria-label="Zoom minimap out"
          title="Zoom out"
          ${canZoomOut ? '' : 'disabled'}
        >-</button>
        <button
          type="button"
          class="minimap-zoom-button"
          data-action="minimap-zoom-in"
          aria-label="Zoom minimap in"
          title="Zoom in"
          ${canZoomIn ? '' : 'disabled'}
        >+</button>
      </div>
      <svg
        viewBox="${number(viewBox.minX)} ${number(viewBox.minZ)} ${number(viewBox.width)} ${number(viewBox.depth)}"
        role="img"
        aria-label="Dungeon minimap"
        preserveAspectRatio="xMidYMid meet"
      >
        <g class="minimap-layer minimap-layout">
          ${hallwayMarkup}
          ${roomMarkup}
        </g>
        <g class="minimap-layer minimap-markers">
          ${markerMarkup}
        </g>
        <g class="minimap-layer minimap-arrows">
          ${arrowMarkup}
        </g>
        <g class="minimap-player" transform="translate(${number(snapshot.player.x)} ${number(snapshot.player.z)})">
          <path d="M 0 -1.35 L 1.05 1.05 L 0 0.58 L -1.05 1.05 Z"></path>
        </g>
      </svg>
    `;
  }

  _getMinimapViewBox(snapshot) {
    const bounds = snapshot?.bounds;
    if (!bounds) {
      return {
        minX: 0,
        minZ: 0,
        width: 1,
        depth: 1,
      };
    }

    const zoom = THREE.MathUtils.clamp(this.minimapZoom, this.minimapMinZoom, this.minimapMaxZoom);
    const width = Math.max(1, (bounds.width ?? 1) / zoom);
    const depth = Math.max(1, (bounds.depth ?? 1) / zoom);
    const minBoundX = bounds.minX ?? 0;
    const minBoundZ = bounds.minZ ?? 0;
    const maxBoundX = minBoundX + (bounds.width ?? width);
    const maxBoundZ = minBoundZ + (bounds.depth ?? depth);
    const targetX = snapshot.player?.x ?? minBoundX + width * 0.5;
    const targetZ = snapshot.player?.z ?? minBoundZ + depth * 0.5;
    const minX = THREE.MathUtils.clamp(targetX - width * 0.5, minBoundX, maxBoundX - width);
    const minZ = THREE.MathUtils.clamp(targetZ - depth * 0.5, minBoundZ, maxBoundZ - depth);

    return {
      minX,
      minZ,
      width,
      depth,
    };
  }

  _adjustMinimapZoom(delta) {
    const previousZoom = this.minimapZoom;
    this.minimapZoom = THREE.MathUtils.clamp(
      this.minimapZoom + delta,
      this.minimapMinZoom,
      this.minimapMaxZoom,
    );

    if (Math.abs(this.minimapZoom - previousZoom) > 0.001) {
      this._renderMinimap();
    }
  }

  _renderMinimapMarker(marker, number) {
    const x = number(marker.point.x);
    const y = number(marker.point.z);
    const dimClass = marker.isReachable === false ? ' is-dim' : '';
    const className = `minimap-marker marker-${marker.type}${dimClass}`;

    if (marker.type === 'enemy') {
      return `<circle class="${className}" cx="${x}" cy="${y}" r="0.9" />`;
    }

    if (marker.type === 'keyHoldingElite') {
      return `
        <g class="${className}" transform="translate(${x} ${y})">
          <circle r="0.95"></circle>
          <circle class="marker-ring" r="1.42"></circle>
        </g>`;
    }

    if (marker.type === 'chest') {
      return `<rect class="${className}" x="${number(marker.point.x - 0.9)}" y="${number(marker.point.z - 0.9)}" width="1.8" height="1.8" rx="0.15" />`;
    }

    if (marker.type === 'keycardChest') {
      return `
        <g class="${className}" transform="translate(${x} ${y})">
          <rect x="-0.95" y="-0.95" width="1.9" height="1.9" rx="0.18"></rect>
          <path class="marker-highlight" d="M 0 -1.35 L 1.1 0 L 0 1.35 L -1.1 0 Z"></path>
        </g>`;
    }

    if (marker.type === 'keycard') {
      return `<path class="${className}" d="M ${x} ${number(marker.point.z - 1.28)} L ${number(marker.point.x + 1.05)} ${y} L ${x} ${number(marker.point.z + 1.28)} L ${number(marker.point.x - 1.05)} ${y} Z" />`;
    }

    if (marker.type === 'usableDoor') {
      return `
        <g class="${className}" transform="translate(${x} ${y})">
          <path d="M -1.15 -1.0 L 1.15 0 L -1.15 1.0 Z"></path>
        </g>`;
    }

    if (marker.type === 'lockedDoor' || marker.type === 'shrineDoor') {
      return `
        <g class="${className}" transform="translate(${x} ${y})">
          <rect x="-1.05" y="-1.05" width="2.1" height="2.1" rx="0.25"></rect>
          <line x1="-0.72" y1="0" x2="0.72" y2="0"></line>
        </g>`;
    }

    if (marker.type === 'boss') {
      return `
        <g class="${className}" transform="translate(${x} ${y})">
          <circle r="1.2"></circle>
          <path d="M -0.65 -0.1 L 0 -1.2 L 0.65 -0.1 L 0.35 0.95 L -0.35 0.95 Z"></path>
        </g>`;
    }

    if (marker.type === 'shrine') {
      return `
        <g class="${className}" transform="translate(${x} ${y})">
          <path d="M 0 -1.45 L 1.35 -0.38 L 0.82 1.25 L -0.82 1.25 L -1.35 -0.38 Z"></path>
        </g>`;
    }

    if (marker.type === 'keySeeker') {
      return `
        <g class="${className}" transform="translate(${x} ${y})">
          <circle r="1.18"></circle>
          <path d="M 0 -1.6 L 0.45 -0.28 L 1.6 0 L 0.45 0.28 L 0 1.6 L -0.45 0.28 L -1.6 0 L -0.45 -0.28 Z"></path>
        </g>`;
    }

    return `<circle class="${className}" cx="${x}" cy="${y}" r="0.8" />`;
  }

  _renderMapEventPrompt() {
    if (!this.eventPrompt) {
      return;
    }

    const event = this.game.getNearestInteractable?.() ?? this.game.mapEvents?.getNearestInteractable?.();
    if (!event) {
      this.eventPrompt.hidden = true;
      return;
    }

    const label = event.label ?? event.variant?.label ?? event.config.label;
    const color = event.color ?? event.variant?.color ?? event.config.color;
    this.eventPrompt.hidden = false;
    this.eventPrompt.style.borderColor = `#${color.toString(16).padStart(6, '0')}`;
    this.eventPrompt.innerHTML = `<span>E</span><strong>${label}</strong>`;
  }

  _renderBuffTray() {
    if (!this.buffTray) {
      return;
    }

    const buffs = this.game.player.getTemporaryBuffs?.() ?? [];
    this.buffTray.innerHTML = '';

    for (const buff of buffs) {
      const chip = document.createElement('div');
      chip.className = 'buff-chip';
      chip.style.borderColor = buff.color;
      chip.style.color = buff.color;
      chip.innerHTML = `<strong>${buff.label}</strong><span>${Math.ceil(buff.remaining)}s</span>`;
      this.buffTray.appendChild(chip);
    }
  }

  _renderInventoryItems() {
    this.inventoryItems.innerHTML = '';
    const recoveryItems = this.game.busterMigrationRecovery ?? [];
    if (recoveryItems.length > 0) {
      const recovery = document.createElement('section');
      recovery.className = 'migration-recovery';
      recovery.innerHTML = `
        <strong>Roll's Migration Recovery</strong>
        <span>${recoveryItems.length} authoritative item${recoveryItems.length === 1 ? '' : 's'} waiting for inventory space.</span>
        <div class="migration-recovery-items">
          ${recoveryItems.map((item, index) => `
            <button type="button" data-action="recover-migration-item" data-recovery-index="${index}">
              Recover ${item.name}
            </button>
          `).join('')}
        </div>
      `;
      this.inventoryItems.appendChild(recovery);
    }

    if (this.game.inventory.items.length === 0 && recoveryItems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'inventory-empty';
      empty.textContent = 'No salvage';
      this.inventoryItems.appendChild(empty);
      return;
    }

    for (const item of this.game.inventory.items) {
      const card = document.createElement('div');
      card.className = 'inventory-item';
      card.dataset.itemId = item.id;
      card.style.borderColor = item.color;
      const armSlotButtons = this._renderInventoryArmAssignmentButtons(item);
      const busterUpgradeButtons = isBusterUpgrade(item)
        ? `
          <div class="arm-assignments" aria-label="Assign buster upgrade">
            ${[0, 1, 2, 3].map((slotIndex) => `
              <button
                data-action="assign-buster-upgrade"
                data-item-id="${item.id}"
                data-slot-index="${slotIndex}"
                title="Install into Buster upgrade slot ${slotIndex + 1}"
              >B${slotIndex + 1}</button>
            `).join('')}
          </div>
        `
        : '';
      card.innerHTML = `
        <div class="item-main">
          <strong style="color: ${item.color}">${item.name}</strong>
          <span>${RARITIES[item.rarity].label} ${item.category} - ${item.typeLabel} - Lv ${item.level}</span>
        </div>
        <div class="item-actions">
          <button data-action="equip" data-item-id="${item.id}">Equip</button>
          ${armSlotButtons}
          ${busterUpgradeButtons}
          <button data-action="discard" data-item-id="${item.id}">Scrap</button>
        </div>
      `;
      this.inventoryItems.appendChild(card);
    }
  }

  _renderCraftingMaterials() {
    if (!this.materialInventory) return;
    const materials = this.game.rollSalvageStorage?.getParts?.() ?? [];
    this.materialInventory.innerHTML = '';

    if (materials.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'material-empty';
      empty.textContent = 'Roll has not identified any intact Reaverbot parts yet';
      this.materialInventory.appendChild(empty);
      return;
    }

    for (const material of materials) {
      const card = document.createElement('article');
      card.className = 'material-card';
      card.style.borderColor = material.color;
      const source = material.lastSource?.moduleLabel
        ? `Last source: ${material.lastSource.moduleLabel}`
        : material.family;
      const tags = material.craftingTags.slice(0, 3).join(' / ');
      card.innerHTML = `
        <span class="material-quantity">${material.quantity}</span>
        <span class="material-main">
          <strong style="color: ${material.color}">${material.name}</strong>
          <span>${source}</span>
          <small>${tags}</small>
        </span>
      `;
      this.materialInventory.appendChild(card);
    }
  }

  _renderInventoryArmAssignmentButtons(item) {
    if (!isArmWeapon(item)) {
      return '';
    }

    const assignments = [];

    if (isBusterArm(item)) {
      assignments.push({ slotIndex: 0, label: 'B', title: 'Replace the fixed Buster slot' });
    } else if (isUtilityArm(item)) {
      assignments.push({ slotIndex: 3, label: 'U', title: 'Equip as a Utility Arm' });
    } else if (isCombatArm(item)) {
      assignments.push(
        { slotIndex: 1, label: '2', title: 'Load into combat arm slot 2' },
        { slotIndex: 2, label: '3', title: 'Load into combat arm slot 3' },
      );
    }

    if (assignments.length === 0) {
      return '';
    }

    return `
      <div class="arm-assignments" aria-label="Assign arm weapon">
        ${assignments.map((assignment) => `
          <button
            data-action="assign-arm-slot"
            data-item-id="${item.id}"
            data-slot-index="${assignment.slotIndex}"
            title="${assignment.title}"
          >${assignment.label}</button>
        `).join('')}
      </div>
    `;
  }

  _runBusterLabAction(action, {
    successMessage = 'Buster Lab updated',
    failureMessage = 'Buster Lab action failed',
    render = true,
    onSuccess = null,
  } = {}) {
    const execute = async () => {
      let pending;
      try {
        pending = action?.();
      } catch (error) {
        this.showToast(error?.message ?? failureMessage, '#ff9f73');
        return { ok: false, error };
      }
      try {
        const result = await pending;
        const ok = result?.ok !== false && result !== undefined && result !== null;
        if (ok) onSuccess?.(result);
        this.showToast(
          result?.message ?? (ok ? successMessage : failureMessage),
          ok ? '#7df8ff' : '#ff9f73',
        );
        if (render && this.game.inventoryOpen) this._renderBusterLab();
        return result;
      } catch (error) {
        this.showToast(error?.message ?? failureMessage, '#ff9f73');
        if (render && this.game.inventoryOpen) this._renderBusterLab();
        return { ok: false, error };
      }
    };
    const queued = this.busterLabActionQueue.then(execute, execute);
    this.busterLabActionQueue = queued.catch(() => null);
    return queued;
  }

  _renderBusterAfterMaybeAsync(result) {
    if (result?.then) {
      result.then(() => this._renderBusterLab()).catch((error) => {
        this.showToast(error?.message ?? 'The Buster Lab could not update.', '#ff9f73');
        this._renderBusterLab();
      });
      return;
    }
    this._renderBusterLab();
  }

  _downloadJson(payload, filename = 'buster-lab-export.json') {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  _getBusterMaterializationRouteChoices() {
    return Object.fromEntries([...this.busterMaterializationSuggestion?.querySelectorAll(
      '[data-buster-materialization-module]',
    ) ?? []].map((select) => [select.dataset.busterMaterializationModule, select.value]));
  }

  _bindEvents() {
    this.inventoryButton?.addEventListener('click', () => {
      this.game.setInventoryOpen(!this.game.inventoryOpen);
    });

    this.armHotbar?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action="switch-arm-slot"]');
      if (!button || button.disabled) {
        return;
      }

      this.game.combat?.switchArmSlot(Number(button.dataset.slotIndex));
      this._renderArmHotbar();
      this.renderInventory();
    });

    const applyMinimapZoomAction = (action) => {
      const delta = action === 'minimap-zoom-in'
        ? this.minimapZoomStep
        : -this.minimapZoomStep;
      this._adjustMinimapZoom(delta);
    };

    this.minimap?.addEventListener('pointerdown', (event) => {
      const button = event.target?.closest?.('button[data-action^="minimap-zoom"]');
      if (!button || button.disabled) {
        return;
      }
      if (Number.isFinite(event.button) && event.button !== 0) {
        return;
      }

      event.preventDefault();
      applyMinimapZoomAction(button.dataset.action);
    });

    this.minimap?.addEventListener('click', (event) => {
      if (event.detail !== 0) {
        return;
      }

      const button = event.target?.closest?.('button[data-action^="minimap-zoom"]');
      if (!button || button.disabled) {
        return;
      }

      event.preventDefault();
      applyMinimapZoomAction(button.dataset.action);
    });

    this.minimap?.addEventListener('wheel', (event) => {
      if (this.minimap.hidden) {
        return;
      }

      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      this._adjustMinimapZoom(direction * this.minimapZoomStep);
    }, { passive: false });

    this.poseDebugPanel?.addEventListener('input', (event) => {
      const input = event.target.closest('input[data-pose-joint]');

      if (!input) {
        return;
      }

      this._updatePoseDebugValue(input.dataset.poseJoint, input.dataset.poseAxis, input.value);
    });

    this.poseDebugPanel?.addEventListener('keydown', (event) => {
      const numberInput = event.target.closest('input[data-pose-number-joint]');

      if (!numberInput) {
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        this._commitPoseDebugNumberInput(numberInput);
        numberInput.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this._syncPoseDebugAxisControl(numberInput.dataset.poseNumberJoint, numberInput.dataset.poseNumberAxis);
        numberInput.blur();
      }
    });

    this.poseDebugPanel?.addEventListener('change', (event) => {
      const numberInput = event.target.closest('input[data-pose-number-joint]');
      if (numberInput) {
        this._commitPoseDebugNumberInput(numberInput);
        return;
      }

      const select = event.target.closest('select');

      if (!select) {
        return;
      }

      if (select.id === 'pose-debug-animation') {
        this._selectPoseDebugAnimation(select.value);
      } else if (select.id === 'pose-debug-keyframe') {
        this._selectPoseDebugKeyframe(select.value);
      } else if (select.id === 'platform-debug-jump-height') {
        this.game.setDebugJumpHeightPreset?.(select.value);
        this._syncPlatformDebugControls();
      } else if (select.id === 'platform-debug-gravity') {
        this.game.setDebugGravityPreset?.(select.value);
        this._syncPlatformDebugControls();
      } else if (select.id === 'buster-debug-build') {
        this.busterDebugSelectedBuildId = select.value || 'build-a';
        this._syncBusterDebugControls();
      } else if (['buster-debug-targets', 'buster-debug-profile', 'buster-debug-depth'].includes(select.id)) {
        const update = select.id === 'buster-debug-targets'
          ? { targetCount: Number(select.value) }
          : select.id === 'buster-debug-depth'
            ? { depthLevel: Number(select.value) }
            : { profile: select.value };
        this.game.setBusterRangeBenchmarkOptions?.(update);
        this._syncBusterDebugControls();
      }
    });

    this.poseDebugPanel?.addEventListener('click', (event) => {
      const numberInput = event.target.closest('input[data-pose-number-joint]');
      if (numberInput) {
        numberInput.select();
        this.focusPoseDebugJoint(numberInput.dataset.poseNumberJoint, { scroll: false });
        return;
      }

      const button = event.target.closest('button');

      if (!button) {
        return;
      }

      const action = button.dataset.action;

      if (action === 'pose-debug-tab') {
        this._selectPoseDebugTab(button.dataset.debugTab);
      } else if (action === 'pose-close') {
        this.game.setPoseDebugOpen(false);
      } else if (action === 'pose-zero') {
        this._resetPoseDebugValues();
      } else if (action === 'pose-restore') {
        this._restorePoseDebugKeyframe();
      } else if (action === 'pose-copy') {
        this._copyPoseDebugPrompt();
      } else if (action === 'pose-add-keyframe') {
        this._addPoseDebugKeyframe();
      } else if (action === 'pose-delete-keyframe') {
        this._deletePoseDebugKeyframe();
      } else if (action === 'platform-spawn') {
        this._spawnPlatformDebugBlock();
      } else if (action === 'platform-clear') {
        const removed = this.game.clearDebugPlatforms?.() ?? 0;
        this._syncPlatformDebugControls();
        this.showToast(`${removed} debug block${removed === 1 ? '' : 's'} cleared`);
      } else if (action === 'buster-debug-grant') {
        this._runBusterLabAction(
          () => this.game.grantBusterLabDebugKit?.(),
          {
            successMessage: 'Custom Buster test kit granted',
            failureMessage: 'Unable to grant Buster test kit',
            render: false,
            onSuccess: () => this._syncBusterDebugControls(),
          },
        );
      } else if (action === 'buster-debug-range') {
        this._runBusterLabAction(
          () => this.game.enterBusterTestRange?.(this.busterDebugSelectedBuildId),
          {
            successMessage: 'Benchmark range active',
            failureMessage: 'Selected Buster cannot enter the range',
            render: false,
            onSuccess: () => this._syncBusterDebugControls(),
          },
        );
      } else if (action === 'buster-debug-sandbox') {
        this._runBusterLabAction(
          () => this.game.enterBusterSandbox?.(this.busterDebugSelectedBuildId),
          {
            successMessage: 'Disposable Buster dungeon active',
            failureMessage: 'Selected Buster cannot enter the sandbox',
            render: false,
            onSuccess: () => this._syncBusterDebugControls(),
          },
        );
      } else if (action === 'buster-debug-open-lab') {
        this.game.setInventoryOpen(true, { mode: 'roll' });
        this._selectRollWorkshopTab('buster');
      } else if (action === 'buster-debug-refill') {
        this._runBusterLabAction(
          () => this.game.refillBusterDebugBatteries?.(),
          {
            successMessage: 'Buster batteries refilled',
            failureMessage: 'Buster batteries could not be reset',
            render: false,
            onSuccess: () => this._syncBusterDebugControls(),
          },
        );
      }
    });

    this.restartButton.addEventListener('click', () => {
      window.location.reload();
    });

    this.inventoryPanel.addEventListener('change', (event) => {
      if (event.target === this.busterBlueprintImportFile) {
        const file = event.target.files?.[0];
        if (!file) return;
        file.text().then((text) => this._runBusterLabAction(
          () => this.game.importBusterBlueprint?.(text),
          {
            successMessage: 'Blueprint imported',
            failureMessage: 'Blueprint import failed',
            onSuccess: (result) => {
              const id = result.blueprintId ?? result.blueprint?.blueprintId;
              if (id) {
                this.busterLabSelectedBlueprintId = id;
                this.busterLabSelectedBuildId = id;
              }
            },
          },
        )).catch((error) => this.showToast(error.message, '#ff9f73'));
        event.target.value = '';
        return;
      }
      const tuning = event.target.closest('[data-buster-tuning]');
      if (tuning) {
        const result = this.game.updateBusterDraft?.(this.busterLabSelectedBuildId, {
          type: 'setTuning',
          stat: tuning.dataset.busterTuning,
          value: Number(tuning.value),
        });
        this._renderBusterAfterMaybeAsync(result);
        return;
      }

      const program = event.target.closest('[data-buster-program]');
      if (program) {
        const result = this.game.updateBusterDraft?.(this.busterLabSelectedBuildId, {
          type: 'setProgramSlot',
          slot: program.dataset.busterProgram,
          moduleId: program.value || null,
        });
        this._renderBusterAfterMaybeAsync(result);
        return;
      }

      const blueprint = event.target.closest('[data-buster-blueprint-select]');
      if (blueprint) {
        this.busterLabSelectedBlueprintId = blueprint.value || null;
        this.busterLabSelectedBuildId = blueprint.value || 'build-a';
        const result = this.game.selectBusterBlueprint?.(blueprint.value || null);
        this._renderBusterAfterMaybeAsync(result);
        return;
      }

      const benchmark = event.target.closest('[data-buster-benchmark]');
      if (benchmark) {
        const key = benchmark.dataset.busterBenchmark;
        const value = key === 'targetCount' || key === 'depthLevel'
          ? Number(benchmark.value)
          : benchmark.value;
        const update = { [key]: value };
        const result = this.game.setBusterRangeBenchmarkOptions?.(update)
          ?? this.game.configureBusterBenchmark?.(update);
        this._renderBusterAfterMaybeAsync(result);
        return;
      }

      const calibration = event.target.closest('[data-buster-calibration-slot]');
      if (calibration) {
        this._runBusterLabAction(
          () => this.game.setMegaBusterCalibration?.(
            Number(calibration.dataset.busterCalibrationSlot),
            calibration.value || null,
          ),
          {
            successMessage: 'Mega Buster calibration updated',
            failureMessage: 'Calibration could not be installed',
          },
        );
      }
    });

    this.inventoryPanel.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) {
        return;
      }

      const action = button.dataset.action;

      if (action === 'identify-scrap') {
        this.game.identifyReaverbotScrap?.();
      } else if (action === 'buster-export-recovery') {
        this._runBusterLabAction(
          () => this.game.exportBusterRecoveryData?.(),
          {
            successMessage: 'Recovery copy exported',
            failureMessage: 'Recovery export failed',
            render: false,
            onSuccess: (result) => this._downloadJson(result.payload, result.filename),
          },
        );
      } else if (action === 'buster-export-blueprint') {
        this._runBusterLabAction(
          () => this.game.exportBusterBlueprint?.(this.busterLabSelectedBlueprintId),
          {
            successMessage: 'Blueprint exported',
            failureMessage: 'Select a blueprint to export',
            render: false,
            onSuccess: (result) => this._downloadJson(result.payload, result.filename),
          },
        );
      } else if (action === 'buster-import-blueprint') {
        this.busterBlueprintImportFile?.click();
      } else if (action === 'buster-storage-reload') {
        this._runBusterLabAction(
          () => this.game.reloadBusterLabDurableState?.(),
          { successMessage: 'Durable Lab state reloaded', failureMessage: 'Lab reload failed' },
        );
      } else if (action === 'buster-adopt-v1') {
        const preview = this.game.getLegacyBusterAdoptionPreview?.();
        if (preview?.eligible && globalThis.confirm?.('Adopt the untouched legacy v1 Lab payload into this campaign? The source will be retained.')) {
          this._runBusterLabAction(
            () => this.game.adoptLegacyBusterLab?.(),
            { successMessage: 'Legacy Lab data adopted', failureMessage: 'Legacy adoption failed' },
          );
        }
      } else if (action === 'buster-new-campaign') {
        if (globalThis.confirm?.('Start a new campaign? This rotates the save context and resets this prototype run. The previous Lab payload remains dormant for recovery.')) {
          this._runBusterLabAction(
            () => this.game.beginNewBusterCampaign?.(),
            { successMessage: 'New campaign created', failureMessage: 'New campaign failed', render: false },
          );
        }
      } else if (action === 'roll-workshop-tab') {
        this._selectRollWorkshopTab(button.dataset.rollTab);
      } else if (action === 'buster-select-build') {
        this.busterLabSelectedBuildId = button.dataset.buildId;
        this.busterLabSelectedBlueprintId = null;
        this._renderBusterLab();
      } else if (action === 'buster-buy-chassis') {
        this._runBusterLabAction(
          () => this.game.purchaseSecondBusterChassis?.(),
          {
            successMessage: 'Workshop Chassis fabricated',
            failureMessage: 'Unable to fabricate chassis',
            onSuccess: () => { this.busterLabSelectedBuildId = 'build-b'; },
          },
        );
      } else if (action === 'buster-fabricate') {
        this._runBusterLabAction(
          () => this.game.fabricateBusterModule?.(button.dataset.moduleId, {
            routeId: button.dataset.routeId || undefined,
          }),
          { successMessage: 'Module fabricated', failureMessage: 'Fabrication failed' },
        );
      } else if (action === 'buster-save') {
        this._runBusterLabAction(
          () => this.game.saveBusterDraft?.(this.busterLabSelectedBuildId),
          { successMessage: 'Buster revision saved', failureMessage: 'Draft is invalid' },
        );
      } else if (action === 'buster-equip') {
        this._runBusterLabAction(
          () => this.game.equipCustomBuster?.(this.busterLabSelectedBuildId, Number(button.dataset.slotIndex)),
          { successMessage: 'Custom Buster equipped', failureMessage: 'Unable to equip Buster' },
        );
      } else if (action === 'buster-test-range') {
        this._runBusterLabAction(
          () => this.game.enterBusterTestRange?.(this.busterLabSelectedBuildId),
          {
            successMessage: 'Benchmark range active',
            failureMessage: 'Draft cannot enter the range',
            render: false,
          },
        );
      } else if (action === 'buster-test-sandbox') {
        this._runBusterLabAction(
          () => this.game.enterBusterSandbox?.(this.busterLabSelectedBuildId),
          {
            successMessage: 'Disposable Buster dungeon active',
            failureMessage: 'Draft cannot enter the sandbox dungeon',
            render: false,
          },
        );
      } else if (action === 'buster-blueprint-new') {
        this._runBusterLabAction(
          () => this.game.createBusterBlueprint?.(this.busterLabSelectedBuildId),
          {
            successMessage: 'Blueprint created',
            failureMessage: 'Blueprint could not be created',
            onSuccess: (result) => {
              const id = result.blueprintId ?? result.blueprint?.blueprintId ?? result.blueprint?.buildId;
              if (id) {
                this.busterLabSelectedBlueprintId = id;
                this.busterLabSelectedBuildId = id;
              }
            },
          },
        );
      } else if (action === 'buster-blueprint-save') {
        this._runBusterLabAction(
          () => this.game.saveBusterBlueprint?.(this.busterLabSelectedBlueprintId),
          { successMessage: 'Blueprint saved', failureMessage: 'Blueprint could not be saved' },
        );
      } else if (action === 'buster-blueprint-delete') {
        this._runBusterLabAction(
          () => this.game.deleteBusterBlueprint?.(this.busterLabSelectedBlueprintId),
          {
            successMessage: 'Blueprint deleted',
            failureMessage: 'Blueprint could not be deleted',
            onSuccess: () => {
              this.busterLabSelectedBlueprintId = null;
              this.busterLabSelectedBuildId = 'build-a';
              this.pendingBusterMaterialization = null;
            },
          },
        );
      } else if (action === 'buster-materialize-suggest') {
        this._runBusterLabAction(
          () => this.game.suggestBusterMaterialization?.(
            this.busterLabSelectedBlueprintId,
            this.busterMaterializeTarget?.value || 'build-a',
          ),
          {
            successMessage: 'Materialization plan prepared',
            failureMessage: 'Materialization could not be planned',
            onSuccess: (result) => {
              this.pendingBusterMaterialization = result.suggestion ?? result.materialization ?? result;
            },
          },
        );
      } else if (action === 'buster-materialize-confirm') {
        const suggestion = this.pendingBusterMaterialization;
        const routes = this._getBusterMaterializationRouteChoices();
        this._runBusterLabAction(
          () => this.game.confirmBusterMaterialization?.({
            suggestionId: suggestion?.suggestionId ?? suggestion?.id,
            blueprintId: this.busterLabSelectedBlueprintId,
            expectedRevision: suggestion?.expectedRevision ?? suggestion?.revision,
            expectedWriteId: suggestion?.expectedWriteId,
            routes,
          }),
          {
            successMessage: 'Blueprint materialized atomically',
            failureMessage: 'Materialization failed without consuming resources',
            onSuccess: () => { this.pendingBusterMaterialization = null; },
          },
        );
      } else if (action === 'equip') {
        this._equipInventoryItem(button.dataset.itemId);
      } else if (action === 'assign-arm-slot') {
        this._assignArmWeaponToSlot(button.dataset.itemId, Number(button.dataset.slotIndex));
      } else if (action === 'assign-buster-upgrade') {
        this._assignBusterUpgradeToSlot(button.dataset.itemId, Number(button.dataset.slotIndex));
      } else if (action === 'unassign-buster-upgrade') {
        this._runBusterLabAction(
          () => this.game.unassignLegacyBusterUpgrade?.(Number(button.dataset.slotIndex)),
          {
            successMessage: 'Buster Part returned to inventory',
            failureMessage: 'Buster Part could not be removed',
          },
        );
      } else if (action === 'recover-migration-item') {
        const result = this.game.recoverLegacyMigrationItem?.(Number(button.dataset.recoveryIndex));
        this.showToast(result?.message ?? 'Migration recovery unavailable', result?.ok ? '#7df8ff' : '#ff9f73');
        this.renderInventory();
      } else if (action === 'discard') {
        this._discardInventoryItem(button.dataset.itemId);
      } else if (action === 'salvage-rarity') {
        this._salvageRarity(button.dataset.rarity);
      } else if (action === 'optimize-equipment') {
        this._optimizeEquipment();
      } else if (action === 'switch-arm-slot') {
        this.game.combat?.switchArmSlot(Number(button.dataset.slotIndex));
        this.renderInventory();
      } else if (action === 'unequip') {
        this._unequipSlot(button.dataset.slot);
      } else if (action === 'close') {
        this.game.setInventoryOpen(false);
      }
    });

    this.inventoryPanel.addEventListener('mousemove', (event) => {
      const itemCard = event.target.closest('.inventory-item');
      const equipmentSlot = event.target.closest('.equipment-slot');

      if (itemCard) {
        const item = this.game.inventory.findItem(itemCard.dataset.itemId);
        if (item) {
          this._showTooltip(item, event.clientX, event.clientY);
        }
      } else if (equipmentSlot) {
        const item = this.game.player.equipment.get(equipmentSlot.dataset.slot);
        if (item) {
          this._showTooltip(item, event.clientX, event.clientY);
        } else {
          this.hideTooltip();
        }
      } else {
        this.hideTooltip();
      }
    });

    this.inventoryPanel.addEventListener('mouseleave', () => this.hideTooltip());
  }

  async _equipInventoryItem(itemId) {
    const pendingItem = this.game.inventory.findItem(itemId);
    if (!pendingItem) return;
    if (isBusterUpgrade(pendingItem)) {
      await this._assignBusterUpgradeToSlot(itemId, this._getPreferredBusterUpgradeSlot());
      return;
    }
    const customSlot = isArmWeapon(pendingItem)
      ? (isBusterArm(pendingItem)
        ? 0
        : isUtilityArm(pendingItem)
          ? 3
          : this.game.player.activeArmIndex === 1 || this.game.player.activeArmIndex === 2
            ? this.game.player.activeArmIndex
            : 1)
      : null;
    const displaced = customSlot == null ? null : this.game.player.armHotbar[customSlot];
    const durablyDisplacedCustom = displaced?.type === 'customBusterArm';
    if (durablyDisplacedCustom) {
      const committed = await this.game.handleDisplacedCustomBuster?.(customSlot, displaced);
      if (!committed) {
        this.showToast('The arm slot change could not be saved', '#ff9f73');
        return;
      }
    }
    const item = this.game.inventory.removeItem(itemId);
    if (!item) {
      return;
    }

    let previous = null;
    let preferredSlot = null;

    if (isArmWeapon(item)) {
      preferredSlot = isBusterArm(item)
        ? 0
        : isUtilityArm(item)
          ? 3
          : this.game.player.activeArmIndex === 1 || this.game.player.activeArmIndex === 2
            ? this.game.player.activeArmIndex
            : 1;
      previous = this.game.player.assignArmWeaponToSlot(preferredSlot, item);
    } else if (isBusterUpgrade(item)) {
      previous = this.game.player.assignBusterUpgradeToSlot(this._getPreferredBusterUpgradeSlot(), item);
    } else {
      previous = this.game.player.equipment.equip(item);
    }

    if (previous && !durablyDisplacedCustom) {
      this.game.inventory.addItem(previous);
    }

    this.renderInventory();
  }

  async _assignArmWeaponToSlot(itemId, slotIndex) {
    const pendingItem = this.game.inventory.findItem(itemId);
    if (!pendingItem) return;
    const displaced = this.game.player.armHotbar[slotIndex];
    const durablyDisplacedCustom = displaced?.type === 'customBusterArm';
    if (durablyDisplacedCustom) {
      const committed = await this.game.handleDisplacedCustomBuster?.(slotIndex, displaced);
      if (!committed) {
        this.showToast('The arm slot change could not be saved', '#ff9f73');
        return;
      }
    }
    const item = this.game.inventory.removeItem(itemId);
    if (!item) {
      return;
    }

    if (!isArmWeapon(item)) {
      this.game.inventory.addItem(item);
      return;
    }

    const previous = this.game.player.assignArmWeaponToSlot(slotIndex, item);
    if (previous && !durablyDisplacedCustom) {
      this.game.inventory.addItem(previous);
    }

    const slotLabel = slotIndex === 0 ? 'Buster' : slotIndex === 3 ? 'Utility Arm' : `slot ${slotIndex + 1}`;
    this.showToast(`${item.typeLabel} loaded in ${slotLabel}`, item.color);
    this.renderInventory();
  }

  async _assignBusterUpgradeToSlot(itemId, slotIndex) {
    const item = this.game.inventory.findItem(itemId);
    if (!item || !isBusterUpgrade(item)) return;
    const result = await this.game.assignLegacyBusterUpgrade?.(itemId, slotIndex);
    if (!result?.ok) {
      this.showToast(result?.message ?? 'The Buster Part move could not be saved', '#ff9f73');
      return;
    }
    this.showToast(`${item.typeLabel} installed in Buster ${slotIndex + 1}`, item.color);
    this.renderInventory();
  }

  _getPreferredBusterUpgradeSlot() {
    const slots = this.game.player.busterUpgradeSlots ?? [];
    const emptyIndex = slots.findIndex((item) => !item);

    if (emptyIndex >= 0) {
      return emptyIndex;
    }

    let weakestIndex = 0;
    let weakestPower = Infinity;
    for (let i = 0; i < slots.length; i += 1) {
      const power = getItemPower(slots[i]);
      if (power < weakestPower) {
        weakestPower = power;
        weakestIndex = i;
      }
    }

    return weakestIndex;
  }

  _unequipSlot(slot) {
    const item = this.game.player.equipment.unequip(slot);

    if (!item) {
      return;
    }

    if (!this.game.inventory.addItem(item)) {
      this.game.player.equipment.equip(item, slot);
    }

    this.renderInventory();
  }

  async _discardInventoryItem(itemId) {
    const result = await this.game.discardInventoryItem?.(itemId);
    if (!result?.ok) this.showToast(result?.message ?? 'The item could not be discarded', '#ff9f73');
    this.renderInventory();
  }

  async _salvageRarity(rarity) {
    const result = await this.game.salvageInventoryRarity?.(rarity);
    if (!result?.ok) {
      this.showToast(result?.message ?? 'Nothing was salvaged', '#ff9f73');
      return;
    }
    this.hideTooltip();
    this.showToast(`Salvaged ${result.count} ${RARITIES[rarity]?.label ?? 'items'} for ${result.gained}z`);
    this.renderInventory();
  }

  async _optimizeEquipment() {
    const player = this.game.player;
    const pool = this._collectOptimizationPool();
    const usedItemIds = new Set();
    const selectedSlots = new Map();
    const preservedCustomSlots = new Map([1, 2]
      .map((slotIndex) => [slotIndex, player.armHotbar[slotIndex]])
      .filter(([, item]) => item?.type === 'customBusterArm'));

    const takeBestForSlot = (slot) => {
      const best = pool
        .filter((item) => !usedItemIds.has(item.id) && itemFitsSlot(item, slot))
        .sort(compareByPower)[0] ?? null;

      if (best) {
        usedItemIds.add(best.id);
        selectedSlots.set(slot, best);
      }
    };

    const buster = this.game.busterLabEnabled
      ? player.armHotbar[0] ?? null
      : pool
        .filter((item) => isBusterArm(item))
        .sort(compareByPower)
        [0] ?? player.armHotbar[0] ?? null;
    const armLoadout = pool
      .filter((item) => isCombatArm(item))
      .sort(compareByPower)
      .slice(0, 2 - preservedCustomSlots.size);
    const utilityLoadout = pool
      .filter((item) => isUtilityArm(item))
      .sort(compareByPower);
    const busterUpgrades = pool
      .filter((item) => isBusterUpgrade(item))
      .sort(compareByPower)
      .slice(0, player.busterUpgradeSlots?.length ?? 4);

    if (buster) {
      usedItemIds.add(buster.id);
    }
    for (const item of armLoadout) {
      usedItemIds.add(item.id);
    }
    for (const item of utilityLoadout) {
      usedItemIds.add(item.id);
    }
    for (const item of busterUpgrades) {
      usedItemIds.add(item.id);
    }

    for (const slot of EQUIPMENT_SLOTS) {
      if (slot !== 'weapon' && slot !== 'hands') {
        takeBestForSlot(slot);
      }
    }

    if (!this.game.busterLabEnabled) {
      const committed = await this.game.commitLegacyBusterOptimization?.(busterUpgrades);
      if (!committed?.ok) {
        this.showToast(committed?.message ?? 'Optimize could not be saved', '#ff9f73');
        return;
      }
    }
    player.equipment.clear();
    player.armHotbar[0] = buster;
    let armIndex = 0;
    for (const slotIndex of [1, 2]) {
      player.armHotbar[slotIndex] = preservedCustomSlots.get(slotIndex) ?? armLoadout[armIndex++] ?? null;
    }
    player.setUtilityArms(utilityLoadout, true);
    player.switchArmWeapon(0, true);
    for (let i = 0; i < (player.busterUpgradeSlots?.length ?? 0); i += 1) {
      player.assignBusterUpgradeToSlot(i, busterUpgrades[i] ?? null);
    }

    for (const [slot, item] of selectedSlots.entries()) {
      player.equipment.equip(item, slot);
    }

    this.game.inventory.items = pool.filter((item) => !usedItemIds.has(item.id));
    player.recalculateStats();
    player.updateWeaponVisualState?.();

    this.hideTooltip();
    this.showToast('Loadout optimized');
    this.renderInventory();
  }

  _collectOptimizationPool() {
    const pool = [];
    const seen = new Set();

    const addItem = (item) => {
      if (!item || item.type === 'customBusterArm' || seen.has(item.id)) {
        return;
      }

      seen.add(item.id);
      pool.push(item);
    };

    for (const item of this.game.player.equipment.equipped.values()) {
      addItem(item);
    }

    for (const item of this.game.player.armHotbar) {
      addItem(item);
    }

    for (const item of this.game.player.utilityArms ?? []) {
      addItem(item);
    }

    for (const item of this.game.player.busterUpgradeSlots ?? []) {
      addItem(item);
    }

    for (const item of this.game.inventory.items) {
      addItem(item);
    }

    return pool;
  }

  _showTooltip(item, x, y) {
    const equipped = this._getComparisonItem(item);
    const diff = equipped ? item.getPowerScore() - equipped.getPowerScore() : null;
    const diffLabel = diff === null
      ? 'No equipped comparison'
      : `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} power`;

    const statLines = item.getDisplayLines().map((line) => `<li>${line}</li>`).join('');
    const totals = Object.entries(item.getStatTotals())
      .map(([stat, value]) => `<li>${STAT_LABELS[stat] ?? stat}: ${formatStatValue(stat, value)}</li>`)
      .join('');
    const hotbarLine = this._getHotbarLine(item);
    const outputLine = OUTPUT_BEHAVIOR_LINES[item.type] ?? '';

    this.tooltip.innerHTML = `
      <div class="tooltip-title" style="color: ${item.color}">${item.name}</div>
      <div class="tooltip-subtitle">${RARITIES[item.rarity].label} - ${item.category} - ${slotLabel(item.slot)} - ${item.value}z</div>
      ${item.behavior ? `<div class="tooltip-compare">${item.behavior}</div>` : ''}
      ${outputLine ? `<div class="tooltip-compare">${outputLine}</div>` : ''}
      ${hotbarLine ? `<div class="tooltip-compare">${hotbarLine}</div>` : ''}
      <ul>${statLines}</ul>
      <div class="tooltip-compare">${diffLabel}</div>
      <details>
        <summary>Totals</summary>
        <ul>${totals}</ul>
      </details>
    `;

    this.tooltip.hidden = false;
    this.tooltip.style.left = `${Math.min(window.innerWidth - 320, x + 18)}px`;
    this.tooltip.style.top = `${Math.min(window.innerHeight - 280, y + 18)}px`;
  }

  _getHotbarLine(item) {
    if (isBusterUpgrade(item)) {
      const assignedIndex = this.game.player.busterUpgradeSlots?.findIndex((slotItem) => slotItem?.id === item.id) ?? -1;
      return assignedIndex >= 0
        ? `Installed in Buster upgrade B${assignedIndex + 1}`
        : 'Can be installed into Buster upgrade slots B1-B4';
    }

    if (!isArmWeapon(item)) {
      return '';
    }

    const utilityIndex = this.game.player.utilityArms?.findIndex((slotItem) => slotItem?.id === item.id) ?? -1;
    if (utilityIndex >= 0) {
      return `Equipped Utility Arm ${utilityIndex + 1}; press 4 to cycle`;
    }

    const assignedIndex = this.game.player.armHotbar.findIndex((slotItem) => slotItem?.id === item.id);
    if (assignedIndex >= 0) {
      return `Loaded in arm slot ${assignedIndex + 1}`;
    }

    if (isBusterArm(item)) {
      return 'Can replace the fixed Buster slot';
    }

    if (isUtilityArm(item)) {
      return 'Can be equipped into the Utility Arm cycle';
    }

    return 'Can be loaded into combat arm slots 2-3';
  }

  _getComparisonItem(item) {
    if (isBusterUpgrade(item)) {
      const equipped = (this.game.player.busterUpgradeSlots ?? []).filter(Boolean);
      if (equipped.length === 0) {
        return null;
      }

      return equipped.sort((a, b) => getItemPower(a) - getItemPower(b))[0];
    }

    if (item.slot === 'module') {
      const module1 = this.game.player.equipment.get('module1');
      const module2 = this.game.player.equipment.get('module2');

      if (!module1) return null;
      if (!module2) return module1;
      return module1.getPowerScore() < module2.getPowerScore() ? module1 : module2;
    }

    if (isArmWeapon(item)) {
      const sameDomain = (candidate) => {
        if (!candidate || candidate.type === 'customBusterArm') return false;
        if (isBusterArm(item)) return isBusterArm(candidate);
        if (isUtilityArm(item)) return isUtilityArm(candidate);
        return isCombatArm(candidate);
      };
      const comparable = [
        ...(this.game.player.armHotbar ?? []),
        ...(this.game.player.utilityArms ?? []),
      ].filter(sameDomain);
      if (comparable.length === 0) return null;
      return comparable.sort((a, b) => getItemPower(a) - getItemPower(b))[0];
    }

    const slot = this.game.player.equipment.resolveSlot(item);
    return this.game.player.equipment.get(slot);
  }
}
