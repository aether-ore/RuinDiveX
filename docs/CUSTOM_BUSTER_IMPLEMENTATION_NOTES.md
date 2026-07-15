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

The reconstructed balance gate now separates implementation correctness from
the frozen catalog's gameplay verdict. Shared-kernel, simulator, detector, and
contract-registry correctness pass. The production catalog remains frozen at
`BUSTER_LEVEL_10_POWER_SCALAR = 1.00`, Mortar Power `15`, and Cluster Energy
surcharge `+2`; no diagnostic candidate is selected, saved, or equipped.

The frozen catalog is **not release-ready**. `npm run verify:buster-balance`
reports zero hard-correctness failures and three internal-role failures:

- Spread-Explosion reaches two separated targets instead of direct
  Explosion's one, but delivers `52.8` versus `64` Power over 10 seconds.
- Delayed Cluster-Explosion and delayed plain Explosion both deliver zero hits
  and zero output in their declared separated scenario; their compiled cycle
  times are `1.2095652173913045s` and `1.0495652173913044s`, respectively.
- The declared dominance check flags direct Spread-Explosion against direct
  Explosion across its declared `spreadSeparated` and `single` scenarios.

The 676-candidate scalar/Mortar/Cluster matrix is diagnostic-only and does not
alter this verdict. `npm test` verifies implementation correctness and may stay
green while the catalog is blocked. `npm run verify:release` requires both the
ordinary tests and the strict frozen-catalog verifier.

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

There is one deliberate live-combat exception to historical feature-off
parity: legacy projectile Range is now profile-specific in every feature mode.
Machine Gun and Cannon use resolved base `attackRange` with no implicit bonus.
Missile uses `max(base attackRange + 1.8, homingRange)`. The contextual legacy
balance fixtures report these same policies instead of applying `+1.8` to all
three arms.

The browser test `feature-off and feature-on share one canonical starter Power
Raiser without duplication` protects the toggle bridge and starter identity.

## Source map

| Concern | Primary symbols/files |
| --- | --- |
| Ruleset, module values, Mega profile, calibration mapping | `CUSTOM_BUSTER_RULESET`, `BUSTER_MODULE_CATALOG`, and `MEGA_BUSTER_BASE_PROFILE` in `src/buster/catalog.js` |
| Source cloning, normalization, serialization | `normalizeBusterBuild`, `serializeBusterBuild`, and `deserializeBusterBuild` in `src/buster/model.js` |
| Structural and assignment validation | `validateBusterProgram`, `validateBusterBuild`, and `validateBusterAssignments` in `src/buster/validation.js` |
| Immutable derived plans, resolved-tuning Mega compilation, Power allocation, and diagnostic overrides | `compileBusterBuild` and `compileMegaBusterPlan` in `src/buster/compiler.js` |
| Recipes and reveal states | `BUSTER_RECIPES` and `getRecipeDiscoveryState` in `src/buster/BusterRecipeCatalog.js` |
| Envelope, save contexts, locks, and conflicts | `src/buster/BusterLabPersistence.js` |
| Roll resources, ownership, blueprints, materialization, and migrations | `BusterLabStorage` in `src/buster/BusterLabStorage.js` |
| Batteries and projectile reservations | `BusterRuntime` in `src/buster/BusterRuntime.js` |
| Per-target/per-execution stagger grant ledger | `src/buster/BusterStagger.js` |
| Deterministic spread, cluster, and ballistic sampling | `src/buster/BusterTrajectory.js` |
| Shared numeric collision, swept-flight, Guidance, and event-order kernel | `src/buster/BusterProjectileKernel.js` |
| Loadout, execution, explosions, range, sandbox, and shadow bridge | `src/Game.js` |
| Delayed extended-muzzle release and unified firing input | `src/CombatSystem.js` |
| Scene/projectile adapter for the shared swept lifecycle | `src/ProjectileSystem.js` |
| Roll Lab, blueprint controls, benchmark controls, and HUD | `index.html`, `src/UIManager.js`, and `src/ui.css` |
| Packet encounter simulation, fixtures, metrics, and rotation reports | `src/buster/BusterBalanceSimulator.js` |
| Frozen-catalog contracts and strict verdict | `src/buster/BusterBalanceGate.js` and `scripts/verify-buster-balance.mjs` |

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
combat. A Custom Explosion applies its allocated packet independently to every
production body capsule intersecting a radius-`1.55` sphere. This uses the
shared vertical-capsule geometry rather than distance to an enemy's feet/root,
and remains body-only: splash never receives weak-point amplification. Legacy
Explosion collision is unchanged.

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

