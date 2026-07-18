using System;

namespace RuinCrawler.Core.Dungeon.V2
{
    /// <summary>
    /// Pure policy for entering a deep authored water catchment. Vertical velocity
    /// uses the conventional positive-up sign.
    /// </summary>
    public sealed class WaterEntryResponseV2
    {
        public WaterEntryResponseV2(
            double minimumCushioningDepth,
            double maximumAuthoredCatchmentFall,
            double downwardVelocityMultiplier,
            double maximumDownwardEntrySpeed,
            double submergedTerminalDescentSpeed)
        {
            TraversalV2Guard.RequirePositive(minimumCushioningDepth, nameof(minimumCushioningDepth));
            TraversalV2Guard.RequirePositive(maximumAuthoredCatchmentFall, nameof(maximumAuthoredCatchmentFall));
            TraversalV2Guard.RequireRange(
                downwardVelocityMultiplier,
                double.Epsilon,
                1d,
                nameof(downwardVelocityMultiplier));
            TraversalV2Guard.RequirePositive(maximumDownwardEntrySpeed, nameof(maximumDownwardEntrySpeed));
            TraversalV2Guard.RequirePositive(submergedTerminalDescentSpeed, nameof(submergedTerminalDescentSpeed));

            MinimumCushioningDepth = minimumCushioningDepth;
            MaximumAuthoredCatchmentFall = maximumAuthoredCatchmentFall;
            DownwardVelocityMultiplier = downwardVelocityMultiplier;
            MaximumDownwardEntrySpeed = maximumDownwardEntrySpeed;
            SubmergedTerminalDescentSpeed = submergedTerminalDescentSpeed;
        }

        public static WaterEntryResponseV2 IndustrialFactory { get; } = new WaterEntryResponseV2(
            minimumCushioningDepth: 3.15d,
            maximumAuthoredCatchmentFall: 12d,
            downwardVelocityMultiplier: 0.35d,
            maximumDownwardEntrySpeed: 4.5d,
            submergedTerminalDescentSpeed: 4.5d);

        // Profile-local default used by validators that operate on the
        // industrial-factory-v2 ruleset without owning a runtime scene.
        public static WaterEntryResponseV2 Default => IndustrialFactory;

        public double MinimumCushioningDepth { get; }
        public double MaximumAuthoredCatchmentFall { get; }
        public double DownwardVelocityMultiplier { get; }
        public double MaximumDownwardEntrySpeed { get; }
        public double SubmergedTerminalDescentSpeed { get; }

        public bool HasCushioningDepth(double waterDepth)
        {
            TraversalV2Guard.RequireNonNegative(waterDepth, nameof(waterDepth));
            return waterDepth >= MinimumCushioningDepth;
        }

        public bool SupportsAuthoredFall(double fallDistance)
        {
            TraversalV2Guard.RequireNonNegative(fallDistance, nameof(fallDistance));
            return fallDistance <= MaximumAuthoredCatchmentFall;
        }

        public double ResolveEntryVerticalVelocity(double incomingVerticalVelocity, double waterDepth)
        {
            TraversalV2Guard.RequireFinite(incomingVerticalVelocity, nameof(incomingVerticalVelocity));
            TraversalV2Guard.RequireNonNegative(waterDepth, nameof(waterDepth));
            if (incomingVerticalVelocity >= 0d || waterDepth < MinimumCushioningDepth)
            {
                return incomingVerticalVelocity;
            }

            double cushionedVelocity = incomingVerticalVelocity * DownwardVelocityMultiplier;
            return Math.Max(cushionedVelocity, -MaximumDownwardEntrySpeed);
        }

        public double ClampSubmergedVerticalVelocity(double verticalVelocity)
        {
            TraversalV2Guard.RequireFinite(verticalVelocity, nameof(verticalVelocity));
            return Math.Max(verticalVelocity, -SubmergedTerminalDescentSpeed);
        }
    }
}
