using System.IO;
using System.Linq;
using NUnit.Framework;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Core.Reaverbots;
using RuinCrawler.Runtime.Reaverbots;
using UnityEngine;

namespace RuinCrawler.Runtime.BossHunts.Tests
{
    public sealed class BossHuntContractTests
    {
        [Test]
        public void CanonicalContractProjectsAllBossConstraintsAndSignatureMaterials()
        {
            BossHuntCatalog catalog = BossHuntCatalog.Parse(ReadContractJson());

            Assert.That(catalog.Profiles.Count, Is.EqualTo(9));
            Assert.That(catalog.DefaultProfileId, Is.EqualTo("revolvingFusillade"));
            Assert.That(catalog.StatScales.Health, Is.EqualTo(6.5d));
            Assert.That(catalog.StatScales.Visual, Is.EqualTo(1.28d));

            BossHuntProfile ascension = catalog.GetRequired("ascensionEngine");
            Assert.That(ascension.RequiresAuthoredAdapter, Is.True);
            Assert.That(ascension.EncounterControllerId, Is.EqualTo("ascensionEngine"));
            Assert.That(ascension.Variants.Single().BodyPlanId, Is.EqualTo("hopper"));
            Assert.That(ascension.RewardMaterial.Id, Is.EqualTo("perfectedCompressionGreave"));

            BossHuntProfile ruby = catalog.GetRequired("rubyOpticOracle");
            Assert.That(ruby.RewardMaterial.Id, Is.EqualTo("rubyOpticLens"));
            Assert.That(ruby.PhaseOneMoves, Does.Contain("previewReflectedBeam"));
            Assert.That(ruby.PhaseTwoMoves, Does.Contain("crossingReflection"));
        }

        [Test]
        public void EqualSpawnInputsPinTheSameVariantGenomeContextAndVictoryIdentity()
        {
            BossHuntCatalog catalog = BossHuntCatalog.Parse(ReadContractJson());
            var context = new BossHuntSpawnContext("overloadReliquary", "expedition-42", "run-seed", 7);

            BossHuntSpawnPlan first = BossHuntSpawnPlan.Create(catalog, context);
            BossHuntSpawnPlan repeated = BossHuntSpawnPlan.Create(catalog, context);

            Assert.That(repeated.VariantIndex, Is.EqualTo(first.VariantIndex));
            Assert.That(repeated.Request.StableSpawnId, Is.EqualTo(first.Request.StableSpawnId));
            Assert.That(repeated.Victory.VictoryId, Is.EqualTo(first.Victory.VictoryId));
            Assert.That(first.Request.isBoss, Is.True);
            Assert.That(first.Request.bossProfileId, Is.EqualTo("overloadReliquary"));
            Assert.That(first.Request.bossSafeOverload, Is.True);
            Assert.That(first.Request.archetypeId, Is.EqualTo("aerialBomber"));
            Assert.That(first.Request.weaponId, Is.EqualTo("overloadCore"));
            Assert.That(first.Request.CreateGenerationOptions().IsBoss, Is.True);
            Assert.That(first.Request.CreateGenerationOptions().BossProfileId, Is.EqualTo("overloadReliquary"));
        }

        [Test]
        public void VictoryPlanFeedsAtomicRollResolutionAndReplaysIdempotently()
        {
            BossHuntCatalog catalog = BossHuntCatalog.Parse(ReadContractJson());
            CampaignStateV1 state = CampaignStateV1.CreateDefault("boss-test");
            state = RollWorkshopService.SelectBossHunt(state, "rubyOpticOracle", true).State;
            state = RollWorkshopService.BeginExpedition(state, "expedition-ruby", "seed-ruby", "boss-ruin").State;
            BossVictoryPlan victory = BossHuntSpawnPlan.Create(
                catalog,
                BossHuntSpawnContext.FromCampaign(state)).Victory;

            WorkshopTransactionResult first = victory.Resolve(state, "2026-07-17T12:00:00.0000000Z");
            Assert.That(first.Success, Is.True);
            Assert.That(first.State.bossHunts.resolvedVictoryIds, Does.Contain(victory.VictoryId));
            Assert.That(first.State.bossHunts.clearedProfileIds, Does.Contain("rubyOpticOracle"));
            Assert.That(first.State.salvage.parts.Single(part => part.materialId == "rubyOpticLens").quantity, Is.EqualTo(1));

            WorkshopTransactionResult replay = victory.Resolve(first.State, "2026-07-17T12:00:01.0000000Z");
            Assert.That(replay.Success, Is.True);
            Assert.That(replay.Changed, Is.False);
            Assert.That(replay.IdempotentReplay, Is.True);
            Assert.That(replay.State.salvage.parts.Single(part => part.materialId == "rubyOpticLens").quantity, Is.EqualTo(1));
            Assert.That(replay.State.bossHunts.victoryHistory.Count, Is.EqualTo(1));
        }

