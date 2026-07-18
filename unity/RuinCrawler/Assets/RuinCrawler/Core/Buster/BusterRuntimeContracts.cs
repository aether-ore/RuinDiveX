using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Buster
{
    public static class WeaponFireBlockReasons
    {
        public const string NoPlan = "NO_PLAN";
        public const string Firing = "FIRING";
        public const string Cycle = "CYCLE";
        public const string Recovery = "RECOVERY";
        public const string ProjectileCap = "PROJECTILE_CAP";
        public const string Energy = "ENERGY";
        public const string SpawnRejected = "SPAWN_REJECTED";
    }

    public sealed class WeaponFireRequest
    {
        private WeaponFireRequest(bool ok, string reason, bool recoveryLocked)
        {
            Ok = ok;
            Reason = reason;
            RecoveryLocked = recoveryLocked;
        }

        public bool Ok { get; }
        public string Reason { get; }
        public bool RecoveryLocked { get; }

        internal static WeaponFireRequest Accepted()
        {
            return new WeaponFireRequest(true, null, false);
        }

        internal static WeaponFireRequest Rejected(string reason, bool recoveryLocked = false)
        {
            return new WeaponFireRequest(false, reason, recoveryLocked);
        }
    }

    public sealed class ProjectileReservation
    {
        internal ProjectileReservation(string token, string weaponKey, int count)
        {
            Token = token;
            WeaponKey = weaponKey;
            Count = count;
        }

        public string Token { get; }
        public string WeaponKey { get; }
        public int Count { get; }
    }

    public sealed class WeaponExecution
    {
        internal WeaponExecution(
            string executionId,
            ProjectileReservation reservation,
            CompiledBusterPlan plan,
            object context)
        {
            ExecutionId = executionId;
            ReservationToken = reservation.Token;
            WeaponKey = reservation.WeaponKey;
            BuildId = plan.BuildId;
            BuildRevision = plan.BuildRevision;
            ReservedProjectileCount = reservation.Count;
            Plan = plan;
            Context = context;
        }

        public string ExecutionId { get; }
        public string ReservationToken { get; }
        public string WeaponKey { get; }
        public string BuildId { get; }
        public int BuildRevision { get; }
        public int ReservedProjectileCount { get; }
        public CompiledBusterPlan Plan { get; }
        public object Context { get; }
    }

    public sealed class WeaponExecutionCancellation
    {
        internal WeaponExecutionCancellation(ProjectileReservation reservation, string reason)
        {
            ReservationToken = reservation.Token;
            WeaponKey = reservation.WeaponKey;
            ReservedProjectileCount = reservation.Count;
            Reason = reason;
        }

        public string ReservationToken { get; }
        public string WeaponKey { get; }
        public int ReservedProjectileCount { get; }
        public string Reason { get; }
    }

    public delegate bool WeaponShotExecutor(WeaponExecution execution);

    public delegate void WeaponExecutionCanceller(WeaponExecutionCancellation cancellation);

    public sealed class WeaponFireResult
    {
        private WeaponFireResult(
            bool ok,
            string reason,
            bool recoveryLocked,
            WeaponExecution execution)
        {
            Ok = ok;
            Reason = reason;
            RecoveryLocked = recoveryLocked;
            Execution = execution;
        }

        public bool Ok { get; }
        public string Reason { get; }
        public bool RecoveryLocked { get; }
        public WeaponExecution Execution { get; }

        internal static WeaponFireResult Accepted(WeaponExecution execution)
        {
            return new WeaponFireResult(true, null, false, execution);
        }

        internal static WeaponFireResult Rejected(string reason, bool recoveryLocked = false)
        {
            return new WeaponFireResult(false, reason, recoveryLocked, null);
        }

        internal static WeaponFireResult FromRequest(WeaponFireRequest request)
        {
            return request.Ok
                ? throw new ArgumentException("An accepted request must be committed as an execution.", nameof(request))
                : Rejected(request.Reason, request.RecoveryLocked);
        }
    }

    public sealed class BusterBatterySnapshot
    {
        internal BusterBatterySnapshot(
            string weaponKey,
            double energy,
            double maximumEnergy,
            double cycleRemaining,
            double rechargeDelayRemaining,
            object lastContext,
            bool recoveryLocked,
            bool firing)
        {
            WeaponKey = weaponKey;
            Energy = energy;
            MaximumEnergy = maximumEnergy;
            CycleRemaining = cycleRemaining;
            RechargeDelayRemaining = rechargeDelayRemaining;
            LastContext = lastContext;
            RecoveryLocked = recoveryLocked;
            Firing = firing;
        }

        public string WeaponKey { get; }
        public double Energy { get; }
        public double MaximumEnergy { get; }
        public double MaxEnergy => MaximumEnergy;
        public double CycleRemaining { get; }
        public double RechargeDelayRemaining { get; }
        public object LastContext { get; }
        public bool RecoveryLocked { get; }
        public bool Firing { get; }
    }

    public sealed class BusterRuntimeResourceSnapshot
    {
        internal BusterRuntimeResourceSnapshot(
            string activeWeaponKey,
            IEnumerable<BusterBatterySnapshot> batteries)
        {
            ActiveWeaponKey = activeWeaponKey;
            Batteries = Array.AsReadOnly(
                new List<BusterBatterySnapshot>(batteries ?? Array.Empty<BusterBatterySnapshot>()).ToArray());
        }

        public string ActiveWeaponKey { get; }
        public IReadOnlyList<BusterBatterySnapshot> Batteries { get; }
    }

    public sealed class WeaponTelemetry
    {
        internal WeaponTelemetry(
            string weaponKey,
            string buildId,
            int buildRevision,
            double energy,
            double maximumEnergy,
            double energyCost,
            double cycleRemaining,
            double rechargeDelayRemaining,
            bool recoveryLocked,
            bool ready,
            string blockReason,
            int reservedProjectiles,
            int projectileCapacity)
        {
            WeaponKey = weaponKey;
            BuildId = buildId;
            BuildRevision = buildRevision;
            Energy = energy;
            MaximumEnergy = maximumEnergy;
            EnergyPercent = maximumEnergy > 0d ? energy / maximumEnergy : 0d;
            EnergyCost = energyCost;
            ShotsRemaining = energyCost > 0d
                ? Math.Max(0, (int)Math.Floor((energy + BusterRuntime.ResourceEpsilon) / energyCost))
                : 0;
            CycleRemaining = cycleRemaining;
            RechargeDelayRemaining = rechargeDelayRemaining;
            RecoveryLocked = recoveryLocked;
            Ready = ready;
            BlockReason = blockReason;
            Status = ready ? "READY" : blockReason;
            ReservedProjectiles = reservedProjectiles;
            ProjectileCapacity = projectileCapacity;
        }

        public string WeaponKey { get; }
        public string BuildId { get; }
        public int BuildRevision { get; }
        public double Energy { get; }
        public double MaximumEnergy { get; }
        public double MaxEnergy => MaximumEnergy;
        public double EnergyPercent { get; }
        public double EnergyCost { get; }
        public int ShotsRemaining { get; }
        public double CycleRemaining { get; }
        public double RechargeDelayRemaining { get; }
        public bool RecoveryLocked { get; }
        public bool Ready { get; }
        public string BlockReason { get; }
        public string Status { get; }
        public int ReservedProjectiles { get; }
        public int ProjectileCapacity { get; }
    }

    public interface IWeaponRuntime
    {
        string ActiveWeaponKey { get; }
        int ProjectileCapacity { get; }
        int ReservedProjectileCount { get; }

        BusterBatterySnapshot Equip(CompiledBusterPlan plan);
        BusterBatterySnapshot Register(CompiledBusterPlan plan);
        bool CanFire(string weaponKey = null);
        WeaponFireRequest RequestFire(string weaponKey = null);
        WeaponFireResult Fire(object context = null, string weaponKey = null);
        void Update(double elapsedSeconds);
        void Update(double elapsedSeconds, string activeWeaponKey);
        bool ReleaseReservation(string reservationToken);
        WeaponTelemetry GetTelemetry(string weaponKey = null);
    }
}
