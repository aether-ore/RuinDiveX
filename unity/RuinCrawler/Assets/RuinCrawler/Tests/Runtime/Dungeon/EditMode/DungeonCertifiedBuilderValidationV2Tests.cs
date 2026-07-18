using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using NUnit.Framework;
using RuinCrawler.Core.Dungeon;
using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;
using UnityEngine.TestTools;

namespace RuinCrawler.Runtime.Dungeon.Tests
{
    public sealed class DungeonCertifiedBuilderValidationV2Tests
    {
        private readonly List<UnityEngine.Object> ownedObjects = new List<UnityEngine.Object>();

        [TearDown]
        public void TearDown()
        {
            for (int index = ownedObjects.Count - 1; index >= 0; index -= 1)
            {
                if (ownedObjects[index] != null)
                {
                    UnityEngine.Object.DestroyImmediate(ownedObjects[index]);
                }
            }

            ownedObjects.Clear();
        }

        [Test]
        public void AuthoredRegistryResolvesEveryPlacedModuleFromPureDescriptors()
        {
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate("builder-certified-registry");
            DungeonAuthoredModuleRegistryV2 registry = CreateRegistry(
                plan.Modules.Select(module => IndustrialFactoryV2ModuleCatalog.Require(module.TemplateId)).Distinct());

            foreach (DungeonModuleInstancePlanV2 module in plan.Modules)
                Assert.That(registry.TryResolve(module, out _, out _, out string error), Is.True, error);
            Assert.That(registry.TryBuildPureCatalog(out DungeonAuthoredModuleCatalogV2 catalog, out var errors),
                Is.True,
                string.Join("\n", errors));
            Assert.That(catalog.Definitions.Count, Is.EqualTo(plan.Modules
                .Select(value => value.TemplateId).Distinct().Count()));
        }

        [Test]
        public void AuthoredRegistryRejectsAnyNonCurrentContentPackIdentity()
        {
            DungeonAuthoredModuleRegistryV2 registry =
                Own(ScriptableObject.CreateInstance<DungeonAuthoredModuleRegistryV2>());

            ArgumentException exception = Assert.Throws<ArgumentException>(() =>
                registry.Configure(
                    Array.Empty<DungeonAuthoredModuleEntryV2>(),
                    authoredContractVersion: 3,
                    authoredContentPackId: "industrial-factory-v2-contracts-stale"));

            Assert.That(exception.Message, Does.Contain(IndustrialFactoryV2Ruleset.ContentPackVersion));

            typeof(DungeonAuthoredModuleRegistryV2)
                .GetField("contentPackId",
                    System.Reflection.BindingFlags.Instance
                    | System.Reflection.BindingFlags.NonPublic)
                ?.SetValue(registry, "serialized-stale-pack");
            Assert.That(registry.ValidateCatalogCoverage(out IReadOnlyList<string> errors), Is.False);
            Assert.That(errors.Any(value =>
                    value.Contains(IndustrialFactoryV2Ruleset.ContentPackVersion)),
                Is.True,
                string.Join("\n", errors));
        }

        [Test]
        public void BuilderFailsVisiblyBeforeCreatingRootWhenRegistryIsMissingOrIncomplete()
        {
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate("builder-certified-rejection");
            GameObject host = Own(new GameObject("CertifiedBuilderHost"));
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            builder.ConfigureAuthoredModuleRegistry(null, allowResourceFallback: false);

            LogAssert.Expect(LogType.Error, new Regex(
                @"\[RuinCrawler Dungeon V2\].*Missing authored module registry"));
            Assert.That(builder.TryBuild(plan, null, null, out string missingError), Is.False);
            Assert.That(missingError, Does.Contain("Missing authored module registry"));
            Assert.That(builder.GeneratedRoot, Is.Null);

            IndustrialFactoryV2ModuleDefinition first =
                IndustrialFactoryV2ModuleCatalog.Require(plan.Modules[0].TemplateId);
            DungeonAuthoredModuleRegistryV2 incomplete = CreateRegistry(new[] { first });
            builder.ConfigureAuthoredModuleRegistry(incomplete, allowResourceFallback: false);
            LogAssert.Expect(LogType.Error, new Regex(
                @"\[RuinCrawler Dungeon V2\].*failed production coverage"));
            Assert.That(builder.TryBuild(plan, null, null, out string incompleteError), Is.False);
            Assert.That(incompleteError, Does.Contain("failed production coverage"));
            Assert.That(builder.GeneratedRoot, Is.Null);
        }

