# Mega Man Legends-Inspired Ruin Crawler Prototype

A procedural Three.js third-person ruin-crawler prototype with Mega Man Legends-inspired robotic salvage, arm weapons, buster upgrades, Kevlar and alloy armor, elite Reaverbot-style encounters, loot pickups, expedition objectives, and a garage loadout screen.

The equipment foundation now uses robotic part categories instead of fantasy RPG gear:

- Arm Weapons: `Buster Arm`, `Sword Arm`, `Drill Arm`, `Shield Arm`, `Cannon Arm`, `Grenade Arm`, `Machine Gun Arm`, `Rail Buster Arm`, `Scatter Buster Arm`, `Homing Seeker Arm`, and elemental arm parts.
- Buster Parts: `Power Raiser`, `Range Booster`, `Rapid Fire Unit`, `Energy Battery`, `Sniper Scope`, and `Heat Sink Core`.
- Armor and Sensor Gear: `Kevlar Jacket`, `Alloy Chest Plate`, `Refractor-Lined Armor`, `Utility Helmet`, and `Lock-On Visor`.
- Mobility Gear: `Servo Boots`, `Jet Skates`, and `Magnetic Soles`.
- Utility Salvage: `Reactor Chip`, `Capacitor Module`, `Targeting Chip`, `Energy Cartridge`, `Adapter Plug`, and `Refractor Core`.

Primary weapon stats follow the intended buster-part language:

- `Attack`: single hit, shot, beam pulse, slash, or explosion impact.
- `Energy`: burst capacity before reload, recharge, or heat venting.
- `Range`: projectile distance, blade reach, beam length, or lock-on distance.
- `Rapid`: firing rhythm, swing speed, drill tick rate, or launch interval.

For the standard Buster Arm, Energy is not ammo. Buster shots are unlimited; Energy improves Output efficiency so the starting ENG 6 buster fires three rapid shots before Output is fully drained, with each additional 3 Energy adding another full shot to the burst.

## Controls

- WASD or arrow keys move.
- Hold `Shift` while moving to jog.
- `Space` jumps; jump direction follows the current movement input.
- `Q` performs a short dodge roll in the current movement direction.
- Mouse aims; the cyan reticle marks the current ground target.
- Hold left mouse to fire or swing the active arm weapon.
- Right mouse uses a secondary arm function when available. With `Shield Arm` equipped, it raises a timed guard; early timing parries and staggers attackers. Otherwise it manually vents/reloads the active arm weapon when Energy is not full.
- Number keys `1` through `4` switch arm weapon slots.
- `E` activates nearby camp, garage, quest, ruin lift, door, chest, mechanism, and field-device interactions.
- `I` opens the Garage Loadout screen.
- Arm weapon salvage in the Garage has `1`-`4` loadout buttons for assigning it directly to a hotbar slot.

The current combat pass uses manual attacks, a four-slot arm hotbar, per-arm Energy, reload timers, swap delay, distinct arm projectile behaviors, Shield Arm secondary guarding/parrying, robotic status effects, elite armor weaknesses, temporary map-event buffs, and direct Garage hotbar assignment. Additional weapon-specific secondary functions and drag/drop polish are still future work.

Implemented arm behavior examples include arcing explosive `Grenade Arm` shots, piercing `Rail Buster Arm` rounds, close-range `Scatter Buster Arm` spread fire, and `Homing Seeker Arm` rounds that curve toward nearby targets.

## Procedural Reaverbots

Dungeon encounters now turn their roster intent, room archetype, room flavor, and encounter slot into a reproducible Reaverbot genome. Each generated enemy receives a compatible body plan, weapon, defense, weak point, behavior package, proportions, and behavior-linked palette. A validation pass rejects incompatible or unfair combinations before the enemy is built.

The nine behavior archetypes are:

- `Pursuer`: fast ram, jaw, or claw hunter with punishable recovery.
- `Shield Sentinel`: guards behind frontal protection, opens to attack, then exposes its linked weak point.
- `Pouncer`: circles, marks a predicted landing point, commits to a leap or shock slam, and exposes its belly during recovery.
- `Artillery Walker`: maintains range and fires pulse shells, lobbed mortars, or cluster explosives.
- `Zone Controller`: uses flamethrowers, mine-like explosives, or slow electric orbs that pulse repeatedly near the player.
- `Aerial Bomber`: floats inward behind a cycling shell, exposes its core during a countdown, and self-destructs at close range.
- `Pack Hunter`: flanks and attacks only while another member of its encounter remains nearby.
- `Ruin Duelist`: sidesteps at close range and alternates guarded positioning with committed melee, piston, or beam attacks.
- `Rotor Hunter`: advances behind a rotating plate while its shared blade/flail assembly spins, alternating the guarded face with an opposite counterweight weak point.

Generated silhouettes include bipeds, low bipeds, quadrupeds, crawlers, hoppers, tripods, hovering bells, and winged flyers. Their low-poly wedges, cones, segmented limbs, plates, spires, and circuit inlays follow the supplied PlayStation-era shape references. Archetype palettes remain consistent—ochre pursuers, blue-gray sentinels, olive pouncers, violet artillery, teal controllers, ivory bombers, sand-colored packs, burgundy duelists, and copper rotor hunters—while saturated red is reserved for the single dominant Reaverbot eye.

Every generated weak point is now selected from a strict defense-specific pairing table, so it has a corresponding guard and a readable opening. Leg joints sit behind enlarged forward side plates and become lock-on targets only when those plates retract during recovery; eye shutters open with attacks; rear batteries reward flanking; and rotor counterweights appear only on the side opposite their shield. Defensive geometry intercepts projectile hits before weak-point bonus damage is evaluated. Lock-on and homing can aim at exposed weak points directly, and enough weak-point damage permanently breaks the linked defense with a module-specific consequence. Directional shields can fully nullify frontal buster shots, while flanking, attack windows, recovery windows, melee, and explosions provide explicit counters. Progression-critical bosses and keycard carriers are never assigned the self-destruct archetype.

## Expedition Loop

The current prototype starts in a safe hub/camp approach, then pushes the player into a randomized ruin path:

- Enter the ruin directly from camp, or use the camp ruin lift as a shortcut.
- Clear Reaverbot rooms, collect keycards, open locked doors, cross or disable traps, and use override mechanisms.
- Process recovered Reaverbot scrap at the camp research station for Research Data and Zenny.
- Secure the Large Refractor in the shrine chamber.
- Use the extraction pad to return to camp, or pay Zenny at camp to reset the current ruin layout.

The Garage includes an Expedition Log that tracks the Large Refractor objective, required keycard route, ruin override console, Reaverbot scrap contract, and research processing.

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
- `src/LootSystem.js` and `src/Item.js` - robotic part generation, salvage rarity, affixes, pickups.
- `src/Enemy.js`, `src/EliteEnemy.js`, `src/EnemySpawner.js` - legacy enemy contract, elite traits, seeded encounter spawning.
- `src/reaverbots/` - procedural genome catalog and validator, seeded RNG, low-poly visual factory, target adapters, behavior state machines, defenses, weak points, and attacks.
- `src/CombatSystem.js`, `src/ProjectileSystem.js` - current combat prototype and projectile behavior.
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
