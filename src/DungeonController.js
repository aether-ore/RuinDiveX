import * as THREE from 'three';
import {
  DungeonProgressionManager,
  SHRINE_KEY_ID,
} from './DungeonProgression.js';

const KEYCARD_COLOR = 0xffd66b;
const MECHANISM_COLOR = 0x6bdcff;
const SHRINE_COLOR = 0x7df8ff;
const LOCKED_COLOR = 0xffb347;
const KEY_SEEKER_COLOR = 0x5ee77b;
const TRACKING_COLOR = 0xa06cff;
const DOOR_OPEN_Y = -5.3;
const CARDINAL_NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const tempVectorA = new THREE.Vector3();
const tempVectorB = new THREE.Vector3();
const tempVectorC = new THREE.Vector3();

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
    this.safeInteractables = dungeon?.safeInteractables ?? [];
    this.safeZones = dungeon?.safeZones ?? [];
    this.solidZones = dungeon?.solidZones ?? [];
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
    this.nearestInteractable = null;
    this.lastSafePlayerPosition = new THREE.Vector3();
    this.lastSafeEnemyPositions = new Map();
    this.navigationCache = new Map();
    this.trapPulseTimer = 0;

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

    this._constrainPlayerToWalkable();
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
    this.navigationCache.clear();
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
    const floorTile = this.getFloorTileAt(position);
    if (!floorTile) {
      return false;
    }

    for (const door of this.doors) {
      if (!door.closed) {
        continue;
      }

      if (position.distanceToSquared(door.position) <= door.radius * door.radius) {
        return false;
      }
    }

    if (this._isPositionInsideSolidZone(position)) {
      return false;
    }

    return true;
  }

  _isPositionInsideSolidZone(position) {
    return this.solidZones.some((zone) => isInsideZone(position, zone));
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
      && isInsideZone(position, encounter.zone)
    )) ?? null;
  }

  markEncounterSpawned(encounterId, enemies = []) {
    const encounter = this.encounters.find((candidate) => candidate.id === encounterId);
    if (!encounter || encounter.spawned) {
      return;
    }

    encounter.spawned = true;
    encounter.enemyIds = enemies.map((enemy) => enemy.id);
    this.game.ui?.showToast?.(`${encounter.label} active`, '#ffb347');
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

  getFloorTileAt(position, { maxVerticalGap = 1.45, allowClosest = false } = {}) {
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
    const tile = this.getFloorTileAt(position, { allowClosest: true });
    return tile ? this._getTileElevationAtPosition(tile, position) : 0;
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
    return this.game.player?.animation?.isFullBodyActionActive?.() === true;
  }

  _syncPositionToFloor(position, { preservePlayerAction = false } = {}) {
    if (preservePlayerAction && this._isPlayerPreservingVerticalMotion()) {
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

    const start = this.worldToTile(fromPosition);
    const goal = this.worldToTile(targetPosition);
    const startKey = tileKey(start.x, start.z);
    const goalKey = tileKey(goal.x, goal.z);

    if (startKey === goalKey) {
      tempVectorC.copy(targetPosition).sub(fromPosition);
      tempVectorC.y = 0;
      return tempVectorC.lengthSq() > 0.0001 ? tempVectorC.normalize().clone() : null;
    }

    const cacheKey = `${startKey}>${goalKey}`;
    if (this.navigationCache.has(cacheKey)) {
      const cached = this.navigationCache.get(cacheKey);
      return cached ? cached.clone() : null;
    }

    const path = this._findTilePath(start, goal);
    if (!path || path.length < 2) {
      this.navigationCache.set(cacheKey, null);
      return null;
    }

    const next = path[1];
    const nextCenter = this.tileToWorld(next.x, next.z, tempVectorA);
    const direction = nextCenter.sub(fromPosition);
    direction.y = 0;

    if (direction.lengthSq() <= 0.0001) {
      this.navigationCache.set(cacheKey, null);
      return null;
    }

    direction.normalize();
    this.navigationCache.set(cacheKey, direction.clone());
    return direction.clone();
  }

  constrainEnemies() {
    const liveEnemyIds = new Set();

    for (const enemy of this.game.enemies) {
      if (enemy.dead) {
        continue;
      }

      liveEnemyIds.add(enemy.id);
      const position = enemy.root.position;

      if (this.isPositionWalkable(position)) {
        this._syncPositionToFloor(position);
        this.lastSafeEnemyPositions.set(enemy.id, position.clone());
        continue;
      }

      const fallback = this.lastSafeEnemyPositions.get(enemy.id);
      if (fallback) {
        position.copy(fallback);
        this._syncPositionToFloor(position);
      } else {
        const nearest = this._findNearestWalkablePosition(position);
        position.copy(nearest);
        this._syncPositionToFloor(position);
        this.lastSafeEnemyPositions.set(enemy.id, nearest.clone());
      }
    }

    for (const enemyId of this.lastSafeEnemyPositions.keys()) {
      if (!liveEnemyIds.has(enemyId)) {
        this.lastSafeEnemyPositions.delete(enemyId);
      }
    }
  }

  rollEnemyKeycardDrop(enemy) {
    const keycardId = enemy?.guaranteedKeycardDropId ?? null;
    if (!keycardId || this.progressionManager.hasKeycard(keycardId)) {
      return null;
    }

    const position = enemy.root.position.clone();
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

    this.discoveredRoomIds.add(room.id);

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

    if (this.isPositionWalkable(current)) {
      this._syncPositionToFloor(current, { preservePlayerAction: true });
      this.lastSafePlayerPosition.copy(current);
      return;
    }

    tempVectorA.set(current.x, current.y, this.lastSafePlayerPosition.z);
    if (this.isPositionWalkable(tempVectorA)) {
      current.copy(tempVectorA);
      this._syncPositionToFloor(current, { preservePlayerAction: true });
      this.lastSafePlayerPosition.copy(current);
      return;
    }

    tempVectorA.set(this.lastSafePlayerPosition.x, current.y, current.z);
    if (this.isPositionWalkable(tempVectorA)) {
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
        continue;
      }

      keycard.object.rotation.y += dt * 1.6;
      keycard.object.position.y = keycard.position.y + 0.42 + Math.sin(this.game.elapsedTime * 4.2) * 0.08;

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
      const targetY = baseY + (door.closed ? 0 : DOOR_OPEN_Y);
      door.object.position.y = THREE.MathUtils.lerp(door.object.position.y, targetY, Math.min(1, dt * 8));

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
      if (distanceSq <= 2.0 * 2.0 && distanceSq < nearestDistanceSq) {
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
    if (interactable.action === 'quest') {
      const required = this.game.getScrapQuestRequirement?.() ?? 0;
      const scraps = this.game.inventory?.scraps ?? 0;
      return scraps >= required
        ? `${interactable.label}: Turn In`
        : `${interactable.label}: Scrap ${scraps}/${required}`;
    }

    if (interactable.action === 'research') {
      const required = this.game.getResearchProcessRequirement?.() ?? 0;
      const scraps = this.game.inventory?.scraps ?? 0;
      return scraps >= required
        ? `${interactable.label}: Process`
        : `${interactable.label}: Scrap ${scraps}/${required}`;
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

    if (interactable.action === 'quest') {
      this.game.turnInScrapQuest?.();
      this.game.addParticleBurst(interactable.position, interactable.color ?? KEYCARD_COLOR, 10, 0.1);
      return;
    }

    if (interactable.action === 'research') {
      const processed = this.game.processResearchScraps?.();
      this.game.addParticleBurst(
        interactable.position,
        processed ? interactable.color ?? SHRINE_COLOR : LOCKED_COLOR,
        processed ? 16 : 8,
        0.1,
      );
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

  _openDoor(door, message) {
    door.closed = false;
    door.locked = false;
    door.opened = true;
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

      if (tempVectorC.distanceToSquared(door.position) <= door.radius * door.radius) {
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
