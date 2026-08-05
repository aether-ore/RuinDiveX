import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { DungeonGenerator } from '../src/DungeonGenerator.js';

const FORBIDDEN_BROWSER_IMPORT = /(?:^|\n)\s*import(?:[\s\S]*?\sfrom\s*)?['"][^'"]*(?:BrowserPlannerWorker|planner\.js)['"]\s*;?/g;
const FORBIDDEN_DYNAMIC_IMPORT = /\bimport\s*\(\s*['"][^'"]*(?:BrowserPlannerWorker|planner\.js)['"]\s*\)/g;

test('authored browser entry points do not import a worker or procedural planner', async () => {
  for (const relativePath of ['../src/Game.js', '../src/DungeonGenerator.js']) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    assert.doesNotMatch(source, FORBIDDEN_BROWSER_IMPORT, relativePath);
    assert.doesNotMatch(source, FORBIDDEN_DYNAMIC_IMPORT, relativePath);
  }
});

test('legacy procedural planning fails before context allocation without Node injection', () => {
  const generator = new DungeonGenerator({
    augmentationProfileId: 'industrial-supplement-preview-v1',
  });
  generator._createIndustrialDungeonAugmentationPlanningContext = () => {
    throw new Error('procedural context allocation must not run');
  };

  assert.throws(
    () => generator._planIndustrialDungeonAugmentation({
      rooms: [],
      connectionPlans: [],
    }),
    (error) => (
      error?.code === 'DUNGEON_AUGMENTATION_OFFLINE_PLANNER_REQUIRED'
      && error?.status === 'legacy-profile-offline-only'
      && error?.reason === 'offline-planner-required'
    ),
  );
});

test('sync procedural replay uses only its explicit Node planner injection', () => {
  const plannerInputs = [];
  const generator = new DungeonGenerator({
    augmentationProfileId: 'industrial-supplement-preview-v1',
    offlineAugmentationPlanner(plannerInput) {
      plannerInputs.push(plannerInput);
      return { status: 'applied', diagnostics: { accepted: true } };
    },
  });
  generator._generateIndustrialDungeonWithAugmentationReplaySteps = function* replayHarness() {
    const planned = yield {
      requestKey: 'offline-request',
      plannerInput: { fixture: 'node-only' },
    };
    return planned;
  };

  const planned = generator._generateIndustrialDungeonWithAugmentationReplay();
  assert.deepEqual(plannerInputs, [{ fixture: 'node-only' }]);
  assert.equal(planned.requestKey, 'offline-request');
  assert.equal(planned.result.status, 'applied');
});
