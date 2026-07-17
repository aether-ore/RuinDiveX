# VA-RUK 09 — Ascension Engine Implementation Notes

This is a factual description of the current `ascensionEngine` Boss Hunt implementation as of 2026-07-16. It describes runtime behavior that exists in source. Ideas that are not yet implemented are kept in the final section.

## Player-facing contract

VA-RUK 09 · The Ascension Engine is a dedicated Launch Leg boss whose arena is the dungeon. Selecting this Boss Hunt preserves the standard start zone and expedition exterior—including Roll, the Support Car, garage, workshop, practice course, Key Seeker, reset console, and Ruin Lift—but replaces the procedural ruin interior with the authored Vertical Transit Reliquary. Generic keycard, trap, conveyor, shrine, side-room, and ordinary interior encounter content is absent. The tower has a 64-unit playable diameter, an 82-unit architectural height, a 68.5-unit ascent, a 278-unit routed path, and a 54-unit-diameter summit confrontation.

The repeated loop is:

1. Read the boss landing telegraph and let its impact activate or reposition the next traversal mechanism.
2. Climb through the chamber while avoiding the landing shockwave or booster wash.
3. Reach the seal station and attack the one exposed Compression Seal during the punish window.
4. After the seal is durably committed, observe the next route and continue upward.

Ordinary attacks cannot damage the boss body. The encounter exposes only the active Compression Seal as a combat target, and each successfully committed seal removes exactly one quarter of boss health. Damage cannot skip a chamber or spill into a later seal. Phase II begins after the third seal, when the boss reaches the 25% summit segment.

## Authored route

| Segment | Stable ID | Current traversal and attack language | Durable result |
|---|---|---|---|
| 1 — The Compression Foundry | `compressionFoundry` | Two impact-armed launch vents with a central landing platform; targeted pounces and a foundry vent impact teach the impact-to-route rule. | Seal One commits checkpoint `ascensionCheckpoint:compressionFoundry`. |
| 2 — The Broken Elevator Spine | `brokenElevatorSpine` | Two rising counterweights and a rotating bridge are commanded by repeated wall-rebound impacts. | Seal Two commits checkpoint `ascensionCheckpoint:brokenElevatorSpine`. |
| 3 — The Suspended Machinery Sea | `suspendedMachinerySea` | Three momentum platforms form a launch chain while booster wash pushes across the route. | Seal Three commits checkpoint `ascensionCheckpoint:suspendedMachinerySea` and starts Phase II. |
| 4 — The Summit Trial | `summitTrial` | A launch vent reaches the summit. The active deck uses targeted pounce, a two-leg double rebound, paired-ring compression sweep, skyfall breaker, and a faster emergency pogo, with a punish window after each completed attack. | The fourth seal enters a timed escape charge and, when broken, commits victory and the reward decision atomically. |

The initial floor is checkpoint index 0 (`ascensionCheckpoint:initialFloor`). The three nonfinal seals advance indices 1–3 in exact order. There is intentionally no fourth checkpoint record: the fourth seal and victory are one transaction.

The route topology and critical landing volumes are fixed. The expedition seed changes deterministic attack-deck order, not the required platform positions. At reset, only sequence zero is unlocked, enabled, and visible, and every moving surface returns to its authored height and transform. Each registered boss impact arms the current route surface and reveals exactly the next sequence. A moving lift remains at its authored base height until MegaMan boards it, then carries him to its exact target height and holds while he remains aboard or airborne directly above its footprint. If he leaves or falls below it, the empty lift pauses for 0.3 seconds, returns to its authored base, and rearms without requiring another boss impact; boarding during the return reverses it safely upward. This shared retry behavior applies to all ten rising momentum and counterweight platforms, while the two zero-rise bridges and launch vents retain their distinct behavior. The first three chambers contain 22 boss-impact-gated surfaces (6 + 8 + 8), followed by the pre-armed summit vent; all 23 route surfaces are excluded from ordinary ledge-candidate generation.

All encounter vents use 18 vertical and 10 horizontal units per second through the normal jump integrator, preserving air control. A vent fires only when MegaMan reaches its visible 1.55-unit-radius core. While that authored launch is active, the player exposes its gravity-derived ballistic apex to the normal landing resolver. Ordinary and vent-assisted jumps may cross clear, in-bounds Reliquary shaft air; walls, doors, ceilings, solids, and the outer shaft boundary still block movement, while a missed platform falls into checkpoint recovery. Pure traversal diagnostics validate both vertical reach and horizontal landing error, including the 27-unit-radius summit landing volume.

