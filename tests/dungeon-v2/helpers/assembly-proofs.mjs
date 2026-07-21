import * as THREE from 'three';
import Game from '../../../src/Game.js';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../../../src/TraversalCapabilities.js';
import { DungeonController } from '../../../src/DungeonController.js';
import { Player } from '../../../src/Player.js';
import { ACCEPTANCE_LIMITS } from './accepted-fixture.mjs';

function ids(record, kind) {
  const singular = record?.[kind] ?? record?.[`${kind}Id`];
  const plural = record?.[`${kind}s`] ?? record?.[`${kind}Ids`];
  return [singular, ...(Array.isArray(plural) ? plural : [])].filter(Boolean);
}

function unionVisualBounds(registry, record) {
  const union = new THREE.Box3();
  let populated = false;
  for (const id of ids(record, 'visual')) {
    const object = registry.visuals.get(id);
    if (!object?.isObject3D) continue;
    object.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(object);
    if (!bounds.isEmpty()) {
      union.union(bounds);
      populated = true;
    }
  }
  return populated ? union : null;
}

function colliderBounds(collider) {
  if (collider?.bounds?.min && collider?.bounds?.max) {
    return new THREE.Box3(
      new THREE.Vector3(collider.bounds.min.x, collider.bounds.min.y, collider.bounds.min.z),
      new THREE.Vector3(collider.bounds.max.x, collider.bounds.max.y, collider.bounds.max.z),
    );
  }
  if (collider?.position && Number.isFinite(collider.halfWidth) && Number.isFinite(collider.halfDepth)) {
    const halfHeight = Number(collider.verticalHalfHeight) || 0;
    return new THREE.Box3(
      new THREE.Vector3(collider.position.x - collider.halfWidth, collider.position.y - halfHeight, collider.position.z - collider.halfDepth),
      new THREE.Vector3(collider.position.x + collider.halfWidth, collider.position.y + halfHeight, collider.position.z + collider.halfDepth),
    );
  }
  return null;
}

function unionColliderBounds(registry, record) {
  const union = new THREE.Box3();
  let populated = false;
  for (const id of ids(record, 'collider')) {
    const bounds = colliderBounds(registry.colliders.get(id));
    if (bounds && !bounds.isEmpty()) {
      union.union(bounds);
      populated = true;
    }
  }
  return populated ? union : null;
}

function individualVisualBounds(registry, record) {
  const results = [];
  for (const id of ids(record, 'visual')) {
    const root = registry.visuals.get(id);
    if (!root?.isObject3D) continue;
    root.updateWorldMatrix(true, true);
    root.traverse((object) => {
      if (!object?.isMesh || !object.geometry) return;
      const bounds = new THREE.Box3().setFromObject(object);
      if (!bounds.isEmpty()) results.push({ id, object, bounds });
    });
  }
  return results;
}

function individualColliderBounds(registry, record) {
  return ids(record, 'collider').map((id) => ({
    id,
    collider: registry.colliders.get(id),
    bounds: colliderBounds(registry.colliders.get(id)),
  })).filter(({ bounds }) => bounds && !bounds.isEmpty());
}

function sampledAxis(min, max, spacing) {
  const count = Math.max(1, Math.ceil((max - min) / spacing));
  return Array.from({ length: count + 1 }, (_, index) => THREE.MathUtils.lerp(min, max, index / count));
}

function pointCovered(point, segments, tolerance = 0.03) {
  return segments.some(({ bounds }) => (
    point.x >= bounds.min.x - tolerance && point.x <= bounds.max.x + tolerance
    && point.y >= bounds.min.y - tolerance && point.y <= bounds.max.y + tolerance
    && point.z >= bounds.min.z - tolerance && point.z <= bounds.max.z + tolerance
  ));
}

function boundaryFaceAxes(side) {
  if (side === 'west' || side === 'east') return { fixed: 'x', axes: ['y', 'z'] };
  if (side === 'north' || side === 'south') return { fixed: 'z', axes: ['x', 'y'] };
  return { fixed: 'y', axes: ['x', 'z'] };
}

function openingHalfExtent(opening, axis, side) {
  if (axis === 'y') return Number(opening.dimensions?.height) * 0.5;
  if (side === 'west' || side === 'east') {
    return Number(opening.dimensions?.[axis === 'x' ? 'depth' : 'width']) * 0.5;
  }
  if (side === 'north' || side === 'south') {
    return Number(opening.dimensions?.[axis === 'z' ? 'depth' : 'width']) * 0.5;
  }
  return Number(opening.dimensions?.[axis === 'x' ? 'width' : 'depth']) * 0.5;
}

function pointInsideOpening(item, point) {
  const { axes } = boundaryFaceAxes(item.side);
  return (item.openings ?? []).some((opening) => axes.every((axis) => {
    const halfExtent = openingHalfExtent(opening, axis, item.side);
    return Number.isFinite(halfExtent)
      && point[axis] > opening.center[axis] - halfExtent + 0.015
      && point[axis] < opening.center[axis] + halfExtent - 0.015;
  }));
}

function sampleBoundaryOrSurface(item, proofKind, visualSegments, colliderSegments, spacing) {
  const expected = item.bounds;
  const samples = [];
  let points;
  if (proofKind === 'boundary') {
    const { fixed, axes } = boundaryFaceAxes(item.side);
    const fixedValue = (expected.min[fixed] + expected.max[fixed]) * 0.5;
    points = sampledAxis(expected.min[axes[0]], expected.max[axes[0]], spacing).flatMap((first) => (
      sampledAxis(expected.min[axes[1]], expected.max[axes[1]], spacing).map((second) => ({
        [fixed]: fixedValue,
        [axes[0]]: first,
        [axes[1]]: second,
      }))
    ));
  } else {
    const stairLike = item.form === 'stairs'
      || ['stairs', 'walkable-stairs', 'ladder'].includes(item.geometry?.type);
    if (stairLike) return samples;
    points = sampledAxis(expected.min.x, expected.max.x, spacing).flatMap((x) => (
      sampledAxis(expected.min.z, expected.max.z, spacing).map((z) => ({
        x, y: expected.max.y - 0.01, z,
      }))
    ));
  }
  for (const point of points) {
    const expectedSolid = proofKind !== 'boundary' || !pointInsideOpening(item, point);
    const visualCovered = pointCovered(point, visualSegments);
    const colliderCovered = pointCovered(point, colliderSegments);
    if (visualCovered !== expectedSolid || colliderCovered !== expectedSolid || visualCovered !== colliderCovered) {
      samples.push({ point, expectedSolid, visualCovered, colliderCovered });
      if (samples.length >= 128) break;
    }
  }
  return samples;
}

function maxBoundsDelta(left, right, surface = false) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const deltas = surface
    ? [left.min.x - right.min.x, left.max.x - right.max.x, left.min.z - right.min.z, left.max.z - right.max.z, left.max.y - right.max.y]
    : ['x', 'y', 'z'].flatMap((axis) => [left.min[axis] - right.min[axis], left.max[axis] - right.max[axis]]);
  return Math.max(...deltas.map(Math.abs));
}

function visualOutsideColliderDelta(visualBounds, collisionBounds) {
  if (!visualBounds || !collisionBounds) return Number.POSITIVE_INFINITY;
  return Math.max(
    collisionBounds.min.x - visualBounds.min.x,
    collisionBounds.min.y - visualBounds.min.y,
    collisionBounds.min.z - visualBounds.min.z,
    visualBounds.max.x - collisionBounds.max.x,
    visualBounds.max.y - collisionBounds.max.y,
    visualBounds.max.z - collisionBounds.max.z,
    0,
  );
}

function structuralObjects(plan) {
  return [
    ...plan.structuralBoundaries.map((item) => ({ ...item, proofKind: 'boundary' })),
    ...plan.walkableSurfaces.map((item) => ({ ...item, proofKind: 'surface' })),
    ...(plan.structuralFixtures ?? []).map((item) => ({ ...item, proofKind: 'fixture' })),
  ];
}

export function buildStructuralAssemblyProof(plan, facade) {
  const registry = facade.structuralRegistry;
  const mismatches = [];
  const transparentStructuralIds = [];
  const unregisteredVisualIds = [];
  const unregisteredColliderIds = [];
  const sampleSpacing = Math.min(plan.assemblyContract?.boundarySampleSpacing ?? 0.21, 0.21);
  for (const item of structuralObjects(plan)) {
    const record = registry.byPlanId.get(item.id);
    const visualIds = ids(record, 'visual');
    const colliderIds = ids(record, 'collider');
    if (!visualIds.length || visualIds.some((id) => !registry.visuals.has(id))) unregisteredVisualIds.push(item.id);
    if ((item.collision !== false || item.accessibility !== 'inaccessible')
      && (!colliderIds.length || colliderIds.some((id) => !registry.colliders.has(id)))) {
      unregisteredColliderIds.push(item.id);
    }
    for (const visualId of visualIds) {
      registry.visuals.get(visualId)?.traverse?.((object) => {
        const materials = Array.isArray(object.material) ? object.material : [object.material].filter(Boolean);
        if (item.proofKind !== 'fixture'
          && materials.some((material) => material.transparent === true && material.opacity < 0.999)) {
          transparentStructuralIds.push(item.id);
        }
      });
    }
    const visualBounds = unionVisualBounds(registry, record);
    const collisionBounds = unionColliderBounds(registry, record);
    const delta = item.proofKind === 'fixture'
      ? visualOutsideColliderDelta(visualBounds, collisionBounds)
      : maxBoundsDelta(visualBounds, collisionBounds, item.proofKind === 'surface');
    if (delta > (plan.assemblyContract?.visualCollisionParityTolerance ?? ACCEPTANCE_LIMITS.surfaceHeightTolerance)) {
      mismatches.push({ id: item.id, maxDelta: delta });
    }
    if (item.proofKind !== 'fixture') {
      const sampleMismatches = sampleBoundaryOrSurface(
        item,
        item.proofKind,
        individualVisualBounds(registry, record),
        individualColliderBounds(registry, record),
        sampleSpacing,
      );
      if (sampleMismatches.length) {
        mismatches.push({
          id: item.id,
          kind: 'sampled-face-parity',
          sampleSpacing,
          mismatchCountAtLeast: sampleMismatches.length,
          samples: sampleMismatches,
        });
      }
    }
  }
  return {
    sampleSpacing,
    mismatches,
    transparentStructuralIds: [...new Set(transparentStructuralIds)],
    unregisteredVisualIds,
    unregisteredColliderIds,
    physicalClearance: buildInternalTraversalAndActionProofs(plan, facade, { sampleSpacing }),
    ladderRuntime: buildLadderRuntimeProofs(plan, facade),
  };
}

function opaqueMaterial(material) {
  return material
    && material.visible !== false
    && material.transparent !== true
    && (material.opacity ?? 1) >= 0.999;
}

function extractOpaqueStructuralTriangles(facade) {
  const triangles = [];
  const roots = facade.structuralRegistry.getStructuralRaycastVisuals();
  facade.group?.updateWorldMatrix?.(true, true);
  for (const root of roots) {
    root.traverse((object) => {
      if (!object?.isMesh || !object.geometry || !objectEffectivelyVisible(object)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (!materials.some(opaqueMaterial)) return;
      const positions = object.geometry.getAttribute?.('position');
      if (!positions) return;
      const index = object.geometry.getIndex?.();
      const triangleCount = index ? index.count / 3 : positions.count / 3;
      for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
        const vertexIndices = index
          ? [index.getX(triangleIndex * 3), index.getX(triangleIndex * 3 + 1), index.getX(triangleIndex * 3 + 2)]
          : [triangleIndex * 3, triangleIndex * 3 + 1, triangleIndex * 3 + 2];
        const vertices = vertexIndices.map((vertexIndex) => new THREE.Vector3(
          positions.getX(vertexIndex),
          positions.getY(vertexIndex),
          positions.getZ(vertexIndex),
        ).applyMatrix4(object.matrixWorld));
        triangles.push(vertices);
      }
    });
  }
  return triangles;
}

const CLIP_PLANES = [
  (vertex) => vertex.x + vertex.w,
  (vertex) => vertex.w - vertex.x,
  (vertex) => vertex.y + vertex.w,
  (vertex) => vertex.w - vertex.y,
  (vertex) => vertex.z + vertex.w,
  (vertex) => vertex.w - vertex.z,
];

function clipPolygonAgainstPlane(polygon, distanceFor) {
  const result = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const currentDistance = distanceFor(current);
    const previousDistance = distanceFor(previous);
    const currentInside = currentDistance >= 0;
    const previousInside = previousDistance >= 0;
    if (currentInside !== previousInside) {
      const ratio = previousDistance / (previousDistance - currentDistance);
      result.push(new THREE.Vector4(
        THREE.MathUtils.lerp(previous.x, current.x, ratio),
        THREE.MathUtils.lerp(previous.y, current.y, ratio),
        THREE.MathUtils.lerp(previous.z, current.z, ratio),
        THREE.MathUtils.lerp(previous.w, current.w, ratio),
      ));
    }
    if (currentInside) result.push(current);
  }
  return result;
}

function rasterizeProjectedTriangle(vertices, width, height, depthBuffer) {
  const projected = vertices.map((vertex) => ({
    x: (vertex.x / vertex.w * 0.5 + 0.5) * width,
    y: (1 - (vertex.y / vertex.w * 0.5 + 0.5)) * height,
    z: vertex.z / vertex.w,
  }));
  const [a, b, c] = projected;
  const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(area) <= 1e-9) return false;
  const minimumX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
  const maximumX = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const minimumY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const maximumY = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  let wrotePixel = false;
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      const sampleX = x + 0.5;
      const sampleY = y + 0.5;
      const first = ((b.x - sampleX) * (c.y - sampleY) - (b.y - sampleY) * (c.x - sampleX)) / area;
      const second = ((c.x - sampleX) * (a.y - sampleY) - (c.y - sampleY) * (a.x - sampleX)) / area;
      const third = 1 - first - second;
      if (first < -1e-7 || second < -1e-7 || third < -1e-7) continue;
      const depth = first * a.z + second * b.z + third * c.z;
      const bufferIndex = y * width + x;
      if (depth < depthBuffer[bufferIndex]) {
        depthBuffer[bufferIndex] = depth;
        wrotePixel = true;
      }
    }
  }
  return wrotePixel;
}

