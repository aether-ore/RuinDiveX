# Dungeon Generation V2 Restart Failure Audit

## Quarantine boundary

The discarded implementation is preserved on `codex/quarantine-dungeon-gen-v2-20260719` at commit `cad702d`. Nothing from that branch is an implementation dependency of the restart. The original requirements document is restored separately because it is the product specification, not part of the failed implementation.

`DungeonGenerator.js` remains the production generator and V1 reference. Existing V1 browser tests are regression probes only; tests that teleport, call private methods, or inject progression state cannot satisfy a V2 acceptance gate.

## Why the prior V2 produced false confidence

The restart also exposed a subtler false positive: component and traversal-lab journeys were being described as end-to-end evidence while the actual seeded golden route was not required to challenge a closed credential gate. A test that opens a gate before its first crossing cannot detect a vaultable barrier, an unreachable activation side, or a progression route that is physically blocked.

- Its fixed eighteen-node graph and generic chamber factory produced nominally different rooms with the same square, cardinal, wall-centred topology.
- Module selection happened inside a two-dimensional grid before spatial composition. Repeated descriptors and repeated D4-equivalent room topology were unavoidable.
- The scene assembler invented floors, ramps, props, and connector slabs that were not owned by the accepted plan. Abstract reachability therefore did not describe the space the player collided with.
- Enclosure was inferred from declared bounds or mesh naming. Tests did not prove that assembled walls, ceilings, portal seams, lower views, and colliders formed a closed playable volume.
- Browser “journeys” wrote player positions, cleared enemies, and invoked private key, door, shrine, and extraction methods. They proved internal state transitions, not player solvability.
- Self-parity checks compared one V2 abstraction with another V2 abstraction. They did not use public input, real combat, collision, camera clearance, or a complete spawn-to-extraction trace.
- Portal-clearance checks discarded every collider labelled `floor`. That made a vertical lift shaft appear clear even when the room's independently assembled walkable floor was a solid slab across the aperture. Lift acceptance now inspects every active collider and opaque triangle through the complete platform-and-rider sweep, exercises the real controller at 60 Hz, and rejects any correction, support loss, or safeguard activation.
- Automatic-lift tests checked only stable endpoint records. They did not prove that a locked hatch prevented departure, that an opened hatch visually retracted, or that the full transit path remained clear. The seeded golden checks now enforce all three conditions for the Beta and Gamma return lifts.
- Correctness-only fixture checks placed no bound on assembled draw objects, collision-query candidates, or actual browser frame cadence. A dungeon could therefore be nominally valid while producing severe play-time lag.
- Stair tests checked labels and broad bounds rather than the exact lower-deck top, upper-deck top, usable seam width, continuous collision height, and public-input walk. This admitted floating, misaligned, and ledge-climb-inducing staircases.
- The restart initially treated a descriptor's `sourceMaterial` note as sufficient V1 reuse while rendering flat V2 boxes. Documentation is not reuse: the proven V1 ruin textures, industrial machinery, credential pyramid, server/factory/coolant sets, warehouse language, and shrine construction must supply the V2 presentation layer.

## V1 reuse and performance diagnosis

The visual and performance regressions were separate defects. The previous V2 material bridge explicitly discarded texture references, so V1 asset-family labels resolved to untextured boxes. At the same time, collision and camera containment scanned nearly the complete zone list, repeated structure submitted excessive shadow draws, and structural ray audits ran continuously during ordinary play.

The restart keeps V2's accepted plan as collision authority while resolving that plan through the real V1 ruin texture catalog and V1-derived multipart machinery recipes. Spatial bins, receiver-only shadow policy for repeated structure, distance-safe render groups, and opt-in structural ray audits address runtime cost without removing authored art. Current measured checkpoints are:

- Traversal lab browser smoke: 257 renderer calls, 11,663 rendered triangles, 19 current-frustum shadow casters, with collision/camera candidate tests below 4% of their brute-force equivalents.
- Rejected transitional golden texture bridge: 3,048 assembled meshes, 56,902 triangles, 66 global shadow casters, 12 shared V1 textures, 23 shared materials, and 24 shared geometries. This checkpoint demonstrated that texturing generic V2 boxes and scaling generic prefabs was neither V1-room reuse nor an acceptable draw-object workload.
- The public-input performance test body passes its frame-heartbeat, draw-call, triangle, shadow, spatial-query, culling-distance, and runtime-error assertions. The Windows Playwright command still requires a separate teardown fix because its process remains open after reporting the passing test.

## V1 room-module restart decision

