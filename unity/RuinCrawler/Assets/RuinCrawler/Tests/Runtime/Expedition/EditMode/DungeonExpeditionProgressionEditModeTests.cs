using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Core.Dungeon.V2;

namespace RuinCrawler.Runtime.Expedition.Tests
{
    public sealed class DungeonExpeditionProgressionEditModeTests
    {
        [Test]
        public void MapperCoversEveryV2DiscoveryKindWithTypedEffects()
        {
            DungeonPlanV2 plan = CreatePlan();
            CampaignStateV1 campaign = CreateCampaign(plan);
            DungeonAnchorPlanV2 anchor = plan.Anchors.First(value =>
                value.Kind == DungeonAnchorKindV2.Reward);
            string districtId = plan.Regions.First(value => value.Id == anchor.RegionId).BiomeDistrictId;

            AssertMapping(plan, campaign, anchor, districtId,
                DungeonDiscoveryKindV2.Salvage,
                "generic-salvage",
                DungeonDiscoveryEffectKindV2.IdentifiedScrap);
            AssertMapping(plan, campaign, anchor, districtId,
                DungeonDiscoveryKindV2.RefractorCache,
                "refractor-cache",
                DungeonDiscoveryEffectKindV2.IdentifiedScrap);
            AssertMapping(plan, campaign, anchor, districtId,
                DungeonDiscoveryKindV2.ZennyCache,
                "zenny-cache",
                DungeonDiscoveryEffectKindV2.IdentifiedScrap);
            AssertMapping(plan, campaign, anchor, districtId,
                DungeonDiscoveryKindV2.FixedChipBlueprint,
                "chip-recipe",
                DungeonDiscoveryEffectKindV2.RecipeBlueprint);
            AssertMapping(plan, campaign, anchor, districtId,
                DungeonDiscoveryKindV2.Lore,
                "archive-entry",
                DungeonDiscoveryEffectKindV2.LoreFact);
            AssertMapping(plan, campaign, anchor, districtId,
                DungeonDiscoveryKindV2.Shortcut,
                "shortcut-a",
                DungeonDiscoveryEffectKindV2.Shortcut);
            AssertMapping(plan, campaign, anchor, districtId,
                DungeonDiscoveryKindV2.Landmark,
                null,
                DungeonDiscoveryEffectKindV2.Landmark);
            DungeonDiscoveryCommandV2 mechanism = AssertMapping(
                plan,
                campaign,
                anchor,
                districtId,
                DungeonDiscoveryKindV2.MechanismKnowledge,
                "credential-a",
                DungeonDiscoveryEffectKindV2.MechanismCredential);

            Assert.That(mechanism.RewardRequest.Grant.RequiredItemIds,
                Is.EqualTo(new[] { "credential-a" }));
            Assert.That(mechanism.RewardRequest.Grant.KnownMechanismIds,
                Is.Empty,
                "A credential pickup is not a map mechanism merely because MechanismKnowledge grants its key.");
            Assert.That(mechanism.RewardRequest.Grant.VisitedRegionIds,
                Is.EqualTo(new[] { anchor.RegionId }));
            Assert.That(mechanism.RewardRequest.Grant.ExploredRegionIds, Is.Empty,
                "Explored is earned by the minimap's connector/landmark survey rules, not by any pickup alone.");

            DungeonAnchorPlanV2 console = plan.Anchors.First(value =>
                value.Kind == DungeonAnchorKindV2.Console
                && plan.EnvironmentControllers.Any(controller => controller.Id == value.ProfileId));
            string consoleDistrictId = plan.Regions.First(value => value.Id == console.RegionId).BiomeDistrictId;
            DungeonDiscoveryCommandV2 consoleMechanism = AssertMapping(
                plan,
                campaign,
                console,
                consoleDistrictId,
                DungeonDiscoveryKindV2.MechanismKnowledge,
                "console-credential",
                DungeonDiscoveryEffectKindV2.MechanismCredential);
            Assert.That(consoleMechanism.RewardRequest.Grant.KnownMechanismIds,
                Is.EqualTo(new[] { console.ProfileId }),
                "Known mechanisms use the controller's stable ID, never the scene anchor ID.");
            DungeonDiscoveryCommandV2 shortcut = AssertMapping(
                plan,
                campaign,
                anchor,
                districtId,
                DungeonDiscoveryKindV2.Shortcut,
                "shortcut-current-expedition",
                DungeonDiscoveryEffectKindV2.Shortcut);
            Assert.That(shortcut.RewardRequest.Scope,
                Is.EqualTo(DungeonRewardClaimScopeV1.OncePerRuin));
            Assert.That(shortcut.RewardRequest.Grant.CurrentExpeditionShortcutIds,
                Is.Empty);
            Assert.That(shortcut.CurrentExpeditionActivationRequest, Is.Not.Null);
            Assert.That(shortcut.CurrentExpeditionActivationRequest.Scope,
                Is.EqualTo(DungeonRewardClaimScopeV1.OncePerExpedition));
            Assert.That(shortcut.CurrentExpeditionActivationRequest.DiscoveryId,
                Is.EqualTo("mapping-Shortcut" + DungeonDiscoveryCommandMapperV2.ShortcutActivationClaimSuffix));
            Assert.That(shortcut.CurrentExpeditionActivationRequest.Grant.CurrentExpeditionShortcutIds,
                Is.EqualTo(new[] { "shortcut-current-expedition" }));
        }

