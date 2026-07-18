using System.Collections;
using System.IO;
using NUnit.Framework;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Core.Foundation;
using RuinCrawler.Core.Reaverbots;
using RuinCrawler.Runtime.Combat;
using RuinCrawler.Runtime.Reaverbots;
using UnityEngine;
using UnityEngine.TestTools;

namespace RuinCrawler.Runtime.BossHunts.Tests
{
    public sealed class BossHuntRuntimePlayModeTests
    {
        [UnityTest]
        public IEnumerator ConstrainedBossScalesHealthTransitionsPhasesResolvesAndCleansUp()
        {
            BossHuntCatalog bosses = BossHuntCatalog.Parse(ReadContractJson());
            ReaverbotCatalog reaverbots = ReaverbotContractLoader.LoadJson(ReadContractJson());
            var spawnerObject = new GameObject("BossSpawner_Test");
            ReaverbotSpawner spawner = spawnerObject.AddComponent<ReaverbotSpawner>();
            spawner.ConfigureCatalog(reaverbots);
            var coordinatorObject = new GameObject("BossCoordinator_Test");
            BossHuntCoordinator coordinator = coordinatorObject.AddComponent<BossHuntCoordinator>();
            coordinator.ConfigureCatalog(bosses, spawner);

            CampaignStateV1 campaign = CreateActiveCampaign("rubyOpticOracle", "expedition-runtime", "boss-runtime-seed");
            BossHuntRuntimeController encounter = coordinator.SpawnSelected(campaign, Vector3.zero, Quaternion.identity);
            yield return null;

            Assert.That(encounter.Product.GeneratedRuntime, Is.Not.Null);
            Assert.That(encounter.Product.GeneratedRuntime.Genome.ArchetypeId, Is.EqualTo("shieldSentinel"));
            Assert.That(encounter.Product.GeneratedRuntime.Genome.Modules.Weapon.Id, Is.EqualTo("beamPrism"));
            Assert.That(encounter.Product.GeneratedRuntime.Genome.Context.IsBoss, Is.True);
            Assert.That(encounter.Product.GeneratedRuntime.RuntimeDamageScale,
                Is.EqualTo(bosses.StatScales.Damage));
            Assert.That(encounter.Product.GeneratedRuntime.RuntimeCooldownScale,
                Is.EqualTo(bosses.StatScales.Cooldown));
            Assert.That(encounter.Health.Maximum,
                Is.EqualTo(encounter.Product.GeneratedRuntime.Genome.Stats.MaxHealth * encounter.Plan.Profile.HealthScale)
                    .Within(0.01d));

            double phaseDamage = encounter.Health.Maximum * 0.56d;
            encounter.Product.Health.ApplyDamage(new DamagePacket(
                phaseDamage,
                "boss-runtime:phase",
                "buster",
                armorPierce: double.PositiveInfinity));
            Assert.That(encounter.Phase, Is.EqualTo(BossPhaseState.PhaseTransition));
            double transitionHealth = encounter.Health.Current;
            encounter.Product.Health.ApplyDamage(new DamagePacket(
                8d,
                "boss-runtime:transition-overflow",
                "buster",
                armorPierce: double.PositiveInfinity));
            Assert.That(encounter.Health.Current, Is.EqualTo(transitionHealth - 8d).Within(0.001d),
                "Transition damage is preserved rather than silently dropped at the phase boundary.");
            Assert.That(encounter.Phase, Is.EqualTo(BossPhaseState.PhaseTransition));
            encounter.Tick((float)encounter.Plan.Profile.PhaseTransitionSeconds + 0.01f);
            Assert.That(encounter.Phase, Is.EqualTo(BossPhaseState.PhaseTwo));

            encounter.Product.Health.ApplyDamage(new DamagePacket(
                100000d,
                "boss-runtime:defeat",
                "buster",
                armorPierce: double.PositiveInfinity,
                suppressRewards: true));
            Assert.That(encounter.Phase, Is.EqualTo(BossPhaseState.Defeated));
            ReaverbotRuntimeController bossRuntime = encounter.Product.GeneratedRuntime;
            BossHuntSpawnPlan bossPlan = encounter.Plan;
            bossRuntime.Tick(2f);
            Assert.That(spawner.ActiveCount, Is.EqualTo(1),
                "Boss ownership remains with the coordinator until durable resolution/reset.");

            int resolutionEvents = 0;
            encounter.VictoryResolved += _ => resolutionEvents += 1;
            BossVictoryResolution resolved = coordinator.Resolve(campaign, "2026-07-17T13:00:00.0000000Z");
            Assert.That(resolved.Transaction.Success, Is.True);
            Assert.That(resolved.Transaction.State.salvage.parts,
                Has.Some.Matches<NamedPartStackV1>(part => part.materialId == "rubyOpticLens"));
            Assert.That(encounter.Phase, Is.EqualTo(BossPhaseState.Defeated));
            Assert.That(resolutionEvents, Is.Zero);
            Assert.That(coordinator.AcknowledgeCommittedResolution(resolved, campaign), Is.False,
                "A failed/conflicted save cannot advance presentation state.");

            BossVictoryResolution retry = coordinator.Resolve(campaign, "2026-07-17T13:00:01.0000000Z");
            Assert.That(retry.Transaction.Success, Is.True);
            Assert.That(coordinator.AcknowledgeCommittedResolution(retry, retry.Transaction.State), Is.True);
            Assert.That(encounter.Phase, Is.EqualTo(BossPhaseState.Resolved));
            Assert.That(resolutionEvents, Is.EqualTo(1));
            BossVictoryResolution replay = coordinator.Resolve(
                retry.Transaction.State,
                "2026-07-17T13:00:02.0000000Z");
            Assert.That(replay.Transaction.IdempotentReplay, Is.True);
            Assert.That(coordinator.AcknowledgeCommittedResolution(replay, replay.Transaction.State), Is.True);
            Assert.That(resolutionEvents, Is.EqualTo(1));

            int staleHealthEvents = 0;
            encounter.HealthChanged += _ => staleHealthEvents += 1;
            coordinator.ResetEncounter();
            yield return null;
            Assert.That(coordinator.HasActiveEncounter, Is.False);
            Assert.That(spawner.ActiveCount, Is.Zero);
            ReaverbotRuntimeController reused = spawner.SpawnEncounterSlot(
                bossPlan.Request,
                Vector3.right * 3f,
                Quaternion.identity);
            yield return null;
            Assert.That(reused, Is.SameAs(bossRuntime));
            Assert.That(reused.transform.localScale, Is.EqualTo(Vector3.one));
            Assert.That(reused.RuntimeDamageScale, Is.EqualTo(1d));
            Assert.That(reused.RuntimeCooldownScale, Is.EqualTo(1d));
            Assert.That(reused.AutomaticDespawn, Is.True);
            int eventsBeforeReusedDamage = staleHealthEvents;
            reused.Health.ApplyDamage(new DamagePacket(
                1d,
                "boss-runtime:pooled-reuse",
                "test",
                armorPierce: double.PositiveInfinity,
                suppressRewards: true));
            Assert.That(staleHealthEvents, Is.EqualTo(eventsBeforeReusedDamage),
                "The cleaned Boss Hunt wrapper must not receive pooled occupant health events.");
            spawner.Despawn(reused);
            spawner.Teardown(true);
            Object.Destroy(coordinatorObject);
            Object.Destroy(spawnerObject);
            yield return null;
        }

