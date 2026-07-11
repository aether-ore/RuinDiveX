import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { AnimationController } from './AnimationController.js';
import { EquipmentManager } from './EquipmentManager.js';
import { ExternalModelRig } from './ExternalModelRig.js';
import { ModularHumanoid } from './ModularHumanoid.js';
import { SkeletalModelRig } from './SkeletalModelRig.js';
import { PLAYER_TRAVERSAL_CAPABILITIES } from './TraversalCapabilities.js';

const DEFAULT_BEAM_BLADE_COLOR = 0xa8ff8a;
const PLAYER_BASE_MOVE_SPEED = 6.2;
const PLAYER_RUN_SPEED_MULTIPLIER = 1.68;
const PLAYER_RUN_ANIMATION_AMOUNT = 1.55;

const PLAYER_BASE_STATS = {
  maxHealth: 160,
  moveSpeed: PLAYER_BASE_MOVE_SPEED,
  attackDamage: 12,
  maxEnergy: 8,
  energyRecharge: 1,
  attackSpeed: 1.25,
  attackRange: 6.2,
  criticalChance: 0.08,
  criticalDamage: 1.55,
  armor: 4,
  pickupRadius: 1.35,
  projectileCount: 1,
  projectilePierce: 1,
  areaDamage: 0,
  fireDamage: 0,
  iceDamage: 0,
  lifeSteal: 0,
  explodeOnKillChance: 0,
  chainLightningChance: 0,
  cooldownReduction: 0,
  armorBreakChance: 0,
  corrosionDamage: 0,
  lockOnSpeed: 0,
  dashRecovery: 0,
  swapSpeed: 0,
};

const moveVector = new THREE.Vector2();
const worldForward = new THREE.Vector3();
const worldMoveDirection = new THREE.Vector3();
const desiredMoveVelocity = new THREE.Vector3();
const horizontalVelocityDelta = new THREE.Vector3();
const zeroMoveVelocity = new THREE.Vector3();
const movementBasisForward = new THREE.Vector3();
const movementBasisRight = new THREE.Vector3();
const ledgeMovementDirection = new THREE.Vector3();
const ledgeFaceDirection = new THREE.Vector3();
const ledgeAnchorPosition = new THREE.Vector3();
const ledgeAnimatedWristPosition = new THREE.Vector3();
const ledgeAnimatedRightWristPosition = new THREE.Vector3();
const ledgeRootCorrection = new THREE.Vector3();
const ledgeWallJumpRootMotion = {};
const guardSourceDirection = new THREE.Vector3();
const damageSourceDirection = new THREE.Vector3();
const damageFacingRight = new THREE.Vector3();
const modelGroundBounds = new THREE.Box3();
const modelGroundPosition = new THREE.Vector3();
const PLAYER_MODEL_PATH = './assets/models/';
const PLAYER_MODEL_FBX = 'Mega Man Volnutt.fbx';
const PLAYER_MODEL_TEXTURE = 'Mega Man Volnutt.png';
const PLAYER_ANIMATION_PATH = `${PLAYER_MODEL_PATH}animations/`;
const PLAYER_MODEL_MTL = 'Mega Man Volnutt.mtl';
const PLAYER_MODEL_OBJ = 'Mega Man Volnutt.obj';
const BUSTER_MODEL_MTL = 'Mega Man Volnutt Buster US.mtl';
const BUSTER_MODEL_OBJ = 'Mega Man Volnutt Buster US.obj';
const PLAYER_FBX_ANIMATION_DEFINITIONS = Object.freeze([
  { key: 'breathingIdle', file: 'Breathing Idle.fbx', label: 'Breathing Idle', loop: true, preserveRootMotion: true },
  { key: 'climbingLadder', file: 'Climbing Ladder.fbx', label: 'Climbing Ladder', loop: true },
  { key: 'coverToStand', file: 'cover to stand.fbx', label: 'Cover To Stand', loop: false },
  { key: 'coverToStand2', file: 'cover to stand (2).fbx', label: 'Cover To Stand Alt', loop: false },
  { key: 'crouchedSneakLeft', file: 'crouched sneaking left.fbx', label: 'Crouched Sneak Left', loop: true },
  { key: 'crouchedSneakRight', file: 'crouched sneaking right.fbx', label: 'Crouched Sneak Right', loop: true },
  { key: 'lyingFlat', file: 'Dying.fbx', label: 'Lying Flat', loop: false, lockRootY: true, holdProgress: 0.98 },
  { key: 'fallingIdle', file: 'falling idle.fbx', label: 'Falling Idle', loop: true },
  { key: 'fallingToLanding', file: 'Falling To Landing.fbx', label: 'Falling To Landing', loop: false, lockRootY: true },
  { key: 'forwardJumpLaunch', file: 'Jump Attack.fbx', label: 'Jump Attack Launch', loop: false, lockRootY: true, subclip: { startFrame: 0, endFrame: 33, fps: 30 } },
  { key: 'forwardJumpFall', file: 'Jump Attack.fbx', label: 'Jump To Fall', loop: false, lockRootY: true, subclip: { startFrame: 33, endFrame: 43, fps: 30 } },
  { key: 'forwardJumpLanding', file: 'Jump Attack.fbx', label: 'Jump Attack Landing', loop: false, lockRootY: true, subclip: { startFrame: 53, endFrame: 90, fps: 30 } },
  { key: 'fallingToRoll', file: 'falling to roll.fbx', label: 'Falling To Roll', loop: false },
  { key: 'hangingIdle', file: 'Hanging Idle.fbx', label: 'Hanging Idle', loop: true, lockRootY: true },
  { key: 'jumpingToHanging', file: 'Jumping To Hanging.fbx', label: 'Jumping To Hanging', loop: false, lockRootY: true },
  { key: 'jumpFromWall', file: 'Jump From Wall.fbx', label: 'Jump From Wall', loop: false, lockRootY: true, extractRootMotion: true },
  { key: 'bracedToFreeHang', file: 'Braced To Free Hang.fbx', label: 'Braced To Free Hang', loop: false, lockRootY: true },
  { key: 'freeHangToBraced', file: 'Free Hang To Braced.fbx', label: 'Free Hang To Braced', loop: false, lockRootY: true },
  { key: 'ledgeClimbUp', file: 'Braced Hang To Crouch.fbx', label: 'Ledge Climb Up', loop: false, lockRootY: true, extractRootMotion: true },
  { key: 'dodgeRoll', file: 'Standing Dive Forward.fbx', label: 'Standing Dive Forward', loop: false },
  { key: 'hardLanding', file: 'hard landing.fbx', label: 'Hard Landing', loop: false },
  { key: 'idle', file: 'idle.fbx', label: 'Look Around Idle', loop: true, preserveRootMotion: true },
  { key: 'idle2', file: 'idle (2).fbx', label: 'Idle 2', loop: true, preserveRootMotion: true },
  { key: 'idle3', file: 'idle (3).fbx', label: 'Idle 3', loop: true, preserveRootMotion: true },
  { key: 'idle4', file: 'idle (4).fbx', label: 'Idle 4', loop: true, preserveRootMotion: true },
  { key: 'idle5', file: 'idle (5).fbx', label: 'Idle 5', loop: true, preserveRootMotion: true },
  { key: 'sideIdle', file: 'Side Idle.fbx', label: 'Side Idle', loop: true, preserveRootMotion: true },
  { key: 'warriorIdle', file: 'Warrior Idle.fbx', label: 'Warrior Idle', loop: false, preserveRootMotion: true },
  { key: 'swordInwardSlash', file: 'Stable Sword Inward Slash.fbx', label: 'Sword Inward Slash', loop: false },
  { key: 'jump', file: 'jump.fbx', label: 'Jump', loop: false },
  { key: 'jumpingUp', file: 'jumping up.fbx', label: 'Jumping Up', loop: false },
  { key: 'leftCoverSneak', file: 'left cover sneak.fbx', label: 'Left Cover Sneak', loop: true },
  { key: 'leftStrafeWalking', file: 'left strafe walking.fbx', label: 'Left Strafe Walking', loop: true },
  { key: 'leftStrafe', file: 'left strafe.fbx', label: 'Left Strafe', loop: true },
  { key: 'leftTurn', file: 'left turn.fbx', label: 'Left Turn', loop: true },
  { key: 'leftTurn90', file: 'left turn 90.fbx', label: 'Left Turn 90', loop: false },
  { key: 'rightCoverSneak', file: 'right cover sneak.fbx', label: 'Right Cover Sneak', loop: true },
  { key: 'rightStrafeWalking', file: 'right strafe walking.fbx', label: 'Right Strafe Walking', loop: true },
  { key: 'rightStrafe', file: 'right strafe.fbx', label: 'Right Strafe', loop: true },
  { key: 'rightTurn', file: 'right turn.fbx', label: 'Right Turn', loop: true },
  { key: 'rightTurn90', file: 'right turn 90.fbx', label: 'Right Turn 90', loop: false },
  { key: 'pistolIdle', file: 'pistol idle.fbx', label: 'Pistol Idle', loop: true, preserveRootMotion: true },
  { key: 'pistolJump', file: 'pistol jump.fbx', label: 'Pistol Jump', loop: false },
  { key: 'pistolJump2', file: 'pistol jump (2).fbx', label: 'Pistol Jump Alt', loop: false },
  { key: 'pistolKneelToStand', file: 'pistol kneel to stand.fbx', label: 'Pistol Kneel To Stand', loop: false },
  { key: 'pistolKneelingIdle', file: 'pistol kneeling idle.fbx', label: 'Pistol Kneeling Idle', loop: true, preserveRootMotion: true },
  { key: 'pistolRunArc', file: 'pistol run arc.fbx', label: 'Pistol Run Arc', loop: true },
  { key: 'pistolRunArc2', file: 'pistol run arc (2).fbx', label: 'Pistol Run Arc Alt', loop: true },
  { key: 'pistolRunBackwardArc', file: 'pistol run backward arc.fbx', label: 'Pistol Run Backward Arc', loop: true },
  { key: 'pistolRunBackwardArc2', file: 'pistol run backward arc (2).fbx', label: 'Pistol Run Backward Arc Alt', loop: true },
  { key: 'pistolRunBackward', file: 'pistol run backward.fbx', label: 'Pistol Run Backward', loop: true },
  { key: 'pistolRun', file: 'pistol run.fbx', label: 'Pistol Run', loop: true },
  { key: 'pistolStandToKneel', file: 'pistol stand to kneel.fbx', label: 'Pistol Stand To Kneel', loop: false },
  { key: 'pistolStrafe', file: 'pistol strafe.fbx', label: 'Pistol Strafe', loop: true },
  { key: 'pistolStrafe2', file: 'pistol strafe (2).fbx', label: 'Pistol Strafe Alt', loop: true },
  { key: 'pistolWalkArc', file: 'pistol walk arc.fbx', label: 'Pistol Walk Arc', loop: true },
  { key: 'pistolWalkArc2', file: 'pistol walk arc (2).fbx', label: 'Pistol Walk Arc Alt', loop: true },
  { key: 'pistolWalkBackwardArc', file: 'pistol walk backward arc.fbx', label: 'Pistol Walk Backward Arc', loop: true },
  { key: 'pistolWalkBackwardArc2', file: 'pistol walk backward arc (2).fbx', label: 'Pistol Walk Backward Arc Alt', loop: true },
  { key: 'pistolWalkBackward', file: 'pistol walk backward.fbx', label: 'Pistol Walk Backward', loop: true },
  { key: 'pistolWalk', file: 'pistol walk.fbx', label: 'Pistol Walk', loop: true },
  { key: 'runToStop', file: 'run to stop.fbx', label: 'Run To Stop', loop: false },
  { key: 'running', file: 'running.fbx', label: 'Running', loop: true },
  { key: 'slowJogBackwards', file: 'Slow Jog Backwards.fbx', label: 'Slow Jog Backwards', loop: true },
  { key: 'standToCover', file: 'stand to cover.fbx', label: 'Stand To Cover', loop: false },
  { key: 'standToCover2', file: 'stand to cover (2).fbx', label: 'Stand To Cover Alt', loop: false },
  { key: 'strutWalking', file: 'Strut Walking.fbx', label: 'Strut Walking', loop: true },
  { key: 'walking', file: 'walking.fbx', label: 'Walking', loop: true },
]);
const TARGET_MODEL_HEIGHT = 2.85;
const MIN_BRACED_SHOT_TIME = 0.28;
const MIN_PROJECTILE_AIM_LOCK_TIME = 0.44;
const PROJECTILE_STANCE_LINGER_TIME = 1.05;
const DODGE_ROLL_DISTANCE = 7.8;
const DODGE_ROLL_DURATION = 0.86;
// The opening dive can cross a short gap; the grounded tuck and recovery cannot.
const DODGE_ROLL_AIRBORNE_PROGRESS = 0.25;
const DODGE_ROLL_AIR_LIFT = 0.52;
const DODGE_ROLL_RECOVERY_SINK = 0.14;
const FORWARD_JUMP_DISTANCE = 1.9;
const JUMP_DURATION = 0.9;
const NEUTRAL_JUMP_DURATION = 1.75;
const NEUTRAL_JUMP_LAUNCH_PROGRESS = 0.6;
const NEUTRAL_JUMP_VISUAL_LIFT = 2.05;
const FORWARD_JUMP_VISUAL_LIFT = 1.85;
const FORWARD_JUMP_FALL_ANIMATION_START_PROGRESS = 0.52;
const NEUTRAL_JUMP_FALL_ANIMATION_START_PROGRESS = 0.78;
const JUMP_LANDING_VISUAL_HOLD_DURATION = 1.08;
const LEDGE_JUMP_TO_HANG_DURATION = 1.5;
const LEDGE_SETTLE_TO_FREE_HANG_DURATION = 0.917;
const LEDGE_PREPARE_CLIMB_DURATION = 1.125;
const LEDGE_CLIMB_UP_DURATION = 1.125;
const LEDGE_WALL_JUMP_DURATION = 1.125;
const LEDGE_WALL_JUMP_DISTANCE = 1.45;
const LEDGE_WALL_JUMP_LIFT = 0.9;
const LEDGE_WALL_JUMP_FALL_SPEED = 2.2;
const LEDGE_WALL_JUMP_FALL_VERTICAL_VELOCITY = -1.2;
// The climb clip keeps both hands planted through its pull and push-off. Keep
// that contact authored in world space, then release for the final crouch.
const LEDGE_CLIMB_HAND_RELEASE_PROGRESS = 0.82;
const LEDGE_CLIMB_HAND_RELEASE_END_PROGRESS = 0.94;
const LEDGE_TOWARD_INPUT_DOT = 0.38;
// These values define the authored hand contact, not a visual root offset. A
// small outward bias keeps the wrist joints on the player-facing side of the
// ledge while the hand meshes still wrap over its top edge.
const LEDGE_HAND_OUTWARD_OFFSET = 0.055;
const LEDGE_FREE_HANG_ROOT_OUTWARD_OFFSET = 0.34;
const LEDGE_FREE_HANG_ROOT_VERTICAL_OFFSET = 0.8;
const HEAVY_HIT_HEALTH_FRACTION = 0.16;
const HEAVY_HIT_MIN_DAMAGE = 18;
const POWER_KNOCKBACK_UPWARD_SPEED = 5.2;
const POWER_KNOCKBACK_HORIZONTAL_SPEED = 5.4;
const POWER_KNOCKBACK_GRAVITY = -12.5;
const POWER_KNOCKBACK_FALL_GRAVITY_MULTIPLIER = 1.08;
const POWER_KNOCKBACK_BACK_LANDING_TIME = 0.14;
const POWER_KNOCKBACK_LYING_FLAT_TIME = 0.3;
const POWER_KNOCKBACK_GET_UP_TIME = 0.9;
const POWER_KNOCKBACK_LANDING_COMMIT_MARGIN = 0.04;
const POWER_KNOCKBACK_FALLBACK_BACK_RADIUS = 0.24;
const POWERFUL_KNOCKBACK_ATTACKS = new Set([
  'charge',
  'pounce',
  'explosion',
  'shockwave',
  'selfDestruct',
  'mortar',
  'mine',
]);
const SHIELD_GUARD_DURATION = 0.7;
const SHIELD_GUARD_COOLDOWN = 0.82;
const SHIELD_PARRY_WINDOW = 0.18;
const TANK_TURN_RATE = 2.7;
const TANK_TURN_INPUT_THRESHOLD = 0.35;
const BUSTER_SLOT_INDEX = 0;
const UTILITY_ARM_SLOT_INDEX = 3;
const MML_JUMP_STATES = Object.freeze({
  Grounded: 'Grounded',
  Rising: 'Rising',
  Falling: 'Falling',
  LandRecovery: 'LandRecovery',
});
const POWER_KNOCKBACK_STATES = Object.freeze({
  Rising: 'KnockbackRising',
  Falling: 'AerialKnockbackFalling',
  Landing: 'BackLanding',
  LyingFlat: 'LyingFlat',
  GetUp: 'GetUp',
});
const DEFAULT_MML_JUMP_SETTINGS = Object.freeze({
  // Low fixed height is the core Mega Man Legends-like commitment: the button never changes the apex.
  jumpHeight: PLAYER_TRAVERSAL_CAPABILITIES.jumpHeight,
  // Short time to apex makes the hop snappy without becoming a floaty modern platformer jump.
  jumpTimeToApex: PLAYER_TRAVERSAL_CAPABILITIES.jumpTimeToApex,
  // Slightly stronger fall gravity brings Volnutt back down with that PS1 action-adventure weight.
  fallGravityMultiplier: PLAYER_TRAVERSAL_CAPABILITIES.fallGravityMultiplier,
  // Scales acceleration while initial velocity is recalculated to preserve the selected apex.
  gravityScale: 1,
  // Forward speed stays modest so the preserved takeoff velocity feels like a committed hop.
  forwardSpeed: PLAYER_TRAVERSAL_CAPABILITIES.forwardJumpSpeed,
  // Ground acceleration/deceleration shape the planted tank-control feel before takeoff.
  groundAcceleration: 28,
  groundDeceleration: 22,
  // Very low air acceleration prevents instant strafing once the jump is committed.
  airAcceleration: 1.2,
  // Near-zero reversal response keeps airborne turns weak instead of modern and reactive.
  airTurnMultiplier: 0.1,
  // Landing recovery and damping make the landing read as a committed action.
  landingRecoveryTime: 0.11,
  landingHorizontalDamping: 0.65,
  // These are intentionally tiny: forgiving input without making the hop feel elastic.
  jumpBufferTime: 0.05,
  coyoteTime: 0.03,
  // Global tuning scalar for tests or upgrades while preserving fixed-height button behavior.
  jumpHeightMultiplier: 1,
});
const PHYSICAL_JUMP_RISING_CLIP_END = 0.52;
const PHYSICAL_JUMP_LANDING_CLIP_KEY = 'fallingToLanding';
const GROUNDED_STEP_DOWN_SNAP_HEIGHT = PLAYER_TRAVERSAL_CAPABILITIES.groundedStepDownHeight;

function getJumpVisualLift(progress = 0, forward = false) {
  const p = THREE.MathUtils.clamp(progress, 0, 1);

  if (forward) {
    return Math.sin(p * Math.PI) * FORWARD_JUMP_VISUAL_LIFT;
  }

  if (p <= NEUTRAL_JUMP_LAUNCH_PROGRESS) {
    return 0;
  }

  const arcProgress = THREE.MathUtils.clamp(
    (p - NEUTRAL_JUMP_LAUNCH_PROGRESS) / (1 - NEUTRAL_JUMP_LAUNCH_PROGRESS),
    0,
    1,
  );
  const launch = THREE.MathUtils.smoothstep(arcProgress, 0, 0.14);
  const airborneArc = Math.sin(arcProgress * Math.PI);
  const landing = 1 - THREE.MathUtils.smoothstep(arcProgress, 0.72, 1);
  return Math.max(0, airborneArc * launch * landing) * NEUTRAL_JUMP_VISUAL_LIFT;
}

function getForwardJumpTravelProgress(progress = 0) {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  return (1 - Math.cos(p * Math.PI)) * 0.5;
}

function getJumpLandingCompression(progress = 0, forward = false) {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  return THREE.MathUtils.smoothstep(p, forward ? 0.78 : 0.84, 1) * (forward ? 0.06 : 0.08);
}

