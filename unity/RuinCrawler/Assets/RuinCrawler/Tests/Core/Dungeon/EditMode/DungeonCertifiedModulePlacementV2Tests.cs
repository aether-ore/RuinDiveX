using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Core.Dungeon.V2.Tests;

namespace RuinCrawler.Core.Dungeon.Tests
{
    public sealed class DungeonCertifiedModulePlacementV2Tests
    {
        [Test]
        public void GeneratorEmitsExactTranslatedRegionsSurfacesAnchorsAndConnectors()
        {
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate("certified-placement-positive");

            Assert.That(DungeonCertifiedModulePlacementValidatorV2.Validate(plan), Is.Empty);
            Assert.That(plan.Connectors, Is.Not.Empty);
            Assert.That(plan.Connectors.All(value =>
                value.Source == DungeonSpatialRecordSourceV2.CertifiedModule), Is.True);
            Assert.That(plan.Modules.All(value => value.ConnectorIds.Count > 0), Is.True);
            Assert.That(plan.Modules.All(value =>
                value.RegionIds.Count == value.RegionBindings.Count
                && value.RegionIds.Count >= 2), Is.True,
                "Authored modules expose their complete multi-region bake through one-to-one bindings.");
            Assert.That(plan.Regions.All(value =>
                value.Source == DungeonSpatialRecordSourceV2.CertifiedModule), Is.True);
            Assert.That(plan.Surfaces.All(value =>
                value.Source == DungeonSpatialRecordSourceV2.CertifiedModule), Is.True,
                "Production V2 may not synthesize traversal geometry outside the authored prefab bake.");
        }

        [Test]
        public void ShiftedCertifiedSurfaceIsRejectedEvenWhenModuleHashStillMatches()
        {
            DungeonPlanV2 source = new IndustrialFactoryV2Generator().Generate("certified-placement-shifted-surface");
            DungeonSurfacePlanV2 surface = source.Surfaces.First(value =>
                value.Source == DungeonSpatialRecordSourceV2.CertifiedModule);
            DungeonConvexPrismV2 shifted = DungeonCertifiedModulePlacementV2.Translate(
                surface.Volume,
                new DungeonPoint3(0.001d, 0d, 0d));
            var changed = new DungeonSurfacePlanV2(
                surface.Id,
                surface.ModuleInstanceId,
                surface.RegionId,
                surface.Kind,
                shifted,
                surface.MaterialProfileId,
                surface.IsStructural,
                surface.IsWalkable,
                surface.ActivePredicate,
                surface.ControllerId,
                surface.Source);
            DungeonPlanV2 invalid = Rebuild(
                source,
                surfaces: source.Surfaces.Select(value => value.Id == surface.Id ? changed : value));

            AssertCode(
                DungeonCertifiedModulePlacementValidatorV2.Validate(invalid),
                "CERTIFIED_SURFACE_PLACEMENT_MISMATCH");
        }

        [Test]
        public void ShiftedCertifiedAnchorIsRejectedEvenWhenModuleHashStillMatches()
        {
            DungeonPlanV2 source = new IndustrialFactoryV2Generator().Generate("certified-placement-missing-anchor");
            DungeonAnchorPlanV2 anchor = source.Anchors.First(value =>
                value.Source == DungeonSpatialRecordSourceV2.CertifiedModule
                && value.Kind == DungeonAnchorKindV2.Safe
                && source.FallCatchments.All(catchment => catchment.SafeAnchorId != value.Id));
            var shifted = new DungeonAnchorPlanV2(
                anchor.Id,
                anchor.ModuleInstanceId,
                anchor.RegionId,
                anchor.Kind,
                new DungeonPoint3(anchor.Position.X + 0.001d, anchor.Position.Y, anchor.Position.Z),
                anchor.ProfileId,
                anchor.Source);
            DungeonPlanV2 invalid = Rebuild(
                source,
                anchors: source.Anchors.Select(value => value.Id == anchor.Id ? shifted : value));

            AssertCode(
                DungeonCertifiedModulePlacementValidatorV2.Validate(invalid),
                "CERTIFIED_ANCHOR_PLACEMENT_MISMATCH");
        }

