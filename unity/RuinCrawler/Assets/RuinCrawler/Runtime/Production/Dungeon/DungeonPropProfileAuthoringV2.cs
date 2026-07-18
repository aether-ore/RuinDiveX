using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    [DisallowMultipleComponent]
    public sealed class DungeonPropProfileAuthoringV2 : MonoBehaviour
    {
        [SerializeField] private DungeonPropProfileV2 profile;
        public DungeonPropProfileV2 Profile => profile;
        public void Configure(DungeonPropProfileV2 propProfile) => profile = propProfile;
    }
}