function getJumpFallAnimationStartProgress(animationState) {
  if (animationState === 'forwardJump') {
    return FORWARD_JUMP_FALL_ANIMATION_START_PROGRESS;
  }

  if (animationState === 'neutralJump') {
    return NEUTRAL_JUMP_FALL_ANIMATION_START_PROGRESS;
  }

  return Infinity;
}

function isArmWeaponItem(item) {
  return item?.slot === 'weapon' && item?.category === 'Arm Weapon';
}

function isBusterArmItem(item) {
  return isArmWeaponItem(item) && item?.type === 'busterArm';
}

function isUtilityArmItem(item) {
  return isArmWeaponItem(item) && (item?.type === 'liftArm' || item?.tags?.includes('utility'));
}

function isBusterUpgradeItem(item) {
  return item?.category === 'Buster Part';
}

function getDodgeRollVisualLift(progress) {
  const localProgress = THREE.MathUtils.clamp(progress, 0, 1);
  const hang = Math.pow(Math.max(0, Math.sin(localProgress * Math.PI)), 0.72);
  const recovery = THREE.MathUtils.smoothstep(localProgress, 0.68, 1);
  return Math.max(0, hang * DODGE_ROLL_AIR_LIFT - recovery * DODGE_ROLL_RECOVERY_SINK);
}

export class Player {
  constructor() {
    this.humanoid = new ModularHumanoid({
      skinColor: 0xc88f68,
      hairColor: 0xe3342f,
      hairStyle: 'short',
      eyeColor: 0x7ee3ff,
      clothColor: 0x2d3f54,
      armorColor: 0xaab4bf,
      scale: 1,
    });

    this.root = this.humanoid.root;
    this.root.name = 'playerRoot';
    this.root.position.set(0, 0, 0);

    this.modelRoot = new THREE.Group();
    this.modelRoot.name = 'playerExternalModelRoot';
    this.modelRoot.visible = false;
    this.root.add(this.modelRoot);

    this.animation = new AnimationController(this.humanoid);
    this.equipment = new EquipmentManager(this, this.humanoid);

    this.baseStats = { ...PLAYER_BASE_STATS };
    this.stats = { ...PLAYER_BASE_STATS };
    this.health = this.stats.maxHealth;
    this.level = 1;
    this.experience = 0;
    this.experienceToNext = 40;
    this.radius = PLAYER_TRAVERSAL_CAPABILITIES.collisionRadius;
    this.dead = false;
    this.slowTimer = 0;
    this.slowMultiplier = 1;
    this.weaponColor = new THREE.Color(0xd7dde6);
    this.lastMoveDirection = new THREE.Vector3(0, 0, 1);
    this.attackFacingDirection = new THREE.Vector3(0, 0, 1);
    this.attackFacingTimer = 0;
    this._loadedModel = null;
    this.externalRig = null;
    this._modelWalkTime = 0;
    this._characterModelScale = 1;
    this._loadedModelUsesFbxClips = false;
    this._fbxAnimationLibraryLoading = false;
    this._fbxAnimationLibraryLoaded = false;
    this._busterArmLoading = false;
    this._busterArmLoaded = false;
    this._jumpLandingVisualTimer = 0;
    this._jumpLandingVisualState = null;
    this._jumpLandingVisualClipKey = null;
    this._lastExternalModelGrounding = null;
    this.ledgeCling = null;
    this.ledgeWallJumpDirection = new THREE.Vector3(0, 0, -1);
    this.ledgeWallJumpStartPosition = new THREE.Vector3();
    this.ledgeWallJumpGroundY = 0;
    this.ledgeWallJumpYaw = 0;
    this._attackWeaponKind = null;
    this._bracedFireWeaponKey = null;
    this.bracedFireDirection = new THREE.Vector3(0, 0, 1);
    this.bracedFireTimer = 0;
    this.bracedBackpedalTimer = 0;
    this.movementLockTimer = 0;
    this.movementLockMultiplier = 1;
    this.dodgeDirection = new THREE.Vector3(0, 0, 1);
    this.dodgeRollYaw = 0;
    this.jumpDirection = new THREE.Vector3(0, 0, 1);
    this.jumpStartY = 0;
    this.jumpSettings = { ...DEFAULT_MML_JUMP_SETTINGS };
    this.jumpState = MML_JUMP_STATES.Grounded;
    this.velocity = new THREE.Vector3();
    this.takeoffHorizontalVelocity = new THREE.Vector3();
    this._jumpBufferTimer = 0;
    this._coyoteTimer = this.jumpSettings.coyoteTime;
    this._landingRecoveryTimer = 0;
    this._jumpAirTimer = 0;
    this._jumpFallTransitionActive = false;
    this._jumpKind = 'forwardJump';
    this._jumpGroundY = this.root.position.y;
    this._forwardJumpTravelProgress = 0;
    this.jumpLedgeClingResolver = null;
    this.jumpPlatformLandingResolver = null;
    this.powerKnockbackTravelResolver = null;
    this.powerKnockbackLandingResolver = null;
    this.onDodgeStarted = null;
    this.knockbackFallDirection = new THREE.Vector3(0, 0, -1);
    this.powerKnockbackState = null;
    this.powerKnockbackVelocity = new THREE.Vector3();
    this.powerKnockbackTimer = 0;
    this.powerKnockbackDuration = 0;
    this.powerKnockbackStartY = 0;
    this.powerKnockbackApexY = 0;
    this.powerKnockbackOriginPosition = new THREE.Vector3();
    this.powerKnockbackPreviousPosition = new THREE.Vector3();
    this.powerKnockbackLandingPosition = new THREE.Vector3();
    this.powerKnockbackLandingMode = null;
    this.powerKnockbackLandingCommitted = false;
    this.powerKnockbackImpactRootY = 0;
    this.powerKnockbackCameraAnchorY = 0;
    this._lastPowerKnockbackBackContact = null;
    // External motion gives a carrier exclusive ownership of the player root.
    // Ballistic motion is target-owned so a throw still completes if the
    // original carrier is destroyed after release.
    this.externalControl = null;
    this.externalBallisticMotion = null;
    this.damageHitLocalDirection = new THREE.Vector3(0, 0, 1);
    this.isRunning = false;
    this.tankTurnActive = false;
    this.tankTurnAmount = 0;
    this.tankTurnTranslating = false;
    this.guardDirection = new THREE.Vector3(0, 0, 1);
    this.guardTimer = 0;
    this.guardDuration = 0;
    this.guardParryTimer = 0;
    this.guardCooldown = 0;
    this.lastGuardResult = null;
    this.armHotbar = [null, null, null, null];
    this.activeArmIndex = 0;
    this.utilityArms = [];
    this.activeUtilityArmIndex = 0;
    this.busterUpgradeSlots = [null, null, null, null];
    this.temporaryStatBonuses = new Map();

    this._loadCharacterModel();
  }

  update(dt, input, arenaRadius = 32, movementOptions = {}) {
    if (typeof arenaRadius === 'object') {
      movementOptions = arenaRadius;
      arenaRadius = movementOptions.arenaRadius ?? 32;
    }

    if (this.dead) {
      this.isRunning = false;
      this.tankTurnActive = false;
      this.tankTurnAmount = 0;
      this.tankTurnTranslating = false;
      this.animation.update(dt);
      return;
    }

    if (this._updateExternalMotion(dt, movementOptions.game ?? null)) {
      return;
    }

    this._updateStatusEffects(dt);
    this._updateTemporaryStatBonuses(dt);
    this._updateBracedFireState(dt);
    this._updateShieldGuardState(dt);
    this._updateMovementLockState(dt);
    this._updateAttackFacingState(dt);

    if (this.isLedgeClinging()) {
      this._updateLedgeClingState(dt, input, movementOptions);
      return;
    }

    if (this.isPowerKnockbackActive()) {
      this._updatePowerKnockback(dt, arenaRadius, movementOptions);
      return;
    }

    if (this.animation.isFullBodyActionActive?.()) {
      const actionStateBeforeUpdate = this.animation.actionState;
      this.animation.update(dt, {
        moving: false,
        running: false,
        moveAmount: 0,
      });
      const completedJumpThisFrame = (actionStateBeforeUpdate === 'neutralJump' || actionStateBeforeUpdate === 'forwardJump')
        && !this.animation.actionState;
      const completedWallJumpThisFrame = actionStateBeforeUpdate === 'wallJump'
        && !this.animation.actionState;
      const completedActionState = completedJumpThisFrame || completedWallJumpThisFrame
        ? actionStateBeforeUpdate
        : null;
      const completedActionProgress = completedActionState ? 1 : null;
      if (completedJumpThisFrame) {
        this._jumpLandingVisualState = 'land';
        this._jumpLandingVisualTimer = JUMP_LANDING_VISUAL_HOLD_DURATION;
        this._jumpLandingVisualClipKey = completedActionState === 'forwardJump'
          ? 'forwardJumpLanding'
          : null;
      }
      this._updateFullBodyActionMotion(dt, arenaRadius, completedActionState, completedActionProgress);
      if (completedWallJumpThisFrame) {
        this._finishLedgeWallJumpToFall();
      }
      if (this.isLedgeClinging()) {
        this._updateLedgeClingState(dt, input, movementOptions);
        return;
      }
      if (completedJumpThisFrame) {
        this._tryResolveJumpPlatformLanding(completedActionState);
      }
      this.updateWeaponVisualState();
      this._updateExternalModelMotion(dt, false, 0, false, false, {
        animationState: completedJumpThisFrame ? 'land' : (completedWallJumpThisFrame ? 'fall' : undefined),
        actionProgress: completedJumpThisFrame
          ? 0
          : (completedWallJumpThisFrame ? this._getPhysicalJumpAnimationProgress() : undefined),
        lockOnActive: false,
        strafeAmount: 0,
        clipKey: completedJumpThisFrame ? this._jumpLandingVisualClipKey : null,
      });
      this.tankTurnActive = false;
      this.tankTurnAmount = 0;
      this.tankTurnTranslating = false;
      return;
    }

    moveVector.set(0, 0);
    const lockOnTarget = movementOptions.lockOnTarget ?? null;
    const lockOnPosition = movementOptions.lockOnTargetPosition ?? lockOnTarget?.root?.position ?? null;
    const lockOnActive = Boolean(lockOnPosition && !lockOnTarget?.dead);

    if (input.has('KeyW') || input.has('ArrowUp')) moveVector.y += 1;
    if (input.has('KeyS') || input.has('ArrowDown')) moveVector.y -= 1;
    if (input.has('KeyA') || input.has('ArrowLeft')) moveVector.x -= 1;
    if (input.has('KeyD') || input.has('ArrowRight')) moveVector.x += 1;

    const rawLateralInput = moveVector.x;
    const rawForwardInput = moveVector.y;
    const moving = moveVector.lengthSq() > 0;
    if (moving && this._jumpLandingVisualTimer > 0) {
      this._cancelJumpLandingVisual({ restoreMovement: true });
    }

    const attackFacing = this.attackFacingTimer > 0 && this.attackFacingDirection.lengthSq() > 0.0001;
    const lateralTurnAttempt = Math.abs(rawLateralInput) > TANK_TURN_INPUT_THRESHOLD;
    const projectileAimInputHeld = movementOptions.projectileAimInputHeld === true;

    if (lateralTurnAttempt && !projectileAimInputHeld && this.isProjectileAimHeld()) {
      this._releaseProjectileAim();
    }

    const bracedAiming = this.bracedFireTimer > 0 && this.bracedFireDirection.lengthSq() > 0.0001;
    const jumpAirborne = this.isJumpAirborne();
    const landingRecovering = this.jumpState === MML_JUMP_STATES.LandRecovery;
    const tankTurnInput = !lockOnActive ? THREE.MathUtils.clamp(rawLateralInput, -1, 1) : 0;
    const tankTurnActive = !lockOnActive
      && !attackFacing
      && !bracedAiming
      && lateralTurnAttempt
      && !jumpAirborne
      && !landingRecovering;
    let translating = false;
    const running = moving && (input.has('ShiftLeft') || input.has('ShiftRight'));
    let moveAmount = 0;
    let movingBackward = false;
    let strafeAmount = 0;
    desiredMoveVelocity.set(0, 0, 0);

    if (moving) {
      moveVector.normalize();
      movingBackward = rawForwardInput < -0.35;
      translating = lockOnActive || Math.abs(rawForwardInput) > 0.35;
      strafeAmount = lockOnActive ? THREE.MathUtils.clamp(rawLateralInput, -1, 1) : 0;
      moveAmount = translating && running ? PLAYER_RUN_ANIMATION_AMOUNT : 1;

      if (jumpAirborne) {
        this._resolveMovementDirection(moveVector, movementOptions);
      } else if (lockOnActive) {
        this._resolveMovementDirection(moveVector, movementOptions);
      } else {
        if (tankTurnActive) {
          this.root.rotation.y -= tankTurnInput * TANK_TURN_RATE * dt;
          this.syncMoveDirectionToBodyFacing();
        } else {
          this.syncMoveDirectionToBodyFacing();
        }

        const throttle = THREE.MathUtils.clamp(rawForwardInput, -1, 1);
        const directionSign = throttle < 0 ? -1 : 1;
        worldMoveDirection.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y))
          .multiplyScalar(directionSign);
      }

      const guardMoveMultiplier = this.isShieldGuarding() ? 0.72 : 1;
      const runMultiplier = running ? PLAYER_RUN_SPEED_MULTIPLIER : 1;
      const speed = this._getTunedForwardSpeed() * runMultiplier * this.slowMultiplier * guardMoveMultiplier * this.movementLockMultiplier;
      if (jumpAirborne) {
        desiredMoveVelocity.copy(worldMoveDirection).multiplyScalar(speed);
      } else if (translating && !landingRecovering) {
        desiredMoveVelocity.copy(worldMoveDirection).multiplyScalar(speed);
      }

