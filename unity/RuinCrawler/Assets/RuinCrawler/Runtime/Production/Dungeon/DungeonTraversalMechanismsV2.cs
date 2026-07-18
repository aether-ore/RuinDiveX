using System;
using System.Collections.Generic;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Runtime.Player;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    /// <summary>
    /// Deterministic, expedition-local moving surface. Its phase always starts
    /// at zero after assembly/re-entry and is intentionally never persisted.
    /// A thin rider trigger carries CharacterControllers by the exact platform
    /// delta while the certified basin below remains the failure catchment.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DungeonMovingPlatformRuntimeV2 : MonoBehaviour
    {
        private readonly HashSet<CharacterController> riders = new HashSet<CharacterController>();
        private Rigidbody platformBody;
        private Vector3 origin;
        private Vector3 axis = Vector3.forward;
        private float travelDistance = 2.5f;
        private float cycleSeconds = 4f;
        private float elapsed;
        private float currentOffset;

        public int RiderCount => riders.Count;
        public float CurrentOffset => currentOffset;

        internal void Configure(
            Rigidbody body,
            Vector3 travelAxis,
            float distance = 2.5f,
            float periodSeconds = 4f)
        {
            platformBody = body != null ? body : throw new ArgumentNullException(nameof(body));
            axis = travelAxis.sqrMagnitude > 0.000001f
                ? travelAxis.normalized
                : throw new ArgumentException("A moving-platform axis is required.", nameof(travelAxis));
            travelDistance = Mathf.Max(0.1f, distance);
            cycleSeconds = Mathf.Max(0.5f, periodSeconds);
            origin = transform.position;
            elapsed = 0f;
            currentOffset = 0f;
        }

        internal void AddRider(Collider other)
        {
            CharacterController controller = other != null
                ? other.GetComponentInParent<CharacterController>()
                : null;
            if (controller != null && controller.GetComponent<ProductionPlayerController>() != null)
            {
                riders.Add(controller);
            }
        }

        internal void RemoveRider(Collider other)
        {
            CharacterController controller = other != null
                ? other.GetComponentInParent<CharacterController>()
                : null;
            if (controller != null)
            {
                riders.Remove(controller);
            }
        }

        private void FixedUpdate()
        {
            if (platformBody == null)
            {
                return;
            }

            elapsed += Time.fixedDeltaTime;
            float nextOffset = Mathf.Sin(elapsed * Mathf.PI * 2f / cycleSeconds) * travelDistance;
            Vector3 delta = axis * (nextOffset - currentOffset);
            currentOffset = nextOffset;
            platformBody.MovePosition(origin + axis * currentOffset);

            riders.RemoveWhere(value => value == null || !value.enabled || !value.gameObject.activeInHierarchy);
            foreach (CharacterController rider in riders)
            {
                rider.Move(delta);
            }
        }

        private void OnDisable()
        {
            riders.Clear();
        }
    }

    [DisallowMultipleComponent]
    public sealed class DungeonMovingPlatformRiderRelayV2 : MonoBehaviour
    {
        private DungeonMovingPlatformRuntimeV2 platform;

        internal void Configure(DungeonMovingPlatformRuntimeV2 owner)
        {
            platform = owner != null ? owner : throw new ArgumentNullException(nameof(owner));
        }

        private void OnTriggerEnter(Collider other) => platform?.AddRider(other);
        private void OnTriggerStay(Collider other) => platform?.AddRider(other);
        private void OnTriggerExit(Collider other) => platform?.RemoveRider(other);
    }

    /// <summary>
    /// Arms the authored Credential Tower collapse when the player commits to
    /// the marked panel. The 0.65-second warning is the controller transition;
    /// the old surface remains authoritative until its atomic commit, after
    /// which the shared predicate binding disables geometry and collision.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DungeonCrumbleSurfaceRuntimeV2 : MonoBehaviour
    {
        private DungeonEnvironmentRuntimeV2 environment;
        private string controllerId;
        private string transitionId;

        public bool IsArmed { get; private set; }
        public string ControllerId => controllerId;

        internal void Configure(
            DungeonEnvironmentRuntimeV2 runtimeEnvironment,
            string sourceControllerId,
            string sourceTransitionId)
        {
            environment = runtimeEnvironment != null
                ? runtimeEnvironment
                : throw new ArgumentNullException(nameof(runtimeEnvironment));
            controllerId = string.IsNullOrWhiteSpace(sourceControllerId)
                ? throw new ArgumentException("A crumble controller ID is required.", nameof(sourceControllerId))
                : sourceControllerId;
            transitionId = string.IsNullOrWhiteSpace(sourceTransitionId)
                ? throw new ArgumentException("A crumble transition ID is required.", nameof(sourceTransitionId))
                : sourceTransitionId;
            IsArmed = false;
        }

        internal void TryArm(Collider other)
        {
            if (IsArmed || other == null
                || other.GetComponentInParent<ProductionPlayerController>() == null
                || !string.Equals(environment.GetControllerState(controllerId), "Intact", StringComparison.Ordinal))
            {
                return;
            }

            IsArmed = environment.TryBeginTransition(controllerId, transitionId);
        }
    }

    [DisallowMultipleComponent]
    public sealed class DungeonCrumbleSurfaceRelayV2 : MonoBehaviour
    {
        private DungeonCrumbleSurfaceRuntimeV2 surface;

        internal void Configure(DungeonCrumbleSurfaceRuntimeV2 owner)
        {
            surface = owner != null ? owner : throw new ArgumentNullException(nameof(owner));
        }

        private void OnTriggerEnter(Collider other) => surface?.TryArm(other);
        private void OnTriggerStay(Collider other) => surface?.TryArm(other);
    }
}
