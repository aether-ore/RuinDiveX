# Custom Buster v0.2 Implementation Notes

This document records the Custom Buster feature as it exists in the current
prototype on July 14, 2026. It is a factual implementation reference, not a
design proposal. Planning documents and earlier audits may describe contracts
that are not yet integrated; verified differences are listed under
**Current limitations and release blockers**.

## Current status

The graph-v1 compiler, normalized battery rules, physical Lab economy,
ownership-free blueprints, context-scoped storage, compiled projectile runtime,
benchmark range, and disposable dungeon infrastructure are implemented.

The v0.2 balance search does **not** currently produce a releasable selection.
`runBusterBalanceSearch` evaluates all 338 authorized Power-scalar/Mortar-Power
candidates and returns `releaseReady: false`. The nearest diagnostic candidate
uses a level-10 scalar of `1.25` and Mortar Power `18`, but fails 89 of 90 hard
comparisons. Consequently, the catalog deliberately remains at the unselected
constants `BUSTER_LEVEL_10_POWER_SCALAR = 1.00` and Mortar Power `15`.

`npm run test:buster` includes `tests/buster-balance.test.mjs`, whose assertions
lock the matrix and the known blocked result. The separate strict command
`npm run verify:buster-balance` exits unsuccessfully when `releaseReady` is
false. The top-level `npm test` runs that strict command after the focused
Buster suite, so ordinary CI is intentionally blocked at the balance gate.

## Feature boundary

| URL parameter | Implemented effect |
| --- | --- |
| `?busterLab=1` | Enables the integrated physical Lab, unified Mega/Custom runtime, crafting, saved chassis, blueprints, HUD, and benchmark range. |
| `?busterLab=sandbox` | Enables everything above and exposes the disposable dungeon sandbox path. |
| `?busterLabDebug=1` | With either enabled Lab mode, exposes the persistent, repeatable debug-kit control. It does not enable the Lab by itself. |
| Missing or any other `busterLab` value | Keeps legacy combat and arm behavior active. |

Feature-off combat still uses the legacy Buster Output, equipment aggregation,
random damage, procs, and arm implementations. It is no longer a completely
untouched code path: `Game.create` always opens the context-scoped Lab store so
the starter record and legacy Buster shadow bridge cannot be duplicated by
toggling the feature. With the feature off, authoritative shadow records are
hydrated back into legacy inventory or Buster-upgrade sockets.

The browser test `feature-off and feature-on share one canonical starter Power
Raiser without duplication` protects the toggle bridge and starter identity.

## Source map

| Concern | Primary symbols/files |
| --- | --- |
| Ruleset, module values, Mega profile, calibration mapping | `CUSTOM_BUSTER_RULESET`, `BUSTER_MODULE_CATALOG`, and `MEGA_BUSTER_BASE_PROFILE` in `src/buster/catalog.js` |
| Source cloning, normalization, serialization | `normalizeBusterBuild`, `serializeBusterBuild`, and `deserializeBusterBuild` in `src/buster/model.js` |
| Structural and assignment validation | `validateBusterProgram`, `validateBusterBuild`, and `validateBusterAssignments` in `src/buster/validation.js` |
| Immutable derived plans and Power allocation | `compileBusterBuild` in `src/buster/compiler.js` |
| Recipes and reveal states | `BUSTER_RECIPES` and `getRecipeDiscoveryState` in `src/buster/BusterRecipeCatalog.js` |
| Envelope, save contexts, locks, and conflicts | `src/buster/BusterLabPersistence.js` |
| Roll resources, ownership, blueprints, materialization, and migrations | `BusterLabStorage` in `src/buster/BusterLabStorage.js` |
| Batteries and projectile reservations | `BusterRuntime` in `src/buster/BusterRuntime.js` |
| Per-execution stagger accounting | `src/buster/BusterStagger.js` |
| Deterministic spread, cluster, and ballistic sampling | `src/buster/BusterTrajectory.js` |
| Loadout, execution, explosions, range, sandbox, and shadow bridge | `src/Game.js` |
| Delayed extended-muzzle release and unified firing input | `src/CombatSystem.js` |
| Swept controlled-projectile lifecycle | `src/ProjectileSystem.js` |
| Roll Lab, blueprint controls, benchmark controls, and HUD | `index.html`, `src/UIManager.js`, and `src/ui.css` |
| Deterministic balance model | `src/buster/BusterBalanceGate.js` and `scripts/verify-buster-balance.mjs` |

