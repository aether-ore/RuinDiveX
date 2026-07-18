namespace RuinCrawler.Core.Foundation
{
    /// <summary>
    /// The sole coordinate-space contract for the port. Three.js X and yaw
    /// are mirrored while Y and Z retain their authored values.
    /// </summary>
    public static class CoordinateConverter
    {
        public static DoubleVector3 ThreeToUnityPosition(DoubleVector3 position)
        {
            return MirrorX(position);
        }

        public static DoubleVector3 UnityToThreePosition(DoubleVector3 position)
        {
            return MirrorX(position);
        }

        public static DoubleVector3 ThreeToUnityDirection(DoubleVector3 direction)
        {
            return MirrorX(direction);
        }

        public static DoubleVector3 UnityToThreeDirection(DoubleVector3 direction)
        {
            return MirrorX(direction);
        }

        public static double ThreeToUnityYawRadians(double yawRadians)
        {
            DoubleVector3.RequireFinite(yawRadians, nameof(yawRadians));
            return -yawRadians;
        }

        public static double UnityToThreeYawRadians(double yawRadians)
        {
            DoubleVector3.RequireFinite(yawRadians, nameof(yawRadians));
            return -yawRadians;
        }

        public static double ThreeToUnityYawDegrees(double yawDegrees)
        {
            DoubleVector3.RequireFinite(yawDegrees, nameof(yawDegrees));
            return -yawDegrees;
        }

        public static double UnityToThreeYawDegrees(double yawDegrees)
        {
            DoubleVector3.RequireFinite(yawDegrees, nameof(yawDegrees));
            return -yawDegrees;
        }

        public static DoublePose ThreeToUnityPose(DoublePose pose)
        {
            return new DoublePose(
                ThreeToUnityPosition(pose.Position),
                ThreeToUnityYawRadians(pose.YawRadians));
        }

        public static DoublePose UnityToThreePose(DoublePose pose)
        {
            return new DoublePose(
                UnityToThreePosition(pose.Position),
                UnityToThreeYawRadians(pose.YawRadians));
        }

        private static DoubleVector3 MirrorX(DoubleVector3 value)
        {
            return new DoubleVector3(-value.X, value.Y, value.Z);
        }
    }
}
