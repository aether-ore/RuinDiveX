using System.Collections;
using System.Linq;
using NUnit.Framework;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Runtime.Dungeon;
using RuinCrawler.Runtime.Player;
using UnityEngine;
using UnityEngine.TestTools;

namespace RuinCrawler.Runtime.Expedition.Tests
{
    public sealed class DungeonExpeditionProgressionPlayModeTests
    {
        private GameObject builderObject;
        private GameObject playerObject;
        private DungeonSceneBuilderV2 builder;

        [UnityTearDown]
        public IEnumerator TearDown()
        {
            if (builder != null) builder.TearDown();
            yield return null;
            if (builderObject != null) Object.DestroyImmediate(builderObject);
            if (playerObject != null) Object.DestroyImmediate(playerObject);
            builder = null;
        }

        [UnityTest]
        public IEnumerator SceneBindingBuildsTriggersAndPlayerEntryCommitsDiscoveryEffects()
        {
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate("progression-playmode");
            CampaignStateV1 campaign = CreateCampaign(plan);
            var port = new FakeCampaignPort(campaign);
            builderObject = new GameObject("ProgressionV2PlayMode");
            builder = builderObject.AddComponent<DungeonSceneBuilderV2>();
            Assert.That(builder.TryBuild(plan, null, null, out string buildError),
                Is.True, buildError);
            var runtime = builderObject.AddComponent<DungeonExpeditionProgressionRuntimeV2>();
            Assert.That(runtime.Configure(builder.CurrentInstance, port, out string bindError),
                Is.True, bindError);

            Assert.That(runtime.DiscoveryTriggers, Has.Count.EqualTo(
                plan.Discoveries.Count(value => value.Kind != DungeonDiscoveryKindV2.Shortcut)));
            Assert.That(runtime.ExtractionTrigger, Is.Not.Null);
            DungeonDiscoveryPlanV2 credential = plan.Discoveries.Single(value =>
                value.DurableRewardId == IndustrialFactoryV2Ruleset.CredentialKeyRewardId);
            DungeonDiscoveryTriggerRuntimeV2 trigger = runtime.DiscoveryTriggers.Single(value =>
                value.DiscoveryId == credential.Id);
            int processed = 0;
            runtime.DiscoveryProcessed += _ => processed += 1;

            playerObject = new GameObject("PlayerForDiscoveryTrigger");
            // Keep the synthetic player active so GetComponentInParent uses the
            // same contract as a real player. Place it outside generated bounds
            // to prevent physics from firing unrelated dungeon triggers.
            playerObject.transform.position = new Vector3(10000f, 10000f, 10000f);
            playerObject.AddComponent<ProductionPlayerController>();
            CharacterController playerCollider = playerObject.GetComponent<CharacterController>();
            trigger.gameObject.SendMessage(
                "OnTriggerEnter",
                playerCollider,
                SendMessageOptions.RequireReceiver);

            string activationDiagnostic = trigger.LastResult == null
                ? "The trigger never invoked TryActivate; verify that the synthetic player is visible to GetComponentInParent."
                : "Trigger activation failed with " + trigger.LastResult.FailureCode + ": "
                    + trigger.LastResult.Message;
            Assert.That(trigger.IsConsumed, Is.True, activationDiagnostic);
            Assert.That(trigger.GetComponent<Collider>().enabled, Is.False);
            Assert.That(processed, Is.EqualTo(1));
            Assert.That(port.CommitCount, Is.EqualTo(1));
            DungeonPredicateStateV2 predicateState =
                builder.CurrentInstance.Environment.CapturePredicateState();
            Assert.That(predicateState.RequiredItemIds,
                Does.Contain(IndustrialFactoryV2Ruleset.CredentialKeyRewardId));
            Assert.That(predicateState.DiscoveryFactIds, Does.Contain(credential.Id));
            Assert.That(port.Snapshot.expedition.dungeonProgress.mapKnowledge.visitedRegionIds,
                Does.Contain(plan.Anchors.Single(value => value.Id == credential.LocationAnchorId).RegionId));
            yield return null;
        }

