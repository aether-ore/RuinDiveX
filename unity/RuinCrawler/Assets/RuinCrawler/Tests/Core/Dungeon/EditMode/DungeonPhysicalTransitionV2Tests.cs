using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace RuinCrawler.Core.Dungeon.V2.Tests
{
    public sealed class DungeonPhysicalTransitionV2Tests
    {
        [Test]
        public void ProtectedBoundaryRejectsOffCenterGateFrameSlit()
        {
            DungeonPlanV2 source = Generate("physical-off-center-frame-slit");
            DungeonTraversalEdgePlanV2 boundary = DungeonV2SemanticFixtureQueries.CredentialBoundary(source);
            DungeonSurfacePlanV2 gate = DungeonV2SemanticFixtureQueries.CredentialBarrier(source);
            DungeonSurfacePlanV2[] splitFrame = SplitBarrierLeavingSlit(gate, 1.2d);
            DungeonPlanV2 invalid = Rebuild(
                source,
                source.Surfaces
                    .Where(value => !string.Equals(value.Id, gate.Id, StringComparison.Ordinal))
                    .Concat(splitFrame));

            AssertProtectedBypass(invalid, boundary.FromRegionId, boundary.ToRegionId);
        }

        [Test]
        public void ProtectedBoundaryRejectsJumpableGateTop()
        {
            DungeonPlanV2 source = Generate("physical-jumpable-gate-top");
            DungeonTraversalEdgePlanV2 boundary = DungeonV2SemanticFixtureQueries.CredentialBoundary(source);
            DungeonSurfacePlanV2 gate = DungeonV2SemanticFixtureQueries.CredentialBarrier(source);
            DungeonSurfacePlanV2 sourceFloor = DungeonV2SemanticFixtureQueries.PrimaryWalkableSurface(
                source,
                boundary.FromRegionId);
            double jumpableTop = sourceFloor.Volume.MaximumY
                + TraversalProfilesV2.Flooded.JumpHeight - 0.1d;
            DungeonSurfacePlanV2 lowGate = CopySurface(
                gate,
                gate.Id,
                Box(
                    gate.Volume.HorizontalVertices.Min(value => value.X),
                    gate.Volume.HorizontalVertices.Max(value => value.X),
                    gate.Volume.MinimumY,
                    jumpableTop,
                    gate.Volume.HorizontalVertices.Min(value => value.Z),
                    gate.Volume.HorizontalVertices.Max(value => value.Z)));
            DungeonPlanV2 invalid = Rebuild(
                source,
                source.Surfaces.Select(value => value.Id == gate.Id ? lowGate : value));

            AssertProtectedBypass(invalid, boundary.FromRegionId, boundary.ToRegionId);
        }

        [Test]
        public void ProtectedBoundaryRejectsLowerTunnelAscentWhenHatchIsMissing()
        {
            DungeonPlanV2 source = Generate("physical-lower-tunnel-ascent");
            DungeonTraversalEdgePlanV2 boundary = DungeonV2SemanticFixtureQueries.CredentialBoundary(source);
            DungeonRegionPlanV2 hazardLanding = DungeonV2SemanticFixtureQueries.HazardLandingRegion(source);
            DungeonSurfacePlanV2[] separatorSurfaces = source.Surfaces
                .Where(value => value.IsStructural
                    && !value.IsWalkable
                    && (string.Equals(value.RegionId, hazardLanding.Id, StringComparison.Ordinal)
                        || string.Equals(value.RegionId, boundary.ToRegionId, StringComparison.Ordinal)))
                .Where(value => HorizontalGap(value.Volume, source.Regions.Single(region =>
                        string.Equals(region.Id, boundary.ToRegionId, StringComparison.Ordinal)).Bounds)
                    <= TraversalProfilesV2.Flooded.CapsuleRadius * 2d)
                .Select(value => value)
                .ToArray();
            Assert.That(separatorSurfaces, Is.Not.Empty,
                "The lower-to-far-side adjacency must be sealed by authored structure before mutation.");
            DungeonPlanV2 invalid = Rebuild(
                source,
                source.Surfaces.Where(value => !separatorSurfaces.Any(separator =>
                    string.Equals(separator.Id, value.Id, StringComparison.Ordinal))));

            AssertProtectedBypass(invalid, hazardLanding.Id, boundary.ToRegionId);
        }

        [Test]
        public void BenignAuthorizedInBandTransitionDoesNotTripCredentialBoundary()
        {
            DungeonPlanV2 plan = Generate("physical-benign-in-band-transition");
            DungeonProgressionSolveResultV2 result = new DungeonProgressionSolverV2().Solve(plan);
            DungeonTraversalEdgePlanV2 boundary = DungeonV2SemanticFixtureQueries.CredentialBoundary(plan);

            Assert.That(result.ProtectedBoundaryViolations, Is.Empty,
                string.Join(" | ", result.ProtectedBoundaryViolations));
            Assert.That(plan.TraversalEdges.Any(value =>
                !value.IsProtectedProgressionBoundary
                && (string.Equals(value.FromRegionId, boundary.FromRegionId, StringComparison.Ordinal)
                    || string.Equals(value.ToRegionId, boundary.FromRegionId, StringComparison.Ordinal))), Is.True,
                "The pre-gate region must remain connected inside its authorized progression band.");
        }

        [Test]
        public void ElevatedHazardInSameHorizontalFootprintDoesNotPoisonGroundRoute()
        {
            DungeonPlanV2 source = Generate("hazard-cross-stratum-elevated");
            DungeonFallCatchmentPlanV2 catchment = DungeonV2SemanticFixtureQueries.HazardCatchment(source);
            DungeonSurfacePlanV2 basinFloor = DungeonV2SemanticFixtureQueries.PrimarySafeCatchmentSurface(
                source,
                catchment);
            var elevatedHazard = new DungeonSurfacePlanV2(
                "surface-test-elevated-hazard",
                basinFloor.ModuleInstanceId,
                basinFloor.RegionId,
                DungeonSurfaceKindV2.Hazard,
                Box(
                    basinFloor.Volume.HorizontalVertices.Min(value => value.X),
                    basinFloor.Volume.HorizontalVertices.Max(value => value.X),
                    basinFloor.Volume.MaximumY + TraversalProfilesV2.Dry.CapsuleHeight + 1d,
                    basinFloor.Volume.MaximumY + TraversalProfilesV2.Dry.CapsuleHeight + 1.25d,
                    basinFloor.Volume.HorizontalVertices.Min(value => value.Z),
                    basinFloor.Volume.HorizontalVertices.Max(value => value.Z)),
                "test-elevated-hazard",
                false,
                true,
                DungeonAccessPredicateV2.Always,
                IndustrialFactoryV2Ruleset.HazardControllerId);
            DungeonPlanV2 plan = Rebuild(source, source.Surfaces.Concat(new[] { elevatedHazard }));

            IndustrialFactoryV2ValidationResult result = new IndustrialFactoryV2Validator().Validate(plan);
            Assert.That(result.Errors.Select(value => value.Code),
                Does.Not.Contain("HAZARD_REWARD_REQUIRES_DAMAGE")
                    .And.Not.Contain("HAZARD_RECOVERY_ANCHOR_UNSAFE")
                    .And.Not.Contain("HAZARD_DAMAGE_FREE_ROUTE_MISSING"),
                Describe(result));
        }

        [Test]
        public void CrossStratumWalkablePrismCannotSatisfyGroundFooting()
        {
            DungeonPlanV2 source = Generate("hazard-cross-stratum-footing");
            DungeonFallCatchmentPlanV2 catchment = DungeonV2SemanticFixtureQueries.HazardCatchment(source);
            var safeSurfaceIds = new HashSet<string>(catchment.SafeSurfaceIds, StringComparer.Ordinal);
            DungeonPlanV2 invalid = Rebuild(
                source,
                source.Surfaces.Select(value => !safeSurfaceIds.Contains(value.Id)
                    ? value
                    : CopySurface(
                        value,
                        value.Id,
                        new DungeonConvexPrismV2(
                            value.Volume.HorizontalVertices,
                            value.Volume.MinimumY - 4d,
                            value.Volume.MaximumY - 4d))));

            IndustrialFactoryV2ValidationResult result = new IndustrialFactoryV2Validator().Validate(invalid);
            Assert.That(result.Errors.Select(value => value.Code),
                Does.Contain("HAZARD_REWARD_REQUIRES_DAMAGE")
                    .Or.Contain("HAZARD_RECOVERY_ANCHOR_UNSAFE"),
                Describe(result));
        }

        private static DungeonPlanV2 Generate(string seed)
        {
            return new IndustrialFactoryV2Generator().Generate(seed);
        }

        private static void AssertProtectedBypass(
            DungeonPlanV2 plan,
            string expectedSourceRegionId,
            string expectedTargetRegionId)
        {
            DungeonProgressionSolveResultV2 result = new DungeonProgressionSolverV2().Solve(plan);
            Assert.That(result.ProtectedBoundaryViolations.Any(value =>
                value.Contains("from " + expectedSourceRegionId, StringComparison.Ordinal)
                && value.Contains(expectedTargetRegionId, StringComparison.Ordinal)), Is.True,
                string.Join(" | ", result.ProtectedBoundaryViolations));
        }

        private static DungeonSurfacePlanV2 CopySurface(
            DungeonSurfacePlanV2 source,
            string id,
            DungeonConvexPrismV2 volume)
        {
            return new DungeonSurfacePlanV2(
                id,
                source.ModuleInstanceId,
                source.RegionId,
                source.Kind,
                volume,
                source.MaterialProfileId,
                source.IsStructural,
                source.IsWalkable,
                source.ActivePredicate,
                source.ControllerId);
        }

        private static DungeonSurfacePlanV2[] SplitBarrierLeavingSlit(
            DungeonSurfacePlanV2 barrier,
            double slitWidth)
        {
            double minimumX = barrier.Volume.HorizontalVertices.Min(value => value.X);
            double maximumX = barrier.Volume.HorizontalVertices.Max(value => value.X);
            double minimumZ = barrier.Volume.HorizontalVertices.Min(value => value.Z);
            double maximumZ = barrier.Volume.HorizontalVertices.Max(value => value.Z);
            double spanX = maximumX - minimumX;
            double spanZ = maximumZ - minimumZ;
            if (spanX >= spanZ)
            {
                double slitCenter = minimumX + spanX * 0.35d;
                return new[]
                {
                    CopySurface(barrier, barrier.Id + "-left", Box(
                        minimumX, slitCenter - slitWidth * 0.5d,
                        barrier.Volume.MinimumY, barrier.Volume.MaximumY, minimumZ, maximumZ)),
                    CopySurface(barrier, barrier.Id + "-right", Box(
                        slitCenter + slitWidth * 0.5d, maximumX,
                        barrier.Volume.MinimumY, barrier.Volume.MaximumY, minimumZ, maximumZ))
                };
            }

            double zSlitCenter = minimumZ + spanZ * 0.35d;
            return new[]
            {
                CopySurface(barrier, barrier.Id + "-south", Box(
                    minimumX, maximumX, barrier.Volume.MinimumY, barrier.Volume.MaximumY,
                    minimumZ, zSlitCenter - slitWidth * 0.5d)),
                CopySurface(barrier, barrier.Id + "-north", Box(
                    minimumX, maximumX, barrier.Volume.MinimumY, barrier.Volume.MaximumY,
                    zSlitCenter + slitWidth * 0.5d, maximumZ))
            };
        }

        private static double HorizontalGap(DungeonConvexPrismV2 prism, DungeonBounds3 bounds)
        {
            double gapX = AxisGap(
                prism.HorizontalVertices.Min(value => value.X),
                prism.HorizontalVertices.Max(value => value.X),
                bounds.Minimum.X,
                bounds.Maximum.X);
            double gapZ = AxisGap(
                prism.HorizontalVertices.Min(value => value.Z),
                prism.HorizontalVertices.Max(value => value.Z),
                bounds.Minimum.Z,
                bounds.Maximum.Z);
            return Math.Sqrt(gapX * gapX + gapZ * gapZ);
        }

        private static double AxisGap(double firstMin, double firstMax, double secondMin, double secondMax) =>
            Math.Max(0d, Math.Max(firstMin, secondMin) - Math.Min(firstMax, secondMax));

        private static DungeonPlanV2 Rebuild(
            DungeonPlanV2 source,
            IEnumerable<DungeonSurfacePlanV2> surfaces)
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
                source.Anchors,
                source.Regions,
                source.Districts,
                source.TraversalEdges,
                source.Routes,
                source.Discoveries,
                source.Shortcuts,
                surfaces,
                source.FluidZones,
                source.FluidNetworks,
                source.EnvironmentControllers,
                source.FallCatchments,
                source.FallExposures,
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

        private static string Describe(IndustrialFactoryV2ValidationResult result)
        {
            return string.Join(" | ", result.Errors.Select(value => value.ToString()));
        }
    }
}
