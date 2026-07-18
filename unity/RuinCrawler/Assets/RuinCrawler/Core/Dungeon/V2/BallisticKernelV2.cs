using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Dungeon.V2
{
    public enum BallisticPhaseV2
    {
        Rising = 0,
        Falling = 1
    }

    public readonly struct BallisticStateV2
    {
        public BallisticStateV2(
            double elapsedTime,
            double verticalPosition,
            double verticalVelocity,
            BallisticPhaseV2 phase)
        {
            TraversalV2Guard.RequireNonNegative(elapsedTime, nameof(elapsedTime));
            TraversalV2Guard.RequireFinite(verticalPosition, nameof(verticalPosition));
            TraversalV2Guard.RequireFinite(verticalVelocity, nameof(verticalVelocity));
            if (phase != BallisticPhaseV2.Rising && phase != BallisticPhaseV2.Falling)
            {
                throw new ArgumentOutOfRangeException(nameof(phase), phase, "Unknown ballistic phase.");
            }

            if (phase == BallisticPhaseV2.Rising && verticalVelocity < 0d)
            {
                throw new ArgumentException("A rising state cannot have downward velocity.", nameof(verticalVelocity));
            }

            if (phase == BallisticPhaseV2.Falling && verticalVelocity > 0d)
            {
                throw new ArgumentException("A falling state cannot have upward velocity.", nameof(verticalVelocity));
            }

            ElapsedTime = elapsedTime;
            VerticalPosition = verticalPosition;
            VerticalVelocity = verticalVelocity;
            Phase = phase;
        }

        public double ElapsedTime { get; }
        public double VerticalPosition { get; }
        public double VerticalVelocity { get; }
        public BallisticPhaseV2 Phase { get; }
    }

    /// <summary>
    /// One constant-acceleration interval. Runtime adapters sweep collision over
    /// each interval in order; an apex-crossing update therefore yields two sweeps.
    /// </summary>
    public readonly struct BallisticSweepSegmentV2
    {
        internal BallisticSweepSegmentV2(
            BallisticPhaseV2 phase,
            double startTime,
            double duration,
            double startPosition,
            double endPosition,
            double startVelocity,
            double endVelocity,
            double acceleration)
        {
            Phase = phase;
            StartTime = startTime;
            Duration = duration;
            StartPosition = startPosition;
            EndPosition = endPosition;
            StartVelocity = startVelocity;
            EndVelocity = endVelocity;
            Acceleration = acceleration;
        }

        public BallisticPhaseV2 Phase { get; }
        public double StartTime { get; }
        public double Duration { get; }
        public double EndTime => StartTime + Duration;
        public double StartPosition { get; }
        public double EndPosition { get; }
        public double StartVelocity { get; }
        public double EndVelocity { get; }
        public double Acceleration { get; }
    }

    public sealed class BallisticStepResultV2
    {
        internal BallisticStepResultV2(
            BallisticStateV2 state,
            BallisticSweepSegmentV2[] segments,
            bool crossedApex)
        {
            State = state;
            Segments = Array.AsReadOnly(segments ?? Array.Empty<BallisticSweepSegmentV2>());
            CrossedApex = crossedApex;
        }

        public BallisticStateV2 State { get; }
        public IReadOnlyList<BallisticSweepSegmentV2> Segments { get; }
        public bool CrossedApex { get; }
    }

    /// <summary>
    /// Closed-form vertical ballistic integration with an exact phase boundary at
    /// the apex. The semigroup property makes one large step equivalent to any
    /// subdivision of the same duration, apart from floating-point roundoff.
    /// </summary>
    public static class BallisticKernelV2
    {
        public static BallisticStateV2 CreateTakeoffState(
            TraversalProfileV2 profile,
            double initialVerticalPosition = 0d)
        {
            if (profile == null)
            {
                throw new ArgumentNullException(nameof(profile));
            }

            TraversalV2Guard.RequireFinite(initialVerticalPosition, nameof(initialVerticalPosition));
            return new BallisticStateV2(
                elapsedTime: 0d,
                verticalPosition: initialVerticalPosition,
                verticalVelocity: profile.TakeoffVelocity,
                phase: BallisticPhaseV2.Rising);
        }

        public static BallisticStepResultV2 Advance(
            TraversalProfileV2 profile,
            BallisticStateV2 state,
            double deltaTime)
        {
            if (profile == null)
            {
                throw new ArgumentNullException(nameof(profile));
            }

            TraversalV2Guard.RequireNonNegative(deltaTime, nameof(deltaTime));
            if (deltaTime == 0d)
            {
                return new BallisticStepResultV2(state, Array.Empty<BallisticSweepSegmentV2>(), false);
            }

            var segments = new List<BallisticSweepSegmentV2>(2);
            BallisticStateV2 current = state;
            double remaining = deltaTime;
            bool crossedApex = false;

            if (current.Phase == BallisticPhaseV2.Rising)
            {
                double timeToApex = current.VerticalVelocity / profile.RiseGravity;
                if (remaining < timeToApex)
                {
                    current = Integrate(
                        current,
                        remaining,
                        -profile.RiseGravity,
                        BallisticPhaseV2.Rising,
                        segments,
                        forceZeroEndVelocity: false);
                    return new BallisticStepResultV2(current, segments.ToArray(), false);
                }

                if (timeToApex > 0d)
                {
                    current = Integrate(
                        current,
                        timeToApex,
                        -profile.RiseGravity,
                        BallisticPhaseV2.Rising,
                        segments,
                        forceZeroEndVelocity: true);
                }

                current = new BallisticStateV2(
                    current.ElapsedTime,
                    current.VerticalPosition,
                    0d,
                    BallisticPhaseV2.Falling);
                remaining -= timeToApex;
                if (remaining < 0d)
                {
                    remaining = 0d;
                }

                crossedApex = true;
            }

            if (remaining > 0d)
            {
                current = Integrate(
                    current,
                    remaining,
                    -profile.FallGravity,
                    BallisticPhaseV2.Falling,
                    segments,
                    forceZeroEndVelocity: false);
            }

            return new BallisticStepResultV2(current, segments.ToArray(), crossedApex);
        }

        private static BallisticStateV2 Integrate(
            BallisticStateV2 state,
            double duration,
            double acceleration,
            BallisticPhaseV2 phase,
            ICollection<BallisticSweepSegmentV2> segments,
            bool forceZeroEndVelocity)
        {
            double endPosition = state.VerticalPosition
                + state.VerticalVelocity * duration
                + 0.5d * acceleration * duration * duration;
            double endVelocity = forceZeroEndVelocity
                ? 0d
                : state.VerticalVelocity + acceleration * duration;
            var segment = new BallisticSweepSegmentV2(
                phase,
                state.ElapsedTime,
                duration,
                state.VerticalPosition,
                endPosition,
                state.VerticalVelocity,
                endVelocity,
                acceleration);
            segments.Add(segment);
            return new BallisticStateV2(
                state.ElapsedTime + duration,
                endPosition,
                endVelocity,
                phase);
        }
    }
}
