# Procedural Reaverbot Salvage Design Guide

## Purpose

The salvage system turns the visible and behavioral identity of a procedural Reaverbot into a readable crafting economy. A player who needs a mobility part should hunt machines with the matching movement system; a player building a rapid-fire weapon should seek cannon-bearing machines rather than hope for an unrelated global drop.

The intended player thought process is:

> “That one has spring legs. Its scrap might contain the Tempered Jump Springs I still need; Roll can tell me.”

The field layer intentionally hides that specificity. Every salvage pickup is unidentified scrap, and the player Inventory exposes only an aggregate `unidentifiedScrap` count. Roll identifies the complete pending batch at her workshop and owns both the bulk `identifiedScrap` result and every named part she discovers. Salvage is a crafting stockpile, not Zenny, Research Data, or quest-board currency.

## Runtime Contract

Most spawned procedural Reaverbots receive a six-entry salvage profile derived from their generated genome. Native charge attackers receive a seventh, visibly matched rocket-boost entry:

1. Behavior archetype
2. Body plan / locomotion
3. Ruby eye
4. Weapon module
5. Rocket-boost module (charge attackers only)
6. Defensive module
7. Weak-point module

Each entry maps to exactly one possible named part. The same generated module always maps to the same part, so enemy recognition remains useful even though the field pickup itself is unidentified.

Constructor Claw Reaverbots are the deliberate exception. Their claw is both their weapon and their active guard, so they have no generated defensive module or defensive-part entry. Their five-entry profile contains behavior, body, eye, weapon, and Claw Palm weak-point candidates. Cosmetic side plating is not a defensive module and never adds a profile entry.

The runtime contract is:

- Eligible salvage rewards appear in the field only as unidentified scrap. No pickup reveals or grants a named part directly.
- A field pickup can carry multiple scrap units. Collecting it increments the Inventory-facing `unidentifiedScrap` count while its source-profile provenance remains hidden in the pending workshop batch.
- Roll's workshop offers one **Identify All** action. It resolves every pending unit, clears the unidentified count, and writes all results to Roll's stockpile rather than back into the player Inventory.
- Most recovered units add ordinary `identifiedScrap`. At most one unit from a qualifying Reaverbot recovery can instead become a rare named part, and its candidates come only from that source Reaverbot's salvage profile.
- Breaking a weak point can improve the rare outcome for that profile's weak-point part. Destroying a breakable weapon can improve the matching weapon-part outcome. Neither event creates a named pickup in the field.
- Elite and higher-threat Reaverbots may provide more identification opportunities or improve rare-part odds, but they still use the same unidentified-pickup and Roll-identification pipeline.
- A Reaverbot that completes its own self-destruction follows the no-reward rule; destroying it before detonation can produce normal unidentified salvage.

The bolt/screw/gear silhouette is intentionally cosmetic rather than a second crafting taxonomy. A neutral treatment identifies it only as mechanical salvage and keeps it readable against tall glowing refractor crystals without leaking the hidden named-part result.

## Drop and Identification Chances

Acquisition now has two separate gates:

| Stage | Common result | Rare result |
|---|---|---|
| Field drop | One unidentified-scrap pickup carrying one or more units | None; named parts never drop in the field |
| Roll's workshop | Bulk `identifiedScrap` in Roll's stockpile | A named part selected from that scrap's source profile |

Field recovery uses these current rates:

| Defeated Reaverbot | Unidentified-pickup chance | Scrap units in that pickup |
|---|---:|---:|
| Ordinary | 42% | 1, with an 18% chance of 1 extra |
| Legacy heavy types (`gorubesshu`, `horokko`, `sharukurusu`) | 58% | 1, with an 18% chance of 1 extra |
| Elite | 92% | 2, with an 18% chance of 1 extra |

For a procedural Reaverbot, a successful field recovery also receives one hidden intact-part check. Its base chance is 7%, with the following additive modifiers before a 32% cap:

- `+0.7 percentage points` per threat tier above Tier 1, capped at `+3.5 points`.
- `+9 points` for an elite.
- `+5.5 points` when its weak point was broken.
- `+2.5 points` when a breakable weapon was destroyed.

Passing that rare check does not open a global part table. It selects at most one candidate from only the behavior, body, eye, weapon, rocket-boost, defense, and weak-point entries actually present on the source Reaverbot. These aspect values are relative selection weights, not independent drop probabilities:

| Generated aspect | Base selection weight | Design reason |
|---|---:|---|
| Weapon | 40 | Weapon hunting should be the most reliable named-part path. |
| Body / locomotion | 34 | Supports recognizable traversal and mobility pursuits. |
| Defense | 34 | Makes shielded and armored silhouettes valuable targets. |
| Rocket boost | 32 | Makes the visible charge propulsion module a direct salvage signal. |
| Weak point | 22 | Valuable core components reward correct combat execution. |
| Behavior | 18 | Logic chips remain specialized recipe gates rather than bulk metal. |
| Ruby eye | 8 | The universal eye remains a rare ancient optical component. |

