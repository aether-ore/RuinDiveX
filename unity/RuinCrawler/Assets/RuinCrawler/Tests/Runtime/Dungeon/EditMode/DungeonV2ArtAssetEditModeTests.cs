using System;
using System.IO;
using System.Linq;
using NUnit.Framework;
using RuinCrawler.Art.DungeonV2;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace RuinCrawler.Runtime.Dungeon.Tests
{
    public sealed class DungeonV2ArtAssetEditModeTests
    {
        private const string ArtRoot = "Assets/RuinCrawler/Art/DungeonV2";
        private const string ManifestPath =
            ArtRoot + "/Textures/dungeon_v2_texture_manifest.json";
        private const string CatalogPath =
            ArtRoot + "/DungeonV2MaterialCatalog.asset";

        [Serializable]
        private sealed class ArtManifest
        {
            public int schemaVersion;
            public string profileId;
            public TextureMapRecord[] maps;
            public MaterialRecord[] materials;
        }

        [Serializable]
        private sealed class TextureMapRecord
        {
            public string id;
            public string output;
            public int width;
            public int height;
            public string colorSpace;
            public string wrapMode;
            public string alphaMode;
        }

        [Serializable]
        private sealed class MaterialRecord
        {
            public string id;
            public string role;
            public string output;
            public string shader;
        }

        [TestCase("Ruin/IndustrialLit", "_EmissionMap")]
        [TestCase("Ruin/WaterSurface", "_DetailTex")]
        [TestCase("Ruin/MagmaSurface", "_EmissionMap")]
        [TestCase("Ruin/ElectricPanel", "_Phase")]
        public void BuiltInShaders_AreImportableAndExposeRuntimeProperties(
            string shaderName,
            string requiredProperty)
        {
            Shader shader = Shader.Find(shaderName);
            Assert.That(shader, Is.Not.Null, shaderName);
            using (var scope = new MaterialScope(shader))
            {
                Assert.That(scope.Material.HasProperty(requiredProperty), Is.True,
                    shaderName + " must expose " + requiredProperty + ".");
            }
        }

        [Test]
        public void DungeonPresentation_RemainsOnBuiltInRenderPipeline()
        {
            Assert.That(GraphicsSettings.defaultRenderPipeline, Is.Null,
                "Installing editor authoring/import packages must not switch the project away from Built-in rendering.");
            Assert.That(QualitySettings.renderPipeline, Is.Null,
                "No quality tier may override the Built-in render pipeline for Dungeon V2.");
        }

        [Test]
        public void DerivedTextures_AreRuntimeSizedAndUseCertifiedImportSettings()
        {
            ArtManifest manifest = LoadManifest();
            Assert.That(manifest.maps, Has.Length.EqualTo(36));

            foreach (TextureMapRecord map in manifest.maps)
            {
                Texture2D texture = AssetDatabase.LoadAssetAtPath<Texture2D>(map.output);
                Assert.That(texture, Is.Not.Null, map.id);
                Assert.That(texture.width, Is.EqualTo(256), map.id);
                Assert.That(texture.height, Is.EqualTo(256), map.id);
                Assert.That(map.width, Is.EqualTo(256), map.id);
                Assert.That(map.height, Is.EqualTo(256), map.id);

                var importer = AssetImporter.GetAtPath(map.output) as TextureImporter;
                Assert.That(importer, Is.Not.Null, map.id);
                Assert.That(importer.mipmapEnabled, Is.True, map.id);
                Assert.That(importer.filterMode, Is.EqualTo(FilterMode.Trilinear), map.id);
                Assert.That(importer.anisoLevel, Is.EqualTo(4), map.id);
                Assert.That(importer.sRGBTexture,
                    Is.EqualTo(string.Equals(map.colorSpace, "sRGB", StringComparison.Ordinal)),
                    map.id);
                Assert.That(importer.wrapMode,
                    Is.EqualTo(string.Equals(map.wrapMode, "Clamp", StringComparison.Ordinal)
                        ? TextureWrapMode.Clamp
                        : TextureWrapMode.Repeat),
                    map.id);
                Assert.That(map.output, Does.Not.Contain("SourceMasters"), map.id);
            }
        }

        [Test]
        public void TransparentDecals_ContainBothClearAndOpaquePixels()
        {
            ArtManifest manifest = LoadManifest();
            TextureMapRecord[] decals = manifest.maps
                .Where(value => string.Equals(
                    value.alphaMode,
                    "GrayBackgroundToAlpha",
                    StringComparison.Ordinal))
                .ToArray();
            Assert.That(decals, Has.Length.EqualTo(6));

            foreach (TextureMapRecord decal in decals)
            {
                string absolutePath = Path.GetFullPath(Path.Combine(
                    Application.dataPath,
                    "..",
                    decal.output));
                byte[] bytes = File.ReadAllBytes(absolutePath);
                var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
                try
                {
                    Assert.That(texture.LoadImage(bytes, false), Is.True, decal.id);
                    Color32[] pixels = texture.GetPixels32();
                    Assert.That(pixels.Any(value => value.a <= 3), Is.True,
                        decal.id + " needs transparent background pixels.");
                    Assert.That(pixels.Any(value => value.a >= 250), Is.True,
                        decal.id + " needs opaque mark pixels.");
                }
                finally
                {
                    UnityEngine.Object.DestroyImmediate(texture);
                }
            }
        }

        [Test]
        public void SharedMaterials_UseOnlyDungeonV2DerivedTexturesAndShaders()
        {
            ArtManifest manifest = LoadManifest();
            Assert.That(manifest.materials, Has.Length.EqualTo(18));

            foreach (MaterialRecord record in manifest.materials)
            {
                Material material = AssetDatabase.LoadAssetAtPath<Material>(record.output);
                Assert.That(material, Is.Not.Null, record.id);
                Assert.That(material.shader, Is.Not.Null, record.id);
                Assert.That(material.shader.name, Is.EqualTo(record.shader), record.id);
                Assert.That(material.mainTexture, Is.Not.Null, record.id);
                string texturePath = AssetDatabase.GetAssetPath(material.mainTexture);
                Assert.That(texturePath, Does.StartWith(ArtRoot + "/Textures/"), record.id);
                Assert.That(texturePath, Does.Not.Contain("SourceMasters"), record.id);
            }
        }

        [Test]
        public void SemanticMaterialCatalog_ResolvesEveryManifestRoleExactlyOnce()
        {
            ArtManifest manifest = LoadManifest();
            DungeonV2MaterialCatalog catalog =
                AssetDatabase.LoadAssetAtPath<DungeonV2MaterialCatalog>(CatalogPath);
            Assert.That(catalog, Is.Not.Null, CatalogPath);
            Assert.That(catalog.Validate(out string[] errors), Is.True, string.Join("\n", errors));
            Assert.That(catalog.Entries.Count(), Is.EqualTo(manifest.materials.Length));

            string[] roles = manifest.materials.Select(value => value.role).ToArray();
            Assert.That(roles.Distinct(StringComparer.Ordinal).Count(), Is.EqualTo(roles.Length));
            foreach (string role in roles)
            {
                Assert.That(catalog.TryGetMaterial(role, out Material material), Is.True, role);
                Assert.That(material, Is.Not.Null, role);
            }
        }

        private static ArtManifest LoadManifest()
        {
            TextAsset asset = AssetDatabase.LoadAssetAtPath<TextAsset>(ManifestPath);
            Assert.That(asset, Is.Not.Null, ManifestPath);
            ArtManifest manifest = JsonUtility.FromJson<ArtManifest>(asset.text);
            Assert.That(manifest, Is.Not.Null);
            Assert.That(manifest.schemaVersion, Is.EqualTo(1));
            Assert.That(manifest.profileId, Is.EqualTo("industrial-factory-v2"));
            return manifest;
        }

        private sealed class MaterialScope : IDisposable
        {
            public MaterialScope(Shader shader)
            {
                Material = new Material(shader);
            }

            public Material Material { get; }

            public void Dispose()
            {
                UnityEngine.Object.DestroyImmediate(Material);
            }
        }
    }
}
