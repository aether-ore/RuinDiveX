# RuinDiveX Three.js Triple-Biome Dungeon Redesign

## Core objective

Keep the current dungeon environments and industrial identity, but change what the generator considers a “room.”

The existing Three.js generator is good at constructing recognizable spaces: credential pyramids, conveyor gantries, coolant balconies, server chambers, trap basements, machine platforms, nests, and shrine tiers. Its deterministic generation, traversal validation, keys, locks, minimap data, and procedural Reaverbots are also strong foundations.

The central problem is structural: these environments are usually combat containers arranged along a mostly fixed progression chain. The player enters, clears enemies from the available platforms, collects the required object, and continues. Platforms provide places to stand, but rarely lead to discoveries, alternate routes, environmental controls, or meaningful lower levels.

The new generator should produce interconnected explorable places rather than a sequence of decorated encounters.

---

## 1. Preserve, change, and remove

| Current feature                                                                                                                         | Direction                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Existing industrial environments, textures, machinery, doors, conveyors, catwalks, servers, coolant structures, and shrine architecture | Preserve and reorganize into reusable authored modules         |
| Deterministic seeds and stable IDs                                                                                                      | Preserve                                                       |
| `TraversalCapabilities.js` and traversal validation                                                                                     | Expand into three-dimensional and environment-state validation |
| Keycards, Key Seeker, non-bypassable gates, Shrine Key, Large Refractor, and extraction                                                 | Preserve as progression contracts                              |
| Conveyor routing and optional vault logic                                                                                               | Preserve and use as a model for other reversible mechanisms    |
| Procedural Reaverbot genomes and salvage                                                                                                | Preserve                                                       |
| Dynamic platform support already present in `Game.js`                                                                                   | Turn into a standard dungeon feature                           |
| Mostly fixed named-room chain                                                                                                           | Replace with a constrained progression graph                   |
| Geometry selected through checks such as `roomById.get(...)`                                                                            | Replace with module descriptors and compatible sockets         |
| One obligatory platforming feature in every room                                                                                        | Replace with distinct traversal identities                     |
| Platforms existing mainly as enemy footing                                                                                              | Require a gameplay purpose for every traversable platform      |
| Hazards or water added after layout generation                                                                                          | Prohibit; they must exist in the accepted plan                 |
| Invalid falls corrected as collision errors                                                                                             | Replace with authored lower destinations and recovery routes   |
| Generic corridor or primitive fallback generation                                                                                       | Remove from production generation                              |

`DungeonGenerator.js` should stop deciding progression, constructing meshes, placing collision, assigning encounters, and validating everything in one operation. The plan must be complete and accepted before any Three.js geometry is instantiated.

---

## 2. Required dungeon structure

Every generated dungeon contains exactly three connected districts:

1. **Ancient Factory**
2. **Waterworks**
3. **One Hazard Undercroft**, selected as Magma or Electrical

These cannot be three differently colored rooms. Each is a playable subgraph with:

* A recognizable landmark.
* Multiple playable elevations.
* At least one route decision.
* An optional discovery or major reward.
* A loop, shortcut, or alternate return.
* A permanent route back into the larger dungeon.
* At least one moment without mandatory combat.
* Environmental machinery explaining the biome’s function.

The complete dungeon should contain:

* Seven macro progression beats.
* Approximately 12–18 playable regions.
* Lower, entry, and upper elevation bands.
* At least two meaningful inter-floor transitions.
* One optional branch.
* One shortcut loop.
* One non-bypassable key gate.
* One traversal-dominant room.
* One calm orientation or reveal space.
* One crumbling-platform sequence.
* One cargo lift.
* One conveyor or cargo interaction.
* One large reconfigurable mechanism.
* Two required ordinary encounters.
* One optional nest encounter.
* One final elite encounter.

The seven macro beats remain:

1. Security entrance and initial reveal.
2. Assembly-floor activity.
3. Broken freight shaft.
4. Sorting gantry and pump controls.
5. Optional nest warehouse.
6. Credential tower.
7. Machine core, Refractor reward, and extraction.

These are semantic requirements, not seven fixed rooms or a mandatory exact order. The generator may branch, merge, descend, revisit, or embed multiple beats within a large composition, provided progression remains valid.

---

## 3. Triple-biome responsibilities

### Ancient Factory

The Factory is the primary structural district. It establishes scale, progression, and the industrial purpose of the ruin.

