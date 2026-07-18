namespace RuinCrawler.Core.Foundation
{
    /// <summary>
    /// Persistence seam. A later Application.persistentDataPath adapter owns
    /// JSON, temporary files, backup restoration, locking, and quarantine.
    /// </summary>
    public interface ICampaignEnvelopeStore<TState>
    {
        CampaignLoadResult<TState> Load(string saveContextId);

        CampaignCommitResult<TState> Commit(CampaignCommitRequest<TState> request);
    }
}