function renderSoftwareFrame(triangles, camera, { width, height }) {
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const viewProjection = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const depthBuffer = new Float64Array(width * height);
  depthBuffer.fill(Number.POSITIVE_INFINITY);
  let rasterizedTriangleCount = 0;
  for (const triangle of triangles) {
    let polygon = triangle.map((vertex) => new THREE.Vector4(vertex.x, vertex.y, vertex.z, 1)
      .applyMatrix4(viewProjection));
    for (const clipPlane of CLIP_PLANES) {
      polygon = clipPolygonAgainstPlane(polygon, clipPlane);
      if (polygon.length < 3) break;
    }
    if (polygon.length < 3) continue;
    for (let index = 1; index < polygon.length - 1; index += 1) {
      if (rasterizeProjectedTriangle(
        [polygon[0], polygon[index], polygon[index + 1]],
        width,
        height,
        depthBuffer,
      )) rasterizedTriangleCount += 1;
    }
  }
  const clearPixels = [];
  let hash = 2166136261;
  for (let index = 0; index < depthBuffer.length; index += 1) {
    const depth = depthBuffer[index];
    if (!Number.isFinite(depth)) {
      if (clearPixels.length < 64) clearPixels.push({ x: index % width, y: Math.floor(index / width) });
      hash = Math.imul(hash ^ 0xffffffff, 16777619) >>> 0;
    } else {
      const quantized = Math.round((depth + 1) * 32767.5) >>> 0;
      hash = Math.imul(hash ^ quantized, 16777619) >>> 0;
    }
  }
  const backgroundPixelCount = depthBuffer.reduce((count, depth) => count + (Number.isFinite(depth) ? 0 : 1), 0);
  return {
    width,
    height,
    renderedPixelCount: depthBuffer.length - backgroundPixelCount,
    backgroundPixelCount,
    clearPixels,
    rasterizedTriangleCount,
    rasterHash: hash.toString(16).padStart(8, '0'),
  };
}

function pointInsideAnySpatialCell(plan, point, tolerance = 0.05) {
  return plan.spatialCells.some((cell) => inside(cell.bounds, point, tolerance));
}

function representativeRegionOrigins(plan) {
  const anchors = [...(plan.safeAnchors ?? []), ...(plan.anchors ?? [])];
  return plan.regions.map((region) => {
    const authored = anchors.find((anchor) => anchor.regionId === region.id);
    if (authored) return { id: authored.id, regionId: region.id, position: authored.position };
    const cell = plan.spatialCells.find((candidate) => candidate.regionId === region.id && candidate.playable);
    return {
      id: `${region.id}:cell-center`,
      regionId: region.id,
      position: {
        x: (cell.bounds.min.x + cell.bounds.max.x) * 0.5,
        y: cell.bounds.min.y + 1.2,
        z: (cell.bounds.min.z + cell.bounds.max.z) * 0.5,
      },
    };
  });
}

function authoredCameraEnvelopeAnchors(plan) {
  const anchorById = new Map([
    ...(plan.anchors ?? []).map((anchor) => [anchor.id, anchor]),
    ...(plan.safeAnchors ?? []).map((anchor) => [anchor.id, anchor]),
  ]);
  const idsToRender = new Set([
    ...(plan.safeAnchors ?? []).map((anchor) => anchor.id),
    ...(plan.actions ?? [])
      .filter((action) => action.interaction?.activationSide !== 'system')
      .map((action) => action.anchorId),
  ]);
  return [...idsToRender].map((id) => anchorById.get(id)).filter(Boolean);
}

function structuralRaycastContext(facade) {
  const roots = facade.structuralRegistry.getStructuralRaycastVisuals();
  const objectPlanIds = new WeakMap();
  for (const [visualId, root] of facade.structuralRegistry.visuals) {
    const planId = facade.structuralRegistry.visualMetadata?.get(visualId)?.planId
      ?? root.userData?.v2PlanId
      ?? null;
    root.traverse?.((object) => objectPlanIds.set(object, planId));
  }
  facade.group?.updateWorldMatrix?.(true, true);
  return { roots, objectPlanIds };
}

function firstOpaqueRayHit(raycaster, context) {
  return raycaster.intersectObjects(context.roots, true).find((hit) => {
    if (!objectEffectivelyVisible(hit.object)) return false;
    const materials = Array.isArray(hit.object.material) ? hit.object.material : [hit.object.material];
    const materialIndex = hit.face?.materialIndex;
    return Number.isInteger(materialIndex)
      ? opaqueMaterial(materials[materialIndex])
      : materials.some(opaqueMaterial);
  }) ?? null;
}

function ladderTraversalPlanIds(plan) {
  const planIds = new Set(
    (plan.walkableSurfaces ?? [])
      .filter((surface) => surface.geometry?.type === 'ladder')
      .map((surface) => surface.id),
  );
  for (const portal of plan.portals ?? []) {
    const ladder = portal.traversal?.ladder;
    if (portal.traversal?.mode !== 'ladder' || !ladder) continue;
    planIds.add(ladder.id ?? `${portal.id}:ladder`);
  }
  return planIds;
}

/**
 * Ladder rails and rungs are real opaque structure and remain part of the
 * offscreen enclosure render. They are not, however, horizontal landing
 * surfaces. A downward ray through an authored ladder aperture can strike the
 * curved top of a rung before reaching the playable floor below, so the
 * lower-space proof must continue to the first non-ladder structural hit.
 */
function firstOpaqueLowerSurfaceRayHit(raycaster, context) {
  return raycaster.intersectObjects(context.roots, true).find((hit) => {
    if (!objectEffectivelyVisible(hit.object)) return false;
    const materials = Array.isArray(hit.object.material) ? hit.object.material : [hit.object.material];
    const materialIndex = hit.face?.materialIndex;
    const opaque = Number.isInteger(materialIndex)
      ? opaqueMaterial(materials[materialIndex])
      : materials.some(opaqueMaterial);
    if (!opaque) return false;
    const planId = context.objectPlanIds.get(hit.object) ?? null;
    return !context.ladderTraversalPlanIds.has(planId);
  }) ?? null;
}

function hitWorldNormal(hit) {
  if (!hit?.face?.normal) return new THREE.Vector3();
  return hit.face.normal.clone().applyNormalMatrix(
    new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld),
  ).normalize();
}

function lowerVisibilityRaySamples(plan) {
  const samples = [];
  for (const surface of plan.walkableSurfaces) {
    if (surface.collision === false || surface.collision === 'none' || surface.collision === 'dynamic') continue;
    if (['ladder', 'stairs', 'walkable-stairs'].includes(surface.geometry?.type)) continue;
    const { min, max } = surface.bounds;
    const inset = Math.min(0.14, (max.x - min.x) * 0.15, (max.z - min.z) * 0.15);
    const lateralFractions = [0.25, 0.5, 0.75];
    for (const fraction of lateralFractions) {
      const x = THREE.MathUtils.lerp(min.x + inset, max.x - inset, fraction);
      const z = THREE.MathUtils.lerp(min.z + inset, max.z - inset, fraction);
      samples.push(
        { id: `${surface.id}:west:${fraction}`, sourceSurfaceId: surface.id, sourceRegionId: surface.regionId, origin: { x: min.x + inset, y: max.y + 1.55, z }, direction: { x: -0.82, y: -0.57, z: 0 } },
        { id: `${surface.id}:east:${fraction}`, sourceSurfaceId: surface.id, sourceRegionId: surface.regionId, origin: { x: max.x - inset, y: max.y + 1.55, z }, direction: { x: 0.82, y: -0.57, z: 0 } },
        { id: `${surface.id}:north:${fraction}`, sourceSurfaceId: surface.id, sourceRegionId: surface.regionId, origin: { x, y: max.y + 1.55, z: min.z + inset }, direction: { x: 0, y: -0.57, z: -0.82 } },
        { id: `${surface.id}:south:${fraction}`, sourceSurfaceId: surface.id, sourceRegionId: surface.regionId, origin: { x, y: max.y + 1.55, z: max.z - inset }, direction: { x: 0, y: -0.57, z: 0.82 } },
      );
    }
  }
  const anchorById = new Map([
    ...(plan.anchors ?? []).map((anchor) => [anchor.id, anchor]),
    ...(plan.safeAnchors ?? []).map((anchor) => [anchor.id, anchor]),
  ]);
  for (const anchor of anchorById.values()) {
    for (let directionIndex = 0; directionIndex < 8; directionIndex += 1) {
      const angle = directionIndex * Math.PI / 4;
      samples.push({
        id: `${anchor.id}:downward:${directionIndex}`,
        sourceSurfaceId: anchor.surfaceId ?? anchor.safeSurfaceId,
        sourceRegionId: anchor.regionId,
        origin: { x: anchor.position.x, y: anchor.position.y + 1.45, z: anchor.position.z },
        direction: { x: Math.sin(angle) * 0.78, y: -0.625, z: Math.cos(angle) * 0.78 },
      });
    }
  }
  return samples;
}

function resolveLowerHitSurface(plan, facade, point, hitPlanId = null) {
  const candidates = [];
  for (const surface of plan.walkableSurfaces) {
    if (surface.collision === false || surface.collision === 'none') continue;
    const support = surfacePointAt(surface, point.x, point.z, ACCEPTANCE_LIMITS.surfaceHeightTolerance);
    if (!support) continue;
    const delta = Math.abs(support.y - point.y);
    const authoredStairHit = surface.id === hitPlanId
      && ['stairs', 'walkable-stairs'].includes(surface.geometry?.type);
    if (delta <= ACCEPTANCE_LIMITS.surfaceHeightTolerance || (authoredStairHit && delta <= 0.18 + 1e-6)) {
      candidates.push({ surface, support, delta, authoredStairHit });
    }
  }
  candidates.sort((left, right) => Number(right.surface.id === hitPlanId) - Number(left.surface.id === hitPlanId)
    || left.delta - right.delta
    || left.surface.id.localeCompare(right.surface.id));
  const resolved = candidates[0];
  if (!resolved) return null;
  const record = facade.structuralRegistry.byPlanId.get(resolved.surface.id);
  const collisionBounds = unionColliderBounds(facade.structuralRegistry, record);
  const colliderIds = ids(record, 'collider');
  const collisionActive = colliderIds.length > 0 && colliderIds.every((id) => {
    const collider = facade.structuralRegistry.colliders.get(id);
    return collider && collider.active !== false && collider.enabled !== false;
  });
  const collisionHeightAtHit = resolved.authoredStairHit
    ? resolved.support.y
    : collisionBounds?.max.y;
  return { ...resolved, record, collisionBounds, collisionHeightAtHit, collisionActive };
}

function raycastHeadroom(point, context) {
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(point.x, point.y + 0.08, point.z),
    new THREE.Vector3(0, 1, 0),
    0.01,
    ACCEPTANCE_LIMITS.cameraProofRange,
  );
  const hit = firstOpaqueRayHit(raycaster, context);
  return {
    ceilingHit: Boolean(hit),
    headroom: hit ? Math.max(0, hit.point.y - point.y) : ACCEPTANCE_LIMITS.cameraProofRange,
    ceilingPlanId: hit ? context.objectPlanIds.get(hit.object) ?? null : null,
  };
}

function inspectLowerVisibilityRay(plan, facade, context, sample) {
  const origin = new THREE.Vector3(sample.origin.x, sample.origin.y, sample.origin.z);
  const direction = new THREE.Vector3(sample.direction.x, sample.direction.y, sample.direction.z).normalize();
  const raycaster = new THREE.Raycaster(origin, direction, 0.01, ACCEPTANCE_LIMITS.cameraProofRange);
  const hit = firstOpaqueLowerSurfaceRayHit(raycaster, context);
  if (!hit) return { kind: 'clear', sampleId: sample.id };
  const normal = hitWorldNormal(hit);
  const sourceSurface = plan.walkableSurfaces.find(({ id }) => id === sample.sourceSurfaceId);
  const sourceY = sourceSurface?.bounds?.max?.y ?? sample.origin.y - 1.45;
  if (normal.y < 0.55 || sourceY - hit.point.y < 0.5) return { kind: 'occluded', sampleId: sample.id };
  const hitPlanId = context.objectPlanIds.get(hit.object) ?? null;
  const resolved = resolveLowerHitSurface(plan, facade, hit.point, hitPlanId);
  if (!resolved) {
    return {
      kind: 'unresolved-lower-hit',
      sampleId: sample.id,
      sourceSurfaceId: sample.sourceSurfaceId,
      sourceRegionId: sample.sourceRegionId,
      hitPlanId,
      hitPoint: plainPoint(hit.point),
      elevationDelta: hit.point.y - sourceY,
      reason: 'no-registered-playable-walkable-surface-at-render-hit',
    };
  }
  const cell = plan.spatialCells.find(({ id }) => id === resolved.surface.cellId);
  const region = plan.regions.find(({ id }) => id === resolved.surface.regionId);
  const landingWidth = Math.min(
    resolved.surface.bounds.max.x - resolved.surface.bounds.min.x,
    resolved.surface.bounds.max.z - resolved.surface.bounds.min.z,
  );
  const headroom = raycastHeadroom(hit.point, context);
  const renderCollisionHeightDelta = Number.isFinite(resolved.collisionHeightAtHit)
    ? Math.abs(hit.point.y - resolved.collisionHeightAtHit)
    : Number.POSITIVE_INFINITY;
  const violations = [];
  if (!region || !cell || cell.playable !== true) violations.push('unowned-or-nonplayable-cell');
  if (!resolved.record) violations.push('surface-not-registered');
  if (!resolved.collisionActive) violations.push('surface-collider-inactive');
  if (landingWidth < ACCEPTANCE_LIMITS.minimumLandingWidth) violations.push('landing-too-narrow');
  if (!headroom.ceilingHit) violations.push('missing-authored-ceiling');
  if (headroom.headroom < ACCEPTANCE_LIMITS.minimumHeadroom) violations.push('insufficient-headroom');
  if (renderCollisionHeightDelta > ACCEPTANCE_LIMITS.surfaceHeightTolerance) violations.push('render-collision-height-mismatch');
  return {
    kind: 'resolved-lower-hit',
    sampleId: sample.id,
    sourceSurfaceId: sample.sourceSurfaceId,
    sourceRegionId: sample.sourceRegionId,
    targetSurfaceId: resolved.surface.id,
    targetRegionId: resolved.surface.regionId,
    targetCellId: resolved.surface.cellId,
    hitPlanId,
    hitPoint: plainPoint(hit.point),
    elevationDelta: hit.point.y - sourceY,
    landingWidth,
    headroom: headroom.headroom,
    ceilingHit: headroom.ceilingHit,
    ceilingPlanId: headroom.ceilingPlanId,
    renderCollisionHeightDelta,
    colliderActive: resolved.collisionActive,
    registeredPlayable: Boolean(region && cell?.playable === true && resolved.record),
    externallyVisible: true,
    violations,
  };
}

