# Procedural Reaverbot Surface Design

## Purpose

Procedurally generated Reaverbots use a shared ancient-machine material vocabulary, but they do not wallpaper the same texture across every primitive. Each body plan and module is assembled from semantically authored surfaces: quiet armor faces, deliberately placed circuit panels, dark bearings and recesses, pale trim bands, and dark working ends.

The mandatory ruby Reaverbot eye remains the visual focal point. Its source image, material treatment, full-map UVs, socket, lens proportions, and glint are intentionally unchanged.

## Design principles

- A texture feature belongs to a named part. Circuitry appears on a selected armor face and leads toward a hinge, emitter, or powered node.
- Moving sections expose their construction. Shoulder sockets, jaw pivots, elbows, shield spindles, and wing roots receive explicit bearings or hinges.
- Working ends use separate geometry and a dark value: foot pads, horn tips, jaw ends, claw tips, muzzle wells, chutes, and magnet poles.
- Broad armor remains quiet enough for the ruby eye and weapon silhouette to dominate.
- Paired parts share a layout but mirror it, so left and right limbs do not display identically oriented markings.
- Module identity comes from both geometry and surface mapping. Different module IDs must not differ only by palette tint.
- The eye and energy-field maps are the only intentional full-map views. Ordinary physical surfaces use padded semantic regions.

## Source-sheet inventory and provenance

The runtime source sheets live in:

```text
assets/textures/reaverbots/procedural/shared/
```

All nine files are 256 x 256 RGBA PNGs generated on 2026-07-12 with the built-in `image_gen` path (GPT Image). The three supplied mockups and the existing Horokko, Gorubesshu, and Sharukurusu textures were used as style references only. No source atlas pixels, model UV islands, logos, lettering, or recognizable emblems were copied.

Some filenames retain the historical `_tile` suffix from their generation prompt. That suffix describes their source-generation lineage, not their runtime sampler behavior. Runtime sampling is clamped and physical meshes select bounded regions of each sheet.

| Catalog key | Runtime file | Generation result prefix | Source-sheet role |
|---|---|---|---|
| `armorPrimary` | `armor_primary_tile.png` | `exec-531c349a...` | Pale olive armor, quiet wear, sparse fasteners |
| `armorSecondaryCircuit` | `armor_secondary_circuit_tile.png` | `exec-abc99db0...` | Darker armor and ancient circuit line work |
| `trimAlloy` | `trim_alloy_tile.png` | `exec-4053b952...` | Rings, rims, bands, braces, and non-cutting trim |
| `jointDark` | `joint_dark_tile.png` | `exec-700560a8...` | Bearings, hinges, sockets, recesses, vents, and undersides |
| `weaponHousing` | `weapon_housing_tile.png` | `exec-21438b61...` | Weapon casings, actuators, breeches, and module housings |
| `bladeMetal` | `blade_metal_tile.png` | `exec-090ad00f...` | Blades, teeth, claws, horns, spikes, and cutting rails |
| `moduleEmissiveMask` | `module_emissive_mask.png` | `exec-8ca30401...` | Powered nodes, weak points, vents, coils, and indicators |
| `energyFieldMask` | `energy_field_mask.png` | `exec-0e69f242...` | Membranes, phase fields, and tractor energy |
| `eyeRedLens` | `eye_red_lens.png` | `exec-37ee029d...` | The unchanged ruby face eye and claw-palm eye |

### Reference language

- Horokko contributes pale olive armor, dark inset construction, fine circuit paths, and high-contrast ruby lenses.
- Gorubesshu contributes charcoal-violet mechanics, aged ochre plate separation, restrained ornament, and riveted bands.
- Sharukurusu contributes forest-green plates, cream structural trim, black recesses, and heavy parallel traces.
- The supplied mockups establish readable green/gold/charcoal value separation, dark weapon ends, explicit hinges, and detail that survives the normal third-person camera distance.

## Runtime mapping architecture

Texture choice and UV placement are separate responsibilities:

1. `resolveReaverbotTextureProfile()` selects the source sheets appropriate to the generated body, weapon, defense, weak point, and eye IDs.
2. `ReaverbotTextureLibrary` loads and caches one shared `THREE.Texture` for each source-sheet key.
3. `inferReaverbotSurfaceRole()` identifies the internal atlas role from the authored part name and material slot. Explicit roles may override inference.
4. `applyReaverbotSemanticUv()` chooses a deterministic padded region using scope, module ID, normalized part name, role, and primitive group index.
5. UV coordinates are rewritten on the freshly created geometry. The shared texture's transform is never cloned or mutated.
6. Indexed geometry is converted to non-indexed geometry only when material groups share vertices and require independent region mapping.
7. The visual factory records the public part contract in `mesh.userData.reaverbotSurface`; the lower-level mapping record lives in `geometry.userData.reaverbotSemanticUv`.

