# RuinDiveX Procedural Dungeon Style Guide

Status: current Three.js generation baseline, including signed room elevations, bidirectional connector variants, automatic lifts, ladders, switchback slopes, and connector track traps.

This guide defines how additional dungeon themes should be authored and assembled. It deliberately describes rooms by function and topology rather than by names from any existing dungeon.

It applies to standard procedurally composed dungeon interiors. The overworld and one-off authored boss environments remain outside this contract unless they explicitly opt into it. The current room ordering is also not a template that future themes must copy.

## 1. Core experience

A RuinDiveX dungeon is an exploration space first and a combat space second. It should feel like a connected underground complex with recognizable functions, layered routes, concealed rewards, hazards, and meaningful returns—not a sequence of small fight boxes joined by narrow hallways.

Every generated dungeon must follow these principles:

- Preserve authored chamber quality. Generation rearranges compatible authored modules and connectors; it does not replace them with primitive fallback boxes.
- Give every chamber a clear in-world function, such as processing, storage, control, transport, maintenance, habitation, containment, ritual, or extraction.
- Make elevation part of the route story. Upper and lower areas must be real, navigable spaces rather than scenery.
- Reward observation and route mastery with treasure, discoveries, shortcuts, puzzles, and optional danger.
- Keep permanent traversal independent of unrelated ordinary encounters. Combat may guard a deliberate reward or event, but should not silently lock a required control or exit.
- Never expose an exterior void. Every visible lower area is either playable or physically occluded by authored structure.
- Never use a bottomless fall. An intentional fall lands in a playable sub-zone with a damage-free return route.

## 2. Current generation model

The current standard generator uses an authored-room library plus deterministic connector variation.

1. Select the room graph and preserve the authored room interiors.
2. Reserve collision-free connector footprints.
3. Select level and elevation-changing connector families.
4. Propagate signed room elevations through the directed graph.
5. Reject conflicting elevations, overlaps, insufficient clearances, or invalid family coverage.
6. Assemble rooms, connectors, boundaries, mechanisms, collision, minimap data, encounters, and diagnostics from the accepted contracts.

New themes should provide their own room and presentation assets while conforming to the same spatial, traversal, progression, and validation contracts.

### Graph composition for new themes

The present connector system can operate on an authored graph, but a future theme's graph should not be an uninterrupted hallway chain.

- Build the route from chambers and sub-zones, not from corridor length.
- Include an optional branch, a permanent shortcut or return loop, and at least one calm navigation space when the graph budget permits.
- Use connectors to change level, reveal a new side of an earlier space, or complete a loop. Do not add elevation transfers that lead only to an empty landing.
- Avoid consecutive reuse of the same connector family when another legal family exists.
- Do not repeat the same playable room topology in one dungeon. Cosmetic or prop substitutions alone do not make a repeated topology distinct.
- Preserve stable progression semantics across seeds while allowing room order, branch attachment, connector family, direction, and landmark relationships to vary.

### Theme pack responsibilities

A theme pack supplies:

- Authored room modules with stable IDs and topology revisions.
- A functional purpose, traversal role, mood, landmark language, and environmental story for every module.
- Signed-elevation sockets with facing, width, height, connector compatibility, and clearance data.
- A themed skin for each required connector family.
- Wall, ceiling, floor, ramp, stair, catwalk, railing, support, door, and socket-cap assets.
- Repeating material sets whose UV scale is defined in world metres.
- Props with matching visual and collision footprints.
- Encounter, reward, control, discovery, and safe-anchor placements.
- Hazard and mechanism presentation that preserves the shared gameplay timings.
- Enclosure, support, walkability, camera, minimap, and performance fixtures.

Theme art may change. Traversal dimensions and gameplay semantics may not be weakened to fit the art.

## 3. World scale and coordinates

The connector baseline uses a `2.8 m` horizontal tile.

