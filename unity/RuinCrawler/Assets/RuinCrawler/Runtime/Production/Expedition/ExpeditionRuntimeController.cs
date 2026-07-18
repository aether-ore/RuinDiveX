using System;
using System.Collections.Generic;
using System.Linq;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Core.Foundation;
using RuinCrawler.Core.Reaverbots;
using RuinCrawler.Runtime.BossHunts;
using RuinCrawler.Runtime.Contracts;
using RuinCrawler.Runtime.Dungeon;
using RuinCrawler.Runtime.Persistence;
using RuinCrawler.Runtime.Reaverbots;
using UnityEngine;

namespace RuinCrawler.Runtime.Expedition
{
    /// <summary>
    /// Composes the pure dungeon and Reaverbot systems at the scene boundary.
    /// The campaign run seed remains authoritative; generated scene objects are
    /// deliberately transient and never enter the save envelope.
    /// </summary>
    [DefaultExecutionOrder(-250)]
    [DisallowMultipleComponent]
    public sealed class ExpeditionRuntimeController : MonoBehaviour
    {
        [SerializeField] private TextAsset contractPack;
        [SerializeField] private DungeonSceneBuilderV2 dungeonBuilderV2;
        [SerializeField] private ReaverbotSpawner reaverbotSpawner;
        [SerializeField] private BossHuntCoordinator bossHuntCoordinator;
        [SerializeField] private DungeonExpeditionProgressionRuntimeV2 dungeonProgressionV2;
        [SerializeField] private ExpeditionFlowController expeditionFlowController;
        [SerializeField] private Transform player;
        [SerializeField] private bool buildOnStart = true;
        [SerializeField] private bool returnToCampOnExtraction = true;
        [SerializeField] private string developmentSeed = "unity-expedition";
        [SerializeField, Min(1)] private int developmentDifficulty = 1;

        private readonly Dictionary<string, ReaverbotRuntimeController> spawnedBySlot =
            new Dictionary<string, ReaverbotRuntimeController>(StringComparer.Ordinal);
        private readonly Dictionary<string, List<DungeonAnchorRuntimeV2>> pendingV2EncounterAnchors =
            new Dictionary<string, List<DungeonAnchorRuntimeV2>>(StringComparer.Ordinal);
        private readonly HashSet<string> activatedV2EncounterRegions =
            new HashSet<string>(StringComparer.Ordinal);
        private string resolvedSeed;
        private int resolvedDifficulty;
        private bool subscribed;
        private CampaignStateV1 campaignAtEntry;
        private BossHuntRuntimeController activeBoss;
        private bool bossCommitPending;
        private float bossCommitRetryRemaining;
        private Action<DungeonLayeredMinimapViewStateV2> v2MapChanged;
        private Action<DungeonEnvironmentSnapshotV2> v2EnvironmentChanged;
        private Action<DungeonRegionRuntimeV2> v2RegionEntered;
        private Action<string> v2SafeAnchorReached;
        private DungeonRegionRuntimeV2[] v2RegionRuntimes = Array.Empty<DungeonRegionRuntimeV2>();
        private DungeonSafeAnchorRuntimeV2[] v2SafeAnchors = Array.Empty<DungeonSafeAnchorRuntimeV2>();
        private ReaverbotRuntimeController v2FinalGuardian;
        private bool extractionTransitionRequested;

        public string RunSeed => resolvedSeed;
        public DungeonPlanV2 Plan => dungeonBuilderV2 != null ? dungeonBuilderV2.CurrentPlan : null;
        public DungeonPlanV2 PlanV2 => Plan;
        public int SpawnedEnemyCount => spawnedBySlot.Count;
        public BossHuntRuntimeController ActiveBoss => activeBoss;
        public DungeonExpeditionProgressionRuntimeV2 ProgressionV2 => dungeonProgressionV2;
        public string LastError { get; private set; }
        public bool LastV2CheckpointUsedEntranceFallback { get; private set; }
        public string LastV2CheckpointFallbackMessage { get; private set; }
        public string LastV2SpawnAnchorId { get; private set; }

        public event Action<DungeonExtractionRequestV2> ExtractionRequested;

        public void Configure(
            TextAsset sourceContractPack,
            ReaverbotSpawner enemySpawner,
            Transform playerTarget,
            bool generateAtStart = true)
        {
            contractPack = sourceContractPack;
            reaverbotSpawner = enemySpawner;
            player = playerTarget;
            buildOnStart = generateAtStart;
        }

        private void Awake()
        {
            dungeonBuilderV2 = ResolveOrAdd(dungeonBuilderV2);
            reaverbotSpawner = ResolveOrAdd(reaverbotSpawner);
            bossHuntCoordinator = ResolveOrAdd(bossHuntCoordinator);
            dungeonProgressionV2 = ResolveOrAdd(dungeonProgressionV2);
            expeditionFlowController ??= ExpeditionFlowController.Instance;
            if (contractPack == null && UnityContractCatalogProvider.Instance != null)
            {
                contractPack = UnityContractCatalogProvider.Instance.ContractPack;
            }

            CampaignStateV1 state = CampaignSession.Instance != null
                ? CampaignSession.Instance.Snapshot
                : CampaignStateV1.CreateDefault();
            campaignAtEntry = state;
            resolvedSeed = string.IsNullOrWhiteSpace(state.expedition?.runSeed)
                ? developmentSeed
                : state.expedition.runSeed;
            resolvedDifficulty = state.expedition == null
                ? Mathf.Max(1, developmentDifficulty)
                : ExpeditionFlowController.ResolveIndustrialFactoryV2GenerationDifficulty(state);
            dungeonBuilderV2.ConfigureLocalNavigation(
                createNavigation: true,
                bakeImmediately: true);
            reaverbotSpawner.Configure(contractPack, null, player);
            bossHuntCoordinator.Configure(contractPack, reaverbotSpawner, player);
            Subscribe();
        }

        private void Start()
        {
            if (buildOnStart)
            {
                TryBuildAndPopulate(out _);
            }
        }

        private void Update()
        {
            if (!bossCommitPending)
            {
                return;
            }

            bossCommitRetryRemaining = Mathf.Max(0f, bossCommitRetryRemaining - Time.unscaledDeltaTime);
            if (bossCommitRetryRemaining <= 0f)
            {
                TryCommitBossVictory();
            }
        }

        private void OnDestroy()
        {
            Unsubscribe();
            UnbindBoss();
            UnbindV2Progress();
            spawnedBySlot.Clear();
        }

        public bool TryBuildAndPopulate(out string error)
        {
            LastError = null;
            UnbindBoss();
            UnbindV2Progress();
            bossHuntCoordinator.ResetEncounter();
            bossCommitPending = false;
            v2FinalGuardian = null;
            extractionTransitionRequested = false;
            spawnedBySlot.Clear();
            pendingV2EncounterAnchors.Clear();
            activatedV2EncounterRegions.Clear();
            reaverbotSpawner.Teardown(releasePooledObjects: false);
            if (!TryBuildV2(out error))
            {
                LastError = error;
                return false;
            }

            SpawnPlanEncounters();
            PositionPlayerAtPlanStart();
            error = null;
            return true;
        }

        public void TearDown()
        {
            spawnedBySlot.Clear();
            pendingV2EncounterAnchors.Clear();
            activatedV2EncounterRegions.Clear();
            v2FinalGuardian = null;
            extractionTransitionRequested = false;
            UnbindBoss();
            UnbindV2Progress();
            bossHuntCoordinator?.ResetEncounter();
            reaverbotSpawner?.Teardown(releasePooledObjects: true);
            dungeonBuilderV2?.TearDown();
        }

