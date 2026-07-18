using System;
using System.Collections.Generic;
using System.Linq;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Runtime.Player;
using UnityEngine;
using UnityEngine.InputSystem;

namespace RuinCrawler.Runtime.Dungeon
{
    internal static class DungeonInteractionInputV2
    {
        public static bool WasPressedThisFrame()
        {
            return Keyboard.current?.fKey.wasPressedThisFrame == true
                || Gamepad.current?.buttonWest.wasPressedThisFrame == true;
        }
    }

    [DisallowMultipleComponent]
    public sealed class DungeonKeySeekerRuntimeV2 : MonoBehaviour
    {
        [SerializeField, Min(0.5f)] private float interactionRadius = 2.75f;
        private DungeonPlanV2 plan;
        private DungeonEnvironmentRuntimeV2 environment;
        private DungeonLayeredMinimapComponentV2 minimap;
        private ProductionPlayerController player;
        private TextMesh prompt;

        public IReadOnlyList<string> LastRevealedEdgeIds { get; private set; } = Array.Empty<string>();
        public bool IsPlayerInRange => ResolvePlayer() != null
            && Vector3.SqrMagnitude(player.transform.position - transform.position)
                <= interactionRadius * interactionRadius;

        internal void Configure(
            DungeonPlanV2 sourcePlan,
            DungeonEnvironmentRuntimeV2 runtimeEnvironment,
            DungeonLayeredMinimapComponentV2 runtimeMinimap,
            TextMesh interactionPrompt)
        {
            plan = sourcePlan;
            environment = runtimeEnvironment;
            minimap = runtimeMinimap;
            prompt = interactionPrompt;
        }

        public bool Activate()
        {
            if (plan == null || environment == null || minimap == null)
            {
                return false;
            }

            DungeonPredicateStateV2 state = environment.CapturePredicateState();
            DungeonExplorationRoutePlanV2 route = plan.Routes
                .Where(value => value.Role == DungeonRouteRoleV2.Critical)
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .FirstOrDefault(value => DungeonPredicateEvaluatorV2.Evaluate(value.RequiredPredicate, state));
            if (route == null)
            {
                return false;
            }

            string objectiveRegionId = ResolveNextRequiredObjectiveRegion(route, state);
            IReadOnlyList<DungeonTraversalEdgePlanV2> path = FindAuthorizedPath(
                plan.EntranceRegionId,
                objectiveRegionId,
                state);
            if (path.Count == 0 && !string.Equals(
                    plan.EntranceRegionId,
                    objectiveRegionId,
                    StringComparison.Ordinal))
            {
                return false;
            }

            var revealed = new List<string>(path.Count);
            foreach (DungeonTraversalEdgePlanV2 edge in path)
            {
                minimap.RevealConnection(edge.Id);
                minimap.SeeRegion(edge.FromRegionId);
                revealed.Add(edge.Id);
                minimap.SeeRegion(edge.ToRegionId);
            }

            LastRevealedEdgeIds = Array.AsReadOnly(revealed.ToArray());
            return revealed.Count > 0;
        }

