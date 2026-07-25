# RuinDiveX Themed Procedural Dungeon Authoring Prompt

Use this prompt to plan and implement a new RuinDiveX procedural dungeon family whose rooms match the authored quality and traversal richness of the Industrial Factory while remaining compatible with the signed-elevation connector system.

---

## Prompt

You are implementing a new procedural dungeon family for the Three.js version of RuinDiveX.

Work from the current repository and branch:

- Repository: `aether-ore/RuinDiveX`
- Branch: `new-dungeon-generation-snapshot-20260709`
- Treat the supplied **RuinDiveX Procedural Dungeon Style Guide** as the normative generation contract.
- Treat the supplied dungeon-family plan as the normative theme, progression, room-catalog, and encounter brief.
- Use the current Industrial Factory implementation only as a behavioral and quality reference. Do not copy its room order, industrial names, hard-coded progression chain, theme-specific surface names, or obsolete dimensions into the new family.
- Preserve `industrial-v1` behavior, deterministic results, room IDs, saved-game compatibility, plan hashes, progression, tests, and presentation unless a deliberately versioned migration is required.
- This task is Three.js-only unless the plan explicitly says otherwise. Do not modify or reuse Unity dungeon content.

The repository snapshot must be inspected before implementation. Do not assume that every contract described in the style guide is already represented by generic code. In particular, identify and isolate Industrial Factory assumptions such as `industrialRamp`, fixed room IDs, fixed keycard predicates, local tier constants, one-tile socket metadata, and Industrial-only rendering or collision branches.

Your output must be an implementation-ready plan and, when asked to build it, a complete working implementation with tests and visual QA. Do not stop at prose, blockout rooms, disconnected art assets, or unvalidated manifests.

## 1. Establish the source of truth

Before designing rooms:

1. Record the checked-out commit SHA and confirm the active branch.
2. Locate the current:
   - room graph composer;
   - room metadata/archetype library;
   - signed room-elevation propagation;
   - connector-family selection and reservation;
   - floor identity and walkability graph;
   - platformability validation;
   - collision and support generation;
   - minimap assembly;
   - encounter/control/reward placement;
   - dungeon persistence and plan hashing;
   - room-preview and diagnostic entry points;
   - Playwright and seed-sweep tests.
3. Produce a short compatibility table with four columns:
   - required contract;
   - current implementation location;
   - already generic or Industrial-specific;
   - required change.
4. When the repository and the supplied style guide disagree, preserve the old behavior for `industrial-v1` but implement the supplied style-guide requirement for the new family through a family-aware or versioned contract. Never silently weaken the new contract to match legacy code.

Important distinction:

- **Inter-room elevation** is the signed `baseElevation` assigned by the graph. A standard elevation-changing connector changes it by exactly `+14 m` or `-14 m`.
- **In-room elevation** is local geometry relative to `baseElevation`. It creates balconies, pits, platforms, machinery decks, stairs, ramps, and sub-zones. It does not alter the graph-assigned room elevation or impersonate a 14 m connector.

Do not conflate these systems.

## 2. Non-negotiable experience goals

The new dungeon must be an explorable facility, ruin, cavern, complex, or inhabited structure—not a chain of fight boxes.

Every generated dungeon must:

- use authored rooms and authored connector skins rather than shipping primitive fallback boxes;
- give each room a legible in-world function;
- use upper and lower space as playable route structure;
- contain observation rewards, discoveries, optional risk, and at least one meaningful return or shortcut;
- keep required exits and required controls permanently reachable without depending on clearing unrelated ordinary encounters;
- contain every visible lower area or fully occlude it;
- replace bottomless falls with playable landing sub-zones and a damage-free return route;
- maintain stable progression semantics while allowing seed-dependent room order, branches, connector families, direction, and landmark relationships;
- avoid uninterrupted corridor chains and duplicate playable room topologies;
- include calm navigation space where the room budget permits;
- use connectors to reveal levels, complete loops, or expose a new side of a known place rather than merely terminate at empty landings.

## 3. Mandatory world and connector dimensions

Use world metres. The horizontal macro tile is `2.8 m`.

