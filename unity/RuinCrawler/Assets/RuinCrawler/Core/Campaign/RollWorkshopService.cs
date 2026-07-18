using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Campaign
{
    /// <summary>
    /// Pure Roll workshop transactions. Every operation clones before changing
    /// state, validates all preconditions before consuming resources, and
    /// returns the original object on failure.
    /// </summary>
    public static class RollWorkshopService
    {
        public static WorkshopTransactionResult IdentifyAll(CampaignStateV1 source)
        {
            if (source == null)
            {
                throw new ArgumentNullException(nameof(source));
            }

            List<UnidentifiedRecoveryV1> pending = source.unidentifiedRecoveries
                ?? new List<UnidentifiedRecoveryV1>();
            for (int index = 0; index < pending.Count; index += 1)
            {
                UnidentifiedRecoveryV1 recovery = pending[index];
                if (recovery == null || recovery.quantity <= 0
                    || string.IsNullOrWhiteSpace(recovery.recoveryId))
                {
                    return WorkshopTransactionResult.Failed(
                        source,
                        "invalid-recovery",
                        "Every field recovery requires a stable id and positive quantity before Roll can identify the batch.");
                }
            }

            CampaignStateV1 state = CampaignStateRepair.Repair(source.Clone());
            if (state.unidentifiedRecoveries.Count == 0)
            {
                return WorkshopTransactionResult.Succeeded(state, changed: false);
            }

            state.unidentifiedRecoveries.Sort(CompareRecovery);
            int processed = 0;
            int partCount = 0;
            int scrapCount = 0;
            var seenThisBatch = new HashSet<string>(StringComparer.Ordinal);

            for (int recoveryIndex = 0; recoveryIndex < state.unidentifiedRecoveries.Count; recoveryIndex += 1)
            {
                UnidentifiedRecoveryV1 recovery = state.unidentifiedRecoveries[recoveryIndex];
                string recoveryId = recovery.recoveryId.Trim();
                if (!seenThisBatch.Add(recoveryId) || Contains(state.resolvedRecoveryIds, recoveryId))
                {
                    continue;
                }

                int remaining = recovery.quantity;
                processed += recovery.quantity;
                List<RecoveryPartV1> parts = recovery.recoverableParts ?? new List<RecoveryPartV1>();
                for (int partIndex = 0; partIndex < parts.Count && remaining > 0; partIndex += 1)
                {
                    RecoveryPartV1 part = parts[partIndex];
                    if (part == null || string.IsNullOrWhiteSpace(part.materialId))
                    {
                        continue;
                    }

                    int amount = Math.Min(remaining, Math.Max(1, part.quantity));
                    AddPart(state, part, recovery, amount);
                    remaining -= amount;
                    partCount += amount;
                }

                scrapCount += remaining;
                AddUnique(state.resolvedRecoveryIds, recoveryId);
            }

            state.salvage.identifiedScrap += scrapCount;
            state.unidentifiedRecoveries.Clear();
            state.salvage.parts.Sort((left, right) => string.CompareOrdinal(left.materialId, right.materialId));
            return WorkshopTransactionResult.Succeeded(
                state,
                processedRecoveries: processed,
                scrapStored: scrapCount,
                partsStored: partCount);
        }

        public static WorkshopTransactionResult Fabricate(
            CampaignStateV1 source,
            WorkshopRecipeV1 recipe,
            string transactionId,
            string committedAtUtc)
        {
            if (source == null)
            {
                throw new ArgumentNullException(nameof(source));
            }

            if (recipe == null || string.IsNullOrWhiteSpace(recipe.recipeId)
                || string.IsNullOrWhiteSpace(recipe.outputKind)
                || string.IsNullOrWhiteSpace(recipe.outputId))
            {
                return WorkshopTransactionResult.Failed(source, "invalid-recipe", "The recipe contract is incomplete.");
            }

            if (string.IsNullOrWhiteSpace(transactionId) || string.IsNullOrWhiteSpace(committedAtUtc))
            {
                return WorkshopTransactionResult.Failed(source, "invalid-transaction", "A stable transaction id and timestamp are required.");
            }

            if (!IsSupportedOutputKind(recipe.outputKind))
            {
                return WorkshopTransactionResult.Failed(
                    source,
                    "unknown-output-kind",
                    "Unknown recipe output kind: " + recipe.outputKind + ".");
            }

            CampaignStateV1 state = CampaignStateRepair.Repair(source.Clone());
            if (FindHistoryByTransaction(state, transactionId) != null)
            {
                return WorkshopTransactionResult.Succeeded(state, changed: false, idempotentReplay: true);
            }

            if (!recipe.repeatable && HasFabricatedRecipe(state, recipe.recipeId))
            {
                return WorkshopTransactionResult.Failed(source, "already-fabricated", "This one-time fabrication already committed.");
            }

            if (IsOutputOwned(state, recipe.outputKind, recipe.outputId))
            {
                return WorkshopTransactionResult.Failed(
                    source,
                    "already-owned",
                    "This physical item is already owned and cannot be fabricated twice.");
            }

            if (recipe.requiresDefenseUnlock && !Contains(state.unlockedGearSlotIds, "defense"))
            {
                return WorkshopTransactionResult.Failed(source, "defense-slot-locked", "The Defense Gear slot has not been unlocked.");
            }

            int scrapCost = Math.Max(0, recipe.identifiedScrapCost);
            if (state.salvage.identifiedScrap < scrapCost)
            {
                return WorkshopTransactionResult.Failed(source, "insufficient-scrap", "Roll does not have enough identified scrap.");
            }

            var required = new Dictionary<string, int>(StringComparer.Ordinal);
            List<WorkshopPartRequirementV1> recipeParts = recipe.parts ?? new List<WorkshopPartRequirementV1>();
            for (int index = 0; index < recipeParts.Count; index += 1)
            {
                WorkshopPartRequirementV1 requirement = recipeParts[index];
                if (requirement == null || string.IsNullOrWhiteSpace(requirement.materialId))
                {
                    return WorkshopTransactionResult.Failed(source, "invalid-recipe", "A named-part requirement is missing its stable id.");
                }

                int amount = Math.Max(0, requirement.quantity);
                if (amount == 0)
                {
                    continue;
                }

                required[requirement.materialId] = required.TryGetValue(requirement.materialId, out int existing)
                    ? existing + amount
                    : amount;
            }

            foreach (KeyValuePair<string, int> requirement in required)
            {
                if (GetPartCount(state, requirement.Key) < requirement.Value)
                {
                    return WorkshopTransactionResult.Failed(
                        source,
                        "insufficient-parts",
                        "Missing named component: " + requirement.Key + ".");
                }
            }

            // Commit begins only after every precondition succeeds.
            state.salvage.identifiedScrap -= scrapCost;
            foreach (KeyValuePair<string, int> requirement in required)
            {
                ConsumePart(state, requirement.Key, requirement.Value);
            }

            AddUnique(state.discoveredRecipeIds, recipe.recipeId);
            switch (recipe.outputKind)
            {
                case "arm":
                    AddUnique(state.ownedArmIds, recipe.outputId);
                    break;
                case "gear":
                    AddUnique(state.ownedGearIds, recipe.outputId);
                    break;
                case "module":
                    AddUnique(state.ownedModuleIds, recipe.outputId);
                    break;
                case "chassis":
                    AddUnique(state.ownedChassisIds, recipe.outputId);
                    break;
            }

            state.fabricationHistory.Add(new FabricationHistoryV1
            {
                transactionId = transactionId.Trim(),
                recipeId = recipe.recipeId.Trim(),
                outputKind = recipe.outputKind.Trim(),
                outputId = recipe.outputId.Trim(),
                quantity = 1,
                committedAtUtc = committedAtUtc.Trim()
            });
            return WorkshopTransactionResult.Succeeded(state);
        }

        public static WorkshopTransactionResult Equip(
            CampaignStateV1 source,
            string loadoutKind,
            string slotId,
            string itemId,
            bool isSafeArea)
        {
            if (source == null)
            {
                throw new ArgumentNullException(nameof(source));
            }

            if (!isSafeArea)
            {
                return WorkshopTransactionResult.Failed(source, "unsafe-area", "Loadouts can only change at camp or another safe area.");
            }

            if (string.IsNullOrWhiteSpace(slotId))
            {
                return WorkshopTransactionResult.Failed(source, "invalid-slot", "A stable slot id is required.");
            }

            CampaignStateV1 state = CampaignStateRepair.Repair(source.Clone());
            List<LoadoutAssignmentV1> assignments;
            List<string> ownership;
            if (string.Equals(loadoutKind, "arm", StringComparison.Ordinal))
            {
                assignments = state.armAssignments;
                ownership = state.ownedArmIds;
            }
            else if (string.Equals(loadoutKind, "gear", StringComparison.Ordinal))
            {
                if (!Contains(state.unlockedGearSlotIds, slotId))
                {
                    return WorkshopTransactionResult.Failed(source, "slot-locked", "The requested Gear slot is locked.");
                }

                assignments = state.gearAssignments;
                ownership = state.ownedGearIds;
            }
            else
            {
                return WorkshopTransactionResult.Failed(source, "invalid-loadout-kind", "Loadout kind must be arm or gear.");
            }

            if (!string.IsNullOrWhiteSpace(itemId) && !Contains(ownership, itemId))
            {
                return WorkshopTransactionResult.Failed(source, "not-owned", "The selected item is not owned.");
            }

            LoadoutAssignmentV1 existingAssignment = FindAssignment(assignments, slotId);
            string normalizedItemId = string.IsNullOrWhiteSpace(itemId) ? null : itemId.Trim();
            if (existingAssignment != null && string.Equals(existingAssignment.itemId, normalizedItemId, StringComparison.Ordinal))
            {
                return WorkshopTransactionResult.Succeeded(state, changed: false);
            }

            // A physical item can occupy at most one slot.
            if (normalizedItemId != null)
            {
                assignments.RemoveAll(value => value != null
                    && !string.Equals(value.slotId, slotId, StringComparison.Ordinal)
                    && string.Equals(value.itemId, normalizedItemId, StringComparison.Ordinal));
            }

            assignments.RemoveAll(value => value != null && string.Equals(value.slotId, slotId, StringComparison.Ordinal));
            if (normalizedItemId != null)
            {
                assignments.Add(new LoadoutAssignmentV1 { slotId = slotId.Trim(), itemId = normalizedItemId });
                assignments.Sort((left, right) => string.CompareOrdinal(left.slotId, right.slotId));
            }

            return WorkshopTransactionResult.Succeeded(state);
        }

        public static WorkshopTransactionResult SelectBossHunt(
            CampaignStateV1 source,
            string profileId,
            bool profileExists)
        {
            if (source == null)
            {
                throw new ArgumentNullException(nameof(source));
            }

            if (!profileExists || string.IsNullOrWhiteSpace(profileId))
            {
                return WorkshopTransactionResult.Failed(source, "unknown-boss-profile", "The Boss Hunt profile is unknown.");
            }

            CampaignStateV1 state = CampaignStateRepair.Repair(source.Clone());
            if (state.bossHunts.selectionLocked || !string.IsNullOrEmpty(state.bossHunts.activeExpeditionId))
            {
                return WorkshopTransactionResult.Failed(source, "hunt-locked", "Boss Hunt selection is locked for the active expedition.");
            }

            if (string.Equals(state.bossHunts.selectedProfileId, profileId, StringComparison.Ordinal))
            {
                return WorkshopTransactionResult.Succeeded(state, changed: false);
            }

            state.bossHunts.selectedProfileId = profileId.Trim();
            return WorkshopTransactionResult.Succeeded(state);
        }

        public static WorkshopTransactionResult BeginExpedition(
            CampaignStateV1 source,
            string expeditionId,
            string runSeed,
            string dungeonProfileId,
            string dungeonRulesetVersion = null,
            string dungeonPlanId = null,
            string ruinId = null,
            string dungeonContentPackVersion = null)
        {
            if (source == null)
            {
                throw new ArgumentNullException(nameof(source));
            }

            if (string.IsNullOrWhiteSpace(expeditionId) || string.IsNullOrWhiteSpace(runSeed)
                || string.IsNullOrWhiteSpace(dungeonProfileId))
            {
                return WorkshopTransactionResult.Failed(source, "invalid-expedition", "Expedition id, run seed, and dungeon profile are required.");
            }

            CampaignStateV1 state = CampaignStateRepair.Repair(source.Clone());
            if (!string.IsNullOrEmpty(state.bossHunts.activeExpeditionId))
            {
                return WorkshopTransactionResult.Failed(source, "expedition-active", "An expedition is already active.");
            }

            state.bossHunts.activeExpeditionId = expeditionId.Trim();
            state.bossHunts.selectionLocked = true;
            state.expedition.expeditionId = expeditionId.Trim();
            state.expedition.runSeed = runSeed.Trim();
            state.expedition.dungeonProfileId = dungeonProfileId.Trim();
            state.expedition.dungeonRulesetVersion = string.IsNullOrWhiteSpace(dungeonRulesetVersion)
                ? null
                : dungeonRulesetVersion.Trim();
            state.expedition.dungeonContentPackVersion =
                string.IsNullOrWhiteSpace(dungeonContentPackVersion)
                    ? null
                    : dungeonContentPackVersion.Trim();
            state.expedition.dungeonPlanId = string.IsNullOrWhiteSpace(dungeonPlanId)
                ? state.expedition.expeditionId
                : dungeonPlanId.Trim();
            state.expedition.ruinId = string.IsNullOrWhiteSpace(ruinId)
                ? state.expedition.dungeonPlanId
                : ruinId.Trim();
            state.expedition.bossProfileId = state.bossHunts.selectedProfileId;
            return WorkshopTransactionResult.Succeeded(state);
        }

        public static WorkshopTransactionResult ResolveBossVictory(
            CampaignStateV1 source,
            string victoryId,
            string profileId,
            string expeditionId,
            BossRewardV1 firstClearReward,
            BossRewardV1 repeatReward,
            string committedAtUtc)
        {
            if (source == null)
            {
                throw new ArgumentNullException(nameof(source));
            }

            if (string.IsNullOrWhiteSpace(victoryId) || string.IsNullOrWhiteSpace(profileId)
                || string.IsNullOrWhiteSpace(expeditionId) || string.IsNullOrWhiteSpace(committedAtUtc))
            {
                return WorkshopTransactionResult.Failed(source, "invalid-victory", "Victory, profile, expedition, and timestamp are required.");
            }

            CampaignStateV1 state = CampaignStateRepair.Repair(source.Clone());
            if (Contains(state.bossHunts.resolvedVictoryIds, victoryId))
            {
                return WorkshopTransactionResult.Succeeded(state, changed: false, idempotentReplay: true);
            }

            if (state.bossHunts.victoryHistory.Exists(value => value != null
                && string.Equals(value.expeditionId, expeditionId, StringComparison.Ordinal)))
            {
                return WorkshopTransactionResult.Failed(
                    source,
                    "victory-already-resolved",
                    "This expedition has already committed its Boss Hunt victory reward.");
            }

            if (!string.Equals(state.bossHunts.activeExpeditionId, expeditionId, StringComparison.Ordinal)
                || !string.Equals(state.bossHunts.selectedProfileId, profileId, StringComparison.Ordinal))
            {
                return WorkshopTransactionResult.Failed(source, "victory-context-mismatch", "Victory does not match the locked Boss Hunt expedition.");
            }

            bool firstClear = !Contains(state.bossHunts.clearedProfileIds, profileId);
            BossRewardV1 reward = firstClear ? firstClearReward : repeatReward;
            // First clear is always a guaranteed positive signature reward.
            // A null repeat reward is a valid deterministic repeat miss; an
            // explicitly supplied but malformed reward remains a hard error.
            if ((firstClear && reward == null)
                || (reward != null
                    && (string.IsNullOrWhiteSpace(reward.MaterialId) || reward.Quantity <= 0)))
            {
                return WorkshopTransactionResult.Failed(source, "invalid-reward", "Boss reward contract is incomplete.");
            }

            if (reward != null)
            {
                AddPart(state, new RecoveryPartV1
                {
                    materialId = reward.MaterialId,
                    name = reward.Name,
                    family = reward.Family,
                    aspect = reward.Aspect,
                    tier = reward.Tier,
                    quantity = reward.Quantity
                }, new UnidentifiedRecoveryV1
                {
                    sourceKind = "boss",
                    sourceId = profileId
                }, reward.Quantity);
            }

            AddUnique(state.bossHunts.resolvedVictoryIds, victoryId);
            AddUnique(state.bossHunts.clearedProfileIds, profileId);
            state.bossHunts.victoryHistory.Add(new BossVictoryHistoryV1
            {
                victoryId = victoryId.Trim(),
                profileId = profileId.Trim(),
                expeditionId = expeditionId.Trim(),
                firstClear = firstClear,
                rewardMaterialId = reward?.MaterialId,
                rewardQuantity = reward?.Quantity ?? 0,
                committedAtUtc = committedAtUtc.Trim()
            });
            return WorkshopTransactionResult.Succeeded(state, partsStored: reward?.Quantity ?? 0);
        }

        public static WorkshopTransactionResult ReturnToCamp(CampaignStateV1 source, string expeditionId)
        {
            if (source == null)
            {
                throw new ArgumentNullException(nameof(source));
            }

            CampaignStateV1 state = CampaignStateRepair.Repair(source.Clone());
            if (string.IsNullOrEmpty(state.bossHunts.activeExpeditionId)
                && string.IsNullOrEmpty(expeditionId))
            {
                return WorkshopTransactionResult.Succeeded(state, changed: false, idempotentReplay: true);
            }

            if (!string.Equals(state.bossHunts.activeExpeditionId, expeditionId, StringComparison.Ordinal))
            {
                return WorkshopTransactionResult.Failed(source, "expedition-context-mismatch", "The active expedition does not match.");
            }

            state.bossHunts.activeExpeditionId = null;
            state.bossHunts.selectionLocked = false;
            state.expedition = new ExpeditionSourceStateV1();
            return WorkshopTransactionResult.Succeeded(state);
        }

        private static void AddPart(
            CampaignStateV1 state,
            RecoveryPartV1 part,
            UnidentifiedRecoveryV1 recovery,
            int amount)
        {
            NamedPartStackV1 stack = FindPart(state, part.materialId);
            if (stack == null)
            {
                stack = new NamedPartStackV1
                {
                    materialId = part.materialId,
                    name = string.IsNullOrWhiteSpace(part.name) ? part.materialId : part.name,
                    family = string.IsNullOrWhiteSpace(part.family) ? "Reaverbot Part" : part.family,
                    aspect = part.aspect,
                    tier = string.IsNullOrWhiteSpace(part.tier) ? "common" : part.tier,
                    quantity = 0
                };
                state.salvage.parts.Add(stack);
            }

            stack.quantity += Math.Max(0, amount);
            stack.sourceKind = recovery?.sourceKind;
            stack.sourceId = recovery?.sourceId;
            if (!Contains(state.discoveredSalvageTypeIds, part.materialId))
            {
                AddUnique(state.discoveredSalvageTypeIds, part.materialId);
                state.discoveryHistory.Add(new SalvageDiscoveryV1
                {
                    materialId = part.materialId,
                    name = stack.name,
                    sequence = state.discoveryHistory.Count + 1L,
                    sourceKind = recovery?.sourceKind,
                    sourceId = recovery?.sourceId
                });
            }
        }

        private static NamedPartStackV1 FindPart(CampaignStateV1 state, string materialId)
        {
            for (int index = 0; index < state.salvage.parts.Count; index += 1)
            {
                NamedPartStackV1 value = state.salvage.parts[index];
                if (value != null && string.Equals(value.materialId, materialId, StringComparison.Ordinal))
                {
                    return value;
                }
            }

            return null;
        }

        private static int GetPartCount(CampaignStateV1 state, string materialId)
        {
            return Math.Max(0, FindPart(state, materialId)?.quantity ?? 0);
        }

        private static void ConsumePart(CampaignStateV1 state, string materialId, int amount)
        {
            NamedPartStackV1 stack = FindPart(state, materialId);
            if (stack == null)
            {
                return;
            }

            stack.quantity -= amount;
            if (stack.quantity <= 0)
            {
                state.salvage.parts.Remove(stack);
            }
        }

        private static FabricationHistoryV1 FindHistoryByTransaction(CampaignStateV1 state, string transactionId)
        {
            for (int index = 0; index < state.fabricationHistory.Count; index += 1)
            {
                FabricationHistoryV1 value = state.fabricationHistory[index];
                if (value != null && string.Equals(value.transactionId, transactionId, StringComparison.Ordinal))
                {
                    return value;
                }
            }

            return null;
        }

        private static bool HasFabricatedRecipe(CampaignStateV1 state, string recipeId)
        {
            for (int index = 0; index < state.fabricationHistory.Count; index += 1)
            {
                if (string.Equals(state.fabricationHistory[index]?.recipeId, recipeId, StringComparison.Ordinal))
                {
                    return true;
                }
            }

            return false;
        }

        private static bool IsSupportedOutputKind(string outputKind)
        {
            return string.Equals(outputKind, "arm", StringComparison.Ordinal)
                || string.Equals(outputKind, "gear", StringComparison.Ordinal)
                || string.Equals(outputKind, "module", StringComparison.Ordinal)
                || string.Equals(outputKind, "chassis", StringComparison.Ordinal);
        }

        private static bool IsOutputOwned(CampaignStateV1 state, string outputKind, string outputId)
        {
            switch (outputKind)
            {
                case "arm":
                    return Contains(state.ownedArmIds, outputId);
                case "gear":
                    return Contains(state.ownedGearIds, outputId);
                case "module":
                    return Contains(state.ownedModuleIds, outputId);
                case "chassis":
                    return Contains(state.ownedChassisIds, outputId);
                default:
                    return false;
            }
        }

        private static LoadoutAssignmentV1 FindAssignment(List<LoadoutAssignmentV1> values, string slotId)
        {
            for (int index = 0; index < values.Count; index += 1)
            {
                LoadoutAssignmentV1 value = values[index];
                if (value != null && string.Equals(value.slotId, slotId, StringComparison.Ordinal))
                {
                    return value;
                }
            }

            return null;
        }

        private static bool Contains(List<string> values, string value)
        {
            if (values == null)
            {
                return false;
            }

            for (int index = 0; index < values.Count; index += 1)
            {
                if (string.Equals(values[index], value, StringComparison.Ordinal))
                {
                    return true;
                }
            }

            return false;
        }

        private static void AddUnique(List<string> values, string value)
        {
            if (!Contains(values, value))
            {
                values.Add(value);
                values.Sort(StringComparer.Ordinal);
            }
        }

        private static int CompareRecovery(UnidentifiedRecoveryV1 left, UnidentifiedRecoveryV1 right)
        {
            long leftSequence = left?.sequence ?? long.MaxValue;
            long rightSequence = right?.sequence ?? long.MaxValue;
            int sequenceComparison = leftSequence.CompareTo(rightSequence);
            return sequenceComparison != 0
                ? sequenceComparison
                : string.CompareOrdinal(left?.recoveryId, right?.recoveryId);
        }
    }
}
