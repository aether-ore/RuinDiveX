# RuinDiveX Three.js Current-State Review

**Review date:** 2026-07-20  
**Repository:** `aether-ore/RuinDiveX`  
**Reviewed branch:** `new-dungeon-generation-snapshot-20260709`  
**Latest reviewed commit:** `29d97711e699a4b17e14b4c02cb842c28292c484` (2026-07-18)

## Verdict

RuinDiveX is well beyond a minimal combat prototype. Its current strengths are combat breadth, deterministic procedural Reaverbots, fixed-purpose equipment, keycard progression, shared traversal limits, industrial room metadata, and an authored vertical boss environment that demonstrates the movement system can support much stronger level design.

The ordinary dungeon remains the limiting system. Its presentation and individual authored setpieces are considerably better than its route structure. Most expeditions still follow a stable main-room chain with stable side rooms, and ordinary rooms remain primarily combat containers. The 15-archetype metadata catalog describes a richer generator than the instantiated topology currently delivers.

## What is already strong

- `IndustrialRoomArchetypes.js` is data-only and describes 15 industrial archetypes with purposes, moods, topology variants, required features, puzzles, rewards, verticality options, and matched exit rules.
- `TraversalCapabilities.js` gives the player and generator one movement envelope: 1.65-unit jump height, approximately 2.74-unit maximum horizontal jump, 3.56-unit ledge-climb rise, 6-unit safe drop, 1.2-unit minimum landing, and 1.35-unit minimum catwalk.
- Generated keys, doors, encounter positions, mechanisms, chests, and shrine access are validated before a dungeon is accepted.
- The procedural Reaverbot system is more mature than the room system and provides an appropriate model for stable IDs, compatibility rules, seeded variants, and validation.
- `Game.js` already supports registered dynamic platforms and ledge candidates. The Vertical Transit Reliquary proves moving routes, checkpoints, staged ascent, and authored fall handling are possible in the current runtime.
- The existing texture and industrial-prop language is coherent. The project does not need a wholesale environmental-art replacement.

## Current room-system blockers

### Imported GLB rooms are disabled

`DungeonGenerator.js` references only three room GLBs:

- `alien_server_room_example.glb`
- `industrial_machine_factory_room.glb`
- `industrial_coolant_relay_puzzle_room.glb`

However, `ENABLE_IMPORTED_GLB_ROOMS` is currently `false`, so the procedural fallback remains authoritative.

### The importer cannot correctly place lower playable floors

The current loader scales a model from its aggregate X/Z bounds, recenters it, and raises `bounds.min.y` to the room origin. That works for a decorative setpiece resting on one floor. It breaks a room whose entry is at `Y = 0` and whose Waterworks or Undercroft extends below the entrance.

Room placement must use a named entry socket. Aggregate bounds must be used for overlap rejection only, not as the origin.

### Collision is inferred too broadly

The current imported-model collision pass creates AABB obstacles from many visible mesh bounds. This is not precise enough for catwalks, stairs, rails, angled machinery, hazard borders, overhead fixtures, or multi-level rooms. It can turn visible structures into oversized invisible walls.

The new room pack therefore provides explicit collision volumes in JSON manifests and semantic extras on nodes.

### Shell ownership is split

The current loader hides imported floor slabs and walls, retaining the generated room shell. That can remain a temporary presentation-only mode, but complete authored rooms require one clear owner for walls, ceilings, apertures, socket caps, lower catchments, and camera enclosure.

### Metadata is ahead of topology

The current room catalog already describes vertical server shafts, flooded lower works, multi-tier reactors, maintenance shafts, hazard rooms, and mini-dungeons. Ordinary generation still begins from a mostly stable progression chain and specializes geometry by room ID. The next generator should select authored multi-region compositions from those contracts instead of adding more geometry switches to `DungeonGenerator.js`.

## Recommended integration order for this pack

1. Add a new semantic room-module loader without changing the production generator.
2. Load each GLB in the existing `roomPreview` route.
3. Place the module from its `SOCKET_ENTRY_*` node at authored scale; do not recenter from bounds.
4. Create collision from `collisionVolumes` in the matching manifest.
5. Bind `SOCKET_`, `REGION_`, `ANCHOR_`, `MECH_`, `FLUID_`, and `HAZARD_` nodes.
6. Validate the four rooms as a fixed golden complex.
7. Add socket compatibility and environment-state validation.
8. Only then allow the procedural planner to select these modules.

## Pack contribution

The included modules address four currently missing spatial roles:

- A room-scale Factory mechanism that connects exits at multiple elevations.
- A Waterworks room with a solid lower basin, flooded and drained discoveries, a permanent return, and a high-jump route.
- A Magma Undercroft that remains an explorable area with a damage-free critical path and optional heat-resistance branch.
- An Electrical Undercroft with a permanently safe route, cycling panels, grounding controls, reward timing, and an upper shortcut.

These assets are deliberately not generic corridor replacements. Each one contains several regions and is intended to occupy a meaningful macro beat in the dungeon graph.
