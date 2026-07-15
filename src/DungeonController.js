import * as THREE from 'three';
import {
  DungeonProgressionManager,
  SHRINE_KEY_ID,
} from './DungeonProgression.js';
import { PLAYER_TRAVERSAL_ENVELOPE } from './TraversalCapabilities.js';

const KEYCARD_COLOR = 0xffd66b;
const MECHANISM_COLOR = 0x6bdcff;
const SHRINE_COLOR = 0x7df8ff;
const LOCKED_COLOR = 0xffb347;
const KEY_SEEKER_COLOR = 0x5ee77b;
const TRACKING_COLOR = 0xa06cff;
const DOOR_OPEN_Y = -5.3;
const PLAYER_STEP_OFF_FALL_HEIGHT = PLAYER_TRAVERSAL_ENVELOPE.groundedStepDownHeight;
const AERIAL_DEFAULT_LOOKAHEAD = 3.4;
const AERIAL_PATH_SAMPLE_SPACING = 0.24;
const AERIAL_WAYPOINT_CLEARANCE = 0.28;
const AERIAL_CEILING_CLEARANCE = 0.08;
const POWER_KNOCKBACK_BARRIER_SAMPLE_SPACING = 0.06;
const POWER_KNOCKBACK_BARRIER_LABEL_PATTERN = /boundary|wall|door|gate|barrier|fence|partition|bulkhead/i;
const PLAYER_RAIL_BALANCE_TOLERANCE = 0.045;
const PLAYER_RAIL_LANDING_VERTICAL_TOLERANCE = 0.16;
const PLAYER_RAIL_STALL_PROXIMITY = 0.42;
const PLAYER_RAIL_STALL_TIME = 0.2;
const PLAYER_RAIL_RECOVERY_NUDGE = 0.16;
const ENEMY_GROUND_TRAVERSAL_MAX_DISTANCE = 3.4;
const ENEMY_GROUND_TRAVERSAL_MAX_DROP = 3.2;
const ENEMY_GROUND_TRAVERSAL_MAX_RISE = 0.65;
const ENEMY_GROUND_TRAVERSAL_SAMPLE_SPACING = 0.24;
const RAMP_SUPPORT_CAPTURE_HEIGHT = PLAYER_TRAVERSAL_ENVELOPE.maximumRampRisePerTile + 0.18;
const NAVIGATION_CACHE_LIMIT = 4096;
const FLOOR_ROUTE_FIELD_LIMIT = 12;
const CARDINAL_NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const tempVectorA = new THREE.Vector3();
const tempVectorB = new THREE.Vector3();
const tempVectorC = new THREE.Vector3();

function getZoneLocalXZ(position, zone) {
  let x = position.x - zone.position.x;
  let z = position.z - zone.position.z;
  const rotationY = zone.rotationY ?? 0;

  if (Math.abs(rotationY) > 0.0001) {
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    const rotatedX = x * cos + z * sin;
    const rotatedZ = -x * sin + z * cos;
    x = rotatedX;
    z = rotatedZ;
  }

  return { x, z };
}

function zoneLocalToWorld(zone, x, y, z) {
  const rotationY = zone.rotationY ?? 0;
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  return new THREE.Vector3(
    zone.position.x + x * cos - z * sin,
    y,
    zone.position.z + x * sin + z * cos,
  );
}

function isInsideExpandedZone(position, zone, radius = 0, verticalRadius = radius) {
  if (!position || !zone?.position) {
    return false;
  }

  const local = getZoneLocalXZ(position, zone);
  if (Math.abs(local.x) > (zone.halfWidth ?? 0) + radius
    || Math.abs(local.z) > (zone.halfDepth ?? 0) + radius) {
    return false;
  }

  if (Number.isFinite(zone.verticalHalfHeight)) {
    return Math.abs((position.y ?? 0) - (zone.position.y ?? 0))
      <= zone.verticalHalfHeight + verticalRadius;
  }

  return true;
}

function getRayAabbInterval2D(origin, direction, maxDistance, center, halfWidth, halfDepth) {
  let near = 0;
  let far = maxDistance;
  for (const [originValue, directionValue, centerValue, halfExtent] of [
    [origin.x, direction.x, center.x, halfWidth],
    [origin.z, direction.z, center.z, halfDepth],
  ]) {
    const minimum = centerValue - halfExtent;
    const maximum = centerValue + halfExtent;
    if (Math.abs(directionValue) <= 0.000001) {
      if (originValue < minimum || originValue > maximum) return null;
      continue;
    }
    let entry = (minimum - originValue) / directionValue;
    let exit = (maximum - originValue) / directionValue;
    if (entry > exit) [entry, exit] = [exit, entry];
    near = Math.max(near, entry);
    far = Math.min(far, exit);
    if (near > far) return null;
  }
  return far >= 0 && near <= maxDistance
    ? { entry: Math.max(0, near), exit: Math.min(maxDistance, far) }
    : null;
}

function tileKey(x, z) {
  return `${x},${z}`;
}

function isInsideZone(position, zone) {
  let localX = position.x - zone.position.x;
  let localZ = position.z - zone.position.z;

  if (Number.isFinite(zone.rotationY) && Math.abs(zone.rotationY) > 0.0001) {
    const cos = Math.cos(zone.rotationY);
    const sin = Math.sin(zone.rotationY);
    const rotatedX = localX * cos + localZ * sin;
    const rotatedZ = -localX * sin + localZ * cos;
    localX = rotatedX;
    localZ = rotatedZ;
  }

  const insideXZ = Math.abs(localX) <= zone.halfWidth
    && Math.abs(localZ) <= zone.halfDepth;

  if (!insideXZ) {
    return false;
  }

  if (Number.isFinite(zone.verticalHalfHeight)) {
    return Math.abs((position.y ?? 0) - (zone.position.y ?? 0)) <= zone.verticalHalfHeight;
  }

  return true;
}

function createDroppedKeycardObject() {
  const group = new THREE.Group();
  group.name = 'droppedRuinKeycard';

  const cardMaterial = new THREE.MeshStandardMaterial({
    color: KEYCARD_COLOR,
    emissive: KEYCARD_COLOR,
    emissiveIntensity: 0.95,
    roughness: 0.3,
    metalness: 0.08,
  });
  const haloMaterial = new THREE.MeshBasicMaterial({
    color: KEYCARD_COLOR,
    transparent: true,
    opacity: 0.26,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const card = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.62), cardMaterial);
  card.name = 'droppedKeycardBody';
  card.castShadow = true;

  const halo = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.44, 28), haloMaterial);
  halo.name = 'droppedKeycardHalo';
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -0.18;

  group.add(card, halo);
  return group;
}

export class DungeonController {
  constructor(game, dungeon) {
    this.game = game;
    this.dungeon = dungeon;
    this.tileSize = dungeon?.tileSize ?? 2.8;
    this.tiles = dungeon?.tiles ?? new Map();
    this.floorTiles = dungeon?.floorTiles ?? [...this.tiles.values()];
    this.floorTilesByColumn = this._createFloorTileColumns(this.floorTiles);
    this.doors = dungeon?.doors ?? [];
    this.keycards = dungeon?.keycards ?? [];
    this.chests = dungeon?.chests ?? [];
    this.mechanisms = dungeon?.mechanisms ?? [];
    this.puzzleBlocks = dungeon?.puzzleBlocks ?? [];
    this.pressurePlates = dungeon?.pressurePlates ?? [];
    this.npcAnimationMixers = dungeon?.npcAnimationMixers ?? [];
    this.npcAnimators = dungeon?.npcAnimators ?? [];
    this.safeInteractables = dungeon?.safeInteractables ?? [];
    this.rollInteractable = this.safeInteractables.find(({ action }) => action === 'roll') ?? null;
    this.safeZones = dungeon?.safeZones ?? [];
    this.solidZones = dungeon?.solidZones ?? [];
    this.aerialBoundaryZones = dungeon?.aerialBoundaryZones ?? [];
    this.encounters = dungeon?.encounters ?? [];
    this.traps = dungeon?.traps ?? [];
    this.conveyors = dungeon?.conveyors ?? [];
    this.conveyorPuzzles = dungeon?.conveyorPuzzles ?? [];
    this.conveyorPuzzleById = new Map(this.conveyorPuzzles.map((puzzle) => [puzzle.id, puzzle]));
    this.shrine = dungeon?.shrine ?? null;
    this.keySeeker = dungeon?.keySeeker ?? dungeon?.progression?.keySeeker ?? null;
    this.progression = dungeon?.progression ?? null;
    this.progressionManager = new DungeonProgressionManager(this.progression);
    this.keycardCount = this.progressionManager.getNormalKeycardCount();
    this.discoveredRoomIds = new Set(['hubTown', 'expeditionCamp', 'entrance']);
    this.visitedRoomIds = new Set(['hubTown', 'expeditionCamp', 'entrance']);
    this.nearestInteractable = null;
    this.lastSafePlayerPosition = new THREE.Vector3();
    this.pendingPlayerJumpOffLanding = null;
    this.playerRailTopSurfaces = this._collectPlayerRailTopSurfaces();
    this.playerRailRecoveryState = {
      initialized: false,
      lastPosition: new THREE.Vector3(),
      stallTimer: 0,
      cooldown: 0,
      lastResult: null,
    };
    this.lastSafeEnemyPositions = new Map();
    this.navigationCache = new Map();
    this.navigationTopologyRevision = 0;
    this.floorNavigationGraph = null;
    this.navigationDoorStateSignature = this._getNavigationDoorStateSignature();
    this.navigationTopologySources = this._getNavigationTopologySources();
    this.trapPulseTimer = 0;
    this.environmentalStoryToastTimer = 0;
    this.pendingRoomAnnouncements = [];

    if (game?.player?.root) {
      this.lastSafePlayerPosition.copy(game.player.root.position);
    }

    this._bindConveyorVisuals();
    this._initializeConveyorPuzzles();
  }

  update(dt) {
    if (!this.game?.player || !this.dungeon) {
      return;
    }

    this._refreshNavigationTopology();
    this._updateRoomAnnouncements(dt);
    this._constrainPlayerToWalkable();
    this._updatePlayerAirborneRailRecovery(dt);
    this._updateRoomDiscovery();
    this._updateKeycards(dt);
    this._updateTraps(dt);
    this._updateTrapVisuals(dt);
    this._updatePuzzleBlocks(dt);
    this._updateConveyors(dt);
    this._updateConveyorPuzzles(dt);
    this._updatePressurePlates(dt);
    this._updateEncounters();
    this._constrainPlayerToWalkable();
    this._updateDoorVisuals(dt);
    this._updateChestVisuals(dt);
    this._updateMechanismVisuals(dt);
    this._updateKeySeekerVisuals(dt);
    this._updateExtractionVisuals(dt);
    this._updateExpeditionEntryState();
    this._updateNearestInteractable();
  }

  _getNavigationDoorStateSignature() {
    let signature = this.doors.length | 0;
    for (let index = 0; index < this.doors.length; index += 1) {
      signature = Math.imul(
        signature ^ ((index + 1) * 2 + (this.doors[index]?.closed === true ? 1 : 0)),
        16777619,
      );
    }
    return signature;
  }

  _getNavigationTopologySources() {
    return {
      doors: this.doors,
      doorCount: this.doors.length,
      solidZones: this.solidZones,
      solidZoneCount: this.solidZones.length,
      aerialBoundaryZones: this.aerialBoundaryZones,
      aerialBoundaryZoneCount: this.aerialBoundaryZones.length,
      floorTiles: this.floorTiles,
      floorTileCount: this.floorTiles.length,
      platformingPlatforms: this.game?.platformingPlatforms,
      platformingPlatformCount: this.game?.platformingPlatforms?.length ?? 0,
      debugSpawnedPlatforms: this.game?.debugSpawnedPlatforms,
      debugSpawnedPlatformCount: this.game?.debugSpawnedPlatforms?.length ?? 0,
      debugLedgePlatform: this.game?.debugLedgePlatform,
    };
  }

  _refreshNavigationTopology() {
    const sources = this.navigationTopologySources;
    const doorStateSignature = this._getNavigationDoorStateSignature();
    const sourcesChanged = !sources
      || sources.doors !== this.doors
      || sources.doorCount !== this.doors.length
      || sources.solidZones !== this.solidZones
      || sources.solidZoneCount !== this.solidZones.length
      || sources.aerialBoundaryZones !== this.aerialBoundaryZones
      || sources.aerialBoundaryZoneCount !== this.aerialBoundaryZones.length
      || sources.floorTiles !== this.floorTiles
      || sources.floorTileCount !== this.floorTiles.length
      || sources.platformingPlatforms !== this.game?.platformingPlatforms
      || sources.platformingPlatformCount !== (this.game?.platformingPlatforms?.length ?? 0)
      || sources.debugSpawnedPlatforms !== this.game?.debugSpawnedPlatforms
      || sources.debugSpawnedPlatformCount !== (this.game?.debugSpawnedPlatforms?.length ?? 0)
      || sources.debugLedgePlatform !== this.game?.debugLedgePlatform;

    if (sourcesChanged || doorStateSignature !== this.navigationDoorStateSignature) {
      if (sources?.floorTiles !== this.floorTiles || sources?.floorTileCount !== this.floorTiles.length) {
        this.floorTilesByColumn = this._createFloorTileColumns(this.floorTiles);
      }
      this.invalidateNavigationTopology({ doorStateSignature });
    }
  }

  /**
   * Invalidates derived paths after a door, puzzle, or authored collision
   * change. Callers which mutate topology outside this controller can use this
   * hook; door open/close changes are also detected automatically.
   */
  invalidateNavigationTopology({ doorStateSignature = null } = {}) {
    this.navigationTopologyRevision += 1;
    this.navigationCache.clear();
    this.floorNavigationGraph = null;
    this.navigationDoorStateSignature = doorStateSignature
      ?? this._getNavigationDoorStateSignature();
    this.navigationTopologySources = this._getNavigationTopologySources();
  }

  _cacheNavigationResult(key, value) {
    if (!this.navigationCache.has(key) && this.navigationCache.size >= NAVIGATION_CACHE_LIMIT) {
      const oldestKey = this.navigationCache.keys().next().value;
      this.navigationCache.delete(oldestKey);
    }
    this.navigationCache.set(key, value);
  }

  _collectPlayerRailTopSurfaces() {
    const surfaces = [];
    const root = this.dungeon?.group;
    if (!root?.traverse) {
      return surfaces;
    }

    root.updateMatrixWorld?.(true);
    const bounds = new THREE.Box3();
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    root.traverse((object) => {
      if (!object?.isMesh) {
        return;
      }

      const name = object.name ?? '';
      const explicitRun = object.userData?.factoryRailRun === true;
      const authoredWalkwayRail = /(?:catwalk|balcony|guard).*rail|rail.*(?:catwalk|balcony|guard)/i.test(name)
        && !/post|overhead|crane|pipe/i.test(name);
      if (!explicitRun && !authoredWalkwayRail) {
        return;
      }

      bounds.setFromObject(object);
      bounds.getSize(size);
      bounds.getCenter(center);
      if (!Number.isFinite(size.x) || Math.max(size.x, size.z) < 0.3) {
        return;
      }

      surfaces.push({
        id: object.uuid,
        object,
        center: center.clone(),
        halfWidth: size.x * 0.5,
        halfDepth: size.z * 0.5,
        topY: bounds.max.y,
        baseElevation: Number.isFinite(object.userData?.elevation)
          ? object.userData.elevation
          : null,
        horizontal: size.x >= size.z,
      });
    });
    return surfaces;
  }

  _isBalancedOnRail(surface, position, tolerance = PLAYER_RAIL_BALANCE_TOLERANCE) {
    return Math.abs(position.x - surface.center.x) <= surface.halfWidth + tolerance
      && Math.abs(position.z - surface.center.z) <= surface.halfDepth + tolerance;
  }

  _findNearbyPlayerRail(position, proximity = PLAYER_RAIL_BALANCE_TOLERANCE) {
    let nearest = null;
    let nearestDistanceSq = Infinity;
    for (const surface of this.playerRailTopSurfaces) {
      const dx = Math.max(0, Math.abs(position.x - surface.center.x) - surface.halfWidth);
      const dz = Math.max(0, Math.abs(position.z - surface.center.z) - surface.halfDepth);
      const verticalDistance = Math.abs(position.y - surface.topY);
      const distanceSq = dx * dx + dz * dz;
      if (dx > proximity || dz > proximity || verticalDistance > 1.05 || distanceSq >= nearestDistanceSq) {
        continue;
      }
      nearest = surface;
      nearestDistanceSq = distanceSq;
    }
    return nearest;
  }

  getPlayerRailSupportElevation(position) {
    const surface = this._findNearbyPlayerRail(position, PLAYER_RAIL_BALANCE_TOLERANCE);
    if (!surface || !this._isBalancedOnRail(surface, position)) {
      return null;
    }

    const player = this.game?.player;
    if (player?.isJumpAirborne?.() && player.velocity?.y > 0) {
      return null;
    }
    const verticalTolerance = player?.isJumpAirborne?.()
      ? PLAYER_RAIL_LANDING_VERTICAL_TOLERANCE
      : 0.2;
    return Math.abs(position.y - surface.topY) <= verticalTolerance
      ? surface.topY
      : null;
  }

  tryResolvePlayerRailLanding({ player, root, previousRootY } = {}) {
    if (!player || !root || player.velocity?.y > 0) {
      return false;
    }

    let landingSurface = null;
    for (const surface of this.playerRailTopSurfaces) {
      if (!this._isBalancedOnRail(surface, root.position)) {
        continue;
      }
      const crossedTop = Number.isFinite(previousRootY)
        && previousRootY >= surface.topY
        && root.position.y <= surface.topY;
      const alreadyAtTop = Math.abs(root.position.y - surface.topY) <= 0.015;
      if (!crossedTop && !alreadyAtTop) {
        continue;
      }
      if (root.position.y < surface.topY - PLAYER_RAIL_LANDING_VERTICAL_TOLERANCE) {
        continue;
      }
      if (!landingSurface || surface.topY > landingSurface.topY) {
        landingSurface = surface;
      }
    }

    if (!landingSurface) {
      return false;
    }
    root.position.y = landingSurface.topY;
    if (player.modelRoot) {
      player.modelRoot.position.y = 0;
    }
    this.playerRailRecoveryState.lastResult = {
      mode: 'balancedLanding',
      railId: landingSurface.id,
    };
    return true;
  }

  _resolvePlayerAirborneRailRecovery(position, rail, preferredVelocity) {
    const preferred = preferredVelocity?.clone?.().setY(0) ?? new THREE.Vector3();
    if (preferred.lengthSq() > 0.0001) {
      preferred.normalize();
    }
    const railNormalA = rail.horizontal
      ? new THREE.Vector3(0, 0, 1)
      : new THREE.Vector3(1, 0, 0);
    const directions = [railNormalA, railNormalA.clone().negate()];
    if (preferred.lengthSq() > 0.0001) {
      directions.sort((a, b) => b.dot(preferred) - a.dot(preferred));
    }

    for (let distance = PLAYER_RAIL_RECOVERY_NUDGE; distance <= 1.12; distance += 0.16) {
      for (const direction of directions) {
        const candidate = position.clone().addScaledVector(direction, distance);
        const floorY = this.getSurfaceElevationAt(candidate);
        const groundedCandidate = candidate.clone().setY(floorY);
        if (floorY > position.y + 0.05
          || !this.isPositionWalkable(groundedCandidate)
          || this._findPowerKnockbackBarrier(position, groundedCandidate, { ignoreVertical: true })) {
          continue;
        }
        return {
          x: candidate.x,
          z: candidate.z,
          groundY: floorY,
          railId: rail.id,
          distance,
        };
      }
    }
    return null;
  }

