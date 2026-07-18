using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Buster
{
    public sealed class ProjectileReservationLedger
    {
        private readonly Dictionary<string, ProjectileReservation> _reservations =
            new Dictionary<string, ProjectileReservation>(StringComparer.Ordinal);
        private readonly List<string> _reservationOrder = new List<string>();
        private long _reservationCounter;

        public ProjectileReservationLedger(int capacity = BusterRuleset.MaximumMovingProjectiles)
        {
            Capacity = Math.Max(1, capacity);
        }

        public int Capacity { get; }
        public int ReservedCount { get; private set; }
        public int ReservationCount => _reservations.Count;

        public bool CanReserve(int count)
        {
            return count > 0 && count <= Capacity - ReservedCount;
        }

        public bool TryReserve(string weaponKey, int count, out ProjectileReservation reservation)
        {
            if (string.IsNullOrWhiteSpace(weaponKey))
            {
                throw new ArgumentException("A projectile reservation requires a stable weapon key.", nameof(weaponKey));
            }

            if (count <= 0)
            {
                throw new ArgumentOutOfRangeException(nameof(count), "A projectile reservation must contain at least one projectile.");
            }

            if (!CanReserve(count))
            {
                reservation = null;
                return false;
            }

            string token = weaponKey + ":reservation:" + (++_reservationCounter);
            reservation = new ProjectileReservation(token, weaponKey, count);
            _reservations.Add(token, reservation);
            _reservationOrder.Add(token);
            ReservedCount += count;
            return true;
        }

        public bool Release(string token)
        {
            if (token == null || !_reservations.TryGetValue(token, out ProjectileReservation reservation))
            {
                return false;
            }

            _reservations.Remove(token);
            _reservationOrder.Remove(token);
            ReservedCount -= reservation.Count;
            return true;
        }

        public bool TryGet(string token, out ProjectileReservation reservation)
        {
            if (token == null)
            {
                reservation = null;
                return false;
            }

            return _reservations.TryGetValue(token, out reservation);
        }

        public IReadOnlyList<ProjectileReservation> GetSnapshot()
        {
            var result = new List<ProjectileReservation>(_reservationOrder.Count);
            for (int index = 0; index < _reservationOrder.Count; index += 1)
            {
                result.Add(_reservations[_reservationOrder[index]]);
            }

            return Array.AsReadOnly(result.ToArray());
        }

        public IReadOnlyList<ProjectileReservation> GetForWeapon(string weaponKey)
        {
            var result = new List<ProjectileReservation>();
            for (int index = 0; index < _reservationOrder.Count; index += 1)
            {
                ProjectileReservation reservation = _reservations[_reservationOrder[index]];
                if (string.Equals(reservation.WeaponKey, weaponKey, StringComparison.Ordinal))
                {
                    result.Add(reservation);
                }
            }

            return Array.AsReadOnly(result.ToArray());
        }
    }
}
