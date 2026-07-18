using System;
using System.Collections.Generic;
using NUnit.Framework;

namespace RuinCrawler.Core.Foundation.Tests
{
    public sealed class DamageHealthTests
    {
        [TestCase(8d, 0d, 0d, 8d)]
        [TestCase(8d, 100d, 0d, 4d)]
        [TestCase(8d, 50d, 20d, 6.153846153846154d)]
        public void ArmorFormulaMatchesSource(
            double damage,
            double armor,
            double armorPierce,
            double expected)
        {
            Assert.That(DamageMath.ApplyArmor(damage, armor, armorPierce), Is.EqualTo(expected).Within(1e-12));
        }

        [Test]
        public void PositiveInfiniteArmorPierceBypassesArmor()
        {
            Assert.That(DamageMath.ApplyArmor(8d, 999d, double.PositiveInfinity), Is.EqualTo(8d));
        }

        [Test]
        public void MegaBusterReducesSharukurusuFromSixtyEightToSixty()
        {
            var health = new HealthState(68d);
            DamagePacket packet = CreatePacket(8d, "mega-shot-1");

            DamageResult result = health.ApplyDamage(packet);

            Assert.That(result.MitigatedDamage, Is.EqualTo(8d));
            Assert.That(result.HealthDamage, Is.EqualTo(8d));
            Assert.That(result.HealthBefore, Is.EqualTo(68d));
            Assert.That(result.HealthAfter, Is.EqualTo(60d));
            Assert.That(health.Current, Is.EqualTo(60d));
            Assert.That(result.TargetDied, Is.False);
        }

        [Test]
        public void DamageEventsAreOrderedAndDeathIsIdempotent()
        {
            var health = new HealthState(8d);
            var eventOrder = new List<string>();
            health.Damaged += _ => eventOrder.Add("damaged");
            health.Changed += _ => eventOrder.Add("changed");
            health.Died += _ => eventOrder.Add("died");

            DamageResult lethal = health.ApplyDamage(CreatePacket(20d, "lethal"));
            DamageResult repeated = health.ApplyDamage(CreatePacket(20d, "repeat"));

            Assert.That(lethal.MitigatedDamage, Is.EqualTo(20d));
            Assert.That(lethal.HealthDamage, Is.EqualTo(8d));
            Assert.That(lethal.TargetDied, Is.True);
            Assert.That(repeated.WasAlreadyDead, Is.True);
            Assert.That(repeated.HealthDamage, Is.Zero);
            Assert.That(eventOrder, Is.EqualTo(new[] { "damaged", "changed", "died" }));
        }

        [Test]
        public void ReplayedExecutionIdCannotApplyDamageTwice()
        {
            var health = new HealthState(20d);
            DamagePacket packet = CreatePacket(3d, "hazard:controller:occupancy:revision:4");

            DamageResult first = health.ApplyDamage(packet);
            DamageResult duplicate = health.ApplyDamage(packet);

            Assert.That(first.Disposition, Is.EqualTo(DamageApplicationDisposition.Applied));
            Assert.That(duplicate.Disposition, Is.EqualTo(DamageApplicationDisposition.Duplicate));
            Assert.That(duplicate.WasDuplicate, Is.True);
            Assert.That(health.Current, Is.EqualTo(17d));
        }

        [Test]
        public void TypedMitigationConsumesExecutionWithoutChangingHealth()
        {
            var health = new HealthState(20d);
            DamagePacket packet = CreatePacket(3d, "magma:pulse:1");

            DamageResult immune = health.ApplyDamage(
                packet,
                mitigation: DamageMitigationDecision.Immune("gear:heatResistChip"));
            DamageResult replay = health.ApplyDamage(packet);

            Assert.That(immune.WasImmune, Is.True);
            Assert.That(immune.MitigationReasonId, Is.EqualTo("gear:heatResistChip"));
            Assert.That(replay.WasDuplicate, Is.True);
            Assert.That(health.Current, Is.EqualTo(20d));
        }

        [Test]
        public void HealingCapsAtMaximumAndCannotImplicitlyRevive()
        {
            var health = new HealthState(160d, 120d);
            int healEvents = 0;
            health.Healed += _ => healEvents += 1;

            HealthHealResult result = health.Heal(100d);
            Assert.That(result.AppliedAmount, Is.EqualTo(40d));
            Assert.That(health.Current, Is.EqualTo(160d));
            Assert.That(healEvents, Is.EqualTo(1));

            health.Reset(0d);
            HealthHealResult deadHeal = health.Heal(20d);
            Assert.That(deadHeal.AppliedAmount, Is.Zero);
            Assert.That(health.IsDead, Is.True);
            Assert.That(healEvents, Is.EqualTo(1));
        }

        [Test]
        public void DamagePacketRetainsRuntimeMetadata()
        {
            var packet = new DamagePacket(
                12.5d,
                "execution:42",
                sourceId: "build-a",
                buildRevision: 7,
                hitPartId: "clawPalm",
                armorPierce: 16d,
                stagger: 2.25d,
                isCritical: true,
                element: DamageElement.Shock,
                knockback: new DoubleVector3(1d, 0.5d, -2d),
                suppressRewards: true,
                damageDomain: "environment",
                hazardTags: new[] { "fireFloor", "environmentalHeat", "fireFloor" },
                reactionEnvelopeId: "player-power-knockback-v1");

            Assert.That(packet.SourceId, Is.EqualTo("build-a"));
            Assert.That(packet.BuildRevision, Is.EqualTo(7));
            Assert.That(packet.HitPartId, Is.EqualTo("clawPalm"));
            Assert.That(packet.ArmorPierce, Is.EqualTo(16d));
            Assert.That(packet.Stagger, Is.EqualTo(2.25d));
            Assert.That(packet.IsCritical, Is.True);
            Assert.That(packet.Element, Is.EqualTo(DamageElement.Shock));
            Assert.That(packet.Knockback, Is.EqualTo(new DoubleVector3(1d, 0.5d, -2d)));
            Assert.That(packet.SuppressRewards, Is.True);
            Assert.That(packet.DamageDomain, Is.EqualTo("environment"));
            Assert.That(packet.HazardTags, Is.EqualTo(new[] { "environmentalHeat", "fireFloor" }));
            Assert.That(packet.ReactionEnvelopeId, Is.EqualTo("player-power-knockback-v1"));
        }

        [Test]
        public void InvalidCombatNumbersFailVisibly()
        {
            Assert.Throws<ArgumentOutOfRangeException>(() => DamageMath.ApplyArmor(8d, -1d));
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                new DamagePacket(-1d, "bad"));
            Assert.Throws<ArgumentException>(() =>
                new DamagePacket(1d, " "));
        }

        private static DamagePacket CreatePacket(double amount, string executionId)
        {
            return new DamagePacket(amount, executionId, sourceId: "megaBuster", buildRevision: 1);
        }
    }
}
