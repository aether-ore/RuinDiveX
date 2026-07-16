# AGENTS.md

**Scope:** These instructions apply to the entire repository. A more specific nested `AGENTS.md` may refine them for its subtree.

## Purpose

This repository is a procedural Three.js ruin-crawler inspired by *Mega Man Legends*. Agents working here are expected to function as both game-development engineers and creative production partners.

The goal is not merely to make code compile. The goal is to create mechanics, enemies, rooms, bosses, weapons, equipment, UI, and art that are:

- fun and readable in play;
- consistent with the faux-PlayStation visual language;
- deterministic where generation or simulation promises determinism;
- integrated with the project’s existing catalogs, persistence, and testing boundaries;
- efficient enough to survive long runtime sessions and repeated dungeon transitions;
- supported by technical and visual quality assurance.

Creative work is part of implementation. When a mechanic needs a new silhouette, texture, VFX treatment, procedural part, authored model, portrait, icon, or presentation asset, make the appropriate asset rather than leaving an invisible or misleading placeholder. Conversely, do not create new art when an existing procedural or semantic asset can express the mechanic clearly.

---

## Authority and source of truth

Use this priority order:

1. The user’s current request.
2. This `AGENTS.md`.
3. The current checked-out code and tests.
4. Current factual implementation notes.
5. Approved design documents and concept sheets.
6. Older audits, proposals, and historical plans.

When documentation and implementation disagree, verify the current code and tests before acting. Then update stale factual documentation as part of the change.

Do not treat concept art, proposals, or tooltip text as proof that a runtime feature exists.

Do not switch branches, commit, push, open a pull request, delete user work, or rewrite unrelated systems unless the task explicitly requires it.

Preserve uncommitted changes. Make the smallest coherent change that satisfies the requested design.

---

## Core operating loop

For any substantial task:

1. **Inspect**
   - Read the relevant catalogs, runtime consumers, tests, UI, and documentation.
   - Trace the complete data path instead of editing the first matching file.
   - Identify feature flags, save boundaries, generated assets, and compatibility paths.

2. **Define the contract**
   - State what the player sees and what the system guarantees.
   - Define stable IDs, inputs, outputs, failure states, cleanup rules, and persistence behavior.
   - Separate hard correctness from subjective balance or art direction.

3. **Graybox first**
   - Prove gameplay timing, targeting, collision, traversal, and readability with simple assets.
   - Do not spend time polishing an attack or boss whose underlying role is still unclear.

4. **Choose the correct asset strategy**
   - Reuse existing assets when possible.
   - Extend procedural generation when the feature should vary by seed or module.
   - Create a unique authored asset only when a signature silhouette or mechanic needs it.
   - Produce textures or VFX when geometry alone cannot communicate the theme.

5. **Implement through existing boundaries**
   - Catalog or versioned source data first.
   - Pure compilation/simulation second.
   - Three.js/runtime adapter third.
   - UI and presentation last.

6. **Verify technically and visually**
   - Run focused tests before broad suites.
   - Inspect the result at gameplay distance, not only in an isolated close-up.
   - Check deterministic behavior, cleanup, performance, save migration, and feature-off behavior where relevant.

7. **Document the factual result**
   - Update implementation notes with what now exists.
   - Keep future ideas in a proposal section or separate design document.

---

## Architectural rules

### Prefer typed, versioned contracts

Use stable IDs and explicit data structures for gameplay content.

Good:

```js
{
  id: 'gyroCrescent',
  kind: 'emitter',
  trajectory: 'expandingSpiral',
  energyCost: 3
}
```

Avoid behavior inferred from display names, tooltip strings, object colors, or arbitrary mesh ordering.

When persisted source changes meaning, update the ruleset or schema and provide an idempotent migration. Never silently reinterpret old data.

### Keep pure logic separate from Three.js

Deterministic generation, validation, compilation, trajectory mathematics, balance simulation, and transaction planning should be pure whenever practical.

Three.js adapters should own:

- scene objects;
- materials and textures;
- renderer integration;
- audio and particles;
- runtime callbacks;
- disposal and pooling.

Do not create a second independent implementation of important projectile, collision, targeting, or event-order mathematics. Share the numeric kernel between production and simulation.

