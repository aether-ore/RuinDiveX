using System;
using System.Linq;
using NUnit.Framework;
using RuinCrawler.Core.Dungeon;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Editor.DungeonV2;
using UnityEditor;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon.Tests
{
    public sealed class DungeonCertifiedModuleContentGeneratorV2Tests
    {
        private string outputRoot;

        [SetUp]
        public void SetUp()
        {
            outputRoot = "Assets/RuinCrawler/Tests/GeneratedTemp/DungeonV2_"
                + Guid.NewGuid().ToString("N");
        }

        [TearDown]
        public void TearDown()
        {
            if (AssetDatabase.IsValidFolder(outputRoot))
            {
                AssetDatabase.DeleteAsset(outputRoot);
                AssetDatabase.Refresh();
            }
        }

        [Test]
        public void GeneratorCreatesDeterministicPrefabGeometryAssetsAndRegistry()
        {
            IndustrialFactoryV2ModuleDefinition[] definitions =
                IndustrialFactoryV2ModuleCatalog.Definitions
                    .Where(value => value.TemplateId.StartsWith("factory-securityentrance-", StringComparison.Ordinal))
                    .ToArray();

            DungeonCertifiedModuleGenerationResultV2 first =
                DungeonCertifiedModuleContentGeneratorV2.Generate(outputRoot, definitions);

            Assert.That(first.Succeeded, Is.True, string.Join("\n", first.Errors));
            Assert.That(first.PrefabCount, Is.EqualTo(2));
            Assert.That(first.Registry, Is.Not.Null);
            Assert.That(first.Registry.ModuleAssets.Count, Is.EqualTo(2));

            string[] prefabGuids = definitions.Select(definition => AssetDatabase.AssetPathToGUID(
                DungeonCertifiedModuleContentGeneratorV2.PrefabPath(outputRoot, definition.TemplateId))).ToArray();
            string[] assetGuids = definitions.Select(definition => AssetDatabase.AssetPathToGUID(
                DungeonCertifiedModuleContentGeneratorV2.GeometryAssetPath(outputRoot, definition.TemplateId))).ToArray();
            Assert.That(prefabGuids.All(value => !string.IsNullOrEmpty(value)), Is.True);
            Assert.That(assetGuids.All(value => !string.IsNullOrEmpty(value)), Is.True);

            foreach (IndustrialFactoryV2ModuleDefinition definition in definitions)
            {
                string prefabPath = DungeonCertifiedModuleContentGeneratorV2.PrefabPath(
                    outputRoot,
                    definition.TemplateId);
                DungeonCertifiedGeometryBakeResultV2 validation =
                    DungeonCertifiedGeometryPrefabToolsV2.ValidatePrefabAsset(prefabPath);
                Assert.That(validation.IsValid, Is.True, string.Join("\n", validation.Issues));
                Assert.That(validation.Geometry.ContentHash, Is.EqualTo(definition.ContentHash));
            }

            DungeonCertifiedModuleGenerationResultV2 second =
                DungeonCertifiedModuleContentGeneratorV2.Generate(outputRoot, definitions.Reverse());
            Assert.That(second.Succeeded, Is.True, string.Join("\n", second.Errors));
            Assert.That(definitions.Select(definition => AssetDatabase.AssetPathToGUID(
                    DungeonCertifiedModuleContentGeneratorV2.PrefabPath(outputRoot, definition.TemplateId))),
                Is.EqualTo(prefabGuids));
            Assert.That(definitions.Select(definition => AssetDatabase.AssetPathToGUID(
                    DungeonCertifiedModuleContentGeneratorV2.GeometryAssetPath(outputRoot, definition.TemplateId))),
                Is.EqualTo(assetGuids));
        }

        [Test]
        public void RuntimeRegistryResolvesOnlyExactCertifiedModuleRevision()
        {
            IndustrialFactoryV2ModuleDefinition definition =
                IndustrialFactoryV2ModuleCatalog.Definitions.First();
            var geometryAsset = ScriptableObject.CreateInstance<DungeonCertifiedGeometryAssetV2>();
            var registry = ScriptableObject.CreateInstance<DungeonCertifiedGeometryRegistryV2>();
            try
            {
                geometryAsset.Store(definition.CertifiedGeometry);
                registry.Configure(new[] { geometryAsset });
                var bounds = new DungeonBounds3(
                    new DungeonPoint3(-5d, 0d, -5d),
                    new DungeonPoint3(5d, 5d, 5d));
                var exactModule = new DungeonModuleInstancePlanV2(
                    "module",
                    definition.TemplateId,
                    definition.ContentHash,
                    "macro",
                    bounds,
                    new[] { "region" },
                    Array.Empty<string>(),
                    Array.Empty<string>());

                Assert.That(registry.TryResolve(
                    exactModule,
                    out DungeonCertifiedGeometryAssetV2 resolvedAsset,
                    out CertifiedDungeonModuleGeometryV2 resolvedGeometry,
                    out string error), Is.True, error);
                Assert.That(resolvedAsset, Is.SameAs(geometryAsset));
                Assert.That(resolvedGeometry.ContentHash, Is.EqualTo(definition.ContentHash));

                var staleModule = new DungeonModuleInstancePlanV2(
                    "module",
                    definition.TemplateId,
                    "sha256:stale",
                    "macro",
                    bounds,
                    new[] { "region" },
                    Array.Empty<string>(),
                    Array.Empty<string>());
                Assert.That(registry.TryResolve(
                    staleModule,
                    out _,
                    out _,
                    out string staleError), Is.False);
                Assert.That(staleError, Does.Contain("stale"));
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(registry);
                UnityEngine.Object.DestroyImmediate(geometryAsset);
            }
        }

        [Test]
        public void GeneratedDefaultRuntimeRegistryCoversEveryCatalogTemplate()
        {
            DungeonCertifiedGeometryRegistryV2 registry =
                AssetDatabase.LoadAssetAtPath<DungeonCertifiedGeometryRegistryV2>(
                    DungeonCertifiedModuleContentGeneratorV2.DefaultRuntimeRegistryAssetPath);
            Assert.That(registry, Is.Not.Null,
                "Run RuinCrawler/Dungeon V2/Generate Certified Module Content.");
            Assert.That(registry.ValidateCatalogCoverage(out var errors),
                Is.True,
                string.Join("\n", errors));
            Assert.That(registry.ModuleAssets.Count,
                Is.EqualTo(IndustrialFactoryV2ModuleCatalog.Definitions.Count));

            foreach (IndustrialFactoryV2ModuleDefinition definition in IndustrialFactoryV2ModuleCatalog.Definitions)
            {
                DungeonCertifiedGeometryBakeResultV2 validation =
                    DungeonCertifiedGeometryPrefabToolsV2.ValidatePrefabAsset(
                        DungeonCertifiedModuleContentGeneratorV2.PrefabPath(
                            DungeonCertifiedModuleContentGeneratorV2.DefaultOutputRoot,
                            definition.TemplateId));
                Assert.That(validation.IsValid, Is.True,
                    definition.TemplateId + "\n" + string.Join("\n", validation.Issues));
                Assert.That(validation.Geometry.ContentHash, Is.EqualTo(definition.ContentHash));
            }
        }
    }
}
