/**
 * Industrial factory room metadata.
 *
 * This module intentionally contains data only: it has no Three.js dependency and
 * can be consumed by generation, validation, UI, and test code alike.
 */

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};

const cloneMetadata = (value) => {
  if (Array.isArray(value)) return value.map(cloneMetadata);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, cloneMetadata(nestedValue)]),
    );
  }
  return value;
};

const matchedExit = (
  id,
  elevation,
  connectorTypes,
  {
    required = false,
    destinationTags = [],
    notes = '',
  } = {},
) => ({
  id,
  elevation,
  connectorTypes,
  required,
  destinationTags,
  requiresMatchingDestinationElevation: true,
  requiresValidatedRouteFromRoomEntrance: true,
  notes,
});

const archetypes = [
  {
    id: 'ancient_server_crypt',
    displayName: 'Ancient Server Crypt',
    purpose: 'Archives refractor-era memory inside shrine-like data machinery and protects access to sealed records.',
    mood: 'Hushed, uncanny, and reverent; the buried archive seems to notice intruders.',
    sizeCategory: 'medium',
    heightCategory: 'tall',
    layoutTags: ['server', 'alien-tech', 'archive', 'puzzle', 'vertical', 'maze'],
    layoutVariants: [
      { id: 'grid_archive', displayName: 'Grid Archive', topology: 'Rows of monoliths form readable aisles and line-of-sight breaks.' },
      { id: 'circular_data_core', displayName: 'Circular Data Core', topology: 'A ring route and upper catwalk surround one central memory pillar.' },
      { id: 'vertical_server_shaft', displayName: 'Vertical Server Shaft', topology: 'Stacked server decks climb around the chamber wall.' },
      { id: 'collapsed_archive', displayName: 'Collapsed Archive', topology: 'Fallen monoliths produce cover, detours, and a salvage alcove.' },
    ],
    requiredFeatures: ['server_pillars', 'cable_floor_trenches', 'glyph_control_terminal', 'readable_critical_aisle'],
    optionalFeatures: ['upper_catwalk', 'refractor_data_core', 'locked_side_archive', 'rotating_memory_disks', 'cooling_obelisks'],
    enemyTags: ['turret', 'small_reaverbot', 'sensor_reaverbot', 'archive_guardian'],
    puzzleTags: ['power_reroute', 'terminal_sequence', 'beam_alignment', 'surveillance_shutdown'],
    rewardTags: ['zenny_cache', 'chip_upgrade', 'keycard', 'ancient_circuit_part', 'lore_terminal'],
    verticalityOptions: [
      { id: 'ring_catwalk', tiers: [0, 1], traversal: ['stairs', 'catwalk'], purpose: 'Terminals and an optional upper exit.' },
      { id: 'stacked_archive', tiers: [0, 1, 2], traversal: ['switchback_stairs', 'wall_catwalks'], purpose: 'Required ascent through server banks.' },
      { id: 'sunken_cable_crypt', tiers: [-1, 0, 1], traversal: ['ramp', 'stairs'], purpose: 'Lower cable puzzle with an upper observation route.' },
    ],
    exitRules: [
      matchedExit('archive_ground_exit', 0, ['door', 'sealed_door'], { required: true }),
      matchedExit('archive_upper_exit', 1, ['catwalk_bridge', 'upper_door'], { destinationTags: ['server', 'control', 'maintenance'] }),
      matchedExit('archive_lower_vault_exit', -1, ['maintenance_hatch', 'ramp_corridor'], { destinationTags: ['vault', 'maintenance'] }),
    ],
    environmentalStories: [
      'A shattered data monolith still projects fragments of a factory evacuation order.',
      'Cable roots have grown around a dormant guardian as though preserving it.',
      'One archive aisle was deliberately fused shut after its memory cores were removed.',
    ],
  },
  {
    id: 'fluid_tank_chamber',
    displayName: 'Fluid Tank Chamber',
    purpose: 'Stores, mixes, and routes coolant, refractor fluid, waste, or other unknown process liquids.',
    mood: 'Cavernous and pressurized, with distorted silhouettes moving behind luminous glass.',
    sizeCategory: 'large',
    heightCategory: 'tall',
    layoutTags: ['fluid', 'tank', 'pipes', 'hazard', 'puzzle', 'catwalk'],
    layoutVariants: [
      { id: 'central_tank_room', displayName: 'Central Tank Room', topology: 'Perimeter paths and an inspection deck encircle one massive tank.' },
      { id: 'tank_maze', displayName: 'Tank Maze', topology: 'Multiple vessels create corridors, cover, and ambush sightlines.' },
      { id: 'flooded_pump_chamber', displayName: 'Flooded Pump Chamber', topology: 'A submerged lower route is exposed by operating pumps.' },
      { id: 'suspended_vat_hall', displayName: 'Suspended Vat Hall', topology: 'Catwalks cross between hanging tanks above a hazardous floor.' },
      { id: 'multi_liquid_lab', displayName: 'Multi-Liquid Lab', topology: 'Separated reservoirs feed a central routing puzzle.' },
    ],
    requiredFeatures: ['process_tanks', 'pipe_network', 'pump_controls', 'inspection_route', 'contained_or_drained_liquid'],
    optionalFeatures: ['upper_inspection_deck', 'overflow_trenches', 'broken_spill_tank', 'pressure_valves', 'floating_platform'],
    enemyTags: ['hover_reaverbot', 'aquatic_reaverbot', 'pipe_crawler', 'catwalk_turret', 'pump_guardian'],
    puzzleTags: ['drain_fill', 'valve_routing', 'pump_sequence', 'conductive_water', 'liquid_lift'],
    rewardTags: ['drained_tank_cache', 'keycard', 'armor_plating', 'strange_fluid_sample', 'refractor_shard'],
    verticalityOptions: [
      { id: 'inspection_ring', tiers: [0, 1], traversal: ['stairs', 'ring_catwalk'], purpose: 'Safe overview and valve access above tanks.' },
      { id: 'flooded_lower_works', tiers: [-1, 0, 1], traversal: ['ramps', 'stairs', 'service_catwalk'], purpose: 'Liquid level changes reveal the lower route.' },
      { id: 'suspended_vats', tiers: [0, 1, 2], traversal: ['stair_tower', 'mesh_bridges'], purpose: 'Required crossings between high inspection ports.' },
    ],
    exitRules: [
      matchedExit('tank_ground_exit', 0, ['pressure_door', 'door'], { required: true }),
      matchedExit('tank_inspection_exit', 1, ['upper_door', 'catwalk_bridge'], { destinationTags: ['control', 'pump', 'reactor'] }),
      matchedExit('tank_drain_exit', -1, ['drain_tunnel', 'ramp_corridor'], { destinationTags: ['coolant', 'maintenance'] }),
    ],
    environmentalStories: [
      'A cracked amber tank has been patched repeatedly with mismatched ancient plating.',
      'Sediment outlines a once-submerged stairway leading to an abandoned control booth.',
      'An empty specimen harness hangs inside a tank whose glass was broken outward.',
    ],
  },
  {
    id: 'reaverbot_recharge_chamber',
    displayName: 'Reaverbot Recharge Chamber',
    purpose: 'Docks, repairs, and re-energizes the automated guardians assigned to the ruin.',
    mood: 'Tense and expectant; rows of motionless machines may awaken at any moment.',
    sizeCategory: 'medium',
    heightCategory: 'tall',
    layoutTags: ['reaverbot', 'recharge', 'combat', 'power', 'docking', 'vertical'],
    layoutVariants: [
      { id: 'docking_bay_row', displayName: 'Docking Bay Row', topology: 'Wall pods flank a central route and awaken in controlled waves.' },
      { id: 'central_recharge_ring', displayName: 'Central Recharge Ring', topology: 'A circular control route surrounds active docking pads.' },
      { id: 'multi_level_repair_bay', displayName: 'Multi-Level Repair Bay', topology: 'Upper controls overlook charging platforms on the lower floor.' },
      { id: 'dormant_nest_chamber', displayName: 'Dormant Nest Chamber', topology: 'Alcoves conceal a variable mixture of inert and active units.' },
    ],
    requiredFeatures: ['recharge_docks', 'charging_pylons', 'repair_control_terminal', 'awakening_trigger'],
    optionalFeatures: ['upper_shutdown_console', 'repair_arms', 'inactive_shells', 'hackable_player_recharge_pad', 'central_maintenance_cradle'],
    enemyTags: ['dormant_reaverbot', 'maintenance_reaverbot', 'docking_turret', 'recharging_elite'],
    puzzleTags: ['disable_healing', 'power_diversion', 'selective_shutdown', 'risk_reward_terminal'],
    rewardTags: ['reaverbot_scrap', 'weapon_part', 'chip_upgrade', 'keycard', 'maintenance_cache'],
    verticalityOptions: [
      { id: 'overlook_controls', tiers: [0, 1], traversal: ['stairs', 'side_catwalk'], purpose: 'Disable healing pylons from an exposed upper deck.' },
      { id: 'sunken_dock_ring', tiers: [-1, 0, 1], traversal: ['ramps', 'ring_walkway'], purpose: 'Fight below or bypass units above.' },
      { id: 'repair_gantry', tiers: [0, 1, 2], traversal: ['stair_tower', 'gantry'], purpose: 'Access repair arms and a high matched exit.' },
    ],
    exitRules: [
      matchedExit('recharge_ground_exit', 0, ['blast_door', 'door'], { required: true }),
      matchedExit('recharge_control_exit', 1, ['upper_door', 'catwalk_bridge'], { destinationTags: ['control', 'security'] }),
      matchedExit('recharge_service_exit', -1, ['service_hatch', 'ramp_corridor'], { destinationTags: ['nest', 'maintenance'] }),
    ],
    environmentalStories: [
      'Repair arms continue tending an empty cradle whose occupant tore free long ago.',
      'Several intact units face a sealed door rather than the room entrance, implying an internal threat.',
      'A maintenance bot has assembled a careful pile of unusable guardian parts beside its dock.',
    ],
  },
  {
    id: 'specimen_containment_room',
    displayName: 'Specimen Containment Room',
    purpose: 'Studies and isolates machine organisms, Reaverbot components, and anomalous ancient mechanisms.',
    mood: 'Clinical but violated, with evidence that containment failed before the facility fell silent.',
    sizeCategory: 'medium',
    heightCategory: 'tall',
    layoutTags: ['containment', 'specimen', 'research', 'security', 'puzzle', 'observation'],
    layoutVariants: [
      { id: 'tank_rows', displayName: 'Tank Rows', topology: 'Parallel specimen banks form lanes punctured by broken capsules.' },
      { id: 'central_specimen_display', displayName: 'Central Specimen Display', topology: 'A ring path surrounds one large scan or release mechanism.' },
      { id: 'observation_balcony', displayName: 'Observation Balcony', topology: 'An elevated control booth governs the containment floor below.' },
      { id: 'broken_containment', displayName: 'Broken Containment', topology: 'Shattered pods and emergency partitions create an irregular combat route.' },
    ],
    requiredFeatures: ['specimen_pods', 'scan_terminal', 'containment_security', 'observation_route'],
    optionalFeatures: ['upper_observation_deck', 'security_lasers', 'decontamination_arch', 'drainable_tank', 'lockdown_shutters'],
    enemyTags: ['escaped_specimen', 'security_turret', 'vent_crawler', 'containment_guardian'],
    puzzleTags: ['symbol_matching', 'security_shutdown', 'tank_drain', 'quiet_traversal', 'lockdown_survival'],
    rewardTags: ['ancient_core_sample', 'rare_reaverbot_scrap', 'chip_upgrade', 'keycard', 'research_lore'],
    verticalityOptions: [
      { id: 'observation_balcony', tiers: [0, 1], traversal: ['stairs', 'balcony'], purpose: 'Security controls and surveillance clues.' },
      { id: 'suspended_cages', tiers: [0, 1, 2], traversal: ['catwalks', 'lift_platform'], purpose: 'Scan specimens at multiple heights.' },
      { id: 'quarantine_sump', tiers: [-1, 0, 1], traversal: ['service_ramp', 'stairs'], purpose: 'Drain a lower tank to expose a route or reward.' },
    ],
    exitRules: [
      matchedExit('containment_ground_exit', 0, ['lockdown_door', 'decontamination_door'], { required: true }),
      matchedExit('observation_exit', 1, ['upper_door', 'glass_bridge'], { destinationTags: ['control', 'security'] }),
      matchedExit('quarantine_exit', -1, ['service_hatch', 'drain_tunnel'], { destinationTags: ['maintenance', 'hazard'] }),
    ],
    environmentalStories: [
      'The labels on several empty capsules were scraped away before their doors were opened.',
      'An observation window is scarred by impacts from the safe side of the glass.',
      'A preserved red-eye core follows movement despite having no visible power connection.',
    ],
  },
  {
    id: 'reaverbot_nest',
    displayName: 'Reaverbot Nest',
    purpose: 'Provides a defended den where Reaverbots gather scrap, hatch smaller units, and alter the ruin.',
    mood: 'Hostile, improvised, and almost organic despite being made entirely of machinery.',
    sizeCategory: 'large',
    heightCategory: 'tall',
    layoutTags: ['reaverbot', 'nest', 'combat', 'swarm', 'scrap', 'ambush'],
    layoutVariants: [
      { id: 'nest_pit', displayName: 'Nest Pit', topology: 'A lower scrap den sits beneath a traversable perimeter ring.' },
      { id: 'cable_web_room', displayName: 'Cable Web Room', topology: 'Destructible power nodes divide the room into opening routes.' },
      { id: 'hatchling_swarm_room', displayName: 'Hatchling Swarm Room', topology: 'Spawn holes surround a defensible route between nest cores.' },
      { id: 'elite_nest_room', displayName: 'Elite Nest Room', topology: 'A sleeping central guardian anchors stealth, ambush, or direct combat.' },
    ],
    requiredFeatures: ['scrap_nest', 'red_eye_nodes', 'spawn_or_dormancy_points', 'defensible_critical_route'],
    optionalFeatures: ['upper_ring_walkway', 'destructible_cable_barriers', 'alarm_pylons', 'hibernation_clusters', 'buried_reward'],
    enemyTags: ['swarm_reaverbot', 'nest_guard', 'dormant_elite', 'alarm_reaverbot'],
    puzzleTags: ['destroy_nest_cores', 'silent_alarm_shutdown', 'power_overload', 'environmental_traps'],
    rewardTags: ['reaverbot_scrap', 'zenny_scrap_pile', 'elite_keycard', 'buried_upgrade'],
    verticalityOptions: [
      { id: 'nest_pit', tiers: [-1, 0, 1], traversal: ['ramps', 'ring_catwalk'], purpose: 'Choose a dangerous lower route or exposed high crossing.' },
      { id: 'webbed_scaffold', tiers: [0, 1], traversal: ['stairs', 'broken_catwalk'], purpose: 'Destroy cable nodes to reconnect upper spans.' },
      { id: 'hive_stack', tiers: [0, 1, 2], traversal: ['short_stairs', 'mesh_landings'], purpose: 'Clear spawn nodes on successive tiers.' },
    ],
    exitRules: [
      matchedExit('nest_ground_exit', 0, ['scrap_gate', 'door'], { required: true }),
      matchedExit('nest_upper_exit', 1, ['catwalk_bridge', 'maintenance_door'], { destinationTags: ['maintenance', 'recharge'] }),
      matchedExit('nest_burrow_exit', -1, ['service_tunnel', 'ramp_corridor'], { destinationTags: ['maintenance', 'hazard'] }),
    ],
    environmentalStories: [
      'Reaverbots have arranged discarded optics into a crude imitation of the facility emblem.',
      'Scrape marks show that a large dormant unit is moved between the pit and a sealed recharge wing.',
      'A nest core is built around a still-functioning worker terminal, using its power as a heartbeat.',
    ],
  },
  {
    id: 'surveillance_control_theater',
    displayName: 'Surveillance Control Theater',
    purpose: 'Monitors the factory, coordinates security, and reveals routes or events elsewhere in the dungeon.',
    mood: 'Watchful and paranoid, dominated by dead screens and active red camera eyes.',
    sizeCategory: 'large',
    heightCategory: 'tall',
    layoutTags: ['control', 'surveillance', 'security', 'terminal', 'theater', 'vertical'],
    layoutVariants: [
      { id: 'command_theater', displayName: 'Command Theater', topology: 'Console rows climb from a lower entrance toward a high command deck.' },
      { id: 'surveillance_pit', displayName: 'Surveillance Pit', topology: 'A sunken operator floor is encircled by catwalks and stairs.' },
      { id: 'monitor_maze', displayName: 'Monitor Maze', topology: 'Broken display walls create cover and camera-controlled lanes.' },
      { id: 'control_balcony', displayName: 'Control Balcony', topology: 'A high operations deck overlooks an adjacent industrial hall.' },
    ],
    requiredFeatures: ['monitor_array', 'security_consoles', 'camera_network', 'command_terminal'],
    optionalFeatures: ['upper_command_deck', 'operator_pit', 'holographic_map', 'laser_grid', 'hidden_route_display'],
    enemyTags: ['sensor_reaverbot', 'security_drone', 'monitor_turret', 'command_guardian'],
    puzzleTags: ['camera_shutdown', 'monitor_clue_sequence', 'dish_alignment', 'alarm_suppression', 'map_reveal'],
    rewardTags: ['map_data', 'security_keycard', 'hidden_door_reveal', 'surveillance_memory_unit', 'security_locker'],
    verticalityOptions: [
      { id: 'command_risers', tiers: [0, 1], traversal: ['broad_stairs', 'balcony'], purpose: 'A clear required climb to the primary terminal.' },
      { id: 'operator_pit', tiers: [-1, 0, 1], traversal: ['stairs', 'perimeter_catwalk'], purpose: 'Controls below, safe flanking and exits above.' },
      { id: 'monitor_tower', tiers: [0, 1, 2], traversal: ['switchback_stairs', 'screen_bridges'], purpose: 'Reach cameras and dish controls at separate heights.' },
    ],
    exitRules: [
      matchedExit('theater_ground_exit', 0, ['security_door', 'door'], { required: true }),
      matchedExit('command_balcony_exit', 1, ['upper_door', 'observation_bridge'], { destinationTags: ['factory', 'security', 'reactor'] }),
      matchedExit('operator_service_exit', -1, ['service_hatch', 'cable_tunnel'], { destinationTags: ['server', 'maintenance'] }),
    ],
    environmentalStories: [
      'One surviving display loops footage of workers calmly leaving while alarms flash around them.',
      'Camera records end whenever they turn toward a particular sealed lower corridor.',
      'The command chair is wired directly into a dismantled Reaverbot sensor core.',
    ],
  },
  {
    id: 'assembly_line_hall',
    displayName: 'Assembly Line Hall',
    purpose: 'Constructs or repairs Reaverbots and industrial machinery with conveyors, arms, presses, and gantries.',
    mood: 'Restless and rhythmic, as fragments of the production line keep working without operators.',
    sizeCategory: 'large',
    heightCategory: 'very-tall',
    layoutTags: ['factory', 'assembly', 'conveyor', 'machinery', 'platforming', 'gantry'],
    layoutVariants: [
      { id: 'straight_assembly_line', displayName: 'Straight Assembly Line', topology: 'A central belt creates a strong axis with side catwalks.' },
      { id: 'multi_belt_puzzle_room', displayName: 'Multi-Belt Puzzle Room', topology: 'Crossing belts change direction to form temporary routes.' },
      { id: 'overhead_gantry_hall', displayName: 'Overhead Gantry Hall', topology: 'Required controls sit above machinery on steel mesh paths.' },
      { id: 'broken_production_line', displayName: 'Broken Production Line', topology: 'Jammed machines force a route through service decks and gaps.' },
    ],
    requiredFeatures: ['conveyor_line', 'assembly_machinery', 'maintenance_route', 'machine_controls'],
    optionalFeatures: ['moving_platforms', 'upper_gantry', 'robot_arm_bridge', 'press_hazards', 'parts_storage_alcove'],
    enemyTags: ['conveyor_reaverbot', 'rolling_reaverbot', 'gantry_turret', 'machine_guardian'],
    puzzleTags: ['reverse_conveyors', 'stop_press_cycle', 'moving_platform_timing', 'crate_switch', 'assembly_arm_bridge'],
    rewardTags: ['buster_part', 'reaverbot_scrap', 'zenny_crate', 'maintenance_keycard'],
    verticalityOptions: [
      { id: 'side_gantries', tiers: [0, 1], traversal: ['stairs', 'mesh_catwalks'], purpose: 'Controls and ranged combat above the production floor.' },
      { id: 'crossed_conveyors', tiers: [0, 1, 2], traversal: ['ramps', 'moving_belts', 'gantry_bridges'], purpose: 'Belts become required platforming links.' },
      { id: 'assembly_pit', tiers: [-1, 0, 1], traversal: ['service_stairs', 'machine_platforms'], purpose: 'Repair machinery below to open the high route.' },
    ],
    exitRules: [
      matchedExit('assembly_ground_exit', 0, ['factory_door', 'conveyor_tunnel'], { required: true }),
      matchedExit('gantry_exit', 1, ['catwalk_bridge', 'upper_factory_door'], { destinationTags: ['machine', 'storage', 'control'] }),
      matchedExit('assembly_service_exit', -1, ['service_ramp', 'maintenance_hatch'], { destinationTags: ['hazard', 'maintenance'] }),
    ],
    environmentalStories: [
      'The final chassis on the line combines parts from several incompatible Reaverbot models.',
      'A welding arm repeatedly repairs the same crack in an empty transport frame.',
      'Production tallies rise after the facility evacuation, then stop mid-cycle.',
    ],
  },
  {
    id: 'pump_and_coolant_works',
    displayName: 'Pump and Coolant Works',
    purpose: 'Circulates coolant and pressure through the ruin while governing drains, steam, and turbines.',
    mood: 'Claustrophobic, damp, and forceful, with every pipe shudder suggesting a coming rupture.',
    sizeCategory: 'medium',
    heightCategory: 'tall',
    layoutTags: ['pump', 'coolant', 'valves', 'steam', 'pressure', 'maintenance'],
    layoutVariants: [
      { id: 'pump_crossroad', displayName: 'Pump Crossroad', topology: 'Four valve branches converge on a central pressure manifold.' },
      { id: 'steam_maze', displayName: 'Steam Maze', topology: 'Timed vents gate narrow but readable service routes.' },
      { id: 'coolant_lower_level', displayName: 'Coolant Lower Level', topology: 'A flooded low route contrasts with a safer upper catwalk.' },
      { id: 'turbine_chamber', displayName: 'Turbine Chamber', topology: 'A large rotating obstruction controls access through the room.' },
    ],
    requiredFeatures: ['pump_manifold', 'pressure_valves', 'coolant_pipes', 'control_terminal', 'safe_traversal_cycle'],
    optionalFeatures: ['steam_vents', 'upper_safe_catwalk', 'drainable_lower_floor', 'rotating_turbine', 'pressure_locked_cache'],
    enemyTags: ['drain_crawler', 'steam_ambusher', 'valve_turret', 'coolant_guardian'],
    puzzleTags: ['pressure_balance', 'valve_routing', 'steam_shutdown', 'coolant_drain', 'turbine_power'],
    rewardTags: ['pressure_regulator', 'pump_upgrade_part', 'steam_lock_keycard', 'drain_zenny_cache'],
    verticalityOptions: [
      { id: 'safe_overhead_bypass', tiers: [0, 1], traversal: ['stairs', 'pipe_catwalk'], purpose: 'Long safe route versus hazardous direct floor route.' },
      { id: 'coolant_sump', tiers: [-1, 0, 1], traversal: ['ramps', 'service_stairs'], purpose: 'Drain lower works to reach machinery and an exit.' },
      { id: 'turbine_tower', tiers: [0, 1, 2], traversal: ['spiral_stairs', 'maintenance_landings'], purpose: 'Shut down turbine components in vertical sequence.' },
    ],
    exitRules: [
      matchedExit('pump_ground_exit', 0, ['pressure_door', 'door'], { required: true }),
      matchedExit('pump_catwalk_exit', 1, ['pipe_bridge', 'upper_maintenance_door'], { destinationTags: ['tank', 'reactor', 'maintenance'] }),
      matchedExit('pump_drain_exit', -1, ['drain_tunnel', 'service_ramp'], { destinationTags: ['hazard', 'coolant'] }),
    ],
    environmentalStories: [
      'Pressure gauges were manually pinned in the safe range even though the pipes still buck violently.',
      'A maintenance trail ends at a valve welded shut from the far side.',
      'Coolant stains mark a former waterline above an intact emergency ladder.',
    ],
  },
  {
    id: 'reactor_support_chamber',
    displayName: 'Reactor Support Chamber',
    purpose: 'Distributes refractor power through relays, shield rings, cooling systems, and protected energy conduits.',
    mood: 'Monumental and dangerous, charged with barely contained ancient energy.',
    sizeCategory: 'large',
    heightCategory: 'very-tall',
    layoutTags: ['reactor', 'energy', 'refractor', 'hazard', 'puzzle', 'multi-tier'],
    layoutVariants: [
      { id: 'central_reactor', displayName: 'Central Reactor', topology: 'A circular walkway and perimeter terminals surround the core.' },
      { id: 'relay_puzzle_chamber', displayName: 'Relay Puzzle Chamber', topology: 'Power nodes form several readable beam-routing branches.' },
      { id: 'overloaded_reactor', displayName: 'Overloaded Reactor', topology: 'Timed energy arcs force movement between insulated safe zones.' },
      { id: 'multi_tier_reactor_hall', displayName: 'Multi-Tier Reactor Hall', topology: 'The reactor base, relays, and controls occupy distinct heights.' },
    ],
    requiredFeatures: ['reactor_or_relay_core', 'energy_conduits', 'shutdown_controls', 'insulated_critical_route'],
    optionalFeatures: ['catwalk_ring', 'power_bridge', 'overload_nodes', 'shield_rings', 'backup_power_terminal'],
    enemyTags: ['shock_resistant_reaverbot', 'powered_turret', 'relay_drone', 'overcharged_elite'],
    puzzleTags: ['energy_routing', 'overload_shutdown', 'relay_alignment', 'backup_power', 'hazard_cycle'],
    rewardTags: ['large_zenny_cache', 'energy_weapon_part', 'chip_upgrade', 'quest_power_source'],
    verticalityOptions: [
      { id: 'reactor_ring', tiers: [0, 1], traversal: ['stairs', 'circular_catwalk'], purpose: 'Reach relays around the core from multiple angles.' },
      { id: 'relay_tiers', tiers: [0, 1, 2], traversal: ['switchback_stairs', 'power_bridges'], purpose: 'Route power in a required bottom-to-top sequence.' },
      { id: 'cooling_subfloor', tiers: [-1, 0, 1], traversal: ['service_ramp', 'catwalk'], purpose: 'Repair cooling below before crossing the energized deck.' },
    ],
    exitRules: [
      matchedExit('reactor_ground_exit', 0, ['energy_gate', 'blast_door'], { required: true }),
      matchedExit('reactor_relay_exit', 1, ['power_bridge', 'upper_door'], { destinationTags: ['shrine', 'control', 'machine'] }),
      matchedExit('reactor_cooling_exit', -1, ['service_hatch', 'coolant_tunnel'], { destinationTags: ['coolant', 'maintenance'] }),
    ],
    environmentalStories: [
      'One relay has been redirected to power a tiny shrine instead of the factory grid.',
      'Scorched silhouettes around an emergency console show where the final shutdown team stood.',
      'A replacement refractor core is present but was never connected to the failing reactor.',
    ],
  },
  {
    id: 'security_checkpoint',
    displayName: 'Security Checkpoint / Lockdown Gate',
    purpose: 'Controls progression between factory zones with scanners, blast gates, barriers, and identity checks.',
    mood: 'Restrictive and confrontational, designed to make every crossing feel observed and earned.',
    sizeCategory: 'small',
    heightCategory: 'tall',
    layoutTags: ['security', 'checkpoint', 'keycard', 'lockdown', 'transition', 'defense'],
    layoutVariants: [
      { id: 'straight_checkpoint', displayName: 'Straight Checkpoint', topology: 'A scanner lane leads directly to a credential-locked door.' },
      { id: 'two_level_checkpoint', displayName: 'Two-Level Checkpoint', topology: 'Gate controls occupy a defended upper catwalk.' },
      { id: 'lockdown_room', displayName: 'Lockdown Room', topology: 'Both doors seal around a combat or terminal challenge.' },
      { id: 'side_security_office', displayName: 'Side Security Office', topology: 'An optional office provides a bypass, clue, or reward.' },
    ],
    requiredFeatures: ['blast_gate', 'credential_reader', 'security_scanner', 'gate_control'],
    optionalFeatures: ['upper_control_catwalk', 'barrier_emitters', 'guard_alcoves', 'vent_bypass', 'security_office'],
    enemyTags: ['security_turret', 'shielded_guard', 'alarm_reinforcement', 'sensor_drone'],
    puzzleTags: ['keycard_gate', 'barrier_shutdown', 'scanner_avoidance', 'terminal_hack', 'alternate_bypass'],
    rewardTags: ['keycard', 'security_locker', 'shortcut_unlock', 'map_data'],
    verticalityOptions: [
      { id: 'upper_gate_controls', tiers: [0, 1], traversal: ['stairs', 'short_catwalk'], purpose: 'A required exposed climb under visible defenses.' },
      { id: 'security_overpass', tiers: [0, 1, 2], traversal: ['ramps', 'bridge'], purpose: 'An upper route crosses the gate into a matched elevated room.' },
      { id: 'inspection_trench', tiers: [-1, 0], traversal: ['service_steps', 'crawl_route'], purpose: 'A discoverable lower bypass through scanner machinery.' },
    ],
    exitRules: [
      matchedExit('checkpoint_entry', 0, ['scanner_gate', 'blast_door'], { required: true, notes: 'The primary entry must remain reachable before credentials are acquired.' }),
      matchedExit('checkpoint_progression_exit', 0, ['keycard_door', 'barrier_gate'], { required: true, notes: 'Any lock must have an obtainable key, switch, combat condition, or bypass upstream.' }),
      matchedExit('checkpoint_upper_exit', 1, ['security_bridge', 'upper_door'], { destinationTags: ['control', 'factory'] }),
      matchedExit('checkpoint_bypass_exit', -1, ['vent', 'service_hatch'], { destinationTags: ['maintenance'] }),
    ],
    environmentalStories: [
      'Every rejected access record names the same employee long after the factory was abandoned.',
      'A guard alcove was barricaded from within while the outer blast gate remained open.',
      'The scanner classifies the player as equipment awaiting reclamation.',
    ],
  },
  {
    id: 'vertical_maintenance_shaft',
    displayName: 'Vertical Maintenance Shaft',
    purpose: 'Acts as a multi-elevation connector around lifts, pipes, fans, stairs, and service landings.',
    mood: 'Vertiginous and exposed, with the destination visible far above or below.',
    sizeCategory: 'medium',
    heightCategory: 'shaft',
    layoutTags: ['vertical', 'connector', 'maintenance', 'shaft', 'platforming', 'multi-exit'],
    layoutVariants: [
      { id: 'spiral_stair_shaft', displayName: 'Spiral Stair Shaft', topology: 'Stairs wrap a central pipe column and stop at matched exits.' },
      { id: 'catwalk_stack', displayName: 'Catwalk Stack', topology: 'Short stair runs connect offset mesh landings.' },
      { id: 'broken_lift_shaft', displayName: 'Broken Lift Shaft', topology: 'Side platforms replace a disabled lift with a platforming route.' },
      { id: 'descending_maintenance_pit', displayName: 'Descending Maintenance Pit', topology: 'The critical route winds down toward a hidden lower connection.' },
    ],
    requiredFeatures: ['vertical_route_graph', 'supported_landings', 'clear_height_markers', 'fall_recovery_or_guarding'],
    optionalFeatures: ['restorable_lift', 'pipe_bridges', 'rotating_fans', 'steam_bursts', 'optional_reward_landing'],
    enemyTags: ['flying_reaverbot', 'landing_turret', 'stair_melee_guard', 'shaft_elite'],
    puzzleTags: ['restore_lift', 'platform_sequence', 'steam_shutdown', 'fan_timing', 'upper_keycard_gate'],
    rewardTags: ['ledge_zenny', 'hidden_landing_chest', 'keycard', 'floor_shortcut'],
    verticalityOptions: [
      { id: 'two_floor_connector', tiers: [0, 1], traversal: ['stairs', 'landing'], purpose: 'Directly joins two adjacent room elevations.' },
      { id: 'three_floor_stack', tiers: [0, 1, 2], traversal: ['switchback_stairs', 'catwalks'], purpose: 'Serves several meaningful exits and a reward landing.' },
      { id: 'full_depth_shaft', tiers: [-1, 0, 1, 2], traversal: ['lift', 'stairs', 'platforms'], purpose: 'A navigable vertical hub with recovery paths.' },
    ],
    exitRules: [
      matchedExit('shaft_ground_port', 0, ['maintenance_door', 'landing'], { required: true }),
      matchedExit('shaft_upper_port', 1, ['upper_door', 'catwalk_bridge'], { required: true, destinationTags: ['upper_level'] }),
      matchedExit('shaft_high_port', 2, ['upper_door', 'bridge'], { destinationTags: ['control', 'shrine', 'reactor'] }),
      matchedExit('shaft_lower_port', -1, ['lower_door', 'service_tunnel'], { destinationTags: ['coolant', 'hazard', 'secret'] }),
    ],
    environmentalStories: [
      'Lift call lights trace a descent below the lowest floor shown on the facility map.',
      'Safety rails were removed from only the landings facing a sealed upper door.',
      'A snapped cargo cable still supports a small maintenance platform through improvised knots.',
    ],
  },
  {
    id: 'data_shrine_machine_chapel',
    displayName: 'Data Shrine / Machine Chapel',
    purpose: 'Preserves a culturally important mechanism where factory operations and ancient ritual overlap.',
    mood: 'Solemn, beautiful, and inscrutable, suggesting the machines were objects of duty or worship.',
    sizeCategory: 'large',
    heightCategory: 'very-tall',
    layoutTags: ['shrine', 'data', 'refractor', 'ritual', 'puzzle', 'landmark'],
    layoutVariants: [
      { id: 'symmetrical_shrine', displayName: 'Symmetrical Shrine', topology: 'Four side terminals frame a central pedestal and clear sightline.' },
      { id: 'broken_shrine', displayName: 'Broken Shrine', topology: 'A collapse creates an asymmetric bypass through the chapel wall.' },
      { id: 'elevated_shrine', displayName: 'Elevated Shrine', topology: 'Broad steps or ramps climb toward a guarded high dais.' },
      { id: 'shrine_mini_dungeon', displayName: 'Shrine Mini-Dungeon', topology: 'Side chapels feed conduits into a locked central sanctum.' },
    ],
    requiredFeatures: ['shrine_dais', 'data_glyphs', 'refractor_pedestal', 'ritualized_machine_route'],
    optionalFeatures: ['upper_balcony', 'ring_consoles', 'side_chapels', 'energy_doors', 'guardian_activation'],
    enemyTags: ['shrine_guardian', 'floating_sensor', 'pillar_turret', 'dormant_reaverbot'],
    puzzleTags: ['symbol_alignment', 'terminal_order', 'conduit_activation', 'keycard_sanctum', 'guardian_trial'],
    rewardTags: ['key_item', 'large_refractor_shard', 'chip_upgrade', 'quest_artifact', 'route_unlock'],
    verticalityOptions: [
      { id: 'raised_dais', tiers: [0, 1], traversal: ['broad_stairs', 'ramps'], purpose: 'Makes the objective visible while preserving a readable ascent.' },
      { id: 'chapel_balconies', tiers: [0, 1, 2], traversal: ['side_stairs', 'gallery_catwalks'], purpose: 'Activate glyphs above and below the sanctum.' },
      { id: 'sunken_crypt', tiers: [-1, 0, 1], traversal: ['processional_stairs', 'service_ramp'], purpose: 'Carry power from a lower archive to the high shrine.' },
    ],
    exitRules: [
      matchedExit('shrine_ground_exit', 0, ['energy_door', 'chapel_door'], { required: true }),
      matchedExit('shrine_gallery_exit', 1, ['upper_door', 'ornamental_bridge'], { destinationTags: ['server', 'reactor', 'control'] }),
      matchedExit('shrine_crypt_exit', -1, ['stone_tech_hatch', 'ramp_corridor'], { destinationTags: ['server', 'vault'] }),
    ],
    environmentalStories: [
      'Machine parts have been placed around the pedestal in deliberate concentric offerings.',
      'A glyph sequence records maintenance intervals as if they were ceremonial dates.',
      'The chapel conduits bypass the factory and point toward an unknown source beneath it.',
    ],
  },
  {
    id: 'storage_vault_parts_warehouse',
    displayName: 'Storage Vault / Parts Warehouse',
    purpose: 'Stores salvage, replacement parts, credentials, and sealed cargo for factory operations.',
    mood: 'Dense and tempting, with every blocked aisle hinting at forgotten valuables or an ambush.',
    sizeCategory: 'medium',
    heightCategory: 'tall',
    layoutTags: ['storage', 'vault', 'warehouse', 'loot', 'maze', 'cargo'],
    layoutVariants: [
      { id: 'crate_maze', displayName: 'Crate Maze', topology: 'Stacked cargo creates breakable paths and concealed pockets.' },
      { id: 'raised_warehouse', displayName: 'Raised Warehouse', topology: 'An upper walkway surveys racks and controls access below.' },
      { id: 'locked_vault_rows', displayName: 'Locked Vault Rows', topology: 'Credential-gated cells turn limited access into a reward choice.' },
      { id: 'cargo_lift_room', displayName: 'Cargo Lift Room', topology: 'A movable platform alternates between transport, bridge, and lift.' },
    ],
    requiredFeatures: ['storage_racks', 'cargo_lanes', 'searchable_or_breakable_containers', 'readable_main_aisle'],
    optionalFeatures: ['upper_inventory_walkway', 'cargo_lift', 'locked_vault_cells', 'pushable_crates', 'rare_cache'],
    enemyTags: ['crate_ambusher', 'rack_turret', 'rolling_aisle_enemy', 'vault_elite'],
    puzzleTags: ['crate_switch', 'locker_search', 'cargo_lift_bridge', 'breakable_path', 'limited_keycard_choice'],
    rewardTags: ['zenny', 'reaverbot_scrap', 'buster_part', 'armor_plating', 'rare_chest', 'quest_item'],
    verticalityOptions: [
      { id: 'warehouse_gallery', tiers: [0, 1], traversal: ['stairs', 'perimeter_walkway'], purpose: 'Unlock exits and spot hidden cargo from above.' },
      { id: 'stacked_storage', tiers: [0, 1, 2], traversal: ['cargo_lift', 'rack_bridges'], purpose: 'Move cargo to create safe platforming links.' },
      { id: 'loading_sump', tiers: [-1, 0, 1], traversal: ['ramps', 'lift'], purpose: 'A lower loading bay connects to maintenance or secret storage.' },
    ],
    exitRules: [
      matchedExit('warehouse_ground_exit', 0, ['cargo_door', 'vault_door'], { required: true }),
      matchedExit('warehouse_gallery_exit', 1, ['catwalk_bridge', 'upper_cargo_door'], { destinationTags: ['assembly', 'machine', 'control'] }),
      matchedExit('warehouse_loading_exit', -1, ['loading_ramp', 'service_door'], { destinationTags: ['machine', 'maintenance'] }),
    ],
    environmentalStories: [
      'Crates marked as spare parts contain carefully packed personal effects instead.',
      'A cargo manifest lists an entire Reaverbot as delivered in dozens of separate shipments.',
      'The rarest vault was opened neatly, while common supplies were scattered in panic.',
    ],
  },
  {
    id: 'hazard_processing_room',
    displayName: 'Hazard Processing Room',
    purpose: 'Crushes, burns, sorts, or disposes of dangerous waste and failed machine components.',
    mood: 'Loud, brutal, and relentlessly mechanical, turning timing and positioning into survival.',
    sizeCategory: 'large',
    heightCategory: 'tall',
    layoutTags: ['hazard', 'processing', 'crusher', 'incinerator', 'conveyor', 'risk-reward'],
    layoutVariants: [
      { id: 'crusher_corridor', displayName: 'Crusher Corridor', topology: 'Timed presses divide a linear path into visible safe alcoves.' },
      { id: 'incinerator_room', displayName: 'Incinerator Room', topology: 'Cyclic fire vents gate parallel routes and shutdown valves.' },
      { id: 'scrap_conveyor_pit', displayName: 'Scrap Conveyor Pit', topology: 'Belts push actors toward grinders below the main deck.' },
      { id: 'multi_level_hazard_room', displayName: 'Multi-Level Hazard Room', topology: 'A safer upper crossing contrasts with a lucrative lower gauntlet.' },
    ],
    requiredFeatures: ['telegraphed_hazard_cycle', 'safe_waiting_zones', 'emergency_shutoff', 'validated_hazard_free_route_window'],
    optionalFeatures: ['upper_bypass', 'hazard_reward_alcove', 'reversible_conveyor', 'enemy_hazard_interaction', 'disabled_shortcut'],
    enemyTags: ['hazard_resistant_reaverbot', 'flying_reaverbot', 'conveyor_swarm', 'shutoff_guardian'],
    puzzleTags: ['cycle_timing', 'hazard_shutdown', 'enemy_hazard_use', 'pressure_plate_crate', 'conveyor_reversal'],
    rewardTags: ['risk_zenny_cache', 'trap_keycard', 'crusher_upgrade_part', 'shutdown_shortcut'],
    verticalityOptions: [
      { id: 'safe_upper_bypass', tiers: [0, 1], traversal: ['stairs', 'mesh_catwalk'], purpose: 'Longer safe route with exposed combat positions.' },
      { id: 'disposal_pit', tiers: [-1, 0, 1], traversal: ['ramps', 'conveyors', 'recovery_stairs'], purpose: 'A dangerous lower reward route that never hard-locks the player.' },
      { id: 'processing_stack', tiers: [0, 1, 2], traversal: ['service_stairs', 'moving_platforms'], purpose: 'Disable separate machine stages on different levels.' },
    ],
    exitRules: [
      matchedExit('hazard_ground_exit', 0, ['safety_gate', 'factory_door'], { required: true, notes: 'At least one traversable hazard window must always exist.' }),
      matchedExit('hazard_bypass_exit', 1, ['catwalk_bridge', 'upper_safety_door'], { destinationTags: ['factory', 'maintenance'] }),
      matchedExit('hazard_pit_exit', -1, ['disposal_tunnel', 'service_ramp'], { destinationTags: ['storage', 'maintenance'], notes: 'Lower exits require a non-damaging recovery route.' }),
    ],
    environmentalStories: [
      'Discarded machine cores were crushed only after their red eyes had been carefully removed.',
      'Emergency stop records show the line restarted itself each time workers shut it down.',
      'A safe alcove contains tally marks counting hazard cycles rather than days.',
    ],
  },
  {
    id: 'large_mini_dungeon_room',
    displayName: 'Large Mini-Dungeon Room',
    purpose: 'Creates a self-contained industrial sub-dungeon with internal branches, mechanisms, encounters, and a final gate.',
    mood: 'Expansive and consequential, like discovering a complete facility hidden inside one dungeon node.',
    sizeCategory: 'mini-dungeon',
    heightCategory: 'multi-tier',
    layoutTags: ['mini-dungeon', 'branching', 'multi-stage', 'vertical', 'puzzle', 'combat', 'reward'],
    layoutVariants: [
      { id: 'server_maze_complex', displayName: 'Server Maze Mini-Dungeon', topology: 'Archive lanes, terminals, and a keycard vault form two internal decisions.' },
      { id: 'water_processing_complex', displayName: 'Water Processing Mini-Dungeon', topology: 'Pump branches alter liquid levels and expose staged routes.' },
      { id: 'recharge_complex', displayName: 'Reaverbot Recharge Complex', topology: 'Several docking zones feed a final elite encounter.' },
      { id: 'surveillance_command_complex', displayName: 'Surveillance Command Complex', topology: 'Camera control, security office, and theater converge on the exit.' },
      { id: 'assembly_line_complex', displayName: 'Assembly Line Complex', topology: 'Conveyors, gantries, storage, and robot arms create a route network.' },
    ],
    requiredFeatures: ['clear_main_route', 'two_internal_decision_points', 'one_mechanism', 'one_reward_branch', 'one_vertical_route', 'final_exit_gate'],
    optionalFeatures: ['locked_subroom', 'upper_shortcut', 'lower_hazard_route', 'multiple_enemy_groups', 'internal_checkpoint'],
    enemyTags: ['themed_enemy_groups', 'route_guardians', 'optional_elite', 'final_guardian'],
    puzzleTags: ['multi_stage_mechanism', 'branch_key', 'route_state_change', 'vertical_shortcut', 'final_gate_unlock'],
    rewardTags: ['locked_reward_zone', 'rare_upgrade', 'large_zenny_cache', 'quest_item', 'lore_chain'],
    verticalityOptions: [
      { id: 'two_tier_complex', tiers: [0, 1], traversal: ['stairs', 'ramps', 'catwalk_network'], purpose: 'Required and optional paths trade between levels.' },
      { id: 'three_tier_complex', tiers: [-1, 0, 1], traversal: ['service_ramps', 'stair_towers', 'bridges'], purpose: 'Mechanisms on separate tiers alter the central route.' },
      { id: 'industrial_tower_complex', tiers: [0, 1, 2, 3], traversal: ['switchback_stairs', 'lifts', 'gantries'], purpose: 'A full vertical mini-dungeon with a validated recovery route.' },
    ],
    exitRules: [
      matchedExit('complex_entry', 0, ['industrial_gate', 'door'], { required: true, notes: 'The entry anchors the internal solvability graph.' }),
      matchedExit('complex_main_exit', 0, ['final_gate', 'blast_door'], { required: true, notes: 'All required unlock dependencies must be attainable from the entry.' }),
      matchedExit('complex_upper_exit', 1, ['catwalk_bridge', 'upper_gate'], { destinationTags: ['upper_level', 'boss', 'control'] }),
      matchedExit('complex_lower_exit', -1, ['service_tunnel', 'ramp_gate'], { destinationTags: ['maintenance', 'secret'] }),
    ],
    environmentalStories: [
      'Successive zones reveal that the complex changed from production to shelter to prison.',
      'A trail of shutdown commands passes between departments, each refusing responsibility.',
      'The final gate opens onto a route absent from every map displayed inside the complex.',
    ],
  },
];

