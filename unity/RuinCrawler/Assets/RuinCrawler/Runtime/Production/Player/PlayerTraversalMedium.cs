using System.Collections.Generic;
using UnityEngine;

namespace RuinCrawler.Runtime.Player
{
    public enum PlayerTraversalMediumKind
    {
        Dry = 0,
        FloodedBottomWalk = 1
    }

    /// <summary>
    /// Scene-boundary marker for an authored traversal medium. The V2 plan
    /// owns the fluid state; this component only exposes the committed state
    /// to the player adapter and never becomes save data.
    /// </summary>
    [DisallowMultipleComponent]
    [RequireComponent(typeof(Collider))]
    public sealed class PlayerTraversalMediumVolume : MonoBehaviour
    {
        [SerializeField] private PlayerTraversalMediumKind medium =
            PlayerTraversalMediumKind.FloodedBottomWalk;
        [SerializeField] private string stableId = "water-volume";
        [SerializeField, Min(0f)] private float waterDepth = 3.15f;
        [SerializeField] private int priority;

        public PlayerTraversalMediumKind Medium => medium;
        public string StableId => string.IsNullOrWhiteSpace(stableId) ? gameObject.name : stableId;
        public float WaterDepth => waterDepth;
        public int Priority => priority;

        public void Configure(
            PlayerTraversalMediumKind kind,
            float authoredWaterDepth,
            int volumePriority = 0,
            string volumeId = null)
        {
            medium = kind;
            waterDepth = Mathf.Max(0f, authoredWaterDepth);
            priority = volumePriority;
            stableId = string.IsNullOrWhiteSpace(volumeId) ? gameObject.name : volumeId.Trim();
            Collider volume = GetComponent<Collider>();
            if (volume != null)
            {
                volume.isTrigger = true;
            }
        }

        private void Reset()
        {
            Collider volume = GetComponent<Collider>();
            if (volume != null)
            {
                volume.isTrigger = true;
            }
        }
    }

    /// <summary>
    /// Tracks overlapping committed medium volumes. Selection is stable by
    /// priority and instance ID so overlapping authored volumes cannot make
    /// the movement profile flicker from frame order.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class PlayerTraversalMediumSensor : MonoBehaviour
    {
        private readonly HashSet<PlayerTraversalMediumVolume> overlaps =
            new HashSet<PlayerTraversalMediumVolume>();

        public PlayerTraversalMediumKind CurrentMedium
        {
            get
            {
                PlayerTraversalMediumVolume selected = SelectCurrent();
                return selected != null ? selected.Medium : PlayerTraversalMediumKind.Dry;
            }
        }

        public float CurrentWaterDepth => SelectCurrent()?.WaterDepth ?? 0f;
        public bool IsFlooded => CurrentMedium == PlayerTraversalMediumKind.FloodedBottomWalk;

        public void ClearOverlaps()
        {
            overlaps.Clear();
        }

        private void OnDisable()
        {
            overlaps.Clear();
        }

        private void OnTriggerEnter(Collider other)
        {
            Add(other);
        }

        private void OnTriggerStay(Collider other)
        {
            Add(other);
        }

        private void OnTriggerExit(Collider other)
        {
            PlayerTraversalMediumVolume volume = Resolve(other);
            if (volume != null)
            {
                overlaps.Remove(volume);
            }
        }

        private void Add(Collider other)
        {
            PlayerTraversalMediumVolume volume = Resolve(other);
            if (volume != null && volume.isActiveAndEnabled)
            {
                overlaps.Add(volume);
            }
        }

        private PlayerTraversalMediumVolume SelectCurrent()
        {
            PlayerTraversalMediumVolume selected = null;
            overlaps.RemoveWhere(value => value == null || !value.isActiveAndEnabled);
            foreach (PlayerTraversalMediumVolume candidate in overlaps)
            {
                if (selected == null
                    || candidate.Priority > selected.Priority
                    || candidate.Priority == selected.Priority
                    && string.CompareOrdinal(candidate.StableId, selected.StableId) < 0)
                {
                    selected = candidate;
                }
            }

            return selected;
        }

        private static PlayerTraversalMediumVolume Resolve(Collider other)
        {
            return other != null ? other.GetComponentInParent<PlayerTraversalMediumVolume>() : null;
        }
    }
}
