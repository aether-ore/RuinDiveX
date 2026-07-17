const ASPECT_COLORS = Object.freeze({
  behavior: '#c98bff',
  body: '#d7bd8a',
  eye: '#ff365b',
  weapon: '#ff9c55',
  charge: '#ff7138',
  defense: '#7fd6e8',
  weakPoint: '#ffd66b',
});

export const REAVERBOT_SALVAGE_ASPECTS = Object.freeze({
  behavior: { id: 'behavior', label: 'Behavior', baseDropChance: 0.18 },
  body: { id: 'body', label: 'Chassis / Locomotion', baseDropChance: 0.34 },
  eye: { id: 'eye', label: 'Ruby Eye', baseDropChance: 0.08 },
  weapon: { id: 'weapon', label: 'Weapon', baseDropChance: 0.4 },
  charge: { id: 'charge', label: 'Rocket Boost', baseDropChance: 0.32 },
  defense: { id: 'defense', label: 'Defense', baseDropChance: 0.34 },
  weakPoint: { id: 'weakPoint', label: 'Weak Point', baseDropChance: 0.22 },
});

function material(id, name, aspect, tier, craftingTags, exampleUses, description) {
  return Object.freeze({
    id,
    name,
    aspect,
    family: REAVERBOT_SALVAGE_ASPECTS[aspect].label,
    tier,
    craftingTags: Object.freeze([...craftingTags]),
    exampleUses: Object.freeze([...exampleUses]),
    description,
    color: ASPECT_COLORS[aspect],
  });
}

export const BEHAVIOR_SALVAGE = Object.freeze({
  pursuer: material('behaviorChipPursuit', 'Behavior Chip: Pursuit', 'behavior', 'specialized', ['tracking', 'speed', 'melee'], ['homing servos', 'dash weapons'], 'An intact pursuit routine that continually reacquires a moving target.'),
  shieldSentinel: material('behaviorChipSentry', 'Behavior Chip: Sentry', 'behavior', 'specialized', ['guard', 'counterattack', 'targeting'], ['shield counters', 'guard turrets'], 'A patient threat-assessment routine built around guarded counterattacks.'),
  pouncer: material('behaviorChipHunter', 'Behavior Chip: Hunter', 'behavior', 'specialized', ['jump', 'prediction', 'impact'], ['Jump Springs', 'pounce attacks'], 'A predictive hunting routine that calculates where a target will be when the leap lands.'),
  artillery: material('ballisticsLogicChip', 'Ballistics Logic Chip', 'behavior', 'specialized', ['ballistics', 'prediction', 'range'], ['grenade launchers', 'mortar guidance'], 'A firing solution processor for arcing shots and moving targets.'),
  zoneController: material('areaControlChip', 'Area-Control Logic Chip', 'behavior', 'specialized', ['area', 'hazard', 'duration'], ['mine layers', 'persistent elemental fields'], 'A spatial routine that identifies escape lanes and fills them with hazards.'),
  tractorController: material('behaviorChipRetrieval', 'Behavior Chip: Retrieval', 'behavior', 'rare', ['acquisition', 'coordination', 'tractor'], ['Lift Arm controllers', 'salvage drones'], 'A target-selection routine that chooses another machine, carries it in a stable field, and calculates a throw toward a moving threat.'),
  rotorHunter: material('gyroscopicAssaultChip', 'Gyroscopic Assault Chip', 'behavior', 'specialized', ['spin', 'balance', 'charge'], ['rotor weapons', 'spinning guards'], 'A combat routine that synchronizes forward movement with a rotating attack assembly.'),
  aerialBomber: material('proximityFuseLogic', 'Proximity Fuse Logic', 'behavior', 'specialized', ['proximity', 'explosive', 'aerial'], ['proximity mines', 'detonation triggers'], 'A compact target-distance evaluator designed to commit at lethal range.'),
  packHunter: material('packLinkTransceiver', 'Pack-Link Transceiver', 'behavior', 'specialized', ['coordination', 'flanking', 'signal'], ['drone control', 'coordinated weapon volleys'], 'A short-range coordination unit that shares attack timing with nearby machines.'),
  duelist: material('combatPredictionChip', 'Combat Prediction Chip', 'behavior', 'rare', ['counterattack', 'evasion', 'precision'], ['counter modules', 'precision melee arms'], 'A high-speed processor that alternates guarding, evasion, and committed strikes.'),
});