The core API is:

```js
applyReaverbotSemanticUv(geometry, {
  scope,
  moduleId,
  partName,
  role,
  slot,
  mirror,
  workingEnd,
});
```

### Padded UV layout

`REAVERBOT_SEMANTIC_UV_LAYOUT` defines a 4 x 4 logical layout over a 256-pixel reference sheet with a three-pixel filtering gutter inside every ordinary region.

| Region family | Region IDs | Use |
|---|---|---|
| Long working surfaces | `workingLongA`, `workingLongB` | Blades, teeth, talons, horns, spikes, and working ends; the terminal direction is tracked as `vMax` or `vMin` |
| Long housings | `housingLongA`, `housingLongB` | Cannons, booms, forearms, actuator casings, and other elongated housings |
| Armor panels | `armorPanelA`, `armorPanelB` | Quiet body and defense faces |
| Circuit panels | `circuitPanelA`, `circuitPanelB` | Methodically placed ancient traces and powered face details |
| Joint panels | `jointPanelA`, `jointPanelB` | Bearings, hinges, recesses, vents, and undersides |
| Trim panels | `trimPanelA`, `trimPanelB` | Bands, rims, rails, braces, and endcaps |
| Preserved full map | `fullMap` | Ruby eyes and centered energy fields only |

The deterministic selector normalizes `left` and `right` in paired part names before choosing a region. The left-hand geometry then mirrors its U coordinate, producing a coordinated pair rather than two copies with the same orientation.

### Two-layer semantic-role contract

The surface catalog uses compact internal roles to select UV regions. The visual factory exposes more descriptive authored roles for diagnostics and tests.

| Internal atlas role | Public authored roles | Value intent | Mapping |
|---|---|---|---|
| `armor` | `armorFace` | Mid-value quiet plate | Padded region |
| `circuit` | `circuitPanel` | High-contrast ancient circuitry | Padded region |
| `housing` | `armorFace` on weapon/module housings | Mid-value mechanical casing | Padded longitudinal region |
| `joint` | `bearing`, `hinge`, `recess`, `vent`, `underside` | Dark mechanical separation | Padded region |
| `trim` | `band`, `endCap` | Pale alloy separator | Padded region |
| `workingEdge` | `workingEnd`, `bladeEdge` | Dark terminal or sharpened surface | Padded longitudinal region |
| `emissive` | `emitter` | Powered node or weak-point light | Padded circuit region |
| `energy` | `energyField` | Transparent centered field | Full map |
| `eye` | `eye` | Ruby focal lens | Full map |

Each mapped mesh exposes:

```text
scope
moduleId
partName
role
valueClass
mappingMode        // region | fullMap
regionIds
uvRects
sourceMappingMode
```

## Geometry grammar

The UV system is supported by explicit geometry rather than expected to fake every structural change.

- `addBearingAssembly()` builds a dark barrel with pale endcaps.
- `addCircuitPanel()` builds a recessed quiet armor face, mirrored circuit traces, and optional powered nodes.
- `addDarkFootEnd()` creates a separate contact mesh and marks it as a Reaverbot working end.
- Standard joints receive visible bearing rings.
- Weapons and defenses add named hinge barrels, endcaps, bands, vents, recesses, and working-end meshes where their function requires them.
- Weak points use ID-specific assemblies instead of one generic glowing orb.

Names are part of the authored contract: the visual factory uses names such as `DarkWorkingEnd`, `Bearing`, `Hinge`, `Circuit`, `Vent`, `Muzzle`, and `Band` to assign the correct public and UV roles.

## Module/detail matrix

### Body plans

| Body plan | Authored surface and mechanical details |
|---|---|
| `biped` | Chest circuit face, mirrored limb layouts, hip/shoulder/knee bearings, ankle bands, and dark toe caps |
| `lowBiped` | Squat chest treatment, waist band, dark under-structure, short-limb bearings, and reinforced dark toes |
| `quadruped` | Dorsal/flank armor, neck mechanics, outer leg bearings, mirrored leg circuitry, dark belly structure, tail mount, and dark foot ends |
| `crawler` | Low layered carapace, circuit spine, dark under-shell, compact leg mounts, and ground-contact ends distinct from the quadruped |
| `tripod` | Radial chassis faces, central mechanical banding, three leg layouts, strut details, and dark terminal feet |
| `hopper` | Faceted shell, body circuit face, dark spring coils, bearing-like spring receivers, and dark landing pads |
| `hoverBell` | Bell-face circuit panel, dark lower lip/underside, segmented trim, fin-root bearings, and dark fin ends |
| `flyer` | Faceted core armor, selected circuit face, dark inter-panel mechanics, wing-root bearings, mirrored/rotated wing regions, and dark wing tips |

