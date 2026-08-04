import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';

const namedDescendants = (root, name) => {
  const matches = [];
  root.traverse((object) => {
    if (object.name === name) matches.push(object);
  });
  return matches;
};

const logicalNamedDescendants = (root, name) => {
  const matches = [];
  const instanceMatrix = new THREE.Matrix4();
  const worldMatrix = new THREE.Matrix4();
  root.traverse((object) => {
    if (object.name !== name) return;
    const metadata = object.userData?.factoryCatwalkInstanceMetadata;
    if (!object.isInstancedMesh || !Array.isArray(metadata)) {
      matches.push({ object, position: object.position.clone(), metadata: object.userData });
      return;
    }
    object.updateWorldMatrix(true, false);
    for (const record of metadata) {
      object.getMatrixAt(record.instanceId, instanceMatrix);
      worldMatrix.multiplyMatrices(object.matrixWorld, instanceMatrix);
      matches.push({
        object,
        position: new THREE.Vector3().setFromMatrixPosition(worldMatrix),
        metadata: record,
      });
    }
  });
  return matches;
};

test('signed connector decoration uses its lower endpoint as the structural datum', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const supportMetal = new THREE.MeshBasicMaterial();
  const wall = new THREE.MeshBasicMaterial();
  const materials = {
    supportMetal,
    wallMacroTiles: { mm: wall },
  };
  const lowerFloor = {
    x: 0,
    z: 0,
    elevation: -14,
    supportBaseElevation: -14,
    surface: 'connectorGalleryFloor',
    connectionId: 'signed-connector',
  };
  const lowerGroup = new THREE.Group();
  generator._addIndustrialFactoryFeatures(
    lowerGroup,
    [lowerFloor],
    materials,
    new Set(),
    generator._createFloorTileLookup([lowerFloor]),
  );

  assert.equal(
    namedDescendants(lowerGroup, 'factoryBasementRetainingWall').length,
    0,
    'an absolute negative Y must not turn the connector source floor into a global-zero basement',
  );

  const upperFloor = {
    ...lowerFloor,
    x: 2,
    elevation: 0,
    surface: 'upperConnectionBridge',
  };
  const upperGroup = new THREE.Group();
  generator._addIndustrialFactoryFeatures(
    upperGroup,
    [upperFloor],
    materials,
    new Set(),
    generator._createFloorTileLookup([upperFloor]),
  );

  const posts = logicalNamedDescendants(upperGroup, 'factoryCatwalkSupport');
  const rails = namedDescendants(upperGroup, 'factoryCatwalkRailRun');
  assert.equal(posts.length, 4);
  assert.ok(posts.every(({ position }) => position.y > -14 && position.y < 0));
  assert.ok(rails.length >= 2, 'the physically elevated connector deck needs visible edge rails');
  assert.equal(namedDescendants(upperGroup, 'factoryBasementRetainingWall').length, 0);

  supportMetal.dispose();
  wall.dispose();
});

test('factory catwalk posts preserve lower-route floor and headroom columns', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const supportMetal = new THREE.MeshBasicMaterial();
  const wall = new THREE.MeshBasicMaterial();
  const materials = {
    supportMetal,
    wallMacroTiles: { mm: wall },
  };
  const lowerConnectorFloor = {
    x: 0,
    z: 0,
    elevation: 0,
    supportBaseElevation: 0,
    surface: 'connectorGalleryFloor',
    connectionId: 'lower-over-under-route',
  };
  const overlappingUpperDeck = {
    x: 0,
    z: 0,
    elevation: 4.2,
    supportBaseElevation: 0,
    surface: 'upperConnectionBridge',
    connectionId: 'upper-over-under-route',
  };
  const clearUpperDeck = {
    ...overlappingUpperDeck,
    x: 2,
    connectionId: 'clear-upper-route',
  };
  const floorTiles = [
    lowerConnectorFloor,
    overlappingUpperDeck,
    clearUpperDeck,
  ];
  const group = new THREE.Group();

  generator._addIndustrialFactoryFeatures(
    group,
    floorTiles,
    materials,
    new Set(),
    generator._createFloorTileLookup(floorTiles),
  );

  const posts = logicalNamedDescendants(group, 'factoryCatwalkSupport');
  const underBeams = logicalNamedDescendants(group, 'factoryCatwalkUnderBeam');
  assert.equal(posts.length, 4, 'only the unobstructed elevated deck should emit posts');
  assert.ok(
    posts.every(({ position }) => position.x > generator.tileSize),
    'no support post may descend through the lower connector floor or its player headroom',
  );
  assert.equal(
    underBeams.length,
    4,
    'both elevated decks retain harmless underbeams directly beneath their surfaces',
  );

  supportMetal.dispose();
  wall.dispose();
});
