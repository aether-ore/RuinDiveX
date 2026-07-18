using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    [DisallowMultipleComponent]
    public sealed class DungeonAnchorGeometryAuthoringV2 : MonoBehaviour
    {
        [SerializeField] private string stableId = "anchor-v2";
        [SerializeField] private string regionId = "region-v2";
        [SerializeField] private DungeonAnchorKindV2 kind = DungeonAnchorKindV2.Safe;
        [SerializeField] private string profileId;

        public string StableId => stableId;
        public string RegionId => regionId;
        public DungeonAnchorKindV2 Kind => kind;
        public string ProfileId => string.IsNullOrWhiteSpace(profileId) ? null : profileId;

        public void Configure(
            string id,
            string owningRegionId,
            DungeonAnchorKindV2 anchorKind,
            string anchorProfileId = null)
        {
            stableId = id;
            regionId = owningRegionId;
            kind = anchorKind;
            profileId = anchorProfileId;
        }
    }
}