/**
 * Finds lower spaces from actual assembled structural ray hits. No declared
 * visibility link can create, suppress, or satisfy this proof.
 */
export function buildDownwardVisibilityProof(plan, facade) {
  const context = structuralRaycastContext(facade);
  context.ladderTraversalPlanIds = ladderTraversalPlanIds(plan);
  const baseSamples = lowerVisibilityRaySamples(plan);
  const results = baseSamples.map((sample) => inspectLowerVisibilityRay(plan, facade, context, sample));
  for (const fall of plan.falls ?? []) {
    const portal = plan.portals.find(({ id }) => id === fall.sourcePortalId);
    if (!portal) continue;
    withPortalTraversalProofState(plan, facade, portal, () => {
      const sourceSurfaceId = fall.sourceSurfaceId
        ?? portal.physicalRoute?.endpointSurfaceIds?.from;
      const center = portal.from.center;
      const fallSamples = [
        { x: 0, z: 0 }, { x: 0.65, z: 0 }, { x: -0.65, z: 0 },
        { x: 0, z: 0.65 }, { x: 0, z: -0.65 },
      ].map((offset, index) => ({
        id: `${fall.id}:assembled-drop:${index}`,
        sourceSurfaceId,
        sourceRegionId: portal.from.regionId,
        origin: { x: center.x + offset.x, y: center.y + 1.2, z: center.z + offset.z },
        direction: { x: 0, y: -1, z: 0 },
      }));
      results.push(...fallSamples.map((sample) => inspectLowerVisibilityRay(plan, facade, context, sample)));
    });
  }

  const rawResolved = results.filter(({ kind }) => kind === 'resolved-lower-hit');
  const uniqueResolved = new Map();
  for (const hit of rawResolved) {
    const key = `${hit.sourceRegionId}:${hit.targetRegionId}:${hit.targetSurfaceId}`;
    const current = uniqueResolved.get(key);
    if (!current || hit.violations.length < current.violations.length) uniqueResolved.set(key, hit);
  }
  const lowerHits = [...uniqueResolved.values()].map((hit) => ({
    ...hit,
    id: `downward-view:${hit.sourceRegionId}:${hit.targetRegionId}:${hit.targetSurfaceId}`,
  }));
  const unresolvedLowerHits = results.filter(({ kind }) => kind === 'unresolved-lower-hit');
  const invalidLowerHits = lowerHits.filter(({ violations }) => violations.length > 0);
  return {
    proofId: 'assembled-downward-raycast-v1',
    raycastDerived: true,
    maxRange: ACCEPTANCE_LIMITS.cameraProofRange,
    raysCast: baseSamples.length + (plan.falls ?? []).length * 5,
    lowerHits,
    unresolvedLowerHits,
    invalidLowerHits,
    accepted: context.roots.length > 0
      && unresolvedLowerHits.length === 0
      && invalidLowerHits.length === 0,
  };
}

/**
 * Deterministic CPU offscreen renderer. Unlike the independent ray proofs it
 * transforms and clips every opaque structural triangle, fills a depth-backed
 * raster, and fails on any background pixel visible from an authored shell or
 * third-person camera-envelope sample.
 */
export function buildOffscreenStructuralRenderProof(plan, facade, {
  shellResolution = 12,
  cameraResolution = { width: 16, height: 9 },
} = {}) {
  const triangles = extractOpaqueStructuralTriangles(facade);
  const frames = [];
  const transparentStructuralIds = [];
  for (const item of [...plan.structuralBoundaries, ...plan.walkableSurfaces]) {
    const record = facade.structuralRegistry.byPlanId.get(item.id);
    for (const visualId of ids(record, 'visual')) {
      const root = facade.structuralRegistry.visuals.get(visualId);
      root?.traverse?.((object) => {
        const materials = Array.isArray(object.material) ? object.material : [object.material].filter(Boolean);
        if (materials.some((material) => !opaqueMaterial(material))) transparentStructuralIds.push(item.id);
      });
    }
  }

  const shellDirections = [
    ['east', new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],
    ['west', new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)],
    ['ceiling', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1)],
    ['floor', new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1)],
    ['south', new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
    ['north', new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)],
  ];
  for (const source of representativeRegionOrigins(plan)) {
    const origin = new THREE.Vector3(source.position.x, source.position.y + 1.2, source.position.z);
    for (const [face, direction, up] of shellDirections) {
      const camera = new THREE.PerspectiveCamera(78, 1, 0.1, ACCEPTANCE_LIMITS.cameraProofRange);
      camera.position.copy(origin);
      camera.up.copy(up);
      camera.lookAt(origin.clone().add(direction));
      frames.push({
        kind: 'closed-shell',
        sampleId: `${source.regionId}:${face}`,
        regionId: source.regionId,
        cameraPosition: { x: origin.x, y: origin.y, z: origin.z },
        ...renderSoftwareFrame(triangles, camera, { width: shellResolution, height: shellResolution }),
      });
    }
  }

  const runtime = facade.environmentRuntime;
  const originalContainmentCount = runtime.cameraContainmentAdjustments;
  const originalLastContainment = runtime.lastCameraContainment;
  const unpairedBoundarySamples = [];
  const cardinalDirections = [
    ['north', new THREE.Vector3(0, 0, -1)],
    ['south', new THREE.Vector3(0, 0, 1)],
    ['east', new THREE.Vector3(1, 0, 0)],
    ['west', new THREE.Vector3(-1, 0, 0)],
  ];
  try {
    for (const anchor of authoredCameraEnvelopeAnchors(plan)) {
      for (const [facingId, forward] of cardinalDirections) {
        const desired = new THREE.Vector3(
          anchor.position.x - forward.x * 6.8,
          anchor.position.y + 3.25,
          anchor.position.z - forward.z * 6.8,
        );
        const camera = new THREE.PerspectiveCamera(48, cameraResolution.width / cameraResolution.height, 0.1, ACCEPTANCE_LIMITS.cameraProofRange);
        camera.position.copy(desired);
        const player = {
          root: { position: new THREE.Vector3(anchor.position.x, anchor.position.y, anchor.position.z) },
          getCameraFocusPosition(target) { return target.copy(this.root.position); },
        };
        const contained = runtime.constrainThirdPersonCamera(camera, player);
        const containment = contained ? runtime.lastCameraContainment : null;
        if (containment?.planId === 'spatial-cell-union'
          || !pointInsideAnySpatialCell(plan, camera.position)) {
          unpairedBoundarySamples.push({
            anchorId: anchor.id,
            facing: facingId,
            desiredPosition: { x: desired.x, y: desired.y, z: desired.z },
            finalPosition: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
            containmentPlanId: containment?.planId ?? null,
          });
        }
        const target = player.root.position.clone()
          .addScaledVector(forward, 1.7);
        target.y += 1.35;
        camera.lookAt(target);
        frames.push({
          kind: 'third-person-camera-envelope',
          sampleId: `${anchor.id}:${facingId}`,
          regionId: anchor.regionId,
          desiredPosition: { x: desired.x, y: desired.y, z: desired.z },
          cameraPosition: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          containmentApplied: contained,
          containmentPlanId: containment?.planId ?? null,
          ...renderSoftwareFrame(triangles, camera, cameraResolution),
        });
      }
    }
  } finally {
    runtime.cameraContainmentAdjustments = originalContainmentCount;
    runtime.lastCameraContainment = originalLastContainment;
  }

  const clearFrames = frames.filter(({ backgroundPixelCount }) => backgroundPixelCount > 0);
  const downwardVisibility = buildDownwardVisibilityProof(plan, facade);
  return {
    rendererId: 'deterministic-cpu-triangle-rasterizer-v1',
    maxRange: ACCEPTANCE_LIMITS.cameraProofRange,
    opaqueTriangleCount: triangles.length,
    frameCount: frames.length,
    frames,
    clearFrames,
    transparentStructuralIds: [...new Set(transparentStructuralIds)],
    unpairedBoundarySamples,
    downwardVisibility,
    accepted: triangles.length > 0
      && clearFrames.length === 0
      && transparentStructuralIds.length === 0
      && unpairedBoundarySamples.length === 0
      && downwardVisibility.accepted,
  };
}

function inside(bounds, point, tolerance = 0.001) {
  return point.x >= bounds.min.x - tolerance && point.x <= bounds.max.x + tolerance
    && point.y >= bounds.min.y - tolerance && point.y <= bounds.max.y + tolerance
    && point.z >= bounds.min.z - tolerance && point.z <= bounds.max.z + tolerance;
}

function samplesBetween(start, end, spacing) {
  const distance = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  const count = Math.max(1, Math.ceil(distance / spacing));
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count;
    return {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
      z: start.z + (end.z - start.z) * t,
    };
  });
}

const PHYSICAL_CAPSULE = Object.freeze({
  radius: PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
  height: Math.max(PLAYER_TRAVERSAL_ENVELOPE.standingHeight, ACCEPTANCE_LIMITS.minimumHeadroom),
});

const DYNAMIC_TRAVERSAL_MODES = new Set([
  'lift', 'cargo-lift', 'moving-platform', 'moving-cargo', 'gear-platform', 'corkscrew-gear',
]);

function plainPoint(point) {
  return { x: Number(point.x), y: Number(point.y), z: Number(point.z) };
}

function surfaceGeometryPath(surface) {
  const geometry = surface?.stairs ?? surface?.geometry;
  const path = geometry?.path ?? (geometry?.start && geometry?.end ? [geometry.start, geometry.end] : null);
  return Array.isArray(path) && path.length >= 2 ? path.map(plainPoint) : null;
}

function surfacePointAt(surface, x, z, tolerance = ACCEPTANCE_LIMITS.visualColliderSampleSpacing) {
  if (!surface?.bounds) return null;
  const path = surfaceGeometryPath(surface);
  const geometryType = surface.stairs ? 'stairs' : surface.geometry?.type;
  if (path && ['stairs', 'walkable-stairs'].includes(geometryType)) {
    const start = path[0];
    const end = path.at(-1);
    const runX = end.x - start.x;
    const runZ = end.z - start.z;
    const length = Math.hypot(runX, runZ);
    if (length <= 1e-6) return null;
    const directionX = runX / length;
    const directionZ = runZ / length;
    const along = (x - start.x) * directionX + (z - start.z) * directionZ;
    const lateral = Math.abs((x - start.x) * -directionZ + (z - start.z) * directionX);
    const width = Number(surface.geometry?.width ?? surface.stairs?.width ?? 0);
    if (along < -tolerance || along > length + tolerance || lateral > width * 0.5 + tolerance) return null;
    const ratio = THREE.MathUtils.clamp(along / length, 0, 1);
    return { x, y: THREE.MathUtils.lerp(start.y, end.y, ratio), z, surfaceId: surface.id };
  }
  const bounds = surface.bounds;
  if (x < bounds.min.x - tolerance || x > bounds.max.x + tolerance
    || z < bounds.min.z - tolerance || z > bounds.max.z + tolerance) return null;
  return { x, y: bounds.max.y, z, surfaceId: surface.id };
}

function centerOfSurface(surface) {
  const path = surfaceGeometryPath(surface);
  if (path) return plainPoint(path[Math.floor((path.length - 1) * 0.5)]);
  const x = (surface.bounds.min.x + surface.bounds.max.x) * 0.5;
  const z = (surface.bounds.min.z + surface.bounds.max.z) * 0.5;
  return surfacePointAt(surface, x, z, Number.POSITIVE_INFINITY)
    ?? { x, y: surface.bounds.max.y, z };
}

function activeBlockingColliders(facade) {
  return [...facade.structuralRegistry.colliders.values()]
    .filter((collider) => collider?.active !== false
      && collider?.enabled !== false
      && collider?.obstacleKind !== 'floor')
    .map((collider) => ({
      id: collider.id,
      planId: collider.planId ?? null,
      bounds: colliderBounds(collider),
    }))
    .filter(({ bounds }) => bounds && !bounds.isEmpty());
}

const PORTAL_SIDE_NORMALS = Object.freeze({
  west: Object.freeze({ x: -1, y: 0, z: 0 }),
  east: Object.freeze({ x: 1, y: 0, z: 0 }),
  north: Object.freeze({ x: 0, y: 0, z: -1 }),
  south: Object.freeze({ x: 0, y: 0, z: 1 }),
  floor: Object.freeze({ x: 0, y: -1, z: 0 }),
  ceiling: Object.freeze({ x: 0, y: 1, z: 0 }),
});

function boundsOverlapWithVolume(left, right, epsilon = 0.01) {
  return left.min.x < right.max.x - epsilon && left.max.x > right.min.x + epsilon
    && left.min.y < right.max.y - epsilon && left.max.y > right.min.y + epsilon
    && left.min.z < right.max.z - epsilon && left.max.z > right.min.z + epsilon;
}