Its spaces should combine two or three functional layers:

* **Structure:** bulkheads, columns, shafts, catwalks, service tunnels.
* **Logistics:** conveyors, cranes, lifts, cargo racks, sorting gates.
* **Production:** robot arms, assembly lines, machine presses, charging bays.
* **Metabolism:** pumps, coolant, pressure tanks, power routing.
* **Occupation:** Reaverbot nests, salvage piles, dormant machines.
* **Ritual:** credential monuments, machine chapels, Refractor infrastructure.

A warehouse should not be an empty box with platforms. It might contain moving storage racks, upper maintenance bridges, a nest behind collapsed shelving, and a lower freight channel that connects to the Waterworks.

Recommended Factory families include:

* Security Checkpoint
* Ancient Server Crypt
* Assembly Line Hall
* Reaverbot Recharge Chamber
* Reaverbot Nest
* Parts Warehouse
* Pump and Coolant Works
* Reactor Support Chamber
* Vertical Maintenance Shaft
* Credential Tower
* Machine Core
* Large multi-region industrial composition

Each family should eventually have at least two topologically different variants. Moving props or changing dimensions does not constitute a second topology.

### Waterworks

The Waterworks must extend beneath or through multiple Factory regions. It should occupy at least three playable regions across at least two macro beats.

It is not a single blue floor or a slow corridor.

The initial water network uses one conserved water unit and three discrete configurations:

* `FreightSumpFilled`
* `StoredInReservoir`
* `GantrySumpFilled`

Water routing should support three different forms of exploration:

* **Flooded routes:** moon-like jumps reach upper maintenance shelves, suspended cargo, pipe platforms, or distant openings.
* **Drained routes:** exposed lower tunnels reveal salvage, machinery access, or a shortcut.
* **Redirected routes:** water enables traversal in a remote basin, opening a gantry flank or upper reward.

Use animated water planes between exact stable levels rather than continuous fluid simulation. The committed state changes atomically after the transfer animation.

Water traversal remains bottom-walking:

* Ground movement multiplier: `0.76`
* Jump height: `4.95`
* Gravity scale: `0.28`
* Normal low air steering and weak reversal
* No swimming, oxygen, drowning, or buoyancy controls

The flooded profile is captured at takeoff and remains active until landing. Jumping out of the water is therefore predictable and useful. Entering water during an existing jump does not grant another takeoff.

Every Waterworks network needs:

* A solid bottom.
* Waterline markings and wet surfaces.
* Pumps, pipes, reservoirs, and visible flow direction.
* A master routing console on permanent dry ground.
* Consoles reachable in every stable configuration.
* At least one flooded-only discovery.
* At least one drained-only discovery.
* A route back into the Factory.
* No state that traps the player or removes extraction.

### Hazard Undercroft

Each seed selects either a Magma or Electrical Undercroft. It should span at least two playable regions or one large multi-stage composition beneath the Factory.

The Undercroft is a hidden sub-dungeon, not a punishment corridor after a missed jump. Falling into it should create the reaction: “I didn’t know there was an entire area down here.”

It needs:

* Safe footholds and damage-free traversal.
* Enemies positioned around the hazard rather than inside the only escape.
* Treasure or a substantial discovery.
* An optional route made easier by resistance gear.
* A recognizable landmark.
* A permanent climb, lift, stair, or shaft back.
* At least one connection beyond the point where the player entered.

Magma rules:

* `magma_floor_v1`
* 12 fire damage per second.
* Damage in deterministic 0.25-second pulses.
* 0.5-second entry grace.
* Safe islands and a damage-free route through every required section.

Electrical rules:

* `electric_floor_cycle_v1`
* 3.5-second cycle:

  * 1.25 seconds safe.
  * 0.75 seconds charging.
  * 1.5 seconds energized.
* 9 shock damage per second while energized.
* Room entry begins in the safe phase.
* Charging must be communicated through geometry, light, arcs, animation, and sound.

Ordinary enemies should avoid magma and energized panels. Flyers may cross them but must still respect walls, ceilings, and doors.

---

## 4. Replace room generation with module composition

Create pure module descriptors independent of instantiated Three.js objects:

