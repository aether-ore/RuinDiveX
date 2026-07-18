using System;
using System.Collections.Generic;
using System.Linq;

namespace RuinCrawler.Core.Dungeon.V2
{
    public sealed class IndustrialFactoryV2ModuleDefinition
    {
        public IndustrialFactoryV2ModuleDefinition(
            string templateId,
            string variantId,
            DungeonBiomeDistrictKindV2 districtKind,
            IEnumerable<DungeonMacroRoleKindV2> compatibleMacroRoles,
            CertifiedDungeonModuleGeometryV2 certifiedGeometry)
        {
            TemplateId = DungeonV2Contract.RequireId(templateId, nameof(templateId));
            VariantId = DungeonV2Contract.RequireId(variantId, nameof(variantId));
            DistrictKind = districtKind;
            CompatibleMacroRoles = Array.AsReadOnly((compatibleMacroRoles
                ?? throw new ArgumentNullException(nameof(compatibleMacroRoles)))
                .Distinct()
                .OrderBy(value => (int)value)
                .ToArray());
            if (CompatibleMacroRoles.Count == 0)
            {
                throw new ArgumentException("At least one compatible macro role is required.", nameof(compatibleMacroRoles));
            }

            CertifiedGeometry = certifiedGeometry ?? throw new ArgumentNullException(nameof(certifiedGeometry));
            if (!string.Equals(TemplateId, CertifiedGeometry.TemplateId, StringComparison.Ordinal))
            {
                throw new ArgumentException("Certified geometry template ID does not match the catalog entry.", nameof(certifiedGeometry));
            }
        }

        public string TemplateId { get; }
        public string VariantId { get; }
        public DungeonBiomeDistrictKindV2 DistrictKind { get; }
        public IReadOnlyList<DungeonMacroRoleKindV2> CompatibleMacroRoles { get; }
        public CertifiedDungeonModuleGeometryV2 CertifiedGeometry { get; }
        public string ContentHash => CertifiedGeometry.ContentHash;
    }

    /// <summary>
    /// Unity-independent source of truth for every module template currently
    /// emitted by industrial-factory-v2. Editor prefab generation consumes the
    /// same geometry records whose hashes are written into DungeonPlanV2.
    /// </summary>
    public static class IndustrialFactoryV2ModuleCatalog
    {
        public const string VariantA = "variant-a";
        public const string VariantB = "variant-b";
        public const string LocalRegionId = "region";

        private static readonly IReadOnlyList<DungeonMacroRoleKindV2> AllMacroRoles =
            Array.AsReadOnly(new[]
            {
                DungeonMacroRoleKindV2.SecurityEntrance,
                DungeonMacroRoleKindV2.AssemblyFloor,
                DungeonMacroRoleKindV2.BrokenFreightShaft,
                DungeonMacroRoleKindV2.SortingGantry,
                DungeonMacroRoleKindV2.NestWarehouse,
                DungeonMacroRoleKindV2.CredentialTower,
                DungeonMacroRoleKindV2.MachineCore
            });

        private static readonly IReadOnlyList<IndustrialFactoryV2ModuleDefinition> definitions =
            BuildDefinitions();

        private static readonly IReadOnlyDictionary<string, IndustrialFactoryV2ModuleDefinition> byTemplateId =
            definitions.ToDictionary(value => value.TemplateId, StringComparer.Ordinal);

        public static IReadOnlyList<IndustrialFactoryV2ModuleDefinition> Definitions => definitions;

        public static bool TryGet(string templateId, out IndustrialFactoryV2ModuleDefinition definition)
        {
            if (templateId == null)
            {
                definition = null;
                return false;
            }

            return byTemplateId.TryGetValue(templateId, out definition);
        }

        public static IndustrialFactoryV2ModuleDefinition Require(string templateId)
        {
            if (!TryGet(templateId, out IndustrialFactoryV2ModuleDefinition definition))
            {
                throw new InvalidOperationException(
                    "industrial-factory-v2 referenced uncatalogued module template '" + templateId + "'.");
            }

            return definition;
        }

