---
name: ruindiver-level-forge
description: Generate, modify, visually inspect, validate, and open fully editable RuinDiver Level Forge room or dungeon projects from natural-language prompts. Use for creating new RuinDiver maps, changing existing Forge projects with user consent, adding allowlisted gameplay or generated textures, repairing validation failures, or preparing a playable dungeon in the Three.js editor.
---

# RuinDiver Level Forge

Create or modify RuinDiver dungeons through the repository's revision-safe Level Forge JSON-RPC control plane. A successful run must leave a validated project saved in the Forge's IndexedDB and open in the user's default browser. Never substitute an off-prompt layout for an unsupported or contradictory hard requirement.

## Required setup

Read [references/protocol.md](references/protocol.md) completely before issuing commands. Resolve the repository in this order:

1. `RUINDIVER_LEVEL_FORGE_ROOT`, when set.
2. The current workspace, when it contains `level-editor.html` and `scripts/level-forge-cli.mjs`.
3. `C:\Users\K\Documents\New Three.js Practice` for this personal installation.

Use `scripts/level-forge.mjs` from this skill as the thin CLI launcher. Do not construct session files directly and do not edit IndexedDB outside the browser API.

## Fixed workflow

1. Parse the request into `ruindivex-level-forge-spec/v1`. Separate hard requirements from soft art direction. Use only catalog-supported rooms, geometry, sockets, connectors, gameplay, materials, and assets.
2. Reject contradictions and unsupported hard requirements with `PROMPT_UNSATISFIABLE`. Ask one focused clarification only when one answer can make the prompt satisfiable. Never silently weaken a hard requirement.
3. Start or attach to the verified fixed-origin Forge server. Starting a new session must open the default browser immediately. For an existing project, require the user to select **Share with Codex** in the Forge before reading or changing it.
4. Create a deterministic project, then apply typed batches with the current `baseRevision`. Each batch should be a coherent visual change and becomes one editor undo step. Never send JSON Patch, JavaScript, callbacks, or evaluation strings.
5. After every batch, inspect the returned revision and diagnostics. Capture both perspective and top-down previews of the real editor. Check room shells, connector seams, spawn/extraction, objective readability, collisions, and visual intent. Apply diagnostic-driven repairs only; stop on a repeated candidate hash.
6. If the user makes a manual edit, the session pauses and stale writes must fail with `REVISION_CONFLICT`. Inspect the new project and validation state, adopt its new revision, and resume without merging or overwriting the user's edit.
7. Generate texture images only when the prompt requests them. Use the `imagegen` skill, require PNG or WebP decode success, import them through the normal content-addressed asset command, and reference the returned SHA-256 asset ID. Models must be supplied locally as uncompressed `.glb` or complete multi-file `.gltf`; never invent a missing model.
8. Finalize only after every gate in the validation receipt passes. If a hard texture requirement cannot be generated or decoded, or any repair budget is exhausted, ask for direction or return the structured failure. Never call `project.open` for invalid output.
9. On success, call `project.finalize`, then `project.open`. Confirm the returned project ID, hashes, revision, and gate receipt. Leave the server running, editing enabled, and the completed map focused in the default browser.

## Validity rules

- Unspecified requests default to a grounded five-room Industrial dungeon with start, encounter/traversal spaces, objective, and extraction.
- Lifts, slopes, gates, credentials, puzzles, and unusual traversal are included only when requested.
- A finished run must pass prompt/schema safety, project/module/registry/reference/asset validation, canonical hash verification, strict authored-dungeon assembly and disposal, physical traversal, stateful progression, and the real-Game iframe smoke check.
- Generated-content warnings are blockers. Missing spawn, extraction, support, headroom, traversal lanes, connector compatibility, assets, or solvable progression are errors.
- Do not use the registry generator's permissive fallback as proof of validity.
- Do not claim completion from a CLI exit code alone. Require a `ruindivex-level-forge-validation-receipt/v1` whose `ok` is true and whose required gates all passed.

## Visual review

Prefer the installed browser-control skill to inspect and focus the real Forge page. The CLI `preview.capture` method is the automation fallback. Review at least one perspective and one top-down capture after the final structural batch, and another capture after any repair that changes topology. Do not treat a synthetically rendered diagram as a Forge preview.

## Completion response

Report the project name and ID, final revision, room and connection counts, canonical dungeon hash, prompt-spec hash, and that the editor remains open and editable. If unsuccessful, report the precise blocking diagnostic and do not say that a dungeon was generated.
