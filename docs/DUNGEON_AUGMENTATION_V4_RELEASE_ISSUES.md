# Dungeon Augmentation V4 Release-Issue Register

<!-- V4_RELEASE_EVIDENCE_START -->
## Release evidence status — blocked

No sealed aggregate-and-receipts attestation has been supplied for this working tree.

- Authoritative profile: `industrial-supplement-preview-v4` revision 5.
- Immutable accepted-parent corpus: **not supplied**.
- Ordinal shard coverage: **not established**.
- First-realization, strict-validation, diversity, and performance gates: **not established**.
- Overall V4 release readiness: **blocked**.
- Recovery goal status: **ended at the user's request as a diagnostic handoff, not as a release acceptance**.

This block is intentionally conservative. A canonical validator witness, a playable-alpha run, or a corpus aggregate without all same-source receipts cannot establish release. Supply `--evidence=<release-attestation.json>` only after the manifest shards and every required suite receipt have been sealed.
<!-- V4_RELEASE_EVIDENCE_END -->

## 2026-08-04 Seed001 startup follow-up - runtime blocker resolved

This follow-up supersedes `CLOSEOUT-O02` and the browser-startup claims in the
2026-08-03 closeout. It does not change the blocked V4 release verdict or close
the separate planner-performance blocker.

- **Symptom:** the exact fresh Seed001 URL returned HTTP 200, but synchronous
  `augmentDungeonDraft()` work ran inside `Game` construction. The renderer
  stopped responding during route-network search and the in-app browser
  eventually reported that the page had crashed.
- **Cause:** startup called the pure planner, every same-seed exact repair
  replan, and Three.js materialization through one synchronous `generate()`
  stack. Moving a persistent planner into a worker was insufficient by itself:
  completed-candidate search state retained more than 2 GB after the first
  Seed001 plan and the long-lived worker eventually exhausted its heap.
- **Fix:** fresh augmented startup now displays an explicit loading surface and
  drives every yielded planning/repair request asynchronously. Each request is
  planned in a fresh module worker, while only the compact exact-salvage witness
  entries are carried to the next worker for the same realization attempt.
  Completed-plan memo entries remain local to one request, and terminating that
  worker releases its transient route-search heap before the next repair. The
  accepted Three.js dungeon is then consumed exactly once by the normal world
  build after an exact seed/profile/family/base-hash check.
- **Browser evidence:** 1.5 seconds after navigating the exact URL, the in-app
  DOM remained responsive and exposed `Building supplemental dungeon` instead
  of becoming unreachable. A later in-app inspection was blocked by the
  browser URL policy, so this is a responsiveness receipt rather than a final
  visual receipt.
- **Terminal generation evidence:** a two-isolate harness using the production
  browser-planner session completed the exact Seed001 replay in 267.4 seconds:
  `status: applied`, strict validation accepted, zero errors, two exact runtime
  repair passes, augmentation hash
  `v1-0a81632d488d04354ba2b35ec2c0b3a2`, and effective hash
  `v1-e82f9a1390f9f62a42e10d36c522922b`. Four disposable workers completed in
  44.8, 60.7, 75.6, and 72.2 seconds; the persistent-worker reproduction had
  failed with `ERR_WORKER_OUT_OF_MEMORY` at 173.5 seconds.
- **Focused regressions:** 122/122 browser-worker, partial-first scheduling,
  route-candidate performance, and blueprint tests pass. The worker contracts
  cover stale-response rejection, per-attempt salvage-cache isolation, worker
  recycling, error termination, every async repair yield, and structured
  cloning of the real Seed001 planning request.
- **Remaining issue:** Seed001 planning is still far above the unchanged
  30-second release maximum. The game now remains responsive and completes,
  but planner optimization remains `CLOSEOUT-O01` and release evidence remains
  blocked.

