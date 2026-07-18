namespace RuinCrawler.Core.Foundation
{
    public enum CampaignCommitFailure
    {
        None = 0,
        ReadOnly = 1,
        Conflict = 2,
        InvalidState = 3,
        LockTimeout = 4,
        PersistenceFailure = 5,
        UnsupportedSchema = 6
    }

    public sealed class CampaignCommitResult<TState>
    {
        public bool Success { get; }
        public CampaignCommitFailure Failure { get; }
        public CampaignEnvelopeV1<TState> Envelope { get; }
        public CampaignRevisionToken? CurrentRevision { get; }
        public string Message { get; }

        private CampaignCommitResult(
            bool success,
            CampaignCommitFailure failure,
            CampaignEnvelopeV1<TState> envelope,
            CampaignRevisionToken? currentRevision,
            string message)
        {
            Success = success;
            Failure = failure;
            Envelope = envelope;
            CurrentRevision = currentRevision;
            Message = string.IsNullOrWhiteSpace(message) ? null : message.Trim();
        }

        public static CampaignCommitResult<TState> Succeeded(CampaignEnvelopeV1<TState> envelope)
        {
            if (envelope == null)
            {
                throw new System.ArgumentNullException(nameof(envelope));
            }

            return new CampaignCommitResult<TState>(
                true,
                CampaignCommitFailure.None,
                envelope,
                envelope.RevisionToken,
                null);
        }

        public static CampaignCommitResult<TState> Failed(
            CampaignCommitFailure failure,
            CampaignRevisionToken? currentRevision = null,
            string message = null)
        {
            if (failure == CampaignCommitFailure.None)
            {
                throw new System.ArgumentOutOfRangeException(nameof(failure), failure, "Failure reason cannot be None.");
            }

            return new CampaignCommitResult<TState>(
                false,
                failure,
                null,
                currentRevision,
                message);
        }
    }
}
