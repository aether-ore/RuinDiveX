import assert from 'node:assert/strict';
import test from 'node:test';

import { planPublicFloorRoute } from './helpers/public-v1-journey.js';

const makeState = ({ action, targetId, playerAtTop = false }) => {
  const bottomKey = '0,0@y0.000';
  const topKey = '0,2@y14.000';
  const bottom = {
    index: 0,
    x: 0,
    z: 0,
    level: 0,
    elevation: 0,
    floorKey: bottomKey,
    traversalLinks: [{
      id: `${targetId}:forward`,
      targetId,
      action,
      toFloorKey: topKey,
    }],
  };
  const top = {
    index: 1,
    x: 0,
    z: 2,
    level: 1,
    elevation: 14,
    floorKey: topKey,
    traversalLinks: [{
      id: `${targetId}:reverse`,
      targetId,
      action,
      toFloorKey: bottomKey,
    }],
  };
  return {
    tileSize: 2.8,
    player: {
      position: playerAtTop
        ? { x: 0, y: 14, z: 5.6 }
        : { x: 0, y: 0, z: 0 },
    },
    floorTiles: [bottom, top],
    solidZones: [],
    doors: [],
    platforms: [],
  };
};

for (const [action, targetId] of [
  ['ladder', 'signed-ladder'],
  ['automatic_lift', 'signed-lift'],
]) {
  test(`public V1 floor graph follows ${action} links in both directions`, () => {
    const upward = planPublicFloorRoute(
      makeState({ action, targetId }),
      { x: 0, y: 14, z: 5.6 },
      { targetRadius: 0.4, maximumTargetVerticalDifference: 0.1 },
    );
    assert.equal(upward.at(-1).action, action);
    assert.equal(upward.at(-1).rise, 14);
    assert.equal(upward.at(-1).targetId, targetId);
    assert.equal(upward.at(-1).explicitMechanism, true);

    const downward = planPublicFloorRoute(
      makeState({ action, targetId, playerAtTop: true }),
      { x: 0, y: 0, z: 0 },
      { targetRadius: 0.4, maximumTargetVerticalDifference: 0.1 },
    );
    assert.equal(downward.at(-1).action, action);
    assert.equal(downward.at(-1).rise, -14);
    assert.equal(downward.at(-1).targetId, targetId);
    assert.equal(downward.at(-1).explicitMechanism, true);
  });
}
