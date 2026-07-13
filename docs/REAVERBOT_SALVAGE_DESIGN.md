# Procedural Reaverbot Salvage Design Guide

## Purpose

The salvage system turns the visible and behavioral identity of a procedural Reaverbot into a readable crafting economy. A player who needs a mobility part should hunt machines with the matching movement system; a player building a rapid-fire weapon should seek cannon-bearing machines rather than hope for an unrelated global drop.

The intended player thought process is:

> “That one has spring legs. It can drop the Tempered Jump Springs I still need for Jump Springs.”

This is implemented as a parallel system to generic `Reaverbot Scrap`. Generic scrap remains a currency for the existing quest board and research processor. Specific materials are stackable future crafting ingredients and do not consume equipment-inventory capacity.

## Runtime Contract

Most spawned procedural Reaverbots receive a six-entry salvage profile derived from their generated genome. Native charge attackers receive a seventh, visibly matched rocket-boost entry:

1. Behavior archetype
2. Body plan / locomotion
3. Ruby eye
4. Weapon module
5. Rocket-boost module (charge attackers only)
6. Defensive module
7. Weak-point module

Each entry maps to exactly one possible material. The same generated module always maps to the same material, so enemy recognition becomes useful knowledge.

Constructor Claw Reaverbots are the deliberate exception. Their claw is both their weapon and their active guard, so they have no generated defensive module or defensive-material entry. Their five-entry profile contains behavior, body, eye, weapon, and Claw Palm weak-point materials. Cosmetic side plating is not a defensive module and never adds a salvage roll.

On a normal defeat:

- Each profile entry makes an independent material roll: six for ordinary Reaverbots, seven for native charge attackers, and five for Constructor Claw carriers.
- If every roll fails, one body, weapon, rocket-boost, or defense material is guaranteed.
- Elite Reaverbots yield at least two different materials.
- Breaking the weak point before the kill substantially improves the weak-point material roll.
- Destroying a breakable weapon adds `+15 percentage points` to that exact weapon material roll, independently of the weak-point bonus. Destroying a Constructor Claw therefore improves both its Claw Palm Recoil Servo and Serrated Claw Gear rolls when both break conditions are reported.
- A Reaverbot that completes its own self-destruction follows the existing no-reward rule; destroying it before detonation yields normal salvage.
- Materials appear as physical steel bolt, screw, or gear pickups with a subtle material-family halo. They stack automatically, record their most recent source module, and appear in the Garage under **Recovered Reaverbot Materials**.

The bolt/screw/gear silhouette is intentionally cosmetic rather than a second crafting taxonomy. It makes mechanical salvage readable against the tall glowing crystal silhouette of refractor drops without asking the player to learn another material rule.

## Drop Chances

| Generated aspect | Base chance | Design reason |
|---|---:|---|
| Weapon | 40% | Weapon hunting should be the most reliable crafting path. |
| Body / locomotion | 34% | Supports recognizable traversal and mobility pursuits. |
| Defense | 34% | Makes shielded and armored silhouettes valuable targets. |
| Rocket boost | 32% | Makes the visible charge propulsion module a direct salvage target. |
| Weak point | 22% | Valuable core components require correct combat execution. |
| Behavior | 18% | Logic chips are specialized recipe gates rather than bulk metal. |
| Ruby eye | 8% | The universal eye remains a rare ancient optical component. |

Modifiers:

- Threat tier adds `+1.8 percentage points` per tier above Tier 1, capped at `+12 points`.
- Elite status adds `+14 points` to every aspect and guarantees at least two distinct materials.
- Breaking the weak point adds `+34 points` to its material roll.
- Destroying a weapon module adds `+15 points` to the matching weapon material roll.
- Individual chances are capped at 95%.

These are acquisition chances, not final recipe costs. Recipe quantities will be the primary long-term pacing control once crafting is implemented.

## Behavior Materials