        private void SpawnPlanEncounters()
        {
            SpawnV2PlanEncounters();
        }

        private void PositionPlayerAtPlanStart()
        {
            PositionPlayerAtV2Start();
        }

        private bool TryBuildV2(out string error)
        {
            DungeonPlanV2 plan;
            try
            {
                plan = new IndustrialFactoryV2Generator().Generate(resolvedSeed, resolvedDifficulty);
            }
            catch (Exception exception)
            {
                error = "Dungeon generation failed: " + exception.Message;
                return false;
            }

            if (!CommitV2PlanIdentity(plan, out error))
            {
                return false;
            }

            CampaignSession liveSession = CampaignSession.Instance;
            CampaignStateV1 liveState = liveSession != null
                ? liveSession.Snapshot
                : campaignAtEntry;
            int quarantinedProgressIds = QuarantineUnknownV2Progress(
                liveState,
                plan,
                DateTime.UtcNow.ToString("O"));
            if (quarantinedProgressIds > 0 && liveSession != null)
            {
                CampaignCommitResult<CampaignStateV1> quarantineCommit = liveSession.Commit(
                    "quarantine-v2-plan-progress:" + plan.DeterministicSignature,
                    liveState);
                if (!quarantineCommit.Success)
                {
                    error = quarantineCommit.Message
                        ?? "Unknown dungeon progress could not be quarantined safely.";
                    return false;
                }

                liveState = quarantineCommit.Envelope.State;
                Debug.LogWarning(
                    "[RuinCrawler Dungeon] Quarantined " + quarantinedProgressIds
                        + " unknown plan-local progress id(s) before restoring the ruin.",
                    this);
            }
            ActiveDungeonProgressV1 progress = liveState?.expedition?.dungeonProgress
                ?? new ActiveDungeonProgressV1();
            DungeonEnvironmentSnapshotV2 restoredEnvironment = BuildRestoredEnvironment(plan, progress);
            KnownRuinV1 retainedKnownRuin = liveState?.knownRuins?.FirstOrDefault(value => value != null
                && string.Equals(value.ruinId, liveState.expedition?.ruinId, StringComparison.Ordinal));
            DungeonMapKnowledgeStateV2 restoredKnowledge = BuildRestoredKnowledge(
                plan,
                progress.mapKnowledge,
                progress.activatedShortcutIds,
                retainedKnownRuin);
            if (!dungeonBuilderV2.TryBuild(
                    plan,
                    restoredEnvironment,
                    restoredKnowledge,
                    out error,
                    progress.requiredItemIds,
                    Array.Empty<string>(),
                    progress.requiredFactIds))
            {
                return false;
            }

            try
            {
                CampaignSession session = CampaignSession.Instance;
                if (session == null
                    || !dungeonProgressionV2.Configure(
                        dungeonBuilderV2.CurrentInstance,
                        session,
                        out error))
                {
                    error ??= "The campaign progression runtime could not be configured.";
                    TearDownFailedV2Build();
                    return false;
                }

                dungeonProgressionV2.ExtractionRequested += HandleV2ExtractionRequested;
                BindV2Progress();
                return true;
            }
            catch (Exception exception)
            {
                error = "Dungeon post-build initialization failed: " + exception.Message;
                TearDownFailedV2Build();
                return false;
            }
        }

        private void TearDownFailedV2Build()
        {
            // The scene builder already owns every generated mesh, material,
            // object, and local NavMeshData. Unbind scene observers first, then
            // release that ownership synchronously so a rejected build cannot
            // survive into the next attempt.
            UnbindV2Progress();
            dungeonBuilderV2?.TearDown();
        }

        private void SpawnV2PlanEncounters()
        {
            DungeonPlanV2 plan = dungeonBuilderV2.CurrentPlan;
            if (plan == null || dungeonBuilderV2.GeneratedRoot == null)
            {
                return;
            }

            pendingV2EncounterAnchors.Clear();
            activatedV2EncounterRegions.Clear();
            DungeonAnchorRuntimeV2[] anchors = dungeonBuilderV2.GeneratedRoot
                .GetComponentsInChildren<DungeonAnchorRuntimeV2>(true)
                .Where(value => value.Kind == DungeonAnchorKindV2.Encounter)
                .OrderBy(value => value.StableId, StringComparer.Ordinal)
                .ToArray();
            foreach (DungeonAnchorRuntimeV2 anchor in anchors)
            {
                if (!pendingV2EncounterAnchors.TryGetValue(
                        anchor.RegionId,
                        out List<DungeonAnchorRuntimeV2> regionAnchors))
                {
                    regionAnchors = new List<DungeonAnchorRuntimeV2>();
                    pendingV2EncounterAnchors.Add(anchor.RegionId, regionAnchors);
                }

                regionAnchors.Add(anchor);
            }
        }

        private void ActivateV2RegionEncounters(string regionId)
        {
            if (string.IsNullOrWhiteSpace(regionId)
                || !activatedV2EncounterRegions.Add(regionId)
                || !pendingV2EncounterAnchors.TryGetValue(
                    regionId,
                    out List<DungeonAnchorRuntimeV2> anchors))
            {
                return;
            }

            DungeonPlanV2 plan = dungeonBuilderV2.CurrentPlan;
            if (plan == null)
            {
                return;
            }

            DungeonAnchorRuntimeV2 finalAnchor = pendingV2EncounterAnchors.Values
                .SelectMany(value => value)
                .OrderBy(value => value.StableId, StringComparer.Ordinal)
                .LastOrDefault(value => string.Equals(
                    value.RegionId,
                    plan.ExtractionRegionId,
                    StringComparison.Ordinal));
            DungeonPredicateStateV2 predicateState =
                dungeonBuilderV2.CurrentInstance.Environment.CapturePredicateState();
            bool finalGuardianAlreadyDefeated = predicateState.ProgressionFactIds.Contains(
                    IndustrialFactoryV2Ruleset.FinalEliteDefeatedFactId)
                || dungeonProgressionV2.ExtractionState == DungeonExtractionStateV2.Ready
                || dungeonProgressionV2.ExtractionState == DungeonExtractionStateV2.RequestIssued;
            for (int index = 0; index < anchors.Count; index += 1)
            {
                DungeonAnchorRuntimeV2 anchor = anchors[index];
                if (anchor == finalAnchor && finalGuardianAlreadyDefeated)
                {
                    continue;
                }

                bool selectedBoss = anchor == finalAnchor
                    && !string.IsNullOrWhiteSpace(campaignAtEntry?.expedition?.bossProfileId);
                if (selectedBoss)
                {
                    CampaignStateV1 liveCampaign = CampaignSession.Instance != null
                        ? CampaignSession.Instance.Snapshot
                        : campaignAtEntry;
                    activeBoss = bossHuntCoordinator.SpawnSelected(
                        liveCampaign,
                        anchor.transform.position,
                        anchor.transform.rotation,
                        Mathf.Max(8, resolvedDifficulty));
                    activeBoss.Defeated += HandleBossDefeated;
                    continue;
                }

                DungeonRegionPlanV2 region = plan.Regions.First(value => value.Id == anchor.RegionId);
                DungeonBiomeDistrictPlanV2 district = plan.Districts.First(value =>
                    value.Id == region.BiomeDistrictId);
                var request = new ReaverbotSpawnRequest
                {
                    runSeed = resolvedSeed,
                    encounterId = anchor.StableId,
                    slotIndex = 0,
                    threatTier = Mathf.Max(1, resolvedDifficulty),
                    intent = district.Kind == DungeonBiomeDistrictKindV2.Waterworks ? "ranged" : "any",
                    encounterSize = 1,
                    biome = "industrial-factory-v2",
                    roomArchetypeId = region.MacroRoleId,
                    roomFlavorId = district.Kind.ToString(),
                    elite = anchor == finalAnchor,
                    isBoss = false,
                    keycardCarrier = false,
                    displayNameOverride = anchor == finalAnchor ? "Machine Core Guardian" : null
                };
                ReaverbotRuntimeController enemy = reaverbotSpawner.SpawnEncounterSlot(
                    request,
                    anchor.transform.position,
                    anchor.transform.rotation);
                spawnedBySlot.Add(anchor.StableId, enemy);
                if (anchor == finalAnchor)
                {
                    v2FinalGuardian = enemy;
                }
            }
        }

