using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using RuinCrawler.Core.Dungeon;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Runtime.Dungeon;
using UnityEditor;
using UnityEngine;

namespace RuinCrawler.Editor.DungeonV2
{
    public sealed class DungeonCertifiedModuleGenerationResultV2
    {
        public DungeonCertifiedModuleGenerationResultV2(
            string outputRoot,
            int prefabCount,
            DungeonCertifiedGeometryRegistryV2 registry,
            IEnumerable<string> errors)
        {
            OutputRoot = outputRoot;
            PrefabCount = prefabCount;
            Registry = registry;
            Errors = Array.AsReadOnly((errors ?? Array.Empty<string>()).ToArray());
        }

        public string OutputRoot { get; }
        public int PrefabCount { get; }
        public DungeonCertifiedGeometryRegistryV2 Registry { get; }
        public IReadOnlyList<string> Errors { get; }
        public bool Succeeded => Errors.Count == 0 && Registry != null;
    }

    /// <summary>
    /// Deterministically materializes the Core module catalog as authoring
    /// prefabs and certified geometry assets. The generated content is an
    /// editor-time fixture/source pack; runtime assembly never creates meshes.
    /// </summary>
    public static class DungeonCertifiedModuleContentGeneratorV2
    {
        public const string DefaultOutputRoot =
            "Assets/RuinCrawler/Prefabs/DungeonV2/CertifiedModules";
        public const string RegistryFileName = "DungeonCertifiedGeometryRegistryV2.asset";
        public const string DefaultRuntimeRegistryAssetPath =
            "Assets/RuinCrawler/Resources/DungeonV2/DungeonCertifiedGeometryRegistryV2.asset";

        [MenuItem("RuinCrawler/Dungeon V2/Generate Certified Module Content")]
        public static void GenerateDefaultContentMenu()
        {
            DungeonCertifiedModuleGenerationResultV2 result = Generate(
                DefaultOutputRoot,
                IndustrialFactoryV2ModuleCatalog.Definitions,
                DefaultRuntimeRegistryAssetPath);
            if (!result.Succeeded)
            {
                Debug.LogError(
                    "Certified module content generation failed:\n- " + string.Join("\n- ", result.Errors));
                return;
            }

            Debug.Log(
                "Generated and certified " + result.PrefabCount + " Dungeon V2 module prefabs in "
                    + result.OutputRoot + ".",
                result.Registry);
        }

