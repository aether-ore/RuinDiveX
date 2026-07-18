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
            DungeonSurfacePlanV2 gate = source.Surfaces.Single(value =>
                string.Equals(value.Id, "surface-credential-bulkhead", StringComparison.Ordinal));
            double minimumX = gate.Volume.HorizontalVertices.Min(value => value.X);
            double maximumX = gate.Volume.HorizontalVertices.Max(value => value.X);
            double minimumZ = gate.Volume.HorizontalVertices.Min(value => value.Z);
            double maximumZ = gate.Volume.HorizontalVertices.Max(value => value.Z);
            var centerFrame = CopySurface(
                gate,
                "surface-test-credential-frame-center",
                Box(minimumX, maximumX, gate.Volume.MinimumY, gate.Volume.MaximumY, minimumZ, 1.2d));
            var northFrame = CopySurface(
                gate,
                "surface-test-credential-frame-north",
                Box(minimumX, maximumX, gate.Volume.MinimumY, gate.Volume.MaximumY, 2.5d, maximumZ));
            DungeonPlanV2 invalid = Rebuild(
                source,
                source.Surfaces
                    .Where(value => !string.Equals(value.Id, gate.Id, StringComparison.Ordinal))
                    .Concat(new[] { centerFrame, northFrame }));

            AssertProtectedBypass(invalid, "factory-credential-tower", "factory-machine-core");
        }

        [Test]
        public void ProtectedBoundaryRejectsJumpableGateTop()
        {
            DungeonPlanV2 source = Generate("physical-jumpable-gate-top");
            DungeonSurfacePlanV2 gate = source.Surfaces.Single(value =>
                string.Equals(value.Id, "surface-credential-bulkhead", StringComparison.Ordinal));
            DungeonSurfacePlanV2 sourceFloor = source.Surfaces.Single(value =>
                string.Equals(value.Id, "surface-factory-credential-tower", StringComparison.Ordinal));
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
                source.Surfaces
                    .Where(value => !string.Equals(
                        value.Id,
                        "surface-credential-upper-bulkhead",
                        StringComparison.Ordinal))
                    .Select(value => value.Id == gate.Id ? lowGate : value));

            AssertProtectedBypass(invalid, "factory-credential-tower", "factory-machine-core");
        }

        [Test]
        public void ProtectedBoundaryRejectsLowerTunnelAscentWhenHatchIsMissing()
        {
            DungeonPlanV2 source = Generate("physical-lower-tunnel-ascent");
            DungeonPlanV2 invalid = Rebuild(
                source,
                source.Surfaces.Where(value => !string.Equals(
                        value.Id,
                        "surface-undercroft-credential-hatch",
                        StringComparison.Ordinal)
                    && !string.Equals(
                        value.Id,
                        "surface-rail-hazard-undercroft-basin-north",
                        StringComparison.Ordinal)
                    && !string.Equals(
                        value.Id,
                        "surface-rail-factory-machine-core-south",
                        StringComparison.Ordinal)));

            AssertProtectedBypass(invalid, "hazard-undercroft-basin", "factory-machine-core");
        }

        [Test]
        public void BenignAuthorizedInBandTransitionDoesNotTripCredentialBoundary()
        {
            DungeonPlanV2 plan = Generate("physical-benign-in-band-transition");
            DungeonProgressionSolveResultV2 result = new DungeonProgressionSolverV2().Solve(plan);

            Assert.That(result.ProtectedBoundaryViolations, Is.Empty,
                string.Join(" | ", result.ProtectedBoundaryViolations));
            Assert.That(plan.TraversalEdges.Any(value =>
                !value.IsProtectedProgressionBoundary
                && string.Equals(value.FromRegionId, "factory-nest-warehouse", StringComparison.Ordinal)
                && string.Equals(value.ToRegionId, "factory-credential-tower", StringComparison.Ordinal)), Is.True);
        }

        [Test]
        public void ElevatedHazardInSameHorizontalFootprintDoesNotPoisonGroundRoute()
        {
            DungeonPlanV2 source = Generate("hazard-cross-stratum-elevated");
            DungeonSurfacePlanV2 basinFloor = source.Surfaces.Single(value =>
                string.Equals(value.Id, "surface-hazard-undercroft-basin", StringComparison.Ordinal));
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
            DungeonSurfacePlanV2 basinFloor = source.Surfaces.Single(value =>
                string.Equals(value.Id, "surface-hazard-undercroft-basin", StringComparison.Ordinal));
            DungeonSurfacePlanV2 displacedFloor = CopySurface(
                basinFloor,
                basinFloor.Id,
                Box(
                    basinFloor.Volume.HorizontalVertices.Min(value => value.X),
                    basinFloor.Volume.HorizontalVertices.Max(value => value.X),
                    basinFloor.Volume.MinimumY - 4d,
                    basinFloor.Volume.MaximumY - 4d,
                    basinFloor.Volume.HorizontalVertices.Min(value => value.Z),
                    basinFloor.Volume.HorizontalVertices.Max(value => value.Z)));
            DungeonPlanV2 invalid = Rebuild(
                source,
                source.Surfaces.Select(value => value.Id == basinFloor.Id ? displacedFloor : value));

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
                source.FallExposures);
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
