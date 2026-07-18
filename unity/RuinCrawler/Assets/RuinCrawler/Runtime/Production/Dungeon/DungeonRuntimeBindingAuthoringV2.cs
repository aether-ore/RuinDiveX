using System;
using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    public enum DungeonRuntimeBindingKindV2
    {
        Anchor,
        Surface,
        FluidSurface,
        Mechanism,
        ConnectorCap,
        Audio,
        Vfx
    }

    /// <summary>
    /// Stable, local authoring link between an immutable plan record and a
    /// prefab transform. The marker itself is non-visual and non-colliding; it
    /// may point at presentation or certified-collision objects elsewhere in
    /// the same authored prefab.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DungeonRuntimeBindingAuthoringV2 : MonoBehaviour
    {
        [SerializeField] private string stableId = "binding-v2";
        [SerializeField] private string localRegionId = "region-v2";
        [SerializeField] private DungeonRuntimeBindingKindV2 kind;
        [SerializeField] private string profileId;
        [SerializeField] private GameObject target;

        public string StableId => stableId;
        public string LocalRegionId => localRegionId;
        public DungeonRuntimeBindingKindV2 Kind => kind;
        public string ProfileId => string.IsNullOrWhiteSpace(profileId) ? null : profileId;
        public GameObject Target => target != null ? target : gameObject;

        public void Configure(
            string localStableId,
            string owningLocalRegionId,
            DungeonRuntimeBindingKindV2 bindingKind,
            GameObject bindingTarget = null,
            string bindingProfileId = null)
        {
            stableId = localStableId;
            localRegionId = owningLocalRegionId;
            kind = bindingKind;
            target = bindingTarget;
            profileId = bindingProfileId;
        }

        public string Key => KeyOf(kind, localRegionId, stableId);

        internal static string KeyOf(
            DungeonRuntimeBindingKindV2 bindingKind,
            string regionId,
            string id)
        {
            return ((int)bindingKind).ToString() + "|" + (regionId ?? string.Empty) + "|" + (id ?? string.Empty);
        }
    }

    /// <summary>
    /// Explicit opt-in for a renderer whose shader supplies world-space
    /// mapping and therefore does not require mesh UV0. Approval is still
    /// checked by the authored-module bake; it is not a blanket exception for
    /// missing materials or shaders.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DungeonWorldSpaceTextureApprovalV2 : MonoBehaviour
    {
        [SerializeField] private string reason = "World-space texture mapping";

        public string Reason => reason;

        public void Configure(string approvalReason)
        {
            reason = approvalReason;
        }
    }

    [DisallowMultipleComponent]
    public sealed class DungeonConnectorCapRuntimeV2 : MonoBehaviour
    {
        public string ConnectorId { get; private set; }
        public DungeonConnectorCapStateV2 CapState { get; private set; }
        public string MechanismBindingId { get; private set; }

        internal void Configure(
            string connectorId,
            DungeonConnectorCapStateV2 capState,
            string mechanismBindingId)
        {
            ConnectorId = connectorId;
            CapState = capState;
            MechanismBindingId = mechanismBindingId;
        }
    }
}
