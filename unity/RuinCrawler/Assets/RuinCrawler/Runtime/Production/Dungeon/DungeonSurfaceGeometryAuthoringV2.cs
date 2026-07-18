using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    [DisallowMultipleComponent]
    [RequireComponent(typeof(Collider))]
    public sealed class DungeonSurfaceGeometryAuthoringV2 : MonoBehaviour
    {
        [SerializeField] private string stableId = "surface-v2";
        [SerializeField] private string regionId = "region-v2";
        [SerializeField] private DungeonSurfaceKindV2 kind = DungeonSurfaceKindV2.Walkable;
        [SerializeField] private bool isStructural = true;
        [SerializeField] private bool isWalkable = true;
        [SerializeField] private string materialProfileId = "factory-floor";

        public string StableId => stableId;
        public string RegionId => regionId;
        public DungeonSurfaceKindV2 Kind => kind;
        public bool IsStructural => isStructural;
        public bool IsWalkable => isWalkable;
        public string MaterialProfileId => materialProfileId;

        public void Configure(
            string id,
            string owningRegionId,
            DungeonSurfaceKindV2 surfaceKind,
            bool structural,
            bool walkable,
            string materialProfile)
        {
            stableId = id;
            regionId = owningRegionId;
            kind = surfaceKind;
            isStructural = structural;
            isWalkable = walkable;
            materialProfileId = materialProfile;
        }
    }
}
