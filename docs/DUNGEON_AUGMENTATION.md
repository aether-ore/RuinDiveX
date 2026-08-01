# Theme-Inheriting Dungeon Augmentation Sidecar

The V4 recovery status and the preserved historical 175-record backlog are maintained in [Dungeon Augmentation V4 Release-Issue Register](./DUNGEON_AUGMENTATION_V4_RELEASE_ISSUES.md). The current implemented validator reports zero errors for the canonical seed, but the stricter realized verifier finds a connector-ownership violation outside an authoritative seam. V4 release readiness is therefore **blocked**; the historical records remain as evidence and are not a release-closure claim.

## Current release readiness

- **Blocked:** the one-seed realized audit fails on route-network 3, segment 2 at `-7,63@y14.000`, where the connector centerline reuses a Through-T core floor outside its exact 3×5 seam.
- **Passing focused check:** all 28 authored blueprint identities, footprints, masks, sockets, and 16 executable entry-to-reconnect elevation modules pass their catalog contract suite.
- **Outstanding gates:** the strict 10/100/1,000 realized sweeps and ordinary-movement browser journeys have not passed. A zero-error result from the current canonical validator is not sufficient release evidence.
- **Debug-log classification:** the accumulated Chromium log contains GPU/SharedImage diagnostics but no dungeon, augmentation, or JavaScript exception. Those messages are a browser-capture stability concern, not the cause of the deterministic route failure.

## Scope and safety boundary

This subsystem belongs only to the Three.js project. It is an optional planning and assembly sidecar beside the existing authored dungeon generators; it is not a replacement for them.

Industrial V1 remains the authoritative owner of its base rooms, connections, gates, progression, and presentation. Augmentation is off by default. When the sidecar is disabled, not supported by a host, or rejected during planning or validation, the generator keeps the original parent draft. The disabled path enters before sidecar random-number generation, and the pure planning API returns the exact input draft reference for an unchanged result.

The immutable `industrial-supplement-preview-v1`, `-v2`, and `-v3` profiles remain available for committed-expedition reconstruction. New preview runs use `industrial-supplement-preview-v4` profile revision 5. V4 adds a required external loop through the two keycard-pyramid walls unused by the critical path and coverage networks along every overlong objective connector. It caps uninterrupted featureless traversal at 33.6 metres and selects from 28 authored physical blueprints: seven connector/junction/cycle kits, six baseline or local-content rooms, and fifteen additional elevation blueprints. Sixteen modules in total expose executable entry-to-reconnect elevation changes because the maintenance-rise module is also counted among the six local-content rooms. The exact connector set includes the 5x7 Through T, 7x7 Crossroads, 5x13 Staggered Cross, paired-T H loop, stacked interchange, and grade-separated over-under crossover. No Industrial preview relocates keys, objectives, authored gates, or the boss arena. Generic delegated-progression support exists in the core, but a parent must grant individual beat IDs explicitly; the Industrial previews grant none.

No neutral presentation and no Industrial presentation are fallback choices. Supplemental content must resolve every required material, asset, connector skin, transition frame, and local environment recipe through the theme session belonging to the parent region where it attaches. Missing capabilities reject the whole augmentation and leave a new run unaugmented.

## Opting in

Normal launches remain unaugmented. The Industrial preview can be enabled for a new browser run with any of these equivalent query values:

```text
?dungeonAugmentation=preview
?dungeonAugmentation=1
?dungeonAugmentation=true
?dungeonAugmentation=on
?dungeonAugmentation=2
?dungeonAugmentation=3
?dungeonAugmentation=4
?dungeonAugmentation=expanded
?dungeonAugmentation=industrial-supplement-preview-v4
```

The explicit V1, V2, and V3 IDs select those historical profiles for compatibility testing. A committed expedition remains on its saved profile regardless of the current URL alias.

For reproducible development runs, combine the flag with an authored layout seed:

```text
?dungeonSeed=augmentation-realized-v4-000&dungeonAugmentation=industrial-supplement-preview-v4
```

A committed expedition overrides the URL seed and augmentation profile. To inspect a new deterministic V4 layout, first abandon or explicitly reset the committed expedition; adding query parameters cannot mutate its saved dungeon identity.

Ordinary V4 requests are release-authoritative. `DungeonGenerator` defaults `allowInvalidAugmentationPreview` to `false`, and an invalid overlay atomically returns the unchanged accepted parent dungeon. The browser enables that option only when the exact V4 profile is present together with `dungeonAugmentationAlpha=1`; the alpha flag cannot affect V1-V3 or an absent/unknown profile. Invulnerability is independent and requires `playerInvulnerable=1`.