        private string ResolveNextRequiredObjectiveRegion(
            DungeonExplorationRoutePlanV2 criticalRoute,
            DungeonPredicateStateV2 state)
        {
            foreach (string edgeId in criticalRoute.OrderedTraversalEdgeIds)
            {
                DungeonTraversalEdgePlanV2 edge = plan.TraversalEdges.First(value =>
                    string.Equals(value.Id, edgeId, StringComparison.Ordinal));
                if (DungeonPredicateEvaluatorV2.Evaluate(edge.AccessPredicate, state))
                {
                    continue;
                }

                foreach (DungeonPredicateClauseV2 clause in edge.AccessPredicate.Clauses)
                {
                    foreach (DungeonPredicateConditionV2 condition in clause.Conditions)
                    {
                        if (condition.Kind == DungeonPredicateConditionKindV2.ControllerState
                            && condition.Operator == DungeonPredicateOperatorV2.Equals)
                        {
                            DungeonAnchorPlanV2 console = plan.Anchors
                                .Where(value => value.Kind == DungeonAnchorKindV2.Console
                                    && string.Equals(value.ProfileId, condition.SubjectId, StringComparison.Ordinal))
                                .OrderBy(value => value.Id, StringComparer.Ordinal)
                                .FirstOrDefault();
                            if (console != null) return console.RegionId;
                        }

                        if (condition.Kind == DungeonPredicateConditionKindV2.RequiredItem
                            && condition.Operator == DungeonPredicateOperatorV2.IsPresent)
                        {
                            DungeonDiscoveryPlanV2 discovery = plan.Discoveries
                                .Where(value => string.Equals(
                                    value.DurableRewardId,
                                    condition.SubjectId,
                                    StringComparison.Ordinal))
                                .OrderBy(value => value.Id, StringComparer.Ordinal)
                                .FirstOrDefault();
                            DungeonAnchorPlanV2 anchor = discovery == null
                                ? null
                                : plan.Anchors.FirstOrDefault(value => string.Equals(
                                    value.Id,
                                    discovery.LocationAnchorId,
                                    StringComparison.Ordinal));
                            if (anchor != null) return anchor.RegionId;
                        }

                        if (condition.Kind == DungeonPredicateConditionKindV2.ShortcutState
                            && condition.Operator == DungeonPredicateOperatorV2.IsPresent)
                        {
                            DungeonShortcutPlanV2 shortcut = plan.Shortcuts.FirstOrDefault(value =>
                                string.Equals(value.Id, condition.SubjectId, StringComparison.Ordinal));
                            if (shortcut != null) return shortcut.ActivationRegionId;
                        }
                    }
                }

                return edge.FromRegionId;
            }

            return plan.ExtractionRegionId;
        }

        private IReadOnlyList<DungeonTraversalEdgePlanV2> FindAuthorizedPath(
            string startRegionId,
            string destinationRegionId,
            DungeonPredicateStateV2 state)
        {
            if (string.Equals(startRegionId, destinationRegionId, StringComparison.Ordinal))
            {
                return Array.Empty<DungeonTraversalEdgePlanV2>();
            }

            var frontier = new Queue<string>();
            var visited = new HashSet<string>(StringComparer.Ordinal) { startRegionId };
            var previous = new Dictionary<string, DungeonTraversalEdgePlanV2>(StringComparer.Ordinal);
            frontier.Enqueue(startRegionId);
            while (frontier.Count > 0)
            {
                string regionId = frontier.Dequeue();
                foreach (DungeonTraversalEdgePlanV2 edge in plan.TraversalEdges
                    .Where(value => string.Equals(value.FromRegionId, regionId, StringComparison.Ordinal)
                        && DungeonPredicateEvaluatorV2.Evaluate(value.AccessPredicate, state))
                    .OrderBy(value => value.Id, StringComparer.Ordinal))
                {
                    if (!visited.Add(edge.ToRegionId)) continue;
                    previous.Add(edge.ToRegionId, edge);
                    if (string.Equals(edge.ToRegionId, destinationRegionId, StringComparison.Ordinal))
                    {
                        return ReconstructPath(startRegionId, destinationRegionId, previous);
                    }
                    frontier.Enqueue(edge.ToRegionId);
                }
            }

            return Array.Empty<DungeonTraversalEdgePlanV2>();
        }

        private static IReadOnlyList<DungeonTraversalEdgePlanV2> ReconstructPath(
            string startRegionId,
            string destinationRegionId,
            IReadOnlyDictionary<string, DungeonTraversalEdgePlanV2> previous)
        {
            var reversed = new List<DungeonTraversalEdgePlanV2>();
            string cursor = destinationRegionId;
            while (!string.Equals(cursor, startRegionId, StringComparison.Ordinal))
            {
                if (!previous.TryGetValue(cursor, out DungeonTraversalEdgePlanV2 edge))
                {
                    return Array.Empty<DungeonTraversalEdgePlanV2>();
                }
                reversed.Add(edge);
                cursor = edge.FromRegionId;
            }
            reversed.Reverse();
            return Array.AsReadOnly(reversed.ToArray());
        }

