using System;
using System.Collections.Generic;
using RuinCrawler.Core.Campaign;
using UnityEngine;

namespace RuinCrawler.Runtime.Contracts
{
    public sealed class UnityContractCatalog
    {
        private readonly Dictionary<string, SalvageMaterialContract> _materials;
        private readonly Dictionary<string, WorkshopRecipeV1> _recipes;
        private readonly Dictionary<string, BossProfileContract> _bossProfiles;
        private readonly Dictionary<string, FixedGearEffectContract> _gearEffects;
        private readonly HashSet<string> _moduleIds;

        private UnityContractCatalog(
            int contractVersion,
            Dictionary<string, SalvageMaterialContract> materials,
            Dictionary<string, WorkshopRecipeV1> recipes,
            Dictionary<string, BossProfileContract> bossProfiles,
            Dictionary<string, FixedGearEffectContract> gearEffects,
            HashSet<string> moduleIds)
        {
            ContractVersion = contractVersion;
            _materials = materials;
            _recipes = recipes;
            _bossProfiles = bossProfiles;
            _gearEffects = gearEffects;
            _moduleIds = moduleIds;
        }

        public int ContractVersion { get; }
        public IReadOnlyDictionary<string, SalvageMaterialContract> Materials => _materials;
        public IReadOnlyDictionary<string, WorkshopRecipeV1> Recipes => _recipes;
        public IReadOnlyDictionary<string, BossProfileContract> BossProfiles => _bossProfiles;
        public IReadOnlyDictionary<string, FixedGearEffectContract> GearEffects => _gearEffects;
        public IEnumerable<string> ModuleIds => _moduleIds;

        public static UnityContractCatalog Parse(string json)
        {
            if (string.IsNullOrWhiteSpace(json))
            {
                throw new ArgumentException("Unity contract JSON is empty.", nameof(json));
            }

            ContractPackDto pack = JsonUtility.FromJson<ContractPackDto>(json);
            if (pack == null || pack.contractVersion != 1)
            {
                throw new InvalidOperationException("Unsupported Unity contract pack version.");
            }

            var errors = new List<string>();
            var materials = new Dictionary<string, SalvageMaterialContract>(StringComparer.Ordinal);
            foreach (SalvageMaterialDto source in pack.salvage?.materials ?? Array.Empty<SalvageMaterialDto>())
            {
                if (source == null || string.IsNullOrWhiteSpace(source.id) || materials.ContainsKey(source.id))
                {
                    errors.Add("invalid-or-duplicate-material:" + (source?.id ?? "<missing>"));
                    continue;
                }

                materials.Add(source.id, new SalvageMaterialContract(
                    source.id,
                    source.name,
                    source.family,
                    source.aspect,
                    source.tier,
                    source.color,
                    source.description));
            }

            var recipes = new Dictionary<string, WorkshopRecipeV1>(StringComparer.Ordinal);
            foreach (RecipeDto source in pack.recipes?.equipment ?? Array.Empty<RecipeDto>())
            {
                AddRecipe(source, isBuster: false, recipes, materials, errors);
            }

            foreach (RecipeDto source in pack.recipes?.buster ?? Array.Empty<RecipeDto>())
            {
                AddRecipe(source, isBuster: true, recipes, materials, errors);
            }

            var modules = new HashSet<string>(StringComparer.Ordinal);
            foreach (BusterModuleDto source in pack.buster?.modules ?? Array.Empty<BusterModuleDto>())
            {
                if (source != null && !string.IsNullOrWhiteSpace(source.id) && !modules.Add(source.id))
                {
                    errors.Add("duplicate-buster-module:" + source.id);
                }
            }

            var bosses = new Dictionary<string, BossProfileContract>(StringComparer.Ordinal);
            foreach (BossProfileDto source in pack.bosses?.profiles ?? Array.Empty<BossProfileDto>())
            {
                if (source == null || string.IsNullOrWhiteSpace(source.id) || bosses.ContainsKey(source.id))
                {
                    errors.Add("invalid-or-duplicate-boss:" + (source?.id ?? "<missing>"));
                    continue;
                }

                if (source.reward != null && !string.IsNullOrEmpty(source.reward.materialId)
                    && !materials.ContainsKey(source.reward.materialId))
                {
                    errors.Add("unknown-boss-reward:" + source.id + ":" + source.reward.materialId);
                }

                bosses.Add(source.id, new BossProfileContract(
                    source.id,
                    source.title,
                    source.displayName,
                    source.roleClue,
                    source.encounterControllerId,
                    source.featured?.aspect,
                    source.featured?.moduleId,
                    source.reward?.materialId,
                    source.reward?.firstClearGuaranteed ?? false));
            }

            var gearEffects = new Dictionary<string, FixedGearEffectContract>(StringComparer.Ordinal);
            foreach (FixedGearDto source in pack.equipment?.fixedGearEffects ?? Array.Empty<FixedGearDto>())
            {
                if (source == null || string.IsNullOrWhiteSpace(source.id) || gearEffects.ContainsKey(source.id)
                    || source.effect == null || string.IsNullOrWhiteSpace(source.effect.id))
                {
                    errors.Add("invalid-or-duplicate-fixed-gear:" + (source?.id ?? "<missing>"));
                    continue;
                }

                gearEffects.Add(source.id, new FixedGearEffectContract(
                    source.id,
                    source.slot,
                    source.allowedSlots,
                    source.effect.id,
                    source.effect.hazardDomain,
                    source.effect.hazardTags));
            }

            if (materials.Count == 0) errors.Add("missing-salvage-materials");
            if (recipes.Count == 0) errors.Add("missing-workshop-recipes");
            if (modules.Count == 0) errors.Add("missing-buster-modules");
            if (bosses.Count == 0) errors.Add("missing-boss-profiles");
            if (gearEffects.Count == 0) errors.Add("missing-fixed-gear-effects");
            if (errors.Count > 0)
            {
                throw new InvalidOperationException("Invalid Unity contract pack: " + string.Join(", ", errors));
            }

            return new UnityContractCatalog(pack.contractVersion, materials, recipes, bosses, gearEffects, modules);
        }

