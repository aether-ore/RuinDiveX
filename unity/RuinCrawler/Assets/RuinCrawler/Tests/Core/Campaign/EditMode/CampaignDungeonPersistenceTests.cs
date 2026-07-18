using System.Collections.Generic;
using NUnit.Framework;

namespace RuinCrawler.Core.Campaign.Tests
{
    public sealed class CampaignDungeonPersistenceTests
    {
        [Test]
        public void DefaultPayloadUsesVersionTwoDungeonSourceRecords()
        {
            CampaignStateV1 state = CampaignStateRepair.Repair(CampaignStateV1.CreateDefault("dungeon-v2"));

            Assert.That(state.stateVersion, Is.EqualTo(2));
            Assert.That(state.expedition.dungeonProgress, Is.Not.Null);
            Assert.That(state.expedition.dungeonProgress.recordVersion,
                Is.EqualTo(ActiveDungeonProgressV1.CurrentRecordVersion));
            Assert.That(state.expedition.dungeonProgress.mapKnowledge, Is.Not.Null);
            Assert.That(state.knownRuins, Is.Not.Null.And.Empty);
            Assert.That(state.expeditionResolutionHistory, Is.Not.Null.And.Empty);
            Assert.That(state.appliedMigrationIds,
                Does.Contain(CampaignStateRepair.DungeonPersistenceV2MigrationId));
        }

        [Test]
        public void RepairNormalizesDungeonSourceWithoutProfileSpecificPinning()
        {
            var source = new CampaignStateV1
            {
                stateVersion = 1,
                campaignId = "schema-source-dungeon",
                expedition = new ExpeditionSourceStateV1
                {
                    expeditionId = " source-expedition ",
                    runSeed = " source-seed ",
                    dungeonProfileId = " removed-profile ",
                    dungeonRulesetVersion = "future-wrong-version",
                    dungeonProgress = null
                },
                knownRuins = null,
                expeditionResolutionHistory = null,
                appliedMigrationIds = new List<string>()
            };

            CampaignStateV1 migrated = CampaignStateRepair.Repair(source);
            CampaignStateV1 replay = CampaignStateRepair.Repair(migrated.Clone());

            Assert.That(migrated.stateVersion, Is.EqualTo(CampaignStateV1.CurrentStateVersion));
            Assert.That(migrated.expedition.expeditionId, Is.EqualTo("source-expedition"));
            Assert.That(migrated.expedition.runSeed, Is.EqualTo("source-seed"));
            Assert.That(migrated.expedition.dungeonProfileId,
                Is.EqualTo("removed-profile"));
            Assert.That(migrated.expedition.dungeonRulesetVersion,
                Is.EqualTo("future-wrong-version"));
            Assert.That(migrated.expedition.dungeonPlanId, Is.EqualTo("source-expedition"));
            Assert.That(migrated.expedition.ruinId, Is.EqualTo("source-expedition"));
            Assert.That(migrated.expedition.dungeonProgress, Is.Not.Null);
            Assert.That(migrated.knownRuins, Is.Empty);
            Assert.That(migrated.expeditionResolutionHistory, Is.Empty);
            Assert.That(migrated.appliedMigrationIds.FindAll(value =>
                value == CampaignStateRepair.DungeonPersistenceV2MigrationId), Has.Count.EqualTo(1));
            Assert.That(replay.appliedMigrationIds, Is.EqualTo(migrated.appliedMigrationIds));
            Assert.That(replay.expedition.dungeonRulesetVersion,
                Is.EqualTo("future-wrong-version"));
        }

        [Test]
        public void BeginExpeditionStoresOnlyTheExplicitDungeonIdentity()
        {
            CampaignStateV1 source = CampaignStateV1.CreateDefault("plan-identity");

            WorkshopTransactionResult unspecified = RollWorkshopService.BeginExpedition(
                source,
                "unspecified-expedition",
                "unspecified-seed",
                "unsupported-profile");
            WorkshopTransactionResult v2 = RollWorkshopService.BeginExpedition(
                source,
                "factory-expedition",
                "factory-seed",
                "industrial-factory-v2",
                "dungeon-plan-v2",
                "factory-plan-17",
                dungeonContentPackVersion: "factory-contracts-v1");

            Assert.That(unspecified.Success, Is.True);
            Assert.That(unspecified.State.expedition.dungeonRulesetVersion, Is.Null);
            Assert.That(unspecified.State.expedition.dungeonPlanId,
                Is.EqualTo("unspecified-expedition"));
            Assert.That(unspecified.State.expedition.ruinId,
                Is.EqualTo("unspecified-expedition"));
            Assert.That(v2.Success, Is.True);
            Assert.That(v2.State.expedition.dungeonRulesetVersion, Is.EqualTo("dungeon-plan-v2"));
            Assert.That(v2.State.expedition.dungeonPlanId, Is.EqualTo("factory-plan-17"));
            Assert.That(v2.State.expedition.dungeonContentPackVersion,
                Is.EqualTo("factory-contracts-v1"));
            Assert.That(v2.State.expedition.ruinId, Is.EqualTo("factory-plan-17"));
        }