        public bool PositionPlayerAtV2Start()
        {
            LastV2CheckpointUsedEntranceFallback = false;
            LastV2CheckpointFallbackMessage = null;
            LastV2SpawnAnchorId = null;
            if (player == null || dungeonBuilderV2.GeneratedRoot == null || dungeonBuilderV2.CurrentPlan == null)
            {
                return false;
            }

            DungeonPlanV2 plan = dungeonBuilderV2.CurrentPlan;
            string checkpointId = CampaignSession.Instance?.Snapshot.expedition?.dungeonProgress?.checkpointId;
            DungeonAnchorRuntimeV2[] anchors = dungeonBuilderV2.GeneratedRoot
                .GetComponentsInChildren<DungeonAnchorRuntimeV2>(true);
            DungeonAnchorRuntimeV2 start = !string.IsNullOrWhiteSpace(checkpointId)
                ? anchors.FirstOrDefault(value => value.StableId == checkpointId
                    && value.Kind == DungeonAnchorKindV2.Safe)
                : null;
            if (start == null)
            {
                if (!string.IsNullOrWhiteSpace(checkpointId))
                {
                    LastV2CheckpointUsedEntranceFallback = true;
                    LastV2CheckpointFallbackMessage =
                        "Saved checkpoint '" + checkpointId
                        + "' is not valid for the regenerated plan; using the entrance without discarding the expedition.";
                    Debug.LogWarning(
                        "[RuinCrawler Dungeon] " + LastV2CheckpointFallbackMessage,
                        this);
                }

                start = anchors.FirstOrDefault(value => value.RegionId == plan.EntranceRegionId
                    && (value.Kind == DungeonAnchorKindV2.Spawn || value.Kind == DungeonAnchorKindV2.Entry));
            }

            if (start == null)
            {
                return false;
            }

            CharacterController controller = player.GetComponent<CharacterController>();
            bool wasEnabled = controller != null && controller.enabled;
            if (controller != null) controller.enabled = false;
            player.SetPositionAndRotation(start.transform.position + Vector3.up * 0.05f, start.transform.rotation);
            player.GetComponent<RuinCrawler.Runtime.Player.PlayerTraversalMediumSensor>()?.ClearOverlaps();
            if (controller != null) controller.enabled = wasEnabled;
            LastV2SpawnAnchorId = start.StableId;
            ActivateV2RegionEncounters(start.RegionId);
            return true;
        }

        private static DungeonEnvironmentSnapshotV2 BuildRestoredEnvironment(
            DungeonPlanV2 plan,
            ActiveDungeonProgressV1 progress)
        {
            var controllerFacts = new List<DungeonControllerStateFactV2>();
            foreach (string fact in progress?.permanentFactIds ?? new List<string>())
            {
                const string prefix = "controller:";
                if (!fact.StartsWith(prefix, StringComparison.Ordinal)) continue;
                int separator = fact.IndexOf('=', prefix.Length);
                if (separator <= prefix.Length || separator >= fact.Length - 1) continue;
                string controllerId = fact.Substring(prefix.Length, separator - prefix.Length);
                string stateId = fact.Substring(separator + 1);
                DungeonEnvironmentControllerPlanV2 controllerPlan = plan.EnvironmentControllers
                    .FirstOrDefault(value => value.Id == controllerId);
                if (IsPersistableV2ControllerState(controllerPlan, stateId))
                {
                    controllerFacts.Add(new DungeonControllerStateFactV2(controllerId, stateId));
                }
            }

            return new DungeonEnvironmentSnapshotV2(
                controllerFacts,
                Array.Empty<DungeonFluidNetworkStateV2>(),
                progress?.activatedShortcutIds ?? new List<string>());
        }

        private static DungeonMapKnowledgeStateV2 BuildRestoredKnowledge(
            DungeonPlanV2 plan,
            DungeonMapKnowledgeV1 saved,
            IEnumerable<string> activatedShortcutIds,
            KnownRuinV1 retainedKnownRuin)
        {
            saved ??= new DungeonMapKnowledgeV1();
            DungeonMapKnowledgeV1 retainedKnownRuinKnowledge =
                retainedKnownRuin?.mapKnowledge ?? new DungeonMapKnowledgeV1();
            var seen = new HashSet<string>(saved.seenRegionIds ?? new List<string>(), StringComparer.Ordinal);
            seen.UnionWith(retainedKnownRuinKnowledge.seenRegionIds ?? new List<string>());
            var visited = new HashSet<string>(saved.visitedRegionIds ?? new List<string>(), StringComparer.Ordinal);
            visited.UnionWith(retainedKnownRuinKnowledge.visitedRegionIds ?? new List<string>());
            var explored = new HashSet<string>(saved.exploredRegionIds ?? new List<string>(), StringComparer.Ordinal);
            explored.UnionWith(retainedKnownRuinKnowledge.exploredRegionIds ?? new List<string>());
            visited.UnionWith(explored);
            seen.UnionWith(visited);
            var knownShortcuts = new HashSet<string>(
                (activatedShortcutIds ?? Array.Empty<string>()).Where(id =>
                    plan.Shortcuts.Any(value => value.Id == id)),
                StringComparer.Ordinal);
            if (retainedKnownRuin != null)
            {
                foreach (string claimKey in retainedKnownRuin.claimedRewardIds
                    ?? new List<string>())
                {
                    if (!DungeonRewardTransactionService.TryParseClaimKey(
                            claimKey,
                            out string claimRuinId,
                            out string discoveryId,
                            out string claimExpeditionId)
                        || claimExpeditionId != null
                        || !string.Equals(
                            claimRuinId,
                            retainedKnownRuin.ruinId,
                            StringComparison.Ordinal))
                    {
                        continue;
                    }

                    DungeonDiscoveryPlanV2 shortcutDiscovery = plan.Discoveries.FirstOrDefault(value =>
                        value.Kind == DungeonDiscoveryKindV2.Shortcut
                        && value.DuplicatePolicy == DungeonDiscoveryDuplicatePolicyV2.OncePerRuin
                        && string.Equals(value.Id, discoveryId, StringComparison.Ordinal));
                    if (shortcutDiscovery != null
                        && plan.Shortcuts.Any(value => string.Equals(
                            value.Id,
                            shortcutDiscovery.DurableRewardId,
                            StringComparison.Ordinal)))
                    {
                        knownShortcuts.Add(shortcutDiscovery.DurableRewardId);
                    }
                }
            }

            var regions = new List<DungeonRegionKnowledgeV2>();
            foreach (string regionId in seen)
            {
                if (plan.Regions.Any(value => value.Id == regionId))
                {
                    regions.Add(new DungeonRegionKnowledgeV2(
                        regionId,
                        explored.Contains(regionId)
                            ? DungeonMapKnowledgeLevelV2.Explored
                            : visited.Contains(regionId)
                            ? DungeonMapKnowledgeLevelV2.Visited
                            : DungeonMapKnowledgeLevelV2.Seen));
                }
            }

            return new DungeonMapKnowledgeStateV2(
                regions,
                (saved.discoveredConnectionIds ?? new List<string>())
                    .Concat(retainedKnownRuinKnowledge.discoveredConnectionIds ?? new List<string>())
                    .Where(id => plan.TraversalEdges.Any(value => value.Id == id)),
                (saved.knownLandmarkIds ?? new List<string>())
                    .Concat(retainedKnownRuinKnowledge.knownLandmarkIds ?? new List<string>())
                    .Where(id => plan.Anchors.Any(value => value.Id == id
                        && value.Kind == DungeonAnchorKindV2.Landmark)),
                saved.knownMechanismIds ?? new List<string>(),
                knownShortcuts);
        }

