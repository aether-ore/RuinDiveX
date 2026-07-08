import * as THREE from 'three';

const DEFAULT_TILE_SIZE = 2.8;
const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function tileKey(x, z) {
  return `${x},${z}`;
}

function rangeBetween(a, b) {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  const values = [];

  for (let value = min; value <= max; value += 1) {
    values.push(value);
  }

  return values;
}

function setTile(tiles, x, z, type = 'floor') {
  const key = tileKey(x, z);
  const existing = tiles.get(key);

  if (existing) {
    if (existing.type === 'floor' || existing.type === 'hallway') {
      existing.type = type;
    }
    return existing;
  }

  const tile = { x, z, type };
  tiles.set(key, tile);
  return tile;
}

function addRectRoom(tiles, room) {
  const halfW = Math.floor(room.width / 2);
  const halfD = Math.floor(room.depth / 2);

  for (let x = room.x - halfW; x <= room.x + halfW; x += 1) {
    for (let z = room.z - halfD; z <= room.z + halfD; z += 1) {
      setTile(tiles, x, z, room.tileType ?? 'floor');
    }
  }

  setTile(tiles, room.x, room.z, room.type);
}

function addHallway(tiles, from, to) {
  for (const x of rangeBetween(from.x, to.x)) {
    setTile(tiles, x, from.z, 'hallway');
  }

  for (const z of rangeBetween(from.z, to.z)) {
    setTile(tiles, to.x, z, 'hallway');
  }
}

export class DungeonGenerator {
  constructor({ tileSize = DEFAULT_TILE_SIZE, random = Math.random } = {}) {
    this.tileSize = tileSize;
    this.random = random;
  }

  generate() {
    const tiles = new Map();
    const side = this.random() < 0.5 ? -1 : 1;
    const mainRooms = [
      { id: 'hubTown', type: 'hub', x: 0, z: -12, width: 7, depth: 5 },
      { id: 'expeditionCamp', type: 'camp', x: 0, z: -6, width: 7, depth: 5 },
      { id: 'entrance', type: 'entrance', x: 0, z: 0, width: 5, depth: 5 },
      { id: 'enemyNest', type: 'enemy', x: 0, z: 5, width: 5, depth: 5 },
      { id: 'keycardRoom', type: 'keycard', x: side * 4, z: 10, width: 5, depth: 5 },
      { id: 'trapRoom', type: 'trap', x: -side * 4, z: 15, width: 5, depth: 5 },
      { id: 'conveyorRoom', type: 'conveyor', x: 0, z: 20, width: 5, depth: 5 },
      { id: 'shrineRoom', type: 'shrine', x: 0, z: 27, width: 7, depth: 7 },
    ];
    const bonusVault = { id: 'bonusVault', type: 'bonus', x: side * 6, z: 20, width: 5, depth: 5 };
    const rooms = [...mainRooms, bonusVault];

    for (const room of rooms) {
      addRectRoom(tiles, room);
    }

    const keycardRoom = rooms.find((room) => room.id === 'keycardRoom');
    const conveyorRoom = rooms.find((room) => room.id === 'conveyorRoom');
    if (keycardRoom) {
      setTile(tiles, keycardRoom.x - side, keycardRoom.z - 1, 'chest');
    }
    if (conveyorRoom) {
      setTile(tiles, conveyorRoom.x + side, conveyorRoom.z + 1, 'chest');
    }
    setTile(tiles, bonusVault.x, bonusVault.z, 'chest');

    for (let i = 1; i < mainRooms.length; i += 1) {
      addHallway(tiles, mainRooms[i - 1], mainRooms[i]);
    }
    if (conveyorRoom) {
      addHallway(tiles, conveyorRoom, bonusVault);
    }

    const group = new THREE.Group();
    group.name = 'randomizedRuinLayout';
    const materials = this._createMaterials();
    const floorGeometry = new THREE.BoxGeometry(this.tileSize, 0.12, this.tileSize);

    for (const tile of tiles.values()) {
      const mesh = new THREE.Mesh(floorGeometry, materials.floorByType[tile.type] ?? materials.floor);
      mesh.name = `dungeonTile_${tile.type}`;
      mesh.position.set(tile.x * this.tileSize, -0.06, tile.z * this.tileSize);
      mesh.receiveShadow = true;
      group.add(mesh);

      this._addTileDetail(group, tile, materials);
    }

    this._addWalls(group, tiles, materials);
    const doors = this._addDoors(group, rooms, materials);
    const landmarks = this._addRoomLandmarks(group, rooms, materials, tiles);
    const encounters = this._createEncounterDefinitions(rooms);
    const trapVisualsByRoom = new Map(landmarks.trapVisuals.map((entry) => [entry.roomId, entry.object]));

    const enemySpawnPoints = rooms
      .filter((room) => !['hub', 'camp', 'entrance', 'bonus'].includes(room.type))
      .flatMap((room) => this._roomSpawnPoints(room));
    const hubRoom = rooms.find((room) => room.id === 'hubTown') ?? rooms[0];
    const campRoom = rooms.find((room) => room.id === 'expeditionCamp') ?? hubRoom;
    const entranceRoom = rooms.find((room) => room.id === 'entrance') ?? campRoom;

    return {
      group,
      rooms,
      tiles,
      doors,
      keycards: landmarks.keycards,
      chests: landmarks.chests,
      mechanisms: landmarks.mechanisms,
      safeInteractables: landmarks.safeInteractables,
      safeZones: this._createRoomZones(rooms, 'hub').concat(this._createRoomZones(rooms, 'camp')),
      encounters,
      traps: this._createRoomZones(rooms, 'trap').map((zone) => ({
        ...zone,
        label: 'Trap Keycard Override',
        object: trapVisualsByRoom.get(zone.roomId) ?? null,
        damagePerPulse: 5,
      })),
      conveyors: this._createRoomZones(rooms, 'conveyor').map((zone) => ({
        ...zone,
        direction: new THREE.Vector3(0, 0, 1),
        speed: 2.4,
      })),
      shrine: landmarks.shrine,
      tileSize: this.tileSize,
      playerStart: this._tileToWorld(hubRoom.x, hubRoom.z),
      campReturnPosition: this._tileToWorld(campRoom.x, campRoom.z),
      ruinEntryPosition: this._tileToWorld(entranceRoom.x, entranceRoom.z),
      enemySpawnPoints,
      shrinePosition: this._tileToWorld(rooms.at(-1).x, rooms.at(-1).z),
      boundsRadius: 82,
    };
  }

