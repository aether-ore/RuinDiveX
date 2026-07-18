using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    [DisallowMultipleComponent]
    public sealed class DungeonRegionGeometryAuthoringV2 : MonoBehaviour
    {
        [SerializeField] private string stableId = "region-v2";
        [SerializeField] private Vector3 localCenter = new Vector3(0f, 1.5f, 0f);
        [SerializeField] private Vector3 localSize = new Vector3(8f, 3f, 8f);
        [SerializeField] private DungeonBiomeDistrictKindV2 districtKind = DungeonBiomeDistrictKindV2.Factory;
        [SerializeField] private DungeonElevationStratumV2 elevationStratum = DungeonElevationStratumV2.Entry;
        [SerializeField] private string localNavigationRegionId = "navigation-v2";

        public string StableId => stableId;
        public Vector3 LocalCenter => localCenter;
        public Vector3 LocalSize => localSize;
        public DungeonBiomeDistrictKindV2 DistrictKind => districtKind;
        public DungeonElevationStratumV2 ElevationStratum => elevationStratum;
        public string LocalNavigationRegionId => localNavigationRegionId;

        public void Configure(
            string id,
            Vector3 center,
            Vector3 size,
            DungeonBiomeDistrictKindV2 district,
            DungeonElevationStratumV2 stratum,
            string navigationRegionId)
        {
            stableId = id;
            localCenter = center;
            localSize = size;
            districtKind = district;
            elevationStratum = stratum;
            localNavigationRegionId = navigationRegionId;
        }
    }
}