| Contract | Current requirement |
| --- | ---: |
| Standard elevation transfer | `14 m` exactly |
| Minimum continuous connector width | `3 tiles / 8.4 m` |
| Minimum connector path | `9 tiles` |
| Minimum general straight run | `7 tiles` |
| Minimum slope straight run | `13 tiles` |
| Minimum lift straight run | `10 tiles` |
| Endpoint flat buffer | `2 tiles` |
| Minimum clear landing | `8.4 × 8.4 m` |
| Minimum player headroom | `3.6 m` |
| Minimum ladder aperture | `2.4 × 2.8 m` |
| Maximum dungeon vertical span | `56 m` |
| Maximum elevation transfers on one root-to-leaf route | `4` |

All authored room Y values are local to `baseElevation`. Assembly must translate floors, ceilings, walls, props, mechanisms, pickups, encounters, collision, minimap markers, and extraction anchors together.

Each room exposes absolute `baseElevation`, `minY`, `maxY`, and `ceilingY`. Each connector exposes `sourceElevation`, `destinationElevation`, signed `elevationDelta`, `direction`, `higherEndpoint`, and `lowerEndpoint`.

Floor identities must include horizontal coordinates and absolute elevation. A support layer above another room must never alias the lower floor or pull the player down through a ceiling.

## 4. Dungeon-wide elevation composition

For a standard full dungeon:

- Select `3–5` elevation-changing connectors.
- Include at least one switchback slope, one ladder, and one automatic lift.
- Place the mandatory slope, ladder, and lift on progression routes.
- Include at least one ascending and one descending progression connector.
- Prefer the optional fourth and fifth elevation transfers on optional branches.
- Keep all signed room elevations within a `56 m` total span.
- Permit rooms below the entrance elevation.
- Reject graph merges that assign conflicting elevations to the same room.
- Never silently flatten or reverse a selected elevation connector.

All remaining compatible connections use level service galleries with an explicit `0 m` elevation delta. Same-elevation corridors remain an important part of pacing and must coexist with vertical connectors.

Parallel upper-catwalk alternatives remain level. They must not receive an elevation transfer simply because the room pair also has a ground route.

## 5. Shared connector rules

Every connector family must satisfy the following:

- Preserve both endpoint sockets and align the destination floor, landing, threshold, and room entrance within `0.05 m`.
- Remain at least three tiles wide for its full traversable length. One-tile choke points are not permitted.
- Remain physically traversable in both directions, regardless of progression direction.
- Provide clear, prop-free endpoint landings and mechanism landings.
- Reserve player headroom, mechanism sweep, aperture, structure, camera, and collision volumes before assembly.
- Remain fully enclosed by walls and ceilings in every stable mechanism state.
- Use visible supports under every walkable elevated surface.
- Use railings where a fall is not an authored route.
- Continue the theme's decorative arch or framing rhythm across the connector, including elevation transitions.
- Keep doors, controls, recall stations, props, and decorative arches out of required movement and mechanism-clearance volumes.
- Remove any floor or ceiling tile that would cover a declared ladder or lift aperture.

In the current industrial presentation, structural arches appear at a maximum spacing of three tiles. Other themes may replace the shape language, but must preserve equivalent rhythm, enclosure, clearance, and route readability.

## 6. Connector families

### 6.1 Level service gallery

The level gallery is the default same-elevation connection.

- `elevationDelta` is always `0` and `direction` is `level`.
- The source and destination rooms keep the same base elevation.
- The gallery is three tiles wide, with supported catwalk construction, railings, side utility alcoves, and overhead service detail outside the player-clearance envelope.
- It retains the established authored corridor language for the theme; it must not become a naked slab or featureless tunnel.
- A level gallery never receives a vertical offset merely to increase variety.

### 6.2 Switchback slope

The slope transfers exactly `14 m` using two separate flights.

- Each flight contains `13` ramp segments and changes elevation by `7 m`.
- The absolute rise per segment is approximately `0.538462 m`.
- Both flights are three tiles wide.
- The return flight faces the opposite direction and occupies a separate horizontal plane.
- Flight centerlines are separated by three tiles; overlapping ramps in the same X/Z plane are invalid.
- The switchback and arrival landings are at least `3 × 3` tiles; the current assembly gives the turn extra depth where required.
- Ramp surfaces are continuous with their landings, visibly supported, and clad with tiled—not stretched—materials.
- No unrelated floor tile may float directly over a ramp.
- A slope leads to a destination room at its final elevation; it does not descend back to its origin as decorative geometry.