## Graph-v1 source model

The source schema remains version 1; compiled behavior identifies ruleset
`custom-buster-v0.2`.

```js
{
  schemaVersion: 1,
  rulesetVersion: "custom-buster-v0.2",
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

Physical builds carry `moduleInstanceId` values for physical nodes. Stored
blueprints contain only tuning and program behavior; `sanitizeBlueprint`
removes every physical instance ID. A blueprint therefore cannot claim
ownership merely by being imported or edited.

Program meaning follows the authored `next` and `child` topology. Validation
and compilation walk those edges and enforce grammar in traversal order; they
do not compile by sorting modules into kinds. Normalization sorts detached node
and edge arrays by stable identifiers for canonical serialization, but that
does not change the graph's linked traversal order.

Unknown module IDs remain in normalized source. Unknown saved production
builds are removed from active saved builds, retained as invalid drafts, and
unequipped; they are never silently replaced.

### Supported program shapes

| Form | Supported shape |
| --- | --- |
| Bare direct | `Emitter`, using its implicit native payload |
| Guided direct | `Emitter -> Pursuit Guidance`, then implicit native payload |
| Split direct | `Emitter -> Guidance? -> Spread 3 -> Payload?` |
| Explosive direct | `Emitter -> Guidance? -> Explosion` |
| Split explosive direct | `Emitter -> Guidance? -> Spread 3 -> Explosion` |
| Triggered | `Emitter -> root Guidance? -> Trigger`, with one `child` edge to `child Guidance? -> Splitter? -> Payload?` |

An explicit `pulsePayload` node is equivalent to selecting the emitter's native
payload and costs zero semantic capacity. `cluster5` is child-only, so direct
Cluster and a root splitter before a trigger are invalid. Recursive triggers,
multiple trigger depths, multiple splitters, and graph joins are not supported.

### Validation contracts

`validateBusterProgram` checks ownership-free structure. `validateBusterBuild`
retains the physical instance checks used by saved builds.
`validateBusterAssignments` checks chassis/module inventories and exclusivity
across builds separately.

Structural validation currently enforces:

- Schema 1 and ruleset `custom-buster-v0.2`.
- Integer ratings from `1` through `10`, totaling exactly `16`.
- One emitter at the root, at most one trigger, at most one splitter, and at
  most one Guidance modifier in each scope.
- A connected, acyclic graph with valid ports, unique node IDs, no joins, no
  incoming root edge, and exactly one child edge from a trigger.
- Grammar order for the root and child strips, terminal payloads, and module
  compatibility, including Mortar-only `atApex` and child-only `cluster5`.
- At most five semantic capacity points. Physical nodes and built-in triggers
  cost one point; `pulsePayload` costs zero.
- Energy cost no greater than Maximum Energy.
- Physical instance existence, type match, local uniqueness, and exclusivity
  across saved builds when physical validation is requested.
- `afterDelay` is invalid when `0.60s` is greater than nominal carrier lifetime
  plus epsilon. Exact equality is valid, and less than `0.10s` of remaining
  window produces `TRIGGER_WINDOW_NARROW`.

Errors and warnings share the UI-safe shape
`{ code, path, moduleId, message }`. Invalid drafts remain editable but cannot
be saved, equipped, or run in the production-backed range.

## Unified stat and Power contract

Workshop tuning uses:

```text
rating multiplier = 0.72 + 0.07 x rating
Power              = emitter base Power x Power multiplier x depth scalar
Maximum Energy     = 2 + Energy rating
Range              = emitter base Range x Range multiplier
Base Rapid         = emitter base Rapid x Rapid multiplier
Cycle time         = 1 / Base Rapid + module delays
Child Range        = root Range x 0.65
```

`combatDepthLevel` is clamped and rounded to `1..10`. Encounter spawning calls
`setBusterCombatDepthLevel`, which recompiles future plans. Existing executions
retain the immutable plan captured when they fired. The scalar formula is
implemented, but its current level-10 endpoint is `1.00`, so it presently adds
no depth scaling.

Balanced Mega and Custom tuning is `4/4/4/4`. Both a neutral Mega and a bare
Custom Pulse have Maximum Energy `6`, shot cost `2`, and three opening shots.
The campaign's canonical starter Power Raiser adds `+2 PWR` to the Mega, making
its live Power rating `6` and pulse Power `9.12` while leaving the fixed Mega
program unmodifiable. Mortar costs `3`, so a balanced Mortar has two opening
shots.

Power is deterministic pre-mitigation damage potential. Armor, guards, and
target-specific damage handling are applied after the compiled packet reaches
combat. Explosion applies its allocated packet independently to every target
inside radius `1.55`.

### Module catalog

| Stable ID | Ownership | Implemented v0.2 behavior |
| --- | --- | --- |
| `pulseBolt` | Physical | Power `8`, Range `6.9`, Rapid `4.2/s`, speed `9.5`, Energy `2`; linear native Pulse |
| `mortarShell` | Physical | Power `15`, Range `6.2`, Rapid `1.15/s`, speed `5.8`, Energy `3`; ballistic native impact |
| `pursuitGuidance` | Physical | Power x`0.90`; Energy `0`, cycle delay `0` |
| `atApex` | Physical | `100%` child transfer; Energy `0`, cycle `+0.08s`; Mortar only |
| `onImpact` | Built in | Displayed as **Terminal Relay**; `20%` carrier and `80%` child; Energy `0`, cycle `+0.08s`; contact or range termination |
| `afterDelay` | Built in | Fixed `0.60s`, `104%` child transfer; Energy `0`, cycle `+0.08s` |
| `spread3` | Physical | Three shots at `-0.14/0/+0.14` radians, `110%` aggregate Power; Energy `+1`, cycle `+0.08s` |
| `cluster5` | Physical | Five deterministic radial children, `120%` aggregate Power; Energy `+2`, cycle `+0.16s`; child-only |
| `pulsePayload` | Built in | Explicit native payload selection; no Energy, delay, or semantic capacity |
| `explosion` | Physical | Replaces direct damage with radius-`1.55` Explosion; Energy `+1`, cycle `+0.10s` |

The compiler applies Guidance, trigger transfer, and splitter amplification in
one Power ledger, then uses the continuous soft cap:

```text
raw <= 1.25
  ? raw
  : 1.25 + (raw - 1.25) / (1 + 4 x (raw - 1.25))
