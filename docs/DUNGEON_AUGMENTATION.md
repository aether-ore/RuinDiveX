# Theme-Inheriting Dungeon Augmentation Sidecar

## Scope and safety boundary

This subsystem belongs only to the Three.js project. It is an optional planning and assembly sidecar beside the existing authored dungeon generators; it is not a replacement for them.

Industrial V1 remains the authoritative owner of its base rooms, connections, gates, progression, and presentation. Augmentation is off by default. When the sidecar is disabled, not supported by a host, or rejected during planning or validation, the generator keeps the original parent draft. The disabled path enters before sidecar random-number generation, and the pure planning API returns the exact input draft reference for an unchanged result.

The compatibility profile `industrial-supplement-preview-v1` remains available for committed expeditions and produces two to four supplemental rooms. New preview runs use `industrial-supplement-preview-v2`, which guarantees a two-room out-and-back exploration branch and pads one explicitly eligible authored edge with one or two rooms, producing three to four supplemental rooms in total. V2 also keeps 8.4 metres (three Industrial grid cells) between supplemental footprints so the generated corridors read as an obvious addition instead of adjacent rooms blending into the authored factory. Neither profile relocates keys, objectives, gates, or the boss arena. Generic delegated-progression support exists in the core, but a parent must grant individual beat IDs explicitly; the Industrial previews grant none.

No neutral presentation and no Industrial presentation are fallback choices. Supplemental content must resolve every required material, asset, connector skin, transition frame, and local environment recipe through the theme session belonging to the parent region where it attaches. Missing capabilities reject the whole augmentation and leave a new run unaugmented.

## Opting in

Normal launches remain unaugmented. The Industrial preview can be enabled for a new browser run with any of these equivalent query values:

```text
?dungeonAugmentation=preview
?dungeonAugmentation=1
?dungeonAugmentation=true
?dungeonAugmentation=on
?dungeonAugmentation=2
?dungeonAugmentation=expanded
?dungeonAugmentation=industrial-supplement-preview-v2
```

Only the explicit `industrial-supplement-preview-v1` ID selects the original profile for compatibility testing. A committed v1 expedition remains v1 regardless of the current URL alias because its exact profile ID is saved with the expedition.

For reproducible development runs, combine the flag with an authored layout seed:

```text
?dungeonSeed=augmentation-runtime-check&dungeonAugmentation=preview
```

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

The planner supports three graph operations:

- `optionalBranch` attaches a bounded tree or loop to a registered socket and must preserve a return route.
- `edgePadding` replaces the physical realization of an eligible edge with namespaced supplemental segments while preserving the original logical edge ID, gate, credential, tier, and dominance boundary.
- `delegatedProgression` may place only progression beat IDs explicitly delegated by the parent host. This operation is disabled in the Industrial preview.

Delegated progression is solved against the effective graph, not assigned by room index. The parent-supplied prerequisite graph is topologically ordered, candidate anchors are checked against actual reachability, and a delegated gate may be placed only on a segment whose dominance preserves the required key-before-gate route. Cycles, undelegated beats, reused gates, bypasses, or a graph with no solvable assignment reject the complete overlay. This generic path is exercised by fixtures but remains disabled in both Industrial preview profiles.

Planning and validation finish before `DungeonSupplementAssembler` creates Three.js objects. Collision validation uses one combined effective-layout set containing authored occupied/clearance volumes and every selected supplemental room, segment, landing, and transition volume, regardless of which theme owns the presentation. Cross-theme content therefore cannot pass by validating each theme in isolation.

Industrial additionally materializes the overlay into renderer-free tile/connector records and preflights the whole realized seed before creating a mesh or material. Every supplemental connector mouth must have threshold and exterior support, fit the complete player collision/head/step envelope, and be reachable bidirectionally from the dungeon start. Traversal edges are swept against the realized solid barriers, including thin wall strips and door wings; connected floor-cell centers alone are not considered proof of walkability. Wall generation reserves each connector's exact declared lane count, subtracts those horizontal and vertical apertures from boundary runs and nearby authored door-threshold wings, and preserves the padded edge's own logical gate rather than carving a bypass through it. A failure anywhere rejects the entire overlay and returns the unchanged accepted parent.

Accepted content is assembled under a separate `DungeonSupplementRoot`; its normalized rooms, connections, collisions, boundaries, platforms, encounters, rewards, minimap entries, local lights, culling records, and owned resources are merged into copies of the parent facade before `DungeonController` is constructed. Live topology growth is intentionally out of scope.

## Parent extension host contract

A dungeon generator opts in by supplying a renderer-free host record:

```js
{
  schema: 'ruindivex-dungeon-extension-host/v1',
  basePlanHash,
  extensionRegions: [{
    id,
    themeBinding,
    attachmentSockets,
    spliceEdges,
    allowedProfileIds,
    delegatedProgressionBeats,
  }],
}
```

`attachmentSockets` grant possible side-branch locations. `spliceEdges` grant only the authored connections that may be physically padded. `allowedProfileIds` is an explicit opt-in list. `delegatedProgressionBeats` is the complete authority boundary for required content; an empty list delegates nothing.

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

Accepted expeditions persist `ruindivex-dungeon-augmentation-save-identity/v1`, including profile, seed, all three hashes, theme revisions/content hashes, and stable generated progression-state IDs. Legacy saves naturally carry no augmentation identity.

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

Run the normal realized gate across 100 complete deterministic Industrial v2 generations, accepting only a fully reachable overlay or the unchanged accepted parent:

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

The focused suite covers immutable fallback, separate RNG behavior, deterministic explicit-seed replay, deterministic plans and hashes, 100 normal full-realization generations, 100 Industrial hook/RNG checks, branch return routes, padded-edge gate identity, exact-lane connector apertures, thin-solid movement-segment blocking, whole-seed barrier-aware bidirectional reachability, both authored door orientations, elevated connector sill/headroom clearance, same-logical-gate protection, projected-column rejection, nonzero-elevation connectors, accepted-parent fallback after a forced-invalid overlay, combined authored/supplemental and cross-theme collision validation, graph-solved delegated progression, missing-capability and exact-binding rejection, split theme ownership, parent resource ownership, family-namespaced persistence compatibility, facade normalization, Industrial/Magma cooperative transition seams, and explicit incompatible-content reset. Runtime verification additionally checks the separate supplement root, the v2 minimum three-room measurable delta, physical effective graph, merged minimap/encounter/light records, exact parent material use, unchanged hashes when the feature is off, direct committed-family startup, recovery transaction behavior, and supplement-only teardown without disposing shared parent materials or geometry.

The realized-seed audit runs complete Industrial planning, tile realization, combined collision checks, whole-seed connector-mouth reachability, progression validation, assembly, and fallback. At least 95% of each deterministic sample must apply; any rejected realization must return the unchanged accepted parent. A raw seed that exhausts Industrial V1's own authored-layout attempts is not misreported as an augmentation rejection: the verifier reruns it with augmentation disabled and may skip it only when the parent error and legacy RNG consumption match exactly, then continues until the requested number of accepted parent layouts has been audited. The ten-seed smoke alias is useful for rapid diagnostics but is not release evidence. The normal gate requires 100 full realized generations, and the release gate requires 1,000. The browser runtime suite performs five same-seed reset cycles and requires rooms, supplement roots, live geometry/material sets, encounters, hazards, disposable resources, controller ownership, and renderer texture/geometry memory to plateau. Planning/assembly time, rejection causes, graph shape, exact theme bindings, tiles, draw calls, triangles, local lights, and renderer memory are exposed through the dungeon augmentation diagnostics for investigation.
