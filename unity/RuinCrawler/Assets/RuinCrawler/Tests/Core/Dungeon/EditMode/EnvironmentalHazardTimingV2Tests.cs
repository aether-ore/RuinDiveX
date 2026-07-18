using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace RuinCrawler.Core.Dungeon.V2.Tests
{
    public sealed class EnvironmentalHazardTimingV2Tests
    {
        private const double Tolerance = 1e-10d;

        [Test]
        public void MagmaGraceAndPulseCadenceAreExactAtBoundaries()
        {
            MagmaOccupancyStateV2 state = MagmaHazardSchedulerV2.BeginOccupancy(
                "magma-controller",
                "occupancy-17",
                cycleRevision: 4L);

            MagmaHazardStepResultV2 beforeGrace = MagmaHazardSchedulerV2.Advance(state, true, 0.499d);
            Assert.That(beforeGrace.Pulses, Is.Empty);

            MagmaHazardStepResultV2 atGrace = MagmaHazardSchedulerV2.Advance(
                beforeGrace.State,
                true,
                0.001d);
            Assert.That(atGrace.Pulses, Has.Count.EqualTo(1));
            AssertPulse(atGrace.Pulses[0], EnvironmentalHazardKindV2.Magma, 4L, 0L, 3d);

            MagmaHazardStepResultV2 later = MagmaHazardSchedulerV2.Advance(atGrace.State, true, 0.5d);
            Assert.That(later.Pulses.Select(value => value.PulseIndex), Is.EqualTo(new long[] { 1L, 2L }));
            Assert.That(later.State.ExposureTime, Is.EqualTo(1d).Within(Tolerance));
        }

        [Test]
        public void MagmaSeparationHysteresisPreservesThenEndsOccupancy()
        {
            MagmaOccupancyStateV2 state = MagmaHazardSchedulerV2.BeginOccupancy(
                "magma-controller",
                "occupancy-a");
            state = MagmaHazardSchedulerV2.Advance(state, true, 0.4d).State;

            MagmaHazardStepResultV2 briefExit = MagmaHazardSchedulerV2.Advance(state, false, 0.099d);
            Assert.That(briefExit.OccupancyEnded, Is.False);
            Assert.That(briefExit.State.ExposureTime, Is.EqualTo(0.4d).Within(Tolerance));

            MagmaHazardStepResultV2 reentered = MagmaHazardSchedulerV2.Advance(
                briefExit.State,
                true,
                0.1d);
            Assert.That(reentered.Pulses, Has.Count.EqualTo(1));
            Assert.That(reentered.Pulses[0].PulseIndex, Is.Zero);
            Assert.That(reentered.State.SeparationTime, Is.Zero);

            MagmaHazardStepResultV2 ended = MagmaHazardSchedulerV2.Advance(
                reentered.State,
                false,
                0.1d);
            Assert.That(ended.OccupancyEnded, Is.True);
            Assert.That(ended.State.IsActive, Is.False);
            Assert.Throws<InvalidOperationException>(() =>
                MagmaHazardSchedulerV2.Advance(ended.State, true, 0.01d));

            MagmaOccupancyStateV2 replacement = MagmaHazardSchedulerV2.BeginOccupancy(
                "magma-controller",
                "occupancy-b");
            Assert.That(replacement.ExposureTime, Is.Zero);
            Assert.That(replacement.NextPulseIndex, Is.Zero);

            MagmaHazardStepResultV2 splitThreshold = MagmaHazardSchedulerV2.Advance(
                replacement,
                false,
                0.099d);
            splitThreshold = MagmaHazardSchedulerV2.Advance(splitThreshold.State, false, 0.001d);
            Assert.That(splitThreshold.OccupancyEnded, Is.True);
        }

        [Test]
        public void MagmaLargeFrameMatchesSubstepsWithoutDuplicateExecutionIds()
        {
            MagmaOccupancyStateV2 initial = MagmaHazardSchedulerV2.BeginOccupancy(
                "magma-controller",
                "occupancy-large-frame",
                2L);

            MagmaHazardStepResultV2 large = MagmaHazardSchedulerV2.Advance(initial, true, 2d);
            IReadOnlyList<EnvironmentalHazardPulseV2> subdivided = AdvanceMagmaInSubsteps(initial, 2d, 1d / 120d);

            Assert.That(large.Pulses.Select(value => value.ExecutionId),
                Is.EqualTo(subdivided.Select(value => value.ExecutionId)));
            Assert.That(large.Pulses.Select(value => value.ExecutionId).Distinct().Count(),
                Is.EqualTo(large.Pulses.Count));
            Assert.That(large.Pulses, Has.Count.EqualTo(7));
        }

        [Test]
        public void ElectricPhaseBoundariesAndRequiredCrossingLimitAreExplicit()
        {
            Assert.That(ElectricHazardSchedulerV2.GetPhase(0d), Is.EqualTo(ElectricHazardPhaseV2.Safe));
            Assert.That(ElectricHazardSchedulerV2.GetPhase(1.249999d), Is.EqualTo(ElectricHazardPhaseV2.Safe));
            Assert.That(ElectricHazardSchedulerV2.GetPhase(1.25d), Is.EqualTo(ElectricHazardPhaseV2.Charging));
            Assert.That(ElectricHazardSchedulerV2.GetPhase(1.999999d), Is.EqualTo(ElectricHazardPhaseV2.Charging));
            Assert.That(ElectricHazardSchedulerV2.GetPhase(2d), Is.EqualTo(ElectricHazardPhaseV2.Energized));
            Assert.That(ElectricHazardSchedulerV2.GetPhase(3.499999d), Is.EqualTo(ElectricHazardPhaseV2.Energized));

            Assert.That(ElectricHazardSchedulerV2.IsRequiredCrossingDurationAccepted(1.9d - 1e-9d), Is.True);
            Assert.That(ElectricHazardSchedulerV2.IsRequiredCrossingDurationAccepted(1.9d), Is.True);
            Assert.That(ElectricHazardSchedulerV2.IsRequiredCrossingDurationAccepted(1.9d + 1e-9d), Is.False);
            Assert.That(ElectricHazardSchedulerV2.IsDamageFreeWindow(0.1d, 1.9d - 1e-9d), Is.True);
            Assert.That(ElectricHazardSchedulerV2.IsDamageFreeWindow(0.1d, 1.9d), Is.True);
            Assert.That(ElectricHazardSchedulerV2.IsDamageFreeWindow(0.1d, 1.9d + 1e-9d), Is.False);
        }

        [Test]
        public void ElectricClockDoesNotRestartWhenOccupancyChanges()
        {
            ElectricHazardStateV2 state = ElectricHazardSchedulerV2.CreateInitialState("electric-district");
            state = ElectricHazardSchedulerV2.Advance(state, null, false, 1.5d).State;
            Assert.That(state.Phase, Is.EqualTo(ElectricHazardPhaseV2.Charging));

            ElectricHazardStepResultV2 reentered = ElectricHazardSchedulerV2.Advance(
                state,
                "occupancy-player",
                true,
                0.75d);
            Assert.That(reentered.State.ElapsedInCycle, Is.EqualTo(2.25d).Within(Tolerance));
            Assert.That(reentered.State.Phase, Is.EqualTo(ElectricHazardPhaseV2.Energized));
            Assert.That(reentered.Pulses, Has.Count.EqualTo(1));
            AssertPulse(reentered.Pulses[0], EnvironmentalHazardKindV2.Electric, 0L, 0L, 2.25d);
        }

        [Test]
        public void ElectricLargeFrameEmitsEveryPulseOnceAcrossCycleRevisions()
        {
            ElectricHazardStateV2 initial = ElectricHazardSchedulerV2.CreateInitialState(
                "electric-district",
                cycleRevision: 9L);

            ElectricHazardStepResultV2 large = ElectricHazardSchedulerV2.Advance(
                initial,
                "occupancy-player",
                true,
                7d);
            IReadOnlyList<EnvironmentalHazardPulseV2> subdivided = AdvanceElectricInSubsteps(
                initial,
                "occupancy-player",
                7d,
                1d / 120d);

            Assert.That(large.Pulses, Has.Count.EqualTo(12));
            Assert.That(large.Pulses.Select(value => value.ExecutionId),
                Is.EqualTo(subdivided.Select(value => value.ExecutionId)));
            Assert.That(large.Pulses.Select(value => value.ExecutionId).Distinct().Count(),
                Is.EqualTo(large.Pulses.Count));
            Assert.That(large.Pulses.Take(6).All(value => value.CycleRevision == 9L), Is.True);
            Assert.That(large.Pulses.Skip(6).All(value => value.CycleRevision == 10L), Is.True);
            Assert.That(large.State.CycleRevision, Is.EqualTo(11L));
            Assert.That(large.State.ElapsedInCycle, Is.Zero);
            Assert.That(large.State.Phase, Is.EqualTo(ElectricHazardPhaseV2.Safe));
        }

        [Test]
        public void ExecutionIdContainsLengthDelimitedStableIdentityAndCounters()
        {
            string id = EnvironmentalHazardExecutionIdV2.Build(
                "magma_floor_v1",
                "controller|west",
                "occupancy:42",
                7L,
                13L);

            Assert.That(id, Does.Contain("|controller=15:controller|west"));
            Assert.That(id, Does.Contain("|occupancy=12:occupancy:42"));
            Assert.That(id, Does.EndWith("|cycle=7|pulse=13"));
            Assert.That(id, Is.EqualTo(EnvironmentalHazardExecutionIdV2.Build(
                "magma_floor_v1",
                "controller|west",
                "occupancy:42",
                7L,
                13L)));
        }

        private static void AssertPulse(
            EnvironmentalHazardPulseV2 pulse,
            EnvironmentalHazardKindV2 expectedKind,
            long expectedRevision,
            long expectedIndex,
            double expectedAmount)
        {
            Assert.That(pulse.Kind, Is.EqualTo(expectedKind));
            Assert.That(pulse.CycleRevision, Is.EqualTo(expectedRevision));
            Assert.That(pulse.PulseIndex, Is.EqualTo(expectedIndex));
            Assert.That(pulse.Amount, Is.EqualTo(expectedAmount).Within(Tolerance));
            Assert.That(pulse.ExecutionId, Does.Contain("|controller="));
            Assert.That(pulse.ExecutionId, Does.Contain("|occupancy="));
            Assert.That(pulse.ExecutionId, Does.Contain("|cycle=" + expectedRevision));
            Assert.That(pulse.ExecutionId, Does.EndWith("|pulse=" + expectedIndex));
        }

        private static IReadOnlyList<EnvironmentalHazardPulseV2> AdvanceMagmaInSubsteps(
            MagmaOccupancyStateV2 initial,
            double duration,
            double step)
        {
            var pulses = new List<EnvironmentalHazardPulseV2>();
            MagmaOccupancyStateV2 state = initial;
            double remaining = duration;
            while (remaining > 0d)
            {
                double delta = Math.Min(step, remaining);
                MagmaHazardStepResultV2 result = MagmaHazardSchedulerV2.Advance(state, true, delta);
                state = result.State;
                pulses.AddRange(result.Pulses);
                remaining -= delta;
                if (remaining < 1e-14d)
                {
                    remaining = 0d;
                }
            }

            return pulses;
        }

        private static IReadOnlyList<EnvironmentalHazardPulseV2> AdvanceElectricInSubsteps(
            ElectricHazardStateV2 initial,
            string occupancyId,
            double duration,
            double step)
        {
            var pulses = new List<EnvironmentalHazardPulseV2>();
            ElectricHazardStateV2 state = initial;
            double remaining = duration;
            while (remaining > 0d)
            {
                double delta = Math.Min(step, remaining);
                ElectricHazardStepResultV2 result = ElectricHazardSchedulerV2.Advance(
                    state,
                    occupancyId,
                    true,
                    delta);
                state = result.State;
                pulses.AddRange(result.Pulses);
                remaining -= delta;
                if (remaining < 1e-14d)
                {
                    remaining = 0d;
                }
            }

            return pulses;
        }
    }
}