`dungeonAugmentation=off`, `0`, `disabled`, `none`, an absent value, or an unknown profile keeps the feature disabled. A committed expedition's saved augmentation identity takes precedence over the URL: a legacy unaugmented expedition cannot acquire generated rooms when it resumes, and an augmented expedition cannot silently lose them.

## Planning model

The public renderer-free entry point is:

```js
augmentDungeonDraft({
  baseDraft,
  extensionRegions,
  profileId,
  layoutSeed,
  augmentationSeed, // optional explicit replay/save seed
  difficulty,
  profiles,
  grammars,
  themeCapabilitiesByRegionId,
})
```

It returns `status: 'applied'` with a frozen overlay and a copied effective draft, or `status: 'unchanged'` with diagnostics and the original parent draft. Plans contain serializable data only; never Three.js objects or functions. The augmentation seed is derived independently from the layout seed, canonical base-draft fingerprint, parent-region identity, and profile. It does not consume the legacy generator's random stream.

The planner supports four graph operations:

- `optionalBranch` attaches a bounded tree or loop to a registered socket and must preserve a return route.
- `edgePadding` replaces the physical realization of an eligible edge with namespaced supplemental segments while preserving the original logical edge ID, gate, credential, tier, and dominance boundary.
- `routeNetwork` binds two or more exact parent-granted sockets into a same-domain loop, multi-door coverage network, landmark perimeter route, or explicitly gated cross-band shortcut.
- `delegatedProgression` may place only progression beat IDs explicitly delegated by the parent host. This operation is disabled in the Industrial preview.

V4 measures accumulated centerline distance through ordinary turns and degree-two corridor chains. Cosmetic props, gates, empty bays, and capped sockets do not reset the 33.6-metre limit. A qualifying station must expose a real route choice, substantive content, or an elevation transition. Every coverage network reconnects through at least two active apertures, supplies three to six meaningful modules, and contains a challenge, distinct payoff, vertical traversal, and meaningful junction.

V4 distinguishes curated gameplay rooms from compact connector junctions and does not generate endpoint vestibule rooms. Every blueprint owns its exact non-rectangular base mask, optional upper mask, three-tile sockets, route polylines, zones, features, voids, and physical transfer records; footprints range from narrow service rises to the 15x11 paired-T cycle rather than reusing one rectangular shell. Networks are budgeted by meaningful modules rather than a fixed room count. Exact parent apertures connect through physical three-tile corridors to the network. Adjacent exact station junctions may instead use a short positive corridor whose two-tile approaches are proven inside their owning cores. Only exactly coincident, oppositely facing station apertures may use a typed `shared-junction-threshold`: it owns one exact 8.4-by-2.8-metre aperture footprint, two bound 5.6-metre node-local approach witnesses, and no corridor, clearance, or landing volume. A compact form is promoted to a meaningful `supplementConnectorJunction` only when at least three physically assembled, bidirectionally traversable approaches survive validation. Degree-two forms remain connector infrastructure and cannot masquerade as rooms, encounters, rewards, or qualifying junctions. The over-under blueprint retains two port-level connectivity groups and is never promoted as an at-grade junction; the stacked interchange joins its groups only through its declared lift.

Required networks are solved as one deterministic reservation problem in this order: pyramid loop, mandatory coverage networks, optional same-band loops, then explicitly granted cross-band shortcuts. Topology, junction, elevation, encounter, and room-layout families each use an immutable exhaustion bag driven by its own isolated RNG fork. Solver state carries each bag's deterministic order, cycle, and consumed IDs; failed branches leave the parent state unchanged, successful choices are consumed only with the accepted network, and a bag refills only after every currently legal family has been exhausted. Every accepted route network records those choices in its `selectionManifest`, together with a normalized semantic signature and per-family `bagWitnesses`; realized release records flatten and serialize the witnesses so replay and corpus evidence can verify legal selection, refill, state continuity, and declaration parity. The solver places a complete topology graph against the shared 2.8-metre planning grid with bounded backtracking; accepting one network reserves its exact geometry for every later branch, while failure of a later required grant backtracks earlier choices instead of silently overcommitting space.

Industrial V4 physical geometry resolves through `IndustrialSupplementBlueprintCatalog`; the planner canonicalizes each blueprint's entry orientation while preserving its authored mask and socket elevations, and the materializer projects those same records into floors, walls, collisions, navigation, anchors, and diagnostics. `IndustrialSupplementContent` remains the semantic recipe layer for challenge, hazard/control, vertical-maintenance, reward-vault, and calm/discovery behavior. Encounter recipes reuse the existing Reaverbot roster with topology-aware threat budgets and frontline/flank/perch placement. Rewards are explicitly non-progression-critical, and controls are namespaced to their room or route-network operation; they never invoke the legacy global hazard override.

