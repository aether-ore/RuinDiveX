# RuinDiveX Unity Dungeon V2 — Exploration and Environmental District Addendum

**Status:** Proposed consolidation of the Solid-Floor Traversal Revision  
**Applies to:** `industrial-factory-v2`  
**Preserves:** deterministic plan → validate → assemble, key-before-lock validation, plan-derived minimap, encounter slots/seeds, Large Refractor expedition resolution, and procedural Reaverbot identity  
**Does not revive:** the fixed V1 room chain, Three.js-specific runtime architecture, random kill pits, or cosmetic-only procedural variation

## Design verdict

The Solid-Floor Traversal Revision establishes the correct physical rule: falling changes the route instead of ending play. This addendum establishes the corresponding exploration rule:

> A lower floor is not a recovery corridor. It is a discoverable district with its own landmarks, routes, encounters, rewards, state changes, and return connections.

Water, magma, and electric regions are therefore not modifiers sprinkled beneath ordinary rooms. They are **environmental districts** embedded through multiple macro rooms. A generated industrial ruin contains:

1. a primary **Factory District**;
2. a connected **Waterworks District** spanning multiple lower spaces;
3. one seeded **Hazard Undercroft District**, either Magma Processing or Electrical Distribution in the first profile.

These are three biomes in gameplay terms while sharing one Ancient Industrial Reaverbot Factory/warehouse/nest art family. “Multiple biome themes” must be removed from the V2 deferral list. What remains deferred is additional macro art families such as organic caverns, forests, or wholly different ruin civilizations.

## Revised experience budget

The previous 12–18 minute target should describe a competent **critical-path run**, not a full clear.

| Run style | Target | Expected behavior |
| --- | ---: | --- |
| Direct critical path | 12–18 minutes | Two required encounters, key/gate, one required environmental operation, final elite, Refractor, extraction. |
| Curious first clear | 18–25 minutes | Enters one cross-room lower district, opens a shortcut, finds one major optional reward. |
| Thorough clear | 25–35 minutes | Explores both Waterworks states and the Hazard Undercroft, clears optional nest, collects most discoveries. |

Generation must not force the completionist duration onto the critical path. Conversely, optional districts must contain enough content that entering them feels like discovering part of the ruin, not accepting a time penalty.

## Macro nodes versus playable regions

Keep the seven-node macro structure, but stop treating one macro node as one room-shaped play space. A macro node is a pacing and progression role. It may contain several vertically stacked **playable regions**.

The seven-node industrial slice can contain 12–18 regions:

- upper Factory walkways;
- entry-floor production spaces;
- submerged or drained Waterworks chambers;
- hazard-floor safe islands;
- service tunnels;
- lift landings;
- optional storage pockets;
- state-dependent connectors.

This resolves the tension between a compact seven-node expedition and water/hazard areas spanning several rooms. The progression graph stays readable while the spatial graph becomes layered.

## First-class exploration contracts

The proposed V2 surface, catchment, fluid, controller, and traversal records are necessary but insufficient. Add the following immutable, Unity-independent records.

### `DungeonRegionPlanV2`

Represents one contiguous playable spatial region, independent of scene hierarchy.

- stable region ID;
- owning macro-node ID;
- elevation band and bounds;
- biome district ID;
- entry/exit traversal anchors;
- encounter, reward, console, and landmark anchor IDs;
- supported environment-state predicates;
- local navigation region ID.

Rooms remain useful prefab units, but reachability and exploration operate on regions.

### `DungeonBiomeDistrictPlanV2`

- stable district ID;
- kind: `Factory`, `Waterworks`, `MagmaUndercroft`, or `ElectricalUndercroft`;
- ordered region IDs;
- entrance transitions and reveal anchors;
- traversal identity and encounter compatibility tags;
- landmark, reward, audio, lighting, and minimap presentation profiles;
- minimum discoveries, route loops, and return connections;
- governing environment controller IDs.

A fluid network may list multiple region IDs. It must not be owned by a single room merely because one prefab contains its console.

### `DungeonExplorationRoutePlanV2`

