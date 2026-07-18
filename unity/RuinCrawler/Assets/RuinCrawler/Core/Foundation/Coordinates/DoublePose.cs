using System;

namespace RuinCrawler.Core.Foundation
{
    /// <summary>
    /// Minimal deterministic pose. Yaw is expressed in radians so the unit is
    /// explicit and pitch/roll cannot accidentally enter gameplay kernels.
    /// </summary>
    public readonly struct DoublePose : IEquatable<DoublePose>
    {
        public DoubleVector3 Position { get; }
        public double YawRadians { get; }

        public DoublePose(DoubleVector3 position, double yawRadians)
        {
            DoubleVector3.RequireFinite(yawRadians, nameof(yawRadians));
            Position = position;
            YawRadians = yawRadians;
        }

        public bool Equals(DoublePose other)
        {
            return Position.Equals(other.Position) && YawRadians.Equals(other.YawRadians);
        }

        public override bool Equals(object obj)
        {
            return obj is DoublePose other && Equals(other);
        }

        public override int GetHashCode()
        {
            unchecked
            {
                return (Position.GetHashCode() * 397) ^ YawRadians.GetHashCode();
            }
        }

        public static bool operator ==(DoublePose left, DoublePose right)
        {
            return left.Equals(right);
        }

        public static bool operator !=(DoublePose left, DoublePose right)
        {
            return !left.Equals(right);
        }
    }
}
