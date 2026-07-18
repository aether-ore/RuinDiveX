using System;
using System.Collections.Generic;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Core.Dungeon.V2;

namespace RuinCrawler.Runtime.Persistence
{
    /// <summary>
    /// Enforces the single supported dungeon format at the durable save
    /// boundary. Obsolete dungeon records are discarded instead of translated:
    /// source inventory, workshop state, and Boss Hunt selection remain intact,
    /// while Camp is left able to begin a fresh canonical V2 expedition.
    /// </summary>
    public static class V2OnlyCampaignStatePolicy
    {
        public static V2OnlyCampaignStateResult Normalize(CampaignStateV1 source)
        {
            if (source == null)
            {
                throw new ArgumentNullException(nameof(source));
            }

            CampaignStateV1 state = CampaignStateRepair.Repair(source.Clone());
            state.bossHunts ??= new BossHuntStateV1();
            state.expedition ??= new ExpeditionSourceStateV1();
            state.knownRuins ??= new List<KnownRuinV1>();
            state.expeditionResolutionHistory ??= new List<ExpeditionResolutionHistoryV1>();

            bool changed = false;
            bool activeDungeonReset = false;
            string activeId = NormalizeOptional(state.bossHunts.activeExpeditionId);
            string selectedBoss = NormalizeOptional(state.bossHunts.selectedProfileId);
            if (!string.Equals(state.bossHunts.activeExpeditionId, activeId, StringComparison.Ordinal))
            {
                state.bossHunts.activeExpeditionId = activeId;
                changed = true;
            }

            if (!string.Equals(state.bossHunts.selectedProfileId, selectedBoss, StringComparison.Ordinal))
            {
                state.bossHunts.selectedProfileId = selectedBoss;
                changed = true;
            }

            if (activeId != null)
            {
                if (!IsCurrentV2Expedition(state))
                {
                    PreserveSelectedBossHunt(state);
                    state.bossHunts.activeExpeditionId = null;
                    state.bossHunts.selectionLocked = false;
                    state.expedition = new ExpeditionSourceStateV1();
                    changed = true;
                    activeDungeonReset = true;
                }
                else if (!state.bossHunts.selectionLocked)
                {
                    state.bossHunts.selectionLocked = true;
                    changed = true;
                }
            }
            else
            {
                if (state.bossHunts.selectionLocked)
                {
                    state.bossHunts.selectionLocked = false;
                    changed = true;
                }

                if (HasDungeonSourceIdentity(state.expedition))
                {
                    PreserveSelectedBossHunt(state);
                    state.expedition = new ExpeditionSourceStateV1();
                    changed = true;
                    activeDungeonReset = true;
                }
            }

            int removedKnownRuins = state.knownRuins.RemoveAll(value =>
                !IsCurrentV2KnownRuin(value));
            int removedResolutionHistory = state.expeditionResolutionHistory.RemoveAll(value =>
                !IsCurrentV2Resolution(value));
            int removedHistoryRecords = removedKnownRuins + removedResolutionHistory;
            changed |= removedHistoryRecords > 0;

            string warning = BuildWarning(activeDungeonReset, removedHistoryRecords);
            return new V2OnlyCampaignStateResult(
                state,
                changed,
                activeDungeonReset,
                removedKnownRuins,
                removedResolutionHistory,
                warning);
        }

        public static bool IsCurrentV2Expedition(CampaignStateV1 state)
        {
            string activeId = NormalizeOptional(state?.bossHunts?.activeExpeditionId);
            ExpeditionSourceStateV1 expedition = state?.expedition;
            if (activeId == null || expedition == null
                || !string.Equals(activeId, NormalizeOptional(expedition.expeditionId), StringComparison.Ordinal)
                || string.IsNullOrWhiteSpace(expedition.runSeed)
                || !HasCurrentDungeonIdentity(
                    expedition.dungeonProfileId,
                    expedition.dungeonRulesetVersion,
                    expedition.dungeonContentPackVersion))
            {
                return false;
            }

            string planId = NormalizeOptional(expedition.dungeonPlanId);
            string ruinId = NormalizeOptional(expedition.ruinId);
            return planId != null
                && string.Equals(ruinId, "ruin:" + planId, StringComparison.Ordinal);
        }