Delegated progression is solved against the effective graph, not assigned by room index. The parent-supplied prerequisite graph is topologically ordered, candidate anchors are checked against actual reachability, and a delegated gate may be placed only on a segment whose dominance preserves the required key-before-gate route. Cycles, undelegated beats, reused gates, bypasses, or a graph with no solvable assignment reject the complete overlay. This generic path is exercised by fixtures but remains disabled in every Industrial preview profile.

Planning and validation finish before `DungeonSupplementAssembler` creates Three.js objects. Collision validation uses one combined effective-layout set containing authored occupied/clearance volumes and every selected supplemental room, segment, landing, and transition volume, regardless of which theme owns the presentation. Cross-theme content therefore cannot pass by validating each theme in isolation.

Industrial additionally materializes the overlay into renderer-free tile/connector records and preflights the whole realized seed before creating a mesh or material. Every supplemental connector mouth must have threshold and exterior support, fit the complete player collision/head/step envelope, and be reachable bidirectionally from the dungeon start. Traversal edges are swept against the realized solid barriers, including thin wall strips and door wings; connected floor-cell centers alone are not considered proof of walkability. Wall generation reserves each connector's exact declared lane count, subtracts those horizontal and vertical apertures from boundary runs and nearby authored door-threshold wings, and preserves the padded edge's own logical gate rather than carving a bypass through it. A failure anywhere rejects the entire overlay and returns the unchanged accepted parent.

Each V4 socket seam is one authoritative record spanning all three threshold lanes plus two clear approach tiles on both sides. Its exact floor-cell identities drive apertures, wall exclusions, collision, navigation, and diagnostics. Shared ownership is permitted only inside that seam; a connector cannot claim a foreign room floor or merge unrelated physical owners elsewhere. Layered realization keys ownership by X/Z and contracted elevation, so a valid overpass can coexist with an authored floor in the same map column without either layer inheriting the other's owner.

Blueprint walkable intent is the authored tier-floor set minus declared voids, support-only cells, and blocking feature footprints. Machinery and cover remain legitimate content, but required socket approaches, clear routes, encounter lanes, transfers, mechanisms, and rewards must stay in one collision-derived bidirectional component. Ramps use the shared 0.55-metre step envelope and at least six intervals for a 2.8-metre rise, with flat landings and mirrored approach direction where declared. Ladder, lift, stair, and ramp endpoints bind to authoritative floor-cell IDs rather than approximate X/Z coordinates.

Presentation follows the owning generation contract. The five authored Industrial V1 connectors retain their established decorative arches. V4 supplemental routes instead emit theme-bound entrance, bend, junction, and interval structural frames from the same authoritative wall runs used by collision; missing frame coverage, clearance, enclosure, materials, or parent-theme bindings rejects the complete overlay. Encounter spawns, mechanisms, and rewards are selected only after floors, structures, hazards, and solid footprints are final, and deterministic reselection is limited to reachable same-owner cells on the declared tier.

V4's physical acceptance gate does not treat logical or graph-only records as geometry. Every ordinary route-network centerline cell must resolve to a floor owned by that exact physical connector at the centerline's contracted elevation, every navigable supplemental floor must belong to the start-reachable collision component, and every supplemental room must expose at least one exact physical socket. A typed shared threshold is the sole zero-corridor exception: realization maps its coincident world aperture to the two adjacent boundary cells owned by its junction cores, reserves both wall openings, and emits no ordinary gallery footprint or presentation. All three aperture lanes require two flat, hazard-free approach tiles on both sides with full headroom. Every supplemental room—not only degree-three junctions—is checked as one strongly connected local component across its own floors and exact connector thresholds: every floor and junction arm must be reachable from an entrance and able to return to it, so globally reachable floors from two unrelated routes cannot hide an internal wall, one-way pit, or disconnected platform. Connector-module floors are stamped only after their exact physical arms exist; degree-two modules require two accepted approaches, meaningful junctions require at least three, and every owned core tile must be clear, start-reachable, and returnable at its declared elevation. Stacked or over-under paths count only when both realized levels survive assembly and an explicit ramp, ladder, or lift joins them. A floorless ladder aperture or lift shaft is valid only when its exact upper/lower landings, barrier-clear shaft-mouth approaches, and named forward and reverse traversal links joining opposite landings exist. One-side shortcuts are tested both before and after activation, require a reachable far-side control, and cannot be credited as the route used to reach that control. An orphaned lower hallway, wrong-elevation underpass, overwritten X/Z route, decorative connector, broad shared-node overlap, wall opening from a graph-only record, or graph-only station link rejects the overlay instead of contributing to coverage or metrics.

