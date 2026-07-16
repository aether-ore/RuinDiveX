import { MEGA_BUSTER_CALIBRATION_CATALOG } from './catalog.js';

const LEGACY_CALIBRATION_LOCAL_STATS = Object.freeze({
  powerRaiser: Object.freeze({ attackDamage: 2 }),
  energyBattery: Object.freeze({ maxEnergy: 3 }),
  rangeBooster: Object.freeze({ attackRange: 1.4 }),
  rapidFireUnit: Object.freeze({ attackSpeed: 0.18 }),
  sniperScope: Object.freeze({ attackDamage: 1, attackRange: 0.8 }),
  heatSinkCore: Object.freeze({ maxEnergy: 1, attackSpeed: 0.1 }),
});

let nextShadowId = 1;

function cloneAffixes(value) {
  return Array.isArray(value) ? value.map((entry) => ({ ...entry })) : [];
}

/**
 * Compatibility-only representation for pre-overhaul Mega calibrations.
 * Runtime consumers receive deterministic local totals and never depend on
 * Item rarity, levels, affix APIs, random seeds, or power-score comparison.
 * The nested legacy snapshot exists solely so v1/v2 recovery exports remain
 * lossless and can be removed after that compatibility window closes.
 */
export function createMegaCalibrationShadow(type, source = {}) {
  const definition = MEGA_BUSTER_CALIBRATION_CATALOG[type];
  if (!definition) return null;
  const id = source.id ?? `mega-calibration-shadow-${nextShadowId++}`;
  const legacyAffixes = cloneAffixes(source.affixes);
  const localStats = {
    ...(LEGACY_CALIBRATION_LOCAL_STATS[type] ?? {}),
    ...(source.baseStats ?? source.localStats ?? {}),
  };
  for (const affix of legacyAffixes) {
    if (typeof affix?.stat !== 'string' || !Number.isFinite(Number(affix.value))) continue;
    localStats[affix.stat] = (localStats[affix.stat] ?? 0) + Number(affix.value);
  }
  const legacySnapshot = Object.freeze({
    id,
    canonicalId: source.canonicalId ?? null,
    legacyBusterId: source.legacyBusterId ?? null,
    name: source.name ?? definition.name,
    type,
    slot: source.slot ?? 'hands',
    rarity: source.rarity ?? 'standard',
    level: Math.max(1, Math.trunc(Number(source.level)) || 1),
    category: 'Buster Part',
    tags: [...(source.tags ?? ['buster', 'calibration'])],
    behavior: source.behavior ?? 'Legacy deterministic Mega Buster calibration shadow.',
    uniqueEffect: source.uniqueEffect ?? null,
    baseStats: { ...(source.baseStats ?? LEGACY_CALIBRATION_LOCAL_STATS[type] ?? {}) },
    affixes: legacyAffixes,
    value: Math.max(0, Number(source.value) || 0),
    weaponKind: source.weaponKind ?? null,
  });
  return {
    id,
    canonicalId: source.canonicalId ?? null,
    legacyBusterId: source.legacyBusterId ?? null,
    type,
    typeLabel: source.typeLabel ?? definition.name,
    name: source.name ?? definition.name,
    category: 'Buster Part',
    slot: 'hands',
    tags: Object.freeze([...(source.tags ?? ['buster', 'calibration'])]),
    behavior: source.behavior ?? 'Legacy deterministic Mega Buster calibration shadow.',
    value: 0,
    calibrationBonuses: definition.bonuses,
    localStats: Object.freeze(localStats),
    legacySnapshot,
    color: '#7ee7ff',
    glowColor: 0x7ee7ff,
    getStatTotals: () => ({ ...localStats }),
  };
}

