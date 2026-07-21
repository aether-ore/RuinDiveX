import { expect, test } from '@playwright/test';

async function waitForGame(page) {
  await page.waitForFunction(() => Boolean(window.game?.spawner && window.game?.ui));
}

test('authored Ruby pivots, combat anchors, scoped materials, and textures stay coherent', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&bossDebug=1&reaverbotSeed=authored-ruby-pivot-regression');
  await waitForGame(page);

  await page.evaluate(() => {
    window.game.stop();
    window.authoredRubyPivotBoss = window.game.debugSpawnBoss('rubyOpticOracle').boss;
  });
  await page.waitForFunction(() => window.authoredRubyPivotBoss?.authoredVisualState !== 'loading');

  const result = await page.evaluate(() => {
    const game = window.game;
    const boss = window.authoredRubyPivotBoss;
    const visual = boss.visual;
    const localOf = (object) => {
      const point = boss.root.position.clone();
      object.getWorldPosition(point);
      boss.root.worldToLocal(point);
      return { x: point.x, y: point.y, z: point.z };
    };
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

    boss.root.updateMatrixWorld(true);
    const eye = localOf(visual.eye.lens);
    const weakPoint = localOf(visual.weakPoint.core);
    const weapon = localOf(visual.weapon.group);
    const muzzle = localOf(visual.weapon.muzzle);
    const shutterBefore = localOf(visual.authoredShutters[0]);
    const arrayBefore = localOf(visual.authoredOracleArray[0]);

    const eyeMaterial = visual.authoredEyeRenderParts.find((part) => part.isMesh)?.material;
    const arrayMaterial = visual.authoredOracleArrayRenderParts
      .find((part) => part.name === 'right_oracle_array_lens_0')?.material;
    const unscopedRubyMaterial = visual.authoredModel
      .getObjectByName('eye_shutter_sensor_00')?.material;
    const unscopedIntensityBefore = unscopedRubyMaterial?.emissiveIntensity;

    boss.specialEncounter.initialize(game);
    boss.specialEncounter.debugStartAttack('shutterFlash', game);
    boss._animateVisual(0.1);
    boss.root.updateMatrixWorld(true);

    const shutterAfter = localOf(visual.authoredShutters[0]);
    const arrayAfter = localOf(visual.authoredOracleArray[0]);
    const materialState = {
      eyeArrayDistinct: eyeMaterial !== arrayMaterial,
      eyeUnscopedDistinct: eyeMaterial !== unscopedRubyMaterial,
      arrayUnscopedDistinct: arrayMaterial !== unscopedRubyMaterial,
      eyeIntensity: eyeMaterial?.emissiveIntensity,
      arrayIntensity: arrayMaterial?.emissiveIntensity,
      unscopedIntensityBefore,
      unscopedIntensityAfter: unscopedRubyMaterial?.emissiveIntensity,
    };

    const authoredRoot = visual.root;
    const ownedTextures = authoredRoot.userData.authoredOwnedTextures;
    const ownedTextureCount = ownedTextures?.size ?? 0;
    const sampledTexture = ownedTextures?.values?.().next?.().value ?? null;
    let textureDisposeCount = 0;
    sampledTexture?.addEventListener?.('dispose', () => { textureDisposeCount += 1; });
    boss.dispose();

    const output = {
      anchorNames: {
        eye: visual.eye.group.name,
        weakPoint: visual.weakPoint.group.name,
        weapon: visual.weapon.group.name,
      },
      eye,
      weakPoint,
      weapon,
      muzzle,
      expectedScale: Math.max(0.1, boss.collisionHeight / 3.85),
      shutterCount: visual.authoredShutters.length,
      shutterPartCounts: visual.authoredShutters.map(
        (pivot) => pivot.userData.authoredShutterParts?.filter((part) => part.parent === pivot).length ?? 0,
      ),
      irisCount: visual.authoredIrisRings.length,
      oracleArrayPivotCount: visual.authoredOracleArray.length,
      oracleArrayPartCount: visual.authoredOracleArrayRenderParts
        .filter((part) => part.parent === visual.authoredOracleArray[0]).length,
      shutterCenterDrift: distance(shutterBefore, shutterAfter),
      arrayCenterDrift: distance(arrayBefore, arrayAfter),
      materialState,
      ownedTextureCount,
      textureDisposeCount,
      ownedTexturesCleared: ownedTextures?.size === 0,
      authoredRootRemoved: authoredRoot.parent == null,
    };

    boss.root.removeFromParent();
    const index = game.enemies.indexOf(boss);
    if (index >= 0) game.enemies.splice(index, 1);
    delete window.authoredRubyPivotBoss;
    return output;
  });

  expect(result.anchorNames).toEqual({
    eye: 'authoredRubyMainEyeAnchor',
    weakPoint: 'authoredRubyRearWeakPointAnchor',
    weapon: 'authoredRubyLeftPrismAnchor',
  });
  expect(result.eye.x).toBeCloseTo(0, 4);
  expect(result.eye.y).toBeCloseTo(3.78 * result.expectedScale, 4);
  expect(result.eye.z).toBeCloseTo(2.18 * result.expectedScale, 4);
  expect(result.weakPoint.x).toBeCloseTo(0, 4);
  expect(result.weakPoint.y).toBeCloseTo(3.74 * result.expectedScale, 4);
  expect(result.weakPoint.z).toBeCloseTo(-2.03 * result.expectedScale, 4);
  expect(result.weapon.x).toBeCloseTo(3.5 * result.expectedScale, 4);
  expect(result.weapon.y).toBeCloseTo(3.48 * result.expectedScale, 4);
  expect(result.weapon.z).toBeCloseTo(2.35 * result.expectedScale, 4);
  expect(result.muzzle).toEqual(result.weapon);
  expect(result.shutterCount).toBe(8);
  expect(result.shutterPartCounts).toEqual(Array(8).fill(3));
  expect(result.irisCount).toBe(3);
  expect(result.oracleArrayPivotCount).toBe(1);
  expect(result.oracleArrayPartCount).toBe(11);
  expect(result.shutterCenterDrift).toBeLessThan(0.0001);
  expect(result.arrayCenterDrift).toBeLessThan(0.0001);
  expect(result.materialState).toMatchObject({
    eyeArrayDistinct: true,
    eyeUnscopedDistinct: true,
    arrayUnscopedDistinct: true,
  });
  expect(result.materialState.eyeIntensity).toBeGreaterThan(result.materialState.arrayIntensity);
  expect(result.materialState.unscopedIntensityAfter)
    .toBeCloseTo(result.materialState.unscopedIntensityBefore, 5);
  expect(result.ownedTextureCount).toBe(12);
  expect(result.textureDisposeCount).toBe(1);
  expect(result.ownedTexturesCleared).toBe(true);
  expect(result.authoredRootRemoved).toBe(true);
});
