using System.Collections.Generic;
using NUnit.Framework;

namespace RuinCrawler.Core.Campaign.Tests
{
    public sealed class RollWorkshopServiceTests
    {
        [Test]
        public void IdentifyAll_StoresHiddenPartsAndRemainderAsScrap()
        {
            CampaignStateV1 state = CampaignStateV1.CreateDefault();
            state.unidentifiedRecoveries.Add(new UnidentifiedRecoveryV1
            {
                recoveryId = "recovery-2",
                sourceKind = "weapon",
                sourceId = "pulseCannon",
                sequence = 2,
                quantity = 3,
                recoverableParts = new List<RecoveryPartV1>
                {
                    new RecoveryPartV1
                    {
                        materialId = "revolvingPulseBarrel",
                        name = "Revolving Pulse Barrel",
                        quantity = 1
                    }
                }
            });

            WorkshopTransactionResult result = RollWorkshopService.IdentifyAll(state);

            Assert.That(result.Success, Is.True);
            Assert.That(result.ProcessedRecoveries, Is.EqualTo(3));
            Assert.That(result.PartsStored, Is.EqualTo(1));
            Assert.That(result.ScrapStored, Is.EqualTo(2));
            Assert.That(result.State.salvage.identifiedScrap, Is.EqualTo(2));
            Assert.That(result.State.salvage.parts[0].materialId, Is.EqualTo("revolvingPulseBarrel"));
            Assert.That(result.State.unidentifiedRecoveries, Is.Empty);
            Assert.That(state.unidentifiedRecoveries, Has.Count.EqualTo(1), "The input state must remain untouched.");
        }

        [Test]
        public void IdentifyAll_StableRecoveryIdsPreventBatchAndReplayDuplication()
        {
            CampaignStateV1 state = CampaignStateV1.CreateDefault();
            var recovery = new UnidentifiedRecoveryV1
            {
                recoveryId = "recovery-stable-1",
                sourceKind = "weakPoint",
                sourceId = "rubyOptic",
                sequence = 1,
                quantity = 2,
                recoverableParts = new List<RecoveryPartV1>
                {
                    new RecoveryPartV1
                    {
                        materialId = "rubyOpticLens",
                        name = "Ruby Optic Lens",
                        quantity = 1
                    }
                }
            };
            state.unidentifiedRecoveries.Add(recovery);
            state.unidentifiedRecoveries.Add(recovery.Clone());

            WorkshopTransactionResult identified = RollWorkshopService.IdentifyAll(state);

            Assert.That(identified.Success, Is.True);
            Assert.That(identified.ProcessedRecoveries, Is.EqualTo(2));
            Assert.That(identified.PartsStored, Is.EqualTo(1));
            Assert.That(identified.ScrapStored, Is.EqualTo(1));
            Assert.That(identified.State.resolvedRecoveryIds, Is.EqualTo(new[] { "recovery-stable-1" }));

            CampaignStateV1 replayState = identified.State.Clone();
            replayState.unidentifiedRecoveries.Add(recovery.Clone());
            WorkshopTransactionResult replay = RollWorkshopService.IdentifyAll(replayState);
            Assert.That(replay.Success, Is.True);
            Assert.That(replay.ProcessedRecoveries, Is.Zero);
            Assert.That(replay.PartsStored, Is.Zero);
            Assert.That(replay.ScrapStored, Is.Zero);
            Assert.That(replay.State.salvage.parts[0].quantity, Is.EqualTo(1));
            Assert.That(replay.State.salvage.identifiedScrap, Is.EqualTo(1));
        }

        [Test]
        public void IdentifyAll_InvalidRecoveryFailsTheWholeBatchWithoutMutation()
        {
            CampaignStateV1 state = CampaignStateV1.CreateDefault();
            state.unidentifiedRecoveries.Add(new UnidentifiedRecoveryV1
            {
                recoveryId = null,
                quantity = 1
            });

            WorkshopTransactionResult result = RollWorkshopService.IdentifyAll(state);

            Assert.That(result.Success, Is.False);
            Assert.That(result.FailureCode, Is.EqualTo("invalid-recovery"));
            Assert.That(result.State, Is.SameAs(state));
            Assert.That(state.unidentifiedRecoveries, Has.Count.EqualTo(1));
        }

