using System;

namespace RuinCrawler.Core.Foundation
{
    public readonly struct DamageMitigationDecision
    {
        private DamageMitigationDecision(
            DamageApplicationDisposition disposition,
            string reasonId)
        {
            if (disposition != DamageApplicationDisposition.Immune
                && disposition != DamageApplicationDisposition.Suppressed)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(disposition),
                    disposition,
                    "Mitigation may only make a packet immune or suppressed.");
            }

            Disposition = disposition;
            ReasonId = string.IsNullOrWhiteSpace(reasonId) ? null : reasonId.Trim();
        }

        public DamageApplicationDisposition Disposition { get; }
        public string ReasonId { get; }

        public static DamageMitigationDecision Immune(string reasonId)
        {
            return new DamageMitigationDecision(DamageApplicationDisposition.Immune, reasonId);
        }

        public static DamageMitigationDecision Suppressed(string reasonId)
        {
            return new DamageMitigationDecision(DamageApplicationDisposition.Suppressed, reasonId);
        }
    }

    /// <summary>
    /// Typed seam for fixed-function gear, environmental rules, and other
    /// pre-armor packet suppression. Policies never mutate health directly.
    /// </summary>
    public interface IDamageMitigationPolicy
    {
        bool TryMitigate(DamagePacket packet, out DamageMitigationDecision decision);
    }
}
