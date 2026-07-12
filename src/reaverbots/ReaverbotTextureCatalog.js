const SHARED_TEXTURE_ROOT = '/assets/textures/reaverbots/procedural/shared';

function freezeTextureAsset(id, fileName, options = {}) {
  // Semantic UV regions select a deliberate subsection of the authored map.
  // Clamp every asset so sampling can never wrap into another repeated copy.
  const wrapS = options.wrapS ?? 'clampToEdge';
  const wrapT = options.wrapT ?? 'clampToEdge';
  const isMask = Boolean(options.mask);
  return Object.freeze({
    id,
    path: `${SHARED_TEXTURE_ROOT}/${fileName}`,
    type: isMask ? 'mask' : 'color',
    colorSpace: isMask ? 'none' : (options.colorSpace ?? 'srgb'),
    mask: options.mask ?? null,
    wrapS,
    wrapT,
    minFilter: options.minFilter ?? (isMask ? 'linearMipmapLinear' : 'nearestMipmapNearest'),
    magFilter: options.magFilter ?? (isMask ? 'linear' : 'nearest'),
    repeat: Object.freeze([...(options.repeat ?? [1, 1])]),
    anisotropy: options.anisotropy ?? 4,
    generateMipmaps: options.generateMipmaps ?? true,
  });
}

/**
 * Texture-loader-neutral metadata for every authored procedural Reaverbot map.
 * String enum values are intentionally translated to THREE constants by the
 * visual loader, keeping this catalog deterministic and usable from Node tests.
 */
export const REAVERBOT_TEXTURE_ASSETS = Object.freeze({
  armorPrimary: freezeTextureAsset('armorPrimary', 'armor_primary_tile.png'),
  armorSecondaryCircuit: freezeTextureAsset('armorSecondaryCircuit', 'armor_secondary_circuit_tile.png'),
  bladeMetal: freezeTextureAsset('bladeMetal', 'blade_metal_tile.png'),
  energyFieldMask: freezeTextureAsset('energyFieldMask', 'energy_field_mask.png', {
    mask: 'luminance',
    wrapS: 'clampToEdge',
    wrapT: 'clampToEdge',
  }),
  eyeRedLens: freezeTextureAsset('eyeRedLens', 'eye_red_lens.png', {
    wrapS: 'clampToEdge',
    wrapT: 'clampToEdge',
  }),
  jointDark: freezeTextureAsset('jointDark', 'joint_dark_tile.png'),
  moduleEmissiveMask: freezeTextureAsset('moduleEmissiveMask', 'module_emissive_mask.png', {
    mask: 'luminance',
  }),
  trimAlloy: freezeTextureAsset('trimAlloy', 'trim_alloy_tile.png'),
  weaponHousing: freezeTextureAsset('weaponHousing', 'weapon_housing_tile.png'),
});

function freezeProfile(slots) {
  return Object.freeze({ ...slots });
}

// Profile slot names deliberately match ReaverbotVisualFactory's material
// registry.  A loader may therefore merge these records directly over the
// decor defaults before assigning maps to the generated meshes.
export const REAVERBOT_BODY_TEXTURE_PROFILES = Object.freeze({
  biped: freezeProfile({ primary: 'armorPrimary', secondary: 'armorSecondaryCircuit', trim: 'trimAlloy', dark: 'jointDark', emissive: 'moduleEmissiveMask' }),
  lowBiped: freezeProfile({ primary: 'armorSecondaryCircuit', secondary: 'armorPrimary', trim: 'trimAlloy', dark: 'jointDark', emissive: 'moduleEmissiveMask' }),
  quadruped: freezeProfile({ primary: 'armorPrimary', secondary: 'jointDark', trim: 'bladeMetal', dark: 'jointDark', emissive: 'moduleEmissiveMask' }),
  tripod: freezeProfile({ primary: 'armorSecondaryCircuit', secondary: 'armorPrimary', trim: 'trimAlloy', dark: 'jointDark', emissive: 'moduleEmissiveMask' }),
  crawler: freezeProfile({ primary: 'armorPrimary', secondary: 'armorSecondaryCircuit', trim: 'bladeMetal', dark: 'jointDark', emissive: 'moduleEmissiveMask' }),
  hopper: freezeProfile({ primary: 'armorSecondaryCircuit', secondary: 'armorPrimary', trim: 'trimAlloy', dark: 'jointDark', emissive: 'moduleEmissiveMask' }),
  hoverBell: freezeProfile({ primary: 'armorPrimary', secondary: 'armorSecondaryCircuit', trim: 'trimAlloy', dark: 'jointDark', emissive: 'moduleEmissiveMask' }),
  flyer: freezeProfile({ primary: 'armorSecondaryCircuit', secondary: 'armorPrimary', trim: 'bladeMetal', dark: 'jointDark', emissive: 'moduleEmissiveMask' }),
});