        private void Update()
        {
            bool nearby = IsPlayerInRange;
            if (prompt != null)
            {
                prompt.gameObject.SetActive(nearby);
                if (nearby) FacePrompt(prompt.transform);
            }

            if (nearby && DungeonInteractionInputV2.WasPressedThisFrame()) Activate();
        }

        private ProductionPlayerController ResolvePlayer()
        {
            player ??= FindAnyObjectByType<ProductionPlayerController>();
            return player;
        }

        private static void FacePrompt(Transform target)
        {
            if (target == null || Camera.main == null) return;
            Vector3 facing = Vector3.ProjectOnPlane(Camera.main.transform.position - target.position, Vector3.up);
            if (facing.sqrMagnitude > 0.0001f) target.rotation = Quaternion.LookRotation(-facing, Vector3.up);
        }
    }

    [DisallowMultipleComponent]
    public sealed class DungeonEnvironmentConsoleRuntimeV2 : MonoBehaviour
    {
        private const string WaterTransferGameplayLockId = "dungeon-v2-water-transfer";
        [SerializeField, Min(0.5f)] private float interactionRadius = 2.5f;
        private string controllerId;
        private DungeonEnvironmentRuntimeV2 environment;
        private DungeonLayeredMinimapComponentV2 minimap;
        private ProductionPlayerController lockedPlayer;
        private TextMesh prompt;
        private bool ownsGameplayLock;

        public string ControllerId => controllerId;
        public bool LastActivationWasIdempotentReplay { get; private set; }
        public bool IsPlayerInRange
        {
            get
            {
                ProductionPlayerController candidate = ResolveNearestActivePlayer();
                return IsWithinInteractionRange(candidate);
            }
        }

        internal void Configure(
            string stableControllerId,
            DungeonEnvironmentRuntimeV2 runtimeEnvironment,
            DungeonLayeredMinimapComponentV2 runtimeMinimap,
            TextMesh interactionPrompt)
        {
            if (environment != null)
            {
                environment.TransitionCancelled -= HandleTransitionCancelled;
                environment.CommittedStateChanged -= HandleCommittedStateChanged;
            }
            controllerId = stableControllerId;
            environment = runtimeEnvironment;
            minimap = runtimeMinimap;
            prompt = interactionPrompt;
            LastActivationWasIdempotentReplay = false;
            if (environment != null)
            {
                environment.TransitionCancelled -= HandleTransitionCancelled;
                environment.TransitionCancelled += HandleTransitionCancelled;
                environment.CommittedStateChanged -= HandleCommittedStateChanged;
                environment.CommittedStateChanged += HandleCommittedStateChanged;
            }
        }

        public bool TryActivateNextTransition()
        {
            LastActivationWasIdempotentReplay = false;
            DungeonEnvironmentControllerPlanV2 controller = environment?.Plan?.EnvironmentControllers
                .FirstOrDefault(value => string.Equals(value.Id, controllerId, StringComparison.Ordinal));
            if (controller == null || environment.IsTransitionInProgress)
            {
                return false;
            }

            string current = environment.GetControllerState(controllerId);
            DungeonPredicateStateV2 state = environment.CapturePredicateState();
            IEnumerable<DungeonControllerTransitionPlanV2> eligible = controller.Transitions
                .Where(value => string.Equals(value.FromStateId, current, StringComparison.Ordinal)
                    && DungeonPredicateEvaluatorV2.Evaluate(value.ActivationPredicate, state));
            string preferredTarget = controller.Kind == DungeonEnvironmentControllerKindV2.WaterRouting
                ? NextWaterRoutingState(current)
                : null;
            DungeonControllerTransitionPlanV2 transition = eligible
                .OrderBy(value => string.Equals(value.ToStateId, preferredTarget, StringComparison.Ordinal) ? 0 : 1)
                .ThenBy(value => value.Id, StringComparer.Ordinal)
                .FirstOrDefault();
            if (transition == null)
            {
                if (controller.Kind == DungeonEnvironmentControllerKindV2.ElectricCycle
                    && string.Equals(current, "Grounded", StringComparison.Ordinal))
                {
                    LastActivationWasIdempotentReplay = true;
                    SurveyConsoleAnchor();
                    return true;
                }

                return false;
            }

            return TryActivateTransition(transition);
        }

