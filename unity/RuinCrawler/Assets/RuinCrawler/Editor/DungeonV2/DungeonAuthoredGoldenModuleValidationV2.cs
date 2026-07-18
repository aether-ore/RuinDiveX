using System;
using System.Linq;
using RuinCrawler.Runtime.Dungeon;
using UnityEditor;
using UnityEngine;

namespace RuinCrawler.Editor.DungeonV2
{
    /// <summary>
    /// Focused batch gate for the first hand-authored Dungeon V2 module. This deliberately
    /// touches only the Security Checkpoint variant A certified-geometry asset; it never
    /// builds or replaces a module registry and therefore cannot enable the production cutover.
    /// </summary>
    public static class DungeonAuthoredGoldenModuleValidationV2
    {
        public const string SecurityCheckpointVariantAPrefabPath =
            "Assets/RuinCrawler/Prefabs/DungeonV2/AuthoredModules/SecurityCheckpoint/security-checkpoint-variant-a.prefab";

        public const string SecurityCheckpointVariantAGeometryPath =
            "Assets/RuinCrawler/Prefabs/DungeonV2/AuthoredModules/SecurityCheckpoint/security-checkpoint-variant-a.geometry-v2.asset";

        /// <summary>Entry point for Unity -batchmode -executeMethod.</summary>
        public static void ValidateSecurityCheckpointVariantABatch()
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(SecurityCheckpointVariantAPrefabPath);
            if (prefab == null)
            {
                throw new InvalidOperationException(
                    "Missing authored Security Checkpoint prefab at '"
                    + SecurityCheckpointVariantAPrefabPath + "'.");
            }

            DungeonCertifiedGeometryAssetV2 geometryAsset =
                AssetDatabase.LoadAssetAtPath<DungeonCertifiedGeometryAssetV2>(
                    SecurityCheckpointVariantAGeometryPath);
            if (geometryAsset == null)
            {
                throw new InvalidOperationException(
                    "Missing Security Checkpoint certified-geometry asset at '"
                    + SecurityCheckpointVariantAGeometryPath + "'.");
            }

            GameObject root = PrefabUtility.LoadPrefabContents(SecurityCheckpointVariantAPrefabPath);
            try
            {
                DungeonModuleGeometryAuthoringV2 authoring =
                    root.GetComponent<DungeonModuleGeometryAuthoringV2>();
                if (authoring == null)
                {
                    throw new InvalidOperationException(
                        "Security Checkpoint prefab root requires DungeonModuleGeometryAuthoringV2.");
                }

                if (authoring.CertifiedGeometry != geometryAsset)
                {
                    throw new InvalidOperationException(
                        "Security Checkpoint prefab must already reference its dedicated certified-geometry asset. "
                        + "The focused batch gate never rewrites prefab references.");
                }

                DungeonAuthoredModuleValidationResultV2 preflight =
                    DungeonAuthoredModuleValidatorV2.Validate(root, requireCurrentBake: false);
                RequireValid("preflight", preflight);

                DungeonCertifiedGeometryBakeResultV2 bake =
                    DungeonCertifiedGeometryBakerV2.BakeIntoAsset(root, geometryAsset);
                if (!bake.IsValid)
                {
                    throw new InvalidOperationException(
                        "Security Checkpoint certified-geometry bake failed:\n- "
                        + string.Join("\n- ", bake.Issues.Select(value => value.ToString())));
                }

                if (!string.Equals(
                        preflight.Geometry.ContentHash,
                        bake.Geometry.ContentHash,
                        StringComparison.Ordinal))
                {
                    throw new InvalidOperationException(
                        "Security Checkpoint preflight and bake produced different deterministic content hashes: '"
                        + preflight.Geometry.ContentHash + "' versus '" + bake.Geometry.ContentHash + "'.");
                }

                DungeonAuthoredModuleValidationResultV2 current =
                    DungeonAuthoredModuleValidatorV2.Validate(root, requireCurrentBake: true);
                RequireValid("current-bake validation", current);

                if (!string.Equals(
                        bake.Geometry.ContentHash,
                        current.Geometry.ContentHash,
                        StringComparison.Ordinal))
                {
                    throw new InvalidOperationException(
                        "Security Checkpoint post-bake validation changed the deterministic content hash: '"
                        + bake.Geometry.ContentHash + "' versus '" + current.Geometry.ContentHash + "'.");
                }

                // Save only the certified-geometry asset. The loaded prefab contents and the
                // production authored-module registry are intentionally never saved or touched.
                AssetDatabase.SaveAssetIfDirty(geometryAsset);
                Debug.Log(
                    "AUTHORED_DUNGEON_V2_GOLDEN_MODULE_VALID="
                    + authoring.TemplateId + ";CONTENT_HASH=" + current.Geometry.ContentHash,
                    geometryAsset);
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }
        }

        private static void RequireValid(
            string phase,
            DungeonAuthoredModuleValidationResultV2 result)
        {
            if (result != null && result.IsValid)
            {
                return;
            }

            string issues = result == null
                ? "Validator returned no result."
                : string.Join("\n- ", result.Issues.Select(value => value.ToString()));
            throw new InvalidOperationException(
                "Security Checkpoint " + phase + " failed:\n- " + issues);
        }
    }
}
