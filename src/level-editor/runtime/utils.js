import * as THREE from 'three';

const DEG_TO_RAD = Math.PI / 180;

export function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeId(value, fallback = '') {
  const id = String(value ?? '').trim();
  return id || fallback;
}

export function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).map(([id, entry]) => (
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? { id, ...entry }
      : { id, value: entry }
  ));
}

export function cloneData(value, seen = new WeakMap()) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Runtime descriptors may contain injected objects. Fall through to a
      // conservative recursive clone which preserves those objects by value.
    }
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return seen.get(value);
    const result = [];
    seen.set(value, result);
    for (const entry of value) result.push(cloneData(entry, seen));
    return result;
  }
  if (!value || typeof value !== 'object') return value;
  if (value.isVector3) return { x: value.x, y: value.y, z: value.z };
  if (value.isVector2) return { x: value.x, y: value.y };
  if (value.isEuler) return { x: value.x, y: value.y, z: value.z, order: value.order };
  if (value.isQuaternion) return { x: value.x, y: value.y, z: value.z, w: value.w };
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  if (seen.has(value)) return seen.get(value);
  const result = {};
  seen.set(value, result);
  for (const [key, entry] of Object.entries(value)) result[key] = cloneData(entry, seen);
  return result;
}

export function readVector3(value, fallback = null) {
  if (value?.isVector3) return value.clone();
  if (Array.isArray(value)) {
    return new THREE.Vector3(
      finiteNumber(value[0], fallback?.x ?? 0),
      finiteNumber(value[1], fallback?.y ?? 0),
      finiteNumber(value[2], fallback?.z ?? 0),
    );
  }
  if (value && typeof value === 'object') {
    return new THREE.Vector3(
      finiteNumber(value.x ?? value[0], fallback?.x ?? 0),
      finiteNumber(value.y ?? value[1], fallback?.y ?? 0),
      finiteNumber(value.z ?? value[2], fallback?.z ?? 0),
    );
  }
  return new THREE.Vector3(fallback?.x ?? 0, fallback?.y ?? 0, fallback?.z ?? 0);
}

export function readSize3(value, fallback = { x: 1, y: 1, z: 1 }) {
  if (typeof value === 'number') {
    const scalar = Math.max(0.0001, finiteNumber(value, 1));
    return new THREE.Vector3(scalar, scalar, scalar);
  }
  const normalized = value && typeof value === 'object' && !Array.isArray(value) && !value.isVector3
    ? {
        x: value.x ?? value.width ?? value.widthMeters,
        y: value.y ?? value.height ?? value.heightMeters ?? value.thickness,
        z: value.z ?? value.depth ?? value.depthMeters ?? value.length,
      }
    : value;
  const vector = readVector3(normalized, fallback);
  vector.set(
    Math.max(0.0001, Math.abs(vector.x)),
    Math.max(0.0001, Math.abs(vector.y)),
    Math.max(0.0001, Math.abs(vector.z)),
  );
  return vector;
}

function readRotationComponent(source, axis) {
  const upper = axis.toUpperCase();
  return source?.[axis]
    ?? source?.[`rotation${upper}`]
    ?? (axis === 'y' ? source?.yaw : axis === 'x' ? source?.pitch : source?.roll)
    ?? 0;
}

export function readEuler(value = {}, owner = value) {
  const degreeSource = owner?.rotationDegrees ?? owner?.eulerDegrees;
  if (degreeSource != null) {
    const degrees = readVector3(degreeSource);
    return new THREE.Euler(degrees.x * DEG_TO_RAD, degrees.y * DEG_TO_RAD, degrees.z * DEG_TO_RAD, 'XYZ');
  }
  const source = value && typeof value === 'object' ? value : {};
  const units = String(owner?.rotationUnits ?? owner?.angleUnits ?? 'radians').toLowerCase();
  const multiplier = units.startsWith('deg') ? DEG_TO_RAD : 1;
  const x = finiteNumber(readRotationComponent(source, 'x')) * multiplier;
  const y = finiteNumber(readRotationComponent(source, 'y')) * multiplier;
  const z = finiteNumber(readRotationComponent(source, 'z')) * multiplier;
  const yawDegrees = owner?.yawDegrees;
  return new THREE.Euler(
    x,
    yawDegrees == null ? y : finiteNumber(yawDegrees) * DEG_TO_RAD,
    z,
    String(owner?.rotationOrder ?? 'XYZ').toUpperCase(),
  );
}

