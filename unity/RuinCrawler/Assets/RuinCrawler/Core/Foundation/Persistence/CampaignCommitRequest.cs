namespace RuinCrawler.Core.Foundation
{
    /// <summary>
    /// Complete input to one atomic campaign commit. Write id and timestamp are
    /// supplied by the adapter, keeping the pure transaction planner free from
    /// clocks, random UUIDs, and filesystem concerns.
    /// </summary>
    public sealed class CampaignCommitRequest<TState>
    {
        public string Operation { get; }
        public CampaignRevisionToken ExpectedRevision { get; }
        public string NextWriteId { get; }
        public string UpdatedAtUtc { get; }
        public TState NextState { get; }

        public CampaignCommitRequest(
            string operation,
            CampaignRevisionToken expectedRevision,
            string nextWriteId,
            string updatedAtUtc,
            TState nextState)
        {
            Operation = CampaignValidation.RequireText(operation, nameof(operation));
            if (string.IsNullOrEmpty(expectedRevision.SaveContextId))
            {
                throw new System.ArgumentException("Expected revision token is required.", nameof(expectedRevision));
            }

            ExpectedRevision = expectedRevision;
            NextWriteId = CampaignValidation.RequireText(nextWriteId, nameof(nextWriteId));
            UpdatedAtUtc = CampaignValidation.RequireText(updatedAtUtc, nameof(updatedAtUtc));
            CampaignValidation.RequireState(nextState, nameof(nextState));
            NextState = nextState;
        }
    }
}