`compileMegaBusterPlan({ resolvedTuning, calibrationRevision,
combatDepthLevel, level10PowerScalar })` sends the fixed Mega pulse through the
same immutable compiler pipeline. The caller resolves owned calibrations
upstream; this function never installs the starter Power Raiser itself.
Consequently, resolved `4/4/4/4` tuning compiles to Power `8`, while the normal
live `6/4/4/4` tuning compiles to `9.12`.

Compiler balance overrides are diagnostic-only. The exact whitelist permits
only finite positive `mortarShell.basePower` and nonnegative integer
`cluster5.energyCost`. Overrides require `diagnosticContext: true`, are applied
before validation, Energy, ledgers, stagger, occupancy, and derived statistics,
and are recorded on the immutable plan with catalog and diagnostic values.
Supplying a noncatalog `level10PowerScalar` is likewise diagnostic-only: it
must be finite and positive, requires the same explicit context, and is recorded
as a `ruleset.level10PowerScalar` override. The catalog scalar `1.00` remains a
normal production input.

`BusterRuntime` rejects such a plan unless its caller also supplies an explicit
diagnostic context, preventing a sensitivity candidate from leaking into
normal play.

The benchmark-simulation cache includes `cacheScope`, build ID, source/build
revision, combat depth, resolved level-10 scalar, resolved tuning, serialized
source signature, scenario ID, and a canonical sorted list of diagnostic
override records with module, field, catalog value, and diagnostic value. A
diagnostic scalar or module candidate therefore cannot reuse a canonical
production preview entry.

## Battery runtime and projectile lifecycle

`BusterRuntime` keeps independent state per weapon key and separates
side-effect-free `canFire` from stateful `requestFire`.

- A successful shot alone spends Energy, starts cycle time, and resets the
  `0.65s` recharge delay.
- Recharge becomes eligible only after **both** the current cycle and the
  `0.65s` post-shot delay finish. If either boundary falls inside a timestep,
  only the portion after both boundaries recharges; an exact-boundary firing
  request is resolved before recharge.
- Input style does not alter that clock. At the same release timestamps, tap
  and held input have the same Energy economics.
- Eligible active weapons recharge at `maxEnergy / 1.8` per second. Eligible
  inactive registered weapons recharge independently at half that speed.
- Any held or tapped request with insufficient Energy sets `recoveryLocked`.
  The lock clears only at full Energy; held input controls only whether combat
  requests another shot afterward.
- Failed Energy requests do not restart either boundary.
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
start and end elevations. Trigger-spawned ballistic children retain the
execution's original authored aim elevation; the carrier's trigger altitude is
not substituted as the child's trajectory endpoint.

When a carrier triggers partway through a frame, both production and the
simulator immediately advance every spawned child through the carrier's unused
frame remainder. This prevents a large frame from postponing child collision or
Explosion delivery until the next render tick.

The numeric work is centralized in `BusterProjectileKernel`: production's
`ProjectileSystem` and the balance simulator both call the same vertical
capsule body geometry, swept straight/ballistic intersection, Guidance target and
stable-ID tie rules, steering, segment sampling, and chronological arbitration.
Production remains the adapter for Three.js objects, callbacks, damage,
visuals, pooling, reservations, and child creation; the simulator does not
maintain an independent projectile-math implementation.

If an Apex or Delay carrier contacts an enemy or reaches termination before its
programmed trigger, it delivers the child branch immediately at that position,
once, and suppresses the old full native-impact fallback. Terminal Relay
delivers its branch on enemy contact or range end. Cancellation, reset, world
clear, and sandbox teardown do not synthesize pending branches. Terrain-wall
collision remains outside the compiled lifecycle.

Guidance uses an explicit target lock first and otherwise stable target-ID
tie-breaking. Root Guidance retains its valid locked target on the carrier.
Child Guidance does not inherit that lock across a trigger boundary; it
reacquires independently, with the same stable tie rules and only inside its
compiled homing Range. The simulator mirrors both scope rules. Spread, Cluster,
and ballistic paths contain no runtime randomness.