export const BODY_SALVAGE = Object.freeze({
  biped: material('heavyServoFrame', 'Heavy Servo Frame', 'body', 'common', ['frame', 'stability', 'load'], ['heavy arm weapons', 'stability braces'], 'Load-bearing hip and torso servos from a broad bipedal chassis.'),
  lowBiped: material('lightweightServoRod', 'Lightweight Servo Rod', 'body', 'common', ['lightweight', 'speed', 'limb'], ['dash skates', 'rapid arm mechanisms'], 'A thin, low-inertia actuator rod used by agile needle-legged machines.'),
  quadruped: material('articulatedPawGearset', 'Articulated Paw Gearset', 'body', 'common', ['traction', 'agility', 'quadruped'], ['traction boots', 'wall-grip modules'], 'A synchronized paw and ankle gearset made for fast four-legged pursuit.'),
  tripod: material('threeAxisGyro', 'Three-Axis Stabilizer', 'body', 'common', ['stability', 'recoil', 'gyro'], ['cannon braces', 'aim stabilizers'], 'A three-axis gyro that keeps top-mounted weapons level under recoil.'),
  crawler: material('crawlerTrackLink', 'Crawler Track Link', 'body', 'common', ['traction', 'armor', 'ground'], ['all-terrain boots', 'heavy carriers'], 'A dense linked tread segment made to carry armored frames over uneven floors.'),
  articulatedCrawler: material('crawlerLegLinkage', 'Crawler Leg Linkage', 'body', 'common', ['traction', 'articulated', 'ground'], ['all-terrain boots', 'multi-joint stabilizers'], 'A six-leg linkage with paired bearings built to keep an armored chassis planted on broken terrain.'),
  wheelBogies: material('ancientWheelGearset', 'Ancient Wheel Gearset', 'body', 'specialized', ['wheel', 'speed', 'mobility'], ['dash skates', 'wheeled support carriers'], 'A compact driven hub, suspension fork, and reduction gear recovered from a four-wheel Reaverbot bogy.'),
  hopper: material('temperedJumpSpring', 'Tempered Jump Spring', 'body', 'specialized', ['jump', 'spring', 'mobility'], ['Jump Springs', 'recoil launchers'], 'A high-tension leg spring prized for mobility upgrades and vertical traversal parts.'),
  hoverBell: material('levitationCoil', 'Levitation Coil', 'body', 'specialized', ['hover', 'magnetic', 'aerial'], ['hover boots', 'floating support drones'], 'A wound field coil that offsets the weight of a bell-shaped chassis.'),
  flyer: material('aerofoilServo', 'Aerofoil Servo', 'body', 'specialized', ['flight', 'steering', 'lightweight'], ['air-dash vanes', 'guided projectiles'], 'A lightweight wing servo capable of rapid directional corrections.'),
});

export const EYE_SALVAGE = Object.freeze({
  singleRubyLens: material('rubyOpticLens', 'Ruby Optic Lens', 'eye', 'rare', ['optic', 'lockOn', 'ancient'], ['lock-on optics', 'enemy scanners'], 'The signature red Reaverbot optic, intact enough to reuse as a targeting lens.'),
});