export const INDUSTRIAL_ROOM_ARCHETYPES = deepFreeze(archetypes);

export const INDUSTRIAL_ROOM_ARCHETYPE_BY_ID = deepFreeze(
  Object.fromEntries(INDUSTRIAL_ROOM_ARCHETYPES.map((archetype) => [archetype.id, archetype])),
);

/**
 * Flavor effects are intentionally declarative. Numeric multipliers are applied
 * relative to an archetype's normal settings; deltas are additive probabilities.
 */
export const FLAVOR_MODIFIERS = deepFreeze({
  flooded: {
    id: 'flooded',
    displayName: 'Flooded',
    lighting: { palette: ['#4ac7cf', '#173f52'], intensityMultiplier: 0.78, flickerChance: 0.08, emergencyPulse: false },
    hazards: [
      { id: 'shallow_water', chance: 1, severity: 'low', effects: { groundSpeedMultiplier: 0.76 } },
      { id: 'conductive_pool', chance: 0.35, severity: 'high', effects: { shockDamagePerSecond: 8 } },
    ],
    enemies: { favoredTags: ['aquatic_reaverbot', 'hover_reaverbot', 'pipe_crawler'], suppressedTags: ['rolling_reaverbot'], countMultiplier: 0.95, healthMultiplier: 1 },
    rewards: { currencyMultiplier: 1.05, rareChanceDelta: 0.08, bonusTags: ['drained_tank_cache', 'submerged_keycard'] },
    ambience: { loops: ['water_drips', 'submerged_pump_hum'], oneShots: ['distant_pipe_knock'], particles: ['mist', 'surface_ripples'] },
    props: ['waterline_stains', 'floating_scrap', 'leaking_pipes', 'partially_submerged_consoles'],
    puzzleVariants: ['drain_to_reveal_route', 'raise_water_to_float_platform', 'disable_power_before_crossing'],
  },
  overgrown: {
    id: 'overgrown',
    displayName: 'Overgrown',
    lighting: { palette: ['#82a96b', '#284737'], intensityMultiplier: 0.82, flickerChance: 0.03, emergencyPulse: false },
    hazards: [
      { id: 'entangling_growth', chance: 0.55, severity: 'low', effects: { groundSpeedMultiplier: 0.84 } },
      { id: 'spore_vent', chance: 0.2, severity: 'medium', effects: { visibilityMultiplier: 0.72 } },
    ],
    enemies: { favoredTags: ['ambusher', 'crawler', 'sensor_reaverbot'], suppressedTags: ['rolling_reaverbot'], countMultiplier: 1, healthMultiplier: 1 },
    rewards: { currencyMultiplier: 0.95, rareChanceDelta: 0.06, bonusTags: ['growth_hidden_cache', 'intact_old_component'] },
    ambience: { loops: ['root_creaks', 'damp_air'], oneShots: ['falling_debris'], particles: ['spores', 'dust_motes'] },
    props: ['mossed_panels', 'root_wrapped_conduits', 'hanging_vines', 'cracked_planters'],
    puzzleVariants: ['cut_growth_from_stairs', 'trace_live_conduit_through_roots', 'burn_or_bypass_blockage'],
  },
  powered: {
    id: 'powered',
    displayName: 'Powered',
    lighting: { palette: ['#4df5e7', '#76a8ff'], intensityMultiplier: 1.18, flickerChance: 0.02, emergencyPulse: false },
    hazards: [
      { id: 'active_machinery', chance: 0.7, severity: 'medium', effects: { cycleSpeedMultiplier: 1.1 } },
      { id: 'live_conduit', chance: 0.25, severity: 'medium', effects: { shockDamagePerSecond: 6 } },
    ],
    enemies: { favoredTags: ['turret', 'sensor_reaverbot', 'recharging_elite'], suppressedTags: ['dormant_reaverbot'], countMultiplier: 1.12, healthMultiplier: 1.05 },
    rewards: { currencyMultiplier: 1, rareChanceDelta: 0.04, bonusTags: ['power_cell', 'active_terminal_data'] },
    ambience: { loops: ['generator_hum', 'machine_cycles'], oneShots: ['relay_clack', 'servo_sweep'], particles: ['energy_motes'] },
    props: ['lit_conduits', 'moving_machine_parts', 'active_displays', 'rotating_coils'],
    puzzleVariants: ['reroute_live_power', 'sequence_active_machines', 'trade_power_between_door_and_reward'],
  },
  dormant: {
    id: 'dormant',
    displayName: 'Dormant',
    lighting: { palette: ['#315462', '#17242e'], intensityMultiplier: 0.55, flickerChance: 0.12, emergencyPulse: false },
    hazards: [
      { id: 'awakening_trigger', chance: 0.7, severity: 'medium', effects: { activationDelaySeconds: 1.4 } },
    ],
    enemies: { favoredTags: ['dormant_reaverbot', 'inactive_turret'], suppressedTags: ['alarm_reinforcement'], countMultiplier: 0.9, healthMultiplier: 1, behaviorModifiers: ['wake_on_power', 'wake_on_reward'] },
    rewards: { currencyMultiplier: 1, rareChanceDelta: 0.07, bonusTags: ['intact_scrap', 'unclaimed_dock_part'] },
    ambience: { loops: ['low_power_hum'], oneShots: ['isolated_servo_twitch'], particles: ['slow_dust'] },
    props: ['dark_displays', 'inactive_docks', 'lowered_machine_arms', 'unlit_eye_nodes'],
    puzzleVariants: ['restore_only_required_circuit', 'choose_which_system_to_wake', 'cross_without_triggering_sensors'],
  },
  collapsed: {
    id: 'collapsed',
    displayName: 'Collapsed',
    lighting: { palette: ['#b89a75', '#3a302c'], intensityMultiplier: 0.72, flickerChance: 0.08, emergencyPulse: false },
    hazards: [
      { id: 'falling_debris', chance: 0.35, severity: 'medium', effects: { warningSeconds: 1.25 } },
      { id: 'unstable_ledge', chance: 0.25, severity: 'medium', effects: { collapseDelaySeconds: 0.8 } },
    ],
    enemies: { favoredTags: ['crawler', 'ambusher', 'flying_reaverbot'], suppressedTags: ['large_ground_guardian'], countMultiplier: 0.92, healthMultiplier: 1 },
    rewards: { currencyMultiplier: 1.08, rareChanceDelta: 0.1, bonusTags: ['buried_cache', 'salvaged_component'] },
    ambience: { loops: ['structure_groans', 'wind_through_gaps'], oneShots: ['stone_shift'], particles: ['falling_dust', 'embers'] },
    props: ['fallen_girders', 'broken_catwalks', 'rubble_ramps', 'crushed_machinery'],
    puzzleVariants: ['build_detour_from_debris', 'restore_broken_bridge', 'open_route_by_moving_support'],
  },
  unstable: {
    id: 'unstable',
    displayName: 'Unstable',
    lighting: { palette: ['#f6db67', '#df5a35'], intensityMultiplier: 0.94, flickerChance: 0.38, emergencyPulse: true },
    hazards: [
      { id: 'energy_surge', chance: 0.55, severity: 'high', effects: { cycleSeconds: 5, warningSeconds: 1 } },
      { id: 'mechanical_failure', chance: 0.3, severity: 'medium', effects: { cycleVariance: 0.25 } },
    ],
    enemies: { favoredTags: ['erratic_reaverbot', 'overcharged_elite'], suppressedTags: [], countMultiplier: 1, healthMultiplier: 1.08, behaviorModifiers: ['variable_attack_timing'] },
    rewards: { currencyMultiplier: 1.12, rareChanceDelta: 0.09, bonusTags: ['unstable_power_core', 'emergency_cache'] },
    ambience: { loops: ['uneven_generator', 'structural_rattle'], oneShots: ['power_surge', 'metal_snap'], particles: ['sparks', 'falling_dust'] },
    props: ['sparking_relays', 'shaking_pipes', 'warning_gauges', 'loose_panels'],
    puzzleVariants: ['stabilize_nodes_in_window', 'time_route_between_surges', 'choose_safe_circuit_order'],
  },
  locked_down: {
    id: 'locked_down',
    displayName: 'Locked Down',
    lighting: { palette: ['#ff3f43', '#4b151d'], intensityMultiplier: 0.88, flickerChance: 0.06, emergencyPulse: true },
    hazards: [
      { id: 'security_barrier', chance: 0.85, severity: 'high', effects: { contactDamage: 12 } },
      { id: 'scanner_grid', chance: 0.55, severity: 'medium', effects: { triggersAlarm: true } },
    ],
    enemies: { favoredTags: ['security_turret', 'shielded_guard', 'sensor_drone'], suppressedTags: ['wild_reaverbot'], countMultiplier: 1.1, healthMultiplier: 1.05 },
    rewards: { currencyMultiplier: 1.05, rareChanceDelta: 0.08, bonusTags: ['security_keycard', 'locker_cache', 'map_data'] },
    ambience: { loops: ['lockdown_tone', 'barrier_hum'], oneShots: ['scanner_ping', 'blast_door_clang'], particles: ['red_scan_lines'] },
    props: ['sealed_bulkheads', 'barrier_emitters', 'credential_readers', 'guard_positions'],
    puzzleVariants: ['find_upstream_keycard', 'disable_barrier_emitters', 'use_vent_bypass', 'survive_then_unlock'],
  },
  electrified: {
    id: 'electrified',
    displayName: 'Electrified',
    lighting: { palette: ['#70d9ff', '#5467ff'], intensityMultiplier: 1.05, flickerChance: 0.22, emergencyPulse: false },
    hazards: [
      { id: 'electrical_arc', chance: 0.7, severity: 'high', effects: { shockDamage: 14, cycleSeconds: 3.5 } },
      { id: 'charged_floor', chance: 0.35, severity: 'high', effects: { shockDamagePerSecond: 9 } },
    ],
    enemies: { favoredTags: ['shock_resistant_reaverbot', 'hover_reaverbot', 'powered_turret'], suppressedTags: ['aquatic_reaverbot'], countMultiplier: 1, healthMultiplier: 1.04 },
    rewards: { currencyMultiplier: 1.03, rareChanceDelta: 0.08, bonusTags: ['energy_weapon_part', 'insulation_upgrade'] },
    ambience: { loops: ['transformer_buzz'], oneShots: ['arc_crack', 'breaker_trip'], particles: ['blue_sparks', 'ion_haze'] },
    props: ['arcing_coils', 'burned_floor_panels', 'insulator_posts', 'grounding_rods'],
    puzzleVariants: ['ground_live_sections', 'rotate_insulators', 'cross_on_deenergized_cycle', 'electrify_enemies_then_discharge'],
  },
  dark: {
    id: 'dark',
    displayName: 'Dark',
    lighting: { palette: ['#18323c', '#080d13'], intensityMultiplier: 0.32, flickerChance: 0.18, emergencyPulse: false },
    hazards: [
      { id: 'low_visibility', chance: 1, severity: 'medium', effects: { perceptionRangeMultiplier: 0.62 } },
      { id: 'unmarked_drop', chance: 0.2, severity: 'medium', effects: { requiresEdgeLights: true } },
    ],
    enemies: { favoredTags: ['sensor_reaverbot', 'ambusher', 'glowing_eye_enemy'], suppressedTags: ['long_range_turret'], countMultiplier: 0.92, healthMultiplier: 1, behaviorModifiers: ['reveal_before_attack'] },
    rewards: { currencyMultiplier: 1, rareChanceDelta: 0.07, bonusTags: ['light_guided_cache', 'night_optics_part'] },
    ambience: { loops: ['near_silence', 'distant_vent'], oneShots: ['unseen_movement', 'sensor_click'], particles: ['sparse_dust'] },
    props: ['dead_light_strips', 'portable_beacons', 'glowing_route_trim', 'reflective_eye_nodes'],
    puzzleVariants: ['restore_route_lights', 'follow_pulsing_conduits', 'carry_movable_light_source'],
  },
  alarmed: {
    id: 'alarmed',
    displayName: 'Alarmed',
    lighting: { palette: ['#ff3439', '#f3a64a'], intensityMultiplier: 0.96, flickerChance: 0.04, emergencyPulse: true },
    hazards: [
      { id: 'reinforcement_timer', chance: 0.75, severity: 'high', effects: { waveIntervalSeconds: 18, maxWaves: 3 } },
      { id: 'closing_shutter', chance: 0.3, severity: 'medium', effects: { warningSeconds: 2 } },
    ],
    enemies: { favoredTags: ['alarm_reinforcement', 'security_drone', 'fast_reaverbot'], suppressedTags: ['dormant_reaverbot'], countMultiplier: 1.25, healthMultiplier: 1 },
    rewards: { currencyMultiplier: 1.15, rareChanceDelta: 0.05, bonusTags: ['alarm_control_cache', 'security_scrap'] },
    ambience: { loops: ['facility_alarm'], oneShots: ['reinforcement_door', 'warning_broadcast'], particles: ['rotating_red_beams'] },
    props: ['alarm_beacons', 'open_deployment_pods', 'flashing_consoles', 'closing_shutters'],
    puzzleVariants: ['reach_alarm_console_before_wave', 'disable_multiple_beacons', 'use_alarm_to_open_security_route'],
  },
  infested: {
    id: 'infested',
    displayName: 'Infested',
    lighting: { palette: ['#c93642', '#592331'], intensityMultiplier: 0.67, flickerChance: 0.09, emergencyPulse: false },
    hazards: [
      { id: 'nest_spawn', chance: 0.85, severity: 'high', effects: { spawnIntervalSeconds: 12, stopsWhenCoreDestroyed: true } },
      { id: 'cable_snare', chance: 0.3, severity: 'low', effects: { groundSpeedMultiplier: 0.75 } },
    ],
    enemies: { favoredTags: ['swarm_reaverbot', 'nest_guard', 'crawler'], suppressedTags: ['security_turret'], countMultiplier: 1.35, healthMultiplier: 0.94, behaviorModifiers: ['emerge_from_props'] },
    rewards: { currencyMultiplier: 1.22, rareChanceDelta: 0.04, bonusTags: ['reaverbot_scrap', 'nest_core', 'buried_upgrade'] },
    ambience: { loops: ['scraping_swarm', 'nest_pulse'], oneShots: ['hatchling_chitter'], particles: ['red_motes', 'cable_sparks'] },
    props: ['cable_nests', 'scrap_mounds', 'red_eye_clusters', 'hatching_pods'],
    puzzleVariants: ['destroy_spawn_cores', 'disable_alarm_nodes_silently', 'overload_shared_nest_power'],
  },
  overheated: {
    id: 'overheated',
    displayName: 'Overheated',
    lighting: { palette: ['#ff893d', '#d73f2c'], intensityMultiplier: 1.1, flickerChance: 0.12, emergencyPulse: true },
    hazards: [
      { id: 'steam_burst', chance: 0.8, severity: 'medium', effects: { heatDamage: 10, warningSeconds: 0.9 } },
      { id: 'hot_floor', chance: 0.35, severity: 'high', effects: { heatDamagePerSecond: 7 } },
    ],
    enemies: { favoredTags: ['heat_resistant_reaverbot', 'flying_reaverbot', 'machine_guardian'], suppressedTags: ['frozen_reaverbot'], countMultiplier: 0.98, healthMultiplier: 1.06 },
    rewards: { currencyMultiplier: 1.08, rareChanceDelta: 0.1, bonusTags: ['heat_shield_part', 'pressure_regulator'] },
    ambience: { loops: ['strained_fans', 'boiling_coolant'], oneShots: ['steam_release', 'metal_ping'], particles: ['heat_shimmer', 'embers'] },
    props: ['glowing_vents', 'red_hot_pipes', 'failed_cooling_fans', 'pressure_warnings'],
    puzzleVariants: ['restore_coolant_flow', 'vent_pressure_in_order', 'alternate_between_hot_and_safe_decks'],
  },
  frozen: {
    id: 'frozen',
    displayName: 'Frozen',
    lighting: { palette: ['#b9efff', '#527aa3'], intensityMultiplier: 0.88, flickerChance: 0.04, emergencyPulse: false },
    hazards: [
      { id: 'slick_floor', chance: 0.65, severity: 'low', effects: { tractionMultiplier: 0.58 } },
      { id: 'cryogenic_burst', chance: 0.35, severity: 'medium', effects: { movementMultiplier: 0.65, durationSeconds: 3 } },
    ],
    enemies: { favoredTags: ['cold_resistant_reaverbot', 'dormant_reaverbot'], suppressedTags: ['rolling_reaverbot'], countMultiplier: 0.9, healthMultiplier: 1.08, behaviorModifiers: ['reduced_move_speed'] },
    rewards: { currencyMultiplier: 1, rareChanceDelta: 0.12, bonusTags: ['preserved_component', 'cryogenic_sample'] },
    ambience: { loops: ['cold_air', 'ice_stress'], oneShots: ['ice_crack'], particles: ['frost', 'cold_mist'] },
    props: ['frosted_tanks', 'ice_locked_valves', 'frozen_spills', 'snow_dusted_catwalks'],
    puzzleVariants: ['thaw_specific_valves', 'freeze_liquid_into_platforms', 'reroute_heat_without_waking_units'],
  },
  corroded: {
    id: 'corroded',
    displayName: 'Corroded',
    lighting: { palette: ['#b7a44c', '#527039'], intensityMultiplier: 0.7, flickerChance: 0.16, emergencyPulse: false },
    hazards: [
      { id: 'acid_leak', chance: 0.55, severity: 'high', effects: { corrosionDamagePerSecond: 8 } },
      { id: 'weak_floor_panel', chance: 0.3, severity: 'medium', effects: { collapseDelaySeconds: 1.1 } },
    ],
    enemies: { favoredTags: ['crawler', 'hover_reaverbot', 'damaged_reaverbot'], suppressedTags: ['heavy_turret'], countMultiplier: 0.93, healthMultiplier: 0.92, behaviorModifiers: ['occasional_malfunction'] },
    rewards: { currencyMultiplier: 1.13, rareChanceDelta: 0.08, bonusTags: ['salvage_bundle', 'corrosion_resistant_plating'] },
    ambience: { loops: ['acid_drip', 'failing_motor'], oneShots: ['metal_crumble'], particles: ['green_vapor', 'rust_flakes'] },
    props: ['pitted_panels', 'rusted_supports', 'acid_streaks', 'collapsed_pipe_brackets'],
    puzzleVariants: ['neutralize_acid_flow', 'brace_weak_bridge', 'choose_intact_machine_path'],
  },
  refractor_rich: {
    id: 'refractor_rich',
    displayName: 'Refractor-Rich',
    lighting: { palette: ['#55fff0', '#d275ff', '#7ca8ff'], intensityMultiplier: 1.28, flickerChance: 0.01, emergencyPulse: false },
    hazards: [
      { id: 'refractor_beam', chance: 0.5, severity: 'high', effects: { energyDamage: 16, cycleSeconds: 4 } },
      { id: 'energy_bloom', chance: 0.2, severity: 'medium', effects: { pushForce: 6 } },
    ],
    enemies: { favoredTags: ['overcharged_elite', 'sensor_reaverbot', 'powered_turret'], suppressedTags: [], countMultiplier: 1.08, healthMultiplier: 1.14, behaviorModifiers: ['energy_shield_chance'] },
    rewards: { currencyMultiplier: 1.25, rareChanceDelta: 0.18, bonusTags: ['refractor_shard', 'energy_weapon_part', 'chip_upgrade'] },
    ambience: { loops: ['crystal_resonance', 'clean_energy_hum'], oneShots: ['refractor_chime'], particles: ['prismatic_motes', 'light_rays'] },
    props: ['crystal_growths', 'refractor_pylons', 'prismatic_conduits', 'energy_collectors'],
    puzzleVariants: ['align_refractor_beams', 'split_power_between_receivers', 'use_energy_bridge', 'overload_elite_shield_source'],
  },
});