        [Test]
        public void DiscoveryClaim_CommitsOnceAndFieldRecoveryCannotDuplicate()
        {
            DungeonPlanV2 plan = CreatePlan();
            var port = new FakeCampaignPort(CreateCampaign(plan));
            var coordinator = new DungeonExpeditionProgressionCoordinatorV2(plan, port);
            DungeonDiscoveryPlanV2 credential = plan.Discoveries.Single(value =>
                value.DurableRewardId == IndustrialFactoryV2Ruleset.CredentialKeyRewardId);
            DungeonDiscoveryPlanV2 coolingRecovery = plan.Discoveries.Single(value =>
                value.DurableRewardId == IndustrialFactoryV2Ruleset.CoolingFinArrayRewardId);

            DungeonProgressionOperationResultV2 firstCredential =
                coordinator.TryDiscover(credential.Id);
            DungeonProgressionOperationResultV2 replayCredential =
                coordinator.TryDiscover(credential.Id);
            DungeonProgressionOperationResultV2 firstRecovery =
                coordinator.TryDiscover(coolingRecovery.Id);
            DungeonProgressionOperationResultV2 replayRecovery =
                coordinator.TryDiscover(coolingRecovery.Id);

            Assert.That(firstCredential.Success, Is.True);
            Assert.That(firstCredential.Changed, Is.True);
            Assert.That(replayCredential.Success, Is.True);
            Assert.That(replayCredential.IdempotentReplay, Is.True);
            Assert.That(firstRecovery.Success, Is.True);
            Assert.That(replayRecovery.IdempotentReplay, Is.True);
            Assert.That(port.CommitCount, Is.EqualTo(2));
            Assert.That(port.Snapshot.expedition.dungeonProgress.requiredItemIds,
                Does.Contain(IndustrialFactoryV2Ruleset.CredentialKeyRewardId));
            Assert.That(port.Snapshot.expedition.dungeonProgress.mapKnowledge.knownMechanismIds,
                Is.Empty,
                "Collecting the credential key must not persist its reward anchor as a controller ID.");
            Assert.That(port.Snapshot.unidentifiedRecoveries, Has.Count.EqualTo(1));
            Assert.That(port.Snapshot.unidentifiedRecoveries[0].recoverableParts[0].materialId,
                Is.EqualTo(IndustrialFactoryV2Ruleset.CoolingFinArrayRewardId));
            Assert.That(port.Snapshot.expedition.dungeonProgress.mapKnowledge.visitedRegionIds,
                Does.Contain(plan.Anchors.Single(value => value.Id == coolingRecovery.LocationAnchorId).RegionId));
        }

