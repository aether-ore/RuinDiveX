import { test, expect } from '@playwright/test';

function objectCount(text) {
  const match = String(text).match(/\d+/);
  if (!match) throw new Error(`Could not read editor object count from: ${text}`);
  return Number(match[0]);
}

test('level editor authors a starter room, switches modes, validates, and uses the persistent playtest bridge', async ({ page }) => {
  test.setTimeout(240_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // Count only top-level window listeners. This catches bridge/Game listener
  // multiplication without treating short-lived object listeners as leaks.
  await page.addInitScript(() => {
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const listeners = new Map();
    const captureFlag = (options) => options === true || Boolean(options?.capture);
    const recordAdd = (type, listener, capture) => {
      if (!listener) return;
      let byListener = listeners.get(type);
      if (!byListener) listeners.set(type, byListener = new Map());
      let captures = byListener.get(listener);
      if (!captures) byListener.set(listener, captures = new Set());
      captures.add(capture);
    };
    const recordRemove = (type, listener, capture) => {
      const byListener = listeners.get(type);
      const captures = byListener?.get(listener);
      captures?.delete(capture);
      if (captures?.size === 0) byListener.delete(listener);
      if (byListener?.size === 0) listeners.delete(type);
    };
    EventTarget.prototype.addEventListener = function addEventListener(type, listener, options) {
      const result = originalAdd.call(this, type, listener, options);
      if (this === window) recordAdd(String(type), listener, captureFlag(options));
      return result;
    };
    EventTarget.prototype.removeEventListener = function removeEventListener(type, listener, options) {
      const result = originalRemove.call(this, type, listener, options);
      if (this === window) recordRemove(String(type), listener, captureFlag(options));
      return result;
    };
    Object.defineProperty(window, '__levelEditorListenerProbe', {
      value: () => {
        const byType = Object.fromEntries([...listeners.entries()]
          .map(([type, byListener]) => [type, [...byListener.values()].reduce((sum, captures) => sum + captures.size, 0)])
          .sort(([left], [right]) => left.localeCompare(right)));
        return { active: Object.values(byType).reduce((sum, count) => sum + count, 0), byType };
      },
    });
  });

  await page.goto('/level-editor.html');
  await expect(page.locator('#core-status')).toHaveClass(/ready/);
  await expect(page.locator('#core-status')).toContainText('Core connected');
  await expect(page.locator('#playtest-frame')).toHaveCount(1);
  await expect(page.locator('#viewport canvas')).toHaveCount(1);

  const initialProject = await page.evaluate(() => window.levelForge.project);
  expect(initialProject.schema).toBe('ruindivex-level-editor-project/v1');
  expect(initialProject.rooms.length).toBeGreaterThan(0);
  expect(initialProject.roomModules.some(({ moduleId }) => moduleId === initialProject.rooms[0].moduleId)).toBe(true);

  const snapTo = page.locator('#placement-snap-target');
  await expect(snapTo).toHaveValue('grid');
  await expect(snapTo.locator('option')).toHaveText(['Grid', 'Surface', 'Object', 'Sockets', 'Free']);
  const viewport = page.locator('#viewport');
  const viewportBox = await viewport.boundingBox();
  expect(viewportBox).toBeTruthy();
  const boxPaletteItem = page.locator('[data-palette-type="box"]');
  await expect(boxPaletteItem).toHaveCount(1);
  const placementTarget = { x: viewportBox.width * 0.63, y: viewportBox.height * 0.61 };
  const primitiveIds = () => page.evaluate(() => {
    const project = window.levelForge.project;
    const moduleId = project.rooms[0]?.moduleId;
    return (project.roomModules.find((module) => module.moduleId === moduleId)?.primitives || []).map(({ id }) => id);
  });
  const placeNewBox = async () => {
    const beforeIds = await primitiveIds();
    await boxPaletteItem.dragTo(viewport, { targetPosition: placementTarget });
    return page.evaluate((ids) => {
      const project = window.levelForge.project;
      const moduleId = project.rooms[0]?.moduleId;
      return (project.roomModules.find((module) => module.moduleId === moduleId)?.primitives || []).find(({ id }) => !ids.includes(id));
    }, beforeIds);
  };

  const gridBox = await placeNewBox();
  expect(gridBox).toBeTruthy();
  for (const coordinate of [gridBox.transform.position.x, gridBox.transform.position.z]) {
    expect(Math.abs(coordinate / 2.8 - Math.round(coordinate / 2.8))).toBeLessThan(1e-8);
  }
  expect(gridBox.transform.position.y).toBeCloseTo(0.5, 8);
  await page.locator('[data-action="undo"]').click();

  await snapTo.selectOption('free');
  await expect(page.locator('[data-action="toggle-snap"]')).toHaveAttribute('aria-pressed', 'false');
  const freeBox = await placeNewBox();
  expect(freeBox).toBeTruthy();
  expect([freeBox.transform.position.x, freeBox.transform.position.z].some((coordinate) => (
    Math.abs(coordinate / 2.8 - Math.round(coordinate / 2.8)) > 1e-4
  ))).toBe(true);
  expect(freeBox.transform.position).not.toEqual(gridBox.transform.position);
  await page.locator('[data-action="undo"]').click();

  await snapTo.selectOption('surface');
  const surfacePlacement = await page.evaluate(() => {
    const rect = document.querySelector('#viewport').getBoundingClientRect();
    return window.levelForge.resolvePlacement({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, type: 'box', target: 'surface', enabled: true });
  });
  expect(surfacePlacement.snappedTo).toBe('surface');
  expect(surfacePlacement.snappedToId).toBeTruthy();
  expect(surfacePlacement.position.y).toBeGreaterThanOrEqual(0.49);
  await snapTo.selectOption('object');
  const objectPlacement = await page.evaluate(() => {
    const rect = document.querySelector('#viewport').getBoundingClientRect();
    return window.levelForge.resolvePlacement({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, type: 'box', target: 'object', enabled: true });
  });
  expect(objectPlacement.snappedTo).toBe('object');
  expect(objectPlacement.snappedToId).toBeTruthy();
  expect(objectPlacement.position.y).toBeGreaterThanOrEqual(0.49);
  await snapTo.selectOption('grid');

  // Direct placement is the keyboard-friendly counterpart to palette drag/drop.
  const floorPaletteItem = page.locator('[data-palette-type="floor"]');
  await expect(floorPaletteItem).toHaveCount(1);
  const beforePlacement = objectCount(await page.locator('#object-count').innerText());
  await floorPaletteItem.dblclick();
  await expect(page.locator('#object-count')).toHaveText(`${beforePlacement + 1} objects`);
  await expect(page.locator('[data-action="undo"]')).toBeEnabled();

  await page.locator('[data-action="undo"]').click();
  await expect(page.locator('#object-count')).toHaveText(`${beforePlacement} objects`);
  await expect(page.locator('[data-action="redo"]')).toBeEnabled();
  await page.locator('[data-action="redo"]').click();
  await expect(page.locator('#object-count')).toHaveText(`${beforePlacement + 1} objects`);

  const selectionIds = await page.evaluate(() => {
    const project = window.levelForge.project;
    const activeModuleId = project.rooms[0]?.moduleId;
    return (project.roomModules.find(({ moduleId }) => moduleId === activeModuleId)?.primitives ?? [])
      .slice(0, 2)
      .map(({ id }) => id);
  });
  expect(selectionIds).toHaveLength(2);
  await page.locator(`[data-tree-id="${selectionIds[0]}"]`).click();
  await page.locator(`[data-tree-id="${selectionIds[1]}"]`).click({ modifiers: ['Shift'] });
  await expect(page.locator('#status-selection')).toHaveText('2 objects selected');
  const beforePaste = objectCount(await page.locator('#object-count').innerText());
  await page.keyboard.press('Control+C');
  await expect(page.locator('#toast-stack')).toContainText('Copied selection');
  await page.keyboard.press('Control+V');
  await expect(page.locator('#object-count')).toHaveText(`${beforePaste + 2} objects`);
  await expect(page.locator('#status-selection')).toHaveText('2 objects selected');
  await page.locator('[data-action="undo"]').click();
  await expect(page.locator('#object-count')).toHaveText(`${beforePaste} objects`);

  await page.locator('[data-mode="dungeon"]').click();
  await expect(page.locator('[data-mode="dungeon"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#palette-title')).toHaveText('Dungeon palette');
  await expect(page.locator('#status-scope')).toHaveText('Dungeon assembly');

  const smallRoomPaletteItem = page.locator('[data-palette-type="small-room"]');
  await expect(smallRoomPaletteItem).toHaveCount(1);
  const connectionRoomIdsBefore = await page.evaluate(() => window.levelForge.project.rooms.map(({ id }) => id));
  const connectionCountBefore = await page.evaluate(() => window.levelForge.project.connections.length);
  await smallRoomPaletteItem.dblclick();
  await expect.poll(() => page.evaluate(() => window.levelForge.project.rooms.length)).toBe(connectionRoomIdsBefore.length + 1);
  const connectionRoomIds = await page.evaluate(() => window.levelForge.project.rooms.map(({ id }) => id));

  const doorLinkTool = page.locator('[data-connection-tool="door"]');
  await doorLinkTool.click();
  await expect(doorLinkTool).toHaveClass(/active/);
  await expect(doorLinkTool).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#connection-interface')).toBeVisible();
  await expect(page.locator('#connection-interface')).toContainText('Connection setup');
  await expect(page.locator('#connection-kind')).toHaveValue('door');
  const doorConnectionState = await page.evaluate(() => window.levelForge.getConnectionState());
  expect(doorConnectionState.tool).toBe('door');
  expect(doorConnectionState.highlightedSocketIds.length).toBeGreaterThan(0);
  expect(doorConnectionState.highlightedSocketIds.every(({ type }) => type === 'door')).toBe(true);

  const highlightedDoorTarget = await page.evaluate(() => {
    const rect = document.querySelector('#viewport').getBoundingClientRect();
    return window.levelForge.getPlacementTargets().sockets.find(({ connectionPriority, screen }) => (
      connectionPriority >= 2
      && screen
      && screen.x >= rect.left + 8 && screen.x <= rect.right - 8
      && screen.y >= rect.top + 8 && screen.y <= rect.bottom - 8
    ));
  });
  expect(highlightedDoorTarget).toBeTruthy();
  await page.mouse.click(highlightedDoorTarget.screen.x, highlightedDoorTarget.screen.y);
  await expect.poll(() => page.evaluate(() => window.levelForge.getConnectionState().from)).not.toBeNull();
  await expect(page.locator('#connection-interface')).toContainText('Source socket selected');
  const pickedSource = await page.evaluate(() => window.levelForge.getConnectionState().from);
  expect(doorConnectionState.highlightedSocketIds.some(({ roomId, socketId }) => roomId === pickedSource.roomId && socketId === pickedSource.socketId)).toBe(true);
  await page.locator('[data-connection-action="cancel"]').click();
  await expect(page.locator('#connection-interface')).toBeHidden();

  await page.locator(`[data-tree-id="${connectionRoomIds[0]}"]`).click();
  await page.locator(`[data-tree-id="${connectionRoomIds.at(-1)}"]`).click({ modifiers: ['Shift'] });
  await expect(page.locator('#status-selection')).toHaveText('2 objects selected');
  await expect(page.locator('#inspector-content')).toContainText('2 connectable areas selected');
  await expect(page.locator('#connection-interface')).toBeVisible();
  await expect(page.locator('#connection-pair-select')).toBeEnabled();
  expect(await page.locator('#connection-pair-select option').count()).toBeGreaterThan(0);
  const destinationTransformBeforeAlignment = await page.evaluate((roomId) => (
    window.levelForge.project.rooms.find(({ id }) => id === roomId).transform
  ), connectionRoomIds.at(-1));
  const alignToConnectorGrid = page.locator('[data-connection-action="align"]');
  await expect(alignToConnectorGrid).toHaveText('Align both rooms to Connection Grid');
  await expect(alignToConnectorGrid).toBeEnabled();
  await alignToConnectorGrid.click();
  await expect(page.locator('.connection-status')).toContainText('Both rooms aligned');
  const destinationTransformAfterAlignment = await page.evaluate((roomId) => (
    window.levelForge.project.rooms.find(({ id }) => id === roomId).transform
  ), connectionRoomIds.at(-1));
  expect(destinationTransformAfterAlignment).not.toEqual(destinationTransformBeforeAlignment);
  expect(destinationTransformAfterAlignment.rotationY / (Math.PI / 2)).toBeCloseTo(Math.round(destinationTransformAfterAlignment.rotationY / (Math.PI / 2)), 6);
  await expect.poll(() => page.evaluate(() => window.levelForge.getConnectionState().candidates.length)).toBeGreaterThan(0);
  await page.locator('#connection-bidirectional').uncheck();
  await page.locator('[data-connection-action="create"]').click();
  await expect.poll(() => page.evaluate(() => window.levelForge.project.connections.length)).toBe(connectionCountBefore + 1);
  const composedConnection = await page.evaluate(() => window.levelForge.project.connections.at(-1));
  expect(composedConnection.kind).toBe('door');
  expect(composedConnection.bidirectional).toBe(false);
  expect(new Set([composedConnection.from.roomId, composedConnection.to.roomId])).toEqual(new Set([connectionRoomIds[0], connectionRoomIds.at(-1)]));
  expect(composedConnection.properties.route.waypoints.length).toBeGreaterThan(0);
  await page.locator('[data-action="undo"]').click();
  await expect.poll(() => page.evaluate(() => window.levelForge.project.connections.length)).toBe(connectionCountBefore);
  await page.locator('[data-action="undo"]').click();
  await page.locator('[data-action="undo"]').click();
  await expect.poll(() => page.evaluate(() => window.levelForge.project.rooms.length)).toBe(connectionRoomIdsBefore.length);

  await snapTo.selectOption('socket');
  const socketTarget = await page.evaluate(() => {
    const rect = document.querySelector('#viewport').getBoundingClientRect();
    return window.levelForge.getPlacementTargets().sockets.find(({ screen }) => (
      screen.x >= rect.left + 8 && screen.x <= rect.right - 8
      && screen.y >= rect.top + 8 && screen.y <= rect.bottom - 8
    ));
  });
  expect(socketTarget).toBeTruthy();
  const dungeonViewportBox = await viewport.boundingBox();
  const roomIdsBeforeSocketPlacement = await page.evaluate(() => window.levelForge.project.rooms.map(({ id }) => id));
  const connectionCountBeforeSocketPlacement = await page.evaluate(() => window.levelForge.project.connections.length);
  await smallRoomPaletteItem.dragTo(viewport, {
    targetPosition: {
      x: socketTarget.screen.x - dungeonViewportBox.x,
      y: socketTarget.screen.y - dungeonViewportBox.y,
    },
  });
  const snappedRoom = await page.evaluate(({ beforeIds, target }) => {
    const project = window.levelForge.project;
    const room = project.rooms.find(({ id }) => !beforeIds.includes(id));
    const module = project.roomModules.find(({ moduleId }) => moduleId === room?.moduleId);
    const cosine = Math.cos(room.transform.rotationY);
    const sine = Math.sin(room.transform.rotationY);
    const sockets = (module?.sockets || []).map((socket) => {
      const local = socket.position;
      const facing = socket.facing;
      return {
        position: {
          x: room.transform.position.x + local.x * cosine + local.z * sine,
          y: room.transform.position.y + local.y,
          z: room.transform.position.z - local.x * sine + local.z * cosine,
        },
        facing: {
          x: facing.x * cosine + facing.z * sine,
          y: facing.y,
          z: -facing.x * sine + facing.z * cosine,
        },
      };
    });
    const source = sockets.map((socket) => ({
      ...socket,
      distance: Math.hypot(socket.position.x - target.position.x, socket.position.y - target.position.y, socket.position.z - target.position.z),
    })).sort((left, right) => left.distance - right.distance)[0];
    const delta = {
      x: source.position.x - target.position.x,
      y: source.position.y - target.position.y,
      z: source.position.z - target.position.z,
    };
    return {
      room,
      source,
      delta,
      facingDot: source.facing.x * target.facing.x + source.facing.y * target.facing.y + source.facing.z * target.facing.z,
      lateralError: Math.abs(delta.x * target.facing.z - delta.z * target.facing.x),
      connectionCount: project.connections.length,
    };
  }, { beforeIds: roomIdsBeforeSocketPlacement, target: socketTarget });
  expect(snappedRoom.room).toBeTruthy();
  for (const coordinate of Object.values(snappedRoom.room.transform.position)) {
    expect(Math.abs(coordinate / 0.05 - Math.round(coordinate / 0.05))).toBeLessThan(1e-7);
  }
  expect(Math.abs(snappedRoom.room.transform.rotationY / (Math.PI / 2) - Math.round(snappedRoom.room.transform.rotationY / (Math.PI / 2)))).toBeLessThan(1e-7);
  expect(snappedRoom.source.distance).toBeCloseTo(5.6, 5);
  expect(snappedRoom.facingDot).toBeCloseTo(-1, 5);
  expect(snappedRoom.lateralError).toBeLessThan(1e-6);
  expect(snappedRoom.connectionCount).toBe(connectionCountBeforeSocketPlacement);
  await page.locator('[data-action="undo"]').click();
  await expect.poll(() => page.evaluate(() => window.levelForge.project.rooms.length)).toBe(roomIdsBeforeSocketPlacement.length);
  await snapTo.selectOption('grid');

  await page.locator('[data-action="validate"]').click();
  await expect(page.locator('#validation-subtitle')).not.toContainText('Resolve before runtime compile');

  await page.locator('[data-mode="room"]').click();
  const projectBeforePlay = await page.evaluate(() => window.levelForge.project);
  if (!projectBeforePlay.entities.some(({ type, kind }) => ['player-spawn', 'dungeon-start'].includes(type ?? kind))) {
    const spawnPaletteItem = page.locator('[data-palette-type="player-spawn"]');
    await expect(spawnPaletteItem).toHaveCount(1);
    await spawnPaletteItem.dblclick();
  }

  const playtestFrame = page.frameLocator('#playtest-frame');
  await expect(playtestFrame.locator('html')).toHaveAttribute('data-editor-playtest-host', 'ready', { timeout: 60_000 });
  await expect(playtestFrame.locator('#game-container canvas')).toHaveCount(1);

  const frameBody = playtestFrame.locator('body');
  await expect.poll(() => frameBody.evaluate(() => Boolean(window.game && window.levelEditorPlaytestHost))).toBe(true);
  const persistentBaseline = await frameBody.evaluate(() => {
    const game = window.game;
    window.__levelEditorPersistentRefs = {
      game,
      renderer: game.renderer,
      canvas: game.renderer.domElement,
      scene: game.scene,
      player: game.player,
    };
    return {
      memory: { ...game.renderer.info.memory },
      listeners: window.__levelEditorListenerProbe(),
      canvases: document.querySelectorAll('#game-container canvas').length,
    };
  });
  const outerListenerBaseline = await page.evaluate(() => window.__levelEditorListenerProbe());
  const readOuterStorage = () => page.evaluate(() => ({
    local: Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)])),
    session: Object.fromEntries(Object.keys(sessionStorage).sort().map((key) => [key, sessionStorage.getItem(key)])),
  }));
  const readFrameStorage = () => frameBody.evaluate(() => ({
    local: Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)])),
    session: Object.fromEntries(Object.keys(sessionStorage).sort().map((key) => [key, sessionStorage.getItem(key)])),
  }));
  const transientSnapshotCount = () => page.evaluate(async () => {
    const store = new window.levelForge.core.LevelProjectStore();
    try { return (await store.listPlaytestSnapshots()).length; }
    finally { store.close(); }
  });

  expect(persistentBaseline.canvases).toBe(1);
  const activeMemorySamples = [];
  const stoppedMemorySamples = [];
  for (let cycle = 0; cycle < 5; cycle += 1) {
    // Exercise an edit and undo before every Play command while keeping the
    // compiled candidate identical, so renderer-memory plateau is meaningful.
    const beforeCycleEdit = objectCount(await page.locator('#object-count').innerText());
    await floorPaletteItem.dblclick();
    await expect(page.locator('#object-count')).toHaveText(`${beforeCycleEdit + 1} objects`);
    await page.locator('[data-action="undo"]').click();
    await expect(page.locator('#object-count')).toHaveText(`${beforeCycleEdit} objects`);
    await page.evaluate(() => window.levelForge.save());

    const outerStorageBeforePlay = await readOuterStorage();
    const frameStorageBeforePlay = await readFrameStorage();
    expect(await transientSnapshotCount()).toBe(0);

    await page.locator('[data-action="playtest"]').click();
    await expect(page.locator('#editor-shell')).toHaveClass(/playtesting/);
    await expect(page.locator('#playtest-status')).toContainText('Runtime active', { timeout: 45_000 });
    await expect(page.locator('#playtest-frame')).toHaveCount(1);
    await expect(playtestFrame.locator('#game-container canvas')).toHaveCount(1);
    await expect.poll(() => frameBody.evaluate(() => Boolean(window.game.player?._loadedModel)), {
      timeout: 30_000,
    }).toBe(true);
    await frameBody.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect.poll(() => frameBody.evaluate(() => window.game.renderer.info.memory.geometries), {
      timeout: 15_000,
      message: 'the authored playtest scene should complete a render before its GPU memory is sampled',
    }).toBeGreaterThan(persistentBaseline.memory.geometries);

    const activeHost = await frameBody.evaluate(() => {
      const refs = window.__levelEditorPersistentRefs;
      const state = window.levelEditorPlaytestHost.getState();
      return {
        installed: Boolean(window.levelEditorPlaytestHost),
        snapshotId: state.snapshotId,
        active: state.game.active,
        canvases: document.querySelectorAll('#game-container canvas').length,
        sameGame: window.game === refs.game,
        sameRenderer: window.game.renderer === refs.renderer,
        sameCanvas: window.game.renderer.domElement === refs.canvas,
        sceneSwapped: window.game.scene !== refs.scene,
        memory: { ...window.game.renderer.info.memory },
      };
    });
    expect(activeHost.installed).toBe(true);
    expect(activeHost.snapshotId).toMatch(/^[a-zA-Z0-9-]+$/);
    expect(activeHost.active).toBe(true);
    expect(activeHost.canvases).toBe(1);
    expect(activeHost.sameGame).toBe(true);
    expect(activeHost.sameRenderer).toBe(true);
    expect(activeHost.sameCanvas).toBe(true);
    expect(activeHost.sceneSwapped).toBe(true);
    activeMemorySamples.push(activeHost.memory);

    if (cycle === 0) {
      const movementStart = await frameBody.evaluate(() => {
        const game = window.game;
        game.setDebugNoClipEnabled(false);
        game.keys.delete('KeyW');
        const position = game.player.root.position;
        window.__levelEditorGroundedMovementStart = position.clone();
        return {
          debugNoClipEnabled: Boolean(game.debugNoClipEnabled),
          playerNoClipEnabled: Boolean(game.player.noClipEnabled),
          position: { x: position.x, y: position.y, z: position.z },
          supportY: game.getPlatformFloorElevation(position),
        };
      });
      expect(movementStart.debugNoClipEnabled).toBe(false);
      expect(movementStart.playerNoClipEnabled).toBe(false);
      expect(movementStart.supportY).not.toBeNull();

      await frameBody.evaluate(() => window.game.keys.add('KeyW'));
      try {
        await expect.poll(() => frameBody.evaluate(() => {
          const start = window.__levelEditorGroundedMovementStart;
          const current = window.game.player.root.position;
          return Math.hypot(current.x - start.x, current.z - start.z);
        }), { timeout: 6_000 }).toBeGreaterThan(0.25);
      } finally {
        await frameBody.evaluate(() => window.game.keys.delete('KeyW'));
      }

      const movementEnd = await frameBody.evaluate(() => {
        const start = window.__levelEditorGroundedMovementStart;
        const current = window.game.player.root.position;
        const supportY = window.game.getPlatformFloorElevation(current);
        delete window.__levelEditorGroundedMovementStart;
        return {
          distance: Math.hypot(current.x - start.x, current.z - start.z),
          y: current.y,
          supportY,
        };
      });
      expect(movementEnd.distance).toBeGreaterThan(0.25);
      expect(movementEnd.supportY).not.toBeNull();
      expect(movementEnd.y).toBeCloseTo(movementEnd.supportY, 2);
    }

    await page.locator('[data-action="stop-playtest"]').click();
    await expect(page.locator('#editor-shell')).not.toHaveClass(/playtesting/);
    await expect(page.locator('#playtest-chrome')).toBeHidden();
    await expect.poll(() => transientSnapshotCount()).toBe(0);
    await expect.poll(() => frameBody.evaluate(() => window.game.renderer.info.memory.geometries))
      .toBe(persistentBaseline.memory.geometries);
    const stoppedMemory = await frameBody.evaluate(() => ({ ...window.game.renderer.info.memory }));
    stoppedMemorySamples.push(stoppedMemory);

    const stoppedHost = await frameBody.evaluate(() => {
      const refs = window.__levelEditorPersistentRefs;
      const state = window.levelEditorPlaytestHost.getState();
      return {
        snapshotId: state.snapshotId,
        active: state.game.active,
        canvases: document.querySelectorAll('#game-container canvas').length,
        sameGame: window.game === refs.game,
        sameRenderer: window.game.renderer === refs.renderer,
        sameCanvas: window.game.renderer.domElement === refs.canvas,
        restoredScene: window.game.scene === refs.scene,
        restoredPlayer: window.game.player === refs.player,
        listeners: window.__levelEditorListenerProbe(),
      };
    });
    expect(stoppedHost).toEqual({
      snapshotId: null,
      active: false,
      canvases: 1,
      sameGame: true,
      sameRenderer: true,
      sameCanvas: true,
      restoredScene: true,
      restoredPlayer: true,
      listeners: persistentBaseline.listeners,
    });
    expect(await page.evaluate(() => window.__levelEditorListenerProbe())).toEqual(outerListenerBaseline);
    expect(await readOuterStorage()).toEqual(outerStorageBeforePlay);
    expect(await readFrameStorage()).toEqual(frameStorageBeforePlay);
    await expect(page.locator('#playtest-frame')).toHaveCount(1);
  }
  // The first real frames may lazily upload persistent host resources. By the
  // third cycle both active and stopped counts must have reached a plateau.
  expect(
    new Set(activeMemorySamples.slice(2).map(({ geometries }) => geometries)).size,
    `active renderer memory: ${JSON.stringify(activeMemorySamples)}`,
  ).toBe(1);
  expect(
    new Set(stoppedMemorySamples.slice(2).map(({ geometries }) => geometries)).size,
    `stopped renderer memory: ${JSON.stringify(stoppedMemorySamples)}`,
  ).toBe(1);
  expect(
    new Set(activeMemorySamples.slice(2).map(({ textures }) => textures)).size,
    `active renderer memory: ${JSON.stringify(activeMemorySamples)}`,
  ).toBe(1);
  expect(
    new Set(stoppedMemorySamples.slice(2).map(({ textures }) => textures)).size,
    `stopped renderer memory: ${JSON.stringify(stoppedMemorySamples)}`,
  ).toBe(1);
  expect(pageErrors).toEqual([]);
});