        [UnityTest]
        public IEnumerator AuthoredControllerSeamOverridesGrayboxForAuthoredProfileAndResets()
        {
            BossHuntCatalog bosses = BossHuntCatalog.Parse(ReadContractJson());
            ReaverbotCatalog reaverbots = ReaverbotContractLoader.LoadJson(ReadContractJson());
            var spawnerObject = new GameObject("BossSpawner_AuthoredTest");
            ReaverbotSpawner spawner = spawnerObject.AddComponent<ReaverbotSpawner>();
            spawner.ConfigureCatalog(reaverbots);
            var coordinatorObject = new GameObject("BossCoordinator_AuthoredTest");
            BossHuntCoordinator coordinator = coordinatorObject.AddComponent<BossHuntCoordinator>();
            var adapter = new FakeAscensionAdapter();
            coordinator.ConfigureCatalog(bosses, spawner, null, new[] { adapter });

            BossHuntRuntimeController encounter = coordinator.Spawn(
                new BossHuntSpawnContext("ascensionEngine", "expedition-ascension", "ascension-seed"),
                Vector3.one,
                Quaternion.identity);
            yield return null;

            Assert.That(adapter.SpawnCount, Is.EqualTo(1));
            Assert.That(encounter.Product.GeneratedRuntime, Is.Null);
            Assert.That(encounter.Product.PresentationFallback, Is.False);
            Assert.That(encounter.Product.Root.transform.position, Is.EqualTo(Vector3.one));
            coordinator.ResetEncounter();
            yield return null;
            Assert.That(adapter.ResetCount, Is.EqualTo(1));
            Object.Destroy(coordinatorObject);
            Object.Destroy(spawnerObject);
            yield return null;
        }

        private static CampaignStateV1 CreateActiveCampaign(string profileId, string expeditionId, string seed)
        {
            CampaignStateV1 state = CampaignStateV1.CreateDefault("boss-runtime-test");
            state = RollWorkshopService.SelectBossHunt(state, profileId, true).State;
            return RollWorkshopService.BeginExpedition(state, expeditionId, seed, "boss-ruin").State;
        }

        private static string ReadContractJson()
        {
            string path = Path.GetFullPath(Path.Combine(
                Application.dataPath, "..", "..", "..", "assets", "contracts",
                "ruin-crawler-contracts.v1.json"));
            Assert.That(File.Exists(path), Is.True, path);
            return File.ReadAllText(path);
        }

        private sealed class FakeAscensionAdapter : IBossEncounterAdapter
        {
            public int SpawnCount { get; private set; }
            public int ResetCount { get; private set; }
            public bool CanHandle(BossHuntProfile profile) => profile?.EncounterControllerId == "ascensionEngine";
            public BossSpawnProduct Spawn(BossSpawnCommand command)
            {
                SpawnCount += 1;
                var root = new GameObject("AuthoredAscensionEngine_Test");
                root.transform.SetPositionAndRotation(command.Position, command.Rotation);
                HealthComponent health = root.AddComponent<HealthComponent>();
                health.Configure(650f, 20f, false);
                return new BossSpawnProduct(root, health, command.Plan.Request.StableSpawnId);
            }
            public void Reset(BossSpawnProduct product)
            {
                ResetCount += 1;
                if (product?.Root != null) Object.Destroy(product.Root);
            }
        }
    }
}
