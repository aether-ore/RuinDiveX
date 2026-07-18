namespace RuinCrawler.Core.Foundation
{
    /// <summary>
    /// Pure optimistic-concurrency step shared by save adapters and tests.
    /// It never writes; it only validates the expected token and prepares the
    /// next immutable envelope.
    /// </summary>
    public static class CampaignTransactions
    {
        public static CampaignCommitResult<TState> PrepareCommit<TState>(
            CampaignEnvelopeV1<TState> current,
            CampaignCommitRequest<TState> request)
        {
            if (request == null)
            {
                throw new System.ArgumentNullException(nameof(request));
            }

            CampaignRevisionToken expected = request.ExpectedRevision;
            if (current == null)
            {
                if (!expected.IsNewCampaign)
                {
                    return CampaignCommitResult<TState>.Failed(
                        CampaignCommitFailure.Conflict,
                        null,
                        "The campaign does not exist at the expected revision.");
                }

                return CampaignCommitResult<TState>.Succeeded(
                    new CampaignEnvelopeV1<TState>(
                        expected.SaveContextId,
                        1,
                        request.NextWriteId,
                        request.UpdatedAtUtc,
                        request.NextState));
            }

            if (current.RevisionToken != expected)
            {
                return CampaignCommitResult<TState>.Failed(
                    CampaignCommitFailure.Conflict,
                    current.RevisionToken,
                    "The campaign revision or write id changed before commit.");
            }

            if (string.Equals(current.WriteId, request.NextWriteId, System.StringComparison.Ordinal))
            {
                return CampaignCommitResult<TState>.Failed(
                    CampaignCommitFailure.InvalidState,
                    current.RevisionToken,
                    "Every durable commit requires a new write id.");
            }

            return CampaignCommitResult<TState>.Succeeded(
                new CampaignEnvelopeV1<TState>(
                    current.SaveContextId,
                    current.Revision + 1,
                    request.NextWriteId,
                    request.UpdatedAtUtc,
                    request.NextState));
        }
    }
}