```

The cap has knee `1.25` and asymptote `1.50`. Carrier and terminal allocations
are compressed proportionally before a terminal batch is divided among its
projectiles. The UI shows compression fields only when the raw multiplier is
above the knee. No intended v0.2 catalog combination currently crosses it;
After Delay plus Cluster reaches `1.248`.

### Immutable compiler output

`compileBusterBuild(build, { combatDepthLevel })` returns a deeply frozen,
derived plan containing:

- Exact base, tuned, depth-scaled, raw, effective, carrier, terminal-batch, and
  per-projectile Power.
- Maximum Energy, Energy cost, opening shots, Base Rapid, module delays, cycle
  time, and final Rapid.
- Root and child Range, projectile speed, deterministic trajectory data, and
  nominal lifetimes.
- Power, Energy, cycle, and capacity ledgers; warnings; semantic program order;
  and a plain-language description.
- An ordered action graph with execution IDs assigned later by the runtime.
- Peak projectile reservation and nominal occupancy estimates.
- Preview records used by the Lab and benchmark panel.

Compiled plans are never persisted. Source graphs, tuning, revisions, and
ownership are the durable inputs.

## Battery runtime and projectile lifecycle

`BusterRuntime` keeps independent state per weapon key and separates
side-effect-free `canFire` from stateful `requestFire`.

- A successful shot alone spends Energy, starts cycle time, and resets the
  `0.65s` recharge delay.
- The active weapon does not recharge while fire remains held and the weapon
  is unlocked.
- A released or idle active weapon recharges at `maxEnergy / 1.8` per second
  after the delay.
- Inactive registered weapons recharge independently at half that speed.
- Any held or tapped request with insufficient Energy sets `recoveryLocked`.
  The lock clears only at full Energy; held input controls only whether combat
  requests another shot afterward.
- Failed Energy requests do not restart the delay.
- Capacity rejection, spawn rejection, and thrown execution callbacks spend no
  Energy. Spawn rejection restores prior battery and cycle state.

The runtime atomically reserves each plan's peak moving-projectile batch
against a global capacity of `24`. Every controlled projectile carries build
revision, execution ID, action ID, trigger depth, reservation token, attack
domain, and execution metadata. The reservation is released after the last
controlled projectile in the execution is disposed.

Controlled projectile updates perform swept collision and chronologically
compare Delay, Apex, enemy impact, range/landing, and disposal within a frame.
At an exact timestamp, Delay/Apex delivery wins before enemy impact, which wins
before range and disposal. The shared ballistic sampler supports differing
start and end elevations.

If an Apex or Delay carrier contacts an enemy or reaches termination before its
programmed trigger, it delivers the child branch immediately at that position,
once, and suppresses the old full native-impact fallback. Terminal Relay
delivers its branch on enemy contact or range end. Cancellation, reset, world
clear, and sandbox teardown do not synthesize pending branches. Terrain-wall
collision remains outside the compiled lifecycle.

Guidance uses an explicit target lock first and otherwise stable target-ID
tie-breaking. Root Guidance affects only the carrier; child Guidance reacquires
independently. Spread, Cluster, and ballistic paths contain no runtime
randomness.

Registering a new plan revision or switching arms changes future shots only.
In-flight executions retain their captured plan. Explicit destructive
transitions such as reset, range entry/exit, invalidation with cancellation,
and world clear still cancel matching executions by reason.

### Stagger

Each target/execution pair tracks its largest nominal stagger duration. A new
positive-damage packet contributes only:

```text
additional = max(0, newDuration - previousLargest)
newEnd      = max(currentEnd, hitTime + additional)
```

Equal or smaller packets add nothing; a later larger packet contributes the
difference. Zero-damage hits do not advance the budget. Direct and Explosion
packets share the same execution ledger.

## Loadout, attack domain, and presentation

Feature-on arm resolution uses:

```js
{ kind: "megaBuster" }
{ kind: "customBuster", buildId }
{ kind: "legacyItem", item }
```

- Slot 1 remains the fixed left-arm Mega Buster.
- Slots 2 and 3 accept separate physical Custom builds or legacy special arms.
- Slot 4 remains the utility arm.
- Custom chassis and modules never enter random item generation or generic
  equipment aggregation.

Unified Mega and Custom packets use attack domain `customBuster` with
`suppressGenericOffense`. They do not call legacy random damage or inherit
generic Attack, crit, Area, projectile-count, element, life-steal, Chain Shock,
or Explosive Finish behavior. Player ownership, ordinary enemy damage, armor,
guards, XP, loot, and direct geometric weak points remain active in production.
Direct projectiles carry resolved part metadata; Explosion splash is body/AoE
damage and does not precision-hit a weak point.

Compiled explosions set `damagePlayer: false` and `triggerMines: false`. Their
visual style is an orange expanding fiery sphere: three additive orange,
amber, and hot-yellow spherical layers plus particle bursts. The same shared
fiery visual helper is used by Reaverbot destruction. Legacy explosions keep
their existing flat-ring presentation.

Both Mega and Custom fire use a `0.18s` brace gate. Initial input stores a
pending intent and extends the arm without spending Energy. Combat re-samples
the live muzzle and releases only after the projectile pose is sustained at
full extension, preventing a shot from appearing at the hip. Weapon changes,
dodge, ledge cling, death, control locks, and range transitions clear a pending
intent without spending Energy.

The unified HUD uses one `BAT` gauge, remaining/maximum shots, and
`PWR / ENG / RNG / RPD / MAG` chips. It distinguishes `CYCLE`, `ENERGY`, and
`RECOVERY`. Legacy arms retain their existing Energy/Output telemetry.

## Roll economy, recipes, and physical ownership

A fresh context receives one Workshop Chassis A and one physical starter
`pulseBolt` exactly once. Chassis B costs `20 identifiedScrap`; at most two
physical chassis may exist. A physical module instance may be installed in
only one saved build, and one physical build may occupy only one arm assignment.
Retuning, rearrangement, installation, and removal do not consume salvage.

### Active original recipes

| Module | Named salvage | Identified scrap |
| --- | --- | ---: |
| `pulseBolt` | `revolvingPulseBarrel` | 6 |
| `mortarShell` | `highAngleLaunchTube` | 8 |
| `pursuitGuidance` | `behaviorChipPursuit` + `rubyOpticLens` | 12 |
| `atApex` | `ballisticsLogicChip` | 8 |
| `spread3` | `ammunitionFeedDrum` + `revolvingPulseBarrel` | 10 |
| `cluster5` | `clusterBurstSequencer` | 12 |
| `explosion` | `volatileOverloadCell` | 10 |

`afterDelay` has no active recipe; it is a built-in chassis instruction.

Recipe discovery has permanent `unknown`, `hinted`, and `full` states. Unknown
cards render only silhouettes. Discovering one component of a multi-part recipe
renders its authored name/function and Roll clue while the cards and
materialization routes withhold exact costs and ingredients. Discovering every
required part type reveals the exact recipe permanently. One-part recipes move
directly from unknown to full.

Original fabrication remains available after the first craft. A successful
non-debug original craft unlocks scrap-only replication of that module at twice
the original scrap cost. Imported v1 fabricated instances also unlock their
replication route; starter and debug instances do not. When both routes are
affordable, materialization requires an explicit route choice. Requests are
processed in deterministic order, so an earlier original craft in one atomic
materialization may unlock replication for a later copy.

All fabrication and materialization resource changes use Roll's transactional
recipe operation: named parts, identified scrap, ownership records, and build
revision commit together or none commit.

## Blueprints and materialization

The store retains up to eight blueprints. Blueprints have their own IDs and
revisions, contain no physical instance IDs, and may be structurally compiled
without ownership. The Lab can create one from a draft, select it, edit it,
save a revision, delete it, prepare materialization, and confirm the result.

Known but undiscovered modules in an imported blueprint are retained as
locked/redacted. Truly unknown IDs are retained and invalid. Materialization
prepares a suggestion bound to the blueprint revision and storage
`revision/writeId`, assigns available unclaimed instances first, and exposes
fabrication routes only for fully discovered recipes. Confirmation rechecks the
same versions and commits every craft, assignment, saved build, draft, and
revision in one transaction.

The Lab exposes JSON blueprint export and file import. The storage transaction
strips physical ownership and tags foreign provenance. Imported designs whose
known modules have not been discovered remain locked/redacted but are eligible
for the explicit full-catalog sandbox; truly unknown IDs remain invalid. There
is no automatic cross-context application of a full Lab envelope.

## Persistent debug kit

The Debug Tools grant is visible only with `busterLabDebug=1` and is repeatable.
Each successful grant atomically adds:

- One debug-origin physical copy of each of the seven physical modules.
- One debug-origin copy of each of the six Mega calibration types.
- Chassis B and its draft if absent.
- Full discovery for all active recipes.
- The complete active original-recipe bill: `66 identifiedScrap`, two
  `revolvingPulseBarrel` parts, and one of every other named ingredient.

Debug copies and resources persist. Debug-origin module instances do not unlock
replication. The grant count is also persisted.

## Storage envelope, durability, and migration

`BusterLabStorage.open` is awaited before `Game` initialization. Durable state
uses this envelope:

```js
{
  storageVersion: 2,
  saveContextId,
  revision,
  writeId,
  updatedAt,
  state
}
```

The active context ID lives at `ruinDigger.saveContext.v1`. Context-scoped keys
are:

```text
ruinDigger.busterLab.v2.<encoded saveContextId>
ruinDigger.busterLab.v2.<encoded saveContextId>.backup
ruinDigger.busterLab.v2.<encoded saveContextId>.corrupt
```

The old global `ruinDigger.busterLab.v1` payload is left untouched. The storage
API can inspect it, require confirmation, adopt it under a global import lock,
and record one global import claim.

Browser writes require Web Locks under
`ruinDigger:busterLab:<saveContextId>`. `transact` re-reads and verifies the
expected revision and write ID inside the exclusive lock. Lock acquisition
times out after five seconds; conflicts and timeouts put the current store into
read-only mode. Without Web Locks, a browser Lab opens read-only. Node tests use
a compatible in-memory lock manager.

An open browser store also listens for changes to its context's main storage
key. A different revision/write ID, removal, or malformed external payload
pauses writes and records conflict details. Events received during a local
transaction are queued until that transaction leaves its lock. The Lab can
then reload the durable state or download an
in-memory/main/backup/corrupt recovery bundle from its persistence controls.

Before replacing the main payload, the previous envelope is copied to the
context backup. An unreadable main payload is retained under the corrupt key;
the loader restores a valid backup when possible or creates a safe starter Lab
and exposes a warning. Unknown saved modules preserve their source draft while
clearing unsafe assignments.

### Persisted v2 state

| Field | Contents |
| --- | --- |
| `rollSalvage` | Roll's identified scrap and canonical named-part stockpile |
| `discovery` | Ever-discovered salvage IDs, ordered history, and permanent recipe history |
| `moduleInstances` | Starter, fabricated, replication, and debug physical module copies |
| `chassisInstances` | Physical Chassis A and optional Chassis B |
| `chassisBuilds` | Last valid production sources for physical chassis |
| `chassisDrafts` | Editable physical drafts, including incomplete drafts |
| `chassisRevisions` | Saved immutable source snapshots and revision numbers |
| `assignments` | Physical Build A/B assignments for arm slots 2 and 3 |
| `blueprints`, `nextBlueprintId` | Up to eight ownership-free source designs and allocator state |
| `fabricationHistory` | Original/replication counts and first-original sequence per module |
| `megaCalibrations` | Calibration instances, four sockets, allocator, and revision |
| `legacyBusterParts` | Authoritative shadow Item records and reciprocal calibrations |
| `migrations` | Starter, unknown-module, debug, After Delay, and import/migration markers |
| `nextInstanceId` | Stable physical-module instance allocator |

Runtime batteries, compiled plans, projectiles, current enemies, dungeon
progress, general inventory, and general equipment are not saved in this Lab
slice. Legacy Buster Item snapshots are the deliberate exception needed by the
toggle bridge.

### Legacy shadow ownership

Each bridged legacy Buster Part has one authoritative record and one fixed
linked calibration. IDs use
`legacy-buster:<saveContextId>:<sequence>`. Feature-on initialization removes
eligible live Items only after durable registration and exposes their linked
calibrations. Feature-off startup hydrates the saved Item snapshot into its
logical inventory or Buster-upgrade socket. Rarity, level, and random rolls
remain on the Item snapshot but do not alter the calibration mapping.

Feature-off socket assignment, uninstallation, individual discard, rarity
salvage, and Optimize Loadout first reconcile affected shadow locations or
removals in one awaited storage transaction. The corresponding live inventory
or socket mutation occurs only after that durable commit succeeds. Optimize
also preserves physical Custom Busters already assigned to arm slots 2 and 3.

A feature-off world pickup for a legacy Buster Part remains pending in the
world until its linked shadow Item and calibration commit durably. A failed
commit leaves inventory and storage unchanged so collection can be retried. If
the final live inventory slot fills while the lock is awaited, the committed
exact Item moves to Roll's Migration Recovery and the world pickup completes,
preventing a duplicate retry.

The storage model enforces reciprocal socket links, four installed sockets,
and at most 40 shadow inventory records. If feature-off hydration cannot fit an
Item, it places it in the in-memory `busterMigrationRecovery` collection rather
than expanding inventory capacity. The inventory UI renders that authoritative
overflow as **Roll's Migration Recovery** and lets the player retrieve each Item
when normal inventory space is available. The same durable shadow record
reconstructs the recovery entry after reload. One canonical starter Power
Raiser record is registered per context and begins in Mega socket 1 while the
feature is on.

Already-destructively-converted v1 calibrations are retained without invented
legacy Items. Migration stores their exact instance IDs and count under
`unlinkedLegacyCalibrationsV2`, and the Lab presents a permanent warning that
they remain feature-on-only.

The one-time After Delay migration strips obsolete instance IDs from builds,
drafts, revisions, and blueprints; removes physical After Delay instances;
refunds each fabricated instance with one `clusterBurstSequencer` and 8 scrap;
removes debug instances without refund; and persists exact counts so the refund
cannot repeat. Its retired recipe history remains available for audit.

## Roll Lab UI

Roll's workshop contains top-level Salvage Analysis and Buster Lab tabs. The
Lab currently exposes:

- Mega, Build A, Build B, and stored blueprint selection.
- Four tuning controls with remaining-point and semantic-capacity counts.
- A structured root/child program strip whose options are filtered by recipe
  reveal state.
- Physical inventory, installed ownership, recipe-discovery cards, original
  and replication routes, and Chassis B purchase.
- Compiler-derived base/effective/per-child Power, projectile count, Energy,
  shots per magazine, Rapid, Ranges, trigger, reservation, description, and
  conditional soft-cap details.
- Explicit save, equip, range, sandbox, blueprint, suggestion, and
  materialization actions, with shared validation reasons.
- Blueprint JSON import/export, full recovery export, durable-state reload,
  confirmed v1 adoption, and confirmed New Campaign controls. New Campaign
  rotates the save context and reloads the prototype; the old context remains
  dormant for recovery.
- Storage context/revision/read-only status and visible load or migration
  warnings.

## Production-backed benchmark range

`enterBusterTestRange` uses the production compiler, `BusterRuntime`, projectile
system, damage path, and firing animation with an ephemeral weapon key. It
supports one, two, or four targets and stationary, moving, armored, weak-point,
or elite profiles at normalized depth 1, 5, or 10.

The range tracks delivered and mitigated Power, Energy samples, opening
magazine, projected 10s/30s output, peak occupancy, direct weak-point hits,
stagger, misses, kills, and average TTK. It suppresses rewards. Exit clears
range projectiles and dummies, disposes range resources, restores position,
loadout, active slot, arena radius, workshop state, and the pre-range runtime
resource snapshot.

Range entry intentionally cancels the previously active weapon's in-flight
execution rather than freezing and restoring those projectiles.

## Disposable dungeon sandbox

`?busterLab=sandbox` enables `captureWorldContext`, `activateWorldContext`,
`createBusterSandboxContext`, and `disposeWorldContext` integration.

Entering the sandbox captures the production world by identity, regenerates a
fresh dungeon from the same layout seed, creates a fresh full-health player
copy, fresh encounter systems, a separate `BusterRuntime`, and a separate
enemy-ID allocator and 24-projectile budget. The sandbox begins at the dungeon
entrance. The active game loop operates on the sandbox references, so the
captured production timers, enemy allocator, enemies, batteries, projectiles,
and executions do not receive catch-up time.

Sandbox attacks carry no-reward metadata, and enemy death additionally checks
the active sandbox session before XP or drops. The sandbox world owns separate
inventory, loot, refractor, map-event, enemy, hazard, effect, and projectile
collections, so mutations are discarded with the world. Manual exit or defeat
clears projectiles and pending attacks, disposes enemies, player, animators,
geometry, materials, and textures not shared with production, then restores
the original world and reopens Roll's prior workshop state.

The implementation regenerates deterministic encounter content; it does not
clone the exact live-frame enemy state, which remains intentionally deferred.

## Verification coverage

The ordinary Buster command currently runs:

```text
npm run test:buster
  -> tests/buster-compiler.test.mjs
  -> tests/buster-lab-storage.test.mjs
  -> tests/buster-runtime.test.mjs
  -> tests/buster-balance.test.mjs
  -> tests/buster-lab-runtime.spec.js