- route ID and ordered traversal edges;
- role: `Critical`, `OptionalBranch`, `StateReveal`, `Shortcut`, `Recovery`, or `Return`;
- required inventory/environment/capability predicates;
- authorized rejoin region;
- estimated traversal time and risk budget;
- reward or discovery IDs;
- reverse-traversal policy;
- reveal policy for minimap and Key Seeker.

This distinguishes “physically reachable” from “legally allowed to rejoin progression here.”

### `DungeonDiscoveryPlanV2`

- stable discovery ID;
- kind: `Salvage`, `RefractorCache`, `ZennyCache`, `FixedChipBlueprint`, `Lore`, `Shortcut`, `Landmark`, or `MechanismKnowledge`;
- location anchor and district ID;
- access predicate;
- reveal predicate;
- durable reward ID, when applicable;
- completion significance and duplicate policy.

The first slice should use fixed rewards and known reward families, not random non-weapon affixes.

### `DungeonShortcutPlanV2`

- locked and unlocked traversal edges;
- activation side/anchor;
- earliest authorized progression state;
- rejoin region;
- environment-state predicates;
- persistence policy for the current expedition;
- minimap reveal behavior.

Shortcuts are explicit plan objects, not incidental gaps that happen to bypass a gate.

### `DungeonFallExposurePlanV2`

Complements each catchment with the trajectory envelope that must be covered.

- source edge/volume;
- exposure causes: walk, jump, dodge, knockback, crumble, moving-surface failure;
- dry/flooded movement profile version;
- maximum horizontal displacement and fall cone;
- rail/collision constraints;
- required catchment IDs;
- structural-bottom clearance.

This allows validation to prove conservative volume coverage instead of merely sampling a few fall rays.

## Environmental district requirements

Every district must change at least three of the following:

- route topology;
- traversal rhythm;
- vertical relationship;
- environmental state;
- encounter composition;
- risk/reward decision;
- visibility and landmarking;
- soundscape;
- reward type.

A palette swap alone is not a biome.

### Factory District

The factory is the readable baseline: conveyors, cargo lifts, assembly structures, grounded and gantry combat, bulkhead progression, and Reaverbot production storytelling. It teaches the spatial language used by the other districts.

Required exploration content:

- one elevated observation route that previews a later lower district;
- one cargo interaction that changes traversal rather than serving as decoration;
- one traversal-only calm region;
- one optional warehouse/nest branch;
- one shortcut that makes return travel visibly faster.

### Waterworks District

The Waterworks is a cross-room subgraph, not one flooded chamber. It should pass beneath or beside at least three macro nodes:

- Freight Sump beneath the broken freight shaft;
- Reservoir/service tunnel beneath the sorting works;
- Gantry Sump beneath the warehouse or credential route.

Its three stable configurations create different exploration opportunities:

| Configuration | Mandatory function | Optional discoveries |
| --- | --- | --- |
| `FreightSumpFilled` | Teaches flooded bottom-walking and high jump. | High ledge cache, submerged machinery landmark, alternate exit sightline. |
| `StoredInReservoir` | Opens the dry Freight service tunnel. | Salvage pocket, lore/maintenance record, dry cross-room route. |
| `GantrySumpFilled` | Enables remote high-jump route. | Upper warehouse flank, Refractor cache, shortcut activation. |

Routing should not become repetitive switch labor. The colored-valve alignment is solved once; afterward the master console performs quick, reversible routing. The critical path should require at most one deliberate transfer after the tutorial state. Thorough exploration may reward using all three states.

Water district rules:

- at least two entrances from different macro nodes;
- at least one route that changes purpose between flooded and drained states;
- at least one reward available only while flooded and one available only while drained;
- at least one loop returning to a different region than the entry;
- no required reward is permanently missable due to water state;
- consoles remain dry, stationary, and reachable in all stable configurations;
- submerged spaces use strong landmarks, since texture repetition and reduced audio can impair orientation;
- ordinary enemies may occupy grounded water regions only when they do not require the flooded high jump; turrets, ledge enemies, and flyers are preferable for the first slice.

### Hazard Undercroft District

The hazard undercroft is simultaneously:

- a fall catchment;
- an optional exploration route;
- a traversal challenge;
- a reward district;
- a return/shortcut opportunity.

It must never read as “the place you walk through until you escape the punishment.”

Required layout:

