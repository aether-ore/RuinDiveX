# RuinDiveX: Three.js Project Breakdown and Unity Dungeon Roadmap

**Audit date:** 2026-07-17  
**Three.js source reviewed:** [`aether-ore/RuinDiveX`](https://github.com/aether-ore/RuinDiveX), default branch [`new-dungeon-generation-snapshot-20260709`](https://github.com/aether-ore/RuinDiveX/tree/new-dungeon-generation-snapshot-20260709)  
**Unity scope:** recommendations are based on the stated barebones Unity remake—playable character plus basic procedural dungeon. The Unity source itself was not supplied for this audit.

## Executive verdict

RuinDiveX should not be ported class-for-class. Its Three.js version contains strong game-design contracts worth preserving, but its ordinary dungeon generator is less procedural than its presentation suggests.

The current generator randomizes room positions, lateral offsets, flavors, encounter genomes, and some puzzle variants, but the ordinary ruin remains a mostly fixed progression chain built from named rooms: camp → entrance → enemy nest → keycard chamber → trap/coolant band → conveyor/factory band → boss → Large Refractor shrine. Within those rooms, much of the vertical geometry is explicitly authored in one 12,882-line `DungeonGenerator.js`: the enemy-room rear deck, server catwalk, keycard pyramid, trap basement, coolant balcony, conveyor gantries, machine catwalks, and shrine tiers.

That is not useless work. It proves several important things:

- RuinDiveX benefits from floors above and below the entry plane.
- The player can support fixed-height jumping, committed air control, ledge climbing, safe drops, ramps, railings, and elevated combat.
- Keycard progression, the Key Seeker, boss-earned Shrine Key, and Large Refractor provide a coherent expedition spine.
- Deterministic generation and traversal validation are already treated as gameplay features.
- Procedural Reaverbots are substantially more mature and genuinely systemic than the ordinary room topology.

The Unity remake should therefore preserve the **contracts and data**, replace the **generator architecture**, and selectively recreate the **best encounters** as room modules. It should not reproduce the giant JavaScript orchestration classes, manual collision workarounds, DOM/debug plumbing, or the fixed room chain disguised as a general procedural grammar.

## 1. What the Three.js project currently is

### Player-facing identity

The current build is a third-person, Mega Man Legends-inspired action dungeon crawler with:

- manual aiming and attacks;
- a four-slot arm hotbar;
- Buster, melee, explosive, beam, utility, guard, barrier, dodge, and lock-on systems;
- a safe expedition camp, Roll's workshop, salvage identification, and a garage/loadout loop;
- randomized ruins with locked progression bands, side rooms, traps, conveyors, mechanisms, a boss, and a Large Refractor objective;
- seeded procedural Reaverbots assembled from compatible body, locomotion, weapon, defense, weak-point, and behavior modules;
- a fixed-effect gear direction that has already replaced most non-weapon random-affix design.

The project's own [README](https://github.com/aether-ore/RuinDiveX/blob/new-dungeon-generation-snapshot-20260709/README.md) is accurate about the breadth of systems, but the implementation reveals an important distinction: **the dungeon contains vertical procedural data, yet the ordinary macro structure and much of the vertical layout are still authored around stable room IDs.**

### Current architecture at a glance

| Area | Current implementation | Assessment |
| --- | --- | --- |
| Main game host | `Game.js`, about 9,176 lines | Broad coordinator with rendering, camera, debug, combat, hazards, pooling, dungeon transitions, and many adapters. Valuable behavior, unsuitable as a Unity class template. |
| Dungeon construction | `DungeonGenerator.js`, about 12,882 lines | Generates data and directly creates Three.js meshes, materials, collision zones, camp props, NPCs, rooms, doors, puzzles, and validation. It is the main architectural debt. |
| Dungeon runtime | `DungeonController.js`, about 4,636 lines | Runs doors, interactions, traps, conveyors, progression, player floor correction, navigation queries, and enemy traversal. Strong edge-case knowledge, but too many responsibilities. |
| Progression | `DungeonProgression.js` | Clear Alpha/Beta/Gamma/Shrine Key chain, Key Seeker, minimap data, reachability solver, and lock-bypass validation. Strong candidate for conceptual migration. |
| Traversal contract | `TraversalCapabilities.js` | A concise shared movement envelope used by player and generator. One of the best abstractions to preserve. |
| Room catalog | `IndustrialRoomArchetypes.js` | 15 archetypes and 15 flavor modifiers with purposes, stories, exits, rewards, hazards, enemy tags, and verticality options. Excellent design library, but not every declared behavior exists at runtime. |
| Enemies | `src/reaverbots/` | Seeded genome, validation, visual factory, combat behaviors, defenses, weak points, salvage, bosses, and extensive tests. This is the strongest procedural subsystem. |
| Equipment | `src/equipment/` plus legacy compatibility | Current direction favors fixed Armor, Helmet, Mobility, Defense, and Utility effects. Do not resurrect randomized non-weapon affixes in Unity. |
| Custom Buster | `src/buster/` | Pure catalogs, graph validation/compiler, deterministic projectile kernel, runtime adapter, persistence, and balance tests. Architecturally much cleaner than the dungeon code. |
| Verification | Node tests plus Playwright | Strong deterministic and traversal regression coverage, often tied to named rooms and browser runtime details. Preserve the assertions, not the harness or exact geometry. |

## 2. What the dungeon generator really does

### Macro topology: stable chain, randomized placement

The ordinary generator creates the same primary room roles every run:

1. `hubTown`
2. `expeditionCamp`
3. `entrance`
4. `enemyNest`
5. `keycardRoom`
6. `trapRoom`
7. `conveyorRoom`
8. `bossRoom`
9. `shrineRoom`

It also attaches stable side rooms:

- `alienServerRoom` off the enemy nest;
- `coolantRelayRoom` off the trap band;
- `machineFactoryRoom` and `bonusVault` off the conveyor band.

Room X/Z positions, offsets, some dimensions, flavor selection, and puzzle templates vary. The room graph itself does not substantially vary. The [progression file](https://github.com/aether-ore/RuinDiveX/blob/new-dungeon-generation-snapshot-20260709/src/DungeonProgression.js) explicitly assigns fixed bands and connections.

This produces reliable expeditions, but it also explains why the dungeons can feel like glorified fight chambers connected in a familiar order. Spatial randomness is not the same as structural, navigational, or dramatic variation.

### Verticality: real, but room-ID driven

The standard ruin has meaningful elevations:

- basement: `-3.2`;
- minor drop chamber: `-4.8` with a `-1.5` return shelf;
- purpose jump platform: `1.35`;
- second floor: `4.05`;
- third floor: `7.25`.

Examples already implemented include:

- an enemy-room second-floor structural mass and ramp;
- a server-room upper catwalk and outer ramp;
- a large stepped keycard pyramid with optional jumping routes;
- a trap-room drop space with a ledge-climb return sequence;
- a coolant service pit and upper control balcony;
- a conveyor room spanning the ground, second floor, and third-floor gantry;
- a machine room with perimeter and cross catwalks;
- a shrine mezzanine and third-floor Refractor dais;
- two elevated room-to-room bridges.

These are good prototypes. The limitation is that they are mostly selected by checks such as `roomById.get('conveyorRoom')`, not composed from the randomly selected archetype's verticality option. The archetype metadata records intent, but the geometry remains largely fixed.

### Platforming: validated but conservative

The [shared traversal envelope](https://github.com/aether-ore/RuinDiveX/blob/new-dungeon-generation-snapshot-20260709/src/TraversalCapabilities.js) defines a collision radius, standing/head clearance, fixed jump height, time to apex, forward speed, normal jump reach, ledge-climb reach, safe drop, ramp rise, and minimum landing/catwalk widths.

The generator then builds a floor-tile traversal graph and validates:

- at least two reachable elevations in every functional room;
- a purposeful platforming node in every room;
- an actual jump or ledge-climb action into a platform segment;
- ramp/headroom compatibility;
- locally reachable paired portal sockets;
- complete required bridges;
- reachable doors, keys, mechanisms, chests, encounter spawns, and shrine;
- safe, escapable basement/drop-space sequences;
- a non-bypassable physical keycard route.

This is a strong correctness foundation. However, “every room must contain a purposeful jump platform” risks turning platforming into repeated garnish. Platforming becomes more memorable when rooms have distinct traversal identities: a fall-and-recovery room, a timing room, a climbing room, a moving-machinery room, a combat-on-gantries room, and a mostly grounded contrast room.

### Dynamic platforms: infrastructure exists, ordinary generator barely uses it

`Game.js` supports registering and unregistering dynamic platforming surfaces, dynamic ledge candidates, platform support elevation, and one-way platform behavior. The authored Ascension Engine boss environment uses genuinely dynamic traversal machinery and checkpointed falls.

The ordinary generator does not yet turn this infrastructure into a general room grammar. The room flavor catalog even declares weak floor panels and collapse delays, but there is no general crumbling-platform runtime in the standard ruin. Standard dungeon floor correction is also conservative: outside the authored Reliquary void, invalid floor movement tends to be projected back toward a last safe position. A Unity implementation of real pits and collapsing routes must make falling a first-class state rather than a collision error.

### Puzzles and progression

The current progression is readable and testable:

| Stage | Source | Gate |
| --- | --- | --- |
| Initial band | Keycard Alpha on the keycard pyramid | Door Alpha |
| Trap/coolant band | Keycard Beta in a coolant-room chest | Door Beta |
| Conveyor/factory band | Keycard Gamma from an elite encounter | Door Gamma |
| Boss | Shrine Key as boss reward | Shrine Door |
| Final | Large Refractor shrine | Extraction/camp return |

The conveyor generator supports redirect, two-route, return-loop, and multi-stage puzzle definitions with solver validation. The intended good rule is already present: consoles remain off the belt, cargo is routed to a pressure plate, and the bonus vault is optional rather than required for main progression.

This logic is worth keeping. The fixed sequence and exact Alpha/Beta/Gamma count should become a configurable progression grammar rather than an invariant of every ruin.

### Procedural Reaverbots are more reusable than procedural rooms

Reaverbot generation is based on stable module IDs, compatibility rules, behavior contracts, seeded selection, validation, salvage provenance, and extensive deterministic tests. That is the model the Unity dungeon generator should emulate.

A room should similarly be a validated gameplay genome:

```text
room intent
+ volume class
+ entry/exit socket requirements
+ elevation pattern
+ traversal mechanic
+ machine/hazard set
+ encounter ecology
+ reward purpose
+ visual flavor
```

It should not be a random pile of platforms, just as a Reaverbot is not a random pile of robot parts.

## 3. What to preserve in Unity

### Preserve as design contracts

1. **Seed determinism**  
   The same seed and ruleset should reproduce topology, room variants, key placement, encounter genomes, and rewards. Keep simulation data separate from instantiated GameObjects.

2. **One shared traversal profile**  
   Establish the Unity character's capsule, grounded step, fixed jump arc, air control, ledge reach, safe drop, ramp grade, and minimum landing size first. The generator and runtime must consume the same values.

3. **Generate → validate → instantiate**  
   Produce a pure dungeon plan, reject impossible plans, and only then spawn prefabs. Do not instantiate while still deciding topology.

4. **Progression solvability**  
   Preserve the reachability solver, unique paired keys, non-bypassable locks, boss-earned final key, Key Seeker, and Large Refractor objective.

5. **Purposeful optional routes**  
   Upper decks, drops, conveyor diversions, and platform chains should lead to a flank, shortcut, control, lore, salvage, or reward—not exist only to satisfy a verticality quota.

6. **Room flavor as mechanics plus art direction**  
   Flooded, dark, unstable, collapsed, electrified, overheated, corroded, infested, and Refractor-rich should change gameplay where selected. If a flavor is only lighting metadata, label it as presentation-only until its runtime behavior exists.

7. **Procedural enemy genomes and salvage identity**  
   Port the content contracts and module relationships. Unity prefabs and animation replace the Three.js visual factory where appropriate, but the visible weapon/defense/weak-point/salvage relationship should survive.

8. **Manual, skill-based combat**  
   Preserve aiming, manual attacks, arm swapping, distinct weapon behaviors, dodge, guard/parry, barriers, status effects, and elevated encounter spaces.

9. **Fixed typed non-weapon gear**  
   Retain Armor Frame, Helmet, Mobility Gear, Defense Gear, and Utility Modules. Mobility is the natural progression axis for optional mastery routes such as Jump Springs or Jet Skates.

10. **Semantic regression tests**  
    Keep the lessons behind pyramid traversal, ramp/scaffold clearance, railing landings, basement return shelves, enemy spawn clearance, door chokepoints, and seed stability.

### Preserve as authored content, not universal generator rules

- The keycard pyramid can become a reusable “monumental credential chamber” template.
- The trap basement and return shelf can become a “mandatory drop with recovery climb” template.
- The three-tier conveyor room can become a “sorting gantry” template.
- The coolant balcony can become a “controls above hazard floor” template.
- The Ascension Engine should remain an authored/special encounter proving the outer limit of traversal, not be chopped into generic room fragments.

## 4. What not to reimplement literally

| Three.js pattern | Unity decision |
| --- | --- |
| One 12,882-line generator creating data, meshes, materials, NPCs, collision, puzzles, and validation | Split into pure plan generation, validation, prefab selection, scene construction, and runtime systems. |
| One 4,636-line dungeon controller owning progression, floor correction, doors, traps, conveyors, and navigation | Use small components and services with explicit ownership. |
| One 9,176-line game host | Do not create a `GameManager` that becomes the new monolith. Use composition and scoped coordinators. |
| Tile-by-tile Three.js meshes and manually maintained AABB collision zones | Use authored modular prefabs, real colliders, combined/instanced rendering where useful, and generated navigation data. |
| Manual floor snapping as the primary answer to invalid geometry | Let the player genuinely fall. Use death planes, recovery volumes, checkpoints, lower floors, or authored catch routes. |
| Hard-coded room IDs controlling vertical geometry | Select room templates from socket/elevation/intent contracts. Stable IDs should identify content, not dictate the only topology. |
| Every functional room forced to contain one jump platform | Give each room a traversal intensity and mechanic budget; include calm and grounded contrast rooms. |
| Declared archetype/flavor features that do not have runtime consumers | Implement a narrow set completely. Do not migrate aspirational metadata as though it were functional content. |
| Browser URL debug parameters and DOM UI | Replace with Unity editor tools, gizmos, seed inspectors, debug panels, and test scenes. |
| Playwright tests tied to exact Three.js object names | Recreate their player-facing assertions with Unity Edit Mode and Play Mode tests. |
| Legacy randomized non-weapon loot/affixes | Leave retired. Do not spend migration time achieving compatibility with a system the current design has already rejected. |
| Imported GLB-room toggles and Three.js loader/collision workarounds | Import usable art through Unity's asset pipeline, then author explicit colliders, sockets, pivots, and semantic components. |

## 5. Recommended Unity dungeon architecture

Unity's `ScriptableObject` is appropriate for shared content definitions, while the actual generated run should be ordinary serializable runtime data rather than mutated asset state. Unity's AI Navigation package can build navigation at runtime and provides links for actions such as jumping gaps or crossing doors. Unity Test Framework supports separate Edit Mode and Play Mode verification.

### A. Content definitions

Use data assets for stable authored content:

- `DungeonThemeDefinition`
- `RoomTemplateDefinition`
- `RoomIntentDefinition`
- `TraversalMechanicDefinition`
- `ProgressionRuleSet`
- `EncounterProfileDefinition`
- `HazardDefinition`
- `ReaverbotModuleDefinition`

Each room template should reference one or more prefabs and expose:

```text
stable ID
volume bounds
entry/exit sockets
socket elevation and direction
required traversal abilities
walkable surface markers
ledge markers
enemy spawn regions
reward/control/door anchors
hazard and moving-platform anchors
camera volumes
navigation surfaces and links
performance cost
theme/flavor compatibility
```

Do not put mutable run state into these assets.

### B. Pure runtime plan

Create plain C# data with no scene references:

```text
DungeonPlan
  seed
  rulesetVersion
  roomNodes[]
  connections[]
  progressionItems[]
  encounterPlans[]
  validationReport
```

Generation should occur in three passes:

1. **Progression graph** — critical route, locks, keys, boss, shrine, optional branches, loops, and shortcuts.
2. **3D embedding** — assign floor/elevation bands and connect compatible sockets without overlap.
3. **Room composition** — select templates and internal traversal/hazard variants matching each node's intent.

### C. Validators

Run validators before instantiation:

- graph reachability with staged inventory;
- critical door non-bypass;
- socket type/elevation match;
- player traversal reachability;
- safe landing and headroom;
- guaranteed recovery from every mandatory fall;
- main-path stability after dynamic-platform failure;
- enemy footprint and navigation reachability;
- objective, key, console, chest, and spawn clearance;
- room overlap and camera clearance;
- content/performance budgets.

### D. Scene construction

`DungeonAssembler` should only translate an accepted `DungeonPlan` into prefabs. It should not make progression decisions. Each spawned room receives a small `RoomRuntime` that owns its local interactables, hazards, encounter state, and cleanup.

Suggested responsibility split:

| Component/service | Owns |
| --- | --- |
| `DungeonPlanner` | Seeded abstract graph and content choices |
| `DungeonValidator` | Pure correctness report |
| `DungeonAssembler` | Prefab placement and wiring |
| `ProgressionRuntime` | Keys, doors, boss reward, shrine, extraction |
| `TraversalRuntime` | Moving/crumbling platforms, lifts, recovery volumes |
| `EncounterDirector` | Room activation and enemy lifecycle |
| `NavigationRuntime` | NavMesh surfaces/links and dynamic changes |
| `DungeonDebugView` | Graph, seed, sockets, failure reasons, regeneration |

## 6. First biome grammar: Ancient Industrial Reaverbot Factory / Warehouse / Nest

Treat the biome as five interacting layers:

1. **Structure** — ancient walls, floors, shafts, buttresses, catwalks.
2. **Logistics** — conveyors, cranes, cargo lifts, warehouse racks, sorting gates.
3. **Metabolism** — coolant, power, refractors, pumps, pressure systems.
4. **Occupation** — nests, scrap burrows, dormant charging racks, Reaverbot patrol infrastructure.
5. **Ritual** — ruby optics, machine chapels, credential pyramids, ceremonial data/refractor spaces.

Each room should combine two or three layers. A warehouse plus occupation room becomes a nest among moving racks; logistics plus metabolism becomes a conveyor crossing an overheated coolant pit; structure plus ritual becomes a vertical credential tower.

### Recommended initial room set

Build six high-quality templates before attempting all 15 catalog archetypes:

| Template | Primary traversal | Gameplay purpose |
| --- | --- | --- |
| Assembly Floor | Grounded combat with low machinery | Baseline room and pacing contrast |
| Sorting Gantry | Ramps, second-floor bridge, conveyor timing | Elevated combat and optional control console |
| Broken Freight Shaft | Ledge climb, safe drop, recovery floor | Vertical transition between dungeon levels |
| Reaverbot Nest Warehouse | Rack bridges, holes between aisles, ambush spawns | Enemy ecology and salvage identity |
| Coolant Pumpworks | Hazard floor below, safe controls above | Route choice and environmental utility gear |
| Credential Chapel | Monumental stepped ascent plus shortcut jumps | Key/objective reveal and ritual identity |

Add two connector templates:

- a cargo lift/stairwell that can connect adjacent elevation bands;
- a damaged maintenance shaft that supports one-way descent plus a later shortcut.

### Dynamic traversal mechanics

Implement only three dynamic mechanics initially:

1. **Crumbling platform**  
   `Stable → Warning → Cracking → Falling/Disabled → Restored or Run-Disabled`.

2. **Cargo lift**  
   Deterministic stops, explicit call state, player/enemy support, and a fallback ladder/stair or recovery route when progression-critical.

3. **Moving conveyor cargo**  
   Can become temporary cover, a moving stepping surface, or a pressure-plate puzzle object.

For crumbling platforms:

- telegraph with sound, animation, particles, and material cracking;
- define whether enemies can trigger them;
- carry the player's support velocity correctly;
- disable or update navigation links when they fail;
- never destroy the only critical route without a lower catch route, checkpoint, alternate path, or timed restoration;
- make the seed determine placement, not frame timing;
- pool reusable pieces/effects rather than repeatedly instantiating and destroying them.

## 7. How to make the dungeons feel less like fight chambers

Use a traversal/encounter rhythm rather than assigning combat to every room:

```text
orient → traverse → fight under spatial pressure → choose route → recover → reveal → escalate
```

Recommended room-role distribution for a short first dungeon:

- 25% traversal-dominant;
- 25% combat-dominant;
- 15% mixed mechanism/combat;
- 15% exploration/reward/lore;
- 10% safe transition or vista;
- 10% boss/objective.

This is a tuning starting point, not a permanent formula. The important change is that a room's identity should not default to “doors close, enemies spawn.”

Enemy placement should exploit height:

- artillery on destructible or flankable upper positions;
- pouncers moving between elevation bands;
- shielded enemies controlling narrow ramps;
- flyers using shafts rather than hovering over flat arenas;
- nest controllers whose machinery changes traversal until destroyed;
- melee pursuers pressuring the player while machinery cycles.

Platforming and combat should interact selectively. Constantly shooting while performing precision jumps would undermine the committed Mega Man Legends-style jump. Favor readable windows, broad landings, telegraphed threats, and tactical repositioning over continuous precision-platforming bullet hell.

## 8. Asset strategy

Use the existing wall and floor textures immediately, but apply them through a small material language:

- structural wall;
- structural floor;
- worn/unsafe floor;
- conveyor/mechanism metal;
- dark joints and recesses;
- emissive power/coolant strips;
- Reaverbot nest contamination;
- ritual/refractor accent.

Build a modular graybox kit first:

- wall spans and corners;
- floor slabs and undersides;
- ramps and stairs;
- catwalks, rails, broken rails;
- doors and frames;
- columns, girders, braces;
- lift shafts and platforms;
- conveyor straights, corners, splitters;
- warehouse racks and cargo blocks;
- pits, recovery floors, and ledge shelves.

Every visible solid module needs a collider and socket/semantic metadata. A decorative rail must not silently block a doorway; a visible machine footprint must not be absent from navigation; a broken edge must advertise whether it is grabbable.

Do not wait for final art to validate the generator. Graybox materials should clearly distinguish walkable, jumpable, hazardous, dynamic, locked, and recovery surfaces.

## 9. Recommended implementation sequence

### Milestone 0 — movement contract

Before expanding generation, lock down:

- character capsule dimensions;
- fixed jump height and time to apex;
- air-control limits;
- grounded step and ramp handling;
- ledge detect/hang/climb;
- moving-platform support;
- fall, recovery, and death-plane behavior;
- camera behavior in low ceilings, shafts, and multi-floor rooms.

**Exit test:** one authored traversal gym proves ramps, stairs, ledges, a safe drop, a moving lift, a crumbling platform, and a three-floor camera path.

### Milestone 1 — pure planner and debug view

- Define stable content IDs and data assets.
- Generate an abstract graph from a seed.
- Draw the graph, bands, sockets, and validation errors in an editor/debug view.
- Do not spawn final rooms yet.

**Exit test:** 1,000 seeds produce a valid progression graph with no key behind its own lock and at least one optional branch or loop.

### Milestone 2 — six-room vertical slice

Generate a compact ruin containing:

- camp/entrance;
- one grounded assembly room;
- one traversal shaft connecting floors;
- one mixed conveyor/gantry room;
- one optional warehouse/nest branch;
- one objective or miniboss room.

Require:

- at least two elevation-band transitions;
- one intentional fall to a lower playable floor;
- one optional upper route;
- one crumbling-platform sequence;
- one shortcut returning toward an earlier room;
- one key/door gate and the Large Refractor objective placeholder.

**Exit test:** ten hand-reviewed seeds are recognizably different in route shape and traversal sequence, not merely in room position.

### Milestone 3 — progression and encounter integration

- Add paired keys/doors, Key Seeker, boss/final key, shrine, and extraction.
- Add seeded encounter plans and a small subset of Reaverbot archetypes.
- Add lower-floor and upper-floor enemy navigation links.
- Validate keys, enemies, rewards, and consoles against colliders and traversal.

**Exit test:** an automated player-proxy solver can complete every tested seed; Play Mode tests verify one complete expedition.

### Milestone 4 — flavor and content expansion

Implement three flavors fully before adding more:

- powered;
- unstable/corroded;
- infested.

Each must alter art, traversal or hazards, encounters, and rewards. Then expand toward the rest of the 15-archetype catalog based on what the game actually needs.

## 10. Immediate next sprint

The next sprint should not attempt the Custom Buster, full salvage economy, all Reaverbots, all 15 rooms, and a new dungeon generator at once.

Recommended priorities:

1. Write the Unity `TraversalProfile` and measure the playable character against it.
2. Build a traversal gym with three floors, a safe lower catch floor, ledge climbing, one cargo lift, and one crumbling platform.
3. Define `RoomSocket`, `RoomTemplate`, `DungeonNode`, `DungeonConnection`, and `DungeonPlan` data contracts.
4. Build three graybox room prefabs: Assembly Floor, Broken Freight Shaft, and Sorting Gantry.
5. Generate a six-node graph with one vertical connection, one optional loop, and one key gate.
6. Validate the graph before prefab spawning.
7. Add a seed/debug overlay showing graph, room IDs, sockets, elevation bands, and rejection reasons.
8. Add Edit Mode tests for deterministic graph/progression and Play Mode tests for the traversal gym.

The most important success criterion is experiential:

> Two seeds should tell different spatial stories—one may descend through a failed sorting shaft and climb back by cargo lift, while another crosses upper gantries before a collapsing bridge drops the player into an infested warehouse. Both still lead coherently toward the Large Refractor.

## 11. Final keep/change matrix

### Keep

- RuinDiveX's expedition identity and Ancient Industrial Reaverbot theme.
- Manual combat and distinct arm behavior.
- Seed determinism and stable IDs.
- Shared traversal limits and validation.
- Paired keys, Key Seeker, boss Shrine Key, Large Refractor.
- Conveyor routing as optional puzzle content.
- Procedural Reaverbot genomes and salvage provenance.
- Typed fixed gear and traversal upgrades.
- Semantic tests and authored signature rooms.

### Change

- Replace fixed room-chain generation with a constrained 3D progression graph.
- Replace hard-coded room-ID geometry with socketed room templates and room genomes.
- Make real falling, recovery floors, dynamic platforms, and multi-floor connections first-class.
- Use fewer, more distinct traversal identities instead of one obligatory jump platform per room.
- Convert archetype/flavor metadata into implemented mechanics gradually.
- Separate pure plan data from Unity scene objects.

### Leave behind

- Monolithic host/generator/controller classes.
- Three.js mesh/material/collision construction code.
- Browser/DOM/local-server debug architecture.
- Manual AABB and last-safe-position workarounds where Unity physics can own the behavior.
- Legacy randomized non-weapon affixes.
- Cosmetic “procedural” variation that does not alter route, decision, risk, or encounter.

## Sources

- [RuinDiveX repository and README](https://github.com/aether-ore/RuinDiveX/tree/new-dungeon-generation-snapshot-20260709)
- [DungeonGenerator.js](https://github.com/aether-ore/RuinDiveX/blob/new-dungeon-generation-snapshot-20260709/src/DungeonGenerator.js)
- [DungeonController.js](https://github.com/aether-ore/RuinDiveX/blob/new-dungeon-generation-snapshot-20260709/src/DungeonController.js)
- [DungeonProgression.js](https://github.com/aether-ore/RuinDiveX/blob/new-dungeon-generation-snapshot-20260709/src/DungeonProgression.js)
- [IndustrialRoomArchetypes.js](https://github.com/aether-ore/RuinDiveX/blob/new-dungeon-generation-snapshot-20260709/src/IndustrialRoomArchetypes.js)
- [TraversalCapabilities.js](https://github.com/aether-ore/RuinDiveX/blob/new-dungeon-generation-snapshot-20260709/src/TraversalCapabilities.js)
- [Unity ScriptableObject manual](https://docs.unity3d.com/6000.5/Documentation/Manual/class-ScriptableObject.html)
- [Unity AI Navigation manual](https://docs.unity3d.com/Packages/com.unity.ai.navigation%402.0/manual/index.html)
- [Unity Test Framework](https://docs.unity3d.com/6000.0/Documentation/Manual/com.unity.test-framework.html)
- [Unity object pooling](https://docs.unity3d.com/6000.5/Documentation/Manual/performance-reusable-code.html)

## Three-perspective design verdict

**GPT:** Preserve deterministic contracts and player-facing identity; rebuild the generator around pure plans, sockets, validators, and room templates.

**BB:** Let every dungeon seed create a different little adventure, but always give the player a fair recovery route and a meaningful reason to climb, fall, and explore~★

**Beatrice:** Do not mistake randomness for possibility. A corridor displaced three meters is the same fragment wearing another mask. True procedural mystery changes what the player believes, risks, and discovers.