        public static DungeonCertifiedModuleGenerationResultV2 Generate(
            string outputRoot,
            IEnumerable<IndustrialFactoryV2ModuleDefinition> sourceDefinitions,
            string registryAssetPath = null)
        {
            if (string.IsNullOrWhiteSpace(outputRoot)
                || !outputRoot.StartsWith("Assets/", StringComparison.Ordinal))
            {
                throw new ArgumentException("Output root must be an Assets-relative folder.", nameof(outputRoot));
            }

            if (sourceDefinitions == null)
            {
                throw new ArgumentNullException(nameof(sourceDefinitions));
            }

            IndustrialFactoryV2ModuleDefinition[] definitions = sourceDefinitions
                .OrderBy(value => value.TemplateId, StringComparer.Ordinal)
                .ToArray();
            EnsureFolder(outputRoot);

            var geometryAssets = new List<DungeonCertifiedGeometryAssetV2>();
            var errors = new List<string>();
            foreach (IndustrialFactoryV2ModuleDefinition definition in definitions)
            {
                try
                {
                    DungeonCertifiedGeometryAssetV2 asset = GenerateDefinition(outputRoot, definition);
                    geometryAssets.Add(asset);
                }
                catch (Exception exception)
                {
                    errors.Add(definition.TemplateId + ": " + exception.Message);
                }
            }

            string registryPath = string.IsNullOrWhiteSpace(registryAssetPath)
                ? outputRoot + "/" + RegistryFileName
                : registryAssetPath.Replace('\\', '/');
            if (!registryPath.StartsWith("Assets/", StringComparison.Ordinal)
                || !registryPath.EndsWith(".asset", StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException("Registry path must be an Assets-relative .asset path.", nameof(registryAssetPath));
            }

            EnsureFolder(Path.GetDirectoryName(registryPath)?.Replace('\\', '/'));
            DungeonCertifiedGeometryRegistryV2 registry =
                AssetDatabase.LoadAssetAtPath<DungeonCertifiedGeometryRegistryV2>(registryPath);
            if (registry == null)
            {
                registry = ScriptableObject.CreateInstance<DungeonCertifiedGeometryRegistryV2>();
                AssetDatabase.CreateAsset(registry, registryPath);
            }

            registry.Configure(geometryAssets);
            EditorUtility.SetDirty(registry);
            AssetDatabase.SaveAssets();

            foreach (IndustrialFactoryV2ModuleDefinition definition in definitions)
            {
                string prefabPath = PrefabPath(outputRoot, definition.TemplateId);
                DungeonCertifiedGeometryBakeResultV2 validation =
                    DungeonCertifiedGeometryPrefabToolsV2.ValidatePrefabAsset(prefabPath);
                if (!validation.IsValid)
                {
                    errors.Add(
                        definition.TemplateId + ": "
                            + DungeonCertifiedGeometryPrefabToolsV2.FormatIssues(validation.Issues));
                }
                else if (!string.Equals(
                    validation.Geometry.ContentHash,
                    definition.ContentHash,
                    StringComparison.Ordinal))
                {
                    errors.Add(
                        definition.TemplateId + ": generated prefab hash "
                            + validation.Geometry.ContentHash + " differs from Core catalog hash "
                            + definition.ContentHash + ".");
                }
            }

            return new DungeonCertifiedModuleGenerationResultV2(
                outputRoot,
                geometryAssets.Count,
                registry,
                errors);
        }

        public static string PrefabPath(string outputRoot, string templateId)
        {
            return outputRoot.TrimEnd('/') + "/" + Sanitize(templateId) + ".prefab";
        }

        public static string GeometryAssetPath(string outputRoot, string templateId)
        {
            return outputRoot.TrimEnd('/') + "/" + Sanitize(templateId) + ".geometry-v2.asset";
        }

        private static DungeonCertifiedGeometryAssetV2 GenerateDefinition(
            string outputRoot,
            IndustrialFactoryV2ModuleDefinition definition)
        {
            string assetPath = GeometryAssetPath(outputRoot, definition.TemplateId);
            DungeonCertifiedGeometryAssetV2 geometryAsset =
                AssetDatabase.LoadAssetAtPath<DungeonCertifiedGeometryAssetV2>(assetPath);
            if (geometryAsset == null)
            {
                geometryAsset = ScriptableObject.CreateInstance<DungeonCertifiedGeometryAssetV2>();
                AssetDatabase.CreateAsset(geometryAsset, assetPath);
            }

            GameObject authoringRoot = BuildAuthoringObject(definition, geometryAsset);
            string prefabPath = PrefabPath(outputRoot, definition.TemplateId);
            try
            {
                PrefabUtility.SaveAsPrefabAsset(authoringRoot, prefabPath);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(authoringRoot);
            }

            GameObject prefabContents = PrefabUtility.LoadPrefabContents(prefabPath);
            try
            {
                DungeonCertifiedGeometryBakeResultV2 bake =
                    DungeonCertifiedGeometryBakerV2.BakeIntoAsset(prefabContents, geometryAsset);
                if (!bake.IsValid)
                {
                    throw new InvalidOperationException(
                        DungeonCertifiedGeometryPrefabToolsV2.FormatIssues(bake.Issues));
                }

                if (!string.Equals(bake.Geometry.ContentHash, definition.ContentHash, StringComparison.Ordinal))
                {
                    throw new InvalidOperationException(
                        "Editor-authored geometry hashes to " + bake.Geometry.ContentHash
                            + ", but the Core catalog requires " + definition.ContentHash + ".");
                }

                PrefabUtility.SaveAsPrefabAsset(prefabContents, prefabPath);
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(prefabContents);
            }

            AssetDatabase.SetLabels(
                geometryAsset,
                new[] { "ruincrawler-dungeon-v2-certified-geometry" });
            EditorUtility.SetDirty(geometryAsset);
            return geometryAsset;
        }

        private static GameObject BuildAuthoringObject(
            IndustrialFactoryV2ModuleDefinition definition,
            DungeonCertifiedGeometryAssetV2 geometryAsset)
        {
            CertifiedDungeonModuleGeometryV2 geometry = definition.CertifiedGeometry;
            var root = new GameObject("Module_" + Sanitize(definition.TemplateId));
            DungeonModuleGeometryAuthoringV2 module = root.AddComponent<DungeonModuleGeometryAuthoringV2>();
            module.Configure(definition.TemplateId, true, geometryAsset);

            foreach (CertifiedDungeonRegionGeometryV2 region in geometry.Regions)
            {
                GameObject regionObject = new GameObject("Region_" + Sanitize(region.Id));
                regionObject.transform.SetParent(root.transform, false);
                DungeonRegionGeometryAuthoringV2 marker =
                    regionObject.AddComponent<DungeonRegionGeometryAuthoringV2>();
                DungeonPoint3 center = Center(region.Bounds);
                marker.Configure(
                    region.Id,
                    ToUnity(center),
                    new Vector3(
                        (float)(region.Bounds.Maximum.X - region.Bounds.Minimum.X),
                        (float)(region.Bounds.Maximum.Y - region.Bounds.Minimum.Y),
                        (float)(region.Bounds.Maximum.Z - region.Bounds.Minimum.Z)),
                    region.DistrictKind,
                    region.ElevationStratum,
                    region.LocalNavigationRegionId);
            }

            foreach (CertifiedDungeonSurfaceGeometryV2 surface in geometry.Surfaces)
            {
                CreateBoxSurface(root.transform, surface);
            }

            foreach (CertifiedDungeonAnchorGeometryV2 anchor in geometry.Anchors)
            {
                GameObject anchorObject = new GameObject("Anchor_" + Sanitize(anchor.Id));
                anchorObject.transform.SetParent(root.transform, false);
                anchorObject.transform.localPosition = ToUnity(anchor.Position);
                DungeonAnchorGeometryAuthoringV2 marker =
                    anchorObject.AddComponent<DungeonAnchorGeometryAuthoringV2>();
                marker.Configure(anchor.Id, anchor.RegionId, anchor.Kind, anchor.ProfileId);
            }

            foreach (CertifiedDungeonConnectorGeometryV2 connector in geometry.Connectors)
            {
                GameObject connectorObject = new GameObject("Connector_" + Sanitize(connector.Id));
                connectorObject.transform.SetParent(root.transform, false);
                connectorObject.transform.localPosition = ToUnity(connector.Position);
                Vector3 facing = ToUnity(connector.Facing).normalized;
                connectorObject.transform.localRotation = Quaternion.LookRotation(facing, Vector3.up);
                DungeonConnectorGeometryAuthoringV2 marker =
                    connectorObject.AddComponent<DungeonConnectorGeometryAuthoringV2>();
                marker.Configure(connector.Id, connector.RegionId, connector.Kind, connector.SocketTag);
            }

            return root;
        }

        private static void CreateBoxSurface(
            Transform parent,
            CertifiedDungeonSurfaceGeometryV2 surface)
        {
            if (surface.ColliderKind != CertifiedDungeonColliderKindV2.Box)
            {
                throw new InvalidOperationException(
                    "Generated module workflow currently expects catalog-authored box prisms; received "
                        + surface.ColliderKind + " for " + surface.Id + ".");
            }

            RequireAxisAlignedRectangle(surface.Volume, surface.Id);
            double minimumX = surface.Volume.HorizontalVertices.Min(value => value.X);
            double maximumX = surface.Volume.HorizontalVertices.Max(value => value.X);
            double minimumZ = surface.Volume.HorizontalVertices.Min(value => value.Z);
            double maximumZ = surface.Volume.HorizontalVertices.Max(value => value.Z);
            var center = new DungeonPoint3(
                (minimumX + maximumX) * 0.5d,
                (surface.Volume.MinimumY + surface.Volume.MaximumY) * 0.5d,
                (minimumZ + maximumZ) * 0.5d);
            var size = new Vector3(
                (float)(maximumX - minimumX),
                (float)(surface.Volume.MaximumY - surface.Volume.MinimumY),
                (float)(maximumZ - minimumZ));

            GameObject surfaceObject = GameObject.CreatePrimitive(PrimitiveType.Cube);
            surfaceObject.name = "Surface_" + Sanitize(surface.Id);
            surfaceObject.transform.SetParent(parent, false);
            surfaceObject.transform.localPosition = ToUnity(center);
            surfaceObject.transform.localScale = size;
            DungeonSurfaceGeometryAuthoringV2 marker =
                surfaceObject.AddComponent<DungeonSurfaceGeometryAuthoringV2>();
            marker.Configure(
                surface.Id,
                surface.RegionId,
                surface.Kind,
                surface.IsStructural,
                surface.IsWalkable,
                surface.MaterialProfileId);
        }

        private static void RequireAxisAlignedRectangle(DungeonConvexPrismV2 prism, string surfaceId)
        {
            if (prism.HorizontalVertices.Count != 4)
            {
                throw new InvalidOperationException(
                    "Surface '" + surfaceId + "' is not a four-corner box prism.");
            }

            double minimumX = prism.HorizontalVertices.Min(value => value.X);
            double maximumX = prism.HorizontalVertices.Max(value => value.X);
            double minimumZ = prism.HorizontalVertices.Min(value => value.Z);
            double maximumZ = prism.HorizontalVertices.Max(value => value.Z);
            foreach (DungeonPoint2V2 point in prism.HorizontalVertices)
            {
                bool validX = point.X.Equals(minimumX) || point.X.Equals(maximumX);
                bool validZ = point.Z.Equals(minimumZ) || point.Z.Equals(maximumZ);
                if (!validX || !validZ)
                {
                    throw new InvalidOperationException(
                        "Surface '" + surfaceId + "' is not an axis-aligned rectangle.");
                }
            }
        }

        private static DungeonPoint3 Center(DungeonBounds3 bounds)
        {
            return new DungeonPoint3(
                (bounds.Minimum.X + bounds.Maximum.X) * 0.5d,
                (bounds.Minimum.Y + bounds.Maximum.Y) * 0.5d,
                (bounds.Minimum.Z + bounds.Maximum.Z) * 0.5d);
        }

        private static Vector3 ToUnity(DungeonPoint3 core)
        {
            return new Vector3((float)-core.X, (float)core.Y, (float)core.Z);
        }

        private static string Sanitize(string value)
        {
            var characters = value.Select(character => char.IsLetterOrDigit(character) ? character : '_').ToArray();
            return new string(characters);
        }

        private static void EnsureFolder(string folder)
        {
            string normalized = folder.Replace('\\', '/').TrimEnd('/');
            string[] parts = normalized.Split('/');
            if (parts.Length == 0 || !string.Equals(parts[0], "Assets", StringComparison.Ordinal))
            {
                throw new ArgumentException("Generated content must live beneath Assets.", nameof(folder));
            }

            string current = "Assets";
            for (int index = 1; index < parts.Length; index += 1)
            {
                string next = current + "/" + parts[index];
                if (!AssetDatabase.IsValidFolder(next))
                {
                    AssetDatabase.CreateFolder(current, parts[index]);
                }

                current = next;
            }
        }
    }
}
