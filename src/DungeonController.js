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
    this.puzzleBlocks = dungeon?.puzzleBlocks ?? [];
    this.pressurePlates = dungeon?.pressurePlates ?? [];
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
    this._updateTrapVisuals(dt);
    this._updatePuzzleBlocks(dt);
    this._updateConveyors(dt);
    this._updatePressurePlates(dt);
    this._updateEncounters();
    this._constrainPlayerToWalkable();
    this._updateDoorVisuals(dt);
    this._updateChestVisuals(dt);
    this._updateMechanismVisuals(dt);
    this._updateExtractionVisuals(dt);
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
        : this.game.expeditionAccepted
          ? 'Use ruin lift'
          : 'Accept briefing';
    }

    const activeEncounter = this.encounters.find((encounter) => (
      encounter.spawned
      && !encounter.cleared
    ));

    if (activeEncounter) {
      return `Clear ${activeEncounter.label}`;
    }

    const unclaimedKeycard = this.keycards.some((keycard) => !keycard.collected);
    const keycardDoor = this.doors.find((door) => door.requiresKeycard && door.closed && !door.optional);
    if (keycardDoor) {
      return this.keycardCount > 0
        ? 'Open keycard door'
        : unclaimedKeycard
          ? 'Find keycard'
          : 'Hunt Reaverbots';
    }

    const activeTrap = this.traps.find((trap) => (
      trap.active
      && isInsideZone(this.game.player.root.position, trap)
    ));
    if (activeTrap) {
      return this.keycardCount > 0 ? 'Disable trap' : 'Time laser pulses';
    }

    if (this.game.ruinCompleted && this.shrine?.collected) {
      return 'Use extraction pad';
    }

    const shrineDoor = this.doors.find((door) => door.id === 'largeRefractorSeal');
    if (shrineDoor?.closed) {
      return 'Find override console';
    }

    if (this.shrine && !this.shrine.collected) {
      return 'Secure Large Refractor';
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
          tempVectorA.y = 0.2;
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
        tempVectorA.y = 0.72;
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

      block.position.y = 0;
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
        block.position.y = 0;

        if (!this.isPositionWalkable(block.position)) {
          block.position.copy(tempVectorA);
        }

        block.object?.position.copy(block.position);
      }
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

      const targetY = door.closed ? 0 : -2.35;
      door.object.position.y = THREE.MathUtils.lerp(door.object.position.y, targetY, Math.min(1, dt * 8));

      if (door.light?.material?.emissive) {
        const pressureReady = door.pressurePlateId && this._isPressurePlateActivated(door.pressurePlateId);
        const ready = !door.locked || pressureReady || (door.requiresKeycard && this.keycardCount > 0);
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
        nearest = {
          kind: 'door',
          target: door,
          label: door.requiresLift
            ? 'Ruin Descent Gate: Use Lift'
            : encounter && !encounter.cleared
            ? `${door.label}: Clear Reaverbots`
            : needsKeycard
              ? `${door.label}: Keycard or Plate`
              : door.label,
          color: door.requiresLift || (needsKeycard && this.keycardCount <= 0) || (encounter && !encounter.cleared)
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
        const blockedEncounter = this._getMechanismBlockingEncounter(mechanism);
        nearest = {
          kind: 'mechanism',
          target: mechanism,
          label: blockedEncounter
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
          label: this.keycardCount > 0 ? trap.label : `${trap.label}: Keycard`,
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
          label: this._getSafeInteractablePrompt(safeInteractable),
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
        : this.game.expeditionAccepted
          ? `${interactable.label}: Descend`
          : `${interactable.label}: Need Briefing`;
    }

    return interactable.label;
  }

  _activateDoor(door) {
    if (door.requiresLift) {
      this.game.ui?.showToast?.(
        this.game.expeditionAccepted
          ? 'Use the camp ruin lift to descend'
          : 'Accept the expedition briefing first',
        '#ffd66b',
      );
      this._pulseDoor(door, LOCKED_COLOR);
      return;
    }

    if (door.encounterId) {
      const encounter = this.encounters.find((candidate) => candidate.id === door.encounterId);
      if (encounter && !encounter.cleared) {
        this.game.ui?.showToast?.('Defeat the Reaverbots to unlock this gate', '#ffb347');
        this._pulseDoor(door, LOCKED_COLOR);
        return;
      }
    }

    const pressureReady = door.pressurePlateId && this._isPressurePlateActivated(door.pressurePlateId);

    if (door.requiresKeycard && this.keycardCount <= 0 && !pressureReady) {
      this.game.ui?.showToast?.(
        door.pressurePlateId ? 'Keycard or pressure plate required' : 'Keycard required',
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
      this.keycardCount = Math.max(0, this.keycardCount - 1);
    }

    this._openDoor(door, pressureReady ? 'Pressure plate route unlocked' : door.requiresKeycard ? 'Keycard door unlocked' : 'Door opened');
  }

  _activateMechanism(mechanism) {
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
      this.game.ui?.showToast?.('A keycard can disable this trap relay', '#ffd66b');
      this.game.addParticleBurst(trap.position, LOCKED_COLOR, 10, 0.1);
      return;
    }

    this.keycardCount = Math.max(0, this.keycardCount - 1);
    trap.active = false;
    this.game.addParticleBurst(trap.position, KEYCARD_COLOR, 24, 0.16);
    this.game.ui?.showToast?.('Keycard accepted: trap disabled', '#ffd66b');
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
      if (!this.game.expeditionAccepted) {
        this.game.ui?.showToast?.('Talk to the expedition leader first', '#ffd66b');
        this.game.addParticleBurst(interactable.position, LOCKED_COLOR, 10, 0.1);
        return;
      }

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

  _isPressurePlateActivated(id) {
    return this.pressurePlates.some((plate) => plate.id === id && plate.activated);
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