### Weapon modules

| Weapon | Authored detail contract |
|---|---|
| `ramHorn` | Mount bearing, armor horn body, mechanical band, and separate dark impact tip |
| `crusherJaw` | Massive upper/lower armor faces, dark mouth and hinge barrel, hinge endcaps, circuit panels, blade rails, teeth, and dark terminal jaw ends |
| `clawArm` | Shoulder bearing, upper-boom and forearm face designs, mirrored circuit routes, hydraulic details, elbow/wrist hinges, palm-back armor, blade talons, and separate dark talon tips; palm eye unchanged |
| `pounceActuator` | Mount bearing, spring/actuator housing, compression bands, powered coil details, and dark launch-contact end |
| `shockPiston` | Heavy braced housing distinct from the pouncer, piston mechanics, vents, shock-emitter band, and broad dark ground striker |
| `pulseCannon` | Breech bearing, housing face, side circuit panel, barrel bands, recoil structure, and dark muzzle recess |
| `mortarPod` | Single tube, elevation bearings, breech face/hatch, control circuit, feed band, and dark tube mouth |
| `clusterMortar` | Multiple dark-mouthed tubes, shared feed/indexing mechanics, magazine face, circuit detail, and barrel bands |
| `arcEmitter` | Insulated mount, coil housing, circuit feed, conductor bands, powered core, prongs, and dark electrode ends |
| `flameNozzle` | Fuel coupling, housing circuit face, heat bands, cooling vents, and blackened nozzle end/recess |
| `beamPrism` | Gimbal bearing, focusing rails, circuit strips, prism emitter, trim frame, and dark focusing aperture |
| `mineDispenser` | Magazine armor, door hinge/latches, circuit panel, individually housed mines, and dark ejection chute |
| `rotorBlade` | Central bearing, crossbar bands, chain joints, blade-root mechanics, blade faces, dark working tips, and counterweight connection |
| `tractorMagnet` | Swivel bearing, horseshoe armor, outer circuit route, dark inner mechanics, segment bands, and authored pole working ends |
| `overloadCore` | Dark mounting socket, circuit convergence, vented housing, segmented cage bands/ribs, and powered overload core |

### Defensive modules

| Defense | Authored detail contract |
|---|---|
| `directionalShield` | One readable shield-face circuit design, rim bands, central node/bearing, dark rear brace, and hinge structure |
| `armoredSkull` | Brow and cheek armor faces, dark inner edges, cheek hinges, and circuitry that preserves the ruby-eye sightline |
| `sidePlates` | Outward armor faces, mirrored circuit panels, edge bands, and dark rear standoffs/hinges positioned to protect the paired weak point |
| `armoredBack` | Overlapping plate regions, dark spinal seams, end bands, and one circuit route spanning the plate set |
| `armoredCarapace` | Broad arched shell distinct from armored back, central ridge, lateral sections, dark underside, and longitudinal circuit treatment |
| `guardArms` | Outer guard faces, dark interior mechanics, arm bearings, circuit panels, bands, and terminal armor |
| `armorShutters` | Paired authored faces, dark pivot rails, hinge caps, meeting edges, and a circuit design that reads coherently when closed |
| `rotatingPlates` | Dark spindle, end bearings, authored shield face, circuit path into the hub, rim/working edge, and rear weak-point frame |
| `energyMembrane` | Physical emitter nodes, dark mounting brackets, circuit feeds, and the centered full-map membrane field |
| `phaseShell` | Distinct projector/gimbal assembly, phase emitters, dark sockets, bands, and the centered full-map phase field |
| `reactivePlate` | Layered armor cells, central emitter, circuit response strip, edge bands, and dark rear hinge/brace |

### Weak-point modules

