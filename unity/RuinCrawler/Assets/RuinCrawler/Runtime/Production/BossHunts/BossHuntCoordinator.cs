using System;
using System.Collections.Generic;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Runtime.Reaverbots;
using UnityEngine;

namespace RuinCrawler.Runtime.BossHunts
{
    [DefaultExecutionOrder(-250)]
    public sealed class BossHuntCoordinator : MonoBehaviour
    {
        [SerializeField] private TextAsset contractPack;
        [SerializeField] private ReaverbotSpawner reaverbotSpawner;
        [SerializeField] private Transform combatTarget;
        [SerializeField] private MonoBehaviour[] authoredAdapterComponents;

        private readonly List<IBossEncounterAdapter> authoredAdapters = new List<IBossEncounterAdapter>();
        private BossHuntCatalog catalog;
        private IBossEncounterAdapter activeAdapter;
        private BossSpawnProduct activeProduct;
        private GameObject runtimeHost;

        public BossHuntCatalog Catalog => catalog;
        public BossHuntRuntimeController ActiveEncounter { get; private set; }
        public bool HasActiveEncounter => ActiveEncounter != null;

        public void Configure(
            TextAsset sourceContractPack,
            ReaverbotSpawner sourceSpawner,
            Transform sourceCombatTarget = null,
            IEnumerable<IBossEncounterAdapter> sourceAuthoredAdapters = null)
        {
            if (sourceContractPack == null) throw new ArgumentNullException(nameof(sourceContractPack));
            ConfigureCatalog(
                BossHuntCatalog.Parse(sourceContractPack),
                sourceSpawner,
                sourceCombatTarget,
                sourceAuthoredAdapters);
            contractPack = sourceContractPack;
        }

        public void ConfigureCatalog(
            BossHuntCatalog sourceCatalog,
            ReaverbotSpawner sourceSpawner,
            Transform sourceCombatTarget = null,
            IEnumerable<IBossEncounterAdapter> sourceAuthoredAdapters = null)
        {
            if (HasActiveEncounter) throw new InvalidOperationException("Reset the active boss before reconfiguring Boss Hunts.");
            catalog = sourceCatalog ?? throw new ArgumentNullException(nameof(sourceCatalog));
            reaverbotSpawner = sourceSpawner != null ? sourceSpawner : throw new ArgumentNullException(nameof(sourceSpawner));
            combatTarget = sourceCombatTarget;
            authoredAdapters.Clear();
            if (sourceAuthoredAdapters != null)
            {
                foreach (IBossEncounterAdapter adapter in sourceAuthoredAdapters)
                {
                    if (adapter != null) authoredAdapters.Add(adapter);
                }
            }
            AppendSerializedAdapters();
        }

        public BossHuntRuntimeController Spawn(
            BossHuntSpawnContext context,
            Vector3 position,
            Quaternion rotation)
        {
            if (HasActiveEncounter) throw new InvalidOperationException("A Boss Hunt encounter is already active.");
            EnsureConfigured();
            BossHuntSpawnPlan plan = BossHuntSpawnPlan.Create(catalog, context);
            var command = new BossSpawnCommand(plan, position, rotation, combatTarget);
            activeAdapter = SelectAdapter(plan.Profile) ?? new GeneratedReaverbotBossAdapter(reaverbotSpawner, catalog.StatScales);
            activeProduct = activeAdapter.Spawn(command);

            runtimeHost = new GameObject("BossHuntRuntime_" + plan.Profile.Id);
            runtimeHost.transform.SetParent(transform, false);
            ActiveEncounter = runtimeHost.AddComponent<BossHuntRuntimeController>();
            ActiveEncounter.Initialize(plan, activeProduct);
            if (activeProduct.PresentationFallback)
            {
                Debug.LogWarning(
                    "[RuinCrawler Boss Hunt] " + plan.Profile.Id
                    + " requires authored geometry/controller adapter '" + plan.Profile.EncounterControllerId
                    + "'; constrained generated presentation is active for graybox play.",
                    this);
            }
            return ActiveEncounter;
        }

        public BossHuntRuntimeController SpawnSelected(
            CampaignStateV1 campaign,
            Vector3 position,
            Quaternion rotation,
            int threatTier = 8)
            => Spawn(BossHuntSpawnContext.FromCampaign(campaign, threatTier), position, rotation);

        public BossVictoryResolution Resolve(
            CampaignStateV1 campaign,
            string committedAtUtc)
        {
            if (ActiveEncounter == null)
            {
                return new BossVictoryResolution(
                    null,
                    RuinCrawler.Core.Campaign.WorkshopTransactionResult.Failed(
                        campaign,
                        "boss-encounter-missing",
                        "There is no active Boss Hunt encounter to resolve."));
            }
            return ActiveEncounter.Resolve(campaign, committedAtUtc);
        }

        public bool AcknowledgeCommittedResolution(
            BossVictoryResolution resolution,
            CampaignStateV1 committedCampaign)
            => ActiveEncounter != null
                && ActiveEncounter.AcknowledgeCommittedResolution(resolution, committedCampaign);

        public void ResetEncounter()
        {
            if (ActiveEncounter != null) ActiveEncounter.Shutdown();
            if (activeAdapter != null && activeProduct != null)
            {
                try
                {
                    activeAdapter.Reset(activeProduct);
                }
                catch (Exception exception)
                {
                    Debug.LogException(exception, this);
                }
            }
            if (runtimeHost != null) Destroy(runtimeHost);
            ActiveEncounter = null;
            runtimeHost = null;
            activeAdapter = null;
            activeProduct = null;
        }

        private void Awake()
        {
            if (catalog == null && contractPack != null && reaverbotSpawner != null)
            {
                Configure(contractPack, reaverbotSpawner, combatTarget);
            }
        }

        private void OnDestroy() => ResetEncounter();

        private void EnsureConfigured()
        {
            if (catalog != null && reaverbotSpawner != null) return;
            if (contractPack == null || reaverbotSpawner == null)
                throw new InvalidOperationException("BossHuntCoordinator requires a contract pack and ReaverbotSpawner.");
            Configure(contractPack, reaverbotSpawner, combatTarget);
        }

        private IBossEncounterAdapter SelectAdapter(BossHuntProfile profile)
        {
            for (int index = 0; index < authoredAdapters.Count; index += 1)
            {
                IBossEncounterAdapter adapter = authoredAdapters[index];
                if (adapter != null && adapter.CanHandle(profile)) return adapter;
            }
            return null;
        }

        private void AppendSerializedAdapters()
        {
            foreach (MonoBehaviour component in authoredAdapterComponents ?? Array.Empty<MonoBehaviour>())
            {
                if (component is IBossEncounterAdapter adapter && !authoredAdapters.Contains(adapter))
                    authoredAdapters.Add(adapter);
            }
        }
    }
}