        [UnityTest]
        public IEnumerator GuardianEnablesSeparateRefractorPickupThenExtractionEmitsOneRequest()
        {
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate("extraction-playmode");
            var port = new FakeCampaignPort(CreateCampaign(plan));
            builderObject = new GameObject("ExtractionV2PlayMode");
            builder = builderObject.AddComponent<DungeonSceneBuilderV2>();
            Assert.That(builder.TryBuild(plan, null, null, out string buildError),
                Is.True, buildError);
            var runtime = builderObject.AddComponent<DungeonExpeditionProgressionRuntimeV2>();
            Assert.That(runtime.Configure(builder.CurrentInstance, port, out string bindError),
                Is.True, bindError);
            int requests = 0;
            runtime.ExtractionRequested += _ => requests += 1;

            DungeonExtractionAttemptResultV2 blocked = runtime.ExtractionTrigger.TryActivate();
            Assert.That(runtime.LargeRefractorPickup, Is.Not.Null);
            Assert.That(runtime.LargeRefractorPickup.IsAvailable, Is.False);
            DungeonProgressionOperationResultV2 blockedPickup =
                runtime.LargeRefractorPickup.TryActivate();
            DungeonProgressionOperationResultV2 guardian =
                runtime.TryMarkFinalGuardianDefeated();
            Assert.That(runtime.LargeRefractorPickup.IsAvailable, Is.True);
            DungeonProgressionOperationResultV2 secured =
                runtime.LargeRefractorPickup.TryActivate();
            DungeonExtractionAttemptResultV2 sameFrame = runtime.ExtractionTrigger.TryActivate();
            yield return null;
            DungeonExtractionAttemptResultV2 extracted = runtime.ExtractionTrigger.TryActivate();
            DungeonExtractionAttemptResultV2 replay = runtime.ExtractionTrigger.TryActivate();

            Assert.That(blocked.Success, Is.False);
            Assert.That(blockedPickup.Success, Is.False);
            Assert.That(blockedPickup.FailureCode, Is.EqualTo("final-guardian-required"));
            Assert.That(guardian.Success, Is.True);
            Assert.That(runtime.ExtractionTrigger.IsConsumed, Is.True);
            Assert.That(secured.Success, Is.True);
            Assert.That(runtime.LargeRefractorPickup.IsConsumed, Is.True);
            Assert.That(runtime.LargeRefractorPickup.IsAvailable, Is.False);
            Assert.That(sameFrame.Success, Is.False);
            Assert.That(sameFrame.FailureCode, Is.EqualTo("extraction-interaction-required"));
            Assert.That(extracted.Success, Is.True);
            Assert.That(replay.IdempotentReplay, Is.True);
            Assert.That(requests, Is.EqualTo(1));
            Assert.That(port.CommitCount, Is.EqualTo(2));
            Assert.That(port.Snapshot.expeditionResolutionHistory, Has.Count.EqualTo(1));
        }

        [UnityTest]
        public IEnumerator ShortcutActivationGrantOpensRuntimeRouteAndUsesExpeditionClaim()
        {
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate(
                "shortcut-activation-grant-playmode");
            var port = new FakeCampaignPort(CreateCampaign(plan));
            builderObject = new GameObject("ShortcutActivationGrantV2PlayMode");
            builder = builderObject.AddComponent<DungeonSceneBuilderV2>();
            Assert.That(builder.TryBuild(plan, null, null, out string buildError),
                Is.True, buildError);
            var runtime = builderObject.AddComponent<DungeonExpeditionProgressionRuntimeV2>();
            Assert.That(runtime.Configure(builder.CurrentInstance, port, out string bindError),
                Is.True, bindError);
            DungeonDiscoveryPlanV2 shortcut = plan.Discoveries.Single(value =>
                value.Kind == DungeonDiscoveryKindV2.Shortcut);

            Assert.That(builder.CurrentInstance.Environment.CapturePredicateState().ActiveShortcutIds,
                Does.Not.Contain(shortcut.DurableRewardId));
            DungeonProgressionOperationResultV2 result = runtime.TryDiscover(shortcut.Id);

            Assert.That(result.Success, Is.True, result.Message);
            Assert.That(result.Command.CurrentExpeditionActivationRequest, Is.Not.Null);
            Assert.That(builder.CurrentInstance.Environment.CapturePredicateState().ActiveShortcutIds,
                Does.Contain(shortcut.DurableRewardId),
                "The runtime must apply the successful activation request, not only the durable discovery grant.");
            string activationClaim = DungeonRewardTransactionService.CreateExpeditionClaimKey(
                port.Snapshot.expedition.expeditionId,
                port.Snapshot.expedition.ruinId,
                shortcut.Id + DungeonDiscoveryCommandMapperV2.ShortcutActivationClaimSuffix);
            Assert.That(port.Snapshot.expedition.dungeonProgress.claimedRewardIds,
                Does.Contain(activationClaim));
            yield return null;
        }