export const WEAPON_SALVAGE = Object.freeze({
  rocketLance: material('rocketBoostCoupler', 'Rocket Boost Coupler', 'weapon', 'specialized', ['rocket', 'boost', 'propulsion'], ['dash boosters', 'rocket lances'], 'A reinforced thrust coupling that transfers rocket impulse into a forward lance without twisting the chassis.'),
  crusherJaw: material('torqueJawGear', 'High-Torque Jaw Gear', 'weapon', 'common', ['torque', 'grip', 'melee'], ['crusher arms', 'grappling tools'], 'A compact reduction gear that produces crushing force at close range.'),
  clawArm: material('serratedClawGear', 'Serrated Claw Gear', 'weapon', 'common', ['blade', 'sweep', 'melee'], ['claw arms', 'saw attachments'], 'A toothed drive gear and cutting talon from a sweeping claw assembly.'),
  pounceActuator: material('compressionPounceActuator', 'Compression Pounce Actuator', 'weapon', 'specialized', ['jump', 'impact', 'actuator'], ['Jump Springs', 'leaping strike arms'], 'A rapid-release actuator that converts stored compression into a forward leap.'),
  launchLeg: material('rocketLaunchGreave', 'Rocket Launch Greave', 'weapon', 'rare', ['jump', 'rocket', 'leg', 'mobility'], ['Jump Springs', 'rocket boots', 'aerial jump upgrades'], 'The reinforced hip rocket, shock stack, and clawed landing gear from a Launch Leg. Its thrust hardware practically begs to become a jump upgrade.'),
  shockPiston: material('shockwavePiston', 'Shockwave Piston', 'weapon', 'specialized', ['impact', 'shockwave', 'piston'], ['ground pound arms', 'impact hammers'], 'A reinforced piston that transfers a downward strike into a ground wave.'),
  pulseCannon: material('revolvingPulseBarrel', 'Revolving Pulse Barrel', 'weapon', 'specialized', ['ballistic', 'rapid', 'barrel'], ['machine busters', 'rapid pulse cannons'], 'A rotating pulse chamber that distributes heat across repeated direct shots.'),
  mortarPod: material('highAngleLaunchTube', 'High-Angle Launch Tube', 'weapon', 'specialized', ['ballistic', 'lobbed', 'explosive'], ['grenade arms', 'mortar launchers'], 'A reinforced launch tube calibrated for arcing explosive shells.'),
  clusterMortar: material('clusterBurstSequencer', 'Cluster Burst Sequencer', 'weapon', 'rare', ['cluster', 'ballistic', 'payload'], ['cluster grenades', 'fragmenting shells'], 'A timed payload controller that separates one shell into multiple submunitions.'),
  arcEmitter: material('arcCapacitorCoil', 'Arc Capacitor Coil', 'weapon', 'specialized', ['electric', 'duration', 'capacitor'], ['shock busters', 'electric fields'], 'A slow-discharge coil used to sustain short-lived electrical orbs.'),
  flameNozzle: material('ceramicFlameNozzle', 'Ceramic Flame Nozzle', 'weapon', 'specialized', ['fire', 'cone', 'heatproof'], ['flamethrower arms', 'thermal cutters'], 'A heatproof ceramic nozzle that shapes burning fuel into a controlled cone.'),
  beamPrism: material('ancientFocusPrism', 'Ancient Focus Prism', 'weapon', 'rare', ['beam', 'focus', 'optic'], ['beam busters', 'precision optics'], 'An unusually clear prism that concentrates refractor energy into a straight beam.'),
  mineDispenser: material('proximityMineRack', 'Proximity Mine Rack', 'weapon', 'specialized', ['mine', 'payload', 'deployment'], ['mine layers', 'trap cartridges'], 'A compact indexing rack that arms and releases proximity charges.'),
  rotorBlade: material('balancedRotorHub', 'Balanced Rotor Hub', 'weapon', 'specialized', ['spin', 'blade', 'balance'], ['rotor arms', 'spinning shield weapons'], 'A precision hub that keeps blades and counterweights stable at attack speed.'),
  tractorMagnet: material('horseshoeTractorCoil', 'Horseshoe Tractor Coil', 'weapon', 'rare', ['magnetic', 'tractor', 'lift'], ['Lift Arms', 'magnetic launchers'], 'A horseshoe-shaped field winding capable of suspending and accelerating an entire Reaverbot chassis.'),
  overloadCore: material('volatileOverloadCell', 'Volatile Overload Cell', 'weapon', 'rare', ['explosive', 'energy', 'unstable'], ['burst cartridges', 'self-destruct drones'], 'A dangerously overcharged energy cell recovered before its final detonation.'),
});

export const CHARGE_SALVAGE = Object.freeze({
  spineJet: material('dorsalRocketCombustor', 'Dorsal Rocket Combustor', 'charge', 'specialized', ['rocket', 'fire', 'quadruped'], ['boost modules', 'dash armor'], 'A compact dorsal combustor designed to drive a low four-legged chassis through a committed charge.'),
  twinRocketPack: material('twinJetManifold', 'Twin-Jet Thrust Manifold', 'charge', 'specialized', ['rocket', 'jetpack', 'thrust'], ['jetpacks', 'dash skates'], 'A paired fuel-and-ignition manifold that keeps two back-mounted rocket nozzles firing in balance.'),
  vectorRocket: material('vectoringRocketNozzle', 'Vectoring Rocket Nozzle', 'charge', 'rare', ['rocket', 'vectoring', 'aerial'], ['air dashes', 'guided launchers'], 'A gimbaled heavy nozzle that angles beneath an aerial chassis to redirect its full impulse.'),
});

