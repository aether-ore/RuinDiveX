using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    [DisallowMultipleComponent]
    public sealed class DungeonMechanismAuthoringV2 : MonoBehaviour
    {
        [SerializeField] private string stableId = "mechanism-v2";
        [SerializeField] private DungeonMechanismProfileV2 profile;
        public string StableId => stableId;
        public DungeonMechanismProfileV2 Profile => profile;

        public void Configure(string id, DungeonMechanismProfileV2 mechanismProfile)
        {
            stableId = id;
            profile = mechanismProfile;
        }
    }
}