| Requirement | Contract |
| --- | ---: |
| Inter-room elevation transfer | exactly `14 m` signed |
| Continuous connector width | at least `8.4 m` (`3` tiles) |
| Connector path | at least `25.2 m` (`9` tiles) |
| General straight run | at least `19.6 m` (`7` tiles) |
| Slope straight run | at least `36.4 m` (`13` tiles) |
| Lift straight run | at least `28 m` (`10` tiles) |
| Endpoint flat buffer | at least `5.6 m` (`2` tiles) |
| Clear endpoint/mechanism landing | at least `8.4 × 8.4 m` |
| Player headroom | at least `3.6 m` |
| Ladder aperture | at least `2.4 × 2.8 m` |
| Total dungeon vertical span | at most `56 m` |
| Elevation transfers per root-to-leaf route | at most `4` |

All sockets must declare stable IDs, topology revision, local transform, facing, width, height, compatible connector families, required clear landing, structural clearance, camera clearance, and signed elevation expectations.

The assembled room must expose absolute `baseElevation`, `minY`, `maxY`, and `ceilingY`. The connector must expose `sourceElevation`, `destinationElevation`, signed `elevationDelta`, progression `direction`, `higherEndpoint`, and `lowerEndpoint`.

Endpoint floors, sockets, thresholds, landings, and room entrances must align within `0.05 m`.

## 4. Dungeon-wide elevation plan

For a standard full dungeon:

- select `3–5` elevation-changing connectors;
- include at least one switchback slope, one ladder, and one automatic lift;
- place all three mandatory families on progression routes;
- include at least one ascending and one descending progression transfer;
- prefer optional fourth and fifth transfers on branches;
- use level service galleries for other compatible connections;
- keep parallel upper-catwalk alternatives level even when another route between the same rooms changes elevation;
- reject conflicting graph merges, excessive vertical span, invalid clearance, overlap, or missing connector-family coverage;
- never flatten, reverse, or substitute an accepted signed connector after elevation propagation.

Both ascending and descending variants must be genuine bidirectional traversal. “Direction” describes graph progression, not one-way player movement.

## 5. Room style guide

Create a room catalog before authoring geometry. Each room record must contain:

- stable module ID and topology revision;
- display name;
- district or functional group;
- in-world purpose;
- traversal role;
- mood and landmark language;
- unique topology summary;
- critical path through the room;
- optional route or observation route;
- local walkable elevations relative to `baseElevation`;
- sockets and compatible connector families;
- required controls, rewards, encounters, discoveries, safe anchors, and hazards;
- enclosure and support strategy;
- collision and camera-clearance notes;
- minimap representation;
- environmental-state variants;
- performance budget and LOD data.

### 5.1 Functional and topological identity

Every room needs a function that can be inferred from its silhouette, machinery, structure, or contents. Examples include processing, storage, ventilation, transport, maintenance, habitation, containment, extraction, ritual, research, control, or waste handling.

Every selected room must also have a unique playable topology. A prop shuffle or material swap is not a new topology. Vary:

- central obstacle versus perimeter route;
- ring, spoke, fork, crossing, stacked, terraced, pit, bridge, tower, or maze organization;
- high-route/low-route relationship;
- control-to-result sightline;
- entry-to-exit sightline;
- cover rhythm and encounter footprint;
- optional-space placement;
- return-route logic.

The critical route should be readable on entry but need not be fully visible. Use lighting, framing, moving machinery, landmark silhouettes, material contrast, and sightlines to communicate:

- where the player arrived;
- what the room does;
- the next likely objective;
- which space is optional;
- what changed after a control was operated.

### 5.2 In-room elevation

In-room elevation must create decisions and spatial understanding, not decoration.

For ordinary authored rooms, use:

- one primary datum at local `0 m`;
- one or more clearly declared local tiers only when each tier has gameplay purpose;
- conservative tier spacing that preserves `3.6 m` headroom below all occupied upper floors;
- sufficient structural depth for slabs, beams, collision, and visual support;
- a complete route from the room entrance to every required socket and control;
- a permanent recovery route from every intentionally reachable lower zone.

An elevated tier is justified only if it provides at least one of:

- a required route or matched socket;
- a control with a visible effect;
- a combat flank or safer alternative;
- an observation point that teaches room state;
- a reward or discovery;
- a permanent shortcut;
- a traversal sequence whose action is the room’s main identity.

