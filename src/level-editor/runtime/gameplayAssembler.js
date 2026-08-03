import * as THREE from 'three';
import { PBRMaterialLibrary } from './materials.js';
import {
  asArray,
  cloneData,
  DisposableResourceSet,
  finiteNumber,
  normalizeId,
  readSize3,
  readTransform,
  readVector3,
  transformDirection,
  transformMatrix,
} from './utils.js';

const TYPE_ALIASES = Object.freeze({
  player: 'playerStart',
  playerspawn: 'playerStart',
  playerstart: 'playerStart',
  spawn: 'playerStart',
  start: 'playerStart',
  exit: 'exit',
  extraction: 'exit',
  returnpoint: 'exit',
  door: 'door',
  gate: 'door',
  keycard: 'keycard',
  key: 'keycard',
  credential: 'keycard',
  chest: 'chest',
  cache: 'chest',
  encounter: 'encounter',
  combatencounter: 'encounter',
  trap: 'trap',
  hazard: 'trap',
  conveyor: 'conveyor',
  conveyorbelt: 'conveyor',
  ladder: 'ladder',
  lift: 'lift',
  elevator: 'lift',
  connectorlift: 'lift',
  mechanism: 'mechanism',
  switch: 'mechanism',
  console: 'mechanism',
  puzzleblock: 'puzzleBlock',
  pushblock: 'puzzleBlock',
  block: 'puzzleBlock',
  pressureplate: 'pressurePlate',
  plate: 'pressurePlate',
  shrine: 'shrine',
  safezone: 'safeZone',
  sanctuary: 'safeZone',
  interactable: 'interactable',
  safeinteractable: 'interactable',
});

function canonicalType(entity) {
  const type = String(entity?.type ?? entity?.kind ?? entity?.entityType ?? '').replace(/[\s_-]/g, '').toLowerCase();
  return TYPE_ALIASES[type] ?? type;
}

function normalizeEntity(entity, index) {
  const properties = entity?.properties && typeof entity.properties === 'object'
    ? entity.properties
    : {};
  return {
    ...cloneData(properties),
    ...cloneData(entity),
    id: normalizeId(entity?.id ?? properties.id, `entity-${index + 1}`),
    roomId: entity?.roomId ?? properties.roomId ?? null,
    transform: entity?.transform ?? properties.transform,
  };
}

function getRoomMatrix(roomTransforms, roomId) {
  if (!roomId || !roomTransforms) return null;
  const value = roomTransforms instanceof Map
    ? roomTransforms.get(roomId)
    : roomTransforms[roomId];
  if (value?.isMatrix4) return value;
  if (value?.matrixWorld?.isMatrix4) return value.matrixWorld;
  if (value?.matrix?.isMatrix4) return value.matrix;
  if (value) return transformMatrix(value);
  return null;
}

function worldTransform(entity, roomTransforms) {
  const local = transformMatrix(entity.transform ?? entity);
  const room = entity.coordinateSpace === 'world' || entity.worldSpace === true
    ? null
    : getRoomMatrix(roomTransforms, entity.roomId);
  const matrix = room ? room.clone().multiply(local) : local;
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  return { matrix, position, quaternion, scale };
}

function defaultMaterials(resources) {
  const definitions = {
    default: { color: 0x6d747a, roughness: 0.78, metalness: 0.18 },
    trim: { color: 0x252b30, roughness: 0.58, metalness: 0.72 },
    accent: { color: 0x65d8ed, emissive: 0x164b5b, emissiveIntensity: 0.9, roughness: 0.36, metalness: 0.28 },
    hazard: { color: 0xe35d42, emissive: 0x5a1208, emissiveIntensity: 0.85, roughness: 0.5, metalness: 0.18 },
    keycard: { color: 0xffd66b, emissive: 0x74520d, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.12 },
    safe: { color: 0x6dffd5, emissive: 0x155a48, emissiveIntensity: 0.72, roughness: 0.42, metalness: 0.08 },
    shrine: { color: 0xa6f8ff, emissive: 0x2c8491, emissiveIntensity: 1.35, roughness: 0.22, metalness: 0.18 },
  };
  const result = new Map();
  for (const [id, parameters] of Object.entries(definitions)) {
    const material = new THREE.MeshStandardMaterial({ name: `authoredGameplay-${id}`, ...parameters });
    resources.own(material);
    result.set(id, material);
  }
  return result;
}

