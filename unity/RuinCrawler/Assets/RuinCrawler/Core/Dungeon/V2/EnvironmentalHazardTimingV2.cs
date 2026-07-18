using System;
using System.Collections.Generic;
using System.Globalization;

namespace RuinCrawler.Core.Dungeon.V2
{
    public enum EnvironmentalHazardKindV2
    {
        Magma,
        Electric
    }

    /// <summary>
    /// Immutable damage intent emitted by a pure hazard clock. Runtime adapters
    /// translate this record into the central DamagePacket contract.
    /// </summary>
    public sealed class EnvironmentalHazardPulseV2
    {
        internal EnvironmentalHazardPulseV2(
            EnvironmentalHazardKindV2 kind,
            string profileId,
            string controllerId,
            string occupancyId,
            long cycleRevision,
            long pulseIndex,
            double amount,
            double scheduledTimeSeconds)
        {
            if (cycleRevision < 0L)
            {
                throw new ArgumentOutOfRangeException(nameof(cycleRevision));
            }

            if (pulseIndex < 0L)
            {
                throw new ArgumentOutOfRangeException(nameof(pulseIndex));
            }

            DungeonV2Contract.RequireFinite(amount, nameof(amount));
            DungeonV2Contract.RequireFinite(scheduledTimeSeconds, nameof(scheduledTimeSeconds));
            if (amount <= 0d)
            {
                throw new ArgumentOutOfRangeException(nameof(amount), amount, "Pulse damage must be positive.");
            }

            if (scheduledTimeSeconds < 0d)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(scheduledTimeSeconds),
                    scheduledTimeSeconds,
                    "Scheduled time must be non-negative.");
            }