        public static bool TryValidateV2ResumeIdentity(
            CampaignStateV1 state,
            DungeonPlanV2 plan,
            out string error)
        {
            if (state?.expedition == null || plan == null)
            {
                error = "A durable expedition and generated dungeon plan are required.";
                return false;
            }

            ExpeditionSourceStateV1 expedition = state.expedition;
            string expectedRuinId = "ruin:" + plan.DeterministicSignature;
            if (!string.Equals(expedition.runSeed, plan.Seed, StringComparison.Ordinal))
            {
                error = "The durable expedition seed does not match the regenerated dungeon plan.";
                return false;
            }

            bool exact = string.Equals(expedition.dungeonProfileId, plan.ProfileId, StringComparison.Ordinal)
                && string.Equals(expedition.dungeonRulesetVersion, plan.RulesetVersion, StringComparison.Ordinal)
                && string.Equals(expedition.dungeonContentPackVersion, plan.ContentPackVersion, StringComparison.Ordinal)
                && string.Equals(expedition.dungeonPlanId, plan.DeterministicSignature, StringComparison.Ordinal)
                && string.Equals(expedition.ruinId, expectedRuinId, StringComparison.Ordinal);
            if (!exact)
            {
                error = "The durable expedition's profile, ruleset, content pack, plan signature, or canonical ruin id "
                    + "does not match the regenerated dungeon plan.";
                return false;
            }

            foreach (KnownRuinV1 known in state.knownRuins ?? new List<KnownRuinV1>())
            {
                if (known == null)
                {
                    continue;
                }

                bool expectedIdentity = string.Equals(known.ruinId, expectedRuinId, StringComparison.Ordinal);
                bool referencesPlanSignature = string.Equals(
                    known.dungeonPlanId,
                    plan.DeterministicSignature,
                    StringComparison.Ordinal);
                if (!expectedIdentity && !referencesPlanSignature)
                {
                    continue;
                }

                if (!expectedIdentity
                    || !string.Equals(known.dungeonPlanId, plan.DeterministicSignature, StringComparison.Ordinal)
                    || !string.Equals(known.dungeonProfileId, plan.ProfileId, StringComparison.Ordinal)
                    || !string.Equals(known.dungeonRulesetVersion, plan.RulesetVersion, StringComparison.Ordinal)
                    || !string.Equals(known.dungeonContentPackVersion, plan.ContentPackVersion, StringComparison.Ordinal)
                    || !string.Equals(known.runSeed, plan.Seed, StringComparison.Ordinal))
                {
                    error = "The known ruin identity does not exactly match the regenerated dungeon plan.";
                    return false;
                }
            }

            error = null;
            return true;
        }

