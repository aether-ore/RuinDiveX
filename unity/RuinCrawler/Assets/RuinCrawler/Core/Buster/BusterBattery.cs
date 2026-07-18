using System;

namespace RuinCrawler.Core.Buster
{
    public sealed class BusterBattery
    {
        private sealed class RollbackState
        {
            public RollbackState(BusterBattery battery)
            {
                Energy = battery.Energy;
                CycleRemaining = battery.CycleRemaining;
                RechargeDelayRemaining = battery.RechargeDelayRemaining;
                LastContext = battery.LastContext;
                RecoveryLocked = battery.RecoveryLocked;
            }

            public double Energy { get; }
            public double CycleRemaining { get; }
            public double RechargeDelayRemaining { get; }
            public object LastContext { get; }
            public bool RecoveryLocked { get; }
        }

        public BusterBattery(double maximumEnergy)
        {
            MaximumEnergy = NormalizeMaximumEnergy(maximumEnergy);
            Energy = MaximumEnergy;
        }

        public double Energy { get; private set; }
        public double MaximumEnergy { get; private set; }
        public double MaxEnergy => MaximumEnergy;
        public double CycleRemaining { get; private set; }
        public double RechargeDelayRemaining { get; private set; }
        public object LastContext { get; private set; }
        public bool RecoveryLocked { get; private set; }
        public bool Firing { get; private set; }

        internal void Reconfigure(double maximumEnergy)
        {
            MaximumEnergy = NormalizeMaximumEnergy(maximumEnergy);
            Energy = Math.Min(Energy, MaximumEnergy);
            if (Energy + BusterRuntime.ResourceEpsilon >= MaximumEnergy)
            {
                Energy = MaximumEnergy;
                RecoveryLocked = false;
            }
        }

        internal object CaptureRollbackState()
        {
            return new RollbackState(this);
        }

        internal void RestoreRollbackState(object value)
        {
            var snapshot = value as RollbackState;
            if (snapshot == null)
            {
                throw new ArgumentException("The rollback state was not created by this battery.", nameof(value));
            }

            Energy = snapshot.Energy;
            CycleRemaining = snapshot.CycleRemaining;
            RechargeDelayRemaining = snapshot.RechargeDelayRemaining;
            LastContext = snapshot.LastContext;
            RecoveryLocked = snapshot.RecoveryLocked;
        }

        internal void CommitShot(
            double energyCost,
            double cycleTime,
            double rechargeDelay,
            object context)
        {
            Energy = Math.Max(0d, Energy - Math.Max(0d, FiniteOrZero(energyCost)));
            CycleRemaining = Math.Max(0d, FiniteOrZero(cycleTime));
            RechargeDelayRemaining = Math.Max(0d, FiniteOrZero(rechargeDelay));
            LastContext = context;
            RecoveryLocked = false;
        }

        internal void SetFiring(bool value)
        {
            Firing = value;
        }

        internal void EnterRecoveryLock()
        {
            RecoveryLocked = true;
        }

        internal void Advance(
            double elapsedSeconds,
            double rechargeDuration,
            double rechargeScale)
        {
            double elapsed = Math.Max(0d, FiniteOrZero(elapsedSeconds));
            double cycleBeforeUpdate = CycleRemaining;
            double delayBeforeUpdate = RechargeDelayRemaining;
            CycleRemaining = Math.Max(0d, cycleBeforeUpdate - elapsed);
            RechargeDelayRemaining = Math.Max(0d, delayBeforeUpdate - elapsed);

            double rechargeElapsed = Math.Max(
                0d,
                elapsed - Math.Max(cycleBeforeUpdate, delayBeforeUpdate));
            if (rechargeElapsed > 0d && Energy < MaximumEnergy)
            {
                double duration = Math.Max(0.01d, FiniteOr(rechargeDuration, BusterRuleset.RechargeDurationSeconds));
                double scale = Math.Max(0d, FiniteOrZero(rechargeScale));
                Energy = Math.Min(
                    MaximumEnergy,
                    Energy + ((MaximumEnergy / duration) * rechargeElapsed * scale));
            }

            if (RecoveryLocked && Energy + BusterRuntime.ResourceEpsilon >= MaximumEnergy)
            {
                Energy = MaximumEnergy;
                RecoveryLocked = false;
            }
        }

        internal BusterBatterySnapshot CreateSnapshot(string weaponKey)
        {
            return new BusterBatterySnapshot(
                weaponKey,
                Energy,
                MaximumEnergy,
                CycleRemaining,
                RechargeDelayRemaining,
                LastContext,
                RecoveryLocked,
                Firing);
        }

        internal void Restore(BusterBatterySnapshot snapshot, double configuredMaximumEnergy)
        {
            if (snapshot == null)
            {
                throw new ArgumentNullException(nameof(snapshot));
            }

            MaximumEnergy = NormalizeMaximumEnergy(configuredMaximumEnergy);
            Energy = Math.Max(0d, Math.Min(MaximumEnergy, FiniteOr(snapshot.Energy, MaximumEnergy)));
            CycleRemaining = Math.Max(0d, FiniteOrZero(snapshot.CycleRemaining));
            RechargeDelayRemaining = Math.Max(0d, FiniteOrZero(snapshot.RechargeDelayRemaining));
            LastContext = snapshot.LastContext;
            RecoveryLocked = snapshot.RecoveryLocked;
            Firing = false;
        }

        internal void Reset(double maximumEnergy)
        {
            MaximumEnergy = NormalizeMaximumEnergy(maximumEnergy);
            Energy = MaximumEnergy;
            CycleRemaining = 0d;
            RechargeDelayRemaining = 0d;
            LastContext = null;
            RecoveryLocked = false;
            Firing = false;
        }

        private static double NormalizeMaximumEnergy(double value)
        {
            return Math.Max(1d, FiniteOr(value, 1d));
        }

        private static double FiniteOrZero(double value)
        {
            return FiniteOr(value, 0d);
        }

        private static double FiniteOr(double value, double fallback)
        {
            return double.IsNaN(value) || double.IsInfinity(value) ? fallback : value;
        }
    }
}