        /// <summary>
        /// Operates a multi-state console toward an explicit stable state. This is the
        /// selection seam used by future UI Toolkit controls; ordinary world interaction
        /// follows the profile's deterministic critical-first cycle.
        /// </summary>
        public bool TryActivateTransitionToState(string targetStateId)
        {
            LastActivationWasIdempotentReplay = false;
            if (string.IsNullOrWhiteSpace(targetStateId) || environment == null
                || environment.IsTransitionInProgress)
            {
                return false;
            }

            DungeonEnvironmentControllerPlanV2 controller = environment.Plan?.EnvironmentControllers
                .FirstOrDefault(value => string.Equals(value.Id, controllerId, StringComparison.Ordinal));
            if (controller == null)
            {
                return false;
            }

            string current = environment.GetControllerState(controllerId);
            DungeonPredicateStateV2 state = environment.CapturePredicateState();
            DungeonControllerTransitionPlanV2 transition = controller.Transitions
                .Where(value => string.Equals(value.FromStateId, current, StringComparison.Ordinal)
                    && string.Equals(value.ToStateId, targetStateId, StringComparison.Ordinal)
                    && DungeonPredicateEvaluatorV2.Evaluate(value.ActivationPredicate, state))
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .FirstOrDefault();
            return TryActivateTransition(transition);
        }

        private bool TryActivateTransition(DungeonControllerTransitionPlanV2 transition)
        {
            if (transition == null || !environment.TryBeginTransition(controllerId, transition.Id))
            {
                return false;
            }

            if (transition.PresentationSeconds > 0d)
            {
                ProductionPlayerController target = ResolveNearestActivePlayer();
                if (IsWithinInteractionRange(target))
                {
                    target.SetGameplayLock(WaterTransferGameplayLockId, true);
                    lockedPlayer = target;
                    ownsGameplayLock = true;
                }
            }

            SurveyConsoleAnchor();
            return true;
        }

        private static string NextWaterRoutingState(string current)
        {
            if (string.Equals(current, IndustrialFactoryV2Ruleset.FreightSumpFilled, StringComparison.Ordinal))
            {
                return IndustrialFactoryV2Ruleset.StoredInReservoir;
            }

            if (string.Equals(current, IndustrialFactoryV2Ruleset.StoredInReservoir, StringComparison.Ordinal))
            {
                return IndustrialFactoryV2Ruleset.GantrySumpFilled;
            }

            if (string.Equals(current, IndustrialFactoryV2Ruleset.GantrySumpFilled, StringComparison.Ordinal))
            {
                return IndustrialFactoryV2Ruleset.FreightSumpFilled;
            }

            return null;
        }

        private void SurveyConsoleAnchor()
        {
            minimap?.SurveyAnchor(gameObject.name.StartsWith("Anchor_", StringComparison.Ordinal)
                ? gameObject.name.Substring("Anchor_".Length)
                : gameObject.name);
        }

        private void Update()
        {
            bool nearby = IsPlayerInRange;
            if (prompt != null)
            {
                prompt.gameObject.SetActive(nearby);
                if (nearby && Camera.main != null)
                {
                    Vector3 facing = Vector3.ProjectOnPlane(
                        Camera.main.transform.position - prompt.transform.position,
                        Vector3.up);
                    if (facing.sqrMagnitude > 0.0001f)
                    {
                        prompt.transform.rotation = Quaternion.LookRotation(-facing, Vector3.up);
                    }
                }
            }

            if (nearby && DungeonInteractionInputV2.WasPressedThisFrame()) TryActivateNextTransition();
        }