| Reaverbot behavior | Possible material | Strong crafting signals | Example future uses |
|---|---|---|---|
| Pursuer | Behavior Chip: Pursuit | Tracking, speed, melee | Homing servos, dash weapons |
| Shield Sentinel | Behavior Chip: Sentry | Guarding, counters, targeting | Shield counters, guard turrets |
| Pouncer | Behavior Chip: Hunter | Jump prediction, impact | Jump Springs, pounce attacks |
| Artillery Walker | Ballistics Logic Chip | Arcing shots, prediction, range | Grenade launchers, mortar guidance |
| Zone Controller | Area-Control Logic Chip | Hazards, duration, space control | Mine layers, persistent elemental fields |
| Tractor Controller | Behavior Chip: Retrieval | Target acquisition, coordination, tractor control | Lift Arm controllers, salvage drones |
| Rotor Hunter | Gyroscopic Assault Chip | Spin, balance, charge | Rotor weapons, spinning guards |
| Aerial Bomber | Proximity Fuse Logic | Proximity, explosives, flight | Proximity mines, detonation triggers |
| Pack Hunter | Pack-Link Transceiver | Coordination, flanking, signals | Drone control, synchronized volleys |
| Ruin Duelist | Combat Prediction Chip | Counters, evasion, precision | Counter modules, precision melee arms |

## Body and Locomotion Materials

| Body plan / visible movement system | Possible material | Strong crafting signals | Example future uses |
|---|---|---|---|
| Broad Biped | Heavy Servo Frame | Load, stability, frame strength | Heavy arm weapons, stability braces |
| Needle Biped | Lightweight Servo Rod | Low inertia, speed, limbs | Dash skates, rapid mechanisms |
| Mechanical Quadruped | Articulated Paw Gearset | Traction, agility, four-legged motion | Traction boots, wall-grip modules |
| Tripod Idol | Three-Axis Stabilizer | Recoil control, gyros, stable aim | Cannon braces, aim stabilizers |
| Six-Leg Crawler Linkage | Crawler Leg Linkage | Ground traction, articulation, stability | All-terrain boots, multi-joint stabilizers |
| Four-Wheel Bogy Drive | Ancient Wheel Gearset | Speed, wheel drive, suspension | Dash skates, wheeled support carriers |
| Spring Hopper | Tempered Jump Spring | Jumping, stored force, mobility | Jump Springs, recoil launchers |
| Hovering Bell | Levitation Coil | Hovering, magnetic lift, aerial support | Hover boots, support drones |
| Winged Relic | Aerofoil Servo | Flight steering, lightweight control | Air-dash vanes, guided projectiles |

## Ruby Eye Material

| Eye module | Possible material | Strong crafting signals | Example future uses |
|---|---|---|---|
| Single Ruby Lens | Ruby Optic Lens | Ancient optics, lock-on, scanning | Lock-on optics, enemy scanners |

The eye is universal, but its low acquisition chance keeps it from becoming meaningless vendor trash.

## Weapon Materials

| Weapon module | Possible material | Strong crafting signals | Example future uses |
|---|---|---|---|
| Rocket Lance | Rocket Boost Coupler | Rocket impulse, propulsion, charge alignment | Dash boosters, rocket lances |
| Crushing Jaw | High-Torque Jaw Gear | Torque, gripping, crushing | Crusher arms, grappling tools |
| Claw Arm | Serrated Claw Gear | Sweeping blades, melee | Claw arms, saw attachments |
| Pounce Actuator | Compression Pounce Actuator | Leaping, stored compression, impact | Jump Springs, leaping strike arms |
| Shock Piston | Shockwave Piston | Ground impact, pistons, shockwaves | Ground-pound arms, impact hammers |
| Pulse Cannon | Revolving Pulse Barrel | Rapid direct fire, heat distribution | Machine Busters, rapid pulse cannons |
| Mortar Pod | High-Angle Launch Tube | Lobbed explosives, ballistic arcs | Grenade Arms, mortar launchers |
| Cluster Mortar | Cluster Burst Sequencer | Submunitions, payload timing | Cluster grenades, fragmenting shells |
| Arc Emitter | Arc Capacitor Coil | Slow electrical discharge, persistent orbs | Shock Busters, electric fields |
| Flame Nozzle | Ceramic Flame Nozzle | Heat resistance, cone projection | Flamethrower Arms, thermal cutters |
| Beam Prism | Ancient Focus Prism | Beam focusing, precision optics | Beam Busters, precision sights |
| Mine Dispenser | Proximity Mine Rack | Payload indexing, trap deployment | Mine layers, trap cartridges |
| Rotor Blade | Balanced Rotor Hub | Spinning blades, balance, bearings | Rotor Arms, spinning shield weapons |
| Horseshoe Tractor Magnet | Horseshoe Tractor Coil | Magnetic lift, tractor fields, launching | Lift Arms, magnetic launchers |
| Overload Core | Volatile Overload Cell | Burst energy, instability, explosives | Burst cartridges, detonation drones |