Every locked logical gate is placed at the source-side entrance of its corridor, so the player learns that its encounter, credential, shrine, pressure-plate, or mechanism objective is incomplete before committing to a long connector. If a gated edge is padded, the source-most physical segment hosts the same parent-owned logical gate; its ID, objective authority, dominance boundary, and unlock behavior are unchanged.

Accepted content is assembled under a separate `DungeonSupplementRoot`; its curated rooms, compact connector-junction metadata, connections, collisions, boundaries, platforms, encounters, rewards, minimap entries, local lights, culling records, and owned resources are merged into copies of the parent facade before `DungeonController` is constructed. Physical connector IDs and direct room endpoints remain exact for assembly, walkability, discovery, and persistence. Parent-corridor station records are geometry-suppressed metadata over already-authored gallery floors, never generated rooms or vestibules. Live topology growth is intentionally out of scope.

## Parent extension host contract

A dungeon generator opts in by supplying a renderer-free host record:

```js
{
  schema: 'ruindivex-dungeon-extension-host/v2',
  basePlanHash,
  extensionRegions: [{
    id,
    themeBinding,
    attachmentSockets,
    spliceEdges,
    progressionSnapshot,
    routeNetworkGrants,
    allowedProfileIds,
    delegatedProgressionBeats,
  }],
}
```

`attachmentSockets` grant possible side-branch locations. `spliceEdges` grant only the authored connections that may be physically padded. `progressionSnapshot` identifies access bands, gates, credentials, dominance boundaries, and measured objective routes. `routeNetworkGrants` name exact endpoints, bounded landing overlap, protected volumes, and any crossed credentials. `allowedProfileIds` is an explicit opt-in list. `delegatedProgressionBeats` is the complete authority boundary for required authored content; an empty list delegates nothing. V1 hosts remain readable by V1-V3 profiles.

An authored-corridor station that must merge directly into a compact endpoint module declares the following additional V2 contract:

```js
{
  endpointSockets: [{
    id: socketId,
    routeNetworkSocketKind: 'authored-corridor-station',
    endpointModuleOverlapRequired: true,
    position,
    facing, // one cardinal direction
    parentRouteId,
    logicalEdgeId,
    planningModuleCenter,
    planningContinuationCenter,
    planningContinuationRoute,
  }],
  socketModuleOverlapGrants: [{
    id,
    socketId,
    center,
    size,
    purpose: 'route-network-endpoint-module-parent-merge',
    moduleKind: 'connector-module',
    moduleTemplateId: 'supplement-route-connector-through-t-v1',
    footprintTiles: { width: 5, depth: 7 },
    leadTiles: 1,
    parentOwnerId, // exact logicalEdgeId or parentRouteId
  }],
}
```

There must be exactly one `socketModuleOverlapGrants` entry for every endpoint marked `endpointModuleOverlapRequired`, and no non-empty module-overlap list when no endpoint requests one. The grant is the exact oriented 5x7 Through-T volume: its transverse span is five 2.8-metre cells, its longitudinal span is seven, its height is three, and its center begins after one clear lead tile in the socket's cardinal facing direction. It is separate from `socketLandingOverlapGrants`, which is the exact 3x5 seam envelope: three threshold lanes crossed by two inside approach cells, the threshold cell, and two outside approach cells.

The three `planning*` fields are one optional placement-witness bundle; a producer either omits all of them or supplies all of them. `planningModuleCenter` is the horizontal center of the exact 5x7 overlap volume. `planningContinuationCenter` is the horizontal center reserved for the adjacent 7x7 content room. `planningContinuationRoute` is the complete finite X/Z polyline from the module's outward aperture to that room's inward aperture. Every leg is non-zero and axis-aligned, its first and last legs follow the endpoint's cardinal facing, its endpoints match those two apertures exactly, and its measured length cannot exceed either the grant's declared coverage maximum or 33.6 metres. These are planning witnesses, not collision waivers; validation also requires `planningModuleCenter` to match the corresponding `socketModuleOverlapGrants.center` horizontally.

This record is not a general collision waiver. It can authorize only the matching exact-parent endpoint module and its attachment segment, only inside the declared volume, and only against a base occupied volume whose owner matches `parentOwnerId`. It cannot excuse another room, a later network, an arbitrary segment, a wider footprint, or overlap with a different authored owner. The planner copies the grant unchanged into the route-network operation so validation and identity hashing retain the same authority boundary.

