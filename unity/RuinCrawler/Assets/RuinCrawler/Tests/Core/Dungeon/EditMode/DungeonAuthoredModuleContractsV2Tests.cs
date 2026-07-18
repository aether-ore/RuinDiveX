using System;
using System.Linq;
using NUnit.Framework;

namespace RuinCrawler.Core.Dungeon.V2.Tests
{
    public sealed class DungeonAuthoredModuleContractsV2Tests
    {
        [Test]
        public void ContractVersionsIdentifyAuthoredCompositionCutover()
        {
            Assert.That(DungeonPlanV2.CurrentSchemaVersion, Is.EqualTo(3));
            Assert.That(CertifiedDungeonModuleGeometryV2.CurrentSchemaVersion, Is.EqualTo(2));
            Assert.That(IndustrialFactoryV2Ruleset.ContractVersion, Is.EqualTo(3));
            Assert.That(IndustrialFactoryV2Ruleset.ContentPackVersion,
                Is.EqualTo("industrial-factory-v2-contracts-v4-authored-composition"));
        }

        [Test]
        public void ModuleTransformSupportsOnlyTranslationAndQuarterTurnYaw()
        {
            var transform = new DungeonModuleTransformV2(new DungeonPoint3(10d, 2d, -4d), 5);
            Assert.That(transform.QuarterTurns, Is.EqualTo(1));
            Assert.That(transform.TransformPoint(new DungeonPoint3(3d, 1d, 2d)),
                Is.EqualTo(new DungeonPoint3(12d, 3d, -7d)));
            Assert.That(transform.TransformDirection(new DungeonPoint3(1d, 0d, 0d)),
                Is.EqualTo(new DungeonPoint3(0d, 0d, -1d)));
            Assert.That(transform.InverseTransformPoint(transform.TransformPoint(new DungeonPoint3(3d, 1d, 2d))),
                Is.EqualTo(new DungeonPoint3(3d, 1d, 2d)));
            Assert.That(typeof(DungeonModuleTransformV2).GetProperty("Scale"), Is.Null,
                "Certified module scale must not exist in the public contract.");
        }

        [Test]
        public void StaticFixtureContainsTwelveFamiliesAndTwoTopologyVariantsEach()
        {
            Assert.That(IndustrialFactoryV2ModuleCatalog.Definitions, Has.Count.EqualTo(24));
            var families = IndustrialFactoryV2ModuleCatalog.Definitions
                .GroupBy(value => value.Composition.Archetype)
                .ToArray();
            Assert.That(families, Has.Length.EqualTo(12));
            foreach (var family in families)
            {
                IndustrialFactoryV2ModuleDefinition[] variants = family.ToArray();
                Assert.That(variants.Select(value => value.VariantId), Is.EquivalentTo(new[]
                {
                    IndustrialFactoryV2ModuleCatalog.VariantA,
                    IndustrialFactoryV2ModuleCatalog.VariantB
                }), family.Key.ToString());
                Assert.That(variants.Select(value => value.TopologySignature).Distinct().Count(),
                    Is.EqualTo(2), family.Key + " variants must be topology-distinct.");
                Assert.That(variants.All(value => value.TemplateId.IndexOf(' ') < 0), Is.True);
                Assert.That(variants.All(value => value.DescriptorId == "descriptor-" + value.TemplateId), Is.True);
                Assert.That(variants.All(value => value.Composition.Id.StartsWith("composition-", StringComparison.Ordinal)), Is.True);
                Assert.That(variants.All(value => value.GeometryRevisionHash.StartsWith("sha256:", StringComparison.Ordinal)), Is.True);
                Assert.That(variants.All(value => value.PresentationDependencyHash.StartsWith("sha256:", StringComparison.Ordinal)), Is.True);
                Assert.That(variants.All(value => value.CombinedRevisionHash.StartsWith("sha256:", StringComparison.Ordinal)), Is.True);
            }
            Assert.That(families.Select(value => value.Key), Does.Contain(DungeonModuleArchetypeV2.SurveillanceControlTheater));
        }

        [Test]
        public void EveryAuthoredPlatformPurposeHasTheRequiredTargetPolicy()
        {
            foreach (IndustrialFactoryV2ModuleDefinition definition in IndustrialFactoryV2ModuleCatalog.Definitions)
            foreach (DungeonPlatformPurposeBindingV2 binding in definition.Composition.PlatformPurposes)
            {
                Assert.That(binding.IsWalkable,
                    Is.EqualTo(binding.Purpose != DungeonPlatformPurposeV2.ObservationOnly));
                Assert.That(binding.TargetId, Is.Not.Null);
            }

            Assert.Throws<ArgumentException>(() => new DungeonPlatformPurposeBindingV2(
                "observation",
                DungeonPlatformPurposeV2.ObservationOnly,
                "must-not-bind"));
            Assert.Throws<ArgumentException>(() => new DungeonPlatformPurposeBindingV2(
                "critical",
                DungeonPlatformPurposeV2.CriticalTraverse));
        }