        [UnityTest]
        public IEnumerator PreviouslyDiscoveredShortcutStillRenewsActivationInFreshExpedition()
        {
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate(
                "shortcut-fresh-expedition-playmode");
            DungeonDiscoveryPlanV2 shortcut = plan.Discoveries.Single(value =>
                value.Kind == DungeonDiscoveryKindV2.Shortcut);
            var firstPort = new FakeCampaignPort(CreateCampaign(plan));
            var firstCoordinator = new DungeonExpeditionProgressionCoordinatorV2(plan, firstPort);
            Assert.That(firstCoordinator.TryDiscover(shortcut.Id).Success, Is.True);
            WorkshopTransactionResult returned = RollWorkshopService.ReturnToCamp(
                firstPort.Snapshot,
                firstPort.Snapshot.expedition.expeditionId);
            Assert.That(returned.Success, Is.True, returned.Message);
            WorkshopTransactionResult begun = RollWorkshopService.BeginExpedition(
                returned.State,
                "expedition-playmode-return",
                plan.Seed,
                plan.ProfileId,
                plan.RulesetVersion,
                plan.DeterministicSignature,
                "ruin:" + plan.DeterministicSignature,
                plan.ContentPackVersion);
            Assert.That(begun.Success, Is.True, begun.Message);
            var returnPort = new FakeCampaignPort(begun.State);

            builderObject = new GameObject("ShortcutFreshExpeditionV2PlayMode");
            builder = builderObject.AddComponent<DungeonSceneBuilderV2>();
            Assert.That(builder.TryBuild(plan, null, null, out string buildError),
                Is.True, buildError);
            var runtime = builderObject.AddComponent<DungeonExpeditionProgressionRuntimeV2>();
            Assert.That(runtime.Configure(builder.CurrentInstance, returnPort, out string bindError),
                Is.True, bindError);
            Assert.That(runtime.Coordinator.IsDiscoveryClaimed(shortcut.Id), Is.True,
                "The durable once-per-ruin discovery should already be claimed.");
            Assert.That(runtime.Coordinator.IsCurrentExpeditionShortcutActivationClaimed(shortcut.Id),
                Is.False);

            DungeonProgressionOperationResultV2 processed = null;
            runtime.DiscoveryProcessed += value => processed = value;
            Assert.That(builder.CurrentInstance.Environment.ActivateShortcut(
                shortcut.DurableRewardId), Is.True);

            Assert.That(processed, Is.Not.Null,
                "Scene activation must not be skipped merely because the durable discovery predates this expedition.");
            Assert.That(processed.Success, Is.True, processed?.Message);
            Assert.That(processed.Changed, Is.True);
            Assert.That(runtime.Coordinator.IsCurrentExpeditionShortcutActivationClaimed(shortcut.Id),
                Is.True);
            Assert.That(returnPort.Snapshot.expedition.dungeonProgress.activatedShortcutIds,
                Does.Contain(shortcut.DurableRewardId));
            Assert.That(returnPort.Snapshot.knownRuins.Single().activatedShortcutIds, Is.Empty);
            yield return null;
        }

