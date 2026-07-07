import * as THREE from 'three';

const PART_NAMES = [
  'head',
  'torso',
  'pelvis',
  'leftUpperArm',
  'leftForearm',
  'leftHand',
  'rightUpperArm',
  'rightForearm',
  'rightHand',
  'leftThigh',
  'leftKnee',
  'leftShin',
  'leftAnkleCuff',
  'leftFoot',
  'rightThigh',
  'rightKnee',
  'rightShin',
  'rightAnkleCuff',
  'rightFoot',
];

const PART_JOINTS = {
  head: 'neck',
  torso: 'spine',
  pelvis: 'hips',
  leftUpperArm: 'leftShoulder',
  leftForearm: 'leftElbow',
  leftHand: 'leftWrist',
  rightUpperArm: 'rightShoulder',
  rightForearm: 'rightElbow',
  rightHand: 'rightWrist',
  leftThigh: 'leftHip',
  leftKnee: 'leftKnee',
  leftShin: 'leftKnee',
  leftAnkleCuff: 'leftKnee',
  leftFoot: 'leftAnkle',
  rightThigh: 'rightHip',
  rightKnee: 'rightKnee',
  rightShin: 'rightKnee',
  rightAnkleCuff: 'rightKnee',
  rightFoot: 'rightAnkle',
};

const PROCEDURAL_REPLACEMENT_PARTS = new Set([
  'leftThigh',
  'leftKnee',
  'rightThigh',
  'rightKnee',
]);
const HIDDEN_WITH_BUSTER = ['rightForearm', 'rightHand'];
const BEAM_BLADE_TOTAL_FRAMES = 24;
const BEAM_BLADE_ACTIVE_START = 12 / BEAM_BLADE_TOTAL_FRAMES;
const BEAM_BLADE_SLASH_END = 16 / BEAM_BLADE_TOTAL_FRAMES;
const DEFAULT_BEAM_BLADE_COLOR = 0xa8ff8a;
const WALK_CYCLE_SPEED = 8.6;
const WALK_STEP_HIP_FORWARD = 0.66;
const WALK_STEP_SUPPORT_BEND = 0.1;
const WALK_STEP_KNEE_PITCH = THREE.MathUtils.degToRad(89.25);
const WALK_STEP_KNEE_YAW = THREE.MathUtils.degToRad(13.3);
const WALK_STEP_KNEE_ROLL = THREE.MathUtils.degToRad(-22);
const WALK_STEP_ANKLE_PITCH = THREE.MathUtils.degToRad(-4.9);
const WALK_STEP_ANKLE_YAW = THREE.MathUtils.degToRad(-22.55);
const WALK_STEP_ANKLE_ROLL = THREE.MathUtils.degToRad(-4);
const WALK_STEP_SIDE_TWIST_SCALE = 0.32;
const WALK_STEP_KNEE_FORWARD_OFFSET = -0.045;
const WALK_STEP_ANKLE_FORWARD_OFFSET = -0.13;
const BEAM_BLADE_POSE_JOINTS = [
  'hips',
  'spine',
  'neck',
  'leftShoulder',
  'leftElbow',
  'leftWrist',
  'rightShoulder',
  'rightElbow',
  'rightWrist',
  'leftHip',
  'leftKnee',
  'leftAnkle',
  'rightHip',
  'rightKnee',
  'rightAnkle',
];
const BEAM_BLADE_PLANTED_JOINTS = new Set([
  'leftHip',
  'leftKnee',
  'leftAnkle',
  'rightHip',
  'rightKnee',
  'rightAnkle',
]);
const tempVectorA = new THREE.Vector3();
const tempVectorB = new THREE.Vector3();
const tempVectorC = new THREE.Vector3();
const tempCentroid = new THREE.Vector3();
const tempNormalMatrix = new THREE.Matrix3();
const zeroEuler = new THREE.Euler();
const upVector = new THREE.Vector3(0, 1, 0);
const textureSamplerCache = new WeakMap();

function poseEuler(pitch = 0, yaw = 0, roll = 0) {
  return new THREE.Euler(
    THREE.MathUtils.degToRad(pitch),
    THREE.MathUtils.degToRad(yaw),
    THREE.MathUtils.degToRad(roll),
  );
}

const BEAM_BLADE_CHAMBER_POSE = {
  hips: poseEuler(0, 0, 0),
  spine: poseEuler(-4, 2, -2),
  neck: poseEuler(0, 0, 0),
  leftShoulder: poseEuler(8, 14, -55),
  leftElbow: poseEuler(11, -72, 7),
  leftWrist: poseEuler(0, 0, 0),
  rightShoulder: poseEuler(-2, 78, -5),
  rightElbow: poseEuler(19, 107, -31),
  rightWrist: poseEuler(0, 0, 0),
  leftHip: poseEuler(-45, -5, -7),
  leftKnee: poseEuler(62, -5, -2),
  leftAnkle: poseEuler(-14, 11, 2),
  rightHip: poseEuler(14, -42, -2),
  rightKnee: poseEuler(0, -4, 0),
  rightAnkle: poseEuler(0, 0, 0),
};

const BEAM_BLADE_RELEASE_POSE = {
  hips: poseEuler(-1, -8, -1),
  spine: poseEuler(-5, -16, -3),
  neck: poseEuler(0, 0, 0),
  leftShoulder: poseEuler(8, -4, -48),
  leftElbow: poseEuler(18, -26, 8),
  leftWrist: poseEuler(0, 0, 0),
  rightShoulder: poseEuler(-7, 42, 7),
  rightElbow: poseEuler(14, 34, -12),
  rightWrist: poseEuler(-4, -12, 10),
  leftHip: poseEuler(-39, -3, 7),
  leftKnee: poseEuler(64, -3, -1),
  leftAnkle: poseEuler(-10, 7, 1),
  rightHip: poseEuler(10, -24, -10),
  rightKnee: poseEuler(16, -2, 0),
  rightAnkle: poseEuler(0, 0, -2),
};

const BEAM_BLADE_ACTIVE_POSE = {
  hips: poseEuler(-2, -18, -2),
  spine: poseEuler(-8, -34, -5),
  neck: poseEuler(0, 4, 0),
  leftShoulder: poseEuler(10, -12, -40),
  leftElbow: poseEuler(24, -10, 8),
  leftWrist: poseEuler(0, 0, 0),
  rightShoulder: poseEuler(-9, -54, 8),
  rightElbow: poseEuler(10, 10, -4),
  rightWrist: poseEuler(-5, 28, 12),
  leftHip: poseEuler(-33, -2, 12),
  leftKnee: poseEuler(66, -2, 0),
  leftAnkle: poseEuler(-8, 5, 1),
  rightHip: poseEuler(6, -12, -14),
  rightKnee: poseEuler(22, 0, 0),
  rightAnkle: poseEuler(0, 0, -3),
};

const BEAM_BLADE_FOLLOW_POSE = {
  hips: poseEuler(-1, -22, -1),
  spine: poseEuler(-5, -40, -4),
  neck: poseEuler(0, 6, 0),
  leftShoulder: poseEuler(8, -14, -36),
  leftElbow: poseEuler(20, 0, 8),
  leftWrist: poseEuler(0, 0, 0),
  rightShoulder: poseEuler(-7, -95, 11),
  rightElbow: poseEuler(7, 8, -3),
  rightWrist: poseEuler(-3, 42, 10),
  leftHip: poseEuler(-29, 0, 11),
  leftKnee: poseEuler(58, 0, 0),
  leftAnkle: poseEuler(-6, 3, 1),
  rightHip: poseEuler(3, -6, -12),
  rightKnee: poseEuler(18, 0, 0),
  rightAnkle: poseEuler(0, 0, -2),
};

function stagedBeamBladeRotationValue(base, chamber, release, active, follow, weights) {
  const earlyWindup = THREE.MathUtils.lerp(base, chamber, 0.45);
  let value = THREE.MathUtils.lerp(base, earlyWindup, weights.beginWindup);

  value = THREE.MathUtils.lerp(value, chamber, weights.chamber);
  value = THREE.MathUtils.lerp(value, release, weights.release);
  value = THREE.MathUtils.lerp(value, active, weights.slash);
  value = THREE.MathUtils.lerp(value, follow, weights.followThrough);
  return THREE.MathUtils.lerp(value, base, weights.recovery);
}

