using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace RuinCrawler.Core.Dungeon.V2
{
    public enum DungeonModuleArchetypeV2
    {
        AncientServerCrypt,
        FluidTankChamber,
        ReaverbotRechargeChamber,
        ReaverbotNest,
        AssemblyLineHall,
        PumpAndCoolantWorks,
        ReactorSupportChamber,
        SecurityCheckpoint,
        VerticalMaintenanceShaft,
        StorageVaultPartsWarehouse,
        HazardProcessingRoom,
        SurveillanceControlTheater
    }

    public enum DungeonModuleSizeClassV2
    {
        Transition,
        Medium,
        Large,
        MiniDungeon
    }

    public enum DungeonModuleTraversalTierV2
    {
        Lower,
        Entry,
        Upper
    }

    public enum DungeonModuleSemanticFeatureV2
    {
        ServerBanks,
        DataPylons,
        FluidTanks,
        Pumps,
        Valves,
        RechargePods,
        ReaverbotCradles,
        NestMachinery,
        SalvageSorting,
        Conveyors,
        RobotArms,
        CoolantManifold,
        Turbines,
        ReactorSupports,
        SecurityBulkheads,
        CredentialConsole,
        LiftMachinery,
        MaintenanceScaffolds,
        StorageRacks,
        CargoCrane,
        FurnaceInfrastructure,
        TransformerInfrastructure,
        SurveillanceDisplays,
        ControlDais,
        LandmarkMachine,
        RewardBranch
    }

    public enum DungeonPlatformPurposeV2
    {
        CriticalTraverse,
        ReturnRoute,
        OptionalReward,
        CombatFlank,
        MechanismStaging,
        RecoveryCatchment,
        Shortcut,
        ObservationOnly
    }

    public enum DungeonStructuralSupportKindV2
    {
        Bracket,
        Column,
        Suspension,
        Truss,
        Girder,
        MachineryFrame
    }

    public enum DungeonMechanismProfileV2
    {
        None,
        SecurityBulkhead,
        CargoCrane,
        ConveyorRouter,
        PumpRoutingConsole,
        FluidValve,
        CargoLift,
        CrumbleBridge,
        HazardGroundingConsole,
        FurnaceRegulator,
        ReactorInterlock
    }

    public enum DungeonStoryVignetteProfileV2
    {
        AncientDataArchive,
        InterruptedFluidTransfer,
        DormantRechargeCycle,
        ReaverbotAssemblyNest,
        AbandonedProductionShift,
        EmergencyCoolantReroute,
        ReactorContainmentFailure,
        LockedSecurityEvacuation,
        CollapsedMaintenanceWork,
        SalvageStockpile,
        HazardContainmentBreach,
        AbandonedSurveillance,
        FactoryHeart
    }

    public enum DungeonLightingProfileV2
    {
        FactoryTealAmber,
        WaterworksCyan,
        MagmaUnderlight,
        ElectricalSafeChargeLive,
        SecurityColdWhite,
        ReactorPulse
    }

    public enum DungeonPropProfileV2
    {
        ServersAndConduits,
        TanksPipesAndValves,
        RechargeCradles,
        NestDebrisAndParts,
        ConveyorsAndRobotArms,
        PumpsAndManifolds,
        ReactorSupportsAndTurbines,
        BulkheadsAndTerminals,
        LiftsLaddersAndScaffolds,
        RacksCratesAndCranes,
        FurnacesOrTransformers,
        SurveillanceTerminals,
        MixedFactoryLandmarks
    }

    public enum DungeonConnectorCapStateV2
    {
        RequiredWhenUnused,
        MechanismControlled,
        PermanentlyOpen
    }

    public enum DungeonQuarterTurnYawV2
    {
        Degrees0 = 0,
        Degrees90 = 1,
        Degrees180 = 2,
        Degrees270 = 3
    }

    /// <summary>
    /// The only legal authored-module transform. Runtime scale is deliberately
    /// absent: changing scale would invalidate certified clearances and sockets.
    /// Positive quarter turns use Unity's clockwise-from-above Y rotation.
    /// </summary>
    public readonly struct DungeonModuleTransformV2 : IEquatable<DungeonModuleTransformV2>
    {
        public DungeonModuleTransformV2(DungeonPoint3 translation, int quarterTurns)
        {
            Translation = translation;
            QuarterTurns = NormalizeQuarterTurns(quarterTurns);
        }

        public DungeonModuleTransformV2(
            DungeonPoint3 translation,
            DungeonQuarterTurnYawV2 yaw)
            : this(translation, (int)yaw)
        {
        }

        public static DungeonModuleTransformV2 Identity =>
            new DungeonModuleTransformV2(DungeonPoint3.Zero, 0);

        public DungeonPoint3 Translation { get; }
        public int QuarterTurns { get; }
        public int YawQuarterTurns => QuarterTurns;
        public DungeonQuarterTurnYawV2 Yaw => (DungeonQuarterTurnYawV2)QuarterTurns;

        public DungeonPoint3 TransformPoint(DungeonPoint3 local)
        {
            DungeonPoint3 rotated = RotateVector(local);
            return new DungeonPoint3(
                rotated.X + Translation.X,
                rotated.Y + Translation.Y,
                rotated.Z + Translation.Z);
        }

        public DungeonPoint3 TransformDirection(DungeonPoint3 local) => RotateVector(local);

        public DungeonPoint3 InverseTransformPoint(DungeonPoint3 placed)
        {
            var translated = new DungeonPoint3(
                placed.X - Translation.X,
                placed.Y - Translation.Y,
                placed.Z - Translation.Z);
            return Rotate(translated, NormalizeQuarterTurns(-QuarterTurns));
        }

        public DungeonBounds3 TransformBounds(DungeonBounds3 local)
        {
            DungeonPoint3[] corners =
            {
                new DungeonPoint3(local.Minimum.X, local.Minimum.Y, local.Minimum.Z),
                new DungeonPoint3(local.Minimum.X, local.Minimum.Y, local.Maximum.Z),
                new DungeonPoint3(local.Minimum.X, local.Maximum.Y, local.Minimum.Z),
                new DungeonPoint3(local.Minimum.X, local.Maximum.Y, local.Maximum.Z),
                new DungeonPoint3(local.Maximum.X, local.Minimum.Y, local.Minimum.Z),
                new DungeonPoint3(local.Maximum.X, local.Minimum.Y, local.Maximum.Z),
                new DungeonPoint3(local.Maximum.X, local.Maximum.Y, local.Minimum.Z),
                new DungeonPoint3(local.Maximum.X, local.Maximum.Y, local.Maximum.Z)
            };
            DungeonPoint3 first = TransformPoint(corners[0]);
            double minX = first.X;
            double minY = first.Y;
            double minZ = first.Z;
            double maxX = first.X;
            double maxY = first.Y;
            double maxZ = first.Z;
            for (int index = 1; index < corners.Length; index += 1)
            {
                DungeonPoint3 value = TransformPoint(corners[index]);
                minX = Math.Min(minX, value.X);
                minY = Math.Min(minY, value.Y);
                minZ = Math.Min(minZ, value.Z);
                maxX = Math.Max(maxX, value.X);
                maxY = Math.Max(maxY, value.Y);
                maxZ = Math.Max(maxZ, value.Z);
            }

            return new DungeonBounds3(
                new DungeonPoint3(minX, minY, minZ),
                new DungeonPoint3(maxX, maxY, maxZ));
        }

        public DungeonConvexPrismV2 TransformPrism(DungeonConvexPrismV2 local)
        {
            DungeonModuleTransformV2 transform = this;
            return new DungeonConvexPrismV2(
                local.HorizontalVertices.Select(point =>
                {
                    DungeonPoint3 transformed = transform.TransformPoint(
                        new DungeonPoint3(point.X, 0d, point.Z));
                    return new DungeonPoint2V2(transformed.X, transformed.Z);
                }),
                local.MinimumY + Translation.Y,
                local.MaximumY + Translation.Y);
        }

        public bool Equals(DungeonModuleTransformV2 other) =>
            Translation.Equals(other.Translation) && QuarterTurns == other.QuarterTurns;

        public override bool Equals(object obj) =>
            obj is DungeonModuleTransformV2 other && Equals(other);

        public override int GetHashCode()
        {
            unchecked
            {
                return (Translation.GetHashCode() * 397) ^ QuarterTurns;
            }
        }

        public override string ToString() =>
            "T(" + Translation.X.ToString("R", CultureInfo.InvariantCulture) + ","
                + Translation.Y.ToString("R", CultureInfo.InvariantCulture) + ","
                + Translation.Z.ToString("R", CultureInfo.InvariantCulture) + ") YawQuarterTurns="
                + QuarterTurns.ToString(CultureInfo.InvariantCulture);

        private DungeonPoint3 RotateVector(DungeonPoint3 local) => Rotate(local, QuarterTurns);

        private static DungeonPoint3 Rotate(DungeonPoint3 value, int turns)
        {
            switch (turns)
            {
                case 0: return value;
                case 1: return new DungeonPoint3(value.Z, value.Y, -value.X);
                case 2: return new DungeonPoint3(-value.X, value.Y, -value.Z);
                case 3: return new DungeonPoint3(-value.Z, value.Y, value.X);
                default: throw new ArgumentOutOfRangeException(nameof(turns));
            }
        }

        private static int NormalizeQuarterTurns(int value)
        {
            int normalized = value % 4;
            return normalized < 0 ? normalized + 4 : normalized;
        }
    }

    public sealed class DungeonModuleRegionBindingV2
    {
        public DungeonModuleRegionBindingV2(string localRegionId, string placedRegionId)
        {
            LocalRegionId = DungeonV2Contract.RequireId(localRegionId, nameof(localRegionId));
            PlacedRegionId = DungeonV2Contract.RequireId(placedRegionId, nameof(placedRegionId));
        }

        public string LocalRegionId { get; }
        public string PlacedRegionId { get; }
    }

    public sealed class DungeonAuthoredModuleTopologyEdgeV2
    {
        public DungeonAuthoredModuleTopologyEdgeV2(
            string id,
            string fromLocalRegionId,
            string toLocalRegionId,
            DungeonConnectorKindV2 kind,
            bool bidirectional)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            FromLocalRegionId = DungeonV2Contract.RequireId(fromLocalRegionId, nameof(fromLocalRegionId));
            ToLocalRegionId = DungeonV2Contract.RequireId(toLocalRegionId, nameof(toLocalRegionId));
            if (string.Equals(FromLocalRegionId, ToLocalRegionId, StringComparison.Ordinal))
                throw new ArgumentException("Topology edges must connect distinct local regions.");
            Kind = kind;
            Bidirectional = bidirectional;
        }

        public string Id { get; }
        public string FromLocalRegionId { get; }
        public string ToLocalRegionId { get; }
        public DungeonConnectorKindV2 Kind { get; }
        public bool Bidirectional { get; }
    }

    public sealed class DungeonPlatformPurposeBindingV2
    {
        public DungeonPlatformPurposeBindingV2(
            string platformId,
            DungeonPlatformPurposeV2 purpose,
            string targetId = null)
        {
            PlatformId = DungeonV2Contract.RequireId(platformId, nameof(platformId));
            Purpose = purpose;
            TargetId = DungeonV2Contract.OptionalId(targetId, nameof(targetId));
            if (Purpose == DungeonPlatformPurposeV2.ObservationOnly && TargetId != null)
                throw new ArgumentException("Observation-only surfaces may not bind a gameplay target.", nameof(targetId));
            if (Purpose != DungeonPlatformPurposeV2.ObservationOnly && TargetId == null)
                throw new ArgumentException("Traversable platform purposes require a stable target ID.", nameof(targetId));
        }

        public string PlatformId { get; }
        public DungeonPlatformPurposeV2 Purpose { get; }
        public string TargetId { get; }
        public bool IsWalkable => Purpose != DungeonPlatformPurposeV2.ObservationOnly;
    }

    /// <summary>
    /// Certified open volume for a connector. It is more precise than a point
    /// socket and carries both compatibility and the wall/bulkhead used when the
    /// socket is not paired by generation.
    /// </summary>
    public sealed class DungeonConnectorApertureV2
    {
        public DungeonConnectorApertureV2(
            DungeonConvexPrismV2 localVolume,
            string socketProfileId,
            IEnumerable<DungeonConnectorKindV2> compatibleConnectorKinds,
            string themedCapProfileId)
            : this(
                localVolume,
                socketProfileId,
                compatibleConnectorKinds,
                themedCapProfileId,
                localVolume.MinimumY,
                0d,
                localVolume,
                localVolume,
                0.25d,
                localVolume,
                "navigation-handoff-" + socketProfileId,
                DungeonConnectorCapStateV2.RequiredWhenUnused,
                null,
                "gasket-" + socketProfileId,
                null)
        {
        }

        public DungeonConnectorApertureV2(
            DungeonConvexPrismV2 localVolume,
            string socketProfileId,
            IEnumerable<DungeonConnectorKindV2> compatibleConnectorKinds,
            string themedCapProfileId,
            double floorElevation,
            double floorSlopeDegrees,
            DungeonConvexPrismV2 playerClearanceVolume,
            DungeonConvexPrismV2 cameraClearanceVolume,
            double seamDepth,
            DungeonConvexPrismV2 approachVolume,
            string navigationHandoffProfileId,
            DungeonConnectorCapStateV2 capState,
            string mechanismBindingId,
            string exteriorGasketProfileId,
            string verticalCompositionPortalId)
        {
            LocalVolume = localVolume ?? throw new ArgumentNullException(nameof(localVolume));
            SocketProfileId = DungeonV2Contract.RequireId(socketProfileId, nameof(socketProfileId));
            CompatibleConnectorKinds = Array.AsReadOnly((compatibleConnectorKinds
                ?? throw new ArgumentNullException(nameof(compatibleConnectorKinds)))
                .Distinct()
                .OrderBy(value => (int)value)
                .ToArray());
            if (CompatibleConnectorKinds.Count == 0)
            {
                throw new ArgumentException("At least one compatible connector kind is required.", nameof(compatibleConnectorKinds));
            }

            ThemedCapProfileId = DungeonV2Contract.RequireId(themedCapProfileId, nameof(themedCapProfileId));
            DungeonV2Contract.RequireFinite(floorElevation, nameof(floorElevation));
            DungeonV2Contract.RequireFinite(floorSlopeDegrees, nameof(floorSlopeDegrees));
            if (Math.Abs(floorSlopeDegrees) > 45d)
                throw new ArgumentOutOfRangeException(nameof(floorSlopeDegrees), "Connector floor slope must stay within certified traversal limits.");
            FloorElevation = floorElevation;
            FloorSlopeDegrees = floorSlopeDegrees;
            PlayerClearanceVolume = playerClearanceVolume ?? throw new ArgumentNullException(nameof(playerClearanceVolume));
            CameraClearanceVolume = cameraClearanceVolume ?? throw new ArgumentNullException(nameof(cameraClearanceVolume));
            SeamDepth = DungeonV2Contract.RequireNonNegative(seamDepth, nameof(seamDepth));
            ApproachVolume = approachVolume ?? throw new ArgumentNullException(nameof(approachVolume));
            NavigationHandoffProfileId = DungeonV2Contract.RequireId(navigationHandoffProfileId, nameof(navigationHandoffProfileId));
            CapState = capState;
            MechanismBindingId = DungeonV2Contract.OptionalId(mechanismBindingId, nameof(mechanismBindingId));
            ExteriorGasketProfileId = DungeonV2Contract.RequireId(exteriorGasketProfileId, nameof(exteriorGasketProfileId));
            VerticalCompositionPortalId = DungeonV2Contract.OptionalId(verticalCompositionPortalId, nameof(verticalCompositionPortalId));
            if (CapState == DungeonConnectorCapStateV2.MechanismControlled && MechanismBindingId == null)
                throw new ArgumentException("Mechanism-controlled connector caps require a mechanism binding.", nameof(mechanismBindingId));
        }

        public DungeonConvexPrismV2 LocalVolume { get; }
        public string SocketProfileId { get; }
        public IReadOnlyList<DungeonConnectorKindV2> CompatibleConnectorKinds { get; }
        public string ThemedCapProfileId { get; }
        public double FloorElevation { get; }
        public double FloorSlopeDegrees { get; }
        public DungeonConvexPrismV2 PlayerClearanceVolume { get; }
        public DungeonConvexPrismV2 CameraClearanceVolume { get; }
        public double SeamDepth { get; }
        public DungeonConvexPrismV2 ApproachVolume { get; }
        public string NavigationHandoffProfileId { get; }
        public DungeonConnectorCapStateV2 CapState { get; }
        public string MechanismBindingId { get; }
        public string ExteriorGasketProfileId { get; }
        public string VerticalCompositionPortalId { get; }

        public bool Accepts(DungeonConnectorKindV2 kind, string profileId) =>
            CompatibleConnectorKinds.Contains(kind)
                && string.Equals(SocketProfileId, profileId, StringComparison.Ordinal);
    }

    public sealed class DungeonModuleCompositionContractV2
    {
        public DungeonModuleCompositionContractV2(
            string id,
            DungeonModuleArchetypeV2 archetype,
            DungeonModuleSizeClassV2 sizeClass,
            IEnumerable<DungeonBiomeDistrictKindV2> districts,
            IEnumerable<DungeonModuleTraversalTierV2> traversalTiers,
            IEnumerable<DungeonModuleSemanticFeatureV2> requiredSemanticFeatures,
            IEnumerable<DungeonPlatformPurposeBindingV2> platformPurposes,
            IEnumerable<DungeonStructuralSupportKindV2> requiredSupports,
            IEnumerable<DungeonMechanismProfileV2> mechanismProfiles,
            DungeonStoryVignetteProfileV2 storyVignette,
            IEnumerable<DungeonLightingProfileV2> lightingProfiles,
            DungeonPropProfileV2 propProfile,
            int minimumRegions,
            int minimumRouteDecisions,
            bool requiresInternalLoop,
            bool requiresRewardBranch)
        {
            if (minimumRegions < 1) throw new ArgumentOutOfRangeException(nameof(minimumRegions));
            if (minimumRouteDecisions < 0) throw new ArgumentOutOfRangeException(nameof(minimumRouteDecisions));

            Id = DungeonV2Contract.RequireId(id, nameof(id));
            Archetype = archetype;
            SizeClass = sizeClass;
            Districts = Canonical(districts, nameof(districts));
            TraversalTiers = Canonical(traversalTiers, nameof(traversalTiers));
            RequiredSemanticFeatures = Canonical(requiredSemanticFeatures, nameof(requiredSemanticFeatures));
            PlatformPurposes = DungeonV2Contract.CopyCanonical(
                platformPurposes,
                value => value.PlatformId,
                nameof(platformPurposes),
                minimumCount: 1);
            RequiredSupports = Canonical(requiredSupports, nameof(requiredSupports));
            MechanismProfiles = Canonical(mechanismProfiles, nameof(mechanismProfiles));
            StoryVignette = storyVignette;
            LightingProfiles = Canonical(lightingProfiles, nameof(lightingProfiles));
            PropProfile = propProfile;
            MinimumRegions = minimumRegions;
            MinimumRouteDecisions = minimumRouteDecisions;
            RequiresInternalLoop = requiresInternalLoop;
            RequiresRewardBranch = requiresRewardBranch;
            ValidateScaleContract();
        }

        public string Id { get; }
        public DungeonModuleArchetypeV2 Archetype { get; }
        public DungeonModuleSizeClassV2 SizeClass { get; }
        public IReadOnlyList<DungeonBiomeDistrictKindV2> Districts { get; }
        public IReadOnlyList<DungeonModuleTraversalTierV2> TraversalTiers { get; }
        public IReadOnlyList<DungeonModuleSemanticFeatureV2> RequiredSemanticFeatures { get; }
        public IReadOnlyList<DungeonPlatformPurposeBindingV2> PlatformPurposes { get; }
        public IReadOnlyList<DungeonStructuralSupportKindV2> RequiredSupports { get; }
        public IReadOnlyList<DungeonMechanismProfileV2> MechanismProfiles { get; }
        public DungeonStoryVignetteProfileV2 StoryVignette { get; }
        public IReadOnlyList<DungeonLightingProfileV2> LightingProfiles { get; }
        public DungeonPropProfileV2 PropProfile { get; }
        public int MinimumRegions { get; }
        public int MinimumRouteDecisions { get; }
        public bool RequiresInternalLoop { get; }
        public bool RequiresRewardBranch { get; }

        private void ValidateScaleContract()
        {
            if (SizeClass == DungeonModuleSizeClassV2.Medium && MinimumRegions < 2)
                throw new ArgumentException("Medium authored chambers require at least two traversable regions.");
            if (SizeClass == DungeonModuleSizeClassV2.Large
                && (MinimumRegions < 2 || !RequiresInternalLoop))
                throw new ArgumentException("Large authored chambers require at least two regions and an internal loop.");
            if (SizeClass == DungeonModuleSizeClassV2.MiniDungeon
                && (MinimumRegions < 3 || MinimumRouteDecisions < 2 || !RequiresRewardBranch))
                throw new ArgumentException("Mini-dungeons require three regions, two route decisions, and a reward branch.");
            if (PlatformPurposes.Count == 0 || RequiredSupports.Count == 0 || LightingProfiles.Count == 0)
                throw new ArgumentException("Authored chambers require platform purpose, support, and lighting contracts.");
        }

        private static IReadOnlyList<T> Canonical<T>(IEnumerable<T> values, string parameterName)
        {
            if (values == null) throw new ArgumentNullException(parameterName);
            T[] copy = values.Distinct().OrderBy(value => Convert.ToInt32(value, CultureInfo.InvariantCulture)).ToArray();
            if (copy.Length == 0) throw new ArgumentException("Contract collection may not be empty.", parameterName);
            return Array.AsReadOnly(copy);
        }
    }

    public interface IIndustrialFactoryV2ModuleCatalog
    {
        IReadOnlyList<IndustrialFactoryV2ModuleDefinition> Definitions { get; }
        bool TryGet(string templateId, out IndustrialFactoryV2ModuleDefinition definition);
        IndustrialFactoryV2ModuleDefinition Require(string templateId);
        IReadOnlyList<IndustrialFactoryV2ModuleDefinition> FindCompatible(
            DungeonMacroRoleKindV2 macroRole,
            DungeonBiomeDistrictKindV2 district);
    }

    public sealed class DungeonAuthoredModuleCatalogV2 : IIndustrialFactoryV2ModuleCatalog
    {
        private readonly IReadOnlyList<IndustrialFactoryV2ModuleDefinition> definitions;
        private readonly IReadOnlyDictionary<string, IndustrialFactoryV2ModuleDefinition> byId;

        public DungeonAuthoredModuleCatalogV2(IEnumerable<IndustrialFactoryV2ModuleDefinition> definitions)
        {
            this.definitions = DungeonV2Contract.CopyCanonical(
                definitions,
                value => value.TemplateId,
                nameof(definitions),
                minimumCount: 1);
            byId = new ReadOnlyDictionary<string, IndustrialFactoryV2ModuleDefinition>(
                this.definitions.ToDictionary(value => value.TemplateId, StringComparer.Ordinal));
        }

        public IReadOnlyList<IndustrialFactoryV2ModuleDefinition> Definitions => definitions;

        public bool TryGet(string templateId, out IndustrialFactoryV2ModuleDefinition definition)
        {
            if (templateId == null)
            {
                definition = null;
                return false;
            }
            return byId.TryGetValue(templateId, out definition);
        }

        public IndustrialFactoryV2ModuleDefinition Require(string templateId)
        {
            if (!TryGet(templateId, out IndustrialFactoryV2ModuleDefinition result))
                throw new InvalidOperationException("Unknown authored V2 module template '" + templateId + "'.");
            return result;
        }

        public IReadOnlyList<IndustrialFactoryV2ModuleDefinition> FindCompatible(
            DungeonMacroRoleKindV2 macroRole,
            DungeonBiomeDistrictKindV2 district)
        {
            return Array.AsReadOnly(definitions
                .Where(value => value.CompatibleMacroRoles.Contains(macroRole)
                    && value.Composition.Districts.Contains(district))
                .OrderBy(value => value.TemplateId, StringComparer.Ordinal)
                .ToArray());
        }
    }

    internal static class DungeonAuthoredModuleRevisionV2
    {
        public static string Combine(params string[] values)
        {
            using (SHA256 algorithm = SHA256.Create())
            {
                byte[] digest = algorithm.ComputeHash(Encoding.UTF8.GetBytes(string.Join("\n", values)));
                return "sha256:" + string.Concat(digest.Select(value =>
                    value.ToString("x2", CultureInfo.InvariantCulture)));
            }
        }
    }
}