Do not create inaccessible display catwalks that resemble routes. Clearly distinguish scenic structure from walkable structure through railings, lighting, continuity, collision, and minimap treatment.

Do not place required content on a local tier supported only by a precision jump, destructible temporary prop, ordinary encounter state, or mechanism that can become irrecoverably unavailable.

### 5.3 Walkability

Author the walkable graph before dressing the room.

Each room requires:

- a continuous, collision-valid critical route between required sockets;
- no critical one-tile chokes;
- clear arrival and departure landings;
- clearance around doors, controls, lifts, ladders, stairs, and moving machinery;
- floor identity keyed by horizontal position and absolute elevation;
- no aliasing between vertically stacked floors;
- no collision surfaces that pull the player through an upper floor or lower ceiling;
- navigation fixtures for player, grounded enemy, aerial enemy, and non-navigable hazard surfaces as applicable;
- at least one safe anchor outside active mechanism sweeps and unavoidable encounter pressure.

Validate walkability in every stable room/mechanism state. If liquid, magma, bridges, shutters, cargo, lifts, or machinery can change state, prove that each reachable state has a valid required route or a deliberate reversible transition.

Props may never be used to patch a broken route. Place dress props only after walkability, mechanism sweeps, camera volumes, and encounter bounds have passed.

### 5.4 Platformability and jump routes

Jumping may enrich a room but must not replace required connector compliance.

Use jump platforms for:

- optional rewards;
- combat flanks;
- shortcuts that supplement a permanent route;
- traversal-focused rooms whose jumps are broad, readable, and validated against the actual player movement envelope.

For every platform declare:

- top elevation and usable landing polygon;
- collision thickness;
- support or suspension system;
- approach direction;
- required jump distance and rise;
- overhead and lateral clearance;
- fall destination;
- recovery route;
- whether enemies may navigate or spawn on it;
- whether it moves and, if so, its complete sweep and wait-safe zones.

Never:

- require blind jumps;
- require landing on narrow trim, railings, pipes, or decorative props;
- put a void beneath a jump;
- let an unsupported underside behave like a walkable floor;
- assume a jump is valid from visual distance alone;
- use moving platforms without safe boarding, safe waiting, and recall/reset behavior.

At least one non-jump permanent route must reach required controls, exits, and progression rewards unless the whole room is an explicitly authored traversal challenge with tested, forgiving recovery.

### 5.5 Ramps and slopes

Use two distinct concepts:

1. **In-room ramps** connect local room tiers.
2. **Switchback slope connectors** perform an exact signed `14 m` inter-room transfer.

Both require:

- constant usable width;
- flat start/end landings;
- flat turn landings at every direction change;
- continuous collision without seams, lips, or invisible steps;
- ceiling clearance over the full incline;
- visible support under raised portions;
- railings wherever leaving the ramp is not an authored fall route;
- player and enemy traversal validation in both directions.

Do not stretch one steep ramp to force an elevation. If a legal incline does not fit, enlarge the reserved footprint, add switchbacks with full landings, select another connector family, or reject the layout.

Theme the slope through structure and presentation—rock-cut switchbacks, aqueduct ramps, root bridges, ceremonial processions, cargo inclines—without changing its gameplay dimensions or signed elevation.

Replace hard-coded `industrialRamp` checks with a generic traversal classification such as `surfaceRole: 'ramp'`, while retaining a presentation/material role for the family.

### 5.6 Stairs

Stairs are primarily for local room tiers and themed connector skins explicitly compatible with the contract.

Stairs must:

- use consistent rise and run suitable for the player controller;
- provide full-width landings at turns and doors;
- avoid placing controls or props on the stair run;
- preserve headroom measured from every tread;
- include collision that does not snag the player or grounded enemies;
- use railings, walls, or authored safe drops at open sides;
- have visible structural support;
- remain readable under combat lighting and effects.

Do not use a decorative steep staircase as a substitute for a validated switchback slope connector. If a themed connector is called a “stair,” it must still satisfy the connector footprint, landing, bidirectionality, enclosure, and exact elevation contract assigned to its family.

### 5.7 Ladders

