using NUnit.Framework;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Core.Dungeon.V2;

namespace RuinCrawler.Runtime.Persistence.Tests
{
    public sealed class ExpeditionFlowV2OnlyEntryTests
    {
        [Test]
        public void EntryTransactionExposesNoProfileOrRolloutChoice()
        {
            var parameters = typeof(ExpeditionFlowController)
                .GetMethod(nameof(ExpeditionFlowController.CreateBeginExpeditionTransaction))
                ?.GetParameters();

            Assert.That(parameters, Is.Not.Null);
            Assert.That(
                parameters.Length,
                Is.EqualTo(3),
                "The entry seam must not expose a profile selection or feature flag.");
            Assert.That(
                typeof(ExpeditionFlowController).GetField("enableIndustrialFactoryV2",
                    System.Reflection.BindingFlags.Instance
                    | System.Reflection.BindingFlags.NonPublic),
                Is.Null);
        }

        [Test]
        public void FreshEntryAlwaysPinsV2GeneratedPlanIdentityBeforeSceneBuild()
        {
            const string seed = "v2-only-entry-identity";
            CampaignStateV1 source = CampaignStateV1.CreateDefault("v2-only-entry");
            WorkshopTransactionResult result = ExpeditionFlowController.CreateBeginExpeditionTransaction(
                source,
                "expedition-v2-only",
                seed);
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate(seed);

            Assert.That(result.Success, Is.True, result.Message ?? result.FailureCode);
            Assert.That(result.State.expedition.dungeonProfileId, Is.EqualTo(plan.ProfileId));
            Assert.That(result.State.expedition.dungeonRulesetVersion, Is.EqualTo(plan.RulesetVersion));
            Assert.That(result.State.expedition.dungeonContentPackVersion, Is.EqualTo(plan.ContentPackVersion));
            Assert.That(result.State.expedition.dungeonPlanId, Is.EqualTo(plan.DeterministicSignature));
            Assert.That(result.State.expedition.ruinId, Is.EqualTo("ruin:" + plan.DeterministicSignature));
            Assert.That(
                result.State.expedition.dungeonProfileId,
                Is.EqualTo(ExpeditionFlowController.IndustrialFactoryV2ProfileId));
            Assert.That(
                ExpeditionFlowController.IndustrialFactoryV2RulesetVersion,
                Is.EqualTo(IndustrialFactoryV2Ruleset.RulesetVersion));
            Assert.That(
                ExpeditionFlowController.IndustrialFactoryV2ContentPackVersion,
                Is.EqualTo(IndustrialFactoryV2Ruleset.ContentPackVersion));
        }

        [Test]
        public void BossHuntV2IdentityUsesTheSharedDifficultyThreeContract()
        {
            const string seed = "v2-only-boss-identity";
            CampaignStateV1 source = CampaignStateV1.CreateDefault("v2-only-boss");
            source.bossHunts.selectedProfileId = "test-boss-profile";

            WorkshopTransactionResult result = ExpeditionFlowController.CreateBeginExpeditionTransaction(
                source,
                "expedition-boss",
                seed);
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate(
                seed,
                ExpeditionFlowController.IndustrialFactoryV2BossHuntDifficulty);

            Assert.That(result.Success, Is.True, result.Message ?? result.FailureCode);
            Assert.That(
                ExpeditionFlowController.ResolveIndustrialFactoryV2GenerationDifficulty(source),
                Is.EqualTo(3));
            Assert.That(result.State.expedition.bossProfileId, Is.EqualTo("test-boss-profile"));
            Assert.That(result.State.expedition.dungeonPlanId, Is.EqualTo(plan.DeterministicSignature));
            Assert.That(result.State.expedition.ruinId, Is.EqualTo("ruin:" + plan.DeterministicSignature));

            source.bossHunts.selectedProfileId = null;
            source.expedition.bossProfileId = "durable-active-boss-profile";
            Assert.That(
                ExpeditionFlowController.ResolveIndustrialFactoryV2GenerationDifficulty(source),
                Is.EqualTo(3),
                "Re-entry must retain Boss Hunt generation difficulty even if selection UI state is repaired.");
        }
    }
}
