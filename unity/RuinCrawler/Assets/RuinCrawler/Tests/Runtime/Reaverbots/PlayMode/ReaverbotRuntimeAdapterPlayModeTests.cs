using System;
using System.Collections;
using System.IO;
using NUnit.Framework;
using RuinCrawler.Core.Foundation;
using RuinCrawler.Core.Reaverbots;
using RuinCrawler.Runtime.Combat;
using UnityEngine;
using UnityEngine.TestTools;
using Object = UnityEngine.Object;

namespace RuinCrawler.Runtime.Reaverbots.Tests
{
    public sealed class ReaverbotRuntimeAdapterPlayModeTests
    {
        [UnityTest]
        public IEnumerator SameEncounterSlotReusesPooledHierarchyWithExactGenomeIdentity()
        {
            ReaverbotCatalog catalog = LoadCatalog();
            ReaverbotSpawner spawner = CreateSpawner(catalog, null);
            ReaverbotSpawnRequest request = ReaverbotSpawnRequest.SharukurusuStyle("pool-run", "range", 0);

            ReaverbotRuntimeController first = spawner.SpawnEncounterSlot(request, Vector3.zero, Quaternion.identity);
            string genomeId = first.Genome.GenomeId;
            string bodyTargetId = first.BodyTarget.TargetId.Value;
            yield return null;
            Assert.That(first.Health.Snapshot.Maximum, Is.EqualTo(first.Genome.Stats.MaxHealth).Within(0.001d));
            Assert.That(first.Muzzle, Is.Not.Null);
            Assert.That(first.WeakPointAnchor, Is.Not.Null);

            Assert.That(spawner.Despawn(first), Is.True);
            ReaverbotRuntimeController repeated = spawner.SpawnEncounterSlot(request, Vector3.right * 2f, Quaternion.identity);
            yield return null;

            Assert.That(repeated, Is.SameAs(first));
            Assert.That(repeated.Genome.GenomeId, Is.EqualTo(genomeId));
            Assert.That(repeated.BodyTarget.TargetId.Value, Is.EqualTo(bodyTargetId));
            Assert.That(spawner.ActiveCount, Is.EqualTo(1));
            spawner.Teardown(true);
            Object.Destroy(spawner.gameObject);
            yield return null;
        }

        [UnityTest]
        public IEnumerator TypedDeathEmitsOneUnidentifiedRecoveryAndCleansTargets()
        {
            ReaverbotCatalog catalog = LoadCatalog();
            ReaverbotSpawner spawner = CreateSpawner(catalog, null);
            ReaverbotRuntimeController enemy = spawner.SpawnSharukurusuStyle(Vector3.zero, Quaternion.identity);
            int defeatedCount = 0;
            int recoveryCount = 0;
            UnidentifiedReaverbotRecovery emitted = null;
            spawner.EnemyDefeated += (_, recovery) =>
            {
                defeatedCount += 1;
                emitted = recovery;
            };
            spawner.RecoverySpawned += (_, _) => recoveryCount += 1;
            yield return null;

            DamageResult result = enemy.Health.ApplyDamage(new DamagePacket(
                100000d,
                "playmode:kill:0",
                "playmode-buster",
                1));

            Assert.That(result.TargetDied, Is.True);
            Assert.That(defeatedCount, Is.EqualTo(1));
            Assert.That(recoveryCount, Is.EqualTo(1));
            Assert.That(emitted, Is.Not.Null);
            Assert.That(emitted.DisplayName, Is.EqualTo("Unidentified Reaverbot Recovery"));
            Assert.That(emitted.Candidates.Count, Is.GreaterThanOrEqualTo(5));
            Assert.That(spawner.ActiveRecoveryCount, Is.EqualTo(1));

            enemy.Tick(2f);
            yield return null;
            Assert.That(spawner.ActiveCount, Is.EqualTo(0));
            Assert.That(defeatedCount, Is.EqualTo(1));
            spawner.Teardown(true);
            Object.Destroy(spawner.gameObject);
            yield return null;
        }

        [UnityTest]
        public IEnumerator RangedGenomeUsesSharedProjectileAndTypedPlayerHealth()
        {
            ReaverbotCatalog catalog = LoadCatalog();
            GameObject player = CreatePlayerTarget(out HealthComponent playerHealth);
            var spawnerObject = new GameObject("ReaverbotSpawner_Test");
            ReaverbotSpawner spawner = spawnerObject.AddComponent<ReaverbotSpawner>();
            spawner.ConfigureCatalog(catalog, null, player.transform);
            var request = new ReaverbotSpawnRequest
            {
                runSeed = "ranged-runtime",
                encounterId = "range",
                slotIndex = 1,
                threatTier = 3,
                encounterSize = 2,
                archetypeId = "artillery",
                bodyPlanId = "tripod",
                weaponId = "pulseCannon",
            };
            ReaverbotRuntimeController enemy = spawner.SpawnEncounterSlot(
                request,
                Vector3.zero,
                Quaternion.identity);
            player.transform.position = new Vector3(0f, 0f, 5f);
            yield return null;

            double before = playerHealth.Snapshot.Current;
            Assert.That(enemy.TryExecuteAttackImmediately(), Is.True);
            float timeout = 1.5f;
            while (playerHealth.Snapshot.Current >= before && timeout > 0f)
            {
                timeout -= Time.deltaTime;
                yield return null;
            }

            Assert.That(playerHealth.Snapshot.Current, Is.LessThan(before));
            Assert.That(playerHealth.Snapshot.Current,
                Is.EqualTo(before - enemy.Genome.Stats.Damage).Within(0.01d));
            spawner.Teardown(true);
            Object.Destroy(spawner.gameObject);
            Object.Destroy(player);
            yield return null;
        }

