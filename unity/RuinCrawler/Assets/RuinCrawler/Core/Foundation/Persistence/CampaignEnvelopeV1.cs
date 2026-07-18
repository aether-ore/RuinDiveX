using System;

namespace RuinCrawler.Core.Foundation
{
    /// <summary>
    /// Serialization-neutral Unity campaign envelope. Runtime state such as
    /// active projectiles, health, locks, and generated GameObjects must not be
    /// placed in TState.
    /// </summary>
    public sealed class CampaignEnvelopeV1<TState>
    {
        public const int CurrentSchemaVersion = 2;

        public int SchemaVersion => CurrentSchemaVersion;
        public string SaveContextId { get; }
        public long Revision { get; }
        public string WriteId { get; }
        public string UpdatedAtUtc { get; }
        public TState State { get; }
        public CampaignRevisionToken RevisionToken =>
            new CampaignRevisionToken(SaveContextId, Revision, WriteId);

        public CampaignEnvelopeV1(
            string saveContextId,
            long revision,
            string writeId,
            string updatedAtUtc,
            TState state)
        {
            SaveContextId = CampaignValidation.RequireContextId(saveContextId, nameof(saveContextId));
            if (revision <= 0)
            {
                throw new ArgumentOutOfRangeException(nameof(revision), revision, "A durable envelope revision must be greater than zero.");
            }

            Revision = revision;
            WriteId = CampaignValidation.RequireText(writeId, nameof(writeId));
            UpdatedAtUtc = CampaignValidation.RequireText(updatedAtUtc, nameof(updatedAtUtc));
            CampaignValidation.RequireState(state, nameof(state));
            State = state;
        }
    }
}