        public static int QuarantineUnknownV2Progress(
            CampaignStateV1 state,
            DungeonPlanV2 plan,
            string quarantinedAtUtc)
        {
            ActiveDungeonProgressV1 progress = state?.expedition?.dungeonProgress;
            if (progress == null || plan == null)
            {
                return 0;
            }

            state.unknownIdQuarantine ??= new List<QuarantinedUnknownIdV1>();
            string timestamp = string.IsNullOrWhiteSpace(quarantinedAtUtc)
                ? DateTime.UtcNow.ToString("O")
                : quarantinedAtUtc.Trim();
            var controllerStates = plan.EnvironmentControllers.ToDictionary(
                value => value.Id,
                value => new HashSet<string>(value.StableStateIds, StringComparer.Ordinal),
                StringComparer.Ordinal);
            var persistentControllerStates = plan.EnvironmentControllers.ToDictionary(
                value => value.Id,
                value => new HashSet<string>(value.StableStateIds.Where(stateId =>
                    IsPersistableV2ControllerState(value, stateId)), StringComparer.Ordinal),
                StringComparer.Ordinal);
            var shortcuts = new HashSet<string>(plan.Shortcuts.Select(value => value.Id), StringComparer.Ordinal);
            var regions = new HashSet<string>(plan.Regions.Select(value => value.Id), StringComparer.Ordinal);
            var edges = new HashSet<string>(plan.TraversalEdges.Select(value => value.Id), StringComparer.Ordinal);
            var landmarks = new HashSet<string>(plan.Anchors
                .Where(value => value.Kind == DungeonAnchorKindV2.Landmark)
                .Select(value => value.Id), StringComparer.Ordinal);
            var discoveries = new HashSet<string>(plan.Discoveries.Select(value => value.Id), StringComparer.Ordinal)
            {
                "final-guardian:" + plan.DeterministicSignature,
                "large-refractor:" + plan.DeterministicSignature
            };
            foreach (DungeonDiscoveryPlanV2 shortcutDiscovery in plan.Discoveries.Where(value =>
                value.Kind == DungeonDiscoveryKindV2.Shortcut))
            {
                discoveries.Add(
                    shortcutDiscovery.Id
                    + DungeonDiscoveryCommandMapperV2.ShortcutActivationClaimSuffix);
            }
            var requiredItems = CollectV2PredicateSubjects(
                plan,
                DungeonPredicateConditionKindV2.RequiredItem);
            foreach (string rewardId in plan.Discoveries
                .Where(value => value.Kind == DungeonDiscoveryKindV2.MechanismKnowledge)
                .Select(value => value.DurableRewardId)
                .Where(value => !string.IsNullOrWhiteSpace(value)))
            {
                requiredItems.Add(rewardId);
            }
            var requiredFacts = CollectV2PredicateSubjects(
                plan,
                DungeonPredicateConditionKindV2.ProgressionFact);
            requiredFacts.Add(IndustrialFactoryV2Ruleset.FinalEliteDefeatedFactId);
            requiredFacts.Add(IndustrialFactoryV2Ruleset.ExtractionReadyFactId);
            var permanentFacts = new HashSet<string>(plan.Discoveries
                .Where(value => value.Kind == DungeonDiscoveryKindV2.Lore
                    && !string.IsNullOrWhiteSpace(value.DurableRewardId))
                .Select(value => "lore:" + value.DurableRewardId), StringComparer.Ordinal);
            var oncePerRuinDiscoveries = new HashSet<string>(plan.Discoveries
                .Where(value => value.DuplicatePolicy == DungeonDiscoveryDuplicatePolicyV2.OncePerRuin)
                .Select(value => value.Id), StringComparer.Ordinal);

            int removed = 0;
            removed += QuarantineUnknownValues(state, progress.requiredItemIds, requiredItems,
                "dungeon-required-item", "expedition.dungeonProgress.requiredItemIds", timestamp);
            removed += QuarantineUnknownValues(state, progress.requiredFactIds, requiredFacts,
                "dungeon-progression-fact", "expedition.dungeonProgress.requiredFactIds", timestamp);
            for (int index = progress.permanentFactIds.Count - 1; index >= 0; index -= 1)
            {
                string fact = progress.permanentFactIds[index];
                const string prefix = "controller:";
                if (!string.IsNullOrEmpty(fact)
                    && !fact.StartsWith(prefix, StringComparison.Ordinal)
                    && permanentFacts.Contains(fact))
                {
                    continue;
                }

                int separator = fact?.IndexOf('=', prefix.Length) ?? -1;
                string controllerId = separator > prefix.Length
                    ? fact.Substring(prefix.Length, separator - prefix.Length)
                    : null;
                string stateId = separator >= prefix.Length && separator < fact.Length - 1
                    ? fact.Substring(separator + 1)
                    : null;
                if (controllerId != null
                    && stateId != null
                    && persistentControllerStates.TryGetValue(
                        controllerId,
                        out HashSet<string> knownStates)
                    && knownStates.Contains(stateId))
                {
                    continue;
                }

                progress.permanentFactIds.RemoveAt(index);
                AddV2Quarantine(
                    state,
                    fact != null && fact.StartsWith(prefix, StringComparison.Ordinal)
                        ? "dungeon-controller-state"
                        : "dungeon-permanent-fact",
                    fact,
                    "expedition.dungeonProgress.permanentFactIds", timestamp);
                removed += 1;
            }

            removed += QuarantineUnknownValues(state, progress.activatedShortcutIds, shortcuts,
                "dungeon-shortcut", "expedition.dungeonProgress.activatedShortcutIds", timestamp);
            DungeonMapKnowledgeV1 map = progress.mapKnowledge ??= new DungeonMapKnowledgeV1();
            removed += QuarantineUnknownValues(state, map.seenRegionIds, regions,
                "dungeon-region", "expedition.dungeonProgress.mapKnowledge.seenRegionIds", timestamp);
            removed += QuarantineUnknownValues(state, map.visitedRegionIds, regions,
                "dungeon-region", "expedition.dungeonProgress.mapKnowledge.visitedRegionIds", timestamp);
            removed += QuarantineUnknownValues(state, map.exploredRegionIds, regions,
                "dungeon-region", "expedition.dungeonProgress.mapKnowledge.exploredRegionIds", timestamp);
            removed += QuarantineUnknownValues(state, map.discoveredConnectionIds, edges,
                "dungeon-traversal-edge", "expedition.dungeonProgress.mapKnowledge.discoveredConnectionIds", timestamp);
            removed += QuarantineUnknownValues(state, map.knownLandmarkIds, landmarks,
                "dungeon-landmark", "expedition.dungeonProgress.mapKnowledge.knownLandmarkIds", timestamp);
            removed += QuarantineUnknownValues(state, map.knownMechanismIds,
                new HashSet<string>(controllerStates.Keys, StringComparer.Ordinal),
                "dungeon-controller", "expedition.dungeonProgress.mapKnowledge.knownMechanismIds", timestamp);

            for (int index = progress.claimedRewardIds.Count - 1; index >= 0; index -= 1)
            {
                string claimKey = progress.claimedRewardIds[index];
                bool parsed = DungeonRewardTransactionService.TryParseClaimKey(
                    claimKey,
                    out string claimRuinId,
                    out string discoveryId,
                    out string claimExpeditionId);
                if (parsed
                    && string.Equals(claimRuinId, state.expedition.ruinId, StringComparison.Ordinal)
                    && (claimExpeditionId == null
                        || string.Equals(
                            claimExpeditionId,
                            state.expedition.expeditionId,
                            StringComparison.Ordinal))
                    && discoveries.Contains(discoveryId))
                {
                    continue;
                }

                progress.claimedRewardIds.RemoveAt(index);
                AddV2Quarantine(state, "dungeon-discovery",
                    parsed ? discoveryId : claimKey,
                    "expedition.dungeonProgress.claimedRewardIds", timestamp);
                removed += 1;
            }

            KnownRuinV1 knownRuin = state.knownRuins?.FirstOrDefault(value => value != null
                && string.Equals(value.ruinId, state.expedition.ruinId, StringComparison.Ordinal));
            if (knownRuin != null)
            {
                knownRuin.permanentFactIds ??= new List<string>();
                removed += QuarantineUnknownValues(
                    state,
                    knownRuin.permanentFactIds,
                    permanentFacts,
                    "dungeon-permanent-fact",
                    "knownRuins.permanentFactIds",
                    timestamp);

                knownRuin.activatedShortcutIds ??= new List<string>();
                removed += QuarantineUnknownValues(
                    state,
                    knownRuin.activatedShortcutIds,
                    shortcuts,
                    "dungeon-shortcut",
                    "knownRuins.activatedShortcutIds",
                    timestamp);

                DungeonMapKnowledgeV1 retainedMap =
                    knownRuin.mapKnowledge ??= new DungeonMapKnowledgeV1();
                removed += QuarantineUnknownValues(state, retainedMap.seenRegionIds, regions,
                    "dungeon-region", "knownRuins.mapKnowledge.seenRegionIds", timestamp);
                removed += QuarantineUnknownValues(state, retainedMap.visitedRegionIds, regions,
                    "dungeon-region", "knownRuins.mapKnowledge.visitedRegionIds", timestamp);
                removed += QuarantineUnknownValues(state, retainedMap.exploredRegionIds, regions,
                    "dungeon-region", "knownRuins.mapKnowledge.exploredRegionIds", timestamp);
                removed += QuarantineUnknownValues(
                    state,
                    retainedMap.discoveredConnectionIds,
                    edges,
                    "dungeon-traversal-edge",
                    "knownRuins.mapKnowledge.discoveredConnectionIds",
                    timestamp);
                removed += QuarantineUnknownValues(
                    state,
                    retainedMap.knownLandmarkIds,
                    landmarks,
                    "dungeon-landmark",
                    "knownRuins.mapKnowledge.knownLandmarkIds",
                    timestamp);

                knownRuin.claimedRewardIds ??= new List<string>();
                for (int index = knownRuin.claimedRewardIds.Count - 1; index >= 0; index -= 1)
                {
                    string claimKey = knownRuin.claimedRewardIds[index];
                    bool parsed = DungeonRewardTransactionService.TryParseClaimKey(
                        claimKey,
                        out string claimRuinId,
                        out string discoveryId,
                        out string claimExpeditionId);
                    if (parsed
                        && claimExpeditionId == null
                        && string.Equals(claimRuinId, knownRuin.ruinId, StringComparison.Ordinal)
                        && oncePerRuinDiscoveries.Contains(discoveryId))
                    {
                        continue;
                    }

                    knownRuin.claimedRewardIds.RemoveAt(index);
                    AddV2Quarantine(
                        state,
                        "dungeon-discovery",
                        parsed ? discoveryId : claimKey,
                        "knownRuins.claimedRewardIds",
                        timestamp);
                    removed += 1;
                }
            }

            state.unknownIdQuarantine.Sort((left, right) =>
            {
                int category = string.Compare(left?.category, right?.category, StringComparison.Ordinal);
                if (category != 0) return category;
                int unknown = string.Compare(left?.unknownId, right?.unknownId, StringComparison.Ordinal);
                return unknown != 0
                    ? unknown
                    : string.Compare(left?.path, right?.path, StringComparison.Ordinal);
            });
            return removed;
        }

