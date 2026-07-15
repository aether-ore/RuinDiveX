import { compileCanonicalBusterBalancePresets } from '../buster/BusterBalanceGate.js';
import {
  BUSTER_BENCHMARK_FIXTURE,
  createBusterBenchmarkScenario,
  simulateBusterEncounter,
} from '../buster/BusterBalanceSimulator.js';
import {
  REAVERBOT_BOSS_PROFILE_IDS,
  generateReaverbotBossGenome,
  getReaverbotBossProfile,
} from './ReaverbotBossCatalog.js';

export const REAVERBOT_BOSS_BENCHMARK_LEVELS = Object.freeze([1, 5, 10]);
export const REAVERBOT_BOSS_BENCHMARK_PLAN_IDS = Object.freeze([
  'liveCalibratedMega',
  'balancedBarePulse',
  'balancedBareMortar',
  'directExplosion',
]);
export const REAVERBOT_BOSS_DEPTH_FIVE_TTK_TARGET = Object.freeze({ minimum: 35, maximum: 75 });

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return value;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function median(values) {
  const ordered = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function signatureRouteTime(rawTtk, profile) {
  if (!Number.isFinite(rawTtk)) return null;
  const combat = profile.combat;
  const integrityShare = combat.signatureIntegrityHealthScale;
  const multiplier = combat.signatureDirectDamageMultiplier;
  const directDamageTimeScale = 1 - integrityShare + integrityShare / multiplier;
  return rawTtk * directDamageTimeScale
    + BUSTER_BENCHMARK_FIXTURE.extensionDuration
    + combat.phaseTransitionSeconds
    + combat.signatureInterruptSeconds;
}

function bodyRouteTime(rawTtk, profile) {
  if (!Number.isFinite(rawTtk)) return null;
  return rawTtk
    + BUSTER_BENCHMARK_FIXTURE.extensionDuration
    + profile.combat.phaseTransitionSeconds;
}

function canDamageSignaturePart(plan) {
  return (plan?.actions ?? []).some((action) => (
    action?.type === 'emit'
    && action?.power > 0
    && action?.payload?.replacesDirect !== true
  ));
}

export function runReaverbotBossBenchmark({
  levels = REAVERBOT_BOSS_BENCHMARK_LEVELS,
  durationSeconds = 150,
  seedPrefix = 'boss-benchmark-v1',
} = {}) {
  const rows = [];
  for (const levelValue of levels) {
    const level = Math.max(1, Math.min(10, Math.round(Number(levelValue) || 1)));
    const plans = compileCanonicalBusterBalancePresets({ level });
    for (const bossProfileId of REAVERBOT_BOSS_PROFILE_IDS) {
      const profile = getReaverbotBossProfile(bossProfileId);
      const genome = generateReaverbotBossGenome({
        bossProfileId,
        seed: `${seedPrefix}:${bossProfileId}:${level}`,
        threatTier: level,
      });
      const scenario = createBusterBenchmarkScenario({
        id: `boss:${bossProfileId}:depth-${level}`,
        level,
        targetCount: 1,
        profile: 'ordinary',
        distanceBand: 'mid',
        motion: 'stationary',
        aimOffset: 'center',
        nonlethal: false,
        duration: durationSeconds,
        targetHealth: genome.stats.maxHealth,
        targetArmor: genome.stats.armor,
        targetRadius: genome.stats.radius,
        targetHeight: genome.stats.collisionHeight,
      });
      const weapons = Object.fromEntries(REAVERBOT_BOSS_BENCHMARK_PLAN_IDS.map((planId) => {
        const plan = plans[planId];
        const simulation = simulateBusterEncounter(plan, scenario, { duration: durationSeconds });
        const idealTtk = simulation.metrics.singleTargetTtk;
        const route = canDamageSignaturePart(plan) ? 'signature-overload' : 'body-only';
        const routeTtk = route === 'signature-overload'
          ? signatureRouteTime(idealTtk, profile)
          : bodyRouteTime(idealTtk, profile);
        return [planId, Object.freeze({
          status: simulation.status,
          route,
          idealReleaseTtk: idealTtk,
          routeTtk: round(routeTtk),
          signatureRouteTtk: route === 'signature-overload' ? round(routeTtk) : null,
          bodyRouteTtk: route === 'body-only' ? round(routeTtk) : null,
        })];
      }));
      const medianRouteTtk = round(median(
        Object.values(weapons).map((entry) => entry.routeTtk),
      ));
      const target = REAVERBOT_BOSS_DEPTH_FIVE_TTK_TARGET;
      rows.push(Object.freeze({
        bossProfileId,
        level,
        healthScale: profile.combat.healthScale,
        health: genome.stats.maxHealth,
        armor: genome.stats.armor,
        weapons: Object.freeze(weapons),
        medianRouteTtk,
        // Kept as a report alias so older benchmark consumers do not lose a
        // field while migrating to the route-aware name.
        medianSignatureTtk: medianRouteTtk,
        depthFiveTargetPass: level !== 5
          || (medianRouteTtk >= target.minimum && medianRouteTtk <= target.maximum),
      }));
    }
  }
  return Object.freeze({
    seedPrefix,
    durationSeconds,
    rows: Object.freeze(rows),
    depthFivePassed: rows.filter((row) => row.level === 5).every((row) => row.depthFiveTargetPass),
  });
}
