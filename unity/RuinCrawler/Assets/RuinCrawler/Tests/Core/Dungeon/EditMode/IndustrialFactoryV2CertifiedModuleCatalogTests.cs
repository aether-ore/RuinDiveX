using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using RuinCrawler.Core.Dungeon.V2;

namespace RuinCrawler.Core.Dungeon.Tests
{
    public sealed class IndustrialFactoryV2CertifiedModuleCatalogTests
    {
        [Test]
        public void CatalogContainsEveryABTemplateFamilyAndAllGeneratorModuleKinds()
        {
            Assert.That(IndustrialFactoryV2ModuleCatalog.Definitions, Has.Count.EqualTo(30));
            Assert.That(
                IndustrialFactoryV2ModuleCatalog.Definitions.Select(value => value.TemplateId).Distinct().Count(),
                Is.EqualTo(30));
            Assert.That(
                IndustrialFactoryV2ModuleCatalog.Definitions.Select(value => value.ContentHash).Distinct().Count(),
                Is.EqualTo(30));

            foreach (DungeonMacroRoleKindV2 role in Enum.GetValues(typeof(DungeonMacroRoleKindV2)))
            {
                IndustrialFactoryV2ModuleDefinition[] factoryTemplates =
                    IndustrialFactoryV2ModuleCatalog.Definitions
                        .Where(value => value.DistrictKind == DungeonBiomeDistrictKindV2.Factory
                            && value.CompatibleMacroRoles.Contains(role)
                            && value.TemplateId.StartsWith("factory-", StringComparison.Ordinal)
                            && !value.TemplateId.StartsWith("factory-pocket", StringComparison.Ordinal))
                        .ToArray();
                Assert.That(factoryTemplates, Has.Length.EqualTo(2), role.ToString());
                Assert.That(factoryTemplates.Select(value => value.VariantId),
                    Is.EquivalentTo(new[]
                    {
                        IndustrialFactoryV2ModuleCatalog.VariantA,
                        IndustrialFactoryV2ModuleCatalog.VariantB
                    }));
            }

            Assert.That(
                IndustrialFactoryV2ModuleCatalog.Definitions.Count(value =>
                    value.DistrictKind == DungeonBiomeDistrictKindV2.Waterworks),
                Is.EqualTo(6));
            Assert.That(
                IndustrialFactoryV2ModuleCatalog.Definitions.Count(value =>
                    value.DistrictKind == DungeonBiomeDistrictKindV2.MagmaUndercroft),
                Is.EqualTo(4));
            Assert.That(
                IndustrialFactoryV2ModuleCatalog.Definitions.Count(value =>
                    value.DistrictKind == DungeonBiomeDistrictKindV2.ElectricalUndercroft),
                Is.EqualTo(4));
        }

        [Test]
        public void GeneratorUsesCertifiedCatalogHashesWithoutPlaceholderContent()
        {
            var generator = new IndustrialFactoryV2Generator();
            var seenTemplates = new HashSet<string>(StringComparer.Ordinal);
            for (int index = 0; index < 128; index += 1)
            {
                DungeonPlanV2 plan = generator.Generate("certified-module-catalog-" + index);
                Assert.That(plan.ContentPackVersion,
                    Is.EqualTo(IndustrialFactoryV2Ruleset.ContentPackVersion));
                Assert.That(plan.ContractVersion, Is.EqualTo(IndustrialFactoryV2Ruleset.ContractVersion));
                foreach (DungeonModuleInstancePlanV2 module in plan.Modules)
                {
                    IndustrialFactoryV2ModuleDefinition definition =
                        IndustrialFactoryV2ModuleCatalog.Require(module.TemplateId);
                    Assert.That(module.ContentHash, Is.EqualTo(definition.ContentHash), module.TemplateId);
                    Assert.That(module.ContentHash, Does.StartWith("sha256:"));
                    Assert.That(module.ContentHash, Does.Not.StartWith("content-v1-"));
                    seenTemplates.Add(module.TemplateId);
                }
            }

            Assert.That(
                seenTemplates,
                Is.EquivalentTo(IndustrialFactoryV2ModuleCatalog.Definitions.Select(value => value.TemplateId)));
        }

        [Test]
        public void EveryCatalogGeometryMatchesItsTemplateAndUsesCanonicalLocalRegion()
        {
            foreach (IndustrialFactoryV2ModuleDefinition definition in IndustrialFactoryV2ModuleCatalog.Definitions)
            {
                CertifiedDungeonModuleGeometryV2 geometry = definition.CertifiedGeometry;
                Assert.That(geometry.TemplateId, Is.EqualTo(definition.TemplateId));
                Assert.That(geometry.ContentHash, Is.EqualTo(definition.ContentHash));
                Assert.That(geometry.Regions, Has.Count.EqualTo(1));
                Assert.That(geometry.Regions.Single().Id, Is.EqualTo(IndustrialFactoryV2ModuleCatalog.LocalRegionId));
                Assert.That(geometry.Surfaces, Is.Not.Empty);
                Assert.That(geometry.Anchors.Select(value => value.Id),
                    Is.EquivalentTo(new[] { "entry", "exit", "safe" }));
                Assert.That(geometry.Connectors.Select(value => value.Id),
                    Is.EquivalentTo(new[] { "west", "east" }));
            }
        }
    }
}