        public CampaignKnownIds CreateKnownIdSet()
        {
            var armIds = new List<string> { "megaBuster" };
            var gearIds = new List<string>(_gearEffects.Keys);
            foreach (WorkshopRecipeV1 recipe in _recipes.Values)
            {
                if (string.Equals(recipe.outputKind, "arm", StringComparison.Ordinal))
                {
                    armIds.Add(recipe.outputId);
                }
                else if (string.Equals(recipe.outputKind, "gear", StringComparison.Ordinal))
                {
                    gearIds.Add(recipe.outputId);
                }
            }

            return new CampaignKnownIds(
                _materials.Keys,
                _recipes.Keys,
                _moduleIds,
                new[] { "custom-buster-chassis", "mega-buster-fixed" },
                armIds,
                gearIds,
                _bossProfiles.Keys);
        }

        private static void AddRecipe(
            RecipeDto source,
            bool isBuster,
            IDictionary<string, WorkshopRecipeV1> recipes,
            IReadOnlyDictionary<string, SalvageMaterialContract> materials,
            ICollection<string> errors)
        {
            string recipeId = source?.recipeId ?? source?.id;
            string outputId = isBuster ? source?.moduleId : source?.outputId ?? source?.output?.id;
            string outputKind = isBuster ? "module" : source?.outputKind ?? source?.output?.kind;
            if (string.IsNullOrWhiteSpace(recipeId) || string.IsNullOrWhiteSpace(outputId)
                || string.IsNullOrWhiteSpace(outputKind) || recipes.ContainsKey(recipeId))
            {
                errors.Add("invalid-or-duplicate-recipe:" + (recipeId ?? "<missing>"));
                return;
            }

            var requirements = new List<WorkshopPartRequirementV1>();
            foreach (PartRequirementDto part in source.parts ?? source.requirements?.parts ?? Array.Empty<PartRequirementDto>())
            {
                if (part == null || string.IsNullOrWhiteSpace(part.materialId) || part.quantity <= 0
                    || !materials.ContainsKey(part.materialId))
                {
                    errors.Add("invalid-recipe-part:" + recipeId + ":" + (part?.materialId ?? "<missing>"));
                    continue;
                }

                requirements.Add(new WorkshopPartRequirementV1
                {
                    materialId = part.materialId,
                    quantity = part.quantity
                });
            }

            recipes.Add(recipeId, new WorkshopRecipeV1
            {
                recipeId = recipeId,
                label = source.label ?? source.name ?? source.outputName ?? outputId,
                outputKind = outputKind,
                outputId = outputId,
                identifiedScrapCost = source.identifiedScrapCost > 0
                    ? source.identifiedScrapCost
                    : source.scrapCost > 0
                        ? source.scrapCost
                        : source.requirements?.identifiedScrap ?? 0,
                requiresDefenseUnlock = source.requiresDefenseUnlock,
                repeatable = false,
                parts = requirements
            });
        }

        [Serializable]
        private sealed class ContractPackDto
        {
            public int contractVersion;
            public SalvageSectionDto salvage;
            public RecipeSectionDto recipes;
            public BusterSectionDto buster;
            public BossSectionDto bosses;
            public EquipmentSectionDto equipment;
        }

        [Serializable]
        private sealed class SalvageSectionDto
        {
            public SalvageMaterialDto[] materials;
        }

        [Serializable]
        private sealed class SalvageMaterialDto
        {
            public string id;
            public string name;
            public string family;
            public string aspect;
            public string tier;
            public string color;
            public string description;
            public string[] craftingTags;
            public string[] exampleUses;
        }

