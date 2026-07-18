using System;
using System.Linq;
using NUnit.Framework;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Editor.DungeonV2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon.Tests
{
    public sealed class DungeonCertifiedModuleContentGeneratorV2Tests
    {
        [Test]
        public void AuthoredLibraryBakerDoesNotManufactureAMissingPrefabRoot()
        {
            string missing = "Assets/RuinCrawler/Tests/GeneratedTemp/MissingAuthoredLibrary_"
                + Guid.NewGuid().ToString("N");

            DungeonAuthoredModuleLibraryBakeResultV2 result =
                DungeonAuthoredModuleLibraryBakerV2.BakeAndValidate(
                    missing,
                    missing + "/Registry.asset");

            Assert.That(result.Succeeded, Is.False);
            Assert.That(result.Errors, Has.Some.Contains("does not exist"));
            Assert.That(UnityEditor.AssetDatabase.IsValidFolder(missing), Is.False,
                "The authored-library command must not create fallback content.");
        }

        [Test]
        public void StrictValidatorRejectsGeometryOnlyObjectWithoutAuthoredHierarchy()
        {
            var root = new GameObject("GeometryOnlyIsNotAuthoredContent");
            try
            {
                root.AddComponent<DungeonModuleGeometryAuthoringV2>()
                    .Configure("not-an-authored-module");

                DungeonAuthoredModuleValidationResultV2 result =
                    DungeonAuthoredModuleValidatorV2.Validate(root, requireCurrentBake: false);

                Assert.That(result.IsValid, Is.False);
                Assert.That(result.Issues.Any(issue =>
                    issue.Code == DungeonAuthoredModuleIssueCodeV2.MissingHierarchy), Is.True);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void DescriptorAssetReconstructsPureDefinitionWithoutInspectingPrefab()
        {
            IndustrialFactoryV2ModuleDefinition source = IndustrialFactoryV2ModuleCatalog.Definitions[0];
            var descriptor = ScriptableObject.CreateInstance<DungeonAuthoredModuleDescriptorAssetV2>();
            try
            {
                descriptor.Store(
                    source.TemplateId,
                    source.DescriptorId,
                    source.VariantId,
                    source.Composition,
                    source.CompatibleMacroRoles,
                    source.TopologyEdges,
                    source.VerticalCompositionId);

                Assert.That(descriptor.TryBuildDefinition(
                    source.CertifiedGeometry,
                    source.PresentationDependencyHash,
                    out IndustrialFactoryV2ModuleDefinition rebuilt,
                    out string error), Is.True, error);
                Assert.That(rebuilt.CombinedRevisionHash, Is.EqualTo(source.CombinedRevisionHash));
                Assert.That(rebuilt.TopologySignature, Is.EqualTo(source.TopologySignature));
                Assert.That(descriptor.DescriptorRevisionHash, Does.StartWith("sha256:"));
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(descriptor);
            }
        }

        [Test]
        public void SecurityCheckpointVariantA_PassesTheCurrentAuthoredContentBake()
        {
            DungeonAuthoredModuleValidationResultV2 result =
                DungeonAuthoredModuleLibraryBakerV2.ValidatePrefabAsset(
                    DungeonAuthoredGoldenModuleValidationV2.SecurityCheckpointVariantAPrefabPath);

            Assert.That(
                result.IsValid,
                Is.True,
                string.Join("\n", result.Issues.Select(issue => issue.ToString())));
            Assert.That(result.Geometry, Is.Not.Null);
            Assert.That(result.Geometry.ContentHash, Does.StartWith("sha256:"));
        }
    }
}
