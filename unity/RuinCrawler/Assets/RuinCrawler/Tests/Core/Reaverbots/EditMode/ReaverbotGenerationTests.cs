using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace RuinCrawler.Core.Reaverbots.Tests
{
    public sealed class ReaverbotGenerationTests
    {
        private ReaverbotCatalog _catalog;
        private ReaverbotGenerator _generator;

        [SetUp]
        public void SetUp()
        {
            _catalog = ContractTestLoader.LoadCatalog();
            _generator = new ReaverbotGenerator(_catalog);
        }

        [Test]
        public void EncounterSlotSeedMatchesExportedParityFixture()
        {
            ReaverbotFixtureRoot fixtures = LoadFixtures();
            EncounterSlotSeedFixture fixture = fixtures.fixtures.reaverbots.encounterSlotSeeds.Single();

            Assert.That(
                ReaverbotDeterminism.CreateEncounterSlotSeed(
                    fixture.runSeed,
                    fixture.encounterId,
                    fixture.slotIndex),
                Is.EqualTo(fixture.result));
            Assert.That(fixture.result, Is.EqualTo(3025403634u));
        }

        [Test]
        public void CoreSeededRandomMatchesJavaScriptKernel()
        {
            Assert.That(ReaverbotDeterminism.HashSeed("reaverbot"), Is.EqualTo(2848495183u));
            Assert.That(ReaverbotDeterminism.HashSeed("unity-port-smoke"), Is.EqualTo(655745335u));

            var random = new ReaverbotSeededRandom("unity-port-smoke");
            double[] expected =
            {
                0.15289762802422047d,
                0.4341005354654044d,
                0.5611107049044222d,
                0.6637288010679185d,
                0.9760620282031596d,
            };

            foreach (double value in expected)
            {
                Assert.That(random.NextDouble(), Is.EqualTo(value).Within(1e-12));
            }
        }

        [Test]
        public void ExportedGenomeFixturesMatchEightCandidateGeneratorAndSalvage()
        {
            Assert.That(ReaverbotGenerator.CandidateCount, Is.EqualTo(8));
            ReaverbotFixtureRoot fixtures = LoadFixtures();
            foreach (ReaverbotGenomeFixture fixture in fixtures.fixtures.reaverbots.genomes)
            {
                ReaverbotGenome actual = _generator.Generate(ToOptions(fixture.options));
                ExpectedGenome expected = fixture.genome;

                Assert.That(actual.SchemaVersion, Is.EqualTo(expected.schemaVersion), fixture.id);
                Assert.That(actual.Seed, Is.EqualTo(expected.seed), fixture.id);
                Assert.That(actual.SeedLabel, Is.EqualTo(expected.seedLabel), fixture.id);
                Assert.That(actual.CandidateIndex, Is.EqualTo(expected.candidateIndex), fixture.id);
                Assert.That(actual.Name, Is.EqualTo(expected.name), fixture.id);
                Assert.That(actual.ThreatTier, Is.EqualTo(expected.threatTier), fixture.id);
                Assert.That(actual.ArchetypeId, Is.EqualTo(expected.archetypeId), fixture.id);
                Assert.That(actual.Body.PlanId, Is.EqualTo(expected.body.planId), fixture.id);
                Assert.That(actual.Body.MobilityId, Is.EqualTo(expected.body.mobilityId), fixture.id);
                Assert.That(actual.Modules.Weapon.Id, Is.EqualTo(expected.modules.weapon.id), fixture.id);
                Assert.That(actual.Modules.Weapon.AttackKind, Is.EqualTo(expected.modules.weapon.attackKind), fixture.id);
                Assert.That(actual.Modules.Charge?.Id, Is.EqualTo(expected.modules.charge?.id), fixture.id);
                Assert.That(actual.Modules.Defense?.Id, Is.EqualTo(expected.modules.defense?.id), fixture.id);
                Assert.That(actual.Modules.WeakPoint.Id, Is.EqualTo(expected.modules.weakPoint.id), fixture.id);
                Assert.That(actual.Behavior.Aggression, Is.EqualTo(expected.behavior.aggression).Within(1e-12), fixture.id);
                Assert.That(actual.Behavior.ExposureDuration, Is.EqualTo(expected.behavior.exposureDuration).Within(1e-12), fixture.id);
                Assert.That(actual.Stats.MaxHealth, Is.EqualTo(expected.stats.maxHealth).Within(1e-12), fixture.id);
                Assert.That(actual.Stats.Damage, Is.EqualTo(expected.stats.damage).Within(1e-12), fixture.id);
                Assert.That(actual.Stats.MoveSpeed, Is.EqualTo(expected.stats.moveSpeed).Within(1e-12), fixture.id);
                Assert.That(actual.Stats.AttackCooldown, Is.EqualTo(expected.stats.attackCooldown).Within(1e-12), fixture.id);
                Assert.That(actual.Stats.Radius, Is.EqualTo(expected.stats.radius).Within(1e-12), fixture.id);
                Assert.That(actual.Stats.CollisionHeight, Is.EqualTo(expected.stats.collisionHeight).Within(1e-12), fixture.id);

                IReadOnlyList<ReaverbotSalvageCandidate> profile = ReaverbotSalvageProfile.Create(actual, _catalog.Salvage);
                Assert.That(profile.Select(candidate => candidate.Aspect),
                    Is.EqualTo(fixture.salvageProfile.Select(candidate => candidate.aspect)), fixture.id);
                Assert.That(profile.Select(candidate => candidate.ModuleId),
                    Is.EqualTo(fixture.salvageProfile.Select(candidate => candidate.moduleId)), fixture.id);
                Assert.That(profile.Select(candidate => candidate.MaterialId),
                    Is.EqualTo(fixture.salvageProfile.Select(candidate => candidate.materialId)), fixture.id);
            }
        }

        [Test]
        public void SameSeedAndContextProduceSameStableGenomeIdentity()
        {
            var options = new ReaverbotGenerationOptions
            {
                Seed = "nest:slot:2",
                ThreatTier = 3,
                Intent = "fast",
                EncounterSize = 4,
                RoomArchetypeId = "mechanicalNest",
                BehaviorModifiers = new[] { "aggressive pack" },
            };

            ReaverbotGenome first = _generator.Generate(options);
            ReaverbotGenome repeated = _generator.Generate(options);

            Assert.That(repeated.GenomeId, Is.EqualTo(first.GenomeId));
            Assert.That(repeated.CandidateIndex, Is.EqualTo(first.CandidateIndex));
            Assert.That(repeated.Name, Is.EqualTo(first.Name));
            Assert.That(repeated.ArchetypeId, Is.EqualTo(first.ArchetypeId));
            Assert.That(repeated.Body.PlanId, Is.EqualTo(first.Body.PlanId));
            Assert.That(repeated.Modules.Weapon.Id, Is.EqualTo(first.Modules.Weapon.Id));
            Assert.That(repeated.Modules.Defense?.Id, Is.EqualTo(first.Modules.Defense?.Id));
            Assert.That(repeated.Modules.WeakPoint.Id, Is.EqualTo(first.Modules.WeakPoint.Id));

            ReaverbotGenome contextualVariant = _generator.Generate(new ReaverbotGenerationOptions
            {
                Seed = options.Seed,
                ThreatTier = options.ThreatTier,
                Intent = options.Intent,
                EncounterSize = options.EncounterSize,
                ArchetypeId = "artillery",
            });
            Assert.That(contextualVariant.GenomeId, Is.Not.EqualTo(first.GenomeId));
        }

        [Test]
        public void BroadSeedSweepAlwaysProducesValidSchemaThreeGenomes()
        {
            var archetypes = new HashSet<string>(StringComparer.Ordinal);
            var bodyPlans = new HashSet<string>(StringComparer.Ordinal);
            var weapons = new HashSet<string>(StringComparer.Ordinal);
            var defenses = new HashSet<string>(StringComparer.Ordinal);
            var weakPoints = new HashSet<string>(StringComparer.Ordinal);

            for (int seed = 0; seed < 1000; seed += 1)
            {
                ReaverbotGenome genome = _generator.Generate(new ReaverbotGenerationOptions
                {
                    Seed = seed.ToString(CultureInfo.InvariantCulture),
                    ThreatTier = 1 + (seed % 5),
                    Intent = "any",
                    EncounterSize = 4,
                });
                ReaverbotValidationResult validation = _generator.Validate(genome);
                Assert.That(validation.IsValid, Is.True, "seed " + seed + ": " + string.Join(", ", validation.Errors));
                Assert.That(genome.SchemaVersion, Is.EqualTo(3));
                Assert.That(genome.Modules.Eye.Color, Is.EqualTo(_catalog.EyeColor));
                Assert.That(genome.Threat.Spent, Is.LessThanOrEqualTo(genome.Threat.Budget));
                Assert.That(genome.Behavior.ExposureDuration, Is.GreaterThanOrEqualTo(0.6d));

                if (genome.Modules.Weapon.Id == "clawArm")
                {
                    Assert.That(genome.Modules.Defense, Is.Null);
                    Assert.That(genome.Modules.WeakPoint.Id, Is.EqualTo("clawPalm"));
                }
                else
                {
                    Assert.That(genome.Modules.Defense, Is.Not.Null);
                    Assert.That(
                        _catalog.LinkedWeakPointWeights[genome.Modules.Defense.Id]
                            .Any(weight => weight.Id == genome.Modules.WeakPoint.Id),
                        Is.True,
                        "seed " + seed);
                    defenses.Add(genome.Modules.Defense.Id);
                }

                if (genome.Body.PlanId == "quadruped" && genome.Modules.Weapon.Id != "clawArm")
                {
                    Assert.That(genome.Modules.Defense.Id, Is.EqualTo("armorShutters"));
                    Assert.That(genome.Modules.WeakPoint.Id, Is.EqualTo("eyeLens"));
                }

                archetypes.Add(genome.ArchetypeId);
                bodyPlans.Add(genome.Body.PlanId);
                weapons.Add(genome.Modules.Weapon.Id);
                weakPoints.Add(genome.Modules.WeakPoint.Id);
            }

            Assert.That(archetypes.OrderBy(id => id), Is.EqualTo(_catalog.Archetypes.Keys.OrderBy(id => id)));
            Assert.That(bodyPlans.OrderBy(id => id), Is.EqualTo(_catalog.BodyPlans.Keys.OrderBy(id => id)));
            Assert.That(weapons.Count, Is.GreaterThanOrEqualTo(10));
            Assert.That(defenses.Count, Is.GreaterThanOrEqualTo(9));
            Assert.That(weakPoints.Count, Is.GreaterThanOrEqualTo(8));
        }

        [Test]
        public void BodyRequirementsRejectIncompatibleModules()
        {
            Assert.That(
                _generator.HasBodyRequirements(_catalog.Weapons["flameNozzle"], _catalog.BodyPlans["flyer"]),
                Is.False);
            Assert.That(
                _generator.HasBodyRequirements(_catalog.Weapons["flameNozzle"], _catalog.BodyPlans["tripod"]),
                Is.True);
            Assert.That(
                _generator.HasBodyRequirements(_catalog.Weapons["crusherJaw"], _catalog.BodyPlans["lowBiped"]),
                Is.False);
            Assert.That(
                _generator.HasBodyRequirements(_catalog.Weapons["crusherJaw"], _catalog.BodyPlans["quadruped"]),
                Is.True);
            Assert.That(
                _generator.HasBodyRequirements(_catalog.Defenses["phaseShell"], _catalog.BodyPlans["biped"]),
                Is.False);
        }

        private static ReaverbotGenerationOptions ToOptions(FixtureGenerationOptions source)
        {
            return new ReaverbotGenerationOptions
            {
                Seed = source.seed,
                ThreatTier = source.threatTier,
                Intent = source.intent,
                EncounterSize = source.encounterSize == 0 ? 1 : source.encounterSize,
                RoomArchetypeId = source.roomArchetypeId,
                BehaviorModifiers = source.behaviorModifiers ?? Array.Empty<string>(),
            };
        }

        private static ReaverbotFixtureRoot LoadFixtures()
        {
            ReaverbotFixtureRoot fixtures = JsonUtility.FromJson<ReaverbotFixtureRoot>(ContractTestLoader.ReadJson());
            Assert.That(fixtures?.fixtures?.reaverbots, Is.Not.Null);
            return fixtures;
        }

        [Serializable]
        private sealed class ReaverbotFixtureRoot { public FixtureRoot fixtures; }
        [Serializable]
        private sealed class FixtureRoot { public FixtureReaverbots reaverbots; }
        [Serializable]
        private sealed class FixtureReaverbots
        {
            public EncounterSlotSeedFixture[] encounterSlotSeeds;
            public ReaverbotGenomeFixture[] genomes;
        }
        [Serializable]
        private sealed class EncounterSlotSeedFixture
        {
            public string runSeed;
            public string encounterId;
            public int slotIndex;
            public uint result;
        }
        [Serializable]
        private sealed class ReaverbotGenomeFixture
        {
            public string id;
            public FixtureGenerationOptions options;
            public ExpectedGenome genome;
            public ExpectedSalvageCandidate[] salvageProfile;
        }
        [Serializable]
        private sealed class FixtureGenerationOptions
        {
            public string seed;
            public int threatTier;
            public string intent;
            public int encounterSize;
            public string roomArchetypeId;
            public string[] behaviorModifiers;
        }
        [Serializable]
        private sealed class ExpectedGenome
        {
            public int schemaVersion;
            public uint seed;
            public string seedLabel;
            public int candidateIndex;
            public string name;
            public int threatTier;
            public string archetypeId;
            public ExpectedBody body;
            public ExpectedModules modules;
            public ExpectedBehavior behavior;
            public ExpectedStats stats;
        }
        [Serializable]
        private sealed class ExpectedBody
        {
            public string planId;
            public string mobilityId;
        }
        [Serializable]
        private sealed class ExpectedModules
        {
            public ExpectedModule weapon;
            public ExpectedModule charge;
            public ExpectedModule defense;
            public ExpectedModule weakPoint;
        }
        [Serializable]
        private sealed class ExpectedModule
        {
            public string id;
            public string attackKind;
        }
        [Serializable]
        private sealed class ExpectedBehavior
        {
            public double aggression;
            public double exposureDuration;
        }
        [Serializable]
        private sealed class ExpectedStats
        {
            public double maxHealth;
            public double damage;
            public double moveSpeed;
            public double attackCooldown;
            public double radius;
            public double collisionHeight;
        }
        [Serializable]
        private sealed class ExpectedSalvageCandidate
        {
            public string aspect;
            public string moduleId;
            public string materialId;
        }
    }
}
