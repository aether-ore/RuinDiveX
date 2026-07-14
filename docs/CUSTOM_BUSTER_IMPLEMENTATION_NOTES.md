# Custom Buster Implementation Notes

This document records the Custom Buster feature as it is implemented in the
current prototype. It is a current-state reference, not a redesign proposal.
Earlier planning and audit notes may describe alternative balance, persistence,
or rollout choices; those alternatives are not missing behavior unless this
document explicitly identifies a verified gap.

## Feature boundary

The feature is opt-in through URL parameters.

| Parameter | Current effect |
| --- | --- |
| `busterLab=1` | Enables the complete integrated feature: Roll's Lab, persistent Roll salvage, recipes, physical chassis and modules, Mega Buster calibration, Custom Busters in normal combat, the shared battery runtime, HUD integration, and the test range. |
| `busterLabDebug=1` | Preselects the Buster Lab page in Debug Tools when the main feature is enabled. It does not independently enable the feature. |

With `busterLab=1` absent, the Buster compiler and Lab do not participate in
gameplay. The existing equipment aggregation, Buster Output, legacy weapons,
loot handling, Roll salvage session, and combat behavior remain on their legacy
paths. The browser test named `feature flag off keeps the legacy Buster and Roll
workshop path intact` protects this boundary.

`busterLab=1` is not a range-only or in-memory sandbox. It enables crafting,
persistence, migration, and normal-game use together. Safe experimentation is
provided by the no-reward test range and the repeatable Debug Tools grant.

## Source map and data flow

The implementation separates authored build data from derived combat behavior.

| Area | Source of truth |
| --- | --- |
| Versioned rules, module values, Mega calibration mappings | `src/buster/catalog.js` |
| Canonical graph normalization and graph serialization | `src/buster/model.js` |
| Graph, tuning, compatibility, Energy, and optional ownership validation | `src/buster/validation.js` |
| Immutable plans, Power allocation, ledgers, previews, and runtime actions | `src/buster/compiler.js` |
| Recipes and permanent discovery states | `src/buster/BusterRecipeCatalog.js` |
| Roll resources, instances, builds, revisions, assignments, and local persistence | `src/buster/BusterLabStorage.js` |
| Batteries, cadence, atomic projectile reservations, and execution identity | `src/buster/BusterRuntime.js` |
| Deterministic spread, cluster, and ballistic sampling | `src/buster/BusterTrajectory.js` |
| Game/loadout integration and compiled action execution | `src/Game.js` |
| Input, aiming, delayed muzzle release, and weapon switching | `src/CombatSystem.js` |
| Reasoned projectile lifecycle and hit routing | `src/ProjectileSystem.js` |
| Roll's editor, compiler results, recipes, debug grant, and HUD | `src/UIManager.js` and `index.html` |

The production flow is:

```text
Roll editor controls
  -> versioned source graph
  -> normalize and validate
  -> immutable compiled plan
  -> BusterRuntime fire transaction
  -> Game action executor
  -> ProjectileSystem lifecycle
  -> normal enemy damage, armor, rewards, and weak-point handling
```

Source graphs and the complete Lab snapshot--Roll resources and discovery,
physical instances, assignments, Mega calibrations, and migrations--are
persisted. Compiled plans, runtime battery values, reservations, projectiles,
and range objects are derived or ephemeral.

## Source graph and supported grammar

The current source schema and ruleset are:

```text
schemaVersion: 1
rulesetVersion: custom-buster-v0.1
```

A saved build has this shape:

```js
{
  schemaVersion: 1,
  rulesetVersion: "custom-buster-v0.1",
  buildId,
  chassisId,
  tuning: { power, energy, range, rapid },
  program: {
    rootNodeId,
    nodes: [{ nodeId, moduleId, moduleInstanceId }],
    edges: [{ from, port: "next" | "child", to }]
  }
}
```

The Roll UI is not a free-form graph editor. It presents typed slots for an
emitter, root Guidance, trigger, child Guidance, splitter, and payload. Game
integration lowers those selections into the graph above. When there is no
trigger, the lower strip continues the root scope. When a trigger exists, its
single `child` edge starts the child scope.

