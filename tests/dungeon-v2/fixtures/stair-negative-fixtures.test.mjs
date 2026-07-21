import test from 'node:test';
import {
  assertAcceptanceFailure,
  assertStairAssemblyProofs,
} from '../helpers/accepted-fixture.mjs';

function stairFixture() {
  const stepCount = 23;
  const actualRiser = 4 / stepCount;
  const actualTread = 12 / stepCount;
  const collisionSamples = [
    { sampleId: 'inside-center', position: { x: 6, y: 2, z: 0 }, expectedInside: true },
    { sampleId: 'inside-left', position: { x: 6, y: 2, z: -1.6 }, expectedInside: true },
    { sampleId: 'inside-right', position: { x: 6, y: 2, z: 1.6 }, expectedInside: true },
    { sampleId: 'outside-left', position: { x: 6, y: 2, z: -1.611 }, expectedInside: false },
    { sampleId: 'outside-right', position: { x: 6, y: 2, z: 1.611 }, expectedInside: false },
  ];
  const proof = {
    surfaceId: 'surface.stairs',
    accepted: true,
    origin: { x: 0, y: 0, z: 0 },
    end: { x: 12, y: 4, z: 0 },
    direction: { x: 1, z: 0 },
    tangent: { x: 0, z: 1 },
    length: 12,
    width: 3.2,
    rise: 4,
    stepCount,
    maximumRiser: 0.18,
    minimumTread: 0.45,
    actualMaximumRiser: actualRiser,
    actualTread,
    continuousCollision: true,
    ledgeClimbDisabled: true,
    collisionSampleSpacing: 0.2,
    collisionSamples,
    visualSteps: Array.from({ length: stepCount }, (_, index) => ({
      index, riser: actualRiser, tread: actualTread,
    })),
    collision: {
      type: 'continuous-sampled-ramp',
      origin: { x: 0, y: 0, z: 0 },
      end: { x: 12, y: 4, z: 0 },
      width: 3.2,
      ledgeClimbDisabled: true,
    },
  };
  const plan = {
    walkableSurfaces: [
      {
        id: 'surface.start-deck',
        bounds: { min: { x: -3, y: -0.3, z: -3 }, max: { x: 3, y: 0, z: 3 } },
      },
      {
        id: 'surface.stairs',
        geometry: {
          type: 'stairs',
          path: [{ x: 0, y: 0, z: 0 }, { x: 12, y: 4, z: 0 }],
          width: 3.2,
          maxRiser: 0.18,
          minimumTread: 0.45,
          ledgeClimbDisabled: true,
          endpointSurfaceIds: { start: 'surface.start-deck', end: 'surface.end-deck' },
          minimumEndpointOverlap: 1.2,
          maximumEndpointHeightDelta: 0.05,
          minimumUsableSeamWidth: 3.2,
        },
      },
      {
        id: 'surface.end-deck',
        bounds: { min: { x: 9, y: 3.7, z: -3 }, max: { x: 15, y: 4, z: 3 } },
      },
    ],
  };
  const collider = {
    surfaceType: 'exact-oriented-ramp-strip',
    rampWidth: 3.2,
    ledgeClimbDisabled: true,
  };
  const assembly = {
    stairProofs: [proof],
    structuralRegistry: {
      byPlanId: new Map([
        ['surface.start-deck', { colliderIds: ['collider.start-deck'] }],
        ['surface.stairs', { colliderIds: ['collider.stairs'] }],
        ['surface.end-deck', { colliderIds: ['collider.end-deck'] }],
      ]),
      colliders: new Map([
        ['collider.start-deck', { bounds: JSON.parse(JSON.stringify(plan.walkableSurfaces[0].bounds)) }],
        ['collider.stairs', collider],
        ['collider.end-deck', { bounds: JSON.parse(JSON.stringify(plan.walkableSurfaces[2].bounds)) }],
      ]),
    },
    isPositionOnExactStairSurface(_surfaceId, position) {
      return position.x >= 0 && position.x <= 12 && Math.abs(position.z) <= 1.6;
    },
    getExactStairSurfaceElevationAt(position) {
      return position.x / 12 * 4;
    },
  };
  return { plan, assembly, proof, collider };
}

test('assembled stair baseline proves visual steps and exact smooth collision strip', () => {
  const { plan, assembly } = stairFixture();
  assertStairAssemblyProofs(plan, assembly);
});

const negatives = [
  ['stair-visual-riser-too-high', ({ proof }) => {
    proof.stepCount = 8;
    proof.actualMaximumRiser = 0.5;
    proof.visualSteps = Array.from({ length: 8 }, (_, index) => ({ index, riser: 0.5, tread: 1.5 }));
  }],
  ['stair-visual-tread-too-short', ({ proof }) => { proof.actualTread = 0.3; }],
  ['stair-collision-path-mismatch', ({ proof }) => { proof.collision.end.x = 11; }],
  ['stair-ledge-climb-enabled', ({ proof }) => { proof.collision.ledgeClimbDisabled = false; }],
  ['stair-collision-sampling-coarse', ({ proof }) => { proof.collisionSampleSpacing = 0.3; }],
  ['stair-collider-not-exact-strip', ({ collider }) => { collider.surfaceType = 'broad-aabb'; }],
  ['stair-collision-inside-gap', ({ assembly }) => {
    assembly.isPositionOnExactStairSurface = (_surfaceId, position) => Math.abs(position.x - 6) > 0.01;
  }],
  ['stair-collision-outside-width', ({ assembly }) => {
    assembly.isPositionOnExactStairSurface = () => true;
  }],
  ['stair-collision-height-mismatch', ({ assembly }) => {
    assembly.getExactStairSurfaceElevationAt = () => 3;
  }],
  ['stair-endpoint-seam-gap', ({ plan }) => {
    plan.walkableSurfaces[2].bounds.max.y = 3.8;
  }],
  ['stair-endpoint-overlap-short', ({ plan }) => {
    plan.walkableSurfaces[2].bounds.max.x = 12.8;
  }],
  ['stair-endpoint-width-narrow', ({ plan }) => {
    plan.walkableSurfaces[1].geometry.minimumUsableSeamWidth = 1;
  }],
  ['stair-endpoint-collision-gap', ({ assembly }) => {
    assembly.structuralRegistry.colliders.get('collider.end-deck').bounds.max.x = 12.4;
  }],
];

for (const [code, mutate] of negatives) {
  test(`assembled stair gate rejects ${code}`, () => {
    const fixture = stairFixture();
    mutate(fixture);
    assertAcceptanceFailure(code, () => assertStairAssemblyProofs(fixture.plan, fixture.assembly));
  });
}
