using NUnit.Framework;
using RuinCrawler.Runtime.Contracts;
using UnityEditor;
using UnityEngine;

namespace RuinCrawler.Runtime.Persistence.Tests
{
    public sealed class UnityContractCatalogTests
    {
        [Test]
        public void ExportedContractPack_LoadsAllWorkshopAndBossCatalogs()
        {
            TextAsset asset = AssetDatabase.LoadAssetAtPath<TextAsset>(
                "Packages/com.ruincrawler.source-assets/contracts/ruin-crawler-contracts.v1.json");
            Assert.That(asset, Is.Not.Null, "The shared versioned contract pack must be imported by Unity.");

            UnityContractCatalog catalog = UnityContractCatalog.Parse(asset.text);
            Assert.That(catalog.ContractVersion, Is.EqualTo(1));
            Assert.That(catalog.Materials.Count, Is.EqualTo(63));
            Assert.That(catalog.Recipes.Count, Is.EqualTo(19));
            Assert.That(catalog.BossProfiles.Count, Is.EqualTo(9));
            Assert.That(catalog.GearEffects.Count, Is.EqualTo(9));
            Assert.That(catalog.Recipes.ContainsKey("machineGunArm"), Is.True);
            Assert.That(catalog.Recipes.ContainsKey("pulse"), Is.True);
            Assert.That(catalog.Materials.ContainsKey("rubyOpticLens"), Is.True);
            Assert.That(catalog.GearEffects["heatResistChip"].EffectId, Is.EqualTo("hazardImmunity"));
            Assert.That(catalog.GearEffects["heatResistChip"].HazardDomain, Is.EqualTo("environment"));
            Assert.That(catalog.GearEffects["heatResistChip"].HazardTags,
                Does.Contain("fireFloor"));
        }
    }
}
