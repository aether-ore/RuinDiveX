namespace RuinCrawler.Core.Foundation
{
    public enum DamageApplicationDisposition
    {
        Applied = 0,
        Duplicate = 1,
        Immune = 2,
        Suppressed = 3,
        AlreadyDead = 4,
        ZeroDamage = 5
    }

    /// <summary>
    /// Outcome of applying a packet to health. MitigatedDamage preserves the
    /// source combat number even on overkill; HealthDamage is the clamped loss
    /// of health and is safe for persistence or reward accounting.
    /// </summary>
    public sealed class DamageResult
    {
        public DamagePacket Packet { get; }
        public double EffectiveArmor { get; }
        public double MitigatedDamage { get; }
        public double HealthDamage { get; }
        public double HealthBefore { get; }
        public double HealthAfter { get; }
        public bool WasAlreadyDead { get; }
        public bool TargetDied { get; }
        public DamageApplicationDisposition Disposition { get; }
        public string MitigationReasonId { get; }

        public bool WasApplied => Disposition == DamageApplicationDisposition.Applied && HealthDamage > 0d;
        public bool WasDuplicate => Disposition == DamageApplicationDisposition.Duplicate;
        public bool WasImmune => Disposition == DamageApplicationDisposition.Immune;

        internal DamageResult(
            DamagePacket packet,
            double effectiveArmor,
            double mitigatedDamage,
            double healthDamage,
            double healthBefore,
            double healthAfter,
            bool wasAlreadyDead,
            bool targetDied,
            DamageApplicationDisposition disposition = DamageApplicationDisposition.Applied,
            string mitigationReasonId = null)
        {
            Packet = packet;
            EffectiveArmor = effectiveArmor;
            MitigatedDamage = mitigatedDamage;
            HealthDamage = healthDamage;
            HealthBefore = healthBefore;
            HealthAfter = healthAfter;
            WasAlreadyDead = wasAlreadyDead;
            TargetDied = targetDied;
            Disposition = disposition;
            MitigationReasonId = mitigationReasonId;
        }

        internal static DamageResult NotApplied(
            DamagePacket packet,
            HealthSnapshot snapshot,
            DamageApplicationDisposition disposition,
            string reasonId = null)
        {
            return new DamageResult(
                packet,
                0d,
                0d,
                0d,
                snapshot.Current,
                snapshot.Current,
                disposition == DamageApplicationDisposition.AlreadyDead,
                false,
                disposition,
                reasonId);
        }
    }
}