        private static IReadOnlyList<IndustrialFactoryV2ModuleDefinition> BuildDefinitions()
        {
            var result = new List<IndustrialFactoryV2ModuleDefinition>();
            AddFactoryPair(result, DungeonMacroRoleKindV2.SecurityEntrance, "securityentrance", "observation");
            AddFactoryPair(result, DungeonMacroRoleKindV2.AssemblyFloor, "assemblyfloor", "cargo");
            AddFactoryPair(result, DungeonMacroRoleKindV2.BrokenFreightShaft, "brokenfreightshaft", "freight-rails");
            AddFactoryPair(result, DungeonMacroRoleKindV2.SortingGantry, "sortinggantry", "gantry");
            AddFactoryPair(result, DungeonMacroRoleKindV2.NestWarehouse, "nestwarehouse", "storage");
            AddFactoryPair(result, DungeonMacroRoleKindV2.CredentialTower, "credentialtower", "tower-steps");
            AddFactoryPair(result, DungeonMacroRoleKindV2.MachineCore, "machinecore", "core-dais");

            AddDistrictPair(
                result,
                "water-freight-sump",
                DungeonBiomeDistrictKindV2.Waterworks,
                new[] { DungeonMacroRoleKindV2.BrokenFreightShaft },
                "water-shelf");
            AddDistrictPair(
                result,
                "water-reservoir-service",
                DungeonBiomeDistrictKindV2.Waterworks,
                new[] { DungeonMacroRoleKindV2.SortingGantry },
                "water-shelf");
            AddDistrictPair(
                result,
                "water-gantry-sump",
                DungeonBiomeDistrictKindV2.Waterworks,
                new[] { DungeonMacroRoleKindV2.NestWarehouse },
                "water-shelf");

            AddDistrictPair(
                result,
                "magma-landing",
                DungeonBiomeDistrictKindV2.MagmaUndercroft,
                new[] { DungeonMacroRoleKindV2.CredentialTower },
                "hazard-landing");
            AddDistrictPair(
                result,
                "magma-basin",
                DungeonBiomeDistrictKindV2.MagmaUndercroft,
                new[] { DungeonMacroRoleKindV2.MachineCore },
                "magma-basin");
            AddDistrictPair(
                result,
                "electrical-landing",
                DungeonBiomeDistrictKindV2.ElectricalUndercroft,
                new[] { DungeonMacroRoleKindV2.CredentialTower },
                "hazard-landing");
            AddDistrictPair(
                result,
                "electrical-basin",
                DungeonBiomeDistrictKindV2.ElectricalUndercroft,
                new[] { DungeonMacroRoleKindV2.MachineCore },
                "electrical-basin");

            AddDistrictPair(
                result,
                "factory-pocket",
                DungeonBiomeDistrictKindV2.Factory,
                AllMacroRoles,
                "storage");

            result.Sort((left, right) => StringComparer.Ordinal.Compare(left.TemplateId, right.TemplateId));
            return Array.AsReadOnly(result.ToArray());
        }

        private static void AddFactoryPair(
            ICollection<IndustrialFactoryV2ModuleDefinition> result,
            DungeonMacroRoleKindV2 role,
            string roleSlug,
            string featureProfile)
        {
            AddDistrictPair(
                result,
                "factory-" + roleSlug,
                DungeonBiomeDistrictKindV2.Factory,
                new[] { role },
                featureProfile);
        }

        private static void AddDistrictPair(
            ICollection<IndustrialFactoryV2ModuleDefinition> result,
            string templatePrefix,
            DungeonBiomeDistrictKindV2 district,
            IEnumerable<DungeonMacroRoleKindV2> roles,
            string featureProfile)
        {
            DungeonMacroRoleKindV2[] compatibleRoles = roles.ToArray();
            AddDefinition(result, templatePrefix + "-" + VariantA, VariantA, district, compatibleRoles, featureProfile);
            AddDefinition(result, templatePrefix + "-" + VariantB, VariantB, district, compatibleRoles, featureProfile);
        }