| Program form | Canonical UI-authored shape |
| --- | --- |
| Direct | Emitter -> optional Guidance -> optional Splitter -> optional Explosion override. Without an override, the emitter's native payload is implicit. |
| Triggered | Emitter -> optional root Guidance -> Trigger, then one child edge to optional child Guidance -> optional Splitter -> optional Explosion or native payload. |

Current validation enforces all of the following:

- Schema and ruleset versions must match.
- The four tuning ratings are integers from `1` through `10` and total exactly
  `16` for a Workshop Chassis.
- A graph contains at most five raw nodes, exactly one emitter, at most one
  trigger, at most one splitter, and at most one Guidance modifier in each
  scope.
- The emitter is the root. Payload nodes are terminal. Only triggers may own a
  `child` edge, and a trigger must own exactly one.
- Graphs must be connected and acyclic, with valid ports, unique node IDs, no
  duplicate edges, no joins, and no incoming edge to the root.
- Module compatibility tags are enforced; notably, `atApex` requires the
  Mortar emitter.
- Physical modules require an instance ID. When ownership context is supplied,
  each instance must exist and must not already be claimed by another saved
  build.
- Total program Energy cost cannot exceed Maximum Energy.
- Unknown module IDs remain in the normalized source and produce structured
  validation errors; they are never replaced with another module.

Validation errors use `{ code, path, moduleId, message }`. The Lab uses the same
errors to disable Save, Equip, and Test while leaving invalid drafts editable.

`onImpact` and `pulsePayload` are non-physical built-in catalog nodes. They need
no fabricated instance. They still appear as graph nodes when the UI needs an
explicit trigger or native-payload child target, so the current five-node limit
counts them whenever they are present. A native payload is otherwise allowed to
remain implicit.

The public pure-build entry points are `normalizeBusterBuild`,
`validateBusterBuild`, `compileBusterBuild`, `serializeBusterBuild`, and
`deserializeBusterBuild`. Normalization is detached and canonical: nodes and
edges are sorted for stable round trips while invalid values and unknown module
IDs are preserved for diagnosis.

## Stat and Power contract

Workshop Chassis ratings use one shared weapon-local contract:

```text
rating multiplier = 0.72 + 0.07 x rating
Power              = emitter base Power x Power multiplier
Maximum Energy     = 2 + Energy rating
Range              = emitter base Range x Range multiplier
Base Rapid         = emitter base Rapid x Rapid multiplier
Cycle time         = 1 / Base Rapid + sum of module cycle delays
Child Range        = root Range x 0.65
```

Power is deterministic pre-mitigation damage potential. The compiled packet is
still processed by enemy armor and enemy-specific damage handling. Each target
inside an Explosion receives that Explosion packet independently.

Guidance, trigger transfer, and splitter bonuses are applied through a Power
ledger. Final effective Power is capped at `125%` of tuned emitter Power. When
the cap applies, carrier and terminal packets are scaled proportionally before
the terminal batch is divided among projectiles.

Stagger is derived from the final packet:

```text
Pulse/native impact = min(0.18, packet Power x 0.01) seconds
Mortar impact       = min(0.25, packet Power x 0.015) seconds
Explosion           = min(0.30, packet Power x 0.015) seconds
```

Enemy status handling uses maximum-duration semantics. Several packets from one
execution do not add their stagger durations numerically, although later hits
can refresh the remaining duration and produce their normal hit reactions.

### Module catalog