test('Level Forge exposes atomic typed JSON-RPC editing with revision and stable-id protection', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/level-editor.html');
  await expect.poll(() => page.evaluate(() => Boolean(window.levelForge?.ready))).toBe(true);
  await page.evaluate(() => window.levelForge.ready);

  const preflight = await page.evaluate(() => window.levelForge.preflight());
  expect(preflight.signature).toBe('ruindivex-level-forge-browser/v1');
  expect(preflight.capabilities.atomicUndo).toBe(true);
  expect(preflight.capabilities.arbitraryPatch).toBe(false);
  expect(preflight.capabilities.typedOperations).toContain('entity.add');
  expect(preflight.probes.core).toBe(true);
  expect(preflight.probes.runtime).toBe(true);

  const entityId = 'codex_entity_stable_001';
  const batch = await page.evaluate(async ({ baseRevision, entityId }) => {
    const roomId = window.levelForge.project.rooms[0].id;
    return window.levelForge.execute({
      jsonrpc: '2.0',
      id: 'batch-1',
      method: 'levelForge.applyOperations',
      params: {
        baseRevision,
        label: 'Codex adds a marker',
        operations: [{
          type: 'entity.add',
          entity: {
            id: entityId,
            kind: 'marker',
            type: 'objective',
            name: 'Codex objective',
            roomId,
            transform: { position: { x: 1, y: 0, z: 1 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 } },
            properties: { enabled: true },
          },
        }],
      },
    });
  }, { baseRevision: preflight.revision, entityId });
  expect(batch.error).toBeUndefined();
  expect(batch.result.operationCount).toBe(1);
  expect(batch.result.revision).toBe(preflight.revision + 1);
  await expect(page.locator(`[data-tree-id="${entityId}"]`)).toHaveCount(1);

  const stale = await page.evaluate((baseRevision) => window.levelForge.execute({
    jsonrpc: '2.0', id: 'stale', method: 'levelForge.entity.remove', params: { baseRevision, id: 'codex_entity_stable_001' },
  }), preflight.revision);
  expect(stale.error.code).toBe(-32009);
  expect(stale.error.data.kind).toBe('REVISION_CONFLICT');
  await expect(page.locator(`[data-tree-id="${entityId}"]`)).toHaveCount(1);

  const unsafe = await page.evaluate(() => window.levelForge.execute({
    jsonrpc: '2.0', id: 'unsafe', method: 'project.patch', params: { patch: [{ op: 'replace', path: '/name', value: 'Nope' }] },
  }));
  expect(unsafe.error.code).toBe(-32601);

  await page.locator('[data-action="undo"]').click();
  await expect(page.locator(`[data-tree-id="${entityId}"]`)).toHaveCount(0);

  await page.locator('[data-mode="dungeon"]').click();
  const smallRoom = page.locator('[data-palette-type="small-room"]');
  await expect(smallRoom).toHaveCount(1);
  for (let index = 0; index < 5; index += 1) await smallRoom.dblclick();
  await expect.poll(() => page.evaluate(() => window.levelForge.project.rooms.length)).toBe(6);

  const gates = await page.evaluate(async () => {
    const project = window.levelForge.project;
    const projectBeforeCapture = JSON.stringify(project);
    const preview = await window.levelForge.execute({ jsonrpc: '2.0', id: 'preview', method: 'preview.capture', params: { view: 'top-down' } });
    const image = new Image();
    image.src = preview.result.dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const histogram = new Uint32Array(256);
    let samples = 0;
    let luminanceSum = 0;
    let luminanceSquaredSum = 0;
    let brightSamples = 0;
    for (let offset = 0; offset < pixels.length; offset += 32) {
      const luminance = Math.round(0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2]);
      histogram[luminance] += 1;
      luminanceSum += luminance;
      luminanceSquaredSum += luminance * luminance;
      brightSamples += Number(luminance >= 35);
      samples += 1;
    }
    const mean = luminanceSum / samples;
    const variance = Math.max(0, luminanceSquaredSum / samples - mean * mean);
    let cumulative = 0;
    let p90 = 0;
    for (let luminance = 0; luminance < histogram.length; luminance += 1) {
      cumulative += histogram[luminance];
      if (cumulative >= samples * 0.9) { p90 = luminance; break; }
    }
    const projectUnchanged = projectBeforeCapture === JSON.stringify(window.levelForge.project);
    const opened = await window.levelForge.execute({ jsonrpc: '2.0', id: 'open', method: 'project.open', params: { projectId: project.projectId, id: project.rooms[0].id } });
    const finalized = await window.levelForge.execute({ jsonrpc: '2.0', id: 'finalize', method: 'project.finalize', params: { baseRevision: window.levelForge.project.revision, playtest: false } });
    return {
      preview: { ...preview, result: { ...preview.result, dataUrl: preview.result?.dataUrl.slice(0, 30) } },
      imageStats: { mean, standardDeviation: Math.sqrt(variance), p90, brightRatio: brightSamples / samples },
      projectUnchanged,
      opened,
      finalized,
    };
  });
  expect(gates.preview.result.view).toBe('top-down');
  expect(gates.preview.result.dataUrl).toMatch(/^data:image\/png;base64,/);
  expect(gates.preview.result.framing.size.x).toBeGreaterThan(0);
  expect(gates.preview.result.framing.size.z).toBeGreaterThan(0);
  expect(gates.imageStats.mean).toBeGreaterThan(18);
  expect(gates.imageStats.standardDeviation).toBeGreaterThan(6);
  expect(gates.imageStats.p90).toBeGreaterThan(35);
  expect(gates.imageStats.brightRatio).toBeGreaterThan(0.02);
  expect(gates.projectUnchanged).toBe(true);
  expect(gates.opened.result.projectId).toBeTruthy();
  expect(gates.finalized.result).toMatchObject({ ok: true, persisted: true, playtest: { skipped: true } });
});