function portalEndpointApproachVolume(portal, endpointName) {
  const endpoint = portal?.[endpointName];
  const normal = PORTAL_SIDE_NORMALS[endpoint?.side];
  if (!endpoint || !normal) return null;
  const width = Math.min(
    Number(endpoint.dimensions?.width),
    Number(portal.traversal?.minimumWidth ?? endpoint.dimensions?.width),
  );
  const verticalOpening = normal.y !== 0;
  const headroom = verticalOpening
    ? Number(portal.traversal?.minimumHeadroom)
    : Math.min(
      Number(endpoint.dimensions?.height),
      Number(portal.traversal?.minimumHeadroom ?? endpoint.dimensions?.height),
    );
  const depth = Math.max(
    verticalOpening ? Number(endpoint.dimensions?.depth) || 0 : 0,
    verticalOpening ? width : Number(endpoint.dimensions?.depth) || 0,
    verticalOpening ? 0 : Number(portal.traversal?.cameraClearance) || 0,
    verticalOpening ? 0 : PHYSICAL_CAPSULE.radius * 2 + 0.4,
  );
  if (![width, headroom, depth].every(Number.isFinite) || width <= 0 || headroom <= 0 || depth <= 0) {
    return null;
  }
  if (verticalOpening) {
    const planeY = Number(endpoint.center.y);
    const interiorDirectionY = -normal.y;
    const minimumY = interiorDirectionY > 0 ? planeY + 0.025 : planeY - headroom;
    const maximumY = interiorDirectionY > 0 ? planeY + headroom : planeY - 0.025;
    return {
      endpoint: endpointName,
      regionId: endpoint.regionId,
      cellId: endpoint.cellId,
      boundaryId: endpoint.boundaryId,
      declaredBy: 'portal-endpoint-traversal-contract',
      width,
      depth,
      headroom,
      bounds: {
        min: {
          x: Number(endpoint.center.x) - width * 0.5,
          y: minimumY,
          z: Number(endpoint.center.z) - depth * 0.5,
        },
        max: {
          x: Number(endpoint.center.x) + width * 0.5,
          y: maximumY,
          z: Number(endpoint.center.z) + depth * 0.5,
        },
      },
    };
  }
  const groundY = Number.isFinite(endpoint.elevation)
    ? Number(endpoint.elevation)
    : Number(endpoint.center.y) - Number(endpoint.dimensions.height) * 0.5;
  const center = {
    x: Number(endpoint.center.x) - normal.x * depth * 0.5,
    y: groundY + headroom * 0.5,
    z: Number(endpoint.center.z) - normal.z * depth * 0.5,
  };
  const halfX = normal.x === 0 ? width * 0.5 : depth * 0.5;
  const halfZ = normal.z === 0 ? width * 0.5 : depth * 0.5;
  return {
    endpoint: endpointName,
    regionId: endpoint.regionId,
    cellId: endpoint.cellId,
    boundaryId: endpoint.boundaryId,
    declaredBy: 'portal-endpoint-traversal-contract',
    width,
    depth,
    headroom,
    bounds: {
      min: { x: center.x - halfX, y: groundY + 0.025, z: center.z - halfZ },
      max: { x: center.x + halfX, y: groundY + headroom, z: center.z + halfZ },
    },
  };
}

function interactionExclusionBounds(anchor) {
  const radius = PHYSICAL_CAPSULE.radius;
  return {
    min: {
      x: Number(anchor.position.x) - radius,
      y: Number(anchor.position.y),
      z: Number(anchor.position.z) - radius,
    },
    max: {
      x: Number(anchor.position.x) + radius,
      y: Number(anchor.position.y) + 1.6,
      z: Number(anchor.position.z) + radius,
    },
  };
}

function createLadderProofPlayer(position) {
  const player = Object.create(Player.prototype);
  player.dead = false;
  player.root = new THREE.Group();
  player.root.position.copy(position);
  player.modelRoot = new THREE.Group();
  player.lastMoveDirection = new THREE.Vector3(0, 0, 1);
  player.jumpDirection = new THREE.Vector3(0, 0, 1);
  player.velocity = new THREE.Vector3();
  player.takeoffHorizontalVelocity = new THREE.Vector3();
  player.animation = {
    state: 'idle',
    actionState: null,
    hurtTimer: 0,
    attackTimer: 0,
    externalControlLocked: false,
    setState(state) { this.state = state; },
    update() {},
    isFullBodyActionActive() { return false; },
  };
  player.environmentTraversalProfile = {
    flooded: false,
    movementMultiplier: 1,
    jumpHeight: null,
    gravityScale: 1,
  };
  player.takeoffEnvironmentTraversalProfile = null;
  player.stats = { moveSpeed: 6.2 };
  player.jumpSettings = {
    forwardSpeed: 6.2,
    groundAcceleration: 24,
    groundDeceleration: 22,
    coyoteTime: 0.03,
  };
  player.gearEffects = {};
  player.jumpState = 'Grounded';
  player._jumpGroundY = position.y;
  player._coyoteTimer = 0.03;
  player._jumpBufferTimer = 0;
  player._landingRecoveryTimer = 0;
  player._jumpAirTimer = 0;
  player._jumpFallTransitionActive = false;
  player._jumpKind = 'forwardJump';
  player._jumpLandingVisualTimer = 0;
  player._jumpLandingVisualState = null;
  player._jumpLandingVisualClipKey = null;
  player._jumpSlashVisualState = null;
  player._forwardJumpTravelProgress = 0;
  player.radius = PLAYER_TRAVERSAL_ENVELOPE.collisionRadius;
  player.health = 100;
  player.jetSkateState = { active: false, windup: 0, speed: 0, wasGrounded: true };
  player.walkModeEnabled = false;
  player.slowMultiplier = 1;
  player.movementLockMultiplier = 1;
  player.attackFacingTimer = 0;
  player.attackFacingDirection = new THREE.Vector3(0, 0, 1);
  player.bracedFireTimer = 0;
  player.bracedBackpedalTimer = 0;
  player.bracedFireLocksFacing = false;
  player.pistolRunArcMotionClip = null;
  player.pistolRunArcMotionDirection = new THREE.Vector3();
  player.pistolRunArcMotionSpeedMultiplier = 1;
  player.pistolRunArcAccumulatedCameraTurn = 0;
  player.pistolRunArcLatchedTurnDirection = 0;
  player.ledgeCling = null;
  player._prepareForExternalControl = () => {};
  player.cancelTraversalMechanismLaunch = () => false;
  player.isPowerKnockbackActive = () => false;
  player.isExternalMotionActive = () => false;
  player._updatePistolRunArcCameraTurnAmount = () => 0;
  player._updateBarrierState = () => {};
  player._updateSwordJumpSlashVisualState = () => {};
  player._updateExternalMotion = () => false;
  player._updateStatusEffects = () => {};
  player._updateTemporaryStatBonuses = () => {};
  player._updateBracedFireState = () => {};
  player._updateShieldGuardState = () => {};
  player._updateMovementLockState = () => {};
  player._updateAttackFacingState = () => {};
  // Keep the fixture faithful to Player's real facing semantics. Merely
  // recording the requested direction leaves root.rotation.y unchanged and
  // can let a visually backward ladder mount pass an otherwise physical
  // runtime proof.
  player.faceDirection = Player.prototype.faceDirection.bind(player);
  player.updateWeaponVisualState = () => {};
  player._updateExternalModelMotion = () => {};
  return player;
}

function createLadderProofGame(player, facade) {
  const game = {
    player,
    enemies: [],
    ruinCompleted: false,
    elapsedTime: 0,
    dungeon: facade,
    platformingPlatforms: (facade.platforms ?? []).filter(({ dynamic }) => dynamic !== true),
    dynamicPlatformingPlatforms: (facade.platforms ?? []).filter(({ dynamic }) => dynamic === true),
    debugSpawnedPlatforms: [],
    showToast: () => {},
    addParticleBurst: () => {},
    ui: { showToast: () => {} },
    combat: {},
    scene: new THREE.Scene(),
  };
  // Exercise the production support semantics against the actual assembled
  // static and dynamic platforms. The old empty helpers made every ladder
  // exit appear supported and allowed collision snap-back to go unnoticed.
  for (const methodName of [
    '_getPlatformingSurfaces',
    '_getPlatformFloorElevation',
    'getPlatformSupport',
    'getPlatformFloorElevation',
    '_isPositionInsidePlatformBlock',
    'isPositionInsidePlatformBlock',
  ]) {
    game[methodName] = Game.prototype[methodName].bind(game);
  }
  return game;
}

function ladderExitEgressContract(ladder, exitName) {
  const landing = ladder.landings?.[exitName] ?? null;
  const facing = ladder[`${exitName}ExitFacing`] ?? landing?.egressDirection ?? null;
  const direction = new THREE.Vector3(
    Number(facing?.x) || 0,
    0,
    Number(facing?.z) || 0,
  );
  if (direction.lengthSq() > 0.0001) direction.normalize();
  return {
    exitName,
    landing,
    direction,
    authoredClearLength: Number(landing?.minimumClearLength),
  };
}

function exerciseLadderExitEgress(facade, controller, player, ladder, exitName) {
  const contract = ladderExitEgressContract(ladder, exitName);
  const start = player.root.position.clone();
  const safeguardBefore = Number(facade.environmentRuntime?.safeguardActivations) || 0;
  const input = new Set(['KeyW']);
  const sampleFrames = [];
  let maximumProjectedDistance = 0;
  let maximumHorizontalConstraintCorrection = 0;
  let finiteFrames = true;
  let remainedGrounded = player.isJumpAirborne?.() !== true;
  let supportLost = false;
  let snapBackDetected = false;
  const maximumFrames = 180;
  let frameCount = 0;
  while (frameCount < maximumFrames
    && maximumProjectedDistance + 0.001 < contract.authoredClearLength) {
    const beforeUpdate = player.root.position.clone();
    player.update(1 / 60, input, {
      arenaRadius: 1000,
      game: controller.game,
    });
    const beforeConstraint = player.root.position.clone();
    controller.game.elapsedTime += 1 / 60;
    controller.update(1 / 60);
    const afterConstraint = player.root.position.clone();
    const horizontalCorrection = Math.hypot(
      afterConstraint.x - beforeConstraint.x,
      afterConstraint.z - beforeConstraint.z,
    );
    const projectedDistance = (afterConstraint.x - start.x) * contract.direction.x
      + (afterConstraint.z - start.z) * contract.direction.z;
    const attemptedDistance = Math.hypot(
      beforeConstraint.x - beforeUpdate.x,
      beforeConstraint.z - beforeUpdate.z,
    );
    const platformSupport = controller.game.getPlatformSupport(afterConstraint);
    const floorTileSupport = platformSupport
      ? null
      : controller.getFloorTileAt(afterConstraint, { allowClosest: false });
    // Production walkability deliberately accepts either an authored platform
    // or its plan-derived floor-tile projection. Connector thresholds can
    // cross from one to the other without losing physical ground.
    const hasWalkableSupport = controller.isPositionWalkable(afterConstraint);
    maximumProjectedDistance = Math.max(maximumProjectedDistance, projectedDistance);
    maximumHorizontalConstraintCorrection = Math.max(
      maximumHorizontalConstraintCorrection,
      horizontalCorrection,
    );
    finiteFrames = finiteFrames && afterConstraint.toArray().every(Number.isFinite);
    remainedGrounded = remainedGrounded && player.isJumpAirborne?.() !== true;
    supportLost = supportLost || !hasWalkableSupport;
    snapBackDetected = snapBackDetected
      || (attemptedDistance > 0.001 && horizontalCorrection > 0.025);
    if (frameCount % 6 === 0 || projectedDistance >= contract.authoredClearLength) {
      sampleFrames.push({
        frame: frameCount,
        position: plainPoint(afterConstraint),
        projectedDistance,
        horizontalConstraintCorrection: horizontalCorrection,
        supportSurfaceId: platformSupport?.surface?.id
          ?? floorTileSupport?.surfaceId
          ?? floorTileSupport?.id
          ?? null,
      });
    }
    frameCount += 1;
  }
  const safeguardAfter = Number(facade.environmentRuntime?.safeguardActivations) || 0;
  const landingContractPresent = Boolean(contract.landing
    && contract.direction.lengthSq() > 0.999
    && Number.isFinite(contract.authoredClearLength)
    && contract.authoredClearLength > 0);
  const accepted = landingContractPresent
    && finiteFrames
    && remainedGrounded
    && !supportLost
    && !snapBackDetected
    && maximumProjectedDistance + 0.001 >= contract.authoredClearLength
    && safeguardAfter === safeguardBefore;
  return {
    publicPlayerUpdate: true,
    publicControllerConstraint: true,
    inputCodes: ['KeyW'],
    jumpInputUsed: false,
    exitName,
    landingSurfaceId: contract.landing?.surfaceId ?? null,
    exitFacing: plainPoint(contract.direction),
    authoredClearLength: contract.authoredClearLength,
    frameCount,
    maximumFrames,
    maximumProjectedDistance,
    maximumHorizontalConstraintCorrection,
    finiteFrames,
    remainedGrounded,
    supportLost,
    snapBackDetected,
    safeguardActivations: safeguardAfter - safeguardBefore,
    finalPosition: plainPoint(player.root.position),
    sampleFrames,
    accepted,
  };
}

