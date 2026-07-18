using System;
using NUnit.Framework;

namespace RuinCrawler.Core.Dungeon.V2.Tests
{
    public sealed class TraversalMathV2Tests
    {
        private const double TightTolerance = 1e-9d;

        [Test]
        public void DryProfileDerivesHeightAndTimingFromAuthoritativeInputs()
        {
            TraversalProfileV2 profile = TraversalProfilesV2.Dry;

            Assert.That(profile.Id, Is.EqualTo(TraversalProfilesV2.DryId));
            Assert.That(profile.ApexTime, Is.EqualTo(0.33d).Within(TightTolerance));
            Assert.That(profile.JumpHeight, Is.EqualTo(1.65d).Within(TightTolerance));
            Assert.That(profile.FallGravity, Is.EqualTo(36.96969696966d).Within(TightTolerance));
            Assert.That(profile.SameHeightAirTime, Is.EqualTo(0.62876796194094d).Within(TightTolerance));
            Assert.That(profile.MaximumLedgeCatchRise, Is.EqualTo(3.564d).Within(TightTolerance));
        }

        [Test]
        public void FloodedProfileDerivesMoonJumpWithoutIndependentHeightInputs()
        {
            TraversalProfileV2 profile = TraversalProfilesV2.Flooded;

            Assert.That(profile.Id, Is.EqualTo(TraversalProfilesV2.FloodedId));
            Assert.That(profile.GroundSpeedMultiplier, Is.EqualTo(0.76d));
            Assert.That(profile.ApexTime, Is.EqualTo(1.080178557d).Within(TightTolerance));
            Assert.That(profile.JumpHeight, Is.EqualTo(4.95d).Within(TightTolerance));
            Assert.That(profile.FallGravity, Is.EqualTo(10.3515151517d).Within(TightTolerance));
            Assert.That(profile.SameHeightAirTime, Is.EqualTo(2.058126272d).Within(TightTolerance));
            Assert.That(profile.MaximumLedgeCatchRise, Is.EqualTo(6.864d).Within(TightTolerance));
        }

        [TestCase(0.75d, 30d)]
        [TestCase(0.75d, 60d)]
        [TestCase(0.75d, 120d)]
        [TestCase(2.4d, 30d)]
        [TestCase(2.4d, 60d)]
        [TestCase(2.4d, 120d)]
        public void LargeStepMatchesSubstepsAcrossApex(double duration, double frequency)
        {
            TraversalProfileV2 profile = duration < 1d
                ? TraversalProfilesV2.Dry
                : TraversalProfilesV2.Flooded;
            BallisticStateV2 initial = BallisticKernelV2.CreateTakeoffState(profile, 7.25d);

            BallisticStateV2 large = BallisticKernelV2.Advance(profile, initial, duration).State;
            BallisticStateV2 subdivided = AdvanceInSubsteps(profile, initial, duration, 1d / frequency);

            Assert.That(subdivided.ElapsedTime, Is.EqualTo(large.ElapsedTime).Within(TightTolerance));
            Assert.That(subdivided.VerticalPosition, Is.EqualTo(large.VerticalPosition).Within(TightTolerance));
            Assert.That(subdivided.VerticalVelocity, Is.EqualTo(large.VerticalVelocity).Within(TightTolerance));
            Assert.That(subdivided.Phase, Is.EqualTo(large.Phase));
        }

        [Test]
        public void ApexCrossingProducesOrderedRiseAndFallSweepSegments()
        {
            TraversalProfileV2 profile = TraversalProfilesV2.Dry;
            BallisticStateV2 initial = BallisticKernelV2.CreateTakeoffState(profile, 2d);

            BallisticStepResultV2 result = BallisticKernelV2.Advance(profile, initial, 0.5d);

            Assert.That(result.CrossedApex, Is.True);
            Assert.That(result.Segments, Has.Count.EqualTo(2));
            BallisticSweepSegmentV2 rise = result.Segments[0];
            BallisticSweepSegmentV2 fall = result.Segments[1];
            Assert.That(rise.Phase, Is.EqualTo(BallisticPhaseV2.Rising));
            Assert.That(rise.Duration, Is.EqualTo(profile.ApexTime).Within(TightTolerance));
            Assert.That(rise.EndVelocity, Is.Zero);
            Assert.That(rise.EndPosition, Is.EqualTo(2d + profile.JumpHeight).Within(TightTolerance));
            Assert.That(fall.Phase, Is.EqualTo(BallisticPhaseV2.Falling));
            Assert.That(fall.StartTime, Is.EqualTo(rise.EndTime).Within(TightTolerance));
            Assert.That(fall.StartPosition, Is.EqualTo(rise.EndPosition).Within(TightTolerance));
            Assert.That(fall.StartVelocity, Is.Zero);
            Assert.That(fall.Acceleration, Is.EqualTo(-profile.FallGravity).Within(TightTolerance));
            Assert.That(result.State.Phase, Is.EqualTo(BallisticPhaseV2.Falling));
        }

        [Test]
        public void WaterEntryCushionsOnlyDownwardMotionInDeepEnoughWater()
        {
            WaterEntryResponseV2 response = WaterEntryResponseV2.IndustrialFactory;

            Assert.That(response.HasCushioningDepth(3.149d), Is.False);
            Assert.That(response.HasCushioningDepth(3.15d), Is.True);
            Assert.That(response.SupportsAuthoredFall(12d), Is.True);
            Assert.That(response.SupportsAuthoredFall(12.001d), Is.False);
            Assert.That(response.ResolveEntryVerticalVelocity(-20d, 3.15d), Is.EqualTo(-4.5d));
            Assert.That(response.ResolveEntryVerticalVelocity(-3d, 3.15d), Is.EqualTo(-1.05d).Within(TightTolerance));
            Assert.That(response.ResolveEntryVerticalVelocity(-20d, 3d), Is.EqualTo(-20d));
            Assert.That(response.ResolveEntryVerticalVelocity(2d, 4d), Is.EqualTo(2d));
            Assert.That(response.ClampSubmergedVerticalVelocity(-20d), Is.EqualTo(-4.5d));
            Assert.That(response.ClampSubmergedVerticalVelocity(1d), Is.EqualTo(1d));
        }

        [Test]
        public void InvalidProfileAndStepInputsFailVisibly()
        {
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                BallisticKernelV2.Advance(
                    TraversalProfilesV2.Dry,
                    BallisticKernelV2.CreateTakeoffState(TraversalProfilesV2.Dry),
                    -0.01d));
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                WaterEntryResponseV2.IndustrialFactory.ResolveEntryVerticalVelocity(double.NaN, 4d));
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                new TraversalProfileV2(
                    "invalid",
                    0.42d,
                    2.85d,
                    3.15d,
                    10d,
                    0d,
                    1.22d,
                    4.35d,
                    1.2d,
                    0.1d,
                    1d,
                    1d,
                    1d,
                    1.914d,
                    6d));
        }

        private static BallisticStateV2 AdvanceInSubsteps(
            TraversalProfileV2 profile,
            BallisticStateV2 initial,
            double totalDuration,
            double stepDuration)
        {
            BallisticStateV2 state = initial;
            double remaining = totalDuration;
            while (remaining > 0d)
            {
                double step = Math.Min(stepDuration, remaining);
                state = BallisticKernelV2.Advance(profile, state, step).State;
                remaining -= step;
                if (remaining < 1e-14d)
                {
                    remaining = 0d;
                }
            }

            return state;
        }
    }
}