### One source of truth

Do not duplicate:

- module-to-salvage mappings;
- boss-to-reward mappings;
- texture profile IDs;
- weapon balance constants;
- traversal capability values;
- recipe ingredients;
- target geometry;
- save version rules.

Derive downstream records from the authoritative catalog and make completeness tests fail when a required mapping is missing.

### Determinism is a feature

Procedural generation and balance simulation must use seeded randomness and stable tie-breaking.

Do not use `Math.random()` inside deterministic generation paths.

The same seed, ruleset, and inputs must produce the same:

- dungeon structure;
- Reaverbot genome;
- boss variant;
- projectile pattern;
- reward decision;
- simulation transcript.

### Persist source, derive runtime

Persist authored source and ownership state. Recompile or reconstruct runtime objects.

Do not persist mutable Three.js objects, compiled plans, active projectiles, temporary VFX, or derived caches unless the save design explicitly requires them.

### Fail visibly

Unknown IDs, invalid graphs, missing assets, stale revisions, unsupported migrations, and failed transactions must produce structured errors or visible warnings.

Never silently replace an unknown module, boss, texture, or item with a different gameplay object.

---

## Creative asset decision framework

Before creating art, classify the need.

### Reuse existing art when

- the new behavior uses an existing silhouette and only changes numbers or timing;
- the existing semantic texture roles communicate the feature clearly;
- a palette or emissive adjustment is sufficient;
- a shared VFX already conveys the same gameplay event;
- new art would be decorative but not improve readability.

### Create or extend a procedural asset when

- the feature should appear across multiple seeds, enemies, rooms, or expeditions;
- the shape can be assembled from reusable wedges, plates, cylinders, claws, fins, pylons, rails, vents, or other existing primitives;
- generated variation is part of the design;
- geometry affects collision, traversal, weak-point placement, telegraphing, or salvage recognition;
- a boss theme can be expressed through constrained procedural generation plus a unique texture profile.

Procedural assets must:

- be seeded;
- preserve gameplay-critical silhouettes;
- expose stable anchors for muzzles, weak points, hazards, and effects;
- participate in collision and traversal data when physically solid;
- remain within scene-object and performance budgets;
- use the same visible module IDs that drive behavior and salvage.

### Create a unique authored texture when

- a boss or major relic needs a recognizable ceremonial identity;
- the mechanic is readable in geometry but still lacks thematic surface language;
- the same mesh needs a distinct material treatment without duplicating geometry;
- a signature module, eye, shield, or energy field must be visually unmistakable;
- the existing shared maps cause the boss to look like an ordinary procedural enemy.

Do not create a unique texture merely to change hue. Prefer a palette or profile change unless authored surface detail materially improves the encounter.

### Create a unique authored 3D model when

- the mechanic depends on a silhouette the procedural factory cannot express cleanly;
- the boss has moving parts, shutters, limbs, mirrors, jaws, or weak-point housings requiring deliberate pivots;
- a signature asset will be reused enough to justify loader, animation, collision, and cleanup work;
- forcing the design into procedural primitives would reduce readability or create fragile special cases.

Authored models must:

- conform to the project’s scale and orientation conventions;
- use stable, descriptive node names;
- separate animated and breakable parts;
- provide named muzzle, weak-point, and VFX anchors;
- support deterministic material assignment;
- clone mutable materials per instance when needed;
- dispose owned geometries, materials, and textures;
- have a tested load failure path;
- be validated at gameplay distance.

The authored Ruby Optic Oracle adapter is the precedent for reconstructing pivots and anchors from named GLB parts. Follow that pattern rather than hard-coding behavior to anonymous mesh indices.

### Create VFX instead of a texture when

- the visual is transient;
- the shape changes over time;
- the effect must respond to trajectory, radius, duration, or charge;
- the gameplay need is a telegraph, impact, trail, beam, hazard, or status state;
- a static texture would not communicate timing.

VFX still need budgets, cleanup, pooling, deterministic timing where gameplay-relevant, and reduced-intensity fallbacks when several effects overlap.

### Create concept art when

- a new boss, biome, enemy family, or major equipment identity needs visual exploration;
- the team needs to settle silhouette, materials, weak points, attack language, or phase transformation before implementation;
- a texture-generation prompt needs a strong reference.