```js
{
  id,
  archetype,
  variant,
  sizeClass,
  compatibleDistricts,

  bounds,
  occupiedVolumes,
  regions,

  sockets: [],
  surfaces: [],
  traversalNodes: [],
  traversalEdges: [],

  fallApertures: [],
  fallCatchments: [],
  waterBasins: [],
  environmentControllers: [],

  mechanisms: [],
  encounterAnchors: [],
  rewardAnchors: [],
  platformPurposes: [],

  presentationProfile,
  materialProfile,
  revision
}
```

A module may contain several playable regions. This is especially important for Waterworks, shafts, credential towers, and large machinery chambers.

Modules connect through exact sockets describing:

* Aperture dimensions.
* Position and facing.
* Floor elevation.
* Connector category.
* Player and camera clearance.
* Compatible socket types.
* Themed cap geometry for unused sockets.

Allowed placement transforms are translation and 0/90/180/270-degree yaw. Runtime scaling should be prohibited.

Independent rooms must never be stacked at the same horizontal coordinates simply because their elevation values differ. Vertical overlap is allowed only inside an authored and validated multi-level composition.

---

## 5. New generation pipeline

Use this order:

```text
seed
  → required macro beats
  → progression graph
  → district subgraphs
  → authored module selection
  → socket-based 3D embedding
  → environment and mechanism states
  → reward and encounter placement
  → progression/environment/fall validation
  → Three.js scene assembly
```

### Pass 1: Progression graph

Generate:

* Critical route.
* Optional branches.
* Loops and shortcuts.
* Key and gate relationships.
* Boss and shrine ordering.
* Environmental discoveries.
* District entry and re-entry points.

This graph contains no meshes or coordinates.

### Pass 2: District embedding

Assign Factory, Waterworks, and Undercroft regions.

Require the layout to span both horizontal axes and all three elevation bands. Reject layouts that are effectively one corridor, a vertical stack, or a chain of transition shafts.

### Pass 3: Module and socket solve

Select compatible authored modules and connect their sockets using bounded backtracking.

If two sockets cannot connect directly, insert authored connector modules such as:

* Bulkhead gallery.
* Stair tower.
* Cargo lift shaft.
* Bridge hall.
* Enclosed maintenance tunnel.
* Pump conduit.
* Damaged descent shaft.

Never generate a naked slab as an emergency bridge.

No more than two transition modules may appear consecutively, and connectors should occupy no more than roughly 20% of the traversable area.

### Pass 4: Mechanics, rewards, and encounters

Only place content at compatible authored anchors. The assembler must not invent hazard floors, water basins, consoles, or platforms after the plan has passed validation.

---

## 6. Platform and vertical-traversal rules

Every traversable platform must declare one of these purposes:

* `CriticalTraverse`
* `ReturnRoute`
* `OptionalReward`
* `CombatFlank`
* `MechanismStaging`
* `RecoveryCatchment`
* `Shortcut`

A decorative platform must not be walkable. A walkable platform must lead somewhere or materially change an encounter.

All elevated structures require visible support: brackets, trusses, columns, suspension rods, machinery, wall mounting, or structural framing.

There are no intentional bottomless pits or unmarked drops. Every reachable downward trajectory must terminate on:

* A playable lower floor.
* A water basin with a solid bottom.
* A bounded hazard chamber with safe footholds.
* A sufficiently large authored landing pad.

Every lower destination needs a damage-free route out. An invisible recovery plane may exist beneath the structural bottom only as a physics-bug safeguard. Reaching it should log a validation failure and return the player to the last safe anchor without resource loss.

Intentional drops must show or signal their destination using broken rails, shaft lighting, machinery, water reflections, edge markings, or a short camera reveal.

---

## 7. Make machinery part of traversal

The ordinary dungeon should use the dynamic-platform infrastructure already present in the project.

Begin with four standard mechanism families:

* Crumbling platforms.
* Cargo lifts.
* Moving conveyor cargo.
* Corkscrew gear platforms.

The corkscrew gear platform should be a major Factory landmark:

* A massive circular gear travels vertically as it rotates.
* It has discrete stops aligned with ledges at different heights.
* A central pedestal selects the next rotation.
* Folded bridges face the four cardinal directions.
* A bridge deploys only when its direction and elevation match a valid exit.
* The player cannot activate an unsafe intermediate state.
* Every possible fall lands in an authored lower region.
* Stable states are included in the progression solver.

Mechanisms should use deterministic state machines, not uncontrolled physics outcomes. Seed selection determines their layout and configuration; frame timing must not determine whether a route is solvable.

---

## 8. Exploration and encounter rhythm

Stop defaulting to “doors close, enemies spawn.”

