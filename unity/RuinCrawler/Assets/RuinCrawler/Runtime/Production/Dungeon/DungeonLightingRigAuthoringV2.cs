using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    [DisallowMultipleComponent]
    public sealed class DungeonLightingRigAuthoringV2 : MonoBehaviour
    {
        [SerializeField] private DungeonLightingProfileV2 profile;
        [SerializeField, Range(0, 4)] private int maximumActivePixelLights = 4;
        [SerializeField, Range(0, 1)] private int maximumShadowedLights = 1;

        public DungeonLightingProfileV2 Profile => profile;
        public int MaximumActivePixelLights => maximumActivePixelLights;
        public int MaximumShadowedLights => maximumShadowedLights;

        public void Configure(
            DungeonLightingProfileV2 lightingProfile,
            int pixelLightLimit = 4,
            int shadowedLightLimit = 1)
        {
            profile = lightingProfile;
            maximumActivePixelLights = pixelLightLimit;
            maximumShadowedLights = shadowedLightLimit;
        }
    }
}
