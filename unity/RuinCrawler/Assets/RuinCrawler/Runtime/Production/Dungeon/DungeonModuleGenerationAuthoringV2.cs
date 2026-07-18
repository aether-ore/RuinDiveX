using System;
using System.Collections.Generic;
using System.Linq;
using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    [Serializable]
    public sealed class DungeonModuleTopologyEdgeAuthoringDataV2
    {
        [SerializeField] private string stableId = "topology-edge-v2";
        [SerializeField] private string fromLocalRegionId = "entry";
        [SerializeField] private string toLocalRegionId = "upper";
        [SerializeField] private DungeonConnectorKindV2 kind = DungeonConnectorKindV2.Ground;
        [SerializeField] private bool bidirectional = true;

        public string StableId => stableId;
        public string FromLocalRegionId => fromLocalRegionId;
        public string ToLocalRegionId => toLocalRegionId;
        public DungeonConnectorKindV2 Kind => kind;
        public bool Bidirectional => bidirectional;

        public void Configure(
            string id,
            string fromRegionId,
            string toRegionId,
            DungeonConnectorKindV2 connectorKind,
            bool traversableBothWays)
        {
            stableId = id;
            fromLocalRegionId = fromRegionId;
            toLocalRegionId = toRegionId;
            kind = connectorKind;
            bidirectional = traversableBothWays;
        }

        public DungeonAuthoredModuleTopologyEdgeV2 ToCore() =>
            new DungeonAuthoredModuleTopologyEdgeV2(
                stableId,
                fromLocalRegionId,
                toLocalRegionId,
                kind,
                bidirectional);
    }

    /// <summary>
    /// Pure-generation metadata authored on the prefab root. The editor bake
    /// compiles this component into an immutable descriptor asset; Core
    /// generation never reads this MonoBehaviour or any prefab hierarchy.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DungeonModuleGenerationAuthoringV2 : MonoBehaviour
    {
        [SerializeField] private string variantId = "variant-a";
        [SerializeField] private DungeonMacroRoleKindV2[] compatibleMacroRoles =
            Array.Empty<DungeonMacroRoleKindV2>();
        [SerializeField] private string verticalCompositionId;
        [SerializeField] private DungeonModuleTopologyEdgeAuthoringDataV2[] topologyEdges =
            Array.Empty<DungeonModuleTopologyEdgeAuthoringDataV2>();

        public string VariantId => variantId;
        public IReadOnlyList<DungeonMacroRoleKindV2> CompatibleMacroRoles => compatibleMacroRoles;
        public string VerticalCompositionId => string.IsNullOrWhiteSpace(verticalCompositionId)
            ? null
            : verticalCompositionId;
        public IReadOnlyList<DungeonModuleTopologyEdgeAuthoringDataV2> TopologyEdges => topologyEdges;

        public void Configure(
            string stableVariantId,
            IEnumerable<DungeonMacroRoleKindV2> macroRoles,
            string stableVerticalCompositionId,
            IEnumerable<DungeonModuleTopologyEdgeAuthoringDataV2> edges)
        {
            variantId = stableVariantId;
            compatibleMacroRoles = (macroRoles ?? Array.Empty<DungeonMacroRoleKindV2>())
                .Distinct()
                .OrderBy(value => (int)value)
                .ToArray();
            verticalCompositionId = stableVerticalCompositionId;
            topologyEdges = (edges ?? Array.Empty<DungeonModuleTopologyEdgeAuthoringDataV2>())
                .Where(value => value != null)
                .OrderBy(value => value.StableId, StringComparer.Ordinal)
                .ToArray();
        }

        public DungeonAuthoredModuleTopologyEdgeV2[] ToCoreEdges() => topologyEdges
            .Where(value => value != null)
            .OrderBy(value => value.StableId, StringComparer.Ordinal)
            .Select(value => value.ToCore())
            .ToArray();
    }
}
