using System;
using System.Collections.Generic;
using System.Linq;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Runtime.Dungeon;
using RuinCrawler.Runtime.Persistence;
using RuinCrawler.Runtime.Player;
using UnityEngine;

namespace RuinCrawler.Runtime.Expedition
{
    /// <summary>
    /// Scene adapter for the pure campaign progression coordinator. The
    /// expedition controller only needs to configure this component with the
    /// accepted scene instance, subscribe to ExtractionRequested, and invoke
    /// TrySecureLargeRefractor when the shrine pickup resolves.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DungeonExpeditionProgressionRuntimeV2 : MonoBehaviour
    {
        private readonly List<DungeonDiscoveryTriggerRuntimeV2> discoveryTriggers =
            new List<DungeonDiscoveryTriggerRuntimeV2>();
        private DungeonSceneInstanceV2 scene;
        private IDungeonCampaignProgressionPortV2 campaign;
        private DungeonExpeditionProgressionCoordinatorV2 coordinator;
        private DungeonLargeRefractorPickupRuntimeV2 largeRefractorPickup;
        private DungeonExtractionTriggerRuntimeV2 extractionTrigger;
        private Action<DungeonEnvironmentSnapshotV2> environmentChanged;
        private bool committingShortcutDiscoveries;
        private int refractorSecuredFrame = -1;

        public event Action<DungeonProgressionOperationResultV2> DiscoveryProcessed;
        public event Action<DungeonProgressionOperationResultV2> FinalGuardianProcessed;
        public event Action<DungeonProgressionOperationResultV2> LargeRefractorProcessed;
        public event Action<DungeonExtractionRequestV2> ExtractionRequested;

        public DungeonExpeditionProgressionCoordinatorV2 Coordinator => coordinator;
        public IReadOnlyList<DungeonDiscoveryTriggerRuntimeV2> DiscoveryTriggers => discoveryTriggers;
        public DungeonLargeRefractorPickupRuntimeV2 LargeRefractorPickup => largeRefractorPickup;
        public DungeonExtractionTriggerRuntimeV2 ExtractionTrigger => extractionTrigger;
        public DungeonExtractionStateV2 ExtractionState => coordinator?.ExtractionState
            ?? DungeonExtractionStateV2.Inactive;

        public bool Configure(
            DungeonSceneInstanceV2 sceneInstance,
            CampaignSession session,
            out string error)
        {
            if (session == null)
            {
                error = "A CampaignSession is required.";
                return false;
            }

            return Configure(
                sceneInstance,
                new CampaignSessionDungeonProgressionPortV2(session),
                out error);
        }

        public bool Configure(
            DungeonSceneInstanceV2 sceneInstance,
            IDungeonCampaignProgressionPortV2 campaignPort,
            out string error)
        {
            UnbindCoordinator();
            discoveryTriggers.Clear();
            largeRefractorPickup = null;
            extractionTrigger = null;
            refractorSecuredFrame = -1;
            scene = sceneInstance;
            campaign = campaignPort;
            if (scene?.Plan == null || scene.Root == null || scene.Environment == null
                || scene.Minimap == null || campaign == null)
            {
                error = "A complete V2 scene instance and campaign port are required.";
                return false;
            }

            coordinator = new DungeonExpeditionProgressionCoordinatorV2(scene.Plan, campaign);
            if (coordinator.ExtractionState == DungeonExtractionStateV2.Inactive)
            {
                coordinator = null;
                error = "The durable expedition identity does not match the active V2 scene.";
                return false;
            }

            coordinator.ExtractionRequested += HandleExtractionRequested;
            RestoreRuntimeFacts();
            AttachDiscoveryTriggers();
            if (!AttachLargeRefractorPickup(out error))
            {
                Unbind();
                return false;
            }
            AttachExtractionTrigger();
            environmentChanged = _ =>
            {
                CommitActivatedShortcutDiscoveries();
                largeRefractorPickup?.RefreshAvailability();
            };
            scene.Environment.CommittedStateChanged += environmentChanged;
            largeRefractorPickup.RefreshAvailability();
            error = null;
            return true;
        }

        public DungeonProgressionOperationResultV2 TryDiscover(string discoveryId)
        {
            if (coordinator == null || scene?.Environment == null)
            {
                var unavailable = DungeonProgressionOperationResultV2.Failed(
                    campaign?.Snapshot,
                    "progression-runtime-unbound",
                    "The V2 progression runtime has not been configured.",
                    discoveryId);
                DiscoveryProcessed?.Invoke(unavailable);
                return unavailable;
            }

            DungeonProgressionOperationResultV2 result = coordinator.TryDiscover(
                discoveryId,
                scene.Environment.CapturePredicateState());
            if (result.Success)
            {
                ApplyRuntimeEffects(result.Command, includeCurrentExpeditionActivation: true);
                scene.Environment.AddDiscoveryFact(result.DiscoveryId);
                scene.Minimap.SurveyAnchor(result.Command.Discovery.LocationAnchorId);
            }

            DiscoveryProcessed?.Invoke(result);
            return result;
        }

        public DungeonProgressionOperationResultV2 TrySecureLargeRefractor(string resolvedAtUtc = null)
        {
            if (coordinator == null)
            {
                var unavailable = DungeonProgressionOperationResultV2.Failed(
                    campaign?.Snapshot,
                    "progression-runtime-unbound",
                    "The V2 progression runtime has not been configured.");
                LargeRefractorProcessed?.Invoke(unavailable);
                return unavailable;
            }

            DungeonProgressionOperationResultV2 result = coordinator.TrySecureLargeRefractor(
                string.IsNullOrWhiteSpace(resolvedAtUtc)
                    ? DateTime.UtcNow.ToString("O")
                    : resolvedAtUtc);
            if (result.Success && scene?.Environment != null)
            {
                scene.Environment.AddProgressionFact(
                    IndustrialFactoryV2Ruleset.ExtractionReadyFactId);
                if (result.Changed)
                {
                    refractorSecuredFrame = Time.frameCount;
                }
            }
            largeRefractorPickup?.RefreshAvailability();
            LargeRefractorProcessed?.Invoke(result);
            return result;
        }

        public DungeonProgressionOperationResultV2 TryMarkFinalGuardianDefeated()
        {
            if (coordinator == null || scene?.Environment == null)
            {
                var unavailable = DungeonProgressionOperationResultV2.Failed(
                    campaign?.Snapshot,
                    "progression-runtime-unbound",
                    "The V2 progression runtime has not been configured.");
                FinalGuardianProcessed?.Invoke(unavailable);
                return unavailable;
            }

            DungeonProgressionOperationResultV2 result =
                coordinator.TryMarkFinalGuardianDefeated();
            if (result.Success)
            {
                scene.Environment.AddProgressionFact(
                    IndustrialFactoryV2Ruleset.FinalEliteDefeatedFactId);
            }

            largeRefractorPickup?.RefreshAvailability();
            FinalGuardianProcessed?.Invoke(result);
            return result;
        }

        public DungeonExtractionAttemptResultV2 TryRequestExtraction()
        {
            if (coordinator == null)
            {
                return DungeonExtractionAttemptResultV2.Failed(
                    "progression-runtime-unbound",
                    "The V2 progression runtime has not been configured.");
            }

            if (refractorSecuredFrame >= 0 && Time.frameCount <= refractorSecuredFrame)
            {
                return DungeonExtractionAttemptResultV2.Failed(
                    "extraction-interaction-required",
                    "Step clear of the Large Refractor pedestal before activating extraction.");
            }

            return coordinator.TryRequestExtraction();
        }

        /// <summary>
        /// Releases all subscriptions to the transient scene instance. The
        /// production expedition controller calls this before tearing down or
        /// rebuilding a deterministic plan so an old environment cannot write
        /// into the next expedition.
        /// </summary>
        public void Unbind()
        {
            UnbindCoordinator();
            discoveryTriggers.Clear();
            largeRefractorPickup = null;
            extractionTrigger = null;
            scene = null;
            campaign = null;
            refractorSecuredFrame = -1;
        }

        private void OnDestroy()
        {
            UnbindCoordinator();
        }

        private void RestoreRuntimeFacts()
        {
            CampaignStateV1 state = CampaignStateRepair.Repair(campaign.Snapshot?.Clone());
            ActiveDungeonProgressV1 progress = state.expedition?.dungeonProgress;
            if (progress != null)
            {
                foreach (string requiredItemId in progress.requiredItemIds)
                {
                    scene.Environment.AddRequiredItem(requiredItemId);
                }

                foreach (string requiredFactId in progress.requiredFactIds)
                {
                    scene.Environment.AddProgressionFact(requiredFactId);
                }

                foreach (string shortcutId in progress.activatedShortcutIds)
                {
                    scene.Environment.ActivateShortcut(shortcutId);
                }

                if (progress.refractorSecured)
                {
                    scene.Environment.AddProgressionFact(
                        IndustrialFactoryV2Ruleset.ExtractionReadyFactId);
                }
            }

            foreach (DungeonDiscoveryPlanV2 discovery in scene.Plan.Discoveries)
            {
                if (!coordinator.IsDiscoveryClaimed(discovery.Id))
                {
                    continue;
                }

                scene.Environment.AddDiscoveryFact(discovery.Id);
                if (DungeonDiscoveryCommandMapperV2.TryMap(
                        scene.Plan,
                        discovery,
                        state,
                        out DungeonDiscoveryCommandV2 command,
                        out _,
                        out _))
                {
                    ApplyRuntimeEffects(command, includeCurrentExpeditionActivation: false);
                }
            }
        }

        private void ApplyRuntimeEffects(
            DungeonDiscoveryCommandV2 command,
            bool includeCurrentExpeditionActivation)
        {
            if (command?.RewardRequest?.Grant == null)
            {
                return;
            }

            ApplyRuntimeGrant(command.RewardRequest.Grant);
            if (includeCurrentExpeditionActivation
                && command.CurrentExpeditionActivationRequest?.Grant != null)
            {
                ApplyRuntimeGrant(command.CurrentExpeditionActivationRequest.Grant);
            }
        }

        private void ApplyRuntimeGrant(DungeonRewardGrantV1 grant)
        {
            if (grant == null)
            {
                return;
            }

            foreach (string requiredItemId in grant.RequiredItemIds)
            {
                scene.Environment.AddRequiredItem(requiredItemId);
            }

            foreach (string shortcutId in grant.CurrentExpeditionShortcutIds)
            {
                scene.Environment.ActivateShortcut(shortcutId);
            }
        }

        private void AttachDiscoveryTriggers()
        {
            Dictionary<string, DungeonAnchorRuntimeV2> anchors = scene.Root
                .GetComponentsInChildren<DungeonAnchorRuntimeV2>(true)
                .Where(value => !string.IsNullOrWhiteSpace(value.StableId))
                .ToDictionary(value => value.StableId, StringComparer.Ordinal);
            foreach (DungeonDiscoveryPlanV2 discovery in scene.Plan.Discoveries)
            {
                if (discovery.Kind == DungeonDiscoveryKindV2.Shortcut)
                {
                    continue;
                }

                if (!anchors.TryGetValue(discovery.LocationAnchorId, out DungeonAnchorRuntimeV2 anchor))
                {
                    continue;
                }

                string triggerName = "DiscoveryTrigger_" + discovery.Id;
                Transform child = anchor.transform.Find(triggerName);
                GameObject target = child != null ? child.gameObject : new GameObject(triggerName);
                if (child == null)
                {
                    target.transform.SetParent(anchor.transform, false);
                }

                // Unity objects that have been queued for destruction still hold a
                // managed reference, so the C# null-coalescing operator can return a
                // "fake null" component during a same-frame rebuild. Use Unity's
                // overloaded null comparison before touching the collider.
                SphereCollider collider = target.GetComponent<SphereCollider>();
                if (collider == null)
                {
                    collider = target.AddComponent<SphereCollider>();
                }
                collider.isTrigger = true;
                collider.radius = 1.25f;
                DungeonDiscoveryTriggerRuntimeV2 trigger =
                    target.GetComponent<DungeonDiscoveryTriggerRuntimeV2>()
                    ?? target.AddComponent<DungeonDiscoveryTriggerRuntimeV2>();
                trigger.Configure(this, discovery.Id, coordinator.IsDiscoveryClaimed(discovery.Id));
                discoveryTriggers.Add(trigger);
            }
        }

        private bool AttachLargeRefractorPickup(out string error)
        {
            DungeonAnchorRuntimeV2 anchor = scene.Root
                .GetComponentsInChildren<DungeonAnchorRuntimeV2>(true)
                .Where(value => string.Equals(
                    value.RegionId,
                    scene.Plan.ExtractionRegionId,
                    StringComparison.Ordinal))
                .Where(value => value.Kind == DungeonAnchorKindV2.Reward)
                .OrderBy(value => value.StableId, StringComparer.Ordinal)
                .FirstOrDefault();
            if (anchor == null)
            {
                error = "The machine-core extraction region has no reward anchor for the Large Refractor.";
                return false;
            }

            const string PickupName = "LargeRefractorPickupV2";
            Transform child = anchor.transform.Find(PickupName);
            if (child == null)
            {
                error = "The authored machine-core reward anchor is missing its Large Refractor presentation.";
                return false;
            }

            GameObject target = child.gameObject;
            SphereCollider collider = target.GetComponent<SphereCollider>();
            if (collider == null)
            {
                collider = target.AddComponent<SphereCollider>();
            }
            collider.isTrigger = true;
            collider.radius = 0.9f;
            largeRefractorPickup = target.GetComponent<DungeonLargeRefractorPickupRuntimeV2>()
                ?? target.AddComponent<DungeonLargeRefractorPickupRuntimeV2>();
            largeRefractorPickup.Configure(this, scene.Environment);
            error = null;
            return true;
        }

        private void AttachExtractionTrigger()
        {
            DungeonAnchorRuntimeV2 anchor = scene.Root
                .GetComponentsInChildren<DungeonAnchorRuntimeV2>(true)
                .Where(value => string.Equals(
                    value.RegionId,
                    scene.Plan.ExtractionRegionId,
                    StringComparison.Ordinal))
                .OrderBy(value => value.Kind == DungeonAnchorKindV2.Extraction ? 0
                    : value.Kind == DungeonAnchorKindV2.Exit ? 1 : 2)
                .ThenBy(value => value.StableId, StringComparer.Ordinal)
                .FirstOrDefault();
            if (anchor == null)
            {
                return;
            }

            const string TriggerName = "ExtractionTriggerV2";
            Transform child = anchor.transform.Find(TriggerName);
            GameObject target = child != null ? child.gameObject : new GameObject(TriggerName);
            if (child == null)
            {
                target.transform.SetParent(anchor.transform, false);
            }

            SphereCollider collider = target.GetComponent<SphereCollider>();
            if (collider == null)
            {
                collider = target.AddComponent<SphereCollider>();
            }
            collider.isTrigger = true;
            collider.radius = 1.5f;
            extractionTrigger = target.GetComponent<DungeonExtractionTriggerRuntimeV2>()
                ?? target.AddComponent<DungeonExtractionTriggerRuntimeV2>();
            extractionTrigger.Configure(this);
        }

        private void HandleExtractionRequested(DungeonExtractionRequestV2 request)
        {
            ExtractionRequested?.Invoke(request);
        }

        private void CommitActivatedShortcutDiscoveries()
        {
            if (committingShortcutDiscoveries
                || coordinator == null
                || scene?.Environment == null)
            {
                return;
            }

            committingShortcutDiscoveries = true;
            try
            {
                DungeonPredicateStateV2 state = scene.Environment.CapturePredicateState();
                foreach (DungeonDiscoveryPlanV2 discovery in scene.Plan.Discoveries
                             .Where(value => value.Kind == DungeonDiscoveryKindV2.Shortcut)
                             .OrderBy(value => value.Id, StringComparer.Ordinal))
                {
                    if (string.IsNullOrWhiteSpace(discovery.DurableRewardId)
                        || !state.ActiveShortcutIds.Contains(discovery.DurableRewardId)
                        || coordinator.IsCurrentExpeditionShortcutActivationClaimed(discovery.Id))
                    {
                        continue;
                    }

                    DungeonProgressionOperationResultV2 result = TryDiscover(discovery.Id);
                    if (!result.Success)
                    {
                        // Environment activation is speculative until both the
                        // durable discovery and per-expedition activation are
                        // committed atomically by the campaign port.
                        scene.Environment.DeactivateShortcut(discovery.DurableRewardId);
                    }
                }
            }
            finally
            {
                committingShortcutDiscoveries = false;
            }
        }

        private void UnbindCoordinator()
        {
            if (scene?.Environment != null && environmentChanged != null)
            {
                scene.Environment.CommittedStateChanged -= environmentChanged;
            }

            environmentChanged = null;
            committingShortcutDiscoveries = false;
            if (coordinator != null)
            {
                coordinator.ExtractionRequested -= HandleExtractionRequested;
            }

            coordinator = null;
        }
    }