        private static bool IsPersistableV2ControllerState(
            DungeonEnvironmentControllerPlanV2 controller,
            string stateId)
        {
            if (controller == null
                || string.IsNullOrWhiteSpace(stateId)
                || !controller.StableStateIds.Contains(stateId))
            {
                return false;
            }

            return controller.Kind == DungeonEnvironmentControllerKindV2.Grounding
                || controller.Kind == DungeonEnvironmentControllerKindV2.ValveUnlock
                || controller.Kind == DungeonEnvironmentControllerKindV2.Door
                || (controller.Kind == DungeonEnvironmentControllerKindV2.ElectricCycle
                    && string.Equals(stateId, "Grounded", StringComparison.Ordinal));
        }

        private static HashSet<string> CollectV2PredicateSubjects(
            DungeonPlanV2 plan,
            DungeonPredicateConditionKindV2 kind)
        {
            var result = new HashSet<string>(StringComparer.Ordinal);
            foreach (DungeonAccessPredicateV2 predicate in EnumerateV2Predicates(plan))
            foreach (DungeonPredicateClauseV2 clause in predicate.Clauses)
            foreach (DungeonPredicateConditionV2 condition in clause.Conditions)
            {
                if (condition.Kind == kind)
                {
                    result.Add(condition.SubjectId);
                }
            }

            return result;
        }

        private static IEnumerable<DungeonAccessPredicateV2> EnumerateV2Predicates(DungeonPlanV2 plan)
        {
            foreach (DungeonModuleConnectorPlanV2 connector in plan.Connectors)
                yield return connector.AccessPredicate;
            foreach (DungeonRegionPlanV2 region in plan.Regions)
            foreach (DungeonEnvironmentSupportPlanV2 support in region.SupportedEnvironmentStates)
                yield return support.Predicate;
            foreach (DungeonTraversalEdgePlanV2 edge in plan.TraversalEdges)
                yield return edge.AccessPredicate;
            foreach (DungeonExplorationRoutePlanV2 route in plan.Routes)
            {
                yield return route.RequiredPredicate;
                foreach (DungeonAuthorizedExitPlanV2 exit in route.AuthorizedExits)
                    yield return exit.EarliestAuthorizationPredicate;
            }
            foreach (DungeonDiscoveryPlanV2 discovery in plan.Discoveries)
            {
                yield return discovery.AccessPredicate;
                yield return discovery.RevealPredicate;
            }
            foreach (DungeonShortcutPlanV2 shortcut in plan.Shortcuts)
            {
                yield return shortcut.EarliestAuthorizationPredicate;
                yield return shortcut.EnvironmentStatePredicate;
            }
            foreach (DungeonSurfacePlanV2 surface in plan.Surfaces)
                yield return surface.ActivePredicate;
            foreach (DungeonEnvironmentControllerPlanV2 controller in plan.EnvironmentControllers)
            foreach (DungeonControllerTransitionPlanV2 transition in controller.Transitions)
                yield return transition.ActivationPredicate;
        }

        private bool CommitV2PlanIdentity(DungeonPlanV2 plan, out string error)
        {
            CampaignSession session = CampaignSession.Instance;
            if (session == null || plan == null)
            {
                error = "A campaign session and dungeon plan are required to bind plan identity.";
                return false;
            }

            CampaignStateV1 state = session.Snapshot;
            if (state.expedition == null
                || !string.Equals(state.expedition.expeditionId, campaignAtEntry?.expedition?.expeditionId,
                    StringComparison.Ordinal))
            {
                error = "The durable expedition changed while the dungeon plan was being built.";
                return false;
            }

            if (!TryValidateV2ResumeIdentity(
                    state,
                    plan,
                    out error))
            {
                return false;
            }

            string expectedRuinId = "ruin:" + plan.DeterministicSignature;
            KnownRuinV1 knownRuin = state.knownRuins.FirstOrDefault(value => value != null
                && string.Equals(value.ruinId, expectedRuinId, StringComparison.Ordinal));
            if (knownRuin == null)
            {
                knownRuin = new KnownRuinV1
                {
                    ruinId = state.expedition.ruinId,
                    dungeonPlanId = plan.DeterministicSignature,
                    dungeonProfileId = plan.ProfileId,
                    dungeonRulesetVersion = plan.RulesetVersion,
                    dungeonContentPackVersion = plan.ContentPackVersion,
                    runSeed = plan.Seed,
                    discoveredAtUtc = DateTime.UtcNow.ToString("O"),
                    lastVisitedAtUtc = DateTime.UtcNow.ToString("O")
                };
                state.knownRuins.Add(knownRuin);
                var commit = session.Commit("bind-v2-plan-identity:" + plan.DeterministicSignature, state);
                if (!commit.Success)
                {
                    error = commit.Message ?? "The dungeon plan identity could not be saved.";
                    return false;
                }
            }

            error = null;
            return true;
        }

        private static int QuarantineUnknownValues(
            CampaignStateV1 state,
            List<string> values,
            ISet<string> known,
            string category,
            string path,
            string timestamp)
        {
            if (values == null) return 0;
            int removed = 0;
            for (int index = values.Count - 1; index >= 0; index -= 1)
            {
                string value = values[index];
                if (!string.IsNullOrWhiteSpace(value) && known.Contains(value)) continue;
                values.RemoveAt(index);
                AddV2Quarantine(state, category, value, path, timestamp);
                removed += 1;
            }
            return removed;
        }

        private static void AddV2Quarantine(
            CampaignStateV1 state,
            string category,
            string id,
            string path,
            string timestamp)
        {
            string unknownId = string.IsNullOrWhiteSpace(id) ? "<missing>" : id.Trim();
            if (state.unknownIdQuarantine.Any(value => value != null
                && string.Equals(value.category, category, StringComparison.Ordinal)
                && string.Equals(value.unknownId, unknownId, StringComparison.Ordinal)
                && string.Equals(value.path, path, StringComparison.Ordinal)))
            {
                return;
            }

            state.unknownIdQuarantine.Add(new QuarantinedUnknownIdV1
            {
                category = category,
                unknownId = unknownId,
                path = path,
                quarantinedAtUtc = timestamp
            });
        }

        private void BindV2Progress()
        {
            if (dungeonBuilderV2?.CurrentInstance == null)
            {
                return;
            }

            v2MapChanged = _ => PersistV2Progress("v2-map-knowledge");
            v2EnvironmentChanged = _ => PersistV2Progress("v2-environment-fact");
            dungeonBuilderV2.CurrentInstance.Minimap.ViewChanged += v2MapChanged;
            dungeonBuilderV2.CurrentInstance.Environment.CommittedStateChanged += v2EnvironmentChanged;

            v2RegionEntered = region => ActivateV2RegionEncounters(region?.StableId);
            v2RegionRuntimes = dungeonBuilderV2.CurrentInstance.Root
                .GetComponentsInChildren<DungeonRegionRuntimeV2>(true);
            foreach (DungeonRegionRuntimeV2 region in v2RegionRuntimes)
            {
                region.PlayerEntered += v2RegionEntered;
            }

            v2SafeAnchorReached = HandleV2SafeAnchorReached;
            v2SafeAnchors = dungeonBuilderV2.CurrentInstance.Root
                .GetComponentsInChildren<DungeonSafeAnchorRuntimeV2>(true);
            foreach (DungeonSafeAnchorRuntimeV2 safeAnchor in v2SafeAnchors)
            {
                safeAnchor.PlayerReached += v2SafeAnchorReached;
            }
        }

