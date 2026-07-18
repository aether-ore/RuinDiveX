using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    [DisallowMultipleComponent]
    public sealed class DungeonConnectorGeometryAuthoringV2 : MonoBehaviour
    {
        [SerializeField] private string stableId = "connector-v2";
        [SerializeField] private string regionId = "region-v2";
        [SerializeField] private DungeonConnectorKindV2 kind = DungeonConnectorKindV2.Ground;
        [SerializeField] private string socketTag = "factory-ground-v2";

        public string StableId => stableId;
        public string RegionId => regionId;
        public DungeonConnectorKindV2 Kind => kind;
        public string SocketTag => socketTag;

        public void Configure(
            string id,
            string owningRegionId,
            DungeonConnectorKindV2 connectorKind,
            string connectorSocketTag)
        {
            stableId = id;
            regionId = owningRegionId;
            kind = connectorKind;
            socketTag = connectorSocketTag;
        }
    }
}