        private static bool IsCurrentV2KnownRuin(KnownRuinV1 ruin)
        {
            if (ruin == null
                || string.IsNullOrWhiteSpace(ruin.runSeed)
                || !HasCurrentDungeonIdentity(
                    ruin.dungeonProfileId,
                    ruin.dungeonRulesetVersion,
                    ruin.dungeonContentPackVersion))
            {
                return false;
            }

            string planId = NormalizeOptional(ruin.dungeonPlanId);
            return planId != null
                && string.Equals(
                    NormalizeOptional(ruin.ruinId),
                    "ruin:" + planId,
                    StringComparison.Ordinal);
        }

        private static bool IsCurrentV2Resolution(ExpeditionResolutionHistoryV1 history)
        {
            if (history == null
                || string.IsNullOrWhiteSpace(history.runSeed)
                || !HasCurrentDungeonIdentity(
                    history.dungeonProfileId,
                    history.dungeonRulesetVersion,
                    history.dungeonContentPackVersion))
            {
                return false;
            }

            string planId = NormalizeOptional(history.dungeonPlanId);
            return planId != null
                && string.Equals(
                    NormalizeOptional(history.ruinId),
                    "ruin:" + planId,
                    StringComparison.Ordinal);
        }

        private static bool HasCurrentDungeonIdentity(
            string profileId,
            string rulesetVersion,
            string contentPackVersion)
        {
            return string.Equals(
                    NormalizeOptional(profileId),
                    IndustrialFactoryV2Ruleset.ProfileId,
                    StringComparison.Ordinal)
                && string.Equals(
                    NormalizeOptional(rulesetVersion),
                    IndustrialFactoryV2Ruleset.RulesetVersion,
                    StringComparison.Ordinal)
                && string.Equals(
                    NormalizeOptional(contentPackVersion),
                    IndustrialFactoryV2Ruleset.ContentPackVersion,
                    StringComparison.Ordinal);
        }

        private static bool HasDungeonSourceIdentity(ExpeditionSourceStateV1 expedition)
        {
            return expedition != null
                && (NormalizeOptional(expedition.expeditionId) != null
                    || NormalizeOptional(expedition.runSeed) != null
                    || NormalizeOptional(expedition.dungeonProfileId) != null
                    || NormalizeOptional(expedition.dungeonRulesetVersion) != null
                    || NormalizeOptional(expedition.dungeonContentPackVersion) != null
                    || NormalizeOptional(expedition.dungeonPlanId) != null
                    || NormalizeOptional(expedition.ruinId) != null
                    || NormalizeOptional(expedition.bossProfileId) != null);
        }

        private static void PreserveSelectedBossHunt(CampaignStateV1 state)
        {
            if (string.IsNullOrWhiteSpace(state.bossHunts.selectedProfileId)
                && !string.IsNullOrWhiteSpace(state.expedition?.bossProfileId))
            {
                state.bossHunts.selectedProfileId = state.expedition.bossProfileId.Trim();
            }
        }

        private static string BuildWarning(bool activeDungeonReset, int removedHistoryRecords)
        {
            string warning = activeDungeonReset
                ? "The saved dungeon was incompatible with the current generated ruin format and was reset. "
                    + "Inventory, workshop progress, and Boss Hunt selection were preserved; "
                    + "use the Camp entrance to start a fresh expedition."
                : null;
            if (removedHistoryRecords <= 0)
            {
                return warning;
            }

            string historyWarning = "Removed " + removedHistoryRecords
                + " incompatible dungeon history record(s).";
            return warning == null ? historyWarning : warning + " " + historyWarning;
        }

        private static string NormalizeOptional(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        }
    }

    public sealed class V2OnlyCampaignStateResult
    {
        public V2OnlyCampaignStateResult(
            CampaignStateV1 state,
            bool changed,
            bool activeDungeonReset,
            int removedKnownRuins,
            int removedResolutionHistory,
            string warning)
        {
            State = state ?? throw new ArgumentNullException(nameof(state));
            Changed = changed;
            ActiveDungeonReset = activeDungeonReset;
            RemovedKnownRuins = Math.Max(0, removedKnownRuins);
            RemovedResolutionHistory = Math.Max(0, removedResolutionHistory);
            Warning = string.IsNullOrWhiteSpace(warning) ? null : warning.Trim();
        }

        public CampaignStateV1 State { get; }
        public bool Changed { get; }
        public bool ActiveDungeonReset { get; }
        public int RemovedKnownRuins { get; }
        public int RemovedResolutionHistory { get; }
        public string Warning { get; }
    }
}