### Route-network overlay operation

A V4 route-network operation exposes its complete renderer-free identity through existing canonical fields:

```js
{
  schema: 'ruindivex-dungeon-augmentation-operation/v1',
  id,
  type: 'routeNetwork',
  parentRegionId,
  grantId,
  routeNetworkKind,
  endpointSocketIds,
  nodeIds,
  roomNodeIds,
  connectorModuleNodeIds,
  connectorJunctionNodeIds,
  connectorInfrastructureNodeIds,
  contentRoles,
  segmentIds,
  moduleCount,
  substantiveModuleCount,
  physicalNodeCount,
  roomCount,
  connectorModuleCount,
  connectorJunctionCount,
  connectorInfrastructureCount,
  featurelessSpans,
  maximumFeaturelessSpanMeters,
  coverage,
  localProgressionArc,
  stableRuntimeStateIds,
  runtimeStateIds,
  protectedVolumes,
  socketLandingOverlapGrants,
  socketModuleOverlapGrants,
  mustPreserveBeatIds,
}
```

`endpointSocketIds` is the exact grant socket sequence ordered by authored route distance and then socket ID. `nodeIds` is exactly the operation-owned subsequence of `overlay.nodes`; the four specialized node-ID arrays are stable filters of that same sequence, and `contentRoles` is index-aligned with it. Counts are recomputed from those node records. `segmentIds` is exactly the operation-owned subsequence of `overlay.segments`; those referenced records are the physical-segment contract, so no parallel physical-segment alias is required.

`coverage`, bounded overlap grants, protected volumes, and `mustPreserveBeatIds` are exact copies of parent authority. `featurelessSpans` is recomputed rather than trusted: authored-route coverage spans come first, followed by one ordered physical witness for every `segmentIds` entry, with the segment path and maximum continuous level distance retained. `localProgressionArc` exactly matches the selected profile. Encounter, mechanism, reward, and shortcut dependencies use the stable IDs `${operationId}:state:encounter`, `${operationId}:state:mechanism`, `${operationId}:state:reward`, and `${operationId}:state:shortcut`; `runtimeStateIds` repeats those values in that order, and shortcut segments may reference only the operation-local shortcut ID.

An ordinary segment may include `localApproachWitnesses` only for exact non-entry sockets on connector-owned authored-corridor stations. Each witness names its owning node, exact socket, local socket ID, and the straight 5.6-metre path from the clear junction core to the aperture. It supplements a short positive corridor's endpoint approach; it does not replace that corridor's normal volumes or collision checks. A zero-distance segment additionally requires `sharedEndpointFootprint.kind === 'shared-junction-threshold'`, exact ordered node/socket identities, coincident path endpoints, opposite cardinal facings, the oriented 8.4-by-2.8-by-5.6-metre footprint, two valid local witnesses, two coincident landing records, and empty occupied, clearance, and landing-volume arrays. Unknown footprint kinds and untyped zero-length paths remain invalid.

Industrial's host is built after its authored room and connection planning and before geometry assembly. It exposes a deliberately narrow set of branch rooms and flat service-gallery edges. The immutable Industrial base draft remains available for diagnostics and fallback even when an overlay is accepted. Because Industrial V1 currently has a single structural owner per X/Z tile column, its adapter also publishes renderer-specific projected connector exclusion volumes: supplemental rooms cannot be stacked above or below an authored connector, while an explicitly padded edge retains its normal replacement exemption. Themes with multilayer renderers keep the generic core's normal 3D-volume behavior.

## Region theme binding

Every extension region has a binding with the following identity:

```js
{
  schema: 'ruindivex-dungeon-region-theme/v1',
  parentMapId,
  parentMapRevision,
  parentRegionId,
  themeRef: { id, revision, contentHash },
  presentationVariantId,
  localLightingProfileId,
  soundscapeProfileId,
}
```

The binding is copied to every descendant generated from that attachment. A runtime lookup may locate a candidate session by parent-region key, but it accepts that candidate only when the complete binding matches exactly: parent map/revision/region, theme ID/revision/content hash, presentation variant, and local environment profiles. A session registered for merely the same region or theme ID is not accepted when any binding field differs. That mismatch is diagnosed before provider factories run and rejects the overlay; there is no nearest-theme or Industrial fallback.

`dungeonFamilyId` is not used to select presentation because it does not reliably distinguish all current themes. Theme ID, revision, content hash, and parent region participate in deterministic augmentation identity.

