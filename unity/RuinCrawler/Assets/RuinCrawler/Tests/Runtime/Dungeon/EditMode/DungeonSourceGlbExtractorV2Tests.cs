using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon.Tests
{
    public sealed class DungeonSourceGlbExtractorV2Tests
    {
        private const string OutputRoot =
            "Assets/RuinCrawler/Art/DungeonV2/ImportedProps";
        private const string ManifestPath =
            OutputRoot + "/dungeon_v2_imported_props_manifest.json";

        [Serializable]
        private sealed class ExtractionManifest
        {
            public int schemaVersion;
            public string profileId;
            public string extractorVersion;
            public SourceRecord[] sources;
        }

        [Serializable]
        private sealed class SourceRecord
        {
            public string id;
            public string theme;
            public string sourceAssetPath;
            public string sourceAssetGuid;
            public string sourceSha256;
            public long sourceByteLength;
            public int sourceMeshNodeCount;
            public string outputPrefabPath;
            public OutputRecord[] outputs;
        }

        [Serializable]
        private sealed class OutputRecord
        {
            public string outputObjectName;
            public string meshAssetPath;
            public string materialAssetPath;
            public string zone;
            public bool isMechanism;
            public string[] sourceNodePaths;
        }

        [Test]
        public void ExtractedPropManifest_MapsEverySemanticSourceNodeToOwnedOutput()
        {
            ExtractionManifest manifest = LoadManifest();
            Assert.That(manifest.schemaVersion, Is.EqualTo(1));
            Assert.That(manifest.profileId, Is.EqualTo("industrial-factory-v2"));
            Assert.That(manifest.extractorVersion,
                Is.EqualTo("dungeon-source-glb-extractor-v2.1"));
            Assert.That(manifest.sources, Has.Length.EqualTo(3));
            Assert.That(manifest.sources.Select(value => value.id),
                Is.EqualTo(manifest.sources.Select(value => value.id)
                    .OrderBy(value => value, StringComparer.Ordinal)));

            foreach (SourceRecord source in manifest.sources)
            {
                Assert.That(source.outputs, Is.Not.Null.And.Not.Empty, source.id);
                Assert.That(source.outputs.Select(value => value.outputObjectName),
                    Is.EqualTo(source.outputs.Select(value => value.outputObjectName)
                        .OrderBy(value => value, StringComparer.Ordinal)),
                    source.id + " outputs must use canonical order.");
                Assert.That(source.outputs.Select(value => value.outputObjectName).Distinct().Count(),
                    Is.EqualTo(source.outputs.Length), source.id + " output names");

                string[] mappedNodes = source.outputs
                    .SelectMany(value => value.sourceNodePaths ?? Array.Empty<string>())
                    .ToArray();
                Assert.That(mappedNodes, Has.Length.EqualTo(source.sourceMeshNodeCount), source.id);
                Assert.That(mappedNodes.Distinct(StringComparer.Ordinal).Count(),
                    Is.EqualTo(source.sourceMeshNodeCount),
                    source.id + " must map every semantic source node exactly once.");

                GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(source.outputPrefabPath);
                Assert.That(prefab, Is.Not.Null, source.outputPrefabPath);
                Assert.That(prefab.GetComponentsInChildren<Collider>(true), Is.Empty,
                    source.id + " must remain presentation-only.");
                Assert.That(AssetDatabase.GetLabels(prefab),
                    Does.Contain("RuinCrawlerDungeonV2Extracted"), source.id);
                Assert.That(AssetDatabase.GetLabels(prefab), Does.Contain(source.id), source.id);
                Assert.That(AssetDatabase.GetLabels(prefab), Does.Contain(source.theme), source.id);

                var transforms = prefab.GetComponentsInChildren<Transform>(true)
                    .GroupBy(value => value.name, StringComparer.Ordinal)
                    .ToDictionary(value => value.Key, value => value.ToArray(), StringComparer.Ordinal);
                foreach (OutputRecord output in source.outputs)
                {
                    Assert.That(output.sourceNodePaths, Is.Not.Null.And.Not.Empty,
                        output.outputObjectName);
                    Assert.That(transforms.TryGetValue(output.outputObjectName, out Transform[] matches),
                        Is.True, output.outputObjectName);
                    Assert.That(matches, Has.Length.EqualTo(1), output.outputObjectName);

                    Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(output.meshAssetPath);
                    Material material = AssetDatabase.LoadAssetAtPath<Material>(output.materialAssetPath);
                    Assert.That(mesh, Is.Not.Null, output.meshAssetPath);
                    Assert.That(material, Is.Not.Null, output.materialAssetPath);
                    Assert.That(output.meshAssetPath,
                        Does.StartWith(OutputRoot + "/" + source.id + "/"));
                    Assert.That(output.materialAssetPath,
                        Does.StartWith("Assets/RuinCrawler/Art/DungeonV2/Materials/"));

                    MeshFilter filter = matches[0].GetComponent<MeshFilter>();
                    MeshRenderer renderer = matches[0].GetComponent<MeshRenderer>();
                    Assert.That(filter, Is.Not.Null, output.outputObjectName);
                    Assert.That(renderer, Is.Not.Null, output.outputObjectName);
                    Assert.That(AssetDatabase.GetAssetPath(filter.sharedMesh),
                        Is.EqualTo(output.meshAssetPath), output.outputObjectName);
                    Assert.That(AssetDatabase.GetAssetPath(renderer.sharedMaterial),
                        Is.EqualTo(output.materialAssetPath), output.outputObjectName);
                }
            }
        }

        [TestCase(
            "server_crypt_source",
            "3ddb2f4c6cb711435f90b50523a850fb8771d821f1600cb63122d397b671603e",
            167316L,
            253,
            9)]
        [TestCase(
            "coolant_works_source",
            "55dd5c2cf3ea0b3abb988a964852190a8f1c7b392f31b246ad0ff3b88c87e3bf",
            229912L,
            295,
            58)]
        [TestCase(
            "machine_factory_source",
            "f8a11494076230fd566340c25bc512a07f8848dd43ae506b522d254eb5f890ee",
            312120L,
            416,
            102)]
        public void ExtractedPropManifest_PinsSourceProvenanceAndOutputShape(
            string sourceId,
            string expectedSha256,
            long expectedByteLength,
            int expectedMeshNodeCount,
            int expectedOutputCount)
        {
            SourceRecord source = LoadManifest().sources.Single(value => value.id == sourceId);
            string physicalPath = ResolvePhysicalAssetPath(source.sourceAssetPath);
            Assert.That(source.sourceAssetGuid,
                Is.EqualTo(AssetDatabase.AssetPathToGUID(source.sourceAssetPath)));
            Assert.That(source.sourceSha256, Is.EqualTo(expectedSha256));
            Assert.That(source.sourceSha256, Is.EqualTo(ComputeSha256(physicalPath)));
            Assert.That(source.sourceByteLength, Is.EqualTo(expectedByteLength));
            Assert.That(source.sourceByteLength, Is.EqualTo(new FileInfo(physicalPath).Length));
            Assert.That(source.sourceMeshNodeCount, Is.EqualTo(expectedMeshNodeCount));
            Assert.That(source.outputs, Has.Length.EqualTo(expectedOutputCount));
        }

        [Test]
        public void MachineFactory_CoolantSolidsRemainOpaqueWhileLiquidUsesWaterSurface()
        {
            SourceRecord source = LoadManifest().sources
                .Single(value => value.id == "machine_factory_source");
            OutputRecord cap = FindOutputForNode(source, "cyan_coolant_tank_1_top_cap");
            OutputRecord pipe = FindOutputForNode(source, "cyan_coolant_tank_1_pipe_to_wall");
            OutputRecord liquid = FindOutputForNode(source, "cyan_coolant_tank_1_liquid_core");

            Assert.That(cap.materialAssetPath,
                Is.EqualTo("Assets/RuinCrawler/Art/DungeonV2/Materials/FactoryConduit.mat"));
            Assert.That(pipe.materialAssetPath,
                Is.EqualTo("Assets/RuinCrawler/Art/DungeonV2/Materials/FactoryConduit.mat"));
            Assert.That(liquid.materialAssetPath,
                Is.EqualTo("Assets/RuinCrawler/Art/DungeonV2/Materials/WaterworksSurface.mat"));
        }

        private static OutputRecord FindOutputForNode(SourceRecord source, string nodeName)
        {
            return source.outputs.Single(output => output.sourceNodePaths.Any(path =>
                string.Equals(path, nodeName, StringComparison.Ordinal)
                || path.EndsWith("/" + nodeName, StringComparison.Ordinal)));
        }

        private static ExtractionManifest LoadManifest()
        {
            TextAsset asset = AssetDatabase.LoadAssetAtPath<TextAsset>(ManifestPath);
            Assert.That(asset, Is.Not.Null,
                ManifestPath + " is generated by DungeonSourceGlbExtractorV2.ExtractAll.");
            ExtractionManifest manifest = JsonUtility.FromJson<ExtractionManifest>(asset.text);
            Assert.That(manifest, Is.Not.Null);
            Assert.That(manifest.sources, Is.Not.Null);
            return manifest;
        }

        private static string ResolvePhysicalAssetPath(string assetPath)
        {
            UnityEditor.PackageManager.PackageInfo package =
                UnityEditor.PackageManager.PackageInfo.FindForAssetPath(assetPath);
            Assert.That(package, Is.Not.Null, assetPath);
            string packagePrefix = "Packages/" + package.name;
            string relativePath = assetPath.Substring(packagePrefix.Length)
                .TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
            return Path.Combine(package.resolvedPath, relativePath);
        }

        private static string ComputeSha256(string path)
        {
            using (var stream = File.OpenRead(path))
            using (SHA256 sha256 = SHA256.Create())
            {
                return BitConverter.ToString(sha256.ComputeHash(stream))
                    .Replace("-", string.Empty)
                    .ToLowerInvariant();
            }
        }
    }
}