  _createMaterials() {
    const floor = new THREE.MeshStandardMaterial({
      color: 0x323c42,
      roughness: 0.82,
      metalness: 0.08,
    });
    const hallway = new THREE.MeshStandardMaterial({
      color: 0x28343d,
      roughness: 0.84,
      metalness: 0.1,
    });
    const entrance = new THREE.MeshStandardMaterial({
      color: 0x334b5a,
      emissive: 0x061522,
      emissiveIntensity: 0.16,
      roughness: 0.74,
      metalness: 0.12,
    });
    const enemy = new THREE.MeshStandardMaterial({
      color: 0x3b3d35,
      roughness: 0.86,
      metalness: 0.06,
    });
    const trap = new THREE.MeshStandardMaterial({
      color: 0x422f35,
      emissive: 0x2b0505,
      emissiveIntensity: 0.24,
      roughness: 0.78,
      metalness: 0.08,
    });
    const conveyor = new THREE.MeshStandardMaterial({
      color: 0x26394e,
      emissive: 0x05213c,
      emissiveIntensity: 0.18,
      roughness: 0.62,
      metalness: 0.22,
    });
    const bonus = new THREE.MeshStandardMaterial({
      color: 0x33405d,
      emissive: 0x071634,
      emissiveIntensity: 0.2,
      roughness: 0.6,
      metalness: 0.18,
    });
    const keycard = new THREE.MeshStandardMaterial({
      color: 0x3b4430,
      emissive: 0x1b2507,
      emissiveIntensity: 0.18,
      roughness: 0.74,
      metalness: 0.08,
    });
    const chest = new THREE.MeshStandardMaterial({
      color: 0x4c5d68,
      emissive: 0x07141d,
      emissiveIntensity: 0.14,
      roughness: 0.62,
      metalness: 0.16,
    });
    const shrine = new THREE.MeshStandardMaterial({
      color: 0x303d4d,
      emissive: 0x041b2b,
      emissiveIntensity: 0.22,
      roughness: 0.68,
      metalness: 0.18,
    });
    const hub = new THREE.MeshStandardMaterial({
      color: 0x2f4553,
      emissive: 0x061824,
      emissiveIntensity: 0.14,
      roughness: 0.78,
      metalness: 0.08,
    });
    const camp = new THREE.MeshStandardMaterial({
      color: 0x3d4744,
      emissive: 0x10180f,
      emissiveIntensity: 0.12,
      roughness: 0.82,
      metalness: 0.06,
    });

    return {
      floor,
      hallway,
      wall: new THREE.MeshStandardMaterial({
        color: 0x42505a,
        roughness: 0.7,
        metalness: 0.18,
      }),
      wallTrim: new THREE.MeshStandardMaterial({
        color: 0x71808a,
        emissive: 0x071018,
        emissiveIntensity: 0.1,
        roughness: 0.5,
        metalness: 0.34,
      }),
      door: new THREE.MeshStandardMaterial({
        color: 0x3e5364,
        emissive: 0x061623,
        emissiveIntensity: 0.24,
        roughness: 0.48,
        metalness: 0.36,
      }),
      lockedDoor: new THREE.MeshStandardMaterial({
        color: 0x615037,
        emissive: 0x3c2404,
        emissiveIntensity: 0.45,
        roughness: 0.46,
        metalness: 0.3,
      }),
      glowBlue: new THREE.MeshStandardMaterial({
        color: 0x6bdcff,
        emissive: 0x2fbfff,
        emissiveIntensity: 1.1,
        roughness: 0.28,
        metalness: 0.08,
      }),
      glowYellow: new THREE.MeshStandardMaterial({
        color: 0xffd66b,
        emissive: 0xffa51f,
        emissiveIntensity: 0.85,
        roughness: 0.34,
        metalness: 0.08,
      }),
      glowRed: new THREE.MeshStandardMaterial({
        color: 0xff645d,
        emissive: 0xff1f1f,
        emissiveIntensity: 0.78,
        roughness: 0.36,
        metalness: 0.04,
      }),
      largeRefractor: new THREE.MeshStandardMaterial({
        color: 0x7df8ff,
        emissive: 0x28e8ff,
        emissiveIntensity: 1.35,
        roughness: 0.18,
        metalness: 0.04,
        transparent: true,
        opacity: 0.86,
      }),
      chestTrim: new THREE.MeshStandardMaterial({
        color: 0xffd66b,
        emissive: 0x5c3505,
        emissiveIntensity: 0.42,
        roughness: 0.36,
        metalness: 0.28,
      }),
      floorByType: {
        floor,
        hallway,
        entrance,
        enemy,
        trap,
        conveyor,
        bonus,
        keycard,
        chest,
        shrine,
        hub,
        camp,
      },
    };
  }