A ladder connector is a complete bidirectional mechanism, not a wall prop.

It requires:

- an unobstructed aperture of at least `2.4 × 2.8 m`;
- removed floor/ceiling geometry over the declared opening;
- aligned upper and lower mounts;
- clear upper and lower `8.4 × 8.4 m` landings where required by the shared connector contract;
- mount, dismount, camera, animation, and collision clearance;
- a guard or gate that prevents accidental falls without blocking intentional use;
- no door swing, railing, trim, pipe, prop, pickup, or encounter anchor in the climb envelope;
- visible enclosure and support through the full shaft;
- a damage-free return route in both directions;
- validation from both endpoints, including recall/recovery behavior if traversal can be interrupted.

Ladders may be themed as chains, carved handholds, vines, maintenance rungs, archive rails, or ritual ascents only if the gameplay collision and interaction contract stays unchanged.

Do not place ordinary combat spawns inside climb or dismount volumes. Do not make a mandatory ladder inaccessible until an unrelated ordinary encounter is cleared.

### 5.8 Automatic lifts

An automatic lift connector must:

- span exactly the accepted signed `14 m`;
- serve both endpoints indefinitely;
- automatically arrive, depart, or recall without requiring a consumable;
- include controls/recall stations at both ends when waiting could strand the player;
- have clear mechanism landings and a reserved shaft/sweep volume;
- prevent crushing, clipping, falling through, or boarding beneath the platform;
- maintain full enclosure in every stable state;
- remove any floor/ceiling tile covering the shaft aperture;
- expose state to collision, minimap, persistence, and diagnostics;
- remain usable after revisits and save/load;
- define safe behavior if the player, an enemy, or a physics object obstructs it.

A progression-owned shortcut lift may begin inactive only when the family plan explicitly requires it. Once activated, it must remain permanently bidirectional and persisted.

### 5.9 Hazards and falls

Hazards must create routing choices rather than invalidate required traversal.

- Required routes always have a safe solution.
- Hazard shortcuts and reward routes must communicate risk before commitment.
- An intentional fall must land in a modeled, playable sub-zone.
- Every fall sub-zone needs a damage-free permanent return.
- Dynamic hazard states must be included in reachability validation.
- Enemy spawn/nav rules must respect hazard compatibility and path cost.
- Railings mark non-routes; missing railings should deliberately signal a survivable authored descent.

## 6. Connector integration

Provide a themed skin for every connector family required by the generator. The theme may change architecture, material, sound, props, and mechanism appearance, but may not change traversal semantics.

Every connector must:

- reserve its footprint before room placement is committed;
- align both sockets within `0.05 m`;
- preserve at least `8.4 m` traversable width throughout;
- be physically traversable in both directions;
- include prop-free endpoint and mechanism landings;
- reserve structure, headroom, camera, collision, aperture, and mechanism sweep;
- remain enclosed in every stable state;
- visibly support every elevated walkable surface;
- use railings where a fall is not a route;
- maintain a repeating framing rhythm equivalent to the Industrial Factory’s structural arches, with no gap greater than three macro tiles unless validated as a deliberate large-span structure;
- keep doors, controls, recall stations, decorative frames, and props out of movement/sweep volumes;
- cap unused sockets with authored, enclosed geometry;
- carry floor, collision, minimap, persistence, and diagnostics data using absolute elevations.

Do not reskin Industrial Factory corridors. Author a connector kit that expresses the new theme’s construction logic while conforming to the same shared contract.

## 7. Theme translation rules

First define three visual/structural layers:

1. the original builders’ architecture;
2. later damage, occupation, excavation, growth, flooding, or decay;
3. current active systems, hazards, inhabitants, and navigation cues.

Then map shared gameplay roles to theme-native forms:

| Shared role | Theme-specific questions |
| --- | --- |
| Wall/frame rhythm | What carries load and repeats every architectural bay? |
| Elevated support | Columns, roots, chains, ribs, masonry, scaffolds, or suspension? |
| Safe walkable floor | Which material and edge language consistently signals footing? |
| Railing | What prevents falls without hiding landmarks? |
| Ramp/slope | Why did this culture or facility need inclined movement? |
| Stair | Is it ceremonial, service, carved, cast, grown, or improvised? |
| Ladder | What provides grips, aperture guards, and clear dismounts? |
| Lift | What powers it, recalls it, encloses it, and communicates state? |
| Door/socket | How are connection width, facing, state, and destination importance shown? |
| Hazard | How is danger telegraphed before the player enters it? |
| Control | Can the player see or infer the controlled system? |
| Optional route | What visual irregularity rewards observation? |

