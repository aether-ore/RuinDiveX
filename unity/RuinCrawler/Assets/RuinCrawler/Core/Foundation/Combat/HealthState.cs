using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Foundation
{
    /// <summary>
    /// Authoritative, engine-independent health state. Event order for damage
    /// is Damaged, Changed, then Died; Died is emitted at most once until a
    /// reset restores positive health.
    /// </summary>
    public sealed class HealthState
    {
        private double _current;
        private double _maximum;
        private bool _deathEventRaised;
        private readonly DamageExecutionLedger _executions = new DamageExecutionLedger(4096);

        public event Action<DamageResult> Damaged;
        public event Action<HealthHealResult> Healed;
        public event Action<HealthChange> Changed;
        public event Action<HealthSnapshot> Died;

        public HealthSnapshot Snapshot => new HealthSnapshot(_current, _maximum);
        public double Current => _current;
        public double Maximum => _maximum;
        public bool IsDead => _current <= 0d;

        public HealthState(double maximum, double? current = null)
        {
            DoubleVector3.RequireFinite(maximum, nameof(maximum));
            if (maximum <= 0d)
            {
                throw new ArgumentOutOfRangeException(nameof(maximum), maximum, "Maximum health must be greater than zero.");
            }

            double initial = current ?? maximum;
            DoubleVector3.RequireFinite(initial, nameof(current));
            if (initial < 0d || initial > maximum)
            {
                throw new ArgumentOutOfRangeException(nameof(current), initial, "Current health must be within [0, maximum].");
            }

            _maximum = maximum;
            _current = initial;
            _deathEventRaised = initial <= 0d;
        }

        public DamageResult ApplyDamage(
            DamagePacket packet,
            double armor = 0d,
            DamageMitigationDecision? mitigation = null)
        {
            if (packet == null)
            {
                throw new ArgumentNullException(nameof(packet));
            }

            DoubleVector3.RequireFinite(armor, nameof(armor));
            if (armor < 0d)
            {
                throw new ArgumentOutOfRangeException(nameof(armor), armor, "Armor cannot be negative.");
            }

            HealthSnapshot previous = Snapshot;
            if (!_executions.TryRegister(packet.ExecutionId))
            {
                return DamageResult.NotApplied(
                    packet,
                    previous,
                    DamageApplicationDisposition.Duplicate,
                    "execution-id-replayed");
            }

            if (mitigation.HasValue)
            {
                return DamageResult.NotApplied(
                    packet,
                    previous,
                    mitigation.Value.Disposition,
                    mitigation.Value.ReasonId);
            }

            if (previous.IsDead)
            {
                return DamageResult.NotApplied(
                    packet,
                    previous,
                    DamageApplicationDisposition.AlreadyDead);
            }

            if (packet.Amount <= 0d)
            {
                return DamageResult.NotApplied(
                    packet,
                    previous,
                    DamageApplicationDisposition.ZeroDamage);
            }

            double effectiveArmor = DamageMath.ComputeEffectiveArmor(armor, packet.ArmorPierce);
            double mitigatedDamage = packet.Amount * (100d / (100d + effectiveArmor));
            double nextHealth = Math.Max(0d, previous.Current - mitigatedDamage);
            double healthDamage = previous.Current - nextHealth;
            bool targetDied = previous.Current > 0d && nextHealth <= 0d;

            _current = nextHealth;
            var result = new DamageResult(
                packet,
                effectiveArmor,
                mitigatedDamage,
                healthDamage,
                previous.Current,
                nextHealth,
                false,
                targetDied);

            if (healthDamage <= 0d)
            {
                return result;
            }

            HealthSnapshot current = Snapshot;
            Damaged?.Invoke(result);
            Changed?.Invoke(new HealthChange(HealthChangeKind.Damage, previous, current));
            if (targetDied && !_deathEventRaised)
            {
                _deathEventRaised = true;
                Died?.Invoke(current);
            }

            return result;
        }

        public HealthHealResult Heal(double amount)
        {
            DoubleVector3.RequireFinite(amount, nameof(amount));
            if (amount < 0d)
            {
                throw new ArgumentOutOfRangeException(nameof(amount), amount, "Heal amount cannot be negative.");
            }

            HealthSnapshot previous = Snapshot;
            if (previous.IsDead || amount <= 0d || previous.Current >= previous.Maximum)
            {
                return new HealthHealResult(amount, 0d, previous, previous);
            }

            _current = Math.Min(_maximum, _current + amount);
            HealthSnapshot current = Snapshot;
            var result = new HealthHealResult(amount, current.Current - previous.Current, previous, current);
            Healed?.Invoke(result);
            Changed?.Invoke(new HealthChange(HealthChangeKind.Heal, previous, current));
            return result;
        }

        public HealthSnapshot Reset(double? current = null)
        {
            double next = current ?? _maximum;
            DoubleVector3.RequireFinite(next, nameof(current));
            if (next < 0d || next > _maximum)
            {
                throw new ArgumentOutOfRangeException(nameof(current), next, "Current health must be within [0, maximum].");
            }

            HealthSnapshot previous = Snapshot;
            _current = next;
            _deathEventRaised = next <= 0d;
            _executions.Clear();
            HealthSnapshot currentSnapshot = Snapshot;
            if (previous != currentSnapshot)
            {
                Changed?.Invoke(new HealthChange(HealthChangeKind.Reset, previous, currentSnapshot));
            }

            return currentSnapshot;
        }

        public HealthSnapshot SetMaximum(double maximum, bool preserveRatio = false)
        {
            DoubleVector3.RequireFinite(maximum, nameof(maximum));
            if (maximum <= 0d)
            {
                throw new ArgumentOutOfRangeException(nameof(maximum), maximum, "Maximum health must be greater than zero.");
            }

            HealthSnapshot previous = Snapshot;
            double nextCurrent = preserveRatio
                ? maximum * previous.Normalized
                : Math.Min(previous.Current, maximum);
            _maximum = maximum;
            _current = nextCurrent;
            if (_current > 0d)
            {
                _deathEventRaised = false;
            }

            HealthSnapshot current = Snapshot;
            if (previous != current)
            {
                Changed?.Invoke(new HealthChange(HealthChangeKind.MaximumChanged, previous, current));
            }

            return current;
        }

        private sealed class DamageExecutionLedger
        {
            private readonly int capacity;
            private readonly HashSet<string> ids = new HashSet<string>(StringComparer.Ordinal);
            private readonly Queue<string> order = new Queue<string>();

            public DamageExecutionLedger(int capacity)
            {
                this.capacity = Math.Max(1, capacity);
            }

            public bool TryRegister(string executionId)
            {
                if (!ids.Add(executionId))
                {
                    return false;
                }

                order.Enqueue(executionId);
                while (order.Count > capacity)
                {
                    ids.Remove(order.Dequeue());
                }

                return true;
            }

            public void Clear()
            {
                ids.Clear();
                order.Clear();
            }
        }
    }
}