        [Test]
        public void RemovedCertifiedConnectorIsRejectedEvenWhenModuleHashStillMatches()
        {
            DungeonPlanV2 source = new IndustrialFactoryV2Generator().Generate("certified-placement-missing-connector");
            DungeonModuleConnectorPlanV2 connector = source.Connectors.First();
            DungeonModuleInstancePlanV2 module = source.Modules.Single(value => value.Id == connector.ModuleInstanceId);
            DungeonModuleInstancePlanV2 changedModule = CopyModule(
                module,
                connectorIds: module.ConnectorIds.Where(value => value != connector.Id));
            DungeonPlanV2 invalid = Rebuild(
                source,
                modules: source.Modules.Select(value => value.Id == module.Id ? changedModule : value),
                connectors: source.Connectors.Where(value => value.Id != connector.Id));

            AssertCode(
                DungeonCertifiedModulePlacementValidatorV2.Validate(invalid),
                "CERTIFIED_CONNECTOR_PLACEMENT_MISMATCH");
        }

        [Test]
        public void StateGatedCertifiedSurfaceIsRejectedEvenWhenGeometryStillMatches()
        {
            DungeonPlanV2 source = new IndustrialFactoryV2Generator().Generate(
                "certified-placement-state-gated-surface");
            DungeonSurfacePlanV2 surface = source.Surfaces.First(value =>
                value.Source == DungeonSpatialRecordSourceV2.CertifiedModule
                && value.Kind != DungeonSurfaceKindV2.Hazard);
            var gatedPredicate = new DungeonAccessPredicateV2(new[]
            {
                new DungeonPredicateClauseV2(new[]
                {
                    new DungeonPredicateConditionV2(
                        DungeonPredicateConditionKindV2.RequiredItem,
                        IndustrialFactoryV2Ruleset.CredentialKeyRewardId,
                        DungeonPredicateOperatorV2.IsPresent)
                })
            });
            var changed = new DungeonSurfacePlanV2(
                surface.Id,
                surface.ModuleInstanceId,
                surface.RegionId,
                surface.Kind,
                surface.Volume,
                surface.MaterialProfileId,
                surface.IsStructural,
                surface.IsWalkable,
                gatedPredicate,
                surface.ControllerId,
                surface.Source);

            AssertCode(
                DungeonCertifiedModulePlacementValidatorV2.Validate(Rebuild(
                    source,
                    surfaces: source.Surfaces.Select(value => value.Id == surface.Id ? changed : value))),
                "CERTIFIED_SURFACE_PLACEMENT_MISMATCH");
        }

        [Test]
        public void ChangedCertifiedHazardControllerIsRejectedEvenWhenGeometryStillMatches()
        {
            DungeonPlanV2 source = new IndustrialFactoryV2Generator().Generate(
                "certified-placement-changed-hazard-controller");
            DungeonSurfacePlanV2 surface = source.Surfaces.First(value =>
                value.Source == DungeonSpatialRecordSourceV2.CertifiedModule
                && value.Kind == DungeonSurfaceKindV2.Hazard);
            var changed = new DungeonSurfacePlanV2(
                surface.Id,
                surface.ModuleInstanceId,
                surface.RegionId,
                surface.Kind,
                surface.Volume,
                surface.MaterialProfileId,
                surface.IsStructural,
                surface.IsWalkable,
                surface.ActivePredicate,
                // Use a real controller so aggregate reference validation
                // succeeds and the certified-placement validator—not the
                // constructor—proves the controller binding mismatch.
                IndustrialFactoryV2Ruleset.WaterRoutingControllerId,
                surface.Source);

            AssertCode(
                DungeonCertifiedModulePlacementValidatorV2.Validate(Rebuild(
                    source,
                    surfaces: source.Surfaces.Select(value => value.Id == surface.Id ? changed : value))),
                "CERTIFIED_SURFACE_PLACEMENT_MISMATCH");
        }

        [Test]
        public void StateGatedCertifiedConnectorIsRejectedEvenWhenSocketStillMatches()
        {
            DungeonPlanV2 source = new IndustrialFactoryV2Generator().Generate(
                "certified-placement-state-gated-connector");
            DungeonModuleConnectorPlanV2 connector = source.Connectors.First();
            var changed = new DungeonModuleConnectorPlanV2(
                connector.Id,
                connector.ModuleInstanceId,
                connector.RegionId,
                connector.Kind,
                connector.Position,
                connector.Facing,
                connector.SocketTag,
                DungeonAccessPredicateV2.Never,
                connector.Source,
                connector.Aperture);

            AssertCode(
                DungeonCertifiedModulePlacementValidatorV2.Validate(Rebuild(
                    source,
                    connectors: source.Connectors.Select(value => value.Id == connector.Id ? changed : value))),
                "CERTIFIED_CONNECTOR_PLACEMENT_MISMATCH");
        }

