import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.BOSS_CAPTURE_URL ?? 'http://127.0.0.1:5174';
const PORTRAIT_SIZE = 256;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PROFILE_IDS = Object.freeze([
  'pursuitRegent',
  'rubyOpticOracle',
  'ballisticsVizier',
  'revolvingFusillade',
  'highAngleBastion',
  'clusterSalvoReliquary',
  'feedDrumArsenal',
  'overloadReliquary',
]);

function validatePortraitPng(bytes, profileId) {
  if (bytes.length <= 26 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`Invalid PNG portrait capture for ${profileId}.`);
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  if (width !== PORTRAIT_SIZE || height !== PORTRAIT_SIZE || bitDepth !== 8 || colorType !== 6) {
    throw new Error(
      `Invalid portrait capture for ${profileId}: ${width}x${height}, bit depth ${bitDepth}, color type ${colorType}.`,
    );
  }
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: PORTRAIT_SIZE, height: PORTRAIT_SIZE },
    deviceScaleFactor: 1,
  });
  await page.goto(`${BASE_URL}/?bossDebug=1&reaverbotSeed=boss-hunt-portraits`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => Boolean(window.game?.renderer && window.game?.spawner));
  await page.evaluate((portraitSize) => {
    window.game.stop();
    document.getElementById('ui-root')?.setAttribute('hidden', '');
    window.game.renderer.setPixelRatio(1);
    window.game.renderer.setSize(portraitSize, portraitSize, false);
    window.game.scene.fog = null;
    window.game.scene.background.setHex(0x12100e);
    if (window.game.dungeon?.group) window.game.dungeon.group.visible = false;
    if (window.game.player?.root) window.game.player.root.visible = false;
    window.game.projectiles?.clear?.('portrait-capture');
  }, PORTRAIT_SIZE);

  // Prime WebGL programs and asynchronous texture uploads before the first
  // authored capture. Without this warm-up Chromium can return an empty first
  // canvas even though the staged boss is present in the scene graph.
  await page.evaluate(() => {
    const game = window.game;
    const warmup = game.debugSpawnBoss('revolvingFusillade');
    if (warmup?.boss) {
      warmup.boss.stats.damage = 0;
      warmup.boss.bossState.arenaCooldown = Number.POSITIVE_INFINITY;
      game.renderer.compile(game.scene, game.camera);
      game.renderer.render(game.scene, game.camera);
    }
  });
  await page.waitForTimeout(900);
  await page.evaluate(() => window.game.renderer.render(window.game.scene, window.game.camera));

  for (const profileId of PROFILE_IDS) {
    const captureState = await page.evaluate((id) => {
      const game = window.game;
      const result = game.debugSpawnBoss(id);
      if (!result?.ok || !result.boss) return { ok: false, message: result?.message ?? result?.reason };
      const boss = result.boss;
      boss.debugGallery = true;
      boss.bossState.arenaCooldown = Number.POSITIVE_INFINITY;
      boss.root.position.set(0, 0, 0);
      boss.root.rotation.set(0, -0.38, 0);
      boss.root.updateWorldMatrix(true, true);
      const size = boss.visual?.size ?? { x: 3, y: 3, z: 3 };
      const targetY = Math.max(0.8, Number(size.y) * 0.46);
      const largest = Math.max(Number(size.x) || 3, Number(size.y) || 3, Number(size.z) || 3);
      const distance = Math.max(5.4, largest * 1.72);
      const camera = game.camera;
      camera.aspect = 1;
      camera.fov = 42;
      camera.near = 0.1;
      camera.far = 160;
      camera.updateProjectionMatrix();
      camera.position.set(distance * 0.58, targetY + distance * 0.15, distance * 0.82);
      camera.lookAt(0, targetY, 0);
      game.renderer.render(game.scene, camera);
      return { ok: true, displayName: boss.genome?.name ?? id };
    }, profileId);
    if (!captureState.ok) throw new Error(`Could not stage ${profileId}: ${captureState.message}`);
    await page.waitForTimeout(700);
    const pngDataUrl = await page.evaluate(() => {
      const game = window.game;
      game.renderer.render(game.scene, game.camera);
      return game.renderer.domElement.toDataURL('image/png');
    });
    if (!pngDataUrl.startsWith('data:image/png;base64,')) {
      throw new Error(`Could not encode ${profileId} portrait as PNG.`);
    }
    const pngBytes = Buffer.from(pngDataUrl.slice(pngDataUrl.indexOf(',') + 1), 'base64');
    validatePortraitPng(pngBytes, profileId);
    const outputDir = path.join(REPO_ROOT, 'assets', 'textures', 'reaverbots', 'bosses', profileId);
    await mkdir(outputDir, { recursive: true });
    await writeFile(path.join(outputDir, 'hunt-portrait.png'), pngBytes);
    process.stdout.write(`Captured ${profileId}: ${captureState.displayName}\n`);
  }
} finally {
  await browser.close();
}