  _addTileDetail(group, tile, materials) {
    const position = this._tileToWorld(tile.x, tile.z);

    if (tile.type === 'conveyor') {
      for (let i = -1; i <= 1; i += 1) {
        const arrow = new THREE.Mesh(
          new THREE.ConeGeometry(0.18, 0.72, 3),
          materials.glowBlue,
        );
        arrow.name = 'conveyorDirectionArrow';
        arrow.position.set(position.x, 0.04, position.z + i * 0.52);
        arrow.rotation.x = -Math.PI / 2;
        arrow.rotation.z = Math.PI;
        group.add(arrow);
      }
    } else if (tile.type === 'trap') {
      const warning = new THREE.Mesh(
        new THREE.RingGeometry(0.44, 0.54, 28),
        new THREE.MeshBasicMaterial({
          color: 0xff5f5f,
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      warning.name = 'trapWarningRing';
      warning.position.set(position.x, 0.035, position.z);
      warning.rotation.x = -Math.PI / 2;
      group.add(warning);
    }
  }

  _addWalls(group, tiles, materials) {
    const wallHeight = 1.45;
    const wallThickness = 0.18;

    for (const tile of tiles.values()) {
      for (const [dx, dz] of DIRECTIONS) {
        if (tiles.has(tileKey(tile.x + dx, tile.z + dz))) {
          continue;
        }

        const horizontal = dz !== 0;
        const wall = new THREE.Mesh(
          new THREE.BoxGeometry(
            horizontal ? this.tileSize : wallThickness,
            wallHeight,
            horizontal ? wallThickness : this.tileSize,
          ),
          materials.wall,
        );

        wall.name = 'dungeonBoundaryWall';
        wall.position.set(
          tile.x * this.tileSize + dx * this.tileSize * 0.5,
          wallHeight * 0.5,
          tile.z * this.tileSize + dz * this.tileSize * 0.5,
        );
        wall.castShadow = true;
        wall.receiveShadow = true;
        group.add(wall);
      }
    }
  }

  _addDoors(group, rooms, materials) {
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const descriptors = [
      { id: 'entranceDoor', from: roomById.get('expeditionCamp'), to: roomById.get('entrance'), locked: true, closed: true, requiresLift: true, label: 'Ruin Descent Gate' },
      { id: 'enemyNestGate', from: roomById.get('enemyNest'), to: roomById.get('keycardRoom'), locked: true, closed: true, encounterId: 'enemyNest', label: 'Security Gate' },
      { id: 'lockedKeycardDoor', from: roomById.get('keycardRoom'), to: roomById.get('trapRoom'), locked: true, closed: true, requiresKeycard: true, label: 'Keycard Door' },
      { id: 'bonusVaultDoor', from: roomById.get('conveyorRoom'), to: roomById.get('bonusVault'), locked: true, closed: true, requiresKeycard: true, optional: true, label: 'Bonus Vault' },
      { id: 'largeRefractorSeal', from: roomById.get('conveyorRoom'), to: roomById.get('shrineRoom'), locked: true, closed: true, mechanismId: 'conveyorOverride', label: 'Shrine Seal' },
    ];
    const doors = [];

    for (const descriptor of descriptors) {
      const position = this._tileToWorld(
        Math.round((descriptor.from.x + descriptor.to.x) * 0.5),
        Math.round((descriptor.from.z + descriptor.to.z) * 0.5),
      );
      const alongX = Math.abs(descriptor.from.x - descriptor.to.x) > Math.abs(descriptor.from.z - descriptor.to.z);
      const door = new THREE.Group();
      door.name = descriptor.id;
      door.position.copy(position);

      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(alongX ? 0.22 : this.tileSize * 0.9, 1.95, alongX ? this.tileSize * 0.9 : 0.22),
        descriptor.locked ? materials.lockedDoor : materials.door,
      );
      frame.name = 'dungeonDoorFrame';
      frame.position.y = 0.98;
      frame.castShadow = true;
      frame.receiveShadow = true;

      const light = new THREE.Mesh(
        new THREE.BoxGeometry(alongX ? 0.26 : this.tileSize * 0.42, 0.08, alongX ? this.tileSize * 0.42 : 0.26),
        descriptor.locked ? materials.glowYellow : materials.glowBlue,
      );
      light.name = descriptor.locked ? 'lockedDoorStatusLight' : 'doorStatusLight';
      light.position.y = 1.75;

      door.add(frame, light);
      group.add(door);

      const data = {
        id: descriptor.id,
        label: descriptor.label,
        object: door,
        frame,
        light,
        position: position.clone(),
        radius: 1.1,
        locked: descriptor.locked,
        closed: descriptor.closed,
        requiresLift: Boolean(descriptor.requiresLift),
        requiresKeycard: Boolean(descriptor.requiresKeycard),
        optional: Boolean(descriptor.optional),
        mechanismId: descriptor.mechanismId ?? null,
        encounterId: descriptor.encounterId ?? null,
        opened: !descriptor.closed,
        alongX,
      };
      door.userData.dungeonDoor = data;
      doors.push(data);
    }

    return doors;
  }

  _addRoomLandmarks(group, rooms, materials, tiles) {
    const landmarks = {
      keycards: [],
      chests: [],
      mechanisms: [],
      safeInteractables: [],
      trapVisuals: [],
      shrine: null,
    };

    for (const room of rooms) {
      const position = this._tileToWorld(room.x, room.z);

      if (room.type === 'hub') {
        landmarks.safeInteractables.push(...this._addHubTown(group, position, materials));
      } else if (room.type === 'camp') {
        landmarks.safeInteractables.push(...this._addExpeditionCamp(group, position, materials));
      } else if (room.type === 'entrance') {
        this._addExpeditionPad(group, position, materials);
      } else if (room.type === 'keycard') {
        landmarks.keycards.push({
          id: 'ruinKeycardA',
          object: this._addKeycardMarker(group, position, materials),
          position: position.clone(),
          collected: false,
        });
      } else if (room.type === 'conveyor') {
        landmarks.mechanisms.push({
          id: 'conveyorOverride',
          label: 'Ruin Override Console',
          object: this._addMechanismTerminal(group, position, materials),
          position: position.clone(),
          requiresEncounterId: 'conveyorGuard',
          activated: false,
        });
      } else if (room.type === 'shrine') {
        landmarks.shrine = {
          id: 'largeRefractor',
          object: this._addLargeRefractorShrine(group, position, materials),
          position: position.clone(),
          collected: false,
        };
      } else if (room.type === 'trap') {
        landmarks.trapVisuals.push({
          roomId: room.id,
          object: this._addTrapEmitters(group, position, materials),
        });
      }
    }

    let chestIndex = 0;
    for (const tile of tiles.values()) {
      if (tile.type !== 'chest') {
        continue;
      }

      const position = this._tileToWorld(tile.x, tile.z);
      const object = this._addTreasureChest(group, position, materials, chestIndex);
      landmarks.chests.push({
        id: `ruinChest_${chestIndex + 1}`,
        object,
        position: position.clone(),
        opened: false,
        keycardChance: chestIndex === 0 ? 0.65 : 0.28,
        rareBoost: chestIndex > 0,
      });
      chestIndex += 1;
    }

    return landmarks;
  }

  _addExpeditionPad(group, position, materials) {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.12, 32), materials.glowBlue);
    pad.name = 'expeditionCampEntrancePad';
    pad.position.set(position.x, 0.04, position.z);
    group.add(pad);
  }