export const DEFENSE_SALVAGE = Object.freeze({
  directionalShield: material('metalShieldPlating', 'Metal Shield Plating', 'defense', 'common', ['shield', 'armor', 'frontal'], ['Shield Arm', 'frontal armor'], 'A broad forward plate intended to nullify direct incoming fire.'),
  armoredSkull: material('cranialArmorPlate', 'Reinforced Cranial Plate', 'defense', 'common', ['armor', 'impact', 'head'], ['impact helmets', 'ram armor'], 'A curved armor plate built to protect the front of an aggressive chassis.'),
  sidePlates: material('pairedAlloyPlating', 'Paired Alloy Plating', 'defense', 'common', ['armor', 'limb', 'guard'], ['leg guards', 'folding shields'], 'Matched forward plates that close around vulnerable leg or side mechanisms.'),
  armoredBack: material('curvedBackPlate', 'Curved Back Plate', 'defense', 'common', ['armor', 'carapace', 'rear'], ['back armor', 'pounce guards'], 'A single shaped plate that protects the upper body during an approach.'),
  armoredCarapace: material('layeredCarapaceSegment', 'Layered Carapace Segment', 'defense', 'common', ['armor', 'layered', 'heavy'], ['heavy armor', 'crawler shells'], 'An overlapping shell segment that spreads projectile force across a wide surface.'),
  guardArms: material('guardServoBrace', 'Guard Servo Brace', 'defense', 'specialized', ['guard', 'servo', 'counter'], ['parry arms', 'folding weapon guards'], 'A reinforced servo brace designed to hold crossed guard arms under fire.'),
  armorShutters: material('irisShutterSegment', 'Iris Shutter Segment', 'defense', 'specialized', ['shutter', 'optic', 'timing'], ['optic covers', 'charging weapon shutters'], 'One interlocking segment from an eye cover that opens only during attacks.'),
  rotatingPlates: material('rotaryGuardBearing', 'Rotary Guard Bearing', 'defense', 'specialized', ['rotating', 'shield', 'bearing'], ['spinning shields', 'rotor guards'], 'A low-friction bearing used to alternate a shield face and vulnerable machinery.'),
  energyMembrane: material('fieldProjectorMesh', 'Field Projector Mesh', 'defense', 'rare', ['energy', 'shield', 'mesh'], ['energy barriers', 'buster dampers'], 'A conductive mesh that distributes power across a temporary defensive field.'),
  phaseShell: material('phaseOscillator', 'Phase Oscillator', 'defense', 'rare', ['phase', 'timing', 'aerial'], ['phase dodges', 'flicker shields'], 'An ancient oscillator that periodically shifts a shell out of projectile contact.'),
  reactivePlate: material('reactiveArmorTile', 'Reactive Armor Tile', 'defense', 'specialized', ['reactive', 'armor', 'directional'], ['adaptive armor', 'counter shields'], 'A sensor-backed tile that braces itself against fire from the current threat direction.'),
});