        [UnityTest]
        public IEnumerator FailedShortcutTransactionRollsBackRuntimeAndDurableActivation()
        {
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate(
                "shortcut-failed-transaction-playmode");
            var port = new FakeCampaignPort(CreateCampaign(plan));
            builderObject = new GameObject("ShortcutFailedTransactionV2PlayMode");
            builder = builderObject.AddComponent<DungeonSceneBuilderV2>();
            Assert.That(builder.TryBuild(plan, null, null, out string buildError),
                Is.True, buildError);
            var runtime = builderObject.AddComponent<DungeonExpeditionProgressionRuntimeV2>();
            Assert.That(runtime.Configure(builder.CurrentInstance, port, out string bindError),
                Is.True, bindError);
            DungeonDiscoveryPlanV2 shortcut = plan.Discoveries.Single(value =>
                value.Kind == DungeonDiscoveryKindV2.Shortcut);
            DungeonProgressionOperationResultV2 processed = null;
            runtime.DiscoveryProcessed += value => processed = value;
            port.FailNextCommit = true;

            Assert.That(builder.CurrentInstance.Environment.ActivateShortcut(
                shortcut.DurableRewardId), Is.True,
                "The environment should report the initial speculative change.");

            Assert.That(processed, Is.Not.Null);
            Assert.That(processed.Success, Is.False);
            Assert.That(processed.FailureCode, Is.EqualTo("save-failed"));
            Assert.That(builder.CurrentInstance.Environment.CapturePredicateState().ActiveShortcutIds,
                Does.Not.Contain(shortcut.DurableRewardId),
                "A rejected campaign commit must close the speculative route again.");
            Assert.That(port.Snapshot.expedition.dungeonProgress.activatedShortcutIds,
                Does.Not.Contain(shortcut.DurableRewardId));
            Assert.That(port.Snapshot.expedition.dungeonProgress.claimedRewardIds, Is.Empty);
            Assert.That(port.Snapshot.knownRuins, Is.Empty);
            yield return null;
        }

