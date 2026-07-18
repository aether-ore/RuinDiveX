using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using NUnit.Framework;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Core.Foundation;
using RuinCrawler.Runtime.Dungeon;
using RuinCrawler.Runtime.Persistence;
using UnityEngine;
using UnityEngine.TestTools;

namespace RuinCrawler.Runtime.Expedition.Tests
{
    public sealed class DungeonV2CheckpointFallbackPlayModeTests
    {
        private GameObject sessionRoot;
        private GameObject expeditionRoot;
        private GameObject player;
        private TextAsset contractPack;

        [UnityTearDown]
        public IEnumerator TearDown()
        {
            if (expeditionRoot != null) Object.Destroy(expeditionRoot);
            if (player != null) Object.Destroy(player);
            if (sessionRoot != null) Object.Destroy(sessionRoot);
            if (contractPack != null) Object.Destroy(contractPack);
            yield return null;
        }

        [UnityTest]
        public IEnumerator InvalidCheckpointWarnsAndVisiblyFallsBackToEntranceWithoutDiscardingRun()
        {
            if (CampaignSession.Instance != null)
            {
                Object.DestroyImmediate(CampaignSession.Instance.gameObject);
            }

            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate(
                "invalid-checkpoint-visible-fallback");
            CampaignStateV1 campaign = BeginCampaign(plan);
            const string InvalidCheckpointId = "missing-safe-anchor-after-content-update";
            campaign.expedition.dungeonProgress.checkpointId = InvalidCheckpointId;

            CampaignSession session = CreateMemoryBackedSession();
            CampaignCommitResult<CampaignStateV1> committed = session.Commit(
                "test-install-invalid-v2-checkpoint",
                campaign);
            Assert.That(committed.Success, Is.True, committed.Message);

            player = new GameObject("InvalidCheckpointFallbackPlayer");
            player.transform.position = new Vector3(1000f, 1000f, 1000f);
            expeditionRoot = new GameObject("InvalidCheckpointFallbackExpedition");
            expeditionRoot.SetActive(false);
            DungeonSceneBuilderV2 builder = expeditionRoot.AddComponent<DungeonSceneBuilderV2>();
            ExpeditionRuntimeController expedition =
                expeditionRoot.AddComponent<ExpeditionRuntimeController>();
            contractPack = LoadContractPack();
            expedition.Configure(contractPack, null, player.transform, generateAtStart: false);
            expeditionRoot.SetActive(true);
            builder.ConfigureLocalNavigation(createNavigation: true, bakeImmediately: false);
            Assert.That(builder.TryBuild(plan, null, null, out string buildError),
                Is.True, buildError);

            DungeonAnchorRuntimeV2 expectedEntrance = builder.GeneratedRoot
                .GetComponentsInChildren<DungeonAnchorRuntimeV2>(true)
                .First(value => value.RegionId == plan.EntranceRegionId
                    && (value.Kind == DungeonAnchorKindV2.Spawn
                        || value.Kind == DungeonAnchorKindV2.Entry));
            LogAssert.Expect(LogType.Warning, new Regex(
                "Saved checkpoint '" + InvalidCheckpointId
                    + "'.*using the entrance without discarding the expedition",
                RegexOptions.Singleline));

            Assert.That(expedition.PositionPlayerAtV2Start(), Is.True);
            Assert.That(expedition.LastV2CheckpointUsedEntranceFallback, Is.True);
            Assert.That(expedition.LastV2CheckpointFallbackMessage,
                Does.Contain(InvalidCheckpointId).And.Contain("using the entrance"));
            Assert.That(expedition.LastV2SpawnAnchorId, Is.EqualTo(expectedEntrance.StableId));
            Assert.That(Vector3.Distance(
                    player.transform.position,
                    expectedEntrance.transform.position + Vector3.up * 0.05f),
                Is.LessThan(0.0001f));
            Assert.That(session.Snapshot.expedition.dungeonProgress.checkpointId,
                Is.EqualTo(InvalidCheckpointId),
                "Entrance fallback must remain visible without silently discarding durable run progress.");
            yield return null;
        }

