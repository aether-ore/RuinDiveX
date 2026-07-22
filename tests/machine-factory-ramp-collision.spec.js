import { expect, test } from '@playwright/test';

test('machine press collision follows its visible legs and leaves access ramps clear', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&dungeonSeed=connector-c');
  await page.waitForFunction(() => Boolean(window.game?.dungeonController));

  const result = await page.evaluate(async () => {
    window.game.stop();
    const { DungeonGenerator } = await import('/src/DungeonGenerator.js');

    // This layout previously routed the machine-room access ramp through the
    // empty opening beneath two presses. Their old monolithic collision boxes
    // projected the overhead housing down to the floor and blocked the ramp.
    let state = 2;
    const random = () => (
      (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296
    );
    const dungeon = new DungeonGenerator({ random }).generate();
    const controller = window.game.dungeonController;
    const room = dungeon.rooms.find((entry) => entry.id === 'machineFactoryRoom');
    const pressZones = dungeon.solidZones.filter((zone) => (
      zone.roomId === room.id && zone.id.startsWith('machinePress_')
    ));
    const rampTiles = dungeon.floorTiles.filter((tile) => (
      tile.roomId === room.id && tile.surface === 'industrialRamp'
    ));

    const originalSolidZones = controller.solidZones;
    controller.solidZones = pressZones;

    const blockedRampPassageSamples = [];
    for (const tile of rampTiles) {
      const directionX = Math.sign(tile.rampDirectionX ?? 0);
      const directionZ = Math.sign(tile.rampDirectionZ ?? 0);
      const perpendicularX = -directionZ;
      const perpendicularZ = directionX;
      for (const localProgress of [-0.45, 0, 0.45]) {
        for (const lateralOffset of [-0.3, 0, 0.3]) {
          const progress = Math.max(0, Math.min(1, localProgress + 0.5));
          const position = window.game.player.root.position.clone().set(
            (tile.x + directionX * localProgress + perpendicularX * lateralOffset)
              * dungeon.tileSize,
            (tile.rampStartElevation ?? tile.elevation ?? 0)
              + ((tile.rampEndElevation ?? tile.elevation ?? 0)
                - (tile.rampStartElevation ?? tile.elevation ?? 0)) * progress,
            (tile.z + directionZ * localProgress + perpendicularZ * lateralOffset)
              * dungeon.tileSize,
          );
          if (controller._isPositionInsideSolidZone(position)) {
            blockedRampPassageSamples.push({
              x: position.x,
              y: position.y,
              z: position.z,
              tileX: tile.x,
              tileZ: tile.z,
              lateralOffset,
            });
          }
        }
      }
    }

    const legCentersBlocked = pressZones.every((zone) => {
      const position = zone.position.clone();
      position.y = 0.05;
      return controller._isPositionInsideSolidZone(position);
    });

    const zonesByPress = new Map();
    for (const zone of pressZones) {
      const pressId = zone.id.replace(/_(left|right)Leg$/, '');
      const zones = zonesByPress.get(pressId) ?? [];
      zones.push(zone);
      zonesByPress.set(pressId, zones);
    }
    const openingsClear = [...zonesByPress.values()].every((zones) => {
      if (zones.length !== 2) {
        return false;
      }
      const opening = zones[0].position.clone().add(zones[1].position).multiplyScalar(0.5);
      opening.y = 0.05;
      return !controller._isPositionInsideSolidZone(opening);
    });

    controller.solidZones = originalSolidZones;

    return {
      rampTileCount: rampTiles.length,
      blockedRampPassageSamples,
      legCentersBlocked,
      openingsClear,
      pressZones: pressZones.map((zone) => ({
        id: zone.id,
        halfWidth: zone.halfWidth,
        halfDepth: zone.halfDepth,
        centerY: zone.position.y,
        verticalHalfHeight: zone.verticalHalfHeight,
      })),
    };
  });

  expect(result.rampTileCount).toBeGreaterThan(0);
  expect(result.blockedRampPassageSamples).toEqual([]);
  expect(result.pressZones).toHaveLength(6);
  expect(result.pressZones.every((zone) => (
    /_(left|right)Leg$/.test(zone.id)
    && Math.abs(zone.halfWidth - 0.14) < 0.001
    && Math.abs(zone.halfDepth - 0.21) < 0.001
    && Math.abs(zone.centerY - 0.725) < 0.001
    && Math.abs(zone.verticalHalfHeight - 0.725) < 0.001
  ))).toBe(true);
  expect(result.legCentersBlocked).toBe(true);
  expect(result.openingsClear).toBe(true);
});
