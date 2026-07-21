import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildStructuralAssemblyProof } from '../helpers/assembly-proofs.mjs';

function bounds(minX, maxX, minY = 0, maxY = 4) {
  return { min: { x: minX, y: minY, z: -0.1 }, max: { x: maxX, y: maxY, z: 0.1 } };
}

function meshForBounds(value) {
  const size = new THREE.Vector3(
    value.max.x - value.min.x,
    value.max.y - value.min.y,
    value.max.z - value.min.z,
  );
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshBasicMaterial());
  mesh.position.set(
    (value.min.x + value.max.x) * 0.5,
    (value.min.y + value.max.y) * 0.5,
    (value.min.z + value.max.z) * 0.5,
  );
  return mesh;
}

function samplingFixture({ visualBounds, colliderBounds, openings = [] }) {
  const boundary = {
    id: 'boundary.sampled', side: 'north', kind: openings.length ? 'portal-frame' : 'solid',
    bounds: bounds(0, 10), openings, collider: true, opaque: true,
  };
  const visuals = new Map(visualBounds.map((value, index) => [`visual.${index}`, meshForBounds(value)]));
  const colliders = new Map(colliderBounds.map((value, index) => [`collider.${index}`, { bounds: value }]));
  return {
    plan: {
      structuralBoundaries: [boundary],
      walkableSurfaces: [],
      structuralFixtures: [],
      assemblyContract: { boundarySampleSpacing: 0.2, visualCollisionParityTolerance: 0.05 },
    },
    facade: {
      structuralRegistry: {
        visuals,
        colliders,
        byPlanId: new Map([['boundary.sampled', {
          visualIds: [...visuals.keys()],
          colliderIds: [...colliders.keys()],
        }]]),
      },
    },
  };
}

test('individual 0.21m sampling accepts a complete registered structural face', () => {
  const fixture = samplingFixture({ visualBounds: [bounds(0, 10)], colliderBounds: [bounds(0, 10)] });
  assert.deepEqual(buildStructuralAssemblyProof(fixture.plan, fixture.facade).mismatches, []);
});

test('portal openings are exempted exactly while their surrounding wall remains sampled', () => {
  const segments = [
    bounds(0, 4), bounds(6, 10), bounds(4, 6, 0, 1), bounds(4, 6, 3, 4),
  ];
  const fixture = samplingFixture({
    visualBounds: segments,
    colliderBounds: segments,
    openings: [{
      id: 'opening.sampled', portalId: 'portal.sampled',
      center: { x: 5, y: 2, z: 0 },
      dimensions: { width: 2, height: 2, depth: 0.4 },
    }],
  });
  assert.deepEqual(buildStructuralAssemblyProof(fixture.plan, fixture.facade).mismatches, []);
});

test('sampling rejects a missing middle visual even when its union AABB is unchanged', () => {
  const fixture = samplingFixture({
    visualBounds: [bounds(0, 2), bounds(8, 10)],
    colliderBounds: [bounds(0, 10)],
  });
  const proof = buildStructuralAssemblyProof(fixture.plan, fixture.facade);
  assert.ok(proof.mismatches.some(({ kind }) => kind === 'sampled-face-parity'));
  assert.ok(proof.mismatches.some(({ samples }) => samples?.some((sample) => (
    sample.expectedSolid && !sample.visualCovered && sample.colliderCovered
  ))));
});

test('sampling rejects a missing middle collider even when its union AABB is unchanged', () => {
  const fixture = samplingFixture({
    visualBounds: [bounds(0, 10)],
    colliderBounds: [bounds(0, 2), bounds(8, 10)],
  });
  const proof = buildStructuralAssemblyProof(fixture.plan, fixture.facade);
  assert.ok(proof.mismatches.some(({ kind }) => kind === 'sampled-face-parity'));
  assert.ok(proof.mismatches.some(({ samples }) => samples?.some((sample) => (
    sample.expectedSolid && sample.visualCovered && !sample.colliderCovered
  ))));
});