        [UnityTest]
        public IEnumerator ElectricalGroundingPersistsOnlyAfterGroundedCommitAndRestoresOnReentry()
        {
            if (CampaignSession.Instance != null)
            {
                Object.DestroyImmediate(CampaignSession.Instance.gameObject);
            }

            DungeonPlanV2 plan = GeneratePlan(DungeonBiomeDistrictKindV2.ElectricalUndercroft);
            CampaignStateV1 campaign = BeginCampaign(plan);
            CampaignSession session = CreateMemoryBackedSession();
            CampaignCommitResult<CampaignStateV1> committed = session.Commit(
                "test-install-electrical-grounding-expedition",
                campaign);
            Assert.That(committed.Success, Is.True, committed.Message);

            player = new GameObject("ElectricalGroundingPersistencePlayer");
            player.transform.position = new Vector3(1000f, 1000f, 1000f);
            expeditionRoot = new GameObject("ElectricalGroundingPersistenceExpedition");
            expeditionRoot.SetActive(false);
            DungeonSceneBuilderV2 builder = expeditionRoot.AddComponent<DungeonSceneBuilderV2>();
            ExpeditionRuntimeController expedition =
                expeditionRoot.AddComponent<ExpeditionRuntimeController>();
            contractPack = LoadContractPack();
            expedition.Configure(contractPack, null, player.transform, generateAtStart: false);
            expeditionRoot.SetActive(true);

            Assert.That(expedition.TryBuildAndPopulate(out string firstError), Is.True, firstError);
            DungeonSceneInstanceV2 firstInstance = builder.CurrentInstance;
            firstInstance.Minimap.VisitRegion(plan.EntranceRegionId);
            string hazardFactPrefix = "controller:"
                + IndustrialFactoryV2Ruleset.HazardControllerId + "=";
            Assert.That(session.Snapshot.expedition.dungeonProgress.permanentFactIds
                    .Any(value => value.StartsWith(hazardFactPrefix)),
                Is.False,
                "The ordinary Cycling state is temporal and must not enter durable progress.");

            DungeonEnvironmentConsoleRuntimeV2 console = builder.GeneratedRoot
                .GetComponentsInChildren<DungeonEnvironmentConsoleRuntimeV2>(true)
                .Single(value => value.ControllerId == IndustrialFactoryV2Ruleset.HazardControllerId);
            Assert.That(console.TryActivateNextTransition(), Is.True);
            Assert.That(session.Snapshot.expedition.dungeonProgress.permanentFactIds,
                Does.Contain(hazardFactPrefix + "Grounded"));

            expedition.TearDown();
            yield return null;
            Assert.That(expedition.TryBuildAndPopulate(out string reentryError), Is.True, reentryError);
            Assert.That(builder.CurrentInstance.Environment.GetControllerState(
                    IndustrialFactoryV2Ruleset.HazardControllerId),
                Is.EqualTo("Grounded"),
                "A committed grounding operation must restore after deterministic re-entry.");
        }

