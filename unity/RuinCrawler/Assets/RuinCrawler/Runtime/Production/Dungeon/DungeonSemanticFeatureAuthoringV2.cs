using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    [DisallowMultipleComponent]
    public sealed class DungeonSemanticFeatureAuthoringV2 : MonoBehaviour
    {
        [SerializeField] private DungeonModuleSemanticFeatureV2 feature;
        public DungeonModuleSemanticFeatureV2 Feature => feature;
        public void Configure(DungeonModuleSemanticFeatureV2 semanticFeature) => feature = semanticFeature;
    }
}