- one nominal safe landing pad;
- a network of safe islands or de-energized panels;
- one damage-free route from every valid landing region;
- one optional combat pocket that cannot block the only exit;
- one valuable reward visible before or shortly after entering;
- one quiet safe shelf for reorientation;
- one permanent route back to the main graph;
- one alternate rejoin or shortcut activated from inside;
- at least one route choice: safe/long versus precise/short, or surface route versus protected lower route.

The fixed Heat Resist Chip is a useful exploration modifier, not a progression key. Without it, correct platforming still gives a damage-free route. With it, magma damage can be reduced or negated so the player may search the basin more freely. The same principle can later apply to electrical resistance. Do not generate rewards that require the resistance chip to avoid unavoidable damage unless that content is explicitly marked as optional and telegraphed before commitment.

## Discovery and reward density

Use a simple exploration budget so optional routes do not become empty procedural acreage.

For the first slice, every accepted seed should contain at least:

- one major optional reward in Waterworks;
- one major optional reward in the Hazard Undercroft;
- one fixed-chip blueprint or curated salvage reward across those districts;
- two small caches or lore discoveries;
- one shortcut discovery;
- one environmental storytelling landmark in each district;
- one visible-but-not-immediately-reachable reward tease.

No optional branch longer than approximately 45 seconds should terminate without at least one of:

- durable reward;
- meaningful shortcut;
- strong landmark/lore discovery;
- new route knowledge visible on the minimap.

Avoid scattering interchangeable pickups every few meters. A smaller number of placed, legible discoveries supports the Mega Man Legends-inspired expedition tone better than loot confetti.

## Sequence-break prevention without flattening exploration

Alternate routes should alter approach, information, encounter order, or return travel without silently invalidating key/gate progression.

### Route authorization rules

1. Every optional route declares its earliest authorized rejoin region.
2. Before a key is acquired, an optional route may rejoin only on the pre-gate side unless it terminates at an explicitly one-way locked boundary.
3. A shortcut crossing a gate is activated only from the authorized far side.
4. Water-assisted jumps must be tested against gate walls, ceiling bypasses, door frames, and adjacent ledges—not only graph edges.
5. A lower tunnel may pass geometrically beneath a locked room, but collision and exit predicates must prevent an early ascent into it.
6. Optional rewards cannot contain the only key required to leave their own branch unless a permanent non-state-dependent exit also exists.
7. The Key Seeker may point toward the source region of a required item, but it must not reveal every optional discovery.

### Validator requirements

For every stable environment state and relevant inventory state, compute:

- physically reachable regions;
- authorized progression regions;
- obtainable required items;
- active shortcuts;
- return paths to a safe anchor or extraction;
- discoveries reachable without unavoidable damage;
- accidental post-gate access.

Reject a plan when physical reachability exceeds authorized reachability across a protected progression boundary. This catches a sequence break while still permitting benign movement freedom within the current progression band.

## Minimap and exploration readability

The current plan-derived minimap should become layered rather than omniscient.

Required behavior:

- separate lower, entry, and upper strata;
- show visited regions and discovered connectors, not the full generated graph immediately;
- display water basins and their current stable configuration;
- display known consoles, valves, lifts, locked gates, and activated shortcuts;
- distinguish a seen-but-unvisited region from a fully explored one;
- reveal a cross-room tunnel as one continuous feature after entering it;
- retain stable landmark icons during environment changes;
- show the authorized route to a required key via Key Seeker without exposing optional treasure;
- prevent stacked rooms from collapsing into an unreadable 2D overlap.

The map should help the player form a mental model of “this sump continues beneath the gantry,” which is central to the desired discovery feeling.

## Flooded-jump correction

The proposed flooded numbers cannot all be true simultaneously.

The dry contract implies approximately:

- jump height: `1.65`;
- apex time: `0.33s`;
- rise gravity magnitude: `30.303`;
- takeoff speed: `10.0`.

With rise gravity at `0.28 × 30.303 = 8.485` and a desired height of `4.95`, the required takeoff speed is approximately `9.165`, and apex time is approximately `1.08s`—not `0.624s`.

If `4.95` height and `0.624s` apex are preserved instead, rise gravity must be about `25.43` (`0.839×` dry gravity) and takeoff speed about `15.87`, which is a brisk super-jump rather than moon gravity.