The boss leads every chamber. It attacks sequence zero without waiting for MegaMan, impacts and arms that mechanism, then withdraws to a visible hover waypoint beside the following support. Every waypoint is 3.5 units above its referenced support and at least 4.5 units beyond the support edge, keeping the complete authored boss silhouette clear of the player's landing. The Engine holds that forward position until MegaMan physically completes the prior mechanism, then attacks the next destination. Dynamic mechanisms count only after reaching their exact target height; a launch vent counts only on a real launch. For a vent chain, the Engine impacts and clears the immediate landing before the vent is permitted to fire. Equal-height overlapping handoffs still require real grounded movement through their shared footprint. After the final route mechanism, the boss leads to the seal station but keeps the seal armored until MegaMan catches it; after a committed seal, it visibly ascends into the next chamber instead of teleporting. The summit preserves the boss at its actual pounce landing for the punish window.

### Jump Springs mastery route

The Reliquary also authors one stable mastery ledge per segment:

- `verticalReliquaryMastery:compressionFoundry`
- `verticalReliquaryMastery:brokenElevatorSpine`
- `verticalReliquaryMastery:suspendedMachinerySea`
- `verticalReliquaryMastery:summitTrial`

Each ledge rises 3.82 units from its segment start and bypasses that segment's boss-impact mechanism chain. That rise exceeds the ordinary ledge envelope but fits the same envelope multiplied by Jump Springs' typed 1.3 reach modifier. The pure diagnostics consequently require all four shortcuts to be unreachable normally and reachable with Jump Springs.

Activation checks the equipped Mobility gear ID, not a display string or a generic stat threshold: `gearLoadout.getId('mobility')` must equal `jumpSprings`. Without that gear, all mastery ledges are hidden, disabled, and excluded from traversal. During combat, only the current segment's mastery ledge is active; after victory, all four are available. Equipping or removing Jump Springs updates the platform descriptors and rebuilds ledge candidates. The environment manifest lists all four stable mastery platform IDs, and the encounter objective explicitly directs an equipped player to master the current chamber via the Jump Springs ledge.

## Failure, checkpoint, and final-charge behavior

A live shaft fall or unsupported shaft-boundary escape cancels transient attacks, resets only the current chamber mechanisms, and restores the latest checkpoint while preserving current health and barrier. A true player defeat performs the same route reset but clears the death state, raises health to at least 50% of maximum, and fully refills the barrier. Authored platform support, including the initial platform's corners, prevents false boundary resets. Earlier chambers are not replayed.

During the summit, the fourth seal stops at 42% of its own integrity and begins a five-second final escape charge. Breaking it during that charge requests the durable victory transaction before the boss can die. If the timer expires, the boss performs an unguardable meteor hit worth 75% of player maximum health and leaves the final seal exposed for another punish window. When an ordinary summit punish window or that retry window expires, the encounter returns directly to the summit attack deck without re-entering `escape`, replaying the phase transition, moving either combatant, or rebuilding the summit trial. Only initial summit entry and a deliberate chamber reset rearm the launch sequence. A failed save also leaves the seal retryable instead of presenting an uncommitted victory.

The boss HUD uses four health segments, reports the current chamber, secured checkpoint, broken-seal count, encounter mode, active-seal integrity, and final-charge failures. The objective text follows the same `traversal`, `punish`, `escape`, `summit`, and `finalCharge` modes.

## Visual and environment implementation

The runtime boss is authored directly in Three.js rather than loaded from a GLB or represented by a unique semantic texture set. `AuthoredAscensionEngine.js` builds the signature silhouette from named, flat-shaded low-poly parts:

- a shrine-tower upper body;
- a dominant faceted ruby hip optic;
- a long telescoping compression spine with four independent glowing seals;
- twin downward boosters;
- three broad landing claws;
- stabilizer arms and visible compression collars.

`DungeonGenerator.js` dispatches the selected Ascension profile to a dedicated world contract with one controlled Boss Hunt entry and one boss encounter. `VerticalTransitReliquary.js` owns the shaft shell, ruin pillars and rings, chamber architecture, checkpoint and seal-station platforms, launch vents, counterweights, rotating bridge, momentum platforms, route beacons, the vertical minimap projection, the gear-gated mastery ledges, collision descriptors, platform carry, camera/fog profile, and disposal. `AscensionEngineEncounter.js` owns transient boss movement, landing telegraphs, shockwaves, booster wash, combat targets, route pacing, state transitions, and cleanup. This keeps solid traversal geometry in the dungeon boundary while the boss controller owns temporary combat effects.

