import test from 'node:test';
import assert from 'node:assert/strict';

const { Game } = await import('../../../src/Game.js');

test('V2 per-frame browser readiness sync never expands the full runtime diagnostics getter', () => {
  const game = Object.create(Game.prototype);
  const dataset = {};
  let fullRuntimeDiagnosticReads = 0;
  const dungeon = {
    generationMode: 'v2',
    fixture: 'golden',
    plan: { id: 'dungeon-v2.golden-complex.hot-path-proof' },
    validation: { accepted: true },
    runtimeValidationErrors: [],
    environmentRuntime: { safeguardActivations: 3, cameraContainmentAdjustments: 0 },
  };
  Object.defineProperty(dungeon, 'runtimeDiagnostics', {
    get() {
      fullRuntimeDiagnosticReads += 1;
      throw new Error('full runtime diagnostics are forbidden in the render-loop DOM mirror');
    },
  });
  game.container = { dataset };
  game.dungeon = dungeon;
  game.dungeonGenerationRequest = { mode: 'v2', fixture: 'golden' };
  game.cameraOcclusionEntries = [{
    object: {
      material: { transparent: false, opacity: 1, depthWrite: true },
      userData: { v2CameraOcclusionClass: 'opaque-enclosure' },
    },
  }];
  game.cameraOcclusionHiddenOwners = new Set();
  game.cameraOcclusionHiddenInstances = new Map();

  game._syncBrowserTestDataset();
  game._syncBrowserTestDataset();

  assert.equal(fullRuntimeDiagnosticReads, 0);
  assert.deepEqual(dataset, {
    browserTestReady: 'true',
    dungeonGenerationMode: 'v2',
    dungeonFixture: 'golden',
    dungeonPlanId: 'dungeon-v2.golden-complex.hot-path-proof',
    dungeonValidationStatus: 'accepted',
    dungeonRecoverySafeguardActivations: '3',
    cameraOcclusionPolicy: 'opaque-ray-hide',
    cameraOcclusionHiddenCount: '0',
    cameraContainmentAdjustments: '0',
  });
  assert.equal(dataset.frameHeartbeat, undefined,
    'V2 heartbeat evidence belongs to the read-only diagnostics bridge, not a live DOM mutation');
  assert.equal(dataset.playerRootY, undefined,
    'V2 physical-position evidence belongs to the read-only diagnostics bridge');
});