Concept art is not automatically a runtime asset. Final portraits should come from headless captures of the implemented game object, and runtime textures must follow the semantic texture pipeline.

Save prompts, provenance, source masters, and approved references with the concept work.

---

## Faux-PS1 visual direction

The intended look is a deliberate modern interpretation of late-1990s 3D console art, not an accidental low-quality render.

Prioritize:

- strong silhouettes;
- chunky low-poly forms;
- readable mechanical joints and modules;
- restrained texture resolution;
- hand-authored color grouping;
- visible but controlled vertex lighting;
- selective emissive accents;
- nearest-style color sampling where appropriate;
- subtle dithering or texture warping only when it supports the style;
- gameplay clarity over microscopic detail.

Avoid:

- photorealistic surface noise;
- tiny decorative geometry that disappears at gameplay distance;
- excessive bloom that hides weak points or telegraphs;
- high-frequency textures that shimmer;
- arbitrary neon colors competing with the ruby eye or hazard language;
- concept-art detail that cannot survive the runtime camera.

For Reaverbots:

- reserve saturated red for the dominant eye or explicitly authored red warning state;
- make weapons, defenses, locomotion systems, and weak points visually recognizable;
- keep damageable or recoverable mechanisms distinct from decorative plating;
- ensure phase-two or overloaded states are readable through silhouette, emissive pattern, or motion, not only a color tint.

---

## Texture workflow

Reaverbot textures use semantic roles rather than one monolithic model texture.

Common roles include:

- primary armor;
- secondary circuit armor;
- weapon housing;
- ornate trim;
- dark joints;
- blade metal;
- emissive mask;
- eye/lens;
- shield or energy-field mask;
- weak-point treatment.

### Boss texture requirements

Boss runtime maps are normally:

```text
primary_armor.png
secondary_circuit_armor.png
weapon_housing.png
ornate_trim.png
emissive_mask.png
```

Special bosses may add a specific lens or energy-field map when their mechanic requires it.

Current runtime boss maps are 256×256 RGBA. Color maps and masks must use the filtering, color-space, clamping, and luminance rules declared by `ReaverbotTextureCatalog.js`.

The current boss master workflow expects 1536×1024 masters divided into 512-pixel cells and builds runtime maps with:

```text
npm run art:boss-textures
```

The build script cleans emissive masks to true luminance, removes near-black compression haze, downsamples to 256×256, and verifies RGBA output.

### When an agent creates textures

1. Define the semantic role of every generated cell before generation.
2. Use approved concept art and in-game material references.
3. Generate a high-resolution master, not a final low-resolution screenshot crop.
4. Inspect every cell for the correct material role.
5. Clean masks so black is truly inactive and white intensity is intentional.
6. Run the texture build script.
7. Add or update the texture catalog/profile.
8. Run texture-manifest and boss tests.
9. Capture the runtime object headlessly.
10. Inspect the result at the actual combat camera and in motion.

Do not accept a texture merely because it is attractive in isolation. It must map correctly to the semantic UV regions and improve gameplay readability.

### Portraits

Boss Hunt portraits must come from the implemented runtime boss, not directly from concept art.

Use:

```text
npm run art:boss-portraits
```

The capture script produces validated 256×256 RGBA PNGs from a headless Chromium render.

---

## Procedural Reaverbot rules

A generated Reaverbot is a gameplay genome, not a random pile of parts.

When adding a new archetype, body, weapon, defense, charge system, eye, or weak point:

1. Add the stable catalog definition.
2. Define compatible combinations.
3. Add generation and validation rules.
4. Add procedural or authored visual geometry.
5. Add texture-role mappings.
6. Add runtime behavior.
7. Add weak-point/defense interaction when applicable.
8. Add salvage mapping.
9. Add deterministic tests.
10. Verify gameplay-distance readability and performance.

Every visible generated module that represents real machinery should map to a consistent salvage source. The same module must always imply the same possible named part. Do not display recognizable recoverable machinery that is secretly excluded without an explicit design reason.

Salvage pickups remain unidentified in the field. Roll’s workshop resolves hidden provenance into identified scrap or a source-specific named part. Breaking weak points and weapons should improve the corresponding candidate rather than opening unrelated global drops. See the project’s salvage design guide for the current contract.