Visible pillars, elevator rails, foundry pistons, suspended fragments, and summit spires register stable solid-zone descriptors in both dungeon collision consumers. Inside the 31.6-unit shaft radius, the stock floor is overridden to elevation -12 and is non-walkable unless an enabled authored platform supplies support. The summit station uses radial support with radius 27; square bounding-box corners do not count as floor.

The supplied concept board is a visual reference, not a runtime texture or portrait source. Its provenance is recorded in [the Ascension Engine concept folder](concepts/ascension-engine/README.md). The 256×256 RGBA Boss Hunt portrait was captured from the implemented runtime object at `assets/textures/reaverbots/bosses/ascensionEngine/hunt-portrait.png`.

After victory, the Reliquary leaves every chamber visible, raises dynamic route platforms to their completed positions, and leaves launch vents ready. Equipping Jump Springs additionally reveals all four mastery ledges, creating a gear-gated ascent that bypasses each original boss-impact chain and expresses the earned mobility advantage directly in the cleared arena.

The completed environment remains responsible for fall recovery after the encounter controller is disposed. A living player below `y = -2.35` is returned to the initial floor without changing health or barrier, and the camera snaps to the restored position.

## Persistence and recovery contract

Ascension progress uses encounter schema version 1 and encounter revision 2 inside Boss Hunt expedition schema version 2. The canonical durable record contains:

- `encounterId: "verticalTransitReliquary"`;
- the stable secured checkpoint ID and index;
- the exact ordered prefix of broken seal IDs;
- no mutable Three.js object, active attack, platform position, partial seal integrity, or temporary VFX state.

Checkpoint writes are exact-next, monotonic, idempotent, and rejected for a different profile, closed expedition, stale order, mismatched seal, or read-only storage. On load, malformed progress is quarantined rather than reinterpreted. Debug and sandbox paths do not consume campaign first-clear progression.

Active campaign records with missing, null, stale-revision, or otherwise malformed Ascension progress are marked as quarantined and abandoned so they can be restarted safely; they never fall back to checkpoint zero. The warning and quarantine count persist without multiplying across reloads. A valid checkpoint-three resume reconstructs the summit at 25% health directly in Phase II. Checkpoint and broken-seal indices are accepted only as exact numeric integers.

The final seal calls `recordAscensionBossVictory`, which requires checkpoint index 3 and commits the victory, reward decision, pending Boss Recovery, victory count, and expedition closure together. The recorded reward material ID is authoritative. Normalization reconstructs a missing pending recovery from a valid victorious expedition record, preventing loss of a progression-critical first-clear part.

Legacy victory records that omit `reward.materialId` migrate from the profile's canonical reward. An explicit unknown material ID is instead quarantined with its expedition and cannot be converted into a different reward. Ascension also coerces signature-overload provenance to false even through the generic Boss victory API, so repeat recovery remains the deterministic 70% roll advertised by its Hunt card.

## Reward and Jump Springs acquisition

The boss advertises the ordinary `launchLeg` module for generation, but its Boss Hunt reward is the separate `perfectedCompressionGreave` material. The Perfected Compression Greave is registered in the shared material catalog without entering ordinary procedural salvage source maps, so a random Launch Leg cannot replace the boss keystone.

The first campaign clear guarantees one pending Perfected Compression Greave Boss Recovery. Repeat clears use the shared deterministic 70% Boss Hunt recovery rule. Roll's **Identify All** action transfers the durable recovery into her named-part stockpile.

The implemented Jump Springs recipe consumes exactly:

- 12 Identified Scrap;
- 1 Perfected Compression Greave;
- 1 Tempered Jump Spring;
- 1 Stabilized Belly Core.

Fabrication permanently unlocks Jump Springs but does not auto-equip them. They occupy the Mobility slot and apply `jumpReachMultiplier: 1.3` when equipped. That exact typed equipment unlocks the Reliquary's four mastery ledges; merely having the part or fabricating the gear without equipping it does not. The Boss Hunt card reveals Jump Springs as a known recipe once the reward material is discovered.

## Source map