For the stated moon-like identity, use the first model:

- `RiseGravity = 8.485`;
- `TakeoffSpeed = 9.165`;
- calculated apex ≈ `4.95` at `1.08s`;
- retain the `1.22` descent multiplier;
- tune horizontal takeoff and air-control caps separately after the traversal gym test.

`TraversalProfileV2` should store authoritative takeoff velocity, rise gravity, fall multiplier, grounded speed multiplier, air-control limits, and collision dimensions. Height and apex time should be calculated values used by tooling and tests, not additional independent tuning inputs.

The captured-at-takeoff rule remains excellent: a flooded jump keeps its flooded ballistic profile until landing, even after leaving the water volume.

## Damage and timing clarifications

### Magma

- `magma_floor_v1` remains 12 fire damage per second;
- fixed simulation pulse: `0.25s`;
- packet amount: `3 fire damage`;
- entry grace: `0.5s` per continuous occupancy, not repeatedly reset by collider seams;
- leaving and re-entering after a defined separation threshold starts a new occupancy, but adjacent hazard tiles share one occupancy group.

### Electricity

- `electric_floor_cycle_v1` remains 9 shock damage per energized second;
- use the same `0.25s` simulation pulse, producing `2.25 shock damage` per pulse;
- the 3.5-second cycle remains `1.25 safe + 0.75 charging + 1.5 energized`;
- the controller begins safe on first room activation or reload;
- stepping out and back into the room does not restart the safe phase;
- charge presentation must begin before collision/damage becomes energized;
- grounding a section is an idempotent stable transition, not a visual-only override.

Damage packets need stable execution IDs containing controller ID, occupancy ID, cycle revision, and pulse index so large frame steps cannot double-apply them.

## Fall-coverage validation

“Sweep 1,000 seeds and sample every edge” is a strong regression gate but not a proof by itself. Use two layers:

1. **Static conservative coverage:** construct swept fall cones/prisms from each `DungeonFallExposurePlanV2`, expanded by the player radius and relevant dodge/knockback envelope. Prove that their downward projection is contained by catchment collision, rail constraints, or another registered exposure/catchment chain before structural bottom.
2. **Trajectory corpus:** simulate representative and boundary trajectories for walk-off, jump, maximum dodge, crumble failure, moving-platform failure, and authored combat knockback at several frame rates.

The technical fallback plane remains below every structural bottom and outside all accepted fall cones. Reaching it is a hard diagnostic failure during tests and telemetry, not a successful recovery-path assertion.

## Environment solver scope

Do not enumerate time as if every electric-cycle moment were a separate persistent dungeon state. The finite solver should enumerate:

- player region;
- required inventory/gate state;
- valve-unlock state;
- committed water configuration;
- permanent console/controller states;
- activated shortcuts;
- collected durable rewards where collection changes route logic.

Cycling hazards are temporal traversal edges with known safe windows and damage-free feasibility, not additional combinatorial world configurations. Visual 2.5-second water transfers are also not stable states. During transfer, progression interaction is locked, safe anchors remain valid, and the target configuration commits atomically.

## Return visits and resistance gear

The thought “I should come back with a Heat Resist Chip” requires a returnable ruin identity, but not persistent mutable scene state.

Store only:

- dungeon profile ID and ruleset version;
- deterministic expedition/ruin seed or contract ID when a return visit is intentionally supported;
- durable discoveries/rewards already collected;
- optional map knowledge policy.

On re-entry, rebuild the same structural layout from seed and reset water/platform/controller state to its deterministic initial configuration. Do not save GameObjects, water heights, moving-platform positions, crumble states, or active hazard phases.

For the first slice, return visits may remain a profile capability rather than a mandatory campaign loop. The fixed resistance-chip interaction should nevertheless be designed so it works if re-entry is enabled later.

## Revised seven-node slice

1. **Security Entrance — Factory**  
   Calm reveal, first landmark, view down into inaccessible Waterworks, readable bulkhead goal.

2. **Assembly Floor — Factory**  
   Grounded combat, conveyor/cargo interaction, exposed-edge catchment into Freight Sump.

3. **Broken Freight Shaft — Factory/Waterworks Threshold**  
   Flooded-jump tutorial, first reversible route, permanent climb out, dry tunnel revealed later.

