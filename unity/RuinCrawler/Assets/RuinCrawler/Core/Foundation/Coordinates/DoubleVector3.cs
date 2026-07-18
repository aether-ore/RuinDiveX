using System;

namespace RuinCrawler.Core.Foundation
{
    /// <summary>
    /// Engine-independent, double-precision vector used at deterministic and
    /// serialization boundaries. Runtime adapters convert this value to and
    /// from UnityEngine.Vector3 only at the edge of the scene.
    /// </summary>
    public readonly struct DoubleVector3 : IEquatable<DoubleVector3>
    {
        public static readonly DoubleVector3 Zero = new DoubleVector3(0d, 0d, 0d);

        public double X { get; }
        public double Y { get; }
        public double Z { get; }

        public DoubleVector3(double x, double y, double z)
        {
            RequireFinite(x, nameof(x));
            RequireFinite(y, nameof(y));
            RequireFinite(z, nameof(z));

            X = x;
            Y = y;
            Z = z;
        }

        public double MagnitudeSquared => X * X + Y * Y + Z * Z;

        public bool Equals(DoubleVector3 other)
        {
            return X.Equals(other.X) && Y.Equals(other.Y) && Z.Equals(other.Z);
        }

        public override bool Equals(object obj)
        {
            return obj is DoubleVector3 other && Equals(other);
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
            return $"({X:R}, {Y:R}, {Z:R})";
        }

        public static DoubleVector3 operator +(DoubleVector3 left, DoubleVector3 right)
        {
            return new DoubleVector3(left.X + right.X, left.Y + right.Y, left.Z + right.Z);
        }

        public static DoubleVector3 operator -(DoubleVector3 left, DoubleVector3 right)
        {
            return new DoubleVector3(left.X - right.X, left.Y - right.Y, left.Z - right.Z);
        }

        public static DoubleVector3 operator *(DoubleVector3 value, double scalar)
        {
            return new DoubleVector3(value.X * scalar, value.Y * scalar, value.Z * scalar);
        }

        public static bool operator ==(DoubleVector3 left, DoubleVector3 right)
        {
            return left.Equals(right);
        }

        public static bool operator !=(DoubleVector3 left, DoubleVector3 right)
        {
            return !left.Equals(right);
        }

        internal static void RequireFinite(double value, string parameterName)
        {
            if (double.IsNaN(value) || double.IsInfinity(value))
            {
                throw new ArgumentOutOfRangeException(parameterName, value, "Value must be finite.");
            }
        }
    }
}