export function readTransform(source = {}) {
  const transform = source?.transform && typeof source.transform === 'object'
    ? { ...source, ...source.transform }
    : source ?? {};
  const position = readVector3(
    transform.position
      ?? transform.translation
      ?? { x: transform.x, y: transform.y, z: transform.z },
  );
  const rotation = readEuler(transform.rotation ?? transform.euler ?? transform, transform);
  const scale = readSize3(transform.scale ?? { x: 1, y: 1, z: 1 });
  return { position, rotation, scale };
}

export function applyTransform(object, source = {}) {
  const { position, rotation, scale } = readTransform(source);
  object.position.copy(position);
  object.rotation.copy(rotation);
  object.scale.copy(scale);
  object.updateMatrix();
  return object;
}

export function transformMatrix(source = {}) {
  const { position, rotation, scale } = readTransform(source);
  return new THREE.Matrix4().compose(
    position,
    new THREE.Quaternion().setFromEuler(rotation),
    scale,
  );
}

export function transformPoint(value, matrix) {
  return readVector3(value).applyMatrix4(matrix);
}

export function transformDirection(value, matrix) {
  const direction = readVector3(value, { x: 0, y: 0, z: -1 });
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  direction.applyMatrix3(normalMatrix);
  return direction.lengthSq() > 0 ? direction.normalize() : direction.set(0, 0, -1);
}

export function setObjectMetadata(object, source = {}, defaults = {}) {
  object.name = normalizeId(source.name ?? source.id, defaults.name ?? object.name);
  object.visible = source.visible !== false;
  object.castShadow = source.castShadow ?? defaults.castShadow ?? true;
  object.receiveShadow = source.receiveShadow ?? defaults.receiveShadow ?? true;
  object.userData = {
    ...object.userData,
    ...(cloneData(defaults.userData) ?? {}),
    ...(cloneData(source.userData) ?? {}),
  };
  if (source.id != null) object.userData.authoredId = String(source.id);
  if (source.tags != null) object.userData.tags = [...asArray(source.tags).map((tag) => tag.value ?? tag.id ?? tag)];
  return object;
}

export class DisposableResourceSet extends Set {
  constructor(resources = []) {
    super(resources);
    this.disposed = false;
  }

  own(resource) {
    if (resource?.dispose && !this.disposed) this.add(resource);
    return resource;
  }

  ownObject(object, { materials = false } = {}) {
    object?.traverse?.((child) => {
      if (child.geometry?.dispose) this.add(child.geometry);
      if (materials) {
        const list = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of list) if (material?.dispose) this.add(material);
      }
    });
    return object;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const resource of this) {
      try {
        resource?.dispose?.();
      } catch {
        // Disposal is best-effort. One third-party resource must not prevent
        // the rest of an authored room from being released.
      }
    }
    this.clear();
  }
}

export function createBoxGeometry(size, resources = null) {
  const dimensions = readSize3(size);
  const geometry = new THREE.BoxGeometry(dimensions.x, dimensions.y, dimensions.z);
  resources?.own(geometry);
  return geometry;
}

export function addBeamBetween(parent, startValue, endValue, {
  width = 1,
  thickness = 0.2,
  material = null,
  name = 'authoredBeam',
  resources = null,
  userData = {},
} = {}) {
  const start = readVector3(startValue);
  const end = readVector3(endValue);
  const delta = end.clone().sub(start);
  const length = Math.max(0.0001, delta.length());
  const geometry = new THREE.BoxGeometry(Math.max(0.0001, width), Math.max(0.0001, thickness), length);
  resources?.own(geometry);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), delta.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { ...mesh.userData, ...cloneData(userData) };
  parent?.add(mesh);
  return mesh;
}

export function unwrapCompiledSource(source) {
  let current = source;
  const visited = new Set();
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const next = current.value ?? current.compiled ?? current.output ?? null;
    if (!next || next === current) break;
    if (current.schema || current.rooms || current.entities) break;
    current = next;
  }
  return current ?? {};
}

export function positionRecord(vector) {
  return { x: vector.x, y: vector.y, z: vector.z };
}
