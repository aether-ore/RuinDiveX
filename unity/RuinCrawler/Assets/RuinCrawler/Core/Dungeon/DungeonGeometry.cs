using System;
using System.Globalization;

namespace RuinCrawler.Core.Dungeon
{
    /// <summary>
    /// Engine-independent, double-precision point in the authoritative Three.js
    /// coordinate convention. Runtime adapters perform the handedness conversion.
    /// </summary>
    public readonly struct DungeonPoint3 : IEquatable<DungeonPoint3>
    {
        public static readonly DungeonPoint3 Zero = new DungeonPoint3(0d, 0d, 0d);

        public DungeonPoint3(double x, double y, double z)
        {
            RequireFinite(x, nameof(x));
            RequireFinite(y, nameof(y));
            RequireFinite(z, nameof(z));
            X = x;
            Y = y;
            Z = z;
        }

        public double X { get; }
        public double Y { get; }
        public double Z { get; }

        public bool Equals(DungeonPoint3 other)
        {
            return X.Equals(other.X) && Y.Equals(other.Y) && Z.Equals(other.Z);
        }

        public override bool Equals(object obj)
        {
            return obj is DungeonPoint3 other && Equals(other);
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

        public static bool operator ==(DungeonPoint3 left, DungeonPoint3 right)
        {
            return left.Equals(right);
        }

        public static bool operator !=(DungeonPoint3 left, DungeonPoint3 right)
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

    public readonly struct DungeonGridPoint : IEquatable<DungeonGridPoint>
    {
        public DungeonGridPoint(int x, int z, int level = 0)
        {
            X = x;
            Z = z;
            Level = level;
        }

        public int X { get; }
        public int Z { get; }
        public int Level { get; }

        public int ManhattanDistance(DungeonGridPoint other)
        {
            return Math.Abs(X - other.X) + Math.Abs(Z - other.Z) + Math.Abs(Level - other.Level);
        }

        public bool Equals(DungeonGridPoint other)
        {
            return X == other.X && Z == other.Z && Level == other.Level;
        }

        public override bool Equals(object obj)
        {
            return obj is DungeonGridPoint other && Equals(other);
        }

        public override int GetHashCode()
        {
            unchecked
            {
                int hash = X;
                hash = (hash * 397) ^ Z;
                hash = (hash * 397) ^ Level;
                return hash;
            }
        }

        public override string ToString()
        {
            return X + "," + Z + "@" + Level;
        }

        public static bool operator ==(DungeonGridPoint left, DungeonGridPoint right)
        {
            return left.Equals(right);
        }

        public static bool operator !=(DungeonGridPoint left, DungeonGridPoint right)
        {
            return !left.Equals(right);
        }
    }

    public readonly struct DungeonRect : IEquatable<DungeonRect>
    {
        public DungeonRect(double centerX, double centerZ, double width, double depth)
        {
            DungeonPoint3.RequireFinite(centerX, nameof(centerX));
            DungeonPoint3.RequireFinite(centerZ, nameof(centerZ));
            DungeonPoint3.RequireFinite(width, nameof(width));
            DungeonPoint3.RequireFinite(depth, nameof(depth));
            if (width <= 0d)
            {
                throw new ArgumentOutOfRangeException(nameof(width), width, "Width must be positive.");
            }

            if (depth <= 0d)
            {
                throw new ArgumentOutOfRangeException(nameof(depth), depth, "Depth must be positive.");
            }

            CenterX = centerX;
            CenterZ = centerZ;
            Width = width;
            Depth = depth;
        }

        public double CenterX { get; }
        public double CenterZ { get; }
        public double Width { get; }
        public double Depth { get; }
        public double MinimumX => CenterX - Width * 0.5d;
        public double MaximumX => CenterX + Width * 0.5d;
        public double MinimumZ => CenterZ - Depth * 0.5d;
        public double MaximumZ => CenterZ + Depth * 0.5d;

        public bool Contains(DungeonPoint3 point, double tolerance = 0d)
        {
            return point.X >= MinimumX - tolerance
                && point.X <= MaximumX + tolerance
                && point.Z >= MinimumZ - tolerance
                && point.Z <= MaximumZ + tolerance;
        }

        public bool Contains(DungeonRect other, double tolerance = 0d)
        {
            return other.MinimumX >= MinimumX - tolerance
                && other.MaximumX <= MaximumX + tolerance
                && other.MinimumZ >= MinimumZ - tolerance
                && other.MaximumZ <= MaximumZ + tolerance;
        }

        public bool Equals(DungeonRect other)
        {
            return CenterX.Equals(other.CenterX)
                && CenterZ.Equals(other.CenterZ)
                && Width.Equals(other.Width)
                && Depth.Equals(other.Depth);
        }

        public override bool Equals(object obj)
        {
            return obj is DungeonRect other && Equals(other);
        }

        public override int GetHashCode()
        {
            unchecked
            {
                int hash = CenterX.GetHashCode();
                hash = (hash * 397) ^ CenterZ.GetHashCode();
                hash = (hash * 397) ^ Width.GetHashCode();
                hash = (hash * 397) ^ Depth.GetHashCode();
                return hash;
            }
        }

        public override string ToString()
        {
            return string.Format(
                CultureInfo.InvariantCulture,
                "center=({0:R},{1:R}) size=({2:R},{3:R})",
                CenterX,
                CenterZ,
                Width,
                Depth);
        }
    }

    public readonly struct DungeonBounds3 : IEquatable<DungeonBounds3>
    {
        public DungeonBounds3(DungeonPoint3 minimum, DungeonPoint3 maximum)
        {
            if (maximum.X < minimum.X || maximum.Y < minimum.Y || maximum.Z < minimum.Z)
            {
                throw new ArgumentException("Maximum bounds must not be below minimum bounds.", nameof(maximum));
            }

            Minimum = minimum;
            Maximum = maximum;
        }

        public DungeonPoint3 Minimum { get; }
        public DungeonPoint3 Maximum { get; }

        public bool Contains(DungeonPoint3 point, double tolerance = 0d)
        {
            return point.X >= Minimum.X - tolerance
                && point.X <= Maximum.X + tolerance
                && point.Y >= Minimum.Y - tolerance
                && point.Y <= Maximum.Y + tolerance
                && point.Z >= Minimum.Z - tolerance
                && point.Z <= Maximum.Z + tolerance;
        }

        public bool Equals(DungeonBounds3 other)
        {
            return Minimum.Equals(other.Minimum) && Maximum.Equals(other.Maximum);
        }

        public override bool Equals(object obj)
        {
            return obj is DungeonBounds3 other && Equals(other);
        }

        public override int GetHashCode()
        {
            unchecked
            {
                return (Minimum.GetHashCode() * 397) ^ Maximum.GetHashCode();
            }
        }
    }
}
