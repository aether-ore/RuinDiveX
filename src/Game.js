import * as THREE from 'three';
import { CombatSystem } from './CombatSystem.js';
import { CameraController } from './CameraController.js';
import { DungeonController } from './DungeonController.js';
import { DungeonConnectorLiftRuntime } from './DungeonConnectorLiftRuntime.js';
import { DungeonConnectorTrapRuntime } from './DungeonConnectorTrapRuntime.js';
import { DungeonConnectorTrapVisualFactory } from './DungeonConnectorTrapVisualFactory.js';
import { DungeonGenerator } from './DungeonGenerator.js';
import {
  INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID,
  INDUSTRIAL_SUPPLEMENT_PREVIEW_V2_PROFILE_ID,
} from './dungeon-augmentation/IndustrialExtensionHost.js';
import {
  INDUSTRIAL_DUNGEON_FAMILY_ID,
  resolveDungeonFamilyId,
} from './DungeonFamilies.js';
import { EnemySpawner } from './EnemySpawner.js';
import {
  createEnemyIdAllocator,
  setActiveEnemyIdAllocator,
} from './Enemy.js';
import { Inventory } from './Inventory.js';
import { LootSystem } from './LootSystem.js';
import { MapEventSystem } from './MapEventSystem.js';
import { Player } from './Player.js';
import { ProjectileSystem } from './ProjectileSystem.js';
import { RefractorPickupSystem } from './RefractorPickupSystem.js';
import { RollSalvageStorage } from './RollSalvageStorage.js';
import { UIManager } from './UIManager.js';
import {
  BOSS_HUNT_REPEAT_REWARD_CHANCE,
  BusterLabStorage,
  getBossHuntRewardRoll,
} from './buster/BusterLabStorage.js';
import { BUSTER_RECIPE_LIST, getRecipeDiscoveryState } from './buster/BusterRecipeCatalog.js';
import { BusterRuntime } from './buster/BusterRuntime.js';
import { createMegaCalibrationShadow } from './buster/MegaCalibrationShadow.js';
import {
  createBusterExecutionStaggerLedger,
  resolveBusterStaggerDuration,
} from './buster/BusterStagger.js';
import {
  CUSTOM_BUSTER_RULESET,
  MEGA_BUSTER_BASE_PROFILE,
  MEGA_BUSTER_CALIBRATION_CATALOG,
  getBusterModuleDefinition,
} from './buster/catalog.js';
import {
  getClusterDirections,
  getSpreadDirections,
  sampleBallisticPoint,
} from './buster/BusterTrajectory.js';
import { sphereIntersectsTargetCapsule } from './buster/BusterProjectileKernel.js';
import {
  BUSTER_BENCHMARK_FIXTURE,
  createBusterBenchmarkScenario,
  simulateBusterEncounter,
} from './buster/BusterBalanceSimulator.js';
import {
  compileBusterBuild,
  compileMegaBusterPlan,
  deepFreezeBusterValue,
  serializeBusterBuild,
  validateBusterBuild,
  validateBusterProgram,
} from './buster/index.js';
import { PLAYER_TRAVERSAL_CAPABILITIES } from './TraversalCapabilities.js';
import {
  createDefaultArmsGearState,
  createFixedArmDescriptor,
  getEquipmentRecipeDefinition,
  getEquipmentRecipesForPart,
} from './equipment/index.js';
import {
  getCombatTargetWorldPosition,
  getEnemyCombatTargets,
} from './reaverbots/CombatTarget.js';
import {
  REAVERBOT_SALVAGE_MATERIALS,
  rollReaverbotSalvageDrops,
} from './reaverbots/ReaverbotSalvageCatalog.js';
import {
  BOSS_EXPEDITION_SCHEMA_VERSION,
  DEFAULT_BOSS_PROFILE_ID,
  REAVERBOT_BOSS_PROFILES,
  createBossExpeditionSpec,
  getReaverbotBossFeaturedMaterial,
  getReaverbotBossProfile,
  getReaverbotBossRewardMaterial,
  normalizeBossProfileId,
} from './reaverbots/ReaverbotBossCatalog.js';
import { ASCENSION_ENGINE_PROFILE_ID } from './reaverbots/bosses/AscensionEngineContract.js';
import { hashSeed, SeededRandom } from './reaverbots/SeededRandom.js';
import {
  OverworldController,
  assertLoadedWorldBundle,
  assembleOverworld,
  createAuthoredOverworldPlan,
  createLoadedWorldBundle,
  createWorldLifecycleState,
  disposeOverworldFacade,
  validateMountedRuntimeStateHost,
} from './overworld/index.js';

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
const MAX_FLAMETHROWER_PARTICLES_PER_ENEMY = 48;
const FLAMETHROWER_EFFECT_STALE_SECONDS = 0.12;
const MAX_POOLED_HIT_EFFECTS = 48;
const MAX_POOLED_DAMAGE_NUMBERS = 72;
const MAX_SYNCHRONOUS_EXPLOSIONS = 8;
const DUNGEON_RENDER_CULL_UPDATE_INTERVAL = 0.2;
const DUNGEON_RENDER_CULL_HIDE_DISTANCE = 68;
const DUNGEON_RENDER_CULL_SHOW_DISTANCE = 54;
// The overworld fog is fully opaque at 115m. Never remove a streamed chunk
// while it can still be seen through clear air; the show distance retains
// hysteresis so walking along a chunk boundary cannot flicker geometry. Keep
// these separate from the legacy values so streamed-world support cannot
// silently change Dungeon Generation V1's render behavior.
const OVERWORLD_RENDER_CULL_HIDE_DISTANCE = 116;
const OVERWORLD_RENDER_CULL_SHOW_DISTANCE = 104;
const CAMERA_OCCLUSION_BIN_SIZE = 11.2;
// Camera visibility is a world-wide playability rule. Authored content should
// set cameraOcclusionSurface explicitly, but procedural and legacy architecture
// still needs a safe semantic fallback so a missed room-specific flag cannot
// leave the camera staring into a wall. Keep this focused on static surfaces;
// actors, pickups, and effects are intentionally not inferred here.
const CAMERA_OCCLUSION_ARCHITECTURE_NAME_PATTERN = /(?:wall|backdrop|retaining|partition|bulkhead|barrier|cavern|infill|floor|ceiling|deck|ramp|catwalk|platform|bridge|stair|previewcap)/i;
const CAMERA_OCCLUSION_ARCHITECTURE_ROLE_PATTERN = /(?:wall|backdrop|retaining|partition|bulkhead|barrier|cavern|floor|ceiling|deck|ramp|catwalk|platform|bridge|stair|architectural)/i;
const CAMERA_OCCLUSION_WALL_NAME_PATTERN = /(?:wall|backdrop|retaining|partition|bulkhead|barrier)/i;
const CAMERA_OCCLUSION_WALL_ROLE_PATTERN = /(?:wall|backdrop|retaining|partition|bulkhead|barrier)/i;
// A single hidden 2.8m wall bay is not a sufficient cutout when the camera is
// embedded in, or immediately behind, a continuous wall run. Clear the struck
// bay plus its immediate neighbours while keeping the cutout spatially bounded.
const CAMERA_WALL_OCCLUSION_PROXIMITY = 3.4;
// Ray-hit cutouts must cover more than a named wall bay. A camera outside the
// enclosure can see the vertical sides of ceilings, ramps, and floor masses as
// one continuous wall, so clear a two-bay radius around any architectural hit.
const CAMERA_ARCHITECTURE_HIT_CUTOUT_RADIUS = 5.6;
const CAMERA_OCCLUSION_FORWARD_MAX_DISTANCE = 24;
const CAMERA_OCCLUSION_PLAYER_CLEARANCE = 0.4;
// A supported floor can have a walkable horizontal top and still present a
// several-metre vertical face to a lower camera. Treat that mass as an
// occluder only while its height actually crosses the camera-to-player view
// band. This preserves lower floors that are visible beneath the player.
const CAMERA_OCCLUSION_SIGHTLINE_HEIGHT_CLEARANCE = 0.18;
// Floors, ramps, and other architectural masses only participate in the
// near-camera pass when the camera is actually contained by, or grazing, them.
// This catches thick rock slabs that present as walls without hiding the floor
// normally supporting the player.
const CAMERA_ARCHITECTURE_CONTAINMENT_PROXIMITY = 0.24;
const CAMERA_OCCLUSION_TARGET_PROBES = Object.freeze([
  Object.freeze({ lateral: 0, height: 1.25 }),
  Object.freeze({ lateral: -0.8, height: 1.25 }),
  Object.freeze({ lateral: 0.8, height: 1.25 }),
  Object.freeze({ lateral: 0, height: 2.15 }),
]);
const CAMERA_OCCLUSION_FALLBACK_MATERIAL = new THREE.MeshBasicMaterial({
  name: 'cameraOcclusionFallbackMaterial',
  visible: false,
  side: THREE.DoubleSide,
});
const STREAMED_DUNGEON_DOOR_HEIGHT = 15.6;
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
const DEBUG_NO_CLIP_SPEED = 14;
const DEBUG_NO_CLIP_BOOST_SPEED = 34;

const CUSTOM_BUSTER_ATTACK_META = Object.freeze({
  attackDomain: 'customBuster',
  suppressGenericOffense: true,
});

function getCameraOcclusionSemanticRole(object) {
  return [
    object.userData?.architectureRole,
    object.userData?.obstacleKind,
    object.userData?.collisionRole,
    object.userData?.surfaceRole,
  ].filter(Boolean).join(' ');
}

function getCameraOcclusionSurfaceClass(object, wallSurface = false) {
  if (wallSurface) return 'wall';
  const semantic = `${object?.name ?? ''} ${getCameraOcclusionSemanticRole(object)}`;
  if (/(?:ceiling|roof|overhead)/i.test(semantic)) return 'ceiling';
  if (/(?:floor|deck|platform|bridge|catwalk|ramp|stair|walkable)/i.test(semantic)) {
    return 'walkable';
  }
  return 'architecture';
}

function isCameraOcclusionWallSurface(object) {
  if (!object?.isMesh && !object?.isInstancedMesh) return false;
  const semanticRole = getCameraOcclusionSemanticRole(object);
  return object.userData?.cameraOcclusionWall === true
    || CAMERA_OCCLUSION_WALL_NAME_PATTERN.test(object.name ?? '')
    || CAMERA_OCCLUSION_WALL_ROLE_PATTERN.test(semanticRole);
}

function isCameraOcclusionArchitectureSurface(object) {
  if (!object?.isMesh && !object?.isInstancedMesh) return false;
  // A wall is never allowed to opt out. Legacy false/excluded flags remain
  // meaningful for non-wall decoration only.
  if (isCameraOcclusionWallSurface(object)) return true;
  if (object.userData?.cameraOcclusionExcluded === true
    || object.userData?.cameraOcclusionSurface === false) {
    return false;
  }
  if (object.userData?.cameraOcclusionSurface === true) return true;
  const semanticRole = getCameraOcclusionSemanticRole(object);
  return CAMERA_OCCLUSION_ARCHITECTURE_NAME_PATTERN.test(object.name ?? '')
    || CAMERA_OCCLUSION_ARCHITECTURE_ROLE_PATTERN.test(semanticRole);
}

// Renderer, camera, input, UI and durable Lab storage are host-owned. Everything
// here is swapped as one disposable gameplay world for the Buster sandbox.
const BUSTER_WORLD_CONTEXT_FIELDS = Object.freeze([
  'scene',
  'dungeon',
  'dungeonController',
  'player',
  'inventory',
  'lootSystem',
  'refractors',
  'projectiles',
  'busterRuntime',
  'combat',
  'spawner',
  'mapEvents',
  'enemies',
  'enemyIdAllocator',
  'enemyAttackDirector',
  'hazards',
  'destructibles',
  'timedEffects',
  'damageNumbers',
  'damageNumberPool',
  'hitEffectPool',
  'activeHitEffects',
  'particlePool',
  'activeParticles',
  'flamethrowerEffects',
  'pendingExplosions',
  'explosionDispatchDepth',
  'elapsedTime',
  'hitStopTimer',
  'hitStopTimeScale',
  'arenaRadius',
  'platformingPlatforms',
  'dynamicPlatformingPlatforms',
  'connectorLiftRuntime',
  'connectorTrackTrapRuntime',
  'bossStageRuntime',
  'platformingLedgeCandidates',
  'debugLedgeTester',
  'debugLedgeCandidates',
  'debugLedgePlatform',
  'debugSpawnedPlatforms',
  'debugSpawnedPlatformGroup',
  'cameraOcclusionEntries',
  'cameraOcclusionBins',
  'cameraOcclusionWallProximityBins',
  'cameraOcclusionProximityRecordByKey',
  'cameraOcclusionWallProximityCandidateKeys',
  'cameraOcclusionExpandedVerticalRecordKeys',
  'cameraOcclusionExpandedSurfaceRecordKeys',
  'cameraOcclusionForwardVerticalHits',
  'cameraOcclusionCandidateSet',
  'cameraOcclusionCandidateObjects',
  'cameraOcclusionHits',
  'cameraOcclusionOwnerByObject',
  'cameraOcclusionHiddenOwners',
  'cameraOcclusionHiddenInstances',
  'cameraOcclusionHiddenInstanceKeys',
  'cameraOcclusionOwnerBaseVisibility',
  'dungeonRenderCullGroups',
  'dungeonRenderCullAccumulator',
  'dungeonRenderCullStats',
  'lastDungeonResourceDisposalStats',
  'ruinFloor',
  'largeRefractorsSecured',
  'ruinCompleted',
  'expeditionAccepted',
  'expeditionActive',
  'isGameOver',
  'combatDepthLevel',
  'busterCombatDepthEncounterId',
  'reaverbotBaseSeed',
  'reaverbotSeedLabel',
  'reaverbotGeneration',
  'reaverbotRunSeed',
  'activeWorldBundle',
  'overworldController',
  'worldKind',
  'transitionState',
  'worldLifecycle',
  'worldGenerationCount',
  'worldDisposalCount',
  'lastWorldDisposalStats',
]);

function readStartupWorldMode(roomPreview = null) {
  try {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    if (roomPreview || params.has('roomPreview') || params.get('startupWorld') === 'dungeon') {
      return 'dungeon';
    }
  } catch {
    // Browser URL state is optional in isolated unit environments.
  }
  return 'overworld';
}

function readDungeonFamilySelection() {
  try {
    const requested = new URLSearchParams(globalThis.location?.search ?? '').get('dungeonFamily');
    return resolveDungeonFamilyId(requested);
  } catch {
    return resolveDungeonFamilyId(null);
  }
}

class OverworldRuntimeController {
  constructor(game, facade) {
    this.game = game;
    this.dungeon = facade;
    this.facade = facade;
    this.core = new OverworldController({ plan: facade.plan, facade });
    this.plan = facade.plan;
    this.safeInteractables = facade.safeInteractables ?? [];
    this.nearestInteractable = null;
    this.lastSafePlayerPosition = new THREE.Vector3().copy(facade.playerStart);
    this.npcAnimationMixers = facade.npcAnimationMixers ?? [];
    this.npcAnimators = facade.npcAnimators ?? [];
    this.keycardCount = 0;
  }

  update() {
    const position = this.game?.player?.root?.position;
    if (!position) return;
    const interaction = this.core.update(position);
    this.nearestInteractable = interaction ? {
      kind: 'safe',
      target: interaction,
      label: interaction.action === 'openBossHuntSelection'
        ? 'Sealed Ruin Door: Choose Boss Hunt'
        : interaction.action === 'roll'
          ? `${interaction.label}: Workshop`
          : interaction.label,
      color: interaction.color,
    } : null;
    this.facade.updateLighting?.(position);
  }

  resolvePlayerMovement(fromPosition) {
    const player = this.game?.player;
    if (!player?.root || !fromPosition) return;
    if (player.shouldIgnoreGroundConstraint?.() || player.isPowerKnockbackActive?.()) return;
    const target = player.root.position.clone();
    const resolved = this.core.resolveMovement(fromPosition, target, {
      maximumStep: this.plan.dimensions.groundedStepAllowance,
    });
    if (resolved.blocked || resolved.slid) {
      player.root.position.x = resolved.position.x;
      player.root.position.z = resolved.position.z;
      if (resolved.blocked) player.cancelJetSkateBoost?.();
    }
    const height = this.core.getHeightAt(player.root.position.x, player.root.position.z);
    if (Number.isFinite(height) && !player.isJumpAirborne?.()) player.root.position.y = height;
    if (!resolved.blocked) this.lastSafePlayerPosition.copy(player.root.position);
  }

  getNearestInteractable() {
    return this.nearestInteractable;
  }

  activateNearest() {
    const interaction = this.nearestInteractable?.target;
    if (!interaction) return false;
    if (interaction.action === 'openBossHuntSelection') {
      this.game.openBossExpeditionPrompt?.();
      return true;
    }
    if (interaction.action === 'roll') {
      interaction.object?.userData?.rollAnimator?.noteInteraction?.();
      this.game.setInventoryOpen?.(true, { mode: 'roll' });
      this.game.ui?.showToast?.(
        this.game.lastExpeditionSummary
          ? `Roll: ${this.game.lastExpeditionSummary}`
          : 'Roll: workshop and Boss Hunt support ready',
        '#6bdcff',
      );
      return true;
    }
    return false;
  }

  getObjectiveText() {
    return 'Choose a Boss Hunt or visit Roll';
  }

  getMinimapSnapshot() {
    return null;
  }

  getKeycardHudLabel() {
    return 'Camp';
  }

  // The authored overworld is a peaceful expedition staging area. Treat the
  // entire bundle as a safe zone so combat cannot leave projectiles, mines, or
  // other host-owned transient effects waiting for the streamed dungeon.
  isPlayerInSafeZone() {
    return true;
  }

  getFloorElevationAt(position) {
    return this.core.getHeightAt(position?.x, position?.z) ?? 0;
  }

  getSurfaceElevationAt(position) {
    return this.getFloorElevationAt(position);
  }

  getRampSurfaceElevationAt() {
    return null;
  }

  getPlayerRailSupportElevation() {
    return null;
  }

  isPositionWalkable(position) {
    return this.core.isPositionWalkable(position);
  }

  resolvePowerKnockbackTravel(fromPosition, position) {
    const result = this.core.resolveMovement(fromPosition, position, { maximumStep: 1.4 });
    return result.blocked ? { blocked: true, position: result.position.clone?.() ?? new THREE.Vector3(
      result.position.x,
      result.position.y,
      result.position.z,
    ) } : null;
  }

  resolvePowerKnockbackLanding(position) {
    const height = this.core.getHeightAt(position.x, position.z);
    return {
      position: Number.isFinite(height) ? position.clone().setY(height) : this.lastSafePlayerPosition.clone(),
      mode: Number.isFinite(height) ? 'overworldTerrain' : 'overworldLastSafe',
    };
  }

  isPlayerAtRollWorkshop() {
    const roll = this.safeInteractables.find(({ action }) => action === 'roll');
    return Boolean(roll && this.game.player.root.position.distanceToSquared(roll.position) <= (roll.interactionRadius ?? 2.4) ** 2);
  }

  getUnspawnedEncounterAt() {
    return null;
  }

  constrainEnemies() {}

  updateNpcVisuals(dt, { allowAmbient = true } = {}) {
    for (const animator of this.npcAnimators) animator?.update?.(dt, { allowAmbient });
    const animated = new Set(this.npcAnimators.map(({ mixer }) => mixer));
    for (const mixer of this.npcAnimationMixers) if (!animated.has(mixer)) mixer?.update?.(dt);
  }

  dispose() {
    this.core.dispose();
    this.nearestInteractable = null;
  }
}

function isBusterLabFeatureEnabled() {
  // The Custom Buster is a canonical arm system. URL parameters now select
  // diagnostics/sandbox behavior only; they no longer gate normal ownership.
  return true;
}

function isBusterLabSandboxEnabled() {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('busterLab') === 'sandbox';
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

function isBossDebugEnabled() {
  try {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    return params.get('bossDebug') === '1' || params.get('busterLabDebug') === '1';
  } catch {
    return false;
  }
}

function readDungeonLayoutSeed() {
  try {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    const authored = params.get('dungeonSeed') ?? params.get('reaverbotSeed');
    if (authored) return `layout:${authored}`;
  } catch {
    // Fall through to a per-run seed outside browser environments.
  }
  return `layout:${Date.now()}:${Math.random()}`;
}

export function resolveDungeonAugmentationProfileId(requested) {
  const normalized = typeof requested === 'string'
    ? requested.trim().toLowerCase()
    : '';
  if (!normalized || ['0', 'off', 'disabled', 'none'].includes(normalized)) return null;
  // Keep only the explicit immutable v1 profile ID on the compatibility
  // profile. Boolean-style opt-ins select the current, visibly expanded
  // preview; committed v1 expeditions reconstruct from their saved profile ID.
  if (normalized === INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID) {
    return INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID;
  }
  if ([
    '1',
    'true',
    'on',
    '2',
    'preview',
    'expanded',
    INDUSTRIAL_SUPPLEMENT_PREVIEW_V2_PROFILE_ID,
  ].includes(normalized)) return INDUSTRIAL_SUPPLEMENT_PREVIEW_V2_PROFILE_ID;
  return null;
}

function readDungeonAugmentationProfileId() {
  try {
    const requested = new URLSearchParams(globalThis.location?.search ?? '')
      .get('dungeonAugmentation');
    return resolveDungeonAugmentationProfileId(requested);
  } catch {
    // The sidecar is optional. Non-browser hosts remain on the legacy path.
  }
  return null;
}

export function createLegacyDungeonBasePlanHash({
  layoutSeed,
  difficulty,
  bossProfileId,
  dungeonFamilyId = INDUSTRIAL_DUNGEON_FAMILY_ID,
} = {}) {
  const legacyHash = `v1:${layoutSeed}:depth:${difficulty}:${bossProfileId ?? 'standard'}`;
  const familyId = typeof dungeonFamilyId === 'string' && dungeonFamilyId.trim()
    ? dungeonFamilyId.trim()
    : INDUSTRIAL_DUNGEON_FAMILY_ID;
  // Industrial V1's established hash is save- and test-facing identity. Keep
  // it byte-for-byte stable while ensuring every future parent family occupies
  // a distinct base-plan namespace.
  return familyId === INDUSTRIAL_DUNGEON_FAMILY_ID
    ? legacyHash
    : `${legacyHash}:family:${familyId}`;
}

export function resolveDungeonAugmentationGenerationRequest(
  committedDungeonAugmentation,
  defaultProfileId = null,
) {
  const isCommittedRun = committedDungeonAugmentation !== undefined;
  return Object.freeze({
    isCommittedRun,
    augmentationProfileId: isCommittedRun
      ? committedDungeonAugmentation?.profileId ?? null
      : defaultProfileId,
    committedAugmentationIdentity: isCommittedRun
      ? committedDungeonAugmentation
      : null,
  });
}

function isInterruptedExpeditionRecord(record) {
  return Boolean(record && ['active', 'victory'].includes(record.status));
}

export function resolveCommittedDungeonGenerationSpec(
  committedExpedition,
  fallback = {},
) {
  if (!isInterruptedExpeditionRecord(committedExpedition)) {
    return Object.freeze({ ...fallback });
  }
  return Object.freeze({
    ...fallback,
    bossProfileId: committedExpedition.bossProfileId ?? fallback.bossProfileId,
    layoutSeed: committedExpedition.dungeonLayoutSeed ?? fallback.layoutSeed,
    difficulty: Math.max(
      1,
      Math.min(10, Math.round(Number(committedExpedition.depth) || Number(fallback.difficulty) || 1)),
    ),
    dungeonFamilyId: committedExpedition.dungeonFamilyId
      ?? fallback.dungeonFamilyId
      ?? INDUSTRIAL_DUNGEON_FAMILY_ID,
    // Explicit null is important: a committed legacy run must remain
    // augmentation-off even when the current URL opts new runs into a profile.
    dungeonAugmentation: committedExpedition.dungeonAugmentation ?? null,
  });
}

function createDungeonRandom(seed) {
  const random = new SeededRandom(hashSeed(String(seed)));
  return () => random.next();
}

function getBusterMagazineRecoveryTime(plan) {
  const stats = plan?.stats ?? {};
  const maxEnergy = Math.max(0, Number(stats.maxEnergy) || 0);
  const energyCost = Math.max(0, Number(stats.energyCost) || 0);
  const shots = Math.max(
    0,
    Math.trunc(Number(stats.shotsPerCharge))
      || (energyCost > 0 ? Math.floor(maxEnergy / energyCost) : 0),
  );
  if (maxEnergy <= 0 || energyCost <= 0 || shots <= 0) return 0;
  const spentEnergy = Math.min(maxEnergy, energyCost * shots);
  return Math.max(
    CUSTOM_BUSTER_RULESET.rechargeDelay,
    Math.max(0, Number(stats.cycleTime) || 0),
  )
    + CUSTOM_BUSTER_RULESET.rechargeDuration * (spentEnergy / maxEnergy);
}

const tempVectorA = new THREE.Vector3();
const tempVectorB = new THREE.Vector3();
const tempVectorC = new THREE.Vector3();
const tempVectorD = new THREE.Vector3();
const tempVectorE = new THREE.Vector3();
const tempVectorF = new THREE.Vector3();
const tempMatrixA = new THREE.Matrix4();
const tempCameraOcclusionViewProjection = new THREE.Matrix4();
const tempCameraOcclusionFrustum = new THREE.Frustum();
const tempColor = new THREE.Color();
const tempFlameTransform = new THREE.Object3D();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function createFlamethrowerConeGeometry(halfAngle = 0.8, segments = 18, startRatio = 0.025) {
  const positions = [];
  const safeSegments = Math.max(3, Math.trunc(segments));
  const safeStartRatio = THREE.MathUtils.clamp(startRatio, 0, 0.95);
  for (let i = 0; i < safeSegments; i += 1) {
    const angle0 = THREE.MathUtils.lerp(-halfAngle, halfAngle, i / safeSegments);
    const angle1 = THREE.MathUtils.lerp(-halfAngle, halfAngle, (i + 1) / safeSegments);
    positions.push(0, 0, safeStartRatio);
    positions.push(Math.sin(angle0), 0, Math.cos(angle0));
    positions.push(Math.sin(angle1), 0, Math.cos(angle1));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function flamethrowerParticleSeed(index, salt) {
  const value = Math.sin((index + 1) * salt) * 43758.5453123;
  return value - Math.floor(value);
}
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

function createBusterRangeDummy(id, position, {
  moving = false,
  profile = 'stationary',
  depthLevel = 1,
  rotationY = 0,
  motionRight = null,
  motionPhase = 0,
  facingOrigin = null,
  benchmarkProfile = null,
} = {}) {
  const normalizedDepth = [1, 5, 10].includes(Number(depthLevel)) ? Number(depthLevel) : 1;
  const armored = profile === 'armored';
  const elite = profile === 'elite';
  const weakPointProfile = profile === 'weakPoint';
  const fallbackMaxHealth = (60 + normalizedDepth * 12) * (elite ? 1.65 : armored ? 1.25 : 1);
  const fallbackArmor = armored ? 38 + normalizedDepth * 1.5 : elite ? 20 + normalizedDepth : 0;
  const maxHealth = Number.isFinite(Number(benchmarkProfile?.health))
    ? Math.max(1, Number(benchmarkProfile.health))
    : fallbackMaxHealth;
  const armor = Number.isFinite(Number(benchmarkProfile?.armor))
    ? Math.max(0, Number(benchmarkProfile.armor))
    : fallbackArmor;
  const root = new THREE.Group();
  root.name = `busterRangeDummy:${id}`;
  root.position.copy(position);
  root.rotation.y = Number(rotationY) || 0;
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: armored ? 0x596978 : elite ? 0x9b5b45 : moving ? 0x6b7d8d : 0x7d6f62,
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
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(
    BUSTER_BENCHMARK_FIXTURE.targetRadius,
    BUSTER_BENCHMARK_FIXTURE.targetHeight - BUSTER_BENCHMARK_FIXTURE.targetRadius * 2,
    8,
    16,
  ), bodyMaterial);
  body.position.y = BUSTER_BENCHMARK_FIXTURE.targetHeight * 0.5;
  body.castShadow = true;
  const core = new THREE.Mesh(new THREE.SphereGeometry(
    weakPointProfile ? BUSTER_BENCHMARK_FIXTURE.weakPointRadius : 0.17,
    14,
    10,
  ), coreMaterial);
  core.position.set(
    0,
    BUSTER_BENCHMARK_FIXTURE.weakPointHeight,
    -BUSTER_BENCHMARK_FIXTURE.weakPointForwardOffset,
  );
  root.add(body, core);
  const home = position.clone();
  const authoredMotionRight = motionRight
    ? new THREE.Vector3(
      Number(motionRight.x) || 0,
      Number(motionRight.y) || 0,
      Number(motionRight.z) || 0,
    ).normalize()
    : new THREE.Vector3(1, 0, 0);
  const authoredFacingOrigin = facingOrigin
    ? new THREE.Vector3(
      Number(facingOrigin.x) || 0,
      Number(facingOrigin.y) || 0,
      Number(facingOrigin.z) || 0,
    )
    : null;

  return {
    id,
    typeKey: 'busterRangeDummy',
    root,
    radius: BUSTER_BENCHMARK_FIXTURE.targetRadius,
    collisionHeight: BUSTER_BENCHMARK_FIXTURE.targetHeight,
    dead: false,
    health: maxHealth,
    stats: { maxHealth, armor, experience: 0, damage: 0 },
    isElite: elite,
    moving,
    elapsed: 0,
    benchmark: {
      deliveredPower: 0,
      mitigatedPower: 0,
      hitCount: 0,
      weakPointHits: 0,
      stagger: 0,
      kills: 0,
      clearTimes: [],
      lifeStartedAt: 0,
      firstHitAt: null,
    },
    update(dt) {
      this.elapsed += dt;
      if (moving) {
        const displacement = Math.sin(
          this.elapsed * BUSTER_BENCHMARK_FIXTURE.lateralRate + motionPhase,
        ) * BUSTER_BENCHMARK_FIXTURE.lateralAmplitude;
        root.position.copy(home).addScaledVector(authoredMotionRight, displacement);
        if (authoredFacingOrigin) {
          root.rotation.y = Math.atan2(
            root.position.x - authoredFacingOrigin.x,
            root.position.z - authoredFacingOrigin.z,
          );
        }
      }
    },
    takeDamage(amount, meta = {}) {
      const incoming = Math.max(0, Number(amount) || 0);
      const benchmarkIncoming = weakPointProfile && meta.weakPointHit
        ? incoming * 2.4
        : incoming;
      const effectiveArmor = Math.max(0, this.stats.armor - (meta.armorPierce ?? 0));
      const dealt = benchmarkIncoming * (100 / (100 + effectiveArmor));
      if (this.benchmark.firstHitAt == null) this.benchmark.firstHitAt = this.elapsed;
      this.benchmark.deliveredPower += dealt;
      this.benchmark.mitigatedPower += Math.max(0, benchmarkIncoming - dealt);
      this.benchmark.hitCount += 1;
      if (meta.weakPointHit) this.benchmark.weakPointHits += 1;
      this.health = Math.max(0, this.health - dealt);
      if (this.health <= 0) {
        this.benchmark.kills += 1;
        this.benchmark.clearTimes.push(Math.max(0, this.elapsed - this.benchmark.lifeStartedAt));
        this.benchmark.lifeStartedAt = this.elapsed;
        this.health = this.stats.maxHealth;
      }
      return dealt;
    },
    resolveProjectileHit(projectilePosition, projectileRadius) {
      if (!weakPointProfile) return null;
      const weakPointPosition = core.getWorldPosition(new THREE.Vector3());
      const weakPointHit = weakPointPosition.distanceTo(projectilePosition)
        <= projectileRadius + BUSTER_BENCHMARK_FIXTURE.weakPointRadius;
      if (!weakPointHit) return null;
      return {
        hitPartId: 'range-core',
        weakPointHit: true,
        hitPosition: projectilePosition.clone(),
      };
    },
    applyStatus(type, options = {}) {
      if (type === 'stagger') this.benchmark.stagger += Math.max(0, Number(options.duration) || 0);
    },
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
  static async create(options = {}) {
    const busterLabStorage = options.busterLabStorage
      ?? await BusterLabStorage.open(options.busterLabStorageOptions ?? {});
    const openingWarning = busterLabStorage.lastWarning;
    if (!busterLabStorage.readOnly && !busterLabStorage.state?.legacyBusterParts?.starterRegistered) {
      await busterLabStorage.ensureStarterPowerRaiserShadowAsync({
        type: 'powerRaiser',
        name: 'Power Raiser',
        rarity: 'standard',
        level: 1,
        slot: 'hands',
        category: 'Buster Part',
        tags: ['buster', 'attack'],
        behavior: '',
        uniqueEffect: null,
        baseStats: { attackDamage: 2 },
        affixes: [],
        value: 0,
        weaponKind: null,
      });
    }
    // A successful starter-grant write must not erase a warning explaining
    // that the payload loaded immediately before it was recovered/quarantined.
    if (openingWarning) busterLabStorage.lastWarning = openingWarning;
    const game = new Game({ ...options, busterLabStorage, deferBusterLabInitialization: true });
    if (game.busterLabEnabled) {
      await game._initializeBusterLabFeature();
    } else {
      game._hydrateLegacyBusterShadowItems();
    }
    game.ui?.renderInventory?.();
    game.initializeInterruptedExpeditionRecovery();
    return game;
  }

  constructor({
    container = document.getElementById('game-container'),
    busterLabStorage = null,
    deferBusterLabInitialization = false,
  } = {}) {
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
    this.enemyIdAllocator = createEnemyIdAllocator('enemy');
    setActiveEnemyIdAllocator(this.enemyIdAllocator);
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
    this.flamethrowerEffects = new Map();
    this.pendingExplosions = [];
    this.explosionDispatchDepth = 0;
    this.elapsedTime = 0;
    this.hitStopTimer = 0;
    this.hitStopTimeScale = 1;
    this.busterLabEnabled = isBusterLabFeatureEnabled();
    this.busterLabSandboxEnabled = this.busterLabEnabled && isBusterLabSandboxEnabled();
    this.busterLabDebugEnabled = this.busterLabEnabled && isBusterLabDebugPresetEnabled();
    this.bossDebugEnabled = isBossDebugEnabled();
    this.busterLabStorage = busterLabStorage;
    this.busterLabState = null;
    this.busterLabLoadWarning = null;
    this.busterLabPlans = new Map();
    this.selectedBusterBlueprintId = null;
    this.pendingBusterMaterializationSuggestion = null;
    this.busterBenchmarkOptions = {
      targetCount: 1,
      profile: 'stationary',
      depthLevel: 1,
      distanceBand: 'mid',
      layout: 'compact',
      aimOffset: 'center',
    };
    this.busterBenchmarkLastMetrics = null;
    this.busterBenchmarkSimulationCache = new Map();
    this.busterStorageOperationQueue = Promise.resolve();
    this.busterGameCommandQueue = Promise.resolve();
    this.busterStorageOperationPending = 0;
    this.busterGameCommandPending = 0;
    this.busterTestRange = null;
    this.busterSandboxSession = null;
    this.combatDepthLevel = 1;
    this.animationPreview = this._readAnimationPreviewFromUrl();
    this.roomPreview = this._readRoomPreviewFromUrl();
    const dungeonFamilySelection = readDungeonFamilySelection();
    this.dungeonFamilyId = dungeonFamilySelection.dungeonFamilyId;
    this.dungeonFamilyFallback = dungeonFamilySelection.fallback;
    this.startupWorldMode = readStartupWorldMode(this.roomPreview);
    this.usesStreamedWorldLifecycle = this.startupWorldMode === 'overworld';
    this.worldKind = this.startupWorldMode;
    this.worldLifecycle = createWorldLifecycleState(this.startupWorldMode);
    this.transitionState = this.worldLifecycle.state;
    this.activeWorldBundle = null;
    this.overworldPlan = this.usesStreamedWorldLifecycle ? createAuthoredOverworldPlan() : null;
    this.overworldController = null;
    this.worldGenerationCount = 0;
    this.worldDisposalCount = 0;
    this.lastWorldDisposalStats = null;
    this.worldLifecycleEventLog = [Object.freeze({
      sequence: 0,
      event: 'initialized',
      state: this.transitionState,
      worldKind: this.worldKind,
      generationCount: 0,
      disposalCount: 0,
    })];
    this.worldLifecycleEventSequence = 1;
    this.worldTransitionInFlight = null;
    this.interruptedExpeditionRecoveryInFlight = null;
    this.interruptedExpeditionRecoveryState = 'none';
    this.interruptedExpeditionRecovery = null;
    this.hostEventBindingPasses = 0;
    this.hostEventListenerRegistrations = 0;
    this.stagedBossProfileId = null;
    this.lastExpeditionSummary = null;
    this.inventoryOpen = false;
    this.poseDebugOpen = false;
    this.isGameOver = false;
    this.ruinFloor = 1;
    this.dungeonLayoutGeneration = 0;
    this.dungeonLayoutSeed = readDungeonLayoutSeed();
    this.dungeonAugmentationProfileId = readDungeonAugmentationProfileId();
    this.selectedBossProfileId = normalizeBossProfileId(
      this.busterLabStorage?.state?.bossHunts?.selectedBossProfileId
        ?? DEFAULT_BOSS_PROFILE_ID,
    );
    this.activeBossExpeditionSpec = null;
    this.activeReaverbotBoss = null;
    this.bossStageRuntime = null;
    this.bossHuntWarning = this.busterLabStorage?.state?.bossHunts?.fallbackFromProfileId
      ? `Unknown saved Boss Hunt “${this.busterLabStorage.state.bossHunts.fallbackFromProfileId}” was replaced with Revolving Fusillade.`
      : (this.busterLabStorage?.state?.bossHunts?.quarantinedRecoveryCount ?? 0) > 0
        ? `Roll quarantined ${this.busterLabStorage.state.bossHunts.quarantinedRecoveryCount} invalid Boss Recovery record(s).`
        : (this.busterLabStorage?.state?.bossHunts?.quarantinedEncounterProgressCount ?? 0) > 0
          ? `Roll quarantined ${this.busterLabStorage.state.bossHunts.quarantinedEncounterProgressCount} invalid Ascension checkpoint record(s).`
          : null;
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
      cameraForward: this.cameraController.movementForward,
      cameraRight: this.cameraController.movementRight,
      lockOnTarget: null,
      lockOnTargetPosition: this.lockOnMovementTargetPosition,
    };
    this.raycaster = new THREE.Raycaster();
    this.cameraOcclusionRaycaster = new THREE.Raycaster();
    this.cameraOcclusionEntries = [];
    this.cameraOcclusionBins = new Map();
    this.cameraOcclusionWallProximityBins = new Map();
    this.cameraOcclusionProximityRecordByKey = new Map();
    this.cameraOcclusionWallProximityCandidateKeys = new Set();
    this.cameraOcclusionExpandedVerticalRecordKeys = new Set();
    this.cameraOcclusionExpandedSurfaceRecordKeys = new Set();
    this.cameraOcclusionForwardVerticalHits = [];
    this.cameraOcclusionCandidateSet = new Set();
    this.cameraOcclusionCandidateObjects = [];
    this.cameraOcclusionHits = [];
    this.cameraOcclusionOwnerByObject = new WeakMap();
    this.cameraOcclusionHiddenOwners = new Set();
    this.cameraOcclusionHiddenInstances = [];
    this.cameraOcclusionHiddenInstanceKeys = new Set();
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
    this.targetScannerRaycaster = new THREE.Raycaster();
    this.targetScannerMarkers = new Map();
    this.targetScannerMarkerGeometry = new THREE.TorusGeometry(0.26, 0.025, 8, 24);
    this.targetScannerMarkerMaterial = new THREE.MeshBasicMaterial({
      color: 0x56f5ff,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
    });
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
    this.dynamicPlatformingPlatforms = [];
    this.connectorLiftRuntime = null;
    this.connectorTrackTrapRuntime = null;
    this.platformingLedgeCandidates = [];
    this.debugSpawnedPlatforms = [];
    this.debugPlatformCounter = 0;
    this.debugJumpHeightPreset = 'normal';
    this.debugGravityPreset = 'normal';
    this.debugNoClipEnabled = false;
    this.debugNoClipRestorePosition = null;
    this.debugNoClipRestoreWorldGeneration = 0;
    this.debugNoClipLastRestoreSource = 'none';
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
    if (this.dungeon?.playerStartFacing) {
      this.player.lastMoveDirection.copy(this.dungeon.playerStartFacing).setY(0).normalize();
      this.player.faceDirection(this.player.lastMoveDirection);
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
    if (this.busterLabStorage) {
      this.busterLabStorage ??= new BusterLabStorage();
      this.busterLabState = this.busterLabStorage.state ?? this.busterLabStorage.load();
      this.busterLabLoadWarning = this.busterLabStorage.lastWarning;
      this.rollSalvageStorage = this.busterLabStorage.createRollSalvageStorage({ autosave: false });
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
    this.dungeonController = this.worldKind === 'overworld'
      ? new OverworldRuntimeController(this, this.dungeon)
      : new DungeonController(this, this.dungeon);
    this.overworldController = this.worldKind === 'overworld'
      ? this.dungeonController.core
      : null;
    if (this.activeWorldBundle) this.activeWorldBundle.controller = this.dungeonController;
    this._activateConnectorLiftRuntimeForBundle(this.activeWorldBundle);
    this._activateConnectorTrackTrapRuntimeForBundle(this.activeWorldBundle);
    this.bossStageRuntime?.mount?.(this);
    this.player.powerKnockbackTravelResolver = ({ fromPosition, position }) => (
      this.dungeonController.resolvePowerKnockbackTravel(fromPosition, position)
    );
    this.player.powerKnockbackLandingResolver = ({ position, direction, originPosition }) => (
      this.dungeonController.resolvePowerKnockbackLanding(position, direction, originPosition)
    );
    this.mapEvents = this._createMapEventSystemForWorld();

    this._addStarterItems();
    if (this.busterLabEnabled && !deferBusterLabInitialization) {
      this._initializeBusterLabFeature();
    } else if (!this.busterLabEnabled && !deferBusterLabInitialization) {
      this._hydrateLegacyBusterShadowItems();
    }
    if (this.worldKind === 'dungeon') this.spawner.spawnInitialPack();
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
      anchorId: params.get('roomPreviewAnchor'),
      level: levelParam !== null && Number.isFinite(levelValue) ? levelValue : null,
      facingX: facing?.x,
      facingZ: facing?.z,
      facingExplicit: Boolean(facing),
    };
  }

  _getRoomPreviewPosition() {
    if (!this.roomPreview || !this.dungeon) {
      return null;
    }
    const room = this.dungeon.rooms.find((candidate) => candidate.id === this.roomPreview.roomId);
    if (!room) {
      const matchingConnections = this.dungeon.progression?.roomConnections?.filter((candidate) => (
        candidate.connectorId === this.roomPreview.roomId
      )) ?? [];
      const connection = matchingConnections.find((candidate) => !candidate.doorId && !candidate.shortcut)
        ?? matchingConnections[0];
      if (connection) {
        const fromRoom = this.dungeon.rooms.find((candidate) => candidate.id === connection.fromRoomId);
        const toRoom = this.dungeon.rooms.find((candidate) => candidate.id === connection.toRoomId);
        if (fromRoom && toRoom) {
          const segmentStart = { x: fromRoom.x, z: fromRoom.z };
          const segmentEnd = fromRoom.x !== toRoom.x && fromRoom.z !== toRoom.z
            ? { x: toRoom.x, z: fromRoom.z }
            : { x: toRoom.x, z: toRoom.z };
          const deltaX = segmentEnd.x - segmentStart.x;
          const deltaZ = segmentEnd.z - segmentStart.z;
          const distance = Math.hypot(deltaX, deltaZ) || 1;
          const facingX = deltaX / distance;
          const facingZ = deltaZ / distance;
          if (!Number.isFinite(this.roomPreview.facingX) || !Number.isFinite(this.roomPreview.facingZ)) {
            this.roomPreview.facingX = facingX;
            this.roomPreview.facingZ = facingZ;
          }
          return new THREE.Vector3(
            ((segmentStart.x + segmentEnd.x) * 0.5 + facingX * 1.5) * this.dungeon.tileSize,
            Number(
              connection.routes?.[0]?.sourceElevation
              ?? fromRoom.baseElevation
              ?? 0,
            ),
            ((segmentStart.z + segmentEnd.z) * 0.5 + facingZ * 1.5) * this.dungeon.tileSize,
          );
        }
      }
      return null;
    }
    const previewAnchor = this.roomPreview.anchorId
      ? room.previewAnchors?.[this.roomPreview.anchorId]
      : null;
    if (Number.isFinite(previewAnchor?.x) && Number.isFinite(previewAnchor?.z)) {
      if (!this.roomPreview.facingExplicit) {
        this.roomPreview.facingX = previewAnchor.facingX ?? 0;
        this.roomPreview.facingZ = previewAnchor.facingZ ?? -1;
      }
      return new THREE.Vector3(
        previewAnchor.x * this.dungeon.tileSize,
        previewAnchor.y ?? room.baseElevation ?? 0,
        previewAnchor.z * this.dungeon.tileSize,
      );
    }
    if (!Number.isFinite(this.roomPreview.level)
      && Number.isFinite(room.previewPosition?.x)
      && Number.isFinite(room.previewPosition?.z)) {
      if (!this.roomPreview.facingExplicit && room.previewFacing) {
        this.roomPreview.facingX = room.previewFacing.x;
        this.roomPreview.facingZ = room.previewFacing.z;
      } else if (!Number.isFinite(this.roomPreview.facingX) || !Number.isFinite(this.roomPreview.facingZ)) {
        this.roomPreview.facingX = room.previewFacing?.x ?? 0;
        this.roomPreview.facingZ = room.previewFacing?.z ?? -1;
      }
      return new THREE.Vector3(
        room.previewPosition.x * this.dungeon.tileSize,
        room.previewPosition.y ?? room.baseElevation ?? 0,
        room.previewPosition.z * this.dungeon.tileSize,
      );
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
      .filter((tile) => (
        tile.surfaceRole !== 'ramp'
          && tile.surfaceRole !== 'hazard-floor'
          && tile.surface !== 'industrialRamp'
          && tile.surface !== 'deepMagma'
      ));
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
    dataset.playerJumpState = player?.jumpState ?? 'unknown';
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
    dataset.debugNoClipEnabled = this.debugNoClipEnabled ? 'true' : 'false';
    dataset.debugNoClipRestoreSource = this.debugNoClipLastRestoreSource ?? 'none';
    dataset.connectorTrackTrapMounted = this.connectorTrackTrapRuntime?.mounted ? 'true' : 'false';
    dataset.connectorTrackTrapCount = String(this.connectorTrackTrapRuntime?.traps?.length ?? 0);
    dataset.connectorTrackTrapVisualCount = String(
      this.activeWorldBundle?.connectorTrackTrapVisualFactory?.instances?.size ?? 0,
    );
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

  _getDebugNoClipLanding() {
    const controller = this.dungeonController;
    const current = this.player?.root?.position;
    if (!controller || !current) return null;

    const candidate = current.clone();
    const authoredY = this.bossStageRuntime?.getFloorElevationOverride?.(candidate);
    const platformY = this.getPlatformFloorElevation?.(candidate);
    const railY = controller.getPlayerRailSupportElevation?.(candidate);
    const directSurfaceY = typeof controller.getFloorTileAt !== 'function'
      ? controller.getSurfaceElevationAt?.(candidate)
      : null;
    const tile = controller.getFloorTileAt?.(candidate, {
      allowClosest: true,
      maxElevationAbove: 0.42,
    });
    const tileY = tile
      ? controller._getTileElevationAtPosition?.(tile, candidate)
      : null;
    const isLandingBelow = (value) => Number.isFinite(value) && value <= current.y + 0.42;
    const surfaceY = isLandingBelow(platformY)
      ? platformY
      : isLandingBelow(railY)
        ? railY
        : isLandingBelow(authoredY)
          ? authoredY
          : isLandingBelow(directSurfaceY)
            ? directSurfaceY
            : tileY;

    if (Number.isFinite(surfaceY)) {
      candidate.y = surfaceY;
      if (controller.isPositionWalkable?.(candidate)) {
        return { position: candidate, source: 'current-surface' };
      }
    }

    const sameWorldRestore = this.debugNoClipRestoreWorldGeneration === this.worldGenerationCount
      ? this.debugNoClipRestorePosition
      : null;
    const safeAnchor = sameWorldRestore ?? controller.lastSafePlayerPosition;
    if (safeAnchor) {
      return { position: safeAnchor.clone(), source: 'safe-anchor' };
    }
    return null;
  }

  setDebugNoClipEnabled(enabled) {
    const next = Boolean(enabled);
    if (!this.player || next === this.debugNoClipEnabled) {
      return this.getPlatformDebugState();
    }

    this.keys.clear();
    if (next) {
      this.debugNoClipRestorePosition = (
        this.dungeonController?.lastSafePlayerPosition ?? this.player.root.position
      ).clone();
      this.debugNoClipRestoreWorldGeneration = this.worldGenerationCount;
      this.debugNoClipLastRestoreSource = 'none';
      this.debugNoClipEnabled = true;
      this.player.setNoClipEnabled?.(true, { game: this });
    } else {
      const landing = this._getDebugNoClipLanding();
      if (landing?.position) {
        this.player.root.position.copy(landing.position);
        this.dungeonController?.lastSafePlayerPosition?.copy?.(landing.position);
        if (this.dungeonController) {
          this.dungeonController.pendingPlayerJumpOffLanding = null;
        }
      }
      this.debugNoClipEnabled = false;
      this.debugNoClipLastRestoreSource = landing?.source ?? 'safe-anchor';
      this.player.setNoClipEnabled?.(false, {
        game: this,
        groundY: landing?.position?.y ?? this.player.root.position.y,
      });
    }

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
      noClipEnabled: this.debugNoClipEnabled,
      noClipLastRestoreSource: this.debugNoClipLastRestoreSource,
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
    // A boss can append a minion while the enemy update loop is already in
    // progress. Combat/projectiles run later in that same frame, so establish
    // canonical game ownership before the minion's first update can occur.
    enemy._runtimeGame = this;
    this.enemies.push(enemy);
    this.scene.add(enemy.root);
  }

  removeEnemy(enemy, { dispose = true } = {}) {
    if (!enemy) return false;
    enemy.root?.removeFromParent?.();
    if (this._updatingEnemies) {
      this._deferredEnemyRemovals ??= new Map();
      const previous = this._deferredEnemyRemovals.get(enemy);
      this._deferredEnemyRemovals.set(enemy, {
        dispose: Boolean(dispose || previous?.dispose),
      });
      return true;
    }
    if (dispose) enemy.dispose?.();
    const index = this.enemies.indexOf(enemy);
    if (index >= 0) this.enemies.splice(index, 1);
    return index >= 0;
  }

  _flushDeferredEnemyRemovals() {
    if (!this._deferredEnemyRemovals?.size) return;
    const removals = [...this._deferredEnemyRemovals.entries()];
    this._deferredEnemyRemovals.clear();
    for (const [enemy, options] of removals) {
      if (options.dispose) enemy.dispose?.();
      enemy.root?.removeFromParent?.();
      const index = this.enemies.indexOf(enemy);
      if (index >= 0) this.enemies.splice(index, 1);
    }
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

  canEditArmsGear() {
    const atAuthorizedWorkshop = Boolean(
      this.dungeonController?.isPlayerInCamp?.()
      || this.dungeonController?.isPlayerAtRollWorkshop?.(),
    );
    return atAuthorizedWorkshop
      && !this.busterSandboxSession?.active
      && !this.busterTestRange?.active
      && !this.busterLabStorage?.readOnly;
  }

  _applyPersistedArmsGear({ refillBarrier = false } = {}) {
    const armsGear = this.busterLabStorage?.state?.armsGear
      ?? this.busterLabState?.armsGear
      ?? createDefaultArmsGearState();
    this.busterLabState = this.busterLabStorage?.state ?? this.busterLabState;
    this.player.applyArmsGearState(armsGear, {
      resolveCustomBuster: (buildId) => (
        this.busterLabPlans.has(buildId)
          ? this._createCustomBusterArmDescriptor(buildId)
          : null
      ),
      refillBarrier,
    });
    this._updateTargetScanner?.();
    return armsGear;
  }

  async equipArmLoadoutSlot(slot, selection) {
    if (!this.canEditArmsGear()) {
      return { ok: false, reason: 'unsafe-area', message: 'Arms can be changed only with Roll at camp.' };
    }
    if (!this.busterLabStorage?.equipArmLoadoutSlot) {
      return { ok: false, reason: 'storage-unavailable', message: 'The Arms workshop is unavailable.' };
    }
    const normalizedSelection = typeof selection === 'string'
      ? { kind: 'fixedArm', armId: selection }
      : selection;
    const result = await this._queueBusterStorageOperation(() => (
      this.busterLabStorage.equipArmLoadoutSlot(slot, normalizedSelection)
    ));
    if (!result?.ok) {
      return { ...result, message: result?.reason === 'arm-not-owned' ? 'That Arm has not been fabricated.' : 'That Arm cannot use this slot.' };
    }
    this._applyPersistedArmsGear();
    this.ui?.renderInventory?.();
    return { ...result, message: 'Arm loadout updated.' };
  }

  async equipGearLoadoutSlot(slot, gearId) {
    if (!this.canEditArmsGear()) {
      return { ok: false, reason: 'unsafe-area', message: 'Gear can be changed only with Roll at camp.' };
    }
    if (!this.busterLabStorage?.equipGearLoadoutSlot) {
      return { ok: false, reason: 'storage-unavailable', message: 'The Gear workshop is unavailable.' };
    }
    const result = await this._queueBusterStorageOperation(() => (
      this.busterLabStorage.equipGearLoadoutSlot(slot, gearId || null)
    ));
    if (!result?.ok) {
      return { ...result, message: result?.reason === 'gear-locked' ? 'Fabricate that Gear first.' : 'That Gear cannot use this slot.' };
    }
    this._applyPersistedArmsGear();
    this.ui?.renderInventory?.();
    return { ...result, message: 'Gear loadout updated.' };
  }

  async fabricateEquipment(recipeId) {
    if (!this.canEditArmsGear()) {
      return { ok: false, reason: 'unsafe-area', message: 'Roll can fabricate equipment only at camp.' };
    }
    const recipe = getEquipmentRecipeDefinition(recipeId);
    if (!recipe || !this.busterLabStorage?.fabricateEquipment) {
      return { ok: false, reason: 'unknown-recipe', message: 'Roll does not recognize that equipment recipe.' };
    }
    const result = await this._queueBusterStorageOperation(() => (
      this.busterLabStorage.fabricateEquipment(recipe.id)
    ));
    if (!result?.ok) {
      const message = result?.reason === 'already-fabricated' || result?.reason === 'already-owned'
        ? `${recipe.label} is already unlocked.`
        : result?.reason === 'insufficient-resources'
          ? 'Roll is missing required scrap or named parts.'
          : result?.reason === 'defense-locked'
            ? 'Defeat a qualifying Boss before Roll can fabricate Defense Gear.'
          : 'Fabrication could not be saved; nothing was consumed.';
      return { ...result, message };
    }
    this._refreshRollSalvageStorage();
    this._applyPersistedArmsGear();
    this.ui?.showToast?.(`${recipe.label} fabricated`, '#7df8ff');
    this.ui?.renderInventory?.();
    return { ...result, message: `${recipe.label} permanently unlocked.` };
  }

  _hasTargetScannerLineOfSight(worldPosition) {
    const origin = tempVectorA.copy(this.player.root.position);
    origin.y += 1;
    const direction = tempVectorB.copy(worldPosition).sub(origin);
    const distance = direction.length();
    if (distance <= 0.001) return true;
    direction.multiplyScalar(1 / distance);
    this.targetScannerRaycaster.set(origin, direction);
    this.targetScannerRaycaster.near = 0.05;
    this.targetScannerRaycaster.far = Math.max(0.05, distance - 0.08);
    const occluders = (this.cameraOcclusionEntries ?? [])
      .map((entry) => entry?.object)
      .filter(Boolean);
    if (occluders.length === 0) return true;

    // Scanner LOS must consider every authored occlusion wall between the
    // player and target. The camera's candidate list is only the most recent
    // camera-to-player bin and is therefore not a valid world LOS set.
    const originalMaterialSides = new Map();
    for (const object of occluders) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material && material.side !== THREE.DoubleSide && !originalMaterialSides.has(material)) {
          originalMaterialSides.set(material, material.side);
          material.side = THREE.DoubleSide;
        }
      }
    }
    try {
      return this.targetScannerRaycaster.intersectObjects(occluders, false).length === 0;
    } finally {
      for (const [material, side] of originalMaterialSides) material.side = side;
    }
  }

  _updateTargetScanner() {
    const scanner = this.player.gearEffects?.targetScanner;
    const eligible = new Map();
    if (scanner && !this.player.dead) {
      const playerPosition = this.player.root.position;
      const rangeSq = scanner.range * scanner.range;
      for (const enemy of this.enemies) {
        if (!enemy || enemy.dead) continue;
        for (const combatTarget of getEnemyCombatTargets(enemy)) {
          if (!combatTarget?.isWeakPointTarget || combatTarget.active === false) continue;
          const targetObject = combatTarget.root;
          if (!targetObject?.getWorldPosition) continue;
          targetObject.getWorldPosition(tempVectorC);
          if (playerPosition.distanceToSquared(tempVectorC) <= rangeSq
            && this._hasTargetScannerLineOfSight(tempVectorC)) {
            eligible.set(targetObject, tempVectorC.clone());
          }
        }
        const weakPoint = enemy.visual?.weakPoint?.core;
        if (weakPoint && enemy.brain?.weakPointExposed && !enemy.weakPointBroken) {
          weakPoint.getWorldPosition(tempVectorC);
          if (playerPosition.distanceToSquared(tempVectorC) <= rangeSq
            && this._hasTargetScannerLineOfSight(tempVectorC)) {
            eligible.set(weakPoint, tempVectorC.clone());
          }
        }
        if (enemy.brain?.clawDestroyed) continue;
        enemy.root?.traverse?.((object) => {
          if (!object.visible || !object.userData?.breakableWeaponPart) return;
          object.getWorldPosition(tempVectorC);
          if (playerPosition.distanceToSquared(tempVectorC) <= rangeSq
            && this._hasTargetScannerLineOfSight(tempVectorC)) {
            eligible.set(object, tempVectorC.clone());
          }
        });
      }
    }

    for (const [target, markerSet] of this.targetScannerMarkers) {
      if (eligible.has(target)) continue;
      markerSet.reticle.removeFromParent();
      markerSet.highlight.removeFromParent();
      markerSet.highlight.geometry?.dispose?.();
      markerSet.highlight.material?.dispose?.();
      this.targetScannerMarkers.delete(target);
    }
    for (const [target, position] of eligible) {
      let markerSet = this.targetScannerMarkers.get(target);
      if (!markerSet) {
        const reticle = new THREE.Mesh(
          this.targetScannerMarkerGeometry,
          this.targetScannerMarkerMaterial,
        );
        reticle.name = 'targetScannerCyanReticle';
        reticle.renderOrder = 999;
        const highlight = new THREE.BoxHelper(target, 0x55f4ff);
        highlight.name = 'targetScannerCyanHighlight';
        highlight.material.depthTest = false;
        highlight.material.transparent = true;
        highlight.material.opacity = 0.82;
        highlight.renderOrder = 998;
        this.scene.add(reticle, highlight);
        markerSet = { reticle, highlight };
        this.targetScannerMarkers.set(target, markerSet);
      }
      markerSet.reticle.position.copy(position);
      markerSet.reticle.quaternion.copy(this.camera.quaternion);
      markerSet.reticle.visible = true;
      markerSet.highlight.update();
      markerSet.highlight.visible = true;
    }
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

  getSelectedBossProfileId() {
    return normalizeBossProfileId(this.selectedBossProfileId);
  }

  _createBossExpeditionAttemptId(profileId) {
    const randomId = globalThis.crypto?.randomUUID?.()
      ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `expedition:${this.busterLabStorage?.saveContextId ?? 'prototype'}:${profileId}:${randomId}`;
  }

  _configureBossHuntEncounter(dungeon = this.dungeon, {
    ignorePersistedActive = false,
    restartFromBeginning = false,
    overridePersistedDungeonAugmentation = false,
    dungeonAugmentation = null,
  } = {}) {
    const encounter = dungeon?.encounters?.find?.((candidate) => candidate.isBoss);
    if (!encounter) return null;
    const profileId = this.getSelectedBossProfileId();
    const profile = getReaverbotBossProfile(profileId);
    const persistedExpedition = this.busterLabStorage?.getActiveBossExpedition?.();
    if (!ignorePersistedActive
      && isInterruptedExpeditionRecord(persistedExpedition)
      && persistedExpedition.bossProfileId === profileId) {
      this.activeBossExpeditionSpec = Object.freeze({
        schemaVersion: BOSS_EXPEDITION_SCHEMA_VERSION,
        id: persistedExpedition.expeditionId,
        seed: persistedExpedition.seed,
        depth: persistedExpedition.depth,
        bossProfileId: profileId,
        dungeonFamilyId: persistedExpedition.dungeonFamilyId ?? INDUSTRIAL_DUNGEON_FAMILY_ID,
        dungeonLayoutSeed: persistedExpedition.dungeonLayoutSeed
          ?? dungeon?.layoutSeed
          ?? this.dungeonLayoutSeed,
        dungeonAugmentation: overridePersistedDungeonAugmentation
          ? dungeonAugmentation
          : persistedExpedition.dungeonAugmentation ?? null,
        encounterProgress: restartFromBeginning
          ? null
          : persistedExpedition.encounterProgress ?? null,
        seedLabel: `persisted:${persistedExpedition.expeditionId}`,
      });
      encounter.bossProfileId = profileId;
      encounter.expeditionSpec = this.activeBossExpeditionSpec;
      encounter.label = profile?.title ?? 'Ruin Core Boss';
      return encounter;
    }
    const specSeed = `${this.busterLabStorage?.saveContextId ?? 'prototype'}:${dungeon?.layoutSeed ?? this.dungeonLayoutSeed}:boss:${profileId}`;
    if (!this.activeBossExpeditionSpec
      || this.activeBossExpeditionSpec.bossProfileId !== profileId
      || this.activeBossExpeditionSpec.seedLabel !== specSeed) {
      this.activeBossExpeditionSpec = {
        ...createBossExpeditionSpec({
          bossProfileId: profileId,
          seed: specSeed,
          depth: Math.max(1, Math.min(10, Math.round(this.ruinFloor ?? 1))),
          id: this._createBossExpeditionAttemptId(profileId),
          dungeonFamilyId: dungeon?.dungeonFamilyId ?? INDUSTRIAL_DUNGEON_FAMILY_ID,
        }),
        dungeonLayoutSeed: dungeon?.layoutSeed ?? this.dungeonLayoutSeed,
        dungeonAugmentation: dungeon?.augmentationIdentity ?? null,
        seedLabel: specSeed,
      };
    }
    encounter.bossProfileId = profileId;
    encounter.expeditionSpec = this.activeBossExpeditionSpec;
    encounter.label = profile?.title ?? 'Ruin Core Boss';
    return encounter;
  }

  getActiveBossExpeditionSpec() {
    return this.activeBossExpeditionSpec ?? this._configureBossHuntEncounter()?.expeditionSpec ?? null;
  }

  initializeInterruptedExpeditionRecovery() {
    if (!this.usesStreamedWorldLifecycle
      || this.worldKind !== 'overworld'
      || this.transitionState !== 'overworld') {
      return { ok: true, prompted: false, reason: 'not-streamed-overworld' };
    }
    const record = this.busterLabStorage?.getActiveBossExpedition?.() ?? null;
    if (!isInterruptedExpeditionRecord(record)) {
      this.interruptedExpeditionRecovery = null;
      this.interruptedExpeditionRecoveryState = 'none';
      return { ok: true, prompted: false, reason: 'no-active-expedition' };
    }

    const profileId = normalizeBossProfileId(record.bossProfileId);
    if (profileId !== record.bossProfileId) {
      return { ok: false, prompted: false, reason: 'invalid-boss-profile' };
    }
    const dungeonLayoutSeed = String(
      record.dungeonLayoutSeed
        ?? `layout:resume:${this.busterLabStorage?.saveContextId ?? 'prototype'}:${record.expeditionId}`,
    );
    const profile = getReaverbotBossProfile(profileId);
    this.selectedBossProfileId = profileId;
    this.activeBossExpeditionSpec = Object.freeze({
      schemaVersion: BOSS_EXPEDITION_SCHEMA_VERSION,
      id: record.expeditionId,
      seed: record.seed,
      depth: record.depth,
      bossProfileId: profileId,
      dungeonFamilyId: record.dungeonFamilyId ?? INDUSTRIAL_DUNGEON_FAMILY_ID,
      dungeonLayoutSeed,
      dungeonAugmentation: record.dungeonAugmentation ?? null,
      encounterProgress: record.encounterProgress ?? null,
      seedLabel: `persisted:${record.expeditionId}`,
    });
    const wasPrompting = this.interruptedExpeditionRecoveryState === 'prompting'
      && this.interruptedExpeditionRecovery?.expeditionId === record.expeditionId;
    this.interruptedExpeditionRecovery = Object.freeze({
      expeditionId: record.expeditionId,
      bossProfileId: profileId,
      dungeonFamilyId: record.dungeonFamilyId ?? INDUSTRIAL_DUNGEON_FAMILY_ID,
      expeditionStatus: record.status,
      dungeonLayoutSeed,
      dungeonAugmentation: record.dungeonAugmentation ?? null,
      expeditionLabel: profile?.title ?? 'Boss Hunt',
    });
    this.interruptedExpeditionRecoveryState = 'prompting';
    this.expeditionAccepted = false;
    this.expeditionActive = false;
    this.stagedBossProfileId = null;
    if (!wasPrompting) {
      this._recordWorldLifecycleEvent('interrupted-expedition-detected', {
        expeditionId: record.expeditionId,
        bossProfileId: profileId,
        dungeonLayoutSeedHash: hashSeed(dungeonLayoutSeed),
      });
    }
    this.ui?.openInterruptedExpeditionPrompt?.({
      expeditionId: record.expeditionId,
      bossProfileId: profileId,
      expeditionStatus: record.status,
      expeditionLabel: profile?.title ?? 'Boss Hunt',
      resetOrAbandonRequired: record.dungeonAugmentation?.resetOrAbandonRequired === true,
    });
    return {
      ok: true,
      prompted: true,
      expeditionId: record.expeditionId,
      bossProfileId: profileId,
    };
  }

  getInterruptedExpeditionRecoveryDiagnostics() {
    const recovery = this.interruptedExpeditionRecovery;
    return {
      state: this.interruptedExpeditionRecoveryState,
      pending: recovery ? {
        expeditionId: recovery.expeditionId,
        bossProfileId: recovery.bossProfileId,
        dungeonFamilyId: recovery.dungeonFamilyId,
        expeditionStatus: recovery.expeditionStatus,
        dungeonLayoutSeed: recovery.dungeonLayoutSeed,
        dungeonLayoutSeedHash: hashSeed(recovery.dungeonLayoutSeed),
        dungeonAugmentation: recovery.dungeonAugmentation ?? null,
      } : null,
    };
  }

  _resolveInterruptedExpeditionPromptAfterExternalChange(reason = 'already-resolved') {
    const expeditionId = this.interruptedExpeditionRecovery?.expeditionId ?? null;
    this.interruptedExpeditionRecovery = null;
    this.interruptedExpeditionRecoveryState = 'none';
    this.interruptedExpeditionRecoveryInFlight = null;
    this.activeBossExpeditionSpec = null;
    this.stagedBossProfileId = null;
    this.expeditionAccepted = false;
    this.expeditionActive = false;
    this.ui?.closeInterruptedExpeditionPrompt?.({ restoreFocus: false });
    this.ui?.renderInventory?.();
    this._recordWorldLifecycleEvent('interrupted-expedition-resolved-externally', {
      expeditionId,
      reason,
    });
    return {
      ok: true,
      resolved: true,
      reason,
      worldKind: this.worldKind,
    };
  }

  _reloadInterruptedExpeditionStateAfterExternalConflict() {
    const storage = this.busterLabStorage;
    const persistence = storage?.getPersistenceStatus?.();
    if (!['external-conflict', 'conflict'].includes(persistence?.writePauseReason)) return null;
    if (typeof storage.reloadFromStorage !== 'function') {
      return Promise.resolve({
        ok: false,
        reason: 'storage-reload-unavailable',
        message: 'The expedition save changed in another window and could not be reloaded.',
      });
    }
    return storage.reloadFromStorage().then((result) => {
      if (result?.ok) {
        this._reconcileBusterLabRuntimeAfterReload();
        this.ui?.renderInventory?.();
      }
      return result;
    });
  }

  _reconcileBusterLabRuntimeAfterReload() {
    if (!this.busterLabStorage) return;
    this.busterLabLoadWarning = this.busterLabStorage.lastWarning;
    this._refreshRollSalvageStorage();
    this.selectedBossProfileId = normalizeBossProfileId(
      this.busterLabStorage.state?.bossHunts?.selectedBossProfileId
        ?? DEFAULT_BOSS_PROFILE_ID,
    );
    this._recompileBusterPlans();
    this._restoreCustomBusterAssignments();
  }

  _refreshInterruptedExpeditionPromptIfIdentityChanged(expectedExpeditionId, record) {
    if (!expectedExpeditionId
      || !isInterruptedExpeditionRecord(record)
      || record.expeditionId === expectedExpeditionId) {
      return null;
    }
    this.initializeInterruptedExpeditionRecovery();
    this._recordWorldLifecycleEvent('interrupted-expedition-identity-changed', {
      expectedExpeditionId,
      actualExpeditionId: record.expeditionId,
      bossProfileId: record.bossProfileId,
    });
    return {
      ok: false,
      changed: true,
      reason: 'interrupted-expedition-changed',
      expeditionId: record.expeditionId,
      message: 'The active Boss Hunt changed in another window. Review the updated expedition before choosing again.',
    };
  }

  getBossHuntViewModel() {
    const state = this.busterLabStorage?.state?.bossHunts ?? {};
    const victories = state.victoriesByProfile ?? {};
    const selectedBossProfileId = this.getSelectedBossProfileId();
    const pendingRecoveries = Array.isArray(state.pendingRecoveries) ? state.pendingRecoveries : [];
    return {
      selectedBossProfileId,
      locked: Boolean(this.expeditionActive || state.activeExpeditionId),
      readOnly: Boolean(this.busterLabStorage?.readOnly),
      warning: this.bossHuntWarning,
      pendingRecoveryCount: pendingRecoveries.filter((entry) => !entry.identified).length,
      activeExpedition: this.getActiveBossExpeditionSpec(),
      profiles: REAVERBOT_BOSS_PROFILES.map((profile) => {
        const material = getReaverbotBossRewardMaterial(profile);
        const discovered = Boolean(material && this.rollSalvageStorage?.hasDiscoveredPart?.(material.id));
        const linkedRecipes = material
          ? [
            ...BUSTER_RECIPE_LIST.filter((recipe) => Number(recipe.requirements?.parts?.[material.id] ?? 0) > 0)
              .map((recipe) => ({ id: recipe.id, moduleId: recipe.moduleId, name: recipe.name ?? recipe.moduleId })),
            ...getEquipmentRecipesForPart(material.id)
              .map((recipe) => ({ id: recipe.id, outputId: recipe.outputId, name: recipe.label ?? recipe.outputId })),
          ]
          : [];
        const victoryRecord = victories[profile.id];
        const victoryCount = Math.max(0, Math.trunc(
          typeof victoryRecord === 'number' ? victoryRecord : victoryRecord?.count,
        ) || 0);
        return {
          id: profile.id,
          title: profile.title,
          roleClue: profile.roleClue,
          selected: profile.id === selectedBossProfileId,
          discovered,
          material: discovered && material ? { ...material } : null,
          ownedCount: discovered && material ? this.rollSalvageStorage?.getPartCount?.(material.id) ?? 0 : null,
          linkedRecipes: discovered ? linkedRecipes : [],
          victoryCount,
          firstClearAvailable: victoryCount === 0,
          repeatStatus: victoryCount === 0
            ? 'First victory guaranteed'
            : profile.id === ASCENSION_ENGINE_PROFILE_ID
              ? `Repeat recovery: ${Math.round(BOSS_HUNT_REPEAT_REWARD_CHANCE * 100)}%`
              : `Repeat recovery: ${Math.round(BOSS_HUNT_REPEAT_REWARD_CHANCE * 100)}% · overload guarantees`,
          portraitUrl: `./assets/textures/reaverbots/bosses/${profile.id}/hunt-portrait.png`,
        };
      }),
    };
  }

  _transitionWorldLifecycleTo(nextState) {
    if (!this.worldLifecycle) {
      this.worldLifecycle = createWorldLifecycleState(this.transitionState ?? this.worldKind);
    }
    const previousState = this.transitionState;
    this.transitionState = this.worldLifecycle.transitionTo(nextState);
    this._recordWorldLifecycleEvent('transition', {
      from: previousState,
      to: this.transitionState,
    });
    return this.transitionState;
  }

  _recordWorldLifecycleEvent(event, details = {}) {
    if (!Array.isArray(this.worldLifecycleEventLog)) this.worldLifecycleEventLog = [];
    const entry = Object.freeze({
      sequence: this.worldLifecycleEventSequence ?? this.worldLifecycleEventLog.length,
      event,
      ...details,
      worldKind: this.worldKind,
      generationCount: this.worldGenerationCount,
      disposalCount: this.worldDisposalCount,
    });
    this.worldLifecycleEventSequence = entry.sequence + 1;
    this.worldLifecycleEventLog.push(entry);
    if (this.worldLifecycleEventLog.length > 64) {
      this.worldLifecycleEventLog.splice(0, this.worldLifecycleEventLog.length - 64);
    }
    return entry;
  }

  openBossExpeditionPrompt() {
    if (!this.usesStreamedWorldLifecycle
      || this.worldKind !== 'overworld'
      || this.transitionState !== 'overworld') {
      return { ok: false, reason: 'wrong-world' };
    }
    const interrupted = this.busterLabStorage?.getActiveBossExpedition?.();
    if (isInterruptedExpeditionRecord(interrupted)) {
      this.initializeInterruptedExpeditionRecovery();
      return {
        ok: false,
        reason: 'interrupted-expedition-active',
        message: 'Resolve the interrupted expedition before choosing another Boss Hunt.',
      };
    }
    this.stagedBossProfileId = null;
    this.keys.clear();
    this.ui?.openBossExpeditionPrompt?.();
    return { ok: true };
  }

  async stageBossExpedition(profileId) {
    if (!this.usesStreamedWorldLifecycle
      || this.worldKind !== 'overworld'
      || this.transitionState !== 'overworld') {
      return { ok: false, reason: 'wrong-world' };
    }
    const normalized = normalizeBossProfileId(profileId);
    if (normalized !== profileId) return { ok: false, reason: 'unknown-boss-profile' };
    this.stagedBossProfileId = normalized;
    return { ok: true, stagedProfileId: normalized };
  }

  cancelBossExpeditionPrompt() {
    if (this.transitionState !== 'overworld') return { ok: false, reason: 'transition-active' };
    this.stagedBossProfileId = null;
    return { ok: true };
  }

  _prepareStreamedDungeonFacade(bundle) {
    const dungeon = bundle.facade;
    for (const name of ['minimalHubTown', 'minimalExpeditionCamp']) {
      const obsolete = dungeon.group?.getObjectByName?.(name);
      if (obsolete) {
        obsolete.visible = false;
        obsolete.userData.streamedExteriorDisabled = true;
      }
    }
    const obsoleteActions = new Set(['garage', 'roll', 'resetRuin', 'enterRuin', 'expedition']);
    dungeon.safeInteractables = (dungeon.safeInteractables ?? [])
      .filter(({ action }) => !obsoleteActions.has(action));
    dungeon.solidZones = (dungeon.solidZones ?? []).filter(({ id }) => (
      id !== 'expeditionSupportCarCollision' && id !== 'rollWorkshopWorkbenchCollision'
    ));
    // The legacy exterior camp's four practice decks are authored outside the
    // ruin entrance and are irrelevant once V1 is streamed as an interior-only
    // bundle. Unlike Roll and the Support Car they are attached directly to the
    // dungeon root, so hiding the legacy camp group alone leaves their meshes
    // and collision volumes behind. Remove their runtime collision and hide the
    // matching bodies/lips without changing DungeonGenerator itself.
    const obsoleteCampPlatformIds = new Set(
      (dungeon.platforms ?? [])
        .filter(({ id }) => /^camp(?:LowJump|HighClimb|HighGap|Return)/.test(id ?? ''))
        .map(({ id }) => id),
    );
    if (obsoleteCampPlatformIds.size) {
      dungeon.platforms = (dungeon.platforms ?? [])
        .filter(({ id }) => !obsoleteCampPlatformIds.has(id));
      dungeon.group?.traverse?.((object) => {
        if (![...obsoleteCampPlatformIds].some((id) => object.name?.startsWith(id))) return;
        object.visible = false;
        object.userData.streamedExteriorDisabled = true;
      });
    }

    let entranceDoor = dungeon.doors?.find?.(({ id }) => id === 'entranceDoor') ?? null;
    if (entranceDoor) {
      entranceDoor.closed = true;
      entranceDoor.opened = false;
      entranceDoor.locked = true;
      entranceDoor.interactionDisabled = true;
      entranceDoor.collisionHeight = STREAMED_DUNGEON_DOOR_HEIGHT;
      for (const panel of [entranceDoor.leftPanel, entranceDoor.rightPanel]) {
        if (!panel) continue;
        panel.scale.y = STREAMED_DUNGEON_DOOR_HEIGHT / 4.8;
        panel.position.y = STREAMED_DUNGEON_DOOR_HEIGHT * 0.5;
      }
      entranceDoor.object.userData.streamedEntranceSeal = true;
      entranceDoor.object.userData.closed = true;
    }

    const spawn = dungeon.ruinEntryPosition?.clone?.()
      ?? dungeon.playerStart?.clone?.()
      ?? new THREE.Vector3();
    // Conventional V1 already exposes a tested, authored spawn in the centre
    // of its entrance chamber. Do not replace it with a point just inside the
    // exterior threshold: that connector contains elevation transitions that
    // can strand a newly streamed-in player before they reach the chamber.
    // Retaining the authored spawn also leaves the V1 door, threshold wings,
    // and their colliders on the actual room boundary instead of opening it.
    const entryFacing = dungeon.ruinEntryFacing?.clone?.()
      ?? new THREE.Vector3(0, 0, 1);
    entryFacing.setY(0);
    if (entryFacing.lengthSq() <= 0.0001) entryFacing.set(0, 0, 1);
    entryFacing.normalize();

    {
      // Streamed play starts at the authored safe checkpoint, while V1's
      // original entrance door can be separated from that checkpoint by its
      // now-disabled exterior camp connector. Put one visible, full-height
      // seal directly behind every streamed spawn so the door the player sees,
      // collides with, and uses to return is always the same physical object.
      const specializedEntry = dungeon.dungeonKind === 'ascensionReliquary';
      const sealPosition = spawn.clone().addScaledVector(entryFacing, -2.55);
      const yaw = Math.atan2(entryFacing.x, entryFacing.z);
      const seal = new THREE.Group();
      seal.name = specializedEntry
        ? 'streamedAscensionEntranceSeal'
        : 'streamedDungeonEntranceSeal';
      seal.position.copy(sealPosition);
      seal.rotation.y = yaw;
      seal.userData.streamedEntranceSeal = true;
      seal.userData.closed = true;
      // The streamed seal is intentionally wide enough to close the entire
      // entrance-room cross section. Treat it as one camera-occlusion owner so
      // a camera placed outside/behind the seal never leaves an opaque wing
      // between itself and MegaMan.
      seal.userData.cameraOcclusionOwner = true;
      const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0x43545f, roughness: 0.56, metalness: 0.48,
      });
      const panelMaterial = new THREE.MeshStandardMaterial({
        color: 0x1f303a, roughness: 0.62, metalness: 0.5,
      });
      const entranceRoom = dungeon.rooms?.find?.(({ id }) => id === (dungeon.entranceRoomId ?? 'entrance'))
        ?? dungeon.rooms?.find?.(({ id }) => id === 'entrance')
        ?? null;
      const crossTileCount = Math.abs(entryFacing.z) >= Math.abs(entryFacing.x)
        ? entranceRoom?.width
        : entranceRoom?.depth;
      const sealCrossWidth = specializedEntry
        ? 7.4
        : Math.max(12, (crossTileCount ?? 9) * (dungeon.tileSize ?? 5.6));
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(6.4, STREAMED_DUNGEON_DOOR_HEIGHT, 0.5),
        panelMaterial,
      );
      slab.name = 'streamedAscensionEntranceSlab';
      slab.position.y = STREAMED_DUNGEON_DOOR_HEIGHT * 0.5;
      slab.castShadow = true;
      slab.receiveShadow = true;
      seal.add(slab);
      const wingWidth = Math.max(0, (sealCrossWidth - 6.4) * 0.5);
      if (wingWidth > 0.01) {
        for (const side of [-1, 1]) {
          const wing = new THREE.Mesh(
            new THREE.BoxGeometry(wingWidth, STREAMED_DUNGEON_DOOR_HEIGHT, 0.5),
            frameMaterial,
          );
          wing.name = 'streamedEntranceSealWing';
          wing.position.set(side * (3.2 + wingWidth * 0.5), STREAMED_DUNGEON_DOOR_HEIGHT * 0.5, 0);
          wing.castShadow = true;
          wing.receiveShadow = true;
          seal.add(wing);
        }
      }
      for (const x of [-3.45, 3.45]) {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.48, STREAMED_DUNGEON_DOOR_HEIGHT + 0.8, 0.72),
          frameMaterial,
        );
        post.position.set(x, STREAMED_DUNGEON_DOOR_HEIGHT * 0.5, 0);
        post.castShadow = true;
        seal.add(post);
      }
      for (const y of [2.4, 5.1, 7.8, 10.5, 13.2]) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(6.1, 0.16, 0.12), frameMaterial);
        rib.position.set(0, y, 0.31);
        seal.add(rib);
      }
      dungeon.group.add(seal);
      const collision = {
        id: specializedEntry
          ? 'streamedAscensionEntranceSealCollision'
          : 'streamedDungeonEntranceSealCollision',
        roomId: specializedEntry ? 'ascensionReliquary' : (dungeon.entranceRoomId ?? 'entrance'),
        label: 'sealed entrance',
        position: sealPosition.clone().setY(sealPosition.y + STREAMED_DUNGEON_DOOR_HEIGHT * 0.5),
        halfWidth: sealCrossWidth * 0.5,
        halfDepth: 0.38,
        verticalHalfHeight: STREAMED_DUNGEON_DOOR_HEIGHT * 0.5,
        rotationY: yaw,
      };
      dungeon.solidZones.push(collision);
      entranceDoor = {
        id: specializedEntry
          ? 'streamedAscensionEntranceDoor'
          : 'streamedDungeonEntranceDoor',
        label: 'Sealed Entrance',
        position: sealPosition.clone(),
        baseY: sealPosition.y,
        object: seal,
        closed: true,
        opened: false,
        locked: true,
        interactionDisabled: true,
        collisionHeight: STREAMED_DUNGEON_DOOR_HEIGHT,
      };
      dungeon.doors.push(entranceDoor);
    }
    const sealPosition = entranceDoor?.position?.clone?.() ?? spawn.clone();
    const inward = spawn.clone().sub(sealPosition).setY(0);
    if (inward.lengthSq() <= 0.0001) inward.copy(entryFacing);
    inward.normalize();
    const entryReturnAnchor = sealPosition.clone().addScaledVector(inward, 0.9);
    entryReturnAnchor.y = entranceDoor?.baseY ?? spawn.y;
    // Abandonment is available only at the physical inside face of the sealed
    // entrance. The player must walk back to it; spawning in the entrance
    // chamber never opens the confirmation by itself.
    dungeon.safeInteractables.push({
      id: 'streamedDungeonEntranceReturn',
      label: 'Sealed Entrance',
      action: 'abandonRuin',
      position: entryReturnAnchor.clone(),
      object: entranceDoor?.object ?? dungeon.group,
      color: 0x7df8ff,
      interactionRadius: 1.35,
    });
    bundle.entrySpawn = spawn;
    bundle.entryFacing = entryFacing;
    bundle.entranceDoor = entranceDoor;
    bundle.entryReturnAnchor = entryReturnAnchor;
    bundle.collisionData = dungeon.solidZones;
    return bundle;
  }

  _disposeWorldBundle(bundle, reason = 'world-transition', {
    clearRunState = bundle === this.activeWorldBundle,
  } = {}) {
    if (!bundle || bundle.disposed) return this.lastWorldDisposalStats;
    if (clearRunState) this._clearDungeonRunState();
    const connectorTrackTrapDisposal = Object.freeze({
      trapCount: bundle.connectorTrackTrapRuntime?.traps?.length ?? 0,
      activeVisualCount: bundle.connectorTrackTrapVisualFactory?.instances?.size ?? 0,
      visualLoadCount: bundle.connectorTrackTrapVisualFactory?.loadCount ?? 0,
    });
    bundle.connectorTrackTrapRuntime?.dispose?.();
    bundle.connectorTrackTrapVisualFactory?.dispose?.();
    if (this.connectorTrackTrapRuntime === bundle.connectorTrackTrapRuntime) {
      this.connectorTrackTrapRuntime = null;
    }
    bundle.connectorLiftRuntime?.dispose?.();
    if (this.connectorLiftRuntime === bundle.connectorLiftRuntime) {
      this.connectorLiftRuntime = null;
    }
    bundle.controller?.dispose?.();
    bundle.facade?.specialEnvironment?.dispose?.();
    for (const animator of bundle.npcAnimators) animator.dispose?.();
    const disposedOwners = new Set([
      bundle.controller,
      bundle.facade?.specialEnvironment,
      ...bundle.npcAnimators,
    ]);
    for (const resource of bundle.disposableResources) {
      if (!disposedOwners.has(resource)) resource?.dispose?.();
    }
    bundle.root?.removeFromParent?.();
    const stats = bundle.worldKind === 'overworld'
      ? disposeOverworldFacade(bundle.facade)
      : this._disposeDetachedDungeonResources(bundle.root);
    bundle.disposed = true;
    this.worldDisposalCount += 1;
    this.lastWorldDisposalStats = Object.freeze({
      reason,
      worldKind: bundle.worldKind,
      ...stats,
      connectorTrackTrapDisposal,
    });
    this._recordWorldLifecycleEvent('bundle-disposed', {
      disposedWorldKind: bundle.worldKind,
      reason,
    });
    this.lastDungeonResourceDisposalStats = this.lastWorldDisposalStats;
    return this.lastWorldDisposalStats;
  }

  _installRuntimeControllerForBundle(bundle) {
    const controller = bundle.controller ?? (bundle.worldKind === 'overworld'
      ? new OverworldRuntimeController(this, bundle.facade)
      : new DungeonController(this, bundle.facade));
    bundle.controller = controller;
    return this._activateRuntimeControllerForBundle(bundle);
  }

  _activateRuntimeControllerForBundle(bundle) {
    assertLoadedWorldBundle(bundle, { requireController: true });
    const controller = bundle.controller;
    if (!controller) throw new Error(`World bundle ${bundle.worldKind} has no runtime controller.`);
    this.dungeonController = controller;
    this.overworldController = bundle.worldKind === 'overworld' ? controller.core : null;
    this.player.powerKnockbackTravelResolver = ({ fromPosition, position }) => (
      this.dungeonController.resolvePowerKnockbackTravel(fromPosition, position)
    );
    this.player.powerKnockbackLandingResolver = ({ position, direction, originPosition }) => (
      this.dungeonController.resolvePowerKnockbackLanding(position, direction, originPosition)
    );
    this._activateConnectorLiftRuntimeForBundle(bundle);
    this._activateConnectorTrackTrapRuntimeForBundle(bundle);
    return controller;
  }

  _activateConnectorLiftRuntimeForBundle(bundle = this.activeWorldBundle) {
    const previous = this.connectorLiftRuntime;
    const nextFacade = bundle?.worldKind === 'dungeon' ? bundle.facade : null;
    let next = bundle?.connectorLiftRuntime ?? null;

    if (next?.disposed) {
      next = null;
      bundle.connectorLiftRuntime = null;
    }
    if (!next && (nextFacade?.connectorLifts?.length ?? 0) > 0) {
      next = new DungeonConnectorLiftRuntime(this, nextFacade);
      bundle.connectorLiftRuntime = next;
    }
    if (previous && previous !== next) previous.unmount?.();
    this.connectorLiftRuntime = next;
    next?.mount?.(this);
    return next;
  }

  _replaceConnectorLiftRuntimeForDungeon(dungeon = this.dungeon) {
    const previous = this.connectorLiftRuntime;
    previous?.dispose?.();
    if (this.activeWorldBundle?.connectorLiftRuntime === previous) {
      this.activeWorldBundle.connectorLiftRuntime = null;
    }
    this.connectorLiftRuntime = null;
    if (this.worldKind !== 'dungeon' || (dungeon?.connectorLifts?.length ?? 0) === 0) {
      return null;
    }
    const runtime = new DungeonConnectorLiftRuntime(this, dungeon);
    runtime.mount(this);
    this.connectorLiftRuntime = runtime;
    if (this.activeWorldBundle?.worldKind === 'dungeon') {
      this.activeWorldBundle.connectorLiftRuntime = runtime;
    }
    return runtime;
  }

  requestConnectorLift(liftId, endpoint) {
    return this.connectorLiftRuntime?.requestLift?.(liftId, endpoint)
      ?? { ok: false, reason: 'connector-lift-runtime-unavailable' };
  }

  getConnectorLiftDiagnostics() {
    return this.connectorLiftRuntime?.getDiagnostics?.() ?? Object.freeze({
      mounted: false,
      disposed: false,
      liftCount: 0,
      lifts: Object.freeze([]),
    });
  }

  _isStandardLegacyDungeonFacade(facade) {
    return Boolean(
      facade
      && facade.dungeonKind !== 'ascensionReliquary'
      && !facade.specialEnvironment
      && Array.isArray(facade.connectorTrackTraps),
    );
  }

  async _prepareConnectorTrackTrapVisualAcceptanceForBundle(bundle) {
    const facade = bundle?.worldKind === 'dungeon' ? bundle.facade : null;
    if (!this._isStandardLegacyDungeonFacade(facade)
      || (facade.connectorTrackTraps?.length ?? 0) === 0) {
      return Object.freeze({ required: false, accepted: true, trapCount: 0 });
    }

    let runtime = bundle.connectorTrackTrapRuntime ?? null;
    if (!runtime || runtime.disposed) {
      const visualFactory = new DungeonConnectorTrapVisualFactory();
      runtime = new DungeonConnectorTrapRuntime(this, facade, {
        visualFactory,
        visualRoot: facade.group,
        ownsVisualFactory: true,
      });
      bundle.connectorTrackTrapVisualFactory = visualFactory;
      bundle.connectorTrackTrapRuntime = runtime;
    }
    runtime.mount(this, {
      visualFactory: bundle.connectorTrackTrapVisualFactory ?? runtime.visualFactory,
      visualRoot: facade.group,
    });
    try {
      await runtime.whenVisualsReady({ requireVisualAcceptance: true });
    } catch (error) {
      this._recordWorldLifecycleEvent('connector-track-trap-visual-acceptance-failed', {
        message: error?.message ?? String(error),
        trapCount: facade.connectorTrackTraps.length,
      });
      throw error;
    }
    return Object.freeze({
      required: true,
      accepted: true,
      trapCount: facade.connectorTrackTraps.length,
    });
  }

  _activateConnectorTrackTrapRuntimeForBundle(bundle = this.activeWorldBundle) {
    const previous = this.connectorTrackTrapRuntime;
    const nextFacade = bundle?.worldKind === 'dungeon' ? bundle.facade : null;
    const eligible = this._isStandardLegacyDungeonFacade(nextFacade)
      && (nextFacade.connectorTrackTraps?.length ?? 0) > 0;
    let next = eligible ? bundle?.connectorTrackTrapRuntime ?? null : null;

    if (next?.disposed) {
      next = null;
      bundle.connectorTrackTrapRuntime = null;
      bundle.connectorTrackTrapVisualFactory = null;
    }
    if (!next && eligible) {
      const visualFactory = new DungeonConnectorTrapVisualFactory();
      next = new DungeonConnectorTrapRuntime(this, nextFacade, {
        visualFactory,
        visualRoot: nextFacade.group,
        ownsVisualFactory: true,
      });
      bundle.connectorTrackTrapVisualFactory = visualFactory;
      bundle.connectorTrackTrapRuntime = next;
    }
    if (previous && previous !== next) previous.unmount?.();
    this.connectorTrackTrapRuntime = next;
    next?.mount?.(this, {
      visualFactory: bundle?.connectorTrackTrapVisualFactory ?? next?.visualFactory,
      visualRoot: nextFacade?.group,
    });
    return next;
  }

  _replaceConnectorTrackTrapRuntimeForDungeon(dungeon = this.dungeon) {
    const previous = this.connectorTrackTrapRuntime;
    previous?.dispose?.();
    if (this.activeWorldBundle?.connectorTrackTrapRuntime === previous) {
      this.activeWorldBundle.connectorTrackTrapRuntime = null;
      this.activeWorldBundle.connectorTrackTrapVisualFactory = null;
    }
    this.connectorTrackTrapRuntime = null;
    if (
      this.worldKind !== 'dungeon'
      || !this._isStandardLegacyDungeonFacade(dungeon)
      || (dungeon?.connectorTrackTraps?.length ?? 0) === 0
    ) {
      return null;
    }
    const visualFactory = new DungeonConnectorTrapVisualFactory();
    const runtime = new DungeonConnectorTrapRuntime(this, dungeon, {
      visualFactory,
      visualRoot: dungeon.group,
      ownsVisualFactory: true,
    });
    runtime.mount(this);
    this.connectorTrackTrapRuntime = runtime;
    if (this.activeWorldBundle?.worldKind === 'dungeon') {
      this.activeWorldBundle.connectorTrackTrapRuntime = runtime;
      this.activeWorldBundle.connectorTrackTrapVisualFactory = visualFactory;
    }
    return runtime;
  }

  getConnectorTrackTrapDiagnostics() {
    const runtime = this.connectorTrackTrapRuntime;
    const runtimeDiagnostics = runtime?.getDiagnostics?.() ?? Object.freeze({
      mounted: false,
      disposed: false,
      trapCount: 0,
      invalidDescriptorCount: 0,
      traps: Object.freeze([]),
    });
    const visualFactory = this.activeWorldBundle?.connectorTrackTrapVisualFactory
      ?? runtime?.visualFactory
      ?? null;
    return Object.freeze({
      ...runtimeDiagnostics,
      visual: visualFactory?.getDiagnostics?.() ?? Object.freeze({
        loaded: false,
        loadCount: 0,
        activeInstanceCount: 0,
        loadError: null,
        disposed: false,
      }),
    });
  }

  _disposeUncommittedWorldCandidate(bundle) {
    if (!bundle || bundle.disposed) return null;
    bundle.connectorTrackTrapRuntime?.dispose?.();
    bundle.connectorTrackTrapVisualFactory?.dispose?.();
    if (this.connectorTrackTrapRuntime === bundle.connectorTrackTrapRuntime) {
      this.connectorTrackTrapRuntime = null;
    }
    bundle.connectorLiftRuntime?.dispose?.();
    if (this.connectorLiftRuntime === bundle.connectorLiftRuntime) {
      this.connectorLiftRuntime = null;
    }
    bundle.controller?.dispose?.();
    bundle.facade?.specialEnvironment?.dispose?.();
    for (const animator of bundle.npcAnimators) animator.dispose?.();
    const disposedOwners = new Set([
      bundle.controller,
      bundle.facade?.specialEnvironment,
      ...bundle.npcAnimators,
    ]);
    for (const resource of bundle.disposableResources) {
      if (!disposedOwners.has(resource)) resource?.dispose?.();
    }
    bundle.root?.removeFromParent?.();
    const stats = bundle.worldKind === 'overworld'
      ? disposeOverworldFacade(bundle.facade)
      : this._disposeDetachedDungeonResources(bundle.root);
    bundle.disposed = true;
    return stats;
  }

  _placePersistentPlayer(position, facing) {
    this.player.root.position.copy(position);
    this.player.velocity?.set?.(0, 0, 0);
    this.player.lastMoveDirection.copy(facing ?? tempVectorA.set(0, 0, 1)).setY(0);
    if (this.player.lastMoveDirection.lengthSq() < 0.0001) this.player.lastMoveDirection.set(0, 0, 1);
    this.player.lastMoveDirection.normalize();
    this.player.faceDirection(this.player.lastMoveDirection);
    this.dungeonController?.lastSafePlayerPosition?.copy?.(this.player.root.position);
    this.cameraController.snapTo(this.player);
  }

  _animateExteriorDungeonDoorOpening(bundle, { durationMs = 360 } = {}) {
    const slab = bundle?.root?.getObjectByName?.('overworldDungeonDoorSlab');
    if (!slab) return Promise.resolve(null);
    const startY = slab.position.y;
    const lift = 5.8;
    slab.userData.transitionOpening = true;
    return new Promise((resolve) => {
      const started = performance.now();
      const step = (now) => {
        const amount = THREE.MathUtils.clamp((now - started) / durationMs, 0, 1);
        const eased = 1 - (1 - amount) ** 3;
        slab.position.y = startY + lift * eased;
        if (amount >= 1) {
          resolve({ slab, startY });
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  async resumeInterruptedExpedition({ resetToCurrentContent = false } = {}) {
    if (this.interruptedExpeditionRecoveryInFlight) {
      return this.interruptedExpeditionRecoveryInFlight;
    }
    if (this.worldTransitionInFlight) return this.worldTransitionInFlight;
    if (!this.usesStreamedWorldLifecycle
      || this.worldKind !== 'overworld'
      || this.transitionState !== 'overworld') {
      return { ok: false, reason: 'wrong-world' };
    }
    const promptedExpeditionId = this.interruptedExpeditionRecovery?.expeditionId ?? null;
    const conflictReload = this._reloadInterruptedExpeditionStateAfterExternalConflict();
    if (conflictReload) {
      const refreshed = await conflictReload;
      if (!refreshed?.ok) {
        return {
          ok: false,
          reason: refreshed?.reason ?? 'storage-reload-failed',
          message: refreshed?.message
            ?? refreshed?.warning
            ?? 'The updated expedition save could not be reloaded.',
        };
      }
    }
    const persisted = this.busterLabStorage?.getActiveBossExpedition?.();
    if (!isInterruptedExpeditionRecord(persisted)) {
      return this._resolveInterruptedExpeditionPromptAfterExternalChange('already-resolved');
    }
    const changedPrompt = this._refreshInterruptedExpeditionPromptIfIdentityChanged(
      promptedExpeditionId,
      persisted,
    );
    if (changedPrompt) return changedPrompt;
    const profileId = normalizeBossProfileId(persisted.bossProfileId);
    if (profileId !== persisted.bossProfileId) {
      return { ok: false, reason: 'invalid-boss-profile' };
    }
    const layoutSeed = String(
      persisted.dungeonLayoutSeed
        ?? `layout:resume:${this.busterLabStorage?.saveContextId ?? 'prototype'}:${persisted.expeditionId}`,
    );
    const expeditionDepth = Math.max(1, Math.min(10, Math.round(Number(persisted.depth) || 1)));
    const previousBundle = this.activeWorldBundle;
    const previousProfileId = this.getSelectedBossProfileId();
    const previousLayoutSeed = this.dungeonLayoutSeed;
    const previousRuinFloor = this.ruinFloor;
    const previousDungeonFamilyId = this.dungeonFamilyId;
    const previousExpeditionSpec = this.activeBossExpeditionSpec;
    const previousSpawner = this.spawner;
    const previousMapEvents = this.mapEvents;
    const previousPlayerPosition = this.player.root.position.clone();
    const previousPlayerFacing = this.player.lastMoveDirection.clone();
    const previousPlayerVelocity = this.player.velocity?.clone?.() ?? null;
    const previousExpeditionAccepted = this.expeditionAccepted;
    const previousExpeditionActive = this.expeditionActive;
    const previousRuinCompleted = this.ruinCompleted;

    const transaction = (async () => {
      this.interruptedExpeditionRecoveryState = 'restarting';
      this._recordWorldLifecycleEvent(
        resetToCurrentContent
          ? 'interrupted-expedition-content-reset-began'
          : 'interrupted-expedition-restart-began',
        {
          expeditionId: persisted.expeditionId,
          bossProfileId: profileId,
        },
      );
      this._transitionWorldLifecycleTo('enteringDungeon');
      let candidate = null;
      let candidateMounted = false;
      let exteriorDoorAnimation = null;
      let committed = false;
      try {
        this.selectedBossProfileId = profileId;
        this.ruinFloor = expeditionDepth;
        this.dungeonFamilyId = persisted.dungeonFamilyId ?? INDUSTRIAL_DUNGEON_FAMILY_ID;
        candidate = this._createLegacyDungeonWorldCandidate({
          bossProfileId: profileId,
          layoutSeed,
          difficulty: expeditionDepth,
          dungeonFamilyId: persisted.dungeonFamilyId ?? INDUSTRIAL_DUNGEON_FAMILY_ID,
          dungeonAugmentation: resetToCurrentContent
            ? undefined
            : persisted.dungeonAugmentation ?? null,
        });
        candidate = this._prepareStreamedDungeonFacade(candidate);
        // A trapped connector is accepted only after the supplied OBJ/PNG is
        // actually mounted on every plan-owned hazard. Do this while the
        // intact overworld is still available for rollback and before durable
        // expedition state is changed.
        await this._prepareConnectorTrackTrapVisualAcceptanceForBundle(candidate);
        this.activeBossExpeditionSpec = null;
        const encounter = this._configureBossHuntEncounter(candidate.facade, {
          restartFromBeginning: persisted.status === 'active',
          overridePersistedDungeonAugmentation: resetToCurrentContent,
          dungeonAugmentation: candidate.facade.augmentationIdentity ?? null,
        });
        if (!encounter?.expeditionSpec
          || encounter.expeditionSpec.id !== persisted.expeditionId) {
          throw new Error('The interrupted boss encounter could not be reconstructed.');
        }
        candidate.controller = new DungeonController(this, candidate.facade);

        exteriorDoorAnimation = await this._animateExteriorDungeonDoorOpening(previousBundle);
        this._clearDungeonRunState();
        this.keys.clear();
        previousBundle?.root?.removeFromParent?.();
        this._assignMountedWorldBundle(candidate, { incrementGeneration: false });
        candidateMounted = true;
        this._installRuntimeControllerForBundle(candidate);
        this.bossStageRuntime?.mount?.(this);
        this._placePersistentPlayer(candidate.entrySpawn, candidate.entryFacing);
        this.spawner = new EnemySpawner(this);
        this.mapEvents = this._createMapEventSystemForWorld();
        this.spawner.spawnInitialPack();
        this._collectCameraOcclusionWalls();
        this._collectDungeonRenderCullGroups();
        this._rebuildDebugLedgeTester(candidate.entrySpawn);
        this._updateDungeonRenderCulling(0, { force: true });

        // Reset the durable attempt only after every fallible generation,
        // controller, mount, spawn, and camera step has succeeded. A failure
        // before this point leaves the exact stored checkpoint untouched.
        const recoveryOperation = resetToCurrentContent
          ? this.busterLabStorage?.resetActiveBossExpeditionDungeonContent
          : this.busterLabStorage?.restartActiveBossExpedition;
        if (!recoveryOperation) throw new Error('Interrupted expedition recovery is unavailable.');
        const restarted = await this._queueBusterStorageOperation(() => (
          resetToCurrentContent
            ? recoveryOperation.call(this.busterLabStorage, {
                expeditionId: persisted.expeditionId,
                bossProfileId: profileId,
                seed: persisted.seed,
                depth: expeditionDepth,
                dungeonLayoutSeed: layoutSeed,
                dungeonFamilyId: persisted.dungeonFamilyId ?? INDUSTRIAL_DUNGEON_FAMILY_ID,
                expectedDungeonAugmentation: persisted.dungeonAugmentation ?? null,
                dungeonAugmentation: candidate.facade.augmentationIdentity ?? null,
              })
            : recoveryOperation.call(this.busterLabStorage, {
                expeditionId: persisted.expeditionId,
                bossProfileId: profileId,
                seed: persisted.seed,
                depth: expeditionDepth,
                dungeonLayoutSeed: layoutSeed,
                dungeonFamilyId: persisted.dungeonFamilyId ?? INDUSTRIAL_DUNGEON_FAMILY_ID,
                dungeonAugmentation: persisted.dungeonAugmentation ?? null,
              })
        ));
        if (!restarted?.ok) {
          throw new Error(
            restarted?.message
              ?? `The interrupted expedition could not be restarted (${restarted?.reason ?? 'unknown'}).`,
          );
        }
        this.dungeonLayoutSeed = layoutSeed;
        this.ruinCompleted = false;
        this.expeditionAccepted = true;
        this.expeditionActive = true;
        this.stagedBossProfileId = null;
        this.interruptedExpeditionRecovery = null;
        this.interruptedExpeditionRecoveryState = 'none';
        this._transitionWorldLifecycleTo('dungeon');
        committed = true;
        this.worldGenerationCount += 1;
        this._recordWorldLifecycleEvent(
          resetToCurrentContent
            ? 'interrupted-expedition-content-reset'
            : 'interrupted-expedition-restarted',
          {
            expeditionId: persisted.expeditionId,
            bossProfileId: profileId,
            dungeonLayoutSeedHash: hashSeed(layoutSeed),
          },
        );
        try {
          this._disposeWorldBundle(previousBundle, 'restart-interrupted-expedition', {
            clearRunState: false,
          });
        } catch (cleanupError) {
          this._recordWorldLifecycleEvent('post-commit-cleanup-error', {
            phase: 'restart-interrupted-expedition',
            message: cleanupError?.message ?? String(cleanupError),
          });
        }
        this.ui?.renderInventory?.();
        return {
          ok: true,
          worldKind: 'dungeon',
          expeditionId: persisted.expeditionId,
          bossProfileId: profileId,
          contentReset: resetToCurrentContent,
        };
      } catch (error) {
        if (committed) {
          return {
            ok: true,
            worldKind: 'dungeon',
            expeditionId: persisted.expeditionId,
            bossProfileId: profileId,
            warning: error?.message ?? String(error),
          };
        }
        if (exteriorDoorAnimation?.slab && previousBundle && !previousBundle.disposed) {
          exteriorDoorAnimation.slab.position.y = exteriorDoorAnimation.startY;
          exteriorDoorAnimation.slab.userData.transitionOpening = false;
        }
        if (candidateMounted) this._clearDungeonRunState();
        if (candidate) {
          try {
            this._disposeUncommittedWorldCandidate(candidate);
          } catch (cleanupError) {
            this._recordWorldLifecycleEvent('rollback-cleanup-error', {
              phase: 'restart-interrupted-expedition',
              message: cleanupError?.message ?? String(cleanupError),
            });
          }
        }
        if (previousBundle && !previousBundle.disposed) {
          this._assignMountedWorldBundle(previousBundle, { incrementGeneration: false });
          this._activateRuntimeControllerForBundle(previousBundle);
          this.spawner = previousSpawner;
          this.mapEvents = previousMapEvents;
          this._placePersistentPlayer(previousPlayerPosition, previousPlayerFacing);
          if (previousPlayerVelocity && this.player.velocity) {
            this.player.velocity.copy(previousPlayerVelocity);
          }
          this._collectCameraOcclusionWalls();
          this._collectDungeonRenderCullGroups();
          this._updateDungeonRenderCulling(0, { force: true });
        }
        this.selectedBossProfileId = previousProfileId;
        this.dungeonLayoutSeed = previousLayoutSeed;
        this.ruinFloor = previousRuinFloor;
        this.dungeonFamilyId = previousDungeonFamilyId;
        this.expeditionAccepted = previousExpeditionAccepted;
        this.expeditionActive = previousExpeditionActive;
        this.ruinCompleted = previousRuinCompleted;
        this.activeBossExpeditionSpec = previousExpeditionSpec;
        this.interruptedExpeditionRecoveryState = 'prompting';
        this._transitionWorldLifecycleTo('overworld');
        this.worldKind = 'overworld';
        const conflictReload = this._reloadInterruptedExpeditionStateAfterExternalConflict();
        if (conflictReload) await conflictReload;
        const durableExpedition = this.busterLabStorage?.getActiveBossExpedition?.();
        if (!isInterruptedExpeditionRecord(durableExpedition)) {
          return this._resolveInterruptedExpeditionPromptAfterExternalChange(
            'resolved-during-restart',
          );
        }
        const changedPrompt = this._refreshInterruptedExpeditionPromptIfIdentityChanged(
          promptedExpeditionId,
          durableExpedition,
        );
        if (changedPrompt) return changedPrompt;
        this._recordWorldLifecycleEvent(
          resetToCurrentContent
            ? 'interrupted-expedition-content-reset-failed'
            : 'interrupted-expedition-restart-failed',
          {
            expeditionId: persisted.expeditionId,
            message: error?.message ?? String(error),
          },
        );
        const augmentationIncompatible = error?.resetOrAbandonRequired === true
          || error?.code === 'DUNGEON_AUGMENTATION_INCOMPATIBLE_CONTENT';
        if (augmentationIncompatible) {
          return {
            ok: false,
            reason: 'incompatible-dungeon-augmentation',
            status: 'incompatible-content',
            resetOrAbandonRequired: true,
            compatibility: error?.compatibility ?? null,
            message: error?.message ?? String(error),
            error,
          };
        }
        return {
          ok: false,
          reason: 'transition-failed',
          message: error?.message ?? String(error),
          error,
        };
      } finally {
        this.worldTransitionInFlight = null;
        this.interruptedExpeditionRecoveryInFlight = null;
      }
    })();
    this.interruptedExpeditionRecoveryInFlight = transaction;
    this.worldTransitionInFlight = transaction;
    return transaction;
  }

  resetInterruptedExpeditionToCurrentContent() {
    return this.resumeInterruptedExpedition({ resetToCurrentContent: true });
  }

  async abandonInterruptedExpedition() {
    if (this.interruptedExpeditionRecoveryInFlight) {
      return this.interruptedExpeditionRecoveryInFlight;
    }
    if (!this.usesStreamedWorldLifecycle
      || this.worldKind !== 'overworld'
      || this.transitionState !== 'overworld') {
      return { ok: false, reason: 'wrong-world' };
    }
    const promptedExpeditionId = this.interruptedExpeditionRecovery?.expeditionId ?? null;
    const conflictReload = this._reloadInterruptedExpeditionStateAfterExternalConflict();
    if (conflictReload) {
      const refreshed = await conflictReload;
      if (!refreshed?.ok) {
        return {
          ok: false,
          reason: refreshed?.reason ?? 'storage-reload-failed',
          message: refreshed?.message
            ?? refreshed?.warning
            ?? 'The updated expedition save could not be reloaded.',
        };
      }
    }
    const persisted = this.busterLabStorage?.getActiveBossExpedition?.();
    if (!isInterruptedExpeditionRecord(persisted)) {
      return this._resolveInterruptedExpeditionPromptAfterExternalChange('already-resolved');
    }
    const changedPrompt = this._refreshInterruptedExpeditionPromptIfIdentityChanged(
      promptedExpeditionId,
      persisted,
    );
    if (changedPrompt) return changedPrompt;
    const transaction = (async () => {
      this.interruptedExpeditionRecoveryState = 'abandoning';
      this._recordWorldLifecycleEvent('interrupted-expedition-abandon-began', {
        expeditionId: persisted.expeditionId,
        bossProfileId: persisted.bossProfileId,
      });
      try {
        if (!this.busterLabStorage?.completeBossExpedition) {
          throw new Error('Interrupted expedition abandonment is unavailable.');
        }
        const result = await this._queueBusterStorageOperation(() => (
          this.busterLabStorage.completeBossExpedition(
            persisted.expeditionId,
            { outcome: 'abandoned' },
          )
        ));
        if (!result?.ok) {
          throw new Error(
            result?.message
              ?? `The expedition could not be abandoned (${result?.reason ?? 'unknown'}).`,
          );
        }
        this.activeBossExpeditionSpec = null;
        this.interruptedExpeditionRecovery = null;
        this.interruptedExpeditionRecoveryState = 'none';
        this.stagedBossProfileId = null;
        this.expeditionAccepted = false;
        this.expeditionActive = false;
        this.ruinCompleted = false;
        this.lastExpeditionSummary = 'Interrupted expedition abandoned. A new Boss Hunt can now be selected.';
        this._recordWorldLifecycleEvent('interrupted-expedition-abandoned', {
          expeditionId: persisted.expeditionId,
          bossProfileId: persisted.bossProfileId,
        });
        this.ui?.renderInventory?.();
        return {
          ok: true,
          worldKind: 'overworld',
          expeditionId: persisted.expeditionId,
          outcome: 'abandoned',
        };
      } catch (error) {
        this.interruptedExpeditionRecoveryState = 'prompting';
        const conflictReload = this._reloadInterruptedExpeditionStateAfterExternalConflict();
        if (conflictReload) await conflictReload;
        const durableExpedition = this.busterLabStorage?.getActiveBossExpedition?.();
        if (!isInterruptedExpeditionRecord(durableExpedition)) {
          return this._resolveInterruptedExpeditionPromptAfterExternalChange(
            'resolved-during-abandonment',
          );
        }
        const changedPrompt = this._refreshInterruptedExpeditionPromptIfIdentityChanged(
          promptedExpeditionId,
          durableExpedition,
        );
        if (changedPrompt) return changedPrompt;
        this._recordWorldLifecycleEvent('interrupted-expedition-abandon-failed', {
          expeditionId: persisted.expeditionId,
          message: error?.message ?? String(error),
        });
        return {
          ok: false,
          reason: 'storage-failed',
          message: error?.message ?? String(error),
          error,
        };
      } finally {
        this.interruptedExpeditionRecoveryInFlight = null;
      }
    })();
    this.interruptedExpeditionRecoveryInFlight = transaction;
    return transaction;
  }

  async confirmBossExpedition() {
    if (this.worldTransitionInFlight) return this.worldTransitionInFlight;
    if (!this.stagedBossProfileId) return { ok: false, reason: 'no-staged-profile' };
    if (this.worldKind !== 'overworld' || this.transitionState !== 'overworld') {
      return { ok: false, reason: 'wrong-world' };
    }
    const profileId = this.stagedBossProfileId;
    const previousBundle = this.activeWorldBundle;
    const previousProfileId = this.getSelectedBossProfileId();
    const previousExpeditionSpec = this.activeBossExpeditionSpec;
    const previousSpawner = this.spawner;
    const previousMapEvents = this.mapEvents;
    const previousPlayerPosition = this.player.root.position.clone();
    const previousPlayerFacing = this.player.lastMoveDirection.clone();
    const previousPlayerVelocity = this.player.velocity?.clone?.() ?? null;
    const previousExpeditionAccepted = this.expeditionAccepted;
    const previousExpeditionActive = this.expeditionActive;
    const previousRuinCompleted = this.ruinCompleted;
    this.worldTransitionInFlight = (async () => {
      this._transitionWorldLifecycleTo('enteringDungeon');
      let candidate = null;
      let candidateMounted = false;
      let lockedExpeditionId = null;
      let exteriorDoorAnimation = null;
      let committed = false;
      try {
        const selection = await this.selectBossHunt(profileId);
        if (!selection?.ok) throw new Error(selection?.message ?? 'Boss Hunt selection could not be saved.');
        // Retain the raw candidate before preparation. If the adapter rejects
        // it, the catch path can still release every detached V1 resource.
        candidate = this._createLegacyDungeonWorldCandidate({ bossProfileId: profileId });
        candidate = this._prepareStreamedDungeonFacade(candidate);
        // Loading/mounting the authored rotor is part of candidate acceptance,
        // not a best-effort post-commit decoration. Failure leaves the camp
        // and its closed door intact and never locks a Boss Hunt.
        await this._prepareConnectorTrackTrapVisualAcceptanceForBundle(candidate);
        this.activeBossExpeditionSpec = null;
        const encounter = this._configureBossHuntEncounter(candidate.facade, { ignorePersistedActive: true });
        if (!encounter?.expeditionSpec) throw new Error('The selected boss encounter could not be configured.');
        candidate.controller = new DungeonController(this, candidate.facade);

        // Candidate generation, streamed-adapter validation, boss setup, and
        // controller construction have all succeeded while the overworld is
        // still mounted. Lock the durable expedition now, before animating the
        // exterior door or swapping either world root. Any later failure uses
        // the compensation path below and restores the intact overworld.
        const lock = this.busterLabStorage?.lockBossHuntForExpedition
          ? await this._queueBusterStorageOperation(() => (
            this.busterLabStorage.lockBossHuntForExpedition(encounter.expeditionSpec)
          ))
          : { ok: true };
        if (!lock?.ok) throw new Error(lock?.message ?? `Boss Hunt lock failed: ${lock?.reason ?? 'unknown'}`);
        lockedExpeditionId = encounter.expeditionSpec.id;

        exteriorDoorAnimation = await this._animateExteriorDungeonDoorOpening(previousBundle);
        // Overworld combat is suppressed, but clear all bundle-local host
        // transients at the commit boundary as a second line of ownership
        // defense. Nothing from camp may resume inside the dungeon.
        this._clearDungeonRunState();
        // Mount and fully initialize the candidate while the intact overworld
        // remains available for rollback. Detaching retains every object and
        // GPU resource, but guarantees the scene never renders both worlds
        // while the durable expedition lock is awaited.
        previousBundle?.root?.removeFromParent?.();
        this._assignMountedWorldBundle(candidate, { incrementGeneration: false });
        candidateMounted = true;
        this._installRuntimeControllerForBundle(candidate);
        this.bossStageRuntime?.mount?.(this);
        this._placePersistentPlayer(candidate.entrySpawn, candidate.entryFacing);
        this.spawner = new EnemySpawner(this);
        this.mapEvents = this._createMapEventSystemForWorld();
        this.spawner.spawnInitialPack();
        this._collectCameraOcclusionWalls();
        this._collectDungeonRenderCullGroups();
        this._rebuildDebugLedgeTester(candidate.entrySpawn);
        this._updateDungeonRenderCulling(0, { force: true });
        this.ruinCompleted = false;
        this.expeditionAccepted = true;
        this.expeditionActive = true;
        this.stagedBossProfileId = null;
        this._transitionWorldLifecycleTo('dungeon');
        committed = true;
        this.worldGenerationCount += 1;
        try {
          this._disposeWorldBundle(previousBundle, 'enter-dungeon', { clearRunState: false });
        } catch (cleanupError) {
          this._recordWorldLifecycleEvent('post-commit-cleanup-error', {
            phase: 'enter-dungeon',
            message: cleanupError?.message ?? String(cleanupError),
          });
        }
        try {
          this.ui?.renderInventory?.();
        } catch (uiError) {
          this._recordWorldLifecycleEvent('post-commit-ui-error', {
            phase: 'enter-dungeon',
            message: uiError?.message ?? String(uiError),
          });
        }
        return { ok: true, worldKind: 'dungeon', bossProfileId: profileId };
      } catch (error) {
        if (committed) {
          this._recordWorldLifecycleEvent('post-commit-transition-error', {
            phase: 'enter-dungeon',
            message: error?.message ?? String(error),
          });
          return {
            ok: true,
            worldKind: 'dungeon',
            bossProfileId: profileId,
            warning: error?.message ?? String(error),
          };
        }
        if (exteriorDoorAnimation?.slab && previousBundle && !previousBundle.disposed) {
          exteriorDoorAnimation.slab.position.y = exteriorDoorAnimation.startY;
          exteriorDoorAnimation.slab.userData.transitionOpening = false;
        }
        if (candidateMounted) this._clearDungeonRunState();
        if (candidate) {
          try {
            this._disposeUncommittedWorldCandidate(candidate);
          } catch (cleanupError) {
            this._recordWorldLifecycleEvent('rollback-cleanup-error', {
              phase: 'enter-dungeon',
              message: cleanupError?.message ?? String(cleanupError),
            });
          }
        }
        if (previousBundle && !previousBundle.disposed) {
          this._assignMountedWorldBundle(previousBundle, { incrementGeneration: false });
          this._activateRuntimeControllerForBundle(previousBundle);
          this.spawner = previousSpawner;
          this.mapEvents = previousMapEvents;
          this._placePersistentPlayer(previousPlayerPosition, previousPlayerFacing);
          if (previousPlayerVelocity && this.player.velocity) {
            this.player.velocity.copy(previousPlayerVelocity);
          }
          this._collectCameraOcclusionWalls();
          this._collectDungeonRenderCullGroups();
          this._updateDungeonRenderCulling(0, { force: true });
        }
        this.expeditionAccepted = previousExpeditionAccepted;
        this.expeditionActive = previousExpeditionActive;
        this.ruinCompleted = previousRuinCompleted;
        this.activeBossExpeditionSpec = previousExpeditionSpec;
        // The mounted overworld and authoritative lifecycle are restored
        // before best-effort durable compensation. A storage outage can be
        // diagnosed, but can never leave the game stuck in enteringDungeon.
        this._transitionWorldLifecycleTo('overworld');
        this.worldKind = 'overworld';
        const rollbackWarnings = [];
        if (lockedExpeditionId && this.busterLabStorage?.completeBossExpedition) {
          try {
            const compensation = await this._queueBusterStorageOperation(() => (
              this.busterLabStorage.completeBossExpedition(
                lockedExpeditionId,
                { outcome: 'abandoned' },
              )
            ));
            if (!compensation?.ok) {
              throw new Error(compensation?.message ?? 'Expedition lock compensation failed.');
            }
          } catch (compensationError) {
            const message = compensationError?.message ?? String(compensationError);
            rollbackWarnings.push(message);
            this._recordWorldLifecycleEvent('rollback-compensation-error', {
              phase: 'expedition-lock',
              message,
            });
          }
        }
        if (this.getSelectedBossProfileId() !== previousProfileId) {
          try {
            const compensation = await this.selectBossHunt(previousProfileId);
            if (!compensation?.ok) {
              throw new Error(compensation?.message ?? 'Boss selection compensation failed.');
            }
          } catch (compensationError) {
            const message = compensationError?.message ?? String(compensationError);
            rollbackWarnings.push(message);
            this._recordWorldLifecycleEvent('rollback-compensation-error', {
              phase: 'boss-selection',
              message,
            });
            // Keep the active in-memory overworld consistent even if durable
            // storage is temporarily unavailable.
            this.selectedBossProfileId = previousProfileId;
          }
        }
        this.activeBossExpeditionSpec = previousExpeditionSpec;
        return {
          ok: false,
          reason: 'transition-failed',
          message: error?.message ?? String(error),
          error,
          rollbackWarnings,
        };
      } finally {
        this.worldTransitionInFlight = null;
      }
    })();
    return this.worldTransitionInFlight;
  }

  openDungeonAbandonPrompt() {
    if (this.worldKind !== 'dungeon' || this.transitionState !== 'dungeon') {
      return { ok: false, reason: 'wrong-world' };
    }
    this.keys.clear();
    const profile = getReaverbotBossProfile(this.getSelectedBossProfileId());
    this.ui?.openDungeonAbandonPrompt?.({
      expeditionLabel: profile?.title ?? 'Boss Hunt',
      description: 'Abandon this expedition and return to Roll? Dungeon-local progress will be lost.',
    });
    return { ok: true };
  }

  cancelDungeonAbandon() {
    return this.transitionState === 'dungeon'
      ? { ok: true }
      : { ok: false, reason: 'transition-active' };
  }

  async _returnToStreamedOverworld({ outcome = 'abandoned' } = {}) {
    if (this.worldTransitionInFlight) return this.worldTransitionInFlight;
    if (this.worldKind !== 'dungeon' || this.transitionState !== 'dungeon') {
      return { ok: false, reason: 'wrong-world' };
    }
    const previousBundle = this.activeWorldBundle;
    const previousSpawner = this.spawner;
    const previousMapEvents = this.mapEvents;
    const previousPlayerPosition = this.player.root.position.clone();
    const previousPlayerFacing = this.player.lastMoveDirection.clone();
    const previousPlayerVelocity = this.player.velocity?.clone?.() ?? null;
    const previousExpeditionAccepted = this.expeditionAccepted;
    const previousExpeditionActive = this.expeditionActive;
    const previousRuinCompleted = this.ruinCompleted;
    const previousExpeditionSpec = this.activeBossExpeditionSpec;
    const previousExpeditionSummary = this.lastExpeditionSummary;
    this.worldTransitionInFlight = (async () => {
      this._transitionWorldLifecycleTo('returningOverworld');
      let candidate = null;
      let committed = false;
      try {
        if (outcome === 'extracted' && previousBundle?.pendingBossVictoryCommit) {
          const victory = await previousBundle.pendingBossVictoryCommit;
          if (victory && !victory.ok) {
            throw new Error(victory.message ?? 'Boss recovery must be saved before extraction.');
          }
        }
        // Candidate construction and controller validation happen before any
        // dungeon-local state or durable expedition record is released.
        candidate = this._createOverworldWorldBundle();
        candidate.controller = new OverworldRuntimeController(this, candidate.facade);
        assertLoadedWorldBundle(candidate, { requireController: true });

        // Keep only one world root visible while the candidate is initialized.
        // The detached dungeon remains intact and can be remounted if any
        // controller, NPC, collision, or storage step fails.
        previousBundle?.root?.removeFromParent?.();
        this._assignMountedWorldBundle(candidate, { incrementGeneration: false });
        this._installRuntimeControllerForBundle(candidate);
        candidate.facade.activateNpcAssets?.();
        this._placePersistentPlayer(candidate.facade.campReturnPosition, candidate.facade.campReturnFacing);
        this.spawner = new EnemySpawner(this);
        this.mapEvents = this._createMapEventSystemForWorld();
        this.expeditionAccepted = false;
        this.expeditionActive = false;
        this.ruinCompleted = false;
        this._collectCameraOcclusionWalls();
        this._collectDungeonRenderCullGroups();
        this._updateDungeonRenderCulling(0, { force: true });

        // Releasing the durable run marker is the last fallible operation.
        // Victory records remain locked until physical extraction or explicit
        // abandonment, so closing after the boss still offers recovery.
        const durableExpeditionId = this.activeBossExpeditionSpec?.id
          ?? this.busterLabStorage?.getActiveBossExpedition?.()?.expeditionId
          ?? null;
        if (['abandoned', 'extracted'].includes(outcome)
          && durableExpeditionId
          && this.busterLabStorage?.completeBossExpedition) {
          const result = await this._queueBusterStorageOperation(() => (
            this.busterLabStorage.completeBossExpedition(
              durableExpeditionId,
              { outcome },
            )
          ));
          if (!result?.ok) {
            throw new Error(result?.message ?? 'The expedition return could not be recorded.');
          }
        }

        // Storage and candidate setup have succeeded. Commit the authoritative
        // lifecycle first; cleanup and UI work after this point can no longer
        // attempt to roll back to a bundle that may already be disposed.
        this.activeBossExpeditionSpec = null;
        this.lastExpeditionSummary = outcome === 'extracted'
          ? 'Expedition complete. Recovered resources are secured.'
          : 'Expedition abandoned. Dungeon-local progress was released.';
        this._transitionWorldLifecycleTo('overworld');
        committed = true;
        this.worldGenerationCount += 1;
        try {
          this._clearDungeonRunState();
          this._disposeWorldBundle(previousBundle, `return-overworld:${outcome}`, { clearRunState: false });
        } catch (cleanupError) {
          this._recordWorldLifecycleEvent('post-commit-cleanup-error', {
            phase: `return-overworld:${outcome}`,
            message: cleanupError?.message ?? String(cleanupError),
          });
        }
        try {
          this.ui?.showToast?.('Returned to expedition camp', '#6bdcff');
          this.ui?.renderInventory?.();
        } catch (uiError) {
          this._recordWorldLifecycleEvent('post-commit-ui-error', {
            phase: `return-overworld:${outcome}`,
            message: uiError?.message ?? String(uiError),
          });
        }
        return { ok: true, worldKind: 'overworld', outcome };
      } catch (error) {
        if (committed) {
          this._recordWorldLifecycleEvent('post-commit-transition-error', {
            phase: `return-overworld:${outcome}`,
            message: error?.message ?? String(error),
          });
          return {
            ok: true,
            worldKind: 'overworld',
            outcome,
            warning: error?.message ?? String(error),
          };
        }
        if (candidate) {
          try {
            this._disposeUncommittedWorldCandidate(candidate);
          } catch (cleanupError) {
            this._recordWorldLifecycleEvent('rollback-cleanup-error', {
              phase: `return-overworld:${outcome}`,
              message: cleanupError?.message ?? String(cleanupError),
            });
          }
        }
        if (previousBundle && !previousBundle.disposed) {
          this._assignMountedWorldBundle(previousBundle, { incrementGeneration: false });
          this._activateRuntimeControllerForBundle(previousBundle);
          this.spawner = previousSpawner;
          this.mapEvents = previousMapEvents;
          this._placePersistentPlayer(previousPlayerPosition, previousPlayerFacing);
          if (previousPlayerVelocity && this.player.velocity) {
            this.player.velocity.copy(previousPlayerVelocity);
          }
          this._collectCameraOcclusionWalls();
          this._collectDungeonRenderCullGroups();
          this._updateDungeonRenderCulling(0, { force: true });
        }
        this.expeditionAccepted = previousExpeditionAccepted;
        this.expeditionActive = previousExpeditionActive;
        this.ruinCompleted = previousRuinCompleted;
        this.activeBossExpeditionSpec = previousExpeditionSpec;
        this.lastExpeditionSummary = previousExpeditionSummary;
        this._transitionWorldLifecycleTo('dungeon');
        this.worldKind = 'dungeon';
        return { ok: false, reason: 'transition-failed', message: error?.message ?? String(error), error };
      } finally {
        this.worldTransitionInFlight = null;
      }
    })();
    return this.worldTransitionInFlight;
  }

  confirmDungeonAbandon() {
    return this._returnToStreamedOverworld({ outcome: 'abandoned' });
  }

  getWorldTransitionDiagnostics() {
    const rendererInfo = this.renderer?.info ?? {};
    const activeRoot = this.activeWorldBundle?.root ?? null;
    const mountedRuntime = validateMountedRuntimeStateHost(this);
    const ownership = {
      activeRootObjectCount: 0,
      activeRootMeshCount: 0,
      activeRootLightCount: 0,
      sceneObjectCount: 0,
      scenePlayerRootCount: 0,
      sceneActiveWorldRootCount: 0,
      sceneWorldRootCount: 0,
      sceneWorldRootIds: [],
      controllerRuntimeRootCount: 0,
      npcAnimatorCount: this.activeWorldBundle?.npcAnimators?.length ?? 0,
      npcMixerCount: this.activeWorldBundle?.facade?.npcAnimationMixers?.length ?? 0,
      collisionEntryCount: this.activeWorldBundle?.collisionData?.length ?? 0,
      cullingEntryCount: this.activeWorldBundle?.cullingData?.length ?? 0,
      disposableResourceCount: this.activeWorldBundle?.disposableResources?.length ?? 0,
      gameHostEventBindingPasses: this.hostEventBindingPasses,
      gameHostEventListenerRegistrations: this.hostEventListenerRegistrations,
      activeControllerCount: this.activeWorldBundle?.controller === this.dungeonController ? 1 : 0,
      mountedRuntimeContractAccepted: mountedRuntime.accepted,
      mountedEnemyCount: this.enemies?.length ?? 0,
      mountedHazardCount: this.hazards?.length ?? 0,
      mountedProjectileCount: this.projectiles?.active?.length ?? 0,
      mountedMineCount: this.combat?.activeMines?.length ?? 0,
      mountedLootCount: this.lootSystem?.pickups?.length ?? 0,
      mountedRefractorCount: this.refractors?.pickups?.length ?? 0,
    };
    activeRoot?.traverse?.((object) => {
      ownership.activeRootObjectCount += 1;
      if (object.isMesh) ownership.activeRootMeshCount += 1;
      if (object.isLight) ownership.activeRootLightCount += 1;
      if (object.name === 'dungeonControllerRuntimeRoot') ownership.controllerRuntimeRootCount += 1;
    });
    this.scene?.traverse?.((object) => {
      ownership.sceneObjectCount += 1;
      if (object.name === 'playerRoot') ownership.scenePlayerRootCount += 1;
      if (object === activeRoot) ownership.sceneActiveWorldRootCount += 1;
      if (object.userData?.worldRootId && ['overworld', 'dungeon'].includes(object.userData?.worldKind)) {
        ownership.sceneWorldRootCount += 1;
        ownership.sceneWorldRootIds.push(object.userData.worldRootId);
      }
    });
    const registeredSurfaceKindsByOwner = {};
    for (const entry of this.cameraOcclusionEntries) {
      const owner = entry?.owner ?? entry?.object;
      const ownerId = owner?.userData?.occlusionOwnerId ?? owner?.name ?? owner?.uuid ?? 'unknown';
      const surfaceName = entry?.object?.name ?? '';
      const kind = surfaceName.includes('instancedWalls')
        ? 'house-wall'
        : surfaceName.includes('instancedRoof')
          ? 'house-roof'
          : surfaceName.startsWith('overworldTreeCanopies-')
            ? 'tree-canopy'
            : surfaceName.startsWith('overworldTreeTrunks-')
              ? 'tree-trunk'
              : 'structural-surface';
      const kinds = registeredSurfaceKindsByOwner[ownerId] ?? new Set();
      kinds.add(kind);
      registeredSurfaceKindsByOwner[ownerId] = kinds;
    }
    const serializedSurfaceKinds = Object.fromEntries(Object.entries(registeredSurfaceKindsByOwner)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([ownerId, kinds]) => [ownerId, [...kinds].sort()]));
    return {
      worldKind: this.worldKind,
      dungeonFamilyId: this.activeWorldBundle?.facade?.dungeonFamilyId ?? null,
      transitionState: this.transitionState,
      activeRootId: this.activeWorldBundle?.root?.userData?.worldRootId
        ?? this.activeWorldBundle?.root?.uuid
        ?? null,
      planHash: this.activeWorldBundle?.planHash ?? null,
      generationCount: this.worldGenerationCount,
      disposalCount: this.worldDisposalCount,
      lastDisposalStats: this.lastWorldDisposalStats,
      renderer: {
        calls: rendererInfo.render?.calls ?? 0,
        triangles: rendererInfo.render?.triangles ?? 0,
        geometries: rendererInfo.memory?.geometries ?? 0,
        textures: rendererInfo.memory?.textures ?? 0,
      },
      dungeonAugmentation: this.activeWorldBundle?.worldKind === 'dungeon' ? {
        status: this.dungeon?.augmentationStatus ?? 'disabled',
        profileId: this.dungeon?.augmentationIdentity?.profileId ?? null,
        basePlanHash: this.dungeon?.basePlanHash ?? null,
        augmentationPlanHash: this.dungeon?.augmentationPlanHash ?? null,
        effectivePlanHash: this.dungeon?.effectivePlanHash
          ?? this.activeWorldBundle?.planHash
          ?? null,
        themeRevisions: this.dungeon?.augmentationIdentity?.themeRevisions ?? [],
        diagnostics: this.dungeon?.augmentationDiagnostics ?? null,
        metrics: this.dungeon?.augmentationMetrics ?? null,
      } : null,
      occlusion: {
        entryCount: this.cameraOcclusionEntries.length,
        hiddenOwnerCount: this.cameraOcclusionHiddenOwners.size,
        hiddenInstanceCount: this.cameraOcclusionHiddenInstances.length,
        hiddenOwnerIds: [...this.cameraOcclusionHiddenOwners]
          .map((owner) => owner?.userData?.occlusionOwnerId ?? owner?.name ?? owner?.uuid ?? 'unknown')
          .sort(),
        registeredSurfaceKindsByOwner: serializedSurfaceKinds,
      },
      ownership,
      entryReturnAnchor: this.activeWorldBundle?.entryReturnAnchor?.toArray?.() ?? null,
      interruptedExpeditionRecovery: this.getInterruptedExpeditionRecoveryDiagnostics(),
      eventLog: this.worldLifecycleEventLog.map((entry) => ({ ...entry })),
    };
  }

  /**
   * Returns the small detached state needed by public-input locomotion.
   *
   * The complete journey contract below intentionally includes every room,
   * floor, collider, encounter, and connector. Rebuilding that full snapshot
   * for each tank-steering pulse can stall a large authored dungeon. This
   * player-only view keeps ordinary keyboard journeys responsive while
   * remaining read-only and exposing no live THREE objects.
   */
  getPublicDungeonPlayerJourneyDiagnostics() {
    if (this.worldKind !== 'dungeon' || !this.dungeon || !this.dungeonController) {
      return null;
    }

    const plainPosition = (value) => value ? {
      x: Number(value.x ?? 0),
      y: Number(value.y ?? 0),
      z: Number(value.z ?? 0),
    } : null;
    const cameraForwardVector = this.camera
      ? this.camera.getWorldDirection(new THREE.Vector3()).setY(0)
      : new THREE.Vector3(0, 0, 1);
    if (cameraForwardVector.lengthSq() <= 0.0001) cameraForwardVector.set(0, 0, 1);
    cameraForwardVector.normalize();
    const cameraRightVector = new THREE.Vector3(
      -cameraForwardVector.z,
      0,
      cameraForwardVector.x,
    );
    const lockTarget = this.combat?.lockOn?.target ?? null;
    const projectileOrigin = this.player?.getProjectileOrigin?.()
      ?? this.player?.getAttackOrigin?.()
      ?? null;

    return structuredClone({
      worldKind: this.worldKind,
      transitionState: this.transitionState,
      player: {
        position: plainPosition(this.player?.root?.position),
        rotationY: Number(this.player?.root?.rotation?.y ?? 0),
        health: Number(this.player?.health ?? 0),
        maxHealth: Number(this.player?.stats?.maxHealth ?? this.player?.maxHealth ?? 0),
        barrier: {
          capacity: Number(this.player?.barrier?.capacity ?? 0),
          current: Number(this.player?.barrier?.current ?? 0),
          broken: Boolean(this.player?.barrier?.broken),
          recharging: Boolean(this.player?.barrier?.recharging),
        },
        jumpState: this.player?.jumpState ?? null,
        ledgeClinging: Boolean(this.player?.isLedgeClinging?.()),
        ladderTraversal: this.player?.getLadderTraversalDiagnostics?.() ?? null,
        dead: Boolean(this.player?.dead),
        projectileOrigin: plainPosition(projectileOrigin),
        movementBasis: {
          forward: plainPosition(cameraForwardVector),
          right: plainPosition(cameraRightVector),
        },
      },
      lock: {
        targetId: lockTarget?.id ?? null,
        movementLocked: Boolean(this.combat?.lockOn?.movementLocked),
      },
    });
  }

  /**
   * Returns a detached, serializable view of the currently streamed V1 ruin.
   *
   * This is intentionally a read-only public contract for physical journey
   * automation and diagnostics. Callers can choose destinations from the
   * accepted dungeon data, but cannot retain a live THREE object or mutate
   * player, combat, progression, encounter, or mechanism state through the
   * returned value. All state changes in a journey must still arrive through
   * the same keyboard and mouse input used by a player.
   */
  getPublicDungeonJourneyDiagnostics({ includeGeometry = true } = {}) {
    if (this.worldKind !== 'dungeon' || !this.dungeon || !this.dungeonController) {
      return null;
    }

    const plainPosition = (value) => value ? {
      x: Number(value.x ?? 0),
      y: Number(value.y ?? 0),
      z: Number(value.z ?? 0),
    } : null;
    const controller = this.dungeonController;
    const dungeon = this.dungeon;
    const playerPosition = plainPosition(this.player?.root?.position);
    const cameraForwardVector = this.camera
      ? this.camera.getWorldDirection(new THREE.Vector3()).setY(0)
      : new THREE.Vector3(0, 0, 1);
    if (cameraForwardVector.lengthSq() <= 0.0001) cameraForwardVector.set(0, 0, 1);
    cameraForwardVector.normalize();
    const cameraRightVector = new THREE.Vector3(
      -cameraForwardVector.z,
      0,
      cameraForwardVector.x,
    );
    const nearest = controller.getNearestInteractable?.() ?? null;
    const lockTarget = this.combat?.lockOn?.target ?? null;
    const lockOwner = lockTarget
      ? this.enemies.find((enemy) => (
        enemy === lockTarget
        || getEnemyCombatTargets(enemy).includes(lockTarget)
      )) ?? null
      : null;
    const lockPosition = lockTarget
      ? plainPosition(getCombatTargetWorldPosition(lockTarget, new THREE.Vector3()))
      : null;
    const floorTiles = includeGeometry
      ? (dungeon.floorTiles ?? []).map((tile, index) => ({
        index,
        x: Number(tile.x ?? 0),
        z: Number(tile.z ?? 0),
        level: Number(tile.level ?? 0),
        elevation: Number(tile.elevation ?? 0),
        roomId: tile.roomId ?? null,
        type: tile.type ?? 'floor',
        surface: tile.surface ?? tile.type ?? 'floor',
        surfaceRole: tile.surfaceRole ?? null,
        rampRouteId: tile.rampRouteId ?? null,
        rampSegmentIndex: Number.isFinite(tile.rampSegmentIndex)
          ? Number(tile.rampSegmentIndex)
          : null,
        rampStartElevation: Number.isFinite(tile.rampStartElevation)
          ? Number(tile.rampStartElevation)
          : null,
        rampEndElevation: Number.isFinite(tile.rampEndElevation)
          ? Number(tile.rampEndElevation)
          : null,
        rampDirectionX: Number(tile.rampDirectionX ?? 0),
        rampDirectionZ: Number(tile.rampDirectionZ ?? 0),
        groundedStepTransitionHeight: Number(tile.groundedStepTransitionHeight ?? 0),
        isPlatformingSurface: Boolean(tile.isPlatformingSurface),
        isLedgeSurface: Boolean(tile.isLedgeSurface),
        allowsGroundedDropLanding: Boolean(tile.allowsGroundedDropLanding),
        requiredTraversalAction: tile.requiredTraversalAction ?? null,
        ledgeEdges: Array.isArray(tile.ledgeEdges) ? [...tile.ledgeEdges] : [],
        platformGroupId: tile.platformGroupId ?? null,
        platformPurpose: tile.platformPurpose ?? null,
        connectionId: tile.connectionId ?? tile.connectorId ?? null,
        floorKey: String(
          tile.floorKey
            ?? `${Number(tile.x ?? 0)},${Number(tile.z ?? 0)}@y${Number(tile.elevation ?? 0).toFixed(3)}`,
        ),
        traversalLinks: (tile.traversalLinks ?? []).map((link) => ({
          id: String(link.id ?? ''),
          action: String(link.action ?? ''),
          connectionId: link.connectionId
            ?? tile.connectionId
            ?? tile.connectorId
            ?? null,
          targetId: String(
            link.targetId
              ?? link.id?.replace?.(/:(?:forward|reverse)$/, '')
              ?? '',
          ),
          toFloorKey: String(link.toFloorKey ?? ''),
        })),
      }))
      : [];
    const solidZones = includeGeometry
      ? (dungeon.solidZones ?? []).map((zone) => ({
        id: zone.id ?? null,
        position: plainPosition(zone.position),
        halfWidth: Number(zone.halfWidth ?? 0),
        halfDepth: Number(zone.halfDepth ?? 0),
        verticalHalfHeight: Number.isFinite(zone.verticalHalfHeight)
          ? Number(zone.verticalHalfHeight)
          : null,
        rotationY: Number(zone.rotationY ?? 0),
        active: zone.active !== false,
      }))
      : [];
    const platforms = includeGeometry
      ? [
        ...(this.platformingPlatforms ?? []),
        ...(this.dynamicPlatformingPlatforms ?? []),
      ].filter((platform) => platform?.enabled !== false).map((platform) => ({
        id: platform.id ?? null,
        center: plainPosition(platform.center),
        halfWidth: Number(platform.halfWidth ?? 0),
        halfDepth: Number(platform.halfDepth ?? 0),
        topY: Number(platform.topY ?? 0),
        blocksBelow: platform.blocksBelow !== false,
        requiredTraversalAction: platform.requiredTraversalAction ?? null,
        ledgeEdges: Array.isArray(platform.ledgeEdges) ? [...platform.ledgeEdges] : [],
      }))
      : [];
    const doors = (dungeon.doors ?? []).map((door) => ({
      id: door.id,
      label: door.label,
      fromRoomId: door.fromRoomId ?? null,
      toRoomId: door.toRoomId ?? null,
      position: plainPosition(door.position),
      graphBlockingPosition: plainPosition(door.graphBlockingPosition),
      collisionHalfWidth: Number(
        door.collisionHalfWidth ?? (door.alongX ? 0.16 : (dungeon.tileSize ?? 2.8) * 0.48),
      ),
      collisionHalfDepth: Number(
        door.collisionHalfDepth ?? (door.alongX ? (dungeon.tileSize ?? 2.8) * 0.48 : 0.16),
      ),
      collisionHeight: Number(door.collisionHeight ?? 4.8),
      closed: door.closed === true,
      opened: door.opened === true,
    }));
    const encounters = (controller.encounters ?? []).map((encounter) => ({
      id: encounter.id,
      roomId: encounter.roomId,
      isBoss: Boolean(encounter.isBoss),
      spawned: Boolean(encounter.spawned),
      cleared: Boolean(encounter.cleared),
      zone: {
        position: plainPosition(encounter.zone?.position),
        halfWidth: Number(encounter.zone?.halfWidth ?? 0),
        halfDepth: Number(encounter.zone?.halfDepth ?? 0),
      },
      triggerZone: encounter.triggerZone ? {
        position: plainPosition(encounter.triggerZone.position),
        halfWidth: Number(encounter.triggerZone.halfWidth ?? 0),
        halfDepth: Number(encounter.triggerZone.halfDepth ?? 0),
      } : null,
      enemyIds: [...(encounter.enemyIds ?? [])],
    }));
    const activeWeapon = this.player?.getActiveArmWeapon?.() ?? null;
    const activeWeaponState = this.combat?.getCurrentWeaponState?.() ?? null;
    const projectileOrigin = this.player?.getProjectileOrigin?.()
      ?? this.player?.getAttackOrigin?.()
      ?? null;
    const activePlayerProjectiles = (this.projectiles?.active ?? [])
      .filter((projectile) => projectile?.owner === 'player')
      .map((projectile) => ({
        position: plainPosition(projectile.mesh?.position),
        direction: plainPosition(projectile.direction),
        visible: projectile.mesh?.visible === true,
        attachedToScene: projectile.mesh?.parent === this.scene,
        visualType: projectile.visualType ?? null,
        distance: Number(projectile.distance ?? 0),
      }));
    const enemies = (this.enemies ?? []).map((enemy) => ({
      id: enemy.id,
      encounterId: enemy.encounterId ?? null,
      dead: Boolean(enemy.dead),
      isBoss: Boolean(enemy.isBoss),
      health: Number(enemy.health ?? 0),
      maxHealth: Number(enemy.stats?.maxHealth ?? enemy.maxHealth ?? 0),
      position: plainPosition(enemy.root?.position),
    }));
    const keycards = (controller.keycards ?? []).map((keycard) => ({
      id: keycard.id,
      keycardId: keycard.keycardId,
      collected: Boolean(keycard.collected),
      position: plainPosition(keycard.position),
    }));
    const chests = (controller.chests ?? []).map((chest) => ({
      id: chest.id,
      guaranteedKeycardId: chest.guaranteedKeycardId ?? null,
      rewardPartId: chest.rewardPartId ?? null,
      rewardPersistenceKey: chest.rewardPersistenceKey ?? null,
      rewardPending: Boolean(chest.rewardPending),
      rewardClaimed: Boolean(chest.rewardClaimed),
      opened: Boolean(chest.opened),
      position: plainPosition(chest.position),
    }));
    const mechanisms = (controller.mechanisms ?? []).map((mechanism) => ({
      id: mechanism.id,
      label: mechanism.label,
      activated: Boolean(mechanism.activated),
      position: plainPosition(mechanism.position),
    }));
    const traps = (controller.traps ?? []).map((trap) => ({
      id: trap.id,
      label: trap.label,
      active: trap.active !== false,
      position: plainPosition(trap.position),
    }));
    const connectorLadders = (dungeon.ladders ?? []).map((ladder) => ({
      id: String(ladder.id ?? ''),
      connectionId: ladder.connectionId ?? null,
      direction: ladder.direction ?? null,
      bottomY: Number(ladder.bottomY ?? 0),
      topY: Number(ladder.topY ?? 0),
      bottomMountPosition: plainPosition(ladder.bottomMountPosition ?? ladder.bottomExit),
      topMountPosition: plainPosition(ladder.topMountPosition ?? ladder.topExit),
      bottomExit: plainPosition(ladder.bottomExit),
      topExit: plainPosition(ladder.topExit),
      mountRadius: Number(ladder.mountRadius ?? 0),
    }));
    const liftRuntimeById = new Map(
      (this.getConnectorLiftDiagnostics?.().lifts ?? []).map((lift) => [lift.id, lift]),
    );
    const connectorLifts = (dungeon.connectorLifts ?? []).map((lift) => {
      const runtime = liftRuntimeById.get(lift.id) ?? null;
      return {
        id: String(lift.id ?? ''),
        connectionId: lift.connectionId ?? null,
        direction: lift.direction ?? null,
        center: plainPosition(lift.center),
        sourceElevation: Number(lift.progressionSourceElevation ?? lift.initialElevation ?? 0),
        destinationElevation: Number(lift.progressionDestinationElevation ?? 0),
        bottomElevation: Number(lift.bottomElevation ?? 0),
        topElevation: Number(lift.topElevation ?? 0),
        currentElevation: Number(runtime?.currentElevation ?? lift.currentElevation ?? 0),
        currentEndpoint: runtime?.currentEndpoint ?? null,
        targetEndpoint: runtime?.targetEndpoint ?? null,
        phase: runtime?.phase ?? lift.phase ?? null,
        halfWidth: Number(lift.surface?.halfWidth ?? (Number(lift.platformWidthMeters ?? 0) * 0.5)),
        halfDepth: Number(lift.surface?.halfDepth ?? (Number(lift.platformDepthMeters ?? 0) * 0.5)),
        landingSills: (lift.landingSills ?? []).map((sill) => ({
          id: String(sill.id ?? ''),
          endpoint: sill.endpoint ?? null,
          progressionRole: sill.progressionRole ?? null,
          position: plainPosition(sill.center),
          halfWidth: Number(sill.halfWidth ?? 0),
          halfDepth: Number(sill.halfDepth ?? 0),
          topY: Number(sill.topY ?? 0),
          spanMeters: Number(sill.spanMeters ?? 0),
          bridgeDepthMeters: Number(sill.bridgeDepthMeters ?? 0),
          purpose: sill.purpose ?? null,
        })),
        controls: (lift.controls ?? []).map((control) => ({
          id: String(control.id ?? ''),
          endpoint: control.endpoint ?? null,
          position: plainPosition(control.position),
          interactionRadius: Number(control.interactionRadius ?? 0),
        })),
      };
    });
    const connectorTrackTraps = (dungeon.connectorTrackTraps ?? []).map((trap) => ({
      id: String(trap.id ?? ''),
      connectionId: trap.connectionId ?? null,
      connectorVariantId: trap.connectorVariantId ?? null,
      connectorDirection: trap.connectorDirection ?? null,
      floorElevation: Number(trap.floorElevation ?? 0),
      trackStart: plainPosition(trap.trackStart),
      trackEnd: plainPosition(trap.trackEnd),
      warningVolume: trap.warningVolume ? {
        center: plainPosition(trap.warningVolume.center),
        halfSize: plainPosition(trap.warningVolume.halfSize),
      } : null,
    }));
    const connectorTrackTrapRuntime = this.getConnectorTrackTrapDiagnostics?.() ?? null;
    const plainSocket = (socket) => socket ? {
      id: socket.id ?? null,
      roomId: socket.roomId ?? null,
      role: socket.role ?? null,
      x: Number(socket.x ?? 0),
      y: Number(socket.y ?? socket.elevation ?? 0),
      z: Number(socket.z ?? 0),
      elevation: Number(socket.elevation ?? socket.y ?? 0),
      facingX: Number(socket.facingX ?? 0),
      facingZ: Number(socket.facingZ ?? 0),
      floorKey: socket.floorKey ?? null,
    } : null;
    const plainEndpoint = (endpoint) => endpoint ? {
      role: endpoint.role ?? null,
      socketId: endpoint.socketId ?? null,
      roomId: endpoint.roomId ?? null,
      elevation: Number(endpoint.elevation ?? endpoint.position?.y ?? 0),
      position: plainPosition(endpoint.position),
    } : null;
    const connectorRoutes = (dungeon.connectionPlans ?? []).map((plan) => ({
      connectionId: String(plan.id ?? ''),
      logicalConnectionId: plan.logicalConnectionId ?? null,
      fromRoomId: plan.fromRoomId ?? null,
      toRoomId: plan.toRoomId ?? null,
      connectorType: plan.connectorType ?? null,
      connectorVariantId: plan.connectorVariantId ?? null,
      ...(plan.connectorThemeId ? { connectorThemeId: plan.connectorThemeId } : {}),
      ...(plan.connectorPresentation ? {
        connectorPresentation: structuredClone(plan.connectorPresentation),
      } : {}),
      traversalKind: plan.connectorVariant?.traversalKind ?? 'service_gallery',
      direction: plan.direction ?? 'level',
      sourceElevation: Number(plan.sourceElevation ?? plan.elevation ?? 0),
      destinationElevation: Number(plan.destinationElevation ?? plan.elevation ?? 0),
      elevationDelta: Number(plan.elevationDelta ?? 0),
      sourceSocket: plainSocket(plan.fromSocket),
      destinationSocket: plainSocket(plan.toSocket),
      higherEndpoint: plainEndpoint(plan.higherEndpoint),
      lowerEndpoint: plainEndpoint(plan.lowerEndpoint),
      path: includeGeometry
        ? (plan.bridgePath ?? []).map((point) => ({
          x: Number(point.x ?? 0),
          z: Number(point.z ?? 0),
        }))
        : [],
    }));
    const snapshot = {
      worldKind: this.worldKind,
      dungeonFamilyId: dungeon.dungeonFamilyId ?? INDUSTRIAL_DUNGEON_FAMILY_ID,
      dungeonFamilyFallback: this.dungeonFamilyFallback
        ? { ...this.dungeonFamilyFallback }
        : null,
      roomModuleIds: [...(dungeon.roomModuleIds ?? dungeon.rooms?.map(({ id }) => id) ?? [])],
      transitionState: this.transitionState,
      player: {
        position: playerPosition,
        rotationY: Number(this.player?.root?.rotation?.y ?? 0),
        health: Number(this.player?.health ?? 0),
        maxHealth: Number(this.player?.stats?.maxHealth ?? this.player?.maxHealth ?? 0),
        barrier: {
          capacity: Number(this.player?.barrier?.capacity ?? 0),
          current: Number(this.player?.barrier?.current ?? 0),
          broken: Boolean(this.player?.barrier?.broken),
          recharging: Boolean(this.player?.barrier?.recharging),
        },
        jumpState: this.player?.jumpState ?? null,
        ledgeClinging: Boolean(this.player?.isLedgeClinging?.()),
        ladderTraversal: this.player?.getLadderTraversalDiagnostics?.() ?? null,
        dead: Boolean(this.player?.dead),
        projectileOrigin: plainPosition(projectileOrigin),
        movementBasis: {
          forward: plainPosition(cameraForwardVector),
          right: plainPosition(cameraRightVector),
        },
      },
      activeWeapon: activeWeapon ? {
        slotIndex: Number(this.player?.activeArmIndex ?? 0),
        id: activeWeapon.id ?? null,
        type: activeWeapon.type ?? null,
        label: activeWeapon.name ?? activeWeapon.typeLabel ?? null,
        energy: Number(activeWeaponState?.energy ?? 0),
        maxEnergy: Number(activeWeaponState?.maxEnergy ?? 0),
        weaponOutput: Number(activeWeaponState?.weaponOutput ?? 0),
        maxWeaponOutput: Number(activeWeaponState?.maxWeaponOutput ?? 0),
      } : null,
      activePlayerProjectiles,
      tileSize: Number(dungeon.tileSize ?? 2.8),
      floorTiles,
      solidZones,
      platforms,
      doors,
      encounters,
      enemies,
      keycards,
      chests,
      mechanisms,
      traps,
      connectorRoutes,
      connectorLadders,
      connectorLifts,
      connectorTrackTraps,
      connectorTrackTrapRuntime: connectorTrackTrapRuntime ? {
        mounted: Boolean(connectorTrackTrapRuntime.mounted),
        trapCount: Number(connectorTrackTrapRuntime.trapCount ?? 0),
        visualAcceptancePassed: connectorTrackTrapRuntime.visualAcceptancePassed ?? null,
        traps: (connectorTrackTrapRuntime.traps ?? []).map((trap) => ({
          id: String(trap.id ?? ''),
          currentPosition: plainPosition(trap.currentPosition),
          distanceTravelledMeters: Number(trap.distanceTravelledMeters ?? 0),
          visualReady: Boolean(trap.visualReady),
          visualAttached: Boolean(trap.visualAttached),
          damageEnabled: Boolean(trap.damageEnabled),
        })),
      } : null,
      walkabilityCollisions: (controller.playerWalkabilityCollisionEvents ?? []).map((event) => ({
        ...event,
        position: plainPosition(event.position),
        lastSafePosition: plainPosition(event.lastSafePosition),
      })),
      keySeeker: controller.keySeeker ? {
        id: controller.keySeeker.id,
        activated: Boolean(controller.keySeeker.activated),
        position: plainPosition(controller.keySeeker.position),
      } : null,
      shrine: controller.shrine ? {
        id: controller.shrine.id ?? 'largeRefractor',
        collected: Boolean(controller.shrine.collected),
        position: plainPosition(controller.shrine.position),
      } : null,
      ownedKeys: [...(controller.progressionManager?.collectedKeycardIds ?? [])],
      ruinCompleted: Boolean(this.ruinCompleted),
      nearestInteractable: nearest ? {
        kind: nearest.kind ?? null,
        label: nearest.label ?? null,
        targetId: nearest.target?.id ?? null,
        endpoint: nearest.endpoint ?? nearest.target?.endpoint ?? null,
        targetPosition: plainPosition(
          nearest.target?.position
            ?? (nearest.kind === 'ladder'
              ? nearest.target?.[`${nearest.endpoint}MountPosition`]
                ?? nearest.target?.[`${nearest.endpoint}Exit`]
              : null),
        ),
      } : null,
      lock: {
        targetId: lockTarget?.id ?? null,
        ownerEnemyId: lockOwner?.id ?? null,
        ownerEncounterId: lockOwner?.encounterId ?? null,
        targetPosition: lockPosition,
        movementLocked: Boolean(this.combat?.lockOn?.movementLocked),
        progress: Number(this.combat?.lockOn?.progress ?? 0),
      },
    };

    return structuredClone(snapshot);
  }

  async selectBossHunt(profileId) {
    if (this.expeditionActive) return { ok: false, reason: 'expedition-locked' };
    const normalized = normalizeBossProfileId(profileId);
    if (normalized !== profileId) return { ok: false, reason: 'unknown-boss-profile' };
    if (this.busterLabStorage?.readOnly) return { ok: false, reason: 'read-only' };
    const previousProfile = getReaverbotBossProfile(this.getSelectedBossProfileId());
    const result = this.busterLabStorage?.selectBossHunt
      ? await this._queueBusterStorageOperation(() => this.busterLabStorage.selectBossHunt(normalized))
      : { ok: true };
    if (!result?.ok) return result;
    this.selectedBossProfileId = normalized;
    this.activeBossExpeditionSpec = null;
    const nextProfile = getReaverbotBossProfile(normalized);
    if (this.usesStreamedWorldLifecycle && this.worldKind === 'overworld') {
      // Boss cards in the overworld only persist the staged profile. No V1
      // dungeon exists yet, so there is nothing to regenerate or mutate.
    } else if ((previousProfile?.environmentId ?? null) !== (nextProfile?.environmentId ?? null)) {
      this.resetDungeonLayout({
        free: true,
        message: `${nextProfile?.title ?? 'Boss Hunt'} environment prepared`,
        advanceFloor: false,
        regenerateSeed: false,
        abandonExpedition: false,
      });
    } else {
      this._configureBossHuntEncounter();
    }
    this.ui?.renderInventory?.();
    return { ok: true, bossProfileId: normalized, state: result.state };
  }

  debugSpawnBoss(profileId = this.getSelectedBossProfileId()) {
    if (!this.bossDebugEnabled) return { ok: false, reason: 'debug-disabled', message: 'Enable ?bossDebug=1.' };
    const normalized = normalizeBossProfileId(profileId);
    const existing = this.enemies.filter((enemy) => enemy.isBoss && !enemy.dead);
    for (const boss of existing) {
      boss.dispose?.();
      boss.root?.removeFromParent?.();
      const index = this.enemies.indexOf(boss);
      if (index >= 0) this.enemies.splice(index, 1);
    }
    tempVectorA.set(0, 0, 1).applyQuaternion(this.player.root.quaternion).setY(0).normalize();
    const center = this.player.root.position.clone().addScaledVector(tempVectorA, 7);
    center.y = this.dungeonController?.getSurfaceElevationAt?.(center) ?? center.y;
    const expeditionSpec = createBossExpeditionSpec({
      bossProfileId: normalized,
      seed: `debug:${normalized}:${this.dungeonLayoutSeed}`,
      depth: Math.max(1, Math.min(10, this.ruinFloor)),
      id: `debug:${normalized}:${Date.now()}`,
    });
    const encounter = {
      id: `debugBossEncounter:${Date.now()}`,
      label: getReaverbotBossProfile(normalized)?.title ?? normalized,
      isBoss: true,
      bossProfileId: normalized,
      expeditionSpec,
      roster: ['proceduralBoss'],
      spawnPoints: [center.clone()],
      zone: { position: center.clone(), halfWidth: 8, halfDepth: 8 },
      roomArchetypeId: 'debugArena',
      roomFlavorId: 'bossGallery',
      enemyBehaviorModifiers: [],
      enemyTags: [],
      enemySuppressedTags: [],
    };
    const boss = this.spawner?._spawnBossEncounter?.(encounter)?.[0];
    if (!boss) return { ok: false, message: 'Boss could not be spawned.' };
    boss.debugBoss = true;
    boss.expeditionSpec = expeditionSpec;
    return { ok: true, boss, message: `${boss.genome.name} spawned without progression rewards.` };
  }

  debugConfigureBoss({ phase = 1, signatureIntegrityPercent = 100 } = {}) {
    if (!this.bossDebugEnabled) return { ok: false, reason: 'debug-disabled' };
    const boss = this.enemies.find((enemy) => enemy.isBoss && !enemy.dead);
    if (!boss) return { ok: false, message: 'Spawn or encounter a boss first.' };
    if (Number(phase) >= 2 && boss.bossState.phase === 1) boss._beginPhaseTwo?.();
    if (Number(phase) <= 1) {
      boss.bossState.phase = 1;
      boss.bossState.transitionRemaining = 0;
      boss.health = Math.max(boss.health, boss.stats.maxHealth * 0.75);
    }
    const ratio = THREE.MathUtils.clamp(Number(signatureIntegrityPercent) / 100, 0, 1);
    boss.signatureIntegrity = boss.signatureIntegrityMax * ratio;
    if (ratio <= 0 && !boss.signaturePartOverloaded) boss._overloadSignaturePart?.({});
    return { ok: true, boss, message: `Boss forced to phase ${boss.bossState.phase}; signature ${Math.round(ratio * 100)}%.` };
  }

  debugSimulateBossReward(profileId, mode = 'repeat') {
    if (!this.bossDebugEnabled) return { ok: false, reason: 'debug-disabled' };
    const normalized = normalizeBossProfileId(profileId);
    const existingVictories = Math.max(
      0,
      Math.trunc(this.busterLabStorage?.state?.bossHunts?.victoriesByProfile?.[normalized] ?? 0),
    );
    const victoryIndex = mode === 'first' ? 1 : existingVictories + 1;
    const sample = getBossHuntRewardRoll({
      saveContextId: this.busterLabStorage?.saveContextId ?? 'debug',
      bossProfileId: normalized,
      victoryIndex,
    });
    const reward = mode === 'first'
      || mode === 'overload'
      || sample < BOSS_HUNT_REPEAT_REWARD_CHANCE;
    return Promise.resolve({
      ok: true,
      message: `${mode === 'first' ? 'First clear' : mode === 'overload' ? 'Overloaded repeat' : `Repeat #${victoryIndex} roll ${sample.toFixed(3)}`}: ${reward ? 'Boss Recovery queued' : 'no intact recovery'} (preview only).`,
      reward,
      deterministicRoll: sample,
      victoryIndex,
    });
  }

  async debugResetBossHunts() {
    if (!this.bossDebugEnabled) return { ok: false, reason: 'debug-disabled' };
    if (this.busterLabStorage?.readOnly) return { ok: false, reason: 'read-only' };
    const result = await this.busterLabStorage.transact({
      operation: 'debug-reset-boss-hunts',
      expectedRevision: this.busterLabStorage.revision,
      expectedWriteId: this.busterLabStorage.writeId,
    }, (state) => {
      state.bossHunts = {
        selectedBossProfileId: DEFAULT_BOSS_PROFILE_ID,
        victoriesByProfile: {},
        recordedExpeditions: {},
        pendingRecoveries: [],
        activeExpeditionId: null,
        fallbackFromProfileId: null,
        quarantinedRecoveryCount: 0,
        quarantinedEncounterProgressCount: 0,
      };
      return { reset: true };
    });
    if (result.ok) {
      this.selectedBossProfileId = DEFAULT_BOSS_PROFILE_ID;
      this.activeBossExpeditionSpec = null;
      this._configureBossHuntEncounter();
      this._refreshRollSalvageStorage();
    }
    return { ...result, message: result.ok ? 'Boss Hunt progress reset.' : 'Boss Hunt reset failed.' };
  }

  openBossGeometryGallery(profileId) {
    const result = this.debugSpawnBoss(profileId);
    if (!result.ok) return result;
    const boss = result.boss;
    boss.debugGallery = true;
    boss.stats.damage = 0;
    boss.bossState.arenaCooldown = Number.POSITIVE_INFINITY;
    if (!boss.specialEncounter?.ownsBossPositioning?.()) {
      boss.applyStatus?.('freeze', { duration: 3600 });
    }
    this.setPoseDebugOpen?.(false);
    this.cameraController.snapTo?.(this.player);
    return { ok: true, boss, message: 'Boss texture and geometry gallery spawned in-world.' };
  }

  getObjectiveText() {
    if (this.busterTestRange?.active) return 'Buster Test Range — Escape to return';
    if (this.busterSandboxSession?.active) return 'Disposable Buster Dungeon — Escape to return to Roll';
    if (this.worldKind === 'overworld') return 'Choose a Boss Hunt at the sealed ruin door';
    const bossObjective = !this.activeReaverbotBoss?.dead
      ? this.activeReaverbotBoss?.specialEncounter?.getObjectiveText?.()
      : null;
    if (bossObjective) return bossObjective;
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

  async enterRuinFromCamp() {
    const target = this.dungeon?.ruinEntryPosition?.clone?.()
      ?? this.dungeon?.playerStart?.clone?.()
      ?? null;

    if (!target || this.ruinCompleted) {
      return false;
    }

    this.beginExpedition({ silent: true });
    const expeditionSpec = this.getActiveBossExpeditionSpec();
    if (expeditionSpec && this.busterLabStorage?.lockBossHuntForExpedition) {
      const result = await this._queueBusterStorageOperation(() => (
        this.busterLabStorage.lockBossHuntForExpedition(expeditionSpec)
      ));
      if (!result?.ok && result?.reason !== 'read-only') {
        this.ui?.showToast?.('Roll could not lock the Boss Hunt expedition', '#ff9f73');
        return false;
      }
    }
    this.expeditionActive = true;
    this.player.refillBarrier?.();
    this.player.root.position.copy(target);
    this.player.root.position.y = 0;
    this.player.lastMoveDirection.copy(
      this.dungeon?.ruinEntryFacing ?? tempVectorA.set(0, 0, 1),
    ).setY(0).normalize();
    this.player.faceDirection(this.player.lastMoveDirection);
    this.dungeonController?.lastSafePlayerPosition?.copy?.(this.player.root.position);
    this.cameraController.snapTo(this.player);
    this.addParticleBurst(this.player.root.position, 0x7df8ff, 24, 0.16);
    this.ui?.showToast?.('Descending into the ruin', '#7df8ff');
    this.ui?.renderInventory?.();
    return true;
  }

  getQuestLogEntries() {
    if (this.worldKind === 'overworld') {
      return [{
        id: 'overworldBossHunt',
        title: 'Boss Hunt Expedition',
        status: 'Choose at the ruin door',
        detail: 'Meet Roll at camp, then select and confirm a Boss Hunt at the sealed ruin entrance.',
        progress: 0.12,
        color: '#7df8ff',
      }];
    }
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
    if (!this.busterLabStorage) return this._identifyReaverbotScrapLegacy();
    return this._queueBusterGameCommand(() => this._identifyReaverbotScrapNow());
  }

  _getPendingReaverbotScrapTransfer() {
    const pending = Math.max(0, Math.trunc(this.inventory.unidentifiedScrap) || 0);
    const bossPending = this.busterLabStorage?.getPendingBossRecoveryTransfer?.()?.total ?? 0;
    if (pending <= 0 && bossPending <= 0) return null;
    return {
      total: pending,
      recoveries: (this.inventory.unidentifiedRecoveries ?? []).map((recovery) => ({
        quantity: recovery.quantity,
        source: recovery.source ? { ...recovery.source } : null,
        recoverableParts: (recovery.recoverableParts ?? []).map((part) => ({
          ...part,
          source: part.source ? { ...part.source } : null,
        })),
      })),
    };
  }

  _finishReaverbotScrapIdentification(result) {
    this.inventory.takeAllUnidentifiedScrap();
    if (this.busterLabStorage) this._refreshRollSalvageStorage();
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

  _identifyReaverbotScrapLegacy() {
    const transfer = this._getPendingReaverbotScrapTransfer();
    if (!transfer) {
      this.ui?.showToast?.('Roll: no unidentified scrap to inspect', '#c7d0d6');
      return null;
    }
    try {
      return this._finishReaverbotScrapIdentification(
        this.rollSalvageStorage.identifyRecoveries(transfer),
      );
    } catch (error) {
      this.ui?.showToast?.('Roll could not complete the analysis; no scrap was consumed', '#ff9f73');
      this.ui?.renderInventory?.();
      return { ok: false, reason: 'transaction-failed', error };
    }
  }

  async _identifyReaverbotScrapNow() {
    const transfer = this._getPendingReaverbotScrapTransfer();
    if (!transfer) {
      this.ui?.showToast?.('Roll: no unidentified scrap to inspect', '#c7d0d6');
      return null;
    }
    const committed = await this._queueBusterStorageOperation(() => (
      this.busterLabStorage.identifyRecoveriesWithBossRewards
        ? this.busterLabStorage.identifyRecoveriesWithBossRewards(transfer)
        : this.busterLabStorage.updateRollSalvageAsync((roll) => roll.identifyRecoveries(transfer))
    ));
    if (!committed?.ok) {
      this.ui?.showToast?.('Roll could not save the analysis; no scrap was consumed', '#ff9f73');
      this.ui?.renderInventory?.();
      return { ok: false, reason: committed?.reason ?? 'transaction-failed', error: committed?.error };
    }
    const result = committed.identification ?? committed.result?.result ?? committed.result;
    return this._finishReaverbotScrapIdentification(result);
  }

  completeRuinObjective({
    reward = 650,
    position = null,
    label = 'Large Refractor secured',
  } = {}) {
    if (this.ruinCompleted) {
      return false;
    }

    this.ruinCompleted = true;
    this.largeRefractorsSecured += 1;
    this.inventory.gold += reward;

    if (position) {
      this.addParticleBurst(position, 0x7df8ff, 42, 0.24);
    }

    this.ui?.showToast?.(`${label} +${reward}z`, '#7df8ff');
    this.ui?.renderInventory?.();
    return true;
  }

  extractToCamp() {
    if (this.usesStreamedWorldLifecycle && this.worldKind === 'dungeon') {
      return this._returnToStreamedOverworld({
        outcome: this.ruinCompleted ? 'extracted' : 'abandoned',
      });
    }
    const target = this.dungeon?.campReturnPosition?.clone?.()
      ?? this.dungeon?.playerStart?.clone?.()
      ?? null;

    if (!target) {
      return false;
    }

    const departingBoss = this.activeReaverbotBoss;
    const departingExpeditionId = this.activeBossExpeditionSpec?.id
      ?? this.busterLabStorage?.getActiveBossExpedition?.()?.expeditionId
      ?? null;
    if (departingBoss) {
      const encounter = this.dungeonController?.encounters?.find?.(
        (candidate) => candidate.id === departingBoss.encounterId,
      );
      if (encounter && !encounter.cleared && !this.ruinCompleted) {
        encounter.spawned = false;
        encounter.enemyIds = [];
        encounter.expeditionSpec = null;
      }
      departingBoss._cleanupBossArena?.(this, 'arena-exit');
      this.removeEnemy(departingBoss);
      if (this.activeReaverbotBoss === departingBoss) this.activeReaverbotBoss = null;
      this.combat?._clearLockOn?.();
    }
    this.player.root.position.copy(target);
    this.player.refillBarrier?.();
    this.player.root.position.y = 0;
    this.player.lastMoveDirection.copy(
      this.dungeon?.campReturnFacing ?? tempVectorA.set(0, 0, 1),
    ).setY(0).normalize();
    this.player.faceDirection(this.player.lastMoveDirection);
    this.expeditionActive = false;
    if (departingExpeditionId) {
      this._queueBusterStorageOperation(() => this.busterLabStorage?.completeBossExpedition?.(
        departingExpeditionId,
        { outcome: this.ruinCompleted ? 'extracted' : 'abandoned' },
      ));
    }
    if (!this.ruinCompleted) {
      this.activeBossExpeditionSpec = null;
      // Prepare a fresh attempt immediately. The storage abandonment is queued,
      // so ignoring the still-active persisted record here avoids reusing its
      // now-closed expedition id if the player promptly re-enters the ruin.
      this._configureBossHuntEncounter(this.dungeon, { ignorePersistedActive: true });
    } else {
      this.activeBossExpeditionSpec = null;
    }
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

  resetDungeonLayout({
    free = false,
    message = 'Ruin layout reset',
    advanceFloor = true,
    regenerateSeed = true,
    abandonExpedition = true,
  } = {}) {
    if (this.usesStreamedWorldLifecycle) {
      this.ui?.showToast?.('Choose a new Boss Hunt at the sealed ruin door', '#6bdcff');
      return false;
    }
    if (!free) {
      const cost = this.getRuinResetCost();
      if (this.inventory.gold < cost) {
        this.ui?.showToast?.(`Need ${cost}z to reset the ruin`, '#ffb347');
        return false;
      }
      this.inventory.gold -= cost;
    }

    const previousDungeon = this.dungeon;
    const abandonedExpeditionId = this.activeBossExpeditionSpec?.id;
    if (abandonExpedition) {
      this._queueBusterStorageOperation(() => this.busterLabStorage?.clearActiveBossExpedition?.({
        expeditionId: abandonedExpeditionId,
        reason: 'abandoned',
      }));
    }
    // Reset keeps the same world root alive, so the debug ledge tester is not
    // covered by outgoing-bundle disposal. Release its five geometries before
    // _clearDungeonRunState drops the host reference.
    this._disposeDebugLedgeTester();
    this._clearDungeonRunState();
    this.bossStageRuntime?.dispose?.();
    if (regenerateSeed) {
      this.dungeonLayoutGeneration += 1;
      this.dungeonLayoutSeed = `layout:${this.dungeonLayoutSeed}:reset:${this.dungeonLayoutGeneration}`;
    }
    const basePlanHash = createLegacyDungeonBasePlanHash({
      layoutSeed: this.dungeonLayoutSeed,
      difficulty: this.ruinFloor,
      bossProfileId: this.getSelectedBossProfileId(),
      dungeonFamilyId: this.dungeonFamilyId,
    });
    const dungeon = new DungeonGenerator({
      difficulty: this.ruinFloor,
      random: createDungeonRandom(this.dungeonLayoutSeed),
      bossProfileId: this.getSelectedBossProfileId(),
      augmentationProfileId: this.dungeonAugmentationProfileId,
      augmentationSeed: this.dungeonLayoutSeed,
      basePlanHash,
    }).generate();
    dungeon.layoutSeed = this.dungeonLayoutSeed;
    dungeon.basePlanHash ??= basePlanHash;
    dungeon.effectivePlanHash ??= basePlanHash;
    // Release asynchronous trap visuals and their shared OBJ resources while
    // the old dungeon root is still intact. This prevents a late asset load
    // from attaching to a root whose geometry has already been disposed.
    this._replaceConnectorTrackTrapRuntimeForDungeon(null);
    for (const animator of previousDungeon?.npcAnimators ?? []) animator.dispose?.();
    previousDungeon?.group?.removeFromParent?.();
    this.dungeon = dungeon;
    this.bossStageRuntime = dungeon.specialEnvironment ?? null;
    this.platformingPlatforms = [...(dungeon.platforms ?? [])];
    this.dynamicPlatformingPlatforms = [];
    this._rebuildPlatformingLedgeCandidates();
    this.arenaRadius = dungeon.boundsRadius ?? this.arenaRadius;
    (this.activeWorldBundle?.worldKind === 'dungeon'
      ? this.activeWorldBundle.root
      : this.scene).add(dungeon.group);
    if (this.activeWorldBundle?.worldKind === 'dungeon') {
      this.activeWorldBundle.facade = dungeon;
      this.activeWorldBundle.npcAnimators = dungeon.npcAnimators ?? [];
      this.activeWorldBundle.collisionData = dungeon.solidZones ?? [];
      this.activeWorldBundle.cullingData = dungeon.renderCullGroups ?? [];
      this.activeWorldBundle.disposableResources = dungeon.disposableResources ?? [];
      this.activeWorldBundle.planHash = dungeon.effectivePlanHash;
    }
    dungeon.activateNpcAssets?.();
    this.lastDungeonResourceDisposalStats = this._disposeDetachedDungeonResources(
      previousDungeon?.group,
    );
    this._collectCameraOcclusionWalls();
    this._collectDungeonRenderCullGroups();
    this._rebuildDebugLedgeTester(dungeon.playerStart);
    this.activeBossExpeditionSpec = null;
    this._configureBossHuntEncounter(dungeon, { ignorePersistedActive: true });
    this.dungeonController = new DungeonController(this, dungeon);
    if (this.activeWorldBundle?.worldKind === 'dungeon') {
      this.activeWorldBundle.controller = this.dungeonController;
    }
    this._replaceConnectorLiftRuntimeForDungeon(dungeon);
    this._replaceConnectorTrackTrapRuntimeForDungeon(dungeon);
    this.bossStageRuntime?.mount?.(this);

    this.player.root.position.copy(dungeon.playerStart);
    this.player.refillBarrier?.();
    this.player.lastMoveDirection.copy(
      dungeon.playerStartFacing ?? tempVectorA.set(0, 0, 1),
    ).setY(0).normalize();
    this.player.faceDirection(this.player.lastMoveDirection);
    this.cameraController.snapTo(this.player);
    this._updateDungeonRenderCulling(0, { force: true });

    this.spawner = new EnemySpawner(this);
    this.spawner.spawnInitialPack();
    if (advanceFloor) this.ruinFloor += 1;
    this.ruinCompleted = false;
    this.expeditionAccepted = false;
    this.expeditionActive = false;

    this.ui?.showToast?.(message, '#6bdcff');
    this.ui?.renderInventory?.();
    return true;
  }

  async generateLoot(type = null, rarity = null) {
    const quantity = 1;
    this.inventory.addUnidentifiedScrap(quantity, {
      source: {
        kind: 'debug-loot-command',
        requestedType: type,
        requestedRarity: rarity,
      },
      recoverableParts: [],
    });
    this.ui?.showToast?.('Unidentified Reaverbot Scrap +1', '#c7d0d6');
    this.ui?.renderInventory?.();
    return { pickupKind: 'unidentifiedScrap', quantity };
  }

  async _commitLegacyBusterPickup(item) {
    const converted = await this._convertLegacyBusterPartItem(item, { futureAcquisition: true });
    if (!converted) {
      this.ui?.showToast?.('Roll could not reserve that Buster Part; it remains in inventory', '#ff9f73');
      return false;
    }
    if (this.busterLabEnabled) this.inventory.removeItem(item.id);
    this._refreshRollSalvageStorage();
    this.ui?.showToast?.(
      this.busterLabEnabled
        ? `${item.typeLabel ?? item.name} linked to a Mega calibration`
        : `${item.typeLabel ?? item.name} secured to this campaign`,
      '#7df8ff',
    );
    this.ui?.renderInventory?.();
    return true;
  }

  _collectWorldItemDurably(item) {
    if (MEGA_BUSTER_CALIBRATION_CATALOG[item?.type]) {
      return this._collectWorldBusterPartDurably(item);
    }
    // Fixed Arms/Gear are permanent catalog unlocks, never loose Item
    // instances. Unknown legacy equipment pickups are intentionally rejected.
    return false;
  }

  _collectWorldBusterPartDurably(item) {
    return this._queueBusterGameCommand(() => this._collectWorldBusterPartDurablyNow(item));
  }

  async _collectWorldBusterPartDurablyNow(item) {
    if (!this.busterLabEnabled && this.inventory.isFull()) return false;
    const converted = await this._convertLegacyBusterPartItem(item, { futureAcquisition: true });
    if (!converted) return false;
    let movedToRecovery = false;
    if (!this.busterLabEnabled && !this.inventory.addItem(item)) {
      // Capacity can change while the durable transaction is awaiting its
      // cross-tab lock. Once ownership is committed the world pickup must not
      // retry and create a second shadow record, so preserve the exact Item in
      // Roll's overflow instead of reporting an uncommitted acquisition.
      this.busterMigrationRecovery ??= [];
      this.busterMigrationRecovery.push(item);
      movedToRecovery = true;
    }
    this._refreshRollSalvageStorage();
    this.ui?.showToast?.(
      movedToRecovery
        ? `${item.typeLabel ?? item.name} secured in Roll's Migration Recovery`
        : this.busterLabEnabled
        ? `${item.typeLabel ?? item.name} linked to a Mega calibration`
        : `${item.typeLabel ?? item.name} secured to this campaign`,
      '#7df8ff',
    );
    this.ui?.renderInventory?.();
    return true;
  }

  async _initializeBusterLabFeature() {
    await this._migrateLegacyBusterParts();
    this._recompileBusterPlans?.();
    this._restoreCustomBusterAssignments();
  }

  _snapshotLegacyBusterItem(item) {
    if (!item) return null;
    if (item.legacySnapshot) {
      return {
        ...item.legacySnapshot,
        id: item.id ?? item.legacySnapshot.id ?? null,
        canonicalId: item.canonicalId ?? item.legacySnapshot.canonicalId ?? null,
        legacyBusterId: item.legacyBusterId ?? item.legacySnapshot.legacyBusterId ?? null,
        tags: [...(item.legacySnapshot.tags ?? [])],
        baseStats: { ...(item.legacySnapshot.baseStats ?? {}) },
        affixes: (item.legacySnapshot.affixes ?? []).map((entry) => ({ ...entry })),
      };
    }
    return {
      id: item.id ?? null,
      canonicalId: item.canonicalId ?? null,
      legacyBusterId: item.legacyBusterId ?? null,
      name: item.name,
      type: item.type,
      slot: item.slot,
      rarity: item.rarity,
      level: item.level,
      category: item.category,
      tags: [...(item.tags ?? [])],
      behavior: item.behavior ?? '',
      uniqueEffect: item.uniqueEffect ?? null,
      baseStats: { ...(item.baseStats ?? {}) },
      affixes: (item.affixes ?? []).map((entry) => ({ ...entry })),
      value: item.value ?? 0,
      weaponKind: item.weaponKind ?? null,
    };
  }

  _hydrateLegacyBusterShadowItems() {
    const records = this.busterLabStorage?.state?.legacyBusterParts?.records ?? [];
    if (records.length === 0) return 0;
    this.busterMigrationRecovery = [];
    let hydrated = 0;
    for (const record of records) {
      if (!record?.item || !MEGA_BUSTER_CALIBRATION_CATALOG[record.legacyType]) continue;
      const item = createMegaCalibrationShadow(record.legacyType, {
        ...record.item,
        id: record.legacyId,
      });
      if (!item) continue;
      item.canonicalId = record.legacyId;
      item.legacyBusterId = record.legacyId;
      if (record.starter) {
        if (this.inventory.addItem(item)) hydrated += 1;
        else this.busterMigrationRecovery.push(item);
      } else if (record.location?.kind === 'megaSocket') {
        const index = Math.max(0, Math.min(3, Math.trunc(record.location.socketIndex)));
        this.player.busterUpgradeSlots[index] = item;
        hydrated += 1;
      } else if (this.inventory.addItem(item)) {
        hydrated += 1;
      } else {
        this.busterMigrationRecovery.push(item);
      }
    }
    this.player.recalculateStats();
    this.player.updateWeaponVisualState?.();
    return hydrated;
  }

  _getLegacyBusterRecordForItem(item) {
    if (!item || !this.busterLabStorage) return null;
    const legacyId = item.legacyBusterId ?? item.canonicalId ?? item.id;
    return this.busterLabStorage.state?.legacyBusterParts?.records
      ?.find((record) => record.legacyId === legacyId) ?? null;
  }

  _getNonShadowInventoryCount() {
    return this.inventory.items.filter((item) => !this._getLegacyBusterRecordForItem(item)).length;
  }

  async _commitLegacyBusterLayout(commands) {
    if (!this.busterLabStorage) return { ok: true, state: null };
    const hasCommands = (commands?.locations?.length ?? 0) > 0
      || (commands?.removals?.length ?? 0) > 0;
    if (!hasCommands) return { ok: true, state: this.busterLabStorage.state };
    const result = await this._queueBusterStorageOperation(() => (
      this.busterLabStorage.reconcileLegacyBusterPartsAsync(commands, {
        occupiedInventoryCount: this._getNonShadowInventoryCount(),
      })
    ));
    if (result.ok) this._refreshRollSalvageStorage();
    return result;
  }

  assignLegacyBusterUpgrade(itemId, slotIndex) {
    return this._queueBusterGameCommand(() => this._assignLegacyBusterUpgradeNow(itemId, slotIndex));
  }

  async _assignLegacyBusterUpgradeNow(itemId, slotIndex) {
    const index = Math.max(0, Math.min(3, Math.trunc(Number(slotIndex)) || 0));
    const item = this.inventory.findItem(itemId);
    if (!item || item.category !== 'Buster Part') {
      return { ok: false, message: 'That item is not an available Buster Part.' };
    }
    const previous = this.player.busterUpgradeSlots[index] ?? null;
    const nextRecord = this._getLegacyBusterRecordForItem(item);
    const previousRecord = this._getLegacyBusterRecordForItem(previous);
    const authoritativeOccupant = this.busterLabStorage?.state?.legacyBusterParts?.records
      ?.find((record) => record.location?.kind === 'megaSocket'
        && record.location.socketIndex === index
        && record.legacyId !== nextRecord?.legacyId);
    const locations = [];
    if (authoritativeOccupant) {
      locations.push({ legacyId: authoritativeOccupant.legacyId, location: { kind: 'inventory' } });
    }
    if (previousRecord && previousRecord.legacyId !== nextRecord?.legacyId) {
      locations.push({ legacyId: previousRecord.legacyId, location: { kind: 'inventory' } });
    }
    if (nextRecord) {
      locations.push({ legacyId: nextRecord.legacyId, location: { kind: 'megaSocket', socketIndex: index } });
    }
    const committed = await this._commitLegacyBusterLayout({ locations });
    if (!committed.ok) {
      return { ok: false, message: committed.reason === 'inventory-capacity'
        ? 'Roll\'s recovery inventory is full.'
        : 'The Buster Part move could not be saved.' };
    }

    const removed = this.inventory.removeItem(itemId);
    if (!removed) return { ok: false, message: 'The Buster Part is no longer available.' };
    const displaced = this.player.assignBusterUpgradeToSlot(index, removed);
    if (displaced && displaced !== removed) this.inventory.addItem(displaced);
    return { ok: true, item: removed, previous: displaced };
  }

  unassignLegacyBusterUpgrade(slotIndex) {
    return this._queueBusterGameCommand(() => this._unassignLegacyBusterUpgradeNow(slotIndex));
  }

  async _unassignLegacyBusterUpgradeNow(slotIndex) {
    const index = Math.max(0, Math.min(3, Math.trunc(Number(slotIndex)) || 0));
    const item = this.player.busterUpgradeSlots[index] ?? null;
    if (!item) return { ok: false, message: 'That Buster socket is already empty.' };
    if (this.inventory.isFull()) {
      return { ok: false, message: 'Inventory is full; the Buster Part stayed installed.' };
    }
    const record = this._getLegacyBusterRecordForItem(item);
    const locations = record
      ? [{ legacyId: record.legacyId, location: { kind: 'inventory' } }]
      : [];
    const committed = await this._commitLegacyBusterLayout({ locations });
    if (!committed.ok) {
      return { ok: false, message: 'The Buster Part removal could not be saved.' };
    }
    const removed = this.player.assignBusterUpgradeToSlot(index, null);
    if (!removed) {
      return { ok: false, message: 'The Buster Part could not be moved to inventory.' };
    }
    if (!this.inventory.addItem(removed)) {
      // The inventory can fill while the durable move waits for the context
      // lock. The committed record now belongs to logical inventory, so keep
      // the exact Item in Roll's overflow instead of restoring a stale socket.
      this.busterMigrationRecovery ??= [];
      this.busterMigrationRecovery.push(removed);
      return {
        ok: true,
        item: removed,
        recovered: true,
        message: `${removed.name} was moved to Roll's Migration Recovery.`,
      };
    }
    return { ok: true, item: removed };
  }

  recoverLegacyMigrationItem(index) {
    const recovery = this.busterMigrationRecovery ?? [];
    const itemIndex = Math.trunc(Number(index));
    const item = recovery[itemIndex] ?? null;
    if (!item) return { ok: false, message: 'That recovered item is no longer available.' };
    if (this.inventory.isFull()) return { ok: false, message: 'Inventory is full.' };
    recovery.splice(itemIndex, 1);
    if (!this.inventory.addItem(item)) {
      recovery.splice(itemIndex, 0, item);
      return { ok: false, message: 'The recovered item could not be moved.' };
    }
    return { ok: true, message: `${item.name} moved from Roll's Migration Recovery.` };
  }

  discardInventoryItem(itemId) {
    return this._queueBusterGameCommand(() => this._discardInventoryItemNow(itemId));
  }

  async _discardInventoryItemNow(itemId) {
    const item = this.inventory.findItem(itemId);
    if (!item) return { ok: false, message: 'That item is no longer available.' };
    const record = this._getLegacyBusterRecordForItem(item);
    if (record) {
      const committed = await this._commitLegacyBusterLayout({ removals: [record.legacyId] });
      if (!committed.ok) return { ok: false, message: 'The sale could not be saved; the item was kept.' };
    }
    const discarded = this.inventory.discardItem(itemId);
    return discarded
      ? { ok: true, item: discarded, gained: Math.max(1, Math.floor(discarded.value * 0.35)) }
      : { ok: false, message: 'That item is no longer available.' };
  }

  _getBusterLabState() {
    this.busterLabState = this.busterLabStorage?.state ?? this.busterLabState;
    return this.busterLabState;
  }

  _queueBusterStorageOperation(operation) {
    if (this.busterSandboxSession?.active) {
      return Promise.resolve({
        ok: false,
        reason: 'sandbox-read-only',
        message: 'The disposable sandbox cannot write campaign storage.',
      });
    }
    this.busterStorageOperationPending += 1;
    const run = this.busterStorageOperationQueue.then(
      () => operation(),
      () => operation(),
    );
    const tracked = Promise.resolve(run).finally(() => {
      this.busterStorageOperationPending = Math.max(0, this.busterStorageOperationPending - 1);
    });
    this.busterStorageOperationQueue = tracked.catch(() => null);
    return tracked;
  }

  _queueBusterGameCommand(operation) {
    if (this.busterSandboxSession?.active) {
      return Promise.resolve({
        ok: false,
        reason: 'sandbox-read-only',
        message: 'The disposable sandbox cannot mutate campaign state.',
      });
    }
    const execute = () => {
      if (this.busterSandboxSession?.active) {
        return {
          ok: false,
          reason: 'sandbox-read-only',
          message: 'The disposable sandbox cannot mutate campaign state.',
        };
      }
      return operation();
    };
    this.busterGameCommandPending += 1;
    const run = this.busterGameCommandQueue.then(
      execute,
      execute,
    );
    const tracked = Promise.resolve(run).finally(() => {
      this.busterGameCommandPending = Math.max(0, this.busterGameCommandPending - 1);
    });
    this.busterGameCommandQueue = tracked.catch(() => null);
    return tracked;
  }

  _refreshRollSalvageStorage() {
    if (!this.busterLabStorage) return;
    this.busterLabState = this.busterLabStorage.state;
    this.rollSalvageStorage = this.busterLabStorage.createRollSalvageStorage({ autosave: false });
  }

  claimAuthoredDungeonPart(partId, source = {}) {
    const material = REAVERBOT_SALVAGE_MATERIALS[partId] ?? null;
    if (!material) return Promise.resolve({ ok: false, reason: 'unknown-part' });
    if (this.rollSalvageStorage?.hasDiscoveredPart?.(partId)) {
      return Promise.resolve({ ok: true, claimed: false, alreadyClaimed: true, material });
    }

    const recoverySource = {
      kind: 'authoredDungeonChest',
      dungeonFamilyId: this.dungeon?.dungeonFamilyId ?? INDUSTRIAL_DUNGEON_FAMILY_ID,
      roomModuleId: this.dungeon?.roomModuleIds?.[0] ?? null,
      ...source,
    };
    if (!this.busterLabStorage) {
      const stored = this.rollSalvageStorage?.addPart?.(material, 1, recoverySource) ?? null;
      return Promise.resolve({
        ok: Boolean(stored),
        claimed: Boolean(stored),
        alreadyClaimed: false,
        material,
      });
    }

    return this._queueBusterStorageOperation(() => (
      this.busterLabStorage.updateRollSalvageAsync((roll) => {
        if (roll.hasDiscoveredPart(partId)) return { claimed: false, alreadyClaimed: true };
        roll.addPart(material, 1, recoverySource);
        return { claimed: true, alreadyClaimed: false };
      })
    )).then((committed) => {
      if (!committed?.ok) return committed ?? { ok: false, reason: 'transaction-failed' };
      this._refreshRollSalvageStorage();
      this.ui?.renderInventory?.();
      return {
        ok: true,
        claimed: true,
        alreadyClaimed: false,
        material,
      };
    });
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

  async _migrateLegacyBusterParts() {
    const installed = (this.player.busterUpgradeSlots ?? [])
      .map((item, slotIndex) => ({ item, slotIndex }))
      .filter(({ item }) => Boolean(MEGA_BUSTER_CALIBRATION_CATALOG[item?.type]));
    const inventoryParts = this.inventory.items
      .filter((item) => Boolean(MEGA_BUSTER_CALIBRATION_CATALOG[item?.type]));
    if (!this.busterLabStorage || this.busterLabStorage.readOnly) return false;

    let changed = false;
    for (const { item, slotIndex } of installed) {
      const duplicate = this.busterLabStorage.state.legacyBusterParts.records
        .find((record) => record.item?.id === item.id || record.legacyId === item.canonicalId);
      let result = duplicate ? { ok: true } : null;
      if (!duplicate) {
        const occupiedCalibration = this.busterLabStorage.state.megaCalibrations.slots[slotIndex];
        const occupyingRecord = this.busterLabStorage.state.legacyBusterParts.records
          .find((record) => record.calibrationInstanceId === occupiedCalibration);
        if (occupyingRecord?.starter) {
          const emptySocket = this.busterLabStorage.state.megaCalibrations.slots
            .findIndex((entry, index) => !entry && index !== slotIndex);
          await this.busterLabStorage.moveLegacyBusterPartAsync(
            occupyingRecord.legacyId,
            emptySocket >= 0 ? { kind: 'megaSocket', socketIndex: emptySocket } : { kind: 'inventory' },
            { occupiedInventoryCount: this.inventory.items.length },
          );
        }
        result = await this.busterLabStorage.registerLegacyBusterPartAsync(
          this._snapshotLegacyBusterItem(item),
          {
            legacyType: item.type,
            location: { kind: 'megaSocket', socketIndex: slotIndex },
            occupiedInventoryCount: this.inventory.items.length,
          },
        );
      }
      if (result?.ok) {
        this.player.busterUpgradeSlots[slotIndex] = null;
        changed = true;
      }
    }

    for (const item of inventoryParts) {
      const duplicate = this.busterLabStorage.state.legacyBusterParts.records
        .find((record) => record.item?.id === item.id || record.legacyId === item.canonicalId);
      const result = duplicate ? { ok: true } : await this.busterLabStorage.registerLegacyBusterPartAsync(
        this._snapshotLegacyBusterItem(item),
        {
          legacyType: item.type,
          location: { kind: 'inventory' },
          occupiedInventoryCount: this.inventory.items.length - inventoryParts.length,
        },
      );
      if (result?.ok) {
        this.inventory.removeItem(item.id);
        changed = true;
      }
    }

    this._refreshRollSalvageStorage();
    if (changed) {
      this.player.recalculateStats();
      this.player.updateWeaponVisualState?.();
    }
    return changed;
  }

  async _convertLegacyBusterPartItem(item, { futureAcquisition = false } = {}) {
    if (!MEGA_BUSTER_CALIBRATION_CATALOG[item?.type] || !this.busterLabStorage) {
      return false;
    }
    const result = await this._queueBusterStorageOperation(() => (
      this.busterLabStorage.registerLegacyBusterPartAsync(
        this._snapshotLegacyBusterItem(item),
        {
          legacyType: item.type,
          location: { kind: 'inventory' },
          // Feature-off inventory already contains hydrated shadow Items;
          // count only ordinary records so the storage-side logical-capacity
          // check does not count every existing Buster Part twice.
          occupiedInventoryCount: this.busterLabEnabled
            ? this.inventory.items.length
            : this._getNonShadowInventoryCount(),
        },
      )
    ));
    if (!result.ok) return false;
    if (result.record?.legacyId) {
      item.canonicalId = result.record.legacyId;
      item.legacyBusterId = result.record.legacyId;
    }
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

  async setMegaBusterCalibration(slotIndex, instanceId) {
    if (!this.busterLabEnabled
      || !Number.isInteger(slotIndex)
      || slotIndex < 0
      || slotIndex >= MEGA_BUSTER_BASE_PROFILE.socketCount) {
      return { ok: false, message: 'Invalid Mega calibration socket.' };
    }
    const calibration = this._ensureMegaCalibrationState(this._getBusterLabState());
    const validation = (() => {
      if (instanceId && !calibration.instances.some((entry) => entry.instanceId === instanceId)) {
        return { ok: false, message: 'That calibration is not in Roll’s stockpile.' };
      }
      if (instanceId && calibration.slots.some((entry, index) => index !== slotIndex && entry === instanceId)) {
        return { ok: false, message: 'A physical calibration can occupy only one socket.' };
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
        return { ok: false, message: 'That calibration would raise a Mega Buster rating above 10.' };
      }
      return { ok: true };
    })();
    if (!validation.ok) return validation;
    const result = await this._queueBusterStorageOperation(() => (
      this.busterLabStorage.swapMegaCalibrationAsync(
        slotIndex,
        instanceId || null,
        { occupiedInventoryCount: this.inventory.items.length },
      )
    ));
    if (!result.ok) return { ok: false, message: result.error?.message ?? 'Calibration could not be installed.' };
    this.busterLabState = result.state;
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
    };
  }

  async handleDisplacedCustomBuster(slotIndex, item, reason = 'slotReplaced') {
    if (!this.busterLabEnabled || item?.type !== 'customBusterArm' || ![1, 2].includes(slotIndex)) {
      return false;
    }
    const result = await this._queueBusterStorageOperation(() => (
      this.busterLabStorage.assignBuildToSlotAsync(null, slotIndex)
    ));
    if (result.ok) this.busterLabState = result.state;
    return Boolean(result.ok);
  }

  getResolvedArmSlot(slotIndex) {
    const index = Math.max(0, Math.min(3, Math.trunc(Number(slotIndex)) || 0));
    if (this.busterLabEnabled && index === 0) return { kind: 'megaBuster' };
    const item = this.player.armHotbar[index] ?? null;
    if (this.busterLabEnabled && item?.type === 'customBusterArm') {
      return { kind: 'customBuster', buildId: item.buildId };
    }
    return item?.fixedArmId ? { kind: 'fixedArm', armId: item.fixedArmId } : null;
  }

  getBusterPlanForSlot(slotIndex) {
    if (!this.busterLabEnabled) return null;
    if (this.busterSandboxSession?.active && slotIndex === this.player.activeArmIndex) {
      return this.busterSandboxSession.plan;
    }
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
    const armsGear = this._getBusterLabState()?.armsGear ?? createDefaultArmsGearState();
    this.player.applyArmsGearState(armsGear, {
      resolveCustomBuster: (buildId) => (
        this.busterLabPlans.has(buildId)
          ? this._createCustomBusterArmDescriptor(buildId)
          : null
      ),
      refillBarrier: false,
    });
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
    return this._queueBusterGameCommand(() => this._updateBusterDraftNow(buildId, action));
  }

  async _updateBusterDraftNow(buildId, action = {}) {
    if (!this.busterLabEnabled || buildId === 'megaBuster') return { ok: false, message: 'Select a Custom Buster chassis.' };
    const blueprint = this._getBusterBlueprint(buildId);
    const draft = blueprint ?? this._getBusterBuildRecord(buildId, 'draft');
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
    const result = await this._queueBusterStorageOperation(() => (
      blueprint
        ? this.busterLabStorage.saveBlueprintAsync(next, { blueprintId: blueprint.blueprintId })
        : this.busterLabStorage.saveDraftAsync(next)
    ));
    if (!result.ok) return { ok: false, message: result.error?.message ?? 'The draft could not be stored.' };
    this.busterLabState = result.state;
    return { ok: true, draft: result.blueprint ?? result.draft ?? next, blueprint: result.blueprint ?? null };
  }

  async fabricateBusterModule(moduleId, options = {}) {
    if (!this.busterLabEnabled) return { ok: false, message: 'Enable the Buster Lab first.' };
    const recipe = BUSTER_RECIPE_LIST.find((entry) => entry.moduleId === moduleId);
    if (!recipe) return { ok: false, message: 'Roll does not have a recipe for that function.' };
    const discovery = getRecipeDiscoveryState(recipe, this._getBusterLabState()?.discovery);
    if (!discovery?.fullyDiscovered) return { ok: false, message: 'Roll has not discovered the complete recipe yet.' };
    const route = options.routeId === 'replication' || options.route === 'replication'
      ? 'replication'
      : 'original';
    const result = await this._queueBusterStorageOperation(() => (
      this.busterLabStorage.fabricateAsync(recipe, { route })
    ));
    if (!result.ok) {
      return { ok: false, message: result.reason === 'insufficient-resources' ? 'Roll is missing salvage for that recipe.' : 'Fabrication failed without consuming salvage.' };
    }
    this._refreshRollSalvageStorage();
    return { ok: true, message: `${recipe.name} fabricated.`, instance: result.instance };
  }

  async grantBusterLabDebugKit(mode = 'fullKit') {
    if (!this.busterLabEnabled) return { ok: false, message: 'Enable the Buster Lab first.' };
    if (!this.busterLabDebugEnabled) return { ok: false, message: 'Launch with ?busterLabDebug=1 to use persistent debug grants.' };
    if (mode !== 'fullKit') return { ok: false, message: 'Select the Full v0.2 testing kit first.' };
    const result = await this._queueBusterStorageOperation(() => (
      this.busterLabStorage.grantDebugKitAsync()
    ));
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

  refillBusterDebugBatteries() {
    if (!this.busterLabDebugEnabled) {
      return { ok: false, message: 'Launch with ?busterLabDebug=1 to use Buster runtime resets.' };
    }
    const runtime = this.busterRuntime;
    if (!runtime) return { ok: false, message: 'The Buster runtime is unavailable.' };
    const keys = [...runtime.states.keys()].filter((key) => runtime.plans.has(key));
    let resetCount = 0;
    for (const key of keys) {
      if (runtime.resetWeapon(key)) resetCount += 1;
    }
    return resetCount > 0
      ? {
        ok: true,
        message: `${resetCount} Buster batter${resetCount === 1 ? 'y' : 'ies'} refilled; active cycles and executions cleared.`,
        resetCount,
      }
      : { ok: false, message: 'No compiled Buster batteries are registered in this world.' };
  }

  async purchaseSecondBusterChassis() {
    if (!this.busterLabEnabled) return { ok: false, message: 'Enable the Buster Lab first.' };
    const result = await this._queueBusterStorageOperation(() => (
      this.busterLabStorage.purchaseSecondChassisAsync()
    ));
    if (!result.ok) {
      return { ok: false, message: result.reason === 'insufficient-scrap' ? 'Roll needs 20 identified scrap.' : 'Only two physical chassis are supported in v0.2.' };
    }
    this._refreshRollSalvageStorage();
    return { ok: true, message: 'Workshop Chassis B fabricated.' };
  }

  async equipCustomBuster(buildId, slotIndex) {
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
    const assignment = await this._queueBusterStorageOperation(() => (
      this.busterLabStorage.assignBuildToSlotAsync(buildId, slotIndex)
    ));
    if (!assignment.ok) return { ok: false, message: 'That build cannot be assigned to this slot.' };
    // Fixed Arms are permanent catalog unlocks, not inventory instances.
    // Replacing a slot changes only the loadout reference.
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
      staggerLedger: createBusterExecutionStaggerLedger(execution.executionId),
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
            if (action.actionId === 'emit-carrier' && executionState.trigger) {
              const programmedEvent = executionState.trigger.event;
              const reason = programmedEvent === 'impact' ? 'terminalRelay' : 'earlyCarrierTermination';
              controllerData.pendingChild = {
                reason,
                position: projectile.mesh.position.clone(),
                direction: projectile.direction.clone(),
              };
              return {
                dispose: true,
                reason,
                suppressDefaultDamage: programmedEvent !== 'impact',
                suppressDefaultExplosion: true,
                allowCluster: false,
              };
            }
            if (action.payload?.type === 'explosion') {
              this._detonateCompiledBusterExplosion(projectile, action, context);
              return { suppressDefaultDamage: true, suppressDefaultExplosion: true, dispose: true };
            }
            return { dispose: true };
          },
          onRangeEnd: ({ projectile }) => {
            if (action.actionId === 'emit-carrier' && executionState.trigger) {
              const reason = executionState.trigger.event === 'impact'
                ? 'terminalRelay'
                : 'earlyCarrierTermination';
              controllerData.pendingChild = {
                reason,
                position: projectile.mesh.position.clone(),
                direction: projectile.direction.clone(),
              };
              return { suppressExpiry: true, allowCluster: false, reason };
            }
            if (action.payload?.type === 'explosion') {
              this._detonateCompiledBusterExplosion(projectile, action, context);
              return { suppressExpiry: true, allowCluster: false, reason: 'busterExplosion' };
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
            if (before < delay && after + 1e-9 >= delay) {
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
              return {
                dispose: true,
                reason: 'delayTrigger',
                consumedTime: dt * fraction,
              };
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
        const damage = action.damagePower ?? action.power ?? 0;
        const stagger = action.stagger ?? 0;
        const attackMeta = {
          ...CUSTOM_BUSTER_ATTACK_META,
          suppressRewards: Boolean(context.noRewards),
          busterRange: Boolean(context.noRewards),
          executionId: execution.executionId,
          busterExecutionStaggerLedger: executionState.staggerLedger,
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
        targetGeometry: 'verticalCapsule',
        attackDomain: CUSTOM_BUSTER_ATTACK_META.attackDomain,
        suppressGenericOffense: true,
        suppressRewards: Boolean(context.noRewards),
        executionId: projectile.executionId,
        busterExecutionStaggerLedger: projectile.attackMeta?.busterExecutionStaggerLedger,
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

  _compileCustomBusterBuild(build, {
    revision = null,
    test = false,
    combatDepthLevel = this.combatDepthLevel,
  } = {}) {
    if (!build) return { ok: false, errors: [{ code: 'MISSING_BUILD', path: '', moduleId: null, message: 'No build source is available.' }] };
    const options = {
      context: this._getBusterValidationContext(build.buildId),
      revision: revision ?? this._getBuildRevision(build.buildId),
      combatDepthLevel,
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
    const plan = compileMegaBusterPlan({
      resolvedTuning: tuning,
      calibrationRevision: calibration.revision,
      combatDepthLevel: this.combatDepthLevel,
    });
    if (!plan?.ok) return null;
    this.busterLabPlans.set('megaBuster', plan);
    this.busterRuntime?.register(plan);
    return plan;
  }

  _recompileBusterPlans() {
    if (!this.busterLabEnabled) return;
    const nextPlans = new Map();
    this.busterLabPlans = nextPlans;
    this._recompileMegaBusterPlan();
    for (const build of this._getBusterLabState()?.chassisBuilds ?? []) {
      const compiled = this._compileCustomBusterBuild(build);
      if (!compiled?.ok) continue;
      nextPlans.set(build.buildId, compiled);
      this.busterRuntime?.register(compiled);
    }
    void this._quarantineInvalidBusterAssignments();
  }

  setBusterCombatDepthLevel(value, { encounterId = null } = {}) {
    const nextLevel = Math.max(1, Math.min(10, Math.round(Number(value) || 1)));
    if (nextLevel === this.combatDepthLevel && encounterId === this.busterCombatDepthEncounterId) {
      return false;
    }
    this.combatDepthLevel = nextLevel;
    this.busterCombatDepthEncounterId = encounterId;
    if (this.busterLabEnabled) this._recompileBusterPlans();
    return true;
  }

  async _quarantineInvalidBusterAssignments() {
    const state = this._getBusterLabState();
    const slots = state?.assignments?.slots ?? {};
    const invalidSlots = [1, 2].filter((slotIndex) => {
      const buildId = slots[String(slotIndex)] ?? slots[slotIndex];
      return buildId && !this.busterLabPlans.has(buildId);
    });
    if (invalidSlots.length === 0) return;
    const assignments = JSON.parse(JSON.stringify(state.assignments ?? { slots: {} }));
    assignments.slots ??= {};
    for (const slotIndex of invalidSlots) assignments.slots[String(slotIndex)] = null;
    const result = await this._queueBusterStorageOperation(() => (
      this.busterLabStorage.setAssignmentsAsync(assignments)
    ));
    if (result.ok) this.busterLabState = result.state;
    for (const slotIndex of invalidSlots) {
      if (this.player.armHotbar[slotIndex]?.type === 'customBusterArm') this.player.armHotbar[slotIndex] = null;
    }
    if (this.player.getActiveArmWeapon?.()?.type === 'customBusterArm') this.player.switchArmWeapon(0, true);
  }

  async saveBusterDraft(buildId) {
    const draft = this._getBusterBuildRecord(buildId, 'draft');
    if (!draft) return { ok: false, message: 'No draft exists for that chassis.' };
    const validation = validateBusterBuild(draft, { context: this._getBusterValidationContext(buildId) });
    if (!validation.valid) return { ok: false, message: validation.errors[0]?.message ?? 'The draft is invalid.', errors: validation.errors };
    const result = await this._queueBusterStorageOperation(() => (
      this.busterLabStorage.saveBuildAsync(draft)
    ));
    if (!result.ok) return { ok: false, message: result.error?.message ?? 'The revision could not be saved.', errors: result.errors ?? [] };
    this.busterLabState = result.state;
    if (!(result.state.migrations?.unknownModuleQuarantine?.length > 0)) {
      this.busterLabLoadWarning = null;
    }
    this._recompileBusterPlans();
    return { ok: true, message: `${draft.name ?? buildId} revision ${this._getBuildRevision(buildId)} saved.` };
  }

  _getBusterBlueprint(blueprintId = this.selectedBusterBlueprintId) {
    return this._getBusterLabState()?.blueprints?.find(
      (entry) => entry.blueprintId === blueprintId,
    ) ?? null;
  }

  _getBusterBlueprintKnowledge(blueprint) {
    const state = this._getBusterLabState();
    const owned = new Set((state?.moduleInstances ?? []).map((entry) => entry.moduleId));
    const lockedModuleIds = [];
    const unknownModuleIds = [];
    for (const node of blueprint?.program?.nodes ?? []) {
      const definition = getBusterModuleDefinition(node.moduleId);
      if (!definition) {
        unknownModuleIds.push(node.moduleId);
        continue;
      }
      if (!definition.physical || owned.has(node.moduleId)) continue;
      const recipe = BUSTER_RECIPE_LIST.find((entry) => entry.moduleId === node.moduleId);
      const discovery = recipe ? getRecipeDiscoveryState(recipe, state?.discovery) : null;
      if (!discovery?.discovered) lockedModuleIds.push(node.moduleId);
    }
    return {
      lockedModuleIds: [...new Set(lockedModuleIds)],
      unknownModuleIds: [...new Set(unknownModuleIds)],
      locked: lockedModuleIds.length > 0,
      invalid: unknownModuleIds.length > 0,
    };
  }

  async createBusterBlueprint(sourceBuildId = 'build-a') {
    const source = this._getBusterBuildRecord(sourceBuildId, 'draft')
      ?? this._getBusterBlueprint(sourceBuildId);
    if (!source) return { ok: false, message: 'Choose a physical draft to copy into a blueprint.' };
    const result = await this._queueBusterStorageOperation(() => (
      this.busterLabStorage.saveBlueprintAsync({
        ...source,
        blueprintId: null,
        name: `${source.name ?? 'Custom Buster'} Blueprint`,
      })
    ));
    if (!result.ok) return { ok: false, message: result.reason === 'blueprint-limit' ? 'All eight blueprint slots are in use.' : 'The blueprint could not be stored.' };
    this.busterLabState = result.state;
    this.selectedBusterBlueprintId = result.blueprint?.blueprintId ?? null;
    return { ok: true, message: 'Ownership-free blueprint created.', blueprint: result.blueprint, blueprintId: this.selectedBusterBlueprintId };
  }

  selectBusterBlueprint(blueprintId = null) {
    this.selectedBusterBlueprintId = this._getBusterBlueprint(blueprintId)?.blueprintId ?? null;
    this.pendingBusterMaterializationSuggestion = null;
    return { ok: true, blueprintId: this.selectedBusterBlueprintId };
  }

  async saveBusterBlueprint(blueprintId = this.selectedBusterBlueprintId) {
    const blueprint = this._getBusterBlueprint(blueprintId);
    if (!blueprint) return { ok: false, message: 'Select a blueprint first.' };
    const result = await this._queueBusterStorageOperation(() => (
      this.busterLabStorage.saveBlueprintAsync(blueprint, { blueprintId })
    ));
    if (!result.ok) return { ok: false, message: 'The blueprint could not be saved.' };
    this.busterLabState = result.state;
    return { ok: true, message: 'Blueprint revision saved.', blueprint: result.blueprint };
  }

  async deleteBusterBlueprint(blueprintId = this.selectedBusterBlueprintId) {
    if (!this._getBusterBlueprint(blueprintId)) return { ok: false, message: 'Select a blueprint first.' };
    const result = await this._queueBusterStorageOperation(() => (
      this.busterLabStorage.deleteBlueprintAsync(blueprintId)
    ));
    if (!result.ok) return { ok: false, message: 'The blueprint could not be deleted.' };
    this.busterLabState = result.state;
    if (this.selectedBusterBlueprintId === blueprintId) this.selectedBusterBlueprintId = null;
    this.pendingBusterMaterializationSuggestion = null;
    return { ok: true, message: 'Blueprint deleted.' };
  }

  exportBusterRecoveryData() {
    const payload = this.busterLabStorage?.exportRecoveryData?.();
    return payload
      ? { ok: true, payload, filename: `ruin-digger-buster-recovery-${this.busterLabStorage.saveContextId}.json` }
      : { ok: false, message: 'No Buster Lab recovery data is available.' };
  }

  exportBusterBlueprint(blueprintId = this.selectedBusterBlueprintId) {
    const result = this.busterLabStorage?.exportBlueprint?.(blueprintId);
    return result?.ok
      ? {
        ok: true,
        payload: result.payload,
        filename: `ruin-digger-buster-blueprint-${blueprintId}.json`,
      }
      : { ok: false, message: 'Select a blueprint to export.' };
  }

  async importBusterBlueprint(payload) {
    const result = await this._queueBusterStorageOperation(() => (
      this.busterLabStorage.importBlueprintAsync(payload)
    ));
    if (!result.ok) {
      return { ok: false, message: result.reason === 'blueprint-limit'
        ? 'All eight blueprint slots are in use.'
        : 'That file is not a valid ownership-free Buster blueprint.' };
    }
    this.busterLabState = result.state;
    this.selectedBusterBlueprintId = result.blueprint?.blueprintId ?? null;
    return {
      ok: true,
      message: 'Blueprint imported. Foreign ownership data was ignored.',
      blueprint: result.blueprint,
      blueprintId: this.selectedBusterBlueprintId,
    };
  }

  getLegacyBusterAdoptionPreview() {
    return this.busterLabStorage?.inspectLegacyV1?.() ?? { eligible: false, reason: 'unavailable' };
  }

  async adoptLegacyBusterLab() {
    const result = await this._queueBusterStorageOperation(() => (
      this.busterLabStorage.adoptLegacyV1({ confirmed: true })
    ));
    if (!result.ok) return { ok: false, message: 'Legacy Lab adoption could not be completed.' };
    if (!this.busterLabStorage.state.legacyBusterParts.starterRegistered) {
      await this._queueBusterStorageOperation(() => (
        this.busterLabStorage.ensureStarterPowerRaiserShadowAsync({
          type: 'powerRaiser',
          name: 'Power Raiser',
          rarity: 'standard',
          level: 1,
          slot: 'hands',
          category: 'Buster Part',
          baseStats: { attackDamage: 2 },
          affixes: [],
          value: 0,
        })
      ));
    }
    this._refreshRollSalvageStorage();
    this._recompileBusterPlans();
    this._restoreCustomBusterAssignments();
    return { ok: true, message: 'Legacy Lab data adopted into this campaign; the v1 source was retained.' };
  }

  async reloadBusterLabDurableState() {
    const result = await this.busterLabStorage?.reloadDurableState?.();
    if (!result?.ok) return { ok: false, message: 'The durable Lab state could not be reloaded.' };
    this._reconcileBusterLabRuntimeAfterReload();
    return { ok: true, message: this.busterLabStorage.readOnly
      ? 'Lab reloaded in read-only mode.'
      : 'Durable Lab state reloaded; writes resumed.' };
  }

  async beginNewBusterCampaign() {
    const result = await this.busterLabStorage?.beginNewCampaign?.({ confirmed: true });
    if (!result?.ok) return { ok: false, message: 'The new campaign could not be created.' };
    globalThis.location?.reload?.();
    return { ok: true, message: 'New campaign created.' };
  }

  suggestBusterMaterialization(
    blueprintId = this.selectedBusterBlueprintId,
    targetBuildId = 'build-a',
  ) {
    const target = this._getBusterBuildRecord(targetBuildId, 'draft');
    if (!target) return { ok: false, message: 'Choose an available physical chassis target.' };
    const suggestion = this.busterLabStorage.suggestMaterialization(blueprintId, {
      buildId: target.buildId,
      chassisId: target.chassisId,
    });
    if (!suggestion.ok) return { ok: false, message: 'Roll could not prepare that materialization.' };
    const decorated = {
      ...suggestion,
      suggestionId: `${suggestion.blueprintId}:${suggestion.blueprintRevision}:${suggestion.baseRevision}`,
      expectedRevision: suggestion.baseRevision,
      expectedWriteId: suggestion.baseWriteId,
      targetBuildId: target.buildId,
      targetChassisId: target.chassisId,
      title: `Materialize into ${target.name ?? target.buildId}`,
      requests: suggestion.requests.map((request) => ({
        ...request,
        requestId: request.nodeId,
        name: request.displayName,
        fullyDiscovered: request.discoveryLevel === 'full' || request.discoveryLevel === 'owned',
        redacted: !['full', 'owned'].includes(request.discoveryLevel),
        roleClue: request.clue,
      })),
    };
    this.pendingBusterMaterializationSuggestion = decorated;
    return { ok: true, message: 'Revision-bound materialization prepared.', suggestion: decorated };
  }

  async confirmBusterMaterialization(request = {}) {
    const suggestion = this.pendingBusterMaterializationSuggestion;
    if (!suggestion
      || request.blueprintId !== suggestion.blueprintId
      || (request.suggestionId && request.suggestionId !== suggestion.suggestionId)) {
      return { ok: false, message: 'That materialization suggestion is stale.' };
    }
    const result = await this._queueBusterStorageOperation(() => (
      this.busterLabStorage.confirmMaterialization(suggestion, {
        routeSelections: request.routes ?? {},
      })
    ));
    if (!result.ok) return { ok: false, message: result.reason === 'conflict' ? 'The Lab changed; prepare a new materialization suggestion.' : 'Materialization failed without consuming resources.' };
    this.busterLabState = result.state;
    this.pendingBusterMaterializationSuggestion = null;
    this._refreshRollSalvageStorage();
    this._recompileBusterPlans();
    return { ok: true, message: 'Blueprint materialized atomically.', build: result.result?.build, fabricated: result.result?.fabricated ?? [] };
  }

  setBusterRangeBenchmarkOptions(update = {}) {
    const next = { ...this.busterBenchmarkOptions };
    if (update.targetCount != null) next.targetCount = [1, 2, 4].includes(Number(update.targetCount)) ? Number(update.targetCount) : 1;
    if (update.depthLevel != null) next.depthLevel = [1, 5, 10].includes(Number(update.depthLevel)) ? Number(update.depthLevel) : 1;
    if (update.profile != null) {
      const profile = String(update.profile);
      next.profile = ['stationary', 'moving', 'armored', 'weakPoint', 'elite'].includes(profile)
        ? profile
        : 'stationary';
    }
    if (update.distanceBand != null) {
      next.distanceBand = ['near', 'mid', 'far'].includes(String(update.distanceBand))
        ? String(update.distanceBand)
        : 'mid';
    }
    if (update.layout != null) next.layout = update.layout === 'separated' ? 'separated' : 'compact';
    if (update.aimOffset != null) {
      next.aimOffset = ['center', 'half-radius', 'edge'].includes(String(update.aimOffset))
        ? String(update.aimOffset)
        : 'center';
    }
    this.busterBenchmarkOptions = next;
    return { ok: true, options: { ...next } };
  }

  _getCachedBusterBenchmarkSimulation(plan, scenarioOptions, cacheScope = 'range') {
    if (!plan?.ok) return null;
    const scenario = createBusterBenchmarkScenario({
      ...scenarioOptions,
      duration: 30,
      nonlethal: true,
    });
    let sourceSignature = '';
    try {
      const source = plan.sourceBuild ?? plan.source?.build;
      sourceSignature = source ? serializeBusterBuild(source) : '';
    } catch {
      sourceSignature = '';
    }
    const diagnosticOverrides = (plan.diagnostic?.overrides ?? [])
      .map((entry) => ({
        moduleId: entry.moduleId ?? null,
        field: entry.field ?? null,
        catalogValue: entry.catalogValue ?? null,
        diagnosticValue: entry.diagnosticValue ?? null,
      }))
      .sort((left, right) => (
        String(left.moduleId).localeCompare(String(right.moduleId))
          || String(left.field).localeCompare(String(right.field))
      ));
    const cacheKey = JSON.stringify({
      cacheScope,
      buildId: plan.buildId,
      revision: plan.sourceRevision ?? plan.buildRevision ?? plan.revision ?? 0,
      combatDepthLevel: plan.stats?.combatDepthLevel ?? scenario.combatDepthLevel,
      level10PowerScalar: plan.stats?.level10PowerScalar ?? 1,
      resolvedTuning: plan.resolvedTuning ?? plan.stats?.tuning ?? null,
      diagnosticOverrides,
      sourceSignature,
      scenarioId: scenario.id,
    });
    const cached = this.busterBenchmarkSimulationCache.get(cacheKey);
    if (cached) return cached;
    let simulation = null;
    try {
      simulation = simulateBusterEncounter(plan, scenario, { duration: 30 });
    } catch (error) {
      console.warn('Buster benchmark simulation failed', error);
    }
    if (!simulation) return null;
    this.busterBenchmarkSimulationCache.set(cacheKey, simulation);
    while (this.busterBenchmarkSimulationCache.size > 24) {
      this.busterBenchmarkSimulationCache.delete(this.busterBenchmarkSimulationCache.keys().next().value);
    }
    return simulation;
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
    const selectedBlueprint = state.blueprints?.find((entry) => entry.blueprintId === buildId) ?? null;
    const blueprintKnowledge = selectedBlueprint
      ? this._getBusterBlueprintKnowledge(selectedBlueprint)
      : null;
    const selectedRecord = selectedBlueprint
      ? {
        kind: 'blueprint',
        blueprintId: selectedBlueprint.blueprintId,
        buildId: selectedBlueprint.blueprintId,
        label: selectedBlueprint.name,
        available: true,
      }
      : builds.find((entry) => entry.buildId === buildId) ?? null;
    const draft = buildId === 'megaBuster'
      ? null
      : selectedBlueprint
        ? {
          ...selectedBlueprint,
          buildId: selectedBlueprint.blueprintId,
          chassisId: 'blueprint',
        }
        : this._getBusterBuildRecord(buildId, 'draft');
    const validation = draft
      ? selectedBlueprint
        ? validateBusterProgram(draft, CUSTOM_BUSTER_RULESET)
        : validateBusterBuild(draft, { context: this._getBusterValidationContext(buildId) })
      : { valid: false, ok: false, errors: [] };
    const compiled = validation.valid
      ? this._compileCustomBusterBuild(draft, { revision: this._getBuildRevision(buildId) + 1 })
      : null;
    const savedBuild = buildId === 'megaBuster' || selectedBlueprint
      ? null
      : this._getBusterBuildRecord(buildId, 'saved');
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
      const huntLinks = REAVERBOT_BOSS_PROFILES.flatMap((profile) => {
        const material = getReaverbotBossFeaturedMaterial(profile);
        if (!material || Number(recipe.parts?.[material.id] ?? 0) <= 0) return [];
        return [{
          bossProfileId: profile.id,
          title: profile.title,
          roleClue: profile.roleClue,
          materialName: discovery.fullyDiscovered ? material.name : null,
        }];
      });
      const routes = discovery.fullyDiscovered
        ? this.busterLabStorage.getFabricationRoutes(recipe).map((route) => ({
          routeId: route.id,
          label: route.label,
          requirements: route.requirements,
          missing: route.missing,
          affordable: route.affordable,
        }))
        : [];
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
        routes,
        huntLinks: discovery.level === 'unknown' ? [] : huntLinks,
      };
    });
    const calibration = this._ensureMegaCalibrationState(state);
    const calibrationSlots = calibration.slots.map((instanceId) => (
      calibration.instances.find((entry) => entry.instanceId === instanceId) ?? null
    ));
    const megaPlan = this.busterLabPlans.get('megaBuster');
    const tuningTotal = Object.values(draft?.tuning ?? {}).reduce((sum, value) => sum + Number(value || 0), 0);
    const ownedModuleIds = new Set((state.moduleInstances ?? []).map((entry) => entry.moduleId));
    const isRevealed = (moduleId) => {
      const definition = getBusterModuleDefinition(moduleId);
      if (!definition?.physical || ownedModuleIds.has(moduleId)) return true;
      const recipe = BUSTER_RECIPE_LIST.find((entry) => entry.moduleId === moduleId);
      return Boolean(recipe && getRecipeDiscoveryState(recipe, state.discovery)?.discovered);
    };
    const options = (entries) => entries.filter((entry) => !entry.value || isRevealed(entry.value));
    const blueprintViews = (state.blueprints ?? []).map((blueprint) => {
      const knowledge = this._getBusterBlueprintKnowledge(blueprint);
      const view = {
        blueprintId: blueprint.blueprintId,
        name: blueprint.name,
        revision: blueprint.revision,
        imported: Boolean(blueprint.imported),
        sourceContextId: blueprint.sourceContextId ?? null,
        tuning: { ...(blueprint.tuning ?? {}) },
        locked: knowledge.locked,
        redacted: knowledge.locked,
        invalid: knowledge.invalid,
        lockedModuleCount: knowledge.lockedModuleIds.length,
      };
      if (!knowledge.locked) view.program = JSON.parse(JSON.stringify(blueprint.program));
      return view;
    });
    const displayDraft = selectedBlueprint && blueprintKnowledge?.locked
      ? {
        ...draft,
        program: { rootNodeId: null, nodes: [], edges: [] },
      }
      : draft;
    const benchmarkDepthLevel = [1, 5, 10].includes(Number(this.busterBenchmarkOptions.depthLevel))
      ? Number(this.busterBenchmarkOptions.depthLevel)
      : 1;
    const benchmarkPlan = buildId === 'megaBuster'
      ? compileMegaBusterPlan({
        resolvedTuning: this._getMegaCalibrationRatings(state),
        calibrationRevision: calibration.revision,
        combatDepthLevel: benchmarkDepthLevel,
      })
      : blueprintKnowledge?.locked
        ? null
        : validation.valid
          ? this._compileCustomBusterBuild(draft, {
            revision: selectedBlueprint?.revision ?? this._getBuildRevision(buildId) + 1,
            combatDepthLevel: benchmarkDepthLevel,
          })
          : null;
    const benchmarkStats = benchmarkPlan?.stats ?? {};
    const measuredBenchmark = this.busterTestRange?.buildId === buildId
      ? this.busterTestRange.metrics
      : this.busterBenchmarkLastMetrics?.buildId === buildId
        ? this.busterBenchmarkLastMetrics
        : null;
    const benchmarkConfigKey = (config = {}) => JSON.stringify({
      targetCount: Number(config.targetCount) || 1,
      profile: config.profile ?? 'stationary',
      depthLevel: Number(config.depthLevel) || 1,
      distanceBand: config.distanceBand ?? 'mid',
      layout: config.layout ?? 'compact',
      aimOffset: config.aimOffset ?? 'center',
    });
    const measuredConfig = this.busterTestRange?.buildId === buildId
      ? this.busterTestRange.benchmarkConfig
      : measuredBenchmark?.config;
    const measuredMatchesFixture = Boolean(
      measuredBenchmark
      && benchmarkConfigKey(measuredConfig) === benchmarkConfigKey(this.busterBenchmarkOptions),
    );
    const sustainedPreview = benchmarkPlan?.ok
      ? this._getCachedBusterBenchmarkSimulation(benchmarkPlan, {
        depthLevel: benchmarkDepthLevel,
        targetCount: 1,
        profile: 'ordinary',
        motion: 'stationary',
        distanceBand: 'mid',
        layout: 'compact',
        aimOffset: 'center',
      }, 'lab-sustained-preview')
      : null;
    const expectedRange = benchmarkPlan?.ok
      ? this._getCachedBusterBenchmarkSimulation(benchmarkPlan, {
        ...this.busterBenchmarkOptions,
        depthLevel: benchmarkDepthLevel,
      }, 'production-range-parity')
      : null;
    const previewMetrics = sustainedPreview?.metrics ?? {};
    const expectedMetrics = expectedRange?.metrics ?? {};
    const measuredOutput10s = Number(measuredBenchmark?.output10s);
    const measuredOutput30s = Number(measuredBenchmark?.output30s);
    const expectedOutput10s = Number(expectedMetrics.output10s);
    const expectedOutput30s = Number(expectedMetrics.output30s);
    const parityDelta10s = measuredMatchesFixture
      && Number.isFinite(measuredOutput10s)
      && Number.isFinite(expectedOutput10s)
      ? measuredOutput10s - expectedOutput10s
      : null;
    const parityDelta30s = measuredMatchesFixture
      && Number.isFinite(measuredOutput30s)
      && Number.isFinite(expectedOutput30s)
      ? measuredOutput30s - expectedOutput30s
      : null;
    const benchmarkMetrics = {
      deliveredPower: benchmarkStats.effectivePower ?? 0,
      mitigation: measuredBenchmark?.mitigatedPower ?? expectedMetrics.mitigation ?? 0,
      openingMagazine: previewMetrics.openingMagazinePower
        ?? Number(benchmarkStats.effectivePower ?? 0) * Number(benchmarkStats.shotsPerCharge ?? 0),
      recoveryTime: previewMetrics.recoveryTime ?? getBusterMagazineRecoveryTime(benchmarkPlan),
      output10s: previewMetrics.output10s ?? 0,
      output30s: previewMetrics.output30s ?? 0,
      expectedOutput10s: expectedMetrics.output10s,
      expectedOutput30s: expectedMetrics.output30s,
      parityDelta10s,
      parityDelta30s,
      parityPercent10s: parityDelta10s != null && Math.abs(expectedOutput10s) > 0.000001
        ? parityDelta10s / expectedOutput10s * 100
        : null,
      parityPercent30s: parityDelta30s != null && Math.abs(expectedOutput30s) > 0.000001
        ? parityDelta30s / expectedOutput30s * 100
        : null,
      occupancy: expectedMetrics.peakOccupancy
        ?? benchmarkPlan?.occupancy?.peakMovingProjectiles
        ?? benchmarkPlan?.peakProjectileReservation
        ?? 1,
      uniqueTargetsDamagedPerTrigger: expectedMetrics.uniqueTargetsDamagedPerTrigger,
      uniqueTargetsDamaged10s: expectedMetrics.uniqueTargetsDamaged10s,
      weakPointResult: benchmarkPlan?.payload?.type === 'explosion'
        ? 'Splash: body only'
        : 'Direct eligible',
      stagger: expectedMetrics.staggerGranted
        ?? benchmarkPlan?.preview?.damage?.stagger
        ?? benchmarkStats.stagger
        ?? 0,
      misses: expectedMetrics.misses ?? 0,
      releaseToFirstImpact: expectedMetrics.releaseToFirstImpact,
      inputToFirstImpact: expectedMetrics.inputToFirstImpact,
      ...(measuredBenchmark ?? {}),
    };
    // Keep exact expected values and parity data authoritative when measured
    // production metrics are overlaid onto the same result card.
    benchmarkMetrics.expectedOutput10s = expectedMetrics.output10s;
    benchmarkMetrics.expectedOutput30s = expectedMetrics.output30s;
    benchmarkMetrics.parityDelta10s = parityDelta10s;
    benchmarkMetrics.parityDelta30s = parityDelta30s;
    benchmarkMetrics.parityPercent10s = benchmarkMetrics.parityPercent10s ?? null;
    benchmarkMetrics.parityPercent30s = benchmarkMetrics.parityPercent30s ?? null;
    const benchmarkRange = benchmarkPlan?.ok ? {
      configurable: !this.busterTestRange?.active,
      running: Boolean(this.busterTestRange?.active),
      status: this.busterTestRange?.active
        ? 'Running production-backed benchmark'
        : measuredBenchmark && !measuredMatchesFixture
          ? 'Ready — last live measurement used a different fixture'
          : sustainedPreview
            ? 'Ready — exact packet simulation cached'
            : 'Preview unavailable',
      config: { ...this.busterBenchmarkOptions },
      expectedStatus: expectedRange?.status ?? 'invalid',
      metrics: benchmarkMetrics,
    } : null;
    const unlinkedMigration = state.migrations?.unlinkedLegacyCalibrationsV2;
    const permanentMigrationWarning = unlinkedMigration?.count > 0
      ? `${unlinkedMigration.count} calibration${unlinkedMigration.count === 1 ? '' : 's'} came from the old destructive conversion. Their original legacy Items could not be reconstructed, so they remain feature-on-only.`
      : null;
    const persistenceStatus = this.busterLabStorage.getPersistenceStatus?.() ?? {};
    const persistenceLabel = !this.busterLabStorage.readOnly
      ? 'Durable storage ready'
      : persistenceStatus.writePauseReason === 'external-conflict'
        ? 'Read-only — another tab wrote newer Lab data; reload or export before continuing'
        : persistenceStatus.writePauseReason === 'lock-timeout'
          ? 'Read-only — the campaign lock timed out; reload or export before continuing'
          : 'Read-only — durable browser locking is unavailable';

    return {
      enabled: true,
      debugPresetEnabled: this.busterLabDebugEnabled,
      debugGrantCount: Math.max(0, Math.trunc(Number(state.migrations?.debugKitGrantCount)) || 0),
      warning: this.busterLabStorage.lastWarning
        ?? this.busterLabLoadWarning
        ?? state.warning
        ?? permanentMigrationWarning,
      persistence: {
        ...persistenceStatus,
        readOnly: Boolean(this.busterLabStorage.readOnly),
        status: persistenceLabel,
        saveContextId: this.busterLabStorage.saveContextId,
        revision: this.busterLabStorage.revision,
        writeId: this.busterLabStorage.writeId,
        legacyAdoption: this.busterLabStorage.inspectLegacyV1?.(),
        message: 'Only Roll salvage, Lab ownership, blueprints, assignments, and migration records persist in this prototype.',
      },
      identifiedScrap: this.rollSalvageStorage.identifiedScrap,
      builds,
      blueprints: blueprintViews,
      blueprintCapacity: 8,
      selectedBlueprint: blueprintViews.find((entry) => entry.blueprintId === selectedBlueprint?.blueprintId) ?? null,
      selectedBlueprintId: selectedBlueprint?.blueprintId ?? null,
      materializationSuggestion: selectedBlueprint?.blueprintId === this.pendingBusterMaterializationSuggestion?.blueprintId
        ? this.pendingBusterMaterializationSuggestion
        : null,
      canSuggestMaterialization: Boolean(selectedBlueprint && !blueprintKnowledge?.invalid),
      sandboxEnabled: this.busterLabSandboxEnabled,
      canSandbox: Boolean(
        this.busterLabSandboxEnabled
        && (buildId === 'megaBuster' ? megaPlan : compiled?.ok),
      ),
      benchmarkRange,
      build: selectedRecord ? { ...selectedRecord, draft: displayDraft, savedBuild } : null,
      tuningRemaining: draft ? 16 - tuningTotal : 0,
      programSelections: draft && !blueprintKnowledge?.locked ? this._getProgramSelections(draft) : null,
      programOptions: {
        emitter: options([
          { value: '', label: 'Choose emitter' },
          { value: 'pulseBolt', label: 'Pulse Bolt' },
          { value: 'mortarShell', label: 'Mortar Shell' },
        ]),
        rootModifier: options([{ value: '', label: 'None' }, { value: 'pursuitGuidance', label: 'Pursuit Guidance' }]),
        trigger: options([
          { value: '', label: 'None (direct)' },
          { value: 'atApex', label: 'At Apex' },
          { value: 'onImpact', label: 'Terminal Relay (built in)' },
          { value: 'afterDelay', label: 'After 0.60s' },
        ]),
        childModifier: options([{ value: '', label: 'None' }, { value: 'pursuitGuidance', label: 'Pursuit Guidance' }]),
        splitter: options([
          { value: '', label: 'None' },
          { value: 'spread3', label: 'Spread ×3' },
          { value: 'cluster5', label: 'Cluster ×5' },
        ]),
        payload: options([{ value: 'pulsePayload', label: 'Native Pulse' }, { value: 'explosion', label: 'Explosion' }]),
      },
      nodeCount: blueprintKnowledge?.locked ? 0 : draft?.program?.nodes?.length ?? 0,
      validation: blueprintKnowledge?.locked
        ? { valid: false, ok: false, errors: [], warnings: [] }
        : validation,
      result: blueprintKnowledge?.locked ? null : compiled?.ok ? compiled : null,
      canSave: Boolean(selectedRecord?.available && validation.valid && !selectedBlueprint),
      canEquip: Boolean(
        validation.valid
        && savedBuild
        && this._isBusterDraftSaved(buildId)
        && this.busterLabPlans.has(buildId)
      ),
      canTest: buildId === 'megaBuster'
        ? Boolean(megaPlan)
        : Boolean(validation.valid && compiled?.ok && !blueprintKnowledge?.locked),
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

  captureWorldContext(label = 'production') {
    const values = {};
    for (const field of BUSTER_WORLD_CONTEXT_FIELDS) values[field] = this[field];
    return {
      kind: 'gameWorldContext',
      label,
      values,
      layoutSeed: this.dungeon?.layoutSeed ?? this.dungeonLayoutSeed,
      capturedAt: this.elapsedTime,
    };
  }

  activateWorldContext(context) {
    if (!context || context.kind !== 'gameWorldContext') return false;
    for (const field of BUSTER_WORLD_CONTEXT_FIELDS) this[field] = context.values[field];
    setActiveEnemyIdAllocator(this.enemyIdAllocator);
    this.cameraController.snapTo(this.player);
    this._updateDungeonRenderCulling(0, { force: true });
    return true;
  }

  _resetWorldContextFieldsForSandbox(sourceWorld) {
    this.scene = new THREE.Scene();
    this.scene.name = 'busterSandboxScene';
    this.scene.background = new THREE.Color(0x171712);
    this.scene.fog = new THREE.Fog(0x171712, 24, 58);
    this.worldKind = 'dungeon';
    this.worldLifecycle = createWorldLifecycleState('dungeon');
    this.transitionState = this.worldLifecycle.state;
    this.activeWorldBundle = null;
    this.overworldController = null;
    this.enemies = [];
    this.enemyIdAllocator = createEnemyIdAllocator('sandbox-enemy');
    setActiveEnemyIdAllocator(this.enemyIdAllocator);
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
    this.flamethrowerEffects = new Map();
    this.pendingExplosions = [];
    this.explosionDispatchDepth = 0;
    this.elapsedTime = 0;
    this.hitStopTimer = 0;
    this.hitStopTimeScale = 1;
    this.arenaRadius = sourceWorld?.values?.arenaRadius ?? 82;
    this.platformingPlatforms = [];
    this.dynamicPlatformingPlatforms = [];
    this.connectorLiftRuntime = null;
    this.connectorTrackTrapRuntime = null;
    this.bossStageRuntime = null;
    this.platformingLedgeCandidates = [];
    this.debugLedgeTester = null;
    this.debugLedgeCandidates = [];
    this.debugLedgePlatform = null;
    this.debugSpawnedPlatforms = [];
    this.debugSpawnedPlatformGroup = new THREE.Group();
    this.debugSpawnedPlatformGroup.name = 'busterSandboxDebugPlatforms';
    this.cameraOcclusionEntries = [];
    this.cameraOcclusionBins = new Map();
    this.cameraOcclusionWallProximityBins = new Map();
    this.cameraOcclusionProximityRecordByKey = new Map();
    this.cameraOcclusionWallProximityCandidateKeys = new Set();
    this.cameraOcclusionExpandedVerticalRecordKeys = new Set();
    this.cameraOcclusionExpandedSurfaceRecordKeys = new Set();
    this.cameraOcclusionForwardVerticalHits = [];
    this.cameraOcclusionCandidateSet = new Set();
    this.cameraOcclusionCandidateObjects = [];
    this.cameraOcclusionHits = [];
    this.cameraOcclusionOwnerByObject = new WeakMap();
    this.cameraOcclusionHiddenOwners = new Set();
    this.cameraOcclusionHiddenInstances = [];
    this.cameraOcclusionHiddenInstanceKeys = new Set();
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
    this.ruinFloor = sourceWorld?.values?.ruinFloor ?? 1;
    this.largeRefractorsSecured = 0;
    this.ruinCompleted = false;
    this.expeditionAccepted = false;
    this.expeditionActive = true;
    this.isGameOver = false;
    this.combatDepthLevel = sourceWorld?.values?.combatDepthLevel ?? 1;
    this.busterCombatDepthEncounterId = null;
    this.reaverbotBaseSeed = sourceWorld?.values?.reaverbotBaseSeed;
    this.reaverbotSeedLabel = sourceWorld?.values?.reaverbotSeedLabel;
    this.reaverbotGeneration = sourceWorld?.values?.reaverbotGeneration ?? 0;
    this.reaverbotRunSeed = sourceWorld?.values?.reaverbotRunSeed;
  }

  _copyPlayerForBusterSandbox(sourcePlayer) {
    const player = new Player();
    player.baseStats = { ...(sourcePlayer?.baseStats ?? player.baseStats) };
    player.level = sourcePlayer?.level ?? 1;
    player.experience = sourcePlayer?.experience ?? 0;
    player.experienceToNext = sourcePlayer?.experienceToNext ?? 40;
    player.armHotbar = [...(sourcePlayer?.armHotbar ?? player.armHotbar)];
    player.utilityArms = [...(sourcePlayer?.utilityArms ?? [])];
    player.activeUtilityArmIndex = sourcePlayer?.activeUtilityArmIndex ?? 0;
    player.busterUpgradeSlots = [...(sourcePlayer?.busterUpgradeSlots ?? player.busterUpgradeSlots)];
    if (sourcePlayer?.gearLoadout?.snapshot) {
      player.applyGearLoadoutState(sourcePlayer.gearLoadout.snapshot(), { refillBarrier: true });
    }
    player.recalculateStats();
    player.health = player.stats.maxHealth;
    player.dead = false;
    player.lastMoveDirection.copy(sourcePlayer?.lastMoveDirection ?? new THREE.Vector3(0, 0, 1));
    return player;
  }

  createBusterSandboxContext({ sourceWorld, plan } = {}) {
    if (!sourceWorld || !plan) return null;
    this._resetWorldContextFieldsForSandbox(sourceWorld);
    this.dungeonLayoutSeed = sourceWorld.layoutSeed ?? this.dungeonLayoutSeed;
    this._creatingBusterSandbox = true;
    try {
      this._buildWorld();
    } finally {
      this._creatingBusterSandbox = false;
    }
    this.scene.add(this.debugSpawnedPlatformGroup);

    this.player = this._copyPlayerForBusterSandbox(sourceWorld.values.player);
    this.player.root.position.copy(this.dungeon.playerStart);
    this.player.lastMoveDirection.set(0, 0, 1);
    this.scene.add(this.player.root);

    this.inventory = new Inventory(sourceWorld.values.inventory?.capacity ?? 54);
    this.inventory.items = [...(sourceWorld.values.inventory?.items ?? [])];
    this.inventory.gold = sourceWorld.values.inventory?.gold ?? 0;
    this.inventory.unidentifiedScrap = sourceWorld.values.inventory?.unidentifiedScrap ?? 0;
    this.inventory.unidentifiedRecoveries = JSON.parse(JSON.stringify(
      sourceWorld.values.inventory?.unidentifiedRecoveries ?? [],
    ));

    const getFloorElevation = (position) => this.dungeonController?.getSurfaceElevationAt?.(position);
    this.lootSystem = new LootSystem(this.scene, { getFloorElevation });
    this.refractors = new RefractorPickupSystem(this.scene, { getFloorElevation });
    this.projectiles = new ProjectileSystem(this);
    this.busterRuntime = new BusterRuntime({
      executeShot: (execution) => this._executeCompiledBusterShot(execution),
      cancelExecution: ({ token, reason }) => {
        this.projectiles.cancelWhere(
          (projectile) => projectile.reservationToken === token,
          reason ?? 'busterCancelled',
        );
      },
    });
    this.combat = new CombatSystem(this);
    this.player.onDodgeStarted = () => this.combat.cancelForDodge();
    this.player.onLedgeClingStarted = () => this.combat.cancelForLedgeCling();
    this.player.onDeathStarted = () => this.combat.cancelForDeath();
    this.player.onSwordJumpSlashLandingRecoveryStarted = (startProgress) => (
      this.combat.beginSwordJumpSlashLandingTrail(startProgress)
    );
    this.dungeonController = new DungeonController(this, this.dungeon);
    this._replaceConnectorLiftRuntimeForDungeon(this.dungeon);
    this.player.jumpLedgeClingResolver = (context) => this._tryResolvePlatformLedgeCling(context);
    this.player.jumpPlatformLandingResolver = (context) => this._tryResolvePlatformLanding(context);
    this.player.powerKnockbackTravelResolver = ({ fromPosition, position }) => (
      this.dungeonController.resolvePowerKnockbackTravel(fromPosition, position)
    );
    this.player.powerKnockbackLandingResolver = ({ position, direction, originPosition }) => (
      this.dungeonController.resolvePowerKnockbackLanding(position, direction, originPosition)
    );
    this.spawner = new EnemySpawner(this);
    if (sourceWorld.values.spawner?.runSeed != null) this.spawner.runSeed = sourceWorld.values.spawner.runSeed;
    this.mapEvents = new MapEventSystem(this);

    const sandboxPlan = deepFreezeBusterValue({
      ...plan,
      weaponKey: `sandbox:${plan.buildId}:${plan.revision ?? 0}`,
      sandbox: true,
      testRange: false,
    });
    const slotIndex = sandboxPlan.isMegaBuster ? 0 : 1;
    if (!sandboxPlan.isMegaBuster) {
      this.player.armHotbar[slotIndex] = this._createCustomBusterArmDescriptor(plan.buildId);
    }
    this.player.switchArmWeapon(slotIndex, true);
    this.combat.swapTimer = 0;
    this.busterRuntime.register(sandboxPlan);
    this.busterRuntime.resetWeapon(sandboxPlan.weaponKey);
    this.busterRuntime.equip(sandboxPlan);
    this._collectCameraOcclusionWalls();
    this._collectDungeonRenderCullGroups();
    this._updateDungeonRenderCulling(0, { force: true });

    const context = this.captureWorldContext('busterSandbox');
    context.plan = sandboxPlan;
    this.activateWorldContext(sourceWorld);
    return context;
  }

  disposeWorldContext(context, reason = 'sandboxExit', { preserveContext = null } = {}) {
    if (!context || context.kind !== 'gameWorldContext') return false;
    const owned = this._collectRenderResources(context.values.scene);
    const preserved = this._collectRenderResources(preserveContext?.values?.scene);
    this.projectiles?.clear?.(reason);
    this.combat?._clearPendingAttacks?.();
    this.combat?._clearMines?.();
    for (const enemy of this.enemies ?? []) {
      enemy.dispose?.();
      enemy.root?.removeFromParent?.();
    }
    this.enemies.length = 0;
    this.lootSystem?.clear?.();
    this.refractors?.clear?.();
    for (const animator of this.dungeon?.npcAnimators ?? []) animator.dispose?.();
    context.values.connectorLiftRuntime?.dispose?.();
    this.player.dispose?.();

    for (const geometry of owned.geometries) {
      if (!preserved.geometries.has(geometry) && !geometry.userData?.sharedTimedEffectGeometry) geometry.dispose?.();
    }
    for (const material of owned.materials) {
      if (!preserved.materials.has(material)) material.dispose?.();
    }
    for (const texture of owned.textures) {
      if (!preserved.textures.has(texture)) texture.dispose?.();
    }
    context.values.scene.clear();
    context.disposed = true;
    return true;
  }

  enterBusterSandbox(buildId = 'build-a') {
    if (!this.busterLabSandboxEnabled) {
      return { ok: false, message: 'Launch with ?busterLab=sandbox to use the disposable dungeon.' };
    }
    if (this.busterSandboxSession?.active) return { ok: false, message: 'The Buster sandbox is already active.' };
    if (this.busterTestRange?.active) {
      return { ok: false, message: 'Exit the Buster Test Range before entering the disposable dungeon.' };
    }
    if (this.busterGameCommandPending > 0 || this.busterStorageOperationPending > 0) {
      return {
        ok: false,
        reason: 'campaign-command-pending',
        message: 'Wait for Roll to finish the current campaign transaction before entering the sandbox.',
      };
    }
    const blueprint = this._getBusterBlueprint(buildId);
    const source = blueprint
      ? { ...blueprint, buildId: blueprint.blueprintId, chassisId: 'sandbox-blueprint' }
      : this._getBusterBuildRecord(buildId, 'draft');
    let plan = buildId === 'megaBuster'
      ? this.busterLabPlans.get('megaBuster')
      : this._compileCustomBusterBuild(source, {
        revision: this._getBuildRevision(buildId) + 1,
        test: true,
      });
    if (!plan?.ok) {
      return { ok: false, message: plan?.errors?.[0]?.message ?? 'The sandbox blueprint is invalid.' };
    }

    const production = this.captureWorldContext('production');
    const inventoryWasOpen = this.inventoryOpen;
    const inventoryMode = this.ui?.inventoryMode ?? 'roll';
    const debugWasOpen = this.poseDebugOpen;
    const debugTab = this.ui?.poseDebugTab ?? 'buster';
    const sandbox = this.createBusterSandboxContext({ sourceWorld: production, plan });
    if (!sandbox) return { ok: false, message: 'The disposable dungeon could not be created.' };
    this.busterSandboxSession = {
      active: true,
      production,
      sandbox,
      plan: sandbox.plan,
      inventoryWasOpen,
      inventoryMode,
      debugWasOpen,
      debugTab,
    };
    this.setInventoryOpen(false);
    this.setPoseDebugOpen(false);
    this.keys.clear();
    this.pointer.primary = false;
    this.pointer.primaryPressed = false;
    this.activateWorldContext(sandbox);
    this.cameraController.snapTo(this.player);
    this.ui.showToast('Disposable Buster dungeon active — Escape returns to Roll', '#7df8ff');
    return { ok: true, plan: sandbox.plan };
  }

  exitBusterSandbox(reason = 'sandboxExit') {
    const session = this.busterSandboxSession;
    if (!session?.active) return false;
    const currentSandbox = this.captureWorldContext('busterSandbox');
    this.disposeWorldContext(currentSandbox, reason, { preserveContext: session.production });
    this.activateWorldContext(session.production);
    this.busterSandboxSession = null;
    this.keys.clear();
    this.pointer.primary = false;
    this.pointer.primaryPressed = false;
    this.cameraController.snapTo(this.player);
    if (session.debugWasOpen) {
      this.setPoseDebugOpen(true);
      this.ui?._selectPoseDebugTab?.(session.debugTab ?? 'buster');
    } else if (session.inventoryWasOpen) {
      this.setInventoryOpen(true, { mode: session.inventoryMode });
      this.ui?._selectRollWorkshopTab?.('buster');
    }
    this.ui.showToast('Production run restored; sandbox changes discarded', '#7df8ff');
    return true;
  }

  enterBusterTestRange(buildId = 'build-a') {
    if (!this.busterLabEnabled) return { ok: false, message: 'Enable the Buster Lab first.' };
    if (this.busterSandboxSession?.active) {
      return { ok: false, message: 'Exit the disposable Buster dungeon before entering the range.' };
    }
    if (this.busterTestRange?.active) this.exitBusterTestRange();
    let plan = null;
    if (buildId === 'megaBuster') {
      const mega = this.busterLabPlans.get('megaBuster');
      if (mega) {
        const rangeMega = compileMegaBusterPlan({
          resolvedTuning: mega.resolvedTuning ?? this._getMegaCalibrationRatings(this._getBusterLabState()),
          calibrationRevision: mega.revision,
          combatDepthLevel: this.busterBenchmarkOptions.depthLevel,
        });
        if (!rangeMega?.ok) return { ok: false, message: 'The Mega Buster benchmark plan could not compile.' };
        plan = deepFreezeBusterValue({
          ...rangeMega,
          weaponKey: `test:megaBuster:${rangeMega.revision}`,
          testRange: true,
        });
      }
    } else {
      const blueprint = this._getBusterBlueprint(buildId);
      if (blueprint && this._getBusterBlueprintKnowledge(blueprint).locked) {
        return { ok: false, message: 'Discover this blueprint’s modules before using the production range.' };
      }
      const draft = blueprint
        ? { ...blueprint, buildId: blueprint.blueprintId, chassisId: 'range-blueprint' }
        : this._getBusterBuildRecord(buildId, 'draft');
      const validation = draft
        ? blueprint
          ? validateBusterProgram(draft, CUSTOM_BUSTER_RULESET)
          : validateBusterBuild(draft, { context: this._getBusterValidationContext(buildId) })
        : { valid: false, errors: [] };
      if (!validation.valid) {
        return { ok: false, message: validation.errors[0]?.message ?? 'The draft is not valid for testing.', errors: validation.errors };
      }
      const compiled = this._compileCustomBusterBuild(draft, {
        revision: this._getBuildRevision(buildId) + 1,
        test: true,
        combatDepthLevel: this.busterBenchmarkOptions.depthLevel,
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
    const benchmarkConfig = { ...this.busterBenchmarkOptions };
    const benchmarkScenario = createBusterBenchmarkScenario({
      ...benchmarkConfig,
      duration: 30,
      nonlethal: true,
    });
    const dummies = benchmarkScenario.targets.map((target, index) => createBusterRangeDummy(
      `range-${benchmarkScenario.targetProfileId}-${index + 1}`,
      bayCenter.clone().add(new THREE.Vector3(
        target.root.position.x,
        target.root.position.y,
        target.root.position.z,
      )),
      {
        moving: target.motion === 'lateral',
        profile: benchmarkScenario.targetProfileId,
        depthLevel: benchmarkScenario.combatDepthLevel,
        rotationY: Math.atan2(target.forward.x, target.forward.z),
        motionRight: target.right,
        motionPhase: target.phase,
        facingOrigin: bayCenter,
        benchmarkProfile: benchmarkScenario.profile,
      },
    ));
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
      debugWasOpen: this.poseDebugOpen,
      debugTab: this.ui?.poseDebugTab ?? 'buster',
      runtimeResources,
      combatSwapTimer: this.combat.swapTimer,
    };
    this.busterTestRange = {
      active: true,
      buildId,
      plan,
      group: rangeGroup,
      dummies,
      benchmarkConfig,
      benchmarkScenario,
      startedAt: this.elapsedTime,
      startExecutionCounter: this.busterRuntime.executionCounter,
      firstReleaseAt: null,
      peakOccupancy: 0,
      energyTimeline: [],
      metrics: null,
      restore,
      resources: { floorGeometry, floorMaterial, railGeometry, railMaterial },
    };
    this.setInventoryOpen(false);
    this.setPoseDebugOpen(false);
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
    this.busterBenchmarkLastMetrics = range.metrics
      ? { ...range.metrics, buildId: range.buildId, config: { ...range.benchmarkConfig } }
      : null;
    this.busterTestRange = null;
    this.player.armHotbar = [...restore.armHotbar];
    this.arenaRadius = restore.arenaRadius;
    this.player.root.position.copy(restore.position);
    this.player.root.rotation.y = restore.rotationY;
    this.player.lastMoveDirection.copy(restore.lastMoveDirection);
    this.player.switchArmWeapon(restore.activeArmIndex, true);
    this.combat.swapTimer = restore.combatSwapTimer;
    this.cameraController.snapTo(this.player);
    if (restore.debugWasOpen) {
      this.setPoseDebugOpen(true);
      this.ui?._selectPoseDebugTab?.(restore.debugTab ?? 'buster');
    } else if (restore.inventoryWasOpen) {
      this.setInventoryOpen(true, { mode: restore.inventoryMode });
    }
    this.ui.showToast('Returned from the Buster Test Range', '#7df8ff');
    return true;
  }

  _updateBusterTestRange(dt) {
    const range = this.busterTestRange;
    if (!range?.active) return;
    for (const dummy of range.dummies) dummy.update(dt);
    const elapsed = Math.max(0.001, this.elapsedTime - range.startedAt);
    const runtimeHud = this.busterRuntime?.getHudState(range.plan.weaponKey);
    const reserved = this.busterRuntime?.getReservedProjectileCount?.() ?? 0;
    range.peakOccupancy = Math.max(range.peakOccupancy, reserved);
    const lastSample = range.energyTimeline.at(-1);
    if (!lastSample || elapsed - lastSample.time >= 0.1) {
      range.energyTimeline.push({
        time: elapsed,
        energy: runtimeHud?.energy ?? range.plan.stats?.maxEnergy ?? 0,
        state: runtimeHud?.recoveryLocked
          ? 'RECOVERY'
          : runtimeHud?.cycleRemaining > 0
            ? 'CYCLE'
            : runtimeHud?.blockReason === 'ENERGY'
              ? 'ENERGY'
              : 'READY',
      });
      if (range.energyTimeline.length > 320) range.energyTimeline.shift();
    }
    const aggregate = range.dummies.reduce((summary, dummy) => {
      const metrics = dummy.benchmark;
      summary.deliveredPower += metrics.deliveredPower;
      summary.mitigatedPower += metrics.mitigatedPower;
      summary.hitCount += metrics.hitCount;
      summary.weakPointHits += metrics.weakPointHits;
      summary.stagger += metrics.stagger;
      summary.kills += metrics.kills;
      summary.clearTimes.push(...metrics.clearTimes);
      if (metrics.firstHitAt != null) {
        summary.firstHitAt = summary.firstHitAt == null
          ? metrics.firstHitAt
          : Math.min(summary.firstHitAt, metrics.firstHitAt);
      }
      return summary;
    }, {
      deliveredPower: 0,
      mitigatedPower: 0,
      hitCount: 0,
      weakPointHits: 0,
      stagger: 0,
      kills: 0,
      clearTimes: [],
      firstHitAt: null,
    });
    const shotsFired = Math.max(0, this.busterRuntime.executionCounter - range.startExecutionCounter);
    if (shotsFired > 0 && range.firstReleaseAt == null) range.firstReleaseAt = elapsed;
    const releaseElapsed = range.firstReleaseAt == null
      ? 0
      : Math.max(0.001, elapsed - range.firstReleaseAt);
    const expectedPackets = shotsFired * Math.max(1, range.plan.projectileCount ?? 1);
    const averageClearTime = aggregate.clearTimes.length > 0
      ? aggregate.clearTimes.reduce((sum, value) => sum + value, 0) / aggregate.clearTimes.length
      : null;
    range.metrics = {
      deliveredPower: aggregate.deliveredPower,
      mitigation: aggregate.mitigatedPower,
      openingMagazine: (range.plan.stats?.effectivePower ?? 0) * (range.plan.stats?.shotsPerCharge ?? 0),
      recoveryTime: getBusterMagazineRecoveryTime(range.plan),
      output10s: releaseElapsed > 0 ? aggregate.deliveredPower / releaseElapsed * 10 : 0,
      output30s: releaseElapsed > 0 ? aggregate.deliveredPower / releaseElapsed * 30 : 0,
      occupancy: range.peakOccupancy,
      weakPointResult: `${aggregate.weakPointHits} direct weak-point hit${aggregate.weakPointHits === 1 ? '' : 's'}`,
      stagger: aggregate.stagger,
      misses: Math.max(0, expectedPackets - aggregate.hitCount),
      ttk: averageClearTime,
      releaseToFirstImpact: aggregate.firstHitAt == null || range.firstReleaseAt == null
        ? null
        : Math.max(0, aggregate.firstHitAt - range.firstReleaseAt),
      inputToFirstImpact: aggregate.firstHitAt,
      kills: aggregate.kills,
      energyTimeline: [...range.energyTimeline],
    };
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
    const rolling = Boolean(options.rolling);
    const minimumSampleDistance = Math.max(0.001, options.minimumSampleDistance ?? 0.001);
    const maximumTrailLength = Number.isFinite(options.maximumTrailLength)
      ? Math.max(0.1, options.maximumTrailLength)
      : null;
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
        trailMode: options.trailPhase ?? 'liveBladeSweep',
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
      rolling,
      minimumSampleDistance,
      maximumTrailLength,
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
      || (!trail.rolling && trail.samples.length >= trail.maxSamples)) {
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
    const minimumSampleDistanceSquared = (trail.minimumSampleDistance ?? 0.001) ** 2;
    if (previous
      && previous.base.distanceToSquared(sampleBase) < minimumSampleDistanceSquared
      && previous.tip.distanceToSquared(sampleTip) < minimumSampleDistanceSquared) {
      return false;
    }

    const sample = {
      base: sampleBase,
      tip: sampleTip,
      baseWorld: baseWorld.clone(),
      tipWorld: tipWorld.clone(),
      progress: Number.isFinite(progress) ? progress : null,
    };
    if (trail.rolling && trail.samples.length >= trail.maxSamples) {
      trail.samples.shift();
    }
    trail.samples.push(sample);
    if (trail.rolling && Number.isFinite(trail.maximumTrailLength)) {
      let accumulatedLength = 0;
      for (let index = trail.samples.length - 1; index > 0; index -= 1) {
        const current = trail.samples[index];
        const prior = trail.samples[index - 1];
        const segmentLength = Math.max(
          current.base.distanceTo(prior.base),
          current.tip.distanceTo(prior.tip),
        );
        if (accumulatedLength + segmentLength > trail.maximumTrailLength) {
          const boundaryRatio = segmentLength > 0
            ? (trail.maximumTrailLength - accumulatedLength) / segmentLength
            : 0;
          const boundaryProgress = Number.isFinite(current.progress)
            && Number.isFinite(prior.progress)
            ? current.progress + (prior.progress - current.progress) * boundaryRatio
            : current.progress;
          const boundarySample = {
            base: current.base.clone().lerp(prior.base, boundaryRatio),
            tip: current.tip.clone().lerp(prior.tip, boundaryRatio),
            baseWorld: current.baseWorld.clone().lerp(prior.baseWorld, boundaryRatio),
            tipWorld: current.tipWorld.clone().lerp(prior.tipWorld, boundaryRatio),
            progress: boundaryProgress,
          };
          trail.samples.splice(0, index, boundarySample);
          break;
        }
        accumulatedLength += segmentLength;
      }
    }

    for (const mesh of [trail.glow, trail.core]) {
      const innerRatio = mesh.userData.innerRatio;
      const positions = mesh.geometry.attributes.position;
      for (let sampleIndex = 0; sampleIndex < trail.samples.length; sampleIndex += 1) {
        const ribbonSample = trail.samples[sampleIndex];
        tempVectorA.copy(ribbonSample.base).lerp(ribbonSample.tip, innerRatio);
        const offset = sampleIndex * 2;
        positions.setXYZ(offset, tempVectorA.x, tempVectorA.y, tempVectorA.z);
        positions.setXYZ(offset + 1, ribbonSample.tip.x, ribbonSample.tip.y, ribbonSample.tip.z);
      }
      positions.needsUpdate = true;
      mesh.geometry.setDrawRange(0, Math.max(0, (trail.samples.length - 1) * 6));
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

    (this.activeWorldBundle?.root ?? this.scene).add(group);
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
      hazardDomain: options.hazardDomain ?? null,
      hazardTags: Array.isArray(options.hazardTags) ? [...options.hazardTags] : [],
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

  _createFlamethrowerEffect(source, range, halfAngle, color, options = {}) {
    const safeRange = Math.max(0.1, Number(range) || 4);
    const startDistance = Math.max(0, Number(options.startDistance) || 0.12);
    const cone = new THREE.Mesh(
      createFlamethrowerConeGeometry(
        halfAngle,
        options.segments ?? 18,
        startDistance / safeRange,
      ),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: options.opacity ?? 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    // This is a flat overlay with no enclosed back face. Three.js otherwise
    // renders transparent DoubleSide materials in two passes, doubling the
    // cone's draw cost without changing its appearance.
    cone.material.forceSinglePass = true;
    const effectName = options.name ?? 'enemyFlamethrowerCone';
    cone.name = effectName;
    cone.renderOrder = 3;

    const particleGeometry = new THREE.SphereGeometry(0.08, 6, 4);
    const particleMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: options.particleOpacity ?? 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const particles = new THREE.InstancedMesh(
      particleGeometry,
      particleMaterial,
      MAX_FLAMETHROWER_PARTICLES_PER_ENEMY,
    );
    particles.name = `${effectName}Particles`;
    particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    particles.frustumCulled = false;
    particles.renderOrder = 4;

    const primaryColor = new THREE.Color(color);
    const secondaryColor = new THREE.Color(options.secondaryColor ?? 0xffd36f);
    const particleSeeds = [];
    for (let i = 0; i < MAX_FLAMETHROWER_PARTICLES_PER_ENEMY; i += 1) {
      const seed = {
        phase: flamethrowerParticleSeed(i, 12.9898),
        lateral: flamethrowerParticleSeed(i, 78.233) * 2 - 1,
        lift: flamethrowerParticleSeed(i, 39.425),
        scale: 0.72 + flamethrowerParticleSeed(i, 93.731) * 0.72,
        speed: 0.74 + flamethrowerParticleSeed(i, 17.147) * 0.72,
        hot: flamethrowerParticleSeed(i, 51.219) > 0.68,
      };
      particleSeeds.push(seed);
      particles.setColorAt(i, seed.hot ? secondaryColor : primaryColor);
    }
    if (particles.instanceColor) particles.instanceColor.needsUpdate = true;

    const root = new THREE.Group();
    root.name = `${effectName}Effect`;
    root.userData.flamethrowerEffect = true;
    root.add(cone, particles);
    this.scene.add(root);

    const effect = {
      source,
      root,
      cone,
      particles,
      particleSeeds,
      primaryColor,
      secondaryColor,
      halfAngle,
      range: safeRange,
      elapsed: 0,
      idleSeconds: 0,
      touchedSinceHeartbeat: true,
    };
    this.flamethrowerEffects.set(source, effect);
    return effect;
  }

  updateFlamethrowerEffect(source, dt, origin, direction, options = {}) {
    if (!source || !origin || !direction || !this.scene) return null;
    if (!(this.flamethrowerEffects instanceof Map)) this.flamethrowerEffects = new Map();

    const range = Math.max(0.1, Number(options.range) || 4);
    const halfAngle = THREE.MathUtils.clamp(Number(options.halfAngle) || 0.8, 0.05, Math.PI * 0.95);
    const color = options.color ?? 0xff6a2e;
    let effect = this.flamethrowerEffects.get(source);
    if (!effect) {
      effect = this._createFlamethrowerEffect(source, range, halfAngle, color, options);
    }

    tempVectorA.copy(direction);
    tempVectorA.y = 0;
    if (tempVectorA.lengthSq() <= 0.0001) tempVectorA.set(0, 0, 1);
    tempVectorA.normalize();

    effect.elapsed += Math.max(0, Number(dt) || 0);
    effect.idleSeconds = 0;
    effect.touchedSinceHeartbeat = true;
    effect.range = range;
    effect.root.position.copy(origin);
    effect.root.rotation.set(0, Math.atan2(tempVectorA.x, tempVectorA.z), 0);
    effect.cone.position.set(
      0,
      (Number.isFinite(options.groundY) ? options.groundY : source.root?.position?.y ?? origin.y) - origin.y + 0.052,
      0,
    );
    effect.cone.scale.setScalar(range);
    effect.cone.visible = options.coneVisible !== false;
    effect.cone.material.color.set(color);
    effect.cone.material.opacity = options.opacity ?? 0.32;

    const particleCount = THREE.MathUtils.clamp(
      Math.trunc(Number(options.particleCount) || 0),
      0,
      MAX_FLAMETHROWER_PARTICLES_PER_ENEMY,
    );
    const baseScale = Math.max(0.01, Number(options.baseScale) || 0.25);
    const spread = Math.tan(halfAngle);
    effect.particles.count = particleCount;
    effect.particles.visible = particleCount > 0;
    effect.particles.material.opacity = options.particleOpacity ?? 0.72;

    for (let i = 0; i < particleCount; i += 1) {
      const seed = effect.particleSeeds[i];
      const phase = (seed.phase + effect.elapsed * seed.speed * 1.65) % 1;
      const distance = range * (0.055 + phase * 0.945);
      const width = spread * distance;
      const lateralEnvelope = 0.3 + phase * 0.7;
      const pulse = 0.72 + Math.sin(phase * Math.PI) * 0.72;

      tempFlameTransform.position.set(
        seed.lateral * width * lateralEnvelope,
        0.22 + seed.lift * 0.58 + Math.sin((phase + seed.lift) * Math.PI * 2) * 0.1,
        distance,
      );
      tempFlameTransform.rotation.set(
        seed.lift * Math.PI,
        seed.phase * Math.PI * 2 + effect.elapsed * 2.4,
        seed.lateral * 0.45,
      );
      tempFlameTransform.scale.setScalar(baseScale * seed.scale * pulse);
      tempFlameTransform.updateMatrix();
      effect.particles.setMatrixAt(i, tempFlameTransform.matrix);
    }
    effect.particles.instanceMatrix.needsUpdate = true;
    return effect;
  }

  endFlamethrowerEffect(source) {
    const effect = this.flamethrowerEffects?.get?.(source);
    if (!effect) return false;
    this.flamethrowerEffects.delete(source);
    effect.root.removeFromParent();
    // InstancedMesh owns GPU-side instance matrix/color buffers in addition to
    // its geometry and material. Dispose the instance object before releasing
    // the ordinary render resources below so repeated attacks cannot leak them.
    effect.particles.dispose?.();
    this._disposeTimedEffectObject(effect.root);
    return true;
  }

  _clearFlamethrowerEffects() {
    if (!(this.flamethrowerEffects instanceof Map)) return;
    for (const source of [...this.flamethrowerEffects.keys()]) {
      this.endFlamethrowerEffect(source);
    }
  }

  _updateFlamethrowerEffects(dt) {
    if (!(this.flamethrowerEffects instanceof Map)) return;
    for (const [source, effect] of [...this.flamethrowerEffects.entries()]) {
      if (source?.dead || source?.disposed) {
        this.endFlamethrowerEffect(source);
        continue;
      }
      if (effect.touchedSinceHeartbeat) {
        effect.touchedSinceHeartbeat = false;
        effect.idleSeconds = 0;
        continue;
      }
      effect.idleSeconds += Math.max(0, Number(dt) || 0);
      if (effect.idleSeconds >= FLAMETHROWER_EFFECT_STALE_SECONDS) {
        this.endFlamethrowerEffect(source);
      }
    }
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
    const excludedEnemyIds = meta.excludedEnemyIds instanceof Set
      ? meta.excludedEnemyIds
      : new Set(Array.isArray(meta.excludedEnemyIds) ? meta.excludedEnemyIds : []);
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
        if (enemy.dead || excludedEnemyIds.has(enemy.id)) {
          continue;
        }

        const insideExplosion = meta.targetGeometry === 'verticalCapsule'
          ? sphereIntersectsTargetCapsule({ center: position, radius, target: enemy })
          : enemy.root.position.distanceTo(position) <= radius;
        if (insideExplosion) {
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
            executionId: meta.executionId ?? null,
            busterExecutionStaggerLedger: meta.busterExecutionStaggerLedger ?? null,
          });
        }
      }
    }

    const playerInsideExplosion = meta.targetGeometry === 'verticalCapsule'
      ? sphereIntersectsTargetCapsule({ center: position, radius, target: this.player })
      : this.player.root.position.distanceTo(position) <= radius;
    if ((meta.damagePlayer ?? true) && playerInsideExplosion && !this.player.dead) {
      if (meta.knockbackDirection?.lengthSq?.() > 0.0001) {
        tempVectorA.copy(meta.knockbackDirection).setY(0);
      } else {
        tempVectorA.copy(this.player.root.position).sub(position).setY(0);
      }
      if (tempVectorA.lengthSq() <= 0.0001) {
        tempVectorA.copy(this.player.lastMoveDirection).multiplyScalar(-1);
      }
      tempVectorA.normalize();
      const hitResult = this.player.takeIncomingHit({
        amount: damage * (meta.playerDamageScale ?? 0.35),
        source: meta.source ?? null,
        attackKind: meta.attackKind,
        impactPosition: position,
        direction: tempVectorA,
        knockbackDirection: tempVectorA,
        guardable: meta.guardable ?? !meta.unblockable,
        reactionTier: meta.reactionTier ?? 3,
        minimumReactionTier: meta.minimumReactionTier ?? 0,
        knockbackStrength: meta.knockbackStrength ?? 1.08,
      });
      if (hitResult.contacted && !hitResult.dodged && !hitResult.immune) {
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
    const gameplayActive = !this.inventoryOpen
      && !this.poseDebugOpen
      && !this.isGameOver
      && !this.ui?.isWorldModalOpen?.()
      && (this.transitionState === 'overworld' || this.transitionState === 'dungeon');

    if (gameplayActive) {
      this.elapsedTime += gameplayDt;
      if (this.animationPreview?.active) {
        this._updateAnimationPreview(gameplayDt);
      } else {
        this._updateAimFromPointer();
        const movementBasis = this._getPlayerMovementBasis();
        if (!this.debugNoClipEnabled) {
          this.bossStageRuntime?.prePlayerUpdate?.(gameplayDt, this);
          this.connectorLiftRuntime?.prePlayerUpdate?.(gameplayDt, this);
          this.connectorTrackTrapRuntime?.prePlayerUpdate?.(gameplayDt, this);
          for (const enemy of this.enemies) {
            if (!enemy || enemy.dead || this._deferredEnemyRemovals?.has(enemy)) continue;
            enemy.prePlayerUpdate?.(gameplayDt, this);
          }
        }
        const playerGroundY = this._getPlayerGroundY();
        const overworldMovementOrigin = this.worldKind === 'overworld'
          ? this.player.root.position.clone()
          : null;
        const playerMovementOptions = {
          arenaRadius: this.arenaRadius,
          movementForward: movementBasis.forward,
          movementRight: movementBasis.right,
          lockOnTarget: movementBasis.lockOnTarget,
          lockOnTargetPosition: movementBasis.lockOnTargetPosition,
          aimWorld: this.pointer.aimWorld,
          projectileAimInputHeld: Boolean(this.pointer.primary || this.pointer.secondary),
          groundY: playerGroundY,
          game: this,
        };
        if (this.debugNoClipEnabled) {
          this.player.updateNoClip?.(gameplayDt, this.keys, {
            ...playerMovementOptions,
            speed: DEBUG_NO_CLIP_SPEED,
            boostSpeed: DEBUG_NO_CLIP_BOOST_SPEED,
          });
        } else {
          this.player.update(gameplayDt, this.keys, playerMovementOptions);
        }
        if (overworldMovementOrigin && !this.debugNoClipEnabled) {
          this.dungeonController?.resolvePlayerMovement?.(overworldMovementOrigin);
        }
        if (this.busterTestRange?.active) {
          this._updateBusterTestRange(gameplayDt);
        } else if (this.worldKind === 'overworld') {
          this.dungeonController?.update?.(gameplayDt);
        } else {
          this.dungeonController?.update?.(gameplayDt);
          this.mapEvents?.update?.(gameplayDt);
          this.spawner?.update?.(gameplayDt);
          this._updateEnemies(gameplayDt);
          this.dungeonController?.constrainEnemies?.();
        }
        this._updateTargetScanner();
        const activeBusterPlan = this.getActiveBusterPlan?.();
        this.busterRuntime?.update(gameplayDt, {
          activeWeaponKey: activeBusterPlan?.weaponKey ?? activeBusterPlan?.buildId ?? null,
          fireHeld: Boolean(this.pointer?.primary),
        });
        this.combat.update(gameplayDt);
        this.projectiles.update(gameplayDt);
        if (!this.busterTestRange?.active) {
          this._updateHazards(gameplayDt);
          this._updatePendingExplosions();
          this._updateDestructibles(gameplayDt);
        }

        const progressionDisabled = Boolean(
          this.busterTestRange?.active || this.busterSandboxSession?.active,
        );
        const collected = progressionDisabled
          ? []
          : this.lootSystem.update(gameplayDt, this.player, this.inventory, {
            collectItem: (item) => this._collectWorldItemDurably(item),
            onAsyncCollected: () => this.ui?.renderInventory?.(),
          });
        for (const item of collected) {
          this.ui.showLootToast(item);
        }

        if (collected.length > 0) {
          this.ui.renderInventory();
        }

        const collectedRefractors = progressionDisabled
          ? []
          : this.refractors.update(gameplayDt, this.player, this.inventory);
        for (const refractor of collectedRefractors) {
          this.ui.showToast(`${refractor.label} +${refractor.value}z`, refractor.color);
        }

        if (this.player.dead) {
          if (this.busterSandboxSession?.active) {
            this.exitBusterSandbox('sandboxDefeat');
          } else {
            this.isGameOver = true;
          }
        }
      }
    }

    this.dungeonController?.updateNpcVisuals(dt, {
      allowAmbient: gameplayActive && !this.animationPreview?.active,
    });
    this._updateDamageNumbers(dt);
    this._updateHitEffects(dt);
    this._updateParticles(dt);
    this._updateFlamethrowerEffects(gameplayActive ? gameplayDt : 0);
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
    const cameraBasis = this.cameraController.getMovementBasis(this.player.lastMoveDirection);

    if (!lockOnTarget?.root || lockOnTarget.dead) {
      return cameraBasis;
    }

    getCombatTargetWorldPosition(lockOnTarget, this.lockOnMovementTargetPosition);
    this.lockOnMovementForward.copy(this.lockOnMovementTargetPosition).sub(this.player.root.position);
    this.lockOnMovementForward.y = 0;

    if (this.lockOnMovementForward.lengthSq() <= 0.0001) {
      return cameraBasis;
    }

    this.lockOnMovementForward.normalize();
    this.lockOnMovementRight.crossVectors(this.lockOnMovementForward, WORLD_UP).normalize();
    this.lockOnMovementBasis.cameraForward = cameraBasis.cameraForward;
    this.lockOnMovementBasis.cameraRight = cameraBasis.cameraRight;
    this.lockOnMovementBasis.lockOnTarget = lockOnTarget;
    return this.lockOnMovementBasis;
  }

  _createMapEventSystemForWorld() {
    if (this.worldKind !== 'dungeon') {
      return {
        events: [],
        update() {},
        getNearestInteractable() { return null; },
        activateNearest() { return false; },
      };
    }
    const system = new MapEventSystem(this);
    for (const event of system.events ?? []) {
      if (event.object && this.activeWorldBundle?.root) this.activeWorldBundle.root.attach(event.object);
    }
    return system;
  }

  _createOverworldWorldBundle() {
    const plan = this.overworldPlan ?? createAuthoredOverworldPlan();
    this.overworldPlan = plan;
    const facade = assembleOverworld(plan, { renderer: this.renderer });
    const root = facade.root;
    root.userData.worldRootId = root.uuid;
    return createLoadedWorldBundle({
      worldKind: 'overworld',
      root,
      facade,
      controller: null,
      lighting: facade.lighting,
      npcAnimators: facade.npcAnimators,
      collisionData: facade.solidZones,
      cullingData: facade.renderCullGroups,
      disposableResources: facade.disposableResources ?? [],
      planHash: plan.planHash,
      disposed: false,
    });
  }

  _createLegacyDungeonWorldCandidate({
    bossProfileId = this.getSelectedBossProfileId(),
    layoutSeed = this.dungeonLayoutSeed,
    difficulty = this.ruinFloor,
    dungeonFamilyId = INDUSTRIAL_DUNGEON_FAMILY_ID,
    dungeonAugmentation = undefined,
  } = {}) {
    const dungeonFamilySelection = resolveDungeonFamilyId(dungeonFamilyId);
    const resolvedDungeonFamilyId = dungeonFamilySelection.dungeonFamilyId;
    if (dungeonFamilySelection.fallback) {
      this.dungeonFamilyFallback ??= dungeonFamilySelection.fallback;
    }
    const root = new THREE.Group();
    root.name = 'dungeonWorldRoot';
    root.userData.worldKind = 'dungeon';
    root.userData.worldRootId = root.uuid;

    const hemi = new THREE.HemisphereLight(0xd8e6ff, 0x34251d, 1.8);
    hemi.name = 'arenaHemisphereLight';
    root.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.name = 'arenaKeyLight';
    key.position.set(5, 9, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -18;
    key.shadow.camera.right = 18;
    key.shadow.camera.top = 18;
    key.shadow.camera.bottom = -18;
    root.add(key);

    const basePlanHash = createLegacyDungeonBasePlanHash({
      layoutSeed,
      difficulty,
      bossProfileId,
      dungeonFamilyId: resolvedDungeonFamilyId,
    });
    const augmentationRequest = resolveDungeonAugmentationGenerationRequest(
      dungeonAugmentation,
      this.dungeonAugmentationProfileId,
    );
    const dungeon = new DungeonGenerator({
      difficulty,
      random: createDungeonRandom(layoutSeed),
      bossProfileId: this._creatingBusterSandbox ? null : bossProfileId,
      dungeonFamilyId: resolvedDungeonFamilyId,
      roomPreviewId: this.roomPreview?.roomId ?? null,
      augmentationProfileId: augmentationRequest.augmentationProfileId,
      // This is the parent layout seed. The sidecar derives and persists its
      // own fork without ever treating the derived value as a new root seed.
      augmentationSeed: layoutSeed,
      basePlanHash,
      committedAugmentationIdentity: augmentationRequest.committedAugmentationIdentity,
    }).generate();
    dungeon.layoutSeed = layoutSeed;
    dungeon.basePlanHash ??= basePlanHash;
    dungeon.effectivePlanHash ??= basePlanHash;

    // The historical underlay was a world-sized opaque plane just below Y=0.
    // It cuts through signed subterranean rooms and makes a downward ladder,
    // lift, or slope appear to terminate in a false solid floor. Standard V1
    // layouts are now enclosed by their authored room/connector shells, so no
    // masking plane may sit between elevation bands. Keep the legacy backdrop
    // only for dedicated specialized boss worlds whose authored staging still
    // owns that presentation contract.
    if (dungeon.dungeonKind === 'ascensionReliquary' || dungeon.specialEnvironment) {
      const underlay = new THREE.Mesh(
        new THREE.PlaneGeometry(this.arenaRadius * 2.5, this.arenaRadius * 2.5),
        new THREE.MeshStandardMaterial({ color: 0x171b1d, roughness: 0.96, metalness: 0 }),
      );
      underlay.name = 'ruinVoidUnderlay';
      underlay.rotation.x = -Math.PI / 2;
      underlay.position.y = -0.09;
      underlay.receiveShadow = true;
      root.add(underlay);

      const grid = new THREE.GridHelper(this.arenaRadius * 2.2, 64, 0x43515a, 0x283138);
      grid.name = 'ruinConstructionGrid';
      grid.position.y = 0.014;
      root.add(grid);
    }

    root.add(dungeon.group);
    return createLoadedWorldBundle({
      worldKind: 'dungeon',
      root,
      facade: dungeon,
      controller: null,
      lighting: root,
      npcAnimators: dungeon.npcAnimators ?? [],
      collisionData: dungeon.solidZones ?? [],
      cullingData: dungeon.renderCullGroups ?? [],
      disposableResources: dungeon.disposableResources ?? [],
      planHash: dungeon.effectivePlanHash,
      bossProfileId,
      dungeonFamilyId: resolvedDungeonFamilyId,
      disposed: false,
    });
  }

  _assignMountedWorldBundle(bundle, { incrementGeneration = true } = {}) {
    assertLoadedWorldBundle(bundle);
    const outgoingRoot = this.activeWorldBundle?.root;
    if (outgoingRoot && outgoingRoot !== bundle.root) outgoingRoot.removeFromParent?.();
    const conflictingRoots = this.scene.children.filter((object) => (
      object !== bundle.root
      && object.userData?.worldRootId
      && ['overworld', 'dungeon'].includes(object.userData?.worldKind)
    ));
    if (conflictingRoots.length > 0) {
      throw new Error(`World root exclusivity violated: ${conflictingRoots.map((root) => root.name).join(', ')}`);
    }
    this.activeWorldBundle = bundle;
    this.worldKind = bundle.worldKind;
    this.dungeon = bundle.facade;
    this.scene.add(bundle.root);
    this.scene.background = bundle.facade.backgroundColor?.clone?.()
      ?? new THREE.Color(0x171712);
    this.scene.fog = bundle.facade.fog?.clone?.()
      ?? new THREE.Fog(0x171712, 24, 58);
    if (incrementGeneration) this.worldGenerationCount += 1;
    this.bossStageRuntime = bundle.worldKind === 'dungeon'
      ? bundle.facade.specialEnvironment ?? null
      : null;
    this.platformingPlatforms = bundle.worldKind === 'dungeon'
      ? [...(bundle.facade.platforms ?? [])]
      : [];
    this.dynamicPlatformingPlatforms = [];
    this._rebuildPlatformingLedgeCandidates();
    this.arenaRadius = bundle.facade.boundsRadius ?? this.arenaRadius;
  }

  _buildWorld() {
    const useOverworld = this.usesStreamedWorldLifecycle && !this._creatingBusterSandbox;
    const committedExpedition = this.busterLabStorage?.getActiveBossExpedition?.() ?? null;
    const dungeonGenerationSpec = resolveCommittedDungeonGenerationSpec(
      this._creatingBusterSandbox ? null : committedExpedition,
      {
        bossProfileId: this._creatingBusterSandbox ? null : this.getSelectedBossProfileId(),
        layoutSeed: this.dungeonLayoutSeed,
        difficulty: this.ruinFloor,
        dungeonFamilyId: this.dungeonFamilyId,
        dungeonAugmentation: undefined,
      },
    );
    const bundle = useOverworld
      ? this._createOverworldWorldBundle()
      : this._createLegacyDungeonWorldCandidate(dungeonGenerationSpec);
    if (!useOverworld && isInterruptedExpeditionRecord(committedExpedition)) {
      this.selectedBossProfileId = normalizeBossProfileId(dungeonGenerationSpec.bossProfileId);
      this.dungeonLayoutSeed = dungeonGenerationSpec.layoutSeed;
      this.ruinFloor = dungeonGenerationSpec.difficulty;
      this.dungeonFamilyId = dungeonGenerationSpec.dungeonFamilyId;
    }
    this._assignMountedWorldBundle(bundle);
    if (bundle.worldKind === 'dungeon') {
      if (!this._creatingBusterSandbox) bundle.facade.activateNpcAssets?.();
      this._configureBossHuntEncounter(bundle.facade);
      this._rebuildDebugLedgeTester(bundle.facade.playerStart);
    } else {
      bundle.facade.activateNpcAssets?.();
      this.debugLedgeTester?.removeFromParent?.();
      this.debugLedgeTester = null;
      this.debugLedgeCandidates = [];
      this.debugLedgePlatform = null;
    }
    this._collectCameraOcclusionWalls();
    this._collectDungeonRenderCullGroups();

  }

  _rebuildDebugLedgeTester(origin = new THREE.Vector3()) {
    this._disposeDebugLedgeTester();
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
    (this.activeWorldBundle?.root ?? this.scene).add(group);
  }

  _disposeDebugLedgeTester() {
    const tester = this.debugLedgeTester;
    if (!tester) return null;
    tester.removeFromParent?.();
    const stats = this._disposeDetachedDungeonResources(tester);
    this.debugLedgeTester = null;
    this.debugLedgeCandidates = [];
    this.debugLedgePlatform = null;
    return stats;
  }

  getDebugLedgeFloorElevation(position) {
    const platform = this.debugLedgePlatform;
    return this._getPlatformFloorElevation(platform, position);
  }

  getPlatformFloorElevation(position) {
    return this.getPlatformSupport(position)?.elevation ?? null;
  }

  registerDynamicPlatformingSurface(surface) {
    if (!surface || typeof surface !== 'object') {
      return false;
    }

    this.dynamicPlatformingPlatforms ??= [];
    if (!this.dynamicPlatformingPlatforms.includes(surface)) {
      this.dynamicPlatformingPlatforms.push(surface);
    }
    return true;
  }

  unregisterDynamicPlatformingSurface(surface) {
    const index = this.dynamicPlatformingPlatforms?.indexOf(surface) ?? -1;
    if (index < 0) {
      return false;
    }

    this.dynamicPlatformingPlatforms.splice(index, 1);
    return true;
  }

  getPlatformSupport(position) {
    let support = null;
    for (const platform of this._getPlatformingSurfaces()) {
      const candidate = this._getPlatformFloorElevation(platform, position);
      if (!Number.isFinite(candidate)) {
        continue;
      }
      const verticalDistance = Math.abs(Number(position?.y ?? candidate) - candidate);
      const dynamic = platform.dynamic === true;
      const reachableAuthoredStepUp = platform.authoredRoomSurface === true
        && platform.surfaceRole === 'stair-tread'
        && candidate >= Number(position?.y ?? candidate) - 0.08
        && candidate <= Number(position?.y ?? candidate) + 0.5;
      const replacesLowerBaseSupport = reachableAuthoredStepUp
        && (!support?.reachableAuthoredStepUp || candidate > support.elevation + 0.0001);
      if (!support
        || replacesLowerBaseSupport
        || (!support.reachableAuthoredStepUp
          && verticalDistance < support.verticalDistance - 0.0001)
        || (Math.abs(verticalDistance - support.verticalDistance) <= 0.0001
          && dynamic
          && !support.dynamic)) {
        support = {
          surface: platform,
          elevation: candidate,
          verticalDistance,
          dynamic,
          reachableAuthoredStepUp,
        };
      }
    }
    return support;
  }

  _getPlatformFloorElevation(platform, position) {
    if (!platform || platform.enabled === false || !position) {
      return null;
    }

    const insideTop = typeof platform.containsTop === 'function'
      ? Boolean(platform.containsTop(position, -0.08))
      : Math.abs(position.x - platform.center.x) <= platform.halfWidth + 0.08
        && Math.abs(position.z - platform.center.z) <= platform.halfDepth + 0.08;
    if (!insideTop || position.y < platform.topY - 0.5) {
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
    if (!platform || platform.enabled === false || !position) {
      return false;
    }

    const insideX = Math.abs(position.x - platform.center.x) <= platform.halfWidth + margin;
    const insideZ = Math.abs(position.z - platform.center.z) <= platform.halfDepth + margin;
    const belowTop = position.y < platform.topY - 0.05;
    if (platform.blocksBelow === false) {
      const collisionThickness = Number(platform.collisionThicknessMeters);
      if (!Number.isFinite(collisionThickness) || collisionThickness <= 0) {
        return false;
      }
      const baseY = Number.isFinite(platform.baseY)
        ? platform.baseY
        : platform.topY - collisionThickness;
      return insideX
        && insideZ
        && belowTop
        && position.y > baseY + 0.05;
    }
    return insideX && insideZ && belowTop;
  }

  _getPlatformingSurfaces() {
    const dynamicPlatforms = this.dynamicPlatformingPlatforms ?? [];
    const surfaces = this.debugLedgePlatform
      ? [
        this.debugLedgePlatform,
        ...this.platformingPlatforms,
        ...dynamicPlatforms,
        ...this.debugSpawnedPlatforms,
      ]
      : [...this.platformingPlatforms, ...dynamicPlatforms, ...this.debugSpawnedPlatforms];
    // A moving surface remains in the facade compatibility collection while
    // its runtime also registers it dynamically. Query each object once.
    return [...new Set(surfaces)].filter((surface) => surface?.enabled !== false);
  }

  _rebuildPlatformingLedgeCandidates() {
    this.platformingLedgeCandidates = [
      ...this.platformingPlatforms,
      ...this.debugSpawnedPlatforms,
    ].filter((platform) => !platform?.dynamic).flatMap((platform) => (
      this._createPlatformLedgeCandidates(platform)
    ));
    this.platformingLedgeCandidates.push(...this._createLavaExitLedgeCandidates());
  }

  _createLavaExitLedgeCandidates() {
    const floorTiles = this.dungeon?.floorTiles ?? [];
    const tileSize = Number(this.dungeon?.tileSize) || 2.8;
    if (!floorTiles.some((tile) => tile.surface === 'deepMagma')) return [];

    const cellKey = (x, z) => `${x},${z}`;
    const lavaByCell = new Map();
    const walkableByCell = new Map();
    for (const tile of floorTiles) {
      const target = tile.surface === 'deepMagma' ? lavaByCell : walkableByCell;
      if (tile.surfaceRole === 'hazard-floor' && tile.surface !== 'deepMagma') continue;
      if (tile.surface !== 'deepMagma' && tile.walkable === false) continue;
      const key = cellKey(tile.x, tile.z);
      const entries = target.get(key) ?? [];
      entries.push(tile);
      target.set(key, entries);
    }

    const edgeSpecs = [
      { edge: 'front', dx: 0, dz: -1, nx: 0, nz: -1, axisX: 1, axisZ: 0 },
      { edge: 'back', dx: 0, dz: 1, nx: 0, nz: 1, axisX: 1, axisZ: 0 },
      { edge: 'left', dx: -1, dz: 0, nx: -1, nz: 0, axisX: 0, axisZ: 1 },
      { edge: 'right', dx: 1, dz: 0, nx: 1, nz: 0, axisX: 0, axisZ: 1 },
    ];
    const controller = this.dungeonController;
    const getTileY = (tile, position) => {
      const resolved = controller?._getTileElevationAtPosition?.(tile, position);
      return Number.isFinite(resolved) ? resolved : Number(tile.elevation) || 0;
    };
    const maximumClimbRise = PLAYER_TRAVERSAL_CAPABILITIES.jumpHeight
      * PLAYER_TRAVERSAL_CAPABILITIES.ledgeGrabHeightRatio;
    const candidates = [];
    const seen = new Set();

    for (const tile of floorTiles) {
      if (tile.surface === 'deepMagma'
        || tile.surfaceRole === 'hazard-floor'
        || tile.walkable === false
        || tile.surfaceRole === 'ramp') {
        continue;
      }
      for (const spec of edgeSpecs) {
        const adjacentKey = cellKey(tile.x + spec.dx, tile.z + spec.dz);
        const lavaTiles = lavaByCell.get(adjacentKey) ?? [];
        if (!lavaTiles.length) continue;

        const edgeCenter = new THREE.Vector3(
          (tile.x + spec.dx * 0.5) * tileSize,
          Number(tile.elevation) || 0,
          (tile.z + spec.dz * 0.5) * tileSize,
        );
        const topY = getTileY(tile, edgeCenter);
        const connectingFloor = (walkableByCell.get(adjacentKey) ?? []).some((neighbor) => {
          const neighborY = getTileY(neighbor, edgeCenter);
          return Math.abs(neighborY - topY) <= 0.55;
        });
        if (connectingFloor) continue;

        let lavaY = -Infinity;
        for (const lavaTile of lavaTiles) {
          const candidateY = getTileY(lavaTile, edgeCenter);
          if (candidateY <= topY - 0.18 && candidateY > lavaY) lavaY = candidateY;
        }
        const rise = topY - lavaY;
        if (!Number.isFinite(lavaY) || rise > maximumClimbRise + 0.05) continue;

        const id = `lava-exit-${tile.roomId ?? 'room'}-${tile.x}-${tile.z}-${spec.edge}-${topY.toFixed(3)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        candidates.push({
          id,
          edge: spec.edge,
          roomId: tile.roomId ?? null,
          center: edgeCenter.setY(topY),
          normal: new THREE.Vector3(spec.nx, 0, spec.nz),
          axis: new THREE.Vector3(spec.axisX, 0, spec.axisZ),
          halfSpan: Math.max(0.5, tileSize * 0.5 - 0.18),
          topY,
          approachSurfaceY: lavaY,
          hazardSurface: 'deepMagma',
          sourceHazardTileKey: adjacentKey,
        });
      }
    }
    return candidates;
  }

  _createPlatformLedgeCandidates(platform) {
    if (!platform || platform.enabled === false || platform.createsLedgeCandidates === false) {
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
    if (platform.ledgeCatchMode != null) {
      for (const candidate of candidates) {
        candidate.ledgeCatchMode = platform.ledgeCatchMode;
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
    let landingSnapPosition = null;
    for (const platform of platforms) {
      const ledgeHeight = platform.topY - startY;
      if (ledgeHeight > jumpReachHeight * PLATFORM_NORMAL_JUMP_REACH_RATIO) {
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

      let snapPosition = null;
      if (!this._isInsidePlatformTop(platform, root.position, DEBUG_LEDGE_LANDING_INSET)) {
        snapPosition = platform.getLandingSnapPosition?.(root.position, {
          player,
          inset: DEBUG_LEDGE_LANDING_INSET,
          previousRootY,
        }) ?? null;
        if (!snapPosition
          || !this._isInsidePlatformTop(platform, snapPosition, DEBUG_LEDGE_LANDING_INSET)) {
          continue;
        }
      }

      if (!landingPlatform || platform.topY > landingPlatform.topY) {
        landingPlatform = platform;
        landingSnapPosition = snapPosition;
      }
    }

    if (!landingPlatform) {
      return false;
    }

    if (landingSnapPosition) {
      root.position.x = landingSnapPosition.x;
      root.position.z = landingSnapPosition.z;
    }
    root.position.y = landingPlatform.topY;
    if (player.modelRoot) {
      player.modelRoot.position.y = 0;
    }
    this.lastDebugLedgeLandingId = landingPlatform.id;
    return true;
  }

  _isInsidePlatformTop(platform, position, inset = 0) {
    if (!platform || platform.enabled === false || !position) {
      return false;
    }

    if (typeof platform.containsTop === 'function') {
      return Boolean(platform.containsTop(position, inset));
    }

    return Math.abs(position.x - platform.center.x) <= Math.max(0, platform.halfWidth - inset)
      && Math.abs(position.z - platform.center.z) <= Math.max(0, platform.halfDepth - inset);
  }

  _tryResolvePlatformLedgeCling(context = {}) {
    const dynamicLedgeCandidates = (this.dynamicPlatformingPlatforms ?? [])
      .filter((platform) => platform?.enabled !== false)
      .flatMap((platform) => this._createPlatformLedgeCandidates(platform));
    return this._tryResolveDebugLedgeCling(
      context,
      [
        ...this.debugLedgeCandidates,
        ...this.platformingLedgeCandidates,
        ...dynamicLedgeCandidates,
      ],
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
      const instantStep = ledge.ledgeCatchMode === 'instant-step';
      if (!instantStep && this._isForwardJumpClearingPlatformEdge({
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
      if (ledgeHeight <= minimumGrabElevation && !exceptionalEdgeCatch && !instantStep) {
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
          autoClimb: instantStep
            || (exceptionalEdgeCatch && ledgeHeight <= minimumGrabElevation),
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
    this.activeReaverbotBoss = null;
    this._deferredEnemyRemovals?.clear?.();
    // Drop host references, but leave the tester attached to its outgoing
    // world root so that bundle disposal can still discover its resources.
    this.debugLedgeTester = null;
    this.debugLedgeCandidates = [];
    this.debugLedgePlatform = null;
    this.lastDebugLedgeClingId = null;
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
    this._clearFlamethrowerEffects();

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
    const renderTargets = new Set();
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
      for (const target of [object.shadow?.map, object.shadow?.mapPass]) {
        if (target?.isWebGLRenderTarget) renderTargets.add(target);
      }
    });

    return { geometries, materials, textures, renderTargets };
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
      renderTargetCount: 0,
      disposedRenderTargetCount: 0,
      preservedRenderTargetCount: 0,
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
    const renderTargetResult = disposeUnreferenced(owned.renderTargets, live.renderTargets);

    return {
      geometryCount: owned.geometries.size,
      materialCount: owned.materials.size,
      textureCount: owned.textures.size,
      disposedGeometryCount: geometryResult.disposedCount,
      disposedMaterialCount: materialResult.disposedCount,
      disposedTextureCount: textureResult.disposedCount,
      renderTargetCount: owned.renderTargets.size,
      disposedRenderTargetCount: renderTargetResult.disposedCount,
      preservedGeometryCount: geometryResult.preservedCount,
      preservedMaterialCount: materialResult.preservedCount,
      preservedTextureCount: textureResult.preservedCount,
      preservedRenderTargetCount: renderTargetResult.preservedCount,
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

  _restoreCameraOcclusionHiddenInstances() {
    this.cameraOcclusionHiddenInstances ??= [];
    this.cameraOcclusionHiddenInstanceKeys ??= new Set();
    const touched = new Set();
    for (const entry of this.cameraOcclusionHiddenInstances) {
      if (!entry?.object?.setMatrixAt || !Number.isInteger(entry.instanceId)) continue;
      entry.object.setMatrixAt(entry.instanceId, entry.matrix);
      touched.add(entry.object);
    }
    for (const object of touched) {
      object.instanceMatrix.needsUpdate = true;
    }
    this.cameraOcclusionHiddenInstances.length = 0;
    this.cameraOcclusionHiddenInstanceKeys.clear();
  }

  _hideCameraOcclusionInstance(hit) {
    this.cameraOcclusionHiddenInstances ??= [];
    this.cameraOcclusionHiddenInstanceKeys ??= new Set();
    if (!hit?.object?.isInstancedMesh
      || hit.object.userData?.cameraOcclusionPerInstance !== true
      || !Number.isInteger(hit.instanceId)) {
      return false;
    }
    const key = `${hit.object.uuid}:${hit.instanceId}`;
    if (this.cameraOcclusionHiddenInstanceKeys.has(key)) return true;
    const originalMatrix = new THREE.Matrix4();
    hit.object.getMatrixAt(hit.instanceId, originalMatrix);
    this.cameraOcclusionHiddenInstances.push({
      object: hit.object,
      instanceId: hit.instanceId,
      matrix: originalMatrix,
    });
    this.cameraOcclusionHiddenInstanceKeys.add(key);
    hit.object.setMatrixAt(hit.instanceId, tempMatrixA.makeScale(0, 0, 0));
    hit.object.instanceMatrix.needsUpdate = true;
    return true;
  }

  _collectCameraOcclusionWalls() {
    this._restoreCameraOcclusionHiddenInstances();
    for (const owner of this.cameraOcclusionHiddenOwners) {
      owner.visible = this.cameraOcclusionOwnerBaseVisibility.get(owner) ?? true;
    }

    this.cameraOcclusionHiddenOwners.clear();
    this.cameraOcclusionEntries.length = 0;
    this.cameraOcclusionBins.clear();
    this.cameraOcclusionWallProximityBins ??= new Map();
    this.cameraOcclusionWallProximityBins.clear();
    this.cameraOcclusionProximityRecordByKey ??= new Map();
    this.cameraOcclusionProximityRecordByKey.clear();
    this.cameraOcclusionWallProximityCandidateKeys ??= new Set();
    this.cameraOcclusionWallProximityCandidateKeys.clear();
    this.cameraOcclusionExpandedVerticalRecordKeys ??= new Set();
    this.cameraOcclusionExpandedVerticalRecordKeys.clear();
    this.cameraOcclusionExpandedSurfaceRecordKeys ??= new Set();
    this.cameraOcclusionExpandedSurfaceRecordKeys.clear();
    this.cameraOcclusionForwardVerticalHits ??= [];
    this.cameraOcclusionForwardVerticalHits.length = 0;
    this.cameraOcclusionCandidateSet.clear();
    this.cameraOcclusionCandidateObjects.length = 0;
    this.cameraOcclusionHits.length = 0;
    this.cameraOcclusionOwnerBaseVisibility = new WeakMap();
    this.cameraOcclusionOwnerByObject = new WeakMap();

    const addWallProximityRecord = (record) => {
      this.cameraOcclusionProximityRecordByKey.set(record.key, record);
      const minBinX = Math.floor(record.bounds.min.x / CAMERA_OCCLUSION_BIN_SIZE);
      const maxBinX = Math.floor(record.bounds.max.x / CAMERA_OCCLUSION_BIN_SIZE);
      const minBinZ = Math.floor(record.bounds.min.z / CAMERA_OCCLUSION_BIN_SIZE);
      const maxBinZ = Math.floor(record.bounds.max.z / CAMERA_OCCLUSION_BIN_SIZE);
      for (let binX = minBinX; binX <= maxBinX; binX += 1) {
        for (let binZ = minBinZ; binZ <= maxBinZ; binZ += 1) {
          const binKey = `${binX},${binZ}`;
          const bin = this.cameraOcclusionWallProximityBins.get(binKey) ?? [];
          bin.push(record);
          this.cameraOcclusionWallProximityBins.set(binKey, bin);
        }
      }
    };
    const proximityInstanceMatrix = new THREE.Matrix4();
    const proximityWorldMatrix = new THREE.Matrix4();
    const proximityBounds = new THREE.Box3();

    const worldRoot = this.activeWorldBundle?.root ?? this.dungeon?.group;
    // Authored sequences can mirror and translate a complete child room after
    // that room has assembled its instanced walls. Occlusion collection runs
    // before the first render, so those parent transforms are not guaranteed
    // to have propagated into each child's matrixWorld yet. Resolve the full
    // hierarchy now; otherwise the visible combined-map walls and their
    // camera-occlusion bounds occupy different parts of the world.
    worldRoot?.updateWorldMatrix?.(true, true);
    worldRoot?.traverse?.((object) => {
      const isArchitectureSurface = isCameraOcclusionArchitectureSurface(object);
      const isWallSurface = isCameraOcclusionWallSurface(object);
      let declaredOwner = object;
      while (declaredOwner && declaredOwner !== worldRoot) {
        if (declaredOwner.userData?.cameraOcclusionOwner) break;
        declaredOwner = declaredOwner.parent;
      }
      const hasDeclaredOwner = Boolean(declaredOwner?.userData?.cameraOcclusionOwner);
      if ((!object.isMesh && !object.isInstancedMesh)
        || (!isArchitectureSurface && !hasDeclaredOwner)) {
        return;
      }
      const inferredSurface = isArchitectureSurface
        && object.userData?.cameraOcclusionSurface !== true;
      if (isArchitectureSurface) {
        object.userData.cameraOcclusionSurface = true;
        object.userData.cameraOcclusionWall = isWallSurface;
        object.userData.cameraOcclusionLabelSource ??= inferredSurface
          ? 'shared-semantic-contract'
          : 'authored';
        object.userData.cameraOcclusionInferredSurface ||= inferredSurface;
        // A stale room-authored exemption must never defeat the universal wall
        // rule. Preserve the audit trail without leaving the wall exempt.
        if (isWallSurface && object.userData.cameraOcclusionExcluded === true) {
          object.userData.cameraOcclusionOverrodeExemption = true;
          delete object.userData.cameraOcclusionExcluded;
        }
      }
      // Instanced architectural batches must disappear one panel at a time.
      // Hiding an entire wall batch recreates the same readability problem on
      // the opposite side of a room and exposes large exterior voids.
      if (inferredSurface
        && object.isInstancedMesh
        && object.userData.cameraOcclusionPerInstance !== false) {
        object.userData.cameraOcclusionPerInstance = true;
      }
      // Three.js raycasting dereferences the material slot declared by every
      // geometry group. A malformed mesh must not be able to terminate the
      // global animation loop merely because the camera ray reaches it. Asset
      // preflight still reports the bad slot; the runtime supplies a safe slot
      // so a wall never becomes exempt from camera occlusion.
      if (Array.isArray(object.material) && (object.geometry?.groups ?? []).some((group) => (
        !object.material[group.materialIndex]
      ))) {
        const repairedMaterials = [...object.material];
        const fallbackMaterial = repairedMaterials.find(Boolean)
          ?? CAMERA_OCCLUSION_FALLBACK_MATERIAL;
        for (const group of object.geometry?.groups ?? []) {
          repairedMaterials[group.materialIndex] ??= fallbackMaterial;
        }
        object.material = repairedMaterials;
        object.userData.cameraOcclusionMaterialGroupsRepaired = true;
      }
      let owner = hasDeclaredOwner ? declaredOwner : object;
      while (!hasDeclaredOwner && owner.parent && owner.parent !== worldRoot) {
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
        wallSurface: isWallSurface,
        surfaceClass: getCameraOcclusionSurfaceClass(object, isWallSurface),
      };
      this.cameraOcclusionEntries.push(entry);
      this.cameraOcclusionOwnerByObject.set(object, owner);
      // Keep exact per-instance bounds for every architectural surface. Walls
      // use these records to form a small multi-panel visibility cutout; other
      // surfaces use them only to recover from the camera entering solid mass.
      if (isArchitectureSurface) {
        if (object.isInstancedMesh
          && object.userData?.cameraOcclusionPerInstance === true) {
          object.geometry.computeBoundingBox?.();
          const localBounds = object.geometry.boundingBox;
          if (localBounds) {
            for (let instanceId = 0; instanceId < object.count; instanceId += 1) {
              object.getMatrixAt(instanceId, proximityInstanceMatrix);
              proximityWorldMatrix.multiplyMatrices(object.matrixWorld, proximityInstanceMatrix);
              addWallProximityRecord({
                entry,
                instanceId,
                bounds: proximityBounds.copy(localBounds)
                  .applyMatrix4(proximityWorldMatrix)
                  .clone(),
                key: `${object.uuid}:${instanceId}`,
              });
            }
          }
        } else {
          addWallProximityRecord({
            entry,
            instanceId: null,
            bounds,
            key: object.uuid,
          });
        }
      }
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

  _shouldHideCameraAdjacentBounds(
    bounds,
    cameraPosition,
    cameraForward,
    proximity = CAMERA_WALL_OCCLUSION_PROXIMITY,
  ) {
    bounds.clampPoint(cameraPosition, tempVectorF);
    tempVectorD.copy(tempVectorF).sub(cameraPosition);
    const distance = tempVectorD.length();
    if (distance > proximity) return false;
    return distance <= 0.001
      || tempVectorD.multiplyScalar(1 / distance).dot(cameraForward) >= -0.2;
  }

  _hideCameraAdjacentWallRecord(record) {
    const { entry } = record;
    const object = entry.object;
    if (Number.isInteger(record.instanceId)) {
      this._hideCameraOcclusionInstance({ object, instanceId: record.instanceId });
      return;
    }
    entry.owner.visible = false;
    this.cameraOcclusionHiddenOwners.add(entry.owner);
  }

  _forEachCameraOcclusionProximityRecord(position, radius, callback) {
    this.cameraOcclusionWallProximityCandidateKeys.clear();
    const minBinX = Math.floor((position.x - radius) / CAMERA_OCCLUSION_BIN_SIZE);
    const maxBinX = Math.floor((position.x + radius) / CAMERA_OCCLUSION_BIN_SIZE);
    const minBinZ = Math.floor((position.z - radius) / CAMERA_OCCLUSION_BIN_SIZE);
    const maxBinZ = Math.floor((position.z + radius) / CAMERA_OCCLUSION_BIN_SIZE);
    for (let binX = minBinX; binX <= maxBinX; binX += 1) {
      for (let binZ = minBinZ; binZ <= maxBinZ; binZ += 1) {
        for (const record of this.cameraOcclusionWallProximityBins.get(`${binX},${binZ}`) ?? []) {
          if (this.cameraOcclusionWallProximityCandidateKeys.has(record.key)) continue;
          this.cameraOcclusionWallProximityCandidateKeys.add(record.key);
          callback(record);
        }
      }
    }
  }

  _isCameraOcclusionVerticalRecord(record) {
    if (record?.entry?.wallSurface) return true;
    if (!record?.bounds) return false;
    const width = record.bounds.max.x - record.bounds.min.x;
    const height = record.bounds.max.y - record.bounds.min.y;
    const depth = record.bounds.max.z - record.bounds.min.z;
    return height >= 1.2
      && Math.min(width, depth) <= 0.8
      && height >= Math.min(width, depth) * 2;
  }

  _getCameraOcclusionProximityRecord(object, instanceId = null) {
    if (!object) return null;
    const key = Number.isInteger(instanceId)
      ? `${object.uuid}:${instanceId}`
      : object.uuid;
    return this.cameraOcclusionProximityRecordByKey?.get(key) ?? null;
  }

  _expandCameraOcclusionVerticalRecord(record, worldPoint) {
    if (!record || !worldPoint || !this._isCameraOcclusionVerticalRecord(record)) return false;
    this.cameraOcclusionExpandedVerticalRecordKeys ??= new Set();
    if (this.cameraOcclusionExpandedVerticalRecordKeys.has(record.key)) return false;
    this.cameraOcclusionExpandedVerticalRecordKeys.add(record.key);
    this._hideCameraOcclusionArchitectureNeighborhood(worldPoint, {
      seedEntry: record.entry,
      verticalOnly: true,
    });
    return true;
  }

  _expandCameraOcclusionSurfaceHit(record, worldPoint) {
    if (!record || !worldPoint) return false;
    if (this._isCameraOcclusionVerticalRecord(record)) {
      return this._expandCameraOcclusionVerticalRecord(record, worldPoint);
    }
    this.cameraOcclusionExpandedSurfaceRecordKeys ??= new Set();
    if (this.cameraOcclusionExpandedSurfaceRecordKeys.has(record.key)) return false;
    this.cameraOcclusionExpandedSurfaceRecordKeys.add(record.key);
    this._hideCameraOcclusionArchitectureNeighborhood(worldPoint, {
      seedEntry: record.entry,
    });
    return true;
  }

  _hideCameraOcclusionArchitectureNeighborhood(worldPoint, {
    radius = CAMERA_ARCHITECTURE_HIT_CUTOUT_RADIUS,
    seedEntry = null,
    verticalOnly = false,
  } = {}) {
    if (!worldPoint) return;
    this._forEachCameraOcclusionProximityRecord(worldPoint, radius, (record) => {
      if (record.bounds.distanceToPoint(worldPoint) > radius) return;
      if (verticalOnly && !this._isCameraOcclusionVerticalRecord(record)) return;
      if (seedEntry && !verticalOnly) {
        const seedClass = seedEntry.surfaceClass ?? 'architecture';
        if (record.entry.surfaceClass !== seedClass) return;
      }
      this._hideCameraAdjacentWallRecord(record);
    });
  }

  _hideCameraAdjacentWalls() {
    if (!this.camera?.position) return;
    const cameraPosition = this.camera.position;
    const cameraForward = tempVectorE.set(0, 0, -1)
      .applyQuaternion(this.camera.quaternion)
      .normalize();
    const playerFocus = tempVectorA.copy(this.player.root.position);
    playerFocus.y += 1.25;
    const maximumInterveningDistance = Math.max(
      0,
      cameraPosition.distanceTo(playerFocus) - CAMERA_OCCLUSION_PLAYER_CLEARANCE,
    );

    let cameraContainingRecord = null;
    this._forEachCameraOcclusionProximityRecord(
      cameraPosition,
      CAMERA_WALL_OCCLUSION_PROXIMITY,
      (record) => {
        const proximity = record.entry.wallSurface
          ? CAMERA_WALL_OCCLUSION_PROXIMITY
          : CAMERA_ARCHITECTURE_CONTAINMENT_PROXIMITY;
        if (!this._shouldHideCameraAdjacentBounds(
          record.bounds,
          cameraPosition,
          cameraForward,
          proximity,
        )) {
          return;
        }
        const containmentDistance = record.bounds.distanceToPoint(cameraPosition);
        // Proximity recovery may clear a wall surrounding or beside the camera,
        // but it must not remove architecture whose nearest point is beyond the
        // player. Such a wall is visible background, not an intervening panel.
        if (containmentDistance > CAMERA_ARCHITECTURE_CONTAINMENT_PROXIMITY
          && tempVectorD.copy(tempVectorF).sub(cameraPosition).dot(cameraForward)
            > maximumInterveningDistance) {
          return;
        }
        if (containmentDistance <= CAMERA_ARCHITECTURE_CONTAINMENT_PROXIMITY) {
          if (!cameraContainingRecord
            || (this._isCameraOcclusionVerticalRecord(record)
              && !this._isCameraOcclusionVerticalRecord(cameraContainingRecord))) {
            cameraContainingRecord = record;
          }
        }
        this._hideCameraAdjacentWallRecord(record);
      },
    );
    if (cameraContainingRecord) {
      const verticalOnly = this._isCameraOcclusionVerticalRecord(cameraContainingRecord);
      this._hideCameraOcclusionArchitectureNeighborhood(cameraPosition, {
        seedEntry: cameraContainingRecord.entry,
        verticalOnly,
      });
    }
  }

  _hideCameraInterveningVerticalArchitecture() {
    if (!this.camera?.position || !this.player?.root?.position) return;
    const cameraPosition = this.camera.position;
    const playerFocus = tempVectorA.copy(this.player.root.position);
    playerFocus.y += 1.25;
    const cameraToPlayer = tempVectorB.copy(playerFocus).sub(cameraPosition);
    const playerDistance = cameraToPlayer.length();
    cameraToPlayer.y = 0;
    const horizontalPlayerDistance = cameraToPlayer.length();
    const maximumInterveningDistance = horizontalPlayerDistance
      - CAMERA_OCCLUSION_PLAYER_CLEARANCE;
    if (maximumInterveningDistance <= 0.08) return;
    cameraToPlayer.multiplyScalar(1 / horizontalPlayerDistance);

    // Occlusion runs before renderer.render(), so force the inverse view matrix
    // to match the camera controller's position from this same frame.
    this.camera.updateMatrixWorld(true);
    tempCameraOcclusionViewProjection.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    tempCameraOcclusionFrustum.setFromProjectionMatrix(tempCameraOcclusionViewProjection);

    const halfVerticalSpan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5))
      * playerDistance;
    const corridorRadius = Math.max(
      CAMERA_OCCLUSION_BIN_SIZE,
      halfVerticalSpan * Math.max(1, this.camera.aspect),
    );
    const minBinX = Math.floor(
      (Math.min(cameraPosition.x, playerFocus.x) - corridorRadius) / CAMERA_OCCLUSION_BIN_SIZE,
    );
    const maxBinX = Math.floor(
      (Math.max(cameraPosition.x, playerFocus.x) + corridorRadius) / CAMERA_OCCLUSION_BIN_SIZE,
    );
    const minBinZ = Math.floor(
      (Math.min(cameraPosition.z, playerFocus.z) - corridorRadius) / CAMERA_OCCLUSION_BIN_SIZE,
    );
    const maxBinZ = Math.floor(
      (Math.max(cameraPosition.z, playerFocus.z) + corridorRadius) / CAMERA_OCCLUSION_BIN_SIZE,
    );

    this.cameraOcclusionWallProximityCandidateKeys.clear();
    for (let binX = minBinX; binX <= maxBinX; binX += 1) {
      for (let binZ = minBinZ; binZ <= maxBinZ; binZ += 1) {
        for (const record of this.cameraOcclusionWallProximityBins.get(`${binX},${binZ}`) ?? []) {
          if (this.cameraOcclusionWallProximityCandidateKeys.has(record.key)) continue;
          this.cameraOcclusionWallProximityCandidateKeys.add(record.key);
          if (!tempCameraOcclusionFrustum.intersectsBox(record.bounds)) {
            continue;
          }

          record.bounds.getCenter(tempVectorD);
          record.bounds.getSize(tempVectorF).multiplyScalar(0.5);
          const centerDepth = tempVectorD.sub(cameraPosition).dot(cameraToPlayer);
          const projectedHalfDepth = Math.abs(cameraToPlayer.x) * tempVectorF.x
            + Math.abs(cameraToPlayer.z) * tempVectorF.z;
          const nearDepth = centerDepth - projectedHalfDepth;
          const farDepth = centerDepth + projectedHalfDepth;
          if (farDepth < 0.04 || nearDepth > maximumInterveningDistance) continue;

          if (!this._isCameraOcclusionVerticalRecord(record)) {
            // Do not classify an entire mesh by its top face. Opening-room
            // foundation tiles are walkable on top but their 3.2m-deep sides
            // are vertical architecture. Hide one only when the view band
            // passes through its vertical volume; a floor wholly below that
            // band remains rendered.
            const centerLateralDistance = Math.abs(
              -cameraToPlayer.z * tempVectorD.x + cameraToPlayer.x * tempVectorD.z,
            );
            const projectedHalfLateral = Math.abs(cameraToPlayer.z) * tempVectorF.x
              + Math.abs(cameraToPlayer.x) * tempVectorF.z;
            if (centerLateralDistance - projectedHalfLateral
              > CAMERA_ARCHITECTURE_HIT_CUTOUT_RADIUS) {
              continue;
            }
            const clippedNearDepth = THREE.MathUtils.clamp(
              nearDepth,
              0.04,
              maximumInterveningDistance,
            );
            const clippedFarDepth = THREE.MathUtils.clamp(
              farDepth,
              0.04,
              maximumInterveningDistance,
            );
            const nearSightlineY = THREE.MathUtils.lerp(
              cameraPosition.y,
              playerFocus.y,
              clippedNearDepth / horizontalPlayerDistance,
            );
            const farSightlineY = THREE.MathUtils.lerp(
              cameraPosition.y,
              playerFocus.y,
              clippedFarDepth / horizontalPlayerDistance,
            );
            const minimumSightlineY = Math.min(nearSightlineY, farSightlineY)
              - CAMERA_OCCLUSION_SIGHTLINE_HEIGHT_CLEARANCE;
            const maximumSightlineY = Math.max(nearSightlineY, farSightlineY)
              + CAMERA_OCCLUSION_SIGHTLINE_HEIGHT_CLEARANCE;
            if (record.bounds.max.y < minimumSightlineY
              || record.bounds.min.y > maximumSightlineY) {
              continue;
            }
          }

          // The complete visible architectural field in front of the player
          // is the occluder. Do not reduce it to one ray hit or a fixed-radius
          // hole. Height intersection keeps unrelated lower floors intact.
          this._hideCameraAdjacentWallRecord(record);
        }
      }
    }
  }

  _hideCameraForwardArchitecture() {
    if (!this.camera?.position || !this.player?.root?.position) return;
    const cameraPosition = this.camera.position;
    const cameraForward = tempVectorE.set(0, 0, -1)
      .applyQuaternion(this.camera.quaternion)
      .normalize();
    const playerFocus = tempVectorA.copy(this.player.root.position);
    playerFocus.y += 1.25;
    const playerDistance = cameraPosition.distanceTo(playerFocus);
    const maxDistance = Math.min(
      CAMERA_OCCLUSION_FORWARD_MAX_DISTANCE,
      playerDistance - CAMERA_OCCLUSION_PLAYER_CLEARANCE,
    );
    if (maxDistance <= 0.08) return;

    const forwardEnd = tempVectorF.copy(cameraPosition)
      .addScaledVector(cameraForward, maxDistance);
    const minBinX = Math.floor(
      Math.min(cameraPosition.x, forwardEnd.x) / CAMERA_OCCLUSION_BIN_SIZE,
    );
    const maxBinX = Math.floor(
      Math.max(cameraPosition.x, forwardEnd.x) / CAMERA_OCCLUSION_BIN_SIZE,
    );
    const minBinZ = Math.floor(
      Math.min(cameraPosition.z, forwardEnd.z) / CAMERA_OCCLUSION_BIN_SIZE,
    );
    const maxBinZ = Math.floor(
      Math.max(cameraPosition.z, forwardEnd.z) / CAMERA_OCCLUSION_BIN_SIZE,
    );

    this.cameraOcclusionRaycaster.set(cameraPosition, cameraForward);
    this.cameraOcclusionWallProximityCandidateKeys.clear();
    this.cameraOcclusionForwardVerticalHits ??= [];
    let forwardHitCount = 0;
    for (let binX = minBinX; binX <= maxBinX; binX += 1) {
      for (let binZ = minBinZ; binZ <= maxBinZ; binZ += 1) {
        for (const record of this.cameraOcclusionWallProximityBins.get(`${binX},${binZ}`) ?? []) {
          if (this.cameraOcclusionWallProximityCandidateKeys.has(record.key)) continue;
          this.cameraOcclusionWallProximityCandidateKeys.add(record.key);
          // This recovery ray exists for the wall-fills-the-frame failure. Do
          // not let a walkable slab beneath the camera win the closest-hit test
          // and disappear even though it does not block the player.
          if (!this._isCameraOcclusionVerticalRecord(record)) continue;
          const boundsHit = this.cameraOcclusionRaycaster.ray.intersectBox(
            record.bounds,
            tempVectorD,
          );
          if (!boundsHit) continue;
          const hitDistance = boundsHit.distanceTo(cameraPosition);
          if (hitDistance < 0.04
            || hitDistance > maxDistance) {
            continue;
          }
          const forwardHit = this.cameraOcclusionForwardVerticalHits[forwardHitCount] ?? {
            record: null,
            distance: 0,
            point: new THREE.Vector3(),
          };
          forwardHit.record = record;
          forwardHit.distance = hitDistance;
          forwardHit.point.copy(boundsHit);
          this.cameraOcclusionForwardVerticalHits[forwardHitCount] = forwardHit;
          forwardHitCount += 1;
        }
      }
    }
    this.cameraOcclusionForwardVerticalHits.length = forwardHitCount;
    this.cameraOcclusionForwardVerticalHits.sort((a, b) => a.distance - b.distance);
    // Clear every vertical layer along the center view, not merely the closest
    // panel. Distinct-record deduplication avoids repeated neighborhood work
    // across probes without imposing any quantity limit on intervening walls.
    for (const forwardHit of this.cameraOcclusionForwardVerticalHits) {
      this._expandCameraOcclusionVerticalRecord(forwardHit.record, forwardHit.point);
    }
  }

  _updateCameraWallOcclusion() {
    this._restoreCameraOcclusionHiddenInstances();
    for (const owner of this.cameraOcclusionHiddenOwners) {
      owner.visible = this.cameraOcclusionOwnerBaseVisibility.get(owner) ?? true;
    }
    this.cameraOcclusionHiddenOwners.clear();
    this.cameraOcclusionExpandedVerticalRecordKeys ??= new Set();
    this.cameraOcclusionExpandedVerticalRecordKeys.clear();
    this.cameraOcclusionExpandedSurfaceRecordKeys ??= new Set();
    this.cameraOcclusionExpandedSurfaceRecordKeys.clear();

    if (!this.cameraOcclusionEntries.length || !this.player?.root) {
      return;
    }

    tempVectorC.set(1, 0, 0).applyQuaternion(this.camera.quaternion).setY(0);
    if (tempVectorC.lengthSq() <= 0.0001) {
      tempVectorC.set(1, 0, 0);
    } else {
      tempVectorC.normalize();
    }
    // Wall visibility is deliberately limited to the camera-to-player
    // silhouette. Proximity, the camera-forward direction, and the rest of the
    // viewport must not make unrelated architecture disappear.
    for (const probe of CAMERA_OCCLUSION_TARGET_PROBES) {
      tempVectorA.copy(this.player.root.position)
        .addScaledVector(tempVectorC, probe.lateral);
      tempVectorA.y += probe.height;
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
              !entry.wallSurface
              || this.cameraOcclusionCandidateSet.has(entry)
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
      // Thin, non-instanced wall meshes can be missed on a triangle edge even
      // when their authored box crosses the viewing segment. Keep an exact
      // segment/AABB fallback for walls only. Floors, ramps, supports, ceilings,
      // and other nearby architecture never participate in this rule.
      for (const entry of this.cameraOcclusionCandidateSet) {
        if (!entry.wallSurface
          || (entry.object.isInstancedMesh
            && entry.object.userData?.cameraOcclusionPerInstance === true)) {
          continue;
        }
        const boundsHit = this.cameraOcclusionRaycaster.ray.intersectBox(
          entry.bounds,
          tempVectorD,
        );
        if (boundsHit
          && boundsHit.distanceTo(this.camera.position) <= this.cameraOcclusionRaycaster.far) {
          entry.owner.visible = false;
          this.cameraOcclusionHiddenOwners.add(entry.owner);
        }
      }
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
        const hitRecord = this._getCameraOcclusionProximityRecord(
          hit.object,
          hit.instanceId,
        );
        if (!hitRecord?.entry?.wallSurface) continue;
        if (this._hideCameraOcclusionInstance(hit)) continue;
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
    this.dungeonRenderCullGroups = [...(this.dungeon?.renderCullGroups ?? [])].map((entry) => {
      if (entry?.group) return entry;
      const center = entry?.userData?.cullCenter;
      const radius = Number(entry?.userData?.cullRadius) || 20;
      return {
        group: entry,
        minX: (center?.x ?? 0) - radius,
        maxX: (center?.x ?? 0) + radius,
        minZ: (center?.z ?? 0) - radius,
        maxZ: (center?.z ?? 0) + radius,
        drawObjectCount: entry?.geometry?.groups?.length ?? 1,
      };
    });
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
    const hideDistance = this.worldKind === 'overworld'
      ? OVERWORLD_RENDER_CULL_HIDE_DISTANCE
      : DUNGEON_RENDER_CULL_HIDE_DISTANCE;
    const showDistance = this.worldKind === 'overworld'
      ? OVERWORLD_RENDER_CULL_SHOW_DISTANCE
      : DUNGEON_RENDER_CULL_SHOW_DISTANCE;
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
      if (renderGroup.visible && distance > hideDistance) {
        renderGroup.visible = false;
      } else if (!renderGroup.visible && distance < showDistance) {
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
    return !this.inventoryOpen
      && !this.poseDebugOpen
      && !this.isGameOver
      && !this.ui?.isWorldModalOpen?.()
      && (this.transitionState === 'overworld' || this.transitionState === 'dungeon');
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
    this.hostEventBindingPasses += 1;
    const listen = (target, type, listener, options) => {
      target.addEventListener(type, listener, options);
      this.hostEventListenerRegistrations += 1;
    };

    listen(window, 'keydown', (event) => {
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

      if (event.code === 'Escape' && this.busterSandboxSession?.active) {
        event.preventDefault();
        this.exitBusterSandbox('manualExit');
        return;
      }

      if (event.code === 'KeyI' && this.busterSandboxSession?.active) {
        event.preventDefault();
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

      if (!this.inventoryOpen && !this.poseDebugOpen && !event.repeat && event.code === 'KeyG') {
        event.preventDefault();
        this.combat.tryGuardAction?.(this.pointer.aimWorld);
        return;
      }

      if (!this.inventoryOpen && !this.poseDebugOpen && !event.repeat && event.code === 'Tab') {
        event.preventDefault();
        this.pointer.lockOnPressed = true;
        return;
      }

      if (!this.inventoryOpen
        && !this.poseDebugOpen
        && !this.debugNoClipEnabled
        && !event.repeat
        && (event.code === 'ControlLeft' || event.code === 'ControlRight')) {
        event.preventDefault();
        this.player?.toggleWalkMode?.();
        return;
      }

      if (!this.inventoryOpen
        && !this.poseDebugOpen
        && !this.debugNoClipEnabled
        && !event.repeat
        && event.code === 'Space') {
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

    listen(window, 'keyup', (event) => {
      if (event.code === 'KeyZ') {
        this.pointer.alternate = false;
        return;
      }

      this.keys.delete(event.code);
    });

    listen(window, 'blur', () => {
      this.keys.clear();
      this.pointer.primary = false;
      this.pointer.primaryPressed = false;
      this.pointer.secondary = false;
      this.pointer.secondaryPressed = false;
      this.pointer.lockOnPressed = false;
      this.pointer.alternate = false;
      this.pointer.alternatePressed = false;
    });

    listen(document, 'pointerlockchange', () => this._handlePointerLockChange());

    listen(document, 'mousemove', (event) => {
      if (!this.pointerLocked || this.poseDebugOpen) {
        return;
      }

      this._updatePointerFromMouseEvent(event);
    });

    listen(document, 'mousedown', (event) => {
      if (!this.pointerLocked || this.poseDebugOpen || !this._isGameplayPointerLockAllowed()) {
        return;
      }

      if (this._setCombatMouseButton(event.button, true)) {
        event.preventDefault();
      }
    });

    listen(document, 'mouseup', (event) => {
      if (!this.pointerLocked || this.poseDebugOpen) {
        return;
      }

      if (this._setCombatMouseButton(event.button, false)) {
        event.preventDefault();
      }
    });

    listen(this.renderer.domElement, 'pointermove', (event) => {
      if (!this.pointerLocked) {
        this._updatePointerFromMouseEvent(event);
      }

      if (this.poseDebugOpen) {
        this._handlePoseDebugPointerMove(event);
      }
    });

    listen(this.renderer.domElement, 'pointerdown', (event) => {
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

    listen(window, 'pointerup', (event) => {
      if (this.poseDebugOpen) {
        this._handlePoseDebugPointerUp(event);
        return;
      }

      this._setCombatMouseButton(event.button, false);
    });

    listen(this.renderer.domElement, 'contextmenu', (event) => {
      event.preventDefault();
    });

    listen(this.renderer.domElement, 'wheel', (event) => {
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

    listen(window, 'resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  _addStarterItems() {
    const armsGear = this.busterLabState?.armsGear ?? createDefaultArmsGearState();
    this.player.applyArmsGearState(armsGear, {
      resolveCustomBuster: (buildId) => this._createCustomBusterArmDescriptor(buildId),
      refillBarrier: true,
    });
    this.player.switchArmWeapon(0, true);
  }

  _updateEnemies(dt) {
    this._updatingEnemies = true;
    try {
      this._updateEnemyAttackDirector(dt);
      for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
        const enemy = this.enemies[i];
        if (!enemy || this._deferredEnemyRemovals?.has(enemy)) continue;
        enemy.update(dt, this);
        if (this._deferredEnemyRemovals?.has(enemy)) continue;

        if (enemy.dead && enemy.deathTimer <= 0) {
          enemy.dispose?.();
          enemy.root.removeFromParent();
          this.enemies.splice(i, 1);
        }
      }
    } finally {
      this._updatingEnemies = false;
      this._flushDeferredEnemyRemovals();
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
          const hitResult = this.player.takeIncomingHit({
            amount: hazard.damage,
            source: hazard.source,
            attackKind: 'clawSwipeTrail',
            direction: tempVectorA,
            guardable: true,
            reactionTier: 1,
            knockbackStrength: 0.72,
          });
          if (hitResult.healthDamage > 0) {
            hazard.source?.onHitPlayer?.(this.player, hitResult.healthDamage);
          }
          if (hitResult.contacted && !hitResult.dodged && !hitResult.immune) {
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
        this.player.takeIncomingHit({
          amount: hazard.damagePerSecond * dt,
          source: hazard.source ?? null,
          guardable: false,
          reactionTier: 0,
          hazardDomain: hazard.hazardDomain,
          hazardTags: hazard.hazardTags,
          statusEffects: hazard.element === 'fire' ? ['burn'] : [],
        });
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
      } else if (effect.kind === 'bossRecoveryPresentation') {
        const age = 1 - progress;
        const targetPosition = effect.target?.position ?? this.player.root.position;
        tempVectorA.copy(targetPosition);
        tempVectorA.y += 1.05;
        effect.object.position.lerpVectors(effect.start, tempVectorA, THREE.MathUtils.smoothstep(age, 0.18, 0.95));
        effect.object.position.y += Math.sin(age * Math.PI) * 1.1;
        effect.object.rotation.x += dt * 4.2;
        effect.object.rotation.y += dt * 6.4;
        if (effect.object.material) effect.object.material.opacity = Math.min(1, progress * 2.4);
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
    if (enemy.debugBoss) return;
    if (this.busterSandboxSession?.active) {
      return;
    }
    if (enemy.isBoss && enemy.bossProfileId) {
      if (enemy.bossVictoryCommitted && enemy.pendingBossVictoryResult) {
        this._presentBossVictoryResult(enemy, enemy.pendingBossVictoryResult);
        enemy.pendingBossVictoryResult = null;
      } else if (!enemy.bossVictoryCommitted) {
        this._trackBossVictoryCommit(this._recordBossVictory(enemy), this.activeWorldBundle);
      }
    }
    if (meta.selfDestruct || meta.suppressRewards) {
      return;
    }
    this.player.addExperience(enemy.stats.experience);

    if (!meta.suppressGenericOffense
      && meta.source === this.player
      && this.player.stats.explodeOnKillChance > 0
      && Math.random() < this.player.stats.explodeOnKillChance) {
      this.addExplosion(enemy.root.position, this.player.stats.attackDamage * 1.4, 1.9, 0xff8a42, {
        source: this.player,
        damagePlayer: false,
      });
    }

    this.refractors.rollEnemyDrop(enemy);
    this.dungeonController?.rollEnemyKeycardDrop?.(enemy);
    this._rollEnemyScrapDrop(enemy);
    this.lootSystem.rollDrop(enemy);
  }

  async commitAscensionCheckpoint(enemy, checkpoint) {
    if (enemy?.debugBoss) return { ok: true, debug: true, encounterProgress: checkpoint };
    const expeditionId = enemy?.expeditionSpec?.id ?? this.activeBossExpeditionSpec?.id;
    if (!expeditionId || !this.busterLabStorage?.recordBossCheckpoint) {
      return { ok: false, reason: 'storage-unavailable' };
    }
    const result = await this._queueBusterStorageOperation(() => (
      this.busterLabStorage.recordBossCheckpoint({
        expeditionId,
        bossProfileId: enemy.bossProfileId,
        securedCheckpointIndex: checkpoint.securedCheckpointIndex,
        securedCheckpointId: checkpoint.securedCheckpointId,
        brokenSealIndex: checkpoint.brokenSealIndex,
        sandbox: Boolean(this.busterSandboxSession?.active),
        debug: false,
      })
    ));
    if (!result?.ok) return result;
    const encounterProgress = result.encounterProgress
      ?? result.record?.encounterProgress
      ?? result.checkpoint
      ?? null;
    if (encounterProgress) {
      const nextSpec = Object.freeze({
        ...(enemy.expeditionSpec ?? this.activeBossExpeditionSpec ?? {}),
        encounterProgress,
      });
      enemy.expeditionSpec = nextSpec;
      if (this.activeBossExpeditionSpec?.id === expeditionId) this.activeBossExpeditionSpec = nextSpec;
      const encounter = this.dungeon?.encounters?.find?.((entry) => entry.expeditionSpec?.id === expeditionId);
      if (encounter) encounter.expeditionSpec = nextSpec;
    }
    return result;
  }

  commitAscensionVictory(enemy) {
    if (enemy?.debugBoss) return Promise.resolve({ ok: true, debug: true });
    return this._trackBossVictoryCommit(
      this._recordBossVictory(enemy, { present: false, ascensionAtomic: true }),
      this.activeWorldBundle,
    );
  }

  _trackBossVictoryCommit(promise, bundle = this.activeWorldBundle) {
    if (!bundle) return Promise.resolve(promise);
    const tracked = Promise.resolve(promise).then((result) => {
      bundle.bossVictoryCommitResult = result;
      return result;
    });
    bundle.pendingBossVictoryCommit = tracked;
    return tracked;
  }

  async _recordBossVictory(enemy, {
    present = true,
    ascensionAtomic = false,
    originBundle = this.activeWorldBundle,
  } = {}) {
    const expeditionId = enemy.expeditionSpec?.id
      ?? this.activeBossExpeditionSpec?.id
      ?? `boss:${enemy.id}`;
    const storageMethod = ascensionAtomic
      ? this.busterLabStorage?.recordAscensionBossVictory
      : this.busterLabStorage?.recordBossVictory;
    if (!storageMethod) return { ok: false, reason: 'storage-unavailable' };
    try {
      const result = await this._queueBusterStorageOperation(() => (
        storageMethod.call(this.busterLabStorage, {
          expeditionId,
          bossProfileId: enemy.bossProfileId,
          signaturePartOverloaded: Boolean(enemy.signaturePartOverloaded),
          sandbox: Boolean(this.busterSandboxSession?.active),
          debug: Boolean(enemy.debugBoss),
        })
      ));
      if (!result?.ok) {
        this.bossHuntWarning = result?.reason === 'read-only'
          ? 'Boss recovery could not be committed while storage is read-only. First-clear eligibility was preserved.'
          : 'Boss recovery could not be committed; this expedition remains eligible for recovery.';
        if (this.activeWorldBundle === originBundle && !originBundle?.disposed) {
          this.ui?.showToast?.(this.bossHuntWarning, '#ff9f73');
        }
        return result;
      }
      this.bossHuntWarning = null;
      if (!present
        || this.activeWorldBundle !== originBundle
        || originBundle?.disposed
        || this.worldKind !== 'dungeon') return result;
      if (result.defenseUnlocked) {
        this._applyPersistedArmsGear({ refillBarrier: Boolean(result.barrierGranted) });
      }
      if (result.barrierGranted) {
        this.ui?.showToast?.('Defense Gear unlocked · Barrier Generator equipped', '#7df8ff');
      }
      if (result.rewardQueued || result.recovery || result.queuedRecovery) {
        this._playBossRecoveryPresentation(enemy, result);
      } else {
        this.ui?.showToast?.(`${enemy.bossProfile?.title ?? 'Boss'} defeated · no intact signature material`, '#c7d0d6');
      }
      this.ui?.renderInventory?.();
      return result;
    } catch (error) {
      this.bossHuntWarning = 'Boss recovery could not be saved. First-clear eligibility was preserved.';
      if (this.activeWorldBundle === originBundle && !originBundle?.disposed) {
        this.ui?.showToast?.(this.bossHuntWarning, '#ff9f73');
      }
      return { ok: false, reason: 'transaction-failed', error };
    }
  }

  _presentBossVictoryResult(enemy, result = {}) {
    if (result.defenseUnlocked) {
      this._applyPersistedArmsGear({ refillBarrier: Boolean(result.barrierGranted) });
    }
    if (result.barrierGranted) {
      this.ui?.showToast?.('Defense Gear unlocked · Barrier Generator equipped', '#7df8ff');
    }
    if (result.rewardQueued || result.recovery || result.queuedRecovery) {
      this._playBossRecoveryPresentation(enemy, result);
    } else {
      this.ui?.showToast?.(`${enemy.bossProfile?.title ?? 'Boss'} defeated · no intact signature material`, '#c7d0d6');
    }
    this.ui?.renderInventory?.();
  }

  _playBossRecoveryPresentation(enemy, result = {}) {
    const position = (enemy.deathDropPosition ?? enemy.root.position).clone();
    position.y += 1.05;
    const material = getReaverbotBossRewardMaterial(enemy.bossProfileId);
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.34, 1),
      new THREE.MeshStandardMaterial({
        color: 0xffd36f,
        emissive: enemy.genome?.palette?.emissive ?? 0xff8f42,
        emissiveIntensity: 1.05,
        roughness: 0.26,
        metalness: 0.58,
        transparent: true,
        opacity: 0.95,
      }),
    );
    mesh.name = 'bossRecoveryPresentationPickup';
    mesh.position.copy(position);
    (this.activeWorldBundle?.root ?? this.scene).add(mesh);
    this.timedEffects.push({
      object: mesh,
      kind: 'bossRecoveryPresentation',
      life: 1.45,
      maxLife: 1.45,
      target: this.player.root,
      start: position.clone(),
    });
    this.addParticleBurst(position, 0xffd36f, 42, 0.22);
    const firstClear = result.firstClear === true || result.victoryIndex === 1;
    const materialDiscovered = Boolean(
      material && this.rollSalvageStorage?.hasDiscoveredPart?.(material.id),
    );
    const overloadLabel = enemy.signaturePartOverloaded ? ' · signature overloaded' : '';
    this.ui?.showBossVictory?.(enemy, {
      material: materialDiscovered ? material : null,
      roleClue: enemy.bossProfile?.roleClue ?? null,
      firstClear,
      overload: enemy.signaturePartOverloaded,
    });
    this.ui?.showToast?.(
      `${firstClear ? 'Guaranteed ' : ''}Boss Recovery queued${overloadLabel} · bring it to Roll`,
      '#ffd36f',
    );
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
    if (enemy?.isBoss) {
      const position = (enemy.deathDropPosition ?? enemy.root.position).clone();
      position.y += 0.34;
      this.lootSystem.createUnidentifiedScrapPickup(3, position, {
        source: {
          enemyName: enemy.genome?.name ?? enemy.bossProfile?.title ?? 'Reaverbot Boss',
          enemySeed: enemy.genome?.seed ?? null,
          threatTier: enemy.genome?.threatTier ?? 1,
          elite: false,
          bossProfileId: enemy.bossProfileId,
        },
        recoverableParts: [],
      });
      enemy.lastSalvageDrops = [];
      return 3;
    }
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

    const staggerDuration = resolveBusterStaggerDuration(meta, enemy, dealt);
    if (staggerDuration > 0) {
      enemy.applyStatus('stagger', {
        duration: staggerDuration,
        extend: Boolean(meta.busterExecutionStaggerLedger),
      });
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