  _addHubTown(group, position, materials) {
    const interactables = [];
    const plaza = new THREE.Group();
    plaza.name = 'minimalHubTown';
    plaza.position.copy(position);

    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.44), materials.glowBlue);
    sign.name = 'hubTownGarageSign';
    sign.position.set(-1.6, 0.96, -0.8);

    const garage = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.86, 0.72), materials.wallTrim);
    garage.name = 'hubTownGarageWorkbench';
    garage.position.set(-1.6, 0.43, -0.55);
    garage.castShadow = true;
    garage.receiveShadow = true;

    const npcMaterial = new THREE.MeshStandardMaterial({
      color: 0x68d8ff,
      emissive: 0x0b3140,
      emissiveIntensity: 0.22,
      roughness: 0.68,
      metalness: 0.1,
    });
    const mechanic = this._createNpcMarker('hubMechanicNpc', npcMaterial);
    mechanic.position.set(1.4, 0, -0.2);

    plaza.add(sign, garage, mechanic);
    group.add(plaza);

    interactables.push({
      id: 'garageWorkbench',
      label: 'Garage Workbench',
      action: 'garage',
      position: position.clone().add(new THREE.Vector3(-1.6, 0, -0.55)),
      object: plaza,
      color: 0x6bdcff,
    });
    interactables.push({
      id: 'hubMechanic',
      label: 'Mechanic',
      action: 'mechanic',
      position: position.clone().add(new THREE.Vector3(1.4, 0, -0.2)),
      object: mechanic,
      color: 0x6bdcff,
    });

    return interactables;
  }

  _addExpeditionCamp(group, position, materials) {
    const interactables = [];
    const camp = new THREE.Group();
    camp.name = 'minimalExpeditionCamp';
    camp.position.copy(position);

    const tentMaterial = new THREE.MeshStandardMaterial({
      color: 0x2f5c68,
      emissive: 0x061a20,
      emissiveIntensity: 0.12,
      roughness: 0.78,
      metalness: 0.05,
    });
    const tent = new THREE.Mesh(new THREE.ConeGeometry(1.05, 1.1, 4), tentMaterial);
    tent.name = 'expeditionCampTent';
    tent.position.set(-1.65, 0.55, 0.4);
    tent.rotation.y = Math.PI / 4;
    tent.castShadow = true;
    tent.receiveShadow = true;

    const board = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.72, 0.12), materials.glowYellow);
    board.name = 'expeditionQuestBoard';
    board.position.set(1.45, 0.72, 0.2);
    board.castShadow = true;

    const leaderMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd66b,
      emissive: 0x3b2604,
      emissiveIntensity: 0.22,
      roughness: 0.68,
      metalness: 0.08,
    });
    const leader = this._createNpcMarker('expeditionLeaderNpc', leaderMaterial);
    leader.position.set(0, 0, -0.6);

    const researcherMaterial = new THREE.MeshStandardMaterial({
      color: 0x7df8ff,
      emissive: 0x06363c,
      emissiveIntensity: 0.24,
      roughness: 0.66,
      metalness: 0.08,
    });
    const researcher = this._createNpcMarker('expeditionResearcherNpc', researcherMaterial);
    researcher.position.set(-1.05, 0, -1.2);

    const researchStation = new THREE.Group();
    researchStation.name = 'expeditionResearchStation';
    researchStation.position.set(-0.42, 0, -1.25);
    const researchBench = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.42, 0.54), materials.wallTrim);
    researchBench.name = 'expeditionResearchBench';
    researchBench.position.y = 0.21;
    researchBench.castShadow = true;
    researchBench.receiveShadow = true;
    const researchCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), materials.glowBlue);
    researchCore.name = 'expeditionResearchScannerCore';
    researchCore.position.set(0, 0.55, 0);
    const researchScreen = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.24, 0.05), materials.glowBlue);
    researchScreen.name = 'expeditionResearchScannerScreen';
    researchScreen.position.set(0, 0.48, -0.27);
    researchScreen.rotation.x = -0.28;
    researchStation.add(researchBench, researchCore, researchScreen);

    const resetConsole = new THREE.Group();
    resetConsole.name = 'expeditionRuinResetConsole';
    resetConsole.position.set(1.35, 0, -1.15);
    const resetBase = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.58, 0.46), materials.wallTrim);
    resetBase.name = 'ruinResetConsoleBase';
    resetBase.position.y = 0.29;
    resetBase.castShadow = true;
    resetBase.receiveShadow = true;
    const resetCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), materials.glowBlue);
    resetCore.name = 'ruinResetConsoleCore';
    resetCore.position.y = 0.75;
    resetConsole.add(resetBase, resetCore);

    const ruinLift = new THREE.Group();
    ruinLift.name = 'expeditionRuinLift';
    ruinLift.position.set(0, 0, 1.55);
    const liftPad = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.82, 0.12, 28), materials.entrance);
    liftPad.name = 'expeditionRuinLiftPad';
    liftPad.position.y = 0.06;
    liftPad.receiveShadow = true;
    const liftRing = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.035, 8, 28), materials.glowBlue);
    liftRing.name = 'expeditionRuinLiftRing';
    liftRing.position.y = 0.16;
    liftRing.rotation.x = Math.PI / 2;
    const liftMarker = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.34, 4), materials.glowYellow);
    liftMarker.name = 'expeditionRuinLiftMarker';
    liftMarker.position.y = 0.48;
    liftMarker.rotation.y = Math.PI / 4;
    ruinLift.add(liftPad, liftRing, liftMarker);

    camp.add(tent, board, leader, researcher, researchStation, resetConsole, ruinLift);
    group.add(camp);

    interactables.push({
      id: 'expeditionLeader',
      label: 'Expedition Leader',
      action: 'expedition',
      position: position.clone().add(new THREE.Vector3(0, 0, -0.6)),
      object: leader,
      color: 0xffd66b,
    });
    interactables.push({
      id: 'questBoard',
      label: 'Quest Board',
      action: 'quest',
      position: position.clone().add(new THREE.Vector3(1.45, 0, 0.2)),
      object: board,
      color: 0xffd66b,
    });
    interactables.push({
      id: 'researchStation',
      label: 'Research Station',
      action: 'research',
      position: position.clone().add(new THREE.Vector3(-0.42, 0, -1.25)),
      object: researchStation,
      color: 0x7df8ff,
    });
    interactables.push({
      id: 'ruinResetConsole',
      label: 'Reset Ruin',
      action: 'resetRuin',
      position: position.clone().add(new THREE.Vector3(1.35, 0, -1.15)),
      object: resetConsole,
      color: 0x6bdcff,
    });
    interactables.push({
      id: 'ruinLift',
      label: 'Ruin Lift',
      action: 'enterRuin',
      position: position.clone().add(new THREE.Vector3(0, 0, 1.55)),
      object: ruinLift,
      color: 0x7df8ff,
    });

    return interactables;
  }

  _createNpcMarker(name, material) {
    const npc = new THREE.Group();
    npc.name = name;

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.78, 14), material);
    body.name = `${name}Body`;
    body.position.y = 0.39;
    body.castShadow = true;
    body.receiveShadow = true;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), material);
    head.name = `${name}Head`;
    head.position.y = 0.92;
    head.castShadow = true;

    npc.add(body, head);
    return npc;
  }

  _addKeycardMarker(group, position, materials) {
    const marker = new THREE.Group();
    marker.name = 'keycardPickupPlaceholder';
    marker.position.set(position.x, 0.42, position.z);

    const card = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.62), materials.glowYellow);
    card.name = 'floatingKeycard';
    card.rotation.y = Math.PI * 0.18;

    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.68, 12), materials.wallTrim);
    post.name = 'keycardPedestal';
    post.position.y = -0.32;

    marker.add(post, card);
    group.add(marker);
    return marker;
  }

  _addMechanismTerminal(group, position, materials) {
    const terminal = new THREE.Group();
    terminal.name = 'ruinMechanismTerminal';
    terminal.position.set(position.x, 0, position.z - 1.1);

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.72, 0.48), materials.wallTrim);
    base.name = 'mechanismTerminalBase';
    base.position.y = 0.36;
    base.castShadow = true;
    base.receiveShadow = true;

    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.3), materials.glowBlue);
    screen.name = 'mechanismTerminalScreen';
    screen.position.set(0, 0.76, -0.18);
    screen.rotation.x = -0.42;

    const node = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), materials.glowYellow);
    node.name = 'mechanismTerminalCore';
    node.position.set(0, 1.08, 0);

    terminal.add(base, screen, node);
    group.add(terminal);
    return terminal;
  }

  _addTreasureChest(group, position, materials, index = 0) {
    const chest = new THREE.Group();
    chest.name = `ruinTreasureChest_${index + 1}`;
    chest.position.set(position.x, 0, position.z);

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.42, 0.64), materials.floorByType.chest);
    base.name = 'ruinChestBase';
    base.position.y = 0.24;
    base.castShadow = true;
    base.receiveShadow = true;

    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.22, 0.68), materials.floorByType.chest);
    lid.name = 'ruinChestLid';
    lid.position.set(0, 0.58, -0.02);
    lid.castShadow = true;
    lid.receiveShadow = true;

    const band = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.08, 0.72), materials.chestTrim);
    band.name = 'ruinChestTrim';
    band.position.y = 0.61;
    band.castShadow = true;

    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.08), materials.glowYellow);
    lock.name = 'ruinChestLock';
    lock.position.set(0, 0.49, -0.36);
    lock.castShadow = true;

    const glow = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.82, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffd66b,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    glow.name = 'ruinChestGlow';
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.04;

    chest.add(base, lid, band, lock, glow);
    group.add(chest);
    return chest;
  }

  _addLargeRefractorShrine(group, position, materials) {
    const shrine = new THREE.Group();
    shrine.name = 'largeRefractorShrine';
    shrine.position.copy(position);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.55, 0.42, 36), materials.wallTrim);
    base.name = 'largeRefractorBase';
    base.position.y = 0.21;
    base.castShadow = true;
    base.receiveShadow = true;

    const refractor = new THREE.Mesh(new THREE.OctahedronGeometry(0.82, 0), materials.largeRefractor);
    refractor.name = 'largeRefractorObjective';
    refractor.position.y = 1.42;
    refractor.scale.y = 1.65;
    refractor.castShadow = true;

    const glow = new THREE.Mesh(
      new THREE.RingGeometry(1.15, 1.7, 48),
      new THREE.MeshBasicMaterial({
        color: 0x7df8ff,
        transparent: true,
        opacity: 0.24,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    glow.name = 'largeRefractorShrineGlow';
    glow.position.y = 0.06;
    glow.rotation.x = -Math.PI / 2;

    const extractionPad = new THREE.Group();
    extractionPad.name = 'largeRefractorExtractionPad';
    extractionPad.visible = false;

    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.22, 0.1, 32), materials.glowBlue.clone());
    pad.name = 'largeRefractorExtractionPadCore';
    pad.position.y = 0.08;
    pad.receiveShadow = true;

    const padRing = new THREE.Mesh(
      new THREE.RingGeometry(1.28, 1.62, 48),
      new THREE.MeshBasicMaterial({
        color: 0x6bdcff,
        transparent: true,
        opacity: 0.34,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    padRing.name = 'largeRefractorExtractionPadRing';
    padRing.position.y = 0.16;
    padRing.rotation.x = -Math.PI / 2;

    extractionPad.add(pad, padRing);
    shrine.add(base, refractor, glow, extractionPad);
    group.add(shrine);
    return shrine;
  }

  _addTrapEmitters(group, position, materials) {
    const emitters = new THREE.Group();
    emitters.name = 'trapEmitterGroup';
    emitters.position.copy(position);

    for (const offset of [-1.15, 1.15]) {
      const emitter = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.58, 0.34), materials.glowRed.clone());
      emitter.name = 'trapLaserEmitter';
      emitter.position.set(offset, 0.29, 0);
      emitter.castShadow = true;
      emitters.add(emitter);
    }

    group.add(emitters);
    return emitters;
  }

  _roomSpawnPoints(room) {
    const points = [];
    const offsets = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
      [0, 0],
    ];

    for (const [dx, dz] of offsets) {
      points.push(this._tileToWorld(room.x + dx, room.z + dz));
    }

    return points;
  }

  _tileToWorld(x, z) {
    return new THREE.Vector3(x * this.tileSize, 0, z * this.tileSize);
  }

  _createRoomZones(rooms, type) {
    return rooms
      .filter((room) => room.type === type)
      .map((room) => ({
        id: `${room.id}Zone`,
        roomId: room.id,
        position: this._tileToWorld(room.x, room.z),
        halfWidth: (Math.floor(room.width / 2) + 0.5) * this.tileSize,
        halfDepth: (Math.floor(room.depth / 2) + 0.5) * this.tileSize,
        active: true,
      }));
  }

  _createEncounterDefinitions(rooms) {
    const encounterRooms = [
      {
        roomId: 'enemyNest',
        id: 'enemyNest',
        label: 'Reaverbot Nest',
        roster: ['basic', 'fast', 'ranged', 'basic'],
        gateDoorId: 'enemyNestGate',
      },
      {
        roomId: 'keycardRoom',
        id: 'keycardGuard',
        label: 'Keycard Guard',
        roster: ['ranged', 'basic'],
      },
      {
        roomId: 'trapRoom',
        id: 'trapAmbush',
        label: 'Trap Ambush',
        roster: ['fast', 'basic', 'horokko'],
      },
      {
        roomId: 'conveyorRoom',
        id: 'conveyorGuard',
        label: 'Conveyor Guard',
        roster: ['gorubesshu', 'ranged'],
      },
      {
        roomId: 'shrineRoom',
        id: 'shrineDefense',
        label: 'Shrine Defense',
        roster: ['tank', 'horokko', 'ranged'],
      },
    ];
    const roomById = new Map(rooms.map((room) => [room.id, room]));

    return encounterRooms
      .map((definition) => {
        const room = roomById.get(definition.roomId);
        if (!room) {
          return null;
        }

        return {
          ...definition,
          zone: {
            id: `${definition.id}Zone`,
            roomId: room.id,
            position: this._tileToWorld(room.x, room.z),
            halfWidth: (Math.floor(room.width / 2) + 0.5) * this.tileSize,
            halfDepth: (Math.floor(room.depth / 2) + 0.5) * this.tileSize,
            active: true,
          },
          spawnPoints: this._roomSpawnPoints(room),
          spawned: false,
          cleared: false,
          enemyIds: [],
        };
      })
      .filter(Boolean);
  }
}

export default DungeonGenerator;
