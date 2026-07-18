using System;
using System.Collections.Generic;
using RuinCrawler.Core.Buster;
using RuinCrawler.Core.Foundation;
using RuinCrawler.Port.Porting;
using UnityEngine;

namespace RuinCrawler.Runtime.Combat
{
    /// <summary>
    /// Unity adapter for the pure weapon runtime. The neutral Mega Buster is a
    /// real compiled plan and its battery is the HUD's only energy source.
    /// </summary>
    public sealed class MegaBusterWeaponController : MonoBehaviour, IPlayerWeapon
    {
        [SerializeField] private ProductionProjectilePool projectilePool;
        [SerializeField, Range(1, 10)] private int power = 4;
        [SerializeField, Range(1, 10)] private int energy = 4;
        [SerializeField, Range(1, 10)] private int range = 4;
        [SerializeField, Range(1, 10)] private int rapid = 4;
        [SerializeField, Min(0.01f)] private float projectileRadius = SourceGameplayContract.MegaBusterRadius;

        private readonly Dictionary<string, CompletionGroup> activeExecutions =
            new Dictionary<string, CompletionGroup>(StringComparer.Ordinal);
        private BusterRuntime runtime;
        private CompiledBusterPlan plan;

        public BusterRuntime Runtime => runtime;
        public CompiledBusterPlan Plan => plan;

        public WeaponTelemetrySnapshot Telemetry
        {
            get
            {
                if (runtime == null || plan == null)
                {
                    return new WeaponTelemetrySnapshot(
                        "Mega Buster", 0d, 1d, 0, WeaponReadinessState.Recovery,
                        power, energy, range, rapid, 0);
                }

                WeaponTelemetry value = runtime.GetTelemetry();
                BusterTuning tuning = plan.SourceBuild.Tuning;
                return new WeaponTelemetrySnapshot(
                    plan.IsMegaBuster ? "Mega Buster" : plan.BuildId,
                    value?.Energy ?? 0d,
                    value?.MaximumEnergy ?? plan.Stats.MaxEnergy,
                    value?.ShotsRemaining ?? 0,
                    ResolveReadiness(value),
                    tuning.Power,
                    tuning.Energy,
                    tuning.Range,
                    tuning.Rapid,
                    plan.Stats.ProjectileCount);
            }
        }

        public void Configure(ProductionProjectilePool pool, BusterTuning tuning = null, int revision = 0)
        {
            projectilePool = pool;
            BusterTuning resolved = tuning ?? new BusterTuning(power, energy, range, rapid);
            power = resolved.Power;
            energy = resolved.Energy;
            range = resolved.Range;
            rapid = resolved.Rapid;
            InitializeRuntime(BusterCompiler.CompileMega(resolved, revision));
        }

        public void EquipPlan(CompiledBusterPlan compiledPlan)
        {
            if (compiledPlan == null)
            {
                throw new ArgumentNullException(nameof(compiledPlan));
            }

            InitializeRuntime(compiledPlan);
        }

        public bool TryFire(Vector3 origin, Vector3 direction)
        {
            if (runtime == null || projectilePool == null)
            {
                return false;
            }

            var context = new ShotContext(
                origin,
                direction.sqrMagnitude > 0.0001f ? direction.normalized : transform.forward);
            return runtime.Fire(context).Ok;
        }

        private void Awake()
        {
            if (projectilePool == null)
            {
                projectilePool = FindAnyObjectByType<ProductionProjectilePool>();
            }

            if (runtime == null)
            {
                Configure(projectilePool);
            }
        }

        private void Update()
        {
            runtime?.Update(Time.deltaTime);
        }

        private void OnDisable()
        {
            if (runtime != null && plan != null)
            {
                runtime.CancelBuild(plan.WeaponKey, "weapon-disabled");
            }
        }

        private void InitializeRuntime(CompiledBusterPlan compiledPlan)
        {
            if (runtime != null && plan != null)
            {
                runtime.CancelBuild(plan.WeaponKey, "plan-replaced");
            }

            plan = compiledPlan;
            runtime = new BusterRuntime(
                projectilePool != null ? projectilePool.Capacity : BusterRuleset.MaximumMovingProjectiles,
                executeShot: ExecuteShot,
                cancelExecution: CancelExecution);
            runtime.Equip(plan);
        }

