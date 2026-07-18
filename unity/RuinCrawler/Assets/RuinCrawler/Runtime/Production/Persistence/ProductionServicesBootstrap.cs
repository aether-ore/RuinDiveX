using RuinCrawler.Runtime.Contracts;
using UnityEngine;

namespace RuinCrawler.Runtime.Persistence
{
    [DefaultExecutionOrder(-1200)]
    public sealed class ProductionServicesBootstrap : MonoBehaviour
    {
        [SerializeField] private TextAsset contractPack;

        public void Configure(TextAsset contracts)
        {
            contractPack = contracts;
        }

        private void Awake()
        {
            if (CampaignSession.Instance == null)
            {
                var services = new GameObject("RuinCrawler.PersistentServices");
                services.SetActive(false);
                services.AddComponent<CampaignSession>();
                UnityContractCatalogProvider provider = services.AddComponent<UnityContractCatalogProvider>();
                provider.Configure(contractPack);
                services.AddComponent<ExpeditionFlowController>();
                DontDestroyOnLoad(services);
                services.SetActive(true);
                return;
            }

            GameObject existingServices = CampaignSession.Instance.gameObject;
            if (UnityContractCatalogProvider.Instance == null)
            {
                UnityContractCatalogProvider provider = existingServices.AddComponent<UnityContractCatalogProvider>();
                provider.Configure(contractPack);
            }

            if (ExpeditionFlowController.Instance == null)
            {
                existingServices.AddComponent<ExpeditionFlowController>();
            }
        }
    }
}
