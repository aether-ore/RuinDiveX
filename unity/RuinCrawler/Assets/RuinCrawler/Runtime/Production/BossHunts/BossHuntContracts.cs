using System;
using System.Collections.Generic;
using RuinCrawler.Core.Campaign;
using UnityEngine;

namespace RuinCrawler.Runtime.BossHunts
{
    /// <summary>
    /// Immutable projection of the Boss Hunt, salvage-source, and global boss
    /// scale sections in the version-one shared contract pack. The full pack
    /// remains authoritative; this projection deliberately rejects incomplete
    /// profile constraints instead of inventing a gameplay fallback.
    /// </summary>
    public sealed class BossHuntCatalog
    {
        private readonly Dictionary<string, BossHuntProfile> profiles;

        private BossHuntCatalog(
            string defaultProfileId,
            BossStatScales statScales,
            Dictionary<string, BossHuntProfile> profiles)
        {
            DefaultProfileId = defaultProfileId;
            StatScales = statScales;
            this.profiles = profiles;
        }

        public string DefaultProfileId { get; }
        public BossStatScales StatScales { get; }
        public IReadOnlyDictionary<string, BossHuntProfile> Profiles => profiles;

        public BossHuntProfile GetRequired(string profileId)
        {
            if (string.IsNullOrWhiteSpace(profileId)
                || !profiles.TryGetValue(profileId, out BossHuntProfile result))
            {
                throw new KeyNotFoundException("Unknown Boss Hunt profile: " + (profileId ?? "<missing>"));
            }

            return result;
        }

        public static BossHuntCatalog Parse(TextAsset contractPack)
        {
            if (contractPack == null) throw new ArgumentNullException(nameof(contractPack));
            return Parse(contractPack.text);
        }

        public static BossHuntCatalog Parse(string json)
        {
            if (string.IsNullOrWhiteSpace(json))
            {
                throw new ArgumentException("Boss Hunt contract JSON is empty.", nameof(json));
            }

            RootDto root = JsonUtility.FromJson<RootDto>(json);
            if (root == null || root.contractVersion != 1 || root.bosses == null)
            {
                throw new InvalidOperationException("Unsupported or incomplete Boss Hunt contract pack.");
            }

            var materials = new Dictionary<string, RewardMaterialDto>(StringComparer.Ordinal);
            foreach (RewardMaterialDto material in root.salvage?.materials ?? Array.Empty<RewardMaterialDto>())
            {
                if (material == null || string.IsNullOrWhiteSpace(material.id) || materials.ContainsKey(material.id))
                {
                    throw new InvalidOperationException("Boss Hunt contract has an invalid or duplicate salvage material.");
                }
                materials.Add(material.id, material);
            }

            var sourceMaterials = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (SourceMapDto map in root.salvage?.sourceMaps ?? Array.Empty<SourceMapDto>())
            {
                if (map == null || string.IsNullOrWhiteSpace(map.aspect)) continue;
                foreach (SourceDto source in map.sources ?? Array.Empty<SourceDto>())
                {
                    if (source == null || string.IsNullOrWhiteSpace(source.moduleId)
                        || string.IsNullOrWhiteSpace(source.materialId)) continue;
                    sourceMaterials[SourceKey(map.aspect, source.moduleId)] = source.materialId;
                }
            }

            var profiles = new Dictionary<string, BossHuntProfile>(StringComparer.Ordinal);
            foreach (ProfileDto source in root.bosses.profiles ?? Array.Empty<ProfileDto>())
            {
                if (source == null || string.IsNullOrWhiteSpace(source.id) || profiles.ContainsKey(source.id))
                {
                    throw new InvalidOperationException("Boss Hunt contract has an invalid or duplicate profile.");
                }
                if (source.generation == null || string.IsNullOrWhiteSpace(source.generation.archetypeId)
                    || string.IsNullOrWhiteSpace(source.generation.weaponId)
                    || source.generation.variants == null || source.generation.variants.Length == 0)
                {
                    throw new InvalidOperationException("Boss Hunt profile is missing pinned generation data: " + source.id);
                }

                var variants = new List<BossGenerationVariant>();
                foreach (VariantDto variant in source.generation.variants)
                {
                    if (variant == null || string.IsNullOrWhiteSpace(variant.bodyPlanId)
                        || string.IsNullOrWhiteSpace(variant.weakPointId))
                    {
                        throw new InvalidOperationException("Boss Hunt profile has an incomplete generation variant: " + source.id);
                    }
                    variants.Add(new BossGenerationVariant(
                        variant.bodyPlanId,
                        variant.defenseId,
                        variant.weakPointId));
                }

                string rewardMaterialId = source.reward?.materialId;
                if (string.IsNullOrWhiteSpace(rewardMaterialId))
                {
                    rewardMaterialId = sourceMaterials.TryGetValue(
                        SourceKey(source.featured?.aspect, source.featured?.moduleId),
                        out string featuredMaterialId)
                        ? featuredMaterialId
                        : null;
                }
                if (string.IsNullOrWhiteSpace(rewardMaterialId)
                    || !materials.TryGetValue(rewardMaterialId, out RewardMaterialDto rewardMaterial))
                {
                    throw new InvalidOperationException("Boss Hunt profile cannot resolve its signature material: " + source.id);
                }

                CombatDto combat = source.combat ?? new CombatDto();
                profiles.Add(source.id, new BossHuntProfile(
                    source.id,
                    source.title,
                    source.displayName,
                    source.roleClue,
                    source.encounterControllerId,
                    source.artStrategy,
                    source.visualProfileId,
                    source.featured?.aspect,
                    source.featured?.moduleId,
                    source.generation.archetypeId,
                    source.generation.intent,
                    source.generation.weaponId,
                    source.generation.bossSafeOverload,
                    variants,
                    Math.Max(1d, combat.healthScale),
                    Clamp01(combat.phaseThreshold <= 0d ? 0.5d : combat.phaseThreshold),
                    Math.Max(0d, combat.phaseTransitionSeconds),
                    combat.phaseOne ?? Array.Empty<string>(),
                    combat.phaseTwo ?? Array.Empty<string>(),
                    new BossRewardMaterial(
                        rewardMaterial.id,
                        rewardMaterial.name,
                        rewardMaterial.family,
                        rewardMaterial.aspect,
                        rewardMaterial.tier),
                    source.reward?.firstClearGuaranteed ?? true));
            }

            if (profiles.Count == 0 || string.IsNullOrWhiteSpace(root.bosses.defaultProfileId)
                || !profiles.ContainsKey(root.bosses.defaultProfileId))
            {
                throw new InvalidOperationException("Boss Hunt default profile is missing or unknown.");
            }

            StatScalesDto scales = root.bosses.statScales ?? new StatScalesDto();
            return new BossHuntCatalog(
                root.bosses.defaultProfileId,
                new BossStatScales(
                    PositiveOr(scales.health, 6.5d),
                    PositiveOr(scales.damage, 1.35d),
                    PositiveOr(scales.armor, 1.25d),
                    PositiveOr(scales.cooldown, 0.9d),
                    PositiveOr(scales.visual, 1.28d),
                    PositiveOr(scales.experience, 6d)),
                profiles);
        }