```

On July 14, 2026, `npm run check` passed and the focused suites passed all 74
Node tests plus all 10 single-worker Chromium tests. The subsequent strict
`npm run verify:buster-balance` command remains intentionally unsuccessful
because the release gate described above does not pass.

Adjacent verification also passed all 48 Reaverbot Node regressions and all
five Roll-camp/pickup-floor Chromium regressions.

These suites cover compiler constants and graph errors, structural/physical
separation, semantic capacity, trigger reachability, Power allocation, recipe
transactions and secrecy, debug grants, blueprints/materialization at the
storage level, graph-ordered in-transaction replication, context rotation and
conflicts, no-lock/timeout read-only recovery, shadow-capacity reservation,
legacy layout reconciliation, After Delay migration, external storage-event
write pausing and recovery export, normalized three-weapon batteries, stagger
deltas, swept lifecycle ordering at 30/60/120 Hz, deterministic trajectories,
direct weak-point resolution, feature-off behavior, extended-muzzle timing,
core Lab range use, blueprint creation and original-route materialization
through Roll's UI, durable world-pickup commit ordering and idempotent retry,
sandbox pre-entry transaction barriers, enemy-ID isolation, write rejection,
repeated teardown/restoration, compiled
lifecycle programs, corruption, and unknown-module quarantine.

The balance test verifies that the exhaustive search reports the current
blocker; it does not claim the release gate passes. `npm run check` enumerates
both `BusterBalanceGate.js` and its strict verifier, and the Buster barrel
exports the balance model.

## Current limitations and release blockers

These are verified current facts and coverage limits.

1. **The deterministic release gate fails.** The nearest authorized search
   candidate is scalar `1.25`/Mortar `18`; it fails 89 of 90 comparisons. The
   largest reported miss is level-10 direct Spread-Explosion room-clear time
   `20.855263s` versus the standard Cannon fixture's `0.648649s`. No Cluster
   fallback is authorized by the gate result.

2. **Generic equipment comparison remains legacy-oriented.** Optimize Loadout
   preserves existing Custom assignments and durably reconciles legacy Buster
   sockets, but generic Item tooltips still use legacy `getPowerScore`. They do
   not present a meaningful cross-domain comparison against a compiled Custom
   Buster.

3. **Sandbox coverage remains incomplete.** Browser coverage verifies distinct
   world identities, the same layout seed, unchanged production
   resources/storage/timers, pending-command entry barriers, independent enemy
   IDs, rejected durable writes, workshop restoration, and three complete
   entry/exit disposal cycles. It
   does not cover defeat restoration, reward-generating combat, or asynchronous
   asset races.

4. **Benchmark preview output is partly estimated.** Before or outside a live
   range run, 10s/30s output is `finalRapid x effectivePower x time` and does
   not simulate magazine lock/recovery. The displayed magazine recovery does
   include the `0.65s` delay plus proportional full-battery refill time. Live
   range output is an extrapolation of delivered Power over elapsed test time.

5. **The Lab remains a partial save.** It has a campaign context identity,
    backups, corrupt quarantine, and locked writes, but not a general game-save
    transaction. General inventory and world progression can still diverge
    from the durable Lab bridge after unsupported live mutations.

6. **Synchronous compatibility mutators remain public.** Production-facing
    Game operations generally use awaited `*Async` adapters under the context
    lock, but `BusterLabStorage` still exposes synchronous mutation methods for
    compatibility and unit use; callers outside the Game integration can bypass
    the awaited lock boundary.

7. **Focused browser tests are still absent for several attack-domain claims.**
    Pure/runtime tests cover direct weak-point resolution and metadata, but
    there is no individual browser assertion for every suppressed generic proc,
    Explosion body-only weak-point behavior, in-flight survival across a live
    weapon switch/recompile, blueprint UI redaction for partial recipes, the
    persistence import/export/adoption/New Campaign controls, or benchmark
    metric parity.

## Deferred families

Terrain-wall collision, recursive triggers, additional splitters, Arc/Field/Mine
modules, elements, criticals, random module affixes, chassis grades,
proficiency, catalysts, beams, melee, drills, shields, cones, and a general
full-game save remain outside this v0.2 implementation.