function materialGetter(materials, resources) {
  const fallbacks = defaultMaterials(resources);
  return (source, fallback = 'default') => {
    const id = source?.materialId ?? source?.material;
    if (id?.isMaterial) return id;
    if (materials instanceof PBRMaterialLibrary) return materials.resolve(id, fallback) ?? fallbacks.get(fallback);
    if (materials instanceof Map) return materials.get(id) ?? materials.get(fallback) ?? fallbacks.get(fallback);
    return materials?.[id] ?? materials?.[fallback] ?? fallbacks.get(fallback) ?? fallbacks.get('default');
  };
}

function boxMesh(source, resources, getMaterial, fallbackMaterial, sizeFallback) {
  const size = readSize3(source.size ?? source.dimensions ?? {
    x: source.width ?? sizeFallback.x,
    y: source.height ?? source.thickness ?? sizeFallback.y,
    z: source.depth ?? sizeFallback.z,
  }, sizeFallback);
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  resources.own(geometry);
  const mesh = new THREE.Mesh(geometry, getMaterial(source, fallbackMaterial));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, size };
}

function cylinderMesh(source, resources, getMaterial, fallbackMaterial, { radius = 0.5, height = 0.15, segments = 24 } = {}) {
  const geometry = new THREE.CylinderGeometry(
    finiteNumber(source.radius, radius),
    finiteNumber(source.radius, radius),
    finiteNumber(source.height ?? source.thickness, height),
    Math.max(3, Math.floor(finiteNumber(source.segments, segments))),
  );
  resources.own(geometry);
  const mesh = new THREE.Mesh(geometry, getMaterial(source, fallbackMaterial));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function placeObject(object, transform, { floorAnchored = false, height = 0 } = {}) {
  object.position.copy(transform.position);
  if (floorAnchored) object.position.y += height * 0.5;
  object.quaternion.copy(transform.quaternion);
  object.scale.copy(transform.scale);
  return object;
}

function zoneDescriptor(source, transform, defaults = {}) {
  const size = readSize3(source.size ?? source.dimensions ?? {
    x: source.width ?? (source.halfWidth != null ? Number(source.halfWidth) * 2 : defaults.width ?? 1),
    y: source.height ?? (source.verticalHalfHeight != null ? Number(source.verticalHalfHeight) * 2 : defaults.height ?? 2),
    z: source.depth ?? (source.halfDepth != null ? Number(source.halfDepth) * 2 : defaults.depth ?? 1),
  });
  const euler = new THREE.Euler().setFromQuaternion(transform.quaternion, 'YXZ');
  return {
    ...cloneData(source),
    id: source.id,
    roomId: source.roomId ?? null,
    position: transform.position.clone(),
    center: transform.position.clone(),
    halfWidth: finiteNumber(source.halfWidth, size.x * Math.abs(transform.scale.x) * 0.5),
    halfDepth: finiteNumber(source.halfDepth, size.z * Math.abs(transform.scale.z) * 0.5),
    verticalHalfHeight: finiteNumber(source.verticalHalfHeight, size.y * Math.abs(transform.scale.y) * 0.5),
    rotationY: euler.y,
    active: source.active !== false,
  };
}

function createDoor(source, transform, output, context) {
  const { group, resources, getMaterial, visuals } = context;
  const width = finiteNumber(source.width ?? source.clearWidth, 3.2);
  const height = finiteNumber(source.height ?? source.collisionHeight, 3.2);
  const depth = finiteNumber(source.depth ?? source.thickness, 0.32);
  const object = new THREE.Group();
  object.name = source.name ?? source.id;
  placeObject(object, transform);
  object.userData = { authoredGameplay: true, entityType: 'door', entityId: source.id, closed: source.closed !== false };
  let leftPanel = null;
  let rightPanel = null;
  if (visuals) {
    const panelSize = { x: width * 0.49, y: height, z: depth };
    leftPanel = boxMesh({ ...source, size: panelSize }, resources, getMaterial, 'trim', panelSize).mesh;
    rightPanel = boxMesh({ ...source, size: panelSize }, resources, getMaterial, 'trim', panelSize).mesh;
    leftPanel.name = `${source.id}-leftPanel`;
    rightPanel.name = `${source.id}-rightPanel`;
    leftPanel.position.set(-width * 0.25, height * 0.5, 0);
    rightPanel.position.set(width * 0.25, height * 0.5, 0);
    object.add(leftPanel, rightPanel);
    group.add(object);
  }
  const euler = new THREE.Euler().setFromQuaternion(transform.quaternion, 'YXZ');
  const descriptor = {
    ...cloneData(source),
    id: source.id,
    doorId: source.doorId ?? source.id,
    label: source.label ?? source.displayName ?? source.name ?? 'Door',
    position: transform.position.clone(),
    graphBlockingPosition: transform.position.clone(),
    baseY: transform.position.y,
    object,
    group: object,
    leftPanel,
    rightPanel,
    slidingAxis: 'x',
    leftPanelClosedOffset: -width * 0.25,
    rightPanelClosedOffset: width * 0.25,
    slidingOpenOffset: finiteNumber(source.slidingOpenOffset, width * 0.4),
    closed: source.closed !== false && source.opened !== true,
    opened: source.opened === true || source.closed === false,
    locked: source.locked === true || Boolean(source.requiredKeycardId ?? source.requiredCredentialIds),
    requiresKeycard: Boolean(source.requiredKeycardId),
    requiredKeycardId: source.requiredKeycardId ?? null,
    collisionHalfWidth: finiteNumber(source.collisionHalfWidth, width * 0.5),
    collisionHalfDepth: finiteNumber(source.collisionHalfDepth, depth * 0.5),
    collisionHeight: height,
    rotationY: euler.y,
  };
  output.doors.push(descriptor);
  output.interactables.push(descriptor);
}

function createKeycard(source, transform, output, context) {
  const { group, resources, getMaterial, visuals } = context;
  const object = new THREE.Group();
  object.name = source.name ?? source.id;
  placeObject(object, transform);
  if (visuals) {
    const card = boxMesh({ ...source, size: source.size ?? { x: 0.42, y: 0.07, z: 0.62 } }, resources, getMaterial, 'keycard', { x: 0.42, y: 0.07, z: 0.62 }).mesh;
    card.name = `${source.id}-card`;
    card.position.y = 0.42;
    object.add(card);
    group.add(object);
  }
  output.keycards.push({
    ...cloneData(source),
    id: source.id,
    keycardId: source.keycardId ?? source.credentialId ?? source.id,
    displayName: source.displayName ?? source.label ?? 'Keycard',
    position: transform.position.clone(),
    sourcePosition: transform.position.clone(),
    object,
    collected: source.collected === true,
    isCollected: source.collected === true,
    spawnRoomId: source.spawnRoomId ?? source.roomId ?? null,
  });
}

function createChest(source, transform, output, context) {
  const { group, resources, getMaterial, visuals } = context;
  const object = new THREE.Group();
  object.name = source.name ?? source.id;
  placeObject(object, transform);
  if (visuals) {
    const base = boxMesh({ ...source, size: source.size ?? { x: 1.2, y: 0.7, z: 0.82 } }, resources, getMaterial, 'trim', { x: 1.2, y: 0.7, z: 0.82 }).mesh;
    base.name = `${source.id}-base`;
    base.position.y = 0.35;
    object.add(base);
    group.add(object);
  }
  const descriptor = {
    ...cloneData(source),
    id: source.id,
    label: source.label ?? source.displayName ?? 'Ruin Chest',
    position: transform.position.clone(),
    object,
    opened: source.opened === true,
  };
  output.chests.push(descriptor);
  output.interactables.push(descriptor);
}

function createEncounter(source, transform, output) {
  const zone = zoneDescriptor(source.zone ?? source, transform, {
    width: source.radius ? Number(source.radius) * 2 : 6,
    depth: source.radius ? Number(source.radius) * 2 : 6,
    height: 4,
  });
  zone.position.copy(transform.position);
  const spawnPoints = asArray(source.spawnPoints ?? source.spawns).map((point) => {
    const local = readVector3(point.position ?? point);
    return local.applyMatrix4(transform.matrix);
  });
  output.encounters.push({
    ...cloneData(source),
    id: source.id,
    label: source.label ?? source.displayName ?? 'Encounter',
    roomId: source.roomId ?? null,
    zone,
    triggerZone: source.triggerZone ? zoneDescriptor(source.triggerZone, {
      ...transform,
      position: readVector3(source.triggerZone.position ?? source.triggerZone).applyMatrix4(transform.matrix),
    }) : zone,
    spawnPoints,
    roster: cloneData(source.roster ?? source.enemies ?? []),
    enemyIds: [...(source.enemyIds ?? [])],
    spawned: source.spawned === true,
    cleared: source.cleared === true,
    isBoss: source.isBoss === true || source.boss === true,
  });
}

function createTrap(source, transform, output, context) {
  const zone = zoneDescriptor(source, transform, { width: 2, depth: 2, height: 1 });
  let object = null;
  if (context.visuals) {
    object = cylinderMesh({ ...source, radius: source.radius ?? Math.min(zone.halfWidth, zone.halfDepth), height: 0.08 }, context.resources, context.getMaterial, 'hazard', { radius: 0.8, height: 0.08 });
    object.name = source.name ?? source.id;
    placeObject(object, transform, { floorAnchored: true, height: 0.08 });
    context.group.add(object);
  }
  output.traps.push({
    ...zone,
    label: source.label ?? source.displayName ?? 'Hazard',
    object,
    damagePerSecond: finiteNumber(source.damagePerSecond ?? source.damage, 18),
    active: source.active !== false,
  });
}

function createConveyor(source, transform, output, context) {
  const zone = zoneDescriptor(source, transform, { width: 2.8, depth: 2.8, height: 0.4 });
  const direction = readVector3(source.direction ?? source.facing, { x: 0, y: 0, z: 1 });
  direction.applyQuaternion(transform.quaternion).setY(0);
  if (direction.lengthSq() < 0.0001) direction.set(0, 0, 1);
  direction.normalize();
  let object = null;
  if (context.visuals) {
    const size = { x: zone.halfWidth * 2, y: 0.16, z: zone.halfDepth * 2 };
    object = boxMesh({ ...source, size }, context.resources, context.getMaterial, 'metal', size).mesh;
    object.name = source.name ?? source.id;
    placeObject(object, transform, { floorAnchored: false });
    context.group.add(object);
  }
  output.conveyors.push({
    ...zone,
    object,
    mesh: object,
    direction,
    speed: finiteNumber(source.speed, 1.8),
    active: source.active !== false,
    topY: transform.position.y,
  });
}

function createLadder(source, transform, output, context) {
  const height = Math.max(0.5, finiteNumber(source.height ?? source.length, 4));
  const bottomY = finiteNumber(source.bottomY, transform.position.y);
  const topY = finiteNumber(source.topY, bottomY + height);
  const facing = readVector3(source.facing ?? source.direction, { x: 0, y: 0, z: 1 });
  facing.applyQuaternion(transform.quaternion).setY(0).normalize();
  const center = transform.position.clone().setY((bottomY + topY) * 0.5);
  const bottomExit = transform.position.clone().setY(bottomY);
  const topExit = transform.position.clone().setY(topY);
  const object = new THREE.Group();
  object.name = source.name ?? source.id;
  if (context.visuals) {
    object.position.copy(center);
    object.quaternion.copy(transform.quaternion);
    const railGeometry = new THREE.CylinderGeometry(0.055, 0.055, topY - bottomY, 8);
    context.resources.own(railGeometry);
    for (const x of [-0.34, 0.34]) {
      const rail = new THREE.Mesh(railGeometry, context.getMaterial(source, 'metal'));
      rail.position.x = x;
      rail.castShadow = true;
      object.add(rail);
    }
    const rungCount = Math.max(2, Math.floor((topY - bottomY) / 0.32));
    const rungGeometry = new THREE.CylinderGeometry(0.035, 0.035, 0.68, 8);
    rungGeometry.rotateZ(Math.PI * 0.5);
    context.resources.own(rungGeometry);
    for (let index = 0; index <= rungCount; index += 1) {
      const rung = new THREE.Mesh(rungGeometry, context.getMaterial(source, 'metal'));
      rung.position.y = -(topY - bottomY) * 0.5 + ((topY - bottomY) * index) / rungCount;
      object.add(rung);
    }
    context.group.add(object);
  }
  output.ladders.push({
    ...cloneData(source),
    id: source.id,
    label: source.label ?? 'ladder',
    position: center,
    facing,
    direction: source.directionRole ?? source.direction ?? null,
    bottomY,
    topY,
    bottomExit,
    topExit,
    bottomMountPosition: bottomExit.clone(),
    topMountPosition: topExit.clone(),
    mountRadius: finiteNumber(source.mountRadius, 1.6),
    object,
  });
}

function createLift(source, transform, output, context) {
  const bottomElevation = finiteNumber(source.bottomElevation ?? source.bottomY, transform.position.y);
  const topElevation = Math.max(bottomElevation, finiteNumber(source.topElevation ?? source.topY, bottomElevation + finiteNumber(source.height, 4)));
  const width = finiteNumber(source.platformWidthMeters ?? source.width, 2.4);
  const depth = finiteNumber(source.platformDepthMeters ?? source.depth, 2.4);
  const object = new THREE.Group();
  object.name = source.name ?? source.id;
  object.position.set(transform.position.x, 0, transform.position.z);
  object.quaternion.copy(transform.quaternion);
  let platformMesh = null;
  if (context.visuals) {
    platformMesh = boxMesh({ ...source, size: { x: width, y: 0.22, z: depth } }, context.resources, context.getMaterial, 'metal', { x: width, y: 0.22, z: depth }).mesh;
    platformMesh.name = `${source.id}-platform`;
    platformMesh.position.y = bottomElevation;
    object.add(platformMesh);
    context.group.add(object);
  }
  const controls = asArray(source.controls).map((control, index) => ({
    ...cloneData(control),
    id: normalizeId(control.id, `${source.id}-control-${index + 1}`),
    liftId: source.id,
    position: readVector3(control.position ?? control).applyMatrix4(transform.matrix),
    interactionRadius: finiteNumber(control.interactionRadius, 1.55),
  }));
  const surface = {
    id: `${source.id}-surface`,
    center: new THREE.Vector3(transform.position.x, bottomElevation, transform.position.z),
    halfWidth: width * 0.5,
    halfDepth: depth * 0.5,
    topY: bottomElevation + 0.11,
  };
  output.connectorLifts.push({
    ...cloneData(source),
    id: source.id,
    label: source.label ?? 'lift',
    center: new THREE.Vector3(transform.position.x, bottomElevation, transform.position.z),
    bottomElevation,
    topElevation,
    initialElevation: finiteNumber(source.initialElevation, bottomElevation),
    currentElevation: finiteNumber(source.initialElevation, bottomElevation),
    progressionSourceElevation: finiteNumber(source.progressionSourceElevation, bottomElevation),
    progressionDestinationElevation: finiteNumber(source.progressionDestinationElevation, topElevation),
    platformWidthMeters: width,
    platformDepthMeters: depth,
    platformMesh,
    object,
    group: object,
    surface,
    controls,
  });
}

function createMechanism(source, transform, output, context) {
  const object = new THREE.Group();
  object.name = source.name ?? source.id;
  placeObject(object, transform);
  if (context.visuals) {
    const base = boxMesh({ ...source, size: source.size ?? { x: 0.7, y: 1.2, z: 0.48 } }, context.resources, context.getMaterial, 'trim', { x: 0.7, y: 1.2, z: 0.48 }).mesh;
    base.position.y = 0.6;
    const core = cylinderMesh({ ...source, radius: 0.16, height: 0.12 }, context.resources, context.getMaterial, 'accent', { radius: 0.16, height: 0.12 });
    core.name = 'mechanismTerminalCore';
    core.position.y = 1.08;
    const screen = boxMesh({ ...source, size: { x: 0.46, y: 0.3, z: 0.05 }, materialId: source.screenMaterialId ?? 'accent' }, context.resources, context.getMaterial, 'accent', { x: 0.46, y: 0.3, z: 0.05 }).mesh;
    screen.name = 'mechanismTerminalScreen';
    screen.position.set(0, 0.8, 0.27);
    object.add(base, core, screen);
    context.group.add(object);
  }
  const descriptor = {
    ...cloneData(source),
    id: source.id,
    label: source.label ?? source.displayName ?? 'Mechanism',
    position: transform.position.clone(),
    object,
    activated: source.activated === true,
  };
  output.mechanisms.push(descriptor);
  output.interactables.push(descriptor);
}

function createPuzzleBlock(source, transform, output, context) {
  const radius = finiteNumber(source.radius, 0.58);
  let object = null;
  if (context.visuals) {
    object = boxMesh({ ...source, size: source.size ?? { x: radius * 2, y: radius * 2, z: radius * 2 } }, context.resources, context.getMaterial, 'accent', { x: radius * 2, y: radius * 2, z: radius * 2 }).mesh;
    object.name = source.name ?? source.id;
    placeObject(object, transform, { floorAnchored: true, height: radius * 2 });
    context.group.add(object);
  }
  output.puzzleBlocks.push({
    ...cloneData(source),
    id: source.id,
    position: transform.position.clone(),
    radius,
    object,
    locked: source.locked === true,
  });
}

function createPressurePlate(source, transform, output, context) {
  const radius = finiteNumber(source.radius, 0.9);
  const object = new THREE.Group();
  object.name = source.name ?? source.id;
  placeObject(object, transform);
  if (context.visuals) {
    const base = cylinderMesh({ ...source, radius, height: 0.12 }, context.resources, context.getMaterial, 'trim', { radius, height: 0.12 });
    base.name = 'pressurePlateBase';
    base.position.y = 0.06;
    const ringGeometry = new THREE.RingGeometry(radius * 0.62, radius * 0.9, 28);
    ringGeometry.rotateX(-Math.PI * 0.5);
    context.resources.own(ringGeometry);
    const ring = new THREE.Mesh(ringGeometry, context.getMaterial({ materialId: source.accentMaterialId ?? 'accent' }, 'accent'));
    ring.name = 'pressurePlatePowerRing';
    ring.position.y = 0.13;
    const glyph = cylinderMesh({ ...source, radius: radius * 0.28, height: 0.05, materialId: source.accentMaterialId ?? 'accent' }, context.resources, context.getMaterial, 'accent', { radius: radius * 0.28, height: 0.05 });
    glyph.name = 'pressurePlatePowerGlyph';
    glyph.position.y = 0.15;
    object.add(base, ring, glyph);
    context.group.add(object);
  }
  output.pressurePlates.push({
    ...cloneData(source),
    id: source.id,
    label: source.label ?? source.displayName ?? 'Pressure Plate',
    position: transform.position.clone(),
    radius,
    object,
    active: source.active === true,
    activated: source.activated === true,
  });
}

function createShrine(source, transform, output, context) {
  const object = new THREE.Group();
  object.name = source.name ?? source.id;
  placeObject(object, transform);
  if (context.visuals) {
    const pedestal = cylinderMesh({ ...source, radius: source.radius ?? 0.9, height: source.height ?? 0.55 }, context.resources, context.getMaterial, 'shrine', { radius: 0.9, height: 0.55 });
    pedestal.position.y = finiteNumber(source.height, 0.55) * 0.5;
    object.add(pedestal);
    context.group.add(object);
  }
  output.shrine = {
    ...cloneData(source),
    id: source.id,
    label: source.label ?? source.displayName ?? 'Shrine',
    position: transform.position.clone(),
    object,
    activated: source.activated === true,
  };
  output.shrinePosition = transform.position.clone();
  output.interactables.push(output.shrine);
}

function createSafeZone(source, transform, output, context) {
  const zone = zoneDescriptor(source, transform, { width: 4, depth: 4, height: 3 });
  zone.label = source.label ?? source.displayName ?? 'Safe Zone';
  if (context.visuals && source.showVolume === true) {
    const size = { x: zone.halfWidth * 2, y: 0.04, z: zone.halfDepth * 2 };
    const mesh = boxMesh({ ...source, size, materialId: source.materialId ?? 'safe' }, context.resources, context.getMaterial, 'safe', size).mesh;
    mesh.material = mesh.material.clone();
    context.resources.own(mesh.material);
    mesh.material.transparent = true;
    mesh.material.opacity = finiteNumber(source.opacity, 0.2);
    placeObject(mesh, transform);
    context.group.add(mesh);
    zone.object = mesh;
  }
  output.safeZones.push(zone);
}

function createInteractable(source, transform, output, context) {
  let object = null;
  if (context.visuals && source.visual !== false) {
    object = cylinderMesh({ ...source, radius: source.radius ?? 0.28, height: source.height ?? 0.85 }, context.resources, context.getMaterial, 'accent', { radius: 0.28, height: 0.85 });
    object.name = source.name ?? source.id;
    placeObject(object, transform, { floorAnchored: true, height: finiteNumber(source.height, 0.85) });
    context.group.add(object);
  }
  const descriptor = {
    ...cloneData(source),
    id: source.id,
    label: source.label ?? source.displayName ?? 'Interact',
    action: source.action ?? source.interaction ?? source.id,
    position: transform.position.clone(),
    interactionRadius: finiteNumber(source.interactionRadius, 1.8),
    object: object ?? context.group,
  };
  output.interactables.push(descriptor);
  output.safeInteractables.push(descriptor);
}

/** Build compatible runtime records for the authored entity type catalog. */
export function assembleAuthoredGameplay(entities = [], options = {}) {
  const group = new THREE.Group();
  group.name = options.name ?? 'authoredGameplay';
  const resources = new DisposableResourceSet();
  const getMaterial = materialGetter(options.materials ?? options.materialLibrary, resources);
  const context = {
    group,
    resources,
    getMaterial,
    visuals: options.createVisuals !== false,
  };
  const output = {
    group,
    entities: [],
    entityById: new Map(),
    playerStarts: [],
    exits: [],
    doors: [],
    keycards: [],
    chests: [],
    encounters: [],
    traps: [],
    conveyors: [],
    ladders: [],
    connectorLifts: [],
    lifts: [],
    mechanisms: [],
    puzzleBlocks: [],
    pressurePlates: [],
    safeZones: [],
    safeInteractables: [],
    interactables: [],
    shrine: null,
    shrinePosition: null,
    playerStart: null,
    playerStartFacing: null,
    campReturnPosition: null,
    ruinEntryPosition: null,
    extractionPosition: null,
    resources,
    disposableResources: new Set(resources),
    diagnostics: { accepted: true, errors: [], warnings: [] },
  };

  const normalized = asArray(entities).map(normalizeEntity);
  for (const source of normalized) {
    const type = canonicalType(source);
    const transform = worldTransform(source, options.roomTransforms);
    const runtimeEntity = { source, type, transform };
    output.entities.push(runtimeEntity);
    output.entityById.set(source.id, runtimeEntity);
    switch (type) {
      case 'playerStart': {
        const facing = transformDirection(source.facing ?? source.direction ?? { x: 0, y: 0, z: -1 }, transform.matrix);
        const descriptor = { ...cloneData(source), position: transform.position.clone(), facing };
        output.playerStarts.push(descriptor);
        if (!output.playerStart || source.primary === true || source.id === options.spawnId) {
          output.playerStart = transform.position.clone();
          output.playerStartFacing = facing;
        }
        break;
      }
      case 'exit': {
        const descriptor = { ...cloneData(source), position: transform.position.clone(), facing: transformDirection(source.facing ?? { x: 0, y: 0, z: 1 }, transform.matrix) };
        output.exits.push(descriptor);
        const role = String(source.role ?? source.exitType ?? source.action ?? '').toLowerCase();
        if (role.includes('camp') || role.includes('return')) output.campReturnPosition = descriptor.position.clone();
        if (role.includes('entry') || role.includes('entrance')) output.ruinEntryPosition = descriptor.position.clone();
        if (role.includes('extract') || role.includes('complete')) output.extractionPosition = descriptor.position.clone();
        output.safeInteractables.push({ ...descriptor, action: source.action ?? 'exit', object: group });
        break;
      }
      case 'door': createDoor(source, transform, output, context); break;
      case 'keycard': createKeycard(source, transform, output, context); break;
      case 'chest': createChest(source, transform, output, context); break;
      case 'encounter': createEncounter(source, transform, output); break;
      case 'trap': createTrap(source, transform, output, context); break;
      case 'conveyor': createConveyor(source, transform, output, context); break;
      case 'ladder': createLadder(source, transform, output, context); break;
      case 'lift': createLift(source, transform, output, context); break;
      case 'mechanism': createMechanism(source, transform, output, context); break;
      case 'puzzleBlock': createPuzzleBlock(source, transform, output, context); break;
      case 'pressurePlate': createPressurePlate(source, transform, output, context); break;
      case 'shrine': createShrine(source, transform, output, context); break;
      case 'safeZone': createSafeZone(source, transform, output, context); break;
      case 'interactable': createInteractable(source, transform, output, context); break;
      default:
        output.diagnostics.warnings.push(`Unknown authored gameplay entity type ${source.type ?? source.kind ?? '<missing>'} (${source.id}).`);
        break;
    }
  }
  output.lifts = output.connectorLifts;
  output.playerStart ??= readVector3(options.defaultPlayerStart);
  output.playerStartFacing ??= readVector3(options.defaultPlayerFacing, { x: 0, y: 0, z: -1 }).normalize();
  output.ruinEntryPosition ??= output.playerStart.clone();
  output.campReturnPosition ??= output.playerStart.clone();
  output.diagnostics.accepted = output.diagnostics.errors.length === 0;
  let disposed = false;
  output.dispose = () => {
    if (disposed) return;
    disposed = true;
    group.removeFromParent();
    resources.dispose();
    output.disposableResources.clear();
  };
  Object.defineProperty(output, 'disposed', { enumerable: true, get: () => disposed });
  return output;
}

export const assembleGameplay = assembleAuthoredGameplay;
export const assembleGameplayEntities = assembleAuthoredGameplay;
export const createGameplayRuntime = assembleAuthoredGameplay;
export { canonicalType as canonicalGameplayEntityType };

