# RuinDivex Room and Dungeon Authoring Studio

Open `http://localhost:5174/level-editor.html` after running `npm run dev`.

The editor keeps drafts and content-addressed binary assets in IndexedDB. Room mode authors reusable `ruindivex-room-module/v1` definitions; Dungeon mode places room instances, links compatible sockets, and authors progression. The file menu exports project drafts, canonical room or authored-dungeon JSON, pure-data ES modules, and portable ZIP bundles.

The viewport toolbar's **Snap to** selector controls new palette and model placement. Grid uses the selected dungeon-grid increment, Surface rests geometry on the raycast surface, Object aligns to nearby authored face centers or corners, Sockets aligns compatible room outlets with a connector-safe buffer, and Free preserves the unrounded pointer position. The magnet button temporarily disables or restores the last snap target.

The Playtest command compiles the current project, writes a transient IndexedDB snapshot, and sends only its opaque ID to the persistent same-origin game iframe. The iframe uses the real `Game` and `DungeonController` with memory-only progression storage, then disposes the authored world and restores its dormant baseline when play ends.

Public data/runtime APIs are exported from `src/level-editor/index.js`:

- `validateRoomModule`, `validateAuthoredDungeon`, and `validateRoomRegistry`
- `compileEditorRoom` and `compileEditorProject`
- `assembleAuthoredRoom` and `assembleAuthoredDungeon`
- `AuthoredRoomRegistry.load`
- `createDungeonFacade`
- `LevelProjectStore` and the JSON/module/ZIP interchange helpers

Run the focused verification with `npm run test:level-editor`.

## Codex-controlled Level Forge

The personal `ruindiver-level-forge` Codex plugin drives the editor through the same deterministic automation kernel exposed by `src/level-editor/index.js`. It accepts natural-language requirements, generates only allowlisted project data, streams atomic revision-checked batches into the live editor, captures perspective and top-down previews, and will not finalize until strict assembly, traversal, progression, asset, browser preflight, persistence, and real-game smoke gates pass.

Start or inspect the fixed-origin control service with:

```powershell
npm run level-forge -- health
npm run level-forge -- serve --open
```

The JSON-RPC methods are `session.start`, `session.attach`, `session.inspect`, `session.status`, `catalog.get`, `project.create`, `project.applyBatch`, `project.validate`, `preview.capture`, `project.finalize`, and `project.open`. Typed operations require the current `baseRevision`; stale writes fail atomically. Manual editor commits pause Codex ownership until the revised project is inspected and explicitly resumed.

Transient control data lives under the ignored `.level-forge/` directory. Browser authorization uses a one-time URL-fragment ticket exchanged for an HttpOnly, SameSite session capability on `127.0.0.1:5174`; the server rejects non-loopback hosts, foreign origins, unsafe paths, symlinks, oversized bodies, mismatched asset hashes/MIME types, and remote glTF dependencies.

Run the focused control and generation verification with `npm run test:level-forge`. After installing or updating the personal plugin, begin a new Codex task and invoke `$ruindiver-level-forge` so the task discovers the installed skill.