export const WEAK_POINT_SALVAGE = Object.freeze({
  rearBattery: material('ancientBatteryPack', 'Ancient Battery Pack', 'weakPoint', 'specialized', ['energy', 'battery', 'rear'], ['energy tanks', 'weapon batteries'], 'A dense power pack exposed when its host finishes a committed maneuver.'),
  bellyCore: material('stabilizedBellyCore', 'Stabilized Belly Core', 'weakPoint', 'rare', ['core', 'stability', 'jump'], ['Jump Springs', 'impact dampers'], 'A protected lower core that balances violent jumps and landings.'),
  eyeLens: material('rubyFocusingRing', 'Ruby Focusing Ring', 'weakPoint', 'rare', ['optic', 'precision', 'ancient'], ['critical optics', 'beam sights'], 'The focusing collar surrounding a Reaverbot eye that doubles as a vulnerable attack aperture.'),
  shieldHinge: material('shieldPivotJoint', 'Shield Pivot Joint', 'weakPoint', 'specialized', ['shield', 'joint', 'deployment'], ['deployable shields', 'folding arm parts'], 'A load-bearing joint exposed when a shield moves out of its guarding position.'),
  ammoDrum: material('ammunitionFeedDrum', 'Ammunition Feed Drum', 'weakPoint', 'specialized', ['ammo', 'feed', 'ballistic'], ['machine busters', 'grenade magazines'], 'An indexed feed drum vulnerable during the weapon reload cycle.'),
  coolingVents: material('coolingFinArray', 'Cooling Fin Array', 'weakPoint', 'specialized', ['cooling', 'heat', 'recovery'], ['weapon coolers', 'flame resistance'], 'A high-surface-area vent array exposed while overheated systems recover.'),
  emitterCore: material('chargedEmitterCore', 'Charged Emitter Core', 'weakPoint', 'rare', ['electric', 'emitter', 'energy'], ['shock busters', 'field generators'], 'A still-charged core that powers persistent electrical hazards.'),
  overloadCore: material('rupturedOverloadCapacitor', 'Ruptured Overload Capacitor', 'weakPoint', 'rare', ['explosive', 'capacitor', 'unstable'], ['burst damage modules', 'emergency overcharge circuits'], 'A damaged capacitor recovered from an interrupted detonation sequence.'),
  legJoint: material('precisionDriveBearing', 'Precision Drive Bearing', 'weakPoint', 'specialized', ['joint', 'speed', 'mobility'], ['dash skates', 'leg servos'], 'A tight-tolerance bearing normally hidden behind retracting leg armor.'),
  counterweightCore: material('balancedCounterweightCore', 'Balanced Counterweight Core', 'weakPoint', 'rare', ['balance', 'spin', 'core'], ['rotor weapons', 'gyroscopic stabilizers'], 'A dense balancing core mounted opposite a rotating shield.'),
  clawPalm: material('clawPalmRecoilServo', 'Claw Palm Recoil Servo', 'weakPoint', 'rare', ['claw', 'recoil', 'counter'], ['countering claw arms', 'recoiling weapon guards'], 'A compact overload servo surrounding the exposed palm core, built to wrench the entire claw away from a well-placed hit.'),
});

/**
 * Guaranteed signature recoveries exist in the shared material registry but
 * deliberately do not participate in ordinary procedural source maps. This
 * keeps progression keystones tied to their authored hunt transaction.
 */
export const REAVERBOT_BOSS_SALVAGE = Object.freeze({
  perfectedCompressionGreave: material(
    'perfectedCompressionGreave',
    'Perfected Compression Greave',
    'weapon',
    'keystone',
    ['jump', 'compression', 'rocket', 'leg', 'mobility', 'boss'],
    ['Jump Springs', 'high-energy launch systems'],
    'The Ascension Engine\'s intact four-seal compression spine, twin booster manifold, and claw-bearing drive housing. Roll can turn its controlled release into a permanent jump upgrade.',
  ),
});

export const REAVERBOT_SALVAGE_SOURCE_MAPS = Object.freeze({
  behavior: BEHAVIOR_SALVAGE,
  body: BODY_SALVAGE,
  eye: EYE_SALVAGE,
  weapon: WEAPON_SALVAGE,
  charge: CHARGE_SALVAGE,
  defense: DEFENSE_SALVAGE,
  weakPoint: WEAK_POINT_SALVAGE,
});

export const REAVERBOT_SALVAGE_MATERIALS = Object.freeze(Object.fromEntries(
  [
    ...Object.values(REAVERBOT_SALVAGE_SOURCE_MAPS)
      .flatMap((sourceMap) => Object.values(sourceMap)),
    ...Object.values(REAVERBOT_BOSS_SALVAGE),
  ]
    .map((entry) => [entry.id, entry]),
));

function createCandidate(aspect, moduleId, moduleLabel) {
  const salvage = REAVERBOT_SALVAGE_SOURCE_MAPS[aspect]?.[moduleId];
  if (!salvage) return null;
  return Object.freeze({
    aspect,
    aspectLabel: REAVERBOT_SALVAGE_ASPECTS[aspect].label,
    moduleId,
    moduleLabel,
    materialId: salvage.id,
    material: salvage,
  });
}