| Stable ID | Kind | Physical | Current compiled behavior |
| --- | --- | --- | --- |
| `pulseBolt` | Emitter | Yes | Base Power `8`, Range `6.9`, Rapid `4.2/s`, speed `9.5`, Energy `1`; linear native Pulse. |
| `mortarShell` | Emitter | Yes | Base Power `15`, Range `6.2`, Rapid `1.15/s`, speed `5.8`, Energy `1`; ballistic native impact. |
| `pursuitGuidance` | Modifier | Yes | Power x`0.90`, Energy `+1`, cycle `+0.05s`; root and child scopes acquire independently. |
| `atApex` | Trigger | Yes | Energy `+1`, cycle `+0.08s`, `100%` child transfer; Mortar-compatible only. |
| `onImpact` | Trigger | No | Energy `+1`, cycle `+0.08s`; `20%` carrier damage and `80%` child transfer on enemy contact or range end. |
| `afterDelay` | Trigger | Yes | Fixed `0.60s`, Energy `+1`, cycle `+0.08s`, `105%` child transfer. |
| `spread3` | Splitter | Yes | Three directions at `-0.14/0/+0.14` radians, `110%` aggregate Power, Energy `+1`, cycle `+0.08s`. |
| `cluster5` | Splitter | Yes | Five deterministic radial directions, `120%` aggregate Power, Energy `+2`, cycle `+0.16s`. |
| `pulsePayload` | Payload | No | Explicit native Pulse sentinel with no additional cost. |
| `explosion` | Payload | Yes | Replaces direct damage with radius-`1.55` Explosion, Energy `+1`, cycle `+0.10s`. |

Direct `cluster5` is currently legal and creates its radial batch at the muzzle.
The compiler and UI do not restrict it to a trigger child branch.

At balanced `4/4/4/4` tuning, a bare Custom Pulse has Power `8`, Range `6.9`,
Rapid `4.2/s`, Maximum Energy `6`, and cost `1`, so it can fire six shots from a
full battery. The neutral Mega Buster has the same Power, Range, and Rapid but
costs `2`, giving it three shots. These are current catalog contracts rather
than derived equipment bonuses.

`afterDelay` followed by `cluster5` produces `1.05 x 1.20 = 1.26` raw Power and
is intentionally clipped to `1.25`. With no Guidance, the two emitters and two
terminal choices (native or Explosion) yield four canonical UI combinations
that reach this cap.

## Compiled plans

Compilation returns a deeply frozen derived plan. The plan contains:

- Exact base, tuned, effective, carrier, terminal-batch, and per-projectile
  Power.
- Maximum Energy, Energy cost, Energy remaining, and shots per charge.
- Native Rapid, final Rapid, base cycle time, module delays, and final cycle
  time.
- Root and child Range, speed, deterministic trajectory configuration, stagger,
  projectile count, and peak projectile reservation.
- Scope-sensitive Guidance, trigger, splitter, payload, packet, and preview
  records.
- Ordered action records whose `actionId` values include `emit-root`,
  `emit-carrier`, `trigger-child`, and `emit-child`; their `type` values are
  `emit` or `trigger`.
- The normalized source build, build revision, complete Energy/cycle/Power
  ledgers, and a plain-language firing description.

The Power ledger records tuning, each modifier, trigger allocation, splitter
amplification, cap clipping, and final projectile allocation. The same derived
values drive unit tests and the Lab result panel; runtime code does not
recalculate module balance from player state.

## Mega Buster and loadout integration

Feature-on loadout resolution uses logical entries rather than placing Custom
Busters in the random-item type catalog:

```js
{ kind: "megaBuster" }
{ kind: "customBuster", buildId }
{ kind: "legacyItem", item }
```

- Arm slot 1 is always the fixed left-arm Mega Buster.
- Arm slots 2 and 3 may independently hold a saved physical Custom Buster or a
  legacy special weapon.
- Arm slot 4 remains the utility arm.
- Custom chassis and modules do not enter random loot generation or generic
  equipment aggregation.

Mega and Custom plans bypass legacy Buster Output, legacy reload behavior,
random player-damage rolling, generic Attack, random elements, criticals,
generic Area/projectile-count bonuses, life steal, Chain Shock, and Explosive
Finish. Compiled projectiles still retain player ownership, normal XP and loot,
enemy armor, enemy-specific guard logic, and geometric direct-hit weak points.

Direct compiled projectiles pass resolved part and weak-point metadata through
the normal damage path. Explosion splash does not resolve a projectile part or
carry precision weak-point metadata; it is body-area damage, still processed by
the enemy damage and armor path.

