using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Dungeon.V2
{
    public enum DungeonMacroRoleKindV2
    {
        SecurityEntrance,
        AssemblyFloor,
        BrokenFreightShaft,
        SortingGantry,
        NestWarehouse,
        CredentialTower,
        MachineCore
    }

    public enum DungeonBiomeDistrictKindV2
    {
        Factory,
        Waterworks,
        MagmaUndercroft,
        ElectricalUndercroft
    }

    public enum DungeonElevationStratumV2
    {
        Lower,
        Entry,
        Upper
    }

    public enum DungeonRouteRoleV2
    {
        Critical,
        OptionalBranch,
        StateReveal,
        Shortcut,
        Recovery,
        Return
    }

    public enum DungeonReverseTraversalPolicyV2
    {
        Bidirectional,
        ForwardOnly,
        ReverseOnly,
        Prohibited
    }

    public enum DungeonRevealPolicyV2
    {
        Hidden,
        OnSight,
        OnEntry,
        OnInteraction,
        KeySeeker,
        Always
    }

    public enum DungeonDiscoveryKindV2
    {
        Salvage,
        RefractorCache,
        ZennyCache,
        FixedChipBlueprint,
        Lore,
        Shortcut,
        Landmark,
        MechanismKnowledge
    }

    public enum DungeonDiscoveryDuplicatePolicyV2
    {
        OncePerExpedition,
        OncePerRuin,
        Repeatable
    }

    public enum DungeonShortcutPersistencePolicyV2
    {
        CurrentExpedition
    }

    public enum DungeonSurfaceKindV2
    {
        Structural,
        Walkable,
        Hazard,
        WaterBed,
        MovingPlatform,
        DoorSweep,
        Rail,
        SolidOccupancy
    }

    public enum DungeonFluidKindV2
    {
        Water
    }

    public enum DungeonEnvironmentControllerKindV2
    {
        WaterRouting,
        Magma,
        ElectricCycle,
        Grounding,
        ValveUnlock,
        Door,
        Lift,
        Crumble
    }

    public enum DungeonFallCatchmentKindV2
    {
        SafePad,
        WaterBasin,
        Continuation
    }

    [Flags]
    public enum DungeonFallExposureCauseV2
    {
        None = 0,
        Walk = 1 << 0,
        Jump = 1 << 1,
        Dodge = 1 << 2,
        Knockback = 1 << 3,
        Crumble = 1 << 4,
        MovingSurfaceFailure = 1 << 5
    }

    public enum DungeonAnchorKindV2
    {
        Entry,
        Exit,
        Encounter,
        Reward,
        Console,
        Landmark,
        Safe,
        Reveal,
        ShortcutActivation,
        Spawn,
        Extraction
    }

    public enum DungeonConnectorKindV2
    {
        Ground,
        Door,
        Lift,
        Ladder,
        Jump,
        Drop,
        WaterTunnel,
        MovingPlatform
    }

    public enum DungeonMapKnowledgeLevelV2
    {
        Hidden,
        Seen,
        Visited,
        Explored
    }

    public enum DungeonVoidPolicyV2
    {
        Prohibited
    }

    /// <summary>
    /// Declares whether a spatial plan record is a transformed member of an
    /// authored certified module bake or a separately-authored assembly/runtime
    /// addition.  The distinction prevents content hashes from being treated as
    /// proof for geometry that the plan generator invented independently.
    /// </summary>
    public enum DungeonSpatialRecordSourceV2
    {
        AssemblyAddition,
        CertifiedModule
    }

    public readonly struct DungeonPoint2V2 : IEquatable<DungeonPoint2V2>
    {
        public DungeonPoint2V2(double x, double z)
        {
            DungeonV2Contract.RequireFinite(x, nameof(x));
            DungeonV2Contract.RequireFinite(z, nameof(z));
            X = x;
            Z = z;
        }

        public double X { get; }
        public double Z { get; }

        public bool Equals(DungeonPoint2V2 other) => X.Equals(other.X) && Z.Equals(other.Z);
        public override bool Equals(object obj) => obj is DungeonPoint2V2 other && Equals(other);

        public override int GetHashCode()
        {
            unchecked
            {
                return (X.GetHashCode() * 397) ^ Z.GetHashCode();
            }
        }
    }

    /// <summary>
    /// Engine-independent vertical prism. Horizontal vertices must describe a
    /// non-degenerate convex polygon in either winding direction.
    /// </summary>
    public sealed class DungeonConvexPrismV2
    {
        public DungeonConvexPrismV2(
            IEnumerable<DungeonPoint2V2> horizontalVertices,
            double minimumY,
            double maximumY)
        {
            DungeonV2Contract.RequireFinite(minimumY, nameof(minimumY));
            DungeonV2Contract.RequireFinite(maximumY, nameof(maximumY));
            if (maximumY <= minimumY)
            {
                throw new ArgumentOutOfRangeException(nameof(maximumY), maximumY, "Maximum Y must exceed minimum Y.");
            }

            HorizontalVertices = DungeonV2Contract.CopyOrdered(
                horizontalVertices,
                nameof(horizontalVertices),
                minimumCount: 3);
            ValidateConvexPolygon(HorizontalVertices, nameof(horizontalVertices));
            MinimumY = minimumY;
            MaximumY = maximumY;
        }

        public IReadOnlyList<DungeonPoint2V2> HorizontalVertices { get; }
        public double MinimumY { get; }
        public double MaximumY { get; }

        private static void ValidateConvexPolygon(
            IReadOnlyList<DungeonPoint2V2> vertices,
            string parameterName)
        {
            const double epsilon = 1e-12d;
            double signedAreaTwice = 0d;
            double windingSign = 0d;

            for (int index = 0; index < vertices.Count; index += 1)
            {
                DungeonPoint2V2 previous = vertices[index];
                DungeonPoint2V2 current = vertices[(index + 1) % vertices.Count];
                DungeonPoint2V2 next = vertices[(index + 2) % vertices.Count];
                signedAreaTwice += previous.X * current.Z - current.X * previous.Z;

                double cross = (current.X - previous.X) * (next.Z - current.Z)
                    - (current.Z - previous.Z) * (next.X - current.X);
                if (Math.Abs(cross) <= epsilon)
                {
                    continue;
                }

                double sign = Math.Sign(cross);
                if (windingSign == 0d)
                {
                    windingSign = sign;
                }
                else if (sign != windingSign)
                {
                    throw new ArgumentException("Horizontal vertices must form a convex polygon.", parameterName);
                }
            }

            if (Math.Abs(signedAreaTwice) <= epsilon || windingSign == 0d)
            {
                throw new ArgumentException("Horizontal vertices must form a non-degenerate polygon.", parameterName);
            }
        }
    }

    internal static class DungeonV2Contract
    {
        public static string RequireId(string value, string parameterName)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                throw new ArgumentException("A stable ID is required.", parameterName);
            }

            if (!string.Equals(value, value.Trim(), StringComparison.Ordinal))
            {
                throw new ArgumentException("Stable IDs may not contain leading or trailing whitespace.", parameterName);
            }

            return value;
        }

        public static string OptionalId(string value, string parameterName)
        {
            return value == null ? null : RequireId(value, parameterName);
        }

        public static void RequireFinite(double value, string parameterName)
        {
            if (double.IsNaN(value) || double.IsInfinity(value))
            {
                throw new ArgumentOutOfRangeException(parameterName, value, "Value must be finite.");
            }
        }

        public static double RequireNonNegative(double value, string parameterName)
        {
            RequireFinite(value, parameterName);
            if (value < 0d)
            {
                throw new ArgumentOutOfRangeException(parameterName, value, "Value must be non-negative.");
            }

            return value;
        }

        public static IReadOnlyList<T> CopyOrdered<T>(
            IEnumerable<T> values,
            string parameterName,
            int minimumCount = 0)
        {
            if (values == null)
            {
                throw new ArgumentNullException(parameterName);
            }

            var copy = new List<T>(values);
            if (copy.Count < minimumCount)
            {
                throw new ArgumentException("Collection contains fewer entries than required.", parameterName);
            }

            for (int index = 0; index < copy.Count; index += 1)
            {
                if (ReferenceEquals(copy[index], null))
                {
                    throw new ArgumentException("Collections may not contain null entries.", parameterName);
                }
            }

            return Array.AsReadOnly(copy.ToArray());
        }

        public static IReadOnlyList<string> CopyCanonicalIds(
            IEnumerable<string> values,
            string parameterName,
            int minimumCount = 0)
        {
            if (values == null)
            {
                throw new ArgumentNullException(parameterName);
            }

            var copy = new List<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (string value in values)
            {
                string id = RequireId(value, parameterName);
                if (!seen.Add(id))
                {
                    throw new ArgumentException("Stable ID collections may not contain duplicates: " + id, parameterName);
                }

                copy.Add(id);
            }

            if (copy.Count < minimumCount)
            {
                throw new ArgumentException("Collection contains fewer IDs than required.", parameterName);
            }

            copy.Sort(StringComparer.Ordinal);
            return Array.AsReadOnly(copy.ToArray());
        }

        public static IReadOnlyList<string> CopyOrderedIds(
            IEnumerable<string> values,
            string parameterName,
            int minimumCount = 0)
        {
            if (values == null)
            {
                throw new ArgumentNullException(parameterName);
            }

            var copy = new List<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (string value in values)
            {
                string id = RequireId(value, parameterName);
                if (!seen.Add(id))
                {
                    throw new ArgumentException("Ordered ID collections may not contain duplicates: " + id, parameterName);
                }

                copy.Add(id);
            }

            if (copy.Count < minimumCount)
            {
                throw new ArgumentException("Collection contains fewer IDs than required.", parameterName);
            }

            return Array.AsReadOnly(copy.ToArray());
        }

        public static IReadOnlyList<T> CopyCanonical<T>(
            IEnumerable<T> values,
            Func<T, string> idSelector,
            string parameterName,
            int minimumCount = 0)
        {
            if (values == null)
            {
                throw new ArgumentNullException(parameterName);
            }

            var copy = new List<T>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (T value in values)
            {
                if (ReferenceEquals(value, null))
                {
                    throw new ArgumentException("Collections may not contain null entries.", parameterName);
                }

                string id = RequireId(idSelector(value), parameterName);
                if (!seen.Add(id))
                {
                    throw new ArgumentException("Collection contains duplicate stable ID: " + id, parameterName);
                }

                copy.Add(value);
            }

            if (copy.Count < minimumCount)
            {
                throw new ArgumentException("Collection contains fewer entries than required.", parameterName);
            }

            copy.Sort((left, right) => StringComparer.Ordinal.Compare(idSelector(left), idSelector(right)));
            return Array.AsReadOnly(copy.ToArray());
        }
    }
}
