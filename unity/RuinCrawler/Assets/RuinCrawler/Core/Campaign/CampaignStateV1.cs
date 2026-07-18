using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Campaign
{
    /// <summary>
    /// Unity-only campaign source state. All collections are arrays/lists so
    /// the durable JSON never depends on dictionary ordering. Runtime health,
    /// locks, batteries, projectiles, generated rooms, and enemies are absent
    /// by design.
    /// </summary>
    [Serializable]
    public sealed class CampaignStateV1
    {
        // Keep the established C# type name to avoid broad runtime churn. The
        // durable payload itself is schema version 2; CampaignStateRepair owns
        // the idempotent v1 -> v2 migration.
        public const int CurrentStateVersion = 2;

        public int stateVersion = CurrentStateVersion;
        public string campaignId = "campaign-main";
        public SalvageStockpileV1 salvage = new SalvageStockpileV1();
        public List<UnidentifiedRecoveryV1> unidentifiedRecoveries = new List<UnidentifiedRecoveryV1>();
        public List<string> resolvedRecoveryIds = new List<string>();
        public List<string> discoveredSalvageTypeIds = new List<string>();
        public List<SalvageDiscoveryV1> discoveryHistory = new List<SalvageDiscoveryV1>();
        public List<string> discoveredRecipeIds = new List<string>();
        public List<string> ownedModuleIds = new List<string>();
        public List<string> ownedChassisIds = new List<string>();
        public List<BusterSourceV1> busterSources = new List<BusterSourceV1>();
        public List<BusterRevisionHistoryV1> busterRevisionHistory = new List<BusterRevisionHistoryV1>();
        public List<string> ownedArmIds = new List<string>();
        public List<string> ownedGearIds = new List<string>();
        public List<string> unlockedGearSlotIds = new List<string>();
        public List<LoadoutAssignmentV1> armAssignments = new List<LoadoutAssignmentV1>();
        public List<LoadoutAssignmentV1> gearAssignments = new List<LoadoutAssignmentV1>();
        public MegaCalibrationV1 megaCalibration = MegaCalibrationV1.Neutral();
        public List<FabricationHistoryV1> fabricationHistory = new List<FabricationHistoryV1>();
        public BossHuntStateV1 bossHunts = new BossHuntStateV1();
        public ExpeditionSourceStateV1 expedition = new ExpeditionSourceStateV1();
        public List<KnownRuinV1> knownRuins = new List<KnownRuinV1>();
        public List<ExpeditionResolutionHistoryV1> expeditionResolutionHistory = new List<ExpeditionResolutionHistoryV1>();
        public List<QuarantinedUnknownIdV1> unknownIdQuarantine = new List<QuarantinedUnknownIdV1>();
        public List<string> appliedMigrationIds = new List<string>();

        public static CampaignStateV1 CreateDefault(string campaignId = "campaign-main")
        {
            var state = new CampaignStateV1
            {
                campaignId = string.IsNullOrWhiteSpace(campaignId) ? "campaign-main" : campaignId.Trim(),
                ownedArmIds = new List<string> { "megaBuster" },
                ownedGearIds = new List<string> { "reinforcedArmorFrame" },
                ownedChassisIds = new List<string> { "custom-buster-chassis" },
                unlockedGearSlotIds = new List<string> { "armor", "helmet", "mobility", "utility1", "utility2" },
                armAssignments = new List<LoadoutAssignmentV1>
                {
                    new LoadoutAssignmentV1 { slotId = "megaBuster", itemId = "megaBuster" }
                },
                gearAssignments = new List<LoadoutAssignmentV1>
                {
                    new LoadoutAssignmentV1 { slotId = "armor", itemId = "reinforcedArmorFrame" }
                }
            };
            return state;
        }

        public CampaignStateV1 Clone()
        {
            return new CampaignStateV1
            {
                stateVersion = stateVersion,
                campaignId = campaignId,
                salvage = salvage?.Clone() ?? new SalvageStockpileV1(),
                unidentifiedRecoveries = CloneList(unidentifiedRecoveries, value => value?.Clone()),
                resolvedRecoveryIds = CloneStrings(resolvedRecoveryIds),
                discoveredSalvageTypeIds = CloneStrings(discoveredSalvageTypeIds),
                discoveryHistory = CloneList(discoveryHistory, value => value?.Clone()),
                discoveredRecipeIds = CloneStrings(discoveredRecipeIds),
                ownedModuleIds = CloneStrings(ownedModuleIds),
                ownedChassisIds = CloneStrings(ownedChassisIds),
                busterSources = CloneList(busterSources, value => value?.Clone()),
                busterRevisionHistory = CloneList(busterRevisionHistory, value => value?.Clone()),
                ownedArmIds = CloneStrings(ownedArmIds),
                ownedGearIds = CloneStrings(ownedGearIds),
                unlockedGearSlotIds = CloneStrings(unlockedGearSlotIds),
                armAssignments = CloneList(armAssignments, value => value?.Clone()),
                gearAssignments = CloneList(gearAssignments, value => value?.Clone()),
                megaCalibration = megaCalibration?.Clone() ?? MegaCalibrationV1.Neutral(),
                fabricationHistory = CloneList(fabricationHistory, value => value?.Clone()),
                bossHunts = bossHunts?.Clone() ?? new BossHuntStateV1(),
                expedition = expedition?.Clone() ?? new ExpeditionSourceStateV1(),
                knownRuins = CloneList(knownRuins, value => value?.Clone()),
                expeditionResolutionHistory = CloneList(expeditionResolutionHistory, value => value?.Clone()),
                unknownIdQuarantine = CloneList(unknownIdQuarantine, value => value?.Clone()),
                appliedMigrationIds = CloneStrings(appliedMigrationIds)
            };
        }

        internal static List<string> CloneStrings(List<string> source)
        {
            return source == null ? new List<string>() : new List<string>(source);
        }

        internal static List<T> CloneList<T>(List<T> source, Func<T, T> clone)
        {
            var result = new List<T>();
            if (source == null)
            {
                return result;
            }

            for (int index = 0; index < source.Count; index += 1)
            {
                T value = clone(source[index]);
                if (value != null)
                {
                    result.Add(value);
                }
            }

            return result;
        }
    }

    [Serializable]
    public sealed class SalvageStockpileV1
    {
        public int identifiedScrap;
        public List<NamedPartStackV1> parts = new List<NamedPartStackV1>();

        public SalvageStockpileV1 Clone() => new SalvageStockpileV1
        {
            identifiedScrap = identifiedScrap,
            parts = CampaignStateV1.CloneList(parts, value => value?.Clone())
        };
    }

    [Serializable]
    public sealed class NamedPartStackV1
    {
        public string materialId;
        public string name;
        public string family;
        public string aspect;
        public string tier;
        public string sourceKind;
        public string sourceId;
        public int quantity;

        public NamedPartStackV1 Clone() => (NamedPartStackV1)MemberwiseClone();
    }

    [Serializable]
    public sealed class UnidentifiedRecoveryV1
    {
        public string recoveryId;
        public string sourceKind;
        public string sourceId;
        public long sequence;
        public int quantity;
        public List<RecoveryPartV1> recoverableParts = new List<RecoveryPartV1>();

        public UnidentifiedRecoveryV1 Clone() => new UnidentifiedRecoveryV1
        {
            recoveryId = recoveryId,
            sourceKind = sourceKind,
            sourceId = sourceId,
            sequence = sequence,
            quantity = quantity,
            recoverableParts = CampaignStateV1.CloneList(recoverableParts, value => value?.Clone())
        };
    }

    [Serializable]
    public sealed class RecoveryPartV1
    {
        public string materialId;
        public string name;
        public string family;
        public string aspect;
        public string tier;
        public int quantity = 1;

        public RecoveryPartV1 Clone() => (RecoveryPartV1)MemberwiseClone();
    }

    [Serializable]
    public sealed class SalvageDiscoveryV1
    {
        public string materialId;
        public string name;
        public long sequence;
        public string sourceKind;
        public string sourceId;

        public SalvageDiscoveryV1 Clone() => (SalvageDiscoveryV1)MemberwiseClone();
    }

    [Serializable]
    public sealed class BusterSourceV1
    {
        public string buildId;
        public long revision;
        public string rulesetVersion = "custom-buster-v0.2";
        public string chassisId;
        public string rootNodeId;
        public int power = 4;
        public int energy = 4;
        public int range = 4;
        public int rapid = 4;
        public List<BusterModuleSourceV1> modules = new List<BusterModuleSourceV1>();
        public List<BusterEdgeSourceV1> edges = new List<BusterEdgeSourceV1>();

        public BusterSourceV1 Clone() => new BusterSourceV1
        {
            buildId = buildId,
            revision = revision,
            rulesetVersion = rulesetVersion,
            chassisId = chassisId,
            rootNodeId = rootNodeId,
            power = power,
            energy = energy,
            range = range,
            rapid = rapid,
            modules = CampaignStateV1.CloneList(modules, value => value?.Clone()),
            edges = CampaignStateV1.CloneList(edges, value => value?.Clone())
        };
    }

    [Serializable]
    public sealed class BusterModuleSourceV1
    {
        public string nodeId;
        public string instanceId;
        public string moduleId;
        public List<string> outputInstanceIds = new List<string>();

        public BusterModuleSourceV1 Clone() => new BusterModuleSourceV1
        {
            nodeId = nodeId,
            instanceId = instanceId,
            moduleId = moduleId,
            outputInstanceIds = CampaignStateV1.CloneStrings(outputInstanceIds)
        };
    }

    [Serializable]
    public sealed class BusterEdgeSourceV1
    {
        public string fromNodeId;
        public string port;
        public string toNodeId;

        public BusterEdgeSourceV1 Clone() => (BusterEdgeSourceV1)MemberwiseClone();
    }

    [Serializable]
    public sealed class BusterRevisionHistoryV1
    {
        public string transactionId;
        public string buildId;
        public long revision;
        public string committedAtUtc;
        public BusterSourceV1 source;

        public BusterRevisionHistoryV1 Clone() => new BusterRevisionHistoryV1
        {
            transactionId = transactionId,
            buildId = buildId,
            revision = revision,
            committedAtUtc = committedAtUtc,
            source = source?.Clone()
        };
    }

    [Serializable]
    public sealed class MegaCalibrationV1
    {
        public int power = 4;
        public int energy = 4;
        public int range = 4;
        public int rapid = 4;

        public static MegaCalibrationV1 Neutral() => new MegaCalibrationV1();
        public MegaCalibrationV1 Clone() => (MegaCalibrationV1)MemberwiseClone();
    }

    [Serializable]
    public sealed class LoadoutAssignmentV1
    {
        public string slotId;
        public string itemId;

        public LoadoutAssignmentV1 Clone() => (LoadoutAssignmentV1)MemberwiseClone();
    }

    [Serializable]
    public sealed class FabricationHistoryV1
    {
        public string transactionId;
        public string recipeId;
        public string outputKind;
        public string outputId;
        public int quantity;
        public string committedAtUtc;

        public FabricationHistoryV1 Clone() => (FabricationHistoryV1)MemberwiseClone();
    }

    [Serializable]
    public sealed class BossHuntStateV1
    {
        public string selectedProfileId;
        public bool selectionLocked;
        public string activeExpeditionId;
        public List<string> clearedProfileIds = new List<string>();
        public List<string> resolvedVictoryIds = new List<string>();
        public List<BossVictoryHistoryV1> victoryHistory = new List<BossVictoryHistoryV1>();

        public BossHuntStateV1 Clone() => new BossHuntStateV1
        {
            selectedProfileId = selectedProfileId,
            selectionLocked = selectionLocked,
            activeExpeditionId = activeExpeditionId,
            clearedProfileIds = CampaignStateV1.CloneStrings(clearedProfileIds),
            resolvedVictoryIds = CampaignStateV1.CloneStrings(resolvedVictoryIds),
            victoryHistory = CampaignStateV1.CloneList(victoryHistory, value => value?.Clone())
        };
    }

    [Serializable]
    public sealed class BossVictoryHistoryV1
    {
        public string victoryId;
        public string profileId;
        public string expeditionId;
        public bool firstClear;
        public string rewardMaterialId;
        public int rewardQuantity;
        public string committedAtUtc;

        public BossVictoryHistoryV1 Clone() => (BossVictoryHistoryV1)MemberwiseClone();
    }

    [Serializable]
    public sealed class ExpeditionSourceStateV1
    {
        public string runSeed;
        public string expeditionId;
        public string dungeonProfileId;
        public string dungeonRulesetVersion;
        public string dungeonContentPackVersion;
        public string dungeonPlanId;
        public string ruinId;
        public string bossProfileId;
        public ActiveDungeonProgressV1 dungeonProgress = new ActiveDungeonProgressV1();

        public ExpeditionSourceStateV1 Clone() => new ExpeditionSourceStateV1
        {
            runSeed = runSeed,
            expeditionId = expeditionId,
            dungeonProfileId = dungeonProfileId,
            dungeonRulesetVersion = dungeonRulesetVersion,
            dungeonContentPackVersion = dungeonContentPackVersion,
            dungeonPlanId = dungeonPlanId,
            ruinId = ruinId,
            bossProfileId = bossProfileId,
            dungeonProgress = dungeonProgress?.Clone() ?? new ActiveDungeonProgressV1()
        };
    }

    /// <summary>
    /// Versioned source progress for the currently active generated dungeon.
    /// It contains stable facts and claims only: no GameObjects, water heights,
    /// moving-platform transforms, hazard phases, enemies, or other scene state.
    /// </summary>
    [Serializable]
    public sealed class ActiveDungeonProgressV1
    {
        public const int CurrentRecordVersion = 1;

        public int recordVersion = CurrentRecordVersion;
        public string checkpointId;
        public List<string> requiredFactIds = new List<string>();
        public List<string> requiredItemIds = new List<string>();
        public List<string> permanentFactIds = new List<string>();
        public List<string> activatedShortcutIds = new List<string>();
        public List<string> claimedRewardIds = new List<string>();
        public DungeonMapKnowledgeV1 mapKnowledge = new DungeonMapKnowledgeV1();
        public bool refractorSecured;

        public ActiveDungeonProgressV1 Clone() => new ActiveDungeonProgressV1
        {
            recordVersion = recordVersion,
            checkpointId = checkpointId,
            requiredFactIds = CampaignStateV1.CloneStrings(requiredFactIds),
            requiredItemIds = CampaignStateV1.CloneStrings(requiredItemIds),
            permanentFactIds = CampaignStateV1.CloneStrings(permanentFactIds),
            activatedShortcutIds = CampaignStateV1.CloneStrings(activatedShortcutIds),
            claimedRewardIds = CampaignStateV1.CloneStrings(claimedRewardIds),
            mapKnowledge = mapKnowledge?.Clone() ?? new DungeonMapKnowledgeV1(),
            refractorSecured = refractorSecured
        };
    }

    /// <summary>
    /// Durable, layered minimap knowledge. Environment presentation and current
    /// controller state remain derived from the regenerated dungeon plan.
    /// </summary>
    [Serializable]
    public sealed class DungeonMapKnowledgeV1
    {
        public const int CurrentRecordVersion = 2;

        public int recordVersion = CurrentRecordVersion;
        public List<string> seenRegionIds = new List<string>();
        public List<string> visitedRegionIds = new List<string>();
        public List<string> exploredRegionIds = new List<string>();
        public List<string> discoveredConnectionIds = new List<string>();
        public List<string> knownLandmarkIds = new List<string>();
        public List<string> knownMechanismIds = new List<string>();

        public DungeonMapKnowledgeV1 Clone() => new DungeonMapKnowledgeV1
        {
            recordVersion = recordVersion,
            seenRegionIds = CampaignStateV1.CloneStrings(seenRegionIds),
            visitedRegionIds = CampaignStateV1.CloneStrings(visitedRegionIds),
            exploredRegionIds = CampaignStateV1.CloneStrings(exploredRegionIds),
            discoveredConnectionIds = CampaignStateV1.CloneStrings(discoveredConnectionIds),
            knownLandmarkIds = CampaignStateV1.CloneStrings(knownLandmarkIds),
            knownMechanismIds = CampaignStateV1.CloneStrings(knownMechanismIds)
        };
    }

    /// <summary>
    /// Returnable ruin identity plus only the discoveries that are durable
    /// across visits. Mutable generated scene state is deliberately excluded.
    /// </summary>
    [Serializable]
    public sealed class KnownRuinV1
    {
        public const int CurrentRecordVersion = 1;

        public int recordVersion = CurrentRecordVersion;
        public string ruinId;
        public string dungeonPlanId;
        public string dungeonProfileId;
        public string dungeonRulesetVersion;
        public string dungeonContentPackVersion;
        public string runSeed;
        public List<string> permanentFactIds = new List<string>();
        public List<string> activatedShortcutIds = new List<string>();
        public List<string> claimedRewardIds = new List<string>();
        public DungeonMapKnowledgeV1 mapKnowledge = new DungeonMapKnowledgeV1();
        public bool refractorSecured;
        public string discoveredAtUtc;
        public string lastVisitedAtUtc;

        public KnownRuinV1 Clone() => new KnownRuinV1
        {
            recordVersion = recordVersion,
            ruinId = ruinId,
            dungeonPlanId = dungeonPlanId,
            dungeonProfileId = dungeonProfileId,
            dungeonRulesetVersion = dungeonRulesetVersion,
            dungeonContentPackVersion = dungeonContentPackVersion,
            runSeed = runSeed,
            permanentFactIds = CampaignStateV1.CloneStrings(permanentFactIds),
            activatedShortcutIds = CampaignStateV1.CloneStrings(activatedShortcutIds),
            claimedRewardIds = CampaignStateV1.CloneStrings(claimedRewardIds),
            mapKnowledge = mapKnowledge?.Clone() ?? new DungeonMapKnowledgeV1(),
            refractorSecured = refractorSecured,
            discoveredAtUtc = discoveredAtUtc,
            lastVisitedAtUtc = lastVisitedAtUtc
        };
    }

    /// <summary>
    /// Idempotent audit record for a resolved expedition. The profile,
    /// ruleset, seed, and plan id together preserve the source plan identity.
    /// </summary>
    [Serializable]
    public sealed class ExpeditionResolutionHistoryV1
    {
        public const int CurrentRecordVersion = 1;

        public int recordVersion = CurrentRecordVersion;
        public string resolutionId;
        public string expeditionId;
        public string ruinId;
        public string discoveryId;
        public string claimKey;
        public string dungeonPlanId;
        public string dungeonProfileId;
        public string dungeonRulesetVersion;
        public string dungeonContentPackVersion;
        public string runSeed;
        public string outcomeId;
        public List<string> claimedRewardIds = new List<string>();
        public bool refractorSecured;
        public string resolvedAtUtc;

        public ExpeditionResolutionHistoryV1 Clone() => new ExpeditionResolutionHistoryV1
        {
            recordVersion = recordVersion,
            resolutionId = resolutionId,
            expeditionId = expeditionId,
            ruinId = ruinId,
            discoveryId = discoveryId,
            claimKey = claimKey,
            dungeonPlanId = dungeonPlanId,
            dungeonProfileId = dungeonProfileId,
            dungeonRulesetVersion = dungeonRulesetVersion,
            dungeonContentPackVersion = dungeonContentPackVersion,
            runSeed = runSeed,
            outcomeId = outcomeId,
            claimedRewardIds = CampaignStateV1.CloneStrings(claimedRewardIds),
            refractorSecured = refractorSecured,
            resolvedAtUtc = resolvedAtUtc
        };
    }

    [Serializable]
    public sealed class QuarantinedUnknownIdV1
    {
        public string category;
        public string unknownId;
        public string path;
        public string quarantinedAtUtc;

        public QuarantinedUnknownIdV1 Clone() => (QuarantinedUnknownIdV1)MemberwiseClone();
    }
}