      if (lockOnActive && !jumpAirborne) {
        this._resolveLockOnFacingDirection(lockOnPosition);
      }
    } else if (lockOnActive && !jumpAirborne) {
      this._resolveLockOnFacingDirection(lockOnPosition);
    }

    const backpedaling = movingBackward || (lockOnActive && moveVector.y < -0.35) || (bracedAiming && this.bracedBackpedalTimer > 0 && moving);
    const tankTurnInPlace = tankTurnActive && !translating;
    const tankTurnTranslating = tankTurnActive && translating;
    const jumpMotionResult = this._updatePhysicalJumpAndMovement(dt, desiredMoveVelocity, {
      arenaRadius,
      movementOptions,
    });
    if (jumpMotionResult === 'ledgeCling') {
      this._updateLedgeClingState(dt, input, movementOptions);
      return;
    }

    const jumpAnimationState = this._getPhysicalJumpAnimationState();
    const jumpAnimationProgress = this._getPhysicalJumpAnimationProgress();
    const jumpDrivenAnimation = Boolean(jumpAnimationState);
    const moveAnimationAmount = (!jumpDrivenAnimation && (translating || tankTurnInPlace))
      ? moveAmount * this.movementLockMultiplier
      : 0;
    const visiblyMoving = moveAnimationAmount > 0.05;
    const visiblyRunning = visiblyMoving
      && translating
      && running
      && !backpedaling
      && !this.isShieldGuarding()
      && this.movementLockMultiplier > 0.85;
    const freeTurnAmount = tankTurnInPlace ? tankTurnInput : 0;
    this.tankTurnActive = tankTurnActive;
    this.tankTurnAmount = tankTurnActive ? tankTurnInput : 0;
    this.tankTurnTranslating = tankTurnTranslating;
    this.isRunning = visiblyRunning;

    const currentlyAirborne = this.isJumpAirborne();
    const currentlyLandingRecovering = this.jumpState === MML_JUMP_STATES.LandRecovery;
    if (!currentlyAirborne && !currentlyLandingRecovering && attackFacing) {
      this.faceDirection(this.attackFacingDirection);
    } else if (!currentlyAirborne && !currentlyLandingRecovering && bracedAiming) {
      this.faceDirection(this.bracedFireDirection);
    } else if (!currentlyAirborne && !currentlyLandingRecovering && lockOnActive) {
      this.faceDirection(this.lastMoveDirection);
    }

    this.animation.update(dt, {
      moving: jumpDrivenAnimation ? false : visiblyMoving,
      running: jumpDrivenAnimation ? false : visiblyRunning,
      moveAmount: jumpDrivenAnimation ? 0 : moveAnimationAmount,
      forcedState: jumpAnimationState,
      actionProgress: jumpAnimationProgress,
    });
    this.updateWeaponVisualState();
    const landingVisualState = this._jumpLandingVisualTimer > 0
      ? this._jumpLandingVisualState
      : null;
    const physicalLandingClipKey = jumpAnimationState === 'land'
      ? PHYSICAL_JUMP_LANDING_CLIP_KEY
      : null;
    const externalMoving = (jumpDrivenAnimation || landingVisualState) ? false : visiblyMoving;
    const externalMoveAmount = (jumpDrivenAnimation || landingVisualState) ? 0 : moveAnimationAmount;
    const externalBackpedaling = (jumpDrivenAnimation || landingVisualState) ? false : backpedaling;
    const externalRunning = (jumpDrivenAnimation || landingVisualState) ? false : visiblyRunning;
    const landingVisualProgress = landingVisualState ? this._getJumpLandingVisualProgress() : null;

    this._updateExternalModelMotion(dt, externalMoving, externalMoveAmount, externalBackpedaling, externalRunning, {
      animationState: jumpAnimationState ?? landingVisualState ?? undefined,
      actionProgress: jumpAnimationProgress ?? landingVisualProgress ?? undefined,
      lockOnActive,
      strafeAmount,
      turnAmount: jumpDrivenAnimation ? 0 : freeTurnAmount,
      clipKey: physicalLandingClipKey ?? (landingVisualState ? this._jumpLandingVisualClipKey : null),
      physicalJump: jumpDrivenAnimation,
    });

    if (this._jumpLandingVisualTimer > 0) {
      this._jumpLandingVisualTimer = Math.max(0, this._jumpLandingVisualTimer - dt);
      if (this._jumpLandingVisualTimer <= 0) {
        this._jumpLandingVisualState = null;
        this._jumpLandingVisualClipKey = null;
      }
    }
  }

  _resolveLockOnFacingDirection(targetPosition) {
    worldForward.copy(targetPosition).sub(this.root.position);
    worldForward.y = 0;

    if (worldForward.lengthSq() <= 0.0001) {
      return;
    }

    this.lastMoveDirection.copy(worldForward.normalize());
  }

  _resolveBackwardFacingDirection(movementOptions = {}) {
    this._resolveForwardFacingDirection(movementOptions);
  }

  _resolveForwardFacingDirection(movementOptions = {}) {
    const forward = movementOptions.movementForward ?? movementOptions.forward;

    if (forward && forward.lengthSq() > 0.0001) {
      worldForward.copy(forward);
      worldForward.y = 0;

      if (worldForward.lengthSq() > 0.0001) {
        this.lastMoveDirection.copy(worldForward.normalize());
        return;
      }
    }

    worldForward.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
    this.lastMoveDirection.copy(worldForward.normalize());
  }

  _resolveMovementDirection(inputVector, movementOptions = {}) {
    worldMoveDirection.set(0, 0, 0);

    const forward = movementOptions.movementForward ?? movementOptions.forward;
    const right = movementOptions.movementRight ?? movementOptions.right;

    if (forward && right) {
      movementBasisForward.copy(forward);
      movementBasisForward.y = 0;

      if (movementBasisForward.lengthSq() <= 0.0001) {
        movementBasisForward.set(0, 0, 1);
      } else {
        movementBasisForward.normalize();
      }

      movementBasisRight.copy(right);
      movementBasisRight.y = 0;

      if (movementBasisRight.lengthSq() <= 0.0001) {
        movementBasisRight.set(1, 0, 0);
      } else {
        movementBasisRight.normalize();
      }

      worldMoveDirection
        .addScaledVector(movementBasisRight, inputVector.x)
        .addScaledVector(movementBasisForward, inputVector.y);
    } else {
      worldMoveDirection.set(inputVector.x, 0, -inputVector.y);
    }

    if (worldMoveDirection.lengthSq() <= 0.0001) {
      worldMoveDirection.set(0, 0, 1);
    } else {
      worldMoveDirection.normalize();
    }
  }

  faceDirection(direction) {
    if (direction.lengthSq() <= 0.0001) {
      return;
    }

    this.root.rotation.y = Math.atan2(direction.x, direction.z);
  }

  syncMoveDirectionToBodyFacing() {
    worldForward.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));

    if (worldForward.lengthSq() > 0.0001) {
      this.lastMoveDirection.copy(worldForward.normalize());
    }
  }

  isJumpAirborne() {
    return this.jumpState === MML_JUMP_STATES.Rising
      || this.jumpState === MML_JUMP_STATES.Falling;
  }

  isPhysicalJumpActive() {
    return this.isJumpAirborne() || this.jumpState === MML_JUMP_STATES.LandRecovery;
  }

  isJumpVerticalMotionActive() {
    return this.isJumpAirborne();
  }

  resumeAirborneFall({ x, z, groundY, minimumFallSpeed = 1.1 } = {}) {
    if (!this.isJumpAirborne()) {
      return false;
    }

    if (Number.isFinite(x)) {
      this.root.position.x = x;
    }
    if (Number.isFinite(z)) {
      this.root.position.z = z;
    }
    if (Number.isFinite(groundY)) {
      this._jumpGroundY = groundY;
    }

    // Rail recovery only restores a normal deterministic descent. It never
    // adds height or starts a second jump arc.
    this.jumpState = MML_JUMP_STATES.Falling;
    this.velocity.y = Math.min(this.velocity.y, -Math.max(0, minimumFallSpeed));
    this._jumpFallTransitionActive = false;
    return true;
  }

  isDodgeRollAirborne() {
    return this.animation?.actionState === 'dodgeRoll'
      && this.animation.getActionProgress() <= DODGE_ROLL_AIRBORNE_PROGRESS;
  }

  isDodgeRollInvulnerable() {
    // Dodge i-frames follow the complete deterministic gameplay action. The
    // authored FBX is normalized to this same action duration, so visual clip
    // loading or playback differences cannot shorten the protection window.
    return !this.dead && this.animation?.actionState === 'dodgeRoll';
  }

  _getJumpSetting(key, fallback = 0) {
    const value = this.jumpSettings?.[key];
    return Number.isFinite(value) ? value : fallback;
  }

  _getTunedForwardSpeed() {
    const statScale = PLAYER_BASE_MOVE_SPEED > 0
      ? Math.max(0.01, this.stats.moveSpeed / PLAYER_BASE_MOVE_SPEED)
      : 1;
    return Math.max(0, this._getJumpSetting('forwardSpeed', DEFAULT_MML_JUMP_SETTINGS.forwardSpeed)) * statScale;
  }

  _getConfiguredJumpHeight() {
    const height = this._getJumpSetting('jumpHeight', DEFAULT_MML_JUMP_SETTINGS.jumpHeight);
    const multiplier = this._getJumpSetting('jumpHeightMultiplier', DEFAULT_MML_JUMP_SETTINGS.jumpHeightMultiplier);
    return Math.max(0.05, height * multiplier);
  }

  _getJumpTimeToApex() {
    return Math.max(0.05, this._getJumpSetting('jumpTimeToApex', DEFAULT_MML_JUMP_SETTINGS.jumpTimeToApex));
  }

  _getJumpInitialVelocity() {
    return Math.sqrt(2 * this._getConfiguredJumpHeight() * Math.abs(this._getJumpGravity()));
  }

  _getJumpGravity() {
    const timeToApex = this._getJumpTimeToApex();
    return -(2 * this._getConfiguredJumpHeight()) / (timeToApex * timeToApex) * this._getGravityScale();
  }

  _getGravityScale() {
    return Math.max(0.01, this._getJumpSetting('gravityScale', DEFAULT_MML_JUMP_SETTINGS.gravityScale));
  }

  _getFallGravityMultiplier() {
    return Math.max(0.01, this._getJumpSetting('fallGravityMultiplier', DEFAULT_MML_JUMP_SETTINGS.fallGravityMultiplier));
  }

  _getEstimatedJumpAirTime() {
    const gravity = Math.abs(this._getJumpGravity());
    const timeToApex = gravity > 0.0001 ? this._getJumpInitialVelocity() / gravity : this._getJumpTimeToApex();
    return timeToApex + (timeToApex / Math.sqrt(this._getFallGravityMultiplier()));
  }

  setJumpPhysicsDebug({ jumpHeightMultiplier, gravityScale } = {}) {
    if (Number.isFinite(jumpHeightMultiplier)) {
      this.jumpSettings.jumpHeightMultiplier = THREE.MathUtils.clamp(jumpHeightMultiplier, 0.25, 8);
    }
    if (Number.isFinite(gravityScale)) {
      this.jumpSettings.gravityScale = THREE.MathUtils.clamp(gravityScale, 0.05, 3);
    }
    return this.getJumpPhysicsDebug();
  }

  getJumpPhysicsDebug() {
    const jumpHeightMultiplier = this._getJumpSetting(
      'jumpHeightMultiplier',
      DEFAULT_MML_JUMP_SETTINGS.jumpHeightMultiplier,
    );
    return {
      jumpHeightMultiplier,
      gravityScale: this._getGravityScale(),
      jumpHeight: this._getConfiguredJumpHeight(),
      timeToApex: this._getJumpInitialVelocity() / Math.abs(this._getJumpGravity()),
      gravity: this._getJumpGravity(),
    };
  }

  _resolvePhysicalGroundY(movementOptions = {}) {
    const groundY = movementOptions.groundY;
    if (Number.isFinite(groundY)) {
      return groundY;
    }

    return this.isJumpAirborne() ? this._jumpGroundY : this.root.position.y;
  }

  _canStartBufferedPhysicalJump() {
    if (this._jumpBufferTimer <= 0 || this.dead || this.isLedgeClinging()) {
      return false;
    }

    if (this.animation?.actionState || this.animation?.hurtTimer > 0 || this.animation?.attackTimer > 0) {
      return false;
    }

    if (this.jumpState === MML_JUMP_STATES.LandRecovery) {
      return false;
    }

    return this.jumpState === MML_JUMP_STATES.Grounded || this._coyoteTimer > 0;
  }

  _startPhysicalJump() {
    this._jumpBufferTimer = 0;
    this._coyoteTimer = 0;
    this._landingRecoveryTimer = 0;
    this.jumpStartY = this.root.position.y;
    this._jumpGroundY = this.root.position.y;
    this._jumpAirTimer = 0;
    this._jumpFallTransitionActive = false;
    this.velocity.y = this._getJumpInitialVelocity();
    this.takeoffHorizontalVelocity.set(this.velocity.x, 0, this.velocity.z);

    if (this.takeoffHorizontalVelocity.lengthSq() > 0.0025) {
      this.jumpDirection.copy(this.takeoffHorizontalVelocity).normalize();
    } else {
      this.jumpDirection.copy(this.lastMoveDirection);
    }
    // Standing and moving hops share the expressive forward-jump animation flow;
    // horizontal motion still comes exclusively from the captured takeoff velocity.
    this._jumpKind = 'forwardJump';

    this.jumpState = MML_JUMP_STATES.Rising;
    this._jumpLandingVisualTimer = 0;
    this._jumpLandingVisualState = null;
    this._jumpLandingVisualClipKey = null;
  }

  _approachHorizontalVelocity(targetVelocity, acceleration, dt) {
    horizontalVelocityDelta.set(
      targetVelocity.x - this.velocity.x,
      0,
      targetVelocity.z - this.velocity.z,
    );

    const deltaLength = horizontalVelocityDelta.length();
    const maxDelta = Math.max(0, acceleration) * dt;
    if (deltaLength <= 0.0001 || maxDelta <= 0) {
      return;
    }

    if (deltaLength <= maxDelta) {
      this.velocity.x = targetVelocity.x;
      this.velocity.z = targetVelocity.z;
      return;
    }

    horizontalVelocityDelta.multiplyScalar(maxDelta / deltaLength);
    this.velocity.x += horizontalVelocityDelta.x;
    this.velocity.z += horizontalVelocityDelta.z;
  }

  _applyGroundHorizontalControl(targetVelocity, dt) {
    const targetSpeedSq = targetVelocity.x * targetVelocity.x + targetVelocity.z * targetVelocity.z;
    const acceleration = targetSpeedSq > 0.0001
      ? this._getJumpSetting('groundAcceleration', DEFAULT_MML_JUMP_SETTINGS.groundAcceleration)
      : this._getJumpSetting('groundDeceleration', DEFAULT_MML_JUMP_SETTINGS.groundDeceleration);
    this._approachHorizontalVelocity(targetVelocity, acceleration, dt);
  }

  _applyAirHorizontalControl(targetVelocity, dt) {
    const targetSpeedSq = targetVelocity.x * targetVelocity.x + targetVelocity.z * targetVelocity.z;
    if (targetSpeedSq <= 0.0001) {
      return;
    }

    let acceleration = this._getJumpSetting('airAcceleration', DEFAULT_MML_JUMP_SETTINGS.airAcceleration);
    const currentSpeedSq = this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z;
    if (currentSpeedSq > 0.0001) {
      const dot = (this.velocity.x * targetVelocity.x) + (this.velocity.z * targetVelocity.z);
      if (dot < 0) {
        acceleration *= this._getJumpSetting('airTurnMultiplier', DEFAULT_MML_JUMP_SETTINGS.airTurnMultiplier);
      }
    }

    this._approachHorizontalVelocity(targetVelocity, acceleration, dt);
  }

  _updatePhysicalJumpAndMovement(dt, targetVelocity = desiredMoveVelocity, {
    arenaRadius = 32,
    movementOptions = {},
  } = {}) {
    const groundY = this._resolvePhysicalGroundY(movementOptions);
    const steppedOffGround = this.jumpState === MML_JUMP_STATES.Grounded
      && this.root.position.y - groundY > GROUNDED_STEP_DOWN_SNAP_HEIGHT;
    if (steppedOffGround) {
      this.jumpState = MML_JUMP_STATES.Falling;
      this._coyoteTimer = Math.max(
        this._coyoteTimer,
        this._getJumpSetting('coyoteTime', DEFAULT_MML_JUMP_SETTINGS.coyoteTime),
      );
      this.velocity.y = Math.min(0, this.velocity.y);
      this._jumpAirTimer = 0;
      this.jumpStartY = this.root.position.y;
      if (this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z > 0.0025) {
        this.jumpDirection.set(this.velocity.x, 0, this.velocity.z).normalize();
      }
    }

    if (this.jumpState === MML_JUMP_STATES.LandRecovery) {
      this._landingRecoveryTimer = Math.max(0, this._landingRecoveryTimer - dt);
      if (this._landingRecoveryTimer <= 0) {
        this.jumpState = MML_JUMP_STATES.Grounded;
      }
    }

    if (this.jumpState === MML_JUMP_STATES.Grounded || this.jumpState === MML_JUMP_STATES.LandRecovery) {
      this._coyoteTimer = this._getJumpSetting('coyoteTime', DEFAULT_MML_JUMP_SETTINGS.coyoteTime);
      this._jumpGroundY = groundY;
      this.velocity.y = 0;
      this.root.position.y = groundY;
    } else {
      this._coyoteTimer = steppedOffGround ? this._coyoteTimer : Math.max(0, this._coyoteTimer - dt);
    }

    if (this._canStartBufferedPhysicalJump()) {
      this._startPhysicalJump();
    }

    const airborne = this.isJumpAirborne();
    if (airborne) {
      this._applyAirHorizontalControl(targetVelocity, dt);
      const motionResult = this._integrateAirborneJump(dt, groundY);
      if (motionResult === 'ledgeCling') {
        return motionResult;
      }
    } else {
      const groundedTargetVelocity = this.jumpState === MML_JUMP_STATES.LandRecovery
        ? zeroMoveVelocity
        : targetVelocity;
      this._applyGroundHorizontalControl(groundedTargetVelocity, dt);
      this.root.position.addScaledVector(this.velocity, dt);
      this.root.position.y = groundY;
    }

    this.root.position.x = THREE.MathUtils.clamp(this.root.position.x, -arenaRadius, arenaRadius);
    this.root.position.z = THREE.MathUtils.clamp(this.root.position.z, -arenaRadius, arenaRadius);
    this._jumpBufferTimer = Math.max(0, this._jumpBufferTimer - dt);
    return null;
  }

  _integrateAirborneJump(dt, groundY) {
    const previousRootY = this.root.position.y;
    const gravity = this._getJumpGravity() * (this.velocity.y <= 0 ? this._getFallGravityMultiplier() : 1);
    this.root.position.x += this.velocity.x * dt;
    this.root.position.z += this.velocity.z * dt;
    this.root.position.y += (this.velocity.y * dt) + (0.5 * gravity * dt * dt);
    this.velocity.y += gravity * dt;
    this._jumpAirTimer += dt;

    if (this.jumpState === MML_JUMP_STATES.Rising && this.velocity.y <= 0) {
      this.jumpState = MML_JUMP_STATES.Falling;
      this._jumpFallTransitionActive = true;
    }

    if (this._tryStartJumpLedgeCling(this._jumpKind, this._getPhysicalJumpAnimationProgress())) {
      this.velocity.set(0, 0, 0);
      this.jumpState = MML_JUMP_STATES.Grounded;
      this._jumpBufferTimer = 0;
      return 'ledgeCling';
    }

    let resolvedGroundY = groundY;
    if (this.jumpState === MML_JUMP_STATES.Falling
      && this.velocity.y <= 0
      && this._tryResolveJumpPlatformLanding(this._jumpKind, previousRootY)) {
      resolvedGroundY = this.root.position.y;
    }

    if (this.velocity.y <= 0 && this.root.position.y <= resolvedGroundY) {
      this._landPhysicalJump(resolvedGroundY);
    }

    return null;
  }

  _landPhysicalJump(groundY) {
    const resolvedGroundY = Number.isFinite(groundY) ? groundY : this._jumpGroundY;
    const damping = THREE.MathUtils.clamp(
      this._getJumpSetting('landingHorizontalDamping', DEFAULT_MML_JUMP_SETTINGS.landingHorizontalDamping),
      0,
      1,
    );
    this.root.position.y = resolvedGroundY;
    this.velocity.y = 0;
    this.velocity.x *= damping;
    this.velocity.z *= damping;
    this._jumpGroundY = resolvedGroundY;
    this._landingRecoveryTimer = Math.max(
      0,
      this._getJumpSetting('landingRecoveryTime', DEFAULT_MML_JUMP_SETTINGS.landingRecoveryTime),
    );
    this.jumpState = this._landingRecoveryTimer > 0
      ? MML_JUMP_STATES.LandRecovery
      : MML_JUMP_STATES.Grounded;
    this.modelRoot.position.y = 0;
    this._jumpFallTransitionActive = false;
  }

  _getPhysicalJumpAnimationState() {
    if (this.jumpState === MML_JUMP_STATES.Rising) {
      return 'forwardJump';
    }

    if (this.jumpState === MML_JUMP_STATES.Falling) {
      if (this._jumpFallTransitionActive
        && !this.externalRig?.hasAnimationClipFinished?.('forwardJumpFall')) {
        return 'forwardJumpFall';
      }
      this._jumpFallTransitionActive = false;
      return 'fall';
    }

    if (this.jumpState === MML_JUMP_STATES.LandRecovery) {
      return 'land';
    }

    return null;
  }

  _getPhysicalJumpAnimationProgress() {
    if (this.jumpState === MML_JUMP_STATES.LandRecovery) {
      const duration = Math.max(0.001, this._getJumpSetting('landingRecoveryTime', DEFAULT_MML_JUMP_SETTINGS.landingRecoveryTime));
      return THREE.MathUtils.clamp(1 - (this._landingRecoveryTimer / duration), 0, 1);
    }

    if (!this.isJumpAirborne()) {
      return null;
    }

    const progress = THREE.MathUtils.clamp(this._jumpAirTimer / Math.max(0.001, this._getEstimatedJumpAirTime()), 0, 1);
    return this.jumpState === MML_JUMP_STATES.Rising
      ? Math.min(progress, PHYSICAL_JUMP_RISING_CLIP_END)
      : progress;
  }

  tryDodgeRoll(input = new Set(), movementOptions = {}) {
    const cancelFiring = this._isProjectileFiringPoseActive();
    if (!this.animation.playDodgeRoll?.(DODGE_ROLL_DURATION, { cancelAttack: cancelFiring })) {
      return false;
    }

    this._cancelFiringPoseForDodge(cancelFiring);
    this._cancelShieldGuardForDodge();
    this._resolveActionDirection(input, movementOptions, this.dodgeDirection);
    this.faceDirection(this.dodgeDirection);
    this.dodgeRollYaw = this.root.rotation.y;
    this.attackFacingTimer = 0;
    this.movementLockTimer = Math.max(this.movementLockTimer, DODGE_ROLL_DURATION);
    this.movementLockMultiplier = 0;
    this.onDodgeStarted?.();
    return true;
  }

  tryLateralDodgeRoll(input = new Set(), movementOptions = {}) {
    const lateral = this._getLateralDodgeInput(input);
    const cancelFiring = this._isProjectileFiringPoseActive();

    if (lateral === 0 || !this.animation.playDodgeRoll?.(DODGE_ROLL_DURATION, { cancelAttack: cancelFiring })) {
      return false;
    }

    this._cancelFiringPoseForDodge(cancelFiring);
    this._cancelShieldGuardForDodge();
    this._resolveLateralActionDirection(lateral, movementOptions, this.dodgeDirection);
    this.faceDirection(this.dodgeDirection);
    this.dodgeRollYaw = this.root.rotation.y;
    this.attackFacingTimer = 0;
    this.movementLockTimer = Math.max(this.movementLockTimer, DODGE_ROLL_DURATION);
    this.movementLockMultiplier = 0;
    this.onDodgeStarted?.();
    return true;
  }

  _isProjectileFiringPoseActive() {
    return this._attackWeaponKind === 'projectile'
      && (this.animation.attackTimer > 0 || this.bracedFireTimer > 0);
  }

  _cancelFiringPoseForDodge(cancelFiring = false) {
    if (!cancelFiring) {
      return;
    }

    this._releaseProjectileAim();
    this._attackWeaponKind = null;
    this.attackFacingTimer = 0;
  }

  _cancelShieldGuardForDodge() {
    // A roll replaces the guard pose. Keep the existing cooldown so repeatedly
    // rolling cannot be used to reset shield availability.
    this.guardTimer = 0;
    this.guardParryTimer = 0;
    this.lastGuardResult = null;
    this.bracedFireTimer = 0;
    this.bracedBackpedalTimer = 0;
  }

  tryJump(input = new Set(), movementOptions = {}) {
    if (this.isLedgeClinging()) {
      return this._tryLedgeJump(input, movementOptions);
    }

    this._resolveActionDirection(input, movementOptions, this.jumpDirection);

    if (this.dead || this.animation?.actionState || this.animation?.hurtTimer > 0 || this.animation?.attackTimer > 0) {
      return false;
    }

    this._jumpBufferTimer = Math.max(
      this._jumpBufferTimer,
      this._getJumpSetting('jumpBufferTime', DEFAULT_MML_JUMP_SETTINGS.jumpBufferTime),
    );

    if (this._canStartBufferedPhysicalJump()) {
      this._startPhysicalJump();
    }

    return true;
  }

  getJumpReachHeight() {
    return this._getConfiguredJumpHeight();
  }

  getCameraFocusPosition(target = new THREE.Vector3()) {
    if (this.isPowerKnockbackActive()) {
      this.root.updateMatrixWorld(true);
      const torso = this.externalRig?.joints?.get('spine')
        ?? this.externalRig?.joints?.get('hips')
        ?? this.humanoid?.joints?.get('spine')
        ?? this.humanoid?.joints?.get('hips');
      if (torso) {
        return torso.getWorldPosition(target);
      }

      target.copy(this.root.position);
      target.y += 0.65;
      return target;
    }

    target.copy(this.root.position);

    const actionState = this.animation?.actionState;
    const includeVisualLift = actionState === 'neutralJump'
      || actionState === 'forwardJump'
      || actionState === 'dodgeRoll'
      || this._jumpLandingVisualTimer > 0;
    if (includeVisualLift) {
      target.y += Math.max(0, this.modelRoot?.position?.y ?? 0);
    }

    return target;
  }

  getPowerKnockbackCameraAnchorY() {
    return this.isPowerKnockbackActive() && Number.isFinite(this.powerKnockbackCameraAnchorY)
      ? this.powerKnockbackCameraAnchorY
      : null;
  }

  previewExternalAnimation(dt, {
    moving = false,
    running = false,
    moveAmount = moving ? (running ? 1.35 : 1) : 0,
    projectileAiming = false,
    lockOnActive = false,
    strafeAmount = 0,
    turnAmount = 0,
    backpedaling = false,
    attackKind = null,
    attackProgress = null,
    forceSwordArm = false,
    clipKey = null,
  } = {}) {
    if (this.dead) {
      return;
    }

    this.animation.update(dt, {
      moving,
      running,
      moveAmount,
    });
    this.updateWeaponVisualState();
    const previewAttackKind = projectileAiming ? 'projectile' : attackKind ?? this._attackWeaponKind;
    const previewAttackProgress = Number.isFinite(attackProgress)
      ? attackProgress
      : projectileAiming
      ? 1
      : null;

    if (forceSwordArm && previewAttackKind === 'beamBlade') {
      this.externalRig?.setDrillArmActive?.(false);
      this.externalRig?.setBusterArmActive?.(true);
      this.externalRig?.setBeamBladeActive?.(true, this.getActiveWeaponGlowColor(this.weaponColor.getHex()));
    }

    this._updateExternalModelMotion(dt, moving, moveAmount, backpedaling, running, {
      lockOnActive,
      strafeAmount,
      turnAmount,
      projectileAiming,
      attackKind: previewAttackKind,
      attackProgress: previewAttackProgress,
      clipKey,
      animationState: previewAttackKind === 'beamBlade' ? 'attacking' : undefined,
      skipAttackKindReset: true,
    });
  }

  _hasMovementInput(input = new Set()) {
    return input.has('KeyW')
      || input.has('ArrowUp')
      || input.has('KeyS')
      || input.has('ArrowDown')
      || input.has('KeyA')
      || input.has('ArrowLeft')
      || input.has('KeyD')
      || input.has('ArrowRight');
  }

  hasLateralDodgeInput(input = new Set()) {
    return this._getLateralDodgeInput(input) !== 0;
  }

  _getLateralDodgeInput(input = new Set()) {
    const left = input.has('KeyA') || input.has('ArrowLeft');
    const right = input.has('KeyD') || input.has('ArrowRight');

    if (left === right) {
      return 0;
    }

    return right ? 1 : -1;
  }

  _resolveActionDirection(input = new Set(), movementOptions = {}, target = worldMoveDirection) {
    const x = (input.has('KeyD') || input.has('ArrowRight') ? 1 : 0)
      + (input.has('KeyA') || input.has('ArrowLeft') ? -1 : 0);
    const y = (input.has('KeyW') || input.has('ArrowUp') ? 1 : 0)
      + (input.has('KeyS') || input.has('ArrowDown') ? -1 : 0);

    if (Math.abs(x) > 0.001 || Math.abs(y) > 0.001) {
      moveVector.set(x, y).normalize();
      this._resolveMovementDirection(moveVector, movementOptions);
      target.copy(worldMoveDirection);
    } else {
      target.copy(this.lastMoveDirection);
    }

    target.y = 0;

    if (target.lengthSq() <= 0.0001) {
      target.set(0, 0, 1);
    } else {
      target.normalize();
    }

    return target;
  }

  _resolveLateralActionDirection(lateral = 0, movementOptions = {}, target = worldMoveDirection) {
    moveVector.set(Math.sign(lateral), 0);
    this._resolveMovementDirection(moveVector, movementOptions);
    target.copy(worldMoveDirection);
    target.y = 0;

    if (target.lengthSq() <= 0.0001) {
      target.set(Math.sign(lateral) || 1, 0, 0);
    } else {
      target.normalize();
    }

    return target;
  }

  _updateFullBodyActionMotion(dt, arenaRadius = 32, stateOverride = null, progressOverride = null) {
    const state = stateOverride ?? this.animation.state;
    const progress = Number.isFinite(progressOverride)
      ? THREE.MathUtils.clamp(progressOverride, 0, 1)
      : this.animation.getActionProgress?.() ?? 0;
    const ledgeClingStarted = this._tryStartJumpLedgeCling(state, progress);

    if (ledgeClingStarted) {
      this.movementLockMultiplier = 0;
    } else if (state === 'dodgeRoll') {
      this.root.rotation.y = this.dodgeRollYaw;
      this._applyActionDisplacement(this.dodgeDirection, DODGE_ROLL_DISTANCE, DODGE_ROLL_DURATION, progress, dt);
    } else if (state === 'wallJump') {
      this.root.rotation.y = this.ledgeWallJumpYaw;
      const bakedMotion = this.externalRig?.sampleRootMotionProgress?.(
        'jumpFromWall',
        progress,
        ledgeWallJumpRootMotion,
      );
      const horizontalProgress = bakedMotion?.horizontal
        ?? THREE.MathUtils.smoothstep(progress, 0, 1);
      const verticalProgress = bakedMotion?.vertical
        ?? THREE.MathUtils.smoothstep(progress, 0, 1);
      this.root.position.copy(this.ledgeWallJumpStartPosition)
        .addScaledVector(this.ledgeWallJumpDirection, LEDGE_WALL_JUMP_DISTANCE * horizontalProgress);
      this.root.position.y += LEDGE_WALL_JUMP_LIFT * verticalProgress;
    } else if (state === 'forwardJump') {
      this._applyForwardJumpDisplacement(this.jumpDirection, FORWARD_JUMP_DISTANCE, progress);
    }

    this.root.position.x = THREE.MathUtils.clamp(this.root.position.x, -arenaRadius, arenaRadius);
    this.root.position.z = THREE.MathUtils.clamp(this.root.position.z, -arenaRadius, arenaRadius);
  }

  _tryStartJumpLedgeCling(state, progress = 0) {
    if (state !== 'neutralJump' && state !== 'forwardJump') {
      return false;
    }

    if (typeof this.jumpLedgeClingResolver !== 'function') {
      return false;
    }

    return this.jumpLedgeClingResolver({
      player: this,
      state,
      progress: THREE.MathUtils.clamp(progress, 0, 1),
      root: this.root,
      jumpDirection: this.jumpDirection,
      jumpStartY: this.jumpStartY,
      jumpReachHeight: this.getJumpReachHeight(state),
    }) === true;
  }

  _tryResolveJumpPlatformLanding(state, previousRootY = null) {
    if (state !== 'neutralJump' && state !== 'forwardJump') {
      return false;
    }

    if (typeof this.jumpPlatformLandingResolver !== 'function') {
      return false;
    }

    return this.jumpPlatformLandingResolver({
      player: this,
      state,
      root: this.root,
      jumpDirection: this.jumpDirection,
      jumpStartY: this.jumpStartY,
      jumpReachHeight: this.getJumpReachHeight(state),
      previousRootY,
    }) === true;
  }

  isLedgeClinging() {
    return Boolean(this.ledgeCling);
  }

  startLedgeCling(ledge = {}) {
    if (!ledge.hangPosition || !ledge.climbPosition || !ledge.normal) {
      return false;
    }

    const normal = ledge.normal.clone();
    normal.y = 0;
    if (normal.lengthSq() <= 0.0001) {
      normal.set(0, 0, -1);
    } else {
      normal.normalize();
    }

    const inward = normal.clone().multiplyScalar(-1);
    if (ledge.autoClimb === true) {
      return this._stepOntoLowLedge(ledge, inward);
    }

    this.ledgeCling = {
      id: ledge.id ?? 'debugLedge',
      state: 'jumpingToHanging',
      timer: 0,
      duration: LEDGE_JUMP_TO_HANG_DURATION,
      normal,
      inward,
      startPosition: this.root.position.clone(),
      hangPosition: ledge.hangPosition.clone(),
      handPosition: (ledge.handPosition?.clone() ?? ledge.hangPosition.clone()
        .addScaledVector(normal, LEDGE_HAND_OUTWARD_OFFSET)
        .setY(Number.isFinite(ledge.topY) ? ledge.topY : ledge.climbPosition.y)),
      climbPosition: ledge.climbPosition.clone(),
      climbStartPosition: ledge.hangPosition.clone(),
      climbLeftHandPosition: new THREE.Vector3(),
      climbRightHandPosition: new THREE.Vector3(),
      climbLeftHandQuaternion: new THREE.Quaternion(),
      climbRightHandQuaternion: new THREE.Quaternion(),
      climbReleasePosition: new THREE.Vector3(),
      climbHandAnchorsCaptured: false,
      climbHandsReleased: false,
      climbHighestRootY: -Infinity,
      climbFarthestInward: -Infinity,
      autoClimb: ledge.autoClimb === true,
      topY: Number.isFinite(ledge.topY) ? ledge.topY : ledge.climbPosition.y,
      minimumRootY: Number.isFinite(ledge.minimumRootY) ? ledge.minimumRootY : null,
      inputToward: false,
    };

    this.animation.actionState = null;
    this.animation.actionTimer = 0;
    this.animation.actionDuration = 0;
    this.animation.setState('ledgeCling');
    this._forwardJumpTravelProgress = 0;
    this._jumpLandingVisualTimer = 0;
    this._jumpLandingVisualState = null;
    this._jumpLandingVisualClipKey = null;
    this.movementLockTimer = 0;
    this.movementLockMultiplier = 0;
    this.faceDirection(inward);
    return true;
  }

  _stepOntoLowLedge(ledge, inward) {
    if (!ledge?.climbPosition) {
      return false;
    }

    this.root.position.copy(ledge.climbPosition);
    this.velocity.set(0, 0, 0);
    this.jumpState = MML_JUMP_STATES.Grounded;
    this._jumpGroundY = this.root.position.y;
    this._jumpBufferTimer = 0;
    this._landingRecoveryTimer = 0;
    this._jumpFallTransitionActive = false;
    this.ledgeCling = null;
    this.animation.actionState = null;
    this.animation.actionTimer = 0;
    this.animation.actionDuration = 0;
    this.animation.setState('idle');
    this._jumpLandingVisualTimer = 0;
    this._jumpLandingVisualState = null;
    this._jumpLandingVisualClipKey = null;
    this.movementLockTimer = 0;
    this.movementLockMultiplier = 1;
    this.modelRoot.position.y = 0;
    this.lastMoveDirection.copy(inward);
    this.faceDirection(inward);
    return true;
  }

  getLedgeClingDiagnostics() {
    if (!this.ledgeCling) {
      return null;
    }

    return {
      id: this.ledgeCling.id,
      state: this.ledgeCling.state,
      progress: this._getLedgeActionProgress(),
      inputToward: this.ledgeCling.inputToward,
      topY: this.ledgeCling.topY,
    };
  }

  _tryLedgeJump(input = new Set(), movementOptions = {}) {
    if (!this.ledgeCling) {
      return false;
    }

    const state = this.ledgeCling.state;
    const inputToward = this._isInputTowardLedge(input, movementOptions);
    this.ledgeCling.inputToward = inputToward;

    if (state === 'hangingIdle' && inputToward) {
      this._startLedgeClimbPreparation();
      return true;
    }

    return true;
  }

  _startLedgeWallJump(movementOptions = {}) {
    const ledge = this.ledgeCling;
    if (!ledge || !this.animation.playWallJump?.(LEDGE_WALL_JUMP_DURATION)) {
      return false;
    }

    this.ledgeWallJumpDirection.copy(ledge.normal).setY(0).normalize();
    this.ledgeWallJumpStartPosition.copy(this.root.position);
    this.ledgeWallJumpGroundY = Number.isFinite(movementOptions.groundY)
      ? movementOptions.groundY
      : this._jumpGroundY;
    this.ledgeWallJumpYaw = this.root.rotation.y;
    this.ledgeCling = null;
    this.velocity.set(0, 0, 0);
    this._jumpBufferTimer = 0;
    this._coyoteTimer = 0;
    this._landingRecoveryTimer = 0;
    this.movementLockTimer = Math.max(this.movementLockTimer, LEDGE_WALL_JUMP_DURATION);
    this.movementLockMultiplier = 0;
    return true;
  }

  _finishLedgeWallJumpToFall() {
    this.jumpState = MML_JUMP_STATES.Falling;
    this.jumpStartY = this.root.position.y;
    this._jumpGroundY = this.ledgeWallJumpGroundY;
    this._jumpAirTimer = this._getEstimatedJumpAirTime() * 0.55;
    this._jumpKind = 'forwardJump';
    this.jumpDirection.copy(this.ledgeWallJumpDirection);
    this.takeoffHorizontalVelocity.copy(this.ledgeWallJumpDirection)
      .multiplyScalar(LEDGE_WALL_JUMP_FALL_SPEED);
    this.velocity.copy(this.takeoffHorizontalVelocity);
    this.velocity.y = LEDGE_WALL_JUMP_FALL_VERTICAL_VELOCITY;
    this.lastMoveDirection.copy(this.ledgeWallJumpDirection);
    this.movementLockTimer = 0;
    this.movementLockMultiplier = 1;
  }

  _updateLedgeClingState(dt, input = new Set(), movementOptions = {}) {
    const ledge = this.ledgeCling;
    if (!ledge) {
      return;
    }

    const canJumpFromWall = ledge.state === 'settlingToFreeHang'
      || ledge.state === 'hangingIdle';
    if (canJumpFromWall && (input.has('KeyS') || input.has('ArrowDown'))) {
      this._startLedgeWallJump(movementOptions);
      return;
    }

    ledge.inputToward = this._isInputTowardLedge(input, movementOptions);
    ledge.timer = Math.min(ledge.duration, ledge.timer + dt);
    const progress = this._getLedgeActionProgress();

    if (ledge.state === 'jumpingToHanging') {
      const eased = THREE.MathUtils.smoothstep(progress, 0, 1);
      this.root.position.lerpVectors(
        ledge.startPosition,
        this._getLedgeRootAnchorPosition(ledgeAnchorPosition),
        eased,
      );
      if (progress >= 1) {
        this._setLedgeState('settlingToFreeHang', LEDGE_SETTLE_TO_FREE_HANG_DURATION);
      }
    } else if (ledge.state === 'settlingToFreeHang') {
      this.root.position.copy(this._getLedgeRootAnchorPosition(ledgeAnchorPosition));
      if (progress >= 1) {
        if (ledge.inputToward) {
          this._startLedgeClimbPreparation();
        } else {
          this._setLedgeState('hangingIdle', 0);
        }
      }
    } else if (ledge.state === 'hangingIdle') {
      this.root.position.copy(this._getLedgeRootAnchorPosition(ledgeAnchorPosition));
      if (ledge.inputToward) {
        this._startLedgeClimbPreparation();
      }
    } else if (ledge.state === 'preparingToClimb') {
      if (progress >= 1) {
        this._captureClimbHandAnchors();
        this._startLedgeClimb();
      } else {
        this.root.position.copy(this._getLedgeRootAnchorPosition(ledgeAnchorPosition));
      }
    } else if (ledge.state === 'climbingUp') {
      if (ledge.autoClimb) {
        this.root.position.lerpVectors(
          ledge.climbStartPosition,
          ledge.climbPosition,
          THREE.MathUtils.smoothstep(progress, 0, 1),
        );
      } else if (ledge.climbHandsReleased) {
        const releaseProgress = THREE.MathUtils.clamp(
          (progress - LEDGE_CLIMB_HAND_RELEASE_PROGRESS)
            / (1 - LEDGE_CLIMB_HAND_RELEASE_PROGRESS),
          0,
          1,
        );
        this.root.position.lerpVectors(
          ledge.climbReleasePosition,
          ledge.climbPosition,
          THREE.MathUtils.smoothstep(releaseProgress, 0, 1),
        );
      }
      if (progress >= 1) {
        this._finishLedgeClimb();
        return;
      }
    }

    this.faceDirection(ledge.inward);
    this.lastMoveDirection.copy(ledge.inward);
    this.isRunning = false;
    this.tankTurnActive = false;
    this.tankTurnAmount = 0;
    this.tankTurnTranslating = false;
    this.animation.setState('ledgeCling');
    this.updateWeaponVisualState();
    this._updateExternalModelMotion(dt, false, 0, false, false, {
      animationState: this._getLedgeExternalState(),
      actionProgress: this._getLedgeActionProgress(),
      clipKey: this._getLedgeClipKey(),
      skipAttackKindReset: true,
    });
    if (ledge.state === 'climbingUp' && !ledge.autoClimb) {
      this._anchorClimbHands(this._getLedgeActionProgress());
    } else {
      this._anchorLedgeAnimationPose(this._getLedgeActionProgress());
    }
    if (Number.isFinite(ledge.minimumRootY)) {
      this.root.position.y = Math.max(this.root.position.y, ledge.minimumRootY);
    }
  }

  _setLedgeState(state, duration) {
    if (!this.ledgeCling) {
      return;
    }

    this.ledgeCling.state = state;
    this.ledgeCling.timer = 0;
    this.ledgeCling.duration = Math.max(0.001, duration);
  }

  _startLedgeClimb() {
    if (!this.ledgeCling) {
      return false;
    }

    if (!this.ledgeCling.climbHandAnchorsCaptured) {
      this._captureClimbHandAnchors();
    }
    this.ledgeCling.climbStartPosition.copy(this.root.position);
    this.ledgeCling.climbReleasePosition.copy(this.root.position);
    this.ledgeCling.climbHandsReleased = false;
    this.ledgeCling.climbHighestRootY = this.root.position.y;
    this.ledgeCling.climbFarthestInward = this.root.position.dot(this.ledgeCling.inward);
    this._setLedgeState('climbingUp', LEDGE_CLIMB_UP_DURATION);
    return true;
  }

  _startLedgeClimbPreparation() {
    if (!this.ledgeCling || this.ledgeCling.state === 'preparingToClimb') {
      return false;
    }

    this._setLedgeState('preparingToClimb', LEDGE_PREPARE_CLIMB_DURATION);
    return true;
  }

  _finishLedgeClimb() {
    const ledge = this.ledgeCling;
    if (ledge) {
      this.root.position.copy(ledge.climbPosition);
      this.lastMoveDirection.copy(ledge.inward);
      this.faceDirection(ledge.inward);
    }

    this.ledgeCling = null;
    this.animation.setState('idle');
    this.movementLockMultiplier = 1;
    this.movementLockTimer = 0;
    this.modelRoot.position.y = 0;
  }

  _captureClimbHandAnchors() {
    const ledge = this.ledgeCling;
    const leftWrist = this.externalRig?.joints?.get('leftWrist');
    const rightWrist = this.externalRig?.joints?.get('rightWrist');
    if (!ledge || !leftWrist) {
      return false;
    }

    this.root.updateMatrixWorld(true);
    leftWrist.getWorldPosition(ledge.climbLeftHandPosition);
    leftWrist.getWorldQuaternion(ledge.climbLeftHandQuaternion);
    if (rightWrist) {
      rightWrist.getWorldPosition(ledge.climbRightHandPosition);
      rightWrist.getWorldQuaternion(ledge.climbRightHandQuaternion);
    } else {
      ledge.climbRightHandPosition.copy(ledge.climbLeftHandPosition);
      ledge.climbRightHandQuaternion.copy(ledge.climbLeftHandQuaternion);
    }
    ledge.climbHandAnchorsCaptured = true;
    return true;
  }

  _anchorClimbHands(progress = this._getLedgeActionProgress()) {
    const ledge = this.ledgeCling;
    const leftWrist = this.externalRig?.joints?.get('leftWrist');
    const rightWrist = this.externalRig?.joints?.get('rightWrist');
    if (!ledge
      || ledge.state !== 'climbingUp'
      || !ledge.climbHandAnchorsCaptured
      || !leftWrist) {
      return;
    }

    const releaseBlend = THREE.MathUtils.smoothstep(
      progress,
      LEDGE_CLIMB_HAND_RELEASE_PROGRESS,
      LEDGE_CLIMB_HAND_RELEASE_END_PROGRESS,
    );
    const anchorWeight = 1 - releaseBlend;
    if (anchorWeight <= 0) {
      return;
    }

    // First translate the complete rig around the planted wrist midpoint so
    // the FBX pose, rather than a hand-authored body path, drives the pull-up.
    this.root.updateMatrixWorld(true);
    leftWrist.getWorldPosition(ledgeAnimatedWristPosition);
    if (!ledge.climbHandsReleased && rightWrist) {
      rightWrist.getWorldPosition(ledgeAnimatedRightWristPosition);
      ledgeAnimatedWristPosition.add(ledgeAnimatedRightWristPosition).multiplyScalar(0.5);
      ledgeRootCorrection.copy(ledge.climbLeftHandPosition)
        .add(ledge.climbRightHandPosition)
        .multiplyScalar(0.5)
        .sub(ledgeAnimatedWristPosition);
    } else if (!ledge.climbHandsReleased) {
      ledgeRootCorrection.copy(ledge.climbLeftHandPosition).sub(ledgeAnimatedWristPosition);
    }

    if (!ledge.climbHandsReleased) {
      this.root.position.add(ledgeRootCorrection);
      this.root.position.y = Math.max(this.root.position.y, ledge.climbHighestRootY);
      ledge.climbHighestRootY = this.root.position.y;
      const inwardDistance = this.root.position.dot(ledge.inward);
      if (inwardDistance < ledge.climbFarthestInward) {
        this.root.position.addScaledVector(
          ledge.inward,
          ledge.climbFarthestInward - inwardDistance,
        );
      } else {
        ledge.climbFarthestInward = inwardDistance;
      }
    }
    this.root.updateMatrixWorld(true);

    // The animation still supplies the shoulder and elbow shape. A fresh CCD
    // solve each frame only removes retargeting drift at the planted wrists.
    this.externalRig?.anchorHandsToWorldPositions?.({
      leftPosition: ledge.climbLeftHandPosition,
      leftQuaternion: ledge.climbLeftHandQuaternion,
      rightPosition: rightWrist ? ledge.climbRightHandPosition : null,
      rightQuaternion: rightWrist ? ledge.climbRightHandQuaternion : null,
      weight: anchorWeight,
    });
    this.root.updateMatrixWorld(true);

    if (!ledge.climbHandsReleased && progress >= LEDGE_CLIMB_HAND_RELEASE_PROGRESS) {
      ledge.climbReleasePosition.copy(this.root.position);
      ledge.climbHandsReleased = true;
    }
  }

  _getLedgeActionProgress() {
    const ledge = this.ledgeCling;
    if (!ledge) {
      return 0;
    }

    if (ledge.state === 'hangingIdle') {
      return 0;
    }

    return THREE.MathUtils.clamp(ledge.timer / Math.max(0.001, ledge.duration), 0, 1);
  }

  _getLedgeExternalState() {
    return this.ledgeCling?.state ?? 'idle';
  }

  _getLedgeRootAnchorPosition(target = ledgeAnchorPosition) {
    const ledge = this.ledgeCling;
    if (!ledge) {
      return target.set(0, 0, 0);
    }

    target.copy(ledge.hangPosition)
      .addScaledVector(ledge.normal, LEDGE_FREE_HANG_ROOT_OUTWARD_OFFSET);
    target.y += LEDGE_FREE_HANG_ROOT_VERTICAL_OFFSET;
    return target;
  }

  _anchorLedgeAnimationPose(progress = this._getLedgeActionProgress()) {
    const ledge = this.ledgeCling;
    const leftWrist = this.externalRig?.joints?.get('leftWrist');
    if (!ledge?.handPosition || !ledge.normal || !leftWrist) {
      return;
    }

    if (ledge.state === 'climbingUp') {
      return;
    }

    // The ledge clips fully own every arm bone. Keep the authored grip planted
    // by translating only the character root.
    this.root.updateMatrixWorld(true);
    leftWrist.getWorldPosition(ledgeAnimatedWristPosition);
    ledgeRootCorrection.copy(ledge.handPosition).sub(ledgeAnimatedWristPosition);
    this.root.position.addScaledVector(
      ledge.normal,
      ledgeRootCorrection.dot(ledge.normal),
    );
    this.root.position.y += ledgeRootCorrection.y;
    this.root.updateMatrixWorld(true);
  }

  _getLedgeClipKey() {
    switch (this.ledgeCling?.state) {
      case 'jumpingToHanging':
        return 'jumpingToHanging';
      case 'settlingToFreeHang':
        return 'bracedToFreeHang';
      case 'hangingIdle':
        return 'hangingIdle';
      case 'preparingToClimb':
        return 'freeHangToBraced';
      case 'climbingUp':
        return 'ledgeClimbUp';
      default:
        return null;
    }
  }

  _isInputTowardLedge(input = new Set(), movementOptions = {}) {
    const ledge = this.ledgeCling;
    if (!ledge) {
      return false;
    }

    const x = (input.has('KeyD') || input.has('ArrowRight') ? 1 : 0)
      + (input.has('KeyA') || input.has('ArrowLeft') ? -1 : 0);
    const y = (input.has('KeyW') || input.has('ArrowUp') ? 1 : 0)
      + (input.has('KeyS') || input.has('ArrowDown') ? -1 : 0);

    if (Math.abs(x) <= 0.001 && Math.abs(y) <= 0.001) {
      return false;
    }

    const forward = movementOptions.movementForward ?? movementOptions.forward;
    const right = movementOptions.movementRight ?? movementOptions.right;
    ledgeMovementDirection.set(0, 0, 0);

    if (forward && right) {
      movementBasisForward.copy(forward).setY(0);
      movementBasisRight.copy(right).setY(0);

      if (movementBasisForward.lengthSq() > 0.0001) {
        movementBasisForward.normalize();
        ledgeMovementDirection.addScaledVector(movementBasisForward, y);
      }

      if (movementBasisRight.lengthSq() > 0.0001) {
        movementBasisRight.normalize();
        ledgeMovementDirection.addScaledVector(movementBasisRight, x);
      }
    } else {
      ledgeFaceDirection.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
      ledgeMovementDirection.addScaledVector(ledgeFaceDirection, y);
      ledgeMovementDirection.addScaledVector(
        ledgeFaceDirection.set(Math.cos(this.root.rotation.y), 0, -Math.sin(this.root.rotation.y)),
        x,
      );
    }

    if (ledgeMovementDirection.lengthSq() <= 0.0001) {
      return false;
    }

    ledgeMovementDirection.normalize();
    return ledgeMovementDirection.dot(ledge.inward) >= LEDGE_TOWARD_INPUT_DOT;
  }

  _applyActionDisplacement(direction, distance, duration, progress, dt) {
    if (!direction || direction.lengthSq() <= 0.0001 || duration <= 0) {
      return;
    }

    const localProgress = THREE.MathUtils.clamp(progress, 0, 1);
    const speedScale = Math.sin(localProgress * Math.PI) * (Math.PI / 2);
    this.root.position.addScaledVector(direction, (distance / duration) * speedScale * dt);
  }

  _applyForwardJumpDisplacement(direction, distance, progress) {
    if (!direction || direction.lengthSq() <= 0.0001 || distance <= 0) {
      return;
    }

    const localProgress = THREE.MathUtils.clamp(progress, 0, 1);
    const travelProgress = getForwardJumpTravelProgress(localProgress);
    if (travelProgress < this._forwardJumpTravelProgress) {
      this._forwardJumpTravelProgress = 0;
    }

    const deltaProgress = Math.max(0, travelProgress - this._forwardJumpTravelProgress);
    if (deltaProgress > 0) {
      this.root.position.addScaledVector(direction, distance * deltaProgress);
    }
    this._forwardJumpTravelProgress = travelProgress;
  }

  faceTarget(targetPosition) {
    worldForward.copy(targetPosition).sub(this.root.position);
    worldForward.y = 0;

    if (worldForward.lengthSq() > 0.0001) {
      worldForward.normalize();
      this.faceDirection(worldForward);
    }
  }

  getAttackOrigin() {
    const hand = this.humanoid.getAttachmentPoint('rightHand');
    const origin = new THREE.Vector3();

    if (hand) {
      hand.getWorldPosition(origin);
      origin.y = Math.max(origin.y, 1);
      return origin;
    }

    return this.root.position.clone().add(new THREE.Vector3(0, 1.2, 0));
  }

  getProjectileOrigin() {
    if (this.getActiveArmWeapon?.()?.type === 'drillArm') {
      const drillTipPosition = this.externalRig?.getDrillTipWorldPosition?.(new THREE.Vector3());

      if (drillTipPosition) {
        drillTipPosition.y = Math.max(drillTipPosition.y, 0.9);
        return drillTipPosition;
      }
    }

    const muzzlePosition = this.externalRig?.getBusterMuzzleWorldPosition(new THREE.Vector3());

    if (muzzlePosition) {
      muzzlePosition.y = Math.max(muzzlePosition.y, 1);
      return muzzlePosition;
    }

    return this.getAttackOrigin();
  }

  getWeaponKind() {
    return this.getActiveArmWeapon?.()?.weaponKind ?? this.equipment.get('weapon')?.weaponKind ?? 'projectile';
  }

  isUsingProjectileWeapon() {
    const activeType = this.getActiveArmWeapon?.()?.type;

    if (activeType === 'swordArm') {
      return true;
    }

    if (activeType === 'liftArm' || activeType === 'drillArm') {
      return false;
    }

    return this.getWeaponKind() === 'projectile';
  }

  getActiveWeaponElement() {
    const weaponStats = this.getActiveArmWeapon?.()?.getStatTotals?.() ?? {};

    if ((weaponStats.fireDamage ?? 0) > 0) return 'fire';
    if ((weaponStats.iceDamage ?? 0) > 0) return 'ice';
    if ((weaponStats.corrosionDamage ?? 0) > 0) return 'corrosion';
    if ((weaponStats.chainLightningChance ?? 0) > 0) return 'shock';

    return null;
  }

  getActiveWeaponGlowColor(fallback = 0x77e8ff) {
    const weapon = this.getActiveArmWeapon?.();

    if (weapon?.type === 'swordArm' && (!weapon.rarity || weapon.rarity === 'scrap' || weapon.rarity === 'standard')) {
      return DEFAULT_BEAM_BLADE_COLOR;
    }

    const element = this.getActiveWeaponElement();

    if (element === 'fire') return 0xff8a42;
    if (element === 'ice') return 0x8bddff;
    if (element === 'corrosion') return 0xa6e86f;
    if (element === 'shock') return 0xa6f7ff;

    return weapon?.glowColor ?? fallback;
  }

  setArmHotbar(items = []) {
    const buster = items.find((item) => isBusterArmItem(item)) ?? this.armHotbar[BUSTER_SLOT_INDEX] ?? null;
    const combatArms = items.filter((item) => isArmWeaponItem(item) && !isBusterArmItem(item) && !isUtilityArmItem(item));
    const utilityArms = items.filter((item) => isUtilityArmItem(item));

    this.armHotbar[BUSTER_SLOT_INDEX] = buster;
    this.armHotbar[1] = combatArms[0] ?? null;
    this.armHotbar[2] = combatArms[1] ?? null;

    if (utilityArms.length > 0 || this.utilityArms.length === 0) {
      this.setUtilityArms(utilityArms, true);
    } else {
      this._syncUtilityArmHotbarSlot();
    }

    if (!this.armHotbar[this.activeArmIndex]) {
      this.activeArmIndex = BUSTER_SLOT_INDEX;
    }

    if (this.armHotbar[this.activeArmIndex]) {
      this.switchArmWeapon(this.activeArmIndex, true);
    }
  }

  assignArmWeaponToSlot(slotIndex, item) {
    if (!isArmWeaponItem(item)) {
      return null;
    }

    const index = THREE.MathUtils.clamp(Math.trunc(slotIndex), 0, this.armHotbar.length - 1);

    if (index === BUSTER_SLOT_INDEX) {
      if (!isBusterArmItem(item)) {
        return item;
      }

      const previous = this.armHotbar[BUSTER_SLOT_INDEX] ?? null;
      this.armHotbar[BUSTER_SLOT_INDEX] = item;
      this.switchArmWeapon(BUSTER_SLOT_INDEX, true);
      return previous === item ? null : previous;
    }

    if (index === UTILITY_ARM_SLOT_INDEX) {
      if (!isUtilityArmItem(item)) {
        return item;
      }

      this.addUtilityArm(item, true);
      return null;
    }

    if (isBusterArmItem(item) || isUtilityArmItem(item)) {
      return item;
    }

    const previous = this.armHotbar[index] ?? null;
    this.armHotbar[index] = item;
    this.switchArmWeapon(index, true);
    return previous === item ? null : previous;
  }

  switchArmWeapon(slotIndex, force = false) {
    const index = THREE.MathUtils.clamp(Math.trunc(slotIndex), 0, this.armHotbar.length - 1);
    let item = this.armHotbar[index];
    let cycledUtility = false;

    if (index === UTILITY_ARM_SLOT_INDEX) {
      if (this.utilityArms.length <= 0) {
        return false;
      }

      if (!force && this.activeArmIndex === UTILITY_ARM_SLOT_INDEX && this.utilityArms.length > 1) {
        this.activeUtilityArmIndex = (this.activeUtilityArmIndex + 1) % this.utilityArms.length;
        cycledUtility = true;
      }

      this._syncUtilityArmHotbarSlot();
      item = this.getActiveUtilityArm();
    }

    if (!item || (!force && index === this.activeArmIndex && !cycledUtility)) {
      return false;
    }

    this.activeArmIndex = index;
    this.equipment.equip(item, 'weapon');
    this._releaseProjectileAim();
    return true;
  }

  getActiveArmWeapon() {
    return this.armHotbar[this.activeArmIndex] ?? this.equipment.get('weapon');
  }

  setUtilityArms(items = [], keepCurrent = false) {
    const existingActive = keepCurrent ? this.getActiveUtilityArm() : null;
    const unique = [];
    const seen = new Set();

    for (const item of items) {
      if (!isUtilityArmItem(item) || seen.has(item.id)) {
        continue;
      }

      seen.add(item.id);
      unique.push(item);
    }

    this.utilityArms = unique;

    const activeIndex = existingActive
      ? this.utilityArms.findIndex((item) => item.id === existingActive.id)
      : -1;
    this.activeUtilityArmIndex = activeIndex >= 0 ? activeIndex : 0;
    this._syncUtilityArmHotbarSlot();

    if (this.activeArmIndex === UTILITY_ARM_SLOT_INDEX) {
      if (this.getActiveUtilityArm()) {
        this.switchArmWeapon(UTILITY_ARM_SLOT_INDEX, true);
      } else {
        this.switchArmWeapon(BUSTER_SLOT_INDEX, true);
      }
    }
  }

  addUtilityArm(item, select = false) {
    if (!isUtilityArmItem(item)) {
      return false;
    }

    const existingIndex = this.utilityArms.findIndex((utility) => utility.id === item.id);
    if (existingIndex >= 0) {
      if (select) {
        this.activeUtilityArmIndex = existingIndex;
        this.switchArmWeapon(UTILITY_ARM_SLOT_INDEX, true);
      }
      return false;
    }

    this.utilityArms.push(item);
    if (select || this.utilityArms.length === 1) {
      this.activeUtilityArmIndex = this.utilityArms.length - 1;
      this.switchArmWeapon(UTILITY_ARM_SLOT_INDEX, true);
    } else {
      this._syncUtilityArmHotbarSlot();
    }

    return true;
  }

  getActiveUtilityArm() {
    return this.utilityArms[this.activeUtilityArmIndex] ?? this.utilityArms[0] ?? null;
  }

  _syncUtilityArmHotbarSlot() {
    this.activeUtilityArmIndex = THREE.MathUtils.clamp(
      Math.trunc(this.activeUtilityArmIndex),
      0,
      Math.max(0, this.utilityArms.length - 1),
    );
    this.armHotbar[UTILITY_ARM_SLOT_INDEX] = this.getActiveUtilityArm();
  }

  assignBusterUpgradeToSlot(slotIndex, item) {
    const index = THREE.MathUtils.clamp(Math.trunc(slotIndex), 0, this.busterUpgradeSlots.length - 1);

    if (item === null) {
      const previous = this.busterUpgradeSlots[index] ?? null;
      this.busterUpgradeSlots[index] = null;
      this.recalculateStats();
      this.updateWeaponVisualState?.();
      return previous;
    }

    if (!isBusterUpgradeItem(item)) {
      return item ?? null;
    }

    const previous = this.busterUpgradeSlots[index] ?? null;
    this.busterUpgradeSlots[index] = item;
    this.recalculateStats();
    this.updateWeaponVisualState?.();
    return previous === item ? null : previous;
  }

  getBusterUpgradeStatBonuses() {
    const bonuses = {};

    for (const item of this.busterUpgradeSlots) {
      if (!item) {
        continue;
      }

      for (const [stat, value] of Object.entries(item.getStatTotals())) {
        bonuses[stat] = (bonuses[stat] ?? 0) + value;
      }
    }

    return bonuses;
  }

  playAttackAnimation(duration, weaponKind = this.getWeaponKind(), targetPosition = null) {
    if (weaponKind !== 'melee') {
      this.playProjectileShotAnimation(duration, targetPosition);
      return;
    }

    this._attackWeaponKind = weaponKind;

    if (targetPosition) {
      this.faceTarget(targetPosition);
    }

    this.animation.playAttack(duration);
  }

  playSwordSlashAnimation(duration) {
    this._attackWeaponKind = 'beamBlade';
    // The beam blade is a committed body-forward swing. Do not turn the whole
    // character toward the cursor when the slash begins.
    this.attackFacingTimer = 0;

    this.animation.playAttack(duration, 'beamBlade');
  }

  lockAttackFacing(targetPosition = null, duration = 0.3) {
    if (targetPosition) {
      worldForward.copy(targetPosition).sub(this.root.position);
      worldForward.y = 0;
    } else {
      worldForward.copy(this.lastMoveDirection);
    }

    if (worldForward.lengthSq() <= 0.0001) {
      worldForward.copy(this.lastMoveDirection);
    }

    if (worldForward.lengthSq() <= 0.0001) {
      return;
    }

    worldForward.normalize();
    this.attackFacingDirection.copy(worldForward);
    this.attackFacingTimer = Math.max(this.attackFacingTimer, duration);
    this.faceDirection(this.attackFacingDirection);
  }

  playProjectileShotAnimation(duration, targetPosition = null, aimLockDuration = MIN_PROJECTILE_AIM_LOCK_TIME, options = {}) {
    const weaponKey = options.weaponKey ?? this._getActiveArmWeaponKey();
    const sameWeapon = this._bracedFireWeaponKey === weaponKey;
    const alreadyLocked = sameWeapon && this.bracedFireTimer > 0;
    const linger = options.continuous ? 0 : PROJECTILE_STANCE_LINGER_TIME;
    const lockDuration = Math.max(duration, aimLockDuration, MIN_PROJECTILE_AIM_LOCK_TIME) + linger;

    this.holdProjectileFiringPose(targetPosition, lockDuration, { weaponKey });

    if (!alreadyLocked) {
      this.animation.playAttack(duration);
    }
  }

  holdProjectileFiringPose(targetPosition = null, duration = MIN_PROJECTILE_AIM_LOCK_TIME, options = {}) {
    const weaponKey = options.weaponKey ?? this._getActiveArmWeaponKey();
    const holdDuration = Math.max(duration, MIN_BRACED_SHOT_TIME);

    this._attackWeaponKind = 'projectile';
    this._bracedFireWeaponKey = weaponKey;

    if (targetPosition) {
      this.beginProjectileAim(targetPosition, holdDuration);
    } else {
      this.bracedFireTimer = Math.max(this.bracedFireTimer, holdDuration);
    }
  }

  _releaseProjectileAim() {
    if (this._attackWeaponKind !== 'projectile') {
      return;
    }

    this._attackWeaponKind = null;
    this._bracedFireWeaponKey = null;
    this.bracedFireTimer = 0;
    this.bracedBackpedalTimer = 0;
  }

  _getActiveArmWeaponKey() {
    const weapon = this.getActiveArmWeapon?.() ?? this.equipment.get('weapon');
    return weapon?.id ?? weapon?.type ?? 'default-buster';
  }

  isProjectileAimHeld(weaponKey = this._getActiveArmWeaponKey()) {
    const activeWeaponKey = weaponKey ?? this._getActiveArmWeaponKey();
    return this._attackWeaponKind === 'projectile'
      && this._bracedFireWeaponKey === activeWeaponKey
      && this.bracedFireTimer > 0;
  }

  isProjectileAimSustained(weaponKey = this._getActiveArmWeaponKey()) {
    return this.isProjectileAimHeld(weaponKey)
      && (this.animation?.attackTimer ?? 0) <= 0;
  }

  setMovementLock(duration = 0.12, multiplier = 0) {
    this.movementLockTimer = Math.max(this.movementLockTimer, duration);
    this.movementLockMultiplier = Math.min(this.movementLockMultiplier, THREE.MathUtils.clamp(multiplier, 0, 1));
  }

  canUseShieldGuard() {
    return this.equipment.get('offhand')?.type === 'shieldArm'
      && this.guardCooldown <= 0
      && !this.dead
      && !this.isDodgeRollInvulnerable();
  }

  startShieldGuard(targetPosition = null) {
    const shield = this.equipment.get('offhand');

    if (shield?.type !== 'shieldArm'
      || this.guardCooldown > 0
      || this.dead
      || this.isDodgeRollInvulnerable()) {
      return false;
    }

    guardSourceDirection.copy(targetPosition ?? this.root.position).sub(this.root.position);
    guardSourceDirection.y = 0;

    if (guardSourceDirection.lengthSq() <= 0.0001) {
      guardSourceDirection.copy(this.lastMoveDirection);
    }

    if (guardSourceDirection.lengthSq() <= 0.0001) {
      guardSourceDirection.set(0, 0, 1);
    }

    guardSourceDirection.normalize();
    this.guardDirection.copy(guardSourceDirection);
    this.bracedFireDirection.copy(guardSourceDirection);
    this.bracedFireTimer = Math.max(this.bracedFireTimer, MIN_BRACED_SHOT_TIME);
    this.guardDuration = SHIELD_GUARD_DURATION;
    this.guardTimer = SHIELD_GUARD_DURATION;
    this.guardParryTimer = SHIELD_PARRY_WINDOW;
    this.guardCooldown = SHIELD_GUARD_COOLDOWN;
    this.lastGuardResult = null;
    this.faceDirection(this.guardDirection);
    return true;
  }

  isShieldGuarding() {
    return this.guardTimer > 0 && this.equipment.get('offhand')?.type === 'shieldArm';
  }

  isShieldParrying() {
    return this.isShieldGuarding() && this.guardParryTimer > 0;
  }

  beginProjectileAim(targetPosition, duration = MIN_BRACED_SHOT_TIME) {
    worldForward.copy(targetPosition).sub(this.root.position);
    worldForward.y = 0;

    if (worldForward.lengthSq() <= 0.0001) {
      worldForward.copy(this.lastMoveDirection);
    }

    if (worldForward.lengthSq() <= 0.0001) {
      return;
    }

    worldForward.normalize();
    this.bracedFireDirection.copy(worldForward);
    this.bracedFireTimer = Math.max(this.bracedFireTimer, duration);

    const targetBehindMovement = this.lastMoveDirection.dot(this.bracedFireDirection) < -0.35;
    this.bracedBackpedalTimer = targetBehindMovement
      ? Math.max(this.bracedBackpedalTimer, Math.min(duration, 0.34))
      : 0;

    this.faceDirection(this.bracedFireDirection);
  }

  recalculateStats() {
    const previousMaxHealth = this.stats.maxHealth;
    const healthPercent = previousMaxHealth > 0 ? this.health / previousMaxHealth : 1;
    const bonuses = this.equipment.getStatBonuses();

    this.stats = { ...this.baseStats };

    for (const [stat, value] of Object.entries(bonuses)) {
      this.stats[stat] = (this.stats[stat] ?? 0) + value;
    }

    if (this.activeArmIndex === BUSTER_SLOT_INDEX) {
      for (const [stat, value] of Object.entries(this.getBusterUpgradeStatBonuses())) {
        this.stats[stat] = (this.stats[stat] ?? 0) + value;
      }
    }

    for (const buff of this.temporaryStatBonuses.values()) {
      for (const [stat, value] of Object.entries(buff.bonuses)) {
        this.stats[stat] = (this.stats[stat] ?? 0) + value;
      }
    }

    this.stats.attackSpeed = Math.max(0.25, this.stats.attackSpeed);
    this.stats.criticalChance = THREE.MathUtils.clamp(this.stats.criticalChance, 0, 0.85);
    this.stats.criticalDamage = Math.max(1, this.stats.criticalDamage);
    this.stats.projectileCount = Math.max(1, Math.round(this.stats.projectileCount));
    this.stats.projectilePierce = Math.max(0, Math.round(this.stats.projectilePierce));
    this.stats.maxHealth = Math.max(1, this.stats.maxHealth);
    this.stats.maxEnergy = Math.max(1, this.stats.maxEnergy);
    this.stats.energyRecharge = Math.max(0, this.stats.energyRecharge);
    this.stats.cooldownReduction = THREE.MathUtils.clamp(this.stats.cooldownReduction ?? 0, 0, 0.75);
    this.stats.armorBreakChance = THREE.MathUtils.clamp(this.stats.armorBreakChance ?? 0, 0, 0.85);
    this.stats.staggerResistance = THREE.MathUtils.clamp(this.stats.staggerResistance ?? 0, 0, 0.85);

    this.health = THREE.MathUtils.clamp(this.stats.maxHealth * healthPercent, 1, this.stats.maxHealth);
  }

  tryClaimExternalControl(owner, kind = 'external', options = {}) {
    if (!owner || this.dead || this.externalBallisticMotion || this.isPowerKnockbackActive()) {
      return false;
    }

    if (this.externalControl && this.externalControl.owner !== owner) {
      return false;
    }

    const freeze = options.freeze ?? true;
    const previous = this.externalControl;
    this.externalControl = {
      owner,
      kind,
      freeze,
      ignoreGroundConstraint: options.ignoreGroundConstraint ?? freeze,
      releasePosition: options.releasePosition?.clone?.()
        ?? previous?.releasePosition
        ?? this.root.position.clone(),
      onRelease: options.onRelease ?? previous?.onRelease ?? null,
    };

    if (freeze && !previous?.freeze) {
      this._prepareForExternalControl();
    }
    return true;
  }

  hasExternalControl(owner = null) {
    if (!this.externalControl) {
      return false;
    }
    return owner ? this.externalControl.owner === owner : true;
  }

  releaseExternalControl(owner, reason = 'released', options = {}) {
    const control = this.externalControl;
    if (!control || control.owner !== owner) {
      return false;
    }

    this.externalControl = null;
    if (options.snapToReleasePosition && control.releasePosition) {
      this.root.position.copy(control.releasePosition);
    }
    if (control.freeze) {
      this._restoreAfterExternalMotion({
        grounded: Boolean(options.snapToReleasePosition),
        groundY: control.releasePosition?.y,
      });
    }
    control.onRelease?.(this, owner, reason);
    return true;
  }

  startExternalBallisticMotion(owner, {
    targetPosition,
    duration = 0.9,
    arcHeight = 1.6,
    spinRate = 8,
    onLand = null,
  } = {}) {
    const control = this.externalControl;
    if (!control || control.owner !== owner || this.dead || this.externalBallisticMotion) {
      return false;
    }
    if (!targetPosition?.isVector3 && !(
      Number.isFinite(targetPosition?.x)
      && Number.isFinite(targetPosition?.y)
      && Number.isFinite(targetPosition?.z)
    )) {
      return false;
    }

    const resolvedDuration = Number.isFinite(duration) ? Math.max(0.05, duration) : 0.9;
    const resolvedArcHeight = Number.isFinite(arcHeight) ? Math.max(0, arcHeight) : 1.6;
    const spin = new THREE.Vector3();
    if (Number.isFinite(spinRate)) {
      spin.set(0, spinRate, 0);
    } else {
      spin.set(
        Number.isFinite(spinRate?.x) ? spinRate.x : 0,
        Number.isFinite(spinRate?.y) ? spinRate.y : 8,
        Number.isFinite(spinRate?.z) ? spinRate.z : 0,
      );
    }

    this.externalControl = null;
    control.onRelease?.(this, owner, 'thrown');
    this._prepareForExternalControl();
    this.externalBallisticMotion = {
      owner,
      startPosition: this.root.position.clone(),
      targetPosition: new THREE.Vector3(targetPosition.x, targetPosition.y, targetPosition.z),
      startRotation: this.root.rotation.clone(),
      duration: resolvedDuration,
      elapsed: 0,
      arcHeight: resolvedArcHeight,
      spinRate: spin,
      onLand: typeof onLand === 'function' ? onLand : null,
      releaseGroundY: control.releasePosition?.y,
    };
    return true;
  }

  cancelExternalBallisticMotion(reason = 'cancelled', game = null, options = {}) {
    const motion = this.externalBallisticMotion;
    if (!motion) {
      return false;
    }

    this.externalBallisticMotion = null;
    if (options.snapToTarget) {
      this.root.position.copy(motion.targetPosition);
      this.root.rotation.x = 0;
      this.root.rotation.z = 0;
    }
    this._restoreAfterExternalMotion({
      grounded: Boolean(options.snapToTarget),
      groundY: options.snapToTarget ? motion.targetPosition.y : motion.releaseGroundY,
    });
    motion.onLand?.(this, game, reason);
    return true;
  }

  clearExternalMotion(reason = 'cleared', game = null) {
    let cleared = false;
    if (this.externalBallisticMotion) {
      cleared = this.cancelExternalBallisticMotion(reason, game, {
        snapToTarget: reason === 'dispose' || reason === 'reset',
      }) || cleared;
    }
    if (this.externalControl) {
      const { owner } = this.externalControl;
      cleared = this.releaseExternalControl(owner, reason, {
        snapToReleasePosition: reason === 'dispose' || reason === 'reset',
      }) || cleared;
    }
    return cleared;
  }

  isExternalMotionActive() {
    return Boolean(this.externalBallisticMotion || this.externalControl?.freeze);
  }

  shouldIgnoreGroundConstraint() {
    return Boolean(this.externalBallisticMotion || this.externalControl?.ignoreGroundConstraint);
  }

  _prepareForExternalControl() {
    this.velocity.set(0, 0, 0);
    this.takeoffHorizontalVelocity.set(0, 0, 0);
    this.jumpState = MML_JUMP_STATES.Grounded;
    this._jumpBufferTimer = 0;
    this._coyoteTimer = 0;
    this._landingRecoveryTimer = 0;
    this._jumpAirTimer = 0;
    this._jumpFallTransitionActive = false;
    this._jumpLandingVisualTimer = 0;
    this._jumpLandingVisualState = null;
    this._jumpLandingVisualClipKey = null;
    this.ledgeCling = null;
    this.powerKnockbackState = null;
    this.powerKnockbackTimer = 0;
    this.powerKnockbackDuration = 0;
    this.powerKnockbackLandingCommitted = false;
    this.powerKnockbackVelocity.set(0, 0, 0);
    this._releaseProjectileAim();
    this.bracedFireTimer = 0;
    this.bracedBackpedalTimer = 0;
    this.attackFacingTimer = 0;
    this.guardTimer = 0;
    this.guardParryTimer = 0;
    this.lastGuardResult = null;
    this.movementLockTimer = 0;
    this.movementLockMultiplier = 1;
    this.animation.actionState = null;
    this.animation.actionTimer = 0;
    this.animation.actionDuration = 0;
    this.animation.hurtTimer = 0;
    this.animation.cancelAttack?.();
    this.animation.externalControlLocked = true;
    this._attackWeaponKind = null;
    this.isRunning = false;
    this.tankTurnActive = false;
    this.tankTurnAmount = 0;
    this.tankTurnTranslating = false;
  }

  _restoreAfterExternalMotion({ grounded = false, groundY = null } = {}) {
    this.velocity.set(0, 0, 0);
    this.takeoffHorizontalVelocity.set(0, 0, 0);
    this.animation.externalControlLocked = false;
    this.root.rotation.x = 0;
    this.root.rotation.z = 0;

    if (grounded) {
      this.jumpState = MML_JUMP_STATES.Grounded;
      this._jumpGroundY = Number.isFinite(groundY) ? groundY : this.root.position.y;
      this.root.position.y = this._jumpGroundY;
    } else {
      this.jumpState = MML_JUMP_STATES.Falling;
      this._jumpGroundY = Number.isFinite(groundY) ? groundY : this.root.position.y;
      this._jumpAirTimer = 0;
      this.jumpStartY = this.root.position.y;
    }

    if (!this.dead) {
      this.animation.setState(grounded ? 'idle' : 'fall');
    }
  }

  _updateExternalMotion(dt, game = null) {
    const motion = this.externalBallisticMotion;
    if (motion) {
      const previousPosition = this.root.position.clone();
      motion.elapsed = Math.min(motion.duration, motion.elapsed + Math.max(0, dt));
      const progress = THREE.MathUtils.clamp(motion.elapsed / motion.duration, 0, 1);
      this.root.position.lerpVectors(motion.startPosition, motion.targetPosition, progress);
      this.root.position.y += Math.sin(progress * Math.PI) * motion.arcHeight;
      this.root.rotation.set(
        motion.startRotation.x + motion.spinRate.x * motion.elapsed,
        motion.startRotation.y + motion.spinRate.y * motion.elapsed,
        motion.startRotation.z + motion.spinRate.z * motion.elapsed,
      );

      const pathDirection = motion.targetPosition.clone().sub(motion.startPosition).setY(0);
      const pathResolution = this.powerKnockbackTravelResolver?.({
        player: this,
        fromPosition: previousPosition,
        position: this.root.position,
        originPosition: motion.startPosition,
        direction: pathDirection,
      });
      if (pathResolution?.blocked && pathResolution.position) {
        this.root.position.copy(pathResolution.position);
        const landing = this.powerKnockbackLandingResolver?.({
          player: this,
          position: this.root.position,
          originPosition: motion.startPosition,
          direction: pathDirection,
          velocity: pathDirection,
        });
        if (landing?.position) {
          this.root.position.copy(landing.position);
        }
        this.externalBallisticMotion = null;
        this._restoreAfterExternalMotion({
          grounded: Boolean(landing?.position),
          groundY: landing?.position?.y ?? motion.releaseGroundY,
        });
        motion.onLand?.(this, game, 'blocked');
        return true;
      }

      if (progress >= 1) {
        this.externalBallisticMotion = null;
        this.root.position.copy(motion.targetPosition);
        this._restoreAfterExternalMotion({ grounded: true, groundY: motion.targetPosition.y });
        motion.onLand?.(this, game, 'landed');
        return true;
      }

      this._updateExternalMotionPose(dt, progress);
      return true;
    }

    if (this.externalControl?.freeze) {
      this.velocity.set(0, 0, 0);
      this.powerKnockbackVelocity.set(0, 0, 0);
      this._updateExternalMotionPose(dt, 0.5);
      return true;
    }
    return false;
  }

  _updateExternalMotionPose(dt, progress = 0.5) {
    const poseProgress = THREE.MathUtils.clamp(progress, 0, 1);
    this.animation.update(dt, {
      moving: false,
      running: false,
      moveAmount: 0,
      forcedState: 'fall',
      actionProgress: poseProgress,
    });
    this.updateWeaponVisualState();
    this._updateExternalModelMotion(dt, false, 0, false, false, {
      animationState: 'fall',
      actionProgress: poseProgress,
      physicalJump: true,
      projectileAiming: false,
      lockOnActive: false,
      strafeAmount: 0,
      skipAttackKindReset: true,
    });
    this.isRunning = false;
    this.tankTurnActive = false;
    this.tankTurnAmount = 0;
    this.tankTurnTranslating = false;
  }

  takeDamage(amount, source = null, damageContext = {}) {
    if (this.dead) {
      return 0;
    }

    // A power hit owns the complete reaction through the final get-up frame.
    // Ignoring damage here prevents follow-up attacks, hazards, and other
    // powerful hits from draining health or relaunching an airborne player.
    if (this.isPowerKnockbackActive()) {
      return 0;
    }

    // Resolve dodge immunity before shield/parry, armor, statuses, hurt poses,
    // or knockback. Callers can rely on zero meaning the attack had no gameplay
    // effect during the roll.
    if (this.isDodgeRollInvulnerable()) {
      return 0;
    }

    const damageOrigin = damageContext.impactPosition
      ? { position: damageContext.impactPosition }
      : source;
    const guardResult = damageContext.unblockable
      ? { blocked: false, parried: false, reduction: 0 }
      : this._getShieldGuardResult(source, damageOrigin);
    const guardedAmount = amount * (1 - guardResult.reduction);
    const mitigated = guardedAmount * (100 / (100 + this.stats.armor));

    if (guardResult.blocked) {
      this.lastGuardResult = guardResult;
    }

    this.health = Math.max(0, this.health - mitigated);

    if (!guardResult.parried && mitigated > amount * 0.18) {
      const heavyHitThreshold = Math.max(HEAVY_HIT_MIN_DAMAGE, this.stats.maxHealth * HEAVY_HIT_HEALTH_FRACTION);

      this._captureDamageHitDirection(damageOrigin);

      const powerfulAttack = damageContext.powerfulKnockback === true
        || POWERFUL_KNOCKBACK_ATTACKS.has(damageContext.attackKind);
      if (!this.isExternalMotionActive()
        && !guardResult.blocked
        && (powerfulAttack || mitigated >= heavyHitThreshold)) {
        this._playKnockbackFall(damageOrigin, damageContext);
      } else if (!this.isExternalMotionActive()) {
        this.animation.playHurt();
      }
    }

    if (source?.affix?.id === 'frostCore' && mitigated > 0.5) {
      this.applySlow(0.55, 1.5);
    }

    if (this.health <= 0) {
      this.dead = true;
      this.clearExternalMotion('death');
      this.animation.playDead();
    }

    return mitigated;
  }

  isPowerKnockbackActive() {
    return this.powerKnockbackState !== null;
  }

  isPowerKnockbackAirborne() {
    return this.powerKnockbackState === POWER_KNOCKBACK_STATES.Rising
      || this.powerKnockbackState === POWER_KNOCKBACK_STATES.Falling;
  }

  _playKnockbackFall(source = null, damageContext = {}) {
    // Keep the power-knockback entry point safe even if a future attack calls it
    // directly instead of routing through takeDamage().
    if (this.isDodgeRollInvulnerable() || this.isPowerKnockbackActive()) {
      return false;
    }

    if (damageContext.knockbackDirection?.lengthSq?.() > 0.0001) {
      this.knockbackFallDirection.copy(damageContext.knockbackDirection).setY(0);
    } else if (source?.root?.position || source?.position) {
      this.knockbackFallDirection.copy(this.root.position).sub(source.root?.position ?? source.position);
      this.knockbackFallDirection.y = 0;
    } else {
      this.knockbackFallDirection.copy(this.lastMoveDirection).multiplyScalar(-1);
    }

    if (this.knockbackFallDirection.lengthSq() <= 0.0001) {
      this.knockbackFallDirection.set(0, 0, -1);
    } else {
      this.knockbackFallDirection.normalize();
    }

    const strength = THREE.MathUtils.clamp(damageContext.knockbackStrength ?? 1, 0.7, 1.5);
    this.powerKnockbackState = POWER_KNOCKBACK_STATES.Rising;
    this.powerKnockbackTimer = 0;
    this.powerKnockbackDuration = POWER_KNOCKBACK_UPWARD_SPEED / Math.abs(POWER_KNOCKBACK_GRAVITY);
    this.powerKnockbackStartY = this.root.position.y;
    this.powerKnockbackApexY = this.root.position.y;
    this.powerKnockbackOriginPosition.copy(this.root.position);
    this.powerKnockbackPreviousPosition.copy(this.root.position);
    this.powerKnockbackLandingPosition.copy(this.root.position);
    this.powerKnockbackLandingMode = null;
    this.powerKnockbackLandingCommitted = false;
    this.powerKnockbackImpactRootY = this.root.position.y;
    this.powerKnockbackCameraAnchorY = this.root.position.y;
    this._lastPowerKnockbackBackContact = null;
    this.powerKnockbackVelocity.copy(this.knockbackFallDirection)
      .multiplyScalar(POWER_KNOCKBACK_HORIZONTAL_SPEED * strength);
    this.powerKnockbackVelocity.y = POWER_KNOCKBACK_UPWARD_SPEED * Math.sqrt(strength);
    this.velocity.set(0, 0, 0);
    this.jumpState = MML_JUMP_STATES.Grounded;
    this._jumpFallTransitionActive = false;
    this.ledgeCling = null;
    this._releaseProjectileAim();
    this.attackFacingTimer = 0;
    this.movementLockTimer = 0;
    this.movementLockMultiplier = 0;
    this.animation.actionState = null;
    this.animation.actionTimer = 0;
    this.animation.actionDuration = 0;
    this.animation.cancelAttack?.();
    this.animation.hurtTimer = 0;
    this.animation.externalControlLocked = true;
    this.lastMoveDirection.copy(this.knockbackFallDirection).multiplyScalar(-1);
    this.faceDirection(this.lastMoveDirection);
    return true;
  }

  _updatePowerKnockback(dt, arenaRadius, movementOptions = {}) {
    const state = this.powerKnockbackState;
    this.powerKnockbackTimer += dt;

    if (this.isPowerKnockbackAirborne()) {
      const gravityMultiplier = state === POWER_KNOCKBACK_STATES.Falling
        ? POWER_KNOCKBACK_FALL_GRAVITY_MULTIPLIER
        : 1;
      const gravity = POWER_KNOCKBACK_GRAVITY * gravityMultiplier;
      this.powerKnockbackPreviousPosition.copy(this.root.position);
      this.root.position.addScaledVector(this.powerKnockbackVelocity, dt);
      this.root.position.y += 0.5 * gravity * dt * dt;
      this.powerKnockbackVelocity.y += gravity * dt;

      const travelResolution = this.powerKnockbackTravelResolver?.({
        player: this,
        fromPosition: this.powerKnockbackPreviousPosition,
        position: this.root.position,
        originPosition: this.powerKnockbackOriginPosition,
        direction: this.knockbackFallDirection,
        velocity: this.powerKnockbackVelocity,
      });
      if (travelResolution?.blocked && travelResolution.position) {
        this.root.position.x = travelResolution.position.x;
        this.root.position.z = travelResolution.position.z;
        this.powerKnockbackVelocity.x = 0;
        this.powerKnockbackVelocity.z = 0;
      }

      this.root.position.x = THREE.MathUtils.clamp(this.root.position.x, -arenaRadius, arenaRadius);
      this.root.position.z = THREE.MathUtils.clamp(this.root.position.z, -arenaRadius, arenaRadius);
      this.powerKnockbackApexY = Math.max(this.powerKnockbackApexY, this.root.position.y);

      if (state === POWER_KNOCKBACK_STATES.Rising && this.powerKnockbackVelocity.y <= 0) {
        this.powerKnockbackState = POWER_KNOCKBACK_STATES.Falling;
        this.powerKnockbackTimer = 0;
        this.powerKnockbackDuration = 1;
      }

      if (this.powerKnockbackState === POWER_KNOCKBACK_STATES.Falling) {
        const resolvedLanding = this.powerKnockbackLandingCommitted
          ? {
            position: this.powerKnockbackLandingPosition,
            mode: this.powerKnockbackLandingMode,
          }
          : this._resolvePowerKnockbackLanding(movementOptions);

        if (!this.powerKnockbackLandingCommitted
          && resolvedLanding
          && this.root.position.y <= resolvedLanding.position.y + POWER_KNOCKBACK_LANDING_COMMIT_MARGIN) {
          this.root.position.x = resolvedLanding.position.x;
          this.root.position.z = resolvedLanding.position.z;
          this.powerKnockbackLandingMode = resolvedLanding.mode ?? 'current';
          this.powerKnockbackLandingCommitted = true;
          this.powerKnockbackVelocity.x = 0;
          this.powerKnockbackVelocity.z = 0;
        }

        if (this.powerKnockbackLandingCommitted) {
          this.root.position.x = this.powerKnockbackLandingPosition.x;
          this.root.position.z = this.powerKnockbackLandingPosition.z;
        }
      }
    } else if (state === POWER_KNOCKBACK_STATES.Landing
      && this.powerKnockbackTimer >= this.powerKnockbackDuration) {
      this._setPowerKnockbackState(
        POWER_KNOCKBACK_STATES.LyingFlat,
        POWER_KNOCKBACK_LYING_FLAT_TIME,
      );
    } else if (state === POWER_KNOCKBACK_STATES.LyingFlat
      && this.powerKnockbackTimer >= this.powerKnockbackDuration) {
      this._setPowerKnockbackState(POWER_KNOCKBACK_STATES.GetUp, POWER_KNOCKBACK_GET_UP_TIME);
    } else if (state === POWER_KNOCKBACK_STATES.GetUp) {
      const getUpProgress = THREE.MathUtils.clamp(
        this.powerKnockbackTimer / this.powerKnockbackDuration,
        0,
        1,
      );
      const rootRecovery = THREE.MathUtils.smoothstep(getUpProgress, 0.08, 0.95);
      this.root.position.x = this.powerKnockbackLandingPosition.x;
      this.root.position.y = THREE.MathUtils.lerp(
        this.powerKnockbackImpactRootY,
        this.powerKnockbackLandingPosition.y,
        rootRecovery,
      );
      this.root.position.z = this.powerKnockbackLandingPosition.z;

      if (this.powerKnockbackTimer >= this.powerKnockbackDuration) {
        this.root.position.copy(this.powerKnockbackLandingPosition);
        this.powerKnockbackState = null;
        this.powerKnockbackTimer = 0;
        this.powerKnockbackDuration = 0;
        this.powerKnockbackLandingCommitted = false;
        this.movementLockMultiplier = 1;
        this.animation.externalControlLocked = false;
        this.animation.setState('idle');
        this.modelRoot.position.y = 0;
        this.modelRoot.rotation.set(0, 0, 0);
        return;
      }
    }

    const animationState = this._getPowerKnockbackAnimationState();
    const progress = this.powerKnockbackDuration > 0
      ? THREE.MathUtils.clamp(this.powerKnockbackTimer / this.powerKnockbackDuration, 0, 1)
      : 0;
    this.animation.update(dt, {
      moving: false,
      forcedState: animationState,
      actionProgress: progress,
    });
    this.updateWeaponVisualState();
    this._updateExternalModelMotion(dt, false, 0, false, false, {
      animationState,
      actionProgress: progress,
      physicalPowerKnockback: true,
      skipAttackKindReset: true,
    });

    if (this.powerKnockbackState === POWER_KNOCKBACK_STATES.Falling
      && this.powerKnockbackLandingCommitted) {
      const contact = this._measurePowerKnockbackBackGroundClearance(
        this.powerKnockbackLandingPosition.y,
      );
      if (Number.isFinite(contact?.clearance) && contact.clearance <= 0) {
        // Integrate through the abstract feet/root plane, then remove only the
        // final frame's penetration. Recovery cannot begin before the animated
        // torso has physically reached the selected walkable surface.
        this.root.position.y -= contact.clearance;
        this.root.updateMatrixWorld(true);
        this.powerKnockbackImpactRootY = this.root.position.y;
        this._lastPowerKnockbackBackContact = this._measurePowerKnockbackBackGroundClearance(
          this.powerKnockbackLandingPosition.y,
        ) ?? contact;
        this.powerKnockbackVelocity.set(0, 0, 0);
        this._setPowerKnockbackState(
          POWER_KNOCKBACK_STATES.Landing,
          POWER_KNOCKBACK_BACK_LANDING_TIME,
        );
      }
    } else if (this.powerKnockbackState === POWER_KNOCKBACK_STATES.Landing
      || this.powerKnockbackState === POWER_KNOCKBACK_STATES.LyingFlat) {
      const contact = this._measurePowerKnockbackBackGroundClearance(
        this.powerKnockbackLandingPosition.y,
      );
      if (Number.isFinite(contact?.clearance)) {
        // The settle animation changes the limb silhouette after impact. Keep
        // the sampled torso planted while that pose blends into lying flat.
        this.root.position.y -= contact.clearance;
        this.root.updateMatrixWorld(true);
        this.powerKnockbackImpactRootY = this.root.position.y;
        this._lastPowerKnockbackBackContact = this._measurePowerKnockbackBackGroundClearance(
          this.powerKnockbackLandingPosition.y,
        ) ?? contact;
      }
    }

    this.faceDirection(this.lastMoveDirection);
    this.isRunning = false;
    this.tankTurnActive = false;
    this.tankTurnAmount = 0;
    this.tankTurnTranslating = false;
  }

  _setPowerKnockbackState(state, duration) {
    this.powerKnockbackState = state;
    this.powerKnockbackTimer = 0;
    this.powerKnockbackDuration = Math.max(0.001, duration);
  }

  _getPowerKnockbackAnimationState() {
    return {
      [POWER_KNOCKBACK_STATES.Rising]: 'knockbackLaunch',
      [POWER_KNOCKBACK_STATES.Falling]: 'aerialKnockbackFall',
      [POWER_KNOCKBACK_STATES.Landing]: 'backLanding',
      [POWER_KNOCKBACK_STATES.LyingFlat]: 'lyingFlat',
      [POWER_KNOCKBACK_STATES.GetUp]: 'getUp',
    }[this.powerKnockbackState] ?? 'idle';
  }

  _resolvePowerKnockbackLanding(movementOptions = {}) {
    const resolved = this.powerKnockbackLandingResolver?.({
      player: this,
      position: this.root.position,
      originPosition: this.powerKnockbackOriginPosition,
      direction: this.knockbackFallDirection,
      velocity: this.powerKnockbackVelocity,
    });
    const position = resolved?.position ?? (resolved?.isVector3 ? resolved : null);
    if (position) {
      this.powerKnockbackLandingPosition.copy(position);
      return {
        position: this.powerKnockbackLandingPosition,
        mode: resolved.mode ?? 'current',
      };
    }

    const groundY = Number.isFinite(movementOptions.groundY)
      ? movementOptions.groundY
      : this.powerKnockbackStartY;
    this.powerKnockbackLandingPosition.copy(this.root.position).setY(groundY);
    return { position: this.powerKnockbackLandingPosition, mode: 'fallback' };
  }

  _measurePowerKnockbackBackGroundClearance(groundY) {
    this.root.updateMatrixWorld(true);
    this.modelRoot.updateMatrixWorld(true);

    const rigContact = this.externalRig?.measureBackGroundClearance?.(groundY) ?? null;
    if (Number.isFinite(rigContact?.clearance)) {
      this._lastPowerKnockbackBackContact = rigContact;
      return rigContact;
    }

    const joints = this.externalRig?.joints ?? this.humanoid?.joints;
    let minY = Infinity;
    for (const jointName of ['hips', 'spine']) {
      const joint = joints?.get?.(jointName);
      if (joint) {
        minY = Math.min(minY, joint.getWorldPosition(modelGroundPosition).y);
      }
    }

    if (!Number.isFinite(minY)) {
      modelGroundBounds.setFromObject(this.root);
      minY = modelGroundBounds.min.y;
    } else {
      minY -= POWER_KNOCKBACK_FALLBACK_BACK_RADIUS;
    }

    if (!Number.isFinite(minY)) {
      return null;
    }

    const result = {
      source: 'fallbackBackContact',
      groundY,
      minY,
      clearance: minY - groundY,
      sampleCount: 0,
    };
    this._lastPowerKnockbackBackContact = result;
    return result;
  }

  getPowerKnockbackLandingDiagnostics() {
    return {
      state: this.powerKnockbackState,
      committed: this.powerKnockbackLandingCommitted,
      landingY: this.powerKnockbackLandingPosition.y,
      landingMode: this.powerKnockbackLandingMode,
      impactRootY: this.powerKnockbackImpactRootY,
      cameraAnchorY: this.powerKnockbackCameraAnchorY,
      backClearance: this._lastPowerKnockbackBackContact?.clearance ?? null,
      backContactSource: this._lastPowerKnockbackBackContact?.source ?? null,
      backContactSampleCount: this._lastPowerKnockbackBackContact?.sampleCount ?? 0,
    };
  }

  _captureDamageHitDirection(source = null) {
    if (source?.root?.position || source?.position) {
      damageSourceDirection.copy(source.root?.position ?? source.position).sub(this.root.position);
      damageSourceDirection.y = 0;
    } else {
      damageSourceDirection.copy(this.lastMoveDirection);
    }

    if (damageSourceDirection.lengthSq() <= 0.0001) {
      damageSourceDirection.copy(this.lastMoveDirection);
    }

    if (damageSourceDirection.lengthSq() <= 0.0001) {
      damageSourceDirection.set(0, 0, 1);
    } else {
      damageSourceDirection.normalize();
    }

    worldForward.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
    if (worldForward.lengthSq() <= 0.0001) {
      worldForward.set(0, 0, 1);
    } else {
      worldForward.normalize();
    }

    damageFacingRight.set(worldForward.z, 0, -worldForward.x);
    this.damageHitLocalDirection.set(
      THREE.MathUtils.clamp(damageSourceDirection.dot(damageFacingRight), -1, 1),
      0,
      THREE.MathUtils.clamp(damageSourceDirection.dot(worldForward), -1, 1),
    );
  }

  heal(amount) {
    if (this.dead) {
      return;
    }

    this.health = Math.min(this.stats.maxHealth, this.health + amount);
  }

  addTemporaryStatBonus(id, label, bonuses, duration, color = '#77e8ff') {
    if (!id || !bonuses || duration <= 0) {
      return null;
    }

    const buff = {
      id,
      label,
      bonuses: { ...bonuses },
      duration,
      remaining: duration,
      color,
    };

    this.temporaryStatBonuses.set(id, buff);
    this.recalculateStats();
    return buff;
  }

  getTemporaryBuffs() {
    return [...this.temporaryStatBonuses.values()].map((buff) => ({ ...buff }));
  }

  applySlow(multiplier, duration) {
    this.slowMultiplier = Math.min(this.slowMultiplier, multiplier);
    this.slowTimer = Math.max(this.slowTimer, duration);
  }

  addExperience(amount) {
    this.experience += amount;

    while (this.experience >= this.experienceToNext) {
      this.experience -= this.experienceToNext;
      this.level += 1;
      this.experienceToNext = Math.round(this.experienceToNext * 1.35 + 15);
      this.baseStats.maxHealth += 10;
      this.baseStats.attackDamage += 1.5;
      this.baseStats.pickupRadius += 0.04;
      this.recalculateStats();
      this.health = this.stats.maxHealth;
    }
  }

  setSkinColor(color) {
    this.humanoid.setSkinColor(color);
  }

  setHairColor(color) {
    this.humanoid.setHairColor(color);
  }

  setArmorColor(color) {
    this.humanoid.setArmorColor(color);
  }

  setWeaponColor(color) {
    this.weaponColor.set(color);
    const weaponVisuals = this.equipment.visuals.get('weapon') ?? [];

    for (const visual of weaponVisuals) {
      visual.traverse((object) => {
        if (object.material?.color) {
          object.material.color.copy(this.weaponColor);
        }
      });
    }
  }

  setClothingColor(color) {
    this.humanoid.setClothColor(color);
  }

  usesExternalCharacterModel() {
    return Boolean(this._loadedModel && this.modelRoot.visible);
  }

  updateWeaponVisualState() {
    const activeArm = this.getActiveArmWeapon?.();
    const beamBladeActive = activeArm?.type === 'swordArm';
    const drillActive = activeArm?.type === 'drillArm';

    this.externalRig?.setDrillArmActive?.(drillActive, this.getActiveWeaponGlowColor(0xffd36f));
    this.externalRig?.setBusterArmActive(!drillActive && this.isUsingProjectileWeapon());
    this.externalRig?.setBeamBladeActive?.(beamBladeActive, this.getActiveWeaponGlowColor(this.weaponColor.getHex()));
  }

  _updateStatusEffects(dt) {
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;

      if (this.slowTimer <= 0) {
        this.slowMultiplier = 1;
      }
    }
  }

  _updateTemporaryStatBonuses(dt) {
    let expired = false;

    for (const [id, buff] of this.temporaryStatBonuses.entries()) {
      buff.remaining -= dt;

      if (buff.remaining <= 0) {
        this.temporaryStatBonuses.delete(id);
        expired = true;
      }
    }

    if (expired) {
      this.recalculateStats();
    }
  }

  _updateBracedFireState(dt) {
    this.bracedFireTimer = Math.max(0, this.bracedFireTimer - dt);
    this.bracedBackpedalTimer = Math.max(0, this.bracedBackpedalTimer - dt);
  }

  _updateShieldGuardState(dt) {
    this.guardTimer = Math.max(0, this.guardTimer - dt);
    this.guardParryTimer = Math.min(this.guardTimer, Math.max(0, this.guardParryTimer - dt));
    this.guardCooldown = Math.max(0, this.guardCooldown - dt);
  }

  _updateMovementLockState(dt) {
    if (this.movementLockTimer <= 0) {
      this.movementLockMultiplier = 1;
      return;
    }

    this.movementLockTimer = Math.max(0, this.movementLockTimer - dt);
    if (this.movementLockTimer <= 0) {
      this.movementLockMultiplier = 1;
    }
  }

  _updateAttackFacingState(dt) {
    this.attackFacingTimer = Math.max(0, this.attackFacingTimer - dt);
  }

  _getShieldGuardResult(source, damageOrigin = source) {
    if (!this.isShieldGuarding() || !this._isGuardFacingSource(damageOrigin)) {
      return { blocked: false, parried: false, reduction: 0 };
    }

    const shieldStats = this.equipment.get('offhand')?.getStatTotals?.() ?? {};
    const shieldArmor = shieldStats.armor ?? 0;
    const guardBonus = THREE.MathUtils.clamp(shieldArmor * 0.012, 0, 0.18);
    const parryBonus = THREE.MathUtils.clamp(this.stats.staggerResistance * 0.18, 0, 0.1);
    const parried = this.isShieldParrying() && Boolean(source?.root);
    const reduction = parried
      ? THREE.MathUtils.clamp(0.86 + guardBonus + parryBonus, 0.86, 0.96)
      : THREE.MathUtils.clamp(0.56 + guardBonus, 0.56, 0.78);

    if (parried) {
      this._parrySource(source);
      this.guardParryTimer = 0;
      this.guardTimer = Math.min(this.guardTimer, 0.24);
    }

    return { blocked: true, parried, reduction };
  }

  _isGuardFacingSource(source) {
    if (!source?.root?.position && !source?.position) {
      return true;
    }

    guardSourceDirection.copy(source.root?.position ?? source.position).sub(this.root.position);
    guardSourceDirection.y = 0;

    if (guardSourceDirection.lengthSq() <= 0.0001) {
      return true;
    }

    guardSourceDirection.normalize();
    return this.guardDirection.dot(guardSourceDirection) > 0.05;
  }

  _parrySource(source) {
    source.applyStatus?.('stagger', { duration: source.isElite ? 0.34 : 0.58 });

    if (source.knockback?.addScaledVector && source.root?.position) {
      guardSourceDirection.copy(source.root.position).sub(this.root.position);
      guardSourceDirection.y = 0;

      if (guardSourceDirection.lengthSq() > 0.0001) {
        source.knockback.addScaledVector(guardSourceDirection.normalize(), source.isElite ? 3.2 : 5.2);
      }
    }
  }

  _loadCharacterModel() {
    const fbxLoader = new FBXLoader();
    fbxLoader.setPath(PLAYER_MODEL_PATH);
    fbxLoader.setResourcePath(PLAYER_MODEL_PATH);

    fbxLoader.load(
      PLAYER_MODEL_FBX,
      (model) => this._useExternalCharacterModel(model, { source: 'fbx' }),
      undefined,
      (error) => {
        console.warn('Could not load rigged FBX player model. Falling back to OBJ model.', error);
        this._loadLegacyObjCharacterModel();
      },
    );
  }

  _loadLegacyObjCharacterModel() {
    const materialLoader = new MTLLoader();
    materialLoader.setPath(PLAYER_MODEL_PATH);
    materialLoader.setResourcePath(PLAYER_MODEL_PATH);

    materialLoader.load(
      PLAYER_MODEL_MTL,
      (materials) => {
        materials.preload();

        const objectLoader = new OBJLoader();
        objectLoader.setPath(PLAYER_MODEL_PATH);
        objectLoader.setMaterials(materials);
        objectLoader.load(
          PLAYER_MODEL_OBJ,
          (model) => this._useExternalCharacterModel(model),
          undefined,
          (error) => this._handleModelLoadError(error),
        );
      },
      undefined,
      (error) => this._handleModelLoadError(error),
    );
  }

  _loadFbxAnimationLibrary(targetRig = this.externalRig) {
    if (!targetRig?.setAnimationClips || this._fbxAnimationLibraryLoading) {
      return;
    }

    this._fbxAnimationLibraryLoading = true;
    this._fbxAnimationLibraryLoaded = false;

    const loader = new FBXLoader();
    loader.setPath(PLAYER_ANIMATION_PATH);
    loader.setResourcePath(PLAYER_MODEL_PATH);

    const loadClip = (definition) => new Promise((resolve) => {
      loader.load(
        definition.file,
        (animationModel) => {
          const clip = animationModel.animations?.[0] ?? null;

          if (!clip) {
            console.warn(`FBX animation file did not include an animation clip: ${definition.file}`);
            resolve(null);
            return;
          }

          let preparedClip = clip;
          const subclip = definition.subclip;
          if (subclip
            && Number.isFinite(subclip.startFrame)
            && Number.isFinite(subclip.endFrame)) {
            preparedClip = THREE.AnimationUtils.subclip(
              clip,
              definition.key,
              subclip.startFrame,
              subclip.endFrame,
              subclip.fps ?? 30,
            );
          } else {
            preparedClip = clip.clone?.() ?? clip;
            preparedClip.name = definition.key;
          }

          preparedClip.name = definition.key;
          resolve([definition.key, { ...definition, clip: preparedClip }]);
        },
        undefined,
        (error) => {
          console.warn(`Could not load FBX animation clip: ${definition.file}`, error);
          resolve(null);
        },
      );
    });

    Promise.all(PLAYER_FBX_ANIMATION_DEFINITIONS.map(loadClip))
      .then((loadedEntries) => {
        if (this.externalRig !== targetRig) {
          return;
        }

        const clips = new Map();
        for (const entry of loadedEntries) {
          if (entry) {
            clips.set(entry[0], entry[1]);
          }
        }

        const loadedCount = targetRig.setAnimationClips(clips);
        targetRig.root.userData.fbxAnimationLoadState = {
          loaded: loadedCount,
          expected: PLAYER_FBX_ANIMATION_DEFINITIONS.length,
          clips: [...clips.keys()],
        };
        this._fbxAnimationLibraryLoaded = loadedCount > 0;
      })
      .finally(() => {
        this._fbxAnimationLibraryLoading = false;
      });
  }

  _useExternalCharacterModel(model, { source = 'obj' } = {}) {
    model.name = 'playerMegaManVolnuttModel';
    const isSkinnedModel = source === 'fbx' || this._modelHasSkinnedMesh(model);

    if (isSkinnedModel) {
      this._applyVolnuttTextureToSkinnedModel(model);
    }

    model.traverse((object) => {
      if (!object.isMesh) {
        return;
      }

      object.name ||= 'playerModelMesh';
      object.castShadow = true;
      object.receiveShadow = true;

      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) {
          continue;
        }

        material.side = THREE.FrontSide;
        material.needsUpdate = true;
      }
    });

    this._fitModelToPlayer(model);

    let visibleModel = model;
    this.externalRig = null;
    this._loadedModelUsesFbxClips = false;

    try {
      const rig = isSkinnedModel
        ? new SkeletalModelRig(model)
        : new ExternalModelRig(model);

      if (rig.meshCount > 0) {
        visibleModel = rig.root;
        this.externalRig = rig;
        this._loadedModelUsesFbxClips = Boolean(rig.usesFbxAnimationClips);
        this.animation.setPoseOutputEnabled?.(!this._loadedModelUsesFbxClips);
        this._loadBusterArmModel();

        if (this._loadedModelUsesFbxClips) {
          this._loadFbxAnimationLibrary(rig);
        }
      }
    } catch (error) {
      console.warn('Could not create animated player rig. Using the static model instead.', error);
    }

    if (!this._loadedModelUsesFbxClips) {
      this.animation.setPoseOutputEnabled?.(true);
    }

    this.modelRoot.clear();
    this.modelRoot.add(visibleModel);
    this.modelRoot.visible = true;
    this._loadedModel = visibleModel;
    this._hideProceduralBodyMeshes();
    this._setEquipmentVisualsVisible(false);
    this.updateWeaponVisualState();
  }

  _modelHasSkinnedMesh(model) {
    let hasSkinnedMesh = false;

    model.traverse((object) => {
      if (object.isSkinnedMesh) {
        hasSkinnedMesh = true;
      }
    });

    return hasSkinnedMesh;
  }

  _applyVolnuttTextureToSkinnedModel(model) {
    const texture = new THREE.TextureLoader().load(`${PLAYER_MODEL_PATH}${PLAYER_MODEL_TEXTURE}`);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = true;
    texture.name = 'texture_MegaManVolnutt_FBXDiffuse';

    model.traverse((object) => {
      if (!object.isMesh) {
        return;
      }

      const material = new THREE.MeshStandardMaterial({
        name: 'material_MegaManVolnutt_FBXTextured',
        map: texture,
        color: 0xffffff,
        roughness: 0.42,
        metalness: 0.08,
      });
      material.side = THREE.FrontSide;
      object.material = material;
    });
  }

  _fitModelToPlayer(model) {
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const scale = size.y > 0 ? TARGET_MODEL_HEIGHT / size.y : 1;

    this._characterModelScale = scale;
    model.scale.setScalar(scale);
    model.updateMatrixWorld(true);

    const scaledBounds = new THREE.Box3().setFromObject(model);
    const center = scaledBounds.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -scaledBounds.min.y, -center.z);
  }

  _hideProceduralBodyMeshes() {
    const hiddenMaterials = new Set([
      this.humanoid.materials.skin,
      this.humanoid.materials.hair,
      this.humanoid.materials.eyes,
      this.humanoid.materials.cloth,
    ]);

    this.humanoid.root.traverse((object) => {
      if (!object.isMesh) {
        return;
      }

      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some((material) => hiddenMaterials.has(material))) {
        object.visible = false;
      }
    });
  }

  _handleModelLoadError(error) {
    console.warn('Could not load player character model. Falling back to procedural humanoid.', error);
    this.modelRoot.visible = false;
    this.externalRig = null;
    this._setEquipmentVisualsVisible(true);
  }

  _loadBusterArmModel() {
    if (!this.externalRig || this._busterArmLoading || this._busterArmLoaded) {
      return;
    }

    this._busterArmLoading = true;
    const materialLoader = new MTLLoader();
    materialLoader.setPath(PLAYER_MODEL_PATH);
    materialLoader.setResourcePath(PLAYER_MODEL_PATH);

    materialLoader.load(
      BUSTER_MODEL_MTL,
      (materials) => {
        materials.preload();

        const objectLoader = new OBJLoader();
        objectLoader.setPath(PLAYER_MODEL_PATH);
        objectLoader.setMaterials(materials);
        objectLoader.load(
          BUSTER_MODEL_OBJ,
          (model) => {
            this._busterArmLoading = false;
            this._busterArmLoaded = true;
            this._prepareBusterArmModel(model);
            this.externalRig?.setBusterArm(model);
            this.updateWeaponVisualState();
          },
          undefined,
          (error) => this._handleBusterLoadError(error),
        );
      },
      undefined,
      (error) => this._handleBusterLoadError(error),
    );
  }

  _prepareBusterArmModel(model) {
    model.name = 'playerMegaBusterArm';
    model.scale.setScalar(this._characterModelScale);

    model.traverse((object) => {
      if (!object.isMesh) {
        return;
      }

      object.name ||= 'playerBusterMesh';
      object.castShadow = true;
      object.receiveShadow = true;

      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) {
          continue;
        }

        material.side = THREE.FrontSide;
        material.needsUpdate = true;
      }
    });

    model.updateMatrixWorld(true);
  }

  _handleBusterLoadError(error) {
    this._busterArmLoading = false;
    console.warn('Could not load player buster arm model.', error);
  }

  _updateExternalModelMotion(dt, moving, moveAmount = 0, backpedaling = false, running = false, motionOptions = {}) {
    if (!this._loadedModel) {
      return;
    }

    const walkDirection = backpedaling ? -0.86 : 1;
    const walkSpeed = 8.6 * Math.max(0.55, moveAmount || 0);
    if (moving) {
      this._modelWalkTime += dt * walkSpeed * walkDirection;
    }

    const clipDrivenRig = Boolean(this.externalRig?.usesFbxAnimationClips);
    const actionProgress = Number.isFinite(motionOptions.actionProgress)
      ? THREE.MathUtils.clamp(motionOptions.actionProgress, 0, 1)
      : this.animation.getActionProgress?.() ?? 0;
    const motionState = motionOptions.animationState ?? this.animation.state;
    const animationState = this._resolveExternalAnimationState(motionState, actionProgress);

    if (clipDrivenRig) {
      let targetY = motionState === 'dodgeRoll' ? getDodgeRollVisualLift(actionProgress) : 0;
      let targetPitch = 0;
      let landingSnap = false;
      const physicalJump = motionOptions.physicalJump === true;

      if (motionState === 'neutralJump' || motionState === 'forwardJump') {
        const forwardJump = motionState === 'forwardJump';
        if (!physicalJump) {
          const jumpLift = getJumpVisualLift(actionProgress, forwardJump);
          const landingCompression = getJumpLandingCompression(actionProgress, forwardJump);
          targetY = Math.max(targetY, jumpLift - landingCompression);
        }
        targetPitch = forwardJump ? -Math.sin(actionProgress * Math.PI) * 0.08 : 0;
        landingSnap = actionProgress >= 0.985;

        if (landingSnap) {
          targetY = 0;
        }
      } else if (motionState === 'knockbackLaunch') {
        targetY = 0.08;
        targetPitch = 0;
      } else if (motionState === 'aerialKnockbackFall') {
        targetY = 0.1;
        targetPitch = 0;
      } else if (motionState === 'backLanding') {
        targetY = 0.1;
        targetPitch = 0;
      } else if (motionState === 'lyingFlat' || motionState === 'downed') {
        targetY = 0.1;
        targetPitch = 0;
      } else if (motionState === 'getUp') {
        targetY = THREE.MathUtils.lerp(0.1, 0, actionProgress);
        targetPitch = 0;
      }

      const alpha = (landingSnap || motionState === 'forwardJump')
        ? 1
        : Math.min(1, dt * (motionState === 'dodgeRoll' ? 20 : 14));
      this.modelRoot.position.y = THREE.MathUtils.lerp(this.modelRoot.position.y, targetY, alpha);
      this.modelRoot.rotation.x = THREE.MathUtils.lerp(this.modelRoot.rotation.x, targetPitch, alpha);
      this.modelRoot.rotation.z = THREE.MathUtils.lerp(this.modelRoot.rotation.z, 0, alpha);
    } else {
      const stepLift = Math.abs(Math.sin(this._modelWalkTime));
      let targetY = moving ? stepLift * 0.062 : 0;
      let targetRoll = moving ? Math.sin(this._modelWalkTime) * 0.032 : 0;
      let targetPitch = 0;
      let landingSnap = false;
      const physicalJump = motionOptions.physicalJump === true;

      if (motionState === 'neutralJump' || motionState === 'forwardJump') {
        const forwardJump = motionState === 'forwardJump';
        if (!physicalJump) {
          const jumpLift = getJumpVisualLift(actionProgress, forwardJump);
          const landingCompression = getJumpLandingCompression(actionProgress, forwardJump);
          targetY = Math.max(targetY, jumpLift) - landingCompression;
        }
        targetPitch = forwardJump ? -Math.sin(actionProgress * Math.PI) * 0.08 : 0;
        landingSnap = actionProgress >= 0.985;

        if (landingSnap) {
          targetY = 0;
        }
      } else if (motionState === 'dodgeRoll') {
        targetY = Math.max(getDodgeRollVisualLift(actionProgress), targetY * 0.45);
        targetPitch = Math.sin(actionProgress * Math.PI) * 0.18;
        targetRoll += Math.sin(actionProgress * Math.PI * 2) * 0.08;
      } else if (motionState === 'knockbackFall' || motionState === 'knockbackLaunch') {
        targetY = 0.08;
        targetPitch = 0;
      } else if (motionState === 'aerialKnockbackFall') {
        targetY = 0.1;
        targetPitch = 0;
      } else if (motionState === 'backLanding') {
        targetY = 0.1;
        targetPitch = 0;
      } else if (motionState === 'lyingFlat' || motionState === 'downed') {
        targetY = 0.1;
        targetPitch = 0;
      } else if (motionState === 'getUp') {
        targetY = THREE.MathUtils.lerp(0.1, 0, actionProgress);
        targetPitch = 0;
      }

      const alpha = (landingSnap || motionState === 'forwardJump') ? 1 : Math.min(1, dt * 12);
      this.modelRoot.position.y = THREE.MathUtils.lerp(this.modelRoot.position.y, targetY, alpha);
      this.modelRoot.rotation.x = THREE.MathUtils.lerp(this.modelRoot.rotation.x, targetPitch, alpha);
      this.modelRoot.rotation.z = THREE.MathUtils.lerp(this.modelRoot.rotation.z, targetRoll, alpha);
    }

    const rawAttackProgress = Number.isFinite(motionOptions.attackProgress)
      ? THREE.MathUtils.clamp(motionOptions.attackProgress, 0, 1)
      : this.animation.attackDuration > 0
      ? 1 - THREE.MathUtils.clamp(this.animation.attackTimer / this.animation.attackDuration, 0, 1)
      : 0;
    const attackKind = motionOptions.attackKind ?? this._attackWeaponKind;
    const projectileAimLocked = motionOptions.projectileAiming ?? (attackKind === 'projectile' && this.bracedFireTimer > 0);
    const projectileAiming = motionOptions.projectileAiming ?? (projectileAimLocked || (attackKind === 'projectile' && this.animation.attackTimer > 0));
    const sustainedProjectileAim = projectileAiming && this.animation.attackTimer <= 0;
    const attackProgress = sustainedProjectileAim ? 1 : rawAttackProgress;
    const hurtProgress = this.animation.hurtTimer > 0
      ? 1 - THREE.MathUtils.clamp(this.animation.hurtTimer / 0.18, 0, 1)
      : 0;
    const fallAnimationClipProgress = animationState === 'land'
      ? actionProgress
      : null;
    const airborneJumpAnimation = animationState === 'neutralJump'
      || animationState === 'forwardJump'
      || animationState === 'forwardJumpFall'
      || animationState === 'fall';

    this.externalRig?.update(dt, {
      moving,
      moveAmount,
      state: projectileAiming && !airborneJumpAnimation ? 'attacking' : animationState,
      attackProgress,
      actionProgress,
      actionDuration: this.animation.actionDuration ?? 0,
      fallAnimationClipProgress,
      hurtProgress,
      damageHitLocal: this.damageHitLocalDirection,
      projectileAiming,
      backpedaling,
      running,
      attackKind,
      lockOnActive: Boolean(motionOptions.lockOnActive),
      strafeAmount: motionOptions.strafeAmount ?? 0,
      turnAmount: motionOptions.turnAmount ?? 0,
      clipKey: motionOptions.clipKey ?? null,
    });

    if (animationState === 'land') {
      // Let the launch/fall action cross-fade into its authored landing pose.
      // Forcing the feet to ground here translates the whole model by the
      // airborne tuck clearance and creates a visible one-frame downward snap.
      this._lastExternalModelGrounding = this._measureExternalModelGrounding();
    } else if (!motionOptions.physicalJump && this._shouldClampNeutralJumpWindup(motionState, actionProgress)) {
      this._clampExternalModelFeetToGround({ reason: 'jumpWindup' });
    } else if (this._shouldClampStationaryGroundedPose(animationState, moving)) {
      this._clampExternalModelFeetToGround({ allowRaise: true, reason: 'groundedIdle' });
    } else {
      this._lastExternalModelGrounding = this._measureExternalModelGrounding();
    }

    if (!motionOptions.skipAttackKindReset && this.animation.attackTimer <= 0 && !projectileAimLocked) {
      this._attackWeaponKind = null;
    }
  }

  _resolveExternalAnimationState(animationState, actionProgress = 0) {
    if (animationState === 'land') {
      return 'land';
    }

    if (animationState !== 'neutralJump' && animationState !== 'forwardJump') {
      return animationState;
    }

    const fallStart = getJumpFallAnimationStartProgress(animationState);
    if (!Number.isFinite(actionProgress) || actionProgress < fallStart) {
      return animationState;
    }

    return animationState === 'forwardJump' ? 'forwardJumpFall' : 'fall';
  }

  _getJumpLandingVisualProgress() {
    if (this._jumpLandingVisualTimer <= 0) {
      return 1;
    }

    return THREE.MathUtils.clamp(
      1 - (this._jumpLandingVisualTimer / JUMP_LANDING_VISUAL_HOLD_DURATION),
      0,
      1,
    );
  }

  _cancelJumpLandingVisual({ restoreMovement = false } = {}) {
    this._jumpLandingVisualTimer = 0;
    this._jumpLandingVisualState = null;
    this._jumpLandingVisualClipKey = null;

    if (restoreMovement) {
      this.movementLockTimer = 0;
      this.movementLockMultiplier = 1;
    }
  }

  _shouldClampNeutralJumpWindup(animationState, actionProgress = 0) {
    return animationState === 'neutralJump'
      && Number.isFinite(actionProgress)
      && actionProgress < NEUTRAL_JUMP_LAUNCH_PROGRESS;
  }

  _shouldClampStationaryGroundedPose(animationState, moving = false) {
    return !moving && animationState === 'idle';
  }

  getExternalModelGroundingDiagnostics() {
    return this._lastExternalModelGrounding ?? this._measureExternalModelGrounding();
  }

  _measureExternalModelGrounding() {
    if (!this.modelRoot?.visible || !this._loadedModel) {
      return null;
    }

    this.root.getWorldPosition(modelGroundPosition);
    this.modelRoot.updateMatrixWorld(true);

    const footGrounding = this.externalRig?.measureFootGroundClearance?.(modelGroundPosition.y) ?? null;
    modelGroundBounds.setFromObject(this.modelRoot);
    const boundsClearance = Number.isFinite(modelGroundBounds.min.y)
      ? modelGroundBounds.min.y - modelGroundPosition.y
      : null;

    const result = {
      source: footGrounding?.source ?? 'modelBounds',
      groundY: modelGroundPosition.y,
      footClearance: Number.isFinite(footGrounding?.clearance) ? footGrounding.clearance : null,
      leftFootClearance: Number.isFinite(footGrounding?.leftClearance) ? footGrounding.leftClearance : null,
      rightFootClearance: Number.isFinite(footGrounding?.rightClearance) ? footGrounding.rightClearance : null,
      footMinY: Number.isFinite(footGrounding?.minY) ? footGrounding.minY : null,
      leftFootY: Number.isFinite(footGrounding?.leftY) ? footGrounding.leftY : null,
      rightFootY: Number.isFinite(footGrounding?.rightY) ? footGrounding.rightY : null,
      footSampleCount: Number.isFinite(footGrounding?.sampleCount) ? footGrounding.sampleCount : 0,
      boundsClearance,
      boundsMinY: Number.isFinite(modelGroundBounds.min.y) ? modelGroundBounds.min.y : null,
      correction: 0,
      corrected: false,
      reason: null,
    };

    this._lastExternalModelGrounding = result;
    return result;
  }

  _clampExternalModelFeetToGround({ allowRaise = false, reason = 'grounded' } = {}) {
    if (!this.modelRoot?.visible || !this._loadedModel) {
      return;
    }

    const before = this._measureExternalModelGrounding();
    if (!before) {
      return;
    }

    const clearance = Number.isFinite(before.footClearance)
      ? before.footClearance
      : before.boundsClearance;
    const shouldLowerToGround = Number.isFinite(clearance) && clearance > 0.003;
    const shouldRaiseToGround = allowRaise && Number.isFinite(clearance) && clearance < -0.003;

    if (shouldLowerToGround || shouldRaiseToGround) {
      this.modelRoot.position.y -= clearance;
      this.modelRoot.updateMatrixWorld(true);
      const after = this._measureExternalModelGrounding();
      if (after) {
        after.correction = -clearance;
        after.corrected = true;
        after.reason = reason;
        after.beforeFootClearance = before.footClearance;
        after.beforeBoundsClearance = before.boundsClearance;
        this._lastExternalModelGrounding = after;
      }
      return;
    }

    before.reason = reason;
    this._lastExternalModelGrounding = before;
  }

  _setEquipmentVisualsVisible(visible) {
    for (const visuals of this.equipment.visuals.values()) {
      for (const visual of visuals) {
        visual.visible = visible;
      }
    }
  }
}