### 6.3 Ladder transfer

The ladder uses one clear `14 m` shaft.

- Ascending routes approach the lower mount; descending routes approach a visible, guard-railed upper aperture.
- Both ends provide a clear `3 × 3`-tile landing.
- The opening remains uncovered at every stable state.
- The ladder mounts from both ends, snaps the player to the ladder plane, aligns facing, uses the climbing animation, and exits cleanly at top and bottom.
- Preserve at least `2.1 m` of clear dismount distance.
- No prop, wall lip, railing, or floor edge may trap the player after dismount.
- The upper opening must be visible before the player steps onto it.
- The lower landing must be a real playable destination, not an exterior shaft backdrop.

### 6.4 Automatic lift

The lift uses a single `14 m` automatic shuttle.

- Car dimensions are at least `8.4 × 8.4 m`.
- Shaft dimensions are at least `11.2 × 11.2 m`.
- Rider clearance is at least `3.6 m`; the current shaft closes above the upper landing with additional headroom.
- The car begins at the progression-source landing: bottom for an ascending route and top for a descending route.
- It runs as an automatic continuous shuttle at `1.8 m/s` with a `1.25 s` landing dwell.
- Both landings have recall controls, even though ordinary travel does not require a console.
- Recall controls sit beside the landing, outside the walkway and outside the car footprint.
- Supported flush sills bridge each landing to the car. There may be no gap, ceiling obstruction, or mismatched threshold.
- The full car-and-rider swept volume remains clear.
- The lift carries a supported player through the existing dynamic-platform system.
- There is no redundant return ramp. The lift itself remains usable in both directions.

## 7. Connector hazard alternate

Elevation connectors may receive a deterministic ceiling-track trap overlay.

### Selection

- Trap no more than `40%` of elevation connectors.
- Include at least one trapped alternate when a legal bay exists and the percentage cap permits it.
- Never trap consecutive graph edges.
- Place `1–3` traps in a selected connector.
- Separate trap bays by at least three longitudinal tiles.
- Prefer a legal flat bay on the destination-side approach.
- Never place a trap over a door, turn, slope, ladder aperture, lift shaft, control, landing, decorative arch, or reserved clearance volume.

### Presentation and behavior

- The track crosses the connector transversely and includes visible ceiling rails, supports, end stops, and floor warning bands.
- Warning volumes are specific to the connector's floor elevation. A player on a vertically adjacent floor must not activate the trap.
- The rotor has a normalized `2.2 m` diameter and spins at `3.2 rad/s`.
- Patrol speed is `0.7 m/s`.
- While the player occupies that trap's warning band, travel speed becomes `3.2 m/s`.
- Alerting never reverses the current direction. Reversal occurs only at a physical track endpoint.
- Movement and contact use reflected analytic motion plus swept collision so results do not change with frame size.
- Contact deals `12` unguardable mechanical damage, reaction tier `2`, and `0.72` push strength along the travel direction.
- Each trap has a `0.8 s` individual rearm cooldown.
- Dodge invulnerability remains effective.
- Only the player activates and receives damage from this connector hazard.
- A missing visual asset fails acceptance and disables damaging contact; an invisible damaging trap is forbidden.

Themes may reskin the device, but the track, warning, timing, collision, and damage semantics remain legible and equivalent.

## 8. Room authoring and exploration structure

Rooms should be large enough to express a function, not just hold an encounter. A primary chamber should normally contain several readable sub-regions, multiple elevations, machinery landmarks, and more than one reason to enter.

Each authored module declares:

- Functional purpose and environmental story.
- Main route, optional route, reward route, and return-route anchors.
- Floor tiers, ceiling envelope, structural boundaries, and occupied volumes.
- Connector sockets in more than one placement bucket and, across the theme pack, more than one elevation band.
- Supported walkable surfaces with an explicit gameplay purpose.
- Prop and machinery collision footprints.
- Encounter zones that do not consume permanent controls or escape routes.
- Reward anchors on safe, non-harmful surfaces.
- Camera-clear spaces at traversal transitions.

