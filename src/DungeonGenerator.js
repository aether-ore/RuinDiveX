import * as THREE from 'three';

const DEFAULT_TILE_SIZE = 2.8;
const RUIN_TEXTURE_BASE_PATH = '/assets/textures/ruins/';
const RUIN_WALL_HEIGHT = 6.4;
const RUIN_WALL_THICKNESS = 0.22;
const RUIN_WALL_FACE_OFFSET = 0.006;
const RUIN_WALL_TILE_OVERLAP = 0.014;
const RUIN_WALL_TILE_ROWS = 3;
const RUIN_CEILING_THICKNESS = 0.12;
const RUIN_DOOR_HEIGHT = 4.8;
const RUIN_DOOR_OPEN_Y = -5.3;
const RUIN_OPEN_AIR_ROOM_TYPES = new Set(['hub', 'camp']);
const WALL_MACRO_VARIANTS = ['sand', 'overgrown', 'industrial'];
const WALL_MACRO_TILE_KEYS = ['tl', 'tm', 'tr', 'ml', 'mm', 'mr', 'bl', 'bm', 'br'];
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

function setConveyorTile(tiles, x, z, {
  directionX = 0,
  directionZ = 1,
  speed = 2.4,
  active = true,
} = {}) {
  const tile = setTile(tiles, x, z, 'conveyor');

  if (tile.type === 'conveyor') {
    tile.conveyorDirectionX = directionX;
    tile.conveyorDirectionZ = directionZ;
    tile.conveyorSpeed = speed;
    tile.conveyorActive = active;
  }

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
    this.textureLoader = new THREE.TextureLoader();
    this.textureCache = new Map();
  }

  _randomInt(min, max) {
    return min + Math.floor(this.random() * (max - min + 1));
  }

  _choose(values) {
    return values[Math.floor(this.random() * values.length)];
  }

  generate() {
    const tiles = new Map();
    const side = this.random() < 0.5 ? -1 : 1;
    const secondarySide = this.random() < 0.65 ? -side : side;
    const enemyNestZ = this._randomInt(5, 6);
    const keycardZ = enemyNestZ + this._randomInt(4, 6);
    const trapZ = keycardZ + this._randomInt(4, 6);
    const conveyorZ = trapZ + this._randomInt(4, 6);
    const shrineZ = conveyorZ + this._randomInt(6, 8);
    const keycardX = side * this._randomInt(3, 5);
    const trapX = secondarySide * this._randomInt(3, 5);
    const conveyorX = this._choose([0, side * 2, secondarySide * 2]);
    const shrineX = conveyorX + this._choose([0, 0, side * 2, secondarySide * 2]);
    const bonusSide = this.random() < 0.5 ? side : -side;
    const layoutVariant = {
      side,
      enemyNestZ,
      keycardZ,
      trapZ,
      conveyorZ,
      shrineZ,
    };
    const mainRooms = [
      { id: 'hubTown', type: 'hub', x: 0, z: -12, width: 7, depth: 5 },
      { id: 'expeditionCamp', type: 'camp', x: 0, z: -6, width: 7, depth: 5 },
      { id: 'entrance', type: 'entrance', x: 0, z: 0, width: 5, depth: 5 },
      { id: 'enemyNest', type: 'enemy', x: this._choose([0, side * 1, -side * 1]), z: enemyNestZ, width: 5, depth: 5 },
      { id: 'keycardRoom', type: 'keycard', x: keycardX, z: keycardZ, width: this._choose([5, 5, 7]), depth: 5 },
      { id: 'trapRoom', type: 'trap', x: trapX, z: trapZ, width: 5, depth: this._choose([5, 5, 7]) },
      { id: 'conveyorRoom', type: 'conveyor', x: conveyorX, z: conveyorZ, width: 5, depth: 5 },
      { id: 'shrineRoom', type: 'shrine', x: shrineX, z: shrineZ, width: 7, depth: 7 },
    ];
    const bonusVault = {
      id: 'bonusVault',
      type: 'bonus',
      x: conveyorX + bonusSide * this._randomInt(5, 7),
      z: conveyorZ + this._randomInt(-1, 2),
      width: 5,
      depth: 5,
    };
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
      for (let dz = -1; dz <= 1; dz += 1) {
        setConveyorTile(tiles, conveyorRoom.x, conveyorRoom.z + dz);
      }
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

    const openAirTileKeys = this._createOpenAirTileKeys(rooms);
    this._addCeilings(group, tiles, materials, openAirTileKeys);
    this._addWalls(group, tiles, materials, openAirTileKeys);
    this._addInvisibleOpenAirBounds(group, tiles, materials, openAirTileKeys);
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
      layoutVariant,
      doors,
      keycards: landmarks.keycards,
      chests: landmarks.chests,
      mechanisms: landmarks.mechanisms,
      puzzleBlocks: landmarks.puzzleBlocks,
      pressurePlates: landmarks.pressurePlates,
      safeInteractables: landmarks.safeInteractables,
      safeZones: this._createRoomZones(rooms, 'hub').concat(this._createRoomZones(rooms, 'camp')),
      encounters,
      traps: this._createRoomZones(rooms, 'trap').map((zone) => ({
        ...zone,
        label: 'Timed Laser Grid',
        object: trapVisualsByRoom.get(zone.roomId) ?? null,
        damagePerPulse: 5,
        damagePerSecond: 18,
        pulseInterval: 1.45 + this.random() * 0.35,
        activeDuration: 0.34 + this.random() * 0.08,
        telegraphDuration: 0.42,
        phaseOffset: this.random() * 0.8,
      })),
      conveyors: this._createConveyorTileZones(tiles),
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

  _loadRuinTexture(name) {
    if (this.textureCache.has(name)) {
      return this.textureCache.get(name);
    }

    const texture = this.textureLoader.load(`${RUIN_TEXTURE_BASE_PATH}${name}.png`);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    this.textureCache.set(name, texture);
    return texture;
  }

  _createRuinMaterial(textureName, {
    color = 0xffffff,
    emissive = 0x000000,
    emissiveIntensity = 0,
    roughness = 0.78,
    metalness = 0.08,
    transparent = false,
    opacity = 1,
  } = {}) {
    return new THREE.MeshStandardMaterial({
      color,
      map: this._loadRuinTexture(textureName),
      emissive,
      emissiveIntensity,
      roughness,
      metalness,
      transparent,
      opacity,
    });
  }

  _createWallMacroTileMaterials(variant) {
    const style = {
      sand: {
        color: 0xf2ead8,
        emissive: 0x031010,
        roughness: 0.76,
        metalness: 0.06,
      },
      overgrown: {
        color: 0xf0ecd7,
        emissive: 0x06140a,
        roughness: 0.84,
        metalness: 0.03,
      },
      industrial: {
        color: 0xd8d9e2,
        emissive: 0x030510,
        roughness: 0.72,
        metalness: 0.1,
      },
    }[variant] ?? {};
    const materials = {};

    for (const key of WALL_MACRO_TILE_KEYS) {
      materials[key] = this._createRuinMaterial(`wall_macro_${variant}_${key}`, {
        emissiveIntensity: 0.04,
        ...style,
      });
    }

    return materials;
  }

  _createMaterials() {
    const floor = this._createRuinMaterial('floor_plain', {
      roughness: 0.86,
      metalness: 0.04,
    });
    const hallway = this._createRuinMaterial('floor_panel', {
      color: 0xf1ead8,
      roughness: 0.84,
      metalness: 0.06,
    });
    const entrance = this._createRuinMaterial('floor_cross_panel', {
      color: 0xf2ead6,
      emissive: 0x052f34,
      emissiveIntensity: 0.08,
      roughness: 0.78,
      metalness: 0.08,
    });
    const enemy = this._createRuinMaterial('floor_circuit', {
      color: 0xe8e0c9,
      emissive: 0x042f34,
      emissiveIntensity: 0.1,
      roughness: 0.78,
      metalness: 0.08,
    });
    const trap = this._createRuinMaterial('special_trap', {
      emissive: 0x2b0505,
      emissiveIntensity: 0.18,
      roughness: 0.74,
      metalness: 0.08,
    });
    const conveyor = this._createRuinMaterial('special_conveyor', {
      emissive: 0x052d32,
      emissiveIntensity: 0.16,
      roughness: 0.6,
      metalness: 0.22,
    });
    const bonus = this._createRuinMaterial('floor_octagon', {
      color: 0xf4ebd6,
      emissive: 0x052326,
      emissiveIntensity: 0.1,
      roughness: 0.7,
      metalness: 0.1,
    });
    const keycard = this._createRuinMaterial('door_keycard', {
      color: 0xf1ead9,
      emissive: 0x241500,
      emissiveIntensity: 0.12,
      roughness: 0.72,
      metalness: 0.08,
    });
    const chest = this._createRuinMaterial('accent_hatch', {
      color: 0xf1ead9,
      emissive: 0x07141d,
      emissiveIntensity: 0.08,
      roughness: 0.62,
      metalness: 0.12,
    });
    const shrine = this._createRuinMaterial('floor_shrine', {
      color: 0xf1ead9,
      emissive: 0x052326,
      emissiveIntensity: 0.14,
      roughness: 0.68,
      metalness: 0.12,
    });
    const hub = this._createRuinMaterial('floor_mossy', {
      color: 0xf0ead6,
      emissive: 0x07120a,
      emissiveIntensity: 0.08,
      roughness: 0.88,
      metalness: 0.03,
    });
    const camp = this._createRuinMaterial('floor_mossy', {
      color: 0xf3edd8,
      emissive: 0x07120a,
      emissiveIntensity: 0.08,
      roughness: 0.9,
      metalness: 0.03,
    });
    const wallMacroVariant = WALL_MACRO_VARIANTS[
      this._randomInt(0, WALL_MACRO_VARIANTS.length - 1)
    ];
    const wallMacroTiles = this._createWallMacroTileMaterials(wallMacroVariant);

    return {
      floor,
      hallway,
      wall: new THREE.MeshStandardMaterial({
        color: 0xa79d87,
        emissive: 0x030505,
        emissiveIntensity: 0.025,
        roughness: 0.78,
        metalness: 0.06,
      }),
      wallMacroTiles,
      wallMacroVariant,
      ceiling: this._createRuinMaterial('ceiling_panel', {
        color: 0xe8dfcc,
        roughness: 0.84,
        metalness: 0.04,
      }),
      wallTrim: this._createRuinMaterial('accent_slate', {
        color: 0xf0e8d5,
        emissive: 0x061010,
        emissiveIntensity: 0.06,
        roughness: 0.58,
        metalness: 0.14,
      }),
      door: this._createRuinMaterial('door_frame', {
        color: 0xf1ead8,
        emissive: 0x052326,
        emissiveIntensity: 0.14,
        roughness: 0.48,
        metalness: 0.22,
      }),
      lockedDoor: this._createRuinMaterial('door_sealed', {
        color: 0xf1ead8,
        emissive: 0x241500,
        emissiveIntensity: 0.28,
        roughness: 0.46,
        metalness: 0.2,
      }),
      terminal: this._createRuinMaterial('terminal_mechanism', {
        color: 0xf1ead8,
        emissive: 0x04282c,
        emissiveIntensity: 0.12,
        roughness: 0.5,
        metalness: 0.16,
      }),
      invisibleBoundary: new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0,
        depthWrite: false,
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

  _addCeilings(group, tiles, materials, openAirTileKeys = new Set()) {
    const ceilingGeometry = new THREE.BoxGeometry(
      this.tileSize,
      RUIN_CEILING_THICKNESS,
      this.tileSize,
    );

    for (const tile of tiles.values()) {
      if (openAirTileKeys.has(tileKey(tile.x, tile.z))) {
        continue;
      }

      const ceiling = new THREE.Mesh(ceilingGeometry, materials.ceiling);
      ceiling.name = 'dungeonRoomCeiling';
      ceiling.position.set(
        tile.x * this.tileSize,
        RUIN_WALL_HEIGHT + RUIN_CEILING_THICKNESS * 0.5,
        tile.z * this.tileSize,
      );
      ceiling.castShadow = true;
      ceiling.receiveShadow = true;
      group.add(ceiling);
    }
  }

  _addWalls(group, tiles, materials, openAirTileKeys = new Set()) {
    const runs = this._collectBoundaryWallRuns(tiles, openAirTileKeys);

    for (const run of runs) {
      this._addBoundaryWallRun(group, run, materials);
    }
  }

  _collectBoundaryWallRuns(tiles, openAirTileKeys) {
    const buckets = new Map();

    for (const tile of tiles.values()) {
      if (openAirTileKeys.has(tileKey(tile.x, tile.z))) {
        continue;
      }

      for (const [dx, dz] of DIRECTIONS) {
        if (tiles.has(tileKey(tile.x + dx, tile.z + dz))) {
          continue;
        }

        const horizontal = dz !== 0;
        const line = horizontal ? tile.z + dz * 0.5 : tile.x + dx * 0.5;
        const axis = horizontal ? tile.x : tile.z;
        const key = `${horizontal ? 'h' : 'v'}:${dx}:${dz}:${line}`;
        let bucket = buckets.get(key);

        if (!bucket) {
          bucket = {
            horizontal,
            dx,
            dz,
            line,
            axes: new Set(),
          };
          buckets.set(key, bucket);
        }

        bucket.axes.add(axis);
      }
    }

    const runs = [];
    for (const bucket of buckets.values()) {
      const axes = [...bucket.axes].sort((a, b) => a - b);

      if (!axes.length) {
        continue;
      }

      let start = axes[0];
      let previous = axes[0];
      const pushRun = () => {
        runs.push({
          horizontal: bucket.horizontal,
          dx: bucket.dx,
          dz: bucket.dz,
          line: bucket.line,
          start,
          end: previous,
          lengthTiles: previous - start + 1,
        });
      };

      for (let i = 1; i < axes.length; i += 1) {
        const axis = axes[i];
        if (axis === previous + 1) {
          previous = axis;
          continue;
        }

        pushRun();
        start = axis;
        previous = axis;
      }

      pushRun();
    }

    return runs;
  }

  _addBoundaryWallRun(group, run, materials) {
    const lengthWorld = run.lengthTiles * this.tileSize;
    const geometry = new THREE.BoxGeometry(
      run.horizontal ? lengthWorld : RUIN_WALL_THICKNESS,
      RUIN_WALL_HEIGHT,
      run.horizontal ? RUIN_WALL_THICKNESS : lengthWorld,
    );
    const wall = new THREE.Mesh(geometry, materials.wall);
    const axisCenter = ((run.start + run.end) * 0.5) * this.tileSize;

    wall.name = 'dungeonBoundaryWall';
    wall.position.set(
      run.horizontal ? axisCenter : run.line * this.tileSize,
      RUIN_WALL_HEIGHT * 0.5,
      run.horizontal ? run.line * this.tileSize : axisCenter,
    );
    wall.userData.wallRun = {
      horizontal: run.horizontal,
      dx: run.dx,
      dz: run.dz,
      line: run.line,
      start: run.start,
      end: run.end,
      lengthTiles: run.lengthTiles,
    };
    wall.castShadow = true;
    wall.receiveShadow = true;

    this._addMacroWallFace(wall, run, lengthWorld, materials);
    group.add(wall);
  }

  _addMacroWallFace(wall, run, lengthWorld, materials) {
    const faceOffset = RUIN_WALL_THICKNESS * 0.5 + RUIN_WALL_FACE_OFFSET;
    const addFace = (normalX, normalZ) => {
      this._addMacroWallTileGrid(wall, run, lengthWorld, materials, normalX, normalZ, faceOffset);
    };

    if (run.horizontal) {
      addFace(0, -run.dz);
      addFace(0, run.dz);
    } else {
      addFace(-run.dx, 0);
      addFace(run.dx, 0);
    }
  }

  _addMacroWallTileGrid(wall, run, lengthWorld, materials, normalX, normalZ, faceOffset) {
    const columns = Math.max(
      3,
      Math.round(lengthWorld / (RUIN_WALL_HEIGHT / RUIN_WALL_TILE_ROWS)),
    );
    const rows = RUIN_WALL_TILE_ROWS;
    const tileWidth = lengthWorld / columns;
    const tileHeight = RUIN_WALL_HEIGHT / rows;
    const geometry = new THREE.PlaneGeometry(
      tileWidth + RUIN_WALL_TILE_OVERLAP,
      tileHeight + RUIN_WALL_TILE_OVERLAP,
    );

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const tileName = this._getWallMacroTileName(column, row, columns, rows);
        const tile = new THREE.Mesh(
          geometry,
          materials.wallMacroTiles?.[tileName] ?? materials.wallMacroTiles?.mm ?? materials.wall,
        );
        const along = -lengthWorld * 0.5 + tileWidth * (column + 0.5);

        tile.name = 'dungeonBoundaryWallMacroTile';
        tile.receiveShadow = true;
        tile.position.y = RUIN_WALL_HEIGHT * 0.5 - tileHeight * (row + 0.5);

        if (run.horizontal) {
          tile.position.x = along;
          tile.position.z = normalZ * faceOffset;
          tile.rotation.y = normalZ >= 0 ? 0 : Math.PI;
        } else {
          tile.position.x = normalX * faceOffset;
          tile.position.z = along;
          tile.rotation.y = normalX >= 0 ? Math.PI / 2 : -Math.PI / 2;
        }

        wall.add(tile);
      }
    }
  }

  _getWallMacroTileName(column, row, columns, rows) {
    const top = row === 0;
    const bottom = row === rows - 1;
    const left = column === 0;
    const right = column === columns - 1;

    if (top && left) {
      return 'tl';
    }
    if (top && right) {
      return 'tr';
    }
    if (bottom && left) {
      return 'bl';
    }
    if (bottom && right) {
      return 'br';
    }
    if (top) {
      return 'tm';
    }
    if (bottom) {
      return 'bm';
    }
    if (left) {
      return 'ml';
    }
    if (right) {
      return 'mr';
    }

    return 'mm';
  }

  _addInvisibleOpenAirBounds(group, tiles, materials, openAirTileKeys = new Set()) {
    if (!openAirTileKeys.size) {
      return;
    }

    const horizontalWallGeometry = new THREE.BoxGeometry(
      this.tileSize,
      RUIN_WALL_HEIGHT,
      RUIN_WALL_THICKNESS,
    );
    const verticalWallGeometry = new THREE.BoxGeometry(
      RUIN_WALL_THICKNESS,
      RUIN_WALL_HEIGHT,
      this.tileSize,
    );

    for (const key of openAirTileKeys) {
      const tile = tiles.get(key);
      if (!tile) {
        continue;
      }

      for (const [dx, dz] of DIRECTIONS) {
        if (tiles.has(tileKey(tile.x + dx, tile.z + dz))) {
          continue;
        }

        const horizontal = dz !== 0;
        const boundary = new THREE.Mesh(
          horizontal ? horizontalWallGeometry : verticalWallGeometry,
          materials.invisibleBoundary,
        );
        boundary.name = 'expeditionCampInvisibleBoundary';
        boundary.position.set(
          tile.x * this.tileSize + dx * this.tileSize * 0.5,
          RUIN_WALL_HEIGHT * 0.5,
          tile.z * this.tileSize + dz * this.tileSize * 0.5,
        );
        boundary.userData.invisibleWalkBoundary = true;
        boundary.castShadow = false;
        boundary.receiveShadow = false;
        group.add(boundary);
      }
    }
  }

  _addDoors(group, rooms, materials) {
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const descriptors = [
      { id: 'entranceDoor', from: roomById.get('expeditionCamp'), to: roomById.get('entrance'), locked: false, closed: false, label: 'Ruin Entrance' },
      { id: 'enemyNestGate', from: roomById.get('enemyNest'), to: roomById.get('keycardRoom'), locked: true, closed: true, encounterId: 'enemyNest', label: 'Security Gate' },
      { id: 'lockedKeycardDoor', from: roomById.get('keycardRoom'), to: roomById.get('trapRoom'), locked: true, closed: true, requiresKeycard: true, label: 'Keycard Door' },
      { id: 'bonusVaultDoor', from: roomById.get('conveyorRoom'), to: roomById.get('bonusVault'), locked: true, closed: true, requiresKeycard: true, pressurePlateId: 'conveyorVaultPlate', optional: true, label: 'Bonus Vault' },
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
      if (!descriptor.closed) {
        door.position.y = RUIN_DOOR_OPEN_Y;
      }

      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(alongX ? 0.24 : this.tileSize * 0.9, RUIN_DOOR_HEIGHT, alongX ? this.tileSize * 0.9 : 0.24),
        descriptor.locked ? materials.lockedDoor : materials.door,
      );
      frame.name = 'dungeonDoorFrame';
      frame.position.y = RUIN_DOOR_HEIGHT * 0.5;
      frame.castShadow = true;
      frame.receiveShadow = true;

      const light = new THREE.Mesh(
        new THREE.BoxGeometry(alongX ? 0.26 : this.tileSize * 0.42, 0.08, alongX ? this.tileSize * 0.42 : 0.26),
        descriptor.locked ? materials.glowYellow : materials.glowBlue,
      );
      light.name = descriptor.locked ? 'lockedDoorStatusLight' : 'doorStatusLight';
      light.position.y = RUIN_DOOR_HEIGHT - 0.34;

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
        requiresKeycard: Boolean(descriptor.requiresKeycard),
        optional: Boolean(descriptor.optional),
        mechanismId: descriptor.mechanismId ?? null,
        pressurePlateId: descriptor.pressurePlateId ?? null,
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
      puzzleBlocks: [],
      pressurePlates: [],
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
        const blockPosition = position.clone().add(new THREE.Vector3(0, 0, -this.tileSize * 0.72));
        const platePosition = position.clone().add(new THREE.Vector3(0, 0, this.tileSize * 0.78));
        landmarks.mechanisms.push({
          id: 'conveyorOverride',
          label: 'Ruin Override Console',
          object: this._addMechanismTerminal(group, position, materials),
          position: position.clone(),
          requiresEncounterId: 'conveyorGuard',
          activated: false,
        });
        landmarks.puzzleBlocks.push({
          id: 'conveyorRelayBlock',
          label: 'Relay Block',
          object: this._addPuzzleBlock(group, blockPosition, materials),
          position: blockPosition.clone(),
          radius: 0.58,
        });
        landmarks.pressurePlates.push({
          id: 'conveyorVaultPlate',
          label: 'Vault Pressure Plate',
          object: this._addPressurePlate(group, platePosition, materials),
          position: platePosition.clone(),
          radius: 0.92,
          targetDoorId: 'bonusVaultDoor',
          requiredBlockId: 'conveyorRelayBlock',
          active: false,
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

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.72, 0.48), materials.terminal ?? materials.wallTrim);
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

  _addPuzzleBlock(group, position, materials) {
    const block = new THREE.Group();
    block.name = 'conveyorRelayBlock';
    block.position.copy(position);

    const shellMaterial = materials.wallTrim.clone();
    shellMaterial.color.setHex(0x54646f);
    shellMaterial.emissive.setHex(0x07141d);
    shellMaterial.emissiveIntensity = 0.18;

    const coreMaterial = materials.glowBlue.clone();
    coreMaterial.emissiveIntensity = 0.9;

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.72, 0.92), shellMaterial);
    body.name = 'relayBlockBody';
    body.position.y = 0.36;
    body.castShadow = true;
    body.receiveShadow = true;

    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), coreMaterial);
    core.name = 'relayBlockPowerCore';
    core.position.y = 0.82;
    core.castShadow = true;

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.08, 0.18), materials.glowYellow.clone());
    stripe.name = 'relayBlockDirectionStripe';
    stripe.position.set(0, 0.55, -0.47);

    block.add(body, core, stripe);
    group.add(block);
    return block;
  }

  _addPressurePlate(group, position, materials) {
    const plate = new THREE.Group();
    plate.name = 'conveyorVaultPressurePlate';
    plate.position.copy(position);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.98, 0.1, 32), materials.wallTrim.clone());
    base.name = 'pressurePlateBase';
    base.position.y = 0.05;
    base.receiveShadow = true;

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x6bdcff,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.82, 40), ringMaterial);
    ring.name = 'pressurePlatePowerRing';
    ring.position.y = 0.12;
    ring.rotation.x = -Math.PI / 2;

    const glyph = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.72), materials.glowYellow.clone());
    glyph.name = 'pressurePlatePowerGlyph';
    glyph.position.y = 0.15;

    plate.add(base, ring, glyph);
    group.add(plate);
    return plate;
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
    const beamMaterial = materials.glowRed.clone();
    beamMaterial.transparent = true;
    beamMaterial.opacity = 0.72;

    for (const offset of [-1.15, 1.15]) {
      const emitter = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.58, 0.34), materials.glowRed.clone());
      emitter.name = 'trapLaserEmitter';
      emitter.position.set(offset, 0.29, 0);
      emitter.castShadow = true;
      emitters.add(emitter);
    }

    for (const y of [0.36, 0.62, 0.88]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.055, 0.08), beamMaterial.clone());
      beam.name = 'trapLaserBeam';
      beam.position.set(0, y, 0);
      beam.castShadow = false;
      emitters.add(beam);
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

  _createOpenAirTileKeys(rooms) {
    const openAirTileKeys = new Set();
    const openAirRooms = rooms.filter((room) => RUIN_OPEN_AIR_ROOM_TYPES.has(room.type));

    for (const room of openAirRooms) {
      const halfW = Math.floor(room.width / 2);
      const halfD = Math.floor(room.depth / 2);

      for (let x = room.x - halfW; x <= room.x + halfW; x += 1) {
        for (let z = room.z - halfD; z <= room.z + halfD; z += 1) {
          openAirTileKeys.add(tileKey(x, z));
        }
      }
    }

    for (let i = 1; i < openAirRooms.length; i += 1) {
      const from = openAirRooms[i - 1];
      const to = openAirRooms[i];

      for (const x of rangeBetween(from.x, to.x)) {
        openAirTileKeys.add(tileKey(x, from.z));
      }

      for (const z of rangeBetween(from.z, to.z)) {
        openAirTileKeys.add(tileKey(to.x, z));
      }
    }

    return openAirTileKeys;
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

  _createConveyorTileZones(tiles) {
    return [...tiles.values()]
      .filter((tile) => tile.type === 'conveyor')
      .map((tile) => {
        const direction = new THREE.Vector3(
          tile.conveyorDirectionX ?? 0,
          0,
          tile.conveyorDirectionZ ?? 1,
        );

        if (direction.lengthSq() <= 0.0001) {
          direction.set(0, 0, 1);
        }

        return {
          id: `conveyorTile_${tile.x}_${tile.z}`,
          tileX: tile.x,
          tileZ: tile.z,
          position: this._tileToWorld(tile.x, tile.z),
          halfWidth: this.tileSize * 0.5,
          halfDepth: this.tileSize * 0.5,
          direction: direction.normalize(),
          speed: tile.conveyorSpeed ?? 2.4,
          active: tile.conveyorActive !== false,
          label: 'Conveyor Belt',
        };
      });
  }

  _createEncounterDefinitions(rooms) {
    const encounterRooms = [
      {
        roomId: 'enemyNest',
        id: 'enemyNest',
        label: 'Reaverbot Nest',
        roster: this._createEncounterRoster('nest'),
        gateDoorId: 'enemyNestGate',
      },
      {
        roomId: 'keycardRoom',
        id: 'keycardGuard',
        label: 'Keycard Guard',
        roster: this._createEncounterRoster('keycard'),
      },
      {
        roomId: 'trapRoom',
        id: 'trapAmbush',
        label: 'Trap Ambush',
        roster: this._createEncounterRoster('trap'),
      },
      {
        roomId: 'conveyorRoom',
        id: 'conveyorGuard',
        label: 'Conveyor Guard',
        roster: this._createEncounterRoster('conveyor'),
      },
      {
        roomId: 'shrineRoom',
        id: 'shrineDefense',
        label: 'Shrine Defense',
        roster: this._createEncounterRoster('shrine'),
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

  _createEncounterRoster(kind) {
    const pools = {
      nest: [
        ['basic', 'fast', 'ranged', 'basic'],
        ['basic', 'basic', 'horokko'],
        ['fast', 'fast', 'ranged', 'basic'],
      ],
      keycard: [
        ['ranged', 'basic'],
        ['basic', 'horokko'],
        ['ranged', 'fast'],
      ],
      trap: [
        ['fast', 'basic', 'horokko'],
        ['horokko', 'horokko'],
        ['fast', 'ranged', 'basic'],
      ],
      conveyor: [
        ['gorubesshu', 'ranged'],
        ['gorubesshu', 'basic', 'fast'],
        ['ranged', 'ranged', 'horokko'],
      ],
      shrine: [
        ['tank', 'horokko', 'ranged'],
        ['tank', 'gorubesshu', 'fast'],
        ['horokko', 'gorubesshu', 'ranged', 'basic'],
      ],
    };

    return [...this._choose(pools[kind] ?? [['basic', 'ranged']])];
  }
}

export default DungeonGenerator;