        [Test]
        public void BuilderRejectsShiftedCertifiedPlanSurfaceBeforeCreatingSceneRoot()
        {
            DungeonPlanV2 source = new IndustrialFactoryV2Generator().Generate("builder-certified-shifted-surface");
            DungeonSurfacePlanV2 original = source.Surfaces.First(value =>
                value.Source == DungeonSpatialRecordSourceV2.CertifiedModule);
            var shifted = new DungeonSurfacePlanV2(
                original.Id,
                original.ModuleInstanceId,
                original.RegionId,
                original.Kind,
                DungeonCertifiedModulePlacementV2.Translate(
                    original.Volume,
                    new DungeonPoint3(0d, 0d, 0.01d)),
                original.MaterialProfileId,
                original.IsStructural,
                original.IsWalkable,
                original.ActivePredicate,
                original.ControllerId,
                original.Source);
            DungeonPlanV2 invalid = RebuildWithSurfaces(
                source,
                source.Surfaces.Select(value => value.Id == original.Id ? shifted : value));
            DungeonAuthoredModuleRegistryV2 registry = CreateRegistry(
                IndustrialFactoryV2ModuleCatalog.Definitions);
            GameObject host = Own(new GameObject("CertifiedBuilderHost"));
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            builder.ConfigureAuthoredModuleRegistry(registry, allowResourceFallback: false);

            LogAssert.Expect(LogType.Error, new Regex(
                @"\[RuinCrawler Dungeon V2\].*CERTIFIED_SURFACE_PLACEMENT_MISMATCH"));
            Assert.That(builder.TryBuild(invalid, null, null, out string error), Is.False);
            Assert.That(error, Does.Contain("CERTIFIED_SURFACE_PLACEMENT_MISMATCH"));
            Assert.That(builder.GeneratedRoot, Is.Null);
        }

        private DungeonAuthoredModuleRegistryV2 CreateRegistry(
            IEnumerable<IndustrialFactoryV2ModuleDefinition> definitions)
        {
            DungeonAuthoredModuleRegistryV2 registry =
                Own(ScriptableObject.CreateInstance<DungeonAuthoredModuleRegistryV2>());
            var entries = new List<DungeonAuthoredModuleEntryV2>();
            foreach (IndustrialFactoryV2ModuleDefinition definition in definitions)
            {
                DungeonCertifiedGeometryAssetV2 asset =
                    Own(ScriptableObject.CreateInstance<DungeonCertifiedGeometryAssetV2>());
                asset.Store(definition.CertifiedGeometry);
                DungeonAuthoredModuleDescriptorAssetV2 descriptor =
                    Own(ScriptableObject.CreateInstance<DungeonAuthoredModuleDescriptorAssetV2>());
                descriptor.Store(
                    definition.TemplateId,
                    definition.DescriptorId,
                    definition.VariantId,
                    definition.Composition,
                    definition.CompatibleMacroRoles,
                    definition.TopologyEdges,
                    definition.VerticalCompositionId);
                GameObject prefabToken = Own(new GameObject("Prefab_" + definition.TemplateId));
                var entry = new DungeonAuthoredModuleEntryV2();
                entry.Configure(
                    definition.TemplateId,
                    definition.DescriptorId,
                    definition.Composition.Archetype.ToString(),
                    prefabToken,
                    descriptor,
                    asset,
                    descriptor.DescriptorRevisionHash,
                    definition.GeometryRevisionHash,
                    definition.PresentationDependencyHash,
                    definition.CombinedRevisionHash);
                entries.Add(entry);
            }

            registry.Configure(entries);
            return registry;
        }

        private static DungeonPlanV2 RebuildWithSurfaces(
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

        private T Own<T>(T target) where T : UnityEngine.Object
        {
            ownedObjects.Add(target);
            return target;
        }
    }
}