        [UnityTest]
        public IEnumerator ActivatedShortcutSurvivesRestoredMinimapSaveAndSecondReentry()
        {
            if (CampaignSession.Instance != null)
            {
                Object.DestroyImmediate(CampaignSession.Instance.gameObject);
            }

            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate(
                "restored-shortcut-minimap-persistence");
            CampaignStateV1 campaign = BeginCampaign(plan);
            DungeonDiscoveryPlanV2 shortcutDiscovery = plan.Discoveries.Single(value =>
                value.Kind == DungeonDiscoveryKindV2.Shortcut
                && value.DurableRewardId == IndustrialFactoryV2Ruleset.WaterworksShortcutId);
            Assert.That(DungeonDiscoveryCommandMapperV2.TryMap(
                    plan,
                    shortcutDiscovery,
                    campaign,
                    out DungeonDiscoveryCommandV2 shortcutCommand,
                    out string mappingFailure,
                    out string mappingMessage),
                Is.True,
                mappingFailure + ": " + mappingMessage);
            DungeonRewardTransactionResult durableDiscovery =
                DungeonRewardTransactionService.ClaimDiscovery(
                    campaign,
                    shortcutCommand.RewardRequest);
            Assert.That(durableDiscovery.Success, Is.True, durableDiscovery.Message);
            DungeonRewardTransactionResult expeditionActivation =
                DungeonRewardTransactionService.ClaimDiscovery(
                    durableDiscovery.State,
                    shortcutCommand.CurrentExpeditionActivationRequest);
            Assert.That(expeditionActivation.Success, Is.True, expeditionActivation.Message);
            campaign = expeditionActivation.State;
            CampaignSession session = CreateMemoryBackedSession();
            CampaignCommitResult<CampaignStateV1> committed = session.Commit(
                "test-install-restored-shortcut",
                campaign);
            Assert.That(committed.Success, Is.True, committed.Message);

            player = new GameObject("RestoredShortcutPersistencePlayer");
            expeditionRoot = new GameObject("RestoredShortcutPersistenceExpedition");
            expeditionRoot.SetActive(false);
            DungeonSceneBuilderV2 builder = expeditionRoot.AddComponent<DungeonSceneBuilderV2>();
            ExpeditionRuntimeController expedition =
                expeditionRoot.AddComponent<ExpeditionRuntimeController>();
            contractPack = LoadContractPack();
            expedition.Configure(contractPack, null, player.transform, generateAtStart: false);
            expeditionRoot.SetActive(true);

            Assert.That(expedition.TryBuildAndPopulate(out string firstError), Is.True, firstError);
            Assert.That(builder.CurrentInstance.Environment.CaptureSnapshot().ActiveShortcutIds,
                Does.Contain(IndustrialFactoryV2Ruleset.WaterworksShortcutId));
            Assert.That(builder.CurrentInstance.Minimap.CaptureKnowledge().KnownShortcutIds,
                Does.Contain(IndustrialFactoryV2Ruleset.WaterworksShortcutId),
                "Restored traversal state and restored map knowledge must agree before the first save event.");

            builder.CurrentInstance.Minimap.VisitRegion(plan.EntranceRegionId);
            Assert.That(session.Snapshot.expedition.dungeonProgress.activatedShortcutIds,
                Does.Contain(IndustrialFactoryV2Ruleset.WaterworksShortcutId),
                "A map-knowledge commit must not erase a restored active shortcut.");

            expedition.TearDown();
            yield return null;
            Assert.That(expedition.TryBuildAndPopulate(out string secondError), Is.True, secondError);
            Assert.That(builder.CurrentInstance.Minimap.CaptureKnowledge().KnownShortcutIds,
                Does.Contain(IndustrialFactoryV2Ruleset.WaterworksShortcutId));
        }

        [UnityTest]
        public IEnumerator ProvisionalKnownRuinAliasIsRejectedWithoutCompatibilityRewriting()
        {
            if (CampaignSession.Instance != null)
            {
                Object.DestroyImmediate(CampaignSession.Instance.gameObject);
            }

            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate(
                "provisional-known-ruin-alias-merge");
            CampaignStateV1 campaign = BeginCampaign(plan);
            string expeditionId = campaign.expedition.expeditionId;
            string canonicalRuinId = "ruin:" + plan.DeterministicSignature;
            string provisionalRuinId = "ruin-" + expeditionId;
            string discoveryId = plan.Discoveries.First(value =>
                value.DuplicatePolicy == DungeonDiscoveryDuplicatePolicyV2.OncePerRuin).Id;
            string validLoreFact = "lore:" + plan.Discoveries.First(value =>
                value.Kind == DungeonDiscoveryKindV2.Lore).DurableRewardId;
            string provisionalExpeditionClaim =
                DungeonRewardTransactionService.CreateExpeditionClaimKey(
                    expeditionId,
                    provisionalRuinId,
                    discoveryId);
            campaign.knownRuins.Clear();
            campaign.knownRuins.Add(new KnownRuinV1
            {
                ruinId = canonicalRuinId,
                dungeonPlanId = plan.DeterministicSignature,
                dungeonProfileId = plan.ProfileId,
                dungeonRulesetVersion = plan.RulesetVersion,
                dungeonContentPackVersion = plan.ContentPackVersion,
                runSeed = plan.Seed,
                mapKnowledge = new DungeonMapKnowledgeV1
                {
                    seenRegionIds = new List<string> { plan.EntranceRegionId }
                }
            });
            campaign.knownRuins.Add(new KnownRuinV1
            {
                ruinId = provisionalRuinId,
                dungeonPlanId = expeditionId,
                dungeonProfileId = plan.ProfileId,
                dungeonRulesetVersion = "dungeon-plan-v2",
                dungeonContentPackVersion = null,
                runSeed = plan.Seed,
                permanentFactIds = new List<string> { validLoreFact },
                activatedShortcutIds = new List<string> { plan.Shortcuts[0].Id },
                claimedRewardIds = new List<string>
                {
                    DungeonRewardTransactionService.CreateClaimKey(provisionalRuinId, discoveryId),
                    "drc1:2147483647:x"
                },
                mapKnowledge = new DungeonMapKnowledgeV1
                {
                    seenRegionIds = new List<string> { plan.Regions[1].Id },
                    visitedRegionIds = new List<string> { plan.Regions[1].Id },
                    knownMechanismIds = new List<string> { plan.EnvironmentControllers[0].Id }
                }
            });
            campaign.expedition.dungeonRulesetVersion = "dungeon-plan-v2";
            campaign.expedition.dungeonContentPackVersion = null;
            campaign.expedition.dungeonPlanId = expeditionId;
            campaign.expedition.ruinId = provisionalRuinId;
            campaign.expedition.dungeonProgress.claimedRewardIds.Add(provisionalExpeditionClaim);
            campaign.expeditionResolutionHistory.Add(new ExpeditionResolutionHistoryV1
            {
                resolutionId = "provisional-resolution-history",
                expeditionId = expeditionId,
                ruinId = provisionalRuinId,
                discoveryId = discoveryId,
                claimKey = provisionalExpeditionClaim,
                dungeonPlanId = expeditionId,
                dungeonProfileId = plan.ProfileId,
                dungeonRulesetVersion = "dungeon-plan-v2",
                runSeed = plan.Seed,
                outcomeId = "provisional-outcome",
                claimedRewardIds = new List<string> { provisionalExpeditionClaim },
                resolvedAtUtc = "2026-07-18T00:00:00Z"
            });

            Assert.That(
                ExpeditionRuntimeController.TryValidateV2ResumeIdentity(campaign, plan, out string error),
                Is.False);
            Assert.That(error, Does.Contain("does not exactly match").Or.Contain("does not match"));
            yield return null;
        }

