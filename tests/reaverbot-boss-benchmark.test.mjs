import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REAVERBOT_BOSS_BENCHMARK_LEVELS,
  REAVERBOT_BOSS_BENCHMARK_PLAN_IDS,
  REAVERBOT_BOSS_DEPTH_FIVE_TTK_TARGET,
  runReaverbotBossBenchmark,
} from '../src/reaverbots/ReaverbotBossBenchmark.js';
import { REAVERBOT_BOSS_PROFILE_IDS } from '../src/reaverbots/ReaverbotBossCatalog.js';

test('boss benchmark reports every profile at depths 1, 5, and 10', () => {
  const report = runReaverbotBossBenchmark();
  assert.equal(report.rows.length, REAVERBOT_BOSS_PROFILE_IDS.length * REAVERBOT_BOSS_BENCHMARK_LEVELS.length);
  for (const level of REAVERBOT_BOSS_BENCHMARK_LEVELS) {
    const rows = report.rows.filter((entry) => entry.level === level);
    assert.deepEqual(rows.map((entry) => entry.bossProfileId), REAVERBOT_BOSS_PROFILE_IDS);
    for (const row of rows) {
      assert.deepEqual(Object.keys(row.weapons), REAVERBOT_BOSS_BENCHMARK_PLAN_IDS);
      assert.ok(row.healthScale >= 5.5 && row.healthScale <= 7.5);
      assert.ok(row.health > 0);
      assert.ok(row.armor >= 0);
      for (const [planId, weapon] of Object.entries(row.weapons)) {
        assert.ok(['cleared', 'unresolved'].includes(weapon.status), `${row.bossProfileId}/${planId} status`);
        if (weapon.status === 'cleared') {
          assert.ok(Number.isFinite(weapon.routeTtk), `${row.bossProfileId}/${planId} route TTK`);
        } else {
          assert.equal(weapon.routeTtk, null, `${row.bossProfileId}/${planId} unresolved route TTK`);
        }
        if (planId === 'directExplosion') {
          assert.equal(weapon.route, 'body-only');
          assert.equal(weapon.signatureRouteTtk, null);
          assert.equal(weapon.bodyRouteTtk, weapon.routeTtk);
          if (weapon.status === 'cleared') {
            assert.equal(
              weapon.routeTtk,
              Math.round((weapon.idealReleaseTtk + 0.18 + 1.1) * 1000) / 1000,
              'body-only Explosion must not receive signature acceleration or interrupt time',
            );
          }
        } else {
          assert.equal(weapon.route, 'signature-overload');
          assert.equal(weapon.signatureRouteTtk, weapon.routeTtk);
          assert.equal(weapon.bodyRouteTtk, null);
        }
      }
    }
  }
});

test('the frozen per-profile health scales keep the representative depth-five median in the authored TTK band', () => {
  const report = runReaverbotBossBenchmark({ levels: [5] });
  assert.equal(report.depthFivePassed, true);
  for (const row of report.rows) {
    assert.ok(
      row.medianRouteTtk >= REAVERBOT_BOSS_DEPTH_FIVE_TTK_TARGET.minimum
        && row.medianRouteTtk <= REAVERBOT_BOSS_DEPTH_FIVE_TTK_TARGET.maximum,
      `${row.bossProfileId}: ${row.medianRouteTtk}s`,
    );
  }
});