        [Test]
        public void ShortcutDiscoveryIsOncePerRuinButActivationRenewsPerExpedition()
        {
            DungeonPlanV2 plan = CreatePlan();
            DungeonDiscoveryPlanV2 shortcut = plan.Discoveries.Single(value =>
                value.Kind == DungeonDiscoveryKindV2.Shortcut);
            var firstPort = new FakeCampaignPort(CreateCampaign(plan));
            var firstCoordinator = new DungeonExpeditionProgressionCoordinatorV2(plan, firstPort);

            DungeonProgressionOperationResultV2 first = firstCoordinator.TryDiscover(shortcut.Id);
            Assert.That(first.Success, Is.True);
            Assert.That(firstPort.Snapshot.expedition.dungeonProgress.activatedShortcutIds,
                Does.Contain(shortcut.DurableRewardId));
            Assert.That(firstPort.Snapshot.knownRuins.Single().claimedRewardIds,
                Does.Contain(DungeonRewardTransactionService.CreateClaimKey(
                    firstPort.Snapshot.expedition.ruinId,
                    shortcut.Id)));
            Assert.That(firstCoordinator.IsCurrentExpeditionShortcutActivationClaimed(shortcut.Id),
                Is.True);

            CampaignStateV1 firstSnapshot = firstPort.Snapshot;
            WorkshopTransactionResult returnedToCamp = RollWorkshopService.ReturnToCamp(
                firstSnapshot,
                firstSnapshot.expedition.expeditionId);
            Assert.That(returnedToCamp.Success, Is.True, returnedToCamp.Message);
            WorkshopTransactionResult begun = RollWorkshopService.BeginExpedition(
                returnedToCamp.State,
                "expedition-v2-return",
                plan.Seed,
                plan.ProfileId,
                plan.RulesetVersion,
                plan.DeterministicSignature,
                "ruin:" + plan.DeterministicSignature,
                plan.ContentPackVersion);
            Assert.That(begun.Success, Is.True, begun.Message);
            var returnPort = new FakeCampaignPort(begun.State);
            var returnCoordinator = new DungeonExpeditionProgressionCoordinatorV2(plan, returnPort);

            DungeonProgressionOperationResultV2 returned = returnCoordinator.TryDiscover(shortcut.Id);
            Assert.That(returned.Success, Is.True);
            Assert.That(returned.Changed, Is.True,
                "The durable discovery replays, but the new expedition activation must commit.");
            Assert.That(returned.IdempotentReplay, Is.False);
            Assert.That(returnCoordinator.IsCurrentExpeditionShortcutActivationClaimed(shortcut.Id),
                Is.True);
            Assert.That(returnPort.Snapshot.expedition.dungeonProgress.activatedShortcutIds,
                Does.Contain(shortcut.DurableRewardId));
            Assert.That(returnPort.Snapshot.knownRuins.Single().claimedRewardIds.Count(value =>
                DungeonRewardTransactionService.TryParseClaimKey(
                    value,
                    out _,
                    out string discoveryId,
                    out string expeditionId)
                && expeditionId == null
                && discoveryId == shortcut.Id), Is.EqualTo(1));
        }

        [Test]
        public void ControllerPersistenceAcceptsOnlyCurrentExpeditionActivationClaims()
        {
            DungeonPlanV2 plan = CreatePlan();
            DungeonDiscoveryPlanV2 shortcut = plan.Discoveries.Single(value =>
                value.Kind == DungeonDiscoveryKindV2.Shortcut);
            CampaignStateV1 campaign = CreateCampaign(plan);

            IReadOnlyList<string> rawOnly =
                ExpeditionRuntimeController.SelectTransactionBackedActiveShortcutIds(
                    campaign,
                    plan,
                    new[] { shortcut.DurableRewardId });
            Assert.That(rawOnly, Is.Empty,
                "A scene-side route change is not a durable activation claim.");

            campaign.expedition.dungeonProgress.claimedRewardIds.Add(
                DungeonRewardTransactionService.CreateExpeditionClaimKey(
                    "foreign-expedition",
                    campaign.expedition.ruinId,
                    shortcut.Id + DungeonDiscoveryCommandMapperV2.ShortcutActivationClaimSuffix));
            IReadOnlyList<string> foreign =
                ExpeditionRuntimeController.SelectTransactionBackedActiveShortcutIds(
                    campaign,
                    plan,
                    new[] { shortcut.DurableRewardId });
            Assert.That(foreign, Is.Empty,
                "An activation claim from another expedition cannot reopen this route.");

            campaign.expedition.dungeonProgress.claimedRewardIds.Add(
                DungeonRewardTransactionService.CreateExpeditionClaimKey(
                    campaign.expedition.expeditionId,
                    campaign.expedition.ruinId,
                    shortcut.Id + DungeonDiscoveryCommandMapperV2.ShortcutActivationClaimSuffix));
            IReadOnlyList<string> current =
                ExpeditionRuntimeController.SelectTransactionBackedActiveShortcutIds(
                    campaign,
                    plan,
                    new[] { shortcut.DurableRewardId, "unknown-shortcut" });
            Assert.That(current, Is.EqualTo(new[] { shortcut.DurableRewardId }));
        }

        [Test]
        public void CommitFailureLeavesDurableStateUnchangedAndCanRetry()
        {
            DungeonPlanV2 plan = CreatePlan();
            var port = new FakeCampaignPort(CreateCampaign(plan)) { FailNextCommit = true };
            var coordinator = new DungeonExpeditionProgressionCoordinatorV2(plan, port);
            DungeonDiscoveryPlanV2 recovery = plan.Discoveries.Single(value =>
                value.DurableRewardId == IndustrialFactoryV2Ruleset.CoolingFinArrayRewardId);

            DungeonProgressionOperationResultV2 failed = coordinator.TryDiscover(recovery.Id);
            DungeonProgressionOperationResultV2 retried = coordinator.TryDiscover(recovery.Id);

            Assert.That(failed.Success, Is.False);
            Assert.That(failed.FailureCode, Is.EqualTo("save-failed"));
            Assert.That(retried.Success, Is.True);
            Assert.That(retried.Changed, Is.True);
            Assert.That(port.CommitCount, Is.EqualTo(1));
            Assert.That(port.Snapshot.unidentifiedRecoveries, Has.Count.EqualTo(1));
        }

