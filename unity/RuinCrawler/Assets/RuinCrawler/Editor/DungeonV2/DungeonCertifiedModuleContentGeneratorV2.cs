using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Runtime.Dungeon;
using UnityEditor;
using UnityEngine;

namespace RuinCrawler.Editor.DungeonV2
{
    public sealed class DungeonAuthoredModuleLibraryBakeResultV2
    {
        public DungeonAuthoredModuleLibraryBakeResultV2(
            string prefabRoot,
            int validatedPrefabCount,
            DungeonAuthoredModuleRegistryV2 registry,
            IEnumerable<string> errors)
        {
            PrefabRoot = prefabRoot;
            ValidatedPrefabCount = validatedPrefabCount;
            Registry = registry;
            Errors = Array.AsReadOnly((errors ?? Array.Empty<string>()).ToArray());
        }

        public string PrefabRoot { get; }
        public int ValidatedPrefabCount { get; }
        public DungeonAuthoredModuleRegistryV2 Registry { get; }
        public IReadOnlyList<string> Errors { get; }
        public bool Succeeded => Errors.Count == 0 && Registry != null;
    }

    /// <summary>
    /// Bakes and validates an already-authored prefab library. This command is
    /// intentionally incapable of creating or saving prefabs: missing modules,
    /// hierarchy roots, presentation, or markers are content failures, never a
    /// reason to manufacture replacement cubes.
    /// </summary>
    public static class DungeonAuthoredModuleLibraryBakerV2
    {
        public const string DefaultPrefabRoot =
            "Assets/RuinCrawler/Prefabs/DungeonV2/AuthoredModules";
        public const string DefaultRuntimeRegistryAssetPath =
            "Assets/RuinCrawler/Resources/DungeonV2/DungeonAuthoredModuleRegistryV2.asset";

        [MenuItem("RuinCrawler/Dungeon V2/Bake and Validate Authored Module Library")]
        public static void BakeDefaultLibraryMenu()
        {
            DungeonAuthoredModuleLibraryBakeResultV2 result = BakeAndValidate(
                DefaultPrefabRoot,
                DefaultRuntimeRegistryAssetPath);
            if (!result.Succeeded)
            {
                Debug.LogError("Authored Dungeon V2 library bake failed:\n- "
                    + string.Join("\n- ", result.Errors));
                return;
            }

            Debug.Log("Baked and validated " + result.ValidatedPrefabCount
                + " authored Dungeon V2 module prefabs without modifying any prefab.", result.Registry);
        }

