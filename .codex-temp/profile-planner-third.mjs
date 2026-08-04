import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';
import { augmentDungeonDraft } from '../src/dungeon-augmentation/planner.js';
import { hashSeed, SeededRandom } from '../src/reaverbots/SeededRandom.js';

const seed = 'layout:augmentation-realized-v4-001';
const random = new SeededRandom(hashSeed(seed));
const generator = new DungeonGenerator({
  random: () => random.next(),
  difficulty: 1,
  augmentationProfileId: 'industrial-supplement-preview-v4',
  augmentationSeed: seed,
  basePlanHash: `v1:${seed}:depth:1:revolvingFusillade`,
});
const inertTexture = new THREE.Texture();
generator.textureCache.set('planner-third-profile', inertTexture);
generator._loadRuinTexture = () => inertTexture;
const steps = generator._generateIndustrialDungeonWithAugmentationReplaySteps();
const planningStep = steps.next();
if (planningStep.done || planningStep.value?.kind !== 'dungeon-augmentation-planning-request') {
  throw new Error('Seed001 did not yield a planner request.');
}
const startedAt = performance.now();
const result = augmentDungeonDraft(planningStep.value.plannerInput);
const elapsedMs = performance.now() - startedAt;
console.log(JSON.stringify({
  elapsedMs,
  status: result.status,
  error: result.error ?? null,
  augmentationPlanHash: result.overlayPlan?.augmentationPlanHash ?? null,
  effectivePlanHash: result.overlayPlan?.effectivePlanHash ?? null,
  diagnostics: result.diagnostics?.plannerTelemetry ?? null,
}, null, 2));
steps.return();
