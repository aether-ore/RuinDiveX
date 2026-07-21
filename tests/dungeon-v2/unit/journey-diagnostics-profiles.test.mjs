import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readV2Diagnostics,
  armV2PublicInputHeartbeat,
  waitForV2HeartbeatIncrement,
  waitForV2Runtime,
} from '../helpers/journey-runtime.mjs';

test('journey diagnostics requests the selected read-only snapshot profile', async () => {
  const page = {
    async evaluate(_reader, request) {
      assert.deepEqual(request, {
        bridgeName: '__RUINDIVEX_V2_DIAGNOSTICS__',
        profile: 'movement',
      });
      return { frameHeartbeat: 7, playerPosition: { x: 1, y: 2, z: 3 } };
    },
  };
  assert.deepEqual(await readV2Diagnostics(page, 'movement'), {
    frameHeartbeat: 7,
    playerPosition: { x: 1, y: 2, z: 3 },
  });
});

test('journey heartbeat observer is armed for the requested real public keys', async () => {
  const page = {
    async evaluateHandle(_reader, request) {
      assert.deepEqual(request, {
        bridgeName: '__RUINDIVEX_V2_DIAGNOSTICS__',
        expectedCodes: ['KeyW', 'KeyD'],
        timeoutMs: 250,
      });
      return { async evaluate() { return 18; } };
    },
  };
  const observer = await armV2PublicInputHeartbeat(
    page,
    ['KeyW', 'KeyD'],
    { timeout: 250 },
  );
  assert.equal(await waitForV2HeartbeatIncrement(observer), 18);
});

test('journey startup rejects immediately with compact deterministic plan diagnostics', async () => {
  let waited = false;
  const page = {
    locator(selector) {
      if (selector === '#dungeon-v2-generation-error') {
        return {
          count: async () => 1,
          textContent: async () => `Dungeon Generation V2 rejected\n${JSON.stringify({
            code: 'DUNGEON_PLAN_V2_INVALID',
            message: 'boundary.connector.test.ceiling has invalid side or bounds.',
            result: { candidate: 'intentionally omitted from the thrown message' },
          })}`,
        };
      }
      return { getAttribute: async () => 'DUNGEON_PLAN_V2_INVALID' };
    },
    async waitForTimeout() { waited = true; },
  };
  await assert.rejects(
    waitForV2Runtime(page),
    /Dungeon V2 startup rejected \[DUNGEON_PLAN_V2_INVALID\]: boundary\.connector\.test\.ceiling has invalid side or bounds\./,
  );
  assert.equal(waited, false, 'deterministic construction errors must not look like heartbeat hangs');
});