export const REAVERBOT_WEAPON_TEXTURE_PROFILES = Object.freeze({
  ramHorn: freezeProfile({ weapon: 'bladeMetal', trim: 'trimAlloy', dark: 'jointDark' }),
  crusherJaw: freezeProfile({ weapon: 'bladeMetal', trim: 'bladeMetal', dark: 'jointDark' }),
  clawArm: freezeProfile({ weapon: 'weaponHousing', trim: 'bladeMetal', dark: 'jointDark', emissive: 'moduleEmissiveMask' }),
  pounceActuator: freezeProfile({ weapon: 'weaponHousing', trim: 'trimAlloy', dark: 'jointDark', emissive: 'moduleEmissiveMask' }),
  shockPiston: freezeProfile({ weapon: 'weaponHousing', trim: 'trimAlloy', dark: 'jointDark', emissive: 'moduleEmissiveMask' }),
  pulseCannon: freezeProfile({ weapon: 'weaponHousing', trim: 'trimAlloy', dark: 'jointDark', emissive: 'moduleEmissiveMask' }),
  mortarPod: freezeProfile({ weapon: 'weaponHousing', trim: 'trimAlloy', dark: 'jointDark', emissive: 'moduleEmissiveMask' }),
  clusterMortar: freezeProfile({ weapon: 'weaponHousing', trim: 'trimAlloy', dark: 'jointDark', emissive: 'moduleEmissiveMask' }),
  arcEmitter: freezeProfile({ weapon: 'weaponHousing', trim: 'trimAlloy', dark: 'jointDark', emissive: 'moduleEmissiveMask', shieldEnergy: 'energyFieldMask' }),
  flameNozzle: freezeProfile({ weapon: 'weaponHousing', trim: 'bladeMetal', dark: 'jointDark', emissive: 'moduleEmissiveMask' }),
  beamPrism: freezeProfile({ weapon: 'trimAlloy', trim: 'weaponHousing', dark: 'jointDark', emissive: 'moduleEmissiveMask', shieldEnergy: 'energyFieldMask' }),
  mineDispenser: freezeProfile({ weapon: 'weaponHousing', trim: 'trimAlloy', dark: 'jointDark', emissive: 'moduleEmissiveMask' }),
  rotorBlade: freezeProfile({ weapon: 'bladeMetal', trim: 'trimAlloy', dark: 'jointDark' }),
  tractorMagnet: freezeProfile({ weapon: 'weaponHousing', trim: 'trimAlloy', dark: 'jointDark', emissive: 'moduleEmissiveMask', shieldEnergy: 'energyFieldMask' }),
  overloadCore: freezeProfile({ weapon: 'weaponHousing', trim: 'trimAlloy', dark: 'jointDark', emissive: 'moduleEmissiveMask', shieldEnergy: 'energyFieldMask' }),
});

export const REAVERBOT_DEFENSE_TEXTURE_PROFILES = Object.freeze({
  directionalShield: freezeProfile({ primary: 'armorPrimary', secondary: 'armorSecondaryCircuit', trim: 'trimAlloy', dark: 'jointDark' }),
  armoredSkull: freezeProfile({ primary: 'armorPrimary', secondary: 'armorSecondaryCircuit', trim: 'bladeMetal', dark: 'jointDark' }),
  sidePlates: freezeProfile({ primary: 'armorPrimary', secondary: 'armorSecondaryCircuit', trim: 'trimAlloy', dark: 'jointDark' }),
  armoredBack: freezeProfile({ primary: 'armorPrimary', secondary: 'armorSecondaryCircuit', trim: 'bladeMetal', dark: 'jointDark' }),
  armoredCarapace: freezeProfile({ primary: 'armorPrimary', secondary: 'armorSecondaryCircuit', trim: 'bladeMetal', dark: 'jointDark' }),
  guardArms: freezeProfile({ primary: 'armorPrimary', secondary: 'weaponHousing', trim: 'bladeMetal', dark: 'jointDark' }),
  armorShutters: freezeProfile({ primary: 'armorSecondaryCircuit', secondary: 'armorPrimary', trim: 'bladeMetal', dark: 'jointDark' }),
  rotatingPlates: freezeProfile({ primary: 'armorSecondaryCircuit', secondary: 'armorPrimary', trim: 'bladeMetal', dark: 'jointDark' }),
  energyMembrane: freezeProfile({ primary: 'armorSecondaryCircuit', secondary: 'armorPrimary', trim: 'trimAlloy', dark: 'jointDark', emissive: 'moduleEmissiveMask', shieldEnergy: 'energyFieldMask' }),
  phaseShell: freezeProfile({ primary: 'armorSecondaryCircuit', secondary: 'armorPrimary', trim: 'trimAlloy', dark: 'jointDark', emissive: 'moduleEmissiveMask', shieldEnergy: 'energyFieldMask' }),
  reactivePlate: freezeProfile({ primary: 'armorPrimary', secondary: 'armorSecondaryCircuit', trim: 'bladeMetal', dark: 'jointDark', emissive: 'moduleEmissiveMask' }),
});