        [Test]
        public void LargeRefractorAndExtractionRemainIdempotentAcrossCoordinatorReentry()
        {
            DungeonPlanV2 plan = CreatePlan();
            var port = new FakeCampaignPort(CreateCampaign(plan));
            var firstCoordinator = new DungeonExpeditionProgressionCoordinatorV2(plan, port);
            int firstRequests = 0;
            firstCoordinator.ExtractionRequested += _ => firstRequests += 1;

            DungeonExtractionAttemptResultV2 blocked = firstCoordinator.TryRequestExtraction();
            DungeonProgressionOperationResultV2 blockedRefractor =
                firstCoordinator.TrySecureLargeRefractor("2026-07-17T12:00:00Z");
            DungeonProgressionOperationResultV2 guardian =
                firstCoordinator.TryMarkFinalGuardianDefeated();
            DungeonProgressionOperationResultV2 guardianReplay =
                firstCoordinator.TryMarkFinalGuardianDefeated();
            DungeonProgressionOperationResultV2 secured =
                firstCoordinator.TrySecureLargeRefractor("2026-07-17T12:00:00Z");
            DungeonProgressionOperationResultV2 replayed =
                firstCoordinator.TrySecureLargeRefractor("2026-07-17T12:00:00Z");
            DungeonExtractionAttemptResultV2 requested = firstCoordinator.TryRequestExtraction();
            DungeonExtractionAttemptResultV2 requestReplay = firstCoordinator.TryRequestExtraction();

            Assert.That(blocked.Success, Is.False);
            Assert.That(blocked.FailureCode, Is.EqualTo("large-refractor-required"));
            Assert.That(blockedRefractor.Success, Is.False);
            Assert.That(blockedRefractor.FailureCode, Is.EqualTo("final-guardian-required"));
            Assert.That(guardian.Success, Is.True);
            Assert.That(guardianReplay.IdempotentReplay, Is.True);
            Assert.That(secured.Success, Is.True);
            Assert.That(replayed.Success, Is.True);
            Assert.That(replayed.IdempotentReplay, Is.True);
            Assert.That(port.CommitCount, Is.EqualTo(2));
            Assert.That(port.Snapshot.expeditionResolutionHistory, Has.Count.EqualTo(1));
            Assert.That(requested.Success, Is.True);
            Assert.That(requestReplay.IdempotentReplay, Is.True);
            Assert.That(firstRequests, Is.EqualTo(1));

            var reentered = new DungeonExpeditionProgressionCoordinatorV2(plan, port);
            int reentryRequests = 0;
            reentered.ExtractionRequested += _ => reentryRequests += 1;
            Assert.That(reentered.ExtractionState, Is.EqualTo(DungeonExtractionStateV2.Ready));
            DungeonProgressionOperationResultV2 reentryGuardian =
                reentered.TryMarkFinalGuardianDefeated();
            DungeonProgressionOperationResultV2 reentryRefractor =
                reentered.TrySecureLargeRefractor("2026-07-17T12:00:00Z");
            DungeonExtractionAttemptResultV2 reentryExtraction = reentered.TryRequestExtraction();
            Assert.That(reentryGuardian.IdempotentReplay, Is.True);
            Assert.That(reentryRefractor.IdempotentReplay, Is.True);
            Assert.That(reentryExtraction.Success, Is.True);
            Assert.That(reentryRequests, Is.EqualTo(1));
            Assert.That(port.CommitCount, Is.EqualTo(2));
            Assert.That(port.Snapshot.expeditionResolutionHistory, Has.Count.EqualTo(1));
        }

        [Test]
        public void CoordinatorRejectsMismatchedContentPackIdentity()
        {
            DungeonPlanV2 plan = CreatePlan();
            CampaignStateV1 campaign = CreateCampaign(plan);
            campaign.expedition.dungeonContentPackVersion = "foreign-content-pack";
            var coordinator = new DungeonExpeditionProgressionCoordinatorV2(
                plan,
                new FakeCampaignPort(campaign));

            DungeonProgressionOperationResultV2 result = coordinator.TryDiscover(
                plan.Discoveries[0].Id);

            Assert.That(coordinator.ExtractionState, Is.EqualTo(DungeonExtractionStateV2.Inactive));
            Assert.That(result.Success, Is.False);
            Assert.That(result.FailureCode, Is.EqualTo("expedition-context-mismatch"));
            Assert.That(result.Message, Does.Contain("content-pack"));
        }

