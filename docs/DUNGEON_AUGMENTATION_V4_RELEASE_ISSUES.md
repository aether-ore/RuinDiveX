# Dungeon Augmentation V4 Release-Issue Register

<!-- V4_RELEASE_CLOSURE_START -->
## Release recovery closure

Verified 2026-07-30 against profile `industrial-supplement-preview-v4` revision 5 and deterministic seed `layout:augmentation-realized-v4-000`.

- Augmentation status: **applied**.
- First-realization acceptance: **passed**.
- Release validation: **passed**.
- Invalid-alpha bypass used: **no**.
- Current release-validator issue records: **0**.
- Ordered current error-array SHA-256: `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`.

All historical `ISSUE-001` through `ISSUE-175` records below are closed for the canonical release witness because their underlying physical conditions are absent. The original register is retained unchanged as historical evidence; it is not the current validator output.

### Inconsistencies and decisions requiring confirmation

| Contract tension | Current implementation/interpretation | Decision required |
| --- | --- | --- |
| Variety is stated as a 100-seed threshold, while the smoke verifier also required at least three topology and elevation families inside every single dungeon. | Per-dungeon verification requires at least one real topology, junction, and elevation family; exact family coverage and frequency limits remain enforced by the 100-seed corpus gate. | Confirm that diversity is a corpus property, or specify explicit per-dungeon minimums and the module budget they may consume. |
| The outer eight-seed realization retry must remain as defensive fallback, while release-corpus layouts are required to apply on their first derived seed. | The retry remains in runtime code, but the realized release verifier rejects any corpus result whose `realizationAttempts` is not 1. | Confirm whether first-realization acceptance applies to all 10/100/1,000 release seeds or only the named canonical witness. |
| The 175-record register can be zero for the canonical witness before the required 10/100/1,000 sweeps and browser journeys all pass. | This document calls the historical records closed only for the canonical witness; release authorization remains a separate, stricter milestone. | Confirm whether “close all 175” means canonical root-cause closure or full release authorization. |
| The public ID contains `preview-v4`, but ordinary requests are now release-authoritative and alpha bypass requires a second explicit flag. | The ID and revision remain unchanged for save/hash compatibility; authority is determined by validation, not the word “preview.” | Confirm whether a future non-preview alias should be introduced after the release gates pass. |
| V1 authored connectors retain arches, while supplemental V4 routes use structural frames. Older validation treated the V1 arch cadence as universal. | Presentation validation is versioned: V1 arches remain immutable; V4 requires theme-bound entrance, bend, junction, and interval frame coverage. | No code decision is currently blocked; retain this row as the resolved presentation-policy record. |
| Alpha may expose invalid geometry, but alpha diagnostics must use the same collision-derived graph as release validation. | Alpha changes acceptance only; it does not substitute a weaker graph or rewrite validation results. Invulnerability is separately controlled. | No code decision is currently blocked; confirm this remains the intended debugging policy. |
| The release plan requires a three-lane threshold plus two clear approach tiles on both sides, while the pre-recovery host and validator encoded only one tile per side. | V4 host grants and validation now use an exact 3 x 5 tile envelope: two inside cells, the threshold cell, and two outside cells. | Resolved in favor of the written release plan; confirm that no legacy one-tile V4 development grant must remain accepted. |
| An exact base floor mask can be read as every room-owned floor at the base elevation, but authored ramp and transfer cells can begin at that same elevation. | Base-mask checks compare authoritative base-tier cell identities; transfer cells are validated separately through their transfer IDs and endpoint identities. | Confirm that “base mask” means the named base tier, not every physical cell whose numeric elevation equals the base tier. |
| Junction kits have named footprint dimensions such as 7 x 7 Crossroads, but their substantive floor masks are non-rectangular. | Width/depth describe the planning and clearance envelope; physical floor coverage is the exact authored tier-cell mask. | Confirm that footprint dimensions are bounding envelopes and must not require rectangle-stamped floors. |
| Exact seam ownership forbids cross-owner overlap outside the socket seam, but the current bounded solver grants an endpoint module core to its incident segment and can select a one-tile dogleg that re-enters that core. | The canonical dungeon remains playable and release-valid, but the realized sweep detects at least one connector-spine ownership witness outside the 3 x 5 seam. Enforcing exact ownership in candidate selection exhausts the current 121-candidate search budget and can exceed three minutes for one seed. | Decision required: enlarge/redesign the solver search and accept a much higher generation cost, constrain/re-author endpoint module sockets, or explicitly permit an incident connector to traverse its endpoint module floor without taking ownership. |
| The acceptance plan requires 10/100/1,000 realized sweeps, while one canonical fully realized seed currently takes roughly 90-105 seconds even before strict seam backtracking. | At current throughput, serial 100- and 1,000-seed runs are multi-hour release jobs, not practical interactive checks; strict seam search is slower still. | Decide whether release sweeps run as parallel/offline CI jobs, or establish a performance budget and require planner/materializer optimization before those gates are actionable. |

<!-- V4_RELEASE_CLOSURE_END -->
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

This register is closed only when the same profile and seed produce zero release-validation errors, the 10/100/1,000-seed release sweeps satisfy their gates, and no issue is removed merely by suppressing or weakening a validator without a versioned contract decision.