  _updatePlayerAirborneRailRecovery(dt) {
    const state = this.playerRailRecoveryState;
    const player = this.game?.player;
    const position = player?.root?.position;
    if (!state || !position) {
      return;
    }

    state.cooldown = Math.max(0, state.cooldown - dt);
    const falling = player.isJumpAirborne?.() && player.velocity?.y < -0.3;
    const rail = falling ? this._findNearbyPlayerRail(position, PLAYER_RAIL_STALL_PROXIMITY) : null;
    if (!falling || !rail) {
      state.initialized = true;
      state.lastPosition.copy(position);
      state.stallTimer = 0;
      return;
    }

    if (!state.initialized) {
      state.initialized = true;
      state.lastPosition.copy(position);
      return;
    }

    const actualDescent = state.lastPosition.y - position.y;
    const expectedDescent = Math.abs(player.velocity.y) * dt;
    const stalled = actualDescent < Math.max(0.003, expectedDescent * 0.18);
    state.stallTimer = stalled ? state.stallTimer + dt : Math.max(0, state.stallTimer - dt * 2);

    if (state.stallTimer >= PLAYER_RAIL_STALL_TIME && state.cooldown <= 0) {
      const recovery = this._resolvePlayerAirborneRailRecovery(position, rail, player.velocity);
      if (recovery && player.resumeAirborneFall?.(recovery)) {
        state.lastResult = { mode: 'stalledFallNudge', ...recovery };
        state.cooldown = 0.4;
        state.stallTimer = 0;
      }
    }
    state.lastPosition.copy(position);
  }

  getNearestInteractable() {
    return this.nearestInteractable;
  }

  getObjectiveText() {
    if (this.isPlayerInSafeZone()) {
      return this.game.ruinCompleted
        ? 'Expedition complete'
        : 'Enter ruin';
    }

    const activeEncounter = this.encounters.find((encounter) => (
      encounter.spawned
      && !encounter.cleared
    ));

    if (activeEncounter) {
      return `Clear ${activeEncounter.label}`;
    }

    if (this.game.ruinCompleted && this.shrine?.collected) {
      return 'Use extraction pad';
    }

    const shrineDoor = this.doors.find((door) => door.id === 'Door_Shrine');
    if (this.shrine && !this.shrine.collected && !shrineDoor?.closed) {
      return 'Secure Large Refractor';
    }

    const trackedDoor = this.progressionManager.getCurrentTrackedDoor(this.doors);
    if (trackedDoor?.runtimeDoor) {
      const keycardName = this.progressionManager.getKeycardDisplayName(trackedDoor.keycard.keycardId);
      return trackedDoor.keycard.keycardId === SHRINE_KEY_ID
        ? 'Open shrine door'
        : `Use ${keycardName}`;
    }

    const bossEncounter = this.encounters.find((encounter) => encounter.isBoss);
    if (bossEncounter && !bossEncounter.cleared && this._isRoomReachableWithCurrentKeys(bossEncounter.roomId)) {
      return 'Defeat ruin boss';
    }

    const nextKeycard = this._getNextUncollectedProgressionKeycard();
    if (nextKeycard) {
      return nextKeycard.spawnMode === 'EliteEnemyDrop'
        ? 'Find elite keycard carrier'
        : nextKeycard.spawnMode === 'Chest'
          ? 'Open keycard chest'
          : `Find ${nextKeycard.displayName}`;
    }

    if (shrineDoor?.closed) {
      return 'Defeat boss for Shrine Key';
    }

    return 'Return to camp';
  }

  activateNearest() {
    const interactable = this.nearestInteractable;

    if (!interactable) {
      return false;
    }

    if (interactable.kind === 'door') {
      this._activateDoor(interactable.target);
      return true;
    }

    if (interactable.kind === 'mechanism') {
      this._activateMechanism(interactable.target);
      return true;
    }

    if (interactable.kind === 'trap') {
      this._activateTrap(interactable.target);
      return true;
    }

    if (interactable.kind === 'chest') {
      this._activateChest(interactable.target);
      return true;
    }

    if (interactable.kind === 'keySeeker') {
      this._activateKeySeeker();
      return true;
    }

    if (interactable.kind === 'shrine') {
      this._activateShrine();
      return true;
    }

    if (interactable.kind === 'extraction') {
      this._activateExtraction();
      return true;
    }

    if (interactable.kind === 'safe') {
      this._activateSafeInteractable(interactable.target);
      return true;
    }

    return false;
  }

  isPositionWalkable(position) {
    if (Number.isFinite(this.game.getPlatformFloorElevation?.(position))) {
      return true;
    }

    if (this.game.isPositionInsidePlatformBlock?.(position)) {
      return false;
    }

    const floorTile = this.getFloorTileAt(position);
    if (!floorTile) {
      return false;
    }

    tempVectorB.copy(position);
    tempVectorB.y = this._getTileElevationAtPosition(floorTile, position);
    return this._isResolvedFloorPositionWalkable(tempVectorB);
  }

  /**
   * Tests an airborne enemy's collision center against true dungeon volumes.
   * Floor availability, elevation changes, ledges, and railings are
   * intentionally absent from this query.
   */
  isAerialPositionClear(position, options = {}) {
    return this._getAerialBlockingObstacle(position, options) === null;
  }

  isAerialPathClear(fromPosition, targetPosition, options = {}) {
    if (!fromPosition || !targetPosition) {
      return false;
    }
    return this._findFirstAerialPathBlocker(fromPosition, targetPosition, options) === null;
  }

  /**
   * Returns a normalized, fully three-dimensional pursuit direction. When the
   * direct path is clear the result is exactly target - origin. Low fixtures
   * are crossed from above; walls and other tall blockers are routed around
   * through the dungeon's aerial topology.
   */
  getAerialNavigationDirection(fromPosition, targetPosition, options = {}) {
    if (!fromPosition || !targetPosition) {
      return null;
    }

    this._refreshNavigationTopology();

    const delta = targetPosition.clone().sub(fromPosition);
    const distance = delta.length();
    if (distance <= 0.0001) {
      return null;
    }

    const direct = delta.divideScalar(distance);
    const lookAhead = Math.max(0.5, options.lookAhead ?? AERIAL_DEFAULT_LOOKAHEAD);
    const probeTarget = fromPosition.clone().addScaledVector(direct, Math.min(distance, lookAhead));
    const blocker = this._findFirstAerialPathBlocker(fromPosition, probeTarget, options);
    if (!blocker) {
      return direct;
    }

    const obstacle = blocker.obstacle;
    if (obstacle.kind === 'boundaryWall'
      || obstacle.kind === 'closedDoor'
      || obstacle.kind === 'airspace') {
      return this._getAerialTopologyDirection(fromPosition, targetPosition, options);
    }
    if (!obstacle.zone) {
      return null;
    }

    const radius = Math.max(0, options.radius ?? 0.45);
    const verticalRadius = Math.max(0, options.verticalRadius ?? radius);
    const zone = obstacle.zone;
    const candidates = [];
    const addCandidate = (waypoint, routeRemainder = 0, routeClear = true) => {
      const travel = waypoint.clone().sub(fromPosition);
      const travelDistance = travel.length();
      if (travelDistance <= 0.025 || !this.isAerialPathClear(fromPosition, waypoint, options)) {
        return;
      }
      candidates.push({
        direction: travel.divideScalar(travelDistance),
        score: travelDistance + routeRemainder + (routeClear ? 0 : distance * 1.5),
      });
    };

    if (zone.allowFlyOver !== false && Number.isFinite(zone.verticalHalfHeight)) {
      const aboveY = zone.position.y
        + zone.verticalHalfHeight
        + verticalRadius
        + AERIAL_WAYPOINT_CLEARANCE;
      const horizontalDirection = direct.clone().setY(0);
      if (horizontalDirection.lengthSq() <= 0.0001) {
        horizontalDirection.set(0, 0, 1);
      } else {
        horizontalDirection.normalize();
      }

      const rotationY = zone.rotationY ?? 0;
      const cos = Math.cos(rotationY);
      const sin = Math.sin(rotationY);
      const localDirectionX = horizontalDirection.x * cos + horizontalDirection.z * sin;
      const localDirectionZ = -horizontalDirection.x * sin + horizontalDirection.z * cos;
      const routeExtent = Math.abs(localDirectionX) * (zone.halfWidth ?? 0)
        + Math.abs(localDirectionZ) * (zone.halfDepth ?? 0)
        + radius
        + AERIAL_WAYPOINT_CLEARANCE;
      const entry = zoneLocalToWorld(
        zone,
        -localDirectionX * routeExtent,
        aboveY,
        -localDirectionZ * routeExtent,
      );
      const exit = zoneLocalToWorld(
        zone,
        localDirectionX * routeExtent,
        aboveY,
        localDirectionZ * routeExtent,
      );
      const overRouteClear = this.isAerialPathClear(entry, exit, options);
      const exitRouteClear = overRouteClear && this.isAerialPathClear(exit, targetPosition, options);
      const overRemainder = entry.distanceTo(exit) + exit.distanceTo(targetPosition);

      if (fromPosition.y < aboveY - 0.04) {
        const lift = fromPosition.clone().setY(aboveY);
        const liftRouteClear = this.isAerialPathClear(lift, entry, options) && overRouteClear;
        addCandidate(
          lift,
          lift.distanceTo(entry) + overRemainder,
          liftRouteClear && exitRouteClear,
        );
      }
      if (overRouteClear) {
        addCandidate(entry, overRemainder, exitRouteClear);
        addCandidate(exit, exit.distanceTo(targetPosition), exitRouteClear);
      }
    }

    const lateralMargin = radius + AERIAL_WAYPOINT_CLEARANCE;
    const lateralY = fromPosition.y;
    for (const sideX of [-1, 1]) {
      for (const sideZ of [-1, 1]) {
        const waypoint = zoneLocalToWorld(
          zone,
          sideX * ((zone.halfWidth ?? 0) + lateralMargin),
          lateralY,
          sideZ * ((zone.halfDepth ?? 0) + lateralMargin),
        );
        const onwardClear = this.isAerialPathClear(waypoint, targetPosition, options);
        addCandidate(waypoint, waypoint.distanceTo(targetPosition), onwardClear);
      }
    }

    candidates.sort((left, right) => left.score - right.score);
    return candidates[0]?.direction
      ?? this._getAerialTopologyDirection(fromPosition, targetPosition, options);
  }

  _normalizeAerialCollisionOptions(options = {}) {
    const radius = Math.max(0, options.radius ?? 0.45);
    return {
      ...options,
      radius,
      verticalRadius: Math.max(0, options.verticalRadius ?? radius),
      sampleSpacing: Math.max(0.08, options.sampleSpacing ?? AERIAL_PATH_SAMPLE_SPACING),
    };
  }

  _getAerialBlockingObstacle(position, rawOptions = {}) {
    const options = this._normalizeAerialCollisionOptions(rawOptions);
    if (!options.ignoreAirspace && !this._isInsideAerialNavigableFootprint(position)) {
      return { kind: 'airspace', zone: null };
    }

    const ceilingHeight = this._getAerialCeilingHeight(position);
    if (Number.isFinite(ceilingHeight)
      && position.y + options.verticalRadius > ceilingHeight - AERIAL_CEILING_CLEARANCE) {
      return { kind: 'ceiling', zone: null };
    }

    for (const zone of this.aerialBoundaryZones) {
      if (isInsideExpandedZone(position, zone, options.radius, options.verticalRadius)) {
        return { kind: 'boundaryWall', zone };
      }
    }

    for (const door of this.doors) {
      if (!door.closed) {
        continue;
      }
      const zone = this._createAerialDoorZone(door);
      if (isInsideExpandedZone(position, zone, options.radius, options.verticalRadius)) {
        return { kind: 'closedDoor', zone };
      }
    }

    for (const zone of this.solidZones) {
      if (isInsideExpandedZone(position, zone, options.radius, options.verticalRadius)) {
        return { kind: zone.obstacleKind ?? 'solid', zone: { allowFlyOver: true, ...zone } };
      }
    }

    for (const platform of this._getAerialPlatformSurfaces()) {
      const zone = this._createAerialPlatformZone(platform);
      if (zone && isInsideExpandedZone(position, zone, options.radius, options.verticalRadius)) {
        return { kind: 'platform', zone };
      }
    }

    return null;
  }

  _findFirstAerialPathBlocker(fromPosition, targetPosition, rawOptions = {}) {
    const options = this._normalizeAerialCollisionOptions(rawOptions);
    const distance = fromPosition.distanceTo(targetPosition);
    const steps = Math.max(1, Math.ceil(distance / options.sampleSpacing));
    for (let step = 0; step <= steps; step += 1) {
      const point = new THREE.Vector3().copy(fromPosition).lerp(targetPosition, step / steps);
      const obstacle = this._getAerialBlockingObstacle(point, options);
      if (obstacle) {
        return { point, obstacle };
      }
    }
    return null;
  }

  _isInsideAerialNavigableFootprint(position) {
    if (this._getRoomAtPosition(position)) {
      return true;
    }
    const tile = this.worldToTile(position);
    return this.floorTilesByColumn.has(tileKey(tile.x, tile.z))
      || this.tiles.has(tileKey(tile.x, tile.z));
  }

  _getAerialCeilingHeight(position) {
    const room = this._getRoomAtPosition(position);
    if (Number.isFinite(room?.ceilingHeight)) {
      return room.ceilingHeight;
    }
    if (room?.ceilingHeight === null) {
      return Infinity;
    }

    const tile = this.worldToTile(position);
    if (this.tiles.has(tileKey(tile.x, tile.z)) || this.floorTilesByColumn.has(tileKey(tile.x, tile.z))) {
      return 8.4;
    }
    return Infinity;
  }

  _createAerialDoorZone(door) {
    const baseY = door.baseY ?? door.position.y ?? 0;
    const height = door.collisionHeight ?? 4.8;
    return {
      id: `aerialDoor_${door.id}`,
      obstacleKind: 'closedDoor',
      position: new THREE.Vector3(door.position.x, baseY + height * 0.5, door.position.z),
      halfWidth: door.collisionHalfWidth ?? (door.alongX ? 0.16 : this.tileSize * 0.48),
      halfDepth: door.collisionHalfDepth ?? (door.alongX ? this.tileSize * 0.48 : 0.16),
      verticalHalfHeight: height * 0.5,
      allowFlyOver: false,
    };
  }

  _getAerialPlatformSurfaces() {
    if (typeof this.game?._getPlatformingSurfaces === 'function') {
      return this.game._getPlatformingSurfaces();
    }
    return this.dungeon?.platforms ?? [];
  }

  _createAerialPlatformZone(platform) {
    if (!platform?.center || platform.blocksBelow === false) {
      return null;
    }
    const topY = platform.topY ?? platform.center.y ?? 0;
    const baseY = Number.isFinite(platform.baseY) ? platform.baseY : 0;
    const height = topY - baseY;
    if (height <= 0.05) {
      return null;
    }
    return {
      id: `aerialPlatform_${platform.id}`,
      obstacleKind: 'platform',
      position: new THREE.Vector3(platform.center.x, baseY + height * 0.5, platform.center.z),
      halfWidth: platform.halfWidth ?? 0,
      halfDepth: platform.halfDepth ?? 0,
      verticalHalfHeight: height * 0.5,
      allowFlyOver: true,
    };
  }

  _getAerialTopologyDirection(fromPosition, targetPosition, rawOptions = {}) {
    const options = this._normalizeAerialCollisionOptions(rawOptions);
    const start = this.worldToTile(fromPosition);
    const goal = this.worldToTile(targetPosition);
    const startKey = tileKey(start.x, start.z);
    const goalKey = tileKey(goal.x, goal.z);
    if (!this.tiles.has(startKey) || !this.tiles.has(goalKey)) {
      return null;
    }

    const altitudeBand = Math.round((fromPosition.y ?? 0) / AERIAL_PATH_SAMPLE_SPACING);
    const cacheKey = [
      'aerial',
      startKey,
      goalKey,
      altitudeBand,
      Number(options.radius ?? 0).toFixed(2),
      Number(options.verticalRadius ?? 0).toFixed(2),
    ].join(':');
    let next = this.navigationCache.get(cacheKey);
    if (!this.navigationCache.has(cacheKey)) {
      const path = this._findAerialTilePath(start, goal, fromPosition.y, options);
      next = path?.[1] ?? null;
      this._cacheNavigationResult(cacheKey, next);
    }
    if (!next) {
      return null;
    }

    const waypoint = new THREE.Vector3(
      next.x * this.tileSize,
      fromPosition.y + THREE.MathUtils.clamp(targetPosition.y - fromPosition.y, -this.tileSize, this.tileSize),
      next.z * this.tileSize,
    );
    if (!this.isAerialPathClear(fromPosition, waypoint, options)) {
      return null;
    }
    const direction = waypoint.sub(fromPosition);
    return direction.lengthSq() > 0.0001 ? direction.normalize() : null;
  }

  _findAerialTilePath(start, goal, altitude, options) {
    const startKey = tileKey(start.x, start.z);
    const goalKey = tileKey(goal.x, goal.z);
    const queue = [start];
    const cameFrom = new Map([[startKey, null]]);

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      const currentKey = tileKey(current.x, current.z);
      if (currentKey === goalKey) {
        return this._reconstructPath(cameFrom, current);
      }

      for (const [dx, dz] of CARDINAL_NEIGHBORS) {
        const next = { x: current.x + dx, z: current.z + dz };
        const nextKey = tileKey(next.x, next.z);
        if (cameFrom.has(nextKey)
          || !this.tiles.has(nextKey)
          || this._aerialTileEdgeCrossesClosedDoor(current, next, altitude, options)) {
          continue;
        }
        cameFrom.set(nextKey, current);
        queue.push(next);
      }
    }

