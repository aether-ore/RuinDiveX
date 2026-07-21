# Dungeon V2 acceptance suites

This directory contains the restart suites. It intentionally contains no test copied from the quarantined V2 implementation.

- `unit/`: pure serialization, immutability, seed, transform, and state-machine contracts. These tests never claim that a dungeon is playable.
- `fixtures/`: focused physical-contract and negative-proof workbench suites. Passing this directory alone is not native dungeon acceptance.
- `native-acceptance/`: the mandatory native V1 fixed-room cutover gate. It intentionally contains a red full-complex sentinel until both hazard variants compose and pass the real universal acceptance fixture.
- `journey/`: isolated Playwright journeys driven only by public keyboard and mouse input.
- `helpers/`: the shared acceptance gate, source guardrails, synthetic negative fixtures, and read-only browser helpers.
- `retired-generic/`: preserved documentation for the rejected generated-box and generic-prefab approach. Files here are deliberately outside the recursively discovered `unit/` and `fixtures/` roots and never count toward acceptance.

The old `authored-modules`, `authored-plans`, and `authored-assemblies` suites are retired. They could validate declarations or generic shells while real player-sized routes remained blocked. The replacement guard requires native fixed-room catalog, placement/adapter, and assembler coverage plus the named full-complex sentinel. The sentinel may only turn green when it assembles all eleven native V1 rooms for both Magma and Electrical complexes and calls `assertAcceptedDungeonFixture`.

The shared gate verifies more than graph reachability. It requires the exact semantic golden regions and plan-owned progression/content; complete serializable actions; deterministic encounter rosters, seeds, and spawn points; remote ordinary keycards and final-elite-only Shrine Key; one conserved three-state water unit; explicit hazard surfaces and timing; complete mechanism transition tables; recallable automatic lifts; elevated automatic cargo; automatic crumble reset; registered physical supports; and compound multi-cell landmarks with real elevation and route variety.

Every portal also has an independent production-sized approach-clearance volume on both sides, including vertical lift/drop apertures. The proof rejects plan fixtures, interaction consoles, or active runtime colliders in either volume. Every assembled ladder is mounted through the public controller prompt, climbed with real `KeyW` and `KeyS` frame input, collision-resolved after every frame, and required to remain on its exact authored top and bottom exits without a safeguard activation.

Native module coverage compiles and renders every fixed-room descriptor at all four quarter-turn yaws, with capped and opened socket states, plan-owned collision, exact V1 floor topology, and no primitive fallback. This module coverage is necessary but is not a substitute for the full-complex sentinel or public-input journey.

Existing tests such as `pyramid-traversal.spec.js`, `conveyor-ramp-traversal.spec.js`, `machine-factory-ramp-collision.spec.js`, and `basement-return-shelf.spec.js` remain V1 regression references. Their private probes or position setup make them ineligible for V2 acceptance. Package scripts classify them under `test:dungeon-v1:regression`; they must never be included by `verify:dungeon-v2`.

The golden journeys are never skipped. A missing runtime, unavailable route, incomplete combat/exploration trace, or disabled browser suite is a failing and explicitly incomplete Milestone 1.

## End-to-end taxonomy

`test:dungeon-v2:journey` means a spawn-to-extraction playthrough of an actual default V2 level selected by `dungeonGen=v2` plus an explicit seed. It must run `golden-complex.public.spec.js` for both Undercroft variants without a `v2Fixture` URL. The journey must challenge each Alpha, Beta, Gamma, and Shrine barrier while it is still closed, explore to collect the corresponding credential, operate the gate from its authored legal side, physically cross it, finish real combat and rewards, and extract using public input.

Traversal-lab, entry-portal, jump-heartbeat, ladder-alignment, and performance-smoke journeys are mechanism or component fixtures. They run under `test:dungeon-v2:fixture-journey`; they cannot establish that a generated dungeon is solvable, even if every fixture passes. Focused checks such as the crumble/drop journey run against a real default seed under `test:dungeon-v2:seeded-fixture-journey`, but remain component evidence rather than spawn-to-extraction evidence. `verify:dungeon-v2` runs the seeded golden journey as the mandatory end-to-end gate and runs both fixture classes separately as supplemental coverage.