function exerciseLadderRuntime(facade, ladder, direction) {
  const ascending = direction === 'up';
  const start = ascending ? ladder.bottomExit : ladder.topExit;
  const expectedExit = ascending ? ladder.topExit : ladder.bottomExit;
  const inputCode = ascending ? 'KeyW' : 'KeyS';
  const player = createLadderProofPlayer(start);
  const controller = new DungeonController(createLadderProofGame(player, facade), facade);
  const safeguardBefore = Number(facade.environmentRuntime?.safeguardActivations) || 0;
  controller.update(0);
  const positionAfterInitialConstraint = plainPoint(player.root.position);
  const interactable = controller.getNearestInteractable();
  const promptFound = interactable?.kind === 'ladder' && interactable?.target?.id === ladder.id;
  const mounted = promptFound && controller.activateNearest() === true
    && player.getLadderTraversalDiagnostics()?.ladderId === ladder.id;
  const visualPlane = ladder.object?.userData?.v2LadderPlane ?? null;
  const alignmentSamples = [];
  const sampleAlignment = () => {
    const diagnostics = player.getLadderTraversalDiagnostics();
    if (!diagnostics) return;
    alignmentSamples.push({
      height: diagnostics.height,
      signedPlaneClearance: diagnostics.signedPlaneClearance,
      facingAlignment: diagnostics.facingAlignment,
    });
  };
  sampleAlignment();
  let minimumY = player.root.position.y;
  let maximumY = player.root.position.y;
  let climbingFrames = 0;
  let finiteFrames = true;
  const maximumFrames = 900;
  while (mounted && player.isClimbingLadder() && climbingFrames < maximumFrames) {
    // Advance through the same public Player.update entry point used by the
    // game loop. Calling the private ladder updater here previously let this
    // proof pass even if public input dispatch stopped reaching traversal.
    player.update(1 / 60, new Set([inputCode]), {
      arenaRadius: 100,
      game: controller.game,
    });
    minimumY = Math.min(minimumY, player.root.position.y);
    maximumY = Math.max(maximumY, player.root.position.y);
    finiteFrames = finiteFrames && player.root.position.toArray().every(Number.isFinite);
    sampleAlignment();
    controller.update(1 / 60);
    climbingFrames += 1;
  }
  const dismounted = mounted && !player.isClimbingLadder() && climbingFrames < maximumFrames;
  let postDismountConstraintFrames = 0;
  if (dismounted) {
    // The dismount handoff deliberately owns the controller's two constraint
    // passes in the completion frame. Exercise later ordinary frames too, or
    // an unsupported exit could look valid only until the next game tick.
    for (let frame = 0; frame < 2; frame += 1) {
      controller.update(1 / 60);
      postDismountConstraintFrames += 1;
      finiteFrames = finiteFrames && player.root.position.toArray().every(Number.isFinite);
    }
  }
  const finalPosition = plainPoint(player.root.position);
  const expected = plainPoint(expectedExit);
  const exitDistance = Math.hypot(
    finalPosition.x - expected.x,
    finalPosition.y - expected.y,
    finalPosition.z - expected.z,
  );
  const exitName = ascending ? 'top' : 'bottom';
  const egress = dismounted
    ? exerciseLadderExitEgress(facade, controller, player, ladder, exitName)
    : null;
  const authoredSpan = Math.abs(Number(ladder.topY) - Number(ladder.bottomY));
  const climbedSpan = maximumY - minimumY;
  const safeguardAfter = Number(facade.environmentRuntime?.safeguardActivations) || 0;
  const maximumPlaneClearanceError = alignmentSamples.length
    ? Math.max(...alignmentSamples.map(({ signedPlaneClearance }) => (
      Math.abs(signedPlaneClearance - Number(ladder.bodyClearance))
    )))
    : Number.POSITIVE_INFINITY;
  const minimumFacingAlignment = alignmentSamples.length
    ? Math.min(...alignmentSamples.map(({ facingAlignment }) => facingAlignment))
    : Number.NEGATIVE_INFINITY;
  const visualPlaneMatchesRuntime = Boolean(visualPlane
    && Math.hypot(
      Number(visualPlane.center?.x) - Number(ladder.planeCenter?.x),
      Number(visualPlane.center?.z) - Number(ladder.planeCenter?.z),
    ) <= 0.001
    && Math.hypot(
      Number(visualPlane.normal?.x) - Number(ladder.planeNormal?.x),
      Number(visualPlane.normal?.z) - Number(ladder.planeNormal?.z),
    ) <= 0.001
    && Math.abs(Number(visualPlane.bodyClearance) - Number(ladder.bodyClearance)) <= 0.001);
  const planeAlignment = {
    sampleCount: alignmentSamples.length,
    bodyClearance: Number(ladder.bodyClearance),
    maximumPlaneClearanceError,
    minimumFacingAlignment,
    visualPlaneMatchesRuntime,
    accepted: alignmentSamples.length > 1
      && Number(ladder.bodyClearance) >= 0.35
      && maximumPlaneClearanceError <= 0.01
      && minimumFacingAlignment >= 0.999
      && visualPlaneMatchesRuntime,
  };
  return {
    direction,
    publicControllerInteraction: true,
    publicPlayerUpdate: true,
    inputCodes: [inputCode],
    positionAfterInitialConstraint,
    promptKind: interactable?.kind ?? null,
    promptTargetId: interactable?.target?.id ?? null,
    promptFound,
    mounted,
    climbingFrames,
    finiteFrames,
    authoredSpan,
    climbedSpan,
    dismounted,
    postDismountConstraintFrames,
    expectedExit: expected,
    finalPosition,
    exitDistance,
    planeAlignment,
    egress,
    safeguardActivations: safeguardAfter - safeguardBefore,
    accepted: promptFound
      && mounted
      && finiteFrames
      && climbingFrames > 1
      && climbingFrames < maximumFrames
      && climbedSpan >= authoredSpan - 0.1
      && planeAlignment.accepted
      && dismounted
      && postDismountConstraintFrames === 2
      && exitDistance <= ACCEPTANCE_LIMITS.surfaceHeightTolerance + 0.001
      && egress?.accepted === true
      && safeguardAfter === safeguardBefore,
  };
}

/**
 * Exercises each assembled ladder through the same public controller
 * interaction and frame input used by gameplay. The controller's actual
 * collision correction runs after every climb frame and after dismount, so a
 * ladder cannot pass by merely exposing plausible descriptor coordinates.
 */
export function buildLadderRuntimeProofs(plan, facade) {
  const ladderProofs = (facade.ladders ?? []).map((ladder) => {
    const directions = [
      exerciseLadderRuntime(facade, ladder, 'up'),
      exerciseLadderRuntime(facade, ladder, 'down'),
    ];
    return {
      ladderId: ladder.id,
      portalId: ladder.portalId ?? null,
      surfaceId: ladder.surfaceId ?? null,
      directions,
      accepted: directions.every(({ accepted }) => accepted),
    };
  });
  return {
    proofId: 'assembled-ladder-public-input-v1',
    ladderCount: ladderProofs.length,
    ladderProofs,
    rejectedLadders: ladderProofs.filter(({ accepted }) => !accepted),
    accepted: ladderProofs.every(({ accepted }) => accepted),
  };
}

function portalApproachClearanceProofs(plan, facade, portal, sampleSpacing) {
  const anchorById = new Map([
    ...(plan.anchors ?? []).map((anchor) => [anchor.id, anchor]),
    ...(plan.safeAnchors ?? []).map((anchor) => [anchor.id, anchor]),
  ]);
  const interactionAnchors = (plan.actions ?? [])
    .filter((action) => action.interaction?.activationSide !== 'system')
    .map((action) => ({ action, anchor: anchorById.get(action.anchorId) }))
    .filter(({ anchor }) => anchor?.position && ['x', 'y', 'z'].every((axis) => Number.isFinite(anchor.position[axis])));
  const fixtureColliderBounds = (plan.structuralFixtures ?? []).flatMap((fixture) => {
    const exactBounds = Array.isArray(fixture?.colliderBounds) && fixture.colliderBounds.length > 0
      ? fixture.colliderBounds
      : (fixture?.bounds?.min && fixture?.bounds?.max ? [fixture.bounds] : []);
    return exactBounds
      .filter((bounds) => bounds?.min && bounds?.max)
      .map((bounds, colliderIndex) => ({
        id: fixture.id,
        regionId: fixture.regionId,
        colliderIndex,
        bounds,
      }));
  });
  const colliders = activeBlockingColliders(facade);

  return ['from', 'to'].map((endpointName) => {
    const volume = portalEndpointApproachVolume(portal, endpointName);
    if (!volume) {
      return {
        endpoint: endpointName,
        declaredBy: null,
        sampleSpacing,
        bounds: null,
        structuralFixtureIntrusions: [],
        interactionIntrusions: [],
        colliderIntrusions: [],
        accepted: false,
      };
    }
    // A support fixture's union bounds can span the intentionally clear lane
    // between its posts. Prove approach clearance against the authored
    // collider pieces themselves; falling back to the fixture bounds remains
    // fail-closed for older fixtures without an exact collider contract.
    const structuralFixtureIntrusions = fixtureColliderBounds
      .filter((fixture) => boundsOverlapWithVolume(fixture.bounds, volume.bounds))
      .map((fixture) => ({
        id: fixture.id,
        regionId: fixture.regionId,
        colliderIndex: fixture.colliderIndex,
        bounds: fixture.bounds,
      }));
    const interactionIntrusions = interactionAnchors
      .filter(({ anchor }) => boundsOverlapWithVolume(interactionExclusionBounds(anchor), volume.bounds))
      .map(({ action, anchor }) => ({
        actionId: action.id,
        anchorId: anchor.id,
        regionId: anchor.regionId,
        position: plainPoint(anchor.position),
      }));
    const colliderIntrusions = colliders
      .filter((entry) => boundsOverlapWithVolume(entry.bounds, volume.bounds))
      .map((entry) => ({
        colliderId: entry.id,
        planId: entry.planId,
        bounds: { min: plainPoint(entry.bounds.min), max: plainPoint(entry.bounds.max) },
      }));
    return {
      ...volume,
      sampleSpacing,
      structuralFixtureIntrusions,
      interactionIntrusions,
      colliderIntrusions,
      accepted: structuralFixtureIntrusions.length === 0
        && interactionIntrusions.length === 0
        && colliderIntrusions.length === 0,
    };
  });
}

function capsuleIntersectsBounds(point, bounds, capsule = PHYSICAL_CAPSULE) {
  const capsuleBottom = point.y + 0.025;
  const capsuleTop = point.y + capsule.height;
  if (bounds.max.y <= capsuleBottom + 0.005 || bounds.min.y >= capsuleTop - 0.005) return false;
  const dx = Math.max(bounds.min.x - point.x, 0, point.x - bounds.max.x);
  const dz = Math.max(bounds.min.z - point.z, 0, point.z - bounds.max.z);
  return dx * dx + dz * dz < capsule.radius * capsule.radius - 1e-8;
}

function supportForPoint(surfaces, point, tolerance = 0.42) {
  const candidates = surfaces
    .map((surface) => surfacePointAt(surface, point.x, point.z))
    .filter(Boolean)
    .map((support) => ({ ...support, delta: Math.abs(support.y - point.y) }))
    .sort((left, right) => left.delta - right.delta);
  return candidates[0]?.delta <= tolerance ? candidates[0] : null;
}

function physicalRouteSamples(routePoints, spacing) {
  if (!Array.isArray(routePoints) || routePoints.length === 0) return [];
  if (routePoints.length === 1) return [plainPoint(routePoints[0])];
  const samples = [];
  for (let index = 1; index < routePoints.length; index += 1) {
    const segment = samplesBetween(routePoints[index - 1], routePoints[index], spacing);
    if (samples.length) segment.shift();
    samples.push(...segment);
  }
  return samples;
}

function routeAudit(routePoints, surfaces, blockers, spacing, {
  allowUnsupported = false,
  ignoredPlanIds = new Set(),
} = {}) {
  const samples = physicalRouteSamples(routePoints, spacing);
  const uncoveredSamples = [];
  const blockedSamples = [];
  for (const sample of samples) {
    const support = allowUnsupported ? { surfaceId: null } : supportForPoint(surfaces, sample);
    if (!support) {
      uncoveredSamples.push({ position: plainPoint(sample) });
      continue;
    }
    const grounded = support.surfaceId ? { ...sample, y: support.y } : sample;
    const blocker = blockers.find((entry) => !ignoredPlanIds.has(entry.planId)
      && capsuleIntersectsBounds(grounded, entry.bounds));
    if (blocker) {
      blockedSamples.push({
        position: plainPoint(grounded),
        colliderId: blocker.id,
        planId: blocker.planId,
      });
    }
  }
  return { samples, uncoveredSamples, blockedSamples };
}

function endpointTouchesSurface(point, surface, tolerance = 0.48) {
  const geometryType = surface?.stairs ? 'stairs' : surface?.geometry?.type;
  const path = surfaceGeometryPath(surface);
  if (geometryType === 'ladder' && path) {
    const bounds = surface.bounds;
    const minimumY = Math.min(...path.map(({ y }) => y));
    const maximumY = Math.max(...path.map(({ y }) => y));
    return point.x >= bounds.min.x - tolerance && point.x <= bounds.max.x + tolerance
      && point.z >= bounds.min.z - tolerance && point.z <= bounds.max.z + tolerance
      && point.y >= minimumY - tolerance && point.y <= maximumY + tolerance;
  }
  const supported = surfacePointAt(surface, point.x, point.z, ACCEPTANCE_LIMITS.visualColliderSampleSpacing);
  return Boolean(supported && Math.abs(supported.y - point.y) <= tolerance);
}

function orientedSurfacePath(path, fromSurface, toSurface) {
  const forwardScore = (endpointTouchesSurface(path[0], fromSurface) ? 0 : 1000)
    + (endpointTouchesSurface(path.at(-1), toSurface) ? 0 : 1000)
    + Math.hypot(path[0].x - centerOfSurface(fromSurface).x, path[0].z - centerOfSurface(fromSurface).z)
    + Math.hypot(path.at(-1).x - centerOfSurface(toSurface).x, path.at(-1).z - centerOfSurface(toSurface).z);
  const reverseScore = (endpointTouchesSurface(path.at(-1), fromSurface) ? 0 : 1000)
    + (endpointTouchesSurface(path[0], toSurface) ? 0 : 1000)
    + Math.hypot(path.at(-1).x - centerOfSurface(fromSurface).x, path.at(-1).z - centerOfSurface(fromSurface).z)
    + Math.hypot(path[0].x - centerOfSurface(toSurface).x, path[0].z - centerOfSurface(toSurface).z);
  return reverseScore < forwardScore ? [...path].reverse() : [...path];
}

function overlapCandidates(fromSurface, toSurface) {
  const from = fromSurface.bounds;
  const to = toSurface.bounds;
  const overlapMinX = Math.max(from.min.x, to.min.x);
  const overlapMaxX = Math.min(from.max.x, to.max.x);
  const overlapMinZ = Math.max(from.min.z, to.min.z);
  const overlapMaxZ = Math.min(from.max.z, to.max.z);
  const points = [];
  const values = (minimum, maximum) => minimum <= maximum
    ? [0.5, 0.25, 0.75].map((ratio) => THREE.MathUtils.lerp(minimum, maximum, ratio))
    : [];
  if (overlapMinX <= overlapMaxX + ACCEPTANCE_LIMITS.visualColliderSampleSpacing
    && overlapMinZ <= overlapMaxZ + ACCEPTANCE_LIMITS.visualColliderSampleSpacing) {
    for (const x of values(overlapMinX, Math.max(overlapMinX, overlapMaxX))) {
      for (const z of values(overlapMinZ, Math.max(overlapMinZ, overlapMaxZ))) {
        const fromPoint = surfacePointAt(fromSurface, x, z);
        const toPoint = surfacePointAt(toSurface, x, z);
        if (fromPoint && toPoint && Math.abs(fromPoint.y - toPoint.y) <= 0.48) {
          points.push([{ ...fromPoint }, { ...toPoint }]);
        }
      }
    }
  }
  return points;
}

