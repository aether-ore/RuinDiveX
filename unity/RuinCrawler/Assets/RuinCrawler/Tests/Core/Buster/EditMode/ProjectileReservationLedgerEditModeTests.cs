using System;
using System.Linq;
using NUnit.Framework;

namespace RuinCrawler.Core.Buster.Tests
{
    public sealed class ProjectileReservationLedgerEditModeTests
    {
        [Test]
        public void ReservationsAreAtomicAndReleaseIsIdempotent()
        {
            var ledger = new ProjectileReservationLedger(5);

            Assert.That(ledger.TryReserve("build-a", 3, out ProjectileReservation first), Is.True);
            Assert.That(first.Token, Is.EqualTo("build-a:reservation:1"));
            Assert.That(ledger.ReservedCount, Is.EqualTo(3));
            Assert.That(ledger.TryReserve("build-b", 3, out ProjectileReservation rejected), Is.False);
            Assert.That(rejected, Is.Null);
            Assert.That(ledger.ReservedCount, Is.EqualTo(3));

            Assert.That(ledger.Release(first.Token), Is.True);
            Assert.That(ledger.Release(first.Token), Is.False);
            Assert.That(ledger.ReservedCount, Is.Zero);
        }

        [Test]
        public void SnapshotsKeepStableCreationOrderAcrossReleases()
        {
            var ledger = new ProjectileReservationLedger(8);
            ledger.TryReserve("build-a", 1, out ProjectileReservation first);
            ledger.TryReserve("build-b", 2, out ProjectileReservation second);
            ledger.TryReserve("build-a", 1, out ProjectileReservation third);
            ledger.Release(second.Token);

            Assert.That(
                ledger.GetSnapshot().Select(entry => entry.Token),
                Is.EqualTo(new[] { first.Token, third.Token }));
            Assert.That(
                ledger.GetForWeapon("build-a").Select(entry => entry.Token),
                Is.EqualTo(new[] { first.Token, third.Token }));
        }

        [Test]
        public void InvalidReservationInputsFailVisibly()
        {
            var ledger = new ProjectileReservationLedger();

            Assert.Throws<ArgumentException>(() =>
                ledger.TryReserve(" ", 1, out ProjectileReservation _));
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                ledger.TryReserve("build-a", 0, out ProjectileReservation _));
        }

        [Test]
        public void CapacityIsNeverConfiguredBelowOne()
        {
            var ledger = new ProjectileReservationLedger(-100);

            Assert.That(ledger.Capacity, Is.EqualTo(1));
            Assert.That(ledger.TryReserve("build-a", 1, out ProjectileReservation reservation), Is.True);
            Assert.That(reservation.Count, Is.EqualTo(1));
        }
    }
}