        [Test]
        public void EveryBossProfileProducesAValidPinnedBossGenome()
        {
            string json = ReadContractJson();
            BossHuntCatalog bosses = BossHuntCatalog.Parse(json);
            var generator = new ReaverbotGenerator(ReaverbotContractLoader.LoadJson(json));

            foreach (BossHuntProfile profile in bosses.Profiles.Values.OrderBy(value => value.Id))
            {
                BossHuntSpawnPlan plan = BossHuntSpawnPlan.Create(
                    bosses,
                    new BossHuntSpawnContext(
                        profile.Id,
                        "profile-validation:" + profile.Id,
                        "profile-validation-seed",
                        8));
                ReaverbotGenome genome = generator.Generate(plan.Request.CreateGenerationOptions());
                ReaverbotValidationResult validation = generator.Validate(genome);

                Assert.That(validation.IsValid, Is.True, profile.Id + ": " + string.Join(",", validation.Errors));
                Assert.That(genome.ArchetypeId, Is.EqualTo(profile.ArchetypeId), profile.Id);
                Assert.That(genome.Body.PlanId, Is.EqualTo(plan.Variant.BodyPlanId), profile.Id);
                Assert.That(genome.Modules.Weapon.Id, Is.EqualTo(profile.WeaponId), profile.Id);
                Assert.That(genome.Modules.Defense?.Id, Is.EqualTo(plan.Variant.DefenseId), profile.Id);
                Assert.That(genome.Modules.WeakPoint.Id, Is.EqualTo(plan.Variant.WeakPointId), profile.Id);
                Assert.That(genome.Context.IsBoss, Is.True, profile.Id);
                Assert.That(genome.Context.BossProfileId, Is.EqualTo(profile.Id), profile.Id);
            }
        }

        [TestCase("campaign-0", true, 0.44417163520120084d)]
        [TestCase("campaign-8", false, 0.8740110283251852d)]
        public void RepeatRewardRollMatchesSourceAndCommitsPassOrMissIdempotently(
            string campaignId,
            bool expectedReward,
            double expectedRoll)
        {
            BossHuntCatalog catalog = BossHuntCatalog.Parse(ReadContractJson());
            CampaignStateV1 state = CampaignStateV1.CreateDefault(campaignId);
            state = RollWorkshopService.SelectBossHunt(state, "rubyOpticOracle", true).State;
            state = RollWorkshopService.BeginExpedition(
                state, "first-" + campaignId, "seed-first", "boss-ruin").State;
            BossVictoryPlan firstPlan = BossHuntSpawnPlan.Create(
                catalog,
                BossHuntSpawnContext.FromCampaign(state)).Victory;
            WorkshopTransactionResult first = firstPlan.Resolve(state, "2026-07-17T14:00:00.0000000Z");
            Assert.That(first.Success, Is.True);

            state = RollWorkshopService.ReturnToCamp(first.State, "first-" + campaignId).State;
            state = RollWorkshopService.BeginExpedition(
                state, "repeat-" + campaignId, "seed-repeat", "boss-ruin").State;
            BossVictoryPlan repeatPlan = BossHuntSpawnPlan.Create(
                catalog,
                BossHuntSpawnContext.FromCampaign(state)).Victory;
            BossVictoryResolutionInputs inputs = repeatPlan.CreateResolutionInputs(state);

            Assert.That(inputs.FirstClear, Is.False);
            Assert.That(inputs.VictoryIndex, Is.EqualTo(2));
            Assert.That(inputs.DeterministicRoll, Is.EqualTo(expectedRoll).Within(1e-15d));
            Assert.That(inputs.RepeatRewardEligible, Is.EqualTo(expectedReward));

            WorkshopTransactionResult repeat = repeatPlan.Resolve(
                state,
                "2026-07-17T14:01:00.0000000Z");
            Assert.That(repeat.Success, Is.True);
            Assert.That(repeat.PartsStored, Is.EqualTo(expectedReward ? 1 : 0));
            Assert.That(repeat.State.salvage.parts.Single(part => part.materialId == "rubyOpticLens").quantity,
                Is.EqualTo(expectedReward ? 2 : 1));
            BossVictoryHistoryV1 history = repeat.State.bossHunts.victoryHistory.Last();
            Assert.That(history.firstClear, Is.False);
            Assert.That(history.rewardMaterialId, Is.EqualTo(expectedReward ? "rubyOpticLens" : null));
            Assert.That(history.rewardQuantity, Is.EqualTo(expectedReward ? 1 : 0));

            WorkshopTransactionResult replay = repeatPlan.Resolve(
                repeat.State,
                "2026-07-17T14:02:00.0000000Z");
            Assert.That(replay.Success, Is.True);
            Assert.That(replay.Changed, Is.False);
            Assert.That(replay.IdempotentReplay, Is.True);
            Assert.That(replay.State.bossHunts.victoryHistory.Count, Is.EqualTo(2));
            Assert.That(replay.State.salvage.parts.Single(part => part.materialId == "rubyOpticLens").quantity,
                Is.EqualTo(expectedReward ? 2 : 1));
        }

        internal static string ReadContractJson()
        {
            string path = Path.GetFullPath(Path.Combine(
                Application.dataPath, "..", "..", "..", "assets", "contracts",
                "ruin-crawler-contracts.v1.json"));
            Assert.That(File.Exists(path), Is.True, path);
            return File.ReadAllText(path);
        }
    }
}
