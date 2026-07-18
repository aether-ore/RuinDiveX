using System;

namespace RuinCrawler.Core.Dungeon.V2
{
    /// <summary>
    /// Immutable, engine-independent traversal constants for one movement medium.
    /// Authoritative inputs are stored directly; jump height and timing are derived.
    /// </summary>
    public sealed class TraversalProfileV2
    {
        public TraversalProfileV2(
            string id,
            double capsuleRadius,
            double capsuleHeight,
            double headClearance,
            double takeoffVelocity,
            double riseGravity,
            double fallMultiplier,
            double horizontalSpeedCap,
            double airAcceleration,
            double opposingInputAccelerationMultiplier,
            double groundSpeedMultiplier,
            double groundAccelerationMultiplier,
            double groundDecelerationMultiplier,
            double ledgeCatchExtension,
            double safeDropEnvelope)
        {
            if (string.IsNullOrWhiteSpace(id))
            {
                throw new ArgumentException("Traversal profile ID is required.", nameof(id));
            }

            TraversalV2Guard.RequirePositive(capsuleRadius, nameof(capsuleRadius));
            TraversalV2Guard.RequirePositive(capsuleHeight, nameof(capsuleHeight));
            TraversalV2Guard.RequirePositive(headClearance, nameof(headClearance));
            if (headClearance < capsuleHeight)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(headClearance),
                    headClearance,
                    "Head clearance must be at least the capsule height.");
            }

            TraversalV2Guard.RequirePositive(takeoffVelocity, nameof(takeoffVelocity));
            TraversalV2Guard.RequirePositive(riseGravity, nameof(riseGravity));
            TraversalV2Guard.RequirePositive(fallMultiplier, nameof(fallMultiplier));
            TraversalV2Guard.RequirePositive(horizontalSpeedCap, nameof(horizontalSpeedCap));
            TraversalV2Guard.RequireNonNegative(airAcceleration, nameof(airAcceleration));
            TraversalV2Guard.RequireRange(
                opposingInputAccelerationMultiplier,
                0d,
                1d,
                nameof(opposingInputAccelerationMultiplier));
            TraversalV2Guard.RequirePositive(groundSpeedMultiplier, nameof(groundSpeedMultiplier));
            TraversalV2Guard.RequirePositive(groundAccelerationMultiplier, nameof(groundAccelerationMultiplier));
            TraversalV2Guard.RequirePositive(groundDecelerationMultiplier, nameof(groundDecelerationMultiplier));
            TraversalV2Guard.RequireNonNegative(ledgeCatchExtension, nameof(ledgeCatchExtension));
            TraversalV2Guard.RequireNonNegative(safeDropEnvelope, nameof(safeDropEnvelope));

            Id = id;
            CapsuleRadius = capsuleRadius;
            CapsuleHeight = capsuleHeight;
            HeadClearance = headClearance;
            TakeoffVelocity = takeoffVelocity;
            RiseGravity = riseGravity;
            FallMultiplier = fallMultiplier;
            HorizontalSpeedCap = horizontalSpeedCap;
            AirAcceleration = airAcceleration;
            OpposingInputAccelerationMultiplier = opposingInputAccelerationMultiplier;
            GroundSpeedMultiplier = groundSpeedMultiplier;
            GroundAccelerationMultiplier = groundAccelerationMultiplier;
            GroundDecelerationMultiplier = groundDecelerationMultiplier;
            LedgeCatchExtension = ledgeCatchExtension;
            SafeDropEnvelope = safeDropEnvelope;
        }

        public string Id { get; }
        public double CapsuleRadius { get; }
        public double CapsuleHeight { get; }
        public double HeadClearance { get; }
        public double TakeoffVelocity { get; }
        public double RiseGravity { get; }
        public double FallMultiplier { get; }
        public double HorizontalSpeedCap { get; }
        public double AirAcceleration { get; }
        public double OpposingInputAccelerationMultiplier { get; }
        public double GroundSpeedMultiplier { get; }
        public double GroundAccelerationMultiplier { get; }
        public double GroundDecelerationMultiplier { get; }
        public double LedgeCatchExtension { get; }
        public double SafeDropEnvelope { get; }

        public double FallGravity => RiseGravity * FallMultiplier;
        public double ApexTime => TakeoffVelocity / RiseGravity;
        public double JumpHeight => TakeoffVelocity * TakeoffVelocity / (2d * RiseGravity);
        public double DescentTimeToTakeoffHeight => Math.Sqrt(2d * JumpHeight / FallGravity);
        public double SameHeightAirTime => ApexTime + DescentTimeToTakeoffHeight;
        public double MaximumLedgeCatchRise => JumpHeight + LedgeCatchExtension;
    }

    /// <summary>
    /// Frozen traversal profiles for industrial-factory-v2. Runtime adapters select
    /// a profile at takeoff and retain that profile until the next landing.
    /// </summary>
    public static class TraversalProfilesV2
    {
        public const string DryId = "dry_v2";
        public const string FloodedId = "flooded_bottom_walk_v2";

        public static TraversalProfileV2 Dry { get; } = new TraversalProfileV2(
            DryId,
            capsuleRadius: 0.42d,
            capsuleHeight: 2.85d,
            headClearance: 3.15d,
            takeoffVelocity: 10d,
            riseGravity: 30.303030303d,
            fallMultiplier: 1.22d,
            horizontalSpeedCap: 4.35d,
            airAcceleration: 1.2d,
            opposingInputAccelerationMultiplier: 0.1d,
            groundSpeedMultiplier: 1d,
            groundAccelerationMultiplier: 1d,
            groundDecelerationMultiplier: 1d,
            ledgeCatchExtension: 1.914d,
            safeDropEnvelope: 6d);

        public static TraversalProfileV2 Flooded { get; } = new TraversalProfileV2(
            FloodedId,
            capsuleRadius: 0.42d,
            capsuleHeight: 2.85d,
            headClearance: 3.15d,
            takeoffVelocity: 9.165151390d,
            riseGravity: 8.484848485d,
            fallMultiplier: 1.22d,
            horizontalSpeedCap: 3.306d,
            airAcceleration: 0.912d,
            opposingInputAccelerationMultiplier: 0.1d,
            groundSpeedMultiplier: 0.76d,
            groundAccelerationMultiplier: 0.75d,
            groundDecelerationMultiplier: 0.75d,
            ledgeCatchExtension: 1.914d,
            safeDropEnvelope: 6d);
    }

    internal static class TraversalV2Guard
    {
        public static void RequireFinite(double value, string parameterName)
        {
            if (double.IsNaN(value) || double.IsInfinity(value))
            {
                throw new ArgumentOutOfRangeException(parameterName, value, "Value must be finite.");
            }
        }

        public static void RequirePositive(double value, string parameterName)
        {
            RequireFinite(value, parameterName);
            if (value <= 0d)
            {
                throw new ArgumentOutOfRangeException(parameterName, value, "Value must be positive.");
            }
        }

        public static void RequireNonNegative(double value, string parameterName)
        {
            RequireFinite(value, parameterName);
            if (value < 0d)
            {
                throw new ArgumentOutOfRangeException(parameterName, value, "Value must not be negative.");
            }
        }

        public static void RequireRange(double value, double minimum, double maximum, string parameterName)
        {
            RequireFinite(value, parameterName);
            if (value < minimum || value > maximum)
            {
                throw new ArgumentOutOfRangeException(
                    parameterName,
                    value,
                    "Value must be in the inclusive range [" + minimum + ", " + maximum + "].");
            }
        }
    }
}