        [Test]
        public void CoordinatorRejectsSeedOrCanonicalRuinDriftBeforeAnyRewardCommit()
        {
            DungeonPlanV2 plan = CreatePlan();
            var seedPort = new FakeCampaignPort(CreateCampaign(plan));
            var seedCoordinator = new DungeonExpeditionProgressionCoordinatorV2(plan, seedPort);
            CampaignStateV1 seedDrift = seedPort.Snapshot;
            seedDrift.expedition.runSeed = "foreign-seed";
            seedPort.Replace(seedDrift);

            DungeonProgressionOperationResultV2 seedResult = seedCoordinator.TryDiscover(
                plan.Discoveries[0].Id);
            Assert.That(seedResult.Success, Is.False);
            Assert.That(seedResult.FailureCode, Is.EqualTo("expedition-context-mismatch"));
            Assert.That(seedPort.CommitCount, Is.Zero);

            var ruinPort = new FakeCampaignPort(CreateCampaign(plan));
            var ruinCoordinator = new DungeonExpeditionProgressionCoordinatorV2(plan, ruinPort);
            CampaignStateV1 ruinDrift = ruinPort.Snapshot;
            ruinDrift.expedition.ruinId = "ruin:foreign-signature";
            ruinPort.Replace(ruinDrift);

            DungeonProgressionOperationResultV2 ruinResult = ruinCoordinator.TryDiscover(
                plan.Discoveries[0].Id);
            Assert.That(ruinResult.Success, Is.False);
            Assert.That(ruinResult.FailureCode, Is.EqualTo("expedition-context-mismatch"));
            Assert.That(ruinPort.CommitCount, Is.Zero);
        }

        [Test]
        public void ResumeIdentity_RequiresExactCurrentPlanIdentity()
        {
            DungeonPlanV2 plan = CreatePlan();
            CampaignStateV1 exact = CreateCampaign(plan);

            Assert.That(ExpeditionRuntimeController.TryValidateV2ResumeIdentity(
                exact, plan, out string exactError), Is.True, exactError);

            CampaignStateV1 signatureDrift = exact.Clone();
            signatureDrift.expedition.dungeonPlanId = "different-plan-signature";
            Assert.That(ExpeditionRuntimeController.TryValidateV2ResumeIdentity(
                signatureDrift, plan, out string signatureError), Is.False);
            Assert.That(signatureError, Does.Contain("canonical ruin id").Or.Contain("plan signature"));

            CampaignStateV1 contentDrift = exact.Clone();
            contentDrift.expedition.dungeonContentPackVersion = "foreign-content-pack";
            Assert.That(ExpeditionRuntimeController.TryValidateV2ResumeIdentity(
                contentDrift, plan, out string contentError), Is.False);
            Assert.That(contentError, Does.Contain("content pack"));

            CampaignStateV1 provisional = exact.Clone();
            provisional.knownRuins.Clear();
            provisional.expedition.dungeonRulesetVersion = "dungeon-plan-v2";
            provisional.expedition.dungeonContentPackVersion = null;
            provisional.expedition.dungeonPlanId = provisional.expedition.expeditionId;
            provisional.expedition.ruinId = "ruin-" + provisional.expedition.expeditionId;
            Assert.That(ExpeditionRuntimeController.TryValidateV2ResumeIdentity(
                provisional, plan, out string provisionalError),
                Is.False);
            Assert.That(provisionalError, Does.Contain("does not match"));

            CampaignStateV1 currentRulesetWithWrongRuin = exact.Clone();
            currentRulesetWithWrongRuin.expedition.ruinId = "ruin:foreign-canonical-id";
            Assert.That(ExpeditionRuntimeController.TryValidateV2ResumeIdentity(
                currentRulesetWithWrongRuin, plan, out _), Is.False,
                "A mismatched identity must never be silently rewritten.");

            CampaignStateV1 nonCanonicalKnownRuin = exact.Clone();
            nonCanonicalKnownRuin.knownRuins.Add(new KnownRuinV1
            {
                ruinId = "ruin:wrong-alias",
                dungeonPlanId = plan.DeterministicSignature,
                dungeonProfileId = plan.ProfileId,
                dungeonRulesetVersion = plan.RulesetVersion,
                dungeonContentPackVersion = plan.ContentPackVersion,
                runSeed = plan.Seed
            });
            Assert.That(ExpeditionRuntimeController.TryValidateV2ResumeIdentity(
                nonCanonicalKnownRuin, plan, out string knownError), Is.False);
            Assert.That(knownError, Does.Contain("known ruin identity"));
        }