## Rocket-Boost Materials

| Charge module | Possible material | Strong crafting signals | Example future uses |
|---|---|---|---|
| Dorsal Spine Jet | Dorsal Rocket Combustor | Compact thrust, fire, quadruped charge | Boost modules, dash armor |
| Twin Rocket Pack | Twin-Jet Thrust Manifold | Balanced paired thrust, back mounting | Jetpacks, dash skates |
| Vectoring Belly Rocket | Vectoring Rocket Nozzle | Gimbaled impulse, aerial steering | Air dashes, guided launchers |

## Defensive Materials

| Defensive module | Possible material | Strong crafting signals | Example future uses |
|---|---|---|---|
| Directional Shield | Metal Shield Plating | Frontal protection, projectile blocking | Shield Arm, frontal armor |
| Armored Skull | Reinforced Cranial Plate | Impact armor, curved plates | Impact helmets, ram armor |
| Side Plates | Paired Alloy Plating | Limb guards, folding protection | Leg guards, folding shields |
| Armored Back | Curved Back Plate | Rear armor, pounce protection | Back armor, pounce guards |
| Armored Carapace | Layered Carapace Segment | Heavy overlapping armor | Heavy armor, crawler shells |
| Guard Arms | Guard Servo Brace | Bracing, counters, folding arms | Parry arms, weapon guards |
| Armor Shutters | Iris Shutter Segment | Timed opening, optic protection | Eye covers, charging shutters |
| Rotating Plates | Rotary Guard Bearing | Alternating shield faces, rotation | Spinning shields, rotor guards |
| Energy Membrane | Field Projector Mesh | Energy barriers, damping | Energy shields, Buster dampers |
| Phase Shell | Phase Oscillator | Timed intangibility, phase control | Phase dodges, flicker shields |
| Reactive Plate | Reactive Armor Tile | Directional adaptation, sensors | Adaptive armor, counter shields |

## Weak-Point Materials

| Weak-point module | Possible material | Strong crafting signals | Example future uses |
|---|---|---|---|
| Rear Battery | Ancient Battery Pack | Energy storage, weapon power | Energy tanks, weapon batteries |
| Belly Core | Stabilized Belly Core | Jump balance, impact damping | Jump Springs, impact dampers |
| Ruby Eye Aperture | Ruby Focusing Ring | Critical optics, precision | Critical sights, beam optics |
| Shield Hinge | Shield Pivot Joint | Deployment, folding joints | Deployable shields, folding parts |
| Ammunition Drum | Ammunition Feed Drum | Ballistic feeding, magazines | Machine Busters, grenade magazines |
| Cooling Vents | Cooling Fin Array | Heat recovery, sustained fire | Weapon coolers, flame resistance |
| Emitter Core | Charged Emitter Core | Electrical fields, stored charge | Shock Busters, field generators |
| Overload Core | Ruptured Overload Capacitor | Emergency overcharge, burst damage | Burst modules, overcharge circuits |
| Drive Joint | Precision Drive Bearing | Fast limbs, mobility, low friction | Dash skates, leg servos |
| Counterweight Core | Balanced Counterweight Core | Gyroscopic stability, spinning mass | Rotor weapons, stabilizers |
| Claw Palm Core | Claw Palm Recoil Servo | Recoil, counter timing, articulated claws | Countering claw arms, recoiling weapon guards |

## Example Future Recipes

Crafting is not implemented yet. These examples show how the current material vocabulary can support recognizable acquisition goals.

