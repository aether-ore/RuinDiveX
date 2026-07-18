using System;
using RuinCrawler.Runtime.Combat;
using RuinCrawler.Runtime.Reaverbots;
using UnityEngine;

namespace RuinCrawler.Runtime.BossHunts
{
    /// <summary>
    /// Adapter seam for boss profiles whose authored controller or geometry
    /// requires deliberate pivots and mechanics. Implementations may be scene
    /// components; the coordinator receives them as this interface and keeps
    /// reward/phase/persistence contracts independent of their presentation.
    /// </summary>
    public interface IBossEncounterAdapter
    {
        bool CanHandle(BossHuntProfile profile);
        BossSpawnProduct Spawn(BossSpawnCommand command);
        void Reset(BossSpawnProduct product);
    }

    public sealed class BossSpawnCommand
    {
        public BossSpawnCommand(
            BossHuntSpawnPlan plan,
            Vector3 position,
            Quaternion rotation,
            Transform combatTarget)
        {
            Plan = plan ?? throw new ArgumentNullException(nameof(plan));
            Position = position;
            Rotation = rotation;
            CombatTarget = combatTarget;
        }
        public BossHuntSpawnPlan Plan { get; }
        public Vector3 Position { get; }
        public Quaternion Rotation { get; }
        public Transform CombatTarget { get; }
    }

    public sealed class BossSpawnProduct
    {
        public BossSpawnProduct(
            GameObject root,
            HealthComponent health,
            string stableBossId,
            ReaverbotRuntimeController generatedRuntime = null,
            bool presentationFallback = false)
        {
            Root = root != null ? root : throw new ArgumentNullException(nameof(root));
            Health = health != null ? health : throw new ArgumentNullException(nameof(health));
            StableBossId = string.IsNullOrWhiteSpace(stableBossId)
                ? throw new ArgumentException("A stable boss id is required.", nameof(stableBossId))
                : stableBossId;
            GeneratedRuntime = generatedRuntime;
            PresentationFallback = presentationFallback;
        }
        public GameObject Root { get; }
        public HealthComponent Health { get; }
        public string StableBossId { get; }
        public ReaverbotRuntimeController GeneratedRuntime { get; }
        public bool PresentationFallback { get; }
    }

    internal sealed class GeneratedReaverbotBossAdapter : IBossEncounterAdapter
    {
        private readonly ReaverbotSpawner spawner;
        private readonly BossStatScales statScales;

        public GeneratedReaverbotBossAdapter(ReaverbotSpawner spawner, BossStatScales statScales)
        {
            this.spawner = spawner != null ? spawner : throw new ArgumentNullException(nameof(spawner));
            this.statScales = statScales ?? throw new ArgumentNullException(nameof(statScales));
        }

        public bool CanHandle(BossHuntProfile profile) => profile != null;

        public BossSpawnProduct Spawn(BossSpawnCommand command)
        {
            ReaverbotRuntimeController runtime = spawner.SpawnEncounterSlot(
                command.Plan.Request,
                command.Position,
                command.Rotation);
            runtime.SetTarget(command.CombatTarget);
            runtime.SetRecoverySuppressed(true);

            float maximum = (float)Math.Max(
                1d,
                runtime.Genome.Stats.MaxHealth * command.Plan.Profile.HealthScale);
            float armor = (float)Math.Max(0d, runtime.Genome.Stats.Armor * statScales.Armor);
            runtime.Health.Configure(maximum, armor, false);
            runtime.ConfigureCombatScales(statScales.Damage, statScales.Cooldown);
            runtime.ConfigureAutomaticDespawn(false);
            runtime.transform.localScale = Vector3.one * (float)Math.Max(0.1d, statScales.Visual);

            bool fallback = command.Plan.Profile.RequiresAuthoredAdapter;
            return new BossSpawnProduct(
                runtime.gameObject,
                runtime.Health,
                command.Plan.Request.StableSpawnId,
                runtime,
                fallback);
        }

        public void Reset(BossSpawnProduct product)
        {
            if (spawner != null && product?.GeneratedRuntime != null)
            {
                spawner.CancelProjectilesBySource(product.StableBossId);
                spawner.Despawn(product.GeneratedRuntime);
            }
        }
    }
}