| Weak point | ID-specific authored form |
|---|---|
| `rearBattery` | Rectangular battery pack with dark bracket, terminal/charge bands, and powered core face |
| `bellyCore` | Recessed reactor well with armor frame, dark socket, mechanical ring, and emissive center |
| `eyeLens` | The unchanged face eye; existing socket, ruby lens, full-map UVs, and glint are preserved |
| `shieldHinge` | Actual axle assembly with dark hinge barrel, bearing endcaps, and glowing end face |
| `ammoDrum` | Segmented cylindrical drum with dark axle, feed bands, and emissive index/core detail |
| `coolingVents` | Dark recessed vent bank with emissive backing, grille slots, and pale side bands rather than an orb |
| `emitterCore` | Socketed emitter with conductor ring, powered center, and focused module geometry |
| `overloadCore` | Unstable core with dark socket and multiple cage bands/ribs |
| `legJoint` | True dark leg bearing with trim ring, powered central pin, and adjacent circuit lead |
| `counterweightCore` | Blocky counterweight housing, dark terminal bands, attachment mechanics, and recessed powered face |
| `clawPalm` | Existing ruby palm eye remains unchanged; surrounding palm armor, hinge conduits, and talon mechanics carry the new semantic treatment |

## Runtime tint and value hierarchy

The generated genome still owns behavior color. Source sheets supply material character and part detail, while `MeshStandardMaterial.color` multiplies the selected region.

| Surface class | Runtime treatment |
|---|---|
| Primary/secondary armor | Archetype palette lifted toward white enough to retain painted detail in dungeon lighting |
| Circuit panels | Secondary armor and pale trace geometry, with sparse palette-emissive nodes |
| Bearings, hinges, recesses, vents, undersides | Dark palette material with stronger metalness |
| Bands and endcaps | Pale trim alloy |
| Blade edges | Blade-metal source region |
| Working ends | Intentionally dark value even when adjacent blade geometry is pale |
| Powered modules and weak points | Palette emissive color and emissive map |
| Face and palm eyes | Fixed `REAVERBOT_EYE_COLOR`; unaffected by archetype palette |

## Sampler and cache rules

| Asset class | Color space | Wrap S/T | Minification | Magnification |
|---|---|---|---|---|
| Physical color source sheets | sRGB | clamp-to-edge | nearest-mipmap-nearest | nearest |
| `moduleEmissiveMask` | no color space | clamp-to-edge | linear-mipmap-linear | linear |
| `energyFieldMask` | no color space | clamp-to-edge | linear-mipmap-linear | linear |
| `eyeRedLens` | sRGB | clamp-to-edge | nearest-mipmap-nearest | nearest |

All assets retain a neutral texture transform scale of `[1, 1]`, anisotropy 4, and generated mipmaps. Padded geometry UV regions prevent neighboring semantic views from bleeding under minification. The shared texture cache remains keyed by asset key; visual variation lives in geometry UVs and does not allocate a texture clone per part or enemy.

DOM-independent tests receive an annotated 1 x 1 white `DataTexture` placeholder. Browser builds load the authored PNG, and diagnostics record asset key, path, load state, source dimensions, and whether a fallback was used.

## Maintenance contract

When adding or changing a procedural Reaverbot module:

1. Add or update its source-sheet profile in `ReaverbotTextureCatalog.js`.
2. Build named semantic parts for its armor faces, circuits, bearings/hinges, bands, vents/recesses, emitters, and working ends as appropriate.
3. Use explicit dark working-end geometry where the module contacts the player, floor, projectile path, or carried target.
4. Give every new weak-point ID an authored mechanical form; do not fall back to a generic orb unless an orb is the module's intentional design.
5. Preserve `eyeRedLens`, the face-eye mesh construction, and the `fullMap` eye role.
6. Keep physical source sheets clamped. Add padded region definitions before introducing a new semantic surface class.
7. Keep paired part naming stable so deterministic normalization and U mirroring continue to work.
8. Extend manifest and browser fixtures so the new ID proves profile coverage, finite padded UVs, semantic metadata, source loading, and visible part-role diversity.
9. Inspect module galleries and several complete enemies at the normal third-person camera distance. Correct metadata alone does not prove readable design.

## Verification expectations

The automated texture suite should prove:

- exact catalog coverage for every body, weapon, defense, weak point, and eye ID;
- valid clamped source-sheet metadata and successful browser image loading;
- deterministic padded region selection and per-group UV containment;
- mirrored paired layouts without changing the chosen region identity;
- public `reaverbotSurface` metadata on every mapped mesh;
- distinct semantic roles and region signatures within each module;
- dark authored `workingEnd` geometry for melee/contact silhouettes;
- ID-specific weak-point geometry;
- full-map sampling only for eyes and centered energy fields;
- unchanged face-eye and claw-palm-eye sampling; and
- rendered body, weapon, defense, weak-point, and claw-detail galleries.