        [Test]
        public void RepairNormalizesDurableDungeonProgressWithoutPersistingSceneState()
        {
            CampaignStateV1 state = CampaignStateV1.CreateDefault("durable-progress");
            state.expedition.dungeonProgress = new ActiveDungeonProgressV1
            {
                recordVersion = 99,
                checkpointId = " checkpoint-lower-works ",
                requiredFactIds = new List<string> { "pump-online", "pump-online", " valve-a " },
                requiredItemIds = new List<string> { "credential-a", "credential-a" },
                permanentFactIds = new List<string> { "console-grounded" },
                activatedShortcutIds = new List<string> { "shortcut-gantry" },
                claimedRewardIds = new List<string> { "refractor-cache", "refractor-cache" },
                mapKnowledge = new DungeonMapKnowledgeV1
                {
                    seenRegionIds = new List<string> { "entrance" },
                    visitedRegionIds = new List<string> { "lower-works", "entrance" },
                    exploredRegionIds = new List<string> { "machine-core" },
                    discoveredConnectionIds = new List<string> { "pipe-tunnel" },
                    knownLandmarkIds = new List<string> { "pump-tower" },
                    knownMechanismIds = new List<string> { "pump-console" }
                },
                refractorSecured = true
            };

            CampaignStateV1 repaired = CampaignStateRepair.Repair(state);
            ActiveDungeonProgressV1 progress = repaired.expedition.dungeonProgress;

            Assert.That(progress.recordVersion, Is.EqualTo(ActiveDungeonProgressV1.CurrentRecordVersion));
            Assert.That(progress.checkpointId, Is.EqualTo("checkpoint-lower-works"));
            Assert.That(progress.requiredFactIds, Is.EqualTo(new[] { "pump-online", "valve-a" }));
            Assert.That(progress.requiredItemIds, Is.EqualTo(new[] { "credential-a" }));
            Assert.That(progress.claimedRewardIds, Is.EqualTo(new[] { "refractor-cache" }));
            Assert.That(progress.mapKnowledge.seenRegionIds,
                Is.EqualTo(new[] { "entrance", "lower-works", "machine-core" }));
            Assert.That(progress.mapKnowledge.visitedRegionIds,
                Is.EqualTo(new[] { "entrance", "lower-works", "machine-core" }));
            Assert.That(progress.mapKnowledge.exploredRegionIds,
                Is.EqualTo(new[] { "machine-core" }));
            Assert.That(progress.refractorSecured, Is.True);
        }