    [DisallowMultipleComponent]
    public sealed class DungeonDiscoveryTriggerRuntimeV2 : MonoBehaviour
    {
        private DungeonExpeditionProgressionRuntimeV2 progression;
        private Collider triggerCollider;

        public string DiscoveryId { get; private set; }
        public bool IsConsumed { get; private set; }
        public DungeonProgressionOperationResultV2 LastResult { get; private set; }

        internal void Configure(
            DungeonExpeditionProgressionRuntimeV2 runtime,
            string discoveryId,
            bool isAlreadyClaimed)
        {
            progression = runtime;
            DiscoveryId = discoveryId;
            IsConsumed = isAlreadyClaimed;
            LastResult = null;
            triggerCollider = GetComponent<Collider>();
            if (triggerCollider != null)
            {
                triggerCollider.enabled = !IsConsumed;
            }
        }

        public DungeonProgressionOperationResultV2 TryActivate()
        {
            if (progression == null)
            {
                LastResult = DungeonProgressionOperationResultV2.Failed(
                    null,
                    "progression-runtime-unbound",
                    "The discovery trigger is not bound.",
                    DiscoveryId);
                return LastResult;
            }

            LastResult = progression.TryDiscover(DiscoveryId);
            if (LastResult.Success)
            {
                IsConsumed = true;
                if (triggerCollider != null)
                {
                    triggerCollider.enabled = false;
                }
            }

            return LastResult;
        }

