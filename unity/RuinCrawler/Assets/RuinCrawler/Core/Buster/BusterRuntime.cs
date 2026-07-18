using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Buster
{
    public sealed class BusterRuntime : IWeaponRuntime
    {
        public const double ResourceEpsilon = 0.000001d;

        private readonly Dictionary<string, CompiledBusterPlan> _plans =
            new Dictionary<string, CompiledBusterPlan>(StringComparer.Ordinal);
        private readonly Dictionary<string, BusterBattery> _batteries =
            new Dictionary<string, BusterBattery>(StringComparer.Ordinal);
        private readonly List<string> _batteryOrder = new List<string>();
        private readonly ProjectileReservationLedger _reservations;
        private readonly WeaponShotExecutor _executeShot;
        private readonly WeaponExecutionCanceller _cancelExecution;
        private long _executionCounter;

        public BusterRuntime(
            int projectileCapacity = BusterRuleset.MaximumMovingProjectiles,
            double rechargeDelay = BusterRuleset.RechargeDelaySeconds,
            double rechargeDuration = BusterRuleset.RechargeDurationSeconds,
            WeaponShotExecutor executeShot = null,
            WeaponExecutionCanceller cancelExecution = null)
        {
            ProjectileCapacity = Math.Max(1, projectileCapacity);
            RechargeDelay = Math.Max(0d, FiniteOr(rechargeDelay, BusterRuleset.RechargeDelaySeconds));
            RechargeDuration = Math.Max(0.01d, FiniteOr(rechargeDuration, BusterRuleset.RechargeDurationSeconds));
            _reservations = new ProjectileReservationLedger(ProjectileCapacity);
            _executeShot = executeShot;
            _cancelExecution = cancelExecution;
        }

        public string ActiveWeaponKey { get; private set; }
        public int ProjectileCapacity { get; }
        public double RechargeDelay { get; }
        public double RechargeDuration { get; }
        public int ReservedProjectileCount => _reservations.ReservedCount;
        public int RegisteredWeaponCount => _plans.Count;

        public BusterBatterySnapshot Equip(CompiledBusterPlan plan)
        {
            if (plan == null)
            {
                ActiveWeaponKey = null;
                return null;
            }

            BusterBatterySnapshot snapshot = Register(plan);
            ActiveWeaponKey = plan.WeaponKey;
            return snapshot;
        }

        public BusterBatterySnapshot Register(CompiledBusterPlan plan)
        {
            if (plan == null)
            {
                return null;
            }

            string key = RequireWeaponKey(plan);
            _plans[key] = plan;
            PlanRuntimeStats stats = ReadStats(plan);
            if (!_batteries.TryGetValue(key, out BusterBattery battery))
            {
                battery = new BusterBattery(stats.MaximumEnergy);
                _batteries.Add(key, battery);
                _batteryOrder.Add(key);
            }
            else
            {
                battery.Reconfigure(stats.MaximumEnergy);
            }

            return battery.CreateSnapshot(key);
        }

        public CompiledBusterPlan GetPlan(string weaponKey = null)
        {
            string key = ResolveKey(weaponKey);
            return key != null && _plans.TryGetValue(key, out CompiledBusterPlan plan) ? plan : null;
        }

        public bool SetActiveWeapon(string weaponKey)
        {
            if (weaponKey != null && _plans.ContainsKey(weaponKey))
            {
                ActiveWeaponKey = weaponKey;
                return true;
            }

            ActiveWeaponKey = null;
            return weaponKey == null;
        }

        public bool CanFire(string weaponKey = null)
        {
            return GetBlockReason(weaponKey) == null;
        }

        public WeaponFireRequest RequestFire(string weaponKey = null)
        {
            string key = ResolveKey(weaponKey);
            if (!TryGetWeapon(key, out CompiledBusterPlan plan, out BusterBattery battery))
            {
                return WeaponFireRequest.Rejected(WeaponFireBlockReasons.NoPlan);
            }

            if (battery.Firing)
            {
                return WeaponFireRequest.Rejected(WeaponFireBlockReasons.Firing);
            }

            if (battery.CycleRemaining > ResourceEpsilon)
            {
                return WeaponFireRequest.Rejected(WeaponFireBlockReasons.Cycle);
            }

            if (battery.RecoveryLocked)
            {
                return WeaponFireRequest.Rejected(WeaponFireBlockReasons.Recovery);
            }

            PlanRuntimeStats stats = ReadStats(plan);
            if (!_reservations.CanReserve(stats.PeakProjectileReservation))
            {
                return WeaponFireRequest.Rejected(WeaponFireBlockReasons.ProjectileCap);
            }

            if (battery.Energy + ResourceEpsilon < stats.EnergyCost)
            {
                battery.EnterRecoveryLock();
                return WeaponFireRequest.Rejected(WeaponFireBlockReasons.Energy, true);
            }

            return WeaponFireRequest.Accepted();
        }

        public string GetBlockReason(string weaponKey = null)
        {
            string key = ResolveKey(weaponKey);
            if (!TryGetWeapon(key, out CompiledBusterPlan plan, out BusterBattery battery))
            {
                return WeaponFireBlockReasons.NoPlan;
            }

            if (battery.Firing)
            {
                return WeaponFireBlockReasons.Firing;
            }

            PlanRuntimeStats stats = ReadStats(plan);
            if (battery.CycleRemaining > ResourceEpsilon)
            {
                return WeaponFireBlockReasons.Cycle;
            }

            if (battery.RecoveryLocked)
            {
                return WeaponFireBlockReasons.Recovery;
            }

            if (!_reservations.CanReserve(stats.PeakProjectileReservation))
            {
                return WeaponFireBlockReasons.ProjectileCap;
            }

            return battery.Energy + ResourceEpsilon < stats.EnergyCost
                ? WeaponFireBlockReasons.Energy
                : null;
        }

        public WeaponFireResult Fire(object context = null, string weaponKey = null)
        {
            WeaponFireRequest request = RequestFire(weaponKey);
            if (!request.Ok)
            {
                return WeaponFireResult.FromRequest(request);
            }

            string key = ResolveKey(weaponKey);
            CompiledBusterPlan plan = _plans[key];
            BusterBattery battery = _batteries[key];
            PlanRuntimeStats stats = ReadStats(plan);
            if (!_reservations.TryReserve(
                key,
                stats.PeakProjectileReservation,
                out ProjectileReservation reservation))
            {
                return WeaponFireResult.Rejected(WeaponFireBlockReasons.ProjectileCap);
            }

            string executionId = key + ":execution:" + (++_executionCounter);
            var execution = new WeaponExecution(executionId, reservation, plan, context);
            object rollback = battery.CaptureRollbackState();
            battery.SetFiring(true);
            battery.CommitShot(stats.EnergyCost, stats.CycleTime, RechargeDelay, context);

            bool accepted = true;
            try
            {
                if (_executeShot != null)
                {
                    accepted = _executeShot(execution);
                }
            }
            catch
            {
                battery.RestoreRollbackState(rollback);
                _reservations.Release(reservation.Token);
                throw;
            }
            finally
            {
                battery.SetFiring(false);
            }

            if (!accepted)
            {
                battery.RestoreRollbackState(rollback);
                _reservations.Release(reservation.Token);
                return WeaponFireResult.Rejected(WeaponFireBlockReasons.SpawnRejected);
            }

            return WeaponFireResult.Accepted(execution);
        }

        public void Update(double elapsedSeconds)
        {
            AdvanceAll(elapsedSeconds);
        }

        public void Update(double elapsedSeconds, string activeWeaponKey)
        {
            SetActiveWeapon(activeWeaponKey);
            AdvanceAll(elapsedSeconds);
        }

        public int CancelBuild(string weaponKey, string reason = "cancelled")
        {
            if (weaponKey == null)
            {
                return 0;
            }

            IReadOnlyList<ProjectileReservation> reservations = _reservations.GetForWeapon(weaponKey);
            for (int index = 0; index < reservations.Count; index += 1)
            {
                ProjectileReservation reservation = reservations[index];
                try
                {
                    if (_cancelExecution != null)
                    {
                        _cancelExecution(new WeaponExecutionCancellation(reservation, reason));
                    }
                }
                finally
                {
                    _reservations.Release(reservation.Token);
                }
            }

            return reservations.Count;
        }

        public bool Unregister(
            string weaponKey,
            bool cancelExecutions = false,
            bool removeState = true,
            string reason = "invalidated")
        {
            if (weaponKey == null)
            {
                return false;
            }

            bool existed = _plans.Remove(weaponKey);
            if (cancelExecutions)
            {
                CancelBuild(weaponKey, reason);
            }

            if (removeState)
            {
                _batteries.Remove(weaponKey);
                _batteryOrder.Remove(weaponKey);
            }

            if (string.Equals(ActiveWeaponKey, weaponKey, StringComparison.Ordinal))
            {
                ActiveWeaponKey = null;
            }

            return existed;
        }

        public bool ResetWeapon(string weaponKey = null, bool remove = false)
        {
            string key = ResolveKey(weaponKey);
            if (key == null)
            {
                return false;
            }

            CancelBuild(key, "reset");
            bool hasPlan = _plans.TryGetValue(key, out CompiledBusterPlan plan);
            if (remove)
            {
                _plans.Remove(key);
                _batteries.Remove(key);
                _batteryOrder.Remove(key);
                if (string.Equals(ActiveWeaponKey, key, StringComparison.Ordinal))
                {
                    ActiveWeaponKey = null;
                }

                return hasPlan;
            }

            if (!hasPlan)
            {
                return false;
            }

            if (!_batteries.TryGetValue(key, out BusterBattery battery))
            {
                battery = new BusterBattery(ReadStats(plan).MaximumEnergy);
                _batteries.Add(key, battery);
                _batteryOrder.Add(key);
            }
            else
            {
                battery.Reset(ReadStats(plan).MaximumEnergy);
            }

            return true;
        }

        public BusterRuntimeResourceSnapshot CreateResourceSnapshot()
        {
            var batteries = new List<BusterBatterySnapshot>(_batteryOrder.Count);
            for (int index = 0; index < _batteryOrder.Count; index += 1)
            {
                string key = _batteryOrder[index];
                batteries.Add(_batteries[key].CreateSnapshot(key));
            }

            return new BusterRuntimeResourceSnapshot(ActiveWeaponKey, batteries);
        }

        public bool RestoreResourceSnapshot(BusterRuntimeResourceSnapshot snapshot)
        {
            if (snapshot == null)
            {
                return false;
            }

            for (int index = 0; index < snapshot.Batteries.Count; index += 1)
            {
                BusterBatterySnapshot saved = snapshot.Batteries[index];
                if (saved == null
                    || saved.WeaponKey == null
                    || !_plans.TryGetValue(saved.WeaponKey, out CompiledBusterPlan plan))
                {
                    continue;
                }

                if (!_batteries.TryGetValue(saved.WeaponKey, out BusterBattery battery))
                {
                    battery = new BusterBattery(ReadStats(plan).MaximumEnergy);
                    _batteries.Add(saved.WeaponKey, battery);
                    _batteryOrder.Add(saved.WeaponKey);
                }

                battery.Restore(saved, ReadStats(plan).MaximumEnergy);
            }

            ActiveWeaponKey = snapshot.ActiveWeaponKey != null && _plans.ContainsKey(snapshot.ActiveWeaponKey)
                ? snapshot.ActiveWeaponKey
                : null;
            return true;
        }

        public bool ReleaseReservation(string reservationToken)
        {
            return _reservations.Release(reservationToken);
        }

        public bool TryGetReservation(string reservationToken, out ProjectileReservation reservation)
        {
            return _reservations.TryGet(reservationToken, out reservation);
        }

        public IReadOnlyList<ProjectileReservation> GetReservations()
        {
            return _reservations.GetSnapshot();
        }

        public BusterBatterySnapshot GetBatterySnapshot(string weaponKey = null)
        {
            string key = ResolveKey(weaponKey);
            return key != null && _batteries.TryGetValue(key, out BusterBattery battery)
                ? battery.CreateSnapshot(key)
                : null;
        }

        public WeaponTelemetry GetTelemetry(string weaponKey = null)
        {
            string key = ResolveKey(weaponKey);
            if (!TryGetWeapon(key, out CompiledBusterPlan plan, out BusterBattery battery))
            {
                return null;
            }

            PlanRuntimeStats stats = ReadStats(plan);
            string blockReason = GetBlockReason(key);
            return new WeaponTelemetry(
                key,
                plan.BuildId,
                plan.BuildRevision,
                battery.Energy,
                battery.MaximumEnergy,
                stats.EnergyCost,
                battery.CycleRemaining,
                battery.RechargeDelayRemaining,
                battery.RecoveryLocked,
                blockReason == null,
                blockReason,
                ReservedProjectileCount,
                ProjectileCapacity);
        }

        private void AdvanceAll(double elapsedSeconds)
        {
            double elapsed = Math.Max(0d, FiniteOr(elapsedSeconds, 0d));
            for (int index = 0; index < _batteryOrder.Count; index += 1)
            {
                string key = _batteryOrder[index];
                if (!_plans.ContainsKey(key))
                {
                    continue;
                }

                double rechargeScale = string.Equals(key, ActiveWeaponKey, StringComparison.Ordinal) ? 1d : 0.5d;
                _batteries[key].Advance(elapsed, RechargeDuration, rechargeScale);
            }
        }

        private bool TryGetWeapon(
            string key,
            out CompiledBusterPlan plan,
            out BusterBattery battery)
        {
            if (key == null || !_plans.TryGetValue(key, out plan) || !_batteries.TryGetValue(key, out battery))
            {
                plan = null;
                battery = null;
                return false;
            }

            return true;
        }

        private string ResolveKey(string weaponKey)
        {
            return weaponKey ?? ActiveWeaponKey;
        }

        private static string RequireWeaponKey(CompiledBusterPlan plan)
        {
            if (string.IsNullOrWhiteSpace(plan.WeaponKey))
            {
                throw new ArgumentException("A compiled Buster plan requires a stable weapon key.", nameof(plan));
            }

            return plan.WeaponKey;
        }

        private static PlanRuntimeStats ReadStats(CompiledBusterPlan plan)
        {
            BusterStats source = plan.Stats;
            return new PlanRuntimeStats(
                Math.Max(1d, FiniteOr(source.MaxEnergy, 1d)),
                Math.Max(0d, FiniteOr(source.EnergyCost, 0d)),
                Math.Max(0d, FiniteOr(source.CycleTime, 0d)),
                Math.Max(1, plan.PeakProjectileReservation));
        }

        private static double FiniteOr(double value, double fallback)
        {
            return double.IsNaN(value) || double.IsInfinity(value) ? fallback : value;
        }

        private sealed class PlanRuntimeStats
        {
            public PlanRuntimeStats(
                double maximumEnergy,
                double energyCost,
                double cycleTime,
                int peakProjectileReservation)
            {
                MaximumEnergy = maximumEnergy;
                EnergyCost = energyCost;
                CycleTime = cycleTime;
                PeakProjectileReservation = peakProjectileReservation;
            }

            public double MaximumEnergy { get; }
            public double EnergyCost { get; }
            public double CycleTime { get; }
            public int PeakProjectileReservation { get; }
        }
    }
}