function stagedBeamBladePlantedRotationValue(base, chamber, weights) {
  const earlyWindup = THREE.MathUtils.lerp(base, chamber, 0.45);
  let value = THREE.MathUtils.lerp(base, earlyWindup, weights.beginWindup);

  value = THREE.MathUtils.lerp(value, chamber, weights.chamber);
  return value;
}

function setBeamBladePoseTarget(map, name, weights) {
  const base = map.get(name) ?? zeroEuler;
  const baseX = base.x;
  const baseY = base.y;
  const baseZ = base.z;
  const chamber = BEAM_BLADE_CHAMBER_POSE[name] ?? base;
  const release = BEAM_BLADE_RELEASE_POSE[name] ?? chamber;
  const active = BEAM_BLADE_ACTIVE_POSE[name] ?? release;
  const follow = BEAM_BLADE_FOLLOW_POSE[name] ?? active;

  if (BEAM_BLADE_PLANTED_JOINTS.has(name)) {
    return setTarget(
      map,
      name,
      stagedBeamBladePlantedRotationValue(baseX, chamber.x, weights),
      stagedBeamBladePlantedRotationValue(baseY, chamber.y, weights),
      stagedBeamBladePlantedRotationValue(baseZ, chamber.z, weights),
    );
  }

  return setTarget(
    map,
    name,
    stagedBeamBladeRotationValue(baseX, chamber.x, release.x, active.x, follow.x, weights),
    stagedBeamBladeRotationValue(baseY, chamber.y, release.y, active.y, follow.y, weights),
    stagedBeamBladeRotationValue(baseZ, chamber.z, release.z, active.z, follow.z, weights),
  );
}

function createBuckets() {
  return new Map(PART_NAMES.map((partName) => [partName, {
    positions: [],
    normals: [],
    uvs: [],
    material: null,
  }]));
}

function cloneRigMaterial(material) {
  const source = Array.isArray(material) ? material[0] : material;
  const clone = source?.clone?.() ?? new THREE.MeshStandardMaterial({ color: 0xffffff });
  clone.side = THREE.FrontSide;
  clone.needsUpdate = true;
  return clone;
}

function makeSolidMaterial(name, color, options = {}) {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.44,
    metalness: options.metalness ?? 0.08,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
  });
  material.name = name;
  return material;
}

function capsuleGeometry(radius, totalLength) {
  if (THREE.CapsuleGeometry) {
    const cylinderLength = Math.max(0.01, totalLength - radius * 2);
    return new THREE.CapsuleGeometry(radius, cylinderLength, 8, 28);
  }

  return new THREE.CylinderGeometry(radius, radius, Math.max(0.01, totalLength), 28);
}

function createOrientedCapsule(name, localEnd, radius, material) {
  const length = Math.max(0.01, localEnd.length());
  const mesh = new THREE.Mesh(capsuleGeometry(radius, length), material);
  const direction = localEnd.clone().normalize();

  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.copy(localEnd).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(upVector, direction);
  return mesh;
}

function readPosition(attribute, index, target) {
  return target.fromBufferAttribute(attribute, index);
}

function readNormal(attribute, index, target) {
  return target.fromBufferAttribute(attribute, index);
}

function pushVector(array, vector) {
  array.push(vector.x, vector.y, vector.z);
}

function pushUv(array, attribute, index) {
  if (!attribute) {
    array.push(0, 0);
    return;
  }

  array.push(attribute.getX(index), attribute.getY(index));
}

function getMaterialTexture(material) {
  const source = Array.isArray(material) ? material[0] : material;
  return source?.map ?? null;
}

function getTextureSampler(texture) {
  const image = texture?.image;

  if (!image || typeof document === 'undefined') {
    return null;
  }

  const width = image.naturalWidth || image.videoWidth || image.width || 0;
  const height = image.naturalHeight || image.videoHeight || image.height || 0;

  if (width <= 0 || height <= 0) {
    return null;
  }

  if (textureSamplerCache.has(image)) {
    return textureSamplerCache.get(image);
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height).data;
    const sampler = { data, width, height };
    textureSamplerCache.set(image, sampler);
    return sampler;
  } catch {
    textureSamplerCache.set(image, null);
    return null;
  }
}

function sampleTriangleTextureColor(material, uvAttribute, a, b, c) {
  if (!uvAttribute) {
    return null;
  }

  const sampler = getTextureSampler(getMaterialTexture(material));

  if (!sampler) {
    return null;
  }

  const u = THREE.MathUtils.euclideanModulo(
    (uvAttribute.getX(a) + uvAttribute.getX(b) + uvAttribute.getX(c)) / 3,
    1,
  );
  const v = THREE.MathUtils.euclideanModulo(
    (uvAttribute.getY(a) + uvAttribute.getY(b) + uvAttribute.getY(c)) / 3,
    1,
  );
  const x = THREE.MathUtils.clamp(Math.floor(u * sampler.width), 0, sampler.width - 1);
  const y = THREE.MathUtils.clamp(Math.floor((1 - v) * sampler.height), 0, sampler.height - 1);
  const index = (y * sampler.width + x) * 4;

  return {
    r: sampler.data[index],
    g: sampler.data[index + 1],
    b: sampler.data[index + 2],
  };
}

function isBlueBootTexture(color) {
  return Boolean(color)
    && color.b > 115
    && color.b > color.r + 24
    && color.g > color.r + 8;
}

function isBlueShoulderShellTexture(color) {
  return Boolean(color)
    && color.b > 95
    && color.b > color.r + 35
    && color.g > color.r + 8;
}

function isGreyShoulderJointTexture(color) {
  if (!color) {
    return false;
  }

  const brightest = Math.max(color.r, color.g, color.b);
  const darkest = Math.min(color.r, color.g, color.b);
  const average = (color.r + color.g + color.b) / 3;

  return brightest - darkest < 42
    && average > 40
    && average < 195;
}

function getNormalizedY(point, bounds, height) {
  return height > 0 ? (point.y - bounds.min.y) / height : 0;
}

function sidePrefix(point, centerX) {
  return point.x >= centerX ? 'left' : 'right';
}

function isHeadMesh(meshName) {
  return meshName.includes('BodyMesh_c');
}

function shouldAttachToAnkleCuff(centroid, side, bounds, height, textureColor = null) {
  const normalizedY = getNormalizedY(centroid, bounds, height);

  if (normalizedY < 0.082) {
    return false;
  }

  const sign = side === 'left' ? 1 : -1;
  const centerX = (bounds.min.x + bounds.max.x) * 0.5;
  const footCenterX = centerX + sign * height * 0.165;
  const ballCenterZ = -height * 0.025;
  const inBallJointPocket = Math.abs(centroid.x - footCenterX) < height * 0.052
    && Math.abs(centroid.z - ballCenterZ) < height * 0.072;
  const inForwardBootShell = centroid.z > height * 0.045;

  if (isGreyShoulderJointTexture(textureColor) && inBallJointPocket) {
    return true;
  }

  if (isBlueBootTexture(textureColor) || isBlueShoulderShellTexture(textureColor)) {
    return false;
  }

  const inUpperAnkleBand = normalizedY > 0.118
    && normalizedY < 0.158
    && Math.abs(centroid.x - footCenterX) < height * 0.075;

  return inUpperAnkleBand && !inForwardBootShell;
}

function classifyTriangle(centroid, meshName, bounds, height, textureColor = null) {
  const normalizedY = getNormalizedY(centroid, bounds, height);
  const centerX = (bounds.min.x + bounds.max.x) * 0.5;
  const xOffset = centroid.x - centerX;
  const absX = Math.abs(xOffset);
  const side = sidePrefix(centroid, centerX);

  if (meshName.includes('HandMesh_L')) return 'leftHand';
  if (meshName.includes('HandMesh_R')) return 'rightHand';
  if (isHeadMesh(meshName)) return 'head';

  if (normalizedY > 0.55 && absX > height * 0.11) {
    return absX > height * 0.2 ? `${side}Forearm` : `${side}UpperArm`;
  }

  if (normalizedY < 0.5) {
    const legThreshold = normalizedY > 0.33 ? height * 0.014 : height * 0.035;

    if (absX <= legThreshold) {
      return normalizedY < 0.52 ? 'pelvis' : 'torso';
    }

    if (normalizedY < 0.15) {
      return shouldAttachToAnkleCuff(centroid, side, bounds, height, textureColor)
        ? `${side}AnkleCuff`
        : `${side}Foot`;
    }
    if (normalizedY < 0.31) return `${side}Shin`;
    if (normalizedY < 0.39) return `${side}Knee`;
    return `${side}Thigh`;
  }

  return normalizedY < 0.52 ? 'pelvis' : 'torso';
}

