# Mega Man Legends-Inspired Ruin Crawler Prototype

A procedural Three.js third-person ruin-crawler prototype with Mega Man Legends-inspired robotic salvage, arm weapons, buster upgrades, Kevlar and alloy armor, elite Reaverbot-style encounters, loot pickups, expedition objectives, and a garage loadout screen.

The equipment foundation now uses robotic part categories instead of fantasy RPG gear:

- Arms: invariant `Mega Buster`; Special/Custom slots for `Laser Beam Blade`, authored Custom Busters, `Machine Gun Arm`, `Cannon Arm`, `Grenade Arm`, `Missile Arm`, and `Shining Laser`; Utility slot for `Lift Arm` or `Drill Arm`.
- Gear: authored Armor, Helmet, Mobility, Defense, and two Utility Module slots. Gear has fixed effects rather than rarity, affixes, item levels, or randomized rolls.
- Buster Parts: `Power Raiser`, `Range Booster`, `Rapid Fire Unit`, `Energy Battery`, `Sniper Scope`, and `Heat Sink Core`.
- Armor and Sensor Gear: `Kevlar Jacket`, `Alloy Chest Plate`, `Refractor-Lined Armor`, `Utility Helmet`, and `Lock-On Visor`.
- Mobility Gear: `Servo Boots`, `Jet Skates`, and `Magnetic Soles`.
- Utility Salvage: `Reactor Chip`, `Capacitor Module`, `Targeting Chip`, `Energy Cartridge`, `Adapter Plug`, and `Refractor Core`.

New campaigns start with the Reinforced Armor Frame equipped and the Helmet slot empty. A one-time loadout migration retires the former starter Gyro Stabilizer Helmet from existing saves; a later explicit Helmet unlock remains durable.

Primary weapon stats follow the intended buster-part language:

- `Attack`: single hit, shot, beam pulse, slash, or explosion impact.
- `Energy`: burst capacity before reload, recharge, or heat venting.
- `Range`: projectile distance, blade reach, beam length, or lock-on distance.
- `Rapid`: firing rhythm, swing speed, drill tick rate, or launch interval.

For the standard Buster Arm, Energy is not ammo. Buster shots are unlimited; Energy improves Output efficiency so the starting ENG 6 buster fires three rapid shots before Output is fully drained, with each additional 3 Energy adding another full shot to the burst.

## Custom Buster Lab Preview

Add `?busterLab=1` to the game URL to enable Roll's Custom Buster Lab and the unified `PWR / ENG / RNG / RPD` weapon model. Without the flag, the existing equipment, Buster Output, loot, and combat systems remain unchanged.

- Slot 1 remains the fixed Mega Buster. Its four calibration sockets accept converted legacy Buster Parts and use the same battery runtime as Custom Busters.
- Roll grants Build A with a Workshop Chassis and Pulse Bolt once. A second physical chassis and additional module copies can be fabricated from her identified Reaverbot scrap stockpile.
- Build A and Build B can be tuned, programmed, compiled, saved, and assigned independently to special-weapon slots 2 and 3. Legacy special arms remain available in those slots.
- The v0.1 module set supports Pulse and Mortar emitters, Pursuit Guidance, Apex/Impact/Delay triggers, Spread/Cluster splitting, and Pulse/Explosion payloads.
- `Test in Range` runs the production Buster runtime against stationary and moving no-reward targets, then restores the prior position, loadout, projectiles, and weapon resources on exit.

For unrestricted testing, open Debug Tools with the tilde key and choose the `Buster Lab` tab. `Grant one of each Buster part` adds a fresh copy of every physical v0.1 module and Mega calibration, reveals all recipes, and supplies Build B without changing scrap, salvage, builds, sockets, or assignments. The grant is repeatable for testing physical ownership across both builds. Add `busterLabDebug=1` to the URL to preselect this debug tab.

The Lab's partial local save is stored under `ruinDigger.busterLab.v1`. It contains Roll's scrap stockpile, recipe discovery, fabricated chassis/modules, builds, assignments, and Mega calibrations; it intentionally does not save general inventory or dungeon progress.

## Controls

