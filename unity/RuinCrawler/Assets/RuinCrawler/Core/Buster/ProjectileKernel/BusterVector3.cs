using System;
using System.Globalization;

namespace RuinCrawler.Core.Buster.ProjectileKernel
{
    /// <summary>
    /// Double-precision vector used by the deterministic Buster kernel. Unity adapters cast
    /// to Vector3 only at the scene boundary.
    /// </summary>
    public readonly struct BusterVector3 : IEquatable<BusterVector3>
    {
        public static readonly BusterVector3 Zero = new BusterVector3(0d, 0d, 0d);
        public static readonly BusterVector3 Forward = new BusterVector3(0d, 0d, 1d);

        public BusterVector3(double x, double y, double z)
        {
            X = FiniteOrZero(x);
            Y = FiniteOrZero(y);
            Z = FiniteOrZero(z);
        }

        public double X { get; }
        public double Y { get; }
        public double Z { get; }
        public double LengthSquared => (X * X) + (Y * Y) + (Z * Z);
        public double Length => Math.Sqrt(LengthSquared);

        public BusterVector3 Normalized(BusterVector3 fallback = default)
        {
            double length = Length;
            if (length > 0.000001d)
            {
                return this / length;
            }

            double fallbackLength = fallback.Length;
            return fallbackLength > 0.000001d ? fallback / fallbackLength : Forward;
        }

        public static double DistanceSquared(BusterVector3 left, BusterVector3 right)
        {
            return (left - right).LengthSquared;
        }

        public static double Dot(BusterVector3 left, BusterVector3 right)
        {
            return (left.X * right.X) + (left.Y * right.Y) + (left.Z * right.Z);
        }

        public static BusterVector3 Cross(BusterVector3 left, BusterVector3 right)
        {
            return new BusterVector3(
                (left.Y * right.Z) - (left.Z * right.Y),
                (left.Z * right.X) - (left.X * right.Z),
                (left.X * right.Y) - (left.Y * right.X));
        }

        public static BusterVector3 Lerp(BusterVector3 left, BusterVector3 right, double alpha)
        {
            double t = Math.Max(0d, Math.Min(1d, FiniteOrZero(alpha)));
            return left + ((right - left) * t);
        }

        public static BusterVector3 operator +(BusterVector3 left, BusterVector3 right)
        {
            return new BusterVector3(left.X + right.X, left.Y + right.Y, left.Z + right.Z);
        }

        public static BusterVector3 operator -(BusterVector3 left, BusterVector3 right)
        {
            return new BusterVector3(left.X - right.X, left.Y - right.Y, left.Z - right.Z);
        }

        public static BusterVector3 operator *(BusterVector3 value, double scalar)
        {
            double amount = double.IsNaN(scalar) || double.IsInfinity(scalar) ? 0d : scalar;
            return new BusterVector3(value.X * amount, value.Y * amount, value.Z * amount);
        }

        public static BusterVector3 operator *(double scalar, BusterVector3 value)
        {
            return value * scalar;
        }

        public static BusterVector3 operator /(BusterVector3 value, double scalar)
        {
            return Math.Abs(scalar) <= double.Epsilon ? Zero : value * (1d / scalar);
        }

        public bool Equals(BusterVector3 other)
        {
            return X.Equals(other.X) && Y.Equals(other.Y) && Z.Equals(other.Z);
        }

        public override bool Equals(object obj)
        {
            return obj is BusterVector3 other && Equals(other);
        }

        public override int GetHashCode()
        {
            unchecked
            {
                int hash = X.GetHashCode();
                hash = (hash * 397) ^ Y.GetHashCode();
                hash = (hash * 397) ^ Z.GetHashCode();
                return hash;
            }
        }

        public override string ToString()
        {
            return string.Format(
                CultureInfo.InvariantCulture,
                "({0:R}, {1:R}, {2:R})",
                X,
                Y,
                Z);
        }

        private static double FiniteOrZero(double value)
        {
            return double.IsNaN(value) || double.IsInfinity(value) ? 0d : value;
        }
    }
}
