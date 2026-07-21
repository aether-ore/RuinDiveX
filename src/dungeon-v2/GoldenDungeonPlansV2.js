import {
  createDungeonModuleDescriptorV2,
  createDungeonPlanV2,
  deepFreezePlan,
} from './DungeonPlanV2Contract.js';
import { createDungeonSeedStreams } from './SeededSubstreams.js';
import { deriveDungeonTopologySignaturesV2 } from './DungeonTopologySignatureV2.js';
import { GOLDEN_REGION_AUTHORED_DETAILS_V2 } from './GoldenRegionAuthoredDetailsV2.js';
import { REAVERBOT_SALVAGE_SOURCE_MAPS } from '../reaverbots/ReaverbotSalvageCatalog.js';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../TraversalCapabilities.js';
import { getLegacyFixedRoomModuleV2 } from './LegacyFixedRoomModuleCatalogV2.js';
import {
  compileLegacyFixedRoomPlacementV2,
  compileLegacyFixedRoomSupportContractsV2,
  compileLegacyFixedRoomStructuralContractV2,
  createLegacyFixedRoomPlanPlacementRecordV2,
} from './LegacyFixedRoomRuntimeAdapterV2.js';
import { transformPointQuarterTurns } from './DungeonSpatialMathV2.js';
import { integrateSingleRegionNativeV1ModulesV2 } from './SingleRegionNativeV1PlanIntegrationV2.js';
import { integrateSemanticRoomPackProductionV2 } from './SemanticRoomPackProductionIntegrationV2.js';
import { relocateSemanticRoomPackAnnexesV2 } from './SemanticRoomPackAnnexRelocationV2.js';
import {
  integrateCanonicalNativeV1GoldenPhysicalCompositionV2,
} from './CanonicalNativeV1GoldenIntegrationV2.js';
import {
  rebuildCanonicalNativeV1GoldenConnectionsV2,
} from './CanonicalNativeV1GoldenConnectionCoordinatorV2.js';

const MATERIAL_PROFILES = Object.freeze({
  factory: 'industrial-factory-shell-v2',
  waterworks: 'oxidized-waterworks-shell-v2',
  undercroftMagma: 'basalt-foundry-shell-v2',
  undercroftElectrical: 'ceramic-switchyard-shell-v2',
  lab: 'traversal-lab-shell-v2',
});

// Ordinary stairs are continuous walking routes, not precision jumps.  Their
// smooth collision strip must continue far enough into both adjoining decks
// that the player's capsule cannot find a crack or a ledge-climb transition at
// either end.
const STAIR_ENDPOINT_OVERLAP = 1.2;
const STAIR_ENDPOINT_HEIGHT_TOLERANCE = 0.05;
// Portal centres sit on their owning room boundary. Public traversal proves
// entry by walking one full body-width beyond that plane, so any authored
// route that begins after a portal must use this same interior anchor rather
// than steering the player back into the frame.
const PORTAL_INTERIOR_INGRESS_DEPTH = 1.2;
// Raised portal stairs are ordinary walking routes used by the public-input
// controller, whose tank steering can drift about 1.5m from the authored
// centerline while turning.  A 4.8m strip keeps the full 0.42m player capsule
// supported during that turn instead of requiring a corrective jump.
const RAISED_PORTAL_STAIR_WIDTH = 4.8;
// 4 cm beyond the 0.42m player capsule leaves a real deck-edge gap while
// remaining within the strict 0.48m authored endpoint seam tolerance.
const LADDER_BODY_CLEARANCE = 0.46;
const LADDER_TOP_EXIT_INSET = 1.15;
// Root-to-ladder-plane separation. The normalized Volnutt ladder pose reaches
// about 0.402m forward from Hips, so 0.40m places the hands on the rung plane
// without embedding the character root in the rail geometry.
const LADDER_PLAYER_PLANE_CLEARANCE = 0.4;
// A ladder is not a decoration pasted onto a solid deck. Connector ladders
// terminate at an actual open edge, then place the player on a full-depth
// landing far enough from that edge to walk away without jumping.
const LADDER_APERTURE_DEPTH = 1.0;
const LADDER_EXIT_EDGE_INSET = 0.72;
const LADDER_BOTTOM_EGRESS_DISTANCE = 1.15;
const LADDER_MINIMUM_EGRESS_LENGTH = 1.2;
const PLAYER_LADDER_APERTURE_MARGIN = 0.5;
const LADDER_MINIMUM_EGRESS_WIDTH = 1.2;
const LADDER_MINIMUM_EGRESS_HEADROOM = 3.2;
// Native room sockets terminate on the exact authored shell plane. Their
// connector throat therefore has to contain both the open ladder aperture and
// a complete walk-away landing before the shaft turns vertically. The generic
// half-width throat (1.6m for a 3.2m socket) leaves only 0.6m after carving the
// aperture, which is physically too short for the player capsule to dismount.
const NATIVE_LADDER_MINIMUM_THROAT_DEPTH = (
  LADDER_APERTURE_DEPTH + LADDER_MINIMUM_EGRESS_LENGTH + 0.2
);
// Cargo lifts use a 4.8m deck.  Their floor/ceiling apertures must also leave
// room for the enclosing support frame and the player's collision capsule;
// matching the aperture almost exactly to the deck produced only 0.20m of
// clearance per side and made the shaft frame part of the ride path.
const CARGO_LIFT_PLATFORM_HALF_EXTENT = 2.4;
const CARGO_LIFT_SHAFT_FRAME_CLEARANCE = 0.8;
const CARGO_LIFT_SHAFT_APERTURE_SIZE = (
  CARGO_LIFT_PLATFORM_HALF_EXTENT + CARGO_LIFT_SHAFT_FRAME_CLEARANCE
) * 2;
// The conserved water unit is expressed as a geometric volume so differently
// sized authored basins can fill their complete footprints at different exact
// depths. The previous 600m3/10x10m shortcut rendered as a thin blue square in
// the middle of every Waterworks chamber instead of flooding the chamber's
// actual walkable basin.
const WATER_CONSERVED_VOLUME_CUBIC_METRES = 2100;
const WATER_BASIN_WALL_INSET = 0.5;

const ORDINARY_REAVERBOT_SALVAGE_IDS = Object.freeze([...new Set(
  Object.values(REAVERBOT_SALVAGE_SOURCE_MAPS)
    .flatMap((sourceMap) => Object.values(sourceMap))
    .map((materialRecord) => materialRecord.id),
)].sort());

const GOLDEN_REGION_SPECS = Object.freeze([
  region('security', 'factory', 'Security Vestibule', 'sealed ruin entry, Key Seeker station, and credential return hub', -47, 0, 40, 30, 10, 20, 'd4:security:hub-east+north:split-level-keyseeker'),
  // Native V1 Machine Factory footprint (19x15 tiles) shifted west so its
  // off-centre south entrance has a full-width enclosed route from Security.
  region('assembly', 'factory', 'Assembly Pump Cavern', 'sprawling V1 machine factory with three conveyor lanes and upper catwalk exploration', -96, 0, 40, 53.2, 15.2, 42, 'd4:assembly:v1-machine-factory+upper-catwalk+drop-aperture', true),
  region('server', 'factory', 'Server Crypt', 'raised data crypt with pipe-top traversal and salvage alcoves', -90, 6, 0, 34, 12, 26, 'd4:server:crypt-aisles+pipe-loop+offset-stair', true),
  region('freight', 'factory', 'Broken Freight Shaft', 'lower freight catchment, Alpha pedestal, and damage-free recovery climb', -90, -12, 40, 36, 10, 34, 'd4:freight:vertical-catchment+shelf-return+alpha-alcove'),
  region('sorting', 'factory', 'Sorting Gantry', 'automatic cargo sorting, ordinary encounter, and Waterworks threshold', 0, 0, 0, 40, 15, 30, 'd4:sorting:cross-gantry+auto-cargo+water-breach', true),
  region('credential', 'factory', 'Credential Tower', 'multi-tier credential landmark and shortcut hub', 48, 6, 0, 36, 17, 32, 'd4:credential:three-tier-pyramid+side-returns+raised-gate', true),
  region('parts', 'factory', 'Parts Warehouse', 'treasure warehouse with pipe racks and branching catwalks', 48, 6, -43, 38, 14, 28, 'd4:parts:warehouse-grid+overhead-pipe-route+nested-branch'),
  region('nest', 'factory', 'Nest Warehouse', 'optional Reaverbot nest and rare component cache', 96, 10, -43, 38, 14, 30, 'd4:nest:perimeter-shelves+central-hive+service-ladder'),
  region('corkscrew', 'factory', 'Corkscrew Machine Hall', 'rotating gear platforms connecting three functional elevations', 96, 10, 0, 42, 18, 34, 'd4:corkscrew:radial-gear+three-landings+undercroft-mouth', true),
  region('machine-core', 'factory', 'Machine Core', 'final elite arena embedded in working turbine machinery', 148, 16, 0, 42, 18, 34, 'd4:machine-core:turbine-ring+elite-floor+shrine-bridge', true),
  // The extraction landmark uses the native V1 shrine at authored scale. Its
  // yaw-1 footprint is 64.4 x 70m and its west catwalk socket meets the
  // Machine Core bridge at the existing 20m elevation band.
  region('extraction', 'factory', 'Shrine and Extraction', 'native V1 three-tier Refractor shrine, safe return, and extraction pad', 220, 16, 0, 64.4, 15.2, 70, 'd4:shrine:three-tiers+refractor-dais+sealed-extraction'),
  region('freight-sump', 'waterworks', 'Freight Sump', 'drainable flooded cargo basin with bottom-walking routes', -47, -14, 0, 38, 13, 28, 'd4:freight-sump:basin+dry-catwalk+water-breach', true),
  region('reservoir', 'waterworks', 'Reservoir Pump Gallery', 'permanently dry master router surrounding the conserved reservoir', -42, -8, -41, 40, 15, 32, 'd4:reservoir:dry-router-ring+storage-well+pump-bridge', true),
  region('gantry-sump', 'waterworks', 'Gantry Sump', 'upper and submerged gantries with a moving cargo route', 0, -12, -41, 36, 16, 30, 'd4:gantry-sump:split-water-level+moving-cargo+overflow'),
  region('salvage-tunnel', 'waterworks', 'Drained Salvage Tunnel', 'drained-only discovery, Beta pedestal, and cargo-lift return', 0, -18, 0, 34, 12, 26, 'd4:salvage:drain-lock+beta-vault+lift-return'),
  region('hazard-intake', 'undercroft', 'Hazard Intake', 'signaled descent into a hidden damage-free hazard route', 96, -8, 0, 38, 14, 28, 'd4:hazard-intake:descending-islands+safe-bypass+warning-lock', true),
  region('hazard-core', 'undercroft', 'Hazard Core', 'multi-stage hazard cavern, Gamma pedestal, and major cache', 48, -14, 0, 44, 18, 34, 'd4:hazard-core:dual-route+major-cache+return-lift', true),
]);

const GOLDEN_CONNECTION_SPECS = Object.freeze([
  connection('security-assembly', 'security', 'west', -5, 0, 'right', 'assembly', 'south', 19.6, 0, 'right', 'arched-bulkhead', 'walk', { width: 3.2 }),
  connection('assembly-server', 'assembly', 'north', 0, 4.05, 'upper-center', 'server', 'south', 8, 0, 'right', 'stair-gallery', 'stairs', { width: 3.2, detour: { axis: 'z', value: 16 } }),
  connection('server-freight', 'server', 'south', -12, 2, 'upper-left', 'freight', 'north', -12, 4, 'upper-left', 'pipe-tunnel', 'ladder', { verticalFirst: true, traversalEffects: [{ op: 'setState', variableId: 'progression.server-route-entered', value: true }] }),
  // The Security end is deliberately offset from the checkpoint bank. The
  // former z=5 placement put the player's capsule through that machine while
  // leaving the ladder, animation, and abstract graph apparently valid.
  connection('freight-security-shortcut', 'freight', 'west', 6, 2, 'left', 'security', 'east', 6.7, 4, 'upper-right', 'ladder-shaft', 'ladder', { barrierId: 'Gate_Shortcut_Alpha', initiallyOpen: false, verticalLast: true, detour: { axis: 'z', value: 61 } }),
  connection('security-sorting-alpha', 'security', 'north', 5, 4, 'upper-right', 'sorting', 'south', 5, 0, 'right', 'security-bulkhead', 'walk', { barrierId: 'Door_Alpha', initiallyOpen: false }),
  // Each side uses its own clear landing band. A small connector elbow joins
  // them; forcing a shared z previously buried one ladder in the sorting feed
  // belt and the other beneath the Freight Sump inspection vault.
  connection('sorting-freight-sump', 'sorting', 'west', -11.8, 3, 'upper-left', 'freight-sump', 'east', -3.5, 2, 'left', 'water-breach', 'ladder', { verticalFirst: true }),
  // Offset the Reservoir throat half a metre east of the first catwalk leg.
  // With both endpoints at offset 8, that leg's east enclosure wall occupied
  // 0.2m of the destination's required 4.8m player/camera approach volume.
  connection('freight-sump-reservoir', 'freight-sump', 'north', 8, 4, 'upper-right', 'reservoir', 'south', 8.5, 0, 'right', 'pump-catwalk', 'catwalk'),
  connection('reservoir-gantry-sump', 'reservoir', 'east', -8, 0, 'lower-right', 'gantry-sump', 'west', -8, 4, 'upper-left', 'submerged-pipe', 'bottom-walk'),
  connection('gantry-sump-salvage', 'gantry-sump', 'south', -8, 3, 'upper-left', 'salvage-tunnel', 'north', -8, 0, 'left', 'drainage-stair', 'ladder', { verticalFirst: true }),
  verticalConnection('salvage-sorting-shortcut', 'salvage-tunnel', 'ceiling', { x: 6, z: -4 }, 'sorting', 'floor', { x: 6, z: -4 }, 'cargo-lift', 'lift', { direction: 'bidirectional', barrierId: 'Gate_Shortcut_Beta', initiallyOpen: false, mechanismId: 'mechanism.cargo-lift' }),
  connection('sorting-credential-beta', 'sorting', 'east', 8, 5, 'upper-right', 'credential', 'west', 8, 0, 'right', 'pressure-gate', 'walk', { barrierId: 'Door_Beta', initiallyOpen: false }),
  connection('credential-parts', 'credential', 'north', -8, 4, 'upper-left', 'parts', 'south', -8, 4, 'upper-left', 'conveyor-bridge', 'catwalk'),
  // Keep the Parts aperture below its authored ceiling. The previous 11m rise
  // put the top 1.2m of the 4.2m opening through solid roof geometry.
  // Enter the Corkscrew Hall outside the solid Process Alcove shell. Its old
  // z=-8 landing placed the ladder root against that sub-room's west wall.
  connection('parts-corkscrew-service', 'parts', 'east', -5, 9, 'upper-left', 'corkscrew', 'west', -13.5, 8, 'upper-left', 'ramped-service-tunnel', 'ladder'),
  // Keep the optional Nest ladder on the northern service apron.  The former
  // southern placement crossed the elevated Parts-to-Corkscrew incline, so a
  // grounded player at either ladder mount was captured by the unrelated
  // overhead stair surface before the ladder interaction could appear.
  // Keep the complete 4.8m aperture on both authored wall faces. At -12 the
  // Parts side projected 0.4m beyond its north edge, leaving a real enclosure
  // seam even though the connector itself remained navigable.
  connection('parts-nest', 'parts', 'east', -11.6, 0, 'left', 'nest', 'west', -11.6, 0, 'left', 'service-ladder', 'ladder', { verticalFirst: true }),
  connection('nest-corkscrew-service', 'nest', 'south', 9, 0, 'right', 'corkscrew', 'north', 9, 0, 'right', 'gear-bridge', 'gear-platform'),
  // A full maintenance dogleg keeps both ladder landings outside the west
  // gear drive and the Credential inspection vault. A one-metre elbow is
  // narrower than the connector shell and makes its own side walls overlap.
  connection('corkscrew-credential-loop', 'corkscrew', 'west', 14.2, 4, 'upper-left', 'credential', 'east', -4.5, 8, 'lower-right', 'maintenance-pipe', 'ladder', {
    direction: 'bidirectional',
    barrierId: 'Gate_Credential_Loop',
    initiallyOpen: false,
    // Keep this elevated shortcut in a southern service dogleg. Its former
    // direct X/Z footprint stacked over the playable Hazard Intake -> Core
    // connector, so falling through one missing support sample could warp the
    // player into a different route nineteen metres below.
    detour: { axis: 'z', value: 22 },
  }),
  // The undercroft route is an enclosed side-mounted ladder shaft. Keeping it
  // off the chamber floor prevents an always-open hole while still making the
  // LowLanding gear state the physical hatch interlock.
  connection('corkscrew-hazard-intake', 'corkscrew', 'south', 8, 0, 'right', 'hazard-intake', 'south', 16, 3, 'upper-right', 'corkscrew-descent', 'ladder', {
    direction: 'bidirectional',
    mechanismId: 'mechanism.corkscrew-gear',
    verticalFirst: true,
    condition: { op: 'stateEquals', variableId: 'mechanism.corkscrew-gear.state', value: 'LowLanding' },
  }),
  connection('hazard-intake-core', 'hazard-intake', 'west', 10, 3, 'upper-right', 'hazard-core', 'east', -8, 9, 'upper-left', 'hazard-catwalk', 'ladder'),
  // The return shaft occupies the east service bay shared vertically by the
  // Hazard Core and Credential Tower. Its former west-island position cut
  // directly through the major cache, the Hazard Core landmark stair, and an
  // unrelated Sorting-to-Credential stair.
  verticalConnection('hazard-core-credential-return', 'hazard-core', 'ceiling', { x: 12, z: -12 }, 'credential', 'floor', { x: 12, z: -12 }, 'return-lift', 'lift', { direction: 'bidirectional', barrierId: 'Gate_Shortcut_Gamma', initiallyOpen: false, mechanismId: 'mechanism.gamma-return-lift' }),
  connection('corkscrew-machine-core-gamma', 'corkscrew', 'east', -10, 5, 'upper-right', 'machine-core', 'west', -10, 0, 'left', 'blast-gate', 'walk', { barrierId: 'Door_Gamma', initiallyOpen: false }),
  connection('machine-core-extraction-shrine', 'machine-core', 'east', 10, 4.05, 'upper-right', 'extraction', 'west', -19.6, 4.05, 'upper-left', 'shrine-bulkhead', 'walk', { barrierId: 'Door_Shrine', initiallyOpen: false, detour: { axis: 'z', value: -19.6 } }),
  verticalConnection('assembly-freight-drop', 'assembly', 'floor', { x: 11.2, z: 14 }, 'freight', 'ceiling', { x: 5.2, z: 14 }, 'intentional-drop', 'intentional-drop'),
]);

const LAB_REGION_SPECS = Object.freeze([
  region('lab-entry', 'traversal-lab', 'Lab Entry', 'sealed fixture entrance and safe anchor', 0, 0, 0, 30, 10, 20, 'd4:lab-entry:sealed-start+two-exits'),
  region('lab-stairs', 'traversal-lab', 'Walkable Stair Hall', 'continuous walking stairs and ladder transfer', 38, 0, 0, 32, 12, 22, 'd4:lab-stairs:switchback-walk+ladder-side', true),
  region('lab-upper', 'traversal-lab', 'Upper Lift Gallery', 'elevated lift landing and automatic cargo crossing', 84, 8, 0, 36, 12, 26, 'd4:lab-upper:lift-landing+auto-cargo-loop', true),
  region('lab-water-freight', 'traversal-lab', 'Lab Freight Sump', 'first conserved water destination', 50, -10, 37, 34, 12, 26, 'd4:lab-water-freight:basin+dry-return'),
  region('lab-water-reservoir', 'traversal-lab', 'Lab Reservoir', 'permanently dry three-state router', 0, 0, 37, 32, 12, 24, 'd4:lab-water-reservoir:router-ring+storage', true),
  region('lab-water-gantry', 'traversal-lab', 'Lab Gantry Sump', 'third conserved water destination', 100, -10, 37, 34, 12, 26, 'd4:lab-water-gantry:gantry+bottom-route'),
  region('lab-hazards', 'traversal-lab', 'Hazard Timing Hall', 'magma and electrical lanes with damage-free islands', 145, -10, 37, 36, 12, 28, 'd4:lab-hazards:parallel-lanes+safe-islands', true),
  region('lab-gear', 'traversal-lab', 'Corkscrew and Crumble Hall', 'gear alignment and authored collapse to recovery', 134, 0, 0, 38, 16, 28, 'd4:lab-gear:corkscrew+crumble-aperture', true),
  region('lab-recovery', 'traversal-lab', 'Recovery Workshop', 'playable lower catchment and damage-free return', 134, -10, 0, 34, 10, 24, 'd4:lab-recovery:catchment+treasure+return-ladder'),
]);

const LAB_CONNECTION_SPECS = Object.freeze([
  connection('lab-entry-stairs', 'lab-entry', 'east', -4, 0, 'right', 'lab-stairs', 'west', -4, 0, 'left', 'arched-bulkhead', 'walk'),
  connection('lab-stairs-upper', 'lab-stairs', 'east', 4, 6, 'upper-right', 'lab-upper', 'west', 4, 0, 'left', 'stair-gallery', 'stairs'),
  connection('lab-upper-gear', 'lab-upper', 'east', 0, 2, 'upper-center', 'lab-gear', 'west', 0, 10, 'upper-center', 'conveyor-bridge', 'moving-platform', { mechanismId: 'mechanism.lab-auto-cargo' }),
  connection('lab-entry-reservoir', 'lab-entry', 'south', 5, 3, 'upper-right', 'lab-water-reservoir', 'north', 5, 0, 'right', 'pump-catwalk', 'catwalk'),
  connection('lab-reservoir-freight', 'lab-water-reservoir', 'east', -6, 0, 'lower-right', 'lab-water-freight', 'west', -6, 4, 'upper-left', 'water-breach', 'ladder', { verticalFirst: true }),
  connection('lab-freight-gantry', 'lab-water-freight', 'east', 8, 0, 'right', 'lab-water-gantry', 'west', 8, 0, 'right', 'submerged-pipe', 'bottom-walk'),
  connection('lab-gantry-hazards', 'lab-water-gantry', 'east', -7, 0, 'right', 'lab-hazards', 'west', -7, 0, 'right', 'hazard-catwalk', 'catwalk'),
  connection('lab-hazards-recovery', 'lab-hazards', 'north', -8, 0, 'left', 'lab-recovery', 'south', 8, 0, 'right', 'service-ladder', 'walk'),
  verticalConnection('lab-recovery-gear', 'lab-recovery', 'ceiling', { x: 7, z: -4 }, 'lab-gear', 'floor', { x: 7, z: -4 }, 'return-lift', 'lift', { direction: 'bidirectional', mechanismId: 'mechanism.lab-lift' }),
  verticalConnection('lab-gear-drop', 'lab-gear', 'floor', { x: -8, z: 5 }, 'lab-recovery', 'ceiling', { x: -8, z: 5 }, 'intentional-drop', 'intentional-drop'),
]);

function region(id, districtId, displayName, functionalPurpose, x, floorY, z, width, height, depth, topologySignature, landmark = false) {
  return Object.freeze({
    id,
    districtId,
    displayName,
    functionalPurpose,
    center: Object.freeze({ x, z }),
    floorY,
    size: Object.freeze({ x: width, y: height, z: depth }),
    topologySignature,
    landmark,
  });
}

function connection(id, fromRegionId, fromSide, fromOffset, fromRise, fromBucket, toRegionId, toSide, toOffset, toRise, toBucket, connectorForm, approachType, options = {}) {
  return Object.freeze({
    id,
    fromRegionId,
    toRegionId,
    from: Object.freeze({ side: fromSide, offset: fromOffset, rise: fromRise, placementBucket: fromBucket }),
    to: Object.freeze({ side: toSide, offset: toOffset, rise: toRise, placementBucket: toBucket }),
    connectorForm,
    approachType,
    ...options,
  });
}

function verticalConnection(id, fromRegionId, fromSide, fromOffset, toRegionId, toSide, toOffset, connectorForm, approachType, options = {}) {
  return Object.freeze({
    id,
    fromRegionId,
    toRegionId,
    from: Object.freeze({ side: fromSide, offset: fromOffset, rise: 0, placementBucket: fromSide }),
    to: Object.freeze({ side: toSide, offset: toOffset, rise: 0, placementBucket: toSide }),
    connectorForm,
    approachType,
    direction: 'forward-only',
    ...options,
  });
}

function boundsForSpec(spec) {
  const plan = {
    min: { x: spec.center.x - spec.size.x / 2, y: spec.floorY, z: spec.center.z - spec.size.z / 2 },
    max: { x: spec.center.x + spec.size.x / 2, y: spec.floorY + spec.size.y, z: spec.center.z + spec.size.z / 2 },
  };
  return plan;
}

function vector(x, y, z) {
  return { x, y, z };
}

function boundaryId(regionId, side) {
  return `boundary.${regionId}.${side}`;
}

function cellId(regionId) {
  return `cell.${regionId}.main`;
}

function surfaceId(regionId, suffix = 'main') {
  return `surface.${regionId}.${suffix}`;
}

function facingVectorForSide(side) {
  if (side === 'north') return vector(0, 0, 1);
  if (side === 'south') return vector(0, 0, -1);
  if (side === 'east') return vector(-1, 0, 0);
  if (side === 'west') return vector(1, 0, 0);
  return vector(0, 0, 1);
}

function createLadderGeometryV2({
  planePath,
  climbFacing,
  width = 1.6,
  mountClearance = 1.4,
  bottomExit = null,
  topExit = null,
  ...metadata
}) {
  const facingLength = Math.hypot(climbFacing.x, climbFacing.z);
  if (facingLength <= 0.0001) throw new Error('Ladder geometry requires a non-zero climbFacing.');
  const normalizedFacing = vector(climbFacing.x / facingLength, 0, climbFacing.z / facingLength);
  // `planeNormal` always points away from the rungs toward the climber's body;
  // `climbFacing` points from the player root back toward the ladder plane.
  const planeNormal = vector(-normalizedFacing.x, 0, -normalizedFacing.z);
  const playerRootPath = planePath.map((point) => vector(
    point.x + planeNormal.x * LADDER_PLAYER_PLANE_CLEARANCE,
    point.y,
    point.z + planeNormal.z * LADDER_PLAYER_PLANE_CLEARANCE,
  ));
  const planeBottomIndex = planePath[0].y <= planePath.at(-1).y ? 0 : planePath.length - 1;
  const planeTopIndex = planeBottomIndex === 0 ? planePath.length - 1 : 0;
  const rootBottom = playerRootPath[planeBottomIndex];
  const rootTop = playerRootPath[planeTopIndex];
  const planeBottom = planePath[planeBottomIndex];
  const planeTop = planePath[planeTopIndex];
  const exitOrRoot = (exit, planePoint, rootPoint) => {
    if (!exit || Math.hypot(
      exit.x - planePoint.x,
      exit.y - planePoint.y,
      exit.z - planePoint.z,
    ) <= 0.05) return rootPoint;
    return exit;
  };
  return {
    type: 'ladder',
    // `path` is the authoritative player-root line used by runtime and route
    // proofs. `planePath` owns the visible rail/rung plane separately.
    path: playerRootPath,
    planePath,
    width,
    mountClearance,
    climbFacing: normalizedFacing,
    // Compatibility alias for older ladder consumers during migration.
    facing: normalizedFacing,
    planeNormal,
    bodyClearance: LADDER_PLAYER_PLANE_CLEARANCE,
    bottomExit: exitOrRoot(bottomExit, planeBottom, rootBottom),
    topExit: exitOrRoot(topExit, planeTop, rootTop),
    ...metadata,
  };
}

function horizontalDirection(from, to, label) {
  const dx = Number(to?.x) - Number(from?.x);
  const dz = Number(to?.z) - Number(from?.z);
  const length = Math.hypot(dx, dz);
  if (!Number.isFinite(length) || length <= 0.001) {
    throw new Error(`${label} requires a non-zero horizontal direction.`);
  }
  return vector(dx / length, 0, dz / length);
}

function pointAlong(point, direction, distance, y = point.y) {
  return vector(
    point.x + direction.x * distance,
    y,
    point.z + direction.z * distance,
  );
}

function ladderOpeningBounds({ rootPoint, egressDirection, width, depth, floorY }) {
  const tangent = { x: -egressDirection.z, z: egressDirection.x };
  const halfWidth = width * 0.5;
  const corners = [
    pointAlong(rootPoint, egressDirection, -LADDER_PLAYER_PLANE_CLEARANCE, floorY),
    pointAlong(rootPoint, egressDirection, depth, floorY),
  ].flatMap((center) => [-1, 1].map((sign) => ({
    x: center.x + tangent.x * halfWidth * sign,
    z: center.z + tangent.z * halfWidth * sign,
  })));
  return {
    min: vector(
      Math.min(...corners.map(({ x }) => x)),
      floorY - 0.05,
      Math.min(...corners.map(({ z }) => z)),
    ),
    max: vector(
      Math.max(...corners.map(({ x }) => x)),
      floorY + 0.35,
      Math.max(...corners.map(({ z }) => z)),
    ),
  };
}

function boundaryBounds(bounds, side, thickness = 0.4) {
  const { min, max } = bounds;
  if (side === 'north') return { min: vector(min.x, min.y, min.z - thickness), max: vector(max.x, max.y, min.z) };
  if (side === 'south') return { min: vector(min.x, min.y, max.z), max: vector(max.x, max.y, max.z + thickness) };
  if (side === 'west') return { min: vector(min.x - thickness, min.y, min.z), max: vector(min.x, max.y, max.z) };
  if (side === 'east') return { min: vector(max.x, min.y, min.z), max: vector(max.x + thickness, max.y, max.z) };
  if (side === 'floor') return { min: vector(min.x, min.y - thickness, min.z), max: vector(max.x, min.y, max.z) };
  return { min: vector(min.x, max.y, min.z), max: vector(max.x, max.y + thickness, max.z) };
}

function endpointFor(spec, endpoint, regionById, connectionSpec = null) {
  const regionSpec = regionById.get(spec);
  const bounds = boundsForSpec(regionSpec);
  const side = endpoint.side;
  const vertical = side === 'floor' || side === 'ceiling';
  let center;
  let elevation;
  if (vertical) {
    const offset = endpoint.offset ?? { x: 0, z: 0 };
    center = vector(
      regionSpec.center.x + Number(offset.x ?? 0),
      side === 'floor' ? bounds.min.y : bounds.max.y,
      regionSpec.center.z + Number(offset.z ?? 0),
    );
    elevation = side === 'floor' ? bounds.min.y : bounds.max.y;
  } else {
    elevation = regionSpec.floorY + Number(endpoint.rise ?? 0);
    const doorCenterY = elevation + 2.1;
    if (side === 'north' || side === 'south') {
      center = vector(regionSpec.center.x + Number(endpoint.offset ?? 0), doorCenterY, side === 'north' ? bounds.min.z : bounds.max.z);
    } else {
      center = vector(side === 'west' ? bounds.min.x : bounds.max.x, doorCenterY, regionSpec.center.z + Number(endpoint.offset ?? 0));
    }
  }

  return {
    regionId: regionSpec.id,
    cellId: cellId(regionSpec.id),
    boundaryId: boundaryId(regionSpec.id, side),
    side,
    center,
    elevation,
    placementBucket: endpoint.placementBucket,
    dimensions: vertical
      ? connectionSpec?.approachType === 'lift'
        ? { width: CARGO_LIFT_SHAFT_APERTURE_SIZE, height: 0.8, depth: CARGO_LIFT_SHAFT_APERTURE_SIZE }
        : { width: 5.2, height: 0.8, depth: 5.2 }
      : { width: Number(connectionSpec?.width ?? 4.8), height: 4.2, depth: 1.2 },
  };
}

function makePortals(regionSpecs, connectionSpecs) {
  const regionById = new Map(regionSpecs.map((entry) => [entry.id, entry]));
  return connectionSpecs.map((spec, order) => {
    const from = endpointFor(spec.fromRegionId, spec.from, regionById, spec);
    const to = endpointFor(spec.toRegionId, spec.to, regionById, spec);
    const conditions = spec.condition ? [spec.condition] : [];
    if (spec.barrierId) {
      conditions.push({ op: 'gateOpen', gateId: spec.barrierId });
    }
    return {
      id: `portal.${spec.id}`,
      order,
      from,
      to,
      connectorForm: spec.connectorForm,
      placementBucket: from.placementBucket,
      elevationBand: Math.min(from.elevation, to.elevation),
      elevationBands: [from.elevation, to.elevation],
      approachType: spec.approachType,
      direction: spec.direction ?? 'bidirectional',
      barrierId: spec.barrierId ?? null,
      initiallyOpen: spec.initiallyOpen ?? true,
      mechanismId: spec.mechanismId ?? null,
      conditions,
      traversalEffects: spec.traversalEffects ?? [],
      traversal: {
        mode: spec.approachType,
        // Lift sockets reserve a wider 6.4m structural aperture for the
        // enclosing frame. The traversable deck itself is the authored 4.8m
        // platform; treating the frame clearance as player width makes the
        // portal contract incorrectly require walking through its corner posts.
        minimumWidth: spec.approachType === 'lift'
          ? CARGO_LIFT_PLATFORM_HALF_EXTENT * 2
          : Math.min(from.dimensions.width, to.dimensions.width),
        minimumHeadroom: 3.2,
        cameraClearance: 1.8,
        interiorIngressDepth: PORTAL_INTERIOR_INGRESS_DEPTH,
      },
      connectorProfile: {
        enclosed: true,
        framed: true,
        supported: true,
        wallProfile: `${spec.connectorForm}-walls-v2`,
        ceilingProfile: `${spec.connectorForm}-ceiling-v2`,
        supportProfile: `${spec.connectorForm}-supports-v2`,
      },
      authoredRoute: {
        mode: spec.verticalFirst ? 'vertical-first' : spec.verticalLast ? 'vertical-last' : 'adjacent-authored',
        detour: spec.detour ?? null,
      },
      visibleDestinationRegionId: spec.toRegionId,
    };
  });
}

function makeSpatialContract(regionSpecs, portals, materialByDistrict) {
  const openingsByBoundary = new Map();
  for (const portal of portals) {
    for (const [endpointIndex, endpoint] of [portal.from, portal.to].entries()) {
      if (!openingsByBoundary.has(endpoint.boundaryId)) openingsByBoundary.set(endpoint.boundaryId, []);
      openingsByBoundary.get(endpoint.boundaryId).push({
        id: `opening.${portal.id.replace('portal.', '')}.${endpointIndex === 0 ? 'from' : 'to'}`,
        portalId: portal.id,
        center: endpoint.center,
        dimensions: endpoint.dimensions,
      });
    }
  }

  const spatialCells = [];
  const structuralBoundaries = [];
  const walkableSurfaces = [];
  const traversalLinks = [];
  const structuralFixtures = [];
  const fallPortalByRegion = new Map(portals
    .filter((portal) => portal.approachType === 'intentional-drop' && portal.from.side === 'floor')
    .map((portal) => [portal.from.regionId, portal]));
  const floorPortalsByRegion = new Map();
  for (const portal of portals) {
    for (const endpoint of [portal.from, portal.to]) {
      if (endpoint.side !== 'floor') continue;
      const records = floorPortalsByRegion.get(endpoint.regionId) ?? [];
      records.push({ portal, endpoint });
      floorPortalsByRegion.set(endpoint.regionId, records);
    }
  }
  for (const spec of regionSpecs) {
    const bounds = boundsForSpec(spec);
    const id = cellId(spec.id);
    spatialCells.push({
      id,
      regionId: spec.id,
      bounds,
      playable: true,
      interior: true,
      cameraContained: true,
      occupiedVolume: true,
      compoundId: spec.landmark ? `compound.${spec.id}` : null,
      compoundShell: spec.landmark,
    });
    for (const side of ['north', 'south', 'east', 'west', 'floor', 'ceiling']) {
      const idForBoundary = boundaryId(spec.id, side);
      const openings = openingsByBoundary.get(idForBoundary) ?? [];
      structuralBoundaries.push({
        id: idForBoundary,
        cellId: id,
        regionId: spec.id,
        side,
        kind: openings.length ? 'portal-frame' : 'solid',
        bounds: boundaryBounds(bounds, side),
        openings,
        materialProfileId: materialByDistrict[spec.districtId],
        visualProfile: `${materialByDistrict[spec.districtId]}:${side}`,
        collider: true,
        collision: 'static',
        opaque: true,
      });
    }
    pushPrimaryFloorSurfaces({
      spec,
      bounds,
      fallPortal: fallPortalByRegion.get(spec.id),
      floorPortals: floorPortalsByRegion.get(spec.id) ?? [],
      materialProfileId: materialByDistrict[spec.districtId],
      walkableSurfaces,
      traversalLinks,
      structuralFixtures,
    });

    if (spec.landmark) {
      const upperY = spec.floorY + Math.min(4, spec.size.y - 4);
      const catwalkId = surfaceId(spec.id, 'landmark-catwalk');
      const catwalkSupportIds = [
        `fixture.${spec.id}.catwalk-supports`,
        ...(spec.id === 'assembly' ? ['fixture.assembly.stair-landing-supports'] : []),
      ];
      walkableSurfaces.push({
        id: catwalkId,
        regionId: spec.id,
        cellId: id,
        bounds: {
          min: vector(spec.center.x - spec.size.x * 0.32, upperY, spec.center.z - 2.1),
          // The north edge deliberately overlaps the raised inspection vault
          // rather than stopping short of it.  This is a real shared walking
          // seam, not a symbolic link between disconnected platforms.
          // Assembly's diagonal stair needs a real turning/landing apron.
          // The old narrow east/south corner let ordinary forward inertia
          // leave the deck immediately after a successful grounded climb.
          max: vector(
            spec.center.x + spec.size.x * (spec.id === 'assembly' ? 0.47 : 0.32),
            upperY + 0.3,
            spec.center.z + (spec.id === 'assembly' ? 6.5 : 4.1),
          ),
        },
        purpose: `elevated machinery inspection route in ${spec.displayName}`,
        supportBoundaryIds: [boundaryId(spec.id, 'floor')],
        supportFixtureIds: catwalkSupportIds,
        supportProfile: 'paired-braced-columns-v2',
        visualProfile: `${materialByDistrict[spec.districtId]}:inspection-catwalk`,
        collision: 'static',
        hazardTag: null,
      });
      const stairId = surfaceId(spec.id, 'landmark-stairs');
      walkableSurfaces.push({
        id: stairId,
        regionId: spec.id,
        cellId: id,
        bounds: {
          min: vector(spec.center.x - spec.size.x * 0.38, spec.floorY, spec.center.z - 4.5),
          max: vector(spec.center.x + spec.size.x * 0.12, upperY + 0.3, spec.center.z + 4.5),
        },
        purpose: `walkable stair access to ${catwalkId}`,
        supportBoundaryIds: [boundaryId(spec.id, 'floor')],
        supportProfile: 'continuous-stair-stringers-v2',
        visualProfile: `${materialByDistrict[spec.districtId]}:walkable-stairs`,
        collision: 'static',
        hazardTag: null,
        geometry: {
          type: 'stairs',
          path: [
            vector(
              spec.center.x - spec.size.x * 0.38,
              spec.floorY,
              // Assembly is entered from the east side of the pump hall.
              // Its former foot sat against the south wall, so a player
              // steering toward it intersected the elevated middle of the
              // diagonal stair before reaching the first tread. Pull the
              // authored foot into the lower deck to reserve a real ground
              // approach lane; the other landmarks retain their authored
              // silhouettes until they receive equivalent room-specific
              // circulation contracts.
              spec.center.z + spec.size.z * (spec.id === 'assembly' ? 0.22 : 0.35),
            ),
            vector(spec.center.x + spec.size.x * 0.1, upperY, spec.center.z - spec.size.z * 0.35),
          ],
          maxRiser: 0.18,
          minimumTread: 0.45,
          width: 3.2,
          ledgeClimbDisabled: true,
          endpointSurfaceIds: {
            start: surfaceId(spec.id),
            end: catwalkId,
          },
          minimumEndpointOverlap: STAIR_ENDPOINT_OVERLAP,
          maximumEndpointHeightDelta: STAIR_ENDPOINT_HEIGHT_TOLERANCE,
        },
      });
      traversalLinks.push({ id: `traversal.${spec.id}.landmark-stairs`, regionId: spec.id, fromSurfaceId: surfaceId(spec.id), toSurfaceId: catwalkId, viaSurfaceId: stairId, mode: 'walkable-stairs', bidirectional: true, minimumWidth: 3.2, maximumRiser: 0.18, minimumTread: 0.45 });
      structuralFixtures.push(
        // Leave a capsule-wide circulation lane around both catwalk ends.
        // The catwalk itself spans 64% of the chamber width, so a 55%
        // braced support bank still visibly carries it while avoiding the
        // raised portal stair approaches beside the end columns.
        fixture(spec, 'catwalk-supports', 'structural-support', { x: 0, y: 0, z: 0 }, { x: spec.size.x * 0.55, y: upperY - spec.floorY, z: 1.4 }, materialByDistrict[spec.districtId], 'blocking', [boundaryId(spec.id, 'floor')]),
      );
      if (spec.id === 'assembly') {
        const landingSupport = fixture(
          spec,
          'stair-landing-supports',
          'structural-support',
          // Carry the enlarged turning apron from its interior edge. The
          // former east posts reached into the Security portal's room-side
          // approach even though the walkable apron itself remained clear.
          // Shifting the visible brace bank west preserves support beneath
          // the recorded stair overshoot while keeping the doorway volume
          // physically and visually unobstructed.
          { x: 15, y: 0, z: 3 },
          { x: 5, y: upperY - spec.floorY, z: 4 },
          materialByDistrict[spec.districtId],
          'blocking',
          [boundaryId(spec.id, 'floor')],
        );
        landingSupport.gameplayPurpose = 'visibly braced turning apron at the Assembly stair top';
        structuralFixtures.push(landingSupport);
      }
      if (!GOLDEN_REGION_AUTHORED_DETAILS_V2[spec.id]) {
        structuralFixtures.push(
          fixture(spec, 'primary-machine', 'functional-machine', {
            // The traversal lab uses these machines as chamber landmarks,
            // never as obstacles on the authored gear boarding point or the
            // centerline used to prove each hazard lane. Keep both machines
            // against a serviced perimeter with a full capsule-width gap.
            x: spec.id === 'lab-gear'
              ? spec.size.x * 0.3
              : spec.id === 'lab-hazards'
                ? -spec.size.x * 0.25
                : 0,
            y: 0,
            z: spec.id.includes('corkscrew') ? spec.size.z * 0.1 : spec.size.z * 0.22,
          }, { x: 6.4, y: Math.min(7, spec.size.y - 1), z: 5.2 }, materialByDistrict[spec.districtId], 'blocking', [boundaryId(spec.id, 'floor')]),
          fixture(spec, 'service-pipe', 'traversal-pipe', {
            x: spec.size.x * 0.2,
            // The stair lab's service main is an overhead landmark. Keeping
            // it above the full 3.2m player capsule leaves the authored
            // floor-to-raised-portal stair lane physically continuous.
            y: spec.id === 'lab-stairs'
              ? Math.min(spec.size.y - 2.5, upperY - spec.floorY + 3.5)
              : upperY - spec.floorY - 1.2,
            z: spec.districtId === 'waterworks' || spec.id.includes('water-reservoir')
              ? spec.size.z * 0.28
              : -spec.size.z * 0.28,
          }, { x: Math.min(12, spec.size.x * 0.3), y: 2.2, z: 2.2 }, materialByDistrict[spec.districtId], 'blocking', [boundaryId(spec.id, 'east'), boundaryId(spec.id, 'west')]),
          fixture(spec, 'secondary-process', spec.districtId === 'waterworks' ? 'pump-array' : 'control-bank', {
            // The gear lab's north floor joins the main deck at the west edge.
            // Keep its machine bank on the opposite side so the registered
            // floor seam remains a real capsule-width route.
            x: spec.id === 'lab-gear' ? spec.size.x * 0.22 : -spec.size.x * 0.22,
            y: 0,
            z: -spec.size.z * 0.24,
          }, { x: 5.2, y: Math.min(5, spec.size.y - 1), z: 4.8 }, materialByDistrict[spec.districtId], 'blocking', [boundaryId(spec.id, 'floor')]),
        );
      }
      addCompoundLandmarkSubcells({ spec, materialProfileId: materialByDistrict[spec.districtId], spatialCells, structuralBoundaries, walkableSurfaces, traversalLinks, structuralFixtures });
    }
    addAuthoredFunctionalFixtures({
      spec,
      materialProfileId: materialByDistrict[spec.districtId],
      structuralFixtures,
    });
  }

  for (const portal of portals) {
    for (const endpoint of [portal.from, portal.to]) {
      const spec = regionSpecs.find((entry) => entry.id === endpoint.regionId);
      if (!spec || endpoint.elevation <= spec.floorY + 0.2 || endpoint.side === 'floor' || endpoint.side === 'ceiling') continue;
      const half = 3;
      const inward = facingVectorForSide(endpoint.side);
      const ladderApproach = portal.approachType === 'ladder';
      const alphaGateApproach = portal.id === 'portal.security-sorting-alpha';
      const landingHalfX = alphaGateApproach && Math.abs(inward.z) > 0.5 ? 4 : half;
      const landingHalfZ = alphaGateApproach && Math.abs(inward.x) > 0.5 ? 4 : half;
      // A raised landing at a wall portal must live inside the chamber.  The
      // previous centred square left half its deck in the connector and put a
      // vertical ladder directly underneath a solid deck/support cap.  For a
      // ladder endpoint, carry the landing inward by its half-depth and mount
      // the ladder just beyond the inner edge, leaving the portal throat clear.
      const landingCenter = ladderApproach
        ? vector(
            endpoint.center.x + inward.x * half,
            endpoint.elevation,
            endpoint.center.z + inward.z * half,
          )
        : vector(endpoint.center.x, endpoint.elevation, endpoint.center.z);
      // Carry raised decks from their perimeter, not from a narrow column
      // cluster directly beneath the stair/ladder seam.  The former +/-1.2m
      // support box placed a braced corner post inside the player's only
      // grounded approach to its full authored landing width.
      const landingSupportDepthHalfExtent = half - 0.25;
      const landingSupportLateralHalfExtent = (
        Math.abs(inward.x) > 0.5 ? landingHalfZ : landingHalfX
      ) - 0.25;
      const landingSupportInnerInset = 0.5;
      const supportInnerEdge = pointAlong(
        landingCenter,
        inward,
        landingSupportInnerInset,
        spec.floorY,
      );
      const supportOuterEdge = pointAlong(
        landingCenter,
        inward,
        -landingSupportDepthHalfExtent,
        spec.floorY,
      );
      const supportBounds = Math.abs(inward.x) > 0.5
        ? {
            min: vector(
              Math.min(supportInnerEdge.x, supportOuterEdge.x),
              spec.floorY,
              landingCenter.z - landingSupportLateralHalfExtent,
            ),
            max: vector(
              Math.max(supportInnerEdge.x, supportOuterEdge.x),
              endpoint.elevation,
              landingCenter.z + landingSupportLateralHalfExtent,
            ),
          }
        : {
            min: vector(
              landingCenter.x - landingSupportLateralHalfExtent,
              spec.floorY,
              Math.min(supportInnerEdge.z, supportOuterEdge.z),
            ),
            max: vector(
              landingCenter.x + landingSupportLateralHalfExtent,
              endpoint.elevation,
              Math.max(supportInnerEdge.z, supportOuterEdge.z),
            ),
          };
      const landingSupportId = `fixture.${spec.id}.support-${portal.id.replace('portal.', '')}`;
      structuralFixtures.push({
        id: landingSupportId,
        type: 'structural-support',
        regionId: spec.id,
        cellId: cellId(spec.id),
        bounds: supportBounds,
        materialProfileId: materialByDistrict[spec.districtId],
        visualProfile: 'braced-landing-columns-v2',
        openApproachAxis: endpoint.side === 'east' || endpoint.side === 'west' ? 'x' : 'z',
        collision: 'blocking',
        supportBoundaryIds: [boundaryId(spec.id, 'floor')],
        gameplayPurpose: `visibly supports the raised landing for ${portal.id}`,
      });
      walkableSurfaces.push({
        id: surfaceId(spec.id, `landing-${portal.id.replace('portal.', '')}`),
        regionId: spec.id,
        cellId: cellId(spec.id),
        bounds: {
          min: vector(landingCenter.x - landingHalfX, endpoint.elevation, landingCenter.z - landingHalfZ),
          max: vector(landingCenter.x + landingHalfX, endpoint.elevation + 0.3, landingCenter.z + landingHalfZ),
        },
        purpose: `supported landing for ${portal.id}`,
        supportBoundaryIds: [boundaryId(spec.id, 'floor')],
        supportFixtureIds: [landingSupportId],
        supportProfile: 'braced-steel-columns-v2',
        visualProfile: `${materialByDistrict[spec.districtId]}:supported-catwalk`,
        collision: 'static',
        hazardTag: null,
      });
      if (['moving-platform', 'gear-platform', 'lift'].includes(portal.approachType)) {
        traversalLinks.push({
          id: `traversal.${spec.id}.${portal.id.replace('portal.', '')}`,
          regionId: spec.id,
          fromSurfaceId: surfaceId(spec.id),
          toSurfaceId: surfaceId(spec.id, `landing-${portal.id.replace('portal.', '')}`),
          mode: portal.approachType,
          bidirectional: true,
          mechanismId: portal.mechanismId,
          minimumWidth: 1.2,
        });
        continue;
      }
      const approachId = surfaceId(spec.id, `approach-${portal.id.replace('portal.', '')}`);
      const landingSurfaceId = surfaceId(spec.id, `landing-${portal.id.replace('portal.', '')}`);
      const landingSurface = walkableSurfaces.find(({ id }) => id === landingSurfaceId);
      const rise = endpoint.elevation - spec.floorY;
      // Meet the room-facing edge of the raised deck with only the authored
      // 1.2m seam overlap. Ending at the portal/landing center sent half of an
      // ordinary incline beneath the solid landing slab (3m in the lab).
      const stairLandingSeamPoint = ladderApproach
        ? null
        : pointAlong(
            endpoint.center,
            inward,
            half - STAIR_ENDPOINT_OVERLAP,
            endpoint.elevation,
          );
      // The Security -> Sorting Alpha gate is deliberately elevated so its
      // closed barrier cannot be vaulted.  Its old generic room-centre start
      // made the required stair diagonal, however, and normal tank steering
      // could slide a player capsule off the narrow outside edge before the
      // first turn correction completed.  Keep this authored progression
      // approach square to the portal and give it the full tread run needed
      // for the 4m rise.  This changes neither the gate plane nor its landing.
      const authoredStairStart = alphaGateApproach
        ? pointAlong(stairLandingSeamPoint, inward, 10, spec.floorY)
        : vector(spec.center.x, spec.floorY, spec.center.z);
      const authoredStairWidth = alphaGateApproach
        ? (Math.abs(inward.x) > 0.5 ? landingHalfZ : landingHalfX) * 2
        : RAISED_PORTAL_STAIR_WIDTH;
      const primaryFloorCandidates = walkableSurfaces
        .filter((surface) => surface.regionId === spec.id && surface.primaryFloor === true)
        .sort((left, right) => (
          planarDistanceSquaredToBounds(endpoint.center, left.bounds)
          - planarDistanceSquaredToBounds(endpoint.center, right.bounds)
        ) || left.id.localeCompare(right.id));
      let mainSurface = null;
      if (ladderApproach) {
        // A carved lift shaft can split the floor between the wall socket and
        // the actual ladder dismount. The nearest fragment to the socket is
        // therefore not evidence that it supports the player's feet. Resolve
        // ownership from the authored bottom exit itself, preferring a piece
        // which also owns the end of the required no-jump walk-away segment.
        const probeFloorY = spec.floorY + 0.35;
        const probeCenter = vector(
          endpoint.center.x + inward.x * (half * 2 + LADDER_BODY_CLEARANCE),
          probeFloorY,
          endpoint.center.z + inward.z * (half * 2 + LADDER_BODY_CLEARANCE),
        );
        const probeRoot = pointAlong(
          probeCenter,
          inward,
          LADDER_PLAYER_PLANE_CLEARANCE,
          probeFloorY,
        );
        const probeExit = pointAlong(
          probeRoot,
          inward,
          LADDER_BOTTOM_EGRESS_DISTANCE,
          probeFloorY,
        );
        const probeWalkAwayEnd = pointAlong(
          probeExit,
          inward,
          LADDER_MINIMUM_EGRESS_LENGTH,
          probeFloorY,
        );
        mainSurface = primaryFloorCandidates
          .filter((candidate) => planarPointInsideBounds(probeExit, candidate.bounds))
          .sort((left, right) => (
            Number(planarPointInsideBounds(probeWalkAwayEnd, right.bounds))
            - Number(planarPointInsideBounds(probeWalkAwayEnd, left.bounds))
            || planarDistanceSquaredToBounds(probeWalkAwayEnd, left.bounds)
              - planarDistanceSquaredToBounds(probeWalkAwayEnd, right.bounds)
            || left.id.localeCompare(right.id)
          ))[0] ?? null;
      } else if (landingSurface) {
        // A shaft can split the chamber floor into several real surfaces. Pick
        // the fragment that can physically carry this straight stair to its
        // landing; blindly retaining surface.<region>.main made later stairs
        // either cross the shaft or search only the wrong side of it.
        mainSurface = primaryFloorCandidates.find((candidate) => {
          try {
            chooseClearStairEndpoints({
              stair: { id: approachId, regionId: spec.id },
              geometry: {
                path: [authoredStairStart, stairLandingSeamPoint],
                maxRiser: 0.18,
                minimumTread: 0.45,
                minimumEndpointOverlap: STAIR_ENDPOINT_OVERLAP,
              },
              startSurface: candidate,
              endSurface: landingSurface,
              originalStart: authoredStairStart,
              originalEnd: stairLandingSeamPoint,
              fixtures: structuralFixtures,
              boundaries: structuralBoundaries,
            });
            return true;
          } catch {
            return false;
          }
        }) ?? primaryFloorCandidates[0];
      }
      if (ladderApproach && !mainSurface) {
        throw new Error(`Raised portal ${portal.id} ladder bottom exit has no supporting primary-floor fragment in ${spec.id}.`);
      }
      mainSurface ??= primaryFloorCandidates[0];
      const mainId = mainSurface?.id;
      if (!mainSurface) throw new Error(`Raised portal ${portal.id} has no physical room-floor surface in ${spec.id}.`);
      const mainSurfaceTopY = mainSurface.bounds.max.y;
      const ladderCenter = ladderApproach
        ? vector(
            endpoint.center.x + inward.x * (half * 2 + LADDER_BODY_CLEARANCE),
            mainSurfaceTopY,
            endpoint.center.z + inward.z * (half * 2 + LADDER_BODY_CLEARANCE),
          )
        : null;
      const ladderTop = ladderCenter
        ? vector(ladderCenter.x, endpoint.elevation + 0.3, ladderCenter.z)
        : null;
      const ladderRootBottom = ladderApproach
        ? pointAlong(ladderCenter, inward, LADDER_PLAYER_PLANE_CLEARANCE, mainSurfaceTopY)
        : null;
      const ladderRootTop = ladderApproach
        ? pointAlong(ladderTop, inward, LADDER_PLAYER_PLANE_CLEARANCE, endpoint.elevation + 0.3)
        : null;
      const ladderBottomExit = ladderApproach
        ? pointAlong(ladderRootBottom, inward, LADDER_BOTTOM_EGRESS_DISTANCE, mainSurfaceTopY)
        : null;
      const ladderTopExit = ladderApproach
        ? vector(
            endpoint.center.x + inward.x * (half * 2 - LADDER_TOP_EXIT_INSET),
            endpoint.elevation + 0.3,
            endpoint.center.z + inward.z * (half * 2 - LADDER_TOP_EXIT_INSET),
          )
        : null;
      walkableSurfaces.push({
        id: approachId,
        regionId: spec.id,
        cellId: cellId(spec.id),
        bounds: ladderApproach
          ? {
              min: vector(ladderCenter.x - 1, mainSurfaceTopY, ladderCenter.z - 1),
              max: vector(ladderCenter.x + 1, endpoint.elevation + 0.3, ladderCenter.z + 1),
            }
          : {
              min: vector(Math.min(spec.center.x, endpoint.center.x) - 1.8, spec.floorY, Math.min(spec.center.z, endpoint.center.z) - 1.8),
              max: vector(Math.max(spec.center.x, endpoint.center.x) + 1.8, endpoint.elevation + 0.3, Math.max(spec.center.z, endpoint.center.z) + 1.8),
            },
        purpose: `physical internal approach from ${mainId} to raised ${portal.id} landing`,
        supportBoundaryIds: [boundaryId(spec.id, 'floor')],
        supportProfile: ladderApproach ? 'landing-edge-ladder-v2' : 'continuous-stair-stringers-v2',
        visualProfile: ladderApproach ? 'industrial-ladder-v2' : `${materialByDistrict[spec.districtId]}:walkable-stairs`,
        collision: 'static',
        hazardTag: null,
        geometry: ladderApproach
          ? createLadderGeometryV2({
              planePath: [ladderCenter, ladderTop],
              climbFacing: vector(-inward.x, 0, -inward.z),
              height: ladderTop.y - ladderCenter.y,
              width: 1.6,
              mountClearance: 1.4,
              bottomExit: ladderBottomExit,
              topExit: ladderTopExit,
              bottomExitFacing: { ...inward },
              topExitFacing: vector(-inward.x, 0, -inward.z),
              topOpening: {
                kind: 'open-landing-edge',
                bounds: ladderOpeningBounds({
                  rootPoint: ladderRootTop,
                  egressDirection: vector(-inward.x, 0, -inward.z),
                  width: 1.6 + PLAYER_LADDER_APERTURE_MARGIN * 2,
                  depth: LADDER_BODY_CLEARANCE + LADDER_PLAYER_PLANE_CLEARANCE - 0.08,
                  floorY: endpoint.elevation,
                }),
                playableBelowSurfaceId: mainId,
                minimumClearWidth: 1.6,
                minimumClearDepth: 0.78,
              },
              landings: {
                bottom: {
                  surfaceId: mainId,
                  exit: ladderBottomExit,
                  egressDirection: { ...inward },
                  minimumClearLength: LADDER_MINIMUM_EGRESS_LENGTH,
                  minimumClearWidth: LADDER_MINIMUM_EGRESS_WIDTH,
                  minimumHeadroom: LADDER_MINIMUM_EGRESS_HEADROOM,
                },
                top: {
                  surfaceId: surfaceId(spec.id, `landing-${portal.id.replace('portal.', '')}`),
                  exit: ladderTopExit,
                  egressDirection: vector(-inward.x, 0, -inward.z),
                  minimumClearLength: LADDER_MINIMUM_EGRESS_LENGTH,
                  minimumClearWidth: LADDER_MINIMUM_EGRESS_WIDTH,
                  minimumHeadroom: LADDER_MINIMUM_EGRESS_HEADROOM,
                },
              },
            })
          : {
              type: 'stairs',
              path: [authoredStairStart, stairLandingSeamPoint],
              rise,
              maxRiser: 0.18,
              minimumTread: 0.45,
              width: authoredStairWidth,
              ledgeClimbDisabled: true,
              endpointSurfaceIds: {
                start: mainId,
                end: landingSurfaceId,
              },
              minimumEndpointOverlap: STAIR_ENDPOINT_OVERLAP,
              maximumEndpointHeightDelta: STAIR_ENDPOINT_HEIGHT_TOLERANCE,
            },
      });
      traversalLinks.push({
        id: `traversal.${spec.id}.${portal.id.replace('portal.', '')}`,
        regionId: spec.id,
        fromSurfaceId: mainId,
        toSurfaceId: landingSurfaceId,
        viaSurfaceId: approachId,
        ...(ladderApproach ? {
          // The accepted plan owns the complete public traversal, including
          // safe approach and walk-away points on both landings. Exposing only
          // the vertical roots makes a descending navigator walk across the
          // upper aperture before it can mount the ladder.
          waypoints: [ladderBottomExit, ladderRootBottom, ladderRootTop, ladderTopExit],
        } : {}),
        mode: portal.approachType === 'ladder' ? 'ladder' : 'walkable-stairs',
        bidirectional: true,
        minimumWidth: portal.approachType === 'ladder' ? 1.6 : authoredStairWidth,
        maximumRiser: portal.approachType === 'ladder' ? null : 0.18,
        minimumTread: portal.approachType === 'ladder' ? null : 0.45,
      });
    }
  }

  addConnectorSpatialContracts({ portals, spatialCells, structuralBoundaries, walkableSurfaces, traversalLinks });
  return { spatialCells, structuralBoundaries, walkableSurfaces, traversalLinks, structuralFixtures };
}

function addCompoundLandmarkSubcells({ spec, materialProfileId, spatialCells, structuralBoundaries, walkableSurfaces, traversalLinks, structuralFixtures }) {
  const compoundId = `compound.${spec.id}`;
  const definitions = [
    { suffix: 'process-alcove', offsetX: -spec.size.x * 0.23, offsetZ: -spec.size.z * 0.22, floorY: spec.floorY, sizeX: 8, sizeY: Math.min(5.5, spec.size.y - 1), sizeZ: 8, mode: 'walk' },
    {
      suffix: 'inspection-vault',
      offsetX: spec.size.x * 0.22,
      offsetZ: spec.size.z * 0.22,
      floorY: spec.floorY + 4,
      sizeX: 9,
      sizeY: Math.min(5, spec.size.y - 5),
      sizeZ: 8,
      mode: 'walkable-stairs',
      // Gamma's pedestal is viewed with the production third-person camera,
      // not a probe placed inside its small vault. The wider service opening
      // keeps that camera physically inside authored clear space while the
      // remaining 1.3m wall piers still enclose and frame the branch.
      openingWidth: spec.id === 'hazard-core' ? 6.4 : 3.2,
    },
  ];
  for (const definition of definitions) {
    const subCellId = `cell.${spec.id}.${definition.suffix}`;
    const centerX = spec.center.x + definition.offsetX;
    const centerZ = spec.center.z + definition.offsetZ;
    const bounds = {
      min: vector(centerX - definition.sizeX / 2, definition.floorY, centerZ - definition.sizeZ / 2),
      max: vector(centerX + definition.sizeX / 2, definition.floorY + definition.sizeY, centerZ + definition.sizeZ / 2),
    };
    spatialCells.push({
      id: subCellId,
      regionId: spec.id,
      subRegionId: `${spec.id}.${definition.suffix}`,
      bounds,
      playable: true,
      interior: true,
      cameraContained: true,
      occupiedVolume: false,
      compoundId,
      compoundSubRegion: true,
    });
    for (const side of ['north', 'south', 'east', 'west', 'floor', 'ceiling']) {
      const subBoundaryId = `boundary.${spec.id}.${definition.suffix}.${side}`;
      const openingSide = definition.offsetZ >= 0 ? 'north' : 'south';
      const openingCenter = vector(
        centerX,
        definition.floorY + 2,
        openingSide === 'south' ? bounds.max.z : bounds.min.z,
      );
      const hasOpening = side === openingSide;
      structuralBoundaries.push({
        id: subBoundaryId,
        cellId: subCellId,
        regionId: spec.id,
        side,
        kind: hasOpening ? 'portal-frame' : 'solid',
        bounds: boundaryBounds(bounds, side),
        openings: hasOpening ? [{
          id: `opening.internal.${spec.id}.${definition.suffix}`,
          portalId: `internal.${spec.id}.${definition.suffix}`,
          internalPortalId: `internal.${spec.id}.${definition.suffix}`,
          pairedWithinCompound: true,
          sourceCellId: subCellId,
          targetCellId: cellId(spec.id),
          targetRegionId: spec.id,
          center: openingCenter,
          dimensions: { width: definition.openingWidth ?? 3.2, height: 4, depth: 1 },
        }] : [],
        materialProfileId,
        visualProfile: `${materialProfileId}:compound-${definition.suffix}:${side}`,
        collider: true,
        collision: 'static',
        opaque: true,
      });
    }
    const subSurfaceId = surfaceId(spec.id, definition.suffix);
    const supportFixtureId = `fixture.${spec.id}.${definition.suffix}-supports`;
    structuralFixtures.push({
      id: supportFixtureId,
      type: 'structural-support',
      regionId: spec.id,
      cellId: subCellId,
      bounds: { min: vector(centerX - 1, spec.floorY, centerZ - 1), max: vector(centerX + 1, Math.max(definition.floorY, spec.floorY + 0.4), centerZ + 1) },
      materialProfileId,
      visualProfile: definition.mode === 'walkable-stairs' ? 'vault-braced-columns-v2' : 'alcove-foundation-v2',
      collision: 'blocking',
      supportBoundaryIds: [`boundary.${spec.id}.${definition.suffix}.floor`],
      gameplayPurpose: `visibly supports ${definition.suffix} in ${spec.displayName}`,
    });
    walkableSurfaces.push({
      id: subSurfaceId,
      regionId: spec.id,
      cellId: subCellId,
      subRegionId: `${spec.id}.${definition.suffix}`,
      bounds: { min: vector(bounds.min.x + 0.4, bounds.min.y, bounds.min.z + 0.4), max: vector(bounds.max.x - 0.4, bounds.min.y + 0.3, bounds.max.z - 0.4) },
      purpose: `${definition.suffix} exploration branch for ${spec.functionalPurpose}`,
      supportBoundaryIds: [`boundary.${spec.id}.${definition.suffix}.floor`],
      supportFixtureIds: definition.floorY > spec.floorY + 0.5 ? [supportFixtureId] : [],
      supportProfile: definition.mode === 'walkable-stairs' ? 'vault-braced-columns-v2' : 'alcove-foundation-v2',
      visualProfile: `${materialProfileId}:${definition.suffix}`,
      collision: 'static',
      hazardTag: null,
    });
    traversalLinks.push({
      id: `traversal.${spec.id}.${definition.suffix}`,
      regionId: spec.id,
      // The raised vault is reached from the physically overlapping catwalk.
      // Reusing the main-floor stair as a second abstract edge allowed the
      // vault and catwalk to be disconnected in the assembled chamber.
      fromSurfaceId: definition.mode === 'walkable-stairs'
        ? surfaceId(spec.id, 'landmark-catwalk')
        : surfaceId(spec.id),
      toSurfaceId: subSurfaceId,
      mode: definition.mode === 'walkable-stairs' ? 'walk' : definition.mode,
      bidirectional: true,
      minimumWidth: 1.2,
      internalPortalId: `internal.${spec.id}.${definition.suffix}`,
    });
  }
}

function pushPrimaryFloorSurfaces({ spec, bounds, fallPortal, floorPortals, materialProfileId, walkableSurfaces, traversalLinks, structuralFixtures }) {
  const floorMin = vector(bounds.min.x + 0.5, bounds.min.y, bounds.min.z + 0.5);
  const floorMax = vector(bounds.max.x - 0.5, bounds.min.y + 0.35, bounds.max.z - 0.5);
  const common = {
    regionId: spec.id,
    cellId: cellId(spec.id),
    purpose: `${spec.functionalPurpose}; primary walkable floor`,
    supportBoundaryIds: [boundaryId(spec.id, 'floor')],
    supportProfile: 'load-bearing-foundation-and-columns-v2',
    visualProfile: `${materialProfileId}:walkable-floor`,
    collision: 'static',
    hazardTag: null,
    primaryFloor: true,
  };
  const apertureForEndpoint = (endpoint) => ({
    minX: endpoint.center.x - endpoint.dimensions.width / 2,
    maxX: endpoint.center.x + endpoint.dimensions.width / 2,
    minZ: endpoint.center.z - endpoint.dimensions.depth / 2,
    maxZ: endpoint.center.z + endpoint.dimensions.depth / 2,
  });
  const fallAperture = fallPortal ? apertureForEndpoint(fallPortal.from) : null;
  let pieces = fallAperture ? [
    { suffix: 'main', minX: floorMin.x, maxX: fallAperture.minX, minZ: floorMin.z, maxZ: floorMax.z },
    { suffix: 'floor-east', minX: fallAperture.maxX, maxX: floorMax.x, minZ: floorMin.z, maxZ: floorMax.z },
    { suffix: 'floor-north', minX: fallAperture.minX, maxX: fallAperture.maxX, minZ: floorMin.z, maxZ: fallAperture.minZ },
    { suffix: 'floor-south', minX: fallAperture.minX, maxX: fallAperture.maxX, minZ: fallAperture.maxZ, maxZ: floorMax.z },
  ] : [{ suffix: 'main', minX: floorMin.x, maxX: floorMax.x, minZ: floorMin.z, maxZ: floorMax.z }];
  pieces = pieces.filter(({ minX, maxX, minZ, maxZ }) => maxX - minX >= 0.5 && maxZ - minZ >= 0.5);

  // A boundary opening alone does not carve the separately assembled
  // walkable deck.  Subtract every lift aperture from the plan-owned primary
  // floor as rectangles, so its render mesh, platform collider, floor tiles,
  // and navigation metadata all agree that the shaft is open.  Retain the
  // original surface ID on the fragment containing the room centre (or the
  // largest fragment) so stable anchors keep their intended floor identity.
  for (const { portal, endpoint } of floorPortals.filter(({ portal }) => portal.approachType === 'lift')) {
    const aperture = apertureForEndpoint(endpoint);
    const portalSuffix = portal.id.replace(/^portal\./, '').replace(/[^a-zA-Z0-9.-]+/g, '-');
    const carved = [];
    for (const piece of pieces) {
      const overlap = {
        minX: Math.max(piece.minX, aperture.minX),
        maxX: Math.min(piece.maxX, aperture.maxX),
        minZ: Math.max(piece.minZ, aperture.minZ),
        maxZ: Math.min(piece.maxZ, aperture.maxZ),
      };
      if (overlap.maxX - overlap.minX <= 0.001 || overlap.maxZ - overlap.minZ <= 0.001) {
        carved.push(piece);
        continue;
      }
      const fragments = [
        { label: 'west', minX: piece.minX, maxX: overlap.minX, minZ: piece.minZ, maxZ: piece.maxZ },
        { label: 'east', minX: overlap.maxX, maxX: piece.maxX, minZ: piece.minZ, maxZ: piece.maxZ },
        { label: 'north', minX: overlap.minX, maxX: overlap.maxX, minZ: piece.minZ, maxZ: overlap.minZ },
        { label: 'south', minX: overlap.minX, maxX: overlap.maxX, minZ: overlap.maxZ, maxZ: piece.maxZ },
      ].filter(({ minX, maxX, minZ, maxZ }) => maxX - minX >= 0.5 && maxZ - minZ >= 0.5);
      const containsRoomCenter = (fragment) => spec.center.x >= fragment.minX - 0.001
        && spec.center.x <= fragment.maxX + 0.001
        && spec.center.z >= fragment.minZ - 0.001
        && spec.center.z <= fragment.maxZ + 0.001;
      const retained = fragments.find(containsRoomCenter)
        ?? [...fragments].sort((left, right) => (
          (right.maxX - right.minX) * (right.maxZ - right.minZ)
          - (left.maxX - left.minX) * (left.maxZ - left.minZ)
        ) || left.label.localeCompare(right.label))[0];
      for (const fragment of fragments) {
        carved.push({
          ...fragment,
          suffix: fragment === retained
            ? piece.suffix
            : `${piece.suffix}-shaft-${portalSuffix}-${fragment.label}`,
        });
      }
    }
    pieces = carved;
  }

  for (const { suffix, minX, maxX, minZ, maxZ } of pieces) {
    walkableSurfaces.push({
      id: surfaceId(spec.id, suffix),
      bounds: { min: vector(minX, bounds.min.y, minZ), max: vector(maxX, bounds.min.y + 0.35, maxZ) },
      ...common,
    });
  }
  // Connect only fragments that share a real capsule-width edge.  This keeps
  // graph reachability synchronized with the physical route around each open
  // shaft instead of silently adding a direct edge across unsupported air.
  for (let leftIndex = 0; leftIndex < pieces.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < pieces.length; rightIndex += 1) {
      const left = pieces[leftIndex];
      const right = pieces[rightIndex];
      const sharedZ = Math.min(left.maxZ, right.maxZ) - Math.max(left.minZ, right.minZ);
      const sharedX = Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX);
      const touchesX = (Math.abs(left.maxX - right.minX) <= 0.001 || Math.abs(right.maxX - left.minX) <= 0.001)
        && sharedZ >= 1.2;
      const touchesZ = (Math.abs(left.maxZ - right.minZ) <= 0.001 || Math.abs(right.maxZ - left.minZ) <= 0.001)
        && sharedX >= 1.2;
      if (!touchesX && !touchesZ) continue;
      traversalLinks.push({
        id: `traversal.${spec.id}.floor-${left.suffix}-to-${right.suffix}`,
        regionId: spec.id,
        fromSurfaceId: surfaceId(spec.id, left.suffix),
        toSurfaceId: surfaceId(spec.id, right.suffix),
        mode: 'walk',
        bidirectional: true,
        minimumWidth: 1.2,
      });
    }
  }
  if (!fallPortal) return;

  const crumbleSupportId = `fixture.${spec.id}.crumble-brackets`;
  structuralFixtures.push({
    id: crumbleSupportId,
    type: 'structural-support',
    subtype: 'breakaway-support-brackets',
    regionId: spec.id,
    cellId: cellId(spec.id),
    bounds: { min: vector(fallAperture.minX, bounds.min.y - 0.45, fallAperture.minZ), max: vector(fallAperture.maxX, bounds.min.y - 0.05, fallAperture.maxZ) },
    materialProfileId,
    visualProfile: 'breakaway-industrial-brackets-v2',
    collision: 'blocking',
    supportBoundaryIds: [boundaryId(spec.id, 'floor')],
    gameplayPurpose: 'visibly supports the intact crumble panels and retracts with their controller',
    mechanismId: spec.id === 'assembly' ? 'mechanism.freight-crumble' : 'mechanism.lab-crumble',
  });
  walkableSurfaces.push({
    id: surfaceId(spec.id, 'crumble'),
    regionId: spec.id,
    cellId: cellId(spec.id),
    bounds: { min: vector(fallAperture.minX, bounds.min.y, fallAperture.minZ), max: vector(fallAperture.maxX, bounds.min.y + 0.3, fallAperture.maxZ) },
    purpose: 'visibly cracking automatic collapse into an authored playable sub-zone',
    supportBoundaryIds: [boundaryId(spec.id, 'floor')],
    supportFixtureIds: [crumbleSupportId],
    supportProfile: 'breakaway-industrial-brackets-v2',
    visualProfile: 'signaled-crumble-panels-v2',
    collision: 'dynamic',
    hazardTag: null,
    mechanismId: spec.id === 'assembly' ? 'mechanism.freight-crumble' : 'mechanism.lab-crumble',
    geometry: { type: 'crumble', aperturePortalId: fallPortal.id, noManualRearm: true },
  });
}

function fixture(spec, suffix, type, offset, size, materialProfileId, collision, supportBoundaryIds) {
  const center = vector(spec.center.x + offset.x, spec.floorY + offset.y + size.y / 2, spec.center.z + offset.z);
  return {
    id: `fixture.${spec.id}.${suffix}`,
    type,
    regionId: spec.id,
    cellId: cellId(spec.id),
    bounds: { min: vector(center.x - size.x / 2, center.y - size.y / 2, center.z - size.z / 2), max: vector(center.x + size.x / 2, center.y + size.y / 2, center.z + size.z / 2) },
    materialProfileId,
    visualProfile: `${materialProfileId}:${type}`,
    collision,
    supportBoundaryIds,
    gameplayPurpose: spec.functionalPurpose,
  };
}

function addAuthoredFunctionalFixtures({ spec, materialProfileId, structuralFixtures }) {
  const profile = GOLDEN_REGION_AUTHORED_DETAILS_V2[spec.id];
  if (!profile) return;
  for (const blueprint of profile.fixtures) {
    const record = fixture(
      spec,
      `authored-${blueprint.id}`,
      blueprint.type,
      {
        x: spec.size.x * blueprint.offset.x,
        y: blueprint.offset.y,
        z: spec.size.z * blueprint.offset.z,
      },
      blueprint.size,
      materialProfileId,
      'blocking',
      [boundaryId(spec.id, 'floor')],
    );
    record.gameplayPurpose = blueprint.purpose;
    record.authoredSourceMaterial = profile.sourceMaterial;
    record.authoredDetailId = blueprint.id;
    record.assetFamilyId = profile.assetFamilyId;
    record.presentationAsset = {
      source: 'dungeon-v1',
      familyId: profile.assetFamilyId,
      role: blueprint.type,
    };
    structuralFixtures.push(record);
  }
}

function outwardPoint(endpoint, distance) {
  const point = vector(endpoint.center.x, endpoint.elevation, endpoint.center.z);
  if (endpoint.side === 'north') point.z -= distance;
  else if (endpoint.side === 'south') point.z += distance;
  else if (endpoint.side === 'west') point.x -= distance;
  else if (endpoint.side === 'east') point.x += distance;
  else if (endpoint.side === 'floor') point.y -= distance;
  else point.y += distance;
  return point;
}

function dedupeRoutePoints(points) {
  return points.filter((point, index) => index === 0 || ['x', 'y', 'z'].some((axis) => Math.abs(point[axis] - points[index - 1][axis]) > 0.01));
}

function simplifyCollinearRoutePoints(points) {
  const result = [];
  for (const point of points) {
    result.push(point);
    while (result.length >= 3) {
      const first = result.at(-3);
      const middle = result.at(-2);
      const last = result.at(-1);
      const firstAxis = connectorSegmentAxis(first, middle);
      const secondAxis = connectorSegmentAxis(middle, last);
      const firstDelta = middle[firstAxis] - first[firstAxis];
      const secondDelta = last[secondAxis] - middle[secondAxis];
      if (firstAxis !== secondAxis || Math.sign(firstDelta) !== Math.sign(secondDelta)) break;
      result.splice(result.length - 2, 1);
    }
  }
  return result;
}

function connectorRoutePoints(portal) {
  const start = vector(portal.from.center.x, portal.from.elevation, portal.from.center.z);
  const end = vector(portal.to.center.x, portal.to.elevation, portal.to.center.z);
  if (portal.approachType === 'intentional-drop') return [start, end];
  const explicitRoutePoints = portal.authoredRoute?.routePoints;
  if (Array.isArray(explicitRoutePoints) && explicitRoutePoints.length >= 2) {
    const route = explicitRoutePoints.map((point) => vector(point.x, point.y, point.z));
    const routeStart = route[0];
    const routeEnd = route.at(-1);
    const matchesEndpoint = (left, right) => Math.hypot(
      left.x - right.x,
      left.y - right.y,
      left.z - right.z,
    ) <= 0.001;
    if (!matchesEndpoint(routeStart, start) || !matchesEndpoint(routeEnd, end)) {
      throw new Error(`${portal.id} explicit connector route does not meet its physical endpoints.`);
    }
    return dedupeRoutePoints(route);
  }
  const bothVertical = ['floor', 'ceiling'].includes(portal.from.side)
    && ['floor', 'ceiling'].includes(portal.to.side)
    && Math.abs(start.x - end.x) < 0.01
    && Math.abs(start.z - end.z) < 0.01;
  if (bothVertical) return [start, end];
  // Keep stair galleries long enough to satisfy the authored 0.18m riser /
  // 0.45m tread envelope while every connector cell still meets its portal
  // plane. Perpendicular joints below use projected overlap openings rather
  // than exposing the full end cap.
  const authoredThroatDepth = Number(portal.authoredRoute?.throatDepth);
  const portalThroat = Number.isFinite(authoredThroatDepth) && authoredThroatDepth > 0
    ? authoredThroatDepth
    : portal.approachType === 'stairs'
      ? 1
      : Math.max(0.6, portal.traversal.minimumWidth * 0.5);
  const startOut = outwardPoint(portal.from, portalThroat);
  const endOut = outwardPoint(portal.to, portalThroat);
  const detour = portal.authoredRoute?.detour;
  if (detour?.axis === 'z' && Number.isFinite(detour.value)) {
    if (portal.approachType === 'stairs') {
      return dedupeRoutePoints([
        start,
        startOut,
        vector(startOut.x, startOut.y, detour.value),
        vector(endOut.x, endOut.y, detour.value),
        endOut,
        end,
      ]);
    }
    return dedupeRoutePoints([
      start,
      startOut,
      vector(startOut.x, startOut.y, detour.value),
      vector(endOut.x, startOut.y, detour.value),
      vector(endOut.x, startOut.y, endOut.z),
      vector(endOut.x, endOut.y, endOut.z),
      endOut,
      end,
    ]);
  }
  if (detour?.axis === 'x' && Number.isFinite(detour.value)) {
    return dedupeRoutePoints([
      start,
      startOut,
      vector(detour.value, startOut.y, startOut.z),
      vector(detour.value, startOut.y, endOut.z),
      vector(endOut.x, startOut.y, endOut.z),
      vector(endOut.x, endOut.y, endOut.z),
      endOut,
      end,
    ]);
  }
  const horizontalDeltaX = Math.abs(startOut.x - endOut.x);
  const horizontalDeltaZ = Math.abs(startOut.z - endOut.z);
  const elbow = horizontalDeltaX >= horizontalDeltaZ
    ? vector(endOut.x, startOut.y, startOut.z)
    : vector(startOut.x, startOut.y, endOut.z);
  const elevationElbow = vector(elbow.x, endOut.y, elbow.z);
  if (portal.authoredRoute?.mode === 'vertical-first') {
    return dedupeRoutePoints([start, startOut, vector(startOut.x, endOut.y, startOut.z), elevationElbow, endOut, end]);
  }
  if (portal.authoredRoute?.mode === 'vertical-last') {
    return dedupeRoutePoints([start, startOut, elbow, vector(endOut.x, startOut.y, endOut.z), endOut, end]);
  }
  const totalHorizontal = horizontalDeltaX + horizontalDeltaZ;
  const firstLeg = Math.abs(elbow.x - startOut.x) + Math.abs(elbow.z - startOut.z);
  const secondLeg = Math.max(0, totalHorizontal - firstLeg);
  const rise = Math.abs(endOut.y - startOut.y);
  const minimumStairRun = Math.max(0, Math.ceil(rise / 0.18 - 1e-6) * 0.45);
  // Never split one ordinary staircase around a ninety-degree elbow.  That
  // produced two intersecting smooth ramps at different heights and a lip at
  // their shared corner.  Put the complete rise on one sufficiently long leg
  // and keep the elbow/other leg level as a genuine landing.
  const elbowY = firstLeg + 1e-6 >= minimumStairRun
    ? endOut.y
    : secondLeg + 1e-6 >= minimumStairRun
      ? startOut.y
      : startOut.y + ((endOut.y - startOut.y) * firstLeg / Math.max(totalHorizontal, 1e-6));
  return dedupeRoutePoints([start, startOut, vector(elbow.x, elbowY, elbow.z), endOut, end]);
}

function connectorSegmentAxis(start, end) {
  const delta = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z };
  if (Math.abs(delta.x) < 0.01 && Math.abs(delta.y) < 0.01 && Math.abs(delta.z) < 0.01) return 'y';
  return ['x', 'y', 'z'].sort((left, right) => Math.abs(delta[right]) - Math.abs(delta[left]))[0];
}

function segmentOpeningSide(start, end, atStart) {
  const delta = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z };
  const axis = connectorSegmentAxis(start, end);
  const sign = Math.sign(delta[axis]) || 1;
  if (axis === 'x') return atStart ? (sign > 0 ? 'west' : 'east') : (sign > 0 ? 'east' : 'west');
  if (axis === 'z') return atStart ? (sign > 0 ? 'north' : 'south') : (sign > 0 ? 'south' : 'north');
  return atStart ? (sign > 0 ? 'floor' : 'ceiling') : (sign > 0 ? 'ceiling' : 'floor');
}

function connectorSegmentBounds(start, end, width = 4.8, {
  extendStart = false,
  extendEnd = false,
  headroom = 4.2,
} = {}) {
  const half = width / 2;
  const axis = connectorSegmentAxis(start, end);
  if (axis === 'x') {
    const direction = Math.sign(end.x - start.x) || 1;
    let minX = Math.min(start.x, end.x);
    let maxX = Math.max(start.x, end.x);
    if (extendStart) {
      if (direction > 0) minX -= half;
      else maxX += half;
    }
    if (extendEnd) {
      if (direction > 0) maxX += half;
      else minX -= half;
    }
    return {
      min: vector(minX, Math.min(start.y, end.y), Math.min(start.z, end.z) - half),
      max: vector(maxX, Math.max(start.y, end.y) + headroom, Math.max(start.z, end.z) + half),
    };
  }
  if (axis === 'z') {
    const direction = Math.sign(end.z - start.z) || 1;
    let minZ = Math.min(start.z, end.z);
    let maxZ = Math.max(start.z, end.z);
    if (extendStart) {
      if (direction > 0) minZ -= half;
      else maxZ += half;
    }
    if (extendEnd) {
      if (direction > 0) maxZ += half;
      else minZ -= half;
    }
    return {
      min: vector(Math.min(start.x, end.x) - half, Math.min(start.y, end.y), minZ),
      max: vector(Math.max(start.x, end.x) + half, Math.max(start.y, end.y) + headroom, maxZ),
    };
  }
  if (Math.abs(end.y - start.y) < 0.01) {
    return {
      min: vector(start.x - half, start.y - 0.4, start.z - half),
      max: vector(start.x + half, start.y + 0.4, start.z + half),
    };
  }
  return {
    min: vector(Math.min(start.x, end.x) - half, Math.min(start.y, end.y), Math.min(start.z, end.z) - half),
    // A vertical route point is a walkable elevation, not the top of the
    // player's volume. Carry the same 4.2m headroom used by horizontal
    // connector cells above the upper landing; otherwise the shaft terminates
    // at the player's feet and its adjoining wall remains across the ladder.
    max: vector(Math.max(start.x, end.x) + half, Math.max(start.y, end.y) + headroom, Math.max(start.z, end.z) + half),
  };
}

function connectorOpeningCenter(point, side, dimensions) {
  return vector(
    point.x,
    ['floor', 'ceiling'].includes(side) ? point.y : point.y + dimensions.height * 0.5,
    point.z,
  );
}

function connectorSurfaceBounds(bounds, start, end, inset = 0.4) {
  const axis = connectorSegmentAxis(start, end);
  // A connector deck may be inset from its side walls, but it must meet both
  // authored end openings.  Insetting all four horizontal edges left a real
  // 0.8m floor gap at every elbow even though the paired wall apertures were
  // correctly carved.  Keep only the lateral wall clearance and carry the
  // walking surface all the way to the segment endpoints.
  const min = vector(
    axis === 'x' ? bounds.min.x : bounds.min.x + inset,
    Math.min(start.y, end.y),
    axis === 'z' ? bounds.min.z : bounds.min.z + inset,
  );
  const max = vector(
    axis === 'x' ? bounds.max.x : bounds.max.x - inset,
    Math.max(start.y, end.y) + 0.3,
    axis === 'z' ? bounds.max.z : bounds.max.z - inset,
  );
  // Stair endpoints are subsequently bound 1.2m *inside* their adjoining
  // decks by bindStairsToExactDeckSeams. Extending every connector deck by
  // another 1.2m at both ends duplicated hundreds of navigation tiles at
  // elbows and did not improve the exact stair/collider seam. Keep ordinary
  // deck panels inside their enclosed connector cells; only the accepted
  // oriented ramp crosses to its explicitly referenced endpoint decks. A
  // very short portal throat is the sole exception: it must still provide a
  // 2.4m footprint so a stair endpoint can sit 1.2m inside it on both sides.
  if (axis === 'x' && max.x - min.x < STAIR_ENDPOINT_OVERLAP * 2) {
    const center = (start.x + end.x) * 0.5;
    min.x = center - STAIR_ENDPOINT_OVERLAP;
    max.x = center + STAIR_ENDPOINT_OVERLAP;
  } else if (axis === 'z' && max.z - min.z < STAIR_ENDPOINT_OVERLAP * 2) {
    const center = (start.z + end.z) * 0.5;
    min.z = center - STAIR_ENDPOINT_OVERLAP;
    max.z = center + STAIR_ENDPOINT_OVERLAP;
  }
  return { min, max };
}

function connectorElbowOpening(bounds, adjacentBounds, side, point, dimensions, id, portalId, jointId) {
  const epsilon = 0.001;
  const outwardOverlap = {
    west: adjacentBounds.min.x < bounds.min.x - epsilon && adjacentBounds.max.x >= bounds.min.x - epsilon,
    east: adjacentBounds.max.x > bounds.max.x + epsilon && adjacentBounds.min.x <= bounds.max.x + epsilon,
    north: adjacentBounds.min.z < bounds.min.z - epsilon && adjacentBounds.max.z >= bounds.min.z - epsilon,
    south: adjacentBounds.max.z > bounds.max.z + epsilon && adjacentBounds.min.z <= bounds.max.z + epsilon,
    floor: adjacentBounds.min.y < bounds.min.y - epsilon && adjacentBounds.max.y >= bounds.min.y - epsilon,
    ceiling: adjacentBounds.max.y > bounds.max.y + epsilon && adjacentBounds.min.y <= bounds.max.y + epsilon,
  }[side];
  if (!outwardOverlap) return null;

  const planeAxes = {
    north: ['x', 'y'], south: ['x', 'y'],
    east: ['z', 'y'], west: ['z', 'y'],
    floor: ['x', 'z'], ceiling: ['x', 'z'],
  }[side];
  const overlap = {};
  for (const axis of planeAxes) {
    overlap[axis] = {
      min: Math.max(bounds.min[axis], adjacentBounds.min[axis]),
      max: Math.min(bounds.max[axis], adjacentBounds.max[axis]),
    };
    if (overlap[axis].max - overlap[axis].min <= epsilon) return null;
  }

  const center = connectorOpeningCenter(point, side, dimensions);
  // `point` is the route joint at the centre of the overlapping elbow cells,
  // not a point on this cell's structural face. Keeping its fixed coordinate
  // placed the visual aperture/frame up to half a corridor-width inside the
  // turn while the boundary splitter happened to use only the two in-plane
  // axes. Project every opening onto the exact owning cell face so render,
  // collision, camera containment, and route metadata share one aperture.
  const fixedAxis = ['east', 'west'].includes(side) ? 'x'
    : ['north', 'south'].includes(side) ? 'z' : 'y';
  center[fixedAxis] = side === 'west' || side === 'north' || side === 'floor'
    ? bounds.min[fixedAxis]
    : bounds.max[fixedAxis];
  for (const axis of planeAxes) center[axis] = (overlap[axis].min + overlap[axis].max) * 0.5;
  const openingDimensions = { ...dimensions };
  if (side === 'floor' || side === 'ceiling') {
    openingDimensions.width = overlap.x.max - overlap.x.min;
    openingDimensions.depth = overlap.z.max - overlap.z.min;
  } else {
    openingDimensions.width = overlap[planeAxes[0]].max - overlap[planeAxes[0]].min;
    openingDimensions.height = overlap.y.max - overlap.y.min;
  }
  return { id, portalId, jointId, center, dimensions: openingDimensions };
}

function connectorEndpointOverlapOpening(bounds, side, endpoint, id, portalId) {
  const oppositeSide = {
    north: 'south', south: 'north', east: 'west', west: 'east',
    floor: 'ceiling', ceiling: 'floor',
  }[endpoint.side];
  if (side !== oppositeSide) return null;
  const fixedAxis = ['east', 'west'].includes(side) ? 'x'
    : ['north', 'south'].includes(side) ? 'z' : 'y';
  const fixedValue = side === 'west' || side === 'north' || side === 'floor'
    ? bounds.min[fixedAxis] : bounds.max[fixedAxis];
  const endpointValue = fixedAxis === 'y' ? endpoint.elevation : endpoint.center[fixedAxis];
  if (Math.abs(fixedValue - endpointValue) > 0.01) return null;

  const planeAxes = {
    north: ['x', 'y'], south: ['x', 'y'],
    east: ['z', 'y'], west: ['z', 'y'],
    floor: ['x', 'z'], ceiling: ['x', 'z'],
  }[side];
  const apertureRanges = {};
  for (const axis of planeAxes) {
    const extent = axis === 'y' ? endpoint.dimensions.height
      : axis === 'z' && ['floor', 'ceiling'].includes(side) ? endpoint.dimensions.depth
        : endpoint.dimensions.width;
    const center = endpoint.center[axis];
    apertureRanges[axis] = { min: center - extent * 0.5, max: center + extent * 0.5 };
  }
  const overlap = {};
  for (const axis of planeAxes) {
    overlap[axis] = {
      min: Math.max(bounds.min[axis], apertureRanges[axis].min),
      max: Math.min(bounds.max[axis], apertureRanges[axis].max),
    };
    if (overlap[axis].max - overlap[axis].min <= 0.001) return null;
  }
  const center = vector(endpoint.center.x, endpoint.center.y, endpoint.center.z);
  center[fixedAxis] = fixedValue;
  for (const axis of planeAxes) center[axis] = (overlap[axis].min + overlap[axis].max) * 0.5;
  const dimensions = { ...endpoint.dimensions };
  if (side === 'floor' || side === 'ceiling') {
    dimensions.width = overlap.x.max - overlap.x.min;
    dimensions.depth = overlap.z.max - overlap.z.min;
  } else {
    dimensions.width = overlap[planeAxes[0]].max - overlap[planeAxes[0]].min;
    dimensions.height = overlap.y.max - overlap.y.min;
  }
  return { id, portalId, jointId: null, center, dimensions };
}

function connectorTraversalRoutePoints(routePoints, width) {
  if (routePoints.length < 3) return routePoints;
  return routePoints.map((point, index) => {
    if (index === 0 || index === routePoints.length - 1) return point;
    const previous = routePoints[index - 1];
    const next = routePoints[index + 1];
    const previousAxis = connectorSegmentAxis(previous, point);
    const nextAxis = connectorSegmentAxis(point, next);
    if (previousAxis === nextAxis || previousAxis === 'y' || nextAxis === 'y') return point;
    const previousBounds = connectorSegmentBounds(previous, point, width);
    const nextBounds = connectorSegmentBounds(point, next, width);
    return vector(
      (Math.max(previousBounds.min.x, nextBounds.min.x) + Math.min(previousBounds.max.x, nextBounds.max.x)) * 0.5,
      point.y,
      (Math.max(previousBounds.min.z, nextBounds.min.z) + Math.min(previousBounds.max.z, nextBounds.max.z)) * 0.5,
    );
  });
}

function connectorSegmentHorizontalDirectionFromJoint(routePoints, segmentIndex, jointIndex, label) {
  const start = routePoints[segmentIndex];
  const end = routePoints[segmentIndex + 1];
  const joint = routePoints[jointIndex];
  const startDistance = Math.hypot(start.x - joint.x, start.z - joint.z, start.y - joint.y);
  const other = startDistance <= 0.01 ? end : start;
  if (Math.abs(other.y - joint.y) > 0.05) {
    throw new Error(`${label} does not join a level landing segment.`);
  }
  return horizontalDirection(joint, other, label);
}

function buildConnectorLadderJunctions(routePoints, portal) {
  const byLadderSegment = new Map();
  const upperDeckTrimBySegment = new Map();
  for (let index = 0; index < routePoints.length - 1; index += 1) {
    const start = routePoints[index];
    const end = routePoints[index + 1];
    const verticalDelta = Math.abs(end.y - start.y);
    const horizontalRun = Math.hypot(end.x - start.x, end.z - start.z);
    if (verticalDelta <= 0.01 || horizontalRun >= 0.2) continue;
    if (portal.approachType !== 'ladder') continue;

    const upperPointIndex = start.y > end.y ? index : index + 1;
    const lowerPointIndex = upperPointIndex === index ? index + 1 : index;
    const upperDeckSegmentIndex = upperPointIndex === index ? index - 1 : index + 1;
    const lowerDeckSegmentIndex = lowerPointIndex === index ? index - 1 : index + 1;
    const endpointForPointIndex = (pointIndex) => {
      if (pointIndex === 0) return portal.from;
      if (pointIndex === routePoints.length - 1) return portal.to;
      return null;
    };
    const lowerEndpoint = endpointForPointIndex(lowerPointIndex);
    const lowerUsesNativeLanding = Boolean(
      lowerEndpoint
      && ['floor', 'ceiling'].includes(lowerEndpoint.side)
      && lowerEndpoint.nativeLandingSurfaceId
      && Number.isFinite(lowerEndpoint.nativeLandingDirection?.x)
      && Number.isFinite(lowerEndpoint.nativeLandingDirection?.z),
    );
    if (upperDeckSegmentIndex < 0
      || upperDeckSegmentIndex >= routePoints.length - 1
      || ((!lowerUsesNativeLanding)
        && (lowerDeckSegmentIndex < 0 || lowerDeckSegmentIndex >= routePoints.length - 1))) {
      throw new Error(`Connector ladder ${portal.id}:${index} requires authored top and bottom landing segments.`);
    }
    const upperPoint = routePoints[upperPointIndex];
    const lowerPoint = routePoints[lowerPointIndex];
    const upperDirection = connectorSegmentHorizontalDirectionFromJoint(
      routePoints,
      upperDeckSegmentIndex,
      upperPointIndex,
      `${portal.id} top ladder landing`,
    );
    const lowerDirection = lowerUsesNativeLanding
      ? vector(
          lowerEndpoint.nativeLandingDirection.x,
          0,
          lowerEndpoint.nativeLandingDirection.z,
        )
      : connectorSegmentHorizontalDirectionFromJoint(
          routePoints,
          lowerDeckSegmentIndex,
          lowerPointIndex,
          `${portal.id} bottom ladder landing`,
        );
    const planeBottom = vector(upperPoint.x, lowerPoint.y + 0.3, upperPoint.z);
    const planeTop = vector(upperPoint.x, upperPoint.y + 0.3, upperPoint.z);
    const rootBottom = pointAlong(
      planeBottom,
      upperDirection,
      LADDER_PLAYER_PLANE_CLEARANCE,
      lowerPoint.y + 0.3,
    );
    const rootTop = pointAlong(
      planeTop,
      upperDirection,
      LADDER_PLAYER_PLANE_CLEARANCE,
      upperPoint.y + 0.3,
    );
    const topExit = pointAlong(
      upperPoint,
      upperDirection,
      LADDER_APERTURE_DEPTH + LADDER_EXIT_EDGE_INSET,
      upperPoint.y + 0.3,
    );
    const bottomExit = pointAlong(
      rootBottom,
      lowerDirection,
      LADDER_BOTTOM_EGRESS_DISTANCE,
      lowerPoint.y + 0.3,
    );
    const connectorPrefix = portal.id.replace('portal.', '');
    const upperSurfaceId = `surface.connector.${connectorPrefix}.${upperDeckSegmentIndex}`;
    const lowerSurfaceId = lowerUsesNativeLanding
      ? lowerEndpoint.nativeLandingSurfaceId
      : `surface.connector.${connectorPrefix}.${lowerDeckSegmentIndex}`;
    const openingBounds = ladderOpeningBounds({
      rootPoint: rootTop,
      egressDirection: upperDirection,
      width: 1.6 + PLAYER_LADDER_APERTURE_MARGIN * 2,
      depth: LADDER_APERTURE_DEPTH - LADDER_PLAYER_PLANE_CLEARANCE - 0.05,
      floorY: upperPoint.y,
    });
    const contract = {
      ladderSegmentIndex: index,
      upperDeckSegmentIndex,
      lowerDeckSegmentIndex,
      upperDirection,
      lowerDirection,
      planePath: [planeBottom, planeTop],
      rootBottom,
      rootTop,
      bottomExit,
      topExit,
      topOpening: {
        kind: 'connector-shaft-aperture',
        bounds: openingBounds,
        playableBelowSurfaceId: lowerSurfaceId,
        minimumClearWidth: 1.6,
        minimumClearDepth: LADDER_APERTURE_DEPTH - 0.05,
      },
      landings: {
        bottom: {
          surfaceId: lowerSurfaceId,
          exit: bottomExit,
          egressDirection: lowerDirection,
          minimumClearLength: LADDER_MINIMUM_EGRESS_LENGTH,
          minimumClearWidth: LADDER_MINIMUM_EGRESS_WIDTH,
          minimumHeadroom: LADDER_MINIMUM_EGRESS_HEADROOM,
        },
        top: {
          surfaceId: upperSurfaceId,
          exit: topExit,
          egressDirection: upperDirection,
          minimumClearLength: LADDER_MINIMUM_EGRESS_LENGTH,
          minimumClearWidth: LADDER_MINIMUM_EGRESS_WIDTH,
          minimumHeadroom: LADDER_MINIMUM_EGRESS_HEADROOM,
        },
      },
    };
    byLadderSegment.set(index, contract);
    upperDeckTrimBySegment.set(upperDeckSegmentIndex, {
      ladderSegmentIndex: index,
      joint: upperPoint,
      direction: upperDirection,
      depth: LADDER_APERTURE_DEPTH,
      openingBounds,
    });
  }
  return { byLadderSegment, upperDeckTrimBySegment };
}

function connectorPhysicalTraversalRoutePoints(routePoints, ladderJunctions) {
  const result = [];
  const pushDistinct = (point) => {
    const previous = result.at(-1);
    if (previous && Math.hypot(
      point.x - previous.x,
      point.y - previous.y,
      point.z - previous.z,
    ) <= 0.001) return;
    result.push({ ...point });
  };

  for (let index = 0; index < routePoints.length - 1; index += 1) {
    const start = routePoints[index];
    const end = routePoints[index + 1];
    if (index === 0) pushDistinct(start);
    const ladder = ladderJunctions.byLadderSegment.get(index);
    if (ladder) {
      const descending = start.y > end.y;
      for (const point of descending
        ? [ladder.topExit, ladder.rootTop, ladder.rootBottom, ladder.bottomExit]
        : [ladder.bottomExit, ladder.rootBottom, ladder.rootTop, ladder.topExit]) {
        pushDistinct(point);
      }
      continue;
    }

    // The next vertical segment owns this joint. Its first public waypoint is
    // the safe mount exit on the horizontal deck, not the raw shaft centre.
    // Sending keyboard navigation to the raw joint walks the player past the
    // 1.4m prompt radius and directly into the opening without mounting.
    if (!ladderJunctions.byLadderSegment.has(index + 1)) pushDistinct(end);
  }
  return result;
}

function trimConnectorDeckForLadderOpening(bounds, trim, surfaceId) {
  if (!trim) return bounds;
  const result = {
    min: { ...bounds.min },
    max: { ...bounds.max },
  };
  const axis = Math.abs(trim.direction.x) >= Math.abs(trim.direction.z) ? 'x' : 'z';
  const edge = trim.joint[axis] + trim.direction[axis] * trim.depth;
  if (trim.direction[axis] > 0) result.min[axis] = Math.max(result.min[axis], edge);
  else result.max[axis] = Math.min(result.max[axis], edge);
  if (result.max[axis] - result.min[axis] < LADDER_EXIT_EDGE_INSET + 0.42) {
    throw new Error(`Connector deck ${surfaceId} has insufficient landing depth beside its ladder opening (${axis} ${result.min[axis]}..${result.max[axis]}; joint ${trim.joint[axis]}; direction ${trim.direction[axis]}).`);
  }
  return result;
}

export function addConnectorSpatialContracts({ portals, spatialCells, structuralBoundaries, walkableSurfaces, traversalLinks }) {
  const dynamicSurfaceByMechanism = {
    'mechanism.cargo-lift': 'surface.salvage-tunnel.lift',
    'mechanism.gamma-return-lift': 'surface.hazard-core.return-lift',
    'mechanism.lab-lift': 'surface.lab-recovery.lift',
    'mechanism.corkscrew-gear': 'surface.corkscrew.gear',
    'mechanism.lab-auto-cargo': 'surface.lab-upper.auto-cargo',
  };
  for (const portal of portals) {
    const routePoints = simplifyCollinearRoutePoints(connectorRoutePoints(portal));
    const ladderJunctions = buildConnectorLadderJunctions(routePoints, portal);
    const physicalTraversalRoutePoints = connectorPhysicalTraversalRoutePoints(
      routePoints,
      ladderJunctions,
    );
    const portalDynamicSurfaceId = ['lift', 'moving-platform', 'gear-platform'].includes(portal.approachType)
      ? dynamicSurfaceByMechanism[portal.mechanismId]
      : null;
    const verticalFrameMargin = ['floor', 'ceiling'].includes(portal.from.side)
      && ['floor', 'ceiling'].includes(portal.to.side) ? 2 : 0;
    const connectorBaseWidth = portal.traversal.minimumWidth + verticalFrameMargin;
    const connectorCellHeadroom = Math.max(
      4.2,
      Number(portal.from.dimensions.height),
      Number(portal.to.dimensions.height),
    );
    const segmentAxes = routePoints.slice(1).map((point, index) => (
      connectorSegmentAxis(routePoints[index], point)
    ));
    const segmentBounds = routePoints.slice(1).map((end, index) => {
      const axis = segmentAxes[index];
      const previousAxis = segmentAxes[index - 1] ?? null;
      const nextAxis = segmentAxes[index + 1] ?? null;
      // Widen only the endpoint cell that physically meets a wider room
      // aperture. Carrying a generic 4.8m endpoint width through every cell
      // made an otherwise 3.2m native connector intrude back through the
      // Security shell and falsely widened its playable contract.
      const segmentWidth = Math.max(
        connectorBaseWidth,
        index === 0 ? Number(portal.from.dimensions.width) : 0,
        index === routePoints.length - 2 ? Number(portal.to.dimensions.width) : 0,
      );
      return connectorSegmentBounds(routePoints[index], end, segmentWidth, {
        // At a right-angle joint both cells need a full-width overlap centred
        // on the route point.  A half-width overlap places the centreline on
        // the edge of each carved aperture, so the real player capsule clips
        // the frame even though a point ray passes through.
        extendStart: Boolean(previousAxis && previousAxis !== axis),
        extendEnd: Boolean(nextAxis && nextAxis !== axis),
        headroom: connectorCellHeadroom,
      });
    });
    const routeCellIds = [];
    const routeBoundaryIds = [];
    const routeSurfaceIds = [];
    for (let index = 0; index < routePoints.length - 1; index += 1) {
      const start = routePoints[index];
      const end = routePoints[index + 1];
      const segmentId = `${portal.id.replace('portal.', '')}.${index}`;
      const connectorCellId = `cell.connector.${segmentId}`;
      const bounds = segmentBounds[index];
      routeCellIds.push(connectorCellId);
      spatialCells.push({
        id: connectorCellId,
        regionId: portal.from.regionId,
        bounds,
        playable: portal.approachType !== 'intentional-drop',
        interior: true,
        cameraContained: true,
        occupiedVolume: true,
        connector: true,
        compoundId: `connector.${portal.id}`,
        portalId: portal.id,
      });
      const currentAxis = segmentAxes[index];
      const previousAxis = segmentAxes[index - 1] ?? null;
      const nextAxis = segmentAxes[index + 1] ?? null;
      const coincidentVerticalInterface = ['floor', 'ceiling'].includes(portal.from.side)
        && ['floor', 'ceiling'].includes(portal.to.side)
        && Math.abs(start.x - end.x) < 0.01
        && Math.abs(start.y - end.y) < 0.01
        && Math.abs(start.z - end.z) < 0.01;
      const oppositeVerticalSide = (side) => (side === 'floor' ? 'ceiling' : 'floor');
      const startOpeningSide = coincidentVerticalInterface
        ? oppositeVerticalSide(portal.from.side)
        : segmentOpeningSide(start, end, true);
      const endOpeningSide = coincidentVerticalInterface
        ? oppositeVerticalSide(portal.to.side)
        : segmentOpeningSide(start, end, false);
      const connectorDimensions = {
        width: portal.traversal.minimumWidth,
        height: Math.max(portal.traversal.minimumHeadroom, Math.min(portal.from.dimensions.height, portal.to.dimensions.height)),
        depth: portal.traversal.minimumWidth,
      };
      const previousBounds = previousAxis && previousAxis !== currentAxis
        ? segmentBounds[index - 1]
        : null;
      const nextBounds = nextAxis && nextAxis !== currentAxis
        ? segmentBounds[index + 1]
        : null;
      for (const side of ['north', 'south', 'east', 'west', 'floor', 'ceiling']) {
        const connectorBoundaryId = `boundary.connector.${segmentId}.${side}`;
        const openings = [];
        const startIsPerpendicularElbow = previousAxis && previousAxis !== currentAxis;
        const endIsPerpendicularElbow = nextAxis && nextAxis !== currentAxis;
        if (side === startOpeningSide && !startIsPerpendicularElbow) {
          const dimensions = index === 0 ? portal.from.dimensions : connectorDimensions;
          openings.push({
            id: `opening.connector.${segmentId}.start`,
            portalId: portal.id,
            jointId: index === 0 ? null : `joint.${portal.id}.${index}`,
            center: connectorOpeningCenter(start, side, dimensions),
            dimensions,
          });
        }
        if (side === endOpeningSide && !endIsPerpendicularElbow) {
          const dimensions = index === routePoints.length - 2 ? portal.to.dimensions : connectorDimensions;
          openings.push({
            id: `opening.connector.${segmentId}.end`,
            portalId: portal.id,
            jointId: index === routePoints.length - 2 ? null : `joint.${portal.id}.${index + 1}`,
            center: connectorOpeningCenter(end, side, dimensions),
            dimensions,
          });
        }
        // A short first/last throat can make the next perpendicular leg
        // tangent to the room's portal plane. Carve only the portion backed
        // by the exact endpoint aperture, never the rest of that side wall.
        if (index > 0) {
          const opening = connectorEndpointOverlapOpening(
            bounds, side, portal.from,
            `opening.connector.${segmentId}.from-aperture-overlap.${side}`,
            portal.id,
          );
          if (opening) openings.push(opening);
        }
        if (index < routePoints.length - 2) {
          const opening = connectorEndpointOverlapOpening(
            bounds, side, portal.to,
            `opening.connector.${segmentId}.to-aperture-overlap.${side}`,
            portal.id,
          );
          if (opening) openings.push(opening);
        }
        // Perpendicular legs overlap around their joint. Carve only the
        // projected part of each face that is backed by the adjoining cell.
        // Full-width end-cap openings expose the exterior quadrant; omitting
        // them leaves a real wall across the turn.
        if (startIsPerpendicularElbow) {
          const opening = connectorElbowOpening(
            bounds, previousBounds, side, start, connectorDimensions,
            `opening.connector.${segmentId}.elbow-start.${side}`,
            portal.id, `joint.${portal.id}.${index}`,
          );
          if (opening) openings.push(opening);
        }
        if (endIsPerpendicularElbow) {
          const opening = connectorElbowOpening(
            bounds, nextBounds, side, end, connectorDimensions,
            `opening.connector.${segmentId}.elbow-end.${side}`,
            portal.id, `joint.${portal.id}.${index + 1}`,
          );
          if (opening) openings.push(opening);
        }
        structuralBoundaries.push({
          id: connectorBoundaryId,
          cellId: connectorCellId,
          regionId: portal.from.regionId,
          side,
          kind: openings.length ? 'portal-frame' : 'solid',
          bounds: boundaryBounds(bounds, side),
          openings,
          materialProfileId: `connector.${portal.connectorForm}`,
          visualProfile: `${portal.connectorProfile.wallProfile}:${side}`,
          collider: true,
          collision: 'static',
          opaque: true,
          connector: true,
        });
        routeBoundaryIds.push(connectorBoundaryId);
      }
      if (portal.approachType !== 'intentional-drop') {
        const verticalDelta = Math.abs(end.y - start.y);
        const horizontalLength = Math.hypot(end.x - start.x, end.z - start.z);
        const verticalSegment = verticalDelta > 0.01 && horizontalLength < 0.2;
        const slopedSegment = verticalDelta > 0.01 && horizontalLength >= 0.2;
        const mode = verticalSegment
          ? (portal.approachType === 'lift' ? 'lift' : portal.approachType === 'gear-platform' ? 'gear-platform' : 'ladder')
          : slopedSegment ? 'walkable-stairs'
            : ['moving-platform', 'gear-platform'].includes(portal.approachType) ? portal.approachType : 'walk';
        const ladderJunction = ladderJunctions.byLadderSegment.get(index) ?? null;
        const ladderDeckTrim = ladderJunctions.upperDeckTrimBySegment.get(index) ?? null;
        // Connector route points describe the structural floor datum. The
        // walkable deck rendered beside a vertical segment is 0.30m thick, so
        // a ladder rooted at the raw route point begins below the real deck
        // and is corrected upward on the next gameplay frame. Bind both ends
        // to the exact deck top instead; this removes the collision seam and
        // keeps ascent/descent stable after the dismount handoff expires.
        const ladderDeckPath = mode === 'ladder'
          ? ladderJunction?.planePath
          : null;
        if (mode === 'ladder' && !ladderJunction) {
          throw new Error(`Connector ladder ${portal.id}:${index} has no top/bottom landing contract.`);
        }
        const geometry = mode === 'ladder'
          ? createLadderGeometryV2({
              planePath: ladderDeckPath,
              width: 1.6,
              climbFacing: vector(
                -ladderJunction.upperDirection.x,
                0,
                -ladderJunction.upperDirection.z,
              ),
              mountClearance: 1.4,
              enclosed: true,
              bottomExit: ladderJunction.bottomExit,
              topExit: ladderJunction.topExit,
              bottomExitFacing: ladderJunction.lowerDirection,
              topExitFacing: ladderJunction.upperDirection,
              topOpening: ladderJunction.topOpening,
              landings: ladderJunction.landings,
            })
          : {
              type: mode,
              path: [start, end],
              width: portal.traversal.minimumWidth,
              maximumRiser: mode === 'walkable-stairs' ? 0.18 : null,
              minimumTread: mode === 'walkable-stairs' ? 0.45 : null,
              enclosed: true,
              ...(ladderDeckTrim ? {
                ladderOpeningEdge: {
                  ladderSurfaceId: `surface.connector.${portal.id.replace('portal.', '')}.${ladderDeckTrim.ladderSegmentIndex}`,
                  direction: ladderDeckTrim.direction,
                  edge: pointAlong(
                    ladderDeckTrim.joint,
                    ladderDeckTrim.direction,
                    ladderDeckTrim.depth,
                    ladderDeckTrim.joint.y + 0.3,
                  ),
                  openingBounds: ladderDeckTrim.openingBounds,
                },
              } : {}),
            };
        const dynamicLiftSurfaceId = portalDynamicSurfaceId;
        const routeSurfaceId = dynamicLiftSurfaceId ?? `surface.connector.${segmentId}`;
        if (dynamicLiftSurfaceId && !routeSurfaceIds.includes(dynamicLiftSurfaceId)) {
          // A dynamic connector is traversed by the one real moving platform,
          // not by static slabs hidden in every route segment. Stable-state
          // boarding links are authored after the mechanism surface exists.
          routeSurfaceIds.push(dynamicLiftSurfaceId);
        } else if (!dynamicLiftSurfaceId) {
          routeSurfaceIds.push(routeSurfaceId);
          const untrimmedSurfaceBounds = connectorSurfaceBounds(bounds, start, end);
          walkableSurfaces.push({
            id: routeSurfaceId,
            regionId: portal.from.regionId,
            cellId: connectorCellId,
            bounds: trimConnectorDeckForLadderOpening(
              untrimmedSurfaceBounds,
              ladderDeckTrim,
              routeSurfaceId,
            ),
            purpose: `enclosed ${portal.connectorForm} route for ${portal.id}`,
            supportBoundaryIds: [`boundary.connector.${segmentId}.floor`],
            supportProfile: portal.connectorProfile.supportProfile,
            visualProfile: `${portal.connectorForm}:${mode}`,
            collision: 'static',
            hazardTag: null,
            geometry,
          });
        }
      }
    }
    for (let index = 1; !portalDynamicSurfaceId && index < routeSurfaceIds.length; index += 1) {
      traversalLinks.push({
        id: `traversal.connector.${portal.id.replace('portal.', '')}.${index}`,
        regionId: portal.from.regionId,
        fromSurfaceId: routeSurfaceIds[index - 1],
        toSurfaceId: routeSurfaceIds[index],
        mode: portal.approachType,
        bidirectional: portal.direction !== 'forward-only',
        minimumWidth: portal.traversal.minimumWidth,
        // Internal chain proofs must exercise the same legal open/mechanism
        // state as their parent portal, while remaining independent capsule
        // proofs rather than being hidden by the top-level portal audit.
        proofPortalId: portal.id,
        conditions: portal.conditions,
      });
    }
    const endpointSurfaceId = (endpoint, role) => {
      if (portal.approachType === 'intentional-drop') {
        return role === 'from' ? surfaceId(endpoint.regionId, 'crumble') : surfaceId(endpoint.regionId, 'catchment');
      }
      const nearestPrimaryFloor = () => walkableSurfaces
        .filter((surface) => surface.regionId === endpoint.regionId
          && surface.primaryFloor === true
          && surface.collision !== 'dynamic')
        .sort((left, right) => (
          planarDistanceSquaredToBounds(endpoint.center, left.bounds)
          - planarDistanceSquaredToBounds(endpoint.center, right.bounds)
          || left.id.localeCompare(right.id)
        ))[0]?.id ?? surfaceId(endpoint.regionId);
      if (endpoint.side === 'floor' || endpoint.side === 'ceiling') {
        return nearestPrimaryFloor();
      }
      const regionFloor = spatialCells.find((entry) => entry.id === cellId(endpoint.regionId))?.bounds.min.y;
      return endpoint.elevation > regionFloor + 0.2
        ? surfaceId(endpoint.regionId, `landing-${portal.id.replace('portal.', '')}`)
        : nearestPrimaryFloor();
    };
    const fromSurfaceId = endpointSurfaceId(portal.from, 'from');
    const toSurfaceId = endpointSurfaceId(portal.to, 'to');
    if (routeSurfaceIds.length && !portalDynamicSurfaceId) {
      traversalLinks.push(
        { id: `traversal.connector.${portal.id.replace('portal.', '')}.from-endpoint`, regionId: portal.from.regionId, fromSurfaceId, toSurfaceId: routeSurfaceIds[0], mode: portal.approachType, bidirectional: portal.direction !== 'forward-only', minimumWidth: portal.traversal.minimumWidth, portalId: portal.id, conditions: portal.conditions.filter((condition) => condition.op === 'stateEquals') },
        { id: `traversal.connector.${portal.id.replace('portal.', '')}.to-endpoint`, regionId: portal.to.regionId, fromSurfaceId: routeSurfaceIds.at(-1), toSurfaceId, mode: portal.approachType, bidirectional: portal.direction !== 'forward-only', minimumWidth: portal.traversal.minimumWidth, portalId: portal.id, conditions: portal.conditions.filter((condition) => condition.op === 'stateEquals') },
      );
    } else if (!portalDynamicSurfaceId) {
      const intentionalDrop = portal.approachType === 'intentional-drop';
      traversalLinks.push({
        id: `${intentionalDrop ? 'traversal.fall' : 'traversal.connector'}.${portal.id.replace('portal.', '')}.direct`,
        regionId: portal.from.regionId,
        fromSurfaceId,
        toSurfaceId,
        mode: portal.approachType,
        bidirectional: intentionalDrop ? false : portal.direction !== 'forward-only',
        minimumWidth: portal.traversal.minimumWidth,
        portalId: portal.id,
        mechanismId: portal.mechanismId ?? null,
        ...(intentionalDrop ? { damageFree: true, playableDestination: true } : {}),
      });
    }
    portal.physicalRoute = {
      cellIds: routeCellIds,
      boundaryIds: routeBoundaryIds,
      surfaceIds: routeSurfaceIds,
      // Ordinary segments preserve the orthogonal centreline used to build
      // the cells. Ladder joints replace the raw shaft centre with the exact
      // top exit -> root path -> bottom exit sequence shared by runtime mount
      // interaction and public-input navigation.
      routePoints: physicalTraversalRoutePoints,
      endpointSurfaceIds: { from: fromSurfaceId, to: toSurfaceId },
      continuous: true,
      enclosed: true,
      supported: true,
      authored: true,
    };
  }
}

function makeRegions(regionSpecs, portals) {
  return regionSpecs.map((spec, index) => {
    const regionPortals = portals.filter((portal) => portal.from.regionId === spec.id || portal.to.regionId === spec.id);
    const authoredDetails = GOLDEN_REGION_AUTHORED_DETAILS_V2[spec.id] ?? null;
    return {
      id: spec.id,
      stableRegionId: `region.${spec.id}`,
      districtId: spec.districtId,
      displayName: spec.displayName,
      functionalPurpose: spec.functionalPurpose,
      presentationAssetFamilyId: authoredDetails?.assetFamilyId ?? null,
      presentationAssetSource: authoredDetails ? 'dungeon-v1' : 'milestone-1-traversal-lab',
      modulePlacementId: `placement.${spec.id}`,
      topologySignature: spec.topologySignature,
      elevation: spec.floorY,
      elevationBand: spec.floorY < -4 ? 'low' : spec.floorY >= 6 ? 'high' : 'middle',
      bounds: boundsForSpec(spec),
      cellIds: spec.landmark
        ? [cellId(spec.id), `cell.${spec.id}.process-alcove`, `cell.${spec.id}.inspection-vault`]
        : [cellId(spec.id)],
      subRegions: spec.landmark ? [
        { id: `${spec.id}.main-floor`, cellId: cellId(spec.id), purpose: 'primary functional floor' },
        { id: `${spec.id}.process-alcove`, cellId: `cell.${spec.id}.process-alcove`, purpose: 'optional machinery and treasure branch' },
        { id: `${spec.id}.inspection-vault`, cellId: `cell.${spec.id}.inspection-vault`, purpose: 'raised traversal and machinery branch' },
      ] : [{ id: `${spec.id}.main-floor`, cellId: cellId(spec.id), purpose: 'primary functional floor' }],
      portalIds: regionPortals.map((portal) => portal.id),
      discoveryOrder: index,
      landmark: spec.landmark,
    };
  });
}

function makeModuleDescriptors(regionSpecs, connectionSpecs) {
  const endpoints = new Map(regionSpecs.map((spec) => [spec.id, []]));
  for (const connectionSpec of connectionSpecs) {
    const common = {
      connectionId: connectionSpec.id,
      connectorForm: connectionSpec.connectorForm,
      approachType: connectionSpec.approachType,
      direction: connectionSpec.direction ?? 'bidirectional',
      barrierId: connectionSpec.barrierId ?? null,
      mechanismId: connectionSpec.mechanismId ?? null,
    };
    endpoints.get(connectionSpec.fromRegionId)?.push({ ...connectionSpec.from, ...common, role: 'source' });
    endpoints.get(connectionSpec.toRegionId)?.push({ ...connectionSpec.to, ...common, role: 'target' });
  }

  const labFixtureBlueprints = {
    'lab-entry': [
      { id: 'sealed-transition', type: 'sealed-bulkhead', offset: { x: -0.3, y: 0, z: -0.28 }, size: { x: 5, y: 4.5, z: 2.2 }, purpose: 'defines the sealed acceptance boundary and protected starting lane' },
      { id: 'diagnostic-bank', type: 'control-bank', offset: { x: 0.3, y: 0, z: 0.24 }, size: { x: 4.2, y: 2.8, z: 2.2 }, purpose: 'reports fixture state without obstructing either exit route' },
      { id: 'entry-conduit', type: 'conduit', offset: { x: 0, y: 6.5, z: -0.34 }, size: { x: 17, y: 1.4, z: 1.4 }, purpose: 'visually carries services from the sealed entry into the lab' },
    ],
    'lab-stairs': [
      { id: 'stair-stringer-bank', type: 'structural-support', offset: { x: -0.28, y: 0, z: 0 }, size: { x: 3.2, y: 6, z: 14 }, purpose: 'supports the continuous walkable stair without ledge-climb steps' },
      { id: 'ladder-service-cage', type: 'ladder-cage', offset: { x: 0.34, y: 0, z: -0.24 }, size: { x: 3, y: 9, z: 3 }, purpose: 'encloses the authored ladder mount and top exit' },
      { id: 'stair-pressure-main', type: 'pressure-pipe', offset: { x: 0.1, y: 8.2, z: 0.32 }, size: { x: 17, y: 2, z: 2 }, purpose: 'marks the upper landing while preserving camera clearance' },
    ],
    'lab-upper': [
      { id: 'cargo-track', type: 'cargo-track', offset: { x: 0, y: 8.7, z: 0 }, size: { x: 24, y: 1.2, z: 2.2 }, purpose: 'supports the elevated automatic cargo route between useful landings' },
      { id: 'lift-headframe', type: 'lift-headframe', offset: { x: -0.34, y: 0, z: 0.25 }, size: { x: 5, y: 10, z: 5 }, purpose: 'provides visible full-height support for the lift landing' },
      { id: 'upper-inspection-bank', type: 'control-bank', offset: { x: 0.34, y: 0, z: -0.26 }, size: { x: 4.5, y: 3, z: 2.4 }, purpose: 'documents automatic cargo timing beside the walkway' },
    ],
    'lab-water-freight': [
      { id: 'freight-pump-west', type: 'pump-array', offset: { x: -0.34, y: 0, z: 0.25 }, size: { x: 5.5, y: 6, z: 5 }, purpose: 'moves the conserved water unit into the freight test basin' },
      { id: 'freight-pump-east', type: 'pump-array', offset: { x: 0.34, y: 0, z: -0.25 }, size: { x: 5.5, y: 5, z: 5 }, purpose: 'frames the dry damage-free return route' },
      { id: 'freight-transfer-main', type: 'coolant-pipe', offset: { x: 0, y: 7.2, z: 0.34 }, size: { x: 18, y: 2, z: 2 }, purpose: 'makes the conserved transfer path visible above both water states' },
    ],
    'lab-water-reservoir': [
      { id: 'reservoir-vessel', type: 'reservoir', offset: { x: 0, y: 0, z: 0.24 }, size: { x: 9, y: 9, z: 9 }, purpose: 'stores exactly one conserved water unit' },
      { id: 'router-pump-west', type: 'pump-array', offset: { x: -0.35, y: 0, z: -0.28 }, size: { x: 5, y: 5, z: 5 }, purpose: 'feeds the permanently dry three-state router' },
      { id: 'router-pump-east', type: 'pump-array', offset: { x: 0.35, y: 0, z: -0.28 }, size: { x: 5, y: 6, z: 5 }, purpose: 'returns the conserved unit from either sump' },
    ],
    'lab-water-gantry': [
      { id: 'gantry-pump-west', type: 'pump-array', offset: { x: -0.34, y: 0, z: 0.25 }, size: { x: 5.5, y: 6, z: 5 }, purpose: 'fills the gantry basin while leaving a bottom-walk route' },
      { id: 'gantry-pressure-vessel', type: 'pressure-vessel', offset: { x: 0.34, y: 0, z: -0.25 }, size: { x: 5, y: 7, z: 5 }, purpose: 'marks the flooded traversal lane and upper landing' },
      { id: 'gantry-transfer-main', type: 'coolant-pipe', offset: { x: 0, y: 7.6, z: 0.34 }, size: { x: 18, y: 2, z: 2 }, purpose: 'signals transfer toward the third conserved-water destination' },
    ],
    'lab-hazards': [
      { id: 'magma-regulator', type: 'generator', offset: { x: -0.32, y: 0, z: -0.25 }, size: { x: 6, y: 7, z: 6 }, purpose: 'regulates and telegraphs the magma timing lane' },
      { id: 'electrical-regulator', type: 'generator', offset: { x: 0.32, y: 0, z: 0.25 }, size: { x: 6, y: 7, z: 6 }, purpose: 'regulates and telegraphs the electrical phase lane' },
      { id: 'hazard-warning-bank', type: 'control-bank', offset: { x: 0, y: 0, z: -0.36 }, size: { x: 8, y: 3, z: 2.2 }, purpose: 'shows phase timing before either damage-free crossing' },
    ],
    'lab-gear': [
      { id: 'gear-drive', type: 'generator', offset: { x: -0.32, y: 0, z: 0.26 }, size: { x: 6, y: 8, z: 6 }, purpose: 'drives the two-state corkscrew platform' },
      { id: 'crumble-warning-bank', type: 'control-bank', offset: { x: 0.32, y: 0, z: -0.26 }, size: { x: 5, y: 3, z: 2.4 }, purpose: 'telegraphs the automatic crumble route without a rearm control' },
      { id: 'gear-lubricant-main', type: 'pressure-pipe', offset: { x: 0, y: 11, z: 0.34 }, size: { x: 20, y: 2.2, z: 2.2 }, purpose: 'marks the high gear landing and leaves camera clearance' },
    ],
    'lab-recovery': [
      { id: 'catchment-support', type: 'structural-support', offset: { x: -0.24, y: 0, z: 0.22 }, size: { x: 7, y: 3.2, z: 7 }, purpose: 'visibly supports the damage-free authored fall catchment' },
      { id: 'return-lift-frame', type: 'lift-headframe', offset: { x: 0.34, y: 0, z: -0.22 }, size: { x: 5, y: 9, z: 5 }, purpose: 'supports the recallable automatic return lift' },
      { id: 'recovery-parts-rack', type: 'server-bank', offset: { x: -0.34, y: 0, z: -0.25 }, size: { x: 4, y: 5, z: 7 }, purpose: 'makes the lower playable sub-zone useful rather than a recovery pit' },
    ],
  };

  const encounterBlueprints = {
    assembly: [{ id: 'encounter.assembly', purpose: 'ordinary pump-cavern encounter', position: vector(7, 0.35, 5), required: true, optional: false }],
    sorting: [{ id: 'encounter.sorting', purpose: 'ordinary sorting-gantry encounter', position: vector(-5, 0.35, 5), required: true, optional: false }],
    nest: [{ id: 'encounter.nest', purpose: 'optional warehouse nest encounter', position: vector(0, 0.35, 0), required: false, optional: true }],
    'machine-core': [{ id: 'encounter.machine-core', purpose: 'final Machine Core elite', position: vector(0, 0.35, 0), required: true, optional: false, finalElite: true }],
  };

  const rewardBlueprints = {
    security: [{ id: 'reward.key-seeker', type: 'key-seeker', position: vector(-3, 0.35, 4), purpose: 'entrance Key Seeker station' }],
    server: [
      { id: 'reward.keycard-alpha', type: 'keycard', position: vector(8, 4.35, 6), purpose: 'remote Alpha credential pedestal' },
      { id: 'reward.cache.alpha', type: 'reaverbot-parts-cache', position: vector(-5.5, 0.35, -7.5), purpose: 'Alpha expedition treasure in the clear crypt service aisle' },
    ],
    nest: [{ id: 'reward.cache.nest', type: 'reaverbot-parts-cache', position: vector(10, 0.35, -8), purpose: 'optional Nest treasure' }],
    'freight-sump': [{ id: 'reward.discovery.flooded', type: 'discovery', position: vector(8, 0.35, -8), purpose: 'flooded-only Waterworks discovery' }],
    'gantry-sump': [{ id: 'reward.cache.water', type: 'reaverbot-parts-cache', position: vector(8, 0.35, 7), purpose: 'flooded Gantry Sump treasure' }],
    'salvage-tunnel': [
      { id: 'reward.keycard-beta', type: 'keycard', position: vector(8, 0.35, 5), purpose: 'drained-only Beta credential pedestal' },
      { id: 'reward.discovery.drained', type: 'discovery', position: vector(-8, 0.35, 7), purpose: 'drained-only Waterworks discovery' },
    ],
    'hazard-core': [
      { id: 'reward.keycard-gamma', type: 'keycard', position: vector(12, 4.35, 8), purpose: 'Gamma pedestal beyond the safe hazard route' },
      { id: 'reward.cache.undercroft', type: 'major-reaverbot-parts-cache', position: vector(-10, 0.35, 8), purpose: 'Undercroft major cache on a safe island' },
    ],
    'machine-core': [{ id: 'reward.shrine-key', type: 'keycard', position: vector(0, 0.35, 0), purpose: 'exclusive final-elite Shrine Key reward' }],
    extraction: [
      { id: 'reward.large-refractor', type: 'large-refractor', position: vector(-5, 0.35, 0), purpose: 'Large Refractor shrine dais' },
      { id: 'objective.extraction', type: 'extraction', position: vector(8, 1.35, 3), purpose: 'sealed extraction pad' },
    ],
    'lab-upper': [{ id: 'objective.lab-complete', type: 'fixture-complete', position: vector(10, 0.35, 0), purpose: 'traversal lab completion station' }],
  };

  const controlBlueprints = {
    security: [{ id: 'control.gate.alpha', type: 'gate-control', position: vector(0.75, 4.35, -8), forward: vector(1, 0, 0), actionId: 'action.open.door-alpha', barrierId: 'Door_Alpha' }],
    freight: [{ id: 'control.shortcut.alpha', type: 'gate-control', position: vector(-14, 1.35, 10.25), forward: vector(0, 0, -1), actionId: 'action.open.shortcut-alpha', barrierId: 'Gate_Shortcut_Alpha' }],
    sorting: [
      { id: 'control.gate.beta', type: 'gate-control', position: vector(18, 5.35, 12.25), forward: vector(0, 0, -1), actionId: 'action.open.door-beta', barrierId: 'Door_Beta' },
      { id: 'control.cargo-lift.upper', type: 'mechanism-control', position: vector(11.2, 0.3, -4), actionId: 'action.cargo-lift.recall-upper', mechanismId: 'mechanism.cargo-lift' },
    ],
    credential: [{ id: 'control.gamma-lift.upper', type: 'mechanism-control', position: vector(6.8, 0.3, -12), actionId: 'action.gamma-lift.recall-upper', mechanismId: 'mechanism.gamma-return-lift' }],
    corkscrew: [
      { id: 'control.gear.low', type: 'mechanism-control', position: vector(-7.7, 0.35, -7.48), actionId: 'action.gear.align-low', mechanismId: 'mechanism.corkscrew-gear' },
      { id: 'control.gear.bridge', type: 'mechanism-control', position: vector(0, 4.35, 2), actionId: 'action.gear.align-bridge', mechanismId: 'mechanism.corkscrew-gear' },
      // Keep the complete 2.5m console pad south-east of the HighLanding gear
      // sweep. It joins the landing at z=-13 without occupying either the
      // moving platform footprint or the eastbound Gamma-gate approach.
      { id: 'control.gear.high', type: 'mechanism-control', position: vector(19.5, 5.35, -14.25), actionId: 'action.gear.align-high', mechanismId: 'mechanism.corkscrew-gear' },
      { id: 'control.gate.gamma', type: 'gate-control', position: vector(19.5, 5.35, -5.75), forward: vector(0, 0, -1), actionId: 'action.open.door-gamma', barrierId: 'Door_Gamma' },
      { id: 'control.credential-loop', type: 'gate-control', position: vector(-19.5, 4.35, 9.25), forward: vector(0, 0, 1), actionId: 'action.open.credential-loop', barrierId: 'Gate_Credential_Loop' },
    ],
    'machine-core': [{ id: 'control.gate.shrine', type: 'gate-control', position: vector(19.5, 4.35, 14.25), forward: vector(0, 0, -1), actionId: 'action.open.door-shrine', barrierId: 'Door_Shrine' }],
    reservoir: [
      { id: 'control.water.freight', type: 'water-router', position: vector(-2.5, 4.35, -8), actionId: 'action.water.freight-sump', mechanismId: 'mechanism.water-router' },
      { id: 'control.water.reservoir', type: 'water-router', position: vector(0, 4.35, -8), actionId: 'action.water.reservoir', mechanismId: 'mechanism.water-router' },
      { id: 'control.water.gantry', type: 'water-router', position: vector(2.5, 4.35, -8), actionId: 'action.water.gantry-sump', mechanismId: 'mechanism.water-router' },
    ],
    'salvage-tunnel': [
      { id: 'control.shortcut.beta', type: 'gate-control', position: vector(-10, 0.35, -7), actionId: 'action.open.shortcut-beta', barrierId: 'Gate_Shortcut_Beta' },
      { id: 'control.cargo-lift.lower', type: 'mechanism-control', position: vector(11.2, 0.3, -4), actionId: 'action.cargo-lift.recall-lower', mechanismId: 'mechanism.cargo-lift' },
    ],
    'hazard-core': [
      { id: 'control.shortcut.gamma', type: 'gate-control', position: vector(6.8, 0.3, -9.5), actionId: 'action.open.shortcut-gamma', barrierId: 'Gate_Shortcut_Gamma' },
      { id: 'control.gamma-lift.lower', type: 'mechanism-control', position: vector(6.8, 0.3, -12), actionId: 'action.gamma-lift.recall-lower', mechanismId: 'mechanism.gamma-return-lift' },
    ],
    'lab-water-reservoir': [
      { id: 'control.water.freight', type: 'water-router', position: vector(-2.5, 4.35, -8), actionId: 'action.water.freight-sump', mechanismId: 'mechanism.water-router' },
      { id: 'control.water.reservoir', type: 'water-router', position: vector(0, 4.35, -8), actionId: 'action.water.reservoir', mechanismId: 'mechanism.water-router' },
      { id: 'control.water.gantry', type: 'water-router', position: vector(2.5, 4.35, -8), actionId: 'action.water.gantry-sump', mechanismId: 'mechanism.water-router' },
    ],
    'lab-gear': [
      { id: 'control.lab-lift.upper', type: 'mechanism-control', position: vector(12.2, 0.3, -4), actionId: 'action.lab-lift.recall-upper', mechanismId: 'mechanism.lab-lift' },
      { id: 'control.lab-gear.low', type: 'mechanism-control', position: vector(-8, 0.35, 8), actionId: 'action.lab-gear.low', mechanismId: 'mechanism.lab-gear' },
      { id: 'control.lab-gear.high', type: 'mechanism-control', position: vector(8, 0.35, 8), actionId: 'action.lab-gear.high', mechanismId: 'mechanism.lab-gear' },
    ],
    'lab-recovery': [{ id: 'control.lab-lift.lower', type: 'mechanism-control', position: vector(12.2, 0.3, -4), actionId: 'action.lab-lift.recall-lower', mechanismId: 'mechanism.lab-lift' }],
  };

  const mechanismBlueprints = {
    assembly: [{ id: 'mechanism.freight-crumble', type: 'crumbling-floor', initialStateId: 'Intact', stableStateIds: ['Intact', 'Collapsed'], automaticReset: true }],
    sorting: [{ id: 'mechanism.sorting-cargo', type: 'moving-cargo', initialStateId: 'CycleStart', stableStateIds: ['CycleStart', 'FarLanding'], automaticTravel: true, path: [vector(-12, 4, 0), vector(12, 4, 0)] }],
    reservoir: [{ id: 'mechanism.water-router', type: 'water-router', initialStateId: 'FreightSumpFilled', stableStateIds: ['FreightSumpFilled', 'StoredInReservoir', 'GantrySumpFilled'], conservedUnits: 1, atomicCommit: true }],
    'salvage-tunnel': [{ id: 'mechanism.cargo-lift', type: 'cargo-lift', initialStateId: 'LowerLanding', stableStateIds: ['LowerLanding', 'UpperLanding'], recallable: true, automaticTravel: true, path: [vector(6, 0, -4), vector(6, 18, -4)] }],
    corkscrew: [{ id: 'mechanism.corkscrew-gear', type: 'corkscrew-gear', initialStateId: 'LowLanding', stableStateIds: ['LowLanding', 'BridgeAligned', 'HighLanding'], path: [vector(8, -4, -7), vector(5, 4, 0), vector(10, 9, 0)] }],
    'hazard-core': [
      { id: 'mechanism.gamma-return-lift', type: 'cargo-lift', initialStateId: 'LowerLanding', stableStateIds: ['LowerLanding', 'UpperLanding'], recallable: true, automaticTravel: true, path: [vector(12, 0, -12), vector(12, 20, -12)] },
      { id: 'mechanism.undercroft-hazard', type: 'environmental-hazard', initialStateId: 'SafeOrActive', stableStateIds: ['SafeOrActive', 'Energized'], compatibleProfiles: ['magma-floor-v1', 'electric-floor-cycle-v1'] },
    ],
    'lab-water-reservoir': [{ id: 'mechanism.water-router', type: 'water-router', initialStateId: 'FreightSumpFilled', stableStateIds: ['FreightSumpFilled', 'StoredInReservoir', 'GantrySumpFilled'], conservedUnits: 1, atomicCommit: true }],
    'lab-upper': [{ id: 'mechanism.lab-auto-cargo', type: 'moving-cargo', initialStateId: 'Near', stableStateIds: ['Near', 'Far'], automaticTravel: true, path: [vector(-10, 2, -4), vector(10, 2, 4)] }],
    'lab-gear': [
      { id: 'mechanism.lab-crumble', type: 'crumbling-floor', initialStateId: 'Intact', stableStateIds: ['Intact', 'Collapsed'], automaticReset: true },
      { id: 'mechanism.lab-gear', type: 'corkscrew-gear', initialStateId: 'LowLanding', stableStateIds: ['LowLanding', 'HighLanding'], path: [vector(0, 0, 0), vector(5, 8, 0)] },
    ],
    'lab-recovery': [{ id: 'mechanism.lab-lift', type: 'cargo-lift', initialStateId: 'LowerLanding', stableStateIds: ['LowerLanding', 'UpperLanding'], recallable: true, automaticTravel: true, path: [vector(7, 0, -4), vector(7, 10, -4)] }],
  };

  const clampPointToInterior = (spec, point) => vector(
    Math.max(-spec.size.x / 2 + 0.6, Math.min(spec.size.x / 2 - 0.6, point.x)),
    Math.max(0, Math.min(spec.size.y - 0.6, point.y)),
    Math.max(-spec.size.z / 2 + 0.6, Math.min(spec.size.z / 2 - 0.6, point.z)),
  );

  const localSocketPosition = (spec, endpoint, openingCenter = false) => {
    const vertical = endpoint.side === 'floor' || endpoint.side === 'ceiling';
    if (vertical) {
      const offset = endpoint.offset ?? {};
      return vector(Number(offset.x ?? 0), endpoint.side === 'floor' ? 0 : spec.size.y, Number(offset.z ?? 0));
    }
    const y = Number(endpoint.rise ?? 0) + (openingCenter ? 2.1 : 0.35);
    if (endpoint.side === 'north') return vector(Number(endpoint.offset ?? 0), y, -spec.size.z / 2);
    if (endpoint.side === 'south') return vector(Number(endpoint.offset ?? 0), y, spec.size.z / 2);
    if (endpoint.side === 'west') return vector(-spec.size.x / 2, y, Number(endpoint.offset ?? 0));
    return vector(spec.size.x / 2, y, Number(endpoint.offset ?? 0));
  };

  const inwardFacing = (side) => {
    if (side === 'north') return vector(0, 0, 1);
    if (side === 'south') return vector(0, 0, -1);
    if (side === 'west') return vector(1, 0, 0);
    if (side === 'east') return vector(-1, 0, 0);
    if (side === 'floor') return vector(0, 1, 0);
    return vector(0, -1, 0);
  };

  const fixtureBlueprintRecords = (spec, authoredDetails) => {
    const blueprints = authoredDetails?.fixtures ?? labFixtureBlueprints[spec.id] ?? [];
    return blueprints.map((blueprint) => {
      const center = vector(
        spec.size.x * blueprint.offset.x,
        blueprint.offset.y + blueprint.size.y / 2,
        spec.size.z * blueprint.offset.z,
      );
      return {
        ...blueprint,
        assetFamilyId: authoredDetails?.assetFamilyId ?? null,
        presentationAsset: authoredDetails ? {
          source: 'dungeon-v1',
          familyId: authoredDetails.assetFamilyId,
          role: blueprint.type,
        } : null,
        localBounds: {
          min: vector(center.x - blueprint.size.x / 2, center.y - blueprint.size.y / 2, center.z - blueprint.size.z / 2),
          max: vector(center.x + blueprint.size.x / 2, center.y + blueprint.size.y / 2, center.z + blueprint.size.z / 2),
        },
        collision: 'blocking',
        supportPurposeId: 'load-bearing-foundation',
        reachableCollisionRequired: true,
      };
    });
  };

  return regionSpecs.map((spec) => {
    const authoredDetails = GOLDEN_REGION_AUTHORED_DETAILS_V2[spec.id] ?? null;
    const localBounds = { min: vector(-spec.size.x / 2, 0, -spec.size.z / 2), max: vector(spec.size.x / 2, spec.size.y, spec.size.z / 2) };
    const regionEndpoints = endpoints.get(spec.id);
    const sockets = regionEndpoints.map((endpoint, index) => {
      const vertical = endpoint.side === 'floor' || endpoint.side === 'ceiling';
      return {
        id: `socket.${index}.${endpoint.connectionId}`,
        side: endpoint.side,
        role: endpoint.role,
        offset: endpoint.offset,
        elevation: endpoint.rise,
        position: localSocketPosition(spec, endpoint),
        openingCenter: localSocketPosition(spec, endpoint, true),
        inwardFacing: inwardFacing(endpoint.side),
        placementBucket: endpoint.placementBucket,
        connectorType: endpoint.connectorForm,
        connectorForm: endpoint.connectorForm,
        approachType: endpoint.approachType,
        direction: endpoint.direction,
        barrierId: endpoint.barrierId,
        mechanismId: endpoint.mechanismId,
        dimensions: vertical ? { width: 5.2, height: 0.8, depth: 5.2 } : { width: 4.8, height: 4.2, depth: 1.2 },
        minimumPlayerClearance: { width: 1.2, height: 3.2 },
        minimumCameraClearance: 1.8,
      };
    });
    const fixtureBlueprints = fixtureBlueprintRecords(spec, authoredDetails);
    const upperY = Math.min(4, spec.size.y - 4);
    const subRegions = [{
      id: 'main-floor',
      regionId: 'main',
      purpose: 'primary functional floor and connector hub',
      elevation: 0,
      bounds: { min: vector(localBounds.min.x + 0.5, 0, localBounds.min.z + 0.5), max: vector(localBounds.max.x - 0.5, 3.2, localBounds.max.z - 0.5) },
    }];
    if (spec.landmark) {
      subRegions.push(
        {
          id: 'process-alcove',
          regionId: 'main',
          purpose: 'optional machinery and treasure branch',
          elevation: 0,
          bounds: { min: vector(-spec.size.x * 0.23 - 4, 0, -spec.size.z * 0.22 - 4), max: vector(-spec.size.x * 0.23 + 4, Math.min(5.5, spec.size.y - 1), -spec.size.z * 0.22 + 4) },
        },
        {
          id: 'inspection-vault',
          regionId: 'main',
          purpose: 'raised traversal and machinery branch',
          elevation: 4,
          bounds: { min: vector(spec.size.x * 0.22 - 4.5, 4, spec.size.z * 0.22 - 4), max: vector(spec.size.x * 0.22 + 4.5, 4 + Math.min(5, spec.size.y - 5), spec.size.z * 0.22 + 4) },
        },
      );
    }
    const surfaces = [{
      id: 'surface.main',
      regionId: 'main',
      subRegionId: 'main-floor',
      purpose: 'primary-floor',
      bounds: { min: vector(localBounds.min.x + 0.5, 0, localBounds.min.z + 0.5), max: vector(localBounds.max.x - 0.5, 0.35, localBounds.max.z - 0.5) },
      collision: 'static',
      platformPurposeId: 'primary-floor',
      supportPurposeId: 'load-bearing-foundation',
      visibleSupportRequired: true,
    }];
    if (spec.landmark) {
      surfaces.push(
        {
          id: 'surface.landmark-catwalk', regionId: 'main', subRegionId: 'inspection-vault', purpose: 'machinery-inspection-route',
          bounds: { min: vector(-spec.size.x * 0.32, upperY, -2.1), max: vector(spec.size.x * 0.32, upperY + 0.3, 2.1) },
          collision: 'static', platformPurposeId: 'machinery-traversal', supportPurposeId: 'braced-catwalk-columns', visibleSupportRequired: true,
        },
        {
          id: 'surface.landmark-stairs', regionId: 'main', subRegionId: 'main-floor', purpose: 'continuous-walkable-stairs',
          bounds: { min: vector(-spec.size.x * 0.38, 0, -4.5), max: vector(spec.size.x * 0.12, upperY + 0.3, 4.5) },
          collision: 'static', platformPurposeId: 'walkable-stairs', supportPurposeId: 'continuous-stair-stringers', visibleSupportRequired: true,
          path: [vector(-spec.size.x * 0.38, 0, spec.size.z * 0.35), vector(spec.size.x * 0.1, upperY, -spec.size.z * 0.35)],
          maximumRiser: 0.18, minimumTread: 0.45, width: 3.2, ledgeClimbDisabled: true,
        },
      );
    }
    for (const [index, endpoint] of regionEndpoints.entries()) {
      if ((endpoint.side === 'floor' || endpoint.side === 'ceiling') || Number(endpoint.rise ?? 0) <= 0.2) continue;
      const position = localSocketPosition(spec, endpoint);
      surfaces.push({
        id: `surface.socket-landing.${index}`,
        regionId: 'main',
        subRegionId: 'main-floor',
        purpose: `supported ${endpoint.approachType} landing for socket.${index}.${endpoint.connectionId}`,
        bounds: { min: vector(position.x - 3, position.y - 0.35, position.z - 3), max: vector(position.x + 3, position.y, position.z + 3) },
        collision: 'static',
        platformPurposeId: 'supported-landing',
        supportPurposeId: 'braced-landing-columns',
        visibleSupportRequired: true,
      });
    }
    const nodeForSubRegion = (subRegion) => ({
      id: `node.${subRegion.id}`,
      regionId: 'main',
      subRegionId: subRegion.id,
      surfaceId: subRegion.id === 'inspection-vault' ? 'surface.landmark-catwalk' : 'surface.main',
      position: vector(
        (subRegion.bounds.min.x + subRegion.bounds.max.x) / 2,
        subRegion.elevation + 0.35,
        (subRegion.bounds.min.z + subRegion.bounds.max.z) / 2,
      ),
    });
    const traversalNodes = subRegions.map(nodeForSubRegion);
    traversalNodes.push(...sockets.map((socket, index) => ({ id: `node.socket.${index}`, regionId: 'main', socketId: socket.id, position: socket.position })));
    const traversalEdges = sockets.map((socket, index) => ({
      id: `edge.socket.${index}`,
      from: 'node.main-floor',
      to: `node.socket.${index}`,
      toSocketId: socket.id,
      mode: socket.approachType,
      bidirectional: socket.direction !== 'forward-only' || socket.role === 'target',
      minimumWidth: 1.2,
      routePoints: [traversalNodes[0].position, socket.position],
      mechanismId: socket.mechanismId,
      barrierId: socket.barrierId,
    }));
    if (spec.landmark) {
      traversalEdges.push(
        { id: 'edge.process-alcove', from: 'node.main-floor', to: 'node.process-alcove', mode: 'walk', bidirectional: true, minimumWidth: 1.2, routePoints: [traversalNodes[0].position, traversalNodes.find((entry) => entry.id === 'node.process-alcove').position] },
        { id: 'edge.inspection-vault', from: 'node.main-floor', to: 'node.inspection-vault', mode: 'walkable-stairs', bidirectional: true, minimumWidth: 3.2, maximumRiser: 0.18, minimumTread: 0.45, routePoints: surfaces.find((entry) => entry.id === 'surface.landmark-stairs').path },
      );
    }
    const boundarySegments = ['north', 'south', 'east', 'west', 'floor', 'ceiling'].map((side) => ({
      id: `boundary.${side}`,
      side,
      bounds: boundaryBounds(localBounds, side),
      opaque: true,
      collider: true,
      collision: 'static',
      socketIds: sockets.filter((socket) => socket.side === side).map((socket) => socket.id),
      unusedSocketCapProfile: 'themed-load-bearing-cap-v2',
    }));
    const sourceFalls = regionEndpoints
      .map((endpoint, index) => ({ endpoint, index }))
      .filter(({ endpoint }) => endpoint.connectorForm === 'intentional-drop' && endpoint.role === 'source');
    const targetFalls = regionEndpoints
      .map((endpoint, index) => ({ endpoint, index }))
      .filter(({ endpoint }) => endpoint.connectorForm === 'intentional-drop' && endpoint.role === 'target');
    const fallApertures = sourceFalls.map(({ endpoint, index }) => {
      const position = localSocketPosition(spec, endpoint);
      return {
        id: `fall.${endpoint.connectionId}`,
        socketId: `socket.${index}.${endpoint.connectionId}`,
        position,
        bounds: { min: vector(position.x - 2.6, -0.15, position.z - 2.6), max: vector(position.x + 2.6, 0.35, position.z + 2.6) },
        trajectoryEntry: vector(position.x, 0.35, position.z),
        trajectoryExit: vector(position.x, -8, position.z),
        minimumWidth: 5.2,
        signaled: true,
        damageFree: true,
        playableDestinationRequired: true,
        mechanismId: spec.id === 'assembly' ? 'mechanism.freight-crumble' : 'mechanism.lab-crumble',
      };
    });
    const fallCatchments = targetFalls.map(({ endpoint, index }) => {
      const socketPosition = localSocketPosition(spec, endpoint);
      const catchmentY = spec.id === 'freight' ? 7 : 3;
      return {
        id: 'catchment.main',
        socketId: `socket.${index}.${endpoint.connectionId}`,
        position: vector(socketPosition.x, catchmentY + 0.35, socketPosition.z),
        bounds: { min: vector(socketPosition.x - 3.5, catchmentY, socketPosition.z - 3.5), max: vector(socketPosition.x + 3.5, catchmentY + 0.35, socketPosition.z + 3.5) },
        landingDimensions: { width: 7, depth: 7, headroom: 3.2 },
        damageFree: true,
        returnRequired: true,
        returnMode: 'continuous-walkable-stairs',
        safeAnchorId: 'safe.catchment',
      };
    });
    const basinRegion = spec.id.includes('sump') || spec.id.includes('reservoir') || spec.id.includes('water-freight') || spec.id.includes('water-gantry');
    const basinWidth = spec.size.x - WATER_BASIN_WALL_INSET * 2;
    const basinDepth = spec.size.z - WATER_BASIN_WALL_INSET * 2;
    const basinFilledLevel = WATER_CONSERVED_VOLUME_CUBIC_METRES / (basinWidth * basinDepth);
    const basins = basinRegion ? [{
      id: `basin.${spec.id}`,
      bounds: {
        min: vector(-spec.size.x / 2 + WATER_BASIN_WALL_INSET, -0.1, -spec.size.z / 2 + WATER_BASIN_WALL_INSET),
        max: vector(spec.size.x / 2 - WATER_BASIN_WALL_INSET, spec.size.y - 1, spec.size.z / 2 - WATER_BASIN_WALL_INSET),
      },
      walkableBottomY: 0.35,
      capacityUnits: 1,
      exactFilledVolume: WATER_CONSERVED_VOLUME_CUBIC_METRES,
      exactFilledLevel: basinFilledLevel,
      footprintPolicy: 'complete-main-walkable-basin',
      stableLevels: { drained: 0, filled: basinFilledLevel },
      movementProfile: { mode: 'bottom-walking', captureFloodedStateAtTakeoff: true, groundMovementMultiplier: 0.76, jumpHeight: 4.95, gravityScale: 0.28 },
    }] : [];
    const hazardSurfaces = spec.id === 'hazard-core'
      ? [{ id: 'hazard.hazard-core', bounds: { min: vector(-12, 0.35, -9.5), max: vector(12, 0.7, 3.5) }, compatibleHazardTags: ['environmental:magma', 'environmental:electrical'], safeRouteRequired: true, unavoidableExposureAllowed: false }]
      : spec.id === 'lab-hazards'
        ? [
          { id: 'hazard.lab-magma', bounds: { min: vector(-6, 0.35, -10), max: vector(6, 0.7, -2) }, compatibleHazardTags: ['environmental:magma'], safeRouteRequired: true, unavoidableExposureAllowed: false },
          { id: 'hazard.lab-electrical', bounds: { min: vector(-6, 0.35, 2), max: vector(6, 0.7, 10) }, compatibleHazardTags: ['environmental:electrical'], safeRouteRequired: true, unavoidableExposureAllowed: false },
        ]
        : [];
    const controls = (controlBlueprints[spec.id] ?? []).map((control) => ({
      ...control,
      position: clampPointToInterior(spec, control.position),
      forward: control.forward ?? vector(0, 0, 1),
      activationSide: 'front',
      promptRadius: 2.2,
      supportSurfaceId: 'surface.main',
      walkwayClearance: 2.5,
    }));
    const mechanisms = (mechanismBlueprints[spec.id] ?? []).map((mechanism) => ({
      ...mechanism,
      path: mechanism.path?.map((point) => clampPointToInterior(spec, point)) ?? [],
      controllerId: `controller.${mechanism.id.replace('mechanism.', '')}`,
      transitionContract: 'serializable-stable-state-table',
    }));
    const controllers = mechanisms.map((mechanism) => ({
      id: mechanism.controllerId,
      type: mechanism.type,
      mechanismId: mechanism.id,
      initialStateId: mechanism.initialStateId,
      stableStateIds: mechanism.stableStateIds,
      controlIds: controls.filter((control) => control.mechanismId === mechanism.id).map((control) => control.id),
      executablePredicates: false,
    }));
    const safeAnchors = [{ id: 'safe.main', position: vector(-spec.size.x * 0.22, 0.35, spec.size.z * 0.22), surfaceId: 'surface.main', damageFree: true }];
    if (fallCatchments.length) safeAnchors.push({ id: 'safe.catchment', position: fallCatchments[0].position, surfaceId: 'surface.catchment', damageFree: true });
    const presentationProfileId = `presentation.${spec.districtId}.${spec.id}`;
    const materialProfileId = spec.districtId;
    return createDungeonModuleDescriptorV2({
      id: `module.${spec.id}.golden-v1`,
      revision: 1,
      districtFamily: spec.districtId,
      displayName: spec.displayName,
      functionalPurpose: spec.functionalPurpose,
      topologySignature: spec.topologySignature,
      bounds: localBounds,
      occupiedVolumes: [
        { id: 'volume.main-shell', kind: 'enclosed-module-shell', bounds: localBounds },
        ...fixtureBlueprints.map((fixture) => ({ id: `volume.fixture.${fixture.id}`, kind: 'authored-functional-fixture', bounds: fixture.localBounds })),
      ],
      regions: [{
        id: 'main',
        purpose: spec.functionalPurpose,
        elevation: 0,
        bounds: localBounds,
        subRegionIds: subRegions.map((entry) => entry.id),
        traversalNodeIds: traversalNodes.map((entry) => entry.id),
      }],
      subRegions,
      sockets,
      surfaces,
      traversalNodes,
      traversalEdges,
      boundarySegments,
      fallApertures,
      fallCatchments,
      basins,
      waterBasins: basins,
      hazardSurfaces,
      controllers,
      controls,
      mechanisms,
      encounterAnchors: (encounterBlueprints[spec.id] ?? []).map((entry) => ({ ...entry, forward: vector(0, 0, 1), surfaceId: 'surface.main' })),
      rewardAnchors: (rewardBlueprints[spec.id] ?? []).map((entry) => ({ ...entry, forward: vector(0, 0, 1), surfaceId: entry.position.y > 1 ? 'surface.landmark-catwalk' : 'surface.main' })),
      safeAnchors,
      platformPurposes: ['primary-floor', 'supported-landing', 'machinery-traversal', 'walkable-stairs', 'dynamic-traversal'],
      platformPurposeContracts: [
        { id: 'primary-floor', collision: 'static', visibleSupport: 'load-bearing-foundation' },
        { id: 'supported-landing', collision: 'static', visibleSupport: 'braced-landing-columns' },
        { id: 'machinery-traversal', collision: 'static', visibleSupport: 'braced-catwalk-columns' },
        { id: 'walkable-stairs', collision: 'static', visibleSupport: 'continuous-stair-stringers' },
        { id: 'dynamic-traversal', collision: 'dynamic', visibleSupport: 'full-route-mechanism-support' },
      ],
      presentationProfileId,
      materialProfileId,
      presentation: {
        profileId: presentationProfileId,
        sourceAssetFamilyId: authoredDetails?.assetFamilyId ?? null,
        sourceAssetKind: authoredDetails ? 'dungeon-v1' : 'milestone-1-traversal-lab',
        landmarkProfile: spec.landmark ? 'multi-route-functional-landmark-v2' : 'enclosed-functional-chamber-v2',
        routeSignalingProfile: 'industrial-lighting-and-structural-framing-v2',
        exteriorVoidMaskingAllowed: false,
      },
      material: {
        profileId: materialProfileId,
        shellProfileId: `${materialProfileId}.shell`,
        floorProfileId: `${materialProfileId}.floor`,
        supportProfileId: `${materialProfileId}.support`,
        opaqueStructuralShell: true,
      },
      authoredSourceMaterial: authoredDetails?.sourceMaterial ?? 'Milestone 1 traversal-lab structural kit',
      authoredAssetFamilyId: authoredDetails?.assetFamilyId ?? null,
      authoredFunctionalFixtures: fixtureBlueprints,
    });
  });
}

export const GOLDEN_MODULE_DESCRIPTORS_V2 = deepFreezePlan(makeModuleDescriptors(GOLDEN_REGION_SPECS, GOLDEN_CONNECTION_SPECS));
export const TRAVERSAL_LAB_MODULE_DESCRIPTORS_V2 = deepFreezePlan(makeModuleDescriptors(LAB_REGION_SPECS, LAB_CONNECTION_SPECS));

function makeModulePlacements(regionSpecs, descriptors) {
  const descriptorByRegion = new Map(descriptors.map((entry) => [entry.id.split('.')[1], entry]));
  return regionSpecs.map((spec) => {
    const descriptor = descriptorByRegion.get(spec.id);
    return {
      id: `placement.${spec.id}`,
      descriptorId: descriptor.id,
      descriptorRevision: descriptor.revision,
      regionIds: [spec.id],
      translation: vector(spec.center.x, spec.floorY, spec.center.z),
      yawQuarterTurns: 0,
      bounds: boundsForSpec(spec),
      topologySignature: spec.topologySignature,
      occupiedCellIds: spec.landmark
        ? [cellId(spec.id), `cell.${spec.id}.process-alcove`, `cell.${spec.id}.inspection-vault`]
        : [cellId(spec.id)],
    };
  });
}

function anchor(regionById, id, regionId, purpose, offset = {}, extras = {}) {
  const spec = regionById.get(regionId);
  return {
    id,
    regionId,
    position: vector(spec.center.x + Number(offset.x ?? 0), spec.floorY + Number(offset.y ?? 0) + 0.35, spec.center.z + Number(offset.z ?? 0)),
    forward: vector(Number(extras.forwardX ?? 0), 0, Number(extras.forwardZ ?? 1)),
    purpose,
    surfaceId: surfaceId(regionId),
    safeSurfaceId: surfaceId(regionId),
    hazardTag: null,
    ...extras,
  };
}

function addMechanismAndHazardSurfaces(spatial, regionSpecs, mechanisms, environmentStates, portals) {
  const regionById = new Map(regionSpecs.map((entry) => [entry.id, entry]));
  const existing = new Set(spatial.walkableSurfaces.map((entry) => entry.id));
  for (const mechanism of mechanisms) {
    const platformHalfExtent = Number(mechanism.runtimeProfile?.platformHalfExtent ?? 3.4);
    if (mechanism.type === 'water-router') {
      const spec = regionById.get(mechanism.regionId);
      const routerSurfaceId = surfaceId(mechanism.regionId, 'router-catwalk');
      if (spec && !existing.has(routerSurfaceId)) {
        const y = spec.floorY + 4;
        const supportFixtureId = `fixture.${mechanism.regionId}.router-support`;
        spatial.structuralFixtures.push({
          id: supportFixtureId,
          type: 'structural-support',
          regionId: spec.id,
          cellId: cellId(spec.id),
          bounds: { min: vector(spec.center.x - 1, spec.floorY, spec.center.z - 9), max: vector(spec.center.x + 1, y, spec.center.z - 7) },
          materialProfileId: 'waterworks-router-support-v2',
          visualProfile: 'braced-dry-router-columns-v2',
          collision: 'blocking',
          supportBoundaryIds: [boundaryId(spec.id, 'floor')],
          gameplayPurpose: 'keeps the master water router permanently above and outside every basin',
        });
        spatial.walkableSurfaces.push({
          id: routerSurfaceId,
          regionId: spec.id,
          cellId: cellId(spec.id),
          bounds: { min: vector(spec.center.x - 4, y, spec.center.z - 11), max: vector(spec.center.x + 4, y + 0.3, spec.center.z - 6) },
          purpose: 'permanently dry master-router catwalk',
          supportBoundaryIds: [boundaryId(spec.id, 'floor')],
          supportFixtureIds: [supportFixtureId],
          supportProfile: 'braced-dry-router-columns-v2',
          visualProfile: 'waterworks:dry-router-catwalk-v2',
          collision: 'static',
          hazardTag: null,
        });
        const stairSurfaceId = surfaceId(mechanism.regionId, 'router-stairs');
        spatial.walkableSurfaces.push({
          id: stairSurfaceId,
          regionId: spec.id,
          cellId: cellId(spec.id),
          bounds: {
            min: vector(spec.center.x - 2, spec.floorY, spec.center.z - 8),
            max: vector(spec.center.x + 2, y + 0.3, spec.center.z + 5),
          },
          purpose: 'continuous walking stair access to permanent dry router',
          supportBoundaryIds: [boundaryId(spec.id, 'floor')],
          supportProfile: 'continuous-stair-stringers-v2',
          visualProfile: 'waterworks:router-stairs-v2',
          collision: 'static',
          hazardTag: null,
          geometry: {
            type: 'stairs',
            path: [
              vector(spec.center.x, spec.floorY, spec.center.z + 5),
              vector(spec.center.x, y, spec.center.z - 8),
            ],
            maxRiser: 0.18,
            minimumTread: 0.45,
            width: 3.2,
            ledgeClimbDisabled: true,
          },
        });
        spatial.traversalLinks.push({ id: `traversal.${mechanism.regionId}.router`, regionId: spec.id, fromSurfaceId: surfaceId(spec.id), toSurfaceId: routerSurfaceId, viaSurfaceId: stairSurfaceId, mode: 'walkable-stairs', bidirectional: true, minimumWidth: 3.2 });
        existing.add(routerSurfaceId);
      }
    }
    if (mechanism.type === 'cargo-lift') {
      for (const state of mechanism.states ?? []) {
        if (!state.stable || !state.position || !state.landingSurfaceId || existing.has(state.landingSurfaceId)) continue;
        const landingSpec = regionById.get(state.regionId ?? mechanism.regionId);
        if (!landingSpec) continue;
        const surfaceY = Number(state.surfaceY ?? state.position.y);
        const landingSide = mechanism.runtimeProfile?.landingSide === 'west' ? 'west' : 'east';
        const landingBounds = {
          min: vector(
            landingSide === 'west'
              ? state.position.x - platformHalfExtent - 4
              : state.position.x + platformHalfExtent,
            surfaceY,
            state.position.z - 3,
          ),
          max: vector(
            landingSide === 'west'
              ? state.position.x - platformHalfExtent
              : state.position.x + platformHalfExtent + 4,
            surfaceY + 0.35,
            state.position.z + 3,
          ),
        };
        spatial.walkableSurfaces.push({
          id: state.landingSurfaceId,
          regionId: landingSpec.id,
          cellId: cellId(landingSpec.id),
          bounds: landingBounds,
          purpose: `${mechanism.id} ${state.id} static useful landing beside a dedicated recall-console pad`,
          supportBoundaryIds: [boundaryId(landingSpec.id, 'floor')],
          supportProfile: 'load-bearing-terminal-foundation-v2',
          visualProfile: 'mechanism:cargo-lift:terminal-landing-v2',
          collision: 'static',
          hazardTag: null,
          interactionSurfaceRole: 'terminal-landing',
          terminalForMechanismId: mechanism.id,
          terminalStateId: state.id,
        });
        const landingTopY = landingBounds.max.y;
        const approachSurface = spatial.walkableSurfaces
          .filter((surface) => surface.id !== state.landingSurfaceId
            && surface.regionId === landingSpec.id
            && surface.collision !== 'dynamic'
            && Math.abs(surface.bounds.max.y - landingTopY) <= 0.5)
          .map((surface) => {
            const gapX = Math.max(
              surface.bounds.min.x - landingBounds.max.x,
              landingBounds.min.x - surface.bounds.max.x,
              0,
            );
            const gapZ = Math.max(
              surface.bounds.min.z - landingBounds.max.z,
              landingBounds.min.z - surface.bounds.max.z,
              0,
            );
            return { surface, gap: Math.hypot(gapX, gapZ) };
          })
          .filter(({ gap }) => gap <= 0.21)
          .sort((left, right) => left.gap - right.gap || left.surface.id.localeCompare(right.surface.id))[0]
          ?.surface;
        if (!approachSurface) {
          throw new Error(`${mechanism.id}:${state.id} landing has no physically touching static approach surface.`);
        }
        spatial.traversalLinks.push({
          id: `traversal.${mechanism.id}.${state.id}.static-approach`,
          regionId: landingSpec.id,
          fromSurfaceId: approachSurface.id,
          toSurfaceId: state.landingSurfaceId,
          mode: 'walk',
          bidirectional: true,
          minimumWidth: 2.4,
        });
        existing.add(state.landingSurfaceId);
      }
    }
    const dynamicSurfaceId = mechanism.runtimeProfile?.dynamicSurfaceId;
    const spec = regionById.get(mechanism.regionId);
    if (!dynamicSurfaceId || !spec || existing.has(dynamicSurfaceId)) continue;
    // Remove graph-only legacy edges contributed while the portal shell was
    // being laid out. Dynamic traversal is legal only at an authored stable
    // pose, through the exact conditioned boarding links below.
    for (let index = spatial.traversalLinks.length - 1; index >= 0; index -= 1) {
      const link = spatial.traversalLinks[index];
      const hasExactState = (link.conditions ?? []).some((condition) => (
        condition.op === 'stateEquals' && condition.variableId === `${mechanism.id}.state`
      ));
      if (link.mechanismId === mechanism.id && !hasExactState) spatial.traversalLinks.splice(index, 1);
    }
    const initialState = mechanism.states?.find((entry) => entry.id === mechanism.initialStateId);
    const stateHeight = mechanism.states
      ?.map((entry) => Number(entry.surfaceY ?? entry.elevation))
      .find(Number.isFinite);
    const initialPositionY = Number(initialState?.position?.y);
    const y = Number.isFinite(stateHeight) ? stateHeight
      : Number.isFinite(initialPositionY) ? initialPositionY : spec.floorY + 3.5;
    const initialX = Number(initialState?.position?.x ?? spec.center.x);
    const initialZ = Number(initialState?.position?.z ?? spec.center.z);
    const stablePositions = (mechanism.states ?? [])
      .filter((state) => state.stable !== false && state.position)
      .map((state) => ({
        id: state.id,
        x: Number(state.position.x),
        y: Number(state.surfaceY ?? state.elevation ?? state.position.y),
        z: Number(state.position.z),
      }))
      .filter((position) => [position.x, position.y, position.z].every(Number.isFinite));
    const routePositions = stablePositions.length > 0
      ? stablePositions
      : [{ id: mechanism.initialStateId, x: initialX, y, z: initialZ }];
    const supportClearance = 0.8;
    const frameHalfExtent = platformHalfExtent + supportClearance;
    const routeMinX = Math.min(...routePositions.map((position) => position.x));
    const routeMaxX = Math.max(...routePositions.map((position) => position.x));
    const routeMinY = Math.min(...routePositions.map((position) => position.y));
    const routeMaxY = Math.max(...routePositions.map((position) => position.y));
    const routeMinZ = Math.min(...routePositions.map((position) => position.z));
    const routeMaxZ = Math.max(...routePositions.map((position) => position.z));
    const supportBottomY = Math.min(spec.floorY, routeMinY);
    const supportTopY = Math.max(routeMaxY + 3.8, supportBottomY + 1);
    const supportBounds = {
      min: vector(routeMinX - frameHalfExtent, supportBottomY, routeMinZ - frameHalfExtent),
      max: vector(routeMaxX + frameHalfExtent, supportTopY, routeMaxZ + frameHalfExtent),
    };
    const supportFixtureId = `fixture.${mechanism.id}.support`;
    spatial.structuralFixtures.push({
      id: supportFixtureId,
      type: mechanism.type === 'moving-cargo' ? 'overhead-track-support' : 'mechanism-shaft-support',
      regionId: spec.id,
      cellId: cellId(spec.id),
      bounds: supportBounds,
      materialProfileId: `mechanism.${mechanism.type}`,
      visualProfile: mechanism.type === 'moving-cargo' ? 'overhead-track-and-braces-v2' : 'telescoping-industrial-support-v2',
      collision: 'blocking',
      supportBoundaryIds: [boundaryId(spec.id, 'floor')],
      mechanismId: mechanism.id,
      supportedStateIds: routePositions.map((position) => position.id),
      supportedRouteBounds: {
        min: vector(routeMinX - platformHalfExtent, routeMinY, routeMinZ - platformHalfExtent),
        max: vector(routeMaxX + platformHalfExtent, routeMaxY + 0.35, routeMaxZ + platformHalfExtent),
      },
      platformHalfExtent,
      supportClearance,
      overheadRailY: mechanism.type === 'moving-cargo' ? supportTopY : null,
      gameplayPurpose: `visible full-route support for every stable pose of ${mechanism.id}`,
    });
    const mechanismPortal = portals.find((portal) => portal.mechanismId === mechanism.id
      && ['lift', 'moving-platform', 'gear-platform'].includes(portal.approachType));
    if (mechanism.type === 'cargo-lift' && mechanismPortal?.physicalRoute) {
      const stateForRegion = (regionId) => (mechanism.states ?? [])
        .filter((state) => state.stable !== false
          && state.regionId === regionId
          && state.position
          && state.landingSurfaceId)
        .sort((left, right) => left.id.localeCompare(right.id))[0];
      const fromState = stateForRegion(mechanismPortal.from.regionId);
      const toState = stateForRegion(mechanismPortal.to.regionId);
      const pointForState = (state) => vector(
        Number(state.position.x),
        Number(state.surfaceY ?? state.position.y) + 0.35,
        Number(state.position.z),
      );
      const landingPoint = (state) => {
        const landing = spatial.walkableSurfaces.find((surface) => surface.id === state?.landingSurfaceId);
        return landing ? vector(
          (landing.bounds.min.x + landing.bounds.max.x) * 0.5,
          landing.bounds.max.y,
          (landing.bounds.min.z + landing.bounds.max.z) * 0.5,
        ) : null;
      };
      if (fromState && toState) {
        const existingRoute = mechanismPortal.physicalRoute.routePoints ?? [];
        mechanismPortal.physicalRoute.routePoints = dedupeRoutePoints([
          landingPoint(fromState),
          pointForState(fromState),
          ...existingRoute,
          pointForState(toState),
          landingPoint(toState),
        ].filter(Boolean));
        mechanismPortal.physicalRoute.endpointSurfaceIds = {
          from: fromState.landingSurfaceId,
          to: toState.landingSurfaceId,
        };
        const routeStates = [fromState, toState];
        mechanismPortal.physicalRoute.fullHeightShaftBounds = {
          min: vector(
            Math.min(...routeStates.map((state) => Number(state.position.x)))
              - platformHalfExtent - PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
            Math.min(...routeStates.map((state) => Number(state.surfaceY ?? state.position.y))),
            Math.min(...routeStates.map((state) => Number(state.position.z)))
              - platformHalfExtent - PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
          ),
          max: vector(
            Math.max(...routeStates.map((state) => Number(state.position.x)))
              + platformHalfExtent + PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
            Math.max(...routeStates.map((state) => Number(state.surfaceY ?? state.position.y))) + 0.35 + 3.2,
            Math.max(...routeStates.map((state) => Number(state.position.z)))
              + platformHalfExtent + PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
          ),
        };
        mechanismPortal.physicalRoute.fullHeightShaftBoundsProfile = {
          semantics: 'moving-deck-plus-standing-player-capsule-union',
          horizontalExpansion: PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
          minimumHeadroom: 3.2,
        };
        const connectorCellId = mechanismPortal.physicalRoute.cellIds.length === 1
          ? mechanismPortal.physicalRoute.cellIds[0]
          : null;
        const boardingSide = mechanism.runtimeProfile?.landingSide === 'west' ? 'west' : 'east';
        const boardingBoundary = connectorCellId
          ? spatial.structuralBoundaries.find((boundary) => (
              boundary.cellId === connectorCellId && boundary.side === boardingSide
            ))
          : null;
        if (!boardingBoundary) {
          throw new Error(`${mechanism.id} has no ${boardingSide} shaft wall for its authored landing openings.`);
        }
        const boardingPlane = boardingSide === 'west'
          ? boardingBoundary.bounds.max.x
          : boardingBoundary.bounds.min.x;
        for (const state of routeStates) {
          const deckTopY = Number(state.surfaceY ?? state.position.y) + 0.35;
          const openingTopY = deckTopY + mechanismPortal.traversal.minimumHeadroom;
          // Some vertical portals represent only the thin interface between
          // already-adjacent rooms (the traversal lab's upper landing). Their
          // shaft side wall does not extend down to the lower in-room pose, so
          // projecting a full-height opening outside that wall corrupts its
          // closed face. Carve only stable landing apertures actually owned by
          // this connector boundary; the room shell owns all other poses.
          if (deckTopY < boardingBoundary.bounds.min.y - 0.001
            || openingTopY > boardingBoundary.bounds.max.y + 0.001) continue;
          boardingBoundary.openings.push({
            id: `opening.${mechanismPortal.id.replace('portal.', '')}.boarding-${state.id}`,
            portalId: mechanismPortal.id,
            mechanismId: mechanism.id,
            stateId: state.id,
            center: vector(
              boardingPlane,
              deckTopY + mechanismPortal.traversal.minimumHeadroom * 0.5,
              Number(state.position.z),
            ),
            dimensions: {
              width: platformHalfExtent * 2,
              height: mechanismPortal.traversal.minimumHeadroom,
              depth: 0.4,
            },
            purpose: 'full player/camera-clear side opening between the automatic lift and its useful landing',
          });
          boardingBoundary.kind = 'portal-frame';
        }
      }
    }
    const dynamicCellId = mechanismPortal?.physicalRoute?.cellIds?.length === 1
      ? mechanismPortal.physicalRoute.cellIds[0]
      : cellId(spec.id);
    spatial.walkableSurfaces.push({
      id: dynamicSurfaceId,
      regionId: spec.id,
      cellId: dynamicCellId,
      bounds: { min: vector(initialX - platformHalfExtent, y, initialZ - platformHalfExtent), max: vector(initialX + platformHalfExtent, y + 0.35, initialZ + platformHalfExtent) },
      purpose: mechanism.runtimeProfile.purpose ?? `purposeful ${mechanism.type} traversal between authored landings`,
      supportBoundaryIds: [boundaryId(spec.id, 'floor')],
      supportFixtureIds: [supportFixtureId],
      supportProfile: mechanism.type === 'moving-cargo' ? 'overhead-track-and-braces-v2' : 'telescoping-industrial-support-v2',
      visualProfile: `mechanism:${mechanism.type}:platform-v2`,
      collision: 'dynamic',
      hazardTag: null,
      mechanismId: mechanism.id,
      geometry: {
        type: mechanism.type,
        automatic: mechanism.automaticTravel === true,
        recallable: mechanism.recallable === true,
        elevated: y >= spec.floorY + 1,
        stableStateIds: routePositions.map((position) => position.id),
        routeBounds: {
          min: vector(routeMinX - platformHalfExtent, routeMinY, routeMinZ - platformHalfExtent),
          max: vector(routeMaxX + platformHalfExtent, routeMaxY + 0.35, routeMaxZ + platformHalfExtent),
        },
      },
    });
    if (['cargo-lift', 'moving-cargo', 'corkscrew-gear'].includes(mechanism.type)) {
      for (const state of mechanism.states ?? []) {
        if (state.stable === false || !state.landingSurfaceId) continue;
        const landing = spatial.walkableSurfaces.find((surface) => surface.id === state.landingSurfaceId);
        if (!landing) throw new Error(`${mechanism.id}:${state.id} has no authored static landing.`);
        const dynamicTopY = Number(state.surfaceY ?? state.elevation ?? state.position?.y) + 0.35;
        const landingCenter = vector(
          (landing.bounds.min.x + landing.bounds.max.x) * 0.5,
          landing.bounds.max.y,
          (landing.bounds.min.z + landing.bounds.max.z) * 0.5,
        );
        const cargoLandingSide = mechanism.runtimeProfile?.landingSide === 'west' ? 'west' : 'east';
        const landingEgressX = cargoLandingSide === 'west'
          ? landing.bounds.max.x - 1.2
          : landing.bounds.min.x + 1.2;
        // Recall consoles sit on the negative-Z side of each terminal pad.
        // The stable-pose route therefore walks to the open positive-Z half
        // of the landing instead of steering the player into a console at the
        // centerline. Twenty-two intervals produce the audited 23 grounded
        // samples while retaining <=0.21m spacing.
        const egressPoints = mechanism.type === 'cargo-lift' ? [
          vector(Number(state.position.x), dynamicTopY, Number(state.position.z)),
          vector(landingEgressX, landingCenter.y, landingCenter.z + 1.2),
        ] : null;
        spatial.traversalLinks.push({
          id: `traversal.${mechanism.id}.${state.id}.boarding`,
          regionId: landing.regionId,
          fromSurfaceId: state.landingSurfaceId,
          toSurfaceId: dynamicSurfaceId,
          mode: mechanism.type,
          bidirectional: true,
          mechanismId: mechanism.id,
          portalId: mechanismPortal?.id ?? null,
          minimumWidth: 1.2,
          conditions: [{
            op: 'stateEquals',
            variableId: `${mechanism.id}.state`,
            value: state.id,
          }],
          egressRoute: egressPoints ? {
            direction: 'dynamic-to-static',
            points: egressPoints,
            sampleSpacing: 0.21,
            sampleCount: 23,
            jumpRequired: false,
            consoleClear: true,
          } : null,
        });
      }
    } else {
      spatial.traversalLinks.push({ id: `traversal.${mechanism.id}`, regionId: spec.id, fromSurfaceId: surfaceId(spec.id), toSurfaceId: dynamicSurfaceId, mode: mechanism.type, bidirectional: true, mechanismId: mechanism.id, minimumWidth: 1.2 });
    }
    if (mechanism.id === 'mechanism.lab-auto-cargo') {
      const main = spatial.walkableSurfaces.find((surface) => surface.id === surfaceId('lab-upper'));
      const landing = spatial.walkableSurfaces.find((surface) => surface.id === 'surface.lab-upper.landing-lab-upper-gear');
      const stairId = 'surface.lab-upper.auto-cargo-terminal-stairs';
      if (!main || !landing) throw new Error('Lab automatic cargo requires its main deck and Near terminal landing.');
      const start = vector(main.bounds.max.x - 8, main.bounds.max.y, main.bounds.max.z - 5);
      const end = vector(landing.bounds.min.x + STAIR_ENDPOINT_OVERLAP, landing.bounds.max.y, (landing.bounds.min.z + landing.bounds.max.z) * 0.5);
      spatial.walkableSurfaces.push({
        id: stairId,
        regionId: 'lab-upper',
        cellId: cellId('lab-upper'),
        bounds: {
          min: vector(Math.min(start.x, end.x) - 1.6, main.bounds.min.y, Math.min(start.z, end.z) - 1.6),
          max: vector(Math.max(start.x, end.x) + 1.6, landing.bounds.max.y, Math.max(start.z, end.z) + 1.6),
        },
        purpose: 'continuous walking stair from the upper gallery to the useful automatic-cargo Near terminal',
        supportBoundaryIds: [boundaryId('lab-upper', 'floor')],
        supportProfile: 'continuous-stair-stringers-v2',
        visualProfile: 'traversal-lab:auto-cargo-terminal-stairs-v2',
        collision: 'static',
        hazardTag: null,
        geometry: {
          type: 'stairs',
          path: [start, end],
          maxRiser: 0.18,
          minimumTread: 0.45,
          width: 3.2,
          ledgeClimbDisabled: true,
          endpointSurfaceIds: { start: main.id, end: landing.id },
          minimumEndpointOverlap: STAIR_ENDPOINT_OVERLAP,
          maximumEndpointHeightDelta: STAIR_ENDPOINT_HEIGHT_TOLERANCE,
        },
      });
      spatial.traversalLinks.push({
        id: 'traversal.lab-upper.auto-cargo-terminal-stairs',
        regionId: 'lab-upper',
        fromSurfaceId: main.id,
        toSurfaceId: landing.id,
        viaSurfaceId: stairId,
        mode: 'walkable-stairs',
        bidirectional: true,
        minimumWidth: 3.2,
        maximumRiser: 0.18,
        minimumTread: 0.45,
      });
      existing.add(stairId);
    }
    existing.add(dynamicSurfaceId);
  }

  for (const environment of environmentStates.filter((entry) => entry.hazardTag)) {
    for (const [index, surfaceContract] of (environment.surfaces ?? []).entries()) {
      if (existing.has(surfaceContract.surfaceId)) continue;
      const spec = regionById.get(surfaceContract.regionId);
      if (!spec) continue;
      const halfX = Number(surfaceContract.size?.x ?? spec.size.x * 0.32) / 2;
      const halfZ = Number(surfaceContract.size?.z ?? spec.size.z * 0.45) / 2;
      const offsetX = Number(surfaceContract.offset?.x ?? 0);
      const offsetZ = Number(surfaceContract.offset?.z ?? (index ? spec.size.z * 0.2 : -spec.size.z * 0.2));
      spatial.walkableSurfaces.push({
        id: surfaceContract.surfaceId,
        regionId: spec.id,
        cellId: cellId(spec.id),
        bounds: { min: vector(spec.center.x + offsetX - halfX, spec.floorY + 0.36, spec.center.z + offsetZ - halfZ), max: vector(spec.center.x + offsetX + halfX, spec.floorY + 0.48, spec.center.z + offsetZ + halfZ) },
        purpose: `telegraphed ${environment.type} hazard field with a separate damage-free route`,
        supportBoundaryIds: [boundaryId(spec.id, 'floor')],
        supportProfile: 'hazard-panel-foundation-v2',
        visualProfile: `hazard:${environment.type}:telegraphed-v2`,
        collision: 'static',
        hazardTag: environment.hazardTag,
        environmentStateId: environment.id,
      });
      existing.add(surfaceContract.surfaceId);
    }
  }
}

function buildGoldenContent(regionSpecs, hazardType, seedStreams) {
  const regionById = new Map(regionSpecs.map((entry) => [entry.id, entry]));
  const anchors = [
    anchor(regionById, 'anchor.player-start', 'security', 'player start and Key Seeker station', { x: -8 }),
    anchor(regionById, 'anchor.key-seeker', 'security', 'Key Seeker pickup', { x: -3, z: 4 }),
    anchor(regionById, 'anchor.key.alpha', 'server', 'remote Alpha pedestal in the raised Server Crypt inspection vault', { x: 8, y: 3.95, z: 6 }, { surfaceId: 'surface.server.inspection-vault', safeSurfaceId: 'surface.server.inspection-vault' }),
    anchor(regionById, 'anchor.key.beta', 'salvage-tunnel', 'drained-only Beta pedestal', { x: 8, z: 5 }),
    anchor(regionById, 'anchor.key.gamma', 'hazard-core', 'Gamma pedestal beyond the hazard route', { x: 12, y: 3.95, z: 8 }, { surfaceId: 'surface.hazard-core.inspection-vault', safeSurfaceId: 'surface.hazard-core.inspection-vault' }),
    // Progression consoles sit on the edge of their six-metre landings and
    // face back toward the clear centre lane.  The former Alpha/Beta anchors
    // were on the portal centreline, so their 2.5m support pads became both a
    // physical obstruction and a convenient vaulting target in front of the
    // still-closed gate.  East/west gates also inherited +Z facing even though
    // that was perpendicular to their only usable approach.
    anchor(regionById, 'anchor.gate.alpha', 'security', 'side-mounted Alpha gate console', { x: 0.75, y: 3.95, z: -8 }, { forwardX: 1, forwardZ: 0, surfaceId: 'surface.security.landing-security-sorting-alpha', safeSurfaceId: 'surface.security.landing-security-sorting-alpha' }),
    anchor(regionById, 'anchor.gate.beta', 'sorting', 'side-mounted Beta pressure gate console', { x: 18, y: 4.95, z: 12.25 }, { forwardZ: -1, surfaceId: 'surface.sorting.landing-sorting-credential-beta', safeSurfaceId: 'surface.sorting.landing-sorting-credential-beta' }),
    anchor(regionById, 'anchor.gate.gamma', 'corkscrew', 'side-mounted Gamma blast gate console', { x: 19.5, y: 4.95, z: -5.75 }, { forwardZ: -1, surfaceId: 'surface.corkscrew.landing-corkscrew-machine-core-gamma', safeSurfaceId: 'surface.corkscrew.landing-corkscrew-machine-core-gamma' }),
    anchor(regionById, 'anchor.gate.shrine', 'machine-core', 'Shrine gate console beside the raised approach stair', { x: 19.5, y: 3.95, z: 14.25 }, { forwardZ: -1, surfaceId: 'surface.machine-core.landing-machine-core-extraction-shrine', safeSurfaceId: 'surface.machine-core.landing-machine-core-extraction-shrine' }),
    anchor(regionById, 'anchor.shortcut.alpha', 'freight', 'side-mounted Alpha ladder shortcut release', { x: -14, y: 1.95, z: 10.25 }, { forwardX: -1, forwardZ: -1, surfaceId: 'surface.freight.landing-freight-security-shortcut', safeSurfaceId: 'surface.freight.landing-freight-security-shortcut' }),
    anchor(regionById, 'anchor.shortcut.beta', 'salvage-tunnel', 'cargo lift shortcut release beside the lower walkway', { x: -10, y: 0, z: -7 }),
    anchor(regionById, 'anchor.shortcut.gamma', 'hazard-core', 'Gamma shortcut release on the safe island beside the return lift', { x: 6.8, y: 0, z: -9.5 }, { surfaceId: 'surface.mechanism.gamma-return-lift.landing.lower', safeSurfaceId: 'surface.mechanism.gamma-return-lift.landing.lower', forwardZ: -1 }),
    anchor(regionById, 'anchor.shortcut.credential-loop', 'corkscrew', 'side-mounted one-way credential return shortcut release', { x: -19.5, y: 3.95, z: 9.25 }, { forwardZ: 1, surfaceId: 'surface.corkscrew.landing-corkscrew-credential-loop', safeSurfaceId: 'surface.corkscrew.landing-corkscrew-credential-loop' }),
    anchor(regionById, 'anchor.cargo-lift.lower-console', 'salvage-tunnel', 'lower cargo lift recall console beside the walkway', { x: 11.2, y: 0, z: -4 }, { surfaceId: 'surface.mechanism.cargo-lift.landing.lower', safeSurfaceId: 'surface.mechanism.cargo-lift.landing.lower' }),
    anchor(regionById, 'anchor.cargo-lift.upper-console', 'sorting', 'upper cargo lift recall console beside the walkway', { x: 11.2, y: 0, z: -4 }, { surfaceId: 'surface.mechanism.cargo-lift.landing.upper', safeSurfaceId: 'surface.mechanism.cargo-lift.landing.upper' }),
    anchor(regionById, 'anchor.gamma-lift.lower-console', 'hazard-core', 'lower return lift console on the safe island', { x: 6.8, y: 0, z: -12 }, { surfaceId: 'surface.mechanism.gamma-return-lift.landing.lower', safeSurfaceId: 'surface.mechanism.gamma-return-lift.landing.lower' }),
    anchor(regionById, 'anchor.gamma-lift.upper-console', 'credential', 'upper return lift console beside the landing', { x: 6.8, y: 0, z: -12 }, { surfaceId: 'surface.mechanism.gamma-return-lift.landing.upper', safeSurfaceId: 'surface.mechanism.gamma-return-lift.landing.upper' }),
    anchor(regionById, 'anchor.water-router.freight', 'reservoir', 'permanently dry Freight Sump selector', { x: -2.5, y: 3.95, z: -8 }, { surfaceId: surfaceId('reservoir', 'router-catwalk'), safeSurfaceId: surfaceId('reservoir', 'router-catwalk') }),
    anchor(regionById, 'anchor.water-router.reservoir', 'reservoir', 'permanently dry Reservoir selector', { x: 0, y: 3.95, z: -8 }, { surfaceId: surfaceId('reservoir', 'router-catwalk'), safeSurfaceId: surfaceId('reservoir', 'router-catwalk') }),
    anchor(regionById, 'anchor.water-router.gantry', 'reservoir', 'permanently dry Gantry Sump selector', { x: 2.5, y: 3.95, z: -8 }, { surfaceId: surfaceId('reservoir', 'router-catwalk'), safeSurfaceId: surfaceId('reservoir', 'router-catwalk') }),
    anchor(regionById, 'anchor.gear.low', 'corkscrew', 'Low terminal recall beside the service alcove', { x: -7.7, y: -0.05, z: -7.48 }, { surfaceId: surfaceId('corkscrew', 'process-alcove'), safeSurfaceId: surfaceId('corkscrew', 'process-alcove') }),
    anchor(regionById, 'anchor.gear.bridge', 'corkscrew', 'Bridge terminal recall on the clear central inspection catwalk', { x: 0, y: 3.95, z: 2 }, { surfaceId: surfaceId('corkscrew', 'landmark-catwalk'), safeSurfaceId: surfaceId('corkscrew', 'landmark-catwalk') }),
    anchor(regionById, 'anchor.gear.high', 'corkscrew', 'High terminal recall on the south-east service pad clear of the complete gear sweep and Gamma passage', { x: 19.5, y: 4.95, z: -14.25 }, { surfaceId: surfaceId('corkscrew', 'landing-corkscrew-machine-core-gamma'), safeSurfaceId: surfaceId('corkscrew', 'landing-corkscrew-machine-core-gamma') }),
    anchor(regionById, 'anchor.encounter.assembly', 'assembly', 'assembly encounter center', { x: 7, z: 5 }, { surfaceId: 'surface.assembly.floor-south', safeSurfaceId: 'surface.assembly.floor-south' }),
    anchor(regionById, 'anchor.encounter.sorting', 'sorting', 'sorting encounter center', { x: -5, z: 5 }),
    anchor(regionById, 'anchor.encounter.nest', 'nest', 'optional nest encounter center'),
    anchor(regionById, 'anchor.encounter.machine-core', 'machine-core', 'final elite center'),
    anchor(regionById, 'anchor.cache.alpha', 'server', 'Alpha-zone Reaverbot parts cache in the clear crypt service aisle', { x: -5.5, z: -7.5 }),
    anchor(regionById, 'anchor.cache.water', 'gantry-sump', 'flooded-only Waterworks cache', { x: 8, z: 7 }),
    anchor(regionById, 'anchor.cache.nest', 'nest', 'optional nest cache', { x: 10, z: -8 }),
    anchor(regionById, 'anchor.cache.undercroft', 'hazard-core', 'Undercroft major cache on a safe island', { x: -10, z: 8 }),
    anchor(regionById, 'anchor.reward.shrine-key', 'machine-core', 'final elite Shrine Key reward'),
    anchor(regionById, 'anchor.refractor', 'extraction', 'Large Refractor dais', { x: -5 }),
    anchor(regionById, 'anchor.extraction', 'extraction', 'extraction pad', { x: 8, y: 1, z: 3 }),
    anchor(regionById, 'anchor.safe-return', 'extraction', 'post-Refractor safe return anchor', { x: -10, z: -6 }),
    anchor(regionById, 'anchor.discovery.flooded', 'freight-sump', 'flooded-only Waterworks discovery', { x: 8, z: -8 }),
    anchor(regionById, 'anchor.discovery.drained', 'salvage-tunnel', 'drained-only Waterworks discovery', { x: -8, z: 7 }),
  ];

  const encounters = [
    encounter(seedStreams, 'encounter.assembly', 'assembly', 'anchor.encounter.assembly', true, false, 'assembly-pump-crossfire-v1', false, regionById.get('assembly')),
    encounter(seedStreams, 'encounter.sorting', 'sorting', 'anchor.encounter.sorting', true, false, 'sorting-gantry-ambush-v1', false, regionById.get('sorting')),
    encounter(seedStreams, 'encounter.nest', 'nest', 'anchor.encounter.nest', false, true, 'nest-warehouse-defense-v1', false, regionById.get('nest')),
    encounter(seedStreams, 'encounter.machine-core', 'machine-core', 'anchor.encounter.machine-core', true, false, 'machine-core-final-elite-v1', true, regionById.get('machine-core')),
  ];

  const rewards = [
    reward(seedStreams, 'reward.key-seeker', 'key-seeker', 'security', 'anchor.key-seeker'),
    reward(seedStreams, 'reward.keycard-alpha', 'keycard', 'server', 'anchor.key.alpha', { keyId: 'Keycard_Alpha' }),
    reward(seedStreams, 'reward.keycard-beta', 'keycard', 'salvage-tunnel', 'anchor.key.beta', { keyId: 'Keycard_Beta' }),
    reward(seedStreams, 'reward.keycard-gamma', 'keycard', 'hazard-core', 'anchor.key.gamma', { keyId: 'Keycard_Gamma' }),
    reward(seedStreams, 'reward.cache.alpha', 'reaverbot-parts-cache', 'server', 'anchor.cache.alpha', {
      salvageBundle: cacheSalvageBundle(seedStreams, 'reward.cache.alpha'),
    }),
    reward(seedStreams, 'reward.cache.water', 'reaverbot-parts-cache', 'gantry-sump', 'anchor.cache.water', {
      discoveryCondition: { op: 'stateEquals', variableId: 'water.unit.configuration', value: 'GantrySumpFilled' },
      salvageBundle: cacheSalvageBundle(seedStreams, 'reward.cache.water'),
    }),
    reward(seedStreams, 'reward.cache.nest', 'reaverbot-parts-cache', 'nest', 'anchor.cache.nest', {
      optional: true,
      conditions: [{ op: 'encounterComplete', encounterId: 'encounter.nest' }],
      salvageBundle: cacheSalvageBundle(seedStreams, 'reward.cache.nest'),
    }),
    reward(seedStreams, 'reward.cache.undercroft', 'major-reaverbot-parts-cache', 'hazard-core', 'anchor.cache.undercroft', {
      salvageBundle: cacheSalvageBundle(seedStreams, 'reward.cache.undercroft', { major: true }),
    }),
    reward(seedStreams, 'reward.shrine-key', 'keycard', 'machine-core', 'anchor.reward.shrine-key', { keyId: 'Shrine_Key', conditions: [{ op: 'encounterComplete', encounterId: 'encounter.machine-core' }], exclusiveSource: true }),
    reward(seedStreams, 'reward.large-refractor', 'large-refractor', 'extraction', 'anchor.refractor', { conditions: [{ op: 'gateOpen', gateId: 'Door_Shrine' }] }),
  ];

  const objectives = [
    { id: 'objective.alpha-expedition', type: 'exploration', regionIds: ['assembly', 'server', 'freight'], required: true, completionConditions: [{ op: 'hasKey', keyId: 'Keycard_Alpha' }, { op: 'gateOpen', gateId: 'Gate_Shortcut_Alpha' }] },
    { id: 'objective.waterworks-expedition', type: 'environment-exploration', regionIds: ['freight-sump', 'reservoir', 'gantry-sump', 'salvage-tunnel'], required: true, completionConditions: [{ op: 'hasKey', keyId: 'Keycard_Beta' }, { op: 'gateOpen', gateId: 'Gate_Shortcut_Beta' }] },
    { id: 'objective.undercroft-expedition', type: 'hazard-exploration', regionIds: ['hazard-intake', 'hazard-core'], required: true, completionConditions: [{ op: 'hasKey', keyId: 'Keycard_Gamma' }, { op: 'rewardCollected', rewardId: 'reward.cache.undercroft' }, { op: 'gateOpen', gateId: 'Gate_Shortcut_Gamma' }] },
    { id: 'objective.final-elite', type: 'encounter', regionIds: ['machine-core'], required: true, completionConditions: [{ op: 'encounterComplete', encounterId: 'encounter.machine-core' }, { op: 'hasKey', keyId: 'Shrine_Key' }] },
    { id: 'objective.large-refractor', type: 'collection', regionIds: ['extraction'], required: true, completionConditions: [{ op: 'rewardCollected', rewardId: 'reward.large-refractor' }] },
    { id: 'objective.extraction', type: 'extraction', regionIds: ['extraction'], required: true, completionConditions: [{ op: 'objectiveComplete', objectiveId: 'objective.large-refractor' }] },
    { id: 'objective.discovery.flooded', type: 'discovery', regionIds: ['freight-sump'], required: false, completionConditions: [{ op: 'stateEquals', variableId: 'water.unit.configuration', value: 'FreightSumpFilled' }] },
    { id: 'objective.discovery.drained', type: 'discovery', regionIds: ['salvage-tunnel'], required: false, completionConditions: [{ op: 'stateEquals', variableId: 'water.unit.configuration', value: 'StoredInReservoir' }] },
  ];

  const actions = [
    { id: 'action.activate.key-seeker', type: 'pickup', anchorId: 'anchor.key-seeker', interaction: pickupInteraction(), conditions: [], effects: [{ op: 'collectReward', rewardId: 'reward.key-seeker' }, { op: 'setState', variableId: 'keySeeker.active', value: true }], barrierIds: [] },
    pickupAction('action.pickup.keycard-alpha', 'anchor.key.alpha', 'reward.keycard-alpha', 'Keycard_Alpha'),
    pickupAction('action.pickup.keycard-beta', 'anchor.key.beta', 'reward.keycard-beta', 'Keycard_Beta'),
    pickupAction('action.pickup.keycard-gamma', 'anchor.key.gamma', 'reward.keycard-gamma', 'Keycard_Gamma'),
    gateAction('action.open.shortcut-alpha', 'anchor.shortcut.alpha', 'Gate_Shortcut_Alpha', 'Keycard_Alpha'),
    gateAction('action.open.door-alpha', 'anchor.gate.alpha', 'Door_Alpha', 'Keycard_Alpha'),
    gateAction('action.open.shortcut-beta', 'anchor.shortcut.beta', 'Gate_Shortcut_Beta', 'Keycard_Beta'),
    gateAction('action.open.door-beta', 'anchor.gate.beta', 'Door_Beta', 'Keycard_Beta'),
    gateAction('action.open.shortcut-gamma', 'anchor.shortcut.gamma', 'Gate_Shortcut_Gamma', 'Keycard_Gamma'),
    gateAction('action.open.door-gamma', 'anchor.gate.gamma', 'Door_Gamma', 'Keycard_Gamma'),
    gateAction('action.open.door-shrine', 'anchor.gate.shrine', 'Door_Shrine', 'Shrine_Key'),
    { id: 'action.open.credential-loop', type: 'gate-control', anchorId: 'anchor.shortcut.credential-loop', interaction: interaction(), conditions: [], effects: [{ op: 'openGate', gateId: 'Gate_Credential_Loop' }], barrierIds: ['Gate_Credential_Loop'] },
    waterAction('action.water.freight-sump', 'anchor.water-router.freight', 'FreightSumpFilled'),
    waterAction('action.water.reservoir', 'anchor.water-router.reservoir', 'StoredInReservoir'),
    waterAction('action.water.gantry-sump', 'anchor.water-router.gantry', 'GantrySumpFilled'),
    mechanismAction('action.gear.align-low', 'anchor.gear.low', 'mechanism.corkscrew-gear', 'LowLanding'),
    mechanismAction('action.gear.align-bridge', 'anchor.gear.bridge', 'mechanism.corkscrew-gear', 'BridgeAligned'),
    mechanismAction('action.gear.align-high', 'anchor.gear.high', 'mechanism.corkscrew-gear', 'HighLanding'),
    mechanismAction('action.cargo-lift.recall-lower', 'anchor.cargo-lift.lower-console', 'mechanism.cargo-lift', 'LowerLanding'),
    mechanismAction('action.cargo-lift.recall-upper', 'anchor.cargo-lift.upper-console', 'mechanism.cargo-lift', 'UpperLanding', [{ op: 'gateOpen', gateId: 'Gate_Shortcut_Beta' }]),
    mechanismAction('action.gamma-lift.recall-lower', 'anchor.gamma-lift.lower-console', 'mechanism.gamma-return-lift', 'LowerLanding'),
    mechanismAction('action.gamma-lift.recall-upper', 'anchor.gamma-lift.upper-console', 'mechanism.gamma-return-lift', 'UpperLanding', [{ op: 'gateOpen', gateId: 'Gate_Shortcut_Gamma' }]),
    { id: 'action.collect.shrine-key', type: 'pickup', anchorId: 'anchor.reward.shrine-key', interaction: pickupInteraction(), conditions: [{ op: 'encounterComplete', encounterId: 'encounter.machine-core' }], effects: [{ op: 'collectReward', rewardId: 'reward.shrine-key' }, { op: 'grantKey', keyId: 'Shrine_Key' }, { op: 'completeObjective', objectiveId: 'objective.final-elite' }], barrierIds: [] },
    { id: 'action.collect.large-refractor', type: 'pickup', anchorId: 'anchor.refractor', interaction: pickupInteraction(), conditions: [{ op: 'gateOpen', gateId: 'Door_Shrine' }], effects: [{ op: 'collectReward', rewardId: 'reward.large-refractor' }, { op: 'collectRefractor', refractorId: 'Large_Refractor' }, { op: 'completeObjective', objectiveId: 'objective.large-refractor' }], barrierIds: [] },
    { id: 'action.extract', type: 'extraction', anchorId: 'anchor.extraction', interaction: pickupInteraction(2.5), conditions: [{ op: 'rewardCollected', rewardId: 'reward.large-refractor' }], effects: [{ op: 'completeObjective', objectiveId: 'objective.extraction' }, { op: 'extract', extractionId: 'extraction.main' }], barrierIds: [] },
    collectRewardAction('action.open.cache-alpha', 'anchor.cache.alpha', 'reward.cache.alpha'),
    collectRewardAction('action.open.cache-water', 'anchor.cache.water', 'reward.cache.water', [{ op: 'stateEquals', variableId: 'water.unit.configuration', value: 'GantrySumpFilled' }]),
    collectRewardAction('action.open.cache-nest', 'anchor.cache.nest', 'reward.cache.nest', [{ op: 'encounterComplete', encounterId: 'encounter.nest' }]),
    collectRewardAction('action.open.cache-undercroft', 'anchor.cache.undercroft', 'reward.cache.undercroft'),
    { id: 'action.discover.flooded', type: 'discovery', anchorId: 'anchor.discovery.flooded', interaction: pickupInteraction(1.6), conditions: [{ op: 'stateEquals', variableId: 'water.unit.configuration', value: 'FreightSumpFilled' }], effects: [{ op: 'discoverRegion', regionId: 'freight-sump' }, { op: 'completeObjective', objectiveId: 'objective.discovery.flooded' }], barrierIds: [] },
    { id: 'action.discover.drained', type: 'discovery', anchorId: 'anchor.discovery.drained', interaction: pickupInteraction(1.6), conditions: [{ op: 'stateEquals', variableId: 'water.unit.configuration', value: 'StoredInReservoir' }], effects: [{ op: 'discoverRegion', regionId: 'salvage-tunnel' }, { op: 'completeObjective', objectiveId: 'objective.discovery.drained' }], barrierIds: [] },
    { id: 'action.complete.alpha-expedition', type: 'objective-complete', anchorId: 'anchor.shortcut.alpha', interaction: { radius: 0, activationSide: 'system' }, conditions: objectives[0].completionConditions, effects: [{ op: 'completeObjective', objectiveId: objectives[0].id }], barrierIds: [] },
    { id: 'action.complete.waterworks-expedition', type: 'objective-complete', anchorId: 'anchor.shortcut.beta', interaction: { radius: 0, activationSide: 'system' }, conditions: objectives[1].completionConditions, effects: [{ op: 'completeObjective', objectiveId: objectives[1].id }], barrierIds: [] },
    { id: 'action.complete.undercroft-expedition', type: 'objective-complete', anchorId: 'anchor.shortcut.gamma', interaction: { radius: 0, activationSide: 'system' }, conditions: objectives[2].completionConditions, effects: [{ op: 'completeObjective', objectiveId: objectives[2].id }], barrierIds: [] },
  ];
  for (const entry of encounters) {
    actions.push({ id: entry.completionActionId, type: 'encounter-complete', anchorId: entry.anchorId, interaction: { radius: 0, activationSide: 'system' }, conditions: [], effects: [{ op: 'completeEncounter', encounterId: entry.id }], barrierIds: [] });
  }

  const rewardActionIds = {
    'reward.key-seeker': 'action.activate.key-seeker',
    'reward.keycard-alpha': 'action.pickup.keycard-alpha',
    'reward.keycard-beta': 'action.pickup.keycard-beta',
    'reward.keycard-gamma': 'action.pickup.keycard-gamma',
    'reward.cache.alpha': 'action.open.cache-alpha',
    'reward.cache.water': 'action.open.cache-water',
    'reward.cache.nest': 'action.open.cache-nest',
    'reward.cache.undercroft': 'action.open.cache-undercroft',
    'reward.shrine-key': 'action.collect.shrine-key',
    'reward.large-refractor': 'action.collect.large-refractor',
  };
  for (const entry of rewards) entry.actionId = rewardActionIds[entry.id];
  for (const entry of objectives) {
    entry.actionId = {
      'objective.alpha-expedition': 'action.complete.alpha-expedition',
      'objective.waterworks-expedition': 'action.complete.waterworks-expedition',
      'objective.undercroft-expedition': 'action.complete.undercroft-expedition',
      'objective.final-elite': 'action.collect.shrine-key',
      'objective.large-refractor': 'action.collect.large-refractor',
      'objective.extraction': 'action.extract',
      'objective.discovery.flooded': 'action.discover.flooded',
      'objective.discovery.drained': 'action.discover.drained',
    }[entry.id];
  }

  const environmentStates = [
    waterEnvironment(regionSpecs),
    hazardEnvironment(hazardType, 'environment.undercroft-hazard', [
      // Leave the Gamma return lift's east service bay permanently dry and
      // damage-free; the hazard deck ends before the moving platform edge.
      { surfaceId: 'surface.hazard-core.hazard-field', regionId: 'hazard-core', offset: { z: -3 }, size: { x: 18, z: 13 } },
    ]),
  ];
  const mechanisms = goldenMechanisms(hazardType);

  return { anchors, encounters, rewards, objectives, actions, environmentStates, mechanisms };
}

function encounter(seedStreams, id, regionId, anchorId, required, optional, spawnPatternId, elite = false, regionSpec = null) {
  const random = seedStreams.encounter(id);
  const roster = elite
    ? ['tank', 'ranged']
    : ['basic', random.chance(0.5) ? 'fast' : 'ranged'];
  const center = regionSpec?.center ?? { x: 0, z: 0 };
  const floorY = regionSpec?.floorY ?? 0;
  const triggerInset = PORTAL_INTERIOR_INGRESS_DEPTH;
  let points;
  let spawnSurfaceIds;
  if (elite) {
    points = [vector(center.x - 3, floorY + 0.35, center.z - 6)];
    spawnSurfaceIds = [`surface.${regionId}.main`];
  } else if (id === 'encounter.assembly') {
    points = [
      // The ground threat owns the clear east circulation floor within
      // starter-Buster range of the accepted portal ingress. V2 encounters
      // use exact plan-owned points, so legacy corner relocation and random
      // spawn jitter must never silently rewrite this combat contract.
      vector(center.x + 14.5, floorY + 0.35, center.z + 7),
      // The second threat is explicitly authored on the raised catwalk, clear
      // of the inspection-vault wall and aligned with the stair-top landing.
      vector(center.x + 5, floorY + 4.3, center.z),
    ];
    spawnSurfaceIds = [
      'surface.assembly.floor-east',
      'surface.assembly.landmark-catwalk',
    ];
  } else if (id === 'encounter.sorting') {
    points = [
      vector(center.x - 2, floorY + 0.35, center.z - 5),
      vector(center.x + 5, floorY + 4.3, center.z),
    ];
    spawnSurfaceIds = [
      'surface.sorting.main',
      'surface.sorting.landmark-catwalk',
    ];
  } else {
    points = [
      vector(center.x - 5, floorY + 0.35, center.z - 3),
      vector(center.x + 5, floorY + 0.35, center.z + 3),
    ];
    spawnSurfaceIds = points.map(() => `surface.${regionId}.main`);
  }
  return {
    id,
    regionId,
    anchorId,
    required,
    optional,
    elite,
    seed: seedStreams.seedFor(`encounter:${id}`),
    kind: elite ? 'final-elite' : optional ? 'optional-nest' : 'ordinary',
    isBoss: elite,
    eliteSlot: elite ? { required: true, intent: 'tank', context: 'machine-core-final-elite', tags: ['final-elite', 'shrine-key-source'] } : null,
    roster,
    spawnPoints: points,
    spawnPlacementMode: 'exact-plan-owned',
    spawnGroundingMode: 'plan-y',
    spawnSurfaceIds,
    spawnClearance: { radius: 0.86, height: 3.2 },
    slotGenerationPolicies: id === 'encounter.assembly' ? [{
      id: 'generation-policy.assembly.elevated-route-safe-v1',
      slotIndex: 1,
      elitePolicy: 'forbid',
      purpose: 'keep the mandatory landmark stair and its upper landing free of route-ejecting attacks',
      protectedTraversalLinkIds: ['traversal.assembly.landmark-stairs'],
      verificationThreatTiers: [1, 2, 3, 4, 5, 6, 7, 8],
      generationContext: {
        archetypeId: 'shieldSentinel',
        bodyPlanId: 'tripod',
        weaponId: 'flameNozzle',
        defenseId: 'directionalShield',
        weakPointId: 'eyeLens',
      },
      capabilityContract: {
        permittedAttackKinds: ['flamethrower'],
        maximumPlayerReactionTier: 0,
        powerfulKnockback: false,
        externalPlayerControl: false,
        routeEjecting: false,
      },
    }] : [],
    entryEngagementContracts: id === 'encounter.assembly' ? [{
      id: 'engagement.assembly.entry-ground',
      spawnPointIndex: 0,
      sourceTraversalLinkId: 'traversal.assembly.landmark-stairs',
      sourcePointRole: 'post-portal-ingress',
      surfaceId: 'surface.assembly.floor-east',
      maximumEngagementRange: 6.7,
      minimumArenaEdgeClearance: 3.2,
      capsuleRadius: 0.46,
      capsuleHeight: 3.2,
      sampleSpacing: 0.21,
      sameLevel: true,
      unobstructed: true,
    }] : [],
    zoneBounds: regionSpec ? id === 'encounter.assembly' ? {
      // Assembly begins combat at its east ingress. Its arena must therefore
      // own the enclosed circulation floor rather than only the inner 70% of
      // the chamber; otherwise normal enemy arena recovery immediately pulls
      // the entry threat out of Buster range before lock acquisition.
      min: vector(
        regionSpec.center.x - regionSpec.size.x * 0.5 + triggerInset,
        regionSpec.floorY,
        regionSpec.center.z - regionSpec.size.z * 0.5 + triggerInset,
      ),
      max: vector(
        regionSpec.center.x + regionSpec.size.x * 0.5 - triggerInset,
        regionSpec.floorY + Math.min(regionSpec.size.y, 8),
        regionSpec.center.z + regionSpec.size.z * 0.5 - triggerInset,
      ),
    } : {
      min: vector(regionSpec.center.x - regionSpec.size.x * 0.35, regionSpec.floorY, regionSpec.center.z - regionSpec.size.z * 0.35),
      max: vector(regionSpec.center.x + regionSpec.size.x * 0.35, regionSpec.floorY + Math.min(regionSpec.size.y, 8), regionSpec.center.z + regionSpec.size.z * 0.35),
    } : null,
    // Encounter activation is a separate authored volume from the combat
    // arena. It begins one proven portal-ingress depth inside the enclosing
    // room, allowing entry-side traversal choices before a helper or player
    // has been driven underneath elevated enemies by an arbitrary centre
    // trigger. Encounters still never lock permanent traversal or controls.
    triggerZoneBounds: regionSpec ? {
      min: vector(
        regionSpec.center.x - regionSpec.size.x * 0.5 + triggerInset,
        regionSpec.floorY,
        regionSpec.center.z - regionSpec.size.z * 0.5 + triggerInset,
      ),
      max: vector(
        regionSpec.center.x + regionSpec.size.x * 0.5 - triggerInset,
        regionSpec.floorY + Math.min(regionSpec.size.y, 8),
        regionSpec.center.z + regionSpec.size.z * 0.5 - triggerInset,
      ),
    } : null,
    spawnPatternId,
    spawnPattern: { id: spawnPatternId, roster, points },
    activationPurpose: elite ? 'final-elite' : optional ? 'optional-danger' : 'authored-spatial-encounter',
    blocksPermanentRoute: false,
    completionActionId: `action.complete.${id}`,
  };
}

function cacheSalvageBundle(seedStreams, rewardId, { major = false } = {}) {
  const random = seedStreams.reward(rewardId);
  const available = [...ORDINARY_REAVERBOT_SALVAGE_IDS];
  const partCount = major ? 3 : 2;
  const recoverableParts = [];
  for (let index = 0; index < partCount; index += 1) {
    const selectedIndex = random.int(0, available.length - 1);
    const [materialId] = available.splice(selectedIndex, 1);
    recoverableParts.push({
      materialId,
      quantity: major && index === 0 ? 2 : 1,
    });
  }
  return {
    unidentifiedScrap: random.int(major ? 6 : 2, major ? 9 : 4),
    recoverableParts,
  };
}

function reward(seedStreams, id, type, regionId, anchorId, options = {}) {
  return {
    id,
    type,
    regionId,
    anchorId,
    seed: seedStreams.seedFor(`reward:${id}`),
    safePlacement: true,
    hazardTag: null,
    conditions: options.conditions ?? (options.discoveryCondition ? [options.discoveryCondition] : []),
    keycardId: options.keycardId ?? options.keyId ?? null,
    ...options,
  };
}

function interaction(radius = 2.2, activationSide = 'front', requiresLineOfSight = true) {
  return { radius, activationSide, requiresLineOfSight };
}

function pickupInteraction(radius = 2.2) {
  // Pedestal/chest actions own colliding presentation geometry at the anchor.
  // They are deliberately usable from either side and do not raycast through
  // their own plan-owned prop. Distance, conditions, and the authored floor
  // anchor remain authoritative.
  return interaction(radius, 'either', false);
}

function pickupAction(id, anchorId, rewardId, keyId, conditions = []) {
  return { id, type: 'pickup', anchorId, interaction: pickupInteraction(), conditions, effects: [{ op: 'collectReward', rewardId }, { op: 'grantKey', keyId }], barrierIds: [] };
}

function collectRewardAction(id, anchorId, rewardId, conditions = []) {
  return { id, type: 'cache', anchorId, interaction: pickupInteraction(), conditions, effects: [{ op: 'collectReward', rewardId }], barrierIds: [] };
}

function gateAction(id, anchorId, gateId, keyId) {
  // A credential reader is a proximity control, not a facing puzzle. The
  // barrier collider and required-key condition remain authoritative, while
  // either-side activation prevents a player standing on the only supported
  // console pad from being rejected by an arbitrary facing half-plane.
  return { id, type: 'gate-control', anchorId, interaction: interaction(2.2, 'either', false), conditions: [{ op: 'hasKey', keyId }], effects: [{ op: 'openGate', gateId }], barrierIds: [gateId] };
}

function waterAction(id, anchorId, stateId) {
  return { id, type: 'water-router', anchorId, interaction: interaction(), conditions: [], effects: [{ op: 'setWaterState', variableId: 'water.unit.configuration', value: stateId }, { op: 'setMechanismState', mechanismId: 'mechanism.water-router', stateId }], barrierIds: [], controllerId: 'mechanism.water-router' };
}

function mechanismAction(id, anchorId, mechanismId, stateId, conditions = []) {
  return { id, type: 'mechanism-control', anchorId, interaction: interaction(), conditions, effects: [{ op: 'setMechanismState', mechanismId, stateId }], barrierIds: [], controllerId: mechanismId };
}

function basinGeometry(regionById, regionId, basinId) {
  const spec = regionById.get(regionId);
  if (!spec) return null;
  const minX = spec.center.x - spec.size.x / 2 + WATER_BASIN_WALL_INSET;
  const maxX = spec.center.x + spec.size.x / 2 - WATER_BASIN_WALL_INSET;
  const minZ = spec.center.z - spec.size.z / 2 + WATER_BASIN_WALL_INSET;
  const maxZ = spec.center.z + spec.size.z / 2 - WATER_BASIN_WALL_INSET;
  const exactFilledLevel = WATER_CONSERVED_VOLUME_CUBIC_METRES / ((maxX - minX) * (maxZ - minZ));
  return {
    id: basinId,
    regionId,
    bounds: {
      min: vector(minX, spec.floorY - 0.1, minZ),
      max: vector(maxX, spec.floorY + spec.size.y - 1, maxZ),
    },
    floorSurfaceId: surfaceId(regionId),
    walkableBottomY: spec.floorY + 0.35,
    playerRootTolerance: 0.5,
    capacityUnits: 1,
    exactFilledVolume: WATER_CONSERVED_VOLUME_CUBIC_METRES,
    exactFilledLevel,
    footprintPolicy: 'complete-main-walkable-basin',
  };
}

function waterEnvironment(regionSpecs) {
  const regionById = new Map(regionSpecs.map((entry) => [entry.id, entry]));
  const lab = regionById.has('lab-water-freight');
  const freightRegionId = lab ? 'lab-water-freight' : 'freight-sump';
  const reservoirRegionId = lab ? 'lab-water-reservoir' : 'reservoir';
  const gantryRegionId = lab ? 'lab-water-gantry' : 'gantry-sump';
  const freightBasinId = `basin.${freightRegionId}`;
  const reservoirBasinId = `basin.${reservoirRegionId}`;
  const gantryBasinId = `basin.${gantryRegionId}`;
  const basins = [
    basinGeometry(regionById, freightRegionId, freightBasinId),
    basinGeometry(regionById, reservoirRegionId, reservoirBasinId),
    basinGeometry(regionById, gantryRegionId, gantryBasinId),
  ];
  const filledLevels = (filledBasinId) => Object.fromEntries(basins.map((basin) => [
    basin.id,
    basin.id === filledBasinId ? basin.exactFilledLevel : 0,
  ]));
  return {
    id: 'environment.water-unit',
    type: 'conserved-water-unit',
    variableId: 'water.unit.configuration',
    capacityUnits: 1,
    initialStateId: 'FreightSumpFilled',
    transferCommit: 'atomic-after-animation',
    conservedVolume: 1,
    basins,
    stableStates: [
      { id: 'FreightSumpFilled', totalUnits: 1, exactVolume: WATER_CONSERVED_VOLUME_CUBIC_METRES, basinLevels: filledLevels(freightBasinId) },
      { id: 'StoredInReservoir', totalUnits: 1, exactVolume: WATER_CONSERVED_VOLUME_CUBIC_METRES, basinLevels: filledLevels(reservoirBasinId) },
      { id: 'GantrySumpFilled', totalUnits: 1, exactVolume: WATER_CONSERVED_VOLUME_CUBIC_METRES, basinLevels: filledLevels(gantryBasinId) },
    ],
    movementProfile: { captureFloodedStateAtTakeoff: true, groundMovementMultiplier: 0.76, jumpHeight: 4.95, gravityScale: 0.28, mode: 'bottom-walking' },
    permanentDryControlAnchorIds: lab
      ? ['anchor.water-router.freight', 'anchor.water-router.reservoir', 'anchor.water-router.gantry']
      : ['anchor.water-router.freight', 'anchor.water-router.reservoir', 'anchor.water-router.gantry'],
  };
}

function hazardEnvironment(hazardType, id, surfaces = []) {
  if (hazardType === 'electrical') {
    return {
      id,
      type: 'electric-floor-cycle-v1',
      hazardTag: 'environmental:electrical',
      tags: ['environmental:electrical'],
      phaseCycleSeconds: 3.5,
      entryPhase: 'safe',
      phases: [{ id: 'safe', durationSeconds: 1.25 }, { id: 'charging', durationSeconds: 0.75 }, { id: 'energized', durationSeconds: 1.5 }],
      damagePerSecond: 9,
      surfaces,
      timing: { safeSeconds: 1.25, chargingSeconds: 0.75, activeSeconds: 1.5, cycleSeconds: 3.5 },
      safeRouteRequired: true,
      ordinaryEnemyAvoidance: true,
    };
  }
  return {
    id,
    type: 'magma-floor-v1',
    hazardTag: 'environmental:magma',
    // Keep the V2-specific semantic tag while also forwarding the current
    // equipment tags consumed by Heat Resist. Runtime damage must flow through
    // Player.takeIncomingHit instead of inventing a parallel resistance path.
    tags: ['environmental:magma', 'environmentalHeat', 'fireFloor'],
    damagePerSecond: 12,
    pulseSeconds: 0.25,
    entryGraceSeconds: 0.5,
    graceSeconds: 0.5,
    activeSeconds: 0.25,
    recoverySeconds: 0,
    surfaces,
    safeRouteRequired: true,
    ordinaryEnemyAvoidance: true,
  };
}

function goldenMechanisms(hazardType) {
  return [
    {
      id: 'mechanism.water-router', type: 'water-router', regionId: 'reservoir', anchorId: 'anchor.water-router.reservoir', initialStateId: 'FreightSumpFilled',
      states: ['FreightSumpFilled', 'StoredInReservoir', 'GantrySumpFilled'].map((id) => ({ id, stable: true })),
      transitions: ['FreightSumpFilled', 'StoredInReservoir', 'GantrySumpFilled'].flatMap((fromStateId) => ['FreightSumpFilled', 'StoredInReservoir', 'GantrySumpFilled'].filter((toStateId) => toStateId !== fromStateId).map((toStateId) => ({ fromStateId, toStateId, actionId: `action.water.${toStateId === 'FreightSumpFilled' ? 'freight-sump' : toStateId === 'StoredInReservoir' ? 'reservoir' : 'gantry-sump'}`, legal: true }))),
      runtimeProfile: { animationSeconds: 2.4, commit: 'atomic' },
    },
    {
      id: 'mechanism.cargo-lift', type: 'cargo-lift', regionId: 'salvage-tunnel', anchorId: 'anchor.shortcut.beta', initialStateId: 'LowerLanding', recallable: true, automaticTravel: true,
      states: [{ id: 'LowerLanding', stable: true, regionId: 'salvage-tunnel', surfaceY: -18, position: vector(6, -18, -4), landingSurfaceId: 'surface.mechanism.cargo-lift.landing.lower' }, { id: 'UpperLanding', stable: true, regionId: 'sorting', surfaceY: 0, position: vector(6, 0, -4), landingSurfaceId: 'surface.mechanism.cargo-lift.landing.upper' }],
      transitions: [{ fromStateId: 'LowerLanding', toStateId: 'UpperLanding', trigger: 'automatic-dwell', automatic: true, conditions: [{ op: 'gateOpen', gateId: 'Gate_Shortcut_Beta' }] }, { fromStateId: 'UpperLanding', toStateId: 'LowerLanding', trigger: 'automatic-dwell', automatic: true }, { fromStateId: 'UpperLanding', toStateId: 'LowerLanding', actionId: 'action.cargo-lift.recall-lower', trigger: 'recall', automatic: true }, { fromStateId: 'LowerLanding', toStateId: 'UpperLanding', actionId: 'action.cargo-lift.recall-upper', trigger: 'recall', automatic: true, conditions: [{ op: 'gateOpen', gateId: 'Gate_Shortcut_Beta' }] }],
      runtimeProfile: { dynamicSurfaceId: 'surface.salvage-tunnel.lift', controlOffsetFromWalkway: 2.5, platformHalfExtent: CARGO_LIFT_PLATFORM_HALF_EXTENT, shaftPortalId: 'portal.salvage-sorting-shortcut', interlockGateId: 'Gate_Shortcut_Beta' },
      actionIds: ['action.cargo-lift.recall-lower', 'action.cargo-lift.recall-upper'],
    },
    {
      id: 'mechanism.sorting-cargo', type: 'moving-cargo', regionId: 'sorting', initialStateId: 'CycleStart', automaticTravel: true,
      states: [
        { id: 'CycleStart', stable: true, position: vector(-15, 3.95, 0), landingSurfaceId: 'surface.sorting.landmark-catwalk' },
        { id: 'FarLanding', stable: true, position: vector(14.8, 4.95, 8), landingSurfaceId: 'surface.sorting.landing-sorting-credential-beta' },
      ],
      transitions: [{ fromStateId: 'CycleStart', toStateId: 'FarLanding', trigger: 'automatic-dwell', automatic: true }, { fromStateId: 'FarLanding', toStateId: 'CycleStart', trigger: 'automatic-dwell', automatic: true }],
      runtimeProfile: { elevated: true, minimumElevation: 3.5, dynamicSurfaceId: 'surface.sorting.moving-cargo', platformHalfExtent: 2.2, purpose: 'connects upper sorting landings' },
    },
    {
      id: 'mechanism.corkscrew-gear', type: 'corkscrew-gear', regionId: 'corkscrew', anchorId: 'anchor.gear.bridge', initialStateId: 'LowLanding', recallable: true, automaticTravel: true,
      states: [
        { id: 'LowLanding', stable: true, elevation: 9.95, position: vector(92.14, 9.95, -7.48), landingSurfaceId: 'surface.corkscrew.process-alcove' },
        { id: 'BridgeAligned', stable: true, elevation: 13.95, position: vector(101, 13.95, 6.3), landingSurfaceId: 'surface.corkscrew.landmark-catwalk' },
        { id: 'HighLanding', stable: true, elevation: 14.95, position: vector(111.8, 14.95, -10), landingSurfaceId: 'surface.corkscrew.landing-corkscrew-machine-core-gamma' },
      ],
      transitions: [
        { fromStateId: 'LowLanding', toStateId: 'BridgeAligned', trigger: 'automatic-dwell', automatic: true },
        { fromStateId: 'BridgeAligned', toStateId: 'HighLanding', trigger: 'automatic-dwell', automatic: true },
        { fromStateId: 'HighLanding', toStateId: 'LowLanding', trigger: 'automatic-dwell', automatic: true },
        { fromStateId: '*', toStateId: 'LowLanding', actionId: 'action.gear.align-low', trigger: 'recall', automatic: true },
        { fromStateId: '*', toStateId: 'BridgeAligned', actionId: 'action.gear.align-bridge', trigger: 'recall', automatic: true },
        { fromStateId: '*', toStateId: 'HighLanding', actionId: 'action.gear.align-high', trigger: 'recall', automatic: true },
      ],
      runtimeProfile: { dynamicSurfaceId: 'surface.corkscrew.gear', supported: true, platformHalfExtent: 2.2, controlOffsetFromWalkway: 2.5, speed: 3.2, dwellSeconds: 4.5 },
    },
    {
      id: 'mechanism.freight-crumble', type: 'crumbling-floor', regionId: 'assembly', initialStateId: 'Intact', automaticReset: true,
      states: [{ id: 'Intact', stable: true, collision: true, landingSurfaceId: surfaceId('assembly') }, { id: 'Cracking', stable: false, collision: true }, { id: 'Collapsed', stable: true, collision: false }, { id: 'Resetting', stable: false, collision: false }],
      transitions: [{ fromStateId: 'Intact', toStateId: 'Cracking', trigger: 'player-contact', automatic: true }, { fromStateId: 'Cracking', toStateId: 'Collapsed', afterSeconds: 0.8, automatic: true }, { fromStateId: 'Collapsed', toStateId: 'Resetting', afterSeconds: 4, automatic: true }, { fromStateId: 'Resetting', toStateId: 'Intact', afterSeconds: 1.2, automatic: true }],
      runtimeProfile: { aperturePortalId: 'portal.assembly-freight-drop', warningProfile: 'visible-cracks-and-audio-v2', noManualRearm: true },
    },
    {
      id: 'mechanism.gamma-return-lift', type: 'cargo-lift', regionId: 'hazard-core', anchorId: 'anchor.shortcut.gamma', initialStateId: 'LowerLanding', recallable: true, automaticTravel: true,
      states: [{ id: 'LowerLanding', stable: true, regionId: 'hazard-core', surfaceY: -14, position: vector(60, -14, -12), landingSurfaceId: 'surface.mechanism.gamma-return-lift.landing.lower' }, { id: 'UpperLanding', stable: true, regionId: 'credential', surfaceY: 6, position: vector(60, 6, -12), landingSurfaceId: 'surface.mechanism.gamma-return-lift.landing.upper' }],
      transitions: [{ fromStateId: 'LowerLanding', toStateId: 'UpperLanding', trigger: 'automatic-dwell', automatic: true, conditions: [{ op: 'gateOpen', gateId: 'Gate_Shortcut_Gamma' }] }, { fromStateId: 'UpperLanding', toStateId: 'LowerLanding', trigger: 'automatic-dwell', automatic: true }, { fromStateId: 'UpperLanding', toStateId: 'LowerLanding', actionId: 'action.gamma-lift.recall-lower', trigger: 'recall', automatic: true }, { fromStateId: 'LowerLanding', toStateId: 'UpperLanding', actionId: 'action.gamma-lift.recall-upper', trigger: 'recall', automatic: true, conditions: [{ op: 'gateOpen', gateId: 'Gate_Shortcut_Gamma' }] }],
      runtimeProfile: { dynamicSurfaceId: 'surface.hazard-core.return-lift', controlOffsetFromWalkway: 2.5, platformHalfExtent: CARGO_LIFT_PLATFORM_HALF_EXTENT, landingSide: 'west', shaftPortalId: 'portal.hazard-core-credential-return', interlockGateId: 'Gate_Shortcut_Gamma' },
      actionIds: ['action.gamma-lift.recall-lower', 'action.gamma-lift.recall-upper'],
    },
    {
      id: 'mechanism.undercroft-hazard',
      type: hazardType === 'magma' ? 'magma-floor-v1' : 'electric-floor-cycle-v1',
      regionId: 'hazard-core',
      initialStateId: hazardType === 'magma' ? 'Active' : 'Safe',
      states: hazardType === 'magma'
        ? [{ id: 'Active', stable: true }]
        : [
          { id: 'Safe', stable: true },
          { id: 'Charging', stable: false },
          { id: 'Energized', stable: true },
        ],
      transitions: hazardType === 'magma'
        ? []
        : [
          { fromStateId: 'Safe', toStateId: 'Charging', automatic: true, afterSeconds: 1.25 },
          { fromStateId: 'Charging', toStateId: 'Energized', automatic: true, afterSeconds: 0.75 },
          { fromStateId: 'Energized', toStateId: 'Safe', automatic: true, afterSeconds: 1.5 },
        ],
      runtimeProfile: { environmentStateId: 'environment.undercroft-hazard' },
    },
  ];
}

function makeFalls(portals, fixtureKind) {
  return portals.filter((portal) => portal.approachType === 'intentional-drop').map((portal) => {
    const targetRegionId = portal.to.regionId;
    const catchmentTopY = fixtureKind === 'golden-complex' ? -4.65 : -6.65;
    return {
      id: `fall.${portal.id.replace('portal.', '')}`,
      sourcePortalId: portal.id,
      sourceApertureBoundaryId: portal.from.boundaryId,
      targetCatchmentRegionId: targetRegionId,
      catchmentSurfaceId: surfaceId(targetRegionId, 'catchment'),
      safeAnchorId: fixtureKind === 'golden-complex' ? 'safe.freight-catchment' : 'safe.lab-recovery',
      trajectoryBounds: {
        min: vector(Math.min(portal.from.center.x, portal.to.center.x) - 3.6, catchmentTopY - 0.15, Math.min(portal.from.center.z, portal.to.center.z) - 3.6),
        max: vector(Math.max(portal.from.center.x, portal.to.center.x) + 3.6, portal.from.center.y + 0.5, Math.max(portal.from.center.z, portal.to.center.z) + 3.6),
      },
      landingDimensions: { width: 5.2, depth: 5.2, headroom: 3.2 },
      signalingProfile: 'cracked-floor-lit-catchment-v2',
      returnPortalIds: fixtureKind === 'golden-complex'
        ? ['portal.server-freight', 'portal.freight-security-shortcut']
        : ['portal.lab-hazards-recovery', 'portal.lab-recovery-gear'],
      damageFree: true,
      playableDestination: true,
    };
  });
}

function addCatchmentSurfaces(spatial, portals, fixtureKind) {
  for (const portal of portals.filter((entry) => entry.approachType === 'intentional-drop')) {
    const regionId = portal.to.regionId;
    const targetY = fixtureKind === 'golden-complex' ? -5 : -7;
    const catchmentSupportId = `fixture.${regionId}.catchment-support`;
    const catchmentSupportHalfExtent = 3.1;
    const targetCellBounds = spatial.spatialCells.find((entry) => entry.id === cellId(regionId))?.bounds;
    const returnApproachSide = portal.to.center.x - (targetCellBounds?.min.x ?? portal.to.center.x) >= (
      (targetCellBounds?.max.x ?? portal.to.center.x) - portal.to.center.x
    ) ? 'west' : 'east';
    spatial.structuralFixtures.push({
      id: catchmentSupportId,
      type: 'structural-support',
      subtype: 'heavy-catchment-support',
      regionId,
      cellId: cellId(regionId),
      // Put load-bearing posts and rim beams beneath the catchment perimeter,
      // not inside the intentional landing lane. The previous +/-1.4m frame
      // left four solid columns in the middle of a 3.2m authored drop.
      bounds: {
        min: vector(
          portal.to.center.x - catchmentSupportHalfExtent,
          targetCellBounds?.min.y ?? targetY - 4,
          portal.to.center.z - catchmentSupportHalfExtent,
        ),
        max: vector(
          portal.to.center.x + catchmentSupportHalfExtent,
          targetY,
          portal.to.center.z + catchmentSupportHalfExtent,
        ),
      },
      materialProfileId: 'industrial-catchment-support-v2',
      visualProfile: 'heavy-braced-catchment-columns-v2',
      collision: 'blocking',
      supportBoundaryIds: [boundaryId(regionId, 'floor')],
      gameplayPurpose: 'visibly supports the damage-free intentional-fall catchment',
      openApproachSide: returnApproachSide,
    });
    spatial.walkableSurfaces.push({
      id: surfaceId(regionId, 'catchment'),
      regionId,
      cellId: cellId(regionId),
      bounds: { min: vector(portal.to.center.x - 3.5, targetY, portal.to.center.z - 3.5), max: vector(portal.to.center.x + 3.5, targetY + 0.35, portal.to.center.z + 3.5) },
      purpose: 'supported damage-free intentional-fall catchment',
      supportBoundaryIds: [boundaryId(regionId, 'floor')],
      supportFixtureIds: [catchmentSupportId],
      supportProfile: 'heavy-braced-catchment-v2',
      visualProfile: 'signaled-catchment-platform-v2',
      collision: 'static',
      hazardTag: null,
    });
    spatial.traversalLinks.push(
      {
        id: `traversal.${regionId}.catchment-return`,
        regionId,
        fromSurfaceId: surfaceId(regionId, 'catchment'),
        toSurfaceId: surfaceId(regionId),
        mode: 'walkable-stairs',
        bidirectional: true,
        minimumWidth: 1.2,
        damageFree: true,
        viaSurfaceId: surfaceId(regionId, 'catchment-return-stairs'),
      },
      {
        id: `traversal.${portal.from.regionId}.crumble-access`,
        regionId: portal.from.regionId,
        fromSurfaceId: surfaceId(portal.from.regionId),
        toSurfaceId: surfaceId(portal.from.regionId, 'crumble'),
        mode: 'walk',
        bidirectional: true,
        conditions: [{ op: 'stateEquals', variableId: fixtureKind === 'golden-complex' ? 'mechanism.freight-crumble.state' : 'mechanism.lab-crumble.state', value: 'Intact' }],
      },
    );
    const mainFloorY = spatial.spatialCells.find((entry) => entry.id === cellId(regionId))?.bounds.min.y ?? targetY - 3;
    const rise = Math.abs(targetY - mainFloorY);
    const minimumRun = Math.ceil(rise / 0.18 - 0.0001) * 0.45 + 0.45;
    const availableLeft = portal.to.center.x - (targetCellBounds?.min.x ?? portal.to.center.x - minimumRun);
    const availableRight = (targetCellBounds?.max.x ?? portal.to.center.x + minimumRun) - portal.to.center.x;
    const direction = availableLeft >= availableRight ? -1 : 1;
    const stairRun = Math.min(
      Math.max(minimumRun, 8.5),
      Math.max(availableLeft, availableRight) - STAIR_ENDPOINT_OVERLAP,
    );
    const stairStartX = portal.to.center.x + direction * stairRun;
    // Freight contains both the Alpha shortcut ladder on its west wall and
    // the long return stair from the intentional-drop catchment. The generic
    // west-to-catchment diagonal crossed directly above the ladder's bottom
    // exit, leaving only about 2.3m of headroom and causing the production
    // walkability constraint to snap a descending player back onto the
    // ladder. Author the stair foot in the clear north service bay instead.
    // It retains the exact riser/tread envelope and joins the same two decks,
    // while the ladder owns a full 1.2m + capsule-clear eastward egress.
    const stairStart = fixtureKind === 'golden-complex' && regionId === 'freight'
      ? vector(
          (targetCellBounds?.min.x ?? stairStartX) + 10,
          mainFloorY,
          (targetCellBounds?.min.z ?? portal.to.center.z) + 0.5 + STAIR_ENDPOINT_OVERLAP,
        )
      : vector(stairStartX, mainFloorY, portal.to.center.z);
    spatial.walkableSurfaces.push({
      id: surfaceId(regionId, 'catchment-return-stairs'),
      regionId,
      cellId: cellId(regionId),
      bounds: {
        min: vector(Math.min(stairStartX, portal.to.center.x), Math.min(mainFloorY, targetY), portal.to.center.z - 2),
        max: vector(Math.max(stairStartX, portal.to.center.x), Math.max(mainFloorY, targetY) + 0.3, portal.to.center.z + 2),
      },
      purpose: 'continuous walking staircase from fall catchment to the playable lower sub-zone',
      supportBoundaryIds: [boundaryId(regionId, 'floor')],
      supportProfile: 'continuous-stair-stringers-v2',
      visualProfile: 'recovery-walkable-stairs-v2',
      collision: 'static',
      hazardTag: null,
      geometry: { type: 'stairs', path: [stairStart, vector(portal.to.center.x, targetY, portal.to.center.z)], maxRiser: 0.18, minimumTread: 0.45, width: 3.2, ledgeClimbDisabled: true },
    });
  }
}

function addHazardTraversalLinks(spatial, environmentStates) {
  for (const environment of environmentStates.filter((entry) => entry.hazardTag)) {
    for (const surfaceContract of environment.surfaces ?? []) {
      spatial.traversalLinks.push({
        id: `traversal.${surfaceContract.surfaceId.replace('surface.', '')}.hazard-field`,
        regionId: surfaceContract.regionId,
        fromSurfaceId: surfaceId(surfaceContract.regionId),
        toSurfaceId: surfaceContract.surfaceId,
        mode: 'walk',
        bidirectional: true,
        minimumWidth: 1.2,
        hazardTag: environment.hazardTag,
        safeBypassRequired: true,
      });
    }
  }
}

function gateBarrierBounds(endpoint) {
  const { center, dimensions, side } = endpoint;
  const halfWidth = dimensions.width / 2;
  const halfHeight = dimensions.height / 2;
  // A closed gate is the physical seal for the complete portal throat.  The
  // old hard-coded 0.70m slab occupied only part of the authored 1.20m portal
  // depth, leaving the render/collider proof weaker than the connector it was
  // meant to close.  Use the socket depth itself so jumping and low-frame-rate
  // movement cannot sample a clear pocket on either face of the barrier.
  const halfDepth = dimensions.depth / 2;
  if (side === 'east' || side === 'west') {
    return { min: vector(center.x - halfDepth, center.y - halfHeight, center.z - halfWidth), max: vector(center.x + halfDepth, center.y + halfHeight, center.z + halfWidth) };
  }
  if (side === 'north' || side === 'south') {
    return { min: vector(center.x - halfWidth, center.y - halfHeight, center.z - halfDepth), max: vector(center.x + halfWidth, center.y + halfHeight, center.z + halfDepth) };
  }
  return { min: vector(center.x - halfWidth, center.y - halfHeight, center.z - dimensions.depth / 2), max: vector(center.x + halfWidth, center.y + halfHeight, center.z + dimensions.depth / 2) };
}

function addGateBarriers(spatial, portals, progression) {
  const portalById = new Map(portals.map((entry) => [entry.id, entry]));
  for (const gate of progression?.gateContracts ?? []) {
    const portal = portalById.get(gate.portalId);
    if (!portal) continue;
    const endpoint = portal.from;
    const barrierBoundaryId = gate.barrierBoundaryId ?? gate.barrierId ?? gate.id;
    gate.barrierId = barrierBoundaryId;
    gate.barrierBoundaryId = barrierBoundaryId;
    spatial.structuralBoundaries.push({
      id: barrierBoundaryId,
      cellId: endpoint.cellId,
      regionId: endpoint.regionId,
      side: endpoint.side,
      kind: 'movable-gate-barrier',
      bounds: gateBarrierBounds(endpoint),
      openings: [],
      materialProfileId: 'security-gate-barrier-v2',
      visualProfile: 'opaque-colliding-security-gate-v2',
      collider: true,
      collision: 'dynamic',
      opaque: true,
      movable: true,
      blocksPortalId: portal.id,
      portalId: portal.id,
      actionId: gate.actionId,
    });
  }
}

function bindClosedGatesToNonVaultableRoutes(spatial, portals, progression) {
  const portalById = new Map(portals.map((entry) => [entry.id, entry]));
  const surfaceById = new Map(spatial.walkableSurfaces.map((entry) => [entry.id, entry]));
  for (const gate of progression?.gateContracts ?? []) {
    const portal = portalById.get(gate.portalId);
    if (!portal) continue;
    const protectedSurfaceIds = new Set([
      portal.physicalRoute?.endpointSurfaceIds?.from,
      portal.physicalRoute?.endpointSurfaceIds?.to,
      ...(portal.physicalRoute?.surfaceIds ?? []),
    ].filter(Boolean));
    for (const protectedSurfaceId of protectedSurfaceIds) {
      const surface = surfaceById.get(protectedSurfaceId);
      if (!surface) continue;
      // These are authored walk/stair/lift routes. They must be reached by the
      // portal contract, never by the generic platform ledge resolver while a
      // keycard barrier is closed. The flag is consumed directly by Game's
      // ledge-candidate builder; opening the door still leaves the intended
      // walking route unchanged.
      surface.createsLedgeCandidates = false;
      surface.closedGatePortalIds = [...new Set([
        ...(surface.closedGatePortalIds ?? []),
        portal.id,
      ])];
    }
  }
}

function makeSafeAnchors(regionSpecs, fixtureKind) {
  const regionById = new Map(regionSpecs.map((entry) => [entry.id, entry]));
  if (fixtureKind === 'golden-complex') {
    return [
      anchor(regionById, 'safe.security-start', 'security', 'player-start', {}, { isPlayerStart: true, safeAnchorType: 'player-start' }),
      anchor(regionById, 'safe.freight-catchment', 'freight', 'intentional fall catchment', { x: 8, y: 7, z: -6 }, { surfaceId: surfaceId('freight', 'catchment'), safeSurfaceId: surfaceId('freight', 'catchment') }),
      anchor(regionById, 'safe.water-router', 'reservoir', 'permanent dry router', { y: 3.95, z: -8 }, { surfaceId: surfaceId('reservoir', 'router-catwalk'), safeSurfaceId: surfaceId('reservoir', 'router-catwalk') }),
      anchor(regionById, 'safe.undercroft-island', 'hazard-core', 'damage-free undercroft island', { x: -10, z: 8 }),
      anchor(regionById, 'safe.extraction-return', 'extraction', 'post-Refractor safe return', { x: -10, z: -6 }),
    ];
  }
  return [
    anchor(regionById, 'safe.lab-entry', 'lab-entry', 'player-start', {}, { isPlayerStart: true, safeAnchorType: 'player-start' }),
    anchor(regionById, 'safe.lab-router', 'lab-water-reservoir', 'permanent dry lab router', { y: 3.95, z: -8 }, { surfaceId: surfaceId('lab-water-reservoir', 'router-catwalk'), safeSurfaceId: surfaceId('lab-water-reservoir', 'router-catwalk') }),
    anchor(regionById, 'safe.lab-recovery', 'lab-recovery', 'lab intentional fall catchment', { x: -8, y: 3, z: 5 }, { surfaceId: surfaceId('lab-recovery', 'catchment'), safeSurfaceId: surfaceId('lab-recovery', 'catchment') }),
  ];
}

function makeMinimap(regions, portals, content) {
  const extractionAction = content.actions?.find((entry) => entry.type === 'extraction')
    ?? content.actions?.find((entry) => entry.type === 'fixture-complete');
  return {
    source: 'DungeonPlanV2',
    regions: regions.map((entry) => ({ id: entry.id, districtId: entry.districtId, bounds: entry.bounds, elevation: entry.elevation, elevationBand: entry.elevationBand })),
    connections: portals.map((entry) => ({ id: entry.id, fromRegionId: entry.from.regionId, toRegionId: entry.to.regionId, direction: entry.direction, elevationBands: entry.elevationBands, barrierId: entry.barrierId, mechanismId: entry.mechanismId })),
    staticMarkers: [
      ...content.rewards.map((entry) => ({ id: `marker.${entry.id}`, type: entry.type, anchorId: entry.anchorId, reveal: 'region-discovery' })),
      ...(extractionAction ? [{
        id: 'marker.extraction',
        type: extractionAction.type === 'extraction' ? 'extraction' : 'fixture-exit',
        anchorId: extractionAction.anchorId,
        reveal: extractionAction.type === 'extraction' ? 'refractor-collected' : 'always',
      }] : []),
    ],
  };
}

function interactionPresentationForAction(action) {
  if (['gate-control', 'water-router', 'mechanism-control'].includes(action.type)) return { type: 'interaction-console', role: 'control console terminal' };
  if (action.type === 'extraction') return { type: 'extraction-pad', role: 'extraction pad prop' };
  if (action.type === 'cache') return { type: 'cache-chest', role: 'Reaverbot parts cache chest prop' };
  if (action.type === 'discovery') return { type: 'reward-pedestal', role: 'discovery prop pedestal' };
  if (action.type === 'fixture-complete') return { type: 'reward-pedestal', role: 'fixture completion prop station' };
  const collectedRewardId = action.effects?.find((effect) => effect.op === 'collectReward')?.rewardId;
  if (collectedRewardId === 'reward.key-seeker') return { type: 'key-seeker-console', role: 'Key Seeker station pedestal' };
  if (collectedRewardId === 'reward.large-refractor') return { type: 'refractor-shrine', role: 'Large Refractor shrine dais prop' };
  if (collectedRewardId === 'reward.shrine-key') return { type: 'reward-pedestal', role: 'Shrine Key reward pedestal' };
  if (collectedRewardId?.includes('keycard')) return { type: 'keycard-pedestal', role: 'keycard pickup pedestal' };
  return { type: 'reward-pedestal', role: 'pickup pedestal prop' };
}

function addPlanOwnedInteractionFixtures(spatial, regionSpecs, content) {
  const surfaceById = new Map(spatial.walkableSurfaces.map((entry) => [entry.id, entry]));
  const anchorById = new Map(content.anchors.map((entry) => [entry.id, entry]));
  const regionById = new Map(regionSpecs.map((entry) => [entry.id, entry]));
  const actionById = new Map(content.actions.map((entry) => [entry.id, entry]));
  const consoleTypes = new Set(['gate-control', 'water-router', 'mechanism-control']);
  const isDedicatedControlSurface = (surface) => surface?.interactionSurfaceRole === 'side-control-pad'
    || /^surface\.console-pad\./.test(surface?.id ?? '');

  for (const action of content.actions) {
    if (action.interaction?.activationSide === 'system') {
      action.visualFixtureIds = [];
      action.colliderIds = [];
      continue;
    }
    const anchorRecord = anchorById.get(action.anchorId);
    if (!anchorRecord) continue;
    let supportingSurface = surfaceById.get(anchorRecord.surfaceId ?? anchorRecord.safeSurfaceId);
    const regionSpec = regionById.get(anchorRecord.regionId);
    const fixtureSuffix = action.id.replace(/^action\./, '').replace(/[^a-zA-Z0-9.-]+/g, '-');
    const fixtureId = `fixture.interaction.${fixtureSuffix}`;

    if (consoleTypes.has(action.type) && !isDedicatedControlSurface(supportingSurface)) {
      const approachSurfaceId = supportingSurface?.id;
      const padId = `surface.console-pad.${fixtureSuffix}`;
      const padSupportId = `fixture.console-pad-support.${fixtureSuffix}`;
      const surfaceTopY = anchorRecord.position.y;
      const supportBoundaryIds = supportingSurface?.supportBoundaryIds?.length
        ? [...supportingSurface.supportBoundaryIds]
        : [boundaryId(anchorRecord.regionId, 'floor')];
      spatial.structuralFixtures.push({
        id: padSupportId,
        type: 'structural-support',
        regionId: anchorRecord.regionId,
        cellId: supportingSurface?.cellId ?? cellId(anchorRecord.regionId),
        bounds: {
          min: vector(anchorRecord.position.x - 0.9, (regionSpec?.floorY ?? surfaceTopY) - 0.35, anchorRecord.position.z - 0.9),
          max: vector(anchorRecord.position.x + 0.9, surfaceTopY - 0.2, anchorRecord.position.z + 0.9),
        },
        materialProfileId: 'interaction-console-pad-support-v2',
        visualProfile: 'braced-side-console-pad-v2',
        collision: 'blocking',
        supportBoundaryIds,
        gameplayPurpose: `visible side support for ${action.id}`,
      });
      supportingSurface = {
        id: padId,
        regionId: anchorRecord.regionId,
        cellId: supportingSurface?.cellId ?? cellId(anchorRecord.regionId),
        bounds: {
          min: vector(anchorRecord.position.x - 1.25, surfaceTopY - 0.2, anchorRecord.position.z - 1.25),
          max: vector(anchorRecord.position.x + 1.25, surfaceTopY, anchorRecord.position.z + 1.25),
        },
        purpose: `${action.id} static side-console control pad`,
        supportBoundaryIds,
        supportFixtureIds: [padSupportId],
        supportProfile: 'braced-side-console-pad-v2',
        visualProfile: 'interaction:side-console-pad-v2',
        collision: 'static',
        // A control pad is a standing place, not an alternate platforming
        // route. In particular it must never let the generic ledge resolver
        // vault a player around the closed gate beside it.
        createsLedgeCandidates: false,
        hazardTag: null,
        interactionSurfaceRole: 'side-control-pad',
        approachSurfaceId,
      };
      spatial.walkableSurfaces.push(supportingSurface);
      spatial.traversalLinks.push({
        id: `traversal.console-pad.${fixtureSuffix}`,
        regionId: anchorRecord.regionId,
        fromSurfaceId: anchorRecord.surfaceId ?? anchorRecord.safeSurfaceId,
        toSurfaceId: padId,
        mode: 'walk',
        bidirectional: true,
        minimumWidth: 1.2,
      });
      surfaceById.set(padId, supportingSurface);
      anchorRecord.surfaceId = padId;
      anchorRecord.safeSurfaceId = padId;
      anchorRecord.approachSurfaceId = approachSurfaceId;
    } else if (consoleTypes.has(action.type)) {
      anchorRecord.approachSurfaceId = supportingSurface?.id;
    }

    const presentation = interactionPresentationForAction(action);
    const role = presentation.role;
    const isExtraction = action.type === 'extraction';
    const isConsole = consoleTypes.has(action.type);
    const surfaceTopY = supportingSurface?.bounds?.max?.y ?? anchorRecord.position.y;
    const forward = anchorRecord.forward ?? vector(0, 0, 1);
    const rawActivationDirection = action.interaction?.activationSide === 'back'
      ? vector(-forward.x, 0, -forward.z)
      : forward;
    const activationLength = Math.hypot(rawActivationDirection.x, rawActivationDirection.z);
    const activationDirection = activationLength > 0.0001
      ? vector(
        rawActivationDirection.x / activationLength,
        0,
        rawActivationDirection.z / activationLength,
      )
      : vector(0, 0, 1);
    // The action anchor is the selectable front face. Put the blocking console
    // body behind that face so the player's +forward approach and LOS ray do
    // not intersect the console before reaching the action point.
    // Leave more than the runtime's 0.04m LOS probe radius between the
    // selectable face and its own collider. A 0.04m flush gap still sampled
    // the cabinet as a wall at the target endpoint.
    const consoleFacesX = isConsole && Math.abs(activationDirection.x) > Math.abs(activationDirection.z);
    const size = isExtraction ? { x: 4, y: 0.2, z: 4 }
      : isConsole ? (consoleFacesX
          ? { x: 0.65, y: 1.4, z: 1 }
          : { x: 1, y: 1.4, z: 0.65 })
        : { x: 1.4, y: 1.15, z: 1.4 };
    const selectableFaceOffset = isConsole
      ? Math.abs(activationDirection.x) * size.x * 0.5
        + Math.abs(activationDirection.z) * size.z * 0.5
        + 0.09
      : 0;
    const centerX = anchorRecord.position.x - activationDirection.x * selectableFaceOffset;
    const centerZ = anchorRecord.position.z - activationDirection.z * selectableFaceOffset;
    const fixtureBounds = isExtraction ? {
      min: vector(centerX - size.x / 2, surfaceTopY - 0.12, centerZ - size.z / 2),
      max: vector(centerX + size.x / 2, surfaceTopY, centerZ + size.z / 2),
    } : {
      min: vector(centerX - size.x / 2, surfaceTopY, centerZ - size.z / 2),
      max: vector(centerX + size.x / 2, surfaceTopY + size.y, centerZ + size.z / 2),
    };
    if (isExtraction) anchorRecord.position.y = surfaceTopY;
    spatial.structuralFixtures.push({
      id: fixtureId,
      type: presentation.type,
      subtype: role.replace(/\s+/g, '-').toLowerCase(),
      regionId: anchorRecord.regionId,
      cellId: supportingSurface?.cellId ?? cellId(anchorRecord.regionId),
      bounds: fixtureBounds,
      materialProfileId: isConsole ? 'interaction-console-v2' : 'interaction-prop-v2',
      visualProfile: `interaction:${role.replace(/\s+/g, '-').toLowerCase()}`,
      collision: 'blocking',
      supportBoundaryIds: supportingSurface?.supportBoundaryIds?.length
        ? [...supportingSurface.supportBoundaryIds]
        : [boundaryId(anchorRecord.regionId, 'floor')],
      gameplayPurpose: role,
      actionId: action.id,
      visualId: `visual.${fixtureId}`,
      visualIds: [`visual.${fixtureId}`],
      colliderIds: [`collider.${fixtureId}.0`],
      colliderBounds: [fixtureBounds],
    });
    action.visualFixtureIds = [fixtureId];
    action.colliderIds = [fixtureId];
  }

  for (const reward of content.rewards) {
    const action = actionById.get(reward.actionId);
    reward.visualFixtureIds = [...(action?.visualFixtureIds ?? [])];
    reward.colliderIds = [...(action?.colliderIds ?? [])];
  }
  for (const objective of content.objectives) {
    const action = actionById.get(objective.actionId);
    objective.visualFixtureIds = [...(action?.visualFixtureIds ?? [])];
    objective.colliderIds = [...(action?.colliderIds ?? [])];
  }
}

function authoredFixtureColliderBounds(fixtureRecord) {
  const bounds = fixtureRecord.bounds;
  const size = {
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z,
  };
  if (fixtureRecord.subtype === 'heavy-catchment-support') {
    const columnWidth = Math.max(0.22, Math.min(0.48, Math.min(size.x, size.z) * 0.12));
    const closedX = fixtureRecord.openApproachSide === 'east'
      ? bounds.min.x + columnWidth * 0.5
      : bounds.max.x - columnWidth * 0.5;
    const pieces = [];
    for (const z of [
      bounds.min.z + columnWidth * 0.5,
      bounds.max.z - columnWidth * 0.5,
    ]) {
      pieces.push({
        min: vector(closedX - columnWidth * 0.5, bounds.min.y, z - columnWidth * 0.5),
        max: vector(closedX + columnWidth * 0.5, bounds.max.y, z + columnWidth * 0.5),
      });
    }
    for (const y of [bounds.min.y, bounds.max.y - columnWidth]) {
      pieces.push({
        min: vector(closedX - columnWidth * 0.5, y, bounds.min.z),
        max: vector(closedX + columnWidth * 0.5, y + columnWidth, bounds.max.z),
      });
    }
    return pieces;
  }
  if (fixtureRecord.type === 'mechanism-shaft-support') {
    const postWidth = Math.max(0.18, Math.min(0.32, Math.min(size.x, size.z) * 0.12));
    const beamHeight = Math.max(0.18, Math.min(0.3, size.y * 0.12));
    const pieces = [];
    for (const x of [bounds.min.x + postWidth * 0.5, bounds.max.x - postWidth * 0.5]) {
      for (const z of [bounds.min.z + postWidth * 0.5, bounds.max.z - postWidth * 0.5]) pieces.push({ min: vector(x - postWidth * 0.5, bounds.min.y, z - postWidth * 0.5), max: vector(x + postWidth * 0.5, bounds.max.y, z + postWidth * 0.5) });
    }
    for (const y of [bounds.min.y + beamHeight * 0.5, bounds.max.y - beamHeight * 0.5]) {
      for (const z of [bounds.min.z + postWidth * 0.5, bounds.max.z - postWidth * 0.5]) pieces.push({ min: vector(bounds.min.x, y - beamHeight * 0.5, z - postWidth * 0.5), max: vector(bounds.max.x, y + beamHeight * 0.5, z + postWidth * 0.5) });
    }
    return pieces;
  }
  if (fixtureRecord.type === 'overhead-track-support') {
    const postWidth = Math.max(0.2, Math.min(0.34, Math.min(size.x, size.z) * 0.14));
    const railHeight = Math.max(0.2, Math.min(0.36, size.y * 0.14));
    const alongX = size.x >= size.z;
    const pieces = [];
    for (const x of [bounds.min.x + postWidth * 0.5, bounds.max.x - postWidth * 0.5]) {
      for (const z of [bounds.min.z + postWidth * 0.5, bounds.max.z - postWidth * 0.5]) pieces.push({ min: vector(x - postWidth * 0.5, bounds.min.y, z - postWidth * 0.5), max: vector(x + postWidth * 0.5, bounds.max.y, z + postWidth * 0.5) });
    }
    const centerX = (bounds.min.x + bounds.max.x) * 0.5;
    const centerZ = (bounds.min.z + bounds.max.z) * 0.5;
    pieces.push({
      min: vector(alongX ? bounds.min.x : centerX - postWidth * 0.5, bounds.max.y - railHeight, alongX ? centerZ - postWidth * 0.5 : bounds.min.z),
      max: vector(alongX ? bounds.max.x : centerX + postWidth * 0.5, bounds.max.y, alongX ? centerZ + postWidth * 0.5 : bounds.max.z),
    });
    return pieces;
  }
  if (fixtureRecord.type === 'structural-support') {
    const columnWidth = Math.max(0.22, Math.min(0.48, Math.min(size.x, size.z) * 0.12));
    const pieces = [];
    for (const x of [bounds.min.x + columnWidth * 0.5, bounds.max.x - columnWidth * 0.5]) {
      for (const z of [bounds.min.z + columnWidth * 0.5, bounds.max.z - columnWidth * 0.5]) pieces.push({ min: vector(x - columnWidth * 0.5, bounds.min.y, z - columnWidth * 0.5), max: vector(x + columnWidth * 0.5, bounds.max.y, z + columnWidth * 0.5) });
    }
    // Raised landings use two lateral beams parallel to their approach. They
    // visibly brace the deck while leaving a full central stair/ladder bay.
    const includeXBeams = fixtureRecord.openApproachAxis !== 'z';
    const includeZBeams = fixtureRecord.openApproachAxis !== 'x';
    if (includeXBeams) {
      for (const z of [bounds.min.z, bounds.max.z - columnWidth]) {
        pieces.push({
          min: vector(bounds.min.x, bounds.max.y - columnWidth, z),
          max: vector(bounds.max.x, bounds.max.y, z + columnWidth),
        });
      }
    }
    if (includeZBeams) {
      for (const x of [bounds.min.x, bounds.max.x - columnWidth]) {
        pieces.push({
          min: vector(x, bounds.max.y - columnWidth, bounds.min.z),
          max: vector(x + columnWidth, bounds.max.y, bounds.max.z),
        });
      }
    }
    return pieces;
  }
  return [bounds];
}

function planarPointInsideBounds(point, bounds, tolerance = 0.001) {
  return Boolean(point && bounds
    && point.x >= bounds.min.x - tolerance
    && point.x <= bounds.max.x + tolerance
    && point.z >= bounds.min.z - tolerance
    && point.z <= bounds.max.z + tolerance);
}

function planarDistanceSquaredToBounds(point, bounds) {
  const dx = point.x < bounds.min.x ? bounds.min.x - point.x
    : point.x > bounds.max.x ? point.x - bounds.max.x : 0;
  const dz = point.z < bounds.min.z ? bounds.min.z - point.z
    : point.z > bounds.max.z ? point.z - bounds.max.z : 0;
  return dx * dx + dz * dz;
}

function clampStairEndpointToDeck(point, surface, overlap = STAIR_ENDPOINT_OVERLAP) {
  const bounds = surface?.bounds;
  if (!bounds) throw new Error(`Stair endpoint references missing surface ${surface?.id ?? '<unknown>'}.`);
  const width = bounds.max.x - bounds.min.x;
  const depth = bounds.max.z - bounds.min.z;
  if (width + 1e-6 < overlap * 2 || depth + 1e-6 < overlap * 2) {
    throw new Error(`Stair endpoint surface ${surface.id} cannot provide ${overlap}m overlap on every side.`);
  }
  return vector(
    Math.min(bounds.max.x - overlap, Math.max(bounds.min.x + overlap, point.x)),
    bounds.max.y,
    Math.min(bounds.max.z - overlap, Math.max(bounds.min.z + overlap, point.z)),
  );
}

function stairEndpointCandidates(surface, preferred, overlap) {
  const bounds = surface.bounds;
  const minX = bounds.min.x + overlap;
  const maxX = bounds.max.x - overlap;
  const minZ = bounds.min.z + overlap;
  const maxZ = bounds.max.z - overlap;
  const candidates = [clampStairEndpointToDeck(preferred, surface, overlap)];
  for (const xRatio of [0, 0.25, 0.5, 0.75, 1]) {
    for (const zRatio of [0, 0.25, 0.5, 0.75, 1]) {
      candidates.push(vector(
        minX + (maxX - minX) * xRatio,
        bounds.max.y,
        minZ + (maxZ - minZ) * zRatio,
      ));
    }
  }
  const seen = new Set();
  return candidates.filter((point) => {
    const key = `${point.x.toFixed(4)}:${point.z.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stairRunSatisfiesEnvelope(start, end, geometry) {
  const run = Math.hypot(end.x - start.x, end.z - start.z);
  const rise = Math.abs(end.y - start.y);
  const maximumRiser = Number(geometry.maxRiser ?? geometry.maximumRiser);
  const minimumTread = Number(geometry.minimumTread);
  const minimumSteps = Math.max(1, Math.ceil(rise / maximumRiser - 1e-6));
  return Number.isFinite(run) && run > 0
    && Number.isFinite(maximumRiser) && maximumRiser > 0
    && Number.isFinite(minimumTread) && minimumTread > 0
    && run + 1e-6 >= minimumSteps * minimumTread;
}

function stairCapsuleIntersectsFixture(start, end, fixtureRecord) {
  if (fixtureRecord.collision !== 'blocking') return false;
  const length = Math.hypot(end.x - start.x, end.z - start.z);
  const sampleCount = Math.max(1, Math.ceil(length / 0.21));
  const radius = 0.46;
  const colliderBounds = fixtureRecord.colliderBounds?.length
    ? fixtureRecord.colliderBounds
    : authoredFixtureColliderBounds(fixtureRecord);
  for (const bounds of colliderBounds) {
    for (let index = 0; index <= sampleCount; index += 1) {
      const progress = index / sampleCount;
      const x = start.x + (end.x - start.x) * progress;
      const y = start.y + (end.y - start.y) * progress;
      const z = start.z + (end.z - start.z) * progress;
      if (bounds.max.y <= y + 0.03 || bounds.min.y >= y + 3.2 - 0.005) continue;
      const dx = Math.max(bounds.min.x - x, 0, x - bounds.max.x);
      const dz = Math.max(bounds.min.z - z, 0, z - bounds.max.z);
      if (dx * dx + dz * dz < radius * radius - 1e-8) return true;
    }
  }
  return false;
}

function stairCapsuleFitsOpening(point, opening, boundarySide, radius = 0.46) {
  const center = opening.center;
  const dimensions = opening.dimensions ?? {};
  const bodyBottom = point.y + 0.03;
  const bodyTop = point.y + 3.2;
  if (boundarySide === 'north' || boundarySide === 'south') {
    return Math.abs(point.x - center.x) + radius <= Number(dimensions.width) * 0.5 + 1e-6
      && bodyBottom >= center.y - Number(dimensions.height) * 0.5 - 1e-6
      && bodyTop <= center.y + Number(dimensions.height) * 0.5 + 1e-6;
  }
  if (boundarySide === 'east' || boundarySide === 'west') {
    return Math.abs(point.z - center.z) + radius <= Number(dimensions.width) * 0.5 + 1e-6
      && bodyBottom >= center.y - Number(dimensions.height) * 0.5 - 1e-6
      && bodyTop <= center.y + Number(dimensions.height) * 0.5 + 1e-6;
  }
  return Math.abs(point.x - center.x) + radius <= Number(dimensions.width) * 0.5 + 1e-6
    && Math.abs(point.z - center.z) + radius <= Number(dimensions.depth) * 0.5 + 1e-6;
}

function stairCapsuleIntersectsBoundary(start, end, boundary) {
  if (boundary.collider === false) return false;
  const bounds = boundary.bounds;
  const length = Math.hypot(end.x - start.x, end.z - start.z);
  const sampleCount = Math.max(1, Math.ceil(length / 0.21));
  const radius = 0.46;
  for (let index = 0; index <= sampleCount; index += 1) {
    const progress = index / sampleCount;
    const point = {
      x: start.x + (end.x - start.x) * progress,
      y: start.y + (end.y - start.y) * progress,
      z: start.z + (end.z - start.z) * progress,
    };
    if (bounds.max.y <= point.y + 0.03 || bounds.min.y >= point.y + 3.2 - 0.005) continue;
    const dx = Math.max(bounds.min.x - point.x, 0, point.x - bounds.max.x);
    const dz = Math.max(bounds.min.z - point.z, 0, point.z - bounds.max.z);
    if (dx * dx + dz * dz >= radius * radius - 1e-8) continue;
    if ((boundary.openings ?? []).some((opening) => (
      stairCapsuleFitsOpening(point, opening, boundary.side, radius)
    ))) continue;
    return true;
  }
  return false;
}

function chooseClearStairEndpoints({ stair, geometry, startSurface, endSurface, originalStart, originalEnd, fixtures, boundaries }) {
  const overlap = Number(geometry.minimumEndpointOverlap ?? STAIR_ENDPOINT_OVERLAP);
  const fallbackStart = clampStairEndpointToDeck(originalStart, startSurface, overlap);
  const fallbackEnd = clampStairEndpointToDeck(originalEnd, endSurface, overlap);
  // Connector galleries are already centered in a narrow, enclosed cell; a
  // room-scale detour search would move them into their side wall.  Their
  // endpoints still receive the exact top/overlap binding below.
  if (stair.id.startsWith('surface.connector.')) return [fallbackStart, fallbackEnd];
  const blockers = fixtures.filter((fixtureRecord) => (
    fixtureRecord.regionId === stair.regionId && fixtureRecord.collision === 'blocking'
  ));
  const boundaryBlockers = boundaries.filter((boundary) => (
    boundary.regionId === stair.regionId && boundary.collider !== false
  ));
  const pairs = [];
  for (const start of stairEndpointCandidates(startSurface, originalStart, overlap)) {
    for (const end of stairEndpointCandidates(endSurface, originalEnd, overlap)) {
      if (!stairRunSatisfiesEnvelope(start, end, geometry)) continue;
      const obstructionCount = blockers.filter((fixtureRecord) => (
        stairCapsuleIntersectsFixture(start, end, fixtureRecord)
      )).length + boundaryBlockers.filter((boundary) => (
        stairCapsuleIntersectsBoundary(start, end, boundary)
      )).length;
      const authoredDeviation = Math.hypot(start.x - originalStart.x, start.z - originalStart.z)
        + Math.hypot(end.x - originalEnd.x, end.z - originalEnd.z);
      pairs.push({ start, end, obstructionCount, authoredDeviation });
    }
  }
  pairs.sort((left, right) => left.obstructionCount - right.obstructionCount
    || left.authoredDeviation - right.authoredDeviation);
  const selected = pairs[0];
  if (!selected || selected.obstructionCount > 0) {
    if (globalThis?.process?.env?.DEBUG_V2_STAIRS === '1') {
      console.error('V2 stair candidates', stair.id, pairs.slice(0, 12).map((entry) => ({
        start: entry.start,
        end: entry.end,
        obstructionCount: entry.obstructionCount,
        fixtures: blockers.filter((fixtureRecord) => stairCapsuleIntersectsFixture(entry.start, entry.end, fixtureRecord)).map((fixtureRecord) => fixtureRecord.id),
        boundaries: boundaryBlockers.filter((boundary) => stairCapsuleIntersectsBoundary(entry.start, entry.end, boundary)).map((boundary) => boundary.id),
      })));
      console.error('V2 stair east candidates', pairs.filter((entry) => entry.start.x > (startSurface.bounds.max.x - 2)).slice(0, 12).map((entry) => ({
        start: entry.start,
        end: entry.end,
        obstructionCount: entry.obstructionCount,
        fixtures: blockers.filter((fixtureRecord) => stairCapsuleIntersectsFixture(entry.start, entry.end, fixtureRecord)).map((fixtureRecord) => fixtureRecord.id),
        boundaries: boundaryBlockers.filter((boundary) => stairCapsuleIntersectsBoundary(entry.start, entry.end, boundary)).map((boundary) => boundary.id),
      })));
    }
    const diagnosticStart = selected?.start ?? fallbackStart;
    const diagnosticEnd = selected?.end ?? fallbackEnd;
    const obstructionIds = blockers
      .filter((fixtureRecord) => stairCapsuleIntersectsFixture(diagnosticStart, diagnosticEnd, fixtureRecord))
      .map((fixtureRecord) => fixtureRecord.id);
    const boundaryIds = boundaryBlockers
      .filter((boundary) => stairCapsuleIntersectsBoundary(diagnosticStart, diagnosticEnd, boundary))
      .map((boundary) => boundary.id);
    const blockerIds = [...obstructionIds, ...boundaryIds];
    const routeDiagnostic = `${diagnosticStart.x.toFixed(2)},${diagnosticStart.y.toFixed(2)},${diagnosticStart.z.toFixed(2)} -> ${diagnosticEnd.x.toFixed(2)},${diagnosticEnd.y.toFixed(2)},${diagnosticEnd.z.toFixed(2)}`;
    throw new Error(`Stair ${stair.id} has no fixture-clear player-capsule route (${routeDiagnostic})${blockerIds.length ? `; least-obstructed route blocked by ${blockerIds.join(', ')}` : ''}.`);
  }
  return [selected.start, selected.end];
}

export function bindStairsToExactDeckSeams(spatial, { ignoredSurfaceIds = new Set() } = {}) {
  const surfaces = new Map(spatial.walkableSurfaces.map((surface) => [surface.id, surface]));
  const stairSurfaces = spatial.walkableSurfaces.filter((surface) => (
    !ignoredSurfaceIds.has(surface.id)
    && (['stairs', 'walkable-stairs'].includes(surface.geometry?.type) || surface.stairs)
  ));
  for (const stair of stairSurfaces) {
    const geometry = stair.stairs ?? stair.geometry;
    const path = geometry.path ?? [geometry.start, geometry.end];
    if (!Array.isArray(path) || path.length < 2) {
      throw new Error(`Stair ${stair.id} has no authored endpoint path.`);
    }
    const originalStart = path[0];
    const originalEnd = path[path.length - 1];
    let startSurfaceId = geometry.endpointSurfaceIds?.start ?? null;
    let endSurfaceId = geometry.endpointSurfaceIds?.end ?? null;

    if (!startSurfaceId || !endSurfaceId) {
      const candidates = [];
      for (const link of spatial.traversalLinks) {
        if (link.viaSurfaceId === stair.id) {
          candidates.push(link.fromSurfaceId, link.toSurfaceId);
        }
        if (link.fromSurfaceId === stair.id) candidates.push(link.toSurfaceId);
        if (link.toSurfaceId === stair.id) candidates.push(link.fromSurfaceId);
      }
      const unique = [...new Set(candidates.filter((id) => id && id !== stair.id && surfaces.has(id)))];
      if (unique.length !== 2) {
        throw new Error(`Stair ${stair.id} must resolve exactly two physical deck surfaces; found ${unique.join(', ') || 'none'}.`);
      }
      const [leftId, rightId] = unique;
      const left = surfaces.get(leftId);
      const right = surfaces.get(rightId);
      const directCost = planarDistanceSquaredToBounds(originalStart, left.bounds)
        + planarDistanceSquaredToBounds(originalEnd, right.bounds);
      const reverseCost = planarDistanceSquaredToBounds(originalStart, right.bounds)
        + planarDistanceSquaredToBounds(originalEnd, left.bounds);
      [startSurfaceId, endSurfaceId] = directCost <= reverseCost
        ? [leftId, rightId]
        : [rightId, leftId];
    }

    const startSurface = surfaces.get(startSurfaceId);
    const endSurface = surfaces.get(endSurfaceId);
    if (!startSurface || !endSurface || startSurface === stair || endSurface === stair) {
      throw new Error(`Stair ${stair.id} has invalid endpoint surfaces ${startSurfaceId} -> ${endSurfaceId}.`);
    }
    const minimumOverlap = Number(geometry.minimumEndpointOverlap ?? STAIR_ENDPOINT_OVERLAP);
    const [start, end] = chooseClearStairEndpoints({
      stair,
      geometry,
      startSurface,
      endSurface,
      originalStart,
      originalEnd,
      fixtures: spatial.structuralFixtures,
      boundaries: spatial.structuralBoundaries,
    });
    const run = Math.hypot(end.x - start.x, end.z - start.z);
    const rise = Math.abs(end.y - start.y);
    const maximumRiser = Number(geometry.maxRiser ?? geometry.maximumRiser);
    const minimumTread = Number(geometry.minimumTread);
    const minimumSteps = Math.max(1, Math.ceil(rise / maximumRiser - 1e-6));
    if (!Number.isFinite(run) || run <= 0
      || !Number.isFinite(maximumRiser) || maximumRiser <= 0
      || !Number.isFinite(minimumTread) || minimumTread <= 0
      || run + 1e-6 < minimumSteps * minimumTread) {
      throw new Error(`Stair ${stair.id} cannot join its exact deck tops without violating its riser/tread envelope (run ${run.toFixed(3)}m, rise ${rise.toFixed(3)}m, requires ${(minimumSteps * minimumTread).toFixed(3)}m).`);
    }
    geometry.path = [start, end];
    geometry.endpointSurfaceIds = { start: startSurfaceId, end: endSurfaceId };
    geometry.minimumEndpointOverlap = minimumOverlap;
    geometry.maximumEndpointHeightDelta = STAIR_ENDPOINT_HEIGHT_TOLERANCE;
    geometry.minimumUsableSeamWidth = Math.min(
      Number(geometry.width),
      startSurface.bounds.max.x - startSurface.bounds.min.x,
      startSurface.bounds.max.z - startSurface.bounds.min.z,
      endSurface.bounds.max.x - endSurface.bounds.min.x,
      endSurface.bounds.max.z - endSurface.bounds.min.z,
    );

    // Keep spatial queries and floor-tile generation tight to the real ramp
    // strip rather than the old room-sized approximation.
    const direction = { x: (end.x - start.x) / run, z: (end.z - start.z) / run };
    const tangent = { x: -direction.z, z: direction.x };
    const halfWidth = Number(geometry.width) * 0.5;
    stair.bounds = {
      min: vector(
        Math.min(start.x, end.x) - Math.abs(tangent.x) * halfWidth,
        Math.min(start.y, end.y) - 0.12,
        Math.min(start.z, end.z) - Math.abs(tangent.z) * halfWidth,
      ),
      max: vector(
        Math.max(start.x, end.x) + Math.abs(tangent.x) * halfWidth,
        Math.max(start.y, end.y),
        Math.max(start.z, end.z) + Math.abs(tangent.z) * halfWidth,
      ),
    };
  }
}

function bindGroundApproachesToAuthoredStairs(
  spatial,
  portals,
  encounters = [],
  { ignoredTraversalLinkIds = new Set() } = {},
) {
  const surfaces = new Map(spatial.walkableSurfaces.map((surface) => [surface.id, surface]));
  const capsuleRadius = 0.46;
  const sampleSpacing = 0.21;
  for (const link of spatial.traversalLinks) {
    if (ignoredTraversalLinkIds.has(link.id)) continue;
    if (!['stairs', 'walkable-stairs'].includes(link.mode) || !link.viaSurfaceId) continue;
    const stair = surfaces.get(link.viaSurfaceId);
    const sourceSurface = surfaces.get(link.fromSurfaceId);
    const geometry = stair?.stairs ?? stair?.geometry;
    const path = geometry?.path;
    if (!stair || !sourceSurface || !Array.isArray(path) || path.length < 2) continue;
    // This field is a forward, lower-deck ingress contract. Reverse traversal
    // still follows the authored ramp path onto its already-wide upper deck.
    if (geometry.endpointSurfaceIds?.start !== link.fromSurfaceId
      || path[0].y > path.at(-1).y + STAIR_ENDPOINT_HEIGHT_TOLERANCE) continue;

    const foot = path[0];
    const upper = path.at(-1);
    const run = Math.hypot(upper.x - foot.x, upper.z - foot.z);
    if (run <= 0.001) continue;
    const uphill = { x: (upper.x - foot.x) / run, z: (upper.z - foot.z) / run };
    const blockers = spatial.structuralFixtures.filter((fixtureRecord) => (
      fixtureRecord.regionId === stair.regionId && fixtureRecord.collision === 'blocking'
    ));
    const boundaries = spatial.structuralBoundaries.filter((boundary) => (
      boundary.regionId === stair.regionId && boundary.collider !== false
    ));
    const insideSourceDeck = (point) => (
      point.x >= sourceSurface.bounds.min.x + capsuleRadius
      && point.x <= sourceSurface.bounds.max.x - capsuleRadius
      && point.z >= sourceSurface.bounds.min.z + capsuleRadius
      && point.z <= sourceSurface.bounds.max.z - capsuleRadius
      && Math.abs(point.y - sourceSurface.bounds.max.y) <= STAIR_ENDPOINT_HEIGHT_TOLERANCE
    );
    const clearCandidate = (staging) => {
      const distance = Math.hypot(foot.x - staging.x, foot.z - staging.z);
      const sampleCount = Math.max(1, Math.ceil(distance / sampleSpacing));
      for (let index = 0; index <= sampleCount; index += 1) {
        const progress = index / sampleCount;
        const point = vector(
          staging.x + (foot.x - staging.x) * progress,
          foot.y,
          staging.z + (foot.z - staging.z) * progress,
        );
        if (!insideSourceDeck(point)) return false;
        if (index < sampleCount) {
          const longitudinal = (point.x - foot.x) * uphill.x + (point.z - foot.z) * uphill.z;
          if (longitudinal >= -0.025) return false;
        }
      }
      return !blockers.some((fixtureRecord) => stairCapsuleIntersectsFixture(staging, foot, fixtureRecord))
        && !boundaries.some((boundary) => stairCapsuleIntersectsBoundary(staging, foot, boundary));
    };

    const staging = [2.4, 2.2, 1.8, 1.4, 1, 0.7]
      .map((distance) => vector(
        foot.x - uphill.x * distance,
        foot.y,
        foot.z - uphill.z * distance,
      ))
      .find(clearCandidate);
    if (!staging) {
      if (link.id === 'traversal.assembly.landmark-stairs') {
        throw new Error(`${link.id} has no capsule-clear plan-owned ground approach to its stair foot.`);
      }
      continue;
    }
    let approachWaypoints = [staging, vector(foot.x, foot.y, foot.z)];
    let approachSurfaceIds = approachWaypoints.map(() => sourceSurface.id);
    let approachSegments = [{
      fromWaypointIndex: 0,
      toWaypointIndex: 1,
      surfaceIds: [sourceSurface.id],
      seamWidth: null,
    }];
    let ingressPortalId = null;
    let ingressPoint = null;
    let ingressSurfaceIds = [];
    let combatRejoin = null;
    if (link.id === 'traversal.assembly.landmark-stairs') {
      const eastFloor = surfaces.get('surface.assembly.floor-east');
      const southFloor = surfaces.get('surface.assembly.floor-south');
      if (!eastFloor || !southFloor) {
        throw new Error(`${link.id} requires the authored east and south circulation floor fragments.`);
      }
      const circulationZ = Math.min(
        eastFloor.bounds.max.z,
        southFloor.bounds.max.z,
        sourceSurface.bounds.max.z,
      ) - 2.5;
      ingressPortalId = 'portal.security-assembly';
      const ingressPortal = portals.find(({ id }) => id === ingressPortalId);
      const ingressEndpoint = ingressPortal?.to;
      const ingressRoutePoints = ingressPortal?.physicalRoute?.routePoints ?? [];
      const ingressApproachPoint = [...ingressRoutePoints].reverse().find((point) => (
        Math.hypot(
          point.x - Number(ingressEndpoint?.center?.x),
          point.z - Number(ingressEndpoint?.center?.z),
        ) > 0.05
      ));
      const ingressDepth = Number(ingressPortal?.traversal?.interiorIngressDepth);
      const ingressDeltaX = Number(ingressEndpoint?.center?.x) - Number(ingressApproachPoint?.x);
      const ingressDeltaZ = Number(ingressEndpoint?.center?.z) - Number(ingressApproachPoint?.z);
      const ingressHorizontalLength = Math.hypot(ingressDeltaX, ingressDeltaZ);
      if (!ingressPortal || !ingressEndpoint || !ingressApproachPoint
        || !Number.isFinite(ingressDepth) || ingressDepth < capsuleRadius
        || ingressHorizontalLength <= 0.05) {
        throw new Error(`${link.id} cannot resolve its plan-owned east portal ingress.`);
      }
      ingressPoint = vector(
        ingressEndpoint.center.x + (ingressDeltaX / ingressHorizontalLength) * ingressDepth,
        eastFloor.bounds.max.y,
        ingressEndpoint.center.z + (ingressDeltaZ / ingressHorizontalLength) * ingressDepth,
      );
      ingressSurfaceIds = [eastFloor.id];
      const encounter = encounters.find(({ id }) => id === 'encounter.assembly');
      const engagement = encounter?.entryEngagementContracts?.find(({ id }) => (
        id === 'engagement.assembly.entry-ground'
      ));
      const engagementSpawn = encounter?.spawnPoints?.[engagement?.spawnPointIndex];
      if (!engagement || !engagementSpawn
        || engagement.sourceTraversalLinkId !== link.id
        || engagement.surfaceId !== eastFloor.id) {
        throw new Error(`${link.id} cannot derive its combat rejoin from the Assembly entry engagement.`);
      }
      combatRejoin = {
        id: 'combat-rejoin.assembly.entry-ground',
        encounterId: encounter.id,
        engagementId: engagement.id,
        surfaceId: eastFloor.id,
        segmentStart: vector(ingressPoint.x, ingressPoint.y, ingressPoint.z),
        segmentEnd: vector(engagementSpawn.x, eastFloor.bounds.max.y, engagementSpawn.z),
        nextWaypointIndex: 1,
        minimumProgress: 0,
        maximumProgress: 1,
        maximumLateralOffset: 0.25,
        capsuleRadius: Number(engagement.capsuleRadius),
        capsuleHeight: Number(engagement.capsuleHeight),
        sampleSpacing: Math.min(sampleSpacing, Number(engagement.sampleSpacing)),
      };
      // Public portal traversal already finishes at the interior ingress
      // point. Continue from that exact position instead of sending the
      // player backwards toward the doorway jamb before turning south.
      const eastPoint = vector(eastFloor.bounds.max.x - 1.5, foot.y, circulationZ);
      const southPoint = vector(
        (southFloor.bounds.min.x + southFloor.bounds.max.x) * 0.5,
        foot.y,
        circulationZ,
      );
      const mainPoint = vector(sourceSurface.bounds.max.x - 1.4, foot.y, circulationZ);
      const sharedSeamWidth = (left, right) => {
        const sharedX = Math.min(left.bounds.max.x, right.bounds.max.x)
          - Math.max(left.bounds.min.x, right.bounds.min.x);
        const sharedZ = Math.min(left.bounds.max.z, right.bounds.max.z)
          - Math.max(left.bounds.min.z, right.bounds.min.z);
        const touchesX = Math.abs(left.bounds.max.x - right.bounds.min.x) <= 0.001
          || Math.abs(right.bounds.max.x - left.bounds.min.x) <= 0.001;
        const touchesZ = Math.abs(left.bounds.max.z - right.bounds.min.z) <= 0.001
          || Math.abs(right.bounds.max.z - left.bounds.min.z) <= 0.001;
        return touchesX ? sharedZ : touchesZ ? sharedX : -Infinity;
      };
      const eastSouthSeam = sharedSeamWidth(eastFloor, southFloor);
      const southMainSeam = sharedSeamWidth(southFloor, sourceSurface);
      if (eastSouthSeam < 1.2 || southMainSeam < 1.2) {
        throw new Error(`${link.id} requires capsule-wide east/south/main floor seams.`);
      }
      approachWaypoints = [ingressPoint, eastPoint, southPoint, mainPoint, ...approachWaypoints];
      approachSurfaceIds = [
        eastFloor.id,
        eastFloor.id,
        southFloor.id,
        sourceSurface.id,
        sourceSurface.id,
        sourceSurface.id,
      ];
      approachSegments = [
        { fromWaypointIndex: 0, toWaypointIndex: 1, surfaceIds: [eastFloor.id], seamWidth: null },
        { fromWaypointIndex: 1, toWaypointIndex: 2, surfaceIds: [eastFloor.id, southFloor.id], seamWidth: eastSouthSeam },
        { fromWaypointIndex: 2, toWaypointIndex: 3, surfaceIds: [southFloor.id, sourceSurface.id], seamWidth: southMainSeam },
        { fromWaypointIndex: 3, toWaypointIndex: 4, surfaceIds: [sourceSurface.id], seamWidth: null },
        { fromWaypointIndex: 4, toWaypointIndex: 5, surfaceIds: [sourceSurface.id], seamWidth: null },
      ];
    }
    for (const [index, point] of approachWaypoints.entries()) {
      const owner = surfaces.get(approachSurfaceIds[index]);
      const onOwnedSurface = owner
        && point.x >= owner.bounds.min.x + capsuleRadius - 1e-6
        && point.x <= owner.bounds.max.x - capsuleRadius + 1e-6
        && point.z >= owner.bounds.min.z + capsuleRadius - 1e-6
        && point.z <= owner.bounds.max.z - capsuleRadius + 1e-6
        && Math.abs(point.y - owner.bounds.max.y) <= STAIR_ENDPOINT_HEIGHT_TOLERANCE;
      if (!onOwnedSurface) {
        throw new Error(`${link.id} approach waypoint ${index} is not capsule-contained by ${approachSurfaceIds[index]}.`);
      }
    }
    const halfStairWidth = Number(geometry.width) * 0.5;
    for (const segment of approachSegments) {
      const segmentStart = approachWaypoints[segment.fromWaypointIndex];
      const segmentEnd = approachWaypoints[segment.toWaypointIndex];
      const segmentSurfaces = segment.surfaceIds.map((idForSurface) => surfaces.get(idForSurface));
      const distance = Math.hypot(segmentEnd.x - segmentStart.x, segmentEnd.z - segmentStart.z);
      const sampleCount = Math.max(1, Math.ceil(distance / sampleSpacing));
      for (let index = 0; index <= sampleCount; index += 1) {
        const progress = index / sampleCount;
        const point = vector(
          segmentStart.x + (segmentEnd.x - segmentStart.x) * progress,
          segmentStart.y + (segmentEnd.y - segmentStart.y) * progress,
          segmentStart.z + (segmentEnd.z - segmentStart.z) * progress,
        );
        const supported = segmentSurfaces.some((surface) => surface
          && point.x >= surface.bounds.min.x - 1e-6
          && point.x <= surface.bounds.max.x + 1e-6
          && point.z >= surface.bounds.min.z - 1e-6
          && point.z <= surface.bounds.max.z + 1e-6
          && Math.abs(point.y - surface.bounds.max.y) <= STAIR_ENDPOINT_HEIGHT_TOLERANCE);
        if (!supported) {
          throw new Error(`${link.id} approach segment ${segment.fromWaypointIndex}-${segment.toWaypointIndex} leaves its declared surfaces.`);
        }
        if (index < sampleCount) {
          const relativeX = point.x - foot.x;
          const relativeZ = point.z - foot.z;
          const longitudinal = relativeX * uphill.x + relativeZ * uphill.z;
          const lateral = Math.abs(relativeX * -uphill.z + relativeZ * uphill.x);
          const stairRiseAtPoint = longitudinal > 0 && longitudinal < run
            ? (upper.y - foot.y) * (longitudinal / run)
            : 0;
          if (longitudinal >= 0 && longitudinal <= run
            && lateral < halfStairWidth + capsuleRadius
            && stairRiseAtPoint > 0.24) {
            throw new Error(`${link.id} approach segment enters the raised stair before its foot.`);
          }
        }
      }
      const fixtureBlockerIds = blockers
        .filter((fixtureRecord) => stairCapsuleIntersectsFixture(segmentStart, segmentEnd, fixtureRecord))
        .map((fixtureRecord) => fixtureRecord.id);
      const boundaryBlockerIds = boundaries
        .filter((boundary) => stairCapsuleIntersectsBoundary(segmentStart, segmentEnd, boundary))
        .map((boundary) => boundary.id);
      if (fixtureBlockerIds.length || boundaryBlockerIds.length) {
        throw new Error(`${link.id} approach segment ${segment.fromWaypointIndex}-${segment.toWaypointIndex} intersects ${[...fixtureBlockerIds, ...boundaryBlockerIds].join(', ')}.`);
      }
    }
    link.approachWaypoints = approachWaypoints;
    link.approachSurfaceIds = approachSurfaceIds;
    link.approachSegments = approachSegments;
    if (link.id === 'traversal.security.security-sorting-alpha') {
      // The same grounded staging point is also the reverse egress contract.
      // A navigator descending from the gate must clear the final tread on a
      // straight supported line before it turns toward the Security floor;
      // otherwise an early diagonal turn can step off a still-elevated tread.
      const centerlineSegmentCount = Math.max(1, Math.ceil(run / 2.5));
      link.waypoints = Array.from({ length: centerlineSegmentCount + 1 }, (_, index) => {
        const progress = index / centerlineSegmentCount;
        return vector(
          foot.x + (upper.x - foot.x) * progress,
          foot.y + (upper.y - foot.y) * progress,
          foot.z + (upper.z - foot.z) * progress,
        );
      });
      link.reverseEgressWaypoints = [vector(staging.x, staging.y, staging.z)];
    }
    link.approachContract = {
      sourceSurfaceId: sourceSurface.id,
      stairSurfaceId: stair.id,
      ingressPortalId,
      ingressPoint,
      ingressDepth: ingressPortalId ? PORTAL_INTERIOR_INGRESS_DEPTH : null,
      ingressSurfaceIds,
      combatRejoin,
      sampleSpacing,
      capsuleRadius,
      groundedOnly: true,
      jumpAllowed: false,
      ledgeClimbAllowed: false,
    };
  }
}

function finalizeStructuralFixtureRuntimeIds(structuralFixtures) {
  for (const fixtureRecord of structuralFixtures) {
    fixtureRecord.visualId ??= `visual.${fixtureRecord.id}`;
    fixtureRecord.visualIds ??= [fixtureRecord.visualId];
    if (fixtureRecord.collision === false) {
      fixtureRecord.colliderIds ??= [];
      fixtureRecord.colliderBounds ??= [];
      continue;
    }
    fixtureRecord.colliderBounds ??= authoredFixtureColliderBounds(fixtureRecord);
    fixtureRecord.colliderIds ??= fixtureRecord.colliderBounds.map((_, index) => `collider.${fixtureRecord.id}.${index}`);
  }
}

const NATIVE_EXTRACTION_PLACEMENT_ID = 'placement.extraction';
const NATIVE_EXTRACTION_DESCRIPTOR_ID = 'v1-room.refractor-shrine';
const NATIVE_EXTRACTION_CELL_ID = 'cell.extraction.main';
const NATIVE_EXTRACTION_SOCKET_SUFFIX = '.catwalk.north-east-bucket';
const NATIVE_ASSEMBLY_PLACEMENT_ID = 'placement.assembly';
const NATIVE_ASSEMBLY_DESCRIPTOR_ID = 'v1-room.machine-factory';
const NATIVE_ASSEMBLY_CELL_ID = 'cell.assembly.main';
const NATIVE_SECURITY_PLACEMENT_ID = 'placement.security';
const NATIVE_SECURITY_DESCRIPTOR_ID = 'v1-room.security-entrance';
const NATIVE_SECURITY_CELL_ID = 'cell.security.main';
const NATIVE_SERVER_PLACEMENT_ID = 'placement.server';
const NATIVE_SERVER_DESCRIPTOR_ID = 'v1-room.server-crypt';
const NATIVE_SERVER_CELL_ID = 'cell.server.main';

function unionContractBounds(records) {
  return records.reduce((result, record) => ({
    min: {
      x: Math.min(result.min.x, record.bounds.min.x),
      y: Math.min(result.min.y, record.bounds.min.y),
      z: Math.min(result.min.z, record.bounds.min.z),
    },
    max: {
      x: Math.max(result.max.x, record.bounds.max.x),
      y: Math.max(result.max.y, record.bounds.max.y),
      z: Math.max(result.max.z, record.bounds.max.z),
    },
  }), {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  });
}

function distanceFromPointToBounds2d(point, bounds, side) {
  const axes = ['east', 'west'].includes(side) ? ['z', 'y']
    : ['north', 'south'].includes(side) ? ['x', 'y'] : ['x', 'z'];
  return Math.hypot(...axes.map((axis) => Math.max(
    bounds.min[axis] - point[axis],
    0,
    point[axis] - bounds.max[axis],
  )));
}

function shiftBounds(bounds, delta) {
  return {
    min: vector(bounds.min.x + delta.x, bounds.min.y + delta.y, bounds.min.z + delta.z),
    max: vector(bounds.max.x + delta.x, bounds.max.y + delta.y, bounds.max.z + delta.z),
  };
}

function nativeRoomSurfaceLinks(surfaces, regionId, placementId) {
  const links = [];
  const byTile = new Map();
  for (const surface of surfaces) {
    const tile = surface.localTile;
    if (!tile) continue;
    const key = `${tile.x}:${tile.z}`;
    const bucket = byTile.get(key) ?? [];
    bucket.push(surface);
    byTile.set(key, bucket);
  }
  const linkedPairs = new Set();
  const addPair = (left, right) => {
    if (!left || !right || left.id === right.id) return;
    const pair = [left.id, right.id].sort();
    const key = pair.join('|');
    if (linkedPairs.has(key)) return;
    const leftTop = left.bounds.max.y;
    const rightTop = right.bounds.max.y;
    const sameRamp = left.ramp?.routeId && left.ramp.routeId === right.ramp?.routeId
      && Math.abs((left.traversalRoute?.sequenceIndex ?? 0) - (right.traversalRoute?.sequenceIndex ?? 0)) === 1;
    if (!sameRamp && Math.abs(leftTop - rightTop) > 0.31) return;
    linkedPairs.add(key);
    links.push({
      id: `traversal.native-${regionId}.${links.length + 1}`,
      regionId,
      fromSurfaceId: left.id,
      toSurfaceId: right.id,
      mode: left.shape === 'ramp-tile' || right.shape === 'ramp-tile' ? 'walkable-stairs' : 'walk',
      bidirectional: true,
      minimumWidth: 1.2,
      nativeFixedRoomPlacementId: placementId,
    });
  };
  for (const surface of surfaces) {
    const tile = surface.localTile;
    if (!tile) continue;
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const candidate of byTile.get(`${tile.x + dx}:${tile.z + dz}`) ?? []) addPair(surface, candidate);
    }
  }
  return links;
}

/**
 * Replace one generic golden-region shell with an immutable compiled V1 room.
 * Portal routing and gameplay-anchor choices remain caller-owned, but every
 * native room shares this exact compile/replace/support/registry preparation.
 */
function prepareNativeFixedRoomRegionV2(plan, {
  descriptorId,
  placementId,
  regionId,
  cellId: nativeCellId,
  translation,
  yawQuarterTurns,
  localOpenSocketIds,
  authoredFixtureBindings = new Map(),
  preserveFixture = (fixtureRecord) => fixtureRecord.id.startsWith('fixture.interaction.'),
  semanticRegionIds = null,
}) {
  const module = getLegacyFixedRoomModuleV2(descriptorId);
  if (!module) throw new Error(`Missing native V1 module ${descriptorId}.`);
  const ownedSemanticRegionIds = [...new Set(
    semanticRegionIds ?? module.semanticRegions.map(({ id }) => id),
  )];
  if (!ownedSemanticRegionIds.includes(regionId)) {
    throw new Error(`${descriptorId} semantic mapping does not own primary region ${regionId}.`);
  }
  const structuralContract = compileLegacyFixedRoomStructuralContractV2(module, {
    openSocketIds: localOpenSocketIds,
  });
  const compiled = compileLegacyFixedRoomPlacementV2(module, {
    id: placementId,
    translation,
    yawQuarterTurns,
    structuralContract,
  });
  const placementRecord = {
    ...createLegacyFixedRoomPlanPlacementRecordV2(compiled, { semanticRegionIds: ownedSemanticRegionIds }),
    regionIds: ownedSemanticRegionIds,
    occupiedCellIds: [],
    nativeIntegrationStatus: 'playable-plan-owned',
  };
  const cell = plan.spatialCells.find(({ id }) => id === nativeCellId);
  const regionRecord = plan.regions.find(({ id }) => id === regionId);
  const minimapRegion = plan.minimap.regions.find(({ id }) => id === regionId);
  if (!cell || !regionRecord || !minimapRegion) {
    throw new Error(`Golden ${regionId} spatial ownership is incomplete.`);
  }
  for (const target of [cell, regionRecord, minimapRegion]) {
    target.bounds = structuredClone(compiled.worldBounds);
  }
  for (const semanticRegionId of ownedSemanticRegionIds) {
    const semanticRegion = plan.regions.find(({ id }) => id === semanticRegionId);
    const semanticMinimapRegion = plan.minimap.regions.find(({ id }) => id === semanticRegionId);
    if (!semanticRegion || !semanticMinimapRegion) {
      throw new Error(`${descriptorId} semantic region ${semanticRegionId} is missing from the accepted plan.`);
    }
    semanticRegion.modulePlacementId = placementId;
    semanticMinimapRegion.modulePlacementId = placementId;
  }
  const replacedCellIds = new Set(plan.spatialCells
    .filter((candidate) => (
      candidate.regionId === regionId
      && !candidate.id.startsWith('cell.connector.')
    ))
    .map(({ id }) => id));
  plan.spatialCells = plan.spatialCells.filter((candidate) => (
    !replacedCellIds.has(candidate.id) || candidate.id === nativeCellId
  ));
  plan.modulePlacements = [
    ...plan.modulePlacements.filter(({ regionIds }) => (
      !regionIds?.some((candidateRegionId) => ownedSemanticRegionIds.includes(candidateRegionId))
    )),
    placementRecord,
  ];
  placementRecord.occupiedCellIds = plan.spatialCells
    .filter((candidate) => (
      ownedSemanticRegionIds.includes(candidate.regionId)
      && candidate.connector !== true
      && !candidate.id.startsWith('cell.connector.')
    ))
    .map(({ id }) => id)
    .sort();

  const genericSurfaceIds = new Set(
    plan.walkableSurfaces
      .filter((surface) => replacedCellIds.has(surface.cellId))
      .map(({ id }) => id),
  );
  plan.structuralBoundaries = plan.structuralBoundaries.filter((boundary) => (
    !replacedCellIds.has(boundary.cellId)
  ));
  const nativeBoundaries = compiled.structuralBoundaries.map((boundary) => ({
    ...structuredClone(boundary),
    regionId,
    cellId: nativeCellId,
    kind: (boundary.openings?.length ?? 0) > 0 ? 'portal-frame' : 'solid',
    opaque: true,
    collider: true,
    collision: 'static',
    openings: structuredClone(boundary.openings ?? []),
  }));
  plan.structuralBoundaries.push(...nativeBoundaries);
  const nativeFloorBoundaries = nativeBoundaries.filter(({ side }) => side === 'floor');
  if (!nativeFloorBoundaries.length) throw new Error(`${descriptorId} has no native floor foundation.`);
  const supportBoundaryIds = nativeFloorBoundaries.map(({ id }) => id);

  const nativeFixtureGroups = new Map();
  for (const collider of compiled.fixtureColliders) {
    const group = nativeFixtureGroups.get(collider.fixtureId) ?? [];
    group.push(collider);
    nativeFixtureGroups.set(collider.fixtureId, group);
  }
  const detailProfile = GOLDEN_REGION_AUTHORED_DETAILS_V2[regionId];
  const nativeFixtures = [...nativeFixtureGroups].map(([fixtureId, colliders]) => {
    const nativeLocalFixtureId = colliders[0].localFixtureId;
    const authoredDetailId = authoredFixtureBindings.get(nativeLocalFixtureId) ?? null;
    const authoredDetail = detailProfile?.fixtures.find(({ id }) => id === authoredDetailId);
    return {
      id: fixtureId,
      type: authoredDetail?.type ?? 'legacy-fixed-room-fixture',
      nativeFixtureType: 'legacy-fixed-room-fixture',
      regionId,
      cellId: nativeCellId,
      bounds: unionContractBounds(colliders),
      gameplayPurpose: authoredDetail?.purpose
        ?? `native V1 ${module.displayName} fixture with exact plan-owned collision`,
      collision: 'blocking',
      supportBoundaryIds,
      visualId: `visual.${fixtureId}`,
      visualIds: [`visual.${fixtureId}`],
      colliderIds: colliders.map(({ id }) => id),
      colliderBounds: colliders.map(({ bounds }) => structuredClone(bounds)),
      presentationContractId: compiled.presentation.contractId,
      presentationOwnerId: placementId,
      descriptorReference: structuredClone(colliders[0].descriptorReference),
      ...(authoredDetail ? {
        authoredDetailId: authoredDetail.id,
        authoredSourceMaterial: detailProfile.sourceMaterial,
        assetFamilyId: detailProfile.assetFamilyId,
        authoredPresentationSource: 'native V1 descriptor fixture',
      } : {}),
    };
  });
  const preservedFixtures = plan.structuralFixtures
    .filter((fixtureRecord) => replacedCellIds.has(fixtureRecord.cellId) && preserveFixture(fixtureRecord))
    .map((fixtureRecord) => ({
      ...fixtureRecord,
      cellId: nativeCellId,
      supportBoundaryIds,
    }));
  plan.structuralFixtures = [
    ...plan.structuralFixtures.filter(({ cellId: ownerCellId }) => !replacedCellIds.has(ownerCellId)),
    ...nativeFixtures,
    ...preservedFixtures,
  ];

  const nativeSurfaces = compiled.walkableSurfaces.map((surface) => ({
    ...structuredClone(surface),
    regionId,
    cellId: nativeCellId,
    purpose: surface.purpose ?? `native V1 ${module.displayName} traversal surface`,
    supportBoundaryIds,
    supportFixtureIds: [],
    supportProfile: surface.support?.style ?? 'v1-authored-visible-support',
    visualProfile: surface.materialProfileId,
    collision: 'static',
    hazardTag: null,
    // Per-tile internal seams are not authored ledges. Enabling them produces
    // four ledge candidates per tile and lets correction warp across ramps.
    createsLedgeCandidates: false,
    ledgePolicy: 'native-internal-tile-seams-disabled',
  }));
  const nativeSupportContract = compileLegacyFixedRoomSupportContractsV2(compiled, {
    regionId,
    cellId: nativeCellId,
    floorBoundaryId: nativeFloorBoundaries[0].id,
  });
  for (const surface of nativeSurfaces) {
    surface.supportFixtureIds = [
      ...(nativeSupportContract.surfaceSupportFixtureIds[surface.id] ?? []),
    ];
  }
  plan.structuralFixtures.push(...structuredClone(nativeSupportContract.fixtures));
  plan.walkableSurfaces = [
    ...plan.walkableSurfaces.filter(({ id }) => !genericSurfaceIds.has(id)),
    ...nativeSurfaces,
  ];

  return {
    module,
    structuralContract,
    compiled,
    placementRecord,
    genericSurfaceIds,
    nativeBoundaries,
    nativeFloorBoundaries,
    nativeFixtures,
    preservedFixtures,
    nativeSurfaces,
    nativeSurfaceByLocalId: new Map(nativeSurfaces.map((surface) => [surface.localId, surface])),
    nativeSupportContract,
  };
}

function integrateNativeExtractionShrineV2(plan) {
  const module = getLegacyFixedRoomModuleV2(NATIVE_EXTRACTION_DESCRIPTOR_ID);
  if (!module) throw new Error(`Missing native V1 extraction module ${NATIVE_EXTRACTION_DESCRIPTOR_ID}.`);
  const openSocket = module.extensionSockets.find(({ id }) => id.endsWith(NATIVE_EXTRACTION_SOCKET_SUFFIX));
  if (!openSocket) throw new Error('Native V1 extraction module is missing its west mezzanine socket.');
  const native = prepareNativeFixedRoomRegionV2(plan, {
    descriptorId: NATIVE_EXTRACTION_DESCRIPTOR_ID,
    placementId: NATIVE_EXTRACTION_PLACEMENT_ID,
    regionId: 'extraction',
    cellId: NATIVE_EXTRACTION_CELL_ID,
    translation: { x: 220, y: 16, z: 0 },
    yawQuarterTurns: 1,
    localOpenSocketIds: [openSocket.id],
    authoredFixtureBindings: new Map([
      ['fixture.v1-room.refractor-shrine.focal-pillar-1', 'shrine-pylon-west'],
      ['fixture.v1-room.refractor-shrine.focal-pillar-2', 'shrine-pylon-east'],
      ['fixture.v1-room.refractor-shrine.north-cylinder-arch', 'shrine-conduit'],
    ]),
  });
  const {
    compiled,
    genericSurfaceIds: genericExtractionSurfaceIds,
    nativeBoundaries,
    nativeFloorBoundaries,
    preservedFixtures: interactionFixtures,
    nativeSurfaces,
    nativeSurfaceByLocalId,
  } = native;

  const nativeSocket = compiled.portals.find(({ localId }) => localId === openSocket.id);
  const portal = plan.portals.find(({ id }) => id === 'portal.machine-core-extraction-shrine');
  if (!nativeSocket || !portal) throw new Error('Native extraction socket cannot bind the Shrine portal.');
  const nativeFloorBoundary = nativeFloorBoundaries[0];
  if (!nativeFloorBoundary) throw new Error('Native V1 shrine has no plan-owned floor foundation.');
  const portalBoundary = nativeBoundaries
    .filter(({ side }) => side === nativeSocket.boundarySide)
    .sort((left, right) => (
      distanceFromPointToBounds2d(nativeSocket.anchor, left.bounds, left.side)
      - distanceFromPointToBounds2d(nativeSocket.anchor, right.bounds, right.side)
    ))[0];
  if (!portalBoundary) throw new Error('Native extraction socket has no authored wall segments.');
  const openingCenter = vector(
    nativeSocket.anchor.x,
    nativeSocket.anchor.y + nativeSocket.opening.height * 0.5,
    nativeSocket.anchor.z,
  );
  portalBoundary.openings.push({
    id: 'opening.machine-core-extraction-shrine.to-native-v1',
    portalId: portal.id,
    center: openingCenter,
    dimensions: {
      width: nativeSocket.opening.width,
      height: nativeSocket.opening.height,
      depth: portal.to.dimensions.depth,
    },
    descriptorSocketId: nativeSocket.id,
  });
  portalBoundary.kind = 'portal-frame';
  const inletSurface = nativeSurfaces
    .filter((surface) => nativeSocket.approachSurfaceIds.includes(surface.id)
      && Math.abs(surface.bounds.max.y - nativeSocket.anchor.y) <= 0.051)
    .sort((left, right) => (
      planarDistanceSquaredToBounds(nativeSocket.anchor, left.bounds)
      - planarDistanceSquaredToBounds(nativeSocket.anchor, right.bounds)
      || left.id.localeCompare(right.id)
    ))[0]
    ?? nativeSurfaces
      .filter(({ id }) => nativeSocket.approachSurfaceIds.includes(id))
      .sort((left, right) => (
        planarDistanceSquaredToBounds(nativeSocket.anchor, left.bounds)
        - planarDistanceSquaredToBounds(nativeSocket.anchor, right.bounds)
        || left.id.localeCompare(right.id)
      ))[0];
  if (!inletSurface) throw new Error('Native V1 shrine socket has no accepted approach surface.');
  // This one surface is the plan-owned extraction-side throat for a closed
  // Shrine Key gate. Preserve native room traversal everywhere else while
  // prohibiting the generic ledge resolver from vaulting across this barrier.
  inletSurface.createsLedgeCandidates = false;
  inletSurface.closedGatePortalIds = [portal.id];

  portal.to = {
    ...portal.to,
    boundaryId: portalBoundary.id,
    side: nativeSocket.boundarySide,
    center: openingCenter,
    elevation: nativeSocket.anchor.y,
    dimensions: {
      width: nativeSocket.opening.width,
      height: nativeSocket.opening.height,
      depth: portal.to.dimensions.depth,
    },
    nativeFixedRoomSocketId: nativeSocket.id,
  };
  portal.traversal.minimumWidth = nativeSocket.opening.width;
  portal.physicalRoute.endpointSurfaceIds.to = inletSurface.id;

  plan.traversalLinks = plan.traversalLinks.filter((link) => (
    !genericExtractionSurfaceIds.has(link.fromSurfaceId)
    && !genericExtractionSurfaceIds.has(link.toSurfaceId)
  ));
  const connectorSurfaceId = portal.physicalRoute.surfaceIds.at(-1);
  plan.traversalLinks.push({
    id: 'traversal.connector.machine-core-extraction-shrine.to-endpoint',
    regionId: 'extraction',
    fromSurfaceId: connectorSurfaceId,
    toSurfaceId: inletSurface.id,
    mode: 'walk',
    bidirectional: true,
    minimumWidth: nativeSocket.opening.width,
    portalId: portal.id,
    conditions: portal.conditions.filter(({ op }) => op === 'stateEquals'),
    nativeFixedRoomSocketId: nativeSocket.id,
  });
  plan.traversalLinks.push(...nativeRoomSurfaceLinks(
    nativeSurfaces,
    'extraction',
    NATIVE_EXTRACTION_PLACEMENT_ID,
  ));

  const anchorBindings = [
    ['anchor.refractor', 'anchor.reward.large-refractor'],
    ['anchor.extraction', 'anchor.extraction'],
    ['anchor.safe-return', 'anchor.safe-return.extraction'],
  ];
  const reboundPositions = new Map();
  for (const [planAnchorId, descriptorAnchorId] of anchorBindings) {
    const planAnchor = plan.anchors.find(({ id }) => id === planAnchorId);
    const descriptorAnchor = module.landmarkAnchors.find(({ id }) => id === descriptorAnchorId);
    const surface = nativeSurfaceByLocalId.get(descriptorAnchor?.surfaceId);
    if (!planAnchor || !descriptorAnchor || !surface) {
      throw new Error(`Native extraction anchor binding ${planAnchorId} is incomplete.`);
    }
    const oldPosition = structuredClone(planAnchor.position);
    planAnchor.position = vector(surface.center.x, surface.bounds.max.y, surface.center.z);
    planAnchor.surfaceId = surface.id;
    planAnchor.safeSurfaceId = surface.id;
    planAnchor.nativeDescriptorAnchorId = descriptorAnchor.id;
    planAnchor.nativeFixedRoomPlacementId = NATIVE_EXTRACTION_PLACEMENT_ID;
    reboundPositions.set(planAnchorId, { oldPosition, newPosition: planAnchor.position });
  }
  const safeAnchor = plan.safeAnchors.find(({ id }) => id === 'safe.extraction-return');
  const safeSource = plan.anchors.find(({ id }) => id === 'anchor.safe-return');
  if (!safeAnchor || !safeSource) throw new Error('Native extraction safe-return binding is incomplete.');
  safeAnchor.position = structuredClone(safeSource.position);
  safeAnchor.surfaceId = safeSource.surfaceId;
  safeAnchor.safeSurfaceId = safeSource.safeSurfaceId;
  safeAnchor.nativeFixedRoomPlacementId = NATIVE_EXTRACTION_PLACEMENT_ID;

  for (const [anchorId, fixtureId] of [
    ['anchor.refractor', 'fixture.interaction.collect.large-refractor'],
    ['anchor.extraction', 'fixture.interaction.extract'],
  ]) {
    const fixtureRecord = interactionFixtures.find(({ id }) => id === fixtureId);
    const rebound = reboundPositions.get(anchorId);
    if (!fixtureRecord || !rebound) throw new Error(`Native extraction interaction fixture ${fixtureId} is missing.`);
    const delta = {
      x: rebound.newPosition.x - rebound.oldPosition.x,
      y: rebound.newPosition.y - rebound.oldPosition.y,
      z: rebound.newPosition.z - rebound.oldPosition.z,
    };
    fixtureRecord.bounds = shiftBounds(fixtureRecord.bounds, delta);
    fixtureRecord.colliderBounds = fixtureRecord.colliderBounds.map((bounds) => shiftBounds(bounds, delta));
    fixtureRecord.cellId = NATIVE_EXTRACTION_CELL_ID;
    fixtureRecord.nativeSupportSurfaceId = plan.anchors.find(({ id }) => id === anchorId).surfaceId;
  }

  plan.nativeFixedRoomIntegration = {
    requiredPlacementCount: 11,
    activePlacementIds: [NATIVE_EXTRACTION_PLACEMENT_ID],
    activeDescriptorIds: [NATIVE_EXTRACTION_DESCRIPTOR_ID],
    incompleteDescriptorIds: [
      'v1-room.security-entrance',
      'v1-room.machine-factory',
      'v1-room.server-crypt',
      'v1-room.conveyor-gantry',
      'v1-room.credential-pyramid',
      'v1-room.parts-vault',
      'v1-room.enemy-nest',
      'v1-room.machine-core',
      'v1-room.coolant-relay',
      'v1-room.hazard-processing',
    ],
    genericFallbackGeometry: false,
  };
}

function bindNativeFixedRoomPortalEndpointV2(plan, native, {
  portalId,
  endpointName,
  localSocketId,
}) {
  const portal = plan.portals.find(({ id }) => id === portalId);
  const socket = native.compiled.portals.find(({ localId }) => localId === localSocketId);
  if (!portal || !socket) {
    throw new Error(`Native portal binding ${portalId}:${endpointName} cannot resolve ${localSocketId}.`);
  }
  const side = socket.boundarySide === 'interior-floor' ? 'floor' : socket.boundarySide;
  const socketOpeningBoundary = native.nativeBoundaries.find((boundary) => (
    boundary.side === side
    && boundary.openings?.some((opening) => opening.portalId === socket.id)
  ));
  const boundary = socketOpeningBoundary ?? native.nativeBoundaries
    .filter((candidate) => candidate.side === side)
    .sort((left, right) => (
      distanceFromPointToBounds2d(socket.anchor, left.bounds, side)
      - distanceFromPointToBounds2d(socket.anchor, right.bounds, side)
    ))[0];
  if (!boundary) throw new Error(`${localSocketId} has no compiled ${side} boundary.`);

  const openingCenter = ['floor', 'ceiling'].includes(side)
    ? vector(socket.anchor.x, socket.anchor.y, socket.anchor.z)
    : vector(socket.anchor.x, socket.anchor.y + socket.opening.height * 0.5, socket.anchor.z);
  const existingOpening = boundary.openings?.find((opening) => opening.portalId === socket.id);
  if (existingOpening) {
    existingOpening.nativeSocketPortalId = socket.id;
    existingOpening.portalId = portal.id;
    existingOpening.declarationOnly = true;
  } else {
    boundary.openings ??= [];
    boundary.openings.push({
      id: `opening.native.${portal.id.replace('portal.', '')}.${endpointName}`,
      portalId: portal.id,
      center: openingCenter,
      dimensions: ['floor', 'ceiling'].includes(side)
        ? { width: socket.opening.width, depth: socket.opening.width, height: 0.22 }
        : {
          width: socket.opening.width,
          height: socket.opening.height,
          depth: Number(portal[endpointName]?.dimensions?.depth ?? 1.2),
        },
      descriptorSocketId: socket.id,
      // The adapter has already segmented the wall/foundation around the
      // aperture. This record binds the gameplay portal without asking the
      // assembler to split those exact native collider panels a second time.
      declarationOnly: true,
    });
  }
  boundary.kind = 'portal-frame';

  const orderedApproachSurfaces = socket.approachSurfaceIds
    .map((id) => native.nativeSurfaces.find((surface) => surface.id === id))
    .filter(Boolean);
  const levelApproachSurfaces = orderedApproachSurfaces
    .filter((surface) => Math.abs(surface.bounds.max.y - socket.anchor.y) <= 0.051);
  const inletSurface = ['floor', 'ceiling'].includes(side)
    ? [...orderedApproachSurfaces].sort((left, right) => {
        const horizontalDistance = (surface) => {
          const x = (surface.bounds.min.x + surface.bounds.max.x) * 0.5;
          const z = (surface.bounds.min.z + surface.bounds.max.z) * 0.5;
          return Math.hypot(x - socket.anchor.x, z - socket.anchor.z);
        };
        return horizontalDistance(right) - horizontalDistance(left)
          || left.id.localeCompare(right.id);
      })[0]
    : levelApproachSurfaces[0];
  const resolvedInletSurface = inletSurface ?? orderedApproachSurfaces[0];
  if (!resolvedInletSurface) throw new Error(`${localSocketId} has no surviving native approach surface.`);

  const inletCenter = {
    x: (resolvedInletSurface.bounds.min.x + resolvedInletSurface.bounds.max.x) * 0.5,
    z: (resolvedInletSurface.bounds.min.z + resolvedInletSurface.bounds.max.z) * 0.5,
  };
  const landingDelta = {
    x: inletCenter.x - socket.anchor.x,
    z: inletCenter.z - socket.anchor.z,
  };
  const landingLength = Math.hypot(landingDelta.x, landingDelta.z);
  if (['floor', 'ceiling'].includes(side) && landingLength <= 0.01) {
    throw new Error(`${localSocketId} has no horizontal native landing direction beside its ${side} aperture.`);
  }

  portal[endpointName] = {
    ...portal[endpointName],
    boundaryId: boundary.id,
    side,
    center: openingCenter,
    elevation: socket.anchor.y,
    dimensions: ['floor', 'ceiling'].includes(side)
      ? { width: socket.opening.width, height: 0.22, depth: socket.opening.width }
      : {
        width: socket.opening.width,
        height: socket.opening.height,
        depth: Number(portal[endpointName]?.dimensions?.depth ?? 1.2),
      },
    nativeFixedRoomSocketId: socket.id,
    ...(['floor', 'ceiling'].includes(side) ? {
      nativeLandingSurfaceId: resolvedInletSurface.id,
      nativeLandingDirection: {
        x: landingDelta.x / landingLength,
        y: 0,
        z: landingDelta.z / landingLength,
      },
    } : {}),
  };
  if (portal.approachType === 'ladder') {
    portal.authoredRoute ??= {};
    portal.authoredRoute.throatDepth = Math.max(
      Number(portal.authoredRoute.throatDepth ?? 0),
      NATIVE_LADDER_MINIMUM_THROAT_DEPTH,
    );
  }
  // A connector cannot truthfully advertise more traversable width than its
  // narrowest physical endpoint. In particular, Security's native V1 sockets
  // are 3.2m wide while the retired generic gates were 4.8m; retaining the
  // generic value let abstract tests accept a route wider than the real wall
  // aperture. Keep the exact physical width and reject a native binding that
  // cannot satisfy the shared player/camera envelope.
  const physicalMinimumWidth = Math.min(
    Number(portal.from.dimensions.width),
    Number(portal.to.dimensions.width),
  );
  const requiredClearance = Math.max(
    PLAYER_TRAVERSAL_ENVELOPE.minimumLandingWidth,
    Number(portal.traversal.cameraClearance ?? 0),
  );
  if (physicalMinimumWidth + 1e-6 < requiredClearance) {
    throw new Error(`${localSocketId} leaves only ${physicalMinimumWidth}m for ${requiredClearance}m player/camera clearance.`);
  }
  portal.traversal.minimumWidth = physicalMinimumWidth;
  portal.physicalRoute.endpointSurfaceIds[endpointName] = resolvedInletSurface.id;
  return { portal, socket, boundary, inletSurface: resolvedInletSurface };
}

function rebuildBoundNativePortalConnectorV2(plan, portal, endpointSurfaceIds) {
  const oldRoute = portal.physicalRoute ?? {};
  const oldCellIds = new Set(oldRoute.cellIds ?? []);
  const oldBoundaryIds = new Set(oldRoute.boundaryIds ?? []);
  const oldSurfaceIds = new Set(oldRoute.surfaceIds ?? []);
  plan.spatialCells = plan.spatialCells.filter(({ id }) => !oldCellIds.has(id));
  plan.structuralBoundaries = plan.structuralBoundaries.filter(({ id }) => !oldBoundaryIds.has(id));
  plan.walkableSurfaces = plan.walkableSurfaces.filter(({ id }) => !oldSurfaceIds.has(id));
  plan.traversalLinks = plan.traversalLinks.filter((link) => (
    !oldSurfaceIds.has(link.fromSurfaceId)
    && !oldSurfaceIds.has(link.toSurfaceId)
    && !oldSurfaceIds.has(link.viaSurfaceId)
    && link.portalId !== portal.id
    && link.proofPortalId !== portal.id
  ));

  addConnectorSpatialContracts({
    portals: [portal],
    spatialCells: plan.spatialCells,
    structuralBoundaries: plan.structuralBoundaries,
    walkableSurfaces: plan.walkableSurfaces,
    traversalLinks: plan.traversalLinks,
  });

  // addConnectorSpatialContracts cannot infer a native room's endpoint from
  // the retired generic `surface.<region>.main` convention. Replace only its
  // two generated endpoint edges with the exact socket-owned surfaces while
  // retaining every independently proved connector segment edge.
  plan.traversalLinks = plan.traversalLinks.filter((link) => link.portalId !== portal.id);
  const routeSurfaceIds = portal.physicalRoute.surfaceIds ?? [];
  if (routeSurfaceIds.length === 0) {
    plan.traversalLinks.push({
      id: `traversal.connector.${portal.id.replace('portal.', '')}.native-direct`,
      regionId: portal.from.regionId,
      fromSurfaceId: endpointSurfaceIds.from,
      toSurfaceId: endpointSurfaceIds.to,
      mode: portal.approachType,
      bidirectional: portal.direction !== 'forward-only',
      minimumWidth: portal.traversal.minimumWidth,
      portalId: portal.id,
      conditions: portal.conditions.filter(({ op }) => op === 'stateEquals'),
    });
  } else {
    plan.traversalLinks.push(
      {
        id: `traversal.connector.${portal.id.replace('portal.', '')}.from-native-endpoint`,
        regionId: portal.from.regionId,
        fromSurfaceId: endpointSurfaceIds.from,
        toSurfaceId: routeSurfaceIds[0],
        mode: portal.approachType,
        bidirectional: portal.direction !== 'forward-only',
        minimumWidth: portal.traversal.minimumWidth,
        portalId: portal.id,
        conditions: portal.conditions.filter(({ op }) => op === 'stateEquals'),
      },
      {
        id: `traversal.connector.${portal.id.replace('portal.', '')}.to-native-endpoint`,
        regionId: portal.to.regionId,
        fromSurfaceId: routeSurfaceIds.at(-1),
        toSurfaceId: endpointSurfaceIds.to,
        mode: portal.approachType,
        bidirectional: portal.direction !== 'forward-only',
        minimumWidth: portal.traversal.minimumWidth,
        portalId: portal.id,
        conditions: portal.conditions.filter(({ op }) => op === 'stateEquals'),
      },
    );
  }
  portal.physicalRoute.endpointSurfaceIds = { ...endpointSurfaceIds };
}

export function integrateSingleRegionNativeGoldenRoomsV2(plan) {
  return integrateSingleRegionNativeV1ModulesV2(plan, {
    bindPortalEndpoint(planRecord, portalId, endpointName, placementRecord, socketRef) {
      if (socketRef.type !== 'descriptor-socket') {
        throw new Error(`${portalId}:${endpointName} must bind a descriptor-owned native socket.`);
      }
      const native = {
        ...socketRef.bundle,
        placementRecord,
      };
      return bindNativeFixedRoomPortalEndpointV2(planRecord, native, {
        portalId,
        endpointName,
        localSocketId: socketRef.localSocketId,
      });
    },
    rebuildPortalConnector(planRecord, portalId) {
      const portal = planRecord.portals.find(({ id }) => id === portalId);
      if (!portal?.physicalRoute?.endpointSurfaceIds?.from
        || !portal?.physicalRoute?.endpointSurfaceIds?.to) return null;
      rebuildBoundNativePortalConnectorV2(
        planRecord,
        portal,
        portal.physicalRoute.endpointSurfaceIds,
      );
      return portal;
    },
    repositionFixture(planRecord, fixtureId, _anchorId, placementRecord, context) {
      repositionNativeInteractionFixtureV2(planRecord, {
        ...context.bundle,
        placementRecord,
      }, {
        fixtureId,
        anchorId: context.binding.planAnchorId,
      });
    },
  });
}

function repositionNativeInteractionFixtureV2(plan, native, {
  fixtureId,
  anchorId,
}) {
  const fixtureRecord = plan.structuralFixtures.find(({ id }) => id === fixtureId);
  const anchorRecord = plan.anchors.find(({ id }) => id === anchorId);
  const action = plan.actions.find(({ anchorId: candidateAnchorId }) => candidateAnchorId === anchorId);
  const surface = plan.walkableSurfaces.find(({ id }) => id === anchorRecord?.surfaceId);
  if (!fixtureRecord || !anchorRecord || !action || !surface) {
    throw new Error(`Native interaction binding ${fixtureId}/${anchorId} is incomplete.`);
  }
  const oldSize = {
    x: fixtureRecord.bounds.max.x - fixtureRecord.bounds.min.x,
    y: fixtureRecord.bounds.max.y - fixtureRecord.bounds.min.y,
    z: fixtureRecord.bounds.max.z - fixtureRecord.bounds.min.z,
  };
  const isConsole = ['gate-control', 'water-router', 'mechanism-control'].includes(action.type);
  const forward = anchorRecord.forward ?? vector(0, 0, 1);
  const directionSign = action.interaction?.activationSide === 'back' ? -1 : 1;
  const directionLength = Math.hypot(forward.x, forward.z) || 1;
  const activationDirection = vector(
    forward.x / directionLength * directionSign,
    0,
    forward.z / directionLength * directionSign,
  );
  const facesX = Math.abs(activationDirection.x) > Math.abs(activationDirection.z);
  const size = isConsole
    ? (facesX ? { x: 0.65, y: oldSize.y, z: 1 } : { x: 1, y: oldSize.y, z: 0.65 })
    : oldSize;
  const selectableFaceOffset = isConsole
    ? Math.abs(activationDirection.x) * size.x * 0.5
      + Math.abs(activationDirection.z) * size.z * 0.5
      + 0.09
    : 0;
  const center = vector(
    anchorRecord.position.x - activationDirection.x * selectableFaceOffset,
    surface.bounds.max.y + size.y * 0.5,
    anchorRecord.position.z - activationDirection.z * selectableFaceOffset,
  );
  const bounds = {
    min: vector(center.x - size.x * 0.5, surface.bounds.max.y, center.z - size.z * 0.5),
    max: vector(center.x + size.x * 0.5, surface.bounds.max.y + size.y, center.z + size.z * 0.5),
  };
  fixtureRecord.bounds = bounds;
  fixtureRecord.colliderBounds = [structuredClone(bounds)];
  fixtureRecord.cellId = surface.cellId;
  fixtureRecord.regionId = anchorRecord.regionId;
  fixtureRecord.supportBoundaryIds = [...surface.supportBoundaryIds];
  fixtureRecord.nativeSupportSurfaceId = surface.id;
  fixtureRecord.nativeFixedRoomPlacementId = native.placementRecord.id;
}

function rebindPlanAnchorToNativeDescriptorV2(plan, native, {
  planAnchorId,
  descriptorAnchorId,
  surfaceId = null,
  useSurfaceCenter = false,
  regionId = 'assembly',
  placementId = NATIVE_ASSEMBLY_PLACEMENT_ID,
}) {
  const planAnchor = plan.anchors.find(({ id }) => id === planAnchorId);
  const descriptorAnchor = native.module.landmarkAnchors.find(({ id }) => id === descriptorAnchorId);
  const surface = native.nativeSurfaceByLocalId.get(surfaceId ?? descriptorAnchor?.surfaceId);
  if (!planAnchor || !descriptorAnchor || !surface) {
    throw new Error(`Native anchor binding ${planAnchorId} -> ${descriptorAnchorId} is incomplete.`);
  }
  const oldPosition = structuredClone(planAnchor.position);
  const transformed = transformPointQuarterTurns(
    descriptorAnchor.localPosition,
    native.placementRecord.transform ?? native.placementRecord,
  );
  planAnchor.position = useSurfaceCenter
    ? vector(surface.center.x, surface.bounds.max.y, surface.center.z)
    : vector(transformed.x, surface.bounds.max.y, transformed.z);
  planAnchor.regionId = regionId;
  planAnchor.surfaceId = surface.id;
  planAnchor.safeSurfaceId = surface.id;
  planAnchor.nativeDescriptorAnchorId = descriptorAnchor.id;
  planAnchor.nativeFixedRoomPlacementId = placementId;
  if (descriptorAnchor.spawnClearance) {
    planAnchor.spawnClearance = structuredClone(descriptorAnchor.spawnClearance);
  }
  return { planAnchor, descriptorAnchor, surface, oldPosition };
}

function connectorRouteSurfaceBoundsV2(plan, portal) {
  const ids = new Set(portal.physicalRoute?.surfaceIds ?? []);
  return plan.walkableSurfaces.filter(({ id }) => ids.has(id));
}

function proveConnectorRoutesHorizontallyDisjointV2(plan, leftPortal, rightPortal) {
  const leftSurfaces = connectorRouteSurfaceBoundsV2(plan, leftPortal);
  const rightSurfaces = connectorRouteSurfaceBoundsV2(plan, rightPortal);
  if (!leftSurfaces.length || !rightSurfaces.length) {
    throw new Error(`Connector disjointness proof cannot resolve ${leftPortal.id}/${rightPortal.id}.`);
  }
  const maximumPlayerBodyOverlap = PLAYER_TRAVERSAL_ENVELOPE.collisionRadius * 3;
  let maximumStackOverlap = -Infinity;
  let closestPair = null;
  for (const left of leftSurfaces) {
    for (const right of rightSurfaces) {
      const overlapX = Math.min(left.bounds.max.x, right.bounds.max.x)
        - Math.max(left.bounds.min.x, right.bounds.min.x);
      const overlapZ = Math.min(left.bounds.max.z, right.bounds.max.z)
        - Math.max(left.bounds.min.z, right.bounds.min.z);
      const verticalGap = Math.max(
        left.bounds.min.y - right.bounds.max.y,
        right.bounds.min.y - left.bounds.max.y,
      );
      const playerBodyOverlap = Math.min(overlapX, overlapZ);
      if (verticalGap >= PLAYER_TRAVERSAL_ENVELOPE.headClearance
        && playerBodyOverlap > maximumStackOverlap) {
        maximumStackOverlap = playerBodyOverlap;
        closestPair = [left.id, right.id];
      }
    }
  }
  if (maximumStackOverlap >= maximumPlayerBodyOverlap - 1e-6) {
    const boundsById = new Map([...leftSurfaces, ...rightSurfaces].map((surface) => [surface.id, surface.bounds]));
    throw new Error(`${leftPortal.id}/${rightPortal.id} admit a player-sized stacked X/Z transfer at ${closestPair?.join(' / ')} (${maximumStackOverlap.toFixed(3)}m overlap): ${JSON.stringify(closestPair?.map((id) => boundsById.get(id)))}.`);
  }
  const proof = {
    id: `connector-clearance.${leftPortal.id.replace('portal.', '')}.${rightPortal.id.replace('portal.', '')}`,
    portalIds: [leftPortal.id, rightPortal.id],
    maximumStackOverlap,
    maximumAllowedStackOverlap: maximumPlayerBodyOverlap,
    closestSurfaceIds: closestPair,
    accepted: true,
  };
  plan.connectorClearanceProofs ??= [];
  plan.connectorClearanceProofs.push(proof);
  return proof;
}

function integrateNativeSecurityEntranceV2(plan) {
  const module = getLegacyFixedRoomModuleV2(NATIVE_SECURITY_DESCRIPTOR_ID);
  if (!module) throw new Error(`Missing native V1 Security module ${NATIVE_SECURITY_DESCRIPTOR_ID}.`);
  const socketIds = {
    assembly: 'socket.v1-room.security-entrance.ground.south-center',
    sorting: 'socket.v1-room.security-entrance.ground.north-center',
    freight: 'socket.v1-room.security-entrance.ground.east-south-bucket',
    cappedLift: 'socket.v1-room.security-entrance.lift.west-south-bucket',
  };
  for (const socketId of Object.values(socketIds)) {
    if (!module.extensionSockets.some(({ id }) => id === socketId)) {
      throw new Error(`Native V1 Security is missing ${socketId}.`);
    }
  }
  const sortingSocket = module.extensionSockets.find(({ id }) => id === socketIds.sorting);

  const native = prepareNativeFixedRoomRegionV2(plan, {
    descriptorId: NATIVE_SECURITY_DESCRIPTOR_ID,
    placementId: NATIVE_SECURITY_PLACEMENT_ID,
    regionId: 'security',
    cellId: NATIVE_SECURITY_CELL_ID,
    translation: { x: -47, y: 0, z: 40 },
    yawQuarterTurns: 0,
    localOpenSocketIds: [socketIds.assembly, socketIds.sorting, socketIds.freight],
    authoredFixtureBindings: new Map([
      ['fixture.v1-room.security-entrance.security-fence-west', 'checkpoint-bank-west'],
      ['fixture.v1-room.security-entrance.security-fence-east', 'checkpoint-bank-east'],
      ['fixture.v1-room.security-entrance.security-cylinder-arch', 'overhead-conduit'],
    ]),
  });
  native.placementRecord.cappedSocketIds = [socketIds.cappedLift];
  native.placementRecord.socketStateContracts = module.extensionSockets.map((socket) => ({
    socketId: socket.id,
    state: socket.id === socketIds.cappedLift ? 'opaque-capped' : 'portal-bound',
  }));

  const assemblyBinding = bindNativeFixedRoomPortalEndpointV2(plan, native, {
    portalId: 'portal.security-assembly',
    endpointName: 'from',
    localSocketId: socketIds.assembly,
  });
  const sortingBinding = bindNativeFixedRoomPortalEndpointV2(plan, native, {
    portalId: 'portal.security-sorting-alpha',
    endpointName: 'from',
    localSocketId: socketIds.sorting,
  });
  const freightBinding = bindNativeFixedRoomPortalEndpointV2(plan, native, {
    portalId: 'portal.freight-security-shortcut',
    endpointName: 'to',
    localSocketId: socketIds.freight,
  });
  for (const { portal } of [assemblyBinding, sortingBinding, freightBinding]) {
    portal.elevationBands = [portal.from.elevation, portal.to.elevation];
    portal.elevationBand = Math.min(...portal.elevationBands);
    portal.traversal.minimumWidth = Math.min(
      Number(portal.from.dimensions.width),
      Number(portal.to.dimensions.width),
    );
  }
  assemblyBinding.portal.authoredRoute = {
    ...assemblyBinding.portal.authoredRoute,
    // Both native endpoints face south. Keep their cross-room leg outside the
    // Machine Factory shell instead of cutting back through its playable
    // south-east production floor.
    detour: { axis: 'z', value: 64.2 },
  };
  // The discarded shortcut detour ran at z=61 beneath the upper Assembly
  // passage. With the native east socket at z=48.4, a direct vertical-last
  // shaft stays in its own service band and cannot catch a player who leaves
  // the upper connector deck.
  freightBinding.portal.authoredRoute = {
    ...freightBinding.portal.authoredRoute,
    mode: 'vertical-last',
    detour: null,
    // A 3.2m aperture needs a deeper enclosed landing than half its width:
    // 1.0m ladder opening + 0.72m safe exit inset + player body clearance.
    throatDepth: 2.4,
    // Stay outside Freight at z=60, then bypass the upper Security connector's
    // x=-47 throat through a short z=50 under-room service dogleg. Every leg
    // remains enclosed/playable, while no player-width X/Z footprint is
    // stacked beneath the upper passage or the Server -> Freight shaft.
    routePoints: [
      vector(freightBinding.portal.from.center.x, freightBinding.portal.from.elevation, freightBinding.portal.from.center.z),
      vector(-110.4, -10, 46),
      vector(-110.4, -10, 60),
      vector(-52, -10, 60),
      vector(-52, -10, 50),
      vector(-42, -10, 50),
      vector(-42, -10, 60),
      vector(-32, -10, 60),
      vector(-32, -10, 48.4),
      vector(-32, 0, 48.4),
      vector(freightBinding.portal.to.center.x, freightBinding.portal.to.elevation, freightBinding.portal.to.center.z),
    ],
  };

  plan.traversalLinks = plan.traversalLinks.filter((link) => (
    !native.genericSurfaceIds.has(link.fromSurfaceId)
    && !native.genericSurfaceIds.has(link.toSurfaceId)
    && !native.genericSurfaceIds.has(link.viaSurfaceId)
  ));

  rebuildBoundNativePortalConnectorV2(plan, assemblyBinding.portal, {
    from: assemblyBinding.inletSurface.id,
    to: assemblyBinding.portal.physicalRoute.endpointSurfaceIds.to,
  });
  const assemblyApproachLink = plan.traversalLinks.find(({ id }) => (
    id === 'traversal.assembly.landmark-stairs'
  ));
  if (!assemblyApproachLink?.approachContract?.doorwayEgress) {
    throw new Error('Native Security rebuild lost the Assembly doorway-egress contract.');
  }
  assemblyApproachLink.approachContract.doorwayEgress.connectorSurfaceId
    = assemblyBinding.portal.physicalRoute.surfaceIds.at(-1);
  rebuildBoundNativePortalConnectorV2(plan, sortingBinding.portal, {
    from: sortingBinding.inletSurface.id,
    to: sortingBinding.portal.physicalRoute.endpointSurfaceIds.to,
  });
  rebuildBoundNativePortalConnectorV2(plan, freightBinding.portal, {
    from: freightBinding.portal.physicalRoute.endpointSurfaceIds.from,
    to: freightBinding.inletSurface.id,
  });

  // Bind only the newly rebuilt sloped Alpha connector strip. All pre-existing
  // golden stairs already own exact seam contracts, and the native Security
  // ramp below is authored explicitly from its three descriptor tiles.
  const rebuiltAlphaStairIds = new Set(sortingBinding.portal.physicalRoute.surfaceIds.filter((id) => (
    plan.walkableSurfaces.find((surface) => surface.id === id)?.geometry?.type === 'walkable-stairs'
  )));
  if (rebuiltAlphaStairIds.size) {
    bindStairsToExactDeckSeams(plan, {
      ignoredSurfaceIds: new Set(plan.walkableSurfaces
        .filter(({ id }) => !rebuiltAlphaStairIds.has(id))
        .map(({ id }) => id)),
    });
  }

  plan.traversalLinks.push(...nativeRoomSurfaceLinks(
    native.nativeSurfaces,
    'security',
    NATIVE_SECURITY_PLACEMENT_ID,
  ));
  const nativeRampSurfaces = native.nativeSurfaces
    .filter(({ traversalRoute }) => (
      traversalRoute?.routeId === 'ramp.security-entrance.west-catwalk-access'
    ))
    .sort((left, right) => (
      left.traversalRoute.sequenceIndex - right.traversalRoute.sequenceIndex
    ));
  const rampContractSurface = nativeRampSurfaces[0];
  const rampTopDeck = native.nativeSurfaceByLocalId
    .get('surface.v1-room.security-entrance.-4.3.0');
  const rampGroundDeck = native.nativeSurfaceByLocalId
    .get('surface.v1-room.security-entrance.0.3.0');
  if (nativeRampSurfaces.length !== 3 || !rampContractSurface || !rampTopDeck || !rampGroundDeck) {
    throw new Error('Native V1 Security has no complete exact three-tile catwalk ramp route.');
  }
  const rampFoot = vector(
    nativeRampSurfaces.at(-1).bounds.max.x,
    nativeRampSurfaces.at(-1).ramp.endY,
    nativeRampSurfaces.at(-1).center.z,
  );
  const rampTop = vector(
    nativeRampSurfaces[0].bounds.min.x,
    nativeRampSurfaces[0].ramp.startY,
    nativeRampSurfaces[0].center.z,
  );
  rampContractSurface.stairs = {
    type: 'walkable-stairs',
    path: [rampFoot, rampTop],
    maxRiser: 0.18,
    minimumTread: 0.45,
    width: 2.8,
    ledgeClimbDisabled: true,
    endpointSurfaceIds: { start: rampGroundDeck.id, end: rampTopDeck.id },
    minimumEndpointOverlap: 1.2,
    maximumEndpointHeightDelta: 0.05,
    minimumUsableSeamWidth: 2.8,
    nativeRampSurfaceIds: nativeRampSurfaces.map(({ id }) => id),
  };
  const lowerStaging = vector(rampFoot.x + 1.4, rampFoot.y, rampFoot.z);
  const centerlineSegmentCount = Math.max(4, Math.ceil(
    Math.hypot(rampTop.x - rampFoot.x, rampTop.z - rampFoot.z) / 2.5,
  ));
  const stairWaypoints = Array.from({ length: centerlineSegmentCount + 1 }, (_, index) => {
    const progress = index / centerlineSegmentCount;
    return vector(
      rampFoot.x + (rampTop.x - rampFoot.x) * progress,
      rampFoot.y + (rampTop.y - rampFoot.y) * progress,
      rampFoot.z + (rampTop.z - rampFoot.z) * progress,
    );
  });
  const nativeGateRouteSurfaces = [...sortingSocket.approachSurfaceIds]
    .reverse()
    .map((localSurfaceId) => native.nativeSurfaceByLocalId.get(localSurfaceId))
    .filter(Boolean);
  const rampRouteIds = new Set([
    rampGroundDeck.id,
    ...nativeRampSurfaces.map(({ id }) => id),
  ]);
  const catwalkWaypoints = nativeGateRouteSurfaces
    .filter(({ id }) => !rampRouteIds.has(id))
    .map((surface) => vector(surface.center.x, surface.bounds.max.y, surface.center.z));
  const gateRouteWaypoints = [...stairWaypoints, ...catwalkWaypoints];
  if (gateRouteWaypoints.at(-1)?.x !== sortingBinding.inletSurface.center.x
    || gateRouteWaypoints.at(-1)?.z !== sortingBinding.inletSurface.center.z) {
    throw new Error('Native V1 Security Alpha route does not terminate on the north gate inlet surface.');
  }
  plan.traversalLinks.push({
    id: 'traversal.security.security-sorting-alpha',
    regionId: 'security',
    fromSurfaceId: rampGroundDeck.id,
    toSurfaceId: sortingBinding.inletSurface.id,
    viaSurfaceId: rampContractSurface.id,
    mode: 'walkable-stairs',
    bidirectional: true,
    minimumWidth: 2.8,
    maximumRiser: 0.18,
    minimumTread: 0.45,
    destinationHorizontalTolerance: 0.55,
    destinationVerticalTolerance: 0.2,
    nativeFixedRoomPlacementId: NATIVE_SECURITY_PLACEMENT_ID,
    nativeRampSurfaceIds: nativeRampSurfaces.map(({ id }) => id),
    nativeGateRouteSurfaceIds: nativeGateRouteSurfaces.map(({ id }) => id),
    approachWaypoints: [lowerStaging, structuredClone(rampFoot)],
    approachSurfaceIds: [rampGroundDeck.id, rampGroundDeck.id],
    approachSegments: [{
      fromWaypointIndex: 0,
      toWaypointIndex: 1,
      surfaceIds: [rampGroundDeck.id],
      seamWidth: null,
    }],
    stairWaypoints,
    waypoints: gateRouteWaypoints,
    reverseEgressWaypoints: [structuredClone(lowerStaging)],
    approachContract: {
      sourceSurfaceId: rampGroundDeck.id,
      stairSurfaceId: rampContractSurface.id,
      ingressPortalId: null,
      ingressPoint: null,
      ingressDepth: null,
      ingressSurfaceIds: [],
      combatRejoin: null,
      sampleSpacing: 0.21,
      capsuleRadius: 0.46,
      groundedOnly: true,
      jumpAllowed: false,
      ledgeClimbAllowed: false,
    },
  });

  const playerBinding = rebindPlanAnchorToNativeDescriptorV2(plan, native, {
    planAnchorId: 'anchor.player-start',
    descriptorAnchorId: 'anchor.ruin-entry',
    regionId: 'security',
    placementId: NATIVE_SECURITY_PLACEMENT_ID,
  });
  const keySeekerBinding = rebindPlanAnchorToNativeDescriptorV2(plan, native, {
    planAnchorId: 'anchor.key-seeker',
    descriptorAnchorId: 'anchor.key-seeker',
    regionId: 'security',
    placementId: NATIVE_SECURITY_PLACEMENT_ID,
  });
  const safeStart = plan.safeAnchors.find(({ id }) => id === 'safe.security-start');
  if (!safeStart) throw new Error('Native Security player-safe anchor is missing.');
  safeStart.position = structuredClone(playerBinding.planAnchor.position);
  safeStart.forward = structuredClone(playerBinding.planAnchor.forward);
  safeStart.surfaceId = playerBinding.surface.id;
  safeStart.safeSurfaceId = playerBinding.surface.id;
  safeStart.nativeDescriptorAnchorId = playerBinding.descriptorAnchor.id;
  safeStart.nativeFixedRoomPlacementId = NATIVE_SECURITY_PLACEMENT_ID;
  safeStart.spawnClearance = structuredClone(playerBinding.planAnchor.spawnClearance);

  const alphaPad = native.nativeSurfaceByLocalId
    .get('surface.v1-room.security-entrance.2.-4.0');
  const alphaAnchor = plan.anchors.find(({ id }) => id === 'anchor.gate.alpha');
  if (!alphaPad || !alphaAnchor) throw new Error('Native Security Alpha console pad is missing.');
  alphaPad.interactionSurfaceRole = 'side-control-pad';
  alphaPad.purpose = 'dedicated static side pad for the Alpha gate console';
  alphaPad.createsLedgeCandidates = false;
  alphaPad.closedGatePortalIds = [sortingBinding.portal.id];
  alphaAnchor.position = vector(alphaPad.center.x, alphaPad.bounds.max.y, alphaPad.center.z);
  // The console sits east of the north gate lane. Its selectable face points
  // due west across its own native tile: this is both the player's supported
  // approach side and a clear forward-facing view of the gate, without the
  // diagonal AABB ambiguity that previously reported the only reachable side
  // as "wrong activation side".
  alphaAnchor.forward = vector(-1, 0, 0);
  alphaAnchor.forwardX = alphaAnchor.forward.x;
  alphaAnchor.forwardZ = alphaAnchor.forward.z;
  alphaAnchor.surfaceId = alphaPad.id;
  alphaAnchor.safeSurfaceId = alphaPad.id;
  alphaAnchor.approachSurfaceId = alphaPad.id;
  alphaAnchor.nativeFixedRoomPlacementId = NATIVE_SECURITY_PLACEMENT_ID;
  alphaAnchor.nativeDescriptorSurfaceId = alphaPad.localId;

  repositionNativeInteractionFixtureV2(plan, native, {
    fixtureId: 'fixture.interaction.activate.key-seeker',
    anchorId: keySeekerBinding.planAnchor.id,
  });
  repositionNativeInteractionFixtureV2(plan, native, {
    fixtureId: 'fixture.interaction.open.door-alpha',
    anchorId: alphaAnchor.id,
  });

  const securityRegion = plan.regions.find(({ id }) => id === 'security');
  if (!securityRegion) throw new Error('Native Security region metadata is missing.');
  securityRegion.cellIds = [NATIVE_SECURITY_CELL_ID];
  securityRegion.subRegions = [
    {
      id: 'security.entry-checkpoint',
      cellId: NATIVE_SECURITY_CELL_ID,
      purpose: 'sealed V1 scanner entry and Key Seeker checkpoint',
      surfaceIds: native.nativeSurfaces
        .filter((surface) => surface.bounds.max.y <= 0.051)
        .map(({ id }) => id)
        .sort(),
      nativeFixedRoomPlacementId: NATIVE_SECURITY_PLACEMENT_ID,
    },
    {
      id: 'security.raised-credential-return',
      cellId: NATIVE_SECURITY_CELL_ID,
      purpose: 'supported west ramp, raised north Alpha console, and credential return route',
      surfaceIds: native.nativeSurfaces
        .filter((surface) => surface.bounds.max.y > 0.051)
        .map(({ id }) => id)
        .sort(),
      nativeFixedRoomPlacementId: NATIVE_SECURITY_PLACEMENT_ID,
    },
  ];

  const alphaGate = plan.progression.gateContracts.find(({ id }) => id === 'Door_Alpha');
  const alphaShortcutGate = plan.progression.gateContracts.find(({ id }) => id === 'Gate_Shortcut_Alpha');
  if (!alphaGate || !alphaShortcutGate) throw new Error('Native Security has incomplete Alpha gate contracts.');
  plan.structuralBoundaries = plan.structuralBoundaries.filter(({ id }) => id !== alphaGate.barrierId);
  addGateBarriers(plan, [sortingBinding.portal], { gateContracts: [alphaGate] });
  bindClosedGatesToNonVaultableRoutes(
    plan,
    [sortingBinding.portal, freightBinding.portal],
    { gateContracts: [alphaGate, alphaShortcutGate] },
  );

  proveConnectorRoutesHorizontallyDisjointV2(
    plan,
    assemblyBinding.portal,
    freightBinding.portal,
  );

  const integration = plan.nativeFixedRoomIntegration;
  if (!integration) throw new Error('Native fixed-room integration ledger is missing.');
  integration.activePlacementIds = [...new Set([
    ...integration.activePlacementIds,
    NATIVE_SECURITY_PLACEMENT_ID,
  ])].sort();
  integration.activeDescriptorIds = [...new Set([
    ...integration.activeDescriptorIds,
    NATIVE_SECURITY_DESCRIPTOR_ID,
  ])].sort();
  integration.incompleteDescriptorIds = integration.incompleteDescriptorIds
    .filter((id) => id !== NATIVE_SECURITY_DESCRIPTOR_ID);
  integration.genericFallbackGeometry = false;
}

function integrateNativeServerCryptV2(plan) {
  const module = getLegacyFixedRoomModuleV2(NATIVE_SERVER_DESCRIPTOR_ID);
  if (!module) throw new Error(`Missing native V1 Server Crypt module ${NATIVE_SERVER_DESCRIPTOR_ID}.`);
  const socketIds = {
    assembly: 'socket.v1-room.server-crypt.ground.south-east-bucket',
    freight: 'socket.v1-room.server-crypt.catwalk.north-center',
    cappedCeilingLadder: 'socket.v1-room.server-crypt.ladder.ceiling-east-catwalk',
  };
  for (const socketId of Object.values(socketIds)) {
    if (!module.extensionSockets.some(({ id }) => id === socketId)) {
      throw new Error(`Native V1 Server Crypt is missing ${socketId}.`);
    }
  }

  const native = prepareNativeFixedRoomRegionV2(plan, {
    descriptorId: NATIVE_SERVER_DESCRIPTOR_ID,
    placementId: NATIVE_SERVER_PLACEMENT_ID,
    regionId: 'server',
    cellId: NATIVE_SERVER_CELL_ID,
    // Leave a complete framed connector bay between the Machine Factory's
    // north wall (z=19) and the Server Crypt's south wall (z=14.2).  The V1
    // room otherwise remains at authored scale, elevation, and yaw.
    translation: { x: -90, y: 6, z: -4 },
    yawQuarterTurns: 0,
    localOpenSocketIds: [socketIds.assembly, socketIds.freight],
    authoredFixtureBindings: new Map([
      ['fixture.v1-room.server-crypt.server-monolith-1-1', 'crypt-bank-northwest'],
      ['fixture.v1-room.server-crypt.server-monolith-1-4', 'crypt-bank-southwest'],
      ['fixture.v1-room.server-crypt.server-monolith-4-2', 'crypt-bank-east'],
      ['fixture.v1-room.server-crypt.south-girder-frame', 'data-loop'],
    ]),
  });
  native.placementRecord.cappedSocketIds = [socketIds.cappedCeilingLadder];
  native.placementRecord.socketStateContracts = module.extensionSockets.map((socket) => ({
    socketId: socket.id,
    state: socket.id === socketIds.cappedCeilingLadder ? 'opaque-capped' : 'portal-bound',
  }));

  const assemblyBinding = bindNativeFixedRoomPortalEndpointV2(plan, native, {
    portalId: 'portal.assembly-server',
    endpointName: 'to',
    localSocketId: socketIds.assembly,
  });
  const freightBinding = bindNativeFixedRoomPortalEndpointV2(plan, native, {
    portalId: 'portal.server-freight',
    endpointName: 'from',
    localSocketId: socketIds.freight,
  });
  for (const { portal } of [assemblyBinding, freightBinding]) {
    portal.elevationBands = [portal.from.elevation, portal.to.elevation];
    portal.elevationBand = Math.min(...portal.elevationBands);
    portal.traversal.minimumWidth = Math.min(
      Number(portal.from.dimensions.width),
      Number(portal.to.dimensions.width),
    );
  }

  // The native Assembly and Server walls face one another across a 4.8m
  // service bay.  Keep the complete stair gallery inside that bay instead of
  // running it through either playable room shell.
  assemblyBinding.portal.authoredRoute = {
    ...assemblyBinding.portal.authoredRoute,
    mode: 'adjacent-authored',
    detour: { axis: 'z', value: 16.6 },
    routePoints: null,
  };

  // Freight occupies a real lower playable volume beneath the factory.  The
  // Server exit therefore leaves the north wall, uses a supported external
  // service landing west of both authored rooms, then descends and returns to
  // Freight's north landing.  No connector segment cuts through the Server
  // shell or creates an undeclared bottomless shaft.
  const freightStart = vector(
    freightBinding.portal.from.center.x,
    freightBinding.portal.from.elevation,
    freightBinding.portal.from.center.z,
  );
  const freightEnd = vector(
    freightBinding.portal.to.center.x,
    freightBinding.portal.to.elevation,
    freightBinding.portal.to.center.z,
  );
  freightBinding.portal.authoredRoute = {
    ...freightBinding.portal.authoredRoute,
    mode: 'vertical-first',
    detour: null,
    throatDepth: 2.2,
    routePoints: [
      freightStart,
      vector(freightStart.x, freightStart.y, freightStart.z - 2.2),
      vector(-126, freightStart.y, freightStart.z - 2.2),
      vector(-126, freightEnd.y, freightStart.z - 2.2),
      vector(-126, freightEnd.y, 16.6),
      vector(freightEnd.x, freightEnd.y, 16.6),
      freightEnd,
    ],
  };

  plan.traversalLinks = plan.traversalLinks.filter((link) => (
    !native.genericSurfaceIds.has(link.fromSurfaceId)
    && !native.genericSurfaceIds.has(link.toSurfaceId)
    && !native.genericSurfaceIds.has(link.viaSurfaceId)
  ));
  rebuildBoundNativePortalConnectorV2(plan, assemblyBinding.portal, {
    from: assemblyBinding.portal.physicalRoute.endpointSurfaceIds.from,
    to: assemblyBinding.inletSurface.id,
  });
  rebuildBoundNativePortalConnectorV2(plan, freightBinding.portal, {
    from: freightBinding.inletSurface.id,
    to: freightBinding.portal.physicalRoute.endpointSurfaceIds.to,
  });

  const rebuiltAssemblyStairIds = new Set(
    assemblyBinding.portal.physicalRoute.surfaceIds.filter((surfaceId) => (
      plan.walkableSurfaces.find(({ id }) => id === surfaceId)?.geometry?.type === 'walkable-stairs'
    )),
  );
  if (rebuiltAssemblyStairIds.size) {
    bindStairsToExactDeckSeams(plan, {
      ignoredSurfaceIds: new Set(plan.walkableSurfaces
        .filter(({ id }) => !rebuiltAssemblyStairIds.has(id))
        .map(({ id }) => id)),
    });
  }

  const nativeLinks = nativeRoomSurfaceLinks(
    native.nativeSurfaces,
    'server',
    NATIVE_SERVER_PLACEMENT_ID,
  );
  const nativeRampSurfaces = native.nativeSurfaces
    .filter(({ traversalRoute }) => traversalRoute?.routeId === 'ramp.server-crypt.outer-wall')
    .sort((left, right) => (
      left.traversalRoute.sequenceIndex - right.traversalRoute.sequenceIndex
    ));
  const nativeRampSurface = nativeRampSurfaces[0];
  const nativeRampGround = native.nativeSurfaceByLocalId
    .get('surface.v1-room.server-crypt.-6.6.0');
  const nativeRampUpper = native.nativeSurfaceByLocalId
    .get('surface.v1-room.server-crypt.-6.-5.1');
  if (nativeRampSurfaces.length !== 10 || !nativeRampSurface || !nativeRampGround || !nativeRampUpper) {
    throw new Error('Native V1 Server Crypt has no complete ten-tile outer-wall ramp route.');
  }
  const rampStart = vector(
    nativeRampSurfaces[0].center.x,
    nativeRampSurfaces[0].ramp.startY,
    nativeRampSurfaces[0].bounds.max.z,
  );
  const rampEnd = vector(
    nativeRampSurfaces.at(-1).center.x,
    nativeRampSurfaces.at(-1).ramp.endY,
    nativeRampSurfaces.at(-1).bounds.min.z,
  );
  nativeRampSurface.stairs = {
    type: 'walkable-stairs',
    path: [rampStart, rampEnd],
    maxRiser: 0.18,
    minimumTread: 0.45,
    width: 2.8,
    ledgeClimbDisabled: true,
    endpointSurfaceIds: { start: nativeRampGround.id, end: nativeRampUpper.id },
    minimumEndpointOverlap: STAIR_ENDPOINT_OVERLAP,
    maximumEndpointHeightDelta: STAIR_ENDPOINT_HEIGHT_TOLERANCE,
    minimumUsableSeamWidth: 2.8,
    nativeRampSurfaceIds: nativeRampSurfaces.map(({ id }) => id),
  };
  const rampApproach = vector(
    nativeRampGround.center.x,
    nativeRampGround.bounds.max.y,
    nativeRampGround.center.z,
  );
  const centerlineSegmentCount = Math.max(4, Math.ceil(
    Math.hypot(rampEnd.x - rampStart.x, rampEnd.z - rampStart.z) / 2.5,
  ));
  const nativeStairLink = {
    id: 'traversal.server.landmark-stairs',
    regionId: 'server',
    fromSurfaceId: nativeRampGround.id,
    toSurfaceId: nativeRampUpper.id,
    viaSurfaceId: nativeRampSurface.id,
    mode: 'walkable-stairs',
    bidirectional: true,
    minimumWidth: 2.8,
    maximumRiser: 0.18,
    minimumTread: 0.45,
    nativeFixedRoomPlacementId: NATIVE_SERVER_PLACEMENT_ID,
    nativeRampSurfaceIds: nativeRampSurfaces.map(({ id }) => id),
    approachWaypoints: [rampApproach, structuredClone(rampStart)],
    approachSurfaceIds: [nativeRampGround.id, nativeRampGround.id],
    approachSegments: [{
      fromWaypointIndex: 0,
      toWaypointIndex: 1,
      surfaceIds: [nativeRampGround.id],
      seamWidth: null,
    }],
    waypoints: Array.from({ length: centerlineSegmentCount + 1 }, (_, index) => {
      const progress = index / centerlineSegmentCount;
      return vector(
        rampStart.x + (rampEnd.x - rampStart.x) * progress,
        rampStart.y + (rampEnd.y - rampStart.y) * progress,
        rampStart.z + (rampEnd.z - rampStart.z) * progress,
      );
    }),
    reverseEgressWaypoints: [vector(
      nativeRampUpper.center.x,
      nativeRampUpper.bounds.max.y,
      nativeRampUpper.center.z,
    )],
    approachContract: {
      sourceSurfaceId: nativeRampGround.id,
      stairSurfaceId: nativeRampSurface.id,
      ingressPortalId: null,
      ingressPoint: null,
      ingressDepth: null,
      ingressSurfaceIds: [],
      combatRejoin: null,
      sampleSpacing: 0.21,
      capsuleRadius: 0.46,
      groundedOnly: true,
      jumpAllowed: false,
      ledgeClimbAllowed: false,
    },
  };
  plan.traversalLinks.push(...nativeLinks, nativeStairLink);

  const alphaBinding = rebindPlanAnchorToNativeDescriptorV2(plan, native, {
    planAnchorId: 'anchor.key.alpha',
    descriptorAnchorId: 'anchor.key.alpha',
    regionId: 'server',
    placementId: NATIVE_SERVER_PLACEMENT_ID,
  });
  // Face the offset pedestal back along its own catwalk tile.  This makes the
  // declared public interaction side the same full-capsule standing area used
  // by the real camera/line-of-sight proof, not the wall edge north of it.
  alphaBinding.planAnchor.forward = vector(0, 0, -1);
  alphaBinding.planAnchor.forwardX = 0;
  alphaBinding.planAnchor.forwardZ = -1;
  alphaBinding.surface.interactionSurfaceRole = 'credential-pedestal-pad';
  alphaBinding.surface.createsLedgeCandidates = false;
  repositionNativeInteractionFixtureV2(plan, native, {
    fixtureId: 'fixture.interaction.pickup.keycard-alpha',
    anchorId: alphaBinding.planAnchor.id,
  });

  const serverRegion = plan.regions.find(({ id }) => id === 'server');
  if (!serverRegion) throw new Error('Native Server Crypt region metadata is missing.');
  const groundSurfaceIds = native.nativeSurfaces
    .filter((surface) => surface.bounds.max.y <= native.compiled.worldBounds.min.y + 0.051)
    .map(({ id }) => id)
    .sort();
  const rampSurfaceIds = nativeRampSurfaces.map(({ id }) => id);
  const catwalkSurfaceIds = native.nativeSurfaces
    .filter((surface) => (
      surface.bounds.max.y >= native.compiled.worldBounds.min.y + 4
      && !rampSurfaceIds.includes(surface.id)
    ))
    .map(({ id }) => id)
    .sort();
  if (!groundSurfaceIds.length || !rampSurfaceIds.length || !catwalkSurfaceIds.length) {
    throw new Error('Native Server Crypt cannot derive its authored aisle, ramp, and catwalk subregions.');
  }
  serverRegion.cellIds = [NATIVE_SERVER_CELL_ID];
  serverRegion.subRegions = [
    {
      id: 'server.monolith-aisles',
      cellId: NATIVE_SERVER_CELL_ID,
      purpose: 'V1 server monolith grid, central energy core, and clear ground circulation aisles',
      surfaceIds: groundSurfaceIds,
      nativeFixedRoomPlacementId: NATIVE_SERVER_PLACEMENT_ID,
    },
    {
      id: 'server.outer-wall-ramp',
      cellId: NATIVE_SERVER_CELL_ID,
      purpose: 'continuous V1 west-wall walking ramp with exact deck seams',
      surfaceIds: rampSurfaceIds,
      nativeFixedRoomPlacementId: NATIVE_SERVER_PLACEMENT_ID,
    },
    {
      id: 'server.upper-inspection-run',
      cellId: NATIVE_SERVER_CELL_ID,
      purpose: 'V1 north/east inspection catwalk containing the remote Alpha pedestal',
      surfaceIds: catwalkSurfaceIds,
      nativeFixedRoomPlacementId: NATIVE_SERVER_PLACEMENT_ID,
    },
  ];

  const integration = plan.nativeFixedRoomIntegration;
  if (!integration) throw new Error('Native fixed-room integration ledger is missing.');
  integration.activePlacementIds = [...new Set([
    ...integration.activePlacementIds,
    NATIVE_SERVER_PLACEMENT_ID,
  ])].sort();
  integration.activeDescriptorIds = [...new Set([
    ...integration.activeDescriptorIds,
    NATIVE_SERVER_DESCRIPTOR_ID,
  ])].sort();
  integration.incompleteDescriptorIds = integration.incompleteDescriptorIds
    .filter((id) => id !== NATIVE_SERVER_DESCRIPTOR_ID);
  integration.genericFallbackGeometry = false;
}

function integrateNativeAssemblyMachineFactoryV2(plan) {
  const module = getLegacyFixedRoomModuleV2(NATIVE_ASSEMBLY_DESCRIPTOR_ID);
  if (!module) throw new Error(`Missing native V1 Assembly module ${NATIVE_ASSEMBLY_DESCRIPTOR_ID}.`);
  const socketIds = {
    security: 'socket.v1-room.machine-factory.ground.south-east-bucket',
    server: 'socket.v1-room.machine-factory.catwalk.north-center',
    freight: 'socket.v1-room.machine-factory.lower.freight-catchment',
  };
  for (const socketId of Object.values(socketIds)) {
    if (!module.extensionSockets.some(({ id }) => id === socketId)) {
      throw new Error(`Native V1 Assembly is missing ${socketId}.`);
    }
  }
  const native = prepareNativeFixedRoomRegionV2(plan, {
    descriptorId: NATIVE_ASSEMBLY_DESCRIPTOR_ID,
    placementId: NATIVE_ASSEMBLY_PLACEMENT_ID,
    regionId: 'assembly',
    cellId: NATIVE_ASSEMBLY_CELL_ID,
    translation: { x: -96, y: 0, z: 40 },
    yawQuarterTurns: 0,
    localOpenSocketIds: Object.values(socketIds),
    authoredFixtureBindings: new Map([
      ['fixture.v1-room.machine-factory.prime-mover', 'pump-line-west'],
      ['fixture.v1-room.machine-factory.robot-arm-15.16--7.182', 'pump-line-east'],
      ['fixture.v1-room.machine-factory.press-0', 'press-feed'],
    ]),
  });

  const securityBinding = bindNativeFixedRoomPortalEndpointV2(plan, native, {
    portalId: 'portal.security-assembly', endpointName: 'to', localSocketId: socketIds.security,
  });
  const serverBinding = bindNativeFixedRoomPortalEndpointV2(plan, native, {
    portalId: 'portal.assembly-server', endpointName: 'from', localSocketId: socketIds.server,
  });
  const freightBinding = bindNativeFixedRoomPortalEndpointV2(plan, native, {
    portalId: 'portal.assembly-freight-drop', endpointName: 'from', localSocketId: socketIds.freight,
  });
  plan.traversalLinks = plan.traversalLinks.filter((link) => (
    !native.genericSurfaceIds.has(link.fromSurfaceId)
    && !native.genericSurfaceIds.has(link.toSurfaceId)
    && !native.genericSurfaceIds.has(link.viaSurfaceId)
  ));
  const nativeLinks = nativeRoomSurfaceLinks(
    native.nativeSurfaces,
    'assembly',
    NATIVE_ASSEMBLY_PLACEMENT_ID,
  );
  const nativeRampSurfaces = native.nativeSurfaces
    .filter(({ traversalRoute }) => traversalRoute?.routeId === 'ramp.machine-factory.west-catwalk')
    .sort((left, right) => (
      left.traversalRoute.sequenceIndex - right.traversalRoute.sequenceIndex
    ));
  const nativeRampSurface = nativeRampSurfaces[0];
  const nativeRampGround = native.nativeSurfaceByLocalId
    .get('surface.v1-room.machine-factory.-8.7.0');
  const nativeRampUpper = native.nativeSurfaceByLocalId
    .get('surface.v1-room.machine-factory.-8.-5.1');
  if (nativeRampSurfaces.length !== 11 || !nativeRampSurface || !nativeRampGround || !nativeRampUpper) {
    throw new Error('Native V1 Assembly has no complete eleven-tile west-catwalk ramp route.');
  }
  const firstNativeRamp = nativeRampSurfaces[0];
  const lastNativeRamp = nativeRampSurfaces.at(-1);
  // The aggregate walking profile is the exact authored ramp footprint, not
  // a line extended through the centres of the adjoining deck tiles. Its
  // endpoints therefore coincide with the lower/upper physical tile seams.
  const rampStart = vector(
    firstNativeRamp.center.x,
    firstNativeRamp.ramp.startY,
    firstNativeRamp.bounds.max.z,
  );
  const rampEnd = vector(
    lastNativeRamp.center.x,
    lastNativeRamp.ramp.endY,
    lastNativeRamp.bounds.min.z,
  );
  const nativeRampCenterline = [
    structuredClone(rampStart),
    ...nativeRampSurfaces.map((surface) => vector(
      surface.center.x,
      surface.center.y,
      surface.center.z,
    )),
    structuredClone(rampEnd),
  ];
  const nativeRampReverseEgress = vector(
    nativeRampGround.center.x,
    nativeRampGround.bounds.max.y,
    nativeRampGround.center.z,
  );
  nativeRampSurface.stairs = {
    type: 'walkable-stairs',
    path: [rampStart, rampEnd],
    maxRiser: 0.18,
    minimumTread: 0.45,
    width: 2.8,
    ledgeClimbDisabled: true,
    endpointSurfaceIds: { start: nativeRampGround.id, end: nativeRampUpper.id },
    minimumEndpointOverlap: 1.2,
    maximumEndpointHeightDelta: 0.05,
    minimumUsableSeamWidth: 2.8,
    nativeRampSurfaceIds: nativeRampSurfaces.map(({ id }) => id),
  };
  const nativeStairLink = {
    id: 'traversal.assembly.landmark-stairs',
    regionId: 'assembly',
    fromSurfaceId: nativeRampGround.id,
    toSurfaceId: nativeRampUpper.id,
    viaSurfaceId: nativeRampSurface.id,
    mode: 'walkable-stairs',
    bidirectional: true,
    minimumWidth: 2.8,
    maximumRiser: 0.18,
    minimumTread: 0.45,
    nativeFixedRoomPlacementId: NATIVE_ASSEMBLY_PLACEMENT_ID,
    nativeRampSurfaceIds: nativeRampSurfaces.map(({ id }) => id),
    // Public combat must climb the actual retained V1 ramp to reach the
    // elevated Assembly enemy. Own the exact lower seam, all eleven native
    // ramp-tile centres, and the upper seam; graph adjacency alone is not a
    // physical traversal contract.
    stairWaypoints: nativeRampCenterline,
    waypoints: nativeRampCenterline.map((point) => structuredClone(point)),
    reverseEgressWaypoints: [nativeRampReverseEgress],
  };

  // The V1 Machine Factory is one physically enclosed authored chamber, but
  // its traversal is not one undifferentiated box. Preserve that real shell
  // and describe its internal spaces through disjoint native surface sets:
  // the east entry/production lanes, the west machinery branch, and the
  // complete west ramp plus upper inspection deck. These are plan-owned
  // semantic subregions, not overlapping replacement cells or generic rooms.
  const assemblyRegion = plan.regions.find(({ id }) => id === 'assembly');
  if (!assemblyRegion) throw new Error('Native Assembly region metadata is missing.');
  const nativeGroundSurfaces = native.nativeSurfaces.filter((surface) => (
    surface.bounds.max.y <= native.compiled.worldBounds.min.y + 0.051
  ));
  const entryProductionSurfaceIds = nativeGroundSurfaces
    .filter((surface) => surface.center.x >= native.placementRecord.transform.translation.x)
    .map(({ id }) => id)
    .sort();
  const machineConveyorSurfaceIds = nativeGroundSurfaces
    .filter((surface) => surface.center.x < native.placementRecord.transform.translation.x)
    .map(({ id }) => id)
    .sort();
  const rampAndCatwalkSurfaceIds = native.nativeSurfaces
    .filter((surface) => surface.bounds.max.y > native.compiled.worldBounds.min.y + 0.051)
    .map(({ id }) => id)
    .sort();
  if ([entryProductionSurfaceIds, machineConveyorSurfaceIds, rampAndCatwalkSurfaceIds]
    .some((surfaceIds) => surfaceIds.length === 0)) {
    throw new Error('Native Assembly cannot derive its three authored surface-owned subregions.');
  }
  assemblyRegion.cellIds = [NATIVE_ASSEMBLY_CELL_ID];
  assemblyRegion.subRegions = [
    {
      id: 'assembly.entry-production-floor',
      cellId: NATIVE_ASSEMBLY_CELL_ID,
      purpose: 'south-east entry apron and active production lanes',
      surfaceIds: entryProductionSurfaceIds,
      nativeFixedRoomPlacementId: NATIVE_ASSEMBLY_PLACEMENT_ID,
    },
    {
      id: 'assembly.machine-conveyor-branch',
      cellId: NATIVE_ASSEMBLY_CELL_ID,
      purpose: 'west pump machinery and conveyor exploration branch',
      surfaceIds: machineConveyorSurfaceIds,
      nativeFixedRoomPlacementId: NATIVE_ASSEMBLY_PLACEMENT_ID,
    },
    {
      id: 'assembly.west-ramp-upper-catwalk',
      cellId: NATIVE_ASSEMBLY_CELL_ID,
      purpose: 'continuous walkable west ramp and upper inspection catwalk',
      surfaceIds: rampAndCatwalkSurfaceIds,
      nativeFixedRoomPlacementId: NATIVE_ASSEMBLY_PLACEMENT_ID,
    },
  ];

  const securityConnectorSurfaceId = securityBinding.portal.physicalRoute.surfaceIds.at(-1);
  const serverConnectorSurfaceId = serverBinding.portal.physicalRoute.surfaceIds.at(0);
  plan.traversalLinks.push(
    ...nativeLinks,
    nativeStairLink,
    {
      id: 'traversal.connector.security-assembly.to-native-endpoint',
      regionId: 'assembly',
      fromSurfaceId: securityConnectorSurfaceId,
      toSurfaceId: securityBinding.inletSurface.id,
      mode: 'walk',
      bidirectional: true,
      minimumWidth: securityBinding.socket.opening.width,
      portalId: securityBinding.portal.id,
      nativeFixedRoomSocketId: securityBinding.socket.id,
    },
    {
      id: 'traversal.connector.assembly-server.from-native-endpoint',
      regionId: 'assembly',
      fromSurfaceId: serverBinding.inletSurface.id,
      toSurfaceId: serverConnectorSurfaceId,
      mode: 'walk',
      bidirectional: true,
      minimumWidth: serverBinding.socket.opening.width,
      portalId: serverBinding.portal.id,
      nativeFixedRoomSocketId: serverBinding.socket.id,
    },
  );

  const encounterBinding = rebindPlanAnchorToNativeDescriptorV2(plan, native, {
    planAnchorId: 'anchor.encounter.assembly',
    descriptorAnchorId: 'anchor.encounter.assembly',
  });
  const cacheBinding = rebindPlanAnchorToNativeDescriptorV2(plan, native, {
    planAnchorId: 'anchor.cache.alpha',
    descriptorAnchorId: 'anchor.cache.assembly',
  });
  const returnDescriptor = module.landmarkAnchors.find(({ id }) => id === 'anchor.freight-return');
  const returnSurfaceLocalId = freightBinding.socket.approachSurfaceIds
    .map((id) => id.replace(`${NATIVE_ASSEMBLY_PLACEMENT_ID}:`, ''))
    .find((localId) => native.nativeSurfaceByLocalId.has(localId));
  if (!returnDescriptor || !returnSurfaceLocalId) {
    throw new Error('Native V1 Assembly freight-return rim binding is incomplete.');
  }
  plan.anchors.push({
    id: 'anchor.freight-return',
    regionId: 'assembly',
    position: vector(0, 0, 0),
    forward: vector(0, 0, 1),
    purpose: returnDescriptor.purpose,
    surfaceId: '',
    safeSurfaceId: '',
    hazardTag: null,
  });
  rebindPlanAnchorToNativeDescriptorV2(plan, native, {
    planAnchorId: 'anchor.freight-return',
    descriptorAnchorId: 'anchor.freight-return',
    surfaceId: returnSurfaceLocalId,
    useSurfaceCenter: true,
  });

  const cacheReward = plan.rewards.find(({ id }) => id === 'reward.cache.alpha');
  const cacheFixture = plan.structuralFixtures.find(({ id }) => id === 'fixture.interaction.open.cache-alpha');
  if (!cacheReward || !cacheFixture) throw new Error('Native Assembly cache content is incomplete.');
  cacheReward.regionId = 'assembly';
  const cacheDelta = {
    x: cacheBinding.planAnchor.position.x - cacheBinding.oldPosition.x,
    y: cacheBinding.planAnchor.position.y - cacheBinding.oldPosition.y,
    z: cacheBinding.planAnchor.position.z - cacheBinding.oldPosition.z,
  };
  cacheFixture.bounds = shiftBounds(cacheFixture.bounds, cacheDelta);
  cacheFixture.colliderBounds = cacheFixture.colliderBounds.map((bounds) => shiftBounds(bounds, cacheDelta));
  cacheFixture.regionId = 'assembly';
  cacheFixture.cellId = NATIVE_ASSEMBLY_CELL_ID;
  cacheFixture.supportBoundaryIds = native.nativeFloorBoundaries.map(({ id }) => id);
  cacheFixture.nativeSupportSurfaceId = cacheBinding.surface.id;

  const encounter = plan.encounters.find(({ id }) => id === 'encounter.assembly');
  if (!encounter) throw new Error('Native Assembly encounter is missing.');
  const allBlockingBounds = plan.structuralFixtures
    .filter(({ regionId, collision }) => regionId === 'assembly' && collision === 'blocking')
    .flatMap(({ colliderBounds = [] }) => colliderBounds);
  const spawnIsClear = (surface) => {
    const point = vector(surface.center.x, surface.bounds.max.y, surface.center.z);
    const radius = Number(encounter.spawnClearance.radius);
    const height = Number(encounter.spawnClearance.height);
    const blocked = allBlockingBounds.some((bounds) => (
      bounds.max.x > point.x - radius && bounds.min.x < point.x + radius
      && bounds.max.z > point.z - radius && bounds.min.z < point.z + radius
      && bounds.max.y > point.y + 0.051 && bounds.min.y < point.y + height
    ));
    return !blocked ? point : null;
  };
  const ingressSurface = securityBinding.inletSurface;
  const doorwaySettleSurface = native.nativeSurfaceByLocalId.get(
    'surface.v1-room.machine-factory.7.6.0',
  );
  const groundSpawnSurface = native.nativeSurfaceByLocalId.get(
    'surface.v1-room.machine-factory.6.6.0',
  );
  const groundRejoinSurface = native.nativeSurfaceByLocalId.get(
    'surface.v1-room.machine-factory.6.7.0',
  );
  const groundSpawnPoint = groundSpawnSurface && spawnIsClear(groundSpawnSurface);
  const elevatedSpawnSurface = native.nativeSurfaces.find((surface) => (
    surface.bounds.max.y >= 3.5
    && surface.id !== cacheBinding.surface.id
    && spawnIsClear(surface)
  ));
  const elevatedSpawnPoint = elevatedSpawnSurface && spawnIsClear(elevatedSpawnSurface);
  if (!ingressSurface || !doorwaySettleSurface || !groundRejoinSurface || !groundSpawnPoint
    || !elevatedSpawnSurface || !elevatedSpawnPoint) {
    const elevatedCandidateCount = native.nativeSurfaces.filter((surface) => (
      surface.bounds.max.y >= 3.5 && spawnIsClear(surface)
    )).length;
    throw new Error(`Native Assembly has no two fixture-clear exact encounter spawn surfaces (ground=${Boolean(groundSpawnPoint)}, elevated=${elevatedCandidateCount}).`);
  }
  encounter.spawnPoints = [groundSpawnPoint, elevatedSpawnPoint];
  encounter.spawnSurfaceIds = [groundSpawnSurface.id, elevatedSpawnSurface.id];
  encounter.spawnPattern.points = structuredClone(encounter.spawnPoints);
  encounter.zoneBounds = {
    min: vector(native.compiled.worldBounds.min.x + 1.2, native.compiled.worldBounds.min.y, native.compiled.worldBounds.min.z + 1.2),
    // Keep the ordinary Reaverbot's soft arena behind the complete doorway
    // egress. The trigger still reaches the portal, but an activated enemy
    // cannot walk into the narrow frame and knock a player back into Security
    // before the player has reached the native circulation floor.
    max: vector(
      native.compiled.worldBounds.max.x - 1.2,
      native.compiled.worldBounds.max.y,
      doorwaySettleSurface.bounds.max.z,
    ),
  };
  encounter.triggerZoneBounds = {
    min: structuredClone(encounter.zoneBounds.min),
    max: vector(
      encounter.zoneBounds.max.x,
      encounter.zoneBounds.max.y,
      native.compiled.worldBounds.max.z,
    ),
  };
  const engagement = encounter.entryEngagementContracts?.[0];
  if (engagement) {
    engagement.surfaceId = groundSpawnSurface.id;
    engagement.surfaceIds = [
      ingressSurface.id,
      doorwaySettleSurface.id,
      groundSpawnSurface.id,
      groundRejoinSurface.id,
    ];
    engagement.sourceTraversalLinkId = nativeStairLink.id;
    engagement.minimumArenaEdgeClearance = 1.25;
    engagement.minimumPlayerSpawnSeparation = 1.8;
    engagement.minimumEnemyIngressClearance = 2;
  }
  const securityDestination = securityBinding.portal.to.center;
  const priorSecurityPoint = [...securityBinding.portal.physicalRoute.routePoints]
    .reverse()
    .find((point) => Math.hypot(
      point.x - securityDestination.x,
      point.z - securityDestination.z,
    ) > 0.05);
  const securityRouteLength = Math.hypot(
    securityDestination.x - priorSecurityPoint.x,
    securityDestination.z - priorSecurityPoint.z,
  );
  const ingressDepth = Number(securityBinding.portal.traversal.interiorIngressDepth);
  const ingressPoint = vector(
    securityDestination.x
      + ((securityDestination.x - priorSecurityPoint.x) / securityRouteLength) * ingressDepth,
    groundSpawnSurface.bounds.max.y,
    securityDestination.z
      + ((securityDestination.z - priorSecurityPoint.z) / securityRouteLength) * ingressDepth,
  );
  const approachDecks = Array.from({ length: 16 }, (_, index) => (
    native.nativeSurfaceByLocalId.get(`surface.v1-room.machine-factory.${7 - index}.7.0`)
  ));
  if (approachDecks.some((surface) => !surface)) {
    throw new Error('Native Assembly south circulation row cannot reach the exact ramp foot.');
  }
  const doorwaySettlePoint = vector(
    doorwaySettleSurface.center.x,
    doorwaySettleSurface.bounds.max.y,
    doorwaySettleSurface.center.z,
  );
  const engagementPoint = vector(
    groundSpawnSurface.center.x,
    groundSpawnSurface.bounds.max.y,
    groundSpawnSurface.center.z,
  );
  nativeStairLink.approachWaypoints = [
    ingressPoint,
    doorwaySettlePoint,
    engagementPoint,
    ...approachDecks.slice(1).map((surface) => vector(
      surface.center.x,
      surface.bounds.max.y,
      surface.center.z,
    )),
    structuredClone(rampStart),
  ];
  nativeStairLink.approachSurfaceIds = [
    ingressSurface.id,
    doorwaySettleSurface.id,
    groundSpawnSurface.id,
    ...approachDecks.slice(1).map(({ id }) => id),
    nativeRampGround.id,
  ];
  nativeStairLink.approachSegments = nativeStairLink.approachWaypoints
    .slice(0, -1)
    .map((_, index) => {
      const fromSurfaceId = nativeStairLink.approachSurfaceIds[index];
      const toSurfaceId = nativeStairLink.approachSurfaceIds[index + 1];
      return {
        fromWaypointIndex: index,
        toWaypointIndex: index + 1,
        surfaceIds: fromSurfaceId === toSurfaceId
          ? [fromSurfaceId]
          : [fromSurfaceId, toSurfaceId],
        seamWidth: fromSurfaceId === toSurfaceId ? null : 2.8,
      };
    });
  nativeStairLink.approachContract = {
    sourceSurfaceId: nativeRampGround.id,
    stairSurfaceId: nativeRampSurface.id,
    groundedOnly: true,
    jumpAllowed: false,
    ledgeClimbAllowed: false,
    capsuleRadius: 0.46,
    sampleSpacing: 0.21,
    ingressPortalId: securityBinding.portal.id,
    ingressPoint,
    ingressDepth,
    ingressSurfaceIds: [ingressSurface.id],
    doorwayEgress: {
      id: 'doorway-egress.security-assembly.native-machine-factory',
      mode: 'lane-preserving-then-recenter',
      portalId: securityBinding.portal.id,
      exteriorStagingDepth: 0.8,
      straightClearanceDepth: 2,
      maximumLaneOffset: 0.7,
      recenterPoint: structuredClone(doorwaySettlePoint),
      connectorSurfaceId: securityBinding.portal.physicalRoute.surfaceIds.at(-1),
      destinationSurfaceIds: [ingressSurface.id, doorwaySettleSurface.id],
      capsuleRadius: 0.46,
      capsuleHeight: 3.2,
      sampleSpacing: 0.21,
    },
    combatRejoin: {
      id: 'combat-rejoin.assembly.entry-ground',
      encounterId: encounter.id,
      engagementId: engagement.id,
      surfaceId: groundSpawnSurface.id,
      surfaceIds: structuredClone(engagement.surfaceIds),
      segmentStart: structuredClone(ingressPoint),
      segmentEnd: structuredClone(groundSpawnPoint),
      waypoints: [
        structuredClone(ingressPoint),
        structuredClone(doorwaySettlePoint),
        structuredClone(groundSpawnPoint),
      ],
      nextWaypointIndex: 3,
      minimumProgress: 0,
      maximumProgress: 1,
      maximumLateralOffset: 0.25,
      capsuleRadius: Number(engagement.capsuleRadius),
      capsuleHeight: Number(engagement.capsuleHeight),
      sampleSpacing: Math.min(0.21, Number(engagement.sampleSpacing)),
    },
  };

  const fall = plan.falls.find(({ sourcePortalId }) => sourcePortalId === freightBinding.portal.id);
  const catchment = plan.walkableSurfaces.find(({ id }) => id === fall?.catchmentSurfaceId);
  const catchmentSafeAnchor = plan.safeAnchors.find(({ id }) => id === fall?.safeAnchorId);
  if (!fall || !catchment || !catchmentSafeAnchor) throw new Error('Native Assembly fall catchment is incomplete.');
  const crumbleMechanism = plan.mechanisms.find(({ id }) => id === 'mechanism.freight-crumble');
  if (!crumbleMechanism) throw new Error('Native Assembly freight drop has no automatic crumble controller.');
  const crumbleSurfaceId = 'surface.assembly.native-freight-crumble';
  const crumbleSupportId = 'fixture.assembly.native-freight-crumble-brackets';
  const crumbleCenter = freightBinding.portal.from.center;
  const crumbleHalfExtent = Number(freightBinding.socket.opening.width) * 0.5;
  const crumbleSupportBounds = {
    min: vector(
      crumbleCenter.x - crumbleHalfExtent,
      crumbleCenter.y - 0.52,
      crumbleCenter.z - crumbleHalfExtent,
    ),
    max: vector(
      crumbleCenter.x + crumbleHalfExtent,
      crumbleCenter.y - 0.12,
      crumbleCenter.z + crumbleHalfExtent,
    ),
  };
  const crumbleSurface = {
    id: crumbleSurfaceId,
    regionId: 'assembly',
    cellId: NATIVE_ASSEMBLY_CELL_ID,
    bounds: {
      min: vector(
        crumbleCenter.x - crumbleHalfExtent,
        crumbleCenter.y - 0.12,
        crumbleCenter.z - crumbleHalfExtent,
      ),
      max: vector(
        crumbleCenter.x + crumbleHalfExtent,
        crumbleCenter.y,
        crumbleCenter.z + crumbleHalfExtent,
      ),
    },
    purpose: 'visibly cracking automatic collapse through the native Machine Factory freight aperture',
    supportBoundaryIds: [freightBinding.boundary.id],
    supportFixtureIds: [crumbleSupportId],
    supportProfile: 'native-breakaway-industrial-brackets-v2',
    visualProfile: 'signaled-native-machine-factory-crumble-panels-v2',
    collision: 'dynamic',
    hazardTag: null,
    mechanismId: crumbleMechanism.id,
    nativeFixedRoomPlacementId: NATIVE_ASSEMBLY_PLACEMENT_ID,
    nativeFixedRoomSocketId: freightBinding.socket.id,
    authoredNativeExtension: 'automatic-freight-aperture-crumble-panel',
    geometry: {
      type: 'crumble',
      aperturePortalId: freightBinding.portal.id,
      noManualRearm: true,
      nativeFixedRoomSocketId: freightBinding.socket.id,
    },
  };
  plan.structuralFixtures.push({
    id: crumbleSupportId,
    type: 'structural-support',
    subtype: 'native-breakaway-support-brackets',
    regionId: 'assembly',
    cellId: NATIVE_ASSEMBLY_CELL_ID,
    bounds: structuredClone(crumbleSupportBounds),
    materialProfileId: 'legacy-floor',
    visualProfile: 'native-breakaway-industrial-brackets-v2',
    visualId: `visual.${crumbleSupportId}`,
    visualIds: [`visual.${crumbleSupportId}`],
    colliderIds: [`${crumbleSupportId}:collider:0`],
    colliderBounds: [structuredClone(crumbleSupportBounds)],
    collision: 'blocking',
    supportBoundaryIds: [freightBinding.boundary.id],
    gameplayPurpose: 'visibly supports the automatic freight-aperture crumble panel while intact',
    mechanismId: crumbleMechanism.id,
    nativeFixedRoomPlacementId: NATIVE_ASSEMBLY_PLACEMENT_ID,
    nativeFixedRoomSocketId: freightBinding.socket.id,
    authoredNativeExtension: 'automatic-freight-aperture-crumble-support',
  });
  plan.walkableSurfaces.push(crumbleSurface);
  freightBinding.portal.mechanismId = crumbleMechanism.id;
  // The shaft itself remains an intentional airborne connector; the source
  // floor is the plan-owned automatic crumble mechanism that opens it.
  freightBinding.portal.traversal.mode = 'intentional-drop';
  const nativeDropWidth = Number(freightBinding.socket.opening.width);
  freightBinding.portal.traversal.minimumWidth = nativeDropWidth;
  freightBinding.portal.to.dimensions = {
    ...freightBinding.portal.to.dimensions,
    width: nativeDropWidth,
    depth: nativeDropWidth,
  };
  const dropBoundaryIds = new Set([
    freightBinding.portal.to.boundaryId,
    ...(freightBinding.portal.physicalRoute.boundaryIds ?? []),
  ]);
  for (const boundary of plan.structuralBoundaries.filter(({ id }) => dropBoundaryIds.has(id))) {
    for (const opening of boundary.openings ?? []) {
      if (opening.portalId !== freightBinding.portal.id) continue;
      opening.dimensions = {
        ...opening.dimensions,
        width: nativeDropWidth,
        depth: nativeDropWidth,
      };
    }
  }
  freightBinding.portal.physicalRoute.endpointSurfaceIds.from = crumbleSurface.id;
  crumbleMechanism.states = crumbleMechanism.states.map((state) => (
    state.id === 'Intact' ? { ...state, landingSurfaceId: crumbleSurface.id } : state
  ));
  crumbleMechanism.runtimeProfile = {
    ...crumbleMechanism.runtimeProfile,
    aperturePortalId: freightBinding.portal.id,
    surfaceId: crumbleSurface.id,
    noManualRearm: true,
  };
  fall.sourceApertureBoundaryId = freightBinding.boundary.id;
  fall.sourceSurfaceId = crumbleSurface.id;
  fall.sourceMechanismId = crumbleMechanism.id;
  fall.landingDimensions = {
    ...fall.landingDimensions,
    width: nativeDropWidth,
    depth: nativeDropWidth,
  };
  catchmentSafeAnchor.position = vector(
    (catchment.bounds.min.x + catchment.bounds.max.x) * 0.5,
    catchment.bounds.max.y,
    (catchment.bounds.min.z + catchment.bounds.max.z) * 0.5,
  );
  catchmentSafeAnchor.surfaceId = catchment.id;
  catchmentSafeAnchor.safeSurfaceId = catchment.id;
  plan.traversalLinks.push({
    id: 'traversal.assembly-freight-drop.native-crumble-access',
    regionId: 'assembly',
    fromSurfaceId: freightBinding.inletSurface.id,
    toSurfaceId: crumbleSurface.id,
    mode: 'walk',
    bidirectional: true,
    minimumWidth: freightBinding.socket.opening.width,
    conditions: [{
      op: 'stateEquals',
      variableId: 'mechanism.freight-crumble.state',
      value: 'Intact',
    }],
  }, {
    id: 'traversal.assembly-freight-drop.native-fall',
    regionId: 'assembly',
    fromSurfaceId: crumbleSurface.id,
    toSurfaceId: catchment.id,
    mode: 'crumble-drop',
    direction: 'forward-only',
    bidirectional: false,
    minimumWidth: freightBinding.socket.opening.width,
    portalId: freightBinding.portal.id,
    damageFree: true,
    playableDestination: true,
  });

  const integration = plan.nativeFixedRoomIntegration ?? {
    requiredPlacementCount: 11,
    activePlacementIds: [],
    activeDescriptorIds: [],
    incompleteDescriptorIds: [],
    genericFallbackGeometry: false,
  };
  integration.activePlacementIds = [...new Set([
    ...integration.activePlacementIds,
    NATIVE_ASSEMBLY_PLACEMENT_ID,
  ])].sort();
  integration.activeDescriptorIds = [...new Set([
    ...integration.activeDescriptorIds,
    NATIVE_ASSEMBLY_DESCRIPTOR_ID,
  ])].sort();
  integration.incompleteDescriptorIds = integration.incompleteDescriptorIds
    .filter((id) => id !== NATIVE_ASSEMBLY_DESCRIPTOR_ID);
  integration.genericFallbackGeometry = false;
  plan.nativeFixedRoomIntegration = integration;
}

function basePlan({ fixtureKind, seed, regionSpecs, connectionSpecs, descriptors, districts, materialByDistrict, content }) {
  const portals = makePortals(regionSpecs, connectionSpecs);
  const spatial = makeSpatialContract(regionSpecs, portals, materialByDistrict);
  if (fixtureKind === 'golden-complex') {
    // Close the authored floor seam at the Security -> Assembly opening.
    // Ordinary room floors stop 0.5m inside their shell, but this portal's
    // arched connector terminates on the shell plane. Extending only the
    // doorway-owned east fragment to that plane creates a continuous deck
    // without filling the adjacent crumble aperture or exposing exterior
    // space.
    const assemblyCell = spatial.spatialCells.find(({ id }) => id === cellId('assembly'));
    const assemblyEastFloor = spatial.walkableSurfaces.find(({ id }) => id === surfaceId('assembly', 'floor-east'));
    if (!assemblyCell || !assemblyEastFloor) throw new Error('Golden Assembly east ingress floor is missing.');
    assemblyEastFloor.bounds.max.x = assemblyCell.bounds.max.x;
  }
  if (fixtureKind === 'traversal-lab') {
    // The lower recovery shell shares y=0 with the gear-hall deck above it.
    // Keep the ceiling's thickness inside the lower cell so its rendered and
    // colliding top cannot mask or block the upper walkable floor.
    const recoveryCell = spatial.spatialCells.find(({ id }) => id === cellId('lab-recovery'));
    const recoveryCeiling = spatial.structuralBoundaries.find(({ id }) => id === boundaryId('lab-recovery', 'ceiling'));
    if (!recoveryCell || !recoveryCeiling) throw new Error('Traversal lab recovery shell is incomplete.');
    recoveryCeiling.bounds = {
      min: vector(recoveryCeiling.bounds.min.x, recoveryCell.bounds.max.y - 0.4, recoveryCeiling.bounds.min.z),
      max: vector(recoveryCeiling.bounds.max.x, recoveryCell.bounds.max.y, recoveryCeiling.bounds.max.z),
    };
  }
  addGateBarriers(spatial, portals, content.progression);
  addCatchmentSurfaces(spatial, portals, fixtureKind);
  addMechanismAndHazardSurfaces(spatial, regionSpecs, content.mechanisms, content.environmentStates, portals);
  bindClosedGatesToNonVaultableRoutes(spatial, portals, content.progression);
  addHazardTraversalLinks(spatial, content.environmentStates);
  addPlanOwnedInteractionFixtures(spatial, regionSpecs, content);
  bindStairsToExactDeckSeams(spatial, {
    // Golden Assembly is replaced wholesale by the compiled V1 Machine
    // Factory after the serializable base plan exists. Its temporary generic
    // connector stair has no gameplay/runtime ownership and must not block the
    // native catwalk endpoint from being authored at its exact elevation.
    ignoredSurfaceIds: fixtureKind === 'golden-complex'
      ? new Set(['surface.assembly.approach-assembly-server'])
      : new Set(),
  });
  bindGroundApproachesToAuthoredStairs(spatial, portals, content.encounters, {
    ignoredTraversalLinkIds: fixtureKind === 'golden-complex'
      ? new Set(['traversal.assembly.landmark-stairs'])
      : new Set(),
  });
  finalizeStructuralFixtureRuntimeIds(spatial.structuralFixtures);
  const regions = makeRegions(regionSpecs, portals);
  const safeAnchors = makeSafeAnchors(regionSpecs, fixtureKind);
  const minimumWalkableY = Math.min(...spatial.walkableSurfaces.map((entry) => entry.bounds.min.y));
  const planId = `dungeon-v2.${fixtureKind}.${seed}`;
  const fixtureSuffix = content.fixtureSuffix ?? fixtureKind;
  const plan = {
    schemaVersion: 1,
    generatorVersion: 'restart-m1',
    buildFingerprint: `dungeon-v2/restart-m1/schema-1/${fixtureKind}/${fixtureSuffix}/${String(seed)}`,
    id: planId,
    planId,
    fixtureId: `${fixtureKind === 'golden-complex' ? 'golden' : 'traversal-lab'}-${fixtureSuffix}`,
    acceptanceProfile: fixtureKind === 'golden-complex' ? 'golden' : 'traversal-lab',
    fixtureKind,
    undercroftType: content.undercroftType ?? null,
    seed: String(seed),
    districts,
    regions,
    modulePlacements: makeModulePlacements(regionSpecs, descriptors),
    // Authored semantic GLB rooms are selected and compiled into this
    // plan-owned collection before the plan is frozen.  The traversal lab has
    // no production room-pack placements, but it keeps the same public
    // contract so assembly never has to infer whether the collection exists.
    semanticRoomPackPlacements: [],
    progression: content.progression,
    keycardZones: content.keycardZones ?? [],
    encounters: content.encounters,
    rewards: content.rewards,
    objectives: content.objectives,
    environmentStates: content.environmentStates,
    mechanisms: content.mechanisms,
    minimap: makeMinimap(regions, portals, content),
    spatialCells: spatial.spatialCells,
    structuralBoundaries: spatial.structuralBoundaries,
    portals,
    connectionOrder: portals.map((entry) => entry.id),
    walkableSurfaces: spatial.walkableSurfaces,
    traversalLinks: spatial.traversalLinks,
    structuralFixtures: spatial.structuralFixtures,
    falls: makeFalls(portals, fixtureKind),
    anchors: content.anchors,
    safeAnchors,
    actions: content.actions,
    recoverySafeguard: {
      id: 'recovery-safeguard.main',
      planeY: minimumWalkableY - 8,
      lastSafeAnchorPolicy: 'plan-safe-anchor-only',
      resourcePolicy: 'preserve-health-barrier-ammo-salvage-keys-rewards',
      validationErrorCode: 'physics-recovery-safeguard-activated',
      acceptanceActivationLimit: 0,
    },
    assemblyContract: {
      noPrimitiveFallback: true,
      noExteriorVoid: true,
      visualCollisionParityTolerance: 0.05,
      maximumCameraRayDistance: 120,
      boundarySampleSpacing: 0.21,
    },
    compatibility: content.compatibility,
  };
  if (fixtureKind === 'golden-complex') {
    integrateNativeExtractionShrineV2(plan);
    integrateNativeAssemblyMachineFactoryV2(plan);
    integrateNativeServerCryptV2(plan);
    integrateNativeSecurityEntranceV2(plan);
    // The supplied semantic GLBs replace whole functional macro cells. They
    // are not decorative overlays and do not attach through the rejected
    // 42-cell diagnostic branch network. Final whole-plan validation remains
    // authoritative in DungeonGeneratorV2/fixture acceptance; the composer
    // performs only its atomic physical/state reconciliation here so startup
    // does not pay for the same exhaustive validation twice.
    if (content.deferSemanticRoomPackIntegration !== true) {
      integrateSemanticRoomPackProductionV2(plan, { validateDungeon: false });
      relocateSemanticRoomPackAnnexesV2(plan);
      integrateCanonicalNativeV1GoldenPhysicalCompositionV2(plan, {
        rebuildCanonicalConnections: (candidate, context) => (
          rebuildCanonicalNativeV1GoldenConnectionsV2(candidate, context, {
            addConnectorSpatialContracts,
            bindStairsToExactDeckSeams: (spatialContract) => (
              bindStairsToExactDeckSeams(spatialContract)
            ),
          })
        ),
      });
    }
  }
  const derivedSignatures = deriveDungeonTopologySignaturesV2(plan);
  for (const regionRecord of plan.regions) {
    regionRecord.topologySignature = derivedSignatures[regionRecord.id];
  }
  for (const placement of plan.modulePlacements) {
    const regionId = placement.regionIds?.[0];
    placement.topologySignature = derivedSignatures[regionId];
  }
  return plan;
}

export function createGoldenDungeonPlanV2(options = {}) {
  const seed = options.seed ?? 'm1-golden';
  const seedStreams = createDungeonSeedStreams(seed);
  const explicitHazard = options.undercroftType ?? options.hazardType ?? null;
  const requestedHazard = explicitHazard
    ?? (seedStreams.stream('district').chance(0.5) ? 'magma' : 'electrical');
  if (options.undercroftType && options.hazardType && options.undercroftType !== options.hazardType) {
    throw new TypeError('undercroftType and hazardType must match when both are provided.');
  }
  if (requestedHazard !== 'magma' && requestedHazard !== 'electrical') {
    throw new TypeError(`Unsupported V2 Undercroft type: ${requestedHazard}`);
  }
  const content = buildGoldenContent(GOLDEN_REGION_SPECS, requestedHazard, seedStreams);
  const gateContracts = [
    { id: 'Gate_Shortcut_Alpha', barrierId: 'Gate_Shortcut_Alpha', portalId: 'portal.freight-security-shortcut', classification: 'shortcut', requiredKeycardId: 'Keycard_Alpha', anchorId: 'anchor.shortcut.alpha', actionId: 'action.open.shortcut-alpha', fromRegionId: 'freight', toRegionId: 'security' },
    { id: 'Door_Alpha', barrierId: 'Door_Alpha', portalId: 'portal.security-sorting-alpha', classification: 'non-bypassable-progression', requiredKeycardId: 'Keycard_Alpha', anchorId: 'anchor.gate.alpha', actionId: 'action.open.door-alpha', fromRegionId: 'security', toRegionId: 'sorting' },
    { id: 'Gate_Shortcut_Beta', barrierId: 'Gate_Shortcut_Beta', portalId: 'portal.salvage-sorting-shortcut', classification: 'shortcut', requiredKeycardId: 'Keycard_Beta', anchorId: 'anchor.shortcut.beta', actionId: 'action.open.shortcut-beta', fromRegionId: 'salvage-tunnel', toRegionId: 'sorting' },
    { id: 'Door_Beta', barrierId: 'Door_Beta', portalId: 'portal.sorting-credential-beta', classification: 'non-bypassable-progression', requiredKeycardId: 'Keycard_Beta', anchorId: 'anchor.gate.beta', actionId: 'action.open.door-beta', fromRegionId: 'sorting', toRegionId: 'credential' },
    { id: 'Gate_Shortcut_Gamma', barrierId: 'Gate_Shortcut_Gamma', portalId: 'portal.hazard-core-credential-return', classification: 'shortcut', requiredKeycardId: 'Keycard_Gamma', anchorId: 'anchor.shortcut.gamma', actionId: 'action.open.shortcut-gamma', fromRegionId: 'hazard-core', toRegionId: 'credential' },
    { id: 'Gate_Credential_Loop', barrierId: 'Gate_Credential_Loop', portalId: 'portal.corkscrew-credential-loop', classification: 'shortcut', requiredKeycardId: null, anchorId: 'anchor.shortcut.credential-loop', actionId: 'action.open.credential-loop', fromRegionId: 'corkscrew', toRegionId: 'credential' },
    { id: 'Door_Gamma', barrierId: 'Door_Gamma', portalId: 'portal.corkscrew-machine-core-gamma', classification: 'non-bypassable-progression', requiredKeycardId: 'Keycard_Gamma', anchorId: 'anchor.gate.gamma', actionId: 'action.open.door-gamma', fromRegionId: 'corkscrew', toRegionId: 'machine-core' },
    { id: 'Door_Shrine', barrierId: 'Door_Shrine', portalId: 'portal.machine-core-extraction-shrine', classification: 'non-bypassable-progression', requiredKeycardId: 'Shrine_Key', anchorId: 'anchor.gate.shrine', actionId: 'action.open.door-shrine', fromRegionId: 'machine-core', toRegionId: 'extraction' },
  ];
  content.progression = {
    graphNodes: GOLDEN_REGION_SPECS.map((entry) => ({ id: entry.id, districtId: entry.districtId })),
    connections: GOLDEN_CONNECTION_SPECS.map((entry) => ({ id: `portal.${entry.id}`, fromRegionId: entry.fromRegionId, toRegionId: entry.toRegionId, barrierId: entry.barrierId ?? null })),
    keyContracts: [
      { keyId: 'Keycard_Alpha', rewardId: 'reward.keycard-alpha', gateId: 'Door_Alpha', shortcutGateId: 'Gate_Shortcut_Alpha', required: true },
      { keyId: 'Keycard_Beta', rewardId: 'reward.keycard-beta', gateId: 'Door_Beta', shortcutGateId: 'Gate_Shortcut_Beta', required: true },
      { keyId: 'Keycard_Gamma', rewardId: 'reward.keycard-gamma', gateId: 'Door_Gamma', shortcutGateId: 'Gate_Shortcut_Gamma', required: true },
      { keyId: 'Shrine_Key', rewardId: 'reward.shrine-key', gateId: 'Door_Shrine', required: true, sourceEncounterId: 'encounter.machine-core' },
    ],
    gates: gateContracts,
    gateContracts,
    objectiveIds: content.objectives.map((entry) => entry.id),
    extractionActionId: 'action.extract',
  };
  content.keycardZones = [
    { id: 'keycard-zone-alpha', keyId: 'Keycard_Alpha', regionIds: ['security', 'assembly', 'server', 'freight'] },
    { id: 'keycard-zone-beta', keyId: 'Keycard_Beta', regionIds: ['sorting', 'freight-sump', 'reservoir', 'gantry-sump', 'salvage-tunnel'] },
    { id: 'keycard-zone-gamma', keyId: 'Keycard_Gamma', regionIds: ['credential', 'parts', 'nest', 'corkscrew', 'hazard-intake', 'hazard-core'] },
  ];
  content.compatibility = {
    entranceRoomId: 'security',
    shrineRoomId: 'extraction',
    bossRoomId: 'machine-core',
    bossEncounterId: 'encounter.machine-core',
    playerStartAnchorId: 'anchor.player-start',
    largeRefractorRewardId: 'reward.large-refractor',
    extractionAnchorId: 'anchor.extraction',
    extractionSafeAnchorId: 'safe.extraction-return',
    campReturnAnchorId: 'safe.security-start',
    doors: gateContracts,
  };
  content.undercroftType = requestedHazard;
  content.fixtureSuffix = requestedHazard;
  // Narrow unit-fixture seam for independently testing the three atomic
  // replacement passes. DungeonGeneratorV2 and URL construction never set
  // this option; every playable Golden seed includes the authored pack.
  content.deferSemanticRoomPackIntegration = options.deferSemanticRoomPackIntegration === true;
  const materialByDistrict = {
    factory: MATERIAL_PROFILES.factory,
    waterworks: MATERIAL_PROFILES.waterworks,
    undercroft: requestedHazard === 'magma' ? MATERIAL_PROFILES.undercroftMagma : MATERIAL_PROFILES.undercroftElectrical,
  };
  return createDungeonPlanV2(basePlan({
    fixtureKind: 'golden-complex', seed, regionSpecs: GOLDEN_REGION_SPECS, connectionSpecs: GOLDEN_CONNECTION_SPECS,
    descriptors: GOLDEN_MODULE_DESCRIPTORS_V2,
    districts: [
      { id: 'factory', displayName: 'Ancient Factory', regionIds: GOLDEN_REGION_SPECS.filter((entry) => entry.districtId === 'factory').map((entry) => entry.id), functionalIdentity: 'credential production, sorting, machine operations, and shrine security' },
      { id: 'waterworks', displayName: 'Waterworks', regionIds: GOLDEN_REGION_SPECS.filter((entry) => entry.districtId === 'waterworks').map((entry) => entry.id), functionalIdentity: 'one conserved water unit routed among freight, reservoir, and gantry basins' },
      { id: 'undercroft', displayName: requestedHazard === 'magma' ? 'Magma Undercroft' : 'Electrical Undercroft', regionIds: GOLDEN_REGION_SPECS.filter((entry) => entry.districtId === 'undercroft').map((entry) => entry.id), undercroftType: requestedHazard, functionalIdentity: 'hidden multi-stage hazard excavation with a damage-free route and permanent return' },
    ],
    materialByDistrict, content,
  }));
}

function buildLabContent(seed, regionSpecs) {
  const streams = createDungeonSeedStreams(seed);
  const regionById = new Map(regionSpecs.map((entry) => [entry.id, entry]));
  const anchors = [
    anchor(regionById, 'anchor.player-start', 'lab-entry', 'lab player start'),
    anchor(regionById, 'anchor.water-router.freight', 'lab-water-reservoir', 'permanently dry lab Freight selector', { x: -2.5, y: 3.95, z: -8 }, { surfaceId: surfaceId('lab-water-reservoir', 'router-catwalk'), safeSurfaceId: surfaceId('lab-water-reservoir', 'router-catwalk') }),
    anchor(regionById, 'anchor.water-router.reservoir', 'lab-water-reservoir', 'permanently dry lab Reservoir selector', { x: 0, y: 3.95, z: -8 }, { surfaceId: surfaceId('lab-water-reservoir', 'router-catwalk'), safeSurfaceId: surfaceId('lab-water-reservoir', 'router-catwalk') }),
    anchor(regionById, 'anchor.water-router.gantry', 'lab-water-reservoir', 'permanently dry lab Gantry selector', { x: 2.5, y: 3.95, z: -8 }, { surfaceId: surfaceId('lab-water-reservoir', 'router-catwalk'), safeSurfaceId: surfaceId('lab-water-reservoir', 'router-catwalk') }),
    anchor(regionById, 'anchor.lab-lift.lower-console', 'lab-recovery', 'lower lift recall beside the walkway', { x: 12.2, y: 0, z: -4 }, { surfaceId: 'surface.mechanism.lab-lift.landing.lower', safeSurfaceId: 'surface.mechanism.lab-lift.landing.lower' }),
    anchor(regionById, 'anchor.lab-lift.upper-console', 'lab-gear', 'upper lift recall beside the walkway', { x: 12.2, y: 0, z: -4 }, { surfaceId: 'surface.mechanism.lab-lift.landing.upper', safeSurfaceId: 'surface.mechanism.lab-lift.landing.upper' }),
    anchor(regionById, 'anchor.lab-gear.low', 'lab-gear', 'lab Low terminal recall beside the inspection catwalk', { x: -6, y: 3.95, z: 3 }, {
      surfaceId: surfaceId('lab-gear', 'landmark-catwalk'),
      safeSurfaceId: surfaceId('lab-gear', 'landmark-catwalk'),
    }),
    anchor(regionById, 'anchor.lab-gear.high', 'lab-gear', 'lab High terminal recall beside the automatic-cargo landing', { x: -18, y: 9.95, z: 0 }, {
      surfaceId: surfaceId('lab-gear', 'landing-lab-upper-gear'),
      safeSurfaceId: surfaceId('lab-gear', 'landing-lab-upper-gear'),
    }),
    anchor(regionById, 'anchor.lab-exit', 'lab-upper', 'lab completion marker', { x: 10 }),
  ];
  const actions = [
    waterAction('action.water.freight-sump', 'anchor.water-router.freight', 'FreightSumpFilled'),
    waterAction('action.water.reservoir', 'anchor.water-router.reservoir', 'StoredInReservoir'),
    waterAction('action.water.gantry-sump', 'anchor.water-router.gantry', 'GantrySumpFilled'),
    mechanismAction('action.lab-lift.recall-lower', 'anchor.lab-lift.lower-console', 'mechanism.lab-lift', 'LowerLanding'),
    mechanismAction('action.lab-lift.recall-upper', 'anchor.lab-lift.upper-console', 'mechanism.lab-lift', 'UpperLanding'),
    mechanismAction('action.lab-gear.low', 'anchor.lab-gear.low', 'mechanism.lab-gear', 'LowLanding'),
    mechanismAction('action.lab-gear.high', 'anchor.lab-gear.high', 'mechanism.lab-gear', 'HighLanding'),
    { id: 'action.lab-complete', type: 'fixture-complete', anchorId: 'anchor.lab-exit', interaction: pickupInteraction(), conditions: [], effects: [{ op: 'completeObjective', objectiveId: 'objective.lab-complete' }], barrierIds: [] },
  ];
  return {
    anchors,
    encounters: [],
    rewards: [],
    objectives: [{ id: 'objective.lab-complete', type: 'fixture', regionIds: regionSpecs.map((entry) => entry.id), required: true, completionConditions: [], actionId: 'action.lab-complete' }],
    environmentStates: [
      waterEnvironment(regionSpecs),
      hazardEnvironment('magma', 'environment.lab-magma', [{ surfaceId: 'surface.lab-hazards.magma', regionId: 'lab-hazards', offset: { z: -6 }, size: { x: 12, z: 8 } }]),
      hazardEnvironment('electrical', 'environment.lab-electrical', [{ surfaceId: 'surface.lab-hazards.electrical', regionId: 'lab-hazards', offset: { z: 6 }, size: { x: 12, z: 8 } }]),
    ],
    mechanisms: [
      { id: 'mechanism.water-router', type: 'water-router', regionId: 'lab-water-reservoir', anchorId: 'anchor.water-router.reservoir', initialStateId: 'FreightSumpFilled', states: [{ id: 'FreightSumpFilled', stable: true }, { id: 'StoredInReservoir', stable: true }, { id: 'GantrySumpFilled', stable: true }], transitions: actions.slice(0, 3).map((entry) => ({ fromStateId: '*', toStateId: entry.effects[0].value, actionId: entry.id })) },
      { id: 'mechanism.lab-lift', type: 'cargo-lift', regionId: 'lab-recovery', anchorId: 'anchor.lab-lift.lower-console', initialStateId: 'LowerLanding', recallable: true, automaticTravel: true, states: [{ id: 'LowerLanding', stable: true, regionId: 'lab-recovery', surfaceY: -10, position: vector(141, -10, -4), landingSurfaceId: 'surface.mechanism.lab-lift.landing.lower' }, { id: 'UpperLanding', stable: true, regionId: 'lab-gear', surfaceY: 0, position: vector(141, 0, -4), landingSurfaceId: 'surface.mechanism.lab-lift.landing.upper' }], transitions: [{ fromStateId: 'LowerLanding', toStateId: 'UpperLanding', automatic: true, trigger: 'automatic-dwell' }, { fromStateId: 'UpperLanding', toStateId: 'LowerLanding', automatic: true, trigger: 'automatic-dwell' }, { fromStateId: 'UpperLanding', toStateId: 'LowerLanding', actionId: 'action.lab-lift.recall-lower', trigger: 'recall', automatic: true }, { fromStateId: 'LowerLanding', toStateId: 'UpperLanding', actionId: 'action.lab-lift.recall-upper', trigger: 'recall', automatic: true }], runtimeProfile: { dynamicSurfaceId: 'surface.lab-recovery.lift', controlOffsetFromWalkway: 2.5, platformHalfExtent: 2.4 }, actionIds: ['action.lab-lift.recall-lower', 'action.lab-lift.recall-upper'] },
      { id: 'mechanism.lab-auto-cargo', type: 'moving-cargo', regionId: 'lab-upper', initialStateId: 'Near', automaticTravel: true, states: [{ id: 'Near', stable: true, position: vector(96.8, 9.95, 0), landingSurfaceId: 'surface.lab-upper.landing-lab-upper-gear' }, { id: 'Far', stable: true, position: vector(120.2, 9.95, 0), landingSurfaceId: 'surface.lab-gear.landing-lab-upper-gear' }], transitions: [{ fromStateId: 'Near', toStateId: 'Far', trigger: 'automatic-dwell', automatic: true }, { fromStateId: 'Far', toStateId: 'Near', trigger: 'automatic-dwell', automatic: true }], runtimeProfile: { elevated: true, minimumElevation: 9, dynamicSurfaceId: 'surface.lab-upper.auto-cargo', platformHalfExtent: 2.2, purpose: 'connects useful upper landings' } },
      { id: 'mechanism.lab-crumble', type: 'crumbling-floor', regionId: 'lab-gear', initialStateId: 'Intact', automaticReset: true, states: [{ id: 'Intact', stable: true, collision: true, landingSurfaceId: surfaceId('lab-gear') }, { id: 'Cracking', stable: false, collision: true }, { id: 'Collapsed', stable: true, collision: false }, { id: 'Resetting', stable: false, collision: false }], transitions: [{ fromStateId: 'Intact', toStateId: 'Cracking', trigger: 'player-contact', automatic: true }, { fromStateId: 'Cracking', toStateId: 'Collapsed', afterSeconds: 0.8, automatic: true }, { fromStateId: 'Collapsed', toStateId: 'Resetting', afterSeconds: 4, automatic: true }, { fromStateId: 'Resetting', toStateId: 'Intact', afterSeconds: 1.2, automatic: true }], runtimeProfile: { aperturePortalId: 'portal.lab-gear-drop', noManualRearm: true } },
      { id: 'mechanism.lab-gear', type: 'corkscrew-gear', regionId: 'lab-gear', anchorId: 'anchor.lab-gear.low', initialStateId: 'LowLanding', recallable: true, automaticTravel: true, states: [{ id: 'LowLanding', stable: true, elevation: 3.95, position: vector(134, 3.95, 6.3), landingSurfaceId: 'surface.lab-gear.landmark-catwalk' }, { id: 'HighLanding', stable: true, elevation: 9.95, position: vector(120.2, 9.95, 0), landingSurfaceId: 'surface.lab-gear.landing-lab-upper-gear' }], transitions: [{ fromStateId: 'LowLanding', toStateId: 'HighLanding', trigger: 'automatic-dwell', automatic: true }, { fromStateId: 'HighLanding', toStateId: 'LowLanding', trigger: 'automatic-dwell', automatic: true }, { fromStateId: '*', toStateId: 'LowLanding', actionId: 'action.lab-gear.low', trigger: 'recall', automatic: true }, { fromStateId: '*', toStateId: 'HighLanding', actionId: 'action.lab-gear.high', trigger: 'recall', automatic: true }], runtimeProfile: { dynamicSurfaceId: 'surface.lab-gear.corkscrew', supported: true, platformHalfExtent: 2.2, controlOffsetFromWalkway: 2.5, speed: 3.2, dwellSeconds: 4.5 } },
    ],
    actions,
    progression: { graphNodes: regionSpecs.map((entry) => ({ id: entry.id })), connections: LAB_CONNECTION_SPECS.map((entry) => ({ id: `portal.${entry.id}`, fromRegionId: entry.fromRegionId, toRegionId: entry.toRegionId })), keyContracts: [], gateContracts: [], objectiveIds: ['objective.lab-complete'], extractionActionId: null },
    keycardZones: [],
    compatibility: { entranceRoomId: 'lab-entry', shrineRoomId: null, bossRoomId: null, playerStartAnchorId: 'anchor.player-start', extractionAnchorId: 'anchor.lab-exit', campReturnAnchorId: 'safe.lab-entry', doors: [] },
    fixtureSuffix: 'mechanisms',
    seedFingerprint: streams.seedFor('module'),
  };
}

export function createTraversalLabPlanV2(options = {}) {
  const seed = options.seed ?? 'm1-traversal-lab';
  const content = buildLabContent(seed, LAB_REGION_SPECS);
  return createDungeonPlanV2(basePlan({
    fixtureKind: 'traversal-lab', seed, regionSpecs: LAB_REGION_SPECS, connectionSpecs: LAB_CONNECTION_SPECS,
    descriptors: TRAVERSAL_LAB_MODULE_DESCRIPTORS_V2,
    districts: [{ id: 'traversal-lab', displayName: 'Three-Floor Traversal Lab', regionIds: LAB_REGION_SPECS.map((entry) => entry.id), functionalIdentity: 'isolated acceptance fixture for every V2 traversal primitive' }],
    materialByDistrict: { 'traversal-lab': MATERIAL_PROFILES.lab }, content,
  }));
}

export const GOLDEN_REGION_IDS_V2 = Object.freeze(GOLDEN_REGION_SPECS.map((entry) => entry.id));

export default createGoldenDungeonPlanV2;
