using System;
using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Core.Foundation;
using UnityEngine;

namespace RuinCrawler.Runtime.Persistence.Tests
{
    public sealed class V2OnlyCampaignStatePolicyTests
    {
        [Test]
        public void IncompatibleActiveDungeonIsResetWithoutDiscardingPlayerProgress()
        {
            CampaignStateV1 source = CampaignStateRepair.Repair(
                CampaignStateV1.CreateDefault("v2-only-reset"));
            source.salvage.identifiedScrap = 47;
            source.ownedGearIds.Add("heatResistChip");
            source.discoveredRecipeIds.Add("heatResistChipRecipe");
            source.bossHunts.activeExpeditionId = "incompatible-expedition";
            source.bossHunts.selectionLocked = true;
            source.expedition = new ExpeditionSourceStateV1
            {
                expeditionId = "incompatible-expedition",
                runSeed = "incompatible-seed",
                dungeonProfileId = "removed-profile",
                dungeonRulesetVersion = "removed-ruleset",
                dungeonPlanId = "incompatible-plan",
                ruinId = "incompatible-ruin",
                bossProfileId = "ruby-optic-oracle",
                dungeonProgress = new ActiveDungeonProgressV1
                {
                    checkpointId = "incompatible-checkpoint",
                    requiredItemIds = new List<string> { "incompatible-key" },
                    activatedShortcutIds = new List<string> { "incompatible-shortcut" }
                }
            };
            source.knownRuins.Add(new KnownRuinV1
            {
                ruinId = "incompatible-ruin",
                dungeonPlanId = "incompatible-plan",
                dungeonProfileId = "removed-profile",
                dungeonRulesetVersion = "removed-ruleset",
                runSeed = "incompatible-seed"
            });
            source.expeditionResolutionHistory.Add(new ExpeditionResolutionHistoryV1
            {
                resolutionId = "incompatible-resolution",
                ruinId = "incompatible-ruin",
                dungeonPlanId = "incompatible-plan",
                dungeonProfileId = "removed-profile",
                dungeonRulesetVersion = "removed-ruleset",
                runSeed = "incompatible-seed"
            });

            V2OnlyCampaignStateResult result = V2OnlyCampaignStatePolicy.Normalize(source);

            Assert.That(result.Changed, Is.True);
            Assert.That(result.ActiveDungeonReset, Is.True);
            Assert.That(result.RemovedKnownRuins, Is.EqualTo(1));
            Assert.That(result.RemovedResolutionHistory, Is.EqualTo(1));
            Assert.That(result.Warning, Does.Contain("use the Camp entrance"));
            Assert.That(result.State.bossHunts.activeExpeditionId, Is.Null);
            Assert.That(result.State.bossHunts.selectionLocked, Is.False);
            Assert.That(result.State.bossHunts.selectedProfileId,
                Is.EqualTo("ruby-optic-oracle"),
                "The active run's Boss Hunt remains selected for the fresh dungeon departure.");
            Assert.That(result.State.expedition.expeditionId, Is.Null);
            Assert.That(result.State.expedition.dungeonProgress.requiredItemIds, Is.Empty);
            Assert.That(result.State.knownRuins, Is.Empty);
            Assert.That(result.State.expeditionResolutionHistory, Is.Empty);
            Assert.That(result.State.salvage.identifiedScrap, Is.EqualTo(47));
            Assert.That(result.State.ownedGearIds, Does.Contain("heatResistChip"));
            Assert.That(result.State.discoveredRecipeIds, Does.Contain("heatResistChipRecipe"));
        }