        private void OnTriggerEnter(Collider other)
        {
            if (!IsConsumed && other != null
                && other.GetComponentInParent<ProductionPlayerController>() != null)
            {
                TryActivate();
            }
        }
    }

    /// <summary>
    /// Separate machine-core reward interaction. Guardian defeat reveals the
    /// pickup; collecting it commits the Large Refractor, and only a later
    /// extraction interaction may leave the dungeon.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DungeonLargeRefractorPickupRuntimeV2 : MonoBehaviour
    {
        private DungeonExpeditionProgressionRuntimeV2 progression;
        private DungeonEnvironmentRuntimeV2 environment;
        private Collider triggerCollider;
        private Renderer refractorRenderer;
        private TextMesh label;

        public bool IsAvailable { get; private set; }
        public bool IsConsumed { get; private set; }
        public DungeonProgressionOperationResultV2 LastResult { get; private set; }

        internal void Configure(
            DungeonExpeditionProgressionRuntimeV2 runtime,
            DungeonEnvironmentRuntimeV2 runtimeEnvironment)
        {
            progression = runtime;
            environment = runtimeEnvironment;
            triggerCollider = GetComponent<Collider>();
            LastResult = null;
            EnsurePresentation();
            RefreshAvailability();
        }

        public void RefreshAvailability()
        {
            DungeonExtractionStateV2 extractionState = progression?.ExtractionState
                ?? DungeonExtractionStateV2.Inactive;
            IsConsumed = extractionState == DungeonExtractionStateV2.Ready
                || extractionState == DungeonExtractionStateV2.RequestIssued;
            DungeonPredicateStateV2 predicateState = environment?.CapturePredicateState();
            bool guardianDefeated = predicateState != null
                && predicateState.ProgressionFactIds.Contains(
                    IndustrialFactoryV2Ruleset.FinalEliteDefeatedFactId);
            IsAvailable = guardianDefeated && !IsConsumed;
            if (triggerCollider != null)
            {
                triggerCollider.enabled = IsAvailable;
            }

            if (refractorRenderer != null)
            {
                refractorRenderer.enabled = IsAvailable;
            }

            if (label != null)
            {
                label.gameObject.SetActive(IsAvailable);
            }
        }

        public DungeonProgressionOperationResultV2 TryActivate()
        {
            if (progression == null || !IsAvailable)
            {
                LastResult = DungeonProgressionOperationResultV2.Failed(
                    null,
                    IsConsumed ? "large-refractor-already-secured" : "final-guardian-required",
                    IsConsumed
                        ? "The Large Refractor has already been secured."
                        : "Defeat the machine-core guardian before collecting the Large Refractor.",
                    IndustrialFactoryV2Ruleset.LargeRefractorDiscoveryId);
                return LastResult;
            }

            LastResult = progression.TrySecureLargeRefractor();
            RefreshAvailability();
            return LastResult;
        }

        private void OnTriggerEnter(Collider other)
        {
            if (IsAvailable && other != null
                && other.GetComponentInParent<ProductionPlayerController>() != null)
            {
                TryActivate();
            }
        }

        private void EnsurePresentation()
        {
            Transform visual = transform.Find("RefractorVisual");
            if (visual == null)
            {
                throw new InvalidOperationException(
                    "Large Refractor runtime requires the authored RefractorVisual child; runtime fallback art is prohibited.");
            }

            refractorRenderer = visual.GetComponent<Renderer>();
            if (refractorRenderer == null || refractorRenderer.sharedMaterial == null
                || refractorRenderer.sharedMaterial.shader == null)
            {
                throw new InvalidOperationException(
                    "The authored Large Refractor presentation has no valid renderer/material/shader.");
            }

            Transform labelTransform = transform.Find("RefractorLabel");
            label = labelTransform != null ? labelTransform.GetComponent<TextMesh>() : null;
        }
    }

