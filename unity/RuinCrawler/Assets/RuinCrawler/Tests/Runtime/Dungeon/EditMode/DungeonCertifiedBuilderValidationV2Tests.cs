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
        private readonly List<Object> ownedObjects = new List<Object>();

        [TearDown]
        public void TearDown()
        {
            for (int index = ownedObjects.Count - 1; index >= 0; index -= 1)
            {
                if (ownedObjects[index] != null)
                {
                    Object.DestroyImmediate(ownedObjects[index]);
                }
            }

            ownedObjects.Clear();
        }

        [Test]
        public void BuilderResolvesEveryPlacedModuleBeforeCreatingSceneGeometry()
        {
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate("builder-certified-registry");
            DungeonCertifiedGeometryRegistryV2 registry = CreateRegistry(
                plan.Modules.Select(module => IndustrialFactoryV2ModuleCatalog.Require(module.TemplateId)).Distinct());
            GameObject host = Own(new GameObject("CertifiedBuilderHost"));
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            builder.ConfigureCertifiedGeometryRegistry(registry, true, false);

            Assert.That(builder.TryBuild(plan, null, null, out string error), Is.True, error);
            Assert.That(builder.CertifiedModuleCount, Is.EqualTo(plan.Modules.Count));
            Assert.That(builder.GeneratedRoot, Is.Not.Null);
            builder.TearDown();
        }

        [Test]
        public void BuilderFailsVisiblyBeforeCreatingRootWhenRegistryIsMissingOrIncomplete()
        {
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate("builder-certified-rejection");
            GameObject host = Own(new GameObject("CertifiedBuilderHost"));
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            builder.ConfigureCertifiedGeometryRegistry(null, true, false);

            LogAssert.Expect(LogType.Error, new Regex(
                @"\[RuinCrawler Dungeon V2\].*certified module registry is missing"));
            Assert.That(builder.TryBuild(plan, null, null, out string missingError), Is.False);
            Assert.That(missingError, Does.Contain("registry is missing"));
            Assert.That(builder.GeneratedRoot, Is.Null);

            IndustrialFactoryV2ModuleDefinition first =
                IndustrialFactoryV2ModuleCatalog.Require(plan.Modules[0].TemplateId);
            DungeonCertifiedGeometryRegistryV2 incomplete = CreateRegistry(new[] { first });
            builder.ConfigureCertifiedGeometryRegistry(incomplete, true, false);
            LogAssert.Expect(LogType.Error, new Regex(
                @"\[RuinCrawler Dungeon V2\].*No certified geometry asset is registered"));
            Assert.That(builder.TryBuild(plan, null, null, out string incompleteError), Is.False);
            Assert.That(incompleteError, Does.Contain("No certified geometry asset is registered"));
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
            DungeonCertifiedGeometryRegistryV2 registry = CreateRegistry(
                source.Modules.Select(module => IndustrialFactoryV2ModuleCatalog.Require(module.TemplateId)).Distinct());
            GameObject host = Own(new GameObject("CertifiedBuilderHost"));
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            builder.ConfigureCertifiedGeometryRegistry(registry, true, false);

            LogAssert.Expect(LogType.Error, new Regex(
                @"\[RuinCrawler Dungeon V2\].*CERTIFIED_SURFACE_PLACEMENT_MISMATCH"));
            Assert.That(builder.TryBuild(invalid, null, null, out string error), Is.False);
            Assert.That(error, Does.Contain("CERTIFIED_SURFACE_PLACEMENT_MISMATCH"));
            Assert.That(builder.GeneratedRoot, Is.Null);
        }

        private DungeonCertifiedGeometryRegistryV2 CreateRegistry(
            IEnumerable<IndustrialFactoryV2ModuleDefinition> definitions)
        {
            DungeonCertifiedGeometryRegistryV2 registry =
                Own(ScriptableObject.CreateInstance<DungeonCertifiedGeometryRegistryV2>());
            var assets = new List<DungeonCertifiedGeometryAssetV2>();
            foreach (IndustrialFactoryV2ModuleDefinition definition in definitions)
            {
                DungeonCertifiedGeometryAssetV2 asset =
                    Own(ScriptableObject.CreateInstance<DungeonCertifiedGeometryAssetV2>());
                asset.Store(definition.CertifiedGeometry);
                assets.Add(asset);
            }

            registry.Configure(assets);
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
                source.FallExposures);
        }

        private T Own<T>(T target) where T : Object
        {
            ownedObjects.Add(target);
            return target;
        }
    }
}
