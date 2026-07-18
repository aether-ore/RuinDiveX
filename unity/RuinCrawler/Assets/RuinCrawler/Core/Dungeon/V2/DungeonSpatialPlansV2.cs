using System;
using System.Collections.Generic;
using System.Linq;

namespace RuinCrawler.Core.Dungeon.V2
{
    public sealed class DungeonMacroRolePlanV2
    {
        public DungeonMacroRolePlanV2(
            string id,
            DungeonMacroRoleKindV2 role,
            IEnumerable<string> moduleInstanceIds)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            Role = role;
            ModuleInstanceIds = DungeonV2Contract.CopyCanonicalIds(
                moduleInstanceIds,
                nameof(moduleInstanceIds),
                minimumCount: 1);
        }

        public string Id { get; }
        public DungeonMacroRoleKindV2 Role { get; }
        public IReadOnlyList<string> ModuleInstanceIds { get; }
    }

    public sealed class DungeonModuleInstancePlanV2
    {
        public DungeonModuleInstancePlanV2(
            string id,
            string templateId,
            string contentHash,
            string macroRoleId,
            DungeonBounds3 bounds,
            IEnumerable<string> regionIds,
            IEnumerable<string> connectorIds,
            IEnumerable<string> anchorIds)
            : this(
                id,
                templateId,
                contentHash,
                macroRoleId,
                bounds,
                regionIds,
                connectorIds,
                anchorIds,
                DungeonModuleTransformV2.Identity,
                BuildCompatibilityBindings(regionIds))
        {
        }

        public DungeonModuleInstancePlanV2(
            string id,
            string templateId,
            string contentHash,
            string macroRoleId,
            DungeonBounds3 bounds,
            IEnumerable<string> regionIds,
            IEnumerable<string> connectorIds,
            IEnumerable<string> anchorIds,
            DungeonModuleTransformV2 transform,
            IEnumerable<DungeonModuleRegionBindingV2> regionBindings,
            string verticalCompositionId = null,
            IEnumerable<string> verticalPortalConnectorIds = null)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            TemplateId = DungeonV2Contract.RequireId(templateId, nameof(templateId));
            ContentHash = DungeonV2Contract.RequireId(contentHash, nameof(contentHash));
            MacroRoleId = DungeonV2Contract.RequireId(macroRoleId, nameof(macroRoleId));
            Bounds = bounds;
            RegionIds = DungeonV2Contract.CopyCanonicalIds(regionIds, nameof(regionIds), minimumCount: 1);
            ConnectorIds = DungeonV2Contract.CopyCanonicalIds(connectorIds, nameof(connectorIds));
            AnchorIds = DungeonV2Contract.CopyCanonicalIds(anchorIds, nameof(anchorIds));
            Transform = transform;
            VerticalCompositionId = DungeonV2Contract.OptionalId(verticalCompositionId, nameof(verticalCompositionId));
            VerticalPortalConnectorIds = DungeonV2Contract.CopyCanonicalIds(
                verticalPortalConnectorIds ?? Array.Empty<string>(),
                nameof(verticalPortalConnectorIds));
            foreach (string connectorId in VerticalPortalConnectorIds)
            {
                if (!ConnectorIds.Contains(connectorId))
                    throw new ArgumentException("Vertical portal connectors must belong to the module.", nameof(verticalPortalConnectorIds));
            }
            if (VerticalPortalConnectorIds.Count > 0 && VerticalCompositionId == null)
                throw new ArgumentException("Vertical portal connectors require a VerticalCompositionId.", nameof(verticalCompositionId));
            RegionBindings = DungeonV2Contract.CopyCanonical(
                regionBindings,
                value => value.LocalRegionId,
                nameof(regionBindings),
                minimumCount: 1);
            if (RegionBindings.Count != RegionIds.Count)
                throw new ArgumentException("Every placed region requires exactly one local-region binding.", nameof(regionBindings));
            var placed = new HashSet<string>(StringComparer.Ordinal);
            foreach (DungeonModuleRegionBindingV2 binding in RegionBindings)
            {
                if (!RegionIds.Contains(binding.PlacedRegionId)
                    || !placed.Add(binding.PlacedRegionId))
                    throw new ArgumentException("Region bindings must map one-to-one onto module region IDs.", nameof(regionBindings));
            }
        }

        public string Id { get; }
        public string TemplateId { get; }
        public string ContentHash { get; }
        public string MacroRoleId { get; }
        public DungeonBounds3 Bounds { get; }
        public IReadOnlyList<string> RegionIds { get; }
        public IReadOnlyList<string> ConnectorIds { get; }
        public IReadOnlyList<string> AnchorIds { get; }
        public DungeonModuleTransformV2 Transform { get; }
        public IReadOnlyList<DungeonModuleRegionBindingV2> RegionBindings { get; }
        public string VerticalCompositionId { get; }
        public IReadOnlyList<string> VerticalPortalConnectorIds { get; }

        private static IEnumerable<DungeonModuleRegionBindingV2> BuildCompatibilityBindings(
            IEnumerable<string> regionIds)
        {
            if (regionIds == null) throw new ArgumentNullException(nameof(regionIds));
            return regionIds.Select((regionId, index) => new DungeonModuleRegionBindingV2(
                index == 0 ? IndustrialFactoryV2ModuleCatalog.LocalRegionId : "region-" + index,
                regionId));
        }
    }

    public sealed class DungeonModuleConnectorPlanV2
    {
        public DungeonModuleConnectorPlanV2(
            string id,
            string moduleInstanceId,
            string regionId,
            DungeonConnectorKindV2 kind,
            DungeonPoint3 position,
            DungeonPoint3 facing,
            string socketTag,
            DungeonAccessPredicateV2 accessPredicate,
            DungeonSpatialRecordSourceV2 source = DungeonSpatialRecordSourceV2.AssemblyAddition)
            : this(
                id,
                moduleInstanceId,
                regionId,
                kind,
                position,
                facing,
                socketTag,
                accessPredicate,
                source,
                null)
        {
        }

        public DungeonModuleConnectorPlanV2(
            string id,
            string moduleInstanceId,
            string regionId,
            DungeonConnectorKindV2 kind,
            DungeonPoint3 position,
            DungeonPoint3 facing,
            string socketTag,
            DungeonAccessPredicateV2 accessPredicate,
            DungeonSpatialRecordSourceV2 source,
            DungeonConnectorApertureV2 aperture)
        {
            if (facing.Equals(DungeonPoint3.Zero))
            {
                throw new ArgumentException("Connector facing may not be the zero vector.", nameof(facing));
            }

            Id = DungeonV2Contract.RequireId(id, nameof(id));
            ModuleInstanceId = DungeonV2Contract.RequireId(moduleInstanceId, nameof(moduleInstanceId));
            RegionId = DungeonV2Contract.RequireId(regionId, nameof(regionId));
            Kind = kind;
            Position = position;
            Facing = facing;
            SocketTag = DungeonV2Contract.RequireId(socketTag, nameof(socketTag));
            AccessPredicate = accessPredicate ?? throw new ArgumentNullException(nameof(accessPredicate));
            Source = source;
            Aperture = aperture;
            if (source == DungeonSpatialRecordSourceV2.CertifiedModule && Aperture == null)
                throw new ArgumentException("Certified module connectors require their exact transformed aperture.", nameof(aperture));
            if (Aperture != null && !Aperture.Accepts(kind, SocketTag))
                throw new ArgumentException("Connector kind/profile is incompatible with its aperture.", nameof(aperture));
        }

        public string Id { get; }
        public string ModuleInstanceId { get; }
        public string RegionId { get; }
        public DungeonConnectorKindV2 Kind { get; }
        public DungeonPoint3 Position { get; }
        public DungeonPoint3 Facing { get; }
        public string SocketTag { get; }
        public DungeonAccessPredicateV2 AccessPredicate { get; }
        public DungeonSpatialRecordSourceV2 Source { get; }
        public DungeonConnectorApertureV2 Aperture { get; }
        public string ThemedCapProfileId => Aperture?.ThemedCapProfileId;
    }

    public sealed class DungeonAnchorPlanV2
    {
        public DungeonAnchorPlanV2(
            string id,
            string moduleInstanceId,
            string regionId,
            DungeonAnchorKindV2 kind,
            DungeonPoint3 position,
            string profileId = null,
            DungeonSpatialRecordSourceV2 source = DungeonSpatialRecordSourceV2.AssemblyAddition)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            ModuleInstanceId = DungeonV2Contract.RequireId(moduleInstanceId, nameof(moduleInstanceId));
            RegionId = DungeonV2Contract.RequireId(regionId, nameof(regionId));
            Kind = kind;
            Position = position;
            ProfileId = DungeonV2Contract.OptionalId(profileId, nameof(profileId));
            Source = source;
        }

        public string Id { get; }
        public string ModuleInstanceId { get; }
        public string RegionId { get; }
        public DungeonAnchorKindV2 Kind { get; }
        public DungeonPoint3 Position { get; }
        public string ProfileId { get; }
        public DungeonSpatialRecordSourceV2 Source { get; }
    }

    public sealed class DungeonEnvironmentSupportPlanV2
    {
        public DungeonEnvironmentSupportPlanV2(string id, DungeonAccessPredicateV2 predicate)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            Predicate = predicate ?? throw new ArgumentNullException(nameof(predicate));
        }

        public string Id { get; }
        public DungeonAccessPredicateV2 Predicate { get; }
    }

    public sealed class DungeonRegionPlanV2
    {
        public DungeonRegionPlanV2(
            string id,
            string macroRoleId,
            IEnumerable<string> moduleInstanceIds,
            DungeonBounds3 bounds,
            DungeonElevationStratumV2 elevationStratum,
            string biomeDistrictId,
            IEnumerable<string> entryExitAnchorIds,
            IEnumerable<string> encounterAnchorIds,
            IEnumerable<string> rewardAnchorIds,
            IEnumerable<string> consoleAnchorIds,
            IEnumerable<string> landmarkAnchorIds,
            IEnumerable<DungeonEnvironmentSupportPlanV2> supportedEnvironmentStates,
            string localNavigationRegionId,
            DungeonSpatialRecordSourceV2 source = DungeonSpatialRecordSourceV2.AssemblyAddition)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            MacroRoleId = DungeonV2Contract.RequireId(macroRoleId, nameof(macroRoleId));
            ModuleInstanceIds = DungeonV2Contract.CopyCanonicalIds(
                moduleInstanceIds,
                nameof(moduleInstanceIds),
                minimumCount: 1);
            Bounds = bounds;
            ElevationStratum = elevationStratum;
            BiomeDistrictId = DungeonV2Contract.RequireId(biomeDistrictId, nameof(biomeDistrictId));
            EntryExitAnchorIds = DungeonV2Contract.CopyCanonicalIds(entryExitAnchorIds, nameof(entryExitAnchorIds));
            EncounterAnchorIds = DungeonV2Contract.CopyCanonicalIds(encounterAnchorIds, nameof(encounterAnchorIds));
            RewardAnchorIds = DungeonV2Contract.CopyCanonicalIds(rewardAnchorIds, nameof(rewardAnchorIds));
            ConsoleAnchorIds = DungeonV2Contract.CopyCanonicalIds(consoleAnchorIds, nameof(consoleAnchorIds));
            LandmarkAnchorIds = DungeonV2Contract.CopyCanonicalIds(landmarkAnchorIds, nameof(landmarkAnchorIds));
            SupportedEnvironmentStates = DungeonV2Contract.CopyCanonical(
                supportedEnvironmentStates,
                state => state.Id,
                nameof(supportedEnvironmentStates),
                minimumCount: 1);
            LocalNavigationRegionId = DungeonV2Contract.RequireId(
                localNavigationRegionId,
                nameof(localNavigationRegionId));
            Source = source;
        }

        public string Id { get; }
        public string MacroRoleId { get; }
        public IReadOnlyList<string> ModuleInstanceIds { get; }
        public DungeonBounds3 Bounds { get; }
        public DungeonElevationStratumV2 ElevationStratum { get; }
        public string BiomeDistrictId { get; }
        public IReadOnlyList<string> EntryExitAnchorIds { get; }
        public IReadOnlyList<string> EncounterAnchorIds { get; }
        public IReadOnlyList<string> RewardAnchorIds { get; }
        public IReadOnlyList<string> ConsoleAnchorIds { get; }
        public IReadOnlyList<string> LandmarkAnchorIds { get; }
        public IReadOnlyList<DungeonEnvironmentSupportPlanV2> SupportedEnvironmentStates { get; }
        public string LocalNavigationRegionId { get; }
        public DungeonSpatialRecordSourceV2 Source { get; }
    }

    public sealed class DungeonBiomeDistrictPlanV2
    {
        public DungeonBiomeDistrictPlanV2(
            string id,
            DungeonBiomeDistrictKindV2 kind,
            IEnumerable<string> regionIds,
            IEnumerable<string> entranceTransitionIds,
            IEnumerable<string> revealAnchorIds,
            IEnumerable<string> traversalTags,
            IEnumerable<string> encounterCompatibilityTags,
            string landmarkProfileId,
            string rewardProfileId,
            string audioProfileId,
            string lightingProfileId,
            string minimapPresentationProfileId,
            int minimumDiscoveries,
            int minimumRouteLoops,
            int minimumReturnConnections,
            IEnumerable<string> environmentControllerIds)
        {
            if (minimumDiscoveries < 0 || minimumRouteLoops < 0 || minimumReturnConnections < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(minimumDiscoveries), "District minima must be non-negative.");
            }

            Id = DungeonV2Contract.RequireId(id, nameof(id));
            Kind = kind;
            RegionIds = DungeonV2Contract.CopyCanonicalIds(regionIds, nameof(regionIds), minimumCount: 1);
            EntranceTransitionIds = DungeonV2Contract.CopyCanonicalIds(
                entranceTransitionIds,
                nameof(entranceTransitionIds));
            RevealAnchorIds = DungeonV2Contract.CopyCanonicalIds(revealAnchorIds, nameof(revealAnchorIds));
            TraversalTags = DungeonV2Contract.CopyCanonicalIds(traversalTags, nameof(traversalTags));
            EncounterCompatibilityTags = DungeonV2Contract.CopyCanonicalIds(
                encounterCompatibilityTags,
                nameof(encounterCompatibilityTags));
            LandmarkProfileId = DungeonV2Contract.RequireId(landmarkProfileId, nameof(landmarkProfileId));
            RewardProfileId = DungeonV2Contract.RequireId(rewardProfileId, nameof(rewardProfileId));
            AudioProfileId = DungeonV2Contract.RequireId(audioProfileId, nameof(audioProfileId));
            LightingProfileId = DungeonV2Contract.RequireId(lightingProfileId, nameof(lightingProfileId));
            MinimapPresentationProfileId = DungeonV2Contract.RequireId(
                minimapPresentationProfileId,
                nameof(minimapPresentationProfileId));
            MinimumDiscoveries = minimumDiscoveries;
            MinimumRouteLoops = minimumRouteLoops;
            MinimumReturnConnections = minimumReturnConnections;
            EnvironmentControllerIds = DungeonV2Contract.CopyCanonicalIds(
                environmentControllerIds,
                nameof(environmentControllerIds));
        }

        public string Id { get; }
        public DungeonBiomeDistrictKindV2 Kind { get; }
        public IReadOnlyList<string> RegionIds { get; }
        public IReadOnlyList<string> EntranceTransitionIds { get; }
        public IReadOnlyList<string> RevealAnchorIds { get; }
        public IReadOnlyList<string> TraversalTags { get; }
        public IReadOnlyList<string> EncounterCompatibilityTags { get; }
        public string LandmarkProfileId { get; }
        public string RewardProfileId { get; }
        public string AudioProfileId { get; }
        public string LightingProfileId { get; }
        public string MinimapPresentationProfileId { get; }
        public int MinimumDiscoveries { get; }
        public int MinimumRouteLoops { get; }
        public int MinimumReturnConnections { get; }
        public IReadOnlyList<string> EnvironmentControllerIds { get; }
    }

    public sealed class DungeonTraversalEdgePlanV2
    {
        public DungeonTraversalEdgePlanV2(
            string id,
            string fromRegionId,
            string toRegionId,
            string fromAnchorId,
            string toAnchorId,
            DungeonConnectorKindV2 kind,
            DungeonAccessPredicateV2 accessPredicate,
            bool isProtectedProgressionBoundary)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            FromRegionId = DungeonV2Contract.RequireId(fromRegionId, nameof(fromRegionId));
            ToRegionId = DungeonV2Contract.RequireId(toRegionId, nameof(toRegionId));
            if (string.Equals(FromRegionId, ToRegionId, StringComparison.Ordinal))
            {
                throw new ArgumentException("Traversal edges must connect distinct regions.", nameof(toRegionId));
            }

            FromAnchorId = DungeonV2Contract.RequireId(fromAnchorId, nameof(fromAnchorId));
            ToAnchorId = DungeonV2Contract.RequireId(toAnchorId, nameof(toAnchorId));
            Kind = kind;
            AccessPredicate = accessPredicate ?? throw new ArgumentNullException(nameof(accessPredicate));
            IsProtectedProgressionBoundary = isProtectedProgressionBoundary;
        }

        public string Id { get; }
        public string FromRegionId { get; }
        public string ToRegionId { get; }
        public string FromAnchorId { get; }
        public string ToAnchorId { get; }
        public DungeonConnectorKindV2 Kind { get; }
        public DungeonAccessPredicateV2 AccessPredicate { get; }
        public bool IsProtectedProgressionBoundary { get; }
    }

    public sealed class DungeonAuthorizedExitPlanV2
    {
        public DungeonAuthorizedExitPlanV2(
            string id,
            string exitRegionId,
            string rejoinRegionId,
            DungeonAccessPredicateV2 earliestAuthorizationPredicate)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            ExitRegionId = DungeonV2Contract.RequireId(exitRegionId, nameof(exitRegionId));
            RejoinRegionId = DungeonV2Contract.RequireId(rejoinRegionId, nameof(rejoinRegionId));
            EarliestAuthorizationPredicate = earliestAuthorizationPredicate
                ?? throw new ArgumentNullException(nameof(earliestAuthorizationPredicate));
        }

        public string Id { get; }
        public string ExitRegionId { get; }
        public string RejoinRegionId { get; }
        public DungeonAccessPredicateV2 EarliestAuthorizationPredicate { get; }
    }

    public sealed class DungeonExplorationRoutePlanV2
    {
        public DungeonExplorationRoutePlanV2(
            string id,
            IEnumerable<string> orderedTraversalEdgeIds,
            DungeonRouteRoleV2 role,
            DungeonAccessPredicateV2 requiredPredicate,
            IEnumerable<DungeonAuthorizedExitPlanV2> authorizedExits,
            double estimatedTraversalSeconds,
            double riskBudget,
            IEnumerable<string> discoveryIds,
            DungeonReverseTraversalPolicyV2 reverseTraversalPolicy,
            DungeonRevealPolicyV2 revealPolicy)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            OrderedTraversalEdgeIds = DungeonV2Contract.CopyOrderedIds(
                orderedTraversalEdgeIds,
                nameof(orderedTraversalEdgeIds),
                minimumCount: 1);
            Role = role;
            RequiredPredicate = requiredPredicate ?? throw new ArgumentNullException(nameof(requiredPredicate));
            AuthorizedExits = DungeonV2Contract.CopyCanonical(
                authorizedExits,
                exit => exit.Id,
                nameof(authorizedExits),
                minimumCount: 1);
            EstimatedTraversalSeconds = DungeonV2Contract.RequireNonNegative(
                estimatedTraversalSeconds,
                nameof(estimatedTraversalSeconds));
            RiskBudget = DungeonV2Contract.RequireNonNegative(riskBudget, nameof(riskBudget));
            DiscoveryIds = DungeonV2Contract.CopyCanonicalIds(discoveryIds, nameof(discoveryIds));
            ReverseTraversalPolicy = reverseTraversalPolicy;
            RevealPolicy = revealPolicy;
        }

        public string Id { get; }
        public IReadOnlyList<string> OrderedTraversalEdgeIds { get; }
        public DungeonRouteRoleV2 Role { get; }
        public DungeonAccessPredicateV2 RequiredPredicate { get; }
        public IReadOnlyList<DungeonAuthorizedExitPlanV2> AuthorizedExits { get; }
        public double EstimatedTraversalSeconds { get; }
        public double RiskBudget { get; }
        public IReadOnlyList<string> DiscoveryIds { get; }
        public DungeonReverseTraversalPolicyV2 ReverseTraversalPolicy { get; }
        public DungeonRevealPolicyV2 RevealPolicy { get; }
    }

    public sealed class DungeonDiscoveryPlanV2
    {
        public DungeonDiscoveryPlanV2(
            string id,
            DungeonDiscoveryKindV2 kind,
            string locationAnchorId,
            string districtId,
            DungeonAccessPredicateV2 accessPredicate,
            DungeonAccessPredicateV2 revealPredicate,
            string durableRewardId,
            int completionSignificance,
            DungeonDiscoveryDuplicatePolicyV2 duplicatePolicy)
        {
            if (completionSignificance < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(completionSignificance));
            }

            Id = DungeonV2Contract.RequireId(id, nameof(id));
            Kind = kind;
            LocationAnchorId = DungeonV2Contract.RequireId(locationAnchorId, nameof(locationAnchorId));
            DistrictId = DungeonV2Contract.RequireId(districtId, nameof(districtId));
            AccessPredicate = accessPredicate ?? throw new ArgumentNullException(nameof(accessPredicate));
            RevealPredicate = revealPredicate ?? throw new ArgumentNullException(nameof(revealPredicate));
            DurableRewardId = DungeonV2Contract.OptionalId(durableRewardId, nameof(durableRewardId));
            CompletionSignificance = completionSignificance;
            DuplicatePolicy = duplicatePolicy;
        }

        public string Id { get; }
        public DungeonDiscoveryKindV2 Kind { get; }
        public string LocationAnchorId { get; }
        public string DistrictId { get; }
        public DungeonAccessPredicateV2 AccessPredicate { get; }
        public DungeonAccessPredicateV2 RevealPredicate { get; }
        public string DurableRewardId { get; }
        public int CompletionSignificance { get; }
        public DungeonDiscoveryDuplicatePolicyV2 DuplicatePolicy { get; }
    }

    public sealed class DungeonShortcutPlanV2
    {
        public DungeonShortcutPlanV2(
            string id,
            string routeId,
            IEnumerable<string> lockedTraversalEdgeIds,
            IEnumerable<string> unlockedTraversalEdgeIds,
            string activationRegionId,
            string activationAnchorId,
            DungeonAccessPredicateV2 earliestAuthorizationPredicate,
            string rejoinRegionId,
            DungeonAccessPredicateV2 environmentStatePredicate,
            DungeonShortcutPersistencePolicyV2 persistencePolicy,
            DungeonRevealPolicyV2 revealPolicy)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            RouteId = DungeonV2Contract.RequireId(routeId, nameof(routeId));
            LockedTraversalEdgeIds = DungeonV2Contract.CopyCanonicalIds(
                lockedTraversalEdgeIds,
                nameof(lockedTraversalEdgeIds),
                minimumCount: 1);
            UnlockedTraversalEdgeIds = DungeonV2Contract.CopyCanonicalIds(
                unlockedTraversalEdgeIds,
                nameof(unlockedTraversalEdgeIds),
                minimumCount: 1);
            ActivationRegionId = DungeonV2Contract.RequireId(activationRegionId, nameof(activationRegionId));
            ActivationAnchorId = DungeonV2Contract.RequireId(activationAnchorId, nameof(activationAnchorId));
            EarliestAuthorizationPredicate = earliestAuthorizationPredicate
                ?? throw new ArgumentNullException(nameof(earliestAuthorizationPredicate));
            RejoinRegionId = DungeonV2Contract.RequireId(rejoinRegionId, nameof(rejoinRegionId));
            EnvironmentStatePredicate = environmentStatePredicate
                ?? throw new ArgumentNullException(nameof(environmentStatePredicate));
            PersistencePolicy = persistencePolicy;
            RevealPolicy = revealPolicy;
        }

        public string Id { get; }
        public string RouteId { get; }
        public IReadOnlyList<string> LockedTraversalEdgeIds { get; }
        public IReadOnlyList<string> UnlockedTraversalEdgeIds { get; }
        public string ActivationRegionId { get; }
        public string ActivationAnchorId { get; }
        public DungeonAccessPredicateV2 EarliestAuthorizationPredicate { get; }
        public string RejoinRegionId { get; }
        public DungeonAccessPredicateV2 EnvironmentStatePredicate { get; }
        public DungeonShortcutPersistencePolicyV2 PersistencePolicy { get; }
        public DungeonRevealPolicyV2 RevealPolicy { get; }
    }
}