Avoid repeated topology disguised by prop swaps. A distinct module changes meaningful adjacency, elevation, portal placement, route choice, mechanism, hazard, or fall structure.

### Exploration progression

For credential- or objective-gated dungeons:

- Place the credential away from the gate it opens.
- Let the player explore a connected area before finding it.
- Provide a permanent shortcut or loop back toward the earlier gate.
- Give each gated area at least one sub-zone, puzzle, trap, traversal test, optional encounter, or discovery.
- Make a reached pickup collectible immediately unless a clearly communicated encounter lock is part of that pickup's authored contract.
- State any encounter lock in the objective text on entering the area.
- Do not require backtracking merely to make an already-reached pickup interactable.

## 9. Floors, stairs, platforms, and falls

- Ordinary stairs are smooth grounded traversal. Walking up them must not trigger repeated ledge-climb animations.
- Stair tops, ramps, connector landings, and room floors meet without a gap.
- Platform steps used for deliberate jumping are large enough for the player footprint, camera, and authored jump envelope.
- Elevated moving platforms connect useful landings. They do not slide pointlessly along the floor.
- Every moving platform is automatic or has reachable recall at every endpoint.
- Every walkable platform declares a gameplay purpose and visible support style.
- Reachable visible props have matching walkable or blocking collision.
- Decorative non-colliding props remain outside the player volume.
- Intentional openings declare an aperture, trajectory, catchment, safe anchor, and permanent return route.
- A view downward may reveal only registered playable space with adequate landing width and headroom.
- Physics recovery is a last-resort safeguard, never a substitute for authored fall design.

## 10. Enclosure and structural truth

Every room, connector, shaft, and mechanism state is a closed spatial volume.

- Every traversable cell has exactly one appropriate ceiling.
- Every exposed side is covered by a wall, structural boundary, or paired portal.
- Height discontinuities receive walls from the lower boundary to the upper boundary.
- Connector seams are closed in render geometry and collision.
- Visual walls and collision walls agree; neither invisible blockers nor visual-only barriers are acceptable.
- Transparent decoration, fog, darkness, or a world-sized underlay may not conceal missing structure.
- Downward openings exist only where a registered ladder, lift, intentional drop, or playable lower space requires them.
- Structural boundaries register grounded, aerial, camera, and knockback collision as appropriate.

## 11. Collision, camera, and signed-elevation gameplay

All runtime systems must treat elevation as local-to-owner or queried-from-support, never as an assumption that the dungeon floor is at world Y `0`.

- Player and enemy weapon origins use `actorRootY + localOffset` minimums.
- Ground effects use `queriedSurfaceY + localOffset`.
- Projectiles retain signed `baseY` and `endY` values.
- Enemy navigation, aim, hit effects, death landings, pickups, and hazards query the correct support layer.
- Ground correction selects a connected compatible support, not simply the highest or lowest floor at the same X/Z.
- An upper walkway above a lower room must not pull the player to the lower floor.
- Camera occlusion tests the segment from camera to player against the active world root. The occluding owner hides when it blocks that segment and restores immediately when clear.

Absolute clamps such as `origin.y = max(origin.y, 1)` or effects assigned to `y = 0.08` are forbidden in dungeon gameplay code. They break combat and presentation in subterranean rooms.

## 12. Materials and visual construction

- Reuse the established authored asset quality of the active theme.
- Tile floor, wall, ramp, and catwalk textures by world distance. Do not stretch one texture across a large surface.
- Use shared geometry and materials for repeated structural-kit pieces.
- Preserve proper catwalk decks, railings, posts, and cross-braces; large solid blocks are not an interchangeable substitute.
- Keep supports aligned with the surface they support and extend them to the owning floor or structure.
- Keep silhouettes readable: doors look passable, ladders look climbable, lift shafts look active, and hazards advertise their swept lane.
- Props enrich function and route reading. They must not obstruct portals, landings, controls, camera-clear zones, or primary walkways.
- Theme variation should come from authored topology, landmark machinery, materials, lighting, and environmental behavior—not random clutter.