### Jump Springs

- 3× Tempered Jump Spring — hunt Spring Hopper body plans.
- 1× Behavior Chip: Hunter — hunt Pouncers.
- 1× Stabilized Belly Core — break and recover a Pouncer belly weak point.
- 2× Lightweight Servo Rod — hunt Needle Bipeds.

Resulting player goal: seek jumping enemies and execute their recovery punish correctly, rather than farm arbitrary scrap.

### Machine Buster

- 2× Revolving Pulse Barrel — hunt Pulse Cannon users.
- 1× Ammunition Feed Drum — break Artillery reload weak points.
- 1× Cooling Fin Array — hunt enemies with exposed cooling vents.
- 1× Ballistics Logic Chip — hunt Artillery Walkers.

### Shield Arm

- 3× Metal Shield Plating — hunt Directional Shield carriers.
- 1× Shield Pivot Joint — punish shield attack openings.
- 1× Behavior Chip: Sentry — hunt Shield Sentinels.
- 1× Field Projector Mesh — hunt Energy Membrane users.

### Shock Field Buster

- 2× Arc Capacitor Coil — hunt Arc Emitter users.
- 1× Charged Emitter Core — break the corresponding emitter weak point.
- 1× Area-Control Logic Chip — hunt Zone Controllers.
- 1× Ancient Battery Pack — recover exposed rear batteries.

### Rotor Arm

- 2× Balanced Rotor Hub — hunt Rotor Hunters.
- 1× Rotary Guard Bearing — defeat rotating-plate defenses.
- 1× Balanced Counterweight Core — shoot the side opposite the rotating shield.
- 1× Gyroscopic Assault Chip — recover the Rotor Hunter behavior routine.

### Tractor Lift Arm

- 2× Horseshoe Tractor Coil — hunt flying Tractor Controllers.
- 1× Behavior Chip: Retrieval — recover the controller's acquisition routine.
- 1× Levitation Coil — hunt Hovering Bell chassis.
- 1× Charged Emitter Core — break the field generator weak point.

Resulting player goal: prioritize the flying support machine that visibly abducts other Reaverbots, then break its field core to improve the chance of recovering tractor hardware.

## Player Readability Rules

- Material names should describe the visible source whenever possible.
- A recipe should use at least one visually obvious source material and at most one rare universal material.
- Behavior chips should gate a weapon's behavior, not provide its entire material cost.
- Weak-point materials should reward correct counterplay and be more efficient than raw-health farming.
- Common metal costs should come from body and defense materials; specialized functionality should come from weapons, behavior chips, and weak points.
- The red eye should remain valuable but should not appear in every recipe merely because every Reaverbot has one.

## Future Bestiary and Crafting UI

The runtime already exposes `window.getReaverbotSalvageCatalog()` and each procedural enemy stores `salvageProfile`. Future UI can use these without duplicating drop data.

Recommended additions:

- A bestiary entry that reveals a material after it is collected once.
- Recipe tracking that marks matching enemy silhouettes or encounter rooms.
- A “Known Sources” panel listing body plan, weapon, defense, and behavior sources.
- Dungeon-generation weighting for tracked recipes, with a strict cap so desired enemies become more likely without becoming guaranteed.
- Salvage quality tiers or intact-part bonuses for weak-point breaks, elite kills, and specific damage types.

## Implementation Map

- Catalog, source mappings, roll chances: `src/reaverbots/ReaverbotSalvageCatalog.js`
- Per-enemy five-, six-, or seven-part profile: `src/reaverbots/ReaverbotEnemy.js`
- Death drops and source metadata: `src/Game.js`
- Physical material pickups: `src/LootSystem.js`
- Stack storage and future recipe consumption: `src/Inventory.js`
- Garage material display: `index.html`, `src/UIManager.js`, `src/ui.css`
- Coverage and runtime tests: `tests/reaverbot-generation.test.mjs`, `tests/reaverbot-runtime.spec.js`

When a new procedural module is added, the catalog completeness test will fail until a corresponding material source is added. This keeps future Reaverbot generation and future crafting content synchronized.