4. **Sorting Gantry — Factory over Waterworks**  
   Pump-routing controls, moving platform, vertical combat separation, remote sump preview.

5. **Nest Warehouse — Optional Factory/Waterworks Branch**  
   Optional Reaverbot encounter, high-value salvage, flooded upper flank or drained lower access, shortcut activation.

6. **Credential Tower — Factory/Hazard Threshold**  
   Stepped ascent and crumble sequence; failures descend into the seeded Hazard Undercroft rather than a reset corridor.

7. **Machine Core — Factory**  
   Elite objective, Refractor reward, extraction; undercroft shortcut returns the player near the final approach without bypassing the credential gate.

This structure gives each environmental district multiple relationships to the main route instead of isolating it as a themed room.

## Revised acceptance gates

Every accepted `industrial-factory-v2` seed must satisfy all existing Solid-Floor rules plus:

- exactly one Factory District, one Waterworks District, and one compatible Hazard Undercroft District;
- Waterworks spans at least three playable regions and at least two macro nodes;
- Hazard Undercroft spans at least two playable regions or one multi-stage region with two distinct rejoin paths;
- each environmental district contains a landmark, major reward, loop/alternate return, and safe reorientation area;
- at least one flooded-only discovery and one drained-only discovery remain recoverable through reversible routing;
- at least one hazard-basin reward is reachable damage-free without resistance gear;
- resistance gear changes exploration freedom but is never a required progression key;
- no optional route grants unauthorized post-gate access;
- critical-path completion remains 12–18 minutes in representative playtests;
- full exploration is allowed to exceed that budget;
- minimap strata and state changes remain legible;
- no encounter blocks the only console, safe pad, basin exit, or return route;
- no exposed fall cone reaches the technical fallback plane;
- every long optional branch pays off with reward, shortcut, landmark, or route knowledge.

## Updated implementation order

1. Correct and centralize dry/flooded ballistic profiles.
2. Build the three-floor traversal gym, including a small cross-room water tunnel and a two-stage hazard undercroft—not isolated test squares only.
3. Implement region, biome district, exploration route, discovery, shortcut, and fall exposure records.
4. Implement static fall-volume coverage and finite environment/progression solving.
5. Author the seven macro templates as 12–18 playable regions with the Factory/Waterworks/Hazard relationships above.
6. Implement layered minimap discovery and state presentation.
7. Add curated reward placement and sequence-break validation.
8. Add room-by-room encounter activation and biome-compatible spawn constraints.
9. Run seed sweeps, trajectory corpus, state enumeration, build/teardown testing, and completion-time playtests.
10. Switch only new `industrial-factory-v2` expeditions after all hard-correctness gates pass; retain `DungeonPlanV1` for legacy `industrial-ruins`.

## Explicit deferrals, revised

Still deferred:

- free swimming and three-axis underwater movement;
- oxygen, drowning, buoyancy, and underwater weapon penalties;
- conductive/electrified water;
- real-time fluid simulation;
- aquatic/amphibious enemy navigation;
- ordinary ground-enemy lift dependency;
- arbitrary procedural room meshes;
- large streamed dungeons;
- persistent mutable water/platform/hazard scene state;
- macro biome/art families beyond Ancient Industrial Factory + Waterworks + one Hazard Undercroft;
- additional Buster, workshop, boss-hunt, multiplayer, AI-inference, and broad equipment-randomization work until this slice is proven.

No longer deferred:

- multiple environmental biomes within one industrial generation;
- cross-room water exploration;
- hazard-floor exploration, rewards, enemies, safe sections, and alternate routes;
- layered discovery/minimap behavior;
- resistance gear as an optional exploration modifier;
- deterministic returnable ruin identity at the data-contract level.

## Bottom line

The solid-floor policy becomes memorable only when the catchment is somewhere the player is glad to have discovered. Factory floors provide the readable main route; Waterworks reveals a connected hidden infrastructure; the Hazard Undercroft turns failure into danger, orientation, treasure, and eventual mastery.

The generator should not ask, “What punishment lies below this gap?” It should ask, “Which authored district continues below this room, what can the player learn or find there, and where may it legally reconnect?”
