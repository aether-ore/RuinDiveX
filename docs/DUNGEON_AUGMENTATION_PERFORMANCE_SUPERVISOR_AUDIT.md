# Dungeon Augmentation Performance Supervisor Audit

Source task: `019fcb9c-30bf-7a20-8d96-cb6230e49b85`  
Checkpoint: 2026-08-04

## Executive verdict

**Blocked.** The audit removed diagnostic steering, test-discovery gaps, unbounded retained planner state, and several loading/evidence loopholes. Those changes improve the trustworthiness of investigation and failure reporting; they do not make the dungeon augmentation releasable.

The final ordinary, sink-free, post-remediation Seed001 check still ends `unchanged` after repair and reports **102,164.0475 ms planner time** and **108,059.1528 ms complete test time**, far above the unchanged 30,000 ms maximum. This is a local hot-clock diagnostic, not pinned-hardware release evidence.

The first planner result remains deterministic across the observed reruns:

- augmentation plan hash: `v1-940a43060311ce05c7379ce836972dd7`
- effective plan hash: `v1-6759df25ede7bff8d09233cc7cd4a5e4`

Stable first-pass hashes do not close the repair-parity failure or the performance gate.

## Avoidance and bloat eliminated

- **Debug steering:** production planner behavior no longer reads global debug controls or redirects `console.error`. Candidate diagnostics use an explicit typed sink. Planner short-circuit switches such as `--stop-on-success` and `--stop-after-*` are rejected, and diagnostic checkpoints that intentionally stop early exit with code 2 and an `incomplete` result instead of resembling a pass.
- **Typed, bounded diagnostics:** planner observations use schema `dungeon-augmentation-planner-diagnostic-sink/v1`, are capped at 512 records, and cannot affect correctness if an observer throws. Function-bearing sinks are stripped before browser-worker transport. Candidate and physical clocks, counters, traces, and timing accumulators are created or called only when detailed telemetry is requested. Runtime performance telemetry is also opt-in and fixed-memory; the default frame and subsystem windows hold 14,400 samples, enough for 60 seconds at 240 Hz, and the gate now checks maximum sample gap, long-task support, warm-up/duration, quality, and stable complete fixture identity.
- **Verifier discovery:** `scripts/verify-dungeon-augmentation.mjs` now discovers matching augmentation unit files from `tests/` and adds the explicit renderer/performance support files. `--list-files` currently prints **45 files**, eliminating the stale hand-maintained inventory.
- **Strict verifier CLI:** `--help` prints usage. Unknown flags, duplicate or incompatible modes, and invalid counts are rejected before a test process is spawned. In direct checks, an unknown flag and `--count=10` both failed as intended. Test execution is pinned to `--test-concurrency=1`.
- **Worker and retention safeguards:** one request-scoped browser worker carries the immutable planner input once and receives only dynamic repair patches. Realization attempts are restricted to integers 0 through 7 and must be monotonic. The transaction has one deadline and terminates on success, abort, timeout, or failure. Only complete structured-cloned salvage witnesses survive a pass, with fail-closed limits of 2,048 cache entries, 64 witnesses per entry, 4,096 witnesses total, 131,072 retained entities, and an estimated 32 MiB. Map/Set contents and full binary backing buffers count toward that budget; unsupported clone types fail closed. Prior-attempt witnesses and completed plan graphs are not retained, and cache filtering no longer spreads the full Map first.
- **Loading safeguards:** initial loading and later transitions share the same generation transaction. Owned cancellation propagates through planning, waits for cleanup, and keeps the loading UI until cleanup completes. Prepared/fallback dungeons have one-shot disposers, and abandoned transaction candidates are disposed.
- **Evidence safeguards:** `verify:release` includes the dungeon augmentation release gate. The authoritative receipt runner removes `PLAYWRIGHT_REUSE_EXISTING_SERVER`; source identity includes runtime model/texture inputs, including `.dae` and `.mtl`; runtime capture rejects incomplete or changed fixture identity and frame-sampling gaps. These are guardrails for future evidence, not a receipt from a completed release run.
- **Temporary profiling artifacts:** tracked `.codex-temp` CPU profiles, helper scripts, and screenshots were removed from the working set, and `.codex-temp/` is ignored so investigation scratch data cannot continue inflating source provenance.

## Verification performed

The following are local focused checks. Counts overlap across some historical groupings and therefore must not be added together:

- Before the second-pass diagnostics edits, the planner-scheduling, module-pruning, release-evidence, and release-gate group passed **101/101**.
- Browser planner worker safeguards passed **11/11**.
- Loading and cancellation semantics passed **6/6**.
- Current bounded runtime telemetry and evaluator tests passed **8/8**.
- Current release-evidence unit tests passed **46/46**.
- Syntax checks for the six changed diagnostics/evidence implementation and test files passed; focused `git diff --check` found no whitespace errors.
- Dynamic verifier inventory: **45 files** listed.
- Final combined planner, worker, loading, telemetry, retention, and release-evidence gate passed **227/227**.
- The final canonical Seed001 check failed as intended at the two unresolved gates: `replay-status:unchanged:physical-validation-fallback` and `planner-budget:102164.0475>30000`.

The telemetry release-gate cases and release-evidence tests above use synthetic fixtures and unit evaluators. They prove fail-closed logic and artifact validation only. They are **not** a real 60-second browser workload, a pinned-hardware measurement, a sealed receipt, a corpus aggregate, or release acceptance.

## Unresolved release blockers

1. **Repair parity:** Seed001's deterministic first plan is applied, but the production repair path still returns `unchanged`. The repair/proposal reachability and retained witness context must produce the same valid semantics as the strict planner contracts without weakening validation.
2. **Planner maximum:** the final 102,164.0475 ms planner result exceeds the **<=30,000 ms** whole-seed ceiling by more than 3.4x. Further remediation must preserve status, hashes, RNG/bag state, order, proof ledgers, and existing search limits.
3. **Real runtime performance receipt:** no real 60-second fixed workload has run on the named pinned hardware. The workload, warm-up boundary, frame coverage, fixture identity, quality tier, long-task observation, and receipt command must be externally fixed rather than self-asserted by the snapshot under test.
4. **Renderer-free preparation and activation budget:** the prepared transaction is not yet a renderer-free artifact with an independently measured main-thread Three.js assembly/activation step at **<=8 ms**. Current timing fields do not establish that contract.
5. **Asset decode timing:** there is no separately bounded, completion-aware receipt for model/texture fetch and decode readiness. Three.js assembly timing alone cannot establish the user-visible decode/loading cost.
6. **`Game.create` post-construction cleanup:** prepared values are disposed if construction fails, but a failure after `new Game()` succeeds, such as deferred feature initialization, still lacks an explicit full game/world/renderer disposal path.
7. **No corpus or sealed release chain:** no current accepted-parent manifest, canonical pair, ordered 10/100/1,000-seed evidence, same-source aggregate, browser receipts, or final attestation exists. Unit tests and the stable first hashes cannot substitute for them.

Release remains blocked until all seven items are closed by current-source evidence.