Both Mega and Custom attacks currently use the descriptive attack-domain string
`customBuster`; actual generic-offense suppression is separately enforced by
the `suppressGenericOffense` metadata flag.

### Mega calibration

The Mega base profile is balanced at `4/4/4/4` and has four physical
calibration sockets. A fresh feature-on save normally becomes `6/4/4/4` after
its starter Power calibration is granted and installed. Every rating remains
capped at `10`.

| Legacy part type | Fixed rating bonus |
| --- | --- |
| `powerRaiser` | `+2 Power` |
| `energyBattery` | `+2 Energy` |
| `rangeBooster` | `+2 Range` |
| `rapidFireUnit` | `+2 Rapid` |
| `sniperScope` | `+1 Power, +1 Range` |
| `heatSinkCore` | `+1 Energy, +1 Rapid` |

On a successful cap-valid migration, feature initialization converts owned and
installed legacy Buster Parts into calibration instances, preserves installed
socket order where capacity permits, and removes the source items. Future
Buster Part acquisitions are intercepted and converted instead of entering
general inventory. Rarity, item level, and random rolls do not affect the fixed
calibration. A starter Power calibration is granted once and installed into the
first empty socket when one is available.

Migration is transactional. If the candidate installed calibrations would push
any rating over `10`, validation rejects the mutation and the legacy source
items remain unchanged.

This conversion is currently destructive. Calibration records do not preserve
the source item's ID, rarity, level, or random-roll provenance, and no rollback
path recreates those original items when the feature flag is removed.

## Battery runtime and projectile lifecycle

`BusterRuntime` owns independent state for every registered weapon key. Current
Custom plans use `buildId` as their weapon/resource key; Mega uses
`megaBuster`. Resource state is not keyed separately by physical `chassisId`.

After a successful shot:

- The exact compiled Energy cost is deducted.
- The compiled cycle timer starts.
- Recharge is delayed by `0.65s`.
- Recharge then adds `maxEnergy / 1.8` Energy per second.

Recharge advances for every registered weapon, including inactive weapons, at
the same full rate. Energy does not need to return to full before firing: held
fire resumes as soon as the active weapon has enough partial Energy to pay the
shot and its cycle timer is ready.

The runtime permits at most `24` reserved moving Buster projectiles globally. A
shot atomically reserves its compiled peak batch before spending Energy. If the
reservation cannot be made, nothing spawns and no Energy is spent. Spawn
rejection or an exception also rolls back Energy, cycle, recharge delay, and the
reservation. A reservation remains attached to its execution until that
execution's final controlled projectile is disposed.

Every controlled projectile carries build revision, execution ID, action ID,
trigger depth, reservation token, attack domain, and attack metadata. The
controller receives advance, enemy-impact, range-end, apex-crossing, disposal,
and world-clear events. Legacy projectiles keep their existing behavior when no
controller is attached.

Current trigger behavior is:

- `onImpact` creates its child batch once on enemy contact or exact range end.
- `afterDelay` samples the carrier position at the `0.60s` crossing and creates
  its child batch once.
- `atApex` uses the shared ballistic sampler to create its child batch at the
  sampled apex.
- If an Apex or Delay carrier contacts an enemy before its trigger, it applies
  its native carrier payload and produces no child batch.
- Terrain-wall collision is not part of this version.

Spread, cluster, and ballistic samples contain no runtime randomness. Guidance
honors an explicit lock first, otherwise reacquires the nearest valid target;
controlled Buster projectiles use stable target-ID ordering to break equal
distance ties. Root Guidance does not implicitly cross a trigger boundary, and
child Guidance reacquires independently.

Ordinary weapon switching cancels reservations and controlled projectiles for
the weapon being left. Registering a new revision for the same key cancels the
old revision as `recompile`. Slot replacement, invalidation, reset, range entry,
range exit, and world clear also have explicit cancellation paths. Cancellation
does not invoke normal expiry payloads.

### Firing animation timing