        private static void AddDefinition(
            ICollection<IndustrialFactoryV2ModuleDefinition> result,
            string templateId,
            string variantId,
            DungeonBiomeDistrictKindV2 district,
            IEnumerable<DungeonMacroRoleKindV2> roles,
            string featureProfile)
        {
            CertifiedDungeonModuleGeometryV2 geometry = BuildGeometry(
                templateId,
                variantId,
                district,
                featureProfile);
            result.Add(new IndustrialFactoryV2ModuleDefinition(
                templateId,
                variantId,
                district,
                roles,
                geometry));
        }

        private static CertifiedDungeonModuleGeometryV2 BuildGeometry(
            string templateId,
            string variantId,
            DungeonBiomeDistrictKindV2 district,
            string featureProfile)
        {
            double halfDepth = string.Equals(variantId, VariantB, StringComparison.Ordinal) ? 4.75d : 4d;
            var bounds = new DungeonBounds3(
                new DungeonPoint3(-5d, 0d, -halfDepth),
                new DungeonPoint3(5d, 5d, halfDepth));
            var regions = new[]
            {
                new CertifiedDungeonRegionGeometryV2(
                    LocalRegionId,
                    bounds,
                    district,
                    district == DungeonBiomeDistrictKindV2.Factory
                        ? templateId.StartsWith("factory-pocket-", StringComparison.Ordinal)
                            ? DungeonElevationStratumV2.Upper
                            : DungeonElevationStratumV2.Entry
                        : DungeonElevationStratumV2.Lower,
                    "navigation")
            };

            var surfaces = new List<CertifiedDungeonSurfaceGeometryV2>();
            DungeonSurfaceKindV2 floorKind = district == DungeonBiomeDistrictKindV2.Waterworks
                ? DungeonSurfaceKindV2.WaterBed
                : DungeonSurfaceKindV2.Walkable;
            string floorMaterial = district == DungeonBiomeDistrictKindV2.Waterworks
                ? "waterworks-bed"
                : district == DungeonBiomeDistrictKindV2.Factory
                    ? "factory-floor"
                    : "hazard-safe-island";
            // Credential Tower's structural floor is intentionally split in
            // the certified bake. The central crumble plate is an explicitly
            // classified assembly addition; a hidden full certified floor here
            // would make the collapsed state physically dishonest.
            if (!string.Equals(featureProfile, "tower-steps", StringComparison.Ordinal))
            {
                surfaces.Add(Surface(
                    "floor",
                    floorKind,
                    Box(-5d, 5d, 0d, 0.25d, -halfDepth, halfDepth),
                    true,
                    true,
                    floorMaterial));
            }

            AddFeatureSurfaces(surfaces, featureProfile, halfDepth, variantId);

            var anchors = new[]
            {
                new CertifiedDungeonAnchorGeometryV2(
                    "entry",
                    LocalRegionId,
                    DungeonAnchorKindV2.Entry,
                    new DungeonPoint3(-4d, 0.5d, 0d)),
                new CertifiedDungeonAnchorGeometryV2(
                    "exit",
                    LocalRegionId,
                    DungeonAnchorKindV2.Exit,
                    new DungeonPoint3(4d, 0.5d, 0d)),
                new CertifiedDungeonAnchorGeometryV2(
                    "safe",
                    LocalRegionId,
                    DungeonAnchorKindV2.Safe,
                    new DungeonPoint3(0d, 0.5d, 0d),
                    "safe-reset-v2")
            };
            var connectors = new[]
            {
                new CertifiedDungeonConnectorGeometryV2(
                    "west",
                    LocalRegionId,
                    DungeonConnectorKindV2.Ground,
                    new DungeonPoint3(-5d, 0.5d, 0d),
                    new DungeonPoint3(-1d, 0d, 0d),
                    "factory-ground-v2"),
                new CertifiedDungeonConnectorGeometryV2(
                    "east",
                    LocalRegionId,
                    DungeonConnectorKindV2.Ground,
                    new DungeonPoint3(5d, 0.5d, 0d),
                    new DungeonPoint3(1d, 0d, 0d),
                    "factory-ground-v2")
            };

            return new CertifiedDungeonModuleGeometryV2(
                templateId,
                surfaces,
                regions,
                anchors,
                connectors);
        }