        private bool ExecuteShot(WeaponExecution execution)
        {
            if (!(execution.Context is ShotContext context) || projectilePool == null)
            {
                return false;
            }

            BusterPacket packet = execution.Plan.Trigger == null
                ? execution.Plan.RootPacket
                : execution.Plan.ChildPacket;
            if (packet == null || packet.Count <= 0)
            {
                return false;
            }

            var leased = new List<ProductionProjectile>(packet.Count);
            for (int index = 0; index < packet.Count; index += 1)
            {
                ProductionProjectile projectile = projectilePool.Lease();
                if (projectile == null)
                {
                    for (int rollbackIndex = 0; rollbackIndex < leased.Count; rollbackIndex += 1)
                    {
                        projectilePool.Return(leased[rollbackIndex]);
                    }

                    return false;
                }

                leased.Add(projectile);
            }

            var group = new CompletionGroup(execution.ReservationToken, leased);
            activeExecutions[execution.ReservationToken] = group;
            for (int index = 0; index < leased.Count; index += 1)
            {
                Vector3 shotDirection = ResolvePatternDirection(
                    context.Direction,
                    execution.Plan.Splitter,
                    index,
                    leased.Count);
                var damage = new DamagePacket(
                    packet.DamagePower,
                    execution.ExecutionId + ":projectile:" + index,
                    execution.BuildId,
                    execution.BuildRevision,
                    stagger: packet.Stagger,
                    knockback: new DoubleVector3(shotDirection.x, shotDirection.y, shotDirection.z));
                leased[index].Initialize(
                    context.Origin,
                    shotDirection,
                    (float)packet.Speed,
                    projectileRadius,
                    (float)packet.Range,
                    damage,
                    _ => HandleProjectileFinished(execution.ReservationToken));
            }

            return true;
        }

        private void CancelExecution(WeaponExecutionCancellation cancellation)
        {
            if (!activeExecutions.TryGetValue(cancellation.ReservationToken, out CompletionGroup group))
            {
                return;
            }

            ProductionProjectile[] snapshot = group.Projectiles.ToArray();
            for (int index = 0; index < snapshot.Length; index += 1)
            {
                snapshot[index]?.Cancel();
            }

            activeExecutions.Remove(cancellation.ReservationToken);
        }

        private void HandleProjectileFinished(string reservationToken)
        {
            if (!activeExecutions.TryGetValue(reservationToken, out CompletionGroup group))
            {
                return;
            }

            group.Remaining -= 1;
            if (group.Remaining > 0)
            {
                return;
            }

            activeExecutions.Remove(reservationToken);
            runtime?.ReleaseReservation(reservationToken);
        }

        private static Vector3 ResolvePatternDirection(
            Vector3 forward,
            BusterSplitterConfiguration splitter,
            int index,
            int count)
        {
            Vector3 normalized = forward.sqrMagnitude > 0.0001f ? forward.normalized : Vector3.forward;
            if (splitter == null || count <= 1)
            {
                return normalized;
            }

            if (string.Equals(splitter.Pattern, "spread", StringComparison.Ordinal)
                && index < splitter.AngleOffsets.Count)
            {
                float degrees = (float)(splitter.AngleOffsets[index] * Mathf.Rad2Deg);
                return Quaternion.AngleAxis(degrees, Vector3.up) * normalized;
            }

            float radialAngle = 360f * index / count;
            Vector3 right = Vector3.Cross(Vector3.up, normalized);
            if (right.sqrMagnitude < 0.001f)
            {
                right = Vector3.right;
            }

            Vector3 radial = Quaternion.AngleAxis(radialAngle, normalized) * right.normalized;
            return (normalized * 0.92f + radial * 0.38f).normalized;
        }

        private static WeaponReadinessState ResolveReadiness(WeaponTelemetry telemetry)
        {
            if (telemetry == null || telemetry.Ready)
            {
                return WeaponReadinessState.Ready;
            }

            if (string.Equals(telemetry.BlockReason, WeaponFireBlockReasons.Cycle, StringComparison.Ordinal))
            {
                return WeaponReadinessState.Cycle;
            }

            if (string.Equals(telemetry.BlockReason, WeaponFireBlockReasons.Energy, StringComparison.Ordinal))
            {
                return WeaponReadinessState.Energy;
            }

            return WeaponReadinessState.Recovery;
        }

        private sealed class ShotContext
        {
            public ShotContext(Vector3 origin, Vector3 direction)
            {
                Origin = origin;
                Direction = direction;
            }

            public Vector3 Origin { get; }
            public Vector3 Direction { get; }
        }

        private sealed class CompletionGroup
        {
            public CompletionGroup(string reservationToken, List<ProductionProjectile> projectiles)
            {
                ReservationToken = reservationToken;
                Projectiles = projectiles;
                Remaining = projectiles.Count;
            }

            public string ReservationToken { get; }
            public List<ProductionProjectile> Projectiles { get; }
            public int Remaining { get; set; }
        }
    }
}
