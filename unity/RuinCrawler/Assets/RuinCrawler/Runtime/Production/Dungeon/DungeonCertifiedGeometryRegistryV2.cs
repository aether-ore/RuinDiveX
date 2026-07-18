using System;
using System.Collections.Generic;
using System.Linq;
using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    [CreateAssetMenu(
        fileName = "DungeonCertifiedGeometryRegistryV2",
        menuName = "RuinCrawler/Dungeon V2/Certified Geometry Registry")]
    public sealed class DungeonCertifiedGeometryRegistryV2 : ScriptableObject
    {
        [SerializeField] private DungeonCertifiedGeometryAssetV2[] moduleAssets =
            Array.Empty<DungeonCertifiedGeometryAssetV2>();

        private Dictionary<string, DungeonCertifiedGeometryAssetV2> byTemplateId;
        private string indexError;

        public IReadOnlyList<DungeonCertifiedGeometryAssetV2> ModuleAssets => moduleAssets;

        public void Configure(IEnumerable<DungeonCertifiedGeometryAssetV2> assets)
        {
            if (assets == null)
            {
                throw new ArgumentNullException(nameof(assets));
            }

            moduleAssets = assets
                .Where(value => value != null)
                .OrderBy(value => value.TemplateId, StringComparer.Ordinal)
                .ToArray();
            RebuildIndex();
        }

        public bool TryResolve(
            DungeonModuleInstancePlanV2 module,
            out DungeonCertifiedGeometryAssetV2 asset,
            out CertifiedDungeonModuleGeometryV2 geometry,
            out string error)
        {
            asset = null;
            geometry = null;
            if (module == null)
            {
                error = "A module plan is required.";
                return false;
            }

            EnsureIndex();
            if (!string.IsNullOrEmpty(indexError))
            {
                error = indexError;
                return false;
            }

            if (!byTemplateId.TryGetValue(module.TemplateId, out asset))
            {
                error = "No certified geometry asset is registered for template '" + module.TemplateId + "'.";
                return false;
            }

            if (!asset.TryRead(out geometry, out error))
            {
                asset = null;
                return false;
            }

            CertifiedDungeonGeometryValidationResultV2 moduleValidation = geometry.ValidateModuleInstance(module);
            if (!moduleValidation.IsValid)
            {
                error = moduleValidation.Message;
                asset = null;
                geometry = null;
                return false;
            }

            error = string.Empty;
            return true;
        }

        public bool ValidateCatalogCoverage(out IReadOnlyList<string> errors)
        {
            EnsureIndex();
            var failures = new List<string>();
            if (!string.IsNullOrEmpty(indexError))
            {
                failures.Add(indexError);
            }

            foreach (IndustrialFactoryV2ModuleDefinition definition in IndustrialFactoryV2ModuleCatalog.Definitions)
            {
                if (!byTemplateId.TryGetValue(definition.TemplateId, out DungeonCertifiedGeometryAssetV2 asset))
                {
                    failures.Add("Missing certified asset for template '" + definition.TemplateId + "'.");
                    continue;
                }

                if (!asset.TryRead(out CertifiedDungeonModuleGeometryV2 geometry, out string readError))
                {
                    failures.Add(definition.TemplateId + ": " + readError);
                    continue;
                }

                if (!string.Equals(geometry.ContentHash, definition.ContentHash, StringComparison.Ordinal))
                {
                    failures.Add(
                        definition.TemplateId + ": asset hash " + geometry.ContentHash
                            + " does not match Core catalog hash " + definition.ContentHash + ".");
                }
            }

            foreach (string templateId in byTemplateId.Keys)
            {
                if (!IndustrialFactoryV2ModuleCatalog.TryGet(templateId, out _))
                {
                    failures.Add("Registry contains an unknown template '" + templateId + "'.");
                }
            }

            errors = Array.AsReadOnly(failures.ToArray());
            return failures.Count == 0;
        }

        private void OnEnable()
        {
            RebuildIndex();
        }

#if UNITY_EDITOR
        private void OnValidate()
        {
            RebuildIndex();
        }
#endif

        private void EnsureIndex()
        {
            if (byTemplateId == null)
            {
                RebuildIndex();
            }
        }

        private void RebuildIndex()
        {
            byTemplateId = new Dictionary<string, DungeonCertifiedGeometryAssetV2>(StringComparer.Ordinal);
            indexError = string.Empty;
            foreach (DungeonCertifiedGeometryAssetV2 asset in moduleAssets ?? Array.Empty<DungeonCertifiedGeometryAssetV2>())
            {
                if (asset == null)
                {
                    continue;
                }

                if (string.IsNullOrWhiteSpace(asset.TemplateId))
                {
                    indexError = "Certified geometry registry contains an asset without a template ID.";
                    continue;
                }

                if (!byTemplateId.TryAdd(asset.TemplateId, asset))
                {
                    indexError = "Certified geometry registry contains duplicate template ID '" + asset.TemplateId + "'.";
                }
            }
        }
    }
}
