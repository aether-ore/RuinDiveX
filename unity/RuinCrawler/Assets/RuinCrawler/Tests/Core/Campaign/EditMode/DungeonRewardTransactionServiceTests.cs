using System.Collections.Generic;
using NUnit.Framework;

namespace RuinCrawler.Core.Campaign.Tests
{
    public sealed class DungeonRewardTransactionServiceTests
    {
        [Test]
        public void CorruptLengthPrefixedClaimKeyReturnsFalseInsteadOfOverflowing()
        {
            Assert.That(DungeonRewardTransactionService.TryParseClaimKey(
                "drc1:2147483647:x",
                out _,
                out _,
                out _), Is.False);
            Assert.That(DungeonRewardTransactionService.TryParseClaimKey(
                "drc1e:2147483647:x",
                out _,
                out _,
                out _), Is.False);
        }

        [Test]
        public void OncePerExpeditionClaim_AppliesTypedEffectsAndReplaysWithoutDuplication()
        {
            CampaignStateV1 source = BeginExpedition(
                CampaignStateV1.CreateDefault("reward-expedition"),
                "expedition-a");
            source.salvage.identifiedScrap = 10;
            var request = new DungeonRewardClaimRequestV1(
                "ruin-a",
                "cache-a",
                "expedition-a",
                DungeonRewardClaimScopeV1.OncePerExpedition,
                new DungeonRewardGrantV1(
                    identifiedScrap: 5,
                    requiredFactIds: new[] { "pump-online" },
                    requiredItemIds: new[] { "credential-a" },
                    permanentFactIds: new[] { "console-grounded" },
                    currentExpeditionShortcutIds: new[] { "gantry-lift", "temporary-lift" },
                    discoveredRecipeIds: new[] { "recipe-voltage-core" },
                    seenRegionIds: new[] { "entry" },
                    visitedRegionIds: new[] { "lower-works" },
                    exploredRegionIds: new[] { "machine-core" },
                    discoveredConnectionIds: new[] { "pipe-route" },
                    knownLandmarkIds: new[] { "pump-tower" },
                    knownMechanismIds: new[] { "drain-console" }));

            DungeonRewardTransactionResult claimed =
                DungeonRewardTransactionService.ClaimDiscovery(source, request);

            Assert.That(claimed.Success, Is.True);
            Assert.That(claimed.Changed, Is.True);
            Assert.That(claimed.IdempotentReplay, Is.False);
            Assert.That(claimed.IdentifiedScrapAwarded, Is.EqualTo(5));
            Assert.That(source.salvage.identifiedScrap, Is.EqualTo(10),
                "Transactions must not mutate their source state.");
            Assert.That(claimed.State.salvage.identifiedScrap, Is.EqualTo(15));
            Assert.That(claimed.State.discoveredRecipeIds,
                Does.Contain("recipe-voltage-core"));
            Assert.That(claimed.State.expedition.dungeonProgress.requiredFactIds,
                Does.Contain("pump-online"));
            Assert.That(claimed.State.expedition.dungeonProgress.requiredItemIds,
                Does.Contain("credential-a"));
            Assert.That(claimed.State.expedition.dungeonProgress.permanentFactIds,
                Does.Contain("console-grounded"));
            Assert.That(claimed.State.expedition.dungeonProgress.activatedShortcutIds,
                Is.EqualTo(new[] { "gantry-lift", "temporary-lift" }));
            Assert.That(claimed.State.expedition.dungeonProgress.mapKnowledge.seenRegionIds,
                Is.EqualTo(new[] { "entry", "lower-works", "machine-core" }));
            Assert.That(claimed.State.expedition.dungeonProgress.mapKnowledge.visitedRegionIds,
                Is.EqualTo(new[] { "lower-works", "machine-core" }));
            Assert.That(claimed.State.expedition.dungeonProgress.mapKnowledge.exploredRegionIds,
                Is.EqualTo(new[] { "machine-core" }));
            Assert.That(claimed.State.expedition.dungeonProgress.mapKnowledge.discoveredConnectionIds,
                Does.Contain("pipe-route"));
            Assert.That(claimed.State.expedition.dungeonProgress.mapKnowledge.knownLandmarkIds,
                Does.Contain("pump-tower"));
            Assert.That(claimed.State.expedition.dungeonProgress.mapKnowledge.knownMechanismIds,
                Does.Contain("drain-console"));
            Assert.That(claimed.State.knownRuins, Has.Count.EqualTo(1));
            Assert.That(claimed.State.knownRuins[0].dungeonContentPackVersion,
                Is.EqualTo("factory-contracts-v1"));
            Assert.That(claimed.State.knownRuins[0].permanentFactIds,
                Does.Contain("console-grounded"));
            Assert.That(claimed.State.knownRuins[0].activatedShortcutIds,
                Is.Empty,
                "Expedition shortcut activation must not leak into KnownRuin.");
            Assert.That(claimed.State.knownRuins[0].claimedRewardIds, Is.Empty,
                "An expedition-scoped claim must not become ruin-scoped.");
            Assert.That(DungeonRewardTransactionService.IsClaimKey(claimed.ClaimKey), Is.True);
            Assert.That(claimed.State.expedition.dungeonProgress.claimedRewardIds,
                Is.EqualTo(new[] { claimed.ClaimKey }));

            DungeonRewardTransactionResult replay =
                DungeonRewardTransactionService.ClaimDiscovery(claimed.State, request);

            Assert.That(replay.Success, Is.True);
            Assert.That(replay.Changed, Is.False);
            Assert.That(replay.IdempotentReplay, Is.True);
            Assert.That(replay.IdentifiedScrapAwarded, Is.Zero);
            Assert.That(replay.State.salvage.identifiedScrap, Is.EqualTo(15));
            Assert.That(replay.State.expedition.dungeonProgress.claimedRewardIds,
                Is.EqualTo(new[] { claimed.ClaimKey }));
        }

