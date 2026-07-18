using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using RuinCrawler.Core.Dungeon.V2;

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
            Assert.That(plan.Modules.All(value => value.ConnectorIds.Count == 2), Is.True);
            Assert.That(plan.Modules.All(value => value.RegionIds.Count == 1), Is.True);
            Assert.That(plan.Regions.All(value =>
                value.Source == DungeonSpatialRecordSourceV2.CertifiedModule), Is.True);
            Assert.That(plan.Surfaces.Any(value =>
                value.Source == DungeonSpatialRecordSourceV2.AssemblyAddition), Is.True);
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
        public void RemovedCertifiedAnchorIsRejectedEvenWhenModuleHashStillMatches()
        {
            DungeonPlanV2 source = new IndustrialFactoryV2Generator().Generate("certified-placement-missing-anchor");
            DungeonAnchorPlanV2 anchor = source.Anchors.First(value =>
                value.Source == DungeonSpatialRecordSourceV2.CertifiedModule
                && value.Kind == DungeonAnchorKindV2.Safe
                && source.FallCatchments.All(catchment => catchment.SafeAnchorId != value.Id));
            DungeonModuleInstancePlanV2 module = source.Modules.Single(value => value.Id == anchor.ModuleInstanceId);
            DungeonModuleInstancePlanV2 changedModule = CopyModule(
                module,
                anchorIds: module.AnchorIds.Where(value => value != anchor.Id));
            DungeonPlanV2 invalid = Rebuild(
                source,
                modules: source.Modules.Select(value => value.Id == module.Id ? changedModule : value),
                anchors: source.Anchors.Where(value => value.Id != anchor.Id));

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
                connector.Source);

            AssertCode(
                DungeonCertifiedModulePlacementValidatorV2.Validate(Rebuild(
                    source,
                    connectors: source.Connectors.Select(value => value.Id == connector.Id ? changed : value))),
                "CERTIFIED_CONNECTOR_PLACEMENT_MISMATCH");
        }

        [Test]
        public void CredentialTowerCertifiedBakeContainsNoFloorBehindCrumblePlate()
        {
            foreach (IndustrialFactoryV2ModuleDefinition definition in
                IndustrialFactoryV2ModuleCatalog.Definitions.Where(value =>
                    value.TemplateId.StartsWith("factory-credentialtower-", System.StringComparison.Ordinal)))
            {
                Assert.That(definition.CertifiedGeometry.Surfaces.Select(value => value.Id),
                    Does.Not.Contain("floor"), definition.TemplateId);
                Assert.That(definition.CertifiedGeometry.Surfaces.Select(value => value.Id),
                    Does.Contain("tower-floor-north"), definition.TemplateId);
            }

            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate("credential-crumble-certified-gap");
            DungeonSurfacePlanV2 crumble = plan.Surfaces.Single(value =>
                value.Id == IndustrialFactoryV2Ruleset.CredentialCrumbleSurfaceId);
            Assert.That(crumble.Source, Is.EqualTo(DungeonSpatialRecordSourceV2.AssemblyAddition));
            Assert.That(plan.Surfaces.Where(value =>
                    value.ModuleInstanceId == crumble.ModuleInstanceId
                    && value.Source == DungeonSpatialRecordSourceV2.CertifiedModule)
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
                anchorIds ?? source.AnchorIds);
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
                source.FallExposures);
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