Mega and Custom shots use a `0.18s` extension gate. The first unbraced input is
stored as a pending firing intent and starts the projectile firing pose without
spending Energy. Combat releases the shot only after the player's Buster pose is
sustained and the extension time has elapsed.

At release, combat reads the live extended muzzle again and recomputes the shot
direction from that origin. This prevents a projectile from spawning at the hip
position sampled before the animation. Tap fire remains queued through the
extension; held fire keeps the arm braced so later cadence-ready shots do not
repeat the wind-up. Shared pending-attack cancellation clears the intent on
weapon changes, dodges, ledge clings, death, control locks, and range
transitions without spending Energy.

### Explosion behavior and visuals

Compiled Explosion packets explicitly disable player damage and legacy mine
triggering. The compiled path passes `visualStyle: "fierySphere"` to the shared
Explosion resolver. It creates three additive orange/yellow spherical layers,
expands and fades them through the timed-effect system, and adds orange and hot
particle bursts. The visual reuses the same fiery-sphere vocabulary as
Reaverbot destruction.

The style is selected only by compiled Buster Explosions. Legacy explosions
retain their flat ring visual and their existing gameplay behavior.

## Roll economy, ownership, and persistence

The durable feature slice is stored at:

```text
localStorage key: ruinDigger.busterLab.v1
storage version: 1
```

There is one feature-on durable snapshot. `RollSalvageStorage` is created as a
transactional facade over that snapshot; its autosave callback commits Roll's
resource changes back through `BusterLabStorage`. It is not a second independent
feature-on local-storage key.

| Persisted field | Contents |
| --- | --- |
| `rollSalvage` | Roll's identified scrap and named-part counts. |
| `discovery` | Ever-discovered salvage types, discovery history, and permanent recipe reveal history. |
| `moduleInstances` | Fabricated, starter, and debug physical module copies. |
| `chassisInstances` | Workshop Chassis A and optional Chassis B. |
| `chassisBuilds` | Last valid saved production source for each chassis. |
| `chassisDrafts` | Current editable source, including invalid or unfinished drafts. |
| `chassisRevisions` | Cloned source snapshots appended on successful saves. |
| `assignments` | Build assignments for physical arm slots 2 and 3. |
| `megaCalibrations` | Physical calibration instances, four socket assignments, ID counter, and revision. |
| `migrations` | Starter/conversion flags, the debug grant marker and count, and unknown-module quarantine records. |
| `nextInstanceId` | Stable allocator state for fabricated instances. |

General inventory, legacy equipment, player level, dungeon progress, enemies,
loot on the ground, and runtime weapon resources are deliberately not part of
this partial save.

A fresh Lab grants exactly one Workshop Chassis A, one physical starter Pulse
Bolt, and valid Build A source/revision. Chassis B costs `20` identified scrap,
is capped to one additional chassis, and begins as an empty invalid Build B
draft. Purchasing it is transactional.

Physical module instances can be referenced by only one saved build. Drafts are
persisted even when an instance is missing or claimed elsewhere, but such a
draft cannot be saved as a production revision, equipped, or tested. The editor
selects an available matching instance automatically; it does not currently
provide an explicit transfer operation or simulation using an unowned pattern.

### Recipes

| Module | Stable recipe ID | Named parts | Identified scrap |
| --- | --- | --- | ---: |
| `pulseBolt` | `pulse` | `revolvingPulseBarrel` | 6 |
| `mortarShell` | `mortar` | `highAngleLaunchTube` | 8 |
| `pursuitGuidance` | `pursuit` | `behaviorChipPursuit`, `rubyOpticLens` | 12 |
| `atApex` | `apex` | `ballisticsLogicChip` | 8 |
| `afterDelay` | `afterDelay` | `clusterBurstSequencer` | 8 |
| `spread3` | `spread3` | `ammunitionFeedDrum`, `revolvingPulseBarrel` | 10 |
| `cluster5` | `cluster5` | `clusterBurstSequencer` | 12 |
| `explosion` | `explosion` | `volatileOverloadCell` | 10 |

All listed named-part quantities are one. `onImpact` and `pulsePayload` are
built-in and have no fabrication recipe.

