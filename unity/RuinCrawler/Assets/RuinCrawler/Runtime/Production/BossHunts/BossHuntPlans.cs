using System;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Core.Reaverbots;
using RuinCrawler.Runtime.Reaverbots;

namespace RuinCrawler.Runtime.BossHunts
{
    public sealed class BossHuntSpawnContext
    {
        public BossHuntSpawnContext(
            string profileId,
            string expeditionId,
            string runSeed,
            int threatTier = 8)
        {
            if (string.IsNullOrWhiteSpace(profileId)) throw new ArgumentException("A profile id is required.", nameof(profileId));
            if (string.IsNullOrWhiteSpace(expeditionId)) throw new ArgumentException("An expedition id is required.", nameof(expeditionId));
            if (string.IsNullOrWhiteSpace(runSeed)) throw new ArgumentException("A run seed is required.", nameof(runSeed));
            ProfileId = profileId.Trim();
            ExpeditionId = expeditionId.Trim();
            RunSeed = runSeed.Trim();
            ThreatTier = Math.Max(1, Math.Min(8, threatTier));
        }

        public string ProfileId { get; }
        public string ExpeditionId { get; }
        public string RunSeed { get; }
        public int ThreatTier { get; }

        public static BossHuntSpawnContext FromCampaign(CampaignStateV1 state, int threatTier = 8)
        {
            if (state == null) throw new ArgumentNullException(nameof(state));
            if (!state.bossHunts.selectionLocked
                || string.IsNullOrWhiteSpace(state.bossHunts.activeExpeditionId)
                || string.IsNullOrWhiteSpace(state.expedition.bossProfileId)
                || string.IsNullOrWhiteSpace(state.expedition.runSeed)
                || !string.Equals(
                    state.bossHunts.activeExpeditionId,
                    state.expedition.expeditionId,
                    StringComparison.Ordinal)
                || !string.Equals(
                    state.bossHunts.selectedProfileId,
                    state.expedition.bossProfileId,
                    StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Campaign does not contain a locked Boss Hunt expedition.");
            }

            return new BossHuntSpawnContext(
                state.expedition.bossProfileId,
                state.bossHunts.activeExpeditionId,
                state.expedition.runSeed,
                threatTier);
        }
    }

    public sealed class BossHuntSpawnPlan
    {
        private static readonly string[] DisplayPrefixes = { "OM", "RA", "UR", "VA", "ZA", "TO", "KA", "MU" };
        private static readonly string[] DisplaySuffixes = { "RAK", "GAR", "ORA", "VAN", "ZUN", "KIR", "XEL", "TUM" };

        private BossHuntSpawnPlan(
            BossHuntProfile profile,
            BossGenerationVariant variant,
            int variantIndex,
            ReaverbotSpawnRequest request,
            BossVictoryPlan victory)
        {
            Profile = profile;
            Variant = variant;
            VariantIndex = variantIndex;
            Request = request;
            Victory = victory;
        }

        public BossHuntProfile Profile { get; }
        public BossGenerationVariant Variant { get; }
        public int VariantIndex { get; }
        public ReaverbotSpawnRequest Request { get; }
        public BossVictoryPlan Victory { get; }

        public static BossHuntSpawnPlan Create(BossHuntCatalog catalog, BossHuntSpawnContext context)
        {
            if (catalog == null) throw new ArgumentNullException(nameof(catalog));
            if (context == null) throw new ArgumentNullException(nameof(context));
            BossHuntProfile profile = catalog.GetRequired(context.ProfileId);

            var random = new ReaverbotSeededRandom(context.RunSeed + ":" + profile.Id + ":boss");
            int variantIndex = (int)Math.Floor(random.NextDouble() * profile.Variants.Count);
            variantIndex = Math.Max(0, Math.Min(profile.Variants.Count - 1, variantIndex));
            BossGenerationVariant variant = profile.Variants[variantIndex];

            string bossId = "boss-hunt:v1:" + profile.Id + ":" + context.ExpeditionId;
            var request = new ReaverbotSpawnRequest
            {
                runSeed = context.RunSeed,
                encounterId = "boss-hunt:" + context.ExpeditionId,
                slotIndex = 0,
                threatTier = context.ThreatTier,
                intent = profile.Intent,
                encounterSize = 1,
                elite = false,
                isBoss = true,
                healthMultiplier = 1d,
                bossBudgetBonus = 12,
                bossProfileId = profile.Id,
                bossSafeOverload = profile.BossSafeOverload,
                archetypeId = profile.ArchetypeId,
                bodyPlanId = variant.BodyPlanId,
                weaponId = profile.WeaponId,
                defenseId = variant.DefenseId,
                weakPointId = variant.WeakPointId,
                displayNameOverride = CreateDisplayName(profile, context.RunSeed, context.ThreatTier),
                stableSpawnIdOverride = bossId,
                generationSeedOverride = context.RunSeed + ":" + profile.Id + ":genome",
            };

            BossRewardV1 first = profile.RewardMaterial.ToReward(1);
            // Unity's current campaign contract records a concrete reward with
            // every resolved victory. Repeat outcomes therefore use the same
            // source-authored signature material, deterministically, rather
            // than inventing a second loot table at the scene boundary.
            BossRewardV1 repeat = profile.RewardMaterial.ToReward(1);
            return new BossHuntSpawnPlan(
                profile,
                variant,
                variantIndex,
                request,
                new BossVictoryPlan(
                    CreateVictoryId(profile.Id, context.ExpeditionId),
                    profile.Id,
                    context.ExpeditionId,
                    first,
                    repeat));
        }