        [UnityTest]
        public IEnumerator TeardownRemovesAllActiveAndRetainedRuntimeObjects()
        {
            ReaverbotCatalog catalog = LoadCatalog();
            ReaverbotSpawner spawner = CreateSpawner(catalog, null);
            for (int index = 0; index < 6; index += 1)
            {
                spawner.SpawnEncounterSlot(new ReaverbotSpawnRequest
                {
                    runSeed = "cleanup",
                    encounterId = "room",
                    slotIndex = index,
                    threatTier = 1 + index % 4,
                    encounterSize = 6,
                }, new Vector3(index * 2f, 0f, 0f), Quaternion.identity);
            }
            yield return null;

            Assert.That(spawner.ActiveCount, Is.EqualTo(6));
            spawner.Teardown(true);
            yield return null;
            Assert.That(spawner.ActiveCount, Is.Zero);
            Assert.That(spawner.PooledCount, Is.Zero);
            Object.Destroy(spawner.gameObject);
            yield return null;
            Assert.That(Object.FindObjectsByType<ReaverbotRuntimeController>(), Is.Empty);
        }

        private static ReaverbotSpawner CreateSpawner(ReaverbotCatalog catalog, Transform target)
        {
            var spawnerObject = new GameObject("ReaverbotSpawner_Test");
            ReaverbotSpawner spawner = spawnerObject.AddComponent<ReaverbotSpawner>();
            spawner.ConfigureCatalog(catalog, null, target);
            return spawner;
        }

        private static GameObject CreatePlayerTarget(out HealthComponent health)
        {
            var player = new GameObject("PlayerTarget_Test");
            player.SetActive(false);
            player.tag = "Player";
            int playerLayer = LayerMask.NameToLayer("Player");
            if (playerLayer >= 0) player.layer = playerLayer;
            BoxCollider collider = player.AddComponent<BoxCollider>();
            collider.center = Vector3.up;
            collider.size = new Vector3(1f, 2f, 1f);
            Transform aim = new GameObject("PlayerAim").transform;
            aim.SetParent(player.transform, false);
            aim.localPosition = Vector3.up;
            health = player.AddComponent<HealthComponent>();
            health.Configure(160f, 0f, false);
            CombatTargetComponent target = player.AddComponent<CombatTargetComponent>();
            target.Configure(
                "player.body",
                "player.body",
                "MegaMan",
                health,
                aim,
                CombatTargetKind.Body,
                null,
                0.7f);
            player.SetActive(true);
            return player;
        }

        [UnityTest]
        public IEnumerator RecoveryPickupRemainsLiveUntilDurableCommitAcceptsIt()
        {
            var pickupObject = new GameObject("RecoveryCommitRetry");
            ReaverbotSalvagePickup pickup = pickupObject.AddComponent<ReaverbotSalvagePickup>();
            var recovery = new UnidentifiedReaverbotRecovery(
                "retry-recovery",
                "retry-genome",
                "retry-spawn",
                Array.Empty<ReaverbotSalvageCandidate>());
            int attempts = 0;
            pickup.Configure(
                recovery,
                Vector3.zero,
                null,
                (_, __) => ++attempts >= 2);

            Assert.That(pickup.Collect(), Is.False);
            Assert.That(pickup.IsLive, Is.True);
            Assert.That(pickup.Recovery, Is.SameAs(recovery));
            Assert.That(pickup.Collect(), Is.True);
            Assert.That(pickup.IsLive, Is.False);
            Assert.That(pickup.Recovery, Is.Null);
            Assert.That(attempts, Is.EqualTo(2));

            Object.Destroy(pickupObject);
            yield return null;
        }

        private static ReaverbotCatalog LoadCatalog()
        {
            string path = Path.GetFullPath(Path.Combine(
                Application.dataPath,
                "..",
                "..",
                "..",
                "assets",
                "contracts",
                "ruin-crawler-contracts.v1.json"));
            Assert.That(File.Exists(path), Is.True, path);
            return ReaverbotContractLoader.LoadJson(File.ReadAllText(path));
        }
    }
}