Registering a new plan revision or switching arms changes future shots only.
In-flight executions retain their captured plan. Explicit destructive
transitions such as reset, range entry/exit, invalidation with cancellation,
and world clear still cancel matching executions by reason.

### Stagger

Each target/execution ledger entry records both `largestNominalDuration` and
`totalGrantedDuration`. A positive-damage packet computes:

```text
largest    = max(previousLargest, newDuration)
additional = max(0, largest - previousTotalGranted)
total      = previousTotalGranted + additional
```

Combat extends the target's current stagger by exactly `additional`, instead
of inferring a contribution from the status endpoint. Equal or smaller packets
add nothing; a later larger packet grants the previously ungranted difference
even when it arrives after the first status began. Zero-damage hits do not
advance either ledger value. Direct and Explosion packets from the same
execution share this target-specific budget.

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

Lock acquisition still requires a currently valid, exposed target. Once an
exposed weak point is locked, closing armor or a defensive part does not clear
or retarget that lock: facing, the marker, and projectile guidance continue to
track the covered mechanism, while damage resolution continues to treat it as
blocked rather than as an exposed weak-point hit. Dodge rolls also preserve the
selected lock for their full duration. Enemy death or disposal, explicit
unlock, weapon switching, safe-area entry, and leaving lock range still clear
the lock normally.

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
intent without spending Energy. The extension pose is independent from body
locomotion: free primary fire permits normal tank turning and movement while
projectiles remain active. Manual aim and retained lock-on deliberately keep
aim-facing and use camera-relative strafing. Compiled cadence does not extend
the body-facing lock or inherit the generic projectile stance linger.

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
replication. The grant count is also persisted. The same Debug Tools tab has a
weapon/blueprint selector, benchmark target/profile/depth presets, direct Test
Range and Sandbox launch actions, a Roll Lab shortcut, and a non-persistent
battery/cycle reset. Enter Sandbox remains disabled unless the page was opened
with `?busterLab=sandbox`.

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

## Shared packet simulator and benchmark fixtures

`simulateBusterEncounter` (an alias of
`simulateBusterBalanceScenario`) consumes an ordered immutable compiled plan,
uses a real diagnostic-capable `BusterRuntime`, and advances projectiles through
the shared numeric kernel at an authoritative `1/120s` step. It simulates
individual carrier, direct, split, trigger-child, and Explosion packets rather
than multiplying aggregate Power by projectile count. Power conservation is
checked before AoE fan-out; one Explosion packet may subsequently apply once
to every eligible target capsule.

The canonical fixture freezes these values:

| Fixture value | Contract |
| --- | --- |
| Muzzle | `(0, 1.05, 0)` |
| Body collider | Vertical capsule, radius `0.58`, height `1.80` |
| Near / mid / far | `3.2 / 4.8 / 6.0` horizontal units |
| Compact / separated chord | `1.20 / 2.50` units on an equal-radius arc |
| Body aim height and offsets | `1.05`; center, `+/-0.29`, `+/-0.58` |
| Weak point | Radius `0.24`, height `1.12`, forward offset `0.48` |
| Weak-point aim offsets and multiplier | center, `+/-0.12`, `+/-0.24`; `2.4x` |

Benchmark health and armor are also authored fixtures rather than generic
dummy defaults. For `level` in `1..10`, they resolve as follows:

| Profile | Health | Armor |
| --- | --- | --- |
| Ordinary | `24 x (1 + 0.16 x (level - 1))` | `0` |
| Armored | `58 x (1 + 0.16 x (level - 1))` | `12 x (1 + 0.08 x (level - 1))` |
| Elite | `43.2 x (1 + 0.18 x (level - 1))` | `10 x (1 + 0.10 x (level - 1))` |
| Median procedural | `34 x (1 + 0.20 x (tier - 1)) x 1.12` | `8 x (1 + 0.12 x (tier - 1))` |
| Weak point | Same as median procedural, plus authored direct-hit geometry and `2.4x` direct multiplier | Same as median procedural |

For the procedural profiles, `tier = clamp(round(level), 1, 8)`. Production
range dummies receive these exact resolved profile values from the shared
scenario; their older fallback health/armor values are not used for benchmark
fixtures.

