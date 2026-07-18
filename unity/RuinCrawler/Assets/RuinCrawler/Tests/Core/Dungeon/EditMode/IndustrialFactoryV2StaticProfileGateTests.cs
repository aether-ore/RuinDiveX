using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace RuinCrawler.Core.Dungeon.V2.Tests
{
    public sealed class IndustrialFactoryV2StaticProfileGateTests
    {
        [Test]
        public void GeneratedPlanPassesDerivedBoundaryElectricAndCapabilityGates()
        {
            DungeonPlanV2 plan = GenerateElectrical("static-profile-baseline");
            IReadOnlyList<IndustrialFactoryV2ValidationIssue> issues =
                new IndustrialFactoryV2StaticProfileValidator().Validate(plan);

            Assert.That(issues, Is.Empty, Describe(issues));
        }

        [Test]
        public void RemovingCertifiedPerimeterRailExposesAnUnregisteredBoundary()
        {
            DungeonPlanV2 source = new IndustrialFactoryV2Generator().Generate("derived-edge-rail-negative");
            var exposureRailIds = new HashSet<string>(
                source.FallExposures.SelectMany(value => value.RailConstraintSurfaceIds),
                StringComparer.Ordinal);
            DungeonSurfacePlanV2 rail = source.Surfaces.First(value =>
                value.Kind == DungeonSurfaceKindV2.Rail
                && !exposureRailIds.Contains(value.Id)
                && source.Surfaces.Any(walkable =>
                    string.Equals(walkable.RegionId, value.RegionId, StringComparison.Ordinal)
                    && walkable.IsStructural
                    && walkable.IsWalkable));
            DungeonPlanV2 invalid = Rebuild(
                source,
                surfaces: source.Surfaces.Where(value => value.Id != rail.Id));

            AssertCode(
                new IndustrialFactoryV2StaticProfileValidator().Validate(invalid),
                "EXPOSED_BOUNDARY_UNCOVERED");
        }

        [Test]
        public void DropBoundaryMustBeCoveredByExposureFromItsActualWalkableSurface()
        {
            DungeonPlanV2 source = new IndustrialFactoryV2Generator().Generate("derived-edge-exposure-negative");
            DungeonFallExposurePlanV2 exposure = source.FallExposures.First(value =>
                source.Surfaces.Count(surface =>
                    string.Equals(surface.RegionId, value.SourceRegionId, StringComparison.Ordinal)
                    && surface.IsWalkable) > 1);
            DungeonSurfacePlanV2 foreignSource = source.Surfaces.First(value =>
                value.RegionId == exposure.SourceRegionId
                && value.IsWalkable
                && value.Id != exposure.SourceSurfaceId);
            DungeonFallCatchmentPlanV2 catchment = source.FallCatchments.Single(value =>
                exposure.RequiredCatchmentIds.Contains(value.Id));
            DungeonSurfacePlanV2 safeDropContinuation =
                DungeonV2SemanticFixtureQueries.PrimarySafeCatchmentSurface(source, catchment);
            DungeonSurfacePlanV2 loweredContinuation = ReplaceVolume(
                safeDropContinuation,
                new DungeonConvexPrismV2(
                    safeDropContinuation.Volume.HorizontalVertices,
                    safeDropContinuation.Volume.MinimumY - 0.25d,
                    safeDropContinuation.Volume.MaximumY - 0.25d));
            var redirected = new DungeonFallExposurePlanV2(
                exposure.Id,
                exposure.SourceRegionId,
                foreignSource.Id,
                exposure.SourceVolume,
                exposure.Causes,
                exposure.MovementProfileVersion,
                exposure.MaximumHorizontalDisplacement,
                exposure.ConservativeFallVolume,
                exposure.RailConstraintSurfaceIds,
                exposure.RequiredCatchmentIds,
                exposure.StructuralBottomClearance,
                exposure.ReactionEnvelopeId);
            DungeonPlanV2 invalid = Rebuild(
                source,
                surfaces: source.Surfaces
                    .Select(value => value.Id == safeDropContinuation.Id ? loweredContinuation : value),
                exposures: source.FallExposures.Select(value => value.Id == exposure.Id ? redirected : value));

            AssertCode(
                new IndustrialFactoryV2StaticProfileValidator().Validate(invalid),
                "EXPOSED_BOUNDARY_UNCOVERED");
        }

        [Test]
        public void MovingPlatformBoundaryMustHaveItsRegisteredFailureExposure()
        {
            DungeonPlanV2 source = new IndustrialFactoryV2Generator().Generate(
                "derived-moving-platform-exposure-negative");
            DungeonSurfacePlanV2 platform = source.Surfaces.First(value =>
                value.Id.EndsWith("-return-lift-platform", StringComparison.Ordinal));
            var unregisteredPlatform = new DungeonSurfacePlanV2(
                "surface-test-unregistered-moving-platform",
                platform.ModuleInstanceId,
                platform.RegionId,
                DungeonSurfaceKindV2.MovingPlatform,
                TranslateVolume(platform.Volume, 100d, 0d),
                platform.MaterialProfileId,
                true,
                true,
                platform.ActivePredicate,
                platform.ControllerId,
                DungeonSpatialRecordSourceV2.AssemblyAddition);
            DungeonPlanV2 invalid = Rebuild(
                source,
                surfaces: source.Surfaces.Concat(new[] { unregisteredPlatform }));

            AssertCode(
                new IndustrialFactoryV2StaticProfileValidator().Validate(invalid),
                "EXPOSED_BOUNDARY_UNCOVERED");
        }

        [Test]
        public void ElectricPanelLongerThanSafeWindowRequiresWaitingIsland()
        {
            DungeonPlanV2 source = GenerateElectrical("electric-crossing-negative");
            DungeonSurfacePlanV2 hazard = ElectricHazard(source);
            DungeonPoint3 center = Center(source.Regions.Single(value => value.Id == hazard.RegionId).Bounds);
            DungeonSurfacePlanV2 oversized = ReplaceVolume(
                hazard,
                Box(center.X - 6d, center.X + 6d, hazard.Volume.MinimumY, hazard.Volume.MaximumY,
                    center.Z - 6d, center.Z + 6d));
            var waitingIslandIds = new HashSet<string>(
                source.Surfaces
                    .Where(value => value.RegionId == hazard.RegionId
                        && value.Kind != DungeonSurfaceKindV2.Hazard
                        && value.IsStructural
                        && value.IsWalkable
                        && value.Volume.MaximumY + 1e-9d >= hazard.Volume.MaximumY)
                    .Select(value => value.Id),
                StringComparer.Ordinal);
            DungeonPlanV2 invalid = Rebuild(
                source,
                surfaces: source.Surfaces
                    .Select(value => value.Id == hazard.Id
                        ? oversized
                        : !waitingIslandIds.Contains(value.Id)
                            ? value
                            : ReplaceVolume(
                                value,
                                new DungeonConvexPrismV2(
                                    value.Volume.HorizontalVertices,
                                    value.Volume.MinimumY - 2d,
                                    value.Volume.MaximumY - 2d))));

            AssertCode(
                new IndustrialFactoryV2StaticProfileValidator().Validate(invalid),
                "ELECTRIC_CROSSING_EXCEEDS_SAFE_WINDOW");
        }

        [Test]
        public void CapsuleSafeWaitingIslandSplitsLongElectricCrossing()
        {
            DungeonPlanV2 source = GenerateElectrical("electric-crossing-waiting-island");
            DungeonSurfacePlanV2 hazard = ElectricHazard(source);
            DungeonPoint3 center = Center(source.Regions.Single(value => value.Id == hazard.RegionId).Bounds);
            DungeonSurfacePlanV2 oversized = ReplaceVolume(
                hazard,
                Box(center.X - 6d, center.X + 6d, hazard.Volume.MinimumY, hazard.Volume.MaximumY,
                    center.Z - 6d, center.Z + 6d));
            var island = new DungeonSurfacePlanV2(
                "surface-electric-certified-waiting-island",
                hazard.ModuleInstanceId,
                hazard.RegionId,
                DungeonSurfaceKindV2.Walkable,
                Box(center.X - 1.25d, center.X + 1.25d, hazard.Volume.MaximumY, hazard.Volume.MaximumY + 0.25d,
                    center.Z - 1.25d, center.Z + 1.25d),
                "electric-safe-waiting-island",
                true,
                true,
                DungeonAccessPredicateV2.Always);
            DungeonPlanV2 withIsland = Rebuild(
                source,
                surfaces: source.Surfaces
                    .Select(value => value.Id == hazard.Id ? oversized : value)
                    .Concat(new[] { island }));

            IReadOnlyList<IndustrialFactoryV2ValidationIssue> issues =
                new IndustrialFactoryV2StaticProfileValidator().Validate(withIsland);
            Assert.That(
                issues.Select(value => value.Code),
                Does.Not.Contain("ELECTRIC_CROSSING_EXCEEDS_SAFE_WINDOW"),
                Describe(issues));
        }

        [Test]
        public void UncertifiedTraversalCapabilityIsRejectedEverywherePredicatesAreConsumed()
        {
            DungeonPlanV2 source = new IndustrialFactoryV2Generator().Generate("capability-whitelist-negative");
            DungeonExplorationRoutePlanV2 route = source.Routes.First();
            var unsupported = new DungeonAccessPredicateV2(new[]
            {
                new DungeonPredicateClauseV2(new[]
                {
                    new DungeonPredicateConditionV2(
                        DungeonPredicateConditionKindV2.TraversalCapability,
                        "jet-skates-v1",
                        DungeonPredicateOperatorV2.IsPresent)
                })
            });
            var changed = new DungeonExplorationRoutePlanV2(
                route.Id,
                route.OrderedTraversalEdgeIds,
                route.Role,
                unsupported,
                route.AuthorizedExits,
                route.EstimatedTraversalSeconds,
                route.RiskBudget,
                route.DiscoveryIds,
                route.ReverseTraversalPolicy,
                route.RevealPolicy);
            DungeonPlanV2 invalid = Rebuild(
                source,
                routes: source.Routes.Select(value => value.Id == route.Id ? changed : value));

            AssertCode(
                new IndustrialFactoryV2StaticProfileValidator().Validate(invalid),
                "TRAVERSAL_CAPABILITY_NOT_ALLOWED");
        }

        [TestCase(DungeonDiscoveryKindV2.ZennyCache)]
        [TestCase(DungeonDiscoveryKindV2.RefractorCache)]
        public void ReservedCacheKindsAreRejectedUntilTransactionalLedgersExist(
            DungeonDiscoveryKindV2 reservedKind)
        {
            DungeonPlanV2 source = new IndustrialFactoryV2Generator().Generate("reserved-discovery-negative");
            DungeonDiscoveryPlanV2 discovery = source.Discoveries.First(value =>
                value.Kind == DungeonDiscoveryKindV2.Lore);
            var reserved = new DungeonDiscoveryPlanV2(
                discovery.Id,
                reservedKind,
                discovery.LocationAnchorId,
                discovery.DistrictId,
                discovery.AccessPredicate,
                discovery.RevealPredicate,
                discovery.DurableRewardId,
                discovery.CompletionSignificance,
                discovery.DuplicatePolicy);
            DungeonPlanV2 invalid = Rebuild(
                source,
                discoveries: source.Discoveries.Select(value => value.Id == discovery.Id ? reserved : value));

            AssertCode(
                new IndustrialFactoryV2StaticProfileValidator().Validate(invalid),
                "DISCOVERY_KIND_LEDGER_UNAVAILABLE");
        }

        [Test]
        public void EncounterClearanceRejectsCrossRegionSpatialOverlap()
        {
            DungeonPlanV2 source = new IndustrialFactoryV2Generator().Generate("cross-region-encounter-clearance");
            DungeonAnchorPlanV2 encounter = source.Anchors.First(value =>
                value.Kind == DungeonAnchorKindV2.Encounter);
            DungeonAnchorPlanV2 protectedAnchor = source.Anchors.First(value =>
                value.RegionId != encounter.RegionId
                && value.Kind == DungeonAnchorKindV2.Safe);
            var moved = new DungeonAnchorPlanV2(
                protectedAnchor.Id,
                protectedAnchor.ModuleInstanceId,
                protectedAnchor.RegionId,
                protectedAnchor.Kind,
                encounter.Position,
                protectedAnchor.ProfileId);
            DungeonPlanV2 invalid = Rebuild(
                source,
                anchors: source.Anchors.Select(value => value.Id == protectedAnchor.Id ? moved : value));

            AssertCode(
                new IndustrialFactoryV2Validator().Validate(invalid).Errors,
                "ENCOUNTER_FOOTPRINT_BLOCKS_CRITICAL_ANCHOR");
        }

        private static DungeonPlanV2 GenerateElectrical(string seedPrefix)
        {
            for (int index = 0; index < 32; index += 1)
            {
                DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate(seedPrefix + "-" + index);
                if (plan.Districts.Any(value => value.Kind == DungeonBiomeDistrictKindV2.ElectricalUndercroft))
                    return plan;
            }
            throw new AssertionException("Unable to derive an electrical seed from the deterministic corpus.");
        }

        private static DungeonSurfacePlanV2 ElectricHazard(DungeonPlanV2 plan)
        {
            return plan.Surfaces.First(value =>
                value.Kind == DungeonSurfaceKindV2.Hazard
                && value.MaterialProfileId == "electric-floor-cycle-v1");
        }

        private static DungeonPoint3 Center(DungeonBounds3 bounds)
        {
            return new DungeonPoint3(
                (bounds.Minimum.X + bounds.Maximum.X) * 0.5d,
                (bounds.Minimum.Y + bounds.Maximum.Y) * 0.5d,
                (bounds.Minimum.Z + bounds.Maximum.Z) * 0.5d);
        }

        private static DungeonSurfacePlanV2 ReplaceVolume(
            DungeonSurfacePlanV2 source,
            DungeonConvexPrismV2 volume)
        {
            return new DungeonSurfacePlanV2(
                source.Id,
                source.ModuleInstanceId,
                source.RegionId,
                source.Kind,
                volume,
                source.MaterialProfileId,
                source.IsStructural,
                source.IsWalkable,
                source.ActivePredicate,
                source.ControllerId,
                source.Source);
        }

        private static DungeonConvexPrismV2 TranslateVolume(
            DungeonConvexPrismV2 source,
            double deltaX,
            double deltaZ)
        {
            return new DungeonConvexPrismV2(
                source.HorizontalVertices.Select(value =>
                    new DungeonPoint2V2(value.X + deltaX, value.Z + deltaZ)),
                source.MinimumY,
                source.MaximumY);
        }

        private static DungeonPlanV2 Rebuild(
            DungeonPlanV2 source,
            IEnumerable<DungeonAnchorPlanV2> anchors = null,
            IEnumerable<DungeonExplorationRoutePlanV2> routes = null,
            IEnumerable<DungeonDiscoveryPlanV2> discoveries = null,
            IEnumerable<DungeonSurfacePlanV2> surfaces = null,
            IEnumerable<DungeonFallExposurePlanV2> exposures = null)
        {
            return new DungeonPlanV2(
                source.SchemaVersion,
                source.ContractVersion,
                source.RulesetVersion,
                source.ProfileId,
                source.ContentPackVersion,
                source.Seed,
                source.AttemptSeed,
                source.GenerationAttempt,
                source.Difficulty,
                source.EntranceRegionId,
                source.ExtractionRegionId,
                source.Bounds,
                source.VoidPolicy,
                source.MacroRoles,
                source.Modules,
                source.Connectors,
                anchors ?? source.Anchors,
                source.Regions,
                source.Districts,
                source.TraversalEdges,
                routes ?? source.Routes,
                discoveries ?? source.Discoveries,
                source.Shortcuts,
                surfaces ?? source.Surfaces,
                source.FluidZones,
                source.FluidNetworks,
                source.EnvironmentControllers,
                source.FallCatchments,
                exposures ?? source.FallExposures,
                source.GameplayBeats,
                source.AbstractRouteGraph,
                source.BeatAssignments,
                source.MiniDungeonCompositions);
        }

        private static DungeonConvexPrismV2 Box(
            double minimumX,
            double maximumX,
            double minimumY,
            double maximumY,
            double minimumZ,
            double maximumZ)
        {
            return new DungeonConvexPrismV2(
                new[]
                {
                    new DungeonPoint2V2(minimumX, minimumZ),
                    new DungeonPoint2V2(maximumX, minimumZ),
                    new DungeonPoint2V2(maximumX, maximumZ),
                    new DungeonPoint2V2(minimumX, maximumZ)
                },
                minimumY,
                maximumY);
        }

        private static void AssertCode(
            IEnumerable<IndustrialFactoryV2ValidationIssue> issues,
            string expectedCode)
        {
            Assert.That(issues.Select(value => value.Code), Does.Contain(expectedCode), Describe(issues));
        }

        private static string Describe(IEnumerable<IndustrialFactoryV2ValidationIssue> issues)
        {
            return string.Join(" | ", issues.Select(value => value.ToString()));
        }
    }
}