export const REAVERBOT_WEAK_POINT_TEXTURE_PROFILES = Object.freeze({
  rearBattery: freezeProfile({ weakPoint: 'moduleEmissiveMask', primary: 'weaponHousing', trim: 'trimAlloy', dark: 'jointDark' }),
  bellyCore: freezeProfile({ weakPoint: 'moduleEmissiveMask', primary: 'armorSecondaryCircuit', trim: 'trimAlloy', dark: 'jointDark' }),
  eyeLens: freezeProfile({ weakPoint: 'eyeRedLens', eye: 'eyeRedLens', eyeSocket: 'jointDark', emissive: 'moduleEmissiveMask' }),
  shieldHinge: freezeProfile({ weakPoint: 'moduleEmissiveMask', primary: 'jointDark', trim: 'trimAlloy', dark: 'jointDark' }),
  ammoDrum: freezeProfile({ weakPoint: 'moduleEmissiveMask', primary: 'weaponHousing', trim: 'trimAlloy', dark: 'jointDark' }),
  coolingVents: freezeProfile({ weakPoint: 'moduleEmissiveMask', primary: 'jointDark', trim: 'bladeMetal', dark: 'jointDark' }),
  emitterCore: freezeProfile({ weakPoint: 'moduleEmissiveMask', primary: 'weaponHousing', trim: 'trimAlloy', dark: 'jointDark', shieldEnergy: 'energyFieldMask' }),
  overloadCore: freezeProfile({ weakPoint: 'moduleEmissiveMask', primary: 'weaponHousing', trim: 'trimAlloy', dark: 'jointDark', shieldEnergy: 'energyFieldMask' }),
  legJoint: freezeProfile({ weakPoint: 'moduleEmissiveMask', primary: 'jointDark', trim: 'trimAlloy', dark: 'jointDark' }),
  counterweightCore: freezeProfile({ weakPoint: 'moduleEmissiveMask', primary: 'weaponHousing', trim: 'bladeMetal', dark: 'jointDark' }),
  clawPalm: freezeProfile({ weakPoint: 'eyeRedLens', eye: 'eyeRedLens', eyeSocket: 'jointDark', weapon: 'weaponHousing', trim: 'bladeMetal', emissive: 'moduleEmissiveMask' }),
});

export const REAVERBOT_EYE_TEXTURE_PROFILES = Object.freeze({
  singleRubyLens: freezeProfile({ eye: 'eyeRedLens', eyeSocket: 'jointDark', emissive: 'moduleEmissiveMask' }),
});

/**
 * Fallbacks for decorative armor, spikes, seams, housings, and energy pieces.
 * Module profiles override only the roles that make their silhouettes distinct.
 */
export const REAVERBOT_DECOR_TEXTURE_PROFILE = freezeProfile({
  primary: 'armorPrimary',
  secondary: 'armorSecondaryCircuit',
  trim: 'trimAlloy',
  dark: 'jointDark',
  weapon: 'weaponHousing',
  emissive: 'moduleEmissiveMask',
  weakPoint: 'moduleEmissiveMask',
  eyeSocket: 'jointDark',
  eye: 'eyeRedLens',
  glint: 'eyeRedLens',
  shieldEnergy: 'energyFieldMask',
});

function requireProfile(collection, id, label) {
  const profile = collection[id];
  if (!profile) {
    throw new Error(`Unknown Reaverbot ${label} texture profile: ${String(id)}`);
  }
  return profile;
}

/** Resolve all texture choices for one generated genome without loading them. */
export function resolveReaverbotTextureProfile(genome) {
  const body = requireProfile(REAVERBOT_BODY_TEXTURE_PROFILES, genome?.body?.planId, 'body');
  const weapon = requireProfile(REAVERBOT_WEAPON_TEXTURE_PROFILES, genome?.modules?.weapon?.id, 'weapon');
  const defenseId = genome?.modules?.defense?.id ?? null;
  const defense = defenseId
    ? requireProfile(REAVERBOT_DEFENSE_TEXTURE_PROFILES, defenseId, 'defense')
    : null;
  const weakPoint = requireProfile(REAVERBOT_WEAK_POINT_TEXTURE_PROFILES, genome?.modules?.weakPoint?.id, 'weak-point');
  const eye = requireProfile(REAVERBOT_EYE_TEXTURE_PROFILES, genome?.modules?.eye?.id, 'eye');
  const materialSlots = Object.freeze({
    ...REAVERBOT_DECOR_TEXTURE_PROFILE,
    ...body,
    ...weapon,
    ...(defense ?? {}),
    ...weakPoint,
    ...eye,
  });

  return Object.freeze({
    body,
    weapon,
    defense,
    weakPoint,
    eye,
    decor: REAVERBOT_DECOR_TEXTURE_PROFILE,
    materialSlots,
  });
}
