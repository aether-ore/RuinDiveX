using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Runtime.Player;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    [DisallowMultipleComponent]
    public sealed class DungeonAnchorRuntimeV2 : MonoBehaviour
    {
        public string StableId { get; private set; }
        public string RegionId { get; private set; }
        public DungeonAnchorKindV2 Kind { get; private set; }
        public string ProfileId { get; private set; }

        internal void Configure(DungeonAnchorPlanV2 plan)
        {
            StableId = plan.Id;
            RegionId = plan.RegionId;
            Kind = plan.Kind;
            ProfileId = plan.ProfileId;
        }
    }

    [DisallowMultipleComponent]
    public sealed class DungeonRegionRuntimeV2 : MonoBehaviour
    {
        private DungeonLayeredMinimapComponentV2 minimap;

        public event Action<DungeonRegionRuntimeV2> PlayerEntered;

        public string StableId { get; private set; }
        public string MacroRoleId { get; private set; }
        public string DistrictId { get; private set; }
        public DungeonElevationStratumV2 Stratum { get; private set; }

        internal void Configure(DungeonRegionPlanV2 plan, DungeonLayeredMinimapComponentV2 map)
        {
            StableId = plan.Id;
            MacroRoleId = plan.MacroRoleId;
            DistrictId = plan.BiomeDistrictId;
            Stratum = plan.ElevationStratum;
            minimap = map;
        }

        private void OnTriggerEnter(Collider other)
        {
            if (other != null && other.GetComponentInParent<ProductionPlayerController>() != null)
            {
                minimap?.VisitRegion(StableId);
                PlayerEntered?.Invoke(this);
            }
        }
    }

    [DisallowMultipleComponent]
    public sealed class DungeonFluidZoneRuntimeV2 : MonoBehaviour
    {
        public string StableId { get; private set; }
        public string FluidNetworkId { get; private set; }
        public string RegionId { get; private set; }

        internal void Configure(DungeonFluidZonePlanV2 plan)
        {
            StableId = plan.Id;
            FluidNetworkId = plan.FluidNetworkId;
            RegionId = plan.RegionId;
        }
    }

    [DisallowMultipleComponent]
    public sealed class DungeonFallbackRecoveryV2 : MonoBehaviour
    {
        private Vector3 lastSafePosition;
        private Quaternion lastSafeRotation = Quaternion.identity;

        public int DiagnosticRecoveryCount { get; private set; }
        public Vector3 LastSafePosition => lastSafePosition;

        internal void Configure(Vector3 entrancePosition, Quaternion entranceRotation)
        {
            lastSafePosition = entrancePosition;
            lastSafeRotation = entranceRotation;
            DiagnosticRecoveryCount = 0;
        }

        public void SetLastSafeAnchor(Transform anchor)
        {
            if (anchor == null) return;
            lastSafePosition = anchor.position;
            lastSafeRotation = anchor.rotation;
        }

        private void OnTriggerEnter(Collider other)
        {
            ProductionPlayerController player = other != null
                ? other.GetComponentInParent<ProductionPlayerController>()
                : null;
            if (player == null)
            {
                return;
            }

            DiagnosticRecoveryCount += 1;
            Debug.LogError(
                "[RuinCrawler Dungeon V2] Player reached the technical fallback plane. "
                + "The accepted plan's fall-coverage contract is invalid; recovering without penalty.",
                this);
            CharacterController controller = player.GetComponent<CharacterController>();
            bool enabled = controller != null && controller.enabled;
            if (controller != null) controller.enabled = false;
            player.transform.SetPositionAndRotation(lastSafePosition, lastSafeRotation);
            if (controller != null) controller.enabled = enabled;
        }
    }

    [DisallowMultipleComponent]
    public sealed class DungeonSafeAnchorRuntimeV2 : MonoBehaviour
    {
        private DungeonFallbackRecoveryV2 fallback;

        public event Action<string> PlayerReached;
        public string StableId { get; private set; }

        internal void Configure(DungeonFallbackRecoveryV2 targetFallback)
        {
            fallback = targetFallback;
            StableId = GetComponent<DungeonAnchorRuntimeV2>()?.StableId;
        }

        private void OnTriggerEnter(Collider other)
        {
            if (other != null && other.GetComponentInParent<ProductionPlayerController>() != null)
            {
                fallback?.SetLastSafeAnchor(transform);
                if (!string.IsNullOrWhiteSpace(StableId))
                {
                    PlayerReached?.Invoke(StableId);
                }
            }
        }
    }

    public sealed class DungeonLayeredMapRegionV2
    {
        internal DungeonLayeredMapRegionV2(DungeonRegionPlanV2 plan)
        {
            Id = plan.Id;
            DistrictId = plan.BiomeDistrictId;
            Stratum = plan.ElevationStratum;
            Center = new Vector2(
                (float)(-(plan.Bounds.Minimum.X + plan.Bounds.Maximum.X) * 0.5d),
                (float)((plan.Bounds.Minimum.Z + plan.Bounds.Maximum.Z) * 0.5d));
            Size = new Vector2(
                (float)(plan.Bounds.Maximum.X - plan.Bounds.Minimum.X),
                (float)(plan.Bounds.Maximum.Z - plan.Bounds.Minimum.Z));
        }

        public string Id { get; }
        public string DistrictId { get; }
        public DungeonElevationStratumV2 Stratum { get; }
        public Vector2 Center { get; }
        public Vector2 Size { get; }
    }

    public sealed class DungeonLayeredMapConnectionV2
    {
        internal DungeonLayeredMapConnectionV2(DungeonTraversalEdgePlanV2 edge)
        {
            Id = edge.Id;
            FromRegionId = edge.FromRegionId;
            ToRegionId = edge.ToRegionId;
            Kind = edge.Kind;
            IsProtected = edge.IsProtectedProgressionBoundary;
        }

        public string Id { get; }
        public string FromRegionId { get; }
        public string ToRegionId { get; }
        public DungeonConnectorKindV2 Kind { get; }
        public bool IsProtected { get; }
    }

    public enum DungeonLayeredMapMarkerKindV2
    {
        Console,
        Valve,
        Lift,
        Gate,
        Shortcut,
        Landmark
    }

    /// <summary>
    /// UI-only positioned marker derived from immutable plan anchors/edges.
    /// Stable IDs and positions never change when an environment controller
    /// commits; only StateId may change.
    /// </summary>
    public sealed class DungeonLayeredMapMarkerV2
    {
        internal DungeonLayeredMapMarkerV2(
            string id,
            string regionId,
            DungeonElevationStratumV2 stratum,
            DungeonLayeredMapMarkerKindV2 kind,
            Vector2 position,
            string profileId,
            string stateId)
        {
            Id = id;
            RegionId = regionId;
            Stratum = stratum;
            Kind = kind;
            Position = position;
            ProfileId = profileId;
            StateId = stateId;
        }

        public string Id { get; }
        public string RegionId { get; }
        public DungeonElevationStratumV2 Stratum { get; }
        public DungeonLayeredMapMarkerKindV2 Kind { get; }
        public Vector2 Position { get; }
        public string ProfileId { get; }
        public string StateId { get; }
    }

    /// <summary>
    /// One positioned Waterworks basin on the selected map stratum. A basin
    /// remains in topology while IsFilled follows the committed network state.
    /// </summary>
    public sealed class DungeonLayeredMapBasinV2
    {
        internal DungeonLayeredMapBasinV2(
            string id,
            string networkId,
            string regionId,
            DungeonElevationStratumV2 stratum,
            Vector2 center,
            Vector2 size,
            string configurationId,
            bool isFilled)
        {
            Id = id;
            NetworkId = networkId;
            RegionId = regionId;
            Stratum = stratum;
            Center = center;
            Size = size;
            ConfigurationId = configurationId;
            IsFilled = isFilled;
        }

        public string Id { get; }
        public string NetworkId { get; }
        public string RegionId { get; }
        public DungeonElevationStratumV2 Stratum { get; }
        public Vector2 Center { get; }
        public Vector2 Size { get; }
        public string ConfigurationId { get; }
        public bool IsFilled { get; }
    }

    public sealed class DungeonLayeredMinimapViewStateV2
    {
        internal DungeonLayeredMinimapViewStateV2(
            DungeonElevationStratumV2 selectedStratum,
            DungeonLayeredMapRegionV2[] regions,
            DungeonLayeredMapConnectionV2[] connections,
            DungeonRegionKnowledgeV2[] knowledge,
            string[] knownLandmarkIds,
            string[] knownControllerIds,
            string[] knownShortcutIds,
            DungeonLayeredMapMarkerV2[] markers,
            DungeonLayeredMapBasinV2[] basins,
            string signature)
        {
            SelectedStratum = selectedStratum;
            Regions = Array.AsReadOnly(regions);
            Connections = Array.AsReadOnly(connections);
            RegionKnowledge = Array.AsReadOnly(knowledge);
            KnownLandmarkIds = Array.AsReadOnly(knownLandmarkIds);
            KnownControllerIds = Array.AsReadOnly(knownControllerIds);
            KnownShortcutIds = Array.AsReadOnly(knownShortcutIds);
            Markers = Array.AsReadOnly(markers);
            Basins = Array.AsReadOnly(basins);
            Signature = signature;
        }

        public DungeonElevationStratumV2 SelectedStratum { get; }
        public IReadOnlyList<DungeonLayeredMapRegionV2> Regions { get; }
        public IReadOnlyList<DungeonLayeredMapConnectionV2> Connections { get; }
        public IReadOnlyList<DungeonRegionKnowledgeV2> RegionKnowledge { get; }
        public IReadOnlyList<string> KnownLandmarkIds { get; }
        public IReadOnlyList<string> KnownControllerIds { get; }
        public IReadOnlyList<string> KnownShortcutIds { get; }
        public IReadOnlyList<DungeonLayeredMapMarkerV2> Markers { get; }
        public IReadOnlyList<DungeonLayeredMapBasinV2> Basins { get; }
        public string Signature { get; }
    }

    /// <summary>
    /// Plan-derived, layered and non-omniscient V2 minimap state. It exposes
    /// immutable UI view snapshots while mutable survey knowledge stays in a
    /// small stable-ID ledger suitable for campaign persistence.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DungeonLayeredMinimapComponentV2 : MonoBehaviour
    {
        private readonly Dictionary<string, DungeonMapKnowledgeLevelV2> regionKnowledge =
            new Dictionary<string, DungeonMapKnowledgeLevelV2>(StringComparer.Ordinal);
        private readonly HashSet<string> connections = new HashSet<string>(StringComparer.Ordinal);
        private readonly HashSet<string> landmarks = new HashSet<string>(StringComparer.Ordinal);
        private readonly HashSet<string> controllers = new HashSet<string>(StringComparer.Ordinal);
        private readonly HashSet<string> shortcuts = new HashSet<string>(StringComparer.Ordinal);
        private DungeonPlanV2 plan;
        private DungeonEnvironmentRuntimeV2 environment;
        private DungeonEnvironmentSnapshotV2 environmentSnapshot;
        private DungeonLayeredMapRegionV2[] topologyRegions = Array.Empty<DungeonLayeredMapRegionV2>();
        private DungeonLayeredMapConnectionV2[] topologyConnections = Array.Empty<DungeonLayeredMapConnectionV2>();

        public event Action<DungeonLayeredMinimapViewStateV2> ViewChanged;
        public DungeonElevationStratumV2 SelectedStratum { get; private set; } = DungeonElevationStratumV2.Entry;
        public DungeonLayeredMinimapViewStateV2 ViewState => BuildViewState();

        internal void Configure(DungeonPlanV2 source, DungeonMapKnowledgeStateV2 restored = null)
        {
            UnbindEnvironment();
            plan = source ?? throw new ArgumentNullException(nameof(source));
            topologyRegions = plan.Regions.Select(value => new DungeonLayeredMapRegionV2(value)).ToArray();
            topologyConnections = plan.TraversalEdges
                .Select(value => new DungeonLayeredMapConnectionV2(value)).ToArray();
            regionKnowledge.Clear();
            connections.Clear();
            landmarks.Clear();
            controllers.Clear();
            shortcuts.Clear();

            foreach (DungeonRegionPlanV2 region in plan.Regions)
            {
                regionKnowledge.Add(region.Id, DungeonMapKnowledgeLevelV2.Hidden);
            }

            if (restored != null)
            {
                foreach (DungeonRegionKnowledgeV2 region in restored.Regions)
                {
                    if (regionKnowledge.ContainsKey(region.RegionId)) regionKnowledge[region.RegionId] = region.Level;
                }

                Union(connections, restored.DiscoveredTraversalEdgeIds);
                Union(landmarks, restored.DiscoveredLandmarkIds);
                Union(controllers, restored.KnownControllerIds);
                Union(shortcuts, restored.KnownShortcutIds);
            }

            environment = GetComponent<DungeonEnvironmentRuntimeV2>();
            if (environment != null)
            {
                environmentSnapshot = environment.CaptureSnapshot();
                environment.CommittedStateChanged += HandleEnvironmentChanged;
            }

            SeeRegion(plan.EntranceRegionId);
            Notify();
        }

        private void OnDestroy()
        {
            UnbindEnvironment();
        }

        public void SeeRegion(string regionId)
        {
            RaiseRegion(regionId, DungeonMapKnowledgeLevelV2.Seen);
        }

        public void VisitRegion(string regionId)
        {
            RaiseRegion(regionId, DungeonMapKnowledgeLevelV2.Visited);
            DungeonRegionPlanV2 region = FindRegion(regionId);
            if (region != null) SelectedStratum = region.ElevationStratum;
            foreach (DungeonTraversalEdgePlanV2 edge in plan.TraversalEdges)
            {
                if (edge.Kind == DungeonConnectorKindV2.WaterTunnel
                    && (string.Equals(edge.FromRegionId, regionId, StringComparison.Ordinal)
                        || string.Equals(edge.ToRegionId, regionId, StringComparison.Ordinal)))
                {
                    connections.Add(edge.Id);
                    SeeRegion(string.Equals(edge.FromRegionId, regionId, StringComparison.Ordinal)
                        ? edge.ToRegionId
                        : edge.FromRegionId);
                    EvaluateExplored(edge.FromRegionId);
                    EvaluateExplored(edge.ToRegionId);
                }
            }

            EvaluateExplored(regionId);
            Notify();
        }

        public void SurveyAnchor(string anchorId)
        {
            DungeonAnchorPlanV2 anchor = plan.Anchors.FirstOrDefault(value =>
                string.Equals(value.Id, anchorId, StringComparison.Ordinal));
            if (anchor == null) return;
            if (anchor.Kind == DungeonAnchorKindV2.Landmark) landmarks.Add(anchor.Id);
            if (TryResolveControllerId(anchor, out string controllerId)) controllers.Add(controllerId);
            EvaluateExplored(anchor.RegionId);
            Notify();
        }

        public void RevealConnection(string edgeId)
        {
            DungeonTraversalEdgePlanV2 edge = plan.TraversalEdges.FirstOrDefault(value =>
                string.Equals(value.Id, edgeId, StringComparison.Ordinal));
            if (edge != null)
            {
                connections.Add(edgeId);
                EvaluateExplored(edge.FromRegionId);
                EvaluateExplored(edge.ToRegionId);
                Notify();
            }
        }

        public void RevealShortcut(string shortcutId)
        {
            DungeonShortcutPlanV2 shortcut = plan.Shortcuts.FirstOrDefault(value =>
                string.Equals(value.Id, shortcutId, StringComparison.Ordinal));
            if (shortcut != null)
            {
                shortcuts.Add(shortcutId);
                EvaluateExplored(shortcut.ActivationRegionId);
                Notify();
            }
        }

        public void CycleLayer(int direction)
        {
            int count = Enum.GetValues(typeof(DungeonElevationStratumV2)).Length;
            int next = ((int)SelectedStratum + Math.Sign(direction) + count) % count;
            SelectedStratum = (DungeonElevationStratumV2)next;
            Notify();
        }

        public DungeonMapKnowledgeStateV2 CaptureKnowledge()
        {
            return new DungeonMapKnowledgeStateV2(
                regionKnowledge.Select(pair => new DungeonRegionKnowledgeV2(pair.Key, pair.Value)),
                connections,
                landmarks,
                controllers,
                shortcuts);
        }

        private void EvaluateExplored(string regionId)
        {
            DungeonRegionPlanV2 region = FindRegion(regionId);
            if (region == null || regionKnowledge[regionId] < DungeonMapKnowledgeLevelV2.Visited) return;
            bool connectorsKnown = plan.TraversalEdges
                .Where(value => string.Equals(value.FromRegionId, regionId, StringComparison.Ordinal)
                    || string.Equals(value.ToRegionId, regionId, StringComparison.Ordinal))
                .All(value => connections.Contains(value.Id));
            bool landmarksKnown = region.LandmarkAnchorIds.All(landmarks.Contains);
            bool controllersKnown = region.ConsoleAnchorIds.All(anchorId =>
            {
                DungeonAnchorPlanV2 anchor = plan.Anchors.FirstOrDefault(value =>
                    string.Equals(value.Id, anchorId, StringComparison.Ordinal));
                return TryResolveControllerId(anchor, out string controllerId)
                    && controllers.Contains(controllerId);
            });
            bool shortcutsKnown = plan.Shortcuts
                .Where(value => string.Equals(value.ActivationRegionId, regionId, StringComparison.Ordinal))
                .All(value => shortcuts.Contains(value.Id));
            bool districtRevealAnchorsKnown = plan.Districts
                .Where(value => value.RegionIds.Contains(regionId))
                .SelectMany(value => value.RevealAnchorIds)
                .Select(anchorId => plan.Anchors.FirstOrDefault(anchor =>
                    string.Equals(anchor.Id, anchorId, StringComparison.Ordinal)))
                .Where(anchor => anchor != null
                    && string.Equals(anchor.RegionId, regionId, StringComparison.Ordinal))
                .All(IsRevealAnchorKnown);
            if (connectorsKnown
                && landmarksKnown
                && controllersKnown
                && shortcutsKnown
                && districtRevealAnchorsKnown)
            {
                regionKnowledge[regionId] = DungeonMapKnowledgeLevelV2.Explored;
            }
        }

        private bool IsRevealAnchorKnown(DungeonAnchorPlanV2 anchor)
        {
            if (anchor.Kind == DungeonAnchorKindV2.Landmark)
            {
                return landmarks.Contains(anchor.Id);
            }

            if (TryResolveControllerId(anchor, out string controllerId))
            {
                return controllers.Contains(controllerId);
            }

            if (anchor.Kind == DungeonAnchorKindV2.ShortcutActivation)
            {
                return !string.IsNullOrWhiteSpace(anchor.ProfileId)
                    && shortcuts.Contains(anchor.ProfileId);
            }

            // A district-level reveal anchor with no typed knowledge ledger
            // must not silently count as surveyed. Add a typed ledger before
            // introducing another reveal-anchor kind into a V2 content pack.
            return false;
        }

        private bool TryResolveControllerId(DungeonAnchorPlanV2 anchor, out string controllerId)
        {
            controllerId = null;
            if (anchor == null
                || anchor.Kind != DungeonAnchorKindV2.Console
                || string.IsNullOrWhiteSpace(anchor.ProfileId)
                || !plan.EnvironmentControllers.Any(value =>
                    string.Equals(value.Id, anchor.ProfileId, StringComparison.Ordinal)))
            {
                return false;
            }

            controllerId = anchor.ProfileId;
            return true;
        }

        private void RaiseRegion(string regionId, DungeonMapKnowledgeLevelV2 level)
        {
            if (regionId != null && regionKnowledge.TryGetValue(regionId, out DungeonMapKnowledgeLevelV2 current)
                && level > current)
            {
                regionKnowledge[regionId] = level;
            }
        }

        private DungeonRegionPlanV2 FindRegion(string id)
        {
            return plan?.Regions.FirstOrDefault(value => string.Equals(value.Id, id, StringComparison.Ordinal));
        }

        private DungeonLayeredMinimapViewStateV2 BuildViewState()
        {
            DungeonLayeredMapRegionV2[] visibleRegions = topologyRegions
                .Where(value => value.Stratum == SelectedStratum
                    && regionKnowledge.TryGetValue(value.Id, out DungeonMapKnowledgeLevelV2 level)
                    && level != DungeonMapKnowledgeLevelV2.Hidden)
                .ToArray();
            var visibleIds = new HashSet<string>(visibleRegions.Select(value => value.Id), StringComparer.Ordinal);
            DungeonLayeredMapConnectionV2[] visibleConnections = topologyConnections
                .Where(value => connections.Contains(value.Id)
                    && visibleIds.Contains(value.FromRegionId)
                    && visibleIds.Contains(value.ToRegionId))
                .ToArray();
            DungeonRegionKnowledgeV2[] knowledge = regionKnowledge
                .OrderBy(pair => pair.Key, StringComparer.Ordinal)
                .Select(pair => new DungeonRegionKnowledgeV2(pair.Key, pair.Value))
                .ToArray();
            DungeonLayeredMapMarkerV2[] markers = BuildVisibleMarkers(visibleIds);
            DungeonLayeredMapBasinV2[] basins = BuildVisibleBasins(visibleIds);
            string signature = StableHash(plan?.DeterministicSignature + "|" + SelectedStratum + "|"
                + string.Join(",", knowledge.Select(value => value.RegionId + ":" + value.Level)) + "|"
                + string.Join(",", connections.OrderBy(value => value, StringComparer.Ordinal)) + "|"
                + string.Join(",", markers.Select(value => value.Id + ":" + value.StateId)) + "|"
                + string.Join(",", basins.Select(value => value.Id + ":" + value.ConfigurationId + ":" + value.IsFilled)));
            return new DungeonLayeredMinimapViewStateV2(
                SelectedStratum,
                visibleRegions,
                visibleConnections,
                knowledge,
                landmarks.OrderBy(value => value, StringComparer.Ordinal).ToArray(),
                controllers.OrderBy(value => value, StringComparer.Ordinal).ToArray(),
                shortcuts.OrderBy(value => value, StringComparer.Ordinal).ToArray(),
                markers,
                basins,
                signature);
        }

        private DungeonLayeredMapMarkerV2[] BuildVisibleMarkers(HashSet<string> visibleRegionIds)
        {
            var result = new List<DungeonLayeredMapMarkerV2>();
            var regions = plan.Regions.ToDictionary(value => value.Id, StringComparer.Ordinal);
            var controllerPlans = plan.EnvironmentControllers.ToDictionary(value => value.Id, StringComparer.Ordinal);
            var controllerStates = (environmentSnapshot?.ControllerStates
                    ?? Array.Empty<DungeonControllerStateFactV2>())
                .ToDictionary(value => value.ControllerId, value => value.StateId, StringComparer.Ordinal);
            var activeShortcuts = new HashSet<string>(
                environmentSnapshot?.ActiveShortcutIds ?? Array.Empty<string>(),
                StringComparer.Ordinal);
            DungeonPredicateStateV2 predicateState = environment?.CapturePredicateState();

            foreach (DungeonAnchorPlanV2 anchor in plan.Anchors)
            {
                if (!visibleRegionIds.Contains(anchor.RegionId)
                    || !regions.TryGetValue(anchor.RegionId, out DungeonRegionPlanV2 region))
                {
                    continue;
                }

                DungeonLayeredMapMarkerKindV2 kind;
                bool known;
                if (anchor.Kind == DungeonAnchorKindV2.Landmark)
                {
                    kind = DungeonLayeredMapMarkerKindV2.Landmark;
                    known = landmarks.Contains(anchor.Id);
                }
                else if (anchor.Kind == DungeonAnchorKindV2.ShortcutActivation)
                {
                    kind = DungeonLayeredMapMarkerKindV2.Shortcut;
                    known = shortcuts.Contains(anchor.ProfileId ?? string.Empty);
                }
                else if (anchor.Kind == DungeonAnchorKindV2.Console)
                {
                    string controllerId = anchor.ProfileId ?? anchor.Id;
                    known = controllers.Contains(controllerId);
                    kind = controllerPlans.TryGetValue(controllerId, out DungeonEnvironmentControllerPlanV2 controller)
                        && controller.Kind == DungeonEnvironmentControllerKindV2.ValveUnlock
                        ? DungeonLayeredMapMarkerKindV2.Valve
                        : DungeonLayeredMapMarkerKindV2.Console;
                }
                else
                {
                    continue;
                }

                if (!known) continue;
                string profileId = anchor.ProfileId ?? anchor.Id;
                string stateId;
                if (kind == DungeonLayeredMapMarkerKindV2.Shortcut)
                {
                    stateId = activeShortcuts.Contains(profileId) ? "Active" : "Inactive";
                }
                else
                {
                    controllerStates.TryGetValue(profileId, out stateId);
                }
                result.Add(new DungeonLayeredMapMarkerV2(
                    anchor.Id,
                    anchor.RegionId,
                    region.ElevationStratum,
                    kind,
                    new Vector2((float)-anchor.Position.X, (float)anchor.Position.Z),
                    profileId,
                    stateId));
            }

            foreach (DungeonTraversalEdgePlanV2 edge in plan.TraversalEdges)
            {
                DungeonLayeredMapMarkerKindV2 kind;
                if (edge.Kind == DungeonConnectorKindV2.Lift
                    || edge.Kind == DungeonConnectorKindV2.MovingPlatform)
                {
                    kind = DungeonLayeredMapMarkerKindV2.Lift;
                }
                else if (edge.Kind == DungeonConnectorKindV2.Door
                    || edge.IsProtectedProgressionBoundary)
                {
                    kind = DungeonLayeredMapMarkerKindV2.Gate;
                }
                else
                {
                    continue;
                }

                if (!connections.Contains(edge.Id)
                    || !regions.TryGetValue(edge.FromRegionId, out DungeonRegionPlanV2 from)
                    || !regions.TryGetValue(edge.ToRegionId, out DungeonRegionPlanV2 to))
                {
                    continue;
                }

                Vector2 fromCenter = new Vector2(
                    (float)(-(from.Bounds.Minimum.X + from.Bounds.Maximum.X) * 0.5d),
                    (float)((from.Bounds.Minimum.Z + from.Bounds.Maximum.Z) * 0.5d));
                Vector2 toCenter = new Vector2(
                    (float)(-(to.Bounds.Minimum.X + to.Bounds.Maximum.X) * 0.5d),
                    (float)((to.Bounds.Minimum.Z + to.Bounds.Maximum.Z) * 0.5d));
                bool accessible = predicateState != null
                    && DungeonPredicateEvaluatorV2.Evaluate(edge.AccessPredicate, predicateState);
                string stateId = edge.IsProtectedProgressionBoundary
                    ? accessible ? "Open" : "Locked"
                    : accessible ? "Available" : "Unavailable";
                if (from.ElevationStratum == to.ElevationStratum)
                {
                    if (from.ElevationStratum == SelectedStratum
                        && visibleRegionIds.Contains(from.Id)
                        && visibleRegionIds.Contains(to.Id))
                    {
                        result.Add(new DungeonLayeredMapMarkerV2(
                            "marker-" + edge.Id,
                            from.Id,
                            from.ElevationStratum,
                            kind,
                            (fromCenter + toCenter) * 0.5f,
                            edge.Id,
                            stateId));
                    }

                    continue;
                }

                if (from.ElevationStratum == SelectedStratum && visibleRegionIds.Contains(from.Id))
                {
                    result.Add(new DungeonLayeredMapMarkerV2(
                        "marker-" + edge.Id + "-from",
                        from.Id,
                        from.ElevationStratum,
                        kind,
                        fromCenter,
                        edge.Id,
                        stateId));
                }
                if (to.ElevationStratum == SelectedStratum && visibleRegionIds.Contains(to.Id))
                {
                    result.Add(new DungeonLayeredMapMarkerV2(
                        "marker-" + edge.Id + "-to",
                        to.Id,
                        to.ElevationStratum,
                        kind,
                        toCenter,
                        edge.Id,
                        stateId));
                }
            }

            return result.OrderBy(value => value.Id, StringComparer.Ordinal).ToArray();
        }

        private DungeonLayeredMapBasinV2[] BuildVisibleBasins(HashSet<string> visibleRegionIds)
        {
            var regionById = plan.Regions.ToDictionary(value => value.Id, StringComparer.Ordinal);
            var committed = (environmentSnapshot?.FluidNetworkStates
                    ?? Array.Empty<DungeonFluidNetworkStateV2>())
                .ToDictionary(value => value.FluidNetworkId, value => value.CommittedConfigurationId,
                    StringComparer.Ordinal);
            var result = new List<DungeonLayeredMapBasinV2>();
            foreach (DungeonFluidZonePlanV2 zone in plan.FluidZones)
            {
                if (!visibleRegionIds.Contains(zone.RegionId)
                    || !regionById.TryGetValue(zone.RegionId, out DungeonRegionPlanV2 region))
                {
                    continue;
                }

                committed.TryGetValue(zone.FluidNetworkId, out string configurationId);
                bool filled = !string.IsNullOrWhiteSpace(configurationId)
                    && zone.ActiveConfigurationIds.Contains(configurationId);
                double minimumX = zone.Volume.HorizontalVertices.Min(value => value.X);
                double maximumX = zone.Volume.HorizontalVertices.Max(value => value.X);
                double minimumZ = zone.Volume.HorizontalVertices.Min(value => value.Z);
                double maximumZ = zone.Volume.HorizontalVertices.Max(value => value.Z);
                result.Add(new DungeonLayeredMapBasinV2(
                    zone.Id,
                    zone.FluidNetworkId,
                    zone.RegionId,
                    region.ElevationStratum,
                    new Vector2((float)(-(minimumX + maximumX) * 0.5d), (float)((minimumZ + maximumZ) * 0.5d)),
                    new Vector2((float)(maximumX - minimumX), (float)(maximumZ - minimumZ)),
                    configurationId,
                    filled));
            }

            return result.OrderBy(value => value.Id, StringComparer.Ordinal).ToArray();
        }

        private void HandleEnvironmentChanged(DungeonEnvironmentSnapshotV2 snapshot)
        {
            environmentSnapshot = snapshot;
            Notify();
        }

        private void UnbindEnvironment()
        {
            if (environment != null)
            {
                environment.CommittedStateChanged -= HandleEnvironmentChanged;
            }

            environment = null;
            environmentSnapshot = null;
        }

        private void Notify()
        {
            if (plan != null) ViewChanged?.Invoke(BuildViewState());
        }

        private static void Union(HashSet<string> target, IEnumerable<string> values)
        {
            foreach (string value in values ?? Array.Empty<string>())
            {
                if (!string.IsNullOrWhiteSpace(value)) target.Add(value);
            }
        }

        private static string StableHash(string value)
        {
            unchecked
            {
                uint hash = 2166136261u;
                foreach (char character in value ?? string.Empty)
                {
                    hash ^= character;
                    hash *= 16777619u;
                }

                return hash.ToString("x8", CultureInfo.InvariantCulture);
            }
        }
    }

    public sealed class DungeonSceneInstanceV2
    {
        private readonly List<DungeonLocalNavigationRuntimeV2> localNavigation =
            new List<DungeonLocalNavigationRuntimeV2>();

        internal DungeonSceneInstanceV2(
            GameObject root,
            DungeonPlanV2 plan,
            DungeonEnvironmentRuntimeV2 environment,
            DungeonLayeredMinimapComponentV2 minimap,
            DungeonFallbackRecoveryV2 fallback)
        {
            Root = root;
            Plan = plan;
            Environment = environment;
            Minimap = minimap;
            Fallback = fallback;
        }

        public GameObject Root { get; }
        public DungeonPlanV2 Plan { get; }
        public DungeonEnvironmentRuntimeV2 Environment { get; }
        public DungeonLayeredMinimapComponentV2 Minimap { get; }
        public DungeonFallbackRecoveryV2 Fallback { get; }
        public IReadOnlyList<DungeonLocalNavigationRuntimeV2> LocalNavigation => localNavigation;
        public int SurfaceCount { get; internal set; }
        public int FluidZoneCount { get; internal set; }
        public int RegionCount { get; internal set; }
        public int AnchorCount { get; internal set; }
        public int HazardSurfaceCount { get; internal set; }

        internal void AddLocalNavigation(DungeonLocalNavigationRuntimeV2 navigation)
        {
            if (navigation != null)
            {
                localNavigation.Add(navigation);
            }
        }

        internal void ReleaseNavigationData()
        {
            for (int index = localNavigation.Count - 1; index >= 0; index -= 1)
            {
                DungeonLocalNavigationRuntimeV2 navigation = localNavigation[index];
                if (navigation != null)
                {
                    navigation.ReleaseOwnedResources();
                }
            }
        }
    }
}