        [Test]
        public void OncePerExpeditionClaim_IgnoresRuinScopedClaimKey()
        {
            CampaignStateV1 source = BeginExpedition(
                CampaignStateV1.CreateDefault("reward-expedition-key-scope"),
                "expedition-a");
            string ruinScopedKey = DungeonRewardTransactionService.CreateClaimKey(
                "ruin-a",
                "cache-a");
            source.expedition.dungeonProgress.claimedRewardIds.Add(ruinScopedKey);
            var request = new DungeonRewardClaimRequestV1(
                "ruin-a",
                "cache-a",
                "expedition-a",
                DungeonRewardClaimScopeV1.OncePerExpedition,
                new DungeonRewardGrantV1(identifiedScrap: 3));

            DungeonRewardTransactionResult claimed =
                DungeonRewardTransactionService.ClaimDiscovery(source, request);

            Assert.That(claimed.Success, Is.True);
            Assert.That(claimed.Changed, Is.True);
            Assert.That(claimed.IdempotentReplay, Is.False);
            Assert.That(claimed.State.salvage.identifiedScrap, Is.EqualTo(3));
            Assert.That(claimed.ClaimKey, Is.EqualTo(
                DungeonRewardTransactionService.CreateExpeditionClaimKey(
                    "expedition-a",
                    "ruin-a",
                    "cache-a")));
            Assert.That(claimed.State.expedition.dungeonProgress.claimedRewardIds,
                Does.Contain(ruinScopedKey));
            Assert.That(claimed.State.expedition.dungeonProgress.claimedRewardIds,
                Does.Contain(claimed.ClaimKey));
        }

        [Test]
        public void OncePerRuinClaim_RemainsClaimedAcrossLaterExpeditions()
        {
            CampaignStateV1 firstExpedition = BeginExpedition(
                CampaignStateV1.CreateDefault("reward-ruin"),
                "expedition-a");
            var firstRequest = new DungeonRewardClaimRequestV1(
                "ruin-a",
                "permanent-cache",
                "expedition-a",
                DungeonRewardClaimScopeV1.OncePerRuin,
                new DungeonRewardGrantV1(identifiedScrap: 7));
            DungeonRewardTransactionResult first =
                DungeonRewardTransactionService.ClaimDiscovery(firstExpedition, firstRequest);
            Assert.That(first.Success, Is.True);
            Assert.That(first.State.salvage.identifiedScrap, Is.EqualTo(7));

            WorkshopTransactionResult returned =
                RollWorkshopService.ReturnToCamp(first.State, "expedition-a");
            Assert.That(returned.Success, Is.True);
            CampaignStateV1 secondExpedition = BeginExpedition(returned.State, "expedition-b");
            var secondRequest = new DungeonRewardClaimRequestV1(
                "ruin-a",
                "permanent-cache",
                "expedition-b",
                DungeonRewardClaimScopeV1.OncePerRuin,
                new DungeonRewardGrantV1(identifiedScrap: 7));

            DungeonRewardTransactionResult replay =
                DungeonRewardTransactionService.ClaimDiscovery(secondExpedition, secondRequest);

            Assert.That(replay.Success, Is.True);
            Assert.That(replay.Changed, Is.False);
            Assert.That(replay.IdempotentReplay, Is.True);
            Assert.That(replay.State.salvage.identifiedScrap, Is.EqualTo(7));
            Assert.That(replay.State.knownRuins, Has.Count.EqualTo(1));
            Assert.That(replay.State.knownRuins[0].claimedRewardIds,
                Is.EqualTo(new[] { first.ClaimKey }));
        }