For chord `s` at distance `D`, the scenario builder uses
`delta = 2 asin(s / 2D)` and non-overlapping equal-radius angular slots. It
supports stationary, in-phase lateral, and one-stationary/one-lateral crossing
motion. Unguided aim is sampled at muzzle release; Guidance updates each
authoritative tick with production's stable target rules.

Nonlethal scenarios drive fixed 10s/30s delivered-output contracts. Separate
finite-health scenarios return TTK and room-clear results. Simulation results
are immutable and use explicit `cleared`, `unresolved`, `invalid`, or
`candidate-invalid` states rather than comparing infinities. Metrics include
per-target packet transcripts, Energy timeline, mitigation, opening magazine,
recovery, occupancy, misses, unique target coverage, direct weak-point hits,
stagger grants, first impact, TTK/clear time, and pre-fan-out conservation.
Armor applies the production fixture formula
`delivered = incoming x 100 / (100 + armor)` and records the exact difference
as mitigated Power. In lethal fixtures, death and room clear are timestamped at
the precise lethal packet event within the frame, so TTK does not round up to
the outer `1/120s` step.

Both clocks are retained: release-relative values drive balance contracts,
while input-relative values include the initial `0.18s` arm extension. Rotation
reports split brace, swap, and combined transition-lock time.
`simulateBusterRotation` reports 30s/60s feasible output lower bounds,
best-single comparison, swaps, stable lexical tie resolution, termination
metadata, and an explicit precision-tap input policy. The current strict report
is `status: "bounded"`, `exact: false`, and `optimality: "unproven"`, so its
`1.07427451` 60-second advantage ratio is report-only rather than a hard catalog
judgment. Both the 30-second and 60-second searches reached `120001` processed
transitions against the explicit `120000` transition bound before proving an
exhaustive frontier. Moving rotation fixtures are rejected until delivery is
recomputed for every absolute release rather than reusing a time-zero packet.

The Lab's expected 10s/30s preview and benchmark expectation use this same
packet/battery simulation against a stationary, unarmored, infinite-health
midrange target. Live range measurements remain production observations and
display their difference from the expectation.

## Production-backed benchmark range

`enterBusterTestRange` uses the production compiler, `BusterRuntime`, projectile
system, damage path, and firing animation with an ephemeral weapon key. It
supports one, two, or four targets and stationary, moving, armored, weak-point,
or elite profiles at normalized depth 1, 5, or 10.

The range tracks delivered and mitigated Power, Energy samples, opening
magazine, simulator-expected and live-observed 10s/30s output, parity deltas,
peak occupancy, direct weak-point hits, stagger, misses, kills, and average
TTK. It suppresses rewards. Exit clears
range projectiles and dummies, disposes range resources, restores position,
loadout, active slot, arena radius, workshop state, and the pre-range runtime
resource snapshot. When launched from Debug Tools, it closes the paused editor
for combat and restores the same Buster debug tab on exit.

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
the original world and reopens Roll's prior workshop state. A sandbox launched
from Debug Tools instead restores that Buster debug tab.

The implementation regenerates deterministic encounter content; it does not
clone the exact live-frame enemy state, which remains intentionally deferred.

## Verification coverage and command policy

The command boundary intentionally distinguishes a correct implementation from
a catalog whose authored role contracts pass:

```text
npm run test:buster-simulation
  -> compiler, runtime, shared-kernel, packet-simulator, detector, contract,
     and headless-browser parity correctness

npm run test:buster
  -> compiler, storage, runtime, kernel, simulator, balance-model, Lab runtime,
     and headless-browser parity correctness

npm test
  -> syntax checks plus ordinary Buster and Reaverbot correctness suites

npm run verify:buster-balance
  -> strict frozen-catalog role verdict; currently exits unsuccessfully

npm run verify:release
  -> npm test, then the strict frozen-catalog verifier
```

The Playwright checks run headlessly and do not require the Codex in-app
browser. The strict verifier prints the stable sections `HARD CORRECTNESS`,
`INTERNAL ROLE CONTRACTS`, `LEGACY CONTEXT REPORTS`, `SENSITIVITY DIAGNOSTICS`,
and `RUNTIME POLICY WARNINGS`. Failed simulation-role entries retain their
complete immutable actual and comparator transcripts in strict output, including
release/input timestamps, projectile spawns, trigger reasons, packet recipients,
Power, stagger, and Explosion fan-out; summaries do not replace this evidence.

