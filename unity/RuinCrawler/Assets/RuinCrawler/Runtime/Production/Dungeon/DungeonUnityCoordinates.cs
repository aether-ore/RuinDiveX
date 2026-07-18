using RuinCrawler.Core.Dungeon;
using RuinCrawler.Core.Foundation;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    /// <summary>
    /// Centralized conversion from the pure dungeon coordinate convention to
    /// Unity's scene convention. The V2 builder is the only runtime consumer.
    /// </summary>
    public static class DungeonUnityCoordinates
    {
        public static Vector3 ToUnity(DungeonPoint3 point)
        {
            DoubleVector3 converted = CoordinateConverter.ThreeToUnityPosition(
                new DoubleVector3(point.X, point.Y, point.Z));
            return new Vector3((float)converted.X, (float)converted.Y, (float)converted.Z);
        }

        public static Vector3 ToUnity(double x, double y, double z)
        {
            return ToUnity(new DungeonPoint3(x, y, z));
        }
    }
}