Procedural variation must not obscure:

- the main eye;
- the current weapon;
- the guard or defense direction;
- the weak-point opening;
- the body’s movement capability;
- boss signature machinery;
- attack telegraphs.

---

## Boss workflow

Boss work should proceed in this order:

1. **Role statement**
   - What does the boss teach or test?
   - What material, ability, or core does it unlock?
   - What is the intended first-clear and repeat-hunt experience?

2. **Graybox encounter**
   - One readable phase-one loop.
   - One phase-two escalation.
   - Explicit telegraphs and safe responses.
   - Signature part and reward logic.
   - Cleanup and reset behavior.

3. **Catalog profile**
   - Stable profile ID and title.
   - Featured source mapping.
   - Constrained generation.
   - Phase-one and phase-two move IDs.
   - Overload weakening.
   - Arena anchor requirements.
   - Visual profile ID.

4. **Art strategy**
   - Use constrained procedural geometry if the existing factory can express the boss.
   - Add boss-specific textures when surface identity is the missing ingredient.
   - Add an authored GLB only if the signature silhouette or moving machinery requires it.

5. **Integration**
   - Dedicated boss spawn path.
   - No random elite affix.
   - Reward and persistence transaction.
   - Boss health bar, phase marker, intro, and victory feedback.
   - Hunt portrait from runtime capture.

6. **Verification**
   - Both phases and every attack.
   - Telegraph-to-hit parity.
   - Signature-part overload and lock behavior.
   - Reward idempotency.
   - Cleanup at 30/60/120 Hz.
   - Performance limits.
   - Feature-on and feature-off combat if the boss is always active.

Current boss safety limits are declared in `ReaverbotBossCatalog.js`. Do not casually exceed them. At the time of writing they include caps for projectiles, telegraphs, persistent constructs, hazard duration, and minimum telegraph times.

A boss should not reward one action through every axis simultaneously. If attacking a signature part grants reward certainty, a long interrupt, easier phase two, and bonus body damage, verify that a real tradeoff still exists.

Do not discard large threshold-crossing hits without an explicit, tested phase-overflow policy.

---

## Dungeon and room generation

Dungeon content is three-dimensional gameplay space, not decorative layout.

Any new room archetype, prefab, prop, hazard, bridge, platform, or door must account for:

- walkability;
- jump and ledge-climb reach;
- ramp grade;
- safe landing volume;
- enemy footprint clearance;
- projectile sightlines;
- required route validation;
- keycard and objective reachability;
- collision geometry;
- cleanup and regeneration.

If a prop is visibly solid, its footprint must feed collision and traversal systems. Do not let visual geometry and navigation geometry drift apart.

Generated rooms must be reproducible by seed. Invalid layouts regenerate; they are not returned with warnings and left to the player.

Use room-preview parameters and headless Playwright captures for visual validation.

---

## Custom Buster rules

The Custom Buster system is compiled, deterministic, and weapon-local.

When adding or changing a module:

1. Add a stable catalog ID.
2. Define kind, compatibility, Energy, cycle, Power behavior, and semantic capacity.
3. Update structural validation.
4. Compile through the existing immutable plan pipeline.
5. Preserve packet-level Power accounting.
6. Add simulator and production parity tests.
7. Add recipe and salvage integration when physical.
8. Add Lab UI and plain-language description.
9. Add role contracts and “nonsense detector” coverage.
10. Verify projectile reservations and cleanup.

Do not:

- recalculate module behavior ad hoc inside `Game.js` or `ProjectileSystem.js`;
- copy full Power into every child projectile;
- let generic equipment offense leak into unified Busters;
- add random module affixes;
- weaken or bypass compiler validation in production;
- allow diagnostic balance overrides into normal runtime;
- change catalog constants merely to make a faulty balance model pass.

`npm run verify:buster-balance` is a separate design gate. A correct implementation can still fail the frozen-catalog role verdict. Do not weaken tests or silently select diagnostic values to manufacture a green result.

---

## Equipment direction

Do not expand the legacy randomized non-weapon equipment system.

New non-weapon gear should use fixed, typed effects with one clear gameplay domain per slot, such as:

- Armor Frame: health-damage mitigation;
- Helmet: knockdown resistance or recovery;
- Mobility Gear: jumping or airborne traversal;
- Defense Gear: barrier, guard, or another special defense mechanic;
- Utility Modules: environmental immunity, scanning, salvage collection, Jet Skates, or other rule-changing capabilities.

Avoid generic stat bags, random affixes, item-level multiplication, or power-score optimization for qualitative gear.

When touching the legacy system:

- preserve compatibility until migration is explicit;
- keep migrations idempotent;
- compensate removed items deterministically;
- do not process the same legacy item through multiple migration systems;
- add typed runtime consumers before displaying a new effect;
- remove tooltip-only “unique” behavior unless it is implemented and tested.

---

## Technical QA philosophy

Testing is not limited to proving code paths execute. It must also identify technically valid rules that create nonsensical player choices.

### Hard correctness

Hard correctness includes:

- stable IDs and schema handling;
- deterministic output;
- packet and resource conservation;
- collision/event order;
- ownership exclusivity;
- save atomicity and idempotency;
- no-reward sandbox isolation;
- cleanup and disposal;
- feature-flag boundaries;
- simulator/production parity;
- input-independent resource economics unless a difference is intentionally authored.

### Design sanity

After correctness passes, actively search for rules that “work” but do not make sense.

Examples:

- a plain Custom Pulse strictly dominates the live Mega Buster;
- adding a module lowers damage, coverage, control, and efficiency in every relevant scenario;
- a cycle delay secretly refunds Energy;
- lower Rapid creates infinite fire;
- Range improves both lifetime and speed and therefore scales quadratically;
- a shotgun applies seven full status procs;
- one boss target grants bonus damage, guaranteed reward, phase weakening, and a long interrupt with no downside;
- a recipe component is so rare that most players never see the system it unlocks;
- a new boss guarantee makes ordinary salvage and dungeon ecology irrelevant;
- a barrier receives Armor reduction and unintentionally multiplies defensive value;
- tap and held input produce different batteries without communicating that rule;
- a phase transition deletes most of a heavy attack;
- a terrain-ignoring persistent projectile attacks enemies through locked rooms.

Automate these checks when the relationship is stable enough to describe precisely.

### Visual QA

For any visual or gameplay-facing change:

- inspect at gameplay distance;
- inspect in motion;
- inspect against bright and dark backgrounds;
- inspect with multiple simultaneous effects;
- verify target, weak point, hazard, safe area, and reward readability;
- verify no fallback texture or missing model appears;
- capture screenshots or portraits headlessly when practical;
- confirm the visual matches collision and damage timing.

### Performance QA

Check:

- object counts;
- active projectile counts;
- pooled effect reuse;
- material and texture reuse;
- geometry disposal;
- repeated room, range, and sandbox entry/exit;
- no retained scene references;
- no growing event-listener collections;
- stable frame behavior during long boss patterns.

A visually impressive effect that leaks resources or breaks the projectile/telegraph budget is not complete.

### Persistence QA

Every persistent change must test:

- new-context defaults;
- save and reload;
- stale revision rejection;
- failed transaction rollback;
- backup/corrupt recovery where applicable;
- foreign-context isolation;
- read-only behavior;
- migration from prior versions;
- migration idempotency;
- unknown-ID quarantine.

Never award a progression-critical reward only through a visual pickup callback. Commit the durable reward first, then play presentation.

---

## Test commands

Use the current `package.json` scripts as the command source of truth.

### Fast syntax and enumerated-source check

```text
npm run check
```

When adding a new source or script that belongs in the explicit check list, add it to the relevant `package.json` command.

### Custom Buster

```text
npm run test:buster
npm run test:buster-simulation
npm run verify:buster-balance
```

### Bosses

```text
npm run test:bosses
```

### Procedural Reaverbots and traversal

```text
npm run test:reaverbots
npm run test:reaverbots:runtime
```

### Full correctness and release gates

```text
npm test
npm run verify:release
```

### End-to-end and visual browser checks

```text
npm run test:e2e
npm run test:e2e:headed
npm run test:e2e:ui
```

Use headless Playwright for automated verification. Follow the repository’s one-worker configuration for suites that depend on shared browser or server state.