        [Test]
        public void CurrentCanonicalV2ExpeditionAndHistoryRemainUntouched()
        {
            CampaignStateV1 source = CampaignStateRepair.Repair(
                CampaignStateV1.CreateDefault("v2-only-current"));
            const string PlanId = "current-plan-signature";
            const string RuinId = "ruin:current-plan-signature";
            source.bossHunts.activeExpeditionId = "current-expedition";
            source.bossHunts.selectionLocked = true;
            source.expedition = CurrentExpedition(PlanId, RuinId);
            source.expedition.dungeonProgress.checkpointId = "factory-entry";
            source.knownRuins.Add(new KnownRuinV1
            {
                ruinId = RuinId,
                dungeonPlanId = PlanId,
                dungeonProfileId = IndustrialFactoryV2Ruleset.ProfileId,
                dungeonRulesetVersion = IndustrialFactoryV2Ruleset.RulesetVersion,
                dungeonContentPackVersion = IndustrialFactoryV2Ruleset.ContentPackVersion,
                runSeed = "current-seed"
            });
            source.expeditionResolutionHistory.Add(new ExpeditionResolutionHistoryV1
            {
                resolutionId = "current-resolution",
                expeditionId = "previous-expedition",
                ruinId = RuinId,
                dungeonPlanId = PlanId,
                dungeonProfileId = IndustrialFactoryV2Ruleset.ProfileId,
                dungeonRulesetVersion = IndustrialFactoryV2Ruleset.RulesetVersion,
                dungeonContentPackVersion = IndustrialFactoryV2Ruleset.ContentPackVersion,
                runSeed = "current-seed"
            });

            V2OnlyCampaignStateResult result = V2OnlyCampaignStatePolicy.Normalize(source);

            Assert.That(result.Changed, Is.False);
            Assert.That(result.ActiveDungeonReset, Is.False);
            Assert.That(result.Warning, Is.Null);
            Assert.That(result.State.expedition.dungeonProgress.checkpointId,
                Is.EqualTo("factory-entry"));
            Assert.That(result.State.knownRuins, Has.Count.EqualTo(1));
            Assert.That(result.State.expeditionResolutionHistory, Has.Count.EqualTo(1));
        }

        [Test]
        public void CampaignSessionLoadPersistsCleanupAndReturnsAnUnlockedCampState()
        {
            string root = Path.Combine(
                Path.GetTempPath(),
                "RuinCrawlerV2OnlyPolicyTests",
                Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            GameObject sessionRoot = null;
            try
            {
                var store = new JsonCampaignEnvelopeStore(root);
                CampaignStateV1 source = CampaignStateRepair.Repair(
                    CampaignStateV1.CreateDefault("campaign-main"));
                source.salvage.identifiedScrap = 23;
                source.bossHunts.activeExpeditionId = "incompatible-expedition";
                source.bossHunts.selectionLocked = true;
                source.expedition.expeditionId = "incompatible-expedition";
                source.expedition.runSeed = "incompatible-seed";
                source.expedition.dungeonProfileId = "removed-profile";
                Assert.That(store.Commit(new CampaignCommitRequest<CampaignStateV1>(
                    "seed-incompatible-save",
                    CampaignRevisionToken.NewCampaign("campaign-main"),
                    "write-incompatible-save",
                    "2026-07-18T00:00:00Z",
                    source)).Success, Is.True);

                sessionRoot = new GameObject("V2OnlyCampaignSessionTest");
                sessionRoot.SetActive(false);
                CampaignSession session = sessionRoot.AddComponent<CampaignSession>();
                session.ConfigureStoreForTests(store);
                string warning = null;
                session.PersistenceWarning += value => warning = value;

                CampaignLoadResult<CampaignStateV1> loaded = session.LoadOrCreate();

                Assert.That(loaded.HasState, Is.True);
                Assert.That(loaded.Envelope.Revision, Is.EqualTo(2),
                    "The cleanup is rewritten atomically during load.");
                Assert.That(loaded.Envelope.State.bossHunts.activeExpeditionId, Is.Null);
                Assert.That(loaded.Envelope.State.bossHunts.selectionLocked, Is.False);
                Assert.That(loaded.Envelope.State.expedition.expeditionId, Is.Null);
                Assert.That(loaded.Envelope.State.salvage.identifiedScrap, Is.EqualTo(23));
                Assert.That(warning, Does.Contain("current generated ruin format"));

                CampaignLoadResult<CampaignStateV1> durable = store.Load("campaign-main");
                Assert.That(durable.Envelope.Revision, Is.EqualTo(2));
                Assert.That(durable.Envelope.State.bossHunts.activeExpeditionId, Is.Null);
                Assert.That(durable.Envelope.State.salvage.identifiedScrap, Is.EqualTo(23));
            }
            finally
            {
                if (sessionRoot != null)
                {
                    UnityEngine.Object.DestroyImmediate(sessionRoot);
                }

                if (Directory.Exists(root))
                {
                    Directory.Delete(root, true);
                }
            }
        }

        private static ExpeditionSourceStateV1 CurrentExpedition(string planId, string ruinId)
        {
            return new ExpeditionSourceStateV1
            {
                expeditionId = "current-expedition",
                runSeed = "current-seed",
                dungeonProfileId = IndustrialFactoryV2Ruleset.ProfileId,
                dungeonRulesetVersion = IndustrialFactoryV2Ruleset.RulesetVersion,
                dungeonContentPackVersion = IndustrialFactoryV2Ruleset.ContentPackVersion,
                dungeonPlanId = planId,
                ruinId = ruinId,
                dungeonProgress = new ActiveDungeonProgressV1()
            };
        }
    }
}
