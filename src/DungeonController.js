import * as THREE from 'three';

const KEYCARD_COLOR = 0xffd66b;
const MECHANISM_COLOR = 0x6bdcff;
const SHRINE_COLOR = 0x7df8ff;
const LOCKED_COLOR = 0xffb347;
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
  return Math.abs(position.x - zone.position.x) <= zone.halfWidth
    && Math.abs(position.z - zone.position.z) <= zone.halfDepth;
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
    this.doors = dungeon?.doors ?? [];
    this.keycards = dungeon?.keycards ?? [];
    this.chests = dungeon?.chests ?? [];
    this.mechanisms = dungeon?.mechanisms ?? [];
    this.safeInteractables = dungeon?.safeInteractables ?? [];
    this.safeZones = dungeon?.safeZones ?? [];
    this.encounters = dungeon?.encounters ?? [];
    this.traps = dungeon?.traps ?? [];
    this.conveyors = dungeon?.conveyors ?? [];
    this.shrine = dungeon?.shrine ?? null;
    this.keycardCount = 0;
    this.nearestInteractable = null;
    this.lastSafePlayerPosition = new THREE.Vector3();
    this.lastSafeEnemyPositions = new Map();
    this.navigationCache = new Map();
    this.trapPulseTimer = 0;

    if (game?.player?.root) {
      this.lastSafePlayerPosition.copy(game.player.root.position);
    }

    this._bindConveyorVisuals();
  }

  update(dt) {
    if (!this.game?.player || !this.dungeon) {
      return;
    }

    this._constrainPlayerToWalkable();
    this._updateKeycards(dt);
    this._updateTraps(dt);
    this._updateConveyors(dt);
    this._updateEncounters();
    this._constrainPlayerToWalkable();
    this._updateDoorVisuals(dt);
    this._updateChestVisuals(dt);
    this._updateMechanismVisuals(dt);
    this._updateNearestInteractable();
    this.navigationCache.clear();
  }

  getNearestInteractable() {
    return this.nearestInteractable;
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

    if (interactable.kind === 'chest') {
      this._activateChest(interactable.target);
      return true;
    }

    if (interactable.kind === 'shrine') {
      this._activateShrine();
      return true;
    }

    if (interactable.kind === 'safe') {
      this._activateSafeInteractable(interactable.target);
      return true;
    }

    return false;
  }

  isPositionWalkable(position) {
    const { x: tileX, z: tileZ } = this.worldToTile(position);

    if (!this.tiles.has(tileKey(tileX, tileZ))) {
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

    return true;
  }

  isPositionInSafeZone(position) {
    return this.safeZones.some((zone) => isInsideZone(position, zone));
  }

  isPlayerInSafeZone() {
    return this.isPositionInSafeZone(this.game.player.root.position);
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

  isPositionInSafeZone(position) {
    return this.safeZones.some((zone) => isInsideZone(position, zone));
  }

  isPlayerInSafeZone() {
    return this.isPositionInSafeZone(this.game.player.root.position);
  }

  worldToTile(position) {
    return {
      x: Math.round(position.x / this.tileSize),
      z: Math.round(position.z / this.tileSize),
    };
  }

  tileToWorld(x, z, target = new THREE.Vector3()) {
    return target.set(x * this.tileSize, 0, z * this.tileSize);
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
        this.lastSafeEnemyPositions.set(enemy.id, position.clone());
        continue;
      }

      const fallback = this.lastSafeEnemyPositions.get(enemy.id);
      if (fallback) {
        position.copy(fallback);
      } else {
        const nearest = this._findNearestWalkablePosition(position);
        position.copy(nearest);
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
    const uncollectedKeycardExists = this.keycards.some((keycard) => !keycard.collected);
    const neededForProgress = this.keycardCount <= 0 && !uncollectedKeycardExists;
    const chance = neededForProgress ? 0.32 : enemy?.isElite ? 0.16 : 0.045;

    if (Math.random() > chance) {
      return null;
    }

    const position = enemy.root.position.clone();
    position.y = 0.46;
    position.x += (Math.random() - 0.5) * 0.7;
    position.z += (Math.random() - 0.5) * 0.7;

    return this._spawnKeycardAt(position, 'enemyKeycard');
  }

  _spawnKeycardAt(position, idPrefix = 'ruinKeycard') {
    const object = createDroppedKeycardObject();
    object.position.copy(position);
    this.game.scene.add(object);

    const keycard = {
      id: `${idPrefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      object,
      position: position.clone(),
      collected: false,
    };
    this.keycards.push(keycard);
    return keycard;
  }

  _constrainPlayerToWalkable() {
    const playerRoot = this.game.player.root;
    const current = playerRoot.position;

    if (this.isPositionWalkable(current)) {
      this.lastSafePlayerPosition.copy(current);
      return;
    }

    tempVectorA.set(current.x, current.y, this.lastSafePlayerPosition.z);
    if (this.isPositionWalkable(tempVectorA)) {
      current.copy(tempVectorA);
      this.lastSafePlayerPosition.copy(current);
      return;
    }

    tempVectorA.set(this.lastSafePlayerPosition.x, current.y, current.z);
    if (this.isPositionWalkable(tempVectorA)) {
      current.copy(tempVectorA);
      this.lastSafePlayerPosition.copy(current);
      return;
    }

    current.copy(this.lastSafePlayerPosition);
  }

  _updateKeycards(dt) {
    const playerPosition = this.game.player.root.position;

    for (const keycard of this.keycards) {
      if (keycard.collected) {
        continue;
      }

      keycard.object.rotation.y += dt * 1.6;
      keycard.object.position.y = 0.42 + Math.sin(this.game.elapsedTime * 4.2) * 0.08;

      if (playerPosition.distanceToSquared(keycard.position) > 1.45 * 1.45) {
        continue;
      }

      keycard.collected = true;
      keycard.object.visible = false;
      this.keycardCount += 1;
      this.game.addParticleBurst(keycard.position, KEYCARD_COLOR, 18, 0.16);
      this.game.ui?.showToast?.('Keycard acquired', '#ffd66b');
    }
  }

  _updateTraps(dt) {
    this.trapPulseTimer = Math.max(0, this.trapPulseTimer - dt);
    const player = this.game.player;

    for (const trap of this.traps) {
      if (!trap.active || !isInsideZone(player.root.position, trap)) {
        continue;
      }

      player.takeDamage(8 * dt);

      if (this.trapPulseTimer <= 0) {
        this.trapPulseTimer = 0.32;
        tempVectorA.copy(player.root.position);
        tempVectorA.y = 0.2;
        this.game.addParticleBurst(tempVectorA, 0xff645d, 6, 0.08);
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
    }
  }

  _updateDoorVisuals(dt) {
    for (const door of this.doors) {
      if (!door.object) {
        continue;
      }

      const targetY = door.closed ? 0 : -2.35;
      door.object.position.y = THREE.MathUtils.lerp(door.object.position.y, targetY, Math.min(1, dt * 8));

      if (door.light?.material?.emissive) {
        const ready = !door.locked || (door.requiresKeycard && this.keycardCount > 0);
        door.light.material.emissiveIntensity = ready ? 0.95 : 0.36;
      }
    }
  }

  _updateMechanismVisuals(dt) {
    for (const mechanism of this.mechanisms) {
      const core = mechanism.object?.getObjectByName?.('mechanismTerminalCore');
      const screen = mechanism.object?.getObjectByName?.('mechanismTerminalScreen');

      if (core) {
        core.rotation.y += dt * (mechanism.activated ? 2.8 : 1.2);
        core.position.y = 1.08 + Math.sin(this.game.elapsedTime * 3.5) * 0.04;
      }

      if (screen?.material?.emissive) {
        screen.material.emissiveIntensity = mechanism.activated ? 0.28 : 1.05;
      }
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
        nearest = {
          kind: 'door',
          target: door,
          label: encounter && !encounter.cleared
            ? `${door.label}: Clear Reaverbots`
            : door.requiresKeycard ? `${door.label}: Keycard` : door.label,
          color: (door.requiresKeycard && this.keycardCount <= 0) || (encounter && !encounter.cleared)
            ? LOCKED_COLOR
            : MECHANISM_COLOR,
        };
        nearestDistanceSq = distanceSq;
      }
    }

    for (const mechanism of this.mechanisms) {
      if (mechanism.activated) {
        continue;
      }

      const distanceSq = playerPosition.distanceToSquared(mechanism.position);
      if (distanceSq <= 2.1 * 2.1 && distanceSq < nearestDistanceSq) {
        nearest = {
          kind: 'mechanism',
          target: mechanism,
          label: mechanism.label,
          color: MECHANISM_COLOR,
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
          label: 'Open Ruin Chest',
          color: KEYCARD_COLOR,
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
          label: safeInteractable.label,
          color: safeInteractable.color,
        };
        nearestDistanceSq = distanceSq;
      }
    }

    if (this.shrine && !this.shrine.collected) {
      const distanceSq = playerPosition.distanceToSquared(this.shrine.position);
      const shrineDoor = this.doors.find((door) => door.id === 'largeRefractorSeal');
      if (distanceSq <= 2.8 * 2.8 && distanceSq < nearestDistanceSq && !shrineDoor?.closed) {
        nearest = {
          kind: 'shrine',
          target: this.shrine,
          label: 'Large Refractor',
          color: SHRINE_COLOR,
        };
      }
    }

    this.nearestInteractable = nearest;
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

    if (door.requiresKeycard && this.keycardCount <= 0) {
      this.game.ui?.showToast?.('Keycard required', '#ffb347');
      this._pulseDoor(door, LOCKED_COLOR);
      return;
    }

    if (door.mechanismId && !this._isMechanismActivated(door.mechanismId)) {
      this.game.ui?.showToast?.('Find the override console', '#6bdcff');
      this._pulseDoor(door, MECHANISM_COLOR);
      return;
    }

    if (door.requiresKeycard) {
      this.keycardCount = Math.max(0, this.keycardCount - 1);
    }

    this._openDoor(door, door.requiresKeycard ? 'Keycard door unlocked' : 'Door opened');
  }

  _activateMechanism(mechanism) {
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

    const keycardDropped = Math.random() < (chest.keycardChance ?? 0);
    if (keycardDropped) {
      const keycardPosition = chest.position.clone();
      keycardPosition.y = 0.55;
      keycardPosition.x += 0.45;
      keycardPosition.z += 0.28;
      this._spawnKeycardAt(keycardPosition, 'chestKeycard');
    }

    this.game.addParticleBurst(chest.position, KEYCARD_COLOR, keycardDropped ? 28 : 18, 0.16);
    this.game.ui?.showToast?.(
      keycardDropped ? 'Ruin chest opened: keycard and refractors' : 'Ruin chest opened: refractors',
      '#ffd66b',
    );
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
        const targetX = chest.opened ? -0.92 : 0;
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

    this.game.completeRuinObjective?.({
      reward: 650,
      position: this.shrine.position,
    });
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

    if (interactable.action === 'expedition') {
      if (this.game.ruinCompleted) {
        this.game.offerRuinReset?.();
        return;
      }

      this.game.ui?.showToast?.('Objective: secure the Large Refractor', '#ffd66b');
      this.game.addParticleBurst(interactable.position, interactable.color ?? KEYCARD_COLOR, 14, 0.12);
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
    this._pulseDoor(door, MECHANISM_COLOR);
    this.game.ui?.showToast?.(message, '#6bdcff');
    this.lastSafePlayerPosition.copy(this.game.player.root.position);
  }

  _pulseDoor(door, color) {
    tempVectorB.copy(door.position);
    tempVectorB.y = 0.9;
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
      object.userData.baseY = object.position.y;
      object.userData.baseScale = object.scale.x || 1;
      conveyor.visuals.push(object);
    });
  }

  _updateConveyorVisuals(conveyor, dt) {
    if (!conveyor.visuals?.length) {
      return;
    }

    for (const arrow of conveyor.visuals) {
      arrow.position.y = (arrow.userData.baseY ?? 0.04) + Math.sin(this.game.elapsedTime * 6 + arrow.position.z) * 0.015;
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

  _findNearestWalkablePosition(position) {
    let nearest = null;
    let nearestDistanceSq = Infinity;

    for (const tile of this.tiles.values()) {
      tempVectorA.set(tile.x * this.tileSize, 0, tile.z * this.tileSize);
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

    tempVectorC.set(x * this.tileSize, 0, z * this.tileSize);
    for (const door of this.doors) {
      if (!door.closed) {
        continue;
      }

      if (tempVectorC.distanceToSquared(door.position) <= door.radius * door.radius) {
        return false;
      }
    }

    return true;
  }
}

export default DungeonController;