Breaking a weak point adds `62` selection weight only to its weak-point candidate. Destroying a weapon adds `50` selection weight only to the matching weapon candidate. These bonuses improve the appropriate result without making unrelated parts more likely. When Roll identifies the batch, the hidden named part consumes one unit from its recovery and all remaining units become `identifiedScrap`.

These rates are acquisition tuning, not final recipe costs. The named-part tables below define valid profile-specific identification outcomes, not direct field pickups. Recipe quantities remain the primary long-term pacing control once crafting is implemented.

## Behavior Parts

| Reaverbot behavior | Possible named part | Strong crafting signals | Example future uses |
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

## Body and Locomotion Parts

| Body plan / visible movement system | Possible named part | Strong crafting signals | Example future uses |
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

## Ruby Eye Part

| Eye module | Possible named part | Strong crafting signals | Example future uses |
|---|---|---|---|
| Single Ruby Lens | Ruby Optic Lens | Ancient optics, lock-on, scanning | Lock-on optics, enemy scanners |

The eye is universal, but its low acquisition chance keeps it from becoming meaningless vendor trash.

## Weapon Parts

| Weapon module | Possible named part | Strong crafting signals | Example future uses |
|---|---|---|---|
| Rocket Lance | Rocket Boost Coupler | Rocket impulse, propulsion, charge alignment | Dash boosters, rocket lances |
| Crushing Jaw | High-Torque Jaw Gear | Torque, gripping, crushing | Crusher arms, grappling tools |
| Claw Arm | Serrated Claw Gear | Sweeping blades, melee | Claw arms, saw attachments |
| Pounce Actuator | Compression Pounce Actuator | Leaping, stored compression, impact | Jump Springs, leaping strike arms |
| Launch Leg | Rocket Launch Greave | Rocket-assisted jumping, clawed landing gear, mobility | Jump Springs, rocket boots, aerial jump upgrades |
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

## Rocket-Boost Parts

| Charge module | Possible named part | Strong crafting signals | Example future uses |
|---|---|---|---|
| Dorsal Spine Jet | Dorsal Rocket Combustor | Compact thrust, fire, quadruped charge | Boost modules, dash armor |
| Twin Rocket Pack | Twin-Jet Thrust Manifold | Balanced paired thrust, back mounting | Jetpacks, dash skates |
| Vectoring Belly Rocket | Vectoring Rocket Nozzle | Gimbaled impulse, aerial steering | Air dashes, guided launchers |

## Defensive Parts

| Defensive module | Possible named part | Strong crafting signals | Example future uses |
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

## Weak-Point Parts

| Weak-point module | Possible named part | Strong crafting signals | Example future uses |
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

Crafting is not implemented yet. These examples show how the current named-part vocabulary can support recognizable acquisition goals.

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

- Part names should describe the visible source whenever possible.
- A recipe should use at least one visually obvious source part and at most one rare universal part.
- Behavior chips should gate a weapon's behavior, not provide its entire part cost.
- Weak-point parts should reward correct counterplay and be more efficient than raw-health farming.
- Common metal costs should come from body and defense parts; specialized functionality should come from weapons, behavior chips, and weak points.
- The red eye should remain valuable but should not appear in every recipe merely because every Reaverbot has one.

## Future Bestiary and Crafting UI

The runtime already exposes `window.getReaverbotSalvageCatalog()` and each procedural enemy stores `salvageProfile`. Future UI can use these without duplicating drop data.

Recommended additions:

- A bestiary entry that reveals a named part after Roll identifies it once.
- Recipe tracking that marks matching enemy silhouettes or encounter rooms.
- A “Known Sources” panel listing body plan, weapon, defense, and behavior sources.
- Dungeon-generation weighting for tracked recipes, with a strict cap so desired enemies become more likely without becoming guaranteed.
- Salvage quality tiers or intact-part bonuses for weak-point breaks, elite kills, and specific damage types.

## Implementation Map

- Catalog, source mappings, roll chances: `src/reaverbots/ReaverbotSalvageCatalog.js`
- Per-enemy five-, six-, or seven-part profile: `src/reaverbots/ReaverbotEnemy.js`
- Field drop eligibility and hidden source-profile recovery metadata: `src/Game.js`
- Physical unidentified-scrap pickups: `src/LootSystem.js`
- Player-facing unidentified count and pending recovery handoff: `src/Inventory.js`
- Roll-owned identified scrap, named-part stacks, and future recipe consumption: `src/RollSalvageStorage.js`
- Roll workshop identification and stockpile display: `index.html`, `src/UIManager.js`, `src/ui.css`
- Coverage and runtime tests: `tests/reaverbot-generation.test.mjs`, `tests/reaverbot-runtime.spec.js`

When a new procedural module is added, the catalog completeness test will fail until a corresponding named-part source is added. This keeps future Reaverbot generation and future crafting content synchronized.