test('Level Forge claims one-time tickets, asks before sharing, and pauses on manual edits', async ({ page }) => {
  test.setTimeout(120_000);
  const requests = { claim: [], share: [], manual: [] };
  await page.route('**/__level-forge/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.postDataJSON?.() || null;
    if (path.endsWith('/health')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, signature: 'ruindivex-level-forge-control/v1' }) });
    if (path.endsWith('/session/claim')) {
      requests.claim.push(body);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, sessionId: 'ticket-session', status: 'active' }) });
    }
    if (path.endsWith('/session/share')) {
      requests.share.push(body);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, sessionId: 'shared-session', status: 'active' }) });
    }
    if (path.endsWith('/browser/manual')) {
      requests.manual.push(body);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'manual' }) });
    }
    if (path.endsWith('/session')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, session: { id: 'ticket-session', status: 'active' } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/level-editor.html#levelForgeTicket=dGlja2V0LTE');
  await page.evaluate(() => window.levelForge.ready);
  expect(requests.claim).toEqual([{ ticket: 'dGlja2V0LTE' }]);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
  await expect(page.locator('#codex-session-bar')).toBeVisible();
  await page.locator('[data-action="stop-sharing-codex"]').click();

  await page.locator('[data-action="share-codex"]').click();
  await expect(page.locator('#codex-share-dialog')).toBeVisible();
  expect(requests.share).toHaveLength(0);
  await page.locator('#codex-consent').check();
  await page.locator('#codex-share-confirm').click();
  await expect.poll(() => requests.share.length).toBe(1);
  expect(requests.share[0].consent).toBe(true);
  expect(requests.share[0].project.projectId).toBeTruthy();
  expect(requests.share[0].assets).toEqual([]);

  const name = page.locator('#project-name');
  await name.fill('Protected manual edit');
  await name.blur();
  await expect(page.locator('#codex-session-bar')).toHaveClass(/paused/);
  await expect.poll(() => requests.manual.length).toBeGreaterThan(0);
  expect(requests.manual.at(-1).project.name).toBe('Protected manual edit');
  expect(requests.manual.at(-1).revision).toBeGreaterThan(requests.manual.at(-1).baseRevision);
});

