using System;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Runtime.Persistence;
using UnityEngine;

namespace RuinCrawler.Runtime.Contracts
{
    [DefaultExecutionOrder(-900)]
    public sealed class UnityContractCatalogProvider : MonoBehaviour
    {
        [SerializeField] private TextAsset contractPack;
        [SerializeField] private bool quarantineLoadedUnknownIds = true;

        public static UnityContractCatalogProvider Instance { get; private set; }
        public UnityContractCatalog Catalog { get; private set; }
        public TextAsset ContractPack => contractPack;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }

            Instance = this;
            DontDestroyOnLoad(gameObject);
            Load();
        }

        private void Start()
        {
            if (!quarantineLoadedUnknownIds || Catalog == null || CampaignSession.Instance == null)
            {
                return;
            }

            CampaignStateV1 before = CampaignSession.Instance.Snapshot;
            CampaignStateV1 after = CampaignStateRepair.QuarantineUnknownIds(
                before,
                Catalog.CreateKnownIdSet(),
                DateTime.UtcNow.ToString("O"));
            if (!string.Equals(JsonUtility.ToJson(before), JsonUtility.ToJson(after), StringComparison.Ordinal))
            {
                CampaignSession.Instance.Commit("quarantine-unknown-catalog-ids", after);
            }
        }

        private void OnDestroy()
        {
            if (Instance == this)
            {
                Instance = null;
            }
        }

        public void Load()
        {
            if (contractPack == null)
            {
                Debug.LogError("[RuinCrawler Contracts] Contract TextAsset is not assigned.", this);
                Catalog = null;
                return;
            }

            try
            {
                Catalog = UnityContractCatalog.Parse(contractPack.text);
            }
            catch (Exception exception)
            {
                Catalog = null;
                Debug.LogError("[RuinCrawler Contracts] " + exception.Message, this);
            }
        }

        public void Configure(TextAsset asset)
        {
            contractPack = asset;
            Load();
        }
    }
}