[Open the repaired Seed001 fresh-start test](http://127.0.0.1:5174/?startupWorld=dungeon&dungeonFamily=industrial-v1&busterLab=sandbox&playerInvulnerable=1&dungeonSeed=augmentation-realized-v4-001&reaverbotSeed=augmentation-realized-v4-001&dungeonAugmentation=industrial-supplement-preview-v4&dungeonAugmentationFresh=1)

## 2026-08-03 goal closeout — authoritative diagnostic handoff

This checkpoint supersedes every older status, hash, timing, browser claim, and
current-issue count in this file. The recovery goal was ended at the user's
request with unresolved release blockers documented below. “Resolved” means
the named defect has a focused regression and retained hash parity where that
applies; it does not imply that the V4 release gate passed.

### Current reproducible state

- Source provenance is unsealed: branch
  `codex/dungeon-generation-pivot-20260721`, HEAD
  `2b2a86fcd8fe09fe184ed3279c812c35dfcd726b`, with uncommitted source,
  test, profile, and unrelated `tools/blender_mcp` changes. No git staging,
  commit, reset, clean, or push was performed by this recovery task.
- The latest ordinary, non-debug, attempt-one Seed001 plan-only command returns
  `status: applied`, `error: null`,
  augmentation hash `v1-940a43060311ce05c7379ce836972dd7`, and effective
  hash `v1-6759df25ede7bff8d09233cc7cd4a5e4`. The compact probe did not
  republish current operation/node/segment counts, so older counts and
  whole-grant omission lists below are chronology, not current evidence.
- The latest direct command took 51.6 seconds wall time. The latest CPU profile
  (`.codex-temp/seed001-pure-route-shape-v2-20260803.cpuprofile`) spans
  45.274 seconds, with `augmentDungeonDraft` at 38.707 seconds and
  `planRouteNetwork` at 37.022 seconds. This remains above the unchanged
  30-second release maximum.
- A clean restart of the port-5174 development server returned HTTP 200.
  Loading the exact Seed001 URL then blocked the renderer until the in-app
  browser reported “This page crashed”; screenshot and layout-metric requests
  timed out. Therefore no current-build safe-crossing screenshot or current-hash
  lift/ladder visual receipt exists. The older
  `.codex-temp/safe-crossing-cut-through-seed001.png` predates the final
  floodgate carve and must not be treated as current evidence.
- Seed000 was not recaptured after the current changes. The canonical pair and
  ordered 10-, 100-, and 1,000-seed tiers were not run.

The current strict test URL remains:

[Open Seed001 with fresh V4 augmentation](http://127.0.0.1:5174/?startupWorld=dungeon&dungeonFamily=industrial-v1&busterLab=sandbox&playerInvulnerable=1&dungeonSeed=augmentation-realized-v4-001&reaverbotSeed=augmentation-realized-v4-001&dungeonAugmentation=industrial-supplement-preview-v4&dungeonAugmentationFresh=1)

### Resolved or locally proven fixes

| ID | Status | Cause | Fix | Current evidence |
| --- | --- | --- | --- | --- |
| CLOSEOUT-R01 | **Resolved** | Planner, materializer, and runtime derived half-grid endpoint cells with different floating-point rounding, so a legal seam could move to the neighboring cell and rebuild a wall at an approach. | Added one `dungeonRouteEndpointGridCoordinate` authority and used it for seam creation, exact-route rasterization, materialization, and runtime checks. | Focused route/seam tests pass; `git diff --check` reports no whitespace errors. |
| CLOSEOUT-R02 | **Resolved at blueprint/planner level** | `ind-room-floodgate-descent-01` placed the 3×3 `fd-flooded-sump` across the lower east socket’s required approach, making every rotation self-blocking. | Kept the hazard as a 3×1 wall-side strip at `x=3,z=2`, preserving the flooded mechanism while opening the authored `fd-dry-bypass`. | Catalog tests pass 11/11; all 28 authored blueprint sockets across four rotations report zero self-conflicts; route-candidate suite passes 69/69. Materialized/visual proof remains open as CLOSEOUT-O04. |
| CLOSEOUT-R03 | **Resolved in planner contracts** | Recovery could discard an entire augmentation when one room or segment conflicted. | Exact conflict roots now drive module/segment omission and parent-anchored dependency closure, retaining unrelated valid nodes, segments, and connector-only residuals while still failing closed on unrooted or nonreturnable pieces. | Focused partial-first and route-candidate regressions preserve modular salvage, exact omissions, fixed budgets, and deterministic order. Current compact Seed001 hashes are stable, but current entity counts still need recapture. |
| CLOSEOUT-R04 | **Resolved in geometry contracts** | Generic V4 wall openings and merged floor metadata could close ladder/lift mouths or allow incomplete connector proof to bypass fail-closed wall generation. | Ladder endpoints retain reciprocal aperture ownership; lift endpoints require one reciprocal mechanism, opposite roles, a clear shaft interval, and all six exact boarding lanes before walls are suppressed. | The targeted aperture audit passes 11/11; the earlier combined lift/enclosure suite passed 52/52. A retained-vertical-connector salvage integration test and current visual receipt remain open as CLOSEOUT-O03/O05. |
| CLOSEOUT-R05 | **Resolved** | Failed-pair and landmark preselector paths hydrated sockets, collision IDs, and route records that were immediately discarded. | Deferred hydration until a route survives scalar/path filtering or becomes the single retained diagnostic witness; raw parent-attachment routes and exact scored domains are reused under complete context keys. | Route-candidate suite passes 69/69 with unchanged current Seed001 hashes. |
| CLOSEOUT-R06 | **Measured improvement, provisional** | Translation-invariant route-shape booleans were partitioned by operation/topology labels even when exact masks, sockets, and relative geometry were identical. | The shared key now carries exact occupied volumes, shell clearances, authored floors/transfers/solid features/hazards/voids, sockets, external paths, span, and route options, while excluding nonphysical labels. | Profile duration fell from 52.391 to 45.274 seconds and `planRouteNetwork` from 42.306 to 37.022 seconds with identical Seed001 hashes. Only the 69-test focused suite was rerun after this final optimization, so full-suite/corpus validation is still required. |
| CLOSEOUT-R07 | **Rejected experiment removed** | A domain-keyed future-support memo was expected to survive arc-consistency restoration, but the current profile showed no useful hits and added Map/string-key overhead and retention pressure. | Removed the memo and restored epoch invalidation of both prefix and future-support caches. | The post-removal focused suite passes 69/69. |

### Open issues, separated for individual follow-up

| ID | Priority | Measured issue and cause | Independent next action |
| --- | --- | --- | --- |
| CLOSEOUT-O01 | **Release blocker** | Seed001 remains above 30 seconds (51.6-second direct wall time; 38.707-second planner profile). Remaining hot paths are correlated placement reservation/prefilter, candidate placement, exact-adjacent route generation, collision scoring, and allocation/GC. | Profile and optimize one subtree at a time. Preserve result/error JSON, RNG/bag state, order, proof ledgers, hashes, and all existing search limits. Re-run Seed001 after every change. |
| CLOSEOUT-O02 | **Runtime blocker** | The real in-app Seed001 page crashes while synchronous planning blocks its renderer, so the requested current screenshot cannot be produced. This is a consequence of CLOSEOUT-O01, not evidence that the dev server is down. | Get the ordinary client below the watchdog window (or move planning off the renderer without changing semantics), restart port 5174, load the exact URL, and capture the dry crossing plus lift/ladder mouths. |
| CLOSEOUT-O03 | **Correctness coverage gap** | Selective parent-anchored salvage is not yet tested while retaining a vertical ladder/lift connector and omitting an adjacent conflicting module. | Add a ladder/lift table regression proving both endpoints, reciprocal links, connector contract, and every boarding aperture survive; prove omitting either endpoint removes the orphan connector. |
| CLOSEOUT-O04 | **Correctness/visual gap** | The floodgate carve is proven only by socket-level planning tests; no all-four-rotations materialized reachability test proves the dry bypass, walls, floors, sump exclusion, forward traversal, and return traversal together. | Add the materialized four-rotation reachability test, then stage and capture the current Seed001 crossing. |
| CLOSEOUT-O05 | **Visual-evidence gap** | Lift/ladder aperture tests pass, but the final current-hash browser run crashed before inspecting authoritative wall runs, rendered wall meshes, and collision zones. | Extend the visual harness with ladder boarding and safe-crossing staging, then record zero blockers for retained ladder/lift mouths on a clean server. |
| CLOSEOUT-O06 | **Evidence blocker** | Seed000 has no current hash/timing receipt, and the canonical, 10-, 100-, and 1,000-seed gates were not run in order. | Recapture Seed000 first. Run canonical pair, then 10, 100, and 1,000 only after each preceding tier passes the unchanged performance and strict-validation gates. |
| CLOSEOUT-O07 | **Inventory blocker** | Current compact Seed001 output does not identify entity counts or which grants/modules were omitted, while older checkpoints contain mutually incompatible counts and hashes. | Produce a current non-debug manifest with operation/node/segment counts and exact omission ledgers; use it to retire or reaffirm older `trapRoom_conveyorRoom`, boss residual, and segment-5 rows individually. |
| CLOSEOUT-O08 | **Parity/provenance blocker** | The older repeated segment-5 y=0 endpoint seam/helper-owner discrepancy was not re-proven or disproven by the current compact probe. | Record helper source plan and elevation provenance, then share one exact seam-cell ownership predicate between planner and runtime; do not add a broad overlap waiver. |
| CLOSEOUT-O09 | **Release blocker** | The working tree is dirty and no sealed same-source receipts or clean-source provenance exist. | Reconcile unrelated files and profile artifacts, run the complete relevant unit/enclosure/legacy/persistence/browser suites, then seal receipts from one clean revision. |

### Closeout validation actually run

- Final combined closeout command over partial-first scheduling, route-candidate
  performance, and the blueprint catalog: **118/118 passing**.
- `node --test tests/dungeon-augmentation-route-candidate-performance.test.mjs`:
  **69/69 passing** after the final route-shape change.
- `node --test tests/dungeon-augmentation-blueprint-catalog.test.mjs`:
  **11/11 passing** after the floodgate carve.
- Targeted ladder/lift/enclosure aperture audit: **11/11 passing**; earlier
  combined lift/enclosure run: **52/52 passing**.
- Latest Seed001 compact plan-only probe: **applied**, attempt limit 1, hashes
  `v1-940a43060311ce05c7379ce836972dd7` /
  `v1-6759df25ede7bff8d09233cc7cd4a5e4`.
- Not run after the final change: full relevant suite, Seed000, strict
  two-seed visual acceptance, canonical pair, 10-, 100-, or 1,000-seed tiers.

## 2026-08-03 superseded working-tree checkpoint

This section is retained as investigation chronology and is superseded by the
goal-closeout checkpoint above.

- Seed000's current production `generate()` enclosure witness applies on realization attempt 1 and passes the unchanged progression/enclosure assertions within its existing 180-second timeout after exact `Door_Shrine` recovery. That test does not publish current-tree canonical counts or hashes. The latest stored full diagnostic predates the present module-salvage and door-attribution integration (4 operations, 22 nodes, 27 segments, hashes `v1-f5178024e92254900ddaee251b78e15d` / `v1-76d7dfc517c1470584839152fcb8d227`) and is chronology only; Seed000 requires a fresh canonical capture.
- Seed001's current ordinary, non-debug attempt-one replay is `applied`, release-validation accepted, and partial with five operations, 21 supplemental nodes, 24 segments, zero errors, and hashes `v1-603c269a7b1a5157aa66e1509fdf6b2a` / `v1-1aa997029ea651a640f47e7984073aad`. The only whole-grant planner omission is ordinal 3 `coverage:trapRoom_conveyorRoom` (`route-network-placement-backtrack-exhausted`). `keycardRoom_trapRoom` is retained after its exact segment cut, and the safe two-node/two-segment remainder of `bossRoom_shrineRoom` is physically materialized after four exact segment-5 runtime replacements; no unrelated augmentation is discarded.
- The latest bounded one-attempt Seed001 probe reports 35,605.3506 ms planning, 35,117.4979 ms generator planning, and 211.581 ms materialization. The command took 215.3 seconds wall time while completing the four exact same-seed repair passes. This is functionally accepted but still violates the unchanged 30-second release maximum; materialization is not the dominant cost. Earlier scalar-first measurements remain useful optimization chronology, not the current functional witness.
- A separate completed-plan memo correctness defect is repaired. The memo can be caller-owned and reused across generations, but its prior key omitted immutable generation identity and could return a prior seed's planned object. The key now partitions by base plan and base-draft fingerprints, augmentation/layout seeds, difficulty, profile ID/revision, realization attempt, grant/region, solver context, exact same-grant exclusions, and candidate identity. Cross-seed same-Map tests prove isolation while same-seed eligible hits remain stable; recovery, staged-reservation, and salvage frames remain ineligible.
- Parent-anchored module salvage is implemented and integrated. It removes exact conflict roots plus only incident, under-degree, or unrooted dependency closure; preserves safe cycles and safe multi-parent-root merges; and requires exact parent attachment, bidirectional reachability, returnability, and partition membership. Connector-only residual components remain physical while progression/minimap projection collapses them to the exact authored parent, preventing proxy-ID leakage.
- Automatic-lift boarding apertures now survive merged scalar zone and connector-owner metadata by pairing the exact three-lane mouths through a common signed/shared physical owner. The two center links must resolve the same lift mechanism with opposite `forward`/`reverse` roles, the endpoints must be reciprocal and geometrically opposite, and the lower-exclusive/upper-inclusive shaft sweep must be clear. Missing lanes, mismatched half-lifts, same-role links, or a shaft cap fail closed. The dedicated lift suite passes 4/4 and the combined lift/enclosure run passes 52/52. A pre-restart browser diagnostic found all six exact boarding lanes open with zero overlapping authoritative wall runs, rendered boundary-wall meshes, or boundary collision zones. A clean-server current-hash runtime receipt now confirms the expected applied hashes and zero console errors; its earlier `window.game === false` result was isolated-world visibility, not failed publication. A current-hash lift geometry audit remains pending.
- The Seed001 boss residual is integrated. Initial exact conflict roots omit segments 4/6/7; dependency closure removes isolated node 3, under-degree nodes 0/1/5, and segments 0/2/3. Nodes 2/4 and segments 1/5 remain as one valid bidirectional parent-anchored component. Node 5 is intentionally removed because its apparent second arm was only the synthetic `parentThroughPhysicalArmId`; no concrete physical connection plan backs that arm. The assembler and materializer independently re-prove the residual contract, preserve physical stamping, and expose no supplemental proxy IDs to progression or minimap consumers.
- The proven candidate-13 segment-5 future-domain cut remains the primary exact modular repair: at its exact target descriptor the accepted baseline has 174 candidates, segment 5 alone leaves 36, the complete landmark leaves 0, and the complete landmark minus segment 5 restores 30; every other single-segment cut leaves 0. The discarded comparison-derived second-cut/contextual scheduler was removed after it regressed Seed001 to one operation. The later `trapRoom_conveyorRoom` grant still has no accepted safe residual: all eight local identities fail by elevation interval, parent attachment, or bounded placement backtrack, and the parent-anchored salvage classifier produces zero valid proposals. Whole-grant omission is therefore currently the terminal fail-closed outcome only for this independently exhausted grant, not the recovery unit for unrelated augmentations.
- Noncanonical warm-cache evidence proves exact-segment salvage on Seed000 for excluded signature `v1-8bb6bcc9133df3d8517ab0c26c20ec28`: both parent sockets, all 5 nodes, and 5 of 6 segments remain; exactly one segment is a conflict-root omission; cycle rank is 0; and no whole-grant prune occurs. The resulting hashes are `v1-9f877f0358dc63a60b4072f3e8e7e3c1` / `v1-5588458cc360fadf4e036c1ea49feb11`. Cold excluded replay is not proven by this warm-cache diagnostic.
- The remaining release blockers are current-tree canonical planning at or below 30 seconds for both Seed000 and Seed001, exact provenance/parity for the repeated segment-5 endpoint seam, a current-hash formal two-seed strict visual receipt, clean source provenance, and the ordered canonical, 10-, 100-, and 1,000-seed gates. Seed001 currently reports 35.6054 seconds; Seed000's latest stored 38.0677-second result predates the present integration and requires recapture. The current `trapRoom_conveyorRoom` omission is individually documented and fail-closed; any further recovery must add a genuinely legal module/path or a newly proven safe parent-anchored residual rather than weakening validation or increasing limits. No release stage may be skipped.
- During this work the checked-out branch unexpectedly advanced to commit `cd16efc` (`Implement requested Three.js updates`) outside this task's controlled git actions. No staging, commit, reset, clean, or push was performed here. Current local results remain diagnostic until that provenance is reconciled.

The strict current testing seed remains:

[Open the current strict Seed001 augmentation test](http://127.0.0.1:5174/?startupWorld=dungeon&dungeonFamily=industrial-v1&busterLab=sandbox&playerInvulnerable=1&dungeonSeed=augmentation-realized-v4-001&reaverbotSeed=augmentation-realized-v4-001&dungeonAugmentation=industrial-supplement-preview-v4&dungeonAugmentationFresh=1)

## 2026-08-02 superseded module-level recovery checkpoint

This section is retained as investigation chronology and is superseded by the 2026-08-03 checkpoint above.

- Seed000 now applies on realization attempt 1 with all six required networks, 30 nodes, 37 segments, zero planner/runtime grant pruning, zero strict-validation errors, and hashes `v1-c5bd067e2be80b0dab57afaf63f20d2b` / `v1-bc27dc53c2172c55eeb69fbafb6fc5db`. Its measured full replay took 25 seconds wall time with 12.7841 seconds planning and 258.219 ms materialization.
- Seed001 applies on realization attempt 1 as a strictly validated three-network partial with 14 nodes, 17 segments, zero runtime repair, and hashes `v1-302ed26c9f2bc8dfdf8f598c28ac53c9` / `v1-4a48156df773fb747768ce9e95cb6f8a`. Its measured full replay took 45 seconds wall time with 36.2653 seconds planning and 145.128 ms materialization, so it still fails the 30-second whole-seed gate.
- Seed001 currently omits three complete planner grants: `keycardRoom_trapRoom`, `trapRoom_conveyorRoom`, and `bossRoom_shrineRoom`. This is the remaining mismatch with the required module-level supplement behavior. The exact causes and independent repair units are listed below.
- Seed001 live visual acceptance passes for two instantiated automatic lifts: 3 boarding lanes at both ends of each lift, 12/12 resolved lanes, and zero blocking boundary-wall IDs. The focused Playwright run passes 1/1; the dedicated lift suite passes 4/4; the combined enclosure suite passes 51/51.
- No clean-source sealed release receipts or ordered 10/100/1,000 corpus evidence exist. Release readiness remains blocked.

The strict `dungeonAugmentationFresh=1` path ignores but does not mutate an existing save and remains strict rather than alpha. Focused browser observations are not the pending formal two-seed visual receipt.

[Open the current strict Seed001 augmentation test](http://127.0.0.1:5174/?startupWorld=dungeon&dungeonFamily=industrial-v1&busterLab=sandbox&playerInvulnerable=1&dungeonSeed=augmentation-realized-v4-001&reaverbotSeed=augmentation-realized-v4-001&dungeonAugmentation=industrial-supplement-preview-v4&dungeonAugmentationFresh=1)

The required generation order is additive and module-level:

1. Generate and accept the base floor plan, authored rooms, and authored connectors.
2. Discover the areas that need supplemental augmentation.
3. Plan and materialize eligible augmented areas against the complete authored collision set.
4. Remove or replace only the exact conflicting supplemental room or connection segment.
5. Replay the same seed and retain every unrelated valid augmentation module.

An exact candidate signature, not a whole augmented area, is the normal recovery unit. For a room it includes the grant, entity kind, grammar/template, placement, and rotation; for a connection segment it includes the grant, entity kind, endpoints, and path geometry. The bounded planner must construct a complete replacement graph and pass the unchanged strict validators. Stable ordinal IDs are evidence fields, not sufficient exclusion identities.

### Current independently actionable blockers

| Defect | Current evidence | Exact cause | Independent repair unit |
| --- | --- | --- | --- |
| Automatic-lift boarding walls | **Repaired; 52/52 lift/enclosure contracts passing** | The exact paired-lift aperture proof treated the lower stop's static support floor as a shaft blocker. A generic V4 wall-opening marker could also bypass incomplete paired-lift proof after floor metadata was merged, allowing a boundary wall to be rebuilt in front of a landing. | Use the lift movement interval (lower-exclusive, upper-inclusive), require reciprocal opposite-role endpoints and all six exact lanes, and make generic V4 aperture metadata incapable of bypassing the paired proof. A pre-restart diagnostic observed 6/6 lanes and zero wall-run, rendered-wall, or collision-zone blockers; current-hash browser confirmation remains pending. |
| Seed001 `trapRoom_conveyorRoom` omission | **Isolated unresolved grant** | After the primary segment-5 future-domain repair, all eight identities for the later grant still fail locally by elevation interval, parent attachment, or bounded placement backtrack. No candidate yields a parent-rooted, bidirectionally reachable, returnable residual, so the exact salvage classifier emits zero proposals. | Add a genuinely legal grammar/path within the unchanged bounds, or prove a new nonempty parent-anchored residual. Until then, omit only this exhausted grant and retain the other five operations. |
| Seed001 `bossRoom_shrineRoom` omission | **Repaired and integrated** | The planner produced a valid connector-only residual, but node 5 was incorrectly kept by counting a synthetic parent-through arm that has no physical plan. After local closure found the correct nodes 2/4 plus segments 1/5 forest, candidate-local promotion still lost its exact root ledger and final validation replanned it as unproven. | Require two retained actual incident segments for a connector module unless a parent-through arm is concretely backed; fully validate the provisional forest; then carry its exact conflict roots and original source-node span into final validation. Project connector-only progression/minimap to the canonical authored parent. |
| Seed001 `keycardRoom_trapRoom` omission | **Repaired and integrated** | The exact candidate-13 segment-5 counterfactual was the unique single-segment cut that restored the downstream endpoint domain; removing any other single segment did not. | Retain the primary proven segment cut, recompute structural caps and forest validity, and keep every other safe module. The current replay retains this operation. |
| Canonical planning performance | **Unresolved release blocker for both seeds** | Seed001 reports 35.6054 s planning and 35.1175 s generator planning, above the 30-second maximum; four exact same-seed materialization repairs extend command wall time to 215.3 s while materialization itself is only 211.581 ms. Seed000's latest stored diagnostic reports 38.0677 s planning and 37.7603 s generator planning, also above the ceiling, but predates the current integration and requires recapture. | Profile both current accepted graphs and reduce planner/replan work while preserving exact result/error JSON, order, hashes, RNG/bag state, proof ledgers, and all search limits. Do not advance the corpus gates on a stale or faster isolated candidate measurement. |
| Failed-pair diagnostic over-hydration | **Repaired; not the primary blocker** | The empty-domain path used to construct socket arrays and route evidence for every rejected pair before structural-span classification, although 37 of the current 42 events continue via reduced-forest salvage and discard that evidence. | Prime exact pair state in the original Cartesian order, classify first, and hydrate only the stable top eight for terminal errors. Current timing: 37 structural events/8,580 pairs with zero hydrated records; five terminal events/465 pairs with 35 records; 307.4 ms total. |
| Landmark exact-adjacent candidate over-hydration | **Repaired with measured gain** | The landmark pair preselector cloned both sockets and computed collision IDs for every raw/colliding route before filtering, although rejected records were discarded except for the one minimum-collision witness. The work amplified cloning and GC in forward/reservation contexts. | Keep scalar/path references through the unchanged filters and stable sort; hydrate every accepted route and the exact minimum diagnostic witness once. All-rejected, mixed, and stable-tie equivalence fixtures pass. Seed001 planning improved by 5.43 s (9.06%) with exact hash/result parity. |
| Completed-plan memo cross-seed leakage | **Repaired and regression-tested** | `routeNetworkPlanResultCache` may be caller-owned across generations, but the completed-plan key previously contained only candidate/solver context. Equal local contexts in another seed could retrieve the first seed's planned object; existing tests used fresh maps or debug mode and did not expose it. | Partition the key by every immutable generation input and exact same-grant exclusions without broadening memo eligibility. Cross-seed same-Map, property-order, per-field mutation, exclusion, and same-seed-hit regressions pass. |
| Module-level salvage contract | **Implemented and integrated** | Earlier recovery represented intrinsic planner failure only as a whole `prunedRouteNetworkGrant`; consumers also rejected safe connector-only residuals. | Exact conflict roots now drive only incident/under-degree/unrooted closure, and retained components must be exact-parent-rooted, bidirectionally reachable, returnable, and partition-complete. Ordinary/malformed components remain strict. |
| Candidate-local salvage provenance | **Repaired and canonical-evidenced** | A fully validated provisional residual replaced its failed candidate, but its exact conflict roots were not copied into `routeNetworkConflictExclusions`. Final candidate validation therefore emitted `route-network-conflict-root-omission-unproven` for segments 4/6/7 and discarded the safe forest. | Promote only after the complete salvage validator accepts; carry the exact proposal-local roots and original source node count into the next state; fail open to ordinary candidates if that proof is absent or invalid. |
| Nonzero-elevation `Door_Shrine` bypass | **Repaired and production-replayed** | Retained `conveyorRoom_bossRoom` connector-junction node ordinal 3 ended at `-7,129@y0`, physically adjacent to shrine floor `-7,130@y0`, bypassing the closed door near `18,124.5`. Physical-progression entry-edge failures were not attributed, and terminal cached parent-anchored salvage could retain a reusable external physical exclusion. | Attribute `critical-door-bypass-entry` only when one exact realized supplemental node or segment owns the edge; authored-only or ambiguous edges remain diagnostic. Reject any salvage proposal retaining that external exclusion, then apply ordinary dependency closure and same-seed modular recovery. The production Seed000 enclosure replay passes within its existing 180-second timeout without weakening door dominance or lift apertures. |
| Repeated Seed001 segment-5 endpoint seam | **Unresolved parity/provenance blocker** | All four runtime repairs report the same physical seam at `28,108@y0.000` against foreign owner `conveyorRoom_machineFactoryRoom_upper`; only the replacement signature changes. Planner reservation correctly places that upper corridor at `-10.55..-6.35`, while runtime also sees an unproven planar `service_lane` owner at y0 beside real floors at `-9.95` and `-14`. Existing records do not prove whether the y0 lane is a stale helper or a genuine footing, so a broad waiver would be unsafe. | Record exact helper provenance, source plan, and local elevation when planar lanes are created; consume or rekey only proven helpers during signed realization; then share one exact seam-cell ownership predicate between planner and runtime. Preserve genuine y0 crossings and fail closed on malformed provenance. |

The larger defect table below is retained as investigation history. Its row-level status text is not authoritative where it conflicts with this checkpoint.

### Individually isolated defects

| Defect | Current status | Exact cause | Repair unit |
| --- | --- | --- | --- |
| Partial scheduler and useful floor | **Seed001 strict end-to-end replay evidenced** | The preferred three-network partial path was effectively all-or-nothing, and a partial-first checkpoint could accept landmark + conveyor after only coverage candidates 0–1 even though candidate 3 was a valid modular replacement for `enemyNest_keycardRoom`. | Deterministic checkpoints and a deferred, fair coverage-suffix queue prioritize accepted required-count/class coverage. Current strict replay retains three operations, 10 supplemental rooms, 14 nodes, and 17 segments. Candidate, visit, module, network, and watchdog limits remain unchanged. |
| Exact-node conflict attribution | **Seed000 canonical exact-repair evidenced** | Late failures were attributed to aggregate/global conditions or only to an ordinal `entityId`, so recovery could delete an entire grant instead of the one conflicting placement or path. | Seed000 now applies after four exact node-repair passes across five physical exclusion signatures, retains four operations and every unrelated valid module, and records zero whole-grant runtime pruning. `entityId` remains evidence only; the physical signature is the exclusion identity. Current Seed001 requires no runtime repair. |
| `crested_slope_v1` footprint parity | **Locally repaired; canonical proof pending** | Planning reserved a narrow centerline, but materialization emitted a two-flight switchback with a 7 m lateral offset and could silently try a colliding fallback side. | Project the materializer's complete two-flight reservation for both sides during planning, select a legal side there, carry it into materialization, and reject instead of choosing an unplanned fallback side. |
| Vertical-underpass false missing floor | **Seed001 integration evidenced** | Coverage segment 4 had a real ownerless connector floor at `-28,122@y-14`, but wide-floor bookkeeping suppressed its section solely because the same X/Z column lay inside `bossRoom`. The validator then lacked the section's expected elevation and reported a false missing/orphaned floor, cascading into a node failure. | Seed001 now retains this coverage network with strict physical/progression validation. Cross-sections are recorded outside room footprints or when the realized center floor exists at that elevation without a room owner; genuine same-elevation authored-room interiors remain suppressed. |
| Ownerless endpoint seam/base-overlap mismatch | **Locally repaired; canonical proof pending** | An internal endpoint seam without `parentOwnerId` could waive overlap with immutable base connection occupied, camera, or landing volumes merely because it was inside an endpoint seam envelope. | Permit overlap only at the exact parent-boundary seam whose `parentOwnerId` matches that base connection. An ownerless internal seam never receives the waiver. |
| Lift exterior straight-run parity | **Seed001 integration evidenced** | The planner could accept a lift segment/path without the exterior straight run required by the connector contract, leaving materialization to reject it. | Planning now applies the same lift contract against base and previously selected room footprints before committing the segment. Seed001 strictly retains `conveyorRoom_bossRoom`; alternate legal routes remain available and no higher limit or materializer fallback was added. |
| Legacy progression-footing false positives | **Seed001 integration evidenced** | Progression columns correctly came from legacy/authored routes, but final validation was passed only legacy connection plans. It therefore failed to recognize a physically registered V4 connector gallery at another elevation and incorrectly demanded Y=0 footing beneath the midpoint. | Seed001 now passes with zero progression errors. Only registered, non-graph-only realized physical connector plan IDs count as connector footing; unregistered and graph-only floors still fail. |
| Foreign supplemental floors contaminating `bossRoom.platformNodes` | **Seed001 integration evidenced** | Room-floor collection used `roomId === room.id || X/Z containment`, so a supplemental floor owned by another V4 node but lying under the boss footprint was absorbed into the boss platform list and tested against authored solids as if it belonged to the boss. | Seed001 now excludes explicitly foreign-owned supplemental floors from the authored boss platform list while retaining unowned legacy geometry and room-owned floors. |
| Authored scaffold ownership in overlapping X/Z layers | **Seed001 strict integration evidenced** | Two scaffold-repair loops selected local floors by X/Z containment, then stamped a new ramp with the outer supplemental room even when the selected chain tile carried the authored boss-room `roomId`. The underpass could therefore capture overpass floors and create false footprint/connectivity failures. | Owned tiles now require exact normalized `roomId` equality, spatial containment is retained only for genuinely unowned legacy floors, mismatched candidates are rejected, and the selected exact owner is carried into ramp creation. Focused ownership regressions pass and strict Seed001 reaches exact modular recovery without foreign-floor contamination. |
| Lift shaft swept-interval bounds | **Focused lift geometry repaired; Seed001 strict integration evidenced** | The shaft predicate first treated floors above the lift as crossing the aperture, then an open-interval correction also excluded a blocking cap exactly at `topElevation`. | Shaft occupancy now uses the intended lower-exclusive, upper-inclusive interval: the bottom landing is not a blocker, an exact top-elevation cap is rejected, and a separate floor above the top landing is ignored. Full lift geometry passes 4/4, including ascending and descending cap fixtures. |
| Ramp/scaffold exact failure bridge | **Exact attribution contracts evidenced; current canonical seeds accepted** | A final ramp/scaffold conflict was emitted only as a global string/count, so the replay loop had no exact entity to replace and could return the unchanged authored base. | Platformability now emits concise ramp/scaffold ownership records, and connector-assembly plan errors carry exact supplemental segment IDs for the same recovery path. Current Seed001 passes without runtime exclusions; Seed000's bounded exact repairs retain every unrelated network and never prune a whole grant. |
| Exact replacements before terminal grant omission | **Seed000 canonical exact-repair evidenced** | `continueWithoutRequiredGrant` and post-validation omission could discard a grant immediately after an exact conflict identified a replaceable module. Conversely, an unconditional prohibition on ever omitting that grant could collapse the entire overlay to the authored base after every bounded replacement was genuinely exhausted. | A conflict-protected grant is forbidden from every early, capacity, future-grant, and post-validation omission path. Seed000 now proves four bounded exact node-repair passes across five signatures before an applied result, with every unrelated valid network retained and zero whole-grant runtime pruning. Only genuinely exhausted atomic grants may enter the terminal best-effort ledger. |
| Structured planning/materialization exact-segment backstop | **Locally repaired; canonical proof pending** | Connector-contract failures were unstructured strings, so same-seed recovery could not identify the failing segment and fell back to coarse pruning. | Materialization records code, operation ID, grant ID, entity kind, segment ID, and connector family. The generator verifies those IDs against the overlay, emits the exact signature with `route-network-materialization-contract-rejected`, and replays the same seed without pruning the grant. This is a safety net, not a substitute for planner/materializer parity. |
| Final planner-validation exact-conflict bridge | **Locally repaired; canonical proof pending** | Final validation could identify a precise base-overlapping node or segment, but post-validation recovery still converted its grant into a whole-grant omission because no exclusion had been synthesized yet. | Only the unambiguous immutable-base diagnostics `supplement-overlaps-base-draft` and `route-network-segment-base-overlap-outside-landing-grant` now map to exact physical signatures. The same attempt replans before omission; exhaustion returns structured exclusion/failed-grant evidence for the generator fixed point. Ambiguous pairwise conflicts remain fail-closed. |
| Structural-frame failure attribution | **Seed000 canonical applied** | Missing structural-frame wall runs were reported only as strings inside a generic incompatible-content exception, so no segment signature reached same-seed recovery. | Structural-frame validation now emits verified segment/operation/grant evidence. Seed000's bounded exact recovery retains zero whole-grant pruning and reaches the accepted `v1-f5178024e92254900ddaee251b78e15d` overlay. |
| Corridor-station boundary-indicator support | **Locally repaired; Seed000 delta evidenced** | An authored corridor station is a T-junction: the through corridor occupies both neighbors at the exact socket cell and its 5.6 m aperture consumes the threshold transom. Binding only at the socket axis therefore reported missing side walls that downstream segment replanning could never create. | Search only threshold/+1/+2 outside depths of the same authoritative 3×5 seam, select the nearest complete connector-owned side-wall pair, and move only the nonblocking presentation point. Four-facing structural tests pass; the original conveyor segment-0 structural failure disappears from Seed000. |
| Endpoint-seam ownership failure attribution | **Seed000 exact replay evidenced** | After the structural-frame repair, Seed000 exposed an endpoint overlap at `-38,104@y0` with foreign owner `conveyorRoom_machineFactoryRoom_upper`; this late physical error also lacked an exact recovery bridge. | The generator now attributes the exact segment endpoint and replays its physical signature. Seed000's second repair pass excludes only that segment candidate and records no whole-grant pruning. |
| Finite parent-attachment path continuation | **Locally repaired; both canonical seeds functionally accepted** | Coverage placement cached only the single shortest static-clear parent path and the correlated prefix treated that choice as immutable. Alternate finite doglegs were generated but discarded, so one conflicting shortest path could eliminate a legal room assignment and surface as protected replacement exhaustion. | Reserve a parent-attachment collision body during the correlated prefix only when its domain is a singleton. Multi-path domains remain unresolved until the exact spine solve enumerates their compatible finite product. Tuple-independent spine behavior is compiled once; equivalent failures are memoized by exact option-mask and attachment distances while every logical tuple still consumes the unchanged 20,000-visit budget. Performance evidence remains open. |
| Parent-attachment seam ownership | **Focused route/topology contracts evidenced; canonical proof pending** | The compiled and reference spine solvers granted both endpoint seam intersections to every attachment, so attachment A could borrow attachment B's waiver on a foreign edge. | Bind each parent seam grant to its own attachment endpoint and node index in compiled masks, reference checks, exact route solving, and topology solving. A self-edge retains both endpoint grants; selected foreign nodes receive none. |
| Observation-break false full-tier verticality | **Seed001 strict integration evidenced** | Observation-break metadata advertises `step`, but its geometry is only an optional 0-to-0.7-metre lore spur. The any-transfer predicate incorrectly treated that spur as the required 2.8-metre slope tier and suppressed synthesis of the real operation transfer. | A mode-aware purposeful-authored-elevation predicate now requires a floor-supported transfer component in the requested family spanning at least 2.8 metres. Candidate 3 replaces only the conflicting rise room with `compact-ramp-defense-rise`, retains `switchgear-cache-descent` and the rest of the network, and passes with the unchanged candidate limit. |
| Horizontal-bend planner/runtime footprint parity | **Seed001 strict integration evidenced** | Runtime widens every level cardinal bend to a 3×3 landing, while planning reserved only the two orthogonal corridor legs. A sibling segment could occupy the unreserved outer quadrant and then fail strict floor ownership during realization. | `routePathFinalOccupiedSpans` now emits the exact bend landing used by runtime; candidate planning and serialized final volumes share it. Self-overlap checks compare route legs, and strict unrelated-floor ownership remains unchanged. The two original enclosure failures and 57/57 route-candidate checks pass. |
| Legacy switchback assignment retry | **V1 integration evidenced** | `crested_slope_v1` threw when its first coarse side check found no side, aborting before the existing 48-assignment legacy retry loop. It also counted its own endpoint-room handoff as a blocker although complete reservation permits it. | Unrequested V1 contracts retain the unresolved side sentinel so complete reservation rejects only that assignment and the bounded outer loop retries. Endpoint rooms are excluded consistently. Explicit V4 planned sides remain immutable and fail fast. Connector variants pass 26/26 and the forced-invalid V1 fallback still uses eight gameplay attempts. |
| V1–V3 objective-allocation isolation | **Immutable replay evidenced** | V4's all-overlong-objective-routes allocation rule leaked into committed legacy profiles and aborted host construction before their historical overlays could run. | Runtime threads the exact profile ID into the host. V1–V3 retain their historical deterministic greedy partial grants; V4 and direct/default host consumers retain strict bounded complete allocation. The V2 adjacent-threshold witness, pre-pruned contracts, and committed V1–V3 hashes pass. |
| Sparse presentation and public interfaces | **151/151 focused contracts passing; pre-restart Seed001 browser observation; current-hash visual pending** | Boundary indicators, source-bound cover/machinery records, optional story markings, immutable V1 presentation, and the public V4 schema/profile shape needed one combined current-tree audit; isolated registration assertions could otherwise be mistaken for a realized presentation result. | The prior local audit passed structural 35/35, assembler plus materializer 59/59, legacy plus blueprint 19/19, runtime content plus connector variants 37/37, and the pure V4 schema/profile 100-seed fixture 1/1. Its pre-restart browser observation rendered a supplemental foundry area with then-accepted hashes and zero console errors; it is superseded as live evidence and does not replace the pending current-hash two-seed visual receipt. |
| Release-worker phase/timing integrity | **52/52 focused release evidence and gate checks passing; sealed receipt pending** | Failed evidence could omit planner/assembly metrics or drift from its captured heartbeat, a nominally successful worker could accept a stale pre-disposal heartbeat, and aggregate validation trusted its sealed overall verdict after checking only performance. In addition, an unchanged authored-base fallback has no top-level `augmentationMetrics`, so the verifier discarded the final rejected attempt's valid timings before publishing its zero-record failure. Those gaps could obscure the watchdog phase or allow a re-sealed zero-record aggregate to claim release. | Warm-up and target generators remain pinned to one attempt. Successful evidence must end on completed target disposal with exact six-phase and generator-timing parity; failed seed workers publish zero records, while a failed shard retains only earlier independently validated records and binds its failure to the captured heartbeat. Fallback extraction uses the final rejected attempt's planning metric and only that attempt's completed assembly event; missing/non-finite metrics fail closed and are never synthesized as zero. Aggregate validation now recomputes authoritative tier/shard/record counts, coverage, diversity, performance, every acceptance gate, and the final verdict. Runtime generation remains at eight attempts. |
| Direct release-stage predecessor binding | **Locally repaired; sealed ordered evidence pending** | The lower-level release entry point previously built the 1,000-seed aggregate and final attestation without consuming the canonical, 10-seed, or 100-seed results, so direct invocation bypassed the package runner's procedural ordering. | Direct release now preflights sealed passing canonical, smoke, and normal artifacts before corpus work, rechecks exact manifest identity after manifest creation, and passes all three required artifacts to the finalizer. The final attestation embeds their evidence and hashes and revalidates exact same-source/profile/manifest identity; missing, mixed-source, failed-but-resealed, or removed predecessors fail closed. |
| Strict fresh testing URL | **Browser evidenced** | Ordinary URL parameters correctly lose to an existing committed expedition, which made the original test link appear unaugmented. | Exact `startupWorld=dungeon` + exact V4 profile + `dungeonAugmentationFresh=1` constructs a strict disposable run, ignores without mutating the save, and suppresses durable writes. It does not enable alpha acceptance. |
| V4 authoritative ladder boarding walls | **Seed001 browser and focused contract evidenced; formal journey pending** | The V4 authoritative shell rebuilt base `ladder_gallery_v1` connectors from floor layers but honored only the newer V4-owned opening field. Both exact legacy ladder boarding hints were therefore ignored and a wall run was emitted across each upper and lower ladder face. Ladder traversal bypasses ordinary barrier checks, so platformability did not expose the visual/physical obstruction. | Supplemental blueprint ladders now stamp only their exact owner-bound floor-to-aperture edges. During authoritative V4 shell reconstruction, a legacy ladder edge is carved only when that exact edge is declared, its target floor exists at a different elevation in the same direction, and the target has the reciprocal ladder link. Non-augmented V1 remains unchanged, unrelated legacy hints remain walled, and lifts retain their separate multi-lane contract. Both Seed001 ladders now report zero blocking wall IDs at all four boarding endpoints; the focused screenshot/receipt is under `artifacts/dungeon-augmentation-v4-release/visual/`. |
| V4 authoritative automatic-lift boarding walls | **52/52 lift/enclosure contracts evidenced; current-hash visual pending** | The paired aperture proof misclassified the lower stop's static sill/support floor as a shaft blocker. Generic V4 opening metadata could then bypass the failed exact proof until a merge or missing lane exposed a rebuilt wall. | The authored connector lift requires exact contiguous three-lane source and destination groups, opposing directions, matching centers and 14 m separation, reciprocal center links, and a clear lower-exclusive/upper-inclusive shaft. Exact lift-edge metadata suppresses the generic opening path even if scalar zone metadata was merged. A pre-restart diagnostic reported zero authoritative, rendered, or collision-zone blockers across the six governed edges. The clean-server page did publish the expected current-hash dungeon; only the isolated inspection world could not see its page global. Current-hash governed-edge visual confirmation remains pending. |
| Exact authored drop-space traversal walls | **Seed000 canonical 79/79 egress and 47/47 enclosure contracts evidenced** | Authoritative V4 shell reconstruction could emit supplemental wall runs through the authored lower-floor walk, return-shelf climb, and exit jump even though those floor pairs were real drop-space traversal edges. Broadly opening the room boundary would weaken unrelated authored walls. | V4 now resolves every declared drop-space key to exactly one non-support floor, considers only unique cardinal pairs with a real `walk`, `ledge_climb`, or `jump` action, and removes only that action's exact player-height interval. Missing/malformed arrays, unresolved or duplicate keys, non-cardinal pairs, and actionless pairs fail closed; unrelated and non-authoritative V1 walls remain. Seed000 now reports all 79 lower tiles reachable and escapable with zero egress-blocking edges. |
| Planner and final-validation performance | **Active release blocker; both canonical seeds functionally accepted** | The latest one-attempt strict Seed001 probe takes 215.3 seconds wall time while reporting 35.6054 seconds planning, 35.1175 seconds generator planning, and 211.581 ms materialization. Seed000's latest stored diagnostic reports 38.0677 seconds planning and 37.7603 seconds generator planning but predates the current integration; both exceed the unchanged 30-second maximum and Seed000 needs a fresh capture. | Preserve exact modular replacement and unchanged limits while reusing only sound candidate-independent work and avoiding repeated equivalent replans. Do not advance 10/100/1,000 until both current-tree canonical runs meet the performance gate. |

### Current verification evidence

- Seed000 production enclosure replay: **applied** on realization attempt 1 and passes unchanged progression/enclosure assertions after exact door-bypass recovery within the existing 180-second timeout. A fresh canonical current-tree count/hash/timing capture is pending; the stored 4-operation/22-node/27-segment diagnostic and the older 6-operation/30-node/37-segment result are chronology only.
- Seed001 full replay: **applied best-effort partial**, strict release validation accepted, realization attempt 1, 5 operations, 21 nodes, 24 segments, one whole-grant planner omission, four exact same-seed runtime segment replacements, and zero errors. Hashes are `v1-603c269a7b1a5157aa66e1509fdf6b2a` / `v1-1aa997029ea651a640f47e7984073aad`; the probe reports 215.3 seconds wall, 35.6054 seconds planning, 35.1175 seconds generator planning, and 211.581 ms materialization.
- A pre-restart Seed001 browser diagnostic inventoried two lift objects and found exactly three upper plus three lower connector-lift boarding lanes with zero authoritative wall-run, rendered-wall, or collision-zone blockers. A separate clean-server current-hash runtime receipt confirms `applied`, 5 operations, the accepted hashes, release validation, realization attempt 1, four runtime repair passes, and zero console errors; it does not yet repeat the six-edge visual audit.
- Dedicated automatic-lift geometry passes 4/4. The broader augmentation set passes 159/159. The combined lift/enclosure run passes 52/52, including the repaired `Door_Shrine` production-recovery assertion.
- The focused planner/pruning/performance group passes 142/142 after parent-anchored salvage, exact external-exclusion, and deterministic scheduling coverage. Stored pre-integration Seed000 probes had matching plan/full-replay hashes; a new current-tree canonical hash comparison remains pending.
- The focused lift artifacts remain `artifacts/dungeon-augmentation-v4-release/visual/seed001-lift-aperture-after.png` and `seed001-lift-aperture-after.json`. They cover one pre-restart diagnostic and are supporting evidence, not a sealed formal receipt. The clean-server page completed after five synchronous generation passes; the reliable readiness contract is `#game-container[data-browser-test-ready="true"]`, followed by page-main-world inspection when a global is required. The isolated evaluator's false `window.game` result must not be reported as a startup or publication failure.
- The current-hash formal two-seed receipt, exact seam-helper provenance, current-tree canonical performance evidence for both seeds, canonical -> 10 -> 100 -> 1,000 ordered evidence, clean-source receipts, release provenance, and sealed attestation remain pending. Canonical planning above 30 seconds and the repeated segment-5 seam repair block advancing those gates.

### `V4-RCV-017` - repaired unchanged-worker metric extraction

The realized verifier originally read planner and assembly metrics only from `dungeon.augmentationMetrics`. That object belongs to an applied augmentation facade; when strict realization rejects the supplement, the returned accepted authored base is correctly `unchanged` and has no top-level augmentation metrics. The final rejected attempt still retains its finite `diagnostics.planningTimeMs`, and the release observer has the generator's exact completed `three-js-assembly` duration, but the worker discarded both and reached its release finite-metric assertion with null values. The resulting zero-record failure therefore could lose the timings needed to diagnose performance and watchdog behavior.

Fallback extraction now selects only `rejectedOverlay.attempts.at(-1)`, takes its existing planning duration, and pairs it with the completed assembly event observed after that same attempt's `planning started` event. Starting another attempt resets the observed assembly value, so an earlier repair pass cannot leak into the terminal diagnostic; an unmatched completion event is also ignored. Missing, negative, or non-finite values remain null and fail closed; the worker does not synthesize zero and does not relax the finite-metric requirement. Once a failed worker or shard has reached strict validation or disposal, its validator requires both finite generator metrics; an earlier planning/assembly watchdog failure may still report its honestly incomplete phase without invented completion data. The regression drives an actual `DungeonGenerator` through a rejected applied facade into its unchanged authored-base fallback, proves final-attempt selection, rejects an orphan assembly completion, converts `unchanged` to an atomic failed publication with `records: []`, and validates the sealed worker with the exact retained `222 ms` planning and `7.25 ms` assembly fixture values. This is harness-integrity evidence, not a canonical performance result or release receipt.

### `V4-RCV-018` - repaired direct release-stage predecessor binding

The ordered gate runner already stopped after the first failed canonical, smoke, or normal stage, but the lower-level `verify-dungeon-augmentation-release.mjs --tier=release` entry point previously created release artifacts without consuming those predecessors. The package aliases were ordered procedurally while direct invocation could skip the sequence; the final attestation had no predecessor evidence or hashes to revalidate.

The direct release stage now reads and validates sealed passing canonical, smoke, and normal artifacts before creating the release shard directory, then revalidates them against the exact generated manifest before any 1,000-seed shard runs. The finalizer requires all three predecessor paths, and the final attestation embeds their evidence plus exact hashes and revalidates source provenance, profile, manifest, tier/count, seals, and passing results. Focused regressions reject every missing stage, mixed-source or mixed-manifest evidence, a failed canonical artifact re-sealed with passing fields, and a passing attestation re-sealed after an embedded predecessor is removed. The attestation schema identifier remains stable, but predecessor-less historical attestations fail the strengthened validator. No current release artifact is accepted here: the working tree is dirty, no current canonical/10/100/1,000 evidence sequence exists, and no same-source suite receipt or final attestation exists.

## 2026-08-01 12-hour checkpoint — superseded historical handoff

This section is retained only as historical investigation chronology and is superseded by the 2026-08-02 checkpoint above. Its former "current" labels, active blockers, counts, and receipts describe an earlier working tree and must not be used as present-state evidence. The ordered 10/100/1,000 tiers and sealed release attestation remain blocked.

The two deliberately unaccepted planner experiments documented as `V4-RCV-011` and `V4-RCV-012` are no longer present. The hard host-witness expansion was removed, and the topology selector now uses one complete bag-independent viable domain. Those repairs expose a narrower current seed-1 failure in the exact future endpoint domain; they do not retroactively validate the historical seed-0 result or establish canonical success. This checkpoint therefore labels each item **repaired**, **current**, or **historical**. A locally passing assertion proves only the contract named by that assertion; it is not canonical or release evidence.

### Current status at a glance

| ID | Status | Independently reproducible symptom | Established cause or boundary | Resolution unit |
| --- | --- | --- | --- | --- |
| `V4-RCV-011` | **Locally repaired; canonical proof pending** | The simultaneous 2,048 m host-witness obstacles are gone. Seed 1 reaches the real exact future-domain recovery path instead of being rejected by host-only rectangles. | Host feasibility rectangles are no longer treated as exact topology geometry. The separate fail-closed rule still prevents an endpoint seam from waiving a valid `future-route-network-*` reservation. | Preserve this boundary and its focused regressions while resolving the current exact-domain exhaustion under `V4-RCV-008`. |
| `V4-RCV-012` | **Locally repaired; canonical proof pending** | Consumed topology IDs are no longer reintroduced with fabricated singleton `legalIds`; retained candidates keep their original ordinal and RNG/search-variant identity. | One immutable-order, grant-legal, pre-cap-signature-supported viable domain is computed independently of bag consumption and passed once to the bag selector. | Preserve the complete-domain implementation, existing `1/8/12/24` limits, and focused topology/selection tests; re-establish both canonical results without relying on the discarded fallback. |
| `V4-RCV-013` | **Locally repaired; canonical visual proof pending** | Active internal V4 blueprint sockets still invoked the legacy three-mesh `doorway-frame` asset even though structural-frame and V4 arch checks reported boundary-only presentation. | Route-network nodes retained doorway-frame anchors and the materializer forwarded them through a separate assembler path that the sparse-frame assertions did not inspect. | Preserve the V4-authoritative-blueprint assembly filter, fail-closed assembler rejection, and zero-frame visual assertion; execute the canonical browser gate after planning is repaired. |
| `V4-RCV-014` | **Locally repaired; release attestation pending** | The public aggregate helper accepted a caller-provided performance budget, and aggregate validation later recomputed only performance while trusting sealed counts, non-performance gates, `corpusAccepted`, and `result`. | A direct caller could either raise the 10/20/30-second thresholds or re-seal a zero-record failed aggregate as `passed`; the latter could produce an accepted final attestation despite `gates.performance === false`. | The aggregate input no longer accepts a budget. Validation now pins tier/shard topology, requires complete shard summaries for any pass, recomputes record and ordinal coverage, diversity, timing statistics, every gate, and the verdict. Preserve the raised-budget and zero-record/full-gate reseal regressions; focused release evidence and gate suites pass 52/52, but no release attestation exists. |
| `V4-RCV-008` | **Current seed-1 blocker; seed-0 proof incomplete** | The complete ordinary landmark pass evaluates all 24 identities; candidates 1, 9, and 23 produce complete pyramids and are queued because each consumes a mandatory future endpoint domain. Exact recovery is fair and finite, yet Seed 1 still exceeds the unchanged 30-second ceiling without an accepted leaf. | For candidates 1 and 9, the best pairwise-compatible future witness conflicts with exactly one realized internal spine segment and with no pyramid node, inactive cap, or parent attachment. The remaining failure is local spine rerouting/search completeness or ordering, not global-budget exhaustion. | Repair the one-edge recovery/search defect under `V4-RCV-016`, preserve the exact masks and limits, then prove Seed 1 attempt one and Seed 0 parity below budget. |
| `V4-RCV-015` | **Locally repaired; canonical proof pending** | Landmark prospective route checks previously used corridor bodies without the two landing volumes that final `createSegment()` emits. A leaf could pass pairwise/cap/future checks and fail only during commit. | `enforceExactEmittedCoverageVolumes` applied only to objective coverage, leaving landmark spine, wing, and parent candidates with an incomplete collision set. | Preserve stable prospective segment IDs and body-plus-both-landings through pairwise DFS, cap validation, forward checking, and commit. The route-candidate suite passes 28/28 and the cap-planning suite passes 8/8 locally; canonical proof is pending. |
| `V4-RCV-016` | **Active completeness/performance blocker** | FIFO frames now rotate candidates 1, 9, and 23 with `candidateEvaluations` fixed at 24. The ordinary warm start is promoted and endpoint tuples are interleaved by exact reconnect center without loss, but no accepted leaf is reached below 30 seconds. Forced candidate-9 tuples 0 and 20 both retain room pairs and then lose exact internal-spine support. | Fair scheduling and reconnect-center diversity are repaired. Guided recovery carries one selected future-witness reservation while a separately identified unguided branch retains the complete original input. The remaining gaps are local: ordinary failures cannot enter the pair/wing odometer, parent-attachment paths have no continuation axis, and the selected internal-spine conflict is not rerouted within budget. | Retain FIFO/caches, reconnect-center interleaving, distinct guided/unguided inputs, and exact final checking. Add the missing finite axes or a sound one-edge reroute; do not add a local cap or raise any existing limit. |
| `V4-RCV-009A` | **Active performance blocker** | Equivalent AC/exact-support work is repeated across pair scans, while complete collision diagnostics are built for options that are later discarded or rescanned. | Boolean feasibility and detailed failure evidence have different lifetimes, but the hot path still couples them in uncached contexts. | Memoize exact boolean support by complete deterministic context and defer full diagnostics to the selected failure; preserve result, ordering, and hashes. |
| `V4-RCV-009B` | **Active performance/evidence blocker** | The historical 32-40 second, roughly 135-visit candidate is no longer reproducible after the hot-path changes. The current bounded surrogate takes 3.57-5.58 seconds and ends after 71 placement-backtrack visits with zero spine placements. | Candidate isolation is bag-state-sensitive: the debug skip flag bypasses the skipped candidates' bag draws, so jumping directly to the surrogate is not a faithful replay of the full prefix. | Seal a fixture containing the complete accepted prefix, bag states, 484-volume reservation set, and candidate signature before adding an early predicate or suffix memo. Preserve all existing limits. |
| `V4-RCV-010` | **Locally repaired; integration unproved** | A later terminal diagnostic could retain state-selection and path fields from an earlier successful refinement pass. | `objectiveExternalDiagnostics` was reused across passes and `setDiagnostics()` merged with `Object.assign()` without clearing obsolete keys. The working-tree repair now replaces the snapshot. | Preserve the clear-before-assign repair and focused regression; close only after the wider planner/debug suites pass. |
| `V4-RCV-001` | **Locally repaired; integration unproved** | Exact coverage routing previously offered only a 5.6 m endpoint lead, causing a legal 8.4 m-wide turn to clip an authored wall panel. | Route-enumeration asymmetry: the external composer offered 5.6 and 8.4 m, while the exact coverage solver offered only 5.6 m. The authored socket, shell, seam, and mask are correct. | Preserve the new symmetric `[5.6, 8.4]` exact approach set and its focused regression; close only after the full canonical attempt passes. |
| `V4-RCV-007` | **Confirmed dead candidate placement** | `conveyorRoom_bossRoom` candidate 11 still has no legal Through-T-to-inclined-sorter `0 -> 1` pair. | Its only source-clear witness is a same-facing U that penetrates the sorter body and two shell walls. An 8.4 m lead does not make that placement legal. | Deterministically prune/re-place this orientation, or add a genuinely different legal witness. Do not weaken exact masks. |
| `V4-RCV-002` | **Confirmed dead candidate family** | `trapRoom_conveyorRoom` candidate 1 ends with zero support at switchgear-to-lift-defense `2 -> 1`. | Genuine grammar/socket/shape incompatibility; the bounded chain still has budget and does not reach exact evaluation for the impossible pair. | Pre-prune the family or repair its authored physical contract; do not raise the cheap or exact caps. |
| `V4-RCV-003` | **Locally repaired; canonical proof pending** | Finalized inactive room-socket caps now participate in exact socket-assignment backtracking, final candidate validation, and planner-only later-network reservations. | The former collision-lifecycle omission is wired without serializing caps into overlay schema V2 or plan hashes; all eight focused cap tests pass. | Preserve alternate-socket recovery, landmark conflict, cross-network reservation, and final cap/solid disjointness while running wider planner and canonical gates. |
| `V4-RCV-004` | **Acceptance proof blocked** | Seed-0 direct/full parity and seed-1 attempt-one application are not established on the current tree. | Repairs 011/012/003 remove three unsound boundaries, but seed 1 now fails the exact future-domain check under 008 and seed 0 has no post-repair canonical receipt. | Repair 008, bring both canonical planners below budget, then run the two focused integration proofs on the current tree. |
| `V4-RCV-005` | **Visual gate registered but unexecuted** | The two-seed V4 Playwright specification is part of the runtime and release receipt contracts, and its quiet-corridor point must be at least 5.6 m from every boundary. No browser journey or screenshot has completed. | Neither canonical V4 realization is currently available for review. | Run and review both canonical browser journeys after planning/realization passes; registration and stronger assertions are not execution evidence. |
| `V4-RCV-006` | **Release/provenance gate blocked** | No current canonical, 10-, 100-, or 1,000-seed same-source receipt exists. Failed seed workers now publish zero records atomically, and the legacy receipt now requires the real V1 scene Playwright regression, but neither change is a release receipt. | The ordered gate is correctly fail-closed, and a dirty working tree cannot produce official clean-source evidence. | After upstream 008/009/004/005, verify from one clean source identity in canonical -> 10 -> 100 -> 1,000 order and seal every required receipt. |

### `V4-RCV-014` - repaired aggregate budget and verdict bypasses

The release aggregate constructor previously exposed `performanceBudgetMs`, while aggregate validation accepted the sealed budget, summary statistics, and performance gate without recomputing them. A later partial repair recomputed performance but still trusted record/shard counts, coverage, diversity, the other gates, `corpusAccepted`, and `result`. A re-sealed historical release aggregate with zero records and `gates.performance === false` could therefore be relabeled `passed`; with otherwise valid same-source suite receipts, the final attestation also reported `releaseAccepted: true`.

The constructor now always uses the authoritative `10,000/20,000/30,000/180,000 ms` identity and records sealed per-shard result/range summaries. Validation independently recomputes the authoritative tier count and shard topology, shard-hash/range/result coverage, record coverage diagnostics, sample count, median, nearest-rank p95, maximum, diversity frequencies and thresholds, every acceptance gate, and the final verdict. Passing evidence must contain complete shard summaries; historical summary-free evidence remains readable only as failed diagnostics. The focused regressions prove that a supplied budget override is ignored, a re-sealed raised budget is rejected, every mutated gate is rejected, and zero records cannot be promoted to an accepted aggregate or attestation. Release evidence and gate suites pass 52/52; this local repair is not a canonical run, suite receipt, or sealed release attestation.

### V4-RCV-008 — current exact future-endpoint-domain blocker

Current reproduction commands:

```powershell
node scripts/debug-dungeon-augmentation-attempt.mjs --plan-only --compact-failure-summary --candidate-histogram --attempt-limit=1
node scripts/debug-dungeon-augmentation-attempt.mjs --seed=layout:augmentation-realized-v4-001 --plan-only --compact-failure-summary --candidate-histogram --attempt-limit=1
```

#### Seed 0 — historical diagnostic pass, not current proof

- At the historical pre-repair tree, attempt one found all six required networks and passed strict plan validation in about 48.6 seconds.
- `augmentationPlanHash`: `v1-601392a701ebaebd0cbd8df071385a4d`.
- `effectivePlanHash`: `v1-a2121b767e4fa19dcaea474a29f22926`.
- That result used the now-discarded singleton topology fallback documented in `V4-RCV-012` and predates the current exact-domain and cap lifecycle. Its hashes are retained only for chronology.
- The current tree has not re-established seed-0 attempt-one application, direct/full parity, or a sub-30-second result. Do not reuse the historical hashes as current expected values.

#### Seed 1 — current attempt-one blocker

- Seed: `layout:augmentation-realized-v4-001`.
- The complete ordinary landmark pass evaluates all 24 candidate identities. Candidates 1, 9, and 23 produce complete local pyramids, but accepting any of them empties the mandatory future domain at operation ordinal 3. `candidateEvaluations` remains exactly 24; no global-budget exhaustion occurs.
- Historical diagnostic only: the first repaired-tree candidate-9 witness reported that the future `trapRoom_conveyorRoom` endpoint-0 domain lost 190/190 exact candidates while endpoint 1 retained 190/190. That observation exposed the real finite-domain boundary after `V4-RCV-011`/`012`, but it is no longer the current root-cause attribution.
- Exact prospective landmark segments now include both endpoint landing volumes. With that corrected collision set, deterministic FIFO recovery rotates all queued candidate identities instead of draining one candidate until the watchdog. The focused sequence is candidate/tuple `1:0, 9:0, 23:0, 1:1`, with global evaluations unchanged.
- Recovery caches the 24,768-56,160 exact endpoint tuples per candidate. Candidate 1's already successful ordinary endpoint geometry is found at source tuple 8 and promoted to recovery tuple 0 without dropping any tuple. The remaining tuples are then interleaved round-robin by exact reconnect center, retaining every tuple and its original order within each center bucket instead of consuming thousands of same-center orientation variants first.
- Conflict-directed witness evidence is narrower than the historical 190/190 aggregate. For candidates 1 and 9, a pairwise-compatible future trap witness overlaps zero pyramid node volumes, zero inactive-cap volumes, zero parent attachments, and exactly one internal `route-network-spine` segment (segment 5). Guided recovery includes that selected witness as a local-only planning input; the separately identified unguided fallback omits it and preserves the complete original search input. Final cap-inclusive exact forward checking remains authoritative for both branches.
- Forced candidate-9 recovery tuple 0 retains 43 room pairs and tuple 20 retains 47 room pairs, but neither tuple finds exact support for the complete internal spine. This isolates the observed failure downstream of room-pair selection; it does not prove every endpoint tuple or legal pyramid placement impossible.
- The route-candidate suite passes 28/28 and inactive-socket-cap planning passes 8/8 locally. Hard Seed-1 attempt-one probes still exceed 30 seconds without an accepted full leaf, so these focused results are not canonical success evidence.

The smallest remaining Seed-1 repair is a local reroute of the single blocking internal spine edge for candidates 1 or 9, or enumeration/proof of the missing local continuation axes. Preserve the exact guided branch, its distinct unguided fallback, and the repaired reconnect-center interleave so the finite domain remains complete and materially diverse. Do not weaken masks, seams, collision authority, inactive caps, candidate limits, the global bound, or the watchdog.

One validation-stage mismatch encountered immediately before this blocker is locally repaired. A typed zero-distance segment shared by two adjacent authored-station junctions was being treated as an ordinary degenerate route. The validator now accepts only the exact `shared-junction-threshold` contract and still rejects mutated fields, absent kinds, and unknown kinds. The focused acceptance regression passes:

```powershell
node --test --test-name-pattern="V4 accepts only the typed zero-distance threshold shared by adjacent station junctions" tests/dungeon-augmentation-validation.test.mjs
```

Done means seed 0 and seed 1 both pass attempt-one strict plan validation below 30 seconds on the post-011/012/003 tree. Both must preserve canonical progression serialization, solve-order witness integrity, the existing 8/12 candidate limits, cheap/exact caps, global evaluation bound, and watchdog.

### V4-RCV-015 — repaired landmark prospective-volume mismatch

Landmark route selection previously set `enforceExactEmittedCoverageVolumes` to false. Its pair preselector, full spine DFS, inactive-cap check, and future-domain check therefore saw only the corridor body returned by `routePathPlanningVolumes()`. Final `createSegment()` emits that body plus a landing volume at each endpoint. A landing-only collision could pass the bounded search and fail after the solver had already discarded the alternate local witness.

The working-tree repair gives every prospective landmark edge a stable segment identity and uses the exact body-plus-both-landings volume set through pairwise route collision, cap validation, future checking, and commit. An unexpected commit failure in recovery advances the local wing/pair continuation instead of terminating the candidate. The focused landing-only regression is included in the route-candidate suite, which passes 28/28; the cap-planning suite passes 8/8. This closes the isolated mismatch, not either canonical seed.

### V4-RCV-016 — finite landmark-recovery ordering and missing axes

Five independent recovery boundaries are separated here so they can be resolved without changing any global limit:

1. **Repaired fairness:** one recovery entry formerly drained its complete local continuation loop synchronously. Candidate 1 could therefore starve candidates 9 and 23 until the watchdog. Recovery now executes one `planRouteNetwork()` frame, appends its continuation to the FIFO tail, and preserves per-candidate tuple caches, future-domain caches, cycle state, and timing. Continuation frames do not increment the 24 global evaluations or create fake terminal attempt records.
2. **Repaired tuple-order diversity:** each candidate has tens of thousands of complete endpoint tuples, and the original order grouped many same-center grammar/socket variants consecutively. Recovery now promotes the ordinary warm start and then interleaves exact reconnect-center buckets round-robin. Every tuple is retained exactly once, and original order remains stable within each bucket.
3. **Preserved guided/unguided completeness:** the conflict-directed branch carries the selected future-witness reservation as a local-only obstacle and requeues continuations with that same witness. One separately identified unguided fallback per witness signature omits the obstacle, and branch identity participates in cycle detection. The witness never becomes a committed or serialized volume, and final exact forward checking remains authoritative.
4. **Current ordinary/recovery gap:** an ordinary landmark failure cannot use the pair/wing odometer because local continuation is enabled only when a future checker exists. Only an ordinary plan that completes and then empties a future domain is queued. A candidate whose first ordinary pair, wing, or spine fails can still hide a legal later local choice.
5. **Current parent-path gap:** continuation state contains endpoint tuple, room-pair, and wing-choice axes, but no parent-attachment path axis. A later failure can reject a complete room pair without trying another legal parent attachment path.

The ordinary endpoint warm start, reconnect-center interleave, and exact future-witness branch are search-order accelerators only. They remain sound because the distinct complete unguided branch and final cap-inclusive exact forward check are retained. Forced candidate-9 tuples 0 and 20 both reach surviving room pairs but fail to realize an exact complete spine, confirming that the observed blocker is downstream of pair availability. The focused route-candidate suite passes 28/28 and cap planning passes 8/8, but Seed 1 still exceeds 30 seconds. Done means the missing finite axes are either enumerated or proven irrelevant by necessary-condition tests, the blocking spine is rerouted within the existing bounds, and Seed 1 applies on attempt one below 30 seconds without a new cap.

### V4-RCV-011 — repaired host-witness/exact-domain boundary

Historical defect: `stagingReservationsByGrantId` promoted every host `planningRoomReservationRectangle` and `planningRouteReservationRectangle` to simultaneous 2,048 m-tall exact-planner obstacles. Those rectangles jointly witness that the host can allocate staging space, but they do not prescribe the exact topology's final room bodies, shared rooms, or route paths. Seed 1 therefore rejected all 24 pyramid candidates against host-only `room-envelope:*` volumes before the real downstream constraint could be observed.

Current working-tree repair:

- The all-witness `authoredReservationVolumes` expansion is removed. The planner retains only the narrow endpoint envelope and flat-approach staging contract.
- A future volume whose purpose begins `future-route-network-` remains fail-closed: an endpoint seam cannot waive its overlap. The focused regression `endpoint seams never waive a future required-network staging reservation` passes.
- Tentative acceptance now forward-checks the future grant's exact endpoint domain. Exact objective endpoints use the real station center, the 12 outward 2.8 m steps, every real orientation on that ray, full occupied/clearance masks, and only grammars selectable by the real solver; the landmark tangent/fallback branch remains separate.
- The first repaired-tree witness reached pyramid candidate 9 and exposed a historical 190/190 endpoint-0 exhaustion rather than a host-feasibility rejection. The current complete ordinary pass evaluates all 24 identities and queues candidates 1, 9, and 23 for exact recovery; use `V4-RCV-008`/`016` for the current diagnosis.

This item is locally repaired, not canonically closed. Preserve the host/exact boundary and the fail-closed seam rule while repairing `V4-RCV-008`. Do not reintroduce hard host witnesses, shrink their former height, ignore future owners, weaken collision masks, or grant future reservations an endpoint-seam waiver.

### V4-RCV-012 — repaired complete topology-selection domain

Historical defect: `routeNetworkTopologySelectionCandidates()` supplemented a depleted primary result by appending consumed topology IDs under post-hoc singleton `legalIds` and `compatibilityFallback: true`. The resulting refill could validate itself even though the purported legal domain was derived from bag consumption rather than independent physical feasibility. Filtering could also compact retained candidate ordinals and change RNG/search-variant identity. The historical 48.6-second seed-0 result used this discarded behavior and remains non-evidence.

Current working-tree repair:

1. `routeNetworkViableTopologyIds` starts in immutable topology-bag order and retains only IDs accepted by grant legality for which at least one complete **pre-cap** physical signature supports the module count.
2. `dungeonSelectionBagCandidates()` is called once with that complete, bag-independent domain. Every emitted witness uses the same independently computed `legalIds`/`domainKey`; no consumed singleton supplementation exists.
3. Candidate ordinals and default search variants are assigned before later filtering. A retained candidate keeps its original ordinal, RNG fork, and identity instead of being renumbered by compaction.
4. The optional/dense/ordinary/landmark candidate limits (`1/8/12/24`), global evaluation bound, future reserve, cheap/exact caps, immutable parent-bag commit behavior, and serialized hash contracts are unchanged.

Focused topology reachability, route-candidate, and selection-witness suites pass on this implementation, including consumed-domain exhaustion, stacked-interchange feasibility, immutable order/input checks, stored-ordinal identity, and exact serialized `legalIds`. `minimumPrimaryDomainSize`, `compatibilityFallback`, and the fabricated singleton test are gone.

This item is locally repaired, not canonically closed. The current seed-1 failure occurs after the complete-domain selection boundary, and seed 0 still needs a fresh post-repair attempt-one/parity result. Do not use topology-independent endpoint caches or chosen-route results to shrink the viable domain; any additional pruning must be a proved necessary predicate over the complete finite manifest.

### V4-RCV-013 — repaired internal doorway-frame presentation leak

The boundary-indicator contract missed a second V4 frame path: route-network grammar nodes retained `doorway-frame` anchors, the materializer copied them into the assembly overlay, and every active internal module socket could render the legacy three-mesh frame asset. The materializer now retains those anchors only in authoritative source/materialization metadata and strips them from V4 authoritative-blueprint assembly input. The assembler independently rejects any V4 authoritative blueprint that reintroduces one before the frame factory can run, and visual acceptance now requires zero supplemental `frame` asset roots.

The expanded focused presentation set passes 96/96. V1-V3 committed replay hashes still pass, and the real V1 Three.js connector scene passes with arch plan/render parity and service cadence intact. This is local repair evidence only: canonical V4 planning still prevents the two browser journeys and screenshots from proving the zero-frame result in realized layouts.

### V4-RCV-009A — repeated exact-support work and eager diagnostics

One duplicated cost is already repaired: the first `expandCoveragePlacement` pass establishes only endpoint/module indices, but previously ran the full external composer with generic 19.6 m depths and then discarded the result. It now uses the cheap provisional skeleton; grammar-aware refinement still runs the authoritative composer, masks, seams, obstacles, and unchanged windows. The focused objective-coverage tests remain 6/6. The representative six-module keycard candidate 10 fell from roughly 9.8-11.9 seconds to 3.3-4.6 seconds with the same result and search behavior. The historical singleton-topology fallback test described in `V4-RCV-012` has been removed and was never performance or release evidence.

The remaining measured hot path is pairwise arc consistency: it scans Cartesian node-placement pairs and repeatedly invokes exact physical-route support. Equivalent uncached contexts eagerly build obstacle diagnostics against hundreds of prior volumes and later rescan or sort the same blocked options.

Use `node scripts/debug-dungeon-augmentation-attempt.mjs --plan-only --candidate-summary --filter= --brief-candidate-summary --attempt-limit=1` and retain each record's `planningPhaseTimings`. The isolated repair is to cache boolean support separately from detailed failure evidence, construct full diagnostics only for the selected best failure, and ensure every key includes the complete geometry, socket, reservation, seam, and mask context. No timing, cache key, or hit count may enter a serialized plan or replay hash.

Done means the focused fixture returns the identical candidate result, deterministic order, failure identity, and replay hash while equivalent exact pairs are evaluated once per complete context. The end-to-end performance gate remains part of `V4-RCV-009B`/`V4-RCV-006`.

### V4-RCV-009B — bounded placement-backtrack surrogate and missing faithful fixture

The former full trace contained a 32-40 second placement-backtrack failure at about 135 recursive visits. That witness is historical: after the current hot-path changes it is no longer reproducible, so it must not be used as the present optimization target or timing baseline.

The current bounded surrogate is precisely identified as follows:

- Accepted prefix: pyramid candidate 15 -> conveyor candidate 4 -> trap candidate 3 -> enemy candidate 3.
- Target: `keycardRoom_trapRoom` candidate 8, six modules, `slope`, `over-under-loop`, and `stacked-interchange`.
- Prior reservation state: 484 volumes, signature `v1-99753f6ac16752a585508c5f7ff1ca63`.
- Current result: 71 placement-backtrack visits, zero spine placements, and about 3.57-5.58 seconds.

This surrogate is bounded and useful, but it is not yet a faithful standalone reproduction. The debug skip flag bypasses skipped candidates before their selection-bag draws, so using it to jump to candidate 8 changes the bag state and can change the candidate manifest. A release-quality fixture must replay the accepted prefix and every prior draw, or directly restore the exact bag states and 484-volume reservation snapshot. Once sealed, add only a proved necessary-condition rejection or context-complete suffix memo. Done means that fixture preserves its stable result and evidence, seed 0 falls below the 30-second maximum, and the canonical median/p95/max gates pass. Proved dead-family pruning remains independently owned by `V4-RCV-002` and `V4-RCV-007`.

### V4-RCV-010 — stale external-composer diagnostics

`objectiveCoverageExternalPlacement()` writes to a caller-owned diagnostics object. The same `objectiveExternalDiagnostics` object is reused across refinement passes. Previously, `setDiagnostics(stage, details)` performed only `Object.assign`, so a later `gap-options-empty` result could retain keys such as `stateCount`, `selectedStateIndex`, `bestStateSocketPairs`, or composed-path data from an earlier `composed` pass.

This does not change planner geometry, but it can send an engineer to the wrong phase and invalidate watchdog/failure evidence. The working-tree repair deletes every prior own key before assigning the new snapshot. The focused regression `objective external terminal diagnostics replace stale refinement fields` passes and proves that an `insufficient-input` terminal record cannot retain composed-state fields. Wider planner/debug integration is still required before closing the item.

```powershell
node --test --test-name-pattern="objective external terminal diagnostics replace stale refinement fields" tests/dungeon-augmentation-route-candidate-performance.test.mjs
```

### V4-RCV-001 — turn-safe exact endpoint approaches

Focused cause:

- Authored blueprint sockets are centered in their boundary floor cells, 1.4 m inside the physical wall plane.
- A full 8.4 m corridor turning after only the minimum 5.6 m lead reaches 4.2 m back from its centerline to the wall plane. Against the 0.22 m panel, the exact collision is a real 0.11 m overlap.
- The exact objective-coverage solver previously enumerated only `[5.6]`; the external composer already enumerated `[5.6, 8.4]`.
- Moving the socket, broadening the seam, excluding the panel, or weakening the destination mask would hide real assembled geometry and is not an acceptable repair.

Working-tree repair and evidence:

- `objectiveCoverageRouteApproachMeters()` now returns the shortest legal lead first and one tile-aligned extension: `[5.6, 8.4]`.
- Both exact source and destination coverage routes use that helper.
- The real Through-T/inclined-sorter regression proves the 5.6 m turn hits `blueprint-structural-shell-north-panel-0-clearance`, while an 8.4 m candidate clears both endpoint masks and ends with the required 8.4 m lead.
- The focused `objective exact routing retains a turn-safe approach beside an authored shell` regression passes.
- With only this planner change, the canonical `conveyorRoom_bossRoom` search now finds candidate 4: four modules, `lift`, `parallel-gallery-loop`, `over-under-crossover`, error `null`.

This closes the pair-level defect but not the canonical release gate; `V4-RCV-008` is the current end-to-end blocker.

### V4-RCV-007 — candidate 11 is a different, legitimately impossible U-placement

The earlier handoff incorrectly treated candidate 11 as proof that only a longer endpoint lead was required. Current exact tracing separates the two defects:

- Layout: Through-T -> inclined sorter -> switchgear-cache -> Through-T.
- Edge `0 -> 1`: 33 exterior paths, one source-mask-clear path, zero destination-mask-clear paths.
- The only source-clear pair runs from `{5.6, 0, 340.2}` facing `+X` to `{11.2, 0, 348.6}` also facing `+X`, producing a same-facing U.
- Both `[5.6]` and `[5.6, 8.4]` collide with the same sorter-owned geometry: `blueprint-mask-body-4`, `blueprint-structural-shell-north-panel-0-clearance`, `blueprint-structural-shell-west-panel-0-clearance`, and `blueprint-mask-body-3`.

The 8.4 m regression in `V4-RCV-001` is therefore valid without making candidate 11 legal. Candidate 11 should either receive a different orientation/placement domain witness or be rejected earlier by a deterministic feasibility rule. Add a negative regression naming all four exact conflicts before changing this family.

### V4-RCV-002 — dead `trapRoom_conveyorRoom` candidate family

Reproduction:

```powershell
node scripts/debug-dungeon-augmentation-attempt.mjs --plan-only --single-grant-plan=trapRoom_conveyorRoom --modules=5 --topology=parallel-gallery-loop --junction=fork-merge --elevation=lift --variant=1 --compact-failure-summary
```

Evidence:

- Error: `route-network-adjacent-domain-exhausted`.
- Suffix repair reaches `4 -> 3` (`24 -> 47` prefixes), `3 -> 2` (`47 -> 54`), and `2 -> 1` (`54 -> 0`).
- The impossible final pair scans 563 bounded candidates and produces no legal extension.
- Total cheap evaluations are 6,481, below the unchanged 16,384 cap; no exact evaluation is reached for the zero-support pair.

The former fairness bug is already repaired: every predecessor samples the existing deterministic 64-item head/middle/tail window before expensive predicates. What remains is a real switchgear-to-lift-defense physical incompatibility. Pre-prune it, or repair the authored socket/shape contract with a pair-level regression.

### V4-RCV-003 — repaired inactive-socket cap lifecycle

Historical defect: assembler-equivalent cap AABBs could be derived for inactive physical room sockets, but the planner did not consume them. A plan could therefore choose a route, landmark solid, or later network through geometry that the assembler would close with a solid cap.

Current working-tree repair:

1. Exact socket-assignment leaves derive caps only for finalized physical `supplementRoom` nodes; connector-owned proxies do not emit room caps, and exact claimed/topology-return sockets remain active.
2. Each assignment validates caps against static avoidance, every selected node mask, parent attachment paths, and committed spine route volumes. `route-network-inactive-socket-cap-overlap` rejects that assignment with deterministic conflicts so another socket assignment can be tried.
3. Final candidates recompute and validate the room caps against planning avoidance plus finalized node, segment, and landing volumes.
4. Accepted caps are projected into planner-only cross-network reservations for later networks. They remain absent from overlay schema V2, presentation records, and plan hashes.

`tests/dungeon-augmentation-inactive-socket-cap-planning.test.mjs` now passes 8/8. The suite covers cardinal assembler dimensions, active/claimed exclusion, deterministic obstacle and cap-pair conflicts, alternate-socket recovery, landmark-loop conflict, later-network reservation, and deterministic final disjointness from every non-owning solid. The file is registered in the canonical unit manifest.

This closes the isolated lifecycle defect but not the release gate. Preserve these eight contracts during seed-1 geometry repair and prove them again in the wider planner, determinism, canonical, and realized suites.

### V4-RCV-004 — canonical parity and seed-1 attempt-one proof

The intended focused tests are:

```powershell
node --test --test-name-pattern="canonical seed0 direct and full replay" tests/dungeon-augmentation-industrial-host-coverage-allocation.test.mjs
node --test --test-name-pattern="canonical seed1 keeps a useful landmark\+objective coverage partial" tests/dungeon-augmentation-industrial-host-coverage-allocation.test.mjs
```

They are not current evidence. The 48.6-second seed-0 result is historical, over budget, and used the removed `V4-RCV-012` fallback. On the current tree, Seed 1 evaluates all 24 ordinary landmark identities, queues candidates 1, 9, and 23 for exact recovery, and still exceeds 30 seconds without an accepted leaf. The best current candidate-1/9 future witness conflicts with one internal spine segment and with no node, inactive cap, or parent attachment; the earlier candidate-9 190/190 report is historical diagnostic context, not the present root-cause claim. Repairs `V4-RCV-011`, `V4-RCV-012`, `V4-RCV-015`, and `V4-RCV-003` must remain in place. When unblocked, parity must compare the same accepted-parent snapshot, seed, grants, selection manifest, solve-decision witness order, reservation state, candidate order, hashes, and trace. Release still requires attempt-one application even if a matching stable rejection is useful diagnostic parity.

### V4-RCV-005 — visual acceptance is release-gated but unexecuted

`tests/dungeon-augmentation-visual-acceptance.spec.js` passes syntax checking and Playwright discovery for seeds 000 and 001. It is now included in `test:dungeon-augmentation:runtime` and in the required Playwright release-receipt contract. The quiet-corridor sample must be at least two tiles (5.6 m) from every boundary, and the test fails explicitly when no such sample exists.

No V4 browser run or screenshot artifact exists because neither canonical realization is currently available. After planning succeeds, verify camera staging, cover and machinery presentation records, zero duplicate presentation paths, zero V4 arches, one boundary indicator per distinct granted parent socket, and the <=2 draw-call boundary budget in both canonical journeys. Registration and stronger assertions are not execution evidence.

### V4-RCV-006 — release tiers and provenance remain blocked

Older aggregates and the historical issue list below are not evidence for the current tree. After the current defects are closed:

1. Run focused/unit suites, immutable V1-V3 replay, and the release-gated real V1 connector/decorative-arch scene regression.
2. Verify from one clean copy or intentional commit without altering unrelated dirty work.
3. Run canonical probes, then 10, 100, and 1,000 seeds strictly in order.
4. Seal browser/lifecycle receipts from the same git/source/profile identity.

### Locally implemented release-worker and legacy-receipt reliability — not planner closure

The current source pins both warm-up and target generation to one realization attempt, persists phase heartbeats through watchdog termination, and retains captured planning/assembly metrics when post-generation validation fails. It also repairs an atomic-publication defect: a generated `unchanged` result was previously assembled and pushed as a record before the applied-count assertion failed, so a failed worker could contain one record even though failed workers are required to contain zero.

`inspectReleaseSeedWorkerRecordPublication()` now publishes exactly one record only for `applied`. An `unchanged` result becomes a diagnostic failure with its rejection codes, messages, attempts, elapsed phases, and generator timings preserved but `record: null`; the verifier's failed-artifact path always emits `records: []`, including failures raised after local record assembly. A passing worker must also end on a persisted target-disposal heartbeat whose six-phase totals and planning/assembly metrics exactly match its record. Failed worker and shard validators bind their timeout phase and generator timings to the captured heartbeat, so deleting or rewriting those fields cannot produce valid resealed evidence. Focused release-evidence tests cover applied publication, unchanged rejection with diagnostics, terminal-heartbeat parity, and sealed zero-record failed-worker validation.

For an unchanged authored-base fallback, those generator timings are now resolved without relying on the absent top-level `augmentationMetrics`: planning comes from the final rejected attempt, and assembly comes from the completed generator event observed for that same attempt. The observer resets on every new planning start, and any incomplete/non-finite metric remains a failure rather than being rewritten to zero. The focused regression carries these exact values through the unchanged publication decision into a valid sealed zero-record failed worker.

The immutable legacy receipt is also stronger: its contract now includes `tests/dungeon-connector-runtime.spec.js --workers=1`, a real V1 Three.js scene regression for signed vertical galleries, classic corridors, ladders, lifts, track traps, and decorative arches. A focused release-evidence test rejects a legacy receipt that omits this command. The Playwright scene has not been executed as a current same-source receipt.

These behaviors prevent the release harness from hiding repeated runtime attempts, publishing a contradictory failed record, losing the phase that consumed the watchdog, or treating renderer-free V1 fixtures as complete scene proof. They do not repair `V4-RCV-008` or constitute a release receipt.

```powershell
node --test --test-name-pattern="manifest seed-worker publication|actual unchanged generator fallback|unchanged manifest results|release warm-up and target generators|synthetic watchdog timeouts|post-generation strict-validation failures|successful workers require terminal|failed workers require zero records|failed shards bind timeout|release receipts require" tests/dungeon-augmentation-release-evidence.test.mjs
```

The focused worker-publication, watchdog/metrics, release-gate, and legacy-receipt assertions pass on the current tree. End-to-end shard, aggregate, browser, and same-source receipt evidence remains blocked by `V4-RCV-004` through `V4-RCV-006`.

### Recommended independent work order

1. Preserve the completed `V4-RCV-011` host/exact-boundary repair, its fail-closed seam rule, and the completed `V4-RCV-012` bag-independent topology domain.
2. Preserve `V4-RCV-015` exact prospective-volume parity and `V4-RCV-003` inactive-cap lifecycle; keep the passing route-candidate 28/28 and cap-planning 8/8 contracts intact.
3. Repair `V4-RCV-008`/`016`: reroute the one internal spine segment that conflicts with the best candidate-1/9 future witness, or enumerate/prove irrelevant the missing ordinary-local and parent-path continuation axes. Forced candidate-9 tuples 0 and 20 retain room pairs but fail exact spine realization, so pair absence is not the current cause. Preserve FIFO fairness, warm-start promotion, reconnect-center interleaving, distinct guided/unguided inputs, exact final checking, and every existing limit and mask.
4. Preserve the locally verified diagnostic-integrity repair (`V4-RCV-010`) and fix the remaining hot paths (`V4-RCV-009A` and `V4-RCV-009B`) so failures and successes are both trustworthy and bounded. Prune the proved dead families in `V4-RCV-002` and `V4-RCV-007` only through necessary-condition checks.
5. Re-establish both canonical results and `V4-RCV-004`, then run focused canonical, V1-V3 replay, real V1 scene, determinism, release-worker, and performance suites.
6. Execute the V4 browser journeys under `V4-RCV-005`.
7. Produce clean-source `V4-RCV-006` evidence in canonical -> 10 -> 100 -> 1,000 order.

Do not classify the following as current root causes: accepted-parent loading, Three.js rendering, sparse presentation density, an incorrectly authored inclined-sorter socket, an incorrectly derived shell panel, absent room pairs, or an exhausted cheap-search/global cap. The current exact checker shows that the best candidate-1/9 future witness conflicts with exactly one internal spine segment and with no node, inactive cap, or parent attachment. It does not prove that every legal pyramid placement, route, or correctly modeled future-domain witness is physically impossible; the candidate-9 190/190 report is historical context only. Historical validator `ISSUE-001` through `ISSUE-175` below describe an older realized witness and must be re-run before any one of them is treated as current.

## Superseded 2026-08-01 engineering handoff (before the turn-safe repair)

This section is retained for chronology only. Its statement that all 12 `conveyorRoom_bossRoom` candidates fail is no longer current; use the 12-hour checkpoint above. Any remaining present-tense wording in this section describes that superseded checkpoint, not the current tree.

### Historical status at that checkpoint

| ID | Kind | Symptom at that checkpoint | Established cause or boundary | Independent next action |
| --- | --- | --- | --- | --- |
| `V4-RCV-001` | Confirmed planner blocker | Canonical seed 0 returns `unchanged` after one attempt; planning alone reports about 56.96 seconds. | The mandatory `conveyorRoom_bossRoom` grant loses both endpoint domains on its constrained `0 -> 1` edge. Exact destination shell-mask clearance, not seed loading, materialization, rendering, or a search-budget limit, is the current boundary. | Audit the Through-T to inclined-sorter destination entry mask and approach geometry as a self-contained planner task. |
| `V4-RCV-002` | Confirmed dead candidate family | `trapRoom_conveyorRoom` candidate 1 rejects with `route-network-adjacent-domain-exhausted`. | The bounded solver reaches the final suffix with budget remaining, but the switchgear-to-lift-defense `2 -> 1` pair has zero legal support. | Either prune this family before exact search or correct its authored socket/shape compatibility; do not raise caps. |
| `V4-RCV-003` | Incomplete collision lifecycle | Exact inactive-socket cap volumes exist and pass isolated tests, but the planner does not consume them. | The derivation/validator module is not wired into candidate acceptance or cross-network reservations. | Integrate caps after sockets are finalized, reject cap conflicts, and reserve accepted caps for later networks without serializing them. |
| `V4-RCV-004` | Blocked acceptance proof | Seed-0 direct/full parity and seed-1 attempt-one application are not established on the current tree. | The canonical planner blocker occurs before either acceptance claim can be sealed. | Re-run the two focused integration tests only after `V4-RCV-001`; record equal acceptance or equal stable rejection for seed 0. |
| `V4-RCV-005` | Unexecuted visual gate | The two-seed visual specification parses and is discoverable, but no browser journey or screenshot evidence has completed. | Canonical augmentation is not applied. The quiet-corridor screenshot assertion is also too weak to prove a genuinely internal view. | Run after canonical planning/realization passes; strengthen the boundary-distance assertion before accepting the quiet-corridor capture. |
| `V4-RCV-006` | Release/provenance gate | No current canonical, 10-, 100-, or 1,000-seed evidence exists. | The ordered gate is correctly fail-closed at canonical planning, and the current dirty source cannot produce an official clean-source attestation. | Verify from a clean copy/commit after issues 001-005, then run canonical -> 10 -> 100 -> 1,000 in order. |

### V4-RCV-001 - canonical seed 0 fails at `conveyorRoom_bossRoom`

Reproduction:

```powershell
node scripts/debug-dungeon-augmentation-attempt.mjs --plan-only --compact-failure-summary --candidate-histogram
```

Result at that checkpoint:

- Seed: `layout:augmentation-realized-v4-000`.
- Status: `unchanged`; augmentation produces no committed operations, rooms, or segments.
- Search-budget status: not exhausted.
- Measured planning time in the latest unrestricted run: `56,960.4952 ms`, already above the 30-second release maximum even though the plan rejects.
- Pyramid candidate 15 plans successfully. Planning then reaches the mandatory `conveyorRoom_bossRoom` coverage grant.
- All 12 bounded candidates for that grant fail: five with an adjacent-domain rejection and seven with a parent-attachment-domain rejection.
- The final constrained `0 -> 1` edge reports node-domain counts `[0, 0, 64, 24]` for the selected four-node layout.
- The representative failing layout selects Through-T, inclined sorter, switchgear-cache descent, and Through-T grammars. Its Through-T-to-inclined-sorter edge produces 33 raw/exterior route paths; one clears the source shell mask and none clears the destination shell mask.

Cause boundary:

- This is an exact destination entry shell-mask/approach incompatibility in the planner's candidate geometry.
- It is not the historical accepted-parent loading problem, not Three.js assembly, not presentation density, and not the correlated cheap-search cap.
- The exact mask and final validator must remain authoritative. Broadening overlap grants or weakening the destination mask would hide the defect rather than repair it.

Smallest repair unit:

1. Isolate the `0 -> 1` Through-T-to-inclined-sorter pair and report which destination shell panels reject the 33 path candidates.
2. Determine whether the authored inclined-sorter entry socket, its shell-panel derivation, or the approach offset is inconsistent.
3. Correct that one contract while preserving exact socket identity, tier, seam, and final route-volume validation.
4. Add a focused pair-level regression before re-running the unrestricted canonical seed.

Done means seed 0 either applies on attempt one or returns the same stable rejection through both direct and replay paths, within the performance budget and without a cap increase.

### V4-RCV-002 - dead `trapRoom_conveyorRoom` candidate family

Reproduction:

```powershell
node scripts/debug-dungeon-augmentation-attempt.mjs --plan-only --single-grant-plan=trapRoom_conveyorRoom --modules=5 --topology=parallel-gallery-loop --junction=fork-merge --elevation=lift --variant=1 --compact-failure-summary
```

Result at that checkpoint:

- Error: `route-network-adjacent-domain-exhausted`.
- The suffix-oriented repair order reaches `4 -> 3`, `3 -> 2`, and then `2 -> 1`.
- `4 -> 3`: prefixes `24 -> 47`, 1,420 scanned candidates, 121 legal extensions.
- `3 -> 2`: prefixes `47 -> 54`, 1,920 scanned candidates, 128 legal extensions.
- `2 -> 1`: prefixes `54 -> 0`, 563 scanned candidates, zero legal extensions.
- The chain uses 6,481 cheap evaluations, below the unchanged 16,384 cap. No exact evaluation is reached for the impossible final pair.

Cause boundary:

The remaining failure is genuine switchgear-to-lift-defense geometry/socket-shape incompatibility. Earlier runs incorrectly presented it as cheap-budget exhaustion because each predecessor scanned an effectively unbounded post-prefilter pool. That fairness defect is fixed: each predecessor now samples the existing deterministic 64-candidate head/middle/tail window before expensive predicates. Collision, injectivity, socket, route-clearance, and exact predicates were not weakened, and no search limit was increased.

Smallest repair unit:

- Preferred: add deterministic feasibility pruning so this known zero-support grammar/topology/elevation combination is never offered as a viable global candidate.
- Alternative: if the family is intended to be legal, repair its authored socket or shell shape and prove the pair with a focused exact-mask test.
- Do not force candidate 1 to succeed merely because it is ordinal 1; the global solver may choose a later legal candidate.

### V4-RCV-003 - inactive socket caps are derived but not reserved

Implemented but not integrated:

- `src/dungeon-augmentation/routeNetworkCapPlanning.js` derives the assembler-equivalent cap AABB for each inactive physical room socket and validates cap-to-obstacle and cap-to-cap overlap deterministically.
- `tests/dungeon-augmentation-inactive-socket-cap-planning.test.mjs` passes 4/4 for all cardinal walls, active/claimed socket exclusion, owner-volume exclusion, deterministic conflict evidence, and cap-pair rejection.
- The derivation mirrors the assembler's `width`, `height`, wall-plane center, and `wallThickness * 1.18` dimensions.

Missing lifecycle wiring:

1. After `planRouteNetwork` finalizes socket states and node kinds, derive caps only for physical `supplementRoom` nodes. Connector proxy nodes do not emit solid room-cap collision in complete assembly and must not receive these reservations.
2. Validate caps against immutable/protected volumes, prior accepted-network reservations, every other node, parent attachments, committed route spans, landings, and topology-return spans. Ignore only the cap's owning room volume.
3. Reject/backtrack the current candidate with `route-network-inactive-socket-cap-overlap` and deterministic conflict evidence when any cap conflicts.
4. Append accepted cap volumes to planner-only `acceptedPlanningVolumes` so later route networks cannot cross them.
5. Keep the cap volumes out of overlay schema V2 serialization and plan hashes.

Missing integration regressions: alternate-socket recovery, landmark-loop cap collision, later-network reservation, and final cap/solid disjointness.

### V4-RCV-004 - canonical parity and seed-1 attempt-one proof are blocked

The intended focused tests exist in `tests/dungeon-augmentation-industrial-host-coverage-allocation.test.mjs`:

```powershell
node --test --test-name-pattern="canonical seed0 direct and full replay" tests/dungeon-augmentation-industrial-host-coverage-allocation.test.mjs
node --test --test-name-pattern="canonical seed1 keeps a useful landmark\+objective coverage partial" tests/dungeon-augmentation-industrial-host-coverage-allocation.test.mjs
```

They are not current passing evidence. Seed 0 cannot provide accepted-plan parity while `V4-RCV-001` rejects its direct plan. Seed 1 has not been re-established after the endpoint-mask and bounded-chain changes. The older 377-second seed-1 `trapRoom_conveyorRoom` diagnosis below remains historical until the current focused test is rerun.

When unblocked, parity evidence must compare the same accepted-parent snapshot, plan seed, grants, selection manifest, reservation state, candidate ordering, plan hash, and candidate trace. A matching stable rejection is acceptable diagnostic parity, but release still requires attempt-one application.

### V4-RCV-005 - visual acceptance is statically valid but unexecuted

`tests/dungeon-augmentation-visual-acceptance.spec.js` currently passes syntax checking and Playwright test discovery for seeds 000 and 001. Static audit found its URL seed convention, runtime field paths, V4 plan filtering, boundary/presentation user-data names, mesh names, draw-call accounting, profile revision, and realization-ledger lookups consistent with current production code.

Outstanding risks:

- No browser run or screenshot artifact exists because neither canonical seed is known to apply.
- Camera staging may be affected by wall occlusion/culling once real geometry exists.
- The suite assumes both seeds contain at least one cover and one machinery presentation record.
- The global `industrialCargo*` absence assertion may need to distinguish an actual duplicate rendering path from any independently legitimate authored cargo.
- The quiet-corridor capture chooses the best internal point but asserts only `nearestBoundaryMeters > 0`. A point immediately beside a boundary can pass, so the screenshot does not prove a visually quiet internal corridor. Require a meaningful minimum distance based on the corridor/indicator footprint before accepting that artifact.

The global zero-V4-arch assertions still provide a useful structural check; they do not replace the missing rendered screenshot review.

### V4-RCV-006 - release tiers and clean-source evidence remain blocked

Do not interpret any older aggregate, zero-record fallback boolean, or historical canonical witness below as current evidence. The source has changed substantially and is dirty. After the independent defects above are closed:

1. Verify the current focused/unit suites and immutable V1 replay.
2. Create a clean verification copy or intentional commit without altering the user's dirty worktree.
3. Run the canonical seed probes.
4. Run the 10-seed tier only if canonical passes.
5. Run the 100-seed tier only if 10 passes.
6. Run the 1,000-seed tier only if 100 passes.
7. Run and seal browser/lifecycle receipts from the same source identity.

The current measured seed-0 rejecting plan is slower than the 30-second maximum, so correctness alone is not enough; timing must be remeasured after the planner defect is repaired.

### Work completed during this investigation

The following changes are present in the working tree and should be preserved while the issues above are separated:

- Exact endpoint shell-mask and route-volume parity between composer preselection and exact planning.
- Tier-aligned composer connector paths and exact stored connector slices.
- RN3 false-ceiling correction, trap lower-floor escapability, bonus-vault bypass repair, and collision-hint preservation without replaying a colliding path.
- Suffix-oriented correlated-chain repair and the deterministic bounded predecessor scan described in `V4-RCV-002`.
- Existing focused regressions for endpoint composition, suffix reversal, and late-witness retention.
- Sparse boundary-indicator and presentation-record implementation; its focused presentation suite previously passed 80/80, but browser acceptance remains outstanding.

Latest focused checks after the bounded-scan change:

- `node --check src/dungeon-augmentation/planner.js`: pass.
- Route-candidate performance suite: 14/14 pass.
- Topology/blueprint reachability focused suite: 49/49 pass.
- Inactive-socket cap derivation suite: 4/4 pass.
- Visual acceptance spec syntax and Playwright discovery: pass; browser execution not run.

These checks prove only their named units. They do not override the canonical planner rejection.

## 2026-08-01 10/100/1,000 corpus execution - blocked in ordinal 1 warm-up planning

Historical evidence for the source identity recorded below; the current dirty-working-tree diagnosis is the engineering handoff above. The three canonical corpus views were attempted against one completed, immutable 1,000-parent manifest. This was diagnostic evidence, not a release attestation; the generated evidence block above remains conservative until a full release aggregate and all five same-source suite receipts can be sealed.

### Shared evidence identity

- Profile: `industrial-supplement-preview-v4` revision 5, profile hash `sha256-ddd298625970857199d065fedf2bea91dd49c36b19539b03f9e85ac49ca63177`.
- Git commit: `5d1510eeef410197d62105123e1fc1350ce93446` on `codex/dungeon-generation-pivot-20260721`.
- Release source hash: `sha256-8f2fee17625c9b1ee7e06bd895910dab8a07f701f516557b55f6361aef0b43c9`; `sourceDirty: false`.
- Manifest: `accepted-parent-manifest-1000.json`, exactly 1,000 accepted parents, evidence hash `sha256-2ff80971c5c356757f364bdbfd8feba465ac6ac08ecf5756593ba90725484f0c`.
- Machine: Windows x64, Node `v24.17.0`, AMD Ryzen 7 9800X3D, 16 logical CPUs, 33,453,711,360 bytes of memory. This matches the named release reference machine.
- Artifact root: `artifacts/dungeon-augmentation-v4-release/sha256-1659a4482527868e2b2f33c9e56e171427b01b8fe0a6722e0ca19b3bc5a06cec`.

### Stage results

| Tier | Canonical topology | Executed evidence | First failure | Aggregate result | Evidence hashes |
| --- | --- | --- | --- | --- | --- |
| Smoke | 1 shard x 10 ordinals | Shard 0 attempted; 0/10 records completed | Target ordinal 0 worker exceeded the fixed 180,000 ms watchdog while prerolling warm-up ordinal 1, `layout:augmentation-realized-v4-001` | Failed: `shardResultsPassed`, `exactRecordCoverage`, and `performance`; shard topology and ordinal range were otherwise exact | Shard `sha256-2b9fa42cac6516945dfd248b8196f554aab609d89af81847930c41481d483fc8`; aggregate `sha256-838d68b4123a7e863f88419dc50905e54d56665b62aed3514d4f649ba045c2a8` |
| Normal | 10 shards x 10 ordinals | Shard 0 attempted; 0/100 records completed; shards 1-9 were stage-gated | Same target-0 worker timeout during ordinal 1 warm-up planning | Failed: `shardResultsPassed`, `exactShardTopology`, `exactOrdinalCoverage`, `exactRecordCoverage`, and `performance` | Shard `sha256-b3ea11f4d79653fe087d64b9c0e0cccffb08885ea6ceaced77ba721801c87685`; partial aggregate `sha256-326f44830588fc6cba826ba80f54959e187ce31cf202529275e87453ff13b49a` |
| Release | 20 shards x 50 ordinals | Shard 0 attempted; 0/1,000 records completed; shards 1-19 were stage-gated | Same target-0 worker timeout during ordinal 1 warm-up planning | Failed: `shardResultsPassed`, `exactShardTopology`, `exactOrdinalCoverage`, `exactRecordCoverage`, and `performance` | Shard `sha256-153e39e94a49eb294619a7a96639f2d380bde3382b2d95aa277b1993058d3f64`; partial aggregate `sha256-a57d77ef8fba556d0fad9c7c837e583df21d8d91a1a0f69850cb06e0b5527148` |

All three historical aggregates passed clean-source provenance and reference-machine checks. Their zero-record fallback, first-realization, release-validation, strict-realized-validation, parent-parity, and diversity booleans are vacuous and must not be interpreted as seed-level passes. The release aggregator now requires exact, nonempty record coverage before any seed-level gate can pass. No geometry, traversal, coverage, variety, or fallback claim can be made for the uncompleted records.

### Execution and workflow diagnosis

- The accepted parent manifest is not the blocker: both canonical parents load consistently with their stored parent witnesses. A target-ordinal-0 worker always runs ordinal 1 as its same-process warm-up before target timing begins.
- Ordinal 1 fails in route-network planning before supplemental materialization or Three.js assembly. Its first planning attempt takes roughly 44-58 seconds; because the historical release worker inherited the gameplay default of eight realization attempts, it repeated that failure until the 180-second watchdog killed the process. The target ordinal 0 generation never began.
- A standalone seed-1 run took roughly 377 seconds and returned the authored parent unchanged. Its stable root rejection was `route-network-node-placement-collision` in the mandatory `trapRoom_conveyorRoom` coverage grant after the global solver exhausted its search. This is not a seed-loading failure and no supplemental frames or authored arches were rendered on the failing path.
- Seed 0's direct planner accepts a plan, while the full replay path reports `planning-failed`. Direct and replay planning must consume the same committed host snapshot, plan seed, grants, selection manifest, reservation state, and candidate ordering before this can be accepted as deterministic parity.
- Release warm-up and target generators are now explicitly capped at one realization attempt. Durable phase heartbeats and failed-shard timeout-phase fields preserve the last active phase even when the watchdog kills the child; successful records retain generator, strict-validation, disposal, and existing planning/assembly timings.
- Smoke leaves ordinals 0-9 unverified. Normal leaves ordinals 0-99 unverified after its first shard fails. Release leaves ordinals 0-999 unverified after its first shard fails. These are explicitly unexecuted/stage-gated ranges, not passing coverage.
- Building the immutable parent manifest itself completed successfully, but required about 81 minutes on the reference machine. An earlier 30-minute command-harness attempt stopped without publishing a partial artifact.
- The top-level tier wrapper then attempted to rebuild the already valid manifest instead of reusing it and hit a separate one-hour command-harness limit at parent 718. That interruption occurred before smoke seed execution and did not alter the sealed manifest. Direct canonical shard commands were used afterward to obtain the three immutable timeout failures above.
- Running later shards concurrently cannot close this gate and would contaminate performance measurements with machine contention. Canonical seed-0 parity and seed-1 attempt-one application must pass first, followed in order by the 10-, 100-, and 1,000-seed corpus views. The complete tiers must be regenerated from a new same-source evidence root after release-source changes.

### Release consequence

The V4 release remains blocked. No release receipts or final attestation were generated, and the historical 175-record register remains open. This corpus attempt establishes a reproducible performance/execution blocker; it does not establish closure or recurrence of any individual historical geometry record.

The dated canonical witness below predates the subsequent shared seam-lattice correction and is retained as historical diagnostic context. Its four wrong-seam-side records must not be read as the current corpus failure; the current corpus worker times out before it can publish a replacement strict realized record.

## Historical canonical validator witness — release blocked

Verified 2026-07-31 against profile `industrial-supplement-preview-v4` revision 5 and deterministic seed `layout:augmentation-realized-v4-000`.

- Augmentation status: **unchanged** (atomic authored-parent fallback).
- First-realization acceptance: **failed during materialization after successful planning**.
- Planner final-graph validation: **passed**.
- Invalid-alpha bypass used: **no**.
- Materialization diagnostics: **4 `DUNGEON_AUGMENTATION_ROUTE_WRONG_SEAM_SIDE` errors**.
- Final collision-derived release validator: **not reached**.
- Strict one-seed realized verifier: **not reached**.
- Overall V4 release readiness: **blocked**.

The previous zero-error canonical witness is stale and must not be treated as release evidence. Exact seam ownership, materializer ownership, and strict validation later changed. At this historical source identity, the first-derived seed no longer reported ISSUE-066, the five pyramid endpoint-seam mismatches, or the boss-to-shrine featureless-span defect, but it still did not produce an overlay, so the 175-entry historical register as a whole could not be declared closed. The original register remains unchanged as historical evidence, and the completion rule at the end of this document still applies.

### Historical actionable canonical failure at that source identity

At that source identity, the first-attempt plan succeeded with 6 operations, 30 supplemental rooms, 37 segments, and zero accumulated featureless-span records. Materialization then rejected four independent paths with `DUNGEON_AUGMENTATION_ROUTE_WRONG_SEAM_SIDE`: pyramid network 0 segment 1, `enemyNest_keycardRoom` network 1 segment 1, `trapRoom_conveyorRoom` network 3 segment 0, and `conveyorRoom_bossRoom` network 4 segment 0. Atomic fallback therefore remained correct. This was not an accepted or realized release witness, and the Chromium GPU/SharedImage diagnostics were a separate capture-stability concern.

### Boss-to-shrine featureless-span closure evidence

Verified 2026-07-31 without weakening the 33.6 m limit:

- The two former diagnostics were forward and reverse views of one 60.4955435713 m physical span: 30.8 m of segment, 10.0955435713 m through a capped degree-two connector shell, and 19.6 m of segment.
- The constrained bay now realizes its authored third arm as an exact challenge-room branch. The compact reward room remains on the reconnect spine, preserving `enter -> challenge -> payoff -> reconnect` instead of exposing the payoff before the challenge.
- The branch room is seeded from the Through-T's exact `right` socket, while the final station interval uses the 19.6 m survey-relay-cache footprint. Exact socket routing remains responsible for both complete exterior approaches.
- Planning and release validation now call the same accumulated physical-graph evaluator. A capped connector cannot reset distance merely by declaring a planned degree of three, and an overlong final graph rejects before the operation is committed.
- The focused topology/validation suites pass 93/93, the canonical unit manifest passes 320/320, and immutable V1-V3 replay passes 1/1 with its stored hashes unchanged. Canonical attempt-one planning reports zero featureless-span records; overall release remains blocked by the four independent materialization failures above and the unreached realized/browser/corpus gates.

### ISSUE-066 targeted closure evidence

Verified 2026-07-31 without removing the historical register entry:

- The canonical segment leaves its source threshold through both authoritative exterior seam cells and preserves the ordered centerline floor `-16,15@y14.000`.
- Final collision validation consumes the authoritative floor keys and independently proves source-to-destination and destination-to-source traversal.
- Wrong-side leads and one-tile doglegs reject before materialization; missing floors and both traversal directions have stable diagnostics.
- The issue-specific regression suite passes 6/6, the canonical unit manifest passes 320/320, and the immutable V1-V3 replay test retains its stored hashes.
- Canonical plan validation reports zero records for ISSUE-066's segment. The other 174 historical records are not declared closed by this targeted result; full V4 release remains blocked by the current independent failures and the unreached corpus/browser gates.

### Pyramid endpoint-seam ownership closure evidence

Verified 2026-07-31 without broadening any seam grant:

- Landmark-wall endpoint rooms retain ownerless room-side seams; only the exact parent-wall seam carries the authored physical owner.
- Inherited parent ownership remains mandatory for co-located `authored-corridor-station` endpoints used by coverage networks.
- Strict seam diagnostics now report the exact mismatched top-level fields and expected/actual parent-owner identities.
- The focused regression accepts the correct landmark-wall contract, rejects a remote owner added to a room seam, and rejects an authored corridor station that omits its inherited owner.
- Canonical plan validation reports zero `route-network-endpoint-seam-record-invalid` records. Pyramid segment 1 now reaches a separate materializer-side wrong-seam-side rejection; that path defect remains open and does not reopen the corrected endpoint-seam-record contract.

### Inconsistencies and decisions requiring confirmation

| Contract tension | Current implementation/interpretation | Decision required |
| --- | --- | --- |
| Variety is a 100-seed corpus threshold, while the planner previously hard-required three elevation modes in every dungeon. | The per-seed minimum is one; the evidence aggregate requires exact topology, junction, elevation, encounter, and room-layout family coverage plus topology ≤35%, junction ≤50%, and complete-layout signature ≤10% across the first 100 accepted parents. | **Adopted:** diversity is a corpus property. A dungeon still must satisfy its physical semantic contracts, but it has no hidden three-family quota. |
| The specification requires independent topology, junction, elevation, encounter, and room-layout exhaustion bags. | All five immutable, RNG-isolated bags now serialize accepted manifests; failed branches do not consume choices, and focused rollback/refill/replay tests pass. | **Resolved in implementation; release evidence remains outstanding.** |
| V4 presentation previously required entrance, bend, junction, and interval frames throughout a route. | V4 now emits exactly one nonblocking, two-draw-call boundary indicator for each distinct granted parent `attachmentSocketId`. Internal segments, cadence intervals, bends, and junctions do not create standalone frames; coincident bend/junction meaning is metadata on the boundary record. Floor identity, wall support, clearance, theme binding, and renderer identity remain strict. | **Resolved in implementation; realized/browser evidence remains outstanding.** |
| Transfer endpoints must bind to exact authoritative floor-cell identities. | Every V4 transfer now resolves authored floor-cell or transfer-cell endpoint identities, including even-footprint lift boarding cells; nearest/grid fallback remains legacy-only. | **Resolved in implementation; realized traversal evidence remains outstanding.** |
| Encounters, rewards, and mechanisms are required to resolve after finalized collision. | One renderer-free resolver now confines all gameplay anchors to declared cells/zones/tiers after solid and walkability inputs, including far-side shortcut controls; failure rejects the overlay before scene factories. | **Resolved in implementation; live journey evidence remains outstanding.** |
| The outer eight-seed realization retry must remain as defensive fallback, while release-corpus layouts are required to apply on their first derived seed. | Runtime retains its defensive retry, while every accepted-parent manifest entry records and validates its first derived realization. | **Adopted:** the canonical witness and every entry in the 10/100/1,000 release corpora must apply on attempt 1. The requirement does not claim every theoretical seed worldwide. |
| The 175-record current-validator count can be zero before the strict 10/100/1,000 sweeps and browser journeys pass. | This register remains open and release is blocked until all completion gates pass. | Recommended interpretation: “close all 175” means root-cause closure proven by the full strict gates, not a zero from one weaker validator witness. |
| The public ID contains `preview-v4`, but ordinary requests are now release-authoritative and alpha bypass requires a second explicit flag. | The ID and revision remain unchanged for save/hash compatibility; authority is determined by validation, not the word “preview.” | Confirm whether a future non-preview alias should be introduced after the release gates pass. |
| V1 authored connectors retain their arches and hashes; older validation treated that cadence as universal. | Presentation validation is versioned: V1 arch behavior remains immutable, while V4 uses only parent-socket boundary indicators and never inherits interval/bend/junction frame cadence. | No code decision is currently blocked; retain this row as the resolved presentation-policy record. |
| Alpha may expose invalid geometry, but alpha diagnostics must use the same collision-derived graph as release validation. | Alpha changes acceptance only; it does not substitute a weaker graph or rewrite validation results. Invulnerability is separately controlled. | **Adopted:** alpha is explicit, disposable, non-authoritative, and cannot create, update, or clear committed expedition evidence. |
| The release plan requires a three-lane threshold plus two clear approach tiles on both sides, while the pre-recovery host and validator encoded only one tile per side. | V4 host grants and validation now use an exact 3 x 5 tile envelope: two inside cells, the threshold cell, and two outside cells. | Resolved in favor of the written release plan; confirm that no legacy one-tile V4 development grant must remain accepted. |
| An exact base floor mask can be read as every room-owned floor at the base elevation, but authored ramp and transfer cells can begin at that same elevation. | Base-mask checks compare authoritative base-tier cell identities; transfer cells are validated separately through their transfer IDs and endpoint identities. | **Adopted:** the base mask is the single named `base` tier at local elevation 0, not every physical cell with the same numeric elevation. Transfer presentation may replace a base cell only while retaining its original cell identity link. |
| Junction kits have named footprint dimensions such as 7 x 7 Crossroads, but their substantive floor masks are non-rectangular. | Width/depth describe the planning and clearance envelope; physical floor coverage is the exact authored tier-cell mask. | **Adopted:** dimensions are rotated bounding placement/clearance envelopes, including `.` cells; floors are exact authored `#` cells minus declared voids and blockers. |
| Exact seam ownership forbids cross-owner overlap outside the socket seam. | Planning, materialization, collision, navigation, and validation consume exact 15-cell endpoint seams; arbitrary endpoint-floor reuse and segment use of node-only overlap grants are rejected. ISSUE-066's canonical segment and the pyramid's plan-level endpoint-seam ownership records are clean; pyramid segment 1 still has a distinct wrong-side path failure. | **Resolved as a contract decision; full realized proof remains outstanding. Do not broaden ownership to solve the remaining failures.** |
| The acceptance plan requires 10/100/1,000 realized sweeps, while the canonical attempt is not yet accepted. | All tiers are ordinal views of one immutable 1,000-parent manifest; shard records include generation/strict-validation phase timings. A single plan-only timing is not release-performance evidence. | **Adopted:** on the named reference environment, median ≤10 s, p95 ≤20 s, maximum ≤30 s; 180 s/seed is only a CI hang timeout. The performance gate remains unproven. |

### Resolved audit drift

- The catalog and its exact-layout tests now formalize all 28 exported blueprints; the focused blueprint suite passes 8/8.
- The maintenance-rise ramp now spans seven cells/six intervals for a 2.8 m rise and has an executable section route.
- The preflight threshold predicate now matches the authoritative 3×5 seam instead of a stale 3×3 interpretation.
- ISSUE-066's exact enemy-nest-to-keycard segment now has authoritative seam exits, complete centerline floor intent, and finalized bidirectional collision proof; its historical entry remains below for traceability.
- Pyramid landmark-wall rooms no longer inherit the remote authored-wall owner on their room-side seams; true authored corridor stations retain exact inherited ownership.
- The boss-to-shrine constrained bay now has a physically active challenge branch, a compact payoff on the reconnect spine, and one shared accumulated-distance check in planning and validation; the former symmetric 60.4955435713 m records are absent.
- Alpha acceptance remains explicit to exact V4 plus `dungeonAugmentationAlpha=1`; invulnerability remains independently controlled by `playerInvulnerable=1`.
- V1 authored arches and V4 parent-socket boundary indicators remain separate presentation contracts.

### Release evidence workflow

The mandatory public progression is exact canonical seed 0, exact canonical seed 1, the 10-seed smoke view, the 100-seed normal view, and finally the 1,000-seed release view. Every stage is manifest-bound and fail-closed: a failure blocks all later stages. The two canonical records must apply on realization attempt one, preserve accepted-parent parity, pass release and strict-realized validation, retain parent-generation/planning/materialization/Three.js-assembly/strict-validation/disposal timings, and satisfy the 10/20/30-second performance budget. Warm-up and target generation both use the release-only attempt cap of one; ordinary runtime generation retains its default cap of eight.

Use the ordered public gates. They reuse one provenance-keyed artifact root and cannot bypass prerequisites:

```text
npm run verify:dungeon-augmentation:canonical
npm run verify:dungeon-augmentation:corpus:smoke
npm run verify:dungeon-augmentation:corpus:normal
npm run verify:dungeon-augmentation:corpus:release
```

1. Build one immutable accepted-parent manifest containing exactly 1,000 entries. Each entry contains its ordinal, raw seed index, exact seed and base-plan hash, and a hash of the disabled authored-parent layout plus source RNG consumption. Smoke is the first 10 ordinals, normal is the first 100, and release is all 1,000; they never use separate parent manifests.
2. Run realized verification by manifest ordinal and explicit view. Required partitions are 1×10 for `smoke`, 10×10 for `normal`, and 20×50 for `release`. Raw `--start` ranges are not release evidence because skipped parent seeds make those ranges overlap or leave gaps.
3. Each manifest ordinal runs in its own verifier worker with a hard 180-second watchdog. The orchestrator combines successful one-seed records into the canonical sealed, atomic shard JSON containing provenance, expected ordinals, every strict result, first-attempt status, validation state, signatures, and elapsed time. A timed-out or failed worker produces a failed canonical shard without allowing later seeds to hide the failure.
4. Aggregate shards against the same manifest and exact tier topology. Every JSON supplied directly or discovered in a shard directory must be a valid shard for that manifest and source hash; unrelated, stale, or mixed-manifest files are rejected rather than filtered out. The aggregator also rejects duplicate or missing ordinals, fallback, retries, validator or strict-verifier failures, accepted-parent drift, diversity violations, and performance-budget violations.
5. Run the five immutable suite contracts and seal one receipt for each: canonical unit/blueprints, enclosure, legacy replay, persistence/lifecycle, and ordinary-movement/disposable-alpha Playwright journeys. Every receipt must retain the aggregate's exact git commit, source hash, runtime platform, profile hash, and machine provenance before and after its commands.
6. Finalize the release aggregate and all five receipts into one sealed attestation. Missing, duplicated, substituted, failed, source-drifted, or mixed-SHA receipts reject finalization. Regenerate only the narrow evidence block at the top of this document from that attestation; a corpus aggregate by itself is deliberately not accepted.

Low-level normal-view diagnostic commands (run shard indexes 0 through 9, normally on parallel CI workers):

The manifest builder, shard runner, and aggregator below are diagnostic/CI primitives. Invoking them directly does not satisfy the ordered canonical-to-release gate, and their explicit artifact path is not the provenance-keyed path chosen by the public gate runner.

```text
npm run build:dungeon-augmentation:corpus
npm run run:dungeon-augmentation:release-shard -- --manifest=artifacts/dungeon-augmentation-v4-release/accepted-parent-manifest-1000.json --tier=normal --shard-index=0 --shard-count=10 --output=artifacts/dungeon-augmentation-v4-release/normal-shards/shard-000-of-010.json
npm run aggregate:dungeon-augmentation:release-evidence -- --manifest=artifacts/dungeon-augmentation-v4-release/accepted-parent-manifest-1000.json --tier=normal --shard-dir=artifacts/dungeon-augmentation-v4-release/normal-shards --output=artifacts/dungeon-augmentation-v4-release/normal-aggregate.json
```

Normal and smoke aggregates are regression evidence only. The full release orchestrator runs the 20Ã—50 release view, seals the five same-source receipts, and finalizes `release-attestation.json`. Only that release attestation may be passed to the documentation command:

```text
npm run verify:dungeon-augmentation:release
npm run document:dungeon-augmentation:release-evidence -- --evidence=<same-source-artifact-root>/release-attestation.json
```

## Historical pre-recovery register

Generated 2026-07-30 from profile `industrial-supplement-preview-v4` and deterministic seed `layout:augmentation-realized-v4-000`.

## Status and scope

- Playable-alpha acceptance: **passed**.
- Release validation: **failed**.
- Raw release-validator issue records: **175**.
- Ordered error-array SHA-256: `e39909be74717cca4d0b6ec5af6ff438259247e96f29fe8cd02183d10b1e80d1`.

These are validator issue records, not 175 independent root causes. A single missing threshold floor can produce approach, spine, room-component, connector-module, and assembly-level failures. Every raw record is retained below with its original order and a stable `ISSUE-NNN` label.

The playable-alpha gate is intentionally narrower than release validation. It confirms that the overlay applies and exposes generated rooms, encounters, rewards, mechanisms, transfers, and a connected gameplay floor graph. It does not waive the release contracts listed here.

## Category summary

| ID | Category | Count |
| --- | --- | ---: |
| ARCH | Legacy V1 decorative-arch coverage | 19 |
| APPROACH | Socket threshold and two-tile approach contracts | 34 |
| RAMP | Shared movement-envelope ramp violations | 6 |
| SOCKET | Socket ownership and room-local reachability | 17 |
| SEGMENT | Connector segment floor and spine integrity | 21 |
| ROOM | Supplemental room footprint and local-component integrity | 48 |
| JUNCTION | Connector-module component and approach-count contracts | 23 |
| ASSEMBLY | Aggregate supplemental-assembly failures | 3 |
| OPERATION | Route-network elevation-layer integration | 1 |
| SPAWN | Encounter spawn-floor validity | 3 |
| **Total** |  | **175** |

## Category diagnosis and remediation

### ARCH — Legacy V1 decorative-arch coverage (19)

The historical release validator required complete-gallery V1 arch decoration on both authored and supplemental routes. That mixed-version rule was presentation coverage, not a playable-alpha connectivity failure, and is no longer the V4 contract.

Closure decision: V4 does not inherit the V1 arch contract. The validator is version-gated so V1 arches and hashes remain unchanged, while V4 validates only the exact granted-parent boundary-indicator socket set.

### APPROACH — Socket threshold and two-tile approach contracts (34)

Exact parent and supplemental sockets lack one or more threshold/outside floor witnesses, or their approach lanes are unreachable. Several messages describe the two sides of the same physical seam.

Recommended closure: Realize and reserve the complete three-lane threshold footprint before walls and route floors, then validate the exact floor keys on both sides of every socket.

### RAMP — Shared movement-envelope ramp violations (6)

Short authored ramps change elevation too quickly for the common player/navigation step envelope even though their endpoints are correctly aligned.

Recommended closure: Lengthen the affected ramp runs or revise their sampled collision surfaces so every adjacent rise stays within the shared movement envelope.

### SOCKET — Socket ownership and room-local reachability (17)

The exact contracted socket floor is absent, owned by the wrong physical record, or cannot be reached within its owner without traversing the connection being tested.

Recommended closure: Keep socket floors owner-scoped, restore exact contracted elevations, and build a room-local path from each approach to its socket before joining the inter-room segment.

### SEGMENT — Connector segment floor and spine integrity (21)

A physical connector segment is missing a centerline floor or is split into components. Return-spine and orphan reports are usually consequences of the same break.

Recommended closure: Stamp segment floors from the ordered authoritative path, reject overwritten centerline cells, and require forward and reverse graph traversal before presentation.

### ROOM — Supplemental room footprint and local-component integrity (48)

A curated module has blocked, locally disconnected, orphaned, or non-returnable owned floors. One module can emit several assertions against the same disconnected component.

Recommended closure: Run collision-derived local connectivity against exact floor masks, remove structure/cover conflicts from clear routes, and reject any module whose owned floor set is not returnable.

### JUNCTION — Connector-module component and approach-count contracts (23)

A route station or junction proxy does not physically join all declared approaches at one exact elevation.

Recommended closure: Build each compact junction from one reserved floor component and verify every declared arm against that component before accepting the network.

### ASSEMBLY — Aggregate supplemental-assembly failures (3)

These are aggregate counts over blocked, orphaned, or non-returnable owned floors and therefore summarize lower-level room and segment failures.

Recommended closure: Treat these as release gates and close the underlying room, segment, and socket records rather than suppressing the aggregate assertions.

### OPERATION — Route-network elevation-layer integration (1)

At least one route network does not join all of its declared elevation layers through a recognized physical transfer in the release graph.

Recommended closure: Ensure transfer links use the same authoritative floor identities as the operation graph and prove bidirectional layer traversal before accepting the operation.

### SPAWN — Encounter spawn-floor validity (3)

An encounter recipe resolved a spawn onto a blocked, unreachable, wrong-owner, or wrong-elevation floor.

Recommended closure: Select spawns only from the post-collision reachable owned-floor set for the recipe tier, then revalidate after structures and hazards are committed.

## Exhaustive issue register

### ARCH — Legacy V1 decorative-arch coverage

1. **ISSUE-001** — enemyNest_keycardRoom_ground does not provide decorative V1 arches across its complete gallery.
2. **ISSUE-002** — keycardRoom_trapRoom_ground does not provide decorative V1 arches across its complete gallery.
3. **ISSUE-003** — trapRoom_conveyorRoom_ground does not provide decorative V1 arches across its complete gallery.
4. **ISSUE-004** — conveyorRoom_bossRoom_ground does not provide decorative V1 arches across its complete gallery.
5. **ISSUE-005** — bossRoom_shrineRoom_ground does not provide decorative V1 arches across its complete gallery.
6. **ISSUE-006** — supplement:industrial-v1-main-region:routenetwork:0:segment:0:industrial-v1-main-region-route-network-grant-keycard-pyramid-loop does not provide decorative V1 arches across its complete gallery.
7. **ISSUE-007** — supplement:industrial-v1-main-region:routenetwork:0:segment:3:industrial-v1-main-region-route-network-grant-keycard-pyramid-loop does not provide decorative V1 arches across its complete gallery.
8. **ISSUE-008** — supplement:industrial-v1-main-region:routenetwork:0:segment:4:industrial-v1-main-region-route-network-grant-keycard-pyramid-loop does not provide decorative V1 arches across its complete gallery.
9. **ISSUE-009** — supplement:industrial-v1-main-region:routenetwork:0:segment:5:industrial-v1-main-region-route-network-grant-keycard-pyramid-loop does not provide decorative V1 arches across its complete gallery.
10. **ISSUE-010** — supplement:industrial-v1-main-region:routenetwork:1:segment:2:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom does not provide decorative V1 arches across its complete gallery.
11. **ISSUE-011** — supplement:industrial-v1-main-region:routenetwork:1:segment:4:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom does not provide decorative V1 arches across its complete gallery.
12. **ISSUE-012** — supplement:industrial-v1-main-region:routenetwork:2:segment:4:industrial-v1-main-region-route-network-grant-coverage-keycardroom_traproom does not provide decorative V1 arches across its complete gallery.
13. **ISSUE-013** — supplement:industrial-v1-main-region:routenetwork:3:segment:2:industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom does not provide decorative V1 arches across its complete gallery.
14. **ISSUE-014** — supplement:industrial-v1-main-region:routenetwork:3:segment:3:industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom does not provide decorative V1 arches across its complete gallery.
15. **ISSUE-015** — supplement:industrial-v1-main-region:routenetwork:3:segment:4:industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom does not provide decorative V1 arches across its complete gallery.
16. **ISSUE-016** — supplement:industrial-v1-main-region:routenetwork:4:segment:2:industrial-v1-main-region-route-network-grant-coverage-conveyorroom_bossroom does not provide decorative V1 arches across its complete gallery.
17. **ISSUE-017** — supplement:industrial-v1-main-region:routenetwork:4:segment:4:industrial-v1-main-region-route-network-grant-coverage-conveyorroom_bossroom does not provide decorative V1 arches across its complete gallery.
18. **ISSUE-018** — supplement:industrial-v1-main-region:routenetwork:5:segment:5:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom does not provide decorative V1 arches across its complete gallery.
19. **ISSUE-019** — supplement:industrial-v1-main-region:routenetwork:5:segment:7:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom does not provide decorative V1 arches across its complete gallery.

### APPROACH — Socket threshold and two-tile approach contracts

20. **ISSUE-020** — industrial-v1:main-region:route-socket:enemyNest_keycardRoom:0 has no walkable floor at its room threshold.
21. **ISSUE-021** — industrial-v1:main-region:route-socket:enemyNest_keycardRoom:0 lane 0 lacks its clear two-tile bidirectional approach (missing=threshold:0; unreachable=none; headroom=ok; nonFlat=-16,15; hazards=none; blockedEdges=-16,16@y14.000->missing,missing->-16,14@y14.000).
22. **ISSUE-022** — supplement:industrial-v1-main-region:nodesocket:0:entry:0:supplement-industrial-v1-main-region-routenetwork-1-node-0-industrial-v1-main-re has no walkable connector approach outside its room.
23. **ISSUE-023** — supplement:industrial-v1-main-region:nodesocket:0:entry:0:supplement-industrial-v1-main-region-routenetwork-1-node-0-industrial-v1-main-re lane 0 lacks its clear two-tile bidirectional approach (missing=outside:1; unreachable=none; headroom=ok; nonFlat=-16,15; hazards=none; blockedEdges=-16,14@y14.000->missing,missing->-16,16@y14.000).
24. **ISSUE-024** — industrial-v1:main-region:route-socket:enemyNest_keycardRoom:1 has no walkable connector approach outside its room.
25. **ISSUE-025** — industrial-v1:main-region:route-socket:enemyNest_keycardRoom:1 lane 0 lacks its clear two-tile bidirectional approach (missing=outside:1; unreachable=none; headroom=ok; nonFlat=-20,21; hazards=none; blockedEdges=-19,21@y14.000->missing,missing->-21,21@y14.000).
26. **ISSUE-026** — supplement:industrial-v1-main-region:nodesocket:3:entry:0:supplement-industrial-v1-main-region-routenetwork-1-node-3-industrial-v1-main-re has no walkable connector approach outside its room.
27. **ISSUE-027** — supplement:industrial-v1-main-region:nodesocket:3:entry:0:supplement-industrial-v1-main-region-routenetwork-1-node-3-industrial-v1-main-re lane 0 lacks its clear two-tile bidirectional approach (missing=outside:1; unreachable=none; headroom=ok; nonFlat=-20,21; hazards=none; blockedEdges=-21,21@y14.000->missing,missing->-19,21@y14.000).
28. **ISSUE-028** — industrial-v1:main-region:route-socket:keycardRoom_trapRoom:1 lane -1 lacks its clear two-tile bidirectional approach (missing=threshold:0; unreachable=none; headroom=ok; nonFlat=20,42; hazards=none; blockedEdges=19,42@y28.000->missing,missing->21,42@y28.000).
29. **ISSUE-029** — supplement:industrial-v1-main-region:nodesocket:3:entry:0:supplement-industrial-v1-main-region-routenetwork-2-node-3-industrial-v1-main-re lane -1 lacks its clear two-tile bidirectional approach (missing=outside:1; unreachable=none; headroom=ok; nonFlat=20,42; hazards=none; blockedEdges=21,42@y28.000->missing,missing->19,42@y28.000).
30. **ISSUE-030** — industrial-v1:main-region:route-socket:trapRoom_conveyorRoom:0 lane -1 lacks its clear two-tile bidirectional approach (missing=threshold:0; unreachable=none; headroom=ok; nonFlat=-14,63; hazards=none; blockedEdges=-15,63@y14.000->missing,missing->-13,63@y14.000).
31. **ISSUE-031** — supplement:industrial-v1-main-region:nodesocket:0:entry:0:supplement-industrial-v1-main-region-routenetwork-3-node-0-industrial-v1-main-re lane -1 lacks its clear two-tile bidirectional approach (missing=outside:1; unreachable=none; headroom=ok; nonFlat=-14,63; hazards=none; blockedEdges=-13,63@y14.000->missing,missing->-15,63@y14.000).
32. **ISSUE-032** — industrial-v1:main-region:route-socket:trapRoom_conveyorRoom:1 has no walkable floor at its room threshold.
33. **ISSUE-033** — industrial-v1:main-region:route-socket:trapRoom_conveyorRoom:1 lane 0 lacks its clear two-tile bidirectional approach (missing=threshold:0; unreachable=none; headroom=ok; nonFlat=-14,72; hazards=none; blockedEdges=-15,72@y14.000->missing,missing->-13,72@y14.000).
34. **ISSUE-034** — supplement:industrial-v1-main-region:nodesocket:3:entry:0:supplement-industrial-v1-main-region-routenetwork-3-node-3-industrial-v1-main-re has no walkable connector approach outside its room.
35. **ISSUE-035** — supplement:industrial-v1-main-region:nodesocket:3:entry:0:supplement-industrial-v1-main-region-routenetwork-3-node-3-industrial-v1-main-re lane 0 lacks its clear two-tile bidirectional approach (missing=outside:1; unreachable=none; headroom=ok; nonFlat=-14,72; hazards=none; blockedEdges=-13,72@y14.000->missing,missing->-15,72@y14.000).
36. **ISSUE-036** — industrial-v1:main-region:route-socket:conveyorRoom_bossRoom:1 lane -1 lacks its clear two-tile bidirectional approach (missing=threshold:0; unreachable=none; headroom=ok; nonFlat=-1,117; hazards=none; blockedEdges=-1,116@y0.000->missing,missing->-1,118@y0.000).
37. **ISSUE-037** — supplement:industrial-v1-main-region:nodesocket:3:entry:0:supplement-industrial-v1-main-region-routenetwork-4-node-3-industrial-v1-main-re lane -1 lacks its clear two-tile bidirectional approach (missing=outside:1; unreachable=none; headroom=ok; nonFlat=-1,117; hazards=none; blockedEdges=-1,118@y0.000->missing,missing->-1,116@y0.000).
38. **ISSUE-038** — industrial-v1:main-region:route-socket:bossRoom_shrineRoom:0 lane 1 lacks its clear two-tile bidirectional approach (missing=threshold:0; unreachable=none; headroom=ok; nonFlat=20,134; hazards=none; blockedEdges=19,134@y0.000->missing,missing->21,134@y0.000).
39. **ISSUE-039** — supplement:industrial-v1-main-region:nodesocket:0:entry:0:supplement-industrial-v1-main-region-routenetwork-5-node-0-industrial-v1-main-re lane 1 lacks its clear two-tile bidirectional approach (missing=outside:1; unreachable=none; headroom=ok; nonFlat=20,134; hazards=none; blockedEdges=21,134@y0.000->missing,missing->19,134@y0.000).
40. **ISSUE-040** — industrial-v1:main-region:route-socket:bossRoom_shrineRoom:1 lane 1 lacks its clear two-tile bidirectional approach (missing=threshold:0; unreachable=none; headroom=ok; nonFlat=16,143; hazards=none; blockedEdges=16,142@y0.000->missing,missing->16,144@y0.000).
41. **ISSUE-041** — supplement:industrial-v1-main-region:nodesocket:3:entry:2:supplement-industrial-v1-main-region-routenetwork-5-node-3-industrial-v1-main-re lane 1 lacks its clear two-tile bidirectional approach (missing=outside:1; unreachable=none; headroom=ok; nonFlat=16,143; hazards=none; blockedEdges=16,144@y0.000->missing,missing->16,142@y0.000).
42. **ISSUE-042** — industrial-v1:main-region:route-socket:bossRoom_shrineRoom:2 lane -1 lacks its clear two-tile bidirectional approach (missing=threshold:0; unreachable=none; headroom=ok; nonFlat=4,143; hazards=none; blockedEdges=4,142@y0.000->missing,missing->4,144@y0.000).
43. **ISSUE-043** — supplement:industrial-v1-main-region:nodesocket:5:entry:0:supplement-industrial-v1-main-region-routenetwork-5-node-5-industrial-v1-main-re lane -1 lacks its clear two-tile bidirectional approach (missing=outside:1; unreachable=none; headroom=ok; nonFlat=4,143; hazards=none; blockedEdges=4,144@y0.000->missing,missing->4,142@y0.000).
44. **ISSUE-044** — supplement:industrial-v1-main-region:nodesocket:1:exit:1:supplement-industrial-v1-main-region-routenetwork-5-node-1-industrial-v1-main-re room threshold is unreachable from the dungeon start.
45. **ISSUE-045** — supplement:industrial-v1-main-region:nodesocket:1:exit:1:supplement-industrial-v1-main-region-routenetwork-5-node-1-industrial-v1-main-re connector approach is unreachable from the dungeon start.
46. **ISSUE-046** — supplement:industrial-v1-main-region:nodesocket:1:exit:1:supplement-industrial-v1-main-region-routenetwork-5-node-1-industrial-v1-main-re lane -1 lacks its clear two-tile bidirectional approach (missing=none; unreachable=28,143@y2.800,28,144@y2.800,28,145@y2.800,28,146@y2.800; headroom=ok; nonFlat=none; hazards=none; blockedEdges=none).
47. **ISSUE-047** — supplement:industrial-v1-main-region:nodesocket:1:exit:1:supplement-industrial-v1-main-region-routenetwork-5-node-1-industrial-v1-main-re lane 0 lacks its clear two-tile bidirectional approach (missing=none; unreachable=29,142@y2.800,29,143@y2.800,29,144@y2.800,29,145@y2.800,29,146@y2.800; headroom=ok; nonFlat=none; hazards=none; blockedEdges=none).
48. **ISSUE-048** — supplement:industrial-v1-main-region:nodesocket:1:exit:1:supplement-industrial-v1-main-region-routenetwork-5-node-1-industrial-v1-main-re lane 1 lacks its clear two-tile bidirectional approach (missing=none; unreachable=30,143@y2.800,30,144@y2.800,30,145@y2.800,30,146@y2.800; headroom=ok; nonFlat=none; hazards=none; blockedEdges=none).
49. **ISSUE-049** — supplement:industrial-v1-main-region:nodesocket:2:entry:0:supplement-industrial-v1-main-region-routenetwork-5-node-2-industrial-v1-main-re room threshold is unreachable from the dungeon start.
50. **ISSUE-050** — supplement:industrial-v1-main-region:nodesocket:2:entry:0:supplement-industrial-v1-main-region-routenetwork-5-node-2-industrial-v1-main-re connector approach is unreachable from the dungeon start.
51. **ISSUE-051** — supplement:industrial-v1-main-region:nodesocket:2:entry:0:supplement-industrial-v1-main-region-routenetwork-5-node-2-industrial-v1-main-re lane -1 lacks its clear two-tile bidirectional approach (missing=none; unreachable=27,146@y2.800,28,146@y2.800,29,146@y2.800,30,146@y2.800; headroom=ok; nonFlat=none; hazards=none; blockedEdges=none).
52. **ISSUE-052** — supplement:industrial-v1-main-region:nodesocket:2:entry:0:supplement-industrial-v1-main-region-routenetwork-5-node-2-industrial-v1-main-re lane 0 lacks its clear two-tile bidirectional approach (missing=none; unreachable=26,147@y2.800,27,147@y2.800,28,147@y2.800,29,147@y2.800,30,147@y2.800; headroom=ok; nonFlat=none; hazards=none; blockedEdges=none).
53. **ISSUE-053** — supplement:industrial-v1-main-region:nodesocket:2:entry:0:supplement-industrial-v1-main-region-routenetwork-5-node-2-industrial-v1-main-re lane 1 lacks its clear two-tile bidirectional approach (missing=none; unreachable=27,148@y2.800,28,148@y2.800,29,148@y2.800,30,148@y2.800; headroom=ok; nonFlat=none; hazards=none; blockedEdges=none).

### RAMP — Shared movement-envelope ramp violations

54. **ISSUE-054** — Ramp -34,49@y14.000 exceeds the shared movement envelope.
55. **ISSUE-055** — Ramp -42,43@y14.000 exceeds the shared movement envelope.
56. **ISSUE-056** — Ramp -36,49@y16.800 exceeds the shared movement envelope.
57. **ISSUE-057** — Ramp -35,49@y15.400 exceeds the shared movement envelope.
58. **ISSUE-058** — Ramp -42,44@y15.400 exceeds the shared movement envelope.
59. **ISSUE-059** — Ramp -42,45@y16.800 exceeds the shared movement envelope.

### SOCKET — Socket ownership and room-local reachability

60. **ISSUE-060** — industrial-v1:main-region:socket:keycardRoom:south cannot be reached locally from keycardRoom without crossing its connection first.
61. **ISSUE-061** — industrial-v1:main-region:route-socket:enemyNest_keycardRoom:0 is not reachable from its room approach.
62. **ISSUE-062** — industrial-v1:main-region:route-socket:enemyNest_keycardRoom:0 is represented only by a floor owned by another room or connector.
63. **ISSUE-063** — industrial-v1:main-region:route-socket:enemyNest_keycardRoom:0 has no realized floor at its contracted elevation 14.00.
64. **ISSUE-064** — industrial-v1:main-region:route-socket:enemyNest_keycardRoom:0 cannot be reached locally from supplement:industrial-v1-main-region:routenetwork:1:operation:0:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom:route-station:industrial-v1_main-region_route-socket_enemyNest_keycardRoom_0 without crossing its connection first.
73. **ISSUE-073** — supplement:industrial-v1-main-region:nodesocket:1:exit:1:supplement-industrial-v1-main-region-routenetwork-1-node-1-industrial-v1-main-re cannot be reached locally from supplement:industrial-v1-main-region:routenetwork:1:node:1:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom without crossing its connection first.
75. **ISSUE-075** — supplement:industrial-v1-main-region:nodesocket:2:entry:0:supplement-industrial-v1-main-region-routenetwork-2-node-2-industrial-v1-main-re cannot be reached locally from supplement:industrial-v1-main-region:routenetwork:2:node:2:industrial-v1-main-region-route-network-grant-coverage-keycardroom_traproom without crossing its connection first.
77. **ISSUE-077** — industrial-v1:main-region:route-socket:trapRoom_conveyorRoom:1 is not reachable from its room approach.
78. **ISSUE-078** — industrial-v1:main-region:route-socket:trapRoom_conveyorRoom:1 is represented only by a floor owned by another room or connector.
79. **ISSUE-079** — industrial-v1:main-region:route-socket:trapRoom_conveyorRoom:1 has no realized floor at its contracted elevation 14.00.
80. **ISSUE-080** — industrial-v1:main-region:route-socket:trapRoom_conveyorRoom:1 cannot be reached locally from supplement:industrial-v1-main-region:routenetwork:3:operation:0:industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom:route-station:industrial-v1_main-region_route-socket_trapRoom_conveyorRoom_1 without crossing its connection first.
87. **ISSUE-087** — supplement:industrial-v1-main-region:nodesocket:1:exit:1:supplement-industrial-v1-main-region-routenetwork-3-node-1-industrial-v1-main-re cannot be reached locally from supplement:industrial-v1-main-region:routenetwork:3:node:1:industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom without crossing its connection first.
89. **ISSUE-089** — supplement:industrial-v1-main-region:nodesocket:2:entry:0:supplement-industrial-v1-main-region-routenetwork-4-node-2-industrial-v1-main-re cannot be reached locally from supplement:industrial-v1-main-region:routenetwork:4:node:2:industrial-v1-main-region-route-network-grant-coverage-conveyorroom_bossroom without crossing its connection first.
93. **ISSUE-093** — supplement:industrial-v1-main-region:nodesocket:1:exit:1:supplement-industrial-v1-main-region-routenetwork-5-node-1-industrial-v1-main-re is not reachable from its room approach.
94. **ISSUE-094** — supplement:industrial-v1-main-region:nodesocket:1:exit:1:supplement-industrial-v1-main-region-routenetwork-5-node-1-industrial-v1-main-re cannot be reached locally from supplement:industrial-v1-main-region:routenetwork:5:node:1:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom without crossing its connection first.
95. **ISSUE-095** — supplement:industrial-v1-main-region:nodesocket:2:entry:0:supplement-industrial-v1-main-region-routenetwork-5-node-2-industrial-v1-main-re is not reachable from its room approach.
96. **ISSUE-096** — supplement:industrial-v1-main-region:nodesocket:2:entry:0:supplement-industrial-v1-main-region-routenetwork-5-node-2-industrial-v1-main-re cannot be reached locally from supplement:industrial-v1-main-region:routenetwork:5:node:2:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom without crossing its connection first.

### SEGMENT — Connector segment floor and spine integrity

65. **ISSUE-065** — supplement:industrial-v1-main-region:routenetwork:1:segment:0:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom is missing 1 realized traversal floor(s), including -16,15@y14.000.
66. **ISSUE-066** — supplement:industrial-v1-main-region:routenetwork:1:segment:0:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom connector has no traversable spine between its sockets under the base movement envelope (variant=standard).
67. **ISSUE-067** — supplement:industrial-v1-main-region:routenetwork:1:segment:0:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom connector has no traversable return spine from destination to source under the base movement envelope (variant=standard).
68. **ISSUE-068** — supplement:industrial-v1-main-region:routenetwork:1:segment:0:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom contains 5 realized traversal floor(s) outside its source-side connector component, including -17,15@y14.000.
69. **ISSUE-069** — supplement:industrial-v1-main-region:routenetwork:1:segment:0:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom contains 5 realized traversal floor(s) that cannot return to its source entrance, including -17,15@y14.000.
70. **ISSUE-070** — supplement:industrial-v1-main-region:routenetwork:1:segment:0:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom has 1 orphaned realized centerline floor(s), including -16,15@y14.000.
71. **ISSUE-071** — supplement:industrial-v1-main-region:routenetwork:1:segment:1:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom is missing 1 realized traversal floor(s), including -20,21@y14.000.
72. **ISSUE-072** — supplement:industrial-v1-main-region:routenetwork:1:segment:1:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom has 1 orphaned realized centerline floor(s), including -20,21@y14.000.
74. **ISSUE-074** — supplement:industrial-v1-main-region:routenetwork:2:segment:1:industrial-v1-main-region-route-network-grant-coverage-keycardroom_traproom is missing 1 realized traversal floor(s), including 20,42@y28.000.
76. **ISSUE-076** — supplement:industrial-v1-main-region:routenetwork:3:segment:0:industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom is missing 1 realized traversal floor(s), including -14,63@y14.000.
81. **ISSUE-081** — supplement:industrial-v1-main-region:routenetwork:3:segment:1:industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom is missing 1 realized traversal floor(s), including -14,72@y14.000.
82. **ISSUE-082** — supplement:industrial-v1-main-region:routenetwork:3:segment:1:industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom connector has no traversable spine between its sockets under the base movement envelope (variant=standard).
83. **ISSUE-083** — supplement:industrial-v1-main-region:routenetwork:3:segment:1:industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom connector has no traversable return spine from destination to source under the base movement envelope (variant=standard).
84. **ISSUE-084** — supplement:industrial-v1-main-region:routenetwork:3:segment:1:industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom contains 5 realized traversal floor(s) outside its source-side connector component, including -14,71@y14.000.
85. **ISSUE-085** — supplement:industrial-v1-main-region:routenetwork:3:segment:1:industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom contains 5 realized traversal floor(s) that cannot return to its source entrance, including -14,71@y14.000.
86. **ISSUE-086** — supplement:industrial-v1-main-region:routenetwork:3:segment:1:industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom has 1 orphaned realized centerline floor(s), including -14,72@y14.000.
88. **ISSUE-088** — supplement:industrial-v1-main-region:routenetwork:4:segment:1:industrial-v1-main-region-route-network-grant-coverage-conveyorroom_bossroom is missing 1 realized traversal floor(s), including -1,117@y0.000.
90. **ISSUE-090** — supplement:industrial-v1-main-region:routenetwork:5:segment:0:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom is missing 1 realized traversal floor(s), including 20,134@y0.000.
91. **ISSUE-091** — supplement:industrial-v1-main-region:routenetwork:5:segment:1:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom is missing 1 realized traversal floor(s), including 16,143@y0.000.
92. **ISSUE-092** — supplement:industrial-v1-main-region:routenetwork:5:segment:2:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom is missing 1 realized traversal floor(s), including 4,143@y0.000.
97. **ISSUE-097** — supplement:industrial-v1-main-region:routenetwork:5:segment:4:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom has 5 orphaned realized centerline floor(s), including 29,144@y2.800.

### ROOM — Supplemental room footprint and local-component integrity

98. **ISSUE-098** — supplement:industrial-v1-main-region:routenetwork:0:node:1:industrial-v1-main-region-route-network-grant-keycard-pyramid-loop does not physically realize its complete 81-tile declared base-floor footprint with room-owned, reachable, returnable floors (realized=81, missing=0, blocked=8, unreachable=8, local=10, nonreturnable=10, first=-39,51@y14.000).
99. **ISSUE-099** — supplement:industrial-v1-main-region:routenetwork:0:node:1:industrial-v1-main-region-route-network-grant-keycard-pyramid-loop contains 8 unexpectedly blocked room-owned floor(s), including -39,51@y14.000.
100. **ISSUE-100** — supplement:industrial-v1-main-region:routenetwork:0:node:1:industrial-v1-main-region-route-network-grant-keycard-pyramid-loop does not provide one locally clear, bidirectional component from every exact connector approach through all of its realized floors.
101. **ISSUE-101** — supplement:industrial-v1-main-region:routenetwork:0:node:2:industrial-v1-main-region-route-network-grant-keycard-pyramid-loop does not physically realize its complete 81-tile declared base-floor footprint with room-owned, reachable, returnable floors (realized=81, missing=0, blocked=3, unreachable=3, local=4, nonreturnable=4, first=-43,46@y14.000).
102. **ISSUE-102** — supplement:industrial-v1-main-region:routenetwork:0:node:2:industrial-v1-main-region-route-network-grant-keycard-pyramid-loop contains 3 unexpectedly blocked room-owned floor(s), including -43,46@y14.000.
103. **ISSUE-103** — supplement:industrial-v1-main-region:routenetwork:0:node:2:industrial-v1-main-region-route-network-grant-keycard-pyramid-loop does not provide one locally clear, bidirectional component from every exact connector approach through all of its realized floors.
104. **ISSUE-104** — supplement:industrial-v1-main-region:routenetwork:0:node:3:industrial-v1-main-region-route-network-grant-keycard-pyramid-loop does not physically realize its complete 59-tile declared base-floor footprint with room-owned, reachable, returnable floors (realized=59, missing=0, blocked=4, unreachable=4, local=4, nonreturnable=4, first=-37,37@y14.000).
105. **ISSUE-105** — supplement:industrial-v1-main-region:routenetwork:0:node:3:industrial-v1-main-region-route-network-grant-keycard-pyramid-loop contains 4 unexpectedly blocked room-owned floor(s), including -37,37@y14.000.
106. **ISSUE-106** — supplement:industrial-v1-main-region:routenetwork:0:node:3:industrial-v1-main-region-route-network-grant-keycard-pyramid-loop does not provide one locally clear, bidirectional component from every exact connector approach through all of its realized floors.
107. **ISSUE-107** — supplement:industrial-v1-main-region:routenetwork:0:node:4:industrial-v1-main-region-route-network-grant-keycard-pyramid-loop does not physically realize its complete 37-tile declared base-floor footprint with room-owned, reachable, returnable floors (realized=37, missing=0, blocked=0, unreachable=0, local=5, nonreturnable=5, first=-27,64@y14.000).
108. **ISSUE-108** — supplement:industrial-v1-main-region:routenetwork:0:node:4:industrial-v1-main-region-route-network-grant-keycard-pyramid-loop does not provide one locally clear, bidirectional component from every exact connector approach through all of its realized floors.
109. **ISSUE-109** — supplement:industrial-v1-main-region:routenetwork:1:node:1:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom does not physically realize its complete 24-tile declared base-floor footprint with room-owned, reachable, returnable floors (realized=24, missing=0, blocked=0, unreachable=0, local=1, nonreturnable=1, first=-21,3@y14.000).
110. **ISSUE-110** — supplement:industrial-v1-main-region:routenetwork:1:node:1:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom contains 4 unexpectedly blocked room-owned floor(s), including -27,8@y16.800.
111. **ISSUE-111** — supplement:industrial-v1-main-region:routenetwork:1:node:1:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom does not provide one locally clear, bidirectional component from every exact connector approach through all of its realized floors.
112. **ISSUE-112** — supplement:industrial-v1-main-region:routenetwork:1:node:2:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom does not physically realize its complete 36-tile declared base-floor footprint with room-owned, reachable, returnable floors (realized=36, missing=0, blocked=12, unreachable=12, local=13, nonreturnable=13, first=-33,13@y14.000).
113. **ISSUE-113** — supplement:industrial-v1-main-region:routenetwork:1:node:2:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom contains 13 unexpectedly blocked room-owned floor(s), including -33,13@y14.000.
114. **ISSUE-114** — supplement:industrial-v1-main-region:routenetwork:1:node:2:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom does not provide one locally clear, bidirectional component from every exact connector approach through all of its realized floors.
115. **ISSUE-115** — supplement:industrial-v1-main-region:routenetwork:2:node:1:industrial-v1-main-region-route-network-grant-coverage-keycardroom_traproom does not physically realize its complete 42-tile declared base-floor footprint with room-owned, reachable, returnable floors (realized=42, missing=0, blocked=5, unreachable=5, local=9, nonreturnable=9, first=42,42@y28.000).
116. **ISSUE-116** — supplement:industrial-v1-main-region:routenetwork:2:node:1:industrial-v1-main-region-route-network-grant-coverage-keycardroom_traproom contains 5 unexpectedly blocked room-owned floor(s), including 42,42@y28.000.
117. **ISSUE-117** — supplement:industrial-v1-main-region:routenetwork:2:node:1:industrial-v1-main-region-route-network-grant-coverage-keycardroom_traproom does not provide one locally clear, bidirectional component from every exact connector approach through all of its realized floors.
118. **ISSUE-118** — supplement:industrial-v1-main-region:routenetwork:2:node:2:industrial-v1-main-region-route-network-grant-coverage-keycardroom_traproom does not physically realize its complete 21-tile declared base-floor footprint with room-owned, reachable, returnable floors (realized=21, missing=0, blocked=0, unreachable=0, local=21, nonreturnable=21, first=33,47@y28.000).
119. **ISSUE-119** — supplement:industrial-v1-main-region:routenetwork:2:node:2:industrial-v1-main-region-route-network-grant-coverage-keycardroom_traproom contains 7 unexpectedly blocked room-owned floor(s), including 36,48@y30.800.
120. **ISSUE-120** — supplement:industrial-v1-main-region:routenetwork:2:node:2:industrial-v1-main-region-route-network-grant-coverage-keycardroom_traproom does not provide one locally clear, bidirectional component from every exact connector approach through all of its realized floors.
121. **ISSUE-121** — supplement:industrial-v1-main-region:routenetwork:3:node:1:industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom does not physically realize its complete 24-tile declared base-floor footprint with room-owned, reachable, returnable floors (realized=24, missing=0, blocked=0, unreachable=0, local=1, nonreturnable=1, first=-3,68@y14.000).
122. **ISSUE-122** — supplement:industrial-v1-main-region:routenetwork:3:node:1:industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom contains 4 unexpectedly blocked room-owned floor(s), including 3,67@y16.800.
123. **ISSUE-123** — supplement:industrial-v1-main-region:routenetwork:3:node:1:industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom does not provide one locally clear, bidirectional component from every exact connector approach through all of its realized floors.
124. **ISSUE-124** — supplement:industrial-v1-main-region:routenetwork:3:node:2:industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom does not physically realize its complete 36-tile declared base-floor footprint with room-owned, reachable, returnable floors (realized=36, missing=0, blocked=12, unreachable=12, local=13, nonreturnable=13, first=0,69@y14.000).
125. **ISSUE-125** — supplement:industrial-v1-main-region:routenetwork:3:node:2:industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom contains 13 unexpectedly blocked room-owned floor(s), including 0,69@y14.000.
126. **ISSUE-126** — supplement:industrial-v1-main-region:routenetwork:3:node:2:industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom does not provide one locally clear, bidirectional component from every exact connector approach through all of its realized floors.
127. **ISSUE-127** — supplement:industrial-v1-main-region:routenetwork:4:node:1:industrial-v1-main-region-route-network-grant-coverage-conveyorroom_bossroom does not physically realize its complete 42-tile declared base-floor footprint with room-owned, reachable, returnable floors (realized=42, missing=0, blocked=5, unreachable=10, local=10, nonreturnable=10, first=-16,124@y0.000).
128. **ISSUE-128** — supplement:industrial-v1-main-region:routenetwork:4:node:1:industrial-v1-main-region-route-network-grant-coverage-conveyorroom_bossroom contains 5 orphaned walkable floor(s), including -17,120@y0.000.
129. **ISSUE-129** — supplement:industrial-v1-main-region:routenetwork:4:node:1:industrial-v1-main-region-route-network-grant-coverage-conveyorroom_bossroom contains 5 unexpectedly blocked room-owned floor(s), including -16,124@y0.000.
130. **ISSUE-130** — supplement:industrial-v1-main-region:routenetwork:4:node:1:industrial-v1-main-region-route-network-grant-coverage-conveyorroom_bossroom contains 5 room-owned floor(s) that cannot return to the dungeon start, including -17,120@y0.000.
131. **ISSUE-131** — supplement:industrial-v1-main-region:routenetwork:4:node:1:industrial-v1-main-region-route-network-grant-coverage-conveyorroom_bossroom does not provide one locally clear, bidirectional component from every exact connector approach through all of its realized floors.
132. **ISSUE-132** — supplement:industrial-v1-main-region:routenetwork:4:node:2:industrial-v1-main-region-route-network-grant-coverage-conveyorroom_bossroom does not physically realize its complete 21-tile declared base-floor footprint with room-owned, reachable, returnable floors (realized=21, missing=0, blocked=0, unreachable=0, local=18, nonreturnable=18, first=-5,125@y0.000).
133. **ISSUE-133** — supplement:industrial-v1-main-region:routenetwork:4:node:2:industrial-v1-main-region-route-network-grant-coverage-conveyorroom_bossroom contains 6 unexpectedly blocked room-owned floor(s), including -8,125@y2.333.
134. **ISSUE-134** — supplement:industrial-v1-main-region:routenetwork:4:node:2:industrial-v1-main-region-route-network-grant-coverage-conveyorroom_bossroom does not provide one locally clear, bidirectional component from every exact connector approach through all of its realized floors.
135. **ISSUE-135** — supplement:industrial-v1-main-region:routenetwork:5:node:1:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom contains 33 orphaned walkable floor(s), including 30,144@y2.800.
136. **ISSUE-136** — supplement:industrial-v1-main-region:routenetwork:5:node:1:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom contains 3 unexpectedly blocked room-owned floor(s), including 30,141@y2.333.
137. **ISSUE-137** — supplement:industrial-v1-main-region:routenetwork:5:node:1:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom contains 33 room-owned floor(s) that cannot return to the dungeon start, including 30,144@y2.800.
138. **ISSUE-138** — supplement:industrial-v1-main-region:routenetwork:5:node:1:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom does not provide one locally clear, bidirectional component from every exact connector approach through all of its realized floors.
139. **ISSUE-139** — supplement:industrial-v1-main-region:routenetwork:5:node:2:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom does not physically realize its complete 21-tile declared base-floor footprint with room-owned, reachable, returnable floors (realized=21, missing=0, blocked=0, unreachable=1, local=17, nonreturnable=17, first=22,144@y0.000).
140. **ISSUE-140** — supplement:industrial-v1-main-region:routenetwork:5:node:2:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom contains 19 orphaned walkable floor(s), including 22,144@y0.000.
141. **ISSUE-141** — supplement:industrial-v1-main-region:routenetwork:5:node:2:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom contains 7 unexpectedly blocked room-owned floor(s), including 27,145@y2.800.
142. **ISSUE-142** — supplement:industrial-v1-main-region:routenetwork:5:node:2:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom contains 19 room-owned floor(s) that cannot return to the dungeon start, including 22,144@y0.000.
143. **ISSUE-143** — supplement:industrial-v1-main-region:routenetwork:5:node:2:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom does not provide one locally clear, bidirectional component from every exact connector approach through all of its realized floors.
144. **ISSUE-144** — supplement:industrial-v1-main-region:routenetwork:5:node:4:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom does not physically realize its complete 37-tile declared base-floor footprint with room-owned, reachable, returnable floors (realized=37, missing=0, blocked=0, unreachable=0, local=1, nonreturnable=1, first=7,151@y0.000).
145. **ISSUE-145** — supplement:industrial-v1-main-region:routenetwork:5:node:4:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom does not provide one locally clear, bidirectional component from every exact connector approach through all of its realized floors.

### JUNCTION — Connector-module component and approach-count contracts

146. **ISSUE-146** — supplement:industrial-v1-main-region:routenetwork:1:operation:0:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom:route-station:industrial-v1_main-region_route-socket_enemyNest_keycardRoom_0 connector module is not one exact-elevation, bidirectionally walkable component across at least 3 physically assembled approaches.
147. **ISSUE-147** — supplement:industrial-v1-main-region:routenetwork:1:operation:0:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom:route-station:industrial-v1_main-region_route-socket_enemyNest_keycardRoom_1 connector module is not one exact-elevation, bidirectionally walkable component across at least 3 physically assembled approaches.
148. **ISSUE-148** — supplement:industrial-v1-main-region:routenetwork:2:operation:0:industrial-v1-main-region-route-network-grant-coverage-keycardroom_traproom:route-station:industrial-v1_main-region_route-socket_keycardRoom_trapRoom_0 connector module is not one exact-elevation, bidirectionally walkable component across at least 3 physically assembled approaches.
149. **ISSUE-149** — supplement:industrial-v1-main-region:routenetwork:2:operation:0:industrial-v1-main-region-route-network-grant-coverage-keycardroom_traproom:route-station:industrial-v1_main-region_route-socket_keycardRoom_trapRoom_1 connector module is not one exact-elevation, bidirectionally walkable component across at least 3 physically assembled approaches.
150. **ISSUE-150** — supplement:industrial-v1-main-region:routenetwork:3:operation:0:industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom:route-station:industrial-v1_main-region_route-socket_trapRoom_conveyorRoom_0 connector module is not one exact-elevation, bidirectionally walkable component across at least 3 physically assembled approaches.
151. **ISSUE-151** — supplement:industrial-v1-main-region:routenetwork:3:operation:0:industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom:route-station:industrial-v1_main-region_route-socket_trapRoom_conveyorRoom_1 connector module is not one exact-elevation, bidirectionally walkable component across at least 3 physically assembled approaches.
152. **ISSUE-152** — supplement:industrial-v1-main-region:routenetwork:4:operation:0:industrial-v1-main-region-route-network-grant-coverage-conveyorroom_bossroom:route-station:industrial-v1_main-region_route-socket_conveyorRoom_bossRoom_0 connector module is not one exact-elevation, bidirectionally walkable component across at least 3 physically assembled approaches.
153. **ISSUE-153** — supplement:industrial-v1-main-region:routenetwork:4:operation:0:industrial-v1-main-region-route-network-grant-coverage-conveyorroom_bossroom:route-station:industrial-v1_main-region_route-socket_conveyorRoom_bossRoom_1 connector module is not one exact-elevation, bidirectionally walkable component across at least 3 physically assembled approaches.
154. **ISSUE-154** — supplement:industrial-v1-main-region:routenetwork:5:operation:0:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom:route-station:industrial-v1_main-region_route-socket_bossRoom_shrineRoom_0 connector module is not one exact-elevation, bidirectionally walkable component across at least 3 physically assembled approaches.
155. **ISSUE-155** — supplement:industrial-v1-main-region:routenetwork:5:operation:0:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom:route-station:industrial-v1_main-region_route-socket_bossRoom_shrineRoom_1 connector module is not one exact-elevation, bidirectionally walkable component across at least 3 physically assembled approaches.
156. **ISSUE-156** — supplement:industrial-v1-main-region:routenetwork:5:operation:0:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom:route-station:industrial-v1_main-region_route-socket_bossRoom_shrineRoom_2 connector module is not one exact-elevation, bidirectionally walkable component across at least 3 physically assembled approaches.
157. **ISSUE-157** — supplement:industrial-v1-main-region:routenetwork:0:node:0:industrial-v1-main-region-route-network-grant-keycard-pyramid-loop connector module is not one exact-elevation, bidirectionally walkable component across at least 3 physically assembled approaches.
158. **ISSUE-158** — supplement:industrial-v1-main-region:routenetwork:1:node:0:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom connector module is not one exact-elevation, bidirectionally walkable component across at least 2 physically assembled approaches.
159. **ISSUE-159** — supplement:industrial-v1-main-region:routenetwork:1:node:3:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom connector module is not one exact-elevation, bidirectionally walkable component across at least 2 physically assembled approaches.
160. **ISSUE-160** — supplement:industrial-v1-main-region:routenetwork:2:node:0:industrial-v1-main-region-route-network-grant-coverage-keycardroom_traproom connector module is not one exact-elevation, bidirectionally walkable component across at least 2 physically assembled approaches.
161. **ISSUE-161** — supplement:industrial-v1-main-region:routenetwork:2:node:3:industrial-v1-main-region-route-network-grant-coverage-keycardroom_traproom connector module is not one exact-elevation, bidirectionally walkable component across at least 2 physically assembled approaches.
162. **ISSUE-162** — supplement:industrial-v1-main-region:routenetwork:3:node:0:industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom connector module is not one exact-elevation, bidirectionally walkable component across at least 2 physically assembled approaches.
163. **ISSUE-163** — supplement:industrial-v1-main-region:routenetwork:3:node:3:industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom connector module is not one exact-elevation, bidirectionally walkable component across at least 2 physically assembled approaches.
164. **ISSUE-164** — supplement:industrial-v1-main-region:routenetwork:4:node:0:industrial-v1-main-region-route-network-grant-coverage-conveyorroom_bossroom connector module is not one exact-elevation, bidirectionally walkable component across at least 2 physically assembled approaches.
165. **ISSUE-165** — supplement:industrial-v1-main-region:routenetwork:4:node:3:industrial-v1-main-region-route-network-grant-coverage-conveyorroom_bossroom connector module is not one exact-elevation, bidirectionally walkable component across at least 2 physically assembled approaches.
166. **ISSUE-166** — supplement:industrial-v1-main-region:routenetwork:5:node:0:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom connector module is not one exact-elevation, bidirectionally walkable component across at least 2 physically assembled approaches.
167. **ISSUE-167** — supplement:industrial-v1-main-region:routenetwork:5:node:3:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom connector module is not one exact-elevation, bidirectionally walkable component across at least 2 physically assembled approaches.
168. **ISSUE-168** — supplement:industrial-v1-main-region:routenetwork:5:node:5:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom connector module is not one exact-elevation, bidirectionally walkable component across at least 2 physically assembled approaches.

### ASSEMBLY — Aggregate supplemental-assembly failures

169. **ISSUE-169** — Supplement assembly contains 137 blocked owned floor(s), including -39,51@y14.000.
170. **ISSUE-170** — Supplement assembly contains 66 orphaned corridor floor(s), including -17,120@y0.000.
171. **ISSUE-171** — Supplement assembly contains 66 owned floor(s) without a return path to the dungeon start, including -17,120@y0.000.

### OPERATION — Route-network elevation-layer integration

172. **ISSUE-172** — supplement:industrial-v1-main-region:routenetwork:5:operation:0:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom does not form one realized operation graph with every declared elevation layer joined by an assembled ramp, ladder, lift, or internal split-level route.

### SPAWN — Encounter spawn-floor validity

173. **ISSUE-173** — supplement:industrial-v1-main-region:routenetwork:2:node:1:industrial-v1-main-region-route-network-grant-coverage-keycardroom_traproom:encounter spawn 4 is not placed on a reachable floor owned by supplement:industrial-v1-main-region:routenetwork:2:node:1:industrial-v1-main-region-route-network-grant-coverage-keycardroom_traproom at the declared elevation.
174. **ISSUE-174** — supplement:industrial-v1-main-region:routenetwork:4:node:1:industrial-v1-main-region-route-network-grant-coverage-conveyorroom_bossroom:encounter spawn 2 is not placed on a reachable floor owned by supplement:industrial-v1-main-region:routenetwork:4:node:1:industrial-v1-main-region-route-network-grant-coverage-conveyorroom_bossroom at the declared elevation.
175. **ISSUE-175** — supplement:industrial-v1-main-region:routenetwork:5:node:1:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom:encounter spawn 3 is not placed on a reachable floor owned by supplement:industrial-v1-main-region:routenetwork:5:node:1:industrial-v1-main-region-route-network-grant-coverage-bossroom_shrineroom at the declared elevation.

## Completion rule

This register is closed only when the canonical seed applies on attempt 1 with zero current-validator and strict-realized errors; sealed 10/100/1,000 accepted-parent evidence with one git/source/profile provenance proves zero fallback, exact ordinal coverage, first-attempt application, diversity, and the performance budget; the canonical unit, blueprint, enclosure, legacy replay, persistence/lifecycle, and ordinary-movement Playwright journeys pass; and no issue is removed merely by suppressing or weakening a validator without a versioned contract decision.