function internalOpeningRoute(plan, link, fromSurface, toSurface) {
  if (!link.internalPortalId) return null;
  let match = null;
  for (const boundary of plan.structuralBoundaries) {
    const opening = (boundary.openings ?? []).find((candidate) => candidate.internalPortalId === link.internalPortalId);
    if (opening) {
      match = { boundary, opening };
      break;
    }
  }
  if (!match) return null;
  const normals = {
    west: { x: -1, z: 0 }, east: { x: 1, z: 0 },
    north: { x: 0, z: -1 }, south: { x: 0, z: 1 },
  };
  const normal = normals[match.boundary.side];
  if (!normal) return null;
  const fromIsSource = fromSurface.cellId === match.opening.sourceCellId;
  const sign = fromIsSource ? 1 : -1;
  const center = match.opening.center;
  const offset = Math.max(PHYSICAL_CAPSULE.radius + 0.08, 0.5);
  const before = surfacePointAt(
    fromSurface,
    center.x - normal.x * offset * sign,
    center.z - normal.z * offset * sign,
  );
  const after = surfacePointAt(
    toSurface,
    center.x + normal.x * offset * sign,
    center.z + normal.z * offset * sign,
  );
  if (!before || !after || Math.abs(before.y - after.y) > 0.48) return null;
  return [before, { x: center.x, y: (before.y + after.y) * 0.5, z: center.z }, after];
}

function authoredRouteCandidates(plan, link, surfaces) {
  const fromSurface = surfaces.get(link.fromSurfaceId);
  const toSurface = surfaces.get(link.toSurfaceId);
  const viaSurface = link.viaSurfaceId ? surfaces.get(link.viaSurfaceId) : null;
  if (!fromSurface || !toSurface) return [];
  const viaPath = surfaceGeometryPath(viaSurface);
  if (viaPath) {
    const viaType = viaSurface.stairs ? 'stairs' : viaSurface.geometry?.type;
    if (viaType === 'ladder') {
      // Ladder geometry.path is the authoritative player-root climb line.
      // Player.mountLadder aligns directly to this x/z center; adding another
      // proof-only facing offset tested a different route than runtime and
      // could conceal a ladder mounted inside a wall or support cap.
      // Runtime then snaps to the authored top/bottom exits. Include those
      // dismount legs so a side-mounted ladder must prove a real route onto
      // each adjoining deck instead of merely ending near it.
      const ladderGeometry = viaSurface.geometry ?? {};
      const ladderPath = [
        ladderGeometry.bottomExit ? plainPoint(ladderGeometry.bottomExit) : null,
        ...viaPath,
        ladderGeometry.topExit ? plainPoint(ladderGeometry.topExit) : null,
      ].filter(Boolean).filter((point, index, points) => (
        index === 0 || Math.hypot(
          point.x - points[index - 1].x,
          point.y - points[index - 1].y,
          point.z - points[index - 1].z,
        ) > 1e-6
      ));
      return [orientedSurfacePath(ladderPath, fromSurface, toSurface)];
    }
    const orientedViaPath = orientedSurfacePath(viaPath, fromSurface, toSurface);
    const groundApproach = [
      link.approachContract?.ingressPoint,
      ...(link.approachWaypoints ?? []),
    ].filter(Boolean);
    const route = [...groundApproach, ...orientedViaPath].filter((point, index, points) => (
      index === 0 || Math.hypot(
        point.x - points[index - 1].x,
        point.y - points[index - 1].y,
        point.z - points[index - 1].z,
      ) > 0.05
    ));
    return [route];
  }
  const internalRoute = internalOpeningRoute(plan, link, fromSurface, toSurface);
  if (internalRoute) return [internalRoute];
  const fromPath = surfaceGeometryPath(fromSurface);
  if (fromPath && endpointTouchesSurface(fromPath.at(-1), toSurface)) {
    return [orientedSurfacePath(fromPath, fromSurface, toSurface)];
  }
  const toPath = surfaceGeometryPath(toSurface);
  if (toPath && endpointTouchesSurface(toPath[0], fromSurface)) {
    return [orientedSurfacePath(toPath, fromSurface, toSurface)];
  }
  return overlapCandidates(fromSurface, toSurface);
}

function dynamicStateIdFromLink(link, mechanismId) {
  return (link.conditions ?? []).find((condition) => (
    condition.op === 'stateEquals'
    && condition.variableId === `${mechanismId}.state`
    && typeof condition.value === 'string'
  ))?.value ?? null;
}

function dynamicLinkStableStateProofs(plan, facade, link, surfaces, spacing) {
  const fromSurface = surfaces.get(link.fromSurfaceId);
  const toSurface = surfaces.get(link.toSurfaceId);
  const dynamicSurface = [fromSurface, toSurface].find((surface) => surface?.collision === 'dynamic');
  const staticSurface = fromSurface === dynamicSurface ? toSurface : fromSurface;
  const mechanismId = link.mechanismId ?? dynamicSurface?.mechanismId;
  const mechanism = plan.mechanisms.find(({ id }) => id === mechanismId);
  if (!dynamicSurface || !staticSurface || !mechanism) {
    return [{
      stateId: null,
      accepted: false,
      endpointMismatches: [{ kind: 'dynamic-link-contract-missing', mechanismId: mechanismId ?? null }],
      routePoints: [], samples: [], uncoveredSamples: [], blockedSamples: [],
    }];
  }
  const conditionedStateId = dynamicStateIdFromLink(link, mechanism.id);
  const states = conditionedStateId
    ? mechanism.states.filter((state) => state.id === conditionedStateId && state.stable !== false)
    : mechanism.states.filter((state) => state.stable !== false && state.landingSurfaceId === staticSurface.id);
  if (!states.length) {
    return [{
      stateId: conditionedStateId,
      accepted: false,
      endpointMismatches: [{
        kind: conditionedStateId ? 'dynamic-link-state-unknown' : 'dynamic-link-state-condition-or-landing-missing',
        mechanismId: mechanism.id,
      }],
      routePoints: [], samples: [], uncoveredSamples: [], blockedSamples: [],
    }];
  }
  return states.map((state) => {
    const restoration = rememberRegisteredRuntimeState(facade, mechanism.id);
    try {
      const endpointMismatches = [];
      if (state.landingSurfaceId !== staticSurface.id) {
        endpointMismatches.push({
          kind: 'dynamic-state-landing-link-mismatch',
          expectedLandingSurfaceId: state.landingSurfaceId ?? null,
          actualLandingSurfaceId: staticSurface.id,
        });
      }
      const applied = facade.environmentRuntime?.applyMechanismStableState?.(
        mechanism.id,
        state.id,
        { emitEvent: false, source: `physical-clearance:${link.id}` },
      );
      if (!applied) endpointMismatches.push({ kind: 'dynamic-stable-state-not-applied', stateId: state.id });
      facade.group?.updateWorldMatrix?.(true, true);
      const runtimeBounds = unionColliderBounds(
        facade.structuralRegistry,
        facade.structuralRegistry.byPlanId.get(dynamicSurface.id),
      );
      if (!runtimeBounds) endpointMismatches.push({ kind: 'dynamic-surface-collider-missing', stateId: state.id });
      const runtimeSurface = runtimeBounds ? {
        ...dynamicSurface,
        bounds: {
          min: plainPoint(runtimeBounds.min),
          max: plainPoint(runtimeBounds.max),
        },
      } : dynamicSurface;
      const candidates = overlapCandidates(
        fromSurface === dynamicSurface ? runtimeSurface : staticSurface,
        fromSurface === dynamicSurface ? staticSurface : runtimeSurface,
      );
      if (!candidates.length) endpointMismatches.push({ kind: 'dynamic-state-landing-seam-missing', stateId: state.id });
      const audits = candidates.map((routePoints) => ({
        routePoints,
        ...routeAudit(routePoints, [runtimeSurface, staticSurface], activeBlockingColliders(facade), spacing),
      }));
      const selected = audits.find((audit) => audit.uncoveredSamples.length === 0 && audit.blockedSamples.length === 0)
        ?? audits[0]
        ?? { routePoints: [], samples: [], uncoveredSamples: [], blockedSamples: [] };
      return {
        stateId: state.id,
        routePoints: selected.routePoints.map(plainPoint),
        samples: selected.samples.map(plainPoint),
        uncoveredSamples: selected.uncoveredSamples,
        blockedSamples: selected.blockedSamples,
        endpointMismatches,
        accepted: endpointMismatches.length === 0
          && selected.samples.length > 0
          && selected.uncoveredSamples.length === 0
          && selected.blockedSamples.length === 0,
      };
    } finally {
      restoration.restore();
      facade.group?.updateWorldMatrix?.(true, true);
    }
  });
}

function actionApproachCandidates(plan, action, anchor, surfaces) {
  const radius = Number(action.interaction?.radius);
  const forward = new THREE.Vector3(anchor.forward?.x ?? 0, 0, anchor.forward?.z ?? 0);
  if (forward.lengthSq() <= 1e-8) forward.set(0, 0, 1);
  forward.normalize();
  const side = action.interaction?.activationSide;
  const directions = side === 'back' ? [forward.clone().multiplyScalar(-1)]
    : side === 'either' || side === 'any'
      ? [forward, forward.clone().multiplyScalar(-1), new THREE.Vector3(-forward.z, 0, forward.x), new THREE.Vector3(forward.z, 0, -forward.x)]
      : [forward];
  const distances = [...new Set([
    Math.min(radius - 0.08, Math.max(PHYSICAL_CAPSULE.radius + 0.4, radius * 0.65)),
    Math.min(radius - 0.08, PHYSICAL_CAPSULE.radius + 0.48),
    Math.min(radius - 0.08, 1.15),
  ].filter((value) => Number.isFinite(value) && value > PHYSICAL_CAPSULE.radius))];
  const regionSurfaces = [...surfaces.values()].filter((surface) => surface.regionId === anchor.regionId);
  const candidates = [];
  for (const direction of directions) {
    for (const distance of distances) {
      const x = anchor.position.x + direction.x * distance;
      const z = anchor.position.z + direction.z * distance;
      const support = supportForPoint(regionSurfaces, { x, y: anchor.position.y, z }, 2.5);
      if (support) candidates.push({ x, y: support.y, z, supportSurfaceId: support.surfaceId, distance });
    }
  }
  return candidates;
}

/**
 * Independent physical proof for links that are not already covered by a
 * top-level portal route, plus every player-selectable action approach. It
 * samples the real registered colliders with the production player radius and
 * a conservative 3.2m vertical capsule.
 */