        [Test]
        public void FailedClaim_RollsBackContextMismatchAndOverflow()
        {
            CampaignStateV1 source = BeginExpedition(
                CampaignStateV1.CreateDefault("reward-rollback"),
                "expedition-a");
            source.salvage.identifiedScrap = int.MaxValue;

            DungeonRewardTransactionResult mismatch =
                DungeonRewardTransactionService.ClaimDiscovery(
                    source,
                    new DungeonRewardClaimRequestV1(
                        "ruin-b",
                        "cache-a",
                        "expedition-a",
                        DungeonRewardClaimScopeV1.OncePerExpedition,
                        new DungeonRewardGrantV1(identifiedScrap: 1)));
            DungeonRewardTransactionResult overflow =
                DungeonRewardTransactionService.ClaimDiscovery(
                    source,
                    new DungeonRewardClaimRequestV1(
                        "ruin-a",
                        "cache-a",
                        "expedition-a",
                        DungeonRewardClaimScopeV1.OncePerExpedition,
                        new DungeonRewardGrantV1(identifiedScrap: 1)));

            Assert.That(mismatch.Success, Is.False);
            Assert.That(mismatch.FailureCode, Is.EqualTo("expedition-context-mismatch"));
            Assert.That(mismatch.State, Is.SameAs(source));
            Assert.That(overflow.Success, Is.False);
            Assert.That(overflow.FailureCode, Is.EqualTo("reward-overflow"));
            Assert.That(overflow.State, Is.SameAs(source));
            Assert.That(source.salvage.identifiedScrap, Is.EqualTo(int.MaxValue));
            Assert.That(source.expedition.dungeonProgress.claimedRewardIds, Is.Empty);
            Assert.That(source.knownRuins, Is.Empty);
        }

        [Test]
        public void LargeRefractorResolution_IsDurableIdempotentAndConflictSafe()
        {
            CampaignStateV1 source = BeginExpedition(
                CampaignStateV1.CreateDefault("large-refractor"),
                "expedition-a");

            DungeonRewardTransactionResult resolved =
                DungeonRewardTransactionService.ResolveLargeRefractor(
                    source,
                    "resolution-a",
                    "ruin-a",
                    "large-refractor",
                    "expedition-a",
                    "2026-07-17T01:00:00Z");

            Assert.That(resolved.Success, Is.True);
            Assert.That(resolved.Changed, Is.True);
            Assert.That(resolved.State.expedition.dungeonProgress.refractorSecured, Is.True);
            Assert.That(resolved.State.knownRuins, Has.Count.EqualTo(1));
            Assert.That(resolved.State.knownRuins[0].refractorSecured, Is.True);
            Assert.That(resolved.State.expeditionResolutionHistory, Has.Count.EqualTo(1));
            ExpeditionResolutionHistoryV1 history =
                resolved.State.expeditionResolutionHistory[0];
            Assert.That(history.resolutionId, Is.EqualTo("resolution-a"));
            Assert.That(history.ruinId, Is.EqualTo("ruin-a"));
            Assert.That(history.discoveryId, Is.EqualTo("large-refractor"));
            Assert.That(history.claimKey, Is.EqualTo(resolved.ClaimKey));
            Assert.That(history.outcomeId,
                Is.EqualTo(DungeonRewardTransactionService.LargeRefractorOutcomeId));
            Assert.That(history.refractorSecured, Is.True);
            Assert.That(history.dungeonContentPackVersion,
                Is.EqualTo("factory-contracts-v1"));
            Assert.That(history.claimedRewardIds, Is.EqualTo(new[] { resolved.ClaimKey }));

            DungeonRewardTransactionResult replay =
                DungeonRewardTransactionService.ResolveLargeRefractor(
                    resolved.State,
                    "resolution-b",
                    "ruin-a",
                    "large-refractor",
                    "expedition-a",
                    "2026-07-17T02:00:00Z");
            Assert.That(replay.Success, Is.True);
            Assert.That(replay.Changed, Is.False);
            Assert.That(replay.IdempotentReplay, Is.True);
            Assert.That(replay.State.expeditionResolutionHistory, Has.Count.EqualTo(1));

            DungeonRewardTransactionResult conflict =
                DungeonRewardTransactionService.ResolveLargeRefractor(
                    resolved.State,
                    "resolution-a",
                    "ruin-a",
                    "different-discovery",
                    "expedition-a",
                    "2026-07-17T03:00:00Z");
            Assert.That(conflict.Success, Is.False);
            Assert.That(conflict.FailureCode, Is.EqualTo("resolution-id-conflict"));
            Assert.That(conflict.State, Is.SameAs(resolved.State));
            Assert.That(conflict.State.expeditionResolutionHistory, Has.Count.EqualTo(1));
        }