        [Serializable]
        private sealed class RecipeSectionDto
        {
            public RecipeDto[] equipment;
            public RecipeDto[] buster;
        }

        [Serializable]
        private sealed class RecipeDto
        {
            public string id;
            public string recipeId;
            public string label;
            public string name;
            public string outputName;
            public string outputId;
            public string outputKind;
            public string moduleId;
            public int identifiedScrapCost;
            public int scrapCost;
            public bool requiresDefenseUnlock;
            public RecipeOutputDto output;
            public RecipeRequirementsDto requirements;
            public PartRequirementDto[] parts;
        }

        [Serializable]
        private sealed class RecipeOutputDto
        {
            public string id;
            public string kind;
        }

        [Serializable]
        private sealed class RecipeRequirementsDto
        {
            public int identifiedScrap;
            public PartRequirementDto[] parts;
        }

        [Serializable]
        private sealed class PartRequirementDto
        {
            public string materialId;
            public int quantity;
        }

        [Serializable]
        private sealed class BusterSectionDto
        {
            public BusterModuleDto[] modules;
        }

        [Serializable]
        private sealed class BusterModuleDto
        {
            public string id;
        }

        [Serializable]
        private sealed class BossSectionDto
        {
            public BossProfileDto[] profiles;
        }

        [Serializable]
        private sealed class EquipmentSectionDto
        {
            public FixedGearDto[] fixedGearEffects;
        }

        [Serializable]
        private sealed class FixedGearDto
        {
            public string id;
            public string slot;
            public string[] allowedSlots;
            public FixedGearEffectDto effect;
        }

        [Serializable]
        private sealed class FixedGearEffectDto
        {
            public string id;
            public string hazardDomain;
            public string[] hazardTags;
        }

        [Serializable]
        private sealed class BossProfileDto
        {
            public string id;
            public string title;
            public string displayName;
            public string roleClue;
            public string encounterControllerId;
            public BossFeaturedDto featured;
            public BossRewardDto reward;
        }

        [Serializable]
        private sealed class BossFeaturedDto
        {
            public string aspect;
            public string moduleId;
        }

        [Serializable]
        private sealed class BossRewardDto
        {
            public bool firstClearGuaranteed;
            public string materialId;
        }

        public sealed class SalvageMaterialContract
        {
            internal SalvageMaterialContract(
                string id,
                string name,
                string family,
                string aspect,
                string tier,
                string color,
                string description)
            {
                Id = id;
                Name = name ?? id;
                Family = family ?? "Reaverbot Part";
                Aspect = aspect;
                Tier = tier ?? "common";
                Color = color ?? "#c7d0d6";
                Description = description ?? string.Empty;
            }

            public string Id { get; }
            public string Name { get; }
            public string Family { get; }
            public string Aspect { get; }
            public string Tier { get; }
            public string Color { get; }
            public string Description { get; }
        }

        public sealed class BossProfileContract
        {
            internal BossProfileContract(
                string id,
                string title,
                string displayName,
                string roleClue,
                string encounterControllerId,
                string featuredAspect,
                string featuredModuleId,
                string rewardMaterialId,
                bool firstClearGuaranteed)
            {
                Id = id;
                Title = title ?? displayName ?? id;
                DisplayName = displayName ?? Title;
                RoleClue = roleClue ?? string.Empty;
                EncounterControllerId = encounterControllerId ?? id;
                FeaturedAspect = featuredAspect;
                FeaturedModuleId = featuredModuleId;
                RewardMaterialId = rewardMaterialId;
                FirstClearGuaranteed = firstClearGuaranteed;
            }

            public string Id { get; }
            public string Title { get; }
            public string DisplayName { get; }
            public string RoleClue { get; }
            public string EncounterControllerId { get; }
            public string FeaturedAspect { get; }
            public string FeaturedModuleId { get; }
            public string RewardMaterialId { get; }
            public bool FirstClearGuaranteed { get; }
        }

        public sealed class FixedGearEffectContract
        {
            internal FixedGearEffectContract(
                string id,
                string slot,
                string[] allowedSlots,
                string effectId,
                string hazardDomain,
                string[] hazardTags)
            {
                Id = id;
                Slot = slot ?? string.Empty;
                AllowedSlots = Array.AsReadOnly(allowedSlots ?? Array.Empty<string>());
                EffectId = effectId;
                HazardDomain = hazardDomain;
                HazardTags = Array.AsReadOnly(hazardTags ?? Array.Empty<string>());
            }

            public string Id { get; }
            public string Slot { get; }
            public IReadOnlyList<string> AllowedSlots { get; }
            public string EffectId { get; }
            public string HazardDomain { get; }
            public IReadOnlyList<string> HazardTags { get; }
        }
    }
}
