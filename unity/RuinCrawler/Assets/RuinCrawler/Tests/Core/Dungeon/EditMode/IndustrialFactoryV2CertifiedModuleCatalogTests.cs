using System;
using System.Linq;
using NUnit.Framework;
using RuinCrawler.Core.Dungeon.V2;

namespace RuinCrawler.Core.Dungeon.Tests
{
    public sealed class IndustrialFactoryV2CertifiedModuleCatalogTests
    {
        [Test]
        public void CatalogContainsTwelveAuthoredFamiliesWithTwoTopologyVariants()
        {
            Assert.That(IndustrialFactoryV2ModuleCatalog.Definitions, Has.Count.EqualTo(24));
            var families = IndustrialFactoryV2ModuleCatalog.Definitions
                .GroupBy(value => value.Composition.Archetype)
                .ToArray();
            Assert.That(families, Has.Length.EqualTo(12));
            foreach (var family in families)
            {
                Assert.That(family.Select(value => value.VariantId), Is.EquivalentTo(new[]
                {
                    IndustrialFactoryV2ModuleCatalog.VariantA,
                    IndustrialFactoryV2ModuleCatalog.VariantB
                }), family.Key.ToString());
                Assert.That(family.Select(value => value.TopologySignature).Distinct().Count(),
                    Is.EqualTo(2), family.Key.ToString());
            }
        }

        [Test]
        public void ProductionCatalogCanBeInjectedFromBakedDefinitions()
        {
            var injected = new DungeonAuthoredModuleCatalogV2(
                IndustrialFactoryV2ModuleCatalog.Definitions);
            Assert.That(injected.Definitions, Has.Count.EqualTo(24));
            foreach (IndustrialFactoryV2ModuleDefinition definition in injected.Definitions)
            {
                Assert.That(injected.Require(definition.TemplateId), Is.SameAs(definition));
                Assert.That(definition.GeometryRevisionHash,
                    Is.EqualTo(definition.CertifiedGeometry.ContentHash));
                Assert.That(definition.PresentationDependencyHash, Does.StartWith("sha256:"));
                Assert.That(definition.CombinedRevisionHash, Does.StartWith("sha256:"));
                Assert.That(definition.CombinedRevisionHash,
                    Is.Not.EqualTo(definition.GeometryRevisionHash));
            }
        }

        [Test]
        public void EveryFixtureGeometryIsMultiRegionSealedAndUsesExactPortalPayloads()
        {
            foreach (IndustrialFactoryV2ModuleDefinition definition in IndustrialFactoryV2ModuleCatalog.Definitions)
            {
                CertifiedDungeonModuleGeometryV2 geometry = definition.CertifiedGeometry;
                Assert.That(geometry.TemplateId, Is.EqualTo(definition.TemplateId));
                Assert.That(geometry.SchemaVersion, Is.EqualTo(2));
                Assert.That(geometry.Regions.Count, Is.GreaterThanOrEqualTo(2));
                Assert.That(geometry.Surfaces.Select(value => value.Id), Does.Contain("ceiling"));
                Assert.That(geometry.Surfaces.Any(value => value.Id.StartsWith("west-wall", StringComparison.Ordinal)), Is.True);
                Assert.That(geometry.Surfaces.Any(value => value.Id.StartsWith("south-wall", StringComparison.Ordinal)), Is.True);
                bool hasLowerRegion = geometry.Regions.Any(value => value.Id == "lower");
                Assert.That(geometry.Connectors.Select(value => value.Id),
                    Is.EquivalentTo(hasLowerRegion
                        ? new[] { "west", "east", "north", "lower-west", "lower-east", "lower-north" }
                        : new[] { "west", "east", "north" }),
                    definition.TemplateId);
                Assert.That(geometry.Connectors.All(value =>
                    value.Aperture != null
                    && value.Aperture.PlayerClearanceVolume != null
                    && value.Aperture.CameraClearanceVolume != null
                    && value.Aperture.ApproachVolume != null
                    && value.Aperture.NavigationHandoffProfileId != null
                    && value.Aperture.ExteriorGasketProfileId != null
                    && value.Aperture.ThemedCapProfileId != null), Is.True, definition.TemplateId);
            }
        }
    }
}