        [Test]
        public void Fabricate_FailureDoesNotConsumeAndReplayDoesNotDuplicate()
        {
            CampaignStateV1 state = CampaignStateV1.CreateDefault();
            state.salvage.identifiedScrap = 12;
            state.salvage.parts.Add(new NamedPartStackV1
            {
                materialId = "revolvingPulseBarrel",
                quantity = 1
            });
            var recipe = new WorkshopRecipeV1
            {
                recipeId = "machineGunArm",
                outputKind = "arm",
                outputId = "machineGunArm",
                identifiedScrapCost = 12,
                parts = new List<WorkshopPartRequirementV1>
                {
                    new WorkshopPartRequirementV1 { materialId = "revolvingPulseBarrel", quantity = 1 },
                    new WorkshopPartRequirementV1 { materialId = "ammunitionFeedDrum", quantity = 1 }
                }
            };

            WorkshopTransactionResult failed = RollWorkshopService.Fabricate(
                state,
                recipe,
                "tx-missing",
                "2026-07-17T00:00:00Z");
            Assert.That(failed.Success, Is.False);
            Assert.That(state.salvage.identifiedScrap, Is.EqualTo(12));
            Assert.That(state.salvage.parts[0].quantity, Is.EqualTo(1));

            state.salvage.parts.Add(new NamedPartStackV1
            {
                materialId = "ammunitionFeedDrum",
                quantity = 1
            });
            WorkshopTransactionResult committed = RollWorkshopService.Fabricate(
                state,
                recipe,
                "tx-machine-gun",
                "2026-07-17T00:00:00Z");
            Assert.That(committed.Success, Is.True);
            Assert.That(committed.State.salvage.identifiedScrap, Is.Zero);
            Assert.That(committed.State.ownedArmIds, Does.Contain("machineGunArm"));

            WorkshopTransactionResult replay = RollWorkshopService.Fabricate(
                committed.State,
                recipe,
                "tx-machine-gun",
                "2026-07-17T00:00:01Z");
            Assert.That(replay.Success, Is.True);
            Assert.That(replay.IdempotentReplay, Is.True);
            Assert.That(replay.State.fabricationHistory, Has.Count.EqualTo(1));
        }

        [Test]
        public void Fabricate_AlreadyOwnedPhysicalOutputDoesNotConsumeResources()
        {
            CampaignStateV1 state = CampaignStateV1.CreateDefault();
            state.salvage.identifiedScrap = 5;
            var recipe = new WorkshopRecipeV1
            {
                recipeId = "duplicate-mega",
                outputKind = "arm",
                outputId = "megaBuster",
                identifiedScrapCost = 5
            };

            WorkshopTransactionResult result = RollWorkshopService.Fabricate(
                state,
                recipe,
                "tx-duplicate-mega",
                "2026-07-17T00:00:00Z");

            Assert.That(result.Success, Is.False);
            Assert.That(result.FailureCode, Is.EqualTo("already-owned"));
            Assert.That(state.salvage.identifiedScrap, Is.EqualTo(5));
            Assert.That(state.fabricationHistory, Is.Empty);
        }

        [Test]
        public void Equip_RequiresSafeAreaAndOwnership()
        {
            CampaignStateV1 state = CampaignStateV1.CreateDefault();
            state.ownedArmIds.Add("cannonArm");

            WorkshopTransactionResult unsafeResult = RollWorkshopService.Equip(
                state, "arm", "special1", "cannonArm", false);
            Assert.That(unsafeResult.Success, Is.False);
            Assert.That(unsafeResult.FailureCode, Is.EqualTo("unsafe-area"));

            WorkshopTransactionResult result = RollWorkshopService.Equip(
                state, "arm", "special1", "cannonArm", true);
            Assert.That(result.Success, Is.True);
            Assert.That(result.State.armAssignments.Exists(value =>
                value.slotId == "special1" && value.itemId == "cannonArm"), Is.True);
        }