function getTriangleAttributeIndex(indexAttribute, triangle, corner) {
  return indexAttribute ? indexAttribute.getX(triangle * 3 + corner) : triangle * 3 + corner;
}

function quantizedPointKey(point) {
  const scale = 100000;
  return `${Math.round(point.x * scale)}:${Math.round(point.y * scale)}:${Math.round(point.z * scale)}`;
}

function getShoulderComponentPartName(componentBounds, colorCounts, bounds, height) {
  const faceCount = colorCounts.blue + colorCounts.grey + colorCounts.other;

  if (faceCount <= 0) {
    return null;
  }

  const centerX = (bounds.min.x + bounds.max.x) * 0.5;
  const componentCenter = componentBounds.getCenter(new THREE.Vector3());
  const side = sidePrefix(componentCenter, centerX);
  const normalizedMinY = getNormalizedY(componentBounds.min, bounds, height);
  const normalizedMaxY = getNormalizedY(componentBounds.max, bounds, height);
  const minSideOffset = Math.min(
    Math.abs(componentBounds.min.x - centerX),
    Math.abs(componentBounds.max.x - centerX),
  ) / height;
  const maxSideOffset = Math.max(
    Math.abs(componentBounds.min.x - centerX),
    Math.abs(componentBounds.max.x - centerX),
  ) / height;
  const blueRatio = colorCounts.blue / faceCount;
  const greyRatio = colorCounts.grey / faceCount;
  const isBlueShoulderIsland = blueRatio >= 0.8
    && normalizedMinY > 0.70
    && normalizedMaxY < 0.805
    && minSideOffset < 0.16
    && maxSideOffset > 0.105
    && maxSideOffset < 0.205;
  const isGreyShoulderIsland = greyRatio >= 0.8
    && normalizedMinY > 0.72
    && normalizedMaxY < 0.79
    && minSideOffset > 0.07
    && minSideOffset < 0.13
    && maxSideOffset > 0.10
    && maxSideOffset < 0.145;

  return isBlueShoulderIsland || isGreyShoulderIsland ? `${side}UpperArm` : null;
}

function getFootComponentPartName(componentBounds, colorCounts, bounds, height) {
  const faceCount = colorCounts.blue + colorCounts.grey + colorCounts.other;

  if (faceCount <= 0) {
    return null;
  }

  const centerX = (bounds.min.x + bounds.max.x) * 0.5;
  const componentCenter = componentBounds.getCenter(new THREE.Vector3());
  const side = sidePrefix(componentCenter, centerX);
  const normalizedMinY = getNormalizedY(componentBounds.min, bounds, height);
  const normalizedMaxY = getNormalizedY(componentBounds.max, bounds, height);
  const minSideOffset = Math.min(
    Math.abs(componentBounds.min.x - centerX),
    Math.abs(componentBounds.max.x - centerX),
  ) / height;
  const maxSideOffset = Math.max(
    Math.abs(componentBounds.min.x - centerX),
    Math.abs(componentBounds.max.x - centerX),
  ) / height;
  const blueRatio = colorCounts.blue / faceCount;
  const greyRatio = colorCounts.grey / faceCount;
  const isFootTopIsland = blueRatio >= 0.7
    && normalizedMinY < 0.13
    && normalizedMaxY < 0.18
    && minSideOffset < 0.25
    && maxSideOffset > 0.08
    && maxSideOffset < 0.27;
  const ballCenterZ = -height * 0.025;
  const inBallJointDepth = Math.abs(componentCenter.z - ballCenterZ) < height * 0.08
    && componentBounds.max.z < height * 0.075;
  const isAnkleBallJointIsland = greyRatio >= 0.7
    && normalizedMinY < 0.11
    && normalizedMaxY < 0.17
    && minSideOffset < 0.20
    && maxSideOffset > 0.12
    && maxSideOffset < 0.23
    && inBallJointDepth;

  if (isAnkleBallJointIsland) {
    return `${side}AnkleCuff`;
  }

  return isFootTopIsland ? `${side}Foot` : null;
}

function getTriangleComponentPartOverrides(mesh, bounds, height, positionAttribute, uvAttribute, indexAttribute, transform) {
  if (!mesh.name.includes('BodyMesh_m')) {
    return new Map();
  }

  const triangleCount = indexAttribute ? indexAttribute.count / 3 : positionAttribute.count / 3;
  const triangleData = [];
  const vertexToTriangles = new Map();

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const indices = [
      getTriangleAttributeIndex(indexAttribute, triangle, 0),
      getTriangleAttributeIndex(indexAttribute, triangle, 1),
      getTriangleAttributeIndex(indexAttribute, triangle, 2),
    ];
    const points = indices.map((index) => readPosition(positionAttribute, index, new THREE.Vector3()).applyMatrix4(transform));
    const color = sampleTriangleTextureColor(mesh.material, uvAttribute, indices[0], indices[1], indices[2]);
    const colorKind = isBlueBootTexture(color) || isBlueShoulderShellTexture(color)
      ? 'blue'
      : isGreyShoulderJointTexture(color)
        ? 'grey'
        : 'other';
    const data = { indices, points, colorKind };

    triangleData.push(data);

    for (const point of points) {
      const key = quantizedPointKey(point);
      const triangles = vertexToTriangles.get(key);

      if (triangles) {
        triangles.push(triangle);
      } else {
        vertexToTriangles.set(key, [triangle]);
      }
    }
  }

  const visited = new Set();
  const overrides = new Map();

  for (let start = 0; start < triangleCount; start += 1) {
    if (visited.has(start)) {
      continue;
    }

    const stack = [start];
    const component = [];
    const componentBounds = new THREE.Box3();
    const colorCounts = { blue: 0, grey: 0, other: 0 };
    visited.add(start);

    while (stack.length > 0) {
      const triangle = stack.pop();
      const data = triangleData[triangle];
      component.push(triangle);
      colorCounts[data.colorKind] += 1;

      for (const point of data.points) {
        componentBounds.expandByPoint(point);

        for (const neighbor of vertexToTriangles.get(quantizedPointKey(point)) ?? []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            stack.push(neighbor);
          }
        }
      }
    }

    const partName = getShoulderComponentPartName(componentBounds, colorCounts, bounds, height)
      ?? getFootComponentPartName(componentBounds, colorCounts, bounds, height);

    if (partName) {
      for (const triangle of component) {
        overrides.set(triangle, partName);
      }
    }
  }

  return overrides;
}

function shouldCullLegacyHipSocketTriangle(partName, centroid, bounds, height) {
  if (partName !== 'pelvis' && partName !== 'torso') {
    return false;
  }

  const normalizedY = getNormalizedY(centroid, bounds, height);
  if (normalizedY < 0.385 || normalizedY > 0.57) {
    return false;
  }

  const centerX = (bounds.min.x + bounds.max.x) * 0.5;
  const centerZ = (bounds.min.z + bounds.max.z) * 0.5;
  const absX = Math.abs(centroid.x - centerX);
  const backBias = centroid.z < centerZ ? height * 0.018 : 0;
  const sideCutoff = normalizedY > 0.49 ? height * 0.036 - backBias : height * 0.024;
  const outerLimit = height * 0.18;

  return absX > sideCutoff && absX < outerLimit;
}

function getPartBounds(bucket) {
  if (!bucket || bucket.positions.length < 3) {
    return null;
  }

  const bounds = new THREE.Box3();

  for (let i = 0; i < bucket.positions.length; i += 3) {
    tempVectorA.set(bucket.positions[i], bucket.positions[i + 1], bucket.positions[i + 2]);
    bounds.expandByPoint(tempVectorA);
  }

  return bounds;
}