The individual V1 rooms are accepted source chambers; their fixed chain is not. V2 therefore transcribes the V1 room-local floor topology, catwalks, ramps, machinery anchors, visible occupied volumes, textures, and collision policy into immutable room modules. It must never substitute a generic rectangular chamber merely because a descriptor carries a V1 material or asset-family label.

The first catalog contains eleven topology-unique V1 source rooms and seventeen semantic exploration regions. A golden composition may place each room module only once, at native scale, using translation and quarter-turn yaw. The planner owns new off-centre ground openings, elevated catwalk openings, service ladders, recallable cargo lifts, pipe-to-Waterworks breaches, and intentional drops into playable lower areas. These sockets replace V1's fixed ordering; they do not erase or flatten each room's authored internal layout.

Every reachable V1 fixture requires a visible native recipe and a matching tight collider. `reserved-only`, a broad aggregate box, or a mesh-name-derived collider cannot be used to hide an unimplemented prop. Frames and arches collide only on their visible columns, presses expose only their physical legs, and robot arms use base-only collision. An unused socket remains an opaque wall or ceiling cap.

## Restart rules

`test:dungeon-v2:journey` is reserved for default seeded golden levels, never `v2Fixture=traversal-lab`. It must challenge, collect, legally open, and physically cross Alpha, Beta, Gamma, and Shrine in sequence before extraction. Traversal-lab components run separately under `test:dungeon-v2:fixture-journey`; focused checks on real seeds run under `test:dungeon-v2:seeded-fixture-journey`. Neither fixture class can prove dungeon solvability.

The first audited seeded golden runs did not pass. The initial run challenged Alpha while it was still closed, then exposed a physically sealed Security-to-Assembly connector elbow before any key was collected or progression gate was crossed; that connector defect is now fixed and has a production-capsule regression. The next run reached Assembly but remained red at its required real-combat encounter: public fire failed to damage either encounter-owned enemy before the timeout. These are genuine end-to-end failures, not fixture passes or evidence of later progression. Until the public-input run reaches extraction for both hazard variants, Milestone 1 remains incomplete.

- A fixture is not accepted until it passes the shared `assertAcceptedDungeonFixture` gate appropriate to its stage.
- All six faces of every interior cell must resolve to a solid structural boundary or a paired, framed portal. Fog, clear colour, decorative meshes, and invisible backstops do not count.
- Every visible lower area belongs to a registered playable region with a damage-free landing and a physical return route. Bottomless space is forbidden.
- Every structural plan ID must resolve to both visual and collision registrations, with sampled parity at `0.21m` or finer for assembled fixtures.
- Every stair must terminate flush against both authored deck tops within `0.05m`, overlap each deck by a usable `1.2m`-wide seam, and remain continuous at `0.21m` sampling or finer. A graph link or nearby bounding box is not a physical connection.
- Every authored interaction is one serializable action shared by validation and runtime. A console, pickup, gate, encounter completion, reward, objective, or mechanism transition without that action is incomplete.
- Golden-complex presentation must resolve explicit V1-derived asset-family IDs through a reusable V2 asset kit. Plan-owned colliders and interactions remain authoritative; imported mesh names can never invent behavior or collision.
- V1-derived visual modules must be batched or merged where possible. Loading hundreds of source submeshes as independent draw objects is not acceptable asset reuse and fails the runtime workload gate.
- Landmark labels and topology-signature strings are not evidence of spatial quality. A landmark must be a connected compound of at least three playable non-connector cells or subregions, cross at least two elevation bands, expose multiple internal route forms, and contain multiple functional machinery fixtures.
- Dynamic platforms and raised walkable surfaces require registered, colliding support fixtures. A support-profile string or decorative brace cannot satisfy physical support.
- Golden-complex journeys use public keyboard and mouse input, normal interactions, and real combat. Diagnostics are deep-cloned and read-only.
- V2 performance acceptance measures actual animation-frame cadence, draw workload, and spatially bounded collision/camera queries while the public-input journey is moving. A fixed-step heartbeat alone cannot demonstrate acceptable frame pacing.
- A skipped or unavailable journey is an explicit incomplete milestone, never a pass. Generator self-validation cannot replace the browser journey.
- Procedural composition remains blocked until both golden hazard variants pass the full journey with zero safeguard activations.

## Prohibited acceptance shortcuts

V2 journey sources are automatically rejected for private method calls, direct player/camera position writes, state injection, enemy clearing, preview teleports, direct generator/assembler imports, or access to the live game object. The only browser-side inspection surface is the frozen `window.__RUINDIVEX_V2_DIAGNOSTICS__.snapshot()` bridge.