        [Test]
        public void LargeRefractorResolution_IsOncePerExpedition_NotOncePerRuin()
        {
            CampaignStateV1 firstExpedition = BeginExpedition(
                CampaignStateV1.CreateDefault("large-refractor-return"),
                "expedition-a");
            DungeonRewardTransactionResult first =
                DungeonRewardTransactionService.ResolveLargeRefractor(
                    firstExpedition,
                    "resolution-a",
                    "ruin-a",
                    "large-refractor",
                    "expedition-a",
                    "2026-07-17T04:00:00Z");
            Assert.That(first.Success, Is.True);

            WorkshopTransactionResult returned =
                RollWorkshopService.ReturnToCamp(first.State, "expedition-a");
            Assert.That(returned.Success, Is.True);
            CampaignStateV1 secondExpedition = BeginExpedition(returned.State, "expedition-b");
            DungeonRewardTransactionResult second =
                DungeonRewardTransactionService.ResolveLargeRefractor(
                    secondExpedition,
                    "resolution-b",
                    "ruin-a",
                    "large-refractor",
                    "expedition-b",
                    "2026-07-17T05:00:00Z");

            Assert.That(second.Success, Is.True);
            Assert.That(second.Changed, Is.True);
            Assert.That(second.IdempotentReplay, Is.False);
            Assert.That(second.ClaimKey, Is.Not.EqualTo(first.ClaimKey));
            Assert.That(second.State.expeditionResolutionHistory, Has.Count.EqualTo(2));
            Assert.That(second.State.expeditionResolutionHistory.FindAll(value =>
                value.expeditionId == "expedition-a" && value.claimKey == first.ClaimKey),
                Has.Count.EqualTo(1));
            Assert.That(second.State.expeditionResolutionHistory.FindAll(value =>
                value.expeditionId == "expedition-b" && value.claimKey == second.ClaimKey),
                Has.Count.EqualTo(1));
            Assert.That(second.State.knownRuins[0].refractorSecured, Is.True,
                "KnownRuin retains historical discovery without owning the expedition claim.");
            Assert.That(second.State.knownRuins[0].claimedRewardIds,
                Does.Not.Contain(first.ClaimKey));
            Assert.That(second.State.knownRuins[0].claimedRewardIds,
                Does.Not.Contain(second.ClaimKey));
            Assert.That(DungeonRewardTransactionService.TryParseClaimKey(
                second.ClaimKey,
                out string ruinId,
                out string discoveryId,
                out string expeditionId), Is.True);
            Assert.That(ruinId, Is.EqualTo("ruin-a"));
            Assert.That(discoveryId, Is.EqualTo("large-refractor"));
            Assert.That(expeditionId, Is.EqualTo("expedition-b"));
        }