Do not let visual fiction erase route readability. A collapsed, organic, ancient, or improvised theme still needs authored clearances, support, consistent walkable language, and valid collision.

## 8. Apply the supplied dungeon-family plan

Translate the family plan into data rather than embedding its semantics in general generator code.

For the Magma Cavern / Excavated Ancient Refinery plan:

- add `magma-refinery-v1` separately from `industrial-v1`;
- select `11–13` unique modules from its `18`-module catalog;
- preserve the early shrine landmark, two independently completable wings, two permanent wing shortcuts, shared boss convergence, post-boss barrier mechanism, and direct return;
- support both wing completion orders;
- use facility-state predicates rather than forcing Magma progression through the Industrial keycard chain;
- keep the Large Refractor barrier independent from the Smelter Seal;
- make environmental state changes reachability-safe;
- provide the Magma connector kit as themed variants compatible with the shared level gallery, switchback slope, ladder, and automatic lift contracts;
- do not let narrow-sounding fiction such as a service walk or collapsed conduit reduce the minimum traversable width or headroom;
- treat deep magma as a traversable high-cost hazard only on optional routes, shortcuts, secrets, and combat flanks; always provide a safe required solution;
- preserve inactive-to-permanent behavior for the two wing shortcuts and post-boss return lift.

Where the family plan proposes a connector whose name does not directly match a shared connector family, explicitly declare the mapping. For example, a Furnace Draft Stair may be the themed presentation of a switchback-slope-compatible transfer only if it satisfies that family’s complete dimensions and behavior. Do not create an unvalidated eighth traversal family merely because the theme uses a different noun.

## 9. Asset and manifest contract

Each authored room and connector must ship with:

- LOD0/LOD1/LOD2;
- semantic socket empties;
- control, reward, discovery, encounter, safe-anchor, and hazard anchors;
- simple collision proxies;
- walkable elevation data;
- mechanism sweep/aperture volumes;
- named material roles;
- minimap footprint;
- enclosure and support fixtures;
- export hash and topology revision.

Use a versioned `ruindivex-room-module/v1` sidecar manifest or the current repository-equivalent schema. Extend it only through a backward-compatible or explicitly migrated version.

Runtime primitives may remain as invisible collision and diagnostic fallback. They are not acceptable shipping architecture.

Materials must use world-metre UV scale. Partial architectural bays crop UVs rather than stretching them. Instance repeating supports, frames, chains, rails, rocks, roots, pipes, and machinery.

## 10. Validation and rejection rules

Reject a candidate before world commitment when any of the following occurs:

- room overlap or connector-footprint overlap;
- conflicting signed room elevations;
- endpoint mismatch greater than `0.05 m`;
- total vertical span above `56 m`;
- more than four elevation transfers on a root-to-leaf route;
- missing mandatory slope, ladder, or lift coverage;
- no ascending or no descending progression transfer;
- connector width, length, straight run, buffer, landing, headroom, or aperture below contract;
- unavailable theme variant for an accepted connector family/direction;
- blocked door, control, recall station, ladder, lift, ramp, stair, or socket;
- uncovered shaft aperture or unintended hole;
- visible exterior void;
- unsupported elevated walkable surface;
- fall route without playable landing and permanent return;
- required route dependent on ordinary encounter completion;
- required content reachable only through an unvalidated precision jump;
- stacked floor aliasing;
- unreachable required socket, control, reward, or extraction anchor;
- room topology duplicated in the same dungeon;
- mechanism state that strands the player or breaks progression;
- minimap/collision/render elevations disagreeing;
- missing or invalid manifest data;
- deterministic plan/hash mismatch.

Do not “repair” an invalid candidate by flattening elevations, narrowing paths, deleting required authored features, reversing a connector, inserting primitive rooms, or teleporting the player. Reject and regenerate deterministically.

## 11. Required test matrix

