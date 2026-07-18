namespace RuinCrawler.Core.Foundation
{
    public enum CampaignLoadStatus
    {
        Loaded = 0,
        NotFound = 1,
        RecoveredBackup = 2,
        Corrupt = 3,
        UnsupportedSchema = 4,
        Failure = 5
    }

    public sealed class CampaignLoadResult<TState>
    {
        public CampaignLoadStatus Status { get; }
        public CampaignEnvelopeV1<TState> Envelope { get; }
        public string Warning { get; }

        public bool HasState => Envelope != null;

        public CampaignLoadResult(
            CampaignLoadStatus status,
            CampaignEnvelopeV1<TState> envelope = null,
            string warning = null)
        {
            Status = status;
            Envelope = envelope;
            Warning = string.IsNullOrWhiteSpace(warning) ? null : warning.Trim();
        }
    }
}
