import { deepFreezePlan } from './DungeonPlanV2Contract.js';

// Local authored detail blueprints for the Milestone 1 golden complex. X/Z
// offsets are normalized against the owning region's width/depth; Y offsets
// and sizes are metres. These are intentionally data-only so the accepted
// DungeonPlanV2, not scene mesh names, remains the source of runtime behavior.
// The sourceMaterial field documents which strong V1 spatial idea was
// reorganized; no V1 generator code or fixed-chain room is invoked at runtime.
const DETAILS = {
  security: {
    assetFamilyId: 'v1.security-checkpoint',
    sourceMaterial: 'v1 security checkpoint and Key Seeker reveal',
    fixtures: [
      { id: 'checkpoint-bank-west', type: 'control-bank', offset: { x: -0.34, y: 0, z: -0.28 }, size: { x: 4.4, y: 2.8, z: 2.2 }, purpose: 'credential scanner bank defining the west inspection lane' },
      { id: 'checkpoint-bank-east', type: 'control-bank', offset: { x: 0.34, y: 0, z: 0.24 }, size: { x: 4.4, y: 2.8, z: 2.2 }, purpose: 'return-route scanner bank framing the split entrance hub' },
      { id: 'overhead-conduit', type: 'conduit', offset: { x: 0, y: 8.3, z: -0.34 }, size: { x: 18, y: 1.4, z: 1.4 }, purpose: 'feeds the sealed ruin transition above full player and camera clearance at the upper exit band' },
    ],
  },
  assembly: {
    assetFamilyId: 'v1.factory-assembly',
    sourceMaterial: 'v1 assembly activity and coolant pump machinery',
    fixtures: [
      { id: 'pump-line-west', type: 'pump-array', offset: { x: -0.34, y: 0, z: 0.3 }, size: { x: 7, y: 6.5, z: 6 }, purpose: 'west assembly pressure train beneath the inspection loop' },
      { id: 'pump-line-east', type: 'pump-array', offset: { x: 0.34, y: 0, z: -0.28 }, size: { x: 7, y: 5.5, z: 6 }, purpose: 'east assembly pressure train protecting the optional cache route' },
      { id: 'press-feed', type: 'conveyor', offset: { x: 0, y: 0.35, z: 0.1 }, size: { x: 20, y: 0.7, z: 3.2 }, purpose: 'feeds components through the south process lane while preserving the full west pump-alcove entrance' },
    ],
  },
  server: {
    assetFamilyId: 'v1.server-crypt',
    sourceMaterial: 'v1 Ancient Server Crypt aisles and upper catwalk',
    fixtures: [
      { id: 'crypt-bank-northwest', type: 'server-bank', offset: { x: -0.31, y: 0, z: -0.27 }, size: { x: 3.4, y: 5.8, z: 7 }, purpose: 'creates a readable data-crypt aisle toward the Alpha vault' },
      { id: 'crypt-bank-southwest', type: 'server-bank', offset: { x: -0.285, y: 0, z: 0.28 }, size: { x: 3.4, y: 5.8, z: 7 }, purpose: 'creates a second data-crypt aisle and combat flank beside the clear freight-ladder egress' },
      { id: 'crypt-bank-east', type: 'server-bank', offset: { x: 0.32, y: 0, z: 0 }, size: { x: 3.8, y: 7, z: 11 }, purpose: 'supports the raised pipe-loop inspection route' },
      { id: 'data-loop', type: 'conduit', offset: { x: 0.1, y: 7.2, z: -0.34 }, size: { x: 18, y: 1.6, z: 1.6 }, purpose: 'upper traversal landmark connecting the crypt to its remote credential vault' },
    ],
  },
  freight: {
    assetFamilyId: 'v1.freight-recovery',
    sourceMaterial: 'v1 recovery shelves without the discarded trap divot',
    fixtures: [
      { id: 'broken-cargo-track', type: 'cargo-track', offset: { x: -0.2, y: 0.5, z: 0.4 }, size: { x: 15, y: 0.9, z: 3 }, purpose: 'perimeter freight line signaling the playable catchment without crossing its stairs or shortcut console lane' },
      { id: 'shaft-pressure-main', type: 'pressure-pipe', offset: { x: 0.36, y: 3.2, z: -0.28 }, size: { x: 2.2, y: 6.4, z: 2.2 }, purpose: 'climb-side pressure main supporting the damage-free return route' },
      { id: 'freight-control-bank', type: 'control-bank', offset: { x: -0.41, y: 0, z: -0.26 }, size: { x: 4.2, y: 2.7, z: 2 }, purpose: 'diagnoses the collapsed freight line beside, but clear of, the shortcut ladder path' },
    ],
  },
  sorting: {
    assetFamilyId: 'v1.factory-conveyor',
    sourceMaterial: 'v1 three-tier conveyor gantry and routing puzzle',
    fixtures: [
      { id: 'sorting-belt-long', type: 'conveyor', offset: { x: 0, y: 0.35, z: -0.3 }, size: { x: 24, y: 0.7, z: 3.4 }, purpose: 'primary transverse sorting belt below the moving cargo crossing' },
      { id: 'sorting-belt-feed', type: 'conveyor', offset: { x: -0.34, y: 0.35, z: 0.08 }, size: { x: 3.4, y: 0.7, z: 15 }, purpose: 'orthogonal feed belt meeting the transverse sorter while preserving the full process-alcove entrance' },
      { id: 'sorting-pressure-vessel', type: 'pressure-vessel', offset: { x: 0.34, y: 0, z: 0.28 }, size: { x: 4.8, y: 8, z: 4.8 }, purpose: 'buffers the Waterworks pressure feeding the sorting machinery' },
    ],
  },
  credential: {
    assetFamilyId: 'v1.credential-pyramid',
    sourceMaterial: 'v1 grand mechanical credential pyramid',
    fixtures: [
      { id: 'credential-reactor', type: 'generator', offset: { x: 0, y: 0, z: 0.25 }, size: { x: 7, y: 8, z: 6 }, purpose: 'powers the three-tier credential monument and its rotating glyphs' },
      { id: 'credential-pylon-west', type: 'server-bank', offset: { x: -0.35, y: 0, z: -0.28 }, size: { x: 3, y: 8.5, z: 4 }, purpose: 'west credential archive pylon framing the pyramid ascent' },
      { id: 'credential-pylon-east', type: 'server-bank', offset: { x: 0.35, y: 0, z: 0.28 }, size: { x: 3, y: 6.5, z: 4 }, purpose: 'east credential archive pylon framing the shortcut return without occupying its lift shaft' },
    ],
  },
  parts: {
    assetFamilyId: 'v1.parts-warehouse',
    sourceMaterial: 'v1 parts warehouse and optional pipe-top route',
    fixtures: [
      { id: 'rack-west-north', type: 'server-bank', offset: { x: -0.34, y: 0, z: -0.25 }, size: { x: 3.8, y: 6, z: 8 }, purpose: 'warehouse rack creating the north salvage aisle' },
      { id: 'rack-west-south', type: 'server-bank', offset: { x: -0.34, y: 0, z: 0.27 }, size: { x: 3.8, y: 7.5, z: 8 }, purpose: 'warehouse rack supporting the optional upper pipe route' },
      { id: 'rack-east', type: 'server-bank', offset: { x: 0.34, y: 0, z: 0.08 }, size: { x: 4, y: 5.2, z: 12 }, purpose: 'parts rack separating the Nest branch from the Corkscrew route' },
      { id: 'warehouse-pipe', type: 'traversal-pipe', offset: { x: 0.05, y: 7.3, z: -0.31 }, size: { x: 20, y: 2.2, z: 2.2 }, purpose: 'walkable overhead service main leading toward the raised maintenance exit' },
    ],
  },
  nest: {
    assetFamilyId: 'v1.nest-warehouse',
    sourceMaterial: 'v1 Nest Warehouse perimeter shelving',
    fixtures: [
      { id: 'nest-rack-west', type: 'server-bank', offset: { x: -0.36, y: 0, z: 0 }, size: { x: 3.6, y: 8, z: 18 }, purpose: 'perimeter salvage rack supporting a high combat flank' },
      { id: 'nest-rack-east', type: 'server-bank', offset: { x: 0.36, y: 0, z: 0 }, size: { x: 3.6, y: 6, z: 18 }, purpose: 'collapsed perimeter rack revealing the optional cache route' },
      { id: 'nest-core', type: 'processing-tank', offset: { x: 0, y: 0, z: 0.06 }, size: { x: 6, y: 5, z: 6 }, purpose: 'dormant occupation vessel identifying the Reaverbot nest' },
      { id: 'nest-overhead-main', type: 'pressure-pipe', offset: { x: 0, y: 9, z: -0.34 }, size: { x: 20, y: 2.4, z: 2.4 }, purpose: 'upper maintenance route reached by the authored service ladder' },
    ],
  },
  corkscrew: {
    assetFamilyId: 'v1.machine-platforms',
    sourceMaterial: 'new landmark combining V1 machine platforms with a radial gear',
    fixtures: [
      { id: 'gear-drive-west', type: 'generator', offset: { x: -0.32, y: 0, z: 0.28 }, size: { x: 6, y: 8, z: 6 }, purpose: 'west drive motor for the corkscrew gear shaft' },
      { id: 'gear-drive-east', type: 'generator', offset: { x: 0.32, y: 0, z: 0.15 }, size: { x: 6, y: 6, z: 6 }, purpose: 'east counter-drive establishing the second gear elevation while preserving the south raised-gate stair lane' },
      { id: 'gear-lubricant-main', type: 'pressure-pipe', offset: { x: 0, y: 11, z: 0.35 }, size: { x: 22, y: 2.4, z: 2.4 }, purpose: 'suspended lubricant main signaling the high radial landing' },
    ],
  },
  'machine-core': {
    assetFamilyId: 'v1.machine-core',
    sourceMaterial: 'v1 boss machine chamber reorganized around a turbine ring',
    fixtures: [
      { id: 'core-generator-north', type: 'generator', offset: { x: -0.28, y: 0, z: -0.3 }, size: { x: 7, y: 9, z: 6 }, purpose: 'north turbine generator shaping the elite combat flank' },
      { id: 'core-generator-south', type: 'generator', offset: { x: 0.28, y: 0, z: 0.3 }, size: { x: 7, y: 7, z: 6 }, purpose: 'south turbine generator shaping the shrine approach' },
      { id: 'core-conduit-ring', type: 'conduit', offset: { x: 0, y: 11.5, z: 0 }, size: { x: 24, y: 2, z: 2 }, purpose: 'overhead power trunk identifying the Machine Core landmark' },
    ],
  },
  extraction: {
    assetFamilyId: 'v1.refractor-shrine',
    sourceMaterial: 'v1 three-tier Refractor shrine',
    fixtures: [
      { id: 'shrine-pylon-west', type: 'server-bank', offset: { x: -0.34, y: 0, z: 0.2 }, size: { x: 3, y: 8, z: 4 }, purpose: 'west ritual-data pylon framing the Refractor tiers' },
      { id: 'shrine-pylon-east', type: 'server-bank', offset: { x: 0.34, y: 0, z: -0.2 }, size: { x: 3, y: 8, z: 4 }, purpose: 'east ritual-data pylon framing the sealed extraction pad' },
      { id: 'shrine-conduit', type: 'conduit', offset: { x: 0, y: 10, z: -0.34 }, size: { x: 18, y: 1.6, z: 1.6 }, purpose: 'feeds the Large Refractor dais and extraction lattice' },
    ],
  },
  'freight-sump': {
    assetFamilyId: 'v1.coolant-relay',
    sourceMaterial: 'V1 coolant relay expanded into a drainable freight basin',
    fixtures: [
      { id: 'sump-pump-west', type: 'pump-array', offset: { x: -0.34, y: 0, z: 0.26 }, size: { x: 6, y: 6, z: 5 }, purpose: 'west freight pump exposing the flooded upper shelf route' },
      { id: 'sump-pump-east', type: 'pump-array', offset: { x: 0.34, y: 0, z: -0.26 }, size: { x: 6, y: 5, z: 5 }, purpose: 'east freight pump marking the drained basin route' },
      { id: 'sump-transfer-main', type: 'coolant-pipe', offset: { x: 0, y: 7, z: 0.35 }, size: { x: 20, y: 2.2, z: 2.2 }, purpose: 'visible conserved-water transfer main toward the Reservoir' },
    ],
  },
  reservoir: {
    assetFamilyId: 'v1.coolant-control',
    sourceMaterial: 'v1 coolant control balcony and valve deck',
    fixtures: [
      { id: 'reservoir-vessel', type: 'reservoir', offset: { x: 0, y: 0, z: 0.24 }, size: { x: 10, y: 11, z: 10 }, purpose: 'stores the single conserved water unit in StoredInReservoir' },
      { id: 'router-pump-west', type: 'pump-array', offset: { x: -0.35, y: 0, z: -0.28 }, size: { x: 5.5, y: 5, z: 5 }, purpose: 'west transfer pump below the permanent dry router ring' },
      { id: 'router-pump-east', type: 'pump-array', offset: { x: 0.35, y: 0, z: -0.28 }, size: { x: 5.5, y: 6.5, z: 5 }, purpose: 'east transfer pump below the permanent dry router ring' },
    ],
  },
  'gantry-sump': {
    assetFamilyId: 'v1.coolant-conveyor',
    sourceMaterial: 'V1 conveyor bridge combined with a redirected water basin',
    fixtures: [
      { id: 'gantry-pressure-west', type: 'pressure-vessel', offset: { x: -0.34, y: 0, z: 0.25 }, size: { x: 5, y: 7, z: 5 }, purpose: 'west overflow vessel beneath the cargo route' },
      { id: 'gantry-pressure-east', type: 'pressure-vessel', offset: { x: 0.34, y: 0, z: -0.25 }, size: { x: 5, y: 5.5, z: 5 }, purpose: 'east overflow vessel marking the flooded cache shelf' },
      { id: 'gantry-transfer-pipe', type: 'coolant-pipe', offset: { x: 0, y: 9, z: 0.34 }, size: { x: 18, y: 2, z: 2 }, purpose: 'upper transfer main visually connects the moving cargo landings' },
    ],
  },
  'salvage-tunnel': {
    assetFamilyId: 'v1.salvage-service',
    sourceMaterial: 'new drained service tunnel replacing V1 trapped basement divots',
    fixtures: [
      { id: 'salvage-rack-west', type: 'server-bank', offset: { x: -0.34, y: 0, z: 0.18 }, size: { x: 3.6, y: 5, z: 9 }, purpose: 'exposed drained salvage shelving hiding the Beta route' },
      { id: 'salvage-rack-east', type: 'server-bank', offset: { x: 0.34, y: 0, z: 0.12 }, size: { x: 3.6, y: 6.5, z: 9 }, purpose: 'lift-maintenance shelving beside the permanent return' },
      { id: 'drain-main', type: 'coolant-pipe', offset: { x: 0, y: 7.5, z: 0.34 }, size: { x: 17, y: 2, z: 2 }, purpose: 'drain main signals when the lower discovery route is exposed' },
    ],
  },
  'hazard-intake': {
    assetFamilyId: 'v1.reactor-supports',
    sourceMaterial: 'new hidden sub-dungeon intake using V1 reactor supports',
    fixtures: [
      { id: 'intake-generator', type: 'generator', offset: { x: -0.32, y: 0, z: -0.25 }, size: { x: 6, y: 7, z: 6 }, purpose: 'powers the hazard intake while preserving a damage-free bypass' },
      { id: 'intake-pressure-main', type: 'pressure-pipe', offset: { x: 0.34, y: 3.5, z: 0.24 }, size: { x: 2.4, y: 7, z: 2.4 }, purpose: 'vertical hazard feed marking the descended elevation band' },
      { id: 'intake-warning-bank', type: 'control-bank', offset: { x: -0.32, y: 0, z: 0.28 }, size: { x: 4.5, y: 3, z: 2.4 }, purpose: 'telegraphs the active Undercroft hazard before entry' },
    ],
  },
  'hazard-core': {
    assetFamilyId: 'v1.reactor-machine',
    sourceMaterial: 'new major-cache cavern using V1 machine and coolant language',
    fixtures: [
      { id: 'hazard-generator-west', type: 'generator', offset: { x: -0.34, y: 0, z: -0.28 }, size: { x: 7, y: 8, z: 7 }, purpose: 'west hazard regulator bordering the safe island route' },
      // Keep the regulator against the east perimeter instead of occupying
      // the raised Gamma vault and clipping through its pickup pedestal.
      { id: 'hazard-generator-east', type: 'generator', offset: { x: 0.42, y: 0, z: 0.28 }, size: { x: 7, y: 6, z: 7 }, purpose: 'east hazard regulator framing the major-cache branch without obstructing the Gamma vault' },
      { id: 'hazard-feed-main', type: 'conduit', offset: { x: 0, y: 12, z: 0.35 }, size: { x: 24, y: 2.4, z: 2.4 }, purpose: 'suspended energy feed visually unifies the dual damage-free routes while leaving the return-lift shaft clear' },
    ],
  },
};

export const GOLDEN_REGION_AUTHORED_DETAILS_V2 = deepFreezePlan(DETAILS);

export default GOLDEN_REGION_AUTHORED_DETAILS_V2;
