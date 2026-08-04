import Game from './Game.js';
import { getReaverbotCatalogSummary } from './reaverbots/ReaverbotGenerator.js';
import { getReaverbotSalvageCatalogSummary } from './reaverbots/ReaverbotSalvageCatalog.js';

const launchParams = new URLSearchParams(window.location.search);
const editorPlaytestHost = launchParams.get('editorPlaytestHost') === '1';
const gameReady = Game.create({
  container: document.getElementById('game-container'),
  ...(editorPlaytestHost ? {
    busterLabStorageOptions: {
      storage: null,
      storageEventTarget: null,
      saveContextId: 'level-editor-playtest',
    },
  } : {}),
});
window.gameReady = gameReady;
const game = await gameReady;

if (editorPlaytestHost) {
  document.documentElement.dataset.editorPlaytestHost = 'ready';
  const { installLevelEditorPlaytestHost } = await import('./level-editor/playtestHost.js');
  installLevelEditorPlaytestHost(game);
} else {
  game.start();
}

// Small development hooks for trying systems from the browser console.
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
