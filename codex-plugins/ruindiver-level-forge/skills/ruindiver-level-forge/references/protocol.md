# Level Forge JSON-RPC protocol

## Launcher

Run commands through:

```powershell
node <skill-directory>\scripts\level-forge.mjs rpc '<json-rpc-request>'
```

For large documents, pass `--request-file <absolute-json-path>`. JSON is written to stdout; progress and diagnostics go to stderr. A nonzero exit status means the requested operation was not committed.

The launcher forwards to `<repository>\scripts\level-forge-cli.mjs`. Use `health` before reusing a server and `serve --open` to start a verified fixed-origin server and browser session.

## Schemas

- Prompt: `ruindivex-level-forge-spec/v1`
- Session: `ruindivex-level-forge-session/v1`
- Editor project: `ruindivex-level-editor-project/v1`
- Validation receipt: `ruindivex-level-forge-validation-receipt/v1`
- JSON-RPC: `2.0`; every request has a unique string `id`.

The normalized prompt supports `prompt`, `seed`, `theme`, `roomCount`, `requirements.hard`, `requirements.soft`, and allowlisted topology/gameplay/asset constraints. Treat explicitly required counts, named mechanics, topology, and assets as hard unless the user labels them optional.

## Methods

- `session.start`: create an owned revisioned session and one-time browser ticket.
- `session.attach`: wait for or inspect a project explicitly shared from the Forge.
- `session.inspect`: return the canonical project, assets, current revision, ownership state, and diagnostics.
- `session.status`: return paused/manual state, browser attachment, pending command, expiry, and last receipt.
- `catalog.get`: return supported operation, geometry, socket, connector, entity, material, and asset kinds.
- `project.create`: normalize a prompt spec and construct the first valid candidate.
- `project.applyBatch`: atomically apply typed operations at `baseRevision` and return stable IDs.
- `project.validate`: run static and runtime-independent validation without finalizing.
- `preview.capture`: ask the attached editor for a perspective or top-down screenshot.
- `project.finalize`: serialize validation, run all gates, persist in the browser, and return a receipt.
- `project.open`: focus the finalized `?project=<projectId>` URL and detach agent ownership.

## Typed operations

Only use `room`, `primitive`, `socket`, `connection`, `entity`, and `material` add/update/remove operations, plus `asset.add` and `asset.remove`. Updates contain an allowlisted `changes` object; removes contain the stable target ID. The control plane rejects unknown operations, arbitrary patches, functions, scripts, non-JSON numbers, duplicate IDs, missing references, and stale `baseRevision` values. Never retry a stale batch unchanged.

## Browser synchronization

The fixed origin is `http://127.0.0.1:5174`. A new session URL carries a 256-bit one-time `levelForgeTicket` in its fragment. The editor exchanges it for an HttpOnly, SameSite session cookie and removes the fragment. Never copy the ticket into query parameters, logs, screenshots, project JSON, or chat output.

The editor polls for one command at a time. Acknowledgement records its result and revision. Any manual user commit pauses the session, advances the revision, and invalidates pending agent writes. Resume only after `session.inspect` and validation of the new revision.

## Error handling

- `PROMPT_UNSATISFIABLE`: clarify one hard constraint or stop.
- `REVISION_CONFLICT`: inspect, validate, and resume from the user's revision.
- `VALIDATION_FAILED`: repair using diagnostic codes within the bounded budget.
- `BROWSER_NOT_ATTACHED`: reopen/focus the session URL; do not bypass browser-required gates.
- `ASSET_INVALID`: fix or replace the asset through normal import.
- `FINALIZATION_INCOMPLETE`: one or more gates did not produce a passing receipt.

Generation is bounded to four layout variants and eight diagnostic-driven repair passes. Track canonical candidate hashes and stop if a hash repeats.