        private static string SourceKey(string aspect, string moduleId)
            => (aspect ?? string.Empty) + "\u001f" + (moduleId ?? string.Empty);

        private static double PositiveOr(double value, double fallback) => value > 0d ? value : fallback;
        private static double Clamp01(double value) => Math.Max(0d, Math.Min(1d, value));

        [Serializable] private sealed class RootDto { public int contractVersion; public BossesDto bosses; public SalvageDto salvage; }
        [Serializable] private sealed class BossesDto { public string defaultProfileId; public StatScalesDto statScales; public ProfileDto[] profiles; }
        [Serializable] private sealed class StatScalesDto { public double health; public double damage; public double armor; public double cooldown; public double visual; public double experience; }
        [Serializable] private sealed class ProfileDto
        {
            public string id; public string title; public string displayName; public string roleClue;
            public string encounterControllerId; public string artStrategy; public string visualProfileId;
            public FeaturedDto featured; public GenerationDto generation; public CombatDto combat; public RewardDto reward;
        }
        [Serializable] private sealed class FeaturedDto { public string aspect; public string moduleId; }
        [Serializable] private sealed class GenerationDto
        {
            public string archetypeId; public string intent; public string weaponId; public bool bossSafeOverload;
            public VariantDto[] variants;
        }
        [Serializable] private sealed class VariantDto { public string bodyPlanId; public string defenseId; public string weakPointId; }
        [Serializable] private sealed class CombatDto
        {
            public double healthScale; public double phaseThreshold; public double phaseTransitionSeconds;
            public string[] phaseOne; public string[] phaseTwo;
        }
        [Serializable] private sealed class RewardDto { public string materialId; public bool firstClearGuaranteed; }
        [Serializable] private sealed class SalvageDto { public RewardMaterialDto[] materials; public SourceMapDto[] sourceMaps; }
        [Serializable] private sealed class RewardMaterialDto
        {
            public string id; public string name; public string family; public string aspect; public string tier;
        }
        [Serializable] private sealed class SourceMapDto { public string aspect; public SourceDto[] sources; }
        [Serializable] private sealed class SourceDto { public string moduleId; public string materialId; }
    }