- WASD or arrow keys move.
- Move normally to jog. Press `Ctrl` to toggle the original walk speed, and hold `Shift` while moving forward with walk mode off to sprint faster. Forward-left and forward-right arcs also sprint; Shift does not boost turning in place or backward movement.
- `Space` jumps; jump direction follows the current movement input.
- `Q` performs a short dodge roll in the current movement direction.
- Mouse aims with the flat cyan screen reticle. Hold right mouse to aim through the reticle; entering aim preserves the reticle's current position.
- Hold left mouse to fire or swing the active arm weapon. The Sword Arm opens with a forward slash; release and press again during the sequence to spend another Energy charge and Servo Output on the optional legacy inward-slash follow-up.
- `Tab` locks onto or releases a target. While locked, hold right mouse for manual reticle aim without dropping the movement lock.
- `Z` uses the active arm's secondary function (or manually vents/reloads when none is available).
- `G` raises an equipped Guard Projector independently of the selected arm; early timing parries and staggers attackers.
- Number keys `1` through `4` switch arm weapon slots.
- `E` activates nearby camp, garage, quest, ruin lift, door, chest, mechanism, and field-device interactions.
- `I` opens the Garage Loadout screen.
- Arm weapon salvage in the Garage has `1`-`4` loadout buttons for assigning it directly to a hotbar slot.

The current combat pass uses manual attacks, a four-slot arm hotbar, per-arm Energy/Output, fixed arm profiles, Guard Projector guarding/parrying, Barrier absorption, robotic status effects, elite armor weaknesses, and workshop-only Arms/Gear assignment. Incoming reactions have three authored levels: a short flinch, a longer braced shove, and a full airborne knockback/down/get-up sequence. Charges, player-damaging explosions, jaw snaps, and pounces use the third level.

Implemented arm behavior examples include arcing explosive `Grenade Arm` shots, piercing `Rail Buster Arm` rounds, close-range `Scatter Buster Arm` spread fire, and `Homing Seeker Arm` rounds that curve toward nearby targets.

## Procedural Reaverbots

Quadrupeds use paired eyelid armor over their ruby eye instead of offhand shield modules; the lids open during their attack tell.

Dungeon encounters now turn their roster intent, room archetype, room flavor, and encounter slot into a reproducible Reaverbot genome. Each generated enemy receives a compatible body plan, weapon, defense, weak point, behavior package, proportions, and behavior-linked palette. A validation pass rejects incompatible or unfair combinations before the enemy is built.

The ten behavior archetypes are:

- `Pursuer`: fast ram, jaw, or claw hunter with punishable recovery.
- `Shield Sentinel`: guards behind frontal protection, opens to attack, then exposes its linked weak point.
- `Pouncer`: circles, marks a predicted landing point, then commits to a spring leap, shock slam, or rocket-assisted Launch Leg impact.
- `Artillery Walker`: maintains range and fires pulse shells, lobbed mortars, or cluster explosives.
- `Zone Controller`: uses flamethrowers, mine-like explosives, or slow electric orbs that pulse repeatedly near the player.
- `Tractor Controller`: races between nearby allies, evades MegaMan, abducts one Reaverbot beneath its horseshoe magnet, and throws that machine near the player instead of attacking directly.
- `Aerial Bomber`: floats inward behind a cycling shell, exposes its core during a countdown, and self-destructs at close range.
- `Pack Hunter`: rapidly alternates between side and rear flanks, and abandons positioning requirements after 15 seconds without an attack.
- `Ruin Duelist`: sidesteps at close range and alternates guarded positioning with committed melee, piston, or beam attacks.
- `Rotor Hunter`: advances behind a rotating plate while its shared blade/flail assembly spins, alternating the guarded face with an opposite counterweight weak point.

Close-range weapon modules now carry a deliberately heavier combat contract. Claw carriers mount a Reaverbot-sized two-link hydraulic arm, extend it into MegaMan's lane for three horizontal or vertical swipes, drag their chassis forward under its weight, and vault low obstacles along collision-checked arcs. Launch Leg pouncers balance on one enormous three-link kangaroo leg, compress its exposed knee shock stack, ignite paired high-hip rockets, and land on three long claws with a wider impact wave and substantially higher jump arc. Jaw carriers are quadruped-only armored hunters that circle, strafe, hold a two-piece bear-trap mouth open, and hop through three red-blinking shockwave bites. Their full hinge-to-muzzle volume deals contact damage, and each snap wave tests MegaMan's vertical collision capsule rather than only his ground-level root point. Approaching attackers stop at the outer edge of their valid attack envelope while cooldown or attack-director ownership resolves, so authored telegraphs and attacks take priority over incidental body contact. All melee-tagged generations receive substantial armor and extra health, while Rotor Hunter blades deal contact damage throughout positioning, telegraph, attack, and recovery rather than only during a charge.

