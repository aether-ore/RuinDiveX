using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Foundation
{
    /// <summary>
    /// Immutable description of one authoritative damage attempt. Amount is
    /// already inclusive of attack-specific multipliers; armor is resolved by
    /// the receiver so simulation and production share the same formula.
    /// </summary>
    public sealed class DamagePacket
    {
        public double Amount { get; }
        public string ExecutionId { get; }
        public string SourceId { get; }
        public long BuildRevision { get; }
        public string HitPartId { get; }
        public double ArmorPierce { get; }
        public double Stagger { get; }
        public bool IsCritical { get; }
        public DamageElement Element { get; }
        public DoubleVector3 Knockback { get; }
        public bool SuppressRewards { get; }
        public string DamageDomain { get; }
        public IReadOnlyList<string> HazardTags { get; }
        public string ReactionEnvelopeId { get; }

        public DamagePacket(
            double amount,
            string executionId,
            string sourceId = null,
            long buildRevision = 0,
            string hitPartId = null,
            double armorPierce = 0d,
            double stagger = 0d,
            bool isCritical = false,
            DamageElement element = DamageElement.Neutral,
            DoubleVector3 knockback = default,
            bool suppressRewards = false,
            string damageDomain = null,
            IEnumerable<string> hazardTags = null,
            string reactionEnvelopeId = null)
        {
            DoubleVector3.RequireFinite(amount, nameof(amount));
            if (amount < 0d)
            {
                throw new ArgumentOutOfRangeException(nameof(amount), amount, "Damage amount cannot be negative.");
            }

            if (string.IsNullOrWhiteSpace(executionId))
            {
                throw new ArgumentException("A stable execution id is required.", nameof(executionId));
            }

            if (buildRevision < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(buildRevision), buildRevision, "Build revision cannot be negative.");
            }

            if (double.IsNaN(armorPierce) || double.IsNegativeInfinity(armorPierce) || armorPierce < 0d)
            {
                throw new ArgumentOutOfRangeException(nameof(armorPierce), armorPierce, "Armor pierce must be non-negative and may be positive infinity.");
            }

            DoubleVector3.RequireFinite(stagger, nameof(stagger));
            if (stagger < 0d)
            {
                throw new ArgumentOutOfRangeException(nameof(stagger), stagger, "Stagger cannot be negative.");
            }

            if (!Enum.IsDefined(typeof(DamageElement), element))
            {
                throw new ArgumentOutOfRangeException(nameof(element), element, "Unknown damage element.");
            }

            Amount = amount;
            ExecutionId = executionId.Trim();
            SourceId = NormalizeOptionalId(sourceId);
            BuildRevision = buildRevision;
            HitPartId = NormalizeOptionalId(hitPartId);
            ArmorPierce = armorPierce;
            Stagger = stagger;
            IsCritical = isCritical;
            Element = element;
            Knockback = knockback;
            SuppressRewards = suppressRewards;
            DamageDomain = NormalizeOptionalId(damageDomain);
            ReactionEnvelopeId = NormalizeOptionalId(reactionEnvelopeId);
            HazardTags = NormalizeTags(hazardTags);
        }

        private static IReadOnlyList<string> NormalizeTags(IEnumerable<string> values)
        {
            var result = new List<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            if (values != null)
            {
                foreach (string value in values)
                {
                    string normalized = NormalizeOptionalId(value);
                    if (normalized != null && seen.Add(normalized))
                    {
                        result.Add(normalized);
                    }
                }
            }

            result.Sort(StringComparer.Ordinal);
            return Array.AsReadOnly(result.ToArray());
        }

        private static string NormalizeOptionalId(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        }
    }
}