        [Test]
        public void CertifiedRampsAndConnectorPortalPayloadSurviveQuarterTurnPlacement()
        {
            IndustrialFactoryV2ModuleDefinition definition = IndustrialFactoryV2ModuleCatalog.Definitions.First(value =>
                value.CertifiedGeometry.Surfaces.Any(surface =>
                    surface.ColliderKind == CertifiedDungeonColliderKindV2.RampWedge));
            Assert.That(definition.CertifiedGeometry.Surfaces.Single(surface =>
                surface.ColliderKind == CertifiedDungeonColliderKindV2.RampWedge).RampWedge, Is.Not.Null);

            var bindings = definition.CertifiedGeometry.Regions.Select(region =>
                new DungeonModuleRegionBindingV2(region.Id, "placed-" + region.Id)).ToArray();
            DungeonCertifiedModulePlacementV2 placement = DungeonCertifiedModulePlacementV2.Place(
                definition,
                "module-test",
                bindings,
                new DungeonModuleTransformV2(new DungeonPoint3(20d, 4d, 30d), 1));
            Assert.That(placement.Transform.QuarterTurns, Is.EqualTo(1));
            Assert.That(placement.Connectors.All(value => value.Aperture != null), Is.True);
            Assert.That(placement.Connectors.All(value =>
                value.Aperture.NavigationHandoffProfileId != null
                && value.Aperture.ExteriorGasketProfileId != null
                && value.Aperture.PlayerClearanceVolume != null
                && value.Aperture.CameraClearanceVolume != null
                && value.Aperture.ApproachVolume != null), Is.True);
        }

        [Test]
        public void AbstractRouteValidatorRejectsConnectorReuse()
        {
            DungeonPlanV2 source = new IndustrialFactoryV2Generator().Generate("connector-reuse-contract");
            DungeonAbstractRouteEdgeV2 original = source.AbstractRouteGraph.Edges.First();
            DungeonModuleConnectorPlanV2 from = source.Connectors.Single(value =>
                value.Id == original.FromConnectorId);
            DungeonModuleConnectorPlanV2 to = source.Connectors.Single(value =>
                value.Id == original.ToConnectorId);
            Assert.That(DungeonAbstractRouteSocketValidatorV2.IsExactPair(from, to), Is.True);

            var duplicate = new DungeonAbstractRouteEdgeV2(
                original.Id + "-duplicate",
                original.FromNodeId,
                original.ToNodeId,
                original.Role,
                original.Bidirectional,
                original.FromConnectorId,
                original.ToConnectorId);
            var graph = new DungeonAbstractRouteGraphV2(
                source.AbstractRouteGraph.Nodes,
                source.AbstractRouteGraph.Edges.Concat(new[] { duplicate }));
            DungeonPlanV2 invalid = RebuildWithAbstractRouteGraph(source, graph);

            Assert.That(
                DungeonAbstractRouteSocketValidatorV2.Validate(invalid)
                    .Any(value => value.Code == "ABSTRACT_ROUTE_SOCKET_REUSED"),
                Is.True);
        }

        [Test]
        public void AbstractRouteValidatorRejectsUndeclaredCoincidentSeam()
        {
            DungeonPlanV2 source = new IndustrialFactoryV2Generator().Generate("undeclared-seam-contract");
            DungeonAbstractRouteEdgeV2 removed = source.AbstractRouteGraph.Edges.First(edge =>
                source.MiniDungeonCompositions.All(composition =>
                    composition.LoopOrRejoinEdgeId != edge.Id));
            var graph = new DungeonAbstractRouteGraphV2(
                source.AbstractRouteGraph.Nodes,
                source.AbstractRouteGraph.Edges.Where(value => value.Id != removed.Id));
            DungeonPlanV2 invalid = RebuildWithAbstractRouteGraph(source, graph);

            Assert.That(
                DungeonAbstractRouteSocketValidatorV2.Validate(invalid)
                    .Any(value => value.Code == "ABSTRACT_ROUTE_SOCKET_UNDECLARED_SEAM"),
                Is.True);
        }

        [Test]
        public void MiniDungeonGrammarIsAThreeToFiveModuleComposition()
        {
            Assert.Throws<ArgumentException>(() => new DungeonMiniDungeonCompositionGrammarV2(
                "too-small",
                new[] { "a", "b" },
                new[] { "a", "b" },
                "a",
                "b",
                "mechanism",
                DungeonMiniDungeonMechanismKindV2.VerticalLift,
                true,
                "b",
                "edge-rejoin"));
            Assert.DoesNotThrow(() => new DungeonMiniDungeonCompositionGrammarV2(
                "valid-mini",
                new[] { "a", "b", "c", "d" },
                new[] { "b", "c" },
                "a",
                "d",
                "mechanism",
                DungeonMiniDungeonMechanismKindV2.VerticalWaterRouting,
                true,
                "c",
                "edge-rejoin"));
            Assert.That(IndustrialFactoryV2ModuleCatalog.Definitions.Any(value =>
                value.Composition.SizeClass == DungeonModuleSizeClassV2.MiniDungeon), Is.False,
                "Mini-dungeons are composition grammars, not monolithic module families.");
        }

        private static DungeonPlanV2 RebuildWithAbstractRouteGraph(
            DungeonPlanV2 source,
            DungeonAbstractRouteGraphV2 graph)
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
                source.Surfaces,
                source.FluidZones,
                source.FluidNetworks,
                source.EnvironmentControllers,
                source.FallCatchments,
                source.FallExposures,
                source.GameplayBeats,
                graph,
                source.BeatAssignments,
                source.MiniDungeonCompositions);
        }
    }
}