/**
 * Pools mirror the dungeon generator's current authored room types. Imported
 * coolantRelay rooms share the coolant pool so the mapping remains useful if
 * imported GLB rooms are re-enabled.
 */
export const ROOM_ARCHETYPE_POOLS_BY_TYPE = deepFreeze({
  entrance: ['security_checkpoint'],
  server: ['ancient_server_crypt', 'surveillance_control_theater', 'data_shrine_machine_chapel'],
  machine: ['assembly_line_hall', 'reaverbot_recharge_chamber', 'reactor_support_chamber', 'storage_vault_parts_warehouse', 'large_mini_dungeon_room'],
  coolant: ['fluid_tank_chamber', 'pump_and_coolant_works', 'reactor_support_chamber'],
  coolantRelay: ['pump_and_coolant_works', 'fluid_tank_chamber', 'reactor_support_chamber'],
  enemy: ['reaverbot_nest', 'reaverbot_recharge_chamber', 'specimen_containment_room'],
  keycard: ['security_checkpoint', 'surveillance_control_theater', 'ancient_server_crypt', 'specimen_containment_room'],
  trap: ['hazard_processing_room', 'pump_and_coolant_works', 'fluid_tank_chamber', 'vertical_maintenance_shaft'],
  conveyor: ['assembly_line_hall', 'hazard_processing_room', 'storage_vault_parts_warehouse'],
  boss: ['reactor_support_chamber', 'data_shrine_machine_chapel', 'reaverbot_recharge_chamber', 'large_mini_dungeon_room'],
  shrine: ['data_shrine_machine_chapel', 'reactor_support_chamber', 'ancient_server_crypt'],
  bonus: ['storage_vault_parts_warehouse', 'specimen_containment_room', 'ancient_server_crypt'],
});

