using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace RuinCrawler.Core.Dungeon.V2
{
    /// <summary>
    /// Pure descriptor paired with geometry produced by the authored-prefab
    /// bake. Production may inject baked definitions; the static catalog below
    /// is a deterministic fixture/source manifest for Core generation tests.
    /// </summary>
    public sealed class IndustrialFactoryV2ModuleDefinition
    {
        public IndustrialFactoryV2ModuleDefinition(
            string templateId,
            string variantId,
            DungeonModuleCompositionContractV2 composition,
            IEnumerable<DungeonMacroRoleKindV2> compatibleMacroRoles,
            CertifiedDungeonModuleGeometryV2 certifiedGeometry,
            IEnumerable<DungeonAuthoredModuleTopologyEdgeV2> topologyEdges,
            string presentationDependencyHash,
            string verticalCompositionId = null)
        {
            TemplateId = DungeonV2Contract.RequireId(templateId, nameof(templateId));
            VariantId = DungeonV2Contract.RequireId(variantId, nameof(variantId));
            DescriptorId = "descriptor-" + TemplateId;
            Composition = composition ?? throw new ArgumentNullException(nameof(composition));
            CompatibleMacroRoles = Array.AsReadOnly((compatibleMacroRoles
                ?? throw new ArgumentNullException(nameof(compatibleMacroRoles)))
                .Distinct()
                .OrderBy(value => (int)value)
                .ToArray());
            if (CompatibleMacroRoles.Count == 0)
                throw new ArgumentException("At least one compatible macro role is required.", nameof(compatibleMacroRoles));

            CertifiedGeometry = certifiedGeometry ?? throw new ArgumentNullException(nameof(certifiedGeometry));
            if (!string.Equals(TemplateId, CertifiedGeometry.TemplateId, StringComparison.Ordinal))
                throw new ArgumentException("Certified geometry template ID does not match the descriptor.", nameof(certifiedGeometry));
            TopologyEdges = DungeonV2Contract.CopyCanonical(
                topologyEdges,
                value => value.Id,
                nameof(topologyEdges),
                minimumCount: composition.MinimumRegions > 1 ? 1 : 0);
            ValidateTopology();

            GeometryRevisionHash = CertifiedGeometry.ContentHash;
            PresentationDependencyHash = DungeonV2Contract.RequireId(
                presentationDependencyHash,
                nameof(presentationDependencyHash));
            VerticalCompositionId = DungeonV2Contract.OptionalId(verticalCompositionId, nameof(verticalCompositionId));
            TopologySignature = BuildTopologySignature();
            CombinedRevisionHash = DungeonAuthoredModuleRevisionV2.Combine(
                TemplateId,
                VariantId,
                Composition.Id,
                GeometryRevisionHash,
                PresentationDependencyHash,
                VerticalCompositionId,
                TopologySignature);
        }

        public string TemplateId { get; }
        public string DescriptorId { get; }
        public string VariantId { get; }
        public DungeonModuleCompositionContractV2 Composition { get; }
        public DungeonBiomeDistrictKindV2 DistrictKind => Composition.Districts[0];
        public IReadOnlyList<DungeonMacroRoleKindV2> CompatibleMacroRoles { get; }
        public CertifiedDungeonModuleGeometryV2 CertifiedGeometry { get; }
        public IReadOnlyList<DungeonAuthoredModuleTopologyEdgeV2> TopologyEdges { get; }
        public string GeometryRevisionHash { get; }
        public string PresentationDependencyHash { get; }
        public string CombinedRevisionHash { get; }
        public string VerticalCompositionId { get; }
        public string ContentHash => CombinedRevisionHash;
        public string TopologySignature { get; }

        private void ValidateTopology()
        {
            var regions = new HashSet<string>(CertifiedGeometry.Regions.Select(value => value.Id), StringComparer.Ordinal);
            if (CertifiedGeometry.Regions.Count < Composition.MinimumRegions)
                throw new ArgumentException("Certified geometry does not meet its composition region budget.");
            foreach (DungeonAuthoredModuleTopologyEdgeV2 edge in TopologyEdges)
            {
                if (!regions.Contains(edge.FromLocalRegionId) || !regions.Contains(edge.ToLocalRegionId))
                    throw new ArgumentException("Topology edge references an unknown certified local region.");
            }
            foreach (DungeonBiomeDistrictKindV2 district in CertifiedGeometry.Regions.Select(value => value.DistrictKind).Distinct())
            {
                if (!Composition.Districts.Contains(district))
                    throw new ArgumentException("Certified region district is absent from its composition contract.");
            }
        }

        private string BuildTopologySignature()
        {
            var builder = new StringBuilder();
            builder.Append(Composition.Id).Append('|');
            foreach (CertifiedDungeonRegionGeometryV2 region in CertifiedGeometry.Regions.OrderBy(value => value.Id, StringComparer.Ordinal))
            {
                builder.Append(region.Id).Append('@').Append((int)region.ElevationStratum).Append(':')
                    .Append((int)region.DistrictKind).Append('|');
            }
            foreach (DungeonAuthoredModuleTopologyEdgeV2 edge in TopologyEdges)
            {
                builder.Append(edge.FromLocalRegionId).Append('>').Append(edge.ToLocalRegionId)
                    .Append(':').Append((int)edge.Kind).Append(':').Append(edge.Bidirectional ? '2' : '1').Append('|');
            }
            foreach (CertifiedDungeonConnectorGeometryV2 connector in CertifiedGeometry.Connectors.OrderBy(value => value.Id, StringComparer.Ordinal))
            {
                builder.Append(connector.Id).Append('@')
                    .Append(connector.Position.X.ToString("R", CultureInfo.InvariantCulture)).Append(',')
                    .Append(connector.Position.Y.ToString("R", CultureInfo.InvariantCulture)).Append(',')
                    .Append(connector.Position.Z.ToString("R", CultureInfo.InvariantCulture)).Append(':')
                    .Append(connector.Facing.X.ToString("R", CultureInfo.InvariantCulture)).Append(',')
                    .Append(connector.Facing.Z.ToString("R", CultureInfo.InvariantCulture)).Append('|');
            }
            return DungeonAuthoredModuleRevisionV2.Combine(builder.ToString());
        }
    }

    public static class IndustrialFactoryV2ModuleCatalog
    {
        public const string VariantA = "variant-a";
        public const string VariantB = "variant-b";
        public const string LocalRegionId = "entry";

        public const string AncientServerCrypt = "ancient-server-crypt";
        public const string FluidTankChamber = "fluid-tank-chamber";
        public const string ReaverbotRechargeChamber = "reaverbot-recharge-chamber";
        public const string ReaverbotNest = "reaverbot-nest";
        public const string AssemblyLineHall = "assembly-line-hall";
        public const string PumpCoolantWorks = "pump-coolant-works";
        public const string ReactorSupportChamber = "reactor-support-chamber";
        public const string SecurityCheckpoint = "security-checkpoint";
        public const string VerticalMaintenanceShaft = "vertical-maintenance-shaft";
        public const string PartsWarehouse = "parts-warehouse";
        public const string HazardProcessing = "hazard-processing";
        public const string SurveillanceControlTheater = "surveillance-control-theater";

        private static readonly DungeonAuthoredModuleCatalogV2 defaultCatalog =
            new DungeonAuthoredModuleCatalogV2(BuildDefinitions());

        public static IIndustrialFactoryV2ModuleCatalog Default => defaultCatalog;
        public static IReadOnlyList<IndustrialFactoryV2ModuleDefinition> Definitions => defaultCatalog.Definitions;
        public static bool TryGet(string templateId, out IndustrialFactoryV2ModuleDefinition definition) =>
            defaultCatalog.TryGet(templateId, out definition);
        public static IndustrialFactoryV2ModuleDefinition Require(string templateId) =>
            defaultCatalog.Require(templateId);
        public static IReadOnlyList<IndustrialFactoryV2ModuleDefinition> FindCompatible(
            DungeonMacroRoleKindV2 role,
            DungeonBiomeDistrictKindV2 district) => defaultCatalog.FindCompatible(role, district);

        public static string TemplateId(string familySlug, string variantId) =>
            DungeonV2Contract.RequireId(familySlug, nameof(familySlug)) + "-"
                + DungeonV2Contract.RequireId(variantId, nameof(variantId));

        private static IReadOnlyList<IndustrialFactoryV2ModuleDefinition> BuildDefinitions()
        {
            var result = new List<IndustrialFactoryV2ModuleDefinition>(24);
            AddFamily(result, Spec(
                AncientServerCrypt,
                DungeonModuleArchetypeV2.AncientServerCrypt,
                DungeonModuleSizeClassV2.Medium,
                new[] { DungeonBiomeDistrictKindV2.Factory },
                new[] { DungeonMacroRoleKindV2.SecurityEntrance, DungeonMacroRoleKindV2.CredentialTower },
                new[] { DungeonModuleSemanticFeatureV2.ServerBanks, DungeonModuleSemanticFeatureV2.DataPylons },
                new[] { DungeonMechanismProfileV2.SecurityBulkhead },
                DungeonStoryVignetteProfileV2.AncientDataArchive,
                DungeonLightingProfileV2.SecurityColdWhite,
                DungeonPropProfileV2.ServersAndConduits,
                20d, 18d, 10d));
            AddFamily(result, Spec(
                FluidTankChamber,
                DungeonModuleArchetypeV2.FluidTankChamber,
                DungeonModuleSizeClassV2.Large,
                new[] { DungeonBiomeDistrictKindV2.Factory, DungeonBiomeDistrictKindV2.Waterworks },
                new[] { DungeonMacroRoleKindV2.BrokenFreightShaft },
                new[] { DungeonModuleSemanticFeatureV2.FluidTanks, DungeonModuleSemanticFeatureV2.Valves },
                new[] { DungeonMechanismProfileV2.FluidValve },
                DungeonStoryVignetteProfileV2.InterruptedFluidTransfer,
                DungeonLightingProfileV2.WaterworksCyan,
                DungeonPropProfileV2.TanksPipesAndValves,
                28d, 26d, 15d));
            AddFamily(result, Spec(
                ReaverbotRechargeChamber,
                DungeonModuleArchetypeV2.ReaverbotRechargeChamber,
                DungeonModuleSizeClassV2.Medium,
                new[] { DungeonBiomeDistrictKindV2.Factory },
                new[] { DungeonMacroRoleKindV2.AssemblyFloor },
                new[] { DungeonModuleSemanticFeatureV2.RechargePods, DungeonModuleSemanticFeatureV2.ReaverbotCradles },
                new[] { DungeonMechanismProfileV2.ConveyorRouter },
                DungeonStoryVignetteProfileV2.DormantRechargeCycle,
                DungeonLightingProfileV2.FactoryTealAmber,
                DungeonPropProfileV2.RechargeCradles,
                22d, 18d, 11d));
            AddFamily(result, Spec(
                ReaverbotNest,
                DungeonModuleArchetypeV2.ReaverbotNest,
                DungeonModuleSizeClassV2.Large,
                new[] { DungeonBiomeDistrictKindV2.Factory, DungeonBiomeDistrictKindV2.Waterworks },
                new[] { DungeonMacroRoleKindV2.NestWarehouse },
                new[] { DungeonModuleSemanticFeatureV2.NestMachinery, DungeonModuleSemanticFeatureV2.SalvageSorting },
                new[] { DungeonMechanismProfileV2.CargoCrane },
                DungeonStoryVignetteProfileV2.ReaverbotAssemblyNest,
                DungeonLightingProfileV2.FactoryTealAmber,
                DungeonPropProfileV2.NestDebrisAndParts,
                30d, 28d, 16d));
            AddFamily(result, Spec(
                AssemblyLineHall,
                DungeonModuleArchetypeV2.AssemblyLineHall,
                DungeonModuleSizeClassV2.Large,
                new[] { DungeonBiomeDistrictKindV2.Factory },
                new[] { DungeonMacroRoleKindV2.AssemblyFloor },
                new[] { DungeonModuleSemanticFeatureV2.Conveyors, DungeonModuleSemanticFeatureV2.RobotArms },
                new[] { DungeonMechanismProfileV2.ConveyorRouter, DungeonMechanismProfileV2.CargoCrane },
                DungeonStoryVignetteProfileV2.AbandonedProductionShift,
                DungeonLightingProfileV2.FactoryTealAmber,
                DungeonPropProfileV2.ConveyorsAndRobotArms,
                32d, 20d, 14d));
            AddFamily(result, Spec(
                PumpCoolantWorks,
                DungeonModuleArchetypeV2.PumpAndCoolantWorks,
                DungeonModuleSizeClassV2.Large,
                new[] { DungeonBiomeDistrictKindV2.Factory, DungeonBiomeDistrictKindV2.Waterworks },
                new[] { DungeonMacroRoleKindV2.SortingGantry },
                new[] { DungeonModuleSemanticFeatureV2.Pumps, DungeonModuleSemanticFeatureV2.Valves, DungeonModuleSemanticFeatureV2.CoolantManifold },
                new[] { DungeonMechanismProfileV2.PumpRoutingConsole },
                DungeonStoryVignetteProfileV2.EmergencyCoolantReroute,
                DungeonLightingProfileV2.WaterworksCyan,
                DungeonPropProfileV2.PumpsAndManifolds,
                30d, 26d, 15d));
            AddFamily(result, Spec(
                ReactorSupportChamber,
                DungeonModuleArchetypeV2.ReactorSupportChamber,
                DungeonModuleSizeClassV2.Large,
                new[] { DungeonBiomeDistrictKindV2.Factory },
                new[] { DungeonMacroRoleKindV2.SortingGantry, DungeonMacroRoleKindV2.MachineCore },
                new[] { DungeonModuleSemanticFeatureV2.ReactorSupports, DungeonModuleSemanticFeatureV2.Turbines },
                new[] { DungeonMechanismProfileV2.ReactorInterlock },
                DungeonStoryVignetteProfileV2.ReactorContainmentFailure,
                DungeonLightingProfileV2.ReactorPulse,
                DungeonPropProfileV2.ReactorSupportsAndTurbines,
                32d, 30d, 17d));
            AddFamily(result, Spec(
                SecurityCheckpoint,
                DungeonModuleArchetypeV2.SecurityCheckpoint,
                DungeonModuleSizeClassV2.Medium,
                new[] { DungeonBiomeDistrictKindV2.Factory },
                new[] { DungeonMacroRoleKindV2.SecurityEntrance, DungeonMacroRoleKindV2.CredentialTower },
                new[] { DungeonModuleSemanticFeatureV2.SecurityBulkheads, DungeonModuleSemanticFeatureV2.CredentialConsole },
                new[] { DungeonMechanismProfileV2.SecurityBulkhead },
                DungeonStoryVignetteProfileV2.LockedSecurityEvacuation,
                DungeonLightingProfileV2.SecurityColdWhite,
                DungeonPropProfileV2.BulkheadsAndTerminals,
                18d, 18d, 10d));
            AddFamily(result, Spec(
                VerticalMaintenanceShaft,
                DungeonModuleArchetypeV2.VerticalMaintenanceShaft,
                DungeonModuleSizeClassV2.Large,
                new[] { DungeonBiomeDistrictKindV2.Factory, DungeonBiomeDistrictKindV2.Waterworks },
                new[] { DungeonMacroRoleKindV2.BrokenFreightShaft },
                new[] { DungeonModuleSemanticFeatureV2.LiftMachinery, DungeonModuleSemanticFeatureV2.MaintenanceScaffolds },
                new[] { DungeonMechanismProfileV2.CargoLift, DungeonMechanismProfileV2.CrumbleBridge },
                DungeonStoryVignetteProfileV2.CollapsedMaintenanceWork,
                DungeonLightingProfileV2.FactoryTealAmber,
                DungeonPropProfileV2.LiftsLaddersAndScaffolds,
                24d, 22d, 18d));
            AddFamily(result, Spec(
                PartsWarehouse,
                DungeonModuleArchetypeV2.StorageVaultPartsWarehouse,
                DungeonModuleSizeClassV2.Large,
                new[] { DungeonBiomeDistrictKindV2.Factory, DungeonBiomeDistrictKindV2.Waterworks },
                new[] { DungeonMacroRoleKindV2.NestWarehouse },
                new[] { DungeonModuleSemanticFeatureV2.StorageRacks, DungeonModuleSemanticFeatureV2.CargoCrane },
                new[] { DungeonMechanismProfileV2.CargoCrane },
                DungeonStoryVignetteProfileV2.SalvageStockpile,
                DungeonLightingProfileV2.FactoryTealAmber,
                DungeonPropProfileV2.RacksCratesAndCranes,
                30d, 24d, 14d));
            AddFamily(result, Spec(
                HazardProcessing,
                DungeonModuleArchetypeV2.HazardProcessingRoom,
                DungeonModuleSizeClassV2.Large,
                new[] { DungeonBiomeDistrictKindV2.MagmaUndercroft, DungeonBiomeDistrictKindV2.ElectricalUndercroft },
                new[] { DungeonMacroRoleKindV2.CredentialTower, DungeonMacroRoleKindV2.MachineCore },
                new[] { DungeonModuleSemanticFeatureV2.FurnaceInfrastructure, DungeonModuleSemanticFeatureV2.TransformerInfrastructure },
                new[] { DungeonMechanismProfileV2.FurnaceRegulator, DungeonMechanismProfileV2.HazardGroundingConsole },
                DungeonStoryVignetteProfileV2.HazardContainmentBreach,
                DungeonLightingProfileV2.MagmaUnderlight,
                DungeonPropProfileV2.FurnacesOrTransformers,
                30d, 26d, 14d));
            AddFamily(result, Spec(
                SurveillanceControlTheater,
                DungeonModuleArchetypeV2.SurveillanceControlTheater,
                DungeonModuleSizeClassV2.Large,
                new[] { DungeonBiomeDistrictKindV2.Factory },
                new[] { DungeonMacroRoleKindV2.NestWarehouse, DungeonMacroRoleKindV2.MachineCore },
                new[] { DungeonModuleSemanticFeatureV2.SurveillanceDisplays, DungeonModuleSemanticFeatureV2.ControlDais },
                new[] { DungeonMechanismProfileV2.SecurityBulkhead },
                DungeonStoryVignetteProfileV2.AbandonedSurveillance,
                DungeonLightingProfileV2.SecurityColdWhite,
                DungeonPropProfileV2.SurveillanceTerminals,
                34d, 30d, 16d));

            result.Sort((left, right) => StringComparer.Ordinal.Compare(left.TemplateId, right.TemplateId));
            if (result.Count != 24) throw new InvalidOperationException("Authored module manifest must contain exactly 24 variants.");
            return Array.AsReadOnly(result.ToArray());
        }

        private static FamilySpec Spec(
            string slug,
            DungeonModuleArchetypeV2 archetype,
            DungeonModuleSizeClassV2 sizeClass,
            DungeonBiomeDistrictKindV2[] districts,
            DungeonMacroRoleKindV2[] macros,
            DungeonModuleSemanticFeatureV2[] features,
            DungeonMechanismProfileV2[] mechanisms,
            DungeonStoryVignetteProfileV2 story,
            DungeonLightingProfileV2 light,
            DungeonPropProfileV2 props,
            double width,
            double depth,
            double height)
        {
            return new FamilySpec(slug, archetype, sizeClass, districts, macros, features, mechanisms,
                story, light, props, width, depth, height);
        }

        private static void AddFamily(ICollection<IndustrialFactoryV2ModuleDefinition> result, FamilySpec spec)
        {
            result.Add(BuildDefinition(spec, VariantA));
            result.Add(BuildDefinition(spec, VariantB));
        }

        private static IndustrialFactoryV2ModuleDefinition BuildDefinition(FamilySpec spec, string variantId)
        {
            bool variantB = string.Equals(variantId, VariantB, StringComparison.Ordinal);
            string templateId = TemplateId(spec.Slug, variantId);
            bool mini = spec.SizeClass == DungeonModuleSizeClassV2.MiniDungeon;
            bool mixedLower = spec.Districts.Contains(DungeonBiomeDistrictKindV2.Waterworks);
            bool hazard = spec.Archetype == DungeonModuleArchetypeV2.HazardProcessingRoom;
            int regionCount = mini ? 3 : 2;
            var traversalTiers = mixedLower || hazard
                ? new[] { DungeonModuleTraversalTierV2.Entry, DungeonModuleTraversalTierV2.Lower }
                : new[] { DungeonModuleTraversalTierV2.Entry, DungeonModuleTraversalTierV2.Upper };
            var composition = new DungeonModuleCompositionContractV2(
                "composition-" + spec.Slug + "-v1",
                spec.Archetype,
                spec.SizeClass,
                spec.Districts,
                traversalTiers,
                spec.Features,
                new[]
                {
                    new DungeonPlatformPurposeBindingV2("critical-platform", DungeonPlatformPurposeV2.CriticalTraverse, "exit-route"),
                    new DungeonPlatformPurposeBindingV2("mechanism-platform", DungeonPlatformPurposeV2.MechanismStaging, "primary-mechanism"),
                    new DungeonPlatformPurposeBindingV2(
                        mini ? "reward-platform" : "combat-platform",
                        mini ? DungeonPlatformPurposeV2.OptionalReward : DungeonPlatformPurposeV2.CombatFlank,
                        mini ? "major-reward" : "encounter-flank")
                },
                new[] { DungeonStructuralSupportKindV2.Column, DungeonStructuralSupportKindV2.Truss },
                spec.Mechanisms,
                spec.Story,
                spec.Districts.Contains(DungeonBiomeDistrictKindV2.Waterworks)
                    ? new[] { DungeonLightingProfileV2.FactoryTealAmber, DungeonLightingProfileV2.WaterworksCyan }
                    : hazard
                        ? new[] { DungeonLightingProfileV2.MagmaUnderlight, DungeonLightingProfileV2.ElectricalSafeChargeLive }
                        : new[] { spec.Light },
                spec.Props,
                regionCount,
                mini ? 2 : variantB ? 1 : 0,
                spec.SizeClass == DungeonModuleSizeClassV2.Large || mini,
                mini);

            CertifiedDungeonModuleGeometryV2 geometry = BuildGeometry(templateId, spec, variantB);
            IReadOnlyList<DungeonAuthoredModuleTopologyEdgeV2> topology = BuildTopology(spec, variantB, geometry);
            return new IndustrialFactoryV2ModuleDefinition(
                templateId,
                variantId,
                composition,
                CompatibleMacroRoles(spec, variantB),
                geometry,
                topology,
                DungeonAuthoredModuleRevisionV2.Combine(
                    "presentation-dependencies",
                    templateId,
                    "v1"),
                mixedLower || hazard ? "vertical-profile-" + spec.Slug : null);
        }

        private static IEnumerable<DungeonMacroRoleKindV2> CompatibleMacroRoles(
            FamilySpec spec,
            bool variantB)
        {
            // Entrance and Credential use different physical gate contracts.
            // Their A/B prefabs therefore own role-specific collision rather
            // than relying on generation-time mutation of a shared bake.
            bool securityAndCredential = spec.Macros.Contains(DungeonMacroRoleKindV2.SecurityEntrance)
                && spec.Macros.Contains(DungeonMacroRoleKindV2.CredentialTower);
            if (!securityAndCredential) return spec.Macros;
            return variantB
                ? new[] { DungeonMacroRoleKindV2.CredentialTower }
                : new[] { DungeonMacroRoleKindV2.SecurityEntrance };
        }

        private static CertifiedDungeonModuleGeometryV2 BuildGeometry(
            string templateId,
            FamilySpec spec,
            bool variantB)
        {
            double halfX = spec.Width * 0.5d;
            double halfZ = spec.Depth * 0.5d;
            bool mixedLower = spec.Districts.Contains(DungeonBiomeDistrictKindV2.Waterworks);
            bool hazard = spec.Archetype == DungeonModuleArchetypeV2.HazardProcessingRoom;
            bool mini = spec.SizeClass == DungeonModuleSizeClassV2.MiniDungeon;
            bool credentialGateVariant = variantB
                && spec.Macros.Contains(DungeonMacroRoleKindV2.SecurityEntrance)
                && spec.Macros.Contains(DungeonMacroRoleKindV2.CredentialTower);

            DungeonBiomeDistrictKindV2 secondaryDistrict = mixedLower
                ? DungeonBiomeDistrictKindV2.Waterworks
                : hazard
                    ? variantB
                        ? DungeonBiomeDistrictKindV2.ElectricalUndercroft
                        : DungeonBiomeDistrictKindV2.MagmaUndercroft
                    : DungeonBiomeDistrictKindV2.Factory;
            var regions = new List<CertifiedDungeonRegionGeometryV2>
            {
                Region("entry", BoxBounds(-halfX, halfX, 0d, spec.Height, -halfZ, halfZ),
                    hazard ? secondaryDistrict : DungeonBiomeDistrictKindV2.Factory,
                    hazard ? DungeonElevationStratumV2.Lower : DungeonElevationStratumV2.Entry),
                Region(
                    mixedLower || hazard ? "lower" : "upper",
                    mixedLower || hazard
                        ? BoxBounds(-halfX, halfX, -6d, 0d, -halfZ, halfZ)
                        : variantB
                            ? BoxBounds(-halfX + 2d, 1d, 3d, spec.Height, -halfZ + 2d, halfZ - 2d)
                            : BoxBounds(-halfX + 2d, halfX - 2d, 3d, spec.Height, 0d, halfZ - 2d),
                    secondaryDistrict,
                    mixedLower || hazard ? DungeonElevationStratumV2.Lower : DungeonElevationStratumV2.Upper)
            };
            if (mini)
            {
                regions.Add(Region(
                    "reward-branch",
                    variantB
                        ? BoxBounds(2d, halfX - 2d, 5d, spec.Height, -halfZ + 2d, 0d)
                        : BoxBounds(-halfX + 2d, 0d, -6d, 0d, -halfZ + 2d, 0d),
                    DungeonBiomeDistrictKindV2.Factory,
                    variantB ? DungeonElevationStratumV2.Upper : DungeonElevationStratumV2.Lower));
            }

            var surfaces = new List<CertifiedDungeonSurfaceGeometryV2>();
            string entryMaterial = hazard ? "hazard-safe-island" : "factory-floor";
            if (mixedLower || hazard)
            {
                AddEntryFloorAroundShaft(surfaces, "entry", halfX, halfZ, entryMaterial);
            }
            else
            {
                surfaces.Add(Surface("entry-floor", "entry", DungeonSurfaceKindV2.Walkable,
                    Box(-halfX, halfX, 0d, 0.25d, -halfZ, halfZ), true, true, entryMaterial));
            }
            AddSealedShell(surfaces, "entry", halfX, halfZ, 0d, spec.Height, variantB);
            if (spec.Macros.Contains(DungeonMacroRoleKindV2.BrokenFreightShaft))
            {
                surfaces.Add(Surface("water-operation-bulkhead", "entry", DungeonSurfaceKindV2.DoorSweep,
                    Box(halfX - 0.2d, halfX + 0.2d, 0d, 3.65d, -1.25d, 1.25d),
                    true, false, "factory-bulkhead-locked",
                    FactPredicate(
                        DungeonPredicateConditionKindV2.ControllerState,
                        IndustrialFactoryV2Ruleset.WaterRoutingControllerId,
                        DungeonPredicateOperatorV2.NotEquals,
                        IndustrialFactoryV2Ruleset.StoredInReservoir),
                    IndustrialFactoryV2Ruleset.WaterRoutingControllerId));
            }
            if (credentialGateVariant)
            {
                surfaces.Add(Surface("credential-bulkhead", "entry", DungeonSurfaceKindV2.DoorSweep,
                    Box(halfX - 0.2d, halfX + 0.2d, 0d, Math.Min(spec.Height, 8d), -1.25d, 1.25d),
                    true, false, "factory-credential-bulkhead",
                    FactPredicate(
                        DungeonPredicateConditionKindV2.RequiredItem,
                        IndustrialFactoryV2Ruleset.CredentialKeyRewardId,
                        DungeonPredicateOperatorV2.IsAbsent),
                    null));
            }
            AddFamilySpecificCertifiedOccupancy(surfaces, spec, halfX, halfZ);

            if (mixedLower || hazard)
            {
                string lowerMaterial = mixedLower ? "waterworks-bed" : "hazard-safe-island";
                DungeonSurfaceKindV2 lowerKind = mixedLower ? DungeonSurfaceKindV2.WaterBed : DungeonSurfaceKindV2.Walkable;
                surfaces.Add(Surface("lower-floor", "lower", lowerKind,
                    Box(-halfX, halfX, -6d, -5.75d, -halfZ, halfZ),
                    true, true, lowerMaterial));
                // The certified module currently authors the return-lift car at
                // its lower landing only. Until a complete vertical sweep and
                // failure envelope are baked, it is stationary lift
                // infrastructure rather than a failure-capable moving surface.
                surfaces.Add(Surface("return-lift-platform", "lower", DungeonSurfaceKindV2.Walkable,
                    Box(-1.75d, 1.75d, -5.7d, -5.45d, -1.75d, 1.75d),
                    true, true, mixedLower ? "waterworks-return-lift" : "hazard-return-lift"));
                surfaces.Add(Surface("return-lift-guide-west", "lower", DungeonSurfaceKindV2.SolidOccupancy,
                    Box(-1.85d, -1.6d, -6d, 0d, -1.85d, -1.6d),
                    true, false, "factory-support"));
                surfaces.Add(Surface("return-lift-guide-east", "lower", DungeonSurfaceKindV2.SolidOccupancy,
                    Box(1.6d, 1.85d, -6d, 0d, 1.6d, 1.85d),
                    true, false, "factory-support"));
                if (spec.Archetype == DungeonModuleArchetypeV2.PumpAndCoolantWorks)
                {
                    surfaces.Add(Surface("sorting-moving-platform", "entry", DungeonSurfaceKindV2.MovingPlatform,
                        Box(-1.5d, 1.5d, 2.75d, 3d, -1.5d, 1.5d),
                        true, true, "waterworks-moving-platform"));
                }
                if (hazard)
                {
                    surfaces.Add(Surface("hazard-field", "lower", DungeonSurfaceKindV2.Hazard,
                        Box(-halfX + 4d, halfX - 4d, -5.74d, -5.68d, -3d, 3d),
                        true, true, variantB ? "electric-floor-cycle-v1" : "magma-floor-v1",
                        DungeonAccessPredicateV2.Always,
                        IndustrialFactoryV2Ruleset.HazardControllerId));
                    surfaces.Add(Surface("safe-island-west", "lower", DungeonSurfaceKindV2.Walkable,
                        Box(-halfX + 2d, -halfX + 5d, -5.7d, -5.45d, -2d, 2d),
                        true, true, "hazard-safe-island"));
                    surfaces.Add(Surface("safe-island-east", "lower", DungeonSurfaceKindV2.Walkable,
                        Box(halfX - 5d, halfX - 2d, -5.7d, -5.45d, -2d, 2d),
                        true, true, "hazard-safe-island"));
                    surfaces.Add(Surface("safe-egress-south", "lower", DungeonSurfaceKindV2.Walkable,
                        Box(-1.75d, 1.75d, -5.7d, -5.45d, -halfZ + 0.25d, 0d),
                        true, true, "hazard-safe-island"));
                }
                AddLowerSealedShell(
                    surfaces,
                    "lower",
                    halfX,
                    halfZ,
                    -6d,
                    0d);
                AddCertifiedShaftWalls(surfaces, "lower");
                surfaces.Add(Surface("supported-catwalk", "entry", DungeonSurfaceKindV2.Walkable,
                    variantB
                        ? Box(-halfX + 2d, 0d, 2.75d, 3d, -1.5d, 1.5d)
                        : Box(-halfX + 2d, halfX - 2d, 2.75d, 3d, 1d, 3.5d),
                    true, true, "factory-catwalk"));
                surfaces.Add(Surface("catwalk-support", "entry", DungeonSurfaceKindV2.SolidOccupancy,
                    variantB
                        ? Box(-halfX + 2d, -halfX + 2.5d, 0d, 2.75d, -1.5d, 1.5d)
                        : Box(0d, 0.5d, 0d, 2.75d, 1d, 3.5d),
                    true, false, "factory-support"));
                if (variantB)
                {
                    surfaces.Add(Surface("catwalk-shaft-rail-south", "entry", DungeonSurfaceKindV2.Rail,
                        Box(-1.75d, 0d, 3d, 4d, -1.55d, -1.45d), true, false, "factory-rail"));
                    surfaces.Add(Surface("catwalk-shaft-rail-north", "entry", DungeonSurfaceKindV2.Rail,
                        Box(-1.75d, 0d, 3d, 4d, 1.45d, 1.55d), true, false, "factory-rail"));
                    surfaces.Add(Surface("catwalk-shaft-rail-east", "entry", DungeonSurfaceKindV2.Rail,
                        Box(-0.05d, 0.05d, 3d, 4d, -1.5d, 1.5d), true, false, "factory-rail"));
                }
                else
                {
                    surfaces.Add(Surface("catwalk-shaft-rail-south", "entry", DungeonSurfaceKindV2.Rail,
                        Box(-1.75d, 1.75d, 3d, 4d, 0.95d, 1.05d), true, false, "factory-rail"));
                }
            }
            else
            {
                DungeonAccessPredicateV2 upperActive = credentialGateVariant
                    ? FactPredicate(
                        DungeonPredicateConditionKindV2.ControllerState,
                        IndustrialFactoryV2Ruleset.CredentialCrumbleControllerId,
                        DungeonPredicateOperatorV2.Equals,
                        "Intact")
                    : DungeonAccessPredicateV2.Always;
                surfaces.Add(Surface("upper-platform", "upper", DungeonSurfaceKindV2.Walkable,
                    variantB
                        ? Box(-halfX + 2d, 1d, 2.75d, 3d, -halfZ + 2d, halfZ - 2d)
                        : Box(-halfX + 2d, halfX - 2d, 2.75d, 3d, 0d, halfZ - 2d),
                    true, true, "factory-catwalk",
                    upperActive,
                    credentialGateVariant
                        ? IndustrialFactoryV2Ruleset.CredentialCrumbleControllerId
                        : null));
                DungeonConvexPrismV2 rampBounds = variantB
                    ? Box(1d, 5d, 0d, 3d, -2d, 2d)
                    : Box(-5d, -1d, 0d, 3d, -2d, 2d);
                var ramp = new CertifiedDungeonRampWedgeV2(
                    rampBounds,
                    0d,
                    3d,
                    variantB ? new DungeonPoint3(-1d, 0d, 0d) : new DungeonPoint3(1d, 0d, 0d));
                surfaces.Add(new CertifiedDungeonSurfaceGeometryV2(
                    "access-ramp",
                    "entry",
                    DungeonSurfaceKindV2.Walkable,
                    CertifiedDungeonColliderKindV2.RampWedge,
                    rampBounds,
                    ramp,
                    true,
                    true,
                    "factory-ramp"));
                surfaces.Add(Surface("upper-support", "upper", DungeonSurfaceKindV2.SolidOccupancy,
                    variantB
                        ? Box(-halfX + 2d, -halfX + 2.5d, 0d, 2.75d, -halfZ + 2d, halfZ - 2d)
                        : Box(0d, 0.5d, 0d, 2.75d, 0d, halfZ - 2d),
                    true, false, "factory-support"));
            }

            if (mini)
            {
                string regionId = "reward-branch";
                DungeonBounds3 reward = regions.Single(value => value.Id == regionId).Bounds;
                surfaces.Add(Surface("reward-platform", regionId, DungeonSurfaceKindV2.Walkable,
                    Box(reward.Minimum.X, reward.Maximum.X, reward.Minimum.Y - 0.25d, reward.Minimum.Y,
                        reward.Minimum.Z, reward.Maximum.Z),
                    true, true, "factory-reward-platform"));
            }

            var anchors = new List<CertifiedDungeonAnchorGeometryV2>
            {
                new CertifiedDungeonAnchorGeometryV2("entry", "entry", DungeonAnchorKindV2.Entry,
                    new DungeonPoint3(-halfX + 2d, 0.5d, 0d)),
                new CertifiedDungeonAnchorGeometryV2("exit", "entry", DungeonAnchorKindV2.Exit,
                    variantB
                        ? new DungeonPoint3(0d, 0.5d, halfZ - 2d)
                        : new DungeonPoint3(halfX - 2d, 0.5d, 0d)),
                new CertifiedDungeonAnchorGeometryV2("safe", "entry", DungeonAnchorKindV2.Safe,
                    new DungeonPoint3(-halfX + 4d, 0.5d, 0d), "safe-reset-v2"),
                new CertifiedDungeonAnchorGeometryV2("mechanism", "entry", DungeonAnchorKindV2.Console,
                    new DungeonPoint3(0d, 0.5d, -halfZ + 2d),
                    PrimaryMechanismProfileId(spec)),
                new CertifiedDungeonAnchorGeometryV2("landmark", "entry", DungeonAnchorKindV2.Landmark,
                    new DungeonPoint3(0d, 0.5d, 0d), spec.Story.ToString())
            };
            AddAuthoredCapabilityAnchors(
                anchors,
                regions.Single(value => value.Id == "entry"),
                spec,
                variantB,
                isPrimaryRegion: true);
            if (credentialGateVariant)
            {
                DungeonBounds3 upper = regions.Single(value => value.Id == "upper").Bounds;
                anchors.Add(new CertifiedDungeonAnchorGeometryV2(
                    "crumble-safe",
                    "entry",
                    DungeonAnchorKindV2.Safe,
                    new DungeonPoint3(
                        (upper.Minimum.X + upper.Maximum.X) * 0.5d,
                        0.5d,
                        (upper.Minimum.Z + upper.Maximum.Z) * 0.5d),
                    "credential-crumble-safe-v2"));
            }
            foreach (CertifiedDungeonRegionGeometryV2 region in regions.Where(value => value.Id != "entry"))
                AddAuthoredCapabilityAnchors(
                    anchors,
                    region,
                    spec,
                    variantB,
                    isPrimaryRegion: false);
            if (mini)
            {
                DungeonBounds3 reward = regions.Single(value => value.Id == "reward-branch").Bounds;
                anchors.Add(new CertifiedDungeonAnchorGeometryV2("reward", "reward-branch", DungeonAnchorKindV2.Reward,
                    new DungeonPoint3((reward.Minimum.X + reward.Maximum.X) * 0.5d,
                        reward.Minimum.Y + 0.5d,
                        (reward.Minimum.Z + reward.Maximum.Z) * 0.5d)));
            }

            var connectors = new List<CertifiedDungeonConnectorGeometryV2>
            {
                Connector("west", "entry", new DungeonPoint3(-halfX, 0.5d, 0d), new DungeonPoint3(-1d, 0d, 0d)),
                Connector("east", "entry", new DungeonPoint3(halfX, 0.5d, 0d), new DungeonPoint3(1d, 0d, 0d)),
                Connector("north", "entry", new DungeonPoint3(0d, 0.5d, halfZ), new DungeonPoint3(0d, 0d, 1d))
            };
            if (mixedLower || hazard)
            {
                connectors.Add(LowerConnector(
                    "lower-west", "lower", new DungeonPoint3(-halfX, -4d, 0d), new DungeonPoint3(-1d, 0d, 0d)));
                connectors.Add(LowerConnector(
                    "lower-east", "lower", new DungeonPoint3(halfX, -4d, 0d), new DungeonPoint3(1d, 0d, 0d)));
                connectors.Add(LowerConnector(
                    "lower-north", "lower", new DungeonPoint3(0d, -4d, halfZ), new DungeonPoint3(0d, 0d, 1d)));
            }

            return new CertifiedDungeonModuleGeometryV2(templateId, surfaces, regions, anchors, connectors);
        }

        private static IReadOnlyList<DungeonAuthoredModuleTopologyEdgeV2> BuildTopology(
            FamilySpec spec,
            bool variantB,
            CertifiedDungeonModuleGeometryV2 geometry)
        {
            string secondary = geometry.Regions.Any(value => value.Id == "lower") ? "lower" : "upper";
            var edges = new List<DungeonAuthoredModuleTopologyEdgeV2>();
            bool waterworks = spec.Districts.Contains(DungeonBiomeDistrictKindV2.Waterworks);

            // Waterworks variant A is a reversible lift chamber. Variant B is
            // a genuine alternate topology: the upper route drops into the
            // lower district and a separately authored return lift climbs
            // back out. Keeping these as two directed edges is important. A
            // different edge label alone would not change the region graph,
            // traversal identity, or the player's route choice and therefore
            // must not count as a topology variant.
            if (waterworks && variantB)
            {
                edges.Add(new DungeonAuthoredModuleTopologyEdgeV2(
                    "edge-drop-access",
                    "entry",
                    secondary,
                    DungeonConnectorKindV2.Drop,
                    false));
                edges.Add(new DungeonAuthoredModuleTopologyEdgeV2(
                    "edge-return-lift",
                    secondary,
                    "entry",
                    DungeonConnectorKindV2.Lift,
                    false));
            }
            else
            {
                edges.Add(new DungeonAuthoredModuleTopologyEdgeV2(
                    variantB ? "edge-branch-access" : "edge-linear-access",
                    "entry",
                    secondary,
                    waterworks || spec.Archetype == DungeonModuleArchetypeV2.HazardProcessingRoom
                        ? DungeonConnectorKindV2.Lift
                        : variantB ? DungeonConnectorKindV2.Lift : DungeonConnectorKindV2.Ground,
                    true));
            }
            if (geometry.Regions.Any(value => value.Id == "reward-branch"))
            {
                edges.Add(new DungeonAuthoredModuleTopologyEdgeV2(
                    variantB ? "edge-upper-reward" : "edge-lower-reward",
                    variantB ? "upper" : "entry",
                    "reward-branch",
                    variantB ? DungeonConnectorKindV2.Jump : DungeonConnectorKindV2.Drop,
                    !variantB));
            }
            return Array.AsReadOnly(edges.ToArray());
        }

        private static void AddSealedShell(
            ICollection<CertifiedDungeonSurfaceGeometryV2> surfaces,
            string regionId,
            double halfX,
            double halfZ,
            double minimumY,
            double maximumY,
            bool northExit)
        {
            const double wall = 0.25d;
            const double halfDoor = 1.25d;
            const double doorTop = 3.65d;
            surfaces.Add(Surface("ceiling", regionId, DungeonSurfaceKindV2.Structural,
                Box(-halfX, halfX, maximumY - wall, maximumY, -halfZ, halfZ), true, false, "factory-ceiling"));
            AddDoorWall(surfaces, regionId, "west-wall", true, -halfX, halfZ, minimumY, maximumY, wall, halfDoor, doorTop);
            AddDoorWall(surfaces, regionId, "east-wall", true, halfX, halfZ, minimumY, maximumY, wall, halfDoor, doorTop);
            AddDoorWall(surfaces, regionId, "north-wall", false, halfZ, halfX, minimumY, maximumY, wall, halfDoor, doorTop);
            surfaces.Add(Surface("south-wall", regionId, DungeonSurfaceKindV2.Structural,
                Box(-halfX, halfX, minimumY, maximumY, -halfZ, -halfZ + wall), true, false, "factory-wall"));
        }

        private static void AddLowerSealedShell(
            ICollection<CertifiedDungeonSurfaceGeometryV2> surfaces,
            string regionId,
            double halfX,
            double halfZ,
            double minimumY,
            double maximumY)
        {
            const double wall = 0.25d;
            const double halfAperture = 1.75d;
            const double lowerDoorTop = -2.1d;
            const double halfDoor = 1.25d;
            AddDoorWall(surfaces, regionId, "lower-west-wall", true, -halfX, halfZ,
                minimumY, maximumY, wall, halfDoor, lowerDoorTop);
            AddDoorWall(surfaces, regionId, "lower-east-wall", true, halfX, halfZ,
                minimumY, maximumY, wall, halfDoor, lowerDoorTop);
            AddDoorWall(surfaces, regionId, "lower-north-wall", false, halfZ, halfX,
                minimumY, maximumY, wall, halfDoor, lowerDoorTop);
            surfaces.Add(Surface("lower-south-wall", regionId, DungeonSurfaceKindV2.Structural,
                Box(-halfX, halfX, minimumY, maximumY, -halfZ, -halfZ + wall), true, false, "factory-wall"));

            // Four ceiling plates leave one certified internal shaft aperture.
            // The aperture joins the entry and lower regions without assigning
            // any lower-shell face to the entry region or extending a surface
            // outside its owning region bounds.
            surfaces.Add(Surface("lower-ceiling-west", regionId, DungeonSurfaceKindV2.Structural,
                Box(-halfX, -halfAperture, maximumY - wall, maximumY, -halfZ, halfZ), true, false, "factory-underside"));
            surfaces.Add(Surface("lower-ceiling-east", regionId, DungeonSurfaceKindV2.Structural,
                Box(halfAperture, halfX, maximumY - wall, maximumY, -halfZ, halfZ), true, false, "factory-underside"));
            surfaces.Add(Surface("lower-ceiling-south", regionId, DungeonSurfaceKindV2.Structural,
                Box(-halfAperture, halfAperture, maximumY - wall, maximumY, -halfZ, -halfAperture), true, false, "factory-underside"));
            surfaces.Add(Surface("lower-ceiling-north", regionId, DungeonSurfaceKindV2.Structural,
                Box(-halfAperture, halfAperture, maximumY - wall, maximumY, halfAperture, halfZ), true, false, "factory-underside"));
        }

        private static void AddCertifiedShaftWalls(
            ICollection<CertifiedDungeonSurfaceGeometryV2> surfaces,
            string regionId)
        {
            // The central opening is a certified drop/lift shaft, not an
            // unbounded hole. Walls descend far enough to contain every fall
            // cone while leaving full capsule headroom at the lower egress.
            const double halfAperture = 1.75d;
            const double thickness = 0.15d;
            const double shaftBottom = -5.45d;
            const double egressTop = -2.3d;
            const double halfEgress = 0.75d;
            surfaces.Add(Surface("shaft-wall-west", regionId, DungeonSurfaceKindV2.Structural,
                Box(-halfAperture - thickness, -halfAperture, shaftBottom, 0d,
                    -halfAperture, halfAperture), true, false, "factory-underside"));
            surfaces.Add(Surface("shaft-wall-east", regionId, DungeonSurfaceKindV2.Structural,
                Box(halfAperture, halfAperture + thickness, shaftBottom, 0d,
                    -halfAperture, halfAperture), true, false, "factory-underside"));
            // The south wall has a capsule-clear egress only at the landing;
            // the full-height upper panel still contains the certified fall
            // cone until the player reaches the return-lift pad.
            surfaces.Add(Surface("shaft-wall-south-left", regionId, DungeonSurfaceKindV2.Structural,
                Box(-halfAperture, -halfEgress, shaftBottom, egressTop,
                    -halfAperture - thickness, -halfAperture), true, false, "factory-underside"));
            surfaces.Add(Surface("shaft-wall-south-right", regionId, DungeonSurfaceKindV2.Structural,
                Box(halfEgress, halfAperture, shaftBottom, egressTop,
                    -halfAperture - thickness, -halfAperture), true, false, "factory-underside"));
            surfaces.Add(Surface("shaft-wall-south-upper", regionId, DungeonSurfaceKindV2.Structural,
                Box(-halfAperture, halfAperture, egressTop, 0d,
                    -halfAperture - thickness, -halfAperture), true, false, "factory-underside"));
            surfaces.Add(Surface("shaft-wall-north", regionId, DungeonSurfaceKindV2.Structural,
                Box(-halfAperture, halfAperture, shaftBottom, 0d,
                    halfAperture, halfAperture + thickness), true, false, "factory-underside"));
        }

        private static void AddFamilySpecificCertifiedOccupancy(
            ICollection<CertifiedDungeonSurfaceGeometryV2> surfaces,
            FamilySpec spec,
            double halfX,
            double halfZ)
        {
            // Major presentation props are paired with stable certified
            // occupancy footprints. They hug walls or form deliberate loop
            // islands, preserving a clear 3m navigation spine through every
            // authored chamber.
            switch (spec.Archetype)
            {
                case DungeonModuleArchetypeV2.AncientServerCrypt:
                    AddMachine(surfaces, "server-bank-west", -halfX + 1.2d, -halfX + 3.2d, -halfZ + 2d, halfZ - 2d, 3.4d, "machinery-server-bank");
                    AddMachine(surfaces, "server-bank-east", halfX - 3.2d, halfX - 1.2d, -halfZ + 2d, halfZ - 2d, 3.4d, "machinery-server-bank");
                    break;
                case DungeonModuleArchetypeV2.FluidTankChamber:
                    AddMachine(surfaces, "coolant-tank-north-west", -halfX + 1.5d, -halfX + 5d, halfZ - 5d, halfZ - 1.5d, 4.8d, "machinery-coolant-tank");
                    AddMachine(surfaces, "coolant-tank-south-east", halfX - 5d, halfX - 1.5d, -halfZ + 1.5d, -halfZ + 5d, 4.8d, "machinery-coolant-tank");
                    break;
                case DungeonModuleArchetypeV2.ReaverbotRechargeChamber:
                    AddMachine(surfaces, "recharge-pods-west", -halfX + 1d, -halfX + 3.2d, -halfZ + 2d, halfZ - 2d, 3.2d, "machinery-recharge-pod");
                    AddMachine(surfaces, "recharge-pods-east", halfX - 3.2d, halfX - 1d, -halfZ + 2d, halfZ - 2d, 3.2d, "machinery-recharge-pod");
                    break;
                case DungeonModuleArchetypeV2.ReaverbotNest:
                    AddMachine(surfaces, "nest-cradle", -halfX + 2d, -halfX + 6d, -halfZ + 2d, -halfZ + 6d, 2.8d, "machinery-nest-cradle");
                    AddMachine(surfaces, "salvage-sorter", halfX - 6d, halfX - 2d, halfZ - 6d, halfZ - 2d, 2.8d, "machinery-salvage-sorter");
                    break;
                case DungeonModuleArchetypeV2.AssemblyLineHall:
                    AddMachine(surfaces, "assembly-conveyor", -halfX + 5d, halfX - 5d, -2.2d, 2.2d, 1.1d, "machinery-conveyor");
                    AddMachine(surfaces, "robot-arm-base-north", -2d, 2d, halfZ - 4d, halfZ - 1d, 2.2d, "machinery-robot-arm");
                    break;
                case DungeonModuleArchetypeV2.PumpAndCoolantWorks:
                    AddMachine(surfaces, "pump-skid-west", -halfX + 1.5d, -halfX + 5.5d, -halfZ + 2d, -halfZ + 6d, 3d, "machinery-pump-skid");
                    AddMachine(surfaces, "coolant-manifold-east", halfX - 5.5d, halfX - 1.5d, halfZ - 6d, halfZ - 2d, 3d, "machinery-coolant-manifold");
                    break;
                case DungeonModuleArchetypeV2.ReactorSupportChamber:
                    AddMachine(surfaces, "reactor-support-core", -3.5d, 3.5d, -3.5d, 3.5d, 5d, "machinery-reactor-core");
                    AddMachine(surfaces, "turbine-west", -halfX + 1.5d, -halfX + 5d, halfZ - 5d, halfZ - 1.5d, 3.5d, "machinery-turbine");
                    break;
                case DungeonModuleArchetypeV2.SecurityCheckpoint:
                    AddMachine(surfaces, "security-booth", -halfX + 1.5d, -halfX + 5d, halfZ - 5d, halfZ - 1.5d, 3.2d, "machinery-security-booth");
                    AddMachine(surfaces, "credential-scanner", halfX - 3d, halfX - 1d, -halfZ + 1.5d, -halfZ + 4d, 2.4d, "machinery-credential-scanner");
                    break;
                case DungeonModuleArchetypeV2.VerticalMaintenanceShaft:
                    AddMachine(surfaces, "cargo-lift-drive", -halfX + 1.5d, -halfX + 5d, halfZ - 5d, halfZ - 1.5d, 4d, "machinery-lift-drive");
                    AddMachine(surfaces, "maintenance-winch", halfX - 5d, halfX - 1.5d, -halfZ + 1.5d, -halfZ + 5d, 3d, "machinery-winch");
                    break;
                case DungeonModuleArchetypeV2.StorageVaultPartsWarehouse:
                    AddMachine(surfaces, "parts-rack-west", -halfX + 1d, -halfX + 3.2d, -halfZ + 2d, halfZ - 2d, 3.5d, "machinery-parts-rack");
                    AddMachine(surfaces, "parts-rack-east", halfX - 3.2d, halfX - 1d, -halfZ + 2d, halfZ - 2d, 3.5d, "machinery-parts-rack");
                    break;
                case DungeonModuleArchetypeV2.HazardProcessingRoom:
                    AddMachine(surfaces, "hazard-processor-west", -halfX + 1.5d, -halfX + 5d, -halfZ + 2d, -halfZ + 6d, 4d, "machinery-hazard-processor");
                    AddMachine(surfaces, "hazard-processor-east", halfX - 5d, halfX - 1.5d, halfZ - 6d, halfZ - 2d, 4d, "machinery-hazard-processor");
                    break;
                case DungeonModuleArchetypeV2.SurveillanceControlTheater:
                    AddMachine(surfaces, "surveillance-dais", -4d, 4d, halfZ - 6d, halfZ - 2d, 1.2d, "machinery-surveillance-dais");
                    AddMachine(surfaces, "display-bank", -halfX + 2d, halfX - 2d, -halfZ + 1d, -halfZ + 2.2d, 3.5d, "machinery-display-bank");
                    break;
            }
        }

        private static void AddMachine(
            ICollection<CertifiedDungeonSurfaceGeometryV2> surfaces,
            string id,
            double minimumX,
            double maximumX,
            double minimumZ,
            double maximumZ,
            double height,
            string materialProfileId)
        {
            surfaces.Add(Surface(id, "entry", DungeonSurfaceKindV2.SolidOccupancy,
                Box(minimumX, maximumX, 0.25d, height, minimumZ, maximumZ),
                true, false, materialProfileId));
        }

        private static void AddEntryFloorAroundShaft(
            ICollection<CertifiedDungeonSurfaceGeometryV2> surfaces,
            string regionId,
            double halfX,
            double halfZ,
            string materialProfileId)
        {
            const double halfAperture = 1.75d;
            surfaces.Add(Surface("entry-floor-west", regionId, DungeonSurfaceKindV2.Walkable,
                Box(-halfX, -halfAperture, 0d, 0.25d, -halfZ, halfZ), true, true, materialProfileId));
            surfaces.Add(Surface("entry-floor-east", regionId, DungeonSurfaceKindV2.Walkable,
                Box(halfAperture, halfX, 0d, 0.25d, -halfZ, halfZ), true, true, materialProfileId));
            surfaces.Add(Surface("entry-floor-south", regionId, DungeonSurfaceKindV2.Walkable,
                Box(-halfAperture, halfAperture, 0d, 0.25d, -halfZ, -halfAperture), true, true, materialProfileId));
            surfaces.Add(Surface("entry-floor-north", regionId, DungeonSurfaceKindV2.Walkable,
                Box(-halfAperture, halfAperture, 0d, 0.25d, halfAperture, halfZ), true, true, materialProfileId));
        }

        private static void AddDoorWall(
            ICollection<CertifiedDungeonSurfaceGeometryV2> surfaces,
            string regionId,
            string id,
            bool xWall,
            double plane,
            double halfSpan,
            double minimumY,
            double maximumY,
            double thickness,
            double halfDoor,
            double doorTop)
        {
            if (xWall)
            {
                surfaces.Add(Surface(id + "-left", regionId, DungeonSurfaceKindV2.Structural,
                    Box(plane - thickness * 0.5d, plane + thickness * 0.5d, minimumY, maximumY,
                        -halfSpan, -halfDoor), true, false, "factory-wall"));
                surfaces.Add(Surface(id + "-right", regionId, DungeonSurfaceKindV2.Structural,
                    Box(plane - thickness * 0.5d, plane + thickness * 0.5d, minimumY, maximumY,
                        halfDoor, halfSpan), true, false, "factory-wall"));
                surfaces.Add(Surface(id + "-lintel", regionId, DungeonSurfaceKindV2.Structural,
                    Box(plane - thickness * 0.5d, plane + thickness * 0.5d, doorTop, maximumY,
                        -halfDoor, halfDoor), true, false, "factory-bulkhead"));
            }
            else
            {
                surfaces.Add(Surface(id + "-left", regionId, DungeonSurfaceKindV2.Structural,
                    Box(-halfSpan, -halfDoor, minimumY, maximumY,
                        plane - thickness * 0.5d, plane + thickness * 0.5d), true, false, "factory-wall"));
                surfaces.Add(Surface(id + "-right", regionId, DungeonSurfaceKindV2.Structural,
                    Box(halfDoor, halfSpan, minimumY, maximumY,
                        plane - thickness * 0.5d, plane + thickness * 0.5d), true, false, "factory-wall"));
                surfaces.Add(Surface(id + "-lintel", regionId, DungeonSurfaceKindV2.Structural,
                    Box(-halfDoor, halfDoor, doorTop, maximumY,
                        plane - thickness * 0.5d, plane + thickness * 0.5d), true, false, "factory-bulkhead"));
            }
        }

        private static CertifiedDungeonRegionGeometryV2 Region(
            string id,
            DungeonBounds3 bounds,
            DungeonBiomeDistrictKindV2 district,
            DungeonElevationStratumV2 stratum) =>
            new CertifiedDungeonRegionGeometryV2(id, bounds, district, stratum, "navigation-" + id);

        private static CertifiedDungeonConnectorGeometryV2 Connector(
            string id,
            string regionId,
            DungeonPoint3 position,
            DungeonPoint3 facing)
        {
            const string socket = "industrial-bulkhead-3x4-v2";
            bool xFacing = Math.Abs(facing.X) >= Math.Abs(facing.Z);
            DungeonConvexPrismV2 aperture = xFacing
                ? Box(position.X - 0.2d, position.X + 0.2d, 0d, 3.65d, position.Z - 1.25d, position.Z + 1.25d)
                : Box(position.X - 1.25d, position.X + 1.25d, 0d, 3.65d, position.Z - 0.2d, position.Z + 0.2d);
            return new CertifiedDungeonConnectorGeometryV2(
                id,
                regionId,
                DungeonConnectorKindV2.Door,
                position,
                facing,
                socket,
                new DungeonConnectorApertureV2(
                    aperture,
                    socket,
                    new[] { DungeonConnectorKindV2.Door, DungeonConnectorKindV2.Ground },
                    "cap-industrial-bulkhead-v2"));
        }

        private static CertifiedDungeonConnectorGeometryV2 LowerConnector(
            string id,
            string regionId,
            DungeonPoint3 position,
            DungeonPoint3 facing)
        {
            const string socket = "industrial-lower-service-3x4-v2";
            bool xFacing = Math.Abs(facing.X) >= Math.Abs(facing.Z);
            DungeonConvexPrismV2 aperture = xFacing
                ? Box(position.X - 0.2d, position.X + 0.2d, -5.75d, -2.1d,
                    position.Z - 1.25d, position.Z + 1.25d)
                : Box(position.X - 1.25d, position.X + 1.25d, -5.75d, -2.1d,
                    position.Z - 0.2d, position.Z + 0.2d);
            return new CertifiedDungeonConnectorGeometryV2(
                id,
                regionId,
                DungeonConnectorKindV2.WaterTunnel,
                position,
                facing,
                socket,
                new DungeonConnectorApertureV2(
                    aperture,
                    socket,
                    new[] { DungeonConnectorKindV2.WaterTunnel, DungeonConnectorKindV2.Ground },
                    "cap-industrial-lower-service-v2"));
        }

        private static void AddAuthoredCapabilityAnchors(
            ICollection<CertifiedDungeonAnchorGeometryV2> anchors,
            CertifiedDungeonRegionGeometryV2 region,
            FamilySpec spec,
            bool variantB,
            bool isPrimaryRegion)
        {
            DungeonBounds3 bounds = region.Bounds;
            double y = bounds.Minimum.Y + 0.5d;
            double centerX = (bounds.Minimum.X + bounds.Maximum.X) * 0.5d;
            double centerZ = (bounds.Minimum.Z + bounds.Maximum.Z) * 0.5d;
            if (!isPrimaryRegion)
            {
                anchors.Add(new CertifiedDungeonAnchorGeometryV2("entry", region.Id, DungeonAnchorKindV2.Entry,
                    new DungeonPoint3(bounds.Minimum.X + 2d, y, centerZ), "binding-region-entry"));
                anchors.Add(new CertifiedDungeonAnchorGeometryV2("exit", region.Id, DungeonAnchorKindV2.Exit,
                    new DungeonPoint3(bounds.Maximum.X - 2d, y, centerZ), "binding-region-exit"));
                anchors.Add(new CertifiedDungeonAnchorGeometryV2("safe", region.Id, DungeonAnchorKindV2.Safe,
                    region.DistrictKind == DungeonBiomeDistrictKindV2.Waterworks
                        || region.DistrictKind == DungeonBiomeDistrictKindV2.MagmaUndercroft
                        || region.DistrictKind == DungeonBiomeDistrictKindV2.ElectricalUndercroft
                        ? new DungeonPoint3(centerX, y, centerZ)
                        : new DungeonPoint3(bounds.Minimum.X + 3d, y, centerZ),
                    "safe-reset-v2"));
                anchors.Add(new CertifiedDungeonAnchorGeometryV2("landmark", region.Id, DungeonAnchorKindV2.Landmark,
                    new DungeonPoint3(centerX, y + 1d, centerZ), "binding-landmark"));
            }

            bool mixedLower = spec.Districts.Contains(DungeonBiomeDistrictKindV2.Waterworks);
            bool hazard = spec.Archetype == DungeonModuleArchetypeV2.HazardProcessingRoom;
            bool encounterCapable = spec.Archetype == DungeonModuleArchetypeV2.ReaverbotRechargeChamber
                || spec.Archetype == DungeonModuleArchetypeV2.ReaverbotNest
                || spec.Archetype == DungeonModuleArchetypeV2.AssemblyLineHall
                || spec.Archetype == DungeonModuleArchetypeV2.ReactorSupportChamber
                || spec.Archetype == DungeonModuleArchetypeV2.HazardProcessingRoom
                || spec.Archetype == DungeonModuleArchetypeV2.SurveillanceControlTheater;
            if (encounterCapable)
            {
                anchors.Add(new CertifiedDungeonAnchorGeometryV2("encounter", region.Id, DungeonAnchorKindV2.Encounter,
                    new DungeonPoint3(centerX, y, centerZ - 1.5d), "authored-encounter-clearance-v2"));
            }

            if (isPrimaryRegion && spec.Macros.Contains(DungeonMacroRoleKindV2.SecurityEntrance))
            {
                anchors.Add(new CertifiedDungeonAnchorGeometryV2("spawn", region.Id, DungeonAnchorKindV2.Spawn,
                    new DungeonPoint3(bounds.Minimum.X + 2d, y, centerZ), "player-entry-spawn-v2"));
            }
            if (isPrimaryRegion && spec.Macros.Contains(DungeonMacroRoleKindV2.MachineCore))
            {
                anchors.Add(new CertifiedDungeonAnchorGeometryV2("large-refractor", region.Id, DungeonAnchorKindV2.Reward,
                    new DungeonPoint3(centerX, y, centerZ), "large-refractor-reward-v2"));
                anchors.Add(new CertifiedDungeonAnchorGeometryV2("extraction", region.Id, DungeonAnchorKindV2.Extraction,
                    new DungeonPoint3(bounds.Maximum.X - 2d, y, centerZ), "large-refractor-extraction-v2"));
            }
            if (isPrimaryRegion && spec.Archetype == DungeonModuleArchetypeV2.PumpAndCoolantWorks)
            {
                anchors.Add(new CertifiedDungeonAnchorGeometryV2("valve-console", region.Id, DungeonAnchorKindV2.Console,
                    new DungeonPoint3(centerX - 1.5d, y, centerZ + 1.5d),
                    IndustrialFactoryV2Ruleset.ValveUnlockControllerId));
                anchors.Add(new CertifiedDungeonAnchorGeometryV2("routing-console", region.Id, DungeonAnchorKindV2.Console,
                    new DungeonPoint3(centerX + 1.5d, y, centerZ + 1.5d),
                    IndustrialFactoryV2Ruleset.WaterRoutingControllerId));
            }

            bool credentialReward = isPrimaryRegion
                && (spec.Archetype == DungeonModuleArchetypeV2.ReaverbotNest
                    || spec.Archetype == DungeonModuleArchetypeV2.StorageVaultPartsWarehouse);
            if (credentialReward || mixedLower && !isPrimaryRegion || hazard)
            {
                string rewardProfile = credentialReward
                    ? "credential-key-reward-v2"
                    : hazard && !isPrimaryRegion
                        ? "hazard-major-reward-v2"
                        : hazard
                            ? "hazard-salvage-reward-v2"
                            : "waterworks-curated-reward-v2";
                anchors.Add(new CertifiedDungeonAnchorGeometryV2("reward", region.Id, DungeonAnchorKindV2.Reward,
                    new DungeonPoint3(centerX, y, centerZ), rewardProfile));
            }

            if (mixedLower && !isPrimaryRegion)
            {
                anchors.Add(new CertifiedDungeonAnchorGeometryV2("drained-reward", region.Id, DungeonAnchorKindV2.Reward,
                    new DungeonPoint3(centerX + 2.25d, y, centerZ + 1.25d), "waterworks-drained-reward-v2"));
                anchors.Add(new CertifiedDungeonAnchorGeometryV2("flooded-reward", region.Id, DungeonAnchorKindV2.Reward,
                    new DungeonPoint3(centerX - 2.25d, y + 3.5d, centerZ - 1.25d), "waterworks-flooded-reward-v2"));
                anchors.Add(new CertifiedDungeonAnchorGeometryV2("lower-return", region.Id, DungeonAnchorKindV2.Exit,
                    new DungeonPoint3(centerX, y, centerZ), "waterworks-return-lift-v2"));
                anchors.Add(new CertifiedDungeonAnchorGeometryV2("lower-mechanism", region.Id, DungeonAnchorKindV2.Console,
                    new DungeonPoint3(centerX + 2d, y, centerZ),
                    IndustrialFactoryV2Ruleset.WaterRoutingControllerId));
            }
            if (!isPrimaryRegion
                && (spec.Archetype == DungeonModuleArchetypeV2.ReaverbotNest
                    || spec.Archetype == DungeonModuleArchetypeV2.StorageVaultPartsWarehouse))
            {
                anchors.Add(new CertifiedDungeonAnchorGeometryV2("shortcut", region.Id, DungeonAnchorKindV2.ShortcutActivation,
                    new DungeonPoint3(centerX, y, centerZ + 1d), "waterworks-branch-shortcut-v2"));
            }
            if (hazard && !isPrimaryRegion)
            {
                anchors.Add(new CertifiedDungeonAnchorGeometryV2("lower-return", region.Id, DungeonAnchorKindV2.Exit,
                    new DungeonPoint3(centerX, y, centerZ), "hazard-return-lift-v2"));
                anchors.Add(new CertifiedDungeonAnchorGeometryV2("lower-mechanism", region.Id, DungeonAnchorKindV2.Console,
                    new DungeonPoint3(centerX + 2d, y, centerZ),
                    IndustrialFactoryV2Ruleset.HazardControllerId));
                if (variantB)
                {
                    anchors.Add(new CertifiedDungeonAnchorGeometryV2("grounding-console", region.Id, DungeonAnchorKindV2.Console,
                        new DungeonPoint3(bounds.Minimum.X + 1.2d, y, bounds.Maximum.Z - 1.2d),
                        IndustrialFactoryV2Ruleset.HazardControllerId));
                }
            }
        }

        private static string PrimaryMechanismProfileId(FamilySpec spec)
        {
            if (spec.Archetype == DungeonModuleArchetypeV2.PumpAndCoolantWorks)
                return IndustrialFactoryV2Ruleset.WaterRoutingControllerId;
            if (spec.Archetype == DungeonModuleArchetypeV2.HazardProcessingRoom)
                return IndustrialFactoryV2Ruleset.HazardControllerId;
            return spec.Mechanisms[0].ToString();
        }

        private static CertifiedDungeonSurfaceGeometryV2 Surface(
            string id,
            string regionId,
            DungeonSurfaceKindV2 kind,
            DungeonConvexPrismV2 volume,
            bool structural,
            bool walkable,
            string materialProfileId,
            DungeonAccessPredicateV2 activePredicate = null,
            string controllerId = null) =>
            new CertifiedDungeonSurfaceGeometryV2(
                id, regionId, kind, CertifiedDungeonColliderKindV2.Box, volume,
                null, structural, walkable, materialProfileId,
                activePredicate ?? DungeonAccessPredicateV2.Always,
                controllerId);

        private static DungeonAccessPredicateV2 FactPredicate(
            DungeonPredicateConditionKindV2 kind,
            string subjectId,
            DungeonPredicateOperatorV2 predicateOperator,
            string expectedValue = null) =>
            new DungeonAccessPredicateV2(new[]
            {
                new DungeonPredicateClauseV2(new[]
                {
                    new DungeonPredicateConditionV2(
                        kind,
                        subjectId,
                        predicateOperator,
                        expectedValue)
                })
            });

        private static DungeonBounds3 BoxBounds(
            double minimumX, double maximumX, double minimumY, double maximumY,
            double minimumZ, double maximumZ) =>
            new DungeonBounds3(
                new DungeonPoint3(minimumX, minimumY, minimumZ),
                new DungeonPoint3(maximumX, maximumY, maximumZ));

        private static DungeonConvexPrismV2 Box(
            double minimumX, double maximumX, double minimumY, double maximumY,
            double minimumZ, double maximumZ) =>
            new DungeonConvexPrismV2(
                new[]
                {
                    new DungeonPoint2V2(minimumX, minimumZ),
                    new DungeonPoint2V2(maximumX, minimumZ),
                    new DungeonPoint2V2(maximumX, maximumZ),
                    new DungeonPoint2V2(minimumX, maximumZ)
                },
                minimumY,
                maximumY);

        private sealed class FamilySpec
        {
            public FamilySpec(
                string slug,
                DungeonModuleArchetypeV2 archetype,
                DungeonModuleSizeClassV2 sizeClass,
                DungeonBiomeDistrictKindV2[] districts,
                DungeonMacroRoleKindV2[] macros,
                DungeonModuleSemanticFeatureV2[] features,
                DungeonMechanismProfileV2[] mechanisms,
                DungeonStoryVignetteProfileV2 story,
                DungeonLightingProfileV2 light,
                DungeonPropProfileV2 props,
                double width,
                double depth,
                double height)
            {
                Slug = slug;
                Archetype = archetype;
                SizeClass = sizeClass;
                Districts = districts;
                Macros = macros;
                Features = features;
                Mechanisms = mechanisms;
                Story = story;
                Light = light;
                Props = props;
                Width = width;
                Depth = depth;
                Height = height;
            }

            public string Slug { get; }
            public DungeonModuleArchetypeV2 Archetype { get; }
            public DungeonModuleSizeClassV2 SizeClass { get; }
            public DungeonBiomeDistrictKindV2[] Districts { get; }
            public DungeonMacroRoleKindV2[] Macros { get; }
            public DungeonModuleSemanticFeatureV2[] Features { get; }
            public DungeonMechanismProfileV2[] Mechanisms { get; }
            public DungeonStoryVignetteProfileV2 Story { get; }
            public DungeonLightingProfileV2 Light { get; }
            public DungeonPropProfileV2 Props { get; }
            public double Width { get; }
            public double Depth { get; }
            public double Height { get; }
        }
    }
}
