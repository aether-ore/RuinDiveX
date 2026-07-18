using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    [DisallowMultipleComponent]
    public sealed class DungeonStructuralSupportAuthoringV2 : MonoBehaviour
    {
        [SerializeField] private string stableId = "support-v2";
        [SerializeField] private DungeonStructuralSupportKindV2 kind;
        public string StableId => stableId;
        public DungeonStructuralSupportKindV2 Kind => kind;

        public void Configure(string id, DungeonStructuralSupportKindV2 supportKind)
        {
            stableId = id;
            kind = supportKind;
        }
    }
}
