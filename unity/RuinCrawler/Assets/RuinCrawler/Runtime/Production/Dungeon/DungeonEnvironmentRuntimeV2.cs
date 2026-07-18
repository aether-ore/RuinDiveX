using System;
using System.Collections;
using System.Collections.Generic;
using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    /// <summary>
    /// Mutable scene adapter for immutable V2 controller and predicate plans.
    /// Only stable committed facts live here; presentation interpolation never
    /// becomes authoritative and is cancelled without mutation on teardown.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DungeonEnvironmentRuntimeV2 : MonoBehaviour
    {
        private sealed class PredicateBinding
        {
            public GameObject Target;
            public DungeonAccessPredicateV2 Predicate;
        }

        private sealed class FluidBinding
        {
            public GameObject Target;
            public string NetworkId;
            public string ZoneId;
        }

        private readonly Dictionary<string, DungeonEnvironmentControllerPlanV2> controllerPlans =
            new Dictionary<string, DungeonEnvironmentControllerPlanV2>(StringComparer.Ordinal);
        private readonly Dictionary<string, string> controllerStates =
            new Dictionary<string, string>(StringComparer.Ordinal);
        private readonly Dictionary<string, DungeonFluidNetworkPlanV2> fluidPlans =
            new Dictionary<string, DungeonFluidNetworkPlanV2>(StringComparer.Ordinal);
        private readonly Dictionary<string, string> fluidConfigurations =
            new Dictionary<string, string>(StringComparer.Ordinal);
        private readonly HashSet<string> requiredItems = new HashSet<string>(StringComparer.Ordinal);
        private readonly HashSet<string> shortcuts = new HashSet<string>(StringComparer.Ordinal);
        private readonly HashSet<string> discoveries = new HashSet<string>(StringComparer.Ordinal);
        private readonly HashSet<string> progressionFacts = new HashSet<string>(StringComparer.Ordinal);
        private readonly HashSet<string> traversalCapabilities = new HashSet<string>(StringComparer.Ordinal);
        private readonly List<PredicateBinding> predicateBindings = new List<PredicateBinding>();
        private readonly List<FluidBinding> fluidBindings = new List<FluidBinding>();

        private DungeonPlanV2 plan;
        private Coroutine pendingTransition;
        private string pendingControllerId;
        private string pendingTransitionId;

        public event Action<DungeonEnvironmentSnapshotV2> CommittedStateChanged;
        public event Action<string, string, float> TransitionStarted;
        public event Action<string, string> TransitionCancelled;

        public DungeonPlanV2 Plan => plan;
        public bool IsTransitionInProgress => pendingTransition != null;
        public string PendingControllerId => pendingControllerId;
        public string PendingTransitionId => pendingTransitionId;

        public void Configure(
            DungeonPlanV2 sourcePlan,
            DungeonEnvironmentSnapshotV2 restoredEnvironment = null,
            IEnumerable<string> restoredRequiredItems = null,
            IEnumerable<string> restoredDiscoveries = null,
            IEnumerable<string> restoredProgressionFacts = null,
            IEnumerable<string> restoredTraversalCapabilities = null)
        {
            if (sourcePlan == null)
            {
                throw new ArgumentNullException(nameof(sourcePlan));
            }

            CancelPendingTransition();
            plan = sourcePlan;
            controllerPlans.Clear();
            controllerStates.Clear();
            fluidPlans.Clear();
            fluidConfigurations.Clear();
            predicateBindings.Clear();
            fluidBindings.Clear();
            ResetSet(requiredItems, restoredRequiredItems);
            ResetSet(discoveries, restoredDiscoveries);
            ResetSet(progressionFacts, restoredProgressionFacts);
            ResetSet(traversalCapabilities, restoredTraversalCapabilities);
            shortcuts.Clear();

            foreach (DungeonEnvironmentControllerPlanV2 controller in plan.EnvironmentControllers)
            {
                controllerPlans.Add(controller.Id, controller);
                controllerStates.Add(controller.Id, controller.InitialStateId);
            }

            foreach (DungeonFluidNetworkPlanV2 network in plan.FluidNetworks)
            {
                fluidPlans.Add(network.Id, network);
                fluidConfigurations.Add(network.Id, network.InitialConfigurationId);
            }

            if (restoredEnvironment != null)
            {
                foreach (DungeonControllerStateFactV2 fact in restoredEnvironment.ControllerStates)
                {
                    if (controllerPlans.TryGetValue(fact.ControllerId, out DungeonEnvironmentControllerPlanV2 controller)
                        && Contains(controller.StableStateIds, fact.StateId))
                    {
                        controllerStates[fact.ControllerId] = fact.StateId;
                    }
                }

                foreach (DungeonFluidNetworkStateV2 state in restoredEnvironment.FluidNetworkStates)
                {
                    if (fluidPlans.TryGetValue(state.FluidNetworkId, out DungeonFluidNetworkPlanV2 network)
                        && ContainsConfiguration(network.StableConfigurations, state.CommittedConfigurationId))
                    {
                        fluidConfigurations[state.FluidNetworkId] = state.CommittedConfigurationId;
                    }
                }

                ResetSet(shortcuts, restoredEnvironment.ActiveShortcutIds);
            }

            ApplyBindings();
        }

        public DungeonEnvironmentSnapshotV2 CaptureSnapshot()
        {
            var controllerFacts = new List<DungeonControllerStateFactV2>(controllerStates.Count);
            foreach (KeyValuePair<string, string> pair in controllerStates)
            {
                controllerFacts.Add(new DungeonControllerStateFactV2(pair.Key, pair.Value));
            }

            var fluids = new List<DungeonFluidNetworkStateV2>(fluidConfigurations.Count);
            foreach (KeyValuePair<string, string> pair in fluidConfigurations)
            {
                fluids.Add(new DungeonFluidNetworkStateV2(pair.Key, pair.Value));
            }

            return new DungeonEnvironmentSnapshotV2(controllerFacts, fluids, shortcuts);
        }

        public DungeonPredicateStateV2 CapturePredicateState()
        {
            var controllerFacts = new List<DungeonControllerStateFactV2>(controllerStates.Count);
            foreach (KeyValuePair<string, string> pair in controllerStates)
            {
                controllerFacts.Add(new DungeonControllerStateFactV2(pair.Key, pair.Value));
            }

            return new DungeonPredicateStateV2(
                requiredItems,
                controllerFacts,
                shortcuts,
                discoveries,
                progressionFacts,
                traversalCapabilities);
        }

        public string GetControllerState(string controllerId)
        {
            return controllerId != null && controllerStates.TryGetValue(controllerId, out string value)
                ? value
                : null;
        }

        public string GetFluidConfiguration(string networkId)
        {
            return networkId != null && fluidConfigurations.TryGetValue(networkId, out string value)
                ? value
                : null;
        }

        public bool AddRequiredItem(string id) => AddFact(requiredItems, id);
        public bool AddDiscoveryFact(string id) => AddFact(discoveries, id);
        public bool AddProgressionFact(string id) => AddFact(progressionFacts, id);
        public bool AddTraversalCapability(string id) => AddFact(traversalCapabilities, id);
        public bool ActivateShortcut(string id) => AddFact(shortcuts, id);

        /// <summary>
        /// Rolls back a speculative scene-side shortcut activation when its
        /// campaign transaction cannot be committed. Shortcut interactions
        /// are allowed to update collision first so predicates respond in the
        /// same frame, but the route must not remain open without the matching
        /// once-per-expedition claim.
        /// </summary>
        public bool DeactivateShortcut(string id)
        {
            if (string.IsNullOrWhiteSpace(id) || !shortcuts.Remove(id.Trim()))
            {
                return false;
            }

            ApplyBindings();
            CommittedStateChanged?.Invoke(CaptureSnapshot());
            return true;
        }

        public void RegisterPredicateTarget(GameObject target, DungeonAccessPredicateV2 predicate)
        {
            if (target == null) throw new ArgumentNullException(nameof(target));
            if (predicate == null) throw new ArgumentNullException(nameof(predicate));
            predicateBindings.Add(new PredicateBinding { Target = target, Predicate = predicate });
            ApplyBindings();
        }

        public void RegisterFluidTarget(GameObject target, string networkId, string zoneId)
        {
            if (target == null) throw new ArgumentNullException(nameof(target));
            if (!fluidPlans.ContainsKey(networkId))
            {
                throw new ArgumentException("Unknown fluid network: " + networkId, nameof(networkId));
            }

            fluidBindings.Add(new FluidBinding
            {
                Target = target,
                NetworkId = networkId,
                ZoneId = zoneId
            });
            ApplyBindings();
        }

        public bool TryBeginTransition(string controllerId, string transitionId)
        {
            if (pendingTransition != null
                || controllerId == null
                || transitionId == null
                || !controllerPlans.TryGetValue(controllerId, out DungeonEnvironmentControllerPlanV2 controller))
            {
                return false;
            }

            DungeonControllerTransitionPlanV2 transition = FindTransition(controller, transitionId);
            if (transition == null
                || !string.Equals(controllerStates[controllerId], transition.FromStateId, StringComparison.Ordinal)
                || !DungeonPredicateEvaluatorV2.Evaluate(transition.ActivationPredicate, CapturePredicateState()))
            {
                return false;
            }

            if (transition.PresentationSeconds <= 0d)
            {
                CommitTransition(controller, transition);
                return true;
            }

            pendingControllerId = controllerId;
            pendingTransitionId = transitionId;
            TransitionStarted?.Invoke(controllerId, transitionId, (float)transition.PresentationSeconds);
            pendingTransition = StartCoroutine(PresentThenCommit(controller, transition));
            return true;
        }

        public bool CancelPendingTransition()
        {
            if (pendingTransition == null)
            {
                return false;
            }

            StopCoroutine(pendingTransition);
            pendingTransition = null;
            string controllerId = pendingControllerId;
            string transitionId = pendingTransitionId;
            pendingControllerId = null;
            pendingTransitionId = null;
            TransitionCancelled?.Invoke(controllerId, transitionId);
            return true;
        }

        private void OnDisable()
        {
            CancelPendingTransition();
        }

        private IEnumerator PresentThenCommit(
            DungeonEnvironmentControllerPlanV2 controller,
            DungeonControllerTransitionPlanV2 transition)
        {
            // Time.unscaledDeltaTime describes the whole current frame. A
            // transition can begin late in a long assembly/test frame, so
            // subtracting that already-elapsed duration commits early. Anchor
            // presentation to the instant the transition actually starts.
            double commitAt = Time.realtimeSinceStartupAsDouble + transition.PresentationSeconds;
            while (Time.realtimeSinceStartupAsDouble < commitAt)
            {
                yield return null;
            }

            pendingTransition = null;
            pendingControllerId = null;
            pendingTransitionId = null;
            CommitTransition(controller, transition);
        }

        private void CommitTransition(
            DungeonEnvironmentControllerPlanV2 controller,
            DungeonControllerTransitionPlanV2 transition)
        {
            controllerStates[controller.Id] = transition.ToStateId;
            if (controller.Kind == DungeonEnvironmentControllerKindV2.WaterRouting)
            {
                foreach (DungeonFluidNetworkPlanV2 network in plan.FluidNetworks)
                {
                    if (Contains(network.ControllerIds, controller.Id)
                        && ContainsConfiguration(network.StableConfigurations, transition.ToStateId))
                    {
                        fluidConfigurations[network.Id] = transition.ToStateId;
                    }
                }
            }

            ApplyBindings();
            CommittedStateChanged?.Invoke(CaptureSnapshot());
        }

        private bool AddFact(HashSet<string> target, string id)
        {
            if (string.IsNullOrWhiteSpace(id) || !target.Add(id.Trim()))
            {
                return false;
            }

            ApplyBindings();
            CommittedStateChanged?.Invoke(CaptureSnapshot());
            return true;
        }

        private void ApplyBindings()
        {
            if (plan == null)
            {
                return;
            }

            DungeonPredicateStateV2 predicateState = CapturePredicateState();
            for (int index = predicateBindings.Count - 1; index >= 0; index -= 1)
            {
                PredicateBinding binding = predicateBindings[index];
                if (binding.Target == null)
                {
                    predicateBindings.RemoveAt(index);
                    continue;
                }

                binding.Target.SetActive(DungeonPredicateEvaluatorV2.Evaluate(binding.Predicate, predicateState));
            }

            for (int index = fluidBindings.Count - 1; index >= 0; index -= 1)
            {
                FluidBinding binding = fluidBindings[index];
                if (binding.Target == null)
                {
                    fluidBindings.RemoveAt(index);
                    continue;
                }

                bool active = fluidConfigurations.TryGetValue(binding.NetworkId, out string configurationId)
                    && fluidPlans.TryGetValue(binding.NetworkId, out DungeonFluidNetworkPlanV2 network)
                    && ConfigurationContainsZone(network.StableConfigurations, configurationId, binding.ZoneId);
                binding.Target.SetActive(active);
            }
        }

        private static DungeonControllerTransitionPlanV2 FindTransition(
            DungeonEnvironmentControllerPlanV2 controller,
            string transitionId)
        {
            foreach (DungeonControllerTransitionPlanV2 transition in controller.Transitions)
            {
                if (string.Equals(transition.Id, transitionId, StringComparison.Ordinal))
                {
                    return transition;
                }
            }

            return null;
        }

        private static bool ConfigurationContainsZone(
            IReadOnlyList<DungeonFluidConfigurationPlanV2> configurations,
            string configurationId,
            string zoneId)
        {
            foreach (DungeonFluidConfigurationPlanV2 configuration in configurations)
            {
                if (string.Equals(configuration.Id, configurationId, StringComparison.Ordinal))
                {
                    return Contains(configuration.ActiveFluidZoneIds, zoneId);
                }
            }

            return false;
        }

        private static bool ContainsConfiguration(
            IReadOnlyList<DungeonFluidConfigurationPlanV2> configurations,
            string id)
        {
            foreach (DungeonFluidConfigurationPlanV2 configuration in configurations)
            {
                if (string.Equals(configuration.Id, id, StringComparison.Ordinal)) return true;
            }

            return false;
        }

        private static bool Contains(IReadOnlyList<string> values, string id)
        {
            foreach (string value in values)
            {
                if (string.Equals(value, id, StringComparison.Ordinal)) return true;
            }

            return false;
        }

        private static void ResetSet(HashSet<string> target, IEnumerable<string> values)
        {
            target.Clear();
            if (values == null) return;
            foreach (string value in values)
            {
                if (!string.IsNullOrWhiteSpace(value)) target.Add(value.Trim());
            }
        }
    }
}
