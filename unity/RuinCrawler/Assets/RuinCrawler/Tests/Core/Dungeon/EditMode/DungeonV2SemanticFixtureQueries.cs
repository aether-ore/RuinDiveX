using System;
using System.Collections.Generic;
using System.Linq;

namespace RuinCrawler.Core.Dungeon.V2.Tests
{
    /// <summary>
    /// Semantic selectors for generated V2 test fixtures. Gameplay beats and
    /// district membership are stable contracts; generated module/region IDs,
    /// ownership grouping, route order, and socket orientation are not.
    /// </summary>
    internal static class DungeonV2SemanticFixtureQueries
    {
        public static DungeonGameplayBeatPlanV2 Beat(
            DungeonPlanV2 plan,
            DungeonGameplayBeatKindV2 kind) =>
            plan.GameplayBeats.Single(value => value.Kind == kind);

        public static IReadOnlyList<DungeonModuleInstancePlanV2> ModulesForBeat(
            DungeonPlanV2 plan,
            DungeonGameplayBeatKindV2 kind)
        {
            string beatId = Beat(plan, kind).Id;
            DungeonGameplayBeatAssignmentV2 assignment = plan.BeatAssignments.Single(value =>
                string.Equals(value.BeatId, beatId, StringComparison.Ordinal));
            return assignment.ModuleInstanceIds
                .Select(id => plan.Modules.Single(module => string.Equals(module.Id, id, StringComparison.Ordinal)))
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .ToArray();
        }

        public static IReadOnlyList<DungeonRegionPlanV2> RegionsForBeat(
            DungeonPlanV2 plan,
            DungeonGameplayBeatKindV2 kind)
        {
            var moduleIds = new HashSet<string>(
                ModulesForBeat(plan, kind).Select(value => value.Id),
                StringComparer.Ordinal);
            return plan.Regions
                .Where(region => region.ModuleInstanceIds.Any(moduleIds.Contains))
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .ToArray();
        }

        public static DungeonRegionPlanV2 RegionForBeat(
            DungeonPlanV2 plan,
            DungeonGameplayBeatKindV2 kind,
            DungeonBiomeDistrictKindV2 districtKind,
            DungeonElevationStratumV2? stratum = null)
        {
            return RegionsForBeat(plan, kind).Single(region =>
                DistrictKind(plan, region) == districtKind
                && (!stratum.HasValue || region.ElevationStratum == stratum.Value));
        }

        public static DungeonBiomeDistrictKindV2 DistrictKind(
            DungeonPlanV2 plan,
            DungeonRegionPlanV2 region) =>
            plan.Districts.Single(value =>
                string.Equals(value.Id, region.BiomeDistrictId, StringComparison.Ordinal)).Kind;

        public static bool IsHazardDistrict(DungeonBiomeDistrictKindV2 kind) =>
            kind == DungeonBiomeDistrictKindV2.MagmaUndercroft
            || kind == DungeonBiomeDistrictKindV2.ElectricalUndercroft;

        public static DungeonBiomeDistrictPlanV2 HazardDistrict(DungeonPlanV2 plan) =>
            plan.Districts.Single(value => IsHazardDistrict(value.Kind));

        public static DungeonTraversalEdgePlanV2 CredentialBoundary(DungeonPlanV2 plan) =>
            plan.TraversalEdges.Single(value => value.IsProtectedProgressionBoundary);

        public static DungeonSurfacePlanV2 CredentialBarrier(DungeonPlanV2 plan)
        {
            DungeonTraversalEdgePlanV2 boundary = CredentialBoundary(plan);
            return plan.Surfaces.Single(value =>
                string.Equals(value.RegionId, boundary.FromRegionId, StringComparison.Ordinal)
                && value.Kind == DungeonSurfaceKindV2.DoorSweep
                && PredicateReferences(
                    value.ActivePredicate,
                    DungeonPredicateConditionKindV2.RequiredItem,
                    IndustrialFactoryV2Ruleset.CredentialKeyRewardId));
        }

        public static DungeonFallCatchmentPlanV2 HazardCatchment(DungeonPlanV2 plan)
        {
            var hazardRegions = new HashSet<string>(HazardDistrict(plan).RegionIds, StringComparer.Ordinal);
            return plan.FallCatchments.Single(value =>
                hazardRegions.Contains(value.RegionId)
                && value.Kind == DungeonFallCatchmentKindV2.SafePad);
        }

        public static DungeonRegionPlanV2 HazardLandingRegion(DungeonPlanV2 plan)
        {
            DungeonFallCatchmentPlanV2 catchment = HazardCatchment(plan);
            DungeonFallExposurePlanV2 exposure = plan.FallExposures.First(value =>
                value.RequiredCatchmentIds.Contains(catchment.Id));
            return plan.Regions.Single(value =>
                string.Equals(value.Id, exposure.SourceRegionId, StringComparison.Ordinal));
        }

        public static DungeonSurfacePlanV2 PrimaryWalkableSurface(
            DungeonPlanV2 plan,
            string regionId)
        {
            return plan.Surfaces
                .Where(value => string.Equals(value.RegionId, regionId, StringComparison.Ordinal)
                    && value.IsStructural
                    && value.IsWalkable
                    && value.Kind != DungeonSurfaceKindV2.Hazard)
                .OrderByDescending(value => FootprintArea(value.Volume))
                .ThenBy(value => value.Id, StringComparer.Ordinal)
                .First();
        }

        public static DungeonSurfacePlanV2 PrimarySafeCatchmentSurface(
            DungeonPlanV2 plan,
            DungeonFallCatchmentPlanV2 catchment) =>
            catchment.SafeSurfaceIds
                .Select(id => plan.Surfaces.Single(value => string.Equals(value.Id, id, StringComparison.Ordinal)))
                .OrderByDescending(value => FootprintArea(value.Volume))
                .ThenBy(value => value.Id, StringComparer.Ordinal)
                .First();

        public static bool PredicateReferences(
            DungeonAccessPredicateV2 predicate,
            DungeonPredicateConditionKindV2 kind,
            string subjectId) =>
            predicate.Clauses.SelectMany(value => value.Conditions).Any(value =>
                value.Kind == kind
                && string.Equals(value.SubjectId, subjectId, StringComparison.Ordinal));

        private static double FootprintArea(DungeonConvexPrismV2 prism)
        {
            double twiceArea = 0d;
            for (int index = 0; index < prism.HorizontalVertices.Count; index += 1)
            {
                DungeonPoint2V2 current = prism.HorizontalVertices[index];
                DungeonPoint2V2 next = prism.HorizontalVertices[(index + 1) % prism.HorizontalVertices.Count];
                twiceArea += current.X * next.Z - next.X * current.Z;
            }
            return Math.Abs(twiceArea) * 0.5d;
        }
    }
}