            Kind = kind;
            ProfileId = DungeonV2Contract.RequireId(profileId, nameof(profileId));
            ControllerId = DungeonV2Contract.RequireId(controllerId, nameof(controllerId));
            OccupancyId = DungeonV2Contract.RequireId(occupancyId, nameof(occupancyId));
            CycleRevision = cycleRevision;
            PulseIndex = pulseIndex;
            Amount = amount;
            ScheduledTimeSeconds = scheduledTimeSeconds;
            ExecutionId = EnvironmentalHazardExecutionIdV2.Build(
                ProfileId,
                ControllerId,
                OccupancyId,
                CycleRevision,
                PulseIndex);
        }

        public EnvironmentalHazardKindV2 Kind { get; }
        public string ProfileId { get; }
        public string ControllerId { get; }
        public string OccupancyId { get; }
        public long CycleRevision { get; }
        public long PulseIndex { get; }
        public double Amount { get; }

        /// <summary>
        /// Magma uses exposure time; electricity uses time within its cycle.
        /// </summary>
        public double ScheduledTimeSeconds { get; }

        public string ExecutionId { get; }
    }

    public static class EnvironmentalHazardExecutionIdV2
    {
        public static string Build(
            string profileId,
            string controllerId,
            string occupancyId,
            long cycleRevision,
            long pulseIndex)
        {
            profileId = DungeonV2Contract.RequireId(profileId, nameof(profileId));
            controllerId = DungeonV2Contract.RequireId(controllerId, nameof(controllerId));
            occupancyId = DungeonV2Contract.RequireId(occupancyId, nameof(occupancyId));
            if (cycleRevision < 0L)
            {
                throw new ArgumentOutOfRangeException(nameof(cycleRevision));
            }

            if (pulseIndex < 0L)
            {
                throw new ArgumentOutOfRangeException(nameof(pulseIndex));
            }

            return "environmental-hazard-v2"
                + "|profile=" + Encode(profileId)
                + "|controller=" + Encode(controllerId)
                + "|occupancy=" + Encode(occupancyId)
                + "|cycle=" + cycleRevision.ToString(CultureInfo.InvariantCulture)
                + "|pulse=" + pulseIndex.ToString(CultureInfo.InvariantCulture);
        }

        private static string Encode(string value)
        {
            return value.Length.ToString(CultureInfo.InvariantCulture) + ":" + value;
        }
    }

    public sealed class MagmaOccupancyStateV2
    {
        internal MagmaOccupancyStateV2(
            string controllerId,
            string occupancyId,
            long cycleRevision,
            double exposureTime,
            double separationTime,
            long nextPulseIndex,
            bool isActive)
        {
            ControllerId = DungeonV2Contract.RequireId(controllerId, nameof(controllerId));
            OccupancyId = DungeonV2Contract.RequireId(occupancyId, nameof(occupancyId));
            if (cycleRevision < 0L)
            {
                throw new ArgumentOutOfRangeException(nameof(cycleRevision));
            }

            if (nextPulseIndex < 0L)
            {
                throw new ArgumentOutOfRangeException(nameof(nextPulseIndex));
            }

            CycleRevision = cycleRevision;
            ExposureTime = DungeonV2Contract.RequireNonNegative(exposureTime, nameof(exposureTime));
            SeparationTime = DungeonV2Contract.RequireNonNegative(separationTime, nameof(separationTime));
            NextPulseIndex = nextPulseIndex;
            IsActive = isActive;
        }

        public string ControllerId { get; }
        public string OccupancyId { get; }
        public long CycleRevision { get; }
        public double ExposureTime { get; }
        public double SeparationTime { get; }
        public long NextPulseIndex { get; }
        public bool IsActive { get; }
    }

    public sealed class MagmaHazardStepResultV2
    {
        internal MagmaHazardStepResultV2(
            MagmaOccupancyStateV2 state,
            EnvironmentalHazardPulseV2[] pulses,
            bool occupancyEnded)
        {
            State = state ?? throw new ArgumentNullException(nameof(state));
            Pulses = Array.AsReadOnly(pulses ?? Array.Empty<EnvironmentalHazardPulseV2>());
            OccupancyEnded = occupancyEnded;
        }

        public MagmaOccupancyStateV2 State { get; }
        public IReadOnlyList<EnvironmentalHazardPulseV2> Pulses { get; }
        public bool OccupancyEnded { get; }
    }

    /// <summary>
    /// Occupancy-local magma clock. Brief separations preserve accumulated
    /// exposure but never deal damage while the player is outside the group.
    /// Runtime code must split steps at known enter/exit transitions.
    /// </summary>
    public static class MagmaHazardSchedulerV2
    {
        public const string ProfileId = "magma_floor_v1";
        public const double GraceSeconds = 0.5d;
        public const double PulseIntervalSeconds = 0.25d;
        public const double DamagePerPulse = 3d;
        public const double SeparationHysteresisSeconds = 0.10d;

        private const double BoundaryToleranceSeconds = 1e-12d;

        public static MagmaOccupancyStateV2 BeginOccupancy(
            string controllerId,
            string occupancyId,
            long cycleRevision = 0L)
        {
            return new MagmaOccupancyStateV2(
                controllerId,
                occupancyId,
                cycleRevision,
                exposureTime: 0d,
                separationTime: 0d,
                nextPulseIndex: 0L,
                isActive: true);
        }

        public static MagmaHazardStepResultV2 Advance(
            MagmaOccupancyStateV2 state,
            bool isInsideOccupancyGroup,
            double deltaTime)
        {
            if (state == null)
            {
                throw new ArgumentNullException(nameof(state));
            }

            if (!state.IsActive)
            {
                throw new InvalidOperationException("Ended magma occupancy requires a new stable occupancy ID.");
            }

            DungeonV2Contract.RequireNonNegative(deltaTime, nameof(deltaTime));
            if (!isInsideOccupancyGroup)
            {
                double separation = state.SeparationTime + deltaTime;
                bool ended = separation + BoundaryToleranceSeconds >= SeparationHysteresisSeconds;
                var outsideState = new MagmaOccupancyStateV2(
                    state.ControllerId,
                    state.OccupancyId,
                    state.CycleRevision,
                    state.ExposureTime,
                    ended ? SeparationHysteresisSeconds : separation,
                    state.NextPulseIndex,
                    isActive: !ended);
                return new MagmaHazardStepResultV2(
                    outsideState,
                    Array.Empty<EnvironmentalHazardPulseV2>(),
                    ended);
            }

            if (deltaTime == 0d)
            {
                return new MagmaHazardStepResultV2(state, Array.Empty<EnvironmentalHazardPulseV2>(), false);
            }

            var pulses = new List<EnvironmentalHazardPulseV2>();
            double exposure = state.ExposureTime;
            double remaining = deltaTime;
            long nextPulseIndex = state.NextPulseIndex;
            while (remaining > 0d)
            {
                double pulseTime = GraceSeconds + nextPulseIndex * PulseIntervalSeconds;
                double timeToPulse = pulseTime - exposure;
                if (remaining + BoundaryToleranceSeconds < timeToPulse)
                {
                    exposure += remaining;
                    remaining = 0d;
                    break;
                }

                exposure = pulseTime;
                remaining -= Math.Max(0d, timeToPulse);
                pulses.Add(CreateMagmaPulse(state, nextPulseIndex, pulseTime));
                nextPulseIndex = checked(nextPulseIndex + 1L);
            }

            var nextState = new MagmaOccupancyStateV2(
                state.ControllerId,
                state.OccupancyId,
                state.CycleRevision,
                exposure,
                separationTime: 0d,
                nextPulseIndex,
                isActive: true);
            return new MagmaHazardStepResultV2(nextState, pulses.ToArray(), false);
        }

        private static EnvironmentalHazardPulseV2 CreateMagmaPulse(
            MagmaOccupancyStateV2 state,
            long pulseIndex,
            double pulseTime)
        {
            return new EnvironmentalHazardPulseV2(
                EnvironmentalHazardKindV2.Magma,
                ProfileId,
                state.ControllerId,
                state.OccupancyId,
                state.CycleRevision,
                pulseIndex,
                DamagePerPulse,
                pulseTime);
        }
    }

    public enum ElectricHazardPhaseV2
    {
        Safe,
        Charging,
        Energized
    }

    public sealed class ElectricHazardStateV2
    {
        internal ElectricHazardStateV2(
            string controllerId,
            long cycleRevision,
            double elapsedInCycle,
            int nextPulseIndex)
        {
            ControllerId = DungeonV2Contract.RequireId(controllerId, nameof(controllerId));
            if (cycleRevision < 0L)
            {
                throw new ArgumentOutOfRangeException(nameof(cycleRevision));
            }

            DungeonV2Contract.RequireNonNegative(elapsedInCycle, nameof(elapsedInCycle));
            if (elapsedInCycle >= ElectricHazardSchedulerV2.CycleSeconds)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(elapsedInCycle),
                    elapsedInCycle,
                    "Elapsed time must be normalized within one cycle.");
            }

            if (nextPulseIndex < 0 || nextPulseIndex > ElectricHazardSchedulerV2.PulsesPerCycle)
            {
                throw new ArgumentOutOfRangeException(nameof(nextPulseIndex));
            }

            CycleRevision = cycleRevision;
            ElapsedInCycle = elapsedInCycle;
            NextPulseIndex = nextPulseIndex;
        }

        public string ControllerId { get; }
        public long CycleRevision { get; }
        public double ElapsedInCycle { get; }
        public int NextPulseIndex { get; }
        public ElectricHazardPhaseV2 Phase => ElectricHazardSchedulerV2.GetPhase(ElapsedInCycle);
    }

    public sealed class ElectricHazardStepResultV2
    {
        internal ElectricHazardStepResultV2(
            ElectricHazardStateV2 state,
            EnvironmentalHazardPulseV2[] pulses)
        {
            State = state ?? throw new ArgumentNullException(nameof(state));
            Pulses = Array.AsReadOnly(pulses ?? Array.Empty<EnvironmentalHazardPulseV2>());
        }

        public ElectricHazardStateV2 State { get; }
        public IReadOnlyList<EnvironmentalHazardPulseV2> Pulses { get; }
    }

    /// <summary>
    /// District-global electrical clock. Occupancy affects pulse delivery only;
    /// leaving and re-entering never restarts the safe phase.
    /// </summary>
    public static class ElectricHazardSchedulerV2
    {
        public const string ProfileId = "electric_floor_cycle_v1";
        public const double SafeSeconds = 1.25d;
        public const double ChargingSeconds = 0.75d;
        public const double EnergizedSeconds = 1.5d;
        public const double PulseIntervalSeconds = 0.25d;
        public const double DamagePerPulse = 2.25d;
        public const double RequiredCrossingLimitSeconds = 1.9d;
        public const double CycleSeconds = SafeSeconds + ChargingSeconds + EnergizedSeconds;
        public const int PulsesPerCycle = 6;

        private const double EnergizedStartSeconds = SafeSeconds + ChargingSeconds;
        private const double BoundaryToleranceSeconds = 1e-12d;

        public static ElectricHazardStateV2 CreateInitialState(
            string controllerId,
            long cycleRevision = 0L)
        {
            return new ElectricHazardStateV2(controllerId, cycleRevision, 0d, 0);
        }

        public static ElectricHazardPhaseV2 GetPhase(double elapsedInCycle)
        {
            DungeonV2Contract.RequireNonNegative(elapsedInCycle, nameof(elapsedInCycle));
            if (elapsedInCycle >= CycleSeconds)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(elapsedInCycle),
                    elapsedInCycle,
                    "Elapsed time must be normalized within one cycle.");
            }

            if (elapsedInCycle < SafeSeconds)
            {
                return ElectricHazardPhaseV2.Safe;
            }

            return elapsedInCycle < EnergizedStartSeconds
                ? ElectricHazardPhaseV2.Charging
                : ElectricHazardPhaseV2.Energized;
        }

        public static bool IsRequiredCrossingDurationAccepted(double duration)
        {
            DungeonV2Contract.RequireNonNegative(duration, nameof(duration));
            return duration <= RequiredCrossingLimitSeconds;
        }

        public static bool IsDamageFreeWindow(double startTimeInCycle, double duration)
        {
            DungeonV2Contract.RequireNonNegative(startTimeInCycle, nameof(startTimeInCycle));
            DungeonV2Contract.RequireNonNegative(duration, nameof(duration));
            if (startTimeInCycle >= CycleSeconds)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(startTimeInCycle),
                    startTimeInCycle,
                    "Start time must be normalized within one cycle.");
            }

            if (duration == 0d)
            {
                return true;
            }

            return startTimeInCycle < EnergizedStartSeconds
                && duration <= EnergizedStartSeconds - startTimeInCycle;
        }

        public static ElectricHazardStepResultV2 Advance(
            ElectricHazardStateV2 state,
            string occupancyId,
            bool isOccupyingHazard,
            double deltaTime)
        {
            if (state == null)
            {
                throw new ArgumentNullException(nameof(state));
            }

            if (isOccupyingHazard)
            {
                occupancyId = DungeonV2Contract.RequireId(occupancyId, nameof(occupancyId));
            }

            DungeonV2Contract.RequireNonNegative(deltaTime, nameof(deltaTime));
            if (deltaTime == 0d)
            {
                return new ElectricHazardStepResultV2(state, Array.Empty<EnvironmentalHazardPulseV2>());
            }

            var pulses = new List<EnvironmentalHazardPulseV2>();
            double time = state.ElapsedInCycle;
            double remaining = deltaTime;
            long revision = state.CycleRevision;
            int nextPulseIndex = state.NextPulseIndex;
            while (remaining > 0d)
            {
                double pulseTime = nextPulseIndex < PulsesPerCycle
                    ? EnergizedStartSeconds + (nextPulseIndex + 1) * PulseIntervalSeconds
                    : CycleSeconds;
                double boundaryTime = Math.Min(pulseTime, CycleSeconds);
                double timeToBoundary = boundaryTime - time;
                if (remaining + BoundaryToleranceSeconds < timeToBoundary)
                {
                    time += remaining;
                    remaining = 0d;
                    break;
                }

                time = boundaryTime;
                remaining -= Math.Max(0d, timeToBoundary);
                if (nextPulseIndex < PulsesPerCycle && time == pulseTime)
                {
                    if (isOccupyingHazard)
                    {
                        pulses.Add(new EnvironmentalHazardPulseV2(
                            EnvironmentalHazardKindV2.Electric,
                            ProfileId,
                            state.ControllerId,
                            occupancyId,
                            revision,
                            nextPulseIndex,
                            DamagePerPulse,
                            pulseTime));
                    }

                    nextPulseIndex += 1;
                }

                if (time >= CycleSeconds)
                {
                    revision = checked(revision + 1L);
                    time = 0d;
                    nextPulseIndex = 0;
                }
            }

            var nextState = new ElectricHazardStateV2(
                state.ControllerId,
                revision,
                time,
                nextPulseIndex);
            return new ElectricHazardStepResultV2(nextState, pulses.ToArray());
        }
    }
}