        [Test]
        public void UnknownPlanLocalProgress_IsQuarantinedWithoutDiscardingValidProgress()
        {
            DungeonPlanV2 plan = CreatePlan();
            CampaignStateV1 campaign = CampaignStateRepair.Repair(CreateCampaign(plan));
            ActiveDungeonProgressV1 progress = campaign.expedition.dungeonProgress;
            DungeonEnvironmentControllerPlanV2 controller = plan.EnvironmentControllers.Single(value =>
                value.Kind == DungeonEnvironmentControllerKindV2.ValveUnlock);
            string validControllerState = controller.StableStateIds.Contains("Unlocked")
                ? "Unlocked"
                : controller.StableStateIds[0];
            string validControllerFact = "controller:" + controller.Id + "=" + validControllerState;
            DungeonEnvironmentControllerPlanV2 waterRouting = plan.EnvironmentControllers.Single(value =>
                value.Kind == DungeonEnvironmentControllerKindV2.WaterRouting);
            string transientWaterFact = "controller:" + waterRouting.Id + "="
                + waterRouting.StableStateIds[0];
            DungeonEnvironmentControllerPlanV2 crumble = plan.EnvironmentControllers.Single(value =>
                value.Kind == DungeonEnvironmentControllerKindV2.Crumble);
            string transientCrumbleFact = "controller:" + crumble.Id + "="
                + crumble.StableStateIds[0];
            string validShortcut = plan.Shortcuts[0].Id;
            string validRegion = plan.Regions[0].Id;
            string validEdge = plan.TraversalEdges[0].Id;
            string validLandmark = plan.Anchors.First(value =>
                value.Kind == DungeonAnchorKindV2.Landmark).Id;
            string validClaim = DungeonRewardTransactionService.CreateExpeditionClaimKey(
                campaign.expedition.expeditionId,
                campaign.expedition.ruinId,
                plan.Discoveries[0].Id);
            string unknownClaim = DungeonRewardTransactionService.CreateExpeditionClaimKey(
                campaign.expedition.expeditionId,
                campaign.expedition.ruinId,
                "unknown-discovery");
            const string corruptClaim = "drc1:2147483647:x";
            string validRequiredItem = plan.Discoveries.First(value =>
                value.DurableRewardId == IndustrialFactoryV2Ruleset.CredentialKeyRewardId).DurableRewardId;
            string validRequiredFact = IndustrialFactoryV2Ruleset.FinalEliteDefeatedFactId;
            string validPermanentFact = "lore:" + plan.Discoveries.First(value =>
                value.Kind == DungeonDiscoveryKindV2.Lore).DurableRewardId;

            progress.requiredItemIds.Add(validRequiredItem);
            progress.requiredItemIds.Add("unknown-required-item");
            progress.requiredFactIds.Add(validRequiredFact);
            progress.requiredFactIds.Add("unknown-progression-fact");
            progress.permanentFactIds.Add(validPermanentFact);
            progress.permanentFactIds.Add("unknown-permanent-fact");
            progress.permanentFactIds.Add(validControllerFact);
            progress.permanentFactIds.Add(transientWaterFact);
            progress.permanentFactIds.Add(transientCrumbleFact);
            progress.permanentFactIds.Add("controller:unknown-controller=UnknownState");
            progress.activatedShortcutIds.Add(validShortcut);
            progress.activatedShortcutIds.Add("unknown-shortcut");
            progress.mapKnowledge.seenRegionIds.Add(validRegion);
            progress.mapKnowledge.seenRegionIds.Add("unknown-region");
            progress.mapKnowledge.discoveredConnectionIds.Add(validEdge);
            progress.mapKnowledge.discoveredConnectionIds.Add("unknown-edge");
            progress.mapKnowledge.knownLandmarkIds.Add(validLandmark);
            progress.mapKnowledge.knownLandmarkIds.Add("unknown-landmark");
            progress.mapKnowledge.knownMechanismIds.Add(controller.Id);
            progress.mapKnowledge.knownMechanismIds.Add("unknown-controller");
            progress.claimedRewardIds.Add(validClaim);
            progress.claimedRewardIds.Add(unknownClaim);
            progress.claimedRewardIds.Add(corruptClaim);

            int removed = ExpeditionRuntimeController.QuarantineUnknownV2Progress(
                campaign,
                plan,
                "2026-07-18T00:00:00Z");
            int quarantineCount = campaign.unknownIdQuarantine.Count;

            Assert.That(removed, Is.EqualTo(13));
            Assert.That(progress.requiredItemIds, Does.Contain(validRequiredItem));
            Assert.That(progress.requiredFactIds, Does.Contain(validRequiredFact));
            Assert.That(progress.permanentFactIds, Does.Contain(validPermanentFact));
            Assert.That(progress.permanentFactIds, Does.Contain(validControllerFact));
            Assert.That(progress.permanentFactIds, Does.Not.Contain(transientWaterFact));
            Assert.That(progress.permanentFactIds, Does.Not.Contain(transientCrumbleFact));
            Assert.That(progress.activatedShortcutIds, Does.Contain(validShortcut));
            Assert.That(progress.mapKnowledge.seenRegionIds, Does.Contain(validRegion));
            Assert.That(progress.mapKnowledge.discoveredConnectionIds, Does.Contain(validEdge));
            Assert.That(progress.mapKnowledge.knownLandmarkIds, Does.Contain(validLandmark));
            Assert.That(progress.mapKnowledge.knownMechanismIds, Does.Contain(controller.Id));
            Assert.That(progress.claimedRewardIds, Does.Contain(validClaim));
            Assert.That(campaign.unknownIdQuarantine.Any(value =>
                value.category == "dungeon-discovery"
                && value.unknownId == "unknown-discovery"), Is.True);
            Assert.That(campaign.unknownIdQuarantine.Any(value =>
                value.category == "dungeon-discovery"
                && value.unknownId == corruptClaim), Is.True);

            int replayRemoved = ExpeditionRuntimeController.QuarantineUnknownV2Progress(
                campaign,
                plan,
                "2026-07-18T01:00:00Z");
            Assert.That(replayRemoved, Is.Zero);
            Assert.That(campaign.unknownIdQuarantine, Has.Count.EqualTo(quarantineCount),
                "Repeated restore must not duplicate visible quarantine records.");
        }