        private ProductionPlayerController ResolveNearestActivePlayer()
        {
            ProductionPlayerController nearest = null;
            float nearestDistanceSquared = float.PositiveInfinity;
            ProductionPlayerController[] candidates = FindObjectsByType<ProductionPlayerController>(
                FindObjectsInactive.Exclude,
                FindObjectsSortMode.InstanceID);
            foreach (ProductionPlayerController candidate in candidates)
            {
                if (candidate == null || !candidate.isActiveAndEnabled)
                {
                    continue;
                }

                float distanceSquared = Vector3.SqrMagnitude(
                    candidate.transform.position - transform.position);
                if (distanceSquared < nearestDistanceSquared)
                {
                    nearest = candidate;
                    nearestDistanceSquared = distanceSquared;
                }
            }

            return nearest;
        }

        private bool IsWithinInteractionRange(ProductionPlayerController candidate)
        {
            return candidate != null
                && Vector3.SqrMagnitude(candidate.transform.position - transform.position)
                    <= interactionRadius * interactionRadius;
        }

        private void HandleTransitionCancelled(string cancelledControllerId, string _)
        {
            if (string.Equals(cancelledControllerId, controllerId, StringComparison.Ordinal))
            {
                ReleaseGameplayLock();
            }
        }

        private void HandleCommittedStateChanged(DungeonEnvironmentSnapshotV2 _)
        {
            if (environment != null && !environment.IsTransitionInProgress)
            {
                ReleaseGameplayLock();
            }
        }

        private void ReleaseGameplayLock()
        {
            if (!ownsGameplayLock) return;
            if (lockedPlayer != null)
            {
                lockedPlayer.SetGameplayLock(WaterTransferGameplayLockId, false);
            }
            lockedPlayer = null;
            ownsGameplayLock = false;
        }

        private void OnDisable()
        {
            if (ownsGameplayLock
                && environment != null
                && string.Equals(environment.PendingControllerId, controllerId, StringComparison.Ordinal))
            {
                environment.CancelPendingTransition();
            }
            ReleaseGameplayLock();
        }

        private void OnDestroy()
        {
            if (environment != null)
            {
                environment.TransitionCancelled -= HandleTransitionCancelled;
                environment.CommittedStateChanged -= HandleCommittedStateChanged;
            }
            ReleaseGameplayLock();
        }
    }

    [DisallowMultipleComponent]
    public sealed class DungeonShortcutInteractionRuntimeV2 : MonoBehaviour
    {
        [SerializeField, Min(0.5f)] private float interactionRadius = 2.5f;
        private string shortcutId;
        private DungeonEnvironmentRuntimeV2 environment;
        private DungeonLayeredMinimapComponentV2 minimap;
        private ProductionPlayerController player;
        private TextMesh prompt;

        public string ShortcutId => shortcutId;
        public bool IsPlayerInRange => ResolvePlayer() != null
            && Vector3.SqrMagnitude(player.transform.position - transform.position)
                <= interactionRadius * interactionRadius;

        internal void Configure(
            string stableShortcutId,
            DungeonEnvironmentRuntimeV2 runtimeEnvironment,
            DungeonLayeredMinimapComponentV2 runtimeMinimap,
            TextMesh interactionPrompt)
        {
            shortcutId = stableShortcutId;
            environment = runtimeEnvironment;
            minimap = runtimeMinimap;
            prompt = interactionPrompt;
        }

        public bool Activate()
        {
            DungeonShortcutPlanV2 shortcut = environment?.Plan?.Shortcuts.FirstOrDefault(value =>
                string.Equals(value.Id, shortcutId, StringComparison.Ordinal));
            DungeonPredicateStateV2 state = environment?.CapturePredicateState();
            if (shortcut == null
                || state == null
                || !DungeonPredicateEvaluatorV2.Evaluate(shortcut.EarliestAuthorizationPredicate, state)
                || !DungeonPredicateEvaluatorV2.Evaluate(shortcut.EnvironmentStatePredicate, state))
            {
                return false;
            }

            bool changed = environment.ActivateShortcut(shortcut.Id);
            minimap?.RevealShortcut(shortcut.Id);
            foreach (string edgeId in shortcut.UnlockedTraversalEdgeIds)
            {
                minimap?.RevealConnection(edgeId);
            }

            return changed;
        }

