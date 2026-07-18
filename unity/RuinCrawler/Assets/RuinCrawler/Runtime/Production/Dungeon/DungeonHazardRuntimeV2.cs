using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Core.Foundation;
using RuinCrawler.Runtime.Combat;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    public enum DungeonHazardVisualPhaseV2
    {
        MagmaActive,
        ElectricSafe,
        ElectricCharging,
        ElectricEnergized,
        ElectricGrounded
    }

    /// <summary>
    /// Optional durable identity used to build occupancy execution IDs. A
    /// hierarchy-derived identity is used when production actors do not supply
    /// one explicitly.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DungeonHazardReceiverIdentityV2 : MonoBehaviour
    {
        [SerializeField] private string stableId;

        public string StableId
        {
            get
            {
                if (string.IsNullOrWhiteSpace(stableId))
                {
                    stableId = BuildHierarchyIdentity(transform);
                }

                return stableId;
            }
        }

        public void Configure(string id)
        {
            if (string.IsNullOrWhiteSpace(id))
            {
                throw new ArgumentException("A stable hazard receiver id is required.", nameof(id));
            }

            stableId = id.Trim();
        }

        internal static string Resolve(HealthComponent receiver)
        {
            if (receiver == null)
            {
                throw new ArgumentNullException(nameof(receiver));
            }

            DungeonHazardReceiverIdentityV2 identity =
                receiver.GetComponentInParent<DungeonHazardReceiverIdentityV2>();
            return identity != null ? identity.StableId : BuildHierarchyIdentity(receiver.transform);
        }

        private static string BuildHierarchyIdentity(Transform target)
        {
            var segments = new Stack<string>();
            Transform cursor = target;
            while (cursor != null)
            {
                segments.Push(Encode(cursor.name) + "#" + cursor.GetSiblingIndex().ToString(CultureInfo.InvariantCulture));
                cursor = cursor.parent;
            }

            string sceneIdentity = target.gameObject.scene.IsValid()
                ? (string.IsNullOrWhiteSpace(target.gameObject.scene.path)
                    ? target.gameObject.scene.name
                    : target.gameObject.scene.path)
                : "unbound-scene";
            var builder = new StringBuilder("hierarchy-v2|scene=");
            builder.Append(Encode(sceneIdentity));
            foreach (string segment in segments)
            {
                builder.Append("|node=");
                builder.Append(segment);
            }

            return builder.ToString();
        }

        private static string Encode(string value)
        {
            value = value ?? string.Empty;
            return value.Length.ToString(CultureInfo.InvariantCulture) + ":" + value;
        }
    }

    /// <summary>
    /// One district-global hazard clock shared by every adjacent tile relay
    /// that references the same environment controller. It is the Unity
    /// boundary between the pure schedulers and authoritative HealthComponent.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DungeonHazardDistrictRuntimeV2 : MonoBehaviour
    {
        private const string DamageDomain = "environment";
        private const string ReactionEnvelopeId = "environmental-hazard-no-reaction-v1";
        private const string GroundedStateId = "Grounded";

        private static readonly string[] MagmaHazardTags =
            { "environmentalHeat", "fireFloor" };
        private static readonly string[] ElectricHazardTags =
            { "electricFloor", "environmentalElectricity" };

        private sealed class ReceiverState
        {
            public string ReceiverId;
            public string OccupancyId;
            public readonly HashSet<string> ActiveRelayIds = new HashSet<string>(StringComparer.Ordinal);
            public MagmaOccupancyStateV2 MagmaState;
            public double SeparationSeconds;
        }

        [SerializeField] private DungeonHazardSurfaceKindV2 kind;
        [SerializeField] private string controllerId;
        [SerializeField] private bool automaticSimulation = true;

        private readonly Dictionary<HealthComponent, ReceiverState> receivers =
            new Dictionary<HealthComponent, ReceiverState>();
        private readonly Dictionary<string, long> occupancyOrdinals =
            new Dictionary<string, long>(StringComparer.Ordinal);
        private DungeonEnvironmentRuntimeV2 environment;
        private ElectricHazardStateV2 electricState;
        private DungeonHazardVisualPhaseV2 visualPhase;

        public event Action<DungeonHazardVisualPhaseV2> VisualPhaseChanged;
        public event Action<HealthComponent, EnvironmentalHazardPulseV2, DamageResult> PulseApplied;

        public DungeonHazardSurfaceKindV2 Kind => kind;
        public string ControllerId => controllerId;
        public bool AutomaticSimulation => automaticSimulation;
        public int ActiveReceiverCount => receivers.Count;
        public ElectricHazardStateV2 ElectricState => electricState;
        public DungeonHazardVisualPhaseV2 VisualPhase => visualPhase;

        public void Configure(
            DungeonHazardSurfaceKindV2 targetKind,
            string stableControllerId,
            DungeonEnvironmentRuntimeV2 targetEnvironment = null,
            bool simulateAutomatically = true)
        {
            if (string.IsNullOrWhiteSpace(stableControllerId))
            {
                throw new ArgumentException("A stable hazard controller id is required.", nameof(stableControllerId));
            }

            UnbindEnvironment();
            kind = targetKind;
            controllerId = stableControllerId.Trim();
            environment = targetEnvironment;
            automaticSimulation = simulateAutomatically;
            receivers.Clear();
            occupancyOrdinals.Clear();
            electricState = kind == DungeonHazardSurfaceKindV2.Electric
                ? ElectricHazardSchedulerV2.CreateInitialState(controllerId)
                : null;
            BindEnvironment();
            RefreshVisualPhase(forceNotification: true);
        }

        public void SetAutomaticSimulation(bool value)
        {
            automaticSimulation = value;
        }

        public void NotifyReceiverEntered(string relayId, HealthComponent receiver)
        {
            relayId = RequireId(relayId, nameof(relayId));
            if (receiver == null)
            {
                throw new ArgumentNullException(nameof(receiver));
            }

            if (!receivers.TryGetValue(receiver, out ReceiverState state))
            {
                state = CreateReceiverState(receiver);
                receivers.Add(receiver, state);
            }

            state.ActiveRelayIds.Add(relayId);
            state.SeparationSeconds = 0d;
        }

        public void NotifyReceiverExited(string relayId, HealthComponent receiver)
        {
            relayId = RequireId(relayId, nameof(relayId));
            if (receiver == null || !receivers.TryGetValue(receiver, out ReceiverState state))
            {
                return;
            }

            state.ActiveRelayIds.Remove(relayId);
        }

        public bool TryGetOccupancyId(HealthComponent receiver, out string occupancyId)
        {
            if (receiver != null && receivers.TryGetValue(receiver, out ReceiverState state))
            {
                occupancyId = state.OccupancyId;
                return true;
            }

            occupancyId = null;
            return false;
        }

        public void AdvanceSimulation(double deltaTime)
        {
            RequireDeltaTime(deltaTime);
            if (deltaTime == 0d)
            {
                RefreshVisualPhase(forceNotification: false);
                return;
            }

            if (kind == DungeonHazardSurfaceKindV2.Magma)
            {
                AdvanceMagma(deltaTime);
            }
            else
            {
                AdvanceElectric(deltaTime);
            }

            RefreshVisualPhase(forceNotification: false);
        }

        /// <summary>
        /// Applies a captured scheduler pulse through the central health path.
        /// This remains public so replay/idempotency diagnostics can submit the
        /// exact immutable event again and observe a Duplicate disposition.
        /// </summary>
        public DamageResult ApplyPulse(HealthComponent receiver, EnvironmentalHazardPulseV2 pulse)
        {
            if (receiver == null)
            {
                throw new ArgumentNullException(nameof(receiver));
            }

            if (pulse == null)
            {
                throw new ArgumentNullException(nameof(pulse));
            }

            var packet = new DamagePacket(
                pulse.Amount,
                pulse.ExecutionId,
                sourceId: pulse.ControllerId,
                buildRevision: pulse.CycleRevision,
                element: pulse.Kind == EnvironmentalHazardKindV2.Magma
                    ? DamageElement.Fire
                    : DamageElement.Shock,
                suppressRewards: true,
                damageDomain: DamageDomain,
                hazardTags: pulse.Kind == EnvironmentalHazardKindV2.Magma
                    ? MagmaHazardTags
                    : ElectricHazardTags,
                reactionEnvelopeId: ReactionEnvelopeId);
            DamageResult result = receiver.ApplyDamage(packet);
            PulseApplied?.Invoke(receiver, pulse, result);
            return result;
        }

        private void Update()
        {
            if (automaticSimulation)
            {
                AdvanceSimulation(Time.deltaTime);
            }
        }

        private void OnDestroy()
        {
            UnbindEnvironment();
        }

        private ReceiverState CreateReceiverState(HealthComponent receiver)
        {
            string receiverId = DungeonHazardReceiverIdentityV2.Resolve(receiver);
            long ordinal = occupancyOrdinals.TryGetValue(receiverId, out long prior)
                ? checked(prior + 1L)
                : 0L;
            occupancyOrdinals[receiverId] = ordinal;
            string occupancyId = BuildOccupancyId(controllerId, receiverId, ordinal);
            return new ReceiverState
            {
                ReceiverId = receiverId,
                OccupancyId = occupancyId,
                MagmaState = kind == DungeonHazardSurfaceKindV2.Magma
                    ? MagmaHazardSchedulerV2.BeginOccupancy(controllerId, occupancyId)
                    : null,
                SeparationSeconds = 0d
            };
        }

        private void AdvanceMagma(double deltaTime)
        {
            var ended = new List<HealthComponent>();
            foreach (KeyValuePair<HealthComponent, ReceiverState> pair in receivers)
            {
                HealthComponent receiver = pair.Key;
                ReceiverState state = pair.Value;
                if (receiver == null)
                {
                    ended.Add(receiver);
                    continue;
                }

                bool inside = state.ActiveRelayIds.Count > 0;
                MagmaHazardStepResultV2 step = MagmaHazardSchedulerV2.Advance(
                    state.MagmaState,
                    inside,
                    deltaTime);
                state.MagmaState = step.State;
                if (inside)
                {
                    ApplyScheduledPulses(receiver, step.Pulses);
                }

                if (step.OccupancyEnded)
                {
                    ended.Add(receiver);
                }
            }

            RemoveReceivers(ended);
        }

        private void AdvanceElectric(double deltaTime)
        {
            ElectricHazardStateV2 startState = electricState
                ?? ElectricHazardSchedulerV2.CreateInitialState(controllerId);
            bool grounded = IsElectricGrounded();
            var ended = new List<HealthComponent>();
            foreach (KeyValuePair<HealthComponent, ReceiverState> pair in receivers)
            {
                HealthComponent receiver = pair.Key;
                ReceiverState state = pair.Value;
                if (receiver == null)
                {
                    ended.Add(receiver);
                    continue;
                }

                bool inside = state.ActiveRelayIds.Count > 0;
                if (inside)
                {
                    state.SeparationSeconds = 0d;
                    ElectricHazardStepResultV2 occupiedStep = ElectricHazardSchedulerV2.Advance(
                        startState,
                        state.OccupancyId,
                        isOccupyingHazard: true,
                        deltaTime);
                    if (!grounded)
                    {
                        ApplyScheduledPulses(receiver, occupiedStep.Pulses);
                    }
                }
                else
                {
                    state.SeparationSeconds += deltaTime;
                    if (state.SeparationSeconds + 1e-12d
                        >= MagmaHazardSchedulerV2.SeparationHysteresisSeconds)
                    {
                        ended.Add(receiver);
                    }
                }
            }

            electricState = ElectricHazardSchedulerV2.Advance(
                startState,
                occupancyId: null,
                isOccupyingHazard: false,
                deltaTime).State;
            RemoveReceivers(ended);
        }

        private void ApplyScheduledPulses(
            HealthComponent receiver,
            IReadOnlyList<EnvironmentalHazardPulseV2> pulses)
        {
            for (int index = 0; index < pulses.Count; index += 1)
            {
                ApplyPulse(receiver, pulses[index]);
            }
        }

        private void RemoveReceivers(IReadOnlyList<HealthComponent> ended)
        {
            for (int index = 0; index < ended.Count; index += 1)
            {
                receivers.Remove(ended[index]);
            }
        }

        private bool IsElectricGrounded()
        {
            return environment != null
                && string.Equals(
                    environment.GetControllerState(controllerId),
                    GroundedStateId,
                    StringComparison.Ordinal);
        }

        private void BindEnvironment()
        {
            if (environment != null)
            {
                environment.CommittedStateChanged += HandleEnvironmentStateChanged;
            }
        }

        private void UnbindEnvironment()
        {
            if (environment != null)
            {
                environment.CommittedStateChanged -= HandleEnvironmentStateChanged;
            }
        }

        private void HandleEnvironmentStateChanged(DungeonEnvironmentSnapshotV2 snapshot)
        {
            RefreshVisualPhase(forceNotification: false);
        }

        private void RefreshVisualPhase(bool forceNotification)
        {
            DungeonHazardVisualPhaseV2 next;
            if (kind == DungeonHazardSurfaceKindV2.Magma)
            {
                next = DungeonHazardVisualPhaseV2.MagmaActive;
            }
            else if (IsElectricGrounded())
            {
                next = DungeonHazardVisualPhaseV2.ElectricGrounded;
            }
            else
            {
                ElectricHazardPhaseV2 phase = (electricState
                    ?? ElectricHazardSchedulerV2.CreateInitialState(controllerId)).Phase;
                next = phase == ElectricHazardPhaseV2.Safe
                    ? DungeonHazardVisualPhaseV2.ElectricSafe
                    : phase == ElectricHazardPhaseV2.Charging
                        ? DungeonHazardVisualPhaseV2.ElectricCharging
                        : DungeonHazardVisualPhaseV2.ElectricEnergized;
            }

            if (!forceNotification && visualPhase == next)
            {
                return;
            }

            visualPhase = next;
            VisualPhaseChanged?.Invoke(next);
        }

        private static string BuildOccupancyId(string controller, string receiver, long ordinal)
        {
            return "hazard-occupancy-v2|controller=" + Encode(controller)
                + "|receiver=" + Encode(receiver)
                + "|ordinal=" + ordinal.ToString(CultureInfo.InvariantCulture);
        }

        private static string Encode(string value)
        {
            return value.Length.ToString(CultureInfo.InvariantCulture) + ":" + value;
        }

        private static string RequireId(string value, string parameterName)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                throw new ArgumentException("A stable id is required.", parameterName);
            }

            return value.Trim();
        }

        private static void RequireDeltaTime(double deltaTime)
        {
            if (double.IsNaN(deltaTime) || double.IsInfinity(deltaTime) || deltaTime < 0d)
            {
                throw new ArgumentOutOfRangeException(nameof(deltaTime), deltaTime, "Delta time must be finite and non-negative.");
            }
        }
    }

    /// <summary>
    /// Collider relay that collapses multiple child-collider contacts into one
    /// tile contact before forwarding it to the district-wide occupancy group.
    /// </summary>
    [DisallowMultipleComponent]
    [RequireComponent(typeof(Collider))]
    public sealed class DungeonHazardTileRelayV2 : MonoBehaviour
    {
        [SerializeField] private string stableRelayId;
        [SerializeField] private DungeonHazardDistrictRuntimeV2 district;

        private readonly Dictionary<HealthComponent, int> contactCounts =
            new Dictionary<HealthComponent, int>();

        public string StableRelayId => stableRelayId;
        public DungeonHazardDistrictRuntimeV2 District => district;

        public void Configure(string relayId, DungeonHazardDistrictRuntimeV2 targetDistrict)
        {
            if (string.IsNullOrWhiteSpace(relayId))
            {
                throw new ArgumentException("A stable hazard relay id is required.", nameof(relayId));
            }

            district = targetDistrict != null
                ? targetDistrict
                : throw new ArgumentNullException(nameof(targetDistrict));
            stableRelayId = relayId.Trim();
            Collider trigger = GetComponent<Collider>();
            if (trigger != null)
            {
                trigger.isTrigger = true;
            }
        }

        public void NotifyReceiverEnter(HealthComponent receiver)
        {
            if (receiver == null || district == null)
            {
                return;
            }

            if (contactCounts.TryGetValue(receiver, out int count))
            {
                contactCounts[receiver] = count + 1;
                return;
            }

            contactCounts.Add(receiver, 1);
            district.NotifyReceiverEntered(stableRelayId, receiver);
        }

        public void NotifyReceiverExit(HealthComponent receiver)
        {
            if (receiver == null || !contactCounts.TryGetValue(receiver, out int count))
            {
                return;
            }

            if (count > 1)
            {
                contactCounts[receiver] = count - 1;
                return;
            }

            contactCounts.Remove(receiver);
            if (district != null)
            {
                district.NotifyReceiverExited(stableRelayId, receiver);
            }
        }

        private void OnTriggerEnter(Collider other)
        {
            NotifyReceiverEnter(other != null ? other.GetComponentInParent<HealthComponent>() : null);
        }

        private void OnTriggerExit(Collider other)
        {
            NotifyReceiverExit(other != null ? other.GetComponentInParent<HealthComponent>() : null);
        }

        private void OnDisable()
        {
            if (district != null)
            {
                foreach (HealthComponent receiver in contactCounts.Keys)
                {
                    if (receiver != null)
                    {
                        district.NotifyReceiverExited(stableRelayId, receiver);
                    }
                }
            }

            contactCounts.Clear();
        }
    }

    /// <summary>
    /// Leak-free phase presentation using renderer property blocks. The shared
    /// material remains owned by DungeonSceneBuilderV2.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DungeonHazardSurfaceVisualV2 : MonoBehaviour
    {
        private static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
        private static readonly int ColorId = Shader.PropertyToID("_Color");
        private static readonly int EmissionColorId = Shader.PropertyToID("_EmissionColor");

        [SerializeField] private Renderer targetRenderer;
        [SerializeField] private DungeonHazardDistrictRuntimeV2 district;
        private MaterialPropertyBlock propertyBlock;

        public DungeonHazardVisualPhaseV2 VisualPhase { get; private set; }

        public void Configure(Renderer renderer, DungeonHazardDistrictRuntimeV2 targetDistrict)
        {
            Unbind();
            targetRenderer = renderer != null ? renderer : GetComponent<Renderer>();
            district = targetDistrict != null
                ? targetDistrict
                : throw new ArgumentNullException(nameof(targetDistrict));
            propertyBlock = propertyBlock ?? new MaterialPropertyBlock();
            district.VisualPhaseChanged += HandleVisualPhaseChanged;
            Apply(district.VisualPhase);
        }

        private void OnDestroy()
        {
            Unbind();
        }

        private void Unbind()
        {
            if (district != null)
            {
                district.VisualPhaseChanged -= HandleVisualPhaseChanged;
            }
        }

        private void HandleVisualPhaseChanged(DungeonHazardVisualPhaseV2 phase)
        {
            Apply(phase);
        }

        private void Apply(DungeonHazardVisualPhaseV2 phase)
        {
            VisualPhase = phase;
            if (targetRenderer == null)
            {
                return;
            }

            Color baseColor;
            float emissionMultiplier;
            switch (phase)
            {
                case DungeonHazardVisualPhaseV2.MagmaActive:
                    baseColor = new Color(1f, 0.10f, 0.015f, 1f);
                    emissionMultiplier = 2.4f;
                    break;
                case DungeonHazardVisualPhaseV2.ElectricCharging:
                    baseColor = new Color(1f, 0.55f, 0.04f, 1f);
                    emissionMultiplier = 1.9f;
                    break;
                case DungeonHazardVisualPhaseV2.ElectricEnergized:
                    baseColor = new Color(0.08f, 0.85f, 1f, 1f);
                    emissionMultiplier = 3f;
                    break;
                case DungeonHazardVisualPhaseV2.ElectricGrounded:
                    baseColor = new Color(0.12f, 0.28f, 0.24f, 1f);
                    emissionMultiplier = 0.25f;
                    break;
                default:
                    baseColor = new Color(0.035f, 0.18f, 0.28f, 1f);
                    emissionMultiplier = 0.45f;
                    break;
            }

            targetRenderer.GetPropertyBlock(propertyBlock);
            propertyBlock.SetColor(BaseColorId, baseColor);
            propertyBlock.SetColor(ColorId, baseColor);
            propertyBlock.SetColor(EmissionColorId, baseColor * emissionMultiplier);
            targetRenderer.SetPropertyBlock(propertyBlock);
        }
    }
}