        [UnityTest]
        public IEnumerator SoleProvisionalKnownRuinIsRejectedWithoutClaimRewriting()
        {
            if (CampaignSession.Instance != null)
            {
                Object.DestroyImmediate(CampaignSession.Instance.gameObject);
            }

            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate(
                "sole-provisional-known-ruin-claim-rewrite");
            CampaignStateV1 campaign = BeginCampaign(plan);
            string expeditionId = campaign.expedition.expeditionId;
            string provisionalRuinId = "ruin-" + expeditionId;
            string canonicalRuinId = "ruin:" + plan.DeterministicSignature;
            DungeonDiscoveryPlanV2 discovery = plan.Discoveries.First(value =>
                value.DuplicatePolicy == DungeonDiscoveryDuplicatePolicyV2.OncePerRuin);
            string provisionalClaim = DungeonRewardTransactionService.CreateClaimKey(
                provisionalRuinId,
                discovery.Id);
            campaign.knownRuins.Clear();
            campaign.knownRuins.Add(new KnownRuinV1
            {
                ruinId = provisionalRuinId,
                dungeonPlanId = expeditionId,
                dungeonProfileId = plan.ProfileId,
                dungeonRulesetVersion = "dungeon-plan-v2",
                dungeonContentPackVersion = null,
                runSeed = plan.Seed,
                claimedRewardIds = new List<string> { provisionalClaim },
                activatedShortcutIds = new List<string> { plan.Shortcuts[0].Id },
                mapKnowledge = new DungeonMapKnowledgeV1
                {
                    exploredRegionIds = new List<string> { plan.Regions[1].Id },
                    knownMechanismIds = new List<string> { plan.EnvironmentControllers[0].Id }
                }
            });
            campaign.expedition.dungeonRulesetVersion = "dungeon-plan-v2";
            campaign.expedition.dungeonContentPackVersion = null;
            campaign.expedition.dungeonPlanId = expeditionId;
            campaign.expedition.ruinId = provisionalRuinId;

            Assert.That(
                ExpeditionRuntimeController.TryValidateV2ResumeIdentity(campaign, plan, out string error),
                Is.False);
            Assert.That(error, Does.Contain("does not exactly match").Or.Contain("does not match"));
            yield return null;
        }