        [Test]
        public void BossVictory_IsLockedToExpeditionAndIdempotent()
        {
            CampaignStateV1 state = CampaignStateV1.CreateDefault();
            state = RollWorkshopService.SelectBossHunt(state, "rubyOpticOracle", true).State;
            state = RollWorkshopService.BeginExpedition(state, "exp-7", "seed-7", "ruins").State;
            var reward = new BossRewardV1(
                "rubyOpticLens", "Ruby Optic Lens", "Optics", "weakPoint", "signature", 1);

            WorkshopTransactionResult victory = RollWorkshopService.ResolveBossVictory(
                state,
                "victory-exp-7",
                "rubyOpticOracle",
                "exp-7",
                reward,
                reward,
                "2026-07-17T00:00:00Z");
            Assert.That(victory.Success, Is.True);
            Assert.That(victory.State.bossHunts.clearedProfileIds, Does.Contain("rubyOpticOracle"));
            Assert.That(victory.State.salvage.parts[0].quantity, Is.EqualTo(1));

            WorkshopTransactionResult replay = RollWorkshopService.ResolveBossVictory(
                victory.State,
                "victory-exp-7",
                "rubyOpticOracle",
                "exp-7",
                reward,
                reward,
                "2026-07-17T00:00:01Z");
            Assert.That(replay.IdempotentReplay, Is.True);
            Assert.That(replay.State.salvage.parts[0].quantity, Is.EqualTo(1));
        }

        [Test]
        public void UnknownIds_AreQuarantinedWithoutSubstitution()
        {
            CampaignStateV1 state = CampaignStateV1.CreateDefault();
            state.ownedModuleIds.Add("future-module");
            var known = new CampaignKnownIds(
                moduleIds: new[] { "pulseBolt" },
                armIds: new[] { "megaBuster" },
                gearIds: new[] { "reinforcedArmorFrame" });

            CampaignStateV1 repaired = CampaignStateRepair.QuarantineUnknownIds(
                state,
                known,
                "2026-07-17T00:00:00Z");

            Assert.That(repaired.ownedModuleIds, Does.Not.Contain("future-module"));
            Assert.That(repaired.unknownIdQuarantine.Exists(value =>
                value.category == "module" && value.unknownId == "future-module"), Is.True);
            Assert.That(state.ownedModuleIds, Does.Contain("future-module"));
        }

        [Test]
        public void KnownMaterializedBusterAssignmentSurvivesUnknownIdQuarantine()
        {
            CampaignStateV1 state = CampaignStateV1.CreateDefault();
            state.busterSources.Add(new BusterSourceV1
            {
                buildId = "field-buster",
                chassisId = "custom-buster-chassis"
            });
            state.armAssignments.Clear();
            state.armAssignments.Add(new LoadoutAssignmentV1
            {
                slotId = "megaBuster",
                itemId = "buster:field-buster"
            });
            var known = new CampaignKnownIds(
                chassisIds: new[] { "custom-buster-chassis" },
                armIds: new[] { "megaBuster" },
                gearIds: new[] { "reinforcedArmorFrame" });

            CampaignStateV1 repaired = CampaignStateRepair.QuarantineUnknownIds(
                state,
                known,
                "2026-07-17T00:00:00Z");

            Assert.That(repaired.armAssignments, Has.Count.EqualTo(1));
            Assert.That(repaired.armAssignments[0].itemId, Is.EqualTo("buster:field-buster"));
            Assert.That(repaired.unknownIdQuarantine.Exists(value =>
                value.category == "buster-build"), Is.False);
        }

