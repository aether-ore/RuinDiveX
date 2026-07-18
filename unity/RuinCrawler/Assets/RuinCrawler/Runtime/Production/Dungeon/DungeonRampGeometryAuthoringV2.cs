using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    /// <summary>
    /// Declares a convex triangular-prism ramp without flattening it into a
    /// vertical prism. Heights are expressed in the MeshCollider's local space;
    /// rise direction is horizontal local-space direction from low to high.
    /// </summary>
    [DisallowMultipleComponent]
    [RequireComponent(typeof(MeshCollider))]
    public sealed class DungeonRampGeometryAuthoringV2 : MonoBehaviour
    {
        [SerializeField] private float lowSurfaceLocalY;
        [SerializeField] private float highSurfaceLocalY = 1f;
        [SerializeField] private Vector3 localRiseDirection = Vector3.forward;

        public float LowSurfaceLocalY => lowSurfaceLocalY;
        public float HighSurfaceLocalY => highSurfaceLocalY;
        public Vector3 LocalRiseDirection => localRiseDirection;

        public void Configure(float lowY, float highY, Vector3 riseDirection)
        {
            lowSurfaceLocalY = lowY;
            highSurfaceLocalY = highY;
            localRiseDirection = riseDirection;
        }
    }
}
