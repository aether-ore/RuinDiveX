using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    [Serializable]
    internal sealed class DungeonPlatformPurposeDescriptorDataV2
    {
        [SerializeField] private string platformId;
        [SerializeField] private DungeonPlatformPurposeV2 purpose;
        [SerializeField] private string targetId;

        public DungeonPlatformPurposeDescriptorDataV2() { }

        public DungeonPlatformPurposeDescriptorDataV2(DungeonPlatformPurposeBindingV2 source)
        {
            platformId = source.PlatformId;
            purpose = source.Purpose;
            targetId = source.TargetId;
        }

        public string PlatformId => platformId;
        public DungeonPlatformPurposeV2 Purpose => purpose;
        public string TargetId => targetId;
        public DungeonPlatformPurposeBindingV2 ToCore() =>
            new DungeonPlatformPurposeBindingV2(platformId, purpose, targetId);
    }

    [Serializable]
    internal sealed class DungeonTopologyEdgeDescriptorDataV2
    {
        [SerializeField] private string stableId;
        [SerializeField] private string fromLocalRegionId;
        [SerializeField] private string toLocalRegionId;
        [SerializeField] private DungeonConnectorKindV2 kind;
        [SerializeField] private bool bidirectional;

        public DungeonTopologyEdgeDescriptorDataV2() { }

        public DungeonTopologyEdgeDescriptorDataV2(DungeonAuthoredModuleTopologyEdgeV2 source)
        {
            stableId = source.Id;
            fromLocalRegionId = source.FromLocalRegionId;
            toLocalRegionId = source.ToLocalRegionId;
            kind = source.Kind;
            bidirectional = source.Bidirectional;
        }

        public string StableId => stableId;
        public string FromLocalRegionId => fromLocalRegionId;
        public string ToLocalRegionId => toLocalRegionId;
        public DungeonConnectorKindV2 Kind => kind;
        public bool Bidirectional => bidirectional;
        public DungeonAuthoredModuleTopologyEdgeV2 ToCore() =>
            new DungeonAuthoredModuleTopologyEdgeV2(
                stableId,
                fromLocalRegionId,
                toLocalRegionId,
                kind,
                bidirectional);
    }

    /// <summary>
    /// Immutable Unity serialization of the pure authored-module generation
    /// descriptor. The editor compiler writes this asset from prefab metadata;
    /// Core receives only the reconstructed pure-C# definition.
    /// </summary>
    [CreateAssetMenu(
        fileName = "DungeonAuthoredModuleDescriptorV2",
        menuName = "RuinCrawler/Dungeon V2/Authored Module Descriptor")]
    public sealed class DungeonAuthoredModuleDescriptorAssetV2 : ScriptableObject
    {
        public const int CurrentSchemaVersion = 3;

        [SerializeField] private int schemaVersion = CurrentSchemaVersion;
        [SerializeField] private string templateId;
        [SerializeField] private string descriptorId;
        [SerializeField] private string variantId;
        [SerializeField] private string verticalCompositionId;
        [SerializeField] private DungeonMacroRoleKindV2[] compatibleMacroRoles =
            Array.Empty<DungeonMacroRoleKindV2>();
        [SerializeField] private DungeonTopologyEdgeDescriptorDataV2[] topologyEdges =
            Array.Empty<DungeonTopologyEdgeDescriptorDataV2>();

        [Header("Composition")]
        [SerializeField] private string compositionId;
        [SerializeField] private DungeonModuleArchetypeV2 archetype;
        [SerializeField] private DungeonModuleSizeClassV2 sizeClass;
        [SerializeField] private DungeonBiomeDistrictKindV2[] districts =
            Array.Empty<DungeonBiomeDistrictKindV2>();
        [SerializeField] private DungeonModuleTraversalTierV2[] traversalTiers =
            Array.Empty<DungeonModuleTraversalTierV2>();
        [SerializeField] private DungeonModuleSemanticFeatureV2[] requiredSemanticFeatures =
            Array.Empty<DungeonModuleSemanticFeatureV2>();
        [SerializeField] private DungeonPlatformPurposeDescriptorDataV2[] platformPurposes =
            Array.Empty<DungeonPlatformPurposeDescriptorDataV2>();
        [SerializeField] private DungeonStructuralSupportKindV2[] requiredSupports =
            Array.Empty<DungeonStructuralSupportKindV2>();
        [SerializeField] private DungeonMechanismProfileV2[] mechanismProfiles =
            Array.Empty<DungeonMechanismProfileV2>();
        [SerializeField] private DungeonStoryVignetteProfileV2 storyVignette;
        [SerializeField] private DungeonLightingProfileV2[] lightingProfiles =
            Array.Empty<DungeonLightingProfileV2>();
        [SerializeField] private DungeonPropProfileV2 propProfile;
        [SerializeField] private int minimumRegions;
        [SerializeField] private int minimumRouteDecisions;
        [SerializeField] private bool requiresInternalLoop;
        [SerializeField] private bool requiresRewardBranch;
        [SerializeField] private string descriptorRevisionHash;

        public int SchemaVersion => schemaVersion;
        public string TemplateId => templateId;
        public string DescriptorId => descriptorId;
        public string VariantId => variantId;
        public string VerticalCompositionId => string.IsNullOrWhiteSpace(verticalCompositionId)
            ? null
            : verticalCompositionId;
        public DungeonModuleArchetypeV2 Archetype => archetype;
        public string DescriptorRevisionHash => descriptorRevisionHash;

        public void Store(
            string stableTemplateId,
            string stableDescriptorId,
            string stableVariantId,
            DungeonModuleCompositionContractV2 composition,
            IEnumerable<DungeonMacroRoleKindV2> macroRoles,
            IEnumerable<DungeonAuthoredModuleTopologyEdgeV2> edges,
            string stableVerticalCompositionId)
        {
            if (composition == null) throw new ArgumentNullException(nameof(composition));
            schemaVersion = CurrentSchemaVersion;
            templateId = RequireId(stableTemplateId, nameof(stableTemplateId));
            descriptorId = RequireId(stableDescriptorId, nameof(stableDescriptorId));
            variantId = RequireId(stableVariantId, nameof(stableVariantId));
            verticalCompositionId = OptionalId(stableVerticalCompositionId);
            compatibleMacroRoles = Canonical(macroRoles);
            topologyEdges = (edges ?? throw new ArgumentNullException(nameof(edges)))
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .Select(value => new DungeonTopologyEdgeDescriptorDataV2(value))
                .ToArray();
            compositionId = composition.Id;
            archetype = composition.Archetype;
            sizeClass = composition.SizeClass;
            districts = composition.Districts.ToArray();
            traversalTiers = composition.TraversalTiers.ToArray();
            requiredSemanticFeatures = composition.RequiredSemanticFeatures.ToArray();
            platformPurposes = composition.PlatformPurposes
                .OrderBy(value => value.PlatformId, StringComparer.Ordinal)
                .Select(value => new DungeonPlatformPurposeDescriptorDataV2(value))
                .ToArray();
            requiredSupports = composition.RequiredSupports.ToArray();
            mechanismProfiles = composition.MechanismProfiles.ToArray();
            storyVignette = composition.StoryVignette;
            lightingProfiles = composition.LightingProfiles.ToArray();
            propProfile = composition.PropProfile;
            minimumRegions = composition.MinimumRegions;
            minimumRouteDecisions = composition.MinimumRouteDecisions;
            requiresInternalLoop = composition.RequiresInternalLoop;
            requiresRewardBranch = composition.RequiresRewardBranch;
            descriptorRevisionHash = ComputeCurrentRevisionHash();
        }

        public bool TryBuildDefinition(
            CertifiedDungeonModuleGeometryV2 geometry,
            string presentationDependencyHash,
            out IndustrialFactoryV2ModuleDefinition definition,
            out string error)
        {
            definition = null;
            if (schemaVersion != CurrentSchemaVersion)
            {
                error = "Authored descriptor schema is " + schemaVersion + "; expected "
                    + CurrentSchemaVersion + ".";
                return false;
            }
            if (!string.Equals(descriptorRevisionHash, ComputeCurrentRevisionHash(), StringComparison.Ordinal))
            {
                error = "Authored descriptor '" + descriptorId + "' has stale or tampered metadata.";
                return false;
            }
            if (geometry == null || !string.Equals(templateId, geometry.TemplateId, StringComparison.Ordinal))
            {
                error = "Authored descriptor '" + descriptorId + "' does not match its certified geometry.";
                return false;
            }

            try
            {
                DungeonModuleCompositionContractV2 composition = BuildComposition();
                definition = new IndustrialFactoryV2ModuleDefinition(
                    templateId,
                    variantId,
                    composition,
                    compatibleMacroRoles,
                    geometry,
                    topologyEdges.Select(value => value.ToCore()),
                    presentationDependencyHash,
                    VerticalCompositionId);
                if (!string.Equals(definition.DescriptorId, descriptorId, StringComparison.Ordinal))
                {
                    error = "Descriptor ID '" + descriptorId + "' does not match Core identity '"
                        + definition.DescriptorId + "'.";
                    definition = null;
                    return false;
                }
            }
            catch (Exception exception)
            {
                error = exception.Message;
                definition = null;
                return false;
            }

            error = string.Empty;
            return true;
        }

        public string ComputeCurrentRevisionHash()
        {
            var lines = new List<string>
            {
                schemaVersion.ToString(CultureInfo.InvariantCulture),
                templateId ?? string.Empty,
                descriptorId ?? string.Empty,
                variantId ?? string.Empty,
                verticalCompositionId ?? string.Empty,
                compositionId ?? string.Empty,
                ((int)archetype).ToString(CultureInfo.InvariantCulture),
                ((int)sizeClass).ToString(CultureInfo.InvariantCulture),
                minimumRegions.ToString(CultureInfo.InvariantCulture),
                minimumRouteDecisions.ToString(CultureInfo.InvariantCulture),
                requiresInternalLoop ? "1" : "0",
                requiresRewardBranch ? "1" : "0",
                ((int)storyVignette).ToString(CultureInfo.InvariantCulture),
                ((int)propProfile).ToString(CultureInfo.InvariantCulture)
            };
            AddEnums(lines, compatibleMacroRoles);
            AddEnums(lines, districts);
            AddEnums(lines, traversalTiers);
            AddEnums(lines, requiredSemanticFeatures);
            AddEnums(lines, requiredSupports);
            AddEnums(lines, mechanismProfiles);
            AddEnums(lines, lightingProfiles);
            foreach (DungeonPlatformPurposeDescriptorDataV2 purpose in platformPurposes
                .OrderBy(value => value.PlatformId, StringComparer.Ordinal))
            {
                lines.Add("platform|" + purpose.PlatformId + "|" + (int)purpose.Purpose
                    + "|" + (purpose.TargetId ?? string.Empty));
            }
            foreach (DungeonTopologyEdgeDescriptorDataV2 edge in topologyEdges
                .OrderBy(value => value.StableId, StringComparer.Ordinal))
            {
                lines.Add("edge|" + edge.StableId + "|" + edge.FromLocalRegionId + "|"
                    + edge.ToLocalRegionId + "|" + (int)edge.Kind + "|"
                    + (edge.Bidirectional ? "1" : "0"));
            }
            return Hash(lines);
        }

        private DungeonModuleCompositionContractV2 BuildComposition() =>
            new DungeonModuleCompositionContractV2(
                compositionId,
                archetype,
                sizeClass,
                districts,
                traversalTiers,
                requiredSemanticFeatures,
                platformPurposes.Select(value => value.ToCore()),
                requiredSupports,
                mechanismProfiles,
                storyVignette,
                lightingProfiles,
                propProfile,
                minimumRegions,
                minimumRouteDecisions,
                requiresInternalLoop,
                requiresRewardBranch);

        private static T[] Canonical<T>(IEnumerable<T> values) where T : struct =>
            (values ?? throw new ArgumentNullException(nameof(values)))
                .Distinct()
                .OrderBy(value => Convert.ToInt32(value, CultureInfo.InvariantCulture))
                .ToArray();

        private static void AddEnums<T>(ICollection<string> lines, IEnumerable<T> values)
        {
            lines.Add(typeof(T).FullName + "|" + string.Join(",", (values ?? Enumerable.Empty<T>())
                .Select(value => Convert.ToInt32(value, CultureInfo.InvariantCulture)
                    .ToString(CultureInfo.InvariantCulture))));
        }

        private static string RequireId(string value, string parameterName)
        {
            if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException("Stable ID is required.", parameterName);
            return value.Trim();
        }

        private static string OptionalId(string value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

        private static string Hash(IEnumerable<string> lines)
        {
            using (SHA256 algorithm = SHA256.Create())
            {
                byte[] digest = algorithm.ComputeHash(Encoding.UTF8.GetBytes(string.Join("\n", lines)));
                return "sha256:" + string.Concat(digest.Select(value =>
                    value.ToString("x2", CultureInfo.InvariantCulture)));
            }
        }
    }
}