test('Align repairs an off-grid source and destination atomically', async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/level-editor.html');
  await expect.poll(() => page.evaluate(() => Boolean(window.levelForge?.project))).toBe(true);
  await page.locator('[data-mode="dungeon"]').click();
  await page.locator('[data-palette-type="small-room"]').dblclick();
  await expect.poll(() => page.evaluate(() => window.levelForge.project.rooms.length)).toBe(2);

  const [sourceRoomId, destinationRoomId] = await page.evaluate(() => [
    window.levelForge.project.rooms[0].id,
    window.levelForge.project.rooms.at(-1).id,
  ]);
  const socketDefinitionsBefore = await page.evaluate((roomIds) => {
    const project = window.levelForge.project;
    return roomIds.map((roomId) => {
      const room = project.rooms.find(({ id }) => id === roomId);
      const module = project.roomModules.find(({ moduleId }) => moduleId === room.moduleId);
      return structuredClone(room.sockets ?? module.sockets);
    });
  }, [sourceRoomId, destinationRoomId]);
  expect(socketDefinitionsBefore.flat().every((socket) => (
    (socket.transform?.position ?? socket.position).y === 0
    && socket.properties?.positionAnchor === 'threshold-floor'
  ))).toBe(true);

  await page.locator(`[data-tree-id="${sourceRoomId}"]`).click();
  const editTransform = async (selector, value) => {
    const input = page.locator(selector);
    await input.fill(String(value));
    await input.press('Tab');
  };
  await editTransform('[data-vector="transform.position"][data-axis="x"]', 0.37);
  await editTransform('[data-vector="transform.position"][data-axis="z"]', -0.22);
  await editTransform('[data-rotation-y]', 17);
  await expect.poll(() => page.evaluate((roomId) => {
    const transform = window.levelForge.project.rooms.find(({ id }) => id === roomId).transform;
    return [transform.position.x, transform.position.z, Number((transform.rotationY * 180 / Math.PI).toFixed(3))];
  }, sourceRoomId)).toEqual([0.37, -0.22, 17]);

  const transformsBeforeAlignment = await page.evaluate((roomIds) => roomIds.map((roomId) => (
    structuredClone(window.levelForge.project.rooms.find(({ id }) => id === roomId).transform)
  )), [sourceRoomId, destinationRoomId]);
  await page.locator(`[data-tree-id="${sourceRoomId}"]`).click();
  await page.locator(`[data-tree-id="${destinationRoomId}"]`).click({ modifiers: ['Shift'] });
  await expect(page.locator('#connection-interface')).toBeVisible();
  await expect(page.locator('#connection-pair-select')).toBeDisabled();
  await expect(page.locator('[data-connection-action="create"]')).toBeDisabled();
  const alignButton = page.locator('[data-connection-action="align"]');
  await expect(alignButton).toBeEnabled();
  await expect(page.locator('.connection-status')).toContainText('adjusted automatically');

  await alignButton.click();
  await expect(page.locator('.connection-status')).toContainText('Both rooms aligned');
  await expect(page.locator('#connection-pair-select')).toBeEnabled();
  await expect(page.locator('[data-connection-action="create"]')).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.levelForge.getConnectionState().candidates.length)).toBeGreaterThan(0);

  const transformsAfterAlignment = await page.evaluate((roomIds) => roomIds.map((roomId) => (
    structuredClone(window.levelForge.project.rooms.find(({ id }) => id === roomId).transform)
  )), [sourceRoomId, destinationRoomId]);
  expect(transformsAfterAlignment[0]).not.toEqual(transformsBeforeAlignment[0]);
  expect(transformsAfterAlignment[1]).not.toEqual(transformsBeforeAlignment[1]);
  for (const transform of transformsAfterAlignment) {
    expect(transform.rotationY / (Math.PI / 2)).toBeCloseTo(Math.round(transform.rotationY / (Math.PI / 2)), 6);
  }
  expect(await page.evaluate((roomIds) => {
    const project = window.levelForge.project;
    return roomIds.map((roomId) => {
      const room = project.rooms.find(({ id }) => id === roomId);
      const module = project.roomModules.find(({ moduleId }) => moduleId === room.moduleId);
      return structuredClone(room.sockets ?? module.sockets);
    });
  }, [sourceRoomId, destinationRoomId])).toEqual(socketDefinitionsBefore);

  const endpointProof = await page.evaluate(() => {
    const project = window.levelForge.project;
    const candidate = window.levelForge.getConnectionState().candidates[0];
    const resolve = (endpoint) => {
      const room = project.rooms.find(({ id }) => id === endpoint.roomId);
      const module = project.roomModules.find(({ moduleId }) => moduleId === room.moduleId);
      const socket = (room.sockets ?? module.sockets).find(({ id }) => id === endpoint.socketId);
      const transform = room.transform;
      const local = socket.transform?.position ?? socket.position;
      const facing = socket.facing ?? socket.transform?.facing ?? { x: Math.sin(socket.transform?.rotationY || 0), y: 0, z: Math.cos(socket.transform?.rotationY || 0) };
      const scale = transform.scale ?? { x: 1, y: 1, z: 1 };
      const cosine = Math.cos(transform.rotationY || 0);
      const sine = Math.sin(transform.rotationY || 0);
      const x = local.x * scale.x;
      const z = local.z * scale.z;
      return {
        position: {
          x: transform.position.x + x * cosine + z * sine,
          y: transform.position.y + local.y * scale.y,
          z: transform.position.z - x * sine + z * cosine,
        },
        facing: {
          x: facing.x * cosine + facing.z * sine,
          y: facing.y,
          z: -facing.x * sine + facing.z * cosine,
        },
      };
    };
    const from = resolve(candidate.from);
    const to = resolve(candidate.to);
    const delta = {
      x: to.position.x - from.position.x,
      y: to.position.y - from.position.y,
      z: to.position.z - from.position.z,
    };
    return {
      from,
      to,
      facingDot: from.facing.x * to.facing.x + from.facing.y * to.facing.y + from.facing.z * to.facing.z,
      elevationDelta: delta.y,
      forwardCells: (delta.x * from.facing.x + delta.z * from.facing.z) / 2.8,
      lateralCells: (delta.x * -from.facing.z + delta.z * from.facing.x) / 2.8,
    };
  });
  for (const endpoint of [endpointProof.from, endpointProof.to]) {
    for (const coordinate of Object.values(endpoint.position)) {
      expect(coordinate / 0.05).toBeCloseTo(Math.round(coordinate / 0.05), 6);
    }
    expect(endpoint.position.x / 2.8).toBeCloseTo(Math.round(endpoint.position.x / 2.8), 6);
    expect(endpoint.position.z / 2.8).toBeCloseTo(Math.round(endpoint.position.z / 2.8), 6);
    expect(Math.abs(endpoint.facing.y)).toBeLessThanOrEqual(0.05);
    expect(Math.max(Math.abs(endpoint.facing.x), Math.abs(endpoint.facing.z))).toBeCloseTo(1, 6);
  }
  expect(endpointProof.facingDot).toBeLessThanOrEqual(-0.95);
  expect(Math.min(Math.abs(endpointProof.elevationDelta), Math.abs(Math.abs(endpointProof.elevationDelta) - 14))).toBeLessThanOrEqual(0.05);
  expect(endpointProof.forwardCells).toBeGreaterThanOrEqual(4 - 1e-6);
  expect(endpointProof.forwardCells).toBeCloseTo(Math.round(endpointProof.forwardCells), 6);
  expect(endpointProof.lateralCells).toBeCloseTo(0, 6);

  const undo = page.locator('[data-action="undo"]');
  const redo = page.locator('[data-action="redo"]');
  await undo.click();
  await expect.poll(() => page.evaluate((roomIds) => roomIds.map((roomId) => (
    window.levelForge.project.rooms.find(({ id }) => id === roomId).transform
  )), [sourceRoomId, destinationRoomId])).toEqual(transformsBeforeAlignment);
  await redo.click();
  await expect.poll(() => page.evaluate((roomIds) => roomIds.map((roomId) => (
    window.levelForge.project.rooms.find(({ id }) => id === roomId).transform
  )), [sourceRoomId, destinationRoomId])).toEqual(transformsAfterAlignment);
  await expect(page.locator('[data-connection-action="create"]')).toBeEnabled();

  const connectionCountBefore = await page.evaluate(() => window.levelForge.project.connections.length);
  await page.locator('[data-connection-action="create"]').click();
  await expect.poll(() => page.evaluate(() => window.levelForge.project.connections.length)).toBe(connectionCountBefore + 1);
  await undo.click();
  await expect.poll(() => page.evaluate((roomIds) => roomIds.map((roomId) => (
    window.levelForge.project.rooms.find(({ id }) => id === roomId).transform
  )), [sourceRoomId, destinationRoomId])).toEqual(transformsAfterAlignment);
  await undo.click();
  await expect.poll(() => page.evaluate((roomIds) => roomIds.map((roomId) => (
    window.levelForge.project.rooms.find(({ id }) => id === roomId).transform
  )), [sourceRoomId, destinationRoomId])).toEqual(transformsBeforeAlignment);
  expect(pageErrors).toEqual([]);
});
