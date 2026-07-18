using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Dungeon.V2
{
    public sealed class DungeonSurfacePlanV2
    {
        public DungeonSurfacePlanV2(
            string id,
            string moduleInstanceId,
            string regionId,
            DungeonSurfaceKindV2 kind,
            DungeonConvexPrismV2 volume,
            string materialProfileId,
            bool isStructural,
            bool isWalkable,
            DungeonAccessPredicateV2 activePredicate,
            string controllerId = null,
            DungeonSpatialRecordSourceV2 source = DungeonSpatialRecordSourceV2.AssemblyAddition)
        {
            if (kind == DungeonSurfaceKindV2.Walkable && !isWalkable)
            {
                throw new ArgumentException("Walkable surfaces must declare IsWalkable.", nameof(isWalkable));
            }

            Id = DungeonV2Contract.RequireId(id, nameof(id));
            ModuleInstanceId = DungeonV2Contract.RequireId(moduleInstanceId, nameof(moduleInstanceId));
            RegionId = DungeonV2Contract.RequireId(regionId, nameof(regionId));
            Kind = kind;
            Volume = volume ?? throw new ArgumentNullException(nameof(volume));
            MaterialProfileId = DungeonV2Contract.RequireId(materialProfileId, nameof(materialProfileId));
            IsStructural = isStructural;
            IsWalkable = isWalkable;
            ActivePredicate = activePredicate ?? throw new ArgumentNullException(nameof(activePredicate));
            ControllerId = DungeonV2Contract.OptionalId(controllerId, nameof(controllerId));
            Source = source;
        }

        public string Id { get; }
        public string ModuleInstanceId { get; }
        public string RegionId { get; }
        public DungeonSurfaceKindV2 Kind { get; }
        public DungeonConvexPrismV2 Volume { get; }
        public string MaterialProfileId { get; }
        public bool IsStructural { get; }
        public bool IsWalkable { get; }
        public DungeonAccessPredicateV2 ActivePredicate { get; }
        public string ControllerId { get; }
        public DungeonSpatialRecordSourceV2 Source { get; }
    }

    public sealed class DungeonFluidZonePlanV2
    {
        public DungeonFluidZonePlanV2(
            string id,
            DungeonFluidKindV2 kind,
            string fluidNetworkId,
            string regionId,
            DungeonConvexPrismV2 volume,
            string floorSurfaceId,
            IEnumerable<string> activeConfigurationIds,
            double minimumCushioningDepth)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            Kind = kind;
            FluidNetworkId = DungeonV2Contract.RequireId(fluidNetworkId, nameof(fluidNetworkId));
            RegionId = DungeonV2Contract.RequireId(regionId, nameof(regionId));
            Volume = volume ?? throw new ArgumentNullException(nameof(volume));
            FloorSurfaceId = DungeonV2Contract.RequireId(floorSurfaceId, nameof(floorSurfaceId));
            ActiveConfigurationIds = DungeonV2Contract.CopyCanonicalIds(
                activeConfigurationIds,
                nameof(activeConfigurationIds),
                minimumCount: 1);
            MinimumCushioningDepth = DungeonV2Contract.RequireNonNegative(
                minimumCushioningDepth,
                nameof(minimumCushioningDepth));
        }

        public string Id { get; }
        public DungeonFluidKindV2 Kind { get; }
        public string FluidNetworkId { get; }
        public string RegionId { get; }
        public DungeonConvexPrismV2 Volume { get; }
        public string FloorSurfaceId { get; }
        public IReadOnlyList<string> ActiveConfigurationIds { get; }
        public double MinimumCushioningDepth { get; }
    }

    public sealed class DungeonFluidConfigurationPlanV2
    {
        public DungeonFluidConfigurationPlanV2(string id, IEnumerable<string> activeFluidZoneIds)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            ActiveFluidZoneIds = DungeonV2Contract.CopyCanonicalIds(
                activeFluidZoneIds,
                nameof(activeFluidZoneIds),
                minimumCount: 1);
        }

        public string Id { get; }
        public IReadOnlyList<string> ActiveFluidZoneIds { get; }
    }

    public sealed class DungeonFluidNetworkPlanV2
    {
        public DungeonFluidNetworkPlanV2(
            string id,
            IEnumerable<string> regionIds,
            IEnumerable<string> fluidZoneIds,
            IEnumerable<DungeonFluidConfigurationPlanV2> stableConfigurations,
            string initialConfigurationId,
            IEnumerable<string> controllerIds)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            RegionIds = DungeonV2Contract.CopyCanonicalIds(regionIds, nameof(regionIds), minimumCount: 1);
            FluidZoneIds = DungeonV2Contract.CopyCanonicalIds(fluidZoneIds, nameof(fluidZoneIds), minimumCount: 1);
            StableConfigurations = DungeonV2Contract.CopyCanonical(
                stableConfigurations,
                configuration => configuration.Id,
                nameof(stableConfigurations),
                minimumCount: 1);
            InitialConfigurationId = DungeonV2Contract.RequireId(
                initialConfigurationId,
                nameof(initialConfigurationId));
            if (!ContainsConfiguration(StableConfigurations, InitialConfigurationId))
            {
                throw new ArgumentException("Initial configuration must belong to the network.", nameof(initialConfigurationId));
            }

            ControllerIds = DungeonV2Contract.CopyCanonicalIds(controllerIds, nameof(controllerIds));
        }

        public string Id { get; }
        public IReadOnlyList<string> RegionIds { get; }
        public IReadOnlyList<string> FluidZoneIds { get; }
        public IReadOnlyList<DungeonFluidConfigurationPlanV2> StableConfigurations { get; }
        public string InitialConfigurationId { get; }
        public IReadOnlyList<string> ControllerIds { get; }

        private static bool ContainsConfiguration(
            IReadOnlyList<DungeonFluidConfigurationPlanV2> configurations,
            string id)
        {
            foreach (DungeonFluidConfigurationPlanV2 configuration in configurations)
            {
                if (string.Equals(configuration.Id, id, StringComparison.Ordinal))
                {
                    return true;
                }
            }

            return false;
        }
    }

    public sealed class DungeonControllerTransitionPlanV2
    {
        public DungeonControllerTransitionPlanV2(
            string id,
            string fromStateId,
            string toStateId,
            double presentationSeconds,
            DungeonAccessPredicateV2 activationPredicate,
            bool commitsAtomically)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            FromStateId = DungeonV2Contract.RequireId(fromStateId, nameof(fromStateId));
            ToStateId = DungeonV2Contract.RequireId(toStateId, nameof(toStateId));
            if (string.Equals(FromStateId, ToStateId, StringComparison.Ordinal))
            {
                throw new ArgumentException("A controller transition must change state.", nameof(toStateId));
            }

            PresentationSeconds = DungeonV2Contract.RequireNonNegative(
                presentationSeconds,
                nameof(presentationSeconds));
            ActivationPredicate = activationPredicate ?? throw new ArgumentNullException(nameof(activationPredicate));
            CommitsAtomically = commitsAtomically;
        }

        public string Id { get; }
        public string FromStateId { get; }
        public string ToStateId { get; }
        public double PresentationSeconds { get; }
        public DungeonAccessPredicateV2 ActivationPredicate { get; }
        public bool CommitsAtomically { get; }
    }

    public sealed class DungeonEnvironmentControllerPlanV2
    {
        public DungeonEnvironmentControllerPlanV2(
            string id,
            DungeonEnvironmentControllerKindV2 kind,
            IEnumerable<string> regionIds,
            IEnumerable<string> stableStateIds,
            string initialStateId,
            IEnumerable<DungeonControllerTransitionPlanV2> transitions)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            Kind = kind;
            RegionIds = DungeonV2Contract.CopyCanonicalIds(regionIds, nameof(regionIds), minimumCount: 1);
            StableStateIds = DungeonV2Contract.CopyCanonicalIds(
                stableStateIds,
                nameof(stableStateIds),
                minimumCount: 1);
            InitialStateId = DungeonV2Contract.RequireId(initialStateId, nameof(initialStateId));
            if (!ContainsId(StableStateIds, InitialStateId))
            {
                throw new ArgumentException("Initial state must be a declared stable state.", nameof(initialStateId));
            }

            Transitions = DungeonV2Contract.CopyCanonical(
                transitions,
                transition => transition.Id,
                nameof(transitions));
            foreach (DungeonControllerTransitionPlanV2 transition in Transitions)
            {
                if (!ContainsId(StableStateIds, transition.FromStateId)
                    || !ContainsId(StableStateIds, transition.ToStateId))
                {
                    throw new ArgumentException("Transitions must reference declared stable states.", nameof(transitions));
                }
            }
        }

        public string Id { get; }
        public DungeonEnvironmentControllerKindV2 Kind { get; }
        public IReadOnlyList<string> RegionIds { get; }
        public IReadOnlyList<string> StableStateIds { get; }
        public string InitialStateId { get; }
        public IReadOnlyList<DungeonControllerTransitionPlanV2> Transitions { get; }

        private static bool ContainsId(IReadOnlyList<string> ids, string target)
        {
            foreach (string id in ids)
            {
                if (string.Equals(id, target, StringComparison.Ordinal))
                {
                    return true;
                }
            }

            return false;
        }
    }

    public sealed class DungeonFallCatchmentPlanV2
    {
        public DungeonFallCatchmentPlanV2(
            string id,
            DungeonFallCatchmentKindV2 kind,
            string regionId,
            DungeonConvexPrismV2 volume,
            IEnumerable<string> safeSurfaceIds,
            string safeAnchorId,
            IEnumerable<string> coveredExposureIds,
            double structuralBottomY)
        {
            if (volume == null)
            {
                throw new ArgumentNullException(nameof(volume));
            }

            DungeonV2Contract.RequireFinite(structuralBottomY, nameof(structuralBottomY));
            if (structuralBottomY > volume.MinimumY)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(structuralBottomY),
                    structuralBottomY,
                    "Structural bottom may not be above the catchment volume.");
            }

            Id = DungeonV2Contract.RequireId(id, nameof(id));
            Kind = kind;
            RegionId = DungeonV2Contract.RequireId(regionId, nameof(regionId));
            Volume = volume;
            SafeSurfaceIds = DungeonV2Contract.CopyCanonicalIds(
                safeSurfaceIds,
                nameof(safeSurfaceIds),
                minimumCount: 1);
            SafeAnchorId = DungeonV2Contract.RequireId(safeAnchorId, nameof(safeAnchorId));
            CoveredExposureIds = DungeonV2Contract.CopyCanonicalIds(
                coveredExposureIds,
                nameof(coveredExposureIds),
                minimumCount: 1);
            StructuralBottomY = structuralBottomY;
        }

        public string Id { get; }
        public DungeonFallCatchmentKindV2 Kind { get; }
        public string RegionId { get; }
        public DungeonConvexPrismV2 Volume { get; }
        public IReadOnlyList<string> SafeSurfaceIds { get; }
        public string SafeAnchorId { get; }
        public IReadOnlyList<string> CoveredExposureIds { get; }
        public double StructuralBottomY { get; }
    }

    public sealed class DungeonFallExposurePlanV2
    {
        public DungeonFallExposurePlanV2(
            string id,
            string sourceRegionId,
            string sourceSurfaceId,
            DungeonConvexPrismV2 sourceVolume,
            DungeonFallExposureCauseV2 causes,
            string movementProfileVersion,
            double maximumHorizontalDisplacement,
            DungeonConvexPrismV2 conservativeFallVolume,
            IEnumerable<string> railConstraintSurfaceIds,
            IEnumerable<string> requiredCatchmentIds,
            double structuralBottomClearance,
            string reactionEnvelopeId)
        {
            if (causes == DungeonFallExposureCauseV2.None)
            {
                throw new ArgumentOutOfRangeException(nameof(causes), "At least one exposure cause is required.");
            }

            Id = DungeonV2Contract.RequireId(id, nameof(id));
            SourceRegionId = DungeonV2Contract.RequireId(sourceRegionId, nameof(sourceRegionId));
            SourceSurfaceId = DungeonV2Contract.RequireId(sourceSurfaceId, nameof(sourceSurfaceId));
            SourceVolume = sourceVolume ?? throw new ArgumentNullException(nameof(sourceVolume));
            Causes = causes;
            MovementProfileVersion = DungeonV2Contract.RequireId(
                movementProfileVersion,
                nameof(movementProfileVersion));
            MaximumHorizontalDisplacement = DungeonV2Contract.RequireNonNegative(
                maximumHorizontalDisplacement,
                nameof(maximumHorizontalDisplacement));
            ConservativeFallVolume = conservativeFallVolume
                ?? throw new ArgumentNullException(nameof(conservativeFallVolume));
            RailConstraintSurfaceIds = DungeonV2Contract.CopyCanonicalIds(
                railConstraintSurfaceIds,
                nameof(railConstraintSurfaceIds));
            RequiredCatchmentIds = DungeonV2Contract.CopyCanonicalIds(
                requiredCatchmentIds,
                nameof(requiredCatchmentIds),
                minimumCount: 1);
            StructuralBottomClearance = DungeonV2Contract.RequireNonNegative(
                structuralBottomClearance,
                nameof(structuralBottomClearance));
            ReactionEnvelopeId = DungeonV2Contract.RequireId(reactionEnvelopeId, nameof(reactionEnvelopeId));
        }

        public string Id { get; }
        public string SourceRegionId { get; }
        public string SourceSurfaceId { get; }
        public DungeonConvexPrismV2 SourceVolume { get; }
        public DungeonFallExposureCauseV2 Causes { get; }
        public string MovementProfileVersion { get; }
        public double MaximumHorizontalDisplacement { get; }
        public DungeonConvexPrismV2 ConservativeFallVolume { get; }
        public IReadOnlyList<string> RailConstraintSurfaceIds { get; }
        public IReadOnlyList<string> RequiredCatchmentIds { get; }
        public double StructuralBottomClearance { get; }
        public string ReactionEnvelopeId { get; }
    }

    public sealed class DungeonEnvironmentSnapshotV2
    {
        public DungeonEnvironmentSnapshotV2(
            IEnumerable<DungeonControllerStateFactV2> controllerStates,
            IEnumerable<DungeonFluidNetworkStateV2> fluidNetworkStates,
            IEnumerable<string> activeShortcutIds)
        {
            ControllerStates = DungeonV2Contract.CopyCanonical(
                controllerStates,
                state => state.ControllerId,
                nameof(controllerStates));
            FluidNetworkStates = DungeonV2Contract.CopyCanonical(
                fluidNetworkStates,
                state => state.FluidNetworkId,
                nameof(fluidNetworkStates));
            ActiveShortcutIds = DungeonV2Contract.CopyCanonicalIds(activeShortcutIds, nameof(activeShortcutIds));
        }

        public IReadOnlyList<DungeonControllerStateFactV2> ControllerStates { get; }
        public IReadOnlyList<DungeonFluidNetworkStateV2> FluidNetworkStates { get; }
        public IReadOnlyList<string> ActiveShortcutIds { get; }
    }

    public sealed class DungeonFluidNetworkStateV2
    {
        public DungeonFluidNetworkStateV2(string fluidNetworkId, string committedConfigurationId)
        {
            FluidNetworkId = DungeonV2Contract.RequireId(fluidNetworkId, nameof(fluidNetworkId));
            CommittedConfigurationId = DungeonV2Contract.RequireId(
                committedConfigurationId,
                nameof(committedConfigurationId));
        }

        public string FluidNetworkId { get; }
        public string CommittedConfigurationId { get; }
    }

    public sealed class DungeonRegionKnowledgeV2
    {
        public DungeonRegionKnowledgeV2(string regionId, DungeonMapKnowledgeLevelV2 level)
        {
            RegionId = DungeonV2Contract.RequireId(regionId, nameof(regionId));
            Level = level;
        }

        public string RegionId { get; }
        public DungeonMapKnowledgeLevelV2 Level { get; }
    }

    public sealed class DungeonMapKnowledgeStateV2
    {
        public DungeonMapKnowledgeStateV2(
            IEnumerable<DungeonRegionKnowledgeV2> regions,
            IEnumerable<string> discoveredTraversalEdgeIds,
            IEnumerable<string> discoveredLandmarkIds,
            IEnumerable<string> knownControllerIds,
            IEnumerable<string> knownShortcutIds)
        {
            Regions = DungeonV2Contract.CopyCanonical(regions, region => region.RegionId, nameof(regions));
            DiscoveredTraversalEdgeIds = DungeonV2Contract.CopyCanonicalIds(
                discoveredTraversalEdgeIds,
                nameof(discoveredTraversalEdgeIds));
            DiscoveredLandmarkIds = DungeonV2Contract.CopyCanonicalIds(
                discoveredLandmarkIds,
                nameof(discoveredLandmarkIds));
            KnownControllerIds = DungeonV2Contract.CopyCanonicalIds(knownControllerIds, nameof(knownControllerIds));
            KnownShortcutIds = DungeonV2Contract.CopyCanonicalIds(knownShortcutIds, nameof(knownShortcutIds));
        }

        public IReadOnlyList<DungeonRegionKnowledgeV2> Regions { get; }
        public IReadOnlyList<string> DiscoveredTraversalEdgeIds { get; }
        public IReadOnlyList<string> DiscoveredLandmarkIds { get; }
        public IReadOnlyList<string> KnownControllerIds { get; }
        public IReadOnlyList<string> KnownShortcutIds { get; }
    }
}
