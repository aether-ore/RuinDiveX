using System;
using System.Collections.Generic;
using System.Linq;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Runtime.Persistence;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    [Serializable]
    public sealed class DungeonAuthoredModuleEntryV2
    {
        [SerializeField] private string templateId;
        [SerializeField] private string descriptorId;
        [SerializeField] private string archetypeId;
        [SerializeField] private GameObject presentationPrefab;
        [SerializeField] private DungeonAuthoredModuleDescriptorAssetV2 generationDescriptor;
        [SerializeField] private DungeonCertifiedGeometryAssetV2 certifiedGeometry;
        [SerializeField] private string descriptorRevisionHash;
        [SerializeField] private string geometryRevisionHash;
        [SerializeField] private string presentationDependencyHash;
        [SerializeField] private string combinedRevisionHash;

        public string TemplateId => templateId;
        public string DescriptorId => descriptorId;
        public string ArchetypeId => archetypeId;
        public GameObject PresentationPrefab => presentationPrefab;
        public DungeonAuthoredModuleDescriptorAssetV2 GenerationDescriptor => generationDescriptor;
        public DungeonCertifiedGeometryAssetV2 CertifiedGeometry => certifiedGeometry;
        public string DescriptorRevisionHash => descriptorRevisionHash;
        public string GeometryRevisionHash => geometryRevisionHash;
        public string PresentationDependencyHash => presentationDependencyHash;
        public string CombinedRevisionHash => combinedRevisionHash;

        public void Configure(
            string stableTemplateId,
            string stableDescriptorId,
            string stableArchetypeId,
            GameObject authoredPrefab,
            DungeonAuthoredModuleDescriptorAssetV2 pureGenerationDescriptor,
            DungeonCertifiedGeometryAssetV2 geometry,
            string descriptorHash,
            string geometryHash,
            string presentationHash,
            string combinedHash)
        {
            templateId = stableTemplateId;
            descriptorId = stableDescriptorId;
            archetypeId = stableArchetypeId;
            presentationPrefab = authoredPrefab;
            generationDescriptor = pureGenerationDescriptor;
            certifiedGeometry = geometry;
            descriptorRevisionHash = descriptorHash;
            geometryRevisionHash = geometryHash;
            presentationDependencyHash = presentationHash;
            combinedRevisionHash = combinedHash;
        }

        public bool TryReadGeometry(out CertifiedDungeonModuleGeometryV2 geometry, out string error)
        {
            return TryReadDefinition(out _, out geometry, out error);
        }

        public bool TryReadDefinition(
            out IndustrialFactoryV2ModuleDefinition definition,
            out CertifiedDungeonModuleGeometryV2 geometry,
            out string error)
        {
            definition = null;
            geometry = null;
            if (string.IsNullOrWhiteSpace(templateId)
                || string.IsNullOrWhiteSpace(descriptorId)
                || string.IsNullOrWhiteSpace(archetypeId))
            {
                error = "Authored module entry IDs may not be empty.";
                return false;
            }

            if (presentationPrefab == null)
            {
                error = "Authored module '" + templateId + "' has no presentation prefab.";
                return false;
            }

            if (certifiedGeometry == null)
            {
                error = "Authored module '" + templateId + "' has no certified geometry asset.";
                return false;
            }

            if (generationDescriptor == null)
            {
                error = "Authored module '" + templateId + "' has no immutable generation descriptor asset.";
                return false;
            }

            if (!certifiedGeometry.TryRead(out geometry, out error))
            {
                error = templateId + ": " + error;
                return false;
            }

            if (!string.Equals(geometry.TemplateId, templateId, StringComparison.Ordinal))
            {
                error = "Authored module registry template '" + templateId
                    + "' references geometry for '" + geometry.TemplateId + "'.";
                geometry = null;
                return false;
            }

            if (!string.Equals(geometry.ContentHash, geometryRevisionHash, StringComparison.Ordinal))
            {
                error = "Authored module '" + templateId + "' has stale geometry revision '"
                    + geometryRevisionHash + "'; certified content is '" + geometry.ContentHash + "'.";
                geometry = null;
                return false;
            }

            if (!IsSha256(descriptorRevisionHash)
                || !IsSha256(presentationDependencyHash)
                || !IsSha256(combinedRevisionHash))
            {
                error = "Authored module '" + templateId
                    + "' is missing valid descriptor, presentation, or combined SHA-256 revision hashes.";
                geometry = null;
                return false;
            }

            if (!string.Equals(generationDescriptor.TemplateId, templateId, StringComparison.Ordinal)
                || !string.Equals(generationDescriptor.DescriptorId, descriptorId, StringComparison.Ordinal)
                || !string.Equals(generationDescriptor.DescriptorRevisionHash, descriptorRevisionHash, StringComparison.Ordinal)
                || !string.Equals(generationDescriptor.ComputeCurrentRevisionHash(), descriptorRevisionHash, StringComparison.Ordinal))
            {
                error = "Authored module '" + templateId + "' has a stale or mismatched pure descriptor revision.";
                geometry = null;
                return false;
            }

            if (!generationDescriptor.TryBuildDefinition(
                    geometry,
                    presentationDependencyHash,
                    out definition,
                    out error))
            {
                geometry = null;
                return false;
            }

            if (!string.Equals(archetypeId, definition.Composition.Archetype.ToString(), StringComparison.Ordinal)
                || !string.Equals(combinedRevisionHash, definition.CombinedRevisionHash, StringComparison.Ordinal))
            {
                error = "Authored module '" + templateId
                    + "' registry identity does not match the compiled pure descriptor.";
                geometry = null;
                definition = null;
                return false;
            }

            error = string.Empty;
            return true;
        }

        private static bool IsSha256(string value)
        {
            if (string.IsNullOrWhiteSpace(value)
                || !value.StartsWith("sha256:", StringComparison.Ordinal)
                || value.Length != 71)
            {
                return false;
            }

            for (int index = 7; index < value.Length; index += 1)
            {
                char character = value[index];
                if (!((character >= '0' && character <= '9')
                    || (character >= 'a' && character <= 'f')))
                {
                    return false;
                }
            }

            return true;
        }
    }

    [CreateAssetMenu(
        fileName = "DungeonAuthoredModuleRegistryV2",
        menuName = "RuinCrawler/Dungeon V2/Authored Module Registry")]
    public sealed class DungeonAuthoredModuleRegistryV2 : ScriptableObject,
        IIndustrialFactoryV2AuthoredCatalogProvider
    {
        public const string ResourcePath = "DungeonV2/DungeonAuthoredModuleRegistryV2";
        [SerializeField] private int contractVersion = 3;
        [SerializeField] private string contentPackId =
            IndustrialFactoryV2Ruleset.ContentPackVersion;
        [SerializeField] private DungeonAuthoredModuleEntryV2[] modules =
            Array.Empty<DungeonAuthoredModuleEntryV2>();

        private Dictionary<string, DungeonAuthoredModuleEntryV2> byTemplateId;
        private string indexError;

        public int ContractVersion => contractVersion;
        public string ContentPackId => contentPackId;
        public IReadOnlyList<DungeonAuthoredModuleEntryV2> Modules => modules;

        public void Configure(
            IEnumerable<DungeonAuthoredModuleEntryV2> entries,
            int authoredContractVersion = 3,
            string authoredContentPackId = IndustrialFactoryV2Ruleset.ContentPackVersion)
        {
            if (entries == null) throw new ArgumentNullException(nameof(entries));
            if (authoredContractVersion != 3)
                throw new ArgumentOutOfRangeException(nameof(authoredContractVersion), "Authored V2 registry contract must be version 3.");
            if (!string.Equals(
                    authoredContentPackId,
                    IndustrialFactoryV2Ruleset.ContentPackVersion,
                    StringComparison.Ordinal))
            {
                throw new ArgumentException(
                    "Authored V2 registry content-pack ID must exactly match '"
                        + IndustrialFactoryV2Ruleset.ContentPackVersion + "'.",
                    nameof(authoredContentPackId));
            }

            contractVersion = authoredContractVersion;
            contentPackId = authoredContentPackId;
            modules = entries
                .Where(value => value != null)
                .OrderBy(value => value.TemplateId, StringComparer.Ordinal)
                .ToArray();
            RebuildIndex();
        }

        public bool TryResolve(
            DungeonModuleInstancePlanV2 module,
            out DungeonAuthoredModuleEntryV2 entry,
            out CertifiedDungeonModuleGeometryV2 geometry,
            out string error)
        {
            entry = null;
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
            if (!HasCurrentContentPackIdentity(out error))
            {
                return false;
            }

            if (!byTemplateId.TryGetValue(module.TemplateId, out entry))
            {
                error = "No authored module is registered for template '" + module.TemplateId + "'.";
                return false;
            }

            if (!entry.TryReadDefinition(
                    out IndustrialFactoryV2ModuleDefinition definition,
                    out geometry,
                    out error))
            {
                entry = null;
                return false;
            }

            if (!string.Equals(module.ContentHash, definition.CombinedRevisionHash, StringComparison.Ordinal))
            {
                error = "Authored module '" + module.Id + "' references revision '"
                    + module.ContentHash + "', but registry revision is '"
                    + entry.CombinedRevisionHash + "'.";
                entry = null;
                geometry = null;
                return false;
            }

            if (!string.Equals(geometry.TemplateId, module.TemplateId, StringComparison.Ordinal))
            {
                error = "Certified geometry template '" + geometry.TemplateId
                    + "' cannot satisfy module template '" + module.TemplateId + "'.";
                entry = null;
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
            if (contractVersion != 3)
                failures.Add("Authored module registry contract is " + contractVersion + "; expected 3.");
            if (!HasCurrentContentPackIdentity(out string contentPackError))
                failures.Add(contentPackError);
            if (!string.IsNullOrEmpty(indexError)) failures.Add(indexError);

            var compiled = new List<IndustrialFactoryV2ModuleDefinition>();
            foreach (DungeonAuthoredModuleEntryV2 entry in modules ?? Array.Empty<DungeonAuthoredModuleEntryV2>())
            {
                if (entry == null)
                {
                    failures.Add("Registry contains a null authored-module entry.");
                    continue;
                }
                if (!entry.TryReadDefinition(out IndustrialFactoryV2ModuleDefinition definition, out _, out string readError))
                {
                    failures.Add((entry?.TemplateId ?? "<null>") + ": " + readError);
                    continue;
                }
                compiled.Add(definition);
            }

            string[] expectedTemplateIds = IndustrialFactoryV2ModuleCatalog.Definitions
                .Select(value => value.TemplateId)
                .OrderBy(value => value, StringComparer.Ordinal)
                .ToArray();
            string[] actualTemplateIds = compiled.Select(value => value.TemplateId)
                .OrderBy(value => value, StringComparer.Ordinal)
                .ToArray();
            foreach (string templateId in expectedTemplateIds.Except(actualTemplateIds, StringComparer.Ordinal))
                failures.Add("Missing authored module for template '" + templateId + "'.");
            foreach (string templateId in actualTemplateIds.Except(expectedTemplateIds, StringComparer.Ordinal))
                failures.Add("Registry contains unknown authored template '" + templateId + "'.");

            foreach (IGrouping<DungeonModuleArchetypeV2, IndustrialFactoryV2ModuleDefinition> family in
                compiled.GroupBy(value => value.Composition.Archetype))
            {
                IndustrialFactoryV2ModuleDefinition[] variants = family.ToArray();
                if (variants.Length != 2)
                    failures.Add("Authored family '" + family.Key + "' must contain exactly two variants.");
                else if (string.Equals(variants[0].TopologySignature, variants[1].TopologySignature, StringComparison.Ordinal))
                    failures.Add("Authored family '" + family.Key + "' variants are not topology-distinct.");
            }
            if (compiled.Select(value => value.Composition.Archetype).Distinct().Count() != 12)
                failures.Add("Authored module registry must contain exactly twelve archetype families.");

            errors = Array.AsReadOnly(failures.ToArray());
            return failures.Count == 0;
        }

        public bool TryBuildPureCatalog(
            out DungeonAuthoredModuleCatalogV2 catalog,
            out IReadOnlyList<string> errors)
        {
            var definitions = new List<IndustrialFactoryV2ModuleDefinition>();
            var failures = new List<string>();
            if (!HasCurrentContentPackIdentity(out string contentPackError))
                failures.Add(contentPackError);
            foreach (DungeonAuthoredModuleEntryV2 entry in modules ?? Array.Empty<DungeonAuthoredModuleEntryV2>())
            {
                if (entry == null)
                {
                    failures.Add("<null>: Registry contains a null authored-module entry.");
                    continue;
                }
                if (entry.TryReadDefinition(out IndustrialFactoryV2ModuleDefinition definition, out _, out string error))
                    definitions.Add(definition);
                else
                    failures.Add(entry.TemplateId + ": " + error);
            }
            catalog = failures.Count == 0 && definitions.Count > 0
                ? new DungeonAuthoredModuleCatalogV2(definitions)
                : null;
            errors = Array.AsReadOnly(failures.ToArray());
            return catalog != null;
        }

        public static bool TryResolveProductionCatalog(
            DungeonAuthoredModuleRegistryV2 explicitRegistry,
            out DungeonAuthoredModuleRegistryV2 resolvedRegistry,
            out DungeonAuthoredModuleCatalogV2 catalog,
            out string error)
        {
            resolvedRegistry = explicitRegistry != null
                ? explicitRegistry
                : Resources.Load<DungeonAuthoredModuleRegistryV2>(ResourcePath);
            catalog = null;
            if (resolvedRegistry == null)
            {
                error = "Missing authored module registry Resources/" + ResourcePath
                    + ". Run Bake and Validate Authored Module Library; production generation has no slab fallback.";
                return false;
            }
            if (!resolvedRegistry.ValidateCatalogCoverage(out IReadOnlyList<string> coverageErrors))
            {
                error = "Authored module registry failed production coverage: "
                    + string.Join(" | ", coverageErrors);
                return false;
            }
            if (!resolvedRegistry.TryBuildPureCatalog(out catalog, out IReadOnlyList<string> buildErrors))
            {
                error = "Authored module registry could not compile a pure generation catalog: "
                    + string.Join(" | ", buildErrors);
                return false;
            }
            error = string.Empty;
            return true;
        }

        public bool TryBuildProductionCatalog(
            out IIndustrialFactoryV2ModuleCatalog catalog,
            out string error)
        {
            catalog = null;
            if (!ValidateCatalogCoverage(out IReadOnlyList<string> coverageErrors))
            {
                error = "Authored module registry failed production coverage: "
                    + string.Join(" | ", coverageErrors);
                return false;
            }
            if (!TryBuildPureCatalog(out DungeonAuthoredModuleCatalogV2 pureCatalog, out IReadOnlyList<string> buildErrors))
            {
                error = "Authored module registry could not compile a pure generation catalog: "
                    + string.Join(" | ", buildErrors);
                return false;
            }
            catalog = pureCatalog;
            error = string.Empty;
            return true;
        }

        private void OnEnable() => RebuildIndex();

#if UNITY_EDITOR
        private void OnValidate() => RebuildIndex();
#endif

        private void EnsureIndex()
        {
            if (byTemplateId == null) RebuildIndex();
        }

        private bool HasCurrentContentPackIdentity(out string error)
        {
            if (string.Equals(
                    contentPackId,
                    IndustrialFactoryV2Ruleset.ContentPackVersion,
                    StringComparison.Ordinal))
            {
                error = string.Empty;
                return true;
            }

            error = "Authored module registry content-pack ID is '"
                + (contentPackId ?? "<null>") + "'; expected exact current identity '"
                + IndustrialFactoryV2Ruleset.ContentPackVersion + "'.";
            return false;
        }

        private void RebuildIndex()
        {
            byTemplateId = new Dictionary<string, DungeonAuthoredModuleEntryV2>(StringComparer.Ordinal);
            indexError = string.Empty;
            foreach (DungeonAuthoredModuleEntryV2 entry in modules ?? Array.Empty<DungeonAuthoredModuleEntryV2>())
            {
                if (entry == null) continue;
                if (string.IsNullOrWhiteSpace(entry.TemplateId))
                {
                    indexError = "Authored module registry contains an entry without a template ID.";
                    continue;
                }

                if (!byTemplateId.TryAdd(entry.TemplateId, entry))
                    indexError = "Authored module registry contains duplicate template ID '" + entry.TemplateId + "'.";
            }
        }
    }

    [DisallowMultipleComponent]
    public sealed class DungeonAuthoredModuleRuntimeV2 : MonoBehaviour
    {
        public string ModuleInstanceId { get; private set; }
        public string TemplateId { get; private set; }
        public string RevisionHash { get; private set; }

        internal void Configure(DungeonModuleInstancePlanV2 module, DungeonAuthoredModuleEntryV2 entry)
        {
            ModuleInstanceId = module?.Id;
            TemplateId = entry?.TemplateId;
            RevisionHash = entry?.CombinedRevisionHash;
        }
    }
}
