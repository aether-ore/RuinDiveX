using System;
using System.Collections.Generic;
using System.Linq;
using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    /// <summary>
    /// Unity authoring declaration for the pure composition contract. Concrete
    /// feature/platform/support markers below are validated against this record
    /// so merely selecting an archetype in the inspector cannot satisfy the
    /// content gate.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DungeonModuleCompositionAuthoringV2 : MonoBehaviour
    {
        [SerializeField] private string compositionId = "authored-module-composition-v2";
        [SerializeField] private DungeonModuleArchetypeV2 archetype;
        [SerializeField] private DungeonModuleSizeClassV2 sizeClass;
        [SerializeField] private DungeonBiomeDistrictKindV2[] districts = Array.Empty<DungeonBiomeDistrictKindV2>();
        [SerializeField] private DungeonModuleTraversalTierV2[] traversalTiers = Array.Empty<DungeonModuleTraversalTierV2>();
        [SerializeField] private DungeonModuleSemanticFeatureV2[] requiredSemanticFeatures = Array.Empty<DungeonModuleSemanticFeatureV2>();
        [SerializeField] private DungeonPlatformPurposeV2[] requiredPlatformPurposes = Array.Empty<DungeonPlatformPurposeV2>();
        [SerializeField] private DungeonStructuralSupportKindV2[] requiredSupports = Array.Empty<DungeonStructuralSupportKindV2>();
        [SerializeField] private DungeonMechanismProfileV2[] mechanismProfiles = Array.Empty<DungeonMechanismProfileV2>();
        [SerializeField] private DungeonStoryVignetteProfileV2 storyVignette;
        [SerializeField] private DungeonLightingProfileV2[] lightingProfiles = Array.Empty<DungeonLightingProfileV2>();
        [SerializeField] private DungeonPropProfileV2 propProfile;
        [SerializeField, Min(1)] private int minimumRegions = 1;
        [SerializeField, Min(0)] private int minimumRouteDecisions;
        [SerializeField] private bool requiresInternalLoop;
        [SerializeField] private bool requiresRewardBranch;

        public DungeonModuleArchetypeV2 Archetype => archetype;
        public string CompositionId => compositionId;
        public DungeonModuleSizeClassV2 SizeClass => sizeClass;
        public IReadOnlyList<DungeonBiomeDistrictKindV2> Districts => districts;
        public IReadOnlyList<DungeonModuleTraversalTierV2> TraversalTiers => traversalTiers;
        public IReadOnlyList<DungeonModuleSemanticFeatureV2> RequiredSemanticFeatures => requiredSemanticFeatures;
        public IReadOnlyList<DungeonPlatformPurposeV2> RequiredPlatformPurposes => requiredPlatformPurposes;
        public IReadOnlyList<DungeonStructuralSupportKindV2> RequiredSupports => requiredSupports;
        public IReadOnlyList<DungeonMechanismProfileV2> MechanismProfiles => mechanismProfiles;
        public DungeonStoryVignetteProfileV2 StoryVignette => storyVignette;
        public IReadOnlyList<DungeonLightingProfileV2> LightingProfiles => lightingProfiles;
        public DungeonPropProfileV2 PropProfile => propProfile;
        public int MinimumRegions => minimumRegions;
        public int MinimumRouteDecisions => minimumRouteDecisions;
        public bool RequiresInternalLoop => requiresInternalLoop;
        public bool RequiresRewardBranch => requiresRewardBranch;

        public void Configure(
            DungeonModuleArchetypeV2 moduleArchetype,
            DungeonModuleSizeClassV2 moduleSizeClass,
            IEnumerable<DungeonBiomeDistrictKindV2> moduleDistricts,
            IEnumerable<DungeonModuleTraversalTierV2> moduleTraversalTiers,
            IEnumerable<DungeonModuleSemanticFeatureV2> semanticFeatures,
            IEnumerable<DungeonPlatformPurposeV2> platformPurposes,
            IEnumerable<DungeonStructuralSupportKindV2> supportKinds,
            IEnumerable<DungeonMechanismProfileV2> mechanisms,
            DungeonStoryVignetteProfileV2 vignette,
            IEnumerable<DungeonLightingProfileV2> lights,
            DungeonPropProfileV2 props,
            int regionMinimum,
            int routeDecisionMinimum,
            bool internalLoop,
            bool rewardBranch)
        {
            Configure(
                "composition-" + moduleArchetype.ToString().ToLowerInvariant(),
                moduleArchetype,
                moduleSizeClass,
                moduleDistricts,
                moduleTraversalTiers,
                semanticFeatures,
                platformPurposes,
                supportKinds,
                mechanisms,
                vignette,
                lights,
                props,
                regionMinimum,
                routeDecisionMinimum,
                internalLoop,
                rewardBranch);
        }

        public void Configure(
            string stableCompositionId,
            DungeonModuleArchetypeV2 moduleArchetype,
            DungeonModuleSizeClassV2 moduleSizeClass,
            IEnumerable<DungeonBiomeDistrictKindV2> moduleDistricts,
            IEnumerable<DungeonModuleTraversalTierV2> moduleTraversalTiers,
            IEnumerable<DungeonModuleSemanticFeatureV2> semanticFeatures,
            IEnumerable<DungeonPlatformPurposeV2> platformPurposes,
            IEnumerable<DungeonStructuralSupportKindV2> supportKinds,
            IEnumerable<DungeonMechanismProfileV2> mechanisms,
            DungeonStoryVignetteProfileV2 vignette,
            IEnumerable<DungeonLightingProfileV2> lights,
            DungeonPropProfileV2 props,
            int regionMinimum,
            int routeDecisionMinimum,
            bool internalLoop,
            bool rewardBranch)
        {
            compositionId = stableCompositionId;
            archetype = moduleArchetype;
            sizeClass = moduleSizeClass;
            districts = Canonical(moduleDistricts);
            traversalTiers = Canonical(moduleTraversalTiers);
            requiredSemanticFeatures = Canonical(semanticFeatures);
            requiredPlatformPurposes = Canonical(platformPurposes);
            requiredSupports = Canonical(supportKinds);
            mechanismProfiles = Canonical(mechanisms);
            storyVignette = vignette;
            lightingProfiles = Canonical(lights);
            propProfile = props;
            minimumRegions = regionMinimum;
            minimumRouteDecisions = routeDecisionMinimum;
            requiresInternalLoop = internalLoop;
            requiresRewardBranch = rewardBranch;
        }

        public DungeonModuleCompositionContractV2 ToCore()
        {
            DungeonPlatformPurposeBindingV2[] bindings = GetComponentsInChildren<DungeonPlatformPurposeAuthoringV2>(true)
                .OrderBy(value => value.StableId, StringComparer.Ordinal)
                .Select(value => value.ToCore())
                .ToArray();
            return new DungeonModuleCompositionContractV2(
                compositionId,
                archetype,
                sizeClass,
                districts,
                traversalTiers,
                requiredSemanticFeatures,
                bindings,
                requiredSupports,
                mechanismProfiles,
                storyVignette,
                lightingProfiles,
                propProfile,
                minimumRegions,
                minimumRouteDecisions,
                requiresInternalLoop,
                requiresRewardBranch);
        }

        private static T[] Canonical<T>(IEnumerable<T> values) where T : struct
        {
            return (values ?? Array.Empty<T>()).Distinct().OrderBy(value => Convert.ToInt32(value)).ToArray();
        }
    }

}