Air navigation is fully three-dimensional. Flyers ignore floor walkability, ledges, and railings, pursue along the most direct clear route, and climb over or route around actual walls, closed doors, platforms, and solid fixtures. Tractor Controllers use the same clearance system for both their own chassis and the full generated silhouette of their captive. A successful player hit briefly stalls their evasive flight; hitting one during an active abduction immediately drops and heavily damages both machines, leaves the Controller helpless on the floor, then lets a survivor relaunch. Blocked lift, carry, or throw paths are rejected before geometry can pass through the dungeon.

Generated silhouettes include bipeds, low bipeds, quadrupeds, crawlers, hoppers, tripods, hovering bells, and winged flyers. Spring Hoppers never skate across the floor: their coil legs compress into ballistic bounces, clear obstacles, and climb onto raised platforms. Their low-poly wedges, cones, segmented limbs, plates, spires, and circuit inlays follow the supplied PlayStation-era shape references. Archetype palettes remain consistent—ochre pursuers, blue-gray sentinels, olive pouncers, violet artillery, teal zone controllers, lavender tractor controllers, ivory bombers, sand-colored packs, burgundy duelists, and copper rotor hunters—while saturated red is reserved for the single dominant Reaverbot eye.

Enemy pacing and room participation share a common navigation contract. Procedural movement is 22% faster than the previous baseline, curated enemies are roughly 25–32% faster, and archetype-relative pacing remains intact. Encounter rosters spawn on spaced interior-room positions rather than corner tiles; authored or legacy corner points are pulled inward and revalidated for walkability and full-body clearance. Encounter enemies remember their arena center, progressively bias inward near its edges, probe their full footprint before entering walls or ledges, sidestep partial obstructions, and recover toward a verified open point instead of repeatedly sticking to the same wall.

Every generated weak point is now selected from a strict defense-specific pairing table, so it has a corresponding guard and a readable opening. Leg joints sit behind enlarged forward side plates and become lock-on targets only when those plates retract during recovery; eye shutters open with attacks; rear batteries reward flanking; and rotor counterweights appear only on the side opposite their shield. Defensive geometry intercepts projectile hits before weak-point bonus damage is evaluated. Lock-on and homing can aim at exposed weak points directly, and enough weak-point damage permanently breaks the linked defense with a module-specific consequence. Directional shields can fully nullify frontal buster shots, while flanking, attack windows, recovery windows, melee, and explosions provide explicit counters. Progression-critical bosses and keycard carriers are never assigned the self-destruct archetype.

Procedural Reaverbots carry a hidden, module-derived salvage profile covering behavior, chassis, red eye, weapon, defense, and weak point; native charge attackers add a seventh rocket-boost entry matching their visible propulsion rig. Salvage found in the field is always a generic unidentified-scrap pickup, represented by steel bolt, screw, and gear silhouettes so it remains distinct from glowing refractor crystals. The player Inventory exposes only the aggregate `unidentifiedScrap` count. Roll identifies the entire pending batch at her workshop and owns the resulting stockpile: most recovered units become bulk `identifiedScrap`, while a rare unit becomes a named part drawn only from the source Reaverbot's profile. That preserves readable hunting goals—Spring Hoppers can reveal Tempered Jump Springs and Pulse Cannon users can reveal Revolving Pulse Barrels—without revealing named parts before Roll examines them. Salvage is not Zenny, Research Data, or quest-board currency. The complete source tables, identification rules, and future recipe examples are in [the Reaverbot Salvage Design Guide](docs/REAVERBOT_SALVAGE_DESIGN.md).

## Boss Hunt: VA-RUK 09

`VA-RUK 09 · The Ascension Engine` is the dedicated Launch Leg Boss Hunt. Selecting it preserves the normal start zone, expedition camp, Roll, Support Car, garage, workshop, practice platforms, Key Seeker, and Ruin Lift, while replacing only the ordinary procedural ruin interior with the authored Vertical Transit Reliquary. No generic keycard, trap, conveyor, side-room, or ordinary interior encounter content is generated for that hunt. The Reliquary is a 64-unit-wide, 82-unit-tall dungeon-scale tower with three extended traversal chambers, a 68.5-unit ascent, and a 54-unit-diameter summit trial. Only sequence zero starts enabled; each registered boss impact activates its route surface and unlocks exactly the next launch vent, counterweight, bridge, or momentum platform, and the boss waits for MegaMan to reach that marked landing before advancing the route. Reaching each station exposes one of four Compression Seals. The first three seals create durable exact-order checkpoints, while the fourth seal and Perfected Compression Greave reward decision commit atomically before the boss dies. The summit vent uses an 18-unit vertical impulse and 8-unit horizontal guidance through the normal jump integrator, retaining air control for the radial landing.