    public sealed class BossHuntProfile
    {
        internal BossHuntProfile(
            string id, string title, string displayName, string roleClue,
            string encounterControllerId, string artStrategy, string visualProfileId,
            string featuredAspect, string featuredModuleId,
            string archetypeId, string intent, string weaponId, bool bossSafeOverload,
            IReadOnlyList<BossGenerationVariant> variants,
            double healthScale, double phaseThreshold, double phaseTransitionSeconds,
            IReadOnlyList<string> phaseOneMoves, IReadOnlyList<string> phaseTwoMoves,
            BossRewardMaterial rewardMaterial, bool firstClearGuaranteed)
        {
            Id = id;
            Title = title ?? id;
            HasFixedDisplayName = !string.IsNullOrWhiteSpace(displayName);
            DisplayName = HasFixedDisplayName ? displayName : Title;
            RoleClue = roleClue ?? string.Empty;
            EncounterControllerId = encounterControllerId ?? id;
            ArtStrategy = artStrategy ?? "semanticTextures";
            VisualProfileId = visualProfileId;
            FeaturedAspect = featuredAspect;
            FeaturedModuleId = featuredModuleId;
            ArchetypeId = archetypeId;
            Intent = intent ?? "ranged";
            WeaponId = weaponId;
            BossSafeOverload = bossSafeOverload;
            Variants = variants;
            HealthScale = healthScale;
            PhaseThreshold = phaseThreshold;
            PhaseTransitionSeconds = phaseTransitionSeconds;
            PhaseOneMoves = phaseOneMoves;
            PhaseTwoMoves = phaseTwoMoves;
            RewardMaterial = rewardMaterial;
            FirstClearGuaranteed = firstClearGuaranteed;
        }

        public string Id { get; }
        public string Title { get; }
        public string DisplayName { get; }
        public bool HasFixedDisplayName { get; }
        public string RoleClue { get; }
        public string EncounterControllerId { get; }
        public string ArtStrategy { get; }
        public string VisualProfileId { get; }
        public string FeaturedAspect { get; }
        public string FeaturedModuleId { get; }
        public string ArchetypeId { get; }
        public string Intent { get; }
        public string WeaponId { get; }
        public bool BossSafeOverload { get; }
        public IReadOnlyList<BossGenerationVariant> Variants { get; }
        public double HealthScale { get; }
        public double PhaseThreshold { get; }
        public double PhaseTransitionSeconds { get; }
        public IReadOnlyList<string> PhaseOneMoves { get; }
        public IReadOnlyList<string> PhaseTwoMoves { get; }
        public BossRewardMaterial RewardMaterial { get; }
        public bool FirstClearGuaranteed { get; }
        public bool RequiresAuthoredAdapter => string.Equals(ArtStrategy, "authoredGeometry", StringComparison.Ordinal);
    }

    public sealed class BossGenerationVariant
    {
        internal BossGenerationVariant(string bodyPlanId, string defenseId, string weakPointId)
        {
            BodyPlanId = bodyPlanId;
            DefenseId = defenseId;
            WeakPointId = weakPointId;
        }
        public string BodyPlanId { get; }
        public string DefenseId { get; }
        public string WeakPointId { get; }
    }

    public sealed class BossRewardMaterial
    {
        internal BossRewardMaterial(string id, string name, string family, string aspect, string tier)
        {
            Id = id; Name = name ?? id; Family = family ?? "Reaverbot Part";
            Aspect = aspect ?? string.Empty; Tier = tier ?? "rare";
        }
        public string Id { get; }
        public string Name { get; }
        public string Family { get; }
        public string Aspect { get; }
        public string Tier { get; }
        public BossRewardV1 ToReward(int quantity = 1)
            => new BossRewardV1(Id, Name, Family, Aspect, Tier, Math.Max(1, quantity));
    }

    public sealed class BossStatScales
    {
        internal BossStatScales(double health, double damage, double armor, double cooldown, double visual, double experience)
        {
            Health = health; Damage = damage; Armor = armor; Cooldown = cooldown; Visual = visual; Experience = experience;
        }
        public double Health { get; }
        public double Damage { get; }
        public double Armor { get; }
        public double Cooldown { get; }
        public double Visual { get; }
        public double Experience { get; }
    }
}