function getBoundsCenter(bounds, target = new THREE.Vector3()) {
  return bounds ? bounds.getCenter(target) : target.set(0, 0, 0);
}

function sideInnerX(bounds, side) {
  return side === 'left' ? bounds.min.x : bounds.max.x;
}

function sideOuterX(bounds, side) {
  return side === 'left' ? bounds.max.x : bounds.min.x;
}

function lerpRotation(object, target, alpha) {
  if (!object) {
    return;
  }

  object.rotation.x = THREE.MathUtils.lerp(object.rotation.x, target.x, alpha);
  object.rotation.y = THREE.MathUtils.lerp(object.rotation.y, target.y, alpha);
  object.rotation.z = THREE.MathUtils.lerp(object.rotation.z, target.z, alpha);
}

function lerpPosition(object, target, alpha) {
  if (!object || !target) {
    return;
  }

  object.position.lerp(target, alpha);
}

function setTarget(map, name, x = 0, y = 0, z = 0) {
  let target = map.get(name);

  if (!target) {
    target = new THREE.Euler();
    map.set(name, target);
  }

  target.set(x, y, z);
  return target;
}

function setPositionTarget(map, name, basePosition, x = 0, y = 0, z = 0) {
  if (!basePosition) {
    return null;
  }

  let target = map.get(name);

  if (!target) {
    target = new THREE.Vector3();
    map.set(name, target);
  }

  target.set(basePosition.x + x, basePosition.y + y, basePosition.z + z);
  return target;
}

function addToTarget(map, name, x = 0, y = 0, z = 0) {
  let target = map.get(name);

  if (!target) {
    target = new THREE.Euler();
    map.set(name, target);
  }

  target.x += x;
  target.y += y;
  target.z += z;
  return target;
}

function blendTarget(map, name, targetX, targetY, targetZ, weight) {
  const current = map.get(name) ?? zeroEuler;
  return setTarget(
    map,
    name,
    THREE.MathUtils.lerp(current.x, targetX, weight),
    THREE.MathUtils.lerp(current.y, targetY, weight),
    THREE.MathUtils.lerp(current.z, targetZ, weight),
  );
}