        [Test]
        public void RepairMigratesUnstructuredRewardIdsToCompositeKeysExactlyOnce()
        {
            var source = new CampaignStateV1
            {
                stateVersion = 1,
                campaignId = "unstructured-rewards",
                expedition = new ExpeditionSourceStateV1
                {
                    expeditionId = "expedition-a",
                    ruinId = "ruin-a",
                    dungeonPlanId = "plan-a",
                    dungeonProfileId = "industrial-factory-v2",
                    dungeonRulesetVersion = "dungeon-plan-v2",
                    runSeed = "seed-a",
                    dungeonProgress = new ActiveDungeonProgressV1
                    {
                        claimedRewardIds = new List<string> { "cache-a", "cache-a" }
                    }
                },
                knownRuins = new List<KnownRuinV1>
                {
                    new KnownRuinV1
                    {
                        ruinId = "ruin-a",
                        dungeonPlanId = "plan-a",
                        claimedRewardIds = new List<string> { "cache-a" }
                    }
                },
                expeditionResolutionHistory = new List<ExpeditionResolutionHistoryV1>
                {
                    new ExpeditionResolutionHistoryV1
                    {
                        resolutionId = "resolution-a",
                        expeditionId = "expedition-a",
                        ruinId = "ruin-a",
                        discoveryId = "large-refractor",
                        claimedRewardIds = new List<string> { "large-refractor" }
                    }
                },
                appliedMigrationIds = new List<string>()
            };

            CampaignStateV1 migrated = CampaignStateRepair.Repair(source);
            CampaignStateV1 replay = CampaignStateRepair.Repair(migrated.Clone());
            string cacheKey = DungeonRewardTransactionService.CreateClaimKey("ruin-a", "cache-a");
            string refractorKey = DungeonRewardTransactionService.CreateClaimKey(
                "ruin-a",
                "large-refractor");

            Assert.That(migrated.expedition.dungeonProgress.claimedRewardIds,
                Is.EqualTo(new[] { cacheKey }));
            Assert.That(migrated.knownRuins[0].claimedRewardIds,
                Is.EqualTo(new[] { cacheKey }));
            Assert.That(migrated.expeditionResolutionHistory[0].claimKey,
                Is.EqualTo(refractorKey));
            Assert.That(migrated.expeditionResolutionHistory[0].claimedRewardIds,
                Is.EqualTo(new[] { refractorKey }));
            Assert.That(migrated.appliedMigrationIds.FindAll(value =>
                value == CampaignStateRepair.DungeonRewardClaimsV2MigrationId),
                Has.Count.EqualTo(1));
            Assert.That(replay.appliedMigrationIds, Is.EqualTo(migrated.appliedMigrationIds));
            Assert.That(replay.expedition.dungeonProgress.claimedRewardIds,
                Is.EqualTo(migrated.expedition.dungeonProgress.claimedRewardIds));
        }

        [Test]
        public void ClaimRejectsKnownRuinBoundToDifferentContentPack()
        {
            CampaignStateV1 source = BeginExpedition(
                CampaignStateV1.CreateDefault("content-pack-mismatch"),
                "expedition-a");
            source.knownRuins.Add(new KnownRuinV1
            {
                ruinId = "ruin-a",
                dungeonPlanId = "plan-a",
                dungeonProfileId = "industrial-factory-v2",
                dungeonRulesetVersion = "dungeon-plan-v2",
                dungeonContentPackVersion = "different-contracts-v9",
                runSeed = "seed-a"
            });

            DungeonRewardTransactionResult result =
                DungeonRewardTransactionService.ClaimDiscovery(
                    source,
                    new DungeonRewardClaimRequestV1(
                        "ruin-a",
                        "cache-a",
                        "expedition-a",
                        DungeonRewardClaimScopeV1.OncePerRuin));

            Assert.That(result.Success, Is.False);
            Assert.That(result.FailureCode, Is.EqualTo("ruin-plan-mismatch"));
            Assert.That(result.State, Is.SameAs(source));
        }

        private static CampaignStateV1 BeginExpedition(
            CampaignStateV1 source,
            string expeditionId)
        {
            WorkshopTransactionResult result = RollWorkshopService.BeginExpedition(
                source,
                expeditionId,
                "seed-a",
                "industrial-factory-v2",
                "dungeon-plan-v2",
                "plan-a",
                "ruin-a",
                "factory-contracts-v1");
            Assert.That(result.Success, Is.True);
            return result.State;
        }
    }
}
