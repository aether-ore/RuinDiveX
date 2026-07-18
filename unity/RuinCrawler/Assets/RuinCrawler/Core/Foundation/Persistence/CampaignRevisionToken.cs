using System;

namespace RuinCrawler.Core.Foundation
{
    /// <summary>
    /// Optimistic-concurrency token. A revision-zero token without a write id
    /// represents a campaign that has not been durably created yet.
    /// </summary>
    public readonly struct CampaignRevisionToken : IEquatable<CampaignRevisionToken>
    {
        public string SaveContextId { get; }
        public long Revision { get; }
        public string WriteId { get; }
        public bool IsNewCampaign => Revision == 0 && string.IsNullOrEmpty(WriteId);

        public CampaignRevisionToken(string saveContextId, long revision, string writeId)
        {
            SaveContextId = CampaignValidation.RequireContextId(saveContextId, nameof(saveContextId));
            if (revision < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(revision), revision, "Revision cannot be negative.");
            }

            if (revision > 0 && string.IsNullOrWhiteSpace(writeId))
            {
                throw new ArgumentException("A committed revision requires a write id.", nameof(writeId));
            }

            Revision = revision;
            WriteId = string.IsNullOrWhiteSpace(writeId) ? null : writeId.Trim();
        }

        public static CampaignRevisionToken NewCampaign(string saveContextId)
        {
            return new CampaignRevisionToken(saveContextId, 0, null);
        }

        public bool Equals(CampaignRevisionToken other)
        {
            return string.Equals(SaveContextId, other.SaveContextId, StringComparison.Ordinal)
                && Revision == other.Revision
                && string.Equals(WriteId, other.WriteId, StringComparison.Ordinal);
        }

        public override bool Equals(object obj)
        {
            return obj is CampaignRevisionToken other && Equals(other);
        }

        public override int GetHashCode()
        {
            unchecked
            {
                int hash = SaveContextId == null ? 0 : StringComparer.Ordinal.GetHashCode(SaveContextId);
                hash = (hash * 397) ^ Revision.GetHashCode();
                hash = (hash * 397) ^ (WriteId == null ? 0 : StringComparer.Ordinal.GetHashCode(WriteId));
                return hash;
            }
        }

        public static bool operator ==(CampaignRevisionToken left, CampaignRevisionToken right)
        {
            return left.Equals(right);
        }

        public static bool operator !=(CampaignRevisionToken left, CampaignRevisionToken right)
        {
            return !left.Equals(right);
        }
    }
}