        public static DungeonAuthoredModuleLibraryBakeResultV2 BakeAndValidate(
            string prefabRoot,
            string registryAssetPath = DefaultRuntimeRegistryAssetPath)
        {
            RequireAssetFolder(prefabRoot, nameof(prefabRoot));
            RequireAssetPath(registryAssetPath, ".asset", nameof(registryAssetPath));
            if (!AssetDatabase.IsValidFolder(prefabRoot))
            {
                return new DungeonAuthoredModuleLibraryBakeResultV2(
                    prefabRoot,
                    0,
                    null,
                    new[] { "Authored prefab root does not exist: " + prefabRoot + "." });
            }

            string[] prefabPaths = AssetDatabase.FindAssets("t:Prefab", new[] { prefabRoot })
                .Select(AssetDatabase.GUIDToAssetPath)
                .OrderBy(value => value, StringComparer.Ordinal)
                .Where(path =>
                {
                    GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                    return prefab != null && prefab.GetComponent<DungeonModuleGeometryAuthoringV2>() != null;
                })
                .ToArray();
            var errors = new List<string>();
            var entries = new List<DungeonAuthoredModuleEntryV2>();
            var templateIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (string prefabPath in prefabPaths)
            {
                GameObject root = PrefabUtility.LoadPrefabContents(prefabPath);
                try
                {
                    DungeonModuleGeometryAuthoringV2 authoring =
                        root.GetComponent<DungeonModuleGeometryAuthoringV2>();
                    if (!templateIds.Add(authoring.TemplateId))
                    {
                        errors.Add(prefabPath + ": duplicate template ID '" + authoring.TemplateId + "'.");
                        continue;
                    }

                    if (authoring.CertifiedGeometry == null)
                    {
                        errors.Add(prefabPath
                            + ": prefab must reference a pre-created certified geometry asset; the library baker never rewrites prefabs.");
                        continue;
                    }

                    DungeonAuthoredModuleValidationResultV2 preflight =
                        DungeonAuthoredModuleValidatorV2.Validate(root, requireCurrentBake: false);
                    if (!preflight.IsValid)
                    {
                        errors.Add(prefabPath + "\n" + Format(preflight.Issues));
                        continue;
                    }

                    // Only the separate bake asset is updated. The loaded
                    // prefab contents are never saved or assigned here.
                    Undo.RecordObject(authoring.CertifiedGeometry, "Bake authored Dungeon V2 geometry");
                    authoring.CertifiedGeometry.Store(preflight.Geometry);
                    EditorUtility.SetDirty(authoring.CertifiedGeometry);

                    DungeonAuthoredModuleValidationResultV2 current =
                        DungeonAuthoredModuleValidatorV2.Validate(root, requireCurrentBake: true);
                    if (!current.IsValid)
                    {
                        errors.Add(prefabPath + "\n" + Format(current.Issues));
                        continue;
                    }

                    string presentationHash =
                        DungeonAuthoredModuleRevisionUtilityV2.ComputePresentationDependencyHash(root);
                    DungeonModuleCompositionAuthoringV2 compositionAuthoring =
                        root.GetComponent<DungeonModuleCompositionAuthoringV2>();
                    DungeonModuleGenerationAuthoringV2 generationAuthoring =
                        root.GetComponent<DungeonModuleGenerationAuthoringV2>();
                    if (compositionAuthoring == null || generationAuthoring == null)
                    {
                        errors.Add(prefabPath + ": composition and generation authoring metadata are required.");
                        continue;
                    }

                    string descriptorAssetPath = Path.ChangeExtension(prefabPath, ".descriptor-v2.asset")
                        .Replace('\\', '/');
                    DungeonAuthoredModuleDescriptorAssetV2 descriptor =
                        AssetDatabase.LoadAssetAtPath<DungeonAuthoredModuleDescriptorAssetV2>(descriptorAssetPath);
                    if (descriptor == null)
                    {
                        UnityEngine.Object conflicting = AssetDatabase.LoadMainAssetAtPath(descriptorAssetPath);
                        if (conflicting != null)
                        {
                            errors.Add(descriptorAssetPath + ": path is occupied by a non-descriptor asset.");
                            continue;
                        }
                        descriptor = ScriptableObject.CreateInstance<DungeonAuthoredModuleDescriptorAssetV2>();
                        AssetDatabase.CreateAsset(descriptor, descriptorAssetPath);
                    }

                    descriptor.Store(
                        authoring.TemplateId,
                        authoring.DescriptorId,
                        generationAuthoring.VariantId,
                        compositionAuthoring.ToCore(),
                        generationAuthoring.CompatibleMacroRoles,
                        generationAuthoring.ToCoreEdges(),
                        generationAuthoring.VerticalCompositionId);
                    EditorUtility.SetDirty(descriptor);
                    if (!descriptor.TryBuildDefinition(
                            current.Geometry,
                            presentationHash,
                            out IndustrialFactoryV2ModuleDefinition definition,
                            out string descriptorError))
                    {
                        errors.Add(prefabPath + ": " + descriptorError);
                        continue;
                    }

                    var entry = new DungeonAuthoredModuleEntryV2();
                    entry.Configure(
                        authoring.TemplateId,
                        authoring.DescriptorId,
                        definition.Composition.Archetype.ToString(),
                        AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath),
                        descriptor,
                        authoring.CertifiedGeometry,
                        descriptor.DescriptorRevisionHash,
                        current.Geometry.ContentHash,
                        presentationHash,
                        definition.CombinedRevisionHash);
                    entries.Add(entry);
                }
                finally
                {
                    PrefabUtility.UnloadPrefabContents(root);
                }
            }

