using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Buster.ProjectileKernel
{
    public static class BusterProjectileKernelRules
    {
        public const double EventEpsilon = 0.000001d;
        public const double GuidanceStepSeconds = 1d / 120d;
        public const int MaximumEventsPerFrame = 256;
        public const double GuidanceStrength = 4.2d;
        public const double PulseProjectileRadius = 0.17d;
        public const double MortarProjectileRadius = 0.22d;
        public const double DefaultTargetRadius = 0.42d;
        public const double DefaultTargetCollisionHeight = 1.8d;
        public const double DefaultGuidanceAimHeight = 0.99d;
    }

    public sealed class BusterProjectileTargetSnapshot
    {
        public BusterProjectileTargetSnapshot(
            string stableId,
            BusterVector3 position,
            double radius = BusterProjectileKernelRules.DefaultTargetRadius,
            double collisionHeight = BusterProjectileKernelRules.DefaultTargetCollisionHeight,
            BusterVector3? aimPoint = null,
            bool active = true,
            bool dead = false,
            bool hasWeakPoint = false,
            BusterVector3? weakPoint = null,
            double weakPointRadius = 0.24d)
        {
            if (string.IsNullOrWhiteSpace(stableId))
            {
                throw new ArgumentException("A projectile target requires a stable ID.", nameof(stableId));
            }

            StableId = stableId;
            Position = position;
            Radius = Math.Max(0d, FiniteOr(radius, BusterProjectileKernelRules.DefaultTargetRadius));
            CollisionHeight = Math.Max(0d, FiniteOr(
                collisionHeight,
                BusterProjectileKernelRules.DefaultTargetCollisionHeight));
            AimPoint = aimPoint ?? (position + new BusterVector3(
                0d,
                BusterProjectileKernelRules.DefaultGuidanceAimHeight,
                0d));
            Active = active;
            Dead = dead;
            HasWeakPoint = hasWeakPoint;
            WeakPoint = weakPoint ?? AimPoint;
            WeakPointRadius = Math.Max(0d, FiniteOr(weakPointRadius, 0.24d));
        }

        public string StableId { get; }
        public BusterVector3 Position { get; }
        public double Radius { get; }
        public double CollisionHeight { get; }
        public BusterVector3 AimPoint { get; }
        public bool Active { get; }
        public bool Dead { get; }
        public bool HasWeakPoint { get; }
        public BusterVector3 WeakPoint { get; }
        public double WeakPointRadius { get; }

        private static double FiniteOr(double value, double fallback)
        {
            return double.IsNaN(value) || double.IsInfinity(value) ? fallback : value;
        }
    }

    public sealed class BusterProjectileExecutionRequest
    {
        public BusterProjectileExecutionRequest(
            string executionId,
            BusterVector3 origin,
            BusterVector3 direction,
            BusterVector3 aimPoint,
            string reservationToken = null,
            string lockedTargetId = null)
        {
            if (string.IsNullOrWhiteSpace(executionId))
            {
                throw new ArgumentException("A projectile execution requires a stable ID.", nameof(executionId));
            }

            ExecutionId = executionId;
            ReservationToken = reservationToken;
            Origin = origin;
            Direction = direction.Normalized(BusterVector3.Forward);
            AimPoint = aimPoint;
            LockedTargetId = lockedTargetId;
        }

        public string ExecutionId { get; }
        public string ReservationToken { get; }
        public BusterVector3 Origin { get; }
        public BusterVector3 Direction { get; }
        public BusterVector3 AimPoint { get; }
        public string LockedTargetId { get; }
    }

    public enum BusterProjectileEventKind
    {
        ProjectileSpawn,
        GuidanceTarget,
        ChildTrigger,
        DirectHit,
        ExplosionHit,
        Explosion,
        RangeEnd,
        Disposed
    }

    /// <summary>
    /// Immutable event emitted by the deterministic kernel. Build identity is copied at shot
    /// creation so a later compiler revision cannot reinterpret an in-flight execution.
    /// </summary>
    public sealed class BusterProjectileEventRecord
    {
        internal BusterProjectileEventRecord(
            BusterProjectileEventKind kind,
            double time,
            int sortPriority,
            long stableSequence,
            string executionId,
            string reservationToken,
            string weaponKey,
            string buildId,
            int buildRevision,
            string projectileId,
            int projectileIndex,
            string actionId,
            string scope,
            string targetId,
            string reason,
            BusterVector3 position,
            BusterVector3 direction,
            double power,
            string payloadType,
            bool weakPoint)
        {
            Kind = kind;
            Time = time;
            SortPriority = sortPriority;
            StableSequence = stableSequence;
            ExecutionId = executionId;
            ReservationToken = reservationToken;
            WeaponKey = weaponKey;
            BuildId = buildId;
            BuildRevision = buildRevision;
            ProjectileId = projectileId;
            ProjectileIndex = projectileIndex;
            ActionId = actionId;
            Scope = scope;
            TargetId = targetId;
            Reason = reason;
            Position = position;
            Direction = direction;
            Power = Math.Max(0d, FiniteOr(power, 0d));
            PayloadType = payloadType;
            WeakPoint = weakPoint;
        }

        public BusterProjectileEventKind Kind { get; }
        public string Type => GetTypeName(Kind);
        public double Time { get; }
        internal int SortPriority { get; }
        internal long StableSequence { get; }
        public string ExecutionId { get; }
        public string ReservationToken { get; }
        public string WeaponKey { get; }
        public string BuildId { get; }
        public int BuildRevision { get; }
        public string ProjectileId { get; }
        public int ProjectileIndex { get; }
        public string ActionId { get; }
        public string Scope { get; }
        public string TargetId { get; }
        public string Reason { get; }
        public BusterVector3 Position { get; }
        public BusterVector3 Direction { get; }
        public double Power { get; }
        public string PayloadType { get; }
        public bool WeakPoint { get; }

        private static string GetTypeName(BusterProjectileEventKind kind)
        {
            switch (kind)
            {
                case BusterProjectileEventKind.ProjectileSpawn:
                    return "projectile-spawn";
                case BusterProjectileEventKind.GuidanceTarget:
                    return "guidance-target";
                case BusterProjectileEventKind.ChildTrigger:
                    return "child-trigger";
                case BusterProjectileEventKind.DirectHit:
                    return "direct-hit";
                case BusterProjectileEventKind.ExplosionHit:
                    return "explosion-hit";
                case BusterProjectileEventKind.Explosion:
                    return "explosion";
                case BusterProjectileEventKind.RangeEnd:
                    return "range-end";
                case BusterProjectileEventKind.Disposed:
                    return "disposed";
                default:
                    return kind.ToString();
            }
        }

        private static double FiniteOr(double value, double fallback)
        {
            return double.IsNaN(value) || double.IsInfinity(value) ? fallback : value;
        }
    }

    public sealed class BusterPacketBudget
    {
        internal BusterPacketBudget(
            double effectivePower,
            double carrierDamagePower,
            int terminalProjectileCount,
            double perTerminalProjectilePower,
            double terminalProjectilePower)
        {
            EffectivePower = Math.Max(0d, effectivePower);
            CarrierDamagePower = Math.Max(0d, carrierDamagePower);
            TerminalProjectileCount = Math.Max(0, terminalProjectileCount);
            PerTerminalProjectilePower = Math.Max(0d, perTerminalProjectilePower);
            TerminalProjectilePower = Math.Max(0d, terminalProjectilePower);
            TotalAllocatedPower = CarrierDamagePower + TerminalProjectilePower;
            ConservationDelta = TotalAllocatedPower - EffectivePower;
            IsConserved = Math.Abs(ConservationDelta) <= 0.000000001d;
        }

        public double EffectivePower { get; }
        public double CarrierDamagePower { get; }
        public int TerminalProjectileCount { get; }
        public double PerTerminalProjectilePower { get; }
        public double TerminalProjectilePower { get; }
        public double TotalAllocatedPower { get; }
        public double ConservationDelta { get; }
        public bool IsConserved { get; }
    }

    public sealed class BusterProjectileAdvanceResult
    {
        internal BusterProjectileAdvanceResult(
            double frameStart,
            double frameEnd,
            int activeProjectileCount,
            bool complete,
            IEnumerable<BusterProjectileEventRecord> events)
        {
            FrameStart = frameStart;
            FrameEnd = frameEnd;
            ActiveProjectileCount = activeProjectileCount;
            Complete = complete;
            Events = Array.AsReadOnly(
                new List<BusterProjectileEventRecord>(events ?? Array.Empty<BusterProjectileEventRecord>())
                    .ToArray());
        }

        public double FrameStart { get; }
        public double FrameEnd { get; }
        public int ActiveProjectileCount { get; }
        public bool Complete { get; }
        public IReadOnlyList<BusterProjectileEventRecord> Events { get; }
    }

    public sealed class BusterProjectileExecutionSnapshot
    {
        internal BusterProjectileExecutionSnapshot(
            string executionId,
            string weaponKey,
            string buildId,
            int buildRevision,
            double elapsedSeconds,
            bool complete,
            int activeProjectileCount,
            BusterPacketBudget packetBudget,
            IEnumerable<BusterProjectileEventRecord> events)
        {
            ExecutionId = executionId;
            WeaponKey = weaponKey;
            BuildId = buildId;
            BuildRevision = buildRevision;
            ElapsedSeconds = elapsedSeconds;
            Complete = complete;
            ActiveProjectileCount = activeProjectileCount;
            PacketBudget = packetBudget;
            Events = Array.AsReadOnly(
                new List<BusterProjectileEventRecord>(events ?? Array.Empty<BusterProjectileEventRecord>())
                    .ToArray());
        }

        public string ExecutionId { get; }
        public string WeaponKey { get; }
        public string BuildId { get; }
        public int BuildRevision { get; }
        public double ElapsedSeconds { get; }
        public bool Complete { get; }
        public int ActiveProjectileCount { get; }
        public BusterPacketBudget PacketBudget { get; }
        public IReadOnlyList<BusterProjectileEventRecord> Events { get; }
    }
}