Roll uses the Greave with a Tempered Jump Spring, a Stabilized Belly Core, and 12 Identified Scrap to fabricate Jump Springs. Equipping them reveals four otherwise hidden mastery ledges in the Reliquary—one per segment—whose 3.82-unit rises bypass the original boss-impact chains and are deliberately outside ordinary jump reach. The full encounter, persistence, art, and QA contract is documented in [the Ascension Engine implementation notes](docs/ASCENSION_ENGINE_IMPLEMENTATION_NOTES.md).

## Expedition Loop

The current prototype starts in a safe hub/camp approach, then pushes the player into a randomized ruin path:

- Enter the ruin directly from camp, or use the camp ruin lift as a shortcut.
- Clear Reaverbot rooms, collect keycards, open locked doors, cross or disable traps, and use override mechanisms.
- Bring all recovered unidentified scrap to Roll; her workshop identifies the full batch and stores the resulting identified scrap and named parts.
- Secure the Large Refractor in the shrine chamber.
- Use the extraction pad to return to camp, or pay Zenny at camp to reset the current ruin layout.

The Garage includes an Expedition Log that tracks the Large Refractor objective, required keycard route, and ruin override console. Its loadout uses the full panel instead of reserving a blank field-resource column; the exceptional Roll migration-recovery list appears only when an actionable item is waiting. Roll's workshop separately presents the unidentified-scrap batch and her identified-scrap and named-part stockpile.

## Procedural Vertical Factory Rooms

Generated ruin chambers are now planned as 3D volumes rather than flat footprints. Functional rooms receive a purpose, mood, environmental-story beat, flavor modifier, ceiling budget, tier map, ramps, supported catwalks, and a purposeful jump platform tied to loot, lore, controls, a hazard bypass, or a combat flank.

- The room catalog supports 15 industrial archetypes, from server crypts and fluid tanks to maintenance shafts and self-contained mini-dungeons.
- Flavor modifiers affect room lighting, hazards, encounter composition, reward chances, ambience metadata, props, and puzzle variants.
- Upper exits use paired portal sockets. The generator accepts a connection only when both room endpoints use the same elevation and connector type.
- A movement-aware platformability solver uses the same jump, ledge-climb, ramp, landing, clearance, and safe-drop envelope as the player controller.
- Required doors, keycards, mechanisms, chests, encounter spawns, the shrine, elevated bridges, and room tiers must all validate before a layout can be used. Invalid attempts are regenerated; an invalid dungeon is never returned.
- Elevated enemy spawn points and level-aware ramp navigation make upper decks tactically useful instead of decorative.
- A reusable volumetric prefab kit fills rooms with cylindrical water tanks, pumps, hand cranks, flywheel engines, open processing vats, massive monoliths, I-beam frames, cylinder arches, structural columns, and chain-link partitions. Their visible footprints also feed the runtime and solver collision maps.
- Ground connectors widen into service lanes and exploration alcoves with fenced machinery, lit arches, and girder transitions; locked-door throats remain intentionally narrow physical chokepoints.
- Purpose platforms are predominantly large textured solid volumes rather than isolated tiles. Long ramp runs render as continuous textured slopes with side walls extending to the floor, while catwalk scaffolding remains a supporting traversal type rather than the only platform language.
- The first required keycard sits on a three-tier reverent mechanical pyramid, and progression gates use paired hydraulic panels that slide laterally inside permanent machine-door frames.

For visual development, load `?roomPreview=<roomId>&roomPreviewLevel=<level>` to start at a generated room tier. Optional `roomPreviewFacing=north|south|east|west` fixes the initial view direction.

## Ruin Devices

Interactable field devices now spawn around the arena:

- `Refractor Surge` temporarily increases Energy and recharge, refills arm weapons, and may attract Reaverbots.
- `Overclock Terminal` boosts Rapid and cooling at the cost of Armor, then triggers a defense wave.
- `Repair Station` restores HP and can wake nearby security units.
- `Cooling Vent` reduces reload/cooldown pressure and creates a temporary cooling field.
- `Refractor Pylon` adds thermal, cryo, shock, or corrosive output for a short duration.
- `Salvage Cache` drops a robotic part and may spawn an elite guardian.

