using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Campaign
{
    public sealed class CampaignKnownIds
    {
        public CampaignKnownIds(
            IEnumerable<string> materialIds = null,
            IEnumerable<string> recipeIds = null,
            IEnumerable<string> moduleIds = null,
            IEnumerable<string> chassisIds = null,
            IEnumerable<string> armIds = null,
            IEnumerable<string> gearIds = null,
            IEnumerable<string> bossProfileIds = null)
        {
            MaterialIds = Set(materialIds);
            RecipeIds = Set(recipeIds);
            ModuleIds = Set(moduleIds);
            ChassisIds = Set(chassisIds);
            ArmIds = Set(armIds);
            GearIds = Set(gearIds);
            BossProfileIds = Set(bossProfileIds);
        }

        public ISet<string> MaterialIds { get; }
        public ISet<string> RecipeIds { get; }
        public ISet<string> ModuleIds { get; }
        public ISet<string> ChassisIds { get; }
        public ISet<string> ArmIds { get; }
        public ISet<string> GearIds { get; }
        public ISet<string> BossProfileIds { get; }

        private static ISet<string> Set(IEnumerable<string> values)
        {
            return new HashSet<string>(values ?? Array.Empty<string>(), StringComparer.Ordinal);
        }
    }

    public static class CampaignStateRepair
    {
        public const string NormalizationMigrationId = "unity-campaign-v1-normalization";
        public const string DungeonPersistenceV2MigrationId = "unity-campaign-v2-dungeon-persistence";
        public const string DungeonRewardClaimsV2MigrationId = "unity-campaign-v2-dungeon-reward-claims";

        /// <summary>
        /// Idempotently repairs missing collections/defaults without granting
        /// fabricated content or interpreting unknown catalog ids.
        /// </summary>
        public static CampaignStateV1 Repair(CampaignStateV1 state)
        {
            if (state == null)
            {
                state = CampaignStateV1.CreateDefault();
            }

            state.stateVersion = CampaignStateV1.CurrentStateVersion;
            if (string.IsNullOrWhiteSpace(state.campaignId))
            {
                state.campaignId = "campaign-main";
            }

            state.salvage = state.salvage ?? new SalvageStockpileV1();
            state.salvage.identifiedScrap = Math.Max(0, state.salvage.identifiedScrap);
            state.salvage.parts = state.salvage.parts ?? new List<NamedPartStackV1>();
            state.salvage.parts.RemoveAll(value => value == null || value.quantity <= 0 || string.IsNullOrWhiteSpace(value.materialId));
            state.unidentifiedRecoveries = state.unidentifiedRecoveries ?? new List<UnidentifiedRecoveryV1>();
            state.unidentifiedRecoveries.RemoveAll(value => value == null || value.quantity <= 0 || string.IsNullOrWhiteSpace(value.recoveryId));
            for (int index = 0; index < state.unidentifiedRecoveries.Count; index += 1)
            {
                state.unidentifiedRecoveries[index].recoverableParts =
                    state.unidentifiedRecoveries[index].recoverableParts ?? new List<RecoveryPartV1>();
            }
            state.resolvedRecoveryIds = NormalizeStrings(state.resolvedRecoveryIds);

            state.discoveredSalvageTypeIds = NormalizeStrings(state.discoveredSalvageTypeIds);
            state.discoveryHistory = state.discoveryHistory ?? new List<SalvageDiscoveryV1>();
            state.discoveryHistory.RemoveAll(value => value == null || string.IsNullOrWhiteSpace(value.materialId));
            state.discoveredRecipeIds = NormalizeStrings(state.discoveredRecipeIds);
            state.ownedModuleIds = NormalizeStrings(state.ownedModuleIds);
            state.ownedChassisIds = NormalizeStrings(state.ownedChassisIds);
            state.busterSources = state.busterSources ?? new List<BusterSourceV1>();
            state.busterSources.RemoveAll(value => value == null || string.IsNullOrWhiteSpace(value.buildId));
            for (int index = 0; index < state.busterSources.Count; index += 1)
            {
                state.busterSources[index].modules = state.busterSources[index].modules ?? new List<BusterModuleSourceV1>();
                state.busterSources[index].edges = state.busterSources[index].edges ?? new List<BusterEdgeSourceV1>();
            }
            state.busterRevisionHistory = state.busterRevisionHistory ?? new List<BusterRevisionHistoryV1>();
            state.busterRevisionHistory.RemoveAll(value => value == null || string.IsNullOrWhiteSpace(value.transactionId));
            for (int index = 0; index < state.busterRevisionHistory.Count; index += 1)
            {
                BusterRevisionHistoryV1 history = state.busterRevisionHistory[index];
                if (history.source != null)
                {
                    history.source.modules = history.source.modules ?? new List<BusterModuleSourceV1>();
                    history.source.edges = history.source.edges ?? new List<BusterEdgeSourceV1>();
                }
            }

            state.ownedArmIds = NormalizeStrings(state.ownedArmIds);
            state.ownedGearIds = NormalizeStrings(state.ownedGearIds);
            state.unlockedGearSlotIds = NormalizeStrings(state.unlockedGearSlotIds);
            if (!Contains(state.ownedArmIds, "megaBuster"))
            {
                state.ownedArmIds.Add("megaBuster");
                state.ownedArmIds.Sort(StringComparer.Ordinal);
            }

            if (!Contains(state.ownedGearIds, "reinforcedArmorFrame"))
            {
                state.ownedGearIds.Add("reinforcedArmorFrame");
                state.ownedGearIds.Sort(StringComparer.Ordinal);
            }

            state.armAssignments = NormalizeAssignments(state.armAssignments);
            state.gearAssignments = NormalizeAssignments(state.gearAssignments);
            state.megaCalibration = state.megaCalibration ?? MegaCalibrationV1.Neutral();
            state.fabricationHistory = state.fabricationHistory ?? new List<FabricationHistoryV1>();
            state.fabricationHistory.RemoveAll(value => value == null || string.IsNullOrWhiteSpace(value.transactionId));
            state.bossHunts = state.bossHunts ?? new BossHuntStateV1();
            state.bossHunts.selectedProfileId = NormalizeOptional(
                state.bossHunts.selectedProfileId);
            state.bossHunts.activeExpeditionId = NormalizeOptional(
                state.bossHunts.activeExpeditionId);
            state.bossHunts.clearedProfileIds = NormalizeStrings(state.bossHunts.clearedProfileIds);
            state.bossHunts.resolvedVictoryIds = NormalizeStrings(state.bossHunts.resolvedVictoryIds);
            state.bossHunts.victoryHistory = state.bossHunts.victoryHistory ?? new List<BossVictoryHistoryV1>();
            state.expedition = NormalizeExpedition(state.expedition);
            state.knownRuins = NormalizeKnownRuins(state.knownRuins);
            HydrateActiveKnownRuinIdentity(state);
            state.expeditionResolutionHistory = NormalizeExpeditionResolutionHistory(
                state.expeditionResolutionHistory);
            state.unknownIdQuarantine = state.unknownIdQuarantine ?? new List<QuarantinedUnknownIdV1>();
            state.appliedMigrationIds = NormalizeStrings(state.appliedMigrationIds);
            if (!Contains(state.appliedMigrationIds, NormalizationMigrationId))
            {
                state.appliedMigrationIds.Add(NormalizationMigrationId);
                state.appliedMigrationIds.Sort(StringComparer.Ordinal);
            }

            if (!Contains(state.appliedMigrationIds, DungeonPersistenceV2MigrationId))
            {
                state.appliedMigrationIds.Add(DungeonPersistenceV2MigrationId);
                state.appliedMigrationIds.Sort(StringComparer.Ordinal);
            }

            if (!Contains(state.appliedMigrationIds, DungeonRewardClaimsV2MigrationId))
            {
                state.appliedMigrationIds.Add(DungeonRewardClaimsV2MigrationId);
                state.appliedMigrationIds.Sort(StringComparer.Ordinal);
            }

            return state;
        }

        /// <summary>
        /// Removes foreign ids from authoritative ownership/source arrays and
        /// records each one visibly. Callers supply the live immutable catalog
        /// ids, so old saves are never silently mapped to a different item.
        /// </summary>
        public static CampaignStateV1 QuarantineUnknownIds(
            CampaignStateV1 source,
            CampaignKnownIds known,
            string quarantinedAtUtc)
        {
            if (source == null)
            {
                throw new ArgumentNullException(nameof(source));
            }

            if (known == null)
            {
                throw new ArgumentNullException(nameof(known));
            }

            CampaignStateV1 state = Repair(source.Clone());
            QuarantineStrings(state, state.discoveredSalvageTypeIds, known.MaterialIds, "material", "discoveredSalvageTypeIds", quarantinedAtUtc);
            QuarantineStrings(state, state.discoveredRecipeIds, known.RecipeIds, "recipe", "discoveredRecipeIds", quarantinedAtUtc);
            QuarantineStrings(state, state.ownedModuleIds, known.ModuleIds, "module", "ownedModuleIds", quarantinedAtUtc);
            QuarantineStrings(state, state.ownedChassisIds, known.ChassisIds, "chassis", "ownedChassisIds", quarantinedAtUtc);
            QuarantineStrings(state, state.ownedArmIds, known.ArmIds, "arm", "ownedArmIds", quarantinedAtUtc);
            QuarantineStrings(state, state.ownedGearIds, known.GearIds, "gear", "ownedGearIds", quarantinedAtUtc);

            for (int index = state.salvage.parts.Count - 1; index >= 0; index -= 1)
            {
                NamedPartStackV1 part = state.salvage.parts[index];
                if (!known.MaterialIds.Contains(part.materialId))
                {
                    AddQuarantine(state, "material", part.materialId, "salvage.parts", quarantinedAtUtc);
                    state.salvage.parts.RemoveAt(index);
                }
            }

            QuarantineArmAssignments(state, known.ArmIds, quarantinedAtUtc);
            QuarantineAssignments(state, state.gearAssignments, known.GearIds, "gear", "gearAssignments", quarantinedAtUtc);

            for (int buildIndex = 0; buildIndex < state.busterSources.Count; buildIndex += 1)
            {
                BusterSourceV1 build = state.busterSources[buildIndex];
                if (!known.ChassisIds.Contains(build.chassisId))
                {
                    AddQuarantine(state, "chassis", build.chassisId, "busterSources.chassisId", quarantinedAtUtc);
                    build.chassisId = null;
                }

                for (int moduleIndex = build.modules.Count - 1; moduleIndex >= 0; moduleIndex -= 1)
                {
                    BusterModuleSourceV1 module = build.modules[moduleIndex];
                    if (module == null || !known.ModuleIds.Contains(module.moduleId))
                    {
                        AddQuarantine(state, "module", module?.moduleId, "busterSources.modules", quarantinedAtUtc);
                        build.modules.RemoveAt(moduleIndex);
                    }
                }
            }

            string selectedBoss = state.bossHunts.selectedProfileId;
            if (!string.IsNullOrEmpty(selectedBoss) && !known.BossProfileIds.Contains(selectedBoss))
            {
                AddQuarantine(state, "boss-profile", selectedBoss, "bossHunts.selectedProfileId", quarantinedAtUtc);
                state.bossHunts.selectedProfileId = null;
                state.bossHunts.selectionLocked = false;
                state.bossHunts.activeExpeditionId = null;
            }

            state.unknownIdQuarantine.Sort((left, right) =>
            {
                int category = string.CompareOrdinal(left.category, right.category);
                return category != 0 ? category : string.CompareOrdinal(left.unknownId, right.unknownId);
            });
            return state;
        }

        private static ExpeditionSourceStateV1 NormalizeExpedition(ExpeditionSourceStateV1 source)
        {
            ExpeditionSourceStateV1 expedition = source ?? new ExpeditionSourceStateV1();
            expedition.runSeed = NormalizeOptional(expedition.runSeed);
            expedition.expeditionId = NormalizeOptional(expedition.expeditionId);
            expedition.dungeonProfileId = NormalizeOptional(expedition.dungeonProfileId);
            expedition.dungeonRulesetVersion = NormalizeOptional(
                expedition.dungeonRulesetVersion);
            expedition.dungeonContentPackVersion = NormalizeOptional(
                expedition.dungeonContentPackVersion);
            expedition.dungeonPlanId = NormalizeOptional(expedition.dungeonPlanId);
            if (expedition.dungeonPlanId == null && expedition.expeditionId != null)
            {
                expedition.dungeonPlanId = expedition.expeditionId;
            }

            expedition.ruinId = NormalizeOptional(expedition.ruinId)
                ?? expedition.dungeonPlanId;
            expedition.bossProfileId = NormalizeOptional(expedition.bossProfileId);
            expedition.dungeonProgress = NormalizeActiveDungeonProgress(
                expedition.dungeonProgress,
                expedition.ruinId);
            return expedition;
        }

        private static ActiveDungeonProgressV1 NormalizeActiveDungeonProgress(
            ActiveDungeonProgressV1 source,
            string ruinId)
        {
            ActiveDungeonProgressV1 progress = source ?? new ActiveDungeonProgressV1();
            progress.recordVersion = ActiveDungeonProgressV1.CurrentRecordVersion;
            progress.checkpointId = NormalizeOptional(progress.checkpointId);
            progress.requiredFactIds = NormalizeStrings(progress.requiredFactIds);
            progress.requiredItemIds = NormalizeStrings(progress.requiredItemIds);
            progress.permanentFactIds = NormalizeStrings(progress.permanentFactIds);
            progress.activatedShortcutIds = NormalizeStrings(progress.activatedShortcutIds);
            progress.claimedRewardIds = NormalizeClaimKeys(progress.claimedRewardIds, ruinId);
            progress.mapKnowledge = NormalizeMapKnowledge(progress.mapKnowledge);
            return progress;
        }

        private static DungeonMapKnowledgeV1 NormalizeMapKnowledge(DungeonMapKnowledgeV1 source)
        {
            DungeonMapKnowledgeV1 knowledge = source ?? new DungeonMapKnowledgeV1();
            knowledge.recordVersion = DungeonMapKnowledgeV1.CurrentRecordVersion;
            knowledge.seenRegionIds = NormalizeStrings(knowledge.seenRegionIds);
            knowledge.visitedRegionIds = NormalizeStrings(knowledge.visitedRegionIds);
            knowledge.exploredRegionIds = NormalizeStrings(knowledge.exploredRegionIds);
            knowledge.discoveredConnectionIds = NormalizeStrings(knowledge.discoveredConnectionIds);
            knowledge.knownLandmarkIds = NormalizeStrings(knowledge.knownLandmarkIds);
            knowledge.knownMechanismIds = NormalizeStrings(knowledge.knownMechanismIds);
            knowledge.visitedRegionIds = MergeStrings(
                knowledge.visitedRegionIds,
                knowledge.exploredRegionIds);
            knowledge.seenRegionIds = MergeStrings(knowledge.seenRegionIds, knowledge.visitedRegionIds);
            return knowledge;
        }

        private static List<KnownRuinV1> NormalizeKnownRuins(List<KnownRuinV1> source)
        {
            var result = new List<KnownRuinV1>();
            var byId = new Dictionary<string, KnownRuinV1>(StringComparer.Ordinal);
            if (source == null)
            {
                return result;
            }

            for (int index = 0; index < source.Count; index += 1)
            {
                KnownRuinV1 ruin = source[index];
                if (ruin == null || string.IsNullOrWhiteSpace(ruin.ruinId))
                {
                    continue;
                }

                ruin.recordVersion = KnownRuinV1.CurrentRecordVersion;
                ruin.ruinId = ruin.ruinId.Trim();
                ruin.dungeonPlanId = NormalizeOptional(ruin.dungeonPlanId) ?? ruin.ruinId;
                ruin.dungeonProfileId = NormalizeOptional(ruin.dungeonProfileId);
                ruin.dungeonRulesetVersion = NormalizeOptional(
                    ruin.dungeonRulesetVersion);
                ruin.dungeonContentPackVersion = NormalizeOptional(
                    ruin.dungeonContentPackVersion);
                ruin.runSeed = NormalizeOptional(ruin.runSeed);
                ruin.permanentFactIds = NormalizeStrings(ruin.permanentFactIds);
                ruin.activatedShortcutIds = NormalizeStrings(ruin.activatedShortcutIds);
                ruin.claimedRewardIds = NormalizeClaimKeys(ruin.claimedRewardIds, ruin.ruinId);
                ruin.mapKnowledge = NormalizeMapKnowledge(ruin.mapKnowledge);
                ruin.discoveredAtUtc = NormalizeOptional(ruin.discoveredAtUtc);
                ruin.lastVisitedAtUtc = NormalizeOptional(ruin.lastVisitedAtUtc);

                if (byId.TryGetValue(ruin.ruinId, out KnownRuinV1 existing))
                {
                    MergeKnownRuin(existing, ruin);
                    continue;
                }

                byId.Add(ruin.ruinId, ruin);
                result.Add(ruin);
            }

            return result;
        }

        private static void MergeKnownRuin(KnownRuinV1 target, KnownRuinV1 source)
        {
            target.dungeonPlanId = target.dungeonPlanId ?? source.dungeonPlanId;
            target.dungeonProfileId = target.dungeonProfileId ?? source.dungeonProfileId;
            target.dungeonRulesetVersion = target.dungeonRulesetVersion ?? source.dungeonRulesetVersion;
            target.dungeonContentPackVersion = target.dungeonContentPackVersion
                ?? source.dungeonContentPackVersion;
            target.runSeed = target.runSeed ?? source.runSeed;
            target.permanentFactIds = MergeStrings(target.permanentFactIds, source.permanentFactIds);
            target.activatedShortcutIds = MergeStrings(target.activatedShortcutIds, source.activatedShortcutIds);
            target.claimedRewardIds = MergeStrings(target.claimedRewardIds, source.claimedRewardIds);
            target.mapKnowledge.seenRegionIds = MergeStrings(
                target.mapKnowledge.seenRegionIds,
                source.mapKnowledge.seenRegionIds);
            target.mapKnowledge.visitedRegionIds = MergeStrings(
                target.mapKnowledge.visitedRegionIds,
                source.mapKnowledge.visitedRegionIds);
            target.mapKnowledge.exploredRegionIds = MergeStrings(
                target.mapKnowledge.exploredRegionIds,
                source.mapKnowledge.exploredRegionIds);
            target.mapKnowledge.discoveredConnectionIds = MergeStrings(
                target.mapKnowledge.discoveredConnectionIds,
                source.mapKnowledge.discoveredConnectionIds);
            target.mapKnowledge.knownLandmarkIds = MergeStrings(
                target.mapKnowledge.knownLandmarkIds,
                source.mapKnowledge.knownLandmarkIds);
            target.mapKnowledge.knownMechanismIds = MergeStrings(
                target.mapKnowledge.knownMechanismIds,
                source.mapKnowledge.knownMechanismIds);
            target.mapKnowledge.visitedRegionIds = MergeStrings(
                target.mapKnowledge.visitedRegionIds,
                target.mapKnowledge.exploredRegionIds);
            target.mapKnowledge.seenRegionIds = MergeStrings(
                target.mapKnowledge.seenRegionIds,
                target.mapKnowledge.visitedRegionIds);
            target.refractorSecured |= source.refractorSecured;
            target.discoveredAtUtc = target.discoveredAtUtc ?? source.discoveredAtUtc;
            target.lastVisitedAtUtc = source.lastVisitedAtUtc ?? target.lastVisitedAtUtc;
        }

        private static void HydrateActiveKnownRuinIdentity(CampaignStateV1 state)
        {
            ExpeditionSourceStateV1 expedition = state?.expedition;
            if (expedition == null || string.IsNullOrWhiteSpace(expedition.ruinId))
            {
                return;
            }

            KnownRuinV1 ruin = state.knownRuins.Find(value => value != null
                && string.Equals(value.ruinId, expedition.ruinId, StringComparison.Ordinal));
            if (ruin == null)
            {
                return;
            }

            ruin.dungeonPlanId ??= expedition.dungeonPlanId;
            ruin.dungeonProfileId ??= expedition.dungeonProfileId;
            ruin.dungeonRulesetVersion ??= expedition.dungeonRulesetVersion;
            ruin.dungeonContentPackVersion ??= expedition.dungeonContentPackVersion;
            ruin.runSeed ??= expedition.runSeed;
        }

        private static List<ExpeditionResolutionHistoryV1> NormalizeExpeditionResolutionHistory(
            List<ExpeditionResolutionHistoryV1> source)
        {
            var result = new List<ExpeditionResolutionHistoryV1>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            if (source == null)
            {
                return result;
            }

            for (int index = 0; index < source.Count; index += 1)
            {
                ExpeditionResolutionHistoryV1 history = source[index];
                if (history == null || string.IsNullOrWhiteSpace(history.resolutionId))
                {
                    continue;
                }

                history.recordVersion = ExpeditionResolutionHistoryV1.CurrentRecordVersion;
                history.resolutionId = history.resolutionId.Trim();
                if (!seen.Add(history.resolutionId))
                {
                    continue;
                }

                history.expeditionId = NormalizeOptional(history.expeditionId);
                history.ruinId = NormalizeOptional(history.ruinId);
                history.discoveryId = NormalizeOptional(history.discoveryId);
                history.claimKey = NormalizeOptional(history.claimKey);
                if (history.claimKey == null && history.ruinId != null && history.discoveryId != null)
                {
                    history.claimKey = DungeonRewardTransactionService.CreateClaimKey(
                        history.ruinId,
                        history.discoveryId);
                }

                history.dungeonPlanId = NormalizeOptional(history.dungeonPlanId)
                    ?? history.expeditionId;
                history.dungeonProfileId = NormalizeOptional(history.dungeonProfileId);
                history.dungeonRulesetVersion = NormalizeOptional(
                    history.dungeonRulesetVersion);
                history.dungeonContentPackVersion = NormalizeOptional(
                    history.dungeonContentPackVersion);
                history.runSeed = NormalizeOptional(history.runSeed);
                history.outcomeId = NormalizeOptional(history.outcomeId);
                history.claimedRewardIds = NormalizeClaimKeys(history.claimedRewardIds, history.ruinId);
                if (history.claimKey != null)
                {
                    history.claimedRewardIds = MergeStrings(
                        history.claimedRewardIds,
                        new List<string> { history.claimKey });
                }
                history.resolvedAtUtc = NormalizeOptional(history.resolvedAtUtc);
                result.Add(history);
            }

            return result;
        }

        private static string NormalizeOptional(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        }

        private static List<string> MergeStrings(List<string> left, List<string> right)
        {
            var combined = new List<string>();
            if (left != null)
            {
                combined.AddRange(left);
            }

            if (right != null)
            {
                combined.AddRange(right);
            }

            return NormalizeStrings(combined);
        }

        private static List<string> NormalizeClaimKeys(List<string> source, string ruinId)
        {
            List<string> normalized = NormalizeStrings(source);
            if (string.IsNullOrWhiteSpace(ruinId))
            {
                return normalized;
            }

            var result = new List<string>();
            for (int index = 0; index < normalized.Count; index += 1)
            {
                string value = normalized[index];
                result.Add(DungeonRewardTransactionService.IsClaimKey(value)
                    ? value
                    : DungeonRewardTransactionService.CreateClaimKey(ruinId, value));
            }

            return NormalizeStrings(result);
        }

        private static List<string> NormalizeStrings(List<string> source)
        {
            var result = new List<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            if (source != null)
            {
                for (int index = 0; index < source.Count; index += 1)
                {
                    string value = source[index];
                    if (!string.IsNullOrWhiteSpace(value) && seen.Add(value.Trim()))
                    {
                        result.Add(value.Trim());
                    }
                }
            }

            result.Sort(StringComparer.Ordinal);
            return result;
        }

        private static List<LoadoutAssignmentV1> NormalizeAssignments(List<LoadoutAssignmentV1> source)
        {
            var result = new List<LoadoutAssignmentV1>();
            var slots = new HashSet<string>(StringComparer.Ordinal);
            var items = new HashSet<string>(StringComparer.Ordinal);
            if (source != null)
            {
                for (int index = 0; index < source.Count; index += 1)
                {
                    LoadoutAssignmentV1 value = source[index];
                    if (value != null && !string.IsNullOrWhiteSpace(value.slotId)
                        && !string.IsNullOrWhiteSpace(value.itemId) && slots.Add(value.slotId.Trim())
                        && items.Add(value.itemId.Trim()))
                    {
                        result.Add(new LoadoutAssignmentV1
                        {
                            slotId = value.slotId.Trim(),
                            itemId = value.itemId.Trim()
                        });
                    }
                }
            }

            result.Sort((left, right) => string.CompareOrdinal(left.slotId, right.slotId));
            return result;
        }

        private static void QuarantineArmAssignments(
            CampaignStateV1 state,
            ISet<string> knownArmIds,
            string timestamp)
        {
            for (int index = state.armAssignments.Count - 1; index >= 0; index -= 1)
            {
                LoadoutAssignmentV1 assignment = state.armAssignments[index];
                string itemId = assignment.itemId;
                if (knownArmIds.Contains(itemId))
                {
                    continue;
                }

                const string BusterPrefix = "buster:";
                if (itemId.StartsWith(BusterPrefix, StringComparison.Ordinal))
                {
                    string buildId = itemId.Substring(BusterPrefix.Length);
                    bool buildExists = state.busterSources.Exists(value => value != null
                        && string.Equals(value.buildId, buildId, StringComparison.Ordinal));
                    if (buildExists)
                    {
                        continue;
                    }

                    AddQuarantine(state, "buster-build", buildId, "armAssignments", timestamp);
                }
                else
                {
                    AddQuarantine(state, "arm", itemId, "armAssignments", timestamp);
                }

                state.armAssignments.RemoveAt(index);
            }
        }

        private static void QuarantineStrings(
            CampaignStateV1 state,
            List<string> values,
            ISet<string> known,
            string category,
            string path,
            string timestamp)
        {
            for (int index = values.Count - 1; index >= 0; index -= 1)
            {
                if (!known.Contains(values[index]))
                {
                    AddQuarantine(state, category, values[index], path, timestamp);
                    values.RemoveAt(index);
                }
            }
        }

        private static void QuarantineAssignments(
            CampaignStateV1 state,
            List<LoadoutAssignmentV1> assignments,
            ISet<string> known,
            string category,
            string path,
            string timestamp)
        {
            for (int index = assignments.Count - 1; index >= 0; index -= 1)
            {
                if (!known.Contains(assignments[index].itemId))
                {
                    AddQuarantine(state, category, assignments[index].itemId, path, timestamp);
                    assignments.RemoveAt(index);
                }
            }
        }

        private static void AddQuarantine(
            CampaignStateV1 state,
            string category,
            string id,
            string path,
            string timestamp)
        {
            string unknownId = string.IsNullOrWhiteSpace(id) ? "<missing>" : id.Trim();
            for (int index = 0; index < state.unknownIdQuarantine.Count; index += 1)
            {
                QuarantinedUnknownIdV1 existing = state.unknownIdQuarantine[index];
                if (existing != null && string.Equals(existing.category, category, StringComparison.Ordinal)
                    && string.Equals(existing.unknownId, unknownId, StringComparison.Ordinal)
                    && string.Equals(existing.path, path, StringComparison.Ordinal))
                {
                    return;
                }
            }

            state.unknownIdQuarantine.Add(new QuarantinedUnknownIdV1
            {
                category = category,
                unknownId = unknownId,
                path = path,
                quarantinedAtUtc = timestamp
            });
        }

        private static bool Contains(List<string> values, string value)
        {
            for (int index = 0; index < values.Count; index += 1)
            {
                if (string.Equals(values[index], value, StringComparison.Ordinal))
                {
                    return true;
                }
            }

            return false;
        }
    }
}