        [UnityTest]
        public IEnumerator KnownRuinMapKnowledgeSeedsFreshExpeditionWithoutMechanisms()
        {
            if (CampaignSession.Instance != null)
            {
                Object.DestroyImmediate(CampaignSession.Instance.gameObject);
            }

            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate(
                "known-ruin-map-knowledge-return");
            CampaignStateV1 campaign = BeginCampaign(plan);
            var known = new KnownRuinV1
            {
                ruinId = campaign.expedition.ruinId,
                dungeonPlanId = plan.DeterministicSignature,
                dungeonProfileId = plan.ProfileId,
                dungeonRulesetVersion = plan.RulesetVersion,
                dungeonContentPackVersion = plan.ContentPackVersion,
                runSeed = plan.Seed
            };
            campaign.knownRuins.Add(known);
            DungeonRegionPlanV2 retainedRegion = plan.Regions.First(value =>
                value.Id != plan.EntranceRegionId);
            DungeonRegionPlanV2 exploredOnlyRegion = plan.Regions.First(value =>
                value.Id != plan.EntranceRegionId && value.Id != retainedRegion.Id);
            string retainedLandmark = plan.Anchors.First(value =>
                value.Kind == DungeonAnchorKindV2.Landmark).Id;
            DungeonDiscoveryPlanV2 shortcutDiscovery = plan.Discoveries.Single(value =>
                value.Kind == DungeonDiscoveryKindV2.Shortcut);
            known.mapKnowledge.seenRegionIds.Add(retainedRegion.Id);
            known.mapKnowledge.visitedRegionIds.Add(retainedRegion.Id);
            known.mapKnowledge.exploredRegionIds.Add(exploredOnlyRegion.Id);
            known.mapKnowledge.knownLandmarkIds.Add(retainedLandmark);
            known.mapKnowledge.knownMechanismIds.Add(plan.EnvironmentControllers[0].Id);
            known.claimedRewardIds.Add(DungeonRewardTransactionService.CreateClaimKey(
                known.ruinId,
                shortcutDiscovery.Id));

            CampaignSession session = CreateMemoryBackedSession();
            CampaignCommitResult<CampaignStateV1> committed = session.Commit(
                "test-install-known-ruin-map-knowledge",
                campaign);
            Assert.That(committed.Success, Is.True, committed.Message);

            player = new GameObject("KnownRuinKnowledgePlayer");
            expeditionRoot = new GameObject("KnownRuinKnowledgeExpedition");
            expeditionRoot.SetActive(false);
            expeditionRoot.AddComponent<DungeonSceneBuilderV2>();
            ExpeditionRuntimeController expedition =
                expeditionRoot.AddComponent<ExpeditionRuntimeController>();
            contractPack = LoadContractPack();
            expedition.Configure(contractPack, null, player.transform, generateAtStart: false);
            expeditionRoot.SetActive(true);

            Assert.That(expedition.TryBuildAndPopulate(out string error), Is.True, error);
            DungeonMapKnowledgeStateV2 restored = expeditionRoot
                .GetComponent<DungeonSceneBuilderV2>()
                .CurrentInstance.Minimap.CaptureKnowledge();
            Assert.That(restored.Regions.Single(value => value.RegionId == retainedRegion.Id).Level,
                Is.GreaterThanOrEqualTo(DungeonMapKnowledgeLevelV2.Visited));
            Assert.That(restored.Regions.Single(value => value.RegionId == exploredOnlyRegion.Id).Level,
                Is.EqualTo(DungeonMapKnowledgeLevelV2.Explored),
                "Explored retained knowledge must be promoted through visited and seen before restore enumeration.");
            Assert.That(restored.DiscoveredLandmarkIds, Does.Contain(retainedLandmark));
            Assert.That(restored.KnownControllerIds, Is.Empty,
                "Mechanism knowledge resets on a later expedition even when map landmarks are retained.");
            Assert.That(restored.KnownShortcutIds, Does.Contain(shortcutDiscovery.DurableRewardId),
                "A durable shortcut discovery remains marked on the map on a later visit.");
            Assert.That(expeditionRoot.GetComponent<DungeonSceneBuilderV2>()
                    .CurrentInstance.Environment.CaptureSnapshot().ActiveShortcutIds,
                Does.Not.Contain(shortcutDiscovery.DurableRewardId),
                "Known shortcut discovery must not reactivate the current expedition route.");
            yield return null;
        }

