using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    [DisallowMultipleComponent]
    public sealed class DungeonStoryVignetteAuthoringV2 : MonoBehaviour
    {
        [SerializeField] private DungeonStoryVignetteProfileV2 profile;
        public DungeonStoryVignetteProfileV2 Profile => profile;
        public void Configure(DungeonStoryVignetteProfileV2 vignetteProfile) => profile = vignetteProfile;
    }
}