function getWalkLegPose(phase) {
  const cycle = ((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const lifting = cycle < Math.PI;
  const stepProgress = lifting ? cycle / Math.PI : (cycle - Math.PI) / Math.PI;
  const lift = lifting ? Math.sin(stepProgress * Math.PI) : 0;
  const deliberateLift = Math.pow(lift, 0.72);
  const support = lifting ? 0 : Math.sin(stepProgress * Math.PI);
  const baseKnee = 0.06 + support * WALK_STEP_SUPPORT_BEND;
  const baseAnkle = support * 0.04;
  const settle = support * 0.55;

  return {
    hip: -deliberateLift * WALK_STEP_HIP_FORWARD + settle * 0.03,
    knee: THREE.MathUtils.lerp(baseKnee, WALK_STEP_KNEE_PITCH, deliberateLift),
    kneeYaw: WALK_STEP_KNEE_YAW * deliberateLift * WALK_STEP_SIDE_TWIST_SCALE,
    kneeRoll: WALK_STEP_KNEE_ROLL * deliberateLift * WALK_STEP_SIDE_TWIST_SCALE,
    ankle: THREE.MathUtils.lerp(baseAnkle, WALK_STEP_ANKLE_PITCH, deliberateLift),
    ankleYaw: WALK_STEP_ANKLE_YAW * deliberateLift * WALK_STEP_SIDE_TWIST_SCALE,
    anklePoseRoll: WALK_STEP_ANKLE_ROLL * deliberateLift * WALK_STEP_SIDE_TWIST_SCALE,
    kneeForward: WALK_STEP_KNEE_FORWARD_OFFSET * deliberateLift,
    ankleForward: WALK_STEP_ANKLE_FORWARD_OFFSET * deliberateLift,
    hipRoll: settle * 0.018,
    hipYaw: 0,
    ankleRoll: 0,
    contact: support,
    lift: deliberateLift,
  };
}

export class ExternalModelRig {
  constructor(sourceModel) {
    this.root = new THREE.Group();
    this.root.name = 'playerSegmentedAnimationRig';
    this.root.userData.externalModelRig = this;

    this.joints = new Map();
    this.restPositions = new Map();
    this.partMeshes = new Map();
    this.meshCount = 0;
    this.time = 0;
    this.walkPhase = 0;
    this.busterArmGroup = null;
    this.busterMuzzle = null;
    this.busterArmActive = false;
    this.drillArmGroup = null;
    this.drillBitSpin = null;
    this.drillTip = null;
    this.drillArmActive = false;
    this.drillSpinning = false;
    this.drillColor = new THREE.Color(0xffd36f);
    this.beamBladeGroup = null;
    this.beamBladeActive = false;
    this.beamBladeColor = new THREE.Color(DEFAULT_BEAM_BLADE_COLOR);
    this.debugPoseEnabled = false;
    this.debugPoseOverrides = new Map();
    this.legMaterials = {
      thigh: makeSolidMaterial('material_playerProceduralThigh', 0x57c0d2, { roughness: 0.5 }),
      knee: makeSolidMaterial('material_playerProceduralKnee', 0x1a57c8, { roughness: 0.38, metalness: 0.16 }),
    };

    this._buildFromModel(sourceModel);
    this._createAndAttachDrillArm();
  }

  setDebugPoseEnabled(enabled) {
    this.debugPoseEnabled = Boolean(enabled);

    if (this.debugPoseEnabled) {
      this._applyDebugPoseOverridesImmediate();
    }
  }

  setDebugPoseOverrides(overrides = {}) {
    this.debugPoseOverrides.clear();

    for (const [jointName, rotation] of Object.entries(overrides)) {
      this.debugPoseOverrides.set(jointName, new THREE.Vector3(
        rotation.x ?? 0,
        rotation.y ?? 0,
        rotation.z ?? 0,
      ));
    }

    if (this.debugPoseEnabled) {
      this._applyDebugPoseOverridesImmediate();
    }
  }

  updateDebugPoseOverride(jointName, axis, value) {
    const joint = this.joints.get(jointName);

    if (!joint || !['x', 'y', 'z'].includes(axis)) {
      return false;
    }

    const rotation = this.debugPoseOverrides.get(jointName) ?? new THREE.Vector3();
    rotation[axis] = value;
    this.debugPoseOverrides.set(jointName, rotation);

    if (this.debugPoseEnabled) {
      joint.rotation[axis] = value;
    }

    return true;
  }

  _applyDebugPoseOverrides(targets) {
    if (!this.debugPoseEnabled) {
      return;
    }

    for (const [jointName, rotation] of this.debugPoseOverrides.entries()) {
      setTarget(targets, jointName, rotation.x, rotation.y, rotation.z);
    }
  }

  _applyDebugPoseOverridesImmediate() {
    for (const [jointName, rotation] of this.debugPoseOverrides.entries()) {
      const joint = this.joints.get(jointName);

      if (joint) {
        joint.rotation.set(rotation.x, rotation.y, rotation.z);
      }
    }
  }

  setBusterArm(busterObject) {
    const elbow = this.joints.get('rightElbow');

    if (!elbow || !busterObject?.isObject3D) {
      return false;
    }

    if (this.busterArmGroup?.parent) {
      this.busterArmGroup.parent.remove(this.busterArmGroup);
    }

    busterObject.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(busterObject);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const group = new THREE.Group();

    group.name = 'rigBusterArmGroup';
    group.rotation.y = -Math.PI / 2;
    busterObject.position.sub(new THREE.Vector3(center.x, center.y, bounds.min.z));

    this.busterMuzzle = new THREE.Group();
    this.busterMuzzle.name = 'rigBusterMuzzle';
    this.busterMuzzle.position.set(0, 0, size.z + size.z * 0.12);
    this.beamBladeGroup = this._createBeamBladeGroup();
    this.busterMuzzle.add(this.beamBladeGroup);

    group.add(busterObject, this.busterMuzzle);
    elbow.add(group);
    this.busterArmGroup = group;
    this.setBusterArmActive(this.busterArmActive);
    this.setBeamBladeActive(this.beamBladeActive, this.beamBladeColor);
    return true;
  }

  setBusterArmActive(active) {
    this.busterArmActive = Boolean(active && this.busterArmGroup);

    if (this.busterArmGroup) {
      this.busterArmGroup.visible = this.busterArmActive;
    }

    this._syncRightArmReplacementVisibility();

    if (!this.busterArmActive && this.beamBladeGroup) {
      this.beamBladeGroup.visible = false;
    }
  }

  setDrillArmActive(active, color = null) {
    this.drillArmActive = Boolean(active && this.drillArmGroup);

    if (color !== null && color !== undefined) {
      this.drillColor.set(color);
      this._tintDrillArm();
    }

    if (this.drillArmGroup) {
      this.drillArmGroup.visible = this.drillArmActive;
    }

    if (this.drillArmActive && this.busterArmGroup) {
      this.busterArmGroup.visible = false;
    }

    this._syncRightArmReplacementVisibility();

    if (!this.drillArmActive) {
      this.setDrillSpinning(false);
    }
  }

  setDrillSpinning(active) {
    this.drillSpinning = Boolean(active && this.drillArmActive);
  }

  _syncRightArmReplacementVisibility() {
    const replacementActive = this.busterArmActive || this.drillArmActive;

    for (const partName of HIDDEN_WITH_BUSTER) {
      const mesh = this.partMeshes.get(partName);
      if (mesh) {
        mesh.visible = !replacementActive;
      }
    }
  }

  setBeamBladeActive(active, color = null) {
    this.beamBladeActive = Boolean(active);

    if (color !== null && color !== undefined) {
      this.beamBladeColor.set(color);
      this._tintBeamBlade();
    }

    if (!this.beamBladeActive && this.beamBladeGroup) {
      this.beamBladeGroup.visible = false;
    }
  }

  getBusterMuzzleWorldPosition(target = new THREE.Vector3()) {
    if (!this.busterArmActive || !this.busterMuzzle) {
      return null;
    }

    return this.busterMuzzle.getWorldPosition(target);
  }

  getDrillTipWorldPosition(target = new THREE.Vector3()) {
    if (!this.drillArmActive || !this.drillTip) {
      return null;
    }

    return this.drillTip.getWorldPosition(target);
  }

  _createAndAttachDrillArm() {
    const elbow = this.joints.get('rightElbow');

    if (!elbow) {
      return false;
    }

    const group = new THREE.Group();
    group.name = 'rigDrillArmGroup';
    group.rotation.y = -Math.PI / 2;
    group.visible = false;

    const shellMaterial = makeSolidMaterial('material_rigDrillShell', 0x315a9c, {
      roughness: 0.42,
      metalness: 0.26,
      emissive: 0x081428,
      emissiveIntensity: 0.12,
    });

    const bandMaterial = makeSolidMaterial('material_rigDrillBands', 0x9fb6c8, {
      roughness: 0.34,
      metalness: 0.38,
      emissive: 0x151b22,
      emissiveIntensity: 0.08,
    });

    const bitMaterial = makeSolidMaterial('material_rigDrillBit', this.drillColor.getHex(), {
      roughness: 0.28,
      metalness: 0.2,
      emissive: this.drillColor.getHex(),
      emissiveIntensity: 0.32,
    });

    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.21, 0.46, 20), shellMaterial);
    motor.name = 'rigDrillMotorHousing';
    motor.rotation.x = Math.PI / 2;
    motor.position.z = 0.2;
    motor.castShadow = true;

    const rearBand = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 20), bandMaterial);
    rearBand.name = 'rigDrillRearBand';
    rearBand.rotation.x = Math.PI / 2;
    rearBand.position.z = -0.02;
    rearBand.castShadow = true;

    const frontBand = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.08, 20), bandMaterial);
    frontBand.name = 'rigDrillFrontBand';
    frontBand.rotation.x = Math.PI / 2;
    frontBand.position.z = 0.43;
    frontBand.castShadow = true;

    const spin = new THREE.Group();
    spin.name = 'rigDrillBitSpin';
    spin.position.z = 0.52;

    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.72, 24), bitMaterial);
    cone.name = 'rigDrillBitCone';
    cone.rotation.x = Math.PI / 2;
    cone.position.z = 0.34;
    cone.castShadow = true;

    const ridgeMaterial = bitMaterial.clone();
    ridgeMaterial.name = 'material_rigDrillBitRidges';

    for (let i = 0; i < 3; i += 1) {
      const ridge = new THREE.Mesh(new THREE.TorusGeometry(0.115 - i * 0.018, 0.012, 6, 18), ridgeMaterial);
      ridge.name = `rigDrillBitRidge_${i + 1}`;
      ridge.position.z = 0.06 + i * 0.16;
      ridge.rotation.z = i * 0.8;
      spin.add(ridge);
    }

    this.drillTip = new THREE.Group();
    this.drillTip.name = 'rigDrillTip';
    this.drillTip.position.z = 0.76;

    spin.add(cone, this.drillTip);
    group.add(rearBand, motor, frontBand, spin);
    elbow.add(group);

    this.drillArmGroup = group;
    this.drillBitSpin = spin;
    this._tintDrillArm();
    return true;
  }

  _createBeamBladeGroup() {
    const group = new THREE.Group();
    group.name = 'rigLaserBeamBlade';
    group.visible = false;

    const glowMaterial = new THREE.MeshBasicMaterial({
      color: this.beamBladeColor,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    glowMaterial.name = 'material_rigLaserBeamBladeGlow';

    const coreMaterial = new THREE.MeshBasicMaterial({
      color: this.beamBladeColor,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    coreMaterial.name = 'material_rigLaserBeamBladeCore';

    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 1.35), glowMaterial);
    glow.name = 'rigLaserBeamBladeGlow';
    glow.position.z = 0.72;

    const core = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.035, 1.28), coreMaterial);
    core.name = 'rigLaserBeamBladeCore';
    core.position.z = 0.7;

    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.24, 8), glowMaterial);
    tip.name = 'rigLaserBeamBladeTip';
    tip.rotation.x = Math.PI / 2;
    tip.position.z = 1.45;

    group.add(glow, core, tip);
    return group;
  }

  _tintBeamBlade() {
    if (!this.beamBladeGroup) {
      return;
    }

    this.beamBladeGroup.traverse((object) => {
      if (object.material?.color) {
        object.material.color.copy(this.beamBladeColor);
      }
    });
  }

  _tintDrillArm() {
    if (!this.drillArmGroup) {
      return;
    }

    this.drillArmGroup.traverse((object) => {
      if (!object.material?.color) {
        return;
      }

      if (object.name.includes('DrillBit')) {
        object.material.color.copy(this.drillColor);
        if (object.material.emissive) {
          object.material.emissive.copy(this.drillColor);
          object.material.emissiveIntensity = 0.32;
        }
      }
    });
  }

  _updateDrillArmVisual(dt) {
    if (!this.drillArmGroup || !this.drillBitSpin) {
      return;
    }

    if (!this.drillArmActive) {
      this.drillArmGroup.visible = false;
      return;
    }

    this.drillArmGroup.visible = true;
    const spinSpeed = this.drillSpinning ? 38 : 2.8;
    this.drillBitSpin.rotation.z += dt * spinSpeed;
    const pulse = this.drillSpinning ? 1 + Math.sin(this.time * 48) * 0.035 : 1;
    this.drillBitSpin.scale.setScalar(pulse);
  }

  _updateBeamBladeVisual(visible, attackProgress) {
    if (!this.beamBladeGroup) {
      return;
    }

    const active = this.busterArmActive && this.beamBladeActive && visible;
    this.beamBladeGroup.visible = active;

    if (!active) {
      return;
    }

    const attackFrame = attackProgress * BEAM_BLADE_TOTAL_FRAMES;
    const charge = THREE.MathUtils.smoothstep(attackFrame, 6, 8) * (1 - THREE.MathUtils.smoothstep(attackFrame, 10, 12));
    const sweep = THREE.MathUtils.smoothstep(attackProgress, BEAM_BLADE_ACTIVE_START, BEAM_BLADE_SLASH_END);
    const strike = Math.sin(sweep * Math.PI);
    this.beamBladeGroup.scale.set(1 + charge * 0.08 + strike * 0.18, 1 + charge * 0.08 + strike * 0.18, 0.78 + charge * 0.12 + strike * 0.28);
    this.beamBladeGroup.rotation.z = Math.sin(this.time * 22) * 0.018 * charge + Math.sin(this.time * 30) * 0.025 * strike;
  }

  _updateBusterArmLocalPose(dt, state, attackKind, attackProgress) {
    if (!this.busterArmGroup) {
      return;
    }

    const attackFrame = attackProgress * BEAM_BLADE_TOTAL_FRAMES;
    const beginWindup = THREE.MathUtils.smoothstep(attackFrame, 0, 3);
    const chamber = THREE.MathUtils.smoothstep(attackFrame, 3, 6);
    const release = THREE.MathUtils.smoothstep(attackFrame, 10, 12);
    const slash = THREE.MathUtils.smoothstep(attackFrame, 12, 16);
    const recovery = THREE.MathUtils.smoothstep(attackFrame, 19, 24);
    const chamberHold = Math.max(beginWindup * 0.55, chamber) * (1 - release) * (1 - slash) * (1 - recovery);
    const slashSweep = slash * (1 - recovery);
    const alpha = Math.min(1, dt * 22);

    let targetX = 0;
    const targetY = -Math.PI / 2;
    let targetZ = 0;

    if (state === 'attacking' && attackKind === 'beamBlade') {
      targetX = 0.08 * chamberHold - 0.04 * slashSweep;
      targetZ = -0.04 * chamberHold + 0.06 * slashSweep;
    }

    this.busterArmGroup.rotation.x = THREE.MathUtils.lerp(this.busterArmGroup.rotation.x, targetX, alpha);
    this.busterArmGroup.rotation.y = THREE.MathUtils.lerp(this.busterArmGroup.rotation.y, targetY, alpha);
    this.busterArmGroup.rotation.z = THREE.MathUtils.lerp(this.busterArmGroup.rotation.z, targetZ, alpha);
  }

  update(dt, {
    moving = false,
    moveAmount = 0,
    state = 'idle',
    attackProgress = 0,
    hurtProgress = 0,
    projectileAiming = false,
    backpedaling = false,
    attackKind = 'melee',
  } = {}) {
    this.time += dt;
    if (moving) {
      const walkDirection = backpedaling ? -0.86 : 1;
      this.walkPhase += dt * WALK_CYCLE_SPEED * Math.max(0.55, moveAmount) * walkDirection;
    }

    const targets = new Map();
    const positionTargets = new Map();
    const alpha = Math.min(1, dt * (moving ? 20 : 12));
    const walkPhase = this.walkPhase;
    const leftLeg = getWalkLegPose(walkPhase);
    const rightLeg = getWalkLegPose(walkPhase + Math.PI);
    const walkBlend = moving ? THREE.MathUtils.clamp(moveAmount, 0, 1) : 0;
    const breathing = Math.sin(this.time * 2.4);
    const leftArmDrop = -1.28;
    const rightArmDrop = 1.28;
    const leftHipStraighten = -0.1;
    const rightHipStraighten = 0.1;

    if (moving) {
      setTarget(targets, 'leftHip', leftLeg.hip * walkBlend, leftLeg.hipYaw * walkBlend, leftHipStraighten + leftLeg.hipRoll * walkBlend);
      setTarget(targets, 'rightHip', rightLeg.hip * walkBlend, rightLeg.hipYaw * walkBlend, rightHipStraighten - rightLeg.hipRoll * walkBlend);
      setTarget(targets, 'leftKnee', leftLeg.knee * walkBlend, -leftLeg.kneeYaw * walkBlend, -leftLeg.kneeRoll * walkBlend);
      setTarget(targets, 'rightKnee', rightLeg.knee * walkBlend, rightLeg.kneeYaw * walkBlend, rightLeg.kneeRoll * walkBlend);
      setTarget(targets, 'leftAnkle', leftLeg.ankle * walkBlend, -leftLeg.ankleYaw * walkBlend, (-leftLeg.anklePoseRoll + leftLeg.ankleRoll) * walkBlend);
      setTarget(targets, 'rightAnkle', rightLeg.ankle * walkBlend, rightLeg.ankleYaw * walkBlend, (rightLeg.anklePoseRoll - rightLeg.ankleRoll) * walkBlend);
      setPositionTarget(positionTargets, 'leftKnee', this.joints.get('leftKnee')?.userData.restLocalPosition, 0, 0, leftLeg.kneeForward * walkBlend);
      setPositionTarget(positionTargets, 'rightKnee', this.joints.get('rightKnee')?.userData.restLocalPosition, 0, 0, rightLeg.kneeForward * walkBlend);
      setPositionTarget(positionTargets, 'leftAnkle', this.joints.get('leftAnkle')?.userData.restLocalPosition, 0, 0, leftLeg.ankleForward * walkBlend);
      setPositionTarget(positionTargets, 'rightAnkle', this.joints.get('rightAnkle')?.userData.restLocalPosition, 0, 0, rightLeg.ankleForward * walkBlend);

      const leftArmSwing = Math.sin(walkPhase + Math.PI) * 0.42 * walkBlend;
      const rightArmSwing = Math.sin(walkPhase) * 0.42 * walkBlend;
      setTarget(targets, 'leftShoulder', leftArmSwing, 0.04, leftArmDrop + leftArmSwing * 0.08);
      setTarget(targets, 'rightShoulder', rightArmSwing, -0.04, rightArmDrop - rightArmSwing * 0.08);
      setTarget(targets, 'leftElbow', leftArmSwing * 0.24, 0, 0);
      setTarget(targets, 'rightElbow', rightArmSwing * 0.24, 0, 0);
      const stepCompression = Math.max(leftLeg.contact, rightLeg.contact) * walkBlend;
      const hipRoll = Math.sin(walkPhase) * 0.026 * walkBlend;
      setTarget(targets, 'spine', stepCompression * 0.026, 0, -hipRoll * 0.58);
      setTarget(targets, 'hips', stepCompression * 0.018, Math.sin(walkPhase) * 0.025 * walkBlend, hipRoll);
    } else {
      setTarget(targets, 'spine', breathing * 0.004, 0, breathing * 0.006);
      setTarget(targets, 'neck', breathing * 0.008, 0, -breathing * 0.006);
      setTarget(targets, 'leftShoulder', 0.03, 0.03, leftArmDrop + breathing * 0.012);
      setTarget(targets, 'rightShoulder', -0.03, -0.03, rightArmDrop - breathing * 0.012);
      setTarget(targets, 'leftElbow', 0.03, 0, 0);
      setTarget(targets, 'rightElbow', -0.03, 0, 0);
      setTarget(targets, 'leftHip', 0, 0, leftHipStraighten);
      setTarget(targets, 'rightHip', 0, 0, rightHipStraighten);
      setTarget(targets, 'leftKnee', 0.06, 0, 0);
      setTarget(targets, 'rightKnee', 0.06, 0, 0);
    }

    if (state === 'attacking' && projectileAiming) {
      const aimWeight = Math.sin(THREE.MathUtils.clamp(attackProgress * 1.35, 0, 1) * Math.PI * 0.5);
      addToTarget(targets, 'spine', -0.04 * aimWeight, 0.1 * aimWeight, -0.03 * aimWeight);
      blendTarget(targets, 'rightShoulder', -0.05, Math.PI / 2, 0.04, aimWeight);
      blendTarget(targets, 'rightElbow', 0.02, 0, 0, aimWeight);
      blendTarget(targets, 'rightWrist', 0, 0, 0, aimWeight);
      blendTarget(targets, 'leftShoulder', 0.05, -Math.PI / 2 + 0.12, -0.86, aimWeight);
      blendTarget(targets, 'leftElbow', 0.18, -1.18, 0.92, aimWeight);
      blendTarget(targets, 'leftWrist', -0.36, -0.35, -0.62, aimWeight);
      addToTarget(targets, 'leftHip', -0.06 * aimWeight, 0, 0.16 * aimWeight);
      addToTarget(targets, 'rightHip', -0.06 * aimWeight, 0, -0.16 * aimWeight);
      addToTarget(targets, 'leftKnee', 0.1 * aimWeight, 0, 0);
      addToTarget(targets, 'rightKnee', 0.1 * aimWeight, 0, 0);
      addToTarget(targets, 'leftAnkle', -0.04 * aimWeight, 0, 0.035 * aimWeight);
      addToTarget(targets, 'rightAnkle', -0.04 * aimWeight, 0, -0.035 * aimWeight);

      if (backpedaling) {
        addToTarget(targets, 'spine', -0.03 * aimWeight, 0, 0);
        addToTarget(targets, 'hips', 0.04 * aimWeight, 0, 0);
      }
    } else if (state === 'attacking' && attackKind === 'beamBlade') {
      const attackFrame = attackProgress * BEAM_BLADE_TOTAL_FRAMES;
      const beginWindup = THREE.MathUtils.smoothstep(attackFrame, 0, 3);
      const chamber = THREE.MathUtils.smoothstep(attackFrame, 3, 6);
      const release = THREE.MathUtils.smoothstep(attackFrame, 10, 12);
      const slash = THREE.MathUtils.smoothstep(attackFrame, 12, 16);
      const followThrough = THREE.MathUtils.smoothstep(attackFrame, 16, 19);
      const recovery = THREE.MathUtils.smoothstep(attackFrame, 19, 24);
      const committed = 1 - recovery;
      const strike = Math.sin(slash * Math.PI);
      const weights = { beginWindup, chamber, release, slash, followThrough, recovery };

      for (const jointName of BEAM_BLADE_POSE_JOINTS) {
        setBeamBladePoseTarget(targets, jointName, weights);
      }

      addToTarget(targets, 'hips', -0.012 * strike * committed, 0, -0.01 * strike * committed);
      addToTarget(targets, 'spine', -0.018 * strike * committed, 0, -0.018 * strike * committed);
    } else if (state === 'attacking') {
      const swing = Math.sin(attackProgress * Math.PI);
      const followThrough = Math.sin(attackProgress * Math.PI * 0.5);
      addToTarget(targets, 'spine', 0, -0.12 * swing, -0.05 * swing);
      addToTarget(targets, 'rightShoulder', -0.18 * swing, -0.95 * swing, -0.42 * followThrough);
      addToTarget(targets, 'rightElbow', 0, -0.45 * swing, -0.2 * swing);
      addToTarget(targets, 'rightWrist', 0, -0.2 * swing, -0.22 * swing);
      addToTarget(targets, 'leftShoulder', 0.08 * swing, 0.22 * swing, 0.12 * swing);
    }

    if (state === 'hurt') {
      const recoil = Math.sin(hurtProgress * Math.PI) * 0.16;
      addToTarget(targets, 'spine', -0.12, 0, recoil);
      addToTarget(targets, 'neck', -0.16, 0, recoil * 0.6);
      addToTarget(targets, 'leftShoulder', -0.16, 0.08, 0.12);
      addToTarget(targets, 'rightShoulder', -0.16, -0.08, -0.12);
    }

    this._applyDebugPoseOverrides(targets);

    for (const [name, joint] of this.joints.entries()) {
      lerpRotation(joint, targets.get(name) ?? zeroEuler, alpha);
      lerpPosition(joint, positionTargets.get(name) ?? joint.userData.restLocalPosition, alpha);
    }

    this._updateBusterArmLocalPose(dt, state, attackKind, attackProgress);
    this._updateDrillArmVisual(dt);
    this._updateBeamBladeVisual(state === 'attacking' && attackKind === 'beamBlade', attackProgress);
  }

  _buildFromModel(sourceModel) {
    sourceModel.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(sourceModel);
    const size = bounds.getSize(new THREE.Vector3());
    const height = size.y;
    const buckets = createBuckets();

    sourceModel.traverse((object) => {
      if (!object.isMesh || !object.geometry?.attributes?.position) {
        return;
      }

      this._collectMeshTriangles(object, bounds, height, buckets);
    });

    const partBounds = new Map();

    for (const [partName, bucket] of buckets.entries()) {
      if (bucket.positions.length < 9) {
        continue;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uvs, 2));

      if (bucket.normals.length === bucket.positions.length) {
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.normals, 3));
      } else {
        geometry.computeVertexNormals();
      }

      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      bucket.geometry = geometry;
      partBounds.set(partName, getPartBounds(bucket));
    }

    const jointPositions = this._createJointHierarchy(bounds, height, partBounds);

    for (const [partName, bucket] of buckets.entries()) {
      if (!bucket.geometry || PROCEDURAL_REPLACEMENT_PARTS.has(partName)) {
        continue;
      }

      const jointName = PART_JOINTS[partName];
      const joint = this.joints.get(jointName) ?? this.root;
      const pivot = jointPositions.get(jointName) ?? new THREE.Vector3();
      const mesh = new THREE.Mesh(bucket.geometry, bucket.material ?? new THREE.MeshStandardMaterial({ color: 0xffffff }));
      mesh.name = `rigMesh_${partName}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.copy(pivot).multiplyScalar(-1);
      joint.add(mesh);
      this.partMeshes.set(partName, mesh);
      this.meshCount += 1;
    }

    this._createProceduralLegSections('left', jointPositions, partBounds, height);
    this._createProceduralLegSections('right', jointPositions, partBounds, height);
  }

  _collectMeshTriangles(mesh, bounds, height, buckets) {
    const geometry = mesh.geometry;
    const positionAttribute = geometry.attributes.position;
    const normalAttribute = geometry.attributes.normal ?? null;
    const uvAttribute = geometry.attributes.uv ?? null;
    const indexAttribute = geometry.index ?? null;
    const transform = mesh.matrixWorld;
    tempNormalMatrix.getNormalMatrix(transform);

    const triangleCount = indexAttribute ? indexAttribute.count / 3 : positionAttribute.count / 3;
    const componentPartOverrides = getTriangleComponentPartOverrides(
      mesh,
      bounds,
      height,
      positionAttribute,
      uvAttribute,
      indexAttribute,
      transform,
    );

    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const a = indexAttribute ? indexAttribute.getX(triangle * 3) : triangle * 3;
      const b = indexAttribute ? indexAttribute.getX(triangle * 3 + 1) : triangle * 3 + 1;
      const c = indexAttribute ? indexAttribute.getX(triangle * 3 + 2) : triangle * 3 + 2;

      readPosition(positionAttribute, a, tempVectorA).applyMatrix4(transform);
      readPosition(positionAttribute, b, tempVectorB).applyMatrix4(transform);
      readPosition(positionAttribute, c, tempVectorC).applyMatrix4(transform);
      tempCentroid.copy(tempVectorA).add(tempVectorB).add(tempVectorC).multiplyScalar(1 / 3);

      const textureColor = sampleTriangleTextureColor(mesh.material, uvAttribute, a, b, c);
      const partName = componentPartOverrides.get(triangle)
        ?? classifyTriangle(tempCentroid, mesh.name, bounds, height, textureColor);

      if (shouldCullLegacyHipSocketTriangle(partName, tempCentroid, bounds, height)) {
        continue;
      }

      const bucket = buckets.get(partName);
      bucket.material ??= cloneRigMaterial(mesh.material);

      pushVector(bucket.positions, tempVectorA);
      pushVector(bucket.positions, tempVectorB);
      pushVector(bucket.positions, tempVectorC);
      pushUv(bucket.uvs, uvAttribute, a);
      pushUv(bucket.uvs, uvAttribute, b);
      pushUv(bucket.uvs, uvAttribute, c);

      if (normalAttribute) {
        readNormal(normalAttribute, a, tempVectorA).applyMatrix3(tempNormalMatrix).normalize();
        readNormal(normalAttribute, b, tempVectorB).applyMatrix3(tempNormalMatrix).normalize();
        readNormal(normalAttribute, c, tempVectorC).applyMatrix3(tempNormalMatrix).normalize();
        pushVector(bucket.normals, tempVectorA);
        pushVector(bucket.normals, tempVectorB);
        pushVector(bucket.normals, tempVectorC);
      }
    }
  }

  _createJointHierarchy(bounds, height, partBounds) {
    const center = bounds.getCenter(new THREE.Vector3());
    const minY = bounds.min.y;
    const maxY = bounds.max.y;
    const jointPositions = new Map();

    const headBounds = partBounds.get('head');
    const torsoBounds = partBounds.get('torso');
    const pelvisBounds = partBounds.get('pelvis');
    const leftThighBounds = partBounds.get('leftThigh');
    const rightThighBounds = partBounds.get('rightThigh');

    const hipsPosition = getBoundsCenter(pelvisBounds, new THREE.Vector3(center.x, minY + height * 0.43, center.z));
    hipsPosition.y = pelvisBounds?.max.y ?? minY + height * 0.43;
    const spinePosition = getBoundsCenter(torsoBounds, new THREE.Vector3(center.x, minY + height * 0.55, center.z));
    spinePosition.y = torsoBounds?.min.y ?? minY + height * 0.52;
    const neckPosition = getBoundsCenter(headBounds, new THREE.Vector3(center.x, minY + height * 0.72, center.z));
    neckPosition.y = headBounds?.min.y ?? maxY - height * 0.28;

    this._registerJoint('hips', hipsPosition, this.root, jointPositions);
    this._registerJoint('spine', spinePosition, this.joints.get('hips'), jointPositions);
    this._registerJoint('neck', neckPosition, this.joints.get('spine'), jointPositions);

    this._createArmJoints('left', jointPositions, partBounds, spinePosition, height);
    this._createArmJoints('right', jointPositions, partBounds, spinePosition, height);
    this._createLegJoints('left', jointPositions, partBounds, hipsPosition, height, leftThighBounds);
    this._createLegJoints('right', jointPositions, partBounds, hipsPosition, height, rightThighBounds);

    return jointPositions;
  }

  _createArmJoints(side, jointPositions, partBounds, spinePosition, height) {
    const upper = partBounds.get(`${side}UpperArm`);
    const forearm = partBounds.get(`${side}Forearm`);
    const hand = partBounds.get(`${side}Hand`);
    const sign = side === 'left' ? 1 : -1;
    const shoulderFallback = new THREE.Vector3(sign * height * 0.16, spinePosition.y + height * 0.12, spinePosition.z);
    const shoulder = upper ? getBoundsCenter(upper, new THREE.Vector3()) : shoulderFallback.clone();

    if (upper) {
      shoulder.x = sideInnerX(upper, side);
      shoulder.y = (upper.min.y + upper.max.y) * 0.5;
    }

    const elbowFallback = shoulder.clone().add(new THREE.Vector3(sign * height * 0.16, -height * 0.02, 0));
    const elbow = upper ? getBoundsCenter(upper, new THREE.Vector3()) : elbowFallback;

    if (upper) {
      elbow.x = sideOuterX(upper, side);
      elbow.y = (upper.min.y + upper.max.y) * 0.5;
    }

    const wristSource = forearm ?? hand;
    const wristFallback = elbow.clone().add(new THREE.Vector3(sign * height * 0.16, -height * 0.02, 0));
    const wrist = wristSource ? getBoundsCenter(wristSource, new THREE.Vector3()) : wristFallback;

    if (wristSource) {
      wrist.x = sideOuterX(wristSource, side);
      wrist.y = (wristSource.min.y + wristSource.max.y) * 0.5;
    }

    this._registerJoint(`${side}Shoulder`, shoulder, this.joints.get('spine'), jointPositions);
    this._registerJoint(`${side}Elbow`, elbow, this.joints.get(`${side}Shoulder`), jointPositions);
    this._registerJoint(`${side}Wrist`, wrist, this.joints.get(`${side}Elbow`), jointPositions);
  }

  _createLegJoints(side, jointPositions, partBounds, hipsPosition, height, thighBounds) {
    const shin = partBounds.get(`${side}Shin`);
    const kneeSection = partBounds.get(`${side}Knee`);
    const ankleCuff = partBounds.get(`${side}AnkleCuff`);
    const foot = partBounds.get(`${side}Foot`);
    const sign = side === 'left' ? 1 : -1;
    const hip = thighBounds ? getBoundsCenter(thighBounds, new THREE.Vector3()) : hipsPosition.clone().add(new THREE.Vector3(sign * height * 0.07, 0, 0));

    if (thighBounds) {
      hip.y = thighBounds.max.y;
    }

    const kneeSource = kneeSection ?? shin;
    const knee = kneeSource ? getBoundsCenter(kneeSource, new THREE.Vector3()) : hip.clone().add(new THREE.Vector3(0, -height * 0.18, 0));
    if (kneeSection) {
      knee.y = (kneeSection.min.y + kneeSection.max.y) * 0.5;
    } else if (shin) {
      knee.y = shin.max.y;
    }

    const ankleSource = ankleCuff ?? foot;
    const ankle = ankleSource ? getBoundsCenter(ankleSource, new THREE.Vector3()) : knee.clone().add(new THREE.Vector3(0, -height * 0.18, 0));
    if (ankleCuff) {
      ankle.y = (ankleCuff.min.y + ankleCuff.max.y) * 0.5;
    } else if (foot) {
      ankle.y = foot.max.y;
    }

    this._registerJoint(`${side}Hip`, hip, this.joints.get('hips'), jointPositions);
    this._registerJoint(`${side}Knee`, knee, this.joints.get(`${side}Hip`), jointPositions);
    this._registerJoint(`${side}Ankle`, ankle, this.joints.get(`${side}Knee`), jointPositions);
  }

  _createProceduralLegSections(side, jointPositions, partBounds, height) {
    const hipPosition = jointPositions.get(`${side}Hip`);
    const kneePosition = jointPositions.get(`${side}Knee`);
    const hipJoint = this.joints.get(`${side}Hip`);
    const kneeJoint = this.joints.get(`${side}Knee`);

    if (!hipPosition || !kneePosition || !hipJoint || !kneeJoint) {
      return;
    }

    const thighBounds = partBounds.get(`${side}Thigh`);
    const kneeBounds = partBounds.get(`${side}Knee`);
    const thighWidth = thighBounds ? thighBounds.getSize(new THREE.Vector3()).x : height * 0.09;
    const radius = THREE.MathUtils.clamp(thighWidth * 0.42, height * 0.035, height * 0.062);
    const kneeRadius = Math.max(radius * 1.08, height * 0.044);
    const hipToKnee = kneePosition.clone().sub(hipPosition);
    const visibleThighEnd = hipToKnee.clone();

    if (visibleThighEnd.length() > kneeRadius * 0.35) {
      visibleThighEnd.setLength(visibleThighEnd.length() - kneeRadius * 0.18);
    }

    const thigh = createOrientedCapsule(
      `rigProcedural_${side}ThighCapsule`,
      visibleThighEnd,
      radius,
      this.legMaterials.thigh,
    );
    hipJoint.add(thigh);
    this.partMeshes.set(`${side}Thigh`, thigh);

    const knee = new THREE.Mesh(
      new THREE.SphereGeometry(kneeRadius, 18, 12),
      this.legMaterials.knee,
    );
    knee.name = `rigProcedural_${side}KneeSection`;
    knee.castShadow = true;
    knee.receiveShadow = true;
    knee.scale.set(1.08, 0.86, 0.98);

    if (kneeBounds) {
      const kneeCenter = getBoundsCenter(kneeBounds, new THREE.Vector3());
      knee.position.copy(kneeCenter).sub(kneePosition);
    }

    kneeJoint.add(knee);
    this.partMeshes.set(`${side}Knee`, knee);
    this.meshCount += 2;
  }

  _registerJoint(name, worldPosition, parent, jointPositions) {
    const joint = new THREE.Group();
    joint.name = `rigJoint_${name}`;

    const parentWorldPosition = parent?.userData?.restWorldPosition ?? new THREE.Vector3();
    joint.position.copy(worldPosition).sub(parentWorldPosition);
    joint.userData.restLocalPosition = joint.position.clone();
    joint.userData.restWorldPosition = worldPosition.clone();
    parent.add(joint);

    this.joints.set(name, joint);
    this.restPositions.set(name, worldPosition.clone());
    jointPositions.set(name, worldPosition.clone());
    return joint;
  }
}

export default ExternalModelRig;
