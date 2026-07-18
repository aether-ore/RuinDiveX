using System;
using NUnit.Framework;

namespace RuinCrawler.Core.Foundation.Tests
{
    public sealed class CombatTargetRegistryTests
    {
        [Test]
        public void RegistrationUsesStableOrdinalIdsAndRejectsDuplicates()
        {
            var registry = new CombatTargetRegistry();
            CombatTargetDescriptor body = Body("enemy:b");
            CombatTargetDescriptor other = Body("enemy:a");

            Assert.That(registry.TryRegister(body), Is.True);
            Assert.That(registry.TryRegister(body), Is.False);
            Assert.That(registry.TryRegister(other), Is.True);
            Assert.That(registry.Count, Is.EqualTo(2));
            Assert.That(registry.GetSnapshot()[0].TargetId.Value, Is.EqualTo("enemy:a"));
            Assert.That(registry.GetSnapshot()[1].TargetId.Value, Is.EqualTo("enemy:b"));
        }

        [Test]
        public void CoveredWeakPointRetainsLockAndBrokenWeakPointTransfersToBody()
        {
            var registry = new CombatTargetRegistry();
            CombatTargetDescriptor body = Body("enemy:1");
            var weakPointId = new CombatTargetId("enemy:1:weak-point");
            var weakPoint = new CombatTargetDescriptor(
                weakPointId,
                body.OwnerId,
                "Sharukurusu",
                CombatTargetKind.WeakPoint,
                new DoubleVector3(0d, 1.7d, 0d),
                0.2d,
                isActive: false,
                retainLockWhenInactive: true,
                fallbackTargetId: body.TargetId,
                partLabel: "Weak Point");
            registry.TryRegister(body);
            registry.TryRegister(weakPoint);

            Assert.That(registry.TryResolveRetainable(weakPointId, out CombatTargetDescriptor covered), Is.True);
            Assert.That(covered.TargetId, Is.EqualTo(weakPointId));

            registry.Upsert(weakPoint.WithState(isActive: false, isDead: true));
            Assert.That(registry.TryResolveRetainable(weakPointId, out CombatTargetDescriptor transferred), Is.True);
            Assert.That(transferred.TargetId, Is.EqualTo(body.TargetId));
        }

        [Test]
        public void MissingOrCyclicFallbackFailsWithoutSubstitution()
        {
            var registry = new CombatTargetRegistry();
            var firstId = new CombatTargetId("part:first");
            var secondId = new CombatTargetId("part:second");
            registry.TryRegister(InactivePart(firstId, secondId));
            registry.TryRegister(InactivePart(secondId, firstId));

            Assert.That(registry.TryResolveRetainable(firstId, out CombatTargetDescriptor resolved), Is.False);
            Assert.That(resolved, Is.Null);
        }

        [Test]
        public void EmptyTargetIdsFailVisibly()
        {
            Assert.Throws<ArgumentException>(() => new CombatTargetId(" "));
            Assert.That(CombatTargetId.TryCreate(null, out _), Is.False);
        }

        private static CombatTargetDescriptor Body(string id)
        {
            var targetId = new CombatTargetId(id);
            return new CombatTargetDescriptor(
                targetId,
                targetId,
                "Sharukurusu",
                CombatTargetKind.Body,
                new DoubleVector3(0d, 1.15d, 0d),
                0.78d);
        }

        private static CombatTargetDescriptor InactivePart(
            CombatTargetId targetId,
            CombatTargetId fallbackId)
        {
            return new CombatTargetDescriptor(
                targetId,
                targetId,
                "Part",
                CombatTargetKind.Weapon,
                DoubleVector3.Zero,
                0.2d,
                isActive: false,
                fallbackTargetId: fallbackId);
        }
    }
}