        [Test]
        public void BusterMaterialization_ValidatesOwnershipAndRevision()
        {
            CampaignStateV1 state = CampaignStateV1.CreateDefault();
            var draft = new BusterSourceV1
            {
                buildId = "field-buster",
                chassisId = "custom-buster-chassis",
                rootNodeId = "pulse",
                power = 4,
                energy = 4,
                range = 4,
                rapid = 4,
                modules = new List<BusterModuleSourceV1>
                {
                    new BusterModuleSourceV1
                    {
                        nodeId = "pulse",
                        instanceId = "pulse-owned-1",
                        moduleId = "pulseBolt"
                    }
                }
            };

            BusterWorkshopResult missing = BusterWorkshopService.MaterializeRevision(
                state, draft, "buster-tx-1", "2026-07-17T00:00:00Z");
            Assert.That(missing.Success, Is.False);
            Assert.That(missing.FailureCode, Is.EqualTo("ownership-invalid"));

            state.ownedModuleIds.Add("pulseBolt");
            BusterWorkshopResult committed = BusterWorkshopService.MaterializeRevision(
                state, draft, "buster-tx-1", "2026-07-17T00:00:00Z");
            Assert.That(committed.Success, Is.True);
            Assert.That(committed.State.busterSources[0].revision, Is.EqualTo(1));
            Assert.That(committed.Plan.Stats.EffectivePower, Is.EqualTo(8d));

            BusterWorkshopResult stale = BusterWorkshopService.MaterializeRevision(
                committed.State, draft, "buster-tx-2", "2026-07-17T00:00:01Z");
            Assert.That(stale.Success, Is.False);
            Assert.That(stale.FailureCode, Is.EqualTo("stale-build-revision"));
        }

        [Test]
        public void BusterMaterialization_ReplayReturnsTheExactHistoricalRevision()
        {
            CampaignStateV1 state = CampaignStateV1.CreateDefault();
            state.ownedModuleIds.Add("pulseBolt");
            var revisionZero = new BusterSourceV1
            {
                buildId = "field-buster",
                chassisId = "custom-buster-chassis",
                rootNodeId = "pulse",
                modules = new List<BusterModuleSourceV1>
                {
                    new BusterModuleSourceV1
                    {
                        nodeId = "pulse",
                        instanceId = "pulse-owned-1",
                        moduleId = "pulseBolt"
                    }
                }
            };

            BusterWorkshopResult first = BusterWorkshopService.MaterializeRevision(
                state, revisionZero, "buster-history-1", "2026-07-17T00:00:00Z");
            BusterSourceV1 revisionOne = first.State.busterSources[0].Clone();
            revisionOne.power = 5;
            revisionOne.energy = 3;
            BusterWorkshopResult second = BusterWorkshopService.MaterializeRevision(
                first.State, revisionOne, "buster-history-2", "2026-07-17T00:00:01Z");

            BusterWorkshopResult replay = BusterWorkshopService.MaterializeRevision(
                second.State, revisionZero, "buster-history-1", "2026-07-17T00:00:02Z");

            Assert.That(first.Success && second.Success && replay.Success, Is.True);
            Assert.That(second.State.busterSources[0].revision, Is.EqualTo(2));
            Assert.That(replay.IdempotentReplay, Is.True);
            Assert.That(replay.Plan.BuildRevision, Is.EqualTo(1));
            Assert.That(replay.State.busterSources[0].revision, Is.EqualTo(2));
        }

        [Test]
        public void BossHunt_DepartureLocksSelectionAndReturnUnlocksExactlyOnce()
        {
            CampaignStateV1 state = CampaignStateV1.CreateDefault();
            state = RollWorkshopService.SelectBossHunt(state, "rubyOpticOracle", true).State;

            WorkshopTransactionResult begin = RollWorkshopService.BeginExpedition(
                state, "expedition-1", "seed-1", "test-dungeon-profile");
            WorkshopTransactionResult lockedSelection = RollWorkshopService.SelectBossHunt(
                begin.State, "mirrorPrismRegent", true);
            WorkshopTransactionResult returned = RollWorkshopService.ReturnToCamp(
                begin.State, "expedition-1");
            WorkshopTransactionResult replay = RollWorkshopService.ReturnToCamp(
                returned.State, null);

            Assert.That(begin.Success, Is.True);
            Assert.That(begin.State.bossHunts.selectionLocked, Is.True);
            Assert.That(begin.State.expedition.bossProfileId, Is.EqualTo("rubyOpticOracle"));
            Assert.That(lockedSelection.FailureCode, Is.EqualTo("hunt-locked"));
            Assert.That(returned.Success, Is.True);
            Assert.That(returned.State.bossHunts.selectionLocked, Is.False);
            Assert.That(returned.State.expedition.expeditionId, Is.Null);
            Assert.That(replay.Success && replay.IdempotentReplay && !replay.Changed, Is.True);
        }

