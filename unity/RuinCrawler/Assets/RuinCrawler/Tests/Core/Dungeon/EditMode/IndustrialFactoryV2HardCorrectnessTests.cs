using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace RuinCrawler.Core.Dungeon.V2.Tests
{
    public sealed class IndustrialFactoryV2HardCorrectnessTests
    {
        [Test]
        public void WaterRoutingHasRecoverableFloodedAndDrainedDiscoveries()
        {
            DungeonPlanV2 plan = Generate("water-state-discovery-contract");
            IndustrialFactoryV2ValidationResult result = new IndustrialFactoryV2Validator().Validate(plan);

            Assert.That(result.Accepted, Is.True, Describe(result));
            Assert.That(plan.Discoveries.Any(value =>
                RequiresState(value.AccessPredicate, IndustrialFactoryV2Ruleset.FreightSumpFilled)
                || RequiresState(value.AccessPredicate, IndustrialFactoryV2Ruleset.GantrySumpFilled)), Is.True);
            Assert.That(plan.Discoveries.Any(value =>
                RequiresState(value.AccessPredicate, IndustrialFactoryV2Ruleset.StoredInReservoir)), Is.True);
        }

        [Test]
        public void ValidatorRejectsMissingDrainedDiscoveryAndNonReversibleRouting()
        {
            DungeonPlanV2 source = Generate("water-state-negative-contract");
            DungeonDiscoveryPlanV2 drained = source.Discoveries.Single(value =>
                string.Equals(
                    value.DurableRewardId,
                    IndustrialFactoryV2Ruleset.CoolingFinArrayRewardId,
                    StringComparison.Ordinal));
            DungeonDiscoveryPlanV2 unrestricted = new DungeonDiscoveryPlanV2(
                drained.Id,
                drained.Kind,
                drained.LocationAnchorId,
                drained.DistrictId,
                DungeonAccessPredicateV2.Always,
                drained.RevealPredicate,
                drained.DurableRewardId,
                drained.CompletionSignificance,
                drained.DuplicatePolicy);

            DungeonEnvironmentControllerPlanV2 routing = source.EnvironmentControllers.Single(value =>
                string.Equals(
                    value.Id,
                    IndustrialFactoryV2Ruleset.WaterRoutingControllerId,
                    StringComparison.Ordinal));
            DungeonEnvironmentControllerPlanV2 oneWayRouting = new DungeonEnvironmentControllerPlanV2(
                routing.Id,
                routing.Kind,
                routing.RegionIds,
                routing.StableStateIds,
                routing.InitialStateId,
                routing.Transitions.Where(value => !string.Equals(
                    value.FromStateId,
                    IndustrialFactoryV2Ruleset.StoredInReservoir,
                    StringComparison.Ordinal)));
            DungeonPlanV2 invalid = Rebuild(
                source,
                discoveries: source.Discoveries.Select(value => value.Id == drained.Id ? unrestricted : value),
                controllers: source.EnvironmentControllers.Select(value => value.Id == routing.Id ? oneWayRouting : value));

            IndustrialFactoryV2ValidationResult result = new IndustrialFactoryV2Validator().Validate(invalid);
            AssertCode(result.Errors, "WATER_DRAINED_DISCOVERY_MISSING");
            AssertCode(result.Errors, "WATER_ROUTING_NOT_REVERSIBLE");
        }

        [Test]
        public void ValidatorRejectsHazardRewardCoveredByUnavoidableDamage()
        {
            DungeonPlanV2 source = Generate("hazard-reward-negative-contract");
            DungeonBiomeDistrictPlanV2 hazard = source.Districts.Single(IsHazard);
            DungeonDiscoveryPlanV2 reward = source.Discoveries.Single(value =>
                string.Equals(value.DistrictId, hazard.Id, StringComparison.Ordinal)
                && value.CompletionSignificance >= 3);
            DungeonAnchorPlanV2 rewardAnchor = source.Anchors.Single(value => value.Id == reward.LocationAnchorId);
            DungeonRegionPlanV2 region = source.Regions.Single(value => value.Id == rewardAnchor.RegionId);
            DungeonModuleInstancePlanV2 module = source.Modules.First(value => value.RegionIds.Contains(region.Id));
            DungeonEnvironmentControllerPlanV2 controller = source.EnvironmentControllers.Single(value =>
                string.Equals(value.Id, IndustrialFactoryV2Ruleset.HazardControllerId, StringComparison.Ordinal));
            var unavoidable = new DungeonSurfacePlanV2(
                "surface-test-unavoidable-hazard",
                module.Id,
                region.Id,
                DungeonSurfaceKindV2.Hazard,
                // Hazard validation is intentionally stratum-aware. Put the
                // negative fixture on the reward's certified footing plane;
                // a tile down at the region's structural bottom may be a
                // legitimate lower-stratum hazard beneath a safe shelf.
                Prism(
                    region.Bounds,
                    rewardAnchor.Position.Y - 0.2d,
                    rewardAnchor.Position.Y),
                controller.Kind == DungeonEnvironmentControllerKindV2.Magma
                    ? "magma-floor-v1"
                    : "electric-floor-cycle-v1",
                true,
                true,
                DungeonAccessPredicateV2.Always,
                controller.Id);
            DungeonPlanV2 invalid = Rebuild(source, surfaces: source.Surfaces.Concat(new[] { unavoidable }));

            IndustrialFactoryV2ValidationResult result = new IndustrialFactoryV2Validator().Validate(invalid);
            Assert.That(result.Errors.Select(value => value.Code), Does.Contain("HAZARD_REWARD_REQUIRES_DAMAGE")
                .Or.Contain("HAZARD_DAMAGE_FREE_ROUTE_MISSING"));
        }

        [Test]
        public void ValidatorRejectsMissingCredentialBarrierAndDeclaredBypass()
        {
            DungeonPlanV2 source = Generate("protected-boundary-negative-contract");
            DungeonSurfacePlanV2 credentialBarrier = DungeonV2SemanticFixtureQueries.CredentialBarrier(source);
            DungeonPlanV2 missingBarrier = Rebuild(
                source,
                surfaces: source.Surfaces.Where(value => !string.Equals(
                    value.Id,
                    credentialBarrier.Id,
                    StringComparison.Ordinal)));
            IndustrialFactoryV2ValidationResult missingBarrierResult =
                new IndustrialFactoryV2Validator().Validate(missingBarrier);
            AssertCode(missingBarrierResult.Errors, "PROTECTED_BOUNDARY_BYPASS");

            DungeonTraversalEdgePlanV2 protectedEdge = DungeonV2SemanticFixtureQueries.CredentialBoundary(source);
            var bypass = new DungeonTraversalEdgePlanV2(
                "edge-test-credential-bypass",
                protectedEdge.FromRegionId,
                protectedEdge.ToRegionId,
                protectedEdge.FromAnchorId,
                protectedEdge.ToAnchorId,
                DungeonConnectorKindV2.Jump,
                DungeonAccessPredicateV2.Always,
                false);
            DungeonPlanV2 declaredBypass = Rebuild(
                source,
                traversalEdges: source.TraversalEdges.Concat(new[] { bypass }));
            IndustrialFactoryV2ValidationResult declaredBypassResult =
                new IndustrialFactoryV2Validator().Validate(declaredBypass);
            AssertCode(declaredBypassResult.Errors, "PROTECTED_BOUNDARY_BYPASS");
        }

        [Test]
        public void SolverRejectsUndeclaredLowerRegionJumpToProtectedFarSide()
        {
            DungeonPlanV2 source = Generate("protected-lower-region-negative-contract");
            DungeonTraversalEdgePlanV2 boundary = DungeonV2SemanticFixtureQueries.CredentialBoundary(source);
            DungeonFallCatchmentPlanV2 hazardCatchment = DungeonV2SemanticFixtureQueries.HazardCatchment(source);
            var referencedRailIds = new HashSet<string>(
                source.FallExposures.SelectMany(value => value.RailConstraintSurfaceIds),
                StringComparer.Ordinal);
            DungeonPlanV2 invalid = Rebuild(
                source,
                surfaces: source.Surfaces.Where(surface =>
                    !(surface.IsStructural
                        && !surface.IsWalkable
                        && !referencedRailIds.Contains(surface.Id)
                        && (string.Equals(surface.RegionId, hazardCatchment.RegionId, StringComparison.Ordinal)
                            || string.Equals(surface.RegionId, boundary.ToRegionId, StringComparison.Ordinal)))));

            DungeonProgressionSolveResultV2 result = new DungeonProgressionSolverV2().Solve(invalid);
            Assert.That(result.ProtectedBoundaryViolations.Any(value =>
                value.Contains("from " + hazardCatchment.RegionId, StringComparison.Ordinal)
                && value.Contains(boundary.ToRegionId, StringComparison.Ordinal)), Is.True,
                string.Join(" | ", result.ProtectedBoundaryViolations));
        }

        [Test]
        public void ValidatorRejectsAlwaysAuthorizedRouteExitAcrossCredentialBoundary()
        {
            DungeonPlanV2 source = Generate("route-exit-negative-contract");
            DungeonTraversalEdgePlanV2 boundary = DungeonV2SemanticFixtureQueries.CredentialBoundary(source);
            DungeonExplorationRoutePlanV2 recovery = source.Routes.Single(value =>
                value.Role == DungeonRouteRoleV2.Recovery);
            DungeonExplorationRoutePlanV2 invalidRecovery = new DungeonExplorationRoutePlanV2(
                recovery.Id,
                recovery.OrderedTraversalEdgeIds,
                recovery.Role,
                recovery.RequiredPredicate,
                recovery.AuthorizedExits.Concat(new[]
                {
                    new DungeonAuthorizedExitPlanV2(
                        "exit-test-credential-bypass",
                        boundary.FromRegionId,
                        boundary.ToRegionId,
                        DungeonAccessPredicateV2.Always)
                }),
                recovery.EstimatedTraversalSeconds,
                recovery.RiskBudget,
                recovery.DiscoveryIds,
                recovery.ReverseTraversalPolicy,
                recovery.RevealPolicy);
            DungeonPlanV2 invalid = Rebuild(
                source,
                routes: source.Routes.Select(value => value.Id == recovery.Id ? invalidRecovery : value));

            IndustrialFactoryV2ValidationResult result = new IndustrialFactoryV2Validator().Validate(invalid);
            AssertCode(result.Errors, "ROUTE_EXIT_AUTHORIZATION_BYPASS");
        }

        [Test]
        public void FallValidatorRejectsWrongReactionAndFallbackPlaneInsideCatchment()
        {
            DungeonPlanV2 source = Generate("fall-envelope-negative-contract");
            DungeonFallExposurePlanV2 exposure = source.FallExposures[0];
            var wrongReaction = new DungeonFallExposurePlanV2(
                exposure.Id,
                exposure.SourceRegionId,
                exposure.SourceSurfaceId,
                exposure.SourceVolume,
                exposure.Causes,
                exposure.MovementProfileVersion,
                9d,
                exposure.ConservativeFallVolume,
                exposure.RailConstraintSurfaceIds,
                exposure.RequiredCatchmentIds,
                exposure.StructuralBottomClearance,
                "uncertified-player-reaction");
            DungeonFallCatchmentPlanV2 catchment = source.FallCatchments[0];
            var badFallback = new DungeonFallCatchmentPlanV2(
                catchment.Id,
                catchment.Kind,
                catchment.RegionId,
                catchment.Volume,
                catchment.SafeSurfaceIds,
                catchment.SafeAnchorId,
                catchment.CoveredExposureIds,
                source.Bounds.Minimum.Y);
            DungeonPlanV2 invalid = Rebuild(
                source,
                exposures: source.FallExposures.Select(value => value.Id == exposure.Id ? wrongReaction : value),
                catchments: source.FallCatchments.Select(value => value.Id == catchment.Id ? badFallback : value));

            IReadOnlyList<IndustrialFactoryV2ValidationIssue> issues =
                new DungeonFallCoverageValidatorV2().Validate(invalid);
            AssertCode(issues, "REACTION_ENVELOPE_UNCERTIFIED");
            AssertCode(issues, "FALLBACK_PLANE_NOT_OUTSIDE_CATCHMENT");
        }

        [Test]
        public void FallValidatorRejectsHoledLandingFootprintEvenWhenSafeAnchorFits()
        {
            DungeonPlanV2 source = Generate("fall-hole-negative-contract");
            DungeonFallCatchmentPlanV2 catchment = DungeonV2SemanticFixtureQueries.HazardCatchment(source);
            DungeonSurfacePlanV2 original = DungeonV2SemanticFixtureQueries.PrimarySafeCatchmentSurface(
                source,
                catchment);
            DungeonAnchorPlanV2 safeAnchor = source.Anchors.Single(value => value.Id == catchment.SafeAnchorId);
            double minimumX = catchment.Volume.HorizontalVertices.Min(value => value.X);
            double maximumX = catchment.Volume.HorizontalVertices.Max(value => value.X);
            double minimumZ = catchment.Volume.HorizontalVertices.Min(value => value.Z);
            double maximumZ = catchment.Volume.HorizontalVertices.Max(value => value.Z);
            double split = safeAnchor.Position.X;
            DungeonSurfacePlanV2 left = ReplaceSurfaceVolume(
                original,
                Box(minimumX, split + 0.6d, original.Volume.MinimumY, original.Volume.MaximumY, minimumZ, maximumZ));
            var right = new DungeonSurfacePlanV2(
                "surface-test-safe-right",
                original.ModuleInstanceId,
                original.RegionId,
                DungeonSurfaceKindV2.Walkable,
                Box(split + 2.6d, maximumX, original.Volume.MinimumY, original.Volume.MaximumY, minimumZ, maximumZ),
                original.MaterialProfileId,
                true,
                true,
                original.ActivePredicate,
                original.ControllerId);
            var holedCatchment = new DungeonFallCatchmentPlanV2(
                catchment.Id,
                catchment.Kind,
                catchment.RegionId,
                catchment.Volume,
                new[] { left.Id, right.Id },
                catchment.SafeAnchorId,
                catchment.CoveredExposureIds,
                catchment.StructuralBottomY);
            DungeonPlanV2 invalid = Rebuild(
                source,
                surfaces: source.Surfaces.Select(value => value.Id == original.Id ? left : value).Concat(new[] { right }),
                catchments: source.FallCatchments.Select(value => value.Id == catchment.Id ? holedCatchment : value));

            IReadOnlyList<IndustrialFactoryV2ValidationIssue> issues =
                new DungeonFallCoverageValidatorV2().Validate(invalid);
            Assert.That(issues.Select(value => value.Code), Does.Not.Contain("SAFE_PAD_CAPSULE_EROSION_FAILED"));
            AssertCode(issues, "CATCHMENT_LANDING_FOOTPRINT_UNCOVERED");
        }

        [Test]
        public void FallValidatorRejectsMissingAndTruncatedMovingPlatformSweep()
        {
            DungeonPlanV2 source = Generate("moving-platform-negative-contract");
            DungeonFallExposurePlanV2 platformExposure = source.FallExposures.First();
            DungeonSurfacePlanV2 original = source.Surfaces.Single(value =>
                string.Equals(value.Id, platformExposure.SourceSurfaceId, StringComparison.Ordinal));
            var platform = new DungeonSurfacePlanV2(
                original.Id,
                original.ModuleInstanceId,
                original.RegionId,
                DungeonSurfaceKindV2.MovingPlatform,
                original.Volume,
                original.MaterialProfileId,
                original.IsStructural,
                original.IsWalkable,
                original.ActivePredicate,
                original.ControllerId,
                original.Source);

            DungeonPlanV2 missing = Rebuild(
                source,
                surfaces: source.Surfaces.Select(value => value.Id == platform.Id ? platform : value));
            AssertCode(new DungeonFallCoverageValidatorV2().Validate(missing), "MOVING_PLATFORM_SWEEP_UNCOVERED");

            DungeonConvexPrismV2 truncatedSource = Box(
                platform.Volume.HorizontalVertices.Min(value => value.X) + 0.5d,
                platform.Volume.HorizontalVertices.Max(value => value.X) - 0.5d,
                platform.Volume.MinimumY,
                platform.Volume.MaximumY,
                platform.Volume.HorizontalVertices.Min(value => value.Z) + 0.5d,
                platform.Volume.HorizontalVertices.Max(value => value.Z) - 0.5d);
            var truncatedExposure = new DungeonFallExposurePlanV2(
                platformExposure.Id,
                platformExposure.SourceRegionId,
                platformExposure.SourceSurfaceId,
                truncatedSource,
                platformExposure.Causes | DungeonFallExposureCauseV2.MovingSurfaceFailure,
                platformExposure.MovementProfileVersion,
                platformExposure.MaximumHorizontalDisplacement,
                platformExposure.ConservativeFallVolume,
                platformExposure.RailConstraintSurfaceIds,
                platformExposure.RequiredCatchmentIds,
                platformExposure.StructuralBottomClearance,
                platformExposure.ReactionEnvelopeId);
            DungeonPlanV2 truncated = Rebuild(
                source,
                surfaces: source.Surfaces.Select(value => value.Id == platform.Id ? platform : value),
                exposures: source.FallExposures.Select(value =>
                    value.Id == platformExposure.Id ? truncatedExposure : value));
            AssertCode(new DungeonFallCoverageValidatorV2().Validate(truncated), "MOVING_PLATFORM_SWEEP_TRUNCATED");
        }

        [Test]
        public void ValidatorRejectsEncounterFootprintOnOnlySafePad()
        {
            DungeonPlanV2 source = Generate("encounter-clearance-negative-contract");
            DungeonAnchorPlanV2 encounter = source.Anchors.First(value =>
                value.Kind == DungeonAnchorKindV2.Encounter
                && source.Anchors.Any(other => other.RegionId == value.RegionId
                    && other.Kind == DungeonAnchorKindV2.Safe));
            DungeonAnchorPlanV2 safe = source.Anchors.Single(value =>
                value.RegionId == encounter.RegionId
                && value.Kind == DungeonAnchorKindV2.Safe);
            var blockingEncounter = new DungeonAnchorPlanV2(
                encounter.Id,
                encounter.ModuleInstanceId,
                encounter.RegionId,
                encounter.Kind,
                safe.Position,
                encounter.ProfileId);
            DungeonPlanV2 invalid = Rebuild(
                source,
                anchors: source.Anchors.Select(value =>
                    value.Id == encounter.Id ? blockingEncounter : value));

            IndustrialFactoryV2ValidationResult result =
                new IndustrialFactoryV2Validator().Validate(invalid);
            AssertCode(result.Errors, "ENCOUNTER_FOOTPRINT_BLOCKS_CRITICAL_ANCHOR");
        }

        private static DungeonPlanV2 Generate(string seed)
        {
            return new IndustrialFactoryV2Generator().Generate(seed);
        }

        private static DungeonPlanV2 Rebuild(
            DungeonPlanV2 source,
            IEnumerable<DungeonAnchorPlanV2> anchors = null,
            IEnumerable<DungeonTraversalEdgePlanV2> traversalEdges = null,
            IEnumerable<DungeonExplorationRoutePlanV2> routes = null,
            IEnumerable<DungeonDiscoveryPlanV2> discoveries = null,
            IEnumerable<DungeonSurfacePlanV2> surfaces = null,
            IEnumerable<DungeonEnvironmentControllerPlanV2> controllers = null,
            IEnumerable<DungeonFallCatchmentPlanV2> catchments = null,
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
                traversalEdges ?? source.TraversalEdges,
                routes ?? source.Routes,
                discoveries ?? source.Discoveries,
                source.Shortcuts,
                surfaces ?? source.Surfaces,
                source.FluidZones,
                source.FluidNetworks,
                controllers ?? source.EnvironmentControllers,
                catchments ?? source.FallCatchments,
                exposures ?? source.FallExposures,
                source.GameplayBeats,
                source.AbstractRouteGraph,
                source.BeatAssignments,
                source.MiniDungeonCompositions);
        }

        private static DungeonSurfacePlanV2 ReplaceSurfaceVolume(
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
                source.ControllerId);
        }

        private static DungeonConvexPrismV2 Prism(DungeonBounds3 bounds, double minimumY, double maximumY)
        {
            return Box(
                bounds.Minimum.X,
                bounds.Maximum.X,
                minimumY,
                maximumY,
                bounds.Minimum.Z,
                bounds.Maximum.Z);
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

        private static bool RequiresState(DungeonAccessPredicateV2 predicate, string stateId)
        {
            return predicate.Clauses.Count > 0 && predicate.Clauses.All(clause => clause.Conditions.Any(condition =>
                condition.Kind == DungeonPredicateConditionKindV2.ControllerState
                && condition.Operator == DungeonPredicateOperatorV2.Equals
                && string.Equals(
                    condition.SubjectId,
                    IndustrialFactoryV2Ruleset.WaterRoutingControllerId,
                    StringComparison.Ordinal)
                && string.Equals(condition.ExpectedValue, stateId, StringComparison.Ordinal)));
        }

        private static bool IsHazard(DungeonBiomeDistrictPlanV2 district)
        {
            return district.Kind == DungeonBiomeDistrictKindV2.MagmaUndercroft
                || district.Kind == DungeonBiomeDistrictKindV2.ElectricalUndercroft;
        }

        private static void AssertCode(
            IEnumerable<IndustrialFactoryV2ValidationIssue> issues,
            string expectedCode)
        {
            Assert.That(issues.Select(value => value.Code), Does.Contain(expectedCode),
                string.Join(" | ", issues.Select(value => value.ToString())));
        }

        private static string Describe(IndustrialFactoryV2ValidationResult result)
        {
            return string.Join(" | ", result.Errors.Select(value => value.ToString()));
        }
    }
}