        [Test]
        public void RepairMergesKnownRuinDurabilityAndDeduplicatesResolutionHistory()
        {
            CampaignStateV1 state = CampaignStateV1.CreateDefault("known-ruins");
            state.knownRuins.Add(new KnownRuinV1
            {
                ruinId = " factory-ruin ",
                dungeonProfileId = "test-profile",
                dungeonRulesetVersion = "incorrect",
                dungeonContentPackVersion = " factory-contracts-v1 ",
                runSeed = "seed-a",
                permanentFactIds = new List<string> { "console-a" },
                claimedRewardIds = new List<string> { "cache-a" },
                mapKnowledge = new DungeonMapKnowledgeV1
                {
                    seenRegionIds = new List<string> { "entrance" }
                }
            });
            state.knownRuins.Add(new KnownRuinV1
            {
                ruinId = "factory-ruin",
                activatedShortcutIds = new List<string> { "shortcut-a" },
                claimedRewardIds = new List<string> { "cache-b" },
                mapKnowledge = new DungeonMapKnowledgeV1
                {
                    exploredRegionIds = new List<string> { "machine-core" }
                },
                refractorSecured = true
            });
            state.expeditionResolutionHistory.Add(new ExpeditionResolutionHistoryV1
            {
                resolutionId = " resolution-a ",
                expeditionId = "expedition-a",
                dungeonProfileId = "test-profile",
                dungeonRulesetVersion = "incorrect",
                dungeonContentPackVersion = " factory-contracts-v1 ",
                outcomeId = "extracted",
                claimedRewardIds = new List<string> { "cache-a", "cache-a" },
                refractorSecured = true
            });
            state.expeditionResolutionHistory.Add(new ExpeditionResolutionHistoryV1
            {
                resolutionId = "resolution-a",
                outcomeId = "duplicate"
            });

            CampaignStateV1 repaired = CampaignStateRepair.Repair(state);

            Assert.That(repaired.knownRuins, Has.Count.EqualTo(1));
            KnownRuinV1 ruin = repaired.knownRuins[0];
            Assert.That(ruin.dungeonPlanId, Is.EqualTo("factory-ruin"));
            Assert.That(ruin.dungeonRulesetVersion,
                Is.EqualTo("incorrect"));
            Assert.That(ruin.dungeonContentPackVersion, Is.EqualTo("factory-contracts-v1"));
            Assert.That(ruin.permanentFactIds, Is.EqualTo(new[] { "console-a" }));
            Assert.That(ruin.activatedShortcutIds, Is.EqualTo(new[] { "shortcut-a" }));
            Assert.That(ruin.claimedRewardIds, Is.EqualTo(new[]
            {
                DungeonRewardTransactionService.CreateClaimKey("factory-ruin", "cache-a"),
                DungeonRewardTransactionService.CreateClaimKey("factory-ruin", "cache-b")
            }));
            Assert.That(ruin.mapKnowledge.seenRegionIds,
                Is.EqualTo(new[] { "entrance", "machine-core" }));
            Assert.That(ruin.mapKnowledge.visitedRegionIds,
                Is.EqualTo(new[] { "machine-core" }));
            Assert.That(ruin.mapKnowledge.exploredRegionIds,
                Is.EqualTo(new[] { "machine-core" }));
            Assert.That(ruin.refractorSecured, Is.True);

            Assert.That(repaired.expeditionResolutionHistory, Has.Count.EqualTo(1));
            ExpeditionResolutionHistoryV1 history = repaired.expeditionResolutionHistory[0];
            Assert.That(history.resolutionId, Is.EqualTo("resolution-a"));
            Assert.That(history.dungeonPlanId, Is.EqualTo("expedition-a"));
            Assert.That(history.dungeonRulesetVersion,
                Is.EqualTo("incorrect"));
            Assert.That(history.dungeonContentPackVersion, Is.EqualTo("factory-contracts-v1"));
            Assert.That(history.claimedRewardIds, Is.EqualTo(new[] { "cache-a" }));
            Assert.That(history.refractorSecured, Is.True);
        }

        [Test]
        public void CloneDeepCopiesAllDungeonPersistenceCollections()
        {
            CampaignStateV1 source = CampaignStateV1.CreateDefault("clone-dungeon-source");
            source.expedition.dungeonProgress.requiredFactIds.Add("fact-a");
            source.expedition.dungeonContentPackVersion = "factory-contracts-v1";
            source.expedition.dungeonProgress.mapKnowledge.visitedRegionIds.Add("region-a");
            source.expedition.dungeonProgress.mapKnowledge.exploredRegionIds.Add("region-explored-a");
            source.knownRuins.Add(new KnownRuinV1
            {
                ruinId = "ruin-a",
                permanentFactIds = new List<string> { "permanent-a" },
                mapKnowledge = new DungeonMapKnowledgeV1
                {
                    knownLandmarkIds = new List<string> { "landmark-a" }
                }
            });
            source.expeditionResolutionHistory.Add(new ExpeditionResolutionHistoryV1
            {
                resolutionId = "resolution-a",
                claimedRewardIds = new List<string> { "reward-a" }
            });

            CampaignStateV1 clone = source.Clone();
            clone.expedition.dungeonProgress.requiredFactIds.Add("fact-b");
            clone.expedition.dungeonProgress.mapKnowledge.visitedRegionIds.Add("region-b");
            clone.expedition.dungeonProgress.mapKnowledge.exploredRegionIds.Add("region-explored-b");
            clone.knownRuins[0].permanentFactIds.Add("permanent-b");
            clone.knownRuins[0].mapKnowledge.knownLandmarkIds.Add("landmark-b");
            clone.expeditionResolutionHistory[0].claimedRewardIds.Add("reward-b");

            Assert.That(source.expedition.dungeonProgress.requiredFactIds,
                Is.EqualTo(new[] { "fact-a" }));
            Assert.That(clone.expedition.dungeonContentPackVersion,
                Is.EqualTo("factory-contracts-v1"));
            Assert.That(source.expedition.dungeonProgress.mapKnowledge.visitedRegionIds,
                Is.EqualTo(new[] { "region-a" }));
            Assert.That(source.expedition.dungeonProgress.mapKnowledge.exploredRegionIds,
                Is.EqualTo(new[] { "region-explored-a" }));
            Assert.That(source.knownRuins[0].permanentFactIds,
                Is.EqualTo(new[] { "permanent-a" }));
            Assert.That(source.knownRuins[0].mapKnowledge.knownLandmarkIds,
                Is.EqualTo(new[] { "landmark-a" }));
            Assert.That(source.expeditionResolutionHistory[0].claimedRewardIds,
                Is.EqualTo(new[] { "reward-a" }));
        }
    }
}
