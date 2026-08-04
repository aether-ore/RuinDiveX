import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';

function createPresentation(name, x) {
  const group = new THREE.Group();
  group.name = name;
  group.position.x = x;
  group.add(new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  ));
  return group;
}

function isEffectivelyVisible(object) {
  for (let current = object; current; current = current.parent) {
    if (!current.visible) {
      return false;
    }
  }
  return true;
}

test('a critical supplement descendant exempts only its owner from static culling', () => {
  const generator = new DungeonGenerator({
    random: () => 0.5,
    tileSize: 2.8,
  });
  const root = new THREE.Group();
  root.name = 'DungeonRoot';

  const supplementRoot = new THREE.Group();
  supplementRoot.name = 'DungeonSupplementRoot';
  supplementRoot.userData.dungeonSupplementRoot = true;
  root.add(supplementRoot);

  const module = new THREE.Group();
  module.name = 'SupplementModule';
  supplementRoot.add(module);

  const criticalOwner = createPresentation('CriticalDoorOwner', 0);
  const nestedStaticPresentation = createPresentation('NestedStaticPresentation', 4);
  const siblingStaticPresentation = createPresentation('SiblingStaticPresentation', 12);
  module.add(criticalOwner, nestedStaticPresentation);
  supplementRoot.add(siblingStaticPresentation);

  const cullGroups = generator._createStaticRenderCullGroups(root, [{
    object: criticalOwner,
  }]);

  assert.equal(
    criticalOwner.parent,
    module,
    'the exact critical owner must remain directly attached outside a cull group',
  );
  assert.equal(
    criticalOwner.parent.userData.renderCullGroup,
    undefined,
    'a critical owner must not be reparented beneath a visibility-controlled group',
  );

  for (const presentation of [nestedStaticPresentation, siblingStaticPresentation]) {
    assert.equal(
      presentation.parent?.userData?.renderCullGroup,
      true,
      `${presentation.name} should still be registered beneath a static cull group`,
    );
    assert.ok(
      cullGroups.some(({ group }) => group === presentation.parent),
      `${presentation.name} should be represented in the returned cull metadata`,
    );
  }

  for (const { group } of cullGroups) {
    group.visible = false;
  }

  assert.equal(
    isEffectivelyVisible(criticalOwner),
    true,
    'culling supplement presentation must not hide the critical owner',
  );
  assert.equal(isEffectivelyVisible(nestedStaticPresentation), false);
  assert.equal(isEffectivelyVisible(siblingStaticPresentation), false);
});