## Parent-owned theme session

A `DungeonThemeSession` turns semantic grammar roles into presentation owned by the bound parent region:

- `materials.resolve(role, variant)` borrows an exact parent material for roles such as floors, walls, ceilings, ramps, supports, rails, doors, warnings, terminals, and emissive accents.
- `assets.create(role, specification)` creates parent-catalog supports, arches, frames, props, decals, controls, light fixtures, caps, and transition framing.
- `connectors.createSkin(family, contract)` skins traversal contracts such as service galleries, slopes, ladders, lifts, track traps, and transition bays.
- `transitions.create(type, contract)` contributes a theme's half of a cooperative cross-theme seam.
- `environment` supplies bounded local lighting and future sound-emitter descriptors without replacing parent fog, background, or global lighting.
- `resources.borrow()`, `resources.own()`, `resources.disposeOwnedValue()`, and `resources.disposeOwned()` keep shared parent resources separate from supplement-owned geometry and runtime state, preventing double disposal. Each supplement fragment releases only its own tracked products; disposing one fragment neither closes a shared parent session nor retains already-disposed objects in its ownership ledger.

Capabilities are advertised and preflighted before assembly. A provider must return the requested parent-themed resource; it may not substitute a neutral primitive or another theme's catalog.

Industrial's adapter wraps its existing material cache and explicit Industrial asset factories. The Magma adapter requires a valid Magma texture contract plus supplied Magma materials and factories. It has no Industrial dependency and provides the cross-theme proof for the generic interface; a Magma map still needs its own extension host and eligible sockets or edges before augmentation can activate.

## Theme-neutral grammar contract

`DungeonSupplementGrammar` records describe topology and structure, not a visual theme. A grammar contains room dimensions and topology, semantic surface roles, occupied and clearance volumes, player/enemy/continuity/connector sockets, gameplay anchors, compatible rotations, connector families, size class, and selection constraints.

The shared grammar catalog is usable by any capability-complete theme session. Theme-authored supplemental grammars can be registered separately, but the generic planner never references texture URLs, concrete material names, or Industrial assets.

## Cross-theme edge padding

If a granted splice edge crosses region themes, source-side rooms and segments carry the exact source binding and destination-side rooms and segments carry the exact destination binding. Their presentation fragments resolve exclusively through that side's session: no material, asset, prop, light, or connector skin may cross the split. Structural collision records from both sides still enter the one combined effective-layout validation set. The planner creates a deterministic midpoint transition bay with flat thresholds and no gates, encounters, hazards, slopes, ladders, or lifts.

At the midpoint, each session owns and creates only its half of the seam. Assembly asks both parent sessions for a `transitionFrame` asset, `transitionBay` connector skin, and `levelTransitionBay` transition contribution, then combines the two contributions under the transition-bay record. The seam is accepted only when both exact bindings provide compatible capabilities and the combined source/bay/destination geometry passes the same effective collision and traversal validation. Otherwise the padded overlay is rejected and the authored route remains unchanged. The assembler tests exercise full Three.js assembly, facade-only cooperative seam assembly, exact-binding mismatch rejection, and a concrete Industrial-adapter-to-Magma-adapter fixture. Transition bays receive non-gameplay minimap nodes so both split-route halves always resolve to valid endpoints.

## Identity, persistence, and fallback

The parent-owned `basePlanHash` is never rewritten.

- `augmentationPlanHash` canonically identifies the accepted overlay, including its profile, derived seed, operations, bindings, and parent theme revisions.
- `effectivePlanHash` is canonically derived from `basePlanHash` plus `augmentationPlanHash`.
- With augmentation disabled, `augmentationPlanHash` is `null` and the effective hash remains the legacy base hash.

Accepted expeditions persist `ruindivex-dungeon-augmentation-save-identity/v1`, including profile, seed, all three hashes, theme revisions/content hashes, and stable generated progression-state IDs. V4 also persists an allow-listed mutable-state snapshot for its encounters, mechanisms, rewards, deployed ladders, unlocked lifts, and shortcuts. Mutable values are restored only after the exact deterministic content identity has rebuilt successfully; they never participate in or weaken content compatibility. Unknown state IDs fail closed, and legacy saves naturally carry no augmentation identity or supplemental state.

The expedition's base identity is also family-namespaced. Industrial V1 retains its exact historical base-hash format for save compatibility; other dungeon families append their canonical family namespace so identical boss/layout/depth inputs cannot collide across parent generators. The persisted `dungeonFamilyId` owns both normal resume and direct dungeon startup. It remains identity metadata only and never selects a theme session or presentation asset.