        [Test]
        public void BossVictory_DifferentVictoryIdCannotRewardOneExpeditionTwice()
        {
            CampaignStateV1 state = CampaignStateV1.CreateDefault();
            state = RollWorkshopService.SelectBossHunt(state, "rubyOpticOracle", true).State;
            state = RollWorkshopService.BeginExpedition(state, "exp-unique", "seed", "ruins").State;
            var reward = new BossRewardV1(
                "rubyOpticLens", "Ruby Optic Lens", "Optics", "weakPoint", "signature", 1);
            WorkshopTransactionResult first = RollWorkshopService.ResolveBossVictory(
                state, "victory-1", "rubyOpticOracle", "exp-unique", reward, reward, "2026-07-17T00:00:00Z");

            WorkshopTransactionResult duplicate = RollWorkshopService.ResolveBossVictory(
                first.State, "victory-2", "rubyOpticOracle", "exp-unique", reward, reward, "2026-07-17T00:00:01Z");

            Assert.That(duplicate.Success, Is.False);
            Assert.That(duplicate.FailureCode, Is.EqualTo("victory-already-resolved"));
            Assert.That(duplicate.State.salvage.parts[0].quantity, Is.EqualTo(1));
            Assert.That(duplicate.State.bossHunts.victoryHistory, Has.Count.EqualTo(1));
        }

        [Test]
        public void BossVictory_RequiresPositiveFirstClearButCommitsRepeatMiss()
        {
            CampaignStateV1 firstClear = CampaignStateV1.CreateDefault("reward-contract");
            firstClear = RollWorkshopService.SelectBossHunt(firstClear, "rubyOpticOracle", true).State;
            firstClear = RollWorkshopService.BeginExpedition(
                firstClear, "first-clear-null", "seed", "ruins").State;
            WorkshopTransactionResult invalidFirst = RollWorkshopService.ResolveBossVictory(
                firstClear,
                "victory-first-null",
                "rubyOpticOracle",
                "first-clear-null",
                null,
                null,
                "2026-07-17T00:00:00Z");
            Assert.That(invalidFirst.Success, Is.False);
            Assert.That(invalidFirst.FailureCode, Is.EqualTo("invalid-reward"));

            CampaignStateV1 repeat = CampaignStateV1.CreateDefault("reward-contract");
            repeat.bossHunts.clearedProfileIds.Add("rubyOpticOracle");
            repeat = RollWorkshopService.SelectBossHunt(repeat, "rubyOpticOracle", true).State;
            repeat = RollWorkshopService.BeginExpedition(
                repeat, "repeat-miss", "seed", "ruins").State;
            var guaranteed = new BossRewardV1(
                "rubyOpticLens", "Ruby Optic Lens", "Optics", "eye", "rare", 1);
            WorkshopTransactionResult miss = RollWorkshopService.ResolveBossVictory(
                repeat,
                "victory-repeat-miss",
                "rubyOpticOracle",
                "repeat-miss",
                guaranteed,
                null,
                "2026-07-17T00:01:00Z");

            Assert.That(miss.Success, Is.True);
            Assert.That(miss.PartsStored, Is.Zero);
            Assert.That(miss.State.salvage.parts, Is.Empty);
            Assert.That(miss.State.bossHunts.resolvedVictoryIds, Does.Contain("victory-repeat-miss"));
            Assert.That(miss.State.bossHunts.victoryHistory, Has.Count.EqualTo(1));
            Assert.That(miss.State.bossHunts.victoryHistory[0].rewardMaterialId, Is.Null);
            Assert.That(miss.State.bossHunts.victoryHistory[0].rewardQuantity, Is.Zero);
        }
    }
}
