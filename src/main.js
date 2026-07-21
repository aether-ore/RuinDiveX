import Game from './Game.js';
import {
  DUNGEON_GENERATION_MODE,
  readDungeonGenerationRequest,
} from './DungeonGeneratorFactory.js';
import { stablePlanStringify } from './dungeon-v2/DungeonPlanDiagnostics.js';
import { getReaverbotCatalogSummary } from './reaverbots/ReaverbotGenerator.js';
import { getReaverbotSalvageCatalogSummary } from './reaverbots/ReaverbotSalvageCatalog.js';

const gameContainer = document.getElementById('game-container');
const dungeonGenerationRequest = readDungeonGenerationRequest();

function compactDungeonV2FailureResult(result) {
  if (!result || typeof result !== 'object') return null;
  return {
    accepted: result.accepted === true,
    valid: result.valid === true,
    phase: result.phase ?? 'validation',
    diagnosticHash: result.diagnosticHash ?? null,
    diagnostics: result.diagnostics ?? null,
    errors: result.errors ?? [],
    warnings: result.warnings ?? [],
  };
}

let game;
try {
  game = await Game.create({
    container: gameContainer,
  });
} catch (error) {
  if (dungeonGenerationRequest.mode === DUNGEON_GENERATION_MODE.V2) {
    const diagnostic = {
      code: error?.code ?? 'DUNGEON_V2_CONSTRUCTION_FAILED',
      message: error?.message ?? 'Dungeon V2 construction failed.',
      // Never dump the complete rejected candidate into the DOM. The compact,
      // deterministic diagnostics retain every actionable error/hash while
      // keeping browser failure capture fast and readable.
      result: compactDungeonV2FailureResult(error?.result ?? error?.diagnostics),
    };
    const diagnosticText = stablePlanStringify(diagnostic);
    document.body.dataset.dungeonGenerationMode = DUNGEON_GENERATION_MODE.V2;
    document.body.dataset.dungeonV2Failure = diagnostic.code;
    const panel = document.createElement('pre');
    panel.id = 'dungeon-v2-generation-error';
    panel.setAttribute('role', 'alert');
    panel.textContent = `Dungeon Generation V2 rejected\n${diagnosticText}`;
    gameContainer?.replaceChildren(panel);
    console.error('Dungeon Generation V2 rejected', diagnostic);
  }
  throw error;
}

game.start();

// V2 acceptance exposes only the frozen, deep-cloned diagnostics bridge
// installed by DungeonRuntimeV2. Keep the legacy development console hooks for
// existing V1 workflows, but never publish the live V2 Game object or mutation
// helpers to a browser journey.
if (dungeonGenerationRequest.mode !== DUNGEON_GENERATION_MODE.V2) {
  window.game = game;
  window.spawnElite = (type = 'tank') => game.spawnEnemy(type, true);
  window.spawnReaverbot = ({ archetypeId, seed, intent = 'any', elite = false, position = null } = {}) => (
    game.spawner.spawnEnemy(intent, elite, position, {
      archetypeId,
      seed,
      encounterSize: ['packHunter', 'tractorController'].includes(archetypeId) ? 2 : 1,
      allowRandomElite: false,
    })
  );
  window.spawnCuratedReaverbot = (type = 'horokko', elite = false, position = null) => (
    game.spawner.spawnCuratedEnemy(type, elite, position)
  );
  window.getReaverbotCatalog = () => getReaverbotCatalogSummary();
  window.getReaverbotSalvageCatalog = () => getReaverbotSalvageCatalogSummary();
  window.generateLoot = (type, rarity) => game.generateLoot(type, rarity);
  window.openInventory = () => game.setInventoryOpen(true);
  window.setAnimationPreviewMode = (mode = 'off', options = {}) => game.setAnimationPreviewMode(mode, options);
  window.getAnimationPreviewState = () => game.getAnimationPreviewState();
}
