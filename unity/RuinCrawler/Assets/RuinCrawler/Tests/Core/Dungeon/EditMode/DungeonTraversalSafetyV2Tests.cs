using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace RuinCrawler.Core.Dungeon.V2.Tests
{
    public sealed class DungeonTraversalSafetyV2Tests
    {
        [Test]
        public void CertifiedMarginsAndReactionEnvelopeRemainFrozen()
        {
            Assert.That(DungeonTraversalUtilizationPolicyV2.RequiredHorizontalRatio, Is.EqualTo(0.85d));
            Assert.That(DungeonTraversalUtilizationPolicyV2.RequiredVerticalRatio, Is.EqualTo(0.90d));
            Assert.That(DungeonTraversalUtilizationPolicyV2.OptionalHorizontalRatio, Is.EqualTo(0.95d));
            Assert.That(DungeonTraversalUtilizationPolicyV2.OptionalVerticalRatio, Is.EqualTo(0.95d));
            Assert.That(DungeonTraversalUtilizationPolicyV2.SafeDropDistance, Is.EqualTo(6d));

            DungeonReactionEnvelopeV2 reaction = DungeonReactionEnvelopesV2.PlayerKnockback;
            Assert.That(reaction.StrengthMultiplier, Is.EqualTo(1.5d));
            Assert.That(reaction.MaximumHorizontalSpeed, Is.EqualTo(8.1d));
            Assert.That(reaction.UpwardVelocity, Is.EqualTo(6.37d));
            Assert.That(reaction.RiseGravity, Is.EqualTo(12.5d));
            Assert.That(reaction.FallMultiplier, Is.EqualTo(1.08d));
            Assert.That(reaction.FallGravity, Is.EqualTo(13.5d));
            Assert.That(reaction.MaximumRiseHeight, Is.EqualTo(6.37d * 6.37d / 25d).Within(1e-12d));
        }

        [Test]
        public void GeneratedJumpAndDropGeometryRespectsReservedMargins()
        {
            DungeonPlanV2 plan = GenerateWithJumpOrDrop("traversal-margin-golden");
            DungeonTraversalEdgePlanV2[] certifiedEdges = plan.TraversalEdges
                .Where(value => value.Kind == DungeonConnectorKindV2.Jump
                    || value.Kind == DungeonConnectorKindV2.Drop)
                .ToArray();

            Assert.That(certifiedEdges, Is.Not.Empty);
            foreach (DungeonTraversalEdgePlanV2 edge in certifiedEdges)
            {
                Assert.That(
                    DungeonTraversalGeometryV2.TryMeasure(plan, edge, out DungeonTraversalEdgeGeometryV2 geometry),
                    Is.True,
                    edge.Id);
                if (edge.Kind == DungeonConnectorKindV2.Drop)
                {
                    Assert.That(
                        geometry.VerticalDrop,
                        Is.LessThanOrEqualTo(DungeonTraversalUtilizationPolicyV2.SafeDropDistance + 1e-9d),
                        edge.Id);
                    continue;
                }

                double horizontalRatio = geometry.IsOptional ? 0.95d : 0.85d;
                double verticalRatio = geometry.IsOptional ? 0.95d : 0.90d;
                Assert.That(
                    geometry.HorizontalGap,
                    Is.LessThanOrEqualTo(geometry.MaximumHorizontalJumpDistance * horizontalRatio + 1e-9d),
                    edge.Id);
                Assert.That(
                    geometry.VerticalRise,
                    Is.LessThanOrEqualTo(geometry.Profile.MaximumLedgeCatchRise * verticalRatio + 1e-9d),
                    edge.Id);
            }

            IReadOnlyList<IndustrialFactoryV2ValidationIssue> issues =
                new DungeonTraversalEnvelopeValidatorV2().Validate(plan);
            Assert.That(issues, Is.Empty, Describe(issues));
        }

        [Test]
        public void GeometryValidatorRejectsRequiredJumpBeyondHorizontalReserve()
        {
            DungeonPlanV2 source = new IndustrialFactoryV2Generator().Generate("required-jump-negative");
            DungeonRegionPlanV2 from = source.Regions.Single(value => value.Id == source.EntranceRegionId);
            DungeonRegionPlanV2 to = source.Regions.Single(value => value.Id == source.ExtractionRegionId);
            DungeonAnchorPlanV2 fromAnchor = source.Anchors.First(value =>
                value.RegionId == from.Id && value.Kind == DungeonAnchorKindV2.Entry);
            DungeonAnchorPlanV2 toAnchor = source.Anchors.First(value =>
                value.RegionId == to.Id && value.Kind == DungeonAnchorKindV2.Entry);
            var impossible = new DungeonTraversalEdgePlanV2(
                "edge-test-required-jump-over-budget",
                from.Id,
                to.Id,
                fromAnchor.Id,
                toAnchor.Id,
                DungeonConnectorKindV2.Jump,
                DungeonAccessPredicateV2.Always,
                false);
            DungeonPlanV2 invalid = Rebuild(
                source,
                traversalEdges: source.TraversalEdges.Concat(new[] { impossible }));

            IReadOnlyList<IndustrialFactoryV2ValidationIssue> issues =
                new DungeonTraversalEnvelopeValidatorV2().Validate(invalid);
            Assert.That(issues.Select(value => value.Code),
                Does.Contain("REQUIRED_JUMP_HORIZONTAL_MARGIN_EXCEEDED"));
        }

        [Test]
        public void GeometryValidatorRejectsGeneratedDropBeyondSixUnits()
        {
            DungeonPlanV2 source = GenerateWithJumpOrDrop("safe-drop-negative", requireDrop: true);
            DungeonTraversalEdgePlanV2 authoredDrop = source.TraversalEdges.First(value =>
                value.Kind == DungeonConnectorKindV2.Drop);
            DungeonRegionPlanV2 from = source.Regions.Single(value => value.Id == authoredDrop.FromRegionId);
            DungeonRegionPlanV2 to = source.Regions.Single(value => value.Id == authoredDrop.ToRegionId);
            DungeonAnchorPlanV2 fromAnchor = source.Anchors.Single(value => value.Id == authoredDrop.FromAnchorId);
            DungeonAnchorPlanV2 toAnchor = source.Anchors.Single(value => value.Id == authoredDrop.ToAnchorId);
            Assert.That(
                DungeonTraversalGeometryV2.TryMeasure(source, authoredDrop, out DungeonTraversalEdgeGeometryV2 geometry),
                Is.True);
            double displacement = DungeonTraversalUtilizationPolicyV2.SafeDropDistance
                - geometry.VerticalDrop + 0.01d;
            var unsafeDrop = new DungeonTraversalEdgePlanV2(
                "edge-test-drop-over-budget",
                from.Id,
                to.Id,
                fromAnchor.Id,
                toAnchor.Id,
                DungeonConnectorKindV2.Drop,
                DungeonAccessPredicateV2.Always,
                false);
            DungeonPlanV2 invalid = Rebuild(
                source,
                traversalEdges: source.TraversalEdges.Concat(new[] { unsafeDrop }),
                anchors: source.Anchors.Select(value =>
                    value.Id == toAnchor.Id
                        ? ShiftAnchorY(value, -displacement)
                        : value),
                surfaces: source.Surfaces.Select(value =>
                    value.RegionId == to.Id && value.IsWalkable && value.Kind != DungeonSurfaceKindV2.Hazard
                        ? ReplaceSurfaceVolume(
                            value,
                            new DungeonConvexPrismV2(
                                value.Volume.HorizontalVertices,
                                value.Volume.MinimumY - displacement,
                                value.Volume.MaximumY - displacement))
                        : value));

            IReadOnlyList<IndustrialFactoryV2ValidationIssue> issues =
                new DungeonTraversalEnvelopeValidatorV2().Validate(invalid);
            Assert.That(issues.Select(value => value.Code), Does.Contain("SAFE_DROP_ENVELOPE_EXCEEDED"));
        }

        [Test]
        public void SixScenarioCorpusIsDeterministicAtThirtySixtyAndOneTwentyHertz()
        {
            foreach (DungeonTraversalTrajectoryKindV2 kind in Enum.GetValues(typeof(DungeonTraversalTrajectoryKindV2)))
            foreach (int frequency in new[] { 30, 60, 120 })
            {
                DungeonTraversalTrajectoryV2 first = DungeonTraversalTrajectoryCorpusV2.Create(
                    kind,
                    frequency,
                    sourceY: 6.25d,
                    landingY: 0d,
                    TraversalProfilesV2.Dry);
                DungeonTraversalTrajectoryV2 second = DungeonTraversalTrajectoryCorpusV2.Create(
                    kind,
                    frequency,
                    sourceY: 6.25d,
                    landingY: 0d,
                    TraversalProfilesV2.Dry);

                Assert.That(second.Duration, Is.EqualTo(first.Duration), kind + " @ " + frequency);
                Assert.That(second.MaximumVerticalPosition, Is.EqualTo(first.MaximumVerticalPosition));
                Assert.That(second.FinalHorizontalDisplacement, Is.EqualTo(first.FinalHorizontalDisplacement));
                Assert.That(second.Samples.Count, Is.EqualTo(first.Samples.Count));
                for (int index = 0; index < first.Samples.Count; index += 1)
                {
                    Assert.That(second.Samples[index].Time, Is.EqualTo(first.Samples[index].Time));
                    Assert.That(second.Samples[index].HorizontalDisplacement,
                        Is.EqualTo(first.Samples[index].HorizontalDisplacement));
                    Assert.That(second.Samples[index].VerticalPosition,
                        Is.EqualTo(first.Samples[index].VerticalPosition));
                    Assert.That(second.Samples[index].Phase, Is.EqualTo(first.Samples[index].Phase));
                }
            }
        }

        [Test]
        public void AnalyticCorpusEndpointsAreFrequencyIndependentAndKnockbackUsesSpeed()
        {
            foreach (DungeonTraversalTrajectoryKindV2 kind in Enum.GetValues(typeof(DungeonTraversalTrajectoryKindV2)))
            {
                DungeonTraversalTrajectoryV2[] rates = new[] { 30, 60, 120 }
                    .Select(frequency => DungeonTraversalTrajectoryCorpusV2.Create(
                        kind,
                        frequency,
                        sourceY: 6.25d,
                        landingY: 0d,
                        TraversalProfilesV2.Dry))
                    .ToArray();
                Assert.That(rates.Select(value => value.Duration).Distinct().Count(), Is.EqualTo(1), kind.ToString());
                Assert.That(rates.Select(value => value.MaximumVerticalPosition).Distinct().Count(), Is.EqualTo(1));
                Assert.That(rates.Select(value => value.FinalHorizontalDisplacement).Distinct().Count(), Is.EqualTo(1));
                Assert.That(rates.All(value => Math.Abs(value.Samples[value.Samples.Count - 1].VerticalPosition) <= 1e-12d),
                    Is.True);
            }

            DungeonTraversalTrajectoryV2 knockback = DungeonTraversalTrajectoryCorpusV2.Create(
                DungeonTraversalTrajectoryKindV2.MaximumKnockback,
                60,
                sourceY: 6.25d,
                landingY: 0d,
                TraversalProfilesV2.Dry);
            Assert.That(
                knockback.FinalHorizontalDisplacement,
                Is.EqualTo(DungeonReactionEnvelopesV2.PlayerKnockback.MaximumHorizontalSpeed * knockback.Duration)
                    .Within(1e-12d));
        }

        [Test]
        public void AcceptedPlanCorpusStaysInsideCertifiedVolumesAndNeverReachesFallback()
        {
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate("trajectory-fallback-exclusion-golden");
            IReadOnlyList<IndustrialFactoryV2ValidationIssue> corpusIssues =
                new DungeonTraversalCorpusValidatorV2().Validate(plan);
            IReadOnlyList<IndustrialFactoryV2ValidationIssue> fallIssues =
                new DungeonFallCoverageValidatorV2().Validate(plan);

            Assert.That(corpusIssues, Is.Empty, Describe(corpusIssues));
            Assert.That(fallIssues, Is.Empty, Describe(fallIssues));
        }

        [Test]
        public void ExactTerminalProofRejectsNarrowColliderHoleBetweenGridLocations()
        {
            DungeonPlanV2 source = new IndustrialFactoryV2Generator().Generate("exact-terminal-hole-negative");
            DungeonFallCatchmentPlanV2 catchment = DungeonV2SemanticFixtureQueries.HazardCatchment(source);
            DungeonSurfacePlanV2 original = DungeonV2SemanticFixtureQueries.PrimarySafeCatchmentSurface(
                source,
                catchment);
            double minimumX = catchment.Volume.HorizontalVertices.Min(value => value.X);
            double maximumX = catchment.Volume.HorizontalVertices.Max(value => value.X);
            double minimumZ = catchment.Volume.HorizontalVertices.Min(value => value.Z);
            double maximumZ = catchment.Volume.HorizontalVertices.Max(value => value.Z);
            // Deliberately avoid every point in the retired 8x8 grid. Exact
            // subtraction must still retain this 0.02-unit positive-area hole.
            double gapStart = minimumX + 2.137d;
            double gapEnd = gapStart + 0.02d;
            DungeonSurfacePlanV2 left = ReplaceSurfaceVolume(
                original,
                Box(minimumX, gapStart, original.Volume.MinimumY, original.Volume.MaximumY, minimumZ, maximumZ));
            var right = new DungeonSurfacePlanV2(
                "surface-test-exact-terminal-right",
                original.ModuleInstanceId,
                original.RegionId,
                DungeonSurfaceKindV2.Walkable,
                Box(gapEnd, maximumX, original.Volume.MinimumY, original.Volume.MaximumY, minimumZ, maximumZ),
                original.MaterialProfileId,
                true,
                true,
                original.ActivePredicate,
                original.ControllerId);
            var holed = new DungeonFallCatchmentPlanV2(
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
                catchments: source.FallCatchments.Select(value => value.Id == catchment.Id ? holed : value));

            IReadOnlyList<IndustrialFactoryV2ValidationIssue> issues =
                new DungeonFallCoverageValidatorV2().Validate(invalid);
            Assert.That(issues.Select(value => value.Code),
                Does.Contain("FALL_TERMINAL_FOOTPRINT_UNCOVERED"));
            Assert.That(issues.Select(value => value.Code),
                Does.Contain("CATCHMENT_LANDING_FOOTPRINT_UNCOVERED"));
            Assert.That(issues.Select(value => value.Code),
                Does.Not.Contain("SAFE_PAD_CAPSULE_EROSION_FAILED"));
        }

        [Test]
        public void ExactTerminalProofRejectsCatchmentErasedByCapsuleErosion()
        {
            DungeonPlanV2 source = new IndustrialFactoryV2Generator().Generate("capsule-erosion-negative");
            DungeonFallCatchmentPlanV2 catchment = DungeonV2SemanticFixtureQueries.HazardCatchment(source);
            DungeonAnchorPlanV2 anchor = source.Anchors.Single(value => value.Id == catchment.SafeAnchorId);
            double minimumZ = catchment.Volume.HorizontalVertices.Min(value => value.Z);
            double maximumZ = catchment.Volume.HorizontalVertices.Max(value => value.Z);
            var tooNarrow = new DungeonFallCatchmentPlanV2(
                catchment.Id,
                catchment.Kind,
                catchment.RegionId,
                Box(
                    anchor.Position.X - 0.4d,
                    anchor.Position.X + 0.4d,
                    catchment.Volume.MinimumY,
                    catchment.Volume.MaximumY,
                    minimumZ,
                    maximumZ),
                catchment.SafeSurfaceIds,
                catchment.SafeAnchorId,
                catchment.CoveredExposureIds,
                catchment.StructuralBottomY);
            DungeonPlanV2 invalid = Rebuild(
                source,
                catchments: source.FallCatchments.Select(value => value.Id == catchment.Id ? tooNarrow : value));

            IReadOnlyList<IndustrialFactoryV2ValidationIssue> issues =
                new DungeonFallCoverageValidatorV2().Validate(invalid);
            Assert.That(issues.Select(value => value.Code),
                Does.Contain("CATCHMENT_CAPSULE_FOOTPRINT_ERODED_AWAY"));
            Assert.That(issues.Select(value => value.Code), Does.Contain("FALL_VOLUME_MISSES_CATCHMENT"));
        }

        private static string Describe(IEnumerable<IndustrialFactoryV2ValidationIssue> issues)
        {
            return string.Join(" | ", issues.Select(value => value.ToString()));
        }

        private static DungeonPlanV2 GenerateWithJumpOrDrop(
            string seedPrefix,
            bool requireDrop = false)
        {
            for (int index = 0; index < 64; index += 1)
            {
                DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate(seedPrefix + "-" + index);
                if (plan.TraversalEdges.Any(value => requireDrop
                        ? value.Kind == DungeonConnectorKindV2.Drop
                        : value.Kind == DungeonConnectorKindV2.Jump
                            || value.Kind == DungeonConnectorKindV2.Drop))
                {
                    return plan;
                }
            }

            throw new AssertionException("The deterministic authored corpus contains no required jump/drop fixture.");
        }

        private static DungeonPlanV2 Rebuild(
            DungeonPlanV2 source,
            IEnumerable<DungeonTraversalEdgePlanV2> traversalEdges = null,
            IEnumerable<DungeonAnchorPlanV2> anchors = null,
            IEnumerable<DungeonSurfacePlanV2> surfaces = null,
            IEnumerable<DungeonFallCatchmentPlanV2> catchments = null)
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
                source.Routes,
                source.Discoveries,
                source.Shortcuts,
                surfaces ?? source.Surfaces,
                source.FluidZones,
                source.FluidNetworks,
                source.EnvironmentControllers,
                catchments ?? source.FallCatchments,
                source.FallExposures,
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
                source.ControllerId,
                source.Source);
        }

        private static DungeonAnchorPlanV2 ShiftAnchorY(DungeonAnchorPlanV2 source, double deltaY)
        {
            return new DungeonAnchorPlanV2(
                source.Id,
                source.ModuleInstanceId,
                source.RegionId,
                source.Kind,
                new DungeonPoint3(
                    source.Position.X,
                    source.Position.Y + deltaY,
                    source.Position.Z),
                source.ProfileId,
                source.Source);
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
    }
}