        [Test]
        public void UnknownCanonicalKnownRuinKnowledge_IsQuarantinedWithoutDiscardingValidHistory()
        {
            DungeonPlanV2 plan = CreatePlan();
            CampaignStateV1 campaign = CampaignStateRepair.Repair(CreateCampaign(plan));
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
            DungeonDiscoveryPlanV2 validDiscovery = plan.Discoveries.First(value =>
                value.DuplicatePolicy == DungeonDiscoveryDuplicatePolicyV2.OncePerRuin);
            string validPermanentFact = "lore:" + plan.Discoveries.First(value =>
                value.Kind == DungeonDiscoveryKindV2.Lore).DurableRewardId;
            string validRegion = plan.Regions[0].Id;
            string validEdge = plan.TraversalEdges[0].Id;
            string validLandmark = plan.Anchors.First(value =>
                value.Kind == DungeonAnchorKindV2.Landmark).Id;
            string validShortcut = plan.Shortcuts[0].Id;
            string validClaim = DungeonRewardTransactionService.CreateClaimKey(
                known.ruinId,
                validDiscovery.Id);
            string unknownClaim = DungeonRewardTransactionService.CreateClaimKey(
                known.ruinId,
                "unknown-known-ruin-discovery");
            string expeditionScopedClaim = DungeonRewardTransactionService.CreateExpeditionClaimKey(
                campaign.expedition.expeditionId,
                known.ruinId,
                validDiscovery.Id);
            string foreignRuinClaim = DungeonRewardTransactionService.CreateClaimKey(
                "ruin:foreign-plan",
                validDiscovery.Id);

            known.permanentFactIds.Add(validPermanentFact);
            known.permanentFactIds.Add("unknown-known-ruin-fact");
            known.activatedShortcutIds.Add(validShortcut);
            known.activatedShortcutIds.Add("unknown-known-ruin-shortcut");
            known.mapKnowledge.seenRegionIds.Add(validRegion);
            known.mapKnowledge.seenRegionIds.Add("unknown-known-ruin-seen");
            known.mapKnowledge.visitedRegionIds.Add(validRegion);
            known.mapKnowledge.visitedRegionIds.Add("unknown-known-ruin-visited");
            known.mapKnowledge.exploredRegionIds.Add(validRegion);
            known.mapKnowledge.exploredRegionIds.Add("unknown-known-ruin-explored");
            known.mapKnowledge.discoveredConnectionIds.Add(validEdge);
            known.mapKnowledge.discoveredConnectionIds.Add("unknown-known-ruin-edge");
            known.mapKnowledge.knownLandmarkIds.Add(validLandmark);
            known.mapKnowledge.knownLandmarkIds.Add("unknown-known-ruin-landmark");
            known.claimedRewardIds.Add(validClaim);
            known.claimedRewardIds.Add(unknownClaim);
            known.claimedRewardIds.Add(expeditionScopedClaim);
            known.claimedRewardIds.Add(foreignRuinClaim);

            int removed = ExpeditionRuntimeController.QuarantineUnknownV2Progress(
                campaign,
                plan,
                "2026-07-18T02:00:00Z");
            int quarantineCount = campaign.unknownIdQuarantine.Count;

            Assert.That(removed, Is.EqualTo(10));
            Assert.That(known.permanentFactIds, Is.EqualTo(new[] { validPermanentFact }));
            Assert.That(known.activatedShortcutIds, Is.EqualTo(new[] { validShortcut }));
            Assert.That(known.mapKnowledge.seenRegionIds, Does.Contain(validRegion));
            Assert.That(known.mapKnowledge.visitedRegionIds, Does.Contain(validRegion));
            Assert.That(known.mapKnowledge.exploredRegionIds, Does.Contain(validRegion));
            Assert.That(known.mapKnowledge.discoveredConnectionIds, Does.Contain(validEdge));
            Assert.That(known.mapKnowledge.knownLandmarkIds, Does.Contain(validLandmark));
            Assert.That(known.claimedRewardIds, Is.EqualTo(new[] { validClaim }));
            Assert.That(campaign.unknownIdQuarantine.Any(value =>
                value.path == "knownRuins.claimedRewardIds"
                && value.unknownId == "unknown-known-ruin-discovery"), Is.True);
            Assert.That(campaign.unknownIdQuarantine.Any(value =>
                value.path == "knownRuins.mapKnowledge.discoveredConnectionIds"
                && value.unknownId == "unknown-known-ruin-edge"), Is.True);

            int replayRemoved = ExpeditionRuntimeController.QuarantineUnknownV2Progress(
                campaign,
                plan,
                "2026-07-18T03:00:00Z");
            Assert.That(replayRemoved, Is.Zero);
            Assert.That(campaign.unknownIdQuarantine, Has.Count.EqualTo(quarantineCount));
        }