Recipe reveal state is permanent:

1. With no required part type ever discovered, the recipe card is an unknown
   silhouette.
2. Discovering some but not all required types reveals the authored name and
   Roll clue while hiding exact requirements.
3. Discovering every required type permanently reveals the bill of materials
   and scrap cost, even after the parts are consumed.

A one-part recipe therefore moves directly from unknown to full. Fabrication
checks and consumes every requirement in one transaction, and creates no module
if validation, instance creation, or persistence fails. Additional copies use
the complete named-part and scrap recipe again.

### Debug grant

Debug Tools exposes `Grant one of each Buster part` when the feature is enabled.
Every activation atomically:

- Adds one fresh physical copy of every recipe-backed v0.1 module.
- Adds Chassis B and its empty draft if they do not already exist.
- Adds one physical copy of every Mega calibration type.
- Marks every recipe as fully discovered.

The grant is deliberately repeatable so both saved builds can own separate
copies during testing. It does not change current scrap, named-part counts,
saved builds, socket assignments, or arm assignments. Grant results and the
grant counter persist in the Lab snapshot.

### Recovery behavior

Unknown module IDs in a saved production build preserve the original source as
an invalid draft, remove that build from production assignments, and force the
active weapon back to the Mega Buster when necessary. A visible warning names
the affected build.

Malformed JSON or otherwise invalid Lab state loads a safe starter Lab with a
visible warning. The raw corrupt payload is not copied to a separate backup key;
a later successful mutation can overwrite the original local-storage value.

The current persistence model has no player/profile or world identity, no
top-level monotonic concurrency revision, and no cross-tab `storage` event
handling. It therefore does not resolve concurrent writes from multiple tabs or
associate the partial Lab save with a particular dungeon run.

## Lab UI, HUD, and test range

When enabled, Roll's workshop has `Salvage Analysis` and `Buster Lab` top-level
tabs. The Lab supplies selectors for Mega, Build A, and Build B, plus:

- Four tuning controls and a remaining-point indicator.
- Structured root and child program strips.
- Physical module inventory with installed-build labels.
- Recipe cards with silhouette, clue, or full-recipe states.
- Mega calibration sockets.
- A compiler result panel for base/effective/per-child Power, projectile count,
  Energy cost, shots per charge, Rapid, root/child Range, trigger behavior,
  reservation count, cap clipping, and firing description.
- Explicit Save, Equip, and Test in Range actions with compiler-derived disabled
  reasons.

Program dropdowns currently enumerate the complete catalog even when a recipe
card is still an unknown silhouette. Selecting an undiscovered/unowned module
usually produces an invalid draft, but its name and function are not secret in
the editor.

The new-Buster HUD uses `PWR/ENG/RNG/RPD` and one battery gauge. Legacy arms
continue to use their existing telemetry. Custom weapon descriptors report no
generic equipment totals and identify themselves as compiled weapon-local
weapons.

`Test in Range` closes the workshop, creates one stationary and one lateral
moving no-reward dummy, temporarily equips the valid draft under a test-specific
weapon key, and uses the production compiler, battery runtime, projectile
executor, damage path, and visuals. It snapshots existing Buster resource
states, prevents loot and XP, and consumes no crafting materials.

Exiting clears every range projectile, dummy, and scene resource, then restores
position, facing, loadout, active arm, arena settings, workshop state, and the
captured Buster battery/cycle state. Compiled executions active before range
entry are cancelled rather than recreated afterward.

## Intentional current contracts versus verified gaps

The following are implemented and tested current rules. They are not incomplete
merely because an earlier audit proposed alternatives:

- The feature flag enables the whole integrated slice.
- Source is persisted as a validated graph.
- Bare Custom Pulse has six neutral shots while Mega has three.
- Recharge resumes at the partial Energy threshold.
- Inactive registered weapons recharge at full speed.
- Switching and recompiling cancel matching in-flight executions.
- Saved production builds enforce strict physical module ownership.
- Duplicate fabrication repeats the full recipe.
- Direct Cluster is legal.
- The Lab uses one partial, feature-local durable snapshot.

