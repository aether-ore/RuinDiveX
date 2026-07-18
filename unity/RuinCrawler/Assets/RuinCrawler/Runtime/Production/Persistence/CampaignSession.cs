using System;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Core.Foundation;
using UnityEngine;

namespace RuinCrawler.Runtime.Persistence
{
    [DefaultExecutionOrder(-1000)]
    public sealed class CampaignSession : MonoBehaviour
    {
        [SerializeField] private string saveContextId = "campaign-main";
        [SerializeField] private bool loadOnAwake = true;

        private ICampaignEnvelopeStore<CampaignStateV1> _store;
        private CampaignEnvelopeV1<CampaignStateV1> _envelope;

        public static CampaignSession Instance { get; private set; }
        public event Action<CampaignStateV1, string> StateChanged;
        public event Action<string> PersistenceWarning;

        public CampaignStateV1 Snapshot => (_envelope?.State ?? CampaignStateV1.CreateDefault(saveContextId)).Clone();
        public CampaignRevisionToken Revision => _envelope?.RevisionToken ?? CampaignRevisionToken.NewCampaign(saveContextId);
        public bool HasDurableState => _envelope != null;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }

            Instance = this;
            DontDestroyOnLoad(gameObject);
            // ConfigureStoreForTests may inject an isolated store while this
            // component is still inactive, before Unity invokes Awake.
            _store ??= new JsonCampaignEnvelopeStore();
            if (loadOnAwake)
            {
                LoadOrCreate();
            }
        }

        private void OnDestroy()
        {
            if (Instance == this)
            {
                Instance = null;
            }
        }

        public void ConfigureStoreForTests(ICampaignEnvelopeStore<CampaignStateV1> store)
        {
            _store = store ?? throw new ArgumentNullException(nameof(store));
            _envelope = null;
        }

        public CampaignLoadResult<CampaignStateV1> LoadOrCreate()
        {
            CampaignLoadResult<CampaignStateV1> result = _store.Load(saveContextId);
            if (result.HasState)
            {
                _envelope = result.Envelope;
                V2OnlyCampaignStateResult normalized =
                    V2OnlyCampaignStatePolicy.Normalize(_envelope.State);
                string loadWarning = AppendWarning(result.Warning, normalized.Warning);
                if (normalized.Changed)
                {
                    CampaignCommitResult<CampaignStateV1> rewrite = Commit(
                        "normalize-v2-only-dungeon-state",
                        normalized.State);
                    if (!rewrite.Success)
                    {
                        // Gameplay must not remain locked to an incompatible
                        // dungeon merely because its cleanup could not be
                        // persisted. Retain the repaired state in memory and
                        // surface the durable-write failure separately.
                        _envelope = new CampaignEnvelopeV1<CampaignStateV1>(
                            result.Envelope.SaveContextId,
                            result.Envelope.Revision,
                            result.Envelope.WriteId,
                            result.Envelope.UpdatedAtUtc,
                            normalized.State);
                        loadWarning = AppendWarning(
                            loadWarning,
                            "The dungeon reset could not be written yet; the reset remains applied for this session.");
                    }
                }

                if (!string.IsNullOrEmpty(loadWarning))
                {
                    Warn(loadWarning);
                }

                StateChanged?.Invoke(Snapshot, "load");
                return new CampaignLoadResult<CampaignStateV1>(
                    result.Status,
                    _envelope,
                    loadWarning);
            }

            if (result.Status != CampaignLoadStatus.NotFound)
            {
                Warn(result.Warning ?? "Campaign load failed.");
                return result;
            }

            CampaignStateV1 initial = CampaignStateRepair.Repair(CampaignStateV1.CreateDefault(saveContextId));
            CampaignCommitResult<CampaignStateV1> created = Commit("create-campaign", initial);
            if (!created.Success)
            {
                Warn(created.Message ?? "Campaign creation failed.");
                return new CampaignLoadResult<CampaignStateV1>(CampaignLoadStatus.Failure, warning: created.Message);
            }

            return new CampaignLoadResult<CampaignStateV1>(CampaignLoadStatus.Loaded, created.Envelope);
        }

        public CampaignCommitResult<CampaignStateV1> Commit(string operation, CampaignStateV1 nextState)
        {
            if (_store == null)
            {
                _store = new JsonCampaignEnvelopeStore();
            }

            CampaignRevisionToken expected = _envelope?.RevisionToken ?? CampaignRevisionToken.NewCampaign(saveContextId);
            CampaignStateV1 repaired = CampaignStateRepair.Repair(
                nextState?.Clone() ?? CampaignStateV1.CreateDefault(saveContextId));
            V2OnlyCampaignStateResult normalized = V2OnlyCampaignStatePolicy.Normalize(repaired);
            if (!string.IsNullOrEmpty(normalized.Warning))
            {
                Warn(normalized.Warning);
            }

            var request = new CampaignCommitRequest<CampaignStateV1>(
                operation,
                expected,
                Guid.NewGuid().ToString("N"),
                DateTime.UtcNow.ToString("O"),
                normalized.State);
            CampaignCommitResult<CampaignStateV1> result = _store.Commit(request);
            if (result.Success)
            {
                _envelope = result.Envelope;
                StateChanged?.Invoke(Snapshot, operation);
            }
            else
            {
                Warn(result.Message ?? ("Campaign commit failed: " + result.Failure + "."));
            }

            return result;
        }

        public WorkshopTransactionResult IdentifyAll()
        {
            return Apply("roll-identify-all", RollWorkshopService.IdentifyAll(Snapshot));
        }

        public WorkshopTransactionResult Fabricate(WorkshopRecipeV1 recipe)
        {
            WorkshopTransactionResult planned = RollWorkshopService.Fabricate(
                Snapshot,
                recipe,
                Guid.NewGuid().ToString("N"),
                DateTime.UtcNow.ToString("O"));
            return Apply("roll-fabricate:" + recipe?.recipeId, planned);
        }

        public WorkshopTransactionResult Equip(string kind, string slotId, string itemId, bool isSafeArea)
        {
            return Apply(
                "roll-equip:" + kind + ":" + slotId,
                RollWorkshopService.Equip(Snapshot, kind, slotId, itemId, isSafeArea));
        }

        public WorkshopTransactionResult SelectBossHunt(string profileId, bool profileExists)
        {
            return Apply(
                "roll-select-hunt:" + profileId,
                RollWorkshopService.SelectBossHunt(Snapshot, profileId, profileExists));
        }

        /// <summary>
        /// Ends the durable expedition without granting rewards. The selected
        /// Boss Hunt is preserved, while its selection lock and transient run
        /// source are cleared by the same idempotent core transaction used by
        /// a normal return to Camp.
        /// </summary>
        public WorkshopTransactionResult AbandonActiveExpedition()
        {
            CampaignStateV1 state = Snapshot;
            string expeditionId = state.bossHunts?.activeExpeditionId;
            return Apply(
                "roll-abandon-expedition:" + (expeditionId ?? "none"),
                RollWorkshopService.ReturnToCamp(state, expeditionId));
        }

        private WorkshopTransactionResult Apply(string operation, WorkshopTransactionResult planned)
        {
            if (!planned.Success || !planned.Changed)
            {
                return planned;
            }

            CampaignCommitResult<CampaignStateV1> commit = Commit(operation, planned.State);
            return commit.Success
                ? WorkshopTransactionResult.Succeeded(
                    commit.Envelope.State.Clone(),
                    changed: true,
                    idempotentReplay: planned.IdempotentReplay,
                    processedRecoveries: planned.ProcessedRecoveries,
                    scrapStored: planned.ScrapStored,
                    partsStored: planned.PartsStored)
                : WorkshopTransactionResult.Failed(Snapshot, "save-failed", commit.Message);
        }

        private void Warn(string warning)
        {
            Debug.LogWarning("[RuinCrawler Save] " + warning);
            PersistenceWarning?.Invoke(warning);
        }

        private static string AppendWarning(string primary, string secondary)
        {
            if (string.IsNullOrWhiteSpace(primary))
            {
                return string.IsNullOrWhiteSpace(secondary) ? null : secondary.Trim();
            }

            return string.IsNullOrWhiteSpace(secondary)
                ? primary.Trim()
                : primary.Trim() + " " + secondary.Trim();
        }
    }
}
