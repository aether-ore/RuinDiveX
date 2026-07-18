using System;

namespace RuinCrawler.Core.Foundation
{
    /// <summary>
    /// Scene-neutral target state. Unity adapters publish updated aim points
    /// rather than leaking Transform references into deterministic systems.
    /// </summary>
    public sealed class CombatTargetDescriptor
    {
        public CombatTargetId TargetId { get; }
        public CombatTargetId OwnerId { get; }
        public string DisplayName { get; }
        public string PartLabel { get; }
        public CombatTargetKind Kind { get; }
        public DoubleVector3 AimPoint { get; }
        public double LockRadius { get; }
        public bool IsActive { get; }
        public bool IsDead { get; }
        public bool RetainLockWhenInactive { get; }
        public CombatTargetId? FallbackTargetId { get; }

        public bool IsTargetable => IsActive && !IsDead;
        public bool IsLockRetainable => !IsDead && (IsActive || RetainLockWhenInactive);

        public CombatTargetDescriptor(
            CombatTargetId targetId,
            CombatTargetId ownerId,
            string displayName,
            CombatTargetKind kind,
            DoubleVector3 aimPoint,
            double lockRadius,
            bool isActive = true,
            bool isDead = false,
            bool retainLockWhenInactive = false,
            CombatTargetId? fallbackTargetId = null,
            string partLabel = null)
        {
            if (targetId.IsEmpty)
            {
                throw new ArgumentException("Target id cannot be the default value.", nameof(targetId));
            }

            if (ownerId.IsEmpty)
            {
                throw new ArgumentException("Owner id cannot be the default value.", nameof(ownerId));
            }

            if (string.IsNullOrWhiteSpace(displayName))
            {
                throw new ArgumentException("A display name is required.", nameof(displayName));
            }

            if (!Enum.IsDefined(typeof(CombatTargetKind), kind))
            {
                throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unknown combat target kind.");
            }

            DoubleVector3.RequireFinite(lockRadius, nameof(lockRadius));
            if (lockRadius < 0d)
            {
                throw new ArgumentOutOfRangeException(nameof(lockRadius), lockRadius, "Lock radius cannot be negative.");
            }

            if (fallbackTargetId.HasValue && fallbackTargetId.Value.IsEmpty)
            {
                throw new ArgumentException("Fallback target id cannot be the default value.", nameof(fallbackTargetId));
            }

            TargetId = targetId;
            OwnerId = ownerId;
            DisplayName = displayName.Trim();
            PartLabel = string.IsNullOrWhiteSpace(partLabel) ? null : partLabel.Trim();
            Kind = kind;
            AimPoint = aimPoint;
            LockRadius = lockRadius;
            IsActive = isActive;
            IsDead = isDead;
            RetainLockWhenInactive = retainLockWhenInactive;
            FallbackTargetId = fallbackTargetId;
        }

        public CombatTargetDescriptor WithAimPoint(DoubleVector3 aimPoint)
        {
            return Copy(aimPoint: aimPoint);
        }

        public CombatTargetDescriptor WithState(bool isActive, bool isDead)
        {
            return Copy(isActive: isActive, isDead: isDead);
        }

        private CombatTargetDescriptor Copy(
            DoubleVector3? aimPoint = null,
            bool? isActive = null,
            bool? isDead = null)
        {
            return new CombatTargetDescriptor(
                TargetId,
                OwnerId,
                DisplayName,
                Kind,
                aimPoint ?? AimPoint,
                LockRadius,
                isActive ?? IsActive,
                isDead ?? IsDead,
                RetainLockWhenInactive,
                FallbackTargetId,
                PartLabel);
        }
    }
}