        [UnityTest]
        public IEnumerator KeyShortcutRefractorAndReentryRestoreOnlyDurableExpeditionFacts()
        {
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate(
                "progression-reentry-playmode");
            var port = new FakeCampaignPort(CreateCampaign(plan));
            builderObject = new GameObject("ProgressionReentryV2PlayMode");
            builder = builderObject.AddComponent<DungeonSceneBuilderV2>();
            Assert.That(builder.TryBuild(plan, null, null, out string buildError),
                Is.True, buildError);
            var runtime = builderObject.AddComponent<DungeonExpeditionProgressionRuntimeV2>();
            Assert.That(runtime.Configure(builder.CurrentInstance, port, out string bindError),
                Is.True, bindError);

            DungeonDiscoveryPlanV2 credential = plan.Discoveries.Single(value =>
                value.DurableRewardId == IndustrialFactoryV2Ruleset.CredentialKeyRewardId);
            DungeonShortcutPlanV2 shortcut = plan.Shortcuts.Single(value =>
                value.Id == IndustrialFactoryV2Ruleset.WaterworksShortcutId);
            Assert.That(builder.CurrentInstance.Environment.CapturePredicateState().RequiredItemIds,
                Does.Not.Contain(IndustrialFactoryV2Ruleset.CredentialKeyRewardId));
            Assert.That(port.Snapshot.expedition.dungeonProgress.activatedShortcutIds,
                Does.Not.Contain(shortcut.Id));
            Assert.That(runtime.ExtractionState,
                Is.EqualTo(DungeonExtractionStateV2.RefractorRequired));
            Assert.That(runtime.LargeRefractorPickup.IsAvailable, Is.False);

            DungeonProgressionOperationResultV2 keyResult = runtime.TryDiscover(credential.Id);
            bool shortcutChanged = builder.CurrentInstance.Environment.ActivateShortcut(shortcut.Id);
            DungeonProgressionOperationResultV2 guardianResult =
                runtime.TryMarkFinalGuardianDefeated();
            Assert.That(runtime.LargeRefractorPickup.IsAvailable, Is.True);
            DungeonProgressionOperationResultV2 refractorResult =
                runtime.LargeRefractorPickup.TryActivate();

            Assert.That(keyResult.Success, Is.True);
            Assert.That(shortcutChanged, Is.True);
            Assert.That(guardianResult.Success, Is.True);
            Assert.That(refractorResult.Success, Is.True);
            Assert.That(port.Snapshot.expedition.dungeonProgress.requiredItemIds,
                Does.Contain(IndustrialFactoryV2Ruleset.CredentialKeyRewardId));
            Assert.That(port.Snapshot.expedition.dungeonProgress.activatedShortcutIds,
                Does.Contain(shortcut.Id));
            Assert.That(port.Snapshot.knownRuins.Single().activatedShortcutIds,
                Does.Not.Contain(shortcut.Id),
                "The shortcut is resumable in this expedition, not permanent across later visits.");
            Assert.That(port.Snapshot.expedition.dungeonProgress.refractorSecured, Is.True);
            Assert.That(port.Snapshot.expeditionResolutionHistory, Has.Count.EqualTo(1));
            Assert.That(runtime.ExtractionState, Is.EqualTo(DungeonExtractionStateV2.Ready));
            int commitsBeforeReentry = port.CommitCount;

            runtime.Unbind();
            Assert.That(runtime.Configure(builder.CurrentInstance, port, out string rebindError),
                Is.True, rebindError);
            DungeonPredicateStateV2 restored =
                builder.CurrentInstance.Environment.CapturePredicateState();

            Assert.That(restored.RequiredItemIds,
                Does.Contain(IndustrialFactoryV2Ruleset.CredentialKeyRewardId));
            Assert.That(restored.ActiveShortcutIds, Does.Contain(shortcut.Id));
            Assert.That(restored.ProgressionFactIds,
                Does.Contain(IndustrialFactoryV2Ruleset.FinalEliteDefeatedFactId));
            Assert.That(restored.ProgressionFactIds,
                Does.Contain(IndustrialFactoryV2Ruleset.ExtractionReadyFactId));
            Assert.That(runtime.ExtractionState, Is.EqualTo(DungeonExtractionStateV2.Ready));
            Assert.That(runtime.LargeRefractorPickup.IsConsumed, Is.True);
            Assert.That(runtime.LargeRefractorPickup.IsAvailable, Is.False);
            Assert.That(port.CommitCount, Is.EqualTo(commitsBeforeReentry));
            Assert.That(port.Snapshot.expeditionResolutionHistory, Has.Count.EqualTo(1));
            yield return null;
        }

        private static CampaignStateV1 CreateCampaign(DungeonPlanV2 plan)
        {
            WorkshopTransactionResult begun = RollWorkshopService.BeginExpedition(
                CampaignStateV1.CreateDefault("progression-playmode"),
                "expedition-playmode",
                plan.Seed,
                plan.ProfileId,
                plan.RulesetVersion,
                plan.DeterministicSignature,
                "ruin:" + plan.DeterministicSignature,
                plan.ContentPackVersion);
            Assert.That(begun.Success, Is.True);
            return begun.State;
        }

        private sealed class FakeCampaignPort : IDungeonCampaignProgressionPortV2
        {
            private CampaignStateV1 state;

            public FakeCampaignPort(CampaignStateV1 initial)
            {
                state = CampaignStateRepair.Repair(initial.Clone());
            }

            public int CommitCount { get; private set; }
            public bool FailNextCommit { get; set; }
            public CampaignStateV1 Snapshot => state.Clone();

            public DungeonCampaignCommitResultV2 Commit(string operation, CampaignStateV1 next)
            {
                if (FailNextCommit)
                {
                    FailNextCommit = false;
                    return DungeonCampaignCommitResultV2.Failed("injected failure");
                }

                CommitCount += 1;
                state = CampaignStateRepair.Repair(next.Clone());
                return DungeonCampaignCommitResultV2.Succeeded(state.Clone());
            }
        }
    }
}