Run focused tests first, then the broader suite appropriate to the change.

Do not claim a test passed unless it was run successfully. If a required gate is already known to fail, report the existing failure separately from regressions introduced by the change.

---

## Required tests by change type

### New procedural Reaverbot module

- catalog completeness;
- deterministic genome generation;
- compatibility rejection;
- runtime behavior;
- visual snapshot/gameplay-distance capture;
- salvage mapping;
- weak-point or defense interaction;
- cleanup and performance.

### New boss

- boss catalog and featured material resolution;
- constrained deterministic generation;
- phase-one and phase-two patterns;
- telegraph-to-hit parity;
- signature-part and reward behavior;
- arena-anchor validation;
- texture manifest and no-fallback render;
- 30/60/120 Hz lifecycle tests;
- reward persistence and idempotency;
- repeated cleanup cycles;
- benchmark duration and lethality.

### New Buster module, emitter, core, or projectile behavior

- compiler validation;
- immutable plan values;
- Power ledger;
- Energy and cycle schedule;
- packet allocation;
- projectile reservation;
- production/simulator parity;
- weak-point and armor behavior;
- input policy;
- role contracts;
- dominance/nonsense checks;
- range and sandbox cleanup.

### New texture or model

- file dimensions and format;
- catalog/manifest entry;
- successful load without fallback;
- semantic-role correctness;
- material ownership and disposal;
- gameplay-distance screenshot;
- no unexpected effect on other profiles;
- asset provenance and source master.

### New gear effect

- exact typed consumer;
- no random stat generation;
- no overlap with another slot’s domain unless explicitly designed;
- equip/unequip behavior;
- persistence and migration;
- UI wording matching runtime;
- no generic power-score recommendation.

### UI change

- keyboard and mouse operation;
- visible disabled reasons;
- no stale values after state changes;
- narrow viewport behavior where relevant;
- screen-reader labels for interactive controls where practical;
- Playwright coverage for critical workflows.

---

## Balance and acquisition review

Whenever a feature depends on loot or salvage, calculate the complete acquisition path rather than citing one drop percentage.

Include:

```text
field recovery chance
× intact-part chance
× candidate selection weight
× source-enemy frequency
× required quantity
```

Then account for:

- weak-point or weapon-break bonuses;
- elite and threat modifiers;
- guaranteed boss rewards;
- pity or deterministic progression;
- repeat fabrication;
- dungeon ecology weighting;
- duplicate sinks.

A feature is not available merely because its component technically exists in a drop table.

Boss guarantees and procedural hunting should complement each other. A boss may guarantee a keystone or bottleneck while ordinary matching Reaverbots supply a visible expression component. Avoid turning the entire crafting economy into a checklist of guaranteed boss drops.

---

## Documentation rules

Keep these document types distinct:

### Factual implementation notes

Describe what exists now, including known limitations, current constants, test status, and source paths.

### Design proposals

Describe intended future behavior, alternatives, risks, and rollout plans. Do not phrase unimplemented behavior as fact.

### Concept and art documentation

Store approved references, prompts, provenance, texture masters, semantic roles, and runtime captures.

### Audits

Record evidence, calculations, contradictions, and recommendations. Do not silently convert an audit recommendation into an implementation claim.

Update README or user-facing controls when a change affects how the game is launched, tested, or played.

---

## Completion report

At the end of a task, report:

- what changed;
- the important design contract;
- files added or modified;
- tests and asset-build commands run;
- visual evidence created;
- migrations or compatibility behavior;
- remaining risks, deferred work, or known failing gates.

Be precise. “Implemented boss” is insufficient; name the phases, reward, art path, tests, and unresolved limitations.

---

## Definition of done

A change is complete only when:

- the player-facing behavior is coherent;
- the implementation uses the correct architectural boundary;
- stable IDs and data contracts are defined;
- relevant art exists and is integrated when needed;
- the result is readable at gameplay distance;
- deterministic systems remain deterministic;
- persistence is safe where applicable;
- runtime resources clean up correctly;
- focused tests pass;
- broader regressions are checked at the appropriate level;
- factual documentation matches the code;
- no known nonsensical interaction is hidden behind a technically green test.