    [DisallowMultipleComponent]
    public sealed class DungeonExtractionTriggerRuntimeV2 : MonoBehaviour
    {
        private DungeonExpeditionProgressionRuntimeV2 progression;
        private Collider triggerCollider;

        public bool IsConsumed { get; private set; }
        public DungeonExtractionAttemptResultV2 LastResult { get; private set; }

        internal void Configure(DungeonExpeditionProgressionRuntimeV2 runtime)
        {
            progression = runtime;
            IsConsumed = false;
            LastResult = null;
            triggerCollider = GetComponent<Collider>();
            if (triggerCollider != null)
            {
                triggerCollider.enabled = true;
            }
        }

        public DungeonExtractionAttemptResultV2 TryActivate()
        {
            LastResult = progression == null
                ? DungeonExtractionAttemptResultV2.Failed(
                    "progression-runtime-unbound",
                    "The extraction trigger is not bound.")
                : progression.TryRequestExtraction();
            if (LastResult.Success)
            {
                IsConsumed = true;
                if (triggerCollider != null)
                {
                    triggerCollider.enabled = false;
                }
            }

            return LastResult;
        }

        private void OnTriggerEnter(Collider other)
        {
            if (!IsConsumed && other != null
                && other.GetComponentInParent<ProductionPlayerController>() != null)
            {
                TryActivate();
            }
        }
    }
}