            if (prefabPaths.Length == 0)
                errors.Add("No authored Dungeon V2 prefabs were found beneath " + prefabRoot + ".");

            var validationRegistry = ScriptableObject.CreateInstance<DungeonAuthoredModuleRegistryV2>();
            validationRegistry.Configure(entries);
            if (!validationRegistry.ValidateCatalogCoverage(out IReadOnlyList<string> coverageErrors))
                errors.AddRange(coverageErrors);
            UnityEngine.Object.DestroyImmediate(validationRegistry);

            DungeonAuthoredModuleRegistryV2 existingRegistry =
                AssetDatabase.LoadAssetAtPath<DungeonAuthoredModuleRegistryV2>(registryAssetPath);
            if (errors.Count > 0)
            {
                // Geometry/descriptor assets may be staged for author review,
                // but the production registry is never partially replaced.
                return new DungeonAuthoredModuleLibraryBakeResultV2(
                    prefabRoot,
                    entries.Count,
                    existingRegistry,
                    errors);
            }

            EnsureFolder(Path.GetDirectoryName(registryAssetPath)?.Replace('\\', '/'));
            DungeonAuthoredModuleRegistryV2 registry =
                existingRegistry;
            if (registry == null)
            {
                registry = ScriptableObject.CreateInstance<DungeonAuthoredModuleRegistryV2>();
                AssetDatabase.CreateAsset(registry, registryAssetPath);
            }

            registry.Configure(entries);
            EditorUtility.SetDirty(registry);
            AssetDatabase.SaveAssets();

            return new DungeonAuthoredModuleLibraryBakeResultV2(
                prefabRoot,
                entries.Count,
                registry,
                errors);
        }

        public static DungeonAuthoredModuleValidationResultV2 ValidatePrefabAsset(string prefabPath)
        {
            RequireAssetPath(prefabPath, ".prefab", nameof(prefabPath));
            GameObject root = PrefabUtility.LoadPrefabContents(prefabPath);
            try
            {
                return DungeonAuthoredModuleValidatorV2.Validate(root, requireCurrentBake: true);
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }
        }

        internal static string Format(IEnumerable<DungeonAuthoredModuleIssueV2> issues) =>
            "Authored module validation failed:\n- " + string.Join("\n- ", issues.Select(value => value.ToString()));

        private static void RequireAssetFolder(string value, string parameterName)
        {
            if (string.IsNullOrWhiteSpace(value)
                || !value.Replace('\\', '/').StartsWith("Assets/", StringComparison.Ordinal))
                throw new ArgumentException("Path must be an Assets-relative folder.", parameterName);
        }

        private static void RequireAssetPath(string value, string extension, string parameterName)
        {
            if (string.IsNullOrWhiteSpace(value)
                || !value.Replace('\\', '/').StartsWith("Assets/", StringComparison.Ordinal)
                || !value.EndsWith(extension, StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("Path must be an Assets-relative " + extension + " asset.", parameterName);
        }

        private static void EnsureFolder(string folder)
        {
            if (string.IsNullOrWhiteSpace(folder)) return;
            string normalized = folder.Replace('\\', '/').TrimEnd('/');
            string[] parts = normalized.Split('/');
            string current = "Assets";
            for (int index = 1; index < parts.Length; index += 1)
            {
                string next = current + "/" + parts[index];
                if (!AssetDatabase.IsValidFolder(next)) AssetDatabase.CreateFolder(current, parts[index]);
                current = next;
            }
        }
    }
}