    return null;
  }

  _aerialTileEdgeCrossesClosedDoor(fromTile, toTile, altitude, options) {
    if (!this.doors.some((door) => door.closed)) {
      return false;
    }
    const from = new THREE.Vector3(fromTile.x * this.tileSize, altitude, fromTile.z * this.tileSize);
    const to = new THREE.Vector3(toTile.x * this.tileSize, altitude, toTile.z * this.tileSize);
    const steps = Math.max(2, Math.ceil(this.tileSize / AERIAL_PATH_SAMPLE_SPACING));
    for (let step = 0; step <= steps; step += 1) {
      const point = new THREE.Vector3().copy(from).lerp(to, step / steps);
      for (const door of this.doors) {
        if (door.closed
          && isInsideExpandedZone(
            point,
            this._createAerialDoorZone(door),
            options.radius,
            options.verticalRadius,
          )) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Stops the otherwise unconstrained airborne knockback arc at barriers that
   * must separate dungeon spaces. Ordinary fixtures stay recoverable so a
   * powerful hit can still carry the player over a crate or small machine.
   */
  resolvePowerKnockbackTravel(fromPosition, targetPosition) {
    if (!fromPosition || !targetPosition) {
      return null;
    }

    const barrier = this._findPowerKnockbackBarrier(fromPosition, targetPosition);
    if (!barrier) {
      return null;
    }

    return {
      blocked: true,
      position: barrier.lastClearPosition,
      barrierKind: barrier.kind,
      barrier: barrier.source,
    };
  }

  resolvePowerKnockbackLanding(position, direction, originPosition = null) {
    if (!position || !direction) {
      return null;
    }

    const travel = direction.clone().setY(0);
    if (travel.lengthSq() <= 0.0001) {
      travel.set(0, 0, -1);
    } else {
      travel.normalize();
    }

    const recoveryOrigin = originPosition?.clone?.() ?? position.clone();
    const resolveAtDistance = (distance, mode) => {
      const candidate = position.clone().addScaledVector(travel, distance);
      candidate.y = this.getSurfaceElevationAt(candidate);
      if (candidate.y > position.y + 0.3
        || !this.isPositionWalkable(candidate)
        || this._findPowerKnockbackBarrier(recoveryOrigin, candidate, { ignoreVertical: true })) {
        return null;
      }
      return { position: candidate, mode };
    };

    const current = resolveAtDistance(0, 'current');
    if (current) {
      return current;
    }

    // Preserve the hit's momentum: clear the invalid footprint in the travel
    // direction before considering a correction back toward the attacker.
    for (let distance = 0.4; distance <= 6; distance += 0.4) {
      const past = resolveAtDistance(distance, 'pastObstacle');
      if (past) {
        return past;
      }
    }

    for (let distance = 0.4; distance <= 6; distance += 0.4) {
      const before = resolveAtDistance(-distance, 'beforeObstacle');
      if (before) {
        return before;
      }
    }

    const nearest = this._findNearestWalkablePosition(position);
    if (nearest && !this._findPowerKnockbackBarrier(
      recoveryOrigin,
      nearest,
      { ignoreVertical: true },
    )) {
      return { position: nearest, mode: 'nearestWalkable' };
    }

    // If an older/custom map supplies no safe candidate around the impact,
    // the launch point remains preferable to teleporting through a room wall.
    recoveryOrigin.y = this.getSurfaceElevationAt(recoveryOrigin);
    return this.isPositionWalkable(recoveryOrigin)
      ? { position: recoveryOrigin, mode: 'launchSideFallback' }
      : null;
  }

  _findPowerKnockbackBarrier(fromPosition, targetPosition, { ignoreVertical = false } = {}) {
    const distance = fromPosition.distanceTo(targetPosition);
    if (distance <= 0.0001) {
      return null;
    }

    const playerRadius = this.game?.player?.radius
      ?? PLAYER_TRAVERSAL_ENVELOPE.collisionRadius;
    const steps = Math.max(1, Math.ceil(distance / POWER_KNOCKBACK_BARRIER_SAMPLE_SPACING));
    let lastClearPosition = fromPosition.clone();

    for (let step = 1; step <= steps; step += 1) {
      const sample = new THREE.Vector3().copy(fromPosition).lerp(targetPosition, step / steps);
      const blocker = this._getPowerKnockbackBarrierAt(sample, playerRadius, ignoreVertical);
      if (blocker) {
        return {
          ...blocker,
          point: sample,
          lastClearPosition,
        };
      }
      lastClearPosition = sample;
    }

    return null;
  }

  _getPowerKnockbackBarrierAt(position, playerRadius, ignoreVertical = false) {
    const verticalRadius = ignoreVertical ? Infinity : 0;
    for (const zone of this.aerialBoundaryZones) {
      if (isInsideExpandedZone(position, zone, playerRadius, verticalRadius)) {
        return { kind: 'boundaryWall', source: zone };
      }
    }

    for (const door of this.doors) {
      if (door.closed
        && isInsideExpandedZone(
          position,
          this._createAerialDoorZone(door),
          playerRadius,
          verticalRadius,
        )) {
        return { kind: 'closedDoor', source: door };
      }
    }

    for (const zone of this.solidZones) {
      if (!this._isHardPowerKnockbackBarrier(zone)) {
        continue;
      }
      if (isInsideExpandedZone(position, zone, playerRadius, verticalRadius)) {
        return { kind: zone.obstacleKind ?? 'solidBarrier', source: zone };
      }
    }

    return null;
  }

  _isHardPowerKnockbackBarrier(zone) {
    if (!zone || zone.allowPowerKnockbackRecovery === true) {
      return false;
    }
    if (zone.blocksPowerKnockback === true || zone.allowFlyOver === false) {
      return true;
    }

    const descriptor = `${zone.obstacleKind ?? ''} ${zone.id ?? ''} ${zone.label ?? ''}`;
    return POWER_KNOCKBACK_BARRIER_LABEL_PATTERN.test(descriptor);
  }

  _isResolvedFloorPositionWalkable(position) {
    for (const door of this.doors) {
      if (!door.closed) {
        continue;
      }

      if (this._isPositionInsideClosedDoor(position, door)) {
        return false;
      }
    }

    if (this._isPositionInsideSolidZone(position)) {
      return false;
    }

    if (this.game.isPositionInsidePlatformBlock?.(position)) {
      return false;
    }

    return true;
  }

  _isPositionInsideClosedDoor(position, door) {
    if (!position || !door?.position) {
      return false;
    }
    const playerRadius = this.game?.player?.radius ?? PLAYER_TRAVERSAL_ENVELOPE.collisionRadius;
    const halfWidth = (door.collisionHalfWidth ?? (door.alongX ? 0.16 : this.tileSize * 0.48)) + playerRadius;
    const halfDepth = (door.collisionHalfDepth ?? (door.alongX ? this.tileSize * 0.48 : 0.16)) + playerRadius;
    const baseY = door.baseY ?? door.position.y ?? 0;
    const height = door.collisionHeight ?? 4.8;
    return Math.abs(position.x - door.position.x) <= halfWidth
      && Math.abs(position.z - door.position.z) <= halfDepth
      && (position.y ?? 0) >= baseY - PLAYER_STEP_OFF_FALL_HEIGHT
      && (position.y ?? 0) <= baseY + height;
  }

  _getWalkableJumpOffLanding(position, target = new THREE.Vector3()) {
    const platformElevation = this.game.getPlatformFloorElevation?.(position);
    if (Number.isFinite(platformElevation)) {
      target.copy(position);
      target.y = platformElevation;
      return target;
    }

    const floorTile = this.getFloorTileAt(position, { allowClosest: true });
    if (!floorTile) {
      return null;
    }

    const floorY = this._getTileElevationAtPosition(floorTile, position);
    const drop = (position.y ?? floorY) - floorY;
    // A jump already owns its vertical motion. If there is a genuine walkable
    // floor below the current X/Z, preserve the arc even when that floor is far
    // beneath a high catwalk. Limiting this to the grounded safe-drop envelope
    // made the walkability correction push long railing jumps back onto their
    // takeoff platform before gravity could carry the player down.
    if (drop < -0.1) {
      return null;
    }

    target.copy(position);
    target.y = floorY;
    return this._isResolvedFloorPositionWalkable(target) ? target : null;
  }

  _isPositionInsideSolidZone(position) {
    return this.solidZones.some((zone) => isInsideExpandedZone(
      position,
      zone,
      Math.max(0, Number(zone.playerCollisionPadding) || 0),
      0,
    ));
  }

  isPositionInSafeZone(position) {
    return this.safeZones.some((zone) => isInsideZone(position, zone));
  }

  isPlayerInSafeZone() {
    return this.isPositionInSafeZone(this.game.player.root.position);
  }

  _updateExpeditionEntryState() {
    if (this.game.ruinCompleted) {
      return;
    }

    const inSafeZone = this.isPlayerInSafeZone();
    this.game.expeditionActive = !inSafeZone;

    if (!inSafeZone && !this.game.expeditionAccepted) {
      this.game.beginExpedition?.({ silent: true });
    }
  }

  getUnspawnedEncounterAt(position) {
    return this.encounters.find((encounter) => (
      !encounter.spawned
      && !encounter.cleared
      && isInsideZone(position, encounter.triggerZone ?? encounter.zone)
    )) ?? null;
  }

  markEncounterSpawned(encounterId, enemies = []) {
    const encounter = this.encounters.find((candidate) => candidate.id === encounterId);
    if (!encounter || encounter.spawned) {
      return;
    }

    encounter.spawned = true;
    encounter.enemyIds = enemies.map((enemy) => enemy.id);
    const announcement = { message: `${encounter.label} active`, color: '#ffb347' };
    if (this.environmentalStoryToastTimer > 0) {
      this.pendingRoomAnnouncements.push(announcement);
    } else {
      this.game.ui?.showToast?.(announcement.message, announcement.color);
    }
  }

  _updateRoomAnnouncements(dt) {
    this.environmentalStoryToastTimer = Math.max(0, this.environmentalStoryToastTimer - dt);
    if (this.environmentalStoryToastTimer > 0 || !this.pendingRoomAnnouncements.length) {
      return;
    }

    const announcement = this.pendingRoomAnnouncements.shift();
    this.game.ui?.showToast?.(announcement.message, announcement.color);
  }

  worldToTile(position) {
    return {
      x: Math.round(position.x / this.tileSize),
      z: Math.round(position.z / this.tileSize),
    };
  }

  tileToWorld(x, z, target = new THREE.Vector3()) {
    return target.set(x * this.tileSize, this.getTileElevation(x, z), z * this.tileSize);
  }

  _createFloorTileColumns(floorTiles) {
    const columns = new Map();

    for (const tile of floorTiles) {
      const key = tileKey(tile.x, tile.z);
      const column = columns.get(key) ?? [];
      column.push(tile);
      columns.set(key, column);
    }

    for (const column of columns.values()) {
      column.sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0));
    }

    return columns;
  }

  getFloorTileAt(position, {
    maxVerticalGap = 1.45,
    allowClosest = false,
    maxElevationAbove = Infinity,
  } = {}) {
    const { x, z } = this.worldToTile(position);
    const column = this.floorTilesByColumn.get(tileKey(x, z));

    if (!column?.length) {
      return null;
    }

    let closest = null;
    let closestDistance = Infinity;
    const y = position.y ?? 0;

    for (const tile of column) {
      const elevation = this._getTileElevationAtPosition(tile, position);
      if (elevation - y > maxElevationAbove) {
        continue;
      }
      const distance = Math.abs(elevation - y);
      if (distance < closestDistance) {
        closest = tile;
        closestDistance = distance;
      }
    }

    if (!allowClosest && closestDistance > maxVerticalGap) {
      return null;
    }

    return closest;
  }

  getTileElevation(x, z, elevationHint = 0) {
    const position = tempVectorA.set(x * this.tileSize, elevationHint, z * this.tileSize);
    const tile = this.getFloorTileAt(position, { allowClosest: true });
    return tile ? this._getTileElevationAtPosition(tile, position) : 0;
  }

  getFloorElevationAt(position) {
    const tile = this.getFloorTileAt(position, {
      allowClosest: true,
      maxElevationAbove: 0.42,
    }) ?? this.getFloorTileAt(position, { allowClosest: true });
    return tile ? this._getTileElevationAtPosition(tile, position) : 0;
  }

  getRampSurfaceElevationAt(position) {
    const { x, z } = this.worldToTile(position);
    const column = this.floorTilesByColumn.get(tileKey(x, z));
    if (!column?.length) {
      return null;
    }

    let nearestElevation = null;
    let nearestDistance = Infinity;
    for (const tile of column) {
      if (tile.surface !== 'industrialRamp') {
        continue;
      }
      const elevation = this._getTileElevationAtPosition(tile, position);
      const distance = Math.abs(elevation - (position.y ?? 0));
      if (distance <= RAMP_SUPPORT_CAPTURE_HEIGHT && distance < nearestDistance) {
        nearestElevation = elevation;
        nearestDistance = distance;
      }
    }
    return nearestElevation;
  }

  getSurfaceElevationAt(position) {
    // Elevated conveyor ramps can overlap a flat structural deck for several
    // tiles. Capture the nearby authored slope first so that flat deck support
    // cannot mask the rising surface and create a discontinuity at its edge.
    const rampElevation = this.getRampSurfaceElevationAt(position);
    if (Number.isFinite(rampElevation)) {
      return rampElevation;
    }
    const platformElevation = this.game.getPlatformFloorElevation?.(position);
    return Number.isFinite(platformElevation)
      ? platformElevation
      : this.getFloorElevationAt(position);
  }

  _getGroundedStepTransitionHeight(fromPosition, toPosition, fallback) {
    const fromTile = this.getFloorTileAt(fromPosition, { allowClosest: true });
    const toTile = this.getFloorTileAt(toPosition, { allowClosest: true });
    return Math.max(
      fallback,
      Number(fromTile?.groundedStepTransitionHeight) || 0,
      Number(toTile?.groundedStepTransitionHeight) || 0,
    );
  }

  _getTileElevationAtPosition(tile, position) {
    if (!tile) {
      return 0;
    }

    const isRamp = tile.surface === 'industrialRamp'
      && Number.isFinite(tile.rampStartElevation)
      && Number.isFinite(tile.rampEndElevation);

    if (!isRamp) {
      return tile.elevation ?? 0;
    }

    const directionX = Math.sign(tile.rampDirectionX ?? 0);
    const directionZ = Math.sign(tile.rampDirectionZ ?? 0);

    if (directionX === 0 && directionZ === 0) {
      return tile.elevation ?? 0;
    }

    const localX = position.x / this.tileSize - tile.x;
    const localZ = position.z / this.tileSize - tile.z;
    const axis = directionX !== 0 ? localX * directionX : localZ * directionZ;
    const progress = THREE.MathUtils.clamp(axis + 0.5, 0, 1);
    return THREE.MathUtils.lerp(tile.rampStartElevation, tile.rampEndElevation, progress);
  }

  _isPlayerPreservingVerticalMotion() {
    const player = this.game.player;
    return player?.animation?.isFullBodyActionActive?.() === true
      || player?.isJumpVerticalMotionActive?.() === true
      || player?.isPowerKnockbackActive?.() === true
      || player?.isLedgeClinging?.() === true;
  }

  _isPlayerJumping() {
    const player = this.game.player;
    if (player?.isJumpAirborne?.()
      || player?.isDodgeRollAirborne?.()
      || player?.isPowerKnockbackAirborne?.()) {
      return true;
    }

    const actionState = player?.animation?.actionState;
    return actionState === 'neutralJump' || actionState === 'forwardJump' || actionState === 'wallJump';
  }

  _syncPositionToFloor(position, { preservePlayerAction = false } = {}) {
    if (preservePlayerAction && this._isPlayerPreservingVerticalMotion()) {
      return;
    }

    const rampElevation = this.getRampSurfaceElevationAt(position);
    if (Number.isFinite(rampElevation)) {
      position.y = rampElevation;
      return;
    }

    const platformElevation = this.game.getPlatformFloorElevation?.(position);
    if (Number.isFinite(platformElevation)) {
      position.y = platformElevation;
      return;
    }

    const floorTile = this.getFloorTileAt(position, { allowClosest: true });
    if (floorTile) {
      position.y = this._getTileElevationAtPosition(floorTile, position);
    }
  }

  getNavigationDirection(fromPosition, targetPosition) {
    if (!fromPosition || !targetPosition) {
      return null;
    }

    this._refreshNavigationTopology();

    const start = this.getFloorTileAt(fromPosition, { allowClosest: true });
    const goal = this.getFloorTileAt(targetPosition, { allowClosest: true });
    if (!start || !goal) {
      return null;
    }
    const startKey = this._getFloorGraphKey(start);
    const goalKey = this._getFloorGraphKey(goal);

    if (startKey === goalKey) {
      tempVectorC.copy(targetPosition).sub(fromPosition);
      tempVectorC.y = 0;
      return tempVectorC.lengthSq() > 0.0001 ? tempVectorC.normalize().clone() : null;
    }

    const cacheKey = `ground:${startKey}>${goalKey}`;
    let next = this.navigationCache.get(cacheKey);
    if (!this.navigationCache.has(cacheKey)) {
      const path = this._findFloorTilePath(start, goal, { nextHopOnly: true });
      next = path?.[1] ?? null;
      this._cacheNavigationResult(cacheKey, next);
    }
    if (!next) {
      return null;
    }

    const nextCenter = tempVectorA.set(
      next.x * this.tileSize,
      next.elevation ?? 0,
      next.z * this.tileSize,
    );
    const direction = nextCenter.sub(fromPosition);
    direction.y = 0;

    if (direction.lengthSq() <= 0.0001) {
      return null;
    }

    direction.normalize();
    return direction.clone();
  }

  /**
   * Resolves the destination an enemy should currently pursue. Encounter
   * enemies retain their authored target through the middle of a room, then
   * progressively bias toward open arena space near a wall or room boundary.
   * A short-lived recovery target takes priority after collision correction so
   * an AI cannot immediately walk back into the same obstacle every frame.
   */
  getEnemyArenaTarget(enemy, desiredTarget, target = new THREE.Vector3()) {
    const position = enemy?.root?.position;
    const arena = enemy?.encounterArena;
    if (!position || !desiredTarget) {
      return null;
    }

    const recoveryTarget = enemy.navigationRecoveryTarget;
    if (recoveryTarget && (enemy.navigationRecoveryTimer ?? 0) > 0) {
      const recoveryDistanceSq = (recoveryTarget.x - position.x) ** 2
        + (recoveryTarget.z - position.z) ** 2;
      if (recoveryDistanceSq > 0.16) {
        return target.copy(recoveryTarget);
      }
      enemy.clearNavigationRecoveryTarget?.();
    }

    target.copy(desiredTarget);
    if (!arena?.center) {
      return target;
    }

    const softHalfWidth = Math.max(0.5, arena.softHalfWidth ?? arena.halfWidth ?? 1);
    const softHalfDepth = Math.max(0.5, arena.softHalfDepth ?? arena.halfDepth ?? 1);
    const zoneCenter = arena.zoneCenter ?? arena.center;
    const offsetX = position.x - zoneCenter.x;
    const offsetZ = position.z - zoneCenter.z;
    const edgeRatio = Math.max(
      Math.abs(offsetX) / softHalfWidth,
      Math.abs(offsetZ) / softHalfDepth,
    );

    // Do not let a target outside the encounter pull its enemies through a
    // doorway. The enemy can still fight anywhere inside the soft envelope.
    target.x = THREE.MathUtils.clamp(
      target.x,
      zoneCenter.x - softHalfWidth,
      zoneCenter.x + softHalfWidth,
    );
    target.z = THREE.MathUtils.clamp(
      target.z,
      zoneCenter.z - softHalfDepth,
      zoneCenter.z + softHalfDepth,
    );

    const centerBias = THREE.MathUtils.smoothstep(edgeRatio, 0.38, 1.03) * 0.78;
    if (centerBias > 0.001) {
      target.x = THREE.MathUtils.lerp(target.x, arena.center.x, centerBias);
      target.z = THREE.MathUtils.lerp(target.z, arena.center.z, centerBias);
    }
    enemy.lastArenaSteeringStrength = centerBias;
    return target;
  }

  getEnemyNavigationDirection(enemy, desiredTarget, options = {}) {
    if (!enemy?.root?.position || !desiredTarget) {
      return null;
    }

    const arenaTarget = this.getEnemyArenaTarget(enemy, desiredTarget, new THREE.Vector3());
    if (!arenaTarget) {
      return null;
    }
    if (enemy.lastNavigationTarget?.copy) enemy.lastNavigationTarget.copy(arenaTarget);
    else enemy.lastNavigationTarget = arenaTarget.clone();

    if (enemy.navigationMode === 'air') {
      return this.getAerialNavigationDirection(
        enemy.root.position,
        arenaTarget,
        {
          ...this._getEnemyAerialCollisionOptions(enemy),
          ...options,
        },
      );
    }
    const navigation = this.getNavigationDirection(enemy.root.position, arenaTarget);
    return this._getEnemyGroundAvoidanceDirection(enemy, navigation, arenaTarget, options);
  }

  _getEnemyGroundAvoidanceDirection(enemy, navigation, arenaTarget, options = {}) {
    if (!navigation?.isVector3 || navigation.lengthSq() <= 0.0001) {
      return null;
    }

    const origin = enemy.root.position;
    const forward = navigation.clone().setY(0).normalize();
    const lookAhead = Math.max(
      0.5,
      options.lookAhead ?? 0,
      (enemy.radius ?? 0.42) * 1.25,
      (enemy.stats?.moveSpeed ?? 2) * 0.12,
    );
    const probe = origin.clone().addScaledVector(forward, lookAhead);
    probe.y = this.getSurfaceElevationAt(probe);
    if (this.isEnemyPositionClear(enemy, probe, options)) {
      return forward;
    }

    const desired = arenaTarget.clone().sub(origin).setY(0);
    if (desired.lengthSq() > 0.0001) desired.normalize();
    const arenaCenter = enemy.encounterArena?.center;
    const inward = arenaCenter
      ? arenaCenter.clone().sub(origin).setY(0).normalize()
      : desired;
    const candidates = [];
    for (const offset of [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, 3 * Math.PI / 4, -3 * Math.PI / 4, Math.PI]) {
      const cos = Math.cos(offset);
      const sin = Math.sin(offset);
      const direction = new THREE.Vector3(
        forward.x * cos - forward.z * sin,
        0,
        forward.x * sin + forward.z * cos,
      ).normalize();
      probe.copy(origin).addScaledVector(direction, lookAhead);
      probe.y = this.getSurfaceElevationAt(probe);
      if (!this.isEnemyPositionClear(enemy, probe, options)) {
        continue;
      }
      candidates.push({
        direction,
        probe: probe.clone(),
        score: direction.dot(desired) + direction.dot(inward) * 0.38,
      });
    }

    candidates.sort((left, right) => right.score - left.score);
    const best = candidates[0];
    if (!best) {
      return forward;
    }
    enemy.setNavigationRecoveryTarget?.(best.probe, 0.55);
    return best.direction;
  }

  _getEnemyRailCrossingDistance(enemy, origin, direction) {
    let nearestExit = Infinity;
    const padding = 0.1;
    for (const surface of this.playerRailTopSurfaces ?? []) {
      const baseMatches = Number.isFinite(surface.baseElevation)
        ? Math.abs(surface.baseElevation - origin.y) <= 0.55
        : surface.topY - origin.y >= 0.2 && surface.topY - origin.y <= 1.25;
      if (!baseMatches) continue;
      const interval = getRayAabbInterval2D(
        origin,
        direction,
        ENEMY_GROUND_TRAVERSAL_MAX_DISTANCE,
        surface.center,
        surface.halfWidth + padding,
        surface.halfDepth + padding,
      );
      if (!interval || interval.exit <= 0.04 || interval.exit >= nearestExit) continue;
      nearestExit = interval.exit;
    }
    return Number.isFinite(nearestExit) ? nearestExit : null;
  }

  _isEnemyRampSideExit(origin, direction) {
    const tile = this.getFloorTileAt(origin, { allowClosest: true });
    if (tile?.surface !== 'industrialRamp') return false;
    const rampX = Math.sign(tile.rampDirectionX ?? 0);
    const rampZ = Math.sign(tile.rampDirectionZ ?? 0);
    if (rampX === 0 && rampZ === 0) return false;
    return Math.abs(direction.x * rampZ - direction.z * rampX) >= 0.58;
  }

  _isEnemyTraversalInsideArena(enemy, position) {
    const arena = enemy.encounterArena;
    if (!arena?.center) return true;
    const center = arena.zoneCenter ?? arena.center;
    const margin = Math.max(0.2, (enemy.radius ?? 0.42) * 0.5);
    return Math.abs(position.x - center.x) <= Math.max(0.5, arena.halfWidth - margin)
      && Math.abs(position.z - center.z) <= Math.max(0.5, arena.halfDepth - margin);
  }

  _isEnemyTraversalArcClear(enemy, start, landing, arcHeight) {
    const horizontalDistance = Math.hypot(landing.x - start.x, landing.z - start.z);
    const steps = Math.max(
      8,
      Math.ceil(horizontalDistance / ENEMY_GROUND_TRAVERSAL_SAMPLE_SPACING),
    );
    const collisionHeight = Math.max(
      0.8,
      enemy.collisionHeight ?? enemy.type?.modelHeight ?? 1.6,
    );
    const centerOffset = collisionHeight * 0.5;
    const options = {
      radius: Math.max(0.18, Math.min(0.86, (enemy.radius ?? 0.42) * 0.72)),
      verticalRadius: Math.max(0.3, Math.min(1.2, collisionHeight * 0.4)),
    };
    const sample = new THREE.Vector3();
    for (let index = 0; index <= steps; index += 1) {
      const progress = index / steps;
      sample.lerpVectors(start, landing, progress);
      sample.y += Math.sin(progress * Math.PI) * arcHeight + centerOffset;
      if (!this.isAerialPositionClear(sample, options)) return false;
    }
    return true;
  }

  resolveEnemyGroundTraversal(enemy, blockedPosition, desiredTarget = null) {
    if (!enemy?.root?.position
      || !blockedPosition
      || enemy.dead
      || enemy.isBoss
      || enemy.navigationMode === 'air'
      || (enemy.navigationTraversalCooldown ?? 0) > 0
      || enemy.shouldIgnoreGroundConstraint?.()
      || enemy.isAttackLeaseActive?.()
      || enemy._isControlLocked?.()) {
      return null;
    }

    const origin = enemy.root.position;
    const directions = [];
    const addDirection = (target) => {
      if (!target) return;
      const direction = target.clone().sub(origin).setY(0);
      if (direction.lengthSq() <= 0.0001) return;
      direction.normalize();
      if (directions.some((candidate) => candidate.dot(direction) > 0.985)) return;
      directions.push(direction);
    };
    addDirection(blockedPosition);
    addDirection(desiredTarget ?? enemy.lastNavigationTarget);

    for (const direction of directions) {
      const railExit = this._getEnemyRailCrossingDistance(enemy, origin, direction);
      const rampSide = railExit == null && this._isEnemyRampSideExit(origin, direction);
      if (railExit == null && !rampSide) continue;

      const minimumDistance = railExit == null
        ? Math.max(1.05, (enemy.radius ?? 0.42) * 2.15)
        : Math.max(
          1.05,
          railExit + (enemy.radius ?? 0.42) * 1.35 + 0.14,
        );
      for (let distance = minimumDistance;
        distance <= ENEMY_GROUND_TRAVERSAL_MAX_DISTANCE + 0.001;
        distance += 0.28) {
        const landing = origin.clone().addScaledVector(direction, distance);
        landing.y = this.getSurfaceElevationAt(landing);
        const elevationDelta = landing.y - origin.y;
        if (elevationDelta > ENEMY_GROUND_TRAVERSAL_MAX_RISE
          || elevationDelta < -ENEMY_GROUND_TRAVERSAL_MAX_DROP
          || (rampSide && elevationDelta > -0.18)
          || !this._isEnemyTraversalInsideArena(enemy, landing)
          || this.isPositionInSafeZone(landing)
          || this._findPowerKnockbackBarrier(origin, landing, { ignoreVertical: true })
          || !this.isEnemyPositionClear(enemy, landing)) {
          continue;
        }

        const drop = Math.max(0, -elevationDelta);
        const arcHeight = Math.max(0.92, 0.92 + drop * 0.46);
        if (!this._isEnemyTraversalArcClear(enemy, origin, landing, arcHeight)) continue;
        return {
          targetPosition: landing,
          arcHeight,
          duration: THREE.MathUtils.clamp(
            distance / 4.6 + drop * 0.035,
            0.42,
            0.78,
          ),
          kind: railExit == null ? 'rampSide' : 'railing',
        };
      }
    }
    return null;
  }

  shouldEnemyRecenter(enemy, threshold = 0.72) {
    if ((enemy?.navigationRecoveryTimer ?? 0) > 0 && enemy?.navigationRecoveryTarget) {
      return true;
    }
    const arena = enemy?.encounterArena;
    const position = enemy?.root?.position;
    if (!arena?.center || !position) {
      return false;
    }
    const zoneCenter = arena.zoneCenter ?? arena.center;
    const edgeRatio = Math.max(
      Math.abs(position.x - zoneCenter.x) / Math.max(0.5, arena.softHalfWidth),
      Math.abs(position.z - zoneCenter.z) / Math.max(0.5, arena.softHalfDepth),
    );
    return edgeRatio >= threshold;
  }

  isEnemyPositionClear(enemy, position, options = {}) {
    if (!enemy || !position) {
      return false;
    }
    if (enemy.navigationMode === 'air') {
      const center = this._getEnemyAerialNavigationCenter(enemy, new THREE.Vector3());
      center.add(position).sub(enemy.root.position);
      return this.isAerialPositionClear(center, {
        ...this._getEnemyAerialCollisionOptions(enemy),
        ...options,
      });
    }
    if (!this.isPositionWalkable(position)) {
      return false;
    }

    const clearanceRadius = Math.max(
      0.18,
      Math.min(0.86, options.radius ?? (enemy.radius ?? 0.42) * 0.78),
    );
    for (const zone of this.solidZones) {
      if (isInsideExpandedZone(position, zone, clearanceRadius, 0.12)) {
        return false;
      }
    }
    for (const door of this.doors) {
      if (door.closed
        && isInsideExpandedZone(
          position,
          this._createAerialDoorZone(door),
          clearanceRadius,
          0.12,
        )) {
        return false;
      }
    }
    const centerElevation = this.getSurfaceElevationAt(position);
    const maximumElevationDelta = options.maximumElevationDelta ?? 0.48;
    const sample = new THREE.Vector3();
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI * 0.25;
      sample.set(
        position.x + Math.cos(angle) * clearanceRadius,
        position.y,
        position.z + Math.sin(angle) * clearanceRadius,
      );
      const allowedElevationDelta = this._getGroundedStepTransitionHeight(
        position,
        sample,
        maximumElevationDelta,
      );
      if (!this.isPositionWalkable(sample)
        || Math.abs(this.getSurfaceElevationAt(sample) - centerElevation) > allowedElevationDelta) {
        return false;
      }
    }
    return true;
  }

  findNearestEnemyClearPosition(enemy, position, options = {}) {
    if (!enemy || !position) {
      return null;
    }

    const candidate = position.clone();
    if (enemy.navigationMode !== 'air') {
      candidate.y = this.getSurfaceElevationAt(candidate);
    }
    if (this.isEnemyPositionClear(enemy, candidate, options)) {
      return candidate;
    }

    const preferred = options.preferredPosition ?? enemy.encounterArena?.center ?? position;
    const preferredAngle = Math.atan2(preferred.z - position.z, preferred.x - position.x);
    const maximumRadius = Math.max(0.6, options.maximumRadius ?? 5.4);
    const radialStep = Math.max(0.3, options.radialStep ?? 0.45);
    const directions = 16;
    for (let radius = radialStep; radius <= maximumRadius + 0.001; radius += radialStep) {
      for (let index = 0; index < directions; index += 1) {
        // Alternate left/right around the preferred direction so an inward
        // candidate wins ties without preventing a necessary side-step.
        const offsetIndex = index === 0
          ? 0
          : Math.ceil(index * 0.5) * (index % 2 === 1 ? 1 : -1);
        const angle = preferredAngle + offsetIndex * (Math.PI * 2 / directions);
        candidate.set(
          position.x + Math.cos(angle) * radius,
          position.y,
          position.z + Math.sin(angle) * radius,
        );
        if (enemy.navigationMode !== 'air') {
          candidate.y = this.getSurfaceElevationAt(candidate);
        }
        if (this.isEnemyPositionClear(enemy, candidate, options)) {
          return candidate.clone();
        }
      }
    }
    return null;
  }

  _getFloorGraphKey(tile) {
    return `${tile.x},${tile.z}@${Number(tile.level ?? 0).toFixed(2)}`;
  }

  _getFloorConnectionElevation(tile, dx, dz) {
    if (tile?.surface !== 'industrialRamp'
      || !Number.isFinite(tile.rampStartElevation)
      || !Number.isFinite(tile.rampEndElevation)) {
      return tile?.elevation ?? 0;
    }
    const alongRamp = dx * Math.sign(tile.rampDirectionX ?? 0)
      + dz * Math.sign(tile.rampDirectionZ ?? 0);
    return alongRamp > 0
      ? tile.rampEndElevation
      : alongRamp < 0
        ? tile.rampStartElevation
        : tile.elevation ?? 0;
  }

  _canEnemyTraverseFloorTiles(fromTile, toTile) {
    const dx = Math.abs(fromTile.x - toTile.x);
    const dz = Math.abs(fromTile.z - toTile.z);
    if ((dx + dz) !== 1) {
      return false;
    }
    const directionX = Math.sign(toTile.x - fromTile.x);
    const directionZ = Math.sign(toTile.z - fromTile.z);
    const fromElevation = this._getFloorConnectionElevation(fromTile, directionX, directionZ);
    const toElevation = this._getFloorConnectionElevation(toTile, -directionX, -directionZ);
    const usesRamp = fromTile.surface === 'industrialRamp' || toTile.surface === 'industrialRamp';
    const baseMaximumRise = usesRamp
      ? PLAYER_TRAVERSAL_ENVELOPE.maximumRampRisePerTile + 0.12
      : PLAYER_TRAVERSAL_ENVELOPE.maximumRampRisePerTile;
    const maximumRise = Math.max(
      baseMaximumRise,
      Number(fromTile.groundedStepTransitionHeight) || 0,
      Number(toTile.groundedStepTransitionHeight) || 0,
    );
    return Math.abs(fromElevation - toElevation) <= maximumRise;
  }

  _isFloorTileRuntimeWalkable(tile) {
    tempVectorC.set(tile.x * this.tileSize, tile.elevation ?? 0, tile.z * this.tileSize);
    return this._isResolvedFloorPositionWalkable(tempVectorC);
  }

  _ensureFloorNavigationGraph() {
    this._refreshNavigationTopology();
    if (this.floorNavigationGraph?.revision === this.navigationTopologyRevision) {
      return this.floorNavigationGraph;
    }

    const tilesByKey = new Map();
    for (const tile of this.floorTiles) {
      if (this._isFloorTileRuntimeWalkable(tile)) {
        tilesByKey.set(this._getFloorGraphKey(tile), tile);
      }
    }

    // Build the expensive collision-filtered topology once. Route fields below
    // can then serve every enemy pursuing the same goal without rescanning
    // doors, platform blocks, and solid zones for every breadth-first step.
    const predecessorsByKey = new Map();
    for (const key of tilesByKey.keys()) {
      predecessorsByKey.set(key, []);
    }
    for (const [fromKey, fromTile] of tilesByKey) {
      for (const [dx, dz] of CARDINAL_NEIGHBORS) {
        const column = this.floorTilesByColumn.get(tileKey(fromTile.x + dx, fromTile.z + dz));
        if (!column) {
          continue;
        }
        for (const toTile of column) {
          const toKey = this._getFloorGraphKey(toTile);
          if (!tilesByKey.has(toKey) || !this._canEnemyTraverseFloorTiles(fromTile, toTile)) {
            continue;
          }
          predecessorsByKey.get(toKey).push(fromKey);
        }
      }
    }

    this.floorNavigationGraph = {
      revision: this.navigationTopologyRevision,
      tilesByKey,
      predecessorsByKey,
      routeFields: new Map(),
    };
    return this.floorNavigationGraph;
  }

  _getFloorRouteField(goalKey, graph) {
    if (graph.routeFields.has(goalKey)) {
      const cached = graph.routeFields.get(goalKey);
      graph.routeFields.delete(goalKey);
      graph.routeFields.set(goalKey, cached);
      return cached;
    }

    // Search backwards from the goal once. Each visited tile records the next
    // forward hop, so all enemies targeting this tile share the same field and
    // disconnected starts become a stable negative lookup.
    const nextHopByKey = new Map([[goalKey, null]]);
    const queue = [goalKey];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const currentKey = queue[cursor];
      for (const predecessorKey of graph.predecessorsByKey.get(currentKey) ?? []) {
        if (nextHopByKey.has(predecessorKey)) {
          continue;
        }
        nextHopByKey.set(predecessorKey, currentKey);
        queue.push(predecessorKey);
      }
    }

    if (graph.routeFields.size >= FLOOR_ROUTE_FIELD_LIMIT) {
      const oldestGoalKey = graph.routeFields.keys().next().value;
      graph.routeFields.delete(oldestGoalKey);
    }
    graph.routeFields.set(goalKey, nextHopByKey);
    return nextHopByKey;
  }

  _findFloorTilePath(start, goal, { nextHopOnly = false } = {}) {
    const startKey = this._getFloorGraphKey(start);
    const goalKey = this._getFloorGraphKey(goal);
    const graph = this._ensureFloorNavigationGraph();
    if (!graph.tilesByKey.has(startKey) || !graph.tilesByKey.has(goalKey)) {
      return null;
    }

    if (startKey === goalKey) {
      return [graph.tilesByKey.get(startKey)];
    }

    const routeField = this._getFloorRouteField(goalKey, graph);
    if (!routeField.has(startKey)) {
      return null;
    }

    if (nextHopOnly) {
      const nextKey = routeField.get(startKey);
      return nextKey
        ? [graph.tilesByKey.get(startKey), graph.tilesByKey.get(nextKey)]
        : null;
    }

    const path = [graph.tilesByKey.get(startKey)];
    let currentKey = startKey;
    while (currentKey !== goalKey && path.length <= graph.tilesByKey.size) {
      currentKey = routeField.get(currentKey);
      if (!currentKey) {
        return null;
      }
      path.push(graph.tilesByKey.get(currentKey));
    }
    return currentKey === goalKey ? path : null;
  }

  constrainEnemies() {
    const liveEnemyIds = new Set();

    for (const enemy of this.game.enemies) {
      if (enemy.dead) {
        continue;
      }

      liveEnemyIds.add(enemy.id);
      if (enemy.shouldIgnoreGroundConstraint?.()) {
        continue;
      }
      const position = enemy.root.position;

      if (enemy.navigationMode === 'air') {
        const center = this._getEnemyAerialNavigationCenter(enemy, new THREE.Vector3());
        const collisionOptions = this._getEnemyAerialCollisionOptions(enemy);
        if (this.isAerialPositionClear(center, collisionOptions)) {
          this.lastSafeEnemyPositions.set(enemy.id, position.clone());
          enemy.wallContactCount = Math.max(0, (enemy.wallContactCount ?? 0) - 1);
          this._maintainEnemyArenaRecovery(enemy);
          continue;
        }

        const fallback = this.lastSafeEnemyPositions.get(enemy.id);
        if (fallback) {
          position.copy(fallback);
        } else {
          const clearCenter = this._findNearestClearAerialCenter(center, collisionOptions);
          if (clearCenter) {
            position.add(clearCenter.sub(center));
            this.lastSafeEnemyPositions.set(enemy.id, position.clone());
          }
        }
        enemy.wallContactCount = (enemy.wallContactCount ?? 0) + 1;
        const inwardProbe = position.clone().lerp(
          enemy.encounterArena?.center ?? position,
          0.52,
        );
        inwardProbe.y = position.y;
        const recovery = this.findNearestEnemyClearPosition(enemy, inwardProbe, {
          preferredPosition: enemy.encounterArena?.center,
          maximumRadius: 4.2,
        });
        if (recovery) {
          enemy.setNavigationRecoveryTarget?.(recovery, 2.2);
        }
        continue;
      }

      if (this.isEnemyPositionClear(enemy, position)) {
        this._syncPositionToFloor(position);
        this.lastSafeEnemyPositions.set(enemy.id, position.clone());
        enemy.wallContactCount = Math.max(0, (enemy.wallContactCount ?? 0) - 1);
        this._maintainEnemyArenaRecovery(enemy);
        continue;
      }

      const blockedPosition = position.clone();
      const fallback = this.lastSafeEnemyPositions.get(enemy.id);
      if (fallback && this.isEnemyPositionClear(enemy, fallback)) {
        position.copy(fallback);
        this._syncPositionToFloor(position);
      } else {
        const nearest = this.findNearestEnemyClearPosition(enemy, position, {
          preferredPosition: enemy.encounterArena?.center,
        }) ?? this._findNearestWalkablePosition(position);
        position.copy(nearest);
        this._syncPositionToFloor(position);
        this.lastSafeEnemyPositions.set(enemy.id, nearest.clone());
      }

      enemy.wallContactCount = (enemy.wallContactCount ?? 0) + 1;
      const traversal = this.resolveEnemyGroundTraversal(
        enemy,
        blockedPosition,
        enemy.lastNavigationTarget,
      );
      if (traversal && enemy.startNavigationTraversal?.(
        traversal.targetPosition,
        traversal,
      )) {
        enemy.wallContactCount = 0;
        enemy.clearNavigationRecoveryTarget?.();
        this.lastSafeEnemyPositions.set(enemy.id, position.clone());
        continue;
      }
      const inwardProbe = position.clone().lerp(
        enemy.encounterArena?.center ?? position,
        0.58,
      );
      const recovery = this.findNearestEnemyClearPosition(enemy, inwardProbe, {
        preferredPosition: enemy.encounterArena?.center,
        maximumRadius: 4.2,
      });
      if (recovery) {
        if (typeof enemy.setNavigationRecoveryTarget === 'function') {
          enemy.setNavigationRecoveryTarget(recovery, 2.2);
        } else {
          enemy.navigationRecoveryTarget = recovery;
          enemy.navigationRecoveryTimer = 2.2;
        }
      }
    }

    for (const enemyId of this.lastSafeEnemyPositions.keys()) {
      if (!liveEnemyIds.has(enemyId)) {
        this.lastSafeEnemyPositions.delete(enemyId);
      }
    }
  }

  _maintainEnemyArenaRecovery(enemy) {
    const arena = enemy?.encounterArena;
    const position = enemy?.root?.position;
    if (!arena?.center || !position) {
      return;
    }

    const zoneCenter = arena.zoneCenter ?? arena.center;
    const edgeRatio = Math.max(
      Math.abs(position.x - zoneCenter.x) / Math.max(0.5, arena.softHalfWidth),
      Math.abs(position.z - zoneCenter.z) / Math.max(0.5, arena.softHalfDepth),
    );
    if (edgeRatio >= 1) {
      const centerTarget = arena.center.clone();
      if (enemy.navigationMode === 'air') {
        centerTarget.y = position.y;
      }
      if (typeof enemy.setNavigationRecoveryTarget === 'function') {
        enemy.setNavigationRecoveryTarget(centerTarget, 1.25);
      } else {
        enemy.navigationRecoveryTarget = centerTarget;
        enemy.navigationRecoveryTimer = 1.25;
      }
      return;
    }

    const recovery = enemy.navigationRecoveryTarget;
    if (recovery
      && (position.x - recovery.x) ** 2 + (position.z - recovery.z) ** 2 <= 0.16) {
      enemy.clearNavigationRecoveryTarget?.();
    }
  }

  _getEnemyAerialNavigationCenter(enemy, target) {
    if (typeof enemy?.getAerialNavigationCenter === 'function') {
      const result = enemy.getAerialNavigationCenter(target);
      if (result?.isVector3) {
        return target.copy(result);
      }
      return target;
    }

    const offsetY = Number.isFinite(enemy?.aerialNavigationOffsetY)
      ? enemy.aerialNavigationOffsetY
      : Number.isFinite(enemy?.combatAimOffset)
        ? enemy.combatAimOffset
        : Math.max(0.35, enemy?.hoverHeight ?? 0.5);
    return target.copy(enemy.root.position).add(new THREE.Vector3(0, offsetY, 0));
  }

  _getEnemyAerialCollisionOptions(enemy) {
    const radius = Math.max(0.2, enemy?.aerialNavigationRadius ?? enemy?.radius ?? 0.45);
    return {
      radius,
      verticalRadius: Math.max(
        0.42,
        enemy?.aerialNavigationVerticalRadius ?? Math.min(1.4, (enemy?.collisionHeight ?? 1.4) * 0.43),
      ),
    };
  }

  _findNearestClearAerialCenter(center, options) {
    const candidate = new THREE.Vector3();
    const verticalOffsets = [0.5, 1, 1.5, -0.5];
    for (const offsetY of verticalOffsets) {
      candidate.copy(center).add(new THREE.Vector3(0, offsetY, 0));
      if (this.isAerialPositionClear(candidate, options)) {
        return candidate.clone();
      }
    }

    for (let distance = 0.6; distance <= 4.2; distance += 0.6) {
      for (let index = 0; index < 8; index += 1) {
        const angle = index * Math.PI * 0.25;
        candidate.set(
          center.x + Math.cos(angle) * distance,
          center.y,
          center.z + Math.sin(angle) * distance,
        );
        if (this.isAerialPositionClear(candidate, options)) {
          return candidate.clone();
        }
      }
    }

    return null;
  }

  rollEnemyKeycardDrop(enemy) {
    const keycardId = enemy?.guaranteedKeycardDropId ?? null;
    if (!keycardId || this.progressionManager.hasKeycard(keycardId)) {
      return null;
    }

    const position = (enemy.deathDropPosition ?? enemy.root.position).clone();
    position.y = this.getFloorElevationAt(position);
    position.x += (Math.random() - 0.5) * 0.7;
    position.z += (Math.random() - 0.5) * 0.7;

    return this._spawnKeycardAt(position, 'enemyKeycard', keycardId);
  }

  _spawnKeycardAt(position, idPrefix = 'ruinKeycard', keycardId = null) {
    if (keycardId && this.progressionManager.hasKeycard(keycardId)) {
      return null;
    }

    const object = createDroppedKeycardObject();
    const floorPosition = position.clone();
    floorPosition.y = this.getFloorElevationAt(position);
    object.position.set(floorPosition.x, floorPosition.y + 0.42, floorPosition.z);
    this.game.scene.add(object);
    const definition = keycardId ? this.progressionManager.getKeycard(keycardId) : null;

    const keycard = {
      id: keycardId ?? `${idPrefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      keycardId,
      displayName: definition?.displayName ?? 'Keycard',
      pairedDoorId: definition?.pairedDoorId ?? null,
      progressionTier: definition?.progressionTier ?? null,
      spawnMode: definition?.spawnMode ?? 'Dropped',
      isRequiredForMainProgression: Boolean(definition?.isRequiredForMainProgression),
      object,
      position: floorPosition,
      collected: false,
    };
    this.keycards.push(keycard);
    return keycard;
  }

  getKeycardHudLabel() {
    return this.progressionManager.getHudLabel();
  }

  _grantKeycard(keycardId, { position = null } = {}) {
    if (!keycardId) {
      return false;
    }

    const keycard = this.progressionManager.getKeycard(keycardId);
    const collected = this.progressionManager.collectKeycard(keycardId);
    if (!collected) {
      return false;
    }

    this.keycardCount = this.progressionManager.getNormalKeycardCount();
    const message = keycardId === SHRINE_KEY_ID
      ? 'Shrine Key obtained.'
      : `Obtained ${keycard?.displayName ?? 'Keycard'}.`;
    const color = keycardId === SHRINE_KEY_ID ? SHRINE_COLOR : KEY_SEEKER_COLOR;

    if (position) {
      this.game.addParticleBurst(position, color, 22, 0.16);
    }

    this.game.ui?.showToast?.(message, keycardId === SHRINE_KEY_ID ? '#7df8ff' : '#5ee77b');
    this.game.ui?.renderInventory?.();
    return true;
  }

  _collectKeycard(keycard, { position = null } = {}) {
    if (!keycard || keycard.collected) {
      return false;
    }

    const keycardId = keycard.keycardId ?? keycard.id;
    const collected = this._grantKeycard(keycardId, {
      position: position ?? keycard.position,
    });

    keycard.collected = true;
    if (keycard.object) {
      keycard.object.visible = false;
    }

    return collected;
  }

  _getCollectedInventorySet() {
    return new Set(this.progressionManager.collectedKeycardIds);
  }

  _getNextUncollectedProgressionKeycard() {
    const keycards = [...(this.progression?.keycards ?? [])]
      .filter((keycard) => !this.progressionManager.hasKeycard(keycard.keycardId))
      .sort((a, b) => (a.progressionTier ?? 99) - (b.progressionTier ?? 99));

    return keycards.find((keycard) => this._isRoomReachableWithCurrentKeys(keycard.spawnRoomId))
      ?? keycards[0]
      ?? null;
  }

  _isRoomReachableWithCurrentKeys(roomId) {
    return this._getReachableRoomIds(this._getCollectedInventorySet()).has(roomId);
  }

  _getReachableRoomIds(inventory = new Set(), forceClosedDoorIds = new Set()) {
    const connections = this.progression?.roomConnections ?? [];
    const startRoomId = this.progression?.entranceRoomId ?? 'hubTown';
    const reachable = new Set([startRoomId]);
    const queue = [startRoomId];

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const roomId = queue[cursor];

      for (const connection of connections) {
        const nextRoomId = connection.fromRoomId === roomId
          ? connection.toRoomId
          : connection.toRoomId === roomId
            ? connection.fromRoomId
            : null;

        if (!nextRoomId || reachable.has(nextRoomId)) {
          continue;
        }

        if (!this._canTraverseProgressionConnection(connection, inventory, forceClosedDoorIds)) {
          continue;
        }

        reachable.add(nextRoomId);
        queue.push(nextRoomId);
      }
    }

    return reachable;
  }

  _canTraverseProgressionConnection(connection, inventory, forceClosedDoorIds = new Set()) {
    if (!connection.doorId || connection.doorId === 'entranceDoor') {
      return true;
    }

    if (forceClosedDoorIds.has(connection.doorId)) {
      return false;
    }

    const door = this.doors.find((candidate) => candidate.id === connection.doorId);
    if (!door || !door.closed) {
      return true;
    }

    if (door.encounterId) {
      const encounter = this.encounters.find((candidate) => candidate.id === door.encounterId);
      if (encounter && !encounter.cleared) {
        return false;
      }
    }

    if (door.pressurePlateId && this._isPressurePlateActivated(door.pressurePlateId)) {
      return true;
    }

    if (door.mechanismId && !this._isMechanismActivated(door.mechanismId)) {
      return false;
    }

    if (door.requiresKeycard) {
      return inventory.has(door.requiredKeycardId);
    }

    return !door.locked;
  }

  _getRoomAtPosition(position) {
    if (!position) {
      return null;
    }

    const tile = this.worldToTile(position);

    for (const room of this.dungeon?.rooms ?? []) {
      const halfW = Math.floor((room.width ?? 1) / 2);
      const halfD = Math.floor((room.depth ?? 1) / 2);
      if (
        Math.abs(tile.x - room.x) <= halfW
        && Math.abs(tile.z - room.z) <= halfD
      ) {
        return room;
      }
    }

    return null;
  }

  _updateRoomDiscovery() {
    const room = this._getRoomAtPosition(this.game.player.root.position);
    if (!room) {
      return;
    }

    const firstVisit = !this.visitedRoomIds.has(room.id);
    this.visitedRoomIds.add(room.id);

    this.discoveredRoomIds.add(room.id);

    if (firstVisit && room.environmentalStory) {
      this.game.ui?.showToast?.(
        `${room.archetype ?? room.type}: ${room.environmentalStory}`,
        room.flavorId === 'alarmed' ? '#ffb347' : '#6bdcff',
      );
      this.environmentalStoryToastTimer = 2.25;
    }

    for (const connection of this.progression?.roomConnections ?? []) {
      if (connection.fromRoomId === room.id) {
        this.discoveredRoomIds.add(connection.toRoomId);
      } else if (connection.toRoomId === room.id) {
        this.discoveredRoomIds.add(connection.fromRoomId);
      }
    }
  }

  _activateKeySeeker() {
    if (!this.keySeeker || this.keySeeker.activated) {
      return;
    }

    this.keySeeker.activated = true;
    this.keySeeker.isActivated = true;
    if (this.progression?.keySeeker) {
      this.progression.keySeeker.isActivated = true;
    }

    this.game.addParticleBurst(this.keySeeker.position, KEY_SEEKER_COLOR, 28, 0.18);
    this.game.ui?.showToast?.('Key Seeker activated. Keycard signals added to minimap.', '#5ee77b');
  }

  _updateKeySeekerVisuals(dt) {
    const object = this.keySeeker?.object;
    if (!object) {
      return;
    }

    const lens = object.getObjectByName?.('keySeekerSignalLens');
    const ring = object.getObjectByName?.('keySeekerSignalRing');
    const active = Boolean(this.keySeeker.activated);

    if (lens) {
      lens.rotation.y += dt * (active ? 3.2 : 1.1);
      lens.position.y = 0.88 + Math.sin(this.game.elapsedTime * (active ? 5.4 : 2.4)) * (active ? 0.07 : 0.03);
      if (lens.material?.emissive) {
        lens.material.emissiveIntensity = active
          ? 1.35 + Math.sin(this.game.elapsedTime * 6) * 0.18
          : 0.72;
      }
    }

    if (ring?.material) {
      ring.material.opacity = active
        ? 0.38 + Math.sin(this.game.elapsedTime * 5.4) * 0.1
        : 0.18 + Math.sin(this.game.elapsedTime * 2.2) * 0.04;
    }
  }

  getMinimapSnapshot() {
    const minimap = this.progression?.minimap;
    if (!minimap) {
      return null;
    }

    const roomById = new Map(minimap.rooms.map((room) => [room.roomId, room]));
    const playerPoint = this._worldToMinimapPoint(this.game.player.root.position);
    const reachableRooms = this._getReachableRoomIds(this._getCollectedInventorySet());
    const rooms = minimap.rooms.map((room) => ({
      ...room,
      isDiscovered: this.discoveredRoomIds.has(room.roomId),
      isReachable: reachableRooms.has(room.roomId),
      isCurrent: this._getRoomAtPosition(this.game.player.root.position)?.id === room.roomId,
    }));
    const hallways = minimap.hallways.map((hallway) => {
      const fromRoom = roomById.get(hallway.fromRoomId);
      const toRoom = roomById.get(hallway.toRoomId);
      return {
        ...hallway,
        from: fromRoom?.roomCenter2D ?? null,
        to: toRoom?.roomCenter2D ?? null,
        isDiscovered: this.discoveredRoomIds.has(hallway.fromRoomId) || this.discoveredRoomIds.has(hallway.toRoomId),
      };
    });
    const markers = this._createMinimapMarkers(reachableRooms);
    const arrows = this._createMinimapArrows(playerPoint, reachableRooms);

    return {
      bounds: minimap.bounds,
      rooms,
      hallways,
      markers,
      arrows,
      player: playerPoint,
    };
  }

  _createMinimapMarkers(reachableRooms) {
    const markers = [];
    const addMarker = (type, position, options = {}) => {
      if (!position) {
        return;
      }

      markers.push({
        id: options.id ?? `${type}_${markers.length}`,
        type,
        point: this._worldToMinimapPoint(position),
        roomId: options.roomId ?? this._getRoomAtPosition(position)?.id ?? null,
        label: options.label ?? type,
        priority: options.priority ?? 0,
        isReachable: options.roomId ? reachableRooms.has(options.roomId) : true,
      });
    };

    for (const door of this.doors) {
      const visible = this.discoveredRoomIds.has(door.fromRoomId) || this.discoveredRoomIds.has(door.toRoomId);
      if (!visible || !door.closed) {
        continue;
      }

      addMarker(
        door.isShrineDoor
          ? 'shrineDoor'
          : this.progressionManager.hasKeycard(door.requiredKeycardId)
            ? 'usableDoor'
            : 'lockedDoor',
        door.position,
        {
          id: door.id,
          roomId: door.toRoomId,
          label: door.label,
          priority: door.isShrineDoor ? 90 : 70,
        },
      );
    }

    for (const chest of this.chests) {
      if (chest.opened) {
        continue;
      }

      const visible = this.discoveredRoomIds.has(chest.roomId) || (this.keySeeker?.activated && chest.guaranteedKeycardId);
      if (visible) {
        addMarker(chest.guaranteedKeycardId ? 'keycardChest' : 'chest', chest.position, {
          id: chest.id,
          roomId: chest.roomId,
          label: chest.guaranteedKeycardId ? 'Keycard Signal' : 'Chest',
          priority: chest.guaranteedKeycardId ? 78 : 35,
        });
      }
    }

    for (const keycard of this.keycards) {
      if (keycard.collected) {
        continue;
      }

      const roomId = keycard.spawnRoomId ?? this._getRoomAtPosition(keycard.position)?.id ?? null;
      const visible = this.discoveredRoomIds.has(roomId) || this.keySeeker?.activated;
      if (visible) {
        addMarker('keycard', keycard.position, {
          id: keycard.keycardId ?? keycard.id,
          roomId,
          label: this.keySeeker?.activated && !this.progressionManager.hasKeycard(keycard.keycardId)
            ? 'Keycard Signal'
            : keycard.displayName,
          priority: 82,
        });
      }
    }

    for (const enemy of this.game.enemies) {
      if (enemy.dead) {
        continue;
      }

      const roomId = this._getRoomAtPosition(enemy.root.position)?.id ?? null;
      const isCarrier = Boolean(enemy.guaranteedKeycardDropId);
      const visible = this.discoveredRoomIds.has(roomId) || (isCarrier && this.keySeeker?.activated);
      if (visible) {
        addMarker(isCarrier ? 'keyHoldingElite' : 'enemy', enemy.root.position, {
          id: enemy.id,
          roomId,
          label: isCarrier ? 'Elite keycard carrier' : 'Enemy',
          priority: isCarrier ? 84 : 30,
        });
      }
    }

    for (const encounter of this.encounters) {
      if (encounter.cleared) {
        continue;
      }

      if (encounter.keycardDropId && !this.progressionManager.hasKeycard(encounter.keycardDropId)) {
        const visible = this.keySeeker?.activated || this.discoveredRoomIds.has(encounter.roomId);
        if (visible && !encounter.spawned) {
          addMarker('keyHoldingElite', encounter.zone.position, {
            id: `${encounter.id}_carrier`,
            roomId: encounter.roomId,
            label: 'Elite keycard carrier',
            priority: 84,
          });
        }
      }

      if (encounter.isBoss && this.discoveredRoomIds.has(encounter.roomId)) {
        addMarker('boss', encounter.zone.position, {
          id: encounter.id,
          roomId: encounter.roomId,
          label: 'Boss',
          priority: 86,
        });
      }
    }

    if (this.keySeeker && !this.keySeeker.activated && this.discoveredRoomIds.has(this.keySeeker.roomId)) {
      addMarker('keySeeker', this.keySeeker.position, {
        id: this.keySeeker.id,
        roomId: this.keySeeker.roomId,
        label: 'Key Seeker',
        priority: 62,
      });
    }

    if (this.shrine && this.discoveredRoomIds.has('shrineRoom')) {
      addMarker('shrine', this.shrine.position, {
        id: this.shrine.id,
        roomId: 'shrineRoom',
        label: 'Large Refractor',
        priority: 88,
      });
    }

    return markers.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }

  _createMinimapArrows(playerPoint, reachableRooms) {
    const arrows = [];
    const addArrow = (type, position, options = {}) => {
      const point = this._worldToMinimapPoint(position);
      const angle = THREE.MathUtils.radToDeg(Math.atan2(point.z - playerPoint.z, point.x - playerPoint.x));
      arrows.push({
        id: options.id ?? `${type}_${arrows.length}`,
        type,
        point,
        angle,
        isDim: Boolean(options.isDim),
        label: options.label ?? type,
      });
    };

    if (this.keySeeker?.activated) {
      for (const keycard of this.progression?.keycards ?? []) {
        if (this.progressionManager.hasKeycard(keycard.keycardId)) {
          continue;
        }

        const source = this._getKeycardSource(keycard.keycardId);
        if (!source?.position) {
          continue;
        }

        addArrow('keySignal', source.position, {
          id: `${keycard.keycardId}_signal`,
          isDim: source.roomId ? !reachableRooms.has(source.roomId) : false,
          label: 'Keycard Signal',
        });
      }
    }

    const trackedDoor = this.progressionManager.getCurrentTrackedDoor(this.doors);
    if (trackedDoor?.runtimeDoor?.position) {
      addArrow(trackedDoor.keycard.keycardId === SHRINE_KEY_ID ? 'shrineObjective' : 'usableDoor', trackedDoor.runtimeDoor.position, {
        id: `${trackedDoor.keycard.keycardId}_doorArrow`,
        label: trackedDoor.runtimeDoor.label,
      });
    }

    return arrows;
  }

  _getKeycardSource(keycardId) {
    const dropped = this.keycards.find((keycard) => keycard.keycardId === keycardId && !keycard.collected);
    if (dropped) {
      return {
        position: dropped.position,
        roomId: dropped.spawnRoomId ?? this._getRoomAtPosition(dropped.position)?.id ?? null,
      };
    }

    const chest = this.chests.find((candidate) => candidate.guaranteedKeycardId === keycardId && !candidate.opened);
    if (chest) {
      return {
        position: chest.position,
        roomId: chest.roomId,
      };
    }

    const carrier = this.game.enemies.find((enemy) => !enemy.dead && enemy.guaranteedKeycardDropId === keycardId);
    if (carrier) {
      return {
        position: carrier.root.position,
        roomId: this._getRoomAtPosition(carrier.root.position)?.id ?? null,
      };
    }

    const encounter = this.encounters.find((candidate) => candidate.keycardDropId === keycardId && !candidate.cleared);
    if (encounter) {
      return {
        position: encounter.zone.position,
        roomId: encounter.roomId,
      };
    }

    const progressionKeycard = this.progression?.keycards?.find((keycard) => keycard.keycardId === keycardId);
    if (progressionKeycard?.sourcePosition) {
      return {
        position: progressionKeycard.sourcePosition,
        roomId: progressionKeycard.spawnRoomId,
      };
    }

    return null;
  }

  _worldToMinimapPoint(position) {
    return {
      x: Number((position.x / this.tileSize).toFixed(3)),
      z: Number((position.z / this.tileSize).toFixed(3)),
    };
  }

  _constrainPlayerToWalkable() {
    const playerRoot = this.game.player.root;
    const current = playerRoot.position;
    const playerJumping = this._isPlayerJumping();

    // Ledge actions intentionally pass through the obstacle footprint while
    // the hands stay planted. Player owns the complete root path until the
    // climb finishes on the walkable top surface.
    if (this.game.player.isLedgeClinging?.()) {
      this.lastSafePlayerPosition.copy(current);
      return;
    }

    // Tractor beams and player-owned ballistic throws have exclusive control
    // of the root until they release or land. Normal floor correction during
    // that window would snap the player out of the beam or flatten the arc.
    if (this.game.player.shouldIgnoreGroundConstraint?.()) {
      return;
    }

    // Powerful knockback owns its airborne path and performs a forward-first
    // walkable landing correction when descending. Axis clamping here would
    // erase the impact momentum before that resolver can make its choice.
    if (this.game.player.isPowerKnockbackActive?.()) {
      return;
    }

    const surfaceY = this.getSurfaceElevationAt(current);
    const closestFloorTile = this.getFloorTileAt(current, { allowClosest: true });
    const closestFloorY = closestFloorTile
      ? this._getTileElevationAtPosition(closestFloorTile, current)
      : surfaceY;
    const groundedStepTransitionHeight = this._getGroundedStepTransitionHeight(
      this.lastSafePlayerPosition,
      current,
      PLAYER_STEP_OFF_FALL_HEIGHT,
    );
    const authoredGroundedDrop = !playerJumping
      && closestFloorTile?.allowsGroundedDropLanding === true
      && current.y - closestFloorY > groundedStepTransitionHeight
      && current.y - closestFloorY <= PLAYER_TRAVERSAL_ENVELOPE.safeDropHeight
      && this._isResolvedFloorPositionWalkable(
        tempVectorC.set(current.x, closestFloorY, current.z),
      );
    if (authoredGroundedDrop) {
      this.pendingPlayerJumpOffLanding = null;
      return;
    }
    const groundedRiseRequiresJumpAt = (position) => {
      const tile = this.getFloorTileAt(position, { allowClosest: true });
      const candidateY = this.getSurfaceElevationAt(position);
      const allowedRise = this._getGroundedStepTransitionHeight(
        this.lastSafePlayerPosition,
        position,
        PLAYER_TRAVERSAL_ENVELOPE.maximumRampRisePerTile + 0.05,
      );
      return !playerJumping
        && tile?.surface !== 'industrialRamp'
        && candidateY - this.lastSafePlayerPosition.y > allowedRise;
    };

    if (this.isPositionWalkable(current) && !groundedRiseRequiresJumpAt(current)) {
      const steppingOffElevatedSurface = !playerJumping
        && current.y - surfaceY > groundedStepTransitionHeight;
      if (!steppingOffElevatedSurface) {
        const authoredGroundedStep = !playerJumping
          && groundedStepTransitionHeight > PLAYER_STEP_OFF_FALL_HEIGHT + 0.01
          && Math.abs(current.y - surfaceY) <= groundedStepTransitionHeight + 0.01;
        this._syncPositionToFloor(current, { preservePlayerAction: !authoredGroundedStep });
      }
      this.lastSafePlayerPosition.copy(current);
      if (!playerJumping) {
        this.pendingPlayerJumpOffLanding = null;
      }
      return;
    }

    if (!playerJumping && this.pendingPlayerJumpOffLanding) {
      current.copy(this.pendingPlayerJumpOffLanding);
      this._syncPositionToFloor(current);
      this.lastSafePlayerPosition.copy(current);
      this.pendingPlayerJumpOffLanding = null;
      return;
    }

    if (playerJumping) {
      const jumpLanding = this._getWalkableJumpOffLanding(current, tempVectorB);
      if (jumpLanding) {
        this.pendingPlayerJumpOffLanding = jumpLanding.clone();
        this.lastSafePlayerPosition.copy(current);
        return;
      }
    }

    tempVectorA.set(current.x, current.y, this.lastSafePlayerPosition.z);
    if (this.isPositionWalkable(tempVectorA) && !groundedRiseRequiresJumpAt(tempVectorA)) {
      current.copy(tempVectorA);
      this._syncPositionToFloor(current, { preservePlayerAction: true });
      this.lastSafePlayerPosition.copy(current);
      return;
    }

    tempVectorA.set(this.lastSafePlayerPosition.x, current.y, current.z);
    if (this.isPositionWalkable(tempVectorA) && !groundedRiseRequiresJumpAt(tempVectorA)) {
      current.copy(tempVectorA);
      this._syncPositionToFloor(current, { preservePlayerAction: true });
      this.lastSafePlayerPosition.copy(current);
      return;
    }

    current.copy(this.lastSafePlayerPosition);
    this._syncPositionToFloor(current, { preservePlayerAction: true });
  }

  _updateKeycards(dt) {
    const playerPosition = this.game.player.root.position;

    for (const keycard of this.keycards) {
      if (keycard.collected) {
        if (keycard.barrierObject) {
          keycard.barrierObject.visible = false;
        }
        continue;
      }

      keycard.object.rotation.y += dt * 1.6;
      keycard.object.position.y = keycard.position.y + 0.42 + Math.sin(this.game.elapsedTime * 4.2) * 0.08;
      const protectingEncounter = keycard.protectedByEncounterId
        ? this.encounters.find((encounter) => encounter.id === keycard.protectedByEncounterId)
        : null;
      const protectedByEncounter = Boolean(protectingEncounter && !protectingEncounter.cleared);
      if (keycard.barrierObject) {
        keycard.barrierObject.visible = protectedByEncounter;
        keycard.barrierObject.rotation.y += dt * 0.8;
        const shellMaterial = keycard.barrierObject.userData?.shellMaterial;
        if (shellMaterial) {
          shellMaterial.opacity = 0.2 + Math.sin(this.game.elapsedTime * 5.4) * 0.055;
        }
      }

      if (protectedByEncounter) {
        continue;
      }

      if (playerPosition.distanceToSquared(keycard.position) > 1.45 * 1.45) {
        continue;
      }

      this._collectKeycard(keycard, {
        position: keycard.position,
      });
    }
  }

  _updateTraps(dt) {
    this.trapPulseTimer = Math.max(0, this.trapPulseTimer - dt);
    const player = this.game.player;
    const pulseNow = this.trapPulseTimer <= 0;
    let trapPulseUsed = false;

    for (const trap of this.traps) {
      if (!trap.active) {
        continue;
      }

      const timing = this._getTrapTiming(trap);
      if (!timing.live) {
        continue;
      }

      if (isInsideZone(player.root.position, trap)) {
        player.takeDamage((trap.damagePerSecond ?? 18) * dt);

        if (pulseNow) {
          tempVectorA.copy(player.root.position);
          tempVectorA.y += 0.2;
          this.game.addParticleBurst(tempVectorA, 0xff645d, 6, 0.08);
          trapPulseUsed = true;
        }
      }

      if (!pulseNow) {
        continue;
      }

      for (const enemy of this.game.enemies) {
        if (enemy.dead || !isInsideZone(enemy.root.position, trap)) {
          continue;
        }

        tempVectorA.copy(enemy.root.position);
        tempVectorA.y += 0.72;
        this.game.damageEnemy(enemy, trap.damagePerPulse ?? 5, {
          source: trap,
          element: 'shock',
          hitPosition: tempVectorA.clone(),
        });
        this.game.addParticleBurst(tempVectorA, 0xff645d, 5, 0.075);
        trapPulseUsed = true;
      }
    }

    if (trapPulseUsed) {
      this.trapPulseTimer = 0.32;
    }
  }

  _updateTrapVisuals(dt) {
    for (const trap of this.traps) {
      if (!trap.object) {
        continue;
      }

      const timing = this._getTrapTiming(trap);
      const activePulse = trap.active
        ? timing.live
          ? 1.1 + Math.sin(this.game.elapsedTime * 22) * 0.16
          : timing.telegraph
            ? 0.62 + Math.sin(this.game.elapsedTime * 14) * 0.18
            : 0.22
        : 0.08;
      const targetScaleY = trap.active
        ? timing.live
          ? 1
          : timing.telegraph
            ? 0.72
            : 0.28
        : 0.18;

      trap.object.traverse((object) => {
        if (!object.isMesh) {
          return;
        }

        object.scale.y = THREE.MathUtils.lerp(object.scale.y, targetScaleY, Math.min(1, dt * 8));
        if (object.material?.emissive) {
          object.material.emissiveIntensity = THREE.MathUtils.lerp(
            object.material.emissiveIntensity,
            activePulse,
            Math.min(1, dt * 8),
          );
        }

        if (object.name === 'trapLaserBeam' && object.material) {
          object.material.opacity = THREE.MathUtils.lerp(
            object.material.opacity ?? 0.7,
            trap.active
              ? timing.live
                ? 0.82
                : timing.telegraph
                  ? 0.28
                  : 0.035
              : 0,
            Math.min(1, dt * 10),
          );
        }
      });
    }
  }

  _getTrapTiming(trap) {
    if (!trap?.active) {
      return { live: false, telegraph: false, phase: 0 };
    }

    const interval = Math.max(0.5, trap.pulseInterval ?? 1.55);
    const liveDuration = Math.min(interval, Math.max(0.08, trap.activeDuration ?? 0.36));
    const telegraphDuration = Math.max(0.08, trap.telegraphDuration ?? 0.4);
    const phase = THREE.MathUtils.euclideanModulo(this.game.elapsedTime + (trap.phaseOffset ?? 0), interval);
    const live = phase <= liveDuration;
    const telegraph = !live && phase >= interval - telegraphDuration;

    return { live, telegraph, phase };
  }

  _updatePuzzleBlocks(dt) {
    const player = this.game.player;
    const playerRoot = player.root;
    const playerRadius = player.radius ?? 0.42;

    for (const block of this.puzzleBlocks) {
      if (!block?.object || block.locked) {
        continue;
      }

      tempVectorA.copy(block.position);
      tempVectorB.copy(block.position).sub(playerRoot.position);
      tempVectorB.y = 0;

      const minDistance = (block.radius ?? 0.58) + playerRadius + 0.08;
      const distance = tempVectorB.length();
      if (distance > 0.001 && distance < minDistance) {
        tempVectorB.normalize();
        block.position.addScaledVector(tempVectorB, Math.min(1.6 * dt, minDistance - distance + 0.02));
      } else if (distance <= 0.001 && player.lastMoveDirection?.lengthSq?.() > 0.0001) {
        tempVectorB.copy(player.lastMoveDirection).normalize();
        block.position.addScaledVector(tempVectorB, 1.2 * dt);
      }

      if (!this.isPositionWalkable(block.position)) {
        block.position.copy(tempVectorA);
      }

      block.position.y = this.getFloorElevationAt(block.position);
      block.object.position.lerp(block.position, Math.min(1, dt * 12));
      block.object.rotation.y += dt * 0.35;

      const core = block.object.getObjectByName?.('relayBlockPowerCore');
      if (core?.material?.emissive) {
        core.material.emissiveIntensity = 0.72 + Math.sin(this.game.elapsedTime * 5.8) * 0.18;
      }
    }
  }

  _updateConveyors(dt) {
    const playerRoot = this.game.player.root;

    for (const conveyor of this.conveyors) {
      this._updateConveyorVisuals(conveyor, dt);

      if (!conveyor.active) {
        continue;
      }

      if (isInsideZone(playerRoot.position, conveyor)) {
        playerRoot.position.addScaledVector(conveyor.direction, conveyor.speed * dt);
      }

      for (const enemy of this.game.enemies) {
        if (enemy.dead || !isInsideZone(enemy.root.position, conveyor)) {
          continue;
        }

        enemy.root.position.addScaledVector(conveyor.direction, conveyor.speed * dt * 0.72);
      }

      for (const block of this.puzzleBlocks) {
        if (block.locked || !isInsideZone(block.position, conveyor)) {
          continue;
        }

        tempVectorA.copy(block.position);
        block.position.addScaledVector(conveyor.direction, conveyor.speed * dt * 0.55);

        if (!this.isPositionWalkable(block.position)) {
          block.position.copy(tempVectorA);
        }

        block.position.y = this.getFloorElevationAt(block.position);
        block.object?.position.copy(block.position);
      }
    }
  }

  _initializeConveyorPuzzles() {
    for (const puzzle of this.conveyorPuzzles) {
      puzzle.beltByKey = new Map((puzzle.belts ?? []).map((belt) => [belt.key, belt]));
      puzzle.junctionById = new Map((puzzle.junctions ?? []).map((junction) => [junction.id, junction]));
      puzzle.junctionByBeltId = new Map((puzzle.junctions ?? []).map((junction) => [junction.beltId, junction]));
      puzzle.state = puzzle.completed ? 'VaultOpened' : puzzle.state ?? 'ObjectReady';

      for (const junction of puzzle.junctions ?? []) {
        this._applyConveyorPuzzleJunctionState(puzzle, junction, junction.stateIndex ?? 0, { silent: true });
      }

      this._resetConveyorPuzzleCargo(puzzle, { silent: true, keepConsoleStates: true });
    }
  }

  _updateConveyorPuzzles(dt) {
    for (const puzzle of this.conveyorPuzzles) {
      this._updateConveyorPuzzleVisuals(puzzle, dt);

      if (puzzle.completed || puzzle.state === 'VaultOpened') {
        continue;
      }

      const cargo = puzzle.cargo;
      if (!cargo || puzzle.state !== 'ObjectMoving') {
        continue;
      }

      if (cargo.moving) {
        cargo.moveProgress = Math.min(1, (cargo.moveProgress ?? 0) + dt * (puzzle.objectSpeed ?? 2.4));
        cargo.position.lerpVectors(cargo.fromPosition, cargo.toPosition, cargo.moveProgress);
        cargo.position.y = this.getFloorElevationAt(cargo.position);
        cargo.object?.position.copy(cargo.position);

        if (cargo.moveProgress >= 1) {
          cargo.currentTileKey = cargo.toTileKey;
          cargo.moving = false;
          cargo.fromTileKey = null;
          cargo.toTileKey = null;
          if (cargo.currentTileKey === puzzle.target.key) {
            this._completeConveyorPuzzle(puzzle);
          }
        }
        continue;
      }

      this._advanceConveyorPuzzleCargo(puzzle);
    }
  }

  _updateConveyorPuzzleVisuals(puzzle, dt) {
    const cargoCore = puzzle.cargo?.object?.getObjectByName?.('conveyorCargoRefractorCore');
    if (cargoCore?.material?.emissive) {
      cargoCore.rotation.y += dt * (puzzle.state === 'ObjectMoving' ? 2.8 : 1.1);
      cargoCore.material.emissiveIntensity = 0.82 + Math.sin(this.game.elapsedTime * 5.6) * 0.16;
    }

    const spawnerRing = puzzle.spawner?.object?.getObjectByName?.('conveyorCargoSpawnerRing');
    if (spawnerRing?.material) {
      spawnerRing.rotation.z += dt * 0.85;
      spawnerRing.material.opacity = THREE.MathUtils.lerp(
        spawnerRing.material.opacity ?? 0.26,
        puzzle.state === 'ObjectReady' ? 0.38 : 0.18,
        Math.min(1, dt * 5),
      );
    }
  }

  _activateConveyorPuzzleMechanism(mechanism) {
    const puzzle = this.conveyorPuzzleById.get(mechanism.conveyorPuzzleId);
    if (!puzzle) {
      return;
    }

    const blockedEncounter = this._getMechanismBlockingEncounter(mechanism);
    if (blockedEncounter) {
      this.game.ui?.showToast?.(`Clear ${blockedEncounter.label} before using this console`, '#ffb347');
      this.game.addParticleBurst(mechanism.position, LOCKED_COLOR, 12, 0.12);
      return;
    }

    if (puzzle.completed || puzzle.state === 'VaultOpened') {
      this.game.ui?.showToast?.('Cargo route complete. Bonus vault unlocked.', '#6bdcff');
      return;
    }

    if (mechanism.conveyorPuzzleAction === 'cycleJunction') {
      const junctionId = mechanism.controlledJunctionIds?.[0] ?? puzzle.junctions?.[0]?.id;
      const junction = puzzle.junctionById?.get(junctionId);
      if (!junction?.states?.length) {
        return;
      }

      const nextStateIndex = ((junction.stateIndex ?? 0) + 1) % junction.states.length;
      this._applyConveyorPuzzleJunctionState(puzzle, junction, nextStateIndex);
      const stateLabel = junction.states[nextStateIndex]?.label ?? `Route ${nextStateIndex + 1}`;
      this.game.ui?.showToast?.(`Conveyor route set: ${stateLabel}`, '#6bdcff');
      this.game.addParticleBurst(mechanism.position, MECHANISM_COLOR, 14, 0.12);
      return;
    }

    if (mechanism.conveyorPuzzleAction === 'launchOrReset') {
      if (puzzle.state === 'ObjectMoving' || puzzle.state === 'ObjectBlocked') {
        this._resetConveyorPuzzleCargo(puzzle);
        return;
      }

      this._launchConveyorPuzzleCargo(puzzle);
    }
  }

  _applyConveyorPuzzleJunctionState(puzzle, junction, stateIndex, { silent = false } = {}) {
    if (!junction?.states?.length) {
      return;
    }

    const clampedState = THREE.MathUtils.clamp(Math.trunc(stateIndex), 0, junction.states.length - 1);
    const state = junction.states[clampedState];
    junction.stateIndex = clampedState;

    const belt = (puzzle.belts ?? []).find((candidate) => candidate.id === junction.beltId);
    if (belt) {
      belt.currentDirection = { ...state.direction };
    }

    const conveyor = this.conveyors.find((candidate) => (
      candidate.conveyorPuzzleId === puzzle.id
      && candidate.conveyorNodeId === junction.beltId
    ));
    if (conveyor) {
      conveyor.direction.set(state.direction.x, 0, state.direction.z);
      if (conveyor.direction.lengthSq() <= 0.0001) {
        conveyor.direction.set(0, 0, 1);
      } else {
        conveyor.direction.normalize();
      }
    }

    if (!silent) {
      this._pulseConveyorGroup(puzzle.id, junction.beltId);
    }
  }

  _pulseConveyorGroup(puzzleId, nodeId) {
    for (const conveyor of this.conveyors) {
      if (conveyor.conveyorPuzzleId !== puzzleId || conveyor.conveyorNodeId !== nodeId) {
        continue;
      }

      for (const arrow of conveyor.visuals ?? []) {
        if (arrow.material?.emissive) {
          arrow.material.emissiveIntensity = 1.8;
        }
      }
    }
  }

  _launchConveyorPuzzleCargo(puzzle) {
    const cargo = puzzle.cargo;
    if (!cargo) {
      return;
    }

    if (cargo.currentTileKey !== puzzle.spawner.key) {
      this._resetConveyorPuzzleCargo(puzzle, { silent: true, keepConsoleStates: true });
    }

    puzzle.state = 'ObjectMoving';
    cargo.accepted = false;
    cargo.moving = false;
    this.game.ui?.showToast?.('Cargo released. Route it to the receiver plate.', '#6bdcff');
    this.game.addParticleBurst(puzzle.spawner.position, MECHANISM_COLOR, 18, 0.12);
  }

  _resetConveyorPuzzleCargo(puzzle, {
    silent = false,
    keepConsoleStates = true,
  } = {}) {
    const cargo = puzzle.cargo;
    if (!cargo) {
      return;
    }

    puzzle.state = puzzle.completed ? 'VaultOpened' : 'ObjectReady';
    cargo.currentTileKey = puzzle.completed ? puzzle.target.key : puzzle.spawner.key;
    cargo.fromTileKey = null;
    cargo.toTileKey = null;
    cargo.moving = false;
    cargo.moveProgress = 0;
    cargo.accepted = Boolean(puzzle.completed);
    cargo.position.copy(puzzle.completed ? puzzle.target.position : puzzle.spawner.position);
    cargo.position.y = this.getFloorElevationAt(cargo.position);
    cargo.object?.position.copy(cargo.position);

    const plate = this.pressurePlates.find((candidate) => candidate.id === puzzle.targetPressurePlateId);
    if (plate && !puzzle.completed) {
      plate.active = false;
      plate.activated = false;
    }

    if (!keepConsoleStates) {
      for (const junction of puzzle.junctions ?? []) {
        this._applyConveyorPuzzleJunctionState(puzzle, junction, 0, { silent: true });
      }
    }

    if (!silent) {
      this.game.ui?.showToast?.('Cargo returned to the spawner.', '#6bdcff');
      this.game.addParticleBurst(puzzle.spawner.position, MECHANISM_COLOR, 14, 0.1);
    }
  }

  _advanceConveyorPuzzleCargo(puzzle) {
    const cargo = puzzle.cargo;
    const direction = this._getConveyorPuzzleCurrentDirection(puzzle);

    if (!direction || (direction.x === 0 && direction.z === 0)) {
      puzzle.state = 'ObjectBlocked';
      this.game.ui?.showToast?.('Cargo is blocked. Reset or change the route.', '#ffb347');
      return;
    }

    const { x, z } = this._parseTileKey(cargo.currentTileKey);
    const nextKey = tileKey(x + direction.x, z + direction.z);
    const validNext = nextKey === puzzle.target.key || puzzle.beltByKey?.has(nextKey);

    if (!validNext) {
      puzzle.state = 'ObjectBlocked';
      this.game.ui?.showToast?.('Cargo reached a stopper. Reset or change the route.', '#ffb347');
      return;
    }

    cargo.fromTileKey = cargo.currentTileKey;
    cargo.toTileKey = nextKey;
    cargo.fromPosition = cargo.position.clone();
    cargo.toPosition = this._getConveyorPuzzleTilePosition(puzzle, nextKey);
    cargo.moveProgress = 0;
    cargo.moving = true;
  }

  _getConveyorPuzzleCurrentDirection(puzzle) {
    const currentKey = puzzle.cargo?.currentTileKey;
    if (currentKey === puzzle.spawner.key) {
      return puzzle.spawner.launchDirection;
    }

    const belt = puzzle.beltByKey?.get(currentKey);
    if (!belt) {
      return null;
    }

    const junction = puzzle.junctionByBeltId?.get(belt.id);
    if (junction?.states?.length) {
      const stateIndex = THREE.MathUtils.clamp(junction.stateIndex ?? 0, 0, junction.states.length - 1);
      return junction.states[stateIndex]?.direction ?? belt.defaultDirection;
    }

    return belt.currentDirection ?? belt.defaultDirection;
  }

  _getConveyorPuzzleTilePosition(puzzle, key) {
    if (key === puzzle.spawner.key) {
      return puzzle.spawner.position.clone();
    }
    if (key === puzzle.target.key) {
      return puzzle.target.position.clone();
    }

    const { x, z } = this._parseTileKey(key);
    return this.tileToWorld(x, z, new THREE.Vector3());
  }

  _parseTileKey(key) {
    const [xText, zText] = String(key).split(',');
    return {
      x: Number(xText),
      z: Number(zText),
    };
  }

  _completeConveyorPuzzle(puzzle) {
    if (puzzle.completed) {
      return;
    }

    puzzle.completed = true;
    puzzle.state = 'VaultOpened';

    const cargo = puzzle.cargo;
    if (cargo) {
      cargo.currentTileKey = puzzle.target.key;
      cargo.moving = false;
      cargo.accepted = true;
      cargo.position.copy(puzzle.target.position);
      cargo.position.y = this.getFloorElevationAt(cargo.position);
      cargo.object?.position.copy(cargo.position);
    }

    const plate = this.pressurePlates.find((candidate) => candidate.id === puzzle.targetPressurePlateId);
    if (plate) {
      plate.active = true;
      plate.activated = true;
      this.game.addParticleBurst(plate.position, MECHANISM_COLOR, 24, 0.16);
    }

    const targetDoor = this.doors.find((door) => door.id === puzzle.targetDoorId);
    if (targetDoor?.closed) {
      this._openDoor(targetDoor, 'Cargo receiver powered: bonus vault unlocked');
    } else {
      this.game.ui?.showToast?.('Cargo receiver powered.', '#6bdcff');
    }
  }

  _updatePressurePlates(dt) {
    for (const plate of this.pressurePlates) {
      const occupied = this._isPressurePlateOccupied(plate);
      const powered = this._isPressurePlatePowered(plate);
      plate.active = occupied;

      if (powered && !plate.activated) {
        plate.activated = true;
        this.game.addParticleBurst(plate.position, MECHANISM_COLOR, 24, 0.16);

        const targetDoor = this.doors.find((door) => door.id === plate.targetDoorId);
        if (targetDoor?.closed) {
          this._openDoor(targetDoor, `${plate.label} powered: ${targetDoor.label} opened`);
        } else {
          this.game.ui?.showToast?.(`${plate.label} powered`, '#6bdcff');
        }
      }

      this._updatePressurePlateVisual(plate, dt);
    }
  }

  _isPressurePlateOccupied(plate) {
    if (!plate) {
      return false;
    }

    const radius = plate.radius ?? 0.9;
    const radiusSq = radius * radius;

    tempVectorA.copy(this.game.player.root.position);
    tempVectorA.y = plate.position.y;
    if (tempVectorA.distanceToSquared(plate.position) <= radiusSq) {
      return true;
    }

    for (const block of this.puzzleBlocks) {
      if (block.locked) {
        continue;
      }

      tempVectorA.copy(block.position);
      tempVectorA.y = plate.position.y;
      const blockRadius = radius + (block.radius ?? 0.58) * 0.35;
      if (tempVectorA.distanceToSquared(plate.position) <= blockRadius * blockRadius) {
        return true;
      }
    }

    for (const puzzle of this.conveyorPuzzles) {
      if (plate.requiredPuzzleObjectId && puzzle.cargo?.id !== plate.requiredPuzzleObjectId) {
        continue;
      }

      const cargo = puzzle.cargo;
      if (!cargo) {
        continue;
      }

      tempVectorA.copy(cargo.position);
      tempVectorA.y = plate.position.y;
      if (tempVectorA.distanceToSquared(plate.position) <= radiusSq) {
        return true;
      }
    }

    for (const enemy of this.game.enemies) {
      if (enemy.dead) {
        continue;
      }

      tempVectorA.copy(enemy.root.position);
      tempVectorA.y = plate.position.y;
      if (tempVectorA.distanceToSquared(plate.position) <= radiusSq) {
        return true;
      }
    }

    return false;
  }

  _isPressurePlatePowered(plate) {
    if (!plate) {
      return false;
    }

    if (!plate.requiredBlockId) {
      if (plate.requiredPuzzleObjectId) {
        const puzzle = this.conveyorPuzzles.find((candidate) => (
          candidate.cargo?.id === plate.requiredPuzzleObjectId
        ));
        return Boolean(
          puzzle?.completed
          || (
            puzzle?.cargo
            && puzzle.cargo.currentTileKey === puzzle.target?.key
          ),
        );
      }

      return this._isPressurePlateOccupied(plate);
    }

    const block = this.puzzleBlocks.find((candidate) => candidate.id === plate.requiredBlockId);
    if (!block || block.locked) {
      return false;
    }

    tempVectorA.copy(block.position);
    tempVectorA.y = plate.position.y;
    const radius = (plate.radius ?? 0.9) + (block.radius ?? 0.58) * 0.35;
    return tempVectorA.distanceToSquared(plate.position) <= radius * radius;
  }

  _updatePressurePlateVisual(plate, dt) {
    const object = plate.object;
    if (!object) {
      return;
    }

    const energized = plate.activated || plate.active;
    const base = object.getObjectByName?.('pressurePlateBase');
    const ring = object.getObjectByName?.('pressurePlatePowerRing');
    const glyph = object.getObjectByName?.('pressurePlatePowerGlyph');
    const alpha = Math.min(1, dt * 8);

    if (base) {
      base.scale.y = THREE.MathUtils.lerp(base.scale.y, energized ? 0.72 : 1, alpha);
    }

    if (ring?.material) {
      ring.material.opacity = THREE.MathUtils.lerp(
        ring.material.opacity ?? 0.32,
        plate.activated ? 0.56 : plate.active ? 0.44 : 0.24,
        alpha,
      );
    }

    if (glyph) {
      glyph.rotation.y += dt * (energized ? 1.6 : 0.45);
      glyph.position.y = THREE.MathUtils.lerp(glyph.position.y, energized ? 0.12 : 0.15, alpha);
      if (glyph.material?.emissive) {
        glyph.material.emissiveIntensity = THREE.MathUtils.lerp(
          glyph.material.emissiveIntensity ?? 0.8,
          energized ? 1.1 : 0.42,
          alpha,
        );
      }
    }
  }

  _updateDoorVisuals(dt) {
    for (const door of this.doors) {
      if (!door.object) {
        continue;
      }

      const baseY = door.baseY ?? 0;
      const alpha = Math.min(1, dt * 8);
      if (door.leftPanel && door.rightPanel && door.slidingAxis) {
        door.object.position.y = THREE.MathUtils.lerp(door.object.position.y, baseY, alpha);
        const openOffset = door.closed ? 0 : (door.slidingOpenOffset ?? this.tileSize * 0.42);
        const axis = door.slidingAxis;
        door.leftPanel.position[axis] = THREE.MathUtils.lerp(
          door.leftPanel.position[axis],
          (door.leftPanelClosedOffset ?? -this.tileSize * 0.24) - openOffset,
          alpha,
        );
        door.rightPanel.position[axis] = THREE.MathUtils.lerp(
          door.rightPanel.position[axis],
          (door.rightPanelClosedOffset ?? this.tileSize * 0.24) + openOffset,
          alpha,
        );
      } else {
        const targetY = baseY + (door.closed ? 0 : DOOR_OPEN_Y);
        door.object.position.y = THREE.MathUtils.lerp(door.object.position.y, targetY, alpha);
      }

      if (door.light?.material?.emissive) {
        const pressureReady = door.pressurePlateId && this._isPressurePlateActivated(door.pressurePlateId);
        const ready = !door.locked
          || pressureReady
          || (door.requiresKeycard && this.progressionManager.hasKeycard(door.requiredKeycardId));
        door.light.material.emissiveIntensity = ready ? 0.95 : 0.36;
      }
    }
  }

  _updateMechanismVisuals(dt) {
    for (const mechanism of this.mechanisms) {
      const core = mechanism.object?.getObjectByName?.('mechanismTerminalCore');
      const screen = mechanism.object?.getObjectByName?.('mechanismTerminalScreen');
      const blockedEncounter = this._getMechanismBlockingEncounter(mechanism);

      if (core) {
        core.rotation.y += dt * (mechanism.activated ? 2.8 : blockedEncounter ? 0.45 : 1.2);
        core.position.y = 1.08 + Math.sin(this.game.elapsedTime * 3.5) * 0.04;
      }

      if (screen?.material?.emissive) {
        screen.material.emissiveIntensity = mechanism.activated
          ? 0.28
          : blockedEncounter
            ? 0.42
            : 1.05;
      }
    }
  }

  _updateExtractionVisuals(dt) {
    const pad = this.shrine?.object?.getObjectByName?.('largeRefractorExtractionPad');
    if (!pad?.visible) {
      return;
    }

    const ring = pad.getObjectByName('largeRefractorExtractionPadRing');
    const core = pad.getObjectByName('largeRefractorExtractionPadCore');
    pad.rotation.y += dt * 0.9;

    if (ring?.material) {
      ring.material.opacity = 0.28 + Math.sin(this.game.elapsedTime * 5.4) * 0.08;
    }

    if (core?.material?.emissive) {
      core.material.emissiveIntensity = 0.85 + Math.sin(this.game.elapsedTime * 6.2) * 0.18;
    }
  }

  _setExtractionPadVisible(visible) {
    const pad = this.shrine?.object?.getObjectByName?.('largeRefractorExtractionPad');
    if (pad) {
      pad.visible = visible;
    }
  }

  _updateNearestInteractable() {
    const playerPosition = this.game.player.root.position;
    let nearest = null;
    let nearestDistanceSq = Infinity;

    for (const door of this.doors) {
      if (!door.closed) {
        continue;
      }

      const distanceSq = playerPosition.distanceToSquared(door.position);
      if (distanceSq <= 2.45 * 2.45 && distanceSq < nearestDistanceSq) {
        const encounter = door.encounterId
          ? this.encounters.find((candidate) => candidate.id === door.encounterId)
          : null;
        const pressureReady = door.pressurePlateId && this._isPressurePlateActivated(door.pressurePlateId);
        const needsKeycard = door.requiresKeycard && !pressureReady;
        const needsPressurePlate = door.pressurePlateId && !pressureReady && !door.requiresKeycard;
        const hasRequiredKeycard = needsKeycard && this.progressionManager.hasKeycard(door.requiredKeycardId);
        const requiredName = this.progressionManager.getKeycardDisplayName(door.requiredKeycardId);
        nearest = {
          kind: 'door',
          target: door,
          label: encounter && !encounter.cleared
            ? `${door.label}: Clear Reaverbots`
            : needsPressurePlate
              ? `${door.label}: Receiver Plate`
            : needsKeycard
              ? hasRequiredKeycard
                ? `${door.label}: ${requiredName}`
                : `${door.label}: Requires ${requiredName}`
              : door.label,
          color: (needsKeycard && !hasRequiredKeycard) || needsPressurePlate || (encounter && !encounter.cleared)
            ? LOCKED_COLOR
            : needsKeycard
              ? TRACKING_COLOR
              : MECHANISM_COLOR,
        };
        nearestDistanceSq = distanceSq;
      }
    }

    for (const mechanism of this.mechanisms) {
      if (mechanism.activated && !mechanism.repeatable) {
        continue;
      }

      const distanceSq = playerPosition.distanceToSquared(mechanism.position);
      if (distanceSq <= 2.1 * 2.1 && distanceSq < nearestDistanceSq) {
        const blockedEncounter = this._getMechanismBlockingEncounter(mechanism);
        nearest = {
          kind: 'mechanism',
          target: mechanism,
          label: mechanism.conveyorPuzzleAction && !blockedEncounter
            ? this._getConveyorPuzzleMechanismPrompt(mechanism)
            : blockedEncounter
            ? `${mechanism.label}: Clear ${blockedEncounter.label}`
            : mechanism.label,
          color: blockedEncounter ? LOCKED_COLOR : MECHANISM_COLOR,
        };
        nearestDistanceSq = distanceSq;
      }
    }

    for (const trap of this.traps) {
      if (!trap.active) {
        continue;
      }

      const distanceSq = playerPosition.distanceToSquared(trap.position);
      if (distanceSq <= 3.1 * 3.1 && distanceSq < nearestDistanceSq) {
        nearest = {
          kind: 'trap',
          target: trap,
          label: this.keycardCount > 0 ? `${trap.label}: Scan` : `${trap.label}: Keycard Scan`,
          color: this.keycardCount > 0 ? KEYCARD_COLOR : LOCKED_COLOR,
        };
        nearestDistanceSq = distanceSq;
      }
    }

    for (const chest of this.chests) {
      if (chest.opened) {
        continue;
      }

      const distanceSq = playerPosition.distanceToSquared(chest.position);
      if (distanceSq <= 2.05 * 2.05 && distanceSq < nearestDistanceSq) {
        nearest = {
          kind: 'chest',
          target: chest,
          label: chest.guaranteedKeycardId ? 'Open Keycard Chest' : 'Open Ruin Chest',
          color: chest.guaranteedKeycardId ? KEY_SEEKER_COLOR : KEYCARD_COLOR,
        };
        nearestDistanceSq = distanceSq;
      }
    }

    if (this.keySeeker && !this.keySeeker.activated) {
      const distanceSq = playerPosition.distanceToSquared(this.keySeeker.position);
      if (distanceSq <= 2.1 * 2.1 && distanceSq < nearestDistanceSq) {
        nearest = {
          kind: 'keySeeker',
          target: this.keySeeker,
          label: 'Activate Key Seeker',
          color: KEY_SEEKER_COLOR,
        };
        nearestDistanceSq = distanceSq;
      }
    }

    for (const safeInteractable of this.safeInteractables) {
      const distanceSq = playerPosition.distanceToSquared(safeInteractable.position);
      const interactionRadius = Number.isFinite(safeInteractable.interactionRadius)
        ? Math.max(0, safeInteractable.interactionRadius)
        : 2.0;
      if (distanceSq <= interactionRadius * interactionRadius && distanceSq < nearestDistanceSq) {
        nearest = {
          kind: 'safe',
          target: safeInteractable,
          label: this._getSafeInteractablePrompt(safeInteractable),
          color: safeInteractable.color,
        };
        nearestDistanceSq = distanceSq;
      }
    }

    if (this.shrine && !this.shrine.collected) {
      const distanceSq = playerPosition.distanceToSquared(this.shrine.position);
      const shrineDoor = this.doors.find((door) => door.id === 'Door_Shrine');
      if (distanceSq <= 2.8 * 2.8 && distanceSq < nearestDistanceSq && !shrineDoor?.closed) {
        nearest = {
          kind: 'shrine',
          target: this.shrine,
          label: 'Large Refractor',
          color: SHRINE_COLOR,
        };
      }
    }

    if (this.shrine?.collected && this.game.ruinCompleted) {
      const distanceSq = playerPosition.distanceToSquared(this.shrine.position);
      if (distanceSq <= 3.0 * 3.0 && distanceSq < nearestDistanceSq) {
        nearest = {
          kind: 'extraction',
          target: this.shrine,
          label: 'Return to Camp',
          color: MECHANISM_COLOR,
        };
        nearestDistanceSq = distanceSq;
      }
    }

    this.nearestInteractable = nearest;
  }

  _getConveyorPuzzleMechanismPrompt(mechanism) {
    const puzzle = this.conveyorPuzzleById.get(mechanism.conveyorPuzzleId);
    if (!puzzle) {
      return mechanism.label;
    }

    if (puzzle.completed || puzzle.state === 'VaultOpened') {
      return `${mechanism.label}: Complete`;
    }

    if (mechanism.conveyorPuzzleAction === 'cycleJunction') {
      const junctionId = mechanism.controlledJunctionIds?.[0] ?? puzzle.junctions?.[0]?.id;
      const junction = puzzle.junctionById?.get(junctionId);
      const state = junction?.states?.[junction.stateIndex ?? 0];
      return `${mechanism.label}: ${state?.label ?? 'Switch Route'}`;
    }

    if (mechanism.conveyorPuzzleAction === 'launchOrReset') {
      return puzzle.state === 'ObjectMoving' || puzzle.state === 'ObjectBlocked'
        ? `${mechanism.label}: Reset Cargo`
        : `${mechanism.label}: Release Cargo`;
    }

    return mechanism.label;
  }

  _getSafeInteractablePrompt(interactable) {
    if (interactable.action === 'roll') {
      if (this.game.ruinCompleted) return `${interactable.label}: Debrief`;
      if (!this.game.expeditionAccepted) return `${interactable.label}: Expedition Briefing`;
      const unidentified = Math.max(0, Math.trunc(this.game.inventory?.unidentifiedScrap) || 0);
      return unidentified > 0
        ? `${interactable.label}: Identify ${unidentified} Scrap`
        : `${interactable.label}: Workshop`;
    }

    if (interactable.action === 'resetRuin') {
      return this.game.ruinCompleted
        ? `${interactable.label}: Shift Ruin`
        : `${interactable.label}: ${this.game.getRuinResetCost?.() ?? 0}z`;
    }

    if (interactable.action === 'expedition') {
      return this.game.ruinCompleted
        ? `${interactable.label}: Debrief`
        : this.game.expeditionAccepted
          ? `${interactable.label}: Briefed`
        : `${interactable.label}: Large Refractor`;
    }

    if (interactable.action === 'enterRuin') {
      return this.game.ruinCompleted
        ? `${interactable.label}: Complete`
        : `${interactable.label}: Descend`;
    }

    return interactable.label;
  }

  _activateDoor(door) {
    if (door.encounterId) {
      const encounter = this.encounters.find((candidate) => candidate.id === door.encounterId);
      if (encounter && !encounter.cleared) {
        this.game.ui?.showToast?.('Defeat the Reaverbots to unlock this gate', '#ffb347');
        this._pulseDoor(door, LOCKED_COLOR);
        return;
      }
    }

    const pressureReady = door.pressurePlateId && this._isPressurePlateActivated(door.pressurePlateId);

    if (door.pressurePlateId && !pressureReady && !door.requiresKeycard) {
      this.game.ui?.showToast?.('Route the cargo object to the receiver plate.', '#ffb347');
      this._pulseDoor(door, LOCKED_COLOR);
      return;
    }

    if (door.requiresKeycard && !this.progressionManager.hasKeycard(door.requiredKeycardId) && !pressureReady) {
      const requiredName = this.progressionManager.getKeycardDisplayName(door.requiredKeycardId);
      const keySeekerHint = this.keySeeker?.activated && !door.isShrineDoor
        ? ' Search for keycard signals on your minimap.'
        : '';
      this.game.ui?.showToast?.(
        door.isShrineDoor
          ? 'Shrine sealed. Requires Shrine Key.'
          : `Locked. Requires ${requiredName}.${keySeekerHint}`,
        '#ffb347',
      );
      this._pulseDoor(door, LOCKED_COLOR);
      return;
    }

    if (door.mechanismId && !this._isMechanismActivated(door.mechanismId)) {
      this.game.ui?.showToast?.('Find the override console', '#6bdcff');
      this._pulseDoor(door, MECHANISM_COLOR);
      return;
    }

    if (door.requiresKeycard && !pressureReady) {
      const requiredName = this.progressionManager.getKeycardDisplayName(door.requiredKeycardId);
      this._openDoor(door, door.isShrineDoor ? 'Shrine access granted.' : `${door.label} unlocked with ${requiredName}.`);
      return;
    }

    this._openDoor(door, pressureReady ? 'Pressure plate route unlocked' : 'Door opened');
  }

  _activateMechanism(mechanism) {
    if (mechanism.conveyorPuzzleAction) {
      this._activateConveyorPuzzleMechanism(mechanism);
      return;
    }

    const blockedEncounter = this._getMechanismBlockingEncounter(mechanism);
    if (blockedEncounter) {
      this.game.ui?.showToast?.(`Clear ${blockedEncounter.label} before using this console`, '#ffb347');
      this.game.addParticleBurst(mechanism.position, LOCKED_COLOR, 12, 0.12);
      return;
    }

    mechanism.activated = true;

    for (const trap of this.traps) {
      trap.active = false;
    }

    for (const conveyor of this.conveyors) {
      conveyor.active = false;
    }

    for (const door of this.doors) {
      if (door.mechanismId === mechanism.id) {
        this._openDoor(door, 'Shrine seal released');
      }
    }

    this.game.addParticleBurst(mechanism.position, MECHANISM_COLOR, 24, 0.18);
    this.game.ui?.showToast?.('Override online: traps and conveyors disabled', '#6bdcff');
  }

  _getMechanismBlockingEncounter(mechanism) {
    if (!mechanism?.requiresEncounterId) {
      return null;
    }

    const encounter = this.encounters.find((candidate) => candidate.id === mechanism.requiresEncounterId);
    return encounter && !encounter.cleared ? encounter : null;
  }

  _activateTrap(trap) {
    if (!trap?.active) {
      return;
    }

    if (this.keycardCount <= 0) {
      this.game.ui?.showToast?.('A collected keycard can scan this trap relay', '#ffd66b');
      this.game.addParticleBurst(trap.position, LOCKED_COLOR, 10, 0.1);
      return;
    }

    trap.active = false;
    this.game.addParticleBurst(trap.position, KEYCARD_COLOR, 24, 0.16);
    this.game.ui?.showToast?.('Keycard scan accepted: trap disabled', '#ffd66b');
  }

  _activateChest(chest) {
    if (!chest || chest.opened) {
      return;
    }

    chest.opened = true;
    chest.object.userData.opened = true;

    this.game.refractors?.rollChestDrop?.(chest.position, {
      count: chest.rareBoost ? 5 : 4,
      bonusValue: chest.rareBoost ? 4 : 1,
      rareBoost: chest.rareBoost,
    });

    let keycardCollected = false;
    if (chest.guaranteedKeycardId && !chest.keycardClaimed) {
      const keycardPosition = chest.position.clone();
      keycardPosition.y = this.getFloorElevationAt(keycardPosition);
      keycardPosition.x += 0.45;
      keycardPosition.z += 0.28;
      keycardCollected = this._grantKeycard(chest.guaranteedKeycardId, {
        position: keycardPosition,
        source: 'Chest',
      });
      chest.keycardClaimed = true;
      chest.containsKeycard = false;
    }

    this.game.addParticleBurst(chest.position, keycardCollected ? KEY_SEEKER_COLOR : KEYCARD_COLOR, keycardCollected ? 28 : 18, 0.16);
    if (!keycardCollected) {
      this.game.ui?.showToast?.('Ruin chest opened: refractors', '#ffd66b');
    }
  }

  _updateEncounters() {
    for (const encounter of this.encounters) {
      if (!encounter.spawned || encounter.cleared) {
        continue;
      }

      const remaining = this.game.enemies.some((enemy) => (
        encounter.enemyIds.includes(enemy.id)
        && !enemy.dead
      ));

      if (remaining) {
        continue;
      }

      encounter.cleared = true;
      this.game.ui?.showToast?.(`${encounter.label} cleared`, '#6bdcff');

      if (encounter.bossRewardKeycardId) {
        this._grantKeycard(encounter.bossRewardKeycardId, {
          position: encounter.zone.position,
          source: 'BossReward',
        });
      }

      if (
        encounter.keycardDropId
        && !this.progressionManager.hasKeycard(encounter.keycardDropId)
        && !this.keycards.some((keycard) => keycard.keycardId === encounter.keycardDropId && !keycard.collected)
      ) {
        const fallback = encounter.zone.position.clone();
        fallback.y = this.getFloorElevationAt(fallback);
        this._spawnKeycardAt(fallback, 'eliteFallbackKeycard', encounter.keycardDropId);
      }

      for (const door of this.doors) {
        if (door.encounterId === encounter.id) {
          this._openDoor(door, `${door.label} unlocked`);
        }
      }
    }
  }

  _updateChestVisuals(dt) {
    for (const chest of this.chests) {
      const lid = chest.object?.getObjectByName?.('ruinChestLid');
      const trim = chest.object?.getObjectByName?.('ruinChestTrim');
      const lock = chest.object?.getObjectByName?.('ruinChestLock');
      const glow = chest.object?.getObjectByName?.('ruinChestGlow');

      if (lid) {
        const targetX = chest.opened ? 0.92 : 0;
        lid.rotation.x = THREE.MathUtils.lerp(lid.rotation.x, targetX, Math.min(1, dt * 8));
        lid.position.y = THREE.MathUtils.lerp(lid.position.y, chest.opened ? 0.72 : 0.58, Math.min(1, dt * 8));
      }

      if (trim) {
        trim.visible = !chest.opened;
      }

      if (lock) {
        lock.visible = !chest.opened;
      }

      if (glow?.material) {
        glow.material.opacity = chest.opened
          ? THREE.MathUtils.lerp(glow.material.opacity, 0, Math.min(1, dt * 5))
          : 0.15 + Math.sin(this.game.elapsedTime * 4.2) * 0.04;
      }
    }
  }

  _activateShrine() {
    if (!this.shrine || this.shrine.collected) {
      return;
    }

    this.shrine.collected = true;
    const refractor = this.shrine.object?.getObjectByName?.('largeRefractorObjective');
    if (refractor) {
      refractor.visible = false;
    }
    this._setExtractionPadVisible(true);

    this.game.completeRuinObjective?.({
      reward: 650,
      position: this.shrine.position,
    });
  }

  _activateExtraction() {
    if (!this.game.ruinCompleted) {
      return;
    }

    this.game.addParticleBurst(this.shrine.position, MECHANISM_COLOR, 20, 0.16);
    this.game.extractToCamp?.();
  }

  _activateSafeInteractable(interactable) {
    if (!interactable) {
      return;
    }

    if (interactable.action === 'garage') {
      this.game.setInventoryOpen?.(true);
      return;
    }

    if (interactable.action === 'roll') {
      const animator = interactable.object?.userData?.rollAnimator;
      if (animator) {
        animator.noteInteraction();
      } else if (interactable.object?.userData) {
        interactable.object.userData.pendingInteractionAnimation = true;
      }

      if (this.game.ruinCompleted) {
        this.game.offerRuinReset?.();
      } else if (!this.game.expeditionAccepted) {
        this.game.beginExpedition?.({ position: interactable.position });
      } else {
        this.game.setInventoryOpen?.(true, { mode: 'roll' });
        this.game.ui?.showToast?.('Roll: workshop and salvage analysis ready', '#6bdcff');
      }
      this.game.addParticleBurst(interactable.position, interactable.color ?? MECHANISM_COLOR, 10, 0.1);
      return;
    }

    if (interactable.action === 'expedition') {
      if (this.game.ruinCompleted) {
        this.game.offerRuinReset?.();
        return;
      }

      this.game.beginExpedition?.({
        position: interactable.position,
      });
      return;
    }

    if (interactable.action === 'enterRuin') {
      this.game.enterRuinFromCamp?.();
      return;
    }

    if (interactable.action === 'resetRuin') {
      this.game.offerRuinReset?.();
      return;
    }

    if (interactable.action === 'mechanic') {
      this.game.ui?.showToast?.('Mechanic: garage systems online', '#6bdcff');
      this.game.addParticleBurst(interactable.position, interactable.color ?? MECHANISM_COLOR, 10, 0.1);
    }
  }

  updateNpcVisuals(dt, { allowAmbient = true } = {}) {
    const playerPosition = this.game?.player?.root?.position;
    const animatedMixers = new Set();

    for (const animator of this.npcAnimators) {
      if (!animator || animator.disposed) continue;
      animatedMixers.add(animator.mixer);

      let allowAnimatorAmbient = allowAmbient;
      if (animator.anchor?.name === 'rollCaskettNpc') {
        const rollPosition = this.rollInteractable?.position;
        allowAnimatorAmbient = Boolean(
          allowAmbient
          && playerPosition
          && rollPosition
          && playerPosition.distanceToSquared(rollPosition) <= 12 * 12
        );
      }

      animator.update(dt, { allowAmbient: allowAnimatorAmbient });
    }

    // Preserve support for any legacy NPC mixer that has not adopted the
    // higher-level animator contract yet.
    for (const mixer of this.npcAnimationMixers) {
      if (!animatedMixers.has(mixer)) mixer.update(dt);
    }
  }

  _openDoor(door, message) {
    const topologyChanged = door.closed === true;
    door.closed = false;
    door.locked = false;
    door.opened = true;
    if (topologyChanged) {
      this.invalidateNavigationTopology();
    }
    const progressionDoor = this.progressionManager.getDoor(door.id);
    if (progressionDoor) {
      progressionDoor.isUnlocked = true;
    }
    this._pulseDoor(door, MECHANISM_COLOR);
    this.game.ui?.showToast?.(message, '#6bdcff');
    this.lastSafePlayerPosition.copy(this.game.player.root.position);
  }

  _pulseDoor(door, color) {
    tempVectorB.copy(door.position);
    tempVectorB.y = (door.baseY ?? 0) + 0.9;
    this.game.addParticleBurst(tempVectorB, color, 16, 0.12);
  }

  _bindConveyorVisuals() {
    if (!this.dungeon?.group) {
      return;
    }

    for (const conveyor of this.conveyors) {
      conveyor.visuals = [];
    }

    this.dungeon.group.traverse((object) => {
      if (object.name !== 'conveyorDirectionArrow') {
        return;
      }

      const conveyor = this.conveyors.find((candidate) => isInsideZone(object.position, candidate));
      if (!conveyor) {
        return;
      }

      if (object.material) {
        object.material = object.material.clone();
        object.material.transparent = true;
      }
      const directionX = conveyor.direction.x;
      const directionZ = conveyor.direction.z;
      const offsetX = object.position.x - conveyor.position.x;
      const offsetZ = object.position.z - conveyor.position.z;
      object.userData.baseY = object.position.y;
      object.userData.baseScale = object.scale.x || 1;
      object.userData.conveyorOffsetIndex = THREE.MathUtils.clamp(
        Math.round((offsetX * directionX + offsetZ * directionZ) / 0.52),
        -1,
        1,
      );
      conveyor.visuals.push(object);
    });
  }

  _updateConveyorVisuals(conveyor, dt) {
    if (!conveyor.visuals?.length) {
      return;
    }

    for (const arrow of conveyor.visuals) {
      const offsetIndex = arrow.userData.conveyorOffsetIndex ?? 0;
      arrow.position.x = conveyor.position.x + conveyor.direction.x * offsetIndex * 0.52;
      arrow.position.z = conveyor.position.z + conveyor.direction.z * offsetIndex * 0.52;
      arrow.position.y = (arrow.userData.baseY ?? 0.04) + Math.sin(this.game.elapsedTime * 6 + arrow.position.z) * 0.015;
      arrow.rotation.z = Math.PI + Math.atan2(conveyor.direction.x, conveyor.direction.z);
      const targetScale = conveyor.active
        ? (arrow.userData.baseScale ?? 1) * (1 + Math.sin(this.game.elapsedTime * 7 + arrow.position.z) * 0.07)
        : (arrow.userData.baseScale ?? 1) * 0.82;
      arrow.scale.lerp(tempVectorA.set(targetScale, targetScale, targetScale), Math.min(1, dt * 8));

      if (arrow.material) {
        arrow.material.opacity = THREE.MathUtils.lerp(
          arrow.material.opacity ?? 1,
          conveyor.active ? 1 : 0.28,
          Math.min(1, dt * 6),
        );

        if (arrow.material.emissive) {
          arrow.material.emissiveIntensity = THREE.MathUtils.lerp(
            arrow.material.emissiveIntensity ?? 1,
            conveyor.active ? 1.1 : 0.16,
            Math.min(1, dt * 6),
          );
        }
      }
    }
  }

  _isMechanismActivated(id) {
    return this.mechanisms.some((mechanism) => mechanism.id === id && mechanism.activated);
  }

  _isPressurePlateActivated(id) {
    return this.pressurePlates.some((plate) => plate.id === id && plate.activated);
  }

  _findNearestWalkablePosition(position) {
    let nearest = null;
    let nearestDistanceSq = Infinity;

    for (const tile of this.floorTiles) {
      tempVectorA.set(
        tile.x * this.tileSize,
        tile.elevation ?? 0,
        tile.z * this.tileSize,
      );
      const distanceSq = tempVectorA.distanceToSquared(position);
      if (distanceSq < nearestDistanceSq && this.isPositionWalkable(tempVectorA)) {
        nearestDistanceSq = distanceSq;
        nearest = tempVectorA.clone();
      }
    }

    return nearest ?? this.dungeon.playerStart?.clone?.() ?? new THREE.Vector3();
  }

  _findTilePath(start, goal) {
    if (!this._isTileWalkable(start.x, start.z) || !this._isTileWalkable(goal.x, goal.z)) {
      return null;
    }

    const startKey = tileKey(start.x, start.z);
    const goalKey = tileKey(goal.x, goal.z);
    const queue = [start];
    const cameFrom = new Map([[startKey, null]]);

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      const currentKey = tileKey(current.x, current.z);

      if (currentKey === goalKey) {
        return this._reconstructPath(cameFrom, current);
      }

      for (const [dx, dz] of CARDINAL_NEIGHBORS) {
        const next = { x: current.x + dx, z: current.z + dz };
        const nextKey = tileKey(next.x, next.z);

        if (cameFrom.has(nextKey) || !this._isTileWalkable(next.x, next.z)) {
          continue;
        }

        cameFrom.set(nextKey, current);
        queue.push(next);
      }
    }

    return null;
  }

  _reconstructPath(cameFrom, end) {
    const path = [end];
    let current = end;

    while (current) {
      const previous = cameFrom.get(tileKey(current.x, current.z));
      if (!previous) {
        break;
      }

      path.push(previous);
      current = previous;
    }

    path.reverse();
    return path;
  }

  _isTileWalkable(x, z) {
    if (!this.tiles.has(tileKey(x, z))) {
      return false;
    }

    this.tileToWorld(x, z, tempVectorC);
    for (const door of this.doors) {
      if (!door.closed) {
        continue;
      }

      if (this._isPositionInsideClosedDoor(tempVectorC, door)) {
        return false;
      }
    }

    if (this._isPositionInsideSolidZone(tempVectorC)) {
      return false;
    }

    return true;
  }
}

export default DungeonController;