- Boss identity, fixed generation, encounter selection, reward resolver: `src/reaverbots/ReaverbotBossCatalog.js`
- Pure topology, modes, stable checkpoints, seeded attack decks, traversal diagnostics: `src/reaverbots/bosses/AscensionEngineContract.js`
- Dedicated encounter runtime: `src/reaverbots/bosses/AscensionEngineEncounter.js`
- Dungeon-owned environment and dynamic platform descriptors: `src/reaverbots/bosses/VerticalTransitReliquary.js`
- Code-authored boss model and animation: `src/reaverbots/AuthoredAscensionEngine.js`
- Boss adapter and combat integration: `src/reaverbots/ReaverbotBossEnemy.js`
- Special boss-room construction: `src/DungeonGenerator.js`
- World lifecycle, objective, checkpoint and victory bridges: `src/Game.js`
- Traversal launch and checkpoint restore APIs: `src/Player.js`
- Durable checkpoint, victory, recovery, and debug suppression rules: `src/buster/BusterLabStorage.js`
- Boss-only material: `src/reaverbots/ReaverbotSalvageCatalog.js`
- Jump Springs bill of materials: `src/equipment/EquipmentRecipeCatalog.js`
- Jump Springs effect: `src/equipment/GearCatalog.js`
- Four-segment HUD and Boss Hunt recipe discovery: `index.html`, `src/UIManager.js`, `src/ui.css`

## Verification entry points

The 2026-07-16 traversal-correction pass ran these focused gates successfully:

```text
node --test tests/ascension-engine-contract.test.mjs tests/equipment-runtime.test.mjs
npx playwright test tests/ascension-engine-runtime.spec.js --workers=1
npx playwright test tests/screen-targeting-ui.spec.js --grep "lock" --workers=1
```

The focused Ascension browser suite contains a complete-playthrough case that starts at checkpoint zero, uses the production player jump and landing integrator plus dungeon walkability correction, occupies every route surface in order, requires every boss impact and every seal/ascent flight, dodges live shockwaves by jumping, fires real Mega Buster projectiles into the visible active collar, commits all three checkpoints, enters Phase II, completes a real summit attack and punish window, starts the final charge, and kills the boss. It records every boss/player route timeline and fails unless the boss impacts first, withdraws to the exact clear forward waypoint, holds until catch-up, leaves each landing clear, and obeys the vent pre-clear exception. Any unreachable platform, player-first impact, skipped mechanism, stalled lead, occupied landing, inactive or body-occluded seal, failed checkpoint, missing summit cycle, reset, or non-defeatable finale fails the case.

A focused lift-retry regression inventories all ten `boardTriggeredLift` routes, keeps vents and zero-rise bridges outside that policy, and exercises `elevatorCounterweightA` after the first checkpoint. It verifies that jumping vertically over the footprint does not abandon the ride, jumping outward during ascent returns the lift exactly to base and rearms it, and a second boarding reaches the target with valid support and no second boss impact. The delivered-rider latch must remain false for the failed ride and become true only after the successful ascent.

A separate summit lifecycle regression begins from the durable third checkpoint, follows the automatic launch vent into Phase II, completes live summit attacks, and deliberately lets both an ordinary punish window and a failed final-charge retry expire. It requires each recovery to transition directly from `punish` to `summit`, keeps the fourth seal unbroken, and fails on any `escape` re-entry, repeated summit initialization, phase banner replay, phase restart, or encounter reset.

`tests/ascension-engine-contract.test.mjs` covers stable checkpoint identities, exact seal order, deterministic decks, landing safety margins, assisted launch envelopes, mastery-route reachability boundaries, and the 25% summit threshold. The Boss Hunt storage cases in `tests/buster-lab-storage.test.mjs` cover exact-next typed checkpoint writes, idempotency, malformed-progress quarantine, explicit-unknown reward quarantine, overload suppression, premature-victory rejection, atomic reward creation, and persisted material identity. Dedicated environment, authored-model, public gallery, combat-target, resource-cleanup, seal-order, checkpoint-three Phase II reconstruction, post-clear recovery, stable mastery IDs, typed gear activation, segment-scoping, and the full playable encounter live in `tests/ascension-engine-runtime.spec.js`; the broader boss gallery remains in `tests/reaverbot-boss-runtime.spec.js`.

The separate `npm run verify:buster-balance` gate remains blocked by the frozen v0.2 catalog verdict, with zero hard-correctness failures and three role failures: `spread-explosion-separated-coverage`, `delayed-cluster-separated-role`, and `declared-module-dominance`. No catalog constants or role thresholds were changed for this boss work.

Recorded visual evidence now includes the runtime-generated 256×256 RGBA hunt portrait and a gameplay-distance Compression Foundry/HUD capture. Remaining visual follow-up is to preserve representative captures of the Broken Elevator Spine, Suspended Machinery Sea, summit, simultaneous telegraph and shockwave readability, checkpoint restoration, and completed post-clear mastery ascent; these are listed separately from implemented runtime behavior in the concept provenance record.