        [Test]
        public void CredentialBeatCrumbleSurfaceBelongsToItsCertifiedBakeAndHasNoFloorBehindIt()
        {
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate("credential-crumble-certified-gap");
            DungeonRegionPlanV2 credentialRegion = DungeonV2SemanticFixtureQueries.RegionForBeat(
                plan,
                DungeonGameplayBeatKindV2.CredentialTower,
                DungeonBiomeDistrictKindV2.Factory,
                DungeonElevationStratumV2.Entry);
            DungeonSurfacePlanV2 crumble = plan.Surfaces.Single(value =>
                string.Equals(value.RegionId, credentialRegion.Id, System.StringComparison.Ordinal)
                && string.Equals(
                    value.ControllerId,
                    IndustrialFactoryV2Ruleset.CredentialCrumbleControllerId,
                    System.StringComparison.Ordinal));
            Assert.That(crumble.Source, Is.EqualTo(DungeonSpatialRecordSourceV2.CertifiedModule));
            Assert.That(plan.Surfaces.Where(value =>
                    value.ModuleInstanceId == crumble.ModuleInstanceId
                    && value.Source == DungeonSpatialRecordSourceV2.CertifiedModule)
                .Where(value => value.Id != crumble.Id)
                .Any(value => PrismContains(value.Volume, crumble.Volume)), Is.False);
        }

        private static bool PrismContains(DungeonConvexPrismV2 outer, DungeonConvexPrismV2 inner)
        {
            double outerMinX = outer.HorizontalVertices.Min(value => value.X);
            double outerMaxX = outer.HorizontalVertices.Max(value => value.X);
            double outerMinZ = outer.HorizontalVertices.Min(value => value.Z);
            double outerMaxZ = outer.HorizontalVertices.Max(value => value.Z);
            double innerMinX = inner.HorizontalVertices.Min(value => value.X);
            double innerMaxX = inner.HorizontalVertices.Max(value => value.X);
            double innerMinZ = inner.HorizontalVertices.Min(value => value.Z);
            double innerMaxZ = inner.HorizontalVertices.Max(value => value.Z);
            return outerMinX <= innerMinX && outerMaxX >= innerMaxX
                && outerMinZ <= innerMinZ && outerMaxZ >= innerMaxZ
                && outer.MinimumY <= inner.MinimumY && outer.MaximumY >= inner.MaximumY;
        }

        private static DungeonModuleInstancePlanV2 CopyModule(
            DungeonModuleInstancePlanV2 source,
            IEnumerable<string> connectorIds = null,
            IEnumerable<string> anchorIds = null)
        {
            return new DungeonModuleInstancePlanV2(
                source.Id,
                source.TemplateId,
                source.ContentHash,
                source.MacroRoleId,
                source.Bounds,
                source.RegionIds,
                connectorIds ?? source.ConnectorIds,
                anchorIds ?? source.AnchorIds,
                source.Transform,
                source.RegionBindings,
                source.VerticalCompositionId,
                source.VerticalPortalConnectorIds);
        }

        private static DungeonPlanV2 Rebuild(
            DungeonPlanV2 source,
            IEnumerable<DungeonModuleInstancePlanV2> modules = null,
            IEnumerable<DungeonModuleConnectorPlanV2> connectors = null,
            IEnumerable<DungeonAnchorPlanV2> anchors = null,
            IEnumerable<DungeonSurfacePlanV2> surfaces = null)
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
                modules ?? source.Modules,
                connectors ?? source.Connectors,
                anchors ?? source.Anchors,
                source.Regions,
                source.Districts,
                source.TraversalEdges,
                source.Routes,
                source.Discoveries,
                source.Shortcuts,
                surfaces ?? source.Surfaces,
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

        private static void AssertCode(
            IReadOnlyList<IndustrialFactoryV2ValidationIssue> issues,
            string expected)
        {
            Assert.That(issues.Select(value => value.Code), Does.Contain(expected),
                string.Join("\n", issues.Select(value => value.ToString())));
        }
    }
}