        private void UnbindV2Progress()
        {
            if (dungeonProgressionV2 != null)
            {
                dungeonProgressionV2.ExtractionRequested -= HandleV2ExtractionRequested;
                dungeonProgressionV2.Unbind();
            }

            DungeonSceneInstanceV2 instance = dungeonBuilderV2?.CurrentInstance;
            if (instance != null)
            {
                if (v2MapChanged != null) instance.Minimap.ViewChanged -= v2MapChanged;
                if (v2EnvironmentChanged != null) instance.Environment.CommittedStateChanged -= v2EnvironmentChanged;
            }

            if (v2RegionEntered != null)
            {
                foreach (DungeonRegionRuntimeV2 region in v2RegionRuntimes)
                {
                    if (region != null) region.PlayerEntered -= v2RegionEntered;
                }
            }

            if (v2SafeAnchorReached != null)
            {
                foreach (DungeonSafeAnchorRuntimeV2 safeAnchor in v2SafeAnchors)
                {
                    if (safeAnchor != null) safeAnchor.PlayerReached -= v2SafeAnchorReached;
                }
            }

            v2MapChanged = null;
            v2EnvironmentChanged = null;
            v2RegionEntered = null;
            v2SafeAnchorReached = null;
            v2RegionRuntimes = Array.Empty<DungeonRegionRuntimeV2>();
            v2SafeAnchors = Array.Empty<DungeonSafeAnchorRuntimeV2>();
        }

        private void HandleV2SafeAnchorReached(string checkpointId)
        {
            CampaignSession session = CampaignSession.Instance;
            if (session == null || string.IsNullOrWhiteSpace(checkpointId))
            {
                return;
            }

            CampaignStateV1 state = session.Snapshot;
            ActiveDungeonProgressV1 progress = state.expedition?.dungeonProgress;
            if (progress == null
                || !string.Equals(
                    state.expedition.dungeonProfileId,
                    ExpeditionFlowController.IndustrialFactoryV2ProfileId,
                    StringComparison.Ordinal)
                || string.Equals(progress.checkpointId, checkpointId, StringComparison.Ordinal))
            {
                return;
            }

            progress.checkpointId = checkpointId;
            session.Commit("v2-checkpoint:" + checkpointId, state);
        }

        private void PersistV2Progress(string operation)
        {
            CampaignSession session = CampaignSession.Instance;
            DungeonSceneInstanceV2 instance = dungeonBuilderV2?.CurrentInstance;
            if (session == null || instance == null)
            {
                return;
            }

            CampaignStateV1 state = session.Snapshot;
            if (state.expedition?.dungeonProgress == null
                || !string.Equals(
                    state.expedition.dungeonProfileId,
                    ExpeditionFlowController.IndustrialFactoryV2ProfileId,
                    StringComparison.Ordinal))
            {
                return;
            }

            ActiveDungeonProgressV1 progress = state.expedition.dungeonProgress;
            DungeonMapKnowledgeStateV2 knowledge = instance.Minimap.CaptureKnowledge();
            DungeonEnvironmentSnapshotV2 environment = instance.Environment.CaptureSnapshot();
            progress.mapKnowledge.seenRegionIds = knowledge.Regions
                .Where(value => value.Level >= DungeonMapKnowledgeLevelV2.Seen)
                .Select(value => value.RegionId)
                .ToList();
            progress.mapKnowledge.visitedRegionIds = knowledge.Regions
                .Where(value => value.Level >= DungeonMapKnowledgeLevelV2.Visited)
                .Select(value => value.RegionId)
                .ToList();
            progress.mapKnowledge.exploredRegionIds = knowledge.Regions
                .Where(value => value.Level >= DungeonMapKnowledgeLevelV2.Explored)
                .Select(value => value.RegionId)
                .ToList();
            progress.mapKnowledge.discoveredConnectionIds = knowledge.DiscoveredTraversalEdgeIds.ToList();
            progress.mapKnowledge.knownLandmarkIds = knowledge.DiscoveredLandmarkIds.ToList();
            progress.mapKnowledge.knownMechanismIds = knowledge.KnownControllerIds.ToList();
            // The scene may open a shortcut speculatively before the campaign
            // transaction returns. Only the once-per-expedition activation
            // claim is allowed to become durable; a failed save must never be
            // laundered into progress by this generic environment observer.
            progress.activatedShortcutIds = SelectTransactionBackedActiveShortcutIds(
                state,
                instance.Plan,
                environment.ActiveShortcutIds).ToList();

            KnownRuinV1 knownRuin = state.knownRuins.FirstOrDefault(value => value != null
                && string.Equals(value.ruinId, state.expedition.ruinId, StringComparison.Ordinal));
            if (knownRuin != null)
            {
                knownRuin.dungeonContentPackVersion = instance.Plan.ContentPackVersion;
                knownRuin.mapKnowledge.recordVersion = DungeonMapKnowledgeV1.CurrentRecordVersion;
                MergeUniqueSorted(
                    knownRuin.mapKnowledge.seenRegionIds,
                    progress.mapKnowledge.seenRegionIds);
                MergeUniqueSorted(
                    knownRuin.mapKnowledge.visitedRegionIds,
                    progress.mapKnowledge.visitedRegionIds);
                MergeUniqueSorted(
                    knownRuin.mapKnowledge.exploredRegionIds,
                    progress.mapKnowledge.exploredRegionIds);
                MergeUniqueSorted(
                    knownRuin.mapKnowledge.discoveredConnectionIds,
                    progress.mapKnowledge.discoveredConnectionIds);
                MergeUniqueSorted(
                    knownRuin.mapKnowledge.knownLandmarkIds,
                    progress.mapKnowledge.knownLandmarkIds);

                // Keys, mechanisms, water/platform/hazard controller state,
                // shortcuts, and enemies belong to the active expedition and
                // deliberately reset on a later visit to the same ruin.
                knownRuin.mapKnowledge.knownMechanismIds.Clear();
                knownRuin.activatedShortcutIds.Clear();
                knownRuin.lastVisitedAtUtc = DateTime.UtcNow.ToString("O");
            }

            DungeonPredicateStateV2 predicateState = instance.Environment.CapturePredicateState();
            progress.requiredItemIds = predicateState.RequiredItemIds.ToList();
            progress.requiredFactIds = predicateState.ProgressionFactIds.ToList();
            progress.permanentFactIds.RemoveAll(value => value.StartsWith("controller:", StringComparison.Ordinal));
            foreach (DungeonControllerStateFactV2 fact in environment.ControllerStates)
            {
                DungeonEnvironmentControllerPlanV2 controller = instance.Plan.EnvironmentControllers
                    .First(value => value.Id == fact.ControllerId);
                bool isCommittedElectricalGrounding =
                    controller.Kind == DungeonEnvironmentControllerKindV2.ElectricCycle
                    && string.Equals(fact.StateId, "Grounded", StringComparison.Ordinal);
                if (controller.Kind == DungeonEnvironmentControllerKindV2.Grounding
                    || controller.Kind == DungeonEnvironmentControllerKindV2.ValveUnlock
                    || controller.Kind == DungeonEnvironmentControllerKindV2.Door
                    || isCommittedElectricalGrounding)
                {
                    progress.permanentFactIds.Add("controller:" + fact.ControllerId + "=" + fact.StateId);
                }
            }

            session.Commit(operation, state);
        }