        public static string CreateVictoryId(string profileId, string expeditionId)
        {
            if (string.IsNullOrWhiteSpace(profileId) || string.IsNullOrWhiteSpace(expeditionId))
                throw new ArgumentException("Profile and expedition ids are required for victory identity.");
            return "boss-victory:v1:" + profileId.Trim() + ":" + expeditionId.Trim();
        }

        private static string CreateDisplayName(BossHuntProfile profile, string runSeed, int threatTier)
        {
            if (profile.HasFixedDisplayName) return profile.DisplayName;
            var random = new ReaverbotSeededRandom(runSeed + ":" + profile.Id + ":display-name");
            int serialLimit = 9 + Math.Max(1, threatTier) * 7;
            return random.Pick(DisplayPrefixes)
                + "-" + random.Pick(DisplaySuffixes)
                + " " + random.RangeInclusive(1, serialLimit).ToString("D2")
                + " · " + profile.Title;
        }
    }

    public sealed class BossVictoryPlan
    {
        internal BossVictoryPlan(
            string victoryId,
            string profileId,
            string expeditionId,
            BossRewardV1 firstClearReward,
            BossRewardV1 repeatReward)
        {
            VictoryId = victoryId;
            ProfileId = profileId;
            ExpeditionId = expeditionId;
            FirstClearReward = firstClearReward;
            RepeatReward = repeatReward;
        }

        public string VictoryId { get; }
        public string ProfileId { get; }
        public string ExpeditionId { get; }
        public BossRewardV1 FirstClearReward { get; }
        public BossRewardV1 RepeatReward { get; }

        public WorkshopTransactionResult Resolve(CampaignStateV1 state, string committedAtUtc)
        {
            BossVictoryResolutionInputs inputs = CreateResolutionInputs(state);
            return RollWorkshopService.ResolveBossVictory(
                state,
                VictoryId,
                ProfileId,
                ExpeditionId,
                FirstClearReward,
                inputs.RewardEligible ? RepeatReward : null,
                committedAtUtc);
        }

        public BossVictoryResolutionInputs CreateResolutionInputs(CampaignStateV1 state)
        {
            if (state == null) throw new ArgumentNullException(nameof(state));
            bool firstClear = true;
            foreach (string clearedProfileId in state.bossHunts?.clearedProfileIds ?? new System.Collections.Generic.List<string>())
            {
                if (string.Equals(clearedProfileId, ProfileId, StringComparison.Ordinal))
                {
                    firstClear = false;
                    break;
                }
            }

            int priorVictories = 0;
            foreach (BossVictoryHistoryV1 history in state.bossHunts?.victoryHistory
                ?? new System.Collections.Generic.List<BossVictoryHistoryV1>())
            {
                if (history != null && string.Equals(history.profileId, ProfileId, StringComparison.Ordinal))
                    priorVictories += 1;
            }
            int victoryIndex = priorVictories + 1;
            double roll = BossRewardDeterminism.GetRepeatRewardRoll(
                state.campaignId,
                ProfileId,
                victoryIndex);
            return new BossVictoryResolutionInputs(
                firstClear,
                victoryIndex,
                roll,
                firstClear || roll < BossRewardDeterminism.RepeatRewardChance);
        }
    }

    public sealed class BossVictoryResolutionInputs
    {
        internal BossVictoryResolutionInputs(
            bool firstClear,
            int victoryIndex,
            double deterministicRoll,
            bool rewardEligible)
        {
            FirstClear = firstClear;
            VictoryIndex = victoryIndex;
            DeterministicRoll = deterministicRoll;
            RewardEligible = rewardEligible;
        }
        public bool FirstClear { get; }
        public int VictoryIndex { get; }
        public double DeterministicRoll { get; }
        public bool RewardEligible { get; }
        public bool RepeatRewardEligible => !FirstClear && RewardEligible;
    }

    public static class BossRewardDeterminism
    {
        public const double RepeatRewardChance = 0.70d;
        private const double UInt32Range = 4294967296d;

        /// <summary>
        /// Bit-for-bit FNV-1a reward roll from BusterLabStorage.js. Unlike the
        /// procedural generation hash, the source reward roll intentionally
        /// does not apply the post-hash avalanche.
        /// </summary>
        public static double GetRepeatRewardRoll(string campaignId, string profileId, int victoryIndex)
        {
            int index = Math.Max(1, victoryIndex);
            string text = (campaignId ?? string.Empty)
                + ":" + (profileId ?? string.Empty)
                + ":" + index;
            uint hash = 0x811c9dc5u;
            unchecked
            {
                for (int characterIndex = 0; characterIndex < text.Length; characterIndex += 1)
                {
                    hash ^= text[characterIndex];
                    hash *= 0x01000193u;
                }
            }
            return hash / UInt32Range;
        }
    }
}