export const ROOM_FLAVOR_POOLS_BY_TYPE = deepFreeze({
  entrance: ['locked_down', 'dormant', 'overgrown', 'corroded'],
  server: ['powered', 'dormant', 'alarmed', 'dark', 'refractor_rich', 'collapsed'],
  machine: ['powered', 'overheated', 'refractor_rich', 'corroded', 'unstable', 'collapsed'],
  coolant: ['flooded', 'electrified', 'overheated', 'frozen', 'corroded', 'powered'],
  coolantRelay: ['powered', 'flooded', 'electrified', 'overheated', 'frozen', 'unstable'],
  enemy: ['infested', 'dormant', 'dark', 'collapsed', 'alarmed'],
  keycard: ['locked_down', 'alarmed', 'dark', 'powered'],
  trap: ['overheated', 'unstable', 'electrified', 'flooded', 'corroded'],
  conveyor: ['powered', 'collapsed', 'overheated', 'corroded', 'unstable'],
  boss: ['alarmed', 'powered', 'refractor_rich', 'unstable', 'overheated'],
  shrine: ['refractor_rich', 'powered', 'dormant', 'dark', 'overgrown'],
  bonus: ['collapsed', 'corroded', 'dark', 'refractor_rich', 'overgrown'],
});

const normalizeId = (value) => String(value ?? '')
  .trim()
  .toLowerCase()
  .replace(/['’]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const ARCHETYPE_ALIAS_TO_ID = deepFreeze(
  Object.fromEntries(
    INDUSTRIAL_ROOM_ARCHETYPES.flatMap((archetype) => [
      [normalizeId(archetype.id), archetype.id],
      [normalizeId(archetype.displayName), archetype.id],
    ]),
  ),
);

const FLAVOR_ALIAS_TO_ID = deepFreeze(
  Object.fromEntries(
    Object.values(FLAVOR_MODIFIERS).flatMap((flavor) => [
      [normalizeId(flavor.id), flavor.id],
      [normalizeId(flavor.displayName), flavor.id],
    ]),
  ),
);

const choose = (values, random) => {
  if (!values?.length) return undefined;
  const numericRoll = Number(random());
  const finiteRoll = Number.isFinite(numericRoll) ? numericRoll : 0;
  const clampedRoll = Math.max(0, Math.min(0.999999999999, finiteRoll));
  return values[Math.floor(clampedRoll * values.length)];
};

const resolveArchetypeId = (value) => ARCHETYPE_ALIAS_TO_ID[normalizeId(value)];
const resolveFlavorId = (value) => FLAVOR_ALIAS_TO_ID[normalizeId(value)];

/**
 * Returns a mutable deep clone so a room instance can annotate or alter its
 * metadata without mutating the shared immutable catalog.
 */
export function getIndustrialRoomArchetype(idOrDisplayName) {
  const id = resolveArchetypeId(idOrDisplayName);
  return id ? cloneMetadata(INDUSTRIAL_ROOM_ARCHETYPE_BY_ID[id]) : null;
}

/** Returns a mutable deep clone of a documented flavor modifier. */
export function getIndustrialFlavorModifier(idOrDisplayName) {
  const id = resolveFlavorId(idOrDisplayName);
  return id ? cloneMetadata(FLAVOR_MODIFIERS[id]) : null;
}

/**
 * Resolves a complete, independently mutable room metadata instance.
 *
 * @param {object|string} options A room type string, or resolver options.
 * @param {string} [options.roomType='machine'] Existing DungeonGenerator room type.
 * @param {string} [options.archetypeId] Optional catalog id or display name.
 * @param {string} [options.flavorId] Optional flavor id or display name.
 * @param {string} [options.layoutVariantId] Optional layout variant id.
 * @param {string} [options.verticalityOptionId] Optional verticality option id.
 * @param {Function} [options.random=Math.random] Injectable deterministic RNG.
 */
export function resolveIndustrialRoomMetadata(options = {}) {
  const resolverOptions = typeof options === 'string' ? { roomType: options } : (options ?? {});
  const roomType = String(resolverOptions.roomType ?? 'machine');
  const random = typeof resolverOptions.random === 'function' ? resolverOptions.random : Math.random;

  const typeArchetypePool = ROOM_ARCHETYPE_POOLS_BY_TYPE[roomType]
    ?? INDUSTRIAL_ROOM_ARCHETYPES.map((archetype) => archetype.id);
  const requestedArchetypeId = resolveArchetypeId(resolverOptions.archetypeId);
  const archetypeId = requestedArchetypeId ?? choose(typeArchetypePool, random);
  const sourceArchetype = INDUSTRIAL_ROOM_ARCHETYPE_BY_ID[archetypeId]
    ?? INDUSTRIAL_ROOM_ARCHETYPES[0];

  const typeFlavorPool = ROOM_FLAVOR_POOLS_BY_TYPE[roomType]
    ?? Object.keys(FLAVOR_MODIFIERS);
  const requestedFlavorId = resolveFlavorId(resolverOptions.flavorId);
  const flavorId = requestedFlavorId ?? choose(typeFlavorPool, random);
  const sourceFlavor = FLAVOR_MODIFIERS[flavorId] ?? FLAVOR_MODIFIERS.dormant;

  const requestedLayoutId = normalizeId(resolverOptions.layoutVariantId);
  const sourceLayoutVariant = sourceArchetype.layoutVariants.find(
    (variant) => normalizeId(variant.id) === requestedLayoutId,
  ) ?? choose(sourceArchetype.layoutVariants, random);

  const requestedVerticalityId = normalizeId(resolverOptions.verticalityOptionId);
  const sourceVerticalityOption = sourceArchetype.verticalityOptions.find(
    (option) => normalizeId(option.id) === requestedVerticalityId,
  ) ?? choose(sourceArchetype.verticalityOptions, random);

  return {
    roomType,
    archetypeId: sourceArchetype.id,
    flavorId: sourceFlavor.id,
    archetype: cloneMetadata(sourceArchetype),
    flavor: cloneMetadata(sourceFlavor),
    layoutVariant: cloneMetadata(sourceLayoutVariant),
    verticalityOption: cloneMetadata(sourceVerticalityOption),
    environmentalStory: choose(sourceArchetype.environmentalStories, random),
    exitRules: cloneMetadata(sourceArchetype.exitRules),
  };
}