For a new Industrial run, the generator first accepts the unchanged parent dungeon while recording only that accepted attempt's legacy RNG tape. Overlay realization replays that tape without consuming the source RNG, may try up to eight isolated augmentation seeds, and commits only an overlay that passes complete physical/progression validation. A committed save replays only its one persisted seed. If no new-run attempt passes, the already accepted authored dungeon is returned with `physical-validation-fallback` diagnostics, its base/effective hash remains unchanged, and its RNG outcome is exactly the parent outcome. Missing profile/capability reasons that cannot change with another seed stop retrying immediately.

For a committed augmented run, the saved augmentation seed is replayed exactly once. A missing profile, changed theme revision, missing asset contract, hash mismatch, or physical reconstruction failure is reported as `incompatible-content` with `resetOrAbandonRequired: true`. Saved rooms are never removed silently. Likewise, a committed legacy run remains legacy even if the preview URL flag is later added.

The recovery UI exposes an explicit **Reset to Current Content** action only for that incompatible state, alongside abandon. Reset is not an implicit fallback: the game first constructs and validates the currently available parent/augmentation candidate, then atomically replaces the saved dungeon identity only if the expedition ID, boss/profile/seed/depth/layout/family, and full prior augmentation identity still match. The transaction resets active dungeon-local progress for the replacement layout while preserving completed victory and reward state. A failed candidate build or stale identity leaves the committed save untouched.

## Source map

| File | Responsibility |
| --- | --- |
| `src/dungeon-augmentation/planner.js` | Pure `augmentDungeonDraft` entry point, isolated seed use, graph operation planning, and unchanged fallback. |
| `src/dungeon-augmentation/contracts.js` | Versioned host, region, capability, grammar, profile, overlay, operation, diagnostics, and save schemas. |
| `src/dungeon-augmentation/catalog.js` | Generic structural grammar catalog and versioned Industrial preview profiles. |
| `src/dungeon-augmentation/geometry.js` | Renderer-neutral occupied, clearance, landing, and connection geometry calculations. |
| `src/dungeon-augmentation/validation.js` | Capability, collision, traversal, graph, gate-dominance, progression, transition, and hash validation. |
| `src/dungeon-augmentation/ThemeSession.js` | Runtime theme-session interface, capability checks, and borrowed/owned resource ledger. |
| `src/dungeon-augmentation/ThemeAdapters.js` | Industrial and Magma parent-theme adapters and capability manifests. |
| `src/dungeon-augmentation/IndustrialDraftAdapter.js` | Converts the authored Industrial plan into an immutable renderer-free base snapshot, including Industrial's projected connector-column exclusions. |
| `src/dungeon-augmentation/IndustrialExtensionHost.js` | Industrial's explicit branch sockets, splice-edge permissions, theme binding, and zero delegated beats. |
| `src/dungeon-augmentation/IndustrialOverlayMaterializer.js` | Converts an accepted generic overlay into Industrial-compatible physical room and connection plan records. |
| `src/dungeon-augmentation/IndustrialSupplementContent.js` | Curated V4 module manifests and topology-aware encounter, reward, mechanism, and hazard recipes. |
| `src/dungeon-augmentation/IndustrialSupplementBlueprintCatalog.js` | Exact renderer-free plans for all 28 V4 rooms, junctions, cycles, masks, sockets, tiers, and internal transfers. |
| `src/dungeon-augmentation/DungeonSupplementAssembler.js` | Creates parent-themed Three.js supplement geometry, transition seams, normalized facade fragments, and metrics. |
| `src/dungeon-augmentation/DungeonFacadeOverlay.js` | Merges supplement fragments into copied facade arrays and attaches/detaches `DungeonSupplementRoot`. |
| `src/dungeon-augmentation/identity.js` | Canonical save identity, sanitation, and committed-content compatibility checks. |
| `src/dungeon-augmentation/canonical.js`, `rng.js`, `ids.js` | Canonical serialization/hashing, isolated deterministic RNG, and namespaced IDs. |
| `src/dungeon-augmentation/index.js` | Public sidecar exports. |
| `src/DungeonGenerator.js` | Minimal Industrial pre-assembly hook, exact parent theme session, overlay materialization/assembly, facade integration, and metrics. |
| `src/Game.js` | Off-by-default URL selection, family-namespaced base/effective identity plumbing, committed-run handling, explicit incompatible-content recovery, and runtime diagnostics. |
| `src/buster/BusterLabStorage.js` | Expedition persistence, incompatible-content preservation, and compare-and-swap reset to validated current content. |