Use this rhythm instead:

```text
orient → traverse → discover → fight under spatial pressure
→ choose a route → manipulate the environment → recover → reveal
```

A useful initial distribution is:

* 25% traversal-dominant.
* 25% combat-dominant.
* 15% mechanism/combat.
* 15% exploration, reward, or lore.
* 10% calm transition or vista.
* 10% boss or objective.

Encounters should have spatial purposes:

* Artillery guards an optional upper route.
* A shielded enemy controls a ramp but can be flanked through machinery.
* A nest occupies a drained tunnel.
* Flyers exploit a vertical shaft.
* A Reaverbot controller keeps a mechanism active until disabled.
* Enemies protect treasure without blocking the only exit or console.

Long optional routes must provide a worthwhile payoff: a major component, rare salvage, a map discovery, resistance chip, shortcut, lore object, or substantial combat advantage.

---

## 9. Prevent sequence breaking

Expand the existing reachability solver to enumerate:

```text
player region
+ owned keys
+ opened gates
+ valve alignment
+ water configuration
+ mechanism states
+ completed objectives
```

Reject a plan if any stable state:

* Strands the player.
* Hides the only reset or routing console.
* Bypasses a non-bypassable key gate.
* Removes all routes to the objective or extraction.
* Requires unavoidable damage.
* Requires an impossible flooded jump.
* Changes the total water volume.
* Places required content inside a harmful surface.
* Leaves a failed crumble route without a lower recovery path.

Shortcuts should rejoin the current or an already completed progression band. They must not land beyond a gate whose key has not been obtained.

---

## 10. Suggested source responsibilities

Refactor toward these focused systems:

* `DungeonPlannerV2.js` — deterministic progression and district plan.
* `DungeonModuleCatalog.js` — immutable authored-module descriptors.
* `DungeonSocketSolver.js` — placement, rotation, overlap, and connector solving.
* `DungeonEnvironmentSolver.js` — water, hazards, mechanisms, and state reachability.
* `DungeonTraversalValidator.js` — dry/flooded movement, falls, headroom, and platform routes.
* `DungeonSceneAssemblerV2.js` — constructs registered `THREE.Group` and GLTF content from an accepted plan.
* `DungeonEnvironmentRuntime.js` — water transfers, hazard cycles, lifts, gears, and crumble states.
* `DungeonEncounterDirector.js` — region-based encounter activation.
* `DungeonProgression.js` — keys, gates, boss reward, shrine, and extraction.
* `DungeonController.js` — consumes the plan and coordinates systems; it should no longer generate geometry.

The minimap should continue to derive from the accepted plan rather than scanning instantiated meshes.

---

## 11. Implementation sequence

1. Freeze the current generator as a development reference.
2. Extract its strongest authored spaces into reusable modules:

   * Credential pyramid.
   * Three-tier conveyor gantry.
   * Coolant control balcony.
   * Server chamber.
   * Nest warehouse.
   * Shrine tiers.
3. Build a three-floor traversal test environment containing water, both hazard types, a lift, conveyor cargo, crumble pieces, and the corkscrew gear.
4. Implement pure module descriptors and socket placement.
5. Create one “golden complex” containing all three districts and validate it before procedural composition.
6. Produce two topology variants for the initial module families.
7. Add the combined progression/environment solver.
8. Connect region encounters, minimap, rewards, and extraction.
9. Sweep at least 300 seeds.
10. Replace the production generator only when the new system has no corridor, stacking, primitive-fallback, or exterior-void failures.

---

## Definition of done

The redesign is successful when two seeds tell genuinely different spatial stories.

One seed might collapse the player from an assembly catwalk into a flooded freight network, let them drain it to discover a salvage tunnel, and return them through a cargo lift.

Another might cross upper sorting gantries, rotate a corkscrew gear toward a credential ledge, then deliberately descend into an electrical Undercroft to find a shortcut and rare component.

Both should retain the current project’s strong environmental identity, deterministic progression, Reaverbots, keys, and Refractor objective. The difference is that platforms, water, hazards, machinery, and lower floors now form a place worth exploring—not a checklist between enemy encounters.

Exits should never be uniform in their location. There should be multiple possible exit locations, whether through ramps that lead to them, ladders, walking up pipes or entering maintenance tunnels. Dungeon Gen v1 rooms can be used, but they should be updated to the dungeon gen v2 requirements accordingly.
