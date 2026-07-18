using System;
using System.IO;
using NUnit.Framework;
using UnityEngine;

namespace RuinCrawler.Core.Reaverbots.Tests
{
    public sealed class ReaverbotCatalogTests
    {
        private static readonly string[] ArchetypeIds =
        {
            "aerialBomber", "artillery", "duelist", "packHunter", "pouncer", "pursuer", "rotorHunter",
            "shieldSentinel", "tractorController", "zoneController",
        };

        private static readonly string[] BodyPlanIds =
        {
            "biped", "crawler", "flyer", "hopper", "hoverBell", "lowBiped", "quadruped", "tripod",
        };

        private static readonly string[] WeaponIds =
        {
            "arcEmitter", "beamPrism", "clawArm", "clusterMortar", "crusherJaw", "flameNozzle", "launchLeg",
            "mineDispenser", "mortarPod", "overloadCore", "pounceActuator", "pulseCannon", "rocketLance",
            "rotorBlade", "shockPiston", "tractorMagnet",
        };

        private static readonly string[] ChargeIds = { "spineJet", "twinRocketPack", "vectorRocket" };

        private static readonly string[] DefenseIds =
        {
            "armorShutters", "armoredBack", "armoredCarapace", "armoredSkull", "directionalShield",
            "energyMembrane", "guardArms", "phaseShell", "reactivePlate", "rotatingPlates", "sidePlates",
        };

        private static readonly string[] WeakPointIds =
        {
            "ammoDrum", "bellyCore", "clawPalm", "coolingVents", "counterweightCore", "emitterCore",
            "eyeLens", "legJoint", "overloadCore", "rearBattery", "shieldHinge",
        };

        private static readonly string[] PaletteIds =
        {
            "artilleryViolet", "bomberIvory", "controllerTeal", "duelistBurgundy", "packSand", "pouncerOlive",
            "pursuerOchre", "rotorCopper", "sentinelBlueGray", "tractorLavender",
        };

        [Test]
        public void ExportedContractLoadsEverySchemaThreeCatalogId()
        {
            ReaverbotCatalog catalog = ContractTestLoader.LoadCatalog();

            Assert.That(catalog.SchemaVersion, Is.EqualTo(3));
            Assert.That(catalog.EyeColor, Is.EqualTo(0xff254fu));
            Assert.That(catalog.Archetypes.Keys, Is.EquivalentTo(ArchetypeIds));
            Assert.That(catalog.BodyPlans.Keys, Is.EquivalentTo(BodyPlanIds));
            Assert.That(catalog.Weapons.Keys, Is.EquivalentTo(WeaponIds));
            Assert.That(catalog.ChargeModules.Keys, Is.EquivalentTo(ChargeIds));
            Assert.That(catalog.Defenses.Keys, Is.EquivalentTo(DefenseIds));
            Assert.That(catalog.WeakPoints.Keys, Is.EquivalentTo(WeakPointIds));
            Assert.That(catalog.Palettes.Keys, Is.EquivalentTo(PaletteIds));
            Assert.That(catalog.IntentArchetypeWeights.Count, Is.EqualTo(7));
            Assert.That(catalog.LinkedWeakPointWeights.Count, Is.EqualTo(11));
        }

        [Test]
        public void SalvageRegistryCoversEveryVisibleAuthoritativeModule()
        {
            ReaverbotCatalog catalog = ContractTestLoader.LoadCatalog();
            ReaverbotSalvageCatalog salvage = catalog.Salvage;

            Assert.That(salvage.Aspects.Count, Is.EqualTo(7));
            Assert.That(salvage.Materials.Count, Is.EqualTo(63));
            Assert.That(salvage.SourceMaps.Count, Is.EqualTo(7));
            Assert.That(salvage.BossOnlyMaterialIds, Is.EqualTo(new[] { "perfectedCompressionGreave" }));

            foreach (string id in ArchetypeIds) Assert.That(salvage.TryGetMaterial("behavior", id, out _), Is.True, id);
            foreach (string id in BodyPlanIds) Assert.That(salvage.TryGetMaterial("body", id, out _), Is.True, id);
            foreach (string id in WeaponIds) Assert.That(salvage.TryGetMaterial("weapon", id, out _), Is.True, id);
            foreach (string id in ChargeIds) Assert.That(salvage.TryGetMaterial("charge", id, out _), Is.True, id);
            foreach (string id in DefenseIds) Assert.That(salvage.TryGetMaterial("defense", id, out _), Is.True, id);
            foreach (string id in WeakPointIds) Assert.That(salvage.TryGetMaterial("weakPoint", id, out _), Is.True, id);
            Assert.That(salvage.TryGetMaterial("body", "articulatedCrawler", out _), Is.True);
            Assert.That(salvage.TryGetMaterial("body", "wheelBogies", out _), Is.True);
            Assert.That(salvage.TryGetMaterial("eye", "singleRubyLens", out _), Is.True);
        }

        [Test]
        public void RegistryCopiesDtoDataAndCannotDriftAfterLoad()
        {
            RuinCrawlerContractPackDto pack = ContractTestLoader.LoadPack();
            ReaverbotCatalog catalog = ReaverbotCatalog.Load(pack);
            pack.reaverbots.archetypes[0].label = "mutated";
            pack.reaverbots.weapons[0].tags[0] = "mutated";

            Assert.That(catalog.Archetypes["aerialBomber"].Label, Is.EqualTo("Aerial Bomber"));
            Assert.That(catalog.Weapons["arcEmitter"].Tags, Does.Not.Contain("mutated"));
            Assert.Throws<NotSupportedException>(() =>
                ((System.Collections.Generic.IDictionary<string, ReaverbotWeaponDefinition>)catalog.Weapons)
                    .Add("mutated", catalog.Weapons["arcEmitter"]));
        }

        [Test]
        public void UnknownCatalogReferencesFailWithStructuredErrors()
        {
            RuinCrawlerContractPackDto pack = ContractTestLoader.LoadPack();
            pack.reaverbots.archetypes[0].weapons[0] = "unknownWeapon";

            ReaverbotContractException exception = Assert.Throws<ReaverbotContractException>(
                () => ReaverbotCatalog.Load(pack));

            Assert.That(exception.Errors, Does.Contain("unknown-weapon:aerialBomber:unknownWeapon"));
        }
    }

    internal static class ContractTestLoader
    {
        public static string ContractPath => Path.GetFullPath(Path.Combine(
            Application.dataPath,
            "..",
            "..",
            "..",
            "assets",
            "contracts",
            "ruin-crawler-contracts.v1.json"));

        public static string ReadJson()
        {
            Assert.That(File.Exists(ContractPath), Is.True, ContractPath);
            return File.ReadAllText(ContractPath);
        }

        public static RuinCrawlerContractPackDto LoadPack()
        {
            RuinCrawlerContractPackDto pack = JsonUtility.FromJson<RuinCrawlerContractPackDto>(ReadJson());
            Assert.That(pack, Is.Not.Null);
            Assert.That(pack.contractVersion, Is.EqualTo(1));
            Assert.That(pack.reaverbots, Is.Not.Null);
            Assert.That(pack.salvage, Is.Not.Null);
            return pack;
        }

        public static ReaverbotCatalog LoadCatalog() => ReaverbotCatalog.Load(LoadPack());
    }
}