## Verification

Run the complete focused unit and browser suite:

```powershell
npm run test:dungeon-augmentation
```

For only the renderer-free and assembly checks, run:

```powershell
npm run test:dungeon-augmentation:unit
```

Run the normal realized gate across 100 complete deterministic Industrial V4 generations, requiring every accepted parent to receive a fully reachable overlay:

```powershell
npm run test:dungeon-augmentation:realized
```

For a quick local diagnostic, retain the ten-generation smoke sample:

```powershell
npm run test:dungeon-augmentation:realized:smoke
```

Compare complete normal and rejected-sidecar Industrial generations—including
rooms, connections, progression, diagnostics, hashes, attempts, and source RNG:

```powershell
npm run test:dungeon-augmentation:legacy-realized
```

Run the browser integration checks for default-off behavior and the opt-in Industrial preview:

```powershell
npm run test:dungeon-augmentation:runtime
```

Before release, run the extended gate: 1,000 pure-planner augmentation seeds,
100 complete legacy/rejected-sidecar comparisons, the connector/enclosure suite,
1,000 complete realized preview generations, and browser lifecycle/recovery coverage:

```powershell
npm run verify:dungeon-augmentation:release
```

The focused suite is designed to cover immutable fallback, separate RNG behavior, deterministic explicit-seed replay, deterministic plans and hashes, full-realization generations, Industrial hook/RNG checks, branch return routes, padded-edge gate identity, exact-lane connector apertures, two-tile flat approaches, thin-solid movement-segment blocking, connector-owned and exact-elevation centerlines, graph-only exclusion, orphan-floor and wrong-level-underpass rejection, bidirectional room-floor and junction-arm traversal, barrier-clear ladder/lift shaft mouths, explicit vertical-transfer links, whole-seed barrier-aware bidirectional reachability, source-threshold gate coordinates, both authored door orientations, elevated connector sill/headroom clearance, same-logical-gate protection, projected-column rejection, nonzero-elevation connectors, accepted-parent fallback after a forced-invalid overlay, combined authored/supplemental and cross-theme collision validation, graph-solved delegated progression, missing-capability and exact-binding rejection, split theme ownership, parent resource ownership, family-namespaced persistence compatibility, mutable supplemental-state persistence, facade normalization, Industrial/Magma cooperative transition seams, and explicit incompatible-content reset. This describes intended coverage, not a claim that the current 100/1,000-seed gates passed. Runtime verification additionally checks the separate supplement root, the V4 coverage and pyramid-loop contracts, physical effective graph, merged minimap/encounter/light records, exact parent material use, unchanged hashes when the feature is off, direct committed-family startup, recovery transaction behavior, and supplement-only teardown without disposing shared parent materials or geometry.

The realized-seed audit runs complete Industrial planning, tile realization, combined collision checks, whole-seed connector-mouth reachability, effective progression validation, assembly, and fallback. Every accepted parent seed in the normal and release corpus views must apply V4, contain exactly one pyramid loop, cover every required span, and keep every reported featureless interval at or below 33.6 metres. One immutable 1,000-parent manifest is authoritative: smoke consumes ordinals 0–9, normal consumes 0–99, and release consumes 0–999, so the smaller gates cannot silently select different parents. Evidence uses only the canonical 1×10 smoke, 10×10 normal, and 20×50 release partitions; each ordinal runs in a separate verifier worker with a hard 180-second hang timeout before its result is assembled into the canonical shard. A raw seed that exhausts Industrial V1's own authored-layout attempts is not misreported as an augmentation rejection: the verifier reruns it with augmentation disabled and may skip it only when the parent error and legacy RNG consumption match exactly, then continues until the requested number of accepted parent layouts has been audited. The ten-seed smoke view is useful for rapid diagnostics but is not release evidence by itself. The normal gate requires 100 full realized generations, and the release gate requires 1,000. Aggregation rejects any stale or mixed shard artifact. Release-issue documentation accepts only a final sealed attestation containing that same-source 1,000-parent aggregate plus passing canonical-unit/blueprint, enclosure, legacy-replay, persistence/lifecycle, and ordinary-movement Playwright receipts; a corpus aggregate alone is insufficient. The browser runtime suite performs five same-seed reset cycles and requires rooms, supplement roots, live geometry/material sets, encounters, hazards, disposable resources, controller ownership, and renderer texture/geometry memory to plateau. Planning/assembly time, rejection causes, graph shape, exact theme bindings, tiles, draw calls, triangles, local lights, and renderer memory are exposed through the dungeon augmentation diagnostics for investigation.