The focused suites cover compiler constants and graph errors, structural/physical
separation, semantic capacity, trigger reachability, Power allocation, recipe
transactions and secrecy, debug grants, blueprints/materialization at the
storage level, graph-ordered in-transaction replication, context rotation and
conflicts, no-lock/timeout read-only recovery, shadow-capacity reservation,
legacy layout reconciliation, After Delay migration, external storage-event
write pausing and recovery export, normalized batteries, input-independent
recharge, full-only recovery unlock, stagger delta grants, shared capsule and
swept-flight math, deterministic trajectories, diagnostic-plan isolation,
explicit simulation states, non-overlapping benchmark geometry, Range-policy
parity, neutral/live Mega compilation, Custom Explosion body-capsule collision,
direct weak-point resolution, extended-muzzle timing, core Lab/range use,
free-fire movement during live projectile persistence, blueprint
materialization, sandbox isolation, corruption, and unknown-module quarantine.

Headless production/simulator parity now also covers Pulse and Mortar at Range
ratings `1/4/10` with both aim signs, large-frame guided Delay-Cluster delivery,
root Guidance against a moving fixture, direct Spread-Explosion against the
shared separated/off-axis fixture, Apex and Terminal Relay trigger timing and
packets, and immutable in-flight completion across weapon switch/recompile.
The latter test also proves that an explicit reasoned cancellation releases its
reservation and cannot synthesize a pending child branch or damage packet.

Mutation coverage demonstrates that hard correctness can fail independently of
the role verdict, including pre-fan-out Power duplication and projectile-budget
violations; malformed declarative contracts are rejected before evaluation.
The balance test locks the 676 diagnostic candidates, the frozen production
constants, the separate verdicts, and the known blocked role result. It does
not claim that legacy reports can select or reject Custom-Buster constants.

## Current limitations and release blockers

These are verified current facts and coverage limits.

1. **The frozen catalog fails three internal role contracts.** Hard correctness
   passes. Spread-Explosion widens separated coverage but delivers `52.8`
   versus direct Explosion's `64` Power over 10 seconds; both delayed
   Cluster-Explosion and its delayed plain comparator produce zero hits in the
   authored separated scenario; and the declared-dominance check flags the
   direct Spread-Explosion relationship over `spreadSeparated` and `single`.
   These failures block
   `verify:buster-balance`. The diagnostic 676-candidate matrix does not choose
   a fallback, so scalar `1.00`, Mortar Power `15`, and Cluster surcharge `+2`
   remain authoritative.

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

4. **The current three-weapon rotation report is not proven exact.** The
   event-driven search returns `status: "bounded"`, `exact: false`, and
   `optimality: "unproven"` rather than silently claiming a completed optimum.
   The current strict report has `329` output at 30 seconds, `547.88` at 60
   seconds, `510` best-single output, an advantage ratio of `1.07427451`, and 8
   swaps. Those swaps account for `1.62s` of brace time, `2.72s` of swap time,
   and `4.34s` of combined transition-lock time. Its release/combat clock is
   `59.82s` and its input/wall clock is `60s`. The 30s and 60s searches each
   processed `120001` transitions and exceeded the `120000` bound before
   exhausting the frontier, so the published output is a measured feasible
   lower bound, not a proven optimum. The search also canonicalizes physical
   state to six decimal places and omits consecutive no-fire swaps; its input
   policy deliberately avoids insufficient requests. It remains an unresolved
   runtime-policy limitation and a report-only value, not a hard role contract.

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
    Browser parity now covers profile-specific legacy Range, Custom capsule
    Explosion inclusion, neutral/live Mega packet values, and direct range
    weak-point amplification, moving root Guidance, separated/off-axis
    Spread-Explosion coverage, Apex/Terminal lifecycle timing, and in-flight
    survival plus explicit cancellation across a weapon switch/recompile. There
    is still no individual browser assertion for every suppressed generic proc,
    Explosion body-only weak-point behavior, blueprint UI redaction for partial
    recipes, the persistence
    import/export/adoption/New Campaign controls, or the full packet transcript
    across every program/motion combination.

## Deferred families

Terrain-wall collision, recursive triggers, additional splitters, Arc/Field/Mine
modules, elements, criticals, random module affixes, chassis grades,
proficiency, catalysts, beams, melee, drills, shields, cones, and a general
full-game save remain outside this v0.2 implementation.