        [UnityTest]
        public IEnumerator IncompatibleIdentityCreatesNoGeneratedSceneOrNavigation()
        {
            if (CampaignSession.Instance != null)
            {
                Object.DestroyImmediate(CampaignSession.Instance.gameObject);
            }

            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate(
                "post-build-identity-failure-cleanup");
            CampaignStateV1 campaign = BeginCampaign(plan);
            campaign.expedition.dungeonContentPackVersion = "stale-content-pack-for-cleanup-test";
            CampaignSession session = CreateMemoryBackedSession();
            CampaignCommitResult<CampaignStateV1> committed = session.Commit(
                "test-install-stale-v2-identity",
                campaign);
            Assert.That(committed.Success, Is.True, committed.Message);

            player = new GameObject("PostBuildFailureCleanupPlayer");
            expeditionRoot = new GameObject("PostBuildFailureCleanupExpedition");
            expeditionRoot.SetActive(false);
            DungeonSceneBuilderV2 builder = expeditionRoot.AddComponent<DungeonSceneBuilderV2>();
            ExpeditionRuntimeController expedition =
                expeditionRoot.AddComponent<ExpeditionRuntimeController>();
            contractPack = LoadContractPack();
            expedition.Configure(contractPack, null, player.transform, generateAtStart: false);
            expeditionRoot.SetActive(true);

            Assert.That(expedition.TryBuildAndPopulate(out string error), Is.False);
            Assert.That(error, Does.Contain("does not match"));
            Assert.That(builder.CurrentInstance, Is.Null);
            Assert.That(builder.GeneratedRoot, Is.Null);
            DungeonLocalNavigationRuntimeV2[] generatedNavigation = expeditionRoot
                .GetComponentsInChildren<DungeonLocalNavigationRuntimeV2>(true);
            Assert.That(generatedNavigation, Is.Empty,
                "Durable identity drift is rejected before any scene or NavMesh hierarchy is created.");
            yield return null;
        }

        private CampaignSession CreateMemoryBackedSession()
        {
            sessionRoot = new GameObject("InvalidCheckpointFallbackSession");
            sessionRoot.SetActive(false);
            CampaignSession session = sessionRoot.AddComponent<CampaignSession>();
            session.ConfigureStoreForTests(new InMemoryCampaignStore());
            sessionRoot.SetActive(true);
            Assert.That(session.HasDurableState, Is.True);
            return session;
        }

        private static CampaignStateV1 BeginCampaign(DungeonPlanV2 plan)
        {
            WorkshopTransactionResult begun = RollWorkshopService.BeginExpedition(
                CampaignStateV1.CreateDefault("invalid-checkpoint-fallback"),
                "invalid-checkpoint-expedition",
                plan.Seed,
                plan.ProfileId,
                plan.RulesetVersion,
                plan.DeterministicSignature,
                "ruin:" + plan.DeterministicSignature,
                plan.ContentPackVersion);
            Assert.That(begun.Success, Is.True);
            return begun.State;
        }

        private static DungeonPlanV2 GeneratePlan(DungeonBiomeDistrictKindV2 hazardKind)
        {
            var generator = new IndustrialFactoryV2Generator();
            for (int index = 0; index < 64; index += 1)
            {
                DungeonPlanV2 plan = generator.Generate("expedition-runtime-hazard-" + index);
                if (plan.Districts.Any(value => value.Kind == hazardKind))
                {
                    return plan;
                }
            }

            Assert.Fail("Unable to locate deterministic expedition seed for " + hazardKind + ".");
            return null;
        }

        private static TextAsset LoadContractPack()
        {
            string path = Path.GetFullPath(Path.Combine(
                Application.dataPath,
                "../../../assets/contracts/ruin-crawler-contracts.v1.json"));
            Assert.That(File.Exists(path), Is.True, path);
            return new TextAsset(File.ReadAllText(path));
        }

        private sealed class InMemoryCampaignStore : ICampaignEnvelopeStore<CampaignStateV1>
        {
            private CampaignEnvelopeV1<CampaignStateV1> envelope;

            public CampaignLoadResult<CampaignStateV1> Load(string saveContextId)
            {
                return envelope == null
                    ? new CampaignLoadResult<CampaignStateV1>(CampaignLoadStatus.NotFound)
                    : new CampaignLoadResult<CampaignStateV1>(CampaignLoadStatus.Loaded, envelope);
            }

            public CampaignCommitResult<CampaignStateV1> Commit(
                CampaignCommitRequest<CampaignStateV1> request)
            {
                CampaignCommitResult<CampaignStateV1> result =
                    CampaignTransactions.PrepareCommit(envelope, request);
                if (result.Success)
                {
                    envelope = result.Envelope;
                }

                return result;
            }
        }
    }
}