## 13. Determinism and plan ownership

Generation decisions must be reproducible from the dungeon seed.

- Connector assignment uses stable connection identity and geometry.
- Room elevation propagation is completed before room assembly.
- Trap selection and initial motion state are deterministic.
- Planning contracts are serializable and renderer-free.
- Runtime mechanisms consume plan-owned dimensions, endpoints, clearances, and stable IDs.
- Failed assignments produce deterministic diagnostics and retry through bounded attempts.
- A rejected plan must not silently fall back to a primitive room, flat connector, or unrelated generator.

## 14. Validation and acceptance

### Unit and contract tests

Test at minimum:

- Deterministic `3–5` elevation-connector selection.
- Mandatory slope, ladder, and lift coverage.
- Ascending and descending coverage.
- Exact signed `±14 m` propagation, including rooms below world zero.
- Explicit `0 m` service-gallery connections.
- Merge-conflict rejection, four-transfer route limit, and `56 m` span limit.
- Socket, floor, landing, threshold, ceiling, and collision alignment.
- Slope segment count, grade, switchback separation, and support.
- Ladder aperture visibility, mount alignment, animation, and clear dismounts.
- Lift dimensions, source-end initialization, automatic travel, recall, flush sills, rider clearance, and frame-chunk invariance.
- Trap selection cap, non-consecutive placement, forbidden volumes, endpoint-only reversal, alert speed, swept contact, dodge, damage, and cooldown.
- Signed-elevation player and enemy aim, muzzle, projectile, and surface effects.
- Room-local render and collision translation at positive and negative elevations.

### Assembly tests

Force and assemble all seven required forms:

1. Level service gallery.
2. Ascending slope.
3. Descending slope.
4. Ascending ladder.
5. Descending ladder.
6. Ascending lift.
7. Descending lift.

For each, verify enclosure, width, supports, tiled materials, portal alignment, aperture clearance, camera clearance, and absence of visible void.

### Seed sweeps

- Use at least `100` deterministic seeds during active connector development.
- Use at least `1,000` deterministic seeds before a new theme becomes a production default.
- Reject missing connector families, missing direction coverage, excessive span, overlap, uncovered apertures, unsupported surfaces, exposed void, invalid floor snapping, or solver timeout.
- Record the seed, plan hash, selected connector IDs, elevation range, trap selection, validation duration, and diagnostic hash.

### Public-input journeys

Journey tests use actual generated seeds and ordinary keyboard and mouse input.

- Traverse every connector family forward and backward.
- Walk upper routes directly above lower rooms without floor warping.
- Descend below the entrance elevation and verify movement, camera, aim, visible projectiles, enemy combat, pickups, and effects.
- Complete at least one full seeded dungeon through its progression, final encounter, reward, and extraction.
- Do not teleport, write player position, mutate credentials, clear encounters through private methods, or inject completion state.

Private probes and mathematical fixtures are useful lower-level tests, but they never count as end-to-end acceptance.

## 15. Theme acceptance checklist

A new dungeon theme is ready only when all answers are yes:

- Are its rooms authored, functional, and topologically distinct?
- Does the composition prioritize exploration over mandatory combat?
- Are level corridors retained alongside `3–5` signed vertical transfers?
- Are slope, ladder, and lift families present on the main route?
- Are both ascent and descent represented?
- Is every connector three tiles wide, enclosed, supported, decorated, and clear?
- Do all landings align with their destination floors and portals?
- Are ladders visible and dismountable, and are lifts automatic and recallable?
- Are all lower views playable and all falls recoverable?
- Do textures tile consistently without stretching?
- Do reachable visuals have matching collision?
- Does combat work identically above, at, and below world zero?
- Do public-input seed journeys prove the dungeon can be completed?
- Does the theme meet performance and resource-disposal baselines without fallback geometry?

If any answer is no, the theme remains a development fixture and must not become a production generation option.