Implement automated unit, integration, seed-sweep, and browser tests.

At minimum:

1. Run `100+` deterministic seeds for the new family.
2. Assert room-count and uniqueness rules.
3. Assert graph reachability, branch, loop/shortcut, calm-space, and progression semantics.
4. Assert `3–5` elevation transfers, mandatory family coverage, ascending/descending coverage, `56 m` span, and root-to-leaf limit.
5. Test every connector family in both signed directions.
6. Test player traversal in both physical directions.
7. Test room entrance to every required socket/control using absolute floor identities.
8. Test ramps, stairs, ladders, lifts, moving platforms, fall recovery, and mechanism obstruction.
9. Test all stable environmental/mechanism states.
10. Test enemy navigation and spawn exclusion around hazards and traversal mechanisms.
11. Test minimap, persistence, save/load, revisit, and extraction anchors.
12. Test old saves missing `dungeonFamilyId` default to `industrial-v1`.
13. Prove `industrial-v1` deterministic snapshots and progression remain unchanged.
14. For Magma, prove both wing orders and all barrier/shortcut/boss predicates.
15. Perform repeated enter/return cycles and check for duplicated scene roots, mechanisms, hazards, audio, particles, models, or textures.
16. Use room/connector preview mode for visual QA of every module, family, direction, and important state.

Visual acceptance requires:

- no exposed blockout architecture;
- no stretched materials;
- no visible void;
- clear safe routes and hazard telegraphs;
- coherent supports and railings;
- readable socket, ladder, lift, ramp, stair, and platform affordances;
- clear distinction among the theme’s historical/structural layers;
- no camera clipping or mechanism occlusion;
- no props intruding into required clearance.

## 12. Deliverables

Provide:

1. repository/contract compatibility audit;
2. family graph and progression-state specification;
3. room catalog with unique topology and local elevation plans;
4. connector-family mapping and signed-variant coverage matrix;
5. module/sidecar manifest schema and examples;
6. implementation changes grouped by subsystem;
7. automated tests and seed-sweep results;
8. visual QA captures for every room and connector variant;
9. performance and lifecycle results;
10. a final acceptance checklist showing every normative requirement as pass/fail with evidence.

When implementing, work in small verified slices:

1. generic data contracts and backward compatibility;
2. graph/elevation/connector planning;
3. one room and one connector vertical slice;
4. all room modules;
5. all connector variants;
6. progression and mechanisms;
7. encounters, rewards, hazards, minimap, and persistence;
8. seed sweeps, browser journeys, visual QA, and regression tests.

Do not declare completion while any required connector is represented only by a placeholder, any room lacks validated critical-path walkability, any mandatory mechanism is non-bidirectional, or any acceptance item lacks evidence.

---

## Authoring checklist for each room

Copy and complete this block for every module:

```md
### <stable module ID> — <display name>

- Topology revision:
- District/function:
- In-world purpose:
- Traversal role:
- Mood:
- Landmark:
- Unique topology:
- Critical route:
- Optional route:
- Local walkable tiers relative to `baseElevation`:
- Required internal transfers:
- Intended platform/jump actions:
- Fall landing and recovery:
- Sockets:
- Compatible connector families/directions:
- Required clearances:
- Required control/reward/discovery/safe anchors:
- Encounter bounds and spawn exclusions:
- Hazard volumes and stable states:
- Support and railing strategy:
- Enclosure/void-occlusion strategy:
- Collision fixtures:
- Camera fixtures:
- Minimap footprint:
- Environmental story:
- LOD/performance budget:
- Validation cases:
```

## Connector coverage matrix

Complete this matrix for the family:

| Shared family | Level / signed delta | Ascending skin | Descending skin | Both endpoints recall/recovery | Dimensions pass | Visual QA | Automated test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Level service gallery | `0 m` | N/A | N/A | N/A |  |  |  |
| Switchback slope | `+14 / -14 m` |  |  |  |  |  |  |
| Ladder | `+14 / -14 m` |  |  |  |  |  |  |
| Automatic lift | `+14 / -14 m` |  |  |  |  |  |  |

Add rows only for connector families genuinely supported by the current normative generator contract. Theme names belong in the skin columns; they do not replace the shared gameplay family.