        private void Update()
        {
            bool nearby = IsPlayerInRange;
            if (prompt != null)
            {
                prompt.gameObject.SetActive(nearby);
                if (nearby && Camera.main != null)
                {
                    Vector3 facing = Vector3.ProjectOnPlane(
                        Camera.main.transform.position - prompt.transform.position,
                        Vector3.up);
                    if (facing.sqrMagnitude > 0.0001f)
                    {
                        prompt.transform.rotation = Quaternion.LookRotation(-facing, Vector3.up);
                    }
                }
            }

            if (nearby && DungeonInteractionInputV2.WasPressedThisFrame()) Activate();
        }

        private ProductionPlayerController ResolvePlayer()
        {
            player ??= FindAnyObjectByType<ProductionPlayerController>();
            return player;
        }
    }

    [DisallowMultipleComponent]
    public sealed class DungeonLiftInteractionRuntimeV2 : MonoBehaviour
    {
        [SerializeField, Min(0.5f)] private float interactionRadius = 2.5f;
        private DungeonTraversalEdgePlanV2 edge;
        private Transform destination;
        private DungeonEnvironmentRuntimeV2 environment;
        private DungeonLayeredMinimapComponentV2 minimap;
        private ProductionPlayerController player;
        private TextMesh prompt;

        public string EdgeId => edge?.Id;
        public bool IsPlayerInRange => ResolvePlayer() != null
            && Vector3.SqrMagnitude(player.transform.position - transform.position)
                <= interactionRadius * interactionRadius;

        internal void Configure(
            DungeonTraversalEdgePlanV2 sourceEdge,
            Transform destinationAnchor,
            DungeonEnvironmentRuntimeV2 runtimeEnvironment,
            DungeonLayeredMinimapComponentV2 runtimeMinimap,
            TextMesh interactionPrompt)
        {
            edge = sourceEdge ?? throw new ArgumentNullException(nameof(sourceEdge));
            destination = destinationAnchor != null
                ? destinationAnchor
                : throw new ArgumentNullException(nameof(destinationAnchor));
            environment = runtimeEnvironment != null
                ? runtimeEnvironment
                : throw new ArgumentNullException(nameof(runtimeEnvironment));
            minimap = runtimeMinimap;
            prompt = interactionPrompt;
        }

        public bool Activate()
        {
            ProductionPlayerController target = ResolvePlayer();
            if (target == null
                || destination == null
                || edge == null
                || !DungeonPredicateEvaluatorV2.Evaluate(
                    edge.AccessPredicate,
                    environment.CapturePredicateState()))
            {
                return false;
            }

            CharacterController character = target.GetComponent<CharacterController>();
            bool wasEnabled = character != null && character.enabled;
            if (character != null) character.enabled = false;
            target.transform.SetPositionAndRotation(
                destination.position + Vector3.up * 0.05f,
                destination.rotation);
            target.GetComponent<PlayerTraversalMediumSensor>()?.ClearOverlaps();
            if (character != null) character.enabled = wasEnabled;
            minimap?.RevealConnection(edge.Id);
            minimap?.SeeRegion(edge.ToRegionId);
            return true;
        }

        private void Update()
        {
            bool nearby = IsPlayerInRange;
            bool authorized = nearby
                && edge != null
                && environment != null
                && DungeonPredicateEvaluatorV2.Evaluate(
                    edge.AccessPredicate,
                    environment.CapturePredicateState());
            if (prompt != null)
            {
                prompt.gameObject.SetActive(nearby);
                prompt.text = authorized ? "F / X  OPERATE LIFT" : "LIFT ACCESS LOCKED";
                if (nearby && Camera.main != null)
                {
                    Vector3 facing = Vector3.ProjectOnPlane(
                        Camera.main.transform.position - prompt.transform.position,
                        Vector3.up);
                    if (facing.sqrMagnitude > 0.0001f)
                    {
                        prompt.transform.rotation = Quaternion.LookRotation(-facing, Vector3.up);
                    }
                }
            }

            if (authorized && DungeonInteractionInputV2.WasPressedThisFrame()) Activate();
        }

        private ProductionPlayerController ResolvePlayer()
        {
            player ??= FindAnyObjectByType<ProductionPlayerController>();
            return player;
        }
    }
}
