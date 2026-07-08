import Game from './Game.js';

const game = new Game({
  container: document.getElementById('game-container'),
});

game.start();

// Small development hooks for trying systems from the browser console.
window.game = game;
window.spawnElite = (type = 'tank') => game.spawnEnemy(type, true);
window.generateLoot = (type, rarity) => game.generateLoot(type, rarity);
window.openInventory = () => game.setInventoryOpen(true);
window.setAnimationPreviewMode = (mode = 'off', options = {}) => game.setAnimationPreviewMode(mode, options);
window.getAnimationPreviewState = () => game.getAnimationPreviewState();