        private static void AddFeatureSurfaces(
            ICollection<CertifiedDungeonSurfaceGeometryV2> surfaces,
            string profile,
            double halfDepth,
            string variantId)
        {
            bool variantB = string.Equals(variantId, VariantB, StringComparison.Ordinal);
            switch (profile)
            {
                case "observation":
                    surfaces.Add(Surface(
                        "observation-platform",
                        DungeonSurfaceKindV2.Walkable,
                        Box(1d, 4.5d, 1.25d, 1.5d, halfDepth - 2d, halfDepth - 0.5d),
                        true,
                        true,
                        "factory-observation"));
                    break;
                case "cargo":
                    surfaces.Add(Surface(
                        "cargo-machine",
                        DungeonSurfaceKindV2.SolidOccupancy,
                        Box(-1.25d, 1.25d, 0.25d, variantB ? 2d : 1.5d, -1d, 1d),
                        true,
                        false,
                        "factory-cargo"));
                    break;
                case "freight-rails":
                    surfaces.Add(Surface(
                        "north-rail",
                        DungeonSurfaceKindV2.Rail,
                        Box(-4d, 4d, 0.25d, 1.25d, halfDepth - 0.25d, halfDepth),
                        true,
                        false,
                        "factory-rail"));
                    surfaces.Add(Surface(
                        "south-rail",
                        DungeonSurfaceKindV2.Rail,
                        Box(-4d, 4d, 0.25d, 1.25d, -halfDepth, -halfDepth + 0.25d),
                        true,
                        false,
                        "factory-rail"));
                    break;
                case "gantry":
                    surfaces.Add(Surface(
                        "sorting-gantry",
                        DungeonSurfaceKindV2.Walkable,
                        Box(-2.5d, 2.5d, 1.5d, 1.75d, variantB ? 1d : 0.5d, halfDepth - 0.75d),
                        true,
                        true,
                        "factory-gantry"));
                    break;
                case "storage":
                    surfaces.Add(Surface(
                        "storage-stack",
                        DungeonSurfaceKindV2.SolidOccupancy,
                        Box(-4d, -2d, 0.25d, variantB ? 2.5d : 2d, -1.5d, 1.5d),
                        true,
                        false,
                        "factory-storage"));
                    break;
                case "tower-steps":
                    double crumbleNorth = -halfDepth + 3d;
                    surfaces.Add(Surface(
                        "tower-floor-north",
                        DungeonSurfaceKindV2.Walkable,
                        Box(-5d, 5d, 0d, 0.25d, crumbleNorth, halfDepth),
                        true,
                        true,
                        "factory-floor"));
                    surfaces.Add(Surface(
                        "tower-floor-south-west",
                        DungeonSurfaceKindV2.Walkable,
                        Box(-5d, -2d, 0d, 0.25d, -halfDepth, crumbleNorth),
                        true,
                        true,
                        "factory-floor"));
                    surfaces.Add(Surface(
                        "tower-floor-south-east",
                        DungeonSurfaceKindV2.Walkable,
                        Box(2d, 5d, 0d, 0.25d, -halfDepth, crumbleNorth),
                        true,
                        true,
                        "factory-floor"));
                    surfaces.Add(Surface(
                        "tower-step-low",
                        DungeonSurfaceKindV2.Walkable,
                        Box(-3.75d, -1d, 0.25d, 0.75d, -2d, 2d),
                        true,
                        true,
                        "factory-tower-step"));
                    surfaces.Add(Surface(
                        "tower-step-low-south-rail",
                        DungeonSurfaceKindV2.Rail,
                        Box(-3.75d, -1d, 0.75d, 2.75d, -2.12d, -1.88d),
                        true,
                        false,
                        "factory-rail"));
                    surfaces.Add(Surface(
                        "tower-step-high",
                        DungeonSurfaceKindV2.Walkable,
                        Box(0d, 3.75d, 0.25d, variantB ? 1.5d : 1.25d, -2d, 2d),
                        true,
                        true,
                        "factory-tower-step"));
                    double highStepTop = variantB ? 1.5d : 1.25d;
                    surfaces.Add(Surface(
                        "tower-step-high-south-rail",
                        DungeonSurfaceKindV2.Rail,
                        Box(0d, 3.75d, highStepTop, highStepTop + 2d, -2.12d, -1.88d),
                        true,
                        false,
                        "factory-rail"));
                    break;
                case "core-dais":
                    surfaces.Add(Surface(
                        "machine-core-dais",
                        DungeonSurfaceKindV2.Walkable,
                        Box(-2d, 2d, 0.25d, variantB ? 0.75d : 0.5d, -2d, 2d),
                        true,
                        true,
                        "factory-core-dais"));
                    break;
                case "water-shelf":
                    surfaces.Add(Surface(
                        "water-service-shelf",
                        DungeonSurfaceKindV2.Walkable,
                        Box(-4.5d, -1.5d, 1.25d, 1.5d, halfDepth - 2d, halfDepth - 0.5d),
                        true,
                        true,
                        "waterworks-service-shelf"));
                    break;
                case "hazard-landing":
                    surfaces.Add(Surface(
                        "quiet-reorientation-shelf",
                        DungeonSurfaceKindV2.Walkable,
                        Box(-4.5d, -1d, 0.5d, 0.75d, -2d, 2d),
                        true,
                        true,
                        "hazard-quiet-shelf"));
                    break;
                case "magma-basin":
                case "electrical-basin":
                    surfaces.Add(Surface(
                        "active-hazard-south",
                        DungeonSurfaceKindV2.Hazard,
                        Box(-4d, 4d, 0.25d, 0.5d, -halfDepth + 1d, -1.25d),
                        true,
                        true,
                        profile == "magma-basin" ? "magma-floor-v1" : "electric-floor-cycle-v1"));
                    surfaces.Add(Surface(
                        "active-hazard-north",
                        DungeonSurfaceKindV2.Hazard,
                        Box(-4d, 4d, 0.25d, 0.5d, 1.25d, halfDepth - 1d),
                        true,
                        true,
                        profile == "magma-basin" ? "magma-floor-v1" : "electric-floor-cycle-v1"));
                    surfaces.Add(Surface(
                        "safe-island",
                        DungeonSurfaceKindV2.Walkable,
                        Box(-1.25d, 1.25d, 0.5d, variantB ? 1d : 0.75d, -1.25d, 1.25d),
                        true,
                        true,
                        "hazard-safe-island"));
                    break;
                default:
                    throw new InvalidOperationException("Unknown certified module feature profile '" + profile + "'.");
            }
        }

        private static CertifiedDungeonSurfaceGeometryV2 Surface(
            string id,
            DungeonSurfaceKindV2 kind,
            DungeonConvexPrismV2 volume,
            bool structural,
            bool walkable,
            string materialProfileId)
        {
            return new CertifiedDungeonSurfaceGeometryV2(
                id,
                LocalRegionId,
                kind,
                CertifiedDungeonColliderKindV2.Box,
                volume,
                structural,
                walkable,
                materialProfileId);
        }

        private static DungeonConvexPrismV2 Box(
            double minimumX,
            double maximumX,
            double minimumY,
            double maximumY,
            double minimumZ,
            double maximumZ)
        {
            return new DungeonConvexPrismV2(
                new[]
                {
                    new DungeonPoint2V2(minimumX, minimumZ),
                    new DungeonPoint2V2(maximumX, minimumZ),
                    new DungeonPoint2V2(maximumX, maximumZ),
                    new DungeonPoint2V2(minimumX, maximumZ)
                },
                minimumY,
                maximumY);
        }
    }
}