        public static IReadOnlyList<string> SelectTransactionBackedActiveShortcutIds(
            CampaignStateV1 state,
            DungeonPlanV2 plan,
            IEnumerable<string> runtimeActiveShortcutIds)
        {
            ExpeditionSourceStateV1 expedition = state?.expedition;
            ActiveDungeonProgressV1 progress = expedition?.dungeonProgress;
            if (plan == null
                || progress == null
                || string.IsNullOrWhiteSpace(expedition.expeditionId)
                || string.IsNullOrWhiteSpace(expedition.ruinId))
            {
                return Array.Empty<string>();
            }

            var runtime = new HashSet<string>(
                runtimeActiveShortcutIds ?? Array.Empty<string>(),
                StringComparer.Ordinal);
            var claims = new HashSet<string>(
                progress.claimedRewardIds ?? new List<string>(),
                StringComparer.Ordinal);
            var result = new SortedSet<string>(StringComparer.Ordinal);
            foreach (DungeonDiscoveryPlanV2 discovery in plan.Discoveries.Where(value =>
                         value.Kind == DungeonDiscoveryKindV2.Shortcut
                         && !string.IsNullOrWhiteSpace(value.DurableRewardId)))
            {
                string activationClaim = DungeonRewardTransactionService.CreateExpeditionClaimKey(
                    expedition.expeditionId,
                    expedition.ruinId,
                    discovery.Id + DungeonDiscoveryCommandMapperV2.ShortcutActivationClaimSuffix);
                if (runtime.Contains(discovery.DurableRewardId) && claims.Contains(activationClaim))
                {
                    result.Add(discovery.DurableRewardId);
                }
            }

            return result.ToArray();
        }

        private static void MergeUniqueSorted(List<string> target, IEnumerable<string> values)
        {
            if (target == null || values == null)
            {
                return;
            }

            var known = new HashSet<string>(target, StringComparer.Ordinal);
            foreach (string value in values)
            {
                if (!string.IsNullOrWhiteSpace(value) && known.Add(value.Trim()))
                {
                    target.Add(value.Trim());
                }
            }

            target.Sort(StringComparer.Ordinal);
        }

        private void Subscribe()
        {
            if (subscribed || reaverbotSpawner == null)
            {
                return;
            }

            reaverbotSpawner.RecoveryCollectionRequested += HandleRecoveryCollectionRequested;
            reaverbotSpawner.EnemyDefeated += HandleEnemyDefeated;
            subscribed = true;
        }

        private void Unsubscribe()
        {
            if (!subscribed || reaverbotSpawner == null)
            {
                return;
            }

            reaverbotSpawner.RecoveryCollectionRequested -= HandleRecoveryCollectionRequested;
            reaverbotSpawner.EnemyDefeated -= HandleEnemyDefeated;
            subscribed = false;
        }

        private void HandleEnemyDefeated(
            ReaverbotRuntimeController enemy,
            UnidentifiedReaverbotRecovery _)
        {
            if (enemy == null || enemy != v2FinalGuardian)
            {
                return;
            }

            v2FinalGuardian = null;
            CompleteV2FinalGuardianProgression();
        }

        private void CompleteV2FinalGuardianProgression()
        {
            DungeonSceneInstanceV2 instance = dungeonBuilderV2?.CurrentInstance;
            if (dungeonProgressionV2 == null || instance?.Environment == null)
            {
                return;
            }

            DungeonProgressionOperationResultV2 result =
                dungeonProgressionV2.TryMarkFinalGuardianDefeated();
            if (!result.Success)
            {
                LastError = result.Message ?? result.FailureCode;
                Debug.LogWarning("[RuinCrawler Dungeon] " + LastError, this);
            }
        }

        private void HandleV2ExtractionRequested(DungeonExtractionRequestV2 request)
        {
            ExtractionRequested?.Invoke(request);
            if (!returnToCampOnExtraction || extractionTransitionRequested || request == null)
            {
                return;
            }

            CampaignStateV1 state = CampaignSession.Instance?.Snapshot;
            if (!string.Equals(
                    request.ExpeditionId,
                    state?.expedition?.expeditionId,
                    StringComparison.Ordinal))
            {
                LastError = "The extraction request does not match the active expedition.";
                Debug.LogWarning("[RuinCrawler Dungeon] " + LastError, this);
                return;
            }

            expeditionFlowController ??= ExpeditionFlowController.Instance;
            if (expeditionFlowController == null)
            {
                LastError = "ExpeditionFlowController is unavailable; extraction cannot return to Camp.";
                Debug.LogWarning("[RuinCrawler Dungeon] " + LastError, this);
                return;
            }

            PersistV2Progress("v2-extraction-ready");
            extractionTransitionRequested = expeditionFlowController.ReturnToCamp();
            if (!extractionTransitionRequested)
            {
                LastError = "The successful extraction could not be committed before returning to Camp.";
                Debug.LogWarning("[RuinCrawler Dungeon] " + LastError, this);
            }
        }

        private bool HandleRecoveryCollectionRequested(UnidentifiedReaverbotRecovery recovery)
        {
            CampaignSession session = CampaignSession.Instance;
            if (session == null || recovery == null)
            {
                return false;
            }

            CampaignStateV1 state = session.Snapshot;
            if (state.unidentifiedRecoveries.Any(value =>
                string.Equals(value?.recoveryId, recovery.RecoveryId, StringComparison.Ordinal)))
            {
                return true;
            }

            state.unidentifiedRecoveries.Add(new UnidentifiedRecoveryV1
            {
                recoveryId = recovery.RecoveryId,
                sourceKind = "reaverbot",
                sourceId = recovery.SourceGenomeId,
                sequence = ReaverbotDeterminism.HashSeed(recovery.RecoveryId),
                quantity = 1,
                recoverableParts = recovery.Candidates.Select(candidate => new RecoveryPartV1
                {
                    materialId = candidate.MaterialId,
                    name = candidate.Material.Name,
                    family = candidate.Material.Family,
                    aspect = candidate.Aspect,
                    tier = candidate.Material.Tier,
                    quantity = 1
                }).ToList()
            });
            return session.Commit("collect-reaverbot-recovery:" + recovery.RecoveryId, state).Success;
        }

        private void HandleBossDefeated(BossDefeatedEvent _)
        {
            bossCommitPending = true;
            bossCommitRetryRemaining = 0f;
            TryCommitBossVictory();
        }

        private void TryCommitBossVictory()
        {
            CampaignSession session = CampaignSession.Instance;
            if (session == null || activeBoss == null || !activeBoss.IsDefeated)
            {
                bossCommitRetryRemaining = 1f;
                return;
            }

            BossVictoryResolution resolution = bossHuntCoordinator.Resolve(
                session.Snapshot,
                DateTime.UtcNow.ToString("O"));
            if (!resolution.Transaction.Success)
            {
                Debug.LogWarning(
                    "[RuinCrawler Boss Hunt] "
                    + (resolution.Transaction.Message ?? resolution.Transaction.FailureCode),
                    this);
                bossCommitPending = false;
                return;
            }

            if (!resolution.Transaction.Changed && resolution.Transaction.IdempotentReplay)
            {
                bossCommitPending = false;
                if (bossHuntCoordinator.AcknowledgeCommittedResolution(
                    resolution,
                    session.Snapshot))
                {
                    CompleteV2FinalGuardianProgression();
                }
                return;
            }

            var commit = session.Commit(
                "resolve-boss-victory:" + resolution.Plan.VictoryId,
                resolution.Transaction.State);
            if (!commit.Success)
            {
                bossCommitRetryRemaining = 1f;
                return;
            }

            bossCommitPending = false;
            if (bossHuntCoordinator.AcknowledgeCommittedResolution(
                resolution,
                commit.Envelope.State))
            {
                CompleteV2FinalGuardianProgression();
            }
        }

        private void UnbindBoss()
        {
            if (activeBoss != null)
            {
                activeBoss.Defeated -= HandleBossDefeated;
            }
            activeBoss = null;
        }

        private T ResolveOrAdd<T>(T assigned) where T : Component
        {
            if (assigned != null) return assigned;
            T existing = GetComponent<T>();
            return existing != null ? existing : gameObject.AddComponent<T>();
        }
    }
}