export function buildInternalTraversalAndActionProofs(plan, facade, {
  sampleSpacing = Math.min(plan.assemblyContract?.boundarySampleSpacing ?? 0.21, 0.21),
} = {}) {
  const surfaces = new Map(plan.walkableSurfaces.map((surface) => [surface.id, surface]));
  const internalLinks = (plan.traversalLinks ?? []).filter((link) => !link.portalId);
  const linkProofs = [];
  for (const link of internalLinks) {
    const fromSurface = surfaces.get(link.fromSurfaceId);
    const toSurface = surfaces.get(link.toSurfaceId);
    const approachSurfaces = [...new Set([
      ...(link.approachSurfaceIds ?? []),
      ...(link.approachContract?.ingressSurfaceIds ?? []),
    ])].map((surfaceId) => surfaces.get(surfaceId)).filter(Boolean);
    const chainSurfaces = [
      fromSurface,
      ...approachSurfaces,
      link.viaSurfaceId ? surfaces.get(link.viaSurfaceId) : null,
      toSurface,
    ].filter(Boolean);
    const dynamic = DYNAMIC_TRAVERSAL_MODES.has(link.mode)
      || chainSurfaces.some((surface) => surface.collision === 'dynamic');
    const fall = ['intentional-drop', 'crumble-drop'].includes(link.mode);
    if (dynamic) {
      const stableStateProofs = dynamicLinkStableStateProofs(plan, facade, link, surfaces, sampleSpacing);
      const endpointMismatches = stableStateProofs.flatMap((proof) => proof.endpointMismatches);
      const uncoveredSamples = stableStateProofs.flatMap((proof) => proof.uncoveredSamples);
      const blockedSamples = stableStateProofs.flatMap((proof) => proof.blockedSamples);
      linkProofs.push({
        linkId: link.id,
        mode: link.mode,
        sampleSpacing,
        capsuleRadius: PHYSICAL_CAPSULE.radius,
        capsuleHeight: PHYSICAL_CAPSULE.height,
        routePoints: stableStateProofs.flatMap((proof) => proof.routePoints),
        sampleCount: stableStateProofs.reduce((total, proof) => total + proof.samples.length, 0),
        samples: stableStateProofs.flatMap((proof) => proof.samples),
        uncoveredSamples,
        blockedSamples,
        endpointMismatches,
        delegatedToStableStateProof: true,
        mechanismId: link.mechanismId ?? null,
        stableStateProofs,
        accepted: stableStateProofs.length > 0 && stableStateProofs.every((proof) => proof.accepted),
      });
      continue;
    }
    const auditStaticLink = () => {
      const candidates = authoredRouteCandidates(plan, link, surfaces);
      const blockers = activeBlockingColliders(facade);
      return {
        candidates,
        audits: candidates.map((routePoints) => {
          const endpointErrors = [];
          const ingressSurfaces = (link.approachContract?.ingressSurfaceIds ?? [])
            .map((surfaceId) => surfaces.get(surfaceId)).filter(Boolean);
          const acceptedFromSurfaces = ingressSurfaces.length ? ingressSurfaces : [fromSurface];
          if (!acceptedFromSurfaces.some((surface) => endpointTouchesSurface(routePoints[0], surface))) {
            endpointErrors.push({ kind: 'route-misses-from-surface', surfaceId: acceptedFromSurfaces.map(({ id }) => id).join('|'), point: routePoints[0] });
          }
          if (!endpointTouchesSurface(routePoints.at(-1), toSurface)) {
            endpointErrors.push({ kind: 'route-misses-to-surface', surfaceId: toSurface.id, point: routePoints.at(-1) });
          }
          const audit = routeAudit(routePoints, chainSurfaces, blockers, sampleSpacing, {
            allowUnsupported: fall || link.mode === 'ladder',
          });
          return { routePoints, endpointErrors, ...audit };
        }),
      };
    };
    const proofPortal = link.proofPortalId
      ? plan.portals.find(({ id }) => id === link.proofPortalId)
      : null;
    const { candidates, audits } = proofPortal
      ? withPortalTraversalProofState(plan, facade, proofPortal, auditStaticLink)
      : auditStaticLink();
    const endpointMismatches = [];
    if (!candidates.length && !dynamic && !fall) {
      endpointMismatches.push({ kind: 'no-authored-physical-route' });
    }
    const selected = audits.find((audit) => audit.endpointErrors.length === 0
      && audit.uncoveredSamples.length === 0 && audit.blockedSamples.length === 0)
      ?? audits[0]
      ?? { routePoints: [], samples: [], endpointErrors: [], uncoveredSamples: [], blockedSamples: [] };
    endpointMismatches.push(...selected.endpointErrors);
    const delegatedToStableStateProof = fall;
    linkProofs.push({
      linkId: link.id,
      mode: link.mode,
      sampleSpacing,
      capsuleRadius: PHYSICAL_CAPSULE.radius,
      capsuleHeight: PHYSICAL_CAPSULE.height,
      routePoints: selected.routePoints.map(plainPoint),
      sampleCount: selected.samples.length,
      samples: selected.samples.map(plainPoint),
      uncoveredSamples: selected.uncoveredSamples,
      blockedSamples: selected.blockedSamples,
      endpointMismatches,
      delegatedToStableStateProof,
      mechanismId: link.mechanismId ?? null,
      accepted: delegatedToStableStateProof
        ? endpointMismatches.length === 0
        : endpointMismatches.length === 0
          && selected.samples.length > 0
          && selected.uncoveredSamples.length === 0
          && selected.blockedSamples.length === 0,
    });
  }

  const anchorById = new Map([
    ...(plan.anchors ?? []).map((anchor) => [anchor.id, anchor]),
    ...(plan.safeAnchors ?? []).map((anchor) => [anchor.id, anchor]),
  ]);
  const selectableActions = (plan.actions ?? []).filter((action) => action.interaction?.activationSide !== 'system');
  const actionBlockers = activeBlockingColliders(facade);
  const actionProofs = selectableActions.map((action) => {
    const anchor = anchorById.get(action.anchorId);
    const candidates = anchor ? actionApproachCandidates(plan, action, anchor, surfaces) : [];
    const fixturePlanIds = new Set();
    const audits = candidates.map((approach) => {
      const blocker = actionBlockers.find((entry) => !fixturePlanIds.has(entry.planId)
        && capsuleIntersectsBounds(approach, entry.bounds));
      return { approach, blocker };
    });
    const selected = audits.find(({ blocker }) => !blocker) ?? audits[0] ?? null;
    return {
      actionId: action.id,
      anchorId: action.anchorId,
      sampleSpacing,
      capsuleRadius: PHYSICAL_CAPSULE.radius,
      capsuleHeight: PHYSICAL_CAPSULE.height,
      approach: selected?.approach ? plainPoint(selected.approach) : null,
      supportSurfaceId: selected?.approach?.supportSurfaceId ?? null,
      blockedSamples: selected?.blocker ? [{
        position: plainPoint(selected.approach),
        colliderId: selected.blocker.id,
        planId: selected.blocker.planId,
      }] : [],
      accepted: Boolean(selected && !selected.blocker),
    };
  });

  const blockedLinks = linkProofs.filter((proof) => !proof.accepted);
  const blockedActions = actionProofs.filter((proof) => !proof.accepted);
  return {
    proofId: 'assembled-player-capsule-v1',
    sampleSpacing,
    capsuleRadius: PHYSICAL_CAPSULE.radius,
    capsuleHeight: PHYSICAL_CAPSULE.height,
    internalLinkCount: internalLinks.length,
    selectableActionCount: selectableActions.length,
    linkProofs,
    actionProofs,
    blockedLinks,
    blockedActions,
    accepted: blockedLinks.length === 0 && blockedActions.length === 0,
  };
}

function createRestorationStack() {
  const restorers = [];
  return {
    property(target, key, clone = (value) => value) {
      if (!target) return;
      const hadProperty = Object.hasOwn(target, key);
      const value = clone(target[key]);
      restorers.push(() => {
        if (!hadProperty) delete target[key];
        else target[key] = value;
      });
    },
    vector(target, key) {
      if (!target?.[key]?.clone || !target[key]?.copy) return;
      const value = target[key].clone();
      restorers.push(() => target[key].copy(value));
    },
    restore() {
      for (const restore of restorers.reverse()) restore();
    },
  };
}

function rememberRegisteredRuntimeState(facade, mechanismId = null) {
  const restoration = createRestorationStack();
  const registry = facade.structuralRegistry;
  for (const visual of registry.visuals.values()) {
    restoration.property(visual, 'visible');
    restoration.vector(visual, 'position');
    restoration.vector(visual, 'quaternion');
    restoration.vector(visual, 'scale');
  }
  for (const collider of registry.colliders.values()) {
    restoration.property(collider, 'active');
    restoration.property(collider, 'enabled');
    restoration.property(collider, 'baseY');
    restoration.property(collider, 'topY');
    restoration.property(collider, 'bounds', (value) => (value == null
      ? value
      : JSON.parse(JSON.stringify(value))));
    restoration.vector(collider, 'position');
    if (collider.center !== collider.position) restoration.vector(collider, 'center');
  }

  const runtime = facade.environmentRuntime;
  const controller = mechanismId ? runtime?.controllerById?.get(mechanismId) : null;
  if (controller) {
    for (const key of [
      'stateId', 'elapsed', 'phase', 'phaseElapsed', 'routeIndex', 'dwellRemaining',
      'targetStateId', 'travelDistance', 'travelProgress',
    ]) restoration.property(controller, key);
    for (const key of ['fromPosition', 'targetPosition', 'restPosition']) {
      restoration.property(controller, key, (value) => value?.clone?.() ?? value);
    }
  }
  if (runtime?.water) {
    restoration.property(runtime.water, 'configurationId');
    restoration.property(runtime.water, 'levels', (value) => new Map(value));
    restoration.property(runtime.water, 'transfer', (value) => (value == null
      ? value
      : JSON.parse(JSON.stringify(value))));
    restoration.property(runtime, 'variables', (value) => new Map(value));
    for (const object of runtime.resources.waterObjects.values()) {
      restoration.property(object, 'visible');
      restoration.vector(object, 'position');
    }
  }
  return restoration;
}

function gateContractForPortal(plan, portalId) {
  return (plan.progression?.gateContracts ?? []).find((gate) => gate.portalId === portalId) ?? null;
}

function intentionalDropMechanism(plan, portal) {
  const mode = portal.traversal?.mode ?? portal.approachType;
  if (!['intentional-drop', 'crumble-drop'].includes(mode)) return null;
  const sourceSurfaceId = portal.physicalRoute?.endpointSurfaceIds?.from
    ?? portal.traversal?.physicalRoute?.endpointSurfaceIds?.from;
  const sourceSurface = plan.walkableSurfaces.find(({ id }) => id === sourceSurfaceId);
  const mechanism = plan.mechanisms.find(({ id }) => (
    id === sourceSurface?.mechanismId || id === sourceSurface?.controllerId
  ));
  if (!sourceSurface || !mechanism) {
    throw new Error(`Portal ${portal.id} intentional drop has no bound source surface/mechanism.`);
  }
  const collapsedState = mechanism.states?.find((state) => state.stable !== false && state.collision === false)
    ?? mechanism.states?.find((state) => state.stable !== false && state.id === 'Collapsed');
  if (!collapsedState) {
    throw new Error(`Portal ${portal.id} intentional drop mechanism ${mechanism.id} has no stable collapsed state.`);
  }
  return { sourceSurface, mechanism, collapsedState };
}

function withPortalTraversalProofState(plan, facade, portal, callback) {
  const drop = intentionalDropMechanism(plan, portal);
  const restoration = rememberRegisteredRuntimeState(facade, drop?.mechanism.id ?? null);
  const proofState = { gateOpen: false, mechanismId: null, stateId: null };
  try {
    const gateContract = gateContractForPortal(plan, portal.id);
    if (gateContract || portal.barrierId || portal.barrierBoundaryId) {
      const door = facade.doors?.find((candidate) => candidate.portalId === portal.id
        || candidate.id === gateContract?.id);
      if (!door?.setOpen) {
        throw new Error(`Portal ${portal.id} has a gate contract but no runtime door capable of opening it.`);
      }
      restoration.property(door, 'opened');
      restoration.property(door, 'closed');
      restoration.property(door, 'locked');
      restoration.vector(door.object, 'position');
      for (const collider of door.barrierColliders ?? []) {
        restoration.property(collider, 'active');
        restoration.property(collider, 'enabled');
      }
      door.setOpen(true);
      if (door.object?.position && Number.isFinite(door.openY)) door.object.position.y = door.openY;
      proofState.gateOpen = true;
      proofState.gateId = door.id;
    }

    if (drop) {
      const applied = facade.environmentRuntime?.applyMechanismStableState?.(
        drop.mechanism.id,
        drop.collapsedState.id,
        { emitEvent: false, source: `portal-proof:${portal.id}` },
      );
      if (!applied) {
        throw new Error(`Portal ${portal.id} could not apply ${drop.mechanism.id}:${drop.collapsedState.id}.`);
      }
      proofState.mechanismId = drop.mechanism.id;
      proofState.stateId = drop.collapsedState.id;
    }
    facade.group?.updateWorldMatrix?.(true, true);
    return callback(proofState);
  } finally {
    restoration.restore();
    facade.group?.updateWorldMatrix?.(true, true);
  }
}

export function buildIndependentPortalRouteProofs(plan, facade) {
  const cells = new Map(plan.spatialCells.map((cell) => [cell.id, cell]));
  const spacing = Math.min(plan.assemblyContract?.boundarySampleSpacing ?? 0.21, 0.21);
  return plan.portals.map((portal) => {
    return withPortalTraversalProofState(plan, facade, portal, (proofState) => {
      const route = portal.physicalRoute ?? portal.traversal?.physicalRoute;
      const cellIds = route?.cellIds ?? portal.connectorCellIds ?? [];
      const routeCells = cellIds.map((id) => cells.get(id)).filter(Boolean);
      const routePoints = route?.routePoints ?? [portal.from.center, portal.to.center];
      const uncoveredSamples = [];
      const blockedSamples = [];
      const allSamples = routePoints.slice(1).flatMap((point, index) => samplesBetween(routePoints[index], point, spacing));
      const allowedCells = [cells.get(portal.from.cellId), ...routeCells, cells.get(portal.to.cellId)].filter(Boolean);
      // This list is deliberately rebuilt after applying only the portal's
      // legal state. Unrelated active colliders remain blockers.
      const structuralColliders = [...facade.structuralRegistry.colliders.values()]
        .filter((collider) => collider?.active !== false
          && collider?.enabled !== false
          && collider?.obstacleKind !== 'floor')
        .map((collider) => ({ id: collider.id, planId: collider.planId, bounds: colliderBounds(collider) }))
        .filter((entry) => entry.bounds);
      for (const sample of allSamples) {
        const bodyPoint = { ...sample, y: sample.y + 1.2 };
        if (!allowedCells.some((cell) => inside(cell.bounds, bodyPoint, spacing))) uncoveredSamples.push(bodyPoint);
        const blocker = structuralColliders.find((entry) => inside(entry.bounds, bodyPoint, 0.01));
        if (blocker) blockedSamples.push({ position: bodyPoint, colliderId: blocker.id, planId: blocker.planId });
      }
      const mode = portal.traversal?.mode ?? portal.approachType;
      const approachClearanceVolumes = portalApproachClearanceProofs(plan, facade, portal, spacing);
      return {
        portalId: portal.id,
        proofState,
        sampleSpacing: spacing,
        continuous: cellIds.length > 0 || allowedCells.length === 2,
        traversable: uncoveredSamples.length === 0 && blockedSamples.length === 0,
        walkable: !['ladder', 'intentional-drop', 'crumble-drop'].includes(mode),
        enclosed: routeCells.every((cell) => plan.structuralBoundaries.filter((boundary) => boundary.cellId === cell.id).length >= 6),
        supported: routeCells.every((cell) => ['intentional-drop', 'crumble-drop'].includes(mode)
          || plan.walkableSurfaces.some((surface) => surface.cellId === cell.id && surface.supportBoundaryIds?.length)),
        minimumWidth: portal.traversal?.minimumWidth ?? Math.min(portal.from.dimensions.width, portal.to.dimensions.width),
        minimumHeadroom: portal.traversal?.minimumHeadroom ?? Math.min(portal.from.dimensions.height, portal.to.dimensions.height),
        uncoveredSamples,
        blockedSamples,
        visualColliderMismatches: [],
        approachClearanceVolumes,
        approachClearanceAccepted: approachClearanceVolumes.length === 2
          && approachClearanceVolumes.every(({ accepted }) => accepted),
      };
    });
  });
}

function objectEffectivelyVisible(object) {
  for (let current = object; current; current = current.parent) {
    if (current.visible === false) return false;
  }
  return Boolean(object);
}

function recordVisibilityAndCollision(registry, planId) {
  const record = registry.byPlanId.get(planId);
  const visualIds = ids(record, 'visual');
  const colliderIds = ids(record, 'collider');
  return {
    record,
    visualIds,
    colliderIds,
    visualsPresent: visualIds.length > 0 && visualIds.every((id) => registry.visuals.has(id)),
    collidersPresent: colliderIds.length > 0 && colliderIds.every((id) => registry.colliders.has(id)),
    visualActive: visualIds.length > 0 && visualIds.every((id) => objectEffectivelyVisible(registry.visuals.get(id))),
    colliderActive: colliderIds.length > 0 && colliderIds.every((id) => {
      const collider = registry.colliders.get(id);
      return collider?.active !== false && collider?.enabled !== false;
    }),
  };
}