        [Test]
        public void RestoredKnowledgePromotesExploredThroughVisitedAndSeenBeforeEnumeration()
        {
            DungeonPlanV2 plan = CreatePlan();
            DungeonRegionPlanV2 exploredOnlyRegion = plan.Regions[1];
            var known = new KnownRuinV1
            {
                ruinId = "ruin:" + plan.DeterministicSignature,
                mapKnowledge = new DungeonMapKnowledgeV1
                {
                    exploredRegionIds = new System.Collections.Generic.List<string>
                    {
                        exploredOnlyRegion.Id
                    }
                }
            };
            MethodInfo restore = typeof(ExpeditionRuntimeController).GetMethod(
                "BuildRestoredKnowledge",
                BindingFlags.NonPublic | BindingFlags.Static);

            Assert.That(restore, Is.Not.Null);
            var restored = (DungeonMapKnowledgeStateV2)restore.Invoke(
                null,
                new object[]
                {
                    plan,
                    new DungeonMapKnowledgeV1(),
                    Array.Empty<string>(),
                    known
                });

            Assert.That(restored.Regions.Single(value =>
                    value.RegionId == exploredOnlyRegion.Id).Level,
                Is.EqualTo(DungeonMapKnowledgeLevelV2.Explored));
        }

        private static DungeonDiscoveryCommandV2 AssertMapping(
            DungeonPlanV2 plan,
            CampaignStateV1 campaign,
            DungeonAnchorPlanV2 anchor,
            string districtId,
            DungeonDiscoveryKindV2 kind,
            string rewardId,
            DungeonDiscoveryEffectKindV2 expectedEffect)
        {
            var discovery = new DungeonDiscoveryPlanV2(
                "mapping-" + kind,
                kind,
                anchor.Id,
                districtId,
                DungeonAccessPredicateV2.Always,
                DungeonAccessPredicateV2.Always,
                rewardId,
                2,
                DungeonDiscoveryDuplicatePolicyV2.OncePerRuin);
            bool mapped = DungeonDiscoveryCommandMapperV2.TryMap(
                plan,
                discovery,
                campaign,
                out DungeonDiscoveryCommandV2 command,
                out string failureCode,
                out string message);
            Assert.That(mapped, Is.True, failureCode + ": " + message);
            Assert.That(command.EffectKind, Is.EqualTo(expectedEffect));
            return command;
        }

        private static DungeonPlanV2 CreatePlan()
        {
            // This seed deterministically selects the magma district, ensuring
            // both the cooling recovery and fixed chip blueprint are present.
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate("progression-runtime-v2");
            if (!plan.Discoveries.Any(value =>
                    value.DurableRewardId == IndustrialFactoryV2Ruleset.HeatResistChipRewardId))
            {
                plan = new IndustrialFactoryV2Generator().Generate("progression-runtime-v2-alt");
            }

            return plan;
        }

        private static CampaignStateV1 CreateCampaign(DungeonPlanV2 plan)
        {
            WorkshopTransactionResult begun = RollWorkshopService.BeginExpedition(
                CampaignStateV1.CreateDefault("progression-v2"),
                "expedition-v2",
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

            public bool FailNextCommit { get; set; }
            public int CommitCount { get; private set; }
            public CampaignStateV1 Snapshot => state.Clone();

            public void Replace(CampaignStateV1 replacement)
            {
                state = CampaignStateRepair.Repair(replacement.Clone());
            }

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
