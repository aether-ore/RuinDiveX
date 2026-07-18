using System;
using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using RuinCrawler.Core.Reaverbots;
using UnityEngine;

namespace RuinCrawler.Runtime.Reaverbots.Tests
{
    public sealed class ReaverbotRuntimeAdapterEditModeTests
    {
        private static readonly IReadOnlyDictionary<string, string> ArchetypeForBody =
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["biped"] = "duelist",
                ["crawler"] = "artillery",
                ["flyer"] = "aerialBomber",
                ["hopper"] = "pouncer",
                ["hoverBell"] = "aerialBomber",
                ["lowBiped"] = "duelist",
                ["quadruped"] = "packHunter",
                ["tripod"] = "artillery",
            };

        [Test]
        public void RuntimeLoaderProjectsTheCanonicalVersionOneContract()
        {
            ReaverbotCatalog catalog = ReaverbotContractLoader.LoadJson(ReadContractJson());

            Assert.That(catalog.SchemaVersion, Is.EqualTo(3));
            Assert.That(catalog.Archetypes.Count, Is.EqualTo(10));
            Assert.That(catalog.BodyPlans.Count, Is.EqualTo(8));
            Assert.That(catalog.Weapons.Count, Is.EqualTo(16));
            Assert.That(catalog.Salvage.Materials.Count, Is.EqualTo(63));
        }

        [Test]
        public void EncounterRequestDerivesStableSlotAndSpawnIdentity()
        {
            var first = new ReaverbotSpawnRequest
            {
                runSeed = "runtime-run",
                encounterId = "room-04",
                slotIndex = 2,
                threatTier = 3,
            };
            var repeated = new ReaverbotSpawnRequest
            {
                runSeed = first.runSeed,
                encounterId = first.encounterId,
                slotIndex = first.slotIndex,
                threatTier = first.threatTier,
            };

            Assert.That(repeated.EncounterSlotSeed, Is.EqualTo(first.EncounterSlotSeed));
            Assert.That(repeated.StableSpawnId, Is.EqualTo(first.StableSpawnId));
            Assert.That(repeated.CreateGenerationOptions().Seed,
                Is.EqualTo(first.CreateGenerationOptions().Seed));
            repeated.slotIndex += 1;
            Assert.That(repeated.StableSpawnId, Is.Not.EqualTo(first.StableSpawnId));
        }

        [Test]
        public void PrimitiveFactoryBuildsEveryBodyPlanWithSemanticModuleAnchors()
        {
            ReaverbotCatalog catalog = ReaverbotContractLoader.LoadJson(ReadContractJson());
            var generator = new ReaverbotGenerator(catalog);
            using var materials = new ReaverbotMaterialLibrary();

            foreach (KeyValuePair<string, string> pair in ArchetypeForBody)
            {
                ReaverbotGenome genome = generator.Generate(new ReaverbotGenerationOptions
                {
                    Seed = "visual-body:" + pair.Key,
                    ThreatTier = 4,
                    Intent = "any",
                    EncounterSize = 4,
                    ArchetypeId = pair.Value,
                    BodyPlanId = pair.Key,
                });
                var root = new GameObject("VisualTest_" + pair.Key);
                try
                {
                    ReaverbotVisualRig rig = ReaverbotVisualFactory.Build(root.transform, genome, materials);
                    Assert.That(rig.BodyAim, Is.Not.Null, pair.Key);
                    Assert.That(rig.Muzzle, Is.Not.Null, pair.Key);
                    Assert.That(rig.WeakPoint, Is.Not.Null, pair.Key);
                    Assert.That(rig.WeakPoint.name, Does.Contain(genome.Modules.WeakPoint.Id), pair.Key);

                    ReaverbotSemanticPart[] parts = root.GetComponentsInChildren<ReaverbotSemanticPart>(true);
                    Assert.That(parts, Has.Some.Matches<ReaverbotSemanticPart>(part =>
                        part.Aspect == "weapon" && part.ModuleId == genome.Modules.Weapon.Id), pair.Key);
                    Assert.That(parts, Has.Some.Matches<ReaverbotSemanticPart>(part =>
                        part.Aspect == "weakPoint" && part.ModuleId == genome.Modules.WeakPoint.Id), pair.Key);
                    string mobilityId = genome.Body.MobilitySalvageId ?? genome.Body.PlanId;
                    Assert.That(parts, Has.Some.Matches<ReaverbotSemanticPart>(part =>
                        part.Aspect == "body" && part.ModuleId == mobilityId), pair.Key);
                }
                finally
                {
                    UnityEngine.Object.DestroyImmediate(root);
                }
            }

            Assert.That(materials.MaterialCount, Is.LessThanOrEqualTo(catalog.Palettes.Count * 9));
        }

        [Test]
        public void FixedSharukurusuStyleRequestProducesTheAuthoredModuleRole()
        {
            ReaverbotCatalog catalog = ReaverbotContractLoader.LoadJson(ReadContractJson());
            ReaverbotGenome genome = new ReaverbotGenerator(catalog).Generate(
                ReaverbotSpawnRequest.SharukurusuStyle().CreateGenerationOptions());

            Assert.That(genome.ArchetypeId, Is.EqualTo("duelist"));
            Assert.That(genome.Body.PlanId, Is.EqualTo("lowBiped"));
            Assert.That(genome.Modules.Weapon.Id, Is.EqualTo("clawArm"));
            Assert.That(genome.Modules.Defense, Is.Null);
            Assert.That(genome.Modules.WeakPoint.Id, Is.EqualTo("clawPalm"));
        }

        internal static string ReadContractJson()
        {
            string path = Path.GetFullPath(Path.Combine(
                Application.dataPath,
                "..",
                "..",
                "..",
                "assets",
                "contracts",
                "ruin-crawler-contracts.v1.json"));
            Assert.That(File.Exists(path), Is.True, path);
            return File.ReadAllText(path);
        }
    }
}