## Run

Serve the folder with any local static server, then open the shown localhost URL.

```powershell
node scripts/dev-server.mjs 5174
```

The app uses a browser import map for Three.js, so no package install is required for this prototype.

## Main Files

- `index.html` - app shell, HUD labels, and garage loadout panel.
- `src/main.js` - creates and starts the game.
- `src/Game.js` - scene, camera, loop, hitstop timing, expedition state, effects, hazards, enemy and loot coordination.
- `src/DungeonGenerator.js`, `src/DungeonController.js` - randomized 3D ruin rooms, elevation-aware portals, platformability, doors, keycards, traps, conveyors, mechanisms, shrine objective, and extraction flow.
- `src/IndustrialRoomArchetypes.js` - the 15-room industrial catalog, flavor effects, purpose, lore, layout, puzzle, encounter, reward, and verticality metadata.
- `src/TraversalCapabilities.js` - the shared player movement envelope used by physics, generated platforms, ramps, ledges, and the dungeon solver.
- `src/MapEventSystem.js` - interactable ruin devices, temporary field buffs, risky event rewards.
- `src/Player.js` - movement, health, stats, model animation, buster pose, and equipment hooks.
- `src/ModularHumanoid.js` - procedural modular humanoid fallback character.
- `src/LootSystem.js` and `src/equipment/` - unidentified scrap pickups plus authored fixed Arms/Gear catalogs and loadouts. `src/Item.js` is retained only as an unreferenced legacy source for old-save recovery tooling.
- `src/Enemy.js`, `src/EliteEnemy.js`, `src/EnemySpawner.js` - legacy enemy contract, elite traits, seeded encounter spawning.
- `src/reaverbots/` - procedural genome catalog and validator, seeded RNG, low-poly visual factory, target adapters, behavior state machines, defenses, weak points, and attacks.
- `src/CombatSystem.js`, `src/ProjectileSystem.js` - current combat prototype and projectile behavior.
- `src/buster/` - pure Custom Buster catalogs, graph validation/compiler, Roll fabrication persistence, deterministic trajectory helpers, and shared battery runtime.
- `src/Inventory.js`, `src/EquipmentManager.js`, `src/UIManager.js` - salvage inventory, garage equipment, UI.
- `src/ExternalModelRig.js` - segmented Mega Man Volnutt model rig, semantic rig application, buster arm pose, and action overlays.
- `src/SemanticRigMapper.js`, `src/animation/LocomotionAnimator.js`, `src/animation/UpperBodyAimLayer.js`, `src/animation/CombatAnimator.js`, `src/animation/DamageAnimator.js`, `src/animation/DodgeRollAnimator.js`, `src/animation/JumpAnimator.js` - semantic pose mapping, authored walk/jog clips, upper-body aim/recoil, combat poses, damage recovery, dodge, and jump action layers for the external segmented rig.
- `src/AnimationController.js` - procedural animation state timing, attacks, damage reactions, and full-body actions.
- `src/ui.css` - HUD and garage styling.

## Development Hooks

The running game exposes a few helpers on `window`:

```js
window.spawnElite('tank');
window.spawnReaverbot({ archetypeId: 'pouncer', seed: 'demo-pouncer' });
window.spawnReaverbot({ archetypeId: 'zoneController', seed: 'demo-orb', elite: true });
window.spawnCuratedReaverbot('horokko');
window.getReaverbotCatalog();
window.getReaverbotSalvageCatalog();
window.generateLoot('swordArm', 'legendary');
window.generateLoot('powerRaiser', 'prototype');
window.generateLoot('kevlarJacket', 'tuned');
window.openInventory();
window.setAnimationPreviewMode('walk');
window.setAnimationPreviewMode('aimJog');
window.setAnimationPreviewMode('off');
```

Add `?reaverbotSeed=<seed>` to the URL to reproduce the same procedural enemy stream and encounter-slot variants for a run. For example: `?reaverbotSeed=gallery-17`.

Animation preview can also be started from the URL with `?animationPreview=walk`, `?animationPreview=jog`, `?animationPreview=aimWalk`, `?animationPreview=aimJog`, `?animationPreview=strafeLeft`, `?animationPreview=strafeRight`, or `?animationPreview=backpedal`. Add `animationPreviewCamera=front`, `rear`, `left`, `right`, `frontLeft`, `frontRight`, `rearLeft`, `rearRight`, or `top` to lock the preview camera for gait review.