The following are verified implementation or coverage gaps in the current
state. They are recorded here without prescribing a redesign:

1. **Competing lifecycle events are not globally time-sorted.** Controlled
   projectile updates process Apex, then Delay advance, then enemy collision,
   then range end. Each trigger crossing is sampled, but a large timestep can
   let a trigger win even when an impact or range end physically occurred first.
   There are no competing-event parity tests at 30, 60, and 120 updates per
   second.
2. **Externally authored noncanonical graph order is not rejected.** The UI
   emits a bounded canonical order, but the validator can accept a graph such as
   Splitter before Guidance while the compiler finds modules by kind and applies
   Guidance before Splitter.
3. **Discovery secrecy is incomplete.** Unknown recipe cards are silhouettes,
   while the editor dropdowns expose all current module names.
4. **Legacy conversion has no rollback-focused coverage.** Successful
   conversion is destructive and omits source provenance. A cap-invalid
   migration is transactionally rejected but has no focused user-facing failure
   path. Tests do not directly cover real installed/owned conversion,
   cap-invalid migration, or future-acquisition interception.
5. **Equipment-domain UX is incomplete.** Generic item comparisons still use
   global power scores, level-up continues to present global Attack growth, and
   Optimize Loadout can displace Custom Busters and return the player to Mega.
6. **Persistence is single-profile and last-writer-wins.** There is no profile
   identity, tab-conflict handling, or separate raw-corruption backup.
7. **Combat-domain regression coverage is partial.** Direct Buster weak points
   and guards lack focused browser coverage. Exact Explosion damage is tested
   against inflated generic offense, but life steal, Chain Shock, and Explosive
   Finish suppression are not each asserted independently. The current fixture
   also sets `chainChance`, while production generic chain logic reads
   `chainLightningChance`.
8. **Cancellation coverage is indirect.** Pending muzzle-release cancellation
   on weapon switch is tested, but there is no focused browser assertion for an
   already in-flight controlled projectile being cancelled by ordinary switch
   or recompile.
9. **Sustained projectile occupancy is not previewed.** The compiler exposes
   one execution's peak reservation, not estimated overlapping occupancy under
   held fire. A capacity-blocked held input is reconsidered by combat on later
   frames rather than using a separate retry throttle.
10. **The attack-domain label is broader than its name.** Mega and Custom both
    use `customBuster`; behavior remains correct because suppression does not
    depend on that string.
11. **Custom progression is fixed for this slice.** Workshop Chassis tuning is
    fixed at 16 points and there is no chassis grade, proficiency, or other
    deterministic Custom Buster scaling layer.

## Verification coverage

`npm run test:buster` currently runs 34 pure Node tests followed by seven
single-worker Chromium tests.

| Suite | Current coverage |
| --- | --- |
| `tests/buster-compiler.test.mjs` | Exact immutable catalog values, neutral compilation, Power allocation, clipping, payload replacement, compatibility, scope-sensitive Guidance, schema/tuning/capacity/Energy failures, graph integrity, ownership context, canonical round trips, and unknown-ID rejection. |
| `tests/buster-lab-storage.test.mjs` | Recipe constants, discovery permanence, atomic Roll transactions, one-time starter grant, repeatable debug kits, fabrication and persistence rollback, Build B, exclusivity, serialization/migration, corrupt recovery, unknown-module quarantine, and Mega sockets. |
| `tests/buster-runtime.test.mjs` | Recharge timing, held-fire resume, inactive recharge, atomic reservations, re-entrancy protection, rollback, resource snapshots, and deterministic trajectory helpers. |
| `tests/buster-lab-runtime.spec.js` | Feature-off regression, debug grant UI, extended-muzzle release, Save/Equip/range restoration, production trigger and Explosion lifecycle, fiery-sphere visuals, corrupt-save warning, and unknown-module Mega fallback. |

The repository's `npm run check` script syntax-checks the Buster subsystem and
its integration entry points. These checks confirm implementation consistency;
they do not close the verified coverage gaps listed above.
