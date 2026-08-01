# Dungeon Augmentation V4 Release-Issue Register

<!-- V4_RELEASE_EVIDENCE_START -->
## Release evidence status — blocked

No sealed aggregate-and-receipts attestation has been supplied for this working tree.

- Authoritative profile: `industrial-supplement-preview-v4` revision 5.
- Immutable accepted-parent corpus: **not supplied**.
- Ordinal shard coverage: **not established**.
- First-realization, strict-validation, diversity, and performance gates: **not established**.
- Overall V4 release readiness: **blocked**.

This block is intentionally conservative. A canonical validator witness, a playable-alpha run, or a corpus aggregate without all same-source receipts cannot establish release. Supply `--evidence=<release-attestation.json>` only after the manifest shards and every required suite receipt have been sealed.
<!-- V4_RELEASE_EVIDENCE_END -->

## Canonical validator witness — release blocked

Verified 2026-07-31 against profile `industrial-supplement-preview-v4` revision 5 and deterministic seed `layout:augmentation-realized-v4-000`.

- Augmentation status: **unchanged** (atomic authored-parent fallback).
- First-realization acceptance: **failed during materialization after successful planning**.
- Planner final-graph validation: **passed**.
- Invalid-alpha bypass used: **no**.
- Materialization diagnostics: **4 `DUNGEON_AUGMENTATION_ROUTE_WRONG_SEAM_SIDE` errors**.
- Final collision-derived release validator: **not reached**.
- Strict one-seed realized verifier: **not reached**.
- Overall V4 release readiness: **blocked**.

The previous zero-error canonical witness is stale and must not be treated as release evidence. Exact seam ownership, materializer ownership, and strict validation have since changed. The current first-derived seed no longer reports ISSUE-066, the five pyramid endpoint-seam mismatches, or the boss-to-shrine featureless-span defect, but it still does not produce an overlay, so the 175-entry historical register as a whole cannot be declared closed. The original register remains unchanged as historical evidence, and the completion rule at the end of this document still applies.

### Current actionable canonical failure

The first-attempt plan now succeeds with 6 operations, 30 supplemental rooms, 37 segments, and zero accumulated featureless-span records. Materialization then rejects four independent paths with `DUNGEON_AUGMENTATION_ROUTE_WRONG_SEAM_SIDE`: pyramid network 0 segment 1, `enemyNest_keycardRoom` network 1 segment 1, `trapRoom_conveyorRoom` network 3 segment 0, and `conveyorRoom_bossRoom` network 4 segment 0. Atomic fallback therefore remains correct. This is not an accepted or realized release witness, and the Chromium GPU/SharedImage diagnostics remain a separate capture-stability concern.

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
| V4 structural frames require entrance, bend, junction, and interval coverage. | Required multi-role records now bind exact floors, wall runs, clearance, theme, and renderer IDs; missing, duplicated, renamed, or unsafe realizations reject before rendering. | **Resolved in implementation; realized/browser evidence remains outstanding.** |
| Transfer endpoints must bind to exact authoritative floor-cell identities. | Every V4 transfer now resolves authored floor-cell or transfer-cell endpoint identities, including even-footprint lift boarding cells; nearest/grid fallback remains legacy-only. | **Resolved in implementation; realized traversal evidence remains outstanding.** |
| Encounters, rewards, and mechanisms are required to resolve after finalized collision. | One renderer-free resolver now confines all gameplay anchors to declared cells/zones/tiers after solid and walkability inputs, including far-side shortcut controls; failure rejects the overlay before scene factories. | **Resolved in implementation; live journey evidence remains outstanding.** |
| The outer eight-seed realization retry must remain as defensive fallback, while release-corpus layouts are required to apply on their first derived seed. | Runtime retains its defensive retry, while every accepted-parent manifest entry records and validates its first derived realization. | **Adopted:** the canonical witness and every entry in the 10/100/1,000 release corpora must apply on attempt 1. The requirement does not claim every theoretical seed worldwide. |
| The 175-record current-validator count can be zero before the strict 10/100/1,000 sweeps and browser journeys pass. | This register remains open and release is blocked until all completion gates pass. | Recommended interpretation: “close all 175” means root-cause closure proven by the full strict gates, not a zero from one weaker validator witness. |
| The public ID contains `preview-v4`, but ordinary requests are now release-authoritative and alpha bypass requires a second explicit flag. | The ID and revision remain unchanged for save/hash compatibility; authority is determined by validation, not the word “preview.” | Confirm whether a future non-preview alias should be introduced after the release gates pass. |
| V1 authored connectors retain arches, while supplemental V4 routes use structural frames. Older validation treated the V1 arch cadence as universal. | Presentation validation is versioned: V1 arches remain immutable; V4 requires theme-bound entrance, bend, junction, and interval frame coverage. | No code decision is currently blocked; retain this row as the resolved presentation-policy record. |
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
- V1 authored arches and V4 supplemental structural frames remain separate presentation contracts.

### Release evidence workflow

1. Build one immutable accepted-parent manifest containing exactly 1,000 entries. Each entry contains its ordinal, raw seed index, exact seed and base-plan hash, and a hash of the disabled authored-parent layout plus source RNG consumption. Smoke is the first 10 ordinals, normal is the first 100, and release is all 1,000; they never use separate parent manifests.
2. Run realized verification by manifest ordinal and explicit view. Required partitions are 1×10 for `smoke`, 10×10 for `normal`, and 20×50 for `release`. Raw `--start` ranges are not release evidence because skipped parent seeds make those ranges overlap or leave gaps.
3. Each manifest ordinal runs in its own verifier worker with a hard 180-second watchdog. The orchestrator combines successful one-seed records into the canonical sealed, atomic shard JSON containing provenance, expected ordinals, every strict result, first-attempt status, validation state, signatures, and elapsed time. A timed-out or failed worker produces a failed canonical shard without allowing later seeds to hide the failure.
4. Aggregate shards against the same manifest and exact tier topology. Every JSON supplied directly or discovered in a shard directory must be a valid shard for that manifest and source hash; unrelated, stale, or mixed-manifest files are rejected rather than filtered out. The aggregator also rejects duplicate or missing ordinals, fallback, retries, validator or strict-verifier failures, accepted-parent drift, diversity violations, and performance-budget violations.
5. Run the five immutable suite contracts and seal one receipt for each: canonical unit/blueprints, enclosure, legacy replay, persistence/lifecycle, and ordinary-movement/disposable-alpha Playwright journeys. Every receipt must retain the aggregate's exact git commit, source hash, runtime platform, profile hash, and machine provenance before and after its commands.
6. Finalize the release aggregate and all five receipts into one sealed attestation. Missing, duplicated, substituted, failed, source-drifted, or mixed-SHA receipts reject finalization. Regenerate only the narrow evidence block at the top of this document from that attestation; a corpus aggregate by itself is deliberately not accepted.

Example normal-view commands (run shard indexes 0 through 9, normally on parallel CI workers):

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

The release validator still requires complete-gallery V1 arch decoration on authored and supplemental routes. This is presentation coverage, not a playable-alpha connectivity failure.

Recommended closure: Decide whether V4 inherits the V1 arch contract. If it does, emit arch coverage from the authoritative wall-run records; otherwise version-gate this validator rule.

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