export function createReaverbotSalvageProfile(genome) {
  if (!genome) return Object.freeze([]);

  // A spring conversion is the meaningful chassis/locomotion module on a
  // pouncer, even when the underlying silhouette remains quadrupedal. This
  // keeps the visible promise of spring legs tied to Tempered Jump Springs.
  const bodySalvageId = genome.body?.mobilitySalvageId ?? genome.body?.planId;
  const bodySalvageLabel = genome.body?.mobilityLabel ?? genome.body?.label;

  return Object.freeze([
    createCandidate('behavior', genome.archetypeId, genome.archetypeLabel),
    createCandidate('body', bodySalvageId, bodySalvageLabel),
    createCandidate('eye', genome.modules?.eye?.id, 'Ruby Reaverbot Eye'),
    createCandidate('weapon', genome.modules?.weapon?.id, genome.modules?.weapon?.label),
    createCandidate('charge', genome.modules?.charge?.id, genome.modules?.charge?.label),
    createCandidate('defense', genome.modules?.defense?.id, genome.modules?.defense?.label),
    createCandidate('weakPoint', genome.modules?.weakPoint?.id, genome.modules?.weakPoint?.label),
  ].filter(Boolean));
}

function chooseCandidate(candidates, random) {
  if (candidates.length === 0) return null;
  const roll = Math.min(0.999999, Math.max(0, Number(random()) || 0));
  return candidates[Math.floor(roll * candidates.length)] ?? candidates[0];
}

function chooseWeightedCandidate(candidates, random, weightForCandidate) {
  if (candidates.length === 0) return null;
  const totalWeight = candidates.reduce(
    (total, candidate) => total + Math.max(0, weightForCandidate(candidate)),
    0,
  );
  if (totalWeight <= 0) return chooseCandidate(candidates, random);

  let roll = Math.min(0.999999, Math.max(0, Number(random()) || 0)) * totalWeight;
  for (const candidate of candidates) {
    roll -= Math.max(0, weightForCandidate(candidate));
    if (roll <= 0) return candidate;
  }
  return candidates.at(-1) ?? null;
}

function createDrop(candidate, quantity = 1) {
  return {
    ...candidate.material,
    quantity,
    source: {
      aspect: candidate.aspect,
      aspectLabel: candidate.aspectLabel,
      moduleId: candidate.moduleId,
      moduleLabel: candidate.moduleLabel,
    },
  };
}

export function rollReaverbotSalvageDrops(genome, {
  random = Math.random,
  isElite = false,
  weakPointBroken = false,
  brokenWeaponModuleId = null,
} = {}) {
  const profile = createReaverbotSalvageProfile(genome);
  if (profile.length === 0) return [];

  const tierBonus = Math.min(0.035, Math.max(0, (genome.threatTier ?? 1) - 1) * 0.007);
  const recoveryChance = Math.min(
    0.32,
    0.07
      + tierBonus
      + (isElite ? 0.09 : 0)
      + (weakPointBroken ? 0.055 : 0)
      + (brokenWeaponModuleId ? 0.025 : 0),
  );
  if (random() >= recoveryChance) return [];

  const recovered = chooseWeightedCandidate(profile, random, (candidate) => {
    const baseWeight = REAVERBOT_SALVAGE_ASPECTS[candidate.aspect]?.baseDropChance ?? 0.1;
    const weakPointWeight = candidate.aspect === 'weakPoint' && weakPointBroken ? 0.62 : 0;
    const brokenWeaponWeight = candidate.aspect === 'weapon'
      && candidate.moduleId === brokenWeaponModuleId
      ? 0.5
      : 0;
    return baseWeight + weakPointWeight + brokenWeaponWeight;
  });

  return recovered ? [createDrop(recovered)] : [];
}

export function getReaverbotSalvageCatalogSummary() {
  return {
    aspects: Object.values(REAVERBOT_SALVAGE_ASPECTS).map((aspect) => ({ ...aspect })),
    sourceMaps: Object.fromEntries(Object.entries(REAVERBOT_SALVAGE_SOURCE_MAPS).map(([aspect, sourceMap]) => [
      aspect,
      Object.fromEntries(Object.entries(sourceMap).map(([moduleId, salvage]) => [moduleId, salvage.id])),
    ])),
    materials: Object.values(REAVERBOT_SALVAGE_MATERIALS).map((entry) => ({ ...entry })),
    bossOnlyMaterialIds: Object.values(REAVERBOT_BOSS_SALVAGE).map((entry) => entry.id),
  };
}