function mechanismDynamicSurfaces(plan, mechanism) {
  const runtime = mechanism.runtime ?? mechanism.runtimeProfile ?? mechanism.controller ?? mechanism.behavior ?? {};
  const declaredIds = new Set([
    runtime.surfaceId,
    runtime.dynamicSurfaceId,
    ...(runtime.surfaceIds ?? []),
  ].filter(Boolean));
  return plan.walkableSurfaces.filter((surface) => (
    surface.mechanismId === mechanism.id
    || surface.controllerId === mechanism.id
    || declaredIds.has(surface.id)
  ));
}

function buildMechanismParityProof(plan, facade, mechanism, state) {
  const registry = facade.structuralRegistry;
  const mismatches = [];
  const dynamicSurfaces = mechanismDynamicSurfaces(plan, mechanism);
  const collisionExpected = state.collision !== false;
  const tolerance = plan.assemblyContract?.visualCollisionParityTolerance
    ?? ACCEPTANCE_LIMITS.surfaceHeightTolerance;

  for (const surface of dynamicSurfaces) {
    const actual = recordVisibilityAndCollision(registry, surface.id);
    if (!actual.visualsPresent || !actual.collidersPresent) {
      mismatches.push({ planId: surface.id, kind: 'dynamic-registration-missing' });
      continue;
    }
    if (actual.visualActive !== collisionExpected || actual.colliderActive !== collisionExpected) {
      mismatches.push({
        planId: surface.id,
        kind: 'dynamic-active-state',
        expected: collisionExpected,
        visualActive: actual.visualActive,
        colliderActive: actual.colliderActive,
      });
    }
    if (actual.visualActive && actual.colliderActive) {
      const visualBounds = unionVisualBounds(registry, actual.record);
      const collisionBounds = unionColliderBounds(registry, actual.record);
      const delta = maxBoundsDelta(visualBounds, collisionBounds, true);
      if (delta > tolerance) mismatches.push({ planId: surface.id, kind: 'dynamic-bounds-parity', maxDelta: delta });

      const authoredPosition = state.position ?? state.platformPosition ?? state.transform?.position;
      const expectedBaseY = state.surfaceY ?? state.elevation ?? authoredPosition?.y;
      if (authoredPosition && collisionBounds && (
        Math.abs(collisionBounds.getCenter(new THREE.Vector3()).x - authoredPosition.x) > tolerance
        || Math.abs(collisionBounds.getCenter(new THREE.Vector3()).z - authoredPosition.z) > tolerance
      )) {
        mismatches.push({ planId: surface.id, kind: 'dynamic-state-horizontal-pose' });
      }
      if (Number.isFinite(expectedBaseY) && collisionBounds
        && Math.abs(collisionBounds.min.y - expectedBaseY) > tolerance) {
        mismatches.push({
          planId: surface.id,
          kind: 'dynamic-state-elevation',
          expectedBaseY,
          actualBaseY: collisionBounds.min.y,
        });
      }
    }
  }

  const supportFixtureIds = new Set([
    ...dynamicSurfaces.flatMap((surface) => surface.supportFixtureIds ?? []),
    ...(plan.structuralFixtures ?? [])
      .filter((fixture) => fixture.mechanismId === mechanism.id)
      .map((fixture) => fixture.id),
  ]);
  for (const fixtureId of supportFixtureIds) {
    const fixture = plan.structuralFixtures.find(({ id }) => id === fixtureId);
    const actual = recordVisibilityAndCollision(registry, fixtureId);
    const stateBound = fixture?.mechanismId === mechanism.id;
    const expected = stateBound ? collisionExpected : true;
    if (!actual.visualsPresent || !actual.collidersPresent) {
      mismatches.push({ planId: fixtureId, kind: 'support-registration-missing' });
      continue;
    }
    if (actual.visualActive !== actual.colliderActive
      || actual.visualActive !== expected
      || actual.colliderActive !== expected) {
      mismatches.push({
        planId: fixtureId,
        kind: 'support-active-state',
        expected,
        visualActive: actual.visualActive,
        colliderActive: actual.colliderActive,
      });
    }
    if (actual.visualActive && actual.colliderActive) {
      const delta = visualOutsideColliderDelta(
        unionVisualBounds(registry, actual.record),
        unionColliderBounds(registry, actual.record),
      );
      if (delta > tolerance) mismatches.push({ planId: fixtureId, kind: 'support-bounds-parity', maxDelta: delta });
    }
  }
  return mismatches;
}

function controlStandingCandidates(anchor, action) {
  const promptRadius = Math.max(0.65, Number(action.interaction?.radius) || 2);
  const forward = new THREE.Vector3(
    Number(anchor.forward?.x) || 0,
    0,
    Number(anchor.forward?.z) || 0,
  );
  if (forward.lengthSq() < 0.01) forward.set(0, 0, 1);
  forward.normalize();
  const activationSide = action.interaction?.activationSide;
  if (activationSide === 'back') forward.multiplyScalar(-1);
  const lateral = new THREE.Vector3(-forward.z, 0, forward.x);
  const distances = [0.7, 1.05, 1.45].filter((distance) => distance <= promptRadius);
  if (!distances.length) distances.push(promptRadius);
  const candidatesForDirection = (direction) => distances.flatMap((distance) => (
    [0, -0.55, 0.55].map((sideOffset) => ({
      x: anchor.position.x + direction.x * distance + lateral.x * sideOffset,
      y: anchor.position.y,
      z: anchor.position.z + direction.z * distance + lateral.z * sideOffset,
    }))
  ));
  if (activationSide === 'either' || activationSide === 'any') {
    return [forward, forward.clone().multiplyScalar(-1)]
      .flatMap((direction) => candidatesForDirection(direction));
  }
  return candidatesForDirection(forward);
}

function colliderIntersectsPlayerBody(collider, position) {
  const bounds = colliderBounds(collider);
  if (!bounds) return false;
  const radius = 0.42;
  // Structural seams shared with the supporting floor may protrude by the
  // accepted 0.05m assembly tolerance. Start the blocking body above that
  // foot-contact band; head/body obstructions remain fully detected.
  const bodyMinY = position.y + 0.21;
  const bodyMaxY = position.y + 1.8;
  return bounds.max.x >= position.x - radius && bounds.min.x <= position.x + radius
    && bounds.max.z >= position.z - radius && bounds.min.z <= position.z + radius
    && bounds.max.y >= bodyMinY && bounds.min.y <= bodyMaxY;
}

function buildControlReachabilityProofs(plan, facade, mechanism) {
  const anchors = new Map([
    ...(plan.anchors ?? []).map((anchor) => [anchor.id, anchor]),
    ...(plan.safeAnchors ?? []).map((anchor) => [anchor.id, anchor]),
  ]);
  const colliders = [...facade.structuralRegistry.colliders.values()]
    .filter((collider) => collider?.active !== false && collider?.enabled !== false);
  return (plan.actions ?? [])
    .filter((action) => action.controllerId === mechanism.id
      && action.interaction?.activationSide !== 'system')
    .map((action) => {
      const anchor = anchors.get(action.anchorId);
      if (!anchor) return { actionId: action.id, reachable: false, reason: 'anchor-missing' };
      const attempts = controlStandingCandidates(anchor, action).map((position) => {
        const supporting = colliders.filter((collider) => collider.obstacleKind === 'floor')
          .map((collider) => ({ collider, bounds: colliderBounds(collider) }))
          .filter(({ bounds }) => bounds
            && position.x >= bounds.min.x - 0.02 && position.x <= bounds.max.x + 0.02
            && position.z >= bounds.min.z - 0.02 && position.z <= bounds.max.z + 0.02
            && Math.abs(bounds.max.y - position.y) <= 0.21)
          .sort((left, right) => Math.abs(left.bounds.max.y - position.y) - Math.abs(right.bounds.max.y - position.y));
        const blockers = colliders.filter((collider) => collider.obstacleKind !== 'floor'
          && colliderIntersectsPlayerBody(collider, position));
        return {
          position,
          supported: supporting.length > 0,
          supportColliderId: supporting[0]?.collider.id ?? null,
          blockerIds: blockers.map((collider) => collider.id),
          reachable: supporting.length > 0 && blockers.length === 0,
        };
      });
      const acceptedAttempt = attempts.find(({ reachable }) => reachable);
      return {
        actionId: action.id,
        anchorId: action.anchorId,
        reachable: Boolean(acceptedAttempt),
        standingPosition: acceptedAttempt?.position ?? attempts[0]?.position ?? null,
        supportColliderId: acceptedAttempt?.supportColliderId ?? attempts[0]?.supportColliderId ?? null,
        blockerIds: acceptedAttempt?.blockerIds ?? attempts[0]?.blockerIds ?? [],
      };
    });
}

function mechanismRayOrigins(plan, mechanism, state) {
  const anchors = new Map([
    ...(plan.anchors ?? []).map((anchor) => [anchor.id, anchor]),
    ...(plan.safeAnchors ?? []).map((anchor) => [anchor.id, anchor]),
  ]);
  const anchorIds = new Set([
    mechanism.anchorId,
    state.anchorId,
    ...(plan.actions ?? [])
      .filter((action) => action.controllerId === mechanism.id && action.interaction?.activationSide !== 'system')
      .map((action) => action.anchorId),
  ].filter(Boolean));
  const origins = [...anchorIds].map((id) => ({ id, position: anchors.get(id)?.position })).filter(({ position }) => position);
  const dynamicSurface = mechanismDynamicSurfaces(plan, mechanism)[0];
  const statePosition = state.position ?? state.platformPosition ?? state.transform?.position;
  if (dynamicSurface && statePosition) {
    origins.push({
      id: `${mechanism.id}:${state.id}:platform`,
      position: {
        x: statePosition.x,
        y: state.surfaceY ?? state.elevation ?? statePosition.y,
        z: statePosition.z,
      },
    });
  }
  if (!origins.length) {
    const regionalAnchor = [...anchors.values()].find((anchor) => anchor.regionId === mechanism.regionId);
    if (regionalAnchor) origins.push({ id: regionalAnchor.id, position: regionalAnchor.position });
  }
  const deduplicated = new Map();
  for (const origin of origins) deduplicated.set(origin.id, origin);
  return [...deduplicated.values()];
}

function buildMechanismClearSpaceRays(plan, facade, mechanism, state) {
  const raycaster = new THREE.Raycaster();
  const targets = facade.structuralRegistry.getStructuralRaycastVisuals();
  const directions = [
    ['east', new THREE.Vector3(1, 0, 0)],
    ['west', new THREE.Vector3(-1, 0, 0)],
    ['ceiling', new THREE.Vector3(0, 1, 0)],
    ['floor', new THREE.Vector3(0, -1, 0)],
    ['south', new THREE.Vector3(0, 0, 1)],
    ['north', new THREE.Vector3(0, 0, -1)],
  ];
  facade.group?.updateWorldMatrix?.(true, true);
  const clearSpaceRays = [];
  for (const source of mechanismRayOrigins(plan, mechanism, state)) {
    const origin = new THREE.Vector3(source.position.x, source.position.y + 1.2, source.position.z);
    for (const [face, direction] of directions) {
      raycaster.set(origin, direction);
      raycaster.near = 0.015;
      raycaster.far = ACCEPTANCE_LIMITS.cameraProofRange;
      const hit = raycaster.intersectObjects(targets, true).find((intersection) => {
        if (!objectEffectivelyVisible(intersection.object)) return false;
        const materials = Array.isArray(intersection.object.material)
          ? intersection.object.material
          : [intersection.object.material];
        return materials.some((material) => material
          && material.transparent !== true
          && (material.opacity ?? 1) >= 0.999);
      });
      if (!hit) {
        clearSpaceRays.push({
          sourceId: source.id,
          face,
          maxRange: ACCEPTANCE_LIMITS.cameraProofRange,
          origin: { x: origin.x, y: origin.y, z: origin.z },
          direction: { x: direction.x, y: direction.y, z: direction.z },
        });
      }
    }
  }
  return clearSpaceRays;
}

export function buildMechanismStateProofs(plan, facade) {
  const runtime = facade.environmentRuntime;
  if (!runtime?.applyMechanismStableState) {
    throw new Error('Mechanism state proofs require the assembled DungeonRuntimeV2 stable-state API.');
  }
  const proofs = [];
  for (const mechanism of plan.mechanisms ?? []) {
    for (const state of (mechanism.states ?? []).filter((candidate) => candidate.stable !== false)) {
      const restoration = rememberRegisteredRuntimeState(facade, mechanism.id);
      let proof;
      try {
        const applied = runtime.applyMechanismStableState(mechanism.id, state.id, {
          emitEvent: false,
          source: 'assembly-acceptance-proof',
        });
        facade.group?.updateWorldMatrix?.(true, true);
        const visualColliderMismatches = applied
          ? buildMechanismParityProof(plan, facade, mechanism, state)
          : [{ planId: mechanism.id, kind: 'stable-state-application-failed', stateId: state.id }];
        const clearSpaceRays = applied
          ? buildMechanismClearSpaceRays(plan, facade, mechanism, state)
          : [];
        const controlProofs = applied
          ? buildControlReachabilityProofs(plan, facade, mechanism)
          : [];
        const controlsReachable = applied && controlProofs.every(({ reachable }) => reachable);
        proof = {
          mechanismId: mechanism.id,
          stateId: state.id,
          appliedRuntimeStateId: runtime.controllerById.get(mechanism.id)?.stateId ?? null,
          maxRayRange: ACCEPTANCE_LIMITS.cameraProofRange,
          clearSpaceRays,
          visualColliderMismatches,
          controlProofs,
          controlsReachable,
          accepted: applied
            && clearSpaceRays.length === 0
            && visualColliderMismatches.length === 0
            && controlsReachable,
        };
      } finally {
        restoration.restore();
        facade.group?.updateWorldMatrix?.(true, true);
      }
      proofs.push(proof);
    }
  }
  return proofs;
}
