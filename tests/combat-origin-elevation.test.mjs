import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import {
  clampWeaponOriginToPlayerHeight,
  resolveCombatSurfaceHeight,
} from '../src/CombatSystem.js';

test('weapon-origin minimum heights are relative to the player on subterranean floors', () => {
  const undergroundRootY = -28;
  const corrected = clampWeaponOriginToPlayerHeight(
    new Vector3(3, -40, 5),
    undergroundRootY,
    1.05,
  );

  assert.deepEqual(corrected.toArray(), [3, -26.95, 5]);
  assert.ok(corrected.y < 0, 'a subterranean muzzle must remain below world zero');
});

test('weapon-origin correction is translation invariant and preserves a valid authored muzzle', () => {
  const localMuzzleHeight = 1.32;
  const underground = clampWeaponOriginToPlayerHeight(
    new Vector3(0, -14 + localMuzzleHeight, 0),
    -14,
    1.05,
  );
  const elevated = clampWeaponOriginToPlayerHeight(
    new Vector3(0, 14 + localMuzzleHeight, 0),
    14,
    1.05,
  );

  assert.equal(underground.y, -12.68);
  assert.equal(elevated.y, 15.32);
  assert.equal(elevated.y - underground.y, 28);
});

test('combat surface visuals preserve local offsets across signed room elevations', () => {
  const point = new Vector3(4, -28, 9);

  assert.equal(resolveCombatSurfaceHeight(point, -28, 0.035), -27.965);
  assert.equal(resolveCombatSurfaceHeight(point, -28, 0.14), -27.86);
  assert.equal(resolveCombatSurfaceHeight(point, -28, 0.08), -27.92);

  const translatedPoint = point.clone().add(new Vector3(0, 42, 0));
  const translatedHeight = resolveCombatSurfaceHeight(translatedPoint, 14, 0.035);
  assert.equal(translatedHeight - resolveCombatSurfaceHeight(point, -28, 0.035), 42);
});

test('combat surface height uses the caller floor fallback instead of world zero', () => {
  const muzzle = new Vector3(0, -26.7, 0);

  assert.equal(resolveCombatSurfaceHeight(muzzle, undefined, 0.08, -28), -27.92);
  assert.equal(resolveCombatSurfaceHeight(muzzle, Number.NaN, 0.08, -28), -27.92);
});